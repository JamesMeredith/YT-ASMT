const fs = require('fs');
const file = 'E:/YT-ASMT/server/server.js';
let c = fs.readFileSync(file, 'utf8');

// Find and replace the broken plans GET handler
const marker = '// ====================== 巡检 =======================';
const idx = c.indexOf(marker);
if (idx === -1) { console.error('Marker not found'); process.exit(1); }

// Find the end of this handler (next app. or next // =)
const after = c.indexOf('// =====================', idx + marker.length);
if (after === -1) { console.error('End marker not found'); process.exit(1); }

const before = c.substring(0, idx);
const after2 = c.substring(after);

const newCode = `// ====================== 巡检 =======================

// 巡检计划列表
app.get('/api/inspections/plans', (req, res) => {
  const db = getDbSync();
  const user = req.user;
  const isHQ = user.role === 'headquarters';
  const rows = db.prepare(\`
    SELECT p.*, h.hospital_name, u.real_name as engineer_name,
           (SELECT COUNT(*) FROM inspection_records WHERE plan_id = p.id) as record_count
    FROM inspection_plans p
    LEFT JOIN hospitals h ON p.hospital_id = h.id
    LEFT JOIN users u ON p.responsible_engineer_id = u.id
    \${isHQ ? '' : 'WHERE p.responsible_engineer_id = ?'}
    ORDER BY p.created_at DESC
  \`).all(...(isHQ ? [] : [user.id]));
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
  if (!hospital) return res.status(400).json({ error: '医院不存�? });

  // 总部可指定工程师，非总部默认自己
  const respEngineerId = (req.user.role === 'headquarters' && req.body.engineer_id) ? req.body.engineer_id : req.user.id;

  const rec = db.prepare(\`INSERT INTO inspection_plans (plan_name,hospital_id,device_codes,cycle,start_date,responsible_engineer_id,next_inspection_date) VALUES (?,?,?,?,?,?,?)\`)
    .run(plan_name, hospital.id, JSON.stringify(device_codes || []), cycle, start_date, respEngineerId, start_date);

  res.json({ success: true, plan_id: rec.lastInsertRowid });
});

// 更新巡检计划（暂�?恢复/结束 �?总部管理用）
app.patch('/api/inspections/plans/:id', (req, res) => {
  const db = getDbSync();
  if (req.user.role !== 'headquarters') return res.status(403).json({ error: '仅总部可管�? });
  const id = parseInt(req.params.id);
  const { status, engineer_id } = req.body;
  const plan = db.prepare('SELECT * FROM inspection_plans WHERE id=?').get(id);
  if (!plan) return res.status(404).json({ error: '计划不存�? });
  if (status) db.prepare('UPDATE inspection_plans SET status=? WHERE id=?').run(status, id);
  if (engineer_id) db.prepare('UPDATE inspection_plans SET responsible_engineer_id=? WHERE id=?').run(engineer_id, id);
  res.json({ message: '已更�? });
});

// 巡检记录
app.post('/api/inspections/records', (req, res) => {
  const db = getDbSync();
  const {
    plan_id, device_code, inspect_date,
    appearance_ok, wall_distance, ground_level,
    firmware_version, app_version, run_hours, ip_address, network_stable, packet_loss_rate,
    drug_inventory_ok, drug_low_stock_num, drug_expiring_num,
    screen_ok, scanner_ok, printer_ok, lock_ok,
    result, note
  } = req.body;

  const rec = db.prepare(\`
    INSERT INTO inspection_records
    (plan_id,device_code,engineer_id,inspect_date,appearance_ok,wall_distance,ground_level,
     firmware_version,app_version,run_hours,ip_address,network_stable,packet_loss_rate,
     drug_inventory_ok,drug_low_stock_num,drug_expiring_num,
     screen_ok,scanner_ok,printer_ok,lock_ok,result,note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  \`).run(
    plan_id || null, device_code, req.user.id, inspect_date || new Date().toISOString().slice(0, 10),
    appearance_ok ? 1 : 0, wall_distance || null, ground_level || null,
    firmware_version || '', app_version || '', run_hours || 0,
    ip_address || '', network_stable ? 1 : 0, packet_loss_rate || null,
    drug_inventory_ok ? 1 : 0, drug_low_stock_num || 0, drug_expiring_num || 0,
    screen_ok ? 1 : 0, scanner_ok ? 1 : 0, printer_ok ? 1 : 0, lock_ok ? 1 : 0,
    result || '正常', note || ''
  );

  // 更新下次巡检时间
  if (plan_id) {
    const plan = db.prepare('SELECT * FROM inspection_plans WHERE id = ?').get(plan_id);
    if (plan) {
      const next = new Date(inspect_date || new Date());
      if (plan.cycle === '每周') next.setDate(next.getDate() + 7);
      else if (plan.cycle === '每两�?) next.setDate(next.getDate() + 14);
      else next.setMonth(next.getMonth() + 1);
      db.prepare('UPDATE inspection_plans SET next_inspection_date=? WHERE id=?')
        .run(next.toISOString().slice(0, 10), plan_id);
    }
  }

  res.json({ record_id: rec.lastInsertRowid });
});

// 巡检记录列表
app.get('/api/inspections/records', (req, res) => {
  const db = getDbSync();
  const { plan_id, page = 1, page_size = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(page_size);
  let where = [];
  let params = [];
  if (req.user.role !== 'headquarters') { where.push('ir.engineer_id = ?'); params.push(req.user.id); }
  if (plan_id) { where.push('ir.plan_id = ?'); params.push(parseInt(plan_id)); }
  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(\`SELECT COUNT(*) as cnt FROM inspection_records ir \${whereStr}\`).get(...params).cnt;
  const rows = db.prepare(\`
    SELECT ir.*, ip.plan_name, d.device_type, h.hospital_name
    FROM inspection_records ir
    LEFT JOIN inspection_plans ip ON ir.plan_id = ip.id
    LEFT JOIN devices d ON ir.device_code = d.device_code
    LEFT JOIN hospitals h ON d.hospital_id = h.id
    \${whereStr}
    ORDER BY ir.inspect_date DESC LIMIT ? OFFSET ?
  \`).all(...params, parseInt(page_size), offset);
  res.json({ total, page: parseInt(page), page_size: parseInt(page_size), data: rows });
});

// 更新巡检记录（异常处理闭环）
app.patch('/api/inspections/records/:id', (req, res) => {
  const db = getDbSync();
  const { result, note } = req.body;
  const id = parseInt(req.params.id);
  const record = db.prepare('SELECT * FROM inspection_records WHERE id=?').get(id);
  if (!record) return res.status(404).json({ error: '记录不存�? });
  if (result) {
    db.prepare("UPDATE inspection_records SET result=?,note=COALESCE(?,note),created_at=created_at WHERE id=?")
      .run(result, note || null, id);
  }
  res.json({ message: '已更�? });
});

`;

c = before + newCode + after2;
fs.writeFileSync(file, c, 'utf8');
console.log('Done - replaced inspections block');
