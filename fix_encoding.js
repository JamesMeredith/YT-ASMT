const fs = require('fs');
const path = require('path');
const iconv = require('iconv-lite');

function fixEncoding(filePath) {
  console.log(`正在修复: ${filePath}`);
  
  const buf = fs.readFileSync(filePath);
  const rawText = buf.toString('utf8');
  
  if (!rawText.includes('鏁版嵁') && !rawText.includes('鍚姩') && !rawText.includes('楹荤簿')) {
    console.log('  √ 没发现特征乱码，可能已经是好的或不需要修复');
    return false;
  }
  
  let hasError = false;
  try {
    const gbkBuf = iconv.encode(rawText, 'gbk');
    const corrected = gbkBuf.toString('utf8');
    
    if (!corrected.includes('数据') && !corrected.includes('麻精') && !corrected.includes('启动')) {
      hasError = true;
    } else {
      const bakPath = filePath + '.encoding_bak_' + Date.now();
      fs.copyFileSync(filePath, bakPath);
      console.log(`  · 备份已保存到: ${path.basename(bakPath)}`);
      
      fs.writeFileSync(filePath, corrected, 'utf8');
      console.log('  √ 文件修复成功');
      return true;
    }
  } catch (e) {
    hasError = true;
  }
  
  if (hasError) {
    console.log('  × iconv 猜测失败，尝试列举项目里其他文件找原文参考...');
    return false;
  }
}

function fixEncoding_SimpleGBK_Reverse(filePath) {
  const fs = require('fs');
  const buf = fs.readFileSync(filePath);
  const { Iconv } = require('iconv');
  try {
    const iconv = new Iconv('UTF-8', 'CP1252');
    const latin1Buf = iconv.convert(buf.toString('utf8'));
    const iconv2 = new Iconv('GBK', 'UTF-8');
    const result = iconv2.convert(latin1Buf).toString('utf8');
    if (result.includes('数据') || result.includes('麻精') || result.includes('登录')) {
      fs.writeFileSync(filePath + '.restored', result, 'utf8');
      console.log('结果预览:', result.slice(0, 200));
      console.log('已写入 .restored 后缀文件');
      return true;
    }
  } catch (e) { console.log('方法不对', e.message); }
  return false;
}

if (!process.argv[2]) {
  console.log('扫描项目里中文乱码的 JS 文件...');
  
  const scanDirs = [
    'e:\\YT-ASMT\\server\\server.js',
    'e:\\YT-ASMT\\server\\auth.js',
  ];
  
  for (const f of scanDirs) {
    if (fs.existsSync(f)) {
      const c = fs.readFileSync(f, 'utf8');
      if (c.includes('鏁版嵁') || c.includes('楹荤簿')) {
        console.log(`发现乱码: ${f}`);
      }
    }
  }
  console.log('\n你也可以先去 Git 里看 diff 来决定要不要切回原来版本；如果没有 git 我们再手动修');
} else {
  fixEncoding(process.argv[2]);
}
