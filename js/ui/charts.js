// Everything drawn on these pages is drawn the way a book draws it: a ring
// stroked like a pen has gone round it twice, a rule that fills as a pot
// does, and columns ruled up from a baseline. Plain SVG and HTML, no library.

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
    const width = Math.max(220, Math.floor(el.clientWidth));
    if (el.dataset.renderedWidth === String(width)) continue;
    el.dataset.renderedWidth = String(width);
    el.innerHTML = drawBars(spec.series, { ...spec.opts, width });
  }
}

// A ring drawn in ink: a faint compass line all the way round, and the
// filled arc over it. The arc's colour says how things stand.
export function inkRing({ ratio, tone = 'plain', centre = '', below = '', label = '', size = 132, stroke = 13 }) {
  const id = `ring-${++seq}`;
  const cx = size / 2;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const fill = Math.min(1, Math.max(0, ratio || 0)) * c;
  const sheen = c * 0.08;
  let svg = `<svg width="100%" height="100%" viewBox="0 0 ${size} ${size}" aria-hidden="true" focusable="false">`;
  svg += `<circle class="ring-guide" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke-width="${stroke}"/>`;
  svg += `<circle class="ring-ink" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${fill.toFixed(2)} ${(c - fill).toFixed(2)}" transform="rotate(-90 ${cx} ${cx})"/>`;
  svg += `<circle class="ring-sheen" cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${sheen.toFixed(2)} ${(c - sheen).toFixed(2)}"/>`;
  svg += '</svg>';
  return html`<div class="ink-ring" data-tone="${tone}" id="${id}" role="img" aria-label="${label}">
    ${raw(svg)}
    <div class="ink-ring-centre" aria-hidden="true"><strong>${centre}</strong>${below ? html`<span>${below}</span>` : ''}</div>
  </div>`;
}

// The rule under a pot's name, inked in as far as the pot is full.
export function progressRule(ratio, tone, label) {
  const pct = Math.min(100, Math.max(0, (ratio || 0) * 100));
  return html`<span class="rule" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}">
    <span class="rule-ink ${tone}" style="width:${pct.toFixed(2)}%"></span>
  </span>`;
}

// Columns ruled up from a baseline, with the figures written under them.
// Drawn after mounting so the text is set at the real width rather than
// scaled down with the drawing.
export function ruledBars(series, opts) {
  const id = `bars-${++seq}`;
  specs.set(id, { series, opts });
  return html`<div class="bars" data-chart="${id}" style="height:${opts.height ?? 150}px" role="img" aria-label="${opts.ariaLabel ?? ''}"></div>
    <div class="sr-only"><table><caption>${opts.ariaLabel ?? ''}</caption><tbody>
      ${series.map((s) => html`<tr><th scope="row">${s.fullLabel ?? s.label}</th><td>${opts.fmt(s.value)}</td></tr>`)}
    </tbody></table></div>`;
}

function niceMax(v) {
  if (!(v > 0)) return 100;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

function drawBars(series, { width, height = 150, fmt }) {
  const padL = 4;
  const padR = 4;
  const padT = 16;
  const padB = 30;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const top = niceMax(Math.max(...series.map((s) => s.value), 0));
  const group = plotW / Math.max(1, series.length);
  const barW = Math.max(8, Math.min(44, group * 0.5));
  let out = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">`;
  // The baseline and one faint rule at the top of the range, like a ledger's.
  out += `<line class="bar-rule" x1="${padL}" x2="${width - padR}" y1="${padT}" y2="${padT}"/>`;
  out += `<line class="bar-rule base" x1="${padL}" x2="${width - padR}" y1="${padT + plotH}" y2="${padT + plotH}"/>`;
  series.forEach((s, i) => {
    const cx = padL + group * i + group / 2;
    const h = top > 0 ? (Math.max(0, s.value) / top) * plotH : 0;
    const y = padT + plotH - h;
    out += `<rect class="bar-ink" x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="2"><title>${esc(`${s.fullLabel ?? s.label}: ${fmt(s.value)}`)}</title></rect>`;
    out += `<text class="bar-label" x="${cx.toFixed(1)}" y="${height - 12}" text-anchor="middle">${esc(s.label)}</text>`;
    if (i === series.length - 1) out += `<text class="bar-value" x="${cx.toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle">${esc(fmt(s.value))}</text>`;
  });
  out += '</svg>';
  return out;
}
