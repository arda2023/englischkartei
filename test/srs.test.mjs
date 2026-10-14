import test from 'node:test';
import assert from 'node:assert/strict';
import { newSrs, schedule, previewIntervals } from '../src/lib/srs.js';

const now = new Date('2026-10-14T10:00:00');

test('neue Karte: Vorschau der Intervalle', () => {
  assert.deepEqual(previewIntervals(newSrs(now), now), {
    Nochmal: '<1 Min.',
    Schwer: '<10 Min.',
    Gut: '1 Tag',
    Einfach: '4 Tage',
  });
});

test('Gut lässt eine neue Karte in die Review-Phase graduieren (fällig ab Mitternacht)', () => {
  const { srs } = schedule(newSrs(now), 'Gut', now);
  assert.equal(srs.state, 'review');
  assert.equal(srs.intervalDays, 1);
  assert.equal(new Date(srs.dueDate).getTime(), new Date('2026-10-15T00:00:00').getTime());
});

test('Review: Intervalle wachsen streng monoton von Schwer bis Einfach', () => {
  const srs = { ...newSrs(now), state: 'review', intervalDays: 10, repetitions: 3, dueDate: now.toISOString() };
  const days = ['Schwer', 'Gut', 'Einfach'].map((r) => schedule(srs, r, now).days);
  assert.ok(days[0] > 10 && days[1] > days[0] && days[2] > days[1], days.join(','));
});

test('Lapse: Nochmal in Review führt zu relearning mit halbem Intervall', () => {
  const srs = { ...newSrs(now), state: 'review', intervalDays: 20, dueDate: now.toISOString() };
  const r = schedule(srs, 'Nochmal', now);
  assert.equal(r.srs.state, 'relearning');
  assert.equal(r.srs.lapses, 1);
  assert.equal(r.srs.intervalDays, 10);
  assert.equal(r.srs.easeFactor, 2.1);
  const back = schedule(r.srs, 'Gut', now);
  assert.equal(back.srs.state, 'review');
  assert.equal(back.days, 10);
});

test('Ease fällt nie unter 1.3', () => {
  let srs = { ...newSrs(now), state: 'review', intervalDays: 5, easeFactor: 1.35, dueDate: now.toISOString() };
  srs = schedule(srs, 'Schwer', now).srs;
  assert.equal(srs.easeFactor, 1.3);
});
