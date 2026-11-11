// Drinking Mode statistics for the end-of-round "drink report". Pure functions, no React.
//
// Everything here works on RAW net-to-par per hole (net score minus par, with handicap strokes but WITHOUT any
// Stroke Credit), so a drink never "explains" its own number. Holes with no score are ignored.
//
// Sample-size rules, so a couple of lucky holes never become a headline:
//   - a player needs at least MIN_BUCKET_HOLES holes in EACH bucket being compared
//   - a field comparison needs at least MIN_FIELD_PLAYERS players who qualify

export const MIN_BUCKET_HOLES = 3;
export const MIN_FIELD_PLAYERS = 10;

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const avg = (xs) => (xs.length ? sum(xs) / xs.length : null);

/** Scored holes as [{ hole, vs, drinks }] (vs = raw net-to-par, drinks = how many were logged there). */
function scoredHoles(rawVsPar, drinksByHole) {
  return Object.entries(rawVsPar || {})
    .filter(([, vs]) => vs != null)
    .map(([h, vs]) => ({ hole: Number(h), vs, drinks: (drinksByHole && drinksByHole[h]) || 0 }));
}

/** A player's holes with a drink vs holes without one. `ok` only with enough holes in both buckets. */
export function drinkVsDry(rawVsPar, drinksByHole) {
  const holes = scoredHoles(rawVsPar, drinksByHole);
  const drink = holes.filter((x) => x.drinks > 0);
  const dry = holes.filter((x) => x.drinks === 0);
  const drinkAvg = avg(drink.map((x) => x.vs));
  const dryAvg = avg(dry.map((x) => x.vs));
  const ok = drink.length >= MIN_BUCKET_HOLES && dry.length >= MIN_BUCKET_HOLES;
  return { drinkHoles: drink.length, dryHoles: dry.length, drinkAvg, dryAvg, diff: ok ? drinkAvg - dryAvg : null, ok };
}

/**
 * How a player played before vs from their Nth drink on. The hole of the Nth drink counts as the first "after" hole;
 * holes follow the group's play order (a group that starts on 10 plays 10...18 then 1...9).
 * `drinks` is that player's drinks in the round (any order), `n` is 1, 2 or 3.
 */
export function afterNthDrink(rawVsPar, drinks, startHole, n) {
  const sorted = [...(drinks || [])].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id)));
  const nth = sorted[n - 1];
  if (!nth) return { ok: false, reason: "fewer drinks" };
  const start = Math.min(18, Math.max(1, Number(startHole) || 1));
  const pos = (h) => (((h - start) % 18) + 18) % 18;
  const at = pos(nth.hole);
  const holes = scoredHoles(rawVsPar, null);
  const before = holes.filter((x) => pos(x.hole) < at).map((x) => x.vs);
  const after = holes.filter((x) => pos(x.hole) >= at).map((x) => x.vs);
  const ok = before.length >= MIN_BUCKET_HOLES && after.length >= MIN_BUCKET_HOLES;
  const beforeAvg = avg(before);
  const afterAvg = avg(after);
  return { ok, n, hole: nth.hole, beforeHoles: before.length, afterHoles: after.length, beforeAvg, afterAvg, diff: ok ? afterAvg - beforeAvg : null };
}

/** The best and the worst hole (raw net-to-par) among the holes where this player had a drink. */
export function bestWorstDrinkHole(rawVsPar, drinksByHole) {
  const drink = scoredHoles(rawVsPar, drinksByHole).filter((x) => x.drinks > 0);
  if (drink.length === 0) return null;
  const best = drink.reduce((a, b) => (b.vs < a.vs || (b.vs === a.vs && b.hole < a.hole) ? b : a));
  const worst = drink.reduce((a, b) => (b.vs > a.vs || (b.vs === a.vs && b.hole < a.hole) ? b : a));
  return { best: { hole: best.hole, vs: best.vs }, worst: { hole: worst.hole, vs: worst.vs }, holes: drink.length };
}

/**
 * Field comparison: holes with a drink vs dry holes, pooled over every player who has enough holes in both buckets.
 * `players` = [{ rawVsPar, drinksByHole }]. `ok` needs MIN_FIELD_PLAYERS qualifying players.
 */
export function fieldDrinkVsDry(players) {
  const drinkVs = [];
  const dryVs = [];
  let qualifying = 0;
  for (const p of players || []) {
    const r = drinkVsDry(p.rawVsPar, p.drinksByHole);
    if (!r.ok) continue;
    qualifying += 1;
    for (const x of scoredHoles(p.rawVsPar, p.drinksByHole)) (x.drinks > 0 ? drinkVs : dryVs).push(x.vs);
  }
  const ok = qualifying >= MIN_FIELD_PLAYERS;
  const drinkAvg = avg(drinkVs);
  const dryAvg = avg(dryVs);
  return { ok, players: qualifying, drinkAvg, dryAvg, diff: ok ? drinkAvg - dryAvg : null };
}

/**
 * "Does it help?": holes with 2 or more drinks vs holes with 0 or 1, pooled over players with at least
 * MIN_BUCKET_HOLES holes in each bucket. `ok` needs MIN_FIELD_PLAYERS qualifying players.
 */
export function fieldDoesItHelp(players) {
  const many = [];
  const few = [];
  let qualifying = 0;
  for (const p of players || []) {
    const holes = scoredHoles(p.rawVsPar, p.drinksByHole);
    const m = holes.filter((x) => x.drinks >= 2);
    const f = holes.filter((x) => x.drinks <= 1);
    if (m.length < MIN_BUCKET_HOLES || f.length < MIN_BUCKET_HOLES) continue;
    qualifying += 1;
    for (const x of m) many.push(x.vs);
    for (const x of f) few.push(x.vs);
  }
  const ok = qualifying >= MIN_FIELD_PLAYERS;
  const manyAvg = avg(many);
  const fewAvg = avg(few);
  return { ok, players: qualifying, manyAvg, fewAvg, diff: ok ? manyAvg - fewAvg : null };
}
