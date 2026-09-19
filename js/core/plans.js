// Plans: the nest eggs you are filling, and the trips you fill one for and
// then spend down.
//
// plan = { id, name, kind: 'fund' | 'trip', target, saved, targetDate,
//          startDate, endDate, color, createdAt }
//
// `saved` is money you have deliberately set aside. It stays a counter you
// move by hand rather than a transaction, because moving money between your
// own accounts is neither income nor spending and would distort every total
// in the app. Transactions instead carry a `planId` when they are spending
// *against* a plan, which is how a trip draws its pot down — and why a flight
// booked six months early still counts toward the trip.
//
// Everything here is pure: given plans, transactions and today's date, the
// same numbers come out every time.

import { monthKey, monthKeyAdd } from './dates.js';
import { expenseAmount, totals, txsInMonth, goalProgress } from './stats.js';

export const PLAN_KINDS = { fund: 'Nest egg', trip: 'Trip' };

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
    kind: plan.kind === 'trip' ? 'trip' : 'fund',
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

// Pour a monthly amount into the plans in order, one month at a time, and
// report when each one fills up. This is the whole scenario engine: change
// `monthly` or `lumpSum` and every projected date moves with it.
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

  const pour = (amount, key, monthsAway) => {
    let pot = amount;
    for (const row of rows) {
      if (pot <= 0) break;
      const need = left.get(row.plan.id);
      if (need <= 0) continue;
      const put = Math.min(need, pot);
      left.set(row.plan.id, need - put);
      pot -= put;
      if (need - put === 0) {
        row.fundedKey = key;
        row.monthsAway = monthsAway;
      }
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
      spare = pour(monthly, monthKeyAdd(startKey, i), i);
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
