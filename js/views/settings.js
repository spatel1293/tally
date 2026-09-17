import { html, $ } from '../ui/html.js';
import { openSheet, toast, confirmDialog } from '../ui/overlay.js';
import {
  state, updateSettings, markExported, snapshot, applyImport, undoImport, restoreBackup, eraseAll, describeError,
} from '../store.js';
import { storageEstimate } from '../storage.js';
import { buildBackup, parseBackup } from '../core/validate.js';
import { transactionsToCSV, parseCSV, prepareImport } from '../core/csv.js';
import { formatMoney } from '../core/money.js';
import { APP_VERSION, makeId } from '../core/defaults.js';
import { money, date, timeAgo, plural, categoryById } from '../ui/format.js';
import { pageHead } from './components.js';

const CURRENCIES = [
  ['USD', 'US dollar'], ['EUR', 'Euro'], ['GBP', 'British pound'], ['CAD', 'Canadian dollar'], ['AUD', 'Australian dollar'],
  ['NZD', 'New Zealand dollar'], ['JPY', 'Japanese yen'], ['CNY', 'Chinese yuan'], ['INR', 'Indian rupee'], ['MXN', 'Mexican peso'],
  ['BRL', 'Brazilian real'], ['CHF', 'Swiss franc'], ['SEK', 'Swedish krona'], ['NOK', 'Norwegian krone'], ['DKK', 'Danish krone'],
  ['PLN', 'Polish złoty'], ['ZAR', 'South African rand'], ['SGD', 'Singapore dollar'], ['HKD', 'Hong Kong dollar'], ['KRW', 'South Korean won'],
  ['PHP', 'Philippine peso'], ['NGN', 'Nigerian naira'], ['KES', 'Kenyan shilling'], ['ILS', 'Israeli new shekel'], ['AED', 'UAE dirham'],
  ['TRY', 'Turkish lira'], ['CZK', 'Czech koruna'], ['HUF', 'Hungarian forint'], ['COP', 'Colombian peso'], ['ARS', 'Argentine peso'],
];

const LOCALES = [
  ['en-US', 'English (United States)'], ['en-GB', 'English (United Kingdom)'], ['en-CA', 'English (Canada)'], ['en-AU', 'English (Australia)'],
  ['en-IN', 'English (India)'], ['de-DE', 'Deutsch (Deutschland)'], ['fr-FR', 'Français (France)'], ['fr-CA', 'Français (Canada)'],
  ['es-ES', 'Español (España)'], ['es-MX', 'Español (México)'], ['it-IT', 'Italiano'], ['nl-NL', 'Nederlands'], ['pt-BR', 'Português (Brasil)'],
  ['pt-PT', 'Português (Portugal)'], ['sv-SE', 'Svenska'], ['pl-PL', 'Polski'], ['de-CH', 'Deutsch (Schweiz)'], ['ja-JP', '日本語'],
  ['zh-CN', '中文 (中国)'], ['ko-KR', '한국어'],
];

const stamp = () => state.today;

// ---------- File helpers ----------

async function deliverFile(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const coarse = globalThis.matchMedia?.('(pointer: coarse)').matches;
  if (coarse && typeof File === 'function' && navigator.canShare) {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return true;
      } catch (err) {
        if (err?.name === 'AbortError') return false;
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(null);
      if (file.size > 50 * 1024 * 1024) {
        toast('That file is over 50 MB, which is too large to import.', { tone: 'error' });
        return resolve(null);
      }
      try {
        resolve({ name: file.name, text: await file.text() });
      } catch {
        toast('Couldn’t read that file. Try saving it again and choosing it once more.', { tone: 'error' });
        resolve(null);
      }
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    document.body.append(input);
    input.click();
  });
}

export async function exportJSON() {
  try {
    const backup = buildBackup(snapshot(), new Date().toISOString());
    const done = await deliverFile(`tally-backup-${stamp()}.json`, JSON.stringify(backup, null, 1), 'application/json');
    if (!done) return false;
    await markExported();
    toast(`Backup saved with ${plural(state.transactions.length, 'transaction')}`);
    return true;
  } catch (err) {
    toast(describeError(err), { tone: 'error' });
    return false;
  }
}

