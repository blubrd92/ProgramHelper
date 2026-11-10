// One program's page (roster programs): header, who to call back, the
// roster, the waitlist, walk-ins, cancelled sign-ups, and close-out.
//
// The page listens to the database live, so when another desk computer
// changes something this page redraws by itself.
//
// Privacy: names and contact details are only ever put on the page with
// h() (which inserts plain text). Nothing is saved in the browser.
import { h, clear, toast, showError, openDialog, confirmDialog } from '../ui.js';
import {
  watchProgram, watchSignups, setAttendance, cancelSignup, markContacted, closeOut,
} from '../data/store.js';
import {
  STATUS, childLabel, formatTime, formatDateLong, computeCounts, followThrough, toDate,
} from '../data/model.js';
import { openSignupForm } from './signup-form.js';

export function renderProgram(container, ctx, programId) {
  let program;           // undefined = still loading, null = not found
  let signups = null;    // null = still loading
  let cancelledOpen = false; // remembers whether the Cancelled box is open
  let loadFailed = false;

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

  function addSignup(walkIn) {
    openSignupForm({ program, getProgram: () => program, walkIn });
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
    // Remember which button had focus, so a redraw does not drop it.
    const focusedKey = container.contains(document.activeElement)
      ? document.activeElement.dataset?.key : null;

    const page = build();
    clear(container).append(page);

    if (focusedKey) {
      const again = [...container.querySelectorAll('[data-key]')].find((el) => el.dataset.key === focusedKey);
      again?.focus();
    }
  }

  function build() {
    const back = h('a', { href: '#/', class: 'back-link' }, 'Back to programs');

    if (loadFailed && (program === undefined || signups === null)) {
      return h('div', {}, back, h('p', { class: 'alert', role: 'alert' }, 'This program could not be loaded. Check the internet connection and reload the page.'));
    }
    if (program === undefined || signups === null) {
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
      parts.push(h('div', { class: 'card' }, 'The time-slot grid for this kind of program is not built yet.'));
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
      parts.push(h('div', { class: 'action-row' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => addSignup(false) }, 'Add sign-up'),
        h('button', { type: 'button', class: 'btn', onclick: () => addSignup(true) }, 'Add walk-in'),
        h('button', { type: 'button', class: 'btn', onclick: openCloseOut }, 'Close out program')));
    }
    parts.push(countsBox(closed));
    parts.push(rosterSection(rosterRows, closed));
    if (!closed || waitRows.length) parts.push(waitlistSection(waitRows, closed));
    if (!closed || walkIns.length) parts.push(walkInSection(walkIns, closed));
    if (cancelled.length) parts.push(cancelledSection(cancelled));
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
    return h('header', { class: 'program-head' },
      back,
      h('div', { class: 'page-head' },
        h('h1', {}, program.name),
        closed ? h('span', { class: 'badge' }, 'Closed out') : null),
      lines);
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
      box.append(
        h('p', {}, `Follow-through rate (attended out of registered): ${ft == null ? 'n/a' : `${Math.round(ft * 100)}%`}`));
      if (hc) {
        const show = (v) => (v == null ? 'not entered' : String(v));
        box.append(h('p', {}, `Head count in the room: children ${show(hc.children)}, teens ${show(hc.teens)}, adults ${show(hc.adults)}`));
      }
      box.append(h('p', { class: 'muted small' }, 'This program is closed out. These numbers are frozen.'));
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
      { head: 'Phone', cell: (s) => s.phone || '' },
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
