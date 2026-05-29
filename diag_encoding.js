const fs = require('fs');

// Read raw bytes and try to detect/fix encoding corruption
const buf = fs.readFileSync('E:/YT-ASMT/server/server.js');
const len = buf.length;

// The corruption path: UTF-8 bytes → read as ANSI/GBK (1 byte per char) → written as UTF-8
// This means multi-byte UTF-8 sequences got split into individual bytes,
// then each byte was written as its own UTF-8 codepoint

// For example: "未" in UTF-8 = E6 9C AA (3 bytes)
// After corruption: 0xE6 → ã, 0x9C → œ, 0xAA → ª (in ISO-8859-1)
// Then written as UTF-8: c3 a6 c2 9c c2 aa

// Detecting: look for patterns where original valid UTF-8 was double-encoded
// Search for common Chinese error message patterns

// Let's try a simpler approach: search for known byte sequences
// that represent corrupted Chinese text

// Check for the BOM
console.log('BOM:', buf[0], buf[1], buf[2]);

// Find what's around the upload route (line ~74)
const str = buf.toString('utf8');
const idx = str.indexOf("if (!files || files.length === 0)");
if (idx >= 0) {
  console.log('Upload route at byte', idx);
  console.log('Context:', str.substring(idx, idx + 100));
}

// Also check: is the file mostly-readable? Count lines
const lines = str.split('\n');
let badLines = 0;
for (let i = 0; i < lines.length; i++) {
  // Check for garbled Chinese in string literals
  if (/['"]\s*[\x80-\xFF]{2,}/.test(lines[i])) {
    badLines++;
    if (badLines <= 5) {
      console.log(`Bad line ${i+1}: ${lines[i].substring(0, 80)}`);
    }
  }
}
console.log('Total bad lines:', badLines);