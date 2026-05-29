/**
 * 配件管理 + 用户管理 页面模块
 * 麻精药品智能柜售后运维工具 v2.0
 * 配件管理：总部可增删改，所有角色可查看，无库存管理
 */
'use strict';

// ========== 配件管理 ==========
async function renderPartsList(container, params) {
  var isHQ = API.user && API.user.role === 'headquarters';
  container.innerHTML = `
    <div class="card">
      <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;">
        <span>⚙️ 配件管理</span>
        ${isHQ ? '<button class="btn btn-success btn-sm" onclick="openCreatePartModal()">➕ 新增配件</button>' : ''}
      </div>
      <div class="filter-bar">
        <div class="search-input">
          <input type="text" class="form-control" id="partsSearch" placeholder="搜索配件名称、型号、编码...">
        </div>
        <select class="form-control" id="partsCategoryFilter" onchange="reloadPartsList()">
          <option value="">全部分类</option>
          <option value="硬件">硬件</option>
          <option value="耗材">耗材</option>
          <option value="软件">软件</option>
          <option value="结构件">结构件</option>
        </select>
        <button class="btn btn-primary" onclick="reloadPartsList()">搜索</button>
      </div>
      <div id="partsTableWrap"></div>
      <div class="pagination" id="partsPagination"></div>
    </div>
  `;
  reloadPartsList(1);
}

