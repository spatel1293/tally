import { html, $, formData, showErrors, errorSlot } from '../ui/html.js';
import { state, updateSettings, describeError } from '../store.js';
import { advisorReview } from '../core/advisor.js';
import { reconcile } from '../core/fund.js';
import { centsToInput, parseAmount } from '../core/money.js';
import { toast } from '../ui/overlay.js';
import { money, percent } from '../ui/format.js';
import { inkRing } from '../ui/charts.js';
import { chapterHead, displayFigure, icons, ruledRow, section } from './chrome.js';

const fmtMonths = (m) => (Number.isInteger(m) ? String(m) : m.toFixed(1));
const rate = (bp) => `${(bp / 100).toFixed(bp % 100 ? 2 : 0)}%`;

export function currentReview() {
  return advisorReview({
    plans: state.goals,
    accounts: state.accounts,
    settings: state.settings,
    todayIso: state.today,
    money,
  });
}

export function renderReview() {
  const review = currentReview();
  const open = review.attention.filter((c) => !c.soft);
  const recon = reconcile(state.accounts, state.goals);

  return html`${chapterHead('review')}
    <div class="review-head">
      ${inkRing({
        ratio: review.score / review.checks.length,
        tone: open.length ? 'thin' : 'covered',
        centre: `${review.score}`,
        below: `of ${review.checks.length}`,
        label: `${review.score} of ${review.checks.length} checks clear`,
      })}
      <div>
        <p class="hand">${open.length
          ? `${open.length === 1 ? 'One thing' : `${open.length} things`} to look at. The rest is in order.`
          : 'Everything a planner would check is in order.'}</p>
        ${review.savingsRate != null ? html`<p class="marginal">You set aside about ${review.savingsRate}% of what comes in.</p>` : ''}
      </div>
    </div>

    ${section('The look-over', html`<ul class="plain-list checklist">
      ${review.checks.map((c) => html`<li class="check ${c.ok ? 'ok' : c.soft ? 'soft' : 'open'}">
        <a class="check-row" href="#/${c.route}">
          <i class="check-mark" aria-hidden="true">${c.ok ? icons.check : ''}</i>
          <span class="check-words"><strong>${c.title}</strong><small>${c.detail}</small></span>
          ${icons.chevron}
        </a>
      </li>`)}
    </ul>`, { id: 'checks' })}

    ${section('Does it add up', html`${state.accounts.length
      ? html`<p class="marginal">What each account holds, against what the pots kept there claim.</p>
          <ul class="plain-list ruled-list">
            ${recon.rows.map((r) => ruledRow(r.account.name, money(r.difference, { sign: true }), {
              sub: r.plans.length ? `${money(r.balance)} held, ${money(r.claimed)} claimed` : `${money(r.balance)} held, nothing claims it`,
              tone: r.short ? 'short' : r.difference === 0 ? 'covered' : '',
            }))}
          </ul>`
      : html`<p class="hand">Write in an account and the book can check the sums.</p>`}`, { id: 'recon' })}

    ${section('The figures behind it all', html`<form class="stack figures-form" data-figures novalidate autocomplete="off">
        <label class="field">
          <span class="label">Comes in each month</span>
          <input type="text" inputmode="decimal" name="monthlyIncome" value="${state.settings.monthlyIncome ? centsToInput(state.settings.monthlyIncome, { locale: state.settings.locale }) : ''}" placeholder="0" />
        </label>
        ${errorSlot('monthlyIncome')}
        <label class="field">
          <span class="label">Goes out each month</span>
          <input type="text" inputmode="decimal" name="monthlyOutgoings" value="${state.settings.monthlyOutgoings ? centsToInput(state.settings.monthlyOutgoings, { locale: state.settings.locale }) : ''}" placeholder="0" />
          <span class="hint">Rent, food, bills — what a month costs to keep going. The safety net is measured in these.</span>
        </label>
        ${errorSlot('monthlyOutgoings')}
        <label class="field">
          <span class="label">The safety net should cover</span>
          <span class="row-inline">
            <input type="number" name="runwayTarget" min="1" max="60" step="1" value="${review.runwayTarget}" />
            <span class="unit">months</span>
          </span>
          <span class="hint">Three to six is the usual advice; a year or two if your income is uneven.</span>
        </label>
        ${errorSlot('runwayTarget')}
        <div class="btn-row"><button type="submit" class="btn primary">Write them in</button></div>
      </form>
      <ul class="plain-list ruled-list">
        ${ruledRow('Left over', money(review.spare), { sub: 'each month' })}
        ${ruledRow('Spoken for', money(review.allocated), { sub: review.spare > 0 ? percent(review.allocated / review.spare) : 'nothing to share' })}
        ${ruledRow('The fund earns', rate(review.apyBp), { sub: 'across every account' })}
        ${review.runway != null ? ruledRow('Runway', `${fmtMonths(review.runway)} months`, { tone: review.runway >= review.runwayTarget ? 'covered' : 'thin' }) : ''}
      </ul>`, { id: 'figures' })}`;
}

export function afterReviewMount(root) {
  const form = $('[data-figures]', root);
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = formData(form);
    const { locale } = state.settings;
    const errors = {};
    const read = (name) => {
      if (!d[name].trim()) return 0;
      const parsed = parseAmount(d[name], { locale });
      if (!parsed.ok) errors[name] = parsed.error;
      else if (parsed.negative) errors[name] = 'This can’t be negative.';
      else return parsed.cents;
      return 0;
    };
    const monthlyIncome = read('monthlyIncome');
    const monthlyOutgoings = read('monthlyOutgoings');
    const runwayTarget = Number(d.runwayTarget);
    if (!Number.isInteger(runwayTarget) || runwayTarget < 1 || runwayTarget > 60) errors.runwayTarget = 'A whole number of months, from 1 to 60.';
    if (Object.keys(errors).length) return showErrors(form, errors);
    try {
      await updateSettings({ monthlyIncome, monthlyOutgoings, runwayTarget });
      toast('Written in');
    } catch (err) {
      toast(describeError(err), { tone: 'error' });
    }
  });
}

// The facing page of the review: the one thing most worth doing next.
export function reviewFacingPage() {
  const review = currentReview();
  const next = review.attention.find((c) => !c.soft) ?? review.attention[0] ?? null;
  return html`<div class="facing">
    ${section('Next', next
      ? html`<p class="facing-name">${next.title}</p>
          <p class="hand">${next.detail}</p>
          <div class="btn-row"><a class="btn primary" href="#/${next.route}">Go and fix it</a></div>`
      : html`<p class="hand">Nothing outstanding. Come back next quarter.</p>`)}
    ${section('Standing', html`<ul class="plain-list ruled-list">
      ${review.checks.map((c) => ruledRow(c.title, c.ok ? 'clear' : c.soft ? 'worth doing' : 'open', { tone: c.ok ? 'covered' : c.soft ? '' : 'thin', href: `#/${c.route}` }))}
    </ul>`)}
  </div>`;
}
