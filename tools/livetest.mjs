import { spawn } from 'node:child_process';
import { attachTarget } from './cdp.mjs';
import { APP_EXE as exe } from './paths.mjs';
const p = spawn(exe, [], {
  stdio: 'ignore',
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9371' },
});
p.unref();

const cdp = await attachTarget(9371, t => t.type === 'page' && t.url.includes('speed-meter'));
await cdp.send('Runtime.enable');
for (let i = 0; i < 80; i++) {
  if (await cdp.evaluate('!!document.querySelector(\'.card\')').catch(() => false)) break;
  await new Promise(r => setTimeout(r, 250));
}

const READ = `(() => {
  const grid = id => {
    const g = document.getElementById(id);
    const cols = getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length;
    const rows = Math.ceil(g.children.length / cols);
    const out = [];
    for (let r = 0; r < rows; r++) {
      let line = '';
      for (let c = 0; c < cols; c++) line += g.children[r * cols + c].classList.contains('on') ? '#' : '.';
      out.push(line);
    }
    return out.join('|');
  };
  return { dl: document.getElementById('dl').textContent + ' ' + document.querySelector('#t-dl .unit').textContent,
    up: document.getElementById('up').textContent + ' ' + document.querySelector('#t-up .unit').textContent,
    status: document.getElementById('status').textContent,
    disabled: document.getElementById('retest').disabled,
    grid: grid('dots-dl'), gridUp: grid('dots-up') };
})()`;

const read = () => cdp.evaluate(READ);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const show = (label, s) => {
  console.log(`${label}  dl=${s.dl} up=${s.up}  status="${s.status}"`);
  const dl = s.grid.split('|'), up = s.gridUp.split('|');
  for (let i = 0; i < Math.max(dl.length, up.length); i++) {
    console.log('   dl ' + (dl[i] ?? '').padEnd(12) + ' | up ' + (up[i] ?? ''));
  }
};

await sleep(3000);
// The dot grid only exists in the expanded layout (the reference hides it in compact mode).
await cdp.evaluate(`document.getElementById('v-side').click()`);
await sleep(1200);
show('IDLE (live should be driving the readout)', await read());

await cdp.evaluate(`document.getElementById('retest').click()`);
console.log('\nbenchmark running; display is benchmark-owned\n');
let s = await read();
for (let i = 0; i < 75 && s.disabled; i++) { await sleep(1000); s = await read(); }
show('BENCHMARK RESULT', s);

for (const gap of [4000, 3000, 3000, 4000]) {
  await sleep(gap);
  show('live history scrolling out', await read());
}

await cdp.screenshot('verify/live-tracked.png');
cdp.close();
