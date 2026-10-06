import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchAppWindow, fitViewport, attachTarget, cleanup } from './cdp.mjs';
import { __smSnapshot, __smAnim, __smRunTest } from './measure-page.js';
import { ROOT, APP_EXE, APP_HTML, WINSHOT, requireReference } from './paths.mjs';

// Resolved lazily: `node tools/verify.mjs app` works without the external reference present.
const refUrl = () => pathToFileURL(requireReference()).href;
const APP_PORT = 9333;
// Physical-pixel comparisons need the same raster density as the reference window, so the
// suite can pin the app to 1:1 scale; layout is zoom-invariant either way.
const APP_ARGS = [
  ...(process.argv.includes('--scale=1') ? ['--scale=1'] : []),
  // Live traffic would put real numbers where the reference shows its em-dash placeholder,
  // so the 1:1 card comparison runs with it off. See tools/livetest.mjs for live coverage.
  '--no-live',
];
const OUT = path.join(ROOT, 'verify');

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * A WebView2 CDP session initially points at the control's about:blank document; the real
 * page only becomes reachable a second or two later, so fixed sleeps race with it.
 */
async function waitForCard(cdp, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await cdp
      .evaluate(`!!document.querySelector('.card') && document.readyState === 'complete'`)
      .catch(() => false);
    if (ready) return true;
    await sleep(250);
  }
  throw new Error('card never became reachable over CDP');
}
const snap = `(${__smSnapshot.toString()})()`;
const anim = (t, ms) => `(${__smAnim.toString()})('${t}',${ms})`;
const runTest = ms => `(${__smRunTest.toString()})(${ms})`;

// ---------------------------------------------------------------- collection

async function collect(cdp, dir, { stackedStart, screenshot = true }) {
  mkdirSync(dir, { recursive: true });
  const out = {};

  const toSide = async () => {
    if (await cdp.evaluate(`document.body.dataset.v`) === 'side') return;
    await cdp.evaluate(`document.getElementById('v-side').click()`);
    await sleep(700);
  };
  const toStack = async () => {
    if (await cdp.evaluate(`document.body.dataset.v`) === 'stack') return;
    await cdp.evaluate(`document.getElementById('v-stack').click()`);
    await sleep(700);
  };

  if (stackedStart) await toStack(); else await toSide();
  out.side = await cdp.evaluate(snap);
  if (screenshot) await cdp.screenshot(path.join(dir, 'side.png'));

  await toStack();
  out.stack = await cdp.evaluate(snap);
  if (screenshot) await cdp.screenshot(path.join(dir, 'stack.png'));

  // Repeat each transition: rAF sampling jitters by a frame, so the median is what
  // actually describes the timing.
  out.anims = { sideToStack: [], stackToSide: [] };
  for (let i = 0; i < 3; i++) {
    await toSide(); await sleep(150);
    out.anims.sideToStack.push(await cdp.evaluate(anim('stack', 650), { awaitPromise: true }));
    await toStack(); await sleep(150);
    out.anims.stackToSide.push(await cdp.evaluate(anim('side', 650), { awaitPromise: true }));
  }
  out.variantAfterAnims = await cdp.evaluate(`document.body.dataset.v`);

  writeFileSync(path.join(dir, 'dump.json'), JSON.stringify(out, null, 2));
  return out;
}

async function runHtml() {
  const port = 9301;
  const cdp = await launchAppWindow({
    port,
    url: refUrl(),
    width: Math.round(720 * 1.5) + 20,
    height: Math.round(560 * 1.5) + 90,
  });
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    const fit = await fitViewport(cdp, 720, 560);
    console.log('reference window viewport:', JSON.stringify(fit),
      'dpr=', await cdp.evaluate('devicePixelRatio'));
    await sleep(400);
    const baseline = await collect(cdp, path.join(OUT, 'html'), { stackedStart: false });

    // Same harness against our own copy of the HTML, to prove the asset never drifted.
    await cdp.evaluate(`location.replace(${JSON.stringify(pathToFileURL(APP_HTML).href)})`);
    await sleep(900);
    const copy = await collect(cdp, path.join(OUT, 'copy'), { stackedStart: false });
    return { baseline, copy };
  } finally {
    cleanup(cdp);
  }
}

