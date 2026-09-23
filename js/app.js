import { html, mount, $ } from './ui/html.js';
import { toast } from './ui/overlay.js';
import { resetCharts, hydrateCharts } from './ui/charts.js';
import { watchPosture } from './ui/posture.js';
import { state, init, subscribe, checkDayChange, reload, saveAccount, describeError } from './store.js';
import { isUnlocked, lock as lockVault, onVaultChange, open as openSealed, describeVaultError } from './vault.js';
import { CHAPTERS, icons, ui } from './views/chrome.js';
import { openAccountForm, openBalanceForm, openPlanForm, openPlanAdjust, passphraseDialog } from './views/forms.js';
import { renderFund, fundFacingPage } from './views/fund.js';
import { renderPots, potDetail, afterPotsMount, resetScenario } from './views/pots.js';
import { renderLedger, accountDetail, sealedFields } from './views/ledger.js';
import { renderReview, reviewFacingPage, afterReviewMount } from './views/review.js';
import { renderSettings, afterSettingsMount, exportJSON, startRestore } from './views/settings.js';

// ---------- The chapters ----------

const ROUTES = {
  fund: { render: renderFund, facing: fundFacingPage },
  pots: { render: renderPots, after: afterPotsMount, facing: facingForPot },
  ledger: { render: renderLedger, after: fillSealed, facing: facingForAccount },
  review: { render: renderReview, after: afterReviewMount, facing: reviewFacingPage },
  settings: { render: renderSettings, after: afterSettingsMount, facing: colophon },
};
const ORDER = CHAPTERS.map((c) => c.route);

function currentRoute() {
  const name = location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] || 'fund';
  return ROUTES[name] ? name : 'fund';
}

// The book itself: a spine down the middle, a page either side of it, the
// chapters cut into the fore-edge, and a ribbon marking your place.
function renderShell() {
  mount(
    $('#app'),
    html`<a class="skip" href="#main">Skip to the page</a>
    <div class="book">
      <div class="spine" aria-hidden="true"></div>
      <div class="ribbon" aria-hidden="true"><i></i></div>
      <header class="running-head" data-running>
        <span class="running-title" data-running-title></span>
        <span class="running-fund" data-running-fund></span>
      </header>
      <main id="main" class="leaf verso" tabindex="-1"></main>
      <aside class="leaf recto" data-facing aria-label="Facing page"></aside>
      <nav class="thumb-index" aria-label="Chapters">
        ${CHAPTERS.map((c) => html`<a href="#/${c.route}" data-route="${c.route}"><i aria-hidden="true">${icons[c.route]}</i><span>${c.title}</span></a>`)}
      </nav>
      <p class="folio" data-folio aria-hidden="true"></p>
      <div id="toasts" class="toasts" aria-live="polite"></div>
    </div>`
  );
}

// ---------- The facing page ----------

// What the right-hand page carries follows the chapter you are reading: on
// Pots it is the pot you picked, on Accounts the account you picked. The
// choice lives in `ui`, not in the layout, so folding never loses it.
function facingForPot() {
  const plan = ui.selectedPlan ? state.goals.find((g) => g.id === ui.selectedPlan) : null;
  if (plan) return potDetail(plan);
  return html`<div class="facing-wait"><p class="facing-hint">${state.goals.length ? 'Choose a pot and it opens here.' : 'Write in a pot and it opens here.'}</p></div>`;
}

function facingForAccount() {
  const account = ui.selectedAccount ? state.accounts.find((a) => a.id === ui.selectedAccount) : null;
  if (account) return accountDetail(account);
  return html`<div class="facing-wait"><p class="facing-hint">${state.accounts.length ? 'Choose an account and it opens here.' : 'Write in an account and it opens here.'}</p></div>`;
}

// The last page of any book.
function colophon() {
  return html`<div class="colophon">
    <p class="colophon-mark" aria-hidden="true">❧</p>
    <p>This book keeps one thing: what the fund is worth, what it is for, and where it sits.</p>
    <p>It runs entirely on this device. Nothing is sent anywhere, there is no account to sign into, and the sealed pages open only with your passphrase.</p>
    <p class="colophon-rule" aria-hidden="true"></p>
    <p class="colophon-small">Set in the device’s book face. Written offline.</p>
  </div>`;
}

