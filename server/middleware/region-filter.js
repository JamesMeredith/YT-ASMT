/**
 * 地区层级数据过滤辅助函数
 * 省代 → 看自己省份 + 下属市代数据
 * 市代 → 只看自己城市数据
 * 总部 → 全部数据
 * 工程师 → 看自己所在省市数据（或归属代理商范围）
 */
const PROVINCE_REGION_MAP = {
  '北京市':'华北','天津市':'华北','河北省':'华北','山西省':'华北','内蒙古':'华北',
  '辽宁省':'东北','吉林省':'东北','黑龙江省':'东北',
  '上海市':'华东','江苏省':'华东','浙江省':'华东','安徽省':'华东','福建省':'华东','江西省':'华东','山东省':'华东',
  '河南省':'华中','湖北省':'华中','湖南省':'华中',
  '广东省':'华南','广西':'华南','海南省':'华南',
  '四川省':'西南','重庆市':'西南','贵州省':'西南','云南省':'西南','西藏':'西南',
  '陕西省':'西北','甘肃省':'西北','青海省':'西北','宁夏':'西北','新疆':'西北',
  '香港':'华南','澳门':'华南','台湾':'华南'
};

function getRegion(province) {
  return PROVINCE_REGION_MAP[province] || '未知';
}

/**
 * 根据当前用户生成数据过滤的 WHERE 条件
 * 返回 { sql: 'AND ...', params: [...] }
 * tableAlias: hospitals 的别名（如 'h'）
 */
function buildRegionFilter(user, tableAlias) {
  const alias = tableAlias ? tableAlias + '.' : '';
  const role = user.role;

  // 总部 → 看全部
  if (role === 'headquarters') return { sql: '', params: [] };

  // 省代 → 看其负责省份
  if (role === 'provincial_agent') {
    if (!user.responsible_provinces) return { sql: '', params: [] };
    try {
      const provinces = JSON.parse(user.responsible_provinces);
      if (!provinces.length) return { sql: '', params: [] };
      const placeholders = provinces.map(() => '?').join(',');
      // 同时也包含下属市代的省份
      return {
        sql: ` AND ${alias}province IN (${placeholders})`,
        params: provinces
      };
    } catch (e) { return { sql: '', params: [] }; }
  }

  // 市代 → 看其负责城市
  if (role === 'city_agent') {
    if (!user.responsible_cities) return { sql: '', params: [] };
    try {
      const cities = JSON.parse(user.responsible_cities);
      if (!cities.length) return { sql: '', params: [] };
      const placeholders = cities.map(() => '?').join(',');
      return {
        sql: ` AND ${alias}city IN (${placeholders})`,
        params: cities
      };
    } catch (e) { return { sql: '', params: [] }; }
  }

  // 工程师 → 看所属代理商范围（根据 parent_agent_id）
  // 可以通过查上级代理商来确定范围
  // 简单处理：看自己省市
  if (role === 'engineer') {
    if (user.province && user.city) {
      return {
        sql: ` AND ${alias}province = ? AND ${alias}city = ?`,
        params: [user.province, user.city]
      };
    }
    if (user.province) {
      return {
        sql: ` AND ${alias}province = ?`,
        params: [user.province]
      };
    }
  }

  return { sql: '', params: [] };
}

/**
 * 辅助：生成城市列表查询的过滤（市代看下属城市）
 */
function buildCityFilter(user, tableAlias) {
  return buildRegionFilter(user, tableAlias);
}

/**
 * 判断当前用户可见的用户范围（省代 → 自己和下属市代 + 他们的工程师）
 */
