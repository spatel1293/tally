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
  const problems = [];
  const watch = (page, tag) => {
    page.on('pageerror', (e) => problems.push(`${tag} pageerror: ${e.message}`));
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`${tag} ${m.type()}: ${m.text()}`); });
  };
  const closed = (page) => page.waitForSelector('dialog#sheet[open]', { state: 'detached' });

  // ---- Phone screens with data ----
  const ctx = await browser.newContext({ viewport: { width: 375, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  watch(page, 'phone');
  await page.goto(BASE_URL);
  await page.waitForSelector('.empty h2');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('main [data-action=import-csv]')]);
  await chooser.setFiles(FIXTURES + 'history.csv');
  await page.waitForSelector('dialog#sheet[open] .import-summary');
  await page.screenshot({ path: SHOTS + 'p00-import.png' });
  await page.click('[data-apply]');
  await closed(page);
  await page.goto(BASE_URL + '#/budgets');
  for (const [name, amt] of [['Groceries', '600'], ['Dining Out', '250'], ['Transportation', '120']]) {
    await page.click(`.budget-btn:has-text("${name}")`);
    await page.fill('input[name=budget]', amt);
    await page.click('[data-save]');
    await closed(page);
  }
  await page.waitForTimeout(5200); // let toasts clear
  for (const [hash, name] of [['#/', 'p01-home'], ['#/activity', 'p02-activity'], ['#/budgets', 'p03-budgets'], ['#/more', 'p04-more'], ['#/settings', 'p05-settings'], ['#/review', 'p06-review'], ['#/categories', 'p07-categories']]) {
    await page.goto(BASE_URL + hash);
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) problems.push(`${hash} overflows by ${overflow}px`);
    await page.screenshot({ path: SHOTS + name + '.png' });
  }
  await page.goto(BASE_URL + '#/recurring');
  await page.click('main [data-action=new-rule]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: SHOTS + 'p08-rule-form.png' });
  await page.keyboard.press('Escape');
  await page.goto(BASE_URL + '#/activity');
  await page.click('.tx-row >> nth=0');
  await page.waitForTimeout(300);
  await page.screenshot({ path: SHOTS + 'p09-edit.png' });
  await ctx.close();

  // ---- Single-file build from disk ----
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await ctx2.newPage();
  watch(p2, 'file');
  await p2.goto('file://' + path.resolve(__dirname, '../../dist/tally.html'));
  await p2.waitForSelector('.empty h2', { timeout: 8000 });
  await p2.click('main [data-action=new-tx]');
  await p2.fill('input[name=amount]', '9.99');
  await p2.click('label.chip:has-text("Subscriptions")');
  await p2.click('[data-save]');
  await closed(p2);
  await p2.reload();
  await p2.waitForSelector('.hero-line');
  expect((await p2.textContent('.hero-line')).includes('$9.99'), 'single-file build saves and reloads');
  console.log('file:// after reload:', (await p2.textContent('.hero-line')).trim(), '| storage:', await p2.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).join(',')));
  await ctx2.close();

  console.log('PROBLEMS', JSON.stringify(problems, null, 1));
  console.log('FAILED CHECKS', JSON.stringify(failures, null, 1));
  if (problems.length || failures.length) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
