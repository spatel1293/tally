import { html } from '../ui/html.js';
import { state } from '../store.js';
import { accountBalances, goalProgress, yearReview, yearsWithData } from '../core/stats.js';
import { FREQUENCIES, nextDue, monthlyEquivalent, isFinished } from '../core/recurring.js';
import { ACCOUNT_KINDS } from '../core/defaults.js';
import { formatMonth } from '../core/dates.js';
import { money, badge, categoryById, date, plural, percent, timeAgo, month, relativeDay } from '../ui/format.js';
import { progressBar, barChart } from '../ui/charts.js';
import { pageHead, emptyState, icons } from './components.js';
import { remindersBlock } from './home.js';

// ---------- More (phone menu) ----------

export const MORE_LINKS = [
  { route: 'recurring', label: 'Repeating', desc: 'Rent, salary, subscriptions' },
  { route: 'categories', label: 'Categories', desc: 'Names, colors, icons and order' },
  { route: 'accounts', label: 'Accounts', desc: 'Checking, cards, cash and balances' },
  { route: 'goals', label: 'Savings goals', desc: 'Track what you’re saving toward' },
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

// ---------- Goals ----------

export function renderGoals() {
  const head = pageHead('Savings goals', html`<button type="button" class="btn primary" data-action="new-goal">${icons.plus}Add</button>`);
  if (!state.goals.length) {
    return html`${head}${emptyState({
      title: 'Save toward something',
      body: 'Set a target, and optionally a date. Tally shows how much to set aside each month to get there.',
      actions: html`<button type="button" class="btn primary" data-action="new-goal">${icons.plus}Add a goal</button>`,
    })}`;
  }
  return html`${head}
    <ul class="plain-list goal-list">
      ${state.goals.map((g) => {
        const p = goalProgress(g, state.today);
        let note;
        if (p.done) note = 'Fully funded.';
        else if (p.overdue) note = `The target date (${date(g.targetDate)}) has passed. ${money(p.remaining)} to go.`;
        else if (p.perMonth != null) note = `${money(p.remaining)} to go. About ${money(p.perMonth)} a month reaches it by ${date(g.targetDate)}.`;
        else note = `${money(p.remaining)} to go.`;
        return html`<li class="panel goal" style="--c:${g.color}">
          <div class="goal-top">
            <h2>${g.name}</h2>
            <span class="goal-pct">${percent(p.ratio)}</span>
          </div>
          <p class="goal-amt"><span class="amt">${money(p.saved)}</span> <span class="muted">of ${money(g.target)}</span></p>
          ${progressBar(p.ratio, p.done ? 'done' : 'goal', `${g.name}: ${money(p.saved)} of ${money(g.target)}`)}
          <p class="muted small">${note}</p>
          <div class="btn-row">
            <button type="button" class="btn small primary" data-action="adjust-goal" data-id="${g.id}">Add or take out money</button>
            <button type="button" class="btn small ghost" data-action="edit-goal" data-id="${g.id}">Edit</button>
          </div>
        </li>`;
      })}
    </ul>`;
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
