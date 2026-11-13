import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrintCards } from '../src/lib/printCards.js';

// Hole -> stroke index: 1:12 2:10 3:4 4:14 5:2 6:8 7:6 8:18 9:16 10:9 11:3 12:17 13:13 14:5 15:15 16:1 17:11 18:7
const P = (id, handicap) => ({ id, name: `${id} Smith`, handicap });
const players = [P('a', 10), P('b', 20), P('c', 4), P('d', 8), P('e', 12), P('f', 6)];
const F1 = { id: 'f1', group_name: 'Group 1', code: 'AAAAAA', tee_time: '09:00:00', starting_hole: 1 };
const F2 = { id: 'f2', group_name: 'Group 2', code: 'BBBBBB', tee_time: '09:12:00', starting_hole: 1 };
const fp = (f, ids) => ids.map((id) => ({ foursome_id: f.id, player_id: id }));

// Group 1 = a b c d, Group 2 = e f. Teams: (a,b) (c,d) (e,f)
const base = {
  foursomes: [F1, F2],
  players,
  foursomePlayers: [...fp(F1, ['a', 'b', 'c', 'd']), ...fp(F2, ['e', 'f'])],
  fieldOffset: 0,
};
const teamsFor = (gameId, pairs) => ({
  gameTeams: pairs.map((_, i) => ({ id: `${gameId}t${i}`, game_id: gameId, name: `Team ${i + 1}` })),
  gameTeamMembers: pairs.flatMap((ids, i) => ids.map((id) => ({ game_id: gameId, team_id: `${gameId}t${i}`, player_id: id }))),
});
const pairs2 = [['a', 'b'], ['c', 'd'], ['e', 'f']];
const game = (over) => ({ id: 'g', name: 'G', format: 'better_ball_2', handicap_pct: 100, counting_rule: { scoresCounted: 1, slots: ['net'] }, ...over });

test('an individual game prints one card per playing group, as it always has', () => {
  const cards = buildPrintCards({ ...base, game: game({ format: 'individual_net' }), gameTeams: [], gameTeamMembers: [] });
  assert.deepEqual(cards.map((c) => c.kind), ['group', 'group']);
  assert.deepEqual(cards[0].members.map((p) => p.id), ['a', 'b', 'c', 'd']);
  assert.equal(cards[0].f.code, 'AAAAAA');
  // no game at all: the same
  assert.equal(buildPrintCards({ ...base, game: null, gameTeams: [], gameTeamMembers: [] }).length, 2);
});

test('a team game with no teams built yet falls back to one card per group', () => {
  const cards = buildPrintCards({ ...base, game: game(), gameTeams: [], gameTeamMembers: [] });
  assert.deepEqual(cards.map((c) => c.kind), ['group', 'group']);
});

test('teams of 2 print one card per team, in group order, each with its group\'s tee time and code', () => {
  const g = game({ format: 'better_ball_2' });
  const cards = buildPrintCards({ ...base, game: g, ...teamsFor('g', pairs2) });
  assert.deepEqual(cards.map((c) => c.kind), ['team', 'team', 'team']);
  assert.deepEqual(cards.map((c) => c.members.map((p) => p.id)), [['a', 'b'], ['c', 'd'], ['e', 'f']]);
  assert.deepEqual(cards.map((c) => c.f.group_name), ['Group 1', 'Group 1', 'Group 2']);
  assert.deepEqual(cards.map((c) => c.label), ['Smith / Smith', 'Smith / Smith', 'Smith / Smith']);
  assert.ok(cards.every((c) => c.holes.length === 18));
});

test('better ball: two boxes on every hole, strokes per player', () => {
  const [c] = buildPrintCards({ ...base, game: game({ format: 'better_ball_2', handicap_pct: 100 }), ...teamsFor('g', pairs2) });
  assert.equal(c.anyShared, false);
  assert.ok(c.holes.every((h) => h.shared === false));
  assert.deepEqual(c.holes[2].strokes, { a: 1, b: 1 }); // hole 3, SI 4: 10 and 20 hcp both get one
  assert.deepEqual(c.holes[15].strokes, { a: 1, b: 2 }); // hole 16, SI 1: the 20 hcp gets two
  assert.deepEqual(c.holes[7].strokes, { a: 0, b: 1 }); // hole 8, SI 18
});

