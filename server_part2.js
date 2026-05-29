// ======================= 售中管理 API =======================
// 节点定义 CRUD
app.get('/api/pre-sales/node-defs', authMiddleware, (req, res) => {
  const db = getDbSync();
  const rows = db.prepare('SELECT * FROM pre_sales_node_defs ORDER BY node_index').all();
  res.json({ data: rows });
});

app.post('/api/pre-sales/node-defs', authMiddleware, (req, res) => {
  const db = getDbSync();
  if (req.user.role !== 'headquarters') return res.status(403).json({ error: '仅总部可操作' });
  const { node_index, node_name, stage, is_remote, work_items, required_materials } = req.body;
  if (!node_index || !node_name) return res.status(400).json({ error: '序号和名称为必填' });
  db.prepare('INSERT INTO pre_sales_node_defs (node_index,node_name,stage,is_remote,work_items_json,required_materials_json) VALUES (?,?,?,?,?,?)')
    .run(node_index, node_name, stage||'远程前', is_remote?1:0, JSON.stringify(work_items||[]), JSON.stringify(required_materials||[]));
  res.json({ message: '已添加' });
});

app.patch('/api/pre-sales/node-defs/:id', authMiddleware, (req, res) => {
  const db = getDbSync();
  if (req.user.role !== 'headquarters') return res.status(403).json({ error: '仅总部可操作' });
  const { node_index, node_name, stage, is_remote, work_items, required_materials } = req.body;
  db.prepare('UPDATE pre_sales_node_defs SET node_index=?,node_name=?,stage=?,is_remote=?,work_items_json=?,required_materials_json=?,updated_at=datetime("now","localtime") WHERE id=?')
    .run(node_index, node_name, stage, is_remote?1:0, JSON.stringify(work_items||[]), JSON.stringify(required_materials||[]), req.params.id);
  res.json({ message: '已保存' });
});

app.delete('/api/pre-sales/node-defs/:id', authMiddleware, (req, res) => {
  const db = getDbSync();
  if (req.user.role !== 'headquarters') return res.status(403).json({ error: '仅总部可操作' });
  db.prepare('DELETE FROM pre_sales_node_defs WHERE id=?').run(req.params.id);
  res.json({ message: '已删除' });
});

