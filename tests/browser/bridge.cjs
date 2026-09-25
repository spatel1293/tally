// Browser test. Run all of them with `npm run test:browser` (needs Playwright).
//
// The bridge: connecting to a bridge and reading balances through it.
//
// Every request here is stubbed, so no real bridge, no Teller account and no
// real money are involved. What is being tested is the whole path the owner
// walks — paste the line the bridge gave them, seal it, read balances, take
// up an account — plus the things that must never happen: the token is the
// whole credential, so it must appear neither in the page nor in storage in
// the clear, and this book must never ask for a transaction.
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

const PASSPHRASE = 'correct-horse-battery-staple';
const BRIDGE = 'https://bridge.example.test';
const TOKEN = 'token_8f21d41d8cd98f00b204';
const LINE = Buffer.from(JSON.stringify({ u: BRIDGE, t: TOKEN }), 'utf8').toString('base64');
// A bridge reached over a network with plain http would put the token on the
// wire in the clear, so the book refuses the line outright.
const INSECURE_LINE = Buffer.from(JSON.stringify({ u: 'http://192.168.1.5:7000', t: TOKEN }), 'utf8').toString('base64');

// What the stub bridge is holding: one account the book will follow, one it
// is offered afterwards, and a card — which is money owed, not money held.
const accounts = [
  { id: 'acc_1', name: 'Individual', currency: 'USD', type: 'depository', subtype: 'treasury', status: 'open', last_four: '4417', institution: { name: 'Wealthfront' }, balance: { ledger: '114265.51' } },
  { id: 'acc_2', name: 'Brokerage', currency: 'USD', type: 'depository', subtype: 'sweep', status: 'open', last_four: '9921', institution: { name: 'Charles Schwab' }, balance: { ledger: '8225.35' } },
];
let bridgeErrors = [];
let bridgeCalls = [];
let bridgeDown = false;

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 841, height: 701 }, hasTouch: true });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  // A bridge that isn't running is staged below, and the browser logs the
  // refused request itself; that one line is expected, everything else is not.
  const expected = /Failed to load resource: net::ERR_CONNECTION_REFUSED/;
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !expected.test(m.text())) problems.push(`console.${m.type()}: ${m.text()}`); });
  const step = (s) => console.log('STEP', s);
  const shot = (n) => page.screenshot({ path: SHOTS + n + '.png' });
  const closed = () => page.waitForSelector('dialog#sheet[open]', { state: 'detached' });
  const text = async (sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
  const body = () => page.textContent('body');
  const clearToasts = () => page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));

  // ---- The stub bridge ----
  await ctx.route('https://bridge.example.test/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    bridgeCalls.push(url.pathname);
    if (bridgeDown) return route.abort('connectionrefused');

    // Teller takes the access token as an HTTP Basic username with no
    // password, and the bridge passes it straight through.
    const auth = req.headers()['authorization'] || '';
    expect(auth === 'Basic ' + Buffer.from(`${TOKEN}:`).toString('base64'), `the token travels as an Authorization header (got ${auth.slice(0, 20)})`);
    expect(!url.username && !url.password, 'the fetched address carries no credentials');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ errors: bridgeErrors, accounts }) });
  });
  // Nothing in this book may ever reach Teller directly, or ask anyone at all
  // for a transaction.
  await ctx.route('**/api.teller.io/**', (route) => {
    expect(false, 'the book must never talk to Teller directly');
    route.abort();
  });

  await page.goto(BASE + '#/settings');
  await page.waitForSelector('[aria-labelledby=connections]');
  step('the endpapers offer a bridge');
  expect(/bridge/i.test(await text('[aria-labelledby=connections]')), 'the endpapers say what the bridge is for');

  // ---- Connecting ----
  step('pasting the line from the bridge');
  await page.click('[data-action=bridge-connect]');
  await page.waitForSelector('dialog#sheet[open]');
  await page.click('[data-save]');
  expect((await text('#err-token')).length > 0, 'connecting with nothing pasted says what is missing');

  await page.evaluate(() => { document.querySelector('#err-token').textContent = ''; });
  await page.fill('textarea[name=token]', 'this is not base64 at all !!!');
  await page.click('[data-save]');
  await page.waitForFunction(() => document.querySelector('#err-token')?.textContent.trim().length > 0);
  expect(!(await text('#err-token')).includes('undefined'), 'a line that is not a line is refused in plain words');
  expect(bridgeCalls.length === 0, 'a line that cannot be read is never sent to a bridge');
  expect(await page.isHidden('dialog#confirm'), 'a line that is not a line is refused without asking for the passphrase');

  step('a bridge reached in the clear is refused outright');
  await page.evaluate(() => { document.querySelector('#err-token').textContent = ''; });
  await page.fill('textarea[name=token]', INSECURE_LINE);
  await page.click('[data-save]');
  await page.waitForFunction(() => document.querySelector('#err-token')?.textContent.trim().length > 0);
  expect(/https/i.test(await text('#err-token')), 'a plain-http bridge over a network is refused, because the token would be readable');
  expect(bridgeCalls.length === 0, 'and it is never contacted');

  step('a bridge that is not running says so, and nothing is sealed');
  bridgeDown = true;
  await page.evaluate(() => { document.querySelector('#err-token').textContent = ''; });
  await page.fill('textarea[name=token]', LINE);
  await page.click('[data-save]');
  await page.waitForSelector('dialog#confirm[open]');
  await page.fill('#vault-pass', PASSPHRASE);
  await page.fill('#vault-pass2', PASSPHRASE);
  await page.click('dialog#confirm button[type=submit]');
  await page.waitForSelector('dialog#confirm[open]', { state: 'detached' });
  await page.waitForFunction(() => document.querySelector('#err-token')?.textContent.trim().length > 0);
  expect(/reach|running/i.test(await text('#err-token')), `a bridge that is down explains itself (got: ${await text('#err-token')})`);
  bridgeDown = false;

  step('the line is checked against the bridge before it is sealed');
  bridgeCalls = [];
  await page.click('[data-save]');
  await closed();
  expect(bridgeCalls.length === 1, 'connecting reads the bridge once to prove the line works');
  await page.waitForSelector('[data-action=bridge-sync]');
  expect((await text('[aria-labelledby=connections]')).includes('bridge.example.test'), 'the endpapers name the bridge that is connected');
  await shot('bridge-connected');

  // ---- The token is a credential ----
  step('the token is nowhere in the clear');
  const leaked = async (label) => {
    const inPage = await page.evaluate(() => document.documentElement.outerHTML);
    const inStore = await page.evaluate(async () => {
      const dump = [];
      for (let i = 0; i < localStorage.length; i++) dump.push(localStorage.getItem(localStorage.key(i)));
      const dbs = (await indexedDB.databases?.()) ?? [];
      for (const { name } of dbs) {
        await new Promise((resolve) => {
          const req = indexedDB.open(name);
          req.onerror = () => resolve();
          req.onsuccess = () => {
            const db = req.result;
            const stores = [...db.objectStoreNames];
            if (!stores.length) { db.close(); return resolve(); }
            const tx = db.transaction(stores, 'readonly');
            let left = stores.length;
            for (const s of stores) {
              const all = tx.objectStore(s).getAll();
              all.onsuccess = () => {
                dump.push(JSON.stringify(all.result));
                if (!--left) { db.close(); resolve(); }
              };
              all.onerror = () => { if (!--left) { db.close(); resolve(); } };
            }
          };
        });
      }
      return dump.join('\n');
    });
    const haystack = inPage + '\n' + inStore;
    for (const secret of [TOKEN, LINE]) {
      expect(!haystack.includes(secret), `${label}: the bridge token is not in the page or in storage`);
    }
  };
  await leaked('once connected');

  // ---- Taking up what the bridge offers ----
  step('the accounts the bridge offers are waiting in the chapter');
  await page.evaluate(() => { location.hash = '#/ledger'; });
  await page.waitForSelector('[aria-labelledby=offered]');
  expect((await body()).includes('Individual'), 'the accounts the bridge offers are listed');
  expect((await body()).includes('Charles Schwab'), 'each one says which bank it came from');
  expect((await body()).includes('4417'), 'and its last four digits');
  await shot('bridge-offered');

  step('taking up an account the bridge offers');
  await clearToasts();
  await page.click('[aria-labelledby=offered] [data-action=adopt-account][data-index="0"]');
  await page.waitForSelector('.acct');
  const entries = await page.$$eval('.acct', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')));
  expect(entries.some((e) => e.includes('Individual')), 'the account is written into the book');
  expect(entries.some((e) => e.includes('114,265.51')), 'it arrives with the exact balance the bridge reported');
  expect((await body()).includes('follows the bridge'), 'the entry says it follows the bridge');

  step('a balance that has not moved is not a second reading');
  await clearToasts();
  await page.click('[data-action=bridge-sync]');
  await page.waitForFunction(() => document.querySelector('.toast'));
  const quiet = await text('.toast');
  expect(/nothing has moved/i.test(quiet), `an unchanged balance says so rather than filing a reading (got: ${quiet})`);

  step('a balance that has moved is written in');
  accounts[0].balance.ledger = '120000.00';
  await clearToasts();
  await page.click('[data-action=bridge-sync]');
  await page.waitForFunction(() => document.body.textContent.includes('120,000.00'));
  expect((await body()).includes('120,000.00'), 'the new balance is on the page');

  step('a card is written in as money owed, not money held');
  accounts.push({ id: 'acc_3', name: 'Sapphire', currency: 'USD', type: 'credit', subtype: 'credit_card', status: 'open', last_four: '1004', institution: { name: 'Chase' }, balance: { ledger: '310.25' } });
  await clearToasts();
  await page.click('[data-action=bridge-sync]');
  await page.waitForFunction(() => document.querySelector('[aria-labelledby=offered]')?.textContent.includes('Sapphire'));
  await clearToasts();
  await page.$eval('[aria-labelledby=offered]', (section) => {
    const row = [...section.querySelectorAll('li.ruled')].find((li) => li.textContent.includes('Sapphire'));
    row.querySelector('[data-action=adopt-account]').click();
  });
  await page.waitForFunction(() => document.body.textContent.includes('Sapphire'));
  expect(/-\s?\$?310\.25|\(\$?310\.25\)|−\$?310\.25/.test(await body()), `a card reads as what is owed (body had: ${(await body()).match(/.{0,30}310\.25.{0,10}/)?.[0]})`);

  step('a bank the bridge could not reach is reported, not swallowed');
  bridgeErrors = ['Wealthfront needs signing in to again.'];
  await clearToasts();
  await page.click('[data-action=bridge-sync]');
  await page.waitForFunction(() => document.querySelector('.toast'));
  expect((await text('.toast')).includes('signing in'), 'a bank that could not be reached is said out loud');
  bridgeErrors = [];

  step('an account closed at the bank keeps the figure it had');
  accounts[0].status = 'closed';
  await clearToasts();
  await page.click('[data-action=bridge-sync]');
  await page.waitForFunction(() => document.querySelector('.toast'));
  expect(/closed/i.test(await text('.toast')), 'a closed account is reported');
  expect((await body()).includes('120,000.00'), 'and the balance it had is still in the book');
  accounts[0].status = 'open';

  // ---- A shut strongbox ----
  step('a shut strongbox stops a read, and says why');
  await clearToasts();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(150);
  await clearToasts();
  await page.click('[data-action=bridge-sync]');
  await page.waitForFunction(() => document.querySelector('.toast'));
  const shut = await text('.toast');
  expect(/strongbox/i.test(shut), `a read with the strongbox shut explains itself (got: ${shut})`);
  await leaked('with the strongbox shut');

  // ---- Nothing but balances ----
  step('the book never asks anyone for a transaction');
  expect(bridgeCalls.every((p) => p === '/accounts'), `the book asks only for /accounts (asked: ${[...new Set(bridgeCalls)].join(', ')})`);

  // ---- Disconnecting ----
  step('disconnecting forgets the token and keeps the money');
  await page.goto(BASE + '#/settings');
  await page.waitForSelector('[data-action=bridge-forget]');
  await page.click('[data-action=bridge-forget]');
  await page.waitForSelector('dialog#confirm[open]');
  await page.click('dialog#confirm button[type=submit]');
  await page.waitForSelector('[data-action=bridge-connect]');
  expect(!(await text('[aria-labelledby=connections]')).includes('bridge.example.test'), 'the bridge is forgotten');
  await page.goto(BASE + '#/ledger');
  await page.waitForSelector('.acct');
  expect((await body()).includes('120,000.00'), 'every balance it ever read stays in the book');
  await leaked('after disconnecting');

  expect(problems.length === 0, `no page errors: ${problems.join(' | ')}`);
  await browser.close();

  if (failures.length) {
    console.error('\nFAILURES:');
    failures.forEach((f) => console.error(' - ' + f));
    process.exit(1);
  }
  console.log('\nAll bridge checks passed.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
