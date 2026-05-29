/**
 * 配件管理 API
 * 新增：配件清单 CRUD + 工单配件关联
 */
const express = require('express');
const router = express.Router();
const { getDbSync } = require('../db');
const { logAudit } = require('../auth');

// ===================== 配件列表 =====================
router.get('/', (req, res) => {
  try {
    const db = getDbSync();
    const { keyword, part_category, status, page = 1, page_size = 20, low_stock } = req.query;
    let where = [];
    let params = [];
    if (keyword) { where.push('(part_name LIKE ? OR part_model LIKE ? OR part_code LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
    if (part_category) { where.push('part_category = ?'); params.push(part_category); }
    if (status) { where.push('status = ?'); params.push(status); }
    if (low_stock === 'true') { where.push('stock_quantity <= alert_threshold'); }
    const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const offset = (parseInt(page) - 1) * parseInt(page_size);
    const total = db.prepare(`SELECT COUNT(*) as cnt FROM parts ${whereStr}`).get(...params).cnt;
    const rows = db.prepare(`SELECT * FROM parts ${whereStr} ORDER BY part_category, part_name LIMIT ? OFFSET ?`).all(...params, parseInt(page_size), offset);
    res.json({ total, page: parseInt(page), page_size: parseInt(page_size), data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===================== 配件统计 =====================
router.get('/stats', (req, res) => {
  try {
    const db = getDbSync();
    const total = db.prepare('SELECT COUNT(*) as cnt FROM parts WHERE status = \'active\'').get().cnt;
    const stock = db.prepare('SELECT SUM(stock_quantity) as s FROM parts WHERE status = \'active\'').get().s || 0;
    const low = db.prepare('SELECT COUNT(*) as cnt FROM parts WHERE status = \'active\' AND stock_quantity <= alert_threshold').get().cnt;
    const fault = db.prepare('SELECT COUNT(DISTINCT part_id) as cnt FROM fault_parts').get().cnt;
    res.json({ total_parts: total, total_stock: stock, low_stock_count: low, fault_part_count: fault });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===================== 新增配件 =====================
router.post('/', (req, res) => {
  try {
    const db = getDbSync();
    const { part_code, part_name, part_category, specification, manufacturer, unit, reference_price, description, stock_quantity, alert_threshold, applicable_devices } = req.body;
    if (!part_code || !part_name) return res.status(400).json({ error: '配件编码、名称为必填项' });
    const exist = db.prepare('SELECT id FROM parts WHERE part_code = ?').get(part_code);
    if (exist) return res.status(400).json({ error: '配件编码已存在' });
    const result = db.prepare(`
      INSERT INTO parts (part_code,part_name,part_category,specification,manufacturer,unit,reference_price,description,stock_quantity,alert_threshold,applicable_devices)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(part_code, part_name, part_category || null, specification || null, manufacturer || null, unit || '个', reference_price || null, description || null, stock_quantity || 0, alert_threshold || 5, applicable_devices || null);
    logAudit(db, req.user.id, req.user.username, req.user.role, '新增配件', 'parts', String(result.lastInsertRowid), null, part_code);
    res.json({ id: result.lastInsertRowid, message: '新增成功' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ===================== 修改配件 =====================
router.patch('/:id', (req, res) => {
  try {
    const db = getDbSync();
    const id = parseInt(req.params.id);
    const exist = db.prepare('SELECT id FROM parts WHERE id = ?').get(id);
    if (!exist) return res.status(404).json({ error: '配件不存在' });
    const { part_name, part_category, specification, manufacturer, unit, reference_price, description, status, stock_quantity, alert_threshold, applicable_devices } = req.body;
    const fields = [];
    const params = [];
    if (part_name !== undefined) { fields.push('part_name = ?'); params.push(part_name); }
    if (part_category !== undefined) { fields.push('part_category = ?'); params.push(part_category); }
    if (specification !== undefined) { fields.push('specification = ?'); params.push(specification); }
    if (manufacturer !== undefined) { fields.push('manufacturer = ?'); params.push(manufacturer); }
    if (unit !== undefined) { fields.push('unit = ?'); params.push(unit); }
    if (reference_price !== undefined) { fields.push('reference_price = ?'); params.push(reference_price); }
    if (description !== undefined) { fields.push('description = ?'); params.push(description); }
    if (status !== undefined) { fields.push('status = ?'); params.push(status); }
    if (stock_quantity !== undefined) { fields.push('stock_quantity = ?'); params.push(stock_quantity); }
    if (alert_threshold !== undefined) { fields.push('alert_threshold = ?'); params.push(alert_threshold); }
    if (applicable_devices !== undefined) { fields.push('applicable_devices = ?'); params.push(applicable_devices); }
    if (!fields.length) return res.status(400).json({ error: '无更新内容' });
    fields.push(`updated_at = datetime('now','localtime')`);
    params.push(id);
    db.prepare(`UPDATE parts SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    logAudit(db, req.user.id, req.user.username, req.user.role, '修改配件', 'parts', String(id), null, JSON.stringify(req.body));
    res.json({ message: '修改成功' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ===================== 库存调整 =====================
router.post('/:id/adjust', (req, res) => {
  try {
    const db = getDbSync();
    const id = parseInt(req.params.id);
    const { type, quantity, note } = req.body;
    if (!type || !quantity || quantity < 1) return res.status(400).json({ error: '参数不完整' });
    const part = db.prepare('SELECT id,part_name,stock_quantity FROM parts WHERE id = ?').get(id);
    if (!part) return res.status(404).json({ error: '配件不存在' });
    const delta = type === 'in' ? parseInt(quantity) : -parseInt(quantity);
    const newStock = part.stock_quantity + delta;
    if (newStock < 0) return res.status(400).json({ error: '库存不足，无法出库' });
    db.prepare('UPDATE parts SET stock_quantity = ?, updated_at = datetime("now","localtime") WHERE id = ?').run(newStock, id);
    logAudit(db, req.user.id, req.user.username, req.user.role, '库存调整', 'parts', String(id), part.part_name, `${type} ${quantity} (${part.stock_quantity} -> ${newStock})${note ? ' [' + note + ']' : ''}`);
    res.json({ stock_quantity: newStock, message: type === 'in' ? '入库成功' : '出库成功' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ===================== 获取单配件详情 =====================
router.get('/:id', (req, res) => {
  try {
    const db = getDbSync();
    const part = db.prepare('SELECT * FROM parts WHERE id = ?').get(parseInt(req.params.id));
    if (!part) return res.status(404).json({ error: '配件不存在' });
    res.json(part);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===================== 删除配件 =====================
router.delete('/:id', (req, res) => {
  try {
    const db = getDbSync();
    const id = parseInt(req.params.id);
    const exist = db.prepare('SELECT id,part_name FROM parts WHERE id = ?').get(id);
    if (!exist) return res.status(404).json({ error: '配件不存在' });
    // 检查是否被工单引用
    const used = db.prepare('SELECT id FROM fault_parts WHERE part_id = ? LIMIT 1').get(id);
    if (used) return res.status(400).json({ error: '该配件已被工单引用，无法删除' });
    db.prepare('DELETE FROM parts WHERE id = ?').run(id);
    logAudit(db, req.user.id, req.user.username, req.user.role, '删除配件', 'parts', String(id), exist.part_name, null);
    res.json({ message: '删除成功' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===================== 工单配件关联 ====================================
// ===================== 为工单添加配件 =====================
router.post('/faults/:fault_no/parts', (req, res) => {
  try {
    const db = getDbSync();
    const { fault_no } = req.params;
    const { part_id, quantity, note } = req.body;
    if (!part_id || !quantity) return res.status(400).json({ error: '配件ID、数量为必填项' });
    const fault = db.prepare('SELECT fault_no FROM fault_orders WHERE fault_no = ?').get(fault_no);
    if (!fault) return res.status(404).json({ error: '工单不存在' });
    const part = db.prepare('SELECT part_name,part_model,unit FROM parts WHERE id = ?').get(part_id);
    if (!part) return res.status(404).json({ error: '配件不存在' });
    const result = db.prepare(`
      INSERT INTO fault_parts (fault_no,part_id,part_name,part_model,quantity,unit,note)
      VALUES (?,?,?,?,?,?,?)
    `).run(fault_no, part_id, part.part_name, part.part_model, quantity, part.unit, note || null);
    // 更新工单的 solution 字段，追加配件信息
    const solutionAppend = `\n【更换配件】${part.part_name}(${part.part_model}) ×${quantity}${part.unit}`;
    db.prepare(`UPDATE fault_orders SET solution = COALESCE(solution,'') || ? WHERE fault_no = ?`).run(solutionAppend, fault_no);
    logAudit(db, req.user.id, req.user.username, req.user.role, '工单添加配件', 'fault_parts', fault_no, null, `${part.part_name} ×${quantity}`);
    res.json({ id: result.lastInsertRowid, message: '配件已关联工单' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ===================== 查询工单配件列表 =====================
router.get('/faults/:fault_no/parts', (req, res) => {
  try {
    const db = getDbSync();
    const { fault_no } = req.params;
    const rows = db.prepare('SELECT * FROM fault_parts WHERE fault_no = ? ORDER BY created_at').all(fault_no);
    res.json({ data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===================== 删除工单配件关联 =====================
router.delete('/faults/:fault_no/parts/:id', (req, res) => {
  try {
    const db = getDbSync();
    const { id } = req.params;
    const exist = db.prepare('SELECT fault_no,part_name FROM fault_parts WHERE id = ?').get(id);
    if (!exist) return res.status(404).json({ error: '记录不存在' });
    db.prepare('DELETE FROM fault_parts WHERE id = ?').run(id);
    logAudit(db, req.user.id, req.user.username, req.user.role, '删除工单配件', 'fault_parts', exist.fault_no, exist.part_name, null);
    res.json({ message: '已删除' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===================== 配件更换统计（总部） =====================
router.get('/statistics', (req, res) => {
  try {
    const db = getDbSync();
    const { start_date, end_date, province, part_id } = req.query;
    let where = [];
    let params = [];
    if (start_date) { where.push('fo.created_at >= ?'); params.push(start_date); }
    if (end_date) { where.push('fo.created_at <= ?'); params.push(end_date + ' 23:59:59'); }
    if (province) { where.push('h.province = ?'); params.push(province); }
    if (part_id) { where.push('fp.part_id = ?'); params.push(part_id); }
    const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
    // 按配件统计
    const byPart = db.prepare(`
      SELECT p.part_code,p.part_name,p.part_model,
             SUM(fp.quantity) as total_quantity,
             COUNT(DISTINCT fp.fault_no) as fault_count,
             p.reference_price
      FROM fault_parts fp
      JOIN parts p ON p.id = fp.part_id
      JOIN fault_orders fo ON fo.fault_no = fp.fault_no
      LEFT JOIN hospitals h ON h.id = fo.hospital_id
      ${whereStr}
      GROUP BY fp.part_id
      ORDER BY total_quantity DESC
    `).all(...params);
    // 按省份统计
    const byProvince = db.prepare(`
      SELECT h.province, SUM(fp.quantity) as total_quantity,
             COUNT(DISTINCT fp.fault_no) as fault_count
      FROM fault_parts fp
      JOIN fault_orders fo ON fo.fault_no = fp.fault_no
      LEFT JOIN hospitals h ON h.id = fo.hospital_id
      ${whereStr}
      GROUP BY h.province
      HAVING h.province IS NOT NULL
      ORDER BY total_quantity DESC
    `).all(...params);
    res.json({ by_part: byPart, by_province: byProvince });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;