import test from 'node:test';
import assert from 'node:assert/strict';
import { compareAnswer, diffAgainst, tokenize, suggestRating } from '../src/lib/diff.js';

const EN = 'When I arrived at the gate, the other passengers [[were already boarding]].';

test('exakte Übereinstimmung ignoriert Großschreibung und Satzzeichen', () => {
  const r = diffAgainst('when i arrived at the gate the other passengers were already boarding', EN);
  assert.equal(r.isExactMatch, true);
  assert.ok(r.diffTokens.every((t) => t.status === 'ok'));
});

test('Ersetzung wird als wrong mit expected erkannt', () => {
  const r = diffAgainst('When I arrived in the gate, the other passengers were already boarding.', EN);
  assert.equal(r.isExactMatch, false);
  const wrong = r.diffTokens.filter((t) => t.status === 'wrong');
  assert.deepEqual(wrong, [{ text: 'in', status: 'wrong', expected: 'at' }]);
});

test('fehlende und überzählige Wörter', () => {
  const r = diffAgainst('When I arrived at the gate the passengers already were boarding now', EN);
  const statuses = r.diffTokens.map((t) => t.status);
  assert.ok(statuses.includes('missing'));
  assert.ok(statuses.includes('extra'));
});

test('Tippfehler werden als typo markiert', () => {
  const r = diffAgainst('When I arrived at the gate, the other passangers were already boarding.', EN);
  assert.deepEqual(r.diffTokens.find((t) => t.status !== 'ok'), { text: 'passangers', status: 'typo', expected: 'passengers' });
  assert.equal(suggestRating(r), 'Gut');
});

test('Kurzformen sind gleichwertig zur Langform', () => {
  assert.equal(diffAgainst("I don't know.", 'I do not know.').isExactMatch, true);
  assert.equal(diffAgainst("He's been there.", 'He has been there.').isExactMatch, true);
  const r = diffAgainst("I'm tired", "I'm tired.");
  assert.deepEqual(r.diffTokens, [{ text: "I'm", status: 'ok' }, { text: 'tired', status: 'ok' }]);
  assert.equal(diffAgainst('It’s fine', "It's fine").isExactMatch, true);
});

test('compareAnswer wählt die passendste Alternative', () => {
  const r = compareAnswer('When I got to the gate, the other passengers were already getting on the plane.', [
    EN,
    'When I got to the gate, the other passengers were already getting on the plane.',
    '',
  ]);
  assert.equal(r.targetIndex, 1);
  assert.equal(r.isExactMatch, true);
});

test('leere Eingabe ist nie exakt', () => {
  const r = diffAgainst('', EN);
  assert.equal(r.isExactMatch, false);
  assert.ok(r.diffTokens.every((t) => t.status === 'missing'));
  assert.equal(suggestRating(r), 'Nochmal');
});

test('tokenize entfernt Markup und reine Satzzeichen', () => {
  assert.deepEqual(tokenize('a [[b]] – c').map((t) => t.keys[0]), ['a', 'b', 'c']);
});

test('Kurzformen ohne Apostroph gelten als Tippfehler', () => {
  const r = diffAgainst('He didnt tell me', "He didn't tell me.");
  assert.equal(r.isExactMatch, false);
  assert.deepEqual(r.diffTokens[1], { text: 'didnt', status: 'typo', expected: "didn't" });
  assert.equal(suggestRating(r), 'Gut');
  // "its" ist ein echtes Wort und wird nicht als it's gedeutet
  assert.equal(diffAgainst('its fine', "it's fine").isExactMatch, false);
});

test('alle Apostroph-Varianten werden vereinheitlicht', () => {
  for (const ap of ["'", '’', '‘', '`', '´', 'ʼ', '′', '＇', '‛']) {
    const r = diffAgainst(`I don${ap}t know, it${ap}s fine`, "I don't know, it's fine");
    assert.equal(r.isExactMatch, true, `Variante U+${ap.codePointAt(0).toString(16)}`);
    assert.equal(r.diffTokens[1].text, "don't");
  }
});