test('scramble and alternate shot: one shared box on every hole, strokes from the blended team handicap', () => {
  for (const format of ['scramble_2', 'alt_shot_2']) {
    const [c] = buildPrintCards({ ...base, game: game({ format, handicap_allowance: [35, 15] }), ...teamsFor('g', pairs2) });
    assert.equal(c.anyShared, true, format);
    assert.ok(c.holes.every((h) => h.shared === true), format);
    // 10 x 35% + 20 x 15% = 6.5 -> 7: strokes on SI 1-7
    assert.equal(c.holes[2].ballStrokes, 1, format); // hole 3, SI 4
    assert.equal(c.holes[5].ballStrokes, 0, format); // hole 6, SI 8
  }
});

test('multi-format round: each hole is a shared box or own-ball boxes depending on its segment', () => {
  const g = game({
    format: 'composite',
    segments: [
      { holes: [1, 2, 3, 4, 5, 6], formatType: 'shared', handicapAllowance: { lowPct: 35, highPct: 15 } },
      { holes: [7, 8, 9, 10, 11, 12], formatType: 'shared', handicapAllowance: { lowPct: 50, highPct: 50 } },
      { holes: [13, 14, 15, 16, 17, 18], formatType: 'individual', handicapPct: 100, countingRule: { scoresCounted: 1, slots: ['net'] } },
    ],
  });
  const [c] = buildPrintCards({ ...base, game: g, ...teamsFor('g', pairs2) });
  assert.equal(c.anyShared, true);
  assert.deepEqual(c.holes.map((h) => h.shared), [...Array(12).fill(true), ...Array(6).fill(false)]);
  assert.equal(c.holes[2].ballStrokes, 1); // hole 3 (scramble, team of 7)
  assert.equal(c.holes[6].ballStrokes, 1); // hole 7 (alternate shot, 50/50 = 15): SI 6
  assert.deepEqual(c.holes[13].strokes, { a: 1, b: 1 }); // hole 14, own balls, SI 5
  assert.deepEqual(c.holes[17].strokes, { a: 1, b: 1 }); // hole 18, SI 7
  assert.deepEqual(c.holes[12].strokes, { a: 0, b: 1 }); // hole 13, SI 13: 10 hcp no, 20 hcp yes
});

test('field-relative handicaps are taken into account for the dots', () => {
  const [c] = buildPrintCards({ ...base, fieldOffset: 4, game: game({ format: 'better_ball_2' }), ...teamsFor('g', pairs2) });
  assert.equal(c.holes[6].strokes.a, 1); // 10 - 4 = 6 -> SI 6 gets one
  assert.equal(c.holes[5].strokes.a, 0); // SI 8 does not
});

test('4-person teams print one card per team with four columns', () => {
  const g = game({ format: 'better_ball_4' });
  const cards = buildPrintCards({
    ...base, game: g,
    foursomes: [F1], foursomePlayers: fp(F1, ['a', 'b', 'c', 'd']),
    ...teamsFor('g', [['a', 'b', 'c', 'd']]),
  });
  assert.equal(cards.length, 1);
  assert.equal(cards[0].members.length, 4);
  assert.deepEqual(Object.keys(cards[0].holes[2].strokes), ['a', 'b', 'c', 'd']);
  const sc = buildPrintCards({ ...base, game: game({ format: 'scramble_4', handicap_allowance: [40, 30, 20, 10] }), foursomes: [F1], foursomePlayers: fp(F1, ['a', 'b', 'c', 'd']), ...teamsFor('g', [['a', 'b', 'c', 'd']]) });
  assert.ok(sc[0].holes.every((h) => h.shared));
});

test('players in a group who are on no team still get a card; a team nobody is grouped with is printed last', () => {
  // only (a,b) is a team; c and d are in Group 1 but on no team; e,f are in no group at all
  const cards = buildPrintCards({
    ...base, game: game({ format: 'better_ball_2' }),
    foursomePlayers: fp(F1, ['a', 'b', 'c', 'd']), foursomes: [F1],
    ...teamsFor('g', [['a', 'b'], ['e', 'f']]),
  });
  assert.deepEqual(cards.map((c) => c.kind), ['team', 'group', 'team']);
  assert.deepEqual(cards[1].members.map((p) => p.id), ['c', 'd']);
  assert.equal(cards[2].f, null); // e and f have no group yet
  assert.deepEqual(cards[2].members.map((p) => p.id), ['e', 'f']);
});

test('only the selected game\'s teams are used', () => {
  const other = teamsFor('other', [['a', 'c'], ['b', 'd']]);
  const mine = teamsFor('g', pairs2);
  const cards = buildPrintCards({ ...base, game: game(), gameTeams: [...other.gameTeams, ...mine.gameTeams], gameTeamMembers: [...other.gameTeamMembers, ...mine.gameTeamMembers] });
  assert.deepEqual(cards.map((c) => c.members.map((p) => p.id)), [['a', 'b'], ['c', 'd'], ['e', 'f']]);
});
