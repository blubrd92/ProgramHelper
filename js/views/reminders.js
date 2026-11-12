// The reminders screen for one program.
//
// This tool does NOT send anything. It works out who needs a reminder and
// drafts the wording; staff copy it into their own city email, or phone.
//
// Privacy:
//   * Nothing is stored or logged here. The only thing saved is the
//     "Reminded" tick, through setReminded() (a true/false on the sign-up
//     itself, wiped with it). There is no history of what was copied.
//   * Copying happens only when staff click a Copy button.
//   * A group message never contains a child's name.
//   * Text goes on the page with h() only (plain text, never HTML).
import { h, clear, toast, showError, add } from '../ui.js';
import { watchProgram, watchSignups, setReminded } from '../data/store.js';
import { childLabel, formatTime, formatDateLong, toDate } from '../data/model.js';
import {
  remindable, groupFamilies, emailLists, callList, remindedProgress,
  buildGroupMessage, buildFamilyMessage, messageLanguage, formatTimeFor,
} from '../data/reminders.js';

export function renderReminders(container, ctx, programId) {
  let program;        // undefined = loading, null = not found
  let signups = null; // null = loading
  let loadFailed = false;

  const stopProgram = watchProgram(programId, (p) => { program = p; draw(); }, onLoadError);
  const stopSignups = watchSignups(programId, (s) => { signups = s; draw(); }, onLoadError);

  function onLoadError(e) {
    loadFailed = true;
    showError(e);
    draw();
  }

  // ------------------------------------------------------------ small helpers

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const byCreated = (a, b) => (toDate(a.createdAt)?.getTime() || 0) - (toDate(b.createdAt)?.getTime() || 0);

  function languageName(family) {
    if (family.language === 'es') return 'Spanish';
    if (family.language === 'other') return family.languageOther || 'Other';
    return 'English';
  }

  /** A family's name for screen-reader labels: caregiver and children. */
  function familyName(family) {
    const kids = family.children.map(childLabel).join(', ');
    return family.caregiverFirst ? `${family.caregiverFirst} (${kids})` : kids;
  }

  /** Slot start times for a family, e.g. "10:30 AM" or "Pepper: 10:30 AM; Olive: 10:40 AM". */
  function slotTimes(family, lang) {
    const part = (c) => {
      const slot = c.slot == null ? null : (program.slots || [])[c.slot];
      return slot ? formatTimeFor(slot.start, lang) : '';
    };
    if (family.children.length === 1) return part(family.children[0]);
    return family.children.map((c) => `${c.childFirst}: ${part(c)}`).join('; ');
  }

  const isFamilyReminded = (family) => family.children.length > 0 && family.children.every((c) => c.reminded);

  /** Tick or untick every sign-up in the family. */
  async function setFamilyReminded(family, value) {
    try {
      for (const c of family.children) {
        if (!!c.reminded !== value) await setReminded(programId, c.id, value);
      }
    } catch (e) {
      showError(e);
    }
  }

  async function markAll(families) {
    try {
      for (const f of families) {
        for (const c of f.children) {
          if (!c.reminded) await setReminded(programId, c.id, true);
        }
      }
    } catch (e) {
      showError(e);
    }
  }

  /** Copy a text box's contents. If the browser refuses, select it so Ctrl+C works. */
  async function copyFrom(box, what) {
    try {
      await navigator.clipboard.writeText(box.value);
      toast(`${what} copied.`);
    } catch (e) {
      box.focus();
      box.select();
      toast('Could not copy automatically. The text is selected: press Ctrl+C to copy it.', 'info');
    }
  }

  /** A read-only labelled text box. */
  function textBox(id, label, text, rows) {
    return h('div', { class: 'field' },
      h('label', { for: id }, label),
      h('textarea', { id, readOnly: true, rows, class: 'reminder-box', dataset: { key: id } }, text));
  }

  function copyButton(boxId, label, what, key) {
    return h('button', {
      type: 'button', class: 'btn', dataset: { key },
      onclick: () => copyFrom(document.getElementById(boxId), what),
    }, label);
  }

  function remindedBox(family, closed, key) {
    const id = `rem-${key}`;
    return h('span', { class: 'check-row reminded-check' },
      h('input', {
        type: 'checkbox', id, checked: isFamilyReminded(family), disabled: closed,
        'aria-label': `Reminded: ${familyName(family)}`,
        dataset: { key: id },
        onchange: (ev) => setFamilyReminded(family, ev.target.checked),
      }),
      h('label', { for: id, 'aria-hidden': 'true' }, 'Reminded'));
  }

  // ---------------------------------------------------------------- drawing

  function draw() {
    // Remember which control had focus, so our own redraws do not drop it.
    const focusedKey = container.contains(document.activeElement)
      ? document.activeElement.dataset?.key : null;
    add(clear(container), build());
    if (focusedKey) {
      const again = [...container.querySelectorAll('[data-key]')].find((el) => el.dataset.key === focusedKey);
      again?.focus();
    }
  }

  function build() {
    const back = h('a', { href: `#/program/${programId}`, class: 'back-link' }, 'Back to the program');
    if (loadFailed && (program === undefined || signups === null)) {
      return h('div', {}, back, h('p', { class: 'alert', role: 'alert' }, 'This could not be loaded. Check the internet connection and reload the page.'));
    }
    if (program === undefined || signups === null) {
      return h('div', {}, back, h('p', { class: 'loading' }, 'Loading…'));
    }
    if (program === null) {
      return h('div', {}, h('p', {}, 'That program was not found. It may have been removed.'),
        h('p', {}, h('a', { href: '#/' }, 'Back to programs')));
    }

    const closed = program.status === 'closed';
    const families = groupFamilies(remindable(signups).sort(byCreated));
    const parts = [h('header', { class: 'program-head' },
      back,
      h('h1', {}, `Reminders: ${program.name}`),
      h('p', {}, `${formatDateLong(program.date)}, ${formatTime(program.startTime)}`),
      h('p', { class: 'muted' }, 'This tool does not send anything. Copy what you need into your city email, or call.'))];

    if (closed) parts.push(h('p', { class: 'alert', role: 'status' }, 'This program is closed out.'));

    if (!families.length) {
      parts.push(h('p', {}, 'Nobody needs a reminder. Only families with a registered sign-up (not waitlisted, cancelled, or walk-in) are listed here.'));
      return h('div', { class: 'reminders-page' }, parts);
    }

    parts.push(emailSection(families, closed));
    parts.push(callSection(families, closed));
    parts.push(progressLine(families, closed));
    return h('div', { class: 'reminders-page' }, parts);
  }

  // ------------------------------------------------------------------ email

  const GROUPS = [
    { id: 'en', heading: 'English' },
    { id: 'es', heading: 'Spanish' },
    { id: 'other', heading: 'Other languages' },
  ];
  const groupOf = (family) => (family.language === 'es' ? 'es' : family.language === 'other' ? 'other' : 'en');

  function emailSection(families, closed) {
    const withEmail = families.filter((f) => f.email);
    const section = h('section', { 'aria-labelledby': 'emailHead' }, h('h2', { id: 'emailHead' }, 'Email'));
    if (!withEmail.length) {
      add(section, h('p', { class: 'muted' }, 'No family gave an email address.'));
      return section;
    }
    const lists = emailLists(withEmail);
    for (const g of GROUPS) {
      const members = withEmail.filter((f) => groupOf(f) === g.id);
      if (!members.length) continue;
      add(section, program.kind === 'slotted'
        ? slottedGroup(g, members, closed)
        : rosterGroup(g, members, lists[g.id], closed));
    }
    return section;
  }

  /** Roster programs: one card per language, one message for everybody in it. */
  function rosterGroup(g, members, addresses, closed) {
    const lang = messageLanguage(g.id);
    const message = buildGroupMessage(program, lang);
    const boxId = `addr-${g.id}`;
    const msgId = `msg-${g.id}`;
    const headId = `grp-${g.id}`;

    const card = h('div', { class: 'card reminder-card', role: 'group', 'aria-labelledby': headId },
      h('h3', { id: headId }, `${g.heading}: ${plural(members.length, 'family', 'families')}`));

    if (g.id === 'other') {
      // Tell staff which languages are in this group.
      const counts = new Map();
      for (const f of members) counts.set(languageName(f), (counts.get(languageName(f)) || 0) + 1);
      add(card, h('p', {}, 'These families get the English message. Their languages: ',
        [...counts].map(([name, n]) => `${name}: ${plural(n, 'family', 'families')}`).join(', '), '.'));
    }

    add(card,
      textBox(boxId, 'Email addresses', addresses.join('; '), 3),
      h('div', { class: 'action-row' }, copyButton(boxId, 'Copy addresses', 'Addresses', `copyaddr-${g.id}`)),
      h('p', { class: 'bcc-note' }, h('strong', {}, 'Paste into BCC'), ' so families do not see each other\'s addresses.'),
      textBox(msgId, `Message (${g.id === 'es' ? 'Spanish' : 'English'})`, message, 10),
      h('div', { class: 'action-row' }, copyButton(msgId, 'Copy message', 'Message', `copymsg-${g.id}`)));

    // A compact checklist of the families in this group.
    add(card,
      h('h4', {}, 'Reminded'),
      h('ul', { class: 'plain reminded-list' }, members.map((f) => h('li', { class: 'reminded-item' },
        remindedBox(f, closed, f.key),
        h('span', {}, familyName(f), g.id === 'other' ? ` (${languageName(f)})` : '')))),
      closed ? null : h('div', { class: 'action-row' },
        h('button', {
          type: 'button', class: 'btn', dataset: { key: `markall-${g.id}` },
          onclick: () => markAll(members),
        }, `Mark all ${g.heading} families as reminded`)));
    return card;
  }

  /** Slotted programs: one card per family, because each has its own time. */
  function slottedGroup(g, members, closed) {
    const wrap = h('div', { class: 'reminder-group' },
      h('h3', {}, `${g.heading}: ${plural(members.length, 'family', 'families')}`));
    if (g.id === 'other') add(wrap, h('p', { class: 'muted' }, 'These families get the English message. Their language is shown on each card.'));
    for (const f of members) {
      const lang = messageLanguage(f.language);
      const headId = `fam-h-${f.key}`;
      const addrId = `addr-${f.key}`;
      const msgId = `msg-${f.key}`;
      add(wrap, h('div', { class: 'card reminder-card', role: 'group', 'aria-labelledby': headId },
        h('h4', { id: headId }, f.caregiverFirst || 'Caregiver not entered'),
        h('p', {}, f.children.map((c) => `${childLabel(c)} at ${slotTimes({ children: [c] }, 'en') || 'no time slot'}`).join('; '),
          g.id === 'other' ? ` · Language: ${languageName(f)}` : ''),
        textBox(addrId, 'Email address', f.email, 1),
        h('div', { class: 'action-row' }, copyButton(addrId, 'Copy address', 'Address', `copyaddr-${f.key}`)),
        textBox(msgId, `Message (${lang === 'es' ? 'Spanish' : 'English'})`, buildFamilyMessage(program, f, lang), 10),
        h('div', { class: 'action-row' },
          copyButton(msgId, 'Copy message', 'Message', `copymsg-${f.key}`),
          remindedBox(f, closed, f.key))));
    }
    return wrap;
  }

  // -------------------------------------------------------------- call list

  function callSection(families, closed) {
    const rows = callList(families);
    const slotted = program.kind === 'slotted';
    const section = h('section', { 'aria-labelledby': 'callHead' }, h('h2', { id: 'callHead' }, 'Call list'));
    const noContact = families.filter((f) => !f.phone && !f.email).length;
    if (!rows.length) {
      add(section, h('p', { class: 'muted' }, 'Every family gave an email address.'));
    } else {
      add(section, h('div', { class: 'table-wrap' }, h('table', { 'aria-labelledby': 'callHead' },
        h('thead', {}, h('tr', {},
          h('th', { scope: 'col' }, 'Reminded'),
          h('th', { scope: 'col' }, 'Child(ren)'),
          h('th', { scope: 'col' }, 'Caregiver'),
          h('th', { scope: 'col' }, 'Phone'),
          h('th', { scope: 'col' }, 'Language'),
          slotted ? h('th', { scope: 'col' }, 'Time slot') : null)),
        h('tbody', {}, rows.map((f) => h('tr', {},
          h('td', {}, remindedBox(f, closed, f.key)),
          h('td', {}, f.children.map(childLabel).join(', ')),
          h('td', {}, f.caregiverFirst),
          h('td', {}, f.phone),
          h('td', {}, languageName(f)),
          slotted ? h('td', {}, slotTimes(f, 'en')) : null))))));
    }
    if (noContact) {
      add(section, h('p', { class: 'muted' },
        `${plural(noContact, 'family has', 'families have')} no email address and no phone number, so they are not listed above.`));
    }
    return section;
  }

  function progressLine(families, closed) {
    const { done, total } = remindedProgress(families);
    return h('p', { class: 'progress-line', role: 'status' }, `${done} of ${total} families reminded.`);
  }

  // First draw (shows "Loading" until the data arrives).
  draw();

  return function cleanup() {
    stopProgram();
    stopSignups();
  };
}
