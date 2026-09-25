export const APP_NAME = 'Tally';
// Kept in step with VERSION in sw.js by a test, so the line in Settings is a
// reliable way to tell which build a device is actually running.
export const APP_VERSION = '5.5.0';
// 4 is the fund: accounts carry a stated balance and its history, the monthly
// surplus is two figures in settings rather than a ledger of transactions,
// and spending is no longer logged at all. Older backups still restore — the
// new fields take their defaults, and the collections version 5 no longer
// reads (transactions, categories, repeating items) are carried through
// untouched in `archive` so that nothing anyone recorded is ever thrown away.
export const BACKUP_FORMAT = 4;

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

// Bookbinding inks: the colours of marbled endpapers and cloth boards, which
// is what a pot's ribbon, rule and ring are drawn in. Deliberately no bright
// red or green — those two mean money here (short, and covered), and a pot's
// colour must never be mistaken for a verdict.
export const PALETTE = [
  '#1d4e6f', '#7b3f2e', '#3f5d43', '#6b4a7a', '#8a6a24', '#2f6b6b',
  '#5b4636', '#44527a', '#8a4a5f', '#4a6572', '#6e5a2e', '#345b74',
];

export const PLAN_ICONS = ['🛟', '🏦', '✈️', '📈', '🏠', '🚗', '🎓', '🎁', '💍', '🛠️', '🌱', '❤️'];

export const DEFAULT_SETTINGS = {
  currency: 'USD',
  locale: 'en-US',
  theme: 'system',
  backupReminderDays: 14,
  lastExportAt: null,
  lastChangeAt: null,
  // The two figures the whole fund is planned from. Stated, not derived:
  // version 5 stopped logging spending, so the surplus is what you say it is.
  monthlyIncome: 0,
  monthlyOutgoings: 0,
  // How many months of outgoings the safety net should cover.
  runwayTarget: 6,
  vaultSalt: null,
  vaultCheck: null,
  // The bridge, if one is connected. `bridgeVault` holds the sealed address
  // and token; the other two are only for showing what is connected.
  bridgeVault: null,
  bridgeHost: '',
  bridgeAt: null,
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
    link: null,
    balance: 0,
    balanceAt: null,
    history: [],
    ...fields,
  };
}

export function roleForKind(kind) {
  return { checking: 'hub', credit: 'spending', cash: 'spending', savings: 'savings', brokerage: 'investing' }[kind] ?? 'other';
}

