import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseShares, parsePrice, positionValue, formatShares, formatPrice,
  normalizeSymbol, isValidSymbol, symbolsHeld, valueAccount, valueBook, allocation,
  SHARE_SCALE, PRICE_SCALE, MAX_SHARES,
} from '../js/core/holdings.js';
import { newAccount } from '../js/core/defaults.js';
import { sanitizeAccount } from '../js/core/validate.js';
import { fetchQuotes, pricesFrom } from '../js/prices.js';

// A share count and a price are both decimals that must never become floats,
// for the same reason money never does: a portfolio that is a few cents out
// every time it is priced is a portfolio nobody trusts.
describe('parsing quantities', () => {
  test('reads whole and fractional shares exactly', () => {
    assert.equal(parseShares('12'), 12 * SHARE_SCALE);
    assert.equal(parseShares('0.371482'), 371482);
    assert.equal(parseShares('10.5'), 10_500_000);
    assert.equal(parseShares('  7 '), 7 * SHARE_SCALE);
  });

  test('rounds half away from zero at the edge of its precision', () => {
    assert.equal(parseShares('1.0000005'), 1_000_001);
    assert.equal(parseShares('1.0000004'), 1_000_000);
  });

  test('refuses a short position rather than flipping its sign', () => {
    assert.equal(parseShares('-5'), null);
    assert.equal(parsePrice('-1.00'), null);
  });

  test('refuses anything that is not a plain decimal', () => {
    for (const bad of ['', '  ', 'abc', '1,234', '1e5', '1.2.3', null, undefined, {}]) {
      assert.equal(parseShares(bad), null, `should refuse ${JSON.stringify(bad)}`);
    }
  });

  test('refuses a quantity too large to hold exactly', () => {
    assert.equal(parseShares('999999999999'), null);
    assert.equal(parseShares(String(MAX_SHARES)), null);
  });

  test('reads a price to six places, which is what the feed sends', () => {
    assert.equal(parsePrice('225.5100'), 225_510_000);
    assert.equal(parsePrice('341.040009'), 341_040_009);
    assert.equal(parsePrice('0.0001'), 100);
  });
});

// The multiplication is the whole reason this module exists.
describe('positionValue', () => {
  test('multiplies shares by price exactly', () => {
    assert.equal(positionValue(parseShares('1'), parsePrice('8225.35')), 822_535);
    assert.equal(positionValue(parseShares('100'), parsePrice('225.51')), 2_255_100);
    assert.equal(positionValue(parseShares('0'), parsePrice('225.51')), 0);
  });

  test('survives the cases a float gets wrong', () => {
    // 3 × 0.10 is 0.30, not 0.30000000000000004.
    assert.equal(positionValue(parseShares('3'), parsePrice('0.1')), 30);
    assert.equal(positionValue(parseShares('0.1'), parsePrice('0.2')), 2);
  });

  test('rounds half away from zero, once, at the end', () => {
    // 0.5 × $0.05 = 2.5c
    assert.equal(positionValue(parseShares('0.5'), parsePrice('0.05')), 3);
    // 0.5 × $0.03 = 1.5c
    assert.equal(positionValue(parseShares('0.5'), parsePrice('0.03')), 2);
  });

  test('agrees with exact rational arithmetic on an awkward pair', () => {
    const shares = parseShares('7.123456');
    const price = parsePrice('412.9987');
    const product = BigInt(shares) * BigInt(price);
    const divisor = 10_000_000_000n;
    const whole = product / divisor;
    const expected = Number(product % divisor * 2n >= divisor ? whole + 1n : whole);
    assert.equal(positionValue(shares, price), expected);
  });

  test('refuses nonsense rather than returning a wrong number', () => {
    assert.equal(positionValue(1.5, 100), null);
    assert.equal(positionValue(-1, 100), null);
    assert.equal(positionValue(100, -1), null);
  });
});

describe('formatting', () => {
  test('writes share counts the way a statement does', () => {
    assert.equal(formatShares(12 * SHARE_SCALE), '12');
    assert.equal(formatShares(1_500_000), '1.5');
    assert.equal(formatShares(371_482), '0.371482');
    assert.equal(formatShares(0), '0');
  });

  test('prices to the cent, or finer when the digits carry information', () => {
    assert.match(formatPrice(225_510_000), /225\.51$/);
    assert.match(formatPrice(341_040_009), /341\.04/);
  });
});

