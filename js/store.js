// Application state and every change to it.
//
// Rule of the house: write to storage first, then update memory and the UI.
// If a write fails the call throws, the UI keeps the user's input on screen,
// and nothing is shown as saved that wasn't.

import { openStorage, requestPersistence, STORES } from './storage.js';
import { defaultCategories, DEFAULT_SETTINGS, makeId } from './core/defaults.js';
import { todayISO, addDays } from './core/dates.js';
import { processRecurring, transactionFromRule, MAX_GENERATED_PER_RUN } from './core/recurring.js';
import { sanitizeSettings } from './core/validate.js';
import { sortTransactions } from './core/stats.js';

export const state = {
  ready: false,
  version: 0,
  settings: { ...DEFAULT_SETTINGS },
  categories: [],
  accounts: [],
  transactions: [],
  recurring: [],
  goals: [],
  reminders: [],
  lastChangeAt: null,
  lastAccountId: null,
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
  sortedCache = null;
  for (const fn of listeners) fn(reason);
}

const nowIso = () => new Date().toISOString();
const put = (store, value) => ({ store, op: 'put', value });
const del = (store, key) => ({ store, op: 'delete', key });
const putMeta = (key, value) => put('meta', { key, value });

let sortedCache = null;
export function sortedTransactions() {
  if (!sortedCache) sortedCache = sortTransactions(state.transactions);
  return sortedCache;
}

const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name);

function applyLoaded(data) {
  state.transactions = data.transactions;
  state.categories = data.categories.slice().sort(byOrder);
  state.accounts = data.accounts.slice().sort(byOrder);
  state.recurring = data.recurring;
  state.goals = data.goals.slice().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  state.settings = sanitizeSettings(data.meta.get('settings'));
  state.lastChangeAt = data.meta.get('lastChangeAt') ?? null;
  state.lastAccountId = data.meta.get('lastAccountId') ?? null;
}

async function loadAll() {
  const lists = await Promise.all(STORES.map((s) => backend.getAll(s)));
  const data = Object.fromEntries(STORES.map((s, i) => [s, lists[i]]));
  data.meta = new Map(data.meta.map((m) => [m.key, m.value]));
  return data;
}

// Default categories get stable ids so two tabs opened at once on first run
// can't create duplicates.
function seedCategories() {
  let i = 0;
  const ids = ['groceries', 'housing', 'utilities', 'transportation', 'dining', 'entertainment', 'health', 'subscriptions', 'savings', 'other', 'income'];
  return defaultCategories(() => `default-${ids[i++]}`);
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
    await backend.commit([
      ...seedCategories().map((c) => put('categories', c)),
      putMeta('settings', { ...DEFAULT_SETTINGS }),
      putMeta('initialized', nowIso()),
    ]);
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
  try {
    await runRecurring();
  } catch {
    computeReminders();
  }
  emit('init');
  requestPersistence().then((p) => {
    state.persisted = p;
    emit('persist');
  });
}

export async function reload() {
  applyLoaded(await loadAll());
  computeReminders();
  emit('reload');
}

export async function checkDayChange() {
  const today = todayISO();
  if (today === state.today) return;
  state.today = today;
  await runRecurring();
  emit('day');
}

// ---------- Transactions ----------

export async function saveTransaction(value, id = null) {
  const at = nowIso();
  const existing = id ? state.transactions.find((t) => t.id === id) : null;
  const record = existing
    ? { ...existing, ...value, updatedAt: at }
    : { id: makeId(), recurringId: null, ...value, createdAt: at, updatedAt: at };
  const ops = [put('transactions', record)];
  if (record.accountId && record.accountId !== state.lastAccountId) ops.push(putMeta('lastAccountId', record.accountId));
  await commit(ops);
  if (record.accountId) state.lastAccountId = record.accountId;
  if (existing) state.transactions = state.transactions.map((t) => (t.id === id ? record : t));
  else state.transactions = [...state.transactions, record];
  emit();
  return record;
}

