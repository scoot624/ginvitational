import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDrinkEvents, isDrinkKind } from '../src/lib/drinkEvents.js';
import { planPosts, safeDedupeKey } from '../src/lib/broadcastEngine.js';

const PARS = [4, 4, 4, 3, 4, 3, 5, 3, 5, 4, 3, 5, 3, 4, 5, 4, 4, 5];
const NOW = Date.parse('2026-06-01T15:00:00Z');
const iso = (minAgo) => new Date(NOW - minAgo * 60_000).toISOString();
const MIN = { enabled: true, variant: 'min', minDrinks: 4, creditPerDrink: 1, maxDrinks: 3 };
const CREDIT = { ...MIN, variant: 'credit' };

let seq = 0;
const drink = (player_id, hole, minAgo = 5) => ({ id: 'd' + ++seq, player_id, round_id: 'r1', hole, created_at: iso(minAgo) });
const row = (id, over = {}) => ({ id, name: `${id} Player`, holesPlayed: 3, gross: {}, rawVsPar: {}, startHole: 1, ...over });
const base = (over = {}) => ({
  now: NOW, roundId: 'r1', drinking: MIN, drinks: [], pars: PARS, rows: [row('a'), row('b')],
  scoreTimes: { 'a|1': NOW - 60_000 }, fieldIds: new Set(['a', 'b']), messages: [], ...over,
});
const kinds = (events) => events.map((e) => e.kind).sort();
// pretend every event was saved, the way the app does
const asSaved = (events) => events.map((e, i) => ({ id: 'm' + i, kind: e.kind, player_id: e.playerId, dedupe_key: safeDedupeKey(e.dedupe), created_at: iso(1) }));

test('nothing happens with the mode off, with no drinks, or for another round', () => {
  assert.deepEqual(computeDrinkEvents(base({ drinking: { ...MIN, enabled: false }, drinks: [drink('a', 1)] })), []);
  assert.deepEqual(computeDrinkEvents(base()), []);
  assert.deepEqual(computeDrinkEvents(base({ drinks: [{ ...drink('a', 1), round_id: 'other' }] })), []);
});

test('the first drink of the field is its own card; the next first drink is "on the board"', () => {
  const first = computeDrinkEvents(base({ drinks: [drink('a', 2, 10)] }));
  assert.deepEqual(kinds(first), ['drink_first']);
  assert.match(first[0].text, /a P\./);
  // once that is saved, b's first drink is a plain "on the board" card
  const second = computeDrinkEvents(base({ drinks: [drink('a', 2, 10), drink('b', 3, 2)], messages: asSaved(first) }));
  assert.deepEqual(kinds(second), ['drink_logged']);
  assert.deepEqual(second[0].dedupe, ['drink', 'b', 'r1', 1]);
});

test('a drink is announced once: saved cards are never repeated', () => {
  const drinks = [drink('a', 2, 10), drink('a', 3, 5)];
  const first = computeDrinkEvents(base({ drinks }));
  assert.equal(first.length, 1);
  assert.equal(computeDrinkEvents(base({ drinks, messages: asSaved(first) })).length, 0);
});

test('only the newest count is announced (a missed #2 does not come back later)', () => {
  // (b has 3 drinks from long ago, so a is not the sole drink leader and the plain card is the one that shows)
  const stale = [4, 5, 6].map((h) => drink('b', h, 300));
  const ev = computeDrinkEvents(base({ drinks: [...stale, drink('a', 1, 20), drink('a', 2, 10), drink('a', 3, 2)], messages: asSaved([{ kind: 'drink_first', playerId: 'b', dedupe: ['drink_first_field', 'r1'] }]) }));
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].dedupe, ['drink', 'a', 'r1', 3]);
});

test('drinks older than 45 minutes are not announced (an old round stays quiet)', () => {
  assert.deepEqual(computeDrinkEvents(base({ drinks: [drink('a', 1, 50), drink('b', 2, 120)] })), []);
});

