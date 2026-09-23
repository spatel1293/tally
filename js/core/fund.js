// The fund itself: the accounts money actually sits in, what each one is
// worth, what it earns, and whether the pots claimed against it add up.
//
// account = { id, name, institution, kind, role, apyBp, mfa, reviewedAt,
//             notes, vault, balance, balanceAt, history, order }
//
// `balance` is what the account is worth, as of `balanceAt` — a figure read
// off a statement, not one derived from a ledger. Each time it is restated
// the previous figure is kept in `history`, so the fund has a past without
// anything having to be logged day to day.
//
// Pure: no DOM, no storage, no dates beyond the ones handed in.

import { daysBetween, monthKey } from './dates.js';
import { BP, planKind } from './plans.js';

// What is left over in a month, stated rather than derived. Version 5 stopped
// logging spending, so the surplus comes from two figures in Settings.
export function surplus(settings) {
  const income = Math.max(0, settings.monthlyIncome ?? 0);
  const outgoings = Math.max(0, settings.monthlyOutgoings ?? 0);
  return { income, outgoings, surplus: Math.max(0, income - outgoings), negative: outgoings > income };
}

export function fundTotal(accounts) {
  let total = 0;
  for (const a of accounts) total += a.balance ?? 0;
  return total;
}

// What the fund earns as one number: every account's rate, weighted by what
// it holds. Money owed (a card balance) earns nothing and is left out, or a
// debt at 0% would drag the average of the savings down with it.
export function weightedApy(accounts) {
  let held = 0;
  let earned = 0;
  for (const a of accounts) {
    const balance = a.balance ?? 0;
    if (balance <= 0) continue;
    held += balance;
    earned += (balance * (a.apyBp ?? 0)) / BP;
  }
  if (!held) return 0;
  return Math.round((earned / held) * BP);
}

// A year of yield at today's balances and rates — what the fund makes while
// you do nothing at all.
export function yearlyYield(accounts) {
  let total = 0;
  for (const a of accounts) {
    const balance = a.balance ?? 0;
    if (balance > 0) total += Math.round((balance * (a.apyBp ?? 0)) / BP);
  }
  return total;
}

export function byRole(accounts) {
  const map = new Map();
  for (const a of accounts) {
    const role = a.role ?? 'other';
    map.set(role, (map.get(role) ?? 0) + (a.balance ?? 0));
  }
  return map;
}

// Do the pots add up to the accounts? Each pot can name the account it lives
// in; this checks the claims against the balance. Money in an account with no
// pot claiming it is "unassigned" — fine, but worth seeing. A pot claiming
// more than its account holds is not fine, and is what `short` reports.
export function reconcile(accounts, plans) {
  const rows = accounts.map((account) => {
    const held = plans.filter((p) => p.accountId === account.id);
    const claimed = held.reduce((s, p) => s + (p.saved ?? 0), 0);
    const balance = account.balance ?? 0;
    return { account, plans: held, claimed, balance, difference: balance - claimed, short: claimed > balance };
  });
  const homeless = plans.filter((p) => !p.accountId || !accounts.some((a) => a.id === p.accountId));
  return {
    rows,
    short: rows.filter((r) => r.short),
    homeless,
    unassigned: rows.reduce((s, r) => s + Math.max(0, r.difference), 0),
  };
}

// Every balance ever recorded for an account, newest first, with what changed
// between each reading. The history is the fund's only ledger now.
export function balanceHistory(account) {
  const entries = [...(account.history ?? [])];
  if (account.balanceAt) entries.push({ date: account.balanceAt, cents: account.balance ?? 0 });
  entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return entries.map((entry, i) => {
    const previous = entries[i + 1];
    return { ...entry, change: previous ? entry.cents - previous.cents : null };
  });
}

// What the whole fund was worth at each of the last `months` month-ends, from
// the readings on record. A month with no reading carries the last one
// forward, which is what a statement would show.
export function fundHistory(accounts, months = 6) {
  const keys = [];
  const seen = new Set();
  for (const a of accounts) {
    for (const e of balanceHistory(a)) {
      const key = monthKey(e.date);
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  keys.sort();
  const recent = keys.slice(-months);
  return recent.map((key) => {
    let total = 0;
    for (const a of accounts) {
      const upTo = balanceHistory(a).filter((e) => monthKey(e.date) <= key);
      if (upTo.length) total += upTo[0].cents;
    }
    return { key, total };
  });
}

export const STALE_AFTER_DAYS = 180;

export function staleAccounts(accounts, todayIso, days = STALE_AFTER_DAYS) {
  return accounts.filter((a) => !a.reviewedAt || daysBetween(a.reviewedAt, todayIso) > days);
}

// An account whose balance hasn't been restated in a while: the figures on
// every other screen are only as current as this.
export function unreadAccounts(accounts, todayIso, days = 90) {
  return accounts.filter((a) => !a.balanceAt || daysBetween(a.balanceAt, todayIso) > days);
}

export function investedShare(accounts, plans) {
  const total = fundTotal(accounts);
  if (total <= 0) return null;
  const invested = plans.filter((p) => planKind(p) === 'invest').reduce((s, p) => s + (p.saved ?? 0), 0);
  return Math.round((invested / total) * BP);
}
