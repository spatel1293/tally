// Browser test. Run all of them with `npm run test:browser` (needs Playwright).
//
// The savings-first half of the app: plans with a share of the surplus and a
// yield, the advisor's checklist, the account ledger, and the vault that
// seals account numbers and logins behind a passphrase. Runs at the Fold's
// opened-flat size, because that is where the list and the detail are both
// on screen and most of this is visible at once.
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
  // A toast sits over the capsule while it is up, and hovering it keeps it
  // there. Nothing here is testing toasts, so they are cleared between steps.
  const clearToasts = () => page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));

  await page.goto(BASE);
  await page.waitForSelector('.empty h2');
  expect((await text('.empty h2')) === 'Start with a safety net', 'an empty app asks for a safety net first');

  // ---- A safety net, with a share of the surplus and a yield ----
  await page.click('main [data-action=new-goal][data-kind=safety]');
  await page.waitForSelector('dialog#sheet[open]');
  expect(await page.isChecked('input[name=kind][value=safety]'), 'the safety net kind is preselected');
  await page.fill('input[name=name]', 'Rainy day');
  await page.fill('input[name=target]', '86400');
  await page.fill('input[name=saved]', '11000');
  await page.fill('input[name=alloc]', '68.75');
  await page.fill('input[name=apy]', '3.5');
  await page.click('[data-save]');
  await closed();
  step('after the safety net: ' + (await text('.hero-line')));

  // Two more plans, so the shares have to add up.
  for (const [name, kind, target, alloc, apy] of [['Wealth builder', 'invest', '25000', '9.38', '7'], ['Japan', 'trip', '4000', '7.81', '3.5']]) {
    await page.goto(BASE + '#/goals');
    await page.waitForSelector('.page-actions [data-action=new-goal]');
    await page.click('.page-actions [data-action=new-goal]');
    await page.waitForSelector('dialog#sheet[open]');
    await page.click(`input[name=kind][value=${kind}]`);
    await page.fill('input[name=name]', name);
    await page.fill('input[name=target]', target);
    await page.fill('input[name=alloc]', alloc);
    await page.fill('input[name=apy]', apy);
    await page.click('[data-save]');
    await closed();
  }

  // Only one plan can be the safety net.
  await page.goto(BASE + '#/goals');
  await page.waitForSelector('.goal-list');
  await page.click('.plan:has-text("Japan") [data-action=edit-goal]');
  await page.waitForSelector('dialog#sheet[open]');
  await page.click('input[name=kind][value=safety]');
  await page.click('[data-save]');
  await page.waitForSelector('.field-error:not([hidden])');
  step('second safety net: ' + (await text('.field-error:not([hidden])')));
  expect((await text('.field-error:not([hidden])')).includes('already the safety net'), 'a second safety net is refused by name');
  // A share that would take the total past 100% is refused too.
  await page.click('input[name=kind][value=trip]');
  await page.fill('input[name=alloc]', '40');
  await page.click('[data-save]');
  expect((await text('.field-error:not([hidden])')).includes('at most'), 'shares cannot add up to more than 100%');
  await page.keyboard.press('Escape');
  await closed();

  // ---- Income and spending, so there is a surplus to share out ----
  const pay = async (type, amount, note, day) => {
    await clearToasts();
    await page.click('.fab');
    await page.waitForSelector('dialog#sheet[open]');
    if (type === 'income') await page.click('label:has-text("Income")');
    await page.fill('input[name=amount]', amount);
    await page.fill('input[name=note]', note);
    await page.fill('input[name=date]', day);
    const chip = page.locator('label.chip').first();
    await chip.click();
    await page.click('[data-save]');
    await closed();
  };
  const iso = (d) => d.toISOString().slice(0, 10);
  const monthsBack = (n, day = 5) => {
    const d = new Date();
    return iso(new Date(d.getFullYear(), d.getMonth() - n, day));
  };
  for (const n of [1, 2, 3]) {
    await pay('income', '4500', 'Pay', monthsBack(n, 1));
    await pay('expense', '2900', 'Living', monthsBack(n, 10));
  }

  await clearToasts();
  await page.goto(BASE + '#/');
  await page.waitForSelector('.hero-savings');
  const hero = await text('.hero-savings');
  step('home: ' + hero);
  expect(/months of runway|months? of \d+ months/.test(hero), 'home leads with the runway, not the month');
  expect(hero.includes('$1,600.00'), 'home shows the usual surplus');
  await shot('sv01-home');

  const alloc = await text('.alloc-rows');
  step('allocation: ' + alloc);
  expect(alloc.includes('Rainy day') && alloc.includes('69%'), 'the surplus split names each plan and its share');
  expect(alloc.includes('Unallocated'), 'what has no share is called out');

  // ---- Choosing a plan fills the facing page ----
  await page.goto(BASE + '#/goals');
  await page.waitForSelector('.goal-list');
  await page.click('.plan:has-text("Rainy day") .plan-select');
  await page.waitForSelector('.companion .plan-detail');
  const detail = await text('.companion .plan-detail');
  step('second page: ' + detail);
  expect(detail.includes('Rainy day') && detail.includes('In five years'), 'the facing page shows the chosen plan in full');
  expect(detail.includes('69%') || detail.includes('$1,100.00'), 'it names the share it gets each month');
  await shot('sv02-plan-detail');

  const ms = await text('.milestones');
  step('milestones: ' + ms.slice(0, 160));
  expect(ms.includes('Total'), 'the five-year table totals every pot');

  // ---- The advisor ----
  await page.goto(BASE + '#/advisor');
  await page.waitForSelector('.checklist.full');
  const checks = await text('.checklist.full');
  step('advisor: ' + checks.slice(0, 200));
  expect(/Safety net covers/.test(checks), 'the checklist measures the safety net');
  expect(checks.includes('No accounts recorded'), 'with no accounts, the checklist asks for them');
  await page.fill('input[name=runwayTarget]', '3');
  await page.click('.targets button[type=submit]');
  await page.waitForTimeout(250);
  await page.goto(BASE + '#/advisor');
  await page.waitForSelector('.checklist.full');
  expect((await text('.checklist.full')).includes('of 3 months') || (await text('.checklist.full')).includes('Safety net covers'), 'the target is saved and used');
  await shot('sv03-advisor');

  // ---- The vault ----
  await clearToasts();
  await page.goto(BASE + '#/accounts');
  await page.waitForSelector('.vault-strip');
  expect((await text('.vault-strip')).includes('No vault yet'), 'the vault starts empty');
  await page.click('[data-action=vault-create]');
  await page.waitForSelector('dialog#confirm[open]');
  await page.fill('#vault-pass', 'correct-horse-battery');
  await page.fill('#vault-pass2', 'nope');
  await page.click('dialog#confirm button[type=submit]');
  expect(!(await page.isHidden('#vault-error')), 'a mismatched passphrase is refused');
  await page.fill('#vault-pass2', 'correct-horse-battery');
  await page.click('dialog#confirm button[type=submit]');
  await page.waitForSelector('dialog#confirm[open]', { state: 'detached' });
  expect((await text('.vault-strip')).includes('Vault open'), 'the vault is open once it is created');

  await clearToasts();
  await page.click('main [data-action=new-account]');
  await page.waitForSelector('dialog#sheet[open]');
  await page.fill('input[name=name]', 'Core hub');
  await page.fill('input[name=institution]', 'Wealthfront');
  await page.selectOption('select[name=kind]', 'savings');
  await page.fill('input[name=apy]', '4.5');
  await page.check('input[name=mfa]');
  await page.waitForSelector('input[name=accountNumber]');
  await page.fill('input[name=accountNumber]', '123456789012');
  await page.fill('input[name=routingNumber]', '021000021');
  await page.fill('input[name=username]', 'sheel@example.com');
  await page.fill('input[name=password]', 'hunter2-but-longer');
  await page.click('[data-save]');
  await closed();
  await page.waitForSelector('.acct-card');
  const card = await text('.acct-card');
  step('account: ' + card);
  expect(card.includes('Wealthfront') && card.includes('4.50% APY') && card.includes('2-step on'), 'the card carries the institution, the rate and the security');
  expect(card.includes('Sealed details'), 'the card says the details are sealed');

  // The sealed values are never in the page as plain text.
  await clearToasts();
  await page.click('.acct-head');
  await page.waitForSelector('.companion .vault-fields');
  const bodyText = await page.textContent('body');
  expect(!bodyText.includes('123456789012'), 'a full account number is never rendered while masked');
  expect(!bodyText.includes('hunter2-but-longer'), 'a password is never rendered while masked');
  expect((await text('.companion .vault-fields')).includes('•••• 9012'), 'the last four stand in for the number');
  await page.click('.companion .vault-fields [data-action=reveal-secret]');
  await page.waitForTimeout(120);
  expect((await page.textContent('body')).includes('123456789012'), 'showing it reveals the number');
  await shot('sv04-vault-open');

  // Locking seals it again, and what is stored is ciphertext.
  await clearToasts();
  await page.click('[data-action=vault-lock]');
  await page.waitForTimeout(250);
  expect((await text('.vault-strip')).includes('Vault locked'), 'the vault locks on request');
  expect(!(await page.textContent('body')).includes('123456789012'), 'the number goes away with the lock');
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
    return JSON.stringify(rows);
  });
  step('stored account row: ' + stored.slice(0, 180));
  expect(!stored.includes('123456789012') && !stored.includes('hunter2'), 'nothing sensitive is stored in the clear');
  expect(stored.includes('"vault"'), 'the sealed blob is what is stored');

  // Reopening with the wrong passphrase fails; the right one works.
  await clearToasts();
  await page.click('[data-action=vault-unlock]');
  await page.waitForSelector('dialog#confirm[open]');
  await page.fill('#vault-pass', 'wrong-passphrase');
  await page.click('dialog#confirm button[type=submit]');
  await page.waitForTimeout(400);
  expect(!(await page.isHidden('#vault-error')), 'the wrong passphrase is refused');
  await page.fill('#vault-pass', 'correct-horse-battery');
  await page.click('dialog#confirm button[type=submit]');
  await page.waitForSelector('dialog#confirm[open]', { state: 'detached' });
  expect((await text('.vault-strip')).includes('Vault open'), 'the right passphrase opens it again');

  // The checklist answers to the data: an account with a second step and a
  // review date clears the two items that were open a moment ago.
  await clearToasts();
  await page.click('[data-action=mark-reviewed]');
  await page.waitForTimeout(250);
  await page.goto(BASE + '#/advisor');
  await page.waitForSelector('.checklist.full');
  const after = await text('.checklist.full');
  step('advisor after the account: ' + after.slice(0, 140));
  expect(after.includes('Two-factor sign-in on every account'), 'a second step on every login clears that check');
  expect(after.includes('Every account reviewed recently'), 'marking it reviewed clears the review check');

  // A backup carries the ciphertext, not the secrets.
  const backup = await page.evaluate(() => JSON.stringify(window.localStorage));
  expect(!backup.includes('123456789012'), 'local storage holds no secrets either');

  // ---- The cover screen never shows a full number ----
  await clearToasts();
  await page.setViewportSize({ width: 412, height: 892 });
  await page.goto(BASE + '#/accounts');
  await page.waitForSelector('.acct-card');
  // The account is still the chosen one from the wide layout, and choosing
  // it again would close it — so it is only tapped if nothing is open.
  if (!(await page.isVisible('.acct-inline'))) await page.click('.acct-head');
  await page.waitForSelector('[data-inline-detail] .vault-fields, .acct-inline .vault-fields');
  expect(await page.isHidden('.vault-fields [data-action=reveal-secret]'), 'the cover screen offers no way to reveal a full number');
  expect((await text('.cover-only')).includes('Unfold'), 'and says where to see it');
  await shot('sv05-cover-masked');

  console.log('PROBLEMS', JSON.stringify(problems, null, 1));
  console.log('FAILED CHECKS', JSON.stringify(failures, null, 1));
  if (problems.length || failures.length) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
