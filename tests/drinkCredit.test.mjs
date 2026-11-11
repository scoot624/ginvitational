import test from 'node:test';
import assert from 'node:assert/strict';
import { computeGameRows } from '../src/lib/gameCalc.js';
import { computeMatchResult } from '../src/lib/matchPlay.js';
import { buildLeaderboardRows } from '../src/lib/leaderboard.js';
import { formStreak } from '../src/lib/streaks.js';
import { netScoreForHole } from '../src/lib/course.js';
import { creditMap } from '../src/lib/drinks.js';

// Stroke Credit: a drink takes strokes off NET on the hole where it was logged, in every board that has a net,
// and never touches gross. With no credit passed, every number is what it always was.

const PARS = [4, 4, 4, 3, 4, 3, 5, 3, 5, 4, 3, 5, 3, 4, 5, 4, 4, 5];
const STROKE_INDEX = [12, 10, 4, 14, 2, 8, 6, 18, 16, 9, 3, 17, 13, 5, 15, 1, 11, 7];
const base = { PARS, STROKE_INDEX, fieldOffset: 0 };
const parScores = (n = 18) => Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, PARS[i]]));
const P = (id, name, handicap = 0) => ({ id, name, handicap });
const credit = (obj) => new Map(Object.entries(obj)); // { pid: { hole: strokes } }

function teamCtx(players, game, scoresByPlayer) {
  return {
    ...base,
    players,
    playersById: new Map(players.map((p) => [p.id, p])),
    teams: [{ id: 't', game_id: game.id, name: 'T' }],
    teamMembersByTeam: new Map([['t', players.map((p) => p.id)]]),
    scoresByPlayer,
  };
}

test('netScoreForHole: credit lowers net, defaults to none', () => {
  assert.equal(netScoreForHole(5, 0, 1), 5);
  assert.equal(netScoreForHole(5, 0, 1, 1), 4);
  assert.equal(netScoreForHole(5, 18, 1, 2), 5 - 1 - 2);
});

test('leaderboard: credit improves net-to-par but not gross, and can change the order', () => {
  const players = [P('a', 'Ann Able'), P('b', 'Bob Best')];
  const scores = ['a', 'b'].flatMap((pid) =>
    [1, 2, 3].map((hole) => ({ player_id: pid, round_id: 'r', hole, score: PARS[hole - 1] + 1, created_at: '2026-01-01T00:00:00Z' }))
  );
  const plain = buildLeaderboardRows(players, scores, 'r', 0);
  assert.equal(plain[0].netToPar, 3);
  const withCredit = buildLeaderboardRows(players, scores, 'r', 0, null, credit({ b: { 2: 1, 3: 1 } }));
  assert.equal(withCredit[0].id, 'b');
  assert.equal(withCredit[0].netToPar, 1);
  assert.equal(withCredit[0].gross, plain.find((r) => r.id === 'b').gross); // gross untouched
  assert.deepEqual(withCredit[0].creditByHole, { 2: 1, 3: 1 });
  // an empty or missing map changes nothing
  assert.deepEqual(
    buildLeaderboardRows(players, scores, 'r', 0, null, new Map()).map((r) => r.netToPar),
    plain.map((r) => r.netToPar)
  );
});

test('credit respects the max-drinks cap (only the first drinks count) via creditMap', () => {
  const drinks = [1, 2, 3, 4].map((hole, i) => ({ id: 'd' + i, player_id: 'a', round_id: 'r', hole, created_at: `2026-01-01T00:0${i}:00Z` }));
  const map = creditMap(drinks, { enabled: true, variant: 'credit', creditPerDrink: 1, maxDrinks: 3 });
  assert.deepEqual(map.get('a'), { 1: 1, 2: 1, 3: 1 }); // the 4th drink gives nothing
});

test('individual net and gross games: credit lowers net only', () => {
  const players = [P('a', 'Ann Able'), P('b', 'Bob Best')];
  const sc = new Map([['a', parScores(4)], ['b', parScores(4)]]);
  const cr = credit({ a: { 1: 1, 2: 2 } });
  const net = computeGameRows({ format: 'individual_net', handicap_pct: 100 }, { ...base, players, scoresByPlayer: sc, credit: cr });
  assert.equal(net[0].id, 'a');
  assert.equal(net[0].toPar, -3);
  const gross = computeGameRows({ format: 'individual_gross', handicap_pct: 100 }, { ...base, players, scoresByPlayer: sc, credit: cr });
  assert.deepEqual(gross.map((r) => r.toPar), [0, 0]);
});

