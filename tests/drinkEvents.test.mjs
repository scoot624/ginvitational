import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDrinkEvents, isDrinkKind } from '../src/lib/drinkEvents.js';
import { planPosts, safeDedupeKey } from '../src/lib/broadcastEngine.js';

// The Broadcast is kept quiet about drinks: a drink is NOT announced just because it was logged.

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
const FIRST_SEEN = asSaved([{ kind: 'drink_first', playerId: 'a', dedupe: ['drink_first_field', 'r1'] }]); // the day's first drink already announced

test('nothing happens with the mode off, with no drinks, or for another round', () => {
  assert.deepEqual(computeDrinkEvents(base({ drinking: { ...MIN, enabled: false }, drinks: [drink('a', 1)] })), []);
  assert.deepEqual(computeDrinkEvents(base()), []);
  assert.deepEqual(computeDrinkEvents(base({ drinks: [{ ...drink('a', 1), round_id: 'other' }] })), []);
});

test('the first drink of the day is announced once; nobody else\'s first drink is', () => {
  const first = computeDrinkEvents(base({ drinks: [drink('a', 2, 10)] }));
  assert.deepEqual(kinds(first), ['drink_first']);
  assert.match(first[0].text, /a P\./);
  // once that is saved, a second player's first drink gets no card
  assert.deepEqual(computeDrinkEvents(base({ drinks: [drink('a', 2, 10), drink('b', 3, 2)], messages: asSaved(first) })), []);
  // and neither does the same player's next drink, even a minute later
  assert.deepEqual(computeDrinkEvents(base({ drinks: [drink('a', 2, 10), drink('a', 3, 1)], messages: asSaved(first) })), []);
});

test('plain drinks, however many are logged, make no cards', () => {
  const drinks = ['a', 'b'].flatMap((id) => [1, 2, 3, 4, 5, 6].map((h, i) => drink(id, h, 40 - i * 5)));
  // a and b tie at 6, so there is no leader; hole 1..6 have 2 drinks each, so no busiest hole either
  assert.deepEqual(computeDrinkEvents(base({ drinks, messages: FIRST_SEEN })), []);
});

test('hitting the minimum, reaching the credit max and falling behind pace no longer post cards', () => {
  const four = [1, 2, 3, 4].map((h, i) => drink('a', h, 30 - i * 5));
  const noPaceCards = (evs) => !evs.some((e) => /^drink_(min|max|behind)/.test(e.kind));
  assert.ok(noPaceCards(computeDrinkEvents(base({ drinks: four, messages: FIRST_SEEN })))); // minimum of 4 reached (a is also the sole leader, which is its own card)
  const three = [1, 2, 3].map((h, i) => drink('a', h, 12 - i * 3));
  assert.ok(noPaceCards(computeDrinkEvents(base({ drinking: CREDIT, drinks: three, messages: FIRST_SEEN })))); // credit max of 3 reached
  const rows = [row('a', { holesPlayed: 12, gross: { 12: 4 } }), row('b')];
  assert.deepEqual(computeDrinkEvents(base({ rows, scoreTimes: { 'a|12': NOW - 1000 }, drinks: [drink('b', 1, 120)], messages: FIRST_SEEN })), []); // 0 of 4 through 12 holes
});

test('drinks older than 45 minutes are not announced (an old round stays quiet)', () => {
  assert.deepEqual(computeDrinkEvents(base({ drinks: [drink('a', 1, 50), drink('b', 2, 120)] })), []);
});

test('drink leader: a sole leader with 3+ drinks, never in a tie, at most one an hour', () => {
  const drinks = [drink('a', 1, 30), drink('a', 2, 20), drink('a', 3, 3), drink('b', 4, 25)];
  const ev = computeDrinkEvents(base({ drinks, messages: FIRST_SEEN }));
  assert.deepEqual(kinds(ev), ['drink_leader']);
  assert.equal(ev[0].playerId, 'a');
  // a tie at 3 each: no leader card
  const tie = [...drinks, drink('b', 5, 15), drink('b', 6, 14)];
  assert.ok(!computeDrinkEvents(base({ drinks: tie, messages: FIRST_SEEN })).some((e) => e.kind === 'drink_leader'));
  // the lead changing hands again within the hour is not announced...
  const justBefore = [{ id: 'x', kind: 'drink_leader', player_id: 'b', dedupe_key: 'zzz', created_at: iso(20) }];
  assert.ok(!computeDrinkEvents(base({ drinks, messages: [...FIRST_SEEN, ...justBefore] })).some((e) => e.kind === 'drink_leader'));
  // ...but after the hour it is
  const longAgo = [{ id: 'x', kind: 'drink_leader', player_id: 'b', dedupe_key: 'zzz', created_at: iso(90) }];
  assert.ok(computeDrinkEvents(base({ drinks, messages: [...FIRST_SEEN, ...longAgo] })).some((e) => e.kind === 'drink_leader'));
});

