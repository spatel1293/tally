import { html, mount, $ } from '../ui/html.js';
import { state } from '../store.js';
import { accountBalances, yearReview, yearsWithData, sortTransactions } from '../core/stats.js';
import { planProgress, monthlySurplus, projectPlans, requiredMonthly, planTransactions, PLAN_KINDS } from '../core/plans.js';
import { FREQUENCIES, nextDue, monthlyEquivalent, isFinished } from '../core/recurring.js';
import { ACCOUNT_KINDS } from '../core/defaults.js';
import { formatMonth } from '../core/dates.js';
import { centsToInput, parseAmount } from '../core/money.js';
import { money, badge, categoryById, date, plural, percent, timeAgo, month, relativeDay } from '../ui/format.js';
import { progressBar, barChart } from '../ui/charts.js';
import { pageHead, emptyState, icons } from './components.js';
import { remindersBlock } from './home.js';

// ---------- More (phone menu) ----------

export const MORE_LINKS = [
  { route: 'recurring', label: 'Repeating', desc: 'Rent, salary, subscriptions' },
  { route: 'categories', label: 'Categories', desc: 'Names, colors, icons and order' },
  { route: 'accounts', label: 'Accounts', desc: 'Checking, cards, cash and balances' },
  { route: 'goals', label: 'Plans', desc: 'Nest eggs, trips and what-ifs' },
  { route: 'review', label: 'Year in review', desc: 'How the year added up' },
  { route: 'settings', label: 'Settings and backup', desc: 'Currency, theme, export and import' },
];

export function renderMore() {
  const { lastExportAt } = state.settings;
  return html`${pageHead('More')}
    <ul class="plain-list menu">
      ${MORE_LINKS.map((l) => html`<li><a class="menu-item" href="#/${l.route}">
        <span><strong>${l.label}</strong><small>${l.route === 'settings' ? `Last backup: ${timeAgo(lastExportAt)}` : l.desc}</small></span>
        ${icons.chevron}
      </a></li>`)}
    </ul>`;
}

// ---------- Recurring ----------

export function renderRecurring() {
  const rules = state.recurring.slice().sort((a, b) => {
    const na = a.paused ? '9' : nextDue(a) ?? '9';
    const nb = b.paused ? '9' : nextDue(b) ?? '9';
    return na < nb ? -1 : na > nb ? 1 : a.note.localeCompare(b.note);
  });
  const head = pageHead('Repeating', html`<button type="button" class="btn primary" data-action="new-rule">${icons.plus}Add</button>`);
  if (!rules.length) {
    return html`${head}${emptyState({
      title: 'Set it up once',
      body: 'Add rent, salary or subscriptions with how often they happen. Tally can add them on schedule or remind you to log them.',
      actions: html`<button type="button" class="btn primary" data-action="new-rule">${icons.plus}Add a repeating transaction</button>`,
    })}`;
  }
  let out = 0;
  let inc = 0;
  for (const r of rules) {
    if (r.paused || isFinished(r, state.today)) continue;
    if (r.type === 'income') inc += monthlyEquivalent(r);
    else out += monthlyEquivalent(r);
  }
  return html`${head}
    <p class="lede">Active items add up to about <strong>${money(out)}</strong> going out and <strong>${money(inc)}</strong> coming in each month.</p>
    ${remindersBlock()}
    <ul class="plain-list card-list">
      ${rules.map((r) => {
        const cat = categoryById(r.categoryId);
        const due = nextDue(r);
        const finished = isFinished(r, state.today);
        let when;
        if (r.paused) when = 'Paused';
        else if (finished || !due) when = r.endDate ? `Ended ${date(r.endDate)}` : 'No more dates';
        else when = `Next ${relativeDay(due)}`;
        return html`<li>
          <button type="button" class="list-btn ${r.paused || finished ? 'dim' : ''}" data-action="edit-rule" data-id="${r.id}">
            ${badge(cat)}
            <span class="tx-main">
              <span class="tx-title">${r.note || cat.name}</span>
              <span class="tx-sub"><span>${FREQUENCIES[r.frequency].label}</span><span>${when}</span>${r.mode === 'remind' ? html`<span class="tag">Reminder</span>` : ''}</span>
            </span>
            <span class="amt ${r.type === 'income' ? 'amt-in' : 'amt-out'}">${r.type === 'income' ? money(r.amount, { sign: true }) : money(-r.amount)}</span>
          </button>
        </li>`;
      })}
    </ul>`;
}

// ---------- Categories ----------

