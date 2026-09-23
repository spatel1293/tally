import { html } from '../ui/html.js';
import { state } from '../store.js';
import { advisorReview } from '../core/advisor.js';
import { milestones, planOrder } from '../core/plans.js';
import { money, percent, plural } from '../ui/format.js';
import { progressRing } from '../ui/charts.js';
import { centsToInput, parseAmount } from '../core/money.js';
import { updateSettings, describeError } from '../store.js';
import { toast } from '../ui/overlay.js';
import { $, formData, showErrors, errorSlot } from '../ui/html.js';
import { pageHead, homeSectionHead, SEC_ICONS, icons } from './components.js';

function fmtMonths(m) {
  return Number.isInteger(m) ? String(m) : m.toFixed(1);
}

// The five-year table a planner draws up: every pot's year-end balance at
// its own yield and its share of the usual surplus, and the total.
export function milestoneTable(plans, surplus, { years = 5 } = {}) {
  const ordered = planOrder(plans);
  if (!ordered.length) return '';
  const m = milestones(ordered, surplus, { years });
  const thisYear = Number(state.today.slice(0, 4));
  return html`<div class="table-scroll">
    <table class="milestones">
      <thead><tr><th scope="col">Plan</th>${m.rows[0].yearEnds.map((_, y) => html`<th scope="col">${thisYear + y + 1}</th>`)}</tr></thead>
      <tbody>
        ${m.rows.map((r) => html`<tr>
          <th scope="row"><i class="key" style="background:${r.plan.color}"></i>${r.plan.name}<small>${r.plan.apyBp ? `${(r.plan.apyBp / 100).toFixed(2)}%` : 'no yield'}${r.monthly ? ` · ${money(r.monthly)}/mo` : ''}</small></th>
          ${r.yearEnds.map((v) => html`<td class="amt">${money(v, { compact: v >= 10000000 })}</td>`)}
        </tr>`)}
        <tr class="total"><th scope="row">Total</th>${m.totals.map((v) => html`<td class="amt">${money(v, { compact: v >= 10000000 })}</td>`)}</tr>
      </tbody>
    </table>
  </div>`;
}

export function checklist(review) {
  return html`<ul class="plain-list checklist full">
    ${review.checks.map((c) => html`<li class="${c.ok ? 'ok' : ''} ${c.soft ? 'soft' : ''}">
      <a class="check-row" href="#/${c.route}">
        <i class="check-mark" aria-hidden="true">${c.ok ? html`<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>` : ''}</i>
        <span class="check-main"><strong>${c.title}</strong><small>${c.detail}</small></span>
        ${icons.chevron}
      </a>
    </li>`)}
  </ul>`;
}

