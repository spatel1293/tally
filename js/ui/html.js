// Tagged template that escapes every interpolated value unless it is itself
// the result of html`` (or raw()). User text can never become markup.

class SafeHTML {
  constructor(value) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

function render(value) {
  if (value == null || value === false || value === true) return '';
  if (value instanceof SafeHTML) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return esc(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHTML(out);
}

export function raw(value) {
  return new SafeHTML(String(value));
}

export function mount(el, content) {
  el.innerHTML = render(content);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function formData(form) {
  const data = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') data[el.name] = el.checked;
    else if (el.type === 'radio') {
      if (el.checked) data[el.name] = el.value;
      else if (!(el.name in data)) data[el.name] = '';
    } else data[el.name] = el.value;
  }
  return data;
}

// Shows field errors next to inputs and focuses the first one.
export function showErrors(form, errors) {
  for (const el of $$('[data-error-for]', form)) {
    const msg = errors[el.dataset.errorFor];
    el.textContent = msg ?? '';
    el.hidden = !msg;
  }
  for (const el of $$('[name]', form)) {
    if (errors[el.name]) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');
  }
  const first = Object.keys(errors)[0];
  if (first) {
    const target = form.querySelector(`[name="${first}"]:not([type="hidden"])`) ?? form.querySelector(`[data-error-for="${first}"]`);
    target?.focus?.();
    target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }
}

export function errorSlot(name) {
  return html`<p class="field-error" id="err-${name}" data-error-for="${name}" role="alert" hidden></p>`;
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