export async function exportCSV() {
  const csv = transactionsToCSV(state.transactions, state.categories, state.accounts);
  const done = await deliverFile(`tally-transactions-${stamp()}.csv`, `\ufeff${csv}`, 'text/csv');
  if (done) toast(`Exported ${plural(state.transactions.length, 'transaction')} as CSV`);
}

// ---------- CSV import ----------

export async function startImportCSV() {
  const file = await pickFile('.csv,.tsv,.txt,text/csv,text/plain');
  if (!file) return;
  const rows = parseCSV(file.text);
  openImportSheet(file.name, rows, { dateOrder: state.settings.csvDateOrder, positiveIs: 'income', skipDuplicates: true });
}

function openImportSheet(fileName, rows, opts) {
  const result = prepareImport(rows, state, {
    locale: state.settings.locale,
    dateOrder: opts.dateOrder,
    positiveIs: opts.positiveIs,
    skipDuplicates: opts.skipDuplicates,
    defaultAccountId: null,
    makeId,
    now: new Date().toISOString(),
  });
  const cols = result.columns;
  const signed = cols && cols.amount !== undefined && cols.type === undefined;
  const ambiguousDates = Boolean(cols) && rows.slice(1).some((r) => /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(String(r[cols.date] ?? '').trim()));
  const preview = result.transactions.slice(0, 6);
  const newCatNames = new Map(result.newCategories.map((c) => [c.id, c]));
  const catName = (id) => newCatNames.get(id)?.name ?? categoryById(id).name;
  const errShown = result.errors.slice(0, 12);

  const body = html`<form class="stack" novalidate data-import>
    <p class="muted">${fileName}, ${plural(result.total, 'row')}</p>
    ${result.fatal
      ? html`<p class="notice warn">${result.fatal}</p>
        <p class="hint">Expected columns: date, amount, and optionally type, category, note and account. A file exported from Tally always works.</p>`
      : html`
        <div class="row-2">
          ${ambiguousDates ? html`<label class="field"><span class="label">Dates like 03/04/2024 mean</span>
            <select name="dateOrder">
              <option value="MDY" ${opts.dateOrder === 'MDY' ? 'selected' : ''}>March 4 (month first)</option>
              <option value="DMY" ${opts.dateOrder === 'DMY' ? 'selected' : ''}>3 April (day first)</option>
            </select>
          </label>` : ''}
          ${signed
            ? html`<label class="field"><span class="label">Positive amounts are</span>
                <select name="positiveIs">
                  <option value="income" ${opts.positiveIs === 'income' ? 'selected' : ''}>Income (most banks)</option>
                  <option value="expense" ${opts.positiveIs === 'expense' ? 'selected' : ''}>Spending</option>
                </select>
              </label>`
            : ''}
        </div>
        <label class="check"><input type="checkbox" name="skipDuplicates" ${opts.skipDuplicates ? 'checked' : ''} /><span>Skip transactions that are already in Tally<small>Matches on date, type, amount and note.</small></span></label>

        <div class="import-summary">
          <p><strong>${plural(result.transactions.length, 'transaction')} ready to add.</strong>
            ${result.duplicates ? ` ${plural(result.duplicates, 'duplicate')} skipped.` : ''}
            ${result.errors.length ? ` ${plural(result.errors.length, 'row')} couldn’t be read.` : ''}</p>
          ${result.newCategories.length ? html`<p>New categories: ${result.newCategories.map((c) => c.name).join(', ')}.</p>` : ''}
          ${result.newAccounts.length ? html`<p>New accounts: ${result.newAccounts.map((a) => a.name).join(', ')}.</p>` : ''}
        </div>

        ${preview.length
          ? html`<div class="table-wrap"><table class="preview">
              <caption class="sr-only">First rows to be added</caption>
              <thead><tr><th scope="col">Date</th><th scope="col">Note</th><th scope="col" class="wide-only">Category</th><th scope="col" class="num">Amount</th></tr></thead>
              <tbody>${preview.map((t) => html`<tr>
                <td>${date(t.date)}</td><td>${t.note || catName(t.categoryId)}</td><td class="wide-only">${catName(t.categoryId)}</td>
                <td class="num amt ${t.type === 'income' || t.refund ? 'amt-in' : ''}">${t.type === 'income' || t.refund ? money(t.amount, { sign: true }) : money(-t.amount)}</td>
              </tr>`)}</tbody>
            </table></div>
            ${result.transactions.length > preview.length ? html`<p class="muted small">And ${(result.transactions.length - preview.length).toLocaleString(state.settings.locale)} more.</p>` : ''}`
          : ''}

        ${errShown.length
          ? html`<details class="errors"><summary>Rows that were skipped</summary><ul>
              ${errShown.map((e) => html`<li>Line ${e.line}: ${e.message}</li>`)}
              ${result.errors.length > errShown.length ? html`<li>and ${plural(result.errors.length - errShown.length, 'more row')}.</li>` : ''}
            </ul></details>`
          : ''}`}
  </form>`;

  openSheet({
    title: 'Import transactions',
    body,
    size: 'wide',
    footer: html`<button type="button" class="btn ghost" data-sheet-close>Cancel</button>
      <button type="button" class="btn primary grow" data-apply ${result.fatal || !result.transactions.length ? 'disabled' : ''}>
        ${result.transactions.length ? `Add ${plural(result.transactions.length, 'transaction')}` : 'Nothing to add'}
      </button>`,
    onMount(dialog, sheet) {
      const form = $('[data-import]', dialog);
      form.addEventListener('change', () => {
        const next = {
          dateOrder: form.elements.dateOrder?.value ?? opts.dateOrder,
          positiveIs: form.elements.positiveIs?.value ?? opts.positiveIs,
          skipDuplicates: form.elements.skipDuplicates?.checked ?? opts.skipDuplicates,
        };
        sheet.close({ silent: true });
        openImportSheet(fileName, rows, next);
      });
      const apply = $('[data-apply]', dialog);
      apply.addEventListener('click', async () => {
        apply.disabled = true;
        try {
          const undo = await applyImport(result);
          if (ambiguousDates && opts.dateOrder !== state.settings.csvDateOrder) await updateSettings({ csvDateOrder: opts.dateOrder });
          sheet.close({ silent: true });
          toast(`Added ${plural(result.transactions.length, 'transaction')}`, {
            duration: 12000,
            action: {
              label: 'Undo',
              onClick: async () => {
                try {
                  await undoImport(undo);
                  toast('Import undone');
                } catch (err) {
                  toast(describeError(err), { tone: 'error' });
                }
              },
            },
          });
        } catch (err) {
          apply.disabled = false;
          toast(describeError(err), { tone: 'error' });
        }
      });
    },
  });
}