function categoryRows(type) {
  const tops = state.categories.filter((c) => c.type === type && !c.parentId);
  const counts = new Map();
  for (const t of state.transactions) counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
  const rowFor = (c, i, list, child) => html`<li class="cat-row ${child ? 'child' : ''}">
    <button type="button" class="list-btn" data-action="edit-category" data-id="${c.id}">
      ${badge(c, child ? 'sm' : '')}
      <span class="tx-main">
        <span class="tx-title">${c.name}</span>
        <span class="tx-sub">
          <span>${plural(counts.get(c.id) ?? 0, 'transaction')}</span>
          ${c.budget != null ? html`<span>Budget ${money(c.budget)}</span>` : ''}
        </span>
      </span>
    </button>
    <span class="order-btns">
      <button type="button" class="icon-btn sm" data-action="move-category" data-id="${c.id}" data-step="-1" aria-label="Move ${c.name} up" ${i === 0 ? 'disabled' : ''}>${icons.up}</button>
      <button type="button" class="icon-btn sm" data-action="move-category" data-id="${c.id}" data-step="1" aria-label="Move ${c.name} down" ${i === list.length - 1 ? 'disabled' : ''}>${icons.down}</button>
    </span>
  </li>`;
  if (!tops.length) return html`<p class="muted">None yet.</p>`;
  return html`<ul class="plain-list card-list">
    ${tops.map((c, i) => {
      const kids = state.categories.filter((k) => k.parentId === c.id);
      return html`${rowFor(c, i, tops, false)}${kids.map((k, j) => rowFor(k, j, kids, true))}`;
    })}
  </ul>`;
}

export function renderCategories() {
  return html`${pageHead('Categories', html`<button type="button" class="btn primary" data-action="new-category">${icons.plus}Add</button>`)}
    <p class="lede">Tap a category to rename it, change its look, or put it inside another category as a subcategory. The arrows set the order used in lists.</p>
    <section aria-labelledby="exp-cats"><h2 class="list-title" id="exp-cats">Spending</h2>${categoryRows('expense')}</section>
    <section aria-labelledby="inc-cats"><h2 class="list-title" id="inc-cats">Income</h2>${categoryRows('income')}
      <button type="button" class="btn small" data-action="new-category" data-type="income">${icons.plus}Add an income category</button>
    </section>`;
}

// ---------- Accounts ----------

export function renderAccounts() {
  const head = pageHead('Accounts', html`<button type="button" class="btn primary" data-action="new-account">${icons.plus}Add</button>`);
  if (!state.accounts.length) {
    return html`${head}${emptyState({
      title: 'Accounts are optional',
      body: 'Add checking, credit cards or cash to see a balance for each. With two or more, the add form asks which one you used.',
      actions: html`<button type="button" class="btn primary" data-action="new-account">${icons.plus}Add an account</button>`,
    })}`;
  }
  const { balances, unassigned, total } = accountBalances(state.accounts, state.transactions);
  return html`${head}
    <section class="hero small">
      <p class="hero-line ${total < 0 ? 's-over' : ''}">${money(total)} across ${plural(state.accounts.length, 'account')}</p>
      ${unassigned !== 0 ? html`<p class="hero-sub">Transactions without an account add up to ${money(unassigned, { sign: true })} and aren’t included.</p>` : ''}
    </section>
    <ul class="plain-list card-list">
      ${state.accounts.map((a) => {
        const bal = balances.get(a.id) ?? 0;
        const count = state.transactions.filter((t) => t.accountId === a.id).length;
        return html`<li><button type="button" class="list-btn" data-action="edit-account" data-id="${a.id}">
          <span class="badge acct" aria-hidden="true">${a.name.slice(0, 1).toUpperCase()}</span>
          <span class="tx-main">
            <span class="tx-title">${a.name}</span>
            <span class="tx-sub"><span>${ACCOUNT_KINDS[a.kind] ?? 'Other'}</span><span>${plural(count, 'transaction')}</span></span>
          </span>
          <span class="amt ${bal < 0 ? 'amt-neg' : ''}">${money(bal)}</span>
        </button></li>`;
      })}
    </ul>
    <p class="muted small footnote">Balance is the starting balance plus income and refunds, minus spending. Transfers between accounts aren’t tracked, so log a card payment as an expense from checking only if you don’t also log the card purchases.</p>`;
}

// ---------- Plans ----------

// A plan is one shape doing three jobs: a nest egg you fill, a trip you fill
// and then spend down, and — through the what-if panel — a way to ask what
// any of it costs per month. Stored under the older `goals` name.

// What-if levers. Not saved: they're a question you ask, not a setting, and
// the honest default is what you have actually been putting aside.
export const planScenario = { monthly: null, lumpSum: 0 };

