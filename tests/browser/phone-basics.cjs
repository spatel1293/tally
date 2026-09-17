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
const BASE = BASE_URL;

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}\n${e.stack}`));
  const step = (s) => console.log('STEP', s);
  const shot = (n) => page.screenshot({ path: SHOTS + n + '.png' });
  const toastText = async () => (await page.locator('.toast-msg').last().textContent()).trim();

  await page.goto(BASE);
  await page.waitForSelector('.empty h2', { timeout: 5000 });
  step('empty: ' + await page.textContent('.empty h2'));
  await shot('m01-empty');

  // Validation
  await page.click('.fab');
  await page.waitForSelector('dialog#sheet[open]');
  await page.click('[data-save]');
  const errs = await page.$$eval('.field-error:not([hidden])', (els) => els.map((e) => e.textContent));
  step('validation errors: ' + JSON.stringify(errs));
  expect(JSON.stringify(errs) === JSON.stringify(['Enter an amount.', 'Choose a category.']), 'empty form shows amount and category errors');
  await page.fill('input[name=amount]', '-5');
  await page.click('label.chip:has-text("Groceries")');
  await page.click('[data-save]');
  step('negative: ' + JSON.stringify(await page.$$eval('.field-error:not([hidden])', (els) => els.map((e) => e.textContent))));
  expect((await page.textContent('.field-error:not([hidden])')).includes('turn on Refund'), 'negative amount explains refunds');
  await shot('m02-validation');

  // Save first expense
  await page.fill('input[name=amount]', '12.50');
  await page.fill('input[name=note]', 'Farmers market');
  await page.click('[data-save]');
  await page.waitForSelector('dialog#sheet[open]', { state: 'detached' });
  const firstToast = await toastText();
  step('toast: ' + firstToast);
  expect(firstToast === 'Expense of $12.50 saved', 'save confirmation toast');
  step('hero: ' + await page.textContent('.hero-line'));

  // Save income with save-and-add-another
  await page.click('.fab');
  await page.click('.seg label:has-text("Income")');
  await page.fill('input[name=amount]', '3,000');
  await page.click('label.chip:has-text("Income")');
  await page.fill('input[name=note]', 'Paycheck');
  await page.click('[data-save-another]');
  await page.waitForTimeout(300);
  step('after save-another amount value: "' + await page.inputValue('input[name=amount]') + '", type: ' + await page.$eval('input[name=type]:checked', (e) => e.value));
  expect((await page.inputValue('input[name=amount]')) === '', 'save-and-add-another clears the amount');
  // Add an expense in the same sheet
  await page.click('.seg label:has-text("Expense")');
  await page.fill('input[name=amount]', '42');
  await page.click('label.chip:has-text("Dining Out")');
  await page.fill('input[name=note]', 'Taqueria');
  await shot('m03-add-form');
  await page.click('[data-save]');
  await page.waitForSelector('dialog#sheet[open]', { state: 'detached' });
  const figs = (await page.textContent('.figures')).replace(/\s+/g, '');
  step('figures: ' + figs);
  expect(figs === 'Income$3,000.00Spending$54.50Net+$2,945.50', 'month figures add up');

  // Budget
  await page.click('.tabbar a[data-route=budgets]');
  await page.waitForSelector('.budget-list');
  await page.click('.budget-btn:has-text("Groceries")');
  await page.fill('input[name=budget]', '400');
  await page.click('[data-save]');
  await page.waitForSelector('dialog#sheet[open]', { state: 'detached' });
  step('budget toast: ' + await toastText());
  step('budget row: ' + (await page.textContent('.budget-row:has-text("Groceries")')).replace(/\s+/g, ' '));

  // Push groceries to warning then over
  for (const [amt, note] of [['350', 'Stock-up'], ['50', 'Party snacks']]) {
    await page.click('.fab');
    await page.fill('input[name=amount]', amt);
    await page.click('label.chip:has-text("Groceries")');
    await page.fill('input[name=note]', note);
    await page.click('[data-save]');
    await page.waitForSelector('dialog#sheet[open]', { state: 'detached' });
    const cls = await page.getAttribute('.budget-row:has-text("Groceries")', 'class');
    expect(cls.includes(amt === '350' ? 's-warning' : 's-over'), `budget state after ${amt}`);
    step(`after ${amt}: ${cls} :: ` + (await page.textContent('.budget-row:has-text("Groceries") .budget-top')).replace(/\s+/g, ' '));
  }
  await shot('m04-budgets');

  // Home again
  await page.click('.tabbar a[data-route=home]');
  await page.waitForSelector('.hero-line');
  step('home hero: ' + await page.textContent('.hero-line') + ' | ' + await page.textContent('.hero-sub'));
  await shot('m05-home');
  await page.evaluate(() => window.scrollTo(0, 99999));
  await shot('m05b-home-bottom');

  // Edit and delete with undo on Activity
  await page.click('.tabbar a[data-route=activity]');
  await page.waitForSelector('.tx-row');
  step('activity rows: ' + await page.locator('.tx-row').count());
  await page.click('.tx-row:has-text("Taqueria")');
  await page.waitForSelector('dialog#sheet[open]');
  step('edit amount prefilled: ' + await page.inputValue('input[name=amount]'));
  await page.fill('input[name=amount]', '45.10');
  await page.click('[data-save]');
  await page.waitForSelector('dialog#sheet[open]', { state: 'detached' });
  step('edited row: ' + (await page.textContent('.tx-row:has-text("Taqueria")')).replace(/\s+/g, ' '));
  await page.click('.tx-row:has-text("Taqueria")');
  await page.click('[data-delete]');
  await page.waitForSelector('dialog#sheet[open]', { state: 'detached' });
  expect((await page.locator('.tx-row').count()) === 4, 'delete removes the row');
  step('rows after delete: ' + await page.locator('.tx-row').count() + ' toast: ' + await toastText());
  await page.click('.toast-action');
  await page.waitForTimeout(200);
  expect((await page.locator('.tx-row').count()) === 5, 'undo restores the row');
  step('rows after undo: ' + await page.locator('.tx-row').count());

  // Search
  await page.fill('#activity-search', 'taq');
  await page.waitForTimeout(300);
  step('search taq rows: ' + await page.locator('.tx-row').count() + ' focus kept: ' + await page.evaluate(() => document.activeElement.id));
  expect((await page.locator('.tx-row').count()) === 1, 'keyword search');
  expect((await page.evaluate(() => document.activeElement.id)) === 'activity-search', 'search keeps focus while typing');
  await page.fill('#activity-search', '350');
  await page.waitForTimeout(300);
  step('search 350 rows: ' + await page.locator('.tx-row').count());
  expect((await page.locator('.tx-row').count()) === 1, 'amount search');
  await page.fill('#activity-search', 'zzz');
  await page.waitForTimeout(300);
  step('no match: ' + await page.textContent('#activity-results h2'));
  await page.click('[data-action=clear-filters]');
  await page.waitForTimeout(200);
  await shot('m06-activity');

  // Draft survives reload
  await page.click('.fab');
  await page.fill('input[name=amount]', '7.77');
  await page.fill('input[name=note]', 'Unsaved coffee');
  await page.reload();
  await page.waitForSelector('.tx-row');
  await page.click('.fab');
  await page.waitForSelector('dialog#sheet[open]');
  step('draft restored: ' + (await page.isVisible('[data-restored]')) + ' amount=' + await page.inputValue('input[name=amount]') + ' note=' + await page.inputValue('input[name=note]'));
  expect((await page.inputValue('input[name=amount]')) === '7.77', 'unsaved entry survives a reload');
  await page.click('[data-discard]');
  await page.waitForTimeout(100);
  step('after discard amount="' + await page.inputValue('input[name=amount]') + '"');
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog#sheet[open]', { state: 'detached' });
  expect((await page.locator('.tx-row').count()) === 5, 'saved data survives a reload');
  step('rows after reload: ' + await page.locator('.tx-row').count());

  console.log('PROBLEMS', JSON.stringify(problems, null, 1));
  console.log('FAILED CHECKS', JSON.stringify(failures, null, 1));
  if (problems.length || failures.length) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
