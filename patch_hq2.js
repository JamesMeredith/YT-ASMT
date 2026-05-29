const fs = require('fs');
const file = 'E:/YT-ASMT/server/server.js';
let c = fs.readFileSync(file, 'utf8');

// 1. Plans create: HQ can assign engineer
const oldPlansCreate = `  const rec = db.prepare('INSERT INTO inspection_plans (plan_name,hospital_id,device_codes,cycle,start_date,responsible_engineer_id,next_inspection_date) VALUES (?,?,?,?,?,?,?)')
    .run(plan_name, hospital.id, JSON.stringify(device_codes || []), cycle, start_date, req.user.id, start_date);`;

const newPlansCreate = `  // 总部可指定工程师，非总部默认自己
  const respEngineerId = (req.user.role === 'headquarters' && req.body.engineer_id) ? req.body.engineer_id : req.user.id;
  const rec = db.prepare('INSERT INTO inspection_plans (plan_name,hospital_id,device_codes,cycle,start_date,responsible_engineer_id,next_inspection_date) VALUES (?,?,?,?,?,?,?)')
    .run(plan_name, hospital.id, JSON.stringify(device_codes || []), cycle, start_date, respEngineerId, start_date);`;

if (!c.includes(oldPlansCreate)) {
  console.error('ERROR: Plans create block not found');
  process.exit(1);
}
c = c.replace(oldPlansCreate, newPlansCreate);
console.log('1. Plans create OK');

// 2. Add PATCH endpoint for plans (pause/resume/end)
const mark = `// 巡检记录
app.post('/api/inspections/records',`;

const plansPatchAPI = `// 更新巡检计划（暂停/恢复/结束 — 总部管理用）
app.patch('/api/inspections/plans/:id', (req, res) => {
  const db = getDbSync();
  if (req.user.role !== 'headquarters') return res.status(403).json({ error: '仅总部可管理' });
  const id = parseInt(req.params.id);
  const { status, engineer_id } = req.body;
  const plan = db.prepare('SELECT * FROM inspection_plans WHERE id=?').get(id);
  if (!plan) return res.status(404).json({ error: '计划不存在' });
  if (status) db.prepare('UPDATE inspection_plans SET status=? WHERE id=?').run(status, id);
  if (engineer_id) db.prepare('UPDATE inspection_plans SET responsible_engineer_id=? WHERE id=?').run(engineer_id, id);
  res.json({ message: '已更新' });
});

// 巡检记录
app.post('/api/inspections/records',`;

if (!c.includes(mark)) {
  console.error('ERROR: Insert marker not found');
  process.exit(1);
}
c = c.replace(mark, plansPatchAPI);
console.log('2. Plans PATCH API OK');

fs.writeFileSync(file, c, 'utf8');
console.log('All done');