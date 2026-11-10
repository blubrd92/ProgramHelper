// End-to-end test of the data layer with the security rules switched ON.
// Staff and admin act through the same functions the screens use.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { doc, getDoc, getDocs, updateDoc, collection, Timestamp } from 'firebase/firestore';
import { makeEnv, DAY } from './helpers.mjs';
import * as store from '../docs/js/data/store.js';
import { STARTER_TEMPLATES } from '../docs/js/data/starter-templates.js';
import { localDateString } from '../docs/js/data/model.js';

let t;
let pid;
const ids = {};
const asStaff = () => store.setDb(t.staff);
const asAdmin = () => store.setDb(t.admin);
const inDays = (n) => localDateString(new Date(Date.now() + n * DAY));
const kid = (first, initial, extra = {}) => ({
  childFirst: first, childInitial: initial, age: 7, caregiverFirst: 'Juniper',
  phone: '415-555-0142', email: `${first.toLowerCase()}@example.test`, language: 'en', notes: 'likes dragons', ...extra,
});

before(async () => { t = await makeEnv('demo-programhelper'); });
after(() => t.env.cleanup());

test('staff cannot install templates or create a program; admin can', async () => {
  asStaff();
  await assert.rejects(store.installStarterTemplates());
  asAdmin();
  assert.equal(await store.installStarterTemplates(), 3);
  assert.equal(await store.installStarterTemplates(), 0, 'installing twice adds nothing');
  const template = (await store.listTemplates()).find((x) => x.id === 'starter-roster');
  asStaff();
  await assert.rejects(store.createProgram(template, { name: 'Nope', date: inDays(3) }));
  asAdmin();
  pid = await store.createProgram(template, { name: 'Fake Bookmaking Workshop', date: inDays(3), capacity: 2 });
  assert.ok(pid);
});

test('sign-ups fill the seats, then go to the waitlist in order', async () => {
  asStaff();
  const a = await store.addSignup(pid, kid('Pepper', 'Z'));
  const b = await store.addSignup(pid, kid('Olive', 'Q', { language: 'es' }));
  const c = await store.addSignup(pid, kid('Basil', 'K'));
  const d = await store.addSignup(pid, kid('Clover', 'W', { email: '' }));
  Object.assign(ids, { a: a.id, b: b.id, c: c.id, d: d.id });
  assert.deepEqual([a.status, b.status, c.status, d.status], ['registered', 'registered', 'waitlisted', 'waitlisted']);
  assert.deepEqual([a.waitlistPosition, c.waitlistPosition, d.waitlistPosition], [null, 1, 2]);
  const p = await store.getProgram(pid);
  assert.equal(p.seatsTaken, 2);
  assert.deepEqual(p.waitlist, [c.id, d.id]);
  assert.equal(p.counts.registered, 2);
  assert.equal(p.counts.waitlisted, 2);
});

test('bad input is refused with a readable message', async () => {
  asStaff();
  await assert.rejects(store.addSignup(pid, { childFirst: 'Sage', childInitial: 'T' }), /phone number/);
  await assert.rejects(store.addSignup(pid, { childFirst: '', childInitial: 'T', phone: '415-555-0100' }), /first name/);
});

test('every sign-up has a wipe date of program end + 14 days, and a ticket', async () => {
  asStaff();
  const p = await store.getProgram(pid);
  const signups = await store.listSignups(pid);
  assert.equal(signups.length, 4);
  for (const s of signups) {
    assert.equal(s.purgeAfter.toMillis(), p.endsAt.toMillis() + 14 * DAY);
    const ticket = await getDoc(doc(t.staff, 'purgeQueue', s.id));
    assert.equal(ticket.data().purgeAfter.toMillis(), s.purgeAfter.toMillis());
    assert.deepEqual(Object.keys(ticket.data()).sort(), ['programId', 'purgeAfter']);
  }
});

test('cancelling a registered child promotes the first waitlisted child and flags them', async () => {
  asStaff();
  const { promotedId } = await store.cancelSignup(pid, ids.a);
  assert.equal(promotedId, ids.c);
  const p = await store.getProgram(pid);
  assert.equal(p.seatsTaken, 2);
  assert.deepEqual(p.waitlist, [ids.d]);
  assert.equal(p.needsContact, 1);
  const byId = Object.fromEntries((await store.listSignups(pid)).map((s) => [s.id, s]));
  assert.equal(byId[ids.a].status, 'cancelled');
  assert.equal(byId[ids.c].status, 'registered');
  assert.equal(byId[ids.c].needsContact, true);
  await store.markContacted(pid, ids.c);
  assert.equal((await store.getProgram(pid)).needsContact, 0);
});

