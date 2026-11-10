// Starts Firebase once and hands out the database and login objects.
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { firebaseConfig, useEmulator } from './firebase-config.js';

const config = useEmulator
  ? { apiKey: 'demo-key', authDomain: 'localhost', projectId: 'demo-programhelper', appId: 'demo' }
  : firebaseConfig;

export const app = initializeApp(config);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const isEmulator = useEmulator;

if (useEmulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}
