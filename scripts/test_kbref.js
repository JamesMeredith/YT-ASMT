const http = require('http');
const req = (path, method, body, token) => new Promise((resolve, reject) => {
  const headers = {'Content-Type':'application/json'};
  if(token) headers['Authorization'] = token;
  const opts = { hostname:'localhost', port:3000, path, method, headers };
  const r = http.request(opts, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve({status:res.statusCode,body:d})); });
  r.on('error',reject);
  if(body) r.write(JSON.stringify(body));
  r.end();
});
(async()=>{
  try {
    // 1. 登录
    const login = await req('/api/auth/login','POST',{username:'admin01',password:'123456'});
    const j = JSON.parse(login.body);
    const token = j.token;
    console.log('[LOGIN]', login.status, j.user.real_name, 'token ok');

    // 2. 搜索知识库（不带 fault_no）
    const r1 = await req('/api/knowledge/search?q=%E6%89%93%E5%8D%B0','GET',null,token);
    const r1b = JSON.parse(r1.body);
    console.log('[SEARCH no fault_no] status:', r1.status, 'data:', r1b.data ? r1b.data.length+' results' : JSON.stringify(r1b).slice(0,100));

    // 3. 搜索 带 fault_no
    const r2 = await req('/api/knowledge/search?q=%E6%89%93%E5%8D%B0&fault_no=YT-FT-20260512-0001','GET',null,token);
    const r2b = JSON.parse(r2.body);
    console.log('[SEARCH with fault_no] status:', r2.status, 'data:', r2b.data ? r2b.data.length+' results' : JSON.stringify(r2b).slice(0,100));

    // 4. 引用
    if(r2b.data && r2b.data.length>0){
      const kb = r2b.data[0];
      console.log('[KB TOP]', kb.id, kb.title, 'ref_count:', kb.reference_count);
      const ref = await req('/api/knowledge/'+kb.id+'/reference','POST',{fault_no:'YT-FT-20260512-0001'},token);
      console.log('[REFERENCE] status:', ref.status, JSON.parse(ref.body));
    } else {
      console.log('[SKIP] no kb results to reference');
    }

    // 5. 查询引用历史
    const r3 = await req('/api/knowledge/references/YT-FT-20260512-0001','GET',null,token);
    const r3b = JSON.parse(r3.body);
    console.log('[REFS] status:', r3.status, r3b.data ? r3b.data.length+' references' : JSON.stringify(r3b).slice(0,100));
    if(r3b.data && r3b.data.length>0) console.log('  First:', r3b.data[0].title);

    console.log('\n=== DONE ===');
  } catch(e) { console.error('FAIL:', e.message); process.exit(1); }
})();