import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  totals, signedAmount, monthlySeries, spendingByCategory, budgetStatus, budgetOverview, accountBalances,
  filterTransactions, groupByDay, sortTransactions, yearReview, goalProgress, compareBudgetRows,
} from '../js/core/stats.js';
import {
  occurrencesBetween, processRecurring, nextDue, monthlyEquivalent, nthOccurrence, MAX_GENERATED_PER_RUN,
} from '../js/core/recurring.js';
import { parseCSV, toCSV, transactionsToCSV, prepareImport, mapHeaders } from '../js/core/csv.js';
import {
  validateTransactionInput, validateCategoryInput, parseBackup, buildBackup, sanitizeTransaction,
} from '../js/core/validate.js';
import { defaultCategories, DEFAULT_SETTINGS, UNCATEGORIZED } from '../js/core/defaults.js';

let seq = 0;
const nextId = () => `id-${String(++seq).padStart(6, '0')}`;
const NOW = '2024-06-15T12:00:00.000Z';

const cats = [
  { id: 'groc', name: 'Groceries', type: 'expense', parentId: null, order: 0, budget: 40000, color: '#3D8B5A', icon: '🛒' },
  { id: 'dine', name: 'Dining Out', type: 'expense', parentId: null, order: 1, budget: 10000, color: '#C4553B', icon: '🍜' },
  { id: 'coffee', name: 'Coffee', type: 'expense', parentId: 'dine', order: 0, budget: 3000, color: '#8C6D3F', icon: '☕' },
  { id: 'fun', name: 'Entertainment', type: 'expense', parentId: null, order: 2, budget: null, color: '#8A5BB0', icon: '🎬' },
  { id: 'pets', name: 'Pets', type: 'expense', parentId: null, order: 3, budget: null, color: '#8A5BB0', icon: '🐾' },
  { id: 'vet', name: 'Vet', type: 'expense', parentId: 'pets', order: 0, budget: 5000, color: '#8A5BB0', icon: '🩺' },
  { id: 'pay', name: 'Income', type: 'income', parentId: null, order: 0, budget: null, color: '#2F8F4E', icon: '💼' },
];

function tx(date, type, amount, categoryId, extra = {}) {
  return { id: nextId(), type, amount, refund: false, categoryId, accountId: null, date, note: '', recurringId: null, planId: null, createdAt: NOW, updatedAt: NOW, ...extra };
}

const june = [
  tx('2024-06-01', 'income', 300000, 'pay', { note: 'Salary' }),
  tx('2024-06-02', 'expense', 12345, 'groc', { note: 'Market' }),
  tx('2024-06-03', 'expense', 4500, 'dine', { note: 'Tacos' }),
  tx('2024-06-03', 'expense', 2800, 'coffee', { note: 'Café Noir' }),
  tx('2024-06-04', 'expense', 1000, 'groc', { refund: true, note: 'Returned milk' }),
  tx('2024-06-05', 'expense', 999, 'fun'),
  tx('2024-06-06', 'expense', 700, 'vet'),
  tx('2024-06-07', 'expense', 500, 'deleted-category'),
];

describe('totals and signs', () => {
  test('income, expenses, refunds and net are exact', () => {
    const t = totals(june);
    assert.equal(t.income, 300000);
    // 12345 + 4500 + 2800 - 1000 + 999 + 700 + 500
    assert.equal(t.expenses, 20844);
    assert.equal(t.net, 279156);
    assert.equal(t.count, 8);
  });

  test('a refund adds money back', () => {
    assert.equal(signedAmount(tx('2024-01-01', 'expense', 500, 'groc', { refund: true })), 500);
    assert.equal(signedAmount(tx('2024-01-01', 'expense', 500, 'groc')), -500);
    assert.equal(signedAmount(tx('2024-01-01', 'income', 500, 'pay')), 500);
  });

  test('empty data gives zeros, not NaN', () => {
    assert.deepEqual(totals([]), { income: 0, expenses: 0, net: 0, count: 0 });
    const series = monthlySeries([], '2024-06', 3);
    assert.deepEqual(series.map((m) => m.key), ['2024-04', '2024-05', '2024-06']);
    assert.ok(series.every((m) => m.income === 0 && m.expenses === 0 && m.net === 0));
  });

  test('many small amounts sum exactly', () => {
    const many = Array.from({ length: 10000 }, (_, i) => tx('2024-06-01', 'expense', 1 + (i % 3), 'groc'));
    assert.equal(totals(many).expenses, 19999);
  });

  test('very large totals stay exact', () => {
    const big = Array.from({ length: 1000 }, () => tx('2024-06-01', 'income', 100_000_000_000, 'pay'));
    assert.equal(totals(big).income, 100_000_000_000_000);
    assert.ok(Number.isSafeInteger(totals(big).income));
  });

  test('monthlySeries buckets across a year boundary', () => {
    const data = [
      tx('2023-12-31', 'expense', 100, 'groc'),
      tx('2024-01-01', 'expense', 200, 'groc'),
      tx('2024-01-15', 'income', 1000, 'pay'),
      tx('2023-10-01', 'expense', 999, 'groc'), // outside window
    ];
    const s = monthlySeries(data, '2024-01', 3);
    assert.deepEqual(s.map((m) => [m.key, m.income, m.expenses, m.net]), [
      ['2023-11', 0, 0, 0],
      ['2023-12', 0, 100, -100],
      ['2024-01', 1000, 200, 800],
    ]);
  });
});

