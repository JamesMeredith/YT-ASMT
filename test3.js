const fs = require('fs');
fs.appendFileSync('E:/YT-ASMT/test_log.txt', 'START\n');
console.log('START');
const path = require('path');
console.log('path ok');
const initSqlJs = require('sql.js');
console.log('sql.js module loaded');
initSqlJs().then(SQL => {
  console.log('sql.js WASM loaded');
  fs.appendFileSync('E:/YT-ASMT/test_log.txt', 'WASM loaded\n');
  
  const DATA_DIR = path.join(__dirname, 'server', '..', 'data');
  const DB_PATH = path.join(DATA_DIR, 'yt_asmt.db');
  console.log('DB_PATH:', DB_PATH);
  
  const db = new SQL.Database(fs.readFileSync(DB_PATH));
  console.log('DB opened');
  fs.appendFileSync('E:/YT-ASMT/test_log.txt', 'DB opened\n');
  
  // Try the migration ALTER TABLES
  db.run('ALTER TABLE IF NOT EXISTS hospitals ADD COLUMN test_col INTEGER');
  console.log('alter ok');  // This will probably fail because ALTER TABLE IF NOT EXISTS is not valid
  
  const r = db.exec('PRAGMA table_info(hospitals)');
  const cols = r[0].values.map(v => v[1]);
  console.log('columns:', cols.join(', '));
  
  db.close();
  process.exit(0);
}).catch(e => { 
  console.error('FAIL:', e.message);
  fs.appendFileSync('E:/YT-ASMT/test_log.txt', 'FAIL: ' + e.message + '\n');
  process.exit(1);
});
