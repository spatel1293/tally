import { html } from '../ui/html.js';
import { state, sortedTransactions } from '../store.js';
import { totals, txsInMonth, budgetOverview, spendingByCategory, compareBudgetRows } from '../core/stats.js';
import { daysInMonth, parseISO, monthKeyAdd, isInMonth } from '../core/dates.js';
import { UNCATEGORIZED } from '../core/defaults.js';
import { planOrder, planProgress, allocate, planKind, PLAN_KINDS, BP } from '../core/plans.js';
import { advisorReview } from '../core/advisor.js';
import { money, month, relativeDay, categoryById, badge, percent, timeAgo, plural } from '../ui/format.js';
import { donut, progressRing, progressBar } from '../ui/charts.js';
import { ui, viewMonth, currentMonth, monthSwitcher, emptyState, txRow, icons, SEC_ICONS, homeSectionHead } from './components.js';

export function remindersBlock() {
  if (!state.reminders.length) return '';
  const items = state.reminders
    .map((r) => ({ ...r, cat: categoryById(r.rule.categoryId) }))
    .sort((a, b) => (a.dates[0] < b.dates[0] ? -1 : 1));
  return html`<section class="panel tinted reminders" style="--hue:var(--accent)" aria-labelledby="due-title">
    ${homeSectionHead('var(--accent)', SEC_ICONS.bell, 'Due to log', { id: 'due-title' })}
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
    <p><strong>${lastExportAt ? `Last backup ${timeAgo(lastExportAt)}.` : 'No backup yet.'}</strong>
    This device holds the only copy.</p>
    <button type="button" class="btn small" data-action="export-json">Back up</button>
  </aside>`;
}

// ---------- Savings first ----------

function fmtMonths(m) {
  return Number.isInteger(m) ? String(m) : m.toFixed(1);
}

// The one card that answers "am I safe?": how many months the safety net
// would carry you, against the target. Without a safety net it falls back to
// how far along everything is together, and with no plans at all it asks for
// one — the first thing a planner would ask for too.
function savingsHero(review) {
  const { safety, runway: months, runwayTarget: target, essentials, surplus, allocated } = review;
  const goals = state.goals;
  const totalSaved = goals.reduce((s, g) => s + (g.saved ?? 0), 0);
  const totalTarget = goals.reduce((s, g) => s + g.target, 0);
  const typical = Math.max(0, surplus.typical);

  let ring = '';
  let headline;
  let sub;
  let stateName = 'accent';
  if (safety && months != null) {
    const ratio = target > 0 ? months / target : 0;
    stateName = ratio >= 1 ? 'ok' : ratio >= 0.5 ? 'warning' : 'over';
    ring = progressRing({
      ratio,
      state: stateName,
      showDay: false,
      centerTop: fmtMonths(months),
      centerBottom: months === 1 ? 'month' : 'months',
      ariaLabel: `Safety net covers ${fmtMonths(months)} of ${target} months`,
    });
    headline = ratio >= 1 ? `${fmtMonths(months)} months of runway. You’re covered.` : `${fmtMonths(months)} of ${target} months of runway`;
    sub = `${safety.name} holds ${money(safety.saved ?? 0)}, and a month of essentials is about ${money(essentials)}.${ratio < 1 && typical > 0 ? ` At the usual surplus, the rest is on its way.` : ''}`;
  } else if (goals.length) {
    const ratio = totalTarget > 0 ? Math.min(1, totalSaved / totalTarget) : 0;
    ring = progressRing({
      ratio,
      state: 'accent',
      showDay: false,
      centerTop: percent(ratio),
      centerBottom: 'saved',
      ariaLabel: `${percent(ratio)} of all plans funded`,
    });
    headline = `${money(totalSaved)} set aside toward ${money(totalTarget)}`;
    sub = safety
      ? html`To measure that in months, <a href="#/budgets">set monthly budgets</a> or log a few months of spending.`
      : html`Mark one plan as your safety net and Tally will show how many months it would carry you. <a href="#/goals">Choose one</a>.`;
  } else {
    headline = 'Start with a safety net';
    sub = 'The first plan a planner would give you: a pot that covers a few months of essentials. Then everything else.';
  }

  const chips = goals.length
    ? html`<dl class="stat-chips">
        <div style="--chip:var(--pos)"><dt>Set aside</dt><dd class="amt amt-in">${money(totalSaved)}</dd></div>
        <div style="--chip:var(--accent)"><dt>Usual surplus</dt><dd class="amt">${money(typical)}<small>/mo</small></dd></div>
        <div style="--chip:var(--hue-budgets)"><dt>Allocated</dt><dd class="amt">${typical > 0 ? percent(allocated / typical) : '—'}</dd></div>
      </dl>`
    : html`<div class="btn-row"><button type="button" class="btn primary" data-action="new-goal" data-kind="safety">${icons.plus}Add a safety net</button></div>`;

  return html`<section class="hero hero-savings${ring ? ' small' : ''}" data-state="${stateName}">
    <div class="hero-main">
      ${ring ? html`<div class="hero-ring-row">${ring}</div>` : ''}
      <div class="hero-say">
        <p class="hero-line">${headline}</p>
        <p class="hero-sub">${sub}</p>
      </div>
    </div>
    ${chips}
  </section>`;
}

