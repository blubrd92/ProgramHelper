// The time-slot grid for slotted programs (for example "Read to a Dog").
//
// One row per time slot, one column per "track" (one volunteer team, such as
// a handler and a dog). Also draws the called-out warning, the waitlist, and
// the walk-ins who have no time slot.
//
// program.js calls renderSlotGrid() again after EVERY data change, so this
// file keeps nothing in the page between draws. It builds everything fresh
// from the arguments it is given and returns one element.
//
// Privacy: names and contact details are only put on the page with h()
// (which inserts plain text). Nothing is saved in the browser.
import { h, toast, openDialog, field, add } from '../ui.js';
import { addTrack, removeTrack, setTrack, moveSignup } from '../data/store.js';
import { STATUS, childLabel, slotLabel, volunteerLabel, seatKey, toDate } from '../data/model.js';

const MAX_TRACKS = 4; // the store also enforces this
const STATUS_WORDS = { scheduled: 'Scheduled', confirmed: 'Confirmed', calledOut: 'Called out' };

export function renderSlotGrid({ program, signups, volunteers, closed, helpers, selectedSeat }) {
  const tracks = program.tracks || [];
  const slots = program.slots || [];
  const fields = program.fields || {};
  const trackWord = program.trackLabel || 'Column';
  const byId = new Map(signups.map((s) => [s.id, s]));
  const volById = new Map((volunteers || []).map((v) => [v.id, v]));
  const createdTime = (s) => toDate(s.createdAt)?.getTime() || 0;

  // ------------------------------------------------------------ small helpers

  const trackTitle = (track) => `${trackWord} ${tracks.indexOf(track) + 1}`;
  const volunteerText = (track) => {
    if (!track.volunteerId) return 'Not assigned';
    return volunteerLabel(volById.get(track.volunteerId));
  };
  /** Who a called-out column belongs to, in words. */
  const trackWho = (track) => (track.volunteerId ? volunteerText(track) : trackTitle(track));
  const isCalledOut = (track) => track.status === 'calledOut';

  /** The signup sitting in a seat, or undefined. */
  const seatId = (slotIndex, track) => (program.seats || {})[seatKey(slotIndex, track.id)];

  /** A small button. `key` lets program.js put keyboard focus back after a redraw. */
  function btn(label, ariaLabel, key, onclick, { pressed, danger, big } = {}) {
    return h('button', {
      type: 'button',
      class: `btn ${big ? 'grid-big-btn' : 'btn-small'}${danger ? ' btn-danger' : ''}`,
      'aria-label': ariaLabel,
      'aria-pressed': pressed === undefined ? null : String(pressed),
      dataset: { key },
      onclick,
    }, label);
  }

  function statusBadge(s) {
    if (s.walkIn) return h('span', { class: 'badge badge-ok' }, 'Walk-in');
    if (s.status === STATUS.attended) return h('span', { class: 'badge badge-ok' }, 'Attended');
    if (s.status === STATUS.noShow) return h('span', { class: 'badge badge-warn' }, 'No-show');
    return h('span', { class: 'badge' }, 'Registered');
  }

  function trackBadge(track) {
    const cls = isCalledOut(track) ? 'badge badge-danger' : track.status === 'confirmed' ? 'badge badge-ok' : 'badge';
    return h('span', { class: cls }, STATUS_WORDS[track.status] || 'Scheduled');
  }

  /** Every free seat on a column that has not called out, as { slot, trackId, words }. */
  function freeSeats() {
    const list = [];
    slots.forEach((slot, i) => {
      tracks.forEach((track) => {
        if (isCalledOut(track) || seatId(i, track)) return;
        const column = tracks.length > 1 ? `, ${trackTitle(track)}` : '';
        list.push({ slot: i, trackId: track.id, words: `${slotLabel(slot)}${column}` });
      });
    });
    return list;
  }

  // -------------------------------------------------------------- move dialog

  /**
   * Pick a free seat for one child. Used for "Move" (already in a slot), and
   * "Give a slot" (waitlist or walk-in with no slot).
   */
  function openMove(s, title, note) {
    const name = childLabel(s);
    const free = freeSeats();
    const goBack = h('button', { type: 'button', class: 'btn' }, 'Go back');
    const body = h('div', {});
    const dlg = openDialog(title, body);
    goBack.addEventListener('click', () => dlg.close());

    if (!free.length) {
      add(body,
        h('p', {}, 'There are no free time slots.'),
        h('div', { class: 'dialog-actions' }, goBack));
      goBack.focus();
      return;
    }

    const select = h('select', {},
      free.map((f) => h('option', { value: `${f.slot}|${f.trackId}` }, f.words)));
    const error = h('p', { class: 'form-error', role: 'alert' });
    const submit = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Move');
    const form = h('form', { novalidate: true },
      note ? h('p', {}, note) : null,
      field('New time', select, { id: `move-seat-${s.id}` }),
      error,
      h('div', { class: 'dialog-actions' }, goBack, submit));
    add(body, form);
    select.focus();

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      error.textContent = '';
      const [slotText, trackId] = select.value.split('|');
      const chosen = free.find((f) => f.slot === Number(slotText) && f.trackId === trackId);
      submit.disabled = true;
      try {
        await moveSignup(program.id, s.id, Number(slotText), trackId);
        dlg.close();
        toast(`${name} moved to ${chosen ? chosen.words : 'the new time'}.`);
      } catch (e) {
        submit.disabled = false;
        if (e?.name === 'UserError') {
          error.textContent = e.message; // keep the dialog open
        } else {
          error.textContent = 'Something went wrong. Nothing was changed. Try again.';
          console.error(e);
        }
      }
    });
  }

  // ------------------------------------------------------------- column heads

  function columnHead(track) {
    const n = tracks.indexOf(track) + 1;
    const cls = isCalledOut(track) ? 'grid-col-head grid-called-out' : 'grid-col-head';
    const title = h('div', { class: 'grid-col-title' }, trackTitle(track));

    if (closed) {
      return h('th', { scope: 'col', class: cls }, title,
        h('div', {}, volunteerText(track)),
        h('div', {}, trackBadge(track)));
    }

    // Volunteer picker.
    const volOptions = [h('option', { value: '' }, 'Not assigned')];
    (volunteers || []).forEach((v) => volOptions.push(
      h('option', { value: v.id, selected: v.id === track.volunteerId }, volunteerLabel(v))));
    if (track.volunteerId && !volById.has(track.volunteerId)) {
      volOptions.push(h('option', { value: track.volunteerId, selected: true }, 'Volunteer no longer on the list'));
    }
    const volSelect = h('select', {
      id: `vol-${track.id}`, dataset: { key: `vol-${track.id}` },
      onchange: (ev) => helpers.attempt(() => setTrack(program.id, track.id, { volunteerId: ev.target.value || null })),
    }, volOptions);

    // Status picker.
    const statusSelect = h('select', {
      id: `status-${track.id}`, dataset: { key: `status-${track.id}` },
      onchange: (ev) => helpers.attempt(() => setTrack(program.id, track.id, { status: ev.target.value })),
    }, Object.entries(STATUS_WORDS).map(([value, words]) =>
      h('option', { value, selected: value === (track.status || 'scheduled') }, words)));

    return h('th', { scope: 'col', class: cls },
      title,
      h('div', { class: 'grid-head-field' },
        h('label', { for: `vol-${track.id}` }, 'Volunteer'), volSelect),
      h('div', { class: 'grid-head-field' },
        h('label', { for: `status-${track.id}` }, 'Status'), statusSelect),
      h('div', {}, trackBadge(track)),
      tracks.length > 1
        ? btn('Remove this column', `Remove ${trackTitle(track)} (column ${n})`, `rmtrack-${track.id}`,
          () => helpers.attempt(() => removeTrack(program.id, track.id)))
        : null);
  }

  // -------------------------------------------------------------------- cells

  function emptyCell(slot, slotIndex, track) {
    const cls = isCalledOut(track) ? 'grid-cell grid-empty grid-called-out' : 'grid-cell grid-empty';
    const where = `${slotLabel(slot)}, ${trackTitle(track)}`;
    if (isCalledOut(track)) return h('td', { class: cls }, h('span', { class: 'grid-note' }, 'Not available'));
    if (closed) return h('td', { class: cls }, h('span', { class: 'muted' }, 'Empty'));
    // The slot the entry row above is pointing at: say so, in words.
    if (selectedSeat && selectedSeat.slot === slotIndex && selectedSeat.trackId === track.id) {
      return h('td', { class: `${cls} grid-next` },
        h('p', { class: 'grid-next-text' }, 'Next child goes here'),
        h('p', { class: 'muted small' }, 'Type in the boxes above and press Enter. Click another free slot to choose a different time.'));
    }
    return h('td', { class: cls },
      btn('Use this slot', `Use the slot at ${where}`, `seat-${slotIndex}-${track.id}`,
        () => helpers.addToSlot(slotIndex, track.id), { big: true }),
      btn('Walk-in here', `Walk-in at ${where}`, `walkin-${slotIndex}-${track.id}`,
        () => helpers.addToSlot(slotIndex, track.id, true)));
  }

  function filledCell(s, track) {
    const name = childLabel(s);
    const cls = isCalledOut(track) ? 'grid-cell grid-filled grid-called-out' : 'grid-cell grid-filled';
    const lines = [h('div', { class: 'grid-child' }, h('strong', {}, name),
      fields.age && s.age != null ? ` (age ${s.age})` : '')];
    if (s.caregiverFirst) lines.push(h('div', {}, `Caregiver: ${s.caregiverFirst}`));
    if (s.phone) lines.push(h('div', {}, `Phone: ${s.phone}`));
    if (s.email) lines.push(h('div', { class: 'email-cell' }, `Email: ${s.email}`));
    lines.push(h('div', {}, `Language: ${helpers.languageText(s)}`));
    if (s.notes) lines.push(h('div', { class: 'grid-notes' }, `Notes: ${s.notes}`));
    lines.push(h('div', {}, statusBadge(s)));

    if (closed) return h('td', { class: cls }, lines);

    const buttons = [];
    if (!s.walkIn) {
      buttons.push(
        btn('Attended', `Mark ${name} attended`, `att-${s.id}`,
          () => helpers.toggleAttendance(s, STATUS.attended), { pressed: s.status === STATUS.attended }),
        btn('No-show', `Mark ${name} no-show`, `ns-${s.id}`,
          () => helpers.toggleAttendance(s, STATUS.noShow), { pressed: s.status === STATUS.noShow }));
    }
    buttons.push(
      btn('Move', `Move ${name} to another time`, `move-${s.id}`,
        () => openMove(s, `Move ${name} to another time`)),
      btn('Edit', `Edit ${name}`, `edit-${s.id}`, () => helpers.editSignup(s)),
      s.walkIn
        ? btn('Remove', `Remove walk-in ${name}`, `rm-${s.id}`, () => helpers.removeWalkIn(s))
        : btn('Cancel', `Cancel sign-up for ${name}`, `cancel-${s.id}`, () => helpers.cancelOne(s)));
    return h('td', { class: cls }, lines, h('div', { class: 'grid-btns' }, buttons));
  }

  function cell(slot, slotIndex, track) {
    const id = seatId(slotIndex, track);
    if (!id) return emptyCell(slot, slotIndex, track);
    const s = byId.get(id);
    if (!s) {
      const cls = isCalledOut(track) ? 'grid-cell grid-called-out' : 'grid-cell';
      return h('td', { class: cls }, h('span', { class: 'grid-note' }, 'Taken'));
    }
    return filledCell(s, track);
  }

  function gridTable() {
    return h('div', { class: 'table-wrap grid-wrap' },
      h('table', { class: 'slot-grid', 'aria-labelledby': 'gridHead' },
        h('thead', {}, h('tr', {},
          h('th', { scope: 'col', class: 'grid-time-head' }, 'Time'),
          tracks.map(columnHead))),
        h('tbody', {}, slots.map((slot, i) => h('tr', {},
          h('th', { scope: 'row', class: 'grid-time' }, slotLabel(slot)),
          tracks.map((track) => cell(slot, i, track)))))));
  }

  // ------------------------------------------------------ called-out warnings

  function calledOutAlerts() {
    const out = [];
    for (const track of tracks.filter(isCalledOut)) {
      const affected = [];
      slots.forEach((slot, i) => {
        const s = byId.get(seatId(i, track));
        if (s) affected.push({ s, slot });
      });
      const who = trackWho(track);
      if (!affected.length) {
        out.push(h('p', { class: 'alert', role: 'alert' }, `${who} has called out. No children are booked with them.`));
        continue;
      }
      out.push(h('section', { class: 'alert grid-callout', role: 'alert' },
        h('p', {}, h('strong', {}, `${who} has called out. These children are affected:`)),
        h('ul', { class: 'plain contact-list' }, affected.map(({ s, slot }) => h('li', { class: 'contact-item' },
          h('div', {},
            h('strong', {}, childLabel(s)), ` at ${slotLabel(slot)}`,
            s.caregiverFirst ? ` (caregiver: ${s.caregiverFirst})` : '',
            h('div', {}, [
              s.phone ? `Phone: ${s.phone}` : null,
              s.email ? `Email: ${s.email}` : null,
              `Language: ${helpers.languageText(s)}`,
            ].filter(Boolean).join(' · '))),
          btn('Move', `Move ${childLabel(s)} to another time`, `alertmove-${s.id}`,
            () => openMove(s, `Move ${childLabel(s)} to another time`)))))));
    }
    return out;
  }

  // ------------------------------------------------------ waitlist & walk-ins

  function listTable(labelId, rows, columns) {
    const cols = columns.filter((c) => c.show !== false);
    return h('div', { class: 'table-wrap' },
      h('table', { 'aria-labelledby': labelId },
        h('thead', {}, h('tr', {}, cols.map((c) => h('th', { scope: 'col' }, c.head)))),
        h('tbody', {}, rows.map((row, i) => h('tr', {}, cols.map((c) => h('td', {}, c.cell(row, i))))))));
  }

  function waitlistSection() {
    // In the order program.waitlist gives; anyone missing goes at the end.
    const waiting = signups.filter((s) => s.status === STATUS.waitlisted);
    const left = new Map(waiting.map((s) => [s.id, s]));
    const rows = [];
    for (const id of program.waitlist || []) {
      if (left.has(id)) { rows.push(left.get(id)); left.delete(id); }
    }
    rows.push(...[...left.values()].sort((a, b) => createdTime(a) - createdTime(b)));
    if (closed && !rows.length) return null;

    const columns = [
      { head: '#', cell: (s, i) => String(i + 1) },
      { head: 'Child', cell: (s) => h('strong', {}, childLabel(s)) },
      { head: 'Age', show: !!fields.age, cell: (s) => (s.age == null ? '' : String(s.age)) },
      { head: 'Caregiver', show: !!fields.caregiver, cell: (s) => s.caregiverFirst || '' },
      { head: 'Phone', cell: (s) => h('span', { class: 'nowrap' }, s.phone || '') },
      { head: 'Email', show: !!fields.email, cell: (s) => h('span', { class: 'email-cell' }, s.email || '') },
      { head: 'Language', cell: (s) => helpers.languageText(s) },
      { head: 'Notes', show: !!fields.notes, cell: (s) => s.notes || '' },
      {
        head: 'Actions',
        show: !closed,
        cell: (s) => h('div', { class: 'row-actions' },
          btn('Give a slot', `Give ${childLabel(s)} a time slot`, `give-${s.id}`,
            () => openMove(s, `Give ${childLabel(s)} a time slot`, 'The family will be flagged as needing contact.')),
          btn('Edit', `Edit ${childLabel(s)}`, `edit-${s.id}`, () => helpers.editSignup(s)),
          btn('Cancel', `Cancel sign-up for ${childLabel(s)}`, `cancel-${s.id}`, () => helpers.cancelOne(s))),
      },
    ];
    return h('section', { 'aria-labelledby': 'waitHead' },
      h('h2', { id: 'waitHead' }, `Waitlist (${rows.length})`),
      rows.length ? listTable('waitHead', rows, columns) : h('p', { class: 'muted' }, 'Nobody is on the waitlist.'));
  }

  function walkInSection() {
    const rows = signups
      .filter((s) => s.walkIn && s.status === STATUS.attended && s.slot == null)
      .sort((a, b) => createdTime(a) - createdTime(b));
    if (closed && !rows.length) return null;

    const columns = [
      { head: 'Child', cell: (s) => h('strong', {}, childLabel(s)) },
      { head: 'Age', show: !!fields.age, cell: (s) => (s.age == null ? '' : String(s.age)) },
      { head: 'Notes', show: !!fields.notes, cell: (s) => s.notes || '' },
      {
        head: 'Actions',
        show: !closed,
        cell: (s) => h('div', { class: 'row-actions' },
          btn('Give a slot', `Give ${childLabel(s)} a time slot`, `give-${s.id}`,
            () => openMove(s, `Give ${childLabel(s)} a time slot`)),
          btn('Remove', `Remove walk-in ${childLabel(s)}`, `rm-${s.id}`, () => helpers.removeWalkIn(s))),
      },
    ];
    return h('section', { 'aria-labelledby': 'walkHead' },
      h('h2', { id: 'walkHead' }, `Walk-ins without a slot (${rows.length})`),
      rows.length ? listTable('walkHead', rows, columns) : h('p', { class: 'muted' }, 'No walk-ins without a slot.'));
  }

  // ------------------------------------------------------------------- build

  const addButton = !closed && tracks.length < MAX_TRACKS
    ? h('div', { class: 'action-row' },
      btn(`Add a ${trackWord.toLowerCase()}`, `Add a ${trackWord.toLowerCase()} to this session`, 'add-track',
        () => helpers.attempt(() => addTrack(program.id)), { big: true }))
    : null;

  return h('div', { class: 'slot-grid-page' },
    h('section', { 'aria-labelledby': 'gridHead' },
      h('h2', { id: 'gridHead' }, 'Time slots'),
      closed ? null : calledOutAlerts(),
      addButton,
      gridTable()),
    waitlistSection(),
    walkInSection());
}
