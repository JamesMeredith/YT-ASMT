// ===================== 巡检检查单配置（HQ） =====================

async function renderInspectionChecklistConfig(container) {
  var isHQ = API.user && API.user.role === 'headquarters';
  try {
    var r = await API.get('/api/inspections/checklist/all');
    var allItems = r.data || [];
    var zones = {};
    for (var i = 0; i < allItems.length; i++) {
      var z = allItems[i].zone_name;
      if (!zones[z]) zones[z] = [];
      zones[z].push(allItems[i]);
    }
    var zoneEmoji = { '外观与安装':'📦', '系统与网络':'💻', '药品管理':'💊', '硬件状态':'🖨️' };
    var zoneKeys = Object.keys(zones).sort(function(a,b) {
      return (zones[a][0].zone_sort||0) - (zones[b][0].zone_sort||0);
    });
    var html = '\n<div class="card">'
+ '<div class="card-title" style="display:flex;align-items:center;justify-content:space-between;">'
+ '<span>✅ 巡检检查单配置</span>'
+ (isHQ ? '<button class="btn btn-success btn-sm" onclick="openCreateChecklistItemModal()">➕ 新增检查项</button>' : '') + '\n</div>'
+ '<p class="text-muted" style="font-size:13px;margin:4px 0 16px 0;">总部可增删改巡检检查项，修改后巡检表单自动更新</p>';
    for (var zi = 0; zi < zoneKeys.length; zi++) {
      var zn = zoneKeys[zi];
      var items = zones[zn];
      var emoji = zoneEmoji[zn] || '📋';
      html += '\n<div class="card" style="margin-bottom:12px;">'
+ '<div class="card-title" style="display:flex;align-items:center;justify-content:space-between;">'
+ '<span>' + emoji + ' ' + zn + ' <span style="font-size:12px;color:var(--muted);">(' + items.length + '项)</span></span>'
+ '</div>'
+ '<table class="data-table"><thead><tr><th style="width:40px;">#</th><th>字段Key</th><th>项名称</th><th>类型</th><th>必填</th><th>状态</th>'
+ (isHQ ? '<th style="width:120px;">操作</th>' : '')
+ '</tr></thead><tbody>';
      for (var j = 0; j < items.length; j++) {
        var item = items[j];
        var tLabel = item.item_type === 'checkbox' ? '✓ 勾选' : (item.item_type === 'number' ? '# 数值' : 'Aa 文本');
        html += '\n<tr>'
+ '<td>' + (j + 1) + '</td>'
+ '<td><code>' + item.item_key + '</code></td>'
+ '<td>' + item.item_label + (item.placeholder ? ' <span style="color:var(--muted);font-size:12px;">(' + item.placeholder + ')</span>' : '') + '</td>'
+ '<td>' + tLabel + '</td>'
+ '<td>' + (item.is_required ? '✅' : '-') + '</td>'
+ '<td>' + (item.status === 'active' ? '<span style="color:var(--success);">● 启用</span>' : '<span style="color:var(--warn);">● 禁用</span>') + '</td>';
        if (isHQ) {
          var escLabel = item.item_label.replace(/'/g, "\\'");
          var escZone = item.zone_name.replace(/'/g, "\\'");
          var escPh = (item.placeholder||'').replace(/'/g, "\\'");
          html += '<td>'
+ '<button class="btn btn-sm" onclick="openEditChecklistItemModal(' + item.id + ',\'' + escZone + '\',' + item.zone_sort + ',\'' + item.item_key + '\',\'' + escLabel + '\',\'' + item.item_type + '\',' + (item.is_required ? 1 : 0) + ',' + item.sort_order + ',\'' + item.status + '\',\'' + escPh + '\')">✏️</button>'
+ '<button class="btn btn-sm btn-danger" onclick="deleteChecklistItem(' + item.id + ',\'' + escLabel + '\')">🗑️</button>'
+ '</td>';
        }
        html += '</tr>';
      }
      html += '</tbody></table></div>';
    }
    html += '</div>';
    container.innerHTML = html;
  } catch(e) {
    container.innerHTML = '<div class="card"><p>加载失败: ' + e.message + '</p></div>';
  }
}

async function openCreateChecklistItemModal() {
  Modal.show(
    '<div style="padding:8px;">'
+ '<div class="form-group"><label>所属区域 <span class="required">*</span></label>'
+ '<select class="form-control" id="cicZoneName">'
+ '<option value="外观与安装">📦 外观与安装</option>'
+ '<option value="系统与网络">💻 系统与网络</option>'
+ '<option value="药品管理">💊 药品管理</option>'
+ '<option value="硬件状态">🖨️ 硬件状态</option>'
+ '</select></div>'
+ '<div class="form-group"><label>区域排序号</label><input type="number" class="form-control" id="cicZoneSort" value="1"></div>'
+ '<div class="form-group"><label>字段Key <span class="required">*</span>（英文+下划线）</label><input type="text" class="form-control" id="cicItemKey" placeholder="如：temp_check"></div>'
+ '<div class="form-group"><label>显示名称 <span class="required">*</span></label><input type="text" class="form-control" id="cicItemLabel" placeholder="如：温度检查"></div>'
+ '<div class="form-group"><label>字段类型</label>'
+ '<select class="form-control" id="cicItemType">'
+ '<option value="checkbox">✓ 勾选框</option>'
+ '<option value="text">Aa 文本输入</option>'
+ '<option value="number"># 数值输入</option>'
+ '</select></div>'
+ '<div class="form-group"><label>输入提示</label><input type="text" class="form-control" id="cicPlaceholder" placeholder="如：请输入温度值"></div>'
+ '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">'
+ '<div class="form-group"><label>项目排序</label><input type="number" class="form-control" id="cicSortOrder" value="10"></div>'
+ '<div class="form-group"><label>是否必填</label><select class="form-control" id="cicRequired"><option value="1">✅ 必填</option><option value="0">- 选填</option></select></div>'
+ '</div>'
+ '</div>', '新增检查项', {
    footer: '<div class="modal-footer"><button class="btn btn-outline" onclick="Modal.hide()">取消</button><button class="btn btn-primary" onclick="doCreateChecklistItem()">保存</button></div>'
  });
}

async function doCreateChecklistItem() {
  var data = {
    zone_name: document.getElementById('cicZoneName').value,
    zone_sort: parseInt(document.getElementById('cicZoneSort').value) || 0,
    item_key: document.getElementById('cicItemKey').value.trim(),
    item_label: document.getElementById('cicItemLabel').value.trim(),
    item_type: document.getElementById('cicItemType').value,
    placeholder: document.getElementById('cicPlaceholder').value.trim() || null,
    sort_order: parseInt(document.getElementById('cicSortOrder').value) || 0,
    is_required: parseInt(document.getElementById('cicRequired').value)
  };
  if (!data.zone_name || !data.item_key || !data.item_label) return showToast('请填写必填字段', 'error');
  if (!/^[a-z_][a-z0-9_]*$/i.test(data.item_key)) return showToast('Key仅允许字母数字下划线', 'error');
  try {
    await API.post('/api/inspections/checklist', data);
    Modal.hide();
    showToast('检查项已添加', 'success');
    renderInspectionChecklistConfig(adminContent());
  } catch(e) { showToast(e.message, 'error'); }
}

async function openEditChecklistItemModal(id, zn, zs, ik, il, it, ir, so, st, ph) {
  Modal.show(
    '<div style="padding:8px;">'
+ '<div class="form-group"><label>所属区域</label>'
+ '<select class="form-control" id="eicZoneName">'
+ '<option value="外观与安装"' + (zn==='外观与安装'?' selected':'') + '>📦 外观与安装</option>'
+ '<option value="系统与网络"' + (zn==='系统与网络'?' selected':'') + '>💻 系统与网络</option>'
+ '<option value="药品管理"' + (zn==='药品管理'?' selected':'') + '>💊 药品管理</option>'
+ '<option value="硬件状态"' + (zn==='硬件状态'?' selected':'') + '>🖨️ 硬件状态</option>'
+ '</select></div>'
+ '<div class="form-group"><label>区域排序号</label><input type="number" class="form-control" id="eicZoneSort" value="' + zs + '"></div>'
+ '<div class="form-group"><label>字段Key</label><input type="text" class="form-control" value="' + ik.replace(/"/g,'&quot;') + '" disabled style="opacity:0.6;"><span style="font-size:11px;color:var(--warn);">Key不可修改</span></div>'
+ '<div class="form-group"><label>显示名称 <span class="required">*</span></label><input type="text" class="form-control" id="eicItemLabel" value="' + il.replace(/"/g,'&quot;') + '"></div>'
+ '<div class="form-group"><label>字段类型</label>'
+ '<select class="form-control" id="eicItemType">'
+ '<option value="checkbox"' + (it==='checkbox'?' selected':'') + '>✓ 勾选框</option>'
+ '<option value="text"' + (it==='text'?' selected':'') + '>Aa 文本输入</option>'
+ '<option value="number"' + (it==='number'?' selected':'') + '># 数值输入</option>'
+ '</select></div>'
+ '<div class="form-group"><label>输入提示</label><input type="text" class="form-control" id="eicPlaceholder" value="' + (ph||'').replace(/"/g,'&quot;') + '"></div>'
+ '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">'
+ '<div class="form-group"><label>排序</label><input type="number" class="form-control" id="eicSortOrder" value="' + so + '"></div>'
+ '<div class="form-group"><label>必填</label><select class="form-control" id="eicRequired"><option value="1"' + (ir?' selected':'') + '>✅ 必填</option><option value="0"' + (ir?'':' selected') + '>- 选填</option></select></div>'
+ '<div class="form-group"><label>状态</label><select class="form-control" id="eicStatus"><option value="active"' + (st==='active'?' selected':'') + '>● 启用</option><option value="inactive"' + (st==='inactive'?' selected':'') + '>● 禁用</option></select></div>'
+ '</div>'
+ '</div>', '编辑: ' + il, {
    footer: '<div class="modal-footer"><button class="btn btn-outline" onclick="Modal.hide()">取消</button><button class="btn btn-primary" onclick="doEditChecklistItem(' + id + ')">保存</button></div>'
  });
}

async function doEditChecklistItem(id) {
  var data = {};
  data.zone_name = document.getElementById('eicZoneName').value;
  data.zone_sort = parseInt(document.getElementById('eicZoneSort').value) || 0;
  data.item_label = document.getElementById('eicItemLabel').value.trim();
  data.item_type = document.getElementById('eicItemType').value;
  data.placeholder = document.getElementById('eicPlaceholder').value.trim() || null;
  data.sort_order = parseInt(document.getElementById('eicSortOrder').value) || 0;
  data.is_required = parseInt(document.getElementById('eicRequired').value);
  data.status = document.getElementById('eicStatus').value;
  if (!data.item_label) return showToast('名称不可为空', 'error');
  try {
    await API.patch('/api/inspections/checklist/' + id, data);
    Modal.hide();
    showToast('检查项已更新', 'success');
    renderInspectionChecklistConfig(adminContent());
  } catch(e) { showToast(e.message, 'error'); }
}

async function deleteChecklistItem(id, label) {
  if (!confirm('确认删除 "' + label + '" ？\n删除后巡检表单将不再显示此项。')) return;
  try {
    await API.del('/api/inspections/checklist/' + id);
    showToast('已删除', 'success');
    renderInspectionChecklistConfig(adminContent());
  } catch(e) { showToast(e.message, 'error'); }
}
