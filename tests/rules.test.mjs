// Security rules tests. Run with `npm test` (starts the emulator for you).
import { test, before, after } from 'node:test';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, writeBatch, Timestamp,
} from 'firebase/firestore';
import { makeEnv, ts, DAY, fakeSignup } from './helpers.mjs';

let t;
before(async () => {
  t = await makeEnv('demo-programhelper');
  await t.raw(async (d) => {
    await setDoc(doc(d, 'settings/main'), { retentionDays: 14 });
    await setDoc(doc(d, 'templates/t1'), { name: 'Fake template' });
    await setDoc(doc(d, 'volunteers/v1'), { firstName: 'Fern', lastInitial: 'Q', dogName: 'Biscuit', note: '' });
    await setDoc(doc(d, 'programs/p1'), {
      name: 'Fake Workshop', status: 'open', seatsTaken: 1, signupTotal: 3, capacity: 20, purgeCeiling: ts(30 * DAY),
    });
    await setDoc(doc(d, 'programs/empty'), { name: 'Fake Mistake', status: 'open', signupTotal: 0, purgeCeiling: ts(30 * DAY) });
    await setDoc(doc(d, 'programs/p1/signups/live'), fakeSignup({ purgeAfter: ts(5 * DAY) }));
    await setDoc(doc(d, 'purgeQueue/live'), { programId: 'p1', purgeAfter: ts(5 * DAY) });
    const gone = ts(-1 * DAY);
    await setDoc(doc(d, 'programs/p1/signups/expired'), fakeSignup({ childFirst: 'Olive', purgeAfter: gone }));
    await setDoc(doc(d, 'purgeQueue/expired'), { programId: 'p1', purgeAfter: gone });
    await setDoc(doc(d, 'programs/p1/signups/undated'), { childFirst: 'Basil', childInitial: 'K' });
  });
});
after(() => t.env.cleanup());

/** Write a sign-up and its ticket together, the way the app does. */
function pairWrite(db, sid, data, pid = 'p1') {
  const b = writeBatch(db);
  b.set(doc(db, `programs/${pid}/signups/${sid}`), data);
  b.set(doc(db, `purgeQueue/${sid}`), { programId: pid, purgeAfter: data.purgeAfter });
  return b.commit();
}

// ---- who can read at all

test('a signed-out visitor can read nothing', async () => {
  for (const path of ['settings/main', 'templates/t1', 'volunteers/v1', 'programs/p1',
    'programs/p1/signups/live', 'purgeQueue/live', 'users/staff1']) {
    await assertFails(getDoc(doc(t.anon, path)));
  }
  await assertFails(getDocs(collection(t.anon, 'programs')));
});

test('a signed-in account with no role document can read nothing', async () => {
  for (const path of ['settings/main', 'programs/p1', 'programs/p1/signups/live', 'purgeQueue/live']) {
    await assertFails(getDoc(doc(t.stranger, path)));
  }
});

test('nobody can give themselves a role from the app', async () => {
  await assertFails(setDoc(doc(t.stranger, 'users/stranger1'), { role: 'admin' }));
  await assertFails(updateDoc(doc(t.staff, 'users/staff1'), { role: 'admin' }));
  await assertFails(setDoc(doc(t.admin, 'users/staff1'), { role: 'admin' }));
});

// ---- staff vs admin

test('staff can read but not change settings, templates, volunteers', async () => {
  await assertSucceeds(getDoc(doc(t.staff, 'settings/main')));
  await assertSucceeds(getDoc(doc(t.staff, 'templates/t1')));
  await assertFails(setDoc(doc(t.staff, 'settings/main'), { retentionDays: 30 }));
  await assertFails(setDoc(doc(t.staff, 'templates/t1'), { name: 'Changed' }));
  await assertFails(setDoc(doc(t.staff, 'templates/new'), { name: 'New' }));
  await assertFails(deleteDoc(doc(t.staff, 'templates/t1')));
  await assertFails(setDoc(doc(t.staff, 'volunteers/v2'), { firstName: 'Moss' }));
});

test('admin can change settings, but retention is capped at 30 days', async () => {
  await assertSucceeds(setDoc(doc(t.admin, 'settings/main'), { retentionDays: 30 }));
  await assertFails(setDoc(doc(t.admin, 'settings/main'), { retentionDays: 31 }));
  await assertFails(setDoc(doc(t.admin, 'settings/main'), { retentionDays: 0 }));
  await assertFails(setDoc(doc(t.admin, 'settings/main'), { retentionDays: 14, extra: 'x' }));
  await assertSucceeds(setDoc(doc(t.admin, 'settings/main'), { retentionDays: 14 }));
  await assertSucceeds(setDoc(doc(t.admin, 'templates/t2'), { name: 'Admin template' }));
});

test('staff cannot create programs or edit their setup; they can update day-to-day fields', async () => {
  await assertFails(setDoc(doc(t.staff, 'programs/p2'), { name: 'Nope' }));
  await assertFails(updateDoc(doc(t.staff, 'programs/p1'), { name: 'Renamed' }));
  await assertFails(updateDoc(doc(t.staff, 'programs/p1'), { capacity: 99 }));
  await assertFails(updateDoc(doc(t.staff, 'programs/p1'), { purgeCeiling: ts(900 * DAY) }));
  await assertSucceeds(updateDoc(doc(t.staff, 'programs/p1'), { seatsTaken: 2, counts: { registered: 2 } }));
});

