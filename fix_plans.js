const fs = require('fs');
const file = 'E:/YT-ASMT/server/server.js';
let c = fs.readFileSync(file, 'utf8');

const bad = `    LEFT JOIN users u ON p.responsible_engineer_id = u.id
        req.user.role === 'headquarters' ? "" : "WHERE p.responsible_engineer_id = ?"
    ORDER BY p.created_at DESC
  \`).all(req.user.role === 'headquarters' ? [] : [req.user.id]);`;

const good = `    LEFT JOIN users u ON p.responsible_engineer_id = u.id
    ORDER BY p.created_at DESC
  \`).all();`;

if (!c.includes(bad)) {
  console.error('Bad pattern not found');
  // Debug: show the actual text around the plans endpoint
  const idx = c.indexOf('// 巡检计划列表');
  console.log(c.substring(idx, idx + 400));
  process.exit(1);
}

c = c.replace(bad, good);
fs.writeFileSync(file, c, 'utf8');
console.log('Done - replaced bad block');