test('Minimum Drinks: hitting the minimum replaces the plain card, and says the minimum', () => {
  const drinks = [1, 2, 3, 4].map((h, i) => drink('a', h, 40 - i * 5));
  const ev = computeDrinkEvents(base({ drinks, messages: asSaved([{ kind: 'drink_first', playerId: 'a', dedupe: ['drink_first_field', 'r1'] }]) }));
  assert.deepEqual(kinds(ev), ['drink_min']);
  assert.match(ev[0].text, /4/);
  // and it only happens once, however many more are logged
  const done = [...ev, { kind: 'drink_first', playerId: 'a', dedupe: ['drink_first_field', 'r1'] }, { kind: 'drink_leader', playerId: 'a', dedupe: ['drink_leader', 'r1', 'a', 'first'] }];
  const more = computeDrinkEvents(base({ drinks: [...drinks, drink('a', 5, 1)], messages: asSaved(done) }));
  assert.deepEqual(kinds(more), ['drink_logged']);
});

test('Stroke Credit: reaching the max is announced; the minimum is not a thing', () => {
  const drinks = [1, 2, 3].map((h, i) => drink('a', h, 12 - i * 3));
  const ev = computeDrinkEvents(base({ drinking: CREDIT, drinks, messages: asSaved([{ kind: 'drink_first', playerId: 'a', dedupe: ['drink_first_field', 'r1'] }]) }));
  assert.deepEqual(kinds(ev), ['drink_max']);
  assert.match(ev[0].text, /3/);
  assert.ok(!computeDrinkEvents(base({ drinking: CREDIT, drinks: [drink('a', 1), drink('a', 2), drink('a', 3), drink('a', 4)] })).some((e) => e.kind === 'drink_min'));
});

test('behind pace: needs 6+ holes, is Minimum-only, fresh scores, and is held back for an hour per player', () => {
  const rows = [row('a', { holesPlayed: 9, gross: { 9: 4 } }), row('b')];
  const st = { 'a|9': NOW - 60_000 };
  const seen = asSaved([{ kind: 'drink_first', playerId: 'a', dedupe: ['drink_first_field', 'r1'] }]);
  const drinks = [drink('b', 1, 120)]; // someone has a drink, but nothing fresh
  const ev = computeDrinkEvents(base({ rows, scoreTimes: st, drinks }));
  assert.deepEqual(kinds(ev), ['drink_behind']);
  assert.deepEqual(ev[0].dedupe, ['drink_behind', 'a', 'r1', 9]);
  assert.match(ev[0].text, /0 of 4/);
  // under 6 holes: quiet
  assert.equal(computeDrinkEvents(base({ rows: [row('a', { holesPlayed: 5, gross: { 5: 4 } })], scoreTimes: { 'a|5': NOW - 1000 }, drinks })).length, 0);
  // an hour's cooldown per player
  const recent = [{ id: 'x', kind: 'drink_behind', player_id: 'a', dedupe_key: 'zzz', created_at: iso(30) }];
  assert.equal(computeDrinkEvents(base({ rows, scoreTimes: st, drinks, messages: [...seen, ...recent] })).length, 0);
  // Stroke Credit has no pace
  assert.equal(computeDrinkEvents(base({ drinking: CREDIT, rows, scoreTimes: st, drinks })).length, 0);
});

test('drink leader: a sole leader with 3+ drinks, announced when the lead changes hands, never in a tie', () => {
  const drinks = [drink('a', 1, 30), drink('a', 2, 20), drink('a', 3, 3), drink('b', 4, 25)];
  const ev = computeDrinkEvents(base({ drinks, messages: asSaved([{ kind: 'drink_first', playerId: 'a', dedupe: ['drink_first_field', 'r1'] }]) }));
  assert.ok(ev.some((e) => e.kind === 'drink_leader' && e.playerId === 'a'));
  // a tie at 3 each: no leader card
  const tie = [...drinks, drink('b', 5, 15), drink('b', 6, 14)];
  assert.ok(!computeDrinkEvents(base({ drinks: tie })).some((e) => e.kind === 'drink_leader'));
});

