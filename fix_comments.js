const fs = require('fs');
let c = fs.readFileSync('E:/YT-ASMT/server/server.js', 'utf8');

// Problem: many comments and code got merged onto the same line
// Pattern: // <Chinese comment>  const ... = db.prepare(`
// This causes the backtick template literal to become orphaned

// Fix all instances of "// <any text>  const" with newline
c = c.replace(/\/\/ [^\n]+  (const|let|var|  \/\/|  const)/g, (match) => {
  // Split at the "  const"/"  let"/"  var" boundary
  const idx = match.lastIndexOf('  ');
  return match.substring(0, idx) + '\n' + match.substring(idx).trimStart();
});

// Also fix "// <text>)  <code>" - comment and code on same line where code after space
c = c.replace(/\/\/ [^\n]+  (?=\w)/g, (match) => {
  const idx = match.lastIndexOf('  ');
  if (idx < 0) return match;
  return match.substring(0, idx) + '\n' + match.substring(idx + 2);
});

fs.writeFileSync('E:/YT-ASMT/server/server.js', c, 'utf8');
console.log('Applied comment/code separation fixes');
console.log('Lines:', c.split('\n').length);
