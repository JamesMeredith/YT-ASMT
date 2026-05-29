const { getDbSync } = require('./db');
const db = getDbSync();
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('Tables:', tables.map(x => x.name).join(', '));
const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='knowledge_base'").get();
console.log('KB schema:', schema ? schema.sql : 'NOT FOUND');
const rows = db.prepare('SELECT id, title, reference_count, view_count FROM knowledge_base LIMIT 10').all();
console.log('KB rows:', JSON.stringify(rows, null, 2));