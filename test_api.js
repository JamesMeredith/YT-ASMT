// Full API test using axios-like request with cookie jar
const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE = 'http://localhost:3000';
let cookie = '';

function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = new URL(BASE + path);
    const h = { ...headers };
    if (cookie) h['Cookie'] = cookie;
    if (body) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(body); }
    const req = http.request({ hostname: opts.hostname, port: opts.port, path: opts.pathname + opts.search, method, headers: h }, res => {
      const setCookie = res.headers['set-cookie'];
      if (setCookie) cookie = setCookie.map(c => c.split(';')[0]).join('; ');
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch { resolve({ status: res.statusCode, body: data }); } });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  // Login
  let r = await req('POST', '/api/auth/login', JSON.stringify({ username: 'admin01', password: '123456' }));
  console.log('1. Login:', r.status, JSON.stringify(r.body).substring(0, 80));

  // Dashboard
  r = await req('GET', '/api/dashboard');
  console.log('2. Dashboard:', r.status, JSON.stringify(r.body).substring(0, 120));

  // Device models
  r = await req('GET', '/api/device-models');
  console.log('3. Device models:', r.status, 'total=' + (r.body.total || r.body.error));

  // Dicts
  r = await req('GET', '/api/dicts');
  console.log('4. Dicts:', r.status, 'provinces=' + (r.body.provinces ? r.body.provinces.length : r.body.error));

  // Fault orders
  r = await req('GET', '/api/fault-orders');
  console.log('5. Fault orders:', r.status, 'total=' + (r.body.total || r.body.error));

  // Devices
  r = await req('GET', '/api/devices');
  console.log('6. Devices:', r.status, 'total=' + (r.body.total || r.body.error));

  // Demands
  r = await req('GET', '/api/demands');
  console.log('7. Demands:', r.status, 'total=' + (r.body.total || r.body.error));

  // Knowledge
  r = await req('GET', '/api/knowledge');
  console.log('8. Knowledge:', r.status, 'total=' + (r.body.total || r.body.error));

  // Pre-sales node defs
  r = await req('GET', '/api/pre-sales/node-defs');
  console.log('9. Node defs:', r.status, 'count=' + (r.body.data ? r.body.data.length : r.body.error));

  console.log('\n=== DONE ===');
}

main().catch(e => console.error('ERROR:', e.message));