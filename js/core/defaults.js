export const APP_NAME = 'Tally';
// Kept in step with VERSION in sw.js by a test, so the line in Settings is a
// reliable way to tell which build a device is actually running.
export const APP_VERSION = '4.0.0';
// 3 added the savings-first fields: a plan's yield, share and account, and an
// account's institution, role, rate, security and sealed vault. Older backups
// still restore; the new fields take their defaults.
export const BACKUP_FORMAT = 3;

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

// A vivid, system-colour-style palette for category identity in charts —
// indigo, purple, teal, brown and the rest of the family, deliberately not
// one muted "printer's ink" set. Still no strong red or green: those two
// carry meaning about money elsewhere, and a category swatch must never be
// mistaken for a signal.
export const PALETTE = [
  '#007aff', '#5856d6', '#af52de', '#ff9500', '#ffcc00', '#d6336c',
  '#30b0c7', '#32ade6', '#a2845e', '#8e8e93', '#667eea', '#0891b2',
];

export const ICONS = [
  '🛒', '🏠', '💡', '🚌', '🚗', '⛽', '🍜', '☕', '🍺', '🎬', '🎮', '🎵',
  '🩺', '💊', '🏋️', '🔁', '📱', '💻', '🏦', '💰', '💼', '🎁', '👕', '✂️',
  '🐾', '👶', '🎓', '📚', '✈️', '🏨', '🧾', '🛠️', '🧹', '🌱', '❤️', '📦',
];

// Same rule as PALETTE: no expense category is green or red, so a swatch is
// never mistaken for money coming in or a budget blown. Income is the
// exception, and green there means exactly what it says.
const DEFAULT_CATEGORY_SPECS = [
  ['Groceries', '🛒', '#30b0c7', 'expense'],
  ['Rent / Housing', '🏠', '#007aff', 'expense'],
  ['Utilities', '💡', '#ff9500', 'expense'],
  ['Transportation', '🚌', '#af52de', 'expense'],
  ['Dining Out', '🍜', '#d6336c', 'expense'],
  ['Entertainment', '🎬', '#5856d6', 'expense'],
  ['Health', '🩺', '#32ade6', 'expense'],
  ['Subscriptions', '🔁', '#667eea', 'expense'],
  ['Savings', '🏦', '#0891b2', 'expense'],
  ['Other', '📦', '#8e8e93', 'expense'],
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
  // How many months of essentials the safety net should cover.
  runwayTarget: 6,
  // What a month costs, if you'd rather state it than have it derived.
  essentialMonthly: null,
  vaultSalt: null,
  vaultCheck: null,
};

export const ACCOUNT_KINDS = {
  checking: 'Checking',
  savings: 'Savings',
  credit: 'Credit card',
  cash: 'Cash',
  brokerage: 'Brokerage',
  other: 'Other',
};

// The job an account does in the system: the hub the pay lands in and the
// bills leave from, the card you spend from day to day (kept thin, so a lost
// card can't reach the rest), the buckets the plans live in, and the money
// put to work. One account can only have one job — that's the point.
export const ACCOUNT_ROLES = {
  hub: 'Core hub',
  spending: 'Everyday spending',
  savings: 'Savings buckets',
  investing: 'Investing',
  other: 'Other',
};

// The full shape of an account record. Every writer starts here, so a record
// written today and one restored from a backup are the same object — which
// is what keeps a backup and a restore comparable.
export function newAccount(fields = {}) {
  const kind = fields.kind ?? 'other';
  return {
    kind,
    institution: '',
    role: roleForKind(kind),
    apyBp: 0,
    mfa: false,
    reviewedAt: null,
    notes: '',
    vault: null,
    openingBalance: 0,
    ...fields,
  };
}

export function roleForKind(kind) {
  return { checking: 'hub', credit: 'spending', cash: 'spending', savings: 'savings', brokerage: 'investing' }[kind] ?? 'other';
}

export const UNCATEGORIZED = '__uncategorized__';
