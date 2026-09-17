import { html, formData, showErrors, errorSlot, $, $$ } from '../ui/html.js';
import { openSheet, toast, confirmDialog } from '../ui/overlay.js';
import {
  state, saveCategory, deleteCategory, categoryUsageCounts, setBudget, saveAccount, deleteAccount,
  saveRule, deleteRule, saveGoal, deleteGoal, adjustGoal, describeError,
} from '../store.js';
import { validateCategoryInput, NAME_MAX, NOTE_MAX } from '../core/validate.js';
import { parseAmount, centsToInput } from '../core/money.js';
import { isValidISODate } from '../core/dates.js';
import { ICONS, PALETTE, ACCOUNT_KINDS } from '../core/defaults.js';
import { FREQUENCIES, occurrencesBetween } from '../core/recurring.js';
import { money, plural, categoryTree, categoryOptionLabel } from '../ui/format.js';

const fail = (err) => toast(describeError(err), { tone: 'error' });

function footerButtons({ saveLabel, deletable }) {
  return html`${deletable ? html`<button type="button" class="btn ghost danger-text" data-delete>Delete</button>` : ''}
    <button type="button" class="btn primary grow" data-save>${saveLabel}</button>`;
}

function wireSave(dialog, form, handler) {
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    $$('.sheet-foot button', dialog).forEach((b) => (b.disabled = true));
    try {
      await handler();
    } catch (err) {
      fail(err);
    } finally {
      busy = false;
      $$('.sheet-foot button', dialog).forEach((b) => (b.disabled = false));
    }
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    run();
  });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      run();
    }
  });
  $('[data-save]', dialog).addEventListener('click', run);
}

function moneyField(name, value, { label, hint = '', optional = false, allowNegative = false } = {}) {
  return html`<label class="field">
      <span class="label">${label}${optional ? html` <span class="opt">Optional</span>` : ''}</span>
      <input name="${name}" inputmode="${allowNegative ? 'text' : 'decimal'}" value="${value}" aria-describedby="err-${name}" autocomplete="off" />
      ${hint ? html`<span class="hint">${hint}</span>` : ''}
    </label>
    ${errorSlot(name)}`;
}

// ---------- Categories ----------

