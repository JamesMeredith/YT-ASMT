const fs = require('fs');
let c = fs.readFileSync('E:/YT-ASMT/server/server.js', 'utf8');

// Final targeted fixes for remaining 9 \uFFFD
const finalFixes = [
  // "待复?" → "待复核" (3 occurrences)
  ["'待复\uFFFD", "'待复核"],
  
  // Unit default value  
  ["unit || '\uFFFD", "unit || '个"],
  
  // Default priority
  ["priority || '\uFFFD", "priority || '中"],
  
  // Inspection comment
  ["（暂停\uFFFD恢复/结束 \uFFFD", "（暂停/恢复/结束 ——"],
  
  // Dicts - clean up comma-separated status arrays with \uFFFD between them
  // The issue: status labels have been fixed but \uFFFD remains between them
  // '待处理?\,' → '待处理',\n  etc
  ["'待处理\uFFFD,", "'待处理',"],
  ["'处理中\uFFFD,", "'处理中',"],
  ["'待复核\uFFFD,", "'待复核',"],
  ["'已闭环\uFFFD,", "'已闭环',"],
  ["'进行中\uFFFD,", "'进行中',"],
  ["'维修中\uFFFD,", "'维修中',"],
  ["'已报废\uFFFD,", "'已报废',"],
  ["'已采纳\uFFFD,", "'已采纳',"],
  ["'已驳回\uFFFD,", "'已驳回',"],
  ["'已上线\uFFFD,", "'已上线',"],
  ["'已关闭\uFFFD?,", "'已关闭',"],
  ["'异常待处理\uFFFD,", "'异常待处理',"],
  ["'非常满意\uFFFD,", "'非常满意',"],
  ["'不满意\uFFFD,", "'不满意',"],
  ["'每周\uFFFD,", "'每周',"],
  ["'每两周\uFFFD,", "'每两周',"],
  ["'每月\uFFFD,", "'每月',"],
  
  // End of array: 'xxx'] → removes trailing \uFFFD
  ["'已闭环\uFFFD]", "'已闭环']"],
  ["'已上线\uFFFD]", "'已上线']"],
  ["'已报废\uFFFD]", "'已报废']"],
  
  // Special: demand_priority inline with garbled values
  // demand_priority: ['\uFFFD', '\uFFFD', '\uFFFD']
  ["['\uFFFD', '\uFFFD', '\uFFFD']", "['高', '中', '低']"],
  
  // Any remaining standalone \uFFFD within array brackets: , '\uFFFD', → remove
  ["\uFFFD', ", "', "],
  ["\uFFFD']", "']"],
];

let count = 0;
for (const [bad, good] of finalFixes) {
  if (c.includes(bad)) {
    c = c.split(bad).join(good);
    count++;
  }
}

fs.writeFileSync('E:/YT-ASMT/server/server.js', c, 'utf8');

const remaining = (c.match(/\uFFFD/g) || []).length;
console.log(`${count} fixes applied, ${remaining} remaining \uFFFD`);

if (remaining > 0) {
  console.log('Remaining occurrences:');
  let idx = 0;
  let pos = 0;
  while ((pos = c.indexOf('\uFFFD', pos)) >= 0) {
    const ctx = c.substring(Math.max(0, pos - 10), Math.min(c.length, pos + 10)).replace(/\n/g, '\\n');
    console.log(`  [${++idx}] at ${pos}: ...${ctx}...`);
    pos++;
  }
}