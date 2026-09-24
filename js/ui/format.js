import { state } from '../store.js';
import { formatMoney } from '../core/money.js';
import { formatDate, formatMonth, daysBetween } from '../core/dates.js';

export function money(cents, opts = {}) {
  const { currency, locale } = state.settings;
  return formatMoney(cents, { currency, locale, ...opts });
}

export function date(iso, opts) {
  return formatDate(iso, state.settings.locale, opts);
}

export function monthLabel(key, opts) {
  return formatMonth(key, state.settings.locale, opts);
}

export function relativeDay(iso) {
  const diff = daysBetween(state.today, iso);
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  const sameYear = iso.slice(0, 4) === state.today.slice(0, 4);
  return date(iso, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
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

export function plural(n, one, many = `${one}s`) {
  return `${n.toLocaleString(state.settings.locale)} ${n === 1 ? one : many}`;
}
