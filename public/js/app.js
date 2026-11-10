// Entry point: login gate, the purge-on-open, and switching between screens.
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db, isEmulator } from './firebase.js';
import { setDb, runPurge } from './data/store.js';
import { h, clear, toast, showError, field } from './ui.js';
import { renderHome } from './views/home.js';
import { renderProgram } from './views/program.js';

setDb(db);

const main = document.getElementById('main');
const topbar = document.getElementById('topbar');
let ctx = null; // { role, isAdmin } once signed in
let cleanup = null; // stops the current screen's live listeners

document.getElementById('signOutBtn').addEventListener('click', () => signOut(auth));
window.addEventListener('hashchange', route);

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    ctx = null;
    showLogin();
    return;
  }
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    const role = snap.exists() ? snap.data().role : null;
    if (role !== 'staff' && role !== 'admin') return showNoRole(user);
    ctx = { role, isAdmin: role === 'admin' };
  } catch (e) {
    return showNoRole(user);
  }
  topbar.hidden = false;
  const badge = document.getElementById('roleBadge');
  badge.textContent = (ctx.isAdmin ? 'Admin' : 'Staff') + (isEmulator ? ' · practice data' : '');
  badge.className = ctx.isAdmin ? 'badge badge-admin' : 'badge';

  // Layer one of the wipe: every time someone opens the app, delete
  // everything that is past its date. See runPurge in data/store.js.
  runPurge()
    .then((n) => { if (n > 0) toast(`Privacy cleanup: removed ${n} expired sign-up${n === 1 ? '' : 's'}.`, 'info'); })
    .catch((e) => console.error('Purge failed', e?.code || e));

  route();
});

function route() {
  if (!ctx) return;
  cleanup?.();
  cleanup = null;
  clear(main);
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  try {
    if (parts[0] === 'program' && parts[1]) cleanup = renderProgram(main, ctx, parts[1]);
    else cleanup = renderHome(main, ctx);
  } catch (e) {
    showError(e);
  }
  main.focus({ preventScroll: true });
}

function showLogin() {
  cleanup?.();
  cleanup = null;
  topbar.hidden = true;
  const email = h('input', { type: 'email', autocomplete: 'username', required: true });
  const password = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const error = h('p', { class: 'form-error', role: 'alert' });
  const button = h('button', { type: 'submit', class: 'btn btn-primary btn-big' }, 'Sign in');
  const form = h('form', { class: 'card login', novalidate: true },
    h('h1', {}, "Children's Program Sign-Ups"),
    h('p', { class: 'muted' }, 'Staff only. Sign in with the shared desk login.'),
    field('Email', email),
    field('Password', password),
    error,
    button,
    isEmulator ? h('p', { class: 'muted small' }, 'Practice mode. Staff: staff@example.test / practice-staff. Admin: admin@example.test / practice-admin.') : null);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    error.textContent = '';
    button.disabled = true;
    try {
      await signInWithEmailAndPassword(auth, email.value.trim(), password.value);
    } catch (e) {
      error.textContent = e?.code === 'auth/network-request-failed'
        ? 'Cannot reach the login service. Check the internet connection.'
        : 'That email and password did not work.';
      button.disabled = false;
      password.select();
    }
  });
  clear(main).append(form);
  email.focus();
}

function showNoRole(user) {
  topbar.hidden = true;
  clear(main).append(h('div', { class: 'card login' },
    h('h1', {}, 'This login has no access'),
    h('p', {}, `The account ${user.email || ''} is signed in, but it has not been set up as staff or admin.`),
    h('p', { class: 'muted' }, 'See "Create or reset the two logins" in the README.'),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: () => signOut(auth) }, 'Sign out')));
}
