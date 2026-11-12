// Small page-building helpers shared by every screen. No framework.

/**
 * Build an element.  h('button', { class: 'btn', onclick: fn }, 'Save')
 * Text is always inserted as text, never as HTML, so typed names cannot
 * inject markup.
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/**
 * Put things inside an element, skipping anything empty.
 * Always use this instead of el.append(): the browser's own append() turns
 * an empty value into the visible word "null".
 */
export function add(el, ...children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

/** Brief message at the bottom of the screen. kind: 'ok' | 'error' | 'info' */
export function toast(message, kind = 'ok') {
  const box = document.getElementById('toasts');
  const t = h('div', { class: `toast toast-${kind}` }, message);
  box.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 8000 : 4000);
}

/** Show an error from the data layer in words staff can act on. */
export function showError(e) {
  console.error(e);
  if (e?.name === 'UserError' || e?.constructor?.name === 'UserError') return toast(e.message, 'error');
  if (e?.code === 'permission-denied') return toast('This login is not allowed to do that.', 'error');
  if (e?.code === 'unavailable') return toast('Cannot reach the database. Check the internet connection and try again.', 'error');
  toast('Something went wrong. Nothing was saved. Try again.', 'error');
}

/**
 * Open a modal dialog. Returns { dialog, close }.
 * Escape closes it; focus returns to whatever was focused before.
 */
export function openDialog(title, body, { onClose } = {}) {
  const previous = document.activeElement;
  const heading = h('h2', { id: 'dlgTitle' }, title);
  const dialog = h('dialog', { class: 'dialog', 'aria-labelledby': 'dlgTitle' }, heading, body);
  document.body.append(dialog);
  dialog.addEventListener('close', () => {
    dialog.remove();
    previous?.focus?.();
    onClose?.();
  });
  dialog.showModal();
  return { dialog, close: () => dialog.close() };
}

/** Ask a yes/no question. Resolves true or false. */
export function confirmDialog(title, message, yesLabel = 'Yes', { danger = false } = {}) {
  return new Promise((resolve) => {
    let answer = false;
    const yes = h('button', { type: 'button', class: danger ? 'btn btn-danger' : 'btn btn-primary' }, yesLabel);
    const no = h('button', { type: 'button', class: 'btn' }, 'Go back');
    const body = h('div', {}, h('p', {}, message), h('div', { class: 'dialog-actions' }, no, yes));
    const d = openDialog(title, body, { onClose: () => resolve(answer) });
    yes.addEventListener('click', () => { answer = true; d.close(); });
    no.addEventListener('click', () => d.close());
    no.focus();
  });
}

/** A labelled form field.  field('Phone', inputEl, { hint, error }) */
export function field(label, control, { hint, id } = {}) {
  const fid = id || control.id || `f${Math.random().toString(36).slice(2, 9)}`;
  control.id = fid;
  const err = h('span', { class: 'field-error', id: `${fid}-err`, role: 'alert' });
  control.setAttribute('aria-describedby', `${fid}-err`);
  return h('div', { class: 'field' },
    h('label', { for: fid }, label),
    control,
    hint ? h('span', { class: 'field-hint' }, hint) : null,
    err);
}

export function setFieldError(control, message) {
  const err = document.getElementById(`${control.id}-err`);
  if (err) err.textContent = message || '';
  control.setAttribute('aria-invalid', message ? 'true' : 'false');
}
