const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

const targetFile = path.join(__dirname, 'server.js');
const mojibakeText = fs.readFileSync(targetFile, 'utf8');

console.log('==== 第1种: UTF-8 -> GBK Buffer 解码 ====');
try {
  const gbkBuf = iconv.encode(mojibakeText, 'gbk');
  const fixed = gbkBuf.toString('utf8');
  
  if (fixed.includes('数据') && fixed.includes('麻精药品') && fixed.includes('启动')) {
    console.log('✅ 解码成功！');
    console.log('\n======== 头部预览 ========\n');
    console.log(fixed.slice(0, 600));
    console.log('\n======== 尾部预览 ========\n');
    console.log(fixed.slice(-800));
    
    const bakFile = targetFile + '_encoding_bak_' + Date.now();
    fs.copyFileSync(targetFile, bakFile);
    console.log('\n✅ 原文件已备份:', path.basename(bakFile));
    
    fs.writeFileSync(targetFile, fixed, 'utf8');
    console.log('✅ server.js 已修复');
    process.exit(0);
  } else {
    console.log('❌ 结果不包含预期关键词');
    console.log(fixed.slice(0, 300));
  }
} catch (e) {
  console.log('方法1异常:', e.message);
}

console.log('\n\n==== 第2种: 用映射表替换 ====');

const REPLACE_MAP = [
  ['楹荤簿鑽搧鏅鸿兘鏌�', '麻精药品智能柜'],
  ['敭鍚庤繍缁村伐鍏�', '售后运维工具'],
  ['涓绘湇鍔″櫒', '主服务器'],
  ['鏁版嵁搴撳垵濮嬪寲瀹屾垚', '数据库初始化完成'],
  ['鏁版嵁搴撳垵濮嬪寲澶辫触', '数据库初始化失败'],
  ['鏈嶅姟鍣ㄥ唴閮ㄩ敊璇�', '服务器内部错误'],
  ['[鏈嶅姟鍣�', '[服务器'],
  ['鏈満璁块棶', '本机访问'],
  ['灞€鍩熺綉璁块棶', '局域网访问'],
  ['鏁版嵁鐩綍', '数据目录'],
  ['榛樿璐﹀彿', '默认账号'],
  ['鐪佷唬', '省代'],
  ['甯備唬', '市代'],
  ['宸ョ▼甯�', '工程师'],
  ['鎬婚儴', '总部'],
  ['骞垮窞', '广州'],
  ['娣卞湷', '深圳'],
  ['璁よ瘉涓棿浠�', '认证中间件'],
  ['闈欐€佹枃浠�', '静态文件'],
  ['涓棿浠�', '中间件'],
  ['涓婁紶閰嶇疆', '上传配置'],
  ['缁熻鏁版嵁', '统计数据'],
  ['鍚姩', '启动'],
  ['// 鏁版嵁鐩綍', '// 数据目录'],
];

let replaced = mojibakeText;
for (const [bad, good] of REPLACE_MAP) {
  replaced = replaced.split(bad).join(good);
}

console.log('\n替换后预览:\n');
console.log(replaced.slice(0, 600));
console.log('\n...\n');
console.log(replaced.slice(-800));

const out2 = path.join(__dirname, 'server.js.replaced');
fs.writeFileSync(out2, replaced, 'utf8');
console.log('\n已保存替换版到 server.js.replaced');
console.log('\n如果结果正确，手动覆盖原文件即可');
process.exit(0);
