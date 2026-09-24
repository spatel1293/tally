import { html, mount, $ } from '../ui/html.js';
import { state } from '../store.js';
import { surplus } from '../core/fund.js';
import { allocate, BP, milestones, planKind, planOrder, planProgress, PLAN_KINDS, projectGrowth, projectPlans, requiredMonthly } from '../core/plans.js';
import { centsToInput, parseAmount } from '../core/money.js';
import { money, percent, date, monthLabel } from '../ui/format.js';
import { inkRing, progressRule } from '../ui/charts.js';
import { chapterHead, displayFigure, emptyPage, icons, ruledRow, section, ui } from './chrome.js';

const rate = (bp) => `${(bp / 100).toFixed(bp % 100 ? 2 : 0)}%`;

// What-if levers. Not saved: a question you ask, not a setting. The honest
// default is the surplus the endpapers already state.
export const scenario = { monthly: null, lumpSum: 0 };

export function resetScenario() {
  scenario.monthly = null;
  scenario.lumpSum = 0;
}

function scenarioMonthly() {
  return scenario.monthly == null ? surplus(state.settings).surplus : scenario.monthly;
}

export function renderPots() {
  const head = chapterHead('pots', {
    actions: html`<button type="button" class="btn primary" data-action="new-plan">${icons.plus}New pot</button>`,
  });
  if (!state.goals.length) {
    return html`${head}${emptyPage({
      title: 'Nothing written in yet',
      body: 'A pot is what the money is for: a safety net that buys you months, a nest egg, a trip, or money put to work. Give it a target and a share of what’s left each month, and the book works out when it arrives.',
      actions: html`<button type="button" class="btn primary" data-action="new-plan" data-kind="safety">${icons.plus}Start with a safety net</button>
        <button type="button" class="btn" data-action="new-plan">Some other pot</button>`,
    })}`;
  }

  const monthly = scenarioMonthly();
  return html`${head}
    ${section('What if', html`<form class="levers" data-levers novalidate autocomplete="off">
        <label class="field">
          <span class="label">Set aside each month</span>
          <input type="text" inputmode="decimal" name="monthly" value="${centsToInput(monthly, { locale: state.settings.locale })}" />
        </label>
        <label class="field">
          <span class="label">Plus a one-off, now <span class="opt">optional</span></span>
          <input type="text" inputmode="decimal" name="lumpSum" value="${scenario.lumpSum ? centsToInput(scenario.lumpSum, { locale: state.settings.locale }) : ''}" placeholder="0" />
        </label>
      </form>
      <p class="marginal">Ask a question of the book; it does not write the answer down.</p>`, { id: 'whatif' })}
    <div id="pot-results">${potResults()}</div>`;
}

