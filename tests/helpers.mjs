// Shared setup for the emulator tests. All data here is invented.
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { doc, setDoc, Timestamp } from 'firebase/firestore';

export const DAY = 24 * 60 * 60 * 1000;

export async function makeEnv(projectId) {
  const env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, 'users/staff1'), { role: 'staff' });
    await setDoc(doc(d, 'users/admin1'), { role: 'admin' });
  });
  return {
    env,
    staff: env.authenticatedContext('staff1').firestore(),
    admin: env.authenticatedContext('admin1').firestore(),
    stranger: env.authenticatedContext('stranger1').firestore(),
    anon: env.unauthenticatedContext().firestore(),
    /** Run something with the rules switched off (test setup only). */
    raw: (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore())),
  };
}

export const ts = (msFromNow) => Timestamp.fromMillis(Date.now() + msFromNow);

export function fakeSignup(overrides = {}) {
  return {
    childFirst: 'Pepper', childInitial: 'Z', age: 7, caregiverFirst: 'Juniper',
    phone: '415-555-0100', email: 'juniper@example.test', language: 'en', languageOther: '',
    notes: '', walkIn: false, status: 'registered', slot: null, trackId: null,
    needsContact: false, reminded: false, seriesKey: null, createdAt: Timestamp.now(),
    cancelledAt: null, purgeAfter: ts(5 * DAY), ...overrides,
  };
}
