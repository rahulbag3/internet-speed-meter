// In-page measurement code. Each function is self-contained: it is stringified with
// Function.prototype.toString() and evaluated inside the page over CDP, so it must not
// reference anything from module scope.

/** Full geometry + computed-style dump of the card and every element inside it. */
export function __smSnapshot() {
  const r2 = n => Math.round(n * 100) / 100;
  const rect = el => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: r2(b.x), y: r2(b.y), w: r2(b.width), h: r2(b.height) };
  };
  const st = (el, props) => {
    if (!el) return null;
    const c = getComputedStyle(el);
    const o = {};
    for (const p of props) o[p] = c[p];
    return o;
  };
  const txt = el => (el ? el.textContent : null);
  const q = s => document.querySelector(s);
  const qa = s => Array.from(document.querySelectorAll(s));

  const BOX = ['display', 'position', 'width', 'height', 'paddingTop', 'paddingRight',
    'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
    'order', 'gridTemplateColumns', 'gridTemplateRows', 'columnGap', 'rowGap', 'gap',
    'alignItems', 'justifyContent', 'justifyItems', 'flexDirection', 'aspectRatio'];
  const INK = ['color', 'backgroundColor', 'backgroundImage', 'borderRadius', 'borderTopWidth',
    'borderTopStyle', 'borderTopColor', 'boxShadow', 'opacity', 'transform', 'transformOrigin',
    'transition', 'overflow', 'cursor'];
  const TYPE = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
    'lineHeight', 'textTransform', 'fontVariantNumeric', 'textDecoration', 'whiteSpace'];

  const body = document.body;
  const card = q('.card');

  const dotGrid = el => {
    if (!el) return null;
    const kids = Array.from(el.children);
    return {
      rect: rect(el),
      styles: st(el, BOX.concat(INK)),
      count: kids.length,
      lit: kids.map((k, i) => (k.classList.contains('on') ? i : -1)).filter(i => i >= 0),
      firstDot: kids.length ? { rect: rect(kids[0]), styles: st(kids[0], BOX.concat(INK)) } : null,
    };
  };

  const svgInfo = el => {
    if (!el) return null;
    return {
      rect: rect(el),
      width: el.getAttribute('width'),
      height: el.getAttribute('height'),
      viewBox: el.getAttribute('viewBox'),
      fill: el.getAttribute('fill'),
      stroke: el.getAttribute('stroke'),
      strokeWidth: el.getAttribute('stroke-width'),
      strokeLinecap: el.getAttribute('stroke-linecap'),
      paths: Array.from(el.querySelectorAll('path,rect,circle')).map(n => ({
        tag: n.tagName,
        d: n.getAttribute('d'),
        x: n.getAttribute('x'), y: n.getAttribute('y'),
        w: n.getAttribute('width'), h: n.getAttribute('height'),
        rx: n.getAttribute('rx'),
        fill: n.getAttribute('fill'),
      })),
    };
  };

  return {
    meta: {
      innerWidth, innerHeight, devicePixelRatio,
      scrollX, scrollY,
      docScrollW: document.documentElement.scrollWidth,
      docScrollH: document.documentElement.scrollHeight,
      bodyScrollH: body.scrollHeight,
      variant: body.dataset.v,
      title: document.title,
      url: location.href,
    },
    body: { rect: rect(body), styles: st(body, BOX.concat(INK).concat(['fontFamily'])) },
    card: { rect: rect(card), styles: st(card, BOX.concat(INK)) },
    trackers: qa('.tracker').map(t => ({
      id: t.id,
      rect: rect(t),
      styles: st(t, BOX),
      name: {
        rect: rect(t.querySelector('.name')),
        styles: st(t.querySelector('.name'), BOX),
        ic: { rect: rect(t.querySelector('.ic')), styles: st(t.querySelector('.ic'), BOX.concat(INK)) },
        icSvg: svgInfo(t.querySelector('.ic svg')),
        label: {
          rect: rect(t.querySelector('.label')),
          styles: st(t.querySelector('.label'), TYPE.concat(INK)),
          text: txt(t.querySelector('.label')),
        },
      },
      thead: { rect: rect(t.querySelector('.thead')), styles: st(t.querySelector('.thead'), BOX) },
      big: {
        rect: rect(t.querySelector('.big')),
        styles: st(t.querySelector('.big'), BOX.concat(TYPE)),
        num: {
          rect: rect(t.querySelector('.big .num')),
          styles: st(t.querySelector('.big .num'), TYPE.concat(INK)),
          text: txt(t.querySelector('.big .num')),
        },
        unit: {
          rect: rect(t.querySelector('.big .unit')),
          styles: st(t.querySelector('.big .unit'), TYPE.concat(INK)),
          text: txt(t.querySelector('.big .unit')),
        },
      },
      dots: dotGrid(t.querySelector('.dots')),
    })),
    footer: {
      rect: rect(q('.footer')),
      styles: st(q('.footer'), BOX),
      status: {
        rect: rect(q('.status')),
        styles: st(q('.status'), TYPE.concat(INK)),
        text: txt(q('.status')),
        classes: q('.status').className,
      },
      tools: { rect: rect(q('.tools')), styles: st(q('.tools'), BOX) },
      layouts: { rect: rect(q('.layouts')), styles: st(q('.layouts'), BOX.concat(INK)) },
      layButtons: qa('.lay').map(b => ({
        id: b.id,
        rect: rect(b),
        styles: st(b, BOX.concat(INK)),
        pressed: b.getAttribute('aria-pressed'),
        label: b.getAttribute('aria-label'),
        svg: svgInfo(b.querySelector('svg')),
      })),
      retest: {
        rect: rect(q('.retest')),
        styles: st(q('.retest'), BOX.concat(INK)),
        disabled: q('.retest').disabled,
        classes: q('.retest').className,
        svg: svgInfo(q('.retest svg')),
      },
    },
  };
}

