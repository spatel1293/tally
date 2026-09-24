import { html, $ } from '../ui/html.js';
import { toast, confirmDialog } from '../ui/overlay.js';
import { state, updateSettings, markExported, snapshot, restoreBackup, eraseAll, describeError } from '../store.js';
import { storageEstimate } from '../storage.js';
import { buildBackup, parseBackup } from '../core/validate.js';
import { formatMoney } from '../core/money.js';
import { APP_VERSION } from '../core/defaults.js';
import { dayOf } from '../core/dates.js';
import { money, date, timeAgo, plural } from '../ui/format.js';
import { chapterHead, icons, ruledRow, section } from './chrome.js';
import { vaultAvailable, vaultExists, isUnlocked } from '../vault.js';
import { bridgeConnected } from '../link.js';

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
    const done = await deliverFile(`tally-book-${stamp()}.json`, JSON.stringify(backup, null, 1), 'application/json');
    if (!done) return false;
    await markExported();
    toast(`Backup saved: ${plural(state.accounts.length, 'account')}, ${plural(state.goals.length, 'pot')}`);
    return true;
  } catch (err) {
    toast(describeError(err), { tone: 'error' });
    return false;
  }
}

export async function startRestore() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  const parsed = parseBackup(file.text);
  if (!parsed.ok) {
    toast(parsed.error, { tone: 'error', duration: 8000 });
    return;
  }
  const d = parsed.data;
  const hasData = state.accounts.length > 0 || state.goals.length > 0;
  const ok = await confirmDialog({
    title: 'Replace this book with that one?',
    message: html`<p>The file${parsed.exportedAt ? ` from ${date(dayOf(parsed.exportedAt))}` : ''} holds
      ${plural(d.accounts.length, 'account')} and ${plural(d.goals.length, 'pot')}.</p>
      ${parsed.carried ? html`<p>It also carries ${plural(parsed.carried, 'record')} from an older version that this one doesn’t read. They travel along untouched.</p>` : ''}
      ${hasData ? html`<p>Everything written in now will be replaced.</p>` : ''}
      ${parsed.dropped ? html`<p class="notice warn">${plural(parsed.dropped, 'damaged record')} in the file will be left out.</p>` : ''}
      ${d.accounts.some((a) => a.vault) ? html`<p class="notice">Sealed details come back sealed. They open with the passphrase they were sealed under, not necessarily this device’s.</p>` : ''}`,
    extra: hasData
      ? html`<label class="check"><input type="checkbox" name="saveFirst" checked /><span>Save a copy of this book first</span></label>`
      : null,
    confirmLabel: 'Replace it',
    danger: hasData,
  });
  if (!ok) return;
  if (ok.saveFirst) {
    const saved = await exportJSON();
    if (!saved) {
      toast('Nothing replaced, because the copy wasn’t saved.');
      return;
    }
  }
  try {
    await restoreBackup(d);
    toast(`Restored ${plural(d.accounts.length, 'account')} and ${plural(d.goals.length, 'pot')}`);
  } catch (err) {
    toast(describeError(err), { tone: 'error' });
  }
}

async function startErase() {
  const ok = await confirmDialog({
    title: 'Burn the book?',
    message: html`<p>This permanently deletes every account, pot, reading and sealed detail on this device. It can’t be undone.</p>`,
    extra: state.accounts.length || state.goals.length
      ? html`<label class="check"><input type="checkbox" name="saveFirst" checked /><span>Save a copy first</span></label>`
      : null,
    requireText: 'burn',
    confirmLabel: 'Burn it',
    danger: true,
  });
  if (!ok) return;
  if (ok.saveFirst && !(await exportJSON())) {
    toast('Nothing erased, because the copy wasn’t saved.');
    return;
  }
  try {
    await eraseAll();
    toast('Erased. The book is blank again.');
    location.hash = '#/';
  } catch (err) {
    toast(describeError(err), { tone: 'error' });
  }
}

function storageText() {
  switch (state.storageKind) {
    case 'indexeddb':
      return 'Kept in this browser’s database (IndexedDB).';
    case 'localstorage':
      return 'Kept in this browser’s local storage, which holds only a few megabytes. Save copies often.';
    default:
      return 'This browser isn’t letting the book save anything. What you write disappears when you close the tab.';
  }
}

