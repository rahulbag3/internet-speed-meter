import { spawn, execFileSync } from 'node:child_process';
import { attachTarget } from './cdp.mjs';
import { APP_EXE, WINSHOT } from './paths.mjs';

const kill = () => { try { execFileSync('taskkill', ['/IM', 'InternetSpeedMeter.exe', '/F'], { stdio: 'ignore' }); } catch {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(label, variant) {
  kill(); await sleep(900);
  const p = spawn(APP_EXE, [], {
    stdio: 'ignore',
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9399' },
  });
  p.unref();
  const cdp = await attachTarget(9399, t => t.type === 'page' && t.url.includes('speed-meter'));
  await cdp.send('Runtime.enable');
  for (let i = 0; i < 80; i++) {
    if (await cdp.evaluate(`!!document.getElementById('v-pin')`).catch(() => false)) break;
    await sleep(250);
  }
  await cdp.evaluate(`document.getElementById('v-${variant}').click()`);
  await sleep(1500);
  await cdp.evaluate(`document.body.style.opacity='1'`);

  const info = execFileSync(WINSHOT, ['--title', 'Internet Speed Meter', '--out', 'verify/edge'], { encoding: 'utf8' });
  const [ox, oy] = /at \((\d+),(\d+)\)/.exec(/windowRect=[^\n]+/.exec(info)[0]).slice(1).map(Number);
  const geo = await cdp.evaluate(`(() => { const r = document.querySelector('.card').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, dpr: devicePixelRatio }; })()`);
  // CSS px -> physical px on screen
  const px = (cx, cy) => [ox + Math.round(cx * geo.dpr), oy + Math.round(cy * geo.dpr)];
  const cx = geo.x + geo.w / 2, cy = geo.y + geo.h / 2;

  const points = {
    'card centre': px(cx, cy),
    '20px left of card': px(geo.x - 20, cy),
    '20px right of card': px(geo.x + geo.w + 20, cy),
    '20px above card': px(cx, geo.y - 20),
    '20px below card': px(cx, geo.y + geo.h + 20),
    'card corner (in bbox, outside radius)': px(geo.x + 3, geo.y + 3),
  };

  console.log(`\n=== ${label}  card ${geo.w.toFixed(0)}x${geo.h.toFixed(0)} css ===`);
  for (const [name, [x, y]] of Object.entries(points)) {
    const hit = execFileSync(WINSHOT, ['--hit', `${x},${y}`, '--title', 'Internet Speed Meter'], { encoding: 'utf8' }).trim();
    const onApp = hit.includes('InternetSpeedMeter');
    // Only the centre should be opaque to the mouse; the bbox corner sits outside the
    // card's 28px radius, so the rounded plate must not cover it.
    const want = name === 'card centre';
    const ok = onApp === want;
    console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name.padEnd(38)} ${onApp ? 'app    ' : 'desktop'}  ${hit.split('proc=')[1] ?? hit}`);
  }
  cdp.close();
}

// Both measured in the 720x560 window: compact-in-a-large-window is the worst case for the
// invisible-plate problem, since the plate used to stay sized for the expanded card.
await run('compact card, expanded window', 'stack');
await run('expanded card, expanded window', 'side');
kill();
