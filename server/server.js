/**
 * 麻精药品智能柜售后运维工具- 主服务器
 * 基于 Express + SQLite，支持离线优先架构 */
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { initDb, getDbSync, saveDb } = require('./db');
const { authMiddleware, login, logout, changePassword, getCurrentUser, requireHeadquarters, requireAgentOrAbove, logAudit } = require('./auth');
const regionFilter = require('./middleware/region-filter');
const usersRouter = require('./apis/users');
const partsRouter = require('./apis/parts');
const preSalesRouter = require('./apis/pre_sales');

const app = express();
const PORT = process.env.PORT || 3000;

// 数据目录
const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 中间件
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 静态文件
app.use(express.static(path.join(__dirname, '..', 'web')));

// 认证中间件
app.use('/api', authMiddleware);

// 上传配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const subDir = req.body.node_type || 'general';
    const targetDir = path.join(UPLOAD_DIR, subDir);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    cb(null, targetDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const ts = Date.now();
    cb(null, `${ts}_${uuidv4().slice(0, 8)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.pdf', '.xlsx', '.xls', '.doc', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error('不支持的文件类型'));
  }
});

// ======================= 认证接口 =======================
app.post('/api/auth/login', (req, res) => login(req, res));
app.post('/api/auth/logout', (req, res) => logout(req, res));
app.post('/api/auth/change-password', (req, res) => changePassword(req, res));
app.get('/api/auth/me', (req, res) => getCurrentUser(req, res));

// ======================= 用户管理（总部仅）=======================
app.use('/api/users', usersRouter);

// ======================= 配件管理 =======================
app.use('/api/parts', partsRouter);
// ======================= 设备型号管理（HQ仅）=======================
const deviceModelsRouter = require('./apis/device_models');
app.use('/api/device-models', deviceModelsRouter);
// 售中模块-文件上传（multer需在router前注册，确保multer中间件先执行）
app.post('/api/pre-sales/nodes/:nodeId/upload', upload.array('files', 10), (req, res) => {
  try {
    const { files } = req;
    if (!files || files.length === 0) return res.status(400).json({ error: 'error' });
    const db = getDbSync();
    const nodeId = parseInt(req.params.nodeId);
    const nd = db.prepare('SELECT * FROM pre_sales_node_progress WHERE id=?').get(nodeId);
    if (!nd) return res.status(404).json({ error: '节点不存在' });
    const results = [];
    for (const f of files) {
      const relativePath = f.path.replace(/\\/g, '/').replace(/.*\/uploads\//, '');
      db.prepare('INSERT INTO pre_sales_materials (node_progress_id,file_name,file_path,file_type) VALUES (?,?,?,?)')
        .run(nodeId, f.originalname, relativePath, f.mimetype);
      results.push({ file_name: f.originalname, file_path: relativePath });
    }
    db.prepare('UPDATE pre_sales_node_progress SET materials_uploaded=1,updated_at=datetime("now","localtime") WHERE id=?').run(nodeId);
    res.json({ message: `已上传${files.length}个文件`, files: results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.use('/api/pre-sales', preSalesRouter);

// ======================= 工作台统计=======================
app.get('/api/dashboard', (req, res) => {
  const db = getDbSync();
  const user = req.user;
  const filter = regionFilter.buildRegionFilter(user, 'h');

  // 故障统计（按大区/省份/城市过滤）
  const faultStats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = '待处理' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = '处理中' THEN 1 ELSE 0 END) as processing,
      SUM(CASE WHEN status = '待复核' THEN 1 ELSE 0 END) as review,
      SUM(CASE WHEN status = '已闭环' THEN 1 ELSE 0 END) as closed,
      SUM(CASE WHEN fault_level = '重大' AND status != '已闭环' THEN 1 ELSE 0 END) as major_pending,
      SUM(CASE WHEN fault_level = '紧急' AND status != '已闭环' THEN 1 ELSE 0 END) as urgent_pending
    FROM fault_orders f
    LEFT JOIN hospitals h ON f.hospital_id = h.id
    WHERE 1=1 ${filter.sql}
  `).get(...filter.params);

  // 设备统计（按大区/省份/城市过滤）
  const deviceStats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN d.status = '在线' THEN 1 ELSE 0 END) as online,
      SUM(CASE WHEN d.status = '离线' THEN 1 ELSE 0 END) as offline,
      SUM(CASE WHEN d.status = '维修中' THEN 1 ELSE 0 END) as maintenance,
      SUM(CASE WHEN d.status = '已报废' THEN 1 ELSE 0 END) as scrapped
    FROM devices d
    LEFT JOIN hospitals h ON d.hospital_id = h.id
    WHERE 1=1 ${filter.sql}
  `).get(...filter.params);

  // 待巡检（本人或下级范围）
  let inspFilter = '';
  let inspParams = [];
  if (user.role === 'provincial_agent' || user.role === 'city_agent') {
    // 代理人看下属工程师的巡检
    const visFilter = regionFilter.buildUserVisibilityFilter(user, db);
    inspFilter = visFilter.sql.replace(/u\.id/g, 'ip.responsible_engineer_id').replace(/^ AND /, ' AND ');
    inspParams = visFilter.params;
  } else if (user.role === 'engineer') {
    inspFilter = ' AND ip.responsible_engineer_id = ?';
    inspParams = [user.id];
  }
  const pendingInspection = db.prepare(`
    SELECT COUNT(*) as cnt FROM inspection_plans ip
    WHERE ip.next_inspection_date <= date('now','localtime','+3 days')
    AND ip.status = '进行中' ${inspFilter}
  `).get(...inspParams).cnt;

  // 待回访（按地区过滤）
  const pendingFeedback = db.prepare(`
    SELECT COUNT(*) as cnt FROM fault_orders f
    LEFT JOIN hospitals h ON f.hospital_id = h.id
    WHERE f.closed_at >= datetime('now','localtime','-7 days')
    AND f.feedback_completed = 0 AND 1=1 ${filter.sql}
  `).get(...filter.params).cnt;

  // 未读消息
  const unreadNotify = db.prepare('SELECT COUNT(*) as cnt FROM notifications WHERE target_user_id = ? AND is_read = 0').get(user.id).cnt;

  // 今日故障趋势（按地区过滤）
  const recentFaults = db.prepare(`
    SELECT date(f.created_at) as date, COUNT(*) as cnt
    FROM fault_orders f
    LEFT JOIN hospitals h ON f.hospital_id = h.id
    WHERE f.created_at >= datetime('now','localtime','-7 days') AND 1=1 ${filter.sql}
    GROUP BY date(f.created_at)
    ORDER BY date ASC
  `).all(...filter.params);

  res.json({
    fault: faultStats,
    device: deviceStats,
    pending_inspection: pendingInspection,
    pending_feedback: pendingFeedback,
    unread_notifications: unreadNotify,
    recent_faults: recentFaults
  });
});

// ======================= 故障工单接口 =======================

// 工单列表
app.get('/api/faults', (req, res) => {
  const db = getDbSync();
  const { status, level, keyword, region, province, city, page = 1, page_size = 20 } = req.query;
  const user = req.user;
  const offset = (parseInt(page) - 1) * parseInt(page_size);

  let where = [];
  let params = [];

  // 地区层级过滤（省级/市代按地域）+ 供应商技术人员按工单归属过滤
  const regionF = regionFilter.buildRegionFilter(user, 'h');
  const accessF = regionFilter.buildFaultAccessFilter(user, 'f', db);

  if (status) { where.push('f.status = ?'); params.push(status); }
  if (level) { where.push('f.fault_level = ?'); params.push(level); }
  if (keyword) { where.push('(f.fault_no LIKE ? OR f.description LIKE ? OR h.hospital_name LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
  // 允许指定额外过滤
  if (region) { where.push('h.region = ?'); params.push(region); }
  if (province) { where.push('h.province = ?'); params.push(province); }
  if (city) { where.push('h.city = ?'); params.push(city); }

  const finalWhere = where.length > 0
    ? `WHERE 1=1${regionF.sql}${accessF.sql} AND ${where.join(' AND ')}`
    : `WHERE 1=1${regionF.sql}${accessF.sql}`;
  const allParams = [...regionF.params, ...accessF.params, ...params];

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM fault_orders f LEFT JOIN hospitals h ON f.hospital_id = h.id ${finalWhere}`).get(...allParams).cnt;
  const rows = db.prepare(`
    SELECT f.*, h.hospital_name, h.region as hospital_region, u.real_name as engineer_name,
           d.device_type, d.install_location
    FROM fault_orders f
    LEFT JOIN hospitals h ON f.hospital_id = h.id
    LEFT JOIN users u ON f.engineer_id = u.id
    LEFT JOIN devices d ON f.device_code = d.device_code
    ${finalWhere}
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...allParams, parseInt(page_size), offset);

  res.json({ total, page: parseInt(page), page_size: parseInt(page_size), data: rows });
});

// 故障详情
app.get('/api/faults/:fault_no', (req, res) => {
  const db = getDbSync();
  const { fault_no } = req.params;

  const fault = db.prepare(`
    SELECT f.*, h.hospital_name, h.address as hospital_address,
           h.contact_person as hospital_contact_person, h.contact_phone as hospital_contact_phone,
           u.real_name as engineer_name, u.phone as engineer_phone,
           r.real_name as reviewer_name
    FROM fault_orders f
    LEFT JOIN hospitals h ON f.hospital_id = h.id
    LEFT JOIN users u ON f.engineer_id = u.id
    LEFT JOIN users r ON f.reviewer_id = r.id
    WHERE f.fault_no = ?
  `).get(fault_no);

  if (!fault) return res.status(404).json({ error: 'error' });

  const logs = db.prepare('SELECT * FROM fault_flow_logs WHERE fault_no = ? ORDER BY created_at ASC').all(fault_no);
  const attachments = db.prepare('SELECT * FROM fault_attachments WHERE fault_no = ?').all(fault_no);

  res.json({ ...fault, logs, attachments });
});

// 新建故障工单（报修登记）
app.post('/api/faults', (req, res) => {
  const db = getDbSync();
  const user = req.user;
  const {
    device_code, fault_category_l1, fault_category_l2, description,
    contact_person, contact_phone
  } = req.body;

  if (!device_code || !fault_category_l1 || !description || !contact_person || !contact_phone) {
    return res.status(400).json({ error: '必填字段不能为空' });
  }
  if (description.length < 10) return res.status(400).json({ error: '故障描述至少10个字' });

  // 校验设备是否存在
  const device = db.prepare('SELECT * FROM devices WHERE device_code = ?').get(device_code);
  if (!device) return res.status(400).json({ error: '设备未注册，请先绑定设备' });

  // 自动分级
  const autoLevel = (cat1, cat2, desc) => {
    const d = (desc || '') + (cat2 || '');
    if (/锁死|无法开柜|药品丢失|数量不符|物理破坏|柜体/.test(d)) return '重大';
    if (/网络|通信|扫码|温湿度|报警/.test(d)) return '紧急';
    return '一般';
  };

  const fault_level = autoLevel(fault_category_l1, fault_category_l2, description);

  // 生成单号
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const seqRow = db.prepare('SELECT COUNT(*) as cnt FROM fault_orders WHERE fault_no LIKE ?').get(`FW_${device_code.slice(-6)}_${today}%`);
  const seq = String(seqRow.cnt + 1).padStart(4, '0');
  const fault_no = `FW_${device_code.slice(-6)}_${today}_${seq}`;

  db.prepare(`
    INSERT INTO fault_orders
    (fault_no, device_code, fault_level, fault_category_l1, fault_category_l2,
     description, status, contact_person, contact_phone, engineer_id, hospital_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(fault_no, device_code, fault_level, fault_category_l1, fault_category_l2 || '',
    description, '待处理', contact_person, contact_phone, user.id, device.hospital_id);

  // 流程日志
  db.prepare('INSERT INTO fault_flow_logs (fault_no,node_name,operator_id,operator_name,action) VALUES (?,?,?,?,?)')
    .run(fault_no, '报修登记', user.id, user.real_name, '创建故障工单');

  // 审计日志
  db.prepare('INSERT INTO audit_logs (user_id,username,role,action_type,target_type,target_id,new_value,ip_address) VALUES (?,?,?,?,?,?,?,?)')
    .run(user.id, user.username, user.role, '创建工单', 'fault_order', fault_no, JSON.stringify({ fault_level, fault_category_l1 }), req.ip);

  // 告警通知
  if (fault_level === '重大') {
    const admins = db.prepare("SELECT id FROM users WHERE role = 'headquarters'").all();
    for (const admin of admins) {
      db.prepare('INSERT INTO notifications (target_user_id,fault_no,title,content,category,level) VALUES (?,?,?,?,?,?)')
        .run(admin.id, fault_no, `【重大故障】${fault_no}`, `设备 ${device_code} 发生重大故障，请立即处理`, '故障告警', 'urgent');
    }
  }

  res.json({ success: true, fault_no, fault_level });
});

