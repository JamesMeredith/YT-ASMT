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
  // Login as HQ
  const login = await api('POST', '/api/auth/login', null, { username: 'admin01', password: '123456' });
  if (login.status !== 200) { console.log('Login FAILED:', login.body); return; }
  console.log('Login OK:', login.body.user.role);
  const token = login.body.token;
  const userId = login.body.user.id;

  // Test 1: Dicts with provinces
  const dicts = await api('GET', '/api/dicts', token);
  console.log('Test 1 - Dicts: provinces=' + dicts.body.provinces?.length + ', cities=' + dicts.body.cities?.length);

  // Test 2: Parts list
  const parts = await api('GET', '/api/parts?page=1&page_size=20', token);
  console.log('Test 2 - Parts: total=' + parts.body.total);

  // Test 3: Create part
  const newPart = await api('POST', '/api/parts', token, {
    part_code: 'P-TEST-001', part_name: '测试配件', part_model: 'TEST-001',
    part_category: '硬件', specification: '测试规格', manufacturer: '测试厂商',
    unit: '个', reference_price: 99.00, description: '这是一个测试配件'
  });
  console.log('Test 3 - Create part:', newPart.status, newPart.body.id || newPart.body.error);

  // Test 4: Edit part
  if (newPart.body.id) {
    const edit = await api('PATCH', '/api/parts/' + newPart.body.id, token, {
      description: '测试配件（已修改）'
    });
    console.log('Test 4 - Edit part:', edit.status, edit.body.message || edit.body.error);
  }

  // Test 5: Users list
  const users = await api('GET', '/api/users?page=1&page_size=20', token);
  console.log('Test 5 - Users: total=' + users.body.total);

  // Test 6: Create user
  const newUser = await api('POST', '/api/users', token, {
    username: 'test_user_' + Date.now(),
    real_name: '测试用户',
    role: 'engineer',
    phone: '13800138000',
    province: '广东省',
    city: '广州市'
  });
  console.log('Test 6 - Create user:', newUser.status, newUser.body.id || newUser.body.error);

  // Test 7: Faults with province filter
  const faults = await api('GET', '/api/faults?' + new URLSearchParams({province:'广东省',page:'1',page_size:'5'}).toString(), token);
  console.log('Test 7 - Faults (广东省): total=' + faults.body.total + ', data_count=' + (faults.body.data?.length || 0));

  // Test 8: Devices with province filter
  const devices = await api('GET', '/api/devices?' + new URLSearchParams({province:'广东省',page:'1',page_size:'5'}).toString(), token);
  console.log('Test 8 - Devices (广东省): total=' + devices.body.total + ', data_count=' + (devices.body.data?.length || 0));

  // Test 9: Delete test part (if it was created)
  if (newPart.body.id) {
    try {
      const del = await api('DELETE', '/api/parts/' + newPart.body.id, token);
      console.log('Test 9 - Delete part:', del.status, del.body.message || del.body.error);
    } catch(e) { console.log('Test 9 - Delete part: ERROR'); }
  }

  // Test 10: Auth me
  const me = await api('GET', '/api/auth/me', token);
  console.log('Test 10 - Auth me:', me.body.user?.username, me.body.user?.role);

  console.log('\n=== All tests completed ===');
})();