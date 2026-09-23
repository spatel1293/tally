// Browser test. Run all of them with `npm run test:browser` (needs Playwright).
// Checks that folding/unfolding the Pixel Fold mid-entry (which just resizes
// the page — Android keeps the app running) doesn't lose anything: an open
// add sheet keeps its values, and nothing overflows sideways at any size in
// between. Also exercises the bottom-sheet/centered-dialog switch at 640px
// and the tab-bar/rail switch at 600px, since a resize crosses both.
const { chromium } = require('playwright');
const path = require('path');
const os = require('os');
const BASE_URL = process.env.TALLY_URL || 'http://localhost:5173/';
const SHOTS = (process.env.SHOTS_DIR || path.join(os.tmpdir(), 'tally-shots')) + path.sep;
const launch = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
require('fs').mkdirSync(SHOTS, { recursive: true });
const failures = [];
const expect = (ok, message) => {
  if (!ok) failures.push(message);
};

// Roughly the Fold's cover screen and unfolded inner screen widths (CSS px);
// see docs/HANDOFF-pixel-fold-and-laptop.md for how these were estimated —
// replace with measured values once known.
const COVER = { width: 412, height: 800 };
const INNER = { width: 841, height: 701 };

(async () => {
  const browser = await launch();
  const problems = [];
  const ctx = await browser.newContext({ viewport: COVER });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`console.${m.type()}: ${m.text()}`); });
  const step = (s) => console.log('STEP', s);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await page.goto(BASE_URL);
  await page.waitForSelector('.fab', { timeout: 5000 });

  // Open the add sheet at cover-screen width (bottom sheet, tab bar visible).
  await page.click('.fab');
  await page.waitForSelector('dialog#sheet[open]');
  await page.fill('input[name=amount]', '18.42');
  await page.fill('input[name=note]', 'Fold test note');
  await page.click('label.chip:has-text("Groceries")');
  await page.screenshot({ path: SHOTS + 'fold01-cover-sheet.png' });
  step(`cover overflow: ${await overflow()}px`);
  expect(!(await page.locator('.tx-context').isVisible()), 'category context stays out of the way on the cover screen');

  // Unfold: resize to the inner screen width. The sheet should stay open
  // with the same values, now as a centered dialog with the nav rail showing.
  await page.setViewportSize(INNER);
  await page.waitForTimeout(200);
  const openAfterUnfold = await page.locator('dialog#sheet[open]').count();
  expect(openAfterUnfold === 1, 'sheet stays open across the cover-to-inner resize');
  expect((await page.inputValue('input[name=amount]')) === '18.42', 'amount survives the resize');
  expect((await page.inputValue('input[name=note]')) === 'Fold test note', 'note survives the resize');
  expect(await page.locator('label.chip:has-text("Groceries")').evaluate((el) => el.querySelector('input')?.checked) === true, 'category selection survives the resize');
  step(`inner overflow: ${await overflow()}px`);
  // Unfolding should reveal more, not just stretch the form.
  expect(await page.locator('.tx-context').isVisible(), 'unfolding reveals the category context beside the form');
  await page.screenshot({ path: SHOTS + 'fold02-inner-sheet.png' });

  // Fold back to the cover width; same checks in reverse.
  await page.setViewportSize(COVER);
  await page.waitForTimeout(200);
  const openAfterRefold = await page.locator('dialog#sheet[open]').count();
  expect(openAfterRefold === 1, 'sheet stays open across the inner-to-cover resize');
  expect((await page.inputValue('input[name=amount]')) === '18.42', 'amount survives the refold');
  expect((await page.inputValue('input[name=note]')) === 'Fold test note', 'note survives the refold');
  step(`refolded overflow: ${await overflow()}px`);
  expect(!(await page.locator('.tx-context').isVisible()), 'folding back tucks the context away again');
  await page.screenshot({ path: SHOTS + 'fold03-cover-again.png' });

  // Saving still works after all that.
  await page.click('[data-save]');
  await page.waitForSelector('dialog#sheet[open]', { state: 'detached' });
  step('hero after save: ' + (await page.textContent('.hero-spend .hero-line')).trim());

  // Sweep every width from cover to inner for horizontal overflow on Home,
  // Activity and Budgets, since the rail/two-column switches happen in here.
  await page.goto(BASE_URL + '#/activity');
  for (const width of [412, 480, 599, 600, 640, 700, 760, 841, 900, 1040]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(120);
    for (const hash of ['#/', '#/activity', '#/budgets']) {
      await page.goto(BASE_URL + hash);
      await page.waitForTimeout(80);
      const ov = await overflow();
      if (ov > 0) problems.push(`${width}px ${hash} overflows by ${ov}px`);
    }
  }

  console.log('PROBLEMS', JSON.stringify(problems, null, 1));
  console.log('FAILED CHECKS', JSON.stringify(failures, null, 1));
  if (problems.length || failures.length) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
