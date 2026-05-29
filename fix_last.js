const fs = require('fs');
const c = fs.readFileSync('E:/YT-ASMT/server/server.js', 'utf8');

// Check remaining issues
const remaining = (c.match(/\uFFFD/g) || []).length;
console.log(`Remaining: ${remaining}`);

// Fix 1: inspection comment
let c2 = c.replace('（暂停\uFFFD恢复/结束 \uFFFD总部管理用）', '（暂停/恢复/结束 ——总部管理用）');

// Fix 2: demand_priority - look at exact bytes around pos 53625
const section = c.substring(53595, 53700);
console.log('\nDemand priority area:');
for (let i = 0; i < section.length; i++) {
  const ch = section[i];
  if (ch.charCodeAt(0) > 127) {
    process.stdout.write(`[${ch}:U+${ch.charCodeAt(0).toString(16)}]`);
  } else {
    process.stdout.write(ch);
  }
}
console.log('\n');

// Check inspection comment area
const insp = c.substring(29835, 29900);
console.log('Inspection comment area:');
for (let i = 0; i < insp.length; i++) {
  const ch = insp[i];
  if (ch.charCodeAt(0) > 127) {
    process.stdout.write(`[${ch}:U+${ch.charCodeAt(0).toString(16)}]`);
  } else {
    process.stdout.write(ch);
  }
}
console.log('\n');

// Apply fixes
c2 = c2.replace('demand_priority: [\uFFFD, \uFFFD, \uFFFD]', "demand_priority: ['高', '中', '低']");
c2 = c2.replace("['\uFFFD', '\uFFFD', '\uFFFD']", "['高', '中', '低']");

// If still broken, fix by direct byte-level replacement
if ((c2.match(/\uFFFD/g) || []).length > 0) {
  // Find and replace each remaining \uFFFD in the priority array
  // The chars are: ', \uFFFD, ', \uFFFD, ', \uFFFD]'
  c2 = c2.replace(/\[\x27\uFFFD\x27,\s*\x27\uFFFD\x27,\s*\x27\uFFFD\x27\]/g, "['高', '中', '低']");
}

fs.writeFileSync('E:/YT-ASMT/server/server.js', c2, 'utf8');
const final = (c2.match(/\uFFFD/g) || []).length;
console.log(`After fix: ${final} remaining`);
