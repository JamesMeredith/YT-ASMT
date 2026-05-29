const fs = require('fs');

// === app.js: add updatePlan API ===
let appjs = fs.readFileSync('E:/YT-ASMT/web/js/app.js', 'utf8');
const oldApp = `    createPlan(data) { return API.post('/api/inspections/plans', data); },`;
const newApp = `    createPlan(data) { return API.post('/api/inspections/plans', data); },
    updatePlan(id, data) { return API.patch('/api/inspections/plans/' + id, data); },`;
if (!appjs.includes(oldApp)) { console.error('app.js pattern not found'); } else {
  appjs = appjs.replace(oldApp, newApp);
  fs.writeFileSync('E:/YT-ASMT/web/js/app.js', appjs, 'utf8');
  console.log('app.js OK');
}

// === index.html: update renderInspectionList for HQ management ===
let html = fs.readFileSync('E:/YT-ASMT/web/index.html', 'utf8');

// 1. Update loadInspectionPlans to show manage buttons for HQ
const oldLoad = `    async function loadInspectionPlans() {`;
const newPlansPrefix = `    function isHQ() { return API.user && API.user.role === 'headquarters'; }

    async function loadInspectionPlans() {`;
if (!html.includes(oldLoad)) { console.error('loadInspectionPlans not found'); } else {
  html = html.replace(oldLoad, newPlansPrefix);
  console.log('1. isHQ helper OK');
}

// 2. Replace the action button cell with HQ management buttons
// The actual text has ":" escaping in template literal
const oldButton = '<button class="btn btn-sm btn-primary" onclick="openInspectionRecordModal(${p.id},';

// 3. Update openCreateInspectionPlanModal - add engineer selector for HQ
const oldModal = `      Modal.show(\`
        <div class="form-group">
          <label>计划名称 <span class="required">*</span></label>`;
const newModal = `      Modal.show(\`
        \${isHQ() ? '<div class="form-group"><label>负责工程师</label><select class="form-control" id="planEngineer"><option value="">-- 默认当前用户 --</option>' + engineers.map(e => '<option value="' + e.id + '">' + (e.real_name || e.username) + '</option>').join('') + '</select></div>' : ''}
        <div class="form-group">
          <label>计划名称 <span class="required">*</span></label>`;
if (!html.includes(oldModal)) { console.error('create plan modal not found'); } else {
  html = html.replace(oldModal, newModal);
  console.log('3. Engineer selector OK');
}

// Fix: add engineers loading in openCreateInspectionPlanModal
const oldEngLoad = `      try {
        const rh = await API.hospitals.list(); hospitals = rh.data || [];
      } catch(e) {}
      try {`;
const newEngLoad = `      try {
        const rh = await API.hospitals.list(); hospitals = rh.data || [];
      } catch(e) {}
      try {
        const ru = await API.get('/api/users?role=engineer&page_size=50');
        engineers = ru.data || [];
      } catch(e) {}
      try {`;
if (!html.includes(oldEngLoad)) { console.error('engineer load not found'); } else {
  html = html.replace(oldEngLoad, newEngLoad);
  console.log('4. Engineers load OK');
}

// 4. Update doCreateInspectionPlan to send engineer_id for HQ
const oldCreate = `      const plan_name = document.getElementById('planName')?.value.trim();
      const hospital_code = document.getElementById('planHospital')?.value;
      const cycle = document.getElementById('planCycle')?.value;
      const start_date = document.getElementById('planStartDate')?.value;
      if (!plan_name || !hospital_code || !cycle || !start_date) return showToast('请填写所有必填项', 'error');
      try {
        await API.inspections.createPlan({ plan_name, hospital_code, device_codes:[], cycle, start_date });`;

const newCreate = `      const plan_name = document.getElementById('planName')?.value.trim();
      const hospital_code = document.getElementById('planHospital')?.value;
      const cycle = document.getElementById('planCycle')?.value;
      const start_date = document.getElementById('planStartDate')?.value;
      const engineer_id = document.getElementById('planEngineer')?.value;
      if (!plan_name || !hospital_code || !cycle || !start_date) return showToast('请填写所有必填项', 'error');
      try {
        const data = { plan_name, hospital_code, device_codes:[], cycle, start_date };
        if (engineer_id) data.engineer_id = parseInt(engineer_id);
        await API.inspections.createPlan(data);`;
if (!html.includes(oldCreate)) { console.error('doCreateInspectionPlan not found'); } else {
  html = html.replace(oldCreate, newCreate);
  console.log('5. Create plan with engineer OK');
}

// 5. Fix: add variables declaration in openCreateInspectionPlanModal
const oldVars = `    async function openCreateInspectionPlanModal() {
      let hospitals = [];
      let devices = [];`;

const newVars = `    async function openCreateInspectionPlanModal() {
      let hospitals = [];
      let devices = [];
      let engineers = [];`;
if (!html.includes(oldVars)) { console.error('vars not found'); } else {
  html = html.replace(oldVars, newVars);
  console.log('6. Engineers var OK');
}

fs.writeFileSync('E:/YT-ASMT/web/index.html', html, 'utf8');
console.log('index.html written');
