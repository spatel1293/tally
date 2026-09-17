import { html, mount, $ } from '../ui/html.js';
import { state, sortedTransactions } from '../store.js';
import { filterTransactions, groupByDay, totals } from '../core/stats.js';
import { parseAmount } from '../core/money.js';
import { monthKey, monthKeyAdd, monthRange, isValidISODate } from '../core/dates.js';
import { money, month, relativeDay, plural, netMoney } from '../ui/format.js';
import { pageHead, emptyState, txRow, icons, currentMonth } from './components.js';

const PAGE = 250;

export const filters = {
  q: '',
  type: '',
  categoryId: '',
  accountId: '',
  range: 'all',
  from: '',
  to: '',
  limit: PAGE,
};

const RANGES = {
  all: 'Any time',
  'this-month': 'This month',
  'last-month': 'Last month',
  '3m': 'Last 3 months',
  '12m': 'Last 12 months',
  year: 'This year',
  custom: 'Pick dates',
};

function rangeDates() {
  const cur = currentMonth();
  switch (filters.range) {
    case 'this-month':
      return monthRange(cur);
    case 'last-month':
      return monthRange(monthKeyAdd(cur, -1));
    case '3m':
      return { start: monthRange(monthKeyAdd(cur, -2)).start, end: null };
    case '12m':
      return { start: monthRange(monthKeyAdd(cur, -11)).start, end: null };
    case 'year':
      return { start: `${state.today.slice(0, 4)}-01-01`, end: `${state.today.slice(0, 4)}-12-31` };
    case 'custom':
      return { start: isValidISODate(filters.from) ? filters.from : null, end: isValidISODate(filters.to) ? filters.to : null };
    default:
      return { start: null, end: null };
  }
}

export function isFiltered() {
  return Boolean(filters.q.trim() || filters.type || filters.categoryId || filters.accountId || filters.range !== 'all');
}

export function resetFilters() {
  Object.assign(filters, { q: '', type: '', categoryId: '', accountId: '', range: 'all', from: '', to: '', limit: PAGE });
}

function categoryOptions() {
  const group = (type, label) => {
    const tops = state.categories.filter((c) => c.type === type && !c.parentId);
    return html`<optgroup label="${label}">${tops.map((c) => html`
      <option value="${c.id}" ${filters.categoryId === c.id ? 'selected' : ''}>${c.icon} ${c.name}</option>
      ${state.categories.filter((k) => k.parentId === c.id).map((k) => html`<option value="${k.id}" ${filters.categoryId === k.id ? 'selected' : ''}>\u2003${k.icon} ${k.name}</option>`)}`)}
    </optgroup>`;
  };
  return html`<option value="">All categories</option>${group('expense', 'Spending')}${group('income', 'Income')}`;
}

function controls() {
  return html`<form class="filters" role="search" data-filters onsubmit="return false">
    <label class="search">
      ${icons.search}
      <span class="sr-only">Search</span>
      <input type="search" name="q" id="activity-search" value="${filters.q}" placeholder="Search notes, categories or amounts" autocomplete="off" enterkeyhint="search" />
    </label>
    <div class="filter-row">
      <label><span class="sr-only">Type</span>
        <select name="type">
          <option value="" ${!filters.type ? 'selected' : ''}>All types</option>
          <option value="expense" ${filters.type === 'expense' ? 'selected' : ''}>Spending</option>
          <option value="income" ${filters.type === 'income' ? 'selected' : ''}>Income</option>
        </select>
      </label>
      <label><span class="sr-only">Category</span><select name="categoryId">${categoryOptions()}</select></label>
      <label><span class="sr-only">Dates</span>
        <select name="range">${Object.entries(RANGES).map(([k, label]) => html`<option value="${k}" ${filters.range === k ? 'selected' : ''}>${label}</option>`)}</select>
      </label>
      ${state.accounts.length
        ? html`<label><span class="sr-only">Account</span><select name="accountId">
            <option value="">All accounts</option>
            ${state.accounts.map((a) => html`<option value="${a.id}" ${filters.accountId === a.id ? 'selected' : ''}>${a.name}</option>`)}
          </select></label>`
        : ''}
    </div>
    <div class="filter-row custom-range" ${filters.range === 'custom' ? '' : 'hidden'}>
      <label class="field inline"><span class="label">From</span><input type="date" name="from" value="${filters.from}" /></label>
      <label class="field inline"><span class="label">To</span><input type="date" name="to" value="${filters.to}" /></label>
    </div>
  </form>`;
}

