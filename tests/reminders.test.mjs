import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  remindable, groupFamilies, formatTimeEs, joinNames, buildGroupMessage, buildFamilyMessage,
  emailLists, callList, remindedProgress,
} from '../docs/js/data/reminders.js';

// Invented data only.
const su = (id, first, extra = {}) => ({
  id, childFirst: first, childInitial: 'Z', caregiverFirst: 'Sage', phone: '', email: '',
  language: 'en', languageOther: '', walkIn: false, status: 'registered', slot: null, reminded: false, ...extra,
});

const roster = {
  name: 'Story Time', kind: 'roster', date: '2026-11-14', startTime: '15:30',
  reminder: {
    en: 'Hi! {program} on {date} at {time}. For {child}.',
    es: 'Hola. {program} el {date} a las {time}. Para {child}.',
  },
};
const slotted = {
  name: 'Read to a Dog', kind: 'slotted', date: '2026-11-14', startTime: '10:00',
  slots: [{ start: '10:30', end: '10:40' }, { start: '10:40', end: '10:50' }],
  reminder: { en: '{child}: {slot} on {date}', es: '{child}: {slot} el {date}' },
};

test('remindable keeps only registered, non-walk-in sign-ups', () => {
  const list = [
    su('1', 'A'), su('2', 'B', { status: 'waitlisted' }), su('3', 'C', { status: 'cancelled' }),
    su('4', 'D', { status: 'attended' }), su('5', 'E', { status: 'noShow' }), su('6', 'F', { walkIn: true }),
  ];
  assert.deepEqual(remindable(list).map((s) => s.id), ['1']);
});

test('families group by email, ignoring case', () => {
  const f = groupFamilies([
    su('1', 'Pepper', { email: 'x@example.test' }),
    su('2', 'Olive', { email: 'X@Example.test', phone: '415-555-0100' }),
    su('3', 'Basil', { email: 'y@example.test' }),
  ]);
  assert.equal(f.length, 2);
  assert.deepEqual(f[0].children.map((c) => c.childFirst), ['Pepper', 'Olive']);
  assert.equal(f[0].phone, '415-555-0100');
});

test('with no email, families group by phone digits', () => {
  const f = groupFamilies([
    su('1', 'Pepper', { phone: '415-555-0100' }),
    su('2', 'Olive', { phone: '(415) 555 0100' }),
    su('3', 'Basil', { phone: '415-555-0199' }),
  ]);
  assert.equal(f.length, 2);
  assert.equal(f[0].children.length, 2);
});

test('a sign-up with no contact stands alone; language comes from the first child', () => {
  const f = groupFamilies([su('1', 'A'), su('2', 'B')]);
  assert.equal(f.length, 2);
  const g = groupFamilies([
    su('3', 'C', { email: 'q@example.test', language: 'es' }),
    su('4', 'D', { email: 'q@example.test', language: 'en' }),
  ]);
  assert.equal(g[0].language, 'es');
});

test('Spanish time format, including noon and just after midnight', () => {
  assert.equal(formatTimeEs('15:30'), '3:30 p. m.');
  assert.equal(formatTimeEs('10:30'), '10:30 a. m.');
  assert.equal(formatTimeEs('12:00'), '12:00 p. m.');
  assert.equal(formatTimeEs('00:15'), '12:15 a. m.');
});

test('joinNames in English and Spanish, with the "e" before an I sound', () => {
  assert.equal(joinNames(['Pepper'], 'en'), 'Pepper');
  assert.equal(joinNames(['Pepper', 'Olive'], 'en'), 'Pepper and Olive');
  assert.equal(joinNames(['Pepper', 'Olive', 'Basil'], 'en'), 'Pepper, Olive and Basil');
  assert.equal(joinNames(['Pepper', 'Olive'], 'es'), 'Pepper y Olive');
  assert.equal(joinNames(['Pepper', 'Olive', 'Basil'], 'es'), 'Pepper, Olive y Basil');
  assert.equal(joinNames(['Pepper', 'Inés'], 'es'), 'Pepper e Inés');
  assert.equal(joinNames(['Pepper', 'Hilda'], 'es'), 'Pepper e Hilda');
  assert.equal(joinNames(['Pepper', 'Ivy'], 'en'), 'Pepper and Ivy');
});

test('group message is filled, in the right language, and has no child name', () => {
  const kids = ['Pepper', 'Olive'];
  const en = buildGroupMessage(roster, 'en');
  assert.match(en, /Story Time on Saturday, November 14, 2026 at 3:30 PM/);
  const es = buildGroupMessage(roster, 'es');
  assert.match(es, /sábado, 14 de noviembre de 2026/);
  assert.match(es, /3:30 p\. m\./);
  for (const k of kids) {
    assert.ok(!en.includes(k));
    assert.ok(!es.includes(k));
  }
});

test("'other' language gets the English wording", () => {
  assert.equal(buildGroupMessage(roster, 'other'), buildGroupMessage(roster, 'en'));
  const fam = groupFamilies([su('1', 'Pepper', { language: 'other', languageOther: 'Portuguese', slot: 0 })])[0];
  assert.equal(buildFamilyMessage(slotted, fam), 'Pepper: 10:30 AM on Saturday, November 14, 2026');
});

test('family message: one child, siblings, Spanish', () => {
  const one = groupFamilies([su('1', 'Pepper', { email: 'x@example.test', slot: 0 })])[0];
  assert.equal(buildFamilyMessage(slotted, one, 'en'), 'Pepper: 10:30 AM on Saturday, November 14, 2026');
  const sibs = groupFamilies([
    su('1', 'Pepper', { email: 'x@example.test', slot: 0, language: 'es' }),
    su('2', 'Inés', { email: 'x@example.test', slot: 1, language: 'es' }),
  ])[0];
  assert.equal(buildFamilyMessage(slotted, sibs),
    'Pepper e Inés: Pepper: 10:30 a. m.; Inés: 10:40 a. m. el sábado, 14 de noviembre de 2026');
});

test('email lists are split by language and de-duplicated in order', () => {
  const fams = groupFamilies([
    su('1', 'A', { email: 'a@example.test' }),
    su('2', 'B', { email: 'b@example.test', language: 'es' }),
    su('3', 'C', { email: 'c@example.test', language: 'other' }),
    su('4', 'D', { email: 'A@example.test' }), // same family as 1
    su('5', 'E', { phone: '415-555-0100' }),   // no email
  ]);
  // Add a duplicate address in a different family object to test de-duplication itself.
  fams.push({ ...fams[0], key: 'dup' });
  assert.deepEqual(emailLists(fams), { en: ['a@example.test'], es: ['b@example.test'], other: ['c@example.test'] });
});

test('call list: phone and no email only', () => {
  const fams = groupFamilies([
    su('1', 'A', { phone: '415-555-0100' }),
    su('2', 'B', { phone: '415-555-0101', email: 'b@example.test' }),
    su('3', 'C'),
  ]);
  assert.deepEqual(callList(fams).map((f) => f.children[0].childFirst), ['A']);
});

test('progress counts families whose children are all ticked', () => {
  const fams = groupFamilies([
    su('1', 'A', { email: 'a@example.test', reminded: true }),
    su('2', 'B', { email: 'a@example.test', reminded: false }),
    su('3', 'C', { email: 'c@example.test', reminded: true }),
  ]);
  assert.deepEqual(remindedProgress(fams), { done: 1, total: 2 });
});
