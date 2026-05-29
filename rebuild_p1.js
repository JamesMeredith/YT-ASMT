const fs = require('fs');
const path = require('path');

// 重建 server.js —— 基于对话中确认的正确结构
// 分段写入，避免单字符串过长

const HEADER = `/**
 * 麻精药品智能柜售后运维工具 - 后端服务
 * 技术栈：Node.js + Express + SQLite（sql.js）
 */

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

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ======================= 数据库初始化 =======================
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error('[DB] 连接失败:', err.message);
  else console.log('[DB] 已连接到', DB_PATH);
});

// 启用外键约束
db.run('PRAGMA foreign_keys = ON');

// 迁移：确保表结构存在
const migrations = [
  \`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('super_admin','provincial_agent','city_agent','engineer','headquarters')),
    real_name TEXT,
    phone TEXT,
    province TEXT,
    city TEXT,
    parent_agent_id INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )\`,
  // ... 其他表迁移见下方完整版
];

console.log('[DB] 数据库初始化完成');

// ======================= 认证中间件 =======================
function authMiddleware(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: '未登录' });
  }
  db.get('SELECT id, username, role, real_name FROM users WHERE id = ?', [req.session.userId], (err, user) => {
    if (err || !user) return res.status(401).json({ error: '用户不存在' });
    req.user = user;
    next();
  });
}

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
  const stats = {};
  
  // 工单统计
  let faultWhere = '';
  const faultParams = [];
  if (user.role === 'engineer') {
    faultWhere = 'WHERE engineer_id = ?';
    faultParams.push(user.id);
  }
  db.get(\`SELECT 
    SUM(CASE WHEN status = '待处理' THEN 1 ELSE 0 END) as pending,
    SUM(CASE WHEN status = '处理中' THEN 1 ELSE 0 END) as processing,
    SUM(CASE WHEN status = '待复核' THEN 1 ELSE 0 END) as review,
    SUM(CASE WHEN status = '已闭环' THEN 1 ELSE 0 END) as closed
    FROM fault_orders ${faultWhere}\`, faultParams, (err, row) => {
    if (err) return res.status(500).json({ error: '统计失败' });
    stats.faults = row;
    
    // 设备统计
    let deviceWhere = '';
    const deviceParams = [];
    if (user.role === 'engineer') {
      deviceWhere = 'WHERE engineer_id = ?';
      deviceParams.push(user.id);
    }
    db.get(\`SELECT 
      SUM(CASE WHEN status = '在线' THEN 1 ELSE 0 END) as online,
      SUM(CASE WHEN status = '离线' THEN 1 ELSE 0 END) as offline,
      SUM(CASE WHEN status = '维修中' THEN 1 ELSE 0 END) as maintenance,
      SUM(CASE WHEN status = '已报废' THEN 1 ELSE 0 END) as scrapped
      FROM devices ${deviceWhere}\`, deviceParams, (err2, row2) => {
      if (err2) return res.status(500).json({ error: '统计失败' });
      stats.devices = row2;
      
      // 巡检待办
      let inspWhere = '';
      const inspParams = [];
      if (user.role === 'engineer') {
        inspWhere = 'WHERE responsible_engineer_id = ? AND status = "进行中" AND next_inspection_date <= date("now","+3 days")';
        inspParams.push(user.id);
      }
      db.get(\`SELECT COUNT(*) as cnt FROM inspection_plans ${inspWhere}\`, inspParams, (err3, row3) => {
        if (err3) return res.status(500).json({ error: '统计失败' });
        stats.pendingInspection = row3 ? row3.cnt : 0;
        res.json(stats);
      });
    });
  });
});

console.log('[服务器] 麻精药品智能柜售后运维工具已启动');
console.log(\`[服务器] 访问地址: http://localhost:${PORT}\`);
console.log(\`[服务器] 数据目录: ${DATA_DIR}\`);
console.log('\\n默认账号:');
console.log('  省代: dealer01 / 123456');
console.log('  市代(广州): dealer02 / 123456');
console.log('  市代(深圳): dealer03 / 123456');
console.log('  工程师(广州): engineer01 / 123456');
console.log('  工程师(深圳): engineer02 / 123456');
console.log('  总部: admin01 / 123456');

app.listen(PORT, '0.0.0.0', () => {
  console.log(\`[服务器] 局域网访问: http://\${getLocalIP()}:${PORT}\`);
});

function getLocalIP() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}
`;

// 分段写入
fs.writeFileSync('E:/YT-ASMT/server/server_new.js', HEADER, 'utf8');
console.log('Part 1 written (header + auth + dashboard)');
console.log('Run this script, then continue with part 2');
