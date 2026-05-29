const fs = require('fs');
let c = fs.readFileSync('E:/YT-ASMT/server/server.js', 'utf8');

// Fix specific: priority || '中?); → priority || '中');
c = c.replace(/\|\| '中\?\)/g, "|| '中')");

// Scan for other '...?);  '...?}); patterns - these are broken closing quotes
const re = /'([^']+?)\?\s*\)/g;
let matches = [];
let m;
while ((m = re.exec(c)) !== null) {
  const before = c.substring(Math.max(0, m.index - 20), m.index);
  matches.push(`${before.trim()} → '${m[1]}')`);
  // Fix: replace '...?)\n with '...')\n 
  c = c.substring(0, m.index) + "'" + m[1] + "')" + c.substring(m.index + m[0].length);
  // Reset regex state
  re.lastIndex = m.index + ("'" + m[1] + "')").length;
}

console.log(`Fixed ${matches.length} broken closing quotes:`);
matches.slice(0, 20).forEach(s => console.log('  ' + s.substring(0, 100)));

// Also fix 'xxx?}, → 'xxx'},\n etc.
c = c.replace(/'([^']+?)\?\s*(\},\s*)/g, "'$1'$2");

fs.writeFileSync('E:/YT-ASMT/server/server.js', c, 'utf8');
