import { html, mount, $ } from './ui/html.js';
import { toast } from './ui/overlay.js';
import { resetCharts, hydrateCharts } from './ui/charts.js';
import { watchPosture } from './ui/posture.js';
import { sortTransactions } from './core/stats.js';
import { monthKey, addDays } from './core/dates.js';
import { isFinished, nextDue } from './core/recurring.js';
import { planOrder, planProgress, allocate, monthlySurplus, PLAN_KINDS, planKind } from './core/plans.js';
import { advisorReview } from './core/advisor.js';
import { isUnlocked, lock as lockVault, onVaultChange, open as openSealed, describeVaultError } from './vault.js';
import { state, init, subscribe, checkDayChange, reload, moveCategory, handleReminder, saveRule, saveAccount, describeError } from './store.js';
import { ui, viewMonth } from './views/components.js';
import { openTransactionForm } from './views/txForm.js';
import { openCategoryForm, openBudgetForm, openAccountForm, openRuleForm, openGoalForm, openGoalAdjust, passphraseDialog } from './views/forms.js';
import { renderHome, shiftMonth } from './views/home.js';
import { renderActivity, afterActivityMount, resetFilters, showMore } from './views/activity.js';
import { renderBudgets } from './views/budgets.js';
import { renderMore, renderRecurring, renderCategories, renderAccounts, renderGoals, afterPlansMount, resetPlanScenario, renderReview, reviewState, MORE_LINKS, planDetail, accountDetail, vaultFieldsMarkup } from './views/pages.js';
import { renderAdvisor, afterAdvisorMount } from './views/advisor.js';
import { renderSettings, afterSettingsMount, exportJSON, exportCSV, startImportCSV, startRestore } from './views/settings.js';
import { money, month as monthLabel, badge, relativeDay, date as dayLabel } from './ui/format.js';

const I = (d) => html`<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const NAV_ICONS = {
  home: I(html`<path d="M4 11l8-6 8 6v8a1 1 0 01-1 1h-4v-5h-6v5H5a1 1 0 01-1-1z"/>`),
  activity: I(html`<path d="M5 6h14M5 12h14M5 18h9"/>`),
  budgets: I(html`<path d="M4 18V9M10 18V5M16 18v-7M20 18H3"/>`),
  recurring: I(html`<path d="M17 3l3 3-3 3M4 11V9a3 3 0 013-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 01-3 3H4"/>`),
  categories: I(html`<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>`),
  accounts: I(html`<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>`),
  goals: I(html`<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".6" fill="currentColor"/>`),
  vault: I(html`<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M12 5v2M12 17v2"/>`),
  review: I(html`<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>`),
  settings: I(html`<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>`),
  more: I(html`<circle cx="6" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18" cy="12" r="1.3" fill="currentColor"/>`),
  advisor: I(html`<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>`),
  plus: html`<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>`,
};

// Four strokes and the fifth struck through them: the app's own mark, inline
// so each stroke can draw itself.
const BRAND_MARK = html`<svg class="brand-mark" viewBox="0 0 28 28" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
  <path d="M8 8v12"/><path d="M12 8v12"/><path d="M16 8v12"/><path d="M20 8v12"/><path d="M6 18l16-8"/>
</svg>`;

