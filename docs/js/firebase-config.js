// Which Firebase project this site talks to.
//
// These values are NOT secrets. They only say where the database is; the
// security rules decide who may read it. They come from Firebase console >
// Project settings > Your apps > Web app (see README).
export const firebaseConfig = {
  apiKey: 'AIzaSyAVjWx_us12CI-91nhB00p4uPZt14o6epA',
  authDomain: 'program-helper-e3133.firebaseapp.com',
  projectId: 'program-helper-e3133',
  storageBucket: 'program-helper-e3133.firebasestorage.app',
  messagingSenderId: '1020947299478',
  appId: '1:1020947299478:web:6111ce0e00e70b883f56b7',
};

// When the page is opened from this computer (npm run dev), it uses the local
// emulator with fake data instead of the real project.
export const useEmulator = ['localhost', '127.0.0.1'].includes(location.hostname);
