# Children's Program Sign-Ups

A staff-only sign-up tool for the Children's Room at San Rafael Public Library. It replaces the shared Excel workbook. There is no public or parent-facing page.

**Status:** built and tested locally with invented data. **Not deployed.** The Firebase project does not exist yet, and how the site will be published is still an open decision (see "Deploying").

## What it does

- **Roster programs** (a workshop, a book club): a numbered list of seats, an ordered waitlist, automatic promotion when someone cancels.
- **Time-slot programs** (Read to a Dog): a grid of time slots by volunteer team. Add or remove a dog for one session with one button. Mark a volunteer as called out and the affected children are listed with their contact details.
- **Reminders:** nothing is sent. One screen gives copyable email addresses by language, drafted messages in English and Spanish, and a call list for phone-only families.
- **Attendance and close-out:** mark attended or no-show, add walk-ins, record an optional headcount, freeze the numbers.
- **Stats:** per program and across a date range, with a CSV download. Counts only.
- **Privacy wipe:** names, contact details and notes are deleted a set number of days after a program ends (default 14, maximum 30). Counts are kept.

## How the privacy wipe works

Personal data lives in exactly one kind of record: a sign-up. Every sign-up carries a wipe date (`purgeAfter`).

1. **Every time someone opens the app while signed in**, it deletes every sign-up whose wipe date has passed.
2. **The database itself refuses to hand over an expired sign-up**, even if nobody has opened the app to delete it. This is enforced in `firestore.rules`, not in the page.

Programs keep only numbers (how many registered, attended, and so on). Those numbers are saved on the program every time a sign-up changes, so they are already there when the people are deleted.

For a child carried through a repeating series with "Duplicate for a new date", the clock starts after the last session they are still signed up for.

## The two logins

| Login | Can do |
|---|---|
| **Staff** | Add, edit and cancel sign-ups; mark attendance; use reminders; close out; view stats; add or remove a volunteer column for a session |
| **Admin** | Everything staff can do, plus: create, duplicate and delete programs; edit templates; edit the volunteer list; change the retention period |

These limits are enforced by the database rules. Hiding a button is only a courtesy.

---

## Running it locally (practice mode)

This needs a computer with Node.js (built with version 22) and a current Java (built with version 21; the Firebase emulator needs Java and will say so if yours is too old). Practice mode uses invented data and never touches the real project.

```bash
npm install
```

```bash
npm run dev
```

Then open http://127.0.0.1:5000 and sign in:

- Staff: `staff@example.test` / `practice-staff`
- Admin: `admin@example.test` / `practice-admin`

Everything resets each time you restart `npm run dev`.

To run the automated tests (security rules, purge, sign-up logic):

```bash
npm test
```

If you work through Claude Code in the browser and have no terminal, ask Claude to run these for you; it has both tools available in its session.

---

## Setting up the real Firebase project (one time, in the browser)

Firebase's console changes its menus from time to time. If a label below does not match, look for the nearest equivalent.

1. Go to https://console.firebase.google.com and **create a project**. Google Analytics is not needed. Stay on the free **Spark** plan; do not add a billing account.
2. **Authentication:** open Build > Authentication > Get started. Under "Sign-in method", enable **Email/Password** only.
3. **Firestore:** open Build > Firestore Database > Create database. Choose **production mode**. Pick a US West location; this cannot be changed later.
4. **Rules:** in Firestore, open the **Rules** tab. Delete what is there, paste the entire contents of `firestore.rules` from this repository, and click **Publish**.
5. **Web app settings:** open the gear icon > Project settings > "Your apps" > add a **Web** app. Firebase shows a block with `apiKey`, `authDomain`, `projectId`, `appId`. Copy those four values into `public/js/firebase-config.js`, replacing the `REPLACE_ME` lines. These values are not secrets; they only say where the database is.
6. Create the two logins (next section).
7. Publish the site (see "Deploying"), then add the site's address under Authentication > Settings > **Authorized domains**.

No database indexes need to be created by hand.

## Creating or resetting the two logins

**Create:**

1. Authentication > Users > **Add user**. Enter an email and a strong password. Do this twice: one for staff, one for admin. The emails do not need to be real mailboxes, but a real one lets you use Firebase's password reset.
2. In the Users list, copy each account's **User UID** (a long string of letters and numbers).
3. Firestore Database > Data > **Start collection**. Collection ID: `users`.
4. Add a document whose **Document ID** is the staff account's UID, with one field: name `role`, type string, value `staff`.
5. Add another document whose Document ID is the admin account's UID, with field `role` = `admin`.

An account with no `users` document can sign in but sees nothing and is told so. Nobody can create or change a role from inside the app.

**Reset a password:** Authentication > Users > the three-dot menu on the account > Reset password (sends an email), or delete the account and add it again. If you delete and re-add, the UID changes: delete the old `users` document and make a new one with the new UID.

**If a password leaks:** change it the same way, then sign out and back in on the desk computer with the new password.

**Optional tightening:** under Authentication > Settings > User actions, turn off "Enable create (sign-up)" if the option is there. Even without it, a self-made account has no role and can read nothing.

