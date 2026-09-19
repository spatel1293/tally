import { html, mount, formData, showErrors, errorSlot, $, $$ } from '../ui/html.js';
import { openSheet, toast } from '../ui/overlay.js';
import { state, saveTransaction, deleteTransactions, restoreTransactions, describeError, sortedTransactions } from '../store.js';
import { drafts } from '../storage.js';
import { validateTransactionInput, NOTE_MAX } from '../core/validate.js';
import { centsToInput } from '../core/money.js';
import { addDays, monthKey } from '../core/dates.js';
import { categoryUsage, budgetOverview, txsInMonth, categoryFamily, incomeAmount } from '../core/stats.js';
import { FREQUENCIES } from '../core/recurring.js';
import { money, signedMoney, date as fmtDate, month as fmtMonth } from '../ui/format.js';
import { openCategoryForm } from './forms.js';

function currencySymbol() {
  const { currency, locale } = state.settings;
  try {
    const part = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(1).find((p) => p.type === 'currency');
    return part?.value ?? currency;
  } catch {
    return '$';
  }
}

function orderedCategories(type) {
  const since = addDays(state.today, -90);
  const usage = categoryUsage(state.transactions, since);
  const byId = new Map(state.categories.map((c) => [c.id, c]));
  const rank = (c) => {
    const parent = c.parentId ? byId.get(c.parentId) : null;
    return parent ? parent.order + (c.order + 1) / 1000 : c.order;
  };
  return state.categories
    .filter((c) => c.type === type)
    .sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || rank(a) - rank(b));
}

function chips(type, selectedId) {
  const cats = orderedCategories(type);
  const byId = new Map(state.categories.map((c) => [c.id, c]));
  return html`${cats.map((c) => {
    const parent = c.parentId ? byId.get(c.parentId) : null;
    return html`<label class="chip" style="--c:${c.color}" title="${parent ? `${parent.name} › ${c.name}` : c.name}">
      <input type="radio" name="categoryId" value="${c.id}" ${c.id === selectedId ? 'checked' : ''} aria-describedby="err-categoryId" />
      <span><i aria-hidden="true">${c.icon}</i>${parent ? html`<small>${parent.name} ›</small> ` : ''}${c.name}</span>
    </label>`;
  })}
  <button type="button" class="chip chip-add" data-new-category>New category</button>`;
}

// Most recent category used with each note, so a known payee fills itself in.
function noteMemory() {
  const map = new Map();
  for (const t of sortedTransactions()) {
    const key = t.note.trim().toLowerCase();
    if (key && !map.has(key)) map.set(key, { categoryId: t.categoryId, type: t.type, note: t.note });
    if (map.size >= 300) break;
  }
  return map;
}

// How the chosen category is tracking this month. CSS shows this beside the
// form only where there's room for it, so unfolding the phone reveals the
// context instead of just making the form wider.
function contextPane(categoryId, currentId) {
  const cat = categoryId ? state.categories.find((c) => c.id === categoryId) : null;
  if (!cat) return html`<p class="tx-context-hint">Pick a category to see how it’s tracking this month.</p>`;

  const key = monthKey(state.today);
  const family = new Set(categoryFamily(cat.id, state.categories));
  const recent = sortedTransactions()
    .filter((t) => family.has(t.categoryId) && t.id !== currentId)
    .slice(0, 3);

  let figures;
  if (cat.type === 'income') {
    const received = txsInMonth(state.transactions, key)
      .filter((t) => family.has(t.categoryId))
      .reduce((sum, t) => sum + incomeAmount(t), 0);
    figures = html`<div><dt>Received in ${fmtMonth(key)}</dt><dd class="amt amt-in">${money(received)}</dd></div>`;
  } else {
    const overview = budgetOverview(state.transactions, state.categories, key, state.settings.warnPercent);
    let row = null;
    for (const r of overview.rows) {
      if (r.categoryId === cat.id) {
        row = r;
        break;
      }
      const kid = r.children.find((k) => k.categoryId === cat.id);
      if (kid) {
        row = kid;
        break;
      }
    }
    const spent = row?.spent ?? 0;
    figures = html`<div><dt>Spent in ${fmtMonth(key)}</dt><dd class="amt">${money(spent)}</dd></div>
      ${row && row.limit != null
        ? html`<div>
            <dt>${row.state === 'over' ? 'Over its' : 'Left of'} ${money(row.limit)} budget</dt>
            <dd class="amt s-${row.state}">${money(Math.abs(row.remaining))}</dd>
          </div>`
        : html`<div><dt>Budget</dt><dd class="tx-context-none">None set</dd></div>`}`;
  }

  return html`<p class="tx-context-cat"><i aria-hidden="true">${cat.icon}</i>${cat.name}</p>
    <dl class="tx-context-figs">${figures}</dl>
    ${recent.length
      ? html`<p class="tx-context-title">Recent</p>
          <ul class="plain-list tx-context-recent">
            ${recent.map(
              (t) => html`<li>
                <span class="tx-context-when">${t.note.trim() || fmtDate(t.date, { month: 'short', day: 'numeric' })}</span>
                ${signedMoney(t)}
              </li>`
            )}
          </ul>`
      : html`<p class="tx-context-none">Nothing recorded here yet.</p>`}`;
}

