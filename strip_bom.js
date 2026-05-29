const fs = require('fs');
let buf = fs.readFileSync('E:/YT-ASMT/server/server.js');

// Check for BOM
if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
  console.log('BOM found, removing...');
  buf = buf.subarray(3);
  fs.writeFileSync('E:/YT-ASMT/server/server.js', buf);
  console.log('BOM removed');
} else {
  console.log('No BOM found');
}