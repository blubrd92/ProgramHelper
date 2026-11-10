// The three templates the tool ships with. They mirror the old workbook.
// The admin installs them once from the app, then edits or duplicates them.
//
// SPANISH REVIEW NEEDED (Javi): every `es` reminder below is a draft.
// Placeholders: {program} {date} {time} and, for slotted programs, {child} {slot}.

const ROSTER_EN = `Hello from the San Rafael Public Library Children's Room!

This is a reminder that your child is signed up for {program}.

Date: {date}
Time: {time}

If your plans have changed, please reply to this email or call us so we can offer the spot to a family on the waitlist.

We look forward to seeing you!`;

const ROSTER_ES = `¡Saludos de la Sala Infantil de la Biblioteca Pública de San Rafael!

Le recordamos que su niño o niña tiene un lugar reservado en {program}.

Fecha: {date}
Hora: {time}

Si sus planes han cambiado, por favor responda a este correo o llámenos para que podamos ofrecer el lugar a una familia en la lista de espera.

¡Les esperamos!`;

const SLOTTED_EN = `Hello from the San Rafael Public Library Children's Room!

This is a reminder that {child} has a reading time reserved for {program}.

Date: {date}
Your time: {slot}

Please arrive a few minutes early. If your plans have changed, please reply to this email or call us so we can offer the time to another child.

We look forward to seeing you!`;

const SLOTTED_ES = `¡Saludos de la Sala Infantil de la Biblioteca Pública de San Rafael!

Le recordamos que {child} tiene un turno de lectura reservado para {program}.

Fecha: {date}
Hora de su turno: {slot}

Por favor lleguen unos minutos antes. Si sus planes han cambiado, responda a este correo o llámenos para que podamos ofrecer el turno a otro niño o niña.

¡Les esperamos!`;

export const STARTER_TEMPLATES = [
  {
    id: 'starter-roster',
    name: 'General program (roster)',
    kind: 'roster',
    audience: 'children',
    capacity: 20,
    startTime: '15:30',
    endTime: '16:30',
    slots: [],
    defaultTracks: 0,
    trackLabel: '',
    fields: { age: true, email: true, caregiver: true, notes: true },
    volunteers: false,
    recurring: false,
    reminder: { en: ROSTER_EN, es: ROSTER_ES },
  },
  {
    id: 'starter-book-club',
    name: 'Book club (monthly)',
    kind: 'roster',
    audience: 'children',
    capacity: 15,
    startTime: '16:00',
    endTime: '17:00',
    slots: [],
    defaultTracks: 0,
    trackLabel: '',
    fields: { age: true, email: true, caregiver: true, notes: true },
    volunteers: false,
    recurring: true,
    reminder: { en: ROSTER_EN, es: ROSTER_ES },
  },
  {
    id: 'starter-read-to-a-dog',
    name: 'Read to a Dog',
    kind: 'slotted',
    audience: 'children',
    capacity: 0,
    startTime: '10:30',
    endTime: '11:30',
    slots: [
      { start: '10:30', end: '10:40' },
      { start: '10:40', end: '10:50' },
      { start: '10:50', end: '11:00' },
      { start: '11:00', end: '11:10' },
      { start: '11:10', end: '11:20' },
    ],
    defaultTracks: 1,
    trackLabel: 'Dog',
    fields: { age: true, email: true, caregiver: true, notes: true },
    volunteers: true,
    recurring: true,
    reminder: { en: SLOTTED_EN, es: SLOTTED_ES },
  },
];
