// The sign-up form: a pop-up window used to add a child, add a walk-in,
// or edit an existing sign-up.
//
// Privacy: whatever is typed here goes only to the store functions
// (addSignup / updateSignup). It is never kept in the browser, the address
// bar, the console or the page title.
import { h, toast, showError, openDialog, field, setFieldError } from '../ui.js';
import { addSignup, updateSignup } from '../data/store.js';
import { cleanSignupInput, childLabel } from '../data/model.js';

/**
 * Open the form.
 *   program     the program (needed for which fields to show and for validation)
 *   getProgram  optional: a function that returns the newest copy of the
 *               program, so the "program is full" notice stays right when
 *               several children are added in a row
 *   existing    a sign-up to edit (omit for a new one)
 *   prefill     values to start with (used by "same contact")
 *   walkIn      true for a walk-in (only the first name is required)
 *   onSaved     optional: called with { id, status } after a new sign-up is saved
 *   seat        slotted programs: { slot, trackId } of the time slot being booked
 *   seatLabel   slotted programs: words for that slot, shown at the top
 *   onAnother   slotted programs: called with the contact details when staff
 *               choose to add a sibling (they pick the sibling's slot next)
 */
export function openSignupForm({ program, getProgram, existing, prefill, walkIn, onSaved, seat, seatLabel, onAnother }) {
  const isEdit = !!existing;
  const isWalkIn = isEdit ? !!existing.walkIn : !!walkIn;
  const latest = () => (getProgram ? getProgram() : program) || program;
  const title = isEdit ? 'Edit sign-up' : (isWalkIn ? 'Add walk-in' : 'Add sign-up');

  // The window's contents are swapped around inside this box.
  const box = h('div', {});
  const dlg = openDialog(title, box);

  showForm(isEdit ? existing : (prefill || {}));

  // ------------------------------------------------------------ the form
  function showForm(start) {
    const current = latest();
    const fields = current.fields || {};
    const radioName = `lang${Math.random().toString(36).slice(2, 8)}`;

    // --- inputs
    const childFirst = h('input', { type: 'text', maxLength: 30, autocomplete: 'off', value: start.childFirst || '' });
    const childInitial = h('input', {
      type: 'text', maxLength: 1, autocomplete: 'off', class: 'initial-input', value: start.childInitial || '',
    });
    // Capital letters automatically.
    childInitial.addEventListener('input', () => { childInitial.value = childInitial.value.toUpperCase(); });
    const age = h('input', { type: 'number', min: 0, max: 18, inputMode: 'numeric', value: start.age ?? '' });
    const caregiverFirst = h('input', { type: 'text', maxLength: 30, autocomplete: 'off', value: start.caregiverFirst || '' });
    const phone = h('input', { type: 'tel', maxLength: 30, autocomplete: 'off', value: start.phone || '' });
    const email = h('input', { type: 'email', maxLength: 120, autocomplete: 'off', value: start.email || '' });
    const languageOther = h('input', { type: 'text', maxLength: 30, autocomplete: 'off', value: start.languageOther || '' });
    const notes = h('textarea', { maxLength: 300, rows: 3 });
    notes.value = start.notes || '';

    // --- language radio buttons
    const startLang = ['en', 'es', 'other'].includes(start.language) ? start.language : 'en';
    const radios = {};
    const radioRow = (value, label) => {
      const input = h('input', { type: 'radio', name: radioName, value, checked: startLang === value });
      radios[value] = input;
      return h('label', { class: 'radio-label' }, input, ' ', label);
    };
    const languageOtherField = field('Which language?', languageOther);
    const syncOther = () => { languageOtherField.hidden = !radios.other.checked; };
    const languageSet = h('fieldset', { class: 'lang-set' },
      h('legend', {}, 'Language'),
      h('div', { class: 'radio-row' },
        radioRow('en', 'English'), radioRow('es', 'Spanish'), radioRow('other', 'Other')),
      languageOtherField);
    for (const r of Object.values(radios)) r.addEventListener('change', syncOther);
    syncOther();

    // --- field wrappers (field() adds the label and the error spot)
    const firstField = field("Child's first name", childFirst);
    const initialField = field('Last initial', childInitial);
    const ageField = field('Age', age);
    const caregiverField = field('Caregiver first name', caregiverFirst);
    const phoneField = field('Phone', phone);
    const emailField = field('Email', email);
    const notesField = field('Notes', notes);

    // Order matters: this is the Tab order.
    const nameRow = h('div', { class: 'field-row name-row' }, firstField, initialField);
    const parts = [];
    const slotted = latest().kind === 'slotted';
    if (!slotted && !isEdit && !isWalkIn && (latest().seatsTaken || 0) >= (latest().capacity || 0)) {
      parts.push(h('p', { class: 'alert form-notice', role: 'status' }, 'This program is full. This child will go on the waitlist.'));
    }
    if (slotted && !isEdit && seat) {
      parts.push(h('p', { class: 'form-notice' }, h('strong', {}, `Time slot: ${seatLabel || ''}`)));
    }
    if (slotted && !isEdit && !seat && !isWalkIn) {
      parts.push(h('p', { class: 'alert form-notice', role: 'status' }, 'No time slot chosen. This child will go on the waitlist.'));
    }
    if (isWalkIn) {
      parts.push(h('p', { class: 'muted' }, 'Only the first name is needed for a walk-in. The other boxes are optional.'));
    }
    parts.push(nameRow);
    if (fields.age) parts.push(ageField);
    if (fields.caregiver) parts.push(caregiverField);
    parts.push(phoneField);
    if (fields.email) parts.push(emailField);
    parts.push(languageSet);
    if (fields.notes) parts.push(notesField);

    const formError = h('p', { class: 'form-error', role: 'alert' });
    const cancel = h('button', { type: 'button', class: 'btn' }, 'Cancel');
    const save = h('button', { type: 'submit', class: 'btn btn-primary' }, isEdit ? 'Save changes' : 'Save');
    const form = h('form', { novalidate: true }, parts, formError, h('div', { class: 'dialog-actions' }, cancel, save));
    cancel.addEventListener('click', () => dlg.close());

    // Which input goes with which validation message, in Tab order.
    const checks = [
      ['childFirst', childFirst],
      ['childInitial', childInitial],
      ['age', age],
      ['phone', phone],      // the 'contact' error shows next to the phone box
      ['email', email],
    ];
    const errorKeyFor = { phone: 'contact' };

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      formError.textContent = '';

      const input = {
        childFirst: childFirst.value,
        childInitial: childInitial.value,
        age: age.value,
        caregiverFirst: caregiverFirst.value,
        phone: phone.value,
        email: email.value,
        language: radios.es.checked ? 'es' : (radios.other.checked ? 'other' : 'en'),
        languageOther: languageOther.value,
        notes: notes.value,
        walkIn: isWalkIn,
        slot: seat ? seat.slot : null,
        trackId: seat ? seat.trackId : null,
      };

      const { data, errors } = cleanSignupInput(input, latest());
      let firstBad = null;
      for (const [name, control] of checks) {
        const message = errors[errorKeyFor[name] || name] || '';
        setFieldError(control, message);
        if (message && !firstBad) firstBad = control;
      }
      if (firstBad) {
        firstBad.focus();
        return;
      }

      save.disabled = true; // no double submits
      try {
        if (isEdit) {
          await updateSignup(latest().id, existing.id, input);
          dlg.close();
          toast(`Changes to ${childLabel(data)} are saved.`);
        } else {
          const result = await addSignup(latest().id, input);
          if (isWalkIn) {
            dlg.close();
            toast(`${childLabel(data)} is added as a walk-in.`);
          } else {
            let message;
            if (result.status === 'waitlisted') {
              message = `${childLabel(data)} is on the waitlist (number ${result.waitlistPosition}).`;
            } else {
              message = `${childLabel(data)} is registered.`;
            }
            toast(message);
            onSaved?.(result);
            showDone(message, data);
          }
        }
      } catch (e) {
        save.disabled = false;
        if (e?.name === 'UserError') formError.textContent = e.message;
        else showError(e);
      }
    });

    box.replaceChildren(form);
    childFirst.focus();
  }

  // ---------------------------------------------- "saved" screen for siblings
  function showDone(message, data) {
    const another = h('button', { type: 'button', class: 'btn' },
      onAnother ? 'Add a sibling (pick their time slot next)' : 'Add another child with the same contact');
    const done = h('button', { type: 'button', class: 'btn btn-primary' }, 'Done');
    another.addEventListener('click', () => {
      // Keep the contact details; start the child's own boxes empty.
      const contact = {
        caregiverFirst: data.caregiverFirst,
        phone: data.phone,
        email: data.email,
        language: data.language,
        languageOther: data.languageOther,
      };
      if (onAnother) {
        dlg.close();
        onAnother(contact);
      } else {
        showForm(contact);
      }
    });
    done.addEventListener('click', () => dlg.close());
    box.replaceChildren(
      h('p', { class: 'saved-message', role: 'status' }, message),
      h('div', { class: 'dialog-actions' }, another, done));
    done.focus();
  }
}