export function resetPlanScenario() {
  planScenario.monthly = null;
  planScenario.lumpSum = 0;
}

function scenarioMonthly(surplus) {
  return planScenario.monthly == null ? Math.max(0, surplus.typical) : planScenario.monthly;
}

function whenLabel(key, locale) {
  return key ? formatMonth(key, locale, { month: 'short', year: 'numeric' }) : null;
}

// What has been charged to a trip. A total you can't check isn't much use,
// so the newest few are named outright.
function chargedList(plan) {
  const charged = sortTransactions(planTransactions(state.transactions, plan.id));
  if (!charged.length) return '';
  const shown = charged.slice(0, 4);
  return html`<ul class="plain-list plan-charges">
      ${shown.map((t) => {
        const cat = categoryById(t.categoryId);
        return html`<li>
          <span class="plan-charge-what">${cat ? badge(cat, 'sm') : ''}${t.note || (cat ? cat.name : 'Uncategorized')}</span>
          <span class="amt">${money(t.refund ? -t.amount : t.amount)}</span>
        </li>`;
      })}
      ${charged.length > shown.length ? html`<li class="muted small">and ${plural(charged.length - shown.length, 'more charge')}</li>` : ''}
    </ul>`;
}

function planCard(row, locale) {
  const { plan: g, progress: p } = row;
  const trip = p.kind === 'trip';
  const when = whenLabel(row.fundedKey, locale);

  let note;
  if (p.done && trip) note = `Fully funded. ${money(p.spent)} spent so far, ${money(Math.max(0, p.available))} still in the pot.`;
  else if (p.done) note = 'Fully funded.';
  else if (row.fundedKey && row.monthsAway === 0) note = `${money(p.toSave)} to go.`;
  else if (row.fundedKey) note = `${money(p.toSave)} to go — funded by ${when} at this rate.`;
  else note = `${money(p.toSave)} to go. Set something aside each month and a date appears here.`;

  let verdict = '';
  if (row.onTime === true) verdict = html`<p class="plan-verdict ok">Makes ${date(g.targetDate)}${row.monthsAway === 0 ? ' — already funded' : ` — ready ${when}`}</p>`;
  else if (row.onTime === false) verdict = html`<p class="plan-verdict late">Misses ${date(g.targetDate)} — not ready until ${when}</p>`;
  else if (!row.fundedKey && g.targetDate) verdict = html`<p class="plan-verdict late">Nothing going in, so ${date(g.targetDate)} isn’t reachable</p>`;

  return html`<li class="panel plan" style="--c:${g.color}">
    <div class="plan-top">
      <h2>${g.name}</h2>
      <span class="plan-kind">${trip ? PLAN_KINDS.trip : PLAN_KINDS.fund}</span>
    </div>
    <p class="goal-amt"><span class="amt">${money(p.saved)}</span> <span class="muted">of ${money(g.target)}</span> <span class="goal-pct">${percent(p.ratio)}</span></p>
    ${progressBar(p.ratio, p.done ? 'done' : 'goal', `${g.name}: ${money(p.saved)} of ${money(g.target)}`)}
    ${trip && p.spent !== 0
      ? html`<p class="plan-spend"><span>Spent on this trip</span> <span class="amt">${money(p.spent)}</span></p>
          ${progressBar(p.spentRatio, p.overspent ? 'over' : 'spend', `${g.name}: ${money(p.spent)} spent`)}
          ${p.overspent ? html`<p class="plan-verdict late">That’s ${money(p.spent - p.saved)} more than the pot holds.</p>` : ''}
          ${chargedList(g)}`
      : ''}
    ${trip && g.startDate ? html`<p class="muted small">${date(g.startDate)}${g.endDate ? ` to ${date(g.endDate)}` : ''}</p>` : ''}
    <p class="muted small">${note}</p>
    ${verdict}
    <div class="btn-row">
      <button type="button" class="btn small primary" data-action="adjust-goal" data-id="${g.id}">${trip ? 'Add or take out money' : 'Add or take out money'}</button>
      <button type="button" class="btn small ghost" data-action="edit-goal" data-id="${g.id}">Edit</button>
    </div>
  </li>`;
}

