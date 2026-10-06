import { spawn, execFileSync } from 'node:child_process';
import { attachTarget } from './cdp.mjs';
import { APP_EXE, WINSHOT } from './paths.mjs';

const p = spawn(APP_EXE, [], {
  stdio: 'ignore',
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9377' },
});
p.unref();

const cdp = await attachTarget(9377, t => t.type === 'page' && t.url.includes('speed-meter'));
await cdp.send('Runtime.enable');
for (let i = 0; i < 80; i++) {
  if (await cdp.evaluate('!!document.querySelector(\'.card\')').catch(() => false)) break;
  await new Promise(r => setTimeout(r, 250));
}
await new Promise(r => setTimeout(r, 1200));
await cdp.evaluate(`document.body.style.opacity = '1'`);

const info = execFileSync(WINSHOT, ['--title', 'Internet Speed Meter', '--out', 'verify/pin'], { encoding: 'utf8' });
const at = /at \((\d+),(\d+)\)/.exec(/windowRect=[^\n]+/.exec(info)[0]);
const [ox, oy] = [+at[1], +at[2]];
const dpr = await cdp.evaluate('devicePixelRatio');

const geom = await cdp.evaluate(`(() => {
  const b = document.getElementById('v-pin'), t = document.querySelector('.tools');
  const r = b.getBoundingClientRect(), tr = t.getBoundingClientRect();
  return { pressed: b.getAttribute('aria-pressed'), label: b.getAttribute('aria-label'),
    btn: [r.x, r.y, r.width, r.height].map(n => +n.toFixed(2)),
    tools: [tr.x, tr.y, +tr.width.toFixed(2), +tr.height.toFixed(2)],
    firstChildIsPin: t.firstElementChild === b,
    led: (() => { const l = getComputedStyle(b.querySelector('.led')); return l.backgroundColor + ' ' + l.boxShadow; })() };
})()`);
console.log('button:', JSON.stringify(geom));

const cx = ox + Math.round((geom.btn[0] + geom.btn[2] / 2) * dpr);
const cy = oy + Math.round((geom.btn[1] + geom.btn[3] / 2) * dpr);
// Click through CDP input rather than winshot --clickat: that helper has to raise the window
// and then restore its previous z-order, which would undo a topmost toggle the moment it tests.
const clickPin = async () => {
  const [x, y] = [geom.btn[0] + geom.btn[2] / 2, geom.btn[1] + geom.btn[3] / 2];
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
};

execFileSync(WINSHOT, ['--title', 'Internet Speed Meter', '--out', 'verify/pin', '--screen'], { stdio: 'ignore' });
console.log('\n--- unpinned (fresh state) ---');
console.log(execFileSync(WINSHOT, ['--ztest', 'Qoder', '--title', 'Internet Speed Meter'], { encoding: 'utf8' }).trim());

clickPin();
await new Promise(r => setTimeout(r, 1200));
console.log('\n--- after a real click on the pin button ---');
console.log('aria-pressed:', await cdp.evaluate(`document.getElementById('v-pin').getAttribute('aria-pressed')`),
  '| stored:', await cdp.evaluate(`localStorage.getItem('sm-topmost')`));
console.log(execFileSync(WINSHOT, ['--ztest', 'Qoder', '--title', 'Internet Speed Meter'], { encoding: 'utf8' }).trim());
execFileSync(WINSHOT, ['--title', 'Internet Speed Meter', '--out', 'verify/pin/on', '--screen'], { stdio: 'ignore' });

clickPin();
await new Promise(r => setTimeout(r, 1200));
console.log('\n--- clicked again (unpin) ---');
console.log('aria-pressed:', await cdp.evaluate(`document.getElementById('v-pin').getAttribute('aria-pressed')`),
  '| stored:', await cdp.evaluate(`localStorage.getItem('sm-topmost')`));
console.log(execFileSync(WINSHOT, ['--ztest', 'Qoder', '--title', 'Internet Speed Meter'], { encoding: 'utf8' }).trim());
cdp.close();
