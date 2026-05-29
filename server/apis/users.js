/**
 * 用户管理 API
 * 总部专用：创建/修改/禁用用户
 */
const express = require('express');
const router = express.Router();
const { getDbSync } = require('../db');
const { requireHeadquarters, logAudit } = require('../auth');
const { buildUserVisibilityFilter } = require('../middleware/region-filter');

// ===================== 用户列表 =====================
router.get('/', (req, res) => {
  try {
    const db = getDbSync();
    const { page = 1, page_size = 20, keyword, role, status, agent_level, province, parent_agent_id } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(page_size);
    const user = req.user;
    if (!user) return res.status(401).json({ error: '未登录' });

    let where = [];
    let params = [];

    // 权限过滤
    const visFilter = buildUserVisibilityFilter(user, db);
    if (visFilter.sql) {
      // buildUserVisibilityFilter 用的别名是 u
      where.push('1=1');
    }

    if (keyword) { where.push('(u.username LIKE ? OR u.real_name LIKE ? OR u.company_name LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
    if (role) { where.push('u.role = ?'); params.push(role); }
    if (agent_level) { where.push('u.agent_level = ?'); params.push(agent_level); }
    if (status) { where.push('u.status = ?'); params.push(status); }
    if (province) { where.push('u.province = ?'); params.push(province); }
    if (parent_agent_id) { where.push('u.parent_agent_id = ?'); params.push(parent_agent_id); }

    let visSql = '';
    let visParams = [];
    if (visFilter.sql) {
      visSql = visFilter.sql;
      visParams = visFilter.params;
    }

    const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const combinedWhere = whereStr + (whereStr ? ' AND ' : 'WHERE ') + visFilter.sql.replace(/^ AND /, '');

    // 实际上 buildUserVisibilityFilter 已经包含了完整的 where，直接拼接
    let finalWhere = '';
    let finalParams = [];

    if (visFilter.sql) {
      // 把 visFilter 的条件作为基础条件
      if (where.length) {
        finalWhere = 'WHERE ' + visFilter.sql.replace(/^ AND /, '') + ' AND ' + where.map(w => {
          // Remove 'u.' from the where clause since visFilter already uses u.
          return w;
        }).join(' AND ');
        finalParams = [...visFilter.params, ...params];
      } else {
        finalWhere = 'WHERE ' + visFilter.sql.replace(/^ AND /, '');
        finalParams = visFilter.params;
      }
    } else {
      finalWhere = whereStr;
      finalParams = params;
    }

    const total = db.prepare(`SELECT COUNT(*) as cnt FROM users u ${finalWhere}`).get(...finalParams).cnt;
    const rows = db.prepare(`
      SELECT u.id,u.username,u.real_name,u.role,u.agent_level,u.parent_agent_id,
             u.company_name,u.position,u.phone,u.email,u.province,u.city,u.region,
             u.responsible_provinces,u.responsible_cities,u.status,u.last_login,u.created_at,
             p.real_name as parent_name
      FROM users u
      LEFT JOIN users p ON p.id = u.parent_agent_id
      ${finalWhere}
      ORDER BY u.created_at DESC LIMIT ? OFFSET ?
    `).all(...finalParams, parseInt(page_size), offset);

    res.json({ total, page: parseInt(page), page_size: parseInt(page_size), data: rows });
  } catch (e) {
    console.error('[USERS] 列表查询失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===================== 创建用户（总部专用） =====================
router.post('/', requireHeadquarters, (req, res) => {
  try {
    const db = getDbSync();
    const bcrypt = require('bcryptjs');
    const {
      username, real_name, role, agent_level, parent_agent_id,
      company_name, company_address, position, phone, email,
      province, city, responsible_provinces, responsible_cities, password
    } = req.body;

    if (!username || !real_name || !role || !phone) {
      return res.status(400).json({ error: '用户名、姓名、角色、手机号为必填项' });
    }

    if (role === 'provincial_agent' && (!agent_level || !responsible_provinces)) {
      return res.status(400).json({ error: '省代需要填写负责省份' });
    }
    if (role === 'city_agent' && (!parent_agent_id || !responsible_cities)) {
      return res.status(400).json({ error: '市代需要选择上级省代并填写负责城市' });
    }

    // 去重
    const exist = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (exist) return res.status(400).json({ error: '用户名已存在' });

    const passwordHash = bcrypt.hashSync(password || '123456', 10);
    const region = province ? require('../middleware/region-filter').getRegion(province) : null;

    const result = db.prepare(`
      INSERT INTO users (username,password_hash,real_name,role,agent_level,parent_agent_id,
        company_name,company_address,position,phone,email,province,city,region,
        responsible_provinces,responsible_cities,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active')
    `).run(
      username, passwordHash, real_name, role,
      agent_level || null, parent_agent_id || null,
      company_name || null, company_address || null, position || null,
      phone, email || null,
      province || null, city || null, region,
      JSON.stringify(responsible_provinces || []),
      JSON.stringify(responsible_cities || [])
    );

    logAudit(db, req.user.id, req.user.username, req.user.role,
      '创建用户', 'user', String(result.lastInsertRowid), null, username);

    res.json({ id: result.lastInsertRowid, message: '创建成功' });
  } catch (e) {
    console.error('[USERS] 创建失败:', e.message);
    res.status(400).json({ error: e.message });
  }
});

// ===================== 修改用户 =====================
router.patch('/:id', requireHeadquarters, (req, res) => {
  try {
    const db = getDbSync();
    const id = parseInt(req.params.id);
    const exist = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!exist) return res.status(404).json({ error: '用户不存在' });

    const {
      real_name, role, agent_level, parent_agent_id,
      company_name, company_address, position, phone, email,
      province, city, responsible_provinces, responsible_cities, status
    } = req.body;

    const fields = [];
    const params = [];

    if (real_name !== undefined) { fields.push('real_name = ?'); params.push(real_name); }
    if (role !== undefined) { fields.push('role = ?'); params.push(role); }
    if (agent_level !== undefined) { fields.push('agent_level = ?'); params.push(agent_level); }
    if (parent_agent_id !== undefined) { fields.push('parent_agent_id = ?'); params.push(parent_agent_id); }
    if (company_name !== undefined) { fields.push('company_name = ?'); params.push(company_name); }
    if (company_address !== undefined) { fields.push('company_address = ?'); params.push(company_address); }
    if (position !== undefined) { fields.push('position = ?'); params.push(position); }
    if (phone !== undefined) { fields.push('phone = ?'); params.push(phone); }
    if (email !== undefined) { fields.push('email = ?'); params.push(email); }
    if (province !== undefined) {
      fields.push('province = ?'); params.push(province);
      const region = require('../middleware/region-filter').getRegion(province);
      fields.push('region = ?'); params.push(region);
    }
    if (city !== undefined) { fields.push('city = ?'); params.push(city); }
    if (responsible_provinces !== undefined) { fields.push('responsible_provinces = ?'); params.push(JSON.stringify(responsible_provinces)); }
    if (responsible_cities !== undefined) { fields.push('responsible_cities = ?'); params.push(JSON.stringify(responsible_cities)); }
    if (status !== undefined) { fields.push('status = ?'); params.push(status); }

    if (!fields.length) return res.status(400).json({ error: '无更新内容' });

    fields.push(`updated_at = datetime('now','localtime')`);
    params.push(id);

    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params);

    logAudit(db, req.user.id, req.user.username, req.user.role,
      '修改用户', 'user', String(id), null, JSON.stringify(req.body));

    res.json({ message: '修改成功' });
  } catch (e) {
    console.error('[USERS] 修改失败:', e.message);
    res.status(400).json({ error: e.message });
  }
});

// ===================== 重置密码 =====================
router.post('/:id/reset-password', requireHeadquarters, (req, res) => {
  try {
    const db = getDbSync();
    const id = parseInt(req.params.id);
    const exist = db.prepare('SELECT id,username FROM users WHERE id = ?').get(id);
    if (!exist) return res.status(404).json({ error: '用户不存在' });

    const bcrypt = require('bcryptjs');
    const newPassword = req.body.password || '123456';
    const newHash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime("now","localtime") WHERE id = ?').run(newHash, id);

    logAudit(db, req.user.id, req.user.username, req.user.role,
      '重置密码', 'user', String(id), null, exist.username);

    res.json({ message: '密码已重置' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== 启停用户 =====================
router.patch('/:id/toggle', requireHeadquarters, (req, res) => {
  try {
    const db = getDbSync();
    const id = parseInt(req.params.id);
    const exist = db.prepare('SELECT id,username,status FROM users WHERE id = ?').get(id);
    if (!exist) return res.status(404).json({ error: '用户不存在' });
    const newStatus = exist.status === 'active' ? 'disabled' : 'active';
    db.prepare('UPDATE users SET status = ?, updated_at = datetime("now","localtime") WHERE id = ?').run(newStatus, id);
    logAudit(db, req.user.id, req.user.username, req.user.role,
      '启停用户', 'user', String(id), exist.username, newStatus);
    res.json({ message: newStatus === 'active' ? '已启用' : '已禁用', status: newStatus });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== 查询上级代理商列表（用于创建用户时选择） =====================
router.get('/agents/list', (req, res) => {
  try {
    const db = getDbSync();
    const { agent_level } = req.query;
    const filter = agent_level ? 'WHERE agent_level = ?' : '';
    const params = agent_level ? [agent_level] : [];
    const rows = db.prepare(`
      SELECT id,username,real_name,company_name,agent_level,province,status
      FROM users WHERE role IN ('provincial_agent','city_agent')
      ${filter}
      ORDER BY agent_level DESC, province, real_name
    `).all(...params);
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== 获取单用户详情 =====================
router.get('/:id', (req, res) => {
  try {
    const db = getDbSync();
    const id = parseInt(req.params.id);
    const u = db.prepare(`
      SELECT u.*, p.real_name as parent_name
      FROM users u LEFT JOIN users p ON p.id = u.parent_agent_id
      WHERE u.id = ?
    `).get(id);
    if (!u) return res.status(404).json({ error: '用户不存在' });
    const { password_hash, ...safe } = u;
    res.json(safe);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;