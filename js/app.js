import { html, mount, $ } from './ui/html.js';
import { toast } from './ui/overlay.js';
import { resetCharts, hydrateCharts } from './ui/charts.js';
import { watchPosture } from './ui/posture.js';
import { txsInMonth, totals } from './core/stats.js';
import { state, init, subscribe, checkDayChange, reload, moveCategory, handleReminder, saveRule, describeError } from './store.js';
import { ui, viewMonth } from './views/components.js';
import { openTransactionForm } from './views/txForm.js';
import { openCategoryForm, openBudgetForm, openAccountForm, openRuleForm, openGoalForm, openGoalAdjust } from './views/forms.js';
import { renderHome, shiftMonth } from './views/home.js';
import { renderActivity, afterActivityMount, resetFilters, showMore } from './views/activity.js';
import { renderBudgets } from './views/budgets.js';
import { renderMore, renderRecurring, renderCategories, renderAccounts, renderGoals, renderReview, reviewState, MORE_LINKS } from './views/pages.js';
import { renderSettings, afterSettingsMount, exportJSON, exportCSV, startImportCSV, startRestore } from './views/settings.js';
import { money, netMoney, month as monthLabel } from './ui/format.js';

const I = (d) => html`<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const NAV_ICONS = {
  home: I(html`<path d="M4 11l8-6 8 6v8a1 1 0 01-1 1h-4v-5h-6v5H5a1 1 0 01-1-1z"/>`),
  activity: I(html`<path d="M5 6h14M5 12h14M5 18h9"/>`),
  budgets: I(html`<path d="M4 18V9M10 18V5M16 18v-7M20 18H3"/>`),
  recurring: I(html`<path d="M17 3l3 3-3 3M4 11V9a3 3 0 013-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 01-3 3H4"/>`),
  categories: I(html`<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>`),
  accounts: I(html`<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>`),
  goals: I(html`<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".6" fill="currentColor"/>`),
  review: I(html`<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>`),
  settings: I(html`<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>`),
  more: I(html`<circle cx="6" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18" cy="12" r="1.3" fill="currentColor"/>`),
  plus: html`<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`,
};

// Four strokes and the fifth struck through them: the app's own mark, inline
// so each stroke can draw itself.
const BRAND_MARK = html`<svg class="brand-mark" viewBox="0 0 28 28" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
  <path d="M8 8v12"/><path d="M12 8v12"/><path d="M16 8v12"/><path d="M20 8v12"/><path d="M6 18l16-8"/>
</svg>`;

const ROUTES = {
  home: { title: 'Home', render: renderHome },
  activity: { title: 'Activity', render: renderActivity, after: afterActivityMount },
  budgets: { title: 'Budgets', render: renderBudgets },
  recurring: { title: 'Repeating', render: renderRecurring },
  categories: { title: 'Categories', render: renderCategories },
  accounts: { title: 'Accounts', render: renderAccounts },
  goals: { title: 'Savings goals', render: renderGoals },
  review: { title: 'Year in review', render: renderReview },
  settings: { title: 'Settings', render: renderSettings, after: afterSettingsMount },
  more: { title: 'More', render: renderMore },
};
const SECONDARY = new Set(MORE_LINKS.map((l) => l.route).concat('more'));
const SIDEBAR = [
  ['home', 'Home'], ['activity', 'Activity'], ['budgets', 'Budgets'],
  null,
  ['recurring', 'Repeating'], ['goals', 'Savings goals'], ['accounts', 'Accounts'], ['review', 'Year in review'],
  null,
  ['categories', 'Categories'], ['settings', 'Settings'],
];

function currentRoute() {
  const name = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] || 'home';
  return ROUTES[name] ? name : 'home';
}

// ---------- Shell ----------

