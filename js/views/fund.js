import { html } from '../ui/html.js';
import { state } from '../store.js';
import { fundHistory, fundTotal, reconcile, surplus, weightedApy, yearlyYield } from '../core/fund.js';
import { allocate, BP, planOrder, planProgress, projectGrowth, runway, safetyPlan } from '../core/plans.js';
import { advisorReview } from '../core/advisor.js';
import { money, percent, monthLabel } from '../ui/format.js';
import { inkRing, ruledBars } from '../ui/charts.js';
import { chapterHead, displayFigure, emptyPage, icons, ruledRow, section, ui } from './chrome.js';
import { symbolsHeld, valueBook, allocation, dayChange } from '../core/holdings.js';
import { PALETTE } from '../core/defaults.js';

const fmtMonths = (m) => (Number.isInteger(m) ? String(m) : m.toFixed(1));

// Under the opening figure. A portfolio's headline is what today did; a book
// of savings accounts had a yield instead. Whichever the book actually is,
// it says the true thing rather than the one it was built for.
function headlineNote(accounts, apy, yearly) {
  if (!accounts.length) return 'No accounts written in yet.';
  const where = `Across ${accounts.length === 1 ? 'one account' : `${accounts.length} accounts`}`;
  const move = ui.quotes?.size ? dayChange(accounts, ui.quotes) : null;
  if (move) {
    if (move.cents === 0) return `${where}. Level today.`;
    return `${where}. ${move.cents > 0 ? 'Up' : 'Down'} ${money(Math.abs(move.cents))} today, ${percent(Math.abs(move.bp) / 10_000, 2)}.`;
  }
  if (apy) return `${where}, earning ${rate(apy)} — about ${money(yearly)} a year without you doing anything.`;
  return `${where}.`;
}

// What the whole book is made of, largest first. This is the "holdings
// underneath" half of the opening: the totals are above it, and this says
// what they are actually made of, across every account at once.
function holdingsSpread(accounts) {
  const held = symbolsHeld(accounts);
  if (!held.length) return '';

  const valued = valueBook(accounts, ui.prices);
  const rows = allocation(valued).slice(0, 8);
  if (!rows.length) return '';

  return section('What it is made of', html`<p class="marginal">Every account's holdings, together.</p>
    <div class="alloc-bar" role="img" aria-label="How the book is spread across what it holds">
      ${rows.map((r, i) => html`<i style="--w:${(r.bp / 100).toFixed(2)}%;--c:${PALETTE[i % PALETTE.length]}"></i>`)}
    </div>
    <ul class="plain-list ruled-list">
      ${rows.map((r, i) => ruledRow(
        html`<i class="swatch" style="background:${PALETTE[i % PALETTE.length]}"></i>${r.symbol}`,
        money(r.cents),
        { sub: percent(r.bp / 10_000, 1), wrap: true }
      ))}
    </ul>`, { id: 'made-of' });
}
const rate = (bp) => `${(bp / 100).toFixed(bp % 100 ? 2 : 0)}%`;

