/**
 * API 客户端 & 应用核心
 * 麻精药品智能柜售后运维工具
 */
const API = {
  baseURL: '',
  token: localStorage.getItem('token') || '',
  user: JSON.parse(localStorage.getItem('user') || 'null'),

  async request(method, path, data, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = this.token;

    const fetchOpts = { method, headers };
    if (data && method !== 'GET') fetchOpts.body = JSON.stringify(data);

    try {
      const resp = await fetch(this.baseURL + path, fetchOpts);
      const json = await resp.json();
      if (!resp.ok && resp.status === 401) {
        this.logout();
        throw new Error('登录已过期');
      }
      if (!resp.ok) throw new Error(json.error || '请求失败');
      return json;
    } catch (e) {
      if (opts.silent) return null;
      if (e.message.includes('登录已过期')) return null;
      throw e;
    }
  },

  get(path, opts) { return this.request('GET', path, null, opts); },
  post(path, data, opts) { return this.request('POST', path, data, opts); },
  patch(path, data, opts) { return this.request('PATCH', path, data, opts); },
  put(path, data, opts) { return this.request('PUT', path, data, opts); },
  del(path, opts) { return this.request('DELETE', path, null, opts); },

  async login(username, password) {
    const r = await this.post('/api/auth/login', { username, password });
    this.token = r.token;
    this.user = r.user;
    localStorage.setItem('token', r.token);
    localStorage.setItem('user', JSON.stringify(r.user));
    return r.user;
  },

  logout() {
    this.token = '';
    this.user = null;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/';
  },

  // 快捷方法
  faults: {
    list(params) { return API.get('/api/faults?' + new URLSearchParams(params)); },
    detail(no) { return API.get(`/api/faults/${no}`); },
    create(data) { return API.post('/api/faults', data); },
    investigate(no, data) { return API.post(`/api/faults/${no}/investigate`, data); },
    fix(no, data) { return API.post(`/api/faults/${no}/fix`, data); },
    review(no, data) { return API.post(`/api/faults/${no}/review`, data); },
    feedback(no, data) { return API.post(`/api/faults/${no}/feedback`, data); },
  },
  devices: {
    list(params) { return API.get('/api/devices?' + new URLSearchParams(params)); },
    detail(code) { return API.get(`/api/devices/${code}`); },
    bind(data) { return API.post('/api/devices', data); },
    updateStatus(code, status) { return API.patch(`/api/devices/${code}/status`, { status }); },
  },
  demands: {
    list(params) { return API.get('/api/demands?' + new URLSearchParams(params)); },
    create(data) { return API.post('/api/demands', data); },
    evaluate(no, data) { return API.post(`/api/demands/${no}/evaluate`, data); },
  },
  knowledge: {
    list(params) { return API.get('/api/knowledge?' + new URLSearchParams(params)); },
    detail(id) { return API.get(`/api/knowledge/${id}`); },
    search(q, fault_no) {
      const params = new URLSearchParams({ q: q || '' });
      if (fault_no) params.set('fault_no', fault_no);
      return API.get('/api/knowledge/search?' + params.toString());
    },
    create(data) { return API.post('/api/knowledge', data); },
    reference(id, fault_no) { return API.post(`/api/knowledge/${id}/reference`, { fault_no }); },
    faultReferences(fault_no) { return API.get(`/api/knowledge/references/${fault_no}`); },
  },
  inspections: {
    plans() { return API.get('/api/inspections/plans'); },
    createPlan(data) { return API.post('/api/inspections/plans', data); },
    submitRecord(data) { return API.post('/api/inspections/records', data); },
    records(params) { return API.get('/api/inspections/records?' + new URLSearchParams(params)); },
    updateRecord(id, data) { return API.patch('/api/inspections/records/' + id, data); },
  },
  maintenance: {
    list(params) { return API.get('/api/maintenance?' + new URLSearchParams(params)); },
    create(data) { return API.post('/api/maintenance', data); },
  },
  hospitals: {
    list() { return API.get('/api/hospitals'); },
  },
  notifications: {
    list(params) { return API.get('/api/notifications?' + new URLSearchParams(params)); },
    read(id) { return API.patch(`/api/notifications/${id}/read`); },
    readAll() { return API.post('/api/notifications/read-all'); },
  },
  dashboard() { return API.get('/api/dashboard'); },
  statistics(params) { return API.get('/api/statistics?' + new URLSearchParams(params)); },
  auditLogs(params) { return API.get('/api/audit-logs?' + new URLSearchParams(params)); },
  spareParts() { return API.get('/api/spare-parts'); },
  dicts() { return API.get('/api/dicts'); },
  escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  },
  // 配件管理
  parts: {
    list(params) { return API.get('/api/parts?' + new URLSearchParams(params)); },
    detail(id) { return API.get('/api/parts/' + id); },
    create(data) { return API.post('/api/parts', data); },
    update(id, data) { return API.patch('/api/parts/' + id, data); },
    adjust(id, data) { return API.post('/api/parts/' + id + '/adjust', data); },
    stats() { return API.get('/api/parts/stats'); },
    del(id) { return API.del('/api/parts/' + id); },
  },
  // 用户管理
  users: {
    list(params) { return API.get('/api/users?' + new URLSearchParams(params)); },
    detail(id) { return API.get('/api/users/' + id); },
    create(data) { return API.post('/api/users', data); },
    update(id, data) { return API.patch('/api/users/' + id, data); },
    toggle(id) { return API.patch('/api/users/' + id + '/toggle'); },
    resetPassword(id, pwd) { return API.post('/api/users/' + id + '/reset-password', { password: pwd }); },
  },
};

