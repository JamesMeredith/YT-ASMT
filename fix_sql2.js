const fs = require('fs');
let c = fs.readFileSync('E:/YT-ASMT/server/server.js', 'utf8');

// The regex '(.+?)\?\s*\) replaced ? with ' in SQL LIKE/WHERE clauses
// Fix: In SQL strings, restore ? that was replaced with '
// Pattern: LIKE ')' → LIKE ?') 
// Pattern: = ')' → = ?')
// Pattern: ')'params → ?')params (missing quote)

c = c.replace(/LIKE '\)'/g, "LIKE ?'");  // LIKE '?' → LIKE ?'
c = c.replace(/LIKE '\)/g, "LIKE ?");    // LIKE '?) → LIKE ?)
c = c.replace(/= '\)'/g, "= ?'");         // = '?' → = ?'
c = c.replace(/= '\)/g, "= ?'");          // = '?) → = ?)

// Generic: inside SQL strings in .prepare('...'), fix ')' → ?)
// Careful: this should only apply to SQL parameter placeholders
// Pattern: .prepare('...LIKE ')' → LIKE ?')
c = c.replace(/'\)'\s*,\s*(params|db\.|c\.|const|let|var)/gm, "?'), $1");

// Also fix numbers in context: LIMIT ')' → LIMIT ?')
c = c.replace(/LIMIT '\)'/g, "LIMIT ?'");
c = c.replace(/OFFSET '\)'/g, "OFFSET ?'");
c = c.replace(/WHERE \w+ = '\)'/g, (match) => match.replace("=')'", "=?'"));

// Fix: ), ')' → ), ?'
c = c.replace(/\),\s*'\)'/g, "), ?'");

fs.writeFileSync('E:/YT-ASMT/server/server.js', c, 'utf8');
console.log('Fixed SQL placeholder damage');