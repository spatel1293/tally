import { html, mount, $ } from './html.js';

// ---------- Sheet (bottom sheet on phones, centered panel on desktop) ----------

let current = null;

function makeDialog(id) {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('dialog');
    el.id = id;
    document.body.append(el);
  }
  return el;
}

// Clicking the backdrop closes, but only when the press also started there,
// so selecting text in an input and releasing outside doesn't close the sheet.
function closeOnBackdrop(dialog, close) {
  let downOnBackdrop = false;
  dialog.addEventListener('pointerdown', (e) => {
    downOnBackdrop = e.target === dialog;
  });
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && downOnBackdrop) close();
    downOnBackdrop = false;
  });
}

export function openSheet({ title, body, footer = null, onMount, onClose, size = '' }) {
  if (current) current.close({ silent: true });
  const dialog = makeDialog('sheet');
  dialog.className = `sheet ${size}`;
  dialog.setAttribute('aria-labelledby', 'sheet-title');
  mount(
    dialog,
    html`<div class="sheet-panel">
      <header class="sheet-head">
        <h2 id="sheet-title">${title}</h2>
        <button type="button" class="icon-btn" data-sheet-close aria-label="Close">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </header>
      <div class="sheet-body">${body}</div>
      ${footer ? html`<footer class="sheet-foot">${footer}</footer>` : ''}
    </div>`
  );

  let closed = false;
  const controller = {
    el: dialog,
    close({ silent = false } = {}) {
      if (closed) return;
      closed = true;
      if (current === controller) current = null;
      if (dialog.open) dialog.close();
      if (!silent) onClose?.();
    },
    setTitle(text) {
      $('#sheet-title', dialog).textContent = text;
    },
  };

  if (!dialog.dataset.wired) {
    dialog.dataset.wired = '1';
    closeOnBackdrop(dialog, () => current?.close());
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      current?.close();
    });
    dialog.addEventListener('click', (e) => {
      if (e.target.closest('[data-sheet-close]')) current?.close();
    });
  }

  current = controller;
  dialog.showModal();
  onMount?.(dialog, controller);
  return controller;
}

export function currentSheet() {
  return current;
}

// ---------- Confirm ----------

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, requireText = null, extra = null }) {
  return new Promise((resolve) => {
    const dialog = makeDialog('confirm');
    dialog.className = 'confirm';
    dialog.setAttribute('aria-labelledby', 'confirm-title');
    mount(
      dialog,
      html`<form method="dialog" class="confirm-panel">
        <h2 id="confirm-title">${title}</h2>
        <div class="confirm-msg">${message}</div>
        ${extra ?? ''}
        ${requireText
          ? html`<label class="field">
              <span class="label">Type <strong>${requireText}</strong> to confirm</span>
              <input name="confirmText" autocomplete="off" autocapitalize="none" spellcheck="false" />
            </label>`
          : ''}
        <div class="btn-row end">
          <button type="button" class="btn ghost" value="cancel" data-cancel>Cancel</button>
          <button type="submit" class="btn ${danger ? 'danger' : 'primary'}" value="ok" ${requireText ? 'disabled' : ''}>${confirmLabel}</button>
        </div>
      </form>`
    );
    const form = $('form', dialog);
    const okBtn = $('button[type="submit"]', dialog);
    const input = $('input[name="confirmText"]', dialog);
    let result = false;
    const finish = () => {
      dialog.removeEventListener('close', finish);
      const extras = {};
      for (const el of form.querySelectorAll('input[type="checkbox"][name]')) extras[el.name] = el.checked;
      resolve(result ? { ...extras, ok: true } : false);
    };
    input?.addEventListener('input', () => {
      okBtn.disabled = input.value.trim().toLowerCase() !== requireText.toLowerCase();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (okBtn.disabled) return;
      result = true;
      dialog.close();
    });
    $('[data-cancel]', dialog).addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', finish);
    dialog.showModal();
    (input ?? $('[data-cancel]', dialog)).focus();
  });
}

// ---------- Toast ----------

// Modal dialogs live in the browser's top layer, so while one is open the
// toast goes inside it; otherwise it would sit behind the backdrop.
function toastHost() {
  const dialog = document.querySelector('dialog#confirm[open]') ?? document.querySelector('dialog#sheet[open]');
  if (!dialog) return document.getElementById('toasts');
  let host = dialog.querySelector(':scope > .toasts');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    host.setAttribute('aria-live', 'polite');
    dialog.append(host);
  }
  return host;
}

export function toast(message, { action = null, tone = '', duration = 5000 } = {}) {
  const el = document.createElement('div');
  el.className = `toast ${tone}`;
  el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  mount(
    el,
    html`<span class="toast-msg">${message}</span>${action ? html`<button type="button" class="toast-action">${action.label}</button>` : ''}`
  );
  let timer;
  const remove = () => {
    clearTimeout(timer);
    el.remove();
  };
  if (action) {
    el.querySelector('.toast-action').addEventListener('click', async () => {
      remove();
      await action.onClick();
    });
  }
  el.addEventListener('pointerenter', (e) => {
    if (e.pointerType === 'mouse') clearTimeout(timer);
  });
  el.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(timer);
    timer = setTimeout(remove, 2500);
  });
  // Pick the host after the caller's synchronous code has run, so a sheet
  // that closes right after this call doesn't take the message with it.
  queueMicrotask(() => {
    const host = toastHost();
    if (!host) return;
    // One message at a time, so an Undo button always belongs to the latest action.
    for (const other of document.querySelectorAll('.toast')) other.remove();
    host.append(el);
    timer = setTimeout(remove, action ? Math.max(duration, 8000) : duration);
  });
}