// The part that changes as you move the levers, mounted on its own so typing
// in the what-if fields doesn't rebuild the whole page under your cursor.
function planResults() {
  const { locale } = state.settings;
  const surplus = monthlySurplus(state.transactions, state.today);
  const monthly = scenarioMonthly(surplus);
  const projection = projectPlans(state.goals, state.transactions, {
    monthly,
    lumpSum: planScenario.lumpSum,
    todayIso: state.today,
  });
  const needed = requiredMonthly(state.goals, state.transactions, state.today);

  let headline;
  if (!monthly && !planScenario.lumpSum) headline = html`<p class="plan-headline">Nothing set aside each month, so nothing has a finish date yet.</p>`;
  else if (projection.unfunded.length) headline = html`<p class="plan-headline late">At ${money(monthly)} a month, ${projection.unfunded.length === 1 ? 'one plan never fills up' : `${projection.unfunded.length} plans never fill up`}.</p>`;
  else if (projection.late.length) headline = html`<p class="plan-headline late">${projection.late.length === 1 ? 'One plan misses its date' : `${projection.late.length} plans miss their dates`} at ${money(monthly)} a month. Everything is funded by ${whenLabel(projection.allFundedKey, locale)}.</p>`;
  else headline = html`<p class="plan-headline ok">Everything funded by ${whenLabel(projection.allFundedKey, locale)} at ${money(monthly)} a month.</p>`;

  const gap = needed > 0 && monthly < needed
    ? html`<p class="plan-note">Hitting every date needs ${money(needed)} a month — ${money(needed - monthly)} more than this.</p>`
    : needed > 0
      ? html`<p class="plan-note">Hitting every date needs ${money(needed)} a month, which this covers.</p>`
      : '';

  return html`${headline}${gap}
    <ul class="plain-list goal-list">${projection.rows.map((row) => planCard(row, locale))}</ul>`;
}

export function renderGoals() {
  const head = pageHead('Plans', html`<button type="button" class="btn primary" data-action="new-goal">${icons.plus}Add</button>`);
  if (!state.goals.length) {
    return html`${head}${emptyState({
      title: 'Save toward something',
      body: 'A nest egg you’re filling, or a trip you’ll spend down. Set a target and a date, and Tally works out what it costs a month and whether you’ll make it.',
      actions: html`<button type="button" class="btn primary" data-action="new-goal">${icons.plus}Add a plan</button>`,
    })}`;
  }

  const { locale } = state.settings;
  const surplus = monthlySurplus(state.transactions, state.today);
  const monthly = scenarioMonthly(surplus);
  const history = surplus.monthsUsed
    ? html`<p class="muted small">Over the last ${plural(surplus.monthsUsed, 'month')} with activity you’ve had about ${money(Math.max(0, surplus.typical))} a month left over${surplus.typical > 0 ? '' : ' — nothing spare'}${surplus.monthsUsed > 1 && surplus.worst < surplus.typical ? `, and as little as ${money(surplus.worst)} in the leanest month` : ''}. ${planScenario.monthly != null && planScenario.monthly !== Math.max(0, surplus.typical) ? html`<button type="button" class="link-btn" data-action="plan-use-surplus">Use that figure</button>` : ''}</p>`
    : html`<p class="muted small">Once there are a few months of history here, Tally can tell you what you usually have spare.</p>`;

  return html`${head}
    <section class="panel plan-whatif">
      <h2>What if</h2>
      <form class="plan-levers" data-plan-levers novalidate autocomplete="off">
        <label class="field">
          <span class="label">Set aside each month</span>
          <input type="text" inputmode="decimal" name="monthly" value="${centsToInput(monthly, { locale })}" aria-describedby="plan-headline" />
        </label>
        <label class="field">
          <span class="label">Plus a one-off, now <span class="opt">Optional</span></span>
          <input type="text" inputmode="decimal" name="lumpSum" value="${planScenario.lumpSum ? centsToInput(planScenario.lumpSum, { locale }) : ''}" placeholder="0" />
        </label>
      </form>
      ${history}
    </section>
    <div id="plan-results">${planResults()}</div>`;
}

export function afterPlansMount(root) {
  const form = root.querySelector('[data-plan-levers]');
  if (!form) return;
  const { locale } = state.settings;
  let timer;
  form.addEventListener('input', (e) => {
    const { name, value } = e.target;
    if (name !== 'monthly' && name !== 'lumpSum') return;
    // A half-typed number shouldn't read as zero and blank every date, so an
    // unparseable value leaves the last good one in place.
    const parsed = parseAmount(value, { locale });
    const cents = value.trim() === '' ? 0 : parsed.ok && !parsed.negative ? parsed.cents : null;
    if (cents == null) return;
    planScenario[name] = cents;
    clearTimeout(timer);
    timer = setTimeout(() => mount($('#plan-results', root), planResults()), 140);
  });
}

// ---------- Year in review ----------

export const reviewState = { year: null };

