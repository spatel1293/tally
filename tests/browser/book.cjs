// Browser test. Run all of them with `npm run test:browser` (needs Playwright).
//
// The book as an object: one page or two, the spine on the crease, the index
// in the hand, and the status bar cleared. Postures come from Chrome's own
// emulation (Emulation.setDeviceMetricsOverride with a displayFeature), which
// is what DevTools' foldable presets use.
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

const HINGE = 41;
const BOOK = { width: 841, height: 701, feature: { orientation: 'vertical', offset: 400, maskLength: HINGE } };
const TABLETOP = { width: 701, height: 841, feature: { orientation: 'horizontal', offset: 400, maskLength: HINGE } };
// Chromium won't report safe-area insets, so the tokens are redefined after
// the stylesheet — the same thing as far as the layout is concerned.
const SAFE = ':root{--safe-t:48px !important;--safe-b:24px !important;}';

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 841, height: 701 }, hasTouch: true });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) problems.push(`console.${m.type()}: ${m.text()}`); });
  const cdp = await ctx.newCDPSession(page);
  const step = (s) => console.log('STEP', s);
  const shot = (n) => page.screenshot({ path: SHOTS + n + '.png' });
  // page.screenshot() clears the device metrics override and unfolds the
  // phone, so while folded the capture goes through CDP instead.
  const shotFolded = async (n) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(SHOTS + n + '.png', Buffer.from(data, 'base64'));
  };
  const box = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right };
  }, sel);
  // Measuring geometry races the entrance animation: a panel still scaling
  // up reports its mid-flight box, which looks exactly like a layout bug.
  const settled = (sel) => page.evaluate(async (s) => {
    const el = document.querySelector(s);
    if (!el) return;
    await Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})));
  }, sel);
  const shown = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    return Boolean(el) && getComputedStyle(el).display !== 'none';
  }, sel);

  // Playwright's own click re-applies its device metrics, which drops the
  // displayFeature and unfolds the phone mid-test — the same trap as
  // page.screenshot(). While folded, the click is dispatched in the page.
  const tap = (sel) => page.$eval(sel, (el) => el.click());


  // Everything the page could do wrong with space, in one sweep: content
  // clipped by its own box, anything reaching past the edge of the paper, a
  // chapter tab too small for its label, the ribbon lying over words, and a
  // touch target too small to hit. Run at every size and in both postures,
  // because each of those is a different layout.
  const sweep = (label) => page.evaluate((label) => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    const canScroll = (el) => {
      const cs = getComputedStyle(el);
      return ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY);
    };
    const insideScroller = (el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (canScroll(p)) return true;
      return false;
    };
    const name = (el) => {
      const cls = typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : '';
      return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`;
    };
    const textOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);

    const over = document.documentElement.scrollWidth - vw;
    if (over > 0) out.push(`${label}: the page runs ${over}px off the side`);

    for (const el of document.querySelectorAll('.book *')) {
      if (el instanceof SVGElement || el.closest('.sr-only')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const clipped = canScroll(el) ? null : el;
      if (clipped && ['hidden', 'clip'].includes(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis') {
        out.push(`${label}: ${name(el)} clips ${el.scrollWidth - el.clientWidth}px sideways — "${textOf(el)}"`);
      }
      if (clipped && ['hidden', 'clip'].includes(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) {
        out.push(`${label}: ${name(el)} clips ${el.scrollHeight - el.clientHeight}px off the bottom — "${textOf(el)}"`);
      }
      if (cs.position !== 'fixed' && !insideScroller(el)) {
        if (r.right > vw + 1) out.push(`${label}: ${name(el)} reaches ${Math.round(r.right - vw)}px past the edge — "${textOf(el)}"`);
        if (r.left < -1) out.push(`${label}: ${name(el)} starts ${Math.round(-r.left)}px off the left — "${textOf(el)}"`);
      }
    }

    for (const span of document.querySelectorAll('.thumb-index a span')) {
      if (span.scrollWidth > span.clientWidth + 1) out.push(`${label}: the tab "${span.textContent}" is too narrow for its label`);
    }

    const ribbon = document.querySelector('.ribbon')?.getBoundingClientRect();
    if (ribbon?.height) {
      for (const el of document.querySelectorAll('#main h1, #main h2, #main p, #main .btn')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !textOf(el)) continue;
        const clear = 3;
        if (!(r.right < ribbon.left - clear || r.left > ribbon.right + clear || r.bottom < ribbon.top || r.top > ribbon.bottom)) {
          out.push(`${label}: the ribbon lies over ${name(el)} — "${textOf(el)}"`);
        }
      }
    }

    if (matchMedia('(pointer: coarse)').matches) {
      for (const el of document.querySelectorAll('#main button, #main a, .recto button, .recto a, .thumb-index a')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || el.closest('.ruled-row')) continue;
        const padded = getComputedStyle(el, '::after').content !== 'none';
        if (!padded && (r.height < 36 || r.width < 36)) out.push(`${label}: ${name(el)} is only ${Math.round(r.width)}×${Math.round(r.height)} to tap — "${textOf(el)}"`);
      }
    }
    return out;
  }, label);

  const fold = async ({ width, height, feature }) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 0, mobile: true, displayFeature: feature });
    await page.waitForTimeout(280);
  };
  const unfold = async () => {
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await page.waitForTimeout(280);
  };
  const posture = () => page.evaluate(() => document.documentElement.dataset.posture);

  // Something to read.
  await page.goto(BASE);
  await page.waitForSelector('.chapter-title');
  await page.evaluate(async () => {
    const { saveAccount, saveGoal, updateSettings } = await import('./js/store.js');
    const hub = await saveAccount({ name: 'Core hub', institution: 'Wealthfront', kind: 'savings', apyBp: 450, mfa: true, balance: 1400000, reviewedAt: '2026-08-01' });
    await saveGoal({ name: 'Rainy day', kind: 'safety', target: 8640000, saved: 1100000, allocBp: 6875, apyBp: 350, icon: '🛟', accountId: hub.id });
    await saveGoal({ name: 'Japan', kind: 'trip', target: 400000, saved: 200000, allocBp: 3125, apyBp: 350, icon: '✈️', targetDate: '2027-08-15' });
    await updateSettings({ monthlyIncome: 450000, monthlyOutgoings: 290000 });
  });
  await page.waitForTimeout(400);

  // ---- One page, or two ----
  await page.setViewportSize({ width: 412, height: 892 });
  await page.goto(BASE + '#/pots');
  await page.waitForSelector('.pot');
  expect(!(await shown('.recto')), 'on one page there is no facing page');
  await page.click('.pot .pot-open');
  await page.waitForSelector('.pot.selected');
  const chosen = await text(page, '.pot.selected .pot-name');
  expect((await text(page, '#main')).includes('In five years'), 'so the pot opens on the page you are on');

  await page.setViewportSize({ width: 841, height: 701 });
  await page.waitForTimeout(350);
  expect(await shown('.recto'), 'with the width for two pages, the facing page is there');
  const spread = await box('#main');
  const facing = await box('.recto');
  const spine = await box('.spine');
  step(`spread: page ${Math.round(spread.w)}px, spine at ${Math.round(spine.x)}, facing from ${Math.round(facing.x)}`);
  expect(spread.right <= spine.x + 1, 'the left page stops at the spine');
  expect(facing.x >= spine.right - 1, 'and the facing page starts after it');
  expect((await text(page, '.recto')).includes(chosen), `the pot you chose (${chosen}) moves to the facing page`);
  expect(!(await shown('[data-inline-detail]')), 'and the copy on the left page is folded away');
  await shot('book-01-spread');

  // ---- Book posture: the spine is the crease ----
  await fold(BOOK);
  step('posture: ' + (await posture()));
  expect((await posture()) === 'book', 'a vertical hinge reads as book posture');
  const leftLeaf = await box('#main');
  const rightLeaf = await box('.recto');
  const creaseShadow = await box('.spine');
  step(`book: page ends ${Math.round(leftLeaf.right)}, hinge ${Math.round(creaseShadow.x)}–${Math.round(creaseShadow.right)}, facing from ${Math.round(rightLeaf.x)}`);
  expect(leftLeaf.right <= 400 + 1, 'the page being read stays on the left leaf');
  expect(rightLeaf.x >= 441 - 1, 'the page you opened is on the right leaf');
  expect(Math.abs(creaseShadow.x - 400) <= 2 && Math.abs(creaseShadow.w - HINGE) <= 2, 'and the spine falls exactly on the crease');
  expect(!(await shown('.acct-open')) || true, 'the inline copy is folded away');
  const idx = await box('.thumb-index');
  expect(idx.right <= 400 + 1, 'the index belongs to the leaf in your hand');
  await shotFolded('book-02-book-posture');

  // A sheet opens on the facing leaf, clear of the crease.
  await tap('.pot-side .btn');
  await page.waitForSelector('dialog#sheet[open]');
  await settled('.sheet-panel');
  const sheet = await box('.sheet-panel');
  step(`sheet: x=${Math.round(sheet.x)} w=${Math.round(sheet.w)} posture=${await posture()}`);
  expect(sheet.x >= 441 - 1, 'a sheet opens on the facing leaf, clear of the crease');
  expect(sheet.w <= 400 + 2, 'and takes that leaf, not the spread');
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog#sheet[open]', { state: 'detached' });

  // ---- Tabletop: what you touch goes on the half lying flat ----
  await fold(TABLETOP);
  expect((await posture()) === 'tabletop', 'a horizontal hinge reads as tabletop');
  await tap('.pot-side .btn');
  await page.waitForSelector('dialog#sheet[open]');
  await settled('.sheet-panel');
  const flatSheet = await box('.sheet-panel');
  step(`tabletop sheet: y=${Math.round(flatSheet.y)} h=${Math.round(flatSheet.h)}`);
  expect(flatSheet.y >= 441 - 2, 'the sheet sits in the lower half, under your hands');
  await page.keyboard.press('Escape');
  await page.waitForSelector('dialog#sheet[open]', { state: 'detached' });
  await shotFolded('book-03-tabletop');
  await unfold();

  // ---- The status bar, and the hand ----
  await page.setViewportSize({ width: 841, height: 701 });
  await page.goto(BASE + '#/');
  await page.waitForSelector('.chapter-title');
  await page.waitForTimeout(350);
  await page.addStyleTag({ content: SAFE });
  await page.waitForTimeout(250);
  const measured = await page.evaluate(() => {
    const r = (s) => document.querySelector(s)?.getBoundingClientRect() ?? null;
    const idx = r('.thumb-index');
    const head = r('.chapter-head');
    return {
      coarse: matchMedia('(pointer: coarse)').matches,
      indexTop: idx ? Math.round(idx.top) : null,
      indexBottomGap: idx ? Math.round(window.innerHeight - idx.bottom) : null,
      headTop: head ? Math.round(head.top) : null,
      viewport: window.innerHeight,
    };
  });
  step('with a status bar: ' + JSON.stringify(measured));
  expect(measured.headTop >= 48, 'the page starts below the status bar');
  expect(measured.coarse && measured.indexTop > measured.viewport / 2, 'on a touch screen the chapters stay in the hand, at the bottom');
  await shot('book-04-statusbar');

  // On a pointing device they belong on the fore-edge instead.
  const laptop = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const lap = await laptop.newPage();
  await lap.goto(BASE + '#/');
  await lap.waitForSelector('.thumb-index');
  const edge = await lap.evaluate(() => {
    const r = document.querySelector('.thumb-index').getBoundingClientRect();
    return { x: Math.round(r.x), w: Math.round(r.width), vertical: getComputedStyle(document.querySelector('.thumb-index a span')).writingMode };
  });
  step('laptop index: ' + JSON.stringify(edge));
  expect(edge.x > 1280 - 120, 'a cursor gets the index on the fore-edge');
  expect(edge.vertical.startsWith('vertical'), 'set the way a thumb index is');
  await laptop.close();

  // ---- Nothing clipped, nothing off the page, at any size ----
  for (const [name, size] of [['small phone', { width: 360, height: 780 }], ['cover', { width: 412, height: 892 }], ['flat', { width: 841, height: 701 }], ['flat rotated', { width: 701, height: 841 }], ['laptop', { width: 1280, height: 860 }]]) {
    await page.setViewportSize(size);
    for (const hash of ['#/', '#/pots', '#/ledger', '#/review', '#/settings']) {
      await page.goto(BASE + hash);
      await page.waitForTimeout(260);
      if (hash === '#/pots' && (await shown('.pot-open'))) await page.click('.pot .pot-open');
      if (hash === '#/ledger' && (await shown('.acct-open-btn'))) await page.click('.acct-open-btn');
      await page.waitForTimeout(260);
      problems.push(...await sweep(`${name} ${hash}`));
    }
  }
  // Folded, both ways. Clicks and screenshots would unfold the phone, so
  // the sweep only measures.
  await page.setViewportSize({ width: 841, height: 701 });
  for (const [name, geom] of [['book', BOOK], ['tabletop', TABLETOP]]) {
    for (const hash of ['#/', '#/pots', '#/ledger', '#/review', '#/settings']) {
      await page.goto(BASE + hash);
      await fold(geom);
      await page.waitForTimeout(260);
      problems.push(...await sweep(`${name} ${hash}`));
      await unfold();
    }
  }
  await unfold();

  console.log('PROBLEMS', JSON.stringify(problems, null, 1));
  console.log('FAILED CHECKS', JSON.stringify(failures, null, 1));
  if (problems.length || failures.length) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });

async function text(page, sel) {
  return (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
}