describe('spending by category', () => {
  test('rolls subcategories into parents and keeps unknown categories visible', () => {
    const rows = spendingByCategory(june, cats);
    const byId = Object.fromEntries(rows.map((r) => [r.categoryId, r.amount]));
    assert.equal(byId.groc, 11345);
    assert.equal(byId.dine, 7300);
    assert.equal(byId.fun, 999);
    assert.equal(byId.pets, 700);
    assert.equal(byId[UNCATEGORIZED], 500);
    assert.equal(byId.coffee, undefined);
    assert.equal(rows[0].categoryId, 'groc');
  });

  test('without rollup, subcategories stand alone', () => {
    const byId = Object.fromEntries(spendingByCategory(june, cats, { rollup: false }).map((r) => [r.categoryId, r.amount]));
    assert.equal(byId.dine, 4500);
    assert.equal(byId.coffee, 2800);
  });

  test('refund-only category goes negative rather than disappearing', () => {
    const rows = spendingByCategory([tx('2024-06-01', 'expense', 500, 'fun', { refund: true })], cats);
    assert.deepEqual(rows, [{ categoryId: 'fun', amount: -500 }]);
  });
});

describe('budgets', () => {
  test('budgetStatus thresholds', () => {
    assert.equal(budgetStatus(0, 10000).state, 'ok');
    assert.equal(budgetStatus(7999, 10000).state, 'ok');
    assert.equal(budgetStatus(8000, 10000).state, 'warning');
    assert.equal(budgetStatus(10000, 10000).state, 'warning');
    assert.equal(budgetStatus(10000, 10000).percent, 100);
    assert.equal(budgetStatus(10001, 10000).state, 'over');
    assert.equal(budgetStatus(10001, 10000).percent, 101);
    assert.equal(budgetStatus(9999, 10000).percent, 99);
    assert.equal(budgetStatus(25000, 10000).percent, 250);
    assert.equal(budgetStatus(5000, 10000, 50).state, 'warning');
    assert.equal(budgetStatus(9999, 10000, 100).state, 'ok');
  });

  test('zero and missing budgets never divide by zero', () => {
    assert.deepEqual(budgetStatus(0, 0), { state: 'ok', ratio: 0, percent: 0, remaining: 0 });
    const over = budgetStatus(1, 0);
    assert.equal(over.state, 'over');
    assert.equal(over.remaining, -1);
    assert.equal(over.percent, null);
    assert.equal(budgetStatus(500, null).state, 'none');
    assert.equal(budgetStatus(-500, 1000).ratio, 0);
    assert.equal(budgetStatus(-500, 1000).state, 'ok');
  });

  test('remaining amounts', () => {
    assert.equal(budgetStatus(12345, 40000).remaining, 27655);
    assert.equal(budgetStatus(45000, 40000).remaining, -5000);
  });

  test('budgetOverview for a month', () => {
    const o = budgetOverview(june, cats, '2024-06');
    const row = (id) => o.rows.find((r) => r.categoryId === id);
    assert.equal(row('groc').spent, 11345);
    assert.equal(row('groc').state, 'ok');
    assert.equal(row('dine').spent, 7300); // includes coffee
    assert.equal(row('dine').state, 'ok');
    const coffee = row('dine').children.find((r) => r.categoryId === 'coffee');
    assert.equal(coffee.spent, 2800);
    assert.equal(coffee.state, 'warning');
    // Pets has no budget but its Vet subcategory does.
    assert.equal(row('pets').state, 'none');
    assert.equal(row('pets').children[0].state, 'ok');
    // Overall: groceries + dining (coffee inside dining isn't double counted) + vet.
    assert.equal(o.limit, 40000 + 10000 + 5000);
    assert.equal(o.spent, 11345 + 7300 + 700);
    assert.equal(o.totalExpenses, 20844);
    assert.equal(o.unbudgetedSpent, 999 + 500);
    assert.equal(o.hasBudgets, true);
    assert.equal(o.status.state, 'ok');
    // Income categories without spending are not budget rows.
    assert.equal(row('pay'), undefined);
  });

  test('budgetOverview for a month with no data or no budgets', () => {
    const empty = budgetOverview(june, cats, '2024-07');
    assert.equal(empty.spent, 0);
    assert.equal(empty.totalExpenses, 0);
    assert.ok(empty.rows.every((r) => r.spent === 0));
    const none = budgetOverview(june, cats.map((c) => ({ ...c, budget: null })), '2024-06');
    assert.equal(none.hasBudgets, false);
    assert.equal(none.limit, 0);
    assert.equal(none.status.state, 'none');
    assert.equal(none.unbudgetedSpent, 20844);
  });

  test('sorting puts problems first', () => {
    const rows = [
      { state: 'ok', ratio: 0.2, category: { order: 0 } },
      { state: 'over', ratio: 1.3, category: { order: 3 } },
      { state: 'none', ratio: 0, category: { order: 1 } },
      { state: 'warning', ratio: 0.9, category: { order: 2 } },
    ].sort(compareBudgetRows);
    assert.deepEqual(rows.map((r) => r.state), ['over', 'warning', 'ok', 'none']);
  });
});

