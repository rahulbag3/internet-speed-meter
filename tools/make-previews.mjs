import { mkdirSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { attachTarget } from './cdp.mjs';
import { APP_EXE } from './paths.mjs';

// Page captures, not screen grabs: nothing outside the card can leak into a public asset.
mkdirSync('docs', { recursive: true });
const PORT = 9374;

const kill = () => { try { execFileSync('taskkill', ['/IM', 'InternetSpeedMeter.exe', '/F'], { stdio: 'ignore' }); } catch {} };
kill();
await new Promise(r => setTimeout(r, 900));

// --no-live keeps the seeded values on screen; otherwise the next one-second sample
// overwrites them and the preview is a card reading 0.0.
const p = spawn(APP_EXE, ['--no-live'], {
  stdio: 'ignore',
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
});
p.unref();

const cdp = await attachTarget(PORT, t => t.type === 'page' && t.url.includes('speed-meter'));
await cdp.send('Runtime.enable');
for (let i = 0; i < 80; i++) {
  if (await cdp.evaluate(`!!document.getElementById('v-pin')`).catch(() => false)) break;
  await new Promise(r => setTimeout(r, 250));
}

// Remember what the person using this app had chosen; the preview run shares the same
// WebView2 profile, so leaving it pinned or compact would silently change their setup.
const stored = await cdp.evaluate(`({ variant: document.body.dataset.v, topmost: localStorage.getItem('sm-topmost') })`);

const setMode = async v => {
  await cdp.evaluate(`document.getElementById('v-${v}').click()`);
  await new Promise(r => setTimeout(r, 1300));
};
const seed = () => cdp.evaluate(`(() => {
  const put = (id, text) => document.getElementById(id).textContent = text;
  put('dl', '118'); put('up', '14');
  document.getElementById('status').textContent = 'Updated 4:13 PM';
  const light = (grid, n) => Array.from(grid.children).forEach((d, i) =>
    d.classList.toggle('on', i >= grid.children.length - n));
  light(document.getElementById('dots-dl'), 84);
  light(document.getElementById('dots-up'), 10);
})()`);
// Inline opacity outranks the idle .sm-dim class, so the preview is never half faded.
const pin = () => cdp.evaluate(`document.body.style.opacity = '1'`);
const wait = ms => new Promise(r => setTimeout(r, ms));
// Set the pin state explicitly: the persisted value may already be on, and a blind click
// would then switch it off and produce a preview with a dead LED.
const setPin = async on => {
  const now = await cdp.evaluate(`document.getElementById('v-pin').getAttribute('aria-pressed') === 'true'`);
  if (now !== on) await cdp.evaluate(`document.getElementById('v-pin').click()`);
  await wait(700);
};

await setPin(true);   // show the LED lit
await setMode('side');
await seed(); await pin(); await wait(400);
await cdp.screenshot('docs/preview.png');

await setMode('stack');
await seed(); await pin(); await wait(400);
await cdp.screenshot('docs/preview-compact.png');
console.log('wrote docs/preview.png and docs/preview-compact.png');

// Leave the app in a clean resting state. Clicking the pin persists unpinned, and the layout
// click persists expanded, so the next manual launch opens the way it was before this run.
await setPin(false);
await setMode('side');
cdp.close();

kill();
await new Promise(r => setTimeout(r, 900));
const relaunch = spawn(APP_EXE, [], { stdio: 'ignore', detached: true });
relaunch.unref();
console.log('restarted the app: expanded layout, not pinned');
