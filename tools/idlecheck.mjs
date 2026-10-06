import { spawn, execFileSync } from 'node:child_process';
import { attachTarget } from './cdp.mjs';
import { APP_EXE, WINSHOT } from './paths.mjs';

const p = spawn(APP_EXE, [], {
  stdio: 'ignore',
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9376' },
});
p.unref();

const cdp = await attachTarget(9376, t => t.type === 'page' && t.url.includes('speed-meter'));
await cdp.send('Runtime.enable');
for (let i = 0; i < 80; i++) {
  if (await cdp.evaluate('!!document.querySelector(\'.card\')').catch(() => false)) break;
  await new Promise(r => setTimeout(r, 250));
}

const dim = () => cdp.evaluate('document.body.classList.contains(\'sm-dim\')');
const opacity = () => cdp.evaluate('getComputedStyle(document.body).opacity');
const sleep = ms => new Promise(r => setTimeout(r, ms));

await sleep(1200);
console.log(`t+1.2s (just loaded, no pointer)  dim=${await dim()}  opacity=${await opacity()}`);
await sleep(2600);
console.log(`t+3.8s (idle threshold passed)    dim=${await dim()}  opacity=${await opacity()}`);

// Hover: pointerenter on the card must wake it immediately.
await cdp.evaluate(`document.querySelector('.card').dispatchEvent(new PointerEvent('pointerenter', {bubbles:true}))`);
await sleep(120);
console.log(`after pointerenter                dim=${await dim()}  opacity=${await opacity()}`);

// Leave again, then confirm it recedes once more.
await cdp.evaluate(`document.querySelector('.card').dispatchEvent(new PointerEvent('pointerleave', {bubbles:true}))`);
await sleep(3600);
console.log(`after pointerleave + 3.6s         dim=${await dim()}  opacity=${await opacity()}`);

// Input must still reach the card while it is translucent.
const info = execFileSync(WINSHOT, ['--title', 'Internet Speed Meter', '--out', 'verify/dim2'], { encoding: 'utf8' });
const at = /at \((\d+),(\d+)\)/.exec(/windowRect=[^\n]+/.exec(info)[0]);
console.log(`hit-test while dim: ${execFileSync(WINSHOT, ['--hit', `${+at[1] + 324},${+at[2] + 252}`], { encoding: 'utf8' }).trim()}`);
execFileSync('taskkill', ['/IM', 'InternetSpeedMeter.exe', '/F'], { stdio: 'ignore' });
cdp.close();
