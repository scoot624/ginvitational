import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRINKING_DEFAULTS,
  normalizeDrinking,
  isMinVariant,
  isCreditVariant,
  describeDrinking,
  sortDrinks,
  drinksForRound,
  drinkCountsByPlayer,
  drinkCountsByPlayerHole,
  creditMap,
  creditFor,
  sharedCredit,
  creditRemaining,
  drinkProgress,
} from '../src/lib/drinks.js';

const d = (id, player_id, hole, created_at, round_id = 'r1') => ({ id, player_id, hole, created_at, round_id });

test('normalizeDrinking fills defaults and keeps numbers sensible', () => {
  assert.deepEqual(normalizeDrinking(null), DRINKING_DEFAULTS);
  assert.deepEqual(normalizeDrinking(undefined), DRINKING_DEFAULTS);
  const s = normalizeDrinking({ enabled: true, variant: 'credit', minDrinks: '6', creditPerDrink: '2', maxDrinks: '4' });
  assert.deepEqual(s, { enabled: true, variant: 'credit', minDrinks: 6, creditPerDrink: 2, maxDrinks: 4 });
  // junk and out-of-range values are brought back in range
  const j = normalizeDrinking({ enabled: 'yes', variant: 'wild', minDrinks: -5, creditPerDrink: 0, maxDrinks: 1000 });
  assert.equal(j.enabled, false);
  assert.equal(j.variant, 'min');
  assert.equal(j.minDrinks, 0);
  assert.equal(j.creditPerDrink, 1);
  assert.equal(j.maxDrinks, 99);
});

test('variant checks and descriptions respect the on/off switch', () => {
  const off = normalizeDrinking({ enabled: false, variant: 'credit' });
  assert.equal(isCreditVariant(off), false);
  assert.equal(isMinVariant(off), false);
  assert.equal(describeDrinking(off), 'Off');
  const min = normalizeDrinking({ enabled: true, variant: 'min', minDrinks: 4 });
  assert.equal(isMinVariant(min), true);
  assert.equal(describeDrinking(min), 'Minimum Drinks: 4');
  const cr = normalizeDrinking({ enabled: true, variant: 'credit', creditPerDrink: 1, maxDrinks: 3 });
  assert.equal(isCreditVariant(cr), true);
  assert.equal(describeDrinking(cr), 'Stroke Credit: -1 per drink, max 3');
});

test('counting and filtering drinks', () => {
  const drinks = [d('1', 'a', 3, '2026-06-01T10:00:00Z'), d('2', 'a', 3, '2026-06-01T10:01:00Z'), d('3', 'b', 5, '2026-06-01T10:02:00Z'), d('4', 'a', 9, '2026-06-01T11:00:00Z', 'r2')];
  assert.equal(drinksForRound(drinks, 'r1').length, 3);
  assert.equal(drinksForRound(drinks, null).length, 4);
  assert.deepEqual([...drinkCountsByPlayer(drinksForRound(drinks, 'r1'))], [['a', 2], ['b', 1]]);
  assert.deepEqual(drinkCountsByPlayerHole(drinksForRound(drinks, 'r1')).get('a'), { 3: 2 });
  assert.deepEqual(sortDrinks([drinks[2], drinks[0]]).map((x) => x.id), ['1', '3']);
});

test('creditMap: nothing unless Stroke Credit is on', () => {
  const drinks = [d('1', 'a', 3, '2026-06-01T10:00:00Z')];
  assert.equal(creditMap(drinks, normalizeDrinking({ enabled: false, variant: 'credit' })).size, 0);
  assert.equal(creditMap(drinks, normalizeDrinking({ enabled: true, variant: 'min' })).size, 0);
  assert.equal(creditMap(drinks, null).size, 0);
});

