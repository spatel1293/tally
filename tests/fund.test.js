import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_KINDS, BP, planKind, planProgress, requiredMonthly, growMonthly, allocate,
  projectGrowth, milestones, runway, safetyPlan, planOrder, projectPlans,
} from '../js/core/plans.js';
import {
  surplus, fundTotal, weightedApy, yearlyYield, byRole, reconcile,
  balanceHistory, fundHistory, staleAccounts, unreadAccounts, investedShare,
} from '../js/core/fund.js';
import { advisorReview } from '../js/core/advisor.js';
import { buildBackup, parseBackup, sanitizeAccount, sanitizeGoal, sanitizeSettings } from '../js/core/validate.js';
import { BACKUP_FORMAT, DEFAULT_SETTINGS, newAccount, APP_NAME } from '../js/core/defaults.js';

const TODAY = '2026-09-22';

const pot = (over = {}) => ({
  id: 'p1', name: 'Rainy day', kind: 'fund', target: 500000, saved: 200000,
  targetDate: null, startDate: null, endDate: null, color: '#1d4e6f', icon: '🛟',
  createdAt: '2026-01-01T00:00:00.000Z', apyBp: 0, allocBp: 0, accountId: null, ...over,
});

const acct = (over = {}) => newAccount({
  id: 'a1', name: 'Core hub', institution: 'Ally', kind: 'savings', role: 'savings',
  apyBp: 425, mfa: true, reviewedAt: '2026-08-01', notes: '', vault: null,
  balance: 1000000, balanceAt: '2026-09-01', history: [], order: 0, ...over,
});

describe('the monthly surplus', () => {
  test('is stated, not derived — two figures and the difference', () => {
    assert.deepEqual(surplus({ monthlyIncome: 450000, monthlyOutgoings: 290000 }), {
      income: 450000, outgoings: 290000, surplus: 160000, negative: false,
    });
  });

  test('spending more than you earn is nothing left over, not a negative surplus', () => {
    const s = surplus({ monthlyIncome: 200000, monthlyOutgoings: 290000 });
    assert.equal(s.surplus, 0);
    assert.equal(s.negative, true);
  });

  test('missing figures read as zero rather than crashing', () => {
    assert.equal(surplus({}).surplus, 0);
  });
});

describe('what the fund is worth', () => {
  const accounts = [
    acct({ id: 'a1', balance: 1400000, apyBp: 450 }),
    acct({ id: 'a2', name: 'Brokerage', role: 'investing', balance: 600000, apyBp: 700 }),
    acct({ id: 'a3', name: 'Card', role: 'spending', balance: -31025, apyBp: 0 }),
  ];

  test('adds up every balance, money owed included', () => {
    assert.equal(fundTotal(accounts), 1400000 + 600000 - 31025);
  });

  test('the rate is weighted by what each account holds, and debts are left out', () => {
    // 1,400,000 at 4.5% and 600,000 at 7% → 5.25% across 2,000,000.
    assert.equal(weightedApy(accounts), 525);
    assert.equal(weightedApy([]), 0);
    assert.equal(weightedApy([acct({ balance: -500, apyBp: 0 })]), 0, 'a debt alone leaves nothing to weight');
  });

  test('a year of yield is what it makes while you do nothing', () => {
    assert.equal(yearlyYield(accounts), Math.round(1400000 * 0.045) + Math.round(600000 * 0.07));
  });

  test('totals by job', () => {
    const map = byRole(accounts);
    assert.equal(map.get('savings'), 1400000);
    assert.equal(map.get('investing'), 600000);
    assert.equal(map.get('spending'), -31025);
  });
});

describe('do the pots add up', () => {
  test('an account holding less than the pots claim is flagged by name', () => {
    const accounts = [acct({ id: 'a1', balance: 100000 })];
    const plans = [pot({ id: 'p1', saved: 70000, accountId: 'a1' }), pot({ id: 'p2', saved: 50000, accountId: 'a1' })];
    const r = reconcile(accounts, plans);
    assert.equal(r.rows[0].claimed, 120000);
    assert.equal(r.rows[0].difference, -20000);
    assert.equal(r.rows[0].short, true);
    assert.equal(r.short.length, 1);
  });

  test('money nothing claims is reported, not treated as a fault', () => {
    const r = reconcile([acct({ balance: 100000 })], [pot({ saved: 30000, accountId: 'a1' })]);
    assert.equal(r.short.length, 0);
    assert.equal(r.unassigned, 70000);
  });

  test('a pot kept nowhere, or in an account that has gone, is homeless', () => {
    const r = reconcile([acct({ id: 'a1' })], [pot({ id: 'p1', accountId: null }), pot({ id: 'p2', accountId: 'gone' })]);
    assert.deepEqual(r.homeless.map((p) => p.id), ['p1', 'p2']);
  });
});