// ---------- Painting ----------

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let lastRoute = null;
let turnTimer;

function render({ keepScroll = false } = {}) {
  if (!state.ready) return;
  const route = currentRoute();
  const turning = route !== lastRoute;

  // Moving between chapters is a page turn: the leaf lifts at the spine and
  // falls the other way. Everything else in the book stays put.
  if (turning && lastRoute && !reduceMotion.matches && document.startViewTransition) {
    const back = ORDER.indexOf(route) < ORDER.indexOf(lastRoute);
    document.documentElement.dataset.turn = back ? 'back' : 'forward';
    const t = document.startViewTransition(() => paint(route, { keepScroll, turning }));
    // Both promises have to be claimed: a second turn starting before the
    // first settles rejects `ready`, and an unclaimed rejection is an error.
    t.ready.catch(() => {});
    t.finished.catch(() => {}).finally(() => delete document.documentElement.dataset.turn);
    return;
  }
  paint(route, { keepScroll, turning });
}

function paint(route, { keepScroll, turning }) {
  const main = $('#main');
  const active = document.activeElement;
  const focusId = main.contains(active) && active.id ? active.id : null;
  const selection = focusId && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  const scroll = window.scrollY;

  resetCharts();
  const view = ROUTES[route];
  mount(main, view.render());
  view.after?.(main);
  hydrateCharts(main);
  renderFacing();
  updateChrome(route);

  if (turning) {
    lastRoute = route;
    if (!keepScroll) window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
    main.dataset.turned = '1';
    clearTimeout(turnTimer);
    turnTimer = setTimeout(() => delete main.dataset.turned, 900);
  } else {
    window.scrollTo(0, scroll);
    if (focusId) {
      const el = document.getElementById(focusId);
      el?.focus({ preventScroll: true });
      if (selection && el?.setSelectionRange) {
        try {
          el.setSelectionRange(...selection);
        } catch {
          // some input types don't support selection
        }
      }
    }
  }
}

// The facing page is painted on its own, so choosing something on the left
// doesn't redraw the left.
function renderFacing() {
  const el = $('[data-facing]');
  if (!el) return;
  const route = currentRoute();
  el.dataset.pane = route;
  mount(el, ROUTES[route].facing?.() ?? '');
  hydrateCharts(el);
  fillSealed(el);
}

function updateChrome(route) {
  const chapter = CHAPTERS.find((c) => c.route === route);
  for (const a of document.querySelectorAll('[data-route]')) {
    if (a.dataset.route === route) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.title = route === 'fund' ? 'Tally' : `${chapter.title} – Tally`;
  document.documentElement.dataset.chapter = route;

  const title = $('[data-running-title]');
  if (title) title.textContent = chapter.title;
  const folio = $('[data-folio]');
  if (folio) folio.textContent = chapter.folio;
  const fund = $('[data-running-fund]');
  if (fund) {
    const total = state.accounts.reduce((s, a) => s + (a.balance ?? 0), 0);
    fund.textContent = state.accounts.length
      ? new Intl.NumberFormat(state.settings.locale, { style: 'currency', currency: state.settings.currency, maximumFractionDigits: 0 }).format(total / 100)
      : '';
  }
  // The ribbon hangs at the chapter you are on.
  document.documentElement.style.setProperty('--ribbon-at', String(ORDER.indexOf(route)));
  watchRunningHead();
}

// The running head appears only once the chapter's own heading has scrolled
// away — the way a printed page carries its title at the top of every leaf
// except the one the chapter opens on.
let headObserver;
function watchRunningHead() {
  const bar = $('[data-running]');
  const heading = $('#main .chapter-head');
  if (!bar) return;
  headObserver?.disconnect();
  if (!heading) {
    bar.dataset.shown = '1';
    return;
  }
  delete bar.dataset.shown;
  const edge = Math.max(0, Math.round(bar.getBoundingClientRect().bottom)) || 44;
  headObserver = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) delete bar.dataset.shown;
      else bar.dataset.shown = '1';
    },
    { rootMargin: `-${edge}px 0px 0px 0px`, threshold: 0 }
  );
  headObserver.observe(heading);
}