test('cancelling a waitlisted child just removes them from the line', async () => {
  asStaff();
  const { promotedId } = await store.cancelSignup(pid, ids.d);
  assert.equal(promotedId, null);
  const p = await store.getProgram(pid);
  assert.deepEqual(p.waitlist, []);
  assert.equal(p.seatsTaken, 2);
});

test('editing a sign-up, ticking reminded, attendance, walk-ins', async () => {
  asStaff();
  await store.updateSignup(pid, ids.b, kid('Olive', 'Q', { language: 'es', notes: 'arrives late' }));
  await store.setReminded(pid, ids.b, true);
  await store.setAttendance(pid, ids.b, 'attended');
  await store.setAttendance(pid, ids.c, 'noShow');
  const w = await store.addSignup(pid, { childFirst: 'Maple', walkIn: true, age: 9 });
  assert.equal(w.status, 'attended');
  ids.w = w.id;
  const p = await store.getProgram(pid);
  assert.equal(p.seatsTaken, 2, 'a walk-in does not use a seat');
  const c = p.counts;
  assert.deepEqual(
    [c.registered, c.attended, c.noShows, c.cancelled, c.waitlisted, c.walkIns, c.totalAttendance],
    [2, 1, 1, 2, 0, 1, 2]);
});

test('close-out freezes the stats with the optional headcount', async () => {
  asStaff();
  await store.closeOut(pid, { children: 3, teens: '', adults: 2 });
  const p = await store.getProgram(pid);
  assert.equal(p.status, 'closed');
  assert.deepEqual(p.headcount, { children: 3, teens: null, adults: 2 });
  assert.equal(p.stats.totalAttendance, 2);
  await assert.rejects(store.addSignup(pid, kid('Late', 'L')), /closed out/);
  await assert.rejects(store.cancelSignup(pid, ids.b), /closed out/);
});

test('nothing is purged before its date', async () => {
  asStaff();
  assert.equal(await store.runPurge(), 0);
  assert.equal((await store.listSignups(pid)).length, 5);
});

test('after the date: every person is gone, every count is still there', async () => {
  // Move the clock: backdate the wipe date on all sign-ups and tickets.
  const gone = Timestamp.fromMillis(Date.now() - DAY);
  await t.raw(async (d) => {
    for (const s of (await getDocs(collection(d, `programs/${pid}/signups`))).docs) {
      await updateDoc(s.ref, { purgeAfter: gone });
      await updateDoc(doc(d, 'purgeQueue', s.id), { purgeAfter: gone });
    }
  });
  asStaff();
  // Layer two: unreadable even before the purge has run.
  await assert.rejects(getDoc(doc(t.staff, `programs/${pid}/signups/${ids.b}`)));
  assert.equal((await store.listSignups(pid)).length, 0);

  // Layer one: opening the app deletes them.
  assert.equal(await store.runPurge(), 5);

  // Look at the raw database with the rules off. Nothing personal may remain anywhere.
  await t.raw(async (d) => {
    assert.equal((await getDocs(collection(d, `programs/${pid}/signups`))).size, 0);
    assert.equal((await getDocs(collection(d, 'purgeQueue'))).size, 0);
    const everything = [];
    for (const name of ['programs', 'settings', 'templates', 'volunteers', 'purgeQueue']) {
      for (const snap of (await getDocs(collection(d, name))).docs) everything.push(JSON.stringify(snap.data()));
    }
    const dump = everything.join('\n');
    for (const personal of ['Pepper', 'Olive', 'Basil', 'Clover', 'Maple', 'Juniper', '415-555', 'example.test', 'dragons', 'arrives late']) {
      assert.ok(!dump.includes(personal), `"${personal}" survived the purge`);
    }
    const p = (await getDoc(doc(d, 'programs', pid))).data();
    assert.equal(p.stats.registered, 2);
    assert.equal(p.stats.attended, 1);
    assert.equal(p.stats.walkIns, 1);
    assert.deepEqual(p.headcount, { children: 3, teens: null, adults: 2 });
  });
});

