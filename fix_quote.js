const fs = require('fs');
let c = fs.readFileSync('E:/YT-ASMT/server/server.js', 'utf8');
const lines = c.split('\n');

// Find lines where '...? appears within what should be a JavaScript string
// Pattern: single quote, some text, then '?' where closing quote should be
let badLines = [];
lines.forEach((line, i) => {
  // Pattern: ? before }); or ? before ); or ?;\n
  if (/\?\s*\}[);]/.test(line) || /\?\s*\)\s*;/.test(line)) {
    // Check if this is a legitimate ternary or just a broken string
    if (/'[^']*\?\s*[});]/.test(line)) {
      badLines.push({ line: i+1, text: line.trim() });
    }
  }
});

console.log(`Found ${badLines.length} lines with ?-corrupted closing quotes:`);
badLines.slice(0, 30).forEach(l => console.log(`  L${l.line}: ${l.text.substring(0, 120)}`));

// Fix: in single-quoted strings, replace ? before } ) ; with '
// But be careful not to match actual ? in valid JavaScript
// Pattern: within a single-quoted string, ? followed by } or ) or ; or ... 
// We'll use a targeted regex

// Fix: "不存在? }" → "不存在' }"
c = c.replace(/不存\u5728\?\s*(\}[\);,])/g, "不存在'$1");
// Fix: "不存\n?" pattern
c = c.replace(/不存\u5728\?\s*(\n)/g, "不存在'$1");

// Generic: Fix all '...中文?...'? patterns where last char before ? is CJK
// Scan for: CJK char followed by ? followed by }); or similar
c = c.replace(/([\u4e00-\u9fa5])\?\s*(\}[\);,])/g, "$1'$2");

// Also fix "? after quote " pattern (closing quote got replaced)
// 'xxx? → 'xxx'
c = c.replace(/'([^']{2,20})\?(\s*[\}\);\n,])/g, "'$1'$2");

// Fix specific remaining patterns
c = c.replace(/'([^\x00-\x7f]{2,6})\?/g, "'$1'"); // CJK followed by ?

fs.writeFileSync('E:/YT-ASMT/server/server.js', c, 'utf8');
console.log('\nFixed closing quote corruption');