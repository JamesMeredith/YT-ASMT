const fs = require('fs');
const file = 'E:/YT-ASMT/server/server.js';
let c = fs.readFileSync(file, 'utf8');

// 1. Plans: replace WHERE filter
const oldPlans = `    WHERE p.responsible_engineer_id = ?
    ORDER BY p.created_at DESC
  \`).all(req.user.id);
  res.json({ data: rows });`;

const newPlans = req => `    ${req.user.role === 'headquarters' ? '' : "WHERE p.responsible_engineer_id = ?"}
    ORDER BY p.created_at DESC
  \`).all${req.user.role === 'headquarters' ? '' : '(req.user.id)'});
  res.json({ data: rows });`;

// Direct string replacement for plans
c = c.replace(
  /WHERE p\.responsible_engineer_id = \?\s+ORDER BY p\.created_at DESC\s+\`?\)\.all\(req\.user\.id\);?\s+res\.json\(\{ data: rows \}\);/g,
  (match) => {
    const isHQ = "req.user.role === 'headquarters'";
    return `    ${isHQ + ' ? "" : "WHERE p.responsible_engineer_id = ?"'}
    ORDER BY p.created_at DESC
  \`).all(${isHQ} ? [] : [req.user.id]);
  res.json({ data: rows });`;
  }
);

console.log('Plans replacement done');

// 2. Records: modify WHERE clause builder
const oldRecWhere = `  let where = ['ir.engineer_id = ?'];
  let params = [req.user.id];`;

const newRecWhere = `  let where = [];
  let params = [];
  if (req.user.role !== 'headquarters') { where.push('ir.engineer_id = ?'); params.push(req.user.id); }`;

if (!c.includes(oldRecWhere)) {
  console.error('ERROR: Could not find records where clause');
  process.exit(1);
}
c = c.replace(oldRecWhere, newRecWhere);
console.log('Records replacement done');

fs.writeFileSync(file, c, 'utf8');
console.log('File saved');