describe('accounts and goals', () => {
  test('balances include opening balance and refunds', () => {
    const accounts = [
      { id: 'chk', name: 'Checking', openingBalance: 100000 },
      { id: 'cc', name: 'Card', openingBalance: -25000 },
    ];
    const data = [
      tx('2024-06-01', 'income', 50000, 'pay', { accountId: 'chk' }),
      tx('2024-06-02', 'expense', 2000, 'groc', { accountId: 'cc' }),
      tx('2024-06-03', 'expense', 500, 'groc', { accountId: 'cc', refund: true }),
      tx('2024-06-04', 'expense', 300, 'groc', { accountId: null }),
      tx('2024-06-04', 'expense', 300, 'groc', { accountId: 'gone' }),
    ];
    const { balances, unassigned, total } = accountBalances(accounts, data);
    assert.equal(balances.get('chk'), 150000);
    assert.equal(balances.get('cc'), -26500);
    assert.equal(unassigned, -600);
    assert.equal(total, 123500);
  });

  test('goal progress', () => {
    const g = { target: 120000, saved: 30000, targetDate: '2024-12-01' };
    const p = goalProgress(g, '2024-06-15');
    assert.equal(p.remaining, 90000);
    assert.equal(p.ratio, 0.25);
    assert.equal(p.monthsLeft, 6);
    assert.equal(p.perMonth, 15000);
    assert.equal(p.done, false);
    assert.equal(goalProgress({ target: 100, saved: 150 }, '2024-06-15').done, true);
    assert.equal(goalProgress({ target: 100, saved: 150 }, '2024-06-15').ratio, 1);
    assert.equal(goalProgress({ target: 100, saved: 0, targetDate: '2024-01-01' }, '2024-06-15').overdue, true);
    assert.equal(goalProgress({ target: 100, saved: 0, targetDate: '2024-06-20' }, '2024-06-15').monthsLeft, 1);
  });
});

describe('search, filter and grouping', () => {
  test('keyword search matches notes, category names and amounts, ignoring accents and case', () => {
    assert.equal(filterTransactions(june, { q: 'cafe' }, cats).length, 1);
    assert.equal(filterTransactions(june, { q: 'GROCER' }, cats).length, 2);
    assert.equal(filterTransactions(june, { q: '45.00' }, cats, 4500).length, 1);
  });

  test('category filter includes subcategories', () => {
    assert.equal(filterTransactions(june, { categoryId: 'dine' }, cats).length, 2);
    assert.equal(filterTransactions(june, { categoryId: 'coffee' }, cats).length, 1);
  });

  test('type and date range', () => {
    assert.equal(filterTransactions(june, { type: 'income' }, cats).length, 1);
    assert.equal(filterTransactions(june, { from: '2024-06-03', to: '2024-06-04' }, cats).length, 3);
    assert.equal(filterTransactions(june, { from: '2024-06-03', to: '2024-06-04', type: 'expense', q: 'milk' }, cats).length, 1);
  });

  test('groupByDay computes day nets and running totals', () => {
    const days = groupByDay(sortTransactions(june));
    assert.equal(days[0].date, '2024-06-07');
    assert.equal(days[days.length - 1].date, '2024-06-01');
    const d3 = days.find((d) => d.date === '2024-06-03');
    assert.equal(d3.items.length, 2);
    assert.equal(d3.net, -7300);
    assert.equal(days[days.length - 1].running, 300000);
    assert.equal(days[0].running, totals(june).net);
  });

  test('sort is newest first, then most recently created', () => {
    const a = tx('2024-06-01', 'expense', 1, 'groc', { createdAt: '2024-06-01T08:00:00Z' });
    const b = tx('2024-06-01', 'expense', 2, 'groc', { createdAt: '2024-06-01T09:00:00Z' });
    const c = tx('2024-06-02', 'expense', 3, 'groc', { createdAt: '2024-05-01T00:00:00Z' });
    assert.deepEqual(sortTransactions([a, b, c]).map((t) => t.amount), [3, 2, 1]);
  });
});

