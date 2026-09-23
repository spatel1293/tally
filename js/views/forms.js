import { html, formData, showErrors, errorSlot, $, $$ } from '../ui/html.js';
import { openSheet, toast, confirmDialog } from '../ui/overlay.js';
import { state, saveAccount, deleteAccount, recordBalance, saveGoal, deleteGoal, adjustGoal, describeError } from '../store.js';
import { NAME_MAX, NOTE_MAX } from '../core/validate.js';
import { parseAmount, centsToInput } from '../core/money.js';
import { isValidISODate } from '../core/dates.js';
import { PALETTE, PLAN_ICONS, ACCOUNT_KINDS, ACCOUNT_ROLES, roleForKind } from '../core/defaults.js';
import { PLAN_KINDS, BP } from '../core/plans.js';
import { money, plural } from '../ui/format.js';
import { vaultAvailable, vaultExists, isUnlocked, createVault, unlock, seal, open as openSealed, changePassphrase, describeVaultError } from '../vault.js';

const fail = (err) => toast(describeVaultError(err) ?? describeError(err), { tone: 'error' });

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

function moneyField(name, value, { label, hint = '', optional = false } = {}) {
  return html`<label class="field">
      <span class="label">${label}${optional ? html` <span class="opt">optional</span>` : ''}</span>
      <input name="${name}" inputmode="decimal" value="${value}" aria-describedby="err-${name}" autocomplete="off" />
      ${hint ? html`<span class="hint">${hint}</span>` : ''}
    </label>
    ${errorSlot(name)}`;
}

// A percentage typed as "4.25" becomes 425 basis points, and only that: two
// decimals, nothing past 100.
function parsePercent(text) {
  const t = String(text ?? '').trim().replace(',', '.').replace('%', '');
  if (t === '') return { ok: true, bp: 0 };
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return { ok: false, error: 'A percentage, like 4.25.' };
  const bp = Math.round(Number(t) * 100);
  if (bp > BP) return { ok: false, error: 'Can’t be more than 100%.' };
  return { ok: true, bp };
}

const fmtPercent = (bp) => (bp ? (bp / 100).toFixed(2).replace(/\.?0+$/, '') : '');

// ---------- The strongbox ----------

export async function passphraseDialog({ mode = 'unlock' } = {}) {
  if (!vaultAvailable()) {
    toast(describeVaultError(new Error('vault-unavailable')), { tone: 'error' });
    return false;
  }
  const create = mode === 'create';
  const change = mode === 'change';
  const extra = html`<div class="stack">
    ${change ? html`<label class="field"><span class="label">Current passphrase</span><input type="password" id="vault-current" autocomplete="current-password" /></label>` : ''}
    <label class="field">
      <span class="label">${create ? 'Choose a passphrase' : change ? 'New passphrase' : 'Passphrase'}</span>
      <input type="password" id="vault-pass" autocomplete="${create || change ? 'new-password' : 'current-password'}" />
    </label>
    ${create || change ? html`<label class="field"><span class="label">Type it again</span><input type="password" id="vault-pass2" autocomplete="new-password" /></label>` : ''}
    <p class="field-error" id="vault-error" role="alert" hidden></p>
  </div>`;
  return confirmDialog({
    title: create ? 'Seal the strongbox' : change ? 'Change the passphrase' : 'Open the strongbox',
    message: create
      ? 'Numbers and logins are encrypted on this device with a key made from this passphrase. It is never written down anywhere, so there is no way to recover it: lose it and the sealed pages stay shut for good.'
      : change
        ? 'Everything sealed is unsealed and sealed again under the new passphrase.'
        : 'It stays open for a few minutes, then shuts itself.',
    confirmLabel: create ? 'Seal' : change ? 'Change' : 'Open',
    extra,
    focus: change ? '#vault-current' : '#vault-pass',
    validate: async (dialog) => {
      const err = $('#vault-error', dialog);
      const show = (m) => {
        err.textContent = m;
        err.hidden = false;
        return false;
      };
      const pass = $('#vault-pass', dialog).value;
      if (create || change) {
        if (pass.length < 8) return show('Use at least 8 characters.');
        if (pass !== $('#vault-pass2', dialog).value) return show('The two don’t match.');
      }
      try {
        if (create) await createVault(pass);
        else if (change) {
          const done = await changePassphrase($('#vault-current', dialog).value, pass, state.accounts, saveAccount);
          if (!done) return show('That isn’t the current passphrase.');
        } else if (!(await unlock(pass))) return show('That isn’t the passphrase.');
      } catch (e) {
        return show(describeVaultError(e) ?? describeError(e));
      }
      return true;
    },
  });
}

