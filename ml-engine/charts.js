// Tiny SVG chart helpers. Rendered at the container's real width so text stays legible on phones.
(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || v;

  function svg(el, h) {
    el.innerHTML = '';
    const w = Math.max(300, el.clientWidth || 640);
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', `0 0 ${w} ${h}`);
    s.setAttribute('width', w);
    s.setAttribute('height', h);
    el.appendChild(s);
    return { s, w, h };
  }
  function node(parent, tag, attrs, text) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) if (attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    if (text !== undefined) n.textContent = text;
    parent.appendChild(n);
    return n;
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const m = v / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }
  function ticks(lo, hi, n = 4) {
    const step = niceMax((hi - lo) / n);
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }

  // Tooltip
  let tipEl;
  function tip(target, html) {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; document.body.appendChild(tipEl); }
    const show = (e) => {
      tipEl.innerHTML = html;
      tipEl.style.opacity = 1;
      const x = Math.min(e.clientX + 14, window.innerWidth - tipEl.offsetWidth - 8);
      tipEl.style.left = x + 'px';
      tipEl.style.top = (e.clientY + 14) + 'px';
    };
    target.addEventListener('mousemove', show);
    target.addEventListener('mouseleave', () => { tipEl.style.opacity = 0; });
    target.style.cursor = 'default';
  }

  function ensureHatch(s, id, color) {
    let defs = s.querySelector('defs') || node(s, 'defs', {});
    const p = node(defs, 'pattern', { id, patternUnits: 'userSpaceOnUse', width: 6, height: 6, patternTransform: 'rotate(45)' });
    node(p, 'rect', { width: 6, height: 6, fill: '#fff' });
    node(p, 'rect', { width: 3, height: 6, fill: color, opacity: 0.55 });
    return `url(#${id})`;
  }

  // Vertical grouped bars. series[i].values[c]; colorFn(c, i) → {fill, hatch}
  function groupedBars(el, { cats, series, colorFn, fmt, tipFn, height = 300 }) {
    const { s, w, h } = svg(el, height);
    const m = { t: 22, r: 8, b: 44, l: 44 };
    const iw = w - m.l - m.r, ih = h - m.t - m.b;
    const max = niceMax(Math.max(...series.flatMap((x) => x.values)) * 1.08);
    const y = (v) => m.t + ih - (v / max) * ih;
    for (const t of ticks(0, max)) {
      node(s, 'line', { x1: m.l, x2: w - m.r, y1: y(t), y2: y(t), class: t === 0 ? 'zero' : 'grid' });
      node(s, 'text', { x: m.l - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'axis-label' }, fmt(t));
    }
    const gw = iw / cats.length;
    const pad = Math.min(18, gw * 0.14);
    const bw = (gw - pad * 2) / series.length;
    cats.forEach((c, ci) => {
      series.forEach((sr, si) => {
        const v = sr.values[ci];
        const x = m.l + ci * gw + pad + si * bw;
        const col = colorFn(ci, si);
        const fill = col.hatch ? ensureHatch(s, `h${ci}${si}${Math.random().toString(36).slice(2, 6)}`, col.fill) : col.fill;
        const r = node(s, 'rect', { x: x + 1.5, y: y(v), width: Math.max(1, bw - 3), height: Math.max(0, y(0) - y(v)), rx: 5, fill, stroke: col.hatch ? col.fill : 'none', 'stroke-width': col.hatch ? 1.5 : 0 });
        if (tipFn) tip(r, tipFn(ci, si));
        if (bw > 26) node(s, 'text', { x: x + bw / 2, y: y(v) - 6, 'text-anchor': 'middle', class: 'val' }, fmt(v));
      });
      const words = c.split(' ');
      const lines = gw < 120 && words.length > 1 ? [words[0], words.slice(1).join(' ')] : [c];
      lines.forEach((ln, li) => node(s, 'text', { x: m.l + ci * gw + gw / 2, y: h - m.b + 18 + li * 15, 'text-anchor': 'middle', class: 'cat' }, ln));
    });
  }

  // Horizontal 100%-stacked bars.
  function stackedBars(el, { cats, parts, values, tipFn }) {
    const narrow = (el.clientWidth || 640) < 520;
    const rowH = 38, gap = 16, labelW = narrow ? 0 : 150;
    const height = cats.length * (rowH + gap + (narrow ? 20 : 0)) + 6;
    const { s, w } = svg(el, height);
    const iw = w - labelW - 4;
    cats.forEach((c, ci) => {
      const top = ci * (rowH + gap + (narrow ? 20 : 0)) + (narrow ? 20 : 0);
      node(s, 'text', narrow ? { x: 0, y: top - 6, class: 'cat' } : { x: 0, y: top + rowH / 2 + 5, class: 'cat' }, c);
      const total = values[ci].reduce((a, b) => a + b, 0) || 1;
      let x = labelW;
      parts.forEach((p, pi) => {
        const v = values[ci][pi];
        const pw = (v / total) * iw;
        if (pw <= 0) return;
        const r = node(s, 'rect', { x, y: top, width: Math.max(0, pw - 1.5), height: rowH, fill: p.color, rx: 4 });
        if (tipFn) tip(r, tipFn(ci, pi));
        if (pw > 38) {
          const dark = p.light ? css('--ink') : '#fff';
          node(s, 'text', { x: x + pw / 2, y: top + rowH / 2 + 4.5, 'text-anchor': 'middle', style: `fill:${dark};font-weight:700;font-size:12px` }, Math.round((v / total) * 100) + '%');
        }
        x += pw;
      });
    });
  }

  // Line chart. series: {name, color, points:[{x,y}], dash, width}
  function lineChart(el, { series, xFmt, yFmt, marker, markerLabel, height = 320 }) {
    const { s, w, h } = svg(el, height);
    const m = { t: 18, r: 14, b: 38, l: 48 };
    const iw = w - m.l - m.r, ih = h - m.t - m.b;
    const ys = series.flatMap((sr) => sr.points.map((p) => p.y));
    const lo = Math.min(0, ...ys), hi = niceMax(Math.max(...ys) * 1.05);
    const loN = lo < 0 ? -niceMax(-lo) : 0;
    const X = (v) => m.l + v * iw;
    const Y = (v) => m.t + ih - ((v - loN) / (hi - loN)) * ih;
    for (const t of ticks(loN, hi)) {
      node(s, 'line', { x1: m.l, x2: w - m.r, y1: Y(t), y2: Y(t), class: t === 0 ? 'zero' : 'grid' });
      node(s, 'text', { x: m.l - 8, y: Y(t) + 4, 'text-anchor': 'end', class: 'axis-label' }, yFmt(t));
    }
    for (let t = 0; t <= 1.0001; t += 0.25) {
      node(s, 'text', { x: X(t), y: h - m.b + 18, 'text-anchor': t === 0 ? 'start' : t >= 1 ? 'end' : 'middle', class: 'axis-label' }, xFmt(t));
    }
    node(s, 'text', { x: m.l + iw / 2, y: h - 4, 'text-anchor': 'middle', class: 'axis-label' }, 'Share of members targeted, best-scored first');
    if (marker !== undefined) {
      node(s, 'line', { x1: X(marker), x2: X(marker), y1: m.t, y2: m.t + ih, stroke: css('--ink'), 'stroke-dasharray': '2 4', 'stroke-width': 1.5 });
      node(s, 'text', { x: X(marker) + 6, y: m.t + 12, style: `fill:${css('--ink')};font-weight:700;font-size:12px` }, markerLabel);
    }
    for (const sr of series) {
      const d = sr.points.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
      node(s, 'path', { d, fill: 'none', stroke: sr.color, 'stroke-width': sr.width || 3, 'stroke-dasharray': sr.dash, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    }
    // hover readout
    const hit = node(s, 'rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent' });
    const guide = node(s, 'line', { y1: m.t, y2: m.t + ih, stroke: css('--ink-3'), 'stroke-width': 1, opacity: 0 });
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; document.body.appendChild(tipEl); }
    hit.addEventListener('mousemove', (e) => {
      const rect = s.getBoundingClientRect();
      const fx = Math.max(0, Math.min(1, ((e.clientX - rect.left) * (w / rect.width) - m.l) / iw));
      const pts = series[0].points;
      let idx = Math.round(fx * (pts.length - 1));
      guide.setAttribute('x1', X(pts[idx].x)); guide.setAttribute('x2', X(pts[idx].x)); guide.setAttribute('opacity', 1);
      tipEl.innerHTML = `<b>${xFmt(pts[idx].x)} targeted</b><br>` + series.map((sr) => `${sr.name}: ${yFmt(sr.points[idx].y)}`).join('<br>');
      tipEl.style.opacity = 1;
      tipEl.style.left = Math.min(e.clientX + 14, window.innerWidth - tipEl.offsetWidth - 8) + 'px';
      tipEl.style.top = (e.clientY + 14) + 'px';
    });
    hit.addEventListener('mouseleave', () => { tipEl.style.opacity = 0; guide.setAttribute('opacity', 0); });
  }

  // Horizontal bars around a zero line (for positive/negative dollars).
  function divergingBars(el, { cats, values, colors, fmt, tipFn }) {
    const narrow = (el.clientWidth || 640) < 520;
    const rowH = 34, gap = 14, labelW = narrow ? 0 : 150;
    const extra = narrow ? 20 : 0;
    const height = cats.length * (rowH + gap + extra) + 26;
    const { s, w } = svg(el, height);
    const lo = Math.min(0, ...values), hi = Math.max(0, ...values);
    const span = (hi - lo) || 1;
    const padL = 64, padR = 64;
    const iw = w - labelW - padL - padR;
    const X = (v) => labelW + padL + ((v - lo) / span) * iw;
    node(s, 'line', { x1: X(0), x2: X(0), y1: 0, y2: height - 22, class: 'zero' });
    node(s, 'text', { x: X(0), y: height - 6, 'text-anchor': 'middle', class: 'axis-label' }, '$0');
    cats.forEach((c, ci) => {
      const top = ci * (rowH + gap + extra) + extra;
      node(s, 'text', narrow ? { x: 0, y: top - 6, class: 'cat' } : { x: 0, y: top + rowH / 2 + 5, class: 'cat' }, c);
      const v = values[ci];
      const x0 = Math.min(X(0), X(v)), bw = Math.abs(X(v) - X(0));
      const r = node(s, 'rect', { x: x0, y: top, width: Math.max(2, bw), height: rowH, rx: 5, fill: v < 0 ? css('--coral') : colors[ci] });
      if (tipFn) tip(r, tipFn(ci));
      node(s, 'text', { x: v < 0 ? x0 - 6 : x0 + bw + 6, y: top + rowH / 2 + 4.5, 'text-anchor': v < 0 ? 'end' : 'start', class: 'val' }, fmt(v));
    });
  }

  // Holdout interval: naive credit, measured range, true value on one axis.
  function intervalChart(el, { naive, lo, hi, est, truth, fmt }) {
    const { s, w, h } = svg(el, 120);
    const m = { l: 16, r: 16 };
    const min = Math.min(0, lo), max = niceMax(Math.max(naive, hi, truth) * 1.08);
    const X = (v) => m.l + ((v - min) / (max - min)) * (w - m.l - m.r);
    const yMid = 56;
    for (const t of ticks(min, max, 5)) {
      node(s, 'line', { x1: X(t), x2: X(t), y1: 24, y2: 88, class: t === 0 ? 'zero' : 'grid' });
      node(s, 'text', { x: X(t), y: 108, 'text-anchor': 'middle', class: 'axis-label' }, fmt(t));
    }
    node(s, 'rect', { x: X(lo), y: yMid - 12, width: Math.max(3, X(hi) - X(lo)), height: 24, rx: 12, fill: css('--lime'), stroke: css('--green'), 'stroke-width': 1.5 });
    node(s, 'circle', { cx: X(est), cy: yMid, r: 6, fill: css('--green') });
    node(s, 'path', { d: `M${X(truth)},${yMid - 20} l7,-10 h-14 z`, fill: css('--ink') });
    node(s, 'text', { x: X(truth), y: 12, 'text-anchor': 'middle', style: `fill:${css('--ink')};font-weight:700;font-size:12px` }, 'True');
    node(s, 'line', { x1: X(naive), x2: X(naive), y1: yMid - 16, y2: yMid + 16, stroke: css('--amber'), 'stroke-width': 4, 'stroke-linecap': 'round' });
    node(s, 'text', { x: X(naive), y: yMid + 32, 'text-anchor': 'middle', style: `fill:#A86E10;font-weight:700;font-size:12px` }, 'Credited');
  }

  root.Charts = { groupedBars, stackedBars, lineChart, divergingBars, intervalChart };
})(window);
