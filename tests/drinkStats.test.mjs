import test from 'node:test';
import assert from 'node:assert/strict';
import { afterNthDrink, bestWorstDrinkHole, drinkVsDry, fieldDoesItHelp, fieldDrinkVsDry, MIN_BUCKET_HOLES, MIN_FIELD_PLAYERS } from '../src/lib/drinkStats.js';

// raw net-to-par per hole; drinks per hole. All stats ignore unscored holes.
const vs = (arr) => Object.fromEntries(arr.map((v, i) => [i + 1, v]));

test('drinkVsDry: averages each bucket, and only reports with enough holes in BOTH', () => {
  // drinks on holes 1-3 (+1 each), dry holes 4-8 (0 each)
  const r = drinkVsDry(vs([1, 1, 1, 0, 0, 0, 0, 0]), { 1: 1, 2: 1, 3: 2 });
  assert.equal(r.ok, true);
  assert.equal(r.drinkHoles, 3);
  assert.equal(r.dryHoles, 5);
  assert.equal(r.drinkAvg, 1);
  assert.equal(r.dryAvg, 0);
  assert.equal(r.diff, 1);
  // only two drink holes: not enough, no verdict
  const thin = drinkVsDry(vs([1, 1, 0, 0, 0, 0]), { 1: 1, 2: 1 });
  assert.equal(thin.ok, false);
  assert.equal(thin.diff, null);
  assert.equal(MIN_BUCKET_HOLES, 3);
});

test('drinkVsDry ignores holes with no score, even if a drink was logged there', () => {
  const r = drinkVsDry({ 1: 1, 2: 1, 3: 1, 4: 0, 5: 0, 6: 0 }, { 1: 1, 2: 1, 3: 1, 9: 5 });
  assert.equal(r.drinkHoles, 3);
});

test('afterNthDrink: follows the play order, and the drink hole counts as the first "after" hole', () => {
  // group starts on 10: play order 10..18, 1..9. Drink #2 is on hole 14 (position 4).
  const raw = { 10: 1, 11: 1, 12: 1, 13: 1, 14: 0, 15: 0, 16: 0, 17: 0 };
  const drinks = [
    { id: 'a', hole: 11, created_at: '2026-01-01T10:00:00Z' },
    { id: 'b', hole: 14, created_at: '2026-01-01T11:00:00Z' },
  ];
  const r = afterNthDrink(raw, drinks, 10, 2);
  assert.equal(r.ok, true);
  assert.equal(r.hole, 14);
  assert.equal(r.beforeHoles, 4);
  assert.equal(r.afterHoles, 4);
  assert.equal(r.beforeAvg, 1);
  assert.equal(r.afterAvg, 0);
  assert.equal(r.diff, -1);
  // not enough drinks, or not enough holes either side
  assert.equal(afterNthDrink(raw, drinks, 10, 3).ok, false);
  assert.equal(afterNthDrink({ 10: 1, 11: 0, 12: 0, 13: 0 }, drinks, 10, 2).ok, false);
});

test('bestWorstDrinkHole: picks from drink holes only', () => {
  const r = bestWorstDrinkHole(vs([-1, 2, 0, -2, 3]), { 1: 1, 2: 1, 3: 1 });
  assert.deepEqual(r.best, { hole: 1, vs: -1 });
  assert.deepEqual(r.worst, { hole: 2, vs: 2 });
  assert.equal(bestWorstDrinkHole(vs([0, 0]), {}), null);
});

// ---- field comparisons need MIN_FIELD_PLAYERS qualifying players ----
const player = () => ({
  // drinks on holes 1-3 (+1) and two drinks on holes 4-6 (+2); holes 7-18 dry (0)
  rawVsPar: vs([1, 1, 1, 2, 2, 2, ...Array(12).fill(0)]),
  drinksByHole: { 1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2 },
});

test('fieldDrinkVsDry: nine qualifying players is too few, ten reports the pooled averages', () => {
  assert.equal(MIN_FIELD_PLAYERS, 10);
  assert.equal(fieldDrinkVsDry(Array.from({ length: 9 }, player)).ok, false);
  const r = fieldDrinkVsDry(Array.from({ length: 10 }, player));
  assert.equal(r.ok, true);
  assert.equal(r.players, 10);
  assert.equal(r.drinkAvg, 1.5);
  assert.equal(r.dryAvg, 0);
  assert.equal(r.diff, 1.5);
});

test('fieldDrinkVsDry: players without enough holes in both buckets do not count toward the ten', () => {
  const thin = { rawVsPar: vs([1, 1, 0, 0, 0, 0]), drinksByHole: { 1: 1, 2: 1 } };
  const r = fieldDrinkVsDry([...Array.from({ length: 9 }, player), thin, thin, thin]);
  assert.equal(r.players, 9);
  assert.equal(r.ok, false);
});

test('fieldDoesItHelp: 2+ drinks on a hole vs 0-1, same sample rules', () => {
  assert.equal(fieldDoesItHelp(Array.from({ length: 9 }, player)).ok, false);
  const r = fieldDoesItHelp(Array.from({ length: 10 }, player));
  assert.equal(r.ok, true);
  assert.equal(r.manyAvg, 2); // holes 4-6
  assert.ok(Math.abs(r.fewAvg - 3 / 15) < 1e-9); // holes 1-3 (+1) and 7-18 (0): 3 over 15 holes
  assert.ok(Math.abs(r.diff - (2 - 3 / 15)) < 1e-9);
});