test('busiest hole: one card at 4 drinks and one at 8, even if a different hole takes over', () => {
  const rows = ['a', 'b', 'c', 'd'].map((id) => row(id));
  const four = [drink('a', 7, 9), drink('b', 7, 8), drink('c', 7, 7), drink('d', 7, 6), drink('a', 3, 5)];
  const ev = computeDrinkEvents(base({ rows, drinks: four, messages: FIRST_SEEN })).filter((e) => e.kind === 'drink_hole');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].playerId, null);
  assert.deepEqual(ev[0].dedupe, ['drink_hole', 'r1', 4]);
  assert.match(ev[0].text, /7/);
  // three on a hole is not enough
  assert.ok(!computeDrinkEvents(base({ rows, drinks: four.slice(0, 3), messages: FIRST_SEEN })).some((e) => e.kind === 'drink_hole'));
  // a different hole reaching 4 later does not make a second "4" card
  const saved = [...FIRST_SEEN, ...asSaved(ev)];
  const hole11 = [...four, drink('a', 11, 4), drink('b', 11, 3), drink('c', 11, 2), drink('d', 11, 1), drink('a', 11, 1)];
  assert.ok(!computeDrinkEvents(base({ rows, drinks: hole11, messages: saved })).some((e) => e.kind === 'drink_hole' && e.dedupe[2] === 4));
  // eight announces once more
  const eight = [...four, drink('a', 7, 4), drink('b', 7, 3), drink('c', 7, 2), drink('d', 7, 1)];
  assert.deepEqual(computeDrinkEvents(base({ rows, drinks: eight, messages: saved })).find((e) => e.kind === 'drink_hole').dedupe, ['drink_hole', 'r1', 8]);
});

