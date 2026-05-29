const fs = require('fs');
const file = 'E:/YT-ASMT/web/index.html';
let html = fs.readFileSync(file, 'utf8');

// Find start/end markers
const startMarker = `    async function renderInspectionList(container) {`;
const endMarker = `    // ========== 维保台账 ==========`;

const startIdx = html.indexOf(startMarker);
const endIdx = html.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1) {
  console.error('Markers not found');
  process.exit(1);
}

const replacement = `    // HQ helper
    function isHQ() { return API.user && API.user.role === 'headquarters'; }

    async function renderInspectionList(container) {
      container.innerHTML = \`
        <div class="card">
          <div class="card-title">🔍 巡检管理</div>
          <div style="margin-bottom:16px;">
            <button class="btn btn-success" onclick="openCreateInspectionPlanModal()">➕ 新建巡检计划</button>
          </div>
          <div id="inspectionPlanWrap"></div>
        </div>
        <div class="card" style="margin-top:16px;">
          <div class="card-title">📋 巡检记录</div>
          <div id="inspectionRecordWrap"></div>
        </div>
      \`;
      loadInspectionPlans();
      loadInspectionRecords();
    }

    async function loadInspectionPlans() {
      try {
        const r = await API.inspections.plans();
        const wrap = document.getElementById('inspectionPlanWrap');
        if (!r.data || r.data.length === 0) {
          wrap.innerHTML = '<div class="empty-state"><p>暂无巡检计划，请点击上方按钮创建</p></div>';
          return;
        }
        const hq = isHQ();
        wrap.innerHTML = \`
          <table class="data-table">
            <thead><tr>
              <th>计划名称</th><th>医院</th>\${hq ? '<th>负责人</th>' : ''}<th>周期</th><th>下次巡检</th><th>状态</th><th>记录数</th><th>操作</th></tr></thead>
            <tbody>
              \${\r.data.map(p => {
                const safeName = (p.plan_name||'').replace(/'/g, "\\\\\\\\'").replace(/"/g, '&quot;');
                return \\\`
                <tr>
                  <td>\\\${p.plan_name}</td>
                  <td>\\\${p.hospital_name||'-'}</td>
                  \\\${hq ? '<td>' + (p.engineer_name||'-') + '</td>' : ''}
                  <td>\\\${p.cycle}</td>
                  <td>\\\${p.next_inspection_date||'-'}</td>
                  <td>\\\${getStatusTag(p.status)}</td>
                  <td>\\\${p.record_count||0}</td>
                  <td>
                    <button class="btn btn-sm btn-primary" onclick="openInspectionRecordModal(\\\${p.id},'\\\${safeName}')">🔍 执行巡检</button>
                    \\\${hq
                      ? (p.status === '进行中' ? '<button class="btn btn-sm btn-outline" onclick="togglePlanStatus(' + p.id + ',\\\\'暂停\\\\')">⏸ 暂停</button> ' : '')
                        + (p.status === '已暂停' ? '<button class="btn btn-sm btn-outline" onclick="togglePlanStatus(' + p.id + ',\\\\'进行中\\\\')">▶ 恢复</button> ' : '')
                        + (p.status !== '已结束' ? '<button class="btn btn-sm btn-danger" onclick="togglePlanStatus(' + p.id + ',\\\\'已结束\\\\')">⏹ 结束</button>' : '')
                      : ''}
                  </td>
                </tr>
              \\\`}).join('')}
            </tbody>
          </table>
        \`;
      } catch(e) {
        document.getElementById('inspectionPlanWrap').innerHTML = \\\`<p style="color:var(--danger)">加载失败</p>\\\`;
      }
    }

    async function togglePlanStatus(planId, newStatus) {
      const labels = { '暂停': '暂停此计划？', '进行中': '恢复此计划？', '已结束': '结束此计划？（不可逆）' };
      if (!confirm(labels[newStatus] || '确认操作？')) return;
      try {
        await API.inspections.updatePlan(planId, { status: newStatus });
        showToast('计划状态已更新', 'success');
        loadInspectionPlans();
      } catch(e) { showToast(e.message, 'error'); }
    }

    async function openInspectionRecordModal(planId, planName) {
      let devices = [];
      try { const rd = await API.devices.list({ page:1, page_size:100 }); devices = rd.data || []; } catch(e) {}
      const today = new Date().toISOString().slice(0, 10);
      Modal.show(\`
        <div style="max-height:70vh;overflow-y:auto;padding:8px;">
          <h4 style="margin:0 0 16px 0;">🔍 巡检检查单 - \${planName.replace(/&quot;/g,'"')}</h4>
          <input type="hidden" id="irPlanId" value="\${planId}">
          <input type="hidden" id="irInspectDate" value="\${today}">
          
          <div class="form-group">
            <label>设备编码 <span class="required">*</span></label>
            <select class="form-control" id="irDeviceCode">
              <option value="">-- 选择设备 --</option>
              \${\devices.map(d => '<option value="' + d.device_code + '">' + d.device_code + ' | ' + (d.hospital_name||'') + '</option>').join('')}
            </select>
          </div>
          
          <fieldset style="border:1px solid var(--border);padding:12px;margin-bottom:12px;">
            <legend style="font-size:14px;font-weight:bold;width:auto;">📦 外观与安装</legend>
            <div class="form-group"><label>设备外观正常</label><input type="checkbox" id="irAppearanceOk" checked></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <div class="form-group"><label>离墙距离(cm)</label><input type="number" class="form-control" id="irWallDistance" placeholder="如：10"></div>
              <div class="form-group"><label>地面水平度(°)</label><input type="number" step="0.1" class="form-control" id="irGroundLevel" placeholder="如：0.5"></div>
            </div>
          </fieldset>
          
          <fieldset style="border:1px solid var(--border);padding:12px;margin-bottom:12px;">
            <legend style="font-size:14px;font-weight:bold;width:auto;">💻 系统与网络</legend>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <div class="form-group"><label>Firmware版本</label><input type="text" class="form-control" id="irFirmware" placeholder="如：v2.1.0"></div>
              <div class="form-group"><label>APP版本</label><input type="text" class="form-control" id="irAppVersion" placeholder="如：1.8.2"></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <div class="form-group"><label>运行时长(h)</label><input type="number" class="form-control" id="irRunHours" placeholder="如：720"></div>
              <div class="form-group"><label>IP地址</label><input type="text" class="form-control" id="irIpAddress" placeholder="如：192.168.1.100"></div>
            </div>
            <div class="form-group"><label>网络稳定</label><input type="checkbox" id="irNetworkStable" checked></div>
            <div class="form-group"><label>Ping丢包率(%)</label><input type="number" step="0.01" class="form-control" id="irPacketLoss" placeholder="如：0"></div>
          </fieldset>
          
          <fieldset style="border:1px solid var(--border);padding:12px;margin-bottom:12px;">
            <legend style="font-size:14px;font-weight:bold;width:auto;">💊 药品管理</legend>
            <div class="form-group"><label>库存盘点正常</label><input type="checkbox" id="irDrugInventoryOk" checked></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <div class="form-group"><label>低库存药品数</label><input type="number" class="form-control" id="irLowStockNum" value="0"></div>
              <div class="form-group"><label>临期药品数</label><input type="number" class="form-control" id="irExpiringNum" value="0"></div>
            </div>
          </fieldset>
          
          <fieldset style="border:1px solid var(--border);padding:12px;margin-bottom:12px;">
            <legend style="font-size:14px;font-weight:bold;width:auto;">🖨️ 硬件状态</legend>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;">
              <div><label>触摸屏</label><input type="checkbox" id="irScreenOk" checked></div>
              <div><label>扫码枪</label><input type="checkbox" id="irScannerOk" checked></div>
              <div><label>打印机</label><input type="checkbox" id="irPrinterOk" checked></div>
              <div><label>锁具</label><input type="checkbox" id="irLockOk" checked></div>
            </div>
          </fieldset>
          
          <div class="form-group">
            <label>巡检结果 <span class="required">*</span></label>
            <select class="form-control" id="irResult">
              <option value="正常">✓ 正常</option>
              <option value="异常待处理">⚠️ 异常待处理</option>
            </select>
          </div>
          <div class="form-group">
            <label>备注</label>
            <textarea class="form-control" id="irNote" rows="3" placeholder="记录异常情况、建议等..."></textarea>
          </div>
        </div>
      \`, '执行巡检', { footer: '<div class="modal-footer"><button class="btn btn-outline" onclick="Modal.hide()">取消</button><button class="btn btn-primary" onclick="doSubmitInspectionRecord()">提交巡检记录</button></div>' });
    }

    async function doSubmitInspectionRecord() {
      const plan_id = document.getElementById('irPlanId')?.value;
      const device_code = document.getElementById('irDeviceCode')?.value;
      const inspect_date = document.getElementById('irInspectDate')?.value;
      if (!device_code) return showToast('请选择设备编码', 'error');
      try {
        await API.inspections.submitRecord({
          plan_id: parseInt(plan_id),
          device_code,
          inspect_date,
          appearance_ok: document.getElementById('irAppearanceOk')?.checked || false,
          wall_distance: document.getElementById('irWallDistance')?.value || null,
          ground_level: document.getElementById('irGroundLevel')?.value || null,
          firmware_version: document.getElementById('irFirmware')?.value || '',
          app_version: document.getElementById('irAppVersion')?.value || '',
          run_hours: parseInt(document.getElementById('irRunHours')?.value) || 0,
          ip_address: document.getElementById('irIpAddress')?.value || '',
          network_stable: document.getElementById('irNetworkStable')?.checked || false,
          packet_loss_rate: document.getElementById('irPacketLoss')?.value || null,
          drug_inventory_ok: document.getElementById('irDrugInventoryOk')?.checked || false,
          drug_low_stock_num: parseInt(document.getElementById('irLowStockNum')?.value) || 0,
          drug_expiring_num: parseInt(document.getElementById('irExpiringNum')?.value) || 0,
          screen_ok: document.getElementById('irScreenOk')?.checked || false,
          scanner_ok: document.getElementById('irScannerOk')?.checked || false,
          printer_ok: document.getElementById('irPrinterOk')?.checked || false,
          lock_ok: document.getElementById('irLockOk')?.checked || false,
          result: document.getElementById('irResult')?.value || '正常',
          note: document.getElementById('irNote')?.value || ''
        });
        Modal.hide();
        showToast('巡检记录已提交', 'success');
        renderInspectionList(document.getElementById('pageContent'));
      } catch(e) { showToast(e.message, 'error'); }
    }

    async function loadInspectionRecords() {
      try {
        const r = await API.inspections.records({ page_size: 20 });
        const wrap = document.getElementById('inspectionRecordWrap');
        if (!r.data || r.data.length === 0) {
          wrap.innerHTML = '<div class="empty-state"><p>暂无巡检记录</p></div>';
          return;
        }
        wrap.innerHTML = \`
          <table class="data-table">
            <thead><tr><th>日期</th><th>计划</th><th>设备</th><th>医院</th><th>结果</th><th>操作</th></tr></thead>
            <tbody>
              \${\r.data.map(rec => {
                let resultHtml = rec.result === '正常' ? '✓ 正常' : (rec.result === '已处理' ? '✔ 已处理' : '⚠️ 异常待处理');
                let actionHtml = rec.result === '异常待处理' 
                  ? '<button class="btn btn-sm btn-warning" onclick="handleInspectionException(' + rec.id + ')">处理异常</button>'
                  : '-';
                return \\\`
                <tr>
                  <td>\\\${rec.inspect_date}</td>
                  <td>\\\${rec.plan_name || '-'}</td>
                  <td>\\\${rec.device_code}</td>
                  <td>\\\${rec.hospital_name || '-'}</td>
                  <td>\\\${resultHtml}</td>
                  <td>\\\${actionHtml}</td>
                </tr>\\\`;
              }).join('')}
            </tbody>
          </table>
        \`;
      } catch(e) {
        document.getElementById('inspectionRecordWrap').innerHTML = '<p style="color:var(--danger)">加载失败</p>';
      }
    }

    async function handleInspectionException(recordId) {
      Modal.show(\`
        <div class="form-group">
          <p style="margin-bottom:12px;">将巡检记录标记为已处理</p>
          <label>处理结果</label>
          <select class="form-control" id="handleResult">
            <option value="已处理">✓ 已处理</option>
          </select>
        </div>
        <div class="form-group">
          <label>处理说明</label>
          <textarea class="form-control" id="handleNote" rows="3" placeholder="说明如何处理的..."></textarea>
        </div>
      \`, '处理异常', { footer: '<div class="modal-footer"><button class="btn btn-outline" onclick="Modal.hide()">取消</button><button class="btn btn-warning" onclick="doHandleInspectionException(' + recordId + ')">确认处理</button></div>' });
    }

    async function doHandleInspectionException(recordId) {
      const result = document.getElementById('handleResult')?.value;
      const note = document.getElementById('handleNote')?.value;
      try {
        await API.inspections.updateRecord(recordId, { result, note });
        Modal.hide();
        showToast('异常已标记为已处理', 'success');
        loadInspectionRecords();
      } catch(e) { showToast(e.message, 'error'); }
    }

    async function openCreateInspectionPlanModal() {
      let hospitals = [];
      let devices = [];
      let engineers = [];
      try {
        const rh = await API.hospitals.list(); hospitals = rh.data || [];
      } catch(e) {}
      try {
        const rd = await API.devices.list({ page:1, page_size:100 }); devices = rd.data || [];
      } catch(e) {}
      if (isHQ()) {
        try {
          const ru = await API.get('/api/users?role=engineer&page_size=50');
          engineers = ru.data || [];
        } catch(e) {}
      }
      Modal.show(\`
        \${isHQ() 
          ? '<div class="form-group"><label>负责工程师 <span class="required">*</span></label><select class="form-control" id="planEngineer"><option value="">-- 选择工程师 --</option>' 
            + engineers.map(e => '<option value="' + e.id + '">' + (e.real_name || e.username) + '（' + (e.city||'') + '）</option>').join('') 
            + '</select></div>' 
          : ''}
        <div class="form-group">
          <label>计划名称 <span class="required">*</span></label>
          <input type="text" class="form-control" id="planName" placeholder="如：2025年5月广州市第一人民医院巡检">
        </div>
        <div class="form-group">
          <label>医院 <span class="required">*</span></label>
          <select class="form-control" id="planHospital">
            <option value="">-- 选择医院 --</option>
            \${\hospitals.map(h => \\\`<option value="\\\${h.hospital_code}">\\\${h.hospital_name}</option>\\\`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>巡检周期 <span class="required">*</span></label>
          <select class="form-control" id="planCycle">
            <option value="每周">每周</option>
            <option value="每两周">每两周</option>
            <option value="每月">每月</option>
          </select>
        </div>
        <div class="form-group">
          <label>开始日期 <span class="required">*</span></label>
          <input type="date" class="form-control" id="planStartDate">
        </div>
      \`, '新建巡检计划', { footer: '<div class="modal-footer"><button class="btn btn-outline" onclick="Modal.hide()">取消</button><button class="btn btn-primary" onclick="doCreateInspectionPlan()">创建计划</button></div>' });
    }

    async function doCreateInspectionPlan() {
      const plan_name = document.getElementById('planName')?.value.trim();
      const hospital_code = document.getElementById('planHospital')?.value;
      const cycle = document.getElementById('planCycle')?.value;
      const start_date = document.getElementById('planStartDate')?.value;
      const engineerEl = document.getElementById('planEngineer');
      if (!plan_name || !hospital_code || !cycle || !start_date) return showToast('请填写所有必填项', 'error');
      if (isHQ() && !engineerEl?.value) return showToast('请选择负责工程师', 'error');
      try {
        const data = { plan_name, hospital_code, device_codes:[], cycle, start_date };
        if (engineerEl?.value) data.engineer_id = parseInt(engineerEl.value);
        await API.inspections.createPlan(data);
        Modal.hide();
        showToast('巡检计划已创建', 'success');
        renderInspectionList(document.getElementById('pageContent'));
      } catch(e) { showToast(e.message, 'error'); }
    }

`;

// Make sure there's proper whitespace before the end marker
const before = html.substring(0, startIdx);
const after = html.substring(endIdx);

// Keep exactly the same indentation
html = before + replacement + '\n' + after;

fs.writeFileSync(file, html, 'utf8');
console.log('OK - inspection block replaced');
