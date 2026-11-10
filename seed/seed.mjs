// Fills the LOCAL EMULATOR with invented practice data. Run by `npm run dev`.
// This never touches the real project: it only knows the emulator addresses.
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import * as store from '../js/data/store.js';
import { localDateString } from '../js/data/model.js';
import { FAKE_FAMILIES, FAKE_VOLUNTEERS } from './fake-data.mjs';

const PROJECT = 'demo-programhelper';
const DAY = 24 * 60 * 60 * 1000;
const day = (n) => localDateString(new Date(Date.now() + n * DAY));

/** Create a login in the Auth emulator and return its user ID. */
async function makeLogin(email, password) {
  const res = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const body = await res.json();
  if (!body.localId) throw new Error(`Could not create ${email}: ${JSON.stringify(body)}`);
  return body.localId;
}

const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { host: '127.0.0.1', port: 8080 } });
const staffUid = await makeLogin('staff@example.test', 'practice-staff');
const adminUid = await makeLogin('admin@example.test', 'practice-admin');

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  store.setDb(db);
  await setDoc(doc(db, 'users', staffUid), { role: 'staff' });
  await setDoc(doc(db, 'users', adminUid), { role: 'admin' });
  await setDoc(doc(db, 'settings', 'main'), { retentionDays: 14 });
  for (const [i, v] of FAKE_VOLUNTEERS.entries()) await setDoc(doc(db, 'volunteers', `vol${i + 1}`), v);

  await store.installStarterTemplates();
  const templates = Object.fromEntries((await store.listTemplates()).map((t) => [t.id, t]));
  const roster = templates['starter-roster'];

  // One row per child, each carrying the family's contact details.
  const kids = FAKE_FAMILIES.flatMap((f) => f.children.map((c) => ({
    ...c, caregiverFirst: f.caregiverFirst, phone: f.phone, email: f.email,
    language: f.language, languageOther: f.languageOther,
  })));
  const signUp = async (pid, list) => { for (const k of list) await store.addSignup(pid, k); };

  // 1. A roomy program later this week.
  const p1 = await store.createProgram(roster, { name: 'Bookmaking Workshop', date: day(4) });
  await signUp(p1, kids.slice(0, 12));

  // 2. A tiny program that is full, with a waitlist: cancel someone to see a promotion.
  const p2 = await store.createProgram(roster, { name: 'Mini Zine Lab', date: day(2), capacity: 4 });
  await signUp(p2, kids.slice(12, 18));

  // 3. A program today, ready for attendance and walk-ins.
  const p3 = await store.createProgram(roster, { name: 'Comics Club', date: day(0), capacity: 15 });
  await signUp(p3, kids.slice(18, 28));

  // 4. A program from three days ago that nobody closed out.
  const p4 = await store.createProgram(roster, { name: 'Paper Lantern Craft', date: day(-3), capacity: 15 });
  await signUp(p4, kids.slice(28, 36));

  // 5. Read to a Dog, next week: two dogs, one confirmed, a few slots taken, one child waiting.
  const dog = await store.createProgram(templates['starter-read-to-a-dog'], { name: 'Read to a Dog', date: day(8) });
  await store.addTrack(dog);
  await store.setTrack(dog, 't1', { volunteerId: 'vol1', status: 'confirmed' });
  await store.setTrack(dog, 't2', { volunteerId: 'vol2' });
  await store.addSignup(dog, { ...kids[36], slot: 0, trackId: 't1' });
  await store.addSignup(dog, { ...kids[37], slot: 2, trackId: 't1' });
  await store.addSignup(dog, { ...kids[38], slot: 0, trackId: 't2' });
  await store.addSignup(dog, { ...kids[39], slot: 1, trackId: 't2' });
  await store.addSignup(dog, { ...kids[40] });

  // 6. A monthly book club that met yesterday: duplicate it to try "same children next month".
  const club = await store.createProgram(templates['starter-book-club'], { name: 'Graphic Novel Book Club', date: day(-1) });
  await signUp(club, kids.slice(4, 11));

  // 7. A finished, closed-out program so the stats page has final numbers.
  const done = await store.createProgram(roster, { name: 'Shadow Puppet Theater', date: day(-6), capacity: 12 });
  await signUp(done, kids.slice(20, 30));
  const doneKids = await store.listSignups(done);
  for (const [i, s] of doneKids.entries()) await store.setAttendance(done, s.id, i < 7 ? 'attended' : 'noShow');
  await store.addSignup(done, { childFirst: 'Juno', walkIn: true, age: 6 });
  await store.addSignup(done, { childFirst: 'Arlo', walkIn: true, age: 8 });
  await store.closeOut(done, { children: 9, teens: 1, adults: 7 });
});

console.log('\nPractice data loaded.');
console.log('Open  http://127.0.0.1:5000');
console.log('  Staff password:  practice-staff');
console.log('  Admin password:  practice-admin');

if (process.argv.includes('--stay')) {
  console.log('\nLeave this window open while you use the app. Press Ctrl+C to stop.\n');
  setInterval(() => {}, 1 << 30);
} else {
  await env.cleanup();
  process.exit(0);
}
