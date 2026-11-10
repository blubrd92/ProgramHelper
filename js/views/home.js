// Main screen: programs that need a family contacted, upcoming programs,
// recent past programs, and (admin) the "new program" form.
import { h, clear, toast, showError, openDialog, field } from '../ui.js';
import { listPrograms, listTemplates, installStarterTemplates, createProgram } from '../data/store.js';
import { formatDateLong, formatTime, localDateString } from '../data/model.js';

const DAY = 24 * 60 * 60 * 1000;

export function renderHome(container, ctx) {
  let alive = true;
  const body = h('div', { class: 'home' }, h('p', { class: 'loading' }, 'Loading programs…'));
  container.append(body);

  async function load() {
    try {
      const today = localDateString(new Date());
      const from = localDateString(new Date(Date.now() - 60 * DAY));
      const programs = await listPrograms(from, null);
      if (!alive) return;
      draw(programs, today);
    } catch (e) {
      showError(e);
    }
  }

  function draw(programs, today) {
    const upcoming = programs.filter((p) => p.date >= today);
    const past = programs.filter((p) => p.date < today).reverse();
    const flagged = programs.filter((p) => (p.needsContact || 0) > 0);

    clear(body).append(
      h('div', { class: 'page-head' },
        h('h1', {}, 'Programs'),
        ctx.isAdmin ? h('button', { type: 'button', class: 'btn btn-primary', onclick: newProgram }, 'New program') : null),

      flagged.length ? h('section', { class: 'alert', 'aria-labelledby': 'flagHead' },
        h('h2', { id: 'flagHead' }, 'Families to contact'),
        h('p', {}, 'A child moved up from the waitlist. Let the family know they have a spot.'),
        h('ul', { class: 'plain' }, flagged.map((p) => h('li', {},
          h('a', { href: `#/program/${p.id}` }, `${p.name}, ${formatDateLong(p.date)}`),
          ` : ${p.needsContact} to contact`)))) : null,

      h('section', { 'aria-labelledby': 'upHead' },
        h('h2', { id: 'upHead' }, 'Upcoming'),
        upcoming.length ? h('ul', { class: 'program-list' }, upcoming.map((p) => card(p, today)))
          : h('p', { class: 'muted' }, ctx.isAdmin ? 'No upcoming programs. Use "New program" to add one.' : 'No upcoming programs yet.')),

      past.length ? h('section', { 'aria-labelledby': 'pastHead' },
        h('h2', { id: 'pastHead' }, 'Past 60 days'),
        h('ul', { class: 'program-list' }, past.map((p) => card(p, today)))) : null,
    );
  }

  function card(p, today) {
    const badges = [];
    if ((p.needsContact || 0) > 0) badges.push(h('span', { class: 'badge badge-warn' }, `${p.needsContact} to contact`));
    if (p.status === 'closed') badges.push(h('span', { class: 'badge' }, 'Closed out'));
    else if (p.date < today) badges.push(h('span', { class: 'badge badge-warn' }, 'Needs close-out'));
    else if (p.date === today) badges.push(h('span', { class: 'badge badge-ok' }, 'Today'));

    let seats;
    if (p.kind === 'slotted') {
      const total = (p.slots?.length || 0) * (p.tracks?.length || 0);
      seats = `${Object.keys(p.seats || {}).length} of ${total} slots filled`;
    } else {
      seats = `${p.seatsTaken || 0} of ${p.capacity} seats filled`;
    }
    const waiting = (p.waitlist || []).length;

    return h('li', {},
      h('a', { class: 'program-card', href: `#/program/${p.id}` },
        h('span', { class: 'program-name' }, p.name),
        h('span', { class: 'program-when' }, `${formatDateLong(p.date)}, ${formatTime(p.startTime)} to ${formatTime(p.endTime)}`),
        h('span', { class: 'program-seats' }, seats + (waiting ? `, ${waiting} on the waitlist` : '')),
        badges.length ? h('span', { class: 'program-badges' }, badges) : null));
  }

  async function newProgram() {
    let templates;
    try {
      templates = await listTemplates();
    } catch (e) {
      return showError(e);
    }
    if (!templates.length) {
      const install = h('button', { type: 'button', class: 'btn btn-primary' }, 'Add the three starter templates');
      const d = openDialog('No templates yet', h('div', {},
        h('p', {}, 'Programs are made from templates. The tool comes with three: a general roster program, a monthly book club, and Read to a Dog.'),
        h('div', { class: 'dialog-actions' }, install)));
      install.addEventListener('click', async () => {
        install.disabled = true;
        try {
          await installStarterTemplates();
          d.close();
          toast('Starter templates added.');
          newProgram();
        } catch (e) {
          install.disabled = false;
          showError(e);
        }
      });
      return;
    }

    const template = h('select', {}, templates.map((t) => h('option', { value: t.id }, t.name)));
    const name = h('input', { type: 'text', maxLength: 80, required: true });
    const date = h('input', { type: 'date', required: true, min: localDateString(new Date()) });
    const start = h('input', { type: 'time', required: true });
    const end = h('input', { type: 'time', required: true });
    const capacity = h('input', { type: 'number', min: 1, max: 200, inputMode: 'numeric' });
    const capacityField = field('Seats', capacity);
    const error = h('p', { class: 'form-error', role: 'alert' });
    const save = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Create program');
    const cancel = h('button', { type: 'button', class: 'btn' }, 'Cancel');

    const current = () => templates.find((t) => t.id === template.value);
    function applyTemplate() {
      const t = current();
      start.value = t.startTime || '';
      end.value = t.endTime || '';
      capacity.value = t.capacity || '';
      capacityField.hidden = t.kind !== 'roster';
    }
    template.addEventListener('change', applyTemplate);
    applyTemplate();

    const form = h('form', { novalidate: true },
      field('Template', template),
      field('Program name', name, { hint: 'As families know it, for example "Bookmaking Workshop".' }),
      field('Date', date),
      h('div', { class: 'field-row' }, field('Starts', start), field('Ends', end)),
      capacityField,
      error,
      h('div', { class: 'dialog-actions' }, cancel, save));
    const d = openDialog('New program', form);
    cancel.addEventListener('click', () => d.close());
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      error.textContent = '';
      save.disabled = true;
      try {
        const id = await createProgram(current(), {
          name: name.value, date: date.value, startTime: start.value, endTime: end.value,
          capacity: current().kind === 'roster' ? capacity.value : 0,
        });
        d.close();
        location.hash = `#/program/${id}`;
      } catch (e) {
        save.disabled = false;
        if (e?.name === 'UserError') error.textContent = e.message;
        else showError(e);
      }
    });
    name.focus();
  }

  load();
  return () => { alive = false; };
}
