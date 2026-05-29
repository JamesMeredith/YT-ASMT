const fs=require('fs'); const initSqlJs=require('./server/node_modules/sql.js');
initSqlJs().then(SQL=>{
  const db=new SQL.Database(fs.readFileSync('E:/YT-ASMT/data/yt_asmt.db'));
  db.run("ALTER TABLE pre_sales_projects ADD COLUMN closed_at DATETIME");
  console.log('ALTER executed');
  fs.writeFileSync('E:/YT-ASMT/data/yt_asmt.db', Buffer.from(db.export()));
  console.log('DB saved');
  const r=db.exec("SELECT name FROM pragma_table_info('pre_sales_projects') WHERE name='closed_at'");
  console.log('closed_at:', r.length&&r[0].values[0]?r[0].values[0][0]:'STILL MISSING');
  db.close(); process.exit(0);
}).catch(e=>{console.error(e.message);process.exit(1);});
