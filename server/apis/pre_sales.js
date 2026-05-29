/**
 * 售中模块 API v3.0
 * 8节点售中流程管理：远程前置 → 到场后验收 → 自动转入售后
 * 权限：工程师执行节点 / 总部管理节点定义 / 代理商查看
 */
const express = require('express');
const router = express.Router();
const { getDbSync } = require('../db');
const { requireHeadquarters, logAudit: rawLogAudit } = require('../auth');
const regionFilter = require('../middleware/region-filter');

// 审计日志包装：从 req 提取 db/user 并正确传参
function logAudit(req, targetType, targetId, oldValue, newValue) {
  const db = getDbSync();
  const user = req.user;
  if (!user) return;
  rawLogAudit(db, user.id, user.username, user.role, '售中模块', targetType, targetId, oldValue, newValue);
}

// ===================== 节点定义管理（HQ only） =====================

// 列表
router.get('/node-defs', (req, res) => {
  try {
    const db = getDbSync();
    const rows = db.prepare('SELECT * FROM pre_sales_node_defs ORDER BY node_index').all();
    rows.forEach(r => {
      r.work_items = JSON.parse(r.work_items_json || '[]');
      r.required_materials = JSON.parse(r.required_materials_json || '[]');
      delete r.work_items_json;
      delete r.required_materials_json;
    });
    res.json({ data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 新增
router.post('/node-defs', requireHeadquarters, (req, res) => {
  try {
    const db = getDbSync();
    const { node_index, node_name, stage, is_remote, work_items, required_materials } = req.body;
    if (!node_index || !node_name || !stage) return res.status(400).json({ error: '缺少必填字段' });
    const itemsJson = JSON.stringify(work_items || []);
    const matsJson = JSON.stringify(required_materials || []);
    const r = db.prepare(
      'INSERT INTO pre_sales_node_defs (node_index,node_name,stage,is_remote,work_items_json,required_materials_json) VALUES (?,?,?,?,?,?)'
    ).run(node_index, node_name, stage, is_remote ? 1 : 0, itemsJson, matsJson);
    logAudit(req, '创建节点定义', null, null, JSON.stringify({ node_index, node_name }));
    res.json({ id: r.lastInsertRowid, message: '节点定义已创建' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 更新
router.put('/node-defs/:id', requireHeadquarters, (req, res) => {
  try {
    const db = getDbSync();
    const id = parseInt(req.params.id);
    const def = db.prepare('SELECT * FROM pre_sales_node_defs WHERE id=?').get(id);
    if (!def) return res.status(404).json({ error: '节点不存在' });
    const { node_index, node_name, stage, is_remote, work_items, required_materials } = req.body;
    const itemsJson = JSON.stringify(work_items || []);
    const matsJson = JSON.stringify(required_materials || []);
    db.prepare(
      'UPDATE pre_sales_node_defs SET node_index=?,node_name=?,stage=?,is_remote=?,work_items_json=?,required_materials_json=?,updated_at=datetime("now","localtime") WHERE id=?'
    ).run(node_index || def.node_index, node_name || def.node_name, stage || def.stage,
         is_remote !== undefined ? (is_remote ? 1 : 0) : def.is_remote, itemsJson, matsJson, id);
    logAudit(req, '更新节点定义', null, JSON.stringify(def), JSON.stringify({ node_index, node_name }));
    res.json({ message: '节点定义已更新' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除
router.delete('/node-defs/:id', requireHeadquarters, (req, res) => {
  try {
    const db = getDbSync();
    const id = parseInt(req.params.id);
    const def = db.prepare('SELECT * FROM pre_sales_node_defs WHERE id=?').get(id);
    if (!def) return res.status(404).json({ error: '节点不存在' });
    db.prepare('DELETE FROM pre_sales_node_defs WHERE id=?').run(id);
    logAudit(req, '删除节点定义', null, JSON.stringify(def), null);
    res.json({ message: '节点定义已删除' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 重新排序（一次性提交所有节点的新顺序）
router.post('/node-defs/reorder', requireHeadquarters, (req, res) => {
  try {
    const db = getDbSync();
    const { order } = req.body; // [{id:1,node_index:1},...]
    if (!Array.isArray(order)) return res.status(400).json({ error: '格式错误' });
    order.forEach(o => {
      db.prepare('UPDATE pre_sales_node_defs SET node_index=?,updated_at=datetime("now","localtime") WHERE id=?').run(o.node_index, o.id);
    });
    logAudit(req, '重排节点', null, null, JSON.stringify(order));
    res.json({ message: '顺序已更新' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===================== 售中项目管理 =====================

// 生成项目编号
function genProjectNo(db) {
  const today = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const seq = db.prepare("SELECT COUNT(*) as cnt FROM pre_sales_projects WHERE project_no LIKE 'XS_'||?||'%'").get(today).cnt;
  return `XS_${today}_${String(seq + 1).padStart(3, '0')}`;
}

// 项目列表
router.get('/projects', (req, res) => {
  try {
    const db = getDbSync();
    const user = req.user;
    if (!user) return res.status(401).json({ error: '未登录' });
    const { page = 1, page_size = 20, keyword, status, province } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(page_size);

    let where = [];
    let params = [];

    // 区域过滤器
    if (user.role === 'engineer') {
      where.push('psp.engineer_id = ?'); params.push(user.id);
    } else if (user.role !== 'headquarters') {
      const filter = regionFilter.buildRegionFilter(user, 'psp');
      if (filter.sql) { where.push(filter.sql.replace(/^\s*AND\s+/i, '')); params.push(...filter.params); }
    }

    if (keyword) { where.push('(psp.project_no LIKE ? OR psp.hospital_name LIKE ? OR u.real_name LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
    if (status) { where.push('psp.status = ?'); params.push(status); }
    if (province) { where.push('psp.province = ?'); params.push(province); }

    const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = db.prepare(`SELECT COUNT(*) as cnt FROM pre_sales_projects psp LEFT JOIN users u ON psp.engineer_id=u.id ${whereStr}`).get(...params).cnt;
    const rows = db.prepare(`
      SELECT psp.*, u.real_name as engineer_name, h.hospital_name as h_name
      FROM pre_sales_projects psp
      LEFT JOIN users u ON psp.engineer_id = u.id
      LEFT JOIN hospitals h ON psp.hospital_id = h.id
      ${whereStr} ORDER BY psp.created_at DESC LIMIT ? OFFSET ?
    `).all(...params, parseInt(page_size), offset);

    res.json({ total, page: parseInt(page), page_size: parseInt(page_size), data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 项目详情
router.get('/projects/:project_no', (req, res) => {
  try {
    const db = getDbSync();
    const row = db.prepare(`
      SELECT psp.*, u.real_name as engineer_name, u.phone as engineer_phone,
             h.hospital_name
      FROM pre_sales_projects psp
      LEFT JOIN users u ON psp.engineer_id = u.id
      LEFT JOIN hospitals h ON psp.hospital_id = h.id
      WHERE psp.project_no = ?
    `).get(req.params.project_no);
    if (!row) return res.status(404).json({ error: '项目不存在' });

    // 附加节点进度
    const nodes = db.prepare(`
      SELECT * FROM pre_sales_node_progress WHERE project_no=? ORDER BY node_index
    `).all(row.project_no);

    // 为每个节点附加工作点和材料
    for (const nd of nodes) {
      nd.work_items = db.prepare(
        'SELECT * FROM pre_sales_work_items WHERE node_progress_id=? ORDER BY item_index'
      ).all(nd.id);
      nd.materials = db.prepare(
        'SELECT * FROM pre_sales_materials WHERE node_progress_id=? ORDER BY uploaded_at DESC'
      ).all(nd.id);
    }
    row.nodes = nodes;

    // 附加问题列表
    row.issues = db.prepare(`
      SELECT psi.*, u.real_name as replyer_name
      FROM pre_sales_issues psi LEFT JOIN users u ON psi.reply_by = u.id
      WHERE psi.project_no=? ORDER BY psi.created_at DESC
    `).all(row.project_no);

    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 创建项目
router.post('/projects', (req, res) => {
  try {
    const db = getDbSync();
    const user = req.user;
    if (!user) return res.status(401).json({ error: '未登录' });
    const { hospital_id, hospital_mode, device_code, device_type, engineer_id,
            install_location, install_ip, install_device_info } = req.body;

    if (!engineer_id) return res.status(400).json({ error: '缺少必填字段(负责工程师)' });

    // 验证工程师存在且属于当前供应商体系
    const engineer = db.prepare('SELECT * FROM users WHERE id=? AND role=?').get(engineer_id, 'engineer');
    if (!engineer) return res.status(404).json({ error: '指定工程师不存在' });

    // 权限校验：代理商只能指派自己下属的工程师
    if (user.role !== 'headquarters') {
      if (engineer.parent_agent_id !== user.id && engineer.parent_agent_id !== user.parent_agent_id) {
        // 代理商的工程师 parent_agent_id 指向其直接上级代理商
        // 允许省代指派其直属市代下的工程师
        if (user.role === 'provincial_agent') {
          const ok = db.prepare('SELECT id FROM users WHERE id=? AND parent_agent_id=?').get(engineer.parent_agent_id, user.id);
          if (!ok) return res.status(403).json({ error: '无权指定非下属工程师' });
        } else {
          return res.status(403).json({ error: '无权指定非下属工程师' });
        }
      }
    }

    // 确定医院
    let hospital;
    if (hospital_mode === 'new') {
      // 模式2：新建医院 + 新建项目同步创建
      const { hospital_name, province, city, address, contact_person, contact_phone } = req.body;
      if (!hospital_name || !province || !city) return res.status(400).json({ error: '新建医院需填写名称、省份、城市' });
      const dup = db.prepare('SELECT id FROM hospitals WHERE hospital_name = ?').get(hospital_name);
      if (dup) return res.status(400).json({ error: `医院"${hospital_name}"已存在，请选择已有医院` });

      const cnt = db.prepare('SELECT COUNT(*) as cnt FROM hospitals').get().cnt;
      const hospital_code = 'H' + String(cnt + 1).padStart(3, '0');
      const region = require('../db').getRegion(province);

      // 确定 supplierId：工程师创建时归属其上级代理商
      let supplierId = null;
      if (user.role === 'provincial_agent' || user.role === 'city_agent') {
        supplierId = user.id;
      } else if (user.role === 'engineer') {
        supplierId = user.parent_agent_id;
      } else if (user.role === 'headquarters') {
        // 总部创建时，使用工程师的上级代理商
        supplierId = engineer.parent_agent_id;
      }
      db.prepare(`
        INSERT INTO hospitals (hospital_code, hospital_name, province, city, region, address, contact_person,
          contact_phone, supplier_id, engineer_id, source)
        VALUES (?,?,?,?,?,?,?,?,?,?,'pre_sales')`
      ).run(hospital_code, hospital_name, province, city, region, address||'', contact_person||'',
            contact_phone||'', supplierId, engineer_id);
      hospital = db.prepare('SELECT * FROM hospitals WHERE hospital_code=?').get(hospital_code);
    } else {
      // 模式1：选择已有医院
      if (!hospital_id) return res.status(400).json({ error: '缺少必填字段(医院)' });
      hospital = db.prepare('SELECT * FROM hospitals WHERE id=?').get(hospital_id);
      if (!hospital) return res.status(404).json({ error: '医院不存在' });
      // 自动绑定该医院的负责工程师与供应商（如果尚未设置）
      if (!hospital.engineer_id || !hospital.supplier_id) {
        db.prepare(`UPDATE hospitals SET engineer_id=?, supplier_id=? WHERE id=?`)
          .run(engineer_id, engineer.parent_agent_id, hospital.id);
        hospital.engineer_id = engineer_id;
        hospital.supplier_id = engineer.parent_agent_id;
      }
    }

    // 设备编号唯一校验
    if (device_code) {
      const dupeq = db.prepare("SELECT project_no,status FROM pre_sales_projects WHERE device_code=? AND status NOT IN ('已取消')").get(device_code);
      if (dupeq) return res.status(400).json({ error: `设备编号${device_code}已在项目${dupeq.project_no}中使用` });
    }

    const project_no = genProjectNo(db);
    const loc = hospital.province ? `${hospital.province}${hospital.city||''}${hospital.address||''}` : '';
    db.prepare(`
      INSERT INTO pre_sales_projects (project_no,hospital_id,device_code,device_type,engineer_id,
        hospital_name,province,city,region,status,install_location,install_ip,install_device_info)
      VALUES (?,?,?,?,?,?,?,?,?,'进行中',?,?,?)
    `).run(project_no, hospital.id, device_code||null, device_type||null, engineer_id,
           hospital.hospital_name, hospital.province||null, hospital.city||null,
           require('../db').getRegion(hospital.province)||null,
           install_location||null, install_ip||null, install_device_info||null);

    // 根据节点定义自动创建节点进度
    const nodeDefs = db.prepare('SELECT * FROM pre_sales_node_defs ORDER BY node_index').all();
    nodeDefs.forEach(def => {
      const npr = db.prepare(`
        INSERT INTO pre_sales_node_progress (project_no,node_def_id,node_index,node_name,stage,is_remote,status)
        VALUES (?,?,?,?,?,?,?)
      `).run(project_no, def.id, def.node_index, def.node_name, def.stage, def.is_remote,
             def.node_index === 1 ? '进行中' : '未开始');

      const workItems = JSON.parse(def.work_items_json || '[]');
      workItems.forEach((item, idx) => {
        db.prepare(
          'INSERT INTO pre_sales_work_items (node_progress_id,item_index,item_name) VALUES (?,?,?)'
        ).run(npr.lastInsertRowid, idx, typeof item === 'string' ? item : item.name || item);
      });
    });

    logAudit(req, '创建项目', null, null, JSON.stringify({ project_no, hospital_id:hospital.id, hospital_mode, engineer_id }));
    res.json({ project_no, hospital_id: hospital.id, hospital_name: hospital.hospital_name, message: '售中项目已创建' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 取消项目
router.post('/projects/:project_no/cancel', (req, res) => {
  try {
    const db = getDbSync();
    const proj = db.prepare('SELECT * FROM pre_sales_projects WHERE project_no=?').get(req.params.project_no);
    if (!proj) return res.status(404).json({ error: '项目不存在' });
    if (proj.status === '已转入售后') return res.status(400).json({ error: '已转入售后，无法取消' });
    db.prepare("UPDATE pre_sales_projects SET status='已取消',updated_at=datetime('now','localtime') WHERE project_no=?").run(proj.project_no);
    logAudit(req, '取消项目', proj.project_no, null, null);
    res.json({ message: '项目已取消' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===================== 节点操作 =====================

// 工作点切换
router.post('/nodes/:nodeId/work-items/:itemId/toggle', (req, res) => {
  try {
    const db = getDbSync();
    const wi = db.prepare('SELECT * FROM pre_sales_work_items WHERE id=?').get(req.params.itemId);
    if (!wi) return res.status(404).json({ error: '工作点不存在' });
    const newCompleted = wi.completed ? 0 : 1;
    db.prepare('UPDATE pre_sales_work_items SET completed=?,completed_at=datetime("now","localtime") WHERE id=?')
      .run(newCompleted, wi.id);
    res.json({ completed: newCompleted, message: newCompleted ? '已完成' : '已撤销' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 完成节点（检查所有工作点 + 材料）
router.post('/nodes/:nodeId/complete', (req, res) => {
  try {
    const db = getDbSync();
    const nd = db.prepare('SELECT * FROM pre_sales_node_progress WHERE id=?').get(req.params.nodeId);
    if (!nd) return res.status(404).json({ error: '节点不存在' });

    // 检查该节点的工作点是否全部完成
    const allItems = db.prepare('SELECT * FROM pre_sales_work_items WHERE node_progress_id=?').all(nd.id);
    const allDone = allItems.every(w => w.completed);
    if (!allDone) return res.status(400).json({ error: '请先完成所有工作点' });

    // 检查当前节点需要的材料是否已上传
    const def = db.prepare('SELECT required_materials_json FROM pre_sales_node_defs WHERE id=?').get(nd.node_def_id);
    if (def) {
      const mats = JSON.parse(def.required_materials_json || '[]');
      const uploaded = db.prepare('SELECT COUNT(*) as cnt FROM pre_sales_materials WHERE node_progress_id=?').get(nd.id).cnt;
      if (mats.length > 0 && uploaded === 0) return res.status(400).json({ error: '请上传必填材料后再完成节点' });
    }

    // 标记当前节点完成
    db.prepare("UPDATE pre_sales_node_progress SET status='已完成',completed_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE id=?")
      .run(nd.id);

    // 如果有下一个节点，解锁它
    const nextNd = db.prepare("SELECT * FROM pre_sales_node_progress WHERE project_no=? AND node_index=?")
      .get(nd.project_no, nd.node_index + 1);
    if (nextNd) {
      db.prepare("UPDATE pre_sales_node_progress SET status='进行中',started_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE id=?")
        .run(nextNd.id);
    }

    // 更新项目完成度和当前节点
    const allNodes = db.prepare('SELECT * FROM pre_sales_node_progress WHERE project_no=?').all(nd.project_no);
    const doneCount = allNodes.filter(n => n.status === '已完成').length;
    const pct = Math.round((doneCount / allNodes.length) * 100);
    db.prepare("UPDATE pre_sales_projects SET completion_percent=?,current_node_index=?,updated_at=datetime('now','localtime') WHERE project_no=?")
      .run(pct, Math.min(doneCount + 1, allNodes.length), nd.project_no);

    // 如果所有节点完成，自动标记为已验收并同步售后
    if (pct === 100) {
      const proj = db.prepare('SELECT * FROM pre_sales_projects WHERE project_no=?').get(nd.project_no);
      db.prepare("UPDATE pre_sales_projects SET status='已验收',acceptance_passed=1,accepted_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE project_no=?")
        .run(nd.project_no);

      // 售中→售后自动顺延：同步医院工程师归属与设备档案
      if (proj && proj.engineer_id && proj.hospital_id) {
        const eng = db.prepare('SELECT parent_agent_id FROM users WHERE id=?').get(proj.engineer_id);
        db.prepare(`UPDATE hospitals SET engineer_id=?, supplier_id=COALESCE(supplier_id,?), updated_at=datetime('now','localtime') WHERE id=?`)
          .run(proj.engineer_id, eng ? eng.parent_agent_id : null, proj.hospital_id);

        if (proj.device_code) {
          const existDev = db.prepare('SELECT * FROM devices WHERE device_code=?').get(proj.device_code);
          if (!existDev) {
            db.prepare(`
              INSERT INTO devices (device_code,device_type,hospital_id,status,install_date,
                install_location,ip_address,created_at,updated_at)
              VALUES (?,?,?,'在线',datetime('now','localtime'),?,?,datetime('now','localtime'),datetime('now','localtime'))
            `).run(proj.device_code, proj.device_type||'台式', proj.hospital_id,
                   proj.install_location||null, proj.install_ip||null);
            console.log(`[售中→售后] 设备 ${proj.device_code} 自动创建档案`);
          }
        }
      }
    }

    logAudit(req, '完成节点', nd.project_no, null, `节点${nd.node_index}:${nd.node_name}`);
    res.json({ message: '节点已完成', node_index: nd.node_index });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 撤销节点完成
router.post('/nodes/:nodeId/undo', (req, res) => {
  try {
    const db = getDbSync();
    const nd = db.prepare('SELECT * FROM pre_sales_node_progress WHERE id=?').get(req.params.nodeId);
    if (!nd) return res.status(404).json({ error: '节点不存在' });

    db.prepare("UPDATE pre_sales_node_progress SET status='进行中',completed_at=NULL,materials_uploaded=0,updated_at=datetime('now','localtime') WHERE id=?")
      .run(nd.id);

    // 锁定后续节点
    db.prepare("UPDATE pre_sales_node_progress SET status='未开始',started_at=NULL,updated_at=datetime('now','localtime') WHERE project_no=? AND node_index>?")
      .run(nd.project_no, nd.node_index);

    // 重新计算完成度
    const allNodes = db.prepare('SELECT * FROM pre_sales_node_progress WHERE project_no=?').all(nd.project_no);
    const doneCount = allNodes.filter(n => n.status === '已完成').length;
    const pct = Math.round((doneCount / allNodes.length) * 100);
    db.prepare("UPDATE pre_sales_projects SET completion_percent=?,current_node_index=?,status=?,updated_at=datetime('now','localtime') WHERE project_no=?")
      .run(pct, nd.node_index, pct < 100 ? '进行中' : '已验收', nd.project_no);

    logAudit(req, '撤销节点', nd.project_no, null, `节点${nd.node_index}`);
    res.json({ message: '已撤销', node_index: nd.node_index });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===================== 材料上传 =====================
// 注意：实际文件上传在 server.js 的 multer 中间件处理，此路由接收上传后的文件名
router.post('/nodes/:nodeId/materials', (req, res) => {
  try {
    const db = getDbSync();
    const nd = db.prepare('SELECT * FROM pre_sales_node_progress WHERE id=?').get(req.params.nodeId);
    if (!nd) return res.status(404).json({ error: '节点不存在' });
    const { file_name, file_path, file_type } = req.body;
    if (!file_name || !file_path) return res.status(400).json({ error: '缺少文件名或路径' });

    db.prepare('INSERT INTO pre_sales_materials (node_progress_id,file_name,file_path,file_type) VALUES (?,?,?,?)')
      .run(nd.id, file_name, file_path, file_type || 'image');
    db.prepare('UPDATE pre_sales_node_progress SET materials_uploaded=1,updated_at=datetime("now","localtime") WHERE id=?')
      .run(nd.id);

    res.json({ message: '材料已上传' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除材料
router.delete('/nodes/:nodeId/materials/:matId', (req, res) => {
  try {
    const db = getDbSync();
    const mat = db.prepare('SELECT psm.*, psnp.project_no FROM pre_sales_materials psm JOIN pre_sales_node_progress psnp ON psm.node_progress_id=psnp.id WHERE psm.id=?').get(req.params.matId);
    if (!mat) return res.status(404).json({ error: '材料不存在' });

    // 尝试删除文件
    const fs = require('fs');
    const fullPath = require('path').join(__dirname, '..', '..', 'data', 'uploads', mat.file_path);
    try { if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath); } catch (e) {}

    db.prepare('DELETE FROM pre_sales_materials WHERE id=?').run(mat.id);
    res.json({ message: '已删除' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===================== 问题上报 =====================

// 上报问题
router.post('/nodes/:nodeId/issues', (req, res) => {
  try {
    const db = getDbSync();
    const user = req.user;
    if (!user) return res.status(401).json({ error: '未登录' });
    const nd = db.prepare('SELECT * FROM pre_sales_node_progress WHERE id=?').get(req.params.nodeId);
    if (!nd) return res.status(404).json({ error: '节点不存在' });
    const { issue_text, issue_photos } = req.body;
    if (!issue_text || issue_text.trim().length < 2) return res.status(400).json({ error: '请输入问题描述(≥2字)' });

    const r = db.prepare(
      'INSERT INTO pre_sales_issues (project_no,node_progress_id,reporter_id,reporter_name,issue_text,issue_photos) VALUES (?,?,?,?,?,?)'
    ).run(nd.project_no, nd.id, user.id, user.real_name || user.username, issue_text, issue_photos || null);

    logAudit(req, '上报问题', nd.project_no, null, issue_text.substring(0, 50));
    res.json({ id: r.lastInsertRowid, message: '问题已上报' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 回复问题（HQ only）
router.post('/issues/:id/reply', requireHeadquarters, (req, res) => {
  try {
    const db = getDbSync();
    const issue = db.prepare('SELECT * FROM pre_sales_issues WHERE id=?').get(req.params.id);
    if (!issue) return res.status(404).json({ error: '问题不存在' });
    const { reply_text } = req.body;
    if (!reply_text || reply_text.trim().length < 1) return res.status(400).json({ error: '回复内容不能为空' });

    db.prepare(
      "UPDATE pre_sales_issues SET reply_text=?,reply_by=?,reply_at=datetime('now','localtime'),status='已回复',updated_at=datetime('now','localtime') WHERE id=?"
    ).run(reply_text, req.user.id, issue.id);

    logAudit(req, '回复问题', issue.project_no, null, reply_text.substring(0, 50));
    res.json({ message: '已回复' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 闭环问题
router.post('/issues/:id/close', (req, res) => {
  try {
    const db = getDbSync();
    const issue = db.prepare('SELECT * FROM pre_sales_issues WHERE id=?').get(req.params.id);
    if (!issue) return res.status(404).json({ error: '问题不存在' });
    if (issue.status !== '已回复') return res.status(400).json({ error: '请等待总部回复后再闭环' });
    db.prepare("UPDATE pre_sales_issues SET status='已闭环',updated_at=datetime('now','localtime') WHERE id=?").run(issue.id);
    logAudit(req, '闭环问题', issue.project_no, null, `#${issue.id}`);
    res.json({ message: '问题已闭环' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===================== 接入售后 =====================
router.post('/projects/:project_no/handoff', (req, res) => {
  try {
    const db = getDbSync();
    const proj = db.prepare('SELECT * FROM pre_sales_projects WHERE project_no=?').get(req.params.project_no);
    if (!proj) return res.status(404).json({ error: '项目不存在' });
    if (proj.status !== '已验收') return res.status(400).json({ error: '请先完成全部节点验收' });
    if (proj.status === '已转入售后') return res.status(400).json({ error: '已转入售后' });
    if (!proj.acceptance_passed) return res.status(400).json({ error: '最终验收未通过' });

    // 同步医院负责人（工程师归属）
    if (proj.engineer_id && proj.hospital_id) {
      const eng = db.prepare('SELECT parent_agent_id FROM users WHERE id=?').get(proj.engineer_id);
      db.prepare(`UPDATE hospitals SET engineer_id=?, supplier_id=COALESCE(supplier_id,?), updated_at=datetime('now','localtime') WHERE id=?`)
        .run(proj.engineer_id, eng ? eng.parent_agent_id : null, proj.hospital_id);
    }
    if (proj.device_code) {
      const existingDevice = db.prepare('SELECT * FROM devices WHERE device_code=?').get(proj.device_code);
      if (!existingDevice) {
        // 自动创建设备档案，带入售中记录的安装信息
        db.prepare(`
          INSERT INTO devices (device_code,device_type,hospital_id,status,install_date,
            install_location,ip_address,created_at,updated_at)
          VALUES (?,?,?,'在线',datetime('now','localtime'),?,?,datetime('now','localtime'),datetime('now','localtime'))
        `).run(proj.device_code, proj.device_type || '台式', proj.hospital_id,
               proj.install_location || null, proj.install_ip || null);
        console.log(`[售中→售后] 设备 ${proj.device_code} 自动创建档案`);
      }
    }

    db.prepare("UPDATE pre_sales_projects SET status='已转入售后',closed_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE project_no=?")
      .run(proj.project_no);

    logAudit(req, '转入售后', proj.project_no, null, `设备:${proj.device_code||'未指定'}`);
    res.json({ message: '已成功转入售后模块' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 文件上传在 server.js 中注册（带 multer 中间件），此处不重复定义

module.exports = router;