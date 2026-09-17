export const APP_NAME = 'Tally';
export const APP_VERSION = '1.0.0';
export const BACKUP_FORMAT = 1;

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

export const PALETTE = [
  '#3D8B5A', '#4A6FA5', '#C28A1E', '#5B7C99', '#C4553B', '#8A5BB0',
  '#2F9A9A', '#6C6FD1', '#2E7D6F', '#7D8591', '#B5487A', '#8C6D3F',
];

export const ICONS = [
  '🛒', '🏠', '💡', '🚌', '🚗', '⛽', '🍜', '☕', '🍺', '🎬', '🎮', '🎵',
  '🩺', '💊', '🏋️', '🔁', '📱', '💻', '🏦', '💰', '💼', '🎁', '👕', '✂️',
  '🐾', '👶', '🎓', '📚', '✈️', '🏨', '🧾', '🛠️', '🧹', '🌱', '❤️', '📦',
];

const DEFAULT_CATEGORY_SPECS = [
  ['Groceries', '🛒', '#3D8B5A', 'expense'],
  ['Rent / Housing', '🏠', '#4A6FA5', 'expense'],
  ['Utilities', '💡', '#C28A1E', 'expense'],
  ['Transportation', '🚌', '#B5487A', 'expense'],
  ['Dining Out', '🍜', '#C4553B', 'expense'],
  ['Entertainment', '🎬', '#8A5BB0', 'expense'],
  ['Health', '🩺', '#2F9A9A', 'expense'],
  ['Subscriptions', '🔁', '#6C6FD1', 'expense'],
  ['Savings', '🏦', '#8C6D3F', 'expense'],
  ['Other', '📦', '#7D8591', 'expense'],
  ['Income', '💼', '#2F8F4E', 'income'],
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
