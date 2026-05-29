const fs = require('fs');
let c = fs.readFileSync('E:/YT-ASMT/server/server.js', 'utf8');

// 复原：之前替换过头了，把注释里的分隔符也改了
// 先把注释行里不应该改的 ?=== 改回来
c = c.replace(/需求管理\?=/, '需求管理 =');
c = c.replace(/需求列表\?app/, '需求列表\napp');  // 把注释和代码分开

// 其他被误改的注释分隔符
c = c.replace(/(\s{5,})\?=/, '$1=');

fs.writeFileSync('E:/YT-ASMT/server/server.js', c, 'utf8');
console.log('Fixed comment separators');

// 再跑一次语法检查
