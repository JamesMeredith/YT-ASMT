const fs = require('fs');
const c = fs.readFileSync('E:/YT-ASMT/server/server.js', 'utf8');
const lines = c.split('\n');

// Find all lines with potential encoding issues
for (let i = 0; i < lines.length; i++) {
  // Look for sequences that look like double-encoded UTF-8 Chinese
  // These appear as: 芺 偣 涓嶅瓨鍦 etc.
  if (/[锟瀛鍦傜偣涓嶅瓨鍦宸ュ崟蹇呭～瀛舵鎻忚堪鑷冲皯璁惧鏈珨敞鍐岃鍏堢粦畾褰撳墠鐘舵€佷笉鍏佽姝ゆ搷浣滆В鍐虫柟瀹為檯缁戝畾鏈烘瀯鍗婁骇鍝佹煡璇㈡柟鏈嶅姟鍣ㄥ尯鍩熺綉璁块棶鏁嵎鎹婂彿浠ヤ笅鎿嶄綔鎴愬姛杩涜涓瘎鍔犱笟鍔℃棤鏉冩搷浣滄湭鐧诲綍鎴愬姛鍒涘缓宸叉柊澧炲凡鍒犻櫎鎻愪氦鏌ユ壘鍒颁笉瀛樺湪缁戝畾缁存姢淇℃伅瀹為檯鍑哄簱浠撳偍鐩稿叧鎺у埗鍣ㄦ枃浠堕尶鍒拌鎶ュ憡鍒涘缓杞交鎹㈠洖澶嶇粨鏉熸殏鏃村畾浣嶇淮鎶ょ敤纭鏀惰棰勮鏌ヤ簨浠舵棤鏁埚垎绫婚兘鏈変负鑷繁鎸囧畾绉绘氭枃浠跺湴鍧€瀹夎鎵ц鏇存柊瀵嗘爣绛捐涓氭鐘跺凡鍙傛暟]/.test(lines[i])) {
    console.log(`L${i+1}: ${lines[i].substring(0, 100)}`);
  }
}