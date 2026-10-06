import { spawn, execFileSync } from 'node:child_process';
import { attachTarget } from './cdp.mjs';
import { WINSHOT } from './paths.mjs';
const cdp = await attachTarget(9378, t => t.type === 'page' && t.url.includes('speed-meter')).catch(async () => {
  const p = spawn('C:/Users/Rahul/Documents/Qoder/2026-10-05/c2a8740b/bin/Release/net8.0-windows/InternetSpeedMeter.exe', [], { stdio: 'ignore', env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9378' } });
  p.unref();
  return attachTarget(9378, t => t.type === 'page' && t.url.includes('speed-meter'));
});
await cdp.send('Runtime.enable');
for (let i=0;i<60;i++){ if (await cdp.evaluate(`!!document.getElementById('v-pin')`).catch(()=>false)) break; await new Promise(r=>setTimeout(r,250)); }
await cdp.evaluate(`document.getElementById('v-pin').click()`);
await new Promise(r=>setTimeout(r,900));
console.log('pinned:', await cdp.evaluate(`document.getElementById('v-pin').getAttribute('aria-pressed')`), 'stored:', await cdp.evaluate(`localStorage.getItem('sm-topmost')`));
cdp.close();
