import test from 'node:test';
import assert from 'node:assert/strict';
import { clampInt, lastName, formatToPar, strokesForHandicap } from '../src/lib/golf.js';

const STROKE_INDEX = [12, 10, 4, 14, 2, 8, 6, 18, 16, 9, 3, 17, 13, 5, 15, 1, 11, 7];

test('clampInt', () => {
  assert.equal(clampInt('12'), 12);
  assert.equal(clampInt('abc', 7), 7);
  assert.equal(clampInt(3.9), 3);
  assert.equal(clampInt(-2.5), -2);
  assert.equal(clampInt(null, 5), 0); // Number(null) is 0, a finite number
  assert.equal(clampInt(undefined, 5), 5);
});

test('lastName keeps multi-word surnames', () => {
  assert.equal(lastName('Scott Johnstone'), 'Johnstone');
  assert.equal(lastName('Ana Van Der Berg'), 'Van Der Berg');
  assert.equal(lastName('Cher'), 'Cher');
  assert.equal(lastName('  '), '');
});

test('formatToPar', () => {
  assert.equal(formatToPar(0), 'E');
  assert.equal(formatToPar(3), '+3');
  assert.equal(formatToPar(-2), '-2');
});

test('strokesForHandicap: strokes land on the hardest holes first', () => {
  // handicap 4 -> a stroke on stroke-index 1..4 holes only
  const got = Array.from({ length: 18 }, (_, i) => strokesForHandicap(4, i + 1, STROKE_INDEX));
  assert.equal(got.reduce((a, b) => a + b, 0), 4);
  STROKE_INDEX.forEach((si, i) => assert.equal(got[i], si <= 4 ? 1 : 0, `hole ${i + 1} (SI ${si})`));
  assert.equal(strokesForHandicap(0, 5, STROKE_INDEX), 0);
});

test('strokesForHandicap: above 18 wraps (a second stroke on the hardest holes)', () => {
  const total = (h) => Array.from({ length: 18 }, (_, i) => strokesForHandicap(h, i + 1, STROKE_INDEX)).reduce((a, b) => a + b, 0);
  assert.equal(total(18), 18);
  assert.equal(total(22), 22);
  assert.equal(strokesForHandicap(22, 16, STROKE_INDEX), 2); // hole 16 is SI 1
  assert.equal(strokesForHandicap(22, 8, STROKE_INDEX), 1); // hole 8 is SI 18
});

test('strokesForHandicap: a plus handicap gives strokes back', () => {
  assert.equal(strokesForHandicap(-3, 16, STROKE_INDEX), -1); // SI 1
  assert.equal(strokesForHandicap(-3, 5, STROKE_INDEX), -1); // SI 2
  assert.equal(strokesForHandicap(-3, 11, STROKE_INDEX), -1); // SI 3
  assert.equal(strokesForHandicap(-3, 3, STROKE_INDEX), 0); // SI 4 is past the 3 strokes given back
});
