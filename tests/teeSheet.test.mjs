import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatTeeTime,
  groupSizes,
  addMinutesToTime,
  shotgunHole,
  buildPhoneGroups,
  phoneDraftToSheetRows,
  phoneSlot,
  excelTimeToDbTime,
  fullNameFromRow,
  normKey,
} from '../src/lib/teeSheet.js';

test('formatTeeTime: database time -> "1:12 PM"', () => {
  assert.equal(formatTeeTime('13:12:00'), '1:12 PM');
  assert.equal(formatTeeTime('00:05:00'), '12:05 AM');
  assert.equal(formatTeeTime('12:00:00'), '12:00 PM');
  assert.equal(formatTeeTime('09:30'), '9:30 AM');
  assert.equal(formatTeeTime(null), '');
  assert.equal(formatTeeTime('soon'), 'soon');
});

test('groupSizes spreads players evenly, never leaving a lone player when avoidable', () => {
  assert.deepEqual(groupSizes(9, 4), [3, 3, 3]);
  assert.deepEqual(groupSizes(5, 4), [3, 2]);
  assert.deepEqual(groupSizes(8, 4), [4, 4]);
  assert.deepEqual(groupSizes(0, 4), []);
  for (let n = 1; n <= 45; n++) {
    for (const size of [2, 3, 4]) {
      const s = groupSizes(n, size);
      assert.equal(s.reduce((a, b) => a + b, 0), n);
      assert.ok(Math.max(...s) <= size);
      assert.ok(Math.max(...s) - Math.min(...s) <= 1);
    }
  }
});

test('addMinutesToTime rolls over noon and midnight and rejects junk', () => {
  assert.equal(addMinutesToTime('11:50', 15), '12:05');
  assert.equal(addMinutesToTime('23:50', 15), '00:05');
  assert.equal(addMinutesToTime('09:00', 0), '09:00');
  assert.equal(addMinutesToTime('x', 5), '');
  assert.equal(addMinutesToTime('25:00', 5), '');
});

test('shotgunHole spreads groups across the course', () => {
  assert.deepEqual(Array.from({ length: 11 }, (_, i) => shotgunHole(i, 11)), [1, 2, 4, 5, 7, 9, 10, 12, 14, 15, 17]);
  assert.deepEqual([0, 1, 2, 3].map((i) => shotgunHole(i, 4)), [1, 5, 10, 14]);
  assert.equal(shotgunHole(0, 1), 1);
  for (let i = 0; i < 30; i++) {
    const h = shotgunHole(i, 30);
    assert.ok(h >= 1 && h <= 18);
  }
});

test('buildPhoneGroups: times step by the gap; shotgun shares one time and spreads the holes', () => {
  const players = Array.from({ length: 9 }, (_, i) => ({ id: 'p' + i }));
  const g = buildPhoneGroups(players, { size: 4, firstTee: '11:50', gapMin: 10, shotgun: false });
  assert.deepEqual(g.map((x) => [x.name, x.teeTime, x.startingHole, x.playerIds.length]), [
    ['Group 1', '11:50', 1, 3],
    ['Group 2', '12:00', 1, 3],
    ['Group 3', '12:10', 1, 3],
  ]);
  const s = buildPhoneGroups(players, { size: 4, firstTee: '08:00', gapMin: 10, shotgun: true });
  assert.deepEqual(s.map((x) => x.teeTime), ['08:00', '08:00', '08:00']);
  assert.deepEqual(s.map((x) => x.startingHole), [1, 7, 13]);
  assert.deepEqual(phoneSlot({ firstTee: '08:00', gapMin: 15, shotgun: false }, 2, 5), { teeTime: '08:30', startingHole: 1 });
});

test('phone draft -> the same row shape the Excel sheet produces, round-tripping through the import helpers', () => {
  const players = [
    { id: 'a', name: 'Anna Ames', handicap: -2, charity: 'ZZ Charity' },
    { id: 'b', name: 'Ben Bell', handicap: 8, charity: '' },
  ];
  const groups = [
    { name: 'Group 1', teeTime: '11:50', startingHole: 1, playerIds: ['a', 'b'] },
    { name: 'Empty', teeTime: '12:00', startingHole: 2, playerIds: [] },
  ];
  const rows = phoneDraftToSheetRows(players, groups);
  assert.equal(rows.length, 2); // empty groups are skipped
  assert.deepEqual(rows[0], { team: 'Group 1', tee_time: '11:50', starting_hole: 1, first_name: 'Anna Ames', last_name: '', handicap: -2, charity: 'ZZ Charity' });
  assert.equal(excelTimeToDbTime(rows[0].tee_time), '11:50:00');
  assert.equal(fullNameFromRow(rows[0]), 'Anna Ames');
});

test('excelTimeToDbTime: Excel fractions, dates, "HH:MM" and "9:00 AM" text', () => {
  assert.equal(excelTimeToDbTime(0.375), '09:00:00');
  assert.equal(excelTimeToDbTime(0.4027777777), '09:40:00');
  assert.equal(excelTimeToDbTime('09:30'), '09:30:00');
  assert.equal(excelTimeToDbTime('9:05'), '09:05:00');
  assert.equal(excelTimeToDbTime('9:00 AM'), '09:00:00');
  assert.equal(excelTimeToDbTime('1:12 PM'), '13:12:00');
  assert.equal(excelTimeToDbTime(new Date(2026, 0, 1, 14, 5)), '14:05:00');
  assert.equal(excelTimeToDbTime(''), null);
  assert.equal(excelTimeToDbTime(null), null);
  assert.equal(excelTimeToDbTime('not a time'), null);
});

test('fullNameFromRow joins and tidies first + last name', () => {
  assert.equal(fullNameFromRow({ first_name: ' Anna ', last_name: ' Ames ' }), 'Anna Ames');
  assert.equal(fullNameFromRow({ first_name: 'Cher', last_name: '' }), 'Cher');
  assert.equal(fullNameFromRow({}), '');
  assert.equal(fullNameFromRow({ first_name: 'Mary  Jo', last_name: 'Van  Dyke' }), 'Mary Jo Van Dyke');
});

test('normKey makes Excel headings comparable', () => {
  assert.equal(normKey('First Name'), 'first_name');
  assert.equal(normKey('  Tee  Time '), 'tee_time');
  assert.equal(normKey('HANDICAP'), 'handicap');
  assert.equal(normKey(null), '');
});
