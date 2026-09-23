// The vault: account numbers and logins, sealed on the device.
//
// Nothing sensitive is ever written in the clear. Each account's details are
// encrypted with AES-GCM under a key derived from a passphrase the owner
// types (PBKDF2, 300,000 rounds of SHA-256, with a random salt kept in
// settings). The passphrase itself is never stored anywhere, so a backup
// file, a synced browser profile or a stolen laptop yields only ciphertext.
// The derived key lives in memory only while the vault is open, and the
// vault closes itself after a few minutes, or when the app leaves the
// foreground — on a phone, that's the moment it goes in a pocket.
//
// This needs WebCrypto, which browsers only provide on HTTPS (and localhost).
// Over plain HTTP on the LAN the vault simply reports itself unavailable.

import { state, updateSettings } from './store.js';

const ROUNDS = 300000;
const CHECK_TEXT = 'tally-vault-check';
const AUTO_LOCK_MS = 5 * 60 * 1000;

let key = null;
let lockTimer = null;
const listeners = new Set();

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export function vaultAvailable() {
  return Boolean(globalThis.crypto?.subtle && globalThis.isSecureContext);
}

export function vaultExists() {
  return Boolean(state.settings.vaultSalt && state.settings.vaultCheck);
}

export function isUnlocked() {
  return key !== null;
}

export function onVaultChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn(isUnlocked());
}

function touch() {
  clearTimeout(lockTimer);
  lockTimer = setTimeout(lock, AUTO_LOCK_MS);
}

export function lock() {
  clearTimeout(lockTimer);
  if (key === null) return;
  key = null;
  notify();
}

async function deriveKey(passphrase, saltB64) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: unb64(saltB64), iterations: ROUNDS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function sealWith(k, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(JSON.stringify(value)));
  return { v: 1, iv: b64(iv), data: b64(data) };
}

async function openWith(k, blob) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, k, unb64(blob.data));
  return JSON.parse(new TextDecoder().decode(plain));
}

// First time: choose a passphrase. Creates the salt and a check value so a
// wrong passphrase can be told apart from a corrupt record later.
export async function createVault(passphrase) {
  if (!vaultAvailable()) throw new Error('vault-unavailable');
  if (vaultExists()) throw new Error('vault-exists');
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const k = await deriveKey(passphrase, salt);
  const check = await sealWith(k, CHECK_TEXT);
  await updateSettings({ vaultSalt: salt, vaultCheck: check });
  key = k;
  touch();
  notify();
}

// Returns true if the passphrase is right. A wrong one is the only way
// decrypting the check value fails, so that's what the failure means.
export async function unlock(passphrase) {
  if (!vaultAvailable()) throw new Error('vault-unavailable');
  if (!vaultExists()) throw new Error('vault-missing');
  const k = await deriveKey(passphrase, state.settings.vaultSalt);
  try {
    const text = await openWith(k, state.settings.vaultCheck);
    if (text !== CHECK_TEXT) return false;
  } catch {
    return false;
  }
  key = k;
  touch();
  notify();
  return true;
}

export async function seal(value) {
  if (!key) throw new Error('vault-locked');
  touch();
  return sealWith(key, value);
}

export async function open(blob) {
  if (!key) throw new Error('vault-locked');
  if (!blob) return null;
  touch();
  return openWith(key, blob);
}

// Re-seal every account under a new passphrase, then switch the check value.
// Done in memory first so a failure part way through changes nothing.
export async function changePassphrase(current, next, accounts, saveAccount) {
  if (!(await unlock(current))) return false;
  const opened = [];
  for (const a of accounts) if (a.vault) opened.push([a.id, await open(a.vault)]);
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const k = await deriveKey(next, salt);
  const check = await sealWith(k, CHECK_TEXT);
  const sealed = [];
  for (const [id, value] of opened) sealed.push([id, await sealWith(k, value)]);
  await updateSettings({ vaultSalt: salt, vaultCheck: check });
  for (const [id, vault] of sealed) await saveAccount({ vault }, id);
  key = k;
  touch();
  notify();
  return true;
}

// A pocketed phone should not be an open vault.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') lock();
});

export function describeVaultError(err) {
  switch (err?.message) {
    case 'vault-unavailable':
      return 'Secure details need the installed app or an https address. They aren’t available over a plain http link.';
    case 'vault-locked':
      return 'The vault is locked. Enter your passphrase to open it.';
    default:
      return null;
  }
}
