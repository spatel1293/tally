export const APP_NAME = 'Tally';
// Kept in step with VERSION in sw.js by a test, so the line in Settings is a
// reliable way to tell which build a device is actually running.
export const APP_VERSION = '3.1.0';
export const BACKUP_FORMAT = 2;

export function makeId() {
  const c = globalThis.crypto;
  if (c?.randomUUID) {
    try {
      return c.randomUUID();
    } catch {
      // randomUUID needs a secure context; fall through
    }
  }
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Printer's inks for category identity in charts. Deliberately no strong red
// or green: those two carry meaning about money elsewhere, and a category
// swatch must never be mistaken for a signal.
export const PALETTE = [
  '#1F4E8C', '#1B6F6A', '#A65A1E', '#5A4A96', '#9C3C6B', '#3A6E8F',
  '#7A5A2E', '#4C5A6B', '#8A3C52', '#6E7A2E', '#6E4E9E', '#2F6B7A',
];

export const ICONS = [
  '🛒', '🏠', '💡', '🚌', '🚗', '⛽', '🍜', '☕', '🍺', '🎬', '🎮', '🎵',
  '🩺', '💊', '🏋️', '🔁', '📱', '💻', '🏦', '💰', '💼', '🎁', '👕', '✂️',
  '🐾', '👶', '🎓', '📚', '✈️', '🏨', '🧾', '🛠️', '🧹', '🌱', '❤️', '📦',
];

// Printer's inks, same rule as PALETTE: no expense category is green or red,
// so a swatch is never mistaken for money coming in or a budget blown. Income
// is the exception, and green there means exactly what it says.
const DEFAULT_CATEGORY_SPECS = [
  ['Groceries', '🛒', '#6E7A2E', 'expense'],
  ['Rent / Housing', '🏠', '#1F4E8C', 'expense'],
  ['Utilities', '💡', '#A65A1E', 'expense'],
  ['Transportation', '🚌', '#9C3C6B', 'expense'],
  ['Dining Out', '🍜', '#8A3C52', 'expense'],
  ['Entertainment', '🎬', '#6E4E9E', 'expense'],
  ['Health', '🩺', '#1B6F6A', 'expense'],
  ['Subscriptions', '🔁', '#5A4A96', 'expense'],
  ['Savings', '🏦', '#3A6E8F', 'expense'],
  ['Other', '📦', '#4C5A6B', 'expense'],
  ['Income', '💼', '#0B7A3B', 'income'],
];

export function defaultCategories(idFn = makeId) {
  return DEFAULT_CATEGORY_SPECS.map(([name, icon, color, type], order) => ({
    id: idFn(),
    name,
    icon,
    color,
    type,
    parentId: null,
    order,
    budget: null,
  }));
}

export const DEFAULT_SETTINGS = {
  currency: 'USD',
  locale: 'en-US',
  theme: 'system',
  warnPercent: 80,
  backupReminderDays: 14,
  lastExportAt: null,
  lastChangeAt: null,
  defaultAccountId: null,
  csvDateOrder: 'MDY',
};

export const ACCOUNT_KINDS = {
  checking: 'Checking',
  savings: 'Savings',
  credit: 'Credit card',
  cash: 'Cash',
  other: 'Other',
};

export const UNCATEGORIZED = '__uncategorized__';
