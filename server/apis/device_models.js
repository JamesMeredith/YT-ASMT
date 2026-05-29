/**
 * 设备型号管理 API v3.2
 * 总部管理公司设备型号目录：增删改查
 * 绑定设备/售中项目时可从此目录选择型号
 */
const express = require('express');
const router = express.Router();
const { getDbSync } = require('../db');
const { logAudit } = require('../auth');

// ===================== 列表（所有人可读） =====================
router.get('/', (req, res) => {
  try {
    const db = getDbSync();
    const { keyword, device_type, status, page = 1, page_size = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(page_size);
    let where = [];
    let params = [];
    if (keyword) { where.push('(model_code LIKE ? OR model_name LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`); }
    if (device_type) { where.push('device_type = ?'); params.push(device_type); }
    if (status === 'active' || status === 'discontinued') { where.push('status = ?'); params.push(status); }
    else if (!status || status === 'all') { /* 展示全部，不加 status 过滤 */ }
    const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = db.prepare(`SELECT COUNT(*) as cnt FROM device_models ${whereStr}`).get(...params).cnt;
    const rows = db.prepare(`SELECT * FROM device_models ${whereStr} ORDER BY device_type, model_code LIMIT ? OFFSET ?`)
      .all(...params, parseInt(page_size), offset);
    res.json({ total, page: parseInt(page), page_size: parseInt(page_size), data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===================== 新增（HQ only） =====================
router.post('/', (req, res) => {
  try {
    const db = getDbSync();
    const user = req.user;
    if (user.role !== 'headquarters') return res.status(403).json({ error: '仅总部可操作' });
    const { model_code, model_name, device_type, manufacturer, specification, description } = req.body;
    if (!model_code || !model_name || !device_type) return res.status(400).json({ error: '型号编码、名称、类型为必填' });
    const exist = db.prepare('SELECT id FROM device_models WHERE model_code = ?').get(model_code);
    if (exist) return res.status(400).json({ error: '型号编码已存在' });
    const r = db.prepare(`
      INSERT INTO device_models (model_code,model_name,device_type,manufacturer,specification,description)
      VALUES (?,?,?,?,?,?)
    `).run(model_code, model_name, device_type, manufacturer || null, specification || null, description || null);
    logAudit(db, user.id, user.username, user.role, '新增设备型号', 'device_models', String(r.lastInsertRowid), null, model_code);
    res.json({ id: r.lastInsertRowid, message: '已添加' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ===================== 修改（HQ only） =====================
router.patch('/:id', (req, res) => {
  try {
    const db = getDbSync();
    const user = req.user;
    if (user.role !== 'headquarters') return res.status(403).json({ error: '仅总部可操作' });
    const id = parseInt(req.params.id);
    const exist = db.prepare('SELECT id, model_code FROM device_models WHERE id = ?').get(id);
    if (!exist) return res.status(404).json({ error: '型号不存在' });
    const { model_name, device_type, manufacturer, specification, description, status } = req.body;
    const fields = [];
    const params = [];
    if (model_name !== undefined) { fields.push('model_name = ?'); params.push(model_name); }
    if (device_type !== undefined) { fields.push('device_type = ?'); params.push(device_type); }
    if (manufacturer !== undefined) { fields.push('manufacturer = ?'); params.push(manufacturer); }
    if (specification !== undefined) { fields.push('specification = ?'); params.push(specification); }
    if (description !== undefined) { fields.push('description = ?'); params.push(description); }
    if (status !== undefined) { fields.push('status = ?'); params.push(status); }
    if (!fields.length) return res.status(400).json({ error: '无更新内容' });
    fields.push("updated_at = datetime('now','localtime')");
    params.push(id);
    db.prepare(`UPDATE device_models SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    logAudit(db, user.id, user.username, user.role, '修改设备型号', 'device_models', String(id), exist.model_code, JSON.stringify(req.body));
    res.json({ message: '已更新' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ===================== 删除（HQ only） =====================
router.delete('/:id', (req, res) => {
  try {
    const db = getDbSync();
    const user = req.user;
    if (user.role !== 'headquarters') return res.status(403).json({ error: '仅总部可操作' });
    const id = parseInt(req.params.id);
    const exist = db.prepare('SELECT * FROM device_models WHERE id = ?').get(id);
    if (!exist) return res.status(404).json({ error: '型号不存在' });
    // 检查是否有设备实例绑定此型号
    const bound = db.prepare('SELECT COUNT(*) as cnt FROM devices WHERE device_type = ?').get(exist.model_code).cnt;
    if (bound > 0) return res.status(400).json({ error: `有 ${bound} 台设备使用此型号，禁止删除` });
    db.prepare('DELETE FROM device_models WHERE id = ?').run(id);
    logAudit(db, user.id, user.username, user.role, '删除设备型号', 'device_models', String(id), exist.model_code, null);
    res.json({ message: '已删除' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

module.exports = router;
