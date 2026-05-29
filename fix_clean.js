const fs = require('fs');
let c = fs.readFileSync('E:/YT-ASMT/server/server.js', 'utf8');

// Show all remaining \uFFFD positions with exact 5-char context
let pos = 0;
let count = 0;
const indices = [];
while ((pos = c.indexOf('\uFFFD', pos)) >= 0) {
  indices.push(pos);
  const before = c.substring(Math.max(0, pos - 5), pos);
  const after = c.substring(pos + 1, Math.min(c.length, pos + 6));
  const charCodes = [];
  for (const ch of before + '\uFFFD' + after) {
    charCodes.push(ch.charCodeAt(0).toString(16));
  }
  console.log(`[${++count}] pos=${pos}: "${before}${after}" (hex: ${charCodes.join(' ')})`);
  pos++;
}

// Fix each occurrence
for (const idx of indices.reverse()) {
  // Check context around each \uFFFD
  const ctx = c.substring(idx - 2, idx + 2);
  const pre = c.substring(idx - 1, idx);
  const post = c.substring(idx + 1, idx + 2);
  
  // For most cases, the \uFFFD is a trailing extra char in a string that should be removed
  // Pattern: "理" → remove the 
  // Pattern: "?'" → remove the 
  console.log(`  Context: "${pre}${post}"`);
}

// Just remove all remaining \uFFFD (they're all garbage from corruption)
c = c.replace(/\uFFFD/g, '');
fs.writeFileSync('E:/YT-ASMT/server/server.js', c, 'utf8');
console.log(`Clean: removed ${indices.length} remaining \uFFFD chars`);