test('only the admin can delete a program, and only one that never had a sign-up', async () => {
  await assertFails(deleteDoc(doc(t.staff, 'programs/empty')));
  await assertFails(deleteDoc(doc(t.admin, 'programs/p1')));
  await assertSucceeds(deleteDoc(doc(t.admin, 'programs/empty')));
});

test('a volunteer record has no room for contact info', async () => {
  const v = { firstName: 'Moss', lastInitial: 'T', dogName: '', note: '' };
  await assertSucceeds(setDoc(doc(t.admin, 'volunteers/v3'), v));
  await assertFails(setDoc(doc(t.admin, 'volunteers/v4'), { ...v, phone: '415-555-0100' }));
  await assertFails(setDoc(doc(t.admin, 'volunteers/v5'), { ...v, lastInitial: 'Thorne' }));
  await assertFails(setDoc(doc(t.admin, 'volunteers/v6'), { ...v, note: 'x'.repeat(101) }));
});

// ---- the wipe, layer two

test('an expired sign-up cannot be read, even by the admin', async () => {
  await assertSucceeds(getDoc(doc(t.staff, 'programs/p1/signups/live')));
  await assertFails(getDoc(doc(t.staff, 'programs/p1/signups/expired')));
  await assertFails(getDoc(doc(t.admin, 'programs/p1/signups/expired')));
});

test('a sign-up with no wipe date cannot be read', async () => {
  await assertFails(getDoc(doc(t.staff, 'programs/p1/signups/undated')));
});

test('a list that could include expired sign-ups is refused outright', async () => {
  const col = collection(t.staff, 'programs/p1/signups');
  await assertFails(getDocs(col));
  await assertFails(getDocs(query(col, where('purgeAfter', '>', ts(-3 * DAY)))));
  await assertFails(getDocs(query(col, where('status', '==', 'registered'))));
});

test('a properly filtered list returns only live sign-ups', async () => {
  const col = collection(t.staff, 'programs/p1/signups');
  const snap = await assertSucceeds(getDocs(query(col, where('purgeAfter', '>', Timestamp.now()))));
  if (snap.size !== 1 || snap.docs[0].id !== 'live') throw new Error('expected only the live sign-up');
});

test('an expired sign-up cannot be edited or brought back to life', async () => {
  await assertFails(updateDoc(doc(t.staff, 'programs/p1/signups/expired'), { notes: 'x' }));
  const b = writeBatch(t.staff);
  b.update(doc(t.staff, 'programs/p1/signups/expired'), { purgeAfter: ts(5 * DAY) });
  b.update(doc(t.staff, 'purgeQueue/expired'), { purgeAfter: ts(5 * DAY) });
  await assertFails(b.commit());
});

// ---- writing sign-ups

test('staff can add a sign-up with its ticket', async () => {
  await assertSucceeds(pairWrite(t.staff, 'new1', fakeSignup()));
});

test('a sign-up without a matching ticket is refused', async () => {
  await assertFails(setDoc(doc(t.staff, 'programs/p1/signups/lonely'), fakeSignup()));
  const b = writeBatch(t.staff);
  b.set(doc(t.staff, 'programs/p1/signups/mismatch'), fakeSignup({ purgeAfter: ts(5 * DAY) }));
  b.set(doc(t.staff, 'purgeQueue/mismatch'), { programId: 'p1', purgeAfter: ts(6 * DAY) });
  await assertFails(b.commit());
});

test('a wipe date past the program ceiling, or in the past, is refused', async () => {
  await assertFails(pairWrite(t.staff, 'far', fakeSignup({ purgeAfter: ts(31 * DAY) })));
  await assertFails(pairWrite(t.staff, 'past', fakeSignup({ purgeAfter: ts(-1000) })));
});

test('a last name longer than one letter cannot be stored', async () => {
  await assertFails(pairWrite(t.staff, 'full', fakeSignup({ childInitial: 'Zamora' })));
});

test('extra fields cannot be smuggled onto a sign-up', async () => {
  await assertFails(pairWrite(t.staff, 'extra', { ...fakeSignup(), childLastName: 'Zamora' }));
  await assertFails(pairWrite(t.staff, 'extra2', { ...fakeSignup(), address: '1 Fake St' }));
});

test('a ticket can hold only an ID and a date', async () => {
  const b = writeBatch(t.staff);
  const s = fakeSignup();
  b.set(doc(t.staff, 'programs/p1/signups/tk'), s);
  b.set(doc(t.staff, 'purgeQueue/tk'), { programId: 'p1', purgeAfter: s.purgeAfter, name: 'Pepper Z' });
  await assertFails(b.commit());
});

// ---- deleting

test('staff cannot delete a live sign-up, or a ticket whose sign-up still exists', async () => {
  await assertFails(deleteDoc(doc(t.staff, 'programs/p1/signups/live')));
  await assertFails(deleteDoc(doc(t.staff, 'purgeQueue/live')));
  await assertFails(deleteDoc(doc(t.staff, 'purgeQueue/expired')));
});

test('staff can delete an expired sign-up and its ticket without reading it', async () => {
  const b = writeBatch(t.staff);
  b.delete(doc(t.staff, 'programs/p1/signups/expired'));
  b.delete(doc(t.staff, 'purgeQueue/expired'));
  await assertSucceeds(b.commit());
});
