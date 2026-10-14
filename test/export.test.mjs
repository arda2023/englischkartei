import test from 'node:test';
import assert from 'node:assert/strict';
import {
  errorPairs, formatAttemptLine, selectAttempts, buildSelection, toMarkdown, toJson,
  isProblemCard, hasErrors, cardHistoryMarkdown, describeFilter,
} from '../src/lib/export.js';
import { diffAgainst } from '../src/lib/diff.js';

const EN = 'When I arrived at the gate, the other passengers [[were already boarding]].';
let t0 = new Date('2026-10-14T10:12:04').getTime();
function attempt(input, rating, { offsetDays = 0, secs = 15 } = {}) {
  const shown = new Date(t0 + offsetDays * 86400000);
  const submitted = new Date(shown.getTime() + secs * 1000);
  const r = diffAgainst(input, EN);
  return {
    attemptId: Math.random().toString(36), shownAt: shown.toISOString(), submittedAt: submitted.toISOString(),
    thinkingTimeSeconds: secs, userInput: input, matchedTarget: r.target, isExactMatch: r.isExactMatch,
    diffTokens: r.diffTokens, rating, intervalAfterText: rating === 'Gut' ? '1 Tag' : '<10 Min.', stateBefore: 'learning',
  };
}
function card(history, extra = {}) {
  return { id: extra.id ?? 'c1', German: 'Als ich am Gate ankam, stiegen die anderen Passagiere bereits ein.', English: EN,
    Pattern: 'When + [Past Simple]', tags: ['tenses'], srs: { state: 'review', intervalDays: 2, lapses: 0, dueDate: new Date().toISOString() }, history, ...extra };
}

test('errorPairs fasst zusammenhängende Fehler zusammen', () => {
  const r = diffAgainst('When I arrived in the gate, the other passengers boarded.', EN);
  assert.deepEqual(errorPairs(r.diffTokens), ['[in -> at]', '[boarded -> were already boarding]']);
  const typo = diffAgainst('When I arrived at the gate, the other passangers were already boarding.', EN);
  assert.deepEqual(errorPairs(typo.diffTokens), ['[passangers -> passengers (Tippfehler)]']);
});

test('formatAttemptLine entspricht dem Kompakt-Format', () => {
  const line = formatAttemptLine(attempt('When I arrived in the gate, the other passengers boarded', 'Schwer'), 1);
  assert.equal(line, '1. [14.10.2026 10:12:04 -> 10:12:19 (15.0s)] ❌ Eingabe: "When I arrived in the gate, the other passengers boarded" | Fehler: [in -> at], [boarded -> were already boarding] | Bewertung: Schwer (<10 Min.)');
  const ok = formatAttemptLine(attempt('When I arrived at the gate, the other passengers were already boarding.', 'Gut', { secs: 6 }), 3);
  assert.match(ok, /^3\. \[.*\(6\.0s\)\] ✅ Eingabe: ".*" \| Bewertung: Gut \(1 Tag\)$/);
});

test('Smart-Kompression: 1. + letzte 3, Nummern bleiben erhalten', () => {
  const h = Array.from({ length: 7 }, (_, i) => attempt('x', 'Nochmal', { offsetDays: i }));
  const { attempts } = selectAttempts(h, { compression: 'smart' });
  assert.deepEqual(attempts.map((a) => a.number), [1, 5, 6, 7]);
  const md = toMarkdown(buildSelection([card(h)], { scope: 'attempted' }));
  assert.match(md, /… 3 Versuch\(e\) ausgelassen …/);
});

test('Nur Fehler + letzter Versuch', () => {
  const good = 'When I arrived at the gate, the other passengers were already boarding.';
  const h = [attempt('x', 'Nochmal'), attempt(good, 'Gut'), attempt('y', 'Schwer'), attempt(good, 'Gut')];
  assert.deepEqual(selectAttempts(h, { compression: 'errors' }).attempts.map((a) => a.number), [1, 3, 4]);
});

test('Zeitraum-Filter', () => {
  const now = new Date(t0 + 20 * 86400000);
  const h = [attempt('a', 'Nochmal'), attempt('b', 'Nochmal', { offsetDays: 15 }), attempt('c', 'Nochmal', { offsetDays: 19 })];
  assert.deepEqual(selectAttempts(h, { periodDays: 7, compression: 'all', now }).attempts.map((a) => a.number), [2, 3]);
  assert.equal(selectAttempts(h, { periodDays: 30, compression: 'all', now }).attempts.length, 3);
});

test('Scopes und Sorgenkinder', () => {
  const good = 'When I arrived at the gate, the other passengers were already boarding.';
  const perfect = card([attempt(good, 'Gut')], { id: 'perfect' });
  const problem = card([attempt('x', 'Schwer'), attempt(good, 'Gut')], { id: 'problem' });
  const untouched = card([], { id: 'new' });
  assert.equal(isProblemCard(perfect), false);
  assert.equal(hasErrors(problem), true);
  const ids = (sel) => sel.entries.map((e) => e.card.id);
  assert.deepEqual(ids(buildSelection([perfect, problem, untouched], { scope: 'problems' })), ['problem']);
  assert.deepEqual(ids(buildSelection([perfect, problem, untouched], { scope: 'attempted' })), ['perfect', 'problem']);
  assert.deepEqual(ids(buildSelection([perfect, problem, untouched], { scope: 'selected', selectedIds: ['new'] })), ['new']);
});

test('Markdown-Kopf, JSON und Einzelkarte', () => {
  const c = card([attempt('When I arrived in the gate', 'Schwer')]);
  const sel = buildSelection([c], { scope: 'attempted' });
  const md = toMarkdown(sel, { filterText: describeFilter({ scope: 'attempted', period: 'all', compression: 'smart' }), now: new Date('2026-10-14T11:30:00') });
  assert.match(md, /^# Englisch-Lernverlauf Export \(14\.10\.2026, 11:30\)\nFilter: .* \| Karten: 1 \| Versuche: 1\n\n### 1\. "Als ich am Gate/);
  assert.match(md, /- Statistik: 1 Versuch \(1 falsch\) \| Aktuelles Intervall: 2 Tg\./);
  const json = JSON.parse(toJson(sel));
  assert.equal(json.cards[0].history.length, 1);
  assert.equal(json.cards[0].historyTotal, 1);
  assert.match(cardHistoryMarkdown(c, { pendingAttempt: { ...attempt('x', null), rating: null } }), /2\. .*Bewertung: \(noch nicht bewertet\)/);
});
