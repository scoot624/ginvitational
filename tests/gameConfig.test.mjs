import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FORMATS_BY_TEAM_SIZE,
  GAME_FORMAT_LABELS,
  GAME_FORMAT_TEAM_SIZE,
  SEGMENT_FORMAT_OPTIONS,
  TEAM_SIZE_OPTIONS,
  segmentOption,
  segmentOptionsFor,
} from '../src/lib/gameConfig.js';
import { computeGameRows } from '../src/lib/gameCalc.js';

test('team size picker offers 1, 2 and 4', () => {
  assert.deepEqual(TEAM_SIZE_OPTIONS.map((o) => o.size), [1, 2, 4]);
  assert.deepEqual(Object.keys(FORMATS_BY_TEAM_SIZE).map(Number), [1, 2, 4]);
});

test('every format in the Format list has a name, and sits under the team size it is built for', () => {
  for (const [size, formats] of Object.entries(FORMATS_BY_TEAM_SIZE)) {
    for (const f of formats) {
      assert.ok(GAME_FORMAT_LABELS[f], `${f} needs a label`);
      if (GAME_FORMAT_TEAM_SIZE[f]) assert.equal(GAME_FORMAT_TEAM_SIZE[f], Number(size), `${f} is listed under the wrong team size`);
    }
  }
  // each fixed-size format is offered exactly once, under its own size
  for (const [f, size] of Object.entries(GAME_FORMAT_TEAM_SIZE)) {
    const where = Object.entries(FORMATS_BY_TEAM_SIZE).filter(([, list]) => list.includes(f)).map(([s]) => Number(s));
    assert.deepEqual(where, [size], `${f} should appear only under team size ${size}`);
  }
});

test('Multi-Format Round is for 2 or 4, Match Play for 1 or 2, and the parked Ryder Cup is not offered', () => {
  const under = (f) => Object.entries(FORMATS_BY_TEAM_SIZE).filter(([, l]) => l.includes(f)).map(([s]) => Number(s));
  assert.deepEqual(under('composite'), [2, 4]);
  assert.deepEqual(under('match_play'), [1, 2]);
  assert.deepEqual(under('ryder_cup'), []);
});

test('2-Man Alternate Shot is a pairs-only game', () => {
  assert.ok(FORMATS_BY_TEAM_SIZE[2].includes('alt_shot_2'));
  assert.ok(!FORMATS_BY_TEAM_SIZE[4].includes('alt_shot_2'));
  assert.ok(!FORMATS_BY_TEAM_SIZE[1].includes('alt_shot_2'));
});

test('multi-format segments: pairs get Better Ball, Total Score, Scramble and Alternate Shot; 4-Man has no Alternate Shot', () => {
  assert.deepEqual(segmentOptionsFor(2).map(([k]) => k), ['best_ball', 'combined', 'scramble', 'alt_shot']);
  assert.deepEqual(segmentOptionsFor(4).map(([k]) => k), ['best_ball', 'combined', 'scramble']);
  assert.match(segmentOption('combined', 2).label, /Total Score/);
  assert.match(segmentOption('combined', 4).label, /two best/);
  // alt shot and scramble are both one shared ball
  assert.equal(segmentOption('alt_shot', 2).kind, 'shared');
  assert.equal(segmentOption('scramble', 2).kind, 'shared');
  // a saved choice that doesn't exist for this size falls back to Better Ball instead of breaking
  assert.equal(segmentOption('alt_shot', 4), SEGMENT_FORMAT_OPTIONS.best_ball);
  assert.equal(segmentOption('nonsense', 2), SEGMENT_FORMAT_OPTIONS.best_ball);
});

test('a multi-format round scores an Alternate Shot segment exactly like a Scramble segment', () => {
  const PARS = [4, 4, 4, 3, 4, 3, 5, 3, 5, 4, 3, 5, 3, 4, 5, 4, 4, 5];
  const STROKE_INDEX = [12, 10, 4, 14, 2, 8, 6, 18, 16, 9, 3, 17, 13, 5, 15, 1, 11, 7];
  const players = [{ id: 'a', name: 'Ann Able', handicap: 10 }, { id: 'b', name: 'Bob Best', handicap: 20 }];
  const seg = (label) => ({ holes: [1, 2, 3], formatType: 'shared', label, handicapAllowance: { lowPct: 35, highPct: 15 } });
  const rows = (label) =>
    computeGameRows(
      { id: 'g', format: 'composite', segments: [seg(label), { holes: [4, 5], formatType: 'individual', label: 'Total Score', countingRule: { scoresCounted: 2, slots: ['net', 'net'] }, handicapPct: 100 }] },
      {
        PARS, STROKE_INDEX, fieldOffset: 0, players,
        playersById: new Map(players.map((p) => [p.id, p])),
        teams: [{ id: 't', game_id: 'g', name: 'T' }],
        teamMembersByTeam: new Map([['t', ['a', 'b']]]),
        scoresByPlayer: new Map([['a', { 1: 5, 2: 4, 3: 6, 4: 3, 5: 6 }], ['b', { 1: 5, 2: 4, 3: 6, 4: 4, 5: 5 }]]),
      }
    )[0];
  const alt = rows('Alternate Shot');
  const scramble = rows('Scramble');
  assert.equal(alt.toPar, scramble.toPar);
  assert.deepEqual(alt.scoresByHole, scramble.scoresByHole);
  assert.equal(alt.holesPlayed, 5);
});
