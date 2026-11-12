// The always-open entry boxes: type a child straight in, press Enter.
// No pop-up, no Save button to find, nothing to dismiss afterwards.
//
// Used in two shapes:
//   'strip'  a row of boxes above a roster (or above a slot grid, for the
//            waitlist and for walk-ins without a slot)
//   'cell'   a small stack of boxes inside one empty time slot
//
// The page around it is redrawn whenever the data changes, but this piece is
// built ONCE and put back in place each time, so whatever is being typed
// survives the redraw.
//
// Privacy: what is typed goes only to addSignup() in the data layer.
import { h, toast, showError, field, setFieldError } from '../ui.js';
import { addSignup } from '../data/store.js';
import { cleanSignupInput, childLabel } from '../data/model.js';

/**
 * options:
 *   programId   the program being added to
 *   getProgram  returns the newest copy of the program
 *   layout      'strip' or 'cell'
 *   title       heading for the strip
 *   onClose     cell only: called when the boxes should close
 *   onSibling   cell only: called with true/false when contact details are
 *               being held for a sibling (so the page can say "pick a slot")
 *
 * Returns { el, open({ seat, seatLabel, walkIn }), focus(), holdsContact(), clearContact() }.
 */
export function createEntry({ programId, getProgram, layout = 'strip', title, onClose, onSibling }) {
  const program = getProgram();
  const fields = program.fields || {};
  const cell = layout === 'cell';
  const uid = Math.random().toString(36).slice(2, 8);
  let seat = null; // { slot, trackId } for a time-slot booking

  const input = (props) => h('input', { autocomplete: 'off', ...props });
  const childFirst = input({ type: 'text', maxLength: 30, dataset: { key: `entry-first-${uid}` } });
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
  f.first.classList.add('entry-grow');
  f.caregiver.classList.add('entry-grow');
  f.phone.classList.add('entry-grow');
  f.email.classList.add('entry-grow2');
  f.notes.classList.add('entry-grow2');
  f.languageOther.hidden = true;
  language.addEventListener('change', () => { f.languageOther.hidden = language.value !== 'other'; });

  const seatLine = h('p', { class: 'entry-seat' });
  const notice = h('p', { class: 'entry-notice', role: 'status' });
  const formError = h('p', { class: 'form-error', role: 'alert' });
  const addBtn = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Add');
  const siblingBtn = h('button', { type: 'button', class: 'btn', title: 'Shortcut: Ctrl+Enter' }, 'Add, then a sibling');
  const clearBtn = h('button', { type: 'button', class: 'btn' }, cell ? 'Close' : 'Clear');
  const walkInRow = h('div', { class: 'check-row entry-walkin' }, walkIn,
    h('label', { for: `entry-walkin-${uid}` }, 'Walk-in (here today, did not sign up ahead)'));

  const boxes = [f.first, f.initial];
  if (fields.age) boxes.push(f.age);
  if (fields.caregiver) boxes.push(f.caregiver);
  boxes.push(f.phone);
  if (fields.email) boxes.push(f.email);
  boxes.push(f.language, f.languageOther);
  if (fields.notes) boxes.push(f.notes);

  const form = h('form', { class: cell ? 'entry entry-cell' : 'entry entry-strip card', novalidate: true },
    cell ? seatLine : h('h2', { class: 'entry-title' }, title || 'Add a child'),
    h('div', { class: 'entry-boxes' }, boxes),
    walkInRow,
    notice,
    formError,
    h('div', { class: 'entry-actions' }, addBtn, siblingBtn, clearBtn),
    cell ? null : h('p', { class: 'muted small entry-hint' },
      'Press Enter to add. Ctrl+Enter adds and keeps the contact details for a sibling.'));

  // ---- small helpers

  function refreshNotice() {
    const p = getProgram() || program;
    addBtn.textContent = walkIn.checked ? 'Add walk-in' : 'Add';
    siblingBtn.hidden = walkIn.checked;
    let text = '';
    if (!walkIn.checked) {
      if (p.kind === 'slotted' && !seat) text = 'No time slot: this child goes on the waitlist.';
      else if (p.kind !== 'slotted' && (p.seatsTaken || 0) >= (p.capacity || 0)) text = 'This program is full: this child goes on the waitlist.';
    } else if (p.kind === 'slotted' && !seat) {
      text = 'Walk-in without a time slot. To seat a walk-in, use "Walk-in" in an empty slot.';
    } else {
      text = 'Only the first name is needed for a walk-in.';
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

    // Empty the boxes straight away and hand the cursor back.
    const name = childLabel(data);
    clearChild();
    if (!keepContact) clearContact();
    if (cell) {
      onSibling?.(keepContact && holdsContact());
      onClose?.();
    } else {
      childFirst.focus();
    }

    queue = queue.then(async () => {
      try {
        const result = await addSignup(programId, typed);
        if (data.walkIn) toast(`${name} is added as a walk-in.`);
        else if (result.status === 'waitlisted') toast(`${name} is on the waitlist (number ${result.waitlistPosition}).`);
        else toast(`${name} is registered.`);
      } catch (e) {
        // Rare (for example the slot was taken a second ago). Say so plainly
        // and, if the boxes are still empty, put back what was typed.
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
        refreshNotice();
      }
    });
  }

  form.addEventListener('submit', (ev) => { ev.preventDefault(); submit(false); });
  siblingBtn.addEventListener('click', () => submit(true));
  form.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      if (!walkIn.checked) submit(true);
      else submit(false);
    } else if (ev.key === 'Escape' && cell) {
      ev.preventDefault();
      onClose?.();
    }
  });
  clearBtn.addEventListener('click', () => {
    clearErrors();
    if (cell) {
      onClose?.();
    } else {
      clearChild();
      clearContact();
      walkIn.checked = false;
      refreshNotice();
      childFirst.focus();
    }
  });

  refreshNotice();

  return {
    el: form,
    /** Point the boxes at a time slot (cell layout) and/or switch walk-in on or off. */
    open({ seat: newSeat = null, seatLabel = '', walkIn: asWalkIn = false } = {}) {
      seat = newSeat;
      seatLine.textContent = seatLabel;
      walkIn.checked = !!asWalkIn;
      clearErrors();
      refreshNotice();
    },
    focus() { childFirst.focus(); },
    refresh: refreshNotice,
    holdsContact,
    clearContact,
  };
}
