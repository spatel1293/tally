// Reading balances through a bridge.
//
// The book speaks one shape, whoever is behind the bridge. It has been
// SimpleFIN and Teller; it is Plaid now, on the free Limited Production
// allowance, because Teller stopped letting anyone sign up. The bridge
// normalises whatever the provider says into the shape below, so changing
// provider never reaches the reader — and nothing in this file knows or
// cares which one it is.
//
// A bridge is needed because every provider authenticates with a secret that
// must never live in a shipped app, and none of them serve CORS headers to a
// browser. So the secret lives in `scripts/plaid-bridge.js`, on a machine
// the owner controls, and the phone talks only to that. The path is
//
//     your bank  ->  Plaid  ->  your bridge  ->  this device
//
// and nothing of ours sits anywhere on it. The book only ever talks to the
// owner's own bridge.
//
// The access token is the credential, so it is sealed in the strongbox and a
// read only works while that is open. The token is useless without the
// certificate and the certificate is useless without the token — they are
// deliberately kept in different places.
//
// Everything in this file is pure. `js/link.js` does the talking.

// The bridge hands money over as a *decimal string* — "28575.02" — which is
// what keeps floating point out of the path entirely. Plaid sends a JSON
// number, which is a double; the bridge quotes those digits before parsing so
// that the exact figure survives into integer cents.
// Anything past two decimals is rounded, half away from zero, and a figure
// too large to be a safe integer is refused rather than mangled.
export function centsFromDecimalString(text) {
  const s = String(text ?? '').trim();
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const negative = m[1] === '-';
  const frac = m[3] ?? '';
  let cents = BigInt(m[2]) * 100n + BigInt((frac + '00').slice(0, 2));
  if (frac.length > 2 && Number(frac[2]) >= 5) cents += 1n;
  const value = Number(cents);
  if (!Number.isSafeInteger(value)) return null;
  return negative ? -value : value;
}

// The bridge's address. Plain http is allowed only on this machine: a bridge
// running on your own laptop has nowhere to be overheard, but one reached
// across a network carries a token and must be encrypted.
export function parseBase(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return { ok: false, error: 'That line doesn’t say where your bridge is.' };
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'Your bridge’s address isn’t a web address.' };
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    return { ok: false, error: 'A bridge reached over a network has to be https, or the token could be read on the way.' };
  }
  url.username = '';
  url.password = '';
  url.hash = '';
  url.search = '';
  return { ok: true, base: url.toString().replace(/\/+$/, '') };
}

// Connecting is one paste. The bridge's sign-in page hands over a single
// line carrying both where the bridge is and the token to use with it, so
// the owner never has to copy two things and get one of them wrong.
export function decodeLinkToken(token, { decode = (s) => atob(s) } = {}) {
  const trimmed = String(token ?? '').trim().replace(/\s+/g, '');
  if (!trimmed) return { ok: false, error: 'Paste the line your bridge gave you after you signed in.' };
  let text;
  try {
    text = decode(trimmed);
  } catch {
    return { ok: false, error: 'That doesn’t look like a bridge line. Copy it again from the bridge.' };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That line is damaged. Copy it again from the bridge.' };
  }
  const base = parseBase(parsed?.u);
  if (!base.ok) return base;
  const accessToken = String(parsed?.t ?? '').trim();
  if (!accessToken) return { ok: false, error: 'That line carries no token, so nothing could sign in with it.' };
  return { ok: true, base: base.base, accessToken };
}

