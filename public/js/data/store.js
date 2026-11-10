// Every read and write to the database goes through this file.
// Screens call these functions; they never talk to Firestore directly.
//
// Privacy rules this file keeps:
//   * Personal data is written only to programs/{id}/signups/{id}.
//   * Every sign-up is written together with its purge ticket.
//   * Program documents get numbers and IDs only, never names.

import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, query, where, orderBy, limit,
  onSnapshot, runTransaction, writeBatch, Timestamp,
} from 'firebase/firestore';
import {
  STATUS, holdsSeat, clampRetention, DEFAULT_RETENTION_DAYS, localDateTime,
  computePurgeAfter, computePurgeCeiling, seatKey, cleanSignupInput, computeCounts,
  sameCounts, toDate,
} from './model.js';
import { STARTER_TEMPLATES } from './starter-templates.js';

let db = null;

/** Called once at startup (and by tests) with the Firestore instance. */
export function setDb(instance) {
  db = instance;
}

const programRef = (pid) => doc(db, 'programs', pid);
const signupsCol = (pid) => collection(db, 'programs', pid, 'signups');
const signupRef = (pid, sid) => doc(db, 'programs', pid, 'signups', sid);
const ticketRef = (sid) => doc(db, 'purgeQueue', sid);
const withId = (snap) => ({ id: snap.id, ...snap.data() });

/** A friendly error the screen can show as-is. */
export class UserError extends Error {}

// ---------------------------------------------------------------- settings

export async function getRetentionDays() {
  const snap = await getDoc(doc(db, 'settings', 'main'));
  return snap.exists() ? clampRetention(snap.data().retentionDays) : DEFAULT_RETENTION_DAYS;
}

/**
 * Admin only. Saves the retention period, then re-dates every sign-up that
 * still exists so the new period applies to data already collected.
 * Returns how many sign-ups were re-dated.
 */
export async function saveRetentionDays(days) {
  const retentionDays = clampRetention(days);
  await setDoc(doc(db, 'settings', 'main'), { retentionDays });
  return redateAllSignups(retentionDays);
}

async function redateAllSignups(retentionDays) {
  const tickets = await getDocs(collection(db, 'purgeQueue'));
  const programEnds = new Map();
  let changed = 0;
  for (const t of tickets.docs) {
    const { programId, purgeAfter } = t.data();
    if (!programEnds.has(programId)) {
      const p = await getDoc(programRef(programId));
      programEnds.set(programId, p.exists() ? (p.data().retainFrom || p.data().endsAt) : null);
    }
    const end = programEnds.get(programId);
    if (!end) continue;
    const wanted = Timestamp.fromDate(computePurgeAfter(end, retentionDays));
    if (wanted.toMillis() === purgeAfter.toMillis()) continue;
    const batch = writeBatch(db);
    if (wanted.toMillis() <= Date.now() + 5 * 60 * 1000) {
      // Under the new, shorter period this sign-up is already overdue.
      // Wipe it now (the admin is allowed to delete a sign-up early).
      await freezeStatsIfOpen(programId);
      batch.delete(signupRef(programId, t.id));
      batch.delete(t.ref);
    } else {
      batch.update(signupRef(programId, t.id), { purgeAfter: wanted });
      batch.update(t.ref, { purgeAfter: wanted });
    }
    try {
      await batch.commit();
      changed += 1;
    } catch (e) {
      // A sign-up that expired a moment ago cannot be updated. The purge removes it.
    }
  }
  return changed;
}

// --------------------------------------------------------------- templates

export async function listTemplates() {
  const snap = await getDocs(collection(db, 'templates'));
  return snap.docs.map(withId).sort((a, b) => a.name.localeCompare(b.name));
}

/** Admin only. Adds the three shipped templates if they are not there yet. */
export async function installStarterTemplates() {
  const existing = new Set((await getDocs(collection(db, 'templates'))).docs.map((d) => d.id));
  let added = 0;
  for (const t of STARTER_TEMPLATES) {
    if (existing.has(t.id)) continue;
    const { id, ...data } = t;
    await setDoc(doc(db, 'templates', id), data);
    added += 1;
  }
  return added;
}

// ---------------------------------------------------------------- programs

/**
 * Admin only. Makes one program (one session on one date) from a template.
 * The template's settings are copied in, so later template edits do not
 * change programs that already exist.
 */