test('a program nobody closed out still keeps its counts through the purge', async () => {
  asAdmin();
  const template = (await store.listTemplates()).find((x) => x.id === 'starter-roster');
  const p2 = await store.createProgram(template, { name: 'Fake Craft Hour', date: inDays(2) });
  asStaff();
  const s1 = await store.addSignup(p2, kid('Wren', 'A'));
  await store.addSignup(p2, kid('Lark', 'B'));
  await store.setAttendance(p2, s1.id, 'attended');
  const gone = Timestamp.fromMillis(Date.now() - DAY);
  await t.raw(async (d) => {
    for (const s of (await getDocs(collection(d, `programs/${p2}/signups`))).docs) {
      await updateDoc(s.ref, { purgeAfter: gone });
      await updateDoc(doc(d, 'purgeQueue', s.id), { purgeAfter: gone });
    }
  });
  assert.equal(await store.runPurge(), 2);
  const after = await store.getProgram(p2);
  assert.equal(after.status, 'closed');
  assert.equal(after.stats.registered, 2);
  assert.equal(after.stats.attended, 1);
});

test('admin changing retention re-dates live sign-ups; staff cannot change it', async () => {
  asAdmin();
  const template = (await store.listTemplates()).find((x) => x.id === 'starter-roster');
  const p3 = await store.createProgram(template, { name: 'Fake Story Lab', date: inDays(5) });
  asStaff();
  await store.addSignup(p3, kid('Finch', 'C'));
  await assert.rejects(store.saveRetentionDays(7));
  asAdmin();
  assert.equal(await store.saveRetentionDays(7), 1);
  const p = await store.getProgram(p3);
  const [s] = await store.listSignups(p3);
  assert.equal(s.purgeAfter.toMillis(), p.endsAt.toMillis() + 7 * DAY);
  assert.equal(await store.saveRetentionDays(99), 1, '99 is clamped to 30');
  assert.equal(await store.getRetentionDays(), 30);
  const [s2] = await store.listSignups(p3);
  assert.equal(s2.purgeAfter.toMillis(), p.endsAt.toMillis() + 30 * DAY);
});

test('a slotted program: seats, a taken slot, waitlist, promotion into the freed slot', async () => {
  asAdmin();
  const template = (await store.listTemplates()).find((x) => x.id === 'starter-read-to-a-dog');
  const p4 = await store.createProgram(template, { name: 'Fake Read to a Dog', date: inDays(6) });
  asStaff();
  const a = await store.addSignup(p4, { ...kid('Robin', 'D'), slot: 0, trackId: 't1' });
  assert.equal(a.status, 'registered');
  await assert.rejects(store.addSignup(p4, { ...kid('Jay', 'E'), slot: 0, trackId: 't1' }), /just taken/);
  const w = await store.addSignup(p4, kid('Dove', 'F'));
  assert.equal(w.status, 'waitlisted');
  const { promotedId } = await store.cancelSignup(p4, a.id);
  assert.equal(promotedId, w.id);
  const p = await store.getProgram(p4);
  assert.equal(p.seats['0_t1'], w.id);
  const promoted = (await store.listSignups(p4)).find((s) => s.id === w.id);
  assert.deepEqual([promoted.slot, promoted.trackId, promoted.needsContact], [0, 't1', true]);
});

test('tracks: add a second dog, assign volunteers, call out, move a child, remove a track', async () => {
  asAdmin();
  const template = (await store.listTemplates()).find((x) => x.id === 'starter-read-to-a-dog');
  const p = await store.createProgram(template, { name: 'Fake Read to a Dog 2', date: inDays(7) });
  const vol = await store.saveVolunteer(null, { firstName: 'Fern', lastInitial: 'q', dogName: 'Biscuit', note: '' });
  asStaff();
  await assert.rejects(store.saveVolunteer(null, { firstName: 'Moss' }));
  await store.addTrack(p);
  await store.setTrack(p, 't2', { volunteerId: vol, status: 'confirmed' });
  const a = await store.addSignup(p, { ...kid('Heron', 'G'), slot: 1, trackId: 't2' });
  await assert.rejects(store.removeTrack(p, 't2'), /still booked/);
  const w = await store.addSignup(p, kid('Swift', 'H'));

  await store.setTrack(p, 't2', { status: 'calledOut' });
  let prog = await store.getProgram(p);
  assert.deepEqual(prog.tracks[1], { id: 't2', volunteerId: vol, status: 'calledOut' });
  await assert.rejects(store.addSignup(p, { ...kid('Owl', 'I'), slot: 0, trackId: 't2' }), /called out/);

  // Move the affected child to the other dog; seat the waitlisted child by hand.
  await store.moveSignup(p, a.id, 1, 't1');
  await store.moveSignup(p, w.id, 2, 't1');
  prog = await store.getProgram(p);
  assert.deepEqual(prog.seats, { '1_t1': a.id, '2_t1': w.id });
  assert.deepEqual(prog.waitlist, []);
  assert.equal(prog.needsContact, 1, 'a child seated from the waitlist is flagged');
  await store.removeTrack(p, 't2');
  assert.equal((await store.getProgram(p)).tracks.length, 1);
  await assert.rejects(store.removeTrack(p, 't1'), /at least one/);
});