test('busiest hole: sole most-popular hole at 4 drinks, then again at 8', () => {
  const four = [drink('a', 7, 9), drink('b', 7, 8), drink('c', 7, 7), drink('d', 7, 6), drink('a', 3, 5)];
  const rows = ['a', 'b', 'c', 'd'].map((id) => row(id));
  const ev = computeDrinkEvents(base({ rows, drinks: four })).filter((e) => e.kind === 'drink_hole');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].playerId, null);
  assert.deepEqual(ev[0].dedupe, ['drink_hole', 'r1', 7, 4]);
  assert.match(ev[0].text, /7/);
  // three on a hole is not enough
  assert.ok(!computeDrinkEvents(base({ rows, drinks: four.slice(0, 3) })).some((e) => e.kind === 'drink_hole'));
  // eight announces again (a new key)
  const eight = [...four, drink('a', 7, 4), drink('b', 7, 3), drink('c', 7, 2), drink('d', 7, 1)];
  assert.deepEqual(computeDrinkEvents(base({ rows, drinks: eight })).find((e) => e.kind === 'drink_hole').dedupe, ['drink_hole', 'r1', 7, 8]);
});

test('drink-to-birdie: a birdie on the drink hole, or on the next hole the group plays', () => {
  const seen = asSaved([{ kind: 'drink_first', playerId: 'a', dedupe: ['drink_first_field', 'r1'] }]);
  // drink on 1, birdie (gross 3 on par 4) on 2
  const rows = [row('a', { holesPlayed: 2, gross: { 1: 4, 2: 3 }, startHole: 1 })];
  const st = { 'a|1': NOW - 120_000, 'a|2': NOW - 60_000 };
  const next = computeDrinkEvents(base({ rows, scoreTimes: st, drinks: [drink('a', 1, 9)], messages: seen }));
  assert.deepEqual(kinds(next), ['drink_birdie']);
  assert.match(next[0].text, /#1/);
  assert.match(next[0].text, /#2/);
  // drink on the birdie hole itself
  const same = computeDrinkEvents(base({ rows, scoreTimes: st, drinks: [drink('a', 2, 9)], messages: seen }));
  assert.deepEqual(kinds(same), ['drink_birdie']);
  // hole 2 is the group's FIRST hole: a drink on 1 does not count (it comes last in their order)
  const wrapped = computeDrinkEvents(base({ rows: [row('a', { holesPlayed: 2, gross: { 1: 4, 2: 3 }, startHole: 2 })], scoreTimes: st, drinks: [drink('a', 1, 9)], messages: seen }));
  assert.ok(!wrapped.some((e) => e.kind === 'drink_birdie'));
  // a birdie with no drink around it is not a drink-to-birdie
  assert.ok(!computeDrinkEvents(base({ rows, scoreTimes: st, drinks: [drink('a', 9, 9)], messages: seen })).some((e) => e.kind === 'drink_birdie'));
  // an ace has its own card
  const ace = computeDrinkEvents(base({ rows: [row('a', { holesPlayed: 2, gross: { 2: 1 } })], scoreTimes: { 'a|2': NOW - 1000 }, drinks: [drink('a', 2, 9)], messages: seen }));
  assert.ok(!ace.some((e) => e.kind === 'drink_birdie'));
  // and an old birdie (more than 45 minutes ago) is not announced
  assert.ok(!computeDrinkEvents(base({ rows, scoreTimes: { 'a|1': NOW - 5_000_000, 'a|2': NOW - 4_000_000 }, drinks: [drink('a', 1, 9)], messages: seen })).some((e) => e.kind === 'drink_birdie'));
});

test('one card per player per check: a birdie beats the milestone, which beats the plain card', () => {
  const rows = [row('a', { holesPlayed: 4, gross: { 1: 4, 2: 3 } })];
  const drinks = [1, 2, 3, 4].map((h, i) => drink('a', h, 30 - i * 6));
  const ev = computeDrinkEvents(base({ rows, scoreTimes: { 'a|2': NOW - 1000 }, drinks, messages: asSaved([{ kind: 'drink_first', playerId: 'a', dedupe: ['drink_first_field', 'r1'] }]) }));
  assert.deepEqual(kinds(ev), ['drink_birdie']);
});

// ---- the end-of-round report ----
function field(n, { allFinished = true, vsFor = () => 0 } = {}) {
  const ids = Array.from({ length: n }, (_, i) => 'p' + i);
  const rows = ids.map((id, i) => row(id, {
    holesPlayed: allFinished || i > 0 ? 18 : 12,
    rawVsPar: Object.fromEntries(Array.from({ length: 18 }, (_, h) => [h + 1, vsFor(id, h + 1)])),
    gross: {},
  }));
  // drinks on holes 1-3 once each, holes 4-6 twice each (long ago, so only the report speaks)
  const drinks = ids.flatMap((id) => [1, 2, 3, 4, 4, 5, 5, 6, 6].map((h) => drink(id, h, 200)));
  return { rows, drinks, fieldIds: new Set(ids), scoreTimes: { 'p0|18': NOW - 30 * 60_000 } };
}
const vsPattern = (id, h) => (h <= 3 ? 1 : h <= 6 ? 2 : 0);

test('drink report: only once the whole field has finished, as raw net-to-par stats', () => {
  const f = field(10, { vsFor: vsPattern });
  const ev = computeDrinkEvents(base(f));
  const card = ev.find((e) => e.kind === 'drinkreport' && e.dedupe[1] === 'field');
  assert.ok(card, 'field card');
  assert.equal(card.playerId, null);
  assert.match(card.text, /across 10 players/);
  assert.match(card.text, /\+1\.50/); // drink holes
  assert.match(card.text, /0\.00/); // dry holes
  assert.match(card.text, /Two or more drinks/);
  // not finished yet: no report
  assert.ok(!computeDrinkEvents(base(field(10, { allFinished: false, vsFor: vsPattern }))).some((e) => e.kind === 'drinkreport'));
});

test('drink report: too few players means no field card, only individual highlights', () => {
  const ev = computeDrinkEvents(base(field(9, { vsFor: vsPattern })));
  assert.ok(!ev.some((e) => e.kind === 'drinkreport' && e.dedupe[1] === 'field'));
});

test('drink report: highlights name the best drink hole, and it is only said once', () => {
  const f = field(10, { vsFor: (id, h) => (id === 'p3' && h === 2 ? -1 : vsPattern(id, h)) });
  const ev = computeDrinkEvents(base(f));
  const hi = ev.find((e) => e.kind === 'drinkreport' && e.dedupe[1] === 'highlights');
  assert.ok(hi);
  assert.match(hi.text, /Best drink hole: p3 P\., a net birdie on #2/);
  assert.equal(computeDrinkEvents(base({ ...f, messages: asSaved(ev) })).filter((e) => e.kind === 'drinkreport').length, 0);
});

test('drink cards pass through planPosts: kept as their own cards, never folded into the score cards', () => {
  assert.ok(isDrinkKind('drink_logged') && isDrinkKind('hidden_drink_min') && isDrinkKind('drinkreport') && !isDrinkKind('leader'));
  const ev = computeDrinkEvents(base({ drinks: [drink('a', 1, 5), drink('b', 2, 4)] }));
  const posts = planPosts(ev, { now: NOW, messages: [] });
  assert.equal(posts.length, ev.length);
  assert.ok(posts.every((p) => p.kind.startsWith('drink')));
});
