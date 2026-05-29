const fs=require('fs'); const initSqlJs=require('./server/node_modules/sql.js');
initSqlJs().then(SQL=>{
  const db=new SQL.Database(fs.readFileSync('E:/YT-ASMT/data/yt_asmt.db'));
  const hp=db.exec("SELECT name FROM pragma_table_info('hospitals') WHERE name LIKE '%ed_at%'");
  console.log('hospitals.updated_at:', hp.length&&hp[0].values[0]?hp[0].values[0][0]:'MISSING');
  const pp=db.exec("SELECT name FROM pragma_table_info('pre_sales_projects') WHERE name='closed_at'");
  console.log('pre_sales_projects.closed_at:', pp.length&&pp[0].values[0]?pp[0].values[0][0]:'MISSING');
  db.close(); process.exit(0);
}).catch(e=>{console.error(e);process.exit(1);});
