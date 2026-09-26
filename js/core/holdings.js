// Positions, prices, and what they are worth together.
//
// Money is integer cents, as it is everywhere else in this book. Two new
// quantities arrive with positions, and neither can be an integer:
//
//   * share counts, because Robinhood and Wealthfront both deal in
//     fractional shares — 0.371482 of a share is a real position;
//   * prices, because a quote comes back as "225.5100", four decimals.
//
// Both are held as scaled integers rather than floats, for exactly the
// reason money is: a portfolio that is a few cents out every time it is
// priced is a portfolio nobody trusts. Shares are micro-shares (1e6) and
// prices are micro-dollars (1e6). The multiplication that turns them into
// cents is done in BigInt and rounded once, at the very end.
//
// Everything here is pure: no network, no browser, no locale.

export const SHARE_SCALE = 1_000_000; // micro-shares
export const PRICE_SCALE = 1_000_000; // micro-dollars

// A position is worth what a bank would pay for it, so quantities are
// generous but not unbounded: a billion shares and a million a share.
export const MAX_SHARES = 1_000_000_000 * SHARE_SCALE;
export const MAX_PRICE = 1_000_000 * PRICE_SCALE;

// ---------- Reading decimals exactly ----------

// The one parser both shares and prices go through. A decimal string becomes
// a scaled integer with no float in the path: the fractional digits are
// padded or truncated to the scale's width, rounded half away from zero on
// the first digit dropped, and assembled with BigInt.
//
// `scale` must be a power of ten. Returns null for anything that is not a
// plain decimal number, rather than guessing.
function parseScaled(text, scale, max) {
  const s = String(text ?? '').trim();
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;

  const digits = String(scale).length - 1;
  const negative = m[1] === '-';
  const frac = m[3] ?? '';
  const kept = (frac + '0'.repeat(digits)).slice(0, digits);

  let value = BigInt(m[2]) * BigInt(scale) + BigInt(kept || '0');
  // Round half away from zero on the first digit we are about to drop.
  if (frac.length > digits && Number(frac[digits]) >= 5) value += 1n;

  const n = Number(value);
  if (!Number.isSafeInteger(n) || n > max) return null;
  return negative ? -n : n;
}

// A share count. Negative is refused: a short position is not something this
// book models, and silently flipping the sign of a fat-fingered entry would
// be worse than saying no.
export function parseShares(text) {
  const n = parseScaled(text, SHARE_SCALE, MAX_SHARES);
  return n == null || n < 0 ? null : n;
}

// A quoted price. Also refuses negatives, for the same reason.
export function parsePrice(text) {
  const n = parseScaled(text, PRICE_SCALE, MAX_PRICE);
  return n == null || n < 0 ? null : n;
}

// ---------- What a position is worth ----------

// shares × price, in cents, exactly.
//
//   cents = (shares / 1e6) × (price / 1e6) × 100
//         = shares × price / 1e10
//
// Done in BigInt so the product — which can run to nineteen digits and would
// lose its tail as a double — is exact, and rounded half away from zero once
// at the end.
export function positionValue(shares, priceMicro) {
  if (!Number.isSafeInteger(shares) || !Number.isSafeInteger(priceMicro)) return null;
  if (shares < 0 || priceMicro < 0) return null;

  const divisor = BigInt(SHARE_SCALE) * BigInt(PRICE_SCALE) / 100n; // 1e10
  const product = BigInt(shares) * BigInt(priceMicro);
  const whole = product / divisor;
  const remainder = product % divisor;

  // Round half up. Both operands are non-negative, so "away from zero" and
  // "up" are the same thing here.
  const rounded = remainder * 2n >= divisor ? whole + 1n : whole;
  const cents = Number(rounded);
  return Number.isSafeInteger(cents) ? cents : null;
}

// ---------- Displaying quantities ----------

