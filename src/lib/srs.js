// Spaced-Repetition-Planung (SM-2-Variante mit Lernschritten, angelehnt an Anki).
//
// Zustände:
//   new        – noch nie beantwortet
//   learning   – in der Lernphase (Wiederholung innerhalb von Minuten)
//   review     – im Langzeit-Rhythmus (Intervall in Tagen)
//   relearning – nach einem Fehler in der Review-Phase wieder in Minuten-Schritten
//
// In learning/relearning hält intervalDays das Tages-Intervall, mit dem die Karte
// (wieder) in die Review-Phase übergeht – die Minuten-Schritte stehen nur im dueDate.

export const RATINGS = ['Nochmal', 'Schwer', 'Gut', 'Einfach'];

export const DEFAULT_EASE = 2.3;
const MIN_EASE = 1.3;
const MAX_INTERVAL_DAYS = 3650;
const AGAIN_MINUTES = 1;
const HARD_MINUTES = 10;
const GRADUATING_DAYS = 1;
const EASY_DAYS = 4;

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export function newSrs(now = new Date()) {
  return {
    state: 'new',
    intervalDays: 0,
    easeFactor: DEFAULT_EASE,
    repetitions: 0,
    lapses: 0,
    dueDate: now.toISOString(),
  };
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Fälligkeit für Tages-Intervalle: Mitternacht (lokal) am Zieltag. */
function dueInDays(now, days) {
  const d = startOfDay(now);
  d.setDate(d.getDate() + days);
  return d;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function clampInterval(days) {
  return Math.min(MAX_INTERVAL_DAYS, Math.max(1, Math.round(days)));
}

/**
 * Berechnet den neuen SRS-Zustand für eine Bewertung.
 * Gibt { srs, minutes | days } zurück – genau eines von beiden ist gesetzt.
 */
export function schedule(srsIn, rating, now = new Date()) {
  if (!RATINGS.includes(rating)) throw new Error(`Unbekannte Bewertung: ${rating}`);
  const prev = { ...newSrs(now), ...srsIn };
  const srs = { ...prev };
  let minutes = null;
  let days = null;

  if (prev.state === 'new' || prev.state === 'learning') {
    switch (rating) {
      case 'Nochmal':
        srs.state = 'learning';
        minutes = AGAIN_MINUTES;
        break;
      case 'Schwer':
        srs.state = 'learning';
        minutes = HARD_MINUTES;
        break;
      case 'Gut':
        srs.state = 'review';
        days = GRADUATING_DAYS;
        srs.repetitions = prev.repetitions + 1;
        break;
      case 'Einfach':
        srs.state = 'review';
        days = EASY_DAYS;
        srs.easeFactor = round2(prev.easeFactor + 0.15);
        srs.repetitions = prev.repetitions + 1;
        break;
    }
  } else if (prev.state === 'relearning') {
    switch (rating) {
      case 'Nochmal':
        minutes = AGAIN_MINUTES;
        break;
      case 'Schwer':
        minutes = HARD_MINUTES;
        break;
      case 'Gut':
        srs.state = 'review';
        days = clampInterval(prev.intervalDays || 1);
        srs.repetitions = prev.repetitions + 1;
        break;
      case 'Einfach':
        srs.state = 'review';
        days = clampInterval((prev.intervalDays || 1) + 1);
        srs.repetitions = prev.repetitions + 1;
        break;
    }
  } else {
    // review
    const current = Math.max(1, prev.intervalDays || 1);
    const daysLate = Math.max(0, (now - new Date(prev.dueDate)) / DAY);
    const hard = clampInterval(Math.max(current + 1, current * 1.2));
    const good = clampInterval(Math.max(hard + 1, (current + daysLate / 2) * prev.easeFactor));
    const easy = clampInterval(Math.max(good + 1, (current + daysLate) * prev.easeFactor * 1.3));
    switch (rating) {
      case 'Nochmal':
        srs.state = 'relearning';
        srs.lapses = prev.lapses + 1;
        srs.repetitions = 0;
        srs.easeFactor = round2(Math.max(MIN_EASE, prev.easeFactor - 0.2));
        srs.intervalDays = clampInterval(current * 0.5);
        minutes = AGAIN_MINUTES;
        break;
      case 'Schwer':
        srs.easeFactor = round2(Math.max(MIN_EASE, prev.easeFactor - 0.15));
        days = hard;
        srs.repetitions = prev.repetitions + 1;
        break;
      case 'Gut':
        days = good;
        srs.repetitions = prev.repetitions + 1;
        break;
      case 'Einfach':
        srs.easeFactor = round2(prev.easeFactor + 0.15);
        days = easy;
        srs.repetitions = prev.repetitions + 1;
        break;
    }
  }

  if (days != null) {
    srs.intervalDays = days;
    srs.dueDate = dueInDays(now, days).toISOString();
  } else {
    srs.dueDate = new Date(now.getTime() + minutes * MINUTE).toISOString();
  }
  return { srs, minutes, days };
}

/** "<1 Min.", "<10 Min.", "1 Tag", "12 Tage", "2,3 Mon.", "1,4 J." */
export function formatInterval({ minutes, days }) {
  if (minutes != null) return `<${minutes} Min.`;
  if (days < 30) return days === 1 ? '1 Tag' : `${days} Tage`;
  const fmt = (n) => n.toLocaleString('de-DE', { maximumFractionDigits: 1 });
  if (days < 365) return `${fmt(days / 30)} Mon.`;
  return `${fmt(days / 365)} J.`;
}

/** Vorschau aller vier Bewertungen: { Nochmal: '<1 Min.', ... } */
export function previewIntervals(srs, now = new Date()) {
  const out = {};
  for (const rating of RATINGS) out[rating] = formatInterval(schedule(srs, rating, now));
  return out;
}

export function isDue(card, now = new Date()) {
  return card.srs.state !== 'new' && new Date(card.srs.dueDate) <= now;
}