// The part that moves when the levers move, mounted on its own so typing in
// the fields doesn't rebuild the page under the cursor.
function potResults() {
  const monthly = scenarioMonthly();
  const plans = planOrder(state.goals);
  const projection = projectPlans(plans, { monthly, lumpSum: scenario.lumpSum, todayIso: state.today });
  const shares = allocate(plans, monthly);
  const needed = requiredMonthly(plans, state.today);
  const selected = ui.selectedPlan && state.goals.some((g) => g.id === ui.selectedPlan) ? ui.selectedPlan : null;

  let verdict;
  if (!monthly && !scenario.lumpSum) verdict = html`<p class="verdict">Nothing going in, so nothing has a finish date yet.</p>`;
  else if (projection.unfunded.length) verdict = html`<p class="verdict short">At ${money(monthly)} a month, ${projection.unfunded.length === 1 ? 'one pot never fills' : `${projection.unfunded.length} pots never fill`}.</p>`;
  else if (projection.late.length) verdict = html`<p class="verdict thin">${projection.late.length === 1 ? 'One pot misses its date' : `${projection.late.length} pots miss their dates`}. Everything is full by ${monthLabel(projection.allFundedKey)}.</p>`;
  else verdict = html`<p class="verdict covered">Everything full by ${monthLabel(projection.allFundedKey)} at ${money(monthly)} a month.</p>`;

  return html`${verdict}
    ${needed > 0 ? html`<p class="marginal">${monthly < needed
      ? `Hitting every date needs ${money(needed)} a month — ${money(needed - monthly)} more than this.`
      : `Hitting every date needs ${money(needed)} a month, which this covers.`}</p>` : ''}
    ${shares.sharedBp !== BP && shares.sharedBp > 0
      ? html`<p class="marginal">${shares.sharedBp < BP
        ? `${percent((BP - shares.sharedBp) / BP)} of the surplus has no share, so it goes to whichever pot is due soonest.`
        : `The shares add up to ${percent(shares.sharedBp / BP)} — more than there is.`}</p>`
      : ''}
    <ul class="plain-list pot-list">
      ${projection.rows.map((row) => html`${potEntry(row, shares.byPlan.get(row.plan.id) ?? 0, row.plan.id === selected)}
        ${row.plan.id === selected ? html`<li class="pot-open-detail" data-inline-detail>${potDetail(row.plan)}</li>` : ''}`)}
    </ul>
    ${section('Five years out', html`<p class="marginal">Year-end balances at ${money(monthly)} a month, each pot at its own yield.</p>
      ${milestoneTable(plans, monthly)}`, { id: 'ms-title' })}`;
}

// A pot, written into the book: its mark in the margin, its name, and the
// rule beneath filling up as it does.
function potEntry(row, share, selected) {
  const { plan, progress } = row;
  const when = row.fundedKey ? monthLabel(row.fundedKey) : null;
  return html`<li class="pot${selected ? ' selected' : ''}" style="--c:${plan.color}">
    <button type="button" class="pot-open" data-action="select-plan" data-id="${plan.id}">
      <span class="pot-mark" aria-hidden="true">${plan.icon || ''}</span>
      <span class="pot-body">
        <span class="pot-title">
          <span class="pot-name">${plan.name}</span>
          <span class="pot-kind">${PLAN_KINDS[progress.kind]}</span>
        </span>
        <span class="pot-figures">
          <span class="fig">${money(progress.saved)}</span>
          <span class="muted">of ${money(plan.target)}</span>
          <span class="pot-pct">${percent(progress.ratio)}</span>
        </span>
        ${progressRule(progress.ratio, progress.done ? 'done' : 'filling', `${plan.name}: ${money(progress.saved)} of ${money(plan.target)}`)}
        <span class="pot-note">${progress.done
          ? 'Full.'
          : row.onTime === false
            ? `Misses ${date(plan.targetDate)} — not ready until ${when}`
            : row.onTime === true
              ? `Makes ${date(plan.targetDate)} — ready ${when}`
              : when
                ? `${money(progress.toSave)} to go — full by ${when}`
                : `${money(progress.toSave)} to go`}</span>
      </span>
    </button>
    <span class="pot-side">
      ${share > 0 ? html`<span class="pot-share">${money(share)}<small>/mo</small></span>` : html`<span class="pot-share muted">no share</span>`}
      <button type="button" class="btn small" data-action="adjust-plan" data-id="${plan.id}">${icons.pen}Set aside</button>
    </span>
  </li>`;
}

