/**
 * 数据库初始化与Schema定义 v2.0
 * 麻精药品智能柜售后运维工具
 * 新增：省代/市代体系、配件管理、地区字段
 * 基于 sql.js (WASM SQLite)，无需原生编译
 */
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'yt_asmt.db');

let _rawDb = null;
let saveTimer = null;

// ============================================================
// 省市 → 大区 映射
// ============================================================
const PROVINCE_REGION_MAP = {
  '北京市': '华北', '天津市': '华北', '河北省': '华北', '山西省': '华北', '内蒙古': '华北',
  '辽宁省': '东北', '吉林省': '东北', '黑龙江省': '东北',
  '上海市': '华东', '江苏省': '华东', '浙江省': '华东', '安徽省': '华东', '福建省': '华东', '江西省': '华东', '山东省': '华东',
  '河南省': '华中', '湖北省': '华中', '湖南省': '华中',
  '广东省': '华南', '广西': '华南', '海南省': '华南',
  '四川省': '西南', '重庆市': '西南', '贵州省': '西南', '云南省': '西南', '西藏': '西南',
  '陕西省': '西北', '甘肃省': '西北', '青海省': '西北', '宁夏': '西北', '新疆': '西北',
  '香港': '华南', '澳门': '华南', '台湾': '华南'
};

function getRegion(province) {
  return PROVINCE_REGION_MAP[province] || '未知';
}

// ============================================================
// WrappedStatement → better-sqlite3 风格 API
// ============================================================
class WrappedStatement {
  constructor(rawDb, sql) { this._db = rawDb; this._sql = sql; }
  run(...params) {
    const p = _norm(params);
    const s = this._db.prepare(this._sql);
    try { if (p.length) s.bind(p); s.step(); }
    finally { s.free(); }
    scheduleSave();
    return { lastInsertRowid: _val(this._db, 'last_insert_rowid'), changes: _val(this._db, 'changes') };
  }
  get(...params) {
    const p = _norm(params);
    const s = this._db.prepare(this._sql);
    try { if (p.length) s.bind(p); return s.step() ? s.getAsObject() : undefined; }
    finally { s.free(); }
  }
  all(...params) {
    const p = _norm(params);
    const s = this._db.prepare(this._sql);
    try { if (p.length) s.bind(p); const r = []; while (s.step()) r.push(s.getAsObject()); return r; }
    finally { s.free(); }
  }
}
function _norm(params) { return (params.length === 1 && Array.isArray(params[0])) ? params[0] : params; }

class DatabaseWrapper {
  constructor(rawDb) { this._db = rawDb; }
  prepare(sql) { return new WrappedStatement(this._db, sql); }
  exec(sql) { this._db.run(sql); scheduleSave(); }
}

function _val(db, fn) {
  const r = db.exec(`SELECT ${fn}() as v`);
  return (r.length && r[0].values.length) ? r[0].values[0][0] : 0;
}

// ============================================================
// 保存（异步防抖，500ms窗口内合并写入）
// ============================================================
function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveDb(), 500);
}
function saveDb() {
  if (!_rawDb) return;
  try { fs.writeFileSync(DB_PATH, Buffer.from(_rawDb.export())); }
  catch (e) { console.error('[DB] 保存失败:', e.message); }
}

// ============================================================
// 初始化
// ============================================================
async function getDb() {
  if (_rawDb) return _rawDb;
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) { _rawDb = new SQL.Database(fs.readFileSync(DB_PATH)); console.log('[DB] 已从磁盘加载'); runMigrations(_rawDb); }
  else { _rawDb = new SQL.Database(); console.log('[DB] 创建新数据库'); initSchema(_rawDb); seedData(_rawDb); saveDb(); }
  return _rawDb;
}

async function initDb() { return getDb(); }

function getDbSync() {
  if (!_rawDb) throw new Error('数据库尚未初始化');
  return new DatabaseWrapper(_rawDb);
}