// ---------- Accounts ----------

function sealedInputs(values) {
  return html`<div class="stack sealed-inputs">
    <div class="row-2">
      <label class="field"><span class="label">Account number</span><input name="accountNumber" value="${values?.accountNumber ?? ''}" inputmode="numeric" autocomplete="off" /></label>
      <label class="field"><span class="label">Routing number</span><input name="routingNumber" value="${values?.routingNumber ?? ''}" inputmode="numeric" autocomplete="off" /></label>
    </div>
    <div class="row-2">
      <label class="field"><span class="label">Username</span><input name="username" value="${values?.username ?? ''}" autocomplete="off" /></label>
      <label class="field"><span class="label">Password</span><input name="password" type="password" value="${values?.password ?? ''}" autocomplete="off" /></label>
    </div>
    <label class="field"><span class="label">Private notes <span class="opt">security questions, PIN hints</span></span><textarea name="sealedNotes" rows="2" maxlength="${NOTE_MAX}">${values?.notes ?? ''}</textarea></label>
  </div>`;
}

export function openAccountForm(id = null) {
  const existing = id ? state.accounts.find((a) => a.id === id) : null;
  const { locale } = state.settings;
  const unlocked = isUnlocked();
  const body = html`<form class="stack" novalidate autocomplete="off">
    <label class="field">
      <span class="label">What you call it</span>
      <input name="name" value="${existing?.name ?? ''}" maxlength="${NAME_MAX}" placeholder="e.g. Core hub" aria-describedby="err-name" />
    </label>
    ${errorSlot('name')}
    <label class="field">
      <span class="label">Who holds it <span class="opt">optional</span></span>
      <input name="institution" value="${existing?.institution ?? ''}" maxlength="${NAME_MAX}" placeholder="e.g. Ally, Fidelity, Schwab" />
    </label>
    <div class="row-2">
      <label class="field">
        <span class="label">Kind</span>
        <select name="kind">
          ${Object.entries(ACCOUNT_KINDS).map(([k, label]) => html`<option value="${k}" ${(existing?.kind ?? 'savings') === k ? 'selected' : ''}>${label}</option>`)}
        </select>
      </label>
      <label class="field">
        <span class="label">Its job</span>
        <select name="role">
          ${Object.entries(ACCOUNT_ROLES).map(([k, label]) => html`<option value="${k}" ${(existing?.role ?? roleForKind(existing?.kind ?? 'savings')) === k ? 'selected' : ''}>${label}</option>`)}
        </select>
      </label>
    </div>
    ${moneyField('balance', existing ? centsToInput(existing.balance ?? 0, { locale }) : '', {
      label: existing ? 'What it holds' : 'What it holds today',
      hint: existing ? 'Changing it here replaces the last reading rather than adding one.' : 'Write in a new reading any time; the book keeps the old ones.',
    })}
    <div class="row-2">
      <label class="field">
        <span class="label">Pays <span class="opt">% a year</span></span>
        <input name="apy" inputmode="decimal" value="${fmtPercent(existing?.apyBp)}" placeholder="0" aria-describedby="err-apy" />
      </label>
      <label class="field">
        <span class="label">Last reviewed <span class="opt">optional</span></span>
        <input type="date" name="reviewedAt" value="${existing?.reviewedAt ?? ''}" min="1900-01-01" max="2199-12-31" />
      </label>
    </div>
    ${errorSlot('apy')}
    <label class="check">
      <input type="checkbox" name="mfa" ${existing?.mfa ? 'checked' : ''} />
      <span>Sign-in has a second step — an app code, a key, or a text</span>
    </label>
    <label class="field">
      <span class="label">Notes <span class="opt">optional</span></span>
      <textarea name="notes" rows="2" maxlength="${NOTE_MAX}" placeholder="Beneficiary set, fee-free ATMs, notice period…">${existing?.notes ?? ''}</textarea>
    </label>
    <fieldset class="field vault-fieldset">
      <legend class="label">Strongbox <span class="opt">sealed with your passphrase</span></legend>
      <div data-sealed-fields>
        ${!vaultAvailable()
          ? html`<p class="hint">Needs the installed book or an https address.</p>`
          : !vaultExists()
            ? html`<p class="hint">Set a passphrase first.</p><button type="button" class="btn small" data-vault-setup>Set a passphrase</button>`
            : !unlocked
              ? html`<p class="hint">${existing?.vault ? 'Sealed. Open the strongbox to edit these.' : 'Open the strongbox to write these in.'}</p><button type="button" class="btn small" data-vault-open>Open the strongbox</button>`
              : sealedInputs(null)}
      </div>
    </fieldset>
  </form>`;

  openSheet({
    title: existing ? 'Edit account' : 'Write in an account',
    body,
    footer: footerButtons({ saveLabel: existing ? 'Save' : 'Write it in', deletable: Boolean(existing) }),
    async onMount(dialog, sheet) {
      const form = $('form', dialog);
      if (!existing) $('input[name="name"]', form).focus();
      let roleTouched = Boolean(existing);
      form.addEventListener('change', (e) => {
        if (e.target.name === 'role') roleTouched = true;
        if (e.target.name === 'kind' && !roleTouched) $('select[name="role"]', form).value = roleForKind(e.target.value);
      });

      let sealedLoaded = false;
      const loadSealed = async () => {
        if (!isUnlocked()) return;
        const slot = $('[data-sealed-fields]', form);
        try {
          const values = existing?.vault ? await openSealed(existing.vault) : null;
          slot.replaceChildren();
          slot.insertAdjacentHTML('beforeend', String(sealedInputs(values)));
          sealedLoaded = true;
        } catch (e) {
          slot.replaceChildren();
          slot.insertAdjacentHTML('beforeend', String(html`<p class="field-error">Couldn’t unseal these. ${describeVaultError(e) ?? ''}</p>`));
        }
      };
      if (unlocked) await loadSealed();
      form.addEventListener('click', async (e) => {
        if (e.target.closest('[data-vault-setup]')) {
          if (await passphraseDialog({ mode: 'create' })) await loadSealed();
        } else if (e.target.closest('[data-vault-open]')) {
          if (await passphraseDialog({ mode: 'unlock' })) await loadSealed();
        }
      });

      wireSave(dialog, form, async () => {
        const d = formData(form);
        const errors = {};
        const name = d.name.trim().replace(/\s+/g, ' ');
        if (!name) errors.name = 'Give the account a name.';
        else if (state.accounts.some((a) => a.id !== id && a.name.toLowerCase() === name.toLowerCase())) errors.name = `There is already an account called “${name}”.`;
        let balance = 0;
        if (d.balance.trim() !== '') {
          const parsed = parseAmount(d.balance, { locale });
          if (!parsed.ok) errors.balance = parsed.error;
          else balance = parsed.negative ? -parsed.cents : parsed.cents;
        }
        const apy = parsePercent(d.apy);
        if (!apy.ok) errors.apy = apy.error;
        if (Object.keys(errors).length) return showErrors(form, errors);

        const record = {
          name,
          kind: d.kind,
          role: d.role in ACCOUNT_ROLES ? d.role : roleForKind(d.kind),
          institution: d.institution.trim().slice(0, NAME_MAX),
          apyBp: apy.bp,
          mfa: Boolean(d.mfa),
          reviewedAt: isValidISODate(d.reviewedAt) ? d.reviewedAt : null,
          notes: d.notes.trim().slice(0, NOTE_MAX),
          balance,
          balanceAt: existing && (existing.balance ?? 0) === balance ? existing.balanceAt : state.today,
        };
        if (sealedLoaded && isUnlocked()) {
          const values = {};
          for (const k of ['accountNumber', 'routingNumber', 'username', 'password', 'sealedNotes']) {
            const v = (d[k] ?? '').trim();
            if (v) values[k === 'sealedNotes' ? 'notes' : k] = v.slice(0, NOTE_MAX);
          }
          record.vault = Object.keys(values).length ? await seal(values) : null;
        }
        await saveAccount(record, id);
        sheet.close({ silent: true });
        toast(existing ? 'Saved' : `${name} written in`);
      });

      $('[data-delete]', dialog)?.addEventListener('click', async () => {
        const held = state.goals.filter((g) => g.accountId === id);
        const others = state.accounts.filter((a) => a.id !== id);
        const extra = held.length && others.length
          ? html`<label class="field"><span class="label">Move ${held.length === 1 ? 'its pot' : `its ${held.length} pots`} to</span>
              <select id="move-account"><option value="">Nowhere for now</option>${others.map((a) => html`<option value="${a.id}">${a.name}</option>`)}</select></label>`
          : null;
        const ok = await confirmDialog({
          title: `Close ${existing.name}?`,
          message: held.length
            ? `${plural(held.length, 'pot')} kept here will stay in the book, unplaced.${existing.vault ? ' Its sealed details go with it.' : ''}`
            : existing.vault ? 'Its sealed details go with it.' : 'Nothing else refers to this account.',
          confirmLabel: 'Close it',
          danger: true,
          extra,
        });
        if (!ok) return;
        const moveTo = document.getElementById('move-account')?.value || null;
        try {
          await deleteAccount(id, moveTo);
          sheet.close({ silent: true });
          toast(`${existing.name} closed`);
        } catch (err) {
          fail(err);
        }
      });
    },
  });
}

