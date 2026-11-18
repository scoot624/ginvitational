import test from 'node:test';
import assert from 'node:assert/strict';
import { planTeamRebuild, teamGroupsForSize, teamPool, teamSizeOf } from '../src/lib/teamBuilder.js';

const P = (id, handicap, team_label = null) => ({ id, name: id, handicap, team_label });
const F = (id, group_name, round_id = 'r') => ({ id, group_name, round_id });
const fp = (foursome_id, ids) => ids.map((player_id) => ({ foursome_id, player_id }));
let n = 0;
const newId = () => 'id' + ++n;
const sorted = (a) => [...a].sort();

test('teamPool uses the players\' team value when there is one, otherwise the playing groups', () => {
  const byLabel = teamPool([P('a', 5, 'X'), P('b', 6, 'X'), P('c', 7, 'Y'), P('d', 8)], [], [], 'r');
  assert.equal(byLabel.source, 'column');
  assert.deepEqual(byLabel.teams.map((t) => [t.label, t.members.map((m) => m.id)]), [['X', ['a', 'b']], ['Y', ['c']]]);

  const byGroup = teamPool([P('a', 5), P('b', 6), P('c', 7)], [F('f1', 'G1'), F('f2', 'G2'), F('f3', 'Other round', 'r2')], [...fp('f1', ['a', 'b']), ...fp('f2', ['c']), ...fp('f3', ['a'])], 'r');
  assert.equal(byGroup.source, 'groups');
  assert.deepEqual(byGroup.teams.map((t) => [t.label, t.members.map((m) => m.id)]), [['G1', ['a', 'b']], ['G2', ['c']]]);
});

test('teamGroupsForSize: a group of 4 is split into pairs for a 2-man game (lowest with highest), or kept whole', () => {
  const group = [{ label: 'G', members: [P('a', 4), P('b', 20), P('c', 8), P('d', 12)] }];
  const bal = teamGroupsForSize(group, 2, 'balanced');
  assert.deepEqual(bal.map((t) => [t.label, t.members.map((m) => m.id)]), [['G A', ['a', 'b']], ['G B', ['c', 'd']]]);
  const ord = teamGroupsForSize([{ label: 'G', members: [P('a', 4), P('b', 20), P('c', 8), P('d', 12)] }], 2, 'order');
  assert.deepEqual(ord.map((t) => t.members.map((m) => m.id)), [['a', 'b'], ['c', 'd']]);
  assert.equal(teamGroupsForSize(group, 2, 'keep').length, 1);
  assert.equal(teamGroupsForSize(group, 4, 'balanced').length, 1); // a 4-man game keeps the whole group
  assert.equal(teamGroupsForSize([{ label: 'G', members: [P('a', 4)] }], 2)[0].mismatched, true);
});

test('teamSizeOf: fixed by the format, or the usual size of a multi-format round\'s teams', () => {
  assert.equal(teamSizeOf({ format: 'scramble_2' }, [], new Map()), 2);
  assert.equal(teamSizeOf({ format: 'better_ball_4' }, [], new Map()), 4);
  const teams = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];
  assert.equal(teamSizeOf({ format: 'composite' }, teams, new Map([['t1', ['a', 'b', 'c', 'd']], ['t2', ['e', 'f']], ['t3', ['g', 'h']]])), 2);
  assert.equal(teamSizeOf({ format: 'composite' }, [], new Map()), 2);
});