function buildUserVisibilityFilter(user, db) {
  const role = user.role;

  if (role === 'headquarters') return { sql: '', params: [] };

  if (role === 'provincial_agent') {
    // 省代可以看到自己 + 下属市代 + 市代的工程师
    // 先从 responsible_provinces 获取省份，再查出该省份下的所有市代
    if (!user.responsible_provinces) return { sql: '', params: [] };
    try {
      const provinces = JSON.parse(user.responsible_provinces);
      if (!provinces.length) return { sql: '', params: [] };
      // 下属市代
      const subAgents = db.prepare(
        `SELECT id FROM users WHERE parent_agent_id = ? AND role = 'city_agent'`
      ).all(user.id);
      const subAgentIds = subAgents.map(a => a.id);

      // 可见的用户：自己 + 下属市代 + 这些市代下的工程师
      const visibleIds = [user.id, ...subAgentIds];
      const engineers = db.prepare(
        `SELECT id FROM users WHERE parent_agent_id IN (${visibleIds.map(() => '?').join(',')}) AND role = 'engineer'`
      ).all(...visibleIds);
      engineers.forEach(e => visibleIds.push(e.id));

      const placeholders = visibleIds.map(() => '?').join(',');
      return { sql: ` AND u.id IN (${placeholders})`, params: visibleIds };
    } catch (e) { return { sql: '', params: [] }; }
  }

  if (role === 'city_agent') {
    // 市代可以看到自己 + 自己的工程师
    const engineers = db.prepare(
      'SELECT id FROM users WHERE parent_agent_id = ? AND role = ?'
    ).all(user.id, 'engineer');
    const visibleIds = [user.id, ...engineers.map(e => e.id)];
    const placeholders = visibleIds.map(() => '?').join(',');
    return { sql: ` AND u.id IN (${placeholders})`, params: visibleIds };
  }

  if (role === 'engineer') {
    // 工程师只看自己
    return { sql: ' AND u.id = ?', params: [user.id] };
  }

  return { sql: '', params: [] };
}

/**
 * V3.1 供应商医院访问过滤
 * 总部 → 全部；省代/市代 → 归属自己供应商的医院；工程师 → 仅自己负责的医院
 * 返回 { sql: ' AND ...', params: [...] }，可拼接到 WHERE 中
 */
function buildHospitalAccessFilter(user, tableAlias, db) {
  const alias = tableAlias ? `${tableAlias}.` : '';

  if (user.role === 'headquarters') return { sql: '', params: [] };

  if (user.role === 'engineer') {
    return { sql: ` AND ${alias}engineer_id = ?`, params: [user.id] };
  }

  if (user.role === 'provincial_agent' || user.role === 'city_agent') {
    const visibleIds = [user.id];
    const subs = db.prepare('SELECT id FROM users WHERE parent_agent_id = ?').all(user.id);
    for (const s of subs) visibleIds.push(s.id);
    const ph = visibleIds.map(() => '?').join(',');
    return { sql: ` AND ${alias}supplier_id IN (${ph})`, params: visibleIds };
  }

  return { sql: '', params: [] };
}

/**
 * V3.1 售后工单权限过滤（供应商技术人员仅看自己工单）
 */
function buildFaultAccessFilter(user, tableAlias, db) {
  const alias = tableAlias ? `${tableAlias}.` : '';

  if (user.role === 'headquarters') return { sql: '', params: [] };

  if (user.role === 'engineer') {
    return { sql: ` AND ${alias}engineer_id = ?`, params: [user.id] };
  }

  if (user.role === 'provincial_agent' || user.role === 'city_agent') {
    const engs = db.prepare('SELECT id FROM users WHERE role = \'engineer\' AND parent_agent_id = ?').all(user.id);
    const ids = [user.id];
    for (const e of engs) ids.push(e.id);
    const ph = ids.map(() => '?').join(',');
    return { sql: ` AND ${alias}engineer_id IN (${ph})`, params: ids };
  }

  return { sql: '', params: [] };
}

module.exports = { getRegion, buildRegionFilter, buildCityFilter, buildUserVisibilityFilter, buildHospitalAccessFilter, buildFaultAccessFilter, PROVINCE_REGION_MAP };