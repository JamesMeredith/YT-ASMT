const fs = require('fs');
let c = fs.readFileSync('E:/YT-ASMT/server/server.js', 'utf8');

// Walk through file line by line, fixing syntax issues
const lines = c.split('\n');
let lineNum = 1;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  // Fix: 'INSERT INTO ... VALUES (?,?,...,'?'  → add missing closing paren for VALUES
  // Pattern: VALUES (<params>,'\'')  where last param lost its closing
  const valsM = line.match(/VALUES\s*\(([^)]*)\s*,\s*'\'\'\)(\s*)$/);
  if (valsM) {
    // Should be VALUES (<before>,?)' 
    lines[i] = line.replace(/,\s*'\'\'\)/, ',?)'); 
    console.log(`L${i+1}: Fixed VALUES corruption`);
    continue;
  }
  
  // Fix: ... LIKE ')' → ... LIKE ?')
  if (line.includes("LIKE ')'") || line.includes("LIKE ')")) {
    lines[i] = line.replace(/LIKE\s+'\)'/g, "LIKE ?'").replace(/LIKE\s+'\)/g, "LIKE ?");
    console.log(`L${i+1}: Fixed LIKE corruption`);
    continue;
  }
  
  // Fix: = ')') → = ?')  (single-param WHERE)
  if (line.includes("= ')'") && line.includes('.prepare')) {
    lines[i] = line.replace(/= '\)'/g, "= ?'");
    console.log(`L${i+1}: Fixed WHERE = corruption`);
    continue;
  }
  
  // Fix: Chinese char followed by ? and } or );
  if (/[\u4e00-\u9fa5]\?[\s]*[\}\);,]/.test(line)) {
    lines[i] = line.replace(/([\u4e00-\u9fa5])\?(\s*[\}\);,])/g, "$1'$2");
    console.log(`L${i+1}: Fixed Chinese quote`);
    continue;
  }
}

fs.writeFileSync('E:/YT-ASMT/server/server.js', lines.join('\n'), 'utf8');
console.log('Done');
