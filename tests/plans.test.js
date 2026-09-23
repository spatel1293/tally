import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  planSpend, planProgress, monthlySurplus, planOrder, projectPlans, requiredMonthly, PLAN_KINDS,
} from '../js/core/plans.js';
import { parseBackup, buildBackup, sanitizeGoal, validateTransactionInput } from '../js/core/validate.js';
import { BACKUP_FORMAT, DEFAULT_SETTINGS } from '../js/core/defaults.js';

const TODAY = '2026-09-19';

const plan = (over = {}) => ({
  id: 'p1',
  name: 'Japan',
  kind: 'trip',
  target: 500000,
  saved: 200000,
  targetDate: null,
  startDate: null,
  endDate: null,
  color: '#1F4E8C',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const tx = (over = {}) => ({
  id: 't' + Math.random().toString(36).slice(2),
  type: 'expense',
  amount: 1000,
  refund: false,
  categoryId: 'c1',
  accountId: null,
  date: TODAY,
  note: '',
  planId: null,
  ...over,
});

describe('plan spending', () => {
  test('only counts transactions charged to that plan', () => {
    const txs = [tx({ amount: 50000, planId: 'p1' }), tx({ amount: 9900, planId: 'other' }), tx({ amount: 700 })];
    assert.equal(planSpend(txs, 'p1'), 50000);
  });

  test('a refund on a plan gives the money back to the pot', () => {
    const txs = [tx({ amount: 50000, planId: 'p1' }), tx({ amount: 20000, planId: 'p1', refund: true })];
    assert.equal(planSpend(txs, 'p1'), 30000);
  });

  test('income tagged to a plan is ignored, because a plan is filled by setting money aside', () => {
    const txs = [tx({ type: 'income', amount: 80000, planId: 'p1' })];
    assert.equal(planSpend(txs, 'p1'), 0);
  });

  test('progress separates the pot from what has come out of it', () => {
    const p = planProgress(plan(), [tx({ amount: 75000, planId: 'p1' })], TODAY);
    assert.equal(p.saved, 200000);
    assert.equal(p.spent, 75000);
    assert.equal(p.available, 125000);
    assert.equal(p.toSave, 300000);
    assert.equal(p.overspent, false);
  });

  test('spending more than the pot holds is flagged', () => {
    const p = planProgress(plan(), [tx({ amount: 250000, planId: 'p1' })], TODAY);
    assert.equal(p.available, -50000);
    assert.equal(p.overspent, true);
  });

  test('a plan with a zero target never divides by zero', () => {
    const p = planProgress(plan({ target: 0, saved: 0 }), [], TODAY);
    assert.equal(p.ratio, 0);
    assert.equal(p.spentRatio, 0);
    assert.equal(p.toSave, 0);
  });
});

describe('monthly surplus', () => {
  // Three whole months before September 2026, plus a part-finished September
  // that must not be counted.
  const txs = [
    tx({ type: 'income', amount: 400000, date: '2026-06-10' }),
    tx({ amount: 300000, date: '2026-06-12' }),
    tx({ type: 'income', amount: 400000, date: '2026-07-10' }),
    tx({ amount: 250000, date: '2026-07-12' }),
    tx({ type: 'income', amount: 400000, date: '2026-08-10' }),
    tx({ amount: 380000, date: '2026-08-12' }),
    tx({ type: 'income', amount: 400000, date: '2026-09-02' }),
  ];

  test('uses whole months only, so a part-finished month cannot skew it', () => {
    const s = monthlySurplus(txs, TODAY, 6);
    assert.equal(s.monthsUsed, 3);
    assert.ok(!s.months.some((m) => m.key === '2026-09'));
  });

  test('typical is the median, so one unusual month does not set the expectation', () => {
    const s = monthlySurplus(txs, TODAY, 6);
    // Nets are 100000, 150000, 20000 → median 100000, mean 90000.
    assert.equal(s.typical, 100000);
    assert.equal(s.average, 90000);
    assert.equal(s.best, 150000);
    assert.equal(s.worst, 20000);
  });

  test('no history at all is zero rather than a crash', () => {
    const s = monthlySurplus([], TODAY, 6);
    assert.equal(s.monthsUsed, 0);
    assert.equal(s.typical, 0);
    assert.equal(s.average, 0);
  });
});

describe('ordering', () => {
  test('soonest date first, undated last, ties broken by age', () => {
    const plans = [
      plan({ id: 'c', targetDate: null, createdAt: '2026-01-01T00:00:00.000Z' }),
      plan({ id: 'b', targetDate: '2027-06-01' }),
      plan({ id: 'a', targetDate: '2026-12-01' }),
      plan({ id: 'd', targetDate: null, createdAt: '2025-01-01T00:00:00.000Z' }),
    ];
    assert.deepEqual(planOrder(plans).map((p) => p.id), ['a', 'b', 'd', 'c']);
  });
});

describe('projection', () => {
  const emergency = plan({ id: 'e', name: 'Emergency', kind: 'fund', target: 300000, saved: 100000, targetDate: '2027-01-01' });
  const japan = plan({ id: 'j', name: 'Japan', target: 400000, saved: 0, targetDate: '2027-06-01' });

  test('fills plans in order, one month at a time', () => {
    const r = projectPlans([emergency, japan], [], { monthly: 100000, todayIso: TODAY });
    // Emergency needs 200000 → two months (Oct, Nov 2026).
    assert.equal(r.rows[0].fundedKey, '2026-11');
    assert.equal(r.rows[0].monthsAway, 2);
    // Japan then needs 400000 → four more months.
    assert.equal(r.rows[1].fundedKey, '2027-03');
    assert.equal(r.allFundedKey, '2027-03');
    assert.equal(r.unfunded.length, 0);
    assert.equal(r.late.length, 0);
  });

  test('says which plans miss their date', () => {
    const r = projectPlans([emergency, japan], [], { monthly: 25000, todayIso: TODAY });
    assert.equal(r.rows[0].onTime, false);
    assert.equal(r.late.length, 2);
  });

  test('a lump sum now moves every date forward', () => {
    const without = projectPlans([emergency, japan], [], { monthly: 100000, todayIso: TODAY });
    const withLump = projectPlans([emergency, japan], [], { monthly: 100000, lumpSum: 200000, todayIso: TODAY });
    assert.equal(withLump.rows[0].fundedKey, '2026-09');
    assert.equal(withLump.rows[0].monthsAway, 0);
    assert.ok(withLump.rows[1].fundedKey < withoutFunded(without));
  });

  const withoutFunded = (r) => r.rows[1].fundedKey;

  test('nothing going in means nothing ever fills up', () => {
    const r = projectPlans([emergency, japan], [], { monthly: 0, todayIso: TODAY });
    assert.equal(r.unfunded.length, 2);
    assert.equal(r.allFundedKey, null);
  });

  test('an already funded plan is done today and takes none of the money', () => {
    const done = plan({ id: 'done', target: 100000, saved: 100000, targetDate: '2027-01-01' });
    const r = projectPlans([done, japan], [], { monthly: 100000, todayIso: TODAY });
    assert.equal(r.rows.find((x) => x.plan.id === 'done').monthsAway, 0);
    assert.equal(r.rows.find((x) => x.plan.id === 'j').fundedKey, '2027-01');
  });

  test('a tiny amount against a huge target gives up instead of looping for ever', () => {
    const huge = plan({ id: 'h', target: 100000000, saved: 0, targetDate: null });
    const r = projectPlans([huge], [], { monthly: 100, todayIso: TODAY });
    assert.equal(r.unfunded.length, 1);
  });

  test('money already spent on a trip does not count as saved toward it', () => {
    const spent = [tx({ amount: 100000, planId: 'j' })];
    const r = projectPlans([japan], spent, { monthly: 100000, todayIso: TODAY });
    // Still 400000 to save: spending drains the pot, it doesn't fill it.
    assert.equal(r.rows[0].monthsAway, 4);
  });

  test('required monthly adds up only the dated plans', () => {
    const undated = plan({ id: 'u', target: 999999, saved: 0, targetDate: null });
    const needed = requiredMonthly([emergency, japan, undated], [], TODAY);
    // Emergency: 200000 over 4 months; Japan: 400000 over 9 months.
    assert.equal(needed, 50000 + Math.ceil(400000 / 9));
  });
});

describe('stored shape', () => {
  test('a plan without a kind reads as a nest egg, so older backups still load', () => {
    const clean = sanitizeGoal({ id: 'g1', name: 'Rainy day', target: 100000, saved: 0 });
    assert.equal(clean.kind, 'fund');
    assert.equal(clean.startDate, null);
  });

  test('a trip keeps its dates, and an impossible range is dropped rather than kept', () => {
    const ok = sanitizeGoal({ id: 'g2', name: 'Japan', kind: 'trip', target: 100000, startDate: '2027-04-01', endDate: '2027-04-14' });
    assert.equal(ok.endDate, '2027-04-14');
    const bad = sanitizeGoal({ id: 'g3', name: 'Japan', kind: 'trip', target: 100000, startDate: '2027-04-14', endDate: '2027-04-01' });
    assert.equal(bad.endDate, null);
  });

  test('a format 1 backup, written before plans existed, still restores', () => {
    const old = JSON.stringify({
      app: 'Tally',
      format: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      settings: DEFAULT_SETTINGS,
      categories: [{ id: 'c1', name: 'Groceries', type: 'expense', order: 0 }],
      accounts: [],
      transactions: [{ id: 't1', type: 'expense', amount: 500, date: '2026-01-01', categoryId: 'c1' }],
      recurring: [],
      goals: [{ id: 'g1', name: 'Rainy day', target: 100000, saved: 2500 }],
    });
    const parsed = parseBackup(old);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.data.goals[0].kind, 'fund');
    assert.equal(parsed.data.goals[0].saved, 2500);
    assert.equal(parsed.data.transactions[0].planId, null);
  });

  test('the current format round-trips a trip and a charged transaction', () => {
    const data = {
      settings: DEFAULT_SETTINGS,
      categories: [{ id: 'c1', name: 'Groceries', type: 'expense', order: 0 }],
      accounts: [],
      transactions: [{ id: 't1', type: 'expense', amount: 500, date: '2026-01-01', categoryId: 'c1', planId: 'g1' }],
      recurring: [],
      goals: [{ id: 'g1', name: 'Japan', kind: 'trip', target: 100000, saved: 0, startDate: '2027-04-01' }],
    };
    const backup = buildBackup(data, '2026-09-19T00:00:00.000Z');
    assert.equal(backup.format, BACKUP_FORMAT);
    const parsed = parseBackup(JSON.stringify(backup));
    assert.equal(parsed.ok, true);
    assert.equal(parsed.data.transactions[0].planId, 'g1');
    assert.equal(parsed.data.goals[0].kind, 'trip');
  });
});

describe('charging a transaction to a plan', () => {
  const cats = [{ id: 'c1', name: 'Travel', type: 'expense', parentId: null, order: 0 }];
  const plans = [{ id: 'g1', name: 'Japan' }];
  const input = (over = {}) => ({ type: 'expense', amount: '42.00', categoryId: 'c1', date: TODAY, note: '', planId: 'g1', ...over });

  test('an expense keeps the plan it was charged to', () => {
    const r = validateTransactionInput(input(), { locale: 'en-US', categories: cats, accounts: [], plans });
    assert.equal(r.ok, true);
    assert.equal(r.value.planId, 'g1');
  });

  test('income cannot belong to a plan', () => {
    const r = validateTransactionInput(input({ type: 'income' }), { locale: 'en-US', categories: cats, accounts: [], plans });
    assert.equal(r.value.planId, null);
  });

  test('a plan that no longer exists is dropped instead of dangling', () => {
    const r = validateTransactionInput(input({ planId: 'deleted' }), { locale: 'en-US', categories: cats, accounts: [], plans });
    assert.equal(r.value.planId, null);
  });

  test('leaving it out is fine', () => {
    const r = validateTransactionInput(input({ planId: '' }), { locale: 'en-US', categories: cats, accounts: [], plans: [] });
    assert.equal(r.value.planId, null);
  });
});

test('plan kinds are named for people, not for the database', () => {
  assert.equal(PLAN_KINDS.fund, 'Nest egg');
  assert.equal(PLAN_KINDS.trip, 'Trip');
});

// ---------- Savings first: yield, shares, runway, milestones ----------

import { growMonthly, allocate, projectGrowth, milestones, runway, essentialMonthly, safetyPlan, BP } from '../js/core/plans.js';
import { advisorReview } from '../js/core/advisor.js';

describe('growth', () => {
  test('one month of yield is rounded to whole cents every month', () => {
    // $10,000 at 4.25%: 10000 * 0.0425 / 12 = 35.4166… → 3542 cents
    assert.equal(growMonthly(1000000, 425), 3542);
    assert.equal(growMonthly(0, 425), 0);
    assert.equal(growMonthly(1000000, 0), 0);
    assert.equal(growMonthly(-5, 425), 0);
  });

  test('a year of contributions compounds the way a savings account posts', () => {
    // Growth first, then the deposit, twelve times; every step an integer.
    const series = projectGrowth(100000, 10000, 1200, 12);
    assert.equal(series.length, 12);
    assert.equal(series[0], 100000 + 1000 + 10000);
    for (const v of series) assert.ok(Number.isInteger(v));
    assert.ok(series[11] > 100000 + 12 * 10000, 'yield adds something over the year');
    assert.ok(series[11] < 100000 + 12 * 10000 + (100000 + 120000) * 0.13, 'but no more than 12% on everything that was ever in it');
  });

  test('no yield is plain addition', () => {
    assert.deepEqual(projectGrowth(0, 500, 0, 3), [500, 1000, 1500]);
  });
});

describe('shares of the surplus', () => {
  const plans = [plan({ id: 'a', allocBp: 6875 }), plan({ id: 'b', allocBp: 937 }), plan({ id: 'c', allocBp: 0 })];

  test('each plan gets its share, floored, and the rest is reported', () => {
    const r = allocate(plans, 160000);
    assert.equal(r.byPlan.get('a'), 110000);
    assert.equal(r.byPlan.get('b'), 14992);
    assert.equal(r.byPlan.get('c'), 0);
    assert.equal(r.allocated, 124992);
    assert.equal(r.unallocated, 160000 - 124992);
    assert.equal(r.sharedBp, 7812);
  });

  test('a negative surplus allocates nothing', () => {
    const r = allocate(plans, -500);
    assert.equal(r.allocated, 0);
    assert.equal(r.unallocated, 0);
  });

  test('shares never add up to more than the surplus, whatever the basis points say', () => {
    const r = allocate([plan({ id: 'a', allocBp: 10000 }), plan({ id: 'b', allocBp: 10000 })], 999);
    assert.ok(r.byPlan.get('a') + r.byPlan.get('b') <= 999 * 2);
    assert.equal(r.byPlan.get('a'), 999);
  });
});

describe('projection with shares and yield', () => {
  test('a plan with a share fills from its share, not from the pour', () => {
    // Two plans, both undated. With no shares, the first in order takes
    // everything; with shares, each takes its own.
    const a = plan({ id: 'a', name: 'A', kind: 'fund', target: 60000, saved: 0, createdAt: '2026-01-01', allocBp: 5000 });
    const b = plan({ id: 'b', name: 'B', kind: 'fund', target: 60000, saved: 0, createdAt: '2026-02-01', allocBp: 5000 });
    const r = projectPlans([a, b], [], { monthly: 20000, todayIso: TODAY });
    const row = (id) => r.rows.find((x) => x.plan.id === id);
    assert.equal(row('a').monthsAway, 6);
    assert.equal(row('b').monthsAway, 6);
    const plain = projectPlans([{ ...a, allocBp: 0 }, { ...b, allocBp: 0 }], [], { monthly: 20000, todayIso: TODAY });
    assert.equal(plain.rows.find((x) => x.plan.id === 'a').monthsAway, 3);
    assert.equal(plain.rows.find((x) => x.plan.id === 'b').monthsAway, 6);
  });

  test('a share a plan does not need goes back into the pour', () => {
    const a = plan({ id: 'a', kind: 'fund', target: 1000, saved: 0, createdAt: '2026-01-01', allocBp: 9000 });
    const b = plan({ id: 'b', kind: 'fund', target: 100000, saved: 0, createdAt: '2026-02-01', allocBp: 1000 });
    const r = projectPlans([a, b], [], { monthly: 10000, todayIso: TODAY });
    // B gets its 10% plus everything A didn't need: 10000 a month in total
    // after the first, so 100000 takes 10 months, give or take A's 1000.
    assert.equal(r.rows.find((x) => x.plan.id === 'b').monthsAway, 11);
  });

  test('yield shortens the wait', () => {
    const slow = projectPlans([plan({ id: 'a', kind: 'fund', target: 2000000, saved: 1000000, apyBp: 0 })], [], { monthly: 20000, todayIso: TODAY });
    const fast = projectPlans([plan({ id: 'a', kind: 'fund', target: 2000000, saved: 1000000, apyBp: 500 })], [], { monthly: 20000, todayIso: TODAY });
    assert.ok(fast.rows[0].monthsAway < slow.rows[0].monthsAway);
    assert.equal(slow.rows[0].monthsAway, 50);
  });
});

describe('milestones', () => {
  test('year-end balances for every plan, and the total across them', () => {
    const plans = [plan({ id: 'a', kind: 'safety', saved: 1100000, apyBp: 350, allocBp: 6875 }), plan({ id: 'b', kind: 'invest', saved: 0, apyBp: 700, allocBp: 937 })];
    const m = milestones(plans, 160000, { years: 5 });
    assert.equal(m.rows.length, 2);
    assert.equal(m.rows[0].yearEnds.length, 5);
    assert.equal(m.rows[0].monthly, 110000);
    assert.ok(m.rows[0].yearEnds[0] > 1100000 + 12 * 110000, 'year one includes yield');
    assert.ok(m.rows[0].yearEnds[4] > m.rows[0].yearEnds[3]);
    assert.equal(m.totals[2], m.rows[0].yearEnds[2] + m.rows[1].yearEnds[2]);
    for (const v of m.totals) assert.ok(Number.isInteger(v));
  });
});

describe('runway', () => {
  test('months of essentials the safety net covers, to one decimal', () => {
    assert.equal(runway(1100000, 360000), 3.1);
    assert.equal(runway(0, 360000), 0);
    assert.equal(runway(1100000, 0), null);
  });

  test('essentials come from budgets when there are any, else the median month', () => {
    const cats = [{ type: 'expense', budget: 150000 }, { type: 'expense', budget: 60000 }, { type: 'income', budget: 999999 }];
    assert.equal(essentialMonthly(cats, [], TODAY), 210000);
    const txs = [
      tx({ amount: 10000, date: '2026-08-05' }), tx({ amount: 30000, date: '2026-07-05' }), tx({ amount: 20000, date: '2026-06-05' }),
    ];
    assert.equal(essentialMonthly([], txs, TODAY), 20000);
    assert.equal(essentialMonthly([], [], TODAY), 0);
  });

  test('the safety net is the plan marked as one', () => {
    assert.equal(safetyPlan([plan({ id: 'x', kind: 'fund' }), plan({ id: 'y', kind: 'safety' })]).id, 'y');
    assert.equal(safetyPlan([plan({ id: 'x' })]), null);
  });
});

describe('advisor review', () => {
  const months = (over) => [
    tx({ type: 'income', amount: 450000, date: '2026-08-01' }), tx({ amount: 290000, date: '2026-08-10' }),
    tx({ type: 'income', amount: 450000, date: '2026-07-01' }), tx({ amount: 290000, date: '2026-07-10' }),
    tx({ type: 'income', amount: 450000, date: '2026-06-01' }), tx({ amount: 290000, date: '2026-06-10' }),
  ];
  const account = (over = {}) => ({ id: 'acc1', name: 'Hub', kind: 'checking', openingBalance: 0, order: 0, institution: '', role: 'hub', apyBp: 0, mfa: true, reviewedAt: '2026-08-01', notes: '', vault: null, ...over });
  const base = () => ({
    plans: [plan({ id: 's', name: 'Rainy day', kind: 'safety', target: 8640000, saved: 1100000, allocBp: 10000 })],
    accounts: [account()],
    categories: [{ type: 'expense', budget: 360000 }],
    transactions: months(),
    settings: { ...DEFAULT_SETTINGS, lastExportAt: '2026-09-18T00:00:00.000Z', lastChangeAt: '2026-09-17T00:00:00.000Z' },
    todayIso: TODAY,
  });

  test('scores each item and lists what needs attention', () => {
    const r = advisorReview(base());
    const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));
    assert.equal(by.mfa.ok, true);
    assert.equal(by.reviewed.ok, true);
    assert.equal(by.allocation.ok, true);
    assert.equal(by.backup.ok, true);
    assert.equal(by.safety.ok, false, '3.1 months is short of 6');
    assert.equal(r.runway, 3.1);
    assert.equal(r.runwayTarget, 6);
    assert.equal(by.invest.ok, false);
    assert.equal(by.invest.soft, true);
    assert.ok(r.attention.some((c) => c.id === 'safety'));
    assert.equal(r.surplus.typical, 160000);
    assert.equal(r.allocated, 160000);
    assert.equal(r.savingsRate, 36);
  });

  test('flags accounts without two-factor and stale reviews by name', () => {
    const d = base();
    d.accounts = [account({ name: 'Hub', mfa: false }), account({ id: 'acc2', name: 'Card', reviewedAt: '2025-01-01' })];
    const by = Object.fromEntries(advisorReview(d).checks.map((c) => [c.id, c]));
    assert.equal(by.mfa.ok, false);
    assert.match(by.mfa.detail, /Hub/);
    assert.equal(by.reviewed.ok, false);
    assert.match(by.reviewed.detail, /Card/);
  });

  test('an unallocated surplus and a missed date both come up', () => {
    const d = base();
    d.plans = [plan({ id: 's', kind: 'safety', target: 8640000, saved: 1100000, allocBp: 5000, targetDate: '2026-12-01' })];
    const by = Object.fromEntries(advisorReview(d).checks.map((c) => [c.id, c]));
    assert.equal(by.allocation.ok, false);
    assert.match(by.allocation.title, /50%/);
    assert.equal(by['on-track'].ok, false);
  });

  test('with nothing set up, nothing crashes and everything is a suggestion', () => {
    const r = advisorReview({ plans: [], accounts: [], categories: [], transactions: [], settings: { ...DEFAULT_SETTINGS }, todayIso: TODAY });
    assert.equal(r.checks.length, 7);
    assert.equal(r.runway, null);
    assert.equal(r.savingsRate, null);
    assert.equal(r.checks.find((c) => c.id === 'backup').ok, true, 'nothing to back up yet');
  });
});