describe('readings', () => {
  const a = acct({
    balance: 1462000, balanceAt: '2026-09-20',
    history: [{ date: '2026-07-01', cents: 1380000 }, { date: '2026-09-01', cents: 1400000 }],
  });

  test('newest first, each with what changed since the one before', () => {
    const rows = balanceHistory(a);
    assert.deepEqual(rows.map((r) => r.date), ['2026-09-20', '2026-09-01', '2026-07-01']);
    assert.equal(rows[0].change, 62000);
    assert.equal(rows[1].change, 20000);
    assert.equal(rows[2].change, null, 'the first reading has nothing to compare against');
  });

  test('an account never read has no history to show', () => {
    assert.deepEqual(balanceHistory(acct({ balanceAt: null, history: [] })), []);
  });

  test('the fund month by month carries the last reading forward', () => {
    const series = fundHistory([a, acct({ id: 'a2', balance: 100000, balanceAt: '2026-09-05', history: [] })], 6);
    assert.deepEqual(series.map((s) => s.key), ['2026-07', '2026-09']);
    assert.equal(series[0].total, 1380000, 'July has only the one account read by then');
    assert.equal(series[1].total, 1462000 + 100000);
  });

  test('accounts needing attention are found by date, not by guesswork', () => {
    assert.deepEqual(staleAccounts([acct({ reviewedAt: '2025-01-01' }), acct({ id: 'b', reviewedAt: TODAY })], TODAY).map((x) => x.id), ['a1']);
    assert.deepEqual(unreadAccounts([acct({ balanceAt: '2026-01-01' }), acct({ id: 'b', balanceAt: TODAY })], TODAY).map((x) => x.id), ['a1']);
    assert.deepEqual(unreadAccounts([acct({ balanceAt: null })], TODAY).map((x) => x.id), ['a1'], 'never read counts as out of date');
  });

  test('how much of the fund is invested', () => {
    assert.equal(investedShare([acct({ balance: 1000000 })], [pot({ kind: 'invest', saved: 250000 })]), 2500);
    assert.equal(investedShare([], []), null);
  });
});

describe('pots', () => {
  test('progress without a single transaction in sight', () => {
    const p = planProgress(pot({ saved: 200000, target: 500000 }), TODAY);
    assert.equal(p.ratio, 0.4);
    assert.equal(p.toSave, 300000);
    assert.equal(p.done, false);
  });

  test('a date turns into what it costs a month', () => {
    const p = planProgress(pot({ saved: 0, target: 120000, targetDate: '2027-09-01' }), TODAY);
    assert.equal(p.monthsLeft, 12);
    assert.equal(p.perMonth, 10000);
    assert.equal(requiredMonthly([pot({ saved: 0, target: 120000, targetDate: '2027-09-01' })], TODAY), 10000);
  });

  test('a passed date with money still to find is overdue', () => {
    assert.equal(planProgress(pot({ targetDate: '2026-01-01' }), TODAY).overdue, true);
  });

  test('an unknown kind reads as a nest egg, so older books still open', () => {
    assert.equal(planKind({ kind: 'lottery' }), 'fund');
    assert.equal(Object.keys(PLAN_KINDS).length, 4);
  });

  test('only one pot is the safety net', () => {
    assert.equal(safetyPlan([pot({ id: 'x' }), pot({ id: 'y', kind: 'safety' })]).id, 'y');
    assert.equal(safetyPlan([pot()]), null);
  });
});

describe('growth', () => {
  test('one month of yield is rounded to whole cents every month', () => {
    assert.equal(growMonthly(1000000, 425), 3542);
    assert.equal(growMonthly(0, 425), 0);
    assert.equal(growMonthly(1000000, 0), 0);
    assert.equal(growMonthly(-5, 425), 0);
  });

  test('a year compounds the way a savings account posts: growth, then the deposit', () => {
    const series = projectGrowth(100000, 10000, 1200, 12);
    assert.equal(series[0], 100000 + 1000 + 10000);
    for (const v of series) assert.ok(Number.isInteger(v));
    assert.ok(series[11] > 100000 + 12 * 10000);
  });

  test('no yield is plain addition', () => {
    assert.deepEqual(projectGrowth(0, 500, 0, 3), [500, 1000, 1500]);
  });
});