test('a freed slot in a called-out column is not refilled from the waitlist', async () => {
  asAdmin();
  const template = (await store.listTemplates()).find((x) => x.id === 'starter-read-to-a-dog');
  const p = await store.createProgram(template, { name: 'Fake Read to a Dog 3', date: inDays(7) });
  asStaff();
  const a = await store.addSignup(p, { ...kid('Crane', 'J'), slot: 0, trackId: 't1' });
  await store.addSignup(p, kid('Stork', 'K'));
  await store.setTrack(p, 't1', { status: 'calledOut' });
  assert.equal((await store.cancelSignup(p, a.id)).promotedId, null);
});

test('admin can delete a program only while it has never had a sign-up', async () => {
  asAdmin();
  const template = (await store.listTemplates()).find((x) => x.id === 'starter-roster');
  const empty = await store.createProgram(template, { name: 'Fake Mistake', date: inDays(9) });
  const used = await store.createProgram(template, { name: 'Fake Used', date: inDays(9) });
  asStaff();
  const s = await store.addSignup(used, kid('Teal', 'L'));
  await store.cancelSignup(used, s.id);
  await assert.rejects(store.deleteProgram(empty));
  asAdmin();
  await assert.rejects(store.deleteProgram(used), /cannot be deleted/);
  await store.deleteProgram(empty);
  assert.equal(await store.getProgram(empty), null);
});

test('templates: admin saves, duplicates and deletes; bad input is refused', async () => {
  asAdmin();
  const base = (await store.listTemplates()).find((x) => x.id === 'starter-roster');
  const copy = await store.saveTemplate(null, { ...base, name: 'Fake Lego Club', capacity: 12 });
  assert.equal((await store.listTemplates()).find((x) => x.id === copy).capacity, 12);
  await assert.rejects(store.saveTemplate(null, { ...base, name: '' }), /name/);
  await assert.rejects(store.saveTemplate(null, { ...base, capacity: 0 }), /Seats/);
  await store.deleteTemplate(copy);
  asStaff();
  await assert.rejects(store.saveTemplate(null, { ...base, name: 'Staff Try' }));
});

