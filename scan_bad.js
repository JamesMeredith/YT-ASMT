const fs = require('fs');
let c = fs.readFileSync('E:/YT-ASMT/server/server.js', 'utf8');
const lines = c.split('\n');
const replaces = [];

// Scan for garbled chars in error messages
// Pattern: error: '<garbled>' or  'garbled' ) or 'garbled');
lines.forEach((line, i) => {
  // Check for replacement character U+FFFD (shown as ? in console)
  if (line.includes('\uFFFD')) {
    replaces.push(`L${i+1}: REPLACEMENT CHAR - ${line.trim().substring(0, 120)}`);
  }
  // Also check for invalid surrogate characters
  for (let j = 0; j < line.length; j++) {
    const ch = line.charCodeAt(j);
    if (ch >= 0xDC00 && ch <= 0xDFFF) {
      if (j > 0 && line.charCodeAt(j-1) >= 0xD800 && line.charCodeAt(j-1) <= 0xDBFF) {
        // This is a valid surrogate pair, skip both
        j++;
        continue;
      }
      // Lone low surrogate - invalid
      replaces.push(`L${i+1}: LONE SURROGATE at col ${j} - ${line.trim().substring(0, 120)}`);
    }
  }
});

console.log(replaces.join('\n'));
console.log(`\nTotal issues: ${replaces.length}`);