export async function createProgram(template, { name, date, startTime, endTime, capacity }) {
  if (!name?.trim()) throw new UserError('Give the program a name.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new UserError('Pick a date.');
  const start = startTime || template.startTime;
  const end = endTime || template.endTime;
  const startsAt = localDateTime(date, start);
  const endsAt = localDateTime(date, end);
  if (!(endsAt > startsAt)) throw new UserError('The end time must be after the start time.');

  const tracks = [];
  for (let i = 0; i < (template.defaultTracks || 0); i++) {
    tracks.push({ id: `t${i + 1}`, volunteerId: null, status: 'scheduled' });
  }
  const ref = doc(collection(db, 'programs'));
  await setDoc(ref, {
    name: name.trim(),
    templateId: template.id || null,
    kind: template.kind,
    audience: template.audience || 'children',
    date,
    startTime: start,
    endTime: end,
    startsAt: Timestamp.fromDate(startsAt),
    endsAt: Timestamp.fromDate(endsAt),
    // retainFrom: the moment the retention clock starts for this program.
    retainFrom: Timestamp.fromDate(endsAt),
    purgeCeiling: Timestamp.fromDate(computePurgeCeiling(endsAt)),
    seriesId: null,
    capacity: Number(capacity ?? template.capacity) || 0,
    slots: template.slots || [],
    trackLabel: template.trackLabel || '',
    tracks,
    fields: { ...template.fields },
    volunteers: !!template.volunteers,
    volunteerIds: [],
    recurring: !!template.recurring,
    reminder: { ...template.reminder },
    status: 'open',
    seatsTaken: 0,
    seats: {},
    waitlist: [],
    needsContact: 0,
    counts: computeCounts([], { date }),
    stats: null,
    headcount: null,
    closedAt: null,
  });
  return ref.id;
}

export async function getProgram(pid) {
  const snap = await getDoc(programRef(pid));
  return snap.exists() ? withId(snap) : null;
}

/** Programs with a date in [fromDate, toDate], oldest first. Dates are 'YYYY-MM-DD'. */
export async function listPrograms(fromDate, toDateStr) {
  const parts = [orderBy('date')];
  if (fromDate) parts.push(where('date', '>=', fromDate));
  if (toDateStr) parts.push(where('date', '<=', toDateStr));
  const snap = await getDocs(query(collection(db, 'programs'), ...parts));
  return snap.docs.map(withId);
}

/** Live updates for one program. Returns a function that stops listening. */
export function watchProgram(pid, onChange, onError) {
  return onSnapshot(programRef(pid), (snap) => onChange(snap.exists() ? withId(snap) : null), onError);
}

/**
 * Live updates for a program's sign-ups. The filter on purgeAfter is not
 * optional: the security rules reject any list that could include expired
 * records.
 */
export function watchSignups(pid, onChange, onError) {
  const q = query(signupsCol(pid), where('purgeAfter', '>', Timestamp.now()));
  return onSnapshot(q, (snap) => onChange(snap.docs.map(withId)), onError);
}

export async function listSignups(pid) {
  const q = query(signupsCol(pid), where('purgeAfter', '>', Timestamp.now()));
  return (await getDocs(q)).docs.map(withId);
}

// ---------------------------------------------------------------- sign-ups

function requireOpen(program) {
  if (!program) throw new UserError('That program no longer exists.');
  if (program.status === 'closed') throw new UserError('This program is closed out. It can no longer be changed.');
}

/**
 * Add one child. Decides registered vs waitlisted inside a transaction, so
 * two desk computers cannot both take the last seat.
 *
 * input: fields from the form, plus for slotted programs { slot, trackId }.
 * Returns { id, status }.
 */
export async function addSignup(pid, input) {
  const retentionDays = await getRetentionDays();
  const newRef = doc(signupsCol(pid));

  const result = await runTransaction(db, async (tx) => {
    const pSnap = await tx.get(programRef(pid));
    const program = pSnap.exists() ? withId(pSnap) : null;
    requireOpen(program);

    const { data, errors } = cleanSignupInput(input, program);
    const firstError = Object.values(errors)[0];
    if (firstError) throw new UserError(firstError);

    const update = {};
    let status;
    let slot = null;
    let trackId = null;
    const wantsSeat = input.slot != null && input.trackId != null;

    if (program.kind === 'slotted') {
      if (wantsSeat) {
        const key = seatKey(input.slot, input.trackId);
        const track = (program.tracks || []).find((t) => t.id === input.trackId);
        if (!track || !program.slots[input.slot]) throw new UserError('That time slot does not exist.');
        if (program.seats?.[key]) throw new UserError('That time slot was just taken. Pick another.');
        slot = Number(input.slot);
        trackId = input.trackId;
        update.seats = { ...(program.seats || {}), [key]: newRef.id };
        status = data.walkIn ? STATUS.attended : STATUS.registered;
      } else if (data.walkIn) {
        status = STATUS.attended; // walk-in with no slot: counted, not seated
      } else {
        status = STATUS.waitlisted;
      }
    } else if (data.walkIn) {
      status = STATUS.attended; // roster walk-ins do not use up a seat
    } else if ((program.seatsTaken || 0) < program.capacity) {
      status = STATUS.registered;
      update.seatsTaken = (program.seatsTaken || 0) + 1;
    } else {
      status = STATUS.waitlisted;
    }
    if (status === STATUS.waitlisted) update.waitlist = [...(program.waitlist || []), newRef.id];

    const purgeAfter = Timestamp.fromDate(computePurgeAfter(program.retainFrom || program.endsAt, retentionDays));
    tx.set(newRef, {
      ...data,
      status,
      slot,
      trackId,
      needsContact: false,
      reminded: false,
      seriesKey: input.seriesKey || null,
      createdAt: Timestamp.now(),
      cancelledAt: null,
      purgeAfter,
    });
    tx.set(ticketRef(newRef.id), { programId: pid, purgeAfter });
    if (Object.keys(update).length) tx.update(programRef(pid), update);
    return { id: newRef.id, status };
  });

  await refreshCounts(pid);
  return result;
}

/** Edit the typed fields of a sign-up (name, contact, notes). Not its status. */
export async function updateSignup(pid, sid, input) {
  await runTransaction(db, async (tx) => {
    const pSnap = await tx.get(programRef(pid));
    const program = pSnap.exists() ? withId(pSnap) : null;
    requireOpen(program);
    const sSnap = await tx.get(signupRef(pid, sid));
    if (!sSnap.exists()) throw new UserError('That sign-up no longer exists.');
    const { data, errors } = cleanSignupInput({ ...input, walkIn: sSnap.data().walkIn }, program);
    const firstError = Object.values(errors)[0];
    if (firstError) throw new UserError(firstError);
    tx.update(signupRef(pid, sid), data);
  });
  await refreshCounts(pid);
}

/**
 * Cancel a sign-up. If the child held a seat and someone is waiting, the
 * first child on the waitlist takes the seat and is flagged "needs contact".
 * Returns { promotedId } (null when nobody was promoted).
 */
export async function cancelSignup(pid, sid) {
  const result = await runTransaction(db, async (tx) => {
    const pSnap = await tx.get(programRef(pid));
    const program = pSnap.exists() ? withId(pSnap) : null;
    requireOpen(program);
    const sSnap = await tx.get(signupRef(pid, sid));
    if (!sSnap.exists()) throw new UserError('That sign-up no longer exists.');
    const s = sSnap.data();
    if (s.status === STATUS.cancelled) return { promotedId: null };

    let waitlist = [...(program.waitlist || [])];
    const update = {};
    let needsContact = program.needsContact || 0;
    if (s.needsContact) needsContact -= 1;
    let promotedId = null;

    if (s.status === STATUS.waitlisted) {
      waitlist = waitlist.filter((id) => id !== sid);
      update.waitlist = waitlist;
    } else if (!s.walkIn || s.slot != null) {
      // The child held a seat. Free it, then offer it to the waitlist.
      const seats = { ...(program.seats || {}) };
      const key = s.slot != null ? seatKey(s.slot, s.trackId) : null;
      let seatsTaken = program.seatsTaken || 0;
      if (key) delete seats[key];
      else seatsTaken -= 1;

      // Find the first waitlisted child whose record is still there.
      let next = null;
      while (waitlist.length && !next) {
        const candidateId = waitlist.shift();
        const cSnap = await tx.get(signupRef(pid, candidateId));
        if (cSnap.exists() && cSnap.data().status === STATUS.waitlisted) next = cSnap;
      }
      if (next) {
        promotedId = next.id;
        const promote = { status: STATUS.registered, needsContact: true };
        if (key) {
          promote.slot = s.slot;
          promote.trackId = s.trackId;
          seats[key] = next.id;
        } else {
          seatsTaken += 1;
        }
        tx.update(next.ref, promote);
        needsContact += 1;
      }
      update.waitlist = waitlist;
      if (program.kind === 'slotted') update.seats = seats;
      else update.seatsTaken = Math.max(0, seatsTaken);
    }

    update.needsContact = Math.max(0, needsContact);
    tx.update(signupRef(pid, sid), {
      status: STATUS.cancelled,
      cancelledAt: Timestamp.now(),
      needsContact: false,
      slot: null,
      trackId: null,
    });
    tx.update(programRef(pid), update);
    return { promotedId };
  });
  await refreshCounts(pid);
  return result;
}

/** Mark a seated child attended or no-show, or put them back to registered. */
export async function setAttendance(pid, sid, status) {
  if (![STATUS.attended, STATUS.noShow, STATUS.registered].includes(status)) {
    throw new UserError('Unknown attendance status.');
  }
  await runTransaction(db, async (tx) => {
    const pSnap = await tx.get(programRef(pid));
    requireOpen(pSnap.exists() ? withId(pSnap) : null);
    const sSnap = await tx.get(signupRef(pid, sid));
    if (!sSnap.exists()) throw new UserError('That sign-up no longer exists.');
    const s = sSnap.data();
    if (s.walkIn) throw new UserError('Walk-ins are already counted as attended.');
    if (!holdsSeat(s.status)) throw new UserError('Only children with a seat can be marked attended or no-show.');
    tx.update(signupRef(pid, sid), { status });
  });
  await refreshCounts(pid);
}

/** Staff reached the family of a child promoted from the waitlist. */
export async function markContacted(pid, sid) {
  await runTransaction(db, async (tx) => {
    const pSnap = await tx.get(programRef(pid));
    const sSnap = await tx.get(signupRef(pid, sid));
    if (!pSnap.exists() || !sSnap.exists()) throw new UserError('That sign-up no longer exists.');
    if (!sSnap.data().needsContact) return;
    tx.update(signupRef(pid, sid), { needsContact: false });
    tx.update(programRef(pid), { needsContact: Math.max(0, (pSnap.data().needsContact || 0) - 1) });
  });
}

/** Tick or untick "reminded". The tick lives on the sign-up and is wiped with it. */
export async function setReminded(pid, sid, reminded) {
  await updateDoc(signupRef(pid, sid), { reminded: !!reminded });
}

// ------------------------------------------------------- counts and close-out

/**
 * Recount a program from its sign-ups and save the numbers on the program.
 * Runs after every change, so the numbers are already there when the people
 * are wiped. Does nothing once a program is closed: closed stats are frozen.
 */
export async function refreshCounts(pid) {
  const program = await getProgram(pid);
  if (!program || program.status === 'closed') return null;
  const counts = computeCounts(await listSignups(pid), program);
  if (!sameCounts(counts, program.counts)) await updateDoc(programRef(pid), { counts });
  return counts;
}

/**
 * Close out a program: take a final count, add the optional headcount
 * ({ children, teens, adults }, any may be blank), and freeze the stats.
 */
export async function closeOut(pid, headcount) {
  const program = await getProgram(pid);
  requireOpen(program);
  const counts = computeCounts(await listSignups(pid), program);
  const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.round(Number(v))));
  const hc = { children: num(headcount?.children), teens: num(headcount?.teens), adults: num(headcount?.adults) };
  await updateDoc(programRef(pid), {
    counts,
    stats: counts,
    headcount: hc,
    status: 'closed',
    closedAt: Timestamp.now(),
    needsContact: 0,
  });
  return counts;
}