describe('year review', () => {
  test('summarizes a year', () => {
    const data = [
      ...june,
      tx('2024-02-10', 'expense', 90000, 'groc', { note: 'Freezer' }),
      tx('2024-02-11', 'income', 10000, 'pay'),
      tx('2023-12-31', 'expense', 999999, 'groc'),
    ];
    const r = yearReview(data, cats, 2024);
    assert.equal(r.income, 310000);
    assert.equal(r.expenses, 110844);
    assert.equal(r.net, 199156);
    assert.equal(r.activeMonths, 2);
    assert.equal(r.averageMonthlyExpenses, 55422);
    assert.equal(r.biggestExpense.note, 'Freezer');
    assert.equal(r.topMonth.key, '2024-02');
    assert.equal(r.categories[0].categoryId, 'groc');
    assert.equal(r.months.length, 12);
    assert.ok(Math.abs(r.savingsRate - 199156 / 310000) < 1e-12);
  });

  test('empty year', () => {
    const r = yearReview([], cats, 2020);
    assert.equal(r.savingsRate, null);
    assert.equal(r.averageMonthlyExpenses, 0);
    assert.equal(r.biggestExpense, null);
    assert.equal(r.topMonth, null);
  });
});

describe('recurring transactions', () => {
  const rule = (extra) => ({
    id: 'rule-1', type: 'expense', amount: 150000, categoryId: 'groc', accountId: null, note: 'Rent',
    frequency: 'monthly', startDate: '2024-01-31', endDate: null, mode: 'auto', paused: false, generatedThrough: null, ...extra,
  });

  test('monthly on the 31st clamps and recovers', () => {
    assert.deepEqual(occurrencesBetween(rule(), null, '2024-05-31'), [
      '2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30', '2024-05-31',
    ]);
  });

  test('weekly, biweekly, quarterly and yearly', () => {
    assert.deepEqual(occurrencesBetween(rule({ frequency: 'weekly', startDate: '2024-02-26' }), null, '2024-03-12'), [
      '2024-02-26', '2024-03-04', '2024-03-11',
    ]);
    assert.deepEqual(occurrencesBetween(rule({ frequency: 'biweekly', startDate: '2024-12-20' }), null, '2025-01-31'), [
      '2024-12-20', '2025-01-03', '2025-01-17', '2025-01-31',
    ]);
    assert.deepEqual(occurrencesBetween(rule({ frequency: 'quarterly', startDate: '2023-11-30' }), null, '2024-08-31'), [
      '2023-11-30', '2024-02-29', '2024-05-30', '2024-08-30',
    ]);
    assert.deepEqual(occurrencesBetween(rule({ frequency: 'yearly', startDate: '2024-02-29' }), null, '2028-03-01'), [
      '2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29',
    ]);
  });

  test('respects the exclusive start, end date and future start', () => {
    assert.deepEqual(occurrencesBetween(rule(), '2024-03-31', '2024-05-31'), ['2024-04-30', '2024-05-31']);
    assert.deepEqual(occurrencesBetween(rule({ endDate: '2024-03-15' }), null, '2024-12-31'), ['2024-01-31', '2024-02-29']);
    assert.deepEqual(occurrencesBetween(rule({ startDate: '2024-07-01' }), null, '2024-06-30'), []);
    assert.equal(nextDue(rule({ endDate: '2024-03-15', generatedThrough: '2024-02-29' })), null);
  });

  test('skip-ahead gives the same answer as a full scan', () => {
    for (const frequency of ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']) {
      const r = rule({ frequency, startDate: '2019-03-31' });
      const full = occurrencesBetween(r, null, '2030-01-01');
      for (const after of ['2019-03-30', '2019-03-31', '2021-07-15', '2024-02-29', '2029-12-31']) {
        assert.deepEqual(occurrencesBetween(r, after, '2030-01-01'), full.filter((d) => d > after), `${frequency} after ${after}`);
      }
    }
  });

  test('automatic rules generate once, even when run repeatedly', () => {
    let rules = [rule()];
    let txs = [];
    const run = (today) => {
      const out = processRecurring(rules, txs, today, nextId, NOW);
      txs = txs.concat(out.newTransactions);
      rules = rules.map((r) => out.updatedRules.find((u) => u.id === r.id) ?? r);
      return out;
    };
    assert.equal(run('2024-03-31').newTransactions.length, 3);
    assert.equal(run('2024-03-31').newTransactions.length, 0);
    assert.equal(run('2024-04-15').newTransactions.length, 0);
    assert.equal(rules[0].generatedThrough, '2024-03-31');
    const april = run('2024-04-30');
    assert.equal(april.newTransactions.length, 1);
    assert.deepEqual(txs.map((t) => t.date), ['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30']);
    const t = txs[0];
    assert.equal(t.amount, 150000);
    assert.equal(t.type, 'expense');
    assert.equal(t.recurringId, 'rule-1');
    assert.equal(t.note, 'Rent');
  });

  test('deleting a generated transaction does not bring it back', () => {
    const r = rule({ generatedThrough: '2024-02-29' });
    const out = processRecurring([r], [], '2024-02-29', nextId, NOW);
    assert.equal(out.newTransactions.length, 0);
  });

  test('duplicate guard protects against a lost generatedThrough update (e.g. two tabs)', () => {
    const existing = [tx('2024-01-31', 'expense', 150000, 'groc', { recurringId: 'rule-1' })];
    const out = processRecurring([rule()], existing, '2024-02-29', nextId, NOW);
    assert.deepEqual(out.newTransactions.map((t) => t.date), ['2024-02-29']);
  });

  test('reminder rules list due dates without creating anything', () => {
    const r = rule({ mode: 'remind', generatedThrough: '2024-01-31' });
    const out = processRecurring([r], [], '2024-04-01', nextId, NOW);
    assert.equal(out.newTransactions.length, 0);
    assert.equal(out.updatedRules.length, 0);
    assert.deepEqual(out.reminders[0].dates, ['2024-02-29', '2024-03-31']);
    assert.equal(nextDue(r), '2024-02-29');
  });

  test('paused rules do nothing', () => {
    const out = processRecurring([rule({ paused: true })], [], '2024-12-31', nextId, NOW);
    assert.equal(out.newTransactions.length + out.reminders.length, 0);
  });

  test('backfill is capped per run and resumes later', () => {
    const r = rule({ frequency: 'weekly', startDate: '1980-01-01' });
    const first = processRecurring([r], [], '2024-06-15', nextId, NOW);
    assert.equal(first.newTransactions.length, MAX_GENERATED_PER_RUN);
    const r2 = first.updatedRules[0];
    const second = processRecurring([r2], first.newTransactions, '2024-06-15', nextId, NOW);
    assert.ok(second.newTransactions.length > 0);
    assert.ok(second.newTransactions[0].date > r2.generatedThrough);
    const all = [...first.newTransactions, ...second.newTransactions];
    assert.equal(new Set(all.map((t) => t.date)).size, all.length);
  });

  test('monthly equivalents', () => {
    assert.equal(monthlyEquivalent(rule({ frequency: 'weekly', amount: 10000 })), 43333);
    assert.equal(monthlyEquivalent(rule({ frequency: 'yearly', amount: 12000 })), 1000);
    assert.equal(monthlyEquivalent(rule({ frequency: 'quarterly', amount: 30000 })), 10000);
    assert.throws(() => nthOccurrence(rule({ frequency: 'daily' }), 1));
  });
});

