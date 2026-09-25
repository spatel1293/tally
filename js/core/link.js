// Reading balances from a SimpleFIN bridge.
//
// SimpleFIN is the one aggregator that fits this book. The owner signs up
// with the bridge themselves and connects their own banks there; the bridge
// hands out an *access URL* that carries its own credentials; and the API is
// a single authenticated GET that the bridge serves with CORS headers — so
// the phone talks to it directly. There is no server of ours in the middle,
// no client secret, and no account of ours anywhere: the path is
//
//     your bank  →  your SimpleFIN bridge  →  this device
//
// The access URL is the whole credential, so it is sealed in the strongbox
// and a sync only works while that is open.
//
// Everything in this file is pure. `js/link.js` does the talking.

// SimpleFIN reports money as a *decimal string* — "114265.51" — which is a
// gift: it converts to exact cents with no floating point anywhere in the
// path. Anything past two decimals is rounded, half away from zero, and a
// figure too large to be a safe integer is refused rather than mangled.
export function centsFromDecimalString(text) {
  const s = String(text ?? '').trim();
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const negative = m[1] === '-';
  const frac = m[2 + 1] ?? '';
  let cents = BigInt(m[2]) * 100n + BigInt((frac + '00').slice(0, 2));
  if (frac.length > 2 && Number(frac[2]) >= 5) cents += 1n;
  const value = Number(cents);
  if (!Number.isSafeInteger(value)) return null;
  return negative ? -value : value;
}

// `balance-date` is epoch seconds. A balance belongs to the day it was read
// in the reader's own timezone, which is the day they would write down.
export function dateFromEpoch(seconds, { now = () => new Date() } = {}) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  const d = new Date(seconds * 1000);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// A setup token is base64 of the one-time claim URL.
export function decodeSetupToken(token, { decode = (s) => atob(s) } = {}) {
  const trimmed = String(token ?? '').trim().replace(/\s+/g, '');
  if (!trimmed) return { ok: false, error: 'Paste the setup token from your SimpleFIN bridge.' };
  let url;
  try {
    url = decode(trimmed);
  } catch {
    return { ok: false, error: 'That doesn’t look like a setup token. Copy it again from the bridge.' };
  }
  if (!/^https:\/\/[^\s]+$/i.test(url)) {
    return { ok: false, error: 'That token doesn’t decode to an https address, so it isn’t a setup token.' };
  }
  return { ok: true, claimUrl: url };
}

// An access URL carries its credentials in front of the host. A browser
// refuses to fetch a URL written that way, so the two halves are separated
// here and the credentials are sent as an Authorization header instead —
// which is exactly the header the bridge allows through CORS.
export function parseAccessUrl(accessUrl) {
  const raw = String(accessUrl ?? '').trim();
  if (!/^https:\/\//i.test(raw)) return { ok: false, error: 'An access URL starts with https://.' };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'That isn’t a web address.' };
  }
  if (!url.username) return { ok: false, error: 'That access URL has no credentials in it, so nothing could sign in with it.' };
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  url.username = '';
  url.password = '';
  const base = url.toString().replace(/\/+$/, '');
  return { ok: true, base, username, password };
}

export function kindForBridge(account) {
  const name = `${account?.name ?? ''} ${account?.org?.name ?? ''}`.toLowerCase();
  if (/credit|card|visa|mastercard|amex/.test(name)) return 'credit';
  if (/broker|invest|stock|ira|401|roth|securities|portfolio|wealthfront|betterment|robinhood|schwab|fidelity|vanguard|e\*?trade|merrill|ameritrade|sofi invest/.test(name)) return 'brokerage';
  if (/saving|reserve|cash|money market/.test(name)) return 'savings';
  return 'checking';
}

export function roleForBridge(account) {
  const kind = kindForBridge(account);
  return { credit: 'spending', brokerage: 'investing', savings: 'savings', checking: 'hub' }[kind] ?? 'other';
}

// What the bridge calls an account, and which institution it came from.
// SimpleFIN's `org` is the bank; its `name` is the account at that bank.
export function accountFromBridge(sfAccount, { today = null } = {}) {
  const cents = centsFromDecimalString(sfAccount?.balance);
  const read = dateFromEpoch(sfAccount?.['balance-date']);
  return {
    name: String(sfAccount?.name ?? 'Account').trim().slice(0, 60) || 'Account',
    institution: String(sfAccount?.org?.name ?? sfAccount?.org?.domain ?? '').slice(0, 60),
    kind: kindForBridge(sfAccount),
    role: roleForBridge(sfAccount),
    balance: cents ?? 0,
    balanceAt: cents == null ? null : read ?? today,
    link: {
      accountId: String(sfAccount?.id ?? ''),
      org: String(sfAccount?.org?.name ?? sfAccount?.org?.domain ?? '').slice(0, 60),
      lastSyncAt: null,
    },
  };
}

// What a sync should change, and what it must leave alone.
//
// Only the balance and the date it was read are ever taken from the bridge.
// The name you gave the account, the job you gave it, the rate you wrote
// down, the pots kept in it and everything sealed in the strongbox stay
// yours — a bank renaming "Individual" to "Individual Brokerage" must not
// rewrite your book.
//
// `changed` says whether the figure actually moved, so a sync that finds
// nothing new writes nothing at all.
export function planSync(accounts, sfAccounts, { today, currency = 'USD' } = {}) {
  const byId = new Map((sfAccounts ?? []).map((a) => [String(a.id), a]));
  const updates = [];
  const problems = [];

  for (const account of accounts) {
    const id = account.link?.accountId;
    if (!id) continue;
    const found = byId.get(String(id));
    if (!found) {
      problems.push({ id: account.id, name: account.name, reason: 'gone', message: `${account.name} is no longer offered by the bridge.` });
      continue;
    }
    const iso = String(found.currency ?? '').toUpperCase();
    if (iso && iso !== String(currency).toUpperCase()) {
      problems.push({ id: account.id, name: account.name, reason: 'currency', message: `${account.name} is reported in ${iso}, and this book is kept in ${currency}.` });
      continue;
    }
    const cents = centsFromDecimalString(found.balance);
    if (cents == null) {
      problems.push({ id: account.id, name: account.name, reason: 'no-balance', message: `${account.name} came back without a balance.` });
      continue;
    }
    const date = dateFromEpoch(found['balance-date']) ?? today;
    updates.push({
      id: account.id,
      name: account.name,
      cents,
      date,
      was: account.balance ?? 0,
      changed: cents !== (account.balance ?? 0) || date !== account.balanceAt,
    });
  }

  // Accounts the bridge offers that the book hasn't taken up yet.
  const taken = new Set(accounts.map((a) => a.link?.accountId).filter(Boolean).map(String));
  const offered = (sfAccounts ?? []).filter((a) => !taken.has(String(a.id)));

  return { updates, problems, offered, changed: updates.filter((u) => u.changed) };
}

export function isConnected(account) {
  return Boolean(account?.link?.accountId);
}
