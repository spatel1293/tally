import { state } from '../store.js';
import { formatMoney } from '../core/money.js';
import { formatDate, formatMonth, daysBetween } from '../core/dates.js';
import { UNCATEGORIZED } from '../core/defaults.js';
import { html } from './html.js';

export function money(cents, opts = {}) {
  const { currency, locale } = state.settings;
  return formatMoney(cents, { currency, locale, ...opts });
}

// Amount with an explicit sign and color class for lists.
export function signedMoney(tx) {
  if (tx.type === 'income') return html`<span class="amt amt-in">${money(tx.amount, { sign: true })}</span>`;
  if (tx.refund) return html`<span class="amt amt-in">${money(tx.amount, { sign: true })}</span>`;
  return html`<span class="amt amt-out">${money(-tx.amount)}</span>`;
}

export function netMoney(cents, cls = '') {
  const tone = cents < 0 ? 'amt-neg' : cents > 0 ? 'amt-in' : '';
  return html`<span class="amt ${tone} ${cls}">${money(cents, { sign: true })}</span>`;
}

export function date(iso, opts) {
  return formatDate(iso, state.settings.locale, opts);
}

export function month(key, opts) {
  return formatMonth(key, state.settings.locale, opts);
}

export function relativeDay(iso) {
  const diff = daysBetween(state.today, iso);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  const sameYear = iso.slice(0, 4) === state.today.slice(0, 4);
  return date(iso, sameYear ? { weekday: 'short', month: 'short', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

export function percent(ratio, digits = 0) {
  try {
    return new Intl.NumberFormat(state.settings.locale, { style: 'percent', maximumFractionDigits: digits }).format(ratio);
  } catch {
    return `${(ratio * 100).toFixed(digits)}%`;
  }
}

export function timeAgo(isoTimestamp) {
  if (!isoTimestamp) return 'never';
  const then = new Date(isoTimestamp);
  if (Number.isNaN(then.getTime())) return 'never';
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  return `on ${then.toLocaleDateString(state.settings.locale, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

const fallbackCategory = { id: UNCATEGORIZED, name: 'Uncategorized', icon: '❔', color: '#8A93A3', type: 'expense', parentId: null };

export function categoryById(id) {
  return state.categories.find((c) => c.id === id) ?? fallbackCategory;
}

export function categoryPath(id) {
  const c = categoryById(id);
  const parent = c.parentId ? state.categories.find((p) => p.id === c.parentId) : null;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}

export function accountById(id) {
  return state.accounts.find((a) => a.id === id) ?? null;
}

export function badge(category, size = '') {
  return html`<span class="badge ${size}" style="--c:${category.color}" aria-hidden="true">${category.icon}</span>`;
}

export function plural(n, one, many = `${one}s`) {
  return `${n.toLocaleString(state.settings.locale)} ${n === 1 ? one : many}`;
}

// Categories of one type in display order: each parent followed by its children.
export function categoryTree(type, excludeId = null) {
  const out = [];
  const tops = state.categories.filter((c) => c.type === type && !c.parentId && c.id !== excludeId);
  for (const top of tops) {
    out.push({ cat: top, parent: null });
    for (const kid of state.categories) {
      if (kid.parentId === top.id && kid.id !== excludeId) out.push({ cat: kid, parent: top });
    }
  }
  // Subcategories whose parent is excluded or missing still need to appear.
  for (const c of state.categories) {
    if (c.type === type && c.parentId && c.id !== excludeId && !out.some((o) => o.cat.id === c.id)) out.push({ cat: c, parent: null });
  }
  return out;
}

export function categoryOptionLabel({ cat, parent }) {
  return parent ? `\u2003${cat.icon} ${cat.name}` : `${cat.icon} ${cat.name}`;
}
