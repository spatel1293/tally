// Plans: the pots you are filling — a safety net, nest eggs, trips you fill
// one for and then spend down, and money put to work for the long term.
//
// plan = { id, name, kind: 'safety' | 'fund' | 'trip' | 'invest', target,
//          saved, targetDate, startDate, endDate, color, createdAt,
//          apyBp, allocBp, accountId }
//
// `saved` is money you have deliberately set aside. It stays a counter you
// move by hand rather than a transaction, because moving money between your
// own accounts is neither income nor spending and would distort every total
// in the app. Transactions instead carry a `planId` when they are spending
// *against* a plan, which is how a trip draws its pot down — and why a flight
// booked six months early still counts toward the trip.
//
// `apyBp` is the yield the pot earns, in basis points (425 = 4.25% a year);
// for an investment it is the return you are assuming. `allocBp` is the share
// of each month's surplus that goes here, also in basis points, so the shares
// across all plans add up to at most 10000. Both are integers for the same
// reason money is: a percentage that drifts is a projection that lies.
//
// Everything here is pure: given plans, transactions and today's date, the
// same numbers come out every time.

import { monthKey, monthKeyAdd } from './dates.js';
import { expenseAmount, totals, txsInMonth, goalProgress } from './stats.js';

export const PLAN_KINDS = { safety: 'Safety net', fund: 'Nest egg', trip: 'Trip', invest: 'Investments' };
export const BP = 10000;

export function planKind(plan) {
  return plan.kind in PLAN_KINDS ? plan.kind : 'fund';
}

// One month of growth on a balance, in whole cents. Rounded every month, so
// a year of projections is twelve honest roundings rather than one float
// carried to the end and rounded there.
export function growMonthly(balance, apyBp = 0) {
  if (!(balance > 0) || !(apyBp > 0)) return 0;
  return Math.round((balance * apyBp) / BP / 12);
}

// How a month's surplus splits across the plans by their shares. Each share
// is floored, so the shares can never add up to more than the surplus; what
// they don't claim is reported as unallocated rather than quietly lost.
export function allocate(plans, surplus) {
  const byPlan = new Map();
  let allocated = 0;
  const pot = Math.max(0, surplus);
  for (const plan of plans) {
    const bp = Math.min(BP, Math.max(0, plan.allocBp ?? 0));
    const cents = Math.floor((pot * bp) / BP);
    byPlan.set(plan.id, cents);
    allocated += cents;
  }
  return { byPlan, allocated, unallocated: Math.max(0, pot - allocated), sharedBp: plans.reduce((s, p) => s + Math.max(0, p.allocBp ?? 0), 0) };
}

// The pot's balance at the end of each of the next `months` months, given a
// monthly contribution and its yield. Growth is applied to the balance first,
// then the month's contribution lands, which is how a savings account posts.
export function projectGrowth(saved, monthly, apyBp, months) {
  const out = [];
  let balance = Math.max(0, saved);
  for (let m = 0; m < months; m++) {
    balance += growMonthly(balance, apyBp) + Math.max(0, monthly);
    out.push(balance);
  }
  return out;
}

// Year-end balances for every plan over the next `years`, and the total —
// the table a planner draws up to show where things stand in five years.
export function milestones(plans, surplus, { years = 5 } = {}) {
  const { byPlan } = allocate(plans, surplus);
  const rows = plans.map((plan) => {
    const series = projectGrowth(plan.saved ?? 0, byPlan.get(plan.id) ?? 0, plan.apyBp ?? 0, years * 12);
    return { plan, monthly: byPlan.get(plan.id) ?? 0, yearEnds: Array.from({ length: years }, (_, y) => series[y * 12 + 11]) };
  });
  const totals = Array.from({ length: years }, (_, y) => rows.reduce((s, r) => s + r.yearEnds[y], 0));
  return { rows, totals, years };
}

// Months the safety net would cover at the given monthly essentials. Not
// money, so it's allowed a decimal: "5.4 months" is a real answer.
export function runway(saved, essentialMonthly) {
  if (!(essentialMonthly > 0)) return null;
  return Math.round((Math.max(0, saved) / essentialMonthly) * 10) / 10;
}

// What a month costs to keep going. Budgets are the honest figure when they
// exist — they are what you've decided you need — otherwise the median of
// recent months' spending, for the same reason the surplus uses the median.
export function essentialMonthly(categories, txs, todayIso, months = 6) {
  let budgeted = 0;
  for (const c of categories) if (c.type === 'expense' && c.budget != null && c.budget > 0) budgeted += c.budget;
  if (budgeted > 0) return budgeted;
  const spent = [];
  let key = monthKeyAdd(monthKey(todayIso), -1);
  for (let i = 0; i < months; i++) {
    const t = totals(txsInMonth(txs, key));
    if (t.count > 0) spent.push(t.expenses);
    key = monthKeyAdd(key, -1);
  }
  return median(spent);
}

export function safetyPlan(plans) {
  return plans.find((p) => planKind(p) === 'safety') ?? null;
}

// How far ahead a projection will look before giving up. Ten years is longer
// than any plan anyone sensibly makes, and it stops a tiny monthly amount
// against a large target from looping for ever.
export const PROJECTION_HORIZON = 120;

export function planSpend(txs, planId) {
  let spent = 0;
  for (const t of txs) {
    if (t.planId === planId) spent += expenseAmount(t);
  }
  return spent;
}

export function planTransactions(txs, planId) {
  return txs.filter((t) => t.planId === planId);
}