export function openCategoryForm({ id = null, preset = {}, onDone = null } = {}) {
  const existing = id ? state.categories.find((c) => c.id === id) : null;
  const { locale } = state.settings;
  const v = existing
    ? { ...existing, budget: existing.budget == null ? '' : centsToInput(existing.budget, { locale }) }
    : { name: '', type: preset.type ?? 'expense', parentId: preset.parentId ?? '', icon: preset.type === 'income' ? '💰' : ICONS[0], color: PALETTE[state.categories.length % PALETTE.length], budget: '' };
  const hasKids = existing && state.categories.some((c) => c.parentId === existing.id);
  const parentOptions = (type) =>
    state.categories.filter((c) => c.type === type && !c.parentId && c.id !== id);

  const body = html`<form class="stack" novalidate autocomplete="off">
    <label class="field">
      <span class="label">Name</span>
      <input name="name" value="${v.name}" maxlength="${NAME_MAX}" aria-describedby="err-name" required />
    </label>
    ${errorSlot('name')}
    <div class="seg" role="radiogroup" aria-label="Category type">
      <label><input type="radio" name="type" value="expense" ${v.type === 'expense' ? 'checked' : ''} /><span>Expense</span></label>
      <label><input type="radio" name="type" value="income" ${v.type === 'income' ? 'checked' : ''} /><span>Income</span></label>
    </div>
    <label class="field">
      <span class="label">Inside another category <span class="opt">Optional</span></span>
      <select name="parentId" aria-describedby="err-parentId" ${hasKids ? 'disabled' : ''}>
        <option value="">No, keep it at the top level</option>
        ${parentOptions(v.type).map((c) => html`<option value="${c.id}" ${c.id === v.parentId ? 'selected' : ''}>${c.icon} ${c.name}</option>`)}
      </select>
      ${hasKids ? html`<span class="hint">This category has subcategories, so it stays at the top level.</span>` : ''}
    </label>
    ${errorSlot('parentId')}
    <fieldset class="field">
      <legend class="label">Icon</legend>
      <div class="icon-grid">
        ${[...new Set([v.icon, ...ICONS])].map((ic) => html`<label class="icon-opt"><input type="radio" name="icon" value="${ic}" ${ic === v.icon ? 'checked' : ''} /><span aria-hidden="true">${ic}</span><span class="sr-only">${ic}</span></label>`)}
      </div>
    </fieldset>
    <fieldset class="field">
      <legend class="label">Color</legend>
      <div class="swatches">
        ${[...new Set([v.color, ...PALETTE])].map((c) => html`<label class="swatch" style="--c:${c}"><input type="radio" name="color" value="${c}" ${c === v.color ? 'checked' : ''} /><span class="sr-only">${c}</span></label>`)}
      </div>
    </fieldset>
    <div data-budget ${v.type === 'income' ? 'hidden' : ''}>
      ${moneyField('budget', v.budget, { label: 'Monthly budget', optional: true, hint: 'Leave empty for no budget. 0 means you plan to spend nothing here.' })}
    </div>
  </form>`;

  openSheet({
    title: existing ? 'Edit category' : 'New category',
    body,
    footer: footerButtons({ saveLabel: existing ? 'Save changes' : 'Add category', deletable: Boolean(existing) }),
    onClose: () => onDone?.(null),
    onMount(dialog, sheet) {
      const form = $('form', dialog);
      form.addEventListener('change', (e) => {
        if (e.target.name !== 'type') return;
        const type = e.target.value;
        const select = $('select[name="parentId"]', form);
        select.innerHTML = '';
        select.append(new Option('No, keep it at the top level', ''));
        for (const c of parentOptions(type)) select.append(new Option(`${c.icon} ${c.name}`, c.id));
        $('[data-budget]', form).hidden = type === 'income';
      });
      wireSave(dialog, form, async () => {
        const data = formData(form);
        if (hasKids) data.parentId = '';
        const result = validateCategoryInput({ ...data, id, locale }, state.categories);
        if (!result.ok) return showErrors(form, result.errors);
        const saved = await saveCategory(result.value, id);
        toast(existing ? 'Category saved' : `Added ${saved.name}`);
        sheet.close({ silent: true });
        onDone?.(saved);
      });
      $('[data-delete]', dialog)?.addEventListener('click', () => {
        sheet.close({ silent: true });
        openDeleteCategory(existing, onDone);
      });
      if (!existing) $('input[name="name"]', form).focus();
    },
  });
}

