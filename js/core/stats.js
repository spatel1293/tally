// Pure money math. Every amount here is integer cents.
//
// A transaction is { id, type: 'income' | 'expense', amount (> 0), refund,
// categoryId, accountId, date, note, recurringId, createdAt, updatedAt }.
// A refund is an expense with refund: true. It reduces spending in its
// category instead of counting as income.

import { monthKeyAdd, isInMonth } from './dates.js';
import { UNCATEGORIZED } from './defaults.js';

export function signedAmount(tx) {
  if (tx.type === 'income') return tx.amount;
  return tx.refund ? tx.amount : -tx.amount;
}

export function expenseAmount(tx) {
  if (tx.type !== 'expense') return 0;
  return tx.refund ? -tx.amount : tx.amount;
}

export function incomeAmount(tx) {
  return tx.type === 'income' ? tx.amount : 0;
}

export function totals(txs) {
  let income = 0;
  let expenses = 0;
  for (const t of txs) {
    income += incomeAmount(t);
    expenses += expenseAmount(t);
  }
  return { income, expenses, net: income - expenses, count: txs.length };
}

export function txsInMonth(txs, key) {
  return txs.filter((t) => isInMonth(t.date, key));
}

export function txsInRange(txs, start, end) {
  return txs.filter((t) => (!start || t.date >= start) && (!end || t.date <= end));
}

// [{ key, income, expenses, net }] for `count` months ending at endKey, oldest first.
export function monthlySeries(txs, endKey, count) {
  const keys = [];
  for (let i = count - 1; i >= 0; i--) keys.push(monthKeyAdd(endKey, -i));
  const rows = new Map(keys.map((key) => [key, { key, income: 0, expenses: 0, net: 0, count: 0 }]));
  for (const t of txs) {
    const row = rows.get(t.date.slice(0, 7));
    if (!row) continue;
    row.income += incomeAmount(t);
    row.expenses += expenseAmount(t);
    row.count += 1;
  }
  for (const row of rows.values()) row.net = row.income - row.expenses;
  return keys.map((k) => rows.get(k));
}

export function categoryMap(categories) {
  return new Map(categories.map((c) => [c.id, c]));
}

export function rootCategoryId(categoryId, catMap) {
  const c = catMap.get(categoryId);
  if (!c) return UNCATEGORIZED;
  return c.parentId && catMap.has(c.parentId) ? c.parentId : c.id;
}

// All ids in a category's family: itself plus its direct children.
export function categoryFamily(categoryId, categories) {
  const ids = new Set([categoryId]);
  for (const c of categories) if (c.parentId === categoryId) ids.add(c.id);
  return ids;
}

// Net spending per category (children rolled into parents by default),
// largest first. Amounts can be negative when refunds exceed spending.
export function spendingByCategory(txs, categories, { rollup = true } = {}) {
  const catMap = categoryMap(categories);
  const acc = new Map();
  for (const t of txs) {
    if (t.type !== 'expense') continue;
    const id = rollup ? rootCategoryId(t.categoryId, catMap) : catMap.has(t.categoryId) ? t.categoryId : UNCATEGORIZED;
    acc.set(id, (acc.get(id) ?? 0) + expenseAmount(t));
  }
  return [...acc]
    .map(([categoryId, amount]) => ({ categoryId, amount }))
    .sort((a, b) => b.amount - a.amount);
}

// state: 'none' (no budget), 'ok', 'warning' (>= warnPercent), 'over' (> limit).
export function budgetStatus(spent, limit, warnPercent = 80) {
  if (limit == null) return { state: 'none', ratio: 0, percent: null, remaining: null };
  const remaining = limit - spent;
  if (limit <= 0) {
    const over = spent > 0;
    return { state: over ? 'over' : 'ok', ratio: over ? 1 : 0, percent: over ? null : 0, remaining };
  }
  const ratio = Math.max(0, spent / limit);
  let state = 'ok';
  if (spent > limit) state = 'over';
  else if (spent * 100 >= limit * warnPercent) state = 'warning';
  // Floor so 99.6% never reads as "100%" while still under the limit.
  const percent = state === 'over' ? Math.max(101, Math.floor(ratio * 100)) : Math.floor(ratio * 100);
  return { state, ratio, percent, remaining };
}

