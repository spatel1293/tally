// Application state and every change to it.
//
// Rule of the house: write to storage first, then update memory and the UI.
// If a write fails the call throws, the UI keeps the user's input on screen,
// and nothing is shown as saved that wasn't.

import { openStorage, requestPersistence, STORES } from './storage.js';
import { DEFAULT_SETTINGS, makeId, newAccount } from './core/defaults.js';
import { todayISO } from './core/dates.js';
import { sanitizeSettings } from './core/validate.js';

export const state = {
  ready: false,
  version: 0,
  settings: { ...DEFAULT_SETTINGS },
  accounts: [],
  // Pots. Still stored under the older `goals` name: renaming the store
  // would mean an IndexedDB migration for no visible gain.
  goals: [],
  // Collections an older version wrote that this one doesn't read. Carried,
  // never parsed, so an upgrade can't be what loses someone their history.
  archive: {},
  lastChangeAt: null,
  storageKind: null,
  durable: true,
  persisted: null,
  today: todayISO(),
};

let backend = null;
let channel = null;
const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(reason = 'change') {
  state.version++;
  for (const fn of listeners) fn(reason);
}

const nowIso = () => new Date().toISOString();
const put = (store, value) => ({ store, op: 'put', value });
const del = (store, key) => ({ store, op: 'delete', key });
const putMeta = (key, value) => put('meta', { key, value });

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name);

function applyLoaded(data) {
  state.accounts = data.accounts.slice().sort(byOrder);
  state.goals = data.goals.slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  state.settings = sanitizeSettings(data.meta.get('settings'));
  state.lastChangeAt = data.meta.get('lastChangeAt') ?? null;
  // Anything the old spending half wrote is still on the device. It is read
  // once so a backup can carry it, and otherwise left alone.
  state.archive = data.meta.get('archive') ?? legacyArchive(data);
}

// Records left behind by version 4 and earlier.
function legacyArchive(data) {
  const archive = {};
  for (const key of ['transactions', 'categories', 'recurring']) {
    if (Array.isArray(data[key]) && data[key].length) archive[key] = data[key];
  }
  return archive;
}

async function loadAll() {
  const lists = await Promise.all(STORES.map((s) => backend.getAll(s)));
  const data = Object.fromEntries(STORES.map((s, i) => [s, lists[i]]));
  data.meta = new Map(data.meta.map((m) => [m.key, m.value]));
  return data;
}

async function commit(ops) {
  const at = nowIso();
  await backend.commit([...ops, putMeta('lastChangeAt', at)]);
  state.lastChangeAt = at;
  try {
    channel?.postMessage({ type: 'changed' });
  } catch {
    // another tab will pick it up on focus
  }
}

export function describeError(err) {
  if (err?.name === 'QuotaExceededError') return 'Storage is full. Export a backup, then free up space on this device.';
  return 'Couldn’t save. Your entry is still here, so try again.';
}

export async function init() {
  backend = await openStorage();
  backend.onVersionChange = () => emit('blocked');
  let data = await loadAll();
  if (!data.meta.get('initialized')) {
    await backend.commit([putMeta('settings', { ...DEFAULT_SETTINGS }), putMeta('initialized', nowIso())]);
    data = await loadAll();
  }
  applyLoaded(data);
  state.storageKind = backend.kind;
  state.durable = backend.durable;
  state.today = todayISO();
  try {
    channel = new BroadcastChannel('tally');
    channel.onmessage = () => reload();
  } catch {
    channel = null;
  }
  state.ready = true;
  emit('init');
  requestPersistence().then((p) => {
    state.persisted = p;
    emit('persist');
  });
}

export async function reload() {
  applyLoaded(await loadAll());
  emit('reload');
}

export async function checkDayChange() {
  const today = todayISO();
  if (today === state.today) return;
  state.today = today;
  emit('day');
}

// ---------- Accounts ----------

export async function saveAccount(value, id = null) {
  const existing = id ? state.accounts.find((a) => a.id === id) : null;
  const record = existing
    ? { ...existing, ...value }
    : newAccount({ id: makeId(), ...value, order: state.accounts.length ? Math.max(...state.accounts.map((a) => a.order ?? 0)) + 1 : 0 });
  await commit([put('accounts', record)]);
  state.accounts = (existing ? state.accounts.map((a) => (a.id === id ? record : a)) : [...state.accounts, record]).sort(byOrder);
  emit();
  return record;
}

