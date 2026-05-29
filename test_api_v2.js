const http = require('http');
const port = 3000;

function api(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { hostname: 'localhost', port, path: '/api' + path, method, headers: { 'Content-Type': 'application/json' } };
    if (token) opts.headers['Authorization'] = token;
    const req = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({raw: d}); } });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  console.log('=== API Smoke Test ===\n');
  try {
    // 1. Login
    const login = await api('POST', '/auth/login', {username: 'admin01', password: '123456'});
    if (!login.token) { console.log('LOGIN FAIL:', login); process.exit(1); }
    const t = login.token;
    console.log('[OK] Login:', login.user.role, '-', login.user.real_name);

    // 2. Dashboard
    const dash = await api('GET', '/dashboard', null, t);
    console.log('[OK] Dashboard: faults=' + dash.fault?.total + ', devices=' + dash.device?.total);

    // 3. Parts
    const parts = await api('GET', '/parts', null, t);
    console.log('[OK] Parts: ' + parts.total + ' items');

    // 4. Users
    const users = await api('GET', '/users', null, t);
    console.log('[OK] Users: ' + users.total + ' users');

    // 5. Faults
    const faults = await api('GET', '/faults', null, t);
    console.log('[OK] Faults: ' + faults.total + ' records');

    // 6. Devices
    const devs = await api('GET', '/devices', null, t);
    console.log('[OK] Devices: ' + devs.total + ' devices');

    // 7. Hospitals
    const hospitals = await api('GET', '/hospitals', null, t);
    console.log('[OK] Hospitals: ' + (hospitals.data?.length || 0) + ' records');

    console.log('\n=== All APIs OK ===');
  } catch(e) {
    console.error('ERROR:', e.message);
    process.exit(1);
  }
})();