const { getDb } = require('E:/YT-ASMT/server/db.js');
getDb().then(db => {
  const cols = db.exec('PRAGMA table_info(devices)');
  console.log('devices columns:', JSON.stringify(cols[0].values.map(c => ({ name: c[1], type: c[2] }))));

  const dc = db.exec('SELECT * FROM devices LIMIT 1');
  if (dc[0]) console.log('devices row[0]:', JSON.stringify(dc[0].values[0]));

  const dc2 = db.exec('PRAGMA table_info(demands)');
  console.log('demands columns:', JSON.stringify(dc2[0].values.map(c => ({ name: c[1], type: c[2] }))));

  const dc3 = db.exec('SELECT * FROM demands LIMIT 1');
  if (dc3[0]) console.log('demands row[0]:', JSON.stringify(dc3[0].values[0]));
});