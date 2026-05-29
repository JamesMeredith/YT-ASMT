const { getDb } = require('E:/YT-ASMT/server/db.js');
getDb().then(db => {
  const cols = db.exec('PRAGMA table_info(users)');
  console.log(cols[0].values.map(c => c[1]).join(', '));
  const row = db.exec("SELECT * FROM users LIMIT 1");
  console.log(JSON.stringify(row[0].values[0]));
});