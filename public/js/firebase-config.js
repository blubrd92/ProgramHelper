// Which Firebase project this site talks to.
//
// These values are NOT secrets. They only say where the database is; the
// security rules decide who may read it. Replace them with the values from
// Firebase console > Project settings > Your apps > Web app (see README).
export const firebaseConfig = {
  apiKey: 'REPLACE_ME',
  authDomain: 'REPLACE_ME.firebaseapp.com',
  projectId: 'REPLACE_ME',
  appId: 'REPLACE_ME',
};

// When the page is opened from this computer (npm run dev), it uses the local
// emulator with fake data instead of the real project.
export const useEmulator = ['localhost', '127.0.0.1'].includes(location.hostname);
