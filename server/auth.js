/**
 * 认证中间件 v2.0
 * 支持：engineer / provincial_agent / city_agent / headquarters
 * 数据权限：市代 < 省代 < 总部（总部看全部）
 */
const crypto = require('crypto');
const { getDbSync } = require('./db');

// Token 过期时间（7天）
const TOKEN_EXPIRE_MS = 7 * 24 * 60 * 60 * 1000;

// 白名单：无需认证的接口（精确匹配，避免 / 匹配所有路径）
const PUBLIC_PATHS = [
  '/auth/login',
];

// 生成 token（用随机 bytes，安全随机，无签名但防篡改）
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 登录
function login(req, res) {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });

    const db = getDbSync();
    const user = db.prepare(`
      SELECT id,username,password_hash,real_name,role,agent_level,parent_agent_id,
             company_name,position,phone,email,province,city,region,
             responsible_provinces,responsible_cities,status
      FROM users WHERE username = ? AND status = 'active'
    `).get(username);

    if (!user) return res.status(401).json({ error: '用户名或密码错误' });

    const bcrypt = require('bcryptjs');
    if (!bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const token = generateToken();
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRE_MS).toISOString();

    // 删除旧 token
    db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(user.id);
    db.prepare('INSERT INTO user_sessions (user_id, token, expires_at) VALUES (?, ?, ?)').run(user.id, token, expiresAt);

    // 更新最后登录时间
    db.prepare("UPDATE users SET last_login = datetime('now','localtime') WHERE id = ?").run(user.id);

    // 审计日志
    logAudit(db, user.id, user.username, user.role, '登录', 'user', String(user.id), null, token.substring(0, 8) + '...');

    const { password_hash, ...safeUser } = user;
    res.json({ token, user: safeUser });

  } catch (e) {
    console.error('[AUTH] 登录失败:', e.message);
    res.status(500).json({ error: '服务器内部错误' });
  }
}

// 登出
function logout(req, res) {
  try {
    const db = getDbSync();
    const user = req.user;
    if (user) {
      db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(user.id);
      logAudit(db, user.id, user.username, user.role, '登出', 'user', String(user.id), null, null);
    }
    res.json({ message: '已退出登录' });
  } catch (e) {
    res.status(500).json({ error: '服务器错误' });
  }
}

// 改密
function changePassword(req, res) {
  try {
    const user = req.user;
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.status(400).json({ error: '参数不完整' });
    if (newPassword.length < 6) return res.status(400).json({ error: '新密码至少6位' });

    const db = getDbSync();
    const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    const bcrypt = require('bcryptjs');
    if (!bcrypt.compareSync(oldPassword, u.password_hash)) {
      return res.status(400).json({ error: '原密码错误' });
    }

    const newHash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime("now","localtime") WHERE id = ?').run(newHash, user.id);
    logAudit(db, user.id, user.username, user.role, '修改密码', 'user', String(user.id), null, null);
    res.json({ message: '密码修改成功' });

  } catch (e) {
    res.status(500).json({ error: '服务器错误' });
  }
}

// 获取当前用户
function getCurrentUser(req, res) {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: '未登录' });
    const db = getDbSync();
    const u = db.prepare(`
      SELECT id,username,real_name,role,agent_level,parent_agent_id,
             company_name,position,phone,email,province,city,region,
             responsible_provinces,responsible_cities,status,last_login
      FROM users WHERE id = ?
    `).get(user.id);
    if (!u) return res.status(404).json({ error: '用户不存在' });
    res.json({ user: u });
  } catch (e) {
    res.status(500).json({ error: '服务器错误' });
  }
}

// 中间件
function authMiddleware(req, res, next) {
  // 白名单（精确匹配，防止 / 匹配所有路径）
  if (PUBLIC_PATHS.some(p => p === req.path)) return next();

  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (!authHeader) return res.status(401).json({ error: '未登录，请先登录' });

  const token = authHeader.trim();
  if (!token || token.length < 32) return res.status(401).json({ error: '无效token' });

  try {
    const db = getDbSync();
    const session = db.prepare(`
      SELECT s.user_id, s.expires_at, u.id,u.username,u.real_name,u.role,
             u.agent_level,u.parent_agent_id,u.company_name,u.position,
             u.phone,u.email,u.province,u.city,u.region,
             u.responsible_provinces,u.responsible_cities,u.status
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ?
    `).get(token);

    if (!session) return res.status(401).json({ error: 'token无效或已过期' });

    const now = Date.now();
    const expiresAt = new Date(session.expires_at).getTime();
    if (now > expiresAt) {
      db.prepare('DELETE FROM user_sessions WHERE token = ?').run(token);
      return res.status(401).json({ error: '登录已过期，请重新登录' });
    }

    if (session.status !== 'active') return res.status(403).json({ error: '账号已被禁用' });

    // 挂载用户信息到 req
    const { expires_at, password_hash, ...safeUser } = session;
    req.user = safeUser;
    next();

  } catch (e) {
    console.error('[AUTH] 认证失败:', e.message);
    res.status(500).json({ error: '服务器内部错误' });
  }
}

// 审计日志
function logAudit(db, userId, username, role, actionType, targetType, targetId, oldValue, newValue) {
  try {
    db.prepare(`
      INSERT INTO audit_logs (user_id,username,role,action_type,target_type,target_id,old_value,new_value,ip_address,user_agent)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      userId, username, role, actionType, targetType, targetId,
      oldValue || null, newValue || null,
      null, null
    );
  } catch (e) {
    console.error('[AUDIT]', e.message);
  }
}

// 权限检查：总部专用
function requireHeadquarters(req, res, next) {
  if (req.user.role !== 'headquarters') return res.status(403).json({ error: '仅总部账号可用' });
  next();
}

// 权限检查：省代及以上（总部/省代可用）
function requireAgentOrAbove(req, res, next) {
  const allowed = ['headquarters', 'provincial_agent', 'city_agent'];
  if (!allowed.includes(req.user.role)) return res.status(403).json({ error: '权限不足' });
  next();
}

module.exports = { authMiddleware, login, logout, changePassword, getCurrentUser, requireHeadquarters, requireAgentOrAbove, logAudit };