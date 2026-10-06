import { mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { attachTarget } from './cdp.mjs';
import { APP_EXE } from './paths.mjs';

// Page captures, not screen grabs: nothing outside the card can leak into a public asset.
mkdirSync('docs', { recursive: true });

// --no-live keeps the seeded values on screen; otherwise the next one-second sample
// overwrites them and the preview is a card reading 0.0.
const p = spawn(APP_EXE, ['--no-live'], {
  stdio: 'ignore',
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9374' },
});
p.unref();

const cdp = await attachTarget(9374, t => t.type === 'page' && t.url.includes('speed-meter'));
await cdp.send('Runtime.enable');
for (let i = 0; i < 80; i++) {
  if (await cdp.evaluate('!!document.querySelector(\'.card\')').catch(() => false)) break;
  await new Promise(r => setTimeout(r, 250));
}
const setMode = async v => {
  await cdp.evaluate(`document.getElementById('v-${v}').click()`);
  await new Promise(r => setTimeout(r, 1200));
};

// A believable populated state so the preview is not an empty card. Applied after each mode
// switch, because changing layout rebuilds the dot grid.
const seed = () => cdp.evaluate(`(() => {
  const put = (id, text) => document.getElementById(id).textContent = text;
  put('dl', '118'); put('up', '14');
  document.getElementById('status').textContent = 'Updated 4:13 PM';
  const light = (grid, n) => Array.from(grid.children).forEach((d, i) =>
    d.classList.toggle('on', i >= grid.children.length - n));
  light(document.getElementById('dots-dl'), 84);
  light(document.getElementById('dots-up'), 10);
})()`);

await setMode('side');
await seed();
await new Promise(r => setTimeout(r, 400));
await cdp.screenshot('docs/preview.png');
await setMode('stack');
await seed();
await new Promise(r => setTimeout(r, 400));
await cdp.screenshot('docs/preview-compact.png');
console.log('wrote docs/preview.png and docs/preview-compact.png');
cdp.close();
