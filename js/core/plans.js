// Pots: the things the fund is *for*. A safety net that buys you months, nest
// eggs you fill, trips you fill and then spend down, and money put to work.
//
// plan = { id, name, kind: 'safety' | 'fund' | 'trip' | 'invest', target,
//          saved, targetDate, color, createdAt, apyBp, allocBp, accountId }
//
// `saved` is what the pot holds. Nothing here reads a transaction: Tally
// stopped logging spending in version 5, and a pot's balance is now a figure
// you state — the same way you read it off a statement — rather than one
// derived from a ledger of purchases.
//
// `apyBp` is what the pot earns, in basis points (425 = 4.25% a year); for an
// investment it is the return you are assuming. `allocBp` is the share of
// each month's surplus that comes here, also in basis points, so the shares
// across all pots add up to at most 10000. Both are integers for the same
// reason money is: a percentage that drifts is a projection that lies.
//
// Everything here is pure: given the pots and today's date, the same numbers
// come out every time.

import { monthKey, monthKeyAdd } from './dates.js';

export const PLAN_KINDS = { safety: 'Safety net', fund: 'Nest egg', trip: 'Trip', invest: 'Investments' };
export const BP = 10000;

// How far ahead a projection will look before giving up. Ten years is longer
// than any plan anyone sensibly makes, and it stops a tiny monthly amount
// against a large target from looping for ever.
const PROJECTION_HORIZON = 120;

export function planKind(plan) {
  return plan.kind in PLAN_KINDS ? plan.kind : 'fund';
}

export function planProgress(plan, todayIso) {
  const saved = plan.saved ?? 0;
  const target = plan.target ?? 0;
  const remaining = Math.max(0, target - saved);
  const ratio = target > 0 ? Math.min(1, Math.max(0, saved / target)) : 0;
  let monthsLeft = null;
  let perMonth = null;
  if (plan.targetDate && remaining > 0 && plan.targetDate > todayIso) {
    const [ty, tm] = plan.targetDate.split('-').map(Number);
    const [cy, cm] = todayIso.split('-').map(Number);
    monthsLeft = Math.max(1, (ty - cy) * 12 + (tm - cm));
    perMonth = Math.ceil(remaining / monthsLeft);
  }
  return {
    kind: planKind(plan),
    saved,
    remaining,
    toSave: remaining,
    ratio,
    done: saved >= target,
    monthsLeft,
    perMonth,
    overdue: Boolean(plan.targetDate && plan.targetDate < todayIso && remaining > 0),
  };
}

// What every pot with a date needs each month to arrive on time. This is the
// honest number to hold the monthly surplus up against.
export function requiredMonthly(plans, todayIso) {
  let total = 0;
  for (const plan of plans) {
    const p = planProgress(plan, todayIso);
    if (p.perMonth) total += p.perMonth;
  }
  return total;
}

// One month of growth on a balance, in whole cents. Rounded every month, so
// a year of projections is twelve honest roundings rather than one float
// carried to the end and rounded there.
export function growMonthly(balance, apyBp = 0) {
  if (!(balance > 0) || !(apyBp > 0)) return 0;
  return Math.round((balance * apyBp) / BP / 12);
}

// How a month's surplus splits across the pots by their shares. Each share is
// floored, so the shares can never add up to more than the surplus; what they
// don't claim is reported as unallocated rather than quietly lost.
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
  return {
    byPlan,
    allocated,
    unallocated: Math.max(0, pot - allocated),
    sharedBp: plans.reduce((s, p) => s + Math.max(0, p.allocBp ?? 0), 0),
  };
}

// The balance at the end of each of the next `months` months, given a monthly
// contribution and a yield. Growth is applied to the balance first, then the
// month's contribution lands, which is how a savings account posts.
export function projectGrowth(saved, monthly, apyBp, months) {
  const out = [];
  let balance = Math.max(0, saved);
  for (let m = 0; m < months; m++) {
    balance += growMonthly(balance, apyBp) + Math.max(0, monthly);
    out.push(balance);
  }
  return out;
}

// Year-end balances for every pot over the next `years`, and the total — the
// table a planner draws up to show where things stand five years out.
export function milestones(plans, surplus, { years = 5 } = {}) {
  const { byPlan } = allocate(plans, surplus);
  const rows = plans.map((plan) => {
    const series = projectGrowth(plan.saved ?? 0, byPlan.get(plan.id) ?? 0, plan.apyBp ?? 0, years * 12);
    return { plan, monthly: byPlan.get(plan.id) ?? 0, yearEnds: Array.from({ length: years }, (_, y) => series[y * 12 + 11]) };
  });
  const totals = Array.from({ length: years }, (_, y) => rows.reduce((s, r) => s + r.yearEnds[y], 0));
  return { rows, totals, years };
}

// Months the safety net would cover at the given monthly outgoings. Not
// money, so it is allowed a decimal: "5.4 months" is a real answer.
export function runway(saved, monthlyOutgoings) {
  if (!(monthlyOutgoings > 0)) return null;
  return Math.round((Math.max(0, saved) / monthlyOutgoings) * 10) / 10;
}

export function safetyPlan(plans) {
  return plans.find((p) => planKind(p) === 'safety') ?? null;
}

// Soonest target date first, then oldest. Dated pots come before undated ones
// because a date is a commitment and "someday" isn't.
export function planOrder(plans) {
  return plans.slice().sort((a, b) => {
    const ad = a.targetDate || '9999-12-31';
    const bd = b.targetDate || '9999-12-31';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
  });
}

// Pour a monthly amount into the pots, one month at a time, and report when
// each fills up. This is the whole scenario engine: change `monthly` or
// `lumpSum` and every projected date moves with it.
//
// Each month every pot grows by its own yield first. Then the money is dealt
// out: pots with a share take their share, and whatever is left — the
// unallocated part, plus any share a pot didn't need — pours into the pots in
// date order, soonest first, because that is what would really happen. With
// no shares set, that pour is the whole engine.
export function projectPlans(plans, { monthly = 0, lumpSum = 0, todayIso, horizon = PROJECTION_HORIZON }) {
  const startKey = monthKey(todayIso);
  const rows = planOrder(plans).map((plan) => ({
    plan,
    progress: planProgress(plan, todayIso),
    fundedKey: null,
    monthsAway: null,
    onTime: null,
  }));
  const left = new Map(rows.map((r) => [r.plan.id, r.progress.toSave]));
  const balance = new Map(rows.map((r) => [r.plan.id, r.progress.saved]));
  const shares = allocate(rows.map((r) => r.plan), monthly);

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
    allFundedKey: rows.length && !unfunded.length ? funded.map((r) => r.fundedKey).sort().at(-1) : null,
  };
}
