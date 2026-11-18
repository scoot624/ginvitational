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

// ---- the across-the-page layout (like the Leaderboard scorecard): player rows + ONE team score row ----
import { teamCardLayout } from '../src/lib/printCards.js';

const cardFor = (g) => buildPrintCards({ ...base, game: g, ...teamsFor('g', pairs2) })[0];
const labels = (layout) => layout.rows.map((r) => r.label);
// one letter per hole: B = a box, M = the start of a merged team-ball box, - = covered by the merged box
const shape = (row, n) => row.cells.map((c) => (c.skip ? '-' : c.span > 1 ? 'M' : 'B')).join('');
const ALL_B = 'BBBBBBBBBBBBBBBBBB';

test('better ball: a box per player, then ONE row for the team score (the better ball) that carries the totals', () => {
  const lay = teamCardLayout(cardFor(game({ format: 'better_ball_2' })));
  assert.deepEqual(labels(lay), ['a Smith', 'b Smith', 'Team score = better ball (net)', "Marker's score"]);
  assert.ok(lay.rows.every((r) => shape(r) === ALL_B));
  assert.deepEqual(lay.rows.map((r) => r.totals), ['box', 'box', 'box', 'box']);
  assert.deepEqual(lay.parRow, [4, 4, 4, 3, 4, 3, 5, 3, 5, 4, 3, 5, 3, 4, 5, 4, 4, 5]);
  assert.equal(lay.rows[1].cells[15].dots, 2); // hole 16, SI 1: the 20 handicap gets two
});

test('scramble / alternate shot: the players\' boxes join into one team ball box on every hole, then the team score row', () => {
  for (const format of ['scramble_2', 'alt_shot_2']) {
    const lay = teamCardLayout(cardFor(game({ format, handicap_allowance: [35, 15] })));
    assert.deepEqual(labels(lay), ['a Smith', 'b Smith', 'Team score (net)', "Marker's score"], format);
    assert.equal(shape(lay.rows[0]), 'MMMMMMMMMMMMMMMMMM', format);
    assert.equal(shape(lay.rows[1]), '------------------', format); // covered by the box above
    assert.equal(shape(lay.rows[2]), ALL_B, format);
    assert.equal(lay.rows[0].cells[0].span, 2, format);
    assert.equal(lay.rows[0].cells[2].dots, 1, format); // hole 3: the team ball gets a stroke
    assert.deepEqual(lay.rows.map((r) => r.totals), ['hatch', 'hatch', 'box', 'box'], format);
  }
});

test('multi-format: merged team ball boxes on shared holes, a box per player on own-ball holes, one team score row', () => {
  const g = game({
    format: 'composite',
    segments: [
      { holes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], formatType: 'shared', handicapAllowance: { lowPct: 35, highPct: 15 } },
      { holes: [13, 14, 15, 16, 17, 18], formatType: 'individual', handicapPct: 100, countingRule: { scoresCounted: 1, slots: ['net'] } },
    ],
  });
  const lay = teamCardLayout(cardFor(g));
  assert.deepEqual(labels(lay), ['a Smith', 'b Smith', 'Team score (net)', "Marker's score"]);
  assert.equal(shape(lay.rows[0]), 'MMMMMMMMMMMMBBBBBB');
  assert.equal(shape(lay.rows[1]), '------------BBBBBB');
  assert.equal(shape(lay.rows[2]), ALL_B);
  assert.deepEqual(lay.rows.map((r) => r.totals), ['hatch', 'hatch', 'box', 'box']);
  assert.equal(lay.rows[0].cells[2].dots, 1); // team ball dot on hole 3
  assert.deepEqual([lay.rows[0].cells[13].dots, lay.rows[1].cells[13].dots], [1, 1]); // own-ball dots on hole 14
});

test('"both count" holes: the par row doubles and the team score row says both are added', () => {
  const g = game({ format: 'better_ball_2', counting_rule: { scoresCounted: 2, slots: ['net', 'net'] } });
  const lay = teamCardLayout(cardFor(g));
  assert.equal(lay.rows[2].label, 'Team score = both added (net)');
  assert.deepEqual(lay.parRow.slice(0, 3), [8, 8, 8]);
});

test('different counting rules in one own-ball round: "counting score"', () => {
  const g = game({
    format: 'composite',
    segments: [
      { holes: [1, 2, 3, 4, 5, 6, 7, 8, 9], formatType: 'individual', handicapPct: 100, countingRule: { scoresCounted: 1, slots: ['net'] } },
      { holes: [10, 11, 12, 13, 14, 15, 16, 17, 18], formatType: 'individual', handicapPct: 100, countingRule: { scoresCounted: 2, slots: ['net', 'net'] } },
    ],
  });
  assert.equal(teamCardLayout(cardFor(g)).rows[2].label, 'Team score = counting score (net)');
});