// ============================================================
// 数据库迁移（增量更新，新版本新增表/字段）
// ============================================================
function runMigrations(raw) {
  const E = (sql) => { try { raw.run(sql); console.log('[MIGRATE] ' + sql.substring(0, 60)); } catch (e) { /* ignore duplicate */ } };
  // V2.1: 知识库引用关联表
  E(`CREATE TABLE IF NOT EXISTS knowledge_references (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    knowledge_id INTEGER NOT NULL REFERENCES knowledge_base(id),
    fault_no VARCHAR(32) REFERENCES fault_orders(fault_no),
    engineer_id INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);
  E('CREATE INDEX IF NOT EXISTS idx_kbref_knowledge ON knowledge_references(knowledge_id)');
  E('CREATE INDEX IF NOT EXISTS idx_kbref_fault ON knowledge_references(fault_no)');
  // V3.0: 售中模块
  E(`CREATE TABLE IF NOT EXISTS pre_sales_node_defs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, node_index INTEGER NOT NULL, node_name VARCHAR(64) NOT NULL,
    stage VARCHAR(16) NOT NULL CHECK(stage IN ('远程前','远程后','现场')),
    is_remote TINYINT DEFAULT 0, work_items_json TEXT, required_materials_json TEXT DEFAULT '[]',
    description TEXT, created_at DATETIME DEFAULT (datetime('now','localtime')), updated_at DATETIME DEFAULT (datetime('now','localtime')),
    UNIQUE(node_index)
  )`);
  E(`CREATE TABLE IF NOT EXISTS pre_sales_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_no VARCHAR(32) UNIQUE NOT NULL,
    hospital_id INTEGER NOT NULL REFERENCES hospitals(id), device_code VARCHAR(32), device_type VARCHAR(10),
    engineer_id INTEGER NOT NULL REFERENCES users(id), hospital_name VARCHAR(128),
    province VARCHAR(32), city VARCHAR(32), region VARCHAR(32),
    status VARCHAR(16) DEFAULT '进行中' CHECK(status IN ('进行中','已验收','已转入售后','已取消')),
    completion_percent INTEGER DEFAULT 0, current_node_index INTEGER DEFAULT 1,
    acceptance_passed TINYINT DEFAULT 0, accepted_at DATETIME,
    install_location VARCHAR(256), install_ip VARCHAR(45), install_device_info TEXT,
    created_at DATETIME DEFAULT (datetime('now','localtime')), updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);
  E(`CREATE TABLE IF NOT EXISTS pre_sales_node_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_no VARCHAR(32) NOT NULL REFERENCES pre_sales_projects(project_no),
    node_def_id INTEGER NOT NULL REFERENCES pre_sales_node_defs(id), node_index INTEGER NOT NULL,
    node_name VARCHAR(64), stage VARCHAR(16), is_remote TINYINT DEFAULT 0,
    status VARCHAR(16) DEFAULT '未开始' CHECK(status IN ('未开始','进行中','已完成')),
    started_at DATETIME, completed_at DATETIME, materials_uploaded TINYINT DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now','localtime')), updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);
  E(`CREATE TABLE IF NOT EXISTS pre_sales_work_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, node_progress_id INTEGER NOT NULL REFERENCES pre_sales_node_progress(id),
    item_index INTEGER NOT NULL, item_name VARCHAR(256), completed TINYINT DEFAULT 0,
    completed_at DATETIME, created_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);
  E(`CREATE TABLE IF NOT EXISTS pre_sales_materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT, node_progress_id INTEGER NOT NULL REFERENCES pre_sales_node_progress(id),
    file_name VARCHAR(256) NOT NULL, file_path VARCHAR(512) NOT NULL, file_type VARCHAR(16),
    uploaded_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);
  E(`CREATE TABLE IF NOT EXISTS pre_sales_issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT, project_no VARCHAR(32) NOT NULL REFERENCES pre_sales_projects(project_no),
    node_progress_id INTEGER NOT NULL REFERENCES pre_sales_node_progress(id),
    reporter_id INTEGER NOT NULL REFERENCES users(id), reporter_name VARCHAR(32),
    issue_text TEXT NOT NULL, issue_photos TEXT, status VARCHAR(16) DEFAULT '待回复' CHECK(status IN ('待回复','已回复','已闭环')),
    reply_text TEXT, reply_by INTEGER REFERENCES users(id), reply_at DATETIME,
    created_at DATETIME DEFAULT (datetime('now','localtime')), updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);
  E('CREATE INDEX IF NOT EXISTS idx_psp_engineer ON pre_sales_projects(engineer_id)');
  E('CREATE INDEX IF NOT EXISTS idx_psp_status ON pre_sales_projects(status)');
  E('CREATE INDEX IF NOT EXISTS idx_psnp_project ON pre_sales_node_progress(project_no)');
  E('CREATE INDEX IF NOT EXISTS idx_pswi_node ON pre_sales_work_items(node_progress_id)');
  E('CREATE INDEX IF NOT EXISTS idx_psi_project ON pre_sales_issues(project_no)');

  // 如果 node_defs 为空，补种默认节点定义
  const defResult = raw.exec('SELECT COUNT(*) as cnt FROM pre_sales_node_defs');
  const defCount = defResult.length > 0 ? defResult[0].values[0][0] : -1;
  if (defCount === 0) {
    const nodeDefs = [
      { idx:1, name:'到场前-基础对接准备', stage:'远程前', remote:1,
        items:['对接医院负责人，确认安装位置、环境、时间','核对环境：干燥通风、无直射/潮湿','核对空间：台式/立式尺寸、离墙≤10cm','确认电源：接地插座、稳定供电','确认网络：内网接口、可分配固定IP'],
        materials:['环境现场照片','空间尺寸勘测记录','电源/网络接口确认截图'] },
      { idx:2, name:'到场前-系统对接准备', stage:'远程前', remote:1,
        items:['远程对接科室，确认取药/回收业务流程','对接信息科，提交《系统接口文档》','敲定对接方案：交互模式、数据、同步频率','确认服务器IP、VPN/远程方式','远程部署Web平台，测试连通'],
        materials:['业务流程参数确认单','接口文档提交记录','服务器配置截图','Web平台部署成功截图'] },
      { idx:3, name:'到场后-开箱验收', stage:'现场', remote:0,
        items:['检查设备外观完整性（无划痕/变形）','核对配件清单，确认齐全','确认设备型号/序列号与合同一致'],
        materials:['设备外观照片','配件清单核对照片','开箱验收单'] },
      { idx:4, name:'到场后-设备安装部署', stage:'现场', remote:0,
        items:['设备就位、调整水平','连接电源线、网线','配置设备IP并录入系统','确认指示灯正常、网络连通'],
        materials:['安装完成照片','IP地址分配表'] },
      { idx:5, name:'到场后-接口联调', stage:'现场', remote:0,
        items:['HIS系统接口对接测试','数据同步功能验证'],
        materials:['接口联调日志','联调确认截图'] },
      { idx:6, name:'到场后-系统调试配置', stage:'现场', remote:0,
        items:['设备基本参数配置','药品数据库导入/初始化','用户权限配置','预警规则配置','异常处理流程测试'],
        materials:['系统配置截图'] },
      { idx:7, name:'到场后-操作培训交付', stage:'现场', remote:0,
        items:['现场操作教学','使用答疑','交付操作手册'],
        materials:['培训现场照片','交付凭证/签字确认单'] },
      { idx:8, name:'到场后-最终验收', stage:'现场', remote:0,
        items:['核心功能全流程测试','硬件状态全面检查','用户确认签字'],
        materials:['功能测试截图','硬件检查报告','最终验收单'] }
    ];
    const stmt = raw.prepare('INSERT INTO pre_sales_node_defs (node_index,node_name,stage,is_remote,work_items_json,required_materials_json) VALUES (?,?,?,?,?,?)');
    for (const n of nodeDefs) {
      const itemsJson = JSON.stringify(n.items);
      const matsJson = JSON.stringify(n.materials);
      stmt.run([n.idx, n.name, n.stage, n.remote, itemsJson, matsJson]);
      stmt.reset();
    }
    stmt.free();
    console.log('[MIGRATE] 已补种8个默认售中节点定义');
  }

  // V3.2: 设备型号管理
  E(`CREATE TABLE IF NOT EXISTS device_models (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_code VARCHAR(32) UNIQUE NOT NULL,
    model_name VARCHAR(64) NOT NULL,
    device_type VARCHAR(16) CHECK(device_type IN ('立式','台式')),
    manufacturer VARCHAR(64),
    specification TEXT,
    description TEXT,
    status VARCHAR(16) DEFAULT 'active' CHECK(status IN ('active','discontinued')),
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);
  E('CREATE INDEX IF NOT EXISTS idx_device_models_code ON device_models(model_code)');

  // 补种默认设备型号
  const dmResult = raw.exec('SELECT COUNT(*) as v FROM device_models');
  const dmCount = (dmResult.length && dmResult[0].values.length) ? dmResult[0].values[0][0] : -1;
  if (dmCount === 0) {
    raw.run(`INSERT INTO device_models (model_code,model_name,device_type,manufacturer,specification) VALUES
      ('FTNG-T-YT01','麻精药品智能柜（台式）','台式','丰通宁','台面放置型，支持取药/回收双功能，联网管理'),
      ('FTNG-L-YT01','麻精药品智能柜（立式）','立式','丰通宁','落地式，容量更大，支持取药/回收双功能，联网管理')
    `);
    console.log('[MIGRATE] 已补种2个默认设备型号');
  }

  // V3.1: 医院表增加供应商绑定与售后负责人字段
  E('ALTER TABLE hospitals ADD COLUMN supplier_id INTEGER REFERENCES users(id)');
  E('ALTER TABLE hospitals ADD COLUMN engineer_id INTEGER REFERENCES users(id)');
  E('ALTER TABLE hospitals ADD COLUMN source VARCHAR(16) DEFAULT "manual"');
  E('ALTER TABLE hospitals ADD COLUMN responsible_person VARCHAR(32)');
  E('ALTER TABLE hospitals ADD COLUMN responsible_phone VARCHAR(11)');
  E('ALTER TABLE hospitals ADD COLUMN hospital_level VARCHAR(16)');
  E('ALTER TABLE hospitals ADD COLUMN bed_count INTEGER');
  E('ALTER TABLE hospitals ADD COLUMN updated_at DATETIME');
  E('CREATE INDEX IF NOT EXISTS idx_hospital_supplier ON hospitals(supplier_id)');
  E('CREATE INDEX IF NOT EXISTS idx_hospital_engineer ON hospitals(engineer_id)');
  E('ALTER TABLE pre_sales_projects ADD COLUMN closed_at DATETIME');

  // V4.1: 节点5/6工作项调整（异常处理流程测试移到节点6）
  try {
    const nd5 = raw.exec("SELECT work_items_json FROM pre_sales_node_defs WHERE node_index=5");
    const nd6 = raw.exec("SELECT work_items_json FROM pre_sales_node_defs WHERE node_index=6");
    if (nd5.length && nd5[0].values.length && nd6.length && nd6[0].values.length) {
      const j5 = JSON.parse(nd5[0].values[0][0] || '[]');
      const j6 = JSON.parse(nd6[0].values[0][0] || '[]');
      if (j5.includes('异常处理流程测试') && !j6.includes('异常处理流程测试')) {
        const new5 = j5.filter(x => x !== '异常处理流程测试');
        const new6 = [...j6, '异常处理流程测试'];
        raw.run("UPDATE pre_sales_node_defs SET work_items_json=?,updated_at=datetime('now','localtime') WHERE node_index=5", [JSON.stringify(new5)]);
        raw.run("UPDATE pre_sales_node_defs SET work_items_json=?,updated_at=datetime('now','localtime') WHERE node_index=6", [JSON.stringify(new6)]);
        console.log('[MIGRATE] 已调整节点5/6工作项（异常处理流程测试→节点6）');
      }
    }
  } catch(e) { /* skip if nodes don't exist yet */ }

  // V4.2: 巡检检查单可配置化
  E(`CREATE TABLE IF NOT EXISTS inspection_checklist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zone_name VARCHAR(32) NOT NULL,
    zone_sort INTEGER NOT NULL DEFAULT 0,
    item_key VARCHAR(64) NOT NULL UNIQUE,
    item_label VARCHAR(128) NOT NULL,
    item_type VARCHAR(16) NOT NULL DEFAULT 'checkbox' CHECK(item_type IN ('checkbox','text','number')),
    placeholder VARCHAR(128),
    is_required TINYINT DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(16) DEFAULT 'active' CHECK(status IN ('active','inactive')),
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);
  E('CREATE INDEX IF NOT EXISTS idx_icitem_zone ON inspection_checklist_items(zone_sort,sort_order)');
  E('ALTER TABLE inspection_records ADD COLUMN checklist_data TEXT');

  // 补种默认检查项
  const chkResult = raw.exec('SELECT COUNT(*) as cnt FROM inspection_checklist_items');
  const chkCount = chkResult.length > 0 ? chkResult[0].values[0][0] : -1;
  if (chkCount === 0) {
    const items = [
      {zone:'外观与安装',zs:1,key:'appearance_ok',label:'设备外观正常',type:'checkbox',req:1,so:1},
      {zone:'外观与安装',zs:1,key:'wall_distance',label:'离墙距离(cm)',type:'number',ph:'如：10',req:0,so:2},
      {zone:'外观与安装',zs:1,key:'ground_level',label:'地面水平度(°)',type:'number',ph:'如：0.5',req:0,so:3},
      {zone:'系统与网络',zs:2,key:'firmware_version',label:'Firmware版本',type:'text',ph:'如：v2.1.0',req:0,so:1},
      {zone:'系统与网络',zs:2,key:'app_version',label:'APP版本',type:'text',ph:'如：1.8.2',req:0,so:2},
      {zone:'系统与网络',zs:2,key:'run_hours',label:'运行时长(h)',type:'number',ph:'如：720',req:0,so:3},
      {zone:'系统与网络',zs:2,key:'ip_address',label:'IP地址',type:'text',ph:'如：192.168.1.100',req:0,so:4},
      {zone:'系统与网络',zs:2,key:'network_stable',label:'网络稳定',type:'checkbox',req:1,so:5},
      {zone:'系统与网络',zs:2,key:'packet_loss_rate',label:'Ping丢包率(%)',type:'number',ph:'如：0',req:0,so:6},
      {zone:'药品管理',zs:3,key:'drug_inventory_ok',label:'库存盘点正常',type:'checkbox',req:1,so:1},
      {zone:'药品管理',zs:3,key:'drug_low_stock_num',label:'低库存药品数',type:'number',ph:'如：0',req:0,so:2},
      {zone:'药品管理',zs:3,key:'drug_expiring_num',label:'临期药品数',type:'number',ph:'如：0',req:0,so:3},
      {zone:'硬件状态',zs:4,key:'screen_ok',label:'触摸屏',type:'checkbox',req:0,so:1},
      {zone:'硬件状态',zs:4,key:'scanner_ok',label:'扫码枪',type:'checkbox',req:0,so:2},
      {zone:'硬件状态',zs:4,key:'printer_ok',label:'打印机',type:'checkbox',req:0,so:3},
      {zone:'硬件状态',zs:4,key:'lock_ok',label:'锁具',type:'checkbox',req:0,so:4}
    ];
    const stmt = raw.prepare('INSERT INTO inspection_checklist_items (zone_name,zone_sort,item_key,item_label,item_type,placeholder,is_required,sort_order) VALUES (?,?,?,?,?,?,?,?)');
    for (const i of items) {
      stmt.run([i.zone, i.zs, i.key, i.label, i.type, i.ph || null, i.req, i.so]);
      stmt.reset();
    }
    stmt.free();
    console.log('[MIGRATE] 已补种17项默认巡检检查单');
  }

  // 为已有医院自动匹配供应商（基于省份）
  const hResult = raw.exec('SELECT COUNT(*) as v FROM hospitals WHERE supplier_id IS NULL');
  const hCount = (hResult.length && hResult[0].values.length) ? hResult[0].values[0][0] : 0;
  if (hCount > 0) {
    // 按省份查找对应的省代
    const agents = raw.exec('SELECT id, responsible_provinces FROM users WHERE role IN ("provincial_agent","city_agent")');
    if (agents.length && agents[0].values.length) {
      const agentList = agents[0].values.map(v => ({id:v[0], provinces: v[1] ? JSON.parse(v[1]) : []}));
      const hospitals = raw.exec('SELECT id, province FROM hospitals WHERE supplier_id IS NULL');
      if (hospitals.length && hospitals[0].values.length) {
        const stmt = raw.prepare('UPDATE hospitals SET supplier_id=? WHERE id=?');
        for (const [hid, hprovince] of hospitals[0].values) {
          const agent = agentList.find(a => a.provinces.includes(hprovince));
          if (agent) stmt.run([agent.id, hid]);
        }
        stmt.free();
        console.log('[MIGRATE] 已为医院补填供应商归属');
      }
    }
  }
}

