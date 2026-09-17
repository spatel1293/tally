import { html } from '../ui/html.js';
import { state } from '../store.js';
import { budgetOverview, compareBudgetRows } from '../core/stats.js';
import { money, badge, month } from '../ui/format.js';
import { progressBar } from '../ui/charts.js';
import { viewMonth, monthSwitcher, emptyState, icons } from './components.js';

function statusText(r) {
  if (r.limit == null) return html`<span class="muted">${r.spent !== 0 ? `${money(r.spent)} spent` : 'No budget'}</span>`;
  if (r.state === 'over') return html`<span class="s-over">${money(-r.remaining)} over</span>`;
  return html`<span class="s-${r.state}">${money(r.remaining)} left</span>`;
}

function row(r, child = false) {
  const hasBudget = r.limit != null;
  const ratio = hasBudget ? (r.limit > 0 ? r.spent / r.limit : r.spent > 0 ? 1 : 0) : 0;
  const pct = r.percent == null ? (r.state === 'over' ? 'Over' : '') : `${r.percent}%`;
  return html`<li class="budget-row ${child ? 'child' : ''} s-${r.state}">
    <button type="button" class="budget-btn" data-action="edit-budget" data-id="${r.categoryId}" aria-label="${hasBudget ? `Change budget for ${r.category.name}` : `Set a budget for ${r.category.name}`}">
      ${badge(r.category, child ? 'sm' : '')}
      <span class="budget-main">
        <span class="budget-top">
          <span class="budget-name">${r.category.name}</span>
          ${statusText(r)}
        </span>
        ${hasBudget
          ? html`${progressBar(ratio, r.state, `${r.category.name}: ${money(r.spent)} of ${money(r.limit)}`)}
            <span class="budget-meta"><span>${money(r.spent)} of ${money(r.limit)}</span><span>${pct}</span></span>`
          : html`<span class="budget-meta"><span class="link-like">Set a budget</span></span>`}
      </span>
    </button>
  </li>`;
}

export function renderBudgets() {
  const key = viewMonth();
  const { warnPercent } = state.settings;
  const o = budgetOverview(state.transactions, state.categories, key, warnPercent);
  const expenseCats = state.categories.filter((c) => c.type === 'expense');
  if (!expenseCats.length) {
    return html`${monthSwitcher(key)}${emptyState({
      title: 'No spending categories yet',
      body: 'Budgets are set per category. Add a category first.',
      actions: html`<button type="button" class="btn primary" data-action="new-category">${icons.plus}Add a category</button>`,
    })}`;
  }

  const withBudget = o.rows.filter((r) => r.limit != null || r.children.some((c) => c.limit != null)).sort((a, b) => compareBudgetRows(pick(a), pick(b)));
  const without = o.rows.filter((r) => !withBudget.includes(r));

  const left = o.limit - o.spent;
  const overallRatio = o.limit > 0 ? o.spent / o.limit : o.spent > 0 ? 1 : 0;
  return html`${monthSwitcher(key)}
    ${o.hasBudgets
      ? html`<section class="panel budget-total">
          <dl class="figures compact">
            <div><dt>Budgeted</dt><dd class="amt">${money(o.limit)}</dd></div>
            <div><dt>Spent</dt><dd class="amt">${money(o.spent)}</dd></div>
            <div><dt>${left >= 0 ? 'Left' : 'Over by'}</dt><dd class="amt s-${o.status.state}">${money(Math.abs(left))}</dd></div>
          </dl>
          ${progressBar(overallRatio, o.status.state, `All budgets for ${month(key)}: ${money(o.spent)} of ${money(o.limit)}`)}
          ${o.unbudgetedSpent !== 0 ? html`<p class="muted small">Another ${money(o.unbudgetedSpent)} went to categories without a budget.</p>` : ''}
        </section>`
      : html`<p class="lede">Give a category a monthly limit and Tally tracks it as you spend. Tap any category below to start.</p>`}

    ${withBudget.length
      ? html`<section aria-labelledby="with-title">
          <h2 class="list-title" id="with-title">Budgeted</h2>
          <ul class="plain-list budget-list">
            ${withBudget.map((r) => html`${row(r)}${r.children.map((c) => row(c, true))}`)}
          </ul>
        </section>`
      : ''}
    ${without.length
      ? html`<section aria-labelledby="without-title">
          <h2 class="list-title" id="without-title">No budget yet</h2>
          <ul class="plain-list budget-list">
            ${without.map((r) => html`${row(r)}${r.children.map((c) => row(c, true))}`)}
          </ul>
        </section>`
      : ''}
    <p class="muted small footnote">Bars turn amber at ${warnPercent}% of a budget and red once you go over. You can change that in <a href="#/settings">Settings</a>. A parent category’s budget includes its subcategories.</p>`;
}

// A parent without its own budget sorts by its most urgent subcategory.
function pick(r) {
  if (r.limit != null) return r;
  return r.children.filter((c) => c.limit != null).sort(compareBudgetRows)[0] ?? r;
}