// the scenario that was reported: two players were on the wrong teams, so they were swapped between two groups
const players = [P('a', 5, 'Able'), P('b', 6, 'Able'), P('c', 7, 'Cole'), P('d', 8, 'Cole')];
const games = [
  { id: 'g1', format: 'composite', segments: [] },
  { id: 'g2', format: 'scramble_2' },
  { id: 'gi', format: 'individual_net' },
  { id: 'gm', format: 'match_play' },
];
const oldTeams = [
  { id: 't1', game_id: 'g1', name: 'Able' }, { id: 't2', game_id: 'g1', name: 'Cole' },
  { id: 't3', game_id: 'g2', name: 'Able' }, { id: 't4', game_id: 'g2', name: 'Cole' },
];
const oldMembers = [
  ['t1', 'a'], ['t1', 'b'], ['t2', 'c'], ['t2', 'd'], ['t3', 'a'], ['t3', 'b'], ['t4', 'c'], ['t4', 'd'],
].map(([team_id, player_id]) => ({ game_id: oldTeams.find((t) => t.id === team_id).game_id, team_id, player_id }));
const base = { games, gameTeams: oldTeams, gameTeamMembers: oldMembers, foursomes: [], foursomePlayers: [], roundId: 'r', newId };

test('nothing moved: the teams already match, so there is nothing to change', () => {
  const plans = planTeamRebuild({ ...base, players });
  assert.deepEqual(plans.map((p) => p.game.id), ['g1', 'g2']); // only team games that already have teams
  assert.ok(plans.every((p) => !p.changed));
});

test('two players swapped between groups: every team game gets the new pairs', () => {
  // b and c swap: Able = a + c, Cole = b + d (their team value follows the group, as the roster editor keeps it)
  const moved = [P('a', 5, 'Able'), P('b', 6, 'Cole'), P('c', 7, 'Able'), P('d', 8, 'Cole')];
  const plans = planTeamRebuild({ ...base, players: moved });
  assert.ok(plans.every((p) => p.changed && p.added === 2 && p.removed === 2));
  for (const p of plans) {
    assert.equal(p.teamSize, 2);
    assert.deepEqual(p.teams.map((t) => [t.name, sorted(t.memberIds)]), [['Able', ['a', 'c']], ['Cole', ['b', 'd']]]);
    assert.equal(new Set(p.teams.map((t) => t.id)).size, 2); // each new team has its own new id
  }
});

test('a player moved but not swapped back: the group of 3 splits into a pair and a single, and the plan flags the short teams', () => {
  // d moved into Able, so Able has three people and Cole has one: this is how a team ends up showing only one name
  const moved = [P('a', 5, 'Able'), P('b', 6, 'Able'), P('c', 7, 'Cole'), P('d', 8, 'Able')];
  const [g1] = planTeamRebuild({ ...base, players: moved });
  assert.equal(g1.changed, true);
  assert.deepEqual(g1.teams.map((t) => [t.name, sorted(t.memberIds)]), [['Able A', ['a', 'd']], ['Able B', ['b']], ['Cole', ['c']]]);
  assert.deepEqual(g1.short.map((t) => t.name), ['Able B', 'Cole']);
});

test('when every group has its two players the plan has no short teams', () => {
  const moved = [P('a', 5, 'Able'), P('b', 6, 'Cole'), P('c', 7, 'Able'), P('d', 8, 'Cole')];
  assert.ok(planTeamRebuild({ ...base, players: moved }).every((p) => p.short.length === 0));
});

test('a game with no teams yet, and non-team games, are left alone', () => {
  const plans = planTeamRebuild({ ...base, players, gameTeams: oldTeams.filter((t) => t.game_id === 'g1'), gameTeamMembers: oldMembers.filter((m) => m.game_id === 'g1') });
  assert.deepEqual(plans.map((p) => p.game.id), ['g1']);
});

test('teams follow the playing groups when no player has a team value', () => {
  const noLabels = [P('a', 5), P('b', 6), P('c', 7), P('d', 8)];
  const plans = planTeamRebuild({
    ...base, players: noLabels,
    foursomes: [F('f1', 'North'), F('f2', 'South')],
    foursomePlayers: [...fp('f1', ['a', 'c']), ...fp('f2', ['b', 'd'])],
  });
  assert.deepEqual(plans[0].teams.map((t) => [t.name, sorted(t.memberIds)]), [['North', ['a', 'c']], ['South', ['b', 'd']]]);
  assert.equal(plans[0].changed, true);
});
