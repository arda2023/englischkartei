// Auswertung des Lernverlaufs und KI-Export (Markdown/JSON).
// Reine Funktionen ohne DOM – auch in Node testbar.

export const SCOPES = {
  selected: 'Nur ausgewählte Karten',
  problems: 'Nur Sorgenkinder & Karten mit Fehlern',
  attempted: 'Alle Karten mit mindestens 1 Versuch',
};

export const PERIODS = {
  all: { label: 'Alle Zeiten', days: null },
  7: { label: 'Letzte 7 Tage', days: 7 },
  30: { label: 'Letzte 30 Tage', days: 30 },
};

export const COMPRESSIONS = {
  smart: 'Smart (1. Versuch + letzte 3)',
  errors: 'Nur fehlerhafte Versuche + letzter Versuch',
  all: 'Alle Versuche ungekürzt',
};

/** Ab dieser Größe wird vor zu langen Exporten gewarnt. */
export const SIZE_WARNING_CHARS = 40000;

const BAD_RATINGS = ['Nochmal', 'Schwer'];
const DAY = 86400000;

// ------------------------------------------------------------------ Kennzahlen

export function ratingCounts(card) {
  const counts = {};
  for (const a of card.history) counts[a.rating] = (counts[a.rating] || 0) + 1;
  return counts;
}

export function lastAttempt(card) {
  return card.history.length ? card.history[card.history.length - 1] : null;
}

export function errorCount(card) {
  return card.history.filter((a) => !a.isExactMatch).length;
}

export function avgThinkingTime(card) {
  if (!card.history.length) return 0;
  return card.history.reduce((s, a) => s + (a.thinkingTimeSeconds || 0), 0) / card.history.length;
}

/** Sorgenkind: mind. 2× Nochmal/Schwer bewertet oder letzte Eingabe nicht exakt. */
export function isProblemCard(card) {
  if (!card.history.length) return false;
  const bad = card.history.filter((a) => BAD_RATINGS.includes(a.rating)).length;
  return bad >= 2 || !lastAttempt(card).isExactMatch;
}

export function hasErrors(card) {
  return card.history.some((a) => !a.isExactMatch);
}

export function isDueToday(card, now = new Date()) {
  if (card.srs.state === 'new') return false;
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  return new Date(card.srs.dueDate) <= endOfDay;
}

// ------------------------------------------------------------------ Formatierung

const pad = (n) => String(n).padStart(2, '0');

