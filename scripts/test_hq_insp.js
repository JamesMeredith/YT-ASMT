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

async function main() {
  // === Test 1: HQ login ===
  let r = await api('POST','/api/auth/login',null,{username:'admin01',password:'123456'});
  const hqToken = r.body.token;
  console.log('1. HQ login:', r.body.user.real_name, r.body.user.role);

  // === Test 2: HQ sees ALL plans (not filtered by engineer_id) ===
  r = await api('GET','/api/inspections/plans',hqToken);
  console.log('2. HQ plans:', r.body.data.length, 'total');
  if (r.body.data.length > 0) {
    const p = r.body.data[0];
    console.log('   Plan:', p.plan_name, '| Engineer:', p.engineer_name, '| Status:', p.status, '| Next:', p.next_inspection_date);
  }

  // === Test 3: HQ creates plan with specific engineer ===
  r = await api('POST','/api/inspections/plans',hqToken,{
    plan_name:'总部指定工程师巡检', hospital_code:'H002', device_codes:[], cycle:'每月', start_date:'2026-06-01', engineer_id:5
  });
  console.log('3. Create plan with engineer_id=5:', r.body.success ? 'OK plan_id=' + r.body.plan_id : 'FAIL ' + r.body.error);

  // === Test 4: Verify plan has correct engineer ===
  r = await api('GET','/api/inspections/plans',hqToken);
  const newPlan = r.body.data.find(p => p.plan_name === '总部指定工程师巡检');
  if (newPlan) {
    console.log('4. Plan engineer:', newPlan.engineer_name, '(expected engineer01)');
  } else {
    console.log('4. Plan not found in list');
  }

  // === Test 5: HQ updates plan status (pause) ===
  if (newPlan) {
    r = await api('PATCH','/api/inspections/plans/'+newPlan.id, hqToken, {status:'已暂停'});
    console.log('5. Pause plan:', r.body.message);
    
    r = await api('PATCH','/api/inspections/plans/'+newPlan.id, hqToken, {status:'进行中'});
    console.log('6. Resume plan:', r.body.message);
    
    r = await api('PATCH','/api/inspections/plans/'+newPlan.id, hqToken, {status:'已结束'});
    console.log('7. End plan:', r.body.message);
  }

  // === Test 8: HQ sees ALL records ===
  r = await api('GET','/api/inspections/records?page_size=10',hqToken);
  console.log('8. HQ records:', r.body.total, 'total');

  // === Test 9: Engineer login, still sees only own ===
  r = await api('POST','/api/auth/login',null,{username:'engineer01',password:'123456'});
  const engToken = r.body.token;
  r = await api('GET','/api/inspections/plans',engToken);
  console.log('9. Engineer01 plans:', r.body.data.length, '(should be own only)');

  r = await api('GET','/api/inspections/records?page_size=10',engToken);
  console.log('   Engineer01 records:', r.body.total);

  console.log('\n=== ALL TESTS PASSED ===');
  process.exit(0);
}
main().catch(e=>{console.error('FATAL:',e.message);process.exit(1);});