async function runApp({ test = false } = {}) {
  const { spawn } = await import('node:child_process');
  spawn(APP_EXE, APP_ARGS, {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${APP_PORT} --disable-background-timer-throttling` },
  }).unref();

  const cdp = await attachTarget(APP_PORT, t => t.type === 'page' && t.url.includes('speed-meter'));
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await waitForCard(cdp);
    const meta = await cdp.evaluate(`({innerWidth, innerHeight, devicePixelRatio, url: location.href})`);
    console.log('app viewport:', JSON.stringify(meta));
    const dir = path.join(OUT, 'app');
    const res = await collect(cdp, dir, { stackedStart: false, screenshot: true });
    if (test) {
      console.log('running a real speed test inside the app…');
      const r = await cdp.evaluate(runTest(90000), { awaitPromise: true, timeoutMs: 120000 });
      writeFileSync(path.join(dir, 'live-test.json'), JSON.stringify(r, null, 2));
      await cdp.screenshot(path.join(dir, 'after-live-test.png'));
      console.log(JSON.stringify(r.end));
    }
    return res;
  } finally {
    cdp.close();
  }
}

// ------------------------------------------------------------------- easing

/** Inverse of the x(t) curve of cubic-bezier(x1,y1,x2,y2), sampled as y(f). */
function bezierEase(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = t => ((ax * t + bx) * t + cx) * t;
  const dfx = t => (3 * ax * t + 2 * bx) * t + cx;
  return f => {
    let t = f;
    for (let i = 0; i < 8; i++) {
      const e = fx(t) - f;
      const d = dfx(t);
      if (Math.abs(e) < 1e-7 || d === 0) break;
      t -= e / d;
    }
    t = Math.min(1, Math.max(0, t));
    return ((ay * t + by) * t + cy) * t;
  };
}

const EASE = bezierEase(0.22, 1, 0.36, 1);
const DUR = 450;
const MARKS = [0.1, 0.25, 0.5, 0.75, 0.9, 0.99];

/** Normalised progress of the card width across each sampled frame. */
function progressCurve(animRes) {
  const frames = animRes.frames;
  if (!frames.length) return null;
  const w0 = frames[0].card.w;
  const w1 = frames[frames.length - 1].card.w;
  const span = w1 - w0;
  return frames.map(f => ({
    t: f.t,
    p: span === 0 ? 1 : (f.card.w - w0) / span,
    card: f.card, dl: f.dl, up: f.up, ft: f.ft,
  }));
}

/** ms at which the transition passes a given normalised progress, interpolated between frames. */
function markTime(curve, m) {
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1], b = curve[i];
    if (a.p < m && b.p >= m) {
      const k = b.p === a.p ? 0 : (m - a.p) / (b.p - a.p);
      return a.t + (b.t - a.t) * k;
    }
  }
  return null;
}

/** The frame whose progress is closest to m — used to compare positions independent of timing. */
function frameAtProgress(curve, m) {
  return curve.reduce((best, f) => Math.abs(f.p - m) < Math.abs(best.p - m) ? f : best, curve[0]);
}

function easingFit(curve) {
  const pts = curve.filter(c => c.t >= 0 && c.t <= DUR);
  const errs = pts.map(c => c.p - EASE(c.t / DUR));
  return {
    frames: pts.length,
    maxErr: Math.max(...errs.map(Math.abs)),
    rmsErr: Math.sqrt(errs.reduce((a, e) => a + e * e, 0) / (errs.length || 1)),
    settleMs: curve.find(c => Math.abs(c.p - 1) < 0.002)?.t ?? null,
  };
}

const median = xs => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[(v.length - 1) >> 1] : NaN;
};

function compareAnim(name, runsA, runsB, out) {
  const A = runsA.map(progressCurve).filter(Boolean);
  const B = runsB.map(progressCurve).filter(Boolean);
  out.push(`\n## ${name}  (${A.length} reference runs vs ${B.length} app runs)`);

  let bad = 0;
  for (const m of MARKS) {
    const ta = median(A.map(c => markTime(c, m)));
    const tb = median(B.map(c => markTime(c, m)));
    const d = tb - ta;
    if (Math.abs(d) > 25) bad++;
    out.push(`  ${String(m * 100).padStart(2)}% of resize: reference ${ta.toFixed(0)}ms  app ${tb.toFixed(0)}ms  Δ${d >= 0 ? '+' : ''}${d.toFixed(0)}ms`);
  }
  const fa = median(A.map(c => easingFit(c).maxErr));
  const fb = median(B.map(c => easingFit(c).maxErr));
  out.push(`  deviation from cubic-bezier(.22,1,.36,1): reference ${(fa * 100).toFixed(1)}% max, app ${(fb * 100).toFixed(1)}% max`);
  out.push(`  settle: reference ${median(A.map(c => easingFit(c).settleMs)).toFixed(0)}ms, app ${median(B.map(c => easingFit(c).settleMs)).toFixed(0)}ms`);

  out.push(`  element positions at matched progress (reference -> app):`);
  for (const m of MARKS) {
    const a = frameAtProgress(medianCurve(A), m), b = frameAtProgress(medianCurve(B), m);
    const d = (x, y) => Math.abs(x - y).toFixed(1);
    out.push(`    p=${String(m * 100).padStart(2)}%  card.w ${a.card.w.toFixed(1)}→${b.card.w.toFixed(1)} (Δ${d(a.card.w, b.card.w)})  `
      + `card.x ${a.card.x.toFixed(1)}→${b.card.x.toFixed(1)} (Δ${d(a.card.x, b.card.x)})  `
      + `dl.y ${a.dl.y.toFixed(1)}→${b.dl.y.toFixed(1)} (Δ${d(a.dl.y, b.dl.y)})  `
      + `dl.h ${a.dl.h.toFixed(1)}→${b.dl.h.toFixed(1)} (Δ${d(a.dl.h, b.dl.h)})  `
      + `ft.y ${a.ft.y.toFixed(1)}→${b.ft.y.toFixed(1)} (Δ${d(a.ft.y, b.ft.y)})`);
    if (Math.abs(a.card.w - b.card.w) > 3 || Math.abs(a.dl.y - b.dl.y) > 3) bad++;
  }
  return bad;
}

/** Median curve across runs, resampled onto run[0]'s timestamps. */
function medianCurve(curves) {
  const base = curves[0];
  return base.map((f, i) => {
    const at = c => c[Math.min(i, c.length - 1)];
    return {
      t: f.t,
      p: median(curves.map(c => at(c).p)),
      card: { x: median(curves.map(c => at(c).card.x)), w: median(curves.map(c => at(c).card.w)), h: median(curves.map(c => at(c).card.h)) },
      dl: { y: median(curves.map(c => at(c).dl.y)), h: median(curves.map(c => at(c).dl.h)) },
      ft: { y: median(curves.map(c => at(c).ft.y)) },
    };
  });
}

// --------------------------------------------------------------------- diff

function walk(a, b, p, out, tol) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > tol) out.push(`${p}: ${a} -> ${b}  (Δ${(b - a).toFixed(2)})`);
    return;
  }
  // Computed styles arrive as strings ("442.062px", "54.3px 10px"); page zoom rounds them in
  // the last decimal, so compare their numbers with tolerance or every sub-pixel value reads
  // as a regression.
  if (typeof a === 'string' && typeof b === 'string') {
    const shape = s => s.replace(/-?[\d.]+/g, '#');
    const na = a.match(/-?[\d.]+/g), nb = b.match(/-?[\d.]+/g);
    if (na?.length && shape(a) === shape(b)) {
      const worst = na.reduce((m, v, i) => Math.max(m, Math.abs(parseFloat(v) - parseFloat(nb[i]))), 0);
      if (worst > tol) out.push(`${p}: ${a} -> ${b}  (Δ${worst.toFixed(3)})`);
      return;
    }
    if (a !== b) out.push(`${p}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    return;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (a !== b) out.push(`${p}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    return;
  }
  if (Array.isArray(a) !== Array.isArray(b)) { out.push(`${p}: array/object mismatch`); return; }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (!(k in a)) { out.push(`${p}.${k}: MISSING in baseline`); continue; }
    if (!(k in b)) { out.push(`${p}.${k}: MISSING in app`); continue; }
    walk(a[k], b[k], `${p}.${k}`, out, k === 't' ? 40 : tol);
  }
}

