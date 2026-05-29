const fs=require('fs'); const initSqlJs=require('./server/node_modules/sql.js');
initSqlJs().then(SQL=>{
  const db=new SQL.Database(fs.readFileSync('E:/YT-ASMT/data/yt_asmt.db'));
  const r=db.exec("SELECT sql FROM sqlite_master WHERE name='pre_sales_projects'");
  console.log(r[0].values[0][0]);
  db.close(); process.exit(0);
}).catch(e=>{console.error(e);process.exit(1);});
