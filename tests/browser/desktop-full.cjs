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
const CSV = FIXTURES + 'history.csv';

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`console.${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}\n${e.stack}`));
  const step = (s) => console.log('STEP', s);
  const shot = (n, opts = {}) => page.screenshot({ path: SHOTS + n + '.png', ...opts });
  const closed = () => page.waitForSelector('dialog#sheet[open]', { state: 'detached' });
  const lastToast = async () => { await page.waitForTimeout(80); return (await page.locator('.toast-msg').last().textContent()).trim(); };
  const text = async (sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();

  await page.goto(BASE);
  await page.waitForSelector('.empty h2');

  // ---- CSV import ----
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('main [data-action=import-csv]')]);
  await chooser.setFiles(CSV);
  await page.waitForSelector('dialog#sheet[open] .import-summary');
  step('import summary: ' + await text('.import-summary'));
  expect((await text('.import-summary')).includes('425 transactions ready to add'), 'import preview count');
  await shot('d01-import');
  await page.click('[data-apply]');
  await closed();
  step('import toast: ' + await lastToast());
  await page.waitForSelector('.hero-spend .hero-line');
  step('home hero: ' + await text('.hero-spend .hero-line'));

  // Re-import: everything is a duplicate
  const [chooser2] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => document.querySelector('.sidebar') && null).then(() => page.goto(BASE + '#/settings')).then(() => page.click('[data-action=import-csv]'))]);
  await chooser2.setFiles(CSV);
  await page.waitForSelector('dialog#sheet[open] .import-summary');
  expect((await text('.import-summary')).includes('425 duplicates skipped') && (await page.isDisabled('[data-apply]')), 're-import skips duplicates');
  step('re-import summary: ' + await text('.import-summary') + ' | apply disabled: ' + await page.isDisabled('[data-apply]'));
  await page.keyboard.press('Escape');
  await closed();

  // ---- Budgets ----
  await page.goto(BASE + '#/budgets');
  for (const [name, amt] of [['Groceries', '600'], ['Dining Out', '250'], ['Transportation', '180'], ['Entertainment', '60'], ['Rent / Housing', '1650']]) {
    await page.click(`.budget-btn:has-text("${name}")`);
    await page.fill('input[name=budget]', amt);
    await page.keyboard.press('Enter');
    await closed();
  }
  expect((await text('.budget-total .figures')).includes('Budgeted$2,740.00'), 'budget total');
  step('budget totals: ' + await text('.budget-total .figures'));
  await shot('d02-budgets');

  // ---- Accounts ----
  await page.goto(BASE + '#/accounts');
  await page.waitForSelector('.acct-card');
  step('accounts: ' + await text('.acct-list'));
  // Choosing an account opens it; the detail carries the edit button.
  const editAccount = async (name) => {
    await page.click(`.acct-card:has-text("${name}") .acct-head`);
    await page.waitForSelector(`[data-account-detail] [data-action=edit-account]`);
    await page.click('[data-account-detail] [data-action=edit-account]');
    await page.waitForSelector('dialog#sheet[open]');
  };
  await editAccount('Checking');
  await page.fill('input[name=openingBalance]', '2,500');
  await page.selectOption('select[name=kind]', 'checking');
  await page.click('[data-save]');
  await closed();
  await editAccount('Credit card');
  await page.fill('input[name=openingBalance]', '-310.25');
  await page.selectOption('select[name=kind]', 'credit');
  await page.click('[data-save]');
  await closed();
  expect((await text('main')).includes('across 2 accounts'), 'accounts created by import');
  step('accounts after: ' + await text('.acct-list'));
  await shot('d03-accounts');

  // ---- Keyboard shortcut and account picker ----
  await page.keyboard.press('n');
  await page.waitForSelector('dialog#sheet[open]');
  step('account select visible: ' + await page.isVisible('select[name=accountId]') + ' default=' + await page.$eval('select[name=accountId]', (s) => s.options[s.selectedIndex].text));
  await page.fill('input[name=amount]', '18.40');
  await page.fill('input[name=note]', 'Trader Joe\'s');
  await page.waitForTimeout(100);
  step('payee memory picked: ' + await page.$eval('input[name=categoryId]:checked', (e) => e.closest('label').textContent.trim()));
  expect((await page.$eval('input[name=categoryId]:checked', (e) => e.closest('label').textContent)).includes('Groceries'), 'known payee picks its category');
  await shot('d04-add-desktop');
  await page.keyboard.press('Control+Enter');
  await closed();
  step('ctrl+enter toast: ' + await lastToast());
  await page.keyboard.press('n');
  await page.waitForSelector('dialog#sheet[open]');
  expect(!(await page.isVisible('[data-restored]')), 'keyboard save leaves no draft behind');
  step('no draft after keyboard save: ' + !(await page.isVisible('[data-restored]')) + ' amount="' + await page.inputValue('input[name=amount]') + '"');
  await page.keyboard.press('Escape');
  await closed();

  // ---- Repeating ----
  await page.goto(BASE + '#/recurring');
  await page.click('main [data-action=new-rule]');
  await page.fill('input[name=note]', 'Gym membership');
  await page.fill('input[name=amount]', '39');
  await page.selectOption('select[name=categoryId]', { label: '🩺 Health' });
  await page.fill('input[name=startDate]', monthStart(-3));
  await page.dispatchEvent('input[name=startDate]', 'change');
  step('backfill hint: ' + await text('[data-backfill]'));
  await page.click('[data-save]');
  await closed();
  const ruleToast = await lastToast();
  step('rule toast: ' + ruleToast);
  expect(ruleToast === 'Saved, and added 4 past transactions', 'automatic rule fills in past months');

  await page.click('main [data-action=new-rule]');
  await page.fill('input[name=note]', 'Phone bill');
  await page.fill('input[name=amount]', '55');
  await page.selectOption('select[name=categoryId]', { label: '💡 Utilities' });
  await page.fill('input[name=startDate]', TODAY);
  await page.check('input[name=mode][value=remind]');
  await page.click('[data-save]');
  await closed();
  step('recurring page: ' + await text('main'));
  await page.click('.reminder [data-do=log]');
  await page.waitForTimeout(150);
  step('log toast: ' + await lastToast());
  expect((await page.locator('.reminder').count()) === 0, 'logging clears the reminder');
  step('reminders left: ' + await page.locator('.reminder').count());
  await shot('d05-recurring');

  // ---- Goals ----
  await page.goto(BASE + '#/goals');
  await page.click('main [data-action=new-goal]');
  await page.fill('input[name=name]', 'Emergency fund');
  await page.fill('input[name=target]', '10000');
  await page.fill('input[name=saved]', '3200');
  await page.fill('input[name=targetDate]', monthStart(12));
  await page.click('[data-save]');
  await closed();
  await page.click('[data-action=adjust-goal]');
  await page.fill('input[name=amount]', '300');
  await page.click('[data-save]');
  await closed();
  expect((await text('.plan')).includes('$3,500.00 of $10,000.00'), 'goal progress');
  step('plan: ' + await text('.plan'));
  await shot('d06-goals');

  // ---- Categories ----
  await page.goto(BASE + '#/categories');
  await page.click('main [data-action=new-category]');
  await page.fill('input[name=name]', 'Coffee');
  await page.selectOption('select[name=parentId]', { label: '🍜 Dining Out' });
  await page.click('.icon-opt:has-text("☕")');
  await page.click('[data-save]');
  await closed();
  step('sub added: ' + await page.isVisible('.cat-row.child:has-text("Coffee")'));
  const before = await page.$$eval('#exp-cats ~ ul .cat-row:not(.child) .tx-title', (e) => e.map((x) => x.textContent));
  await page.click('[data-action=move-category][data-step="-1"][aria-label="Move Utilities up"]');
  await page.waitForTimeout(150);
  const after = await page.$$eval('#exp-cats ~ ul .cat-row:not(.child) .tx-title', (e) => e.map((x) => x.textContent));
  expect(after[1] === 'Utilities' && before[1] === 'Rent / Housing', 'reorder moves the category up');
  step('reorder: ' + before.slice(0, 3).join('/') + ' -> ' + after.slice(0, 3).join('/'));
  // Delete Entertainment (has transactions and a budget)
  await page.click('.list-btn:has-text("Entertainment")');
  await page.click('[data-delete]');
  await page.waitForSelector('select[name=moveTo]');
  step('delete sheet: ' + await text('dialog#sheet .sheet-body'));
  await page.selectOption('select[name=moveTo]', { label: '📦 Other' });
  await shot('d07-delete-category');
  await page.click('[data-save]');
  await closed();
  step('delete toast: ' + await lastToast());
  await page.goto(BASE + '#/activity');
  await page.selectOption('select[name=categoryId]', { label: '📦 Other' });
  await page.waitForTimeout(200);
  expect((await text('.summary-bar')).startsWith('25 transactions match'), 'deleted category moved its transactions');
  step('moved to Other: ' + await text('.summary-bar'));
  await page.click('[data-action=clear-filters]');

  // ---- Activity paging ----
  await page.waitForTimeout(150);
  step('activity summary: ' + await text('.summary-bar') + ' | rows shown: ' + await page.locator('.tx-row').count() + ' | more button: ' + await page.isVisible('[data-action=show-more]'));
  await shot('d08-activity');
  if (await page.isVisible('[data-action=show-more]')) {
    await page.click('[data-action=show-more]');
    expect((await page.locator('.tx-row').count()) === 431, 'show more reveals every row');
    step('rows after more: ' + await page.locator('.tx-row').count());
  }
  await page.selectOption('select[name=range]', 'custom');
  await page.fill('input[name=from]', '2026-03-01');
  await page.fill('input[name=to]', '2026-03-31');
  await page.waitForTimeout(200);
  expect((await text('.summary-bar')).startsWith('31 transactions match'), 'custom date range');
  step('march: ' + await text('.summary-bar'));
  await page.click('[data-action=clear-filters]');

  // ---- Review ----
  await page.goto(BASE + '#/review');
  await page.waitForSelector('.hero-line');
  step('review: ' + await text('.hero') + ' | ' + await text('.facts'));
  await shot('d09-review', { fullPage: true });
  await page.keyboard.press('[');
  await page.waitForTimeout(100);
  step('review prev: ' + await text('.month-title'));

  // ---- Home full page ----
  await page.goto(BASE);
  await page.waitForSelector('.hero-spend .hero-line');
  step('home: ' + await text('.hero-spend'));
  await shot('d10-home', { fullPage: true });

  // ---- Export ----
  await page.goto(BASE + '#/settings');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('main [data-action=export-json]')]);
  const backupPath = DATA + dl.suggestedFilename();
  await dl.saveAs(backupPath);
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  expect(backup.transactions.length === 431 && backup.categories.length === 11 && backup.accounts.length === 2 && backup.recurring.length === 2 && backup.goals.length === 1, 'backup contains everything');
  step(`backup ${dl.suggestedFilename()}: tx=${backup.transactions.length} cats=${backup.categories.length} accts=${backup.accounts.length} rules=${backup.recurring.length} goals=${backup.goals.length}`);
  await page.waitForTimeout(200);
  step('settings backup line: ' + await text('#set-data + p'));
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('main [data-action=export-csv]')]);
  const csvPath = DATA + dl2.suggestedFilename();
  await dl2.saveAs(csvPath);
  const csvText = fs.readFileSync(csvPath, 'utf8');
  expect(csvText.trim().split('\n').length === 432, 'CSV has a row per transaction');
  step('csv first line: ' + JSON.stringify(csvText.split('\n')[0]) + ' lines=' + csvText.trim().split('\n').length);
  await shot('d11-settings', { fullPage: true });

  // ---- Erase then restore ----
  await page.click('[data-erase]');
  await page.waitForSelector('dialog#confirm[open]');
  step('erase button disabled before typing: ' + await page.isDisabled('dialog#confirm button[type=submit]'));
  await page.uncheck('dialog#confirm input[name=saveFirst]');
  await page.fill('dialog#confirm input[name=confirmText]', 'ERASE');
  await page.click('dialog#confirm button[type=submit]');
  await page.waitForSelector('.empty h2');
  expect((await page.isVisible('.empty h2')), 'erase returns to the empty state');
  step('after erase: ' + await text('.empty h2'));
  await page.goto(BASE + '#/settings');
  const [chooser3] = await Promise.all([page.waitForEvent('filechooser'), page.click('main [data-action=restore-json]')]);
  await chooser3.setFiles(backupPath);
  await page.waitForSelector('dialog#confirm[open]');
  step('restore confirm: ' + await text('dialog#confirm .confirm-msg'));
  await page.click('dialog#confirm button[type=submit]');
  await page.waitForTimeout(500);
  step('restore toast: ' + await lastToast());
  const [dl3] = await Promise.all([page.waitForEvent('download'), page.click('main [data-action=export-json]')]);
  await dl3.saveAs(DATA + 'after-restore.json');
  const again = JSON.parse(fs.readFileSync(DATA + 'after-restore.json', 'utf8'));
  const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
  const norm = (b) => JSON.stringify(sortKeys({ ...b, exportedAt: 0, settings: { ...b.settings, lastExportAt: 0, lastChangeAt: 0 } }));
  expect(norm(again) === norm(backup), 'restore reproduces the backup exactly');
  step('restore identical to backup: ' + (norm(again) === norm(backup)));

  // ---- Currency + dark mode ----
  await page.selectOption('select[name=currency]', 'EUR');
  await page.waitForTimeout(150);
  await page.selectOption('select[name=locale]', 'de-DE');
  await page.waitForTimeout(150);
  step('currency toast: ' + await lastToast());
  await page.click('.seg label:has-text("Dark")');
  await page.waitForTimeout(150);
  step('theme attr: ' + await page.getAttribute('html', 'data-theme'));
  await page.goto(BASE);
  await page.waitForSelector('.hero-spend .hero-line');
  step('home in EUR: ' + await text('.hero-spend .hero-line') + ' | ' + await text('.figures'));
  await shot('d12-home-dark', { fullPage: true });
  await page.keyboard.press('i');
  await page.waitForSelector('dialog#sheet[open]');
  await page.waitForTimeout(300);
  await shot('d13-sheet-dark');
  await page.fill('input[name=amount]', '1.234,56');
  await page.click('label.chip:has-text("Income")');
  await page.click('[data-save]');
  await closed();
  const deToast = await lastToast();
  expect(deToast.replace(/\s/g, ' ') === 'Income of 1.234,56 € saved', 'German number format parses');
  step('de-DE amount toast: ' + deToast);

  // Reload keeps theme and data
  await page.reload();
  await page.waitForSelector('.hero-spend .hero-line');
  expect((await page.getAttribute('html', 'data-theme')) === 'dark', 'theme survives reload');
  step('after reload theme=' + await page.getAttribute('html', 'data-theme') + ' figures=' + await text('.figures'));

  console.log('PROBLEMS', JSON.stringify(problems, null, 1));
  console.log('FAILED CHECKS', JSON.stringify(failures, null, 1));
  if (problems.length || failures.length) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