describe('CSV', () => {
  test('parses quotes, escaped quotes, embedded newlines, CRLF and BOM', () => {
    const text = '\ufeffdate,note,amount\r\n2024-01-01,"Hello, world",1.00\r\n2024-01-02,"She said ""hi""\nthen left",2\n\n';
    assert.deepEqual(parseCSV(text), [
      ['date', 'note', 'amount'],
      ['2024-01-01', 'Hello, world', '1.00'],
      ['2024-01-02', 'She said "hi"\nthen left', '2'],
    ]);
  });

  test('detects semicolon and tab delimiters', () => {
    assert.deepEqual(parseCSV('date;amount\n01.02.2024;"1.234,50"'), [['date', 'amount'], ['01.02.2024', '1.234,50']]);
    assert.deepEqual(parseCSV('date\tamount\n2024-01-01\t5'), [['date', 'amount'], ['2024-01-01', '5']]);
  });

  test('keeps empty quoted fields and trailing empty cells', () => {
    assert.deepEqual(parseCSV('a,b,c\n1,"",\n'), [['a', 'b', 'c'], ['1', '', '']]);
  });

  test('toCSV quotes when needed and guards against spreadsheet formulas', () => {
    const out = toCSV([['a', 'b,c', 'd"e', '=SUM(A1)', '-12.50', '@x', ' pad']]);
    assert.equal(out, 'a,"b,c","d""e",\'=SUM(A1),-12.50,\'@x," pad"\r\n');
  });

  test('export then import round-trips every field', () => {
    const accounts = [{ id: 'acc-1', name: 'Card', kind: 'credit', openingBalance: 0, order: 0 }];
    const data = [
      tx('2024-06-01', 'income', 300000, 'pay', { note: 'Salary, June' }),
      tx('2024-06-02', 'expense', 2800, 'coffee', { note: '=cheeky "note"', accountId: 'acc-1' }),
      tx('2024-06-03', 'expense', 1000, 'groc', { refund: true, note: 'Line one\nline two' }),
    ];
    const csv = transactionsToCSV(data, cats, accounts);
    // Import into an empty ledger that has the same categories and accounts.
    const res = prepareImport(parseCSV(csv), { categories: cats, accounts, transactions: [] }, { makeId: nextId, now: NOW });
    assert.equal(res.fatal, null);
    assert.deepEqual(res.errors, []);
    assert.equal(res.newCategories.length, 0);
    assert.equal(res.newAccounts.length, 0);
    const strip = ({ createdAt, updatedAt, ...rest }) => rest;
    assert.deepEqual(res.transactions.map(strip), data.map(strip));
  });

  test('re-importing the same file skips everything', () => {
    const csv = transactionsToCSV(june, cats, []);
    const res = prepareImport(parseCSV(csv), { categories: cats, accounts: [], transactions: june }, { makeId: nextId, now: NOW });
    assert.equal(res.transactions.length, 0);
    assert.equal(res.duplicates, june.length);
  });

  test('bank-style file: signed amounts, payee + memo, new categories', () => {
    const csv = [
      'Posted Date,Payee,Memo,Category,Amount',
      '06/01/2024,ACME Corp,Payroll,Paycheck,"2,500.00"',
      '06/02/2024,Corner Shop,,Groceries,-45.10',
      '06/02/2024,Corner Shop,,Groceries,-45.10',
      '13/40/2024,Bad Date,,,1',
      '06/03/2024,Nothing,,,0',
      '06/04/2024,Gym,,Fitness,-30',
      '06/05/2024,Mystery,,,-3.333',
    ].join('\n');
    const existing = { categories: cats, accounts: [], transactions: [] };
    const res = prepareImport(parseCSV(csv), existing, { makeId: nextId, now: NOW });
    assert.equal(res.total, 7);
    assert.equal(res.transactions.length, 4);
    assert.deepEqual(res.errors.map((e) => e.line), [5, 6, 8]);
    assert.match(res.errors[0].message, /isn't a date/);
    assert.match(res.errors[2].message, /2 decimal places/);
    const [pay, shop1, shop2, gym] = res.transactions;
    assert.equal(pay.type, 'income');
    assert.equal(pay.amount, 250000);
    assert.equal(pay.note, 'ACME Corp, Payroll');
    assert.equal(shop1.type, 'expense');
    assert.equal(shop1.categoryId, 'groc');
    // Identical rows within one file are both kept (two real purchases).
    assert.equal(shop2.amount, 4510);
    assert.deepEqual(res.newCategories.map((c) => [c.name, c.type]).sort(), [['Fitness', 'expense'], ['Paycheck', 'income']]);
    assert.equal(gym.categoryId, res.newCategories.find((c) => c.name === 'Fitness').id);
  });

  test('positive-means-expense convention and debit/credit columns', () => {
    const existing = { categories: cats, accounts: [], transactions: [] };
    const a = prepareImport(parseCSV('date,amount\n2024-01-01,12.00\n2024-01-02,-3'), existing, { makeId: nextId, now: NOW, positiveIs: 'expense' });
    assert.deepEqual(a.transactions.map((t) => t.type), ['expense', 'income']);
    const b = prepareImport(parseCSV('Date,Debit,Credit\n2024-01-01,12.00,\n2024-01-02,,50'), existing, { makeId: nextId, now: NOW });
    assert.deepEqual(b.transactions.map((t) => [t.type, t.amount]), [['expense', 1200], ['income', 5000]]);
    // Empty category falls back to existing "Income" / creates "Other".
    assert.equal(b.transactions[1].categoryId, 'pay');
    assert.equal(b.newCategories[0].name, 'Other');
  });

  test('type column, refunds, DMY dates and subcategories', () => {
    const csv = 'date,type,amount,category,parent_category,refund\n05/03/2024,expense,-10,Coffee,Dining Out,\n06/03/2024,refund,4,Tea,Dining Out,\n07/03/2024,income,5,,,';
    const res = prepareImport(parseCSV(csv), { categories: cats, accounts: [], transactions: [] }, { makeId: nextId, now: NOW, dateOrder: 'DMY' });
    assert.deepEqual(res.errors, []);
    const [coffee, tea, income] = res.transactions;
    assert.equal(coffee.date, '2024-03-05');
    assert.equal(coffee.type, 'expense');
    assert.equal(coffee.amount, 1000);
    assert.equal(coffee.categoryId, 'coffee');
    assert.equal(tea.refund, true);
    const teaCat = res.newCategories.find((c) => c.name === 'Tea');
    assert.equal(teaCat.parentId, 'dine');
    assert.equal(income.categoryId, 'pay');
  });

  test('missing columns produce a clear, fatal message', () => {
    const existing = { categories: cats, accounts: [], transactions: [] };
    assert.match(prepareImport(parseCSV('amount\n5'), existing, { makeId: nextId, now: NOW }).fatal, /No date column/);
    assert.match(prepareImport(parseCSV('date,note\n2024-01-01,x'), existing, { makeId: nextId, now: NOW }).fatal, /No amount column/);
    assert.match(prepareImport([], existing, { makeId: nextId, now: NOW }).fatal, /empty/);
  });

  test('header aliases', () => {
    const map = mapHeaders(['Transaction Date', 'Description', 'Payee', 'Money Out', 'Money In', 'Account Name']);
    assert.deepEqual(map, { date: 0, note: [1, 2], debit: 3, credit: 4, account: 5 });
  });

  test('unknown account names become new accounts', () => {
    const res = prepareImport(parseCSV('date,amount,account\n2024-01-01,-5,Wallet\n2024-01-02,-6,wallet'), { categories: cats, accounts: [], transactions: [] }, { makeId: nextId, now: NOW });
    assert.equal(res.newAccounts.length, 1);
    assert.equal(res.transactions[0].accountId, res.transactions[1].accountId);
  });
});

describe('validation', () => {
  const ctx = { locale: 'en-US', categories: cats, accounts: [{ id: 'chk', name: 'Checking' }] };
  const base = { type: 'expense', amount: '12.50', categoryId: 'groc', date: '2024-06-01', note: '  Milk  ', accountId: 'chk', refund: false };

  test('accepts a valid transaction and normalizes it', () => {
    const r = validateTransactionInput(base, ctx);
    assert.equal(r.ok, true);
    assert.deepEqual(r.value, { type: 'expense', amount: 1250, refund: false, categoryId: 'groc', date: '2024-06-01', note: 'Milk', accountId: 'chk', planId: null });
  });

  test('explains every problem', () => {
    const r = validateTransactionInput({ type: 'x', amount: '-5', categoryId: '', date: '2024-02-30', note: 'x'.repeat(501) }, ctx);
    assert.equal(r.ok, false);
    assert.deepEqual(Object.keys(r.errors).sort(), ['amount', 'categoryId', 'date', 'note', 'type']);
    assert.match(validateTransactionInput({ ...base, amount: '-5' }, ctx).errors.amount, /turn on Refund/);
    assert.match(validateTransactionInput({ ...base, amount: '0' }, ctx).errors.amount, /greater than zero/);
    assert.match(validateTransactionInput({ ...base, categoryId: 'gone' }, ctx).errors.categoryId, /no longer exists/);
    assert.match(validateTransactionInput({ ...base, date: '1800-01-01' }, ctx).errors.date, /between 1900/);
  });

  test('refund only applies to expenses; unknown accounts are dropped', () => {
    assert.equal(validateTransactionInput({ ...base, type: 'income', categoryId: 'pay', refund: true }, ctx).value.refund, false);
    assert.equal(validateTransactionInput({ ...base, refund: true }, ctx).value.refund, true);
    assert.equal(validateTransactionInput({ ...base, accountId: 'gone' }, ctx).value.accountId, null);
  });

  test('category rules', () => {
    const v = (input) => validateCategoryInput({ locale: 'en-US', ...input }, cats);
    assert.equal(v({ name: '  New   thing ', type: 'expense' }).value.name, 'New thing');
    assert.match(v({ name: 'groceries', type: 'expense' }).errors.name, /already have/);
    assert.equal(v({ name: 'Groceries', type: 'income' }).ok, true);
    assert.equal(v({ id: 'groc', name: 'Groceries', type: 'expense' }).ok, true);
    assert.equal(v({ name: 'Groceries', type: 'expense', parentId: 'dine' }).ok, true);
    assert.match(v({ name: 'x', type: 'expense', parentId: 'coffee' }).errors.parentId, /one level/);
    assert.match(v({ name: 'x', type: 'income', parentId: 'dine' }).errors.parentId, /same type/);
    assert.match(v({ id: 'dine', name: 'Dining Out', type: 'expense', parentId: 'groc' }).errors.parentId, /subcategories/);
    assert.match(v({ name: '', type: 'expense' }).errors.name, /name/);
    assert.equal(v({ name: 'x', type: 'expense', budget: '0' }).value.budget, 0);
    assert.equal(v({ name: 'x', type: 'expense', budget: '' }).value.budget, null);
    assert.match(v({ name: 'x', type: 'expense', budget: '-1' }).errors.budget, /negative/);
    assert.equal(v({ name: 'x', type: 'income', budget: '50' }).value.budget, null);
  });
});

describe('backups', () => {
  const data = {
    settings: { ...DEFAULT_SETTINGS, currency: 'EUR', locale: 'de-DE', theme: 'dark' },
    categories: defaultCategories(nextId),
    accounts: [{ id: 'acc-000001', name: 'Checking', kind: 'checking', openingBalance: -500, order: 0 }],
    transactions: june,
    recurring: [{ id: 'rule-000001', type: 'expense', amount: 100, categoryId: 'groc', accountId: null, note: '', frequency: 'monthly', startDate: '2024-01-01', endDate: null, mode: 'remind', paused: false, generatedThrough: null }],
    goals: [{ id: 'goal-000001', name: 'Trip', kind: 'fund', target: 50000, saved: 1000, targetDate: null, startDate: null, endDate: null, color: '#3D8B5A', createdAt: NOW }],
  };

  test('round trip is lossless', () => {
    const text = JSON.stringify(buildBackup(data, NOW));
    const r = parseBackup(text);
    assert.equal(r.ok, true);
    assert.equal(r.dropped, 0);
    assert.equal(r.exportedAt, NOW);
    assert.deepEqual(r.data, data);
  });

  test('rejects files that are not backups', () => {
    assert.match(parseBackup('not json').error, /valid JSON/);
    assert.match(parseBackup('{"hello":1}').error, /doesn’t look like/);
    assert.match(parseBackup(JSON.stringify({ ...buildBackup(data, NOW), format: 99 })).error, /newer version/);
  });

  test('drops broken records instead of importing them', () => {
    const broken = buildBackup(data, NOW);
    broken.transactions = [
      ...june,
      { id: 'bad-1', type: 'expense', amount: 1.5, date: '2024-01-01' },
      { id: 'bad-2', type: 'expense', amount: -5, date: '2024-01-01' },
      { id: 'bad-3', type: 'gift', amount: 5, date: '2024-01-01' },
      { id: 'bad-4', type: 'expense', amount: 5, date: '2024-02-31' },
      june[0],
      null,
    ];
    broken.categories = [...broken.categories, { id: 'orphan', name: 'Orphan', parentId: 'nope', type: 'expense' }];
    broken.settings = { currency: 'XXXX', theme: 'neon', warnPercent: 5 };
    const r = parseBackup(JSON.stringify(broken));
    assert.equal(r.ok, true);
    assert.equal(r.data.transactions.length, june.length);
    assert.equal(r.dropped, 6);
    assert.equal(r.data.categories.find((c) => c.id === 'orphan').parentId, null);
    assert.equal(r.data.settings.currency, 'USD');
    assert.equal(r.data.settings.theme, 'system');
    assert.equal(r.data.settings.warnPercent, 80);
  });

  test('sanitizeTransaction strips unknown fields', () => {
    const clean = sanitizeTransaction({ ...june[1], evil: '<script>' });
    assert.equal('evil' in clean, false);
  });
});
