const http = require('http');

function api(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost', port: 3000, path, method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) opts.headers['Authorization'] = token;
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  const login = await api('POST', '/api/auth/login', null, { username: 'admin01', password: '123456' });
  if (login.status !== 200) { console.log('Login FAILED:', login.body); return; }
  console.log('Login OK:', login.body.user.role);
  const token = login.body.token;

  const tests = ['/api/dashboard','/api/users','/api/parts','/api/parts/stats','/api/devices','/api/hospitals','/api/auth/me'];
  for (const path of tests) {
    const r = await api('GET', path, token);
    const name = path.replace('/api/', '');
    if (r.status === 200) {
      const info = r.body.total !== undefined ? `total=${r.body.total}` : 
                   r.body.user ? `user=${r.body.user.username}` : 
                   r.body.message || 'OK';
      console.log(`OK  ${name}: ${info}`);
    } else {
      console.log(`FAIL ${name}: ${r.status} - ${r.body.error || JSON.stringify(r.body)}`);
    }
  }
})();