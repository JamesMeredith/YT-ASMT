const fs = require('fs');
const c = fs.readFileSync('E:/YT-ASMT/server/server.js', 'utf8');
const lines = c.split('\n');

const corruptedChars = /[锟浇封套嫡兑夹帮扮封规号坏机几何几记件夹就练马马买吗没每美梦弥迷内妮暖欧片偏浦纤然溶润骚舍圣始丝似素她特腿外弯西锡习纤显险兴血呀言艳移盈涌右语原袁云载早泽知足组组足左]/;

// Also check for sequences of non-ASCII that look garbled
let bad = 0;
for (let i = 0; i < lines.length; i++) {
  // Skip comment lines (// comments with Chinese)
  const line = lines[i];
  if (corruptedChars.test(line)) {
    bad++;
    if (bad <= 20) {
      // Find the actual corrupted characters
      const chars = [];
      for (const ch of line) {
        if (ch.charCodeAt(0) > 0x7F && !/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef\u2018-\u201f\u300a-\u300f\u3010-\u301f\u2014\u2019]/.test(ch)) {
          chars.push(ch);
        }
      }
      console.log(`L${i+1}: ${line.substring(0, 100)}`);
      if (chars.length > 0) console.log(`  bad chars: ${chars.slice(0,20).join('')}`);
    }
  }
}
console.log(`\nTotal bad lines: ${bad}`);

// Also check if there are obvious broken error messages (short garbled strings in JS strings)
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  // Look for patterns like: '锟? or '绻? or similar - single quote followed by garbled chars
  const m = line.match(/:\s*'([^']{2,5})'\s*[;,)]/);
  if (m && corruptedChars.test(m[1])) {
    console.log(`L${i+1} garbled error msg: '${m[1]}'`);
  }
}
