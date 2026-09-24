// Date helpers. Every date in the app is an ISO calendar string 'YYYY-MM-DD'
// in the user's local calendar. Arithmetic runs in UTC so daylight-saving
// changes can never shift a date by a day.

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function toISO(y, m, d) {
  return `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
}

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidISODate(s) {
  if (typeof s !== 'string') return false;
  const match = ISO_RE.exec(s);
  if (!match) return false;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}

export function todayISO(now = new Date()) {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

// The calendar day a timestamp falls on, in the reader's own timezone.
// Slicing an ISO string instead gives the UTC day, which is a different day
// for most of the evening in the Americas — the sort of bug that shows up as
// "last read tomorrow".
export function dayOf(timestamp, { now = () => new Date() } = {}) {
  if (!timestamp) return null;
  const d = typeof timestamp === 'number' ? new Date(timestamp) : new Date(String(timestamp));
  if (Number.isNaN(d.getTime())) return null;
  return todayISO(d);
}

export function addDays(iso, n) {
  const { y, m, d } = parseISO(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return toISO(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

// Adds n months, keeping the anchor day where possible and clamping to the
// month's last day otherwise (Jan 31 + 1 month = Feb 28 or 29).
export function addMonthsClamped(iso, n, anchorDay) {
  const { y, m, d } = parseISO(iso);
  const day = anchorDay ?? d;
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return toISO(ny, nm, Math.min(day, daysInMonth(ny, nm)));
}

export function daysBetween(a, b) {
  const A = parseISO(a);
  const B = parseISO(b);
  return Math.round((Date.UTC(B.y, B.m - 1, B.d) - Date.UTC(A.y, A.m - 1, A.d)) / 86400000);
}

export function monthsBetween(a, b) {
  const A = parseISO(a);
  const B = parseISO(b);
  return (B.y - A.y) * 12 + (B.m - A.m);
}

// Month keys are 'YYYY-MM'.
export function monthKey(iso) {
  return iso.slice(0, 7);
}

export function monthKeyAdd(key, n) {
  const [y, m] = key.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${pad2((total % 12) + 1)}`;
}

export function monthRange(key) {
  const [y, m] = key.split('-').map(Number);
  return { start: `${key}-01`, end: toISO(y, m, daysInMonth(y, m)) };
}

export function isInMonth(iso, key) {
  return typeof iso === 'string' && iso.startsWith(`${key}-`);
}

export function dayOfWeek(iso) {
  const { y, m, d } = parseISO(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

const dtfCache = new Map();
function dtf(locale, opts) {
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = dtfCache.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' });
    } catch {
      f = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' });
    }
    dtfCache.set(key, f);
  }
  return f;
}

export function formatDate(iso, locale = 'en-US', opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!isValidISODate(iso)) return '';
  const { y, m, d } = parseISO(iso);
  return dtf(locale, opts).format(new Date(Date.UTC(y, m - 1, d)));
}

export function formatMonth(key, locale = 'en-US', opts = { month: 'long', year: 'numeric' }) {
  const [y, m] = key.split('-').map(Number);
  return dtf(locale, opts).format(new Date(Date.UTC(y, m - 1, 1)));
}

// Accepts ISO dates (optionally with a time part) and slash/dot/dash dates.
// `order` decides how 01/02/2024 is read: 'MDY' (US) or 'DMY'.
export function parseFlexibleDate(input, order = 'MDY') {
  const s = String(input ?? '').trim();
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) {
    const iso = toISO(Number(m[1]), Number(m[2]), Number(m[3]));
    return isValidISODate(iso) ? iso : null;
  }
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:[T\s].*)?$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let y = Number(m[3]);
    if (m[3].length === 2) y += y >= 70 ? 1900 : 2000;
    const [mo, d] = order === 'DMY' ? [b, a] : [a, b];
    const iso = toISO(y, mo, d);
    return isValidISODate(iso) ? iso : null;
  }
  return null;
}
