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
