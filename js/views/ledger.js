import { html } from '../ui/html.js';
import { state } from '../store.js';
import { balanceHistory, fundTotal, reconcile, STALE_AFTER_DAYS, weightedApy } from '../core/fund.js';
import { ACCOUNT_KINDS, ACCOUNT_ROLES } from '../core/defaults.js';
import { daysBetween, dayOf } from '../core/dates.js';
import { money, percent, date, relativeDay } from '../ui/format.js';
import { chapterHead, displayFigure, emptyPage, icons, ruledRow, section, ui } from './chrome.js';
import { isUnlocked, vaultAvailable, vaultExists } from '../vault.js';
import { bridgeConnected } from '../link.js';

const rate = (bp) => `${(bp / 100).toFixed(bp % 100 ? 2 : 0)}%`;

function reviewState(account) {
  if (!account.reviewedAt) return { text: 'never reviewed', stale: true };
  const days = daysBetween(account.reviewedAt, state.today);
  return { text: `reviewed ${relativeDay(account.reviewedAt).toLowerCase()}`, stale: days > STALE_AFTER_DAYS };
}

function vaultNote() {
  if (!vaultAvailable()) {
    return html`<p class="marginal locked">The strongbox needs the installed book or an https address. Over a plain http link it stays shut.</p>`;
  }
  if (!vaultExists()) {
    return html`<div class="strongbox-note">
      <p class="marginal">Account numbers and logins can be written in a strongbox at the back of the book, sealed with a passphrase only you know.</p>
      <button type="button" class="btn small primary" data-action="vault-create">${icons.lock}Set a passphrase</button>
    </div>`;
  }
  return isUnlocked()
    ? html`<div class="strongbox-note open">
        <p class="marginal">The strongbox is open. It shuts itself after a few minutes, and whenever the book leaves the screen.</p>
        <button type="button" class="btn small" data-action="vault-lock">Shut it</button>
      </div>`
    : html`<div class="strongbox-note">
        <p class="marginal">The strongbox is shut.</p>
        <button type="button" class="btn small primary" data-action="vault-unlock">${icons.lock}Open it</button>
      </div>`;
}

export function renderLedger() {
  const head = chapterHead('ledger', {
    actions: html`<button type="button" class="btn primary" data-action="new-account">${icons.plus}New account</button>`,
  });
  // An empty book still shows the bridge and anything it offers — otherwise
  // connecting one on a fresh book leads nowhere.
  if (!state.accounts.length) {
    return html`${head}${vaultNote()}${bridgeNote()}
      ${ui.offered.length
        ? offeredNote()
        : emptyPage({
            title: 'No accounts written in',
            body: 'Which institution holds what, what it pays, whether the login has a second step, and when you last looked at it. The numbers and passwords go in the strongbox, sealed.',
            actions: html`<button type="button" class="btn primary" data-action="new-account">${icons.plus}Write in an account</button>`,
          })}`;
  }

  const total = fundTotal(state.accounts);
  const apy = weightedApy(state.accounts);
  const recon = reconcile(state.accounts, state.goals);
  const selected = ui.selectedAccount && state.accounts.some((a) => a.id === ui.selectedAccount) ? ui.selectedAccount : null;

  return html`${head}
    ${displayFigure(money(total), 'held', { note: `Earning ${rate(apy)} across the book.` })}
    ${vaultNote()}
    ${bridgeNote()}
    ${ui.offered.length ? offeredNote() : ''}
    <ul class="plain-list acct-list">
      ${state.accounts.map((a) => html`${accountEntry(a, recon.rows.find((r) => r.account.id === a.id), a.id === selected)}
        ${a.id === selected ? html`<li class="acct-open" data-inline-detail>${accountDetail(a)}</li>` : ''}`)}
    </ul>
    ${recon.homeless.length
      ? section('Pots with no home', html`<p class="marginal">These aren’t claimed against any account, so the book can’t check them.</p>
          <ul class="plain-list ruled-list">${recon.homeless.map((p) => ruledRow(p.name, money(p.saved ?? 0), { action: 'edit-plan', id: p.id }))}</ul>`)
      : ''}`;
}