export function openDeleteCategory(cat, onDone = null) {
  const counts = categoryUsageCounts(cat.id);
  const needsMove = counts.transactions > 0 || counts.rules > 0;
  const tree = categoryTree(cat.type, cat.id);
  const targets = tree.map((t) => t.cat);
  const kids = state.categories.filter((c) => c.parentId === cat.id);
  const fallback = cat.parentId && targets.some((t) => t.id === cat.parentId) ? cat.parentId : targets.find((t) => /^other$/i.test(t.name))?.id ?? targets[0]?.id;

  const uses = [];
  if (counts.transactions) uses.push(plural(counts.transactions, 'transaction'));
  if (counts.rules) uses.push(plural(counts.rules, 'repeating transaction'));

  const body = html`<form class="stack" novalidate>
    ${needsMove
      ? targets.length
        ? html`<p>${uses.join(' and ')} use ${cat.name}. Choose where they should go.</p>
          <label class="field">
            <span class="label">Move them to</span>
            <select name="moveTo">
              ${tree.map((t) => html`<option value="${t.cat.id}" ${t.cat.id === fallback ? 'selected' : ''}>${categoryOptionLabel(t)}</option>`)}
            </select>
          </label>`
        : html`<p class="notice warn">${uses.join(' and ')} use ${cat.name}, and there’s no other ${cat.type} category to move them to. Add another ${cat.type} category first.</p>`
      : html`<p>Nothing uses ${cat.name} yet, so deleting it won’t change any transactions.</p>`}
    ${kids.length ? html`<p>Its ${plural(kids.length, 'subcategory', 'subcategories')} (${kids.map((k) => k.name).join(', ')}) will move to the top level.</p>` : ''}
    ${cat.budget != null ? html`<p>Its monthly budget of ${money(cat.budget)} will be removed.</p>` : ''}
  </form>`;

  const blocked = needsMove && !targets.length;
  openSheet({
    title: `Delete ${cat.name}?`,
    body,
    footer: html`<button type="button" class="btn ghost" data-sheet-close>Keep it</button>
      <button type="button" class="btn danger grow" data-save ${blocked ? 'disabled' : ''}>Delete category</button>`,
    onClose: () => onDone?.(null),
    onMount(dialog, sheet) {
      const form = $('form', dialog);
      wireSave(dialog, form, async () => {
        if (blocked) return;
        const moveTo = needsMove ? $('select[name="moveTo"]', form).value : null;
        await deleteCategory(cat.id, moveTo);
        sheet.close({ silent: true });
        toast(`Deleted ${cat.name}${needsMove ? ` and moved ${uses.join(' and ')}` : ''}`);
        onDone?.(null);
      });
    },
  });
}

export function openBudgetForm(categoryId) {
  const cat = state.categories.find((c) => c.id === categoryId);
  if (!cat) return;
  const { locale } = state.settings;
  const body = html`<form class="stack" novalidate autocomplete="off">
    ${moneyField('budget', cat.budget == null ? '' : centsToInput(cat.budget, { locale }), {
      label: `Monthly budget for ${cat.name}`,
      hint: cat.parentId ? 'Tracked on its own. The parent category’s budget, if any, already includes this spending.' : state.categories.some((c) => c.parentId === cat.id) ? 'Includes spending in its subcategories.' : 'The same limit applies every month.',
    })}
  </form>`;
  openSheet({
    title: cat.budget == null ? 'Set a budget' : 'Change budget',
    body,
    footer: html`${cat.budget != null ? html`<button type="button" class="btn ghost danger-text" data-delete>Remove budget</button>` : ''}
      <button type="button" class="btn primary grow" data-save>Save budget</button>`,
    onMount(dialog, sheet) {
      const form = $('form', dialog);
      const input = $('input[name="budget"]', form);
      input.focus();
      input.select();
      wireSave(dialog, form, async () => {
        const parsed = parseAmount(input.value, { locale });
        if (!parsed.ok) return showErrors(form, { budget: input.value.trim() === '' ? 'Enter a budget, or use Remove budget.' : parsed.error });
        if (parsed.negative) return showErrors(form, { budget: 'A budget can’t be negative.' });
        await setBudget(cat.id, parsed.cents);
        sheet.close({ silent: true });
        toast(`${cat.name} budget set to ${money(parsed.cents)} a month`);
      });
      $('[data-delete]', dialog)?.addEventListener('click', async () => {
        try {
          await setBudget(cat.id, null);
          sheet.close({ silent: true });
          toast(`Removed the ${cat.name} budget`);
        } catch (err) {
          fail(err);
        }
      });
    },
  });
}

// ---------- Accounts ----------