// ---------- Restore and erase ----------

export async function startRestore() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  const parsed = parseBackup(file.text);
  if (!parsed.ok) {
    toast(parsed.error, { tone: 'error', duration: 8000 });
    return;
  }
  const d = parsed.data;
  const hasData = state.transactions.length > 0;
  const ok = await confirmDialog({
    title: 'Replace everything with this backup?',
    message: html`<p>This backup${parsed.exportedAt ? ` from ${date(parsed.exportedAt.slice(0, 10))}` : ''} has
      ${plural(d.transactions.length, 'transaction')}, ${plural(d.categories.length, 'category', 'categories')},
      ${plural(d.recurring.length, 'repeating transaction')} and ${plural(d.goals.length, 'goal')}.</p>
      ${hasData ? html`<p>What’s in Tally now (${plural(state.transactions.length, 'transaction')}) will be replaced.</p>` : ''}
      ${parsed.dropped ? html`<p class="notice warn">${plural(parsed.dropped, 'damaged record')} in the file will be left out.</p>` : ''}`,
    extra: hasData
      ? html`<label class="check"><input type="checkbox" name="saveFirst" checked /><span>Download a backup of the current data first</span></label>`
      : null,
    confirmLabel: 'Replace with backup',
    danger: hasData,
  });
  if (!ok) return;
  if (ok.saveFirst) {
    const saved = await exportJSON();
    if (!saved) {
      toast('Restore cancelled because the current data wasn’t saved.');
      return;
    }
  }
  try {
    await restoreBackup(d);
    toast(`Restored ${plural(d.transactions.length, 'transaction')}`);
  } catch (err) {
    toast(describeError(err), { tone: 'error' });
  }
}

