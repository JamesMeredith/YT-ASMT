const http = require('http');
const req = (path, method, body, token) => new Promise((resolve) => {
  const h = {'Content-Type':'application/json'};
  if(token) h['Authorization'] = token;
  const r = http.request({hostname:'localhost',port:3000,path,method,headers:h}, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve({s:res.statusCode,b:d})); });
  if(body) r.write(JSON.stringify(body));
  r.end();
});
(async()=>{
  const login = await req('/api/auth/login','POST',{username:'admin01',password:'123456'});
  const tok = JSON.parse(login.b).token;
  const faults = await req('/api/faults?page=1&page_size=5','GET',null,tok);
  const d = JSON.parse(faults.b);
  console.log('Faults count:', d.total);
  console.log('Fault numbers:', (d.data||[]).map(f=>f.fault_no));
})().catch(e=>console.error(e));