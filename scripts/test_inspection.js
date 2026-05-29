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
  // Login
  let r = await api('POST','/api/auth/login',null,{username:'engineer01',password:'123456'});
  const token = r.body.token;
  console.log('Login:', r.body.user.real_name);

  // 1. Create a new plan
  let plans = await api('GET','/api/inspections/plans',token);
  let planId;
  if (!plans.body.data || plans.body.data.length === 0) {
    r = await api('POST','/api/inspections/plans',token,{
      plan_name:'测试巡检计划', hospital_code:'H001', device_codes:[], cycle:'每周', start_date:'2026-05-28'
    });
    planId = r.body.plan_id;
    console.log('Plan created:', planId);
  } else {
    planId = plans.body.data[0].id;
    console.log('Existing plan:', plans.body.data[0].plan_name, 'cycle:', plans.body.data[0].cycle, 'next:', plans.body.data[0].next_inspection_date);
  }

  // 2. Get a device
  let dev = await api('GET','/api/devices?page_size=1',token);
  const dc = dev.body.data[0].device_code;
  console.log('Device:', dc);

  // 3. Submit inspection record
  r = await api('POST','/api/inspections/records',token,{
    plan_id:planId, device_code:dc, inspect_date:'2026-05-28',
    appearance_ok:1, wall_distance:10, ground_level:0.5,
    firmware_version:'v2.1.0', app_version:'1.8.0', run_hours:720, ip_address:'192.168.1.100',
    network_stable:1, packet_loss_rate:0,
    drug_inventory_ok:1, drug_low_stock_num:2, drug_expiring_num:1,
    screen_ok:1, scanner_ok:1, printer_ok:0, lock_ok:1,
    result:'异常待处理', note:'打印机故障需维修'
  });
  if (r.body.error) { console.log('Submit FAIL:', r.body.error); return; }
  console.log('Record ID:', r.body.record_id);

  // 4. Check next_inspection_date advanced
  plans = await api('GET','/api/inspections/plans',token);
  const plan = plans.body.data.find(p => p.id === planId);
  console.log('Next inspection AFTER:', plan.next_inspection_date, '(should be ~2026-06-04 for weekly cycle)');

  // 5. Check records list
  let recs = await api('GET','/api/inspections/records?plan_id='+planId, token);
  console.log('Records total:', recs.body.total);

  // 6. PATCH to mark exception handled
  r = await api('PATCH','/api/inspections/records/'+r.body.record_id, token, {result:'已处理', note:'已更换打印机色带'});
  console.log('PATCH result:', r.body.message);

  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});