describe('symbols', () => {
  test('accepts tickers and share classes, refuses prose', () => {
    for (const good of ['VTI', 'BND', 'BRK.B', 'AAPL', 'RY-A']) assert.ok(isValidSymbol(good), good);
    for (const bad of ['', 'not a ticker', 'TOOLONGSYM', '123']) assert.ok(!isValidSymbol(bad), bad);
  });

  test('normalises case and stray space', () => {
    assert.equal(normalizeSymbol(' vti '), 'VTI');
    assert.equal(normalizeSymbol('brk.b'), 'BRK.B');
  });

  test('gathers every distinct symbol the book holds, so one request prices all', () => {
    const accounts = [
      newAccount({ id: 'a', positions: [{ symbol: 'VTI', shares: 1 }, { symbol: 'BND', shares: 1 }] }),
      newAccount({ id: 'b', positions: [{ symbol: 'VTI', shares: 1 }] }),
    ];
    assert.deepEqual(symbolsHeld(accounts), ['BND', 'VTI']);
  });
});

describe('valuing an account', () => {
  const prices = new Map([['VTI', 280_500_000], ['BND', 72_123_400]]);
  const account = newAccount({
    id: 'a',
    positions: [{ symbol: 'VTI', shares: parseShares('10') }, { symbol: 'BND', shares: parseShares('5.5') }],
    cash: 12_345,
  });

  test('adds up its positions and its cash', () => {
    const v = valueAccount(account, prices);
    assert.equal(v.invested, positionValue(parseShares('10'), 280_500_000) + positionValue(parseShares('5.5'), 72_123_400));
    assert.equal(v.total, v.invested + 12_345);
    assert.equal(v.complete, true);
  });

  // The failure that would matter most: a holding quietly worth nothing.
  test('reports a holding it could not price rather than counting it as zero', () => {
    const v = valueAccount(account, new Map([['VTI', 280_500_000]]));
    assert.deepEqual(v.missing, ['BND']);
    assert.equal(v.complete, false);
    assert.equal(v.lines.find((l) => l.symbol === 'BND').cents, null);
    // The priced one still counts; the total is simply known to be partial.
    assert.equal(v.invested, positionValue(parseShares('10'), 280_500_000));
  });

  test('an account with nothing in it is worth its cash', () => {
    const v = valueAccount(newAccount({ id: 'c', cash: 500 }), prices);
    assert.equal(v.total, 500);
    assert.equal(v.complete, true);
  });
});

describe('the book as a whole', () => {
  const prices = new Map([['VTI', 100_000_000], ['BND', 50_000_000]]);
  const accounts = [
    newAccount({ id: 'a', positions: [{ symbol: 'VTI', shares: parseShares('10') }] }),
    newAccount({ id: 'b', positions: [{ symbol: 'BND', shares: parseShares('10') }], cash: 25_000 }),
  ];

  test('totals every account', () => {
    const book = valueBook(accounts, prices);
    assert.equal(book.invested, 100_000 + 50_000);
    assert.equal(book.cash, 25_000);
    assert.equal(book.total, 175_000);
  });

  test('allocation is in basis points and always sums to exactly 100%', () => {
    const rows = allocation(valueBook(accounts, prices));
    assert.equal(rows.reduce((s, r) => s + r.bp, 0), 10_000);
    // Largest first: VTI $1,000, BND $500, Cash $250.
    assert.deepEqual(rows.map((r) => r.symbol), ['VTI', 'BND', 'Cash']);
  });

  test('breaks a tie by name, so the order never wobbles between renders', () => {
    const tied = [
      newAccount({ id: '1', positions: [{ symbol: 'VTI', shares: parseShares('1') }], cash: 100_000_00 }),
    ];
    const rows = allocation(valueBook(tied, new Map([['VTI', 100_000 * PRICE_SCALE]])));
    assert.deepEqual(rows.map((r) => r.symbol), ['Cash', 'VTI']);
    assert.equal(rows.reduce((s, r) => s + r.bp, 0), 10_000);
  });

  test('allocation still sums to 100% when the split does not divide evenly', () => {
    const three = [
      newAccount({ id: '1', positions: [{ symbol: 'VTI', shares: parseShares('1') }] }),
      newAccount({ id: '2', positions: [{ symbol: 'BND', shares: parseShares('1') }] }),
      newAccount({ id: '3', positions: [{ symbol: 'VTI', shares: parseShares('1') }] }),
    ];
    const rows = allocation(valueBook(three, new Map([['VTI', 1_000_000], ['BND', 1_000_000]])));
    assert.equal(rows.reduce((s, r) => s + r.bp, 0), 10_000);
  });
});