export function openAccountForm(id = null) {
  const existing = id ? state.accounts.find((a) => a.id === id) : null;
  const { locale } = state.settings;
  const body = html`<form class="stack" novalidate autocomplete="off">
    <label class="field">
      <span class="label">Name</span>
      <input name="name" value="${existing?.name ?? ''}" maxlength="${NAME_MAX}" placeholder="e.g. Everyday checking" aria-describedby="err-name" />
    </label>
    ${errorSlot('name')}
    <label class="field">
      <span class="label">Kind</span>
      <select name="kind">
        ${Object.entries(ACCOUNT_KINDS).map(([k, label]) => html`<option value="${k}" ${(existing?.kind ?? 'checking') === k ? 'selected' : ''}>${label}</option>`)}
      </select>
    </label>
    ${moneyField('openingBalance', existing ? centsToInput(existing.openingBalance ?? 0, { locale }) : '0', {
      label: 'Starting balance',
      allowNegative: true,
      hint: 'The balance before your first transaction here. Use a minus sign for money owed, like a card balance: -250.',
    })}
    ${state.accounts.length ? '' : html`<p class="hint">Once you have two or more accounts, the add form lets you pick one.</p>`}
  </form>`;
  openSheet({
    title: existing ? 'Edit account' : 'New account',
    body,
    footer: footerButtons({ saveLabel: existing ? 'Save changes' : 'Add account', deletable: Boolean(existing) }),
    onMount(dialog, sheet) {
      const form = $('form', dialog);
      if (!existing) $('input[name="name"]', form).focus();
      wireSave(dialog, form, async () => {
        const data = formData(form);
        const errors = {};
        const name = data.name.trim().replace(/\s+/g, ' ');
        if (!name) errors.name = 'Give the account a name.';
        else if (state.accounts.some((a) => a.id !== id && a.name.toLowerCase() === name.toLowerCase())) errors.name = `You already have an account called “${name}”.`;
        let opening = 0;
        if (data.openingBalance.trim() !== '') {
          const parsed = parseAmount(data.openingBalance, { locale });
          if (!parsed.ok) errors.openingBalance = parsed.error;
          else opening = parsed.negative ? -parsed.cents : parsed.cents;
        }
        if (Object.keys(errors).length) return showErrors(form, errors);
        await saveAccount({ name, kind: data.kind, openingBalance: opening }, id);
        sheet.close({ silent: true });
        toast(existing ? 'Account saved' : `Added ${name}`);
      });
      $('[data-delete]', dialog)?.addEventListener('click', async () => {
        const count = state.transactions.filter((t) => t.accountId === id).length;
        const others = state.accounts.filter((a) => a.id !== id);
        const extra = count && others.length
          ? html`<label class="field"><span class="label">Move its ${plural(count, 'transaction')} to</span>
              <select id="move-account"><option value="">No account</option>${others.map((a) => html`<option value="${a.id}">${a.name}</option>`)}</select></label>`
          : null;
        const ok = await confirmDialog({
          title: `Delete ${existing.name}?`,
          message: count
            ? `${plural(count, 'transaction')} ${count === 1 ? 'is' : 'are'} linked to this account. They’ll be kept${others.length ? '' : ' without an account'}.`
            : 'No transactions use this account.',
          confirmLabel: 'Delete account',
          danger: true,
          extra,
        });
        if (!ok) return;
        const moveTo = document.getElementById('move-account')?.value || null;
        try {
          await deleteAccount(id, moveTo);
          sheet.close({ silent: true });
          toast(`Deleted ${existing.name}`);
        } catch (err) {
          fail(err);
        }
      });
    },
  });
}

// ---------- Recurring ----------