export function renderAdvisor() {
  const review = advisorReview({ plans: state.goals, accounts: state.accounts, categories: state.categories, transactions: state.transactions, settings: state.settings, todayIso: state.today });
  const typical = Math.max(0, review.surplus.typical);
  const { runway, runwayTarget, essentials, safety } = review;
  const stateName = runway == null ? 'accent' : runway >= runwayTarget ? 'ok' : runway >= runwayTarget / 2 ? 'warning' : 'over';

  return html`${pageHead('Advisor')}
    <section class="hero small hero-advisor" data-state="${stateName}">
      <div class="hero-main">
        <div class="hero-ring-row">${progressRing({
          ratio: review.score / review.checks.length,
          state: review.score === review.checks.length ? 'ok' : review.attention.some((c) => !c.soft) ? 'warning' : 'ok',
          showDay: false,
          centerTop: `${review.score}/${review.checks.length}`,
          centerBottom: 'clear',
          ariaLabel: `${review.score} of ${review.checks.length} checks clear`,
        })}</div>
        <div class="hero-say">
          <p class="hero-line">${review.attention.length ? `${plural(review.attention.filter((c) => !c.soft).length, 'thing')} to look at` : 'Everything is in order'}</p>
          <p class="hero-sub">The review a planner would do each quarter, done every time you open this. ${review.savingsRate != null ? `You set aside about ${review.savingsRate}% of what comes in.` : ''}</p>
        </div>
      </div>
      <dl class="stat-chips">
        <div style="--chip:var(--${stateName === 'accent' ? 'accent' : stateName === 'ok' ? 'pos' : stateName === 'warning' ? 'warn' : 'over'})"><dt>Runway</dt><dd class="amt">${runway == null ? '—' : html`${fmtMonths(runway)}<small> mo</small>`}</dd></div>
        <div style="--chip:var(--accent)"><dt>Essentials</dt><dd class="amt">${essentials > 0 ? money(essentials) : '—'}<small>/mo</small></dd></div>
        <div style="--chip:var(--hue-budgets)"><dt>Allocated</dt><dd class="amt">${typical > 0 ? percent(review.allocated / typical) : '—'}</dd></div>
      </dl>
    </section>

    <section class="panel tinted" style="--hue:var(--hue-advisor)" aria-labelledby="checks-title">
      ${homeSectionHead('var(--hue-advisor)', SEC_ICONS.shield, html`<span id="checks-title">Checklist</span>`)}
      ${checklist(review)}
    </section>

    <div class="dash-grid">
      <div class="dash-col">
        <section class="panel tinted" style="--hue:var(--hue-budgets)" aria-labelledby="runway-title">
          ${homeSectionHead('var(--hue-budgets)', SEC_ICONS.target, html`<span id="runway-title">Targets</span>`)}
          <form class="stack targets" data-targets novalidate autocomplete="off">
            <label class="field">
              <span class="label">Safety net should cover</span>
              <span class="row-2 tight">
                <input type="number" name="runwayTarget" min="1" max="60" step="1" value="${runwayTarget}" aria-describedby="runway-hint" />
                <span class="unit">months of essentials</span>
              </span>
              <span class="hint" id="runway-hint">Three to six months is the usual advice; a year or two if your income is uneven.</span>
            </label>
            ${errorSlot('runwayTarget')}
            <label class="field">
              <span class="label">A month of essentials costs <span class="opt">Optional</span></span>
              <input type="text" inputmode="decimal" name="essentialMonthly" value="${state.settings.essentialMonthly != null ? centsToInput(state.settings.essentialMonthly, { locale: state.settings.locale }) : ''}" placeholder="${essentials > 0 ? centsToInput(essentials, { locale: state.settings.locale }) : '0'}" />
              <span class="hint">Leave blank to use your budgets, or the usual month’s spending if you haven’t set any.</span>
            </label>
            ${errorSlot('essentialMonthly')}
            <div class="btn-row"><button type="submit" class="btn primary small">Save targets</button></div>
          </form>
          ${safety ? html`<p class="muted small">${safety.name} is your safety net. ${runway != null ? `It would carry you ${fmtMonths(runway)} ${runway === 1 ? 'month' : 'months'}.` : ''}</p>` : html`<p class="muted small">No plan is marked as the safety net yet — edit one under <a href="#/goals">Plans</a> and choose “Safety net”.</p>`}
        </section>
      </div>
      <div class="dash-col">
        <section class="panel tinted" style="--hue:var(--hue-trend)" aria-labelledby="ms-title">
          ${homeSectionHead('var(--hue-trend)', SEC_ICONS.calendar, html`<span id="ms-title">Five years out</span>`, { link: html`<a class="link" href="#/goals">Plans</a>` })}
          ${state.goals.length
            ? html`<p class="muted small">If the usual ${money(typical)} a month keeps arriving and is dealt out by the shares you’ve set, this is where each pot stands at the end of each year, yield included.</p>
              ${milestoneTable(state.goals, typical)}`
            : html`<p class="muted">Add a plan and this becomes a five-year table.</p>`}
        </section>
      </div>
    </div>`;
}

export function afterAdvisorMount(root) {
  const form = $('[data-targets]', root);
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(form);
    const errors = {};
    const months = Number(d.runwayTarget);
    if (!Number.isInteger(months) || months < 1 || months > 60) errors.runwayTarget = 'Enter a whole number of months from 1 to 60.';
    let essential = null;
    if (d.essentialMonthly.trim()) {
      const parsed = parseAmount(d.essentialMonthly, { locale: state.settings.locale });
      if (!parsed.ok) errors.essentialMonthly = parsed.error;
      else if (parsed.negative || parsed.cents === 0) errors.essentialMonthly = 'Enter an amount greater than zero, or leave it blank.';
      else essential = parsed.cents;
    }
    if (Object.keys(errors).length) return showErrors(form, errors);
    try {
      await updateSettings({ runwayTarget: months, essentialMonthly: essential });
      toast('Targets saved');
    } catch (err) {
      toast(describeError(err), { tone: 'error' });
    }
  });
}
