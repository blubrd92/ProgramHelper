// Admin screen: how long names and contact details are kept.
import { h, clear, toast, showError, confirmDialog, field, setFieldError, add } from '../ui.js';
import { getRetentionDays, saveRetentionDays } from '../data/store.js';

export function renderSettings(container, ctx) {
  let alive = true;
  let current = null; // the saved number of days
  const body = h('div', { class: 'admin-screen' }, h('p', { class: 'loading' }, 'Loading settings…'));
  add(container, body);

  async function load() {
    try {
      current = await getRetentionDays();
      if (alive) draw();
    } catch (e) {
      showError(e);
    }
  }

  function draw() {
    const daysIn = h('input', { type: 'number', min: 1, max: 30, step: 1, value: current, inputMode: 'numeric' });
    const saveBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save');
    const status = h('p', { class: 'muted', role: 'status' });

    const form = h('form', { novalidate: true },
      field('Days to keep (1 to 30)', daysIn),
      h('div', { class: 'action-row' }, saveBtn),
      status);

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      setFieldError(daysIn, '');
      const text = daysIn.value.trim();
      const days = Number(text);
      // Show an error rather than quietly changing what was typed.
      if (text === '' || !Number.isInteger(days) || days < 1 || days > 30) {
        setFieldError(daysIn, 'Enter a whole number from 1 to 30.');
        daysIn.focus();
        return;
      }
      if (days < current) {
        const yes = await confirmDialog(
          `Shorten to ${days} days?`,
          `Sign-ups from programs that ended more than ${days} days ago will be removed within a few minutes. This cannot be undone.`,
          'Shorten', { danger: true });
        if (!yes) return;
      }
      saveBtn.disabled = true;
      status.textContent = 'Saving and updating existing sign-ups…';
      try {
        const n = await saveRetentionDays(days);
        toast(n > 0 ? `Saved. ${n} ${n === 1 ? 'sign-up was' : 'sign-ups were'} updated.` : 'Saved.');
        await load(); // refresh the shown value
      } catch (e) {
        if (e?.name === 'UserError') setFieldError(daysIn, e.message);
        else showError(e);
        saveBtn.disabled = false;
        status.textContent = '';
      }
    });

    add(clear(body),
      h('div', { class: 'page-head' }, h('h1', {}, 'Settings')),
      h('section', { class: 'card', 'aria-labelledby': 'retHead' },
        h('h2', { id: 'retHead' }, 'How long names and contact details are kept'),
        h('p', {}, "Children's names, caregiver names, phone numbers, emails and notes are removed automatically this many days after a program ends. For a child signed up across a repeating series, the days are counted from their last session. Attendance numbers are kept; they contain no names."),
        form),
      h('section', { class: 'card', 'aria-labelledby': 'loginHead' },
        h('h2', { id: 'loginHead' }, 'The two logins'),
        h('p', {}, 'The staff and admin logins are created and reset in the Firebase console. The steps are in the README file.')));
  }

  load();
  return () => { alive = false; };
}
