// Stats page: per-program numbers and totals for a date range.
// It reads PROGRAM documents only (never sign-ups), so it still works after
// children's names have been wiped. All the arithmetic is in data/stats.js.
import { h, clear, showError, field, setFieldError, add } from '../ui.js';
import { listPrograms } from '../data/store.js';
import { localDateString, formatDateLong } from '../data/model.js';
import { programNumbers, totals, ageBreakdown, toCsv } from '../data/stats.js';

const pctText = (r) => (r == null ? 'n/a' : `${Math.round(r * 100)}%`);

/** "9 children, 6 adults"; blank when no head count was recorded. */
function headcountText(hc) {
  const parts = [];
  if (hc.children != null) parts.push(`${hc.children} ${hc.children === 1 ? 'child' : 'children'}`);
  if (hc.teens != null) parts.push(`${hc.teens} ${hc.teens === 1 ? 'teen' : 'teens'}`);
  if (hc.adults != null) parts.push(`${hc.adults} ${hc.adults === 1 ? 'adult' : 'adults'}`);
  return parts.join(', ');
}

export function renderStats(container, ctx) {
  let alive = true;
  let loadId = 0; // so a slow earlier request cannot overwrite a newer one
  let shown = []; // programs currently on screen (used for the CSV)
  let shownRange = null;

  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

  const fromInput = h('input', { type: 'date', required: true, value: localDateString(firstOfMonth) });
  const toInput = h('input', { type: 'date', required: true, value: localDateString(today) });
  const fromField = field('From', fromInput);
  const toField = field('To', toInput);
  const rangeError = h('p', { class: 'form-error', role: 'alert' });

  function setRange(from, to) {
    fromInput.value = localDateString(from);
    toInput.value = localDateString(to);
    show();
  }
  const quick = h('div', { class: 'action-row' },
    h('button', { type: 'button', class: 'btn', onclick: () => setRange(new Date(today.getFullYear(), today.getMonth(), 1), today) }, 'This month'),
    h('button', { type: 'button', class: 'btn', onclick: () => setRange(new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 0)) }, 'Last month'),
    h('button', { type: 'button', class: 'btn', onclick: () => setRange(new Date(today.getFullYear(), 0, 1), today) }, 'This year (since January 1)'));

  const form = h('form', { class: 'card stats-range', novalidate: true, onsubmit: (ev) => { ev.preventDefault(); show(); } },
    h('div', { class: 'field-row' }, fromField, toField,
      h('div', { class: 'field stats-show' }, h('button', { type: 'submit', class: 'btn btn-primary' }, 'Show'))),
    rangeError,
    quick);

  const results = h('div', { class: 'stats-results' });
  add(container, h('div', { class: 'stats' }, h('h1', {}, 'Stats'), form, results));

  async function show() {
    setFieldError(fromInput, '');
    setFieldError(toInput, '');
    rangeError.textContent = '';
    const from = fromInput.value;
    const to = toInput.value;
    if (!from) { setFieldError(fromInput, 'Choose a start date.'); return; }
    if (!to) { setFieldError(toInput, 'Choose an end date.'); return; }
    if (from > to) { rangeError.textContent = 'The "From" date must be on or before the "To" date.'; return; }

    const mine = ++loadId;
    add(clear(results), h('p', { class: 'loading' }, 'Loading stats…'));
    try {
      const programs = await listPrograms(from, to);
      if (!alive || mine !== loadId) return;
      shown = programs;
      shownRange = { from, to };
      draw(programs, from, to);
    } catch (e) {
      if (!alive || mine !== loadId) return;
      add(clear(results), h('p', { class: 'alert', role: 'alert' }, 'The stats could not be loaded. Check the internet connection and press Show to try again.'));
      showError(e);
    }
  }

  function stat(label, value) {
    return h('div', { class: 'stat' }, h('dt', {}, label), h('dd', {}, String(value)));
  }

  function draw(programs, from, to) {
    if (!programs.length) {
      add(clear(results), h('p', { class: 'card muted' }, `No programs between ${formatDateLong(from)} and ${formatDateLong(to)}.`));
      return;
    }
    const t = totals(programs);
    const hcText = headcountText(t.headcount);
    const cancelledText = t.cancelledDayOf ? `${t.cancelled} (${t.cancelledDayOf} on the day)` : String(t.cancelled);

    const totalsCard = h('section', { class: 'card', 'aria-labelledby': 'statsTotalHead' },
      h('h2', { id: 'statsTotalHead' }, `Totals, ${from} to ${to}`),
      h('dl', { class: 'stat-grid' },
        stat('Programs', `${t.programs} (${t.finalCount} closed out)`),
        stat('Registered', t.registered),
        stat('Cancelled', cancelledText),
        stat('Waitlisted', t.waitlisted),
        stat('Attended', t.attended),
        stat('No-shows', t.noShows),
        stat('Walk-ins', t.walkIns),
        stat('Total attendance', t.totalAttendance),
        stat('Follow-through rate', pctText(t.followThrough))),
      hcText ? h('p', {}, `Head count in the room: ${hcText}`) : null,
      h('div', { class: 'definitions' },
        h('p', {}, 'Follow-through rate is attended divided by registered. It counts only children who were still registered when the program started, and it does not count walk-ins. Across several programs it is all attended children divided by all registered children.'),
        h('p', {}, 'Registered: children holding a seat when the program started.'),
        h('p', {}, 'Waitlisted: children still on the waitlist who never got a seat.'),
        h('p', {}, 'Total attendance: attended plus walk-ins.')));

    add(clear(results),
      totalsCard,
      programTable(programs, t),
      agesSection(programs),
      h('div', { class: 'action-row' },
        h('button', { type: 'button', class: 'btn', onclick: download }, 'Download as a spreadsheet (CSV)')));
  }

  function programTable(programs, t) {
    const num = (v) => h('td', { class: 'num' }, String(v));
    const rows = programs.map((p) => {
      const n = programNumbers(p);
      return h('tr', {},
        h('td', {}, p.date),
        h('td', {}, h('a', { href: `#/program/${p.id}` }, p.name),
          n.final ? null : [' ', h('span', { class: 'badge badge-warn' }, 'Not final')]),
        num(n.registered), num(n.cancelled), num(n.waitlisted), num(n.attended), num(n.noShows),
        num(n.walkIns), num(n.totalAttendance),
        h('td', { class: 'num' }, pctText(n.followThrough)),
        h('td', {}, headcountText(n.headcount)));
    });
    const heads = ['Date', 'Program', 'Registered', 'Cancelled', 'Waitlisted', 'Attended', 'No-shows',
      'Walk-ins', 'Total attendance', 'Follow-through', 'Head count'];
    const numeric = new Set(heads.slice(2, 10));
    return h('section', { 'aria-labelledby': 'statsTableHead' },
      h('h2', { id: 'statsTableHead' }, 'Each program'),
      h('div', { class: 'table-wrap' },
        h('table', { class: 'stats-table' },
          h('caption', {}, 'Numbers for each program in the date range'),
          h('thead', {}, h('tr', {}, heads.map((t2) => h('th', { scope: 'col', class: numeric.has(t2) ? 'num' : null }, t2)))),
          h('tbody', {}, rows),
          h('tfoot', {}, h('tr', {},
            h('th', { scope: 'row' }, 'Total'),
            h('td', {}, `${t.programs} ${t.programs === 1 ? 'program' : 'programs'}`),
            num(t.registered), num(t.cancelled), num(t.waitlisted), num(t.attended), num(t.noShows),
            num(t.walkIns), num(t.totalAttendance),
            h('td', { class: 'num' }, pctText(t.followThrough)),
            h('td', {}, headcountText(t.headcount)))))),
      h('p', { class: 'muted small' }, 'Programs marked Not final have not been closed out. Their numbers can still change.'));
  }

  function agesSection(programs) {
    const rows = ageBreakdown(programs);
    if (!rows.length) return null;
    const max = Math.max(1, ...rows.map((r) => r.attended));
    return h('section', { 'aria-labelledby': 'statsAgeHead' },
      h('h2', { id: 'statsAgeHead' }, 'Ages'),
      h('div', { class: 'table-wrap' },
        h('table', { class: 'stats-table age-table' },
          h('caption', {}, 'Children by age'),
          h('thead', {}, h('tr', {},
            h('th', { scope: 'col' }, 'Age'),
            h('th', { scope: 'col', class: 'num' }, 'Registered'),
            h('th', { scope: 'col' }, 'Attended'))),
          h('tbody', {}, rows.map((r) => h('tr', {},
            h('th', { scope: 'row' }, String(r.age)),
            h('td', { class: 'num' }, String(r.registered)),
            h('td', {},
              h('div', { class: 'bar-cell' },
                h('div', { class: 'bar-track', 'aria-hidden': 'true' },
                  h('div', { class: 'bar', style: `width:${Math.round((r.attended / max) * 100)}%` })),
                h('span', { class: 'bar-num' }, String(r.attended))))))))),
      h('p', { class: 'muted small' }, "Ages are counted only for programs that ask for the child's age."));
  }

  // Counts only, so the file holds no personal data.
  function download() {
    if (!shownRange) return;
    const blob = new Blob([toCsv(shown)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `program-stats_${shownRange.from}_to_${shownRange.to}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  show();
  return () => { alive = false; };
}
