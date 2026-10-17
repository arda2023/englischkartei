// Zentraler Zustand: hält die Datenbank im Speicher und persistiert jede Änderung
// über den Main-Prozess (atomares Schreiben nach ./data/database.json).

import { newSrs } from '../lib/srs.js';
import { stripMarkup } from '../lib/markup.js';
import { toItem, nextFastStreak, isMastered } from '../lib/vocab.js';

export const TEXT_FIELDS = [
  'German',
  'Hint',
  'English',
  'Trap',
  'Pattern',
  'Transfer1',
  'Transfer2',
  'Rule',
  'Alternative1',
  'Alternative2',
];

export const DEFAULT_SETTINGS = {
  newPerDay: 20,
  autoShowHint: false,
};

const listeners = new Set();
let db = { cards: [] };
let saveState = 'idle';

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(reason) {
  for (const fn of listeners) fn(reason);
}

export async function load() {
  const loaded = await window.api.loadDb();
  db = {
    ...loaded,
    cards: loaded.cards.map((c) => normalizeCard(c)),
  };
  emit('load');
}

/** Ersetzt den kompletten Stand (z. B. nach Backup-Wiederherstellung; bereits gespeichert). */
export function replaceAll(loaded) {
  db = {
    ...loaded,
    cards: loaded.cards.map((c) => normalizeCard(c)),
  };
  emit('load');
}

export function getSaveState() {
  return saveState;
}

let pending = Promise.resolve();
/** Speichert die gesamte Datenbank; Aufrufe werden in Reihe ausgeführt. */
export function save(reason = 'save') {
  emit(reason);
  saveState = 'saving';
  emit('save-state');
  const snapshot = JSON.parse(JSON.stringify(db));
  pending = pending
    .catch(() => {})
    .then(() => window.api.saveDb(snapshot))
    .then(() => {
      saveState = 'saved';
      emit('save-state');
    })
    .catch((err) => {
      saveState = 'error';
      console.error(err);
      emit('save-state');
      emit('save-error');
    });
  return pending;
}

export function cards() {
  return db.cards;
}

export function getCard(id) {
  return db.cards.find((c) => c.id === id);
}

export function settings() {
  return { ...DEFAULT_SETTINGS, ...(db.settings || {}) };
}

export function updateSettings(patch) {
  db.settings = { ...settings(), ...patch };
  return save('settings');
}

export function exportJson() {
  return JSON.stringify(db, null, 2);
}

// ------------------------------------------------------------------ Karten

/** Bringt eine (evtl. importierte oder ältere) Karte in die vollständige Form. */
export function normalizeCard(input, now = new Date()) {
  const card = {
    id: typeof input.id === 'string' && input.id ? input.id : uuid(),
    createdAt: isIsoDate(input.createdAt) ? input.createdAt : now.toISOString(),
  };
  for (const field of TEXT_FIELDS) {
    const value = input[field] ?? input[field.toLowerCase()] ?? '';
    card[field] = String(value).trim();
  }
  card.tags = normalizeTags(input.tags);
  const srs = input.srs && typeof input.srs === 'object' ? input.srs : null;
  card.srs = srs && ['new', 'learning', 'review', 'relearning'].includes(srs.state) ? { ...newSrs(now), ...srs } : newSrs(now);
  card.history = Array.isArray(input.history) ? input.history : [];
  return card;
}

function isIsoDate(v) {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v));
}