export function openRuleForm(id = null, preset = {}) {
  const existing = id ? state.recurring.find((r) => r.id === id) : null;
  const { locale } = state.settings;
  const v = existing
    ? { ...existing, amount: centsToInput(existing.amount, { locale }), endDate: existing.endDate ?? '' }
    : { type: preset.type ?? 'expense', amount: '', categoryId: '', accountId: state.accounts.length === 1 ? state.accounts[0].id : '', note: '', frequency: 'monthly', startDate: state.today, endDate: '', mode: 'auto', paused: false };
  const catSelect = (type, selected) =>
    html`<option value="">Choose a category</option>${categoryTree(type).map((t) => html`<option value="${t.cat.id}" ${t.cat.id === selected ? 'selected' : ''}>${categoryOptionLabel(t)}</option>`)}`;

  const body = html`<form class="stack" novalidate autocomplete="off">
    <div class="seg" role="radiogroup" aria-label="Type">
      <label><input type="radio" name="type" value="expense" ${v.type === 'expense' ? 'checked' : ''} /><span>Expense</span></label>
      <label><input type="radio" name="type" value="income" ${v.type === 'income' ? 'checked' : ''} /><span>Income</span></label>
    </div>
    <label class="field">
      <span class="label">Name</span>
      <input name="note" value="${v.note}" maxlength="${NOTE_MAX}" placeholder="e.g. Rent, Salary, Streaming" aria-describedby="err-note" />
    </label>
    ${errorSlot('note')}
    ${moneyField('amount', v.amount, { label: 'Amount' })}
    <label class="field">
      <span class="label">Category</span>
      <select name="categoryId" aria-describedby="err-categoryId">${catSelect(v.type, v.categoryId)}</select>
    </label>
    ${errorSlot('categoryId')}
    ${state.accounts.length > 1
      ? html`<label class="field"><span class="label">Account</span><select name="accountId"><option value="">No account</option>${state.accounts.map((a) => html`<option value="${a.id}" ${a.id === v.accountId ? 'selected' : ''}>${a.name}</option>`)}</select></label>`
      : html`<input type="hidden" name="accountId" value="${v.accountId ?? ''}" />`}
    <label class="field">
      <span class="label">How often</span>
      <select name="frequency">${Object.entries(FREQUENCIES).map(([k, f]) => html`<option value="${k}" ${k === v.frequency ? 'selected' : ''}>${f.label}</option>`)}</select>
    </label>
    <div class="row-2">
      <label class="field">
        <span class="label">${existing ? 'Starts' : 'First date'}</span>
        <input type="date" name="startDate" value="${v.startDate}" min="1900-01-01" max="2199-12-31" aria-describedby="err-startDate" />
      </label>
      <label class="field">
        <span class="label">Ends <span class="opt">Optional</span></span>
        <input type="date" name="endDate" value="${v.endDate}" min="1900-01-01" max="2199-12-31" aria-describedby="err-endDate" />
      </label>
    </div>
    ${errorSlot('startDate')}${errorSlot('endDate')}
    <fieldset class="field">
      <legend class="label">When it’s due</legend>
      <label class="radio-card"><input type="radio" name="mode" value="auto" ${v.mode === 'auto' ? 'checked' : ''} /><span><strong>Add it automatically</strong><small>Best for fixed amounts like rent or a subscription.</small></span></label>
      <label class="radio-card"><input type="radio" name="mode" value="remind" ${v.mode === 'remind' ? 'checked' : ''} /><span><strong>Remind me to log it</strong><small>Shows on Home when due, so you can confirm or skip. Good for bills that vary.</small></span></label>
    </fieldset>
    <p class="hint" data-backfill hidden></p>
    ${existing
      ? html`<label class="check"><input type="checkbox" name="paused" ${v.paused ? 'checked' : ''} /><span>Paused<small>Nothing is added or reminded while paused.</small></span></label>
          <p class="hint">Changes apply from now on. Transactions already added stay as they are.</p>`
      : ''}
  </form>`;

  openSheet({
    title: existing ? 'Edit repeating transaction' : 'New repeating transaction',
    body,
    footer: footerButtons({ saveLabel: existing ? 'Save changes' : 'Add repeating transaction', deletable: Boolean(existing) }),
    onMount(dialog, sheet) {
      const form = $('form', dialog);
      const backfill = $('[data-backfill]', form);
      const updateHint = () => {
        const d = formData(form);
        if (existing || !isValidISODate(d.startDate) || d.startDate >= state.today) {
          backfill.hidden = true;
          return;
        }
        if (d.mode === 'remind') {
          backfill.textContent = 'Reminders start from today. Past dates are not listed.';
        } else {
          const probe = { startDate: d.startDate, endDate: isValidISODate(d.endDate) ? d.endDate : null, frequency: d.frequency };
          const count = occurrencesBetween(probe, null, state.today, 5000).length;
          backfill.textContent = count
            ? `The first date is in the past, so ${plural(count, 'transaction')} will be added for past dates right away.`
            : '';
        }
        backfill.hidden = !backfill.textContent;
      };
      form.addEventListener('change', (e) => {
        if (e.target.name === 'type') $('select[name="categoryId"]', form).innerHTML = catSelect(e.target.value, '').toString();
        updateHint();
      });
      updateHint();
      if (!existing) $('input[name="note"]', form).focus();

      wireSave(dialog, form, async () => {
        const d = formData(form);
        const errors = {};
        const parsed = parseAmount(d.amount, { locale });
        if (!parsed.ok) errors.amount = parsed.error;
        else if (parsed.negative || parsed.cents === 0) errors.amount = 'Enter an amount greater than zero.';
        if (!d.note.trim()) errors.note = 'Give it a name so you can recognize it.';
        if (!state.categories.some((c) => c.id === d.categoryId)) errors.categoryId = 'Choose a category.';
        if (!isValidISODate(d.startDate)) errors.startDate = 'Enter a valid first date.';
        if (d.endDate && !isValidISODate(d.endDate)) errors.endDate = 'Enter a valid end date, or leave it empty.';
        else if (d.endDate && isValidISODate(d.startDate) && d.endDate < d.startDate) errors.endDate = 'The end date must be on or after the first date.';
        if (Object.keys(errors).length) return showErrors(form, errors);
        const value = {
          type: d.type,
          amount: parsed.cents,
          categoryId: d.categoryId,
          accountId: d.accountId || null,
          note: d.note.trim(),
          frequency: d.frequency,
          startDate: d.startDate,
          endDate: d.endDate || null,
          mode: d.mode,
          paused: Boolean(d.paused),
        };
        const before = state.transactions.length;
        await saveRule(value, id);
        const added = state.transactions.length - before;
        sheet.close({ silent: true });
        toast(existing ? 'Repeating transaction saved' : added ? `Saved, and added ${plural(added, 'past transaction')}` : `Saved ${value.note}`);
      });

      $('[data-delete]', dialog)?.addEventListener('click', async () => {
        const count = state.transactions.filter((t) => t.recurringId === id).length;
        const ok = await confirmDialog({
          title: `Stop repeating “${existing.note}”?`,
          message: count ? `The ${plural(count, 'transaction')} it already added will be kept.` : 'Nothing has been added by it yet.',
          confirmLabel: 'Delete repeating transaction',
          danger: true,
        });
        if (!ok) return;
        try {
          await deleteRule(id);
          sheet.close({ silent: true });
          toast('Repeating transaction deleted');
        } catch (err) {
          fail(err);
        }
      });
    },
  });
}