// Sealed details are unsealed after the markup is on screen: decryption is
// asynchronous, and a shut strongbox simply leaves the slot as it was.
async function fillSealed(root = document) {
  if (!isUnlocked()) return;
  for (const slot of root.querySelectorAll('[data-vault-fields]')) {
    const account = state.accounts.find((a) => a.id === slot.dataset.vaultFields);
    if (!account?.vault) continue;
    try {
      mount(slot, sealedFields(await openSealed(account.vault)));
    } catch (err) {
      mount(slot, html`<p class="field-error">Couldn’t unseal these. ${describeVaultError(err) ?? ''}</p>`);
    }
  }
}

// ---------- Paper ----------

const darkQuery = matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const pref = state.settings.theme ?? 'system';
  const dark = pref === 'dark' || (pref === 'system' && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#14110d' : '#e8ddc8');
  try {
    localStorage.setItem('tally:theme', pref);
  } catch {
    // the theme still applies for this session
  }
}
darkQuery.addEventListener?.('change', applyTheme);

// ---------- Actions ----------

const fail = (err) => toast(describeVaultError(err) ?? describeError(err), { tone: 'error' });

const actions = {
  'new-account': () => openAccountForm(),
  'edit-account': (el) => openAccountForm(el.dataset.id),
  'read-balance': (el) => openBalanceForm(el.dataset.id),
  'new-plan': (el) => openPlanForm(null, el.dataset.kind ? { kind: el.dataset.kind } : {}),
  'edit-plan': (el) => openPlanForm(el.dataset.id),
  'adjust-plan': (el) => openPlanAdjust(el.dataset.id),

  // Choosing something on one page fills the other. On a single page the
  // same tap opens it underneath, and tapping again closes it — so the
  // gesture means the same thing however the phone is being held.
  'select-plan': (el) => {
    ui.selectedPlan = ui.selectedPlan === el.dataset.id ? null : el.dataset.id;
    render({ keepScroll: true });
  },
  'select-account': (el) => {
    ui.selectedAccount = ui.selectedAccount === el.dataset.id ? null : el.dataset.id;
    render({ keepScroll: true });
  },
  'mark-reviewed': async (el) => {
    try {
      await saveAccount({ reviewedAt: state.today }, el.dataset.id);
      toast('Marked reviewed today');
    } catch (err) {
      fail(err);
    }
  },

  'vault-create': async () => {
    if (await passphraseDialog({ mode: 'create' })) toast('Sealed. It opens with your passphrase.');
  },
  'vault-unlock': async () => {
    if (await passphraseDialog({ mode: 'unlock' })) toast('Strongbox open');
  },
  'vault-change': async () => {
    if (await passphraseDialog({ mode: 'change' })) toast('Passphrase changed');
  },
  'vault-lock': () => {
    lockVault();
    toast('Strongbox shut');
  },

  // A secret shows itself where it was hidden and hides again shortly: long
  // enough to read a number off the page, short enough that it isn't still
  // there when the book is handed to someone.
  'reveal-secret': (el) => {
    const secret = el.closest('dd')?.querySelector('.secret');
    if (!secret) return;
    const showing = secret.dataset.showing === '1';
    secret.textContent = showing ? secret.dataset.masked : secret.dataset.secret;
    secret.dataset.showing = showing ? '0' : '1';
    el.textContent = showing ? 'Show' : 'Hide';
    clearTimeout(secret._hide);
    if (!showing) {
      secret._hide = setTimeout(() => {
        secret.textContent = secret.dataset.masked;
        secret.dataset.showing = '0';
        el.textContent = 'Show';
      }, 20000);
    }
  },
  'copy-secret': async (el) => {
    const secret = el.closest('dd')?.querySelector('.secret');
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.dataset.secret);
      toast('Copied. The clipboard clears in 30 seconds.');
      setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 30000);
    } catch {
      toast('This browser wouldn’t let the book use the clipboard.', { tone: 'error' });
    }
  },

  'export-json': () => exportJSON(),
  'restore-json': () => startRestore(),
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  fn(el, e);
});