export function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags ?? '').split(/[,;]/);
  const out = [];
  for (const t of list) {
    const tag = String(t).trim().toLowerCase().replace(/\s+/g, '-');
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

export function createCard(fields) {
  const card = normalizeCard({ ...fields, id: uuid(), createdAt: new Date().toISOString() });
  db.cards.push(card);
  save('card-created');
  return card;
}

export function updateCard(id, fields) {
  const card = getCard(id);
  if (!card) return null;
  for (const field of TEXT_FIELDS) {
    if (field in fields) card[field] = String(fields[field] ?? '').trim();
  }
  if ('tags' in fields) card.tags = normalizeTags(fields.tags);
  save('card-updated');
  return card;
}

export function deleteCard(id) {
  const index = db.cards.findIndex((c) => c.id === id);
  if (index === -1) return null;
  const [removed] = db.cards.splice(index, 1);
  save('card-deleted');
  return { card: removed, index };
}

export function restoreCard({ card, index }) {
  db.cards.splice(Math.min(index, db.cards.length), 0, card);
  save('card-created');
}

export function resetProgress(id) {
  const card = getCard(id);
  if (!card) return;
  card.srs = newSrs();
  save('card-updated');
}

/** Speichert einen Lernversuch und den neuen SRS-Zustand. */
export function recordAttempt(id, attempt, srs) {
  const card = getCard(id);
  if (!card) return;
  card.history.push(attempt);
  card.srs = srs;
  save('attempt');
}

/** Macht den letzten Lernversuch einer Karte rückgängig. */
export function undoAttempt(id, attemptId, previousSrs) {
  const card = getCard(id);
  if (!card) return false;
  const index = card.history.findIndex((a) => a.attemptId === attemptId);
  if (index === -1) return false;
  card.history.splice(index, 1);
  card.srs = previousSrs;
  save('attempt');
  return true;
}

function duplicateKey(card) {
  const norm = (s) => stripMarkup(s).toLowerCase().replace(/\s+/g, ' ').trim();
  return `${norm(card.German)}|${norm(card.English)}`;
}

/**
 * Importiert Karten aus JSON-Text: entweder ein Array von Karten oder ein Objekt
 * mit "cards". Duplikate (gleicher deutscher + englischer Satz) werden übersprungen.
 */
export function importCards(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Kein gültiges JSON: ${err.message}`);
  }
  const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.cards) ? parsed.cards : null;
  if (!list) throw new Error('Erwartet wird ein Array von Karten oder ein Objekt mit "cards".');

  const existingKeys = new Set(db.cards.map(duplicateKey));
  const existingIds = new Set(db.cards.map((c) => c.id));
  let added = 0;
  let duplicates = 0;
  let invalid = 0;
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') {
      invalid++;
      continue;
    }
    const card = normalizeCard(raw);
    if (!card.German || !card.English) {
      invalid++;
      continue;
    }
    const key = duplicateKey(card);
    if (existingKeys.has(key)) {
      duplicates++;
      continue;
    }
    if (existingIds.has(card.id)) card.id = uuid();
    existingKeys.add(key);
    existingIds.add(card.id);
    db.cards.push(card);
    added++;
  }
  if (added) save('import');
  return { added, duplicates, invalid };
}

// ------------------------------------------------------------------ Vokabeln (Speed-Drill)
// db.vocab = { items: [...aktive Wörter mit Zählern], removed: [...dauerhaft gelöschte Wörter] }

export function vocab() {
  return db.vocab ?? null;
}

/** Übernimmt beim ersten Aufruf die mitgelieferte Liste in die Datenbank. */
export async function ensureVocab() {
  if (db.vocab) return;
  const seed = await window.api.vocabSeed();
  db.vocab = { items: seed.map(toItem), removed: [] };
  save('vocab');
}

/** Speichert eine Antwort und führt die Serie „schnell richtig“ nach. Gibt zurück, ob das Wort damit gelernt ist. */
export function recordVocabAnswer(id, correct, revealSeconds) {
  const item = db.vocab?.items.find((i) => i.id === id);
  if (!item) return false;
  if (correct) item.right += 1;
  else item.wrong += 1;
  item.lastSeen = new Date().toISOString();
  item.fastStreak = nextFastStreak(item.fastStreak, { correct, revealSeconds });
  const mastered = isMastered(item.fastStreak);
  if (mastered) {
    removeVocab(id, 'mastered');
  } else {
    save('vocab');
  }
  return mastered;
}

/** Löscht ein Wort dauerhaft aus dem Training (bleibt unter „Gelöschte Wörter“ wiederherstellbar). */
export function removeVocab(id, reason = 'known') {
  const index = db.vocab?.items.findIndex((i) => i.id === id) ?? -1;
  if (index === -1) return null;
  const [item] = db.vocab.items.splice(index, 1);
  db.vocab.removed.push({ ...item, removedAt: new Date().toISOString(), removedReason: reason });
  save('vocab');
  return item;
}

export function restoreVocab(id) {
  const index = db.vocab?.removed.findIndex((i) => i.id === id) ?? -1;
  if (index === -1) return;
  const { removedAt, removedReason, ...item } = db.vocab.removed.splice(index, 1)[0];
  db.vocab.items.push({ ...item, fastStreak: 0 });
  save('vocab');
}

export function restoreAllVocab() {
  if (!db.vocab) return;
  for (const { removedAt, removedReason, ...item } of db.vocab.removed) db.vocab.items.push({ ...item, fastStreak: 0 });
  db.vocab.removed = [];
  save('vocab');
}
