// Copies the Firebase browser SDK out of node_modules into vendor.
// Run `npm run vendor` only when upgrading the firebase version in package.json.
// The app loads these local copies, so it never depends on an outside CDN.
import { copyFileSync, mkdirSync } from 'node:fs';
mkdirSync('vendor', { recursive: true });
for (const f of ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js']) {
  copyFileSync(`node_modules/firebase/${f}`, `vendor/${f}`);
  console.log('copied', f);
}
