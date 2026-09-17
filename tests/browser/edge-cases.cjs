// Browser test. Run all of them with `npm run test:browser` (needs Playwright).
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE_URL = process.env.TALLY_URL || 'http://localhost:5173/';
const SHOTS = (process.env.SHOTS_DIR || path.join(os.tmpdir(), 'tally-shots')) + path.sep;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-data-')) + path.sep;
const FIXTURES = path.join(__dirname, 'fixtures') + path.sep;
const launch = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
fs.mkdirSync(SHOTS, { recursive: true });
const failures = [];
const expect = (ok, message) => {
  if (!ok) failures.push(message);
};
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = iso(new Date());
const monthStart = (offset) => {
  const d = new Date();
  return iso(new Date(d.getFullYear(), d.getMonth() + offset, 1));
};
(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(m.text()); });
  page.on('dialog', (d) => { problems.push('unexpected dialog: ' + d.message()); d.dismiss(); });
  const closed = () => page.waitForSelector('dialog#sheet[open]', { state: 'detached' });
  const text = async (sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
  const step = (s) => console.log('STEP', s);
  const add = async (amount, cat, note = '') => {
    await page.click('.fab');
    await page.fill('input[name=amount]', amount);
    await page.click(`label.chip:has-text("${cat}")`);
    if (note) await page.fill('input[name=note]', note);
    await page.click('[data-save]');
    await closed();
  };

  await page.goto(BASE_URL);
  await page.waitForSelector('.empty h2');
  // Wait for the service worker to take control.
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForSelector('.empty h2');
  step('sw controlling: ' + await page.evaluate(() => Boolean(navigator.serviceWorker.controller)));

  // Hostile note text renders as text
  await add('3', 'Other', '<img src=x onerror="alert(1)"><b>bold</b>');
  step('note rendered as text: ' + await page.evaluate(() => {
    const t = [...document.querySelectorAll('.tx-title')].map((e) => e.textContent);
    return t.some((x) => x.includes('<img')) && !document.querySelector('.tx-title img, .tx-title b');
  }));

  expect(await page.evaluate(() => !document.querySelector('.tx-title img, .tx-title b')), 'notes are shown as text');
  // $0 budget with spending
  await page.goto(BASE_URL + '#/budgets');
  await page.click('.budget-btn:has-text("Entertainment")');
  await page.fill('input[name=budget]', '0');
  await page.click('[data-save]');
  await closed();
  await add('15', 'Entertainment', 'Movie');
  await page.goto(BASE_URL + '#/budgets');
  step('zero budget row: ' + await text('.budget-row:has-text("Entertainment")') + ' class=' + await page.getAttribute('.budget-row:has-text("Entertainment")', 'class'));
  expect((await page.getAttribute('.budget-row:has-text("Entertainment")', 'class')).includes('s-over'), 'spending against a $0 budget is over');
  await page.goto(BASE_URL);
  step('home with $0 budget: ' + await text('.hero-line'));

  // Largest amount allowed, and one over
  await page.click('.fab');
  await page.fill('input[name=amount]', '1,000,000,000.01');
  await page.click('.seg label:has-text("Income")');
  await page.click('label.chip:has-text("Income")');
  await page.click('[data-save]');
  expect((await text('.field-error:not([hidden])')) === 'That amount is too large.', 'amount limit');
  step('too large: ' + await text('.field-error:not([hidden])'));
  await page.fill('input[name=amount]', '1000000000');
  await page.click('[data-save]');
  await closed();
  await page.waitForTimeout(100);
  step('huge income figures: ' + await text('.figures'));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow === 0, 'huge numbers do not widen the page');
  step('overflow with huge numbers: ' + overflow);
  await page.screenshot({ path: SHOTS + 'e01-huge.png' });

  // Future month with nothing
  await page.click('[data-action=month-shift][data-step="1"]');
  step('next month: ' + await text('.month-title') + ' | ' + await text('.hero-line') + ' | back link: ' + await page.isVisible('[data-action=month-today]'));
  expect((await text('.hero-line')).includes('hasn’t started yet'), 'future month wording');
  await page.click('[data-action=month-today]');
  // A month far in the past
  for (let i = 0; i < 14; i++) await page.click('[data-action=month-shift][data-step="-1"]');
  step('past month: ' + await text('.month-title') + ' | ' + await text('.hero-line'));
  expect((await text('.hero-line')).startsWith('Nothing was recorded'), 'empty past month wording');
  await page.screenshot({ path: SHOTS + 'e02-empty-month.png' });

  // Offline reload
  await ctx.setOffline(true);
  await page.goto(BASE_URL + '#/activity');
  await page.waitForSelector('.tx-row', { timeout: 8000 });
  step('offline load rows: ' + await page.locator('.tx-row').count());
  await add('4.20', 'Groceries', 'Offline snack');
  step('offline save toast: ' + (await page.locator('.toast-msg').last().textContent()));
  expect((await page.locator('.toast-msg').last().textContent()) === 'Expense of $4.20 saved', 'saving works offline');
  await ctx.setOffline(false);

  console.log('PROBLEMS', JSON.stringify(problems, null, 1));
  console.log('FAILED CHECKS', JSON.stringify(failures, null, 1));
  if (problems.length || failures.length) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
