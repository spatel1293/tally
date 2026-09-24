const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:5199/';
const SAFE = ':root{--safe-t:48px !important;--safe-b:24px !important;}';

// Deliberately hostile: long names, big numbers, many rows, no gaps to hide in.
const seed = async (page, { many = false } = {}) => {
  await page.goto(BASE);
  await page.waitForSelector('.chapter-title');
  await page.evaluate(async (many) => {
    const { saveAccount, saveGoal, updateSettings, recordBalance } = await import('./js/store.js');
    const hub = await saveAccount({ name: 'Vanguard Total Stock Market Index Admiral', institution: 'Vanguard Brokerage Services', kind: 'brokerage', role: 'investing', apyBp: 725, mfa: true, reviewedAt: '2026-08-01', balance: 9999999999, balanceAt: '2026-08-01', notes: 'Beneficiary set; two-factor via hardware key; statements arrive on the 3rd.' });
    await recordBalance(hub.id, 10123456789, '2026-09-20');
    const card = await saveAccount({ name: 'Card', institution: 'Schwab', kind: 'credit', role: 'spending', mfa: false, balance: -123456789, balanceAt: '2025-01-05' });
    await saveGoal({ name: 'Emergency fund for absolutely everything', kind: 'safety', target: 8640000000, saved: 1100000000, allocBp: 6875, apyBp: 350, color: '#1d4e6f', icon: '🛟', accountId: hub.id });
    await saveGoal({ name: 'W', kind: 'invest', target: 2500000, saved: 2500000, allocBp: 938, apyBp: 700, color: '#3f5d43', icon: '📈' });
    await saveGoal({ name: 'Japan, in cherry blossom season', kind: 'trip', target: 400000, saved: 200000, allocBp: 781, apyBp: 350, color: '#7b3f2e', icon: '✈️', targetDate: '2027-08-15', accountId: card.id });
    if (many) {
      for (let i = 0; i < 6; i++) {
        await saveGoal({ name: `Pot number ${i + 1}`, kind: 'fund', target: 100000 * (i + 1), saved: 5000 * i, allocBp: 100, apyBp: 200, color: '#6b4a7a', icon: '🚗' });
        await saveAccount({ name: `Account ${i + 1}`, institution: 'Institution', kind: 'savings', apyBp: 100 * i, mfa: i % 2 === 0, balance: 100000 * i, balanceAt: '2026-09-01' });
      }
    }
    await updateSettings({ monthlyIncome: 450000000, monthlyOutgoings: 290000000, runwayTarget: 6 });
  }, many);
  await page.waitForTimeout(500);
};

