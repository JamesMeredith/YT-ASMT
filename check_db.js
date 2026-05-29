const fs = require("fs");
const initSqlJs = require("E:/YT-ASMT/server/node_modules/sql.js");
initSqlJs().then(SQL => {
  const db = new SQL.Database(fs.readFileSync("E:/YT-ASMT/data/yt_asmt.db"));
  const cols = db.exec("PRAGMA table_info(pre_sales_projects)");
  let out = "=== pre_sales_projects columns ===\n";
  cols[0].values.forEach(v => out += "  " + v[1] + " " + v[2] + " notnull=" + v[3] + "\n");
  const projects = db.exec("SELECT project_no, device_code, status FROM pre_sales_projects");
  out += "\n=== Projects ===\n";
  if (projects.length) projects[0].values.forEach(v => out += "  " + v[0] + " | " + v[1] + " | " + v[2] + "\n");
  const defs = db.exec("SELECT node_index, node_name FROM pre_sales_node_defs ORDER BY node_index");
  out += "\n=== Node defs ===\n";
  if (defs.length) defs[0].values.forEach(v => out += "  #" + v[0] + " " + v[1] + "\n");
  fs.writeFileSync("E:/YT-ASMT/db_check.txt", out);
  console.log("DONE");
  db.close();
  process.exit(0);
});
