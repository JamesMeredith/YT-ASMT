const fs = require('fs');
let c = fs.readFileSync('E:/YT-ASMT/server/server.js', 'utf8');

// Fix line 87: missing closing quote before )
c = c.replace("VALUES (?,?,?,?))", "VALUES (?,?,?,?)')");

// Check for other similar: .prepare('...?)) pattern (missing closing ')
c = c.replace(/\.prepare\('([^']*?)\?\)\)/g, ".prepare('$1')')");

// Also: .prepare('...?'\n → fix ending
c = c.replace(/\.prepare\('([^']{20,}?)\?$(\s*\n)/gm, ".prepare('$1')$2");

fs.writeFileSync('E:/YT-ASMT/server/server.js', c, 'utf8');
console.log('Fixed SQL quote issues');