function renderShell() {
  const app = $('#app');
  mount(
    app,
    html`<a class="skip" href="#main">Skip to content</a>
    <aside class="sidebar" aria-label="Main">
      <div class="brand">${BRAND_MARK}<span class="brand-name">Tally</span></div>
      <button type="button" class="btn primary rail-cta" data-action="new-tx" title="New transaction (N)">${NAV_ICONS.plus}<span class="rail-label">New transaction</span></button>
      <nav>
        <ul class="plain-list side-nav">
          ${SIDEBAR.map((item) =>
            item
              ? html`<li><a href="#/${item[0] === 'home' ? '' : item[0]}" data-route="${item[0]}">${NAV_ICONS[item[0]]}<span>${item[1]}</span></a></li>`
              : html`<li class="sep" role="presentation"></li>`
          )}
        </ul>
      </nav>
      <p class="side-foot" data-side-foot></p>
    </aside>
    <div class="banner-slot" data-banner></div>
    <main id="main" tabindex="-1"></main>
    <aside class="companion" data-companion aria-label="This month at a glance"></aside>
    <nav class="tabbar" aria-label="Main">
      <a href="#/" data-route="home">${NAV_ICONS.home}<span>Home</span></a>
      <a href="#/activity" data-route="activity">${NAV_ICONS.activity}<span>Activity</span></a>
      <button type="button" class="fab" data-action="new-tx" aria-label="New transaction">${NAV_ICONS.plus}</button>
      <a href="#/budgets" data-route="budgets">${NAV_ICONS.budgets}<span>Budgets</span></a>
      <a href="#/more" data-route="more">${NAV_ICONS.more}<span>More</span></a>
    </nav>
    <div id="toasts" class="toasts" aria-live="polite"></div>`
  );
}

// The facing page in book posture: the right half of the spread shows where
// the month stands, so half-folding gains a second page instead of just
// making the first one narrower. Hidden by CSS in every other posture, so
// there's no point building it then.
function renderCompanion() {
  const el = $('[data-companion]');
  if (!el || document.documentElement.dataset.posture !== 'book') return;
  const key = viewMonth();
  const t = totals(txsInMonth(state.transactions, key));
  mount(
    el,
    html`<p class="companion-label">${monthLabel(key)}</p>
      ${state.transactions.length
        ? html`<dl class="companion-figures">
            <div><dt>Coming in</dt><dd class="amt amt-in">${money(t.income)}</dd></div>
            <div><dt>Going out</dt><dd class="amt">${money(t.expenses)}</dd></div>
            <div><dt>Net</dt><dd>${netMoney(t.net)}</dd></div>
          </dl>
          <p class="companion-count">${t.count === 1 ? '1 transaction' : `${t.count} transactions`} this month</p>`
        : html`<p class="companion-empty">Add your first transaction and this page keeps the running total.</p>`}`
  );
}

function updateChrome(route) {
  for (const a of document.querySelectorAll('[data-route]')) {
    const r = a.dataset.route;
    const active = r === route || (r === 'more' && SECONDARY.has(route));
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.title = route === 'home' ? 'Tally' : `${ROUTES[route].title} – Tally`;

  const banner = $('[data-banner]');
  if (banner) {
    mount(
      banner,
      state.storageKind === 'memory'
        ? html`<div class="banner warn" role="alert">This browser isn’t letting Tally save data, possibly because of private browsing. Anything you add will be gone when you close this tab. <button type="button" class="link-btn" data-action="export-json">Download a backup</button></div>`
        : ''
    );
  }
  renderCompanion();
  const foot = $('[data-side-foot]');
  if (foot) {
    const { lastExportAt } = state.settings;
    foot.textContent = state.transactions.length
      ? lastExportAt
        ? `Last backup ${new Date(lastExportAt).toLocaleDateString(state.settings.locale, { month: 'short', day: 'numeric' })}`
        : 'Not backed up yet'
      : '';
  }
}

let lastRoute = null;
let enterTimer;
function render({ keepScroll = false } = {}) {
  if (!state.ready) return;
  const route = currentRoute();
  const main = $('#main');
  const active = document.activeElement;
  const focusId = main.contains(active) && active.id ? active.id : null;
  const selection = focusId && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  const scroll = window.scrollY;

  resetCharts();
  const view = ROUTES[route];
  mount(main, view.render());
  view.after?.(main);
  hydrateCharts(main);
  updateChrome(route);

  if (route !== lastRoute) {
    lastRoute = route;
    if (!keepScroll) window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
    // Play the entrance only when the screen actually changes, so saving a
    // transaction doesn't replay the whole page.
    main.dataset.enter = '1';
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => delete main.dataset.enter, 700);
  } else {
    window.scrollTo(0, scroll);
    if (focusId) {
      const el = document.getElementById(focusId);
      el?.focus({ preventScroll: true });
      if (selection && el?.setSelectionRange) {
        try {
          el.setSelectionRange(...selection);
        } catch {
          // some input types don't support selection
        }
      }
    }
  }
}

