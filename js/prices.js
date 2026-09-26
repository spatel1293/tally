// Asking what things are worth.
//
// The whole book is priced in a single request: Twelve Data takes a
// comma-separated list of symbols, which matters because the free key allows
// 800 requests a day and 8 a minute. Pricing twenty holdings costs one of
// those, not twenty.
//
// It answers with `Access-Control-Allow-Origin: *`, so the phone calls it
// directly and nothing of ours sits in between. That was checked by probe
// before it was chosen — Yahoo's endpoints, the obvious alternative, send no
// CORS headers at all and cannot be called from a browser however much the
// internet says otherwise.
//
// Prices come back as decimal strings, which is the reason this one is a
// good fit: they convert to exact scaled integers with no float in the path.
//
// `/quote` is used rather than `/price` because it costs the same single
// request and carries the previous close as well, which is what makes "what
// did today do" possible without a second call.

import { parsePrice, normalizeSymbol } from './core/holdings.js';

const ENDPOINT = 'https://api.twelvedata.com/quote';
const TIMEOUT_MS = 20000;

// The free key allows 8 requests a minute. One request prices everything, so
// this only ever bites when someone taps refresh repeatedly.
const MIN_GAP_MS = 8000;
let lastCallAt = 0;

export function describePriceError(code) {
  switch (code) {
    case 'no-key':
      return 'No price key yet. Add a free Twelve Data key in the endpapers and the figures start moving.';
    case 'rate':
      return 'The price feed is being asked too often. Give it a few seconds.';
    case 'quota':
      return 'Today’s free price requests are used up. They reset tomorrow; the last figures stand until then.';
    case 'key':
      return 'The price feed turned that key down. Check it in the endpapers.';
    case 'offline':
      return 'Couldn’t reach the price feed. The last figures stand.';
    case 'slow':
      return 'The price feed didn’t answer in time. The last figures stand.';
    default:
      return 'The price feed sent something unreadable. The last figures stand.';
  }
}

function fail(code) {
  return { ok: false, code, error: describePriceError(code) };
}

// One symbol's quote, whatever wrapper it arrived in.
function readQuote(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.status === 'error') return null;
  const price = parsePrice(entry.close ?? entry.price);
  if (price == null) return null;
  return {
    price,
    // The previous close is what makes a day's movement showable. It is
    // optional: a newly listed holding has none, and that is not an error.
    previousClose: parsePrice(entry.previous_close),
    name: typeof entry.name === 'string' ? entry.name.slice(0, 80) : '',
    currency: typeof entry.currency === 'string' ? entry.currency.toUpperCase() : '',
    marketOpen: entry.is_market_open === true,
  };
}

// Twelve Data answers one symbol with a bare quote object and several with a
// map keyed by symbol. The shape is detected rather than inferred from how
// many were asked for, because a one-symbol book should not take a different
// code path from a two-symbol one.
function readQuotes(body, symbols) {
  const quotes = new Map();
  const refused = [];

  const single = body && typeof body === 'object' && (body.close != null || body.price != null);
  if (single) {
    const quote = readQuote(body);
    const symbol = normalizeSymbol(body.symbol) || symbols[0];
    if (quote) quotes.set(symbol, quote);
    for (const s of symbols) if (!quotes.has(s)) refused.push(s);
    return { quotes, refused };
  }

  for (const symbol of symbols) {
    const quote = readQuote(body?.[symbol]);
    if (quote) quotes.set(symbol, quote);
    else refused.push(symbol);
  }
  return { quotes, refused };
}

// Prices every symbol given, in one request.
//
// Returns { ok, quotes: Map<symbol, quote>, refused: string[] }. A symbol the
// feed would not price is reported rather than dropped, because a holding
// that silently vanishes from a total is the worst failure available here.
export async function fetchQuotes(symbols, apiKey, { now = Date.now, fetchFn = fetch } = {}) {
  const wanted = [...new Set((symbols ?? []).map(normalizeSymbol).filter(Boolean))];
  if (!wanted.length) return { ok: true, quotes: new Map(), refused: [] };
  if (!apiKey) return fail('no-key');

  const since = now() - lastCallAt;
  if (lastCallAt && since < MIN_GAP_MS) return fail('rate');

  const url = `${ENDPOINT}?symbol=${encodeURIComponent(wanted.join(','))}&apikey=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetchFn(url, { signal: controller.signal });
  } catch (err) {
    return fail(err?.name === 'AbortError' ? 'slow' : 'offline');
  } finally {
    clearTimeout(timer);
    lastCallAt = now();
  }

  if (response.status === 429) return fail('quota');
  if (response.status === 401 || response.status === 403) return fail('key');
  if (!response.ok) return fail('unreadable');

  let body;
  try {
    body = await response.json();
  } catch {
    return fail('unreadable');
  }

  // The feed reports its own errors inside a 200, with a numeric code.
  if (body?.status === 'error') {
    const code = Number(body.code);
    if (code === 429) return fail('quota');
    if (code === 401 || code === 403) return fail('key');
    return fail('unreadable');
  }

  const { quotes, refused } = readQuotes(body, wanted);
  return { ok: true, quotes, refused };
}

// Only the prices, for the valuation functions in core/holdings.js, which
// have no business knowing what a quote looks like.
export function pricesFrom(quotes) {
  const prices = new Map();
  for (const [symbol, quote] of quotes ?? []) prices.set(symbol, quote.price);
  return prices;
}
