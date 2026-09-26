import { html } from '../ui/html.js';
import { state } from '../store.js';
import { balanceHistory, fundTotal, reconcile, STALE_AFTER_DAYS, weightedApy } from '../core/fund.js';
import { ACCOUNT_KINDS, ACCOUNT_ROLES } from '../core/defaults.js';
import { daysBetween, dayOf } from '../core/dates.js';
import { money, percent, date, relativeDay } from '../ui/format.js';
import { chapterHead, displayFigure, emptyPage, icons, ruledRow, section, ui } from './chrome.js';
import { isUnlocked, vaultAvailable, vaultExists } from '../vault.js';
import { symbolsHeld, valueAccount, formatShares, formatPrice, dayChange } from '../core/holdings.js';

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
  // Until there is a strongbox, this is an offer rather than news, and an
  // offer does not deserve a block at the top of every visit. It lives in
  // the endpapers with the other things you set up once; the chapter only
  // speaks up once there is actually something sealed to open or shut.
  if (!vaultExists()) return '';
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
    return html`${head}${vaultNote()}${priceNote()}
      ${emptyPage({
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
    ${displayFigure(money(total), 'held', { note: bookNote() })}
    ${vaultNote()}
    ${priceNote()}
    <ul class="plain-list acct-list">
      ${state.accounts.map((a) => html`${accountEntry(a, recon.rows.find((r) => r.account.id === a.id), a.id === selected)}
        ${a.id === selected ? html`<li class="acct-open" data-inline-detail>${accountDetail(a)}</li>` : ''}`)}
    </ul>
    ${recon.homeless.length
      ? section('Pots with no home', html`<p class="marginal">These aren’t claimed against any account, so the book can’t check them.</p>
          <ul class="plain-list ruled-list">${recon.homeless.map((p) => ruledRow(p.name, money(p.saved ?? 0), { action: 'edit-plan', id: p.id }))}</ul>`)
      : ''}`;
}

// What the book is, in one line under the figure: how much is invested
// across how many accounts, and what today did to it.
function bookNote() {
  const held = symbolsHeld(state.accounts).length;
  const accounts = state.accounts.length;
  const move = ui.quotes?.size ? dayChange(state.accounts, ui.quotes) : null;
  const where = `${held ? `${held} ${held === 1 ? 'holding' : 'holdings'}` : 'Nothing written in'} across ${accounts} ${accounts === 1 ? 'account' : 'accounts'}.`;
  if (!move) return where;
  const dir = move.cents > 0 ? 'up' : move.cents < 0 ? 'down' : 'level';
  if (move.cents === 0) return `${where} Level today.`;
  return `${where} ${dir === 'up' ? 'Up' : 'Down'} ${money(Math.abs(move.cents))} today, ${percent(Math.abs(move.bp) / 10_000, 2)}.`;
}

// Where the figures come from, if they come from anywhere but your hand.
//
// A book of holdings prices itself: what you own barely changes, what it is
// worth changes every day. So this is not a connection to be made, it is a
// feed that either has a key or hasn't.
function priceNote() {
  const held = symbolsHeld(state.accounts);
  if (!held.length) {
    return html`<div class="strongbox-note">
      <p class="marginal">Write in what an account holds — the ticker and how many shares — and the book prices it for you from then on. Nothing has to be typed twice.</p>
    </div>`;
  }
  if (!state.settings.priceKey) {
    return html`<div class="strongbox-note">
      <p class="marginal">${held.length === 1 ? 'One holding is' : `${held.length} holdings are`} written in, but there is no price feed yet. A free key from twelvedata.com prices the whole book in one request.</p>
      <button type="button" class="btn small" data-action="price-key">${icons.sync}Add a price key</button>
    </div>`;
  }
  const last = state.settings.pricedAt;
  return html`<div class="strongbox-note open">
    <p class="marginal">${held.length === 1 ? 'One holding' : `${held.length} holdings`} priced${last ? ` ${relativeDay(dayOf(last)).toLowerCase()}` : ' — not yet today'}.</p>
    <button type="button" class="btn small primary" data-action="prices-refresh">${icons.sync}Refresh prices</button>
  </div>`;
}

// One line of the account list.
//
// What belongs here is what you would actually want at a glance from a
// portfolio: what it is worth, what it did today, and what is in it. The
// things this book used to put here — a savings rate, whether the login has
// a second step, how long since you last reviewed it — are bank concerns.
// They are still kept, and still checked in the Review chapter, but they do
// not belong shouting on every row of a list of investments.
function accountEntry(account, row, selected) {
  const held = account.positions?.length ?? 0;
  const value = account.balance ?? 0;
  const move = accountDayChange(account);

  return html`<li class="acct${selected ? ' selected' : ''}" data-role="${account.role}">
    <button type="button" class="acct-open-btn" data-action="select-account" data-id="${account.id}">
      <span class="acct-mark" aria-hidden="true">${(account.institution || account.name).slice(0, 1).toUpperCase()}</span>
      <span class="acct-body">
        <span class="acct-title">
          <span class="acct-name">${account.name}</span>
          <span class="acct-where">${account.institution || ACCOUNT_KINDS[account.kind] || 'Account'}</span>
        </span>
        <span class="acct-tags">
          ${held ? html`<i class="tag">${held} ${held === 1 ? 'holding' : 'holdings'}</i>` : html`<i class="tag">${ACCOUNT_ROLES[account.role] ?? 'Other'}</i>`}
          ${account.balanceAt ? html`<i class="tag">${relativeDay(account.balanceAt).toLowerCase()}</i>` : html`<i class="tag">never priced</i>`}
          ${account.vault ? html`<i class="tag sealed">${icons.lock}sealed</i>` : ''}
        </span>
      </span>
      <span class="acct-figure">
        <span class="fig ${value < 0 ? 'short' : ''}">${money(value)}</span>
        ${move ? html`<small class="${move.cents > 0 ? 'covered' : move.cents < 0 ? 'short' : ''}">${money(move.cents, { sign: true })} today</small>` : ''}
      </span>
    </button>
  </li>`;
}