async function reloadPartsList(page) {
  page = page || 1;
  var keyword = (document.getElementById('partsSearch')?.value || '').trim();
  var category = document.getElementById('partsCategoryFilter')?.value || '';
  var isHQ = API.user && API.user.role === 'headquarters';
  try {
    var params = { page: page, page_size: 20 };
    if (keyword) params.keyword = keyword;
    if (category) params.part_category = category;
    var r = await API.parts.list(params);
    var wrap = document.getElementById('partsTableWrap');
    if (!wrap) return;
    if (!r.data || r.data.length === 0) {
      wrap.innerHTML = '<div class="empty-state"><p>暂无配件数据</p></div>';
      return;
    }
    var html = '<table class="data-table"><thead><tr>' +
      '<th>编码</th><th>名称</th><th>型号</th><th>分类</th><th>规格</th><th>厂商</th><th>单位</th><th>参考价</th>' +
      (isHQ ? '<th>操作</th>' : '') +
      '</tr></thead><tbody>';
    r.data.forEach(function(p) {
      html += '<tr>';
      html += '<td>' + (p.part_code || '-') + '</td>';
      html += '<td><strong>' + (p.part_name || '-') + '</strong></td>';
      html += '<td>' + (p.part_model || '-') + '</td>';
      html += '<td>' + (p.part_category || '-') + '</td>';
      html += '<td>' + (p.specification || '-') + '</td>';
      html += '<td>' + (p.manufacturer || '-') + '</td>';
      html += '<td>' + (p.unit || '-') + '</td>';
      html += '<td>' + (p.reference_price ? '¥' + Number(p.reference_price).toFixed(2) : '-') + '</td>';
      if (isHQ) {
        html += '<td>' +
          '<button class="btn btn-sm btn-outline" onclick="openEditPartModal(' + p.id + ')">编辑</button> ' +
          '<button class="btn btn-sm btn-danger" onclick="doDeletePart(' + p.id + ',\'' + API.escapeHtml(p.part_name) + '\')">删除</button>' +
          '</td>';
      }
      html += '</tr>';
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
    renderPagination('partsPagination', r.total, r.page, r.page_size, reloadPartsList);
  } catch(e) {
    var wrap2 = document.getElementById('partsTableWrap');
    if (wrap2) wrap2.innerHTML = '<p style="color:var(--danger)">加载失败: ' + (e.message || '') + '</p>';
  }
}

function openCreatePartModal() {
  Modal.show(
    '<div class="form-group"><label>配件编码 <span class="required">*</span></label>' +
    '<input type="text" class="form-control" id="partCode" placeholder="如：P011"></div>' +
    '<div class="form-group"><label>配件名称 <span class="required">*</span></label>' +
    '<input type="text" class="form-control" id="partName" placeholder="如：显示屏模块"></div>' +
    '<div class="form-group"><label>型号</label>' +
    '<input type="text" class="form-control" id="partModel" placeholder="如：YT-LCD-001"></div>' +
    '<div class="form-group"><label>分类</label>' +
    '<select class="form-control" id="partCategory"><option value="硬件">硬件</option><option value="耗材">耗材</option><option value="软件">软件</option><option value="结构件">结构件</option></select></div>' +
    '<div class="form-group"><label>规格参数</label>' +
    '<input type="text" class="form-control" id="partSpec" placeholder="如：10.1寸 TFT LCD"></div>' +
    '<div class="form-group"><label>生产厂商</label>' +
    '<input type="text" class="form-control" id="partMfr" placeholder="如：华星光电"></div>' +
    '<div class="form-group"><label>单位</label>' +
    '<select class="form-control" id="partUnit"><option>个</option><option>套</option><option>件</option><option>片</option><option>卷</option></select></div>' +
    '<div class="form-group"><label>参考价格（元）</label>' +
    '<input type="number" class="form-control" id="partPrice" placeholder="0.00" step="0.01" min="0"></div>' +
    '<div class="form-group"><label>适用设备型号</label>' +
    '<input type="text" class="form-control" id="partDevices" placeholder="如：YT-100,YT-200"></div>' +
    '<div class="form-group"><label>说明</label>' +
    '<textarea class="form-control" id="partDesc" placeholder="配件用途说明..." rows="2"></textarea></div>',
    '新增配件',
    { footer: '<div class="modal-footer"><button class="btn btn-outline" onclick="Modal.hide()">取消</button><button class="btn btn-primary" onclick="doCreatePart()">提交</button></div>' }
  );
}

async function doCreatePart() {
  var part_code = (document.getElementById('partCode')?.value || '').trim();
  var part_name = (document.getElementById('partName')?.value || '').trim();
  var part_model = (document.getElementById('partModel')?.value || '').trim();
  var part_category = (document.getElementById('partCategory')?.value || '').trim();
  var specification = (document.getElementById('partSpec')?.value || '').trim();
  var manufacturer = (document.getElementById('partMfr')?.value || '').trim();
  var unit = (document.getElementById('partUnit')?.value || '个').trim();
  var reference_price = parseFloat(document.getElementById('partPrice')?.value || 0) || null;
  var applicable_devices = (document.getElementById('partDevices')?.value || '').trim();
  var description = (document.getElementById('partDesc')?.value || '').trim();
  if (!part_code) return showToast('请填写配件编码', 'error');
  if (!part_name) return showToast('请填写配件名称', 'error');
  try {
    var data = { part_code: part_code, part_name: part_name, part_category: part_category, unit: unit };
    if (part_model) data.part_model = part_model;
    if (specification) data.specification = specification;
    if (manufacturer) data.manufacturer = manufacturer;
    if (reference_price) data.reference_price = reference_price;
    if (applicable_devices) data.applicable_devices = applicable_devices;
    if (description) data.description = description;
    await API.parts.create(data);
    Modal.hide();
    showToast('配件已创建', 'success');
    renderPartsList(document.getElementById('pageContent'));
  } catch(e) { showToast(e.message || '操作失败', 'error'); }
}

async function openEditPartModal(partId) {
  try {
    var p = await API.parts.detail(partId);
    Modal.show(
      '<div class="form-group"><label>配件编码</label>' +
      '<input type="text" class="form-control" value="' + (p.part_code || '') + '" disabled></div>' +
      '<div class="form-group"><label>配件名称 <span class="required">*</span></label>' +
      '<input type="text" class="form-control" id="editPartName" value="' + (p.part_name || '') + '"></div>' +
      '<div class="form-group"><label>型号</label>' +
      '<input type="text" class="form-control" id="editPartModel" value="' + (p.part_model || '') + '"></div>' +
      '<div class="form-group"><label>分类</label>' +
      '<select class="form-control" id="editPartCategory">' +
        ['硬件','耗材','软件','结构件'].map(function(c){ return '<option' + (c===(p.part_category||'')?' selected':'') + '>' + c + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="form-group"><label>规格参数</label>' +
      '<input type="text" class="form-control" id="editPartSpec" value="' + (p.specification || '') + '"></div>' +
      '<div class="form-group"><label>生产厂商</label>' +
      '<input type="text" class="form-control" id="editPartMfr" value="' + (p.manufacturer || '') + '"></div>' +
      '<div class="form-group"><label>单位</label>' +
      '<select class="form-control" id="editPartUnit">' +
        ['个','套','件','片','卷'].map(function(u){ return '<option' + (u===(p.unit||'')?' selected':'') + '>' + u + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="form-group"><label>参考价格（元）</label>' +
      '<input type="number" class="form-control" id="editPartPrice" value="' + (p.reference_price || '') + '" step="0.01" min="0"></div>' +
      '<div class="form-group"><label>适用设备型号</label>' +
      '<input type="text" class="form-control" id="editPartDevices" value="' + (p.applicable_devices || '') + '"></div>' +
      '<div class="form-group"><label>说明</label>' +
      '<textarea class="form-control" id="editPartDesc" rows="2">' + (p.description || '') + '</textarea></div>',
      '编辑配件',
      { footer: '<div class="modal-footer"><button class="btn btn-outline" onclick="Modal.hide()">取消</button><button class="btn btn-primary" onclick="doEditPart(' + partId + ')">保存</button></div>' }
    );
  } catch(e) { showToast(e.message || '加载失败', 'error'); }
}

async function doEditPart(partId) {
  var part_name = (document.getElementById('editPartName')?.value || '').trim();
  var part_model = (document.getElementById('editPartModel')?.value || '').trim();
  var part_category = (document.getElementById('editPartCategory')?.value || '').trim();
  var specification = (document.getElementById('editPartSpec')?.value || '').trim();
  var manufacturer = (document.getElementById('editPartMfr')?.value || '').trim();
  var unit = (document.getElementById('editPartUnit')?.value || '个').trim();
  var reference_price = parseFloat(document.getElementById('editPartPrice')?.value || 0) || null;
  var applicable_devices = (document.getElementById('editPartDevices')?.value || '').trim();
  var description = (document.getElementById('editPartDesc')?.value || '').trim();
  if (!part_name) return showToast('请填写配件名称', 'error');
  try {
    await API.parts.update(partId, {
      part_name: part_name, part_model: part_model, part_category: part_category,
      specification: specification, manufacturer: manufacturer, unit: unit,
      reference_price: reference_price, applicable_devices: applicable_devices, description: description
    });
    Modal.hide();
    showToast('配件已更新', 'success');
    renderPartsList(document.getElementById('pageContent'));
  } catch(e) { showToast(e.message || '操作失败', 'error'); }
}

async function doDeletePart(partId, partName) {
  if (!confirm('确认删除配件「' + partName + '」？\n删除后不可恢复，已被工单引用的配件无法删除。')) return;
  try {
    await API.del('/api/parts/' + partId);
    showToast('配件已删除', 'success');
    renderPartsList(document.getElementById('pageContent'));
  } catch(e) { showToast(e.message || '删除失败', 'error'); }
}

// ========== 工单配件选择 ==========
var _selectedParts = []; // [{part_id, part_name, part_model, quantity, unit}]

function renderSelectedPartsInModal() {
  var wrap = document.getElementById('selectedPartsWrap');
  if (!wrap) return;
  if (_selectedParts.length === 0) {
    wrap.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">暂未选择配件</p>';
    return;
  }
  var html = '<table style="width:100%;font-size:13px;border-collapse:collapse;">' +
    '<tr style="border-bottom:1px solid #eee;"><th style="text-align:left;padding:4px;">配件</th><th style="width:60px;">数量</th><th style="width:40px;"></th></tr>';
  _selectedParts.forEach(function(sp, idx) {
    html += '<tr style="border-bottom:1px solid #f5f5f5;">' +
      '<td style="padding:4px;">' + sp.part_name + (sp.part_model ? ' (' + sp.part_model + ')' : '') + '</td>' +
      '<td style="padding:4px;"><input type="number" class="form-control" style="width:50px;padding:2px 4px;font-size:12px;" value="' + sp.quantity + '" min="1" onchange="_selectedParts[' + idx + '].quantity=parseInt(this.value)||1"></td>' +
      '<td style="padding:4px;text-align:center;"><button style="border:none;background:none;color:var(--danger);cursor:pointer;font-size:16px;" onclick="_selectedParts.splice(' + idx + ',1);renderSelectedPartsInModal();">✕</button></td></tr>';
  });
  html += '</table>';
  wrap.innerHTML = html;
}

async function openAddPartToFaultModal() {
  try {
    var r = await API.parts.list({ page: 1, page_size: 200 });
    var parts = r.data || [];
    if (parts.length === 0) { showToast('暂无可选配件', 'error'); return; }
    // 过滤掉已选的
    var selectedIds = _selectedParts.map(function(s){ return s.part_id; });
    var available = parts.filter(function(p){ return selectedIds.indexOf(p.id) === -1; });
    var options = available.map(function(p){
      return '<option value="' + p.id + '">' + p.part_name + (p.part_model ? ' (' + p.part_model + ')' : '') + ' [' + p.part_code + ']</option>';
    }).join('');
    Modal.show(
      '<div class="form-group"><label>选择配件</label>' +
      '<select class="form-control" id="addPartSelect">' + options + '</select></div>' +
      '<div class="form-group"><label>数量</label>' +
      '<input type="number" class="form-control" id="addPartQty" value="1" min="1"></div>',
      '添加配件',
      { footer: '<div class="modal-footer"><button class="btn btn-outline" onclick="Modal.hide()">取消</button><button class="btn btn-primary" onclick="confirmAddPartToFault()">确认添加</button></div>' }
    );
  } catch(e) { showToast('加载配件列表失败', 'error'); }
}

async function confirmAddPartToFault() {
  var partId = parseInt(document.getElementById('addPartSelect')?.value);
  var qty = parseInt(document.getElementById('addPartQty')?.value || 1);
  if (!partId || qty < 1) return showToast('请选择配件和数量', 'error');
  // 查找配件信息
  try {
    var p = await API.parts.detail(partId);
    _selectedParts.push({
      part_id: p.id, part_name: p.part_name, part_model: p.part_model || '',
      quantity: qty, unit: p.unit || '个'
    });
    Modal.hide();
    renderSelectedPartsInModal();
  } catch(e) { showToast('获取配件信息失败', 'error'); }
}

// ========== 用户管理 ==========
async function renderUsersList(container, params) {
  if (API.user?.role !== 'headquarters') {
    container.innerHTML = '<div class="empty-state"><p>用户管理仅总部账号可用</p></div>';
    return;
  }
  container.innerHTML = `
    <div class="card">
      <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;">
        <span>👥 用户管理</span>
        <button class="btn btn-success btn-sm" onclick="openCreateUserModal()">➕ 新增用户</button>
      </div>
      <div class="filter-bar">
        <div class="search-input">
          <input type="text" class="form-control" id="userSearch" placeholder="搜索用户名、姓名...">
        </div>
        <select class="form-control" id="userRoleFilter" onchange="reloadUsersList()">
          <option value="">全部角色</option>
          <option value="engineer">工程师</option>
          <option value="city_agent">市代</option>
          <option value="provincial_agent">省代</option>
          <option value="headquarters">总部</option>
        </select>
        <select class="form-control" id="userStatusFilter" onchange="reloadUsersList()">
          <option value="">全部状态</option>
          <option value="active">启用</option>
          <option value="disabled">禁用</option>
        </select>
        <button class="btn btn-primary" onclick="reloadUsersList()">搜索</button>
      </div>
      <div id="usersTableWrap"></div>
      <div class="pagination" id="usersPagination"></div>
    </div>
  `;
  reloadUsersList(1);
}

async function reloadUsersList(page) {
  page = page || 1;
  var keyword = (document.getElementById('userSearch')?.value || '').trim();
  var role = document.getElementById('userRoleFilter')?.value || '';
  var status = document.getElementById('userStatusFilter')?.value || '';
  try {
    var params = { page: page, page_size: 20 };
    if (keyword) params.keyword = keyword;
    if (role) params.role = role;
    if (status) params.status = status;
    var r = await API.users.list(params);
    var wrap = document.getElementById('usersTableWrap');
    if (!wrap) return;
    if (!r.data || r.data.length === 0) { wrap.innerHTML = '<div class="empty-state"><p>暂无用户数据</p></div>'; return; }
    var roleMap = { engineer: '工程师', city_agent: '市代', provincial_agent: '省代', headquarters: '总部' };
    var html = '<table class="data-table"><thead><tr><th>用户名</th><th>姓名</th><th>角色</th><th>单位</th><th>区域</th><th>联系电话</th><th>状态</th><th>最后登录</th><th>操作</th></tr></thead><tbody>';
    r.data.forEach(function(u) {
      var parts = [u.province || '', u.city || ''].filter(function(x){return x;});
      var location = parts.length ? parts.join('/') : '-';
      var statusColor = u.status === 'active' ? 'var(--success)' : 'var(--danger)';
      html += '<tr>';
      html += '<td>' + (u.username || '-') + '</td>';
      html += '<td>' + (u.real_name || '-') + '</td>';
      html += '<td>' + (roleMap[u.role] || u.role || '-') + '</td>';
      html += '<td>' + (u.company_name || '-') + '</td>';
      html += '<td>' + location + '</td>';
      html += '<td>' + (u.phone || '-') + '</td>';
      html += '<td style="color:' + statusColor + ';font-weight:600;">' + (u.status === 'active' ? '启用' : '禁用') + '</td>';
      html += '<td>' + formatDate(u.last_login) + '</td>';
      html += '<td>' +
        '<button class="btn btn-sm btn-outline" onclick="openEditUserModal(' + u.id + ')">编辑</button> ' +
        '<button class="btn btn-sm btn-outline" onclick="openResetUserPwdModal(' + u.id + ')">重置密码</button> ' +
        (u.status === 'active' ?
          '<button class="btn btn-sm btn-warning" onclick="doToggleUser(' + u.id + ')">禁用</button>' :
          '<button class="btn btn-sm btn-success" onclick="doToggleUser(' + u.id + ')">启用</button>') +
        '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
    renderPagination('usersPagination', r.total, r.page, r.page_size, reloadUsersList);
  } catch(e) {
    var wrap2 = document.getElementById('usersTableWrap');
    if (wrap2) wrap2.innerHTML = '<p style="color:var(--danger)">加载失败: ' + (e.message || '') + '</p>';
  }
}

function openCreateUserModal() {
  Modal.show(
    '<div class="form-group"><label>用户名 <span class="required">*</span></label>' +
    '<input type="text" class="form-control" id="newUserUsername" placeholder="登录用户名"></div>' +
    '<div class="form-group"><label>姓名 <span class="required">*</span></label>' +
    '<input type="text" class="form-control" id="newUserRealName" placeholder="真实姓名"></div>' +
    '<div class="form-group"><label>角色 <span class="required">*</span></label>' +
    '<select class="form-control" id="newUserRole" onchange="onUserRoleChange()">' +
    '<option value="engineer">工程师</option>' +
    '<option value="city_agent">市代</option>' +
    '<option value="provincial_agent">省代</option>' +
    '<option value="headquarters">总部</option></select></div>' +
    '<div class="form-group"><label>单位名称</label>' +
    '<input type="text" class="form-control" id="newUserCompany" placeholder="公司/单位名称"></div>' +
    '<div class="form-group"><label>省份</label>' +
    '<input type="text" class="form-control" id="newUserProvince" placeholder="如：广东省"></div>' +
    '<div class="form-group" id="newUserCityGroup"><label>城市</label>' +
    '<input type="text" class="form-control" id="newUserCity" placeholder="如：广州市"></div>' +
    '<div class="form-group"><label>联系电话 <span class="required">*</span></label>' +
    '<input type="text" class="form-control" id="newUserPhone" placeholder="手机号" maxlength="11"></div>' +
    '<div class="form-group"><label>邮箱</label>' +
    '<input type="email" class="form-control" id="newUserEmail" placeholder="选填"></div>' +
    '<div class="form-group"><label>初始密码</label>' +
    '<input type="text" class="form-control" value="123456" readonly>' +
    '<div class="form-hint">默认密码：123456（首次登录后可修改）</div></div>',
    '新增用户',
    { footer: '<div class="modal-footer"><button class="btn btn-outline" onclick="Modal.hide()">取消</button><button class="btn btn-primary" onclick="doCreateUser()">提交</button></div>' }
  );
}

function onUserRoleChange() {
  var role = document.getElementById('newUserRole')?.value;
  var cityGroup = document.getElementById('newUserCityGroup');
  if (cityGroup) cityGroup.style.display = (role === 'headquarters') ? 'none' : 'block';
}

async function doCreateUser() {
  var username = (document.getElementById('newUserUsername')?.value || '').trim();
  var real_name = (document.getElementById('newUserRealName')?.value || '').trim();
  var role = document.getElementById('newUserRole')?.value || '';
  var company_name = (document.getElementById('newUserCompany')?.value || '').trim();
  var province = (document.getElementById('newUserProvince')?.value || '').trim();
  var city = (document.getElementById('newUserCity')?.value || '').trim();
  var phone = (document.getElementById('newUserPhone')?.value || '').trim();
  var email = (document.getElementById('newUserEmail')?.value || '').trim();
  if (!username || !real_name || !role || !phone) return showToast('请填写所有必填项（用户名、姓名、角色、联系电话）', 'error');
  try {
    var data = { username: username, real_name: real_name, role: role, phone: phone };
    if (company_name) data.company_name = company_name;
    if (province) data.province = province;
    if (city) data.city = city;
    if (email) data.email = email;
    await API.users.create(data);
    Modal.hide();
    showToast('用户已创建（默认密码：123456）', 'success');
    renderUsersList(document.getElementById('pageContent'));
  } catch(e) { showToast(e.message || '操作失败', 'error'); }
}

async function openEditUserModal(userId) {
  try {
    var u = await API.get('/api/users/' + userId);
    Modal.show(
      '<div class="form-group"><label>用户名</label>' +
      '<input type="text" class="form-control" value="' + (u.username || '') + '" disabled></div>' +
      '<div class="form-group"><label>姓名 <span class="required">*</span></label>' +
      '<input type="text" class="form-control" id="editUserName" value="' + (u.real_name || '') + '"></div>' +
      '<div class="form-group"><label>角色</label>' +
      '<select class="form-control" id="editUserRole">' +
        ['engineer','city_agent','provincial_agent','headquarters'].map(function(r){
          return '<option value="' + r + '"' + (r === u.role ? ' selected' : '') + '>' +
            {engineer:'工程师',city_agent:'市代',provincial_agent:'省代',headquarters:'总部'}[r] + '</option>';
        }).join('') +
      '</select></div>' +
      '<div class="form-group"><label>单位名称</label>' +
      '<input type="text" class="form-control" id="editUserCompany" value="' + (u.company_name || '') + '"></div>' +
      '<div class="form-group"><label>省份</label>' +
      '<input type="text" class="form-control" id="editUserProvince" value="' + (u.province || '') + '"></div>' +
      '<div class="form-group"><label>城市</label>' +
      '<input type="text" class="form-control" id="editUserCity" value="' + (u.city || '') + '"></div>' +
      '<div class="form-group"><label>联系电话</label>' +
      '<input type="text" class="form-control" id="editUserPhone" value="' + (u.phone || '') + '" maxlength="11"></div>' +
      '<div class="form-group"><label>邮箱</label>' +
      '<input type="email" class="form-control" id="editUserEmail" value="' + (u.email || '') + '"></div>',
      '编辑用户',
      { footer: '<div class="modal-footer"><button class="btn btn-outline" onclick="Modal.hide()">取消</button><button class="btn btn-primary" onclick="doEditUser(' + userId + ')">保存</button></div>' }
    );
  } catch(e) { showToast('加载用户信息失败', 'error'); }
}

async function doEditUser(userId) {
  var real_name = (document.getElementById('editUserName')?.value || '').trim();
  var role = document.getElementById('editUserRole')?.value || '';
  var company_name = (document.getElementById('editUserCompany')?.value || '').trim();
  var province = (document.getElementById('editUserProvince')?.value || '').trim();
  var city = (document.getElementById('editUserCity')?.value || '').trim();
  var phone = (document.getElementById('editUserPhone')?.value || '').trim();
  var email = (document.getElementById('editUserEmail')?.value || '').trim();
  if (!real_name) return showToast('姓名不能为空', 'error');
  try {
    var data = { real_name: real_name };
    if (role) data.role = role;
    if (company_name) data.company_name = company_name;
    if (province) data.province = province;
    if (city) data.city = city;
    if (phone) data.phone = phone;
    if (email) data.email = email;
    await API.patch('/api/users/' + userId, data);
    Modal.hide();
    showToast('用户信息已更新', 'success');
    renderUsersList(document.getElementById('pageContent'));
  } catch(e) { showToast(e.message || '操作失败', 'error'); }
}

async function doToggleUser(userId) {
  if (!confirm('确认变更该用户状态？')) return;
  try {
    await API.users.toggle(userId);
    showToast('用户状态已变更', 'success');
    renderUsersList(document.getElementById('pageContent'));
  } catch(e) { showToast(e.message || '操作失败', 'error'); }
}

async function openResetUserPwdModal(userId) {
  Modal.show(
    '<div class="form-group"><label>新密码 <span class="required">*</span></label>' +
    '<input type="text" class="form-control" id="resetPwd" value="123456" placeholder="至少6位">' +
    '<div class="form-hint">重置后用户下次登录需使用新密码</div></div>',
    '重置密码',
    { footer: '<div class="modal-footer"><button class="btn btn-outline" onclick="Modal.hide()">取消</button><button class="btn btn-primary" onclick="doResetUserPwd(' + userId + ')">确认重置</button></div>' }
  );
}

async function doResetUserPwd(userId) {
  var new_pwd = (document.getElementById('resetPwd')?.value || '').trim();
  if (!new_pwd || new_pwd.length < 6) return showToast('密码至少6位', 'error');
  try {
    await API.users.resetPassword(userId, new_pwd);
    Modal.hide();
    showToast('密码已重置', 'success');
  } catch(e) { showToast(e.message || '操作失败', 'error'); }
}

// ===================== 售中模块 =====================

// 项目列表页
async function renderPreSalesList(container, params) {
  container.innerHTML = `
    <div class="card">
      <div class="card-title">📋 售中项目管理</div>
      <div class="filter-bar">
        <div class="search-input">
          <input type="text" class="form-control" id="psSearch" placeholder="搜索项目编号、医院、工程师...">
        </div>
        <select class="form-control" id="psStatusFilter" onchange="reloadPreSalesList()">
          <option value="">全部状态</option>
          <option value="进行中">进行中</option>
          <option value="已验收">已验收</option>
          <option value="已转入售后">已转入售后</option>
          <option value="已取消">已取消</option>
        </select>
        <button class="btn btn-primary" onclick="reloadPreSalesList()">搜索</button>
        <button class="btn btn-success" onclick="navigateTo('preSalesCreate')">➕ 新建售中项目</button>
      </div>
      <div id="psTableWrap"></div>
      <div class="pagination" id="psPagination"></div>
    </div>
  `;
  reloadPreSalesList(1);
}

async function reloadPreSalesList(page = 1) {
  const params = {
    page, page_size: 20,
    keyword: document.getElementById('psSearch')?.value || '',
    status: document.getElementById('psStatusFilter')?.value || ''
  };
  try {
    const r = await API.get('/api/pre-sales/projects?' + new URLSearchParams(params));
    const wrap = document.getElementById('psTableWrap');
    if (!r.data || r.data.length === 0) { wrap.innerHTML = '<div class="empty-state"><p>暂无售中项目</p></div>'; return; }
    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr><th>项目编号</th><th>医院</th><th>设备编码</th><th>工程师</th><th>进度</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
        <tbody>
          ${r.data.map(p => `
            <tr>
              <td><a href="#" onclick="navigateTo('preSalesDetail',{project_no:'${p.project_no}'});return false;" style="color:var(--primary);">${p.project_no}</a></td>
              <td>${p.hospital_name||'-'}</td>
              <td>${p.device_code||'-'}</td>
              <td>${p.engineer_name||'-'}</td>
              <td>
                <div style="background:var(--bg);border-radius:4px;overflow:hidden;height:18px;width:120px;">
                  <div style="height:100%;width:${p.completion_percent}%;background:${p.completion_percent>=100?'var(--success)':'var(--primary)'};transition:width .3s;"></div>
                </div>
                <span style="font-size:11px;color:var(--text-muted);">${p.completion_percent}%</span>
              </td>
              <td>${(p.status==='进行中'?'<span style="color:var(--primary);">●</span>':'')+(p.status==='已验收'?'<span style="color:var(--warning);">●</span>':'')+(p.status==='已转入售后'?'<span style="color:var(--success);">●</span>':'')+(p.status==='已取消'?'<span style="color:var(--danger);">●</span>':'')} ${p.status}</td>
              <td>${formatDate(p.created_at)}</td>
              <td>
                <a href="#" onclick="navigateTo('preSalesDetail',{project_no:'${p.project_no}'});return false;" class="btn btn-sm">详情</a>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    renderPagination('psPagination', r.page, r.total, r.page_size, reloadPreSalesList);
  } catch(e) { showToast(e.message, 'error'); }
}

// 新建项目页
async function renderPreSalesCreate(container) {
  let hospitals = [], engineers = [], deviceModels = [];
  const curUser = API.user || {};

  // 加载医院列表（含供应商过滤）
  try {
    const hr = await API.get('/api/hospitals?page_size=200');
    hospitals = hr.data || [];
  } catch(e) {}

  // 加载设备型号
  try {
    const mr = await API.get('/api/device-models?status=active&page_size=50');
    deviceModels = mr.data || [];
  } catch(e) {}

  // 加载工程师：按供应商体系过滤
  try {
    let ep = 'role=engineer&page_size=100';
    if (curUser.role === 'provincial_agent' || curUser.role === 'city_agent') {
      ep += '&parent_agent_id=' + curUser.id;
    } else if (curUser.role === 'engineer') {
      ep += '&parent_agent_id=' + (curUser.parent_agent_id || '');
    }
    const er = await API.get('/api/users?' + ep);
    engineers = er.data || [];
  } catch(e) {}

  const provinceOptions = ['','北京市','天津市','河北省','山西省','内蒙古','辽宁省','吉林省','黑龙江省','上海市','江苏省','浙江省','安徽省','福建省','江西省','山东省','河南省','湖北省','湖南省','广东省','广西','海南省','重庆市','四川省','贵州省','云南省','西藏','陕西省','甘肃省','青海省','宁夏','新疆','香港','澳门','台湾']
    .map(p => `<option value="${p}">${p||'请选择省份'}</option>`).join('');

  container.innerHTML = `
    <div class="card">
      <div class="card-title">➕ 新建售中项目</div>
      <p style="color:var(--text-muted);margin-bottom:20px;">创建项目后将自动生成8个售中节点（远程前置→到场验收），工程师按顺序执行</p>

      <div class="form-group">
        <label>选择模式</label>
        <div style="display:flex;gap:8px;">
          <label style="cursor:pointer;padding:8px 16px;border:1px solid var(--border);border-radius:8px;flex:1;text-align:center;" id="psModeExisting">
            <input type="radio" name="psMode" value="existing" checked onchange="togglePSMode()" style="display:none;">
            📋 选择已有医院
          </label>
          <label style="cursor:pointer;padding:8px 16px;border:1px solid var(--border);border-radius:8px;flex:1;text-align:center;" id="psModeNew">
            <input type="radio" name="psMode" value="new" onchange="togglePSMode()" style="display:none;">
            🏥 新建医院
          </label>
        </div>
      </div>

      <!-- 已有医院选择 -->
      <div id="psExistingBlock">
        <div class="form-group">
          <label>医院 <span class="required">*</span></label>
          <select class="form-control" id="psHospital">
            <option value="">-- 选择医院 --</option>
            ${hospitals.map(h => `<option value="${h.id}">${h.hospital_name}（${h.province||''}${h.city||''}）</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- 新建医院表单 -->
      <div id="psNewBlock" style="display:none;">
        <div class="form-group">
          <label>医院名称 <span class="required">*</span></label>
          <input type="text" class="form-control" id="psNewName" placeholder="例：XX市第一人民医院">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label>省份 <span class="required">*</span></label>
            <select class="form-control" id="psNewProvince">${provinceOptions}</select>
          </div>
          <div class="form-group">
            <label>城市 <span class="required">*</span></label>
            <input type="text" class="form-control" id="psNewCity" placeholder="例：广州市">
          </div>
        </div>
        <div class="form-group">
          <label>地址</label>
          <input type="text" class="form-control" id="psNewAddress" placeholder="详细地址">
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group">
            <label>联系人</label>
            <input type="text" class="form-control" id="psNewContact" placeholder="例：李主任">
          </div>
          <div class="form-group">
            <label>联系电话</label>
            <input type="text" class="form-control" id="psNewPhone" placeholder="例：13800138000">
          </div>
        </div>
      </div>

      <div class="form-group">
        <label>设备编码</label>
        <input type="text" class="form-control" id="psDeviceCode" placeholder="可选，验收后自动创建对应的设备档案">
      </div>
      <div class="form-group">
        <label>设备型号</label>
        <select class="form-control" id="psDeviceType">
          <option value="">-- 选择型号 --</option>
          ${deviceModels.map(m => `<option value="${m.model_code}">${m.model_code} - ${m.model_name}（${m.device_type}）</option>`).join('')}
        </select>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group">
          <label>安装位置</label>
          <input type="text" class="form-control" id="psInstallLocation" placeholder="例：药房">
        </div>
        <div class="form-group">
          <label>IP地址</label>
          <input type="text" class="form-control" id="psInstallIP" placeholder="例：192.168.1.100">
        </div>
      </div>
      <div class="form-group">
        <label>负责工程师 <span class="required">*</span></label>
        <select class="form-control" id="psEngineer">
          <option value="">-- 选择工程师 --</option>
          ${engineers.map(e => `<option value="${e.id}">${e.real_name||e.username}（${e.province||''}${e.city||''}）</option>`).join('')}
        </select>
      </div>
      <div class="form-actions">
        <button class="btn btn-outline" onclick="navigateTo('preSales')">取消</button>
        <button class="btn btn-primary" onclick="doCreatePreSales()">创建项目</button>
      </div>
    </div>
  `;
}

// 切换医院模式
function togglePSMode() {
  const mode = document.querySelector('input[name="psMode"]:checked')?.value || 'existing';
  const existingBlock = document.getElementById('psExistingBlock');
  const newBlock = document.getElementById('psNewBlock');
  const labelExisting = document.getElementById('psModeExisting');
  const labelNew = document.getElementById('psModeNew');

  if (mode === 'new') {
    existingBlock.style.display = 'none';
    newBlock.style.display = 'block';
    labelExisting.style.background = '';
    labelNew.style.background = 'var(--primary-light)';
  } else {
    existingBlock.style.display = 'block';
    newBlock.style.display = 'none';
    labelExisting.style.background = 'var(--primary-light)';
    labelNew.style.background = '';
  }
}

async function doCreatePreSales() {
  const mode = document.querySelector('input[name="psMode"]:checked')?.value || 'existing';
  const engineer_id = parseInt(document.getElementById('psEngineer')?.value);
  if (!engineer_id) return showToast('请选择负责工程师', 'error');

  let payload = { engineer_id };

  if (mode === 'new') {
    const hospital_name = document.getElementById('psNewName')?.value?.trim();
    const province = document.getElementById('psNewProvince')?.value;
    const city = document.getElementById('psNewCity')?.value?.trim();
    if (!hospital_name || !province || !city) return showToast('新建医院需填写名称、省份、城市', 'error');
    payload.hospital_mode = 'new';
    payload.hospital_name = hospital_name;
    payload.province = province;
    payload.city = city;
    payload.address = document.getElementById('psNewAddress')?.value?.trim() || '';
    payload.contact_person = document.getElementById('psNewContact')?.value?.trim() || '';
    payload.contact_phone = document.getElementById('psNewPhone')?.value?.trim() || '';
  } else {
    const hospital_id = parseInt(document.getElementById('psHospital')?.value);
    if (!hospital_id) return showToast('请选择医院', 'error');
    payload.hospital_mode = 'existing';
    payload.hospital_id = hospital_id;
  }

  payload.device_code = document.getElementById('psDeviceCode')?.value?.trim() || null;
  payload.device_type = document.getElementById('psDeviceType')?.value || null;
  payload.install_location = document.getElementById('psInstallLocation')?.value?.trim() || null;
  payload.install_ip = document.getElementById('psInstallIP')?.value?.trim() || null;

  try {
    const r = await API.post('/api/pre-sales/projects', payload);
    showToast(`项目已创建：${r.project_no}`, 'success');
    navigateTo('preSalesDetail', { project_no: r.project_no });
  } catch(e) { showToast(e.message, 'error'); }
}

// ===================== 项目详情页（8节点工作流） =====================

async function renderPreSalesDetail(container, params) {
  const project_no = params.project_no;
  try {
    const p = await API.get(`/api/pre-sales/projects/${project_no}`);

    // 节点状态标签
    const nodeBadge = (n) => {
      if (n.status === '已完成') return '<span style="background:var(--success);color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;">✓ 完成</span>';
      if (n.status === '进行中') return '<span style="background:var(--primary);color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;">► 进行中</span>';
      return '<span style="background:var(--bg);color:var(--text-muted);padding:2px 8px;border-radius:10px;font-size:11px;border:1px solid var(--border);">○ 未开始</span>';
    };

    const stageIcon = (stage) => {
      if (stage === '远程前') return '🌐';
      if (stage === '远程后') return '🔌';
      return '📍';
    };

    const nodeCards = p.nodes.map((nd, i) => {
      const doneCount = nd.work_items.filter(w => w.completed).length;
      const totalItems = nd.work_items.length;
      const isCurrent = nd.status === '进行中';
      const isDone = nd.status === '已完成';
      const isLocked = nd.status === '未开始';
      const stageName = nd.stage === '远程前' ? '到场前（远程）' : nd.stage === '远程后' ? '到场后（远程+现场）' : '到场后（现场）';

      return `
        <div class="ps-node-card ${isCurrent?'ps-node-current':''} ${isDone?'ps-node-done':''} ${isLocked?'ps-node-locked':''}" id="psNode${i}">
          <div class="ps-node-header">
            <div class="ps-node-icon">${stageIcon(nd.stage)}</div>
            <div class="ps-node-info">
              <div class="ps-node-title">${nd.node_name} ${nodeBadge(nd)}</div>
              <div class="ps-node-sub">${stageName} | 工作点 ${doneCount}/${totalItems}</div>
            </div>
            ${isDone ? '<div style="font-size:24px;">✅</div>' : ''}
          </div>

          ${!isLocked ? `
          <div class="ps-node-body">
            <!-- 工作点 -->
            <div class="ps-section-title">📝 工作点清单</div>
            ${nd.work_items.map(w => `
              <div class="ps-work-item ${w.completed?'ps-wi-done':''}" ${(isCurrent||isDone) ? `onclick="toggleWorkItem(${w.id},'${project_no}')"` : ''} style="cursor:${(isCurrent||isDone)?'pointer':'default'};">
                <span class="ps-wi-check">${w.completed ? '✅' : isCurrent ? '☐' : '☐'}</span>
                <span class="ps-wi-text" style="${w.completed?'text-decoration:line-through;color:var(--text-muted);':''}">${w.item_name}</span>
              </div>
            `).join('')}

            <!-- 材料上传 -->
            <div class="ps-section-title" style="margin-top:12px;">📎 材料附件</div>
            <div class="ps-materials" id="psMats${i}">
              ${nd.materials.map(m => `
                <div class="ps-mat-item">
                  <a href="/data/uploads/${m.file_path}" target="_blank">📄 ${m.file_name}</a>
                  ${isCurrent ? `<span onclick="deletePSMaterial(${m.id},'${project_no}')" style="cursor:pointer;color:var(--danger);margin-left:8px;">✕</span>` : ''}
                </div>
              `).join('')}
              ${nd.materials.length === 0 ? '<span style="color:var(--text-muted);font-size:12px;">暂无材料</span>' : ''}
            </div>
            ${isCurrent ? `
            <div style="margin-top:8px;">
              <label class="btn btn-sm btn-outline" style="cursor:pointer;">
                📤 上传材料
                <input type="file" multiple accept=".jpg,.jpeg,.png,.gif,.pdf,.doc,.docx" style="display:none;" onchange="uploadPSMaterial(this,${nd.id},'${project_no}')">
              </label>
            </div>
            ` : ''}

            <!-- 问题上报 -->
            ${isCurrent ? `
            <div class="ps-section-title" style="margin-top:12px;">⚠️ 问题上报</div>
            <div style="margin-bottom:6px;">
              <textarea class="form-control" id="psIssueText${nd.id}" placeholder="描述遇到的问题..." rows="2"></textarea>
            </div>
            <button class="btn btn-warning btn-sm" onclick="reportPSIssue(${nd.id},'${project_no}')">提交问题</button>
            ` : ''}

            <!-- 操作按钮 -->
            ${isCurrent ? `
            <div style="margin-top:14px;display:flex;gap:8px;">
              <button class="btn btn-primary" onclick="completePSNode(${nd.id},'${project_no}')">✅ 完成此节点</button>
            </div>
            ` : ''}
            ${isDone ? `
            <div style="margin-top:14px;">
              <button class="btn btn-outline btn-sm" onclick="undoPSNode(${nd.id},'${project_no}')">↩ 撤销完成</button>
            </div>
            ` : ''}
          </div>
          ` : '<div class="ps-node-body" style="color:var(--text-muted);text-align:center;padding:20px;">🔒 请先完成上一节点</div>'}
        </div>
      `;
    }).join('');

    // 问题列表
    const issueSection = p.issues && p.issues.length > 0 ? `
      <div class="card" style="margin-top:16px;">
        <div class="card-title">⚠️ 问题记录（${p.issues.length}）</div>
        ${p.issues.map(iss => `
          <div class="ps-issue-item">
            <div><strong>${iss.reporter_name}</strong> · ${formatDate(iss.created_at)}</div>
            <div style="margin:4px 0;">${iss.issue_text}</div>
            <span style="font-size:11px;padding:2px 6px;border-radius:4px;background:${iss.status==='待回复'?'var(--warning)':iss.status==='已回复'?'var(--info)':'var(--success)'};color:#fff;">${iss.status}</span>
            ${iss.reply_text ? `<div style="margin-top:4px;padding:8px;background:var(--bg);border-radius:4px;font-size:13px;">💬 回复：${iss.reply_text}</div>` : ''}
            ${API.user?.role==='headquarters' && iss.status==='待回复' ? `<button class="btn btn-sm btn-outline" style="margin-top:6px;" onclick="replyPSIssue(${iss.id},'${project_no}')">回复</button>` : ''}
            ${API.user?.role!=='headquarters' && iss.status==='已回复' ? `<button class="btn btn-sm btn-outline" style="margin-top:6px;" onclick="closePSIssue(${iss.id},'${project_no}')">闭环</button>` : ''}
          </div>
        `).join('')}
      </div>
    ` : '';

    container.innerHTML = `
      <div class="card">
        <div class="card-title">📋 售中项目详情</div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;font-size:13px;">
          <p><strong>项目编号：</strong>${p.project_no}</p>
          <p><strong>医院：</strong>${p.hospital_name||'-'}</p>
          <p><strong>设备编码：</strong>${p.device_code||'-'}</p>
          <p><strong>设备型号：</strong>${p.device_type||'-'}</p>
          <p><strong>负责工程师：</strong>${p.engineer_name||'-'}</p>
          <p><strong>区域：</strong>${p.province||'-'} ${p.city||''}</p>
          <p><strong>进度：</strong>
            <span style="display:inline-block;vertical-align:middle;width:100px;height:14px;background:var(--bg);border-radius:7px;overflow:hidden;">
              <span style="display:block;height:100%;width:${p.completion_percent}%;background:${p.completion_percent>=100?'var(--success)':'var(--primary)'};"></span>
            </span>
            ${p.completion_percent}%
          </p>
          <p><strong>状态：</strong>${p.status}</p>
        </div>
        <div style="margin-top:12px;display:flex;gap:8px;">
          <button class="btn btn-outline" onclick="navigateTo('preSales')">← 返回列表</button>
          ${p.status==='已验收' ? `<button class="btn btn-success" onclick="handoffToAfterSales('${p.project_no}')">🚀 转入售后</button>` : ''}
          ${(p.status==='进行中'||p.status==='已验收') ? `<button class="btn btn-outline" style="color:var(--danger);" onclick="cancelPSProject('${p.project_no}')">取消项目</button>` : ''}
        </div>
      </div>

      <div class="card" style="margin-top:12px;">
        <div class="card-title">📊 售中流程节点</div>
        <div class="ps-timeline">
          ${nodeCards}
        </div>
      </div>

      ${issueSection}
    `;
  } catch(e) { container.innerHTML = `<div class="card"><p style="color:var(--danger);">加载失败：${e.message}</p></div>`; }
}

// 工作点切换
async function toggleWorkItem(wiId, projectNo) {
  try {
    const r = await API.post(`/api/pre-sales/nodes/0/work-items/${wiId}/toggle`, {});
    showToast(r.message || '操作成功', 'success');
    renderPreSalesDetail(document.getElementById('pageContent'), { project_no: projectNo });
  } catch(e) { showToast(e.message, 'error'); }
}

// 完成节点
async function completePSNode(nodeId, projectNo) {
  if (!confirm('确认此节点所有工作已完成？')) return;
  try {
    const r = await API.post(`/api/pre-sales/nodes/${nodeId}/complete`, {});
    showToast(r.message || '节点已完成', 'success');
    renderPreSalesDetail(document.getElementById('pageContent'), { project_no: projectNo });
  } catch(e) { showToast(e.message, 'error'); }
}

// 撤销节点
async function undoPSNode(nodeId, projectNo) {
  if (!confirm('撤销后该节点及后续节点将回退，确认？')) return;
  try {
    await API.post(`/api/pre-sales/nodes/${nodeId}/undo`, {});
    showToast('已撤销', 'success');
    renderPreSalesDetail(document.getElementById('pageContent'), { project_no: projectNo });
  } catch(e) { showToast(e.message, 'error'); }
}

// 上传材料
async function uploadPSMaterial(input, nodeId, projectNo) {
  const files = input.files;
  if (!files.length) return;
  const formData = new FormData();
  for (const f of files) formData.append('files', f);
  try {
    const token = API.token || '';
    const res = await fetch('/api/pre-sales/nodes/' + nodeId + '/upload', {
      method: 'POST',
      headers: { 'Authorization': token },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '上传失败');
    showToast(data.message, 'success');
    renderPreSalesDetail(document.getElementById('pageContent'), { project_no: projectNo });
  } catch(e) { showToast(e.message, 'error'); }
}

// 删除材料
async function deletePSMaterial(matId, projectNo) {
  if (!confirm('确认删除此材料？')) return;
  try {
    // 通过node id路由，但这里需要知道node id...简化处理：直接调pre-sales的删除
    const r = await API.fetch('/api/pre-sales/nodes/0/materials/' + matId, { method: 'DELETE' });
    showToast('已删除', 'success');
    renderPreSalesDetail(document.getElementById('pageContent'), { project_no: projectNo });
  } catch(e) { showToast(e.message, 'error'); }
}

// 上报问题
async function reportPSIssue(nodeId, projectNo) {
  const text = document.getElementById('psIssueText' + nodeId)?.value?.trim();
  if (!text || text.length < 2) return showToast('请输入问题描述（至少2字）', 'error');
  try {
    await API.post(`/api/pre-sales/nodes/${nodeId}/issues`, { issue_text: text });
    showToast('问题已上报', 'success');
    renderPreSalesDetail(document.getElementById('pageContent'), { project_no: projectNo });
  } catch(e) { showToast(e.message, 'error'); }
}

// HQ回复问题
async function replyPSIssue(issueId, projectNo) {
  const text = prompt('请输入回复内容：');
  if (!text || !text.trim()) return;
  try {
    await API.post(`/api/pre-sales/issues/${issueId}/reply`, { reply_text: text.trim() });
    showToast('已回复', 'success');
    renderPreSalesDetail(document.getElementById('pageContent'), { project_no: projectNo });
  } catch(e) { showToast(e.message, 'error'); }
}

// 闭环问题
async function closePSIssue(issueId, projectNo) {
  if (!confirm('确认闭环此问题？')) return;
  try {
    await API.post(`/api/pre-sales/issues/${issueId}/close`, {});
    showToast('已闭环', 'success');
    renderPreSalesDetail(document.getElementById('pageContent'), { project_no: projectNo });
  } catch(e) { showToast(e.message, 'error'); }
}

// 转入售后
async function handoffToAfterSales(projectNo) {
  if (!confirm('确认将售中项目转入售后模块？\n\n此操作将自动创建设备档案并永久归档售中记录。')) return;
  try {
    await API.post(`/api/pre-sales/projects/${projectNo}/handoff`, {});
    showToast('已转入售后模块', 'success');
    renderPreSalesDetail(document.getElementById('pageContent'), { project_no: projectNo });
  } catch(e) { showToast(e.message, 'error'); }
}

// 取消项目
async function cancelPSProject(projectNo) {
  if (!confirm('确认取消此售中项目？')) return;
  try {
    await API.post(`/api/pre-sales/projects/${projectNo}/cancel`, {});
    showToast('项目已取消', 'success');
    navigateTo('preSales');
  } catch(e) { showToast(e.message, 'error'); }
}

// ===================== 售中节点配置页（HQ） =====================

async function renderPreSalesNodeConfig(container) {
  try {
    const r = await API.get('/api/pre-sales/node-defs');
    const defs = r.data || [];

    container.innerHTML = `
      <div class="card">
        <div class="card-title">🔧 售中节点配置</div>
        <p style="color:var(--text-muted);margin-bottom:16px;">管理售中流程节点内容、工作点和必填材料。修改后新创建的项目将使用最新配置。</p>
        <button class="btn btn-success" style="margin-bottom:16px;" onclick="openCreateNodeDefModal()">➕ 新增节点</button>
        <div id="nodeDefsTable">
          <table class="data-table">
            <thead><tr><th>序号</th><th>节点名称</th><th>阶段</th><th>远程</th><th>工作点数</th><th>材料数</th><th>操作</th></tr></thead>
            <tbody>
              ${defs.map(d => `
                <tr>
                  <td>${d.node_index}</td>
                  <td>${d.node_name}</td>
                  <td>${d.stage}</td>
                  <td>${d.is_remote?'是':'否'}</td>
                  <td>${(d.work_items||[]).length}</td>
                  <td>${(d.required_materials||[]).length}</td>
                  <td>
                    <button class="btn btn-sm" onclick="openEditNodeDefModal(${d.id},${JSON.stringify(d).replace(/"/g,'&quot;')})">编辑</button>
                    <button class="btn btn-sm" style="color:var(--danger);" onclick="deleteNodeDef(${d.id})">删除</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch(e) { container.innerHTML = `<div class="card"><p style="color:var(--danger);">加载失败：${e.message}</p></div>`; }
}

function openCreateNodeDefModal() {
  Modal.show(`
    <div class="form-group">
      <label>节点序号 <span class="required">*</span></label>
      <input type="number" class="form-control" id="ndefIdx" placeholder="1-99" min="1">
    </div>
    <div class="form-group">
      <label>节点名称 <span class="required">*</span></label>
      <input type="text" class="form-control" id="ndefName" placeholder="到场前-基础对接准备">
    </div>
    <div class="form-group">
      <label>所属阶段 <span class="required">*</span></label>
      <select class="form-control" id="ndefStage">
        <option value="远程前">远程前</option>
        <option value="远程后">远程后</option>
        <option value="现场">现场</option>
      </select>
    </div>
    <div class="form-group">
      <label><input type="checkbox" id="ndefRemote"> 远程可完成</label>
    </div>
    <div class="form-group">
      <label>工作点（一行一个）</label>
      <textarea class="form-control" id="ndefItems" rows="5" placeholder="对接医院负责人，确认安装位置、环境、时间&#10;核对环境：干燥通风、无直射/潮湿"></textarea>
    </div>
    <div class="form-group">
      <label>必填材料（一行一个）</label>
      <textarea class="form-control" id="ndefMats" rows="3" placeholder="环境现场照片&#10;空间尺寸勘测记录"></textarea>
    </div>
  `, '新增节点定义', {
    footer: '<div class="modal-footer"><button class="btn btn-outline" onclick="Modal.hide()">取消</button><button class="btn btn-primary" onclick="doCreateNodeDef()">创建</button></div>'
  });
}

async function doCreateNodeDef() {
  const node_index = parseInt(document.getElementById('ndefIdx')?.value);
  const node_name = document.getElementById('ndefName')?.value?.trim();
  const stage = document.getElementById('ndefStage')?.value;
  const is_remote = document.getElementById('ndefRemote')?.checked;
  const work_items = document.getElementById('ndefItems')?.value?.split('\n').filter(Boolean) || [];
  const required_materials = document.getElementById('ndefMats')?.value?.split('\n').filter(Boolean) || [];
  if (!node_index || !node_name || !stage) return showToast('请填写必填项', 'error');
  try {
    await API.post('/api/pre-sales/node-defs', { node_index, node_name, stage, is_remote, work_items, required_materials });
    Modal.hide();
    showToast('节点定义已创建', 'success');
    renderPreSalesNodeConfig(document.getElementById('pageContent'));
  } catch(e) { showToast(e.message, 'error'); }
}

function openEditNodeDefModal(id, def) {
  // def 从 data attribute 传入，已经是对象
  if (typeof def === 'string') def = JSON.parse(def.replace(/&quot;/g,'"'));
  const items = (def.work_items || []).join('\n');
  const mats = (def.required_materials || []).join('\n');
  Modal.show(`
    <div class="form-group">
      <label>节点序号 <span class="required">*</span></label>
      <input type="number" class="form-control" id="ndefIdx" value="${def.node_index}">
    </div>
    <div class="form-group">
      <label>节点名称 <span class="required">*</span></label>
      <input type="text" class="form-control" id="ndefName" value="${def.node_name}">
    </div>
    <div class="form-group">
      <label>所属阶段 <span class="required">*</span></label>
      <select class="form-control" id="ndefStage">
        <option value="远程前" ${def.stage==='远程前'?'selected':''}>远程前</option>
        <option value="远程后" ${def.stage==='远程后'?'selected':''}>远程后</option>
        <option value="现场" ${def.stage==='现场'?'selected':''}>现场</option>
      </select>
    </div>
    <div class="form-group">
      <label><input type="checkbox" id="ndefRemote" ${def.is_remote?'checked':''}> 远程可完成</label>
    </div>
    <div class="form-group">
      <label>工作点（一行一个）</label>
      <textarea class="form-control" id="ndefItems" rows="5">${items}</textarea>
    </div>
    <div class="form-group">
      <label>必填材料（一行一个）</label>
      <textarea class="form-control" id="ndefMats" rows="3">${mats}</textarea>
    </div>
  `, '编辑节点定义', {
    footer: `<div class="modal-footer"><button class="btn btn-outline" onclick="Modal.hide()">取消</button><button class="btn btn-primary" onclick="doUpdateNodeDef(${id})">保存</button></div>`
  });
}

async function doUpdateNodeDef(id) {
  const node_index = parseInt(document.getElementById('ndefIdx')?.value);
  const node_name = document.getElementById('ndefName')?.value?.trim();
  const stage = document.getElementById('ndefStage')?.value;
  const is_remote = document.getElementById('ndefRemote')?.checked;
  const work_items = document.getElementById('ndefItems')?.value?.split('\n').filter(Boolean) || [];
  const required_materials = document.getElementById('ndefMats')?.value?.split('\n').filter(Boolean) || [];
  try {
    await API.put(`/api/pre-sales/node-defs/${id}`, { node_index, node_name, stage, is_remote, work_items, required_materials });
    Modal.hide();
    showToast('已保存', 'success');
    renderPreSalesNodeConfig(document.getElementById('pageContent'));
  } catch(e) { showToast(e.message, 'error'); }
}

async function deleteNodeDef(id) {
  if (!confirm('删除此节点定义？已有项目不受影响。')) return;
  try {
    await API.del(`/api/pre-sales/node-defs/${id}`);
    showToast('已删除', 'success');
    renderPreSalesNodeConfig(document.getElementById('pageContent'));
  } catch(e) { showToast(e.message, 'error'); }
}

// ===================== 设备型号管理（HQ） =====================

async function renderDeviceModelsList(container) {
  var isHQ = API.user && API.user.role === "headquarters";
  container.innerHTML = ''
    + '<div class="card">'
    +   '<div class="card-title" style="display:flex;align-items:center;justify-content:space-between;">'
    +     '<span>📦 设备型号管理</span>'
    +     (isHQ ? '<button class="btn btn-success btn-sm" onclick="openCreateDeviceModelModal()">➕ 新增型号</button>' : '')
    +   '</div>'
    +   '<div class="filter-bar">'
    +     '<div class="search-input"><input type="text" class="form-control" id="dmSearch" placeholder="搜索型号编码、名称..."></div>'
    +     '<select class="form-control" id="dmTypeFilter" onchange="reloadDeviceModelsList()">'
    +       '<option value="">全部类型</option>'
    +       '<option value="台式">台式</option>'
    +       '<option value="立式">立式</option>'
    +     '</select>'
    +     '<select class="form-control" id="dmStatusFilter" onchange="reloadDeviceModelsList()">'
    +       '<option value="all">全部状态</option>'
    +       '<option value="active">在售</option>'
    +       '<option value="discontinued">停产</option>'
    +     '</select>'
    +     '<button class="btn btn-primary" onclick="reloadDeviceModelsList()">搜索</button>'
    +   '</div>'
    +   '<div id="dmTableWrap"></div>'
    +   '<div class="pagination" id="dmPagination"></div>'
    + '</div>';
  reloadDeviceModelsList(1);
}

async function reloadDeviceModelsList(page) {
  page = page || 1;
  var keyword = (document.getElementById('dmSearch')?.value || '').trim();
  var device_type = document.getElementById('dmTypeFilter')?.value || '';
  var status = document.getElementById('dmStatusFilter')?.value || '';
  var isHQ = API.user && API.user.role === "headquarters";
  try {
    var params = { page: page, page_size: 20 };
    if (keyword) params.keyword = keyword;
    if (device_type) params.device_type = device_type;
    if (status === 'all') params.status = 'all'; else if (status) params.status = status; else params.status = 'active';
    var r = await API.get('/api/device-models?' + new URLSearchParams(params).toString());
    var wrap = document.getElementById('dmTableWrap');
    if (!wrap) return;
    if (!r.data || r.data.length === 0) {
      wrap.innerHTML = '<div class="empty-state"><p>暂无设备型号</p></div>';
      return;
    }
    var html = '<table class="data-table"><thead><tr>'
      + '<th>型号编码</th><th>名称</th><th>类型</th><th>厂商</th><th>规格</th><th>状态</th>'
      + (isHQ ? '<th>操作</th>' : '')
      + '</tr></thead><tbody>';
    r.data.forEach(function(m) {
      html += '<tr>'
        + '<td><strong>' + (m.model_code || '-') + '</strong></td>'
        + '<td>' + (m.model_name || '-') + '</td>'
        + '<td>' + (m.device_type || '-') + '</td>'
        + '<td>' + (m.manufacturer || '-') + '</td>'
        + '<td>' + (m.specification || '-') + '</td>'
        + '<td>' + (m.status === 'active' ? '<span style="color:var(--success)">在售</span>' : '<span style="color:var(--text-muted)">停产</span>') + '</td>';
      if (isHQ) {
        html += '<td>'
          + '<button class="btn btn-sm btn-outline" onclick="openEditDeviceModelModal(' + m.id + ')">编辑</button> '
          + '<button class="btn btn-sm btn-danger" onclick="doDeleteDeviceModel(' + m.id + ',\'' + API.escapeHtml(m.model_code) + '\')">删除</button>'
          + '</td>';
      }
      html += '</tr>';
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
    renderPagination('dmPagination', r.total, r.page, r.page_size, reloadDeviceModelsList);
  } catch(e) {
    var wrap2 = document.getElementById('dmTableWrap');
    if (wrap2) wrap2.innerHTML = '<p style="color:var(--danger)">加载失败: ' + (e.message || '') + '</p>';
  }
}

function openCreateDeviceModelModal() {
  Modal.show(
    '<div class="form-group"><label>型号编码 <span class="required">*</span></label>'
    + '<input type="text" class="form-control" id="dmCode" placeholder="例：FTNG-T-YT01"></div>'
    + '<div class="form-group"><label>型号名称 <span class="required">*</span></label>'
    + '<input type="text" class="form-control" id="dmName" placeholder="例：麻精药品智能柜（台式）"></div>'
    + '<div class="form-group"><label>类型 <span class="required">*</span></label>'
    + '<select class="form-control" id="dmType"><option value="台式">台式</option><option value="立式">立式</option></select></div>'
    + '<div class="form-group"><label>生产厂商</label>'
    + '<input type="text" class="form-control" id="dmMfr" placeholder="例：丰通宁"></div>'
    + '<div class="form-group"><label>规格参数</label>'
    + '<input type="text" class="form-control" id="dmSpec" placeholder="如：台面放置型，支持取药/回收双功能"></div>'
    + '<div class="form-group"><label>描述</label>'
    + '<textarea class="form-control" id="dmDesc" placeholder="型号详细说明..." rows="3"></textarea></div>',
    '新增设备型号',
    { footer: '<div class="modal-footer"><button class="btn btn-outline" onclick="Modal.hide()">取消</button><button class="btn btn-primary" onclick="doCreateDeviceModel()">提交</button></div>' }
  );
}

async function doCreateDeviceModel() {
  var model_code = document.getElementById('dmCode')?.value?.trim();
  var model_name = document.getElementById('dmName')?.value?.trim();
  var device_type = document.getElementById('dmType')?.value;
  if (!model_code || !model_name || !device_type) return showToast('请填写必填字段', 'error');
  try {
    await API.post('/api/device-models', {
      model_code, model_name, device_type,
      manufacturer: document.getElementById('dmMfr')?.value?.trim() || null,
      specification: document.getElementById('dmSpec')?.value?.trim() || null,
      description: document.getElementById('dmDesc')?.value?.trim() || null
    });
    Modal.hide();
    showToast('已添加', 'success');
    reloadDeviceModelsList(1);
  } catch(e) { showToast(e.message, 'error'); }
}

function openEditDeviceModelModal(id) {
  API.get('/api/device-models?status=all&page_size=50').then(function(r) {
    var m = (r.data || []).find(function(x) { return x.id === id; });
    if (!m) return showToast('型号不存在', 'error');
    Modal.show(
      '<div class="form-group"><label>型号编码</label>'
      + '<input type="text" class="form-control" id="dmCode" value="' + API.escapeHtml(m.model_code) + '" disabled></div>'
      + '<div class="form-group"><label>型号名称 <span class="required">*</span></label>'
      + '<input type="text" class="form-control" id="dmName" value="' + API.escapeHtml(m.model_name || '') + '"></div>'
      + '<div class="form-group"><label>类型 <span class="required">*</span></label>'
      + '<select class="form-control" id="dmType"><option value="台式"' + (m.device_type === '台式' ? ' selected' : '') + '>台式</option><option value="立式"' + (m.device_type === '立式' ? ' selected' : '') + '>立式</option></select></div>'
      + '<div class="form-group"><label>生产厂商</label>'
      + '<input type="text" class="form-control" id="dmMfr" value="' + API.escapeHtml(m.manufacturer || '') + '"></div>'
      + '<div class="form-group"><label>规格参数</label>'
      + '<input type="text" class="form-control" id="dmSpec" value="' + API.escapeHtml(m.specification || '') + '"></div>'
      + '<div class="form-group"><label>描述</label>'
      + '<textarea class="form-control" id="dmDesc" rows="3">' + API.escapeHtml(m.description || '') + '</textarea></div>'
      + '<div class="form-group"><label>状态</label>'
      + '<select class="form-control" id="dmStatus"><option value="active"' + (m.status === 'active' ? ' selected' : '') + '>在售</option><option value="discontinued"' + (m.status === 'discontinued' ? ' selected' : '') + '>停产</option></select></div>',
      '编辑设备型号 - ' + m.model_code,
      { footer: '<div class="modal-footer"><button class="btn btn-outline" onclick="Modal.hide()">取消</button><button class="btn btn-primary" onclick="doEditDeviceModel(' + id + ')">保存</button></div>' }
    );
  }).catch(function(e) { showToast('加载失败', 'error'); });
}

async function doEditDeviceModel(id) {
  var model_name = document.getElementById('dmName')?.value?.trim();
  if (!model_name) return showToast('型号名称必填', 'error');
  try {
    await API.patch('/api/device-models/' + id, {
      model_name,
      device_type: document.getElementById('dmType')?.value,
      manufacturer: document.getElementById('dmMfr')?.value?.trim() || null,
      specification: document.getElementById('dmSpec')?.value?.trim() || null,
      description: document.getElementById('dmDesc')?.value?.trim() || null,
      status: document.getElementById('dmStatus')?.value
    });
    Modal.hide();
    showToast('已保存', 'success');
    reloadDeviceModelsList(1);
  } catch(e) { showToast(e.message, 'error'); }
}

async function doDeleteDeviceModel(id, code) {
  if (!confirm('确定删除型号 "' + code + '"？')) return;
  try {
    await API.del('/api/device-models/' + id);
    showToast('已删除', 'success');
    reloadDeviceModelsList(1);
  } catch(e) { showToast(e.message, 'error'); }
}