async function startErase() {
  const ok = await confirmDialog({
    title: 'Erase all data?',
    message: html`<p>This permanently deletes every transaction, budget, category, account, repeating transaction and goal on this device. It can’t be undone.</p>`,
    extra: state.transactions.length
      ? html`<label class="check"><input type="checkbox" name="saveFirst" checked /><span>Download a backup first</span></label>`
      : null,
    requireText: 'erase',
    confirmLabel: 'Erase everything',
    danger: true,
  });
  if (!ok) return;
  if (ok.saveFirst && !(await exportJSON())) {
    toast('Nothing was erased because the backup wasn’t saved.');
    return;
  }
  try {
    await eraseAll();
    toast('All data erased. Tally is starting fresh.');
    location.hash = '#/';
  } catch (err) {
    toast(describeError(err), { tone: 'error' });
  }
}

// ---------- View ----------

function storageText() {
  switch (state.storageKind) {
    case 'indexeddb':
      return 'Saved in this browser’s database (IndexedDB).';
    case 'localstorage':
      return 'Saved in this browser’s local storage. It holds a few megabytes, so export backups regularly.';
    default:
      return 'This browser isn’t allowing Tally to save anything. Data disappears when you close the tab.';
  }
}

export function renderSettings() {
  const s = state.settings;
  const sample = formatMoney(123456, { currency: s.currency, locale: s.locale });
  const currencies = CURRENCIES.some(([c]) => c === s.currency) ? CURRENCIES : [[s.currency, s.currency], ...CURRENCIES];
  const locales = LOCALES.some(([l]) => l === s.locale) ? LOCALES : [[s.locale, s.locale], ...LOCALES];
  return html`${pageHead('Settings')}
    <form class="settings" data-settings onsubmit="return false">
      <section class="panel" aria-labelledby="set-look">
        <h2 id="set-look">Appearance</h2>
        <div class="seg" role="radiogroup" aria-label="Theme">
          ${[['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']].map(([v, label]) => html`<label><input type="radio" name="theme" value="${v}" ${s.theme === v ? 'checked' : ''} /><span>${label}</span></label>`)}
        </div>
      </section>

      <section class="panel" aria-labelledby="set-money">
        <h2 id="set-money">Money</h2>
        <div class="row-2">
          <label class="field"><span class="label">Currency</span>
            <select name="currency">${currencies.map(([c, n]) => html`<option value="${c}" ${c === s.currency ? 'selected' : ''}>${n} (${c})</option>`)}</select>
          </label>
          <label class="field"><span class="label">Number format</span>
            <select name="locale">${locales.map(([l, n]) => html`<option value="${l}" ${l === s.locale ? 'selected' : ''}>${n}</option>`)}</select>
          </label>
        </div>
        <p class="hint">Amounts look like <strong class="amt">${sample}</strong>. Changing the currency only changes the symbol. It doesn’t convert amounts.</p>
        <label class="field"><span class="label">Budget warning</span>
          <select name="warnPercent">${[50, 60, 70, 75, 80, 85, 90, 95, 100].map((p) => html`<option value="${p}" ${p === s.warnPercent ? 'selected' : ''}>Turn amber at ${p}% of a budget</option>`)}</select>
        </label>
      </section>

      <section class="panel" aria-labelledby="set-data">
        <h2 id="set-data">Backup and data</h2>
        <p>${s.lastExportAt ? html`Last full backup: <strong>${timeAgo(s.lastExportAt)}</strong>.` : html`<strong>No backup yet.</strong>`}
          Your ${plural(state.transactions.length, 'transaction')} live only on this device. A backup file is the only copy anywhere else.</p>
        <div class="btn-row">
          <button type="button" class="btn primary" data-action="export-json">Download full backup</button>
          <button type="button" class="btn" data-action="restore-json">Restore from backup</button>
        </div>
        <div class="btn-row">
          <button type="button" class="btn" data-action="export-csv" ${state.transactions.length ? '' : 'disabled'}>Export transactions (CSV)</button>
          <button type="button" class="btn" data-action="import-csv">Import transactions (CSV)</button>
        </div>
        <p class="hint">The backup (.json) holds everything: transactions, categories, budgets, accounts, repeating transactions, goals and settings. The CSV holds transactions only, for spreadsheets or moving history in from a bank.</p>
        <label class="field"><span class="label">Backup reminder</span>
          <select name="backupReminderDays">
            ${[[7, 'After a week of changes'], [14, 'After two weeks of changes'], [30, 'After a month of changes'], [0, 'Never remind me']].map(([v, l]) => html`<option value="${v}" ${v === s.backupReminderDays ? 'selected' : ''}>${l}</option>`)}
          </select>
        </label>
      </section>

      <section class="panel" aria-labelledby="set-storage">
        <h2 id="set-storage">Storage on this device</h2>
        <p>${storageText()}</p>
        <p data-storage-detail class="muted small">
          ${state.persisted === true ? 'The browser has agreed to keep this data even when space runs low.' : state.persisted === false ? 'The browser may clear this data if the device runs low on space. Installing Tally to your home screen usually prevents that.' : ''}
        </p>
        <p class="hint">On iPhone and iPad, Safari can clear data for sites you haven’t opened in a few weeks. Adding Tally to the Home Screen (Share, then Add to Home Screen) avoids that.</p>
      </section>

      <section class="panel desktop-only" aria-labelledby="set-keys">
        <h2 id="set-keys">Keyboard shortcuts</h2>
        <dl class="facts keys">
          <div><dt><kbd>N</kbd></dt><dd>New expense</dd></div>
          <div><dt><kbd>I</kbd></dt><dd>New income</dd></div>
          <div><dt><kbd>/</kbd></dt><dd>Search activity</dd></div>
          <div><dt><kbd>1</kbd>–<kbd>4</kbd></dt><dd>Home, Activity, Budgets, Repeating</dd></div>
          <div><dt><kbd>[</kbd> <kbd>]</kbd></dt><dd>Previous or next month</dd></div>
          <div><dt><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd></dt><dd>Save the open form</dd></div>
          <div><dt><kbd>Esc</kbd></dt><dd>Close the open form</dd></div>
        </dl>
      </section>

      <section class="panel danger-zone" aria-labelledby="set-erase">
        <h2 id="set-erase">Start over</h2>
        <p>Erase everything on this device and go back to the default categories.</p>
        <button type="button" class="btn danger" data-erase>Erase all data</button>
      </section>

      <p class="muted small footnote">Tally ${APP_VERSION}. No accounts, no servers, no tracking and no AI. Nothing leaves this device unless you export it.</p>
    </form>`;
}

export function afterSettingsMount(root) {
  const form = root.querySelector('[data-settings]');
  if (!form) return;
  form.addEventListener('change', async (e) => {
    const { name, value } = e.target;
    const patch = {};
    if (name === 'theme' || name === 'currency' || name === 'locale') patch[name] = value;
    else if (name === 'warnPercent' || name === 'backupReminderDays') patch[name] = Number(value);
    else return;
    try {
      await updateSettings(patch);
      if (name === 'currency' || name === 'locale') toast(`Amounts now look like ${formatMoney(123456, state.settings)}`);
    } catch (err) {
      toast(describeError(err), { tone: 'error' });
    }
  });
  root.querySelector('[data-erase]')?.addEventListener('click', startErase);
  storageEstimate().then((est) => {
    const el = root.querySelector('[data-storage-detail]');
    if (!est || !el || !est.usage) return;
    const mb = (n) => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`;
    el.textContent = `${el.textContent.trim()} Using about ${mb(est.usage)}${est.quota ? ` of ${mb(est.quota)} available` : ''}.`.trim();
  });
}
