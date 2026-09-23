// The review a planner would do once a quarter, as a checklist that can be
// computed: is the safety net deep enough, is every login protected, are the
// rates current, is every spare dollar told where to go, is every dated plan
// on track, is there a backup. Pure — the views only render the result.

import { daysBetween } from './dates.js';
import { allocate, BP, essentialMonthly, monthlySurplus, planKind, projectPlans, runway, safetyPlan } from './plans.js';

export const REVIEW_EVERY_DAYS = 180;

export function advisorReview({ plans, accounts, categories, transactions, settings, todayIso }) {
  const checks = [];
  const surplus = monthlySurplus(transactions, todayIso);
  const typical = Math.max(0, surplus.typical);
  const essentials = settings.essentialMonthly ?? essentialMonthly(categories, transactions, todayIso);
  const target = settings.runwayTarget ?? 6;
  const safety = safetyPlan(plans);
  const months = safety ? runway(safety.saved ?? 0, essentials) : null;

  checks.push({
    id: 'safety',
    ok: Boolean(safety) && months != null && months >= target,
    title: !safety ? 'No safety net yet' : months == null ? 'Safety net can’t be measured yet' : months >= target ? `Safety net covers ${months} months` : `Safety net covers ${months} of ${target} months`,
    detail: !safety
      ? 'Mark one plan as your safety net so Tally can measure how many months it would carry you.'
      : months == null
        ? 'Set monthly budgets, or log a few months of spending, so there’s a monthly figure to measure against.'
        : months >= target
          ? `Above your ${target}-month target.`
          : `Keep feeding it: the target is ${target} months of essentials.`,
    route: 'goals',
  });

  const noMfa = accounts.filter((a) => !a.mfa);
  checks.push({
    id: 'mfa',
    ok: accounts.length > 0 && noMfa.length === 0,
    title: !accounts.length ? 'No accounts recorded' : noMfa.length ? `${noMfa.length === 1 ? '1 account is' : `${noMfa.length} accounts are`} missing two-factor sign-in` : 'Two-factor sign-in on every account',
    detail: !accounts.length ? 'Add your accounts so their details, rates and security live in one place.' : noMfa.length ? noMfa.map((a) => a.name).join(', ') : 'Every login has a second step.',
    route: 'accounts',
  });

  const stale = accounts.filter((a) => !a.reviewedAt || daysBetween(a.reviewedAt, todayIso) > REVIEW_EVERY_DAYS);
  checks.push({
    id: 'reviewed',
    ok: accounts.length > 0 && stale.length === 0,
    title: !accounts.length ? 'Nothing to review yet' : stale.length ? `${stale.length === 1 ? '1 account hasn’t' : `${stale.length} accounts haven’t`} been reviewed in 6 months` : 'Every account reviewed recently',
    detail: stale.length ? `Rates move. Check ${stale.map((a) => a.name).join(', ')} and mark ${stale.length === 1 ? 'it' : 'them'} reviewed.` : 'Rates and details checked within the last six months.',
    route: 'accounts',
  });

  const shares = allocate(plans, typical);
  const sharedPct = Math.round((shares.sharedBp / BP) * 100);
  checks.push({
    id: 'allocation',
    ok: plans.length > 0 && shares.sharedBp === BP,
    title: !plans.length ? 'No plans yet' : shares.sharedBp === 0 ? 'Surplus has nowhere to go' : shares.sharedBp < BP ? `${100 - sharedPct}% of each month’s surplus is unallocated` : shares.sharedBp > BP ? `Shares add up to ${sharedPct}%` : 'Every spare dollar has a job',
    detail: !plans.length ? 'Add a plan and give it a share of what’s left each month.' : shares.sharedBp === BP ? 'The shares add up to 100%.' : shares.sharedBp > BP ? 'Bring the shares back to 100% — more than that can’t be paid.' : 'Give the rest a share so it isn’t left to drift.',
    route: 'goals',
  });

  const projection = projectPlans(plans, transactions, { monthly: typical, todayIso });
  const dated = projection.rows.filter((r) => r.plan.targetDate && !r.progress.done);
  const late = projection.rows.filter((r) => r.onTime === false || (!r.fundedKey && r.plan.targetDate));
  checks.push({
    id: 'on-track',
    ok: dated.length > 0 && late.length === 0,
    title: !dated.length ? 'No dated plans' : late.length ? `${late.length === 1 ? '1 plan misses its date' : `${late.length} plans miss their dates`}` : 'Every dated plan is on track',
    detail: !dated.length ? 'A date turns a wish into a plan; add one to see if it’s reachable.' : late.length ? `At about ${typical > 0 ? '' : 'nothing '}a month: ${late.map((r) => r.plan.name).join(', ')}.` : `At about the usual surplus, everything arrives on time.`,
    route: 'goals',
  });

  const { lastExportAt, lastChangeAt } = settings;
  const backedUp = Boolean(lastExportAt) && (!lastChangeAt || lastExportAt >= lastChangeAt);
  checks.push({
    id: 'backup',
    ok: backedUp || !transactions.length,
    title: backedUp ? 'Backed up since the last change' : lastExportAt ? 'Changes since the last backup' : 'No backup yet',
    detail: backedUp ? 'A copy exists outside this device.' : 'This device holds the only copy of everything here.',
    route: 'settings',
  });

  const invest = plans.filter((p) => planKind(p) === 'invest' && (p.allocBp ?? 0) > 0);
  checks.push({
    id: 'invest',
    ok: invest.length > 0,
    soft: true,
    title: invest.length ? 'Something is growing long term' : 'Nothing set to grow long term',
    detail: invest.length ? invest.map((p) => p.name).join(', ') : 'Once the safety net is funded, an investment plan with a share of the surplus is how money compounds.',
    route: 'goals',
  });

  const income = surplus.monthsUsed ? Math.round(surplus.months.filter((m) => m.count > 0).reduce((s, m) => s + m.income, 0) / surplus.monthsUsed) : 0;
  return {
    checks,
    attention: checks.filter((c) => !c.ok),
    score: checks.filter((c) => c.ok).length,
    surplus,
    essentials,
    runway: months,
    runwayTarget: target,
    safety,
    allocated: shares.allocated,
    unallocated: shares.unallocated,
    // The share of a typical month's income that is set aside.
    savingsRate: income > 0 ? Math.round((shares.allocated / income) * 100) : null,
  };
}