// ============================================================
// Schema
// ============================================================
function initSchema(raw) {
  const E = (sql) => { try { raw.run(sql); } catch (e) { console.error('[SCHEMA]', e.message); } };

  // ============================================================
  // 用户表 v2.0：支持省代/市代层级
  // ============================================================
  E(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username VARCHAR(32) UNIQUE NOT NULL,
    password_hash VARCHAR(128) NOT NULL,
    real_name VARCHAR(32) NOT NULL,
    -- role: 工程师 | provincial_agent(省代) | city_agent(市代) | headquarters(总部)
    role VARCHAR(20) NOT NULL CHECK(role IN ('engineer','provincial_agent','city_agent','headquarters')),
    -- agent_level: 省代/市代时填写，工程师和总部留空
    agent_level VARCHAR(16) CHECK(agent_level IN ('provincial','city')),
    -- 所属上级代理商（市代指向省代id）
    parent_agent_id INTEGER REFERENCES users(id),
    -- 公司信息
    company_name VARCHAR(128),
    company_address VARCHAR(256),
    position VARCHAR(32),
    phone VARCHAR(11) NOT NULL,
    email VARCHAR(64),
    -- 负责区域
    province VARCHAR(32),
    city VARCHAR(32),
    region VARCHAR(32),
    -- 省代负责的省份（JSON数组，如 '["广东省","广西"]'）
    responsible_provinces TEXT,
    -- 市代负责的城市（JSON数组，如 '["广州市","深圳市"]'）
    responsible_cities TEXT,
    status VARCHAR(8) DEFAULT 'active' CHECK(status IN ('active','disabled')),
    last_login DATETIME,
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  // ============================================================
  // 医院表 v2.0：增加大区字段
  // ============================================================
  E(`CREATE TABLE IF NOT EXISTS hospitals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hospital_code VARCHAR(16) UNIQUE NOT NULL,
    hospital_name VARCHAR(128) NOT NULL,
    province VARCHAR(32),
    city VARCHAR(32),
    region VARCHAR(32),
    address VARCHAR(256),
    contact_person VARCHAR(32),
    contact_phone VARCHAR(11),
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  // ============================================================
  // 设备表（不变）
  // ============================================================
  E(`CREATE TABLE IF NOT EXISTS devices (
    device_code VARCHAR(32) PRIMARY KEY, device_type VARCHAR(10) NOT NULL CHECK(device_type IN ('台式','立式')),
    serial_number VARCHAR(64) UNIQUE, hospital_id INTEGER REFERENCES hospitals(id),
    install_location VARCHAR(128), wall_distance_cm DECIMAL(4,1), ground_level_degree DECIMAL(4,2),
    ip_address VARCHAR(45), network_status VARCHAR(8) DEFAULT 'offline',
    status VARCHAR(10) DEFAULT '在线' CHECK(status IN ('在线','离线','维修中','已报废')),
    firmware_version VARCHAR(32), app_version VARCHAR(32), last_inspection_date DATETIME, last_sync_time DATETIME,
    install_date DATETIME, created_at DATETIME DEFAULT (datetime('now','localtime')), updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  // ============================================================
  // 故障工单（不变）
  // ============================================================
  E(`CREATE TABLE IF NOT EXISTS fault_orders (
    fault_no VARCHAR(32) PRIMARY KEY, device_code VARCHAR(32) NOT NULL REFERENCES devices(device_code),
    fault_level VARCHAR(10) NOT NULL CHECK(fault_level IN ('一般','紧急','重大')),
    fault_category_l1 VARCHAR(32) NOT NULL, fault_category_l2 VARCHAR(64), description TEXT NOT NULL,
    status VARCHAR(10) DEFAULT '待处理' CHECK(status IN ('待处理','处理中','待复核','已闭环')),
    contact_person VARCHAR(32), contact_phone VARCHAR(11), engineer_id INTEGER REFERENCES users(id),
    hospital_id INTEGER REFERENCES hospitals(id),
    investigation_result TEXT, investigation_time DATETIME, root_cause TEXT, solution TEXT, fix_completed_time DATETIME,
    reviewer_id INTEGER REFERENCES users(id), review_result VARCHAR(8), review_time DATETIME, review_note TEXT,
    feedback_method VARCHAR(8), feedback_score_1 INTEGER, feedback_score_2 INTEGER, feedback_score_3 INTEGER,
    feedback_satisfaction VARCHAR(16), feedback_note TEXT, feedback_time DATETIME, feedback_completed TINYINT DEFAULT 0,
    resolved_at DATETIME, closed_at DATETIME, closed_by INTEGER REFERENCES users(id), sync_status VARCHAR(8) DEFAULT '未同步',
    created_at DATETIME DEFAULT (datetime('now','localtime')), updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  E(`CREATE TABLE IF NOT EXISTS fault_flow_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, fault_no VARCHAR(32) NOT NULL REFERENCES fault_orders(fault_no),
    node_name VARCHAR(32) NOT NULL, operator_id INTEGER REFERENCES users(id), operator_name VARCHAR(32),
    action VARCHAR(64), detail TEXT, created_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  E(`CREATE TABLE IF NOT EXISTS fault_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, fault_no VARCHAR(32) NOT NULL REFERENCES fault_orders(fault_no),
    file_name VARCHAR(256) NOT NULL, file_path VARCHAR(512) NOT NULL, file_type VARCHAR(10),
    file_size INTEGER, node_type VARCHAR(16), created_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  // ============================================================
  // 配件表（新增）
  // ============================================================
  E(`CREATE TABLE IF NOT EXISTS parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    part_code VARCHAR(32) UNIQUE NOT NULL,
    part_name VARCHAR(128) NOT NULL,
    part_model VARCHAR(64),
    part_category VARCHAR(32),
    specification VARCHAR(256),
    manufacturer VARCHAR(64),
    unit VARCHAR(16) DEFAULT '个',
    reference_price DECIMAL(10,2),
    description TEXT,
    status VARCHAR(8) DEFAULT 'active' CHECK(status IN ('active','inactive')),
    stock_quantity INTEGER DEFAULT 0,
    alert_threshold INTEGER DEFAULT 5,
    applicable_devices VARCHAR(256),
    created_at DATETIME DEFAULT (datetime('now','localtime')),
    updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  // ============================================================
  // 工单配件关联表（新增）
  // ============================================================
  E(`CREATE TABLE IF NOT EXISTS fault_parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fault_no VARCHAR(32) NOT NULL REFERENCES fault_orders(fault_no),
    part_id INTEGER NOT NULL REFERENCES parts(id),
    part_name VARCHAR(128),
    part_model VARCHAR(64),
    quantity INTEGER DEFAULT 1,
    unit VARCHAR(16),
    note TEXT,
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  E(`CREATE TABLE IF NOT EXISTS demands (
    demand_no VARCHAR(24) PRIMARY KEY, title VARCHAR(256) NOT NULL, description TEXT NOT NULL,
    source_hospital_id INTEGER REFERENCES hospitals(id), submitter_id INTEGER REFERENCES users(id),
    priority VARCHAR(8) DEFAULT '中' CHECK(priority IN ('高','中','低')),
    status VARCHAR(8) DEFAULT '待评估' CHECK(status IN ('待评估','已采纳','已驳回','已上线')),
    eval_result TEXT, eval_note TEXT, reject_reason TEXT, estimated_launch_date DATE, schedule_note TEXT,
    evaluator_id INTEGER REFERENCES users(id), eval_time DATETIME, closed_at DATETIME,
    sync_status VARCHAR(8) DEFAULT '未同步',
    created_at DATETIME DEFAULT (datetime('now','localtime')), updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  E(`CREATE TABLE IF NOT EXISTS demand_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT, demand_no VARCHAR(24) NOT NULL REFERENCES demands(demand_no),
    from_status VARCHAR(8), to_status VARCHAR(8), operator_id INTEGER REFERENCES users(id),
    operator_name VARCHAR(32), note TEXT, created_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  E(`CREATE TABLE IF NOT EXISTS inspection_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT, plan_name VARCHAR(128) NOT NULL, hospital_id INTEGER REFERENCES hospitals(id),
    device_codes TEXT, cycle VARCHAR(8) CHECK(cycle IN ('每周','每两周','每月')),
    start_date DATE NOT NULL, responsible_engineer_id INTEGER REFERENCES users(id),
    status VARCHAR(8) DEFAULT '进行中' CHECK(status IN ('进行中','已暂停','已结束')),
    next_inspection_date DATE, created_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  E(`CREATE TABLE IF NOT EXISTS inspection_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER REFERENCES inspection_plans(id),
    device_code VARCHAR(32) REFERENCES devices(device_code), engineer_id INTEGER REFERENCES users(id),
    inspect_date DATE NOT NULL, appearance_ok TINYINT, wall_distance DECIMAL(4,1), ground_level DECIMAL(4,2),
    firmware_version VARCHAR(32), app_version VARCHAR(32), run_hours INTEGER, ip_address VARCHAR(45),
    network_stable TINYINT, packet_loss_rate DECIMAL(5,2), drug_inventory_ok TINYINT,
    drug_low_stock_num INTEGER, drug_expiring_num INTEGER, screen_ok TINYINT, scanner_ok TINYINT,
    printer_ok TINYINT, lock_ok TINYINT,
    result VARCHAR(8) DEFAULT '正常' CHECK(result IN ('正常','异常待处理','已处理')), note TEXT,
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  E(`CREATE TABLE IF NOT EXISTS maintenance_records (
    maintenance_no VARCHAR(32) PRIMARY KEY, device_code VARCHAR(32) NOT NULL REFERENCES devices(device_code),
    type VARCHAR(16) CHECK(type IN ('配件更换','固件升级','清洁保养','校准调试','其他')),
    description TEXT, operator_id INTEGER REFERENCES users(id), part_name VARCHAR(64), part_model VARCHAR(64),
    part_quantity INTEGER, part_batch VARCHAR(32), part_unit VARCHAR(16),
    firm_version_before VARCHAR(32), firm_version_after VARCHAR(32), maintenance_date DATE NOT NULL,
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  E(`CREATE TABLE IF NOT EXISTS knowledge_base (
    id INTEGER PRIMARY KEY AUTOINCREMENT, fault_category_l1 VARCHAR(32), fault_category_l2 VARCHAR(64),
    title VARCHAR(256), description_summary TEXT, solution TEXT NOT NULL, device_model VARCHAR(64),
    applicable_models TEXT, source_fault_no VARCHAR(32), author_id INTEGER REFERENCES users(id),
    view_count INTEGER DEFAULT 0, reference_count INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT (datetime('now','localtime')), created_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  E(`CREATE TABLE IF NOT EXISTS audit_logs (
    log_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, username VARCHAR(32), role VARCHAR(16),
    action_type VARCHAR(32) NOT NULL, target_type VARCHAR(32), target_id VARCHAR(64),
    old_value TEXT, new_value TEXT, ip_address VARCHAR(45), user_agent TEXT,
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  E(`CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT, target_user_id INTEGER REFERENCES users(id),
    fault_no VARCHAR(32), demand_no VARCHAR(24), title VARCHAR(256) NOT NULL, content TEXT,
    category VARCHAR(16), level VARCHAR(8) DEFAULT 'info', is_read TINYINT DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  E(`CREATE TABLE IF NOT EXISTS sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT, table_name VARCHAR(32) NOT NULL, record_id VARCHAR(64) NOT NULL,
    action VARCHAR(8), payload TEXT, retry_count INTEGER DEFAULT 0, last_error TEXT,
    status VARCHAR(12) DEFAULT 'pending',
    created_at DATETIME DEFAULT (datetime('now','localtime')), updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  E(`CREATE TABLE IF NOT EXISTS spare_parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, part_name VARCHAR(128) NOT NULL, part_model VARCHAR(64),
    unit VARCHAR(16) DEFAULT '个', stock_quantity INTEGER DEFAULT 0, safety_stock INTEGER DEFAULT 5,
    supplier VARCHAR(128), last_supply_date DATE, created_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  E(`CREATE TABLE IF NOT EXISTS system_config (
    key VARCHAR(64) PRIMARY KEY, value TEXT, description VARCHAR(256),
    updated_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  E(`CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id),
    token VARCHAR(64) UNIQUE NOT NULL, expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  E(`CREATE TABLE IF NOT EXISTS knowledge_references (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    knowledge_id INTEGER NOT NULL REFERENCES knowledge_base(id),
    fault_no VARCHAR(32) REFERENCES fault_orders(fault_no),
    engineer_id INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT (datetime('now','localtime'))
  )`);

  E(`CREATE TABLE IF NOT EXISTS db_version (version INTEGER PRIMARY KEY, applied_at DATETIME DEFAULT (datetime('now','localtime')))`);

  // 索引
  [
    'idx_fault_device ON fault_orders(device_code)',
    'idx_fault_status ON fault_orders(status)',
    'idx_fault_engineer ON fault_orders(engineer_id)',
    'idx_fault_hospital ON fault_orders(hospital_id)',
    'idx_fault_created ON fault_orders(created_at)',
    'idx_device_hospital ON devices(hospital_id)',
    'idx_audit_user ON audit_logs(user_id)',
    'idx_audit_created ON audit_logs(created_at)',
    'idx_notify_user ON notifications(target_user_id, is_read)',
    'idx_kb_category ON knowledge_base(fault_category_l1)',
    'idx_inspection_device ON inspection_records(device_code)',
    'idx_maintenance_device ON maintenance_records(device_code)',
    'idx_demand_status ON demands(status)',
    'idx_session_token ON user_sessions(token)',
    'idx_fault_parts_fault ON fault_parts(fault_no)',
    'idx_parts_category ON parts(part_category)',
    'idx_users_role ON users(role)',
    'idx_users_agent_level ON users(agent_level)',
    'idx_users_parent ON users(parent_agent_id)',
    'idx_kbref_knowledge ON knowledge_references(knowledge_id)',
    'idx_kbref_fault ON knowledge_references(fault_no)',
  ].forEach(x => E(`CREATE INDEX IF NOT EXISTS ${x}`));

  const verCheck = raw.exec('SELECT COUNT(*) as v FROM db_version');
  const hasVersion = verCheck.length && verCheck[0].values.length && verCheck[0].values[0][0];
  if (!hasVersion) {
    E("INSERT INTO db_version (version) VALUES (2)");
  }
}

// ============================================================
// 种子数据 v2.0
// ============================================================
function seedData(raw) {
  const ucResult = raw.exec('SELECT COUNT(*) as v FROM users');
  const uc = ucResult.length && ucResult[0].values.length ? ucResult[0].values[0][0] : 0;
  if (uc) return console.log('[DB] 种子数据已存在，跳过');

  const bcrypt = require('bcryptjs');
  const h = bcrypt.hashSync('123456', 10);
  const Q = (v) => (v === null || v === undefined) ? 'NULL' : (typeof v === 'number') ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
  const R = (sql) => { try { raw.run(sql); } catch(e) { console.error('[SEED]', e.message.substring(0,120)); } };

  // ============================================================
  // 用户：总部 → 省代 → 市代 → 工程师 层级结构
  // ============================================================

  // 总部管理员
  R(`INSERT INTO users (username,password_hash,real_name,role,phone,email,province,city,region,position,status)
    VALUES ('admin01','${h}','总部管理员','headquarters','13800138000','admin@example.com','北京市','北京市','总部','系统管理员','active')`);

  // 省代：广东省（dealer01 → 负责广东省）
  R(`INSERT INTO users (username,password_hash,real_name,role,agent_level,company_name,phone,email,province,city,region,responsible_provinces,position,status)
    VALUES ('dealer01','${h}','广东省代理商','provincial_agent','provincial','广东省 xx 医药科技有限公司','13800138004','gd_dealer@example.com','广东省','广州市','华南','["广东省"]','省代负责人','active')`);

  // 市代：广州市（dealer02 → 属于 dealer01，负责广州市）
  R(`INSERT INTO users (username,password_hash,real_name,role,agent_level,parent_agent_id,company_name,phone,email,province,city,region,responsible_cities,position,status)
    VALUES ('dealer02','${h}','广州市代理商','city_agent','city',2,'广州市 xx 医疗设备有限公司','13800138005','gz_dealer@example.com','广东省','广州市','华南','["广州市"]','市代负责人','active')`);

  // 市代：深圳市（dealer03 → 属于 dealer01，负责深圳市）
  R(`INSERT INTO users (username,password_hash,real_name,role,agent_level,parent_agent_id,company_name,phone,email,province,city,region,responsible_cities,position,status)
    VALUES ('dealer03','${h}','深圳市代理商','city_agent','city',2,'深圳市 xx 医疗设备有限公司','13800138006','sz_dealer@example.com','广东省','深圳市','华南','["深圳市"]','市代负责人','active')`);

  // 省代：北京市（dealer04 → 华北区域北京市）
  R(`INSERT INTO users (username,password_hash,real_name,role,agent_level,company_name,phone,email,province,city,region,responsible_provinces,position,status)
    VALUES ('dealer04','${h}','北京市代理商','provincial_agent','provincial','北京 xx 医疗科技有限公司','13800138007','bj_dealer@example.com','北京市','北京市','华北','["北京市"]','省代负责人','active')`);

  // 工程师：张三（属于 dealer02广州市代理商）
  R(`INSERT INTO users (username,password_hash,real_name,role,parent_agent_id,phone,email,province,city,region,position,status)
    VALUES ('engineer01','${h}','张三','engineer',3,'13800138001','zhangsan@example.com','广东省','广州市','华南','售后工程师','active')`);

  // 工程师：李四（属于 dealer03深圳市代理商）
  R(`INSERT INTO users (username,password_hash,real_name,role,parent_agent_id,phone,email,province,city,region,position,status)
    VALUES ('engineer02','${h}','李四','engineer',4,'13800138002','lisi@example.com','广东省','深圳市','华南','售后工程师','active')`);

  // 工程师：王五（属于 dealer04北京市代理商）
  R(`INSERT INTO users (username,password_hash,real_name,role,parent_agent_id,phone,email,province,city,region,position,status)
    VALUES ('engineer03','${h}','王五','engineer',5,'13800138003','wangwu@example.com','北京市','北京市','华北','售后工程师','active')`);

  // ============================================================
  // 医院（含大区字段）
  // ============================================================
  R(`INSERT INTO hospitals (hospital_code,hospital_name,province,city,region,address,contact_person,contact_phone)
    VALUES ('H001','广州市第一人民医院','广东省','广州市','华南','广州市越秀区盘福路1号','刘主任','13900139001')`);
  R(`INSERT INTO hospitals (hospital_code,hospital_name,province,city,region,address,contact_person,contact_phone)
    VALUES ('H002','深圳市人民医院','广东省','深圳市','华南','深圳市罗湖区东门北路1017号','黄药师','13900139002')`);
  R(`INSERT INTO hospitals (hospital_code,hospital_name,province,city,region,address,contact_person,contact_phone)
    VALUES ('H003','北京协和医院','北京市','北京市','华北','北京市东城区帅府园1号','王主任','13900139003')`);
  R(`INSERT INTO hospitals (hospital_code,hospital_name,province,city,region,address,contact_person,contact_phone)
    VALUES ('H004','上海华山医院','上海市','上海市','华东','上海市乌鲁木齐中路12号','张药师','13900139004')`);

  // ============================================================
  // 设备
  // ============================================================
  R(`INSERT INTO devices (device_code,device_type,serial_number,hospital_id,install_location,wall_distance_cm,ip_address,status,firmware_version,app_version,install_date)
    VALUES ('MZSN20240001','立式','SN-L20240001',1,'3楼/麻醉科',5.5,'192.168.1.101','在线','v2.1.3','v1.5.2','2024-03-15 09:00:00')`);
  R(`INSERT INTO devices (device_code,device_type,serial_number,hospital_id,install_location,wall_distance_cm,ip_address,status,firmware_version,app_version,install_date)
    VALUES ('MZSN20240002','台式','SN-T20240002',2,'5楼/ICU',8.0,'192.168.1.102','在线','v2.1.3','v1.5.2','2024-03-20 10:30:00')`);
  R(`INSERT INTO devices (device_code,device_type,serial_number,hospital_id,install_location,wall_distance_cm,ip_address,status,firmware_version,app_version,install_date)
    VALUES ('MZSN20240003','台式','SN-T20240003',3,'2楼/手术室',6.2,'192.168.2.101','在线','v2.1.2','v1.5.1','2024-04-01 08:00:00')`);
  R(`INSERT INTO devices (device_code,device_type,serial_number,hospital_id,install_location,wall_distance_cm,ip_address,status,firmware_version,app_version,install_date)
    VALUES ('MZSN20240004','立式','SN-L20240004',4,'8楼/药房',4.8,'192.168.3.101','在线','v2.1.3','v1.5.3','2024-04-10 14:00:00')`);

  // ============================================================
  // 工单（关联医院和工程师）
  // ============================================================
  R(`INSERT INTO fault_orders (fault_no,device_code,fault_level,fault_category_l1,fault_category_l2,description,status,contact_person,contact_phone,engineer_id,hospital_id)
    VALUES ('FW_20240320_001','MZSN20240001','一般','硬件','显示屏','屏幕偶尔花屏，刷新后恢复，近期频率增加','已闭环','刘主任','13900139001',6,1)`);
  R(`INSERT INTO fault_orders (fault_no,device_code,fault_level,fault_category_l1,fault_category_l2,description,status,contact_person,contact_phone,engineer_id,hospital_id)
    VALUES ('FW_20240401_002','MZSN20240001','紧急','网络','通信异常','设备无法连接服务器，ping不通网关，需紧急排查','处理中','刘主任','13900139001',6,1)`);
  R(`INSERT INTO fault_orders (fault_no,device_code,fault_level,fault_category_l1,fault_category_l2,description,status,contact_person,contact_phone,engineer_id,hospital_id)
    VALUES ('FW_20240405_003','MZSN20240002','一般','耗材','打印纸','打印纸卡纸，更换后仍有间歇性卡纸','待处理','黄药师','13900139002',7,2)`);
  R(`INSERT INTO fault_orders (fault_no,device_code,fault_level,fault_category_l1,fault_category_l2,description,status,contact_person,contact_phone,engineer_id,hospital_id)
    VALUES ('FW_20240325_004','MZSN20240003','重大','硬件','锁控故障','柜门锁死无法打开，药品无法取出','已闭环','王主任','13900139003',8,3)`);

  // ============================================================
  // 工单配件关联（示例：显示屏更换）
  // ============================================================
  R(`INSERT INTO fault_parts (fault_no,part_id,part_name,part_model,quantity,unit,note)
    VALUES ('FW_20240320_001',1,'显示屏模块','LCD-MZ-10.1',1,'个','已更换，确认正常')`);
  R(`INSERT INTO fault_parts (fault_no,part_id,part_name,part_model,quantity,unit,note)
    VALUES ('FW_20240325_004',2,'电控锁组件','LOCK-MZ-V2',1,'套','已更换，测试正常')`);

  // ============================================================
  // 配件清单（含库存）
  // ============================================================
  R(`INSERT INTO parts (part_code,part_name,part_model,part_category,specification,manufacturer,unit,reference_price,description,stock_quantity,alert_threshold,applicable_devices)
    VALUES ('P001','显示屏模块','LCD-MZ-10.1','硬件','10.1寸 TFT LCD','华星光电','个',680.00,'替换旧显示屏时使用',15,3,'YT-100,YT-200')`);
  R(`INSERT INTO parts (part_code,part_name,part_model,part_category,specification,manufacturer,unit,reference_price,description,stock_quantity,alert_threshold,applicable_devices)
    VALUES ('P002','电控锁组件','LOCK-MZ-V2','硬件','电磁锁+V2控制板','汇川技术','套',1200.00,'柜门电控锁整组替换',8,2,'YT-100,YT-200,YT-300')`);
  R(`INSERT INTO parts (part_code,part_name,part_model,part_category,specification,manufacturer,unit,reference_price,description,stock_quantity,alert_threshold,applicable_devices)
    VALUES ('P003','扫描模块','SCAN-MZ-2D','硬件','二维影像扫描头','霍尼韦尔','个',450.00,'药品扫码识别用',20,5,'YT-100,YT-200')`);
  R(`INSERT INTO parts (part_code,part_name,part_model,part_category,specification,manufacturer,unit,reference_price,description,stock_quantity,alert_threshold,applicable_devices)
    VALUES ('P004','电源适配器','PWR-24V-5A','硬件','24V/5A工业级','台达电子','个',120.00,'设备主供电',25,5,'通用')`);
  R(`INSERT INTO parts (part_code,part_name,part_model,part_category,specification,manufacturer,unit,reference_price,description,stock_quantity,alert_threshold,applicable_devices)
    VALUES ('P005','热敏打印头','PRINT-58','耗材','58mm热敏打印头','日本精工','个',280.00,'标签打印机打印头',30,10,'YT-100,YT-200')`);
  R(`INSERT INTO parts (part_code,part_name,part_model,part_category,specification,manufacturer,unit,reference_price,description,stock_quantity,alert_threshold,applicable_devices)
    VALUES ('P006','网络模块','ETH-MZ-100','硬件','百兆以太网模块','瑞昱','个',350.00,'设备联网通信用',12,3,'通用')`);
  R(`INSERT INTO parts (part_code,part_name,part_model,part_category,specification,manufacturer,unit,reference_price,description,stock_quantity,alert_threshold,applicable_devices)
    VALUES ('P007','RFID读写器','RFID-MZ-C1','硬件','13.56MHz RFID模块','复旦微电子','个',520.00,'药品标签识别',3,5,'YT-200,YT-300')`);
  R(`INSERT INTO parts (part_code,part_name,part_model,part_category,specification,manufacturer,unit,reference_price,description,stock_quantity,alert_threshold,applicable_devices)
    VALUES ('P008','触摸显示屏','TP-MZ-7','硬件','7寸电容触摸屏','群创光电','个',480.00,'设备触控操作',18,4,'YT-100')`);
  R(`INSERT INTO parts (part_code,part_name,part_model,part_category,specification,manufacturer,unit,reference_price,description,stock_quantity,alert_threshold,applicable_devices)
    VALUES ('P009','固件升级包','FW-UPG','软件','设备固件升级工具','原厂','套',0.00,'免费服务配套',99,0,'通用')`);
  R(`INSERT INTO parts (part_code,part_name,part_model,part_category,specification,manufacturer,unit,reference_price,description,stock_quantity,alert_threshold,applicable_devices)
    VALUES ('P010','安装支架','BRACKET-L','结构件','立式设备壁挂支架','原厂','套',150.00,'设备安装用',22,5,'YT-200,YT-300')`);

  // ============================================================
  // 知识库
  // ============================================================
  R(`INSERT INTO knowledge_base (fault_category_l1,fault_category_l2,title,description_summary,solution,device_model,source_fault_no,author_id)
    VALUES ('硬件','显示屏','显示屏花屏问题处理','屏幕出现花屏、闪屏等显示异常','1. 检查显示排线连接是否松动\n2. 重启设备电源\n3. 检查电压是否稳定\n4. 若上述无效，更换显示屏模块（P001）','立式','FW_20240320_001',1)`);
  R(`INSERT INTO knowledge_base (fault_category_l1,fault_category_l2,title,description_summary,solution,device_model,source_fault_no,author_id)
    VALUES ('网络','通信异常','设备网络断连排查方案','设备无法连接服务器或无法ping通网关','1. 检查网线连接状态\n2. Ping网关确认网络\n3. 检查防火墙规则\n4. 重启网络模块（P006）\n5. 检查IP地址是否冲突','通用',NULL,1)`);
  R(`INSERT INTO knowledge_base (fault_category_l1,fault_category_l2,title,description_summary,solution,device_model,source_fault_no,author_id)
    VALUES ('硬件','锁控故障','柜门锁死应急处理','电控锁故障导致柜门无法打开','1. 使用物理应急钥匙手动开锁\n2. 检查锁控模块供电（24V）\n3. 检查锁控板信号线\n4. 更换电控锁组件（P002）\n5. 升级锁控固件','立式','FW_20240325_004',1)`);
  R(`INSERT INTO knowledge_base (fault_category_l1,fault_category_l2,title,description_summary,solution,device_model,source_fault_no,author_id)
    VALUES ('耗材','打印纸','热敏打印头更换步骤','打印字迹模糊或空白，清洁后无效','1. 关闭打印机电源\n2. 打开打印仓盖\n3. 取下旧打印头\n4. 安装新打印头（P005）\n5. 复位打印机','台式',NULL,1)`);
  R(`INSERT INTO knowledge_base (fault_category_l1,fault_category_l2,title,description_summary,solution,device_model,source_fault_no,author_id)
    VALUES ('软件','固件升级','设备固件升级操作指南','设备需升级固件以修复问题或获得新功能','1. 下载固件升级包（P009）\n2. 将固件文件放入U盘根目录\n3. U盘插入设备USB口\n4. 进入设置→系统升级\n5. 选择升级文件，确认升级\n6. 升级完成后自动重启','通用',NULL,1)`);

  // ============================================================
  // 系统配置
  // ============================================================
  R(`INSERT INTO system_config (key,value,description) VALUES ('app_name','麻精药品智能柜售后运维工具','系统名称')`);
  R(`INSERT INTO system_config (key,value,description) VALUES ('app_version','2.1.0','系统版本')`);
  R(`INSERT INTO system_config (key,value,description) VALUES ('sync_interval','30','自动同步间隔(秒)')`);
  R(`INSERT INTO system_config (key,value,description) VALUES ('max_upload_size','20','单个附件最大MB')`);
  R(`INSERT INTO system_config (key,value,description) VALUES ('wall_distance_limit','10','离墙距离限制(cm)')`);
  R(`INSERT INTO system_config (key,value,description) VALUES ('ground_level_limit','2','地面水平度限制(°)')`);
  R(`INSERT INTO system_config (key,value,description) VALUES ('sla_general_hours','72','一般故障SLA时限(小时)')`);
  R(`INSERT INTO system_config (key,value,description) VALUES ('sla_urgent_hours','24','紧急故障SLA时限(小时)')`);
  R(`INSERT INTO system_config (key,value,description) VALUES ('sla_major_hours','8','重大故障SLA时限(小时)')`);

  // ============================================================
  // 售中节点定义（8个标准节点）
  // ============================================================
  const nodeDefs = [
    { idx:1, name:'到场前-基础对接准备', stage:'远程前', remote:1,
      items:['对接医院负责人，确认安装位置、环境、时间','核对环境：干燥通风、无直射/潮湿','核对空间：台式/立式尺寸、离墙≤10cm','确认电源：接地插座、稳定供电','确认网络：内网接口、可分配固定IP'],
      materials:['环境现场照片','空间尺寸勘测记录','电源/网络接口确认截图'] },
    { idx:2, name:'到场前-系统对接准备', stage:'远程前', remote:1,
      items:['远程对接科室，确认取药/回收业务流程','对接信息科，提交《系统接口文档》','敲定对接方案：交互模式、数据、同步频率','确认服务器IP、VPN/远程方式','远程部署Web平台，测试连通'],
      materials:['业务流程参数确认单','接口文档提交记录','服务器配置截图','Web平台部署成功截图'] },
    { idx:3, name:'到场后-开箱验收', stage:'现场', remote:0,
      items:['检查设备外观完整性（无划痕/变形）','核对配件清单，确认齐全','确认设备型号/序列号与合同一致'],
      materials:['设备外观照片','配件清单核对照片','开箱验收单'] },
    { idx:4, name:'到场后-设备安装部署', stage:'现场', remote:0,
      items:['设备就位、调整水平','连接电源线、网线','配置设备IP并录入系统','确认指示灯正常、网络连通'],
      materials:['安装完成照片','IP地址分配表'] },
    { idx:5, name:'到场后-接口联调', stage:'现场', remote:0,
      items:['HIS系统接口对接测试','数据同步功能验证','异常处理流程测试'],
      materials:['接口联调日志','联调确认截图'] },
    { idx:6, name:'到场后-系统调试配置', stage:'现场', remote:0,
      items:['设备基本参数配置','药品数据库导入/初始化','用户权限配置','预警规则配置'],
      materials:['系统配置截图'] },
    { idx:7, name:'到场后-操作培训交付', stage:'现场', remote:0,
      items:['现场操作教学','使用答疑','交付操作手册'],
      materials:['培训现场照片','交付凭证/签字确认单'] },
    { idx:8, name:'到场后-最终验收', stage:'现场', remote:0,
      items:['核心功能全流程测试','硬件状态全面检查','用户确认签字'],
      materials:['功能测试截图','硬件检查报告','最终验收单'] }
  ];
  nodeDefs.forEach(n => {
    const itemsJson = JSON.stringify(n.items);
    const matsJson = JSON.stringify(n.materials);
    R(`INSERT INTO pre_sales_node_defs (node_index,node_name,stage,is_remote,work_items_json,required_materials_json)
       VALUES (${n.idx},'${n.name}','${n.stage}',${n.remote},'${itemsJson.replace(/'/g,"''")}','${matsJson.replace(/'/g,"''")}')`);
  });

  console.log('[DB] 种子数据已初始化（v2.0 含省代/市代/配件/售中节点）');
}

module.exports = { getDb, initDb, getDbSync, DB_PATH, saveDb, getRegion };