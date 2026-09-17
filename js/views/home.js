import { html } from '../ui/html.js';
import { state, sortedTransactions } from '../store.js';
import { totals, txsInMonth, budgetOverview, spendingByCategory, monthlySeries, compareBudgetRows } from '../core/stats.js';
import { daysInMonth, parseISO, monthKeyAdd, formatMonth, isInMonth } from '../core/dates.js';
import { UNCATEGORIZED } from '../core/defaults.js';
import { money, month, relativeDay, categoryById, badge, percent, timeAgo, plural } from '../ui/format.js';
import { donut, paceTrack, progressBar, barChart } from '../ui/charts.js';
import { ui, viewMonth, currentMonth, monthSwitcher, emptyState, txRow, sectionHead, icons } from './components.js';

export function remindersBlock() {
  if (!state.reminders.length) return '';
  const items = state.reminders
    .map((r) => ({ ...r, cat: categoryById(r.rule.categoryId) }))
    .sort((a, b) => (a.dates[0] < b.dates[0] ? -1 : 1));
  return html`<section class="panel reminders" aria-labelledby="due-title">
    <div class="section-head"><h2 id="due-title">Due to log</h2></div>
    <ul class="plain-list">
      ${items.map(({ rule, dates, cat }) => html`<li class="reminder">
        ${badge(cat)}
        <div class="reminder-main">
          <strong>${rule.note || cat.name}</strong>
          <span class="muted">Due ${relativeDay(dates[0])}${dates.length > 1 ? html`, then ${plural(dates.length - 1, 'more date')}` : ''}</span>
        </div>
        <span class="amt ${rule.type === 'income' ? 'amt-in' : 'amt-out'}">${money(rule.type === 'income' ? rule.amount : -rule.amount, { sign: rule.type === 'income' })}</span>
        <div class="reminder-actions">
          <button type="button" class="btn small primary" data-action="reminder" data-do="log" data-rule="${rule.id}" data-date="${dates[0]}">Log it</button>
          <button type="button" class="btn small ghost" data-action="reminder" data-do="skip" data-rule="${rule.id}" data-date="${dates[0]}">Skip</button>
        </div>
      </li>`)}
    </ul>
  </section>`;
}

export function backupNudge() {
  const { backupReminderDays, lastExportAt } = state.settings;
  if (!backupReminderDays || !state.transactions.length || !state.lastChangeAt) return '';
  if (lastExportAt && lastExportAt >= state.lastChangeAt) return '';
  const daysSince = lastExportAt ? Math.floor((Date.now() - new Date(lastExportAt).getTime()) / 86400000) : null;
  const due = daysSince == null ? state.transactions.length >= 10 : daysSince >= backupReminderDays;
  if (!due) return '';
  return html`<aside class="nudge" role="note">
    <p><strong>${lastExportAt ? `Last backup was ${timeAgo(lastExportAt)}.` : 'You haven’t made a backup yet.'}</strong>
    Your data is stored only in this browser. Clearing site data would erase it.</p>
    <button type="button" class="btn small" data-action="export-json">Download backup</button>
  </aside>`;
}

