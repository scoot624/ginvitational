import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAllRows } from '../src/lib/paging.js';

// A stand-in for a Supabase query that holds `total` rows and honours .range(from, to) like the real API,
// including its cap of `cap` rows per request.
function fakeTable(total, cap = 1000) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  const calls = [];
  const build = () => ({
    range(from, to) {
      calls.push([from, to]);
      const slice = rows.slice(from, Math.min(to, from + cap - 1) + 1);
      return Promise.resolve({ data: slice, error: null });
    },
  });
  return { build, calls };
}

test('loads every row when the table is bigger than one page', async () => {
  const t = fakeTable(2500);
  const { data, error } = await fetchAllRows(t.build);
  assert.equal(error, null);
  assert.equal(data.length, 2500);
  assert.deepEqual(data.map((r) => r.id).slice(998, 1002), [998, 999, 1000, 1001]);
  assert.equal(new Set(data.map((r) => r.id)).size, 2500, 'no duplicates or gaps');
  assert.deepEqual(t.calls, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test('an exact multiple of the page size still ends cleanly', async () => {
  const t = fakeTable(2000);
  const { data } = await fetchAllRows(t.build);
  assert.equal(data.length, 2000);
  assert.equal(t.calls.length, 3); // the third (empty) page is what proves the end
});

test('a small table takes one request', async () => {
  const t = fakeTable(792);
  const { data } = await fetchAllRows(t.build);
  assert.equal(data.length, 792);
  assert.equal(t.calls.length, 1);
});

test('an empty table returns an empty list, and an error is passed through', async () => {
  assert.deepEqual((await fetchAllRows(fakeTable(0).build)).data, []);
  const failing = () => ({ range: () => Promise.resolve({ data: null, error: { message: 'boom' } }) });
  const res = await fetchAllRows(failing);
  assert.equal(res.data, null);
  assert.equal(res.error.message, 'boom');
});

test('stops asking after an error on a later page', async () => {
  let n = 0;
  const flaky = () => ({
    range: () => {
      n += 1;
      return Promise.resolve(n === 1 ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null } : { data: null, error: { message: 'offline' } });
    },
  });
  const res = await fetchAllRows(flaky);
  assert.equal(res.data, null);
  assert.equal(res.error.message, 'offline');
  assert.equal(n, 2);
});