// ---------- Goals ----------

export function openGoalForm(id = null) {
  const existing = id ? state.goals.find((g) => g.id === id) : null;
  const { locale } = state.settings;
  const body = html`<form class="stack" novalidate autocomplete="off">
    <label class="field">
      <span class="label">Goal</span>
      <input name="name" value="${existing?.name ?? ''}" maxlength="${NAME_MAX}" placeholder="e.g. Emergency fund" aria-describedby="err-name" />
    </label>
    ${errorSlot('name')}
    ${moneyField('target', existing ? centsToInput(existing.target, { locale }) : '', { label: 'Target amount' })}
    ${moneyField('saved', existing ? centsToInput(existing.saved ?? 0, { locale }) : '', { label: 'Saved so far', optional: true })}
    <label class="field">
      <span class="label">Target date <span class="opt">Optional</span></span>
      <input type="date" name="targetDate" value="${existing?.targetDate ?? ''}" min="1900-01-01" max="2199-12-31" />
    </label>
    <fieldset class="field">
      <legend class="label">Color</legend>
      <div class="swatches">${PALETTE.map((c) => html`<label class="swatch" style="--c:${c}"><input type="radio" name="color" value="${c}" ${(existing?.color ?? PALETTE[state.goals.length % PALETTE.length]) === c ? 'checked' : ''} /><span class="sr-only">${c}</span></label>`)}</div>
    </fieldset>
    <p class="hint">Goals are tracked separately from your budget. Add money to a goal whenever you set some aside.</p>
  </form>`;
  openSheet({
    title: existing ? 'Edit goal' : 'New savings goal',
    body,
    footer: footerButtons({ saveLabel: existing ? 'Save changes' : 'Add goal', deletable: Boolean(existing) }),
    onMount(dialog, sheet) {
      const form = $('form', dialog);
      if (!existing) $('input[name="name"]', form).focus();
      wireSave(dialog, form, async () => {
        const d = formData(form);
        const errors = {};
        const name = d.name.trim();
        if (!name) errors.name = 'Name your goal.';
        const target = parseAmount(d.target, { locale });
        if (!target.ok) errors.target = target.error;
        else if (target.negative || target.cents === 0) errors.target = 'Enter a target greater than zero.';
        let saved = 0;
        if (d.saved.trim()) {
          const s = parseAmount(d.saved, { locale });
          if (!s.ok) errors.saved = s.error;
          else if (s.negative) errors.saved = 'Saved so far can’t be negative.';
          else saved = s.cents;
        }
        if (Object.keys(errors).length) return showErrors(form, errors);
        await saveGoal({ name, target: target.cents, saved, targetDate: d.targetDate || null, color: d.color || PALETTE[0] }, id);
        sheet.close({ silent: true });
        toast(existing ? 'Goal saved' : `Added ${name}`);
      });
      $('[data-delete]', dialog)?.addEventListener('click', async () => {
        const ok = await confirmDialog({ title: `Delete “${existing.name}”?`, message: 'This removes the goal and its progress. Your transactions are not affected.', confirmLabel: 'Delete goal', danger: true });
        if (!ok) return;
        try {
          await deleteGoal(id);
          sheet.close({ silent: true });
          toast('Goal deleted');
        } catch (err) {
          fail(err);
        }
      });
    },
  });
}

