const fs = require('fs');
const c = fs.readFileSync('E:/YT-ASMT/server/server.js', 'utf8');

// Count U+FFFD
const fffd = (c.match(/\uFFFD/g) || []).length;
console.log('U+FFFD chars:', fffd);

// List all lines with issues
const lines = c.split('\n');
const issues = [];
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  // Check for corruption: Chinese char followed by ? that's not a real question
  const hasCorrupt = /[\u4e00-\u9fa5]\?(?:\s*[\)\};,]|\s*$)/.test(l);
  // Check for garbled Chinese (bytes that look wrong)
  const hasFFFD = l.includes('\uFFFD');
  
  if (hasCorrupt && !l.includes('LIKE ?') && !l.includes('= ?') && !l.includes('OFFSET ?') && !l.includes('LIMIT ?') && !l.includes('next.setMonth')) {
    issues.push({line: i+1, fffd: hasFFFD, corrupt: hasCorrupt, text: l.trim().substring(0, 120)});
  } else if (hasFFFD) {
    issues.push({line: i+1, fffd: true, text: l.trim().substring(0, 120)});
  }
}

console.log(`Issues found: ${issues.length}`);
issues.forEach(iss => console.log(`  L${iss.line}${iss.fffd ? ' [FFFD]' : ' [CORRUPT]'}: ${iss.text}`));

// Now fix ALL issues systematically
let c2 = c;

// 1. Remove all U+FFFD chars (they're always corruption)
c2 = c2.replace(/\uFFFD/g, '');

// 2. Fix Chinese strings ending with ? instead of closing '
// Pattern: 中文字符串? 后面跟 ) }, 等
c2 = c2.replace(/'([\u4e00-\u9fa5]{1,10})\?(\s*[\}\);,])/g, "'$1'$2");
c2 = c2.replace(/'([\u4e00-\u9fa5]{1,10})\?$/gm, "'$1'");

// 3. Fix demand_priority: ['高', '中', '低'] if corrupted
c2 = c2.replace(/demand_priority:\s*\[[^\]]*\]/g, "demand_priority: ['高', '中', '低']");
c2 = c2.replace(/inspection_cycles:\s*\[[^\]]*\]/g, "inspection_cycles: ['每周', '每两周', '每月']");
c2 = c2.replace(/flow_status:\s*\[[^\]]*\]/g, "flow_status: ['待处理', '处理中', '待复核', '已闭环']");

// 4. Fix comment separators that lost their = chars
c2 = c2.replace(/\/\/\s*(={3,})\s*([\u4e00-\u9fa5]+\s*)([\u4e00-\u9fa5\s]{1,15})(\?!={0,10})(\s*={0,10})$/gm, '// $1 $2$3$4$5');

// 5. Fix remaining corrupt quote endings in Chinese error messages
c2 = c2.replace(/不存在\?\s*(\}\);)/g, "不存在'$1");
c2 = c2.replace(/不能为空\?\s*(\}\);)/g, "不能为空'$1");
c2 = c2.replace(/已更新\?\s*/g, "已更新'");
c2 = c2.replace(/闭环\?\s*/g, "闭环'");

fs.writeFileSync('E:/YT-ASMT/server/server.js', c2, 'utf8');
console.log('\nFixes applied');