// Share counts are written the way a statement writes them: whole shares
// plain, fractional shares with only as many decimals as they actually have,
// never trailing zeroes. 12 shares is "12", not "12.000000".
export function formatShares(shares) {
  if (!Number.isSafeInteger(shares)) return '';
  const negative = shares < 0;
  const abs = Math.abs(shares);
  const whole = Math.trunc(abs / SHARE_SCALE);
  const frac = String(abs % SHARE_SCALE).padStart(6, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac ? `.${frac}` : ''}`;
}

// A price, always to the cent at least, and to four places when the extra
// digits carry information — which they do for anything thinly priced.
export function formatPrice(priceMicro, { currency = 'USD', locale = 'en-US' } = {}) {
  if (!Number.isSafeInteger(priceMicro)) return '';
  const value = priceMicro / PRICE_SCALE;
  const extra = priceMicro % 10_000 !== 0; // finer than a cent
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: extra ? 4 : 2,
    }).format(value);
  } catch {
    return `$${value.toFixed(extra ? 4 : 2)}`;
  }
}

// ---------- A book of positions ----------

// A symbol is how the price feed will be asked for a quote, so it is
// normalised once here rather than at every call site.
export function normalizeSymbol(symbol) {
  return String(symbol ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidSymbol(symbol) {
  // Tickers, share classes (BRK.B) and a few hyphenated listings. Deliberately
  // strict: anything stranger is likelier a typo than a real listing.
  return /^[A-Z][A-Z0-9]{0,5}([.\-][A-Z0-9]{1,4})?$/.test(normalizeSymbol(symbol));
}

// Every distinct symbol a book holds, in one list, so the price feed can be
// asked for all of them in a single request.
export function symbolsHeld(accounts) {
  const seen = new Set();
  for (const account of accounts ?? []) {
    for (const position of account?.positions ?? []) {
      const symbol = normalizeSymbol(position?.symbol);
      if (symbol) seen.add(symbol);
    }
  }
  return [...seen].sort();
}

// What one account is worth: its positions at the given prices, plus any
// uninvested cash sitting in it.
//
// `prices` is a Map of symbol to micro-dollars. A symbol with no price is
// reported rather than quietly counted as zero — a portfolio that silently
// loses a holding because a quote failed is worse than one that says so.
export function valueAccount(account, prices) {
  const lines = [];
  const missing = [];
  let invested = 0;

  for (const position of account?.positions ?? []) {
    const symbol = normalizeSymbol(position?.symbol);
    const shares = Number.isSafeInteger(position?.shares) ? position.shares : 0;
    const priceMicro = prices?.get?.(symbol);

    if (priceMicro == null) {
      missing.push(symbol);
      lines.push({ symbol, shares, priceMicro: null, cents: null });
      continue;
    }

    const cents = positionValue(shares, priceMicro);
    if (cents == null) {
      missing.push(symbol);
      lines.push({ symbol, shares, priceMicro, cents: null });
      continue;
    }

    invested += cents;
    lines.push({ symbol, shares, priceMicro, cents });
  }

  const cash = Number.isSafeInteger(account?.cash) ? account.cash : 0;
  return {
    id: account?.id ?? null,
    lines,
    missing,
    cash,
    invested,
    // Only a complete valuation is worth filing as a reading. If any holding
    // could not be priced the total would understate the account, so it is
    // marked and the caller decides.
    total: invested + cash,
    complete: missing.length === 0,
  };
}

// The whole book, valued at once.
export function valueBook(accounts, prices) {
  const byAccount = (accounts ?? []).map((a) => valueAccount(a, prices));
  const missing = [...new Set(byAccount.flatMap((v) => v.missing))].sort();
  return {
    byAccount,
    missing,
    invested: byAccount.reduce((sum, v) => sum + v.invested, 0),
    cash: byAccount.reduce((sum, v) => sum + v.cash, 0),
    total: byAccount.reduce((sum, v) => sum + v.total, 0),
    complete: missing.length === 0,
  };
}

// What today did.
//
// A day's movement is the only number a portfolio is really opened for, and
// it is the difference between what the holdings are worth now and what they
// were worth at the previous close. Cash does not move, so it is left out of
// both sides — otherwise a large cash balance would quietly flatten the
// percentage and make every day look like nothing happened.
//
// `quotes` is a Map of symbol to { price, previousClose }. A holding whose
// previous close is unknown is skipped on both sides rather than counted as
// unchanged, so the percentage stays honest about what it could see.
export function dayChange(accounts, quotes) {
  let now = 0;
  let before = 0;
  let counted = 0;

  for (const account of accounts ?? []) {
    for (const position of account?.positions ?? []) {
      const symbol = normalizeSymbol(position?.symbol);
      const quote = quotes?.get?.(symbol);
      if (!quote || quote.previousClose == null) continue;

      const shares = Number.isSafeInteger(position?.shares) ? position.shares : 0;
      const nowCents = positionValue(shares, quote.price);
      const beforeCents = positionValue(shares, quote.previousClose);
      if (nowCents == null || beforeCents == null) continue;

      now += nowCents;
      before += beforeCents;
      counted += 1;
    }
  }

  if (!counted || before === 0) return null;
  const cents = now - before;
  return {
    cents,
    // Basis points, as every percentage in this book is.
    bp: Math.round((cents * 10_000) / before),
    counted,
  };
}

// How the book is spread across what it holds, largest first. Percentages are
// basis points, as everywhere else, and the largest slice absorbs the
// rounding so the parts always sum to exactly 100%.
export function allocation(valued) {
  const bySymbol = new Map();
  for (const account of valued?.byAccount ?? []) {
    for (const line of account.lines) {
      if (line.cents == null) continue;
      bySymbol.set(line.symbol, (bySymbol.get(line.symbol) ?? 0) + line.cents);
    }
  }
  if ((valued?.cash ?? 0) > 0) bySymbol.set('Cash', (bySymbol.get('Cash') ?? 0) + valued.cash);

  const total = [...bySymbol.values()].reduce((s, c) => s + c, 0);
  const rows = [...bySymbol.entries()]
    .map(([symbol, cents]) => ({ symbol, cents, bp: total > 0 ? Math.floor((cents * 10_000) / total) : 0 }))
    .sort((a, b) => b.cents - a.cents || a.symbol.localeCompare(b.symbol));

  const spare = 10_000 - rows.reduce((s, r) => s + r.bp, 0);
  if (rows.length && spare > 0) rows[0].bp += spare;
  return rows;
}
