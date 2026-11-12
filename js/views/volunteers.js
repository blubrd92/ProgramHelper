// Admin screen: the short list of volunteers who help with programs.
// First name and last initial only. No contact details, ever.
import { h, clear, toast, showError, openDialog, confirmDialog, field, add } from '../ui.js';
import { listVolunteers, saveVolunteer, deleteVolunteer } from '../data/store.js';

export function renderVolunteers(container, ctx) {
  let alive = true;
  const body = h('div', { class: 'admin-screen' }, h('p', { class: 'loading' }, 'Loading volunteers…'));
  add(container, body);

  async function load() {
    try {
      const list = await listVolunteers();
      if (alive) draw(list);
    } catch (e) {
      showError(e);
    }
  }

  // "Fern Q." (the dog gets its own column here)
  const nameOf = (v) => (v.lastInitial ? `${v.firstName} ${v.lastInitial}.` : v.firstName);

  function draw(list) {
    add(clear(body),
      h('div', { class: 'page-head' },
        h('h1', {}, 'Volunteers'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openEditor(null) }, 'Add volunteer')),
      h('p', {}, 'A short list of volunteers who help with programs. First name and last initial only. Do not record phone numbers, emails or addresses here.'),
      list.length
        ? h('div', { class: 'table-wrap' },
          h('table', {},
            h('thead', {}, h('tr', {},
              h('th', { scope: 'col' }, 'Name'),
              h('th', { scope: 'col' }, 'Dog'),
              h('th', { scope: 'col' }, 'Note'),
              h('th', { scope: 'col' }, 'Actions'))),
            h('tbody', {}, list.map((v) => h('tr', {},
              h('td', {}, nameOf(v)),
              h('td', {}, v.dogName || ''),
              h('td', {}, v.note || ''),
              h('td', {}, h('div', { class: 'action-row' },
                h('button', { type: 'button', class: 'btn btn-small', 'aria-label': `Edit ${nameOf(v)}`, onclick: () => openEditor(v) }, 'Edit'),
                h('button', { type: 'button', class: 'btn btn-small btn-danger', 'aria-label': `Remove ${nameOf(v)}`, onclick: () => remove(v) }, 'Remove'))))))))
        : h('p', { class: 'muted' }, 'No volunteers yet. Use "Add volunteer" to add the first one.'));
  }

  async function remove(v) {
    const yes = await confirmDialog(
      'Remove volunteer?',
      `Remove ${nameOf(v)} from the volunteer list? Programs they were assigned to will show 'Volunteer no longer on the list'.`,
      'Remove', { danger: true });
    if (!yes) return;
    try {
      await deleteVolunteer(v.id);
      toast('Volunteer removed.');
      await load();
    } catch (e) {
      showError(e);
    }
  }

  function openEditor(v) {
    const first = h('input', { type: 'text', maxLength: 30, required: true, value: v?.firstName || '' });
    const initial = h('input', { type: 'text', maxLength: 1, value: v?.lastInitial || '', autocomplete: 'off' });
    initial.addEventListener('input', () => { initial.value = initial.value.toUpperCase(); });
    const dog = h('input', { type: 'text', maxLength: 30, value: v?.dogName || '' });
    const note = h('input', { type: 'text', maxLength: 100, value: v?.note || '' });
    const errorP = h('p', { class: 'form-error', role: 'alert' });
    const saveBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save');
    const cancelBtn = h('button', { type: 'button', class: 'btn' }, 'Cancel');

    const form = h('form', { novalidate: true },
      field('First name', first),
      field('Last initial', initial),
      field("Dog's name (optional)", dog),
      field('Note (optional)', note, { hint: 'For example: second Saturdays only. No contact details.' }),
      errorP,
      h('div', { class: 'dialog-actions' }, cancelBtn, saveBtn));

    const dlg = openDialog(v ? 'Edit volunteer' : 'Add volunteer', form);
    cancelBtn.addEventListener('click', () => dlg.close());
    first.focus();

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      errorP.textContent = '';
      saveBtn.disabled = true;
      try {
        await saveVolunteer(v ? v.id : null, {
          firstName: first.value, lastInitial: initial.value, dogName: dog.value, note: note.value,
        });
        dlg.close();
        toast('Volunteer saved.');
        await load();
      } catch (e) {
        if (e?.name === 'UserError') errorP.textContent = e.message;
        else showError(e);
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  load();
  return () => { alive = false; };
}
