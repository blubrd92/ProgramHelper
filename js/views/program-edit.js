// Admin: change a program after it was created (name, date, times, seats,
// what is collected, reminder wording, and for time-slot programs the slots).
// All the checking and the knock-on work (wipe dates, waitlist) happens in
// updateProgram() in the data layer; this file is only the form.
import { h, add, toast, showError, openDialog, field } from '../ui.js';
import { updateProgram } from '../data/store.js';
import { generateSlots, formatTime, localDateString, MAX_SLOTS } from '../data/model.js';

export function openProgramEdit(program) {
  const slotted = program.kind === 'slotted';
  const today = localDateString(new Date());

  const name = h('input', { type: 'text', maxLength: 80, value: program.name });
  const date = h('input', { type: 'date', value: program.date, min: program.date < today ? program.date : today });
  const start = h('input', { type: 'time', value: program.startTime });
  const end = h('input', { type: 'time', value: program.endTime });
  const seats = h('input', { type: 'number', min: 1, max: 200, step: 1, inputMode: 'numeric', value: program.capacity });

  // ---- what to collect
  const collect = {};
  const collectRow = (key, label) => {
    const box = h('input', { type: 'checkbox', id: `edit-collect-${key}`, checked: !!program.fields?.[key] });
    collect[key] = box;
    return h('div', { class: 'check-row' }, box, h('label', { for: `edit-collect-${key}` }, label));
  };
  const collectSet = h('fieldset', {},
    h('legend', {}, 'Information to collect'),
    collectRow('age', "Child's age"),
    collectRow('caregiver', 'Caregiver first name'),
    collectRow('email', 'Email'),
    collectRow('notes', 'Notes'),
    h('p', { class: 'muted small' }, 'Turning one off hides it from now on. It does not erase what was already typed.'));

  // ---- time slots (time-slot programs)
  const booked = new Set(Object.keys(program.seats || {}).map((k) => Number(k.split('_')[0])));
  const slotRows = h('div', { class: 'slot-rows' });
  const lengthIn = h('input', { type: 'number', min: 1, max: 240, step: 1, inputMode: 'numeric', value: 10 });
  const gapIn = h('input', { type: 'number', min: 0, max: 120, step: 1, inputMode: 'numeric', value: 0 });
  const fillNote = h('p', { class: 'slot-fill-note', role: 'status' });
  const addSlotBtn = h('button', { type: 'button', class: 'btn' }, 'Add a time slot at the end');
  const removeSlotBtn = h('button', { type: 'button', class: 'btn' }, 'Remove the last time slot');

  function slotRow(s) {
    const n = slotRows.children.length;
    const from = h('input', { type: 'time', class: 'slot-start', value: s.start, id: `edit-slot-s${n}` });
    const to = h('input', { type: 'time', class: 'slot-end', value: s.end, id: `edit-slot-e${n}` });
    add(slotRows, h('div', { class: 'slot-row' },
      h('span', { class: 'slot-num' }, `Slot ${n + 1}`),
      h('div', { class: 'field' }, h('label', { for: from.id }, 'Starts'), from),
      h('div', { class: 'field' }, h('label', { for: to.id }, 'Ends'), to),
      booked.has(n) ? h('span', { class: 'badge' }, 'Booked') : null));
    syncSlotButtons();
  }
  const readSlots = () => [...slotRows.children].map((r) => ({
    start: r.querySelector('.slot-start').value, end: r.querySelector('.slot-end').value,
  }));
  function syncSlotButtons() {
    const n = slotRows.children.length;
    addSlotBtn.disabled = n >= MAX_SLOTS;
    removeSlotBtn.disabled = n <= 1;
  }
  addSlotBtn.addEventListener('click', () => {
    const rows = readSlots();
    const last = rows[rows.length - 1];
    // Start where the last slot ends and keep its length.
    const next = last ? generateSlots(last.end, '23:59', minutesBetween(last.start, last.end) || 10).slots[0] : null;
    slotRow(next || { start: start.value, end: end.value });
  });
  removeSlotBtn.addEventListener('click', () => {
    const n = slotRows.children.length;
    if (booked.has(n - 1)) {
      fillNote.classList.add('form-error');
      fillNote.textContent = 'A child is booked in the last time slot. Move or cancel them first.';
      return;
    }
    slotRows.lastElementChild.remove();
    syncSlotButtons();
  });
  const fillBtn = h('button', { type: 'button', class: 'btn', onclick: () => {
    const result = generateSlots(start.value, end.value,
      lengthIn.value === '' ? NaN : Number(lengthIn.value), gapIn.value === '' ? 0 : Number(gapIn.value));
    fillNote.classList.toggle('form-error', !!result.error);
    if (result.error) {
      fillNote.textContent = `${result.error} The slots below were not changed.`;
      return;
    }
    slotRows.replaceChildren();
    result.slots.forEach(slotRow);
    const n = result.slots.length;
    let text = `${n} ${n === 1 ? 'slot' : 'slots'}, ${formatTime(result.slots[0].start)} to ${formatTime(result.slots[n - 1].end)}.`;
    if (result.unused > 0) text += ` The last ${result.unused} ${result.unused === 1 ? 'minute is' : 'minutes are'} unused.`;
    fillNote.textContent = text;
  } }, 'Fill in the slots');
  (program.slots || []).forEach(slotRow);

  const slotSet = h('fieldset', { class: 'slot-fieldset' },
    h('legend', {}, 'Time slots'),
    h('p', { class: 'muted small' }, 'Children keep their place: slot 1 stays slot 1 even if its time changes. A slot with a child booked in it cannot be removed.'),
    h('div', { class: 'field-row slot-fill-row' },
      field('Minutes per slot', lengthIn),
      field('Minutes between slots (0 for none)', gapIn),
      h('div', { class: 'slot-fill-btn' }, fillBtn)),
    fillNote,
    slotRows,
    h('div', { class: 'action-row' }, addSlotBtn, removeSlotBtn));

  // ---- reminder wording
  const en = h('textarea', { rows: 7 });
  en.value = program.reminder?.en || '';
  const es = h('textarea', { rows: 7 });
  es.value = program.reminder?.es || '';

  const error = h('p', { class: 'form-error', role: 'alert' });
  const cancel = h('button', { type: 'button', class: 'btn' }, 'Cancel');
  const save = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save changes');

  const form = h('form', { novalidate: true },
    field('Program name', name),
    h('div', { class: 'field-row' }, field('Date', date), field('Starts', start), field('Ends', end)),
    h('p', { class: 'muted small' }, 'Changing the date or times also moves the date when names and contact details are wiped.'),
    slotted ? slotSet : field('Seats', seats, { hint: 'More seats moves children up from the waitlist. You cannot go below the number already seated.' }),
    collectSet,
    h('details', { class: 'edit-reminders' },
      h('summary', {}, 'Reminder wording for this program'),
      field('Reminder message (English)', en),
      field('Reminder message (Spanish)', es),
      h('p', { class: 'muted small' }, slotted
        ? 'You can use {program} {date} {time} {child} {slot}.'
        : 'You can use {program} {date} {time}.')),
    error,
    h('div', { class: 'dialog-actions' }, cancel, save));

  const dlg = openDialog('Edit program', form);
  dlg.dialog.classList.add('dialog-wide');
  cancel.addEventListener('click', () => dlg.close());
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    error.textContent = '';
    save.disabled = true;
    save.textContent = 'Saving…';
    try {
      const changes = {
        name: name.value,
        date: date.value,
        startTime: start.value,
        endTime: end.value,
        fields: { age: collect.age.checked, caregiver: collect.caregiver.checked, email: collect.email.checked, notes: collect.notes.checked },
        reminder: { en: en.value, es: es.value },
      };
      if (slotted) changes.slots = readSlots();
      else changes.capacity = seats.value;
      const result = await updateProgram(program.id, changes);
      dlg.close();
      toast(result.promoted
        ? `Saved. ${result.promoted} ${result.promoted === 1 ? 'child was' : 'children were'} moved up from the waitlist and need to be contacted.`
        : 'Program saved.', result.promoted ? 'info' : 'ok');
    } catch (e) {
      save.disabled = false;
      save.textContent = 'Save changes';
      if (e?.name === 'UserError') error.textContent = e.message;
      else showError(e);
    }
  });
  name.focus();
}

function minutesBetween(a, b) {
  const m = (t) => { const [h2, m2] = (t || '0:0').split(':').map(Number); return h2 * 60 + m2; };
  return m(b) - m(a);
}
