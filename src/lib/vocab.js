// Logik für den Vokabel-Speed-Drill (rein, ohne DOM – testbar).

export const CATEGORY_LABELS = {
  medical: 'Kiefer-OP',
  travel: 'Reise',
  clinic: 'Arzt & Klinik',
  smalltalk: 'Alltag',
  connectors: 'Satzverbindungen',
};

export function vocabId(entry) {
  return `${entry.category}:${entry.de.trim().toLowerCase()}`;
}

/** Macht aus einem Eintrag der Seed-Liste ein Lern-Item mit Zählern. */
export function toItem(entry) {
  return { id: vocabId(entry), de: entry.de, en: entry.en, category: entry.category, right: 0, wrong: 0, lastSeen: null, fastStreak: 0 };
}

/**
 * Gewicht für die Zufallsauswahl: Ungesehenes kommt oft, oft Falsches öfter,
 * oft Richtiges seltener (aber nie ganz weg).
 */
export function weight({ right = 0, wrong = 0 }) {
  if (!right && !wrong) return 2;
  return Math.max(0.3, 1 + wrong * 1.5 - right * 0.4);
}

/**
 * Wählt das nächste Wort zufällig über alle (gefilterten) Kategorien.
 * Dasselbe Wort kommt nie zweimal direkt hintereinander, und die Kategorie wechselt,
 * solange mehr als eine Kategorie übrig ist – das erzwingt den Kontextwechsel.
 */
export function pickNext(items, { category = 'all', lastId = null, lastCategory = null } = {}, rng = Math.random) {
  let pool = category === 'all' ? items : items.filter((i) => i.category === category);
  if (pool.length > 1) pool = pool.filter((i) => i.id !== lastId);
  const other = pool.filter((i) => i.category !== lastCategory);
  if (other.length) pool = other;
  if (!pool.length) return null;
  const weights = pool.map(weight);
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r < 0) return pool[i];
  }
  return pool[pool.length - 1];
}

export function countByCategory(items) {
  const counts = {};
  for (const i of items) counts[i.category] = (counts[i.category] || 0) + 1;
  return counts;
}

// ------------------------------------------------------------------ Automatisch „gelernt“

/** Aufgelöst innerhalb dieser Zeit und dann „Richtig“ zählt als schnell gewusst. */
export const FAST_SECONDS = 5;
/** So oft hintereinander schnell richtig, dann wird das Wort nie wieder angezeigt. */
export const MASTER_STREAK = 3;

/**
 * Neue Serie „schnell richtig“. Jede Antwort, die nicht schnell UND richtig ist
 * (falsch oder zu langsam), setzt die Serie auf 0 zurück.
 */
export function nextFastStreak(streak, { correct, revealSeconds }) {
  return correct && revealSeconds <= FAST_SECONDS ? (streak || 0) + 1 : 0;
}

export function isMastered(streak) {
  return streak >= MASTER_STREAK;
}