// ------------------------------------------------------------------- purge

/**
 * If a program was never closed out, freeze its last saved counts as its
 * stats. Called just before its people are wiped.
 */
async function freezeStatsIfOpen(pid) {
  const program = await getProgram(pid);
  if (!program || program.status === 'closed') return;
  await updateDoc(programRef(pid), {
    stats: program.counts || null,
    status: 'closed',
    closedAt: Timestamp.now(),
    needsContact: 0,
    waitlist: [],
  });
}

/**
 * Layer one of the wipe. Runs every time a signed-in user opens the app.
 *
 * Looks up due tickets (IDs and dates only), then deletes each expired
 * sign-up without reading it: the rules would refuse the read anyway.
 * If a program was never closed out, its last saved counts are frozen as
 * its stats first, so the numbers outlive the people.
 *
 * Returns the number of sign-ups deleted.
 */
export async function runPurge(now = new Date()) {
  // Two minutes of slack so a desk clock running fast cannot trip the rules.
  const cutoff = Timestamp.fromMillis(toDate(now).getTime() - 2 * 60 * 1000);
  let deleted = 0;
  const frozen = new Set();

  for (;;) {
    const due = await getDocs(query(collection(db, 'purgeQueue'), where('purgeAfter', '<=', cutoff), limit(100)));
    if (due.empty) break;

    for (const pid of new Set(due.docs.map((t) => t.data().programId))) {
      if (frozen.has(pid)) continue;
      frozen.add(pid);
      await freezeStatsIfOpen(pid);
    }

    let failed = 0;
    for (const t of due.docs) {
      const batch = writeBatch(db);
      batch.delete(signupRef(t.data().programId, t.id));
      batch.delete(t.ref);
      try {
        await batch.commit();
        deleted += 1;
      } catch (e) {
        failed += 1;
        console.error('Purge could not delete a sign-up', t.id, e.code || e.message);
      }
    }
    if (failed === due.size) break; // nothing is moving; stop instead of looping forever
  }
  return deleted;
}
