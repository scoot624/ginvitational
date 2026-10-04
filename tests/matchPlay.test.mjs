import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMatchResult, computeRyderCup } from '../src/lib/matchPlay.js';

test("Match play engine: results, handicaps, 2v2, points", () => {
  const fails = [];
  const ok = (c, msg) => { if (!c) fails.push(msg); };
  const PARS = [4, 4, 3, 5, 4, 4, 3, 5, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5];
  const STROKE_INDEX = [7, 11, 15, 3, 1, 9, 13, 17, 5, 8, 12, 16, 4, 2, 10, 14, 18, 6];
  const P = (id, name, handicap) => ({ id, name, handicap });
  const scoresFor = (map) => new Map(Object.entries(map).map(([id, byHole]) => [id, byHole]));
  // gross score = par + delta, for holes 1..n in a given order
  const line = (deltas, order) => Object.fromEntries(deltas.map((d, i) => [order ? order[i] : i + 1, PARS[(order ? order[i] : i + 1) - 1] + d]));
  const base = (extra = {}) => ({ PARS, STROKE_INDEX, handicapMode: 'gross', handicapPct: 100, fieldOffset: 0, startHole: 1, ...extra });
  const single = (a, b) => ({ id: 'm', match_type: 'singles', sideA: [a], sideB: [b] });

  const A = P('a', 'Anna Ames', 0), B = P('b', 'Ben Bell', 0);

  // all square thru 3 (halved holes)
  let r = computeMatchResult(single(A, B), base({ scoresByPlayer: scoresFor({ a: line([0, 0, 0]), b: line([0, 0, 0]) }) }));
  ok(r.status === 'in_progress' && r.text === 'All square thru 3' && r.diff === 0, 'AS thru 3: ' + r.text);
  // 2 up thru 4
  r = computeMatchResult(single(A, B), base({ scoresByPlayer: scoresFor({ a: line([-1, -1, 0, 0]), b: line([0, 0, 0, 0]) }) }));
  ok(r.text === 'Anna A. 2 UP thru 4' && r.leader === 'a', r.text);
  // not started
  r = computeMatchResult(single(A, B), base({ scoresByPlayer: scoresFor({}) }));
  ok(r.status === 'not_started' && r.text === 'Not started' && r.points.a === 0, 'not started');
  // a missing opponent score stops the count there
  r = computeMatchResult(single(A, B), base({ scoresByPlayer: scoresFor({ a: line([0, 0, 0, 0]), b: line([0, 0]) }) }));
  ok(r.holesPlayed === 2, 'stops at first hole without both scores: ' + r.holesPlayed);

  // 3&2: A wins holes 1-3, rest halved through hole 16 => 3 up with 2 to play
  {
    const aD = [-1, -1, -1, ...Array(13).fill(0)];
    const bD = Array(16).fill(0);
    r = computeMatchResult(single(A, B), base({ scoresByPlayer: scoresFor({ a: line(aD), b: line(bD) }) }));
    ok(r.status === 'final' && r.text === 'Anna A. wins 3&2' && r.winner === 'a' && r.points.a === 1 && r.points.b === 0, '3&2: ' + r.text);
    ok(r.holesPlayed === 16, 'ends at 16: ' + r.holesPlayed);
  }
  // 4&3: B wins 4 holes, then halves to 15
  {
    const aD = Array(15).fill(0);
    const bD = [-1, -1, -1, -1, ...Array(11).fill(0)];
    r = computeMatchResult(single(A, B), base({ scoresByPlayer: scoresFor({ a: line(aD), b: line(bD) }) }));
    ok(r.text === 'Ben B. wins 4&3' && r.points.b === 1, '4&3: ' + r.text);
  }
  // scores after the match is decided are ignored
  {
    const aD = [-1, -1, -1, -1, ...Array(14).fill(0)]; // 4 up after 4 ... plays to 18 with halves
    const bD = Array(18).fill(0);
    r = computeMatchResult(single(A, B), base({ scoresByPlayer: scoresFor({ a: line(aD), b: line(bD) }) }));
    ok(r.text === 'Anna A. wins 4&3' && r.holesPlayed === 15, 'later holes ignored once decided: ' + r.text + ' ' + r.holesPlayed);
  }
  // 1 UP at 18
  {
    const aD = [-1, ...Array(17).fill(0)];
    r = computeMatchResult(single(A, B), base({ scoresByPlayer: scoresFor({ a: line(aD), b: line(Array(18).fill(0)) }) }));
    ok(r.status === 'final' && r.text === 'Anna A. wins 1 UP' && r.holesPlayed === 18, '1 UP: ' + r.text);
  }
  // halved at 18 => half point each
  {
    const same = Array(18).fill(0);
    r = computeMatchResult(single(A, B), base({ pointsWin: 1, pointsHalf: 0.5, scoresByPlayer: scoresFor({ a: line(same), b: line(same) }) }));
    ok(r.text === 'Halved' && r.points.a === 0.5 && r.points.b === 0.5, 'halved: ' + r.text);
  }
  // dormie: 2 up with 2 to play (thru 16)
  {
    const aD = [-1, -1, ...Array(14).fill(0)];
    r = computeMatchResult(single(A, B), base({ scoresByPlayer: scoresFor({ a: line(aD.slice(0, 16)), b: line(Array(16).fill(0)) }) }));
    // 2 up thru 16 with 2 to go is decided? lead 2 == remaining 2 => dormie, not final
    ok(r.status === 'in_progress' && /dormie/.test(r.text), 'dormie: ' + r.text);
  }
  // projected points for an in-progress match
  {
    r = computeMatchResult(single(A, B), base({ scoresByPlayer: scoresFor({ a: line([-1, 0, 0]), b: line([0, 0, 0]) }) }));
    ok(r.points.a === 0 && r.projected.a === 1 && r.projected.b === 0, 'projected counts the leader');
    r = computeMatchResult(single(A, B), base({ scoresByPlayer: scoresFor({ a: line([0, 0]), b: line([0, 0]) }) }));
    ok(r.projected.a === 0.5 && r.projected.b === 0.5, 'projected halves when level');
  }

  // handicaps: singles, strokes off the lowest. A=0, B=10 => B gets 10 strokes on SI 1..10.
  {
    const A0 = P('a', 'Anna Ames', 0), B10 = P('b', 'Ben Bell', 10);
    // both shoot par on hole 5 (SI 1): B nets a birdie and wins it; hole 8 (SI 17) halved
    const m = single(A0, B10);
    const sc = scoresFor({ a: { 5: 4, 8: 5 }, b: { 5: 4, 8: 5 } });
    r = computeMatchResult(m, base({ handicapMode: 'off_lowest', startHole: 5, scoresByPlayer: sc }));
    // play order starts at 5: hole 5 B wins, then hole 6 has no scores -> stop
    ok(r.holes.length === 1 && r.holes[0].result === 'b', 'strokes off the lowest: B gets a stroke on SI 1');
    // full mode: A has 0 so the same
    r = computeMatchResult(m, base({ handicapMode: 'full', startHole: 5, scoresByPlayer: sc }));
    ok(r.holes[0].result === 'b', 'full mode same here');
    // off the lowest when both are 10 and 14: 14 gets 4 strokes (SI 1..4 => holes 5,4,... )
    const m2 = single(P('a', 'Anna Ames', 10), P('b', 'Ben Bell', 14));
    const sc2 = scoresFor({ a: { 5: 4 }, b: { 5: 4 } });
    r = computeMatchResult(m2, base({ handicapMode: 'off_lowest', startHole: 5, scoresByPlayer: sc2 }));
    ok(r.holes[0].result === 'b', 'off lowest: 14 vs 10 gives B 4 strokes -> SI 1 included');
    r = computeMatchResult(m2, base({ handicapMode: 'full', startHole: 5, scoresByPlayer: sc2 }));
    ok(r.holes[0].result === 'h', 'full: both 10+ get a stroke on SI 1 -> halved: ' + r.holes[0].result);
    // handicap percentage (90%): 20 -> 18, 0 -> 0 => difference 18, a stroke on every hole
    const m3 = single(P('a', 'Anna Ames', 0), P('b', 'Ben Bell', 20));
    r = computeMatchResult(m3, base({ handicapMode: 'off_lowest', handicapPct: 90, startHole: 8, scoresByPlayer: scoresFor({ a: { 8: 5 }, b: { 8: 5 } }) }));
    ok(r.holes[0].result === 'b', '90% of 20 = 18 strokes: stroke even on SI 17');
  }

  // four-ball: better net of each pair
  {
    const m = { id: 'f', match_type: 'fourball', sideA: [P('a1', 'Anna Ames', 0), P('a2', 'Al Ames', 0)], sideB: [P('b1', 'Ben Bell', 0), P('b2', 'Bo Bell', 0)] };
    const sc = scoresFor({ a1: { 1: 5 }, a2: { 1: 4 }, b1: { 1: 4 }, b2: { 1: 6 } });
    r = computeMatchResult(m, base({ scoresByPlayer: sc }));
    ok(r.holes[0].result === 'h', 'four-ball: 4 vs 4 halved');
    const sc2 = scoresFor({ a1: { 1: 5 }, a2: { 1: 5 }, b1: { 1: 4 }, b2: { 1: 6 } });
    r = computeMatchResult(m, base({ scoresByPlayer: sc2 }));
    ok(r.holes[0].result === 'b' && r.text === 'Ben B. / Bo B. 1 UP thru 1', 'four-ball: better ball wins: ' + r.text);
  }

  // foursomes: one shared score per side, team handicap = half the pair's combined
  {
    const m = { id: 's', match_type: 'foursomes', sideA: [P('a1', 'Anna Ames', 10), P('a2', 'Al Ames', 10)], sideB: [P('b1', 'Ben Bell', 20), P('b2', 'Bo Bell', 20)] };
    // same score saved under both partners; hole 5 is SI 1
    const sc = scoresFor({ a1: { 5: 4 }, a2: { 5: 4 }, b1: { 5: 4 }, b2: { 5: 4 } });
    r = computeMatchResult(m, base({ handicapMode: 'off_lowest', startHole: 5, scoresByPlayer: sc }));
    // team hcps 10 and 20 => B gets 10 strokes (a stroke on SI 1) => B wins the hole
    ok(r.holes[0].result === 'b', 'foursomes off-lowest: B side gets strokes: ' + r.holes[0].result);
    r = computeMatchResult(m, base({ handicapMode: 'gross', startHole: 5, scoresByPlayer: sc }));
    ok(r.holes[0].result === 'h', 'foursomes gross halved');
    // only one partner has the shared score saved -> still counts
    const sc1 = scoresFor({ a1: { 5: 4 }, b1: { 5: 5 } });
    r = computeMatchResult(m, base({ handicapMode: 'gross', startHole: 5, scoresByPlayer: sc1 }));
    ok(r.holes[0].result === 'a', 'foursomes: either partner row supplies the team score');
  }

  // shotgun start: group starts on 10 and plays 10..18,1..; holes after 9 holes in play order
  {
    const order = [10, 11, 12, 13, 14, 15, 16, 17, 18, 1, 2];
    const aD = Array(11).fill(0), bD = Array(11).fill(0);
    bD[9] = 1; bD[10] = 1; // B loses hole 1 and hole 2 (played 10th and 11th)
    r = computeMatchResult(single(A, B), base({ startHole: 10, scoresByPlayer: scoresFor({ a: line(aD, order), b: line(bD, order) }) }));
    ok(r.holesPlayed === 11 && r.diff === 2 && r.holes[9].hole === 1, 'shotgun play order: ' + r.holesPlayed + ' ' + r.diff);
    // same scores starting at 1 would only see holes 1,2 (then stop at 3)
    r = computeMatchResult(single(A, B), base({ startHole: 1, scoresByPlayer: scoresFor({ a: line(aD, order), b: line(bD, order) }) }));
    ok(r.holesPlayed === 2, 'start hole matters: ' + r.holesPlayed);
  }

  // Ryder Cup totals
  {
    const win = { status: 'final', points: { a: 1, b: 0 }, projected: { a: 1, b: 0 } };
    const half = { status: 'final', points: { a: 0.5, b: 0.5 }, projected: { a: 0.5, b: 0.5 } };
    const live = { status: 'in_progress', points: { a: 0, b: 0 }, projected: { a: 0, b: 1 } };
    const { sessions, overall } = computeRyderCup([
      { roundId: 'r1', result: win }, { roundId: 'r1', result: half }, { roundId: 'r2', result: live },
    ], ['r1', 'r2']);
    ok(overall.a === 1.5 && overall.b === 0.5 && overall.projB === 1.5 && overall.finished === 2 && overall.matches === 3, 'ryder overall ' + JSON.stringify(overall));
    ok(sessions[0].a === 1.5 && sessions[1].projB === 1 && sessions[1].a === 0, 'ryder sessions');
  }


  assert.deepEqual(fails, [], 'failed checks: ' + fails.join(' | '));
});