export async function deleteTransactions(ids) {
  const set = new Set(ids);
  const removed = state.transactions.filter((t) => set.has(t.id));
  await commit(removed.map((t) => del('transactions', t.id)));
  state.transactions = state.transactions.filter((t) => !set.has(t.id));
  emit();
  return removed;
}

export async function restoreTransactions(records) {
  await commit(records.map((t) => put('transactions', t)));
  const ids = new Set(records.map((t) => t.id));
  state.transactions = [...state.transactions.filter((t) => !ids.has(t.id)), ...records];
  emit();
}

// ---------- Categories ----------

export function siblingsOf(category) {
  return state.categories
    .filter((c) => c.type === category.type && (c.parentId ?? null) === (category.parentId ?? null))
    .sort(byOrder);
}

export async function saveCategory(value, id = null) {
  const existing = id ? state.categories.find((c) => c.id === id) : null;
  let record;
  if (existing) {
    record = { ...existing, ...value };
    const moved = existing.parentId !== record.parentId || existing.type !== record.type;
    if (moved) {
      const sibs = siblingsOf(record).filter((c) => c.id !== id);
      record.order = sibs.length ? Math.max(...sibs.map((c) => c.order)) + 1 : 0;
    }
  } else {
    const sibs = siblingsOf(value);
    record = { id: makeId(), ...value, order: sibs.length ? Math.max(...sibs.map((c) => c.order)) + 1 : 0 };
  }
  await commit([put('categories', record)]);
  state.categories = (existing ? state.categories.map((c) => (c.id === id ? record : c)) : [...state.categories, record]).sort(byOrder);
  emit();
  return record;
}

export function categoryUsageCounts(id) {
  const childIds = state.categories.filter((c) => c.parentId === id).map((c) => c.id);
  return {
    transactions: state.transactions.filter((t) => t.categoryId === id).length,
    rules: state.recurring.filter((r) => r.categoryId === id).length,
    children: childIds.length,
  };
}

// Moves the category's transactions and rules to `moveToId`, promotes its
// subcategories to the top level, then deletes it. One atomic write.
export async function deleteCategory(id, moveToId = null) {
  const cat = state.categories.find((c) => c.id === id);
  if (!cat) return;
  const at = nowIso();
  const txs = state.transactions.filter((t) => t.categoryId === id).map((t) => ({ ...t, categoryId: moveToId, updatedAt: at }));
  const rules = state.recurring.filter((r) => r.categoryId === id).map((r) => ({ ...r, categoryId: moveToId }));
  const topSibs = state.categories.filter((c) => c.type === cat.type && !c.parentId);
  let nextOrder = topSibs.length ? Math.max(...topSibs.map((c) => c.order)) + 1 : 0;
  const kids = state.categories.filter((c) => c.parentId === id).map((c) => ({ ...c, parentId: null, order: nextOrder++ }));
  await commit([
    ...txs.map((t) => put('transactions', t)),
    ...rules.map((r) => put('recurring', r)),
    ...kids.map((c) => put('categories', c)),
    del('categories', id),
  ]);
  const txMap = new Map(txs.map((t) => [t.id, t]));
  const ruleMap = new Map(rules.map((r) => [r.id, r]));
  const kidMap = new Map(kids.map((c) => [c.id, c]));
  state.transactions = state.transactions.map((t) => txMap.get(t.id) ?? t);
  state.recurring = state.recurring.map((r) => ruleMap.get(r.id) ?? r);
  state.categories = state.categories.filter((c) => c.id !== id).map((c) => kidMap.get(c.id) ?? c).sort(byOrder);
  emit();
}

export async function moveCategory(id, direction) {
  const cat = state.categories.find((c) => c.id === id);
  if (!cat) return;
  const sibs = siblingsOf(cat).map((c, order) => ({ ...c, order }));
  const i = sibs.findIndex((c) => c.id === id);
  const j = i + direction;
  if (j < 0 || j >= sibs.length) return;
  [sibs[i].order, sibs[j].order] = [sibs[j].order, sibs[i].order];
  await commit(sibs.map((c) => put('categories', c)));
  const map = new Map(sibs.map((c) => [c.id, c]));
  state.categories = state.categories.map((c) => map.get(c.id) ?? c).sort(byOrder);
  emit();
}

