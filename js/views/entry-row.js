// The always-open entry row: type a child straight in, press Enter.
// No pop-up, no Save button to find, nothing to dismiss afterwards.
//
// Roster programs: the row sits above the roster.
// Time-slot programs: the same row sits above the grid, with one extra box
// in front, "Time slot". It fills itself in with the next free slot and
// moves on after each child, so booking children in order is all typing.
//
// The page around it is redrawn whenever the data changes, but this row is
// built ONCE and put back in place each time, so whatever is being typed
// survives the redraw.
//
// Privacy: what is typed goes only to addSignup() in the data layer.
import { h, toast, showError, field, setFieldError } from '../ui.js';
import { addSignup } from '../data/store.js';
import { cleanSignupInput, childLabel, formatTime, seatKey } from '../data/model.js';

const NO_SLOT = ''; // the "no time slot" choice in the Time slot box

/**
 * options:
 *   programId     the program being added to
 *   getProgram    returns the newest copy of the program
 *   title         heading for the row
 *   onSeatChange  time-slot programs: called when the chosen slot changes,
 *                 so the page can mark it in the grid
 *
 * Returns { el, focus(), refresh(), selectSeat(slot, trackId, walkIn), selectedSeat() }.
 */
export function createEntry({ programId, getProgram, title, onSeatChange }) {
  const program = getProgram();
  const fields = program.fields || {};
  const slotted = program.kind === 'slotted';
  const uid = Math.random().toString(36).slice(2, 8);

  const input = (props) => h('input', { autocomplete: 'off', ...props });
  const seatSelect = h('select', {});
  const childFirst = input({ type: 'text', maxLength: 30 });
  const childInitial = input({ type: 'text', maxLength: 1, class: 'entry-initial' });
  childInitial.addEventListener('input', () => { childInitial.value = childInitial.value.toUpperCase(); });
  const age = input({ type: 'number', min: 0, max: 18, inputMode: 'numeric', class: 'entry-age' });
  const caregiverFirst = input({ type: 'text', maxLength: 30 });
  const phone = input({ type: 'tel', maxLength: 30 });
  const email = input({ type: 'email', maxLength: 120 });
  const language = h('select', {},
    h('option', { value: 'en' }, 'English'),
    h('option', { value: 'es' }, 'Spanish'),
    h('option', { value: 'other' }, 'Other'));
  const languageOther = input({ type: 'text', maxLength: 30 });
  const notes = input({ type: 'text', maxLength: 300 });
  const walkIn = h('input', { type: 'checkbox', id: `entry-walkin-${uid}` });

  const f = {
    seat: field('Time slot', seatSelect),
    first: field("Child's first name", childFirst),
    initial: field('Last initial', childInitial),
    age: field('Age', age),
    caregiver: field('Caregiver first name', caregiverFirst),
    phone: field('Phone', phone),
    email: field('Email', email),
    language: field('Language', language),
    languageOther: field('Which language?', languageOther),
    notes: field('Notes', notes),
  };
  f.seat.classList.add('entry-seat-field');
  f.first.classList.add('entry-grow');
  f.caregiver.classList.add('entry-grow');
  f.phone.classList.add('entry-grow');
  f.email.classList.add('entry-grow2');
  f.notes.classList.add('entry-grow2');
  f.languageOther.hidden = true;
  language.addEventListener('change', () => { f.languageOther.hidden = language.value !== 'other'; });

  const notice = h('p', { class: 'entry-notice', role: 'status' });
  const formError = h('p', { class: 'form-error', role: 'alert' });
  const addBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Add');
  const siblingBtn = h('button', { type: 'button', class: 'btn', title: 'Shortcut: Ctrl+Enter' }, 'Add, then a sibling');
  const clearBtn = h('button', { type: 'button', class: 'btn' }, 'Clear');
  const walkInRow = h('div', { class: 'check-row entry-walkin' }, walkIn,
    h('label', { for: `entry-walkin-${uid}` }, 'Walk-in (here today, did not sign up ahead)'));

  const boxes = [];
  if (slotted) boxes.push(f.seat);
  boxes.push(f.first, f.initial);
  if (fields.age) boxes.push(f.age);
  if (fields.caregiver) boxes.push(f.caregiver);
  boxes.push(f.phone);
  if (fields.email) boxes.push(f.email);
  boxes.push(f.language, f.languageOther);
  if (fields.notes) boxes.push(f.notes);

  const form = h('form', { class: 'entry entry-strip card', novalidate: true },
    h('h2', { class: 'entry-title' }, title || 'Add a child'),
    h('div', { class: 'entry-boxes' }, boxes),
    walkInRow,
    notice,
    formError,
    h('div', { class: 'entry-actions' }, addBtn, siblingBtn, clearBtn),
    h('p', { class: 'muted small entry-hint' },
      slotted
        ? 'Press Enter to add. The time slot moves to the next free one by itself. Ctrl+Enter adds and keeps the contact details for a sibling.'
        : 'Press Enter to add. Ctrl+Enter adds and keeps the contact details for a sibling.'));

  // ---- time slots (time-slot programs only)

  // Slots just sent to be saved. They count as taken straight away, so the
  // Time slot box can move on before the save has come back.
  const pending = new Set();

  /** Free slots, in time order, on columns whose volunteer has not called out. */
  function freeSeats(p) {
    const tracks = p.tracks || [];
    const list = [];
    (p.slots || []).forEach((slot, i) => {
      tracks.forEach((track, t) => {
        const key = seatKey(i, track.id);
        if (track.status === 'calledOut' || (p.seats || {})[key] || pending.has(key)) return;
        const column = tracks.length > 1 ? `, ${p.trackLabel || 'Column'} ${t + 1}` : '';
        list.push({ value: `${i}|${track.id}`, words: `${formatTime(slot.start)}${column}` });
      });
    });
    return list;
  }

  /** Rebuild the Time slot choices. Keeps the current choice if it is still free. */
  function refreshSeats(preferred) {
    if (!slotted) return;
    const p = getProgram() || program;
    for (const key of [...pending]) if ((p.seats || {})[key]) pending.delete(key);
    const free = freeSeats(p);
    const before = seatSelect.value;
    const wanted = preferred !== undefined ? preferred : before;
    seatSelect.replaceChildren(
      ...free.map((s) => h('option', { value: s.value }, s.words)),
      h('option', { value: NO_SLOT }, free.length ? 'No time slot (waitlist)' : 'No free slots (waitlist)'));
    const firstTime = !seatSelect.dataset.ready;
    seatSelect.dataset.ready = '1';
    if (!firstTime && wanted === NO_SLOT && preferred === undefined) seatSelect.value = NO_SLOT;
    else if (free.some((s) => s.value === wanted)) seatSelect.value = wanted;
    else seatSelect.value = free.length ? free[0].value : NO_SLOT;
    if (seatSelect.value !== before) onSeatChange?.();
  }

  function currentSeat() {
    if (!slotted || seatSelect.value === NO_SLOT) return null;
    const [slot, trackId] = seatSelect.value.split('|');
    return { slot: Number(slot), trackId };
  }
  seatSelect.addEventListener('change', () => { refreshNotice(); onSeatChange?.(); });

  // ---- small helpers

  function refreshNotice() {
    const p = getProgram() || program;
    addBtn.textContent = walkIn.checked ? 'Add walk-in' : 'Add';
    siblingBtn.hidden = walkIn.checked;
    const seat = currentSeat();
    let text = '';
    if (walkIn.checked) {
      text = slotted && !seat
        ? 'Walk-in without a time slot. Only the first name is needed.'
        : 'Only the first name is needed for a walk-in.';
    } else if (slotted && !seat) {
      text = 'No time slot: this child goes on the waitlist.';
    } else if (!slotted && (p.seatsTaken || 0) >= (p.capacity || 0)) {
      text = 'This program is full: this child goes on the waitlist.';
    }
    notice.textContent = text;
  }
  walkIn.addEventListener('change', refreshNotice);

  function clearChild() {
    childFirst.value = '';
    childInitial.value = '';
    age.value = '';
    notes.value = '';
  }
  function clearContact() {
    caregiverFirst.value = '';
    phone.value = '';
    email.value = '';
    language.value = 'en';
    languageOther.value = '';
    f.languageOther.hidden = true;
  }
  function clearErrors() {
    formError.textContent = '';
    for (const c of [childFirst, childInitial, age, phone, email]) setFieldError(c, '');
  }
  const holdsContact = () => !!(caregiverFirst.value || phone.value || email.value);

  // Saves run one after another in the background, so staff can start typing
  // the next child the moment they press Enter.
  let queue = Promise.resolve();

  function submit(keepContact) {
    clearErrors();
    const p = getProgram() || program;
    const seat = currentSeat();
    const typed = {
      childFirst: childFirst.value,
      childInitial: childInitial.value,
      age: age.value,
      caregiverFirst: caregiverFirst.value,
      phone: phone.value,
      email: email.value,
      language: language.value,
      languageOther: languageOther.value,
      notes: notes.value,
      walkIn: walkIn.checked,
      slot: seat ? seat.slot : null,
      trackId: seat ? seat.trackId : null,
    };
    const { data, errors } = cleanSignupInput(typed, p);
    const checks = [['childFirst', childFirst], ['childInitial', childInitial], ['age', age], ['contact', phone], ['email', email]];
    let firstBad = null;
    for (const [key, control] of checks) {
      setFieldError(control, errors[key] || '');
      if (errors[key] && !firstBad) firstBad = control;
    }
    if (firstBad) {
      firstBad.focus();
      return;
    }

    // Empty the boxes straight away, move to the next free slot, and hand
    // the cursor back.
    const name = childLabel(data);
    const key = seat ? seatKey(seat.slot, seat.trackId) : null;
    const where = seat ? seatSelect.selectedOptions[0]?.textContent || '' : '';
    if (key) pending.add(key);
    clearChild();
    if (!keepContact) clearContact();
    refreshSeats();
    refreshNotice();
    childFirst.focus();

    queue = queue.then(async () => {
      try {
        const result = await addSignup(programId, typed);
        if (data.walkIn) toast(`${name} is added as a walk-in${where ? ` at ${where}` : ''}.`);
        else if (result.status === 'waitlisted') toast(`${name} is on the waitlist (number ${result.waitlistPosition}).`);
        else toast(where ? `${name} is booked for ${where}.` : `${name} is registered.`);
      } catch (e) {
        // Rare (for example the slot was taken a second ago). Say so plainly
        // and, if the boxes are still empty, put back what was typed.
        if (key) pending.delete(key);
        if (!childFirst.value && !childInitial.value) {
          childFirst.value = typed.childFirst;
          childInitial.value = typed.childInitial;
          age.value = typed.age;
          notes.value = typed.notes;
          if (!holdsContact()) {
            caregiverFirst.value = typed.caregiverFirst;
            phone.value = typed.phone;
            email.value = typed.email;
            language.value = typed.language;
            languageOther.value = typed.languageOther;
            f.languageOther.hidden = language.value !== 'other';
          }
        }
        if (e?.name === 'UserError') {
          formError.textContent = `${name} was NOT added. ${e.message}`;
          toast(`${name} was NOT added. ${e.message}`, 'error');
        } else {
          formError.textContent = `${name} was NOT added. Try again.`;
          showError(e);
        }
      } finally {
        refreshSeats();
        refreshNotice();
      }
    });
  }

  form.addEventListener('submit', (ev) => { ev.preventDefault(); submit(false); });
  siblingBtn.addEventListener('click', () => submit(true));
  form.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      submit(!walkIn.checked);
    }
  });
  clearBtn.addEventListener('click', () => {
    clearErrors();
    clearChild();
    clearContact();
    walkIn.checked = false;
    refreshSeats();
    refreshNotice();
    childFirst.focus();
  });

  refreshSeats();
  refreshNotice();

  return {
    el: form,
    focus() { childFirst.focus(); },
    /** Call after the program data changes. */
    refresh() { refreshSeats(); refreshNotice(); },
    /** Time-slot programs: choose a slot (from a click in the grid). */
    selectSeat(slot, trackId, asWalkIn = false) {
      walkIn.checked = !!asWalkIn;
      refreshSeats(`${slot}|${trackId}`);
      refreshNotice();
      onSeatChange?.();
      form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      childFirst.focus();
    },
    /** Time-slot programs: the slot the next child will go into, or null. */
    selectedSeat: currentSeat,
  };
}