// 现场排查
app.post('/api/faults/:fault_no/investigate', (req, res) => {
  const db = getDbSync();
  const { fault_no } = req.params;
  const { investigation_result, root_cause, note } = req.body;

  const fault = db.prepare('SELECT * FROM fault_orders WHERE fault_no = ?').get(fault_no);
  if (!fault) return res.status(404).json({ error: 'error' });
  if (fault.status !== '待处理') return res.status(400).json({ error: 'error' });

  db.prepare('UPDATE fault_orders SET investigation_result=?,root_cause=?,investigation_time=datetime("now","localtime"),status=?,updated_at=datetime("now","localtime") WHERE fault_no=?')
    .run(investigation_result || '', root_cause || '', '处理中', fault_no);

  db.prepare('INSERT INTO fault_flow_logs (fault_no,node_name,operator_id,operator_name,action,detail) VALUES (?,?,?,?,?,?)')
    .run(fault_no, '现场排查', req.user.id, req.user.real_name, '完成现场排查', `根因: ${root_cause || ''}`);

  db.prepare('INSERT INTO audit_logs (user_id,username,role,action_type,target_type,target_id,ip_address) VALUES (?,?,?,?,?,?,?)')
    .run(req.user.id, req.user.username, req.user.role, '现场排查', 'fault_order', fault_no, req.ip);

  res.json({ success: true });
});

// 故障修复
app.post('/api/faults/:fault_no/fix', (req, res) => {
  const db = getDbSync();
  const { fault_no } = req.params;
  const { solution } = req.body;

  if (!solution || solution.length < 20) return res.status(400).json({ error: '解决方案至少20个字' });

  const fault = db.prepare('SELECT * FROM fault_orders WHERE fault_no = ?').get(fault_no);
  if (!fault) return res.status(404).json({ error: 'error' });
  if (fault.status !== '处理中') return res.status(400).json({ error: 'error' });

  db.prepare('UPDATE fault_orders SET solution=?,fix_completed_time=datetime("now","localtime"),status=?,updated_at=datetime("now","localtime") WHERE fault_no=?')
    .run(solution, '待复核', fault_no);

  db.prepare('INSERT INTO fault_flow_logs (fault_no,node_name,operator_id,operator_name,action,detail) VALUES (?,?,?,?,?,?)')
    .run(fault_no, '故障修复', req.user.id, req.user.real_name, '提交修复方案', solution.slice(0, 50));

  db.prepare('INSERT INTO audit_logs (user_id,username,role,action_type,target_type,target_id,ip_address) VALUES (?,?,?,?,?,?,?)')
    .run(req.user.id, req.user.username, req.user.role, '故障修复', 'fault_order', fault_no, req.ip);

  res.json({ success: true });
});

