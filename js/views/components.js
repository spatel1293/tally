import { html } from '../ui/html.js';
import { state } from '../store.js';
import { monthKey } from '../core/dates.js';
import { badge, categoryById, categoryPath, accountById, signedMoney, month } from '../ui/format.js';

// UI state shared between views (not persisted).
export const ui = {
  month: null, // 'YYYY-MM' shown on Home and Budgets
};

export function currentMonth() {
  return monthKey(state.today);
}

export function viewMonth() {
  return ui.month ?? currentMonth();
}

export const icons = {
  prev: html`<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  next: html`<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  plus: html`<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  up: html`<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  down: html`<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  search: html`<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  chevron: html`<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  repeat: html`<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M17 3l3 3-3 3M4 11V9a3 3 0 013-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 01-3 3H4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

export function pageHead(title, actions = '') {
  return html`<header class="page-head"><h1>${title}</h1>${actions ? html`<div class="page-actions">${actions}</div>` : ''}</header>`;
}

export function monthSwitcher(key) {
  const isCurrent = key === currentMonth();
  return html`<div class="month-nav">
    <button type="button" class="icon-btn" data-action="month-shift" data-step="-1" aria-label="Previous month" title="Previous month ([)">${icons.prev}</button>
    <h1 class="month-title" aria-live="polite">${month(key)}</h1>
    <button type="button" class="icon-btn" data-action="month-shift" data-step="1" aria-label="Next month" title="Next month (])">${icons.next}</button>
    ${isCurrent ? '' : html`<button type="button" class="link-btn" data-action="month-today">Back to this month</button>`}
  </div>`;
}

export function emptyState({ title, body, actions = '' }) {
  return html`<div class="empty">
    <svg class="empty-mark" viewBox="0 0 64 40" aria-hidden="true"><path d="M8 6v28M18 6v28M28 6v28M38 6v28M2 30L46 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none"/></svg>
    <h2>${title}</h2>
    <p>${body}</p>
    ${actions ? html`<div class="btn-row">${actions}</div>` : ''}
  </div>`;
}

export function txRow(t) {
  const cat = categoryById(t.categoryId);
  const acct = t.accountId ? accountById(t.accountId) : null;
  const title = t.note || cat.name;
  return html`<li>
    <button type="button" class="tx-row" data-action="edit-tx" data-id="${t.id}">
      ${badge(cat)}
      <span class="tx-main">
        <span class="tx-title">${title}</span>
        <span class="tx-sub">
          ${t.note ? html`<span>${categoryPath(t.categoryId)}</span>` : cat.parentId ? html`<span>${categoryPath(t.categoryId)}</span>` : ''}
          ${acct && state.accounts.length > 1 ? html`<span>${acct.name}</span>` : ''}
          ${t.refund ? html`<span class="tag">Refund</span>` : ''}
          ${t.recurringId ? html`<span class="tag" title="Created by a repeating transaction">${icons.repeat}Repeats</span>` : ''}
        </span>
      </span>
      ${signedMoney(t)}
    </button>
  </li>`;
}

export function sectionHead(title, link = null) {
  return html`<div class="section-head"><h2>${title}</h2>${link ?? ''}</div>`;
}
