import { parseAmount, isValidCents, isValidSignedCents, isSupportedCurrency } from './money.js';
import { isValidISODate } from './dates.js';
import { APP_NAME, BACKUP_FORMAT, DEFAULT_SETTINGS, PALETTE, ACCOUNT_ROLES, roleForKind } from './defaults.js';
import { PLAN_KINDS } from './plans.js';
import { FREQUENCIES } from './recurring.js';

export const NOTE_MAX = 500;
export const NAME_MAX = 60;

function yearOk(iso) {
  const y = Number(iso.slice(0, 4));
  return y >= 1900 && y <= 2199;
}

// input: { amount (text), type, refund, categoryId, date, note, accountId }
// Returns { ok, errors: { field: message }, value }.
export function validateTransactionInput(input, { locale, categories, accounts, plans = [] }) {
  const errors = {};
  const type = input.type === 'income' ? 'income' : input.type === 'expense' ? 'expense' : null;
  if (!type) errors.type = 'Choose expense or income.';

  const parsed = parseAmount(input.amount, { locale });
  let amount = 0;
  if (!parsed.ok) errors.amount = parsed.error;
  else if (parsed.negative) {
    errors.amount = type === 'income'
      ? 'Income can’t be negative. Log money going out as an expense.'
      : 'Amounts can’t be negative. To record money coming back, turn on Refund.';
  } else if (parsed.cents === 0) errors.amount = 'Enter an amount greater than zero.';
  else amount = parsed.cents;

  const category = categories.find((c) => c.id === input.categoryId);
  if (!input.categoryId) errors.categoryId = 'Choose a category.';
  else if (!category) errors.categoryId = 'That category no longer exists. Choose another.';

  if (!isValidISODate(input.date)) errors.date = 'Enter a valid date.';
  else if (!yearOk(input.date)) errors.date = 'Choose a date between 1900 and 2199.';

  const note = String(input.note ?? '').trim();
  if (note.length > NOTE_MAX) errors.note = `Keep the note under ${NOTE_MAX} characters.`;

  let accountId = input.accountId || null;
  if (accountId && !accounts.some((a) => a.id === accountId)) accountId = null;

  // Only spending can belong to a plan: a plan is filled by setting money
  // aside, not by earning, so income tagged to one would be counted twice.
  let planId = input.planId || null;
  if (type !== 'expense' || !plans.some((p) => p.id === planId)) planId = null;

  const ok = Object.keys(errors).length === 0;
  return {
    ok,
    errors,
    value: ok ? { type, amount, refund: type === 'expense' && Boolean(input.refund), categoryId: category.id, date: input.date, note, accountId, planId } : null,
  };
}

export function validateCategoryInput(input, categories) {
  const errors = {};
  const name = String(input.name ?? '').trim().replace(/\s+/g, ' ');
  const type = input.type === 'income' ? 'income' : 'expense';
  const parentId = input.parentId || null;
  if (!name) errors.name = 'Give the category a name.';
  else if (name.length > NAME_MAX) errors.name = `Keep the name under ${NAME_MAX} characters.`;
  else {
    const clash = categories.find(
      (c) => c.id !== input.id && c.type === type && (c.parentId ?? null) === parentId && c.name.toLowerCase() === name.toLowerCase()
    );
    if (clash) errors.name = `You already have a category called “${clash.name}”.`;
  }
  if (parentId) {
    const parent = categories.find((c) => c.id === parentId);
    if (!parent) errors.parentId = 'That parent category no longer exists.';
    else if (parent.parentId) errors.parentId = 'Subcategories can only go one level deep.';
    else if (parent.id === input.id) errors.parentId = 'A category can’t be inside itself.';
    else if (parent.type !== type) errors.parentId = 'The parent must be the same type (expense or income).';
    else if (input.id && categories.some((c) => c.parentId === input.id)) {
      errors.parentId = 'This category has subcategories, so it has to stay at the top level.';
    }
  }
  let budget = null;
  if (type === 'expense' && String(input.budget ?? '').trim() !== '') {
    const parsed = parseAmount(input.budget, { locale: input.locale });
    if (!parsed.ok) errors.budget = parsed.error;
    else if (parsed.negative) errors.budget = 'A budget can’t be negative.';
    else budget = parsed.cents;
  }
  const color = /^#[0-9a-f]{6}$/i.test(input.color ?? '') ? input.color : PALETTE[0];
  const icon = String(input.icon ?? '').trim().slice(0, 8) || '📦';
  const ok = Object.keys(errors).length === 0;
  return { ok, errors, value: ok ? { name, type, parentId, budget, color, icon } : null };
}

// ---------- Backups ----------

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function idOk(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= 64;
}

