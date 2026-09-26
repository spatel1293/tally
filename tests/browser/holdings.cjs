// Browser test. Run all of them with `npm run test:browser` (needs Playwright).
//
// Holdings and prices: writing in what an account holds, pricing the whole
// book in one request, and filing the result as a dated reading.
//
// The price feed is stubbed with page.route(), so this never calls the real
// one and never spends a request from the free allowance. What is being
// tested is the path the owner walks and the two things that must not
// happen: a holding that cannot be priced must never be silently counted as
// nothing, and a half-priced account must never be filed as a reading.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = process.env.TALLY_URL || 'http://localhost:5173/';
const SHOTS = (process.env.SHOTS_DIR || path.join(os.tmpdir(), 'tally-shots')) + path.sep;
const launch = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
fs.mkdirSync(SHOTS, { recursive: true });
const failures = [];
const expect = (ok, message) => {
  if (!ok) failures.push(message);
};

const KEY = 'test-price-key-0000';

// What the stubbed feed is quoting. Mutated between steps to move a price.
let quotes = {
  VTI: { symbol: 'VTI', close: '280.50', previous_close: '279.00', currency: 'USD', name: 'Vanguard Total Stock Market ETF' },
  BND: { symbol: 'BND', close: '72.1234', previous_close: '72.10', currency: 'USD', name: 'Vanguard Total Bond Market ETF' },
};
let priceCalls = [];

