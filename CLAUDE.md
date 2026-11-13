# CLAUDE.md: handoff notes for Library Program Sign-Ups

Read this before changing anything. It is the working memory of the project: what it is, the rules it must never break, how to work with its owner, and the mistakes already made so they are not made twice. The README is for the person running the tool; this file is for whoever (human or AI) works on the code next.

**Keep this file current.** It is part of the job, not an extra. See "Keeping this file up to date" at the bottom.

Last updated: 2026-11-13.

---

## What this is

A staff-only web app for the Children's Room at San Rafael Public Library. It replaced a shared Excel workbook for program sign-ups. Staff at the desk type in a child while a parent stands there or is on the phone. There is no public or parent-facing page, and there must never be one.

- Live at `https://blubrd92.github.io/ProgramHelper/` (GitHub Pages, served from the repository root of the working branch).
- Firebase project: `program-helper-e3133` (Firestore + Authentication only, free Spark plan).
- Two shared logins: staff (`staff@staff.com`) and admin (`admin@staff.com`). Nobody types the email; the sign-in screen asks "Staff or Admin" and a password. The emails live in `loginEmails` in `js/firebase-config.js`.

## Who you are working with

Javi, an adult services librarian. He directs AI and reads what comes back; he is not a trained programmer. He runs sessions in Claude Code on the web and does Firebase and GitHub setup in a browser. **He has no terminal.** Anything that needs one, you run in your own session, or you give him browser steps.

How he wants the work done:

- **Plain language.** Say what you chose and why. Give exact click-by-click steps for anything he must do by hand.
- **Build only what was asked.** If you see something worth adding or changing, propose it with your reasoning and wait. Do not fold it in.
- **Verify before saying it works.** Run the tests and drive the real screens in a browser. Say plainly what you did not verify.
- **Prefer boring.** No framework, no build step, few dependencies, code he can read.
- **Destructive actions keep a confirmation step** (cancel, remove, delete). He asked for this explicitly.
- He used a lead-plus-agents model for the first build: the lead owns architecture, data model, rules and purge logic and never delegates them; self-contained screens can go to cheaper agents with a written brief; the lead reads every diff and tests it. Agents that have not browser-tested must say so.

## Hard constraints (from city IT and the budget)

Treat these as requirements. If one turns out to be impossible, stop and tell Javi; do not work around it quietly.

1. **Free tier only.** Firebase Spark plan. No Cloud Functions, no Cloud Storage, no scheduled jobs, no billing account. Firestore's built-in TTL also needs billing, so it is not available.
2. **Minimal personal data.** A child is first name plus ONE-letter last initial (two separate boxes; the rules reject a longer initial). Caregiver is first name only. Contact is phone, email, or both.
3. **Automatic wipe.** Names, contact details and notes are deleted a set number of days after a program ends: default 14, admin-adjustable, capped at 30 by the rules.
4. **Stats survive the wipe.** Counts are saved on the program document; the purge deletes people, never counts. After a wipe no name, phone or email may remain anywhere, including logs and reminder history.
5. **No real data in the repository.** All seed and test data is invented, with `415-555-01xx` phone numbers and `@example.test` emails.
6. **Roles are enforced in `firestore.rules`**, not only by hiding buttons.

## How it is built

Plain HTML, CSS and JavaScript modules served as-is from the repository root. Firebase's browser SDK is copied into `vendor/` (no CDN) and mapped by the import map in `index.html`. The same data-layer code runs in the browser and in Node tests.

```
index.html                     the one page; import map; top bar
logo.svg                       logo (book with a checkmark), also the tab icon
css/                           app.css is shared; one file per screen besides
js/app.js                      sign-in, purge-on-open, hash routing
js/firebase-config.js          project config, emulator switch, loginEmails
js/ui.js                       h(), add(), clear(), toast(), dialogs, field()
js/data/model.js               PURE logic: counts, follow-through, validation, wipe dates, slot maths
js/data/store.js               EVERY database read and write, including the purge
js/data/starter-templates.js   the three shipped templates and reminder wording (EN + ES)
js/data/reminders.js           pure: who to remind and what the message says
js/data/stats.js               pure: totals, age breakdown, CSV
js/views/home.js               program list, "families to contact", new program
js/views/program.js            one program: roster or slot grid, attendance, close-out, duplicate, delete
js/views/entry-row.js          the always-open entry row (see "Entry")
js/views/program-edit.js       admin: edit a program after creation
js/views/signup-form.js        pop-up form, now used ONLY for editing an existing child
js/views/slot-grid.js          Read to a Dog grid, tracks, call-outs, move
js/views/reminders.js          copyable addresses, drafts, call list
js/views/stats.js              stats page and CSV download
js/views/templates.js          admin: template editor
js/views/volunteers.js         admin: volunteer list
js/views/settings.js           admin: retention period
firestore.rules                the real lock on the data
tests/                         node:test suites (see "Testing")
seed/                          practice data for the emulator; vendor.mjs copies the SDK
```