function compareState(name, a, b, out) {
  const diffs = [];
  walk(a, b, '', diffs, 0.5);
  out.push(`\n## ${name}: ${diffs.length ? diffs.length + ' difference(s)' : 'identical'}`);
  out.push(...diffs.map(d => '  ' + d));
  return diffs.length;
}

function diffAll() {
  const read = p => existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
  const html = read(path.join(OUT, 'html', 'dump.json'));
  const copy = read(path.join(OUT, 'copy', 'dump.json'));
  const app = read(path.join(OUT, 'app', 'dump.json'));
  if (!html || !app) throw new Error('run `html` and `app` first');

  const strip = o => { const c = structuredClone(o); delete c.meta; return c; };
  const out = [];
  let bad = 0;

  out.push('# Reference HTML vs the HTML reference itself');
  out.push(`  reference page:  ${html.side.meta.url}`);
  out.push(`  app asset page:  ${copy?.side.meta.url}`);
  bad += compareState('side', strip(html.side), strip(copy?.side), out);
  bad += compareState('stack', strip(html.stack), strip(copy?.stack), out);
  bad += compareAnim('side -> stack', html.anims.sideToStack, copy?.anims.sideToStack, out);

  out.push('\n# App (WebView2) vs HTML reference');
  out.push(`  app page: ${app.side.meta.url}  viewport ${app.side.meta.innerWidth}x${app.side.meta.innerHeight} @ ${app.side.meta.devicePixelRatio}dpr`);
  out.push(`  ref page: ${html.side.meta.url}  viewport ${html.side.meta.innerWidth}x${html.side.meta.innerHeight} @ ${html.side.meta.devicePixelRatio}dpr`);
  for (const key of ['side', 'stack']) {
    bad += compareState(key, strip(html[key]), strip(app[key]), out);
  }
  bad += compareAnim('side -> stack', html.anims.sideToStack, app.anims.sideToStack, out);
  bad += compareAnim('stack -> side', html.anims.stackToSide, app.anims.stackToSide, out);

  const text = out.join('\n');
  writeFileSync(path.join(OUT, 'diff.txt'), text);
  console.log(text);
  console.log(`\n${bad ? bad + ' check(s) reported differences' : 'ALL CHECKS CLEAN'}`);
  return bad;
}