// ---------- Theme ----------

const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const pref = state.settings.theme;
  const dark = pref === 'dark' || (pref === 'system' && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0B0B0A' : '#E8E8E3');
  try {
    localStorage.setItem('tally:theme', pref);
  } catch {
    // theme still applies for this session
  }
}
darkQuery.addEventListener?.('change', applyTheme);

// ---------- Actions ----------

const fail = (err) => toast(describeError(err), { tone: 'error' });

const actions = {
  'new-tx': (el) => openTransactionForm({ preset: el.dataset.type ? { type: el.dataset.type } : {} }),
  'edit-tx': (el) => openTransactionForm({ id: el.dataset.id }),
  'month-shift': (el) => {
    shiftMonth(Number(el.dataset.step));
    render({ keepScroll: true });
  },
  'month-today': () => {
    ui.month = null;
    render({ keepScroll: true });
  },
  'year-shift': (el) => {
    const thisYear = Number(state.today.slice(0, 4));
    const cur = reviewState.year ?? thisYear;
    reviewState.year = Math.min(thisYear, cur + Number(el.dataset.step));
    render({ keepScroll: true });
  },
  'clear-filters': () => {
    resetFilters();
    render({ keepScroll: true });
  },
  'show-more': () => showMore(),
  'edit-budget': (el) => openBudgetForm(el.dataset.id),
  'new-category': (el) => openCategoryForm({ preset: { type: el.dataset.type ?? 'expense', parentId: el.dataset.parent ?? '' } }),
  'edit-category': (el) => openCategoryForm({ id: el.dataset.id }),
  'move-category': (el) => moveCategory(el.dataset.id, Number(el.dataset.step)).catch(fail),
  'new-account': () => openAccountForm(),
  'edit-account': (el) => openAccountForm(el.dataset.id),
  'new-rule': () => openRuleForm(),
  'edit-rule': (el) => openRuleForm(el.dataset.id),
  'new-goal': () => openGoalForm(),
  'edit-goal': (el) => openGoalForm(el.dataset.id),
  'adjust-goal': (el) => openGoalAdjust(el.dataset.id),
  'export-json': () => exportJSON(),
  'export-csv': () => exportCSV(),
  'import-csv': () => startImportCSV(),
  'restore-json': () => startRestore(),
  reminder: async (el) => {
    const { rule: ruleId, date, do: what } = el.dataset;
    const rule = state.recurring.find((r) => r.id === ruleId);
    if (!rule) return;
    const before = rule.generatedThrough;
    el.disabled = true;
    try {
      const tx = await handleReminder(ruleId, date, what);
      if (what === 'log') {
        toast(`Logged ${rule.note || 'it'} for ${money(rule.amount)}`, tx ? { action: { label: 'Change amount', onClick: () => openTransactionForm({ id: tx.id }) } } : {});
      } else {
        toast(`Skipped ${rule.note || 'it'} this time`, {
          action: { label: 'Undo', onClick: () => saveRule({ generatedThrough: before }, ruleId).catch(fail) },
        });
      }
    } catch (err) {
      el.disabled = false;
      fail(err);
    }
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  fn(el, e);
});

// ---------- Keyboard shortcuts ----------

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  if (document.querySelector('dialog[open]')) return;
  const route = currentRoute();
  const go = (hash) => {
    location.hash = hash;
  };
  switch (e.key) {
    case 'n':
    case 'N':
      openTransactionForm();
      break;
    case 'i':
    case 'I':
      openTransactionForm({ preset: { type: 'income' } });
      break;
    case '/':
      if (route !== 'activity') go('#/activity');
      requestAnimationFrame(() => document.getElementById('activity-search')?.focus());
      break;
    case '1':
      go('#/');
      break;
    case '2':
      go('#/activity');
      break;
    case '3':
      go('#/budgets');
      break;
    case '4':
      go('#/recurring');
      break;
    case '[':
    case ']':
      if (route === 'home' || route === 'budgets') {
        shiftMonth(e.key === '[' ? -1 : 1);
        render({ keepScroll: true });
      } else if (route === 'review') {
        actions['year-shift']({ dataset: { step: e.key === '[' ? '-1' : '1' } });
      } else return;
      break;
    default:
      return;
  }
  e.preventDefault();
});

