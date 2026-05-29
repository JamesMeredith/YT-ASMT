const fs = require('fs');
let c = fs.readFileSync('E:/YT-ASMT/server/server.js', 'utf8');

// Fix remaining issues
// Comment trailing ? chars (not real question marks, just corruption)
c = c.replace('// 更新设备状态?\n', '// 更新设备状态\n');
c = c.replace('// 知识库入库?\n', '// 知识库入库\n');
c = c.replace('// 供应商技术人员：只看自己负责医院的设备?\n', '// 供应商技术人员：只看自己负责医院的设备\n');
c = c.replace('// 维保固件升级时更新设备版本?\n', '// 维保固件升级时更新设备版本\n');
c = c.replace('// 仅当从故障工单上下文搜索时，才记录引用?\n', '// 仅当从故障工单上下文搜索时，才记录引用\n');
c = c.replace('// 名称重复检查?\n', '// 名称重复检查\n');

// Code fix: '个? → '个'
c = c.replace("unit || '个?", "unit || '个'");

fs.writeFileSync('E:/YT-ASMT/server/server.js', c, 'utf8');
console.log('Final fixes applied');