export function openGoalAdjust(id) {
  const goal = state.goals.find((g) => g.id === id);
  if (!goal) return;
  const { locale } = state.settings;
  const body = html`<form class="stack" novalidate autocomplete="off">
    <p>${goal.name}: ${money(goal.saved ?? 0)} of ${money(goal.target)} saved.</p>
    <div class="seg" role="radiogroup" aria-label="Direction">
      <label><input type="radio" name="dir" value="add" checked /><span>Add money</span></label>
      <label><input type="radio" name="dir" value="withdraw" /><span>Take money out</span></label>
    </div>
    ${moneyField('amount', '', { label: 'Amount' })}
  </form>`;
  openSheet({
    title: 'Update goal',
    body,
    footer: html`<button type="button" class="btn primary grow" data-save>Update goal</button>`,
    onMount(dialog, sheet) {
      const form = $('form', dialog);
      $('input[name="amount"]', form).focus();
      wireSave(dialog, form, async () => {
        const d = formData(form);
        const parsed = parseAmount(d.amount, { locale });
        if (!parsed.ok) return showErrors(form, { amount: parsed.error });
        if (parsed.negative || parsed.cents === 0) return showErrors(form, { amount: 'Enter an amount greater than zero.' });
        const delta = d.dir === 'withdraw' ? -parsed.cents : parsed.cents;
        await adjustGoal(id, delta);
        sheet.close({ silent: true });
        const updated = state.goals.find((g) => g.id === id);
        toast(updated && updated.saved >= updated.target ? `${goal.name} is fully funded` : `${goal.name} now has ${money(updated?.saved ?? 0)}`);
      });
    },
  });
}
