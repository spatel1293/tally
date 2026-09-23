import { parseAmount, centsToDecimalString } from './money.js';
import { parseFlexibleDate, isValidISODate } from './dates.js';
import { PALETTE, newAccount } from './defaults.js';

// ---------- Low-level CSV ----------

function detectDelimiter(text) {
  const firstLine = [];
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n' || ch === '\r')) break;
    firstLine.push(inQuotes ? '' : ch);
  }
  const line = firstLine.join('');
  const counts = [',', ';', '\t'].map((d) => [d, line.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

// RFC 4180 parser with quoted fields, escaped quotes, CRLF/LF, BOM, and
// comma/semicolon/tab auto-detection. Returns an array of string arrays.
export function parseCSV(input) {
  let text = String(input ?? '');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delim = detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let wasQuoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && field === '' && !wasQuoted) {
      inQuotes = true;
      wasQuoted = true;
    } else if (c === delim) {
      row.push(field);
      field = '';
      wasQuoted = false;
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      wasQuoted = false;
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length || wasQuoted) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

function csvCell(value) {
  if (value == null) return '';
  let s = String(value);
  // Keep spreadsheet apps from treating text as a formula.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  if (/[",;\r\n]/.test(s) || /^\s|\s$/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCSV(rows) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function unguard(s) {
  return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
}

// ---------- Export ----------

export const EXPORT_HEADERS = ['date', 'type', 'amount', 'category', 'parent_category', 'account', 'note', 'refund', 'id'];

export function transactionsToCSV(transactions, categories, accounts) {
  const cats = new Map(categories.map((c) => [c.id, c]));
  const accts = new Map(accounts.map((a) => [a.id, a]));
  const sorted = transactions.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const rows = [EXPORT_HEADERS];
  for (const t of sorted) {
    const cat = cats.get(t.categoryId);
    const parent = cat?.parentId ? cats.get(cat.parentId) : null;
    rows.push([
      t.date,
      t.type,
      centsToDecimalString(t.amount),
      cat?.name ?? '',
      parent?.name ?? '',
      accts.get(t.accountId)?.name ?? '',
      t.note ?? '',
      t.refund ? 'yes' : '',
      t.id,
    ]);
  }
  return toCSV(rows);
}

// ---------- Import ----------

const HEADER_ALIASES = {
  date: ['date', 'transaction date', 'posted date', 'posting date', 'trans date', 'booking date', 'value date', 'day'],
  amount: ['amount', 'value', 'sum', 'amt', 'transaction amount', 'amount (usd)'],
  debit: ['debit', 'debits', 'withdrawal', 'withdrawals', 'money out', 'outflow', 'paid out', 'spent'],
  credit: ['credit', 'credits', 'deposit', 'deposits', 'money in', 'inflow', 'paid in', 'received'],
  type: ['type', 'transaction type', 'kind', 'direction'],
  category: ['category', 'categories', 'category name'],
  parent: ['parent_category', 'parent category', 'category group', 'group'],
  account: ['account', 'account name', 'wallet'],
  note: ['note', 'notes', 'memo', 'description', 'payee', 'merchant', 'name', 'details', 'narrative', 'reference'],
  refund: ['refund', 'is refund'],
  id: ['id', 'transaction id'],
};

function normHeader(h) {
  return String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function mapHeaders(headerRow) {
  const map = { note: [] };
  headerRow.forEach((raw, index) => {
    const h = normHeader(raw);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (!aliases.includes(h)) continue;
      if (field === 'note') map.note.push(index);
      else if (map[field] === undefined) map[field] = index;
      break;
    }
  });
  return map;
}

const INCOME_WORDS = new Set(['income', 'credit', 'cr', 'deposit', 'in', 'inflow', '+']);
const EXPENSE_WORDS = new Set(['expense', 'expenses', 'debit', 'dr', 'withdrawal', 'payment', 'out', 'outflow', 'spending', '-']);
const TRUE_WORDS = new Set(['yes', 'y', 'true', '1', 'x']);

function signature(t) {
  return `${t.date}|${t.type}|${t.amount}|${t.refund ? 1 : 0}|${String(t.note ?? '').trim().toLowerCase()}`;
}

const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

// Turns parsed CSV rows into transactions ready to save.
// options: { locale, dateOrder: 'MDY'|'DMY', positiveIs: 'income'|'expense',
//            skipDuplicates, defaultAccountId, makeId, now }
export function prepareImport(rows, existing, options) {
  const { locale = 'en-US', dateOrder = 'MDY', positiveIs = 'income', skipDuplicates = true, defaultAccountId = null, makeId, now } = options;
  const result = { transactions: [], newCategories: [], newAccounts: [], errors: [], duplicates: 0, total: 0, fatal: null, columns: null };
  if (!rows.length) {
    result.fatal = 'This file is empty.';
    return result;
  }
  const cols = mapHeaders(rows[0]);
  result.columns = cols;
  if (cols.date === undefined) {
    result.fatal = 'No date column found. The first row needs column names such as Date, Amount, Category and Note.';
    return result;
  }
  if (cols.amount === undefined && cols.debit === undefined && cols.credit === undefined) {
    result.fatal = 'No amount column found. Name it Amount, or use separate Debit and Credit columns.';
    return result;
  }

  const categories = existing.categories.slice();
  const accounts = existing.accounts.slice();
  const findCategory = (name, parentName, type) => {
    const n = name.toLowerCase();
    const p = parentName.toLowerCase();
    const matches = categories.filter((c) => c.name.toLowerCase() === n);
    if (!matches.length) return null;
    const byParent = p ? matches.filter((c) => categories.find((x) => x.id === c.parentId)?.name.toLowerCase() === p) : matches;
    const pool = byParent.length ? byParent : matches;
    return pool.find((c) => c.type === type) ?? pool[0];
  };
  const createCategory = (name, type, parentId = null) => {
    const siblings = categories.filter((c) => (c.parentId ?? null) === parentId);
    const cat = {
      id: makeId(),
      name: name.slice(0, 60),
      icon: type === 'income' ? '💰' : '🧾',
      color: PALETTE[(categories.length + result.newCategories.length) % PALETTE.length],
      type,
      parentId,
      order: siblings.length ? Math.max(...siblings.map((c) => c.order)) + 1 : 0,
      budget: null,
    };
    categories.push(cat);
    result.newCategories.push(cat);
    return cat;
  };
  const resolveCategory = (name, parentName, type) => {
    if (!name && parentName) {
      name = parentName;
      parentName = '';
    }
    if (!name) {
      const fallbackName = type === 'income' ? 'Income' : 'Other';
      return findCategory(fallbackName, '', type) ?? createCategory(fallbackName, type);
    }
    const found = findCategory(name, parentName, type);
    if (found) return found;
    let parentId = null;
    if (parentName) {
      const parent = findCategory(parentName, '', type) ?? createCategory(parentName, type);
      parentId = parent.parentId ? null : parent.id;
    }
    return createCategory(name, type, parentId);
  };
  const resolveAccount = (name) => {
    if (!name) return defaultAccountId && accounts.some((a) => a.id === defaultAccountId) ? defaultAccountId : null;
    const found = accounts.find((a) => a.name.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    const acct = newAccount({ id: makeId(), name: name.slice(0, 60), kind: 'other', order: accounts.length });
    accounts.push(acct);
    result.newAccounts.push(acct);
    return acct.id;
  };

  const existingIds = new Set(existing.transactions.map((t) => t.id));
  const seenIds = new Set();
  const available = new Map();
  if (skipDuplicates) {
    for (const t of existing.transactions) {
      const sig = signature(t);
      available.set(sig, (available.get(sig) ?? 0) + 1);
    }
  }

  const cell = (row, idx) => (idx === undefined ? '' : unguard(String(row[idx] ?? '').trim()));

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const line = r + 1;
    result.total++;
    const error = (message) => result.errors.push({ line, message });

    const date = parseFlexibleDate(cell(row, cols.date), dateOrder);
    if (!date || !isValidISODate(date)) {
      error(`Date "${cell(row, cols.date)}" isn't a date this app can read.`);
      continue;
    }

    let type = null;
    let cents = 0;
    const typeWord = cell(row, cols.type).toLowerCase();
    let refund = TRUE_WORDS.has(cell(row, cols.refund).toLowerCase()) || typeWord === 'refund';
    if (typeWord === 'refund') type = 'expense';
    else if (INCOME_WORDS.has(typeWord)) type = 'income';
    else if (EXPENSE_WORDS.has(typeWord)) type = 'expense';

    const amountText = cell(row, cols.amount);
    if (cols.amount !== undefined && amountText !== '') {
      const parsed = parseAmount(amountText, { locale });
      if (!parsed.ok) {
        error(`Amount "${amountText}": ${parsed.error}`);
        continue;
      }
      cents = parsed.cents;
      if (!type) {
        const positiveType = positiveIs === 'expense' ? 'expense' : 'income';
        const negativeType = positiveType === 'income' ? 'expense' : 'income';
        type = parsed.negative ? negativeType : positiveType;
      }
    } else {
      const debitText = cell(row, cols.debit);
      const creditText = cell(row, cols.credit);
      const source = debitText !== '' ? debitText : creditText;
      if (source === '') {
        error('Amount is missing.');
        continue;
      }
      const parsed = parseAmount(source, { locale });
      if (!parsed.ok) {
        error(`Amount "${source}": ${parsed.error}`);
        continue;
      }
      cents = parsed.cents;
      if (!type) type = debitText !== '' ? 'expense' : 'income';
    }
    if (cents === 0) {
      error('Amount is zero, so the row was skipped.');
      continue;
    }
    if (type !== 'expense') refund = false;

    const note = cols.note
      .map((i) => cell(row, i))
      .filter((v, i, arr) => v && arr.indexOf(v) === i)
      .join(', ')
      .slice(0, 500);
    const category = resolveCategory(cell(row, cols.category), cell(row, cols.parent), type);
    const rawId = cell(row, cols.id);

    const tx = {
      id: '',
      type,
      amount: cents,
      refund,
      categoryId: category.id,
      accountId: resolveAccount(cell(row, cols.account)),
      date,
      note,
      recurringId: null,
      // CSV is an interchange format and carries no plan column, so an
      // imported row belongs to no plan. The field is still set so every
      // transaction in the app has the same shape.
      planId: null,
      createdAt: now,
      updatedAt: now,
    };

    if (rawId && existingIds.has(rawId)) {
      result.duplicates++;
      continue;
    }
    if (skipDuplicates) {
      const sig = signature(tx);
      const left = available.get(sig) ?? 0;
      if (left > 0) {
        available.set(sig, left - 1);
        result.duplicates++;
        continue;
      }
    }
    tx.id = rawId && ID_RE.test(rawId) && !seenIds.has(rawId) ? rawId : makeId();
    seenIds.add(tx.id);
    result.transactions.push(tx);
  }

  // Only keep categories and accounts that a kept transaction uses.
  const usedCats = new Set(result.transactions.map((t) => t.categoryId));
  const allById = new Map(categories.map((c) => [c.id, c]));
  for (const id of [...usedCats]) {
    const parentId = allById.get(id)?.parentId;
    if (parentId) usedCats.add(parentId);
  }
  result.newCategories = result.newCategories.filter((c) => usedCats.has(c.id));
  const usedAccts = new Set(result.transactions.map((t) => t.accountId));
  result.newAccounts = result.newAccounts.filter((a) => usedAccts.has(a.id));
  return result;
}
