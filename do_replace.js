const fs = require('fs');
const file = 'E:/YT-ASMT/web/index.html';
let html = fs.readFileSync(file, 'utf8');
const newBlock = fs.readFileSync('E:/YT-ASMT/inspection_block.txt', 'utf8');

const startMarker = `    async function renderInspectionList(container) {`;
const endMarker = `    // ========== 维保台账 ==========`;

const startIdx = html.indexOf(startMarker);
const endIdx = html.indexOf(endMarker);

if (startIdx === -1) { console.error('Start not found'); process.exit(1); }
if (endIdx === -1) { console.error('End not found'); process.exit(1); }

const before = html.substring(0, startIdx);
const after = '\n' + html.substring(endIdx);

const result = before + newBlock + after;
fs.writeFileSync(file, result, 'utf8');
console.log('Done, replaced ' + (endIdx - startIdx) + ' chars with ' + newBlock.length + ' chars');