function hero(key, monthTx, overview) {
  const isCurrent = key === currentMonth();
  const isPast = key < currentMonth();
  const [y, m] = key.split('-').map(Number);
  const days = daysInMonth(y, m);
  const dayOfMonth = isCurrent ? parseISO(state.today).d : isPast ? days : 0;
  const daysLeft = days - dayOfMonth + (isCurrent ? 1 : 0);
  const name = month(key, { month: 'long' });
  const t = totals(monthTx);

  if (!monthTx.length && !isCurrent) {
    return html`<section class="hero">
      <p class="hero-line">${isPast ? `Nothing was recorded in ${name}` : `${name} hasn’t started yet`}</p>
      ${overview.hasBudgets ? html`<p class="hero-sub">Your monthly budgets add up to ${money(overview.limit)}.</p>` : ''}
    </section>`;
  }

  if (!overview.hasBudgets) {
    const headline = t.expenses > 0
      ? isCurrent ? `You’ve spent ${money(t.expenses)} so far this month` : `You spent ${money(t.expenses)} in ${name}`
      : isCurrent ? 'Nothing spent yet this month' : isPast ? `No spending recorded in ${name}` : `${name} hasn’t started yet`;
    return html`<section class="hero">
      <p class="hero-line">${headline}</p>
      <p class="hero-sub"><a href="#/budgets">Set monthly budgets</a> to see how much is left to spend.</p>
    </section>`;
  }

  const { limit, spent, status } = overview;
  const remaining = limit - spent;
  let headline;
  if (!isCurrent && !isPast) headline = `${money(limit)} budgeted for ${name}`;
  else if (isPast) headline = remaining >= 0 ? `You finished ${name} ${money(remaining)} under budget` : `You finished ${name} ${money(-remaining)} over budget`;
  else headline = remaining >= 0 ? `${money(remaining)} left of your ${money(limit)} budget` : `${money(-remaining)} over your ${money(limit)} budget`;

  const lines = [];
  if (isCurrent) {
    const dayFraction = dayOfMonth / days;
    const ahead = limit > 0 && spent / limit > dayFraction + 0.05;
    lines.push(`${plural(daysLeft, 'day')} left in ${name}, including today.`);
    if (remaining > 0 && daysLeft > 0) lines.push(`About ${money(Math.floor(remaining / daysLeft))} a day keeps you on budget.`);
    if (status.state !== 'over') lines.push(ahead ? 'Spending is running ahead of the month.' : 'Spending is on pace.');
  } else if (isPast) {
    lines.push(`Spent ${money(spent)} of ${money(limit)}.`);
  }
  if (overview.unbudgetedSpent > 0) lines.push(`Plus ${money(overview.unbudgetedSpent)} in categories without a budget.`);

  const ratio = limit > 0 ? spent / limit : spent > 0 ? 2 : 0;
  return html`<section class="hero">
    <p class="hero-line s-${status.state}">${headline}</p>
    ${paceTrack({
      ratio,
      state: status.state,
      dayFraction: dayOfMonth / days,
      days,
      showToday: isCurrent,
      ariaLabel: `${percent(Math.min(ratio, 9.99))} of the budget used${isCurrent ? `, ${percent(dayOfMonth / days)} of the month gone` : ''}`,
    })}
    <p class="hero-sub">${lines.join(' ')}</p>
  </section>`;
}

function figures(t) {
  return html`<dl class="figures">
    <div><dt>Income</dt><dd class="amt amt-in">${money(t.income)}</dd></div>
    <div><dt>Spending</dt><dd class="amt">${money(t.expenses)}</dd></div>
    <div><dt>Net</dt><dd class="amt ${t.net < 0 ? 'amt-neg' : ''}">${money(t.net, { sign: true })}</dd></div>
  </dl>`;
}

function budgetSnapshot(overview) {
  const rows = [];
  for (const r of overview.rows) {
    if (r.limit != null) rows.push(r);
    for (const c of r.children) if (c.limit != null) rows.push(c);
  }
  if (!rows.length) return '';
  rows.sort(compareBudgetRows);
  const shown = rows.slice(0, 5);
  return html`<section class="panel" aria-labelledby="bud-title">
    ${sectionHead(html`<span id="bud-title">Budgets</span>`, html`<a class="link" href="#/budgets">${rows.length > shown.length ? `All ${rows.length}` : 'Details'}</a>`)}
    <ul class="plain-list budget-mini">
      ${shown.map((r) => html`<li>
        <div class="bm-top">
          <span class="bm-name">${r.category.icon} ${r.category.name}</span>
          <span class="bm-left s-${r.state}">${r.remaining >= 0 ? `${money(r.remaining)} left` : `${money(-r.remaining)} over`}</span>
        </div>
        ${progressBar(r.limit > 0 ? r.spent / r.limit : r.spent > 0 ? 1 : 0, r.state, `${r.category.name}: ${money(r.spent)} of ${money(r.limit)}`)}
      </li>`)}
    </ul>
  </section>`;
}

