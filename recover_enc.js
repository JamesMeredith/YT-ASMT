const fs = require('fs');

// Read corrupted file as UTF-8 text
const corrupted = fs.readFileSync('E:/YT-ASMT/server/server.js', 'utf8');

// Reverse the double-encoding corruption:
// The file was: original UTF-8 → read as ANSI (1 byte per char) → written as UTF-8
// So each corrupted char represents ONE original byte (codepoint 0x00-0xFF)
// Recovery: take each codepoint → output as single byte → interpret as UTF-8

const bytes = [];
for (let i = 0; i < corrupted.length; i++) {
  const cp = corrupted.charCodeAt(i);
  if (cp === 0xFEFF) { /* skip BOM */ continue; }
  if (cp <= 0xFF) {
    bytes.push(cp);
  } else {
    // Multi-byte codepoint → this was likely already correct UTF-8
    // Write it as-is
    const b = Buffer.from(corrupted[i], 'utf8');
    for (let j = 0; j < b.length; j++) bytes.push(b[j]);
  }
}
const recovered = Buffer.from(bytes).toString('utf8');
fs.writeFileSync('E:/YT-ASMT/server_recovered.js', recovered, 'utf8');
console.log('Written recovered file, length:', recovered.length);