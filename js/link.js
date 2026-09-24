// Talking to the bridge.
//
// This is the only file in the book that makes a network request, and it
// only ever makes one kind: asking the owner's own bridge for balances.
// Teller itself is never contacted from here — it can't be, and shouldn't
// be. See `js/core/link.js` for why the bridge exists at all.
//
// The access token is the whole credential, so it lives sealed in the
// strongbox and is only ever held in memory for the length of a request.

import { state, updateSettings, saveAccount, recordBalance } from './store.js';
import { accountFromTeller, decodeLinkToken, parseBase, planSync } from './core/link.js';
import { isUnlocked, open as openSealed, seal } from './vault.js';

const TIMEOUT_MS = 45000;

export function bridgeConnected() {
  return Boolean(state.settings.bridgeVault);
}

async function withTimeout(run) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

// Teller authenticates with the access token as an HTTP Basic username and
// no password. The bridge passes that through to Teller unchanged, so it
// never has to hold a token of its own.
function authHeader(accessToken) {
  return `Basic ${btoa(`${accessToken}:`)}`;
}

// One read of the bridge. It answers with every account the enrolment
// covers, each with its balance already attached, so the phone makes one
// request however many accounts there are.
async function read({ base, accessToken }) {
  let response;
  try {
    response = await withTimeout((signal) =>
      fetch(`${base}/accounts`, { headers: { Authorization: authHeader(accessToken) }, signal })
    );
  } catch (err) {
    if (err?.name === 'AbortError') return { ok: false, error: 'Your bridge didn’t answer in time. Banks can be slow; try again in a moment.' };
    return { ok: false, error: 'Couldn’t reach your bridge. Check it is running and that this device can see it.' };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: 'Your bridge turned that token down. Sign in at the bridge again for a new line.' };
  }
  if (response.status === 502 || response.status === 504) {
    return { ok: false, error: 'Your bridge reached Teller but got nothing back. Try again in a moment.' };
  }
  if (!response.ok) return { ok: false, error: `Your bridge answered ${response.status}.` };

  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: 'Your bridge sent something that wasn’t readable. Check it is the right address.' };
  }

  return {
    ok: true,
    accounts: Array.isArray(body?.accounts) ? body.accounts : [],
    // A bank Teller couldn't reach is reported here rather than failing the
    // whole read, so a sync can half-work and must say so.
    errors: Array.isArray(body?.errors) ? body.errors.map(String) : [],
  };
}

async function credentials() {
  if (!bridgeConnected()) throw new Error('bridge-missing');
  if (!isUnlocked()) throw new Error('vault-locked');
  const opened = await openSealed(state.settings.bridgeVault);
  const base = parseBase(opened?.base);
  if (!base.ok) throw new Error('bridge-damaged');
  return { base: base.base, accessToken: String(opened?.accessToken ?? '') };
}

// Connecting. The line is checked against the bridge before it is sealed,
// so a bridge that isn't running says so now rather than the first time the
// owner asks for figures.
export async function connectBridge(linkToken) {
  const decoded = decodeLinkToken(linkToken);
  if (!decoded.ok) return { ok: false, error: decoded.error };

  const probe = await read(decoded);
  if (!probe.ok) return { ok: false, error: probe.error };

  const bridgeVault = await seal({ base: decoded.base, accessToken: decoded.accessToken });
  await updateSettings({ bridgeVault, bridgeHost: new URL(decoded.base).host, bridgeAt: null });
  return { ok: true, offered: probe.accounts };
}

// The bridge has moved. The token is the hard part — it cost a sign-in at
// each bank — and the book is holding it, so re-pointing at a new address
// must never mean enrolling all over again. The new address is proved before
// the old one is given up.
export async function moveBridge(address) {
  const base = parseBase(address);
  if (!base.ok) return { ok: false, error: base.error };

  const current = await credentials();
  const probe = await read({ base: base.base, accessToken: current.accessToken });
  if (!probe.ok) return { ok: false, error: probe.error };

  const bridgeVault = await seal({ base: base.base, accessToken: current.accessToken });
  await updateSettings({ bridgeVault, bridgeHost: new URL(base.base).host });
  return { ok: true, offered: probe.accounts };
}

export async function forgetBridge() {
  await updateSettings({ bridgeVault: null, bridgeHost: '', bridgeAt: null });
}

export async function fetchBalances() {
  return read(await credentials());
}

// One sync: read the bridge, work out what actually moved, and write only
// that. A balance that hasn't changed is not a new reading, so the history
// doesn't fill up with identical entries from a daily habit.
export async function syncNow() {
  const result = await fetchBalances();
  if (!result.ok) return result;

  const plan = planSync(state.accounts, result.accounts, {
    today: state.today,
    currency: state.settings.currency,
  });

  const at = new Date().toISOString();
  for (const update of plan.changed) {
    await recordBalance(update.id, update.cents, update.date);
  }
  // Every followed account was looked at, whether or not it moved.
  for (const update of plan.updates) {
    const account = state.accounts.find((a) => a.id === update.id);
    if (account?.link) await saveAccount({ link: { ...account.link, lastSyncAt: at } }, update.id);
  }
  await updateSettings({ bridgeAt: at });

  return { ok: true, ...plan, errors: result.errors };
}

// Taking up an account the bridge offers that the book hasn't got yet.
export async function adoptAccount(tellerAccount) {
  const fields = accountFromTeller(tellerAccount, { today: state.today });
  const existing = state.accounts.find((a) => a.name.toLowerCase() === fields.name.toLowerCase() && !a.link);
  // An account already written in by hand is claimed rather than duplicated.
  return saveAccount(fields, existing?.id ?? null);
}

export function describeLinkError(err) {
  switch (err?.message) {
    case 'bridge-missing':
      return 'No bridge is connected yet. Connect one in the endpapers.';
    case 'vault-locked':
      return 'The strongbox holds the bridge’s token, so open it first.';
    case 'bridge-damaged':
      return 'What the book has sealed for the bridge no longer reads as an address. Connect the bridge again.';
    default:
      return null;
  }
}