// Writing in a reading. The whole point of the book: one figure, one date.
export function openBalanceForm(id) {
  const account = state.accounts.find((a) => a.id === id);
  if (!account) return;
  const { locale } = state.settings;
  const body = html`<form class="stack" novalidate autocomplete="off">
    <p class="sheet-lede">${account.name}${account.institution ? ` · ${account.institution}` : ''} — last read ${account.balanceAt ? `on ${account.balanceAt} at ${money(account.balance ?? 0)}` : 'never'}.</p>
    ${moneyField('balance', '', { label: 'What it holds now' })}
    <label class="field">
      <span class="label">As at</span>
      <input type="date" name="date" value="${state.today}" min="1900-01-01" max="2199-12-31" />
    </label>
    <p class="hint">The figure that was there before is kept, so the book builds a history without you logging anything day to day.</p>
  </form>`;
  openSheet({
    title: 'Write in a balance',
    body,
    footer: html`<button type="button" class="btn primary grow" data-save>Write it in</button>`,
    onMount(dialog, sheet) {
      const form = $('form', dialog);
      $('input[name="balance"]', form).focus();
      wireSave(dialog, form, async () => {
        const d = formData(form);
        const parsed = parseAmount(d.balance, { locale });
        if (!parsed.ok) return showErrors(form, { balance: parsed.error });
        if (!isValidISODate(d.date)) return showErrors(form, { balance: 'Pick a date for this reading.' });
        const cents = parsed.negative ? -parsed.cents : parsed.cents;
        const before = account.balance ?? 0;
        const had = account.balanceAt;
        await recordBalance(id, cents, d.date);
        sheet.close({ silent: true });
        const change = cents - before;
        toast(had && change !== 0 ? `${account.name}: ${money(change, { sign: true })} since ${had}` : `${account.name} now ${money(cents)}`);
      });
    },
  });
}