function budgetRow(category, spent, warnPercent, children = []) {
  const limit = category.budget ?? null;
  return { category, categoryId: category.id, spent, limit, children, ...budgetStatus(spent, limit, warnPercent) };
}

const STATE_RANK = { over: 0, warning: 1, ok: 2, none: 3 };
export function compareBudgetRows(a, b) {
  return STATE_RANK[a.state] - STATE_RANK[b.state] || b.ratio - a.ratio || a.category.order - b.category.order;
}

// Budget picture for one month. A parent's budget covers its subcategories.
// A subcategory's own budget is tracked separately and only counts toward
// the overall total when its parent has no budget (no double counting).
export function budgetOverview(txs, categories, key, warnPercent = 80) {
  const monthTx = txsInMonth(txs, key);
  const catMap = categoryMap(categories);
  const own = new Map();
  for (const t of monthTx) {
    if (t.type !== 'expense') continue;
    own.set(t.categoryId, (own.get(t.categoryId) ?? 0) + expenseAmount(t));
  }
  const kidsOf = new Map();
  for (const c of categories) {
    if (c.parentId && catMap.has(c.parentId)) {
      if (!kidsOf.has(c.parentId)) kidsOf.set(c.parentId, []);
      kidsOf.get(c.parentId).push(c);
    }
  }
  const byOrder = (a, b) => a.order - b.order || a.name.localeCompare(b.name);
  const topLevel = categories
    .filter((c) => !(c.parentId && catMap.has(c.parentId)))
    .filter((c) => c.type === 'expense' || own.has(c.id) || c.budget != null)
    .sort(byOrder);

  const rows = [];
  let limit = 0;
  let budgetedSpent = 0;
  let hasBudgets = false;
  for (const parent of topLevel) {
    const kids = (kidsOf.get(parent.id) ?? []).slice().sort(byOrder);
    const kidRows = kids.map((k) => budgetRow(k, own.get(k.id) ?? 0, warnPercent));
    const rolled = (own.get(parent.id) ?? 0) + kidRows.reduce((s, r) => s + r.spent, 0);
    rows.push(budgetRow(parent, rolled, warnPercent, kidRows));
    if (parent.budget != null) {
      hasBudgets = true;
      limit += parent.budget;
      budgetedSpent += rolled;
    } else {
      for (const kr of kidRows) {
        if (kr.limit == null) continue;
        hasBudgets = true;
        limit += kr.limit;
        budgetedSpent += kr.spent;
      }
    }
  }
  const { expenses } = totals(monthTx);
  return {
    rows,
    hasBudgets,
    limit,
    spent: budgetedSpent,
    unbudgetedSpent: expenses - budgetedSpent,
    totalExpenses: expenses,
    status: hasBudgets ? budgetStatus(budgetedSpent, limit, warnPercent) : budgetStatus(0, null),
  };
}

// Balance = opening balance + income - expenses + refunds, per account.
export function accountBalances(accounts, txs) {
  const balances = new Map(accounts.map((a) => [a.id, a.openingBalance ?? 0]));
  let unassigned = 0;
  for (const t of txs) {
    if (balances.has(t.accountId)) balances.set(t.accountId, balances.get(t.accountId) + signedAmount(t));
    else unassigned += signedAmount(t);
  }
  let total = 0;
  for (const v of balances.values()) total += v;
  return { balances, unassigned, total };
}

export function sortTransactions(txs) {
  return txs.slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    const ca = a.createdAt ?? '';
    const cb = b.createdAt ?? '';
    return ca < cb ? 1 : ca > cb ? -1 : 0;
  });
}