function results() {
  const all = sortedTransactions();
  if (!all.length) {
    return emptyState({
      title: 'No transactions yet',
      body: 'Everything you log shows up here, newest first, grouped by day.',
      actions: html`<button type="button" class="btn primary" data-action="new-tx">${icons.plus}Add a transaction</button>
        <button type="button" class="btn" data-action="import-csv">Import a CSV file</button>`,
    });
  }
  const { start, end } = rangeDates();
  const amountQuery = (() => {
    const q = filters.q.trim();
    if (!/\d/.test(q)) return null;
    const p = parseAmount(q, { locale: state.settings.locale });
    return p.ok ? p.cents : null;
  })();
  const matched = isFiltered()
    ? filterTransactions(all, { ...filters, from: start, to: end }, state.categories, amountQuery)
    : all;
  if (!matched.length) {
    return html`<div class="empty small">
      <h2>No matches</h2>
      <p>Nothing matches these filters. Try a different word or a wider date range.</p>
      <button type="button" class="btn" data-action="clear-filters">Clear filters</button>
    </div>`;
  }

  const sum = totals(matched);
  const days = groupByDay(matched);
  const monthTotals = new Map();
  for (const t of matched) {
    const k = monthKey(t.date);
    if (!monthTotals.has(k)) monthTotals.set(k, []);
    monthTotals.get(k).push(t);
  }

  let rows = 0;
  const shownDays = [];
  for (const d of days) {
    if (rows >= filters.limit) break;
    shownDays.push(d);
    rows += d.items.length;
  }
  const groups = [];
  for (const d of shownDays) {
    const k = monthKey(d.date);
    const last = groups[groups.length - 1];
    if (last && last.key === k) last.days.push(d);
    else groups.push({ key: k, days: [d] });
  }

  return html`<div class="summary-bar">
      <span><strong>${plural(matched.length, 'transaction')}</strong>${isFiltered() ? ' match' : ''}</span>
      <span>In <span class="amt amt-in">${money(sum.income)}</span></span>
      <span>Out <span class="amt">${money(sum.expenses)}</span></span>
      <span>Net ${netMoney(sum.net)}</span>
      ${isFiltered() ? html`<button type="button" class="link-btn" data-action="clear-filters">Clear filters</button>` : ''}
    </div>
    ${groups.map((g) => {
      const mt = totals(monthTotals.get(g.key));
      return html`<section class="month-group" aria-label="${month(g.key)}">
        <header class="group-head">
          <h2>${month(g.key)}</h2>
          <span class="group-totals"><span>In ${money(mt.income)}</span><span>Out ${money(mt.expenses)}</span><span>Net ${netMoney(mt.net)}</span></span>
        </header>
        ${g.days.map((d) => html`<div class="day">
          <h3 class="day-head">
            <span class="day-name">${relativeDay(d.date)}</span>
            <span class="day-nums">${netMoney(d.net)}<span class="running" title="Sum of the transactions listed, from the oldest up to this day">Running total ${money(d.running)}</span></span>
          </h3>
          <ul class="tx-list">${d.items.map(txRow)}</ul>
        </div>`)}
      </section>`;
    })}
    ${rows < matched.length
      ? html`<div class="more-row"><button type="button" class="btn" data-action="show-more">Show more (${plural(matched.length - rows, 'transaction')} left)</button></div>`
      : ''}`;
}

export function renderActivity() {
  return html`${pageHead('Activity', html`<button type="button" class="btn primary desktop-only" data-action="new-tx">${icons.plus}Add</button>`)}
    ${state.transactions.length ? controls() : ''}
    <div id="activity-results" aria-live="polite">${results()}</div>`;
}

export function afterActivityMount(root) {
  const form = root.querySelector('[data-filters]');
  if (!form) return;
  let timer;
  const refresh = () => {
    filters.limit = PAGE;
    mount($('#activity-results', root), results());
  };
  form.addEventListener('input', (e) => {
    const { name, value } = e.target;
    if (!(name in filters)) return;
    filters[name] = value;
    if (name === 'range') form.querySelector('.custom-range').hidden = value !== 'custom';
    clearTimeout(timer);
    timer = setTimeout(refresh, name === 'q' ? 120 : 0);
  });
}

export function refreshActivityResults() {
  const host = document.getElementById('activity-results');
  if (host) mount(host, results());
}

export function showMore() {
  filters.limit += PAGE;
  refreshActivityResults();
}
