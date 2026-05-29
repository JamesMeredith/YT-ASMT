const {getDb} = require('E:/YT-ASMT/server/db.js');
getDb().then(db => {
  const t = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pre_sales%'");
  console.log('tables:', JSON.stringify(t[0].values.map(v=>v[0])));

  // node defs
  const nd = db.exec("SELECT * FROM pre_sales_node_defs");
  console.log('node_defs:', JSON.stringify(nd[0].values[0]));

  // projects
  const pc = db.exec("PRAGMA table_info(pre_sales_projects)");
  console.log('project cols:', JSON.stringify(pc[0].values.map(v=>v[1])));
});