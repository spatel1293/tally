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

// Intl hands back a hyphen-minus, which is drawn short: measured in this
// face it is 2.8px narrower than the plus it has to line up with, so a
// column of gains and losses sits visibly crooked. U+2212 is cut to digit
// width in a tabular run and matches the plus exactly.
const trueMinus = (text) => text.replace(/-/g, '\u2212');

// A change, always signed, never signed when it is nought. The minus comes
// from Intl, so it is a real minus sign rather than a hyphen — a hyphen is
// visibly short and knocks a tabular column out of true.
export function signedMoney(cents, { currency = state.settings.currency, locale = state.settings.locale } = {}) {
  try {
    return trueMinus(new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      signDisplay: 'exceptZero',
    }).format(cents / 100));
  } catch {
    return `${cents > 0 ? '+' : cents < 0 ? '\u2212' : ''}$${Math.abs(cents / 100).toFixed(2)}`;
  }
}

export function signedPercent(bp, { locale = state.settings.locale } = {}) {
  try {
    return trueMinus(new Intl.NumberFormat(locale, {
      style: 'percent',
      signDisplay: 'exceptZero',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(bp / 10_000));
  } catch {
    return `${bp > 0 ? '+' : bp < 0 ? '\u2212' : ''}${Math.abs(bp / 100).toFixed(2)}%`;
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