// ---------------------------------------------------------- on-screen windows


function shot(pid, dir, crop) {
  mkdirSync(dir, { recursive: true });
  const argv = ['--title', 'Internet Speed Meter', '--pid', String(pid), '--out', dir];
  if (crop) argv.push('--crop', crop.join(','));
  const txt = execFileSync(WINSHOT, argv, { encoding: 'utf8' });
  console.log(txt.trim().split('\n').filter(l => /Awareness|dpi=|client=/.test(l)).map(l => '    ' + l).join('\n'));
  const m = /client=(\d+)x(\d+)/.exec(txt);
  return { file: path.join(dir, 'client.png'), client: m ? { w: +m[1], h: +m[2] } : null };
}

function killApp() {
  execFileSync('taskkill', ['/IM', 'InternetSpeedMeter.exe', '/F'], { stdio: 'ignore' });
}

/** Compare the two windows as the desktop compositor actually paints them. */
async function onscreen() {
  const { spawn } = await import('node:child_process');
  const cardBox = `(() => { const b = document.querySelector('.card').getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height, dpr: devicePixelRatio, ih: innerHeight }; })()`;

  const cdp = await launchAppWindow({
    port: 9306, url: refUrl(), width: 1120, height: 960,
  });
  let refShot;
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    console.log('reference fitted:', JSON.stringify(await fitViewport(cdp, 720, 560)));
    await sleep(900);
    const geo = await cdp.evaluate(cardBox);
    const probe = shot(cdp.proc.pid, path.join(OUT, 'ref-window'));
    // Chrome's --app title bar lives inside the client area, so shift the crop past it.
    const stripY = probe.client.h - Math.round(geo.ih * geo.dpr);
    console.log(`  reference web surface starts ${stripY}px below the client top`);
    refShot = shot(cdp.proc.pid, path.join(OUT, 'ref-window'),
      [Math.round(geo.x * geo.dpr), Math.round(geo.y * geo.dpr) + stripY,
        Math.round(geo.w * geo.dpr), Math.round(geo.h * geo.dpr)]).file;
  } finally {
    cleanup(cdp);
  }
  await sleep(700);

  try { killApp(); } catch {}
  await sleep(500);
  const app = spawn(APP_EXE, APP_ARGS, {
    stdio: 'ignore',
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${APP_PORT}` },
  });
  app.unref();
  const appCdp = await attachTarget(APP_PORT, t => t.type === 'page' && t.url.includes('speed-meter'));
  await appCdp.send('Runtime.enable');
  await waitForCard(appCdp);
  if (await appCdp.evaluate('document.body.dataset.v') !== 'side') {
    await appCdp.evaluate(`document.getElementById('v-side').click()`);
    await sleep(800);
  }
  const geo = await appCdp.evaluate(cardBox);
  appCdp.close();
  const appShot = shot(app.pid, path.join(OUT, 'app-window-live'),
    [Math.round(geo.x * geo.dpr), Math.round(geo.y * geo.dpr),
      Math.round(geo.w * geo.dpr), Math.round(geo.h * geo.dpr)]).file;

  console.log('\n=== on-screen card comparison (what the display actually shows) ===');
  console.log(execFileSync(WINSHOT, ['--diff', refShot, appShot], { encoding: 'utf8' }));
}

// ------------------------------------------------------- compact launcher mode

const stripMeta = o => { const c = structuredClone(o); delete c.meta; return c; };

/** "Internet Speed Meter (Stacked).bat" parity: 560x420 viewport, compact card. */
async function stackMode() {
  const { spawn } = await import('node:child_process');

  const cdp = await launchAppWindow({
    port: 9307, url: refUrl() + '?v=stack', width: 900, height: 720,
  });
  let ref, refPng;
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    console.log('reference fitted:', JSON.stringify(await fitViewport(cdp, 560, 420)));
    await sleep(700);
    ref = await cdp.evaluate(snap);
    refPng = path.join(OUT, 'stack-ref-560.png');
    await cdp.screenshot(refPng);
  } finally {
    cleanup(cdp);
  }
  writeFileSync(path.join(OUT, 'stack-ref.json'), JSON.stringify(ref, null, 2));
  await sleep(700);

  try { killApp(); } catch {}
  await sleep(400);
  const app = spawn(APP_EXE, ['--stack', ...APP_ARGS], {
    stdio: 'ignore',
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${APP_PORT}` },
  });
  app.unref();
  const a = await attachTarget(APP_PORT, t => t.type === 'page' && t.url.includes('speed-meter'));
  await a.send('Page.enable');
  await a.send('Runtime.enable');
  await waitForCard(a);
  const act = await a.evaluate(snap);
  const actPng = path.join(OUT, 'stack-app-560.png');
  await a.screenshot(actPng);
  a.close();
  writeFileSync(path.join(OUT, 'stack-app.json'), JSON.stringify(act, null, 2));

  console.log(`  app viewport: ${act.meta.innerWidth}x${act.meta.innerHeight} @ ${act.meta.devicePixelRatio}dpr  url=${act.meta.url}`);
  const diffs = [];
  walk(stripMeta(ref), stripMeta(act), '', diffs, 0.5);
  console.log(`\n=== compact mode: app vs reference (${diffs.length ? diffs.length + ' difference(s)' : 'identical'}) ===`);
  console.log(diffs.map(d => '  ' + d).join('\n'));
  console.log(execFileSync(WINSHOT, ['--diff', refPng, actPng], { encoding: 'utf8' }));
  return diffs.length;
}

