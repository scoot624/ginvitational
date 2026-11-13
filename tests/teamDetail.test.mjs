import test from 'node:test';
import assert from 'node:assert/strict';
import { computeGameRows, mergeGameRowsAcrossRounds } from '../src/lib/gameCalc.js';

// Team rows carry hole-by-hole detail so a tapped team can show its scorecard.

const PARS = [4, 4, 4, 3, 4, 3, 5, 3, 5, 4, 3, 5, 3, 4, 5, 4, 4, 5];
const STROKE_INDEX = [12, 10, 4, 14, 2, 8, 6, 18, 16, 9, 3, 17, 13, 5, 15, 1, 11, 7];
const players = [{ id: 'a', name: 'Ann Able', handicap: 0 }, { id: 'b', name: 'Bob Best', handicap: 0 }];

function ctx(game, scores, credit) {
  return {
    PARS, STROKE_INDEX, fieldOffset: 0, players,
    playersById: new Map(players.map((p) => [p.id, p])),
    teams: [{ id: 't', game_id: game.id, name: 'T' }],
    teamMembersByTeam: new Map([['t', ['a', 'b']]]),
    scoresByPlayer: new Map(Object.entries(scores)),
    credit,
  };
}

test('better ball: each player\'s own score per hole, the counted score, and the par it is measured against', () => {
  const g = { id: 'g', format: 'better_ball_2', handicap_pct: 100, counting_rule: { scoresCounted: 1, slots: ['net'] } };
  const row = computeGameRows(g, ctx(g, { a: { 1: 5, 2: 4 }, b: { 1: 4, 2: 6 } }))[0];
  assert.deepEqual(Object.keys(row.detailByHole).map(Number), [1, 2]);
  assert.deepEqual(row.detailByHole[1], { par: 4, counted: 4, shared: false, grosses: { a: 5, b: 4 } });
  assert.deepEqual(row.detailByHole[2], { par: 4, counted: 4, shared: false, grosses: { a: 4, b: 6 } });
  assert.equal(row.toPar, 0);
});

test('a hole where only one partner has scored still shows that score', () => {
  const g = { id: 'g', format: 'better_ball_2', handicap_pct: 100, counting_rule: { scoresCounted: 1, slots: ['net'] } };
  const row = computeGameRows(g, ctx(g, { a: { 1: 5 }, b: {} }))[0];
  assert.deepEqual(row.detailByHole[1].grosses, { a: 5 });
});

test('both-count better ball measures two added scores against two pars', () => {
  const g = { id: 'g', format: 'better_ball_2', handicap_pct: 100, counting_rule: { scoresCounted: 2, slots: ['net', 'net'] } };
  const row = computeGameRows(g, ctx(g, { a: { 1: 5 }, b: { 1: 4 } }))[0];
  assert.equal(row.detailByHole[1].par, 8);
  assert.equal(row.detailByHole[1].counted, 9);
});

test('scramble and alternate shot: one team ball per hole', () => {
  for (const format of ['scramble_2', 'alt_shot_2']) {
    const g = { id: 'g', format, handicap_pct: 100, handicap_allowance: [35, 15] };
    const row = computeGameRows(g, ctx(g, { a: { 1: 5, 2: 3 }, b: { 1: 5, 2: 3 } }))[0];
    assert.deepEqual(row.detailByHole[1], { par: 4, counted: 5, shared: true, gross: 5 }, format);
    assert.equal(row.detailByHole[2].gross, 3, format);
  }
});

test('multi-format round: shared holes carry the team ball, the others each player\'s own score', () => {
  const g = {
    id: 'g', format: 'composite',
    segments: [
      { holes: [1], formatType: 'shared', label: 'Alternate Shot', handicapAllowance: { lowPct: 35, highPct: 15 } },
      { holes: [2], formatType: 'individual', label: 'Total Score', countingRule: { scoresCounted: 2, slots: ['net', 'net'] }, handicapPct: 100 },
    ],
  };
  const row = computeGameRows(g, ctx(g, { a: { 1: 5, 2: 4 }, b: { 1: 5, 2: 5 } }))[0];
  assert.deepEqual(row.detailByHole[1], { par: 4, counted: 5, shared: true, gross: 5 });
  assert.deepEqual(row.detailByHole[2], { par: 8, counted: 9, shared: false, grosses: { a: 4, b: 5 } });
  // the board total still matches the detail
  const fromDetail = Object.values(row.detailByHole).reduce((s, d) => s + d.counted - d.par, 0);
  assert.equal(row.toPar, fromDetail);
});

test('drink credit is already in the counted score the detail shows', () => {
  const g = { id: 'g', format: 'scramble_2', handicap_pct: 100, handicap_allowance: [35, 15] };
  const credit = new Map([['a', { 1: 1 }], ['b', { 1: 1 }]]);
  const row = computeGameRows(g, ctx(g, { a: { 1: 5 }, b: { 1: 5 } }, credit))[0];
  assert.equal(row.detailByHole[1].gross, 5); // gross untouched
  assert.equal(row.detailByHole[1].counted, 3); // both partners' drinks
});

test('an "Overall" board (several rounds added together) has no hole-by-hole detail', () => {
  const g = { id: 'g', format: 'better_ball_2', handicap_pct: 100, counting_rule: { scoresCounted: 1, slots: ['net'] } };
  const r1 = computeGameRows(g, ctx(g, { a: { 1: 5 }, b: { 1: 4 } }));
  const merged = mergeGameRowsAcrossRounds([r1, r1]);
  assert.equal(merged[0].detailByHole, undefined);
});