// Under an account's figure: what today did, and what it has made against
// what was paid for it. Cost basis is optional, so the gain simply isn't
// mentioned when there is nothing to compare against.
function accountNote(account) {
  const parts = [];
  const move = accountDayChange(account);
  if (move) {
    parts.push(move.cents === 0
      ? 'Level today.'
      : `${move.cents > 0 ? 'Up' : 'Down'} ${money(Math.abs(move.cents))} today, ${percent(Math.abs(move.bp) / 10_000, 2)}.`);
  }

  const paid = (account.positions ?? []).reduce((sum, p) => sum + (p.costBasis ?? 0), 0);
  const priced = valueAccount(account, ui.prices);
  if (paid > 0 && priced.complete && priced.invested > 0) {
    const gain = priced.invested - paid;
    const bp = Math.round((gain * 10_000) / paid);
    parts.push(`${gain >= 0 ? 'Ahead' : 'Behind'} ${money(Math.abs(gain))} on ${money(paid)} put in, ${percent(Math.abs(bp) / 10_000, 1)}.`);
  }
  return parts.join(' ');
}

// What one account did today, from the last quotes the book saw.
function accountDayChange(account) {
  if (!account.positions?.length || !ui.quotes?.size) return null;
  return dayChange([account], ui.quotes);
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
    ${displayFigure(money(balance), account.balanceAt ? `as at ${date(account.balanceAt)}` : 'never priced', {
      tone: balance < 0 ? 'short' : '',
      note: accountNote(account),
    })}
    <div class="btn-row">
      <button type="button" class="btn primary" data-action="add-position" data-id="${account.id}">${icons.plus}Write in a holding</button>
      <button type="button" class="btn" data-action="read-balance" data-id="${account.id}">${icons.pen}Write in a balance</button>
      <button type="button" class="btn" data-action="mark-reviewed" data-id="${account.id}">${icons.check}Reviewed today</button>
      <button type="button" class="btn" data-action="edit-account" data-id="${account.id}">Edit</button>
    </div>

    <ul class="plain-list ruled-list">
      ${ruledRow('Pays', account.apyBp ? `${rate(account.apyBp)} a year` : 'nothing', { sub: account.apyBp ? `about ${money(Math.round((balance * account.apyBp) / 10000))} a year at this balance` : '', wrap: true })}
      ${ruledRow('Sign-in', account.mfa ? 'two-step on' : 'one step only', { tone: account.mfa ? 'covered' : 'short' })}
      ${ruledRow('Last reviewed', rev.text, { tone: rev.stale ? 'thin' : '', sub: rev.stale ? 'rates move' : '', wrap: true })}
      ${account.link
        ? ruledRow('Read from', account.link.org || 'the broker', { sub: account.link.lastSyncAt ? `last ${relativeDay(dayOf(account.link.lastSyncAt)).toLowerCase()}` : 'not read yet', wrap: true })
        : ''}
      ${held.length
        ? ruledRow('Pots kept here', held.map((p) => p.name).join(', '), { sub: `${money(claimed)} claimed${claimed > balance ? ' — more than it holds' : `, ${money(balance - claimed)} spare`}`, tone: claimed > balance ? 'short' : '', wrap: true })
        : ruledRow('Pots kept here', 'none', { sub: 'nothing claims this money' })}
    </ul>

    ${holdingsSection(account)}

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

// What an account holds, and what each holding is worth at the last prices
// the book saw. A position with no quote yet says so rather than showing a
// nought, which would read as "worth nothing" instead of "not yet asked".
function holdingsSection(account) {
  const positions = account.positions ?? [];
  if (!positions.length) {
    return section('Holdings', html`<p class="marginal">Nothing written in yet. Add a ticker and a share count and this account prices itself from then on.</p>`);
  }

  const valued = valueAccount(account, ui.prices);
  const rows = valued.lines
    .map((line, i) => ({ line, i }))
    .sort((a, b) => (b.line.cents ?? -1) - (a.line.cents ?? -1));

  return section('Holdings', html`<ul class="plain-list ruled-list">
      ${rows.map(({ line, i }) => ruledRow(
        line.symbol,
        line.cents == null ? 'not priced' : money(line.cents),
        {
          sub: `${formatShares(line.shares)} ${line.shares === 1_000_000 ? 'share' : 'shares'}${line.priceMicro != null ? ` at ${formatPrice(line.priceMicro, { currency: state.settings.currency, locale: state.settings.locale })}` : ''}`,
          tone: line.cents == null ? 'thin' : '',
          action: 'edit-position',
          id: `${account.id}:${i}`,
          wrap: true,
        }
      ))}
      ${account.cash ? ruledRow('Cash', money(account.cash), { sub: 'uninvested', wrap: true }) : ''}
    </ul>
    ${valued.missing.length ? html`<p class="marginal">${valued.missing.join(', ')} could not be priced, so this account's total is the last complete one.</p>` : ''}`,
    { id: `holdings-${account.id}` });
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
