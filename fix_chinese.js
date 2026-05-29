const fs = require('fs');
let c = fs.readFileSync('E:/YT-ASMT/server/server.js', 'utf8');

// Contextual fixes - each maps corrupted fragment → correct text
const fixes = [
  // Status/labels
  ['进行\uFFFD', '进行中'],
  ['待处理\uFFFD', '待处理'],
  ['处理中\uFFFD', '处理中'],
  ['待复核\uFFFD', '待复核'],
  ['已闭环\uFFFD', '已闭环'],
  ['不存\uFFFD', '不存在'],
  ['不能为\uFFFD', '不能为空'],
  ['不允许此操\uFFFD', '不允许此操作'],
  ['已更\uFFFD', '已更新'],
  ['已引\uFFFD', '已引用'],
  ['已处\uFFFD', '已处理'],
  ['待评\uFFFD', '待评估'],
  ['已采\uFFFD', '已采纳'],
  ['已驳\uFFFD', '已驳回'],
  ['已上\uFFFD', '已上线'],
  ['已报\uFFFD', '已报废'],
  
  // Levels
  ['\uFFFD?日故障趋势', '近7日故障趋势'],
  ['一\uFFFD', '一般'],
  ['紧\uFFFD', '紧急'],
  ['维修\uFFFD', '维修中'],
  ['不满\uFFFD', '不满意'],
  ['异常待处\uFFFD', '异常待处理'],
  ['每两\uFFFD', '每两周'],
  
  // Equipment
  ['设备不存\uFFFD', '设备不存在'],
  ['工单不存\uFFFD', '工单不存在'],
  ['医院不存\uFFFD', '医院不存在'],
  ['计划不存\uFFFD', '计划不存在'],
  ['记录不存\uFFFD', '记录不存在'],
  ['知识条目不存\uFFFD', '知识条目不存\uFFFD在'], // will be fixed in next pass
  
  // Error messages
  ['设备编码、设备类型、医院编码不能为\uFFFD', '设备编码、设备类型、医院编码不能为空'],
  ['该编码已绑定\uFFFD', '该编码已绑定至'],
  ['医院编码不存\uFFFD', '医院编码不存在'],
  ['无效的状态\uFFFD', '无效的状态值'],
  ['需求标题和描述（至\uFFFD', '需求标题和描述（至少1'],
  ['采纳时必须填写预计上线时\uFFFD', '采纳时必须填写预计上线时间'],
  ['无效的评估结\uFFFD', '无效的评估结论'],
  ['仅总部可管\uFFFD', '仅总部可管理'],
  ['医院名称、省份、城市必\uFFFD', '医院名称、省份、城市必填'],
  ['该医院名称已存在，请勿重复创\uFFFD', '该医院名称已存在，请勿重复创建'],
  ['仅总部和代理商可编辑医\uFFFD', '仅总部和代理商可编辑医院'],
  ['分类、标题、解决方案不能为\uFFFD', '分类、标题、解决方案不能为空'],
  ['缺少工单\uFFFD', '缺少工单号'],
  ['服务器内部错\uFFFD', '服务器内部错误'],
  ['设备编码、维保类型、维保日期不能为\uFFFD', '设备编码、维保类型、维保日期不能为空'],
  
  // Comments
  ['更新设备状\uFFFD', '更新设备状态'],
  ['知识库入\uFFFD', '知识库入库'],
  ['复核通过，闭\uFFFD', '复核通过，闭环'],
  ['复核异常，回退至修复环\uFFFD', '复核异常，回退至修复环节'],
  ['供应商技术人员：只看自己负责医院的设\uFFFD', '供应商技术人员：只看自己负责医院的设备'],
  ['设备状态变\uFFFD', '设备状态变更'],
  ['需求管\uFFFD', '需求管理'],
  ['需求列\uFFFD', '需求列表'],
  ['新建需\uFFFD', '新建需求'],
  ['需求评估（仅总部\uFFFD', '需求评估（仅总部）'],
  ['创建需\uFFFD', '创建需求'],
  ['需求评\uFFFD', '需求评估'],
  ['更新巡检计划（暂\uFFFD', '更新巡检计划（暂停'],
  ['知识\uFFFD', '知识库'],
  ['知识库列\uFFFD', '知识库列表'],
  ['知识库搜索（必须\uFFFD', '知识库搜索（必须在'],
  ['之前，否\uFFFD', '之前，否则'],
  ['匹配\uFFFD', '匹配）'],
  ['之前\uFFFD', '之前）'],
  ['知识库详\uFFFD', '知识库详情'],
  ['新增知识库（手动\uFFFD', '新增知识库（手动）'],
  ['系统状\uFFFD', '系统状态'],
  ['字典\uFFFD', '字典表'],
  ['权限检\uFFFD', '权限检查'],
  ['名称重复检\uFFFD', '名称重复检查'],
  ['审计日志（仅总部\uFFFD', '审计日志（仅总部）'],
  ['按钮\uFFFD', '按钮）'],
  ['仅当从故障工单上下文搜索时，才记录引\uFFFD', '仅当从故障工单上下文搜索时，才记录引用'],
  ['引用了知\uFFFD', '引用了知识'],
  ['供应商可编辑\uFFFD', '供应商可编辑）'],
  ['技术人员创建时归属其上级代理商\uFFFD', '技术人员创建时归属其上级代理商）'],
  ['维保固件升级时更新设备版\uFFFD', '维保固件升级时更新设备版本'],
  
  // Special: priority values in dicts (high/medium/low)
  ["'中\uFFFD'", "'中'"],  // context-specific
  ["'高\uFFFD'", "'高'"],
  ["'低\uFFFD'", "'低'"],
  
  // Demand priority array
  ["'提示'", null], // skip, this is fine
  ["demand_priority\uFFFD", "demand_priority: ['高', '中', '低']"],
  
  // Alert message
  ['【重大故障\uFFFD', '【重大故障】'],
  
  // Engineer/dealer labels
  ['工程\uFFFD', '工程师'],
  ['经销\uFFFD', '经销商'],
  
  // Special case: the garbled comment about region filtering
  ['地区层级过滤（省\uFFFD', '地区层级过滤（省份'],
];

let fixCount = 0;
for (const [bad, good] of fixes) {
  if (c.includes(bad)) {
    c = c.split(bad).join(good);
    fixCount++;
    console.log(`Fixed: ${bad.substring(0, 30)} → ${good.substring(0, 30)}`);
  }
}

// Second pass: fix remaining standalone \uFFFD that might not have been caught
// These are special cases we handle by context

// Fix the dicts section more carefully 
// '待处?' in dicts → '待处理'
// '已闭?' in dicts → '已闭环'

// Fix demand priority array if still broken
c = c.replace("demand_priority: ['高', '中', '低']", "demand_priority: ['高', '中', '低']"); // idempotent

// Fix '（至?0字）' → '（至少10字）'
c = c.replace('（至\uFFFD0字）', '（至少10字）');

// Fix 巡检记录列表 comment
c = c.replace('巡检记录列表（按计划ID \uFFFD', '巡检记录列表（按计划ID 或');
c = c.replace('全部本人记录\uFFFD', '全部本人记录）');

// Fix inspection status comment
c = c.replace('巡检计划（暂\uFFFD恢复/结束 \uFFFD', '巡检计划（暂停/恢复/结束 ——');

fs.writeFileSync('E:/YT-ASMT/server/server.js', c, 'utf8');
console.log(`\n${fixCount} fixes applied`);

// Check remaining U+FFFD
const remaining = (c.match(/\uFFFD/g) || []).length;
console.log(`Remaining \uFFFD: ${remaining}`);