export function fmtDate(d) {
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function fmtTime(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "14.10.2026 10:12:04 -> 10:12:19" (Datum beim Ende nur, wenn ein anderer Tag) */
export function fmtSpan(shownAt, submittedAt) {
  const s = new Date(shownAt);
  const e = new Date(submittedAt);
  return `${fmtDate(s)} ${fmtTime(s)} -> ${sameDay(s, e) ? '' : `${fmtDate(e)} `}${fmtTime(e)}`;
}

/**
 * Fasst aufeinanderfolgende Abweichungen zu Paaren zusammen:
 * [boarded -> were already boarding], [– -> already], [now -> –]
 */
export function errorPairs(diffTokens = []) {
  const pairs = [];
  let run = null;
  const flush = () => {
    if (!run) return;
    const user = run.user.join(' ') || '–';
    const expected = run.expected.join(' ') || '–';
    pairs.push(`[${user} -> ${expected}${run.onlyTypos ? ' (Tippfehler)' : ''}]`);
    run = null;
  };
  for (const t of diffTokens) {
    if (t.status === 'ok') {
      flush();
      continue;
    }
    run ??= { user: [], expected: [], onlyTypos: true };
    if (t.status !== 'typo') run.onlyTypos = false;
    if (t.text) run.user.push(t.text);
    if (t.expected) run.expected.push(t.expected);
  }
  flush();
  return pairs;
}

function quote(text) {
  return `"${String(text).replace(/"/g, '\\"')}"`;
}

export const DICTATED_MARK = '🎤[DIKTIERT]';

/** Versuche ohne Feld `inputMethod` (ältere Daten) gelten als getippt. */
export function isDictated(attempt) {
  return attempt?.inputMethod === 'dictated';
}

/** Eine Zeile pro Versuch im Kompakt-Markdown. */
export function formatAttemptLine(attempt, number) {
  const time = `${Number(attempt.thinkingTimeSeconds ?? 0).toFixed(1)}s`;
  const head = `${number}. [${fmtSpan(attempt.shownAt, attempt.submittedAt)} (${time})]`;
  const mark = `${attempt.isExactMatch ? '✅' : '❌'}${isDictated(attempt) ? ` ${DICTATED_MARK}` : ''}`;
  const input = attempt.userInput ? `Eingabe: ${quote(attempt.userInput)}` : 'Eingabe: (keine – „Weiß nicht“)';
  const parts = [`${head} ${mark} ${input}`];
  if (attempt.userInput && !attempt.isExactMatch) {
    const pairs = errorPairs(attempt.diffTokens);
    if (pairs.length) parts.push(`Fehler: ${pairs.join(', ')}`);
  }
  const rating = attempt.rating ? `${attempt.rating}${attempt.intervalAfterText ? ` (${attempt.intervalAfterText})` : ''}` : '(noch nicht bewertet)';
  parts.push(`Bewertung: ${rating}`);
  return parts.join(' | ');
}

function intervalText(srs) {
  if (srs.state === 'new') return 'neu';
  if (srs.state === 'learning') return 'Lernphase';
  if (srs.state === 'relearning') return 'Wieder lernen';
  return `${srs.intervalDays} Tg.`;
}

// ------------------------------------------------------------------ Auswahl

/** Liefert [{ attempt, number }] – number ist die Position im gesamten Verlauf (1-basiert). */
export function selectAttempts(history, { periodDays = null, compression = 'smart', now = new Date() } = {}) {
  let list = history.map((attempt, i) => ({ attempt, number: i + 1 }));
  if (periodDays) {
    const since = now.getTime() - periodDays * DAY;
    list = list.filter(({ attempt }) => Date.parse(attempt.submittedAt) >= since);
  }
  const inPeriod = list.length;
  if (compression === 'smart' && list.length > 4) {
    list = [list[0], ...list.slice(-3)];
  } else if (compression === 'errors' && list.length) {
    const last = list[list.length - 1];
    list = list.filter(({ attempt }) => !attempt.isExactMatch);
    if (!list.includes(last)) list.push(last);
  }
  return { attempts: list, inPeriod };
}

/**
 * Stellt den Export zusammen.
 * @returns {{ entries: Array<{card, attempts, inPeriod}>, attemptCount: number }}
 */
export function buildSelection(cards, { scope = 'problems', selectedIds = [], period = 'all', compression = 'smart', now = new Date() } = {}) {
  const selected = new Set(selectedIds);
  const periodDays = PERIODS[period]?.days ?? null;
  const entries = [];
  for (const card of cards) {
    if (scope === 'selected' && !selected.has(card.id)) continue;
    if (scope === 'problems' && !(isProblemCard(card) || hasErrors(card))) continue;
    if (scope === 'attempted' && !card.history.length) continue;
    const { attempts, inPeriod } = selectAttempts(card.history, { periodDays, compression, now });
    // Explizit ausgewählte Karten bleiben drin, auch ohne Versuche im Zeitraum.
    if (!attempts.length && scope !== 'selected') continue;
    entries.push({ card, attempts, inPeriod });
  }
  return { entries, attemptCount: entries.reduce((s, e) => s + e.attempts.length, 0) };
}

export function describeFilter({ scope, period, compression, selectedCount = 0 }) {
  const scopeLabel = scope === 'selected' ? `${SCOPES.selected} (${selectedCount})` : SCOPES[scope];
  return `${scopeLabel} · ${PERIODS[period]?.label ?? period} · ${COMPRESSIONS[compression]}`;
}

// ------------------------------------------------------------------ Ausgabe

function cardBlock({ card, attempts }, index) {
  const tags = card.tags.length ? ` [${card.tags.join(', ')}]` : '';
  const errors = errorCount(card);
  const lines = [
    `### ${index}. ${quote(card.German)}${tags}`,
    `- Ziel: ${card.English}`,
  ];
  if (card.Pattern) lines.push(`- Pattern: ${card.Pattern}`);
  lines.push(
    `- Statistik: ${card.history.length} ${card.history.length === 1 ? 'Versuch' : 'Versuche'} (${errors} falsch) | Aktuelles Intervall: ${intervalText(card.srs)}${card.srs.lapses ? ` | Lapses: ${card.srs.lapses}` : ''}`,
  );
  if (!attempts.length) {
    lines.push('- Verlauf: (keine Versuche im gewählten Zeitraum)');
    return lines.join('\n');
  }
  lines.push('- Verlauf:');
  let previous = 0;
  for (const { attempt, number } of attempts) {
    if (number - previous > 1 && previous > 0) lines.push(`  … ${number - previous - 1} Versuch(e) ausgelassen …`);
    lines.push(`  ${formatAttemptLine(attempt, number)}`);
    previous = number;
  }
  return lines.join('\n');
}

export function toMarkdown(selection, { filterText = '', now = new Date() } = {}) {
  const all = selection.entries.flatMap((e) => e.attempts.map((x) => x.attempt));
  const dictated = all.filter(isDictated).length;
  const header = [
    `# Englisch-Lernverlauf Export (${fmtDate(now)}, ${fmtTime(now).slice(0, 5)})`,
    `Filter: ${filterText || '–'} | Karten: ${selection.entries.length} | Versuche: ${selection.attemptCount}`,
    ...(dictated
      ? [
          `Eingabeart: ${DICTATED_MARK} = Satz wurde gesprochen (per KI-Diktier-App), Zeilen ohne Markierung = getippt. ` +
            `Diktiert: ${dictated} von ${all.length} Versuchen.`,
        ]
      : []),
  ].join('\n');
  const blocks = selection.entries.map((entry, i) => cardBlock(entry, i + 1));
  return [header, ...blocks].join('\n\n') + '\n';
}

export function toJson(selection, { filter = {}, now = new Date() } = {}) {
  return (
    JSON.stringify(
      {
        exportedAt: now.toISOString(),
        filter,
        summary: { cards: selection.entries.length, attempts: selection.attemptCount },
        cards: selection.entries.map(({ card, attempts }) => ({
          ...card,
          historyTotal: card.history.length,
          history: attempts.map(({ attempt }) => ({ ...attempt, inputMethod: isDictated(attempt) ? 'dictated' : 'typed' })),
        })),
      },
      null,
      2,
    ) + '\n'
  );
}

/** Verlauf genau einer Karte (ungekürzt), optional mit dem gerade laufenden Versuch. */
export function cardHistoryMarkdown(card, { pendingAttempt = null, now = new Date() } = {}) {
  const history = pendingAttempt ? [...card.history, pendingAttempt] : card.history;
  const entry = {
    card: { ...card, history },
    attempts: history.map((attempt, i) => ({ attempt, number: i + 1 })),
    inPeriod: history.length,
  };
  return toMarkdown({ entries: [entry], attemptCount: history.length }, { filterText: 'Einzelkarte, alle Versuche', now });
}

/** Grobe Token-Schätzung (≈ 4 Zeichen pro Token für gemischten DE/EN-Text). */
export function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
