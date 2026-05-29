const bcrypt = require('E:/YT-ASMT/server/node_modules/bcryptjs');
const hash = '$2a$10$aDoDe2Pq8Ob.GGPFQs6xC.WJoxQ23sBTGzfLOw0.FdtTu7MrZPKbW';

// Test compare
bcrypt.compare('123456', hash).then(r => console.log('bcrypt.compare 123456:', r));

// Also try admin@123
bcrypt.compare('admin@123', hash).then(r => console.log('bcrypt.compare admin@123:', r));

// Try generating hash
bcrypt.hash('123456', 10).then(h => console.log('bcrypt.hash 123456:', h));

// Check if hashed matches stored format
const parts = hash.split('$');
console.log('Hash parts:', parts);