export function renderReview() {
  const years = yearsWithData(state.transactions);
  const thisYear = Number(state.today.slice(0, 4));
  const year = reviewState.year ?? (years.includes(thisYear) || !years.length ? thisYear : years[0]);
  const minYear = years.length ? Math.min(...years, thisYear) : thisYear;
  const nav = html`<div class="month-nav">
    <button type="button" class="icon-btn" data-action="year-shift" data-step="-1" aria-label="Previous year" ${year <= minYear ? 'disabled' : ''}>${icons.prev}</button>
    <h1 class="month-title">${year} in review</h1>
    <button type="button" class="icon-btn" data-action="year-shift" data-step="1" aria-label="Next year" ${year >= thisYear ? 'disabled' : ''}>${icons.next}</button>
  </div>`;
  const r = yearReview(state.transactions, state.categories, year);
  if (!r.count) {
    return html`${nav}${emptyState({ title: `Nothing logged in ${year}`, body: 'Once there are transactions for this year, the summary appears here.' })}`;
  }
  const locale = state.settings.locale;
  const isCurrent = year === thisYear;
  const topTotal = r.categories.reduce((s, c) => s + c.amount, 0);
  const top = r.categories.slice(0, 6);
  const biggest = r.biggestExpense;
  return html`${nav}
    <section class="hero">
      <p class="hero-line">${isCurrent ? 'So far this year you’ve' : `In ${year} you`} earned ${money(r.income)} and spent ${money(r.expenses)}</p>
      <p class="hero-sub">${r.net >= 0
        ? `That leaves ${money(r.net)}${r.savingsRate != null ? `, or ${percent(r.savingsRate)} of what came in` : ''}.`
        : `Spending was ${money(-r.net)} more than income.`}</p>
    </section>
    <dl class="figures">
      <div><dt>Average month</dt><dd class="amt">${money(r.averageMonthlyExpenses)}</dd></div>
      <div><dt>Months with activity</dt><dd>${r.activeMonths}</dd></div>
      <div><dt>Transactions</dt><dd>${r.count.toLocaleString(locale)}</dd></div>
    </dl>
    <div class="dash-grid">
      <div class="dash-col">
        <section class="panel" aria-labelledby="yr-months">
          <div class="section-head"><h2 id="yr-months">Month by month</h2></div>
          ${barChart(
            r.months.map((m) => ({ key: m.key, label: formatMonth(m.key, locale, { month: 'narrow' }), fullLabel: formatMonth(m.key, locale), values: { income: m.income, expenses: Math.max(0, m.expenses) } })),
            {
              fields: [
                { field: 'income', name: 'Income', cls: 'bar-in' },
                { field: 'expenses', name: 'Spending', cls: 'bar-out' },
              ],
              height: 200,
              highlightKey: r.topMonth?.key,
              fmtAxis: (v) => money(v, { compact: true }),
              fmtValue: (v) => money(v),
              ariaLabel: `Income and spending by month in ${year}`,
            }
          )}
        </section>
        <section class="panel" aria-labelledby="yr-high">
          <div class="section-head"><h2 id="yr-high">Highlights</h2></div>
          <dl class="facts">
            ${r.topMonth ? html`<div><dt>Highest-spending month</dt><dd>${month(r.topMonth.key, { month: 'long' })}, ${money(r.topMonth.expenses)}</dd></div>` : ''}
            ${biggest ? html`<div><dt>Largest single expense</dt><dd>${biggest.note || categoryById(biggest.categoryId).name}, ${money(biggest.amount)} on ${date(biggest.date)}</dd></div>` : ''}
            ${r.categories[0] ? html`<div><dt>Top category</dt><dd>${categoryById(r.categories[0].categoryId).name}, ${percent(r.categories[0].amount / topTotal)} of spending</dd></div>` : ''}
          </dl>
        </section>
      </div>
      <div class="dash-col">
        <section class="panel" aria-labelledby="yr-cats">
          <div class="section-head"><h2 id="yr-cats">Top categories</h2></div>
          ${top.length
            ? html`<ul class="plain-list rank">
                ${top.map((c) => {
                  const cat = categoryById(c.categoryId);
                  return html`<li>
                    <div class="bm-top"><span class="bm-name">${cat.icon} ${cat.name}</span><span class="amt">${money(c.amount)}</span></div>
                    <div class="bar"><span class="bar-fill" style="width:${((c.amount / top[0].amount) * 100).toFixed(1)}%;background:${cat.color}"></span></div>
                    <span class="muted small">${percent(c.amount / topTotal)} of spending, about ${money(Math.round(c.amount / Math.max(1, r.activeMonths)))} a month</span>
                  </li>`;
                })}
              </ul>`
            : html`<p class="muted">No spending recorded.</p>`}
        </section>
      </div>
    </div>`;
}
