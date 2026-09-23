// The review a planner would do each quarter, as a checklist that can be
// computed: is the safety net deep enough, do the pots add up to the money,
// are the balances current, is every login protected, are the rates still
// worth having, is every spare dollar told where to go, is every dated pot on
// track, is there a backup. Pure — the views only render the result.

import { fundTotal, reconcile, staleAccounts, STALE_AFTER_DAYS, surplus as surplusOf, unreadAccounts, weightedApy } from './fund.js';
import { allocate, BP, planKind, projectPlans, runway, safetyPlan } from './plans.js';

const list = (names, max = 3) => (names.length > max ? `${names.slice(0, max).join(', ')} and ${names.length - max} more` : names.join(', '));
const pct = (bp) => `${(bp / 100).toFixed(bp % 100 ? 2 : 0)}%`;

// `money` formats cents for the sentences below. It is passed in rather than
// imported so this file stays free of the locale and currency the view owns.
export function advisorReview({ plans, accounts, settings, todayIso, money = (c) => String(Math.round(c / 100)) }) {
  const checks = [];
  const cash = surplusOf(settings);
  const spare = cash.surplus;
  const target = settings.runwayTarget ?? 6;
  const safety = safetyPlan(plans);
  const months = safety && cash.outgoings > 0 ? runway(safety.saved ?? 0, cash.outgoings) : null;
  const total = fundTotal(accounts);

  checks.push({
    id: 'safety',
    ok: Boolean(safety) && months != null && months >= target,
    title: !safety
      ? 'No safety net yet'
      : months == null
        ? 'Safety net can’t be measured yet'
        : months >= target
          ? `Safety net covers ${fmt(months)} months`
          : `Safety net covers ${fmt(months)} of ${target} months`,
    detail: !safety
      ? 'Mark one pot as the safety net so Tally can measure how many months it would carry you.'
      : months == null
        ? 'Put what a month costs into Settings, and this becomes a number of months.'
        : months >= target
          ? `Above your ${target}-month target.`
          : `Keep feeding it: the target is ${target} months of outgoings.`,
    route: 'plans',
  });

  const recon = reconcile(accounts, plans);
  checks.push({
    id: 'reconciled',
    ok: accounts.length > 0 && recon.short.length === 0 && recon.homeless.length === 0,
    title: !accounts.length
      ? 'No accounts recorded'
      : recon.short.length
        ? `${recon.short.length === 1 ? 'A pot claims' : `${recon.short.length} accounts hold less than the pots claim`}`
        : recon.homeless.length
          ? `${recon.homeless.length === 1 ? '1 pot isn’t' : `${recon.homeless.length} pots aren’t`} kept anywhere`
          : 'Every pot adds up to the money behind it',
    detail: !accounts.length
      ? 'Add the accounts the fund actually sits in.'
      : recon.short.length
        ? `${list(recon.short.map((r) => r.account.name))} hold${recon.short.length === 1 ? 's' : ''} less than the pots kept there claim.`
        : recon.homeless.length
          ? `${list(recon.homeless.map((p) => p.name))} — say which account holds ${recon.homeless.length === 1 ? 'it' : 'them'}.`
          : `${money(recon.unassigned)} is in the accounts with no pot claiming it.`,
    route: 'accounts',
  });

  const unread = unreadAccounts(accounts, todayIso);
  checks.push({
    id: 'current',
    ok: accounts.length > 0 && unread.length === 0,
    title: !accounts.length ? 'Nothing to read yet' : unread.length ? `${unread.length === 1 ? '1 balance is' : `${unread.length} balances are`} more than 3 months old` : 'Every balance is current',
    detail: unread.length ? `Every figure in here is only as good as its last reading: ${list(unread.map((a) => a.name))}.` : 'All read within the last three months.',
    route: 'accounts',
  });

  const noMfa = accounts.filter((a) => !a.mfa);
  checks.push({
    id: 'mfa',
    ok: accounts.length > 0 && noMfa.length === 0,
    title: !accounts.length ? 'No logins recorded' : noMfa.length ? `${noMfa.length === 1 ? '1 login is' : `${noMfa.length} logins are`} missing two-step sign-in` : 'Two-step sign-in on every login',
    detail: !accounts.length ? 'Add your accounts so their security lives with them.' : noMfa.length ? list(noMfa.map((a) => a.name)) : 'Every login has a second step.',
    route: 'accounts',
  });

  const stale = staleAccounts(accounts, todayIso);
  checks.push({
    id: 'reviewed',
    ok: accounts.length > 0 && stale.length === 0,
    title: !accounts.length ? 'Nothing to review yet' : stale.length ? `${stale.length === 1 ? '1 account hasn’t' : `${stale.length} accounts haven’t`} been reviewed in 6 months` : 'Every account reviewed recently',
    detail: stale.length ? `Rates move. Check ${list(stale.map((a) => a.name))} and mark ${stale.length === 1 ? 'it' : 'them'} reviewed.` : `All checked within ${STALE_AFTER_DAYS / 30} months.`,
    route: 'accounts',
  });

  const shares = allocate(plans, spare);
  checks.push({
    id: 'allocation',
    ok: plans.length > 0 && shares.sharedBp === BP,
    title: !plans.length
      ? 'No pots yet'
      : shares.sharedBp === 0
        ? 'The surplus has nowhere to go'
        : shares.sharedBp < BP
          ? `${pct(BP - shares.sharedBp)} of each month’s surplus is unallocated`
          : shares.sharedBp > BP
            ? `Shares add up to ${pct(shares.sharedBp)}`
            : 'Every spare dollar has a job',
    detail: !plans.length
      ? 'Add a pot and give it a share of what’s left each month.'
      : shares.sharedBp === BP
        ? 'The shares add up to 100%.'
        : shares.sharedBp > BP
          ? 'Bring the shares back to 100% — more than that can’t be paid.'
          : 'Give the rest a share so it isn’t left to drift.',
    route: 'plans',
  });

  const projection = projectPlans(plans, { monthly: spare, todayIso });
  const dated = projection.rows.filter((r) => r.plan.targetDate && !r.progress.done);
  const late = projection.rows.filter((r) => r.onTime === false || (!r.fundedKey && r.plan.targetDate));
  checks.push({
    id: 'on-track',
    ok: dated.length > 0 && late.length === 0,
    title: !dated.length ? 'No dated pots' : late.length ? `${late.length === 1 ? '1 pot misses its date' : `${late.length} pots miss their dates`}` : 'Every dated pot is on track',
    detail: !dated.length
      ? 'A date turns a wish into a plan; add one to see whether it’s reachable.'
      : late.length
        ? `At ${money(spare)} a month: ${list(late.map((r) => r.plan.name))}.`
        : `At ${money(spare)} a month, everything arrives on time.`,
    route: 'plans',
  });

  const { lastExportAt, lastChangeAt } = settings;
  const backedUp = Boolean(lastExportAt) && (!lastChangeAt || lastExportAt >= lastChangeAt);
  checks.push({
    id: 'backup',
    ok: backedUp || (!accounts.length && !plans.length),
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
    detail: invest.length ? list(invest.map((p) => p.name)) : 'Once the safety net is funded, a pot set to invest is how money compounds rather than just sits.',
    route: 'plans',
  });

  return {
    checks,
    attention: checks.filter((c) => !c.ok),
    score: checks.filter((c) => c.ok).length,
    money: cash,
    spare,
    total,
    apyBp: weightedApy(accounts),
    runway: months,
    runwayTarget: target,
    safety,
    reconciliation: recon,
    allocated: shares.allocated,
    unallocated: shares.unallocated,
    // The share of what comes in that is set aside.
    savingsRate: cash.income > 0 ? Math.round((shares.allocated / cash.income) * 100) : null,
  };
}

function fmt(m) {
  return Number.isInteger(m) ? String(m) : m.toFixed(1);
}