// Closing an account doesn't delete the pots kept in it — the money went
// somewhere. They come back unplaced, or move to the account you name.
export async function deleteAccount(id, moveToId = null) {
  const moved = state.goals.filter((g) => g.accountId === id).map((g) => ({ ...g, accountId: moveToId }));
  await commit([...moved.map((g) => put('goals', g)), del('accounts', id)]);
  const map = new Map(moved.map((g) => [g.id, g]));
  state.goals = state.goals.map((g) => map.get(g.id) ?? g);
  state.accounts = state.accounts.filter((a) => a.id !== id);
  emit();
}

// Reading a balance off a statement. The figure that was there before is
// kept, so the fund gains a history without anything being logged daily.
//
// The newest reading is always the one the account is worth — so writing in
// a reading you forgot to take last month files it under its own date and
// leaves today's figure alone, rather than winding the account backwards.
export async function recordBalance(id, cents, date) {
  const account = state.accounts.find((a) => a.id === id);
  if (!account) return null;
  const readings = [...(account.history ?? [])];
  if (account.balanceAt) readings.push({ date: account.balanceAt, cents: account.balance ?? 0 });
  // One reading per day: a second on the same date corrects the first.
  const byDate = new Map(readings.map((r) => [r.date, r]));
  byDate.set(date, { date, cents });
  const sorted = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const latest = sorted.pop();
  return saveAccount({ balance: latest.cents, balanceAt: latest.date, history: sorted.slice(-399) }, id);
}

// ---------- Pots ----------

export async function saveGoal(value, id = null) {
  const existing = id ? state.goals.find((g) => g.id === id) : null;
  // Defaults first so a record always has the full plan shape, whatever the
  // caller passed — a backup and restore would fill them in anyway, and the
  // two need to match.
  const record = existing
    ? { ...existing, ...value }
    : { id: makeId(), kind: 'fund', saved: 0, targetDate: null, startDate: null, endDate: null, apyBp: 0, allocBp: 0, accountId: null, icon: '', ...value, createdAt: nowIso() };
  await commit([put('goals', record)]);
  state.goals = existing ? state.goals.map((g) => (g.id === id ? record : g)) : [...state.goals, record];
  emit();
  return record;
}

export async function adjustGoal(id, delta) {
  const goal = state.goals.find((g) => g.id === id);
  if (!goal) return;
  await saveGoal({ saved: Math.max(0, (goal.saved ?? 0) + delta) }, id);
}

export async function deleteGoal(id) {
  await commit([del('goals', id)]);
  state.goals = state.goals.filter((g) => g.id !== id);
  emit();
}

// ---------- Settings ----------

export async function updateSettings(patch) {
  const next = sanitizeSettings({ ...state.settings, ...patch });
  await commit([putMeta('settings', next)]);
  state.settings = next;
  emit('settings');
}

export async function markExported() {
  await updateSettings({ lastExportAt: nowIso() });
}

// ---------- Import, restore, erase ----------

function replaceAllOps(data) {
  return [
    ...STORES.map((s) => ({ store: s, op: 'clear' })),
    ...data.accounts.map((a) => put('accounts', a)),
    ...data.goals.map((g) => put('goals', g)),
    putMeta('settings', data.settings),
    putMeta('archive', data.archive ?? {}),
    putMeta('initialized', nowIso()),
  ];
}

export async function restoreBackup(data) {
  // Keep the user's own record of when they last backed up.
  const settings = { ...data.settings, lastExportAt: state.settings.lastExportAt };
  await commit(replaceAllOps({ ...data, settings }));
  await reload();
  emit();
}

export async function eraseAll() {
  const settings = { ...DEFAULT_SETTINGS, theme: state.settings.theme };
  await commit(replaceAllOps({ accounts: [], goals: [], archive: {}, settings }));
  await reload();
}

export function snapshot() {
  return {
    settings: state.settings,
    accounts: state.accounts,
    goals: state.goals,
    archive: state.archive,
  };
}