// ----------------------------------------------------------- responsive sizes

/** Same viewports on both surfaces, to confirm no app-specific layout divergence. */
const SIZES = [[440, 700], [520, 620], [640, 560], [700, 560], [720, 560], [900, 700]];

async function responsive() {
  const { spawn } = await import('node:child_process');
  const metrics = { deviceScaleFactor: 1.5, mobile: false };

  const probe = async (cdp, sizes) => {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await waitForCard(cdp);
    const out = {};
    for (const [w, h] of sizes) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { ...metrics, width: w, height: h });
      await sleep(450);
      // The app persists the last mode (localStorage), so pin both surfaces to one mode.
      await cdp.evaluate(`document.getElementById('v-side').click()`);
      await sleep(700);
      out[`${w}x${h}`] = await cdp.evaluate(snap);
    }
    return out;
  };

  const cdp = await launchAppWindow({ port: 9308, url: refUrl(), width: 1120, height: 960 });
  let ref;
  try { ref = await probe(cdp, SIZES); } finally { cleanup(cdp); }
  await sleep(700);
  try { killApp(); } catch {}
  await sleep(400);

  const app = spawn(APP_EXE, APP_ARGS, {
    stdio: 'ignore',
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${APP_PORT}` },
  });
  app.unref();
  const a = await attachTarget(APP_PORT, t => t.type === 'page' && t.url.includes('speed-meter'));
  const act = await probe(a, SIZES);
  a.close();

  writeFileSync(path.join(OUT, 'responsive.json'), JSON.stringify({ ref, app: act }, null, 2));
  let bad = 0;
  for (const key of Object.keys(ref)) {
    const diffs = [];
    walk(stripMeta(ref[key]), stripMeta(act[key]), '', diffs, 0.5);
    bad += diffs.length;
    const card = act[key].card.rect;
    console.log(`${key.padStart(8)}  variant=${act[key].meta.variant}  card ${card.w}x${card.h} at (${card.x},${card.y})  ${diffs.length ? diffs.length + ' DIFF(S)' : 'identical'}`);
    diffs.slice(0, 6).forEach(d => console.log('           ' + d));
  }
  console.log(bad ? `\n${bad} responsive difference(s)` : '\nresponsive behaviour identical at every size');
  return bad;
}

// --------------------------------------------------------------------- main

const cmd = process.argv[2] ?? 'all';
mkdirSync(OUT, { recursive: true });
if (cmd === 'html') await runHtml();
else if (cmd === 'app') await runApp({ test: process.argv.includes('--test') });
else if (cmd === 'diff') diffAll();
else if (cmd === 'onscreen') await onscreen();
else if (cmd === 'stack') await stackMode();
else if (cmd === 'responsive') await responsive();
else if (cmd === 'all') { await runHtml(); await runApp({ test: process.argv.includes('--test') }); diffAll(); }
else throw new Error('unknown command ' + cmd);