// Where the figures come from, if they come from anywhere but your hand.
//
// When nothing is connected this is an invitation rather than nothing at
// all: this is the chapter someone looks in to connect an account, so the
// door belongs here and not only in the endpapers.
function bridgeNote() {
  if (!bridgeConnected()) {
    if (!vaultAvailable()) {
      return html`<div class="strongbox-note">
        <p class="marginal">Balances can be read for you, but not at this address: reading them needs the strongbox, and the strongbox needs an installed book or an https address. Open Tally from your home screen, or over https, and the offer appears here.</p>
      </div>`;
    }
    return html`<div class="strongbox-note">
      <p class="marginal">Balances can be read for you instead of written in by hand, through a bridge you run. Nothing leaves this device until you say so.</p>
      <button type="button" class="btn small" data-action="bridge-connect">${icons.sync}Connect a bridge</button>
    </div>`;
  }
  const following = state.accounts.filter((a) => a.link).length;
  const last = state.settings.bridgeAt;
  return html`<div class="strongbox-note${isUnlocked() ? ' open' : ''}">
    <p class="marginal">${following
      ? `${following === 1 ? 'One account follows' : `${following} accounts follow`} ${state.settings.bridgeHost || 'the bridge'}${last ? `, last read ${relativeDay(dayOf(last)).toLowerCase()}` : ''}.`
      : `${state.settings.bridgeHost || 'A bridge'} is connected, but no account follows it yet.`}</p>
    <button type="button" class="btn small primary" data-action="bridge-sync">${icons.sync}Read balances</button>
  </div>`;
}

// Accounts the bridge offered that this book hasn't taken up.
function offeredNote() {
  return section('Offered by the bridge', html`<p class="marginal">These came back from the bridge and aren’t in the book yet.</p>
    <ul class="plain-list ruled-list">
      ${ui.offered.map((a, i) => ruledRow(
        html`${a.name}`,
        html`<button type="button" class="btn small" data-action="adopt-account" data-index="${i}">Write it in</button>`,
        { sub: [a.institution?.name, a.last_four ? `····${a.last_four}` : ''].filter(Boolean).join(' · '), wrap: true }
      ))}
    </ul>`, { id: 'offered' });
}

function accountEntry(account, row, selected) {
  const rev = reviewState(account);
  const claimed = row?.claimed ?? 0;
  return html`<li class="acct${selected ? ' selected' : ''}" data-role="${account.role}">
    <button type="button" class="acct-open-btn" data-action="select-account" data-id="${account.id}">
      <span class="acct-mark" aria-hidden="true">${(account.institution || account.name).slice(0, 1).toUpperCase()}</span>
      <span class="acct-body">
        <span class="acct-title">
          <span class="acct-name">${account.name}</span>
          <span class="acct-where">${account.institution || ACCOUNT_KINDS[account.kind] || 'Account'}</span>
        </span>
        <span class="acct-tags">
          <i class="tag">${ACCOUNT_ROLES[account.role] ?? 'Other'}</i>
          <i class="tag ${account.apyBp ? 'good' : ''}">${account.apyBp ? `${rate(account.apyBp)} a year` : 'no yield'}</i>
          <i class="tag ${account.mfa ? 'good' : 'bad'}">${account.mfa ? 'two-step on' : 'no two-step'}</i>
          <i class="tag ${rev.stale ? 'bad' : ''}">${rev.text}</i>
          ${account.vault ? html`<i class="tag sealed">${icons.lock}sealed</i>` : ''}
          ${account.link ? html`<i class="tag good">${icons.sync}follows the bridge</i>` : ''}
        </span>
      </span>
      <span class="acct-figure">
        <span class="fig ${(account.balance ?? 0) < 0 ? 'short' : ''}">${money(account.balance ?? 0)}</span>
        <small>${account.balanceAt ? `read ${account.balanceAt}` : 'never read'}</small>
        ${claimed > 0 ? html`<small class="${row.short ? 'short' : ''}">${money(claimed)} claimed</small>` : ''}
      </span>
    </button>
  </li>`;
}

