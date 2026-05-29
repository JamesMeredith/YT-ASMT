const fs = require('fs');
let c = fs.readFileSync('E:/YT-ASMT/server/server.js', 'utf8');

// Undo over-aggressive replacements in SQL statements
// Pattern: VALUES (?,?,?,',') → VALUES (?,?,?,?)
c = c.replace(/VALUES\s*\(([^)]*\?)\s*,\s*'\)\)/g, 'VALUES ($1,?)');
// Generic: , ')' → ,?
c = c.replace(/,\s*'\)'/g, ',?)'); 
c = c.replace(/\?\s*,\s*'\)'/g, '?,?)');
// Fix triple: ?,?,'), ') → ?,?,?)
c = c.replace(/\?\s*,\s*\?\s*,\s*'\)\s*,\s*'\)\)/g, '?,?,?)');
// Fix INSERT ...'), ') → INSERT ...?)
c = c.replace(/VALUES\s*\(([^)]*\?[^)]*)\s*,\s*'\)\s*,\s*'\)\)/g, 'VALUES ($1,?,?)');

// Scan for remaining '?' patterns that are definitely corrupt
// Only fix patterns where the ? follows a Chinese character UP TO the end of a string
c = c.replace(/'([\u4e00-\u9fa5]{1,5})\?(\s*[\}\);])/g, "'$1'$2");

fs.writeFileSync('E:/YT-ASMT/server/server.js', c, 'utf8');
console.log('Fixed over-aggressive replacements');