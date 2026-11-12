import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampRetention, computePurgeAfter, computePurgeCeiling, cleanSignupInput, computeCounts,
  followThrough, localDateTime, formatTime, fillReminder, generateSlots,
} from '../js/data/model.js';

const program = { date: '2026-11-14', fields: { age: true, email: true, caregiver: true, notes: true } };

test('retention is clamped to 1..30 days', () => {
  assert.equal(clampRetention(14), 14);
  assert.equal(clampRetention(90), 30);
  assert.equal(clampRetention(0), 1);
  assert.equal(clampRetention('abc'), 14);
});

test('purge date is program end plus retention; ceiling is end plus 30 days', () => {
  const end = localDateTime('2026-11-14', '11:30');
  assert.equal(computePurgeAfter(end, 14).getTime() - end.getTime(), 14 * 864e5);
  assert.equal(computePurgeAfter(end, 99).getTime(), computePurgeCeiling(end).getTime());
});

test('child is first name plus one letter; a typed full last name is cut to its initial', () => {
  const { data, errors } = cleanSignupInput(
    { childFirst: ' Pepper ', childInitial: 'zamora', phone: '415-555-0100', language: 'es' }, program);
  assert.deepEqual(errors, {});
  assert.equal(data.childFirst, 'Pepper');
  assert.equal(data.childInitial, 'Z');
});

test('contact is required unless walk-in', () => {
  assert.ok(cleanSignupInput({ childFirst: 'A', childInitial: 'B' }, program).errors.contact);
  assert.deepEqual(cleanSignupInput({ childFirst: 'A', walkIn: true }, program).errors, {});
  assert.deepEqual(cleanSignupInput({ childFirst: 'A', childInitial: 'B', email: 'a@example.test' }, program).errors, {});
});

test('fields the program does not collect are dropped', () => {
  const p = { date: '2026-11-14', fields: {} };
  const { data } = cleanSignupInput(
    { childFirst: 'A', childInitial: 'B', phone: '415-555-0101', email: 'x@example.test', notes: 'n', age: 5, caregiverFirst: 'C' }, p);
  assert.equal(data.email, '');
  assert.equal(data.notes, '');
  assert.equal(data.caregiverFirst, '');
  assert.equal(data.age, null);
});

test('counts match the hand-written example from the old workbook', () => {
  // "10 pre-registered, 1 cancellation day-of, 3 no-shows, 5 walk-ins"
  const mk = (status, extra = {}) => ({ status, walkIn: false, age: 6, ...extra });
  const signups = [
    ...Array.from({ length: 7 }, () => mk('attended')),
    ...Array.from({ length: 3 }, () => mk('noShow')),
    mk('cancelled', { cancelledAt: localDateTime('2026-11-14', '09:00') }),
    mk('cancelled', { cancelledAt: localDateTime('2026-11-10', '09:00') }),
    mk('waitlisted'),
    ...Array.from({ length: 5 }, () => mk('attended', { walkIn: true, age: 9 })),
  ];
  const c = computeCounts(signups, program);
  assert.equal(c.registered, 10);
  assert.equal(c.attended, 7);
  assert.equal(c.noShows, 3);
  assert.equal(c.cancelled, 2);
  assert.equal(c.cancelledDayOf, 1);
  assert.equal(c.waitlisted, 1);
  assert.equal(c.walkIns, 5);
  assert.equal(c.totalAttendance, 12);
  assert.equal(followThrough(c), 0.7);
  assert.deepEqual(c.agesAttended, { 6: 7, 9: 5 });
});

test('follow-through is null with nobody registered', () => {
  assert.equal(followThrough(computeCounts([], program)), null);
});

test('small formatters', () => {
  assert.equal(formatTime('10:30'), '10:30 AM');
  assert.equal(formatTime('12:00'), '12:00 PM');
  assert.equal(formatTime('16:05'), '4:05 PM');
  assert.equal(fillReminder('{program} at {time} {unknown}', { program: 'Book Club', time: '4 PM' }), 'Book Club at 4 PM {unknown}');
});

test('slots are worked out from a length, with or without a gap', () => {
  const six = generateSlots('10:30', '11:30', 10);
  assert.equal(six.slots.length, 6);
  assert.deepEqual(six.slots[0], { start: '10:30', end: '10:40' });
  assert.deepEqual(six.slots[5], { start: '11:20', end: '11:30' });
  assert.equal(six.unused, 0);

  const gapped = generateSlots('10:30', '11:30', 10, 5);
  assert.deepEqual(gapped.slots.map((s) => s.start), ['10:30', '10:45', '11:00', '11:15']);
  assert.deepEqual(gapped.slots[3], { start: '11:15', end: '11:25' });
  assert.equal(gapped.unused, 5, 'a gap after the last slot is not needed, so only 5 minutes are unused');

  const leftover = generateSlots('10:30', '11:20', 15);
  assert.equal(leftover.slots.length, 3);
  assert.equal(leftover.unused, 5);
});

test('slot lengths that cannot work are refused in words', () => {
  assert.match(generateSlots('10:30', '11:30', 2).error, /30 slots/);
  assert.match(generateSlots('10:30', '11:30', 90).error, /longer than the whole program/);
  assert.match(generateSlots('10:30', '11:30', 0).error, /whole number/);
  assert.match(generateSlots('10:30', '11:30', 10, -1).error, /between slots/);
  assert.match(generateSlots('11:30', '10:30', 10).error, /after the start/);
  assert.match(generateSlots('', '10:30', 10).error, /start time and end time/);
  assert.equal(generateSlots('10:30', '11:30', 10, '').slots.length, 6, 'a blank gap means no gap');
});
