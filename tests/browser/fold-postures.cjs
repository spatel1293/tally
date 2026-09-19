// Browser test. Run all of them with `npm run test:browser` (needs Playwright).
// Emulates the Pixel Fold's half-folded postures the way Chrome reports them
// (two viewport segments with a hinge between), and checks the app keeps
// content and dialogs off the crease:
//   book     — hinge top to bottom: page on the left, sheet on the right
//   tabletop — hinge left to right: sheet in the bottom half
// The emulation is Chrome's own (Emulation.setDeviceMetricsOverride with a
// displayFeature), which is what DevTools' foldable presets use.
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

// The inner screen, half folded. Each segment is a page; the hinge is the gap.
const HINGE = 41;
const BOOK = { width: 841, height: 701, feature: { orientation: 'vertical', offset: 400, maskLength: HINGE } };
const TABLETOP = { width: 701, height: 841, feature: { orientation: 'horizontal', offset: 400, maskLength: HINGE } };

(async () => {
  const browser = await launch();
  const problems = [];
  const ctx = await browser.newContext({ viewport: { width: 841, height: 701 }, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`console.${m.type()}: ${m.text()}`); });
  const cdp = await ctx.newCDPSession(page);
  const step = (s) => console.log('STEP', s);

  const fold = async ({ width, height, feature }) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 0, mobile: true, displayFeature: feature });
    await page.waitForTimeout(250);
  };
  const unfold = async () => {
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await page.waitForTimeout(250);
  };
  // page.screenshot() resets the device-metrics override and with it the
  // posture, so capture through CDP instead and leave the emulation alone.
  // These captures composite the top layer oddly, so an open sheet looks
  // semi-transparent in them; on the device it is opaque.
  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(SHOTS + name + '.png', Buffer.from(data, 'base64'));
  };
  const posture = () => page.evaluate(() => document.documentElement.dataset.posture);
  const box = (sel) => page.locator(sel).boundingBox();
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

  await page.goto(BASE_URL);
  await page.waitForSelector('.empty h2');
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('main [data-action=import-csv]')]);
  await chooser.setFiles(FIXTURES + 'history.csv');
  await page.waitForSelector('dialog#sheet[open] .import-summary');
  await page.click('[data-apply]');
  await page.waitForSelector('dialog#sheet[open]', { state: 'detached' });
  // Hovering a toast pauses its dismissal on purpose, and the pointer is
  // still where the apply button was, so move it off first.
  await page.mouse.move(5, 5);
  await page.waitForSelector('.toast', { state: 'detached', timeout: 20000 });

  // ---- Flat (unfolded) reports one segment ----
  expect((await posture()) === 'flat', `unfolded posture should be flat, got ${await posture()}`);

  // ---- Book posture ----
  await fold(BOOK);
  step(`book posture: ${await posture()}`);
  expect((await posture()) === 'book', `half-folded with a vertical hinge should be book, got ${await posture()}`);

  const mainBox = await box('#main');
  step(`book main box: x=${Math.round(mainBox.x)} w=${Math.round(mainBox.width)}`);
  expect(mainBox.x + mainBox.width <= 400 + 1, `page content should stay on the left page, ends at ${Math.round(mainBox.x + mainBox.width)}`);

  const compBox = await box('.companion');
  expect(Boolean(compBox) && compBox.x >= 441 - 1, `facing page should sit on the right page, starts at ${compBox ? Math.round(compBox.x) : 'hidden'}`);
  const compText = (await page.textContent('.companion')).replace(/\s+/g, ' ').trim();
  step(`facing page: ${compText}`);
  expect(/transactions this month/.test(compText), 'facing page shows the month summary');
  await shot('fold-book-home');

  // The sheet opens on the right page, clear of the crease.
  await page.click('.fab');
  await page.waitForSelector('dialog#sheet[open]');
  await page.fill('input[name=amount]', '24.50');
  await page.fill('input[name=note]', 'Posture test');
  const bookPanel = await box('.sheet-panel');
  step(`book sheet panel: x=${Math.round(bookPanel.x)} w=${Math.round(bookPanel.width)}`);
  expect(bookPanel.x >= 441 - 1, `sheet should start on the right page, starts at ${Math.round(bookPanel.x)}`);
  expect(bookPanel.x + bookPanel.width <= 841 + 1, 'sheet should stay inside the right page');
  await shot('fold-book-sheet');

  // ---- Reposture to tabletop mid-entry ----
  await fold(TABLETOP);
  step(`tabletop posture: ${await posture()}`);
  expect((await posture()) === 'tabletop', `half-folded with a horizontal hinge should be tabletop, got ${await posture()}`);
  expect((await page.locator('dialog#sheet[open]').count()) === 1, 'sheet survives a posture change');
  expect((await page.inputValue('input[name=amount]')) === '24.50', 'amount survives a posture change');
  expect((await page.inputValue('input[name=note]')) === 'Posture test', 'note survives a posture change');

  const tablePanel = await box('.sheet-panel');
  step(`tabletop sheet panel: y=${Math.round(tablePanel.y)} h=${Math.round(tablePanel.height)}`);
  expect(tablePanel.y >= 441 - 1, `sheet should sit below the crease, starts at ${Math.round(tablePanel.y)}`);
  expect(tablePanel.y + tablePanel.height <= 841 + 1, 'sheet should stay inside the bottom half');
  await shot('fold-tabletop-sheet');

  // Saving still works from the bottom half.
  await page.click('label.chip:has-text("Groceries")');
  await page.click('[data-save]');
  await page.waitForSelector('dialog#sheet[open]', { state: 'detached' });
  step('saved from tabletop: ' + (await page.textContent('.toast-msg')).trim());
  await shot('fold-tabletop-home');

  // ---- Back to flat ----
  await unfold();
  step(`unfolded posture: ${await posture()}`);
  expect((await posture()) === 'flat', 'opening flat returns to the normal layout');
  expect((await page.locator('.companion').count()) === 1 && !(await box('.companion')), 'facing page is hidden when flat');

  for (const [name, geom] of [['book', BOOK], ['tabletop', TABLETOP]]) {
    await fold(geom);
    for (const hash of ['#/', '#/activity', '#/budgets']) {
      await page.goto(BASE_URL + hash);
      await page.waitForTimeout(150);
      const ov = await overflow();
      if (ov > 0) problems.push(`${name} ${hash} overflows by ${ov}px`);
    }
  }
  await unfold();

  console.log('PROBLEMS', JSON.stringify(problems, null, 1));
  console.log('FAILED CHECKS', JSON.stringify(failures, null, 1));
  if (problems.length || failures.length) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