// The provider says what kind of account it is, so nothing has to be guessed
// from a name. Subtypes are normalised first, because providers spell the
// same thing differently — "money market" and "money_market" are one thing.
export function kindForBridge(account) {
  if (String(account?.type ?? '').toLowerCase() === 'credit') return 'credit';
  const subtype = String(account?.subtype ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  const saving = ['savings', 'money_market', 'certificate_of_deposit', 'cd', 'hsa', 'prepaid', 'cash_management'];
  const invested = [
    'treasury', 'sweep', 'brokerage', 'ira', 'roth', 'roth_401k', '401k', '401a', '403b', '457b', '529',
    'retirement', 'pension', 'stock_plan', 'mutual_fund', 'sep_ira', 'simple_ira', 'rrsp', 'tfsa', 'trust',
    'ugma', 'utma', 'variable_annuity', 'non_taxable_brokerage_account', 'thrift_savings_plan', 'profit_sharing_plan',
  ];
  if (saving.includes(subtype)) return 'savings';
  if (invested.includes(subtype)) return 'brokerage';
  return 'checking';
}

export function roleForBridge(account) {
  const kind = kindForBridge(account);
  return { credit: 'spending', brokerage: 'investing', savings: 'savings', checking: 'hub' }[kind] ?? 'other';
}

// What an account is worth, from the balances the bridge returns beside it.
//
// `ledger` is everything in the account; `available` is that net of what
// hasn't cleared. A book of record wants the ledger — the figure a statement
// would print — and falls back to available only when there is no ledger.
//
// A credit card is money *owed*. Providers report it as a positive figure, but
// `fundTotal` simply adds every balance up, so a card written in as reported
// would inflate the fund by what you owe on it. It is negated here, which is
// also how anyone would write it in by hand.
export function balanceFromBridge(account) {
  const balances = account?.balance ?? {};
  const cents = centsFromDecimalString(balances.ledger) ?? centsFromDecimalString(balances.available);
  if (cents == null) return null;
  const owed = String(account?.type ?? '').toLowerCase() === 'credit';
  return owed ? -Math.abs(cents) : cents;
}

// What the bridge calls an account, and which institution it came from.
export function accountFromBridge(account, { today = null } = {}) {
  const cents = balanceFromBridge(account);
  const institution = String(account?.institution?.name ?? '').slice(0, 60);
  const lastFour = String(account?.last_four ?? '').trim().slice(0, 4);
  return {
    name: String(account?.name ?? 'Account').trim().slice(0, 60) || 'Account',
    institution,
    kind: kindForBridge(account),
    role: roleForBridge(account),
    balance: cents ?? 0,
    // These balances are live, so a reading is taken today by definition:
    // there is no statement date to file it under.
    balanceAt: cents == null ? null : today,
    link: {
      accountId: String(account?.id ?? ''),
      org: institution,
      lastFour,
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
export function planSync(accounts, bridgeAccounts, { today, currency = 'USD' } = {}) {
  const byId = new Map((bridgeAccounts ?? []).map((a) => [String(a.id), a]));
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
    if (String(found.status ?? '').toLowerCase() === 'closed') {
      problems.push({ id: account.id, name: account.name, reason: 'closed', message: `${account.name} is closed at the institution, so its balance was left as it was.` });
      continue;
    }
    const iso = String(found.currency ?? '').toUpperCase();
    if (iso && iso !== String(currency).toUpperCase()) {
      problems.push({ id: account.id, name: account.name, reason: 'currency', message: `${account.name} is reported in ${iso}, and this book is kept in ${currency}.` });
      continue;
    }
    const cents = balanceFromBridge(found);
    if (cents == null) {
      problems.push({ id: account.id, name: account.name, reason: 'no-balance', message: `${account.name} came back without a balance.` });
      continue;
    }
    updates.push({
      id: account.id,
      name: account.name,
      cents,
      date: today,
      was: account.balance ?? 0,
      changed: cents !== (account.balance ?? 0) || today !== account.balanceAt,
    });
  }

  // Accounts the bridge offers that the book hasn't taken up yet. A closed
  // one is never offered — there is nothing to follow.
  const taken = new Set(accounts.map((a) => a.link?.accountId).filter(Boolean).map(String));
  const offered = (bridgeAccounts ?? []).filter(
    (a) => !taken.has(String(a.id)) && String(a.status ?? '').toLowerCase() !== 'closed'
  );

  return { updates, problems, offered, changed: updates.filter((u) => u.changed) };
}

export function isConnected(account) {
  return Boolean(account?.link?.accountId);
}