## Changing the retention period

Sign in as admin > **Settings** > "Days to keep" > Save. Any whole number from 1 to 30.

- The app then re-dates every sign-up that still exists.
- If you shorten the period, sign-ups that are now overdue become unreadable within about five minutes and are deleted the next time anyone opens the app.
- The 30-day ceiling is in `firestore.rules`. Raising it means editing that file and republishing the rules; the app alone cannot.

## Deploying

**Not done yet, and the route is not decided.** The site is the `public/` folder: plain files, no build step. Two ways to publish it:

- **GitHub Pages plus pasting the rules** (no terminal; the way the Library Reservations tool is published). The site would be served by GitHub rather than Firebase Hosting. A small GitHub Actions file would publish the `public/` folder on every merge to the main branch. This needs the repository to be eligible for Pages.
- **Firebase Hosting.** Publishing needs either a terminal (`npx firebase login`, then `npx firebase deploy --only hosting,firestore:rules --project YOUR_PROJECT_ID`) or a GitHub Action holding a Google service-account key as a repository secret.

Either way, the database rules are published separately, by pasting `firestore.rules` into the console (step 4 above) or with the deploy command. **Whenever `firestore.rules` changes in this repository, the rules must be republished**, or the live database keeps the old ones.

Before the first real use, with invented names only: sign in on the live site, add a sign-up, and confirm that a staff login cannot open Settings. Then confirm the expired-record rule against the live database (ask Claude for the steps; it involves hand-editing one fake sign-up's `purgeAfter` in the console to a past date and checking that it disappears from the app).

## When something breaks: check these first

1. **"This login has no access."** The account has no `users` document, or its Document ID is not that account's UID, or `role` is misspelled. It must be exactly `staff` or `admin`, lower case.
2. **"This login is not allowed to do that."** A staff login tried an admin action, or the published rules are older than the app. Republish `firestore.rules`.
3. **Sign-in fails for everyone on the live site.** The site's address is missing from Authentication > Settings > Authorized domains, or `public/js/firebase-config.js` still says `REPLACE_ME`.
4. **A program page will not load, or the roster is empty when it should not be.** If the program ended more than the retention period ago, the names are gone on purpose; the numbers are on the Stats page. Otherwise press F12, open the Console tab, and look for a red line. A line mentioning "index" includes a link that creates the missing index in one click.
5. **Everything stops working mid-day with "quota" errors.** The free plan allows about 50,000 reads and 20,000 writes a day, far more than a children's desk should use. Check Firestore > Usage in the console. Service returns the next day (the allowance resets around midnight Pacific).
6. **Numbers look wrong on Stats.** A program marked "Not final" has not been closed out, so its numbers can still change. The definitions are printed on the Stats page and live in `computeCounts` in `public/js/data/model.js`.
7. **Stuck?** Run `npm test`. If the tests pass, the rules and the core logic are sound and the problem is in a screen or in the Firebase setup.

## Things worth knowing

- **Duplicate a repeating program before its names are wiped.** "Sign up the same children" copies from the old program's sign-ups. With a 14-day retention and a monthly club, last month's names are gone before next month's meeting. Duplicate right after the session, while the roster is still there.
- **A program can be deleted only if it never had a sign-up.** After that its numbers are part of the stats.
- **A child added by hand to one session of a series** is not linked to their record in other sessions; each record follows its own session's wipe date.
- **Walk-ins** need only a first name and do not use up a roster seat.
- **A waitlisted child who simply shows up** is added as a walk-in (roster) or given a free slot with "Give a slot" (time-slot programs).
- **Volunteers** are never wiped: first name, last initial, dog's name, a short note. No contact details; the database refuses any other field.
- **The login page is public** in the sense that anyone with the address can load it. They get a login box and no data. The page asks search engines not to index it.
- **Spanish reminder wording** ships as a draft in `public/js/data/starter-templates.js` and should be reviewed before launch. After the starter templates are installed, edit wording in the app under Templates.

## Where things are

```
firestore.rules              who can read and write what; the 30-day cap; the expired-record lock
public/index.html            the one page
public/js/app.js             login, the purge-on-open, switching screens
public/js/data/model.js      definitions: counts, follow-through, validation, wipe dates
public/js/data/store.js      every database read and write, including the purge
public/js/data/starter-templates.js   the three shipped templates and reminder wording
public/js/data/reminders.js  who to remind and what the message says
public/js/data/stats.js      totals and the CSV
public/js/views/             one file per screen
public/vendor/               Firebase's browser library, copied in (no outside CDN)
tests/                       automated tests; run with npm test
seed/                        invented practice data for npm run dev
```

To upgrade the Firebase library: change the version in `package.json` and in the import map in `public/index.html`, run `npm install`, then `npm run vendor`, then `npm test`.

## Left out on purpose

Parent self-registration, sending email or text, other departments, importing the old workbook, and anything that needs a paid plan. Possible later additions that were considered and not built: offline use, custom fields beyond the four optional ones, a print view, stats rolled up by series, filtering or sorting on the roster and stats tables.
