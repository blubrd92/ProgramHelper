// Pure logic: no Firebase, no page. Everything here can be tested by itself.
// If a number on the stats page looks wrong, the definition is in this file.

export const MAX_RETENTION_DAYS = 30;
export const DEFAULT_RETENTION_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export const STATUS = {
  registered: 'registered',
  waitlisted: 'waitlisted',
  cancelled: 'cancelled',
  attended: 'attended',
  noShow: 'noShow',
};

/** Statuses that occupy a seat. */
export function holdsSeat(status) {
  return status === STATUS.registered || status === STATUS.attended || status === STATUS.noShow;
}

export function clampRetention(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_RETENTION_DAYS;
  return Math.min(MAX_RETENTION_DAYS, Math.max(1, v));
}

/** Accepts a Date, a Firestore Timestamp, or milliseconds. */
export function toDate(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v.toDate === 'function') return v.toDate();
  return new Date(v);
}

/** '2026-11-14' + '10:30' -> Date in the computer's local time zone. */
export function localDateTime(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

export function localDateString(date) {
  const d = toDate(date);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** When personal data for a sign-up must be gone. */
export function computePurgeAfter(lastSessionEndsAt, retentionDays) {
  return new Date(toDate(lastSessionEndsAt).getTime() + clampRetention(retentionDays) * DAY_MS);
}

/** The latest wipe date the rules will ever accept for a program. */
export function computePurgeCeiling(lastSessionEndsAt) {
  return new Date(toDate(lastSessionEndsAt).getTime() + MAX_RETENTION_DAYS * DAY_MS);
}

export function seatKey(slot, trackId) {
  return `${slot}_${trackId}`;
}

/** '10:30' -> '10:30 AM' */
export function formatTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function formatDateLong(dateStr, locale = 'en-US') {
  return localDateTime(dateStr, '12:00').toLocaleDateString(locale, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

export function childLabel(s) {
  return s.childInitial ? `${s.childFirst} ${s.childInitial}.` : s.childFirst;
}

/**
 * Tidy and check what staff typed. Returns { data, errors }.
 * `program.fields` says which optional fields this program collects.
 * A child is first name + ONE letter. A caregiver is first name only.
 */
export function cleanSignupInput(input, program) {
  const fields = program.fields || {};
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  const errors = {};
  const walkIn = !!input.walkIn;

  const data = {
    childFirst: str(input.childFirst, 30),
    childInitial: str(input.childInitial, 1).toUpperCase(),
    age: null,
    caregiverFirst: fields.caregiver ? str(input.caregiverFirst, 30) : '',
    phone: str(input.phone, 30),
    email: fields.email ? str(input.email, 120) : '',
    language: ['en', 'es', 'other'].includes(input.language) ? input.language : 'en',
    languageOther: '',
    notes: fields.notes ? str(input.notes, 300) : '',
    walkIn,
  };
  if (data.language === 'other') data.languageOther = str(input.languageOther, 30);

  if (fields.age && input.age !== '' && input.age != null) {
    const age = Math.round(Number(input.age));
    if (Number.isFinite(age) && age >= 0 && age <= 18) data.age = age;
    else errors.age = 'Age should be a number from 0 to 18.';
  }

  if (!data.childFirst) errors.childFirst = "Enter the child's first name.";
  if (!walkIn && !data.childInitial) errors.childInitial = 'Enter the first letter of the last name.';
  if (data.childInitial && !/^\p{L}$/u.test(data.childInitial)) errors.childInitial = 'Use one letter.';
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.email = 'That email does not look right.';
  // Walk-ins are already in the room, so contact info is optional for them.
  if (!walkIn && !data.phone && !data.email) {
    errors.contact = fields.email ? 'Enter a phone number, an email, or both.' : 'Enter a phone number.';
  }
  return { data, errors };
}

function bump(map, key) {
  map[key] = (map[key] || 0) + 1;
}

/**
 * Anonymous counts for one program, worked out from its sign-ups.
 *
 *   registered      children holding a seat when the program started
 *                   (status registered, attended or no-show; walk-ins excluded)
 *   attended        of those, the ones who came
 *   noShows         of those, the ones marked no-show
 *   cancelled       sign-ups cancelled before the program
 *   cancelledDayOf  of those, cancelled on the day of the program
 *   waitlisted      children still on the waitlist (never got a seat)
 *   walkIns         children added on the day
 *   totalAttendance attended + walkIns
 */
export function computeCounts(signups, program) {
  const c = {
    registered: 0, attended: 0, noShows: 0, cancelled: 0, cancelledDayOf: 0,
    waitlisted: 0, walkIns: 0, totalAttendance: 0,
    agesRegistered: {}, agesAttended: {},
  };
  for (const s of signups) {
    const ageKey = s.age == null ? null : String(s.age);
    if (s.walkIn) {
      if (s.status === STATUS.attended) {
        c.walkIns += 1;
        if (ageKey) bump(c.agesAttended, ageKey);
      }
      continue;
    }
    if (holdsSeat(s.status)) {
      c.registered += 1;
      if (ageKey) bump(c.agesRegistered, ageKey);
    }
    if (s.status === STATUS.attended) {
      c.attended += 1;
      if (ageKey) bump(c.agesAttended, ageKey);
    } else if (s.status === STATUS.noShow) {
      c.noShows += 1;
    } else if (s.status === STATUS.waitlisted) {
      c.waitlisted += 1;
    } else if (s.status === STATUS.cancelled) {
      c.cancelled += 1;
      const when = toDate(s.cancelledAt);
      if (when && program?.date && localDateString(when) === program.date) c.cancelledDayOf += 1;
    }
  }
  c.totalAttendance = c.attended + c.walkIns;
  return c;
}

/**
 * Follow-through rate: attended divided by registered, counting only children
 * who were still registered when the program started, and excluding walk-ins.
 * Returns null when nobody was registered.
 */
export function followThrough(counts) {
  if (!counts || !counts.registered) return null;
  return counts.attended / counts.registered;
}

export function sameCounts(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Fill {program}, {date}, {time}, {child}, {slot} in reminder wording. */
export function fillReminder(text, vars) {
  return String(text || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}
