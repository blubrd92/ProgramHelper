// Entry point: login gate, the purge-on-open, and switching between screens.
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db, isEmulator, loginEmails } from './firebase.js';
import { setDb, runPurge } from './data/store.js';
import { h, clear, toast, showError, field, add } from './ui.js';
import { renderHome } from './views/home.js';
import { renderProgram } from './views/program.js';
import { renderReminders } from './views/reminders.js';
import { renderStats } from './views/stats.js';
import { renderTemplates } from './views/templates.js';
import { renderVolunteers } from './views/volunteers.js';
import { renderSettings } from './views/settings.js';

setDb(db);

const main = document.getElementById('main');
const topbar = document.getElementById('topbar');
let ctx = null; // { role, isAdmin } once signed in
let cleanup = null; // stops the current screen's live listeners

document.getElementById('signOutBtn').addEventListener('click', () => {
  // Stop the current screen's live listeners first, so signing out does not
  // flash a "not allowed" error from a listener that just lost its login.
  cleanup?.();
  cleanup = null;
  signOut(auth);
});
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
  for (const a of topbar.querySelectorAll('[data-admin]')) a.hidden = !ctx.isAdmin;

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
    const adminOnly = { templates: renderTemplates, volunteers: renderVolunteers, settings: renderSettings };
    if (parts[0] === 'program' && parts[1] && parts[2] === 'reminders') cleanup = renderReminders(main, ctx, parts[1]);
    else if (parts[0] === 'program' && parts[1]) cleanup = renderProgram(main, ctx, parts[1]);
    else if (parts[0] === 'stats') cleanup = renderStats(main, ctx);
    else if (adminOnly[parts[0]] && ctx.isAdmin) cleanup = adminOnly[parts[0]](main, ctx);
    else cleanup = renderHome(main, ctx);
    // Mark the current page in the top bar.
    const here = adminOnly[parts[0]] || parts[0] === 'stats' ? parts[0] : 'home';
    for (const a of topbar.querySelectorAll('nav a')) {
      if (a.dataset.nav === here) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
  } catch (e) {
    showError(e);
  }
  main.focus({ preventScroll: true });
}

function showLogin() {
  cleanup?.();
  cleanup = null;
  topbar.hidden = true;
  // Nobody types an email. They pick Staff or Admin and enter that password;
  // the matching email comes from firebase-config.js.
  const staffRadio = h('input', { type: 'radio', name: 'loginRole', value: 'staff', id: 'loginStaff', checked: true });
  const adminRadio = h('input', { type: 'radio', name: 'loginRole', value: 'admin', id: 'loginAdmin' });
  const password = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const error = h('p', { class: 'form-error', role: 'alert' });
  const button = h('button', { type: 'submit', class: 'btn btn-primary btn-big' }, 'Sign in');
  const form = h('form', { class: 'card login', novalidate: true },
    h('img', { class: 'login-logo', src: 'logo.svg', alt: '', width: 72, height: 72 }),
    h('h1', {}, "Children's Program Sign-Ups"),
    h('p', { class: 'muted' }, 'Staff only.'),
    h('fieldset', { class: 'login-role' },
      h('legend', {}, 'Sign in as'),
      h('div', { class: 'check-row' }, staffRadio, h('label', { for: 'loginStaff' }, 'Staff')),
      h('div', { class: 'check-row' }, adminRadio, h('label', { for: 'loginAdmin' }, 'Admin'))),
    field('Password', password),
    error,
    button,
    isEmulator ? h('p', { class: 'muted small' }, 'Practice mode. Staff password: practice-staff. Admin password: practice-admin.') : null);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    error.textContent = '';
    if (!password.value) {
      error.textContent = 'Enter the password.';
      password.focus();
      return;
    }
    button.disabled = true;
    const role = adminRadio.checked ? 'admin' : 'staff';
    try {
      await signInWithEmailAndPassword(auth, loginEmails[role], password.value);
    } catch (e) {
      if (e?.code === 'auth/network-request-failed') error.textContent = 'Cannot reach the login service. Check the internet connection.';
      else if (e?.code === 'auth/too-many-requests') error.textContent = 'Too many wrong tries. Wait a few minutes and try again.';
      else error.textContent = `That is not the ${role} password.`;
      button.disabled = false;
      password.select();
    }
  });
  add(clear(main), form);
  password.focus();
}

function showNoRole(user) {
  topbar.hidden = true;
  add(clear(main), h('div', { class: 'card login' },
    h('h1', {}, 'This login has no access'),
    h('p', {}, `The account ${user.email || ''} is signed in, but it has not been set up as staff or admin.`),
    h('p', { class: 'muted' }, 'See "Create or reset the two logins" in the README.'),
    h('button', { type: 'button', class: 'btn btn-primary', onclick: () => signOut(auth) }, 'Sign out')));
}
