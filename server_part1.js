const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, '..', 'data', 'yt_asmt.db');
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

// ======================= 数据库 =======================
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('[DB] 连接失败:', err.message);
  else console.log('[DB] 已连接到', DB_PATH);
});
db.run('PRAGMA foreign_keys = ON');

function getDb() { return db; }
function getDbSync() { return db; }  // 兼容旧调用

// ======================= 认证中间件 =======================
function authMiddleware(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: '未登录' });
  db.get('SELECT id, username, role, real_name FROM users WHERE id = ?', [req.session.userId], (err, user) => {
    if (err || !user) return res.status(401).json({ error: '用户不存在' });
    req.user = user;
    next();
  });
}

// ======================= 地域过滤辅助 =======================
const regionFilter = {
  buildRegionFilter(user, alias) {
    if (user.role === 'headquarters') return { sql: '', params: [] };
    const col = alias ? `${alias}.province` : 'province';
    if (user.role === 'provincial_agent') {
      return { sql: ` AND ${col} = ?`, params: [user.province] };
    }
    if (user.role === 'city_agent') {
      return { sql: ` AND ${col} = ? AND city = ?`, params: [user.province, user.city] };
    }
    return { sql: '', params: [] };
  },
  buildHospitalAccessFilter(user) {
    if (user.role === 'headquarters') return { sql: '', params: [] };
    if (user.role === 'engineer') return { sql: ' AND (h.id IN (SELECT hospital_id FROM devices WHERE engineer_id = ?) OR h.engineer_id = ?)', params: [user.id, user.id] };
    return { sql: '', params: [] };
  }
};

// ======================= 登录 API =======================
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  const hash = crypto.createHash('sha256').update(password).digest('hex');
  db.get('SELECT id, username, role, real_name FROM users WHERE username = ? AND password = ?', [username, hash], (err, user) => {
    if (err) return res.status(500).json({ error: '数据库错误' });
    if (!user) return res.status(401).json({ error: '用户名或密码错误' });
    req.session.userId = user.id;
    res.json({ token: 'session', user });
  });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ message: '已退出登录' }));
});

// ======================= 仪表盘 =======================
app.get('/api/dashboard', authMiddleware, (req, res) => {
  const user = req.user;
  const isHQ = user.role === 'headquarters';
  const isEngineer = user.role === 'engineer';

  // 工单统计
  let faultWhere = isEngineer ? 'WHERE f.engineer_id = ?' : '';
  let faultParams = isEngineer ? [user.id] : [];
  db.get(`
    SELECT 
      SUM(CASE WHEN f.status = '待处理' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN f.status = '处理中' THEN 1 ELSE 0 END) as processing,
      SUM(CASE WHEN f.status = '待复核' THEN 1 ELSE 0 END) as review,
      SUM(CASE WHEN f.status = '已闭环' THEN 1 ELSE 0 END) as closed,
      SUM(CASE WHEN f.fault_level = '重大' AND f.status != '已闭环' THEN 1 ELSE 0 END) as major_pending,
      SUM(CASE WHEN f.fault_level = '紧急' AND f.status != '已闭环' THEN 1 ELSE 0 END) as urgent_pending
    FROM fault_orders f ${faultWhere}`, faultParams, (err, faultStats) => {
    if (err) return res.status(500).json({ error: '统计失败' });

    // 设备统计
    let deviceWhere = isEngineer ? 'WHERE d.engineer_id = ?' : '';
    let deviceParams = isEngineer ? [user.id] : [];
    db.get(`
      SELECT 
        SUM(CASE WHEN d.status = '在线' THEN 1 ELSE 0 END) as online,
        SUM(CASE WHEN d.status = '离线' THEN 1 ELSE 0 END) as offline,
        SUM(CASE WHEN d.status = '维修中' THEN 1 ELSE 0 END) as maintenance,
        SUM(CASE WHEN d.status = '已报废' THEN 1 ELSE 0 END) as scrapped
      FROM devices d ${deviceWhere}`, deviceParams, (err2, deviceStats) => {
      if (err2) return res.status(500).json({ error: '统计失败' });

      // 待巡检
      let inspWhere = '';
      let inspParams = [];
      if (isEngineer) {
        inspWhere = 'WHERE responsible_engineer_id = ? AND status = ? AND next_inspection_date <= date("now","+3 days")';
        inspParams = [user.id, '进行中'];
      } else if (!isHQ) {
        inspWhere = 'WHERE status = ? AND next_inspection_date <= date("now","+3 days")';
        inspParams = ['进行中'];
      }
      db.get(`SELECT COUNT(*) as cnt FROM inspection_plans ${inspWhere}`, inspParams, (err3, inspRow) => {
        if (err3) return res.status(500).json({ error: '统计失败' });

        res.json({
          faults: faultStats || {},
          devices: deviceStats || {},
          pendingInspection: inspRow ? inspRow.cnt : 0
        });
      });
    });
  });
});