function normalizeText(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// filter: { q, type, categoryId, from, to, accountId }. `amountQuery` is the
// parsed cents value of q when q looks like a number, so "12.50" finds it.
export function filterTransactions(txs, filter, categories, amountQuery = null) {
  const q = normalizeText(filter.q).trim();
  const family = filter.categoryId ? categoryFamily(filter.categoryId, categories) : null;
  const names = new Map(categories.map((c) => [c.id, normalizeText(c.name)]));
  return txs.filter((t) => {
    if (filter.type && t.type !== filter.type) return false;
    if (family && !family.has(t.categoryId)) return false;
    if (filter.accountId && t.accountId !== filter.accountId) return false;
    if (filter.from && t.date < filter.from) return false;
    if (filter.to && t.date > filter.to) return false;
    if (q) {
      const inNote = normalizeText(t.note).includes(q);
      const inCategory = (names.get(t.categoryId) ?? '').includes(q);
      const amountHit = amountQuery != null && t.amount === amountQuery;
      if (!inNote && !inCategory && !amountHit) return false;
    }
    return true;
  });
}

// Groups newest-first transactions by day and attaches a running total:
// the cumulative net of the given list up to and including that day.
export function groupByDay(sortedDesc) {
  const days = [];
  for (const t of sortedDesc) {
    const last = days[days.length - 1];
    if (last && last.date === t.date) last.items.push(t);
    else days.push({ date: t.date, items: [t], net: 0, running: 0 });
  }
  for (const d of days) d.net = d.items.reduce((s, t) => s + signedAmount(t), 0);
  let running = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    running += days[i].net;
    days[i].running = running;
  }
  return days;
}

export function yearsWithData(txs) {
  const years = new Set();
  for (const t of txs) years.add(Number(t.date.slice(0, 4)));
  return [...years].sort((a, b) => b - a);
}

export function yearReview(txs, categories, year) {
  const prefix = `${year}-`;
  const yearTx = txs.filter((t) => t.date.startsWith(prefix));
  const sum = totals(yearTx);
  const months = monthlySeries(yearTx, `${year}-12`, 12);
  const activeMonths = months.filter((m) => m.count > 0).length;
  const categoriesRanked = spendingByCategory(yearTx, categories).filter((r) => r.amount > 0);
  let biggestExpense = null;
  for (const t of yearTx) {
    if (t.type === 'expense' && !t.refund && (!biggestExpense || t.amount > biggestExpense.amount)) biggestExpense = t;
  }
  let topMonth = null;
  for (const m of months) if (m.expenses > 0 && (!topMonth || m.expenses > topMonth.expenses)) topMonth = m;
  return {
    year,
    ...sum,
    months,
    activeMonths,
    averageMonthlyExpenses: activeMonths ? Math.round(sum.expenses / activeMonths) : 0,
    savingsRate: sum.income > 0 ? sum.net / sum.income : null,
    categories: categoriesRanked,
    biggestExpense,
    topMonth,
  };
}

// How often each category was used recently, for ordering quick-add chips.
export function categoryUsage(txs, sinceISO) {
  const counts = new Map();
  for (const t of txs) {
    if (sinceISO && t.date < sinceISO) continue;
    counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1);
  }
  return counts;
}

export function goalProgress(goal, todayIso) {
  const saved = goal.saved ?? 0;
  const remaining = Math.max(0, goal.target - saved);
  const ratio = goal.target > 0 ? Math.min(1, Math.max(0, saved / goal.target)) : 0;
  let monthsLeft = null;
  let perMonth = null;
  if (goal.targetDate && remaining > 0 && goal.targetDate > todayIso) {
    const [ty, tm] = goal.targetDate.split('-').map(Number);
    const [cy, cm] = todayIso.split('-').map(Number);
    monthsLeft = Math.max(1, (ty - cy) * 12 + (tm - cm));
    perMonth = Math.ceil(remaining / monthsLeft);
  }
  return { saved, remaining, ratio, done: saved >= goal.target, monthsLeft, perMonth, overdue: Boolean(goal.targetDate && goal.targetDate < todayIso && remaining > 0) };
}