// Every plan as a tile with its own ring. On the cover screen the tiles are
// a strip you flick through with a thumb; opened flat they're a grid.
export function planTile(plan, progress, share, { selected = false, compact = false } = {}) {
  const kind = planKind(plan);
  return html`<li class="plan-tile${selected ? ' selected' : ''}" style="--c:${plan.color}">
    <button type="button" class="plan-tile-btn" data-action="select-plan" data-id="${plan.id}" aria-label="${plan.name}, ${percent(progress.ratio)} funded">
      <span class="ring-sm" style="--ring-a:${plan.color};--ring-b:color-mix(in srgb, ${plan.color} 55%, white);--ring-glow:${plan.color}">
        ${progressRing({ size: 96, stroke: 12, ratio: progress.ratio, state: 'plan', showDay: false, centerTop: percent(progress.ratio), centerBottom: '', ariaLabel: '' })}
      </span>
      <span class="plan-tile-main">
        <span class="plan-tile-name">${plan.name}</span>
        <span class="plan-tile-kind">${PLAN_KINDS[kind]}</span>
        <span class="plan-tile-amt"><span class="amt">${money(progress.saved)}</span> <span class="muted">of ${money(plan.target)}</span></span>
        ${share > 0 ? html`<span class="plan-tile-share">${money(share)} a month</span>` : compact ? '' : html`<span class="plan-tile-share muted">No share of the surplus yet</span>`}
      </span>
    </button>
    <button type="button" class="btn small primary plan-tile-add" data-action="adjust-goal" data-id="${plan.id}">${icons.plus}<span>Set aside</span></button>
  </li>`;
}

function plansSection(review) {
  const typical = Math.max(0, review.surplus.typical);
  const ordered = planOrder(state.goals);
  const shares = allocate(ordered, typical);
  return html`<section class="panel tinted plans-home" style="--hue:var(--hue-budgets)" aria-labelledby="plans-title">
    ${homeSectionHead('var(--hue-budgets)', SEC_ICONS.target, html`<span id="plans-title">Plans</span>`, { link: html`<a class="link" href="#/goals">All plans</a>` })}
    ${ordered.length
      ? html`<ul class="plain-list plan-strip">${ordered.map((g) => planTile(g, planProgress(g, state.transactions, state.today), shares.byPlan.get(g.id) ?? 0, { selected: ui.selectedPlan === g.id }))}</ul>`
      : html`<p class="muted">Nothing to save toward yet.</p>
        <div class="btn-row"><button type="button" class="btn primary" data-action="new-goal" data-kind="safety">${icons.plus}Add a safety net</button><button type="button" class="btn" data-action="new-goal">Add a plan</button></div>`}
  </section>`;
}

// How each month's surplus is dealt out, as one bar and the rows behind it.
function allocationSection(review) {
  const typical = Math.max(0, review.surplus.typical);
  const ordered = planOrder(state.goals);
  if (!ordered.length) return '';
  const shares = allocate(ordered, typical);
  const segs = ordered.filter((g) => (g.allocBp ?? 0) > 0);
  const unBp = Math.max(0, BP - shares.sharedBp);
  return html`<section class="panel tinted" style="--hue:var(--hue-spending)" aria-labelledby="alloc-title">
    ${homeSectionHead('var(--hue-spending)', SEC_ICONS.split, html`<span id="alloc-title">Where the surplus goes</span>`, { link: html`<a class="link" href="#/goals">Change</a>` })}
    ${typical > 0
      ? html`<p class="muted small">About ${money(typical)} is left over in a typical month. ${shares.unallocated > 0 ? `${money(shares.unallocated)} of it has no home yet.` : 'All of it has a job.'}</p>`
      : html`<p class="muted small">Once a few months are logged, Tally knows what’s usually left over and can split it by these shares.</p>`}
    <div class="alloc-bar" role="img" aria-label="Shares of the monthly surplus">
      ${segs.map((g) => html`<i style="--w:${((Math.min(BP, g.allocBp) / BP) * 100).toFixed(2)}%;--c:${g.color}" title="${g.name}: ${percent(g.allocBp / BP)}"></i>`)}
      ${unBp > 0 ? html`<i class="alloc-free" style="--w:${((unBp / BP) * 100).toFixed(2)}%" title="Unallocated: ${percent(unBp / BP)}"></i>` : ''}
    </div>
    <ul class="plain-list alloc-rows">
      ${segs.map((g) => html`<li><i class="key" style="background:${g.color}"></i><span class="legend-name">${g.name}</span><span class="legend-pct">${percent(g.allocBp / BP)}</span><span class="amt">${money(shares.byPlan.get(g.id) ?? 0)}</span></li>`)}
      ${unBp > 0 ? html`<li class="muted"><i class="key alloc-free"></i><span class="legend-name">Unallocated</span><span class="legend-pct">${percent(unBp / BP)}</span><span class="amt">${money(shares.unallocated)}</span></li>` : ''}
    </ul>
  </section>`;
}

