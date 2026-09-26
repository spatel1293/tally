// Browser test. Run all of them with `npm run test:browser` (needs Playwright).
//
// The strongbox: account numbers and logins sealed with a passphrase. What
// matters here is what is *not* there — the plaintext must never be in the
// page or in storage while the box is shut, and never in full on the cover
// screen at all.
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

const NUMBER = '123456789012';
const PASSWORD = 'hunter2-but-much-longer';
const PASSPHRASE = 'correct-horse-battery-staple';

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 841, height: 701 }, hasTouch: true });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`console.${m.type()}: ${m.text()}`); });
  const step = (s) => console.log('STEP', s);
  const shot = (n) => page.screenshot({ path: SHOTS + n + '.png' });
  const closed = () => page.waitForSelector('dialog#sheet[open]', { state: 'detached' });
  const text = async (sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
  const body = () => page.textContent('body');
  const clearToasts = () => page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));

  // Setting a passphrase is something you do once, so the offer lives in the
  // endpapers with the other setup rather than at the top of every visit to
  // the accounts chapter.
  await page.goto(BASE + '#/settings');
  await page.waitForSelector('[data-action=vault-create]');
  expect(/passphrase/i.test(await text('[aria-labelledby=strongbox]')), 'the endpapers offer a strongbox before there is one');

  // ---- Choosing a passphrase ----
  await page.click('[data-action=vault-create]');
  await page.waitForSelector('dialog#confirm[open]');
  await page.fill('#vault-pass', PASSPHRASE);
  await page.fill('#vault-pass2', 'something else');
  await page.click('dialog#confirm button[type=submit]');
  expect(!(await page.isHidden('#vault-error')), 'a passphrase typed differently twice is refused');
  await page.fill('#vault-pass2', PASSPHRASE);
  await page.click('dialog#confirm button[type=submit]');
  await page.waitForSelector('dialog#confirm[open]', { state: 'detached' });

  // Back to the accounts chapter, which is where the strongbox reports
  // itself now that there is one to report on.
  await page.goto(BASE + '#/ledger');
  await page.waitForSelector('.strongbox-note');
  expect((await text('.strongbox-note')).includes('open'), 'sealing it leaves it open');

  // ---- Sealing an account's details ----
  await clearToasts();
  await page.click('.chapter-actions [data-action=new-account]');
  await page.waitForSelector('dialog#sheet[open]');
  await page.fill('input[name=name]', 'Core hub');
  await page.fill('input[name=institution]', 'Wealthfront');
  await page.fill('input[name=balance]', '14000');
  await page.waitForSelector('input[name=accountNumber]');
  await page.fill('input[name=accountNumber]', NUMBER);
  await page.fill('input[name=routingNumber]', '021000021');
  await page.fill('input[name=username]', 'someone@example.com');
  await page.fill('input[name=password]', PASSWORD);
  await page.click('[data-save]');
  await closed();
  await page.waitForSelector('.acct');
  expect((await text('.acct-tags')).includes('sealed'), 'the entry says its details are sealed');

  // ---- Masked by default ----
  await clearToasts();
  await page.click('.acct-open-btn');
  await page.waitForSelector('.recto .sealed');
  expect(!(await body()).includes(NUMBER), 'a full number is never in the page while masked');
  expect(!(await body()).includes(PASSWORD), 'a password is never in the page while masked');
  expect((await text('.recto .sealed')).includes('•••• 9012'), 'the last four stands in for the number');
  await page.click('.recto .sealed [data-action=reveal-secret]');
  await page.waitForTimeout(150);
  expect((await body()).includes(NUMBER), 'asking for it shows it');
  await shot('box-01-open');

  // ---- What is actually stored ----
  await clearToasts();
  await page.click('[data-action=vault-lock]');
  await page.waitForTimeout(250);
  expect((await text('.strongbox-note')).includes('shut'), 'it shuts on request');
  expect(!(await body()).includes(NUMBER), 'and the number goes with it');
  const stored = await page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('tally');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const rows = await new Promise((res) => {
      const r = db.transaction('accounts').objectStore('accounts').getAll();
      r.onsuccess = () => res(r.result);
    });
    return JSON.stringify(rows) + JSON.stringify(window.localStorage);
  });
  step('stored: ' + stored.slice(0, 150));
  expect(!stored.includes(NUMBER) && !stored.includes(PASSWORD) && !stored.includes(PASSPHRASE), 'nothing sensitive is written down in the clear');
  expect(stored.includes('"vault"'), 'only the sealed blob is');

  // ---- Opening it again ----
  await page.click('[data-action=vault-unlock]');
  await page.waitForSelector('dialog#confirm[open]');
  await page.fill('#vault-pass', 'not the passphrase');
  await page.click('dialog#confirm button[type=submit]');
  await page.waitForTimeout(400);
  expect(!(await page.isHidden('#vault-error')), 'the wrong passphrase is refused');
  await page.fill('#vault-pass', PASSPHRASE);
  await page.click('dialog#confirm button[type=submit]');
  await page.waitForSelector('dialog#confirm[open]', { state: 'detached' });
  expect((await text('.strongbox-note')).includes('open'), 'the right one opens it');

  // ---- Put the book down and it shuts itself ----
  await clearToasts();
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(350);
  step('after being put down: ' + (await text('.strongbox-note')));
  expect((await text('.strongbox-note')).includes('shut'), 'the strongbox shuts when the book leaves the screen');
  expect(!(await body()).includes(NUMBER), 'and takes the numbers with it');

  // ---- The cover screen never shows one in full ----
  await page.click('[data-action=vault-unlock]');
  await page.waitForSelector('dialog#confirm[open]');
  await page.fill('#vault-pass', PASSPHRASE);
  await page.click('dialog#confirm button[type=submit]');
  await page.waitForSelector('dialog#confirm[open]', { state: 'detached' });
  await page.setViewportSize({ width: 412, height: 892 });
  await page.goto(BASE + '#/ledger');
  await page.waitForSelector('.acct');
  if (!(await page.isVisible('.acct-open'))) await page.click('.acct-open-btn');
  await page.waitForSelector('.acct-open .sealed');
  expect(await page.isHidden('.sealed [data-action=reveal-secret]'), 'the cover screen offers no way to show a full number');
  expect((await text('.cover-only')).includes('Open the phone'), 'and says where to read it');
  expect(!(await body()).includes(NUMBER), 'so it is never on the small screen at all');
  await shot('box-02-cover-masked');

  console.log('PROBLEMS', JSON.stringify(problems, null, 1));
  console.log('FAILED CHECKS', JSON.stringify(failures, null, 1));
  if (problems.length || failures.length) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