Routes are hash-based: `#/`, `#/program/<id>`, `#/program/<id>/reminders`, `#/stats`, and admin-only `#/templates`, `#/volunteers`, `#/settings`.

### Data model (Firestore)

```
settings/main        { retentionDays }                      rules: int 1..30, admin only
users/{uid}          { role: 'staff' | 'admin' }            created by hand in the console; never writable from the app
templates/{id}       settings for a kind of program          admin only
volunteers/{id}      { firstName, lastInitial, dogName, note }   rules allow ONLY these four fields
programs/{id}        one session on one date: a copy of its template's settings plus
                     seatsTaken, seats, waitlist, needsContact, counts, stats, headcount,
                     tracks, purgeCeiling, seriesId, requireContact, status, signupTotal
programs/{id}/signups/{id}   THE ONLY PLACE PERSONAL DATA LIVES. Carries purgeAfter.
purgeQueue/{signupId}        { programId, purgeAfter }: an ID and a date, nothing personal
```

Two program kinds: `roster` (seats counted by `seatsTaken` against `capacity`) and `slotted` (seats are a map `"<slotIndex>_<trackId>": signupId`). A track is one volunteer team (for Read to a Dog, a handler and dog) with status `scheduled | confirmed | calledOut`. The kind of a program cannot change after creation.

### Invariants: do not break these

- **Personal data goes only into sign-up documents**, and only through `store.js`. Never into program documents, templates, logs, `localStorage`, the URL, `console.log`, or the page title. There is deliberately no audit log and no reminder history; "reminded" is a boolean on the sign-up and dies with it.
- **Every sign-up is written together with its purge ticket** (same ID, same `purgeAfter`). The rules enforce the pairing with `getAfter`/`existsAfter`. The purge finds due tickets and deletes sign-ups by ID *without reading them*, because expired sign-ups are unreadable.
- **Layer two of the wipe:** the rules refuse any read of a sign-up whose `purgeAfter` has passed. A list query must filter on `purgeAfter`; see the clock-margin gotcha below.
- **`purgeAfter` can never exceed the program's `purgeCeiling`** (end date plus 30 days, or the series' latest end plus 30). Only the admin can write `purgeCeiling`.
- **Counts are saved on the program after every sign-up change** (`refreshCounts`), so stats exist when the people are wiped. Close-out freezes them into `stats`. The purge freezes stats for any program nobody closed out. Recounts for one program run strictly one after another.
- **The stats page reads program documents only.** It must never read sign-ups.
- **Seat decisions happen inside Firestore transactions** (`addSignup`, `cancelSignup`, `moveSignup`), so two desk computers cannot both take the last seat.
- **Series:** children carried forward with "Duplicate for a new date" share a `seriesKey`; their wipe clock runs from the last session they are still registered for (`syncSeriesRetention`).
- **Put content on the page with `h()` and `add()` only.** Never `innerHTML` with data. Never the browser's raw `el.append()` (see gotchas).

### Entry (the part Javi cares most about)

The benchmark is Excel: the row is just there and you type. Entry is one always-open row (`entry-row.js`), built once and re-inserted on every redraw so half-typed text survives. Enter adds; the boxes clear instantly and saves queue in order in the background. Ctrl+Enter adds and keeps the contact details for a sibling. Walk-in is a tick box on the row.

For time-slot programs the same row has a "Time slot" box that starts on the next free slot and advances by itself; clicking a free slot in the grid only sets that box. Its last choice is "No time slot (waitlist)". Editing an existing child is the one place a pop-up form is still used. If entry starts to feel like more clicking than Excel, that is a regression.

## Testing

You must run these yourself; Javi cannot.

```bash
npm install
```

```bash
npm test
```

`npm test` runs the pure tests, then starts the Firestore emulator and runs the rules tests and the end-to-end data-layer tests **with the security rules switched on**. At last count: 75 tests, all passing. Add tests when you add data-layer behaviour or change the rules.

```bash
npm run dev
```

`npm run dev` starts the Auth, Firestore and Hosting emulators with invented practice data at `http://127.0.0.1:5000`. Sign in by choosing Staff or Admin; the passwords are `practice-staff` and `practice-admin`. Any page opened from `localhost`/`127.0.0.1` uses the emulator, never the real project.

**Browser checks:** drive the practice site with Playwright (preinstalled in Claude Code cloud sessions) before telling Javi a screen works. There are no committed browser tests; past sessions wrote throwaway scripts. Lessons from those:

- `getByLabel('Age')` also matches "Langu**age**", and `getByLabel('Language')` matches "Which language?". Use `{ exact: true }`.
- Text that also appears on the home page cards (for example "4 of 4 seats filled") is a bad thing to wait on after navigating; wait on a heading unique to the destination.
- Restart `npm run dev` for fresh data between runs; scripts mutate it.
- Kill emulators before `npm test` (both want port 8080).

In past cloud sessions the Firebase documentation site and the live site were both blocked by the session's network settings, so no session has been able to look at the live project. Javi reports what he sees.

## Deploying