// 复核闭环
app.post('/api/faults/:fault_no/review', (req, res) => {
  const db = getDbSync();
  const { fault_no } = req.params;
  const { review_result, review_note } = req.body;

  const fault = db.prepare('SELECT * FROM fault_orders WHERE fault_no = ?').get(fault_no);
  if (!fault) return res.status(404).json({ error: 'error' });
  if (fault.status !== '待复核') return res.status(400).json({ error: 'error' });

  if (review_result === '正常') {
    // 闭环
    db.prepare('UPDATE fault_orders SET review_result=?,review_note=?,reviewer_id=?,review_time=datetime("now","localtime"),status=?,resolved_at=datetime("now","localtime"),closed_by=?,updated_at=datetime("now","localtime") WHERE fault_no=?')
      .run(review_result, review_note || '', req.user.id, '已闭环', req.user.id, fault_no);

    // 更新设备状态
db.prepare('UPDATE devices SET status=? WHERE device_code=?').run('在线', fault.device_code);

    // 知识库入库
db.prepare('INSERT INTO knowledge_base (fault_category_l1,fault_category_l2,title,description_summary,solution,device_model,source_fault_no,author_id) VALUES (?,?,?,?,?,?,?,?)')
      .run(fault.fault_category_l1, fault.fault_category_l2, fault.fault_no, fault.description.slice(0, 100), fault.solution || '', '', fault_no, req.user.id);

    db.prepare('INSERT INTO fault_flow_logs (fault_no,node_name,operator_id,operator_name,action) VALUES (?,?,?,?,?)')
      .run(fault_no, '复核闭环', req.user.id, req.user.real_name, '复核通过，闭环');

  } else {
    // 回退
    db.prepare('UPDATE fault_orders SET review_result=?,review_note=?,reviewer_id=?,review_time=datetime("now","localtime"),status=?,updated_at=datetime("now","localtime") WHERE fault_no=?')
      .run(review_result, review_note || '', req.user.id, '处理中', fault_no);

    db.prepare('INSERT INTO fault_flow_logs (fault_no,node_name,operator_id,operator_name,action,detail) VALUES (?,?,?,?,?,?)')
      .run(fault_no, '复核回退', req.user.id, req.user.real_name, '复核异常，回退至修复环节', review_note || '');
  }

  db.prepare('INSERT INTO audit_logs (user_id,username,role,action_type,target_type,target_id,ip_address) VALUES (?,?,?,?,?,?,?)')
    .run(req.user.id, req.user.username, req.user.role, '复核操作', 'fault_order', fault_no, req.ip);

  res.json({ success: true });
});

// 售后回访
app.post('/api/faults/:fault_no/feedback', (req, res) => {
  const db = getDbSync();
  const { fault_no } = req.params;
  const { feedback_method, score_1, score_2, score_3, satisfaction, feedback_note } = req.body;

  const fault = db.prepare('SELECT * FROM fault_orders WHERE fault_no = ?').get(fault_no);
  if (!fault) return res.status(404).json({ error: 'error' });
  if (fault.status !== '已闭环') return res.status(400).json({ error: '工单未闭环，无法回访' });

  db.prepare('UPDATE fault_orders SET feedback_method=?,feedback_score_1=?,feedback_score_2=?,feedback_score_3=?,feedback_satisfaction=?,feedback_note=?,feedback_time=datetime("now","localtime"),feedback_completed=1,updated_at=datetime("now","localtime") WHERE fault_no=?')
    .run(feedback_method, score_1, score_2, score_3, satisfaction, feedback_note || '', fault_no);

  db.prepare('INSERT INTO fault_flow_logs (fault_no,node_name,operator_id,operator_name,action) VALUES (?,?,?,?,?)')
    .run(fault_no, '售后回访', req.user.id, req.user.real_name, `完成回访，满意度: ${satisfaction}`);

  res.json({ success: true });
});

// 上传附件
app.post('/api/faults/:fault_no/attachments', upload.array('files', 9), (req, res) => {
  const db = getDbSync();
  const { fault_no } = req.params;
  const { node_type } = req.body;

  const fault = db.prepare('SELECT * FROM fault_orders WHERE fault_no = ?').get(fault_no);
  if (!fault) return res.status(404).json({ error: 'error' });

  const results = [];
  for (const file of req.files) {
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    const rec = db.prepare('INSERT INTO fault_attachments (fault_no,file_name,file_path,file_type,file_size,node_type) VALUES (?,?,?,?,?,?)')
      .run(fault_no, file.originalname, file.path, ext, file.size, node_type || 'general');
    results.push({ id: rec.lastInsertRowid, file_name: file.originalname, file_path: file.path, file_type: ext });
  }

  res.json({ success: true, files: results });
});

// ======================= 设备管理 =======================