// ---------- Pots ----------

export function openPlanForm(id = null, preset = {}) {
  const existing = id ? state.goals.find((g) => g.id === id) : null;
  const otherShares = state.goals.filter((g) => g.id !== id).reduce((sum, g) => sum + (g.allocBp ?? 0), 0);
  const { locale } = state.settings;
  const kind = existing?.kind ?? preset.kind ?? 'fund';
  const body = html`<form class="stack" novalidate autocomplete="off">
    <div class="seg seg-4" role="radiogroup" aria-label="Kind of pot">
      ${Object.entries(PLAN_KINDS).map(([k, label]) => html`<label><input type="radio" name="kind" value="${k}" ${kind === k ? 'checked' : ''} /><span>${label}</span></label>`)}
    </div>
    <label class="field">
      <span class="label">What it’s for</span>
      <input name="name" value="${existing?.name ?? ''}" maxlength="${NAME_MAX}" placeholder="e.g. Rainy day" aria-describedby="err-name" />
    </label>
    ${errorSlot('name')}
    <div class="row-2">
      ${moneyField('target', existing ? centsToInput(existing.target, { locale }) : '', { label: 'Target' })}
      ${moneyField('saved', existing ? centsToInput(existing.saved ?? 0, { locale }) : '', { label: 'Holds now', optional: true })}
    </div>
    <label class="field">
      <span class="label">Wanted by <span class="opt">optional</span></span>
      <input type="date" name="targetDate" value="${existing?.targetDate ?? ''}" min="1900-01-01" max="2199-12-31" />
    </label>
    <div class="row-2">
      <label class="field">
        <span class="label">Share of the surplus <span class="opt">%</span></span>
        <input name="alloc" inputmode="decimal" value="${fmtPercent(existing?.allocBp)}" placeholder="0" aria-describedby="err-alloc" />
        <span class="hint">${otherShares ? `Other pots take ${fmtPercent(otherShares) || 0}%, leaving ${fmtPercent(Math.max(0, BP - otherShares)) || 0}%.` : 'What part of each month’s leftover comes here.'}</span>
      </label>
      <label class="field">
        <span class="label">Earns <span class="opt">% a year</span></span>
        <input name="apy" inputmode="decimal" value="${fmtPercent(existing?.apyBp)}" placeholder="0" aria-describedby="err-apy" />
        <span class="hint" data-apy-hint>${kind === 'invest' ? 'The return you’re assuming — 7% is a common long-run guess.' : 'The rate the account pays, if it pays one.'}</span>
      </label>
    </div>
    ${errorSlot('alloc')}
    ${errorSlot('apy')}
    ${state.accounts.length
      ? html`<label class="field">
          <span class="label">Kept in</span>
          <select name="accountId"><option value="">Nowhere in particular</option>${state.accounts.map((a) => html`<option value="${a.id}" ${existing?.accountId === a.id ? 'selected' : ''}>${a.name}${a.institution ? ` · ${a.institution}` : ''}</option>`)}</select>
          <span class="hint">So the book can check the pots add up to the money.</span>
        </label>`
      : ''}
    <fieldset class="field">
      <legend class="label">Its mark</legend>
      <div class="marks">${PLAN_ICONS.map((i) => html`<label class="mark"><input type="radio" name="icon" value="${i}" ${(existing?.icon || PLAN_ICONS[0]) === i ? 'checked' : ''} /><span>${i}</span></label>`)}</div>
    </fieldset>
    <fieldset class="field">
      <legend class="label">Its ink</legend>
      <div class="swatches">${PALETTE.map((c) => html`<label class="swatch-pick" style="--c:${c}"><input type="radio" name="color" value="${c}" ${(existing?.color ?? PALETTE[state.goals.length % PALETTE.length]) === c ? 'checked' : ''} /><span class="sr-only">${c}</span></label>`)}</div>
    </fieldset>
  </form>`;

  openSheet({
    title: existing ? 'Edit pot' : 'New pot',
    body,
    footer: footerButtons({ saveLabel: existing ? 'Save' : 'Write it in', deletable: Boolean(existing) }),
    onMount(dialog, sheet) {
      const form = $('form', dialog);
      if (!existing) $('input[name="name"]', form).focus();
      form.addEventListener('change', (e) => {
        if (e.target.name !== 'kind') return;
        $('[data-apy-hint]', form).textContent = e.target.value === 'invest'
          ? 'The return you’re assuming — 7% is a common long-run guess.'
          : 'The rate the account pays, if it pays one.';
      });
      wireSave(dialog, form, async () => {
        const d = formData(form);
        const errors = {};
        const chosen = d.kind in PLAN_KINDS ? d.kind : 'fund';
        const name = d.name.trim();
        if (!name) errors.name = 'Say what it’s for.';
        if (chosen === 'safety') {
          const other = state.goals.find((g) => g.id !== id && g.kind === 'safety');
          if (other) errors.name = `${other.name} is already the safety net. Make that one a nest egg first.`;
        }
        const target = parseAmount(d.target, { locale });
        if (!target.ok) errors.target = target.error;
        else if (target.negative || target.cents === 0) errors.target = 'A target greater than zero.';
        let saved = 0;
        if (d.saved.trim()) {
          const s = parseAmount(d.saved, { locale });
          if (!s.ok) errors.saved = s.error;
          else if (s.negative) errors.saved = 'This can’t be negative.';
          else saved = s.cents;
        }
        const alloc = parsePercent(d.alloc);
        if (!alloc.ok) errors.alloc = alloc.error;
        else if (alloc.bp + otherShares > BP) errors.alloc = `Other pots already take ${fmtPercent(otherShares)}%, so this can be at most ${fmtPercent(BP - otherShares) || 0}%.`;
        const apy = parsePercent(d.apy);
        if (!apy.ok) errors.apy = apy.error;
        if (Object.keys(errors).length) return showErrors(form, errors);

        await saveGoal({
          name,
          kind: chosen,
          target: target.cents,
          saved,
          targetDate: d.targetDate || null,
          color: d.color || PALETTE[0],
          icon: d.icon || PLAN_ICONS[0],
          allocBp: alloc.bp,
          apyBp: apy.bp,
          accountId: d.accountId || null,
        }, id);
        sheet.close({ silent: true });
        toast(existing ? 'Saved' : `${name} written in`);
      });
      $('[data-delete]', dialog)?.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: `Strike out “${existing.name}”?`,
          message: 'The pot and what it holds are removed from the book. The money in your accounts is untouched.',
          confirmLabel: 'Strike it out',
          danger: true,
        });
        if (!ok) return;
        try {
          await deleteGoal(id);
          sheet.close({ silent: true });
          toast('Struck out');
        } catch (err) {
          fail(err);
        }
      });
    },
  });
}