(async () => {
  const browser = await launch();
  // Phone width on purpose: this is the device the book is for, and at a
  // spread the facing page and the inline copy both exist in the DOM, so
  // every selector would match twice.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`console.${m.type()}: ${m.text()}`); });
  const step = (s) => console.log('STEP', s);
  const shot = (n) => page.screenshot({ path: SHOTS + n + '.png' });
  const closed = () => page.waitForSelector('dialog#sheet[open]', { state: 'detached' });
  const body = () => page.textContent('body');
  const clearToasts = () => page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  const toast = () => page.textContent('.toast');

  // ---- The stubbed price feed ----
  await ctx.route('https://api.twelvedata.com/**', async (route) => {
    const url = new URL(route.request().url());
    const asked = (url.searchParams.get('symbol') ?? '').split(',').filter(Boolean);
    priceCalls.push(asked);

    expect(url.searchParams.get('apikey') === KEY, 'the key travels with the request');
    // The whole point of batching: one request, however many holdings.
    expect(asked.length >= 1, 'symbols are asked for together');

    const answer = {};
    for (const s of asked) answer[s] = quotes[s] ?? { status: 'error', code: 404, message: 'symbol not found' };
    const payload = asked.length === 1 ? (quotes[asked[0]] ?? { status: 'error', code: 404 }) : answer;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  // Nothing in this book may reach a broker or an aggregator.
  for (const host of ['**/*.plaid.com/**', '**/*.simplefin.org/**', '**/api.schwabapi.com/**']) {
    await ctx.route(host, (route) => {
      expect(false, `the book must not call ${host}`);
      route.abort();
    });
  }

  await page.goto(BASE + '#/ledger');
  await page.waitForSelector('main');

  // ---- Seeding an account ----
  step('an account with nothing in it invites a holding');
  await page.evaluate(async () => {
    const s = await import('/js/store.js');
    await s.eraseAll();
    await s.saveAccount({ name: 'Brokerage', institution: 'Charles Schwab', kind: 'brokerage' });
  });
  await page.evaluate(() => { location.hash = '#/fund'; });
  await page.waitForTimeout(250);
  await page.evaluate(() => { location.hash = '#/ledger'; });
  await page.waitForSelector('.acct');
  await page.click('.acct-open-btn');
  await page.waitForSelector('[data-action=add-position]');
  expect(/Nothing written in yet/.test(await body()), 'an account with no holdings says so plainly');

  // ---- Writing a holding in ----
  step('writing in a holding');
  await page.click('[data-action=add-position]');
  await page.waitForSelector('dialog#sheet[open]');
  await page.click('[data-save]');
  expect((await page.textContent('#err-symbol')).length > 0, 'a holding with no ticker says what is missing');

  await page.fill('input[name=symbol]', 'not a ticker');
  await page.fill('input[name=shares]', '10');
  await page.click('[data-save]');
  await page.waitForFunction(() => document.querySelector('#err-symbol')?.textContent.trim().length > 0);
  expect(/ticker/i.test(await page.textContent('#err-symbol')), 'a ticker that is not a ticker is refused in plain words');

  await page.fill('input[name=symbol]', 'vti');
  await page.fill('input[name=shares]', '10.5');
  await page.click('[data-save]');
  await closed();
  await page.waitForFunction(() => document.body.textContent.includes('VTI'));
  expect((await body()).includes('VTI'), 'the ticker is normalised to upper case and written in');
  expect((await body()).includes('10.5'), 'the fractional share count is kept exactly');

  step('a second holding');
  await clearToasts();
  await page.click('[data-action=add-position]');
  await page.waitForSelector('dialog#sheet[open]');
  await page.fill('input[name=symbol]', 'BND');
  await page.fill('input[name=shares]', '40');
  await page.click('[data-save]');
  await closed();
  await page.waitForFunction(() => document.body.textContent.includes('BND'));

  // ---- Pricing ----
  step('with no key, the book asks for one rather than offering to refresh');
  await clearToasts();
  priceCalls = [];
  expect(await page.isHidden('[data-action=prices-refresh]').catch(() => true), 'no refresh button until there is a key to use');
  await page.click('[data-action=price-key]');
  await page.waitForSelector('dialog#sheet[open]');
  expect(priceCalls.length === 0, 'no request is made before there is a key to make it with');
  await page.fill('input[name=key]', KEY);
  await page.click('[data-save]');
  await closed();

  step('the whole book is priced in one request');
  await clearToasts();
  priceCalls = [];
  await page.click('[data-action=prices-refresh]');
  await page.waitForFunction(() => document.querySelector('.toast'));
  expect(priceCalls.length === 1, `two holdings cost one request, not two (made ${priceCalls.length})`);
  expect(priceCalls[0].includes('VTI') && priceCalls[0].includes('BND'), 'both symbols in the one request');

  // 10.5 x 280.50 = 2945.25 ; 40 x 72.1234 = 2884.936 -> 2884.94 ; total 5830.19
  await page.waitForFunction(() => document.body.textContent.includes('5,830.19'));
  expect((await body()).includes('5,830.19'), 'the account is worth its holdings, to the cent');
  expect((await body()).includes('2,945.25'), 'VTI priced exactly');
  await shot('holdings-priced');

  // A percentage rendered a hundred times too large reads as plausible
  // nonsense — "80%" for a 0.8% day — and no unit test on basis points would
  // catch it, because the bug is in the conversion at the view.
  step('percentages are rendered at human scale, not basis points');
  {
    const shown = await body();
    const pcts = [...shown.matchAll(/(\d[\d,]*\.?\d*)%/g)].map((m) => Number(m[1].replace(/,/g, '')));
    expect(pcts.length > 0, 'some percentage is on the page to check');
    expect(pcts.every((n) => n <= 100), `no percentage exceeds 100% (saw ${pcts.filter((n) => n > 100).join(', ') || 'none'})`);
  }

  step('a valuation is filed as a dated reading, like any other');
  const filed = await page.evaluate(async () => {
    const s = await import('/js/store.js');
    const a = s.state.accounts[0];
    return { balance: a.balance, balanceAt: a.balanceAt, today: s.state.today };
  });
  expect(filed.balance === 583019, `the reading holds the valued figure (got ${filed.balance})`);
  expect(filed.balanceAt === filed.today, 'and is dated today');

  step('pricing again when nothing moved writes no second reading');
  await clearToasts();
  await page.waitForTimeout(8200); // the feed's own minimum gap between calls
  await page.click('[data-action=prices-refresh]');
  await page.waitForFunction(() => document.querySelector('.toast'));
  expect(/nothing has moved/i.test(await toast()), `an unchanged book says so (got: ${await toast()})`);

  step('a price that moves is written in');
  quotes.VTI.close = '300.00';
  await clearToasts();
  await page.waitForTimeout(8200);
  await page.click('[data-action=prices-refresh]');
  // 10.5 x 300 = 3150.00 ; + 2884.94 = 6034.94
  await page.waitForFunction(() => document.body.textContent.includes('6,034.94'));
  expect((await body()).includes('6,034.94'), 'the new figure is on the page');

  // ---- The failure that matters most ----
  step('a holding the feed will not price is reported, never counted as nothing');
  await clearToasts();
  const before = await page.evaluate(async () => (await import('/js/store.js')).state.accounts[0].balance);
  delete quotes.BND; // the feed stops quoting it
  await page.waitForTimeout(8200);
  await page.click('[data-action=prices-refresh]');
  await page.waitForFunction(() => document.querySelector('.toast'));
  const said = await toast();
  expect(/BND/.test(said) && /could not be priced/i.test(said), `it says which holding it could not price (got: ${said})`);

  const after = await page.evaluate(async () => (await import('/js/store.js')).state.accounts[0].balance);
  expect(after === before, `a half-priced account keeps its last complete figure (was ${before}, now ${after})`);
  expect((await body()).includes('not priced'), 'and the holding itself says it is not priced');
  await shot('holdings-unpriced');
  quotes.BND = { symbol: 'BND', close: '72.1234', previous_close: '72.10' };

  // ---- Editing and removing ----
  step('a holding can be corrected');
  await clearToasts();
  await page.click('[aria-labelledby^=holdings-] [data-action=edit-position]');
  await page.waitForSelector('dialog#sheet[open]');
  await page.fill('input[name=shares]', '20');
  await page.click('[data-save]');
  await closed();
  await page.waitForFunction(() => document.body.textContent.includes('20 shares'));
  expect((await body()).includes('20 shares'), 'the corrected share count shows');

  step('the book survives a backup round trip with its holdings');
  const round = await page.evaluate(async () => {
    const s = await import('/js/store.js');
    const v = await import('/js/core/validate.js');
    const snap = s.snapshot();
    const parsed = v.parseBackup(JSON.stringify(v.buildBackup(snap)));
    const before = snap.accounts[0].positions;
    const after = parsed.data.accounts[0].positions;
    return { before, after, same: JSON.stringify(before) === JSON.stringify(after) };
  });
  expect(round.same, `positions are identical after a backup round trip (${JSON.stringify(round.before)} vs ${JSON.stringify(round.after)})`);

  expect(problems.length === 0, `no page errors: ${problems.join(' | ')}`);
  await browser.close();

  if (failures.length) {
    console.error('\nFAILURES:');
    failures.forEach((f) => console.error(' - ' + f));
    process.exit(1);
  }
  console.log('\nAll holdings checks passed.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