// ======================= 工单管理 API =======================
// 工单列表
app.get('/api/fault-orders', authMiddleware, (req, res) => {
  const user = req.user;
  const { status, keyword, page = 1, page_size = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(page_size);

  let where = [];
  let params = [];

  if (user.role === 'engineer') {
    where.push('f.engineer_id = ?');
    params.push(user.id);
  } else if (user.role !== 'headquarters') {
    const f = regionFilter.buildRegionFilter(user, 'h');
    if (f.sql) { where.push(f.sql.replace(/^ AND /, ' AND ')); params.push(...f.params); }
  }

  if (status) { where.push('f.status = ?'); params.push(status); }
  if (keyword) { where.push('(f.fault_no LIKE ? OR f.description LIKE ? OR h.hospital_name LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }

  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.get(`SELECT COUNT(*) as cnt FROM fault_orders f LEFT JOIN devices d ON f.device_code = d.device_code LEFT JOIN hospitals h ON d.hospital_id = h.id ${whereStr}`, params).cnt;

  const rows = db.prepare(`
    SELECT f.*, d.device_type, h.hospital_name, u.real_name as engineer_name
    FROM fault_orders f
    LEFT JOIN devices d ON f.device_code = d.device_code
    LEFT JOIN hospitals h ON d.hospital_id = h.id
    LEFT JOIN users u ON f.engineer_id = u.id
    ${whereStr} ORDER BY f.created_at DESC LIMIT ? OFFSET ?`).all(...params, parseInt(page_size), offset);

  res.json({ total, page: parseInt(page), page_size: parseInt(page_size), data: rows });
});

// 新建工单
app.post('/api/fault-orders', authMiddleware, (req, res) => {
  const user = req.user;
  const { device_code, description, contact_person, contact_phone } = req.body;

  if (!device_code || !description) return res.status(400).json({ error: '设备编码和故障描述不能为空' });
  if (description.length < 10) return res.status(400).json({ error: '故障描述至少10个字符' });

  const device = db.get('SELECT * FROM devices WHERE device_code = ?', [device_code]);
  if (!device) return res.status(400).json({ error: '设备不存在，请先绑定设备' });

  // 自动分类
  let fault_level = '一般';
  const d = description;
  if (/硬件|损坏|无法启动|显示屏|卡死/.test(d)) fault_level = '重大';
  if (/网络|断网|通信|系统调试/.test(d)) fault_level = '紧急';

  const today = new Date().toISOString().slice(0, 10);
  db.get('SELECT COUNT(*) as c FROM fault_orders WHERE date(created_at) = ?', [today], (err, row) => {
    const seq = String((row ? row.c : 0) + 1).padStart(4, '0');
    const fault_no = `FW_${device_code.slice(-6)}_${today.replace(/-/g,'')}_${seq}`;

    db.run('INSERT INTO fault_orders (fault_no,device_code,description,fault_level,status,contact_person,contact_phone,engineer_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [fault_no, device_code, description, fault_level, '待处理', contact_person || '', contact_phone || '', user.id, new Date().toISOString()],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });

        // 流程日志
        db.run('INSERT INTO fault_flow_logs (fault_no,node_name,operator_id,operator_name,action) VALUES (?,?,?,?,?)',
          [fault_no, '新建工单', user.id, user.real_name, '创建故障工单']);

        // 审计日志
        db.run('INSERT INTO audit_logs (user_id,username,role,action_type,target_type,target_id,ip_address) VALUES (?,?,?,?,?,?,?)',
          [user.id, user.username, user.role, '创建工单', 'fault_order', fault_no, req.ip]);

        // 重大故障通知总部
        if (fault_level === '重大') {
          const admins = db.all('SELECT id FROM users WHERE role = ?', ['headquarters']);
          admins.forEach(admin => {
            db.run('INSERT INTO notifications (target_user_id,fault_no,title,content,category,level) VALUES (?,?,?,?,?,?)',
              [admin.id, fault_no, `故障升级提醒：${fault_no}`, `工单 ${fault_no} 被标记为大故障，请关注处理`, '故障', '重大']);
          });
        }

        res.json({ fault_no, message: '工单已创建' });
      }
    );
  });
});
