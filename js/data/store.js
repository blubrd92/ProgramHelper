// Every read and write to the database goes through this file.
// Screens call these functions; they never talk to Firestore directly.
//
// Privacy rules this file keeps:
//   * Personal data is written only to programs/{id}/signups/{id}.
//   * Every sign-up is written together with its purge ticket.
//   * Program documents get numbers and IDs only, never names.

import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, where, orderBy, limit,
  onSnapshot, runTransaction, writeBatch, Timestamp,
} from 'firebase/firestore';
import {
  STATUS, holdsSeat, clampRetention, DEFAULT_RETENTION_DAYS, localDateTime,
  computePurgeAfter, computePurgeCeiling, seatKey, cleanSignupInput, computeCounts,
  sameCounts, toDate, cleanTemplate, cleanVolunteer,
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
export class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
  }
}

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

/**
 * Set one sign-up's wipe date (and its ticket's). If the wanted date has
 * already passed, the record is set to expire in five minutes, and the next
 * purge removes it. Returns true when something changed.
 */
async function setPurgeDate(pid, sid, wantedDate, currentTimestamp) {
  const soon = Date.now() + 5 * 60 * 1000;
  const wanted = Timestamp.fromMillis(Math.max(toDate(wantedDate).getTime(), soon));
  if (currentTimestamp && Math.abs(wanted.toMillis() - currentTimestamp.toMillis()) < 1000) return false;
  if (currentTimestamp && currentTimestamp.toMillis() <= soon && wanted.toMillis() <= soon) return false;
  const batch = writeBatch(db);
  batch.update(signupRef(pid, sid), { purgeAfter: wanted });
  batch.update(ticketRef(sid), { purgeAfter: wanted });
  try {
    await batch.commit();
    return true;
  } catch (e) {
    return false; // it expired a moment ago; the purge removes it
  }
}

async function redateAllSignups(retentionDays) {
  const tickets = await getDocs(collection(db, 'purgeQueue'));
  const programs = new Map();
  const seriesIds = new Set();
  let changed = 0;
  for (const t of tickets.docs) {
    const { programId, purgeAfter } = t.data();
    if (!programs.has(programId)) programs.set(programId, await getProgram(programId));
    const program = programs.get(programId);
    if (!program) continue;
    if (program.seriesId) {
      seriesIds.add(program.seriesId); // series are handled together, below
      continue;
    }
    if (await setPurgeDate(programId, t.id, computePurgeAfter(program.endsAt, retentionDays), purgeAfter)) changed += 1;
  }
  for (const seriesId of seriesIds) changed += await syncSeriesRetention(seriesId, retentionDays);
  return changed;
}

/**
 * Recurring series (for example a monthly book club).
 *
 * A child carried from one session to the next has the same `seriesKey` on
 * each of their sign-ups. Their wipe clock starts after the LAST session
 * they are still registered for, so every one of their records in the series
 * gets that same wipe date. A child added by hand to a single session has no
 * seriesKey and simply follows that session's own date.
 */
