const fs = require('fs');
const p = 'E:/YT-ASMT/server/server.js';

const PART2 = `
// ======================= 设备管理 =======================
app.get('/api/devices', authMiddleware, (req, res) => {
  const user = req.user;
  const { keyword, status, page = 1, page_size = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(page_size);
  let where = [];
  let params = [];

  if (user.role === 'engineer') {
    where.push('d.engineer_id = ?');
    params.push(user.id);
  } else if (user.role !== 'headquarters') {
    const f = buildHospitalAccessFilter(user);
    if (f.sql) { where.push('1=1' + f.sql); params.push(...f.params); }
  }
  if (status) { where.push('d.status = ?'); params.push(status); }
  if (keyword) { where.push('(d.device_code LIKE ? OR d.serial_number LIKE ? OR h.hospital_name LIKE ?)'); params.push(\`%\${keyword}%\`, \`%\${keyword}%\`, \`%\${keyword}%\`); }

  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.get(\`SELECT COUNT(*) as cnt FROM devices d LEFT JOIN hospitals h ON d.hospital_id = h.id \${whereStr}\`, params).cnt;
  const rows = db.prepare(\`
    SELECT d.*, h.hospital_name, u.real_name as engineer_name
    FROM devices d LEFT JOIN hospitals h ON d.hospital_id = h.id LEFT JOIN users u ON d.engineer_id = u.id
    \${whereStr} ORDER BY d.created_at DESC LIMIT ? OFFSET ?\`).all(...params, parseInt(page_size), offset);
  res.json({ total, page: parseInt(page), page_size: parseInt(page_size), data: rows });
});

app.get('/api/devices/:device_code', authMiddleware, (req, res) => {
  const device = db.get(\`SELECT d.*, h.hospital_name, u.real_name as engineer_name
    FROM devices d LEFT JOIN hospitals h ON d.hospital_id = h.id LEFT JOIN users u ON d.engineer_id = u.id
    WHERE d.device_code = ?\`, [req.params.device_code]);
  if (!device) return res.status(404).json({ error: '设备不存在' });
  res.json(device);
});

app.post('/api/devices', authMiddleware, (req, res) => {
  const user = req.user;
  const { device_code, device_type, serial_number, hospital_code, install_location, wall_distance_cm, ip_address } = req.body;
  if (!device_code || !device_type || !hospital_code) return res.status(400).json({ error: '设备编码、设备类型、医院编码不能为空' });
  const existing = db.get('SELECT * FROM devices WHERE device_code = ?', [device_code]);
  if (existing) return res.status(400).json({ error: \`该编码已绑定至 \${existing.hospital_code}，禁止重复绑定\` });
  const hospital = db.get('SELECT * FROM hospitals WHERE hospital_code = ?', [hospital_code]);
  if (!hospital) return res.status(400).json({ error: '医院编码不存在' });
  db.run('INSERT INTO devices (device_code,device_type,serial_number,hospital_id,install_location,wall_distance_cm,ip_address,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [device_code, device_type, serial_number || '', hospital.id, install_location || '', wall_distance_cm || null, ip_address || '', '在线', new Date().toISOString()]);
  db.run('INSERT INTO audit_logs (user_id,username,role,action_type,target_type,target_id,ip_address) VALUES (?,?,?,?,?,?,?)',
    [user.id, user.username, user.role, '设备绑定', 'device', device_code, req.ip]);
  res.json({ success: true, device_code });
});

app.patch('/api/devices/:device_code/status', authMiddleware, (req, res) => {
  const { device_code } = req.params;
  const { status } = req.body;
  const device = db.get('SELECT * FROM devices WHERE device_code = ?', [device_code]);
  if (!device) return res.status(404).json({ error: '设备不存在' });
  const valid = ['在线', '离线', '维修中', '已报废'];
  if (!valid.includes(status)) return res.status(400).json({ error: '无效的状态值' });
  db.run('UPDATE devices SET status = ?, updated_at = datetime("now","localtime") WHERE device_code = ?', [status, device_code]);
  db.run('INSERT INTO audit_logs (user_id,username,role,action_type,target_type,target_id,ip_address) VALUES (?,?,?,?,?,?,?)',
    [req.user.id, req.user.username, req.user.role, '设备状态变更', 'device', device_code, req.ip]);
  res.json({ success: true });
});

// ======================= 需求管理 =======================
app.get('/api/demands', authMiddleware, (req, res) => {
  const { status, keyword, page = 1, page_size = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(page_size);
  let where = [];
  let params = [];
  if (status) { where.push('d.status = ?'); params.push(status); }
  if (keyword) { where.push('d.title LIKE ?'); params.push(\`%\${keyword}%\`); }
  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.get(\`SELECT COUNT(*) as cnt FROM demands d \${whereStr}\`, params).cnt;
  const rows = db.prepare(\`SELECT d.*, h.hospital_name, u.real_name as creator_name FROM demands d
    LEFT JOIN hospitals h ON d.hospital_id = h.id LEFT JOIN users u ON d.created_by = u.id
    \${whereStr} ORDER BY d.created_at DESC LIMIT ? OFFSET ?\`).all(...params, parseInt(page_size), offset);
  res.json({ total, page: parseInt(page), page_size: parseInt(page_size), data: rows });
});

app.post('/api/demands', authMiddleware, (req, res) => {
  const { title, description, hospital_id, priority } = req.body;
  if (!title || !description || description.length < 10) return res.status(400).json({ error: '标题和描述不能为空（描述至少10个字符）' });
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  db.get('SELECT COUNT(*) as c FROM demands WHERE date(created_at) = ?', [new Date().toISOString().slice(0, 10)], (err, row) => {
    const seq = String((row ? row.c : 0) + 1).padStart(4, '0');
    const demand_no = \`XQ_\${today}_\${seq}\`;
    db.run('INSERT INTO demands (demand_no,title,description,hospital_id,created_by,priority,status,created_at) VALUES (?,?,?,?,?,?,?,?)',
      [demand_no, title, description, hospital_id, req.user.id, priority || '中', '待评估', new Date().toISOString()], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        db.run('INSERT INTO audit_logs (user_id,username,role,action_type,target_type,target_id,ip_address) VALUES (?,?,?,?,?,?,?)',
          [req.user.id, req.user.username, req.user.role, '创建需求', 'demand', demand_no, req.ip]);
        res.json({ demand_no, message: '需求已创建' });
      });
  });
});

app.post('/api/demands/:demand_no/evaluate', authMiddleware, (req, res) => {
  if (req.user.role !== 'headquarters') return res.status(403).json({ error: '仅总部可评估' });
  const { demand_no } = req.params;
  const { eval_result, estimated_launch_date, reject_reason, schedule_note, eval_note } = req.body;
  const demand = db.get('SELECT * FROM demands WHERE demand_no = ?', [demand_no]);
  if (!demand) return res.status(404).json({ error: '需求不存在' });
  if (eval_result === '已采纳') {
    if (!estimated_launch_date) return res.status(400).json({ error: '已采纳必须填写预计上线时间' });
    db.run('UPDATE demands SET status = ?, eval_result = ?, estimated_launch_date = ?, schedule_note = ?, eval_note = ?, evaluated_by = ?, evaluated_at = datetime("now","localtime") WHERE demand_no = ?',
      ['已采纳', eval_result, estimated_launch_date, schedule_note || '', eval_note || '', req.user.id, demand_no]);
  } else if (eval_result === '已驳回') {
    if (!reject_reason || reject_reason.length < 10) return res.status(400).json({ error: '驳回时必须填写原因' });
    db.run('UPDATE demands SET status = ?, eval_result = ?, reject_reason = ?, eval_note = ?, evaluated_by = ?, evaluated_at = datetime("now","localtime") WHERE demand_no = ?',
      ['已驳回', eval_result, reject_reason, eval_note || '', req.user.id, demand_no]);
  } else {
    return res.status(400).json({ error: '无效的评估结果' });
  }
  db.run('INSERT INTO audit_logs (user_id,username,role,action_type,target_type,target_id,ip_address) VALUES (?,?,?,?,?,?,?)',
    [req.user.id, req.user.username, req.user.role, '需求评估', 'demand', demand_no, req.ip]);
  res.json({ message: '评估已完成' });
});

// ======================= 巡检管理 =======================
app.get('/api/inspections/plans', authMiddleware, (req, res) => {
  const user = req.user;
  const isHQ = user.role === 'headquarters';
  const rows = db.prepare(\`
    SELECT p.*, h.hospital_name, u.real_name as engineer_name,
           (SELECT COUNT(*) FROM inspection_records WHERE plan_id = p.id) as record_count
    FROM inspection_plans p
    LEFT JOIN hospitals h ON p.hospital_id = h.id
    LEFT JOIN users u ON p.responsible_engineer_id = u.id
    \${isHQ ? '' : 'WHERE p.responsible_engineer_id = ?'}
    ORDER BY p.created_at DESC\`).all(...(isHQ ? [] : [user.id]));
  res.json({ data: rows });
});

app.post('/api/inspections/plans', authMiddleware, (req, res) => {
  const user = req.user;
  const { plan_name, hospital_code, device_codes, cycle, start_date } = req.body;
  if (!plan_name || !hospital_code || !cycle || !start_date) return res.status(400).json({ error: '必填字段不能为空' });
  const hospital = db.get('SELECT id FROM hospitals WHERE hospital_code = ?', [hospital_code]);
  if (!hospital) return res.status(400).json({ error: '医院不存在' });
  const respEngineerId = (user.role === 'headquarters' && req.body.engineer_id) ? req.body.engineer_id : user.id;
  db.run('INSERT INTO inspection_plans (plan_name,hospital_id,device_codes,cycle,start_date,responsible_engineer_id,next_inspection_date) VALUES (?,?,?,?,?,?,?)',
    [plan_name, hospital.id, JSON.stringify(device_codes || []), cycle, start_date, respEngineerId, start_date],
    function(err) { if (err) return res.status(500).json({ error: err.message }); res.json({ success: true, plan_id: this.lastID }); });
});

app.patch('/api/inspections/plans/:id', authMiddleware, (req, res) => {
  if (req.user.role !== 'headquarters') return res.status(403).json({ error: '仅总部可管理' });
  const { status, engineer_id } = req.body;
  const plan = db.get('SELECT * FROM inspection_plans WHERE id = ?', [parseInt(req.params.id)]);
  if (!plan) return res.status(404).json({ error: '计划不存在' });
  if (status) db.run('UPDATE inspection_plans SET status = ? WHERE id = ?', [status, parseInt(req.params.id)]);
  if (engineer_id) db.run('UPDATE inspection_plans SET responsible_engineer_id = ? WHERE id = ?', [engineer_id, parseInt(req.params.id)]);
  res.json({ message: '已更新' });
});

app.post('/api/inspections/records', authMiddleware, (req, res) => {
  const { plan_id, device_code, inspect_date, appearance_ok, wall_distance, ground_level,
    firmware_version, app_version, run_hours, ip_address, network_stable, packet_loss_rate,
    drug_inventory_ok, drug_low_stock_num, drug_expiring_num,
    screen_ok, scanner_ok, printer_ok, lock_ok, result, note } = req.body;
  db.run(\`
    INSERT INTO inspection_records
    (plan_id,device_code,engineer_id,inspect_date,appearance_ok,wall_distance,ground_level,
     firmware_version,app_version,run_hours,ip_address,network_stable,packet_loss_rate,
     drug_inventory_ok,drug_low_stock_num,drug_expiring_num,
     screen_ok,scanner_ok,printer_ok,lock_ok,result,note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)\`,
    [plan_id || null, device_code, req.user.id, inspect_date || new Date().toISOString().slice(0, 10),
     appearance_ok ? 1 : 0, wall_distance || null, ground_level || null,
     firmware_version || '', app_version || '', run_hours || 0,
     ip_address || '', network_stable ? 1 : 0, packet_loss_rate || null,
     drug_inventory_ok ? 1 : 0, drug_low_stock_num || 0, drug_expiring_num || 0,
     screen_ok ? 1 : 0, scanner_ok ? 1 : 0, printer_ok ? 1 : 0, lock_ok ? 1 : 0,
     result || '正常', note || ''], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (plan_id) {
        const plan = db.get('SELECT * FROM inspection_plans WHERE id = ?', [plan_id]);
        if (plan) {
          const next = new Date(inspect_date || Date.now());
          if (plan.cycle === '每周') next.setDate(next.getUTCDate() + 7);
          else if (plan.cycle === '每两周') next.setDate(next.getUTCDate() + 14);
          else next.setMonth(next.getUTCMonth() + 1);
          db.run('UPDATE inspection_plans SET next_inspection_date = ? WHERE id = ?',
            [next.toISOString().slice(0, 10), plan_id]);
        }
      }
      res.json({ success: true, record_id: this.lastID });
    });
});

app.get('/api/inspections/records', authMiddleware, (req, res) => {
  const user = req.user;
  const { plan_id, page = 1, page_size = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(page_size);
  let where = [];
  let params = [];
  if (user.role !== 'headquarters') { where.push('ir.engineer_id = ?'); params.push(user.id); }
  if (plan_id) { where.push('ir.plan_id = ?'); params.push(parseInt(plan_id)); }
  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(\`SELECT COUNT(*) as cnt FROM inspection_records ir \${whereStr}\`).get(...params).cnt;
  const rows = db.prepare(\`
    SELECT ir.*, ip.plan_name, d.device_type, h.hospital_name
    FROM inspection_records ir
    LEFT JOIN inspection_plans ip ON ir.plan_id = ip.id
    LEFT JOIN devices d ON ir.device_code = d.device_code
    LEFT JOIN hospitals h ON d.hospital_id = h.id
    \${whereStr} ORDER BY ir.created_at DESC LIMIT ? OFFSET ?\`).all(...params, parseInt(page_size), offset);
  res.json({ total, page: parseInt(page), page_size: parseInt(page_size), data: rows });
});

app.patch('/api/inspections/records/:id', authMiddleware, (req, res) => {
  const { result, note } = req.body;
  const record = db.get('SELECT * FROM inspection_records WHERE id = ?', [parseInt(req.params.id)]);
  if (!record) return res.status(404).json({ error: '记录不存在' });
  db.run('UPDATE inspection_records SET result = ?, note = ?, updated_at = datetime("now","localtime") WHERE id = ?',
    [result || '已处理', note || '', parseInt(req.params.id)]);
  res.json({ message: '异常已处理' });
});

// ======================= 知识库 =======================
app.get('/api/knowledge', authMiddleware, (req, res) => {
  const { keyword, category, page = 1, page_size = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(page_size);
  let where = [];
  let params = [];
  if (keyword) { where.push('(title LIKE ? OR description LIKE ? OR solution LIKE ?)'); params.push(\`%\${keyword}%\`, \`%\${keyword}%\`, \`%\${keyword}%\`); }
  if (category) { where.push('fault_category_l2 = ?'); params.push(category); }
  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.get(\`SELECT COUNT(*) as cnt FROM knowledge_base \${whereStr}\`, params).cnt;
  const rows = db.prepare(\`SELECT * FROM knowledge_base \${whereStr} ORDER BY created_at DESC LIMIT ? OFFSET ?\`).all(...params, parseInt(page_size), offset);
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
console.log(\`[服务器] 本机访问: http://localhost:\${PORT}\`);
console.log(\`[服务器] 数据目录: \${DATA_DIR}\`);
console.log('\\n默认账号:');
console.log('  省代: dealer01 / 123456');
console.log('  市代(广州): dealer02 / 123456');
console.log('  市代(深圳): dealer03 / 123456');
console.log('  工程师(广州): engineer01 / 123456');
console.log('  工程师(深圳): engineer02 / 123456');
console.log('  总部: admin01 / 123456');

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
  console.log(\`[服务器] 局域网访问: http://\${localIP}:\${PORT}\`);
});

module.exports = app;
`;

fs.appendFileSync(p, PART2, 'utf8');
console.log('Part 2 appended:', PART2.length, 'bytes');