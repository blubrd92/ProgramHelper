// Pure helpers for the stats page. No Firebase, no page: testable in Node.
// They read PROGRAM documents only (never sign-ups), so they keep working
// after children's names have been wiped.
import { followThrough } from './model.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Add the numbers in `from` into the age map `into`. */
function mergeAges(into, from) {
  for (const [age, n] of Object.entries(from || {})) into[age] = (into[age] || 0) + num(n);
}

/** A head count value is a number or null (not recorded). */
const countOrNull = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * The numbers to show for one program.
 * A closed program uses its frozen `stats`; any other program uses its live
 * `counts`, and `final` is false because those numbers can still change.
 */
export function programNumbers(program) {
  const final = program?.status === 'closed' && program.stats != null;
  const c = (final ? program.stats : program?.counts) || {};
  const hc = program?.headcount || {};
  return {
    final,
    registered: num(c.registered),
    cancelled: num(c.cancelled),
    cancelledDayOf: num(c.cancelledDayOf),
    waitlisted: num(c.waitlisted),
    attended: num(c.attended),
    noShows: num(c.noShows),
    walkIns: num(c.walkIns),
    totalAttendance: num(c.totalAttendance),
    followThrough: followThrough({ registered: num(c.registered), attended: num(c.attended) }),
    headcount: { children: countOrNull(hc.children), teens: countOrNull(hc.teens), adults: countOrNull(hc.adults) },
    agesAttended: { ...(c.agesAttended || {}) },
    agesRegistered: { ...(c.agesRegistered || {}) },
  };
}

/**
 * The same fields summed over a list of programs.
 * Follow-through is pooled: all attended divided by all registered (it is NOT
 * an average of the per-program percentages). A head count field is the sum of
 * the programs that recorded it, or null if none did.
 */
export function totals(programs) {
  const t = {
    programs: 0, finalCount: 0,
    registered: 0, cancelled: 0, cancelledDayOf: 0, waitlisted: 0,
    attended: 0, noShows: 0, walkIns: 0, totalAttendance: 0,
    followThrough: null,
    headcount: { children: null, teens: null, adults: null },
    agesAttended: {}, agesRegistered: {},
  };
  for (const p of programs || []) {
    const n = programNumbers(p);
    t.programs += 1;
    if (n.final) t.finalCount += 1;
    for (const k of ['registered', 'cancelled', 'cancelledDayOf', 'waitlisted', 'attended', 'noShows', 'walkIns', 'totalAttendance']) {
      t[k] += n[k];
    }
    for (const k of ['children', 'teens', 'adults']) {
      if (n.headcount[k] != null) t.headcount[k] = (t.headcount[k] || 0) + n.headcount[k];
    }
    mergeAges(t.agesAttended, n.agesAttended);
    mergeAges(t.agesRegistered, n.agesRegistered);
  }
  t.followThrough = followThrough(t);
  return t;
}

/** Rows [{ age, registered, attended }] sorted by age as a number. Empty if no ages. */
export function ageBreakdown(programs) {
  const t = totals(programs);
  const ages = new Set([...Object.keys(t.agesRegistered), ...Object.keys(t.agesAttended)]);
  return [...ages]
    .map((a) => ({ age: Number(a), registered: t.agesRegistered[a] || 0, attended: t.agesAttended[a] || 0 }))
    .filter((r) => Number.isFinite(r.age))
    .sort((a, b) => a.age - b.age);
}

/** Quote a CSV field when it holds a comma, quote or line break. */
function csvField(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Stop a spreadsheet from treating a program name as a formula. */
function safeText(s) {
  const t = String(s ?? '');
  return /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
}

const pct = (r) => (r == null ? '' : Math.round(r * 100));
const orBlank = (v) => (v == null ? '' : v);

export const CSV_HEADER = [
  'Date', 'Program', 'Type', 'Final', 'Registered', 'Cancelled', 'Cancelled day-of', 'Waitlisted',
  'Attended', 'No-shows', 'Walk-ins', 'Total attendance', 'Follow-through %',
  'Headcount children', 'Headcount teens', 'Headcount adults',
];

/** A CSV text (starting with a UTF-8 byte order mark so Excel reads accents). Counts only. */
export function toCsv(programs) {
  const rows = [CSV_HEADER];
  for (const p of programs || []) {
    const n = programNumbers(p);
    rows.push([
      p.date, safeText(p.name), p.kind === 'slotted' ? 'Time slots' : 'Roster', n.final ? 'Yes' : 'No',
      n.registered, n.cancelled, n.cancelledDayOf, n.waitlisted, n.attended, n.noShows, n.walkIns,
      n.totalAttendance, pct(n.followThrough),
      orBlank(n.headcount.children), orBlank(n.headcount.teens), orBlank(n.headcount.adults),
    ]);
  }
  const t = totals(programs);
  rows.push([
    '', 'TOTAL', '', '', t.registered, t.cancelled, t.cancelledDayOf, t.waitlisted, t.attended, t.noShows,
    t.walkIns, t.totalAttendance, pct(t.followThrough),
    orBlank(t.headcount.children), orBlank(t.headcount.teens), orBlank(t.headcount.adults),
  ]);
  return '﻿' + rows.map((r) => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}
