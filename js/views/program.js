// One program's page (roster programs): header, who to call back, the
// roster, the waitlist, walk-ins, cancelled sign-ups, and close-out.
//
// The page listens to the database live, so when another desk computer
// changes something this page redraws by itself.
//
// Privacy: names and contact details are only ever put on the page with
// h() (which inserts plain text). Nothing is saved in the browser.
import { h, clear, toast, showError, openDialog, confirmDialog, add } from '../ui.js';
import {
  watchProgram, watchSignups, setAttendance, cancelSignup, markContacted, closeOut,
  listVolunteers, setProgramVolunteers, duplicateProgram, deleteProgram,
} from '../data/store.js';
import {
  STATUS, childLabel, formatTime, formatDateLong, computeCounts, followThrough, toDate,
  volunteerLabel, slotLabel, localDateString,
} from '../data/model.js';
import { openSignupForm } from './signup-form.js';
import { createEntry } from './entry-row.js';
import { renderSlotGrid } from './slot-grid.js';

export function renderProgram(container, ctx, programId) {
  let program;           // undefined = still loading, null = not found
  let signups = null;    // null = still loading
  let cancelledOpen = false; // remembers whether the Cancelled box is open
  let loadFailed = false;
  let volunteers = null;     // the volunteer list (names and dogs only); null = still loading
  // The always-open entry boxes. Built once (when the program arrives) and
  // put back on the page after every redraw, so typing is never lost.
  let stripEntry = null;     // above the roster, or above the slot grid
  let cellEntry = null;      // slotted programs: inside the slot being filled
  let openSeat = null;       // slotted programs: { slot, trackId } being filled
  let siblingHeld = false;   // slotted programs: contact kept for a sibling's slot
  let firstFocusDone = false;

  listVolunteers().then((list) => { volunteers = list; draw(); }).catch(() => { volunteers = []; draw(); });

  const stopProgram = watchProgram(programId, (p) => { program = p; draw(); }, onLoadError);
  const stopSignups = watchSignups(programId, (s) => { signups = s; draw(); }, onLoadError);

  function onLoadError(e) {
    loadFailed = true;
    showError(e);
    draw();
  }

  // ------------------------------------------------------------ small helpers

  const languageText = (s) => {
    if (s.language === 'es') return 'Spanish';
    if (s.language === 'other') return s.languageOther || 'Other';
    return 'English';
  };
  const byCreated = (a, b) => (toDate(a.createdAt)?.getTime() || 0) - (toDate(b.createdAt)?.getTime() || 0);

  /** A small table button. `key` lets us put keyboard focus back after a redraw. */
  function rowButton(label, ariaLabel, key, onclick, { pressed, danger } = {}) {
    return h('button', {
      type: 'button',
      class: danger ? 'btn btn-small btn-danger' : 'btn btn-small',
      'aria-label': ariaLabel,
      'aria-pressed': pressed === undefined ? null : String(pressed),
      dataset: { key },
      onclick,
    }, label);
  }

  /** Run a store call; show any error in words. */
  async function attempt(fn) {
    try {
      return await fn();
    } catch (e) {
      showError(e);
      return undefined;
    }
  }

  // ----------------------------------------------------------------- actions

  async function toggleAttendance(s, target) {
    const next = s.status === target ? STATUS.registered : target;
    await attempt(() => setAttendance(programId, s.id, next));
  }

  async function cancelOne(s) {
    const label = childLabel(s);
    const sure = await confirmDialog(
      'Cancel this sign-up?',
      s.status === STATUS.waitlisted
        ? `Take ${label} off the waitlist?`
        : `Cancel the sign-up for ${label}? Their seat goes to the next child on the waitlist, if there is one.`,
      'Cancel sign-up',
      { danger: true });
    if (!sure) return;
    const result = await attempt(() => cancelSignup(programId, s.id));
    if (!result) return;
    if (result.promotedId) {
      toast('A child was moved up from the waitlist. The family needs to be contacted.', 'info');
    } else {
      toast(`${label} is cancelled.`);
    }
  }

  async function removeWalkIn(s) {
    const label = childLabel(s);
    const sure = await confirmDialog(
      'Remove this walk-in?',
      `Remove ${label} from the walk-ins? They will no longer be counted.`,
      'Remove walk-in',
      { danger: true });
    if (!sure) return;
    const result = await attempt(() => cancelSignup(programId, s.id));
    if (result) toast(`${label} is removed.`);
  }

  /** Words for a time slot, such as "10:30 AM to 10:40 AM, Dog 1". */
  function seatWords(seat) {
    const index = (program.tracks || []).findIndex((t) => t.id === seat.trackId);
    const column = (program.tracks || []).length > 1 ? `, ${program.trackLabel || 'Column'} ${index + 1}` : '';
    return slotLabel(program.slots[seat.slot]) + column;
  }

  /** Make the entry boxes the first time the program is known. */
  function ensureEntries() {
    if (stripEntry) return;
    const slotted = program.kind === 'slotted';
    stripEntry = createEntry({
      programId, getProgram: () => program, layout: 'strip',
      title: slotted ? 'Add to the waitlist, or a walk-in without a time slot' : 'Add a child',
    });
    if (slotted) {
      cellEntry = createEntry({
        programId, getProgram: () => program, layout: 'cell',
        onClose: () => { openSeat = null; draw(); },
        onSibling: (held) => { siblingHeld = held; },
      });
    }
  }

  /** Slotted programs: open the entry boxes inside a free time slot. */
  function openSlotEntry(slot, trackId, walkIn = false) {
    openSeat = { slot, trackId };
    cellEntry.open({ seat: openSeat, seatLabel: seatWords(openSeat), walkIn });
    draw();
    cellEntry.focus();
  }

  // ---- admin: duplicate and delete

  function openDuplicate() {
    const name = h('input', { type: 'text', maxLength: 80, value: program.name });
    const date = h('input', { type: 'date', required: true, min: localDateString(new Date()) });
    const carry = h('input', { type: 'checkbox', checked: !!program.recurring });
    const error = h('p', { class: 'form-error', role: 'alert' });
    const cancel = h('button', { type: 'button', class: 'btn' }, 'Cancel');
    const save = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Create the new program');
    name.id = 'dupName'; date.id = 'dupDate'; carry.id = 'dupCarry';
    const canCarry = program.kind === 'roster';
    const form = h('form', { novalidate: true },
      h('p', {}, 'Makes a new program with the same settings on a new date. This one is not changed.'),
      h('div', { class: 'field' }, h('label', { for: 'dupName' }, 'Program name'), name),
      h('div', { class: 'field' }, h('label', { for: 'dupDate' }, 'New date'), date),
      canCarry ? h('div', { class: 'check-row' }, carry,
        h('label', { for: 'dupCarry' }, 'Sign up the same children (everyone on the roster and waitlist now)')) : null,
      canCarry ? h('p', { class: 'muted small' },
        'Children brought along are kept on file until after their last session in the series. This only works while this program still has its names, so do it before the privacy wipe.') : null,
      error,
      h('div', { class: 'dialog-actions' }, cancel, save));
    const dlg = openDialog('Duplicate this program', form);
    cancel.addEventListener('click', () => dlg.close());
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      error.textContent = '';
      save.disabled = true;
      save.textContent = 'Working…';
      try {
        const result = await duplicateProgram(programId, {
          name: name.value, date: date.value, carryRoster: canCarry && carry.checked,
        });
        dlg.close();
        toast(result.carried ? `New program created with ${result.carried} children signed up.` : 'New program created.');
        location.hash = `#/program/${result.id}`;
      } catch (e) {
        save.disabled = false;
        save.textContent = 'Create the new program';
        if (e?.name === 'UserError') error.textContent = e.message;
        else showError(e);
      }
    });
    date.focus();
  }

  async function deleteThisProgram() {
    const sure = await confirmDialog('Delete this program?',
      `Delete "${program.name}"? This cannot be undone.`, 'Delete program', { danger: true });
    if (!sure) return;
    try {
      await deleteProgram(programId);
      toast('Program deleted.');
      location.hash = '#/';
    } catch (e) {
      showError(e);
    }
  }

  // ---- roster programs that track volunteers

  function volunteerSection(closed) {
    const chosen = new Set(program.volunteerIds || []);
    const known = new Map(volunteers.map((v) => [v.id, v]));
    const head = h('h2', { id: 'volHead' }, 'Volunteers');
    if (closed) {
      const names = [...chosen].map((id) => volunteerLabel(known.get(id)));
      return h('section', { 'aria-labelledby': 'volHead' }, head,
        h('p', {}, names.length ? names.join(', ') : 'None recorded.'));
    }
    if (!volunteers.length) {
      return h('section', { 'aria-labelledby': 'volHead' }, head,
        h('p', { class: 'muted' }, 'The volunteer list is empty. The admin can add volunteers under "Volunteers".'));
    }
    return h('section', { 'aria-labelledby': 'volHead' }, head,
      h('ul', { class: 'plain volunteer-checks' }, volunteers.map((v) => {
        const box = h('input', { type: 'checkbox', id: `vol-${v.id}`, checked: chosen.has(v.id), dataset: { key: `vol-${v.id}` } });
        box.addEventListener('change', () => {
          const next = new Set(program.volunteerIds || []);
          if (box.checked) next.add(v.id); else next.delete(v.id);
          attempt(() => setProgramVolunteers(programId, [...next]));
        });
        return h('li', { class: 'check-row' }, box, h('label', { for: `vol-${v.id}` }, volunteerLabel(v)));
      })));
  }

  function editSignup(s) {
    openSignupForm({ program, getProgram: () => program, existing: s });
  }

  function openCloseOut() {
    // Children still plain "registered" have not been marked either way.
    const unmarked = (signups || []).filter((s) => !s.walkIn && s.status === STATUS.registered).length;
    const inputFor = (label) => {
      const input = h('input', { type: 'number', min: 0, inputMode: 'numeric' });
      const wrap = h('div', { class: 'field' }, h('label', {}, label), input);
      return { input, wrap };
    };
    const kids = inputFor('Children in the room');
    const teens = inputFor('Teens in the room');
    const adults = inputFor('Adults in the room');
    // Connect each label to its input.
    [kids, teens, adults].forEach((f, i) => {
      const id = `headcount${i}`;
      f.input.id = id;
      f.wrap.querySelector('label').setAttribute('for', id);
    });

    const goBack = h('button', { type: 'button', class: 'btn' }, 'Go back');
    const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Close out');
    const form = h('form', { novalidate: true },
      h('p', {}, 'Closing out freezes the numbers for this program. Sign-ups can no longer be changed. Names and contact details are removed automatically later.'),
      unmarked > 0
        ? h('p', { class: 'alert', role: 'alert' },
          `${unmarked} ${unmarked === 1 ? 'child is' : 'children are'} not marked attended or no-show yet. They will be counted as registered but not attended.`)
        : null,
      h('p', { class: 'muted' }, 'Optional: a head count of everyone in the room.'),
      h('div', { class: 'field-row' }, kids.wrap, teens.wrap, adults.wrap),
      h('div', { class: 'dialog-actions' }, goBack, submit));
    const dlg = openDialog('Close out program', form);
    goBack.addEventListener('click', () => dlg.close());
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      submit.disabled = true;
      try {
        await closeOut(programId, {
          children: kids.input.value, teens: teens.input.value, adults: adults.input.value,
        });
        dlg.close();
        toast('Program closed out.');
      } catch (e) {
        submit.disabled = false;
        showError(e);
      }
    });
  }

  // ---------------------------------------------------------------- drawing

  function draw() {
    // Remember what had focus, so a redraw does not drop it. The entry boxes
    // are the same elements before and after, so they can simply be
    // re-focused; buttons are rebuilt, so those are found again by their key.
    const active = container.contains(document.activeElement) ? document.activeElement : null;
    const focusedKey = active?.dataset?.key || null;
    let caret = null;
    try { caret = active && active.selectionStart != null ? [active.selectionStart, active.selectionEnd] : null; } catch (e) { caret = null; }

    const page = build();
    add(clear(container), page);

    if (active && active.isConnected) {
      active.focus();
      try { if (caret) active.setSelectionRange(caret[0], caret[1]); } catch (e) { /* not a text box */ }
    } else if (focusedKey) {
      const again = [...container.querySelectorAll('[data-key]')].find((el) => el.dataset.key === focusedKey);
      again?.focus();
    }

    // On arrival, put the cursor in "first name" so staff can just start typing.
    if (!firstFocusDone && stripEntry && stripEntry.el.isConnected && program.kind !== 'slotted') {
      firstFocusDone = true;
      if (!active || active === container) stripEntry.focus();
    }
  }

  function build() {
    const back = h('a', { href: '#/', class: 'back-link' }, 'Back to programs');

    if (loadFailed && (program === undefined || signups === null)) {
      return h('div', {}, back, h('p', { class: 'alert', role: 'alert' }, 'This program could not be loaded. Check the internet connection and reload the page.'));
    }
    if (program === undefined || signups === null || volunteers === null) {
      return h('div', {}, back, h('p', { class: 'loading' }, 'Loading…'));
    }
    if (program === null) {
      return h('div', {},
        h('p', {}, 'That program was not found. It may have been removed.'),
        h('p', {}, h('a', { href: '#/' }, 'Back to programs')));
    }

    const closed = program.status === 'closed';
    const parts = [header(back, closed)];

    if (program.kind === 'slotted') {
      const flagged = signups.filter((s) => s.needsContact && s.status !== STATUS.cancelled);
      if (!closed && flagged.length) parts.push(contactAlert(flagged));
      if (!closed) {
        ensureEntries();
        // If another desk just took the slot being filled, close the boxes.
        // What was typed is kept and shows again in the next slot opened.
        if (openSeat && (program.seats || {})[`${openSeat.slot}_${openSeat.trackId}`]) {
          openSeat = null;
        }
        if (siblingHeld && !cellEntry.holdsContact()) siblingHeld = false;
        if (siblingHeld && !openSeat) {
          parts.push(h('p', { class: 'alert', role: 'status' },
            'Adding a sibling: click "Add child" in a free time slot. The contact details are already filled in. ',
            h('button', { type: 'button', class: 'btn btn-small', dataset: { key: 'sibling-nevermind' },
              onclick: () => { siblingHeld = false; cellEntry.clearContact(); draw(); } }, 'Never mind')));
        }
      }
      parts.push(renderSlotGrid({
        program, signups, volunteers, ctx, closed,
        entry: closed ? null : { openSeat, el: cellEntry.el },
        helpers: {
          addToSlot: openSlotEntry,
          editSignup, cancelOne, removeWalkIn, toggleAttendance, attempt, languageText,
        },
      }));
      if (!closed) {
        stripEntry.refresh();
        parts.push(stripEntry.el);
      }
      parts.push(countsBox(closed));
      const cancelledSlotted = signups.filter((s) => s.status === STATUS.cancelled).sort(byCreated);
      if (cancelledSlotted.length) parts.push(cancelledSection(cancelledSlotted));
      return h('div', { class: 'program-page' }, parts);
    }

    // Roster program.
    const rosterRows = signups
      .filter((s) => !s.walkIn && [STATUS.registered, STATUS.attended, STATUS.noShow].includes(s.status))
      .sort(byCreated);
    const walkIns = signups.filter((s) => s.walkIn && s.status === STATUS.attended).sort(byCreated);
    const cancelled = signups.filter((s) => s.status === STATUS.cancelled).sort(byCreated);
    const waitRows = waitlistOrder();
    const toContact = signups.filter((s) => s.needsContact && s.status !== STATUS.cancelled);

    if (!closed && toContact.length) parts.push(contactAlert(toContact));
    if (!closed) {
      ensureEntries();
      stripEntry.refresh();
      parts.push(stripEntry.el);
    }
    parts.push(rosterSection(rosterRows, closed));
    if (program.volunteers) parts.push(volunteerSection(closed));
    if (!closed || waitRows.length) parts.push(waitlistSection(waitRows, closed));
    if (!closed || walkIns.length) parts.push(walkInSection(walkIns, closed));
    if (cancelled.length) parts.push(cancelledSection(cancelled));
    parts.push(countsBox(closed));
    return h('div', { class: 'program-page' }, parts);
  }

  function header(back, closed) {
    const waiting = (program.waitlist || []).length;
    const lines = [
      h('p', { class: 'program-when-line' }, `${formatDateLong(program.date)}, ${formatTime(program.startTime)} to ${formatTime(program.endTime)}`),
    ];
    if (program.kind !== 'slotted') {
      lines.push(h('p', { class: 'program-seats-line' },
        `${program.seatsTaken || 0} of ${program.capacity} seats filled`,
        `, ${waiting} on the waitlist`));
    }
    const links = h('div', { class: 'action-row head-links' },
      h('a', { class: 'btn', href: `#/program/${programId}/reminders` }, 'Reminders'),
      ctx.isAdmin ? h('button', { type: 'button', class: 'btn', onclick: openDuplicate }, 'Duplicate for a new date') : null,
      !closed ? h('button', { type: 'button', class: 'btn', onclick: openCloseOut, dataset: { key: 'close-out' } }, 'Close out program') : null,
      ctx.isAdmin && (program.signupTotal || 0) === 0
        ? h('button', { type: 'button', class: 'btn', onclick: deleteThisProgram }, 'Delete program') : null);
    return h('header', { class: 'program-head' },
      back,
      h('div', { class: 'page-head' },
        h('h1', {}, program.name),
        closed ? h('span', { class: 'badge' }, 'Closed out') : null),
      lines,
      links);
  }

  /** Waitlisted sign-ups in the order the program's waitlist says. */
  function waitlistOrder() {
    const waiting = signups.filter((s) => s.status === STATUS.waitlisted);
    const byId = new Map(waiting.map((s) => [s.id, s]));
    const ordered = [];
    for (const id of program.waitlist || []) {
      if (byId.has(id)) { ordered.push(byId.get(id)); byId.delete(id); }
    }
    // Anyone missing from the list (should not happen) goes at the end.
    return ordered.concat([...byId.values()].sort(byCreated));
  }

  function contactAlert(list) {
    return h('section', { class: 'alert', 'aria-labelledby': 'contactHead' },
      h('h2', { id: 'contactHead' }, 'Moved up from the waitlist. Contact these families:'),
      h('ul', { class: 'plain contact-list' }, list.map((s) => h('li', { class: 'contact-item' },
        h('div', {},
          h('strong', {}, childLabel(s)),
          s.caregiverFirst ? ` (caregiver: ${s.caregiverFirst})` : '',
          h('div', {}, [
            s.phone ? `Phone: ${s.phone}` : null,
            s.email ? `Email: ${s.email}` : null,
            `Language: ${languageText(s)}`,
          ].filter(Boolean).join(' · '))),
        rowButton('Mark as contacted', `Mark ${childLabel(s)} as contacted`, `contact-${s.id}`,
          () => attempt(() => markContacted(programId, s.id)))))));
  }

  function countsBox(closed) {
    const c = closed && program.stats ? program.stats : computeCounts(signups, program);
    const items = [
      ['Registered', c.registered], ['Attended', c.attended], ['No-shows', c.noShows],
      ['Cancelled', c.cancelled], ['Waitlisted', c.waitlisted], ['Walk-ins', c.walkIns],
      ['Total attendance', c.totalAttendance],
    ];
    const box = h('section', { class: 'card counts', 'aria-labelledby': 'countsHead' },
      h('h2', { id: 'countsHead' }, closed ? 'Final numbers' : 'Counts so far'),
      h('dl', { class: 'count-list' }, items.map(([label, n]) =>
        h('div', { class: 'count-item' }, h('dt', {}, label), h('dd', {}, String(n ?? 0))))));
    if (closed) {
      const ft = followThrough(c);
      const hc = program.headcount;
      add(box,
        h('p', {}, `Follow-through rate (attended out of registered): ${ft == null ? 'n/a' : `${Math.round(ft * 100)}%`}`));
      if (hc) {
        const show = (v) => (v == null ? 'not entered' : String(v));
        add(box, h('p', {}, `Head count in the room: children ${show(hc.children)}, teens ${show(hc.teens)}, adults ${show(hc.adults)}`));
      }
      add(box, h('p', { class: 'muted small' }, 'This program is closed out. These numbers are frozen.'));
    }
    return box;
  }

  // ---- tables

  /** Build a table. columns: [{ head, show, cell(row, index) }] */
  function table(labelId, rows, columns) {
    const cols = columns.filter((c) => c.show !== false);
    return h('div', { class: 'table-wrap' },
      h('table', { 'aria-labelledby': labelId },
        h('thead', {}, h('tr', {}, cols.map((c) => h('th', { scope: 'col' }, c.head)))),
        h('tbody', {}, rows.map((row, i) => h('tr', {}, cols.map((c) => h('td', {}, c.cell(row, i))))))));
  }

  function contactColumns() {
    const f = program.fields || {};
    return [
      { head: 'Child', cell: (s) => h('strong', {}, childLabel(s)) },
      { head: 'Age', show: !!f.age, cell: (s) => (s.age == null ? '' : String(s.age)) },
      { head: 'Caregiver', show: !!f.caregiver, cell: (s) => s.caregiverFirst || '' },
      { head: 'Phone', cell: (s) => h('span', { class: 'nowrap' }, s.phone || '') },
      { head: 'Email', show: !!f.email, cell: (s) => h('span', { class: 'email-cell' }, s.email || '') },
      { head: 'Language', cell: (s) => languageText(s) },
      { head: 'Notes', show: !!f.notes, cell: (s) => s.notes || '' },
    ];
  }

  const numberColumn = { head: '#', cell: (s, i) => String(i + 1) };

  function statusBadge(s) {
    if (s.status === STATUS.attended) return h('span', { class: 'badge badge-ok' }, 'Attended');
    if (s.status === STATUS.noShow) return h('span', { class: 'badge badge-warn' }, 'No-show');
    return h('span', { class: 'badge' }, 'Registered');
  }

  function rosterSection(rows, closed) {
    const label = (s) => childLabel(s);
    const columns = [
      numberColumn,
      ...contactColumns(),
      { head: 'Status', cell: statusBadge },
      {
        head: 'Actions',
        show: !closed,
        cell: (s) => h('div', { class: 'row-actions' },
          rowButton('Attended', `Mark ${label(s)} attended`, `att-${s.id}`,
            () => toggleAttendance(s, STATUS.attended), { pressed: s.status === STATUS.attended }),
          rowButton('No-show', `Mark ${label(s)} no-show`, `ns-${s.id}`,
            () => toggleAttendance(s, STATUS.noShow), { pressed: s.status === STATUS.noShow }),
          rowButton('Edit', `Edit ${label(s)}`, `edit-${s.id}`, () => editSignup(s)),
          rowButton('Cancel', `Cancel sign-up for ${label(s)}`, `cancel-${s.id}`, () => cancelOne(s))),
      },
    ];
    return h('section', { 'aria-labelledby': 'rosterHead' },
      h('h2', { id: 'rosterHead' }, `Roster (${rows.length})`),
      rows.length ? table('rosterHead', rows, columns) : h('p', { class: 'muted' }, 'Nobody is signed up yet.'));
  }

  function waitlistSection(rows, closed) {
    const columns = [
      numberColumn,
      ...contactColumns(),
      {
        head: 'Actions',
        show: !closed,
        cell: (s) => h('div', { class: 'row-actions' },
          rowButton('Edit', `Edit ${childLabel(s)}`, `edit-${s.id}`, () => editSignup(s)),
          rowButton('Cancel', `Cancel sign-up for ${childLabel(s)}`, `cancel-${s.id}`, () => cancelOne(s))),
      },
    ];
    return h('section', { 'aria-labelledby': 'waitHead' },
      h('h2', { id: 'waitHead' }, `Waitlist (${rows.length})`),
      rows.length ? table('waitHead', rows, columns) : h('p', { class: 'muted' }, 'Nobody is on the waitlist.'));
  }

  function walkInSection(rows, closed) {
    const f = program.fields || {};
    const columns = [
      { head: 'Child', cell: (s) => h('strong', {}, childLabel(s)) },
      { head: 'Age', show: !!f.age, cell: (s) => (s.age == null ? '' : String(s.age)) },
      { head: 'Notes', show: !!f.notes, cell: (s) => s.notes || '' },
      {
        head: 'Actions',
        show: !closed,
        cell: (s) => rowButton('Remove', `Remove walk-in ${childLabel(s)}`, `rm-${s.id}`, () => removeWalkIn(s)),
      },
    ];
    return h('section', { 'aria-labelledby': 'walkHead' },
      h('h2', { id: 'walkHead' }, `Walk-ins (${rows.length})`),
      rows.length ? table('walkHead', rows, columns) : h('p', { class: 'muted' }, 'No walk-ins yet.'));
  }

  function cancelledSection(rows) {
    const details = h('details', { class: 'cancelled-box' },
      h('summary', {}, `Cancelled (${rows.length})`),
      h('ul', { class: 'plain cancelled-list' }, rows.map((s) =>
        h('li', {}, childLabel(s), s.walkIn ? ' (walk-in)' : ''))));
    details.open = cancelledOpen;
    details.addEventListener('toggle', () => { cancelledOpen = details.open; });
    return details;
  }

  // First draw (shows "Loading" until the data arrives).
  draw();

  return function cleanup() {
    stopProgram();
    stopSignups();
  };
}
