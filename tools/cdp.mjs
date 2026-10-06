import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.listeners = new Map();
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null) {
        const p = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (!p) return;
        if (msg.error) p.reject(new Error(msg.method + ': ' + JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
        for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params);
      }
    });
  }

  static async connect(url) {
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', rej, { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  async once(method, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for ' + method)), timeoutMs);
      this.on(method, params => { clearTimeout(timer); resolve(params); });
    });
  }

  async evaluate(expression, { awaitPromise = false, timeoutMs = 60000 } = {}) {
    const res = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise, timeout: timeoutMs,
    });
    if (res.exceptionDetails) {
      throw new Error('page exception: ' + JSON.stringify(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text));
    }
    return res.result.value;
  }

  async screenshot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(data, 'base64'));
    return file;
  }

  close() { try { this.ws.close(); } catch {} }
}

/** Launch headless Chrome with a debug port and attach to its first page target. */
export async function launchHeadless({ port, startUrl = 'about:blank' }) {
  const userData = mkdtempSync(path.join(tmpdir(), 'sm-chrome-'));
  const proc = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-features=Translate',
    startUrl,
  ], { stdio: 'ignore' });
  proc.on('exit', code => { if (code) console.error(`chrome exited ${code}`); });

  const cdp = await waitTarget(port, t => t.type === 'page');
  cdp.userData = userData;
  cdp.proc = proc;
  return cdp;
}

/** Attach to an already-running Chromium-based process (e.g. WebView2) exposing a debug port. */
export async function attachTarget(port, filter = t => t.type === 'page') {
  return waitTarget(port, filter);
}

/**
 * Launch a real (headful) browser-app window, like the reference .bat launchers do.
 * Needed because headless Chrome rasterises text with grayscale AA, while a window on
 * the desktop uses ClearType — comparing the two would flag every glyph edge.
 */
export async function launchAppWindow({ port, url, width, height, browser = CHROME }) {
  const userData = mkdtempSync(path.join(tmpdir(), 'sm-ref-'));
  const proc = spawn(browser, [
    `--app=${url}`,
    `--window-size=${width},${height}`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-features=Translate',
  ], { stdio: 'ignore' });
  const cdp = await waitTarget(port, t => t.type === 'page' && t.url.includes('speed-meter'));
  cdp.userData = userData;
  cdp.proc = proc;
  return cdp;
}

/** Grow/shrink the real browser window until the page's CSS viewport is exactly w x h. */
export async function fitViewport(cdp, w, h, tries = 8) {
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  for (let i = 0; i < tries; i++) {
    const { innerWidth, innerHeight } = await cdp.evaluate('({innerWidth, innerHeight})');
    const dw = w - innerWidth, dh = h - innerHeight;
    if (Math.abs(dw) <= 0 && Math.abs(dh) <= 0) return { innerWidth, innerHeight, iterations: i };
    const { bounds } = await cdp.send('Browser.getWindowBounds', { windowId });
    await cdp.send('Browser.setWindowBounds', {
      windowId,
      bounds: { ...bounds, width: bounds.width + dw, height: bounds.height + dh },
    });
    await new Promise(r => setTimeout(r, 220));
  }
  return cdp.evaluate('({innerWidth, innerHeight, failed: true})');
}

export async function waitTarget(port, filter, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await res.json();
      const t = targets.find(filter);
      if (t?.webSocketDebuggerUrl) return Cdp.connect(t.webSocketDebuggerUrl);
      lastErr = new Error('no matching target: ' + targets.map(x => x.type + ':' + x.url).join(', '));
    } catch (e) { lastErr = e; }
    await sleep(250);
  }
  throw lastErr;
}

export async function openPage(cdp, url, { width, height, deviceScaleFactor }) {
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  if (width && height) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: deviceScaleFactor ?? 1, mobile: false,
    });
  }
  const loaded = cdp.once('Page.loadEventFired');
  await cdp.send('Page.navigate', { url });
  await loaded;
}

export function cleanup(cdp) {
  try { cdp.proc?.kill(); } catch {}
  try { if (cdp.userData) rmSync(cdp.userData, { recursive: true, force: true }); } catch {}
  cdp.close();
}