// The opening spread. Left page: what the fund is worth and what it buys.
// Right page (or below, on one page): where it sits and where it's going.
export function renderFund() {
  const accounts = state.accounts;
  const plans = state.goals;
  if (!accounts.length && !plans.length) {
    return html`${chapterHead('fund')}
      ${emptyPage({
        title: 'An empty book',
        body: 'Tally keeps one thing: the fund. Write in the accounts it sits in and the pots it is for, and every page after this fills itself in.',
        actions: html`<button type="button" class="btn primary" data-action="new-account">${icons.plus}Write in an account</button>
          <button type="button" class="btn" data-action="new-plan" data-kind="safety">Add a safety net</button>`,
      })}`;
  }

  const cash = surplus(state.settings);
  const total = fundTotal(accounts);
  const apy = weightedApy(accounts);
  const yearly = yearlyYield(accounts);
  const safety = safetyPlan(plans);
  const months = safety && cash.outgoings > 0 ? runway(safety.saved ?? 0, cash.outgoings) : null;
  const target = state.settings.runwayTarget ?? 6;
  const review = advisorReview({ plans, accounts, settings: state.settings, todayIso: state.today, money });
  const shares = allocate(planOrder(plans), cash.surplus);
  const history = fundHistory(accounts, 6);
  const recon = reconcile(accounts, plans);

  const ratio = months == null ? 0 : target > 0 ? months / target : 0;
  const tone = months == null ? 'plain' : months >= target ? 'covered' : months >= target / 2 ? 'thin' : 'short';

  return html`${chapterHead('fund')}
    <div class="fund-headline">
      ${displayFigure(money(total), 'the fund', { note: headlineNote(accounts, apy, yearly) })}
    </div>

    ${holdingsSpread(accounts)}

    ${section('Runway', months == null
      ? html`<p class="hand">${safety
          ? html`Put what a month costs into <a href="#/settings">the endpapers</a> and this becomes a number of months.`
          : html`Mark one pot as the safety net and this page will tell you how long you could go without income.`}</p>`
      : html`<div class="runway">
          ${inkRing({ ratio, tone, centre: fmtMonths(months), below: months === 1 ? 'month' : 'months', label: `Safety net covers ${fmtMonths(months)} of ${target} months` })}
          <div class="runway-words">
            <p class="hand">${months >= target
              ? `Covered. ${safety.name} holds ${money(safety.saved ?? 0)} — past your ${target}-month mark.`
              : `${safety.name} holds ${money(safety.saved ?? 0)}. At ${money(cash.outgoings)} a month, that is ${fmtMonths(months)} of the ${target} months you asked for.`}</p>
            <ul class="plain-list ruled-list">
              ${ruledRow('Comes in', money(cash.income), { sub: 'a month' })}
              ${ruledRow('Goes out', money(cash.outgoings), { sub: 'a month' })}
              ${ruledRow('Left over', money(cash.surplus), { sub: cash.negative ? 'more goes out than comes in' : 'to share out', tone: cash.negative ? 'short' : 'covered' })}
            </ul>
          </div>
        </div>`, { id: 'runway-title' })}

    ${plans.length
      ? section('Where the surplus goes', html`${cash.surplus > 0
          ? html`<p class="hand">${shares.unallocated > 0
              ? `${money(shares.unallocated)} of the ${money(cash.surplus)} still has no home.`
              : `All ${money(cash.surplus)} of it is spoken for.`}</p>`
          : html`<p class="hand">Write in what comes in and what goes out, and this page splits the difference between your pots.</p>`}
        ${allocationBar(planOrder(plans), shares)}
        <ul class="plain-list ruled-list">
          ${planOrder(plans).filter((p) => (p.allocBp ?? 0) > 0).map((p) => ruledRow(
            html`<i class="swatch" style="background:${p.color}"></i>${p.name}`,
            money(shares.byPlan.get(p.id) ?? 0),
            { sub: percent((p.allocBp ?? 0) / BP), href: '#/pots' }
          ))}
          ${shares.unallocated > 0 ? ruledRow(html`<i class="swatch swatch-none"></i>Unspoken for`, money(shares.unallocated), { sub: percent((BP - shares.sharedBp) / BP), tone: 'thin' }) : ''}
        </ul>`, { link: html`<a class="link" href="#/pots">Set the shares</a>`, id: 'alloc-title' })
      : ''}

    ${history.length > 1
      ? section('The fund, month by month', html`${ruledBars(history.map((h) => ({ key: h.key, label: monthLabel(h.key, { month: 'short' }), value: h.total })), { fmt: (v) => money(v, { compact: true }), ariaLabel: 'The fund at the end of each month on record' })}
          <p class="marginal">Every reading you have taken, carried forward. Write in a balance on the Accounts page and this line grows.</p>`, { id: 'hist-title' })
      : ''}

    ${section('At a glance', html`<ul class="plain-list ruled-list">
        ${ruledRow('Pots', String(plans.length), { sub: plans.length ? `${planOrder(plans).filter((p) => planProgress(p, state.today).done).length} filled` : 'none yet', href: '#/pots' })}
        ${ruledRow('Accounts', String(accounts.length), { sub: recon.unassigned > 0 ? `${money(recon.unassigned)} unclaimed` : 'all claimed', href: '#/ledger' })}
        ${ruledRow('The review', `${review.score} of ${review.checks.length}`, { sub: review.attention.length ? `${review.attention.length} to look at` : 'all clear', tone: review.attention.filter((c) => !c.soft).length ? 'thin' : 'covered', href: '#/review' })}
      </ul>`, { id: 'glance-title' })}`;
}