test("better ball: each partner's own drinks lower only their own net", () => {
  const players = [P('a', 'Ann Able'), P('b', 'Bob Best')];
  const game = { id: 'g', format: 'better_ball_2', handicap_pct: 100, counting_rule: { scoresCounted: 1, slots: ['net'] } };
  const ctx = teamCtx(players, game, new Map([['a', parScores(2)], ['b', parScores(2)]]));
  assert.equal(computeGameRows(game, ctx)[0].toPar, 0);
  // B's drink on hole 1 makes B's net the better ball there
  assert.equal(computeGameRows(game, { ...ctx, credit: credit({ b: { 1: 1 } }) })[0].toPar, -1);
});

test("scramble: a shared ball takes the credit of BOTH partners' drinks", () => {
  const players = [P('a', 'Ann Able'), P('b', 'Bob Best')];
  const game = { id: 'g', format: 'scramble_2', handicap_pct: 100, handicap_allowance: [35, 15] };
  const ctx = teamCtx(players, game, new Map([['a', parScores(2)], ['b', parScores(2)]]));
  assert.equal(computeGameRows(game, ctx)[0].toPar, 0);
  assert.equal(computeGameRows(game, { ...ctx, credit: credit({ a: { 1: 1 }, b: { 1: 1 } }) })[0].toPar, -2);
});

test("composite: shared segments sum partners' credit; individual segments use each player's own", () => {
  const players = [P('a', 'Ann Able'), P('b', 'Bob Best')];
  const game = {
    id: 'g',
    format: 'composite',
    segments: [
      { holes: [1], formatType: 'shared', handicapAllowance: { lowPct: 100, highPct: 0 } },
      { holes: [2], formatType: 'individual', countingRule: { scoresCounted: 1, slots: ['net'] }, handicapPct: 100 },
    ],
  };
  const ctx = teamCtx(players, game, new Map([['a', parScores(2)], ['b', parScores(2)]]));
  const row = computeGameRows(game, { ...ctx, credit: credit({ a: { 1: 1, 2: 1 }, b: { 1: 1 } }) })[0];
  assert.equal(row.scoresByHole[1], PARS[0] - 2); // shared: both partners' drinks
  assert.equal(row.scoresByHole[2], PARS[1] - 1); // better ball: the best single net
});

test("match play: singles/four-ball use each player's credit, foursomes sums the pair's", () => {
  const mk = (type, a, b) => ({ id: 'm', match_type: type, sideA: a, sideB: b });
  const mctx = (scoresByPlayer, extra = {}) => ({ PARS, STROKE_INDEX, handicapMode: 'gross', handicapPct: 100, fieldOffset: 0, startHole: 1, scoresByPlayer, ...extra });
  const A = P('a', 'Ann Able'), B = P('b', 'Bob Best'), C = P('c', 'Cy Cole'), D = P('d', 'Di Dunn');

  // singles: a halved hole becomes a win for the player with the drink
  const sc = new Map([['a', parScores(1)], ['b', parScores(1)]]);
  assert.equal(computeMatchResult(mk('singles', [A], [B]), mctx(sc)).diff, 0);
  assert.equal(computeMatchResult(mk('singles', [A], [B]), mctx(sc, { credit: credit({ a: { 1: 1 } }) })).diff, 1);

  // four-ball: the better net of the side, after each player's own credit
  const sc4 = new Map(['a', 'b', 'c', 'd'].map((id) => [id, parScores(1)]));
  assert.equal(computeMatchResult(mk('fourball', [A, B], [C, D]), mctx(sc4, { credit: credit({ b: { 1: 1 } }) })).diff, 1);

  // foursomes: one ball per side, so both partners' drinks count
  assert.equal(computeMatchResult(mk('foursomes', [A, B], [C, D]), mctx(sc4, { credit: credit({ a: { 1: 1 }, b: { 1: 1 } }) })).diff, 1);
  assert.equal(computeMatchResult(mk('foursomes', [A, B], [C, D]), mctx(sc4, { credit: credit({ c: { 1: 1 }, d: { 1: 1 } }) })).diff, -1);
});

test('form streak: credit can turn a net par into a net birdie', () => {
  const row = (creditByHole) => ({ holesPlayed: 2, playingHandicap: 0, creditByHole, scoresByHole: { 1: PARS[0], 2: PARS[1] } });
  assert.equal(formStreak(row({}), 1), null);
  assert.equal(formStreak(row({ 1: 1, 2: 1 }), 1), 'fire');
});
