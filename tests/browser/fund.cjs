// Browser test. Run all of them with `npm run test:browser` (needs Playwright).
//
// The book end to end: writing in accounts and pots, the figures the whole
// plan rests on, the shares of the surplus, reconciliation, readings, and the
// quarterly review answering to all of it. Run at the Fold opened flat,
// which is where both pages of the spread are on screen at once.
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
  const clearToasts = () => page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));

  await page.goto(BASE);
  await page.waitForSelector('.chapter-title');
  expect((await text('.chapter-title')) === 'The Fund', 'the book opens on the fund');
  expect((await text('.empty-page h2')) === 'An empty book', 'an empty book says so');

  // ---- Accounts: where the money actually sits ----
  await page.click('.empty-page [data-action=new-account]');
  await page.waitForSelector('dialog#sheet[open]');
  await page.fill('input[name=name]', 'Core hub');
  await page.fill('input[name=institution]', 'Wealthfront');
  await page.selectOption('select[name=kind]', 'savings');
  await page.fill('input[name=balance]', '14000');
  await page.fill('input[name=apy]', '4.5');
  await page.check('input[name=mfa]');
  await page.click('[data-save]');
  await closed();

  await clearToasts();
  await page.goto(BASE + '#/ledger');
  await page.waitForSelector('.acct');
  await page.click('.chapter-actions [data-action=new-account]');
  await page.waitForSelector('dialog#sheet[open]');
  await page.fill('input[name=name]', 'Brokerage');
  await page.fill('input[name=institution]', 'Fidelity');
  await page.selectOption('select[name=kind]', 'brokerage');
  await page.fill('input[name=balance]', '4800');
  await page.fill('input[name=apy]', '7');
  await page.click('[data-save]');
  await closed();
  const ledger = await text('.acct-list');
  step('accounts: ' + ledger);
  expect(ledger.includes('Wealthfront') && ledger.includes('4.50% A YEAR') === false, 'the entry names the institution');
  expect(/two-step on/i.test(ledger) && /no two-step/i.test(ledger), 'each entry says whether its login has a second step');
  expect((await text('.display-figure')).includes('$18,800.00'), 'the chapter totals what is held');

  // ---- Pots: what the money is for ----
  await clearToasts();
  await page.goto(BASE + '#/pots');
  await page.waitForSelector('.empty-page');
  await page.click('.empty-page [data-action=new-plan][data-kind=safety]');
  await page.waitForSelector('dialog#sheet[open]');
  expect(await page.isChecked('input[name=kind][value=safety]'), 'the safety net is preselected');
  await page.fill('input[name=name]', 'Rainy day');
  await page.fill('input[name=target]', '86400');
  await page.fill('input[name=saved]', '11000');
  await page.fill('input[name=alloc]', '68.75');
  await page.fill('input[name=apy]', '3.5');
  await page.selectOption('select[name=accountId]', { index: 1 });
  await page.click('[data-save]');
  await closed();

  for (const [name, kind, target, saved, alloc, apy] of [
    ['Wealth builder', 'invest', '25000', '4800', '9.38', '7'],
    ['Japan', 'trip', '4000', '2000', '7.81', '3.5'],
  ]) {
    await clearToasts();
    await page.click('.chapter-actions [data-action=new-plan]');
    await page.waitForSelector('dialog#sheet[open]');
    await page.click(`input[name=kind][value=${kind}]`);
    await page.fill('input[name=name]', name);
    await page.fill('input[name=target]', target);
    await page.fill('input[name=saved]', saved);
    await page.fill('input[name=alloc]', alloc);
    await page.fill('input[name=apy]', apy);
    await page.click('[data-save]');
    await closed();
  }

  // Only one pot can be the safety net, and the shares can't exceed 100%.
  await clearToasts();
  await page.click('.pot:has-text("Japan") .pot-open');
  await page.waitForSelector('.recto .pot-detail');
  await page.click('.recto [data-action=edit-plan]');
  await page.waitForSelector('dialog#sheet[open]');
  await page.click('input[name=kind][value=safety]');
  await page.click('[data-save]');
  await page.waitForSelector('.field-error:not([hidden])');
  step('second safety net: ' + (await text('.field-error:not([hidden])')));
  expect((await text('.field-error:not([hidden])')).includes('already the safety net'), 'a second safety net is refused by name');
  await page.click('input[name=kind][value=trip]');
  await page.fill('input[name=alloc]', '40');
  await page.click('[data-save]');
  expect((await text('.field-error:not([hidden])')).includes('at most'), 'the shares cannot add up past 100%');
  await page.keyboard.press('Escape');
  await closed();

  // ---- The two figures the whole plan rests on ----
  await clearToasts();
  await page.goto(BASE + '#/review');
  await page.waitForSelector('[data-figures]');
  await page.fill('input[name=monthlyIncome]', '4500');
  await page.fill('input[name=monthlyOutgoings]', '2900');
  await page.fill('input[name=runwayTarget]', '6');
  await page.click('[data-figures] button[type=submit]');
  await page.waitForTimeout(300);

  await clearToasts();
  await page.goto(BASE + '#/');
  await page.waitForSelector('.runway');
  const fund = await text('#main');
  step('the fund: ' + fund.slice(0, 260));
  expect(fund.includes('$18,800.00'), 'the fund is what the accounts hold');
  expect(/3\.8 of the 6 months/.test(fund), 'the runway is the safety net measured in months of outgoings');
  expect(fund.includes('$1,600.00'), 'the surplus is income less outgoings');
  expect(fund.includes('5.14%') || /Earning \d/.test(fund) || /earning \d/.test(fund), 'the fund says what it earns');
  await shot('fund-01-opening');

  const alloc = await text('.leaf-section:has(.alloc-bar)');
  step('shares: ' + alloc);
  expect(alloc.includes('Rainy day') && alloc.includes('$1,100.00'), 'each pot gets its share of the surplus in money');
  expect(alloc.includes('Unspoken for'), 'what has no share is named');

  // ---- The facing page follows the chapter ----
  await page.goto(BASE + '#/pots');
  await page.waitForSelector('.pot-list');
  await page.click('.pot:has-text("Rainy day") .pot-open');
  await page.waitForSelector('.recto .pot-detail');
  const detail = await text('.recto');
  step('facing page: ' + detail.slice(0, 200));
  expect(detail.includes('Rainy day') && detail.includes('In five years'), 'the facing page carries the chosen pot in full');
  expect(detail.includes('Core hub'), 'and says where it is kept');
  expect(!(await text('#main')).includes('In five years —'), 'the left page does not repeat it');
  await shot('fund-02-pot-detail');

  // ---- Readings: the only ledger this book keeps ----
  await clearToasts();
  await page.goto(BASE + '#/ledger');
  await page.waitForSelector('.acct');
  await page.click('.acct:has-text("Core hub") .acct-open-btn');
  await page.waitForSelector('.recto [data-action=read-balance]');
  // A reading you forgot to take last month: it files under its own date and
  // leaves the current figure alone.
  const back = new Date();
  back.setDate(back.getDate() - 30);
  const backdated = back.toISOString().slice(0, 10);
  await page.click('.recto [data-action=read-balance]');
  await page.waitForSelector('dialog#sheet[open]');
  await page.fill('input[name=balance]', '13500');
  await page.fill('input[name=date]', backdated);
  await page.click('[data-save]');
  await closed();
  let readings = await text('.recto');
  step('after a backdated reading: ' + readings.slice(0, 190));
  expect(readings.includes('$14,000.00'), 'a reading from last month does not wind the account backwards');
  expect(readings.includes('Readings'), 'the older figure is kept as history');

  await clearToasts();
  await page.click('.recto [data-action=read-balance]');
  await page.waitForSelector('dialog#sheet[open]');
  await page.fill('input[name=balance]', '14620');
  await page.click('[data-save]');
  await closed();
  readings = await text('.recto');
  step('after todays reading: ' + readings.slice(0, 190));
  expect(readings.includes('$14,620.00'), 'the newest reading is what the account holds');
  // Today's earlier figure was corrected rather than kept, so the change is
  // measured against last month's reading: 13,500 → 14,620.
  expect(readings.includes('+$1,120.00'), 'and the change since the reading before it is worked out');

  // ---- The review answers to all of it ----
  await clearToasts();
  await page.goto(BASE + '#/review');
  await page.waitForSelector('.checklist');
  const checks = await text('.checklist');
  step('review: ' + checks.slice(0, 240));
  expect(/Safety net covers 3\.8 of 6/.test(checks), 'the checklist measures the runway');
  expect(/two-step/i.test(checks), 'it asks about sign-in security');
  expect(/balance|reviewed/i.test(checks), 'it asks how current the figures are');
  const recon = await text('.leaf-section:has-text("Does it add up")');
  expect(recon.includes('Core hub'), 'the sums are shown per account');
  await shot('fund-03-review');

  // A pot claiming more than its account holds is caught.
  await clearToasts();
  await page.goto(BASE + '#/pots');
  await page.waitForSelector('.pot-list');
  await page.click('.pot:has-text("Rainy day") [data-action=adjust-plan]');
  await page.waitForSelector('dialog#sheet[open]');
  await page.fill('input[name=amount]', '9000');
  await page.click('[data-save]');
  await closed();
  await clearToasts();
  await page.goto(BASE + '#/review');
  await page.waitForSelector('.checklist');
  step('after over-claiming: ' + (await text('.checklist')).slice(0, 160));
  expect((await text('.checklist')).includes('less than the pots'), 'a pot claiming more than the account holds is flagged');

  console.log('PROBLEMS', JSON.stringify(problems, null, 1));
  console.log('FAILED CHECKS', JSON.stringify(failures, null, 1));
  if (problems.length || failures.length) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