export function openPlanAdjust(id) {
  const plan = state.goals.find((g) => g.id === id);
  if (!plan) return;
  const { locale } = state.settings;
  const body = html`<form class="stack" novalidate autocomplete="off">
    <p class="sheet-lede">${plan.name} holds ${money(plan.saved ?? 0)} of ${money(plan.target)}.</p>
    <div class="seg" role="radiogroup" aria-label="Which way">
      <label><input type="radio" name="dir" value="add" checked /><span>Set aside</span></label>
      <label><input type="radio" name="dir" value="take" /><span>Take out</span></label>
    </div>
    ${moneyField('amount', '', { label: 'How much' })}
    <p class="hint">This moves the pot’s figure only. If it changes what an account holds, write in a new reading there too.</p>
  </form>`;
  openSheet({
    title: 'Set aside',
    body,
    footer: html`<button type="button" class="btn primary grow" data-save>Write it in</button>`,
    onMount(dialog, sheet) {
      const form = $('form', dialog);
      $('input[name="amount"]', form).focus();
      wireSave(dialog, form, async () => {
        const d = formData(form);
        const parsed = parseAmount(d.amount, { locale });
        if (!parsed.ok) return showErrors(form, { amount: parsed.error });
        if (parsed.negative || parsed.cents === 0) return showErrors(form, { amount: 'An amount greater than zero.' });
        await adjustGoal(id, d.dir === 'take' ? -parsed.cents : parsed.cents);
        sheet.close({ silent: true });
        const after = state.goals.find((g) => g.id === id);
        toast(after && after.saved >= after.target ? `${plan.name} is full` : `${plan.name} now holds ${money(after?.saved ?? 0)}`);
      });
    },
  });
}
