(() => {
  // Shell-only overrides. The reference never sets user-select, so in a browser every label
  // and number is selectable text (I-beam cursor); as a desktop widget nothing should select,
  // and selectable text would also turn a card drag into a text selection. The grey backdrop
  // is dropped so the frameless window can float as just the card and its shadow.
  // COMPACT CARD WIDTH: horizontal only - no vertical metric is touched.
  const CSS = `
    html,body{background:transparent !important}
    .card{-webkit-user-select:none;user-select:none}
    body[data-v="stack"] .card{width:min(92vw, 400px) !important}
    body{transition:opacity .35s ease}
    body.sm-dim{opacity:.55}
    @media (prefers-reduced-motion: reduce){body{transition:none}}
    /* Keep-on-top toggle: same chrome as .retest, with the reference's inset face and LED. */
    .pin{width:38px;height:38px;border-radius:50%;border:1px solid rgba(255,255,255,.16);
      background:transparent;color:#bdbdbd;cursor:pointer;padding:0;
      display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
      transition:background .2s,color .2s,border-color .2s,transform .1s}
    .pin:hover{background:rgba(255,255,255,.09);color:#fff;border-color:rgba(255,255,255,.28)}
    .pin:active{transform:scale(.94)}
    .pin .led{width:4px;height:4px;border-radius:50%;background:#3a3a3a;
      transition:background .2s,box-shadow .2s}
    /* On state is carried by the ring and the LED only; a filled disc read as the whole
       button glowing. Ring is stronger than the hover ring so the state is still legible
       while the pointer is over it. */
    .pin[aria-pressed="true"]{border-color:rgba(255,255,255,.40);color:#fff}
    .pin[aria-pressed="true"] .led{background:#16d95f;box-shadow:0 0 6px 1px rgba(22,217,95,.75)}
  `;

  const PIN_SVG = 'M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7C6.45 2 6 2.45 6 3s.45 1 1 1h1v5' +
    'c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z';

  const inject = () => {
    const host = document.head || document.documentElement;
    if (!host) return false;
    const style = document.createElement('style');
    style.id = 'app-shell';
    style.textContent = CSS;
    host.appendChild(style);
    return true;
  };

  // Document-created scripts run before <html> exists, so wait for the first element.
  if (!inject()) {
    const observer = new MutationObserver(() => { if (inject()) observer.disconnect(); });
    observer.observe(document, { childList: true });
  }

  const HISTORY = 12;        // one column per sample, 1s apart
  const FLOOR_MBPS = 10;     // keeps idle noise from filling the grid
  const RESULT_HOLD_MS = 5000;
  const IDLE_MS = 3000;      // how long after the pointer leaves before the card recedes

  // Same rule the reference uses for its benchmark readout, so live and tested values match.
  const fmt = v => v >= 10 ? String(Math.round(v)) : v.toFixed(1);

  // Sub-megabit traffic is the common case for an idle desktop meter, so drop to Kbps there.
  // The switch back up lags slightly: without it a link hovering near 1 Mbps flips units every
  // second. Both units are four characters, so the card never reflows.
  const KBPS_UP_TO = 1, KBPS_HYSTERESIS = 0.9;
  function rate(mbps, wasKbps) {
    const kbps = wasKbps ? mbps < KBPS_UP_TO : mbps < KBPS_HYSTERESIS;
    return kbps ? { text: fmt(mbps * 1000), unit: 'Kbps' } : { text: fmt(mbps), unit: 'Mbps' };
  }

  addEventListener('DOMContentLoaded', () => {
    const card = document.querySelector('.card');
    const btn = document.getElementById('retest');
    const dirs = {
      dl: { num: document.getElementById('dl'), unit: document.querySelector('#t-dl .unit'),
        grid: document.getElementById('dots-dl'), history: [], kbps: false },
      up: { num: document.getElementById('up'), unit: document.querySelector('#t-up .unit'),
        grid: document.getElementById('dots-up'), history: [], kbps: false },
    };
    let benchmarkEndedAt = 0;

    // Always-on-top toggle, sitting left of the layout switcher. The host owns the window
    // style, so the button only reports intent; the choice persists like the layout does.
    const pinBtn = document.createElement('button');
    pinBtn.className = 'pin';
    pinBtn.id = 'v-pin';
    pinBtn.type = 'button';
    pinBtn.setAttribute('aria-label', 'Keep the card on top of other windows');
    pinBtn.title = 'Keep on top';
    pinBtn.innerHTML =
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">` +
      `<path d="${PIN_SVG}"/></svg><span class="led"></span>`;

    const setPinned = on => {
      pinBtn.setAttribute('aria-pressed', String(on));
      window.chrome?.webview?.postMessage('topmost:' + (on ? 1 : 0));
    };
    let pinned = false;
    try { pinned = localStorage.getItem('sm-topmost') === '1'; } catch {}
    pinBtn.addEventListener('click', () => {
      pinned = !pinned;
      setPinned(pinned);
      try { localStorage.setItem('sm-topmost', pinned ? '1' : '0'); } catch {}
    });

    const tools = document.querySelector('.tools');
    tools.insertBefore(pinBtn, tools.firstElementChild);
    setPinned(pinned);          // apply the persisted choice to the window

    card.addEventListener('pointerdown', e => {
      // A frameless window has no title bar to grab, so dragging the card body moves the window.
      if (e.button !== 0 || e.target.closest('button')) return;
      window.chrome?.webview?.postMessage('drag');
    });

    // Recede when left alone. The fade is on <body>, not .card, because the reference's own
    // layout transition assigns card.style.transition and would drop this one mid-animation.
    // The transparent padding is click-through, so pointerenter/leave track the card itself.
    let idleTimer = null;
    const wake = () => { clearTimeout(idleTimer); document.body.classList.remove('sm-dim'); };
    const arm = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => document.body.classList.add('sm-dim'), IDLE_MS); };
    card.addEventListener('pointerenter', wake);
    card.addEventListener('pointerleave', arm);
    card.addEventListener('pointerdown', arm);
    addEventListener('wheel', arm, { passive: true });
    arm();

    // While a benchmark runs it owns the readout and the dot grid; the reference's own
    // clearAll() and dino animation write to the same nodes.
    new MutationObserver(() => {
      if (btn.disabled) benchmarkEndedAt = 0;
      else if (benchmarkEndedAt === 0) benchmarkEndedAt = performance.now();
    }).observe(btn, { attributes: true, attributeFilter: ['disabled', 'class'] });

    const busyWithBenchmark = () =>
      btn.disabled || (benchmarkEndedAt && performance.now() - benchmarkEndedAt < RESULT_HOLD_MS);

    function gridShape(el) {
      const cols = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
      const rows = Math.ceil(el.children.length / cols);
      return { cols, rows, count: el.children.length };
    }

    // The reference lays dots out bottom-up: element (rows-1-r)*cols + c is row r from the
    // floor in column c, so a column bar is just a run of lit cells from r = 0.
    function drawHistory(el, samples, scale) {
      const { cols, rows, count } = gridShape(el);
      const lit = new Set();
      const start = Math.max(0, samples.length - cols);
      for (let c = 0; start + c < samples.length; c++) {
        const height = Math.round(Math.min(1, samples[start + c] / scale) * rows);
        for (let r = 0; r < height; r++) lit.add((rows - 1 - r) * cols + c);
      }
      for (let i = 0; i < count; i++) el.children[i].classList.toggle('on', lit.has(i));
    }

    window.chrome?.webview?.addEventListener('message', e => {
      const mbps = { dl: e.data.rx * 8 / 1e6, up: e.data.tx * 8 / 1e6 };
      for (const key of ['dl', 'up']) {
        dirs[key].history.push(mbps[key]);
        if (dirs[key].history.length > HISTORY) dirs[key].history.shift();
      }

      if (busyWithBenchmark()) {
        // The benchmark writes only the number, so hand back the unit it assumes.
        for (const key of ['dl', 'up']) { dirs[key].unit.textContent = 'Mbps'; dirs[key].kbps = false; }
        return;
      }

      for (const key of ['dl', 'up']) {
        const d = dirs[key];
        const r = rate(mbps[key], d.kbps);
        d.kbps = r.unit === 'Kbps';
        d.num.textContent = r.text;
        d.unit.textContent = r.unit;

        if (!d.grid || !d.grid.offsetParent) continue;         // hidden in compact mode
        const recent = d.history.slice(-gridShape(d.grid).cols);
        drawHistory(d.grid, d.history, Math.max(FLOOR_MBPS, ...recent));
      }
    });
  });
})();