- **Site:** GitHub Pages, "Deploy from a branch", folder `/ (root)`. Pushing to the published branch updates the live site within a few minutes. `.nojekyll` must stay, or GitHub hides `vendor/`. Everything in the repository is publicly served, including this file: never put a secret in the repository.
- **Rules:** Pages does not publish them. **Whenever `firestore.rules` changes, tell Javi to paste the new file into Firebase console > Firestore Database > Rules and click Publish.** Until he does, the live database runs the old rules. Say this in your summary every time; it is easy to forget and the failure is confusing.
- **Branch:** work so far lives on `claude/childrens-signup-tool-gjuhu1`, which is also the published branch. There is no `main` yet. Do not open a pull request unless asked.
- No database indexes need creating by hand.

## Gotchas already hit (read these)

1. **The emulator is not production for rule-checked queries.** The emulator checks a list query against the documents it happens to match; production checks the query itself. A query for sign-ups with `purgeAfter > now` passed locally and was refused live, because the client's "now" is slightly behind the server's by the time the request arrives. Fix in place: `liveCutoff()` in `store.js` asks for `purgeAfter >` ten minutes from now. Any new query on sign-ups must use it. More generally: a rule that passes in the emulator is not proven until Javi has tried it live.
2. **`el.append(null)` prints the word "null".** Use `add(el, ...)` from `ui.js`, which skips empty values.
3. **Don't block typing on the database.** Clearing the entry row only after a save returned made fast entry lose keystrokes. Clear first, save in a queue, restore on failure.
4. **Rapid writes that each lock the program document collide.** Attendance clicks used to read the program inside the transaction and tripped over the recount. `setAttendance` now checks the program outside the transaction.
5. **Bold on the active nav link shifts the other links.** The active page is marked with background and underline at the same weight.
6. **`staff.com` is someone else's domain.** Never tell Javi to use "Reset password" in the Firebase console: the link would go to a stranger. Passwords are changed by deleting and re-adding the account, then recreating its `users` document under the new UID (steps in the README).
7. **A redraw rebuilds the page.** Buttons get focus back by `data-key`; persistent inputs are re-focused directly. Give new interactive elements a stable `data-key`.
8. **Moving a program's date changes wipe dates.** `updateProgram` refuses a move into the past, because that would expire everyone's records within minutes.

## Decisions on record

- **Hosting is GitHub Pages**, not Firebase Hosting, because Javi has no terminal and already runs another library tool this way. This bends the original "Firebase Hosting" line of the brief, with his agreement.
- **Roles are a `users/{uid}` document**, not custom claims, so no service-account key ever needs to exist.
- **Slotted reminders are one message per family**; roster reminders are one group message per language with no child's name in it (a group email must not reveal other children).
- **Spanish reminder wording** addresses the family as "ustedes" and is phrased to work for one child or siblings. It was drafted by AI and is still awaiting Javi's review.
- **Walk-ins** need only a first name and do not use a roster seat. A waitlisted child cannot be marked attended directly.
- **A freed slot in a called-out track is not refilled** from the waitlist.
- **Delete** is allowed for an open program with nobody seated, waiting, or counted as a walk-in; cancelled leftovers are deleted with it.
- **`requireContact`** exists on templates and programs (default on). When off, a sign-up needs only the name and initial.
- **The tool's name is "Library Program Sign-Ups."** Reminder messages still say they come from the "Children's Room"; that names the sender and was left on purpose.

## Open items

- Javi has not confirmed that the latest `firestore.rules` (the looser delete rule) has been pasted into the Firebase console.
- The expired-record check on the live database (README, "First check on the live site", step 4) has not been reported as done.
- Spanish wording review is pending.
- Not tested: Microsoft Edge, a screen reader.
- The shipped Read to a Dog template has five 10-minute slots ending 11:20 while its end time is 11:30; left as is on purpose, pending Javi.
- `signup-form.js` still carries options from when it handled new sign-ups; only its edit path is used now. Safe to slim down if someone is in there anyway, with Javi's OK.
- Ideas raised and deliberately not built: offline use, custom fields beyond the four optional ones, a print view, stats by series, filtering or sorting tables, bulk "mark all attended", a gap-aware default for the shipped template, changing slots on an existing session beyond what "Edit program" allows.

## Keeping this file up to date

Update this file in the same commit as the change it describes. Specifically:

- **New or changed behaviour:** fix the relevant section so it stays true. Wrong notes are worse than none.
- **A new invariant or a new way to break one:** add it under "Invariants".
- **A bug that only showed up live, or a mistake worth not repeating:** add it under "Gotchas" with the cause and the fix, in two or three sentences.
- **A decision Javi made:** add it under "Decisions on record", with the reason.
- **Finished or new loose ends:** edit "Open items". Remove what is done.
- **Change the "Last updated" date** at the top.

Keep it short enough to read in a few minutes. This is not a changelog; git history is. When a note stops being true or stops mattering, delete it. Also keep `README.md` in step: it is what Javi and the children's librarian read.
