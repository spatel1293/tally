// Talking to the SimpleFIN bridge.
//
// This is the only file in the book that makes a network request, and it
// only ever makes two:
//
//   1. once, to claim a setup token for an access URL;
//   2. thereafter, to read balances from that access URL.
//
// Both go straight from this device to the owner's own bridge. The access
// URL is the whole credential, so it lives sealed in the strongbox and is
// only ever held in memory for the length of a request.

import { state, updateSettings, saveAccount, recordBalance } from './store.js';
import { accountFromBridge, decodeSetupToken, parseAccessUrl, planSync } from './core/link.js';
import { isUnlocked, open as openSealed, seal } from './vault.js';

const TIMEOUT_MS = 30000;

export function bridgeConnected() {
  return Boolean(state.settings.bridgeVault);
}

function authHeader(username, password) {
  return `Basic ${btoa(`${username}:${password}`)}`;
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

// Claiming is a bare POST: no body, no content type, no custom headers.
// That matters — anything else makes it a preflighted request, and the
// bridge answers the preflight for this path with a 404, so the browser
// blocks it before it is ever sent.
export async function claimSetupToken(token) {
  const decoded = decodeSetupToken(token);
  if (!decoded.ok) return { ok: false, error: decoded.error };

  let response;
  try {
    response = await withTimeout((signal) => fetch(decoded.claimUrl, { method: 'POST', signal }));
  } catch (err) {
    return { ok: false, error: err?.name === 'AbortError' ? 'The bridge didn’t answer in time. Try again.' : 'Couldn’t reach the bridge. Check the connection and try again.' };
  }
  if (response.status === 403) return { ok: false, error: 'The bridge refused that token. A setup token can only be claimed once — generate a new one.' };
  if (!response.ok) return { ok: false, error: `The bridge answered ${response.status}. Generate a new setup token and try again.` };

  const accessUrl = (await response.text()).trim();
  const parsed = parseAccessUrl(accessUrl);
  if (!parsed.ok) return { ok: false, error: `The bridge sent something unexpected back: ${parsed.error}` };
  return { ok: true, accessUrl, base: parsed.base };
}

// Seals the access URL into the strongbox. Nothing else in the book ever
// writes it down, and it never leaves this device except back to the bridge
// it came from.
export async function saveBridge(accessUrl) {
  const parsed = parseAccessUrl(accessUrl);
  if (!parsed.ok) throw new Error(parsed.error);
  const bridgeVault = await seal({ accessUrl });
  await updateSettings({ bridgeVault, bridgeHost: new URL(parsed.base).host, bridgeAt: null });
  return parsed;
}

export async function forgetBridge() {
  await updateSettings({ bridgeVault: null, bridgeHost: '', bridgeAt: null });
}

async function accessUrl() {
  if (!bridgeConnected()) throw new Error('bridge-missing');
  if (!isUnlocked()) throw new Error('vault-locked');
  const opened = await openSealed(state.settings.bridgeVault);
  return String(opened?.accessUrl ?? '');
}

// Reading balances. `balances-only` keeps the transactions this book has no
// use for from ever crossing the wire.
export async function fetchBalances() {
  const parsed = parseAccessUrl(await accessUrl());
  if (!parsed.ok) return { ok: false, error: parsed.error };

  let response;
  try {
    response = await withTimeout((signal) =>
      fetch(`${parsed.base}/accounts?balances-only=1`, {
        headers: { Authorization: authHeader(parsed.username, parsed.password) },
        signal,
      })
    );
  } catch (err) {
    return { ok: false, error: err?.name === 'AbortError' ? 'The bridge didn’t answer in time.' : 'Couldn’t reach the bridge.' };
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: 'The bridge turned that access URL down. It may have been revoked — connect the bridge again.' };
  }
  if (!response.ok) return { ok: false, error: `The bridge answered ${response.status}.` };

  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: 'The bridge sent something that wasn’t readable.' };
  }

  return {
    ok: true,
    accounts: Array.isArray(body?.accounts) ? body.accounts : [],
    // SimpleFIN reports a bank it couldn't reach here rather than failing
    // the whole call, so a sync can half-work and must say so.
    errors: Array.isArray(body?.errors) ? body.errors.map(String) : [],
  };
}

// One sync: read the bridge, work out what actually moved, and write only
// that. A balance that hasn't changed is not a new reading, so the history
// doesn't fill up with identical entries from a nightly habit.
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
  // Every connected account was looked at, whether or not it moved.
  for (const update of plan.updates) {
    const account = state.accounts.find((a) => a.id === update.id);
    if (account?.link) await saveAccount({ link: { ...account.link, lastSyncAt: at } }, update.id);
  }
  await updateSettings({ bridgeAt: at });

  return { ok: true, ...plan, errors: result.errors };
}

// Taking up an account the bridge offers that the book hasn't got yet.
export async function adoptAccount(sfAccount) {
  const fields = accountFromBridge(sfAccount, { today: state.today });
  const existing = state.accounts.find((a) => a.name.toLowerCase() === fields.name.toLowerCase() && !a.link);
  // An account already written in by hand is claimed rather than duplicated.
  return saveAccount(fields, existing?.id ?? null);
}

export function describeLinkError(err) {
  switch (err?.message) {
    case 'bridge-missing':
      return 'No bridge is connected yet. Connect one in the endpapers.';
    case 'vault-locked':
      return 'The strongbox holds the bridge’s credentials, so open it first.';
    default:
      return null;
  }
}