// ---------- Boot ----------

async function boot() {
  renderShell();
  try {
    await init();
  } catch (err) {
    console.error(err);
    mount(
      $('#main'),
      html`<div class="empty"><h2>Tally couldn’t open its storage</h2>
        <p>Try reloading the page. If this keeps happening, check that the browser allows site data for this page.</p>
        <button type="button" class="btn primary" onclick="location.reload()">Reload</button></div>`
    );
    return;
  }
  applyTheme();
  subscribe((reason) => {
    if (reason === 'blocked') {
      toast('Tally was updated in another tab. Reload to keep going.', { duration: 60000, action: { label: 'Reload', onClick: () => location.reload() } });
      return;
    }
    if (reason === 'settings' || reason === 'init' || reason === 'reload') applyTheme();
    render({ keepScroll: true });
  });
  render();
  document.documentElement.classList.add('ready');

  // Home screen shortcut: #/?add=1 opens the add form straight away.
  if (/[?&]add=1/.test(location.hash)) {
    history.replaceState(null, '', location.pathname + location.search + '#/');
    openTransactionForm();
  }

  window.addEventListener('hashchange', () => render());

  // Folding or unfolding changes how much room each half has: redraw the
  // charts at the new width and fill in the facing page.
  watchPosture(() => {
    renderCompanion();
    hydrateCharts(document);
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => hydrateCharts(document), 120);
  });
  const wake = () => {
    if (document.visibilityState !== 'visible') return;
    checkDayChange().catch(() => {});
  };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('focus', wake);
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) reload().catch(() => {});
  });
  setInterval(wake, 60000);

  registerServiceWorker();
  renderDebugOverlay();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:' || globalThis.TALLY_SINGLE_FILE) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloading) {
      reloading = true;
      location.reload();
    }
  });
  const offerUpdate = (worker) => {
    toast('A new version of Tally is ready.', {
      duration: 30000,
      action: { label: 'Update', onClick: () => worker.postMessage('skipWaiting') },
    });
  };
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    if (reg.waiting && hadController) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && hadController) offerUpdate(worker);
      });
    });
  }).catch(() => {
    // Offline support is a bonus; the app works without it.
  });
}

// ---------- Debug overlay (?debug) ----------
// A temporary on-device readout for measuring real viewport sizes, used to
// tune breakpoints for the Pixel Fold's cover and inner screens. Not linked
// from the UI; append ?debug to the URL to see it.

function renderDebugOverlay() {
  if (!/[?&]debug\b/.test(location.search)) return;
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  Object.assign(box.style, {
    position: 'fixed', zIndex: '9999', top: '0', insetInlineStart: '0',
    padding: '6px 8px', font: '11px/1.5 ui-monospace, monospace',
    background: 'rgba(0,0,0,0.75)', color: '#fff', whiteSpace: 'pre',
    pointerEvents: 'none',
  });
  document.body.appendChild(box);
  const update = () => {
    const segs = window.viewport?.segments;
    const lines = [
      `${window.innerWidth} × ${window.innerHeight} css px`,
      `dpr ${window.devicePixelRatio}`,
      `coarse pointer: ${matchMedia('(pointer: coarse)').matches}`,
      segs && segs.length > 1
        ? `segments: ${segs.map((s) => `${Math.round(s.width)}×${Math.round(s.height)} @${Math.round(s.left)},${Math.round(s.top)}`).join('  |  ')}`
        : 'segments: 1 (flat or unsupported)',
    ];
    box.textContent = lines.join('\n');
  };
  update();
  window.addEventListener('resize', update);
  window.viewport?.addEventListener?.('segmentschange', update);
}

// Keep the tab from closing while a save is still in flight.
window.addEventListener('beforeunload', (e) => {
  if (document.querySelector('.sheet-foot button:disabled')) {
    e.preventDefault();
    e.returnValue = '';
  }
});

boot();
