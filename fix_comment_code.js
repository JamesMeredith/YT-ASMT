const fs = require('fs');
let c = fs.readFileSync('E:/YT-ASMT/server/server.js', 'utf8');

// Fix: Lines where // <comment> <orphaned code> 
// These happen because the original "// comment\ncode" got merged by corruption
// Pattern:  // <chinese>? or // <chinese> followed by app.*(
c = c.replace(/\/\/ 设备状态变更\?/g, '// 设备状态变更\n');
c = c.replace(/\/\/ 需求列表\?/g, '// 需求列表\n');
c = c.replace(/\/\/ 新建需求\?/g, '// 新建需求\n');
c = c.replace(/\/\/ 需求评估（仅总部）\?/g, '// 需求评估（仅总部）\n');
c = c.replace(/\/\/ 需求列\?/g, '// 需求列表\n');  // already split above

// Generic fix: // <CJK>?app. → // <CJK>\napp.
c = c.replace(/\/\/ ([\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef（）\s]{2,40})\?app\./g, '// $1\napp.');

// Also check for other merged comment+code patterns
c = c.replace(/\/\/ ([\u4e00-\u9fa5\s]{2,60})\?(\w)/g, '// $1\n$2');

fs.writeFileSync('E:/YT-ASMT/server/server.js', c, 'utf8');
console.log('Fixed merged comment+code lines');