test('drink-to-birdie: a birdie on the drink hole, or on the next hole the group plays', () => {
  const rows = [row('a', { holesPlayed: 2, gross: { 1: 4, 2: 3 }, startHole: 1 })];
  const st = { 'a|1': NOW - 120_000, 'a|2': NOW - 60_000 };
  const next = computeDrinkEvents(base({ rows, scoreTimes: st, drinks: [drink('a', 1, 9)], messages: FIRST_SEEN }));
  assert.deepEqual(kinds(next), ['drink_birdie']);
  assert.match(next[0].text, /#1/);
  assert.match(next[0].text, /#2/);
  // drink on the birdie hole itself
  assert.deepEqual(kinds(computeDrinkEvents(base({ rows, scoreTimes: st, drinks: [drink('a', 2, 9)], messages: FIRST_SEEN }))), ['drink_birdie']);
  // hole 2 is the group's FIRST hole: a drink on 1 does not count (it comes last in their order)
  const wrapped = computeDrinkEvents(base({ rows: [row('a', { holesPlayed: 2, gross: { 1: 4, 2: 3 }, startHole: 2 })], scoreTimes: st, drinks: [drink('a', 1, 9)], messages: FIRST_SEEN }));
  assert.ok(!wrapped.some((e) => e.kind === 'drink_birdie'));
  // a birdie with no drink around it is not a drink-to-birdie
  assert.ok(!computeDrinkEvents(base({ rows, scoreTimes: st, drinks: [drink('a', 9, 9)], messages: FIRST_SEEN })).some((e) => e.kind === 'drink_birdie'));
  // an ace has its own card
  const ace = computeDrinkEvents(base({ rows: [row('a', { holesPlayed: 2, gross: { 2: 1 } })], scoreTimes: { 'a|2': NOW - 1000 }, drinks: [drink('a', 2, 9)], messages: FIRST_SEEN }));
  assert.ok(!ace.some((e) => e.kind === 'drink_birdie'));
  // and an old birdie (more than 45 minutes ago) is not announced
  assert.ok(!computeDrinkEvents(base({ rows, scoreTimes: { 'a|1': NOW - 5_000_000, 'a|2': NOW - 4_000_000 }, drinks: [drink('a', 1, 9)], messages: FIRST_SEEN })).some((e) => e.kind === 'drink_birdie'));
});

test('a drink-to-birdie beats the first-drink card for the same player (one card per player per check)', () => {
  const rows = [row('a', { holesPlayed: 2, gross: { 1: 4, 2: 3 } })];
  const ev = computeDrinkEvents(base({ rows, scoreTimes: { 'a|2': NOW - 1000 }, drinks: [drink('a', 1, 9)] }));
  assert.deepEqual(kinds(ev), ['drink_birdie']);
});

test('a card is announced once: saved cards are never repeated', () => {
  const drinks = [drink('a', 2, 10)];
  const first = computeDrinkEvents(base({ drinks }));
  assert.equal(first.length, 1);
  assert.equal(computeDrinkEvents(base({ drinks, messages: asSaved(first) })).length, 0);
});

// ---- the end-of-round report ----
function field(n, { allFinished = true, vsFor = () => 0, perPlayer = null } = {}) {
  const ids = Array.from({ length: n }, (_, i) => 'p' + i);
  const rows = ids.map((id, i) => row(id, {
    holesPlayed: allFinished || i > 0 ? 18 : 12,
    rawVsPar: Object.fromEntries(Array.from({ length: 18 }, (_, h) => [h + 1, vsFor(id, h + 1)])),
    gross: {},
  }));
  // drinks on holes 1-3 once each, holes 4-6 twice each (long ago, so only the report speaks)
  const holes = [1, 2, 3, 4, 4, 5, 5, 6, 6];
  const drinks = ids.flatMap((id, i) => (perPlayer ? holes.slice(0, perPlayer(i)) : holes).map((h) => drink(id, h, 200)));
  return { rows, drinks, fieldIds: new Set(ids), scoreTimes: { 'p0|18': NOW - 30 * 60_000 }, messages: asSaved([{ kind: 'drink_first', playerId: 'p0', dedupe: ['drink_first_field', 'r1'] }]) };
}
const vsPattern = (id, h) => (h <= 3 ? 1 : h <= 6 ? 2 : 0);

test('drink report: only once the whole field has finished, as raw net-to-par stats', () => {
  const ev = computeDrinkEvents(base(field(10, { vsFor: vsPattern })));
  const card = ev.find((e) => e.kind === 'drinkreport' && e.dedupe[1] === 'field');
  assert.ok(card, 'field card');
  assert.equal(card.playerId, null);
  assert.match(card.text, /Across 10 players/);
  assert.match(card.text, /\+1\.50/); // drink holes
  assert.match(card.text, /0\.00/); // dry holes
  assert.match(card.text, /Two or more drinks/);
  // not finished yet: no report
  assert.ok(!computeDrinkEvents(base(field(10, { allFinished: false, vsFor: vsPattern }))).some((e) => e.kind === 'drinkreport'));
});

test('drink report says how many hit the minimum (Minimum Drinks) or used all their credits (Stroke Credit)', () => {
  // players 0-5 have 9 drinks, players 6-9 only 2
  const f = field(10, { vsFor: vsPattern, perPlayer: (i) => (i < 6 ? 9 : 2) });
  const min = computeDrinkEvents(base(f)).find((e) => e.kind === 'drinkreport' && e.dedupe[1] === 'field');
  assert.match(min.text, /^Drink report: 6 of 10 players hit the minimum of 4 drinks\./);
  const credit = computeDrinkEvents(base({ ...f, drinking: CREDIT })).find((e) => e.kind === 'drinkreport' && e.dedupe[1] === 'field');
  assert.match(credit.text, /^Drink report: 6 of 10 players used all 3 drink credits\./);
});

test('drink report: a small field still gets the count, but no field-wide comparison', () => {
  const ev = computeDrinkEvents(base(field(9, { vsFor: vsPattern })));
  const card = ev.find((e) => e.kind === 'drinkreport' && e.dedupe[1] === 'field');
  assert.ok(card);
  assert.match(card.text, /9 of 9 players hit the minimum/);
  assert.ok(!/Across \d+ players/.test(card.text));
});

test('drink report: highlights name the best drink hole, and it is only said once', () => {
  const f = field(10, { vsFor: (id, h) => (id === 'p3' && h === 2 ? -1 : vsPattern(id, h)) });
  const ev = computeDrinkEvents(base(f));
  const hi = ev.find((e) => e.kind === 'drinkreport' && e.dedupe[1] === 'highlights');
  assert.ok(hi);
  assert.match(hi.text, /Best drink hole: p3 P\., a net birdie on #2/);
  assert.equal(computeDrinkEvents(base({ ...f, messages: [...f.messages, ...asSaved(ev)] })).filter((e) => e.kind === 'drinkreport').length, 0);
});

test('drink cards pass through planPosts as their own cards, never folded into the score cards', () => {
  assert.ok(isDrinkKind('drink_first') && isDrinkKind('hidden_drink_leader') && isDrinkKind('drinkreport') && !isDrinkKind('leader'));
  const ev = computeDrinkEvents(base({ drinks: [drink('a', 2, 5)] }));
  const posts = planPosts(ev, { now: NOW, messages: [] });
  assert.equal(posts.length, ev.length);
  assert.ok(posts.every((p) => p.kind.startsWith('drink')));
});
