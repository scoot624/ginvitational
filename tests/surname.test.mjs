import test from 'node:test';
import assert from 'node:assert/strict';
import { surname } from '../src/lib/golf.js';
import { teamLabel } from '../src/lib/gameCalc.js';
import { isTeamFormat } from '../src/lib/gameConfig.js';

test('surname drops middle names but keeps a surname that is more than one word', () => {
  assert.equal(surname('Brian Cuttic'), 'Cuttic');
  assert.equal(surname('Michael James Murray'), 'Murray'); // middle name dropped
  assert.equal(surname('Tom Van Berg'), 'Van Berg');
  assert.equal(surname('Juan De La Cruz'), 'De La Cruz');
  assert.equal(surname('Mary Ann Von Trapp'), 'Von Trapp');
  assert.equal(surname("Mikey L'Erario"), "L'Erario");
  assert.equal(surname('Madonna'), 'Madonna');
  assert.equal(surname('  Ann   Able  '), 'Able');
  assert.equal(surname(''), '');
  assert.equal(surname(null), '');
});

test('surname ignores a trailing Jr./Sr./III', () => {
  assert.equal(surname('John Smith Jr.'), 'Smith');
  assert.equal(surname('John Smith III'), 'Smith');
  assert.equal(surname('Tom Van Berg Sr'), 'Van Berg');
  assert.equal(surname('Jr Smith'), 'Smith'); // a two-word name is never trimmed down to nothing
});

test('team labels use the surname', () => {
  assert.equal(teamLabel([{ name: 'Jimmy Schmidt' }, { name: 'Michael James Murray' }], 'Murray'), 'Schmidt / Murray');
});

test('isTeamFormat: team games list teams, individual and match games do not', () => {
  for (const f of ['better_ball_2', 'better_ball_4', 'scramble_2', 'scramble_4', 'alt_shot_2', 'composite']) assert.ok(isTeamFormat(f), f);
  for (const f of ['individual_net', 'individual_gross', 'match_play', 'ryder_cup']) assert.ok(!isTeamFormat(f), f);
});