// 售中项目列表
app.get('/api/pre-sales/projects', authMiddleware, (req, res) => {
  const db = getDbSync();
  const user = req.user;
  const { status, keyword, page=1, page_size=20 } = req.query;
  let where = [];
  let params = [];
  
  if (user.role === 'engineer') { where.push('psp.engineer_id = ?'); params.push(user.id); }
  else if (user.role !== 'headquarters') {
    const f = buildRegionFilter(user, 'psp');
    if (f.sql) { where.push(f.sql); params.push(...f.params); }
  }
  if (status) { where.push('psp.status = ?'); params.push(status); }
  if (keyword) { where.push('(psp.project_no LIKE ? OR h.hospital_name LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`); }
  
  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM pre_sales_projects psp LEFT JOIN hospitals h ON psp.hospital_id=h.id ${whereStr}`).get(...params).cnt;
  const offset = (parseInt(page)-1) * parseInt(page_size);
  const rows = db.prepare(`SELECT psp.*, h.hospital_name, u.real_name as engineer_name 
    FROM pre_sales_projects psp 
    LEFT JOIN hospitals h ON psp.hospital_id=h.id 
    LEFT JOIN users u ON psp.engineer_id=u.id 
    ${whereStr} ORDER BY psp.created_at DESC LIMIT ? OFFSET ?`).all(...params, parseInt(page_size), offset);
  res.json({ total, page:parseInt(page), page_size:parseInt(page_size), data: rows });
});

// 创建售中项目
app.post('/api/pre-sales/projects', authMiddleware, (req, res) => {
  const db = getDbSync();
  const { mode, hospital_id, hospital_name, province, city, district, address, device_type, install_location, install_ip, contact_person, contact_phone } = req.body;
  if (!mode || (mode==='existing' && !hospital_id) || (mode==='new' && !hospital_name)) {
    return res.status(400).json({ error: '请填写必填字段' });
  }
  let hid = hospital_id;
  if (mode === 'new') {
    const exist = db.prepare('SELECT id FROM hospitals WHERE hospital_name = ? AND province = ?').get(hospital_name, province);
    if (exist) { hid = exist.id; }
    else {
      const r = db.prepare('INSERT INTO hospitals (hospital_name,province,city,district,address,contact_person,contact_phone) VALUES (?,?,?,?,?,?,?)')
        .run(hospital_name||'', province||'', city||'', district||'', address||'', contact_person||'', contact_phone||'');
      hid = r.lastInsertRowid;
    }
  }
  const today = new Date().toISOString().slice(2,10).replace(/-/g,'');
  const cnt = db.prepare("SELECT COUNT(*) as c FROM pre_sales_projects WHERE project_no LIKE ?").get(`XS_${today}_%`).c + 1;
  const project_no = `XS_${today}_${String(cnt).padStart(3,'0')}`;
  const r = db.prepare(`INSERT INTO pre_sales_projects (project_no,hospital_id,engineer_id,province,city,status,install_location,install_ip) VALUES (?,?,?,?,?,?,?,?)`)
    .run(project_no, hid, req.user.id, province||'', city||'', '进行中', install_location||'', install_ip||'');
  
  // 自动创建8个节点进度
  const defs = db.prepare('SELECT * FROM pre_sales_node_defs ORDER BY node_index').all();
  defs.forEach(def => {
    db.prepare('INSERT INTO pre_sales_node_progress (project_id,node_index,node_name,stage,is_remote,status) VALUES (?,?,?,?,?,?)')
      .run(r.lastInsertRowid, def.node_index, def.node_name, def.stage, def.is_remote, def.node_index===1?'进行中':'未开始');
  });
  
  res.json({ project_no, id: r.lastInsertRowid });
});

// 节点完成/开始
app.post('/api/pre-sales/nodes/:id/start', authMiddleware, (req, res) => {
  const db = getDbSync();
  db.prepare("UPDATE pre_sales_node_progress SET status='进行中',started_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE id=? AND status='未开始'").run(req.params.id);
  res.json({ message: '已开始' });
});

app.post('/api/pre-sales/nodes/:id/complete', authMiddleware, (req, res) => {
  const db = getDbSync();
  const node = db.prepare('SELECT * FROM pre_sales_node_progress WHERE id=?').get(req.params.id);
  if (!node) return res.status(404).json({ error: '节点不存在' });
  // 校验：所有工作点已完成 + 必填材料已上传
  const incomplete = db.prepare('SELECT COUNT(*) as c FROM pre_sales_work_items WHERE node_progress_id=? AND is_completed=0').get(node.id).c;
  if (incomplete > 0) return res.status(400).json({ error: '请先完成所有工作点' });
  const def = db.prepare('SELECT * FROM pre_sales_node_defs WHERE node_index=?').get(node.node_index);
  if (def && def.required_materials_json) {
    const required = JSON.parse(def.required_materials_json);
    for (const mat of required) {
      const exist = db.prepare('SELECT id FROM pre_sales_materials WHERE node_progress_id=? AND file_name LIKE ?').get(node.id, `%${mat}%`);
      if (!exist) return res.status(400).json({ error: `请先上传必填材料：${mat}` });
    }
  }
  db.prepare("UPDATE pre_sales_node_progress SET status='已完成',completed_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE id=?").run(req.params.id);
  // 自动解锁下一节点
  const next = db.prepare('SELECT * FROM pre_sales_node_progress WHERE project_id=? AND node_index=?').get(node.project_id, node.node_index+1);
  if (next) db.prepare("UPDATE pre_sales_node_progress SET status='进行中' WHERE id=?").run(next.id);
  // 计算进度
  const total = db.prepare('SELECT COUNT(*) as c FROM pre_sales_node_progress WHERE project_id=?').get(node.project_id).c;
  const done = db.prepare("SELECT COUNT(*) as c FROM pre_sales_node_progress WHERE project_id=? AND status='已完成'").get(node.project_id).c;
  const pct = Math.round(done/total*100);
  db.prepare('UPDATE pre_sales_projects SET completion_percent=?,current_node_index=?,updated_at=datetime("now","localtime") WHERE id=?').run(pct, node.node_index, node.project_id);
  // 全部完成 → 标记验收
  if (pct === 100) {
    db.prepare("UPDATE pre_sales_projects SET status='已验收',updated_at=datetime('now','localtime') WHERE id=?").run(node.project_id);
  }
  res.json({ message: '节点已完成', completion_percent: pct });
});

// 售中项目详情（含节点列表）
app.get('/api/pre-sales/projects/:project_no', authMiddleware, (req, res) => {
  const db = getDbSync();
  const proj = db.prepare(`SELECT psp.*, h.hospital_name, h.contact_person, h.contact_phone 
    FROM pre_sales_projects psp LEFT JOIN hospitals h ON psp.hospital_id=h.id 
    WHERE psp.project_no=?`).get(req.params.project_no);
  if (!proj) return res.status(404).json({ error: '项目不存在' });
  const nodes = db.prepare('SELECT * FROM pre_sales_node_progress WHERE project_id=? ORDER BY node_index').all(proj.id);
  res.json({ ...proj, nodes });
});

// 验收通过
app.post('/api/pre-sales/projects/:project_no/verify', authMiddleware, (req, res) => {
  const db = getDbSync();
  const proj = db.prepare('SELECT * FROM pre_sales_projects WHERE project_no=?').get(req.params.project_no);
  if (!proj) return res.status(404).json({ error: '项目不存在' });
  db.prepare("UPDATE pre_sales_projects SET acceptance_passed=1, accepted_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?").run(proj.id);
  res.json({ message: '验收已通过' });
});

// 转入售后
app.post('/api/pre-sales/projects/:project_no/handoff', authMiddleware, (req, res) => {
  const db = getDbSync();
  const proj = db.prepare('SELECT * FROM pre_sales_projects WHERE project_no=?').get(req.params.project_no);
  if (!proj) return res.status(404).json({ error: '项目不存在' });
  if (!proj.acceptance_passed) return res.status(400).json({ error: '请先完成验收' });
  // 更新医院负责人
  db.prepare("UPDATE hospitals SET engineer_id=?, updated_at=datetime('now','localtime') WHERE id=?").run(proj.engineer_id, proj.hospital_id);
  // 创建设备档案
  if (proj.install_location && proj.install_ip) {
    const device_code = `D_${proj.project_no}`;
    db.prepare(`INSERT INTO devices (device_code,device_type,serial_number,hospital_id,install_location,ip_address,status,created_at) 
      VALUES (?,?,?,?,?,?,?,?)`).run(device_code, req.body.device_type||'', '', proj.hospital_id, proj.install_location, proj.install_ip, '在线', new Date().toISOString());
  }
  db.prepare("UPDATE pre_sales_projects SET status='已转入售后',closed_at=datetime('now','localtime'),updated_at=datetime('now','localtime') WHERE id=?").run(proj.id);
  res.json({ message: '已成功转入售后模块' });
});