/** Click the layout toggle for `target` and sample the transform frame by frame. */
export function __smAnim(target, ms) {
  const r2 = n => Math.round(n * 100) / 100;
  const rect = el => {
    const b = el.getBoundingClientRect();
    return { x: r2(b.x), y: r2(b.y), w: r2(b.width), h: r2(b.height) };
  };
  const card = document.querySelector('.card');
  const nodes = [
    ['card', card],
    ['dl', document.getElementById('t-dl')],
    ['up', document.getElementById('t-up')],
    ['ft', document.querySelector('.footer')],
  ];
  const frames = [];
  return new Promise(resolve => {
    let t0 = null;
    const tick = () => {
      const now = performance.now();
      if (t0 == null) t0 = now;
      const f = { t: r2(now - t0) };
      for (const [k, el] of nodes) f[k] = rect(el);
      f.cardTransition = getComputedStyle(card).transitionDuration;
      frames.push(f);
      if (now - t0 < ms) requestAnimationFrame(tick);
      else resolve({ frames, variantAfter: document.body.dataset.v });
    };
    document.getElementById('v-' + target).click();
    requestAnimationFrame(tick);
  });
}

/** Drive a real speed test and report the final rendered state. */
export function __smRunTest(timeoutMs) {
  const read = () => ({
    dl: document.getElementById('dl').textContent,
    up: document.getElementById('up').textContent,
    status: document.getElementById('status').textContent,
    statusErr: document.getElementById('status').classList.contains('err'),
    spinning: document.getElementById('retest').classList.contains('spinning'),
    disabled: document.getElementById('retest').disabled,
    litDl: Array.from(document.getElementById('dots-dl').children).filter(k => k.classList.contains('on')).length,
    litUp: Array.from(document.getElementById('dots-up').children).filter(k => k.classList.contains('on')).length,
    dotsDlCount: document.getElementById('dots-dl').children.length,
    dotsUpCount: document.getElementById('dots-up').children.length,
  });
  const start = read();
  document.getElementById('retest').click();
  return new Promise(resolve => {
    const t0 = performance.now();
    const poll = () => {
      const now = read();
      if (!now.disabled) {
        const err = now.statusErr ? now.status : null;
        resolve({ start, end: now, elapsedMs: Math.round(performance.now() - t0), error: err });
        return;
      }
      if (performance.now() - t0 > timeoutMs) {
        resolve({ start, end: now, elapsedMs: Math.round(performance.now() - t0), timedOut: true });
        return;
      }
      setTimeout(poll, 250);
    };
    setTimeout(poll, 250);
  });
}
