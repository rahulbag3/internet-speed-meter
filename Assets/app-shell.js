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
  `;

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
