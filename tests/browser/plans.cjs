// Browser test. Run all of them with `npm run test:browser` (needs Playwright).
// Plans: a nest egg you fill, a trip you fill and then spend down, and the
// what-if panel that says whether the dates are reachable.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE_URL = process.env.TALLY_URL || 'http://localhost:5173/';
const SHOTS = (process.env.SHOTS_DIR || path.join(os.tmpdir(), 'tally-shots')) + path.sep;
const FIXTURES = path.join(__dirname, 'fixtures') + path.sep;
const launch = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
fs.mkdirSync(SHOTS, { recursive: true });
const failures = [];
const expect = (ok, message) => {
  if (!ok) failures.push(message);
};
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const inMonths = (n) => {
  const d = new Date();
  return iso(new Date(d.getFullYear(), d.getMonth() + n, 15));
};

(async () => {
  const browser = await launch();
  const problems = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`console.${m.type()}: ${m.text()}`); });
  const step = (s) => console.log('STEP', s);
  const text = async (sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
  const closed = () => page.waitForSelector('dialog#sheet[open]', { state: 'detached' });
  const settle = () => page.waitForTimeout(350);

  // Real history, so the surplus figure has something to be computed from.
  await page.goto(BASE_URL);
  await page.waitForSelector('.empty h2');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('main [data-action=import-csv]')]);
  await chooser.setFiles(FIXTURES + 'history.csv');
  await page.waitForSelector('dialog#sheet[open] .import-summary');
  await page.click('[data-apply]');
  await closed();
  await page.mouse.move(5, 5);
  await page.waitForSelector('.toast', { state: 'detached', timeout: 20000 });

  // ---- Empty state ----
  await page.goto(BASE_URL + '#/goals');
  await page.waitForSelector('.empty h2');
  step('empty: ' + await text('.empty h2'));

  // ---- A nest egg ----
  await page.click('main [data-action=new-goal]');
  await page.waitForSelector('dialog#sheet[open]');
  await page.fill('input[name=name]', 'Emergency fund');
  await page.fill('input[name=target]', '6000');
  await page.fill('input[name=saved]', '1500');
  await page.fill('input[name=targetDate]', inMonths(6));
  await page.click('[data-save]');
  await closed();

  // ---- A trip, with dates ----
  await page.click('main [data-action=new-goal]');
  await page.waitForSelector('dialog#sheet[open]');
  await page.click('label:has-text("Trip") input[name=kind]');
  expect(!(await page.locator('.trip-dates').isHidden()), 'choosing Trip reveals the travel dates');
  await page.fill('input[name=name]', 'Japan');
  await page.fill('input[name=target]', '4000');
  await page.fill('input[name=targetDate]', inMonths(10));
  await page.fill('input[name=startDate]', inMonths(11));
  await page.fill('input[name=endDate]', inMonths(11));
  await page.click('[data-save]');
  await closed();
  await page.mouse.move(5, 5);

  const cards = page.locator('.plan');
  expect((await cards.count()) === 2, `both plans show, got ${await cards.count()}`);
  // Soonest date first.
  expect((await cards.nth(0).locator('h2').textContent()).includes('Emergency'), 'the nearest date comes first');
  expect((await text('.plan-kind')) === 'Nest egg', 'a plan says which kind it is');
  step('headline: ' + await text('.plan-headline'));

  // ---- The what-if levers move every date ----
  const before = await text('.plan-headline');
  await page.fill('[data-plan-levers] input[name=monthly]', '50');
  await settle();
  const lean = await text('.plan-headline');
  step('at $50 a month: ' + lean);
  expect(lean !== before, 'changing the monthly amount changes the outlook');
  expect(/misses|never fill/.test(lean), 'a thin monthly amount is reported as missing the dates');

  await page.fill('[data-plan-levers] input[name=monthly]', '1200');
  await settle();
  const rich = await text('.plan-headline');
  step('at $1,200 a month: ' + rich);
  expect(/funded by/.test(rich), 'a generous monthly amount reaches every plan');

  // A one-off now should only ever bring a date closer.
  await page.fill('[data-plan-levers] input[name=lumpSum]', '3000');
  await settle();
  step('with a $3,000 one-off: ' + await text('.plan-headline'));
  expect((await page.locator('.plan-verdict.ok').count()) >= 1, 'a lump sum puts at least one plan back on time');

  // Typing a half-finished number must not blank the page.
  await page.fill('[data-plan-levers] input[name=monthly]', '1,2');
  await settle();
  expect((await page.locator('.plan-headline').count()) === 1, 'a half-typed amount leaves the projection standing');
  await page.screenshot({ path: SHOTS + 'plans-laptop.png' });

  // ---- Charging spending to the trip ----
  await page.goto(BASE_URL);
  await page.click('.rail-cta');
  await page.waitForSelector('dialog#sheet[open]');
  await page.fill('input[name=amount]', '820.00');
  await page.click('label.chip:has-text("Transportation")');
  await page.fill('input[name=note]', 'Flights');
  await page.selectOption('select[name=planId]', { label: 'Japan' });
  await page.click('[data-save]');
  await closed();
  await page.mouse.move(5, 5);

  await page.goto(BASE_URL + '#/goals');
  await page.waitForSelector('.plan');
  const japan = page.locator('.plan', { hasText: 'Japan' });
  const japanText = (await japan.textContent()).replace(/\s+/g, ' ').trim();
  step('trip card: ' + japanText);
  expect(/Spent on this trip/.test(japanText), 'the trip shows what has been charged to it');
  expect(/\$820\.00/.test(japanText), 'the trip shows the amount charged');

  // Income can't belong to a plan.
  await page.goto(BASE_URL);
  await page.click('.rail-cta');
  await page.waitForSelector('dialog#sheet[open]');
  await page.click('label:has-text("Income") input[name=type]');
  await page.waitForTimeout(150);
  expect(await page.locator('[data-plan-field]').isHidden(), 'income cannot be charged to a plan');
  await page.keyboard.press('Escape');
  await closed();

  // ---- The second page points at the nearest plan ----
  const nextPlan = (await page.textContent('.companion-plan')).replace(/\s+/g, ' ').trim();
  step('second page: ' + nextPlan);
  expect(/Emergency fund/.test(nextPlan), 'the second page names the nearest plan');

  // ---- No sideways scrolling at any size ----
  for (const [name, width, height] of [['cover', 412, 915], ['fold', 841, 701], ['laptop', 1280, 900]]) {
    await page.setViewportSize({ width, height });
    await page.goto(BASE_URL + '#/goals');
    await page.waitForTimeout(250);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (ov > 0) problems.push(`plans at ${name} (${width}px) overflows by ${ov}px`);
    await page.screenshot({ path: SHOTS + `plans-${name}.png` });
  }

  console.log('PROBLEMS', JSON.stringify(problems, null, 1));
  console.log('FAILED CHECKS', JSON.stringify(failures, null, 1));
  if (problems.length || failures.length) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
