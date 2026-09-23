import { html } from '../ui/html.js';
import { state } from '../store.js';
import { money } from '../ui/format.js';

// Shared furniture for every page of the book: running heads, folios, the
// ribbon, and the small marks that make a page look printed rather than
// rendered. Nothing here knows about any one chapter.

// UI state shared between chapters, not persisted.
export const ui = {
  // What the facing page is showing. It is state rather than layout, so
  // folding the phone never loses your place.
  selectedPlan: null,
  selectedAccount: null,
  // Which spread of a long chapter you are on.
  page: 0,
};

export const CHAPTERS = [
  { route: 'fund', title: 'The Fund', folio: 'i', blurb: 'What it is all worth, and what it buys you' },
  { route: 'pots', title: 'Pots', folio: 'ii', blurb: 'What the money is for' },
  { route: 'ledger', title: 'Accounts', folio: 'iii', blurb: 'Where it sits, what it earns, who can reach it' },
  { route: 'review', title: 'Review', folio: 'iv', blurb: 'The quarterly look-over' },
  { route: 'settings', title: 'Endpapers', folio: 'v', blurb: 'Figures, backups and the vault' },
];

const I = (d, w = 20) => html`<svg viewBox="0 0 24 24" width="${w}" height="${w}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

export const icons = {
  fund: I(html`<path d="M3 9.5L12 4l9 5.5M5 10v9M9.5 10v9M14.5 10v9M19 10v9M3 19h18"/>`),
  pots: I(html`<path d="M6 9h12l-1 10a2 2 0 01-2 2H9a2 2 0 01-2-2z"/><path d="M9 9V6.5A3 3 0 0112 4a3 3 0 013 2.5V9"/>`),
  ledger: I(html`<path d="M5 4h12a2 2 0 012 2v14H7a2 2 0 01-2-2z"/><path d="M9 8h6M9 12h6M9 16h4"/>`),
  review: I(html`<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>`),
  settings: I(html`<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>`),
  plus: I(html`<path d="M12 5v14M5 12h14"/>`, 22),
  prev: I(html`<path d="M15 5l-7 7 7 7"/>`, 22),
  next: I(html`<path d="M9 5l7 7-7 7"/>`, 22),
  chevron: I(html`<path d="M9 6l6 6-6 6"/>`, 18),
  lock: I(html`<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>`, 16),
  pen: I(html`<path d="M4 20l4-1 9-9-3-3-9 9z"/><path d="M14 7l3 3"/>`, 16),
  check: I(html`<path d="M5 12l5 5 9-10"/>`, 16),
};

// The bibliographic mark at the head of every chapter: a rule, the chapter
// name in small caps, and its number — the way a printed book announces one.
export function chapterHead(route, { actions = '' } = {}) {
  const chapter = CHAPTERS.find((c) => c.route === route);
  if (!chapter) return '';
  return html`<header class="chapter-head">
    <p class="chapter-number">Chapter ${chapter.folio}</p>
    <div class="chapter-title-row">
      <h1 class="chapter-title">${chapter.title}</h1>
      ${actions ? html`<div class="chapter-actions">${actions}</div>` : ''}
    </div>
    <p class="chapter-blurb">${chapter.blurb}</p>
  </header>`;
}

// A section of a page, set like one: a small-caps heading with a rule that
// runs to the end of the measure.
export function section(title, body, { link = '', id = '', hue = '' } = {}) {
  return html`<section class="leaf-section"${hue ? html` style="--ink-accent:${hue}"` : ''}${id ? html` aria-labelledby="${id}"` : ''}>
    <div class="section-rule">
      <h2${id ? html` id="${id}"` : ''}>${title}</h2>
      ${link}
    </div>
    ${body}
  </section>`;
}

// A figure set on a ruled line, the way a ledger sets one: the name on the
// left, leader dots across the gap, the amount hard right.
export function ruledRow(name, value, { sub = '', tone = '', href = '', action = '', id = '' } = {}) {
  const inner = html`<span class="ruled-name">${name}${sub ? html`<small>${sub}</small>` : ''}</span>
    <span class="ruled-leader" aria-hidden="true"></span>
    <span class="ruled-value ${tone}">${value}</span>`;
  if (href) return html`<li class="ruled"><a class="ruled-row" href="${href}">${inner}</a></li>`;
  if (action) return html`<li class="ruled"><button type="button" class="ruled-row" data-action="${action}" data-id="${id}">${inner}</button></li>`;
  return html`<li class="ruled"><span class="ruled-row">${inner}</span></li>`;
}

// The figure a page is really about, set large in the display face.
export function displayFigure(value, label, { tone = '', note = '' } = {}) {
  return html`<p class="display-figure ${tone}"><span class="display-value">${value}</span>${label ? html`<span class="display-label">${label}</span>` : ''}</p>
    ${note ? html`<p class="display-note">${note}</p>` : ''}`;
}

export function emptyPage({ title, body, actions = '' }) {
  return html`<div class="empty-page">
    <svg class="empty-mark" viewBox="0 0 80 60" aria-hidden="true">
      <path d="M8 8h28v44H8zM44 8h28v44H44z" fill="none" stroke="currentColor" stroke-width="1.4"/>
      <path d="M14 20h16M14 27h16M14 34h10M50 20h16M50 27h12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" opacity="0.55"/>
    </svg>
    <h2>${title}</h2>
    <p>${body}</p>
    ${actions ? html`<div class="btn-row">${actions}</div>` : ''}
  </div>`;
}

// Money, but set as a book sets money: the currency mark a little smaller
// than the figure it belongs to.
export function figure(cents, opts = {}) {
  return html`<span class="fig">${money(cents, opts)}</span>`;
}

export function planIcon(plan) {
  return html`<span class="pot-mark" style="--c:${plan.color}" aria-hidden="true">${plan.icon || ''}</span>`;
}

export function accountInitial(account) {
  return html`<span class="acct-mark" aria-hidden="true">${(account.institution || account.name).slice(0, 1).toUpperCase()}</span>`;
}

export function lastRead(account) {
  if (!account.balanceAt) return 'never read';
  return account.balanceAt === state.today ? 'read today' : `read ${account.balanceAt}`;
}