// ---------- Keyboard ----------

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  if (document.querySelector('dialog[open]')) return;
  const route = currentRoute();
  const go = (hash) => {
    location.hash = hash;
  };
  const index = ORDER.indexOf(route);
  switch (e.key) {
    case '1': case '2': case '3': case '4': case '5': {
      const chapter = CHAPTERS[Number(e.key) - 1];
      if (chapter) go(`#/${chapter.route}`);
      break;
    }
    case '[':
      go(`#/${ORDER[Math.max(0, index - 1)]}`);
      break;
    case ']':
      go(`#/${ORDER[Math.min(ORDER.length - 1, index + 1)]}`);
      break;
    case 'n': case 'N':
      if (route === 'ledger') openAccountForm();
      else openPlanForm();
      break;
    case 'l': case 'L':
      lockVault();
      break;
    default:
      return;
  }
  e.preventDefault();
});

// ---------- Boot ----------

async function boot() {
  renderShell();
  try {
    await init();
  } catch {
    mount(
      $('#main'),
      html`<div class="empty-page"><h2>The book wouldn’t open</h2>
        <p>Try reloading. If this keeps happening, check that the browser allows site data for this page.</p>
        <button type="button" class="btn primary" onclick="location.reload()">Reload</button></div>`
    );
    return;
  }
  applyTheme();
  // Opening or shutting the strongbox changes what is on the page, and the
  // shutting can happen on a timer or when the book is put down.
  onVaultChange(() => render({ keepScroll: true }));
  subscribe((reason) => {
    if (reason === 'blocked') {
      toast('The book was changed in another tab. Reload to keep going.', { duration: 60000, action: { label: 'Reload', onClick: () => location.reload() } });
      return;
    }
    if (reason === 'settings' || reason === 'init' || reason === 'reload') applyTheme();
    render({ keepScroll: true });
  });
  render();
  document.documentElement.classList.add('ready');

  window.addEventListener('hashchange', () => render());

  // Folding or unfolding changes how much room each leaf has: redraw at the
  // new width, and let the facing page find its side of the crease again.
  watchPosture(() => {
    renderFacing();
    hydrateCharts(document);
  });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => hydrateCharts(document), 120);
  });
  const wake = () => {
    if (document.visibilityState !== 'visible') return;
    checkDayChange().catch(() => {});
  };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('focus', wake);
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) reload().catch(() => {});
  });
  setInterval(wake, 60000);

  resetScenario();
  registerServiceWorker();
  renderDebugOverlay();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:' || globalThis.TALLY_SINGLE_FILE) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloading) {
      reloading = true;
      location.reload();
    }
  });
  const offerUpdate = (worker) => {
    toast('A new edition is ready.', {
      duration: 30000,
      action: { label: 'Update', onClick: () => worker.postMessage('skipWaiting') },
    });
  };
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    if (reg.waiting && hadController) offerUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && hadController) offerUpdate(worker);
      });
    });
  }).catch(() => {
    // Offline is a bonus; the book works without it.
  });
}

// ---------- Debug overlay (?debug) ----------
// An on-device readout for measuring real viewport sizes and the hinge, used
// to tune the spread. Not linked from anywhere; append ?debug to the URL.

function renderDebugOverlay() {
  if (!/[?&]debug\b/.test(location.search)) return;
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  Object.assign(box.style, {
    position: 'fixed', zIndex: '9999', top: '0', insetInlineStart: '0',
    padding: '6px 8px', font: '11px/1.5 ui-monospace, monospace',
    background: 'rgba(0,0,0,0.75)', color: '#fff', whiteSpace: 'pre',
    pointerEvents: 'none',
  });
  document.body.appendChild(box);
  const update = () => {
    const segs = window.viewport?.segments;
    box.textContent = [
      `${window.innerWidth} × ${window.innerHeight} css px`,
      `dpr ${window.devicePixelRatio}`,
      `coarse pointer: ${matchMedia('(pointer: coarse)').matches}`,
      segs && segs.length > 1
        ? `segments: ${segs.map((s) => `${Math.round(s.width)}×${Math.round(s.height)} @${Math.round(s.left)},${Math.round(s.top)}`).join('  |  ')}`
        : 'segments: 1 (flat or unsupported)',
    ].join('\n');
  };
  update();
  window.addEventListener('resize', update);
  window.viewport?.addEventListener?.('segmentschange', update);
}

// Keep the tab from closing while a save is still in flight.
window.addEventListener('beforeunload', (e) => {
  if (document.querySelector('.sheet-foot button:disabled')) {
    e.preventDefault();
    e.returnValue = '';
  }
});

boot();