export async function syncSeriesRetention(seriesId, retentionDays) {
  const days = retentionDays ?? await getRetentionDays();
  const snap = await getDocs(query(collection(db, 'programs'), where('seriesId', '==', seriesId)));
  const rows = [];
  for (const p of snap.docs.map(withId)) {
    for (const s of await listSignups(p.id)) rows.push({ p, s });
  }
  const lastEnd = new Map();
  for (const { p, s } of rows) {
    if (!s.seriesKey || s.status === STATUS.cancelled) continue;
    lastEnd.set(s.seriesKey, Math.max(lastEnd.get(s.seriesKey) || 0, p.endsAt.toMillis()));
  }
  let changed = 0;
  for (const { p, s } of rows) {
    const base = Math.max(p.endsAt.toMillis(), (s.seriesKey && lastEnd.get(s.seriesKey)) || 0);
    if (await setPurgeDate(p.id, s.id, computePurgeAfter(base, days), s.purgeAfter)) changed += 1;
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

/**
 * Admin only. Save a template. Pass id = null to make a new one (that is
 * also how "duplicate" works: load one, change the name, save with no id).
 */
export async function saveTemplate(id, input) {
  const { data, errors } = cleanTemplate(input);
  if (errors.length) throw new UserError(errors[0]);
  const ref = id ? doc(db, 'templates', id) : doc(collection(db, 'templates'));
  await setDoc(ref, data);
  return ref.id;
}

/** Admin only. Programs already made from the template are not affected. */
export async function deleteTemplate(id) {
  await deleteDoc(doc(db, 'templates', id));
}

// -------------------------------------------------------------- volunteers

export async function listVolunteers() {
  const snap = await getDocs(collection(db, 'volunteers'));
  return snap.docs.map(withId).sort((a, b) => a.firstName.localeCompare(b.firstName));
}

/** Admin only. First name, last initial, dog's name, short note. No contact info. */
export async function saveVolunteer(id, input) {
  const { data, errors } = cleanVolunteer(input);
  if (errors.length) throw new UserError(errors[0]);
  const ref = id ? doc(db, 'volunteers', id) : doc(collection(db, 'volunteers'));
  await setDoc(ref, data);
  return ref.id;
}

/** Admin only. */
export async function deleteVolunteer(id) {
  await deleteDoc(doc(db, 'volunteers', id));
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
    // signupTotal only ever goes up. A program can be deleted only while it is 0.
    signupTotal: 0,
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

/**
 * The "not yet expired" line used when listing sign-ups.
 *
 * The security rules only allow a list that cannot include expired records,
 * and they judge that by the SERVER's clock. A request takes a moment to
 * arrive, and a desk computer's clock can run a little slow, so asking for
 * "later than right now" can look to the server like "later than a moment
 * ago", and it refuses the whole list. Asking for "later than ten minutes
 * from now" is always on the safe side. The only cost: a sign-up drops off
 * the screen ten minutes before its wipe date, which is weeks after the program.
 */
const CLOCK_MARGIN_MS = 10 * 60 * 1000;
function liveCutoff() {
  return Timestamp.fromMillis(Date.now() + CLOCK_MARGIN_MS);
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
  const q = query(signupsCol(pid), where('purgeAfter', '>', liveCutoff()));
  return onSnapshot(q, (snap) => onChange(snap.docs.map(withId)), onError);
}

export async function listSignups(pid) {
  const q = query(signupsCol(pid), where('purgeAfter', '>', liveCutoff()));
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
 * Returns { id, status, waitlistPosition }.
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

    const update = { signupTotal: (program.signupTotal || 0) + 1 };
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
        if (track.status === 'calledOut') throw new UserError('That volunteer has called out. Pick a slot in another column.');
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

    const purgeAfter = Timestamp.fromDate(computePurgeAfter(program.endsAt, retentionDays));
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
    tx.update(programRef(pid), update);
    // waitlistPosition: the child's place in line (1 = next), or null.
    const waitlistPosition = status === STATUS.waitlisted ? update.waitlist.length : null;
    return { id: newRef.id, status, waitlistPosition };
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
      const freedTrack = key ? (program.tracks || []).find((t) => t.id === s.trackId) : null;
      const canRefill = !key || (freedTrack && freedTrack.status !== 'calledOut');
      let next = null;
      while (canRefill && waitlist.length && !next) {
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
    return { promotedId, seriesId: program.seriesId || null };
  });
  await refreshCounts(pid);
  // In a series, cancelling can shorten how long the child's records are kept.
  if (result.seriesId) await syncSeriesRetention(result.seriesId);
  return { promotedId: result.promotedId };
}

/** Mark a seated child attended or no-show, or put them back to registered. */
export async function setAttendance(pid, sid, status) {
  if (![STATUS.attended, STATUS.noShow, STATUS.registered].includes(status)) {
    throw new UserError('Unknown attendance status.');
  }
  // The program is checked outside the transaction on purpose. Staff click
  // attendance for many children quickly; if each click also locked the
  // program document, the clicks would trip over each other.
  requireOpen(await getProgram(pid));
  await runTransaction(db, async (tx) => {
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

/**
 * Move a child to a free time slot (slotted programs). Also used to seat a
 * waitlisted child or an unseated walk-in. A child seated from the waitlist
 * is flagged "needs contact", like an automatic promotion.
 */
export async function moveSignup(pid, sid, slot, trackId) {
  await runTransaction(db, async (tx) => {
    const pSnap = await tx.get(programRef(pid));
    const program = pSnap.exists() ? withId(pSnap) : null;
    requireOpen(program);
    const sSnap = await tx.get(signupRef(pid, sid));
    if (!sSnap.exists()) throw new UserError('That sign-up no longer exists.');
    const s = sSnap.data();
    if (s.status === STATUS.cancelled) throw new UserError('That sign-up is cancelled.');
    const track = (program.tracks || []).find((t) => t.id === trackId);
    if (!track || !program.slots?.[slot]) throw new UserError('That time slot does not exist.');
    if (track.status === 'calledOut') throw new UserError('That volunteer has called out. Pick a slot in another column.');
    const key = seatKey(slot, trackId);
    const seats = { ...(program.seats || {}) };
    if (seats[key] === sid) return;
    if (seats[key]) throw new UserError('That time slot was just taken. Pick another.');
    if (s.slot != null) delete seats[seatKey(s.slot, s.trackId)];
    seats[key] = sid;

    const update = { seats };
    const change = { slot: Number(slot), trackId };
    if (s.status === STATUS.waitlisted) {
      change.status = STATUS.registered;
      change.needsContact = true;
      update.waitlist = (program.waitlist || []).filter((id) => id !== sid);
      update.needsContact = (program.needsContact || 0) + 1;
    }
    tx.update(signupRef(pid, sid), change);
    tx.update(programRef(pid), update);
  });
  await refreshCounts(pid);
}

// ------------------------------------------------------ tracks and volunteers

/** Add a track (for Read to a Dog: a second dog) to one session. */
export async function addTrack(pid) {
  await runTransaction(db, async (tx) => {
    const pSnap = await tx.get(programRef(pid));
    const program = pSnap.exists() ? withId(pSnap) : null;
    requireOpen(program);
    const tracks = [...(program.tracks || [])];
    if (tracks.length >= 4) throw new UserError('A session can have at most four columns.');
    let n = tracks.length + 1;
    while (tracks.some((t) => t.id === `t${n}`)) n += 1;
    tracks.push({ id: `t${n}`, volunteerId: null, status: 'scheduled' });
    tx.update(programRef(pid), { tracks });
  });
}

/** Remove a track. Refused while children are still booked in it. */
export async function removeTrack(pid, trackId) {
  await runTransaction(db, async (tx) => {
    const pSnap = await tx.get(programRef(pid));
    const program = pSnap.exists() ? withId(pSnap) : null;
    requireOpen(program);
    if ((program.tracks || []).length <= 1) throw new UserError('A session needs at least one column.');
    const booked = Object.keys(program.seats || {}).filter((k) => k.endsWith(`_${trackId}`)).length;
    if (booked) {
      throw new UserError(`${booked} ${booked === 1 ? 'child is' : 'children are'} still booked in this column. Move or cancel them first.`);
    }
    tx.update(programRef(pid), { tracks: program.tracks.filter((t) => t.id !== trackId) });
  });
}

/**
 * Change a track's volunteer and/or status.
 * changes: { volunteerId?, status? } with status 'scheduled' | 'confirmed' | 'calledOut'.
 */
export async function setTrack(pid, trackId, changes) {
  await runTransaction(db, async (tx) => {
    const pSnap = await tx.get(programRef(pid));
    const program = pSnap.exists() ? withId(pSnap) : null;
    requireOpen(program);
    if (changes.status && !['scheduled', 'confirmed', 'calledOut'].includes(changes.status)) {
      throw new UserError('Unknown volunteer status.');
    }
    const tracks = (program.tracks || []).map((t) => (t.id !== trackId ? t : {
      ...t,
      volunteerId: 'volunteerId' in changes ? (changes.volunteerId || null) : t.volunteerId,
      status: changes.status || t.status,
    }));
    tx.update(programRef(pid), { tracks });
  });
}

/** Roster programs that track volunteers: which volunteers are helping. */
export async function setProgramVolunteers(pid, volunteerIds) {
  requireOpen(await getProgram(pid));
  await updateDoc(programRef(pid), { volunteerIds: [...new Set(volunteerIds)].slice(0, 20) });
}

// ------------------------------------------------- duplicate and delete programs

/**
 * Admin only. Make next month's program from this one: same settings, new
 * date. The two are linked as a series.
 *
 * carryRoster (roster programs only): also sign up the same children, in the
 * same order. This only works while the old program's sign-ups still exist,
 * that is, before its wipe date. Returns { id, carried }.
 */
export async function duplicateProgram(pid, { date, name, carryRoster }) {
  const source = await getProgram(pid);
  if (!source) throw new UserError('That program no longer exists.');
  const seriesId = source.seriesId || source.id;
  const template = {
    ...source,
    id: source.templateId,
    defaultTracks: (source.tracks || []).length,
  };
  const newId = await createProgram(template, {
    name: name || source.name, date, startTime: source.startTime, endTime: source.endTime, capacity: source.capacity,
  });

  // Link the series, and let every session in it keep records as long as the
  // newest session allows (the security rules check this ceiling).
  const members = (await getDocs(query(collection(db, 'programs'), where('seriesId', '==', seriesId)))).docs.map(withId);
  const created = await getProgram(newId);
  const all = [...members.filter((p) => p.id !== source.id), source, created];
  const ceiling = Timestamp.fromMillis(Math.max(...all.map((p) => p.purgeCeiling.toMillis())));
  for (const p of all) {
    const change = {};
    if (p.seriesId !== seriesId) change.seriesId = seriesId;
    if (p.purgeCeiling.toMillis() !== ceiling.toMillis()) change.purgeCeiling = ceiling;
    if (p.id === newId) change.tracks = (source.tracks || []).map((t) => ({ id: t.id, volunteerId: t.volunteerId || null, status: 'scheduled' }));
    if (Object.keys(change).length) await updateDoc(programRef(p.id), change);
  }

  let carried = 0;
  if (carryRoster && source.kind === 'roster') {
    const signups = (await listSignups(pid)).filter((s) => !s.walkIn && s.status !== STATUS.cancelled);
    const seated = signups.filter((s) => holdsSeat(s.status))
      .sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
    const waiting = (source.waitlist || []).map((id) => signups.find((s) => s.id === id)).filter(Boolean);
    for (const s of [...seated, ...waiting]) {
      const seriesKey = s.seriesKey || s.id;
      if (!s.seriesKey) await updateDoc(signupRef(pid, s.id), { seriesKey });
      await addSignup(newId, {
        childFirst: s.childFirst, childInitial: s.childInitial, age: s.age, caregiverFirst: s.caregiverFirst,
        phone: s.phone, email: s.email, language: s.language, languageOther: s.languageOther, notes: s.notes,
        seriesKey,
      });
      carried += 1;
    }
    if (carried) await syncSeriesRetention(seriesId);
  }
  return { id: newId, carried };
}

/** Admin only. Only a program that never had a sign-up can be deleted. */
export async function deleteProgram(pid) {
  const program = await getProgram(pid);
  if (!program) return;
  if ((program.signupTotal || 0) > 0) {
    throw new UserError('This program has had sign-ups, so it cannot be deleted. Its numbers are part of the stats.');
  }
  await deleteDoc(programRef(pid));
}

// ------------------------------------------------------- counts and close-out

/**
 * Recount a program from its sign-ups and save the numbers on the program.
 * Runs after every change, so the numbers are already there when the people
 * are wiped. Does nothing once a program is closed: closed stats are frozen.
 *
 * Recounts for the same program run one after another, never side by side,
 * so an older count can never be saved on top of a newer one.
 */
const recountQueue = new Map();
export function refreshCounts(pid) {
  const next = (recountQueue.get(pid) || Promise.resolve()).then(() => recount(pid), () => recount(pid));
  recountQueue.set(pid, next);
  return next;
}

async function recount(pid) {
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
