import { test } from 'node:test';
import assert from 'node:assert/strict';
import { programNumbers, totals, ageBreakdown, toCsv } from '../public/js/data/stats.js';

// Invented programs; counts only.
const c = (registered, attended, extra = {}) => ({
  registered, attended, noShows: registered - attended, cancelled: 0, cancelledDayOf: 0,
  waitlisted: 0, walkIns: 0, totalAttendance: attended, agesRegistered: {}, agesAttended: {}, ...extra,
});
const prog = (o) => ({ id: 'p', name: 'Story Time', kind: 'roster', date: '2026-11-03', status: 'open', counts: null, stats: null, headcount: null, ...o });

test('closed program uses frozen stats; open program uses live counts', () => {
  const closed = programNumbers(prog({ status: 'closed', stats: c(10, 7), counts: c(99, 99) }));
  assert.equal(closed.final, true);
  assert.equal(closed.registered, 10);
  const open = programNumbers(prog({ status: 'open', stats: c(5, 5), counts: c(8, 2) }));
  assert.equal(open.final, false);
  assert.equal(open.registered, 8);
  const closedNoStats = programNumbers(prog({ status: 'closed', stats: null, counts: c(4, 1) }));
  assert.equal(closedNoStats.final, false);
  assert.equal(closedNoStats.registered, 4);
});

test('missing fields count as zero', () => {
  const n = programNumbers(prog({ counts: {} }));
  assert.equal(n.registered, 0);
  assert.equal(n.followThrough, null);
  assert.deepEqual(n.agesAttended, {});
  assert.equal(programNumbers(prog({ counts: undefined })).walkIns, 0);
});

test('totals pool follow-through: 7/10 and 1/10 is 40%, not 45%', () => {
  const t = totals([prog({ status: 'closed', stats: c(10, 7) }), prog({ status: 'closed', stats: c(10, 1) })]);
  assert.equal(t.followThrough, 0.4);
  assert.equal(t.programs, 2);
  assert.equal(t.finalCount, 2);
  assert.equal(t.attended, 8);
});

test('follow-through is null when nobody registered', () => {
  assert.equal(totals([prog({ counts: c(0, 0, { walkIns: 3, totalAttendance: 3 }) })]).followThrough, null);
  assert.equal(totals([]).followThrough, null);
  assert.equal(totals([]).programs, 0);
});

test('totals count only closed programs as final', () => {
  const t = totals([prog({ status: 'closed', stats: c(2, 2) }), prog({ counts: c(3, 0) })]);
  assert.equal(t.finalCount, 1);
  assert.equal(t.registered, 5);
});

test('headcount sums the non-null values; null when no program has one', () => {
  const t = totals([
    prog({ headcount: { children: 9, teens: null, adults: 6 } }),
    prog({ headcount: { children: 3, teens: null, adults: null } }),
    prog({ headcount: null }),
  ]);
  assert.deepEqual(t.headcount, { children: 12, teens: null, adults: 6 });
  assert.deepEqual(totals([prog({})]).headcount, { children: null, teens: null, adults: null });
});

test('ages merge across programs and sort as numbers', () => {
  const rows = ageBreakdown([
    prog({ counts: c(3, 2, { agesRegistered: { 10: 1, 4: 2 }, agesAttended: { 4: 1, 10: 1 } }) }),
    prog({ counts: c(2, 2, { agesRegistered: { 9: 1, 4: 1 }, agesAttended: { 9: 1, 4: 1 } }) }),
  ]);
  assert.deepEqual(rows, [
    { age: 4, registered: 3, attended: 2 },
    { age: 9, registered: 1, attended: 1 },
    { age: 10, registered: 1, attended: 1 },
  ]);
  assert.deepEqual(ageBreakdown([prog({ counts: c(1, 1) })]), []);
  assert.deepEqual(ageBreakdown([]), []);
});

test('CSV: BOM, header, quoting, formula guard, TOTAL row', () => {
  const csv = toCsv([
    prog({ name: 'Cats, "Dogs" & More', status: 'closed', stats: c(10, 7), headcount: { children: 9, teens: null, adults: 6 } }),
    prog({ name: '=SUM(A1)', kind: 'slotted', counts: c(10, 1) }),
    prog({ name: '@home' }),
    prog({ name: '-x' }),
    prog({ name: '+x' }),
  ]);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  const lines = csv.slice(1).trimEnd().split('\r\n');
  assert.equal(lines.length, 1 + 5 + 1);
  assert.ok(lines[0].startsWith('Date,Program,Type,Final,Registered'));
  assert.equal(lines[1], '2026-11-03,"Cats, ""Dogs"" & More",Roster,Yes,10,0,0,0,7,3,0,7,70,9,,6');
  assert.ok(lines[2].startsWith("2026-11-03,'=SUM(A1),Time slots,No,10,"));
  assert.ok(lines[3].startsWith("2026-11-03,'@home,"));
  assert.ok(lines[4].startsWith("2026-11-03,'-x,"));
  assert.ok(lines[5].startsWith("2026-11-03,'+x,"));
  // 8 attended of 20 registered = 40%; headcount children 9, teens blank, adults 6.
  assert.equal(lines[6], ',TOTAL,,,20,0,0,0,8,12,0,8,40,9,,6');
});

test('CSV of an empty range still has a header and a TOTAL row', () => {
  const lines = toCsv([]).slice(1).trimEnd().split('\r\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[1], ',TOTAL,,,0,0,0,0,0,0,0,0,,,,');
});