function milestoneTable(plans, monthly, { years = 5 } = {}) {
  const ordered = planOrder(plans);
  if (!ordered.length) return '';
  const m = milestones(ordered, monthly, { years });
  const thisYear = Number(state.today.slice(0, 4));
  return html`<div class="table-scroll">
    <table class="ledger-table">
      <thead><tr><th scope="col">Pot</th>${m.rows[0].yearEnds.map((_, y) => html`<th scope="col">${thisYear + y + 1}</th>`)}</tr></thead>
      <tbody>
        ${m.rows.map((r) => html`<tr>
          <th scope="row"><i class="swatch" style="background:${r.plan.color}"></i>${r.plan.name}<small>${r.plan.apyBp ? rate(r.plan.apyBp) : 'no yield'}</small></th>
          ${r.yearEnds.map((v) => html`<td class="fig">${money(v, { compact: v >= 10000000 })}</td>`)}
        </tr>`)}
        <tr class="total"><th scope="row">The fund</th>${m.totals.map((v) => html`<td class="fig">${money(v, { compact: v >= 10000000 })}</td>`)}</tr>
      </tbody>
    </table>
  </div>`;
}

// One pot in full: what the facing page shows when a pot is chosen, and what
// opens inline on a screen with only one page.
export function potDetail(plan) {
  const monthly = scenarioMonthly();
  const projection = projectPlans(state.goals, { monthly, lumpSum: scenario.lumpSum, todayIso: state.today });
  const row = projection.rows.find((r) => r.plan.id === plan.id);
  const p = row.progress;
  const share = allocate(state.goals, monthly).byPlan.get(plan.id) ?? 0;
  const years = projectGrowth(p.saved, share, plan.apyBp ?? 0, 60);
  const account = plan.accountId ? state.accounts.find((a) => a.id === plan.accountId) : null;
  const when = row.fundedKey ? monthLabel(row.fundedKey) : null;

  return html`<div class="pot-detail" style="--c:${plan.color}">
    <div class="pot-detail-head">
      ${inkRing({ ratio: p.ratio, tone: 'pot', centre: percent(p.ratio), below: '', label: `${plan.name}: ${percent(p.ratio)} full`, size: 108 })}
      <div>
        <p class="pot-kind">${PLAN_KINDS[p.kind]}</p>
        <h2>${plan.name}</h2>
        ${displayFigure(money(p.saved), `of ${money(plan.target)}`)}
      </div>
    </div>
    <ul class="plain-list ruled-list">
      ${ruledRow('Share of the surplus', plan.allocBp ? money(share) : '—', { sub: plan.allocBp ? percent(plan.allocBp / BP) : 'none set' })}
      ${ruledRow('Yield', plan.apyBp ? rate(plan.apyBp) : '—', { sub: planKind(plan) === 'invest' ? 'assumed' : 'a year' })}
      ${ruledRow('Kept in', account ? account.name : 'Nowhere yet', { sub: account ? account.institution : 'say which account', tone: account ? '' : 'thin', wrap: true })}
      ${plan.targetDate ? ruledRow('Wanted by', date(plan.targetDate), { sub: when ? `ready ${when}` : 'no date reachable', tone: row.onTime === false ? 'short' : row.onTime ? 'covered' : 'thin' }) : ''}
      ${ruledRow('In a year', money(years[11]))}
      ${ruledRow('In five years', money(years[59]))}
    </ul>
    <div class="btn-row">
      <button type="button" class="btn primary" data-action="adjust-plan" data-id="${plan.id}">${icons.pen}Set aside</button>
      <button type="button" class="btn" data-action="edit-plan" data-id="${plan.id}">Edit</button>
    </div>
  </div>`;
}

export function afterPotsMount(root) {
  const form = $('[data-levers]', root);
  if (!form) return;
  const { locale } = state.settings;
  let timer;
  form.addEventListener('input', (e) => {
    const { name, value } = e.target;
    if (name !== 'monthly' && name !== 'lumpSum') return;
    // A half-typed number shouldn't read as zero and blank every date, so an
    // unparseable value leaves the last good one in place.
    const parsed = parseAmount(value, { locale });
    const cents = value.trim() === '' ? 0 : parsed.ok && !parsed.negative ? parsed.cents : null;
    if (cents == null) return;
    scenario[name] = cents;
    clearTimeout(timer);
    timer = setTimeout(() => mount($('#pot-results', root), potResults()), 140);
  });
}
