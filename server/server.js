/**
 * 麻精药品智能柜售后运维工具 - 后端服务
 * 技术栈：Node.js + Express + sql.js (SQLite)
 */

const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { getDbSync, initDb } = require('./db');
const { getRegion } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');

// ======================= 中间件 =======================
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'web')));
app.use(session({
  secret: 'yt-asmt-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 3600 * 1000 }
}));

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ======================= 认证中间件 =======================
function authMiddleware(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: '未登录' });
  const db = getDbSync();
  const user = db.prepare('SELECT id, username, role, real_name FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(401).json({ error: '用户不存在' });
  req.user = user;
  next();
}

// ======================= 登录 =======================
app.post('/api/auth/login', async (req, res) => {
  try {
    const db = getDbSync();
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
    const user = db.prepare('SELECT id, username, role, real_name, password_hash FROM users WHERE username = ?').get(username);
    if (!user) return res.status(401).json({ error: '用户名或密码错误' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: '用户名或密码错误' });
    delete user.password_hash;
    req.session.userId = user.id;
    res.json({ token: 'session', user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ======================= 售中管理（Pre-Sales） =======================
// 节点定义列表
app.get('/api/pre-sales/node-defs', authMiddleware, (req, res) => {
  const db = getDbSync();
  const rows = db.prepare('SELECT * FROM pre_sales_node_defs ORDER BY node_index').all();
  rows.forEach(r => { try { r.work_items = JSON.parse(r.work_items); } catch { r.work_items = []; } try { r.required_materials = JSON.parse(r.required_materials); } catch { r.required_materials = []; } });
  res.json({ data: rows });
});

// 项目列表
app.get('/api/pre-sales/projects', authMiddleware, (req, res) => {
  const db = getDbSync(); const user = req.user;
  const { keyword, status, page = 1, page_size = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(page_size);
  let where = []; let params = [];
  if (user.role === 'engineer') { where.push('psp.engineer_id = ?'); params.push(user.id); }
  else if (user.role !== 'headquarters') {
    if (user.province) { where.push('psp.province = ?'); params.push(user.province); }
  }
  if (status) { where.push('psp.status = ?'); params.push(status); }
  if (keyword) { where.push('(psp.project_no LIKE ? OR psp.hospital_name LIKE ?)'); params.push('%' + keyword + '%', '%' + keyword + '%'); }
  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare('SELECT COUNT(*) as cnt FROM pre_sales_projects psp ' + whereStr).get(...params).cnt;
  const rows = db.prepare('SELECT psp.*, u.real_name as engineer_name FROM pre_sales_projects psp LEFT JOIN users u ON psp.engineer_id = u.id ' + whereStr + ' ORDER BY psp.created_at DESC LIMIT ? OFFSET ?').all(...params, parseInt(page_size), offset);
  res.json({ total, page: parseInt(page), page_size: parseInt(page_size), data: rows });
});

// 创建项目
app.post('/api/pre-sales/projects', authMiddleware, (req, res) => {
  const db = getDbSync(); const user = req.user;
  const { hospital_id, hospital_name, province, city, region, address, device_code, device_type, engineer_id, install_location, install_ip } = req.body;
  let hId = hospital_id;
  if (!hId && hospital_name) {
    const exist = db.prepare('SELECT id FROM hospitals WHERE hospital_name = ?').get(hospital_name);
    if (exist) { hId = exist.id; }
    else {
      const hc = 'H' + Date.now().toString(36).toUpperCase();
      db.prepare('INSERT INTO hospitals (hospital_code,hospital_name,province,city,region,address,created_at) VALUES (?,?,?,?,?,?,?)')
        .run(hc, hospital_name, province || '', city || '', region || '', address || '', new Date().toISOString());
      hId = db.prepare('SELECT last_insert_rowid() as id').get().id;
    }
  }
  if (!hId) return res.status(400).json({ error: '医院不能为空' });
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const cnt = db.prepare("SELECT COUNT(*) as c FROM pre_sales_projects WHERE project_no LIKE 'XS_' || ? || '_%'").get(today).c;
  const project_no = 'XS_' + today + '_' + String(cnt + 1).padStart(3, '0');
  const hosp = db.prepare('SELECT * FROM hospitals WHERE id = ?').get(hId);
  db.prepare('INSERT INTO pre_sales_projects (project_no,hospital_id,device_code,device_type,engineer_id,hospital_name,province,city,region,status,completion_percent,current_node_index,install_location,install_ip,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,0,0,?,?,?)')
    .run(project_no, hId, device_code || '', device_type || '', engineer_id || null, hosp.hospital_name, hosp.province || '', hosp.city || '', hosp.region || '', '进行中', install_location || '', install_ip || '', new Date().toISOString());

  // 创建节点进度
  const defs = db.prepare('SELECT * FROM pre_sales_node_defs ORDER BY node_index').all();
  for (const d of defs) {
    db.prepare('INSERT INTO pre_sales_node_progress (project_no,node_index,status) VALUES (?,?,?)').run(project_no, d.node_index, d.node_index === 1 ? '进行中' : '待开始');
    const items = JSON.parse(d.work_items || '[]');
    for (let i = 0; i < items.length; i++) {
      db.prepare('INSERT INTO pre_sales_work_items (project_no,node_index,item_index,item_text,toggled) VALUES (?,?,?,?,0)').run(project_no, d.node_index, i, items[i]);
    }
  }
  res.json({ project_no, message: '项目已创建' });
});

// 项目详情
app.get('/api/pre-sales/projects/:project_no', authMiddleware, (req, res) => {
  const db = getDbSync(); const { project_no } = req.params;
  const proj = db.prepare('SELECT psp.*, u.real_name as engineer_name FROM pre_sales_projects psp LEFT JOIN users u ON psp.engineer_id = u.id WHERE psp.project_no = ?').get(project_no);
  if (!proj) return res.status(404).json({ error: '项目不存在' });
  const nodes = db.prepare('SELECT d.*, p.status as progress_status FROM pre_sales_node_defs d LEFT JOIN pre_sales_node_progress p ON d.node_index = p.node_index AND p.project_no = ? ORDER BY d.node_index').all(project_no);
  for (const n of nodes) {
    try { n.work_items = JSON.parse(n.work_items); } catch { n.work_items = []; }
    try { n.required_materials = JSON.parse(n.required_materials); } catch { n.required_materials = []; }
    const wItems = db.prepare('SELECT * FROM pre_sales_work_items WHERE project_no = ? AND node_index = ? ORDER BY item_index').all(project_no, n.node_index);
    n.work_items_detail = wItems;
  }
  proj.nodes = nodes;
  // 问题列表
  proj.issues = db.prepare('SELECT * FROM pre_sales_issues WHERE project_no = ? ORDER BY created_at DESC').all(project_no);
  res.json(proj);
});

// 完成节点
app.post('/api/pre-sales/nodes/:node_index/complete', authMiddleware, (req, res) => {
  const db = getDbSync(); const { node_index } = req.params;
  const { project_no } = req.body;
  if (!project_no) return res.status(400).json({ error: '项目号不能为空' });
  // 检查所有工作点
  const wItems = db.prepare('SELECT * FROM pre_sales_work_items WHERE project_no = ? AND node_index = ?').all(project_no, parseInt(node_index));
  if (wItems.some(w => !w.toggled)) return res.status(400).json({ error: '请先完成所有工作点' });
  db.prepare('UPDATE pre_sales_node_progress SET status = ?, completed_at = datetime("now","localtime") WHERE project_no = ? AND node_index = ?')
    .run('已完成', project_no, parseInt(node_index));
  // 解锁下一节点
  const nextIdx = parseInt(node_index) + 1;
  const nextDef = db.prepare('SELECT * FROM pre_sales_node_defs WHERE node_index = ?').get(nextIdx);
  if (nextDef) {
    db.prepare('UPDATE pre_sales_node_progress SET status = ? WHERE project_no = ? AND node_index = ?').run('进行中', project_no, nextIdx);
  }
  // 更新进度百分比
  const totalNodes = db.prepare('SELECT COUNT(*) as c FROM pre_sales_node_defs').get().c;
  const completed = db.prepare("SELECT COUNT(*) as c FROM pre_sales_node_progress WHERE project_no = ? AND status = '已完成'").get(project_no).c;
  const percent = Math.round((completed / totalNodes) * 100);
  db.prepare('UPDATE pre_sales_projects SET completion_percent = ?, current_node_index = ?, updated_at = ? WHERE project_no = ?')
    .run(percent, parseInt(node_index), new Date().toISOString(), project_no);
  // 全部完成
  if (percent >= 100) {
    db.prepare('UPDATE pre_sales_projects SET status = ?, updated_at = ? WHERE project_no = ?').run('已完成', new Date().toISOString(), project_no);
  }
  res.json({ success: true, completion_percent: percent });
});

// 最终验收
app.post('/api/pre-sales/nodes/:node_index/verify', authMiddleware, (req, res) => {
  const db = getDbSync(); const { node_index } = req.params;
  const { project_no } = req.body;
  if (!project_no) return res.status(400).json({ error: '项目号不能为空' });
  const proj = db.prepare('SELECT * FROM pre_sales_projects WHERE project_no = ?').get(project_no);
  if (!proj) return res.status(404).json({ error: '项目不存在' });
  // 验收
  db.prepare('UPDATE pre_sales_node_progress SET status = ?, verified_at = datetime("now","localtime") WHERE project_no = ? AND node_index = ?')
    .run('已验收', project_no, parseInt(node_index));
  const totalNodes = db.prepare('SELECT COUNT(*) as c FROM pre_sales_node_defs').get().c;
  if (parseInt(node_index) === totalNodes) {
    db.prepare('UPDATE pre_sales_projects SET acceptance_passed = 1, accepted_at = datetime("now","localtime"), updated_at = ? WHERE project_no = ?')
      .run(new Date().toISOString(), project_no);
  }
  res.json({ success: true, message: '验收通过' });
});

// 售后移交
app.post('/api/pre-sales/projects/:project_no/handoff', authMiddleware, (req, res) => {
  const db = getDbSync(); const { project_no } = req.params;
  const proj = db.prepare('SELECT * FROM pre_sales_projects WHERE project_no = ?').get(project_no);
  if (!proj) return res.status(404).json({ error: '项目不存在' });
  if (!proj.acceptance_passed) return res.status(400).json({ error: '请先完成最终验收' });
  // 创建/更新设备档案
  const existDev = db.prepare('SELECT * FROM devices WHERE device_code = ?').get(proj.device_code);
  if (!existDev) {
    db.prepare('INSERT INTO devices (device_code,device_type,serial_number,hospital_id,install_location,ip_address,status,install_date,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(proj.device_code, proj.device_type, '', proj.hospital_id, proj.install_location || '', proj.install_ip || '', '在线', new Date().toISOString().slice(0, 10), new Date().toISOString());
  }
  // 更新医院负责人
  db.prepare('UPDATE hospitals SET responsible_person = (SELECT real_name FROM users WHERE id = ?), responsible_phone = (SELECT phone FROM users WHERE id = ?), updated_at = ? WHERE id = ?')
    .run(proj.engineer_id, proj.engineer_id, new Date().toISOString(), proj.hospital_id);
  db.prepare('UPDATE pre_sales_projects SET status = ?, closed_at = datetime("now","localtime"), updated_at = ? WHERE project_no = ?')
    .run('已移交', new Date().toISOString(), project_no);
  res.json({ success: true, message: '已移交售后' });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ message: '已退出登录' }));
});

// ======================= 设备型号管理（HQ） =======================
app.get('/api/device-models', authMiddleware, (req, res) => {
  const db = getDbSync();
  const { keyword, status, page = 1, page_size = 50 } = req.query;
  let where = []; let params = [];
  if (keyword) { where.push('(model_code LIKE ? OR model_name LIKE ?)'); params.push('%' + keyword + '%', '%' + keyword + '%'); }
  if (status === 'active' || status === 'discontinued') { where.push('status = ?'); params.push(status); }
  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare('SELECT COUNT(*) as cnt FROM device_models ' + whereStr).get(...params).cnt;
  const offset = (parseInt(page) - 1) * parseInt(page_size);
  const rows = db.prepare('SELECT * FROM device_models ' + whereStr + ' ORDER BY created_at DESC LIMIT ? OFFSET ?').all(...params, parseInt(page_size), offset);
  res.json({ total, page: parseInt(page), page_size: parseInt(page_size), data: rows });
});

app.post('/api/device-models', authMiddleware, (req, res) => {
  if (req.user.role !== 'headquarters') return res.status(403).json({ error: '仅总部可操作' });
  const db = getDbSync();
  const { model_code, model_name, device_type, manufacturer, specification, description } = req.body;
  if (!model_code || !model_name) return res.status(400).json({ error: '型号编码和名称为必填' });
  const exist = db.prepare('SELECT id FROM device_models WHERE model_code = ?').get(model_code);
  if (exist) return res.status(400).json({ error: '型号编码已存在' });
  db.prepare('INSERT INTO device_models (model_code,model_name,device_type,manufacturer,specification,description) VALUES (?,?,?,?,?,?)')
    .run(model_code, model_name, device_type || '', manufacturer || '', specification || '', description || '');
  res.json({ message: '已添加' });
});

app.patch('/api/device-models/:model_code', authMiddleware, (req, res) => {
  if (req.user.role !== 'headquarters') return res.status(403).json({ error: '仅总部可操作' });
  const db = getDbSync();
  const { model_name, device_type, manufacturer, specification, description, status } = req.body;
  const fields = []; const vals = [];
  if (model_name !== undefined) { fields.push('model_name = ?'); vals.push(model_name); }
  if (device_type !== undefined) { fields.push('device_type = ?'); vals.push(device_type); }
  if (manufacturer !== undefined) { fields.push('manufacturer = ?'); vals.push(manufacturer); }
  if (specification !== undefined) { fields.push('specification = ?'); vals.push(specification); }
  if (description !== undefined) { fields.push('description = ?'); vals.push(description); }
  if (status !== undefined) { fields.push('status = ?'); vals.push(status); }
  fields.push('updated_at = datetime("now","localtime")');
  vals.push(req.params.model_code);
  db.prepare('UPDATE device_models SET ' + fields.join(',') + ' WHERE model_code = ?').run(...vals);
  res.json({ message: '已保存' });
});

app.delete('/api/device-models/:model_code', authMiddleware, (req, res) => {
  if (req.user.role !== 'headquarters') return res.status(403).json({ error: '仅总部可操作' });
  const db = getDbSync();
  const bound = db.prepare('SELECT COUNT(*) as c FROM devices WHERE device_type = ?').get(req.params.model_code).c;
  if (bound > 0) return res.status(400).json({ error: '有设备绑定了该型号，禁止删除' });
  db.prepare('DELETE FROM device_models WHERE model_code = ?').run(req.params.model_code);
  res.json({ message: '已删除' });
});

// ======================= 仪表盘 =======================
app.get('/api/dashboard', authMiddleware, (req, res) => {
  const db = getDbSync();
  const user = req.user;

  let faultWhere = ''; let faultParams = [];
  if (user.role === 'engineer') { faultWhere = 'WHERE engineer_id = ?'; faultParams.push(user.id); }

  const faultStats = db.prepare('SELECT ' +
    "SUM(CASE WHEN status = '待处理' THEN 1 ELSE 0 END) as pending," +
    "SUM(CASE WHEN status = '处理中' THEN 1 ELSE 0 END) as processing," +
    "SUM(CASE WHEN status = '待复核' THEN 1 ELSE 0 END) as review," +
    "SUM(CASE WHEN status = '已闭环' THEN 1 ELSE 0 END) as closed " +
    'FROM fault_orders ' + faultWhere).get(...faultParams);

  let deviceWhere = ''; let deviceParams = [];
  if (user.role === 'engineer') { deviceWhere = 'WHERE engineer_id = ?'; deviceParams.push(user.id); }

  const deviceStats = db.prepare('SELECT ' +
    "SUM(CASE WHEN status = '在线' THEN 1 ELSE 0 END) as online," +
    "SUM(CASE WHEN status = '离线' THEN 1 ELSE 0 END) as offline," +
    "SUM(CASE WHEN status = '维修中' THEN 1 ELSE 0 END) as maintenance," +
    "SUM(CASE WHEN status = '已报废' THEN 1 ELSE 0 END) as scrapped " +
    'FROM devices ' + deviceWhere).get(...deviceParams);

  let inspFilter = ''; let inspParams = [];
  if (user.role === 'engineer') {
    inspFilter = "AND responsible_engineer_id = ?";
    inspParams.push(user.id);
  } else if (user.role !== 'headquarters') {
    inspFilter = "AND responsible_engineer_id = ?";
    inspParams.push(user.id);
  }
  const inspCnt = db.prepare("SELECT COUNT(*) as cnt FROM inspection_plans WHERE next_inspection_date <= date('now','localtime','+3 days') AND status = '进行中' " + inspFilter).get(...inspParams);

  res.json({
    faults: faultStats || {},
    devices: deviceStats || {},
    pendingInspection: inspCnt ? inspCnt.cnt : 0
  });
});

// ======================= 工单管理 =======================
app.get('/api/fault-orders', authMiddleware, (req, res) => {
  const db = getDbSync(); const user = req.user;
  const { status, keyword, page = 1, page_size = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(page_size);
  let where = []; let params = [];

  if (user.role === 'engineer') { where.push('f.engineer_id = ?'); params.push(user.id); }
  else if (user.role !== 'headquarters') {
    const region = getRegion(user);
    if (region) { where.push("h.province = ?"); params.push(region); }
  }
  if (status) { where.push('f.status = ?'); params.push(status); }
  if (keyword) { where.push('(f.fault_no LIKE ? OR f.description LIKE ? OR h.hospital_name LIKE ?)'); params.push('%' + keyword + '%', '%' + keyword + '%', '%' + keyword + '%'); }

  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare('SELECT COUNT(*) as cnt FROM fault_orders f LEFT JOIN devices d ON f.device_code = d.device_code LEFT JOIN hospitals h ON d.hospital_id = h.id ' + whereStr).get(...params).cnt;
  const rows = db.prepare('SELECT f.*, d.device_type, h.hospital_name, u.real_name as engineer_name ' +
    'FROM fault_orders f LEFT JOIN devices d ON f.device_code = d.device_code LEFT JOIN hospitals h ON d.hospital_id = h.id LEFT JOIN users u ON f.engineer_id = u.id ' +
    whereStr + ' ORDER BY f.created_at DESC LIMIT ? OFFSET ?').all(...params, parseInt(page_size), offset);
  res.json({ total, page: parseInt(page), page_size: parseInt(page_size), data: rows });
});

app.post('/api/fault-orders', authMiddleware, (req, res) => {
  const db = getDbSync(); const user = req.user;
  const { device_code, description, contact_person, contact_phone } = req.body;
  if (!device_code || !description) return res.status(400).json({ error: '设备编码和故障描述不能为空' });
  if (description.length < 10) return res.status(400).json({ error: '故障描述至少10个字符' });

  const device = db.prepare('SELECT * FROM devices WHERE device_code = ?').get(device_code);
  if (!device) return res.status(400).json({ error: '设备不存在，请先绑定设备' });

  let fault_level = '一般';
  if (/硬件|损坏|无法启动|显示屏|卡死/.test(description)) fault_level = '重大';
  if (/网络|断网|通信|系统调试/.test(description)) fault_level = '紧急';

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const cnt = db.prepare("SELECT COUNT(*) as c FROM fault_orders WHERE fault_no LIKE '%' || ? || '%'").get(today).c;
  const seq = String(cnt + 1).padStart(4, '0');
  const fault_no = 'FW_' + device_code.slice(-6) + '_' + today + '_' + seq;

  db.prepare('INSERT INTO fault_orders (fault_no,device_code,description,fault_level,status,contact_person,contact_phone,engineer_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(fault_no, device_code, description, fault_level, '待处理', contact_person || '', contact_phone || '', user.id, new Date().toISOString());
  db.prepare('INSERT INTO fault_flow_logs (fault_no,node_name,operator_id,operator_name,action) VALUES (?,?,?,?,?)')
    .run(fault_no, '新建工单', user.id, user.real_name, '创建故障工单');
  db.prepare('INSERT INTO audit_logs (user_id,username,role,action_type,target_type,target_id,ip_address) VALUES (?,?,?,?,?,?,?)')
    .run(user.id, user.username, user.role, '创建工单', 'fault_order', fault_no, req.ip);

  if (fault_level === '重大') {
    const admins = db.prepare("SELECT id FROM users WHERE role = 'headquarters'").all();
    admins.forEach(admin => {
      db.prepare('INSERT INTO notifications (target_user_id,fault_no,title,content,category,level) VALUES (?,?,?,?,?,?)')
        .run(admin.id, fault_no, '故障升级提醒：' + fault_no, '工单 ' + fault_no + ' 被标记为重大故障，请关注处理', '故障', '重大');
    });
  }
  res.json({ fault_no, message: '工单已创建' });
});

app.post('/api/fault-orders/:fault_no/investigate', authMiddleware, (req, res) => {
  const db = getDbSync();
  const { investigation_result, root_cause } = req.body;
  const fault = db.prepare('SELECT * FROM fault_orders WHERE fault_no = ?').get(req.params.fault_no);
  if (!fault) return res.status(404).json({ error: '工单不存在' });
  if (fault.status !== '待处理') return res.status(400).json({ error: '当前状态不允许此操作' });
  db.prepare("UPDATE fault_orders SET investigation_result = ?, root_cause = ?, status = ?, updated_at = datetime('now','localtime') WHERE fault_no = ?")
    .run(investigation_result || '', root_cause || '', '处理中', req.params.fault_no);
  db.prepare('INSERT INTO fault_flow_logs (fault_no,node_name,operator_id,operator_name,action) VALUES (?,?,?,?,?)')
    .run(req.params.fault_no, '现场勘查', req.user.id, req.user.real_name, '完成勘查，原因：' + (root_cause || '未填写'));
  res.json({ message: '已提交勘查结果' });
});

app.post('/api/fault-orders/:fault_no/solve', authMiddleware, (req, res) => {
  const db = getDbSync();
  const { solution } = req.body;
  if (!solution || solution.length < 20) return res.status(400).json({ error: '解决方案描述至少20个字符' });
  const fault = db.prepare('SELECT * FROM fault_orders WHERE fault_no = ?').get(req.params.fault_no);
  if (!fault) return res.status(404).json({ error: '工单不存在' });
  if (fault.status !== '处理中') return res.status(400).json({ error: '当前状态不允许此操作' });
  db.prepare("UPDATE fault_orders SET solution = ?, status = ?, updated_at = datetime('now','localtime') WHERE fault_no = ?")
    .run(solution, '待复核', req.params.fault_no);
  db.prepare('INSERT INTO fault_flow_logs (fault_no,node_name,operator_id,operator_name,action) VALUES (?,?,?,?,?)')
    .run(req.params.fault_no, '解决方案提交', req.user.id, req.user.real_name, '提交解决方案：' + solution.slice(0, 50));
  res.json({ message: '已提交解决方案' });
});

app.post('/api/fault-orders/:fault_no/review', authMiddleware, (req, res) => {
  const db = getDbSync();
  const { review_result, review_note } = req.body;
  const fault = db.prepare('SELECT * FROM fault_orders WHERE fault_no = ?').get(req.params.fault_no);
  if (!fault) return res.status(404).json({ error: '工单不存在' });
  if (fault.status !== '待复核') return res.status(400).json({ error: '当前状态不允许此操作' });
  if (review_result === '正常') {
    db.prepare("UPDATE fault_orders SET review_result = ?, review_note = ?, status = ?, closed_at = datetime('now','localtime'), updated_at = datetime('now','localtime') WHERE fault_no = ?")
      .run(review_result, review_note || '', '已闭环', req.params.fault_no);
    db.prepare("UPDATE devices SET status = '在线' WHERE device_code = ?").run(fault.device_code);
    db.prepare('INSERT INTO knowledge_base (fault_category_l1,fault_category_l2,title,description,solution,source_fault_no) VALUES (?,?,?,?,?,?)')
      .run(fault.fault_category_l1 || '其他', fault.fault_category_l2 || '其他', fault.description.slice(0, 50), fault.root_cause || '', fault.solution || '', req.params.fault_no);
    db.prepare('INSERT INTO fault_flow_logs (fault_no,node_name,operator_id,operator_name,action) VALUES (?,?,?,?,?)')
      .run(req.params.fault_no, '复核通过', req.user.id, req.user.real_name, '复核通过，已闭环');
  } else {
    db.prepare("UPDATE fault_orders SET review_result = ?, review_note = ?, status = ?, updated_at = datetime('now','localtime') WHERE fault_no = ?")
      .run(review_result, review_note || '', '处理中', req.params.fault_no);
    db.prepare('INSERT INTO fault_flow_logs (fault_no,node_name,operator_id,operator_name,action) VALUES (?,?,?,?,?)')
      .run(req.params.fault_no, '复核退回', req.user.id, req.user.real_name, '复核不通过：' + review_note);
  }
  res.json({ message: '已提交复核结果' });
});

// ======================= 设备管理 =======================
app.get('/api/devices', authMiddleware, (req, res) => {
  const db = getDbSync(); const user = req.user;
  const { keyword, status, page = 1, page_size = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(page_size);
  let where = []; let params = [];

  if (user.role === 'engineer') { where.push('d.engineer_id = ?'); params.push(user.id); }
  else if (user.role !== 'headquarters') {
    if (user.province) { where.push('h.province = ?'); params.push(user.province); }
  }
  if (status) { where.push('d.status = ?'); params.push(status); }
  if (keyword) { where.push('(d.device_code LIKE ? OR d.serial_number LIKE ? OR h.hospital_name LIKE ?)'); params.push('%' + keyword + '%', '%' + keyword + '%', '%' + keyword + '%'); }

  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare('SELECT COUNT(*) as cnt FROM devices d LEFT JOIN hospitals h ON d.hospital_id = h.id ' + whereStr).get(...params).cnt;
  const rows = db.prepare('SELECT d.*, h.hospital_name, u.real_name as engineer_name FROM devices d LEFT JOIN hospitals h ON d.hospital_id = h.id LEFT JOIN users u ON h.engineer_id = u.id ' + whereStr + ' ORDER BY d.created_at DESC LIMIT ? OFFSET ?').all(...params, parseInt(page_size), offset);
  res.json({ total, page: parseInt(page), page_size: parseInt(page_size), data: rows });
});

app.get('/api/devices/:device_code', authMiddleware, (req, res) => {
  const db = getDbSync();
  const device = db.prepare('SELECT d.*, h.hospital_name, u.real_name as engineer_name FROM devices d LEFT JOIN hospitals h ON d.hospital_id = h.id LEFT JOIN users u ON h.engineer_id = u.id WHERE d.device_code = ?').get(req.params.device_code);
  if (!device) return res.status(404).json({ error: '设备不存在' });
  res.json(device);
});

app.post('/api/devices', authMiddleware, (req, res) => {
  const db = getDbSync(); const user = req.user;
  const { device_code, device_type, serial_number, hospital_code, install_location, wall_distance_cm, ip_address } = req.body;
  if (!device_code || !device_type || !hospital_code) return res.status(400).json({ error: '设备编码、设备类型、医院编码不能为空' });
  const existing = db.prepare('SELECT * FROM devices WHERE device_code = ?').get(device_code);
  if (existing) return res.status(400).json({ error: '该编码已绑定至 ' + existing.hospital_code + '，禁止重复绑定' });
  const hospital = db.prepare('SELECT * FROM hospitals WHERE hospital_code = ?').get(hospital_code);
  if (!hospital) return res.status(400).json({ error: '医院编码不存在' });
  db.prepare('INSERT INTO devices (device_code,device_type,serial_number,hospital_id,install_location,wall_distance_cm,ip_address,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(device_code, device_type, serial_number || '', hospital.id, install_location || '', wall_distance_cm || null, ip_address || '', '在线', new Date().toISOString());
  db.prepare('INSERT INTO audit_logs (user_id,username,role,action_type,target_type,target_id,ip_address) VALUES (?,?,?,?,?,?,?)')
    .run(user.id, user.username, user.role, '设备绑定', 'device', device_code, req.ip);
  res.json({ success: true, device_code });
});

app.patch('/api/devices/:device_code/status', authMiddleware, (req, res) => {
  const db = getDbSync();
  const { status } = req.body;
  const device = db.prepare('SELECT * FROM devices WHERE device_code = ?').get(req.params.device_code);
  if (!device) return res.status(404).json({ error: '设备不存在' });
  const valid = ['在线', '离线', '维修中', '已报废'];
  if (!valid.includes(status)) return res.status(400).json({ error: '无效的状态值' });
  db.prepare("UPDATE devices SET status = ?, updated_at = datetime('now','localtime') WHERE device_code = ?").run(status, req.params.device_code);
  db.prepare('INSERT INTO audit_logs (user_id,username,role,action_type,target_type,target_id,ip_address) VALUES (?,?,?,?,?,?,?)')
    .run(req.user.id, req.user.username, req.user.role, '设备状态变更', 'device', req.params.device_code, req.ip);
  res.json({ success: true });
});

// ======================= 需求管理 =======================
app.get('/api/demands', authMiddleware, (req, res) => {
  const db = getDbSync();
  const { status, keyword, page = 1, page_size = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(page_size);
  let where = []; let params = [];
  if (status) { where.push('d.status = ?'); params.push(status); }
  if (keyword) { where.push('d.title LIKE ?'); params.push('%' + keyword + '%'); }
  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare('SELECT COUNT(*) as cnt FROM demands d ' + whereStr).get(...params).cnt;
  const rows = db.prepare('SELECT d.*, h.hospital_name, u.real_name as submitter_name FROM demands d LEFT JOIN hospitals h ON d.source_hospital_id = h.id LEFT JOIN users u ON d.submitter_id = u.id ' + whereStr + ' ORDER BY d.created_at DESC LIMIT ? OFFSET ?').all(...params, parseInt(page_size), offset);
  res.json({ total, page: parseInt(page), page_size: parseInt(page_size), data: rows });
});

app.post('/api/demands', authMiddleware, (req, res) => {
  const db = getDbSync(); const user = req.user;
  const { title, description, hospital_id, priority } = req.body;
  if (!title || !description || description.length < 10) return res.status(400).json({ error: '标题和描述不能为空（描述至少10个字符）' });
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const cnt = db.prepare("SELECT COUNT(*) as c FROM demands WHERE demand_no LIKE '%' || ? || '%'").get(today).c;
  const demand_no = 'XQ_' + today + '_' + String(cnt + 1).padStart(4, '0');
  db.prepare('INSERT INTO demands (demand_no,title,description,source_hospital_id,submitter_id,priority,status,created_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(demand_no, title, description, hospital_id, user.id, priority || '中', '待评估', new Date().toISOString());
  db.prepare('INSERT INTO audit_logs (user_id,username,role,action_type,target_type,target_id,ip_address) VALUES (?,?,?,?,?,?,?)')
    .run(user.id, user.username, user.role, '创建需求', 'demand', demand_no, req.ip);
  res.json({ demand_no, message: '需求已创建' });
});

app.post('/api/demands/:demand_no/evaluate', authMiddleware, (req, res) => {
  const db = getDbSync();
  if (req.user.role !== 'headquarters') return res.status(403).json({ error: '仅总部可评估' });
  const { eval_result, estimated_launch_date, reject_reason, schedule_note, eval_note } = req.body;
  const demand = db.prepare('SELECT * FROM demands WHERE demand_no = ?').get(req.params.demand_no);
  if (!demand) return res.status(404).json({ error: '需求不存在' });
  if (eval_result === '已采纳') {
    if (!estimated_launch_date) return res.status(400).json({ error: '已采纳必须填写预计上线时间' });
    db.prepare("UPDATE demands SET status = ?, eval_result = ?, estimated_launch_date = ?, schedule_note = ?, eval_note = ?, evaluator_id = ?, eval_time = datetime('now','localtime') WHERE demand_no = ?")
      .run('已采纳', eval_result, estimated_launch_date, schedule_note || '', eval_note || '', req.user.id, req.params.demand_no);
  } else if (eval_result === '已驳回') {
    if (!reject_reason || reject_reason.length < 10) return res.status(400).json({ error: '驳回时必须填写原因' });
    db.prepare("UPDATE demands SET status = ?, eval_result = ?, reject_reason = ?, eval_note = ?, evaluator_id = ?, eval_time = datetime('now','localtime') WHERE demand_no = ?")
      .run('已驳回', eval_result, reject_reason, eval_note || '', req.user.id, req.params.demand_no);
  } else {
    return res.status(400).json({ error: '无效的评估结果' });
  }
  db.prepare('INSERT INTO audit_logs (user_id,username,role,action_type,target_type,target_id,ip_address) VALUES (?,?,?,?,?,?,?)')
    .run(req.user.id, req.user.username, req.user.role, '需求评估', 'demand', req.params.demand_no, req.ip);
  res.json({ message: '评估已完成' });
});

// ======================= 巡检管理 =======================
app.get('/api/inspections/plans', authMiddleware, (req, res) => {
  const db = getDbSync(); const user = req.user;
  const isHQ = user.role === 'headquarters';
  const rows = db.prepare('SELECT p.*, h.hospital_name, u.real_name as engineer_name, ' +
    '(SELECT COUNT(*) FROM inspection_records WHERE plan_id = p.id) as record_count ' +
    'FROM inspection_plans p LEFT JOIN hospitals h ON p.hospital_id = h.id LEFT JOIN users u ON p.responsible_engineer_id = u.id ' +
    (isHQ ? '' : 'WHERE p.responsible_engineer_id = ?') + ' ORDER BY p.created_at DESC').all(...(isHQ ? [] : [user.id]));
  res.json({ data: rows });
});

app.post('/api/inspections/plans', authMiddleware, (req, res) => {
  const db = getDbSync(); const user = req.user;
  const { plan_name, hospital_code, device_codes, cycle, start_date } = req.body;
  if (!plan_name || !hospital_code || !cycle || !start_date) return res.status(400).json({ error: '必填字段不能为空' });
  const hospital = db.prepare('SELECT id FROM hospitals WHERE hospital_code = ?').get(hospital_code);
  if (!hospital) return res.status(400).json({ error: '医院不存在' });
  const respEngineerId = (user.role === 'headquarters' && req.body.engineer_id) ? req.body.engineer_id : user.id;
  const r = db.prepare('INSERT INTO inspection_plans (plan_name,hospital_id,device_codes,cycle,start_date,responsible_engineer_id,next_inspection_date) VALUES (?,?,?,?,?,?,?)')
    .run(plan_name, hospital.id, JSON.stringify(device_codes || []), cycle, start_date, respEngineerId, start_date);
  res.json({ success: true, plan_id: r.lastInsertRowid });
});

app.patch('/api/inspections/plans/:id', authMiddleware, (req, res) => {
  if (req.user.role !== 'headquarters') return res.status(403).json({ error: '仅总部可管理' });
  const db = getDbSync();
  const { status, engineer_id } = req.body;
  const plan = db.prepare('SELECT * FROM inspection_plans WHERE id = ?').get(parseInt(req.params.id));
  if (!plan) return res.status(404).json({ error: '计划不存在' });
  if (status) db.prepare('UPDATE inspection_plans SET status = ? WHERE id = ?').run(status, parseInt(req.params.id));
  if (engineer_id) db.prepare('UPDATE inspection_plans SET responsible_engineer_id = ? WHERE id = ?').run(engineer_id, parseInt(req.params.id));
  res.json({ message: '已更新' });
});

app.post('/api/inspections/records', authMiddleware, (req, res) => {
  const db = getDbSync();
  const { plan_id, device_code, inspect_date, appearance_ok, wall_distance, ground_level,
    firmware_version, app_version, run_hours, ip_address, network_stable, packet_loss_rate,
    drug_inventory_ok, drug_low_stock_num, drug_expiring_num,
    screen_ok, scanner_ok, printer_ok, lock_ok, result, note } = req.body;
  const r = db.prepare('INSERT INTO inspection_records (plan_id,device_code,engineer_id,inspect_date,appearance_ok,wall_distance,ground_level,firmware_version,app_version,run_hours,ip_address,network_stable,packet_loss_rate,drug_inventory_ok,drug_low_stock_num,drug_expiring_num,screen_ok,scanner_ok,printer_ok,lock_ok,result,note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(plan_id || null, device_code, req.user.id, inspect_date || new Date().toISOString().slice(0, 10),
      appearance_ok ? 1 : 0, wall_distance || null, ground_level || null,
      firmware_version || '', app_version || '', run_hours || 0,
      ip_address || '', network_stable ? 1 : 0, packet_loss_rate || null,
      drug_inventory_ok ? 1 : 0, drug_low_stock_num || 0, drug_expiring_num || 0,
      screen_ok ? 1 : 0, scanner_ok ? 1 : 0, printer_ok ? 1 : 0, lock_ok ? 1 : 0,
      result || '正常', note || '');

  if (plan_id) {
    const plan = db.prepare('SELECT * FROM inspection_plans WHERE id = ?').get(plan_id);
    if (plan) {
      const next = new Date(inspect_date || Date.now());
      if (plan.cycle === '每周') next.setDate(next.getUTCDate() + 7);
      else if (plan.cycle === '每两周') next.setDate(next.getUTCDate() + 14);
      else next.setMonth(next.getUTCMonth() + 1);
      db.prepare('UPDATE inspection_plans SET next_inspection_date = ? WHERE id = ?').run(next.toISOString().slice(0, 10), plan_id);
    }
  }
  db.prepare('INSERT INTO audit_logs (user_id,username,role,action_type,target_type,ip_address) VALUES (?,?,?,?,?,?)')
    .run(req.user.id, req.user.username, req.user.role, '提交巡检记录', 'inspection_record', req.ip);
  res.json({ success: true, record_id: r.lastInsertRowid });
});

app.get('/api/inspections/records', authMiddleware, (req, res) => {
  const db = getDbSync(); const user = req.user;
  const { plan_id, page = 1, page_size = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(page_size);
  let where = []; let params = [];
  if (user.role !== 'headquarters') { where.push('ir.engineer_id = ?'); params.push(user.id); }
  if (plan_id) { where.push('ir.plan_id = ?'); params.push(parseInt(plan_id)); }
  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare('SELECT COUNT(*) as cnt FROM inspection_records ir ' + whereStr).get(...params).cnt;
  const rows = db.prepare('SELECT ir.*, ip.plan_name, d.device_type, h.hospital_name FROM inspection_records ir ' +
    'LEFT JOIN inspection_plans ip ON ir.plan_id = ip.id LEFT JOIN devices d ON ir.device_code = d.device_code LEFT JOIN hospitals h ON d.hospital_id = h.id ' +
    whereStr + ' ORDER BY ir.created_at DESC LIMIT ? OFFSET ?').all(...params, parseInt(page_size), offset);
  res.json({ total, page: parseInt(page), page_size: parseInt(page_size), data: rows });
});

app.patch('/api/inspections/records/:id', authMiddleware, (req, res) => {
  const db = getDbSync();
  const { result, note } = req.body;
  const record = db.prepare('SELECT * FROM inspection_records WHERE id = ?').get(parseInt(req.params.id));
  if (!record) return res.status(404).json({ error: '记录不存在' });
  db.prepare("UPDATE inspection_records SET result = ?, note = ?, updated_at = datetime('now','localtime') WHERE id = ?")
    .run(result || '已处理', note || '', parseInt(req.params.id));
  res.json({ message: '异常已处理' });
});

// ======================= 知识库 =======================
app.get('/api/knowledge', authMiddleware, (req, res) => {
  const db = getDbSync();
  const { keyword, category, page = 1, page_size = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(page_size);
  let where = []; let params = [];
  if (keyword) { where.push('(title LIKE ? OR description LIKE ? OR solution LIKE ?)'); params.push('%' + keyword + '%', '%' + keyword + '%', '%' + keyword + '%'); }
  if (category) { where.push('fault_category_l2 = ?'); params.push(category); }
  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare('SELECT COUNT(*) as cnt FROM knowledge_base ' + whereStr).get(...params).cnt;
  const rows = db.prepare('SELECT * FROM knowledge_base ' + whereStr + ' ORDER BY created_at DESC LIMIT ? OFFSET ?').all(...params, parseInt(page_size), offset);
  res.json({ total, page: parseInt(page), page_size: parseInt(page_size), data: rows });
});

app.get('/api/dicts', authMiddleware, (req, res) => {
  res.json({
    provinces: ['北京市', '上海市', '广东省'],
    fault_level: ['一般', '紧急', '重大'],
    fault_categories: ['硬件', '软件', '网络', '耗材', '其他'],
    demand_priority: ['高', '中', '低'],
    inspection_cycles: ['每周', '每两周', '每月'],
    flow_status: ['待处理', '处理中', '待复核', '已闭环'],
    device_status: ['在线', '离线', '维修中', '已报废']
  });
});

// ======================= 服务器启动 =======================
console.log('[服务器] 麻精药品智能柜售后运维工具已启动');
console.log('访问地址: http://localhost:' + PORT);
console.log('数据目录: ' + DATA_DIR);
console.log('');
console.log('默认账号:');
console.log('  省代: dealer01 / 123456');
console.log('  市代(广州): dealer02 / 123456');
console.log('  市代(深圳): dealer03 / 123456');
console.log('  工程师(广州): engineer01 / 123456');
console.log('  工程师(深圳): engineer02 / 123456');
console.log('  总部: admin01 / 123456');

initDb().then(() => {
  const http = require('http');
  const server = http.createServer(app);
  server.listen(PORT, '0.0.0.0', () => {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    let localIP = '127.0.0.1';
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) { localIP = iface.address; break; }
      }
      if (localIP !== '127.0.0.1') break;
    }
    console.log('局域网访问: http://' + localIP + ':' + PORT);
  });
}).catch(err => {
  console.error('[服务器] 数据库初始化失败:', err.message);
  process.exit(1);
});

module.exports = app;