// ========== Toast 通知 ==========
const Toast = {
  show(msg, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer') || (() => {
      const c = document.createElement('div');
      c.id = 'toastContainer';
      c.className = 'toast-container';
      document.body.appendChild(c);
      return c;
    })();

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = msg;
    container.appendChild(el);

    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.3s';
      setTimeout(() => el.remove(), 300);
    }, duration);
  },
  success(msg) { this.show(msg, 'success'); },
  error(msg) { this.show(msg, 'error', 5000); },
};

// ========== 模态框 ==========
const Modal = {
  show(contentHtml, title = '', opts = {}) {
    const existing = document.querySelector('.modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay show';
    overlay.innerHTML = `
      <div class="modal" style="${opts.width ? 'max-width:' + opts.width + 'px' : ''}">
        <div class="modal-header">
          <h3>${title}</h3>
          <button class="modal-close">&times;</button>
        </div>
        <div class="modal-body">${contentHtml}</div>
        ${opts.footer || ''}
      </div>
    `;

    overlay.querySelector('.modal-close').onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    document.body.appendChild(overlay);
    return overlay;
  },
  hide() {
    const o = document.querySelector('.modal-overlay');
    if (o) o.remove();
  },
};

// ========== 工具函数 ==========
function formatDate(d) {
  if (!d) return '-';
  return new Date(d + (d.includes('Z') ? '' : '+08:00')).toLocaleString('zh-CN', { hour12: false });
}

function maskPhone(p) {
  if (!p || p.length !== 11) return p || '-';
  return p.slice(0, 3) + '****' + p.slice(7);
}

function getLevelTag(level) {
  const map = { '重大': 'danger', '紧急': 'warning', '一般': 'info' };
  return `<span class="tag tag-${map[level] || 'info'}">${level}</span>`;
}

function getStatusTag(status) {
  const map = {
    '待处理': 'warning', '处理中': 'info', '待复核': 'info', '已闭环': 'success',
    '待评估': 'warning', '已采纳': 'success', '已驳回': 'danger', '已上线': 'primary',
    '在线': 'success', '离线': 'danger', '维修中': 'warning', '已报废': 'danger',
    '正常': 'success', '异常待处理': 'warning', '已处理': 'info',
  };
  return `<span class="tag tag-${map[status] || 'info'}">${status}</span>`;
}

function getStars(score) {
  if (!score) return '-';
  let s = '';
  for (let i = 1; i <= 5; i++) {
    s += `<span class="${i <= score ? '' : 'empty'}">★</span>`;
  }
  return s;
}

// ========== 快捷提示 ==========
function showToast(msg, type) { Toast.show(msg, type); }

// ========== 离线检测 ==========
function checkOnlineStatus() {
  const badge = document.getElementById('offlineBadge');
  const sync = document.getElementById('syncStatus');
  if (!navigator.onLine && badge) {
    badge.classList.add('show');
    if (sync) sync.textContent = '离线模式';
  } else if (badge) {
    badge.classList.remove('show');
    if (sync) sync.textContent = '已连接';
  }
}

window.addEventListener('online', checkOnlineStatus);
window.addEventListener('offline', checkOnlineStatus);
checkOnlineStatus();