// One account in full: what the facing page shows when an account is chosen.
// The sealed part is rendered as an empty slot and filled after the page is
// on screen, because opening it is asynchronous.
export function accountDetail(account) {
  const rev = reviewState(account);
  const held = state.goals.filter((p) => p.accountId === account.id);
  const claimed = held.reduce((s, p) => s + (p.saved ?? 0), 0);
  const balance = account.balance ?? 0;
  const readings = balanceHistory(account).slice(0, 6);

  return html`<div class="acct-detail" data-account-detail="${account.id}">
    <div class="acct-detail-head">
      <span class="acct-mark large" aria-hidden="true">${(account.institution || account.name).slice(0, 1).toUpperCase()}</span>
      <div>
        <h2>${account.name}</h2>
        <p class="acct-where">${[account.institution, ACCOUNT_KINDS[account.kind], ACCOUNT_ROLES[account.role]].filter(Boolean).join(' · ')}</p>
      </div>
    </div>
    ${displayFigure(money(balance), account.balanceAt ? `as at ${date(account.balanceAt)}` : 'never read', {
      tone: balance < 0 ? 'short' : '',
    })}
    <div class="btn-row">
      ${account.link
        ? html`<button type="button" class="btn primary" data-action="bridge-sync">${icons.sync}Read from the bridge</button>`
        : ''}
      <button type="button" class="btn ${account.link ? '' : 'primary'}" data-action="read-balance" data-id="${account.id}">${icons.pen}Write in a balance</button>
      <button type="button" class="btn" data-action="mark-reviewed" data-id="${account.id}">${icons.check}Reviewed today</button>
      <button type="button" class="btn" data-action="edit-account" data-id="${account.id}">Edit</button>
    </div>

    <ul class="plain-list ruled-list">
      ${ruledRow('Pays', account.apyBp ? `${rate(account.apyBp)} a year` : 'nothing', { sub: account.apyBp ? `about ${money(Math.round((balance * account.apyBp) / 10000))} a year at this balance` : '', wrap: true })}
      ${ruledRow('Sign-in', account.mfa ? 'two-step on' : 'one step only', { tone: account.mfa ? 'covered' : 'short' })}
      ${ruledRow('Last reviewed', rev.text, { tone: rev.stale ? 'thin' : '', sub: rev.stale ? 'rates move' : '', wrap: true })}
      ${account.link
        ? ruledRow('Read from', account.link.org || state.settings.bridgeHost || 'the bridge', { sub: account.link.lastSyncAt ? `last ${relativeDay(dayOf(account.link.lastSyncAt)).toLowerCase()}` : 'not read yet', wrap: true })
        : ''}
      ${held.length
        ? ruledRow('Pots kept here', held.map((p) => p.name).join(', '), { sub: `${money(claimed)} claimed${claimed > balance ? ' — more than it holds' : `, ${money(balance - claimed)} spare`}`, tone: claimed > balance ? 'short' : '', wrap: true })
        : ruledRow('Pots kept here', 'none', { sub: 'nothing claims this money' })}
    </ul>

    ${account.notes ? html`<p class="marginal note">${account.notes}</p>` : ''}

    ${readings.length > 1
      ? section('Readings', html`<ul class="plain-list ruled-list">
          ${readings.map((r) => ruledRow(date(r.date), money(r.cents), {
            sub: r.change == null ? 'first reading' : r.change === 0 ? 'no change' : money(r.change, { sign: true }),
            tone: r.change == null ? '' : r.change > 0 ? 'covered' : r.change < 0 ? 'short' : '',
          }))}
        </ul>`)
      : ''}

    <section class="strongbox" aria-label="Sealed details">
      <h3>${icons.lock}Strongbox</h3>
      <div data-vault-fields="${account.id}">${sealedSlot(account)}</div>
    </section>
  </div>`;
}

function sealedSlot(account) {
  if (!vaultAvailable()) return html`<p class="marginal">Needs the installed book or an https address.</p>`;
  if (!vaultExists()) return html`<p class="marginal">Set a passphrase and the number and login can live here.</p><button type="button" class="btn small" data-action="vault-create">Set a passphrase</button>`;
  if (!isUnlocked()) return html`<p class="marginal">${account.vault ? 'Sealed. Open the strongbox to read them.' : 'Nothing sealed for this account.'}</p><button type="button" class="btn small primary" data-action="vault-unlock">Open the strongbox</button>`;
  if (!account.vault) return html`<p class="marginal">Nothing sealed for this account.</p><button type="button" class="btn small" data-action="edit-account" data-id="${account.id}">Write the details in</button>`;
  return html`<p class="marginal">Unsealing…</p>`;
}

const SEALED_FIELDS = [
  ['accountNumber', 'Account number'],
  ['routingNumber', 'Routing number'],
  ['username', 'Username'],
  ['password', 'Password'],
  ['notes', 'Private notes'],
];

// A secret shows its last four and nothing else until asked, and on the
// cover screen it never shows more than that at all.
export function sealedFields(values) {
  const rows = SEALED_FIELDS.filter(([k]) => values?.[k]);
  if (!rows.length) return html`<p class="marginal">Nothing sealed for this account.</p>`;
  return html`<dl class="sealed">
    ${rows.map(([k, label]) => {
      const v = String(values[k]);
      const masked = k === 'notes' ? '••••••' : `•••• ${v.slice(-4)}`;
      return html`<div>
        <dt>${label}</dt>
        <dd>
          <span class="secret" data-secret="${v}" data-masked="${masked}">${masked}</span>
          <span class="secret-actions">
            <button type="button" class="btn small ghost" data-action="reveal-secret">Show</button>
            <button type="button" class="btn small ghost" data-action="copy-secret" aria-label="Copy ${label}">Copy</button>
          </span>
        </dd>
      </div>`;
    })}
    <p class="marginal cover-only">Open the phone to read a number in full.</p>
  </dl>`;
}