// 设备列表
app.get('/api/devices', (req, res) => {
  const db = getDbSync();
  const { keyword, status, page = 1, page_size = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(page_size);
  const user = req.user;

  let where = [];
  let params = [];

  // 供应商技术人员：只看自己负责医院的设备
  const accessFilter = regionFilter.buildHospitalAccessFilter(user, 'h', db);

  if (status) { where.push('d.status = ?'); params.push(status); }
  if (keyword) { where.push('(d.device_code LIKE ? OR d.serial_number LIKE ? OR h.hospital_name LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }

  const baseWhere = accessFilter.sql + (where.length ? ' AND ' + where.join(' AND ') : '');
  const finalWhere = baseWhere ? `WHERE 1=1${baseWhere}` : '';
  const allParams = [...accessFilter.params, ...params];

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM devices d LEFT JOIN hospitals h ON d.hospital_id = h.id ${finalWhere}`).get(...allParams).cnt;
  const rows = db.prepare(`
    SELECT d.*, h.hospital_name, h.province, h.city, u.real_name as engineer_name
    FROM devices d
    LEFT JOIN hospitals h ON d.hospital_id = h.id
    LEFT JOIN users u ON h.engineer_id = u.id
    ${finalWhere}
    ORDER BY d.created_at DESC LIMIT ? OFFSET ?
  `).all(...allParams, parseInt(page_size), offset);

  res.json({ total, page: parseInt(page), page_size: parseInt(page_size), data: rows });
});

// 设备详情
app.get('/api/devices/:device_code', (req, res) => {
  const db = getDbSync();
  const { device_code } = req.params;

  const device = db.prepare(`
    SELECT d.*, h.hospital_name, h.province, h.city, h.address, h.contact_person, h.contact_phone
    FROM devices d LEFT JOIN hospitals h ON d.hospital_id = h.id
    WHERE d.device_code = ?
  `).get(device_code);

  if (!device) return res.status(404).json({ error: 'error' });

  const faults = db.prepare('SELECT fault_no,fault_level,status,created_at FROM fault_orders WHERE device_code = ? ORDER BY created_at DESC LIMIT 10').all(device_code);
  const inspections = db.prepare('SELECT * FROM inspection_records WHERE device_code = ? ORDER BY created_at DESC LIMIT 5').all(device_code);
  const maintenance = db.prepare('SELECT * FROM maintenance_records WHERE device_code = ? ORDER BY created_at DESC LIMIT 10').all(device_code);

  res.json({ ...device, faults, inspections, maintenance });
});

// 设备绑定
app.post('/api/devices', (req, res) => {
  const db = getDbSync();
  const user = req.user;
  const {
    device_code, device_type, serial_number, hospital_code, install_location,
    wall_distance_cm, ip_address, install_date
  } = req.body;

  if (!device_code || !device_type || !hospital_code) {
    return res.status(400).json({ error: 'error' });
  }

  // 查重
  const existing = db.prepare('SELECT * FROM devices WHERE device_code = ?').get(device_code);
  if (existing) return res.status(400).json({ error: `该编码已绑定${existing.hospital_id}，禁止重复绑定` });

  // 校验医院
  const hospital = db.prepare('SELECT * FROM hospitals WHERE hospital_code = ?').get(hospital_code);
  if (!hospital) return res.status(400).json({ error: 'error' });

  // 离墙距离校验
  const limit = db.prepare("SELECT value FROM system_config WHERE key='wall_distance_limit'").get();
  if (wall_distance_cm && parseFloat(wall_distance_cm) > parseFloat(limit?.value || 10)) {
    return res.status(400).json({ error: `离墙距离${wall_distance_cm}cm超过限制${limit?.value || 10}cm，禁止绑定` });
  }

  db.prepare(`INSERT INTO devices (device_code,device_type,serial_number,hospital_id,install_location,wall_distance_cm,ip_address,install_date,status)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(device_code, device_type, serial_number || '', hospital.id, install_location || '', wall_distance_cm || null, ip_address || '', install_date || new Date().toISOString().slice(0, 10), '在线');

  db.prepare('INSERT INTO audit_logs (user_id,username,role,action_type,target_type,target_id,ip_address) VALUES (?,?,?,?,?,?,?)')
    .run(user.id, user.username, user.role, '设备绑定', 'device', device_code, req.ip);

  res.json({ success: true, device_code });
});

// 设备状态变更
app.patch('/api/devices/:device_code/status', (req, res) => {
  const db = getDbSync();
  const { device_code } = req.params;
  const { status } = req.body;

  const device = db.prepare('SELECT * FROM devices WHERE device_code = ?').get(device_code);
  if (!device) return res.status(404).json({ error: 'error' });

  const valid = ['在线', '离线', '维修中', '已报废'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'error' });

  db.prepare('UPDATE devices SET status=?,updated_at=datetime("now","localtime") WHERE device_code=?')
    .run(status, device_code);

  db.prepare('INSERT INTO audit_logs (user_id,username,role,action_type,target_type,target_id,old_value,new_value,ip_address) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(req.user.id, req.user.username, req.user.role, '设备状态变更', 'device', device_code, device.status, status, req.ip);

  res.json({ success: true });
});

// ======================= 需求管理=======================

// 需求列表
app.get('/api/demands', (req, res) => {
  const db = getDbSync();
  const { status, keyword, page = 1, page_size = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(page_size);

  let where = [];
  let params = [];
  if (status) { where.push('d.status = ?'); params.push(status); }
  if (keyword) { where.push('(d.demand_no LIKE ? OR d.title LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`); }

  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM demands d ${whereStr}`).get(...params).cnt;
  const rows = db.prepare(`
    SELECT d.*, h.hospital_name, u.real_name as submitter_name
    FROM demands d LEFT JOIN hospitals h ON d.source_hospital_id = h.id
    LEFT JOIN users u ON d.submitter_id = u.id
    ${whereStr} ORDER BY d.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(page_size), offset);

  res.json({ total, page: parseInt(page), page_size: parseInt(page_size), data: rows });
});

// 新建需求
app.post('/api/demands', (req, res) => {
  const db = getDbSync();
  const { title, description, source_hospital_code, priority } = req.body;

  if (!title || !description || description.length < 20) {
    return res.status(400).json({ error: 'error' });
  }

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const seq = db.prepare('SELECT COUNT(*) as cnt FROM demands WHERE demand_no LIKE ?').get(`XQ_${today}%`).cnt + 1;
  const demand_no = `XQ_${today}_${String(seq).padStart(3, '0')}`;

  let hospital_id = null;
  if (source_hospital_code) {
    const h = db.prepare('SELECT id FROM hospitals WHERE hospital_code = ?').get(source_hospital_code);
    if (h) hospital_id = h.id;
  }

  db.prepare('INSERT INTO demands (demand_no,title,description,source_hospital_id,submitter_id,priority) VALUES (?,?,?,?,?,?)')
    .run(demand_no, title, description, hospital_id, req.user.id, priority || '一般');

  db.prepare('INSERT INTO audit_logs (user_id,username,role,action_type,target_type,target_id,ip_address) VALUES (?,?,?,?,?,?,?)')
    .run(req.user.id, req.user.username, req.user.role, '创建需求', 'demand', demand_no, req.ip);

  res.json({ success: true, demand_no });
});

// 需求评估（仅总部）
app.post('/api/demands/:demand_no/evaluate', (req, res) => {
  const db = getDbSync();
  const { demand_no } = req.params;
  const { eval_result, reject_reason, estimated_launch_date, schedule_note, eval_note } = req.body;

  const demand = db.prepare('SELECT * FROM demands WHERE demand_no = ?').get(demand_no);
  if (!demand) return res.status(404).json({ error: '需求不存在' });

  if (eval_result === '已采纳') {
    if (!estimated_launch_date) return res.status(400).json({ error: 'error' });
    db.prepare('UPDATE demands SET status=?,eval_result=?,estimated_launch_date=?,schedule_note=?,eval_note=?,evaluator_id=?,eval_time=datetime("now","localtime"),updated_at=datetime("now","localtime") WHERE demand_no=?')
      .run('已采纳', eval_result, estimated_launch_date, schedule_note || '', eval_note || '', req.user.id, demand_no);
  } else if (eval_result === '已驳回') {
    if (!reject_reason || reject_reason.length < 10) return res.status(400).json({ error: '驳回时必须填写驳回原因（至少10字）' });
    db.prepare('UPDATE demands SET status=?,eval_result=?,reject_reason=?,eval_note=?,evaluator_id=?,eval_time=datetime("now","localtime"),updated_at=datetime("now","localtime") WHERE demand_no=?')
      .run('已驳回', eval_result, reject_reason, eval_note || '', req.user.id, demand_no);
  } else {
    return res.status(400).json({ error: 'error' });
  }

  db.prepare('INSERT INTO audit_logs (user_id,username,role,action_type,target_type,target_id,ip_address) VALUES (?,?,?,?,?,?,?)')
    .run(req.user.id, req.user.username, req.user.role, '需求评估', 'demand', demand_no, req.ip);

  res.json({ success: true });
});

// ======================= 巡检 =======================

// 巡检计划列表
app.get('/api/inspections/plans', (req, res) => {
  const db = getDbSync();
  const user = req.user;
  const isHQ = user.role === 'headquarters';
  const where = isHQ ? '' : 'WHERE p.responsible_engineer_id = ?';
  const params = isHQ ? [] : [user.id];
  const rows = db.prepare(`
    SELECT p.*, h.hospital_name, u.real_name as engineer_name,
           (SELECT COUNT(*) FROM inspection_records WHERE plan_id = p.id) as record_count
    FROM inspection_plans p
    LEFT JOIN hospitals h ON p.hospital_id = h.id
    LEFT JOIN users u ON p.responsible_engineer_id = u.id
    ${where}
    ORDER BY p.created_at DESC
  `).all(...params);
  res.json({ data: rows });
});

// 新建巡检计划
app.post('/api/inspections/plans', (req, res) => {
  const db = getDbSync();
  const { plan_name, hospital_code, device_codes, cycle, start_date } = req.body;

  if (!plan_name || !hospital_code || !cycle || !start_date) {
    return res.status(400).json({ error: '必填字段不能为空' });
  }

  const hospital = db.prepare('SELECT id FROM hospitals WHERE hospital_code = ?').get(hospital_code);
  if (!hospital) return res.status(400).json({ error: 'error' });

  // 总部可指定工程师，非总部默认自己
  const respEngineerId = (req.user.role === 'headquarters' && req.body.engineer_id) ? req.body.engineer_id : req.user.id;
  const rec = db.prepare('INSERT INTO inspection_plans (plan_name,hospital_id,device_codes,cycle,start_date,responsible_engineer_id,next_inspection_date) VALUES (?,?,?,?,?,?,?)')
    .run(plan_name, hospital.id, JSON.stringify(device_codes || []), cycle, start_date, respEngineerId, start_date);

  res.json({ success: true, plan_id: rec.lastInsertRowid });
});

// 更新巡检计划（暂停/恢复/结束 — 总部管理用）
app.patch('/api/inspections/plans/:id', (req, res) => {
  const db = getDbSync();
  if (req.user.role !== 'headquarters') return res.status(403).json({ error: 'error' });
  const id = parseInt(req.params.id);
  const { status, engineer_id } = req.body;
  const plan = db.prepare('SELECT * FROM inspection_plans WHERE id=?').get(id);
  if (!plan) return res.status(404).json({ error: 'error' });
  if (status) db.prepare('UPDATE inspection_plans SET status=? WHERE id=?').run(status, id);
  if (engineer_id) db.prepare('UPDATE inspection_plans SET responsible_engineer_id=? WHERE id=?').run(engineer_id, id);
  res.json({ message: 'ok' });
});

// 巡检记录
app.post('/api/inspections/records', (req, res) => {
  const db = getDbSync();
  const {
    plan_id, device_code, inspect_date,
    appearance_ok, wall_distance, ground_level,
    firmware_version, app_version, run_hours,
    ip_address, network_stable, packet_loss_rate,
    drug_inventory_ok, drug_low_stock_num, drug_expiring_num,
    screen_ok, scanner_ok, printer_ok, lock_ok,
    result, note, checklist_data
  } = req.body;

  const rec = db.prepare(`
    INSERT INTO inspection_records
    (plan_id,device_code,engineer_id,inspect_date,appearance_ok,wall_distance,ground_level,
     firmware_version,app_version,run_hours,ip_address,network_stable,packet_loss_rate,
     drug_inventory_ok,drug_low_stock_num,drug_expiring_num,
     screen_ok,scanner_ok,printer_ok,lock_ok,result,note,checklist_data)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(plan_id || null, device_code, req.user.id, inspect_date || new Date().toISOString().slice(0, 10),
    appearance_ok ? 1 : 0, wall_distance || null, ground_level || null,
    firmware_version || '', app_version || '', run_hours || 0,
    ip_address || '', network_stable ? 1 : 0, packet_loss_rate || null,
    drug_inventory_ok ? 1 : 0, drug_low_stock_num || 0, drug_expiring_num || 0,
    screen_ok ? 1 : 0, scanner_ok ? 1 : 0, printer_ok ? 1 : 0, lock_ok ? 1 : 0,
    result || '正常', note || '', checklist_data || null);

  // 更新下次巡检时间
  if (plan_id) {
    const plan = db.prepare('SELECT * FROM inspection_plans WHERE id = ?').get(plan_id);
    if (plan) {
      const next = new Date(inspect_date || new Date());
      if (plan.cycle === '每周') next.setDate(next.getDate() + 7);
      else if (plan.cycle === '每两周') next.setDate(next.getDate() + 14);
      else next.setMonth(next.getMonth() + 1);
      db.prepare('UPDATE inspection_plans SET next_inspection_date=? WHERE id=?')
        .run(next.toISOString().slice(0, 10), plan_id);
    }
  }

  db.prepare('INSERT INTO audit_logs (user_id,username,role,action_type,target_type,ip_address) VALUES (?,?,?,?,?,?)')
    .run(req.user.id, req.user.username, req.user.role, '提交巡检记录', 'inspection_record', req.ip);

  res.json({ success: true, record_id: rec.lastInsertRowid });
});

// 巡检记录列表（按计划ID 或 全部本人记录
app.get('/api/inspections/records', (req, res) => {
  const db = getDbSync();
  const { plan_id, page = 1, page_size = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(page_size);
  let where = [];
  let params = [];
  if (req.user.role !== 'headquarters') { where.push('ir.engineer_id = ?'); params.push(req.user.id); }
  if (plan_id) { where.push('ir.plan_id = ?'); params.push(parseInt(plan_id)); }
  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM inspection_records ir ${whereStr}`).get(...params).cnt;
  const rows = db.prepare(`
    SELECT ir.*, ip.plan_name, d.device_type, h.hospital_name
    FROM inspection_records ir
    LEFT JOIN inspection_plans ip ON ir.plan_id = ip.id
    LEFT JOIN devices d ON ir.device_code = d.device_code
    LEFT JOIN hospitals h ON d.hospital_id = h.id
    ${whereStr}
    ORDER BY ir.inspect_date DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(page_size), offset);
  res.json({ total, page: parseInt(page), page_size: parseInt(page_size), data: rows });
});

// 更新巡检记录结果（异常处理闭环）
app.patch('/api/inspections/records/:id', (req, res) => {
  const db = getDbSync();
  const { result, note } = req.body;
  const id = parseInt(req.params.id);
  const record = db.prepare('SELECT * FROM inspection_records WHERE id=?').get(id);
  if (!record) return res.status(404).json({ error: 'error' });
  if (result) {
    db.prepare("UPDATE inspection_records SET result=?,note=COALESCE(?,note),created_at=created_at WHERE id=?")
      .run(result, note || null, id);
  }
  res.json({ message: 'ok' });
});

// ======================= 巡检检查单管理（HQ 可配置） =======================

// 获取检查单（按区域分组）
app.get('/api/inspections/checklist', (req, res) => {
  const db = getDbSync();
  const items = db.prepare(
    "SELECT * FROM inspection_checklist_items WHERE status='active' ORDER BY zone_sort, sort_order"
  ).all();
  // 按区域分组
  const zones = [];
  const zoneMap = new Map();
  for (const item of items) {
    if (!zoneMap.has(item.zone_name)) {
      const zone = { name: item.zone_name, sort: item.zone_sort, items: [] };
      zoneMap.set(item.zone_name, zone);
      zones.push(zone);
    }
    zoneMap.get(item.zone_name).items.push(item);
  }
  zones.sort((a,b) => a.sort - b.sort);
  res.json({ data: zones });
});

// 获取所有检查项（HQ管理用，含禁用项）
app.get('/api/inspections/checklist/all', (req, res) => {
  const db = getDbSync();
  const items = db.prepare('SELECT * FROM inspection_checklist_items ORDER BY zone_sort, sort_order').all();
  res.json({ data: items });
});

// 新增检查项（HQ）
app.post('/api/inspections/checklist', (req, res) => {
  const db = getDbSync();
  if (req.user.role !== 'headquarters') return res.status(403).json({ error: '仅总部可操作' });
  const { zone_name, zone_sort, item_key, item_label, item_type, placeholder, is_required, sort_order } = req.body;
  if (!zone_name || !item_key || !item_label) return res.status(400).json({ error: '必填字段不能为空' });
  try {
    db.prepare(`INSERT INTO inspection_checklist_items (zone_name,zone_sort,item_key,item_label,item_type,placeholder,is_required,sort_order)
      VALUES (?,?,?,?,?,?,?,?)`)
      .run(zone_name, zone_sort||0, item_key, item_label, item_type||'checkbox', placeholder||null, is_required !== undefined ? is_required : 1, sort_order||0);
    res.json({ success: true });
  } catch(e) { res.status(400).json({ error: 'key重复或字段无效: ' + e.message }); }
});

// 编辑检查项（HQ）
app.patch('/api/inspections/checklist/:id', (req, res) => {
  const db = getDbSync();
  if (req.user.role !== 'headquarters') return res.status(403).json({ error: '仅总部可操作' });
  const { zone_name, zone_sort, item_label, item_type, placeholder, is_required, sort_order, status } = req.body;
  try {
    const fields = [];
    const vals = [];
    if (zone_name !== undefined) { fields.push('zone_name=?'); vals.push(zone_name); }
    if (zone_sort !== undefined) { fields.push('zone_sort=?'); vals.push(zone_sort); }
    if (item_label !== undefined) { fields.push('item_label=?'); vals.push(item_label); }
    if (item_type !== undefined) { fields.push('item_type=?'); vals.push(item_type); }
    if (placeholder !== undefined) { fields.push('placeholder=?'); vals.push(placeholder); }
    if (is_required !== undefined) { fields.push('is_required=?'); vals.push(is_required); }
    if (sort_order !== undefined) { fields.push('sort_order=?'); vals.push(sort_order); }
    if (status !== undefined) { fields.push('status=?'); vals.push(status); }
    fields.push("updated_at=datetime('now','localtime')");
    vals.push(parseInt(req.params.id));
    db.prepare(`UPDATE inspection_checklist_items SET ${fields.join(',')} WHERE id=?`).run(vals);
    res.json({ success: true });
  } catch(e) { res.status(400).json({ error: e.message }); }
});

// 删除检查项（HQ）
app.delete('/api/inspections/checklist/:id', (req, res) => {
  const db = getDbSync();
  if (req.user.role !== 'headquarters') return res.status(403).json({ error: '仅总部可操作' });
  db.prepare('DELETE FROM inspection_checklist_items WHERE id=?').run(parseInt(req.params.id));
  res.json({ success: true });
});

// ======================= 维保台账 =======================

// 维保记录列表
app.get('/api/maintenance', (req, res) => {
  const db = getDbSync();
  const { device_code, type, page = 1, page_size = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(page_size);

  let where = [];
  let params = [];
  if (device_code) { where.push('m.device_code = ?'); params.push(device_code); }
  if (type) { where.push('m.type = ?'); params.push(type); }

  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM maintenance_records m ${whereStr}`).get(...params).cnt;
  const rows = db.prepare(`
    SELECT m.*, d.device_type, h.hospital_name, u.real_name as operator_name
    FROM maintenance_records m
    LEFT JOIN devices d ON m.device_code = d.device_code
    LEFT JOIN hospitals h ON d.hospital_id = h.id
    LEFT JOIN users u ON m.operator_id = u.id
    ${whereStr} ORDER BY m.maintenance_date DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(page_size), offset);

  res.json({ total, page: parseInt(page), page_size: parseInt(page_size), data: rows });
});

// 新建维保记录
app.post('/api/maintenance', (req, res) => {
  const db = getDbSync();
  const { device_code, type, description, part_name, part_model, part_quantity, part_batch, maintenance_date } = req.body;

  if (!device_code || !type || !maintenance_date) {
    return res.status(400).json({ error: 'error' });
  }

  const today = maintenance_date.replace(/-/g, '');
  const seq = db.prepare('SELECT COUNT(*) as cnt FROM maintenance_records WHERE maintenance_no LIKE ?').get(`WB_${device_code.slice(-6)}_${today}%`).cnt + 1;
  const maintenance_no = `WB_${device_code.slice(-6)}_${today}_${String(seq).padStart(2, '0')}`;

  const rec = db.prepare(`INSERT INTO maintenance_records (maintenance_no,device_code,type,description,operator_id,part_name,part_model,part_quantity,part_batch,maintenance_date)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(maintenance_no, device_code, type, description || '', req.user.id, part_name || '', part_model || '', part_quantity || 0, part_batch || '', maintenance_date);

  // 维保固件升级时更新设备版本
  if (type === '固件升级' && req.body.firmware_version_after) {
    db.prepare('UPDATE devices SET firmware_version=? WHERE device_code=?').run(req.body.firmware_version_after, device_code);
  }

  db.prepare('INSERT INTO audit_logs (user_id,username,role,action_type,target_type,target_id,ip_address) VALUES (?,?,?,?,?,?,?)')
    .run(req.user.id, req.user.username, req.user.role, '创建维保记录', 'maintenance', maintenance_no, req.ip);

  res.json({ success: true, maintenance_no });
});

// ======================= 知识库=======================

// 知识库列表
app.get('/api/knowledge', (req, res) => {
  const db = getDbSync();
  const { keyword, category, page = 1, page_size = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(page_size);

  let where = [];
  let params = [];
  if (category) { where.push('kb.fault_category_l1 = ?'); params.push(category); }
  if (keyword) { where.push('(kb.title LIKE ? OR kb.description_summary LIKE ? OR kb.solution LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }

  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM knowledge_base kb ${whereStr}`).get(...params).cnt;
  const rows = db.prepare(`
    SELECT kb.*, u.real_name as author_name
    FROM knowledge_base kb LEFT JOIN users u ON kb.author_id = u.id
    ${whereStr} ORDER BY kb.reference_count DESC, kb.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(page_size), offset);

  res.json({ total, page: parseInt(page), page_size: parseInt(page_size), data: rows });
});

// 知识库搜索（必须在/:id 之前，否则/search 会被 :id 匹配
app.get('/api/knowledge/search', (req, res) => {
  const db = getDbSync();
  const { q, fault_no } = req.query;
  if (!q || q.length < 2) return res.json({ data: [] });

  const rows = db.prepare(`
    SELECT kb.*, u.real_name as author_name,
           (kb.view_count + kb.reference_count * 3) as relevance
    FROM knowledge_base kb LEFT JOIN users u ON kb.author_id = u.id
    WHERE kb.title LIKE ? OR kb.description_summary LIKE ? OR kb.solution LIKE ? OR kb.fault_category_l1 LIKE ?
    ORDER BY relevance DESC LIMIT 20
  `).all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);

  // 仅当从故障工单上下文搜索时，才记录引用
  if (fault_no && rows.length > 0 && req.user) {
    const top = rows[0];
    const fault = db.prepare('SELECT fault_no FROM fault_orders WHERE fault_no = ?').get(fault_no);
    if (fault) {
      const exist = db.prepare('SELECT id FROM knowledge_references WHERE knowledge_id=? AND fault_no=?').get(top.id, fault_no);
      if (!exist) {
        db.prepare('UPDATE knowledge_base SET reference_count=reference_count+1 WHERE id=?').run(top.id);
        db.prepare('INSERT INTO knowledge_references (knowledge_id,fault_no,engineer_id) VALUES (?,?,?)').run(top.id, fault_no, req.user.id);
        console.log(`[KB-REF] 工单 ${fault_no} 引用了知识#${top.id} "${top.title}"`);
      }
    }
  }

  res.json({ data: rows });
});

// 查询某工单已引用的知识库条目（必须在 /:id 之前）
app.get('/api/knowledge/references/:fault_no', (req, res) => {
  try {
    const db = getDbSync();
    const rows = db.prepare(`
      SELECT kr.*, kb.title, kb.fault_category_l1
      FROM knowledge_references kr
      JOIN knowledge_base kb ON kb.id = kr.knowledge_id
      WHERE kr.fault_no = ?
      ORDER BY kr.created_at DESC
    `).all(req.params.fault_no);
    res.json({ data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 知识库详情
app.get('/api/knowledge/:id', (req, res) => {
  const db = getDbSync();
  const row = db.prepare('SELECT kb.*, u.real_name as author_name FROM knowledge_base kb LEFT JOIN users u ON kb.author_id = u.id WHERE kb.id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'error' });
  db.prepare('UPDATE knowledge_base SET view_count=view_count+1 WHERE id=?').run(row.id);
  res.json(row);
});

// 新增知识库（手动录入）
app.post('/api/knowledge', (req, res) => {
  const db = getDbSync();
  const { fault_category_l1, fault_category_l2, title, description_summary, solution, applicable_models } = req.body;

  if (!fault_category_l1 || !title || !solution) return res.status(400).json({ error: 'error' });

  const rec = db.prepare('INSERT INTO knowledge_base (fault_category_l1,fault_category_l2,title,description_summary,solution,applicable_models,author_id) VALUES (?,?,?,?,?,?,?)')
    .run(fault_category_l1, fault_category_l2 || '', title, description_summary || '', solution, applicable_models || '', req.user.id);

  res.json({ success: true, id: rec.lastInsertRowid });
});

// ======================= 消息通知 =======================

// 引用知识库条目（从工单详情页点击"引用"按钮）
app.post('/api/knowledge/:id/reference', (req, res) => {
  try {
    const db = getDbSync();
    const id = parseInt(req.params.id);
    const { fault_no } = req.body;
    if (!fault_no) return res.status(400).json({ error: 'error' });

    // 校验工单存在
    const fault = db.prepare('SELECT fault_no FROM fault_orders WHERE fault_no = ?').get(fault_no);
    if (!fault) return res.status(404).json({ error: 'error' });

    // 校验知识条目存在
    const kb = db.prepare('SELECT id,title FROM knowledge_base WHERE id = ?').get(id);
    if (!kb) return res.status(404).json({ error: 'error' });

    // 防重：同工单同知识条目不重复计数
    const exist = db.prepare(
      'SELECT id FROM knowledge_references WHERE knowledge_id = ? AND fault_no = ?'
    ).get(id, fault_no);
    if (!exist) {
      db.prepare('UPDATE knowledge_base SET reference_count = reference_count + 1 WHERE id = ?').run(id);
      db.prepare(
        'INSERT INTO knowledge_references (knowledge_id,fault_no,engineer_id) VALUES (?,?,?)'
      ).run(id, fault_no, req.user?.id || null);
      console.log(`[KB-REF] 工单 ${fault_no} 引用知识 #${id} "${kb.title}"`);
    }

    res.json({ message: 'ok' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 消息列表
app.get('/api/notifications', (req, res) => {
  const db = getDbSync();
  const { page = 1, page_size = 20, unread_only } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(page_size);
  const unreadWhere = unread_only === 'true' ? 'AND n.is_read = 0' : '';

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM notifications n WHERE n.target_user_id = ? ${unreadWhere}`).get(req.user.id).cnt;
  const rows = db.prepare(`
    SELECT n.* FROM notifications n
    WHERE n.target_user_id = ? ${unreadWhere}
    ORDER BY n.created_at DESC LIMIT ? OFFSET ?
  `).all(req.user.id, parseInt(page_size), offset);

  res.json({ total, page: parseInt(page), page_size: parseInt(page_size), data: rows });
});

// 标记已读
app.patch('/api/notifications/:id/read', (req, res) => {
  const db = getDbSync();
  db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND target_user_id=?').run(req.params.id, req.user.id);
  res.json({ success: true });
});

// 全部已读
app.post('/api/notifications/read-all', (req, res) => {
  const db = getDbSync();
  db.prepare('UPDATE notifications SET is_read=1 WHERE target_user_id=?').run(req.user.id);
  res.json({ success: true });
});

// ======================= 医院管理 =======================

// 医院列表
// ======================= 医院管理 =======================
app.get('/api/hospitals', (req, res) => {
  const db = getDbSync();
  const user = req.user;
  const { keyword, page = 1, page_size = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(page_size);

  const accessFilter = regionFilter.buildHospitalAccessFilter(user, 'h', db);
  let where = [];
  let params = [];
  if (keyword) { where.push('(h.hospital_name LIKE ? OR h.hospital_code LIKE ? OR h.province LIKE ? OR h.city LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
  const whereStr = accessFilter.sql + (where.length ? ' AND ' + where.join(' AND ') : '');
  const allParams = [...accessFilter.params, ...params];

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM hospitals h WHERE 1=1${whereStr}`).get(...allParams).cnt;
  const rows = db.prepare(`
    SELECT h.*, u.real_name as engineer_name, a.company_name as supplier_name
    FROM hospitals h
    LEFT JOIN users u ON h.engineer_id = u.id
    LEFT JOIN users a ON h.supplier_id = a.id
    WHERE 1=1${whereStr}
    ORDER BY h.hospital_name LIMIT ? OFFSET ?
  `).all(...allParams, parseInt(page_size), offset);
  res.json({ total, page: parseInt(page), page_size: parseInt(page_size), data: rows });
});

// 新建医院（供应商可自主创建）
app.post('/api/hospitals', (req, res) => {
  const db = getDbSync();
  const user = req.user;
  const { hospital_name, province, city, region, address, contact_person, contact_phone, hospital_level, bed_count } = req.body;

  if (!hospital_name || !province || !city) return res.status(400).json({ error: 'error' });

  // 重复校验
  const dup = db.prepare('SELECT id FROM hospitals WHERE hospital_name = ?').get(hospital_name);
  if (dup) return res.status(400).json({ error: 'error' });

  // 生成 hospital_code
  const cnt = db.prepare('SELECT COUNT(*) as cnt FROM hospitals').get().cnt;
  const hospital_code = 'H' + String(cnt + 1).padStart(3, '0');

  // 确定 supplier_id（技术人员创建时归属其上级代理商）
  let supplierId = null;
  if (user.role === 'provincial_agent' || user.role === 'city_agent') {
    supplierId = user.id;
  } else if (user.role === 'engineer') {
    supplierId = user.parent_agent_id;
  }

  const resolvedRegion = region || regionFilter.getRegion(province);
  db.prepare(`
    INSERT INTO hospitals (hospital_code, hospital_name, province, city, region, address, contact_person, contact_phone, supplier_id, source, hospital_level, bed_count)
    VALUES (?,?,?,?,?,?,?,?,?,'manual',?,?)
  `).run(hospital_code, hospital_name, province, city, resolvedRegion, address || '', contact_person || '', contact_phone || '', supplierId, hospital_level || '', bed_count || 0);

  const newH = db.prepare('SELECT * FROM hospitals WHERE hospital_code = ?').get(hospital_code);
  res.json({ success: true, data: newH });
});

// 编辑医院（总部/供应商可编辑）
app.put('/api/hospitals/:id', (req, res) => {
  const db = getDbSync();
  const user = req.user;
  const { id } = req.params;
  const { hospital_name, province, city, address, contact_person, contact_phone, hospital_level, bed_count, engineer_id, supplier_id } = req.body;

  const h = db.prepare('SELECT * FROM hospitals WHERE id = ?').get(id);
  if (!h) return res.status(404).json({ error: 'error' });

  // 权限检查
  if (user.role !== 'headquarters') {
    if (user.role === 'provincial_agent' || user.role === 'city_agent') {
      if (h.supplier_id !== user.id) return res.status(403).json({ error: '无权编辑其他供应商的医院' });
    } else {
      return res.status(403).json({ error: 'error' });
    }
  }

  // 名称重复检查
  if (hospital_name && hospital_name !== h.hospital_name) {
    const dup = db.prepare('SELECT id FROM hospitals WHERE hospital_name = ? AND id != ?').get(hospital_name, id);
    if (dup) return res.status(400).json({ error: '医院名称重复' });
  }

  const regionVal = province ? regionFilter.getRegion(province) : h.region;
  db.prepare(`
    UPDATE hospitals SET hospital_name=?, province=?, city=?, region=?, address=?, contact_person=?, contact_phone=?,
    hospital_level=?, bed_count=?, engineer_id=?, supplier_id=?, updated_at=datetime('now','localtime')
    WHERE id=?
  `).run(
    hospital_name || h.hospital_name,
    province || h.province,
    city || h.city,
    regionVal,
    address !== undefined ? address : h.address,
    contact_person !== undefined ? contact_person : h.contact_person,
    contact_phone !== undefined ? contact_phone : h.contact_phone,
    hospital_level !== undefined ? hospital_level : h.hospital_level,
    bed_count !== undefined ? bed_count : h.bed_count,
    engineer_id !== undefined ? engineer_id : h.engineer_id,
    supplier_id !== undefined ? supplier_id : h.supplier_id,
    id
  );

  const updated = db.prepare('SELECT * FROM hospitals WHERE id = ?').get(id);
  res.json({ success: true, data: updated });
});

// ======================= 审计日志（仅总部）=======================

app.get('/api/audit-logs', (req, res) => {
  const db = getDbSync();
  const { action_type, username, keyword, start_date, end_date, page = 1, page_size = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(page_size);

  let where = [];
  let params = [];
  if (action_type) { where.push('action_type = ?'); params.push(action_type); }
  if (username) { where.push('username LIKE ?'); params.push(`%${username}%`); }
  if (start_date) { where.push('created_at >= ?'); params.push(start_date); }
  if (end_date) { where.push('created_at <= ?'); params.push(end_date + ' 23:59:59'); }
  if (keyword) { where.push('(target_id LIKE ? OR old_value LIKE ? OR new_value LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }

  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM audit_logs ${whereStr}`).get(...params).cnt;
  const rows = db.prepare(`
    SELECT * FROM audit_logs ${whereStr} ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(page_size), offset);

  res.json({ total, page: parseInt(page), page_size: parseInt(page_size), data: rows });
});

// ======================= 统计数据 =======================

app.get('/api/statistics', (req, res) => {
  const db = getDbSync();
  const { start_date, end_date } = req.query;
  const dateFilter = (start_date && end_date) ? `WHERE created_at >= '${start_date}' AND created_at <= '${end_date} 23:59:59'` : '';

  const faultByLevel = db.prepare(`SELECT fault_level, COUNT(*) as cnt FROM fault_orders ${dateFilter.replace('WHERE', 'WHERE ')} GROUP BY fault_level`).all();
  const faultByCategory = db.prepare(`SELECT fault_category_l1, COUNT(*) as cnt FROM fault_orders ${dateFilter} GROUP BY fault_category_l1`).all();
  const faultByStatus = db.prepare(`SELECT status, COUNT(*) as cnt FROM fault_orders ${dateFilter} GROUP BY status`).all();
  const faultTrend = db.prepare(`
    SELECT date(created_at) as date, COUNT(*) as cnt, SUM(CASE WHEN status='已闭环' THEN 1 ELSE 0 END) as closed
    FROM fault_orders WHERE created_at >= datetime('now','localtime','-30 days')
    GROUP BY date(created_at) ORDER BY date ASC
  `).all();
  const deviceOnlineRate = db.prepare('SELECT COUNT(*) as total, SUM(CASE WHEN status = "在线" THEN 1 ELSE 0 END) as online FROM devices').get();
  const avgResponseTime = db.prepare(`
    SELECT AVG(
      julianday(investigation_time) * 86400 - julianday(created_at) * 86400
    ) as avg_seconds FROM fault_orders WHERE investigation_time IS NOT NULL ${dateFilter}
  `).get();
  const demandStats = db.prepare('SELECT status, COUNT(*) as cnt FROM demands GROUP BY status').all();

  res.json({
    fault_by_level: faultByLevel,
    fault_by_category: faultByCategory,
    fault_by_status: faultByStatus,
    fault_trend: faultTrend,
    device_online_rate: deviceOnlineRate.total > 0 ? Math.round(deviceOnlineRate.online / deviceOnlineRate.total * 100) : 0,
    avg_response_hours: avgResponseTime.avg_seconds ? Math.round(avgResponseTime.avg_seconds / 3600 * 10) / 10 : 0,
    demand_stats: demandStats
  });
});

// ======================= 备件管理 =======================

app.get('/api/spare-parts', (req, res) => {
  const db = getDbSync();
  const rows = db.prepare('SELECT * FROM spare_parts ORDER BY part_name').all();
  res.json({ data: rows });
});

app.post('/api/spare-parts', (req, res) => {
  const db = getDbSync();
  const { part_name, part_model, unit, stock_quantity, safety_stock } = req.body;
  if (!part_name) return res.status(400).json({ error: '配件名称不能为空' });

  db.prepare('INSERT INTO spare_parts (part_name,part_model,unit,stock_quantity,safety_stock) VALUES (?,?,?,?,?)')
    .run(part_name, part_model || '', unit || '个', stock_quantity || 0, safety_stock || 5);

  res.json({ success: true });
});

app.patch('/api/spare-parts/:id', (req, res) => {
  const db = getDbSync();
  const { stock_quantity } = req.body;
  db.prepare('UPDATE spare_parts SET stock_quantity=? WHERE id=?').run(stock_quantity, req.params.id);
  res.json({ success: true });
});

// ======================= 系统接口 =======================

// 系统状态
app.get('/api/status', (req, res) => {
  const db = getDbSync();
  const cfg = {};
  db.prepare('SELECT key, value FROM system_config').all().forEach(r => cfg[r.key] = r.value);
  res.json({ status: 'online', version: cfg['app_version'] || '2.0.0', config: cfg });
});

// 字典表
app.get('/api/dicts', (req, res) => {
  const db = getDbSync();
  const provinces = db.prepare(`SELECT DISTINCT province FROM hospitals WHERE province IS NOT NULL AND province != '' ORDER BY province`).all().map(r => r.province);
  const cities = db.prepare(`SELECT DISTINCT city FROM hospitals WHERE city IS NOT NULL AND city != '' ORDER BY city`).all().map(r => r.city);
  res.json({
    fault_levels: ['一般', '紧急', '重大'],
    fault_categories_l1: ['硬件', '软件', '网络', '耗材', '其他'],
    device_types: ['台式', '立式'],
    device_status: ['在线', '离线', '维修中', '已报废'],
    flow_status: ['待处理', '处理中', '待复核', '已闭环'],
    demand_status: ['待评估', '已采纳', '已驳回', '已上线'],
    demand_priority: ['一般', '紧急', '重大'],
    inspection_cycles: ['每周', '每两周', '每月'],
    inspection_results: ['正常', '异常待处理', '已处理'],
    maintenance_types: ['配件更换', '固件升级', '清洁保养', '校准调试', '其他'],
    feedback_methods: ['电话', '现场', '微信'],
    satisfaction_levels: ['非常满意', '满意', '一般', '不满意'],
    user_roles: [
      { value: 'engineer', label: '工程师' },
      { value: 'dealer', label: '经销商' },
      { value: 'headquarters', label: '总部' }
    ],
    provinces: provinces,
    cities: cities,
  });
});

// 全局异常处理
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

// 获取局域网 IP
function getLanIP() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal && iface.address.startsWith('192.168.')) {
        return iface.address;
      }
    }
  }
  return null;
}

// 启动
initDb().then(() => {
  console.log('[DB] 数据库初始化完成');
  const server = app.listen(PORT, () => {
    const lanIP = getLanIP();
    console.log('\n[服务器] 麻精药品智能柜售后运维工具已启动');
    console.log(`[服务器] 本机访问: http://localhost:${PORT}`);
    if (lanIP) console.log(`[服务器] 局域网访问: http://${lanIP}:${PORT}`);
    console.log(`[服务器] 数据目录: ${DATA_DIR}`);
    console.log('\n默认账号:');
    console.log('  省代: dealer01 / 123456');
    console.log('  市代(广州): dealer02 / 123456');
    console.log('  市代(深圳): dealer03 / 123456');
    console.log('  工程师(广州): engineer01 / 123456');
    console.log('  工程师(深圳): engineer02 / 123456');
    console.log('  总部: admin01 / 123456');
  });
}).catch(err => {
  console.error('[DB] 数据库初始化失败:', err);
  process.exit(1);
});

module.exports = app;