export function sanitizeTransaction(t) {
  if (!t || typeof t !== 'object') return null;
  if (!idOk(t.id)) return null;
  if (t.type !== 'income' && t.type !== 'expense') return null;
  if (!isValidCents(t.amount)) return null;
  if (!isValidISODate(t.date)) return null;
  return {
    id: t.id,
    type: t.type,
    amount: t.amount,
    refund: t.type === 'expense' && t.refund === true,
    categoryId: idOk(t.categoryId) ? t.categoryId : null,
    accountId: idOk(t.accountId) ? t.accountId : null,
    date: t.date,
    note: str(t.note, NOTE_MAX),
    recurringId: idOk(t.recurringId) ? t.recurringId : null,
    planId: idOk(t.planId) ? t.planId : null,
    createdAt: str(t.createdAt, 40) || null,
    updatedAt: str(t.updatedAt, 40) || null,
  };
}

export function sanitizeCategory(c, index) {
  if (!c || typeof c !== 'object' || !idOk(c.id)) return null;
  const name = str(c.name, NAME_MAX).trim();
  if (!name) return null;
  return {
    id: c.id,
    name,
    icon: str(c.icon, 8) || '📦',
    color: /^#[0-9a-f]{6}$/i.test(c.color ?? '') ? c.color : PALETTE[index % PALETTE.length],
    type: c.type === 'income' ? 'income' : 'expense',
    parentId: idOk(c.parentId) ? c.parentId : null,
    order: Number.isFinite(c.order) ? c.order : index,
    budget: c.budget == null ? null : Number.isSafeInteger(c.budget) && c.budget >= 0 && c.budget <= 1e11 ? c.budget : null,
  };
}

// Basis points: an integer share or rate from 0 to 100.00%.
function bpOk(v) {
  return Number.isInteger(v) && v >= 0 && v <= 10000;
}

// A sealed vault blob is opaque here: it's ciphertext, and only the owner's
// passphrase can open it. All that's checked is that it has the right shape,
// so a corrupt one is dropped rather than kept around to fail on every open.
function vaultOk(v) {
  return Boolean(v) && typeof v === 'object' && v.v === 1 && typeof v.iv === 'string' && typeof v.data === 'string' && v.iv.length <= 64 && v.data.length <= 20000;
}

export function sanitizeAccount(a, index) {
  if (!a || typeof a !== 'object' || !idOk(a.id)) return null;
  const name = str(a.name, NAME_MAX).trim();
  if (!name) return null;
  const kind = typeof a.kind === 'string' ? a.kind.slice(0, 20) : 'other';
  return {
    id: a.id,
    name,
    kind,
    openingBalance: isValidSignedCents(a.openingBalance) ? a.openingBalance : 0,
    order: Number.isFinite(a.order) ? a.order : index,
    institution: str(a.institution, NAME_MAX).trim(),
    role: a.role in ACCOUNT_ROLES ? a.role : roleForKind(kind),
    apyBp: bpOk(a.apyBp) ? a.apyBp : 0,
    mfa: a.mfa === true,
    reviewedAt: isValidISODate(a.reviewedAt) ? a.reviewedAt : null,
    notes: str(a.notes, NOTE_MAX),
    vault: vaultOk(a.vault) ? { v: 1, iv: a.vault.iv, data: a.vault.data } : null,
  };
}

export function sanitizeRule(r) {
  if (!r || typeof r !== 'object' || !idOk(r.id)) return null;
  if (r.type !== 'income' && r.type !== 'expense') return null;
  if (!isValidCents(r.amount) || !FREQUENCIES[r.frequency] || !isValidISODate(r.startDate)) return null;
  return {
    id: r.id,
    type: r.type,
    amount: r.amount,
    categoryId: idOk(r.categoryId) ? r.categoryId : null,
    accountId: idOk(r.accountId) ? r.accountId : null,
    note: str(r.note, NOTE_MAX),
    frequency: r.frequency,
    startDate: r.startDate,
    endDate: isValidISODate(r.endDate) && r.endDate >= r.startDate ? r.endDate : null,
    mode: r.mode === 'remind' ? 'remind' : 'auto',
    paused: r.paused === true,
    generatedThrough: isValidISODate(r.generatedThrough) ? r.generatedThrough : null,
  };
}

// Plans are stored under the older `goals` name so that existing data and
// backups keep working; `kind` is what separates a nest egg from a trip.
// A backup written before plans existed has no kind, and reads as a fund.
export function sanitizeGoal(g) {
  if (!g || typeof g !== 'object' || !idOk(g.id)) return null;
  const name = str(g.name, NAME_MAX).trim();
  if (!name || !isValidCents(g.target)) return null;
  const startDate = isValidISODate(g.startDate) ? g.startDate : null;
  const endDate = isValidISODate(g.endDate) ? g.endDate : null;
  return {
    id: g.id,
    name,
    kind: g.kind in PLAN_KINDS ? g.kind : 'fund',
    target: g.target,
    saved: isValidSignedCents(g.saved) ? Math.max(0, g.saved) : 0,
    targetDate: isValidISODate(g.targetDate) ? g.targetDate : null,
    startDate,
    // A trip that somehow ends before it starts would make every date
    // calculation lie, so drop the end rather than keep an impossible range.
    endDate: endDate && startDate && endDate < startDate ? null : endDate,
    color: /^#[0-9a-f]{6}$/i.test(g.color ?? '') ? g.color : PALETTE[0],
    createdAt: str(g.createdAt, 40) || null,
    apyBp: bpOk(g.apyBp) ? g.apyBp : 0,
    allocBp: bpOk(g.allocBp) ? g.allocBp : 0,
    accountId: idOk(g.accountId) ? g.accountId : null,
  };
}

