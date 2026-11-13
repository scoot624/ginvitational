import test from 'node:test';
import assert from 'node:assert/strict';
import { computeGameRows, teamLabel } from '../src/lib/gameCalc.js';

// Team boards show one line per team: the players' last names, not the saved team name.

const PARS = [4, 4, 4, 3, 4, 3, 5, 3, 5, 4, 3, 5, 3, 4, 5, 4, 4, 5];
const STROKE_INDEX = [12, 10, 4, 14, 2, 8, 6, 18, 16, 9, 3, 17, 13, 5, 15, 1, 11, 7];

test('teamLabel: last names joined with a slash, whole last names kept, empty team falls back', () => {
  assert.equal(teamLabel([{ name: 'Cy Cole' }, { name: 'Di Dunn' }], 'Johnstone A'), 'Cole / Dunn');
  assert.equal(teamLabel([{ name: 'Ann Able' }, { name: 'Bob Best' }, { name: 'Cy Cole' }, { name: 'Di Dunn' }], 'x'), 'Able / Best / Cole / Dunn');
  assert.equal(teamLabel([{ name: 'Tom Van Berg' }, { name: 'Sue O\'Neil' }], 'x'), 'Van Berg / O\'Neil');
  assert.equal(teamLabel([{ name: 'Madonna' }, { name: 'Ann Able' }], 'x'), 'Madonna / Able');
  assert.equal(teamLabel([], 'Johnstone A'), 'Johnstone A');
  assert.equal(teamLabel(undefined, 'Johnstone A'), 'Johnstone A');
});

function setup(playerNames, teamsSpec, game) {
  const players = playerNames.map((name, i) => ({ id: 'p' + i, name, handicap: 10 }));
  return {
    PARS, STROKE_INDEX, fieldOffset: 0, players,
    playersById: new Map(players.map((p) => [p.id, p])),
    teams: teamsSpec.map((t, i) => ({ id: 't' + i, game_id: game.id, name: t.name })),
    teamMembersByTeam: new Map(teamsSpec.map((t, i) => ['t' + i, t.ids])),
    scoresByPlayer: new Map(players.map((p) => [p.id, { 1: 4, 2: 4 }])),
  };
}

test('2-man better ball, scramble and alternate shot boards name each team by its last names', () => {
  const names = ['Ann Able', 'Bob Best', 'Cy Cole', 'Di Dunn'];
  const spec = [{ name: 'Johnstone A', ids: ['p0', 'p1'] }, { name: 'Johnstone B', ids: ['p2', 'p3'] }];
  const games = [
    { id: 'g1', format: 'better_ball_2', handicap_pct: 100, counting_rule: { scoresCounted: 1, slots: ['net'] } },
    { id: 'g2', format: 'scramble_2', handicap_pct: 100, handicap_allowance: [35, 15] },
    { id: 'g3', format: 'alt_shot_2', handicap_pct: 100, handicap_allowance: [35, 15] },
  ];
  for (const g of games) {
    const rows = computeGameRows(g, setup(names, spec, g));
    assert.deepEqual(rows.map((r) => r.name).sort(), ['Able / Best', 'Cole / Dunn'], g.format);
    assert.deepEqual(rows.map((r) => r.teamName).sort(), ['Johnstone A', 'Johnstone B'], g.format);
    assert.ok(rows.every((r) => r.members.length === 2));
  }
});

test('4-man teams use all four last names, in team order', () => {
  const names = ['Ann Able', 'Bob Best', 'Cy Cole', 'Di Dunn'];
  const spec = [{ name: 'Johnstone', ids: ['p0', 'p1', 'p2', 'p3'] }];
  const g = { id: 'g', format: 'better_ball_4', handicap_pct: 100, counting_rule: { scoresCounted: 1, slots: ['net'] } };
  assert.equal(computeGameRows(g, setup(names, spec, g))[0].name, 'Able / Best / Cole / Dunn');
  const s4 = { id: 'g', format: 'scramble_4', handicap_pct: 100, handicap_allowance: [40, 30, 20, 10] };
  assert.equal(computeGameRows(s4, setup(names, spec, s4))[0].name, 'Able / Best / Cole / Dunn');
});

test('a multi-format round names its teams by last names too', () => {
  const names = ['Ann Able', 'Bob Best'];
  const spec = [{ name: 'Johnstone A', ids: ['p0', 'p1'] }];
  const g = {
    id: 'g', format: 'composite',
    segments: [{ holes: [1, 2], formatType: 'shared', label: 'Alternate Shot', handicapAllowance: { lowPct: 35, highPct: 15 } }],
  };
  const row = computeGameRows(g, setup(names, spec, g))[0];
  assert.equal(row.name, 'Able / Best');
  assert.equal(row.teamName, 'Johnstone A');
});

test('a team with nobody on it keeps its saved name', () => {
  const g = { id: 'g', format: 'better_ball_2', handicap_pct: 100, counting_rule: { scoresCounted: 1, slots: ['net'] } };
  const ctx = setup(['Ann Able'], [{ name: 'Empty Team', ids: [] }], g);
  assert.equal(computeGameRows(g, ctx)[0].name, 'Empty Team');
});

test('individual boards are unchanged: a player is still their own full name', () => {
  const g = { id: 'g', format: 'individual_net', handicap_pct: 100 };
  const ctx = setup(['Ann Able', 'Bob Best'], [], g);
  assert.deepEqual(computeGameRows(g, ctx).map((r) => r.name).sort(), ['Ann Able', 'Bob Best']);
});