function hasContent(d) {
  return Boolean(d && (String(d.amount ?? '').trim() || String(d.note ?? '').trim()));
}

export function openTransactionForm({ id = null, preset = {} } = {}) {
  const existing = id ? state.transactions.find((t) => t.id === id) : null;
  if (id && !existing) {
    toast('That transaction no longer exists.');
    return;
  }
  const { locale } = state.settings;
  const validAccount = (aid) => (aid && state.accounts.some((a) => a.id === aid) ? aid : '');
  const defaultAccount =
    validAccount(preset.accountId) ||
    validAccount(state.lastAccountId) ||
    validAccount(state.settings.defaultAccountId) ||
    (state.accounts.length === 1 ? state.accounts[0].id : '');

  const original = existing
    ? {
        type: existing.type,
        amount: centsToInput(existing.amount, { locale }),
        categoryId: existing.categoryId ?? '',
        date: existing.date,
        note: existing.note ?? '',
        accountId: validAccount(existing.accountId),
        refund: Boolean(existing.refund),
      }
    : {
        type: preset.type ?? 'expense',
        amount: '',
        categoryId: preset.categoryId ?? '',
        date: preset.date ?? state.today,
        note: '',
        accountId: defaultAccount,
        refund: false,
      };

  const draft = drafts.load();
  const restored = !preset.ignoreDraft && draft && (draft.txId ?? null) === (id ?? null) && hasContent(draft.values);
  const values = restored ? { ...original, ...draft.values } : { ...original };
  if (!restored && draft && (draft.txId ?? null) === (id ?? null)) drafts.clear();

  const memory = noteMemory();
  const rule = existing?.recurringId ? state.recurring.find((r) => r.id === existing.recurringId) : null;
  let categoryTouched = Boolean(values.categoryId);

  const body = html`<form class="tx-form" id="tx-form" novalidate autocomplete="off">
    ${restored
      ? html`<p class="notice" data-restored>Your unsaved entry was restored. <button type="button" class="link-btn" data-discard>Start over</button></p>`
      : ''}
    <div class="seg" role="radiogroup" aria-label="Transaction type">
      <label><input type="radio" name="type" value="expense" ${values.type === 'expense' ? 'checked' : ''} /><span>Expense</span></label>
      <label><input type="radio" name="type" value="income" ${values.type === 'income' ? 'checked' : ''} /><span>Income</span></label>
    </div>

    <label class="amount-field" data-type="${values.type}">
      <span class="label">Amount</span>
      <span class="amount-wrap">
        <span class="amount-sym" aria-hidden="true">${currencySymbol()}</span>
        <input name="amount" inputmode="decimal" enterkeyhint="done" placeholder="0.00" value="${values.amount}" aria-describedby="err-amount" aria-required="true" />
      </span>
    </label>
    ${errorSlot('amount')}

    <fieldset class="field">
      <legend class="label">Category</legend>
      <div class="chips" data-chips>${chips(values.type, values.categoryId)}</div>
      ${errorSlot('categoryId')}
    </fieldset>

    <div class="field">
      <label class="label" for="tx-date">Date</label>
      <div class="date-row">
        <input id="tx-date" type="date" name="date" value="${values.date}" min="1900-01-01" max="2199-12-31" aria-describedby="err-date" required />
        <button type="button" class="btn small ghost" data-date="0">Today</button>
        <button type="button" class="btn small ghost" data-date="-1">Yesterday</button>
      </div>
      ${errorSlot('date')}
    </div>

    <label class="field">
      <span class="label">Note or payee <span class="opt">Optional</span></span>
      <input name="note" value="${values.note}" maxlength="${NOTE_MAX}" list="note-options" aria-describedby="err-note" />
      <datalist id="note-options">${[...memory.values()].slice(0, 60).map((m) => html`<option value="${m.note}"></option>`)}</datalist>
    </label>
    ${errorSlot('note')}

    ${state.accounts.length > 1
      ? html`<label class="field">
          <span class="label">Account</span>
          <select name="accountId">
            <option value="">No account</option>
            ${state.accounts.map((a) => html`<option value="${a.id}" ${a.id === values.accountId ? 'selected' : ''}>${a.name}</option>`)}
          </select>
        </label>`
      : html`<input type="hidden" name="accountId" value="${values.accountId}" />`}

    <label class="check" data-refund ${values.type === 'income' ? 'hidden' : ''}>
      <input type="checkbox" name="refund" ${values.refund ? 'checked' : ''} />
      <span>This is a refund<small>Money back from a purchase. It lowers spending in this category.</small></span>
    </label>

    ${existing
      ? html`<p class="meta-note">
          ${rule ? html`Created by the repeating transaction “${rule.note || 'Untitled'}” (${FREQUENCIES[rule.frequency].label.toLowerCase()}). Changes here only affect this one.` : ''}
          Added ${existing.createdAt ? fmtDate(existing.createdAt.slice(0, 10)) : 'earlier'}.
        </p>`
      : ''}
    <button type="submit" hidden></button>
  </form>
  <aside class="tx-context" data-tx-context aria-live="polite">${contextPane(values.categoryId, id)}</aside>`;

  const saveLabel = (type) => (existing ? 'Save changes' : type === 'income' ? 'Save income' : 'Save expense');
  const footer = html`
    ${existing ? html`<button type="button" class="btn ghost danger-text" data-delete>Delete</button>` : html`<button type="button" class="btn ghost" data-save-another>Save and add another</button>`}
    <button type="button" class="btn primary grow" data-save>${saveLabel(values.type)}</button>`;

  openSheet({
    title: existing ? 'Edit transaction' : 'New transaction',
    body,
    footer,
    size: 'tx',
    onMount(dialog, sheet) {
      const form = $('#tx-form', dialog);
      const amount = $('input[name="amount"]', form);
      const saveBtn = $('[data-save]', dialog);
      const buttons = $$('.sheet-foot button', dialog);

      const current = () => formData(form);
      // Once saved, deleted or handed off, closing the sheet blurs the focused
      // input and fires 'change'; that must not write the entry back as a draft.
      let finished = false;
      const persistDraft = () => {
        if (finished) return;
        const v = current();
        const changed = Object.keys(original).some((k) => String(v[k] ?? '') !== String(original[k] ?? ''));
        if (changed && hasContent(v)) drafts.save({ txId: id, values: v, savedAt: Date.now() });
        else drafts.clear();
      };

      const refreshContext = () => mount($('[data-tx-context]', dialog), contextPane(current().categoryId, id));

      const setType = (type) => {
        const selected = current().categoryId;
        const keep = state.categories.find((c) => c.id === selected)?.type === type ? selected : '';
        mount($('[data-chips]', form), chips(type, keep));
        if (!keep) categoryTouched = false;
        $('[data-refund]', form).hidden = type === 'income';
        $('.amount-field', form).dataset.type = type;
        saveBtn.textContent = saveLabel(type);
        refreshContext();
      };

      form.addEventListener('change', (e) => {
        if (e.target.name === 'type') setType(e.target.value);
        if (e.target.name === 'categoryId') {
          categoryTouched = true;
          refreshContext();
        }
        persistDraft();
      });
      form.addEventListener('input', (e) => {
        if (e.target.name === 'note' && !categoryTouched) {
          const hit = memory.get(e.target.value.trim().toLowerCase());
          if (hit && state.categories.some((c) => c.id === hit.categoryId)) {
            if (hit.type !== current().type) {
              $(`input[name="type"][value="${hit.type}"]`, form).checked = true;
              setType(hit.type);
            }
            const radio = $(`input[name="categoryId"][value="${hit.categoryId}"]`, form);
            if (radio) radio.checked = true;
            refreshContext();
          }
        }
        if (e.target.getAttribute('aria-invalid')) {
          e.target.removeAttribute('aria-invalid');
          const slot = $(`[data-error-for="${e.target.name}"]`, form);
          if (slot) slot.hidden = true;
        }
        persistDraft();
      });

      form.addEventListener('click', (e) => {
        const quick = e.target.closest('[data-date]');
        if (quick) {
          $('input[name="date"]', form).value = addDays(state.today, Number(quick.dataset.date));
          persistDraft();
        }
        if (e.target.closest('[data-discard]')) {
          finished = true;
          drafts.clear();
          sheet.close({ silent: true });
          openTransactionForm({ id, preset: { ...preset, ignoreDraft: true } });
        }
        if (e.target.closest('[data-new-category]')) {
          const type = current().type;
          drafts.save({ txId: id, values: current(), savedAt: Date.now() });
          finished = true;
          sheet.close({ silent: true });
          openCategoryForm({
            preset: { type },
            onDone(cat) {
              const d = drafts.load();
              if (cat && d) drafts.save({ ...d, values: { ...d.values, type: cat.type, categoryId: cat.id } });
              openTransactionForm({ id, preset: cat ? { ...preset, type: cat.type, categoryId: cat.id } : preset });
            },
          });
        }
      });

      let busy = false;
      const save = async (addAnother) => {
        if (busy) return;
        const v = current();
        const result = validateTransactionInput(v, { locale, categories: state.categories, accounts: state.accounts });
        if (!result.ok) {
          showErrors(form, result.errors);
          return;
        }
        showErrors(form, {});
        busy = true;
        buttons.forEach((b) => (b.disabled = true));
        try {
          const record = await saveTransaction(result.value, id);
          if (!addAnother) finished = true;
          drafts.clear();
          // Close first so the confirmation isn't shown inside the closing sheet.
          if (!addAnother) sheet.close({ silent: true });
          const what = record.type === 'income' ? 'Income' : record.refund ? 'Refund' : 'Expense';
          if (existing) {
            toast('Changes saved');
          } else {
            toast(`${what} of ${money(record.amount)} saved`, {
              action: { label: 'Undo', onClick: () => deleteTransactions([record.id]).catch((err) => toast(describeError(err), { tone: 'error' })) },
            });
          }
          if (addAnother) {
            amount.value = '';
            $('input[name="note"]', form).value = '';
            $$('input[name="categoryId"]', form).forEach((r) => (r.checked = false));
            $('input[name="refund"]', form).checked = false;
            categoryTouched = false;
            $('[data-restored]', form)?.remove();
            refreshContext();
            amount.focus();
          }
        } catch (err) {
          toast(describeError(err), { tone: 'error' });
        } finally {
          busy = false;
          buttons.forEach((b) => (b.disabled = false));
        }
      };

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        save(false);
      });
      form.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          save(false);
        }
      });
      saveBtn.addEventListener('click', () => save(false));
      $('[data-save-another]', dialog)?.addEventListener('click', () => save(true));
      $('[data-delete]', dialog)?.addEventListener('click', async () => {
        try {
          const [removed] = await deleteTransactions([id]);
          finished = true;
          drafts.clear();
          sheet.close({ silent: true });
          toast('Transaction deleted', {
            action: { label: 'Undo', onClick: () => restoreTransactions([removed]).catch((err) => toast(describeError(err), { tone: 'error' })) },
          });
        } catch (err) {
          toast(describeError(err), { tone: 'error' });
        }
      });

      if (!existing) {
        amount.focus();
        if (restored) amount.setSelectionRange(amount.value.length, amount.value.length);
      }
    },
  });
}