test('creditMap: credit lands on the hole of each drink and stops at the maximum (oldest first)', () => {
  const s = normalizeDrinking({ enabled: true, variant: 'credit', creditPerDrink: 1, maxDrinks: 3 });
  const drinks = [
    d('1', 'a', 2, '2026-06-01T10:00:00Z'),
    d('2', 'a', 2, '2026-06-01T10:05:00Z'), // two drinks on hole 2
    d('3', 'a', 7, '2026-06-01T10:30:00Z'),
    d('4', 'a', 11, '2026-06-01T11:00:00Z'), // 4th drink: over the max, no credit
    d('5', 'b', 4, '2026-06-01T10:10:00Z'),
  ];
  const m = creditMap(drinks, s);
  assert.deepEqual(m.get('a'), { 2: 2, 7: 1 });
  assert.equal(creditFor(m, 'a', 11), 0);
  assert.equal(creditFor(m, 'b', 4), 1);
  assert.equal(creditFor(m, 'zzz', 4), 0);
  // order in the array doesn't matter, time does
  const shuffled = [drinks[3], drinks[2], drinks[1], drinks[0], drinks[4]];
  assert.deepEqual(creditMap(shuffled, s).get('a'), { 2: 2, 7: 1 });
});

test('creditMap honours strokes-per-drink', () => {
  const s = normalizeDrinking({ enabled: true, variant: 'credit', creditPerDrink: 2, maxDrinks: 2 });
  const m = creditMap([d('1', 'a', 5, '2026-06-01T10:00:00Z'), d('2', 'a', 6, '2026-06-01T10:01:00Z'), d('3', 'a', 7, '2026-06-01T10:02:00Z')], s);
  assert.deepEqual(m.get('a'), { 5: 2, 6: 2 });
});

test('a shared ball gets the credit from every partner', () => {
  const s = normalizeDrinking({ enabled: true, variant: 'credit', creditPerDrink: 1, maxDrinks: 3 });
  const m = creditMap([d('1', 'a', 8, '2026-06-01T10:00:00Z'), d('2', 'b', 8, '2026-06-01T10:01:00Z'), d('3', 'b', 9, '2026-06-01T10:02:00Z')], s);
  assert.equal(sharedCredit(m, ['a', 'b'], 8), 2);
  assert.equal(sharedCredit(m, ['a', 'b'], 9), 1);
  assert.equal(sharedCredit(m, ['a', 'b'], 10), 0);
  assert.equal(sharedCredit(m, [], 8), 0);
});

test('creditRemaining counts down to zero', () => {
  const s = normalizeDrinking({ enabled: true, variant: 'credit', maxDrinks: 3 });
  assert.equal(creditRemaining(0, s), 3);
  assert.equal(creditRemaining(2, s), 1);
  assert.equal(creditRemaining(3, s), 0);
  assert.equal(creditRemaining(5, s), 0);
});

test('Minimum Drinks progress: met / on pace / behind / short', () => {
  const s = normalizeDrinking({ enabled: true, variant: 'min', minDrinks: 4 });
  assert.equal(drinkProgress(4, 6, s).status, 'met');
  assert.equal(drinkProgress(9, 18, s).status, 'met'); // no upper limit: the count just keeps going
  // pace = minimum x holes played / 18, rounded down: after 9 holes of a 4-drink minimum that is 2
  assert.deepEqual(drinkProgress(1, 9, s), { count: 1, target: 4, status: 'behind' });
  assert.deepEqual(drinkProgress(2, 9, s), { count: 2, target: 4, status: 'on_pace' });
  assert.deepEqual(drinkProgress(0, 4, s), { count: 0, target: 4, status: 'on_pace' }); // pace floor(4*4/18) = 0: too early to flag
  assert.equal(drinkProgress(0, 5, s).status, 'behind'); // floor(4*5/18) = 1
  assert.equal(drinkProgress(3, 17, s).status, 'on_pace'); // pace floor(4*17/18) = 3, and 3 is not below 3
  assert.equal(drinkProgress(2, 17, s).status, 'behind');
  // finishing under the minimum is the final flag; finishing at it is met
  assert.equal(drinkProgress(3, 18, s).status, 'short');
  assert.equal(drinkProgress(4, 18, s).status, 'met');
  // a minimum of zero is always met
  assert.equal(drinkProgress(0, 0, normalizeDrinking({ enabled: true, variant: 'min', minDrinks: 0 })).status, 'met');
});