export function planProgress(plan, txs, todayIso) {
  const base = goalProgress(plan, todayIso);
  const target = plan.target ?? 0;
  const spent = planSpend(txs, plan.id);
  // What's still in the pot after what the plan has already cost.
  const available = base.saved - spent;
  return {
    ...base,
    kind: planKind(plan),
    toSave: base.remaining,
    spent,
    available,
    spentRatio: target > 0 ? Math.min(1, Math.max(0, spent / target)) : 0,
    overspent: spent > base.saved,
  };
}

// What every plan with a date needs each month to arrive on time. This is the
// honest number to compare against what's actually left over each month.
export function requiredMonthly(plans, txs, todayIso) {
  let total = 0;
  for (const plan of plans) {
    const p = planProgress(plan, txs, todayIso);
    if (p.perMonth) total += p.perMonth;
  }
  return total;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// What's actually been left over each month, from whole months only — the
// current month is part-finished and would always look like a bad one.
// `typical` is the median rather than the mean, so a single unusual month
// (a bonus, a new laptop) doesn't set expectations for every month after it.
export function monthlySurplus(txs, todayIso, months = 6) {
  const list = [];
  let key = monthKeyAdd(monthKey(todayIso), -1);
  for (let i = 0; i < months; i++) {
    const t = totals(txsInMonth(txs, key));
    list.push({ key, income: t.income, expenses: t.expenses, net: t.net, count: t.count });
    key = monthKeyAdd(key, -1);
  }
  list.reverse();
  const used = list.filter((m) => m.count > 0);
  const nets = used.map((m) => m.net);
  return {
    months: list,
    monthsUsed: used.length,
    average: used.length ? Math.round(nets.reduce((s, n) => s + n, 0) / used.length) : 0,
    typical: median(nets),
    best: used.length ? Math.max(...nets) : 0,
    worst: used.length ? Math.min(...nets) : 0,
  };
}

// Soonest target date first, then oldest. Dated plans come before undated
// ones because a date is a commitment and "someday" isn't.
export function planOrder(plans) {
  return plans.slice().sort((a, b) => {
    const ad = a.targetDate || '9999-12-31';
    const bd = b.targetDate || '9999-12-31';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
  });
}

// Pour a monthly amount into the plans, one month at a time, and report when
// each one fills up. This is the whole scenario engine: change `monthly` or
// `lumpSum` and every projected date moves with it.
//
// Each month, every pot grows by its own yield first. Then the month's money
// is dealt out: plans with a share of the surplus take their share, and
// whatever is left — the unallocated part, plus any share a plan didn't need
// — pours into the plans in date order, soonest first, because that is what
// would really happen. With no shares set, that pour is the whole engine,
// which is what it always was.
export function projectPlans(plans, txs, { monthly = 0, lumpSum = 0, todayIso, horizon = PROJECTION_HORIZON }) {
  const startKey = monthKey(todayIso);
  const rows = planOrder(plans).map((plan) => ({
    plan,
    progress: planProgress(plan, txs, todayIso),
    fundedKey: null,
    monthsAway: null,
    onTime: null,
  }));
  const left = new Map(rows.map((r) => [r.plan.id, r.progress.toSave]));
  const balance = new Map(rows.map((r) => [r.plan.id, r.progress.saved]));
  const shares = allocate(rows.map((r) => r.plan), monthly);

  // Put money into one pot; returns what it couldn't take.
  const put = (row, amount, key, monthsAway) => {
    const id = row.plan.id;
    const need = left.get(id);
    if (need <= 0 || amount <= 0) return amount;
    const take = Math.min(need, amount);
    left.set(id, need - take);
    balance.set(id, balance.get(id) + take);
    if (need - take === 0) {
      row.fundedKey = key;
      row.monthsAway = monthsAway;
    }
    return amount - take;
  };

  const pour = (amount, key, monthsAway) => {
    let pot = amount;
    for (const row of rows) {
      if (pot <= 0) break;
      pot = put(row, pot, key, monthsAway);
    }
    return pot;
  };

  for (const row of rows) {
    if (left.get(row.plan.id) <= 0) {
      row.fundedKey = startKey;
      row.monthsAway = 0;
    }
  }

  let spare = pour(Math.max(0, lumpSum), startKey, 0);
  if (monthly > 0) {
    for (let i = 1; i <= horizon && rows.some((r) => !r.fundedKey); i++) {
      const key = monthKeyAdd(startKey, i);
      for (const row of rows) put(row, growMonthly(balance.get(row.plan.id), row.plan.apyBp), key, i);
      let pot = monthly;
      if (shares.sharedBp > 0) {
        for (const row of rows) {
          const share = shares.byPlan.get(row.plan.id) ?? 0;
          pot -= share - put(row, share, key, i);
        }
      }
      spare = pour(pot, key, i);
    }
  }

  for (const row of rows) {
    if (row.plan.targetDate && row.fundedKey) row.onTime = row.fundedKey <= monthKey(row.plan.targetDate);
  }

  const unfunded = rows.filter((r) => !r.fundedKey);
  const late = rows.filter((r) => r.onTime === false);
  const funded = rows.filter((r) => r.fundedKey);
  return {
    rows,
    unfunded,
    late,
    spare,
    // The month the last plan fills up, or null if any of them never does.
    allFundedKey: rows.length && !unfunded.length ? funded.map((r) => r.fundedKey).sort().at(-1) : null,
  };
}
