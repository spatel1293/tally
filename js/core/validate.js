import { isValidCents, isValidSignedCents, isSupportedCurrency } from './money.js';
import { isValidISODate } from './dates.js';
import { APP_NAME, BACKUP_FORMAT, DEFAULT_SETTINGS, PALETTE, ACCOUNT_ROLES, roleForKind } from './defaults.js';
import { PLAN_KINDS } from './plans.js';

export const NOTE_MAX = 500;
export const NAME_MAX = 60;

function yearOk(iso) {
  const y = Number(iso.slice(0, 4));
  return y >= 1900 && y <= 2199;
}

function str(v, max) {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function idOk(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= 64;
}

function bpOk(v) {
  return Number.isInteger(v) && v >= 0 && v <= 10000;
}

// A sealed vault blob is opaque here: it's ciphertext, and only the owner's
// passphrase can open it. All that's checked is that it has the right shape,
// so a corrupt one is dropped rather than kept around to fail on every open.
// A connection to an account at the bridge: an id and where it came from.
function linkOk(v) {
  return Boolean(v) && typeof v === 'object' && typeof v.accountId === 'string' && v.accountId.length > 0 && v.accountId.length <= 200;
}

function vaultOk(v) {
  return Boolean(v) && typeof v === 'object' && v.v === 1 && typeof v.iv === 'string' && typeof v.data === 'string' && v.iv.length <= 64 && v.data.length <= 20000;
}

export function sanitizeAccount(a, index) {
  if (!a || typeof a !== 'object' || !idOk(a.id)) return null;
  const name = str(a.name, NAME_MAX).trim();
  if (!name) return null;
  const kind = typeof a.kind === 'string' ? a.kind.slice(0, 20) : 'other';
  // Every reading ever taken, oldest kept, newest first in the record. A
  // reading without a date or an amount is dropped rather than guessed at.
  const history = (Array.isArray(a.history) ? a.history : [])
    .filter((h) => h && isValidISODate(h.date) && yearOk(h.date) && isValidSignedCents(h.cents))
    .slice(0, 400)
    .map((h) => ({ date: h.date, cents: h.cents }));
  return {
    id: a.id,
    name,
    kind,
    balance: isValidSignedCents(a.balance) ? a.balance : 0,
    balanceAt: isValidISODate(a.balanceAt) && yearOk(a.balanceAt) ? a.balanceAt : null,
    history,
    order: Number.isFinite(a.order) ? a.order : index,
    institution: str(a.institution, NAME_MAX).trim(),
    role: a.role in ACCOUNT_ROLES ? a.role : roleForKind(kind),
    apyBp: bpOk(a.apyBp) ? a.apyBp : 0,
    mfa: a.mfa === true,
    reviewedAt: isValidISODate(a.reviewedAt) ? a.reviewedAt : null,
    notes: str(a.notes, NOTE_MAX),
    vault: vaultOk(a.vault) ? { v: 1, iv: a.vault.iv, data: a.vault.data } : null,
    // Which account at the bridge this entry follows. It holds no
    // credential — the access URL that can read it is sealed in settings.
    link: linkOk(a.link)
      ? {
          accountId: str(a.link.accountId, 200),
          org: str(a.link.org, NAME_MAX),
          lastFour: str(a.link.lastFour, 4),
          lastSyncAt: typeof a.link.lastSyncAt === 'string' ? a.link.lastSyncAt.slice(0, 40) : null,
        }
      : null,
  };
}

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
    icon: str(g.icon, 8),
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
  if ([0, 7, 14, 30].includes(s.backupReminderDays)) out.backupReminderDays = s.backupReminderDays;
  if (typeof s.lastExportAt === 'string') out.lastExportAt = s.lastExportAt;
  if (typeof s.lastChangeAt === 'string') out.lastChangeAt = s.lastChangeAt;
  if (Number.isInteger(s.runwayTarget) && s.runwayTarget >= 1 && s.runwayTarget <= 60) out.runwayTarget = s.runwayTarget;
  if (isValidCents(s.monthlyIncome)) out.monthlyIncome = s.monthlyIncome;
  if (isValidCents(s.monthlyOutgoings)) out.monthlyOutgoings = s.monthlyOutgoings;
  // The vault's salt and its check value are needed to open what the
  // accounts carry, so they travel with a backup. Neither is a secret.
  if (typeof s.vaultSalt === 'string' && /^[A-Za-z0-9+/=]{16,64}$/.test(s.vaultSalt)) out.vaultSalt = s.vaultSalt;
  if (vaultOk(s.vaultCheck)) out.vaultCheck = { v: 1, iv: s.vaultCheck.iv, data: s.vaultCheck.data };
  // The bridge's access URL is a credential, so it is sealed like the rest.
  // Its host and the time of the last sync are not, and are worth seeing.
  if (vaultOk(s.bridgeVault)) out.bridgeVault = { v: 1, iv: s.bridgeVault.iv, data: s.bridgeVault.data };
  if (typeof s.bridgeHost === 'string') out.bridgeHost = s.bridgeHost.slice(0, 120);
  if (typeof s.bridgeAt === 'string') out.bridgeAt = s.bridgeAt.slice(0, 40);
  return out;
}

export function buildBackup(data, exportedAt) {
  const backup = {
    app: APP_NAME,
    format: BACKUP_FORMAT,
    exportedAt,
    settings: data.settings,
    accounts: data.accounts,
    goals: data.goals,
  };
  // Anything recorded under an older version that this one no longer reads
  // travels along untouched. It is never parsed, only carried, so upgrading
  // can't be the thing that loses someone years of history.
  if (data.archive && Object.keys(data.archive).length) backup.archive = data.archive;
  return backup;
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
  if (!obj || typeof obj !== 'object' || obj.app !== APP_NAME || !Array.isArray(obj.accounts)) {
    return { ok: false, error: `This doesn’t look like a ${APP_NAME} backup. Choose a .json file exported from Settings.` };
  }
  if (typeof obj.format !== 'number' || obj.format > BACKUP_FORMAT) {
    return { ok: false, error: 'This backup was made by a newer version of the app. Update the app, then try again.' };
  }
  const accounts = cleanList(obj.accounts, sanitizeAccount);
  const acctIds = new Set(accounts.out.map((a) => a.id));
  const goals = cleanList(obj.goals, sanitizeGoal);
  // A pot pointing at an account that isn't in the file would be claimed
  // against nothing, so it comes back unplaced instead.
  for (const g of goals.out) if (g.accountId && !acctIds.has(g.accountId)) g.accountId = null;

  // Collections this version doesn't read are kept exactly as they arrived.
  const archive = { ...(obj.archive && typeof obj.archive === 'object' ? obj.archive : {}) };
  for (const key of ['transactions', 'categories', 'recurring']) {
    if (Array.isArray(obj[key]) && obj[key].length) archive[key] = obj[key];
  }
  const carried = Object.entries(archive).reduce((sum, [, v]) => sum + (Array.isArray(v) ? v.length : 0), 0);

  return {
    ok: true,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : null,
    dropped: accounts.dropped + goals.dropped,
    carried,
    data: {
      settings: sanitizeSettings(obj.settings),
      accounts: accounts.out,
      goals: goals.out,
      archive,
    },
  };
}
