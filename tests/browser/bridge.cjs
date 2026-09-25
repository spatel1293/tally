// Browser test. Run all of them with `npm run test:browser` (needs Playwright).
//
// The bridge: connecting to a SimpleFIN bridge and reading balances from it.
//
// Every request here is stubbed, so no real bridge and no real money are
// involved. What is being tested is the whole path the owner walks — paste a
// setup token, seal the access URL, read balances, take up an account the
// bridge offers — plus the thing that must never happen: the access URL is
// the entire credential, so it must appear neither in the page nor in
// storage in the clear.
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
const CLAIM_URL = 'https://bridge.example.test/simplefin/claim/ONE-TIME-abc123';
const SETUP_TOKEN = Buffer.from(CLAIM_URL, 'utf8').toString('base64');
const SECRET_USER = 'bridgeuser8f21';
const SECRET_PASS = 'bridgepassd41d8cd98f';
const ACCESS_URL = `https://${SECRET_USER}:${SECRET_PASS}@bridge.example.test/simplefin`;

// What the stub bridge is holding. Two accounts: one the book will follow,
// one it is offered afterwards.
const bridgeAccounts = [
  { id: 'ACT-1', name: 'Individual', currency: 'USD', balance: '114265.51', 'balance-date': 1790208000, org: { name: 'Wealthfront', domain: 'wealthfront.com' } },
  { id: 'ACT-2', name: 'Brokerage', currency: 'USD', balance: '8225.35', 'balance-date': 1790208000, org: { name: 'Charles Schwab', domain: 'schwab.com' } },
];
let bridgeErrors = [];
let claimCalls = 0;
let claimStatus = 200;
let balanceCalls = [];

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 841, height: 701 }, hasTouch: true });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  // A refused claim is deliberate below, and the browser logs the failed
  // request itself; that one line is expected, everything else is not.
  const expected = /Failed to load resource: the server responded with a status of 403/;
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !expected.test(m.text())) problems.push(`console.${m.type()}: ${m.text()}`); });
  const step = (s) => console.log('STEP', s);
  const shot = (n) => page.screenshot({ path: SHOTS + n + '.png' });
  const closed = () => page.waitForSelector('dialog#sheet[open]', { state: 'detached' });
  const text = async (sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
  const body = () => page.textContent('body');
  const clearToasts = () => page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));

  // ---- The stub bridge ----
  await ctx.route('**/simplefin/claim/**', async (route) => {
    claimCalls++;
    const req = route.request();
    // The claim has to stay a *simple* request. Anything that would make the
    // browser preflight it never reaches a real bridge, which answers OPTIONS
    // on this path with a 404 — so a header here is a shipped bug.
    const headers = req.headers();
    expect(req.method() === 'POST', 'the claim is a POST');
    expect(!headers['content-type'], 'the claim sends no content type, so the browser does not preflight it');
    expect(!headers['authorization'], 'the claim sends no authorization header');
    if (claimStatus !== 200) return route.fulfill({ status: claimStatus, body: 'no' });
    await route.fulfill({ status: 200, contentType: 'text/plain', body: ACCESS_URL });
  });

  await ctx.route('**/simplefin/accounts**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    balanceCalls.push(url.toString());
    const auth = req.headers()['authorization'] || '';
    expect(auth === 'Basic ' + Buffer.from(`${SECRET_USER}:${SECRET_PASS}`).toString('base64'), 'the credentials travel as an Authorization header, not in the address');
    expect(!url.username && !url.password, 'the fetched address carries no credentials');
    expect(url.searchParams.get('balances-only') === '1', 'the read asks for balances only, so no transaction ever crosses the wire');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ errors: bridgeErrors, accounts: bridgeAccounts }) });
  });

  await page.goto(BASE + '#/settings');
  await page.waitForSelector('[aria-labelledby=connections]');
  step('the endpapers offer a bridge');
  expect((await text('[aria-labelledby=connections]')).toLowerCase().includes('simplefin'), 'the endpapers explain what a bridge is');

  // ---- Connecting ----
  step('pasting a setup token');
  await page.click('[data-action=bridge-connect]');
  await page.waitForSelector('dialog#sheet[open]');
  await page.click('[data-save]');
  expect((await text('#err-token')).length > 0, 'connecting with nothing pasted says what is missing');

  await page.evaluate(() => { document.querySelector('#err-token').textContent = ''; });
  await page.fill('textarea[name=token]', 'this is not base64 at all !!!');
  await page.click('[data-save]');
  await page.waitForFunction(() => document.querySelector('#err-token')?.textContent.trim().length > 0);
  expect(!(await text('#err-token')).includes('undefined'), 'a token that is not a token is refused in plain words');
  expect(claimCalls === 0, 'a token that cannot be decoded is never sent to the bridge');
  // A mis-paste is answered on the spot: it must not cost a trip through the
  // passphrase dialog to find out the token was never a token.
  expect(await page.isHidden('dialog#confirm'), 'a token that is not a token is refused without asking for the passphrase');

  // Sealing needs the strongbox, and the book asks for it before it spends
  // the one-time token.
  step('the strongbox is asked for before the token is spent');
  await page.fill('textarea[name=token]', SETUP_TOKEN);
  await page.click('[data-save]');
  await page.waitForSelector('dialog#confirm[open]');
  expect((await text('dialog#confirm')).toLowerCase().includes('passphrase'), 'connecting asks for a passphrase first');
  await page.fill('#vault-pass', PASSPHRASE);
  await page.fill('#vault-pass2', PASSPHRASE);
  await page.click('dialog#confirm button[type=submit]');
  await page.waitForSelector('dialog#confirm[open]', { state: 'detached' });
  await closed();
  expect(claimCalls === 1, 'the setup token is claimed exactly once');
  await page.waitForSelector('[data-action=bridge-sync]');
  expect((await text('[aria-labelledby=connections]')).includes('bridge.example.test'), 'the endpapers name the bridge that is connected');
  await shot('bridge-connected');

  // ---- The access URL is a credential ----
  step('the access URL is nowhere in the clear');
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
    for (const secret of [SECRET_PASS, SECRET_USER, ACCESS_URL, SETUP_TOKEN]) {
      expect(!haystack.includes(secret), `${label}: the bridge credential is not in the page or in storage`);
    }
  };
  await leaked('once connected');

  // ---- Reading balances ----
  // Connecting already read the bridge once on its own — a setup token's
  // claim carries no account list, so without this the book would say
  // "connected" and then offer nothing until a second, separate click.
  step('connecting already shows what the bridge offers, with no extra click');
  expect(balanceCalls.length === 1, 'connecting reads the bridge once by itself');
  await page.evaluate(() => { location.hash = '#/ledger'; });
  await page.waitForSelector('[aria-labelledby=offered]');
  expect((await body()).includes('Individual'), 'the accounts the bridge offers are listed');
  expect((await body()).includes('Charles Schwab') || (await body()).includes('Brokerage'), 'both offered accounts are listed');
  await shot('bridge-offered');

  step('reading balances again calls the bridge a second time');
  await clearToasts();
  await page.click('[data-action=bridge-sync]');
  await page.waitForFunction(() => document.querySelector('.toast'));
  expect(balanceCalls.length === 2, 'an explicit read calls the bridge again');

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
  bridgeAccounts[0].balance = '120000.00';
  bridgeAccounts[0]['balance-date'] = 1790208000 + 86400 * 3;
  await clearToasts();
  await page.click('[data-action=bridge-sync]');
  await page.waitForFunction(() => document.querySelector('.toast'));
  await page.waitForFunction(() => document.body.textContent.includes('120,000.00'));
  expect((await body()).includes('120,000.00'), 'the new balance is on the page');

  step('a bank the bridge could not reach is reported, not swallowed');
  bridgeErrors = ['Connection to Wealthfront needs attention.'];
  await clearToasts();
  await page.click('[data-action=bridge-sync]');
  await page.waitForFunction(() => document.querySelector('.toast'));
  expect((await text('.toast')).includes('needs attention'), 'a bank that could not be reached is said out loud');
  bridgeErrors = [];

  step('an account the bridge stops offering is flagged, not wiped');
  const held = bridgeAccounts.shift();
  await clearToasts();
  await page.click('[data-action=bridge-sync]');
  await page.waitForFunction(() => document.querySelector('.toast'));
  expect(/no longer offered/i.test(await text('.toast')), 'an account gone from the bridge is reported');
  expect((await body()).includes('120,000.00'), 'and the balance it had is still in the book');
  bridgeAccounts.unshift(held);

  // ---- A shut strongbox ----
  step('a shut strongbox stops a read, and says why');
  await clearToasts();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
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

  // ---- Disconnecting ----
  step('disconnecting forgets the address and keeps the money');
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

  // ---- A token that has already been used ----
  step('a token claimed twice is refused in words that say what to do');
  claimStatus = 403;
  await page.goto(BASE + '#/settings');
  await page.click('[data-action=bridge-connect]');
  await page.waitForSelector('dialog#sheet[open]');
  await page.fill('textarea[name=token]', SETUP_TOKEN);
  await page.click('[data-save]');
  // The page was reloaded, so the strongbox is shut and asks to be opened
  // before the token is spent.
  await page.waitForSelector('dialog#confirm[open]');
  await page.fill('#vault-pass', PASSPHRASE);
  await page.click('dialog#confirm button[type=submit]');
  await page.waitForSelector('dialog#confirm[open]', { state: 'detached' });
  await page.waitForFunction(() => document.querySelector('#err-token')?.textContent.trim().length > 0);
  const refusal = await text('#err-token');
  expect(/once|new one|generate/i.test(refusal), `a spent token says to generate a new one (got: ${refusal})`);
  await shot('bridge-spent-token');

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
