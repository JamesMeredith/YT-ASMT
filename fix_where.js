const fs = require('fs');
let c = fs.readFileSync('E:/YT-ASMT/server/server.js', 'utf8');
c = c.replace("const whereStr = 'WHERE ' + where.join(' AND ');", "const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';");
fs.writeFileSync('E:/YT-ASMT/server/server.js', c, 'utf8');
console.log('Done');