const audit = async (page, label) => {
  return page.evaluate((label) => {
    const out = [];
    const vw = document.documentElement.clientWidth;
    const canScroll = (el) => {
      const cs = getComputedStyle(el);
      return ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY);
    };
    // Something inside a box that scrolls is reachable, not clipped.
    const insideScroller = (el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (canScroll(p)) return true;
      return false;
    };
    const isScroller = (el) => canScroll(el) || el.closest('.sr-only');
    const name = (el) => {
      const cls = typeof el.className === 'string' ? el.className.split(' ').filter(Boolean).slice(0, 2).join('.') : '';
      return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`;
    };
    const textOf = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);

    // Anything running off the page.
    const docOver = document.documentElement.scrollWidth - vw;
    if (docOver > 0) out.push(`${label}: page runs ${docOver}px off the side`);

    for (const el of document.querySelectorAll('.book *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;

      // Clipped content: the box is smaller than what is in it.
      const clipsX = ['hidden', 'clip'].includes(cs.overflowX);
      const clipsY = ['hidden', 'clip'].includes(cs.overflowY);
      if (clipsX && !isScroller(el) && !(el instanceof SVGElement) && el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis') {
        out.push(`${label}: ${name(el)} clips ${el.scrollWidth - el.clientWidth}px sideways — "${textOf(el)}"`);
      }
      if (clipsY && !isScroller(el) && !(el instanceof SVGElement) && el.scrollHeight > el.clientHeight + 1) {
        out.push(`${label}: ${name(el)} clips ${el.scrollHeight - el.clientHeight}px off the bottom — "${textOf(el)}"`);
      }
      // Anything sticking out past the right edge.
      if (r.right > vw + 1 && cs.position !== 'fixed' && !insideScroller(el) && !(el instanceof SVGElement)) {
        out.push(`${label}: ${name(el)} reaches ${Math.round(r.right - vw)}px past the edge — "${textOf(el)}"`);
      }
      if (r.left < -1 && cs.position !== 'fixed' && !insideScroller(el) && !(el instanceof SVGElement)) {
        out.push(`${label}: ${name(el)} starts ${Math.round(-r.left)}px off the left — "${textOf(el)}"`);
      }
    }

    // Chapter tabs: the labels must fit in their tabs.
    for (const span of document.querySelectorAll('.thumb-index a span')) {
      if (span.scrollWidth > span.clientWidth + 1) out.push(`${label}: chapter tab "${span.textContent}" is ${span.scrollWidth - span.clientWidth}px too wide for its tab`);
    }

    // The ribbon is decoration; it must not lie over words.
    const ribbon = document.querySelector('.ribbon')?.getBoundingClientRect();
    if (ribbon && ribbon.height) {
      for (const el of document.querySelectorAll('#main h1, #main h2, #main p, #main .btn, .chapter-actions .btn')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !textOf(el)) continue;
        const clear = 3;
        const over = !(r.right < ribbon.left - clear || r.left > ribbon.right + clear || r.bottom < ribbon.top || r.top > ribbon.bottom);
        if (over) out.push(`${label}: the ribbon comes within ${clear}px of ${name(el)} — "${textOf(el)}"`);
      }
    }

    // Touch targets.
    if (matchMedia('(pointer: coarse)').matches) {
      for (const el of document.querySelectorAll('#main button, #main a, .recto button, .recto a, .thumb-index a')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const pad = getComputedStyle(el, '::after').content !== 'none';
        if ((r.height < 36 || r.width < 36) && !pad && !el.closest('.ruled-row')) {
          out.push(`${label}: ${name(el)} is only ${Math.round(r.width)}×${Math.round(r.height)} to tap — "${textOf(el)}"`);
        }
      }
    }
    return out;
  }, label);
};

// Can the bottom of a page actually be read, or does the index sit on it?
const bottomCheck = async (page, label) => {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(250);
  return page.evaluate((label) => {
    const out = [];
    const index = document.querySelector('.thumb-index')?.getBoundingClientRect();
    // Only a bottom index can sit on the end of a page; on the fore-edge it
    // is beside the text, not over it.
    if (!index || index.left > 40) return out;
    const last = [...document.querySelectorAll('#main > *')].filter((el) => el.getBoundingClientRect().height).pop();
    if (!last) return out;
    const r = last.getBoundingClientRect();
    // The gradient starts a third of the way up the index, so anything below
    // that line is being read through it.
    if (r.bottom > index.top + index.height * 0.5) {
      out.push(`${label}: the last thing on the page ends ${Math.round(r.bottom - index.top)}px into the chapter index`);
    }
    return out;
  }, label);
};

(async () => {
  const browser = await chromium.launch();
  const problems = [];
  const sizes = [
    { name: 'small phone 360', w: 360, h: 780, touch: true, safe: true },
    { name: 'cover 412', w: 412, h: 892, touch: true, safe: true },
    { name: 'flat 841', w: 841, h: 701, touch: true, safe: true },
    { name: 'flat rotated 701', w: 701, h: 841, touch: true, safe: true },
    { name: 'laptop 1280', w: 1280, h: 860, touch: false, safe: false },
    { name: 'wide 1600', w: 1600, h: 1000, touch: false, safe: false },
  ];
  for (const s of sizes) {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, isMobile: s.touch, hasTouch: s.touch });
    const page = await ctx.newPage();
    await seed(page, { many: true });
    if (s.safe) await page.addStyleTag({ content: SAFE });
    if (process.env.SELFTEST) {
      // Plant a defect and make sure the audit still sees one.
      await page.addStyleTag({ content: '.display-value{width:24px;overflow:hidden;display:inline-block} .chapter-blurb{position:relative;left:400px}' });
      await page.waitForTimeout(200);
      const found = await audit(page, `${s.name} SELFTEST`);
      console.log(`SELFTEST at ${s.name}: ${found.length} caught`);
      found.slice(0, 3).forEach((f) => console.log('   ', f));
      await ctx.close();
      continue;
    }
    for (const [route, chapter] of [['', 'fund'], ['pots', 'pots'], ['ledger', 'ledger'], ['review', 'review'], ['settings', 'endpapers']]) {
      await page.goto(BASE + '#/' + route);
      await page.waitForTimeout(420);
      if (s.safe) await page.addStyleTag({ content: SAFE });
      if (route === 'pots') { await page.click('.pot .pot-open'); await page.waitForTimeout(420); }
      if (route === 'ledger') { await page.click('.acct-open-btn'); await page.waitForTimeout(420); }
      await page.waitForTimeout(250);
      problems.push(...await audit(page, `${s.name} ${chapter}`));
      problems.push(...await bottomCheck(page, `${s.name} ${chapter}`));
    }
    // And a sheet, which is where forms get cramped.
    await page.goto(BASE + '#/pots');
    await page.waitForSelector('.pot');
    if (s.safe) await page.addStyleTag({ content: SAFE });
    await page.click('.chapter-actions [data-action=new-plan]');
    await page.waitForSelector('dialog#sheet[open]');
    await page.waitForTimeout(500);
    problems.push(...await audit(page, `${s.name} new-pot sheet`));
    await ctx.close();
  }
  const unique = [...new Set(problems)];
  console.log(`\n${unique.length} PROBLEMS\n`);
  for (const p of unique) console.log(' •', p);
  await browser.close();
})();