// Rule 9: a record written today and one restored from a backup must be
// identical. Positions are whitelisted field by field, so this is the test
// that catches the quietest failure available in this codebase.
describe('positions survive a backup round trip', () => {
  test('valid positions are kept, normalised, and complete', () => {
    const written = newAccount({
      id: 'a1',
      name: 'Brokerage',
      positions: [{ symbol: 'vti', shares: parseShares('10.5'), costBasis: 250_000 }],
      cash: 4_200,
    });
    const restored = sanitizeAccount(written, 0);
    assert.deepEqual(restored.positions, [{ symbol: 'VTI', shares: 10_500_000, costBasis: 250_000 }]);
    assert.equal(restored.cash, 4_200);
  });

  test('a position that could never be priced is dropped, not carried', () => {
    const restored = sanitizeAccount(newAccount({
      id: 'a1',
      name: 'Brokerage',
      positions: [
        { symbol: 'BAD SYMBOL', shares: 1 },
        { symbol: 'BND', shares: -5 },
        { symbol: 'VTI', shares: 1_000_000 },
      ],
    }), 0);
    assert.deepEqual(restored.positions.map((p) => p.symbol), ['VTI']);
  });

  test('no field newAccount makes is lost on the way back', () => {
    const restored = sanitizeAccount(newAccount({ id: 'a1', name: 'Brokerage' }), 0);
    for (const key of Object.keys(newAccount())) {
      assert.ok(key in restored, `${key} was dropped by sanitizeAccount`);
    }
  });
});

// The feed answers one symbol and several symbols with different shapes, and
// both arrive here as one thing.
describe('the price feed', () => {
  const ok = (body) => async () => ({ ok: true, status: 200, json: async () => body });
  let clock = 1_000_000;
  const now = () => clock;
  const advance = () => { clock += 20_000; };

  test('reads the shape a single symbol comes back in', async () => {
    advance();
    const r = await fetchQuotes(['AAPL'], 'k', { now, fetchFn: ok({ symbol: 'AAPL', close: '341.070007', previous_close: '335.92001', name: 'Apple Inc.' }) });
    assert.equal(r.ok, true);
    assert.equal(r.quotes.get('AAPL').price, 341_070_007);
    assert.equal(r.quotes.get('AAPL').previousClose, 335_920_010);
    assert.equal(r.quotes.get('AAPL').name, 'Apple Inc.');
  });

  test('reads the shape several symbols come back in', async () => {
    advance();
    const r = await fetchQuotes(['VTI', 'BND'], 'k', {
      now,
      fetchFn: ok({ VTI: { close: '280.50' }, BND: { close: '72.1234' } }),
    });
    assert.equal(r.quotes.size, 2);
    assert.equal(r.quotes.get('BND').price, 72_123_400);
    assert.deepEqual(r.refused, []);
  });

  test('reports a symbol it could not price', async () => {
    advance();
    const r = await fetchQuotes(['VTI', 'NOPE'], 'k', {
      now,
      fetchFn: ok({ VTI: { close: '280.50' }, NOPE: { status: 'error', code: 404 } }),
    });
    assert.deepEqual(r.refused, ['NOPE']);
    assert.equal(r.quotes.size, 1);
  });

  test('says what is wrong in words that say what to do', async () => {
    advance();
    assert.equal((await fetchQuotes(['VTI'], '', { now, fetchFn: ok({}) })).code, 'no-key');
    advance();
    assert.equal((await fetchQuotes(['VTI'], 'k', { now, fetchFn: ok({ status: 'error', code: 429 }) })).code, 'quota');
    // Asking again immediately is held back rather than spending the allowance.
    assert.equal((await fetchQuotes(['VTI'], 'k', { now, fetchFn: ok({}) })).code, 'rate');
  });

  test('asking for nothing costs nothing', async () => {
    const r = await fetchQuotes([], 'k', { now, fetchFn: () => { throw new Error('should not be called'); } });
    assert.equal(r.ok, true);
    assert.equal(r.quotes.size, 0);
  });

  test('hands the valuation layer only the prices', async () => {
    advance();
    const r = await fetchQuotes(['VTI'], 'k', { now, fetchFn: ok({ symbol: 'VTI', close: '280.50' }) });
    const prices = pricesFrom(r.quotes);
    assert.equal(prices.get('VTI'), 280_500_000);
  });
});