test('4-person teams: a row per player; a shared hole is one box spanning all four rows', () => {
  const mk = (g) => buildPrintCards({ ...base, game: g, foursomes: [F1], foursomePlayers: fp(F1, ['a', 'b', 'c', 'd']), ...teamsFor('g', [['a', 'b', 'c', 'd']]) })[0];
  const bb = teamCardLayout(mk(game({ format: 'better_ball_4' })));
  assert.equal(bb.rows.length, 6); // four players + the team score row + the marker's score row
  assert.equal(bb.rows[4].label, 'Team score = better ball (net)');
  const sc = teamCardLayout(mk(game({ format: 'scramble_4', handicap_allowance: [40, 30, 20, 10] })));
  assert.equal(sc.rows[0].cells[0].span, 4);
  assert.equal(shape(sc.rows[3]), '------------------');
});

test("every team card ends with a Marker's score row: a box on every hole plus its own Out / In / Total", () => {
  const games = [
    game({ format: 'better_ball_2' }),
    game({ format: 'scramble_2', handicap_allowance: [35, 15] }),
    game({ format: 'composite', segments: [{ holes: [1, 2, 3, 4, 5, 6, 7, 8, 9], formatType: 'shared', handicapAllowance: { lowPct: 35, highPct: 15 } }, { holes: [10, 11, 12, 13, 14, 15, 16, 17, 18], formatType: 'individual', handicapPct: 100, countingRule: { scoresCounted: 1, slots: ['net'] } }] }),
  ];
  for (const g of games) {
    const rows = teamCardLayout(cardFor(g)).rows;
    const last = rows[rows.length - 1];
    assert.equal(last.label, "Marker's score", g.format);
    assert.equal(shape(last), ALL_B, g.format);
    assert.equal(last.totals, 'box', g.format);
    assert.equal(rows[rows.length - 2].key, 'team', g.format); // right under the Team score row
  }
});

// ---- the handicap rules printed on a team card (a few words each) ----
import { handicapRules } from '../src/lib/printCards.js';

const memA = [P('a', 10), P('b', 20)];

test('better ball: just the % of handicap, with a note only when more than one score counts', () => {
  assert.deepEqual(handicapRules({ game: game({ format: 'better_ball_2', handicap_pct: 90 }), members: memA, fieldOffset: 0 }), ['Better ball 90%']);
  assert.deepEqual(handicapRules({ game: game({ format: 'better_ball_2', handicap_pct: 100, counting_rule: { scoresCounted: 2, slots: ['net', 'net'] } }), members: memA, fieldOffset: 0 }), ['Better ball 100% (both added)']);
  assert.deepEqual(handicapRules({ game: game({ format: 'better_ball_4', handicap_pct: 80, counting_rule: { scoresCounted: 3, slots: ['gross', 'gross', 'net'] } }), members: memA, fieldOffset: 0 }), ['Better ball 80% (best 3 added)']);
});

test('scramble and alternate shot: just the blend (the dots show the strokes)', () => {
  // 10 x 35% + 20 x 15% = 6.5 -> 7
  assert.deepEqual(handicapRules({ game: game({ format: 'scramble_2', handicap_allowance: [35, 15] }), members: memA, fieldOffset: 0 }), ['Scramble 35% low + 15% high']);
  assert.deepEqual(handicapRules({ game: game({ format: 'alt_shot_2', handicap_allowance: [50, 50] }), members: memA, fieldOffset: 0 }), ['Alternate shot 50% low + 50% high']);
  const four = [P('a', 10), P('b', 20), P('c', 4), P('d', 8)];
  assert.match(handicapRules({ game: game({ format: 'scramble_4', handicap_allowance: [40, 30, 20, 10] }), members: four, fieldOffset: 0 })[0], /^Scramble 40\/30\/20\/10%$/);
});

test('multi-format round: one short item per part of the round, in hole order', () => {
  const g = game({
    format: 'composite',
    segments: [
      { holes: [13, 14, 15, 16, 17, 18], formatType: 'individual', label: 'Better Ball (best score counts)', handicapPct: 100, countingRule: { scoresCounted: 1, slots: ['net'] } },
      { holes: [1, 2, 3, 4, 5, 6], formatType: 'shared', label: 'Scramble', handicapAllowance: { lowPct: 35, highPct: 15 } },
      { holes: [7, 8, 9, 10, 11, 12], formatType: 'shared', label: 'Alternate Shot', handicapAllowance: { lowPct: 50, highPct: 50 } },
    ],
  });
  assert.deepEqual(handicapRules({ game: g, members: memA, fieldOffset: 0 }), [
    'Scramble 1–6: 35% low + 15% high',
    'Alternate Shot 7–12: 50% low + 50% high',
    'Better Ball 13–18: 100%',
  ]);
});

