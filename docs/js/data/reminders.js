// Pure logic for the reminders screen: no Firebase, no page.
// Everything here can be tested by itself (tests/reminders.test.mjs).
//
// The tool never sends anything. These functions only work out WHO to remind
// and WHAT to say; staff copy the result into their own city email.

import { STATUS, formatTime, formatDateLong, fillReminder } from './model.js';

/** Sign-ups that should get a reminder: registered, and not walk-ins. */
export function remindable(signups) {
  return (signups || []).filter((s) => s.status === STATUS.registered && !s.walkIn);
}

/** Phone number reduced to its digits, so "415-555-0100" and "(415) 555 0100" match. */
function phoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

/**
 * Group sign-ups into families. Sign-ups share a family when they have the
 * same email (compared in lower case) or, with no email, the same phone digits.
 * A sign-up with neither stands alone. Families and children keep the order
 * of the list that was passed in.
 *
 * Each family: { key, language, languageOther, caregiverFirst, phone, email,
 *                children: [signup, ...] }
 * The language comes from the first child's sign-up.
 */
export function groupFamilies(signups) {
  const families = new Map();
  for (const s of signups || []) {
    const email = String(s.email || '').trim().toLowerCase();
    const digits = phoneDigits(s.phone);
    let key;
    if (email) key = `e:${email}`;
    else if (digits) key = `p:${digits}`;
    else key = `s:${s.id}`;

    let family = families.get(key);
    if (!family) {
      family = {
        key,
        language: s.language || 'en',
        languageOther: s.languageOther || '',
        caregiverFirst: '',
        phone: '',
        email: '',
        children: [],
      };
      families.set(key, family);
    }
    family.children.push(s);
    // Fill gaps from later children (the first one found wins).
    if (!family.caregiverFirst && s.caregiverFirst) family.caregiverFirst = s.caregiverFirst;
    if (!family.phone && s.phone) family.phone = s.phone;
    if (!family.email && s.email) family.email = String(s.email).trim();
  }
  return [...families.values()];
}

/** '15:30' -> '3:30 p. m.' (U.S. Spanish 12-hour clock). */
export function formatTimeEs(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'p. m.' : 'a. m.';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Time in the wording of the given language ('es' gets Spanish; all else English). */
export function formatTimeFor(t, lang) {
  return lang === 'es' ? formatTimeEs(t) : formatTime(t);
}

/**
 * Names joined the way people say them.
 *   en: 'Pepper' / 'Pepper and Olive' / 'Pepper, Olive and Basil'
 *   es: 'Pepper' / 'Pepper y Olive' / 'Pepper, Olive y Basil'
 * In Spanish "y" becomes "e" before a name that starts with the sound "i"
 * (a name starting with I or Hi): 'Pepper e Inés'.
 */
export function joinNames(names, lang = 'en') {
  const list = (names || []).filter(Boolean);
  if (list.length <= 1) return list[0] || '';
  const last = list[list.length - 1];
  let word = 'and';
  if (lang === 'es') word = /^(h?i)/i.test(last) ? 'e' : 'y';
  return `${list.slice(0, -1).join(', ')} ${word} ${last}`;
}

/** The reminder wording for a language. 'other' uses English. */
function wording(program, lang) {
  const text = program.reminder || {};
  return lang === 'es' ? text.es || '' : text.en || '';
}

/** Message language for a family or group: 'es' or 'en' ('other' -> 'en'). */
export function messageLanguage(language) {
  return language === 'es' ? 'es' : 'en';
}

function dateFor(program, lang) {
  return formatDateLong(program.date, lang === 'es' ? 'es-US' : 'en-US');
}

/**
 * One message for a whole group of families (roster programs). It never
 * contains a child's name: {child} becomes "your child" and {slot} the
 * program's start time.
 */
export function buildGroupMessage(program, lang) {
  const l = messageLanguage(lang);
  const time = formatTimeFor(program.startTime, l);
  return fillReminder(wording(program, l), {
    program: program.name,
    date: dateFor(program, l),
    time,
    child: l === 'es' ? 'su niño o niña' : 'your child',
    slot: time,
  });
}

/** The slot start time of a child, or '' if they have no slot. */
function slotStart(program, signup) {
  const slot = signup.slot == null ? null : (program.slots || [])[signup.slot];
  return slot ? slot.start : '';
}

/**
 * The slot time text for a family: one child -> '10:30 AM';
 * several -> 'Pepper: 10:30 AM; Olive: 10:40 AM'. Start times only.
 */
export function familySlotText(program, family, lang) {
  const l = messageLanguage(lang);
  const parts = family.children.map((c) => ({ name: c.childFirst, time: formatTimeFor(slotStart(program, c), l) }));
  if (parts.length === 1) return parts[0].time;
  return parts.map((p) => (p.time ? `${p.name}: ${p.time}` : p.name)).join('; ');
}

/** A personal message for one family (slotted programs), in the family's language. */
export function buildFamilyMessage(program, family, lang) {
  const l = messageLanguage(lang ?? family.language);
  return fillReminder(wording(program, l), {
    program: program.name,
    date: dateFor(program, l),
    time: formatTimeFor(program.startTime, l),
    child: joinNames(family.children.map((c) => c.childFirst), l),
    slot: familySlotText(program, family, l),
  });
}

/**
 * Email addresses by language group, each without repeats (ignoring upper and
 * lower case), in the order the families were given.
 */
export function emailLists(families) {
  const lists = { en: [], es: [], other: [] };
  const seen = new Set();
  for (const f of families || []) {
    if (!f.email) continue;
    const lower = f.email.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    const group = f.language === 'es' ? 'es' : f.language === 'other' ? 'other' : 'en';
    lists[group].push(f.email);
  }
  return lists;
}

/** Families that have a phone number but no email: staff must call them. */
export function callList(families) {
  return (families || []).filter((f) => f.phone && !f.email);
}

/** How many families have every child's reminded box ticked. */
export function remindedProgress(families) {
  const done = (families || []).filter((f) => f.children.length && f.children.every((c) => c.reminded)).length;
  return { done, total: (families || []).length };
}
