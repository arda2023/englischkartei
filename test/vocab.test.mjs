import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toItem, vocabId, weight, pickNext, countByCategory } from '../src/lib/vocab.js';

const seed = JSON.parse(readFileSync(new URL('../data/vocab-seed.json', import.meta.url), 'utf8'));

test('Seed: 500 eindeutige Wörter, 5×100, Ein-Wort-Regel', () => {
  assert.equal(seed.length, 500);
  assert.equal(new Set(seed.map(vocabId)).size, 500);
  assert.deepEqual(Object.values(countByCategory(seed)), [100, 100, 100, 100, 100]);
  for (const w of seed.filter((x) => x.category !== 'connectors')) {
    assert.ok(!/\s/.test(w.de), w.de);
    assert.ok(!/\s/.test(w.en) || w.en === 'boarding pass', w.en);
  }
});

test('Gewichte: neu > falsch > gewusst', () => {
  assert.ok(weight({ right: 0, wrong: 0 }) > weight({ right: 3, wrong: 0 }));
  assert.ok(weight({ right: 0, wrong: 2 }) > weight({ right: 0, wrong: 0 }));
  assert.ok(weight({ right: 50, wrong: 0 }) >= 0.3);
});

test('pickNext wechselt die Kategorie und wiederholt nie direkt dasselbe Wort', () => {
  const items = seed.map(toItem);
  let last = { lastId: null, lastCategory: null };
  for (let i = 0; i < 300; i++) {
    const next = pickNext(items, last);
    assert.notEqual(next.id, last.lastId);
    if (last.lastCategory) assert.notEqual(next.category, last.lastCategory);
    last = { lastId: next.id, lastCategory: next.category };
  }
});

test('Kategorie-Filter, einzelne Kategorie und leerer Pool', () => {
  const items = seed.map(toItem);
  for (let i = 0; i < 30; i++) assert.equal(pickNext(items, { category: 'travel', lastCategory: 'travel' }).category, 'travel');
  assert.equal(pickNext([], {}), null);
  const one = [items[0]];
  assert.equal(pickNext(one, { lastId: items[0].id, lastCategory: items[0].category }).id, items[0].id);
});

test('schwere Wörter werden häufiger gezogen', () => {
  const a = toItem({ de: 'a', en: 'a', category: 'travel' });
  const b = toItem({ de: 'b', en: 'b', category: 'travel' });
  a.wrong = 4;
  b.right = 5;
  let hitsA = 0;
  for (let i = 0; i < 2000; i++) if (pickNext([a, b], {}, Math.random).id === a.id) hitsA++;
  assert.ok(hitsA > 1600, String(hitsA));
});

import { nextFastStreak, isMastered, FAST_SECONDS, MASTER_STREAK } from '../src/lib/vocab.js';

test('Serie: 3× schnell (≤5 s) richtig hintereinander = gelernt', () => {
  assert.equal(FAST_SECONDS, 5);
  assert.equal(MASTER_STREAK, 3);
  let s = 0;
  s = nextFastStreak(s, { correct: true, revealSeconds: 2 });
  s = nextFastStreak(s, { correct: true, revealSeconds: 5 }); // genau 5 s zählt noch
  assert.equal(isMastered(s), false);
  s = nextFastStreak(s, { correct: true, revealSeconds: 0.8 });
  assert.equal(isMastered(s), true);
});

test('Serie bricht bei langsam oder falsch ab', () => {
  assert.equal(nextFastStreak(2, { correct: true, revealSeconds: 5.1 }), 0);
  assert.equal(nextFastStreak(2, { correct: false, revealSeconds: 1 }), 0);
  assert.equal(nextFastStreak(undefined, { correct: true, revealSeconds: 1 }), 1);
});