test('series: duplicating with the roster links the children and extends their wipe date', async () => {
  asAdmin();
  await store.saveRetentionDays(14);
  const template = (await store.listTemplates()).find((x) => x.id === 'starter-book-club');
  const sept = await store.createProgram(template, { name: 'Fake Book Club', date: inDays(1), capacity: 3 });
  asStaff();
  const a = await store.addSignup(sept, kid('Plum', 'M'));
  const b = await store.addSignup(sept, kid('Fig', 'N'));
  const oneOff = await store.addSignup(sept, kid('Pear', 'O'));
  await store.cancelSignup(sept, oneOff.id);
  await store.addSignup(sept, { childFirst: 'Kiwi', walkIn: true });
  await assert.rejects(store.duplicateProgram(sept, { date: inDays(29), carryRoster: true }), 'staff cannot duplicate');

  asAdmin();
  const { id: oct, carried } = await store.duplicateProgram(sept, { date: inDays(29), carryRoster: true });
  assert.equal(carried, 2, 'cancelled children and walk-ins are not carried');
  const [pSept, pOct] = [await store.getProgram(sept), await store.getProgram(oct)];
  assert.equal(pSept.seriesId, sept);
  assert.equal(pOct.seriesId, sept);
  assert.equal(pOct.seatsTaken, 2);
  assert.equal(pSept.purgeCeiling.toMillis(), pOct.purgeCeiling.toMillis());

  asStaff();
  const octEnd = pOct.endsAt.toMillis();
  const septEnd = pSept.endsAt.toMillis();
  const byName = async (pid) => Object.fromEntries((await store.listSignups(pid)).map((s) => [s.childFirst, s]));
  let s1 = await byName(sept);
  assert.equal(s1.Plum.purgeAfter.toMillis(), octEnd + 14 * DAY, 'carried child: clock starts after the last session');
  assert.equal(s1.Fig.purgeAfter.toMillis(), octEnd + 14 * DAY);
  assert.equal(s1.Pear.purgeAfter.toMillis(), septEnd + 14 * DAY, 'one-off child keeps the session clock');
  assert.equal(s1.Kiwi.purgeAfter.toMillis(), septEnd + 14 * DAY);
  const ticket = await getDoc(doc(t.staff, 'purgeQueue', s1.Plum.id));
  assert.equal(ticket.data().purgeAfter.toMillis(), octEnd + 14 * DAY, 'ticket moves with the sign-up');

  // Plum drops out of October: the September record goes back to its own clock.
  const s2 = await byName(oct);
  await store.cancelSignup(oct, s2.Plum.id);
  s1 = await byName(sept);
  assert.equal(s1.Plum.purgeAfter.toMillis(), septEnd + 14 * DAY);
  assert.equal(s1.Fig.purgeAfter.toMillis(), octEnd + 14 * DAY);

  // A retention change respects the series too.
  asAdmin();
  await store.saveRetentionDays(7);
  s1 = await byName(sept);
  assert.equal(s1.Fig.purgeAfter.toMillis(), octEnd + 7 * DAY);
  assert.equal(s1.Plum.purgeAfter.toMillis(), septEnd + 7 * DAY);
  await store.saveRetentionDays(14);
});

test('purge works the same for a time-slot program and a series; only numbers remain', async () => {
  asAdmin();
  const templates = await store.listTemplates();
  const dog = await store.createProgram(templates.find((x) => x.id === 'starter-read-to-a-dog'), { name: 'Fake Dog Day', date: inDays(2) });
  const club = await store.createProgram(templates.find((x) => x.id === 'starter-book-club'), { name: 'Fake Club', date: inDays(2) });
  asStaff();
  const a = await store.addSignup(dog, { ...kid('Zinnia', 'P'), slot: 0, trackId: 't1' });
  await store.addSignup(dog, kid('Yarrow', 'Q'));
  await store.setAttendance(dog, a.id, 'attended');
  await store.setReminded(dog, a.id, true);
  await store.addSignup(club, kid('Xanthe', 'R'));
  asAdmin();
  const { id: club2 } = await store.duplicateProgram(club, { date: inDays(20), carryRoster: true });
  asStaff();
  await store.closeOut(dog, { children: 1, teens: 0, adults: 1 });

  const gone = Timestamp.fromMillis(Date.now() - DAY);
  await t.raw(async (d) => {
    for (const pidX of [dog, club, club2]) {
      for (const s of (await getDocs(collection(d, `programs/${pidX}/signups`))).docs) {
        await updateDoc(s.ref, { purgeAfter: gone });
        await updateDoc(doc(d, 'purgeQueue', s.id), { purgeAfter: gone });
      }
    }
  });
  assert.equal(await store.runPurge(), 4);
  await t.raw(async (d) => {
    const dump = [];
    for (const name of ['programs', 'settings', 'templates', 'volunteers', 'purgeQueue']) {
      for (const snap of (await getDocs(collection(d, name))).docs) dump.push(JSON.stringify(snap.data()));
    }
    for (const pidX of [dog, club, club2]) assert.equal((await getDocs(collection(d, `programs/${pidX}/signups`))).size, 0);
    for (const personal of ['Zinnia', 'Yarrow', 'Xanthe', '415-555-0142', 'zinnia@', 'dragons']) {
      assert.ok(!dump.join('\n').includes(personal), `"${personal}" survived the purge`);
    }
    const p = (await getDoc(doc(d, 'programs', dog))).data();
    assert.deepEqual([p.stats.registered, p.stats.attended, p.stats.waitlisted], [1, 1, 1]);
    assert.deepEqual(p.headcount, { children: 1, teens: 0, adults: 1 });
    assert.equal((await getDoc(doc(d, 'programs', club))).data().stats.registered, 1);
  });
});