function allocationBar(plans, shares) {
  const segs = plans.filter((p) => (p.allocBp ?? 0) > 0);
  const free = Math.max(0, BP - shares.sharedBp);
  return html`<div class="alloc-bar" role="img" aria-label="Shares of each month's surplus">
    ${segs.map((p) => html`<i style="--w:${((Math.min(BP, p.allocBp) / BP) * 100).toFixed(2)}%;--c:${p.color}" title="${p.name}"></i>`)}
    ${free > 0 ? html`<i class="alloc-free" style="--w:${((free / BP) * 100).toFixed(2)}%" title="Unspoken for"></i>` : ''}
  </div>`;
}

// The facing page of the opening spread: what is worth knowing that the left
// page hasn't already said. Never a figure repeated from it.
export function fundFacingPage() {
  const plans = planOrder(state.goals);
  const accounts = state.accounts;
  if (!plans.length && !accounts.length) {
    return html`<p class="facing-empty">The right-hand page fills in as the book does.</p>`;
  }
  const cash = surplus(state.settings);
  const shares = allocate(plans, cash.surplus);
  const next = plans.find((p) => !planProgress(p, state.today).done) ?? null;
  const nextProgress = next ? planProgress(next, state.today) : null;
  const five = next ? projectGrowth(nextProgress.saved, shares.byPlan.get(next.id) ?? 0, next.apyBp ?? 0, 60) : null;

  return html`<div class="facing">
    ${section('Next in line', next
      ? html`<p class="facing-name" style="--c:${next.color}">${next.name}</p>
          ${displayFigure(money(nextProgress.toSave), 'still to find', { note: nextProgress.perMonth ? `${money(nextProgress.perMonth)} a month makes ${monthLabel(next.targetDate.slice(0, 7))}.` : 'No date set, so no deadline to miss.' })}
          <ul class="plain-list ruled-list">
            ${ruledRow('Holds now', money(nextProgress.saved))}
            ${ruledRow('Gets each month', money(shares.byPlan.get(next.id) ?? 0), { sub: percent((next.allocBp ?? 0) / BP) })}
            ${five ? ruledRow('In five years', money(five[59]), { sub: next.apyBp ? `at ${rate(next.apyBp)}` : 'no yield' }) : ''}
          </ul>`
      : html`<p class="hand">Every pot is full. Time to write in another.</p>`)}

    ${section('Set aside', html`<p class="marginal">Move money into a pot without leaving this page.</p>
      <div class="facing-actions">
        ${plans.slice(0, 4).map((p) => html`<button type="button" class="btn ledger-btn" data-action="adjust-plan" data-id="${p.id}">
          <i class="swatch" style="background:${p.color}"></i><span>${p.name}</span>
        </button>`)}
      </div>`)}

    ${accounts.length
      ? section('Read a balance', html`<p class="marginal">Every figure in this book is only as good as its last reading.</p>
          <div class="facing-actions">
            ${accounts.slice(0, 4).map((a) => html`<button type="button" class="btn ledger-btn" data-action="read-balance" data-id="${a.id}">
              <span>${a.name}</span><small>${a.balanceAt ?? 'never'}</small>
            </button>`)}
          </div>`)
      : ''}
  </div>`;
}
