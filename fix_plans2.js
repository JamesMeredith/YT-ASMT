const fs = require('fs');
const file = 'E:/YT-ASMT/server/server.js';
let c = fs.readFileSync(file, 'utf8');

const bad = `// 巡检计划列表
app.get('/api/inspections/plans', (req, res) => {
  const db = getDbSync();
  const rows = db.prepare(\`
    SELECT p.*, h.hospital_name, u.real_name as engineer_name,
           (SELECT COUNT(*) FROM inspection_records WHERE plan_id = p.id) as record_count
    FROM inspection_plans p
    LEFT JOIN hospitals h ON p.hospital_id = h.id
    LEFT JOIN users u ON p.responsible_engineer_id = u.id
        req.user.role === 'headquarters' ? "" : "WHERE p.responsible_engineer_id = ?"
    ORDER BY p.created_at DESC
  \`).all(req.user.role === 'headquarters' ? [] : [req.user.id]);
  res.json({ data: rows });
});`;

const good = `// 巡检计划列表
app.get('/api/inspections/plans', (req, res) => {
  const db = getDbSync();
  const user = req.user;
  const isHQ = user.role === 'headquarters';
  const where = isHQ ? '' : 'WHERE p.responsible_engineer_id = ?';
  const params = isHQ ? [] : [user.id];
  const rows = db.prepare(\`
    SELECT p.*, h.hospital_name, u.real_name as engineer_name,
           (SELECT COUNT(*) FROM inspection_records WHERE plan_id = p.id) as record_count
    FROM inspection_plans p
    LEFT JOIN hospitals h ON p.hospital_id = h.id
    LEFT JOIN users u ON p.responsible_engineer_id = u.id
    \${where}
    ORDER BY p.created_at DESC
  \`).all(...params);
  res.json({ data: rows });
});`;

if (!c.includes(bad)) {
  console.error('Pattern not found in server.js');
  // Find what IS there
  const idx = c.indexOf('// 巡检计划列表');
  const section = c.substring(idx, idx + 600);
  console.log('Current section:\n' + section);
  process.exit(1);
}

c = c.replace(bad, good);
fs.writeFileSync(file, c, 'utf8');
console.log('Fixed');