describe('shares of the surplus', () => {
  const plans = [pot({ id: 'a', allocBp: 6875 }), pot({ id: 'b', allocBp: 937 }), pot({ id: 'c', allocBp: 0 })];

  test('each pot takes its share, floored, and the rest is reported', () => {
    const r = allocate(plans, 160000);
    assert.equal(r.byPlan.get('a'), 110000);
    assert.equal(r.byPlan.get('b'), 14992);
    assert.equal(r.allocated, 124992);
    assert.equal(r.unallocated, 35008);
    assert.equal(r.sharedBp, 7812);
  });

  test('the shares can never claim more than there is', () => {
    const r = allocate([pot({ id: 'a', allocBp: BP })], 999);
    assert.equal(r.byPlan.get('a'), 999);
    assert.equal(r.unallocated, 0);
  });

  test('nothing left over allocates nothing', () => {
    assert.equal(allocate(plans, 0).allocated, 0);
    assert.equal(allocate(plans, -5).allocated, 0);
  });
});

describe('projection', () => {
  test('with no shares, the pour fills pots in date order', () => {
    const a = pot({ id: 'a', target: 60000, saved: 0, createdAt: '2026-01-01' });
    const b = pot({ id: 'b', target: 60000, saved: 0, createdAt: '2026-02-01' });
    const r = projectPlans([a, b], { monthly: 20000, todayIso: TODAY });
    assert.equal(r.rows.find((x) => x.plan.id === 'a').monthsAway, 3);
    assert.equal(r.rows.find((x) => x.plan.id === 'b').monthsAway, 6);
  });

  test('with shares, each pot fills from its own share', () => {
    const a = pot({ id: 'a', target: 60000, saved: 0, allocBp: 5000, createdAt: '2026-01-01' });
    const b = pot({ id: 'b', target: 60000, saved: 0, allocBp: 5000, createdAt: '2026-02-01' });
    const r = projectPlans([a, b], { monthly: 20000, todayIso: TODAY });
    assert.equal(r.rows.find((x) => x.plan.id === 'a').monthsAway, 6);
    assert.equal(r.rows.find((x) => x.plan.id === 'b').monthsAway, 6);
  });

  test('a share a pot does not need goes back into the pour', () => {
    const a = pot({ id: 'a', target: 1000, saved: 0, allocBp: 9000, createdAt: '2026-01-01' });
    const b = pot({ id: 'b', target: 100000, saved: 0, allocBp: 1000, createdAt: '2026-02-01' });
    const r = projectPlans([a, b], { monthly: 10000, todayIso: TODAY });
    assert.equal(r.rows.find((x) => x.plan.id === 'b').monthsAway, 11);
  });

  test('yield shortens the wait', () => {
    const slow = projectPlans([pot({ target: 2000000, saved: 1000000, apyBp: 0 })], { monthly: 20000, todayIso: TODAY });
    const fast = projectPlans([pot({ target: 2000000, saved: 1000000, apyBp: 500 })], { monthly: 20000, todayIso: TODAY });
    assert.equal(slow.rows[0].monthsAway, 50);
    assert.ok(fast.rows[0].monthsAway < 50);
  });

  test('nothing going in means nothing ever fills, and it says so', () => {
    const r = projectPlans([pot({ saved: 0, targetDate: '2027-01-01' })], { monthly: 0, todayIso: TODAY });
    assert.equal(r.unfunded.length, 1);
    assert.equal(r.allFundedKey, null);
  });

  test('a tiny amount against a huge target gives up rather than looping for ever', () => {
    const r = projectPlans([pot({ target: 99999999, saved: 0 })], { monthly: 100, todayIso: TODAY });
    assert.equal(r.unfunded.length, 1);
  });

  test('a lump sum now moves every date forward', () => {
    const plans = [pot({ id: 'a', target: 60000, saved: 0 })];
    const without = projectPlans(plans, { monthly: 10000, todayIso: TODAY }).rows[0].monthsAway;
    const with50 = projectPlans(plans, { monthly: 10000, lumpSum: 50000, todayIso: TODAY }).rows[0].monthsAway;
    assert.ok(with50 < without);
  });

  test('ordering: soonest date first, undated last, ties broken by age', () => {
    const order = planOrder([
      pot({ id: 'late', targetDate: '2028-01-01' }),
      pot({ id: 'none', targetDate: null, createdAt: '2026-05-01' }),
      pot({ id: 'soon', targetDate: '2026-12-01' }),
      pot({ id: 'older', targetDate: null, createdAt: '2026-01-01' }),
    ]).map((p) => p.id);
    assert.deepEqual(order, ['soon', 'late', 'older', 'none']);
  });
});

describe('milestones and runway', () => {
  test('year-end balances for every pot, and the total', () => {
    const plans = [pot({ id: 'a', saved: 1100000, apyBp: 350, allocBp: 6875 }), pot({ id: 'b', saved: 0, apyBp: 700, allocBp: 937 })];
    const m = milestones(plans, 160000, { years: 5 });
    assert.equal(m.rows[0].monthly, 110000);
    assert.equal(m.rows[0].yearEnds.length, 5);
    assert.ok(m.rows[0].yearEnds[0] > 1100000 + 12 * 110000, 'year one includes yield');
    assert.equal(m.totals[2], m.rows[0].yearEnds[2] + m.rows[1].yearEnds[2]);
    for (const v of m.totals) assert.ok(Number.isInteger(v));
  });

  test('months of outgoings the safety net covers, to one decimal', () => {
    assert.equal(runway(1100000, 290000), 3.8);
    assert.equal(runway(0, 290000), 0);
    assert.equal(runway(1100000, 0), null, 'without a monthly figure there is nothing to measure against');
  });
});

describe('the quarterly review', () => {
  const base = () => ({
    plans: [pot({ id: 's', name: 'Rainy day', kind: 'safety', target: 8640000, saved: 1100000, allocBp: BP })],
    accounts: [acct()],
    settings: { ...DEFAULT_SETTINGS, monthlyIncome: 450000, monthlyOutgoings: 290000, lastExportAt: '2026-09-21T00:00:00.000Z', lastChangeAt: '2026-09-20T00:00:00.000Z' },
    todayIso: TODAY,
  });
  const by = (r) => Object.fromEntries(r.checks.map((c) => [c.id, c]));

  test('measures the safety net in months of outgoings', () => {
    const r = advisorReview(base());
    assert.equal(r.runway, 3.8);
    assert.equal(by(r).safety.ok, false, '3.8 months is short of 6');
    assert.match(by(r).safety.title, /3\.8 of 6/);
  });

  test('clears when the net is deep enough', () => {
    const d = base();
    d.plans[0].saved = 8640000;
    assert.equal(by(advisorReview(d)).safety.ok, true);
  });

  test('names the accounts that are short, unreviewed, unread or unprotected', () => {
    const d = base();
    d.accounts = [
      acct({ id: 'a1', name: 'Hub', mfa: false }),
      acct({ id: 'a2', name: 'Old', reviewedAt: '2024-01-01', balanceAt: '2024-01-01' }),
    ];
    const c = by(advisorReview(d));
    assert.equal(c.mfa.ok, false);
    assert.match(c.mfa.detail, /Hub/);
    assert.equal(c.reviewed.ok, false);
    assert.match(c.reviewed.detail, /Old/);
    assert.equal(c.current.ok, false);
    assert.match(c.current.detail, /Old/);
  });

  test('catches a pot claiming more than its account holds', () => {
    const d = base();
    d.accounts = [acct({ id: 'a1', balance: 50000 })];
    d.plans = [pot({ id: 's', kind: 'safety', saved: 900000, accountId: 'a1', allocBp: BP })];
    assert.equal(by(advisorReview(d)).reconciled.ok, false);
  });

  test('an unshared surplus and a missed date both come up', () => {
    const d = base();
    d.plans = [pot({ id: 's', kind: 'safety', target: 8640000, saved: 1100000, allocBp: 5000, targetDate: '2026-12-01' })];
    const c = by(advisorReview(d));
    assert.equal(c.allocation.ok, false);
    assert.match(c.allocation.title, /50%/);
    assert.equal(c['on-track'].ok, false);
  });

  test('money in the sentences is formatted by the caller, not by core', () => {
    const d = base();
    d.money = (cents) => `€${cents / 100}`;
    d.plans = [pot({ id: 's', kind: 'safety', target: 8640000, saved: 1100000, allocBp: BP, targetDate: '2026-10-01' })];
    assert.match(by(advisorReview(d))['on-track'].detail, /€1600/);
  });

  test('an empty book is all suggestions and no crashes', () => {
    const r = advisorReview({ plans: [], accounts: [], settings: { ...DEFAULT_SETTINGS }, todayIso: TODAY });
    assert.equal(r.checks.length, 9);
    assert.equal(r.runway, null);
    assert.equal(r.savingsRate, null);
    assert.equal(by(r).backup.ok, true, 'nothing written in is nothing to lose');
  });
});

describe('what is written down', () => {
  const data = {
    settings: { ...DEFAULT_SETTINGS, currency: 'EUR', locale: 'de-DE', monthlyIncome: 450000, monthlyOutgoings: 290000 },
    accounts: [acct({ vault: { v: 1, iv: 'AAAAAAAAAAAAAAAA', data: 'c2VhbGVk' }, history: [{ date: '2026-08-01', cents: 900000 }] })],
    goals: [pot({ accountId: 'a1' })],
    archive: {},
  };

  test('a book round-trips exactly', () => {
    const r = parseBackup(JSON.stringify(buildBackup(data, '2026-09-22T00:00:00.000Z')));
    assert.equal(r.ok, true);
    assert.equal(r.dropped, 0);
    assert.deepEqual(r.data, data);
  });

  test('a record written today matches one that has been through a backup', () => {
    const made = newAccount({ id: 'a9', name: 'New', order: 3 });
    assert.deepEqual(sanitizeAccount(made, 3), made);
  });

  test('an older book opens, and what this version no longer reads is carried, not dropped', () => {
    const old = {
      app: APP_NAME,
      format: 3,
      exportedAt: '2026-01-01T00:00:00.000Z',
      settings: { currency: 'USD', locale: 'en-US' },
      accounts: [{ id: 'a1', name: 'Checking', kind: 'checking', openingBalance: 25000, order: 0 }],
      goals: [{ id: 'g1', name: 'Trip', kind: 'trip', target: 50000, saved: 1000, color: '#1d4e6f' }],
      transactions: [{ id: 't1', amount: 500 }, { id: 't2', amount: 900 }],
      categories: [{ id: 'c1', name: 'Groceries' }],
      recurring: [{ id: 'r1' }],
    };
    const r = parseBackup(JSON.stringify(old));
    assert.equal(r.ok, true);
    assert.equal(r.carried, 4, 'two transactions, a category and a repeating item travel along');
    assert.deepEqual(r.data.archive.transactions, old.transactions);
    assert.equal(r.data.accounts[0].balance, 0, 'an old opening balance is not a reading');
    assert.equal(r.data.accounts[0].balanceAt, null);
    assert.equal(r.data.goals[0].accountId, null);
    assert.equal(r.data.settings.runwayTarget, 6);
    // And the archive survives the next backup, so it is never lost by
    // passing through this version.
    const again = parseBackup(JSON.stringify(buildBackup(r.data, '2026-09-22T00:00:00.000Z')));
    assert.deepEqual(again.data.archive.transactions, old.transactions);
  });

  test('damage is dropped rather than kept to fail later', () => {
    const r = parseBackup(JSON.stringify({
      app: APP_NAME, format: BACKUP_FORMAT,
      accounts: [{ id: 'a1', name: 'Fine' }, { name: 'No id' }],
      goals: [{ id: 'g1', name: 'Bad kind', kind: 'lottery', target: 100, allocBp: 99999, apyBp: -5 }],
      settings: { runwayTarget: 900, monthlyIncome: -4 },
    }));
    assert.equal(r.dropped, 1);
    assert.equal(r.data.goals[0].kind, 'fund');
    assert.equal(r.data.goals[0].allocBp, 0, 'a share over 100% is not a share');
    assert.equal(r.data.goals[0].apyBp, 0);
    assert.equal(r.data.settings.runwayTarget, 6);
    assert.equal(r.data.settings.monthlyIncome, 0);
  });

  test('a corrupt sealed blob is dropped rather than kept to fail on every open', () => {
    const r = parseBackup(JSON.stringify({
      app: APP_NAME, format: BACKUP_FORMAT,
      accounts: [{ id: 'a1', name: 'X', vault: { v: 1, iv: 5 } }], goals: [], settings: {},
    }));
    assert.equal(r.data.accounts[0].vault, null);
  });

  test('a file from a newer version is refused, not half-read', () => {
    assert.match(parseBackup(JSON.stringify({ app: APP_NAME, format: 99, accounts: [] })).error, /newer version/);
    assert.match(parseBackup('{"hello":1}').error, /doesn’t look like/);
    assert.match(parseBackup('not json').error, /valid JSON/);
  });

  test('settings keep only what they understand', () => {
    const s = sanitizeSettings({ theme: 'dark', runwayTarget: 12, monthlyOutgoings: 123456, nonsense: true });
    assert.equal(s.theme, 'dark');
    assert.equal(s.runwayTarget, 12);
    assert.equal(s.monthlyOutgoings, 123456);
    assert.equal('nonsense' in s, false);
  });

  test('a pot keeps its mark and its ink', () => {
    const g = sanitizeGoal({ id: 'g1', name: 'Bike', target: 1000, icon: '🚗', color: '#7b3f2e', kind: 'trip' });
    assert.equal(g.icon, '🚗');
    assert.equal(g.color, '#7b3f2e');
    assert.equal(g.kind, 'trip');
  });
});
