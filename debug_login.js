const http = require('http');
function api(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname:'localhost', port:3000, path, method,
      headers:{'Content-Type':'application/json','Authorization':token}};
    const req = http.request(opts, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{
        try{resolve({status:res.statusCode,body:JSON.parse(d||'{}')})}catch(e){resolve({status:res.statusCode,body:d})}
      });
    });
    req.on('error',reject);
    if(body) req.write(JSON.stringify(body));
    req.end();
  });
}
(async ()=>{
  let r = await api('POST','/api/auth/login',null,{username:'admin01',password:'123456'});
  console.log('RAW login body:', JSON.stringify(r.body).slice(0,200));
  process.exit(0);
})().catch(e=>{console.error(e.message);process.exit(1);});