import test from 'node:test';
import assert from 'node:assert/strict';
import { computeIndividualGameRows, computeCompositeGameRows, strokesOnHoleForGame, buildScoresByPlayer } from '../src/lib/gameCalc.js';

const PARS = [4, 4, 4, 3, 4, 3, 5, 3, 5, 4, 3, 5, 3, 4, 5, 4, 4, 5];
const STROKE_INDEX = [12, 10, 4, 14, 2, 8, 6, 18, 16, 9, 3, 17, 13, 5, 15, 1, 11, 7];
const ctx = { PARS, STROKE_INDEX, fieldOffset: 0 };

const scoresAllPar = (hcpAdjust = {}) => {
  const m = {};
  for (let h = 1; h <= 18; h++) m[h] = PARS[h - 1] + (hcpAdjust[h] || 0);
  return m;
};

test('strokesOnHoleForGame applies the game handicap % before allocating strokes', () => {
  // 20 * 90% = 18 -> a stroke on every hole
  assert.equal(strokesOnHoleForGame(20, 90, 8, STROKE_INDEX), 1); // hole 8 is SI 18
  // 10 * 50% = 5 -> strokes only where SI <= 5
  assert.equal(strokesOnHoleForGame(10, 50, 5, STROKE_INDEX), 1); // SI 2
  assert.equal(strokesOnHoleForGame(10, 50, 6, STROKE_INDEX), 0); // SI 8
});

test('buildScoresByPlayer scopes to a round', () => {
  const scores = [
    { player_id: 'a', hole: 1, score: 4, round_id: 'r1' },
    { player_id: 'a', hole: 1, score: 6, round_id: 'r2' },
  ];
  assert.equal(buildScoresByPlayer(scores, 'r1').get('a')[1], 4);
  assert.equal(buildScoresByPlayer(scores, 'r2').get('a')[1], 6);
});

test('individual net vs gross rank the same scores differently', () => {
  const players = [
    { id: 'low', name: 'Lo Scratch', handicap: 0 },
    { id: 'high', name: 'Hi Cap', handicap: 18 },
  ];
  // both shoot bogey (+1) on every hole: gross +18 each; net: the 18-handicap is level par
  const sc = new Map([['low', scoresAllPar(Object.fromEntries(PARS.map((_, i) => [i + 1, 1])))], ['high', scoresAllPar(Object.fromEntries(PARS.map((_, i) => [i + 1, 1])))]]);
  const net = computeIndividualGameRows({ format: 'individual_net', handicap_pct: 100 }, players, sc, ctx);
  const gross = computeIndividualGameRows({ format: 'individual_gross', handicap_pct: 100 }, players, sc, ctx);
  assert.equal(net[0].id, 'high');
  assert.equal(net[0].toPar, 0);
  assert.equal(net.find((r) => r.id === 'low').toPar, 18);
  assert.equal(gross[0].toPar, 18);
  assert.equal(gross[1].toPar, 18);
});

test('a player with no scores sorts last and shows the "no score" sentinel', () => {
  const players = [{ id: 'a', name: 'A A', handicap: 0 }, { id: 'b', name: 'B B', handicap: 0 }];
  const sc = new Map([['a', { 1: 4 }]]);
  const rows = computeIndividualGameRows({ format: 'individual_net', handicap_pct: 100 }, players, sc, ctx);
  assert.equal(rows[0].id, 'a');
  assert.equal(rows[1].toPar, 9999);
});

test('composite round: scramble holes, better-ball holes and both-count holes each score correctly', () => {
  const game = {
    segments: [
      { holes: [1, 2, 3, 4, 5, 6], formatType: 'shared', label: 'Scramble', handicapAllowance: { lowPct: 35, highPct: 15 } },
      { holes: [7, 8, 9, 10, 11, 12], formatType: 'individual', label: 'Better Ball', countingRule: { scoresCounted: 1, slots: ['net'] }, handicapPct: 100 },
      { holes: [13, 14, 15, 16, 17, 18], formatType: 'individual', label: 'Both Count', countingRule: { scoresCounted: 2, slots: ['net', 'net'] }, handicapPct: 100 },
    ],
  };
  const team = [{ id: 't', name: 'T' }];
  const members = new Map([['t', ['a', 'b']]]);
  const run = (players, scores) =>
    computeCompositeGameRows(game, team, members, new Map(players.map((p) => [p.id, p])), scores, ctx)[0];

  const level = [{ id: 'a', handicap: 0 }, { id: 'b', handicap: 0 }];
  const parScores = () => new Map(level.map((p) => [p.id, scoresAllPar()]));
  assert.equal(run(level, parScores()).toPar, 0);
  assert.equal(run(level, parScores()).holesPlayed, 18);

  // one player birdies a better-ball hole (-1); the other bogeys a both-count hole (+1) => level overall
  const s1 = parScores();
  s1.get('a')[8] = PARS[7] - 1;
  s1.get('b')[14] = PARS[13] + 1;
  assert.equal(run(level, s1).toPar, 0);

  // a partner's blow-up on a better-ball hole is ignored
  s1.get('b')[8] = PARS[7] + 3;
  assert.equal(run(level, s1).toPar, 0);

  // scramble uses a blended team handicap: 10 and 20 -> round(3.5 + 3) = 7 -> strokes where SI <= 7 in holes 1-6 (holes 3, 5, 7? only 1-6: holes 3, 5)
  const hc = [{ id: 'a', handicap: 10 }, { id: 'b', handicap: 20 }];
  const sc = new Map(hc.map((p) => { const m = {}; for (let h = 1; h <= 6; h++) m[h] = PARS[h - 1]; return [p.id, m]; }));
  const expectedStrokes = [1, 2, 3, 4, 5, 6].filter((h) => STROKE_INDEX[h - 1] <= 7).length;
  assert.equal(run(hc, sc).toPar, -expectedStrokes);
});

test('2-Man Alternate Shot is scored and handicapped exactly like the 2-Man Scramble', async () => {
  const { computeGameRows } = await import('../src/lib/gameCalc.js');
  const { isSharedBallFormat, GAME_FORMAT_LABELS, GAME_FORMAT_TEAM_SIZE, SCRAMBLE_DEFAULT_PCTS } = await import('../src/lib/gameConfig.js');
  assert.ok(isSharedBallFormat('alt_shot_2') && isSharedBallFormat('scramble_2') && isSharedBallFormat('scramble_4'));
  assert.ok(!isSharedBallFormat('better_ball_2') && !isSharedBallFormat('composite') && !isSharedBallFormat('match_play'));
  assert.equal(GAME_FORMAT_LABELS.alt_shot_2, '2-Man Alternate Shot');
  assert.equal(GAME_FORMAT_TEAM_SIZE.alt_shot_2, 2);
  assert.deepEqual(SCRAMBLE_DEFAULT_PCTS.alt_shot_2, SCRAMBLE_DEFAULT_PCTS.scramble_2); // 35 / 15

  const players = [
    { id: 'a', name: 'Ann Able', handicap: 10 },
    { id: 'b', name: 'Bob Best', handicap: 20 },
    { id: 'c', name: 'Cy Cole', handicap: 4 },
    { id: 'd', name: 'Di Dunn', handicap: 30 },
  ];
  const teams = [{ id: 't1', game_id: 'g', name: 'Team 1' }, { id: 't2', game_id: 'g', name: 'Team 2' }];
  const ctxFor = (id) => ({
    PARS, STROKE_INDEX, fieldOffset: 0, players,
    playersById: new Map(players.map((p) => [p.id, p])),
    teams: teams.map((t) => ({ ...t, game_id: id })),
    teamMembersByTeam: new Map([['t1', ['a', 'b']], ['t2', ['c', 'd']]]),
    // the entry screen saves the team's one score under both partners
    scoresByPlayer: new Map([
      ['a', { 1: 5, 2: 4, 3: 6 }], ['b', { 1: 5, 2: 4, 3: 6 }],
      ['c', { 1: 4, 2: 4, 3: 5 }], ['d', { 1: 4, 2: 4, 3: 5 }],
    ]),
    credit: new Map([['a', { 1: 1 }], ['b', { 1: 1 }]]), // Drinking Mode credit: both partners' drinks count on a shared ball
  });
  const scramble = computeGameRows({ id: 's', format: 'scramble_2', handicap_pct: 100, handicap_allowance: [35, 15] }, ctxFor('s'));
  const alt = computeGameRows({ id: 'x', format: 'alt_shot_2', handicap_pct: 100, handicap_allowance: [35, 15] }, ctxFor('x'));
  const shape = (rows) => rows.map(({ name, toPar, holesPlayed, teamHandicap, scoresByHole, gross }) => ({ name, toPar, holesPlayed, teamHandicap, scoresByHole, gross }));
  assert.deepEqual(shape(alt), shape(scramble));
  // Team 1 blend: 10 x 35% + 20 x 15% = 6.5 -> 7 strokes; Team 2: 4 x 35% + 30 x 15% = 5.9 -> 6
  assert.equal(alt.find((r) => r.name === 'Team 1').teamHandicap, 7);
  assert.equal(alt.find((r) => r.name === 'Team 2').teamHandicap, 6);
  // and a different allowance changes it the same way it does for the scramble
  const alt50 = computeGameRows({ id: 'x', format: 'alt_shot_2', handicap_pct: 100, handicap_allowance: [50, 50] }, ctxFor('x'));
  assert.equal(alt50.find((r) => r.name === 'Team 1').teamHandicap, 15);
});
