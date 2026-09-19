// Recurring rules.
//
// rule = { id, type, amount, categoryId, accountId, note, frequency,
//          startDate, endDate, mode: 'auto' | 'remind', paused,
//          generatedThrough }
//
// Occurrence n is always computed from startDate (never chained from the
// previous occurrence), so a rule on the 31st lands on Feb 28/29 and then
// returns to Mar 31. `generatedThrough` is the last occurrence that was
// logged or skipped. Together with a (ruleId, date) duplicate check, this
// makes generation safe to run any number of times.

import { addDays, addMonthsClamped, daysBetween, monthsBetween } from './dates.js';
import { scaleCents } from './money.js';

export const FREQUENCIES = {
  weekly: { label: 'Every week', perYear: 52 },
  biweekly: { label: 'Every 2 weeks', perYear: 26 },
  monthly: { label: 'Every month', perYear: 12 },
  quarterly: { label: 'Every 3 months', perYear: 4 },
  yearly: { label: 'Every year', perYear: 1 },
};

const MAX_ITERATIONS = 10000;
export const MAX_GENERATED_PER_RUN = 2000;

export function nthOccurrence(rule, n) {
  switch (rule.frequency) {
    case 'weekly':
      return addDays(rule.startDate, 7 * n);
    case 'biweekly':
      return addDays(rule.startDate, 14 * n);
    case 'monthly':
      return addMonthsClamped(rule.startDate, n);
    case 'quarterly':
      return addMonthsClamped(rule.startDate, 3 * n);
    case 'yearly':
      return addMonthsClamped(rule.startDate, 12 * n);
    default:
      throw new Error(`Unknown frequency: ${rule.frequency}`);
  }
}

// A safe (never too high) index to start scanning from.
function startIndex(rule, afterExclusive) {
  if (!afterExclusive || afterExclusive <= rule.startDate) return 0;
  switch (rule.frequency) {
    case 'weekly':
      return Math.max(0, Math.floor(daysBetween(rule.startDate, afterExclusive) / 7) - 1);
    case 'biweekly':
      return Math.max(0, Math.floor(daysBetween(rule.startDate, afterExclusive) / 14) - 1);
    case 'monthly':
      return Math.max(0, monthsBetween(rule.startDate, afterExclusive) - 1);
    case 'quarterly':
      return Math.max(0, Math.floor(monthsBetween(rule.startDate, afterExclusive) / 3) - 1);
    case 'yearly':
      return Math.max(0, Math.floor(monthsBetween(rule.startDate, afterExclusive) / 12) - 1);
    default:
      return 0;
  }
}

// Occurrence dates d with afterExclusive < d <= throughInclusive (and d <= endDate).
export function occurrencesBetween(rule, afterExclusive, throughInclusive, max = MAX_ITERATIONS) {
  const out = [];
  if (!rule.startDate || !throughInclusive || throughInclusive < rule.startDate) return out;
  const limit = rule.endDate && rule.endDate < throughInclusive ? rule.endDate : throughInclusive;
  let n = startIndex(rule, afterExclusive);
  for (let i = 0; i < MAX_ITERATIONS && out.length < max; i++, n++) {
    const d = nthOccurrence(rule, n);
    if (d > limit) break;
    if (!afterExclusive || d > afterExclusive) out.push(d);
  }
  return out;
}

export function nextOccurrence(rule, afterExclusive) {
  let n = startIndex(rule, afterExclusive);
  for (let i = 0; i < MAX_ITERATIONS; i++, n++) {
    const d = nthOccurrence(rule, n);
    if (rule.endDate && d > rule.endDate) return null;
    if (!afterExclusive || d > afterExclusive) return d;
  }
  return null;
}

export function lastHandled(rule) {
  return rule.generatedThrough ?? addDays(rule.startDate, -1);
}

// The next date the rule will produce, counting unhandled past dates.
export function nextDue(rule) {
  return nextOccurrence(rule, lastHandled(rule));
}

export function transactionFromRule(rule, date, id, nowIso) {
  return {
    id,
    type: rule.type,
    amount: rule.amount,
    refund: false,
    categoryId: rule.categoryId,
    accountId: rule.accountId ?? null,
    date,
    note: rule.note ?? '',
    recurringId: rule.id,
    // A repeating entry belongs to no plan; set explicitly so every
    // transaction the app creates has the same shape as one that has been
    // through a backup and back.
    planId: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

// Creates transactions for automatic rules and lists due dates for
// reminder rules. Pure: returns what should change, touches nothing.
export function processRecurring(rules, transactions, todayIso, makeId, nowIso) {
  const existing = new Set();
  for (const t of transactions) if (t.recurringId) existing.add(`${t.recurringId}|${t.date}`);
  const newTransactions = [];
  const updatedRules = [];
  const reminders = [];
  for (const rule of rules) {
    if (rule.paused) continue;
    const budgetLeft = MAX_GENERATED_PER_RUN - newTransactions.length;
    if (rule.mode === 'auto') {
      if (budgetLeft <= 0) break;
      const due = occurrencesBetween(rule, lastHandled(rule), todayIso, budgetLeft);
      if (!due.length) continue;
      for (const date of due) {
        const key = `${rule.id}|${date}`;
        if (existing.has(key)) continue;
        existing.add(key);
        newTransactions.push(transactionFromRule(rule, date, makeId(), nowIso));
      }
      updatedRules.push({ ...rule, generatedThrough: due[due.length - 1] });
    } else {
      const due = occurrencesBetween(rule, lastHandled(rule), todayIso, 100);
      if (due.length) reminders.push({ rule, dates: due });
    }
  }
  return { newTransactions, updatedRules, reminders };
}

// Approximate monthly cost of a rule, for summaries.
export function monthlyEquivalent(rule) {
  const f = FREQUENCIES[rule.frequency];
  if (!f) return 0;
  return scaleCents(rule.amount, f.perYear, 12);
}

export function isFinished(rule, todayIso) {
  return Boolean(rule.endDate && rule.endDate < todayIso && nextDue(rule) === null);
}