export async function setBudget(categoryId, cents) {
  const cat = state.categories.find((c) => c.id === categoryId);
  if (!cat) return;
  await saveCategory({ budget: cents }, categoryId);
}

// ---------- Accounts ----------

export async function saveAccount(value, id = null) {
  const existing = id ? state.accounts.find((a) => a.id === id) : null;
  const record = existing
    ? { ...existing, ...value }
    : { id: makeId(), ...value, order: state.accounts.length ? Math.max(...state.accounts.map((a) => a.order ?? 0)) + 1 : 0 };
  await commit([put('accounts', record)]);
  state.accounts = (existing ? state.accounts.map((a) => (a.id === id ? record : a)) : [...state.accounts, record]).sort(byOrder);
  emit();
  return record;
}

export async function deleteAccount(id, moveToId = null) {
  const at = nowIso();
  const txs = state.transactions.filter((t) => t.accountId === id).map((t) => ({ ...t, accountId: moveToId, updatedAt: at }));
  const rules = state.recurring.filter((r) => r.accountId === id).map((r) => ({ ...r, accountId: moveToId }));
  const ops = [...txs.map((t) => put('transactions', t)), ...rules.map((r) => put('recurring', r)), del('accounts', id)];
  if (state.lastAccountId === id) ops.push(putMeta('lastAccountId', moveToId));
  await commit(ops);
  const txMap = new Map(txs.map((t) => [t.id, t]));
  const ruleMap = new Map(rules.map((r) => [r.id, r]));
  state.transactions = state.transactions.map((t) => txMap.get(t.id) ?? t);
  state.recurring = state.recurring.map((r) => ruleMap.get(r.id) ?? r);
  state.accounts = state.accounts.filter((a) => a.id !== id);
  if (state.lastAccountId === id) state.lastAccountId = moveToId;
  emit();
}

// ---------- Recurring ----------

function computeReminders() {
  state.reminders = processRecurring(
    state.recurring.filter((r) => r.mode === 'remind'),
    [],
    state.today,
    () => '',
    ''
  ).reminders;
}

export async function runRecurring() {
  for (let round = 0; round < 20; round++) {
    const out = processRecurring(state.recurring, state.transactions, state.today, makeId, nowIso());
    if (!out.newTransactions.length && !out.updatedRules.length) break;
    await commit([...out.newTransactions.map((t) => put('transactions', t)), ...out.updatedRules.map((r) => put('recurring', r))]);
    const ruleMap = new Map(out.updatedRules.map((r) => [r.id, r]));
    state.recurring = state.recurring.map((r) => ruleMap.get(r.id) ?? r);
    state.transactions = [...state.transactions, ...out.newTransactions];
    if (out.newTransactions.length < MAX_GENERATED_PER_RUN) break;
  }
  computeReminders();
}

export async function saveRule(value, id = null) {
  const existing = id ? state.recurring.find((r) => r.id === id) : null;
  let record;
  if (existing) {
    record = { ...existing, ...value };
  } else {
    record = { id: makeId(), paused: false, ...value, generatedThrough: null };
    // Reminders start from today; automatic rules fill in past dates.
    if (record.mode === 'remind' && record.startDate < state.today) record.generatedThrough = addDays(state.today, -1);
  }
  await commit([put('recurring', record)]);
  state.recurring = existing ? state.recurring.map((r) => (r.id === id ? record : r)) : [...state.recurring, record];
  await runRecurring();
  emit();
  return record;
}

export async function deleteRule(id) {
  await commit([del('recurring', id)]);
  state.recurring = state.recurring.filter((r) => r.id !== id);
  computeReminders();
  emit();
}

export async function handleReminder(ruleId, date, action) {
  const rule = state.recurring.find((r) => r.id === ruleId);
  if (!rule) return null;
  const updated = { ...rule, generatedThrough: date };
  const ops = [put('recurring', updated)];
  let tx = null;
  if (action === 'log') {
    const duplicate = state.transactions.some((t) => t.recurringId === ruleId && t.date === date);
    if (!duplicate) {
      tx = transactionFromRule(rule, date, makeId(), nowIso());
      ops.push(put('transactions', tx));
    }
  }
  await commit(ops);
  state.recurring = state.recurring.map((r) => (r.id === ruleId ? updated : r));
  if (tx) state.transactions = [...state.transactions, tx];
  computeReminders();
  emit();
  return tx;
}