export function advisorSection(review, { limit = 3 } = {}) {
  const items = review.attention.slice(0, limit);
  return html`<section class="panel tinted" style="--hue:var(--hue-advisor)" aria-labelledby="adv-title">
    ${homeSectionHead('var(--hue-advisor)', SEC_ICONS.shield, html`<span id="adv-title">Advisor</span>`, { link: html`<a class="link" href="#/advisor">${review.score} of ${review.checks.length} clear</a>` })}
    ${items.length
      ? html`<ul class="plain-list checklist">
          ${items.map((c) => html`<li class="${c.soft ? 'soft' : ''}">
            <a class="check-row" href="#/${c.route}">
              <i class="check-mark" aria-hidden="true"></i>
              <span class="check-main"><strong>${c.title}</strong><small>${c.detail}</small></span>
              ${icons.chevron}
            </a>
          </li>`)}
        </ul>`
      : html`<p class="muted">Everything a planner would check is in order.</p>`}
  </section>`;
}

// ---------- This month's spending ----------

function spendingHero(key, monthTx, overview) {
  const isCurrent = key === currentMonth();
  const isPast = key < currentMonth();
  const [y, m] = key.split('-').map(Number);
  const days = daysInMonth(y, m);
  const dayOfMonth = isCurrent ? parseISO(state.today).d : isPast ? days : 0;
  const daysLeft = days - dayOfMonth + (isCurrent ? 1 : 0);
  const name = month(key, { month: 'long' });
  const t = totals(monthTx);

  if (!monthTx.length && !isCurrent) {
    return html`<section class="hero hero-spend small">
      <p class="hero-line">${isPast ? `Nothing was recorded in ${name}` : `${name} hasn’t started yet`}</p>
      ${overview.hasBudgets ? html`<p class="hero-sub">Your monthly budgets add up to ${money(overview.limit)}.</p>` : ''}
    </section>`;
  }

  if (!overview.hasBudgets) {
    const headline = t.expenses > 0
      ? isCurrent ? `You’ve spent ${money(t.expenses)} so far this month` : `You spent ${money(t.expenses)} in ${name}`
      : isCurrent ? 'Nothing spent yet this month' : isPast ? `No spending recorded in ${name}` : `${name} hasn’t started yet`;
    const dayFraction = dayOfMonth / days;
    const ring = isCurrent
      ? progressRing({ ratio: dayFraction, state: 'accent', showDay: false, centerTop: percent(dayFraction), centerBottom: 'of month', ariaLabel: `${percent(dayFraction)} of ${name} gone` })
      : '';
    return html`<section class="hero hero-spend small" data-state="accent">
      <div class="hero-main">
        ${ring ? html`<div class="hero-ring-row">${ring}</div>` : ''}
        <div class="hero-say">
          <p class="hero-line">${headline}</p>
          <p class="hero-sub"><a href="#/budgets">Set monthly budgets</a> to see how much is left to spend.</p>
        </div>
      </div>
      ${figures(t)}
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
  const showRing = isCurrent || isPast;
  return html`<section class="hero hero-spend small" data-state="${status.state}">
    <div class="hero-main">
      ${showRing
        ? html`<div class="hero-ring-row">${progressRing({
            ratio,
            state: status.state,
            dayFraction: dayOfMonth / days,
            showDay: isCurrent,
            centerTop: percent(Math.min(ratio, 9.99)),
            centerBottom: ratio > 1 ? 'over' : 'used',
            ariaLabel: `${percent(Math.min(ratio, 9.99))} of the budget used${isCurrent ? `, ${percent(dayOfMonth / days)} of the month gone` : ''}`,
          })}</div>`
        : ''}
      <div class="hero-say">
        <p class="hero-line s-${status.state}">${headline}</p>
        <p class="hero-sub">${lines.join(' ')}</p>
      </div>
    </div>
    ${figures(t)}
  </section>`;
}

function figures(t) {
  return html`<dl class="figures compact hero-figures">
    <div style="--chip:var(--pos)"><dt>Income</dt><dd class="amt amt-in">${money(t.income)}</dd></div>
    <div style="--chip:var(--accent)"><dt>Spending</dt><dd class="amt">${money(t.expenses)}</dd></div>
    <div style="--chip:${t.net < 0 ? 'var(--over)' : 'var(--pos)'}"><dt>Net</dt><dd class="amt ${t.net < 0 ? 'amt-neg' : 'amt-in'}">${money(t.net, { sign: true })}</dd></div>
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
  const shown = rows.slice(0, 4);
  return html`<section class="panel tinted" style="--hue:var(--hue-trend)" aria-labelledby="bud-title">
    ${homeSectionHead('var(--hue-trend)', SEC_ICONS.budgets, html`<span id="bud-title">Budgets</span>`, { link: html`<a class="link" href="#/budgets">${rows.length > shown.length ? `All ${rows.length}` : 'Details'}</a>` })}
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
  if (!total) return '';
  const top = rows.slice(0, 5);
  const rest = rows.slice(5).reduce((s, r) => s + r.amount, 0);
  const segments = top.map((r) => {
    const c = r.categoryId === UNCATEGORIZED ? categoryById(null) : categoryById(r.categoryId);
    return { value: r.amount, color: c.color, label: `${c.name}: ${money(r.amount)}`, cat: c, amount: r.amount };
  });
  if (rest > 0) segments.push({ value: rest, color: 'var(--ink-4)', label: `Everything else: ${money(rest)}`, cat: { name: 'Everything else', icon: '…', color: 'var(--ink-4)' }, amount: rest });
  return html`<section class="panel tinted" style="--hue:var(--hue-spending)" aria-labelledby="cat-title">
    ${homeSectionHead('var(--hue-spending)', SEC_ICONS.pie, html`<span id="cat-title">Where it went</span>`, { link: html`<a class="link" href="#/activity">All activity</a>` })}
    <div class="breakdown">
      ${donut(segments, { size: 132, stroke: 20, centerTop: money(total, { compact: total >= 1000000 }), centerBottom: 'spent', ariaLabel: `Spending by category: ${segments.map((s) => s.label).join(', ')}` })}
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

function recent(key) {
  const list = sortedTransactions().filter((t) => isInMonth(t.date, key)).slice(0, 4);
  if (!list.length) return '';
  return html`<section class="panel tinted" style="--hue:var(--hue-activity)" aria-labelledby="recent-title">
    ${homeSectionHead('var(--hue-activity)', SEC_ICONS.list, html`<span id="recent-title">Latest</span>`, { link: html`<a class="link" href="#/activity">All activity</a>`, dark: true })}
    <ul class="tx-list">${list.map(txRow)}</ul>
  </section>`;
}

function welcome() {
  return emptyState({
    title: 'Start with a safety net',
    body: 'Tally is built around what you’re saving toward. Add the pot that would carry you for a few months, then log what you spend and it works out what’s left over to feed it.',
    actions: html`<button type="button" class="btn primary" data-action="new-goal" data-kind="safety">${icons.plus}Add a safety net</button>
      <button type="button" class="btn" data-action="new-tx">Log a transaction</button>
      <button type="button" class="btn" data-action="import-csv">Import a CSV file</button>`,
  });
}

export function renderHome() {
  const key = viewMonth();
  if (!state.transactions.length && !state.reminders.length && !state.goals.length) {
    return html`${monthSwitcher(key)}${welcome()}
      <section class="panel tips">
        <h2>Good to know</h2>
        <ul>
          <li>Everything stays on this device. There’s no account and no server.</li>
          <li>Account numbers and logins go in a vault that only your passphrase can open.</li>
          <li>Set up rent, salary and subscriptions once under <a href="#/recurring">Repeating</a>.</li>
        </ul>
      </section>`;
  }
  const monthTx = txsInMonth(state.transactions, key);
  const overview = budgetOverview(state.transactions, state.categories, key, state.settings.warnPercent);
  const review = advisorReview({ plans: state.goals, accounts: state.accounts, categories: state.categories, transactions: state.transactions, settings: state.settings, todayIso: state.today });
  return html`${monthSwitcher(key)}
    ${key === currentMonth() ? remindersBlock() : ''}
    ${backupNudge()}
    ${savingsHero(review)}
    ${plansSection(review)}
    <div class="dash-grid">
      <div class="dash-col">
        ${allocationSection(review)}
        ${advisorSection(review)}
      </div>
      <div class="dash-col">
        ${spendingHero(key, monthTx, overview)}
        ${budgetSnapshot(overview)}
        ${categoryBreakdown(monthTx)}
        ${recent(key)}
      </div>
    </div>`;
}

export function shiftMonth(step) {
  ui.month = monthKeyAdd(viewMonth(), step);
  if (ui.month === currentMonth()) ui.month = null;
}
