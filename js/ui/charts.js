// Charts are plain SVG/HTML strings, no library. Bar charts are rendered
// after mounting so they can use the container's real width: text stays
// legible on a phone instead of being scaled down with the drawing.

import { html, raw, esc } from './html.js';

const specs = new Map();
let seq = 0;

export function resetCharts() {
  specs.clear();
}

export function hydrateCharts(root = document) {
  for (const el of root.querySelectorAll('[data-chart]')) {
    const spec = specs.get(el.dataset.chart);
    if (!spec) continue;
    const width = Math.max(240, Math.floor(el.clientWidth));
    if (el.dataset.renderedWidth === String(width)) continue;
    el.dataset.renderedWidth = String(width);
    el.innerHTML = renderBars(spec.series, { ...spec.opts, width });
  }
}

function niceMax(v) {
  if (!(v > 0)) return 100;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

// series: [{ key, label, values: { field: cents } }]
// opts: { fields: [{ field, name, cls }], height, fmtAxis, fmtValue, highlightKey, ariaLabel }
export function barChart(series, opts) {
  const id = `chart-${++seq}`;
  specs.set(id, { series, opts });
  const { fields, fmtValue, ariaLabel } = opts;
  return html`<div class="chart" data-chart="${id}" style="height:${opts.height ?? 200}px" role="img" aria-label="${ariaLabel}"></div>
    <div class="sr-only">
      <table>
        <caption>${ariaLabel}</caption>
        <thead><tr><th scope="col">Month</th>${fields.map((f) => html`<th scope="col">${f.name}</th>`)}</tr></thead>
        <tbody>${series.map((s) => html`<tr><th scope="row">${s.fullLabel ?? s.label}</th>${fields.map((f) => html`<td>${fmtValue(s.values[f.field])}</td>`)}</tr>`)}</tbody>
      </table>
    </div>
    ${fields.length > 1
      ? html`<div class="legend-inline" aria-hidden="true">${fields.map((f) => html`<span><i class="key ${f.cls}"></i>${f.name}</span>`)}</div>`
      : ''}`;
}

function renderBars(series, { width, height = 200, fields, fmtAxis, fmtValue, highlightKey }) {
  const padL = 52;
  const padR = 4;
  const padT = 10;
  const padB = 26;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  let max = 0;
  for (const s of series) for (const f of fields) max = Math.max(max, s.values[f.field] ?? 0);
  const top = niceMax(max);
  const y = (v) => padT + plotH - (Math.max(0, v) / top) * plotH;
  const n = series.length;
  const group = plotW / n;
  const gap = Math.max(2, Math.min(6, group * 0.08));
  const barW = Math.max(3, Math.min(22, (group * 0.62 - gap * (fields.length - 1)) / fields.length));
  const longest = Math.max(...series.map((s) => String(s.label).length));
  const every = Math.max(1, Math.ceil((longest * 7 + 8) / group));

  let out = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">`;
  for (const t of [0, 0.5, 1]) {
    const yy = y(top * t);
    out += `<line class="grid${t === 0 ? ' base' : ''}" x1="${padL}" x2="${width - padR}" y1="${yy}" y2="${yy}"/>`;
    out += `<text class="axis" x="${padL - 8}" y="${yy + 4}" text-anchor="end">${esc(fmtAxis(top * t))}</text>`;
  }
  series.forEach((s, i) => {
    const cx = padL + group * i + group / 2;
    const totalW = barW * fields.length + gap * (fields.length - 1);
    fields.forEach((f, j) => {
      const v = s.values[f.field] ?? 0;
      const x = cx - totalW / 2 + j * (barW + gap);
      const yy = y(v);
      const h = Math.max(0, padT + plotH - yy);
      const tip = `${s.fullLabel ?? s.label}, ${f.name}: ${fmtValue(v)}`;
      out += `<rect class="${f.cls}" x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${esc(tip)}</title></rect>`;
    });
    if (i % every === 0 || s.key === highlightKey) {
      const cls = s.key === highlightKey ? 'axis x current' : 'axis x';
      out += `<text class="${cls}" x="${cx.toFixed(1)}" y="${height - 8}" text-anchor="middle">${esc(s.label)}</text>`;
    }
  });
  out += '</svg>';
  return out;
}

// segments: [{ value (> 0), color, label }]
export function donut(segments, { size = 160, stroke = 24, centerTop = '', centerBottom = '', ariaLabel = '' }) {
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const gap = segments.length > 1 ? 2.5 : 0;
  let offset = 0;
  let circles = `<circle class="donut-track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>`;
  if (total > 0) {
    for (const seg of segments) {
      const len = (Math.max(0, seg.value) / total) * c;
      const dash = Math.max(0, len - gap);
      if (dash > 0) {
        circles += `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${esc(seg.color)}" stroke-width="${stroke}" stroke-dasharray="${dash.toFixed(2)} ${(c - dash).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"><title>${esc(seg.label)}</title></circle>`;
      }
      offset += len;
    }
  }
  return html`<div class="donut" style="width:${size}px;height:${size}px" role="img" aria-label="${ariaLabel}">
    ${raw(`<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true" focusable="false">${circles}</svg>`)}
    <div class="donut-center" aria-hidden="true"><strong>${centerTop}</strong><span>${centerBottom}</span></div>
  </div>`;
}

// The month's headline, as concentric rings rather than a linear track — the
// outer ring is how much of the budget is gone (colour carries the money
// state: s-ok/s-warning/s-over), the inner ring, current month only, is how
// far the month itself has gone, drawn in the interface's own accent since
// elapsed time isn't income or spending. Geometry is worked out at a fixed
// reference size; the container sizes the svg responsively with `width:100%`,
// so the stroke scales with it rather than staying a fixed pixel width.
export function progressRing({ size = 132, stroke = 15, ratio, state, dayFraction, showDay, centerTop, centerBottom, ariaLabel }) {
  const cx = size / 2;
  const cy = size / 2;
  const r1 = (size - stroke) / 2;
  const c1 = 2 * Math.PI * r1;
  const fill1 = Math.min(1, Math.max(0, ratio));
  const dash1 = fill1 * c1;
  const stroke2 = Math.max(7, stroke * 0.5);
  const r2 = r1 - stroke / 2 - stroke2 / 2 - 5;
  const c2 = 2 * Math.PI * r2;
  const fill2 = Math.min(1, Math.max(0, dayFraction ?? 0));
  const dash2 = fill2 * c2;

  let circles = `<circle class="ring-track" cx="${cx}" cy="${cy}" r="${r1}" fill="none" stroke-width="${stroke}"/>`;
  circles += `<circle class="ring-fill s-${state}" cx="${cx}" cy="${cy}" r="${r1}" fill="none" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${dash1.toFixed(2)} ${(c1 - dash1).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
  if (showDay && r2 > 4) {
    circles += `<circle class="ring-track" cx="${cx}" cy="${cy}" r="${r2}" fill="none" stroke-width="${stroke2}"/>`;
    circles += `<circle class="ring-fill-inner" cx="${cx}" cy="${cy}" r="${r2}" fill="none" stroke-width="${stroke2}" stroke-linecap="round" stroke-dasharray="${dash2.toFixed(2)} ${(c2 - dash2).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
  }
  return html`<div class="hero-ring" role="img" aria-label="${ariaLabel}">
    ${raw(`<svg width="100%" height="100%" viewBox="0 0 ${size} ${size}" aria-hidden="true" focusable="false">${circles}</svg>`)}
    <div class="hero-ring-center" aria-hidden="true"><strong>${centerTop}</strong><span>${centerBottom}</span></div>
  </div>`;
}

export function progressBar(ratio, state, label) {
  const pct = Math.min(100, Math.max(0, ratio * 100));
  return html`<div class="bar" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}" aria-valuetext="${label}">
    <span class="bar-fill s-${state}" style="width:${pct.toFixed(2)}%"></span>
  </div>`;
}