// ---------- Goals ----------

export async function saveGoal(value, id = null) {
  const existing = id ? state.goals.find((g) => g.id === id) : null;
  // Defaults first so a record always has the full plan shape, whatever the
  // caller passed — a backup and restore would fill them in anyway, and the
  // two need to match.
  const record = existing
    ? { ...existing, ...value }
    : { id: makeId(), kind: 'fund', saved: 0, targetDate: null, startDate: null, endDate: null, ...value, createdAt: nowIso() };
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

export async function applyImport(result) {
  await commit([
    ...result.newCategories.map((c) => put('categories', c)),
    ...result.newAccounts.map((a) => put('accounts', a)),
    ...result.transactions.map((t) => put('transactions', t)),
  ]);
  state.categories = [...state.categories, ...result.newCategories].sort(byOrder);
  state.accounts = [...state.accounts, ...result.newAccounts].sort(byOrder);
  state.transactions = [...state.transactions, ...result.transactions];
  emit();
  return {
    transactionIds: result.transactions.map((t) => t.id),
    categoryIds: result.newCategories.map((c) => c.id),
    accountIds: result.newAccounts.map((a) => a.id),
  };
}

export async function undoImport({ transactionIds, categoryIds, accountIds }) {
  const txSet = new Set(transactionIds);
  const remaining = state.transactions.filter((t) => !txSet.has(t.id));
  // Only remove what the import created and nothing else has started using.
  const usedCats = new Set([...remaining.map((t) => t.categoryId), ...state.recurring.map((r) => r.categoryId)]);
  const safe = new Set(categoryIds.filter((id) => !usedCats.has(id)));
  for (const c of state.categories) {
    if (c.parentId && safe.has(c.parentId) && !safe.has(c.id)) safe.delete(c.parentId);
  }
  const safeCats = [...safe];
  const usedAccts = new Set([...remaining.map((t) => t.accountId), ...state.recurring.map((r) => r.accountId)]);
  const safeAccts = accountIds.filter((id) => !usedAccts.has(id));
  await commit([
    ...transactionIds.map((id) => del('transactions', id)),
    ...safeCats.map((id) => del('categories', id)),
    ...safeAccts.map((id) => del('accounts', id)),
  ]);
  const catSet = new Set(safeCats);
  const acctSet = new Set(safeAccts);
  state.transactions = remaining;
  state.categories = state.categories.filter((c) => !catSet.has(c.id));
  state.accounts = state.accounts.filter((a) => !acctSet.has(a.id));
  emit();
}

function replaceAllOps(data) {
  return [
    ...STORES.map((s) => ({ store: s, op: 'clear' })),
    ...data.categories.map((c) => put('categories', c)),
    ...data.accounts.map((a) => put('accounts', a)),
    ...data.transactions.map((t) => put('transactions', t)),
    ...data.recurring.map((r) => put('recurring', r)),
    ...data.goals.map((g) => put('goals', g)),
    putMeta('settings', data.settings),
    putMeta('initialized', nowIso()),
  ];
}

export async function restoreBackup(data) {
  // Keep the user's own record of when they last backed up.
  const settings = { ...data.settings, lastExportAt: state.settings.lastExportAt };
  await commit(replaceAllOps({ ...data, settings }));
  await reload();
  await runRecurring();
  emit();
}

export async function eraseAll() {
  const settings = { ...DEFAULT_SETTINGS, theme: state.settings.theme };
  await commit(replaceAllOps({ categories: seedCategories(), accounts: [], transactions: [], recurring: [], goals: [], settings }));
  await reload();
}

export function snapshot() {
  return {
    settings: state.settings,
    categories: state.categories,
    accounts: state.accounts,
    transactions: sortedTransactions().slice().reverse(),
    recurring: state.recurring,
    goals: state.goals,
  };
}
