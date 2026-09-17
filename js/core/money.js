// Money is always stored as an integer number of hundredths ("cents"),
// whatever the currency. Only display code converts to decimals, so sums
// are exact and there is no floating-point drift.

export const MAX_CENTS = 100_000_000_000; // 1,000,000,000.00

export function isValidCents(n) {
  return Number.isSafeInteger(n) && n > 0 && n <= MAX_CENTS;
}

export function isValidSignedCents(n) {
  return Number.isSafeInteger(n) && Math.abs(n) <= MAX_CENTS;
}

const sepCache = new Map();
export function getSeparators(locale = 'en-US') {
  let seps = sepCache.get(locale);
  if (!seps) {
    seps = { group: ',', decimal: '.' };
    try {
      const parts = new Intl.NumberFormat(locale).formatToParts(1234567.5);
      seps = {
        group: parts.find((p) => p.type === 'group')?.value ?? ',',
        decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
      };
    } catch {
      // keep defaults
    }
    sepCache.set(locale, seps);
  }
  return seps;
}

function fail(error) {
  return { ok: false, error };
}

// Parses what a person types ("12", "12.5", "$1,234.56", "1.234,56", "(20)")
// into cents. Returns { ok, cents, negative } or { ok: false, error }.
export function parseAmount(input, { locale = 'en-US' } = {}) {
  let s = String(input ?? '').trim();
  if (!s) return fail('Enter an amount.');

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s
    .replace(/[\s\u00a0\u202f]/g, '')
    .replace(/\p{Sc}/gu, '')
    .replace(/^[A-Z]{3}(?=[-+\u2212\d.,])/, '')
    .replace(/([\d.,])[A-Z]{3}$/, '$1');

  if (/^[-\u2212]/.test(s)) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  } else if (/[-\u2212]$/.test(s)) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  // A currency symbol after the sign ("-$12") was already removed above.
  s = s.replace(/['\u2019]/g, '');

  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) {
    return fail('Use numbers only, like 12.50.');
  }

  const { group } = getSeparators(locale);
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let decimalChar = null;
  if (lastDot !== -1 && lastComma !== -1) {
    decimalChar = lastDot > lastComma ? '.' : ',';
  } else if (lastDot !== -1 || lastComma !== -1) {
    const ch = lastDot !== -1 ? '.' : ',';
    const count = s.split(ch).length - 1;
    const digitsAfter = s.length - s.lastIndexOf(ch) - 1;
    const looksGrouped = count > 1 || (digitsAfter === 3 && ch === group);
    decimalChar = looksGrouped ? null : ch;
  }

  let intPart = s;
  let fracPart = '';
  if (decimalChar) {
    const idx = s.lastIndexOf(decimalChar);
    intPart = s.slice(0, idx);
    fracPart = s.slice(idx + 1);
    if (intPart.includes(decimalChar)) return fail('Check the number format, like 1,234.50.');
    if (/[.,]/.test(fracPart)) return fail('Check the number format, like 1,234.50.');
  }
  if (/[.,]/.test(intPart)) {
    if (!/^\d{1,3}([.,]\d{3})+$/.test(intPart)) return fail('Check the number format, like 1,234.50.');
    const seps = new Set(intPart.replace(/\d/g, ''));
    if (seps.size > 1) return fail('Check the number format, like 1,234.50.');
  }
  const digits = intPart.replace(/[.,]/g, '') || '0';
  if (fracPart.length > 2) return fail('Use at most 2 decimal places.');
  if (digits.replace(/^0+/, '').length > 10) return fail('That amount is too large.');

  const cents = Number(digits) * 100 + Number((fracPart + '00').slice(0, 2));
  if (cents > MAX_CENTS) return fail('That amount is too large.');
  return { ok: true, cents, negative: negative && cents !== 0 };
}

const fmtCache = new Map();
function currencyFormatter(currency, locale, compact, signDisplay) {
  const key = `${currency}|${locale}|${compact}|${signDisplay}`;
  let f = fmtCache.get(key);
  if (f) return f;
  const opts = { style: 'currency', currency, signDisplay };
  if (compact) {
    opts.notation = 'compact';
    opts.minimumFractionDigits = 0;
    opts.maximumFractionDigits = 1;
  }
  try {
    f = new Intl.NumberFormat(locale, opts);
  } catch {
    try {
      f = new Intl.NumberFormat('en-US', { ...opts, currency: 'USD' });
    } catch {
      f = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
    }
  }
  fmtCache.set(key, f);
  return f;
}

export function formatMoney(cents, { currency = 'USD', locale = 'en-US', sign = false, compact = false } = {}) {
  const value = Number.isFinite(cents) ? cents : 0;
  const f = currencyFormatter(currency, locale, compact, sign ? 'exceptZero' : 'auto');
  // `+ 0` turns -0 into 0 so zero never shows as "-$0.00".
  return f.format(value / 100 + 0);
}

export function currencyDigits(currency) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  } catch {
    return 2;
  }
}

export function isSupportedCurrency(code) {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat('en-US', { style: 'currency', currency: code });
    return true;
  } catch {
    return false;
  }
}

// For pre-filling an input: 1250 -> "12.50" (or "12,50"), no grouping.
export function centsToInput(cents, { locale = 'en-US' } = {}) {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const sign = cents < 0 ? '-' : '';
  if (frac === 0) return `${sign}${whole}`;
  return `${sign}${whole}${getSeparators(locale).decimal}${String(frac).padStart(2, '0')}`;
}

// Machine-readable decimal for CSV export: 123450 -> "1234.50".
export function centsToDecimalString(cents) {
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// Scales an amount by a rational factor with round-half-away-from-zero.
export function scaleCents(cents, numerator, denominator) {
  const raw = (cents * numerator) / denominator;
  return Math.sign(raw) * Math.round(Math.abs(raw));
}