export function renderSettings() {
  const s = state.settings;
  const sample = formatMoney(123456, { currency: s.currency, locale: s.locale });
  const archived = Object.entries(state.archive ?? {}).reduce((sum, [, v]) => sum + (Array.isArray(v) ? v.length : 0), 0);

  return html`${chapterHead('settings')}

    ${section('How figures are set', html`<div class="stack">
      <label class="field">
        <span class="label">Currency</span>
        <select data-setting="currency">
          ${CURRENCIES.map(([code, name]) => html`<option value="${code}" ${s.currency === code ? 'selected' : ''}>${name} (${code})</option>`)}
        </select>
      </label>
      <label class="field">
        <span class="label">Number and date format</span>
        <select data-setting="locale">
          ${LOCALES.map(([code, name]) => html`<option value="${code}" ${s.locale === code ? 'selected' : ''}>${name}</option>`)}
        </select>
        <span class="hint">Amounts look like ${sample}.</span>
      </label>
      <fieldset class="field">
        <legend class="label">Paper</legend>
        <div class="seg" role="radiogroup" aria-label="Paper">
          ${[['system', 'As the device'], ['light', 'Day'], ['dark', 'Night']].map(([v, label]) => html`<label><input type="radio" name="theme" value="${v}" ${s.theme === v ? 'checked' : ''} data-setting="theme" /><span>${label}</span></label>`)}
        </div>
      </fieldset>
    </div>`, { id: 'format' })}

    ${section('The strongbox', html`${!vaultAvailable()
      ? html`<p class="hand">The strongbox needs the installed book or an https address. Over a plain http link it stays shut.</p>`
      : !vaultExists()
        ? html`<p class="hand">Numbers and logins are encrypted on this device with a key made from a passphrase only you know. Nothing recoverable, nothing sent anywhere.</p>
            <div class="btn-row"><button type="button" class="btn primary" data-action="vault-create">${icons.lock}Set a passphrase</button></div>`
        : html`<p class="hand">Sealed with your passphrase, which is not written down anywhere — not here, not in a backup.</p>
            <ul class="plain-list ruled-list">
              ${ruledRow('Right now', isUnlocked() ? 'open' : 'shut', { tone: isUnlocked() ? 'thin' : 'covered' })}
              ${ruledRow('Sealed accounts', String(state.accounts.filter((a) => a.vault).length))}
            </ul>
            <div class="btn-row">
              ${isUnlocked() ? html`<button type="button" class="btn" data-action="vault-lock">Shut it now</button>` : html`<button type="button" class="btn" data-action="vault-unlock">Open it</button>`}
              <button type="button" class="btn ghost" data-action="vault-change">Change the passphrase</button>
            </div>`}`, { id: 'strongbox' })}

    ${section('Connections', html`${!vaultAvailable()
      ? html`<p class="hand">A connection needs the installed book or an <strong>https</strong> address, because the token it uses lives in the strongbox, and a browser only lends out the lock on a secure address.</p>
          <p class="marginal">You are reading this over plain http — the address <code>npm start</code> prints for a phone is exactly that. Put the book on any https host and add it to your home screen, and this offer appears.</p>`
      : !bridgeConnected()
        ? html`<p class="hand">Tally can read your balances through a <strong>bridge</strong> — a small program you run, which holds your <strong>Teller</strong> certificate and asks your banks for figures. Teller's free tier covers a hundred sign-ins and is never billed.</p>
            <p class="marginal">Nothing of mine sits anywhere on that path. You sign in at your own bridge, it hands you one line, and the book keeps that line sealed and asks it for balances — never for what you spent. Set it up with <code>node scripts/teller-proxy.js</code>; the README has the steps.</p>
            <div class="btn-row"><button type="button" class="btn primary" data-action="bridge-connect">${icons.sync}Connect a bridge</button></div>`
        : html`<ul class="plain-list ruled-list">
              ${ruledRow('Bridge', s.bridgeHost || 'connected', { wrap: true })}
              ${ruledRow('Last read', s.bridgeAt ? timeAgo(s.bridgeAt) : 'never')}
              ${ruledRow('Accounts following it', String(state.accounts.filter((a) => a.link).length))}
            </ul>
            <p class="marginal">The token is sealed in the strongbox, so a read only works while that is open — and only while the bridge is running.</p>
            <div class="btn-row">
              <button type="button" class="btn primary" data-action="bridge-sync">${icons.sync}Read balances now</button>
              <button type="button" class="btn ghost" data-action="bridge-move">It has moved</button>
              <button type="button" class="btn ghost danger-text" data-action="bridge-forget">Disconnect</button>
            </div>`}`, { id: 'connections' })}

    ${section('Copies', html`<p class="hand">${s.lastExportAt ? `Last copy saved ${timeAgo(s.lastExportAt)}.` : 'No copy saved yet.'} This device holds the only one otherwise.</p>
      <div class="btn-row">
        <button type="button" class="btn primary" data-action="export-json">Save a copy</button>
        <button type="button" class="btn" data-action="restore-json">Restore from a copy</button>
      </div>
      ${archived ? html`<p class="marginal">The copy also carries ${plural(archived, 'record')} from the spending ledger this book no longer keeps. Nothing reads them; they are simply never thrown away.</p>` : ''}`, { id: 'copies' })}

    ${section('This device', html`<ul class="plain-list ruled-list">
        ${ruledRow('Storage', storageText(), { wrap: true })}
        ${ruledRow('Room used', html`<span data-storage>counting…</span>`)}
        ${ruledRow('Accounts', String(state.accounts.length))}
        ${ruledRow('Pots', String(state.goals.length))}
        ${ruledRow('Edition', APP_VERSION)}
      </ul>
      <div class="btn-row">
        <button type="button" class="btn ghost danger-text" data-action="erase">Burn the book</button>
      </div>`, { id: 'device' })}`;
}

export function afterSettingsMount(root) {
  for (const el of root.querySelectorAll('[data-setting]')) {
    el.addEventListener('change', async () => {
      const key = el.dataset.setting;
      const value = el.type === 'radio' ? el.value : el.value;
      try {
        await updateSettings({ [key]: value });
        if (key === 'currency') toast(`Amounts now look like ${formatMoney(123456, { currency: value, locale: state.settings.locale })}`);
      } catch (err) {
        toast(describeError(err), { tone: 'error' });
      }
    });
  }
  const slot = $('[data-storage]', root);
  if (slot) {
    storageEstimate().then((e) => {
      slot.textContent = e && e.usage ? `${(e.usage / 1024 / 1024).toFixed(1)} MB` : 'not reported';
    }).catch(() => {
      slot.textContent = 'not reported';
    });
  }
  root.querySelector('[data-action=erase]')?.addEventListener('click', startErase);
}