test('Field-Relative is one word at the end', () => {
  const rules = handicapRules({ game: game({ format: 'scramble_2', handicap_allowance: [35, 15] }), members: memA, fieldOffset: 4 });
  assert.deepEqual(rules, ['Scramble 35% low + 15% high', 'Field-Relative']);
  assert.deepEqual(handicapRules({ game: game({ format: 'better_ball_2' }), members: memA, fieldOffset: -1 }), ['Better ball 100%', 'Field-Relative']);
});

test('the rules stay short: the longest realistic case (a three-part round with Field-Relative) is one printed line', () => {
  const g = game({
    format: 'composite',
    segments: [
      { holes: [1, 2, 3, 4, 5, 6], formatType: 'shared', label: 'Scramble', handicapAllowance: { lowPct: 35, highPct: 15 } },
      { holes: [7, 8, 9, 10, 11, 12], formatType: 'shared', label: 'Alternate Shot', handicapAllowance: { lowPct: 50, highPct: 50 } },
      { holes: [13, 14, 15, 16, 17, 18], formatType: 'individual', label: 'Total Score (both count, added together)', handicapPct: 100, countingRule: { scoresCounted: 2, slots: ['net', 'net'] } },
    ],
  });
  const text = handicapRules({ game: g, members: memA, fieldOffset: 4 }).join('  •  ');
  assert.ok(text.length < 170, text + ' (' + text.length + ' characters: more than one printed line)');
});

test('no game, or an individual game: no rules to print', () => {
  assert.deepEqual(handicapRules({ game: null, members: memA, fieldOffset: 0 }), []);
  assert.deepEqual(handicapRules({ game: game({ format: 'individual_net' }), members: memA, fieldOffset: 0 }), []);
});

// ---- the game's name in a shared team box ----
test('a shared team box carries the game\'s short name: Scramble or Alt Shot (and "Team ball" if it has no name)', () => {
  const tagsOf = (g) => teamCardLayout(cardFor(g)).rows[0].cells.map((c) => c.tag || null);
  assert.deepEqual(tagsOf(game({ format: 'scramble_2', handicap_allowance: [35, 15] })), Array(18).fill('Scramble'));
  assert.deepEqual(tagsOf(game({ format: 'alt_shot_2', handicap_allowance: [35, 15] })), Array(18).fill('Alt Shot'));
  assert.deepEqual(tagsOf(game({ format: 'scramble_4', handicap_allowance: [40, 30, 20, 10] })).slice(0, 2), ['Scramble', 'Scramble']);
});

test('multi-format: each stretch of shared holes is named for its own game; own-ball holes have no team box', () => {
  const g = game({
    format: 'composite',
    segments: [
      { holes: [1, 2, 3, 4, 5, 6], formatType: 'shared', label: 'Scramble', handicapAllowance: { lowPct: 35, highPct: 15 } },
      { holes: [7, 8, 9, 10, 11, 12], formatType: 'shared', label: 'Alternate Shot', handicapAllowance: { lowPct: 50, highPct: 50 } },
      { holes: [13, 14, 15, 16, 17, 18], formatType: 'individual', label: 'Better Ball (best score counts)', handicapPct: 100, countingRule: { scoresCounted: 1, slots: ['net'] } },
    ],
  });
  const cells = teamCardLayout(cardFor(g)).rows[0].cells;
  assert.deepEqual(cells.map((c) => (c.span > 1 ? c.tag : '-')), [...Array(6).fill('Scramble'), ...Array(6).fill('Alt Shot'), ...Array(6).fill('-')]);
  // a segment label that has extra words after the name is cut back to the name
  const g2 = game({ format: 'composite', segments: [{ holes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18], formatType: 'shared', label: 'Scramble (35/15)', handicapAllowance: { lowPct: 35, highPct: 15 } }] });
  assert.equal(teamCardLayout(cardFor(g2)).rows[0].cells[0].tag, 'Scramble');
});

test('better ball cards have no team box and so no game label', () => {
  const lay = teamCardLayout(cardFor(game({ format: 'better_ball_2' })));
  assert.ok(lay.rows.every((r) => r.cells.every((c) => !c.tag)));
});
