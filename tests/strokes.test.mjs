import test from 'node:test';
import assert from 'node:assert/strict';
import { strokesForEntry } from '../src/lib/strokes.js';
import { computeGameRows } from '../src/lib/gameCalc.js';

// Hole -> stroke index: 1:12 2:10 3:4 4:14 5:2 6:8 7:6 8:18 9:16 10:9 11:3 12:17 13:13 14:5 15:15 16:1 17:11 18:7
const STROKE_INDEX = [12, 10, 4, 14, 2, 8, 6, 18, 16, 9, 3, 17, 13, 5, 15, 1, 11, 7];
const PARS = [4, 4, 4, 3, 4, 3, 5, 3, 5, 4, 3, 5, 3, 4, 5, 4, 4, 5];

const P = (id, handicap) => ({ id, name: id, handicap });
const A = P('a', 10), B = P('b', 20), C = P('c', 4), D = P('d', 8), PLUS = P('plus', -2);
const playersById = new Map([A, B, C, D, PLUS].map((p) => [p.id, p]));
const game = (over) => ({ id: 'g', name: 'G', active: true, handicap_pct: 100, ...over });
const env = (games, extra = {}) => ({ games, gameTeams: [], gameTeamMembers: [], playersById, matches: [], matchPlayers: [], roundId: 'r', fieldOffset: 0, STROKE_INDEX, ...extra });
const solo = (p) => ({ players: [p], shared: false });
const strokes = (entry, hole, e) => strokesForEntry(entry, hole, e).strokes;

test('individual net: strokes land on the hardest holes first, a big handicap gets two on the hardest', () => {
  const e = env([game({ format: 'individual_net' })]);
  assert.equal(strokes(solo(A), 3, e), 1); // 10 hcp, SI 4
  assert.equal(strokes(solo(A), 1, e), 0); // SI 12
  assert.equal(strokes(solo(B), 8, e), 1); // 20 hcp: one everywhere...
  assert.equal(strokes(solo(B), 16, e), 2); // ...and a second on SI 1
  assert.equal(strokes(solo(B), 5, e), 2); // ...and SI 2
});

test('a plus handicap gives a stroke back on the hardest holes', () => {
  const e = env([game({ format: 'individual_net' })]);
  assert.equal(strokes(solo(PLUS), 16, e), -1);
  assert.equal(strokes(solo(PLUS), 5, e), -1);
  assert.equal(strokes(solo(PLUS), 3, e), 0);
});

test('the game\'s handicap % is applied before strokes are handed out', () => {
  const full = env([game({ format: 'better_ball_2', handicap_pct: 100 })]);
  const ninety = env([game({ format: 'better_ball_2', handicap_pct: 90 })]);
  assert.equal(strokes(solo(A), 2, full), 1); // 10 -> SI 10 gets one
  assert.equal(strokes(solo(A), 2, ninety), 0); // 10 x 90% = 9 -> SI 10 does not
});

test('field-relative handicaps are taken off before strokes', () => {
  const e = env([game({ format: 'individual_net' })], { fieldOffset: 4 }); // lowest handicap in the field is 4
  assert.equal(strokes(solo(A), 7, e), 1); // 10 - 4 = 6 -> SI 6 gets one
  assert.equal(strokes(solo(A), 6, e), 0); // SI 8 does not
});

test('gross games and games with no strokes for a player on their own show nothing', () => {
  assert.equal(strokes(solo(A), 3, env([game({ format: 'individual_gross' })])), 0);
  assert.equal(strokes(solo(A), 3, env([game({ format: 'scramble_2', handicap_allowance: [35, 15] })])), 0);
});

test('no games at all (a plain event): everyone plays off their own handicap', () => {
  assert.equal(strokes(solo(A), 3, env([])), 1);
  assert.equal(strokes(solo(A), 3, env([game({ format: 'individual_net', active: false })])), 1);
});

test('the first active game decides; inactive games are skipped', () => {
  const ninety = game({ id: 'x', format: 'better_ball_2', handicap_pct: 90 });
  const full = game({ id: 'y', format: 'individual_net', handicap_pct: 100 });
  assert.equal(strokes(solo(A), 2, env([{ ...ninety, active: false }, full])), 1);
  assert.equal(strokes(solo(A), 2, env([ninety, full])), 0);
});

const teamEnv = (g) => env([g], {
  gameTeams: [{ id: 't', game_id: g.id }],
  gameTeamMembers: [{ game_id: g.id, team_id: 't', player_id: 'a' }, { game_id: g.id, team_id: 't', player_id: 'b' }],
});

test('scramble and alternate shot: the shared ball gets strokes from the blended team handicap', () => {
  // 10 x 35% + 20 x 15% = 6.5 -> 7 strokes: SI 1-7
  for (const format of ['scramble_2', 'alt_shot_2']) {
    const e = teamEnv(game({ format, handicap_allowance: [35, 15] }));
    const pair = { players: [A, B], shared: true };
    assert.equal(strokes(pair, 3, e), 1, format); // SI 4
    assert.equal(strokes(pair, 7, e), 1, format); // SI 6
    assert.equal(strokes(pair, 6, e), 0, format); // SI 8
    assert.equal(strokesForEntry(pair, 3, e).shared, true);
  }
});

test('multi-format round: shared holes use the team blend, the other holes each player\'s own % ', () => {
  const g = game({
    format: 'composite',
    segments: [
      { holes: [1, 2, 3, 4, 5, 6], formatType: 'shared', handicapAllowance: { lowPct: 35, highPct: 15 } },
      { holes: [7, 8, 9, 10, 11, 12], formatType: 'individual', handicapPct: 100, countingRule: { scoresCounted: 1, slots: ['net'] } },
    ],
  });
  const e = teamEnv(g);
  assert.equal(strokes({ players: [A, B], shared: true }, 3, e), 1); // team of 7, SI 4
  assert.equal(strokes({ players: [A, B], shared: true }, 2, e), 0); // SI 10
  assert.equal(strokes(solo(A), 7, e), 1); // own ball on hole 7: 10 hcp, SI 6
  assert.equal(strokes(solo(B), 8, e), 1); // 20 hcp, SI 18
  assert.equal(strokes(solo(A), 8, e), 0); // 10 hcp, SI 18
  assert.equal(strokes(solo(A), 3, e), 0); // a shared hole, but this player is alone: nothing to show
});

test('match play: singles and four-ball use strokes off the lowest, foursomes one handicap a side', () => {
  const g = game({ id: 'm', format: 'match_play', config: { handicapMode: 'off_lowest' } });
  const mk = (type, a, b) => ({
    matches: [{ id: 'mm', game_id: 'm', round_id: 'r', match_type: type }],
    matchPlayers: [...a.map((id, i) => ({ match_id: 'mm', player_id: id, side: 'a', position: i })), ...b.map((id, i) => ({ match_id: 'mm', player_id: id, side: 'b', position: i }))],
  });
  // singles A (10) v C (4): A gets 6, C gets 0
  const singles = env([g], mk('singles', ['a'], ['c']));
  assert.equal(strokes(solo(A), 3, singles), 1); // SI 4
  assert.equal(strokes(solo(A), 6, singles), 0); // SI 8
  assert.equal(strokes(solo(C), 3, singles), 0);
  // foursomes A+B (avg 15) v C+D (avg 6): A/B get 15 - 6 = 9
  const fours = env([g], mk('foursomes', ['a', 'b'], ['c', 'd']));
  assert.equal(strokes({ players: [A, B], shared: true }, 6, fours), 1); // SI 8
  assert.equal(strokes({ players: [A, B], shared: true }, 2, fours), 0); // SI 10
  assert.equal(strokes({ players: [C, D], shared: true }, 3, fours), 0);
  // a player who is not in a match gets nothing
  assert.equal(strokes(solo(PLUS), 16, env([g], mk('singles', ['a'], ['c']))), 0);
});

// ---- the same strokes, as the team scorecard gets them (every hole, scored or not) ----
function teamRow(g, members) {
  return computeGameRows(g, {
    PARS, STROKE_INDEX, fieldOffset: 0, players: members,
    playersById: new Map(members.map((p) => [p.id, p])),
    teams: [{ id: 't', game_id: g.id, name: 'T' }],
    teamMembersByTeam: new Map([['t', members.map((p) => p.id)]]),
    scoresByPlayer: new Map(),
  })[0];
}

test('team scorecards know every hole\'s strokes before anything is scored', () => {
  const bb = teamRow({ id: 'g', format: 'better_ball_2', handicap_pct: 100, counting_rule: { scoresCounted: 1, slots: ['net'] } }, [A, B]);
  assert.deepEqual(Object.keys(bb.marksByHole).length, 18);
  assert.deepEqual(bb.marksByHole[3], { shared: false, par: 4, strokes: { a: 1, b: 1 } });
  assert.deepEqual(bb.marksByHole[16].strokes, { a: 1, b: 2 });
  assert.equal(bb.marksByHole[8].strokes.a, 0);

  const sc = teamRow({ id: 'g', format: 'scramble_2', handicap_allowance: [35, 15] }, [A, B]);
  assert.deepEqual(sc.marksByHole[3], { shared: true, par: 4, ballStrokes: 1 });
  assert.equal(sc.marksByHole[6].ballStrokes, 0);
});

test('the team scorecard and the Enter Scores marker agree', () => {
  const g = game({ format: 'scramble_2', handicap_allowance: [35, 15] });
  const row = teamRow(g, [A, B]);
  const e = teamEnv(g);
  for (let h = 1; h <= 18; h++) assert.equal(strokes({ players: [A, B], shared: true }, h, e), row.marksByHole[h].ballStrokes, `hole ${h}`);

  const bg = game({ format: 'better_ball_2', handicap_pct: 90, counting_rule: { scoresCounted: 1, slots: ['net'] } });
  const bbRow = teamRow(bg, [A, B]);
  for (let h = 1; h <= 18; h++) {
    assert.equal(strokes(solo(A), h, env([bg])), bbRow.marksByHole[h].strokes.a, `A hole ${h}`);
    assert.equal(strokes(solo(B), h, env([bg])), bbRow.marksByHole[h].strokes.b, `B hole ${h}`);
  }
});

test('a multi-format round marks each hole by its own segment', () => {
  const g = {
    id: 'g', format: 'composite',
    segments: [
      { holes: [1, 2, 3], formatType: 'shared', handicapAllowance: { lowPct: 35, highPct: 15 } },
      { holes: [4, 5], formatType: 'individual', handicapPct: 100, countingRule: { scoresCounted: 2, slots: ['net', 'net'] } },
    ],
  };
  const row = teamRow(g, [A, B]);
  assert.deepEqual(Object.keys(row.marksByHole).map(Number), [1, 2, 3, 4, 5]);
  assert.deepEqual(row.marksByHole[3], { shared: true, par: 4, ballStrokes: 1 });
  assert.deepEqual(row.marksByHole[5], { shared: false, par: 8, strokes: { a: 1, b: 2 } }); // two scores added: two pars; SI 2 gives a 20 hcp two strokes
});
