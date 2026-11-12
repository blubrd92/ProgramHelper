// Admin screen: list, create, edit, duplicate and delete program templates.
// A template holds the settings for a kind of program. Programs copy the
// template when they are made, so editing a template never changes them.
import { h, clear, toast, showError, openDialog, confirmDialog, field, add } from '../ui.js';
import {
  listTemplates, saveTemplate, deleteTemplate, installStarterTemplates,
} from '../data/store.js';
import { formatTime, generateSlots } from '../data/model.js';
import { STARTER_TEMPLATES } from '../data/starter-templates.js';

const MAX_SLOTS = 12;

export function renderTemplates(container, ctx) {
  let alive = true;
  const body = h('div', { class: 'admin-screen' }, h('p', { class: 'loading' }, 'Loading templates…'));
  add(container, body);

  async function load() {
    try {
      const templates = await listTemplates();
      if (alive) draw(templates);
    } catch (e) {
      showError(e);
    }
  }

  function summary(t) {
    const times = `${formatTime(t.startTime)} to ${formatTime(t.endTime)}`;
    let text;
    if (t.kind === 'slotted') {
      const n = (t.slots || []).length;
      const cols = t.defaultTracks || 1;
      const label = (t.trackLabel || 'column').toLowerCase();
      text = `Time slots: ${n} ${n === 1 ? 'slot' : 'slots'}, ${cols} ${label} ${cols === 1 ? 'column' : 'columns'}, ${times}`;
    } else {
      text = `Roster, ${t.capacity} seats, ${times}`;
    }
    return t.recurring ? `${text}, repeats` : text;
  }

  function draw(templates) {
    add(clear(body),
      h('div', { class: 'page-head' },
        h('h1', {}, 'Templates'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => openEditor(null, null) }, 'New template')),
      h('p', {}, 'A template holds the settings for a kind of program. Changing a template does not change programs that already exist.'),
      templates.length
        ? h('ul', { class: 'plain template-list' }, templates.map(row))
        : h('div', { class: 'card' },
          h('p', {}, 'There are no templates yet.'),
          h('button', { type: 'button', class: 'btn', onclick: addStarters }, 'Add the three starter templates')));
  }

  function row(t) {
    return h('li', { class: 'card template-row' },
      h('div', { class: 'template-info' },
        h('h2', {}, t.name),
        h('p', { class: 'muted' }, summary(t))),
      h('div', { class: 'action-row' },
        h('button', { type: 'button', class: 'btn btn-small', onclick: () => openEditor(t.id, t) }, 'Edit'),
        h('button', {
          type: 'button', class: 'btn btn-small',
          onclick: () => openEditor(null, { ...t, name: `Copy of ${t.name}` }),
        }, 'Duplicate'),
        h('button', { type: 'button', class: 'btn btn-small btn-danger', onclick: () => remove(t) }, 'Delete')));
  }

  async function addStarters() {
    try {
      await installStarterTemplates();
      await load();
    } catch (e) {
      showError(e);
    }
  }

  async function remove(t) {
    const yes = await confirmDialog(
      `Delete "${t.name}"?`,
      'Programs already made from this template are not affected.',
      'Delete template', { danger: true });
    if (!yes) return;
    try {
      await deleteTemplate(t.id);
      toast('Template deleted.');
      await load();
    } catch (e) {
      showError(e);
    }
  }

  // ---------------------------------------------------------- the editor
  // id = null saves a NEW template (used for "New" and "Duplicate").
  // start = the template to prefill from, or null for a brand-new one.
  function openEditor(id, start) {
    const t = start || {};
    const nameIn = h('input', { type: 'text', maxLength: 80, required: true, value: t.name || '' });
    const startIn = h('input', { type: 'time', required: true, value: t.startTime || '15:30' });
    const endIn = h('input', { type: 'time', required: true, value: t.endTime || '16:30' });

    const kindRoster = h('input', { type: 'radio', name: 'tplKind', value: 'roster', id: 'tplKindRoster', checked: t.kind !== 'slotted' });
    const kindSlotted = h('input', { type: 'radio', name: 'tplKind', value: 'slotted', id: 'tplKindSlotted', checked: t.kind === 'slotted' });

    // Roster settings
    const seatsIn = h('input', { type: 'number', min: 1, max: 200, step: 1, value: t.kind === 'slotted' ? 20 : (t.capacity || 20) });
    const rosterBox = h('div', { class: 'kind-box' }, field('Seats', seatsIn));

    // Time-slot settings
    const slotRows = h('div', { class: 'slot-rows' });
    const addSlotBtn = h('button', { type: 'button', class: 'btn', onclick: () => addSlot() }, 'Add a time slot');
    const tracksIn = h('input', { type: 'number', min: 1, max: 4, step: 1, value: t.defaultTracks || 1 });
    const labelIn = h('input', { type: 'text', maxLength: 20, value: t.kind === 'slotted' ? (t.trackLabel || '') : 'Dog' });
    // Fill in the slots from a length, so nobody types every time by hand.
    const lengthIn = h('input', { type: 'number', min: 1, max: 240, step: 1, inputMode: 'numeric', value: 10 });
    const gapIn = h('input', { type: 'number', min: 0, max: 120, step: 1, inputMode: 'numeric', value: 0 });
    const fillBtn = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => fillSlots() }, 'Fill in the slots');
    const fillNote = h('p', { class: 'slot-fill-note', role: 'status' });
    const slottedBox = h('div', { class: 'kind-box' },
      h('fieldset', { class: 'slot-fieldset' },
        h('legend', {}, 'Time slots'),
        h('p', { class: 'muted small' }, 'Quick way: say how long each child gets, and the slots are worked out from the start and end times above. You can still change any slot by hand afterwards.'),
        h('div', { class: 'field-row slot-fill-row' },
          field('Minutes per slot', lengthIn),
          field('Minutes between slots (0 for none)', gapIn),
          h('div', { class: 'slot-fill-btn' }, fillBtn)),
        fillNote,
        slotRows, addSlotBtn),
      h('div', { class: 'field-row' },
        field('Columns to start with (volunteer teams)', tracksIn),
        field('What to call a column', labelIn, { hint: 'For example: Dog' })));

    function fillSlots() {
      const result = generateSlots(startIn.value, endIn.value, lengthIn.value === '' ? NaN : Number(lengthIn.value), gapIn.value === '' ? 0 : Number(gapIn.value));
      fillNote.classList.toggle('form-error', !!result.error);
      if (result.error) {
        fillNote.textContent = `${result.error} The slots below were not changed.`;
        return;
      }
      slotRows.replaceChildren();
      result.slots.forEach((sl) => addSlot(sl.start, sl.end));
      const n = result.slots.length;
      const len = Number(lengthIn.value);
      const gap = gapIn.value === '' ? 0 : Number(gapIn.value);
      let text = `${n} ${n === 1 ? 'slot' : 'slots'} of ${len} ${len === 1 ? 'minute' : 'minutes'}`;
      if (gap > 0) text += `, with ${gap} ${gap === 1 ? 'minute' : 'minutes'} between`;
      text += `, ${formatTime(result.slots[0].start)} to ${formatTime(result.slots[n - 1].end)}.`;
      if (result.unused > 0) text += ` The last ${result.unused} ${result.unused === 1 ? 'minute is' : 'minutes are'} unused.`;
      fillNote.textContent = text;
    }

    function updateSlotButtons() {
      const rows = [...slotRows.children];
      addSlotBtn.disabled = rows.length >= MAX_SLOTS;
      rows.forEach((r, i) => {
        r.querySelector('.slot-remove').setAttribute('aria-label', `Remove time slot ${i + 1}`);
        r.querySelector('.slot-num').textContent = `Slot ${i + 1}`;
      });
    }

    function addSlot(start, end) {
      if (slotRows.children.length >= MAX_SLOTS) return;
      const prev = slotRows.lastElementChild;
      if (start == null) {
        if (prev) {
          // Start where the previous slot ends; keep the same length.
          const ps = prev.querySelector('.slot-start').value;
          const pe = prev.querySelector('.slot-end').value;
          start = pe;
          end = addMinutes(pe, minutesBetween(ps, pe) || 10);
        } else {
          start = startIn.value || '10:30';
          end = addMinutes(start, 10);
        }
      }
      const s = h('input', { type: 'time', class: 'slot-start', value: start });
      const e = h('input', { type: 'time', class: 'slot-end', value: end });
      const sid = `slotS${Math.random().toString(36).slice(2, 8)}`;
      const eid = `slotE${Math.random().toString(36).slice(2, 8)}`;
      s.id = sid; e.id = eid;
      const row = h('div', { class: 'slot-row' },
        h('span', { class: 'slot-num' }, ''),
        h('div', { class: 'field' }, h('label', { for: sid }, 'Starts'), s),
        h('div', { class: 'field' }, h('label', { for: eid }, 'Ends'), e),
        h('button', {
          type: 'button', class: 'btn btn-small slot-remove',
          onclick: () => { row.remove(); updateSlotButtons(); addSlotBtn.focus(); },
        }, 'Remove'));
      add(slotRows, row);
      updateSlotButtons();
    }

    const startSlots = t.kind === 'slotted' && t.slots?.length ? t.slots : [];
    if (startSlots.length) startSlots.forEach((sl) => addSlot(sl.start, sl.end));
    else {
      // A new time-slot template starts with three ten-minute slots.
      addSlot('10:30', '10:40'); addSlot(); addSlot();
    }

    // Information to collect
    const fields = t.fields || { age: true, caregiver: true, email: true, notes: true };
    const checks = {};
    const checkRow = (key, label, checked) => {
      checks[key] = h('input', { type: 'checkbox', id: `tplF${key}`, checked: !!checked });
      return h('div', { class: 'check-row' }, checks[key], h('label', { for: `tplF${key}` }, label));
    };
    const collectSet = h('fieldset', {},
      h('legend', {}, 'Information to collect'),
      checkRow('age', "Child's age", fields.age),
      checkRow('caregiver', 'Caregiver first name', fields.caregiver),
      checkRow('email', 'Email', fields.email),
      checkRow('notes', 'Notes', fields.notes),
      h('p', { class: 'field-hint' }, "The child's first name and last initial, phone number and language are always collected."));

    const volIn = h('input', { type: 'checkbox', id: 'tplVol', checked: !!t.volunteers });
    const volRow = h('div', { class: 'check-row' }, volIn, h('label', { for: 'tplVol' }, 'Track volunteers for this program'));
    const recIn = h('input', { type: 'checkbox', id: 'tplRec', checked: !!t.recurring });
    const recRow = h('div', {},
      h('div', { class: 'check-row' }, recIn, h('label', { for: 'tplRec' }, 'Repeats (for example monthly)')),
      h('p', { class: 'field-hint' }, 'Repeating programs can be duplicated to a new date with the same children.'));

    // Reminder wording. A new template starts from the starter of the same kind.
    const starterFor = (kind) => STARTER_TEMPLATES.find((s) => s.kind === kind) || STARTER_TEMPLATES[0];
    const enIn = h('textarea', { rows: 8, maxLength: 2000 });
    const esIn = h('textarea', { rows: 8, maxLength: 2000 });
    enIn.value = t.reminder?.en ?? starterFor(t.kind === 'slotted' ? 'slotted' : 'roster').reminder.en;
    esIn.value = t.reminder?.es ?? starterFor(t.kind === 'slotted' ? 'slotted' : 'roster').reminder.es;
    // If the admin has not touched the wording, swap it when the kind changes.
    let reminderEdited = !!start;
    enIn.addEventListener('input', () => { reminderEdited = true; });
    esIn.addEventListener('input', () => { reminderEdited = true; });
    const placeholderHint = h('span', { class: 'field-hint' });

    function currentKind() {
      return kindSlotted.checked ? 'slotted' : 'roster';
    }

    function syncKind() {
      const slotted = currentKind() === 'slotted';
      rosterBox.hidden = slotted;
      slottedBox.hidden = !slotted;
      volRow.hidden = slotted;
      placeholderHint.textContent = slotted
        ? 'You can use {program} {date} {time} {child} {slot}. They are filled in when the reminder is made.'
        : 'You can use {program} {date} {time}. They are filled in when the reminder is made.';
      if (!reminderEdited) {
        enIn.value = starterFor(currentKind()).reminder.en;
        esIn.value = starterFor(currentKind()).reminder.es;
      }
    }
    kindRoster.addEventListener('change', syncKind);
    kindSlotted.addEventListener('change', syncKind);

    const errorP = h('p', { class: 'form-error', role: 'alert' });
    const saveBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Save template');
    const cancelBtn = h('button', { type: 'button', class: 'btn' }, 'Cancel');

    const form = h('form', { class: 'template-form', novalidate: true },
      field('Name', nameIn),
      h('fieldset', {},
        h('legend', {}, 'Kind of program'),
        h('div', { class: 'check-row' }, kindRoster, h('label', { for: 'tplKindRoster' }, 'Roster (a numbered list of seats)')),
        h('div', { class: 'check-row' }, kindSlotted, h('label', { for: 'tplKindSlotted' }, 'Time slots (one child per slot, like Read to a Dog)'))),
      h('div', { class: 'field-row' },
        field('Usual start time', startIn),
        field('Usual end time', endIn)),
      rosterBox,
      slottedBox,
      collectSet,
      volRow,
      recRow,
      field('Reminder message (English)', enIn, { hint: null }),
      field('Reminder message (Spanish)', esIn),
      placeholderHint,
      errorP,
      h('div', { class: 'dialog-actions' }, cancelBtn, saveBtn));

    const dlg = openDialog(id ? 'Edit template' : (start ? 'Duplicate template' : 'New template'), form);
    dlg.dialog.classList.add('dialog-wide');
    cancelBtn.addEventListener('click', () => dlg.close());
    syncKind();
    nameIn.focus();

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      errorP.textContent = '';
      const slotted = currentKind() === 'slotted';
      const input = {
        name: nameIn.value,
        kind: currentKind(),
        audience: t.audience || 'children',
        startTime: startIn.value,
        endTime: endIn.value,
        capacity: seatsIn.value,
        slots: [...slotRows.children].map((r) => ({
          start: r.querySelector('.slot-start').value,
          end: r.querySelector('.slot-end').value,
        })),
        defaultTracks: tracksIn.value,
        trackLabel: labelIn.value,
        fields: {
          age: checks.age.checked, caregiver: checks.caregiver.checked,
          email: checks.email.checked, notes: checks.notes.checked,
        },
        volunteers: slotted ? true : volIn.checked,
        recurring: recIn.checked,
        reminder: { en: enIn.value, es: esIn.value },
      };
      saveBtn.disabled = true;
      try {
        await saveTemplate(id, input);
        dlg.close();
        toast('Template saved.');
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

// ------------------------------------------------------------ time helpers
// Times are 'HH:MM' text. These only help pick sensible defaults for new slots.

function minutesBetween(a, b) {
  const [ah, am] = (a || '').split(':').map(Number);
  const [bh, bm] = (b || '').split(':').map(Number);
  if ([ah, am, bh, bm].some((n) => Number.isNaN(n))) return 0;
  return (bh * 60 + bm) - (ah * 60 + am);
}

function addMinutes(t, mins) {
  const [hh, mm] = (t || '00:00').split(':').map(Number);
  const total = Math.min(23 * 60 + 59, (hh || 0) * 60 + (mm || 0) + mins);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