const ROUTES = {
  home: { title: 'Home', render: renderHome },
  advisor: { title: 'Advisor', render: renderAdvisor, after: afterAdvisorMount },
  activity: { title: 'Activity', render: renderActivity, after: afterActivityMount },
  budgets: { title: 'Budgets', render: renderBudgets },
  recurring: { title: 'Repeating', render: renderRecurring },
  categories: { title: 'Categories', render: renderCategories },
  accounts: { title: 'Accounts', render: renderAccounts, after: afterAccountsMount },
  goals: { title: 'Plans', render: renderGoals, after: afterPlansMount },
  review: { title: 'Year in review', render: renderReview },
  settings: { title: 'Settings', render: renderSettings, after: afterSettingsMount },
  more: { title: 'More', render: renderMore },
};
const SECONDARY = new Set(MORE_LINKS.map((l) => l.route).concat('more'));
const SIDEBAR = [
  ['home', 'Home'], ['goals', 'Plans'], ['advisor', 'Advisor'], ['accounts', 'Accounts'],
  null,
  ['activity', 'Activity'], ['budgets', 'Budgets'], ['recurring', 'Repeating'], ['review', 'Review'],
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
    <header class="topbar" data-topbar>
      <span class="topbar-title" data-topbar-title></span>
      <nav class="tabbar" aria-label="Main">
        <a href="#/" data-route="home">${NAV_ICONS.home}<span>Home</span></a>
        <a href="#/goals" data-route="goals">${NAV_ICONS.goals}<span>Plans</span></a>
        <button type="button" class="fab" data-action="new-tx" aria-label="New transaction">${NAV_ICONS.plus}</button>
        <a href="#/advisor" data-route="advisor">${NAV_ICONS.advisor}<span>Advisor</span></a>
        <a href="#/more" data-route="more">${NAV_ICONS.more}<span>More</span></a>
      </nav>
      <span class="topbar-side"><button type="button" class="icon-btn topbar-add" data-action="new-tx" aria-label="New transaction" title="New transaction (N)">${NAV_ICONS.plus}</button></span>
    </header>
    <main id="main" tabindex="-1"></main>
    <aside class="companion" data-companion aria-label="Quick actions and what's next"></aside>
    <div id="toasts" class="toasts" aria-live="polite"></div>`
  );
}

// The second page. On the Fold half-folded into book posture it *is* the
// right-hand leaf; on a wide laptop window it's a third column. CSS decides
// when there's room for it.
//
// What it carries follows the screen you are on, which is the whole point of
// having two pages: a list on one leaf and the thing you picked on the
// other. Plans puts the chosen plan here, Accounts the chosen account and
// its sealed details, and everywhere else it is the quick-log pane. It never
// repeats a figure the main column is already showing.
function renderCompanion() {
  const el = $('[data-companion]');
  if (!el) return;
  const route = currentRoute();
  el.dataset.pane = route === 'goals' || route === 'accounts' ? 'detail' : 'actions';

  if (route === 'goals') {
    const plan = ui.selectedPlan ? state.goals.find((g) => g.id === ui.selectedPlan) : null;
    mount(el, plan
      ? planDetail(plan)
      : html`<p class="companion-label">Plans</p>
          <p class="companion-empty">${state.goals.length ? 'Choose a plan to see what it costs a month, when it lands, and where it’s kept.' : 'Add a plan and it opens here.'}</p>`);
    return;
  }

  if (route === 'accounts') {
    const account = ui.selectedAccount ? state.accounts.find((a) => a.id === ui.selectedAccount) : null;
    mount(el, account
      ? accountDetail(account)
      : html`<p class="companion-label">Accounts</p>
          <p class="companion-empty">${state.accounts.length ? 'Choose an account to see its rate, its security and its sealed details.' : 'Add an account and it opens here.'}</p>`);
    if (account) fillVaultFields(el);
    return;
  }

  const key = viewMonth();
  const catOf = (id) => state.categories.find((c) => c.id === id) ?? null;
  const surplus = monthlySurplus(state.transactions, state.today);
  const typical = Math.max(0, surplus.typical);
  const shares = allocate(planOrder(state.goals), typical);

  // The plan with the nearest date, and what it costs a month to make it.
  const nextPlan = planOrder(state.goals).find((g) => planProgress(g, state.transactions, state.today).toSave > 0) ?? null;
  const nextProgress = nextPlan ? planProgress(nextPlan, state.transactions, state.today) : null;

  const upcoming = state.recurring
    .filter((r) => !isFinished(r, state.today))
    .map((r) => ({ rule: r, date: nextDue(r) }))
    .filter((x) => x.date)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(0, 3);

  const todayTx = key === monthKey(state.today) ? state.transactions.filter((tx) => tx.date === state.today) : [];
  const todaySpent = todayTx.reduce((sum, tx) => sum + (tx.type === 'expense' && !tx.refund ? tx.amount : 0), 0);

  const week = [];
  for (let i = 6; i >= 0; i--) {
    const iso = addDays(state.today, -i);
    const spent = state.transactions.reduce((sum, tx) => sum + (tx.date === iso && tx.type === 'expense' && !tx.refund ? tx.amount : 0), 0);
    week.push({ iso, spent, today: i === 0 });
  }
  const weekPeak = Math.max(...week.map((d) => d.spent), 1);
  const weekTotal = week.reduce((s, d) => s + d.spent, 0);

  const again = [];
  const seen = new Set();
  for (const tx of sortTransactions(state.transactions)) {
    if (tx.type !== 'expense' || seen.has(tx.categoryId)) continue;
    const cat = catOf(tx.categoryId);
    if (!cat) continue;
    seen.add(tx.categoryId);
    again.push(cat);
    if (again.length === 4) break;
  }

  mount(
    el,
    html`<p class="companion-label">${monthLabel(key)}</p>
      ${state.transactions.length || state.goals.length
        ? html`<div class="companion-block">
              <h2>Log it now</h2>
              <button type="button" class="btn primary companion-new" data-action="new-tx">${NAV_ICONS.plus}New transaction</button>
              ${again.length
                ? html`<div class="companion-again">
                    ${again.map(
                      (cat) =>
                        html`<button type="button" class="btn companion-again-btn" data-action="log-again" data-cat="${cat.id}">${badge(cat, 'sm')}<span>${cat.name}</span></button>`
                    )}
                  </div>`
                : ''}
            </div>
            ${state.goals.length
              ? html`<div class="companion-block">
                  <h2>Set aside</h2>
                  <div class="companion-again">
                    ${planOrder(state.goals).slice(0, 3).map((g) => html`<button type="button" class="btn companion-again-btn" data-action="adjust-goal" data-id="${g.id}">
                      <i class="key" style="background:${g.color}"></i><span>${g.name}</span>${(shares.byPlan.get(g.id) ?? 0) > 0 ? html`<small class="amt">${money(shares.byPlan.get(g.id))}</small>` : ''}
                    </button>`)}
                  </div>
                </div>`
              : ''}
            ${key === monthKey(state.today)
              ? html`<div class="companion-block">
                  <h2>Today</h2>
                  <p class="companion-today">${todaySpent > 0 ? money(todaySpent) : 'Nothing yet'}</p>
                  <p class="companion-today-sub">${todayTx.length ? `${todayTx.length === 1 ? '1 entry' : `${todayTx.length} entries`} logged today` : 'Nothing logged today'}</p>
                  <div class="companion-week" role="img" aria-label="Spending each day for the last seven days: ${week.map((d) => `${dayLabel(d.iso, { weekday: 'short' })} ${money(d.spent)}`).join(', ')}">
                    ${week.map(
                      (d) => html`<span class="cw-day${d.today ? ' cw-today' : ''}" title="${dayLabel(d.iso, { weekday: 'short', month: 'short', day: 'numeric' })}: ${money(d.spent)}">
                        <i class="cw-bar" style="--h:${d.spent > 0 ? Math.max(12, Math.round((d.spent / weekPeak) * 100)) : 0}%"></i>
                        <small>${dayLabel(d.iso, { weekday: 'narrow' })}</small>
                      </span>`
                    )}
                  </div>
                  <p class="companion-today-sub">${money(weekTotal)} over the last 7 days</p>
                </div>`
              : ''}
            ${upcoming.length
              ? html`<div class="companion-block">
                  <h2>Coming up</h2>
                  <ul class="plain-list companion-next">
                    ${upcoming.map(({ rule, date }) => {
                      const cat = catOf(rule.categoryId);
                      return html`<li>
                        ${cat ? badge(cat, 'sm') : ''}
                        <span class="companion-next-main">
                          <span class="companion-next-name">${rule.note || (cat ? cat.name : 'Repeating')}</span>
                          <small>${relativeDay(date)}</small>
                        </span>
                        <span class="amt ${rule.type === 'income' ? 'amt-in' : ''}">${money(rule.type === 'income' ? rule.amount : -rule.amount, { sign: rule.type === 'income' })}</span>
                      </li>`;
                    })}
                  </ul>
                </div>`
              : ''}
            ${nextPlan
              ? html`<div class="companion-block">
                  <h2>Next plan</h2>
                  <a class="companion-plan" href="#/goals">
                    <span class="companion-plan-name">${nextPlan.name}</span>
                    <span class="amt">${money(nextProgress.toSave)} to go</span>
                    ${nextProgress.perMonth ? html`<small>${money(nextProgress.perMonth)} a month to make ${monthLabel(nextPlan.targetDate.slice(0, 7))}</small>` : ''}
                  </a>
                </div>`
              : ''}`
        : html`<p class="companion-empty">Add your first plan and this page keeps what's next within reach.</p>`}`
  );
}

// Sealed details are opened after the markup is on screen: decryption is
// asynchronous, and a locked vault simply leaves the slot as it was.
async function fillVaultFields(root = document) {
  if (!isUnlocked()) return;
  for (const slot of root.querySelectorAll('[data-vault-fields]')) {
    const account = state.accounts.find((a) => a.id === slot.dataset.vaultFields);
    if (!account?.vault) continue;
    try {
      mount(slot, vaultFieldsMarkup(await openSealed(account.vault)));
    } catch (err) {
      mount(slot, html`<p class="field-error">Couldn’t open these. ${describeVaultError(err) ?? ''}</p>`);
    }
  }
}

function afterAccountsMount(root) {
  fillVaultFields(root);
}

function updateChrome(route) {
  for (const a of document.querySelectorAll('[data-route]')) {
    const r = a.dataset.route;
    const active = r === route || (r === 'more' && SECONDARY.has(route));
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.title = route === 'home' ? 'Tally' : `${ROUTES[route].title} – Tally`;
  watchPageTitle(ROUTES[route].title);

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

// The large page title hands over to the compact one in the title bar as it
// scrolls out of reach — the page's own heading stays the real one, and the
// bar only takes over once that heading has gone. An observer on the heading
// does this without listening to scroll, so it costs nothing while idle.
let titleObserver;

function watchPageTitle(fallback) {
  const bar = $('[data-topbar]');
  if (!bar) return;
  titleObserver?.disconnect();
  const heading = $('#main h1');
  // The bar repeats the screen's own heading, so on Home it carries the
  // month rather than the word "Home" — the same thing you just scrolled
  // past, which is what makes the handover read as one title moving.
  $('[data-topbar-title]').textContent = heading?.textContent.trim() || fallback;
  if (!heading) {
    bar.dataset.scrolled = '1';
    return;
  }
  delete bar.dataset.scrolled;
  // Measured, not assumed, because the bar's height changes with the safe
  // area and the breakpoint. Clamped at zero: while a sheet is up the page
  // is transformed, which reparents the fixed bar and can put its bottom
  // above the viewport — and a negative rootMargin is a syntax error.
  const edge = Math.max(0, Math.round(bar.getBoundingClientRect().bottom)) || 52;
  titleObserver = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) delete bar.dataset.scrolled;
      else bar.dataset.scrolled = '1';
    },
    { rootMargin: `-${edge}px 0px 0px 0px`, threshold: 0 }
  );
  titleObserver.observe(heading);
}

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const ROUTE_ORDER = ['home', 'goals', 'advisor', 'accounts', 'activity', 'budgets', 'recurring', 'review', 'categories', 'settings', 'more'];

let lastRoute = null;
let enterTimer;

function render({ keepScroll = false } = {}) {
  if (!state.ready) return;
  const route = currentRoute();
  const changing = route !== lastRoute;
  const paint = () => paintRoute(route, { keepScroll, changing, staggered: true });

  // Where the browser can cross-fade between screens, let it: the whole
  // content area slides across in one piece, which reads better than every
  // block animating separately. Everywhere else, fall back to the stagger.
  if (changing && lastRoute && !reduceMotion.matches && document.startViewTransition) {
    const from = ROUTE_ORDER.indexOf(lastRoute);
    const to = ROUTE_ORDER.indexOf(route);
    document.documentElement.dataset.nav = to < from ? 'back' : 'forward';
    const t = document.startViewTransition(() => paintRoute(route, { keepScroll, changing, staggered: false }));
    // Both promises have to be claimed. Starting a second transition before
    // the first has settled — two quick taps, or a resize mid-navigation —
    // rejects `ready`, and an unclaimed rejection surfaces as a page error.
    t.ready.catch(() => {});
    t.finished.catch(() => {}).finally(() => delete document.documentElement.dataset.nav);
    return;
  }
  paint();
}

function paintRoute(route, { keepScroll, changing, staggered }) {
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

  if (changing) {
    lastRoute = route;
    if (!keepScroll) window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
    // Play the entrance only when the screen actually changes, so saving a
    // transaction doesn't replay the whole page.
    if (staggered) {
      main.dataset.enter = '1';
      clearTimeout(enterTimer);
      enterTimer = setTimeout(() => delete main.dataset.enter, 900);
    }
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
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#F2F2F7');
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
  'log-again': (el) => openTransactionForm({ preset: { type: 'expense', categoryId: el.dataset.cat } }),
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
  'plan-use-surplus': () => {
    resetPlanScenario();
    render({ keepScroll: true });
  },
  'new-goal': (el) => openGoalForm(null, el.dataset.kind ? { kind: el.dataset.kind } : {}),
  'edit-goal': (el) => openGoalForm(el.dataset.id),
  'adjust-goal': (el) => openGoalAdjust(el.dataset.id),
  // Picking something on one leaf fills the other. On a screen with no
  // second page the same tap opens it inline, and tapping it again closes
  // it — so the gesture means the same thing at every size.
  'select-plan': (el) => {
    ui.selectedPlan = ui.selectedPlan === el.dataset.id ? null : el.dataset.id;
    render({ keepScroll: true });
  },
  'select-account': (el) => {
    ui.selectedAccount = ui.selectedAccount === el.dataset.id ? null : el.dataset.id;
    render({ keepScroll: true });
  },
  'vault-create': async () => {
    if (await passphraseDialog({ mode: 'create' })) toast('Vault sealed. It opens with your passphrase.');
  },
  'vault-unlock': async () => {
    if (await passphraseDialog({ mode: 'unlock' })) toast('Vault open');
  },
  'vault-change': async () => {
    if (await passphraseDialog({ mode: 'change' })) toast('Passphrase changed');
  },
  'vault-lock': () => {
    lockVault();
    toast('Vault locked');
  },
  'mark-reviewed': async (el) => {
    try {
      await saveAccount({ reviewedAt: state.today }, el.dataset.id);
      toast('Marked reviewed today');
    } catch (err) {
      fail(err);
    }
  },
  // A secret shows itself where it was hidden, and hides again after a
  // while: long enough to read a number off the screen, short enough that
  // it isn't still there when the phone is handed to someone.
  'reveal-secret': (el) => {
    const field = el.closest('dd');
    const secret = field?.querySelector('.secret');
    if (!secret) return;
    const showing = secret.dataset.showing === '1';
    secret.textContent = showing ? secret.dataset.masked : secret.dataset.secret;
    secret.dataset.showing = showing ? '0' : '1';
    el.textContent = showing ? 'Show' : 'Hide';
    clearTimeout(secret._hide);
    if (!showing) {
      secret._hide = setTimeout(() => {
        secret.textContent = secret.dataset.masked;
        secret.dataset.showing = '0';
        el.textContent = 'Show';
      }, 20000);
    }
  },
  'copy-secret': async (el) => {
    const secret = el.closest('dd')?.querySelector('.secret');
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.dataset.secret);
      toast('Copied. The clipboard clears in 30 seconds.');
      setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 30000);
    } catch {
      toast('This browser wouldn’t let Tally use the clipboard.', { tone: 'error' });
    }
  },
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
      go('#/goals');
      break;
    case '3':
      go('#/advisor');
      break;
    case '4':
      go('#/accounts');
      break;
    case '5':
      go('#/activity');
      break;
    case 'l':
    case 'L':
      lockVault();
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
  // Opening or locking the vault changes what is on screen, and the lock can
  // happen on a timer or when the app is backgrounded — so it redraws.
  onVaultChange(() => render({ keepScroll: true }));
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