function categoryBreakdown(monthTx) {
  const rows = spendingByCategory(monthTx, state.categories).filter((r) => r.amount > 0);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  if (!total) {
    return html`<section class="panel" aria-labelledby="cat-title">
      ${sectionHead(html`<span id="cat-title">Where it went</span>`)}
      <p class="muted">No spending this month yet. Categories will appear here as you log expenses.</p>
    </section>`;
  }
  const top = rows.slice(0, 6);
  const rest = rows.slice(6).reduce((s, r) => s + r.amount, 0);
  const segments = top.map((r) => {
    const c = r.categoryId === UNCATEGORIZED ? categoryById(null) : categoryById(r.categoryId);
    return { value: r.amount, color: c.color, label: `${c.name}: ${money(r.amount)}`, cat: c, amount: r.amount };
  });
  if (rest > 0) segments.push({ value: rest, color: 'var(--ink-4)', label: `Everything else: ${money(rest)}`, cat: { name: 'Everything else', icon: '…', color: 'var(--ink-4)' }, amount: rest });
  return html`<section class="panel" aria-labelledby="cat-title">
    ${sectionHead(html`<span id="cat-title">Where it went</span>`)}
    <div class="breakdown">
      ${donut(segments, {
        centerTop: money(total, { compact: total >= 1000000 }),
        centerBottom: 'spent',
        ariaLabel: `Spending by category: ${segments.map((s) => s.label).join(', ')}`,
      })}
      <ul class="legend">
        ${segments.map((s) => html`<li>
          <i class="key" style="background:${s.color}"></i>
          <span class="legend-name">${s.cat.name}</span>
          <span class="legend-pct">${percent(s.amount / total)}</span>
          <span class="amt">${money(s.amount)}</span>
        </li>`)}
      </ul>
    </div>
  </section>`;
}

function trend(key) {
  const series = monthlySeries(state.transactions, key, 6);
  const locale = state.settings.locale;
  return html`<section class="panel" aria-labelledby="trend-title">
    ${sectionHead(html`<span id="trend-title">Last 6 months</span>`)}
    ${barChart(
      series.map((s) => ({
        key: s.key,
        label: formatMonth(s.key, locale, { month: 'short' }),
        fullLabel: formatMonth(s.key, locale),
        values: { income: s.income, expenses: Math.max(0, s.expenses) },
      })),
      {
        fields: [
          { field: 'income', name: 'Income', cls: 'bar-in' },
          { field: 'expenses', name: 'Spending', cls: 'bar-out' },
        ],
        height: 190,
        highlightKey: key,
        fmtAxis: (v) => money(v, { compact: true }),
        fmtValue: (v) => money(v),
        ariaLabel: `Income and spending, ${formatMonth(series[0].key, locale)} to ${formatMonth(key, locale)}`,
      }
    )}
    <p class="muted small">Net over these months: ${money(series.reduce((s, m) => s + m.net, 0), { sign: true })}</p>
  </section>`;
}

function recent(key, monthTx) {
  const list = sortedTransactions().filter((t) => isInMonth(t.date, key)).slice(0, 6);
  return html`<section class="panel" aria-labelledby="recent-title">
    ${sectionHead(html`<span id="recent-title">Latest in ${month(key, { month: 'long' })}</span>`, html`<a class="link" href="#/activity">All activity</a>`)}
    ${list.length
      ? html`<ul class="tx-list">${list.map(txRow)}</ul>`
      : html`<p class="muted">Nothing logged for this month.</p>`}
  </section>`;
}

function welcome() {
  return emptyState({
    title: 'Start with one transaction',
    body: 'Log what you spent today, and your month will take shape here. You can also bring in history from a spreadsheet or bank export.',
    actions: html`<button type="button" class="btn primary" data-action="new-tx">${icons.plus}Add a transaction</button>
      <button type="button" class="btn" data-action="import-csv">Import a CSV file</button>`,
  });
}

export function renderHome() {
  const key = viewMonth();
  if (!state.transactions.length && !state.reminders.length) {
    return html`${monthSwitcher(key)}${welcome()}
      <section class="panel tips">
        <h2>Good to know</h2>
        <ul>
          <li>Everything stays on this device. There’s no account and no server.</li>
          <li>Add Tally to your home screen to open it like an app, even offline.</li>
          <li>Set up rent, salary and subscriptions once under <a href="#/recurring">Repeating</a>.</li>
        </ul>
      </section>`;
  }
  const monthTx = txsInMonth(state.transactions, key);
  const overview = budgetOverview(state.transactions, state.categories, key, state.settings.warnPercent);
  const t = totals(monthTx);
  return html`${monthSwitcher(key)}
    ${key === currentMonth() ? remindersBlock() : ''}
    ${backupNudge()}
    ${hero(key, monthTx, overview)}
    ${figures(t)}
    <div class="dash-grid">
      <div class="dash-col">
        ${budgetSnapshot(overview)}
        ${recent(key, monthTx)}
      </div>
      <div class="dash-col">
        ${categoryBreakdown(monthTx)}
        ${trend(key)}
      </div>
    </div>`;
}

export function shiftMonth(step) {
  ui.month = monthKeyAdd(viewMonth(), step);
  if (ui.month === currentMonth()) ui.month = null;
}