export function sanitizeSettings(s) {
  const out = { ...DEFAULT_SETTINGS };
  if (!s || typeof s !== 'object') return out;
  if (isSupportedCurrency(s.currency)) out.currency = s.currency;
  if (typeof s.locale === 'string' && s.locale.length <= 35) {
    try {
      new Intl.NumberFormat(s.locale);
      out.locale = s.locale;
    } catch {
      // keep default
    }
  }
  if (['system', 'light', 'dark'].includes(s.theme)) out.theme = s.theme;
  if (Number.isInteger(s.warnPercent) && s.warnPercent >= 50 && s.warnPercent <= 100) out.warnPercent = s.warnPercent;
  if ([0, 7, 14, 30].includes(s.backupReminderDays)) out.backupReminderDays = s.backupReminderDays;
  if (typeof s.lastExportAt === 'string') out.lastExportAt = s.lastExportAt;
  if (typeof s.lastChangeAt === 'string') out.lastChangeAt = s.lastChangeAt;
  if (idOk(s.defaultAccountId)) out.defaultAccountId = s.defaultAccountId;
  if (s.csvDateOrder === 'DMY') out.csvDateOrder = 'DMY';
  if (Number.isInteger(s.runwayTarget) && s.runwayTarget >= 1 && s.runwayTarget <= 60) out.runwayTarget = s.runwayTarget;
  if (isValidCents(s.essentialMonthly) && s.essentialMonthly > 0) out.essentialMonthly = s.essentialMonthly;
  // The vault's salt and its check value are needed to open what the
  // accounts carry, so they travel with a backup. Neither is a secret.
  if (typeof s.vaultSalt === 'string' && /^[A-Za-z0-9+/=]{16,64}$/.test(s.vaultSalt)) out.vaultSalt = s.vaultSalt;
  if (vaultOk(s.vaultCheck)) out.vaultCheck = { v: 1, iv: s.vaultCheck.iv, data: s.vaultCheck.data };
  return out;
}

export function buildBackup(data, exportedAt) {
  return {
    app: APP_NAME,
    format: BACKUP_FORMAT,
    exportedAt,
    settings: data.settings,
    categories: data.categories,
    accounts: data.accounts,
    transactions: data.transactions,
    recurring: data.recurring,
    goals: data.goals,
  };
}

function cleanList(list, fn) {
  const out = [];
  let dropped = 0;
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach((item, i) => {
    const clean = fn(item, i);
    if (clean && !seen.has(clean.id)) {
      seen.add(clean.id);
      out.push(clean);
    } else dropped++;
  });
  return { out, dropped };
}

// Returns { ok, error } or { ok: true, data, dropped, exportedAt }.
export function parseBackup(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file isn’t valid JSON. Choose a backup file exported from this app.' };
  }
  if (!obj || typeof obj !== 'object' || obj.app !== APP_NAME || !Array.isArray(obj.transactions)) {
    return { ok: false, error: `This doesn’t look like a ${APP_NAME} backup. Choose a .json file exported from Settings.` };
  }
  if (typeof obj.format !== 'number' || obj.format > BACKUP_FORMAT) {
    return { ok: false, error: 'This backup was made by a newer version of the app. Update the app, then try again.' };
  }
  const categories = cleanList(obj.categories, sanitizeCategory);
  const catIds = new Set(categories.out.map((c) => c.id));
  for (const c of categories.out) if (c.parentId && !catIds.has(c.parentId)) c.parentId = null;
  const accounts = cleanList(obj.accounts, sanitizeAccount);
  const transactions = cleanList(obj.transactions, sanitizeTransaction);
  const recurring = cleanList(obj.recurring, sanitizeRule);
  const goals = cleanList(obj.goals, sanitizeGoal);
  const dropped = categories.dropped + accounts.dropped + transactions.dropped + recurring.dropped + goals.dropped;
  return {
    ok: true,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : null,
    dropped,
    data: {
      settings: sanitizeSettings(obj.settings),
      categories: categories.out,
      accounts: accounts.out,
      transactions: transactions.out,
      recurring: recurring.out,
      goals: goals.out,
    },
  };
}
