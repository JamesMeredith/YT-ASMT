const fs = require('fs');
let c = fs.readFileSync('E:/YT-ASMT/server/server.js', 'utf8');

// Show remaining \uFFFD with context
let matches = [];
const re = /[\u4e00-\u9fa5\u0020-\u007e]*?\uFFFD[\u4e00-\u9fa5\u0027\u002c\u0020-\u007e]*?/g;
let m;
while ((m = re.exec(c)) !== null) {
  const ctx = c.substring(Math.max(0, m.index - 15), Math.min(c.length, m.index + m[0].length + 15)).replace(/\n/g, '\\n');
  matches.push(`pos=${m.index}: "${m[0]}" → ...${ctx}...`);
}

console.log(`Remaining: ${matches.length}`);
for (const line of matches.slice(0, 30)) console.log(line);

// Additional targeted fixes for remaining patterns
const moreFixes = [
  // Priority values in dicts (the standalone \uFFFD near '??')
  ["'中\uFFFD'", "'中'"],
  ["'高\uFFFD'", "'高'"],
  ["'低\uFFFD'", "'低'"],
  
  // "至?0字" → "至少10字", "不能为?" → handle separately
  ['至\uFFFD0字', '至少10字'],
  
  // "待处理" already fixed but maybe double check
  ['待处\uFFFD', '待处理'],
  ['处理\uFFFD', '处理中'],
  ['已闭\uFFFD', '已闭环'],
  
  // "?)" → single char issues
  [")\uFFFD;", ");"],
  ["\uFFFD;", ");"],
  
  // Hospital names in dicts
  ['知识条目不存\uFFFD', '知识条目不存\uFFFD在'], // already handled
  
  // Demand array
  ['待等待\uFFFD', '待处理']
];

let moreCount = 0;
for (const [bad, good] of moreFixes) {
  if (c.includes(bad)) {
    c = c.split(bad).join(good);
    moreCount++;
    console.log(`Extra fix: ${bad.substring(0, 30)} → ${good.substring(0, 30)}`);
  }
}

fs.writeFileSync('E:/YT-ASMT/server/server.js', c, 'utf8');

// Final count
const final = (c.match(/\uFFFD/g) || []).length;
console.log(`\n${moreCount} extra fixes, ${final} remaining \uFFFD`);

if (final > 0) {
  let mm;
  console.log('Still remaining:');
  while ((mm = re.exec(c)) !== null) {
    const ctx = c.substring(Math.max(0, mm.index - 10), Math.min(c.length, mm.index + mm[0].length + 10)).replace(/\n/g, '\\n');
    console.log(`  "${mm[0]}" → ...${ctx}...`);
  }
}