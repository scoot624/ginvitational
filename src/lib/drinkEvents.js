// Broadcast cards for Drinking Mode. Pure, like broadcastEngine: it is handed the data already loaded and returns
// candidate events { kind, text, dedupe[], playerId } in the same shape, which then go through planPosts.
//
// Live (as the round goes): drink logged, first drink of the field, hit the minimum, behind pace, reached the max,
//   drink leader, busiest hole, drink-to-birdie. At most one card per player per check; a card never repeats
//   (its key is saved with it), and nothing older than 45 minutes is announced, so an old round stays quiet.
// End of round only: the "drink report" (stats on raw net-to-par, with sample-size rules), once every player
//   in the field has finished 18.
//
// Tone: playful and observational. Nothing here rewards drinking more, and nobody is shamed for drinking less.

import { LIVE_MS, RARE_MS, isDrinkKind, pickVariant, safeDedupeKey, shortName } from "./broadcastEngine.js";
import { drinkProgress, drinksForRound, sortDrinks } from "./drinks.js";
import { afterNthDrink, bestWorstDrinkHole, drinkVsDry, fieldDoesItHelp, fieldDrinkVsDry } from "./drinkStats.js";

const BEHIND_COOLDOWN_MS = 60 * 60 * 1000; // a "behind pace" nudge for the same player, at most hourly
const BEHIND_FROM_HOLE = 6; // not before six holes: earlier than that the pace is just noise
const LEADER_MIN_DRINKS = 3; // nobody is "the drink leader" before 3 drinks, and never in a tie
const BUSY_HOLE_AT = [8, 4]; // a hole is announced as the busiest at 4 drinks, and again at 8
const REPORT_MIN_IMPROVEMENT = 0.5; // strokes per hole before a "played better after drink N" highlight is worth saying
const REPORT_MIN_GAP = 0.75; // ...and for a personal "better on drink holes / dry holes" highlight

export { isDrinkKind };

/** ---------- Copy ---------- (n = short name) */
export const DRINK_COPY = {
  logged: [
    ({ n, count, hole }) => `${n} logged drink #${count} on #${hole}.`,
    ({ n, count, hole }) => `Drink #${count} for ${n}, on hole ${hole}.`,
    ({ n, count, hole }) => `${n} is on drink #${count} after hole ${hole}.`,
    ({ n, count, hole }) => `Hole ${hole}: ${n} logs drink #${count}.`,
    ({ n, count, hole }) => `${n}, drink #${count}, hole ${hole}. The scorekeeper noted it.`,
  ],
  loggedFirst: [
    ({ n, hole }) => `${n} is on the board: drink #1 on #${hole}.`,
    ({ n, hole }) => `First drink for ${n}, logged on hole ${hole}.`,
    ({ n, hole }) => `${n} gets the first drink of their round going on #${hole}.`,
    ({ n, hole }) => `${n} cracks one open on #${hole}. On the board.`,
  ],
  firstField: [
    ({ n, hole }) => `${n} gets the first drink of the day on #${hole}. The bar is officially open.`,
    ({ n, hole }) => `First drink of the field: ${n}, hole ${hole}.`,
    ({ n, hole }) => `${n} breaks the seal on #${hole}. First drink of the day.`,
    ({ n, hole }) => `And we're off: ${n} logs the field's first drink on #${hole}.`,
  ],
  minHit: [
    ({ n, min }) => `${n} has hit the minimum: ${min} drinks. Mission accomplished.`,
    ({ n, min }) => `${min} down for ${n}. Minimum met, no further requirements.`,
    ({ n, min }) => `${n} reached ${min} drinks. Quota filled.`,
    ({ n, min }) => `Box checked: ${n} is at ${min} drinks.`,
  ],
  maxHit: [
    ({ n, max }) => `${n} has used all ${max} drink credits. That's the maximum.`,
    ({ n, max }) => `${n} is at the cap: ${max} drinks. The credit stops here.`,
    ({ n, max }) => `That's ${max} for ${n}, and the credit stops there.`,
    ({ n, max }) => `${n} hits the credit cap: ${max} drinks.`,
  ],
  behind: [
    ({ n, count, min, holes }) => `${n} is behind pace: ${count} of ${min} drinks through ${holes}.`,
    ({ n, count, min, holes }) => `Pace check for ${n}: ${count} of ${min} drinks through ${holes}.`,
    ({ n, count, min, holes }) => `${n} has ${count} of ${min} through ${holes} holes. Plenty of time to catch up.`,
    ({ n, count, min, left }) => `${n} is at ${count} of ${min} with ${left} to play.`,
  ],
  leader: [
    ({ n, count }) => `${n} leads the drink count with ${count}.`,
    ({ n, count }) => `New drink leader: ${n}, at ${count}.`,
    ({ n, count }) => `${n} takes over the drink lead at ${count}.`,
    ({ n, count }) => `The drink count has a new leader: ${n} with ${count}.`,
  ],
  busyHole: [
    ({ hole, total }) => `Hole ${hole} is the busiest on the drink count: ${total} so far.`,
    ({ hole, total }) => `${total} drinks logged on #${hole} so far, the most of any hole.`,
    ({ hole, total }) => `#${hole} is where the drinks are: ${total} logged there.`,
    ({ hole, total }) => `Most popular hole for a drink: #${hole}, ${total} so far.`,
  ],
  birdieSame: [
    ({ n, hole }) => `Drink-to-birdie: ${n} had a drink and made birdie on #${hole}.`,
    ({ n, hole }) => `${n} had a drink, then birdied #${hole}. Correlation noted.`,
    ({ n, hole }) => `A drink and a birdie on #${hole} for ${n}. Coincidence? Probably.`,
  ],
  birdieNext: [
    ({ n, hole, prev }) => `Drink on #${prev}, birdie on #${hole}: ${n} with the drink-to-birdie.`,
    ({ n, hole, prev }) => `${n} followed a drink on #${prev} with a birdie on #${hole}.`,
    ({ n, hole, prev }) => `Drink-to-birdie for ${n}: #${prev}, then #${hole}. Science!`,
  ],
};

const baseKind = (kind) => String(kind || "").replace(/^hidden_/, "");
const when = (d) => new Date(d.created_at).getTime();
const fmt = (x) => (Math.abs(x) < 0.005 ? "0.00" : `${x > 0 ? "+" : "-"}${Math.abs(x).toFixed(2)}`);
const strokesWord = (x) => `${Math.abs(x).toFixed(2)} ${Math.abs(x).toFixed(2) === "1.00" ? "stroke" : "strokes"}`;
const vsWord = (vs) => (vs === -1 ? "a net birdie" : vs === -2 ? "a net eagle" : vs < -2 ? `net ${vs}` : vs === 0 ? "net par" : `net +${vs}`);

/**
 * ctx:
 *   now, roundId, drinking (settings in force), drinks (any rounds; the round is picked here), pars[18]
 *   rows[]   { id, name, holesPlayed, gross:{h}, rawVsPar:{h}, startHole }  rawVsPar = net-to-par WITHOUT any credit
 *   scoreTimes{ "playerId|hole": ms }   for the active round
 *   fieldIds  Set of player ids playing this round
 *   messages[]  saved log, newest first: { id, kind, player_id, dedupe_key, created_at }
 */
export function computeDrinkEvents(ctx) {
  const { now, roundId, drinking, rows, pars, scoreTimes, fieldIds, messages } = ctx;
  if (!drinking?.enabled || !roundId) return [];
  const mine = sortDrinks(drinksForRound(ctx.drinks, roundId));
  if (mine.length === 0) return [];

  const rowById = new Map(rows.map((r) => [r.id, r]));
  const nm = (id) => shortName(rowById.get(id)?.name || "Someone");
  const keysSeen = new Set(messages.map((m) => m.dedupe_key));
  const isNew = (key) => !keysSeen.has(safeDedupeKey(key));
  const sentBefore = (kind) => messages.filter((m) => baseKind(m.kind) === kind).length;
  const text = (copy, kind, key, vars) => pickVariant(copy, safeDedupeKey(key), sentBefore(kind))(vars);
  const fresh = (ms) => now - ms <= LIVE_MS;
  const roundStartMs = when(mine[0]) - 60_000;
  const log = messages.filter((m) => new Date(m.created_at).getTime() >= roundStartMs);

  // Per player: their drinks (oldest first) and how many are on each hole.
  const byPlayer = new Map();
  for (const d of mine) {
    if (!byPlayer.has(d.player_id)) byPlayer.set(d.player_id, []);
    byPlayer.get(d.player_id).push(d);
  }
  const holeCounts = (pid) => {
    const m = {};
    for (const d of byPlayer.get(pid) || []) m[d.hole] = (m[d.hole] || 0) + 1;
    return m;
  };

  // Everyone's candidate cards this check, best first; only the first one per player is kept.
  const perPlayer = new Map();
  const offer = (pid, e) => {
    if (!perPlayer.has(pid)) perPlayer.set(pid, []);
    perPlayer.get(pid).push(e);
  };
  const card = (kind, pid, key, t) => ({ kind, text: t, dedupe: key, playerId: pid });

  // ----- drink-to-birdie: a birdie on the drink hole, or on the next hole the group plays -----
  for (const r of rows) {
    if (!byPlayer.has(r.id)) continue;
    const counts = holeCounts(r.id);
    const start = Math.min(18, Math.max(1, Number(r.startHole) || 1));
    let pick = null;
    for (const [hStr, gross] of Object.entries(r.gross || {})) {
      const h = Number(hStr);
      const t = scoreTimes[`${r.id}|${h}`];
      if (t == null || !fresh(t)) continue;
      if (gross === 1 || gross > pars[h - 1] - 1) continue; // an ace has its own card; only birdies or better
      const prev = h === start ? null : ((h - 2 + 18) % 18) + 1;
      const same = counts[h] > 0;
      const afterPrev = prev != null && counts[prev] > 0;
      if (!same && !afterPrev) continue;
      const key = ["drink_birdie", r.id, roundId, h];
      if (!isNew(key)) continue;
      if (!pick || t > pick.t) pick = { t, h, prev, same, key };
    }
    if (pick) {
      const vars = { n: nm(r.id), hole: pick.h, prev: pick.prev };
      offer(r.id, card("drink_birdie", r.id, pick.key, text(pick.same ? DRINK_COPY.birdieSame : DRINK_COPY.birdieNext, "drink_birdie", pick.key, vars)));
    }
  }

  // ----- the milestones and the plain "logged" card, per player -----
  const counts = new Map([...byPlayer].map(([pid, ds]) => [pid, ds.length]));
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  const soleLeader = ranked.length && ranked[0][1] >= LEADER_MIN_DRINKS && (ranked.length === 1 || ranked[1][1] < ranked[0][1]) ? ranked[0][0] : null;
  const lastLeaderMsg = log.find((m) => baseKind(m.kind) === "drink_leader");

  for (const [pid, ds] of byPlayer) {
    const count = ds.length;
    const last = ds[ds.length - 1];
    const n = nm(pid);

    if (drinking.variant !== "credit" && count >= drinking.minDrinks && fresh(when(ds[drinking.minDrinks - 1]))) {
      const key = ["drink_min", pid, roundId];
      if (isNew(key)) offer(pid, card("drink_min", pid, key, text(DRINK_COPY.minHit, "drink_min", key, { n, min: drinking.minDrinks })));
    }
    if (drinking.variant === "credit" && count >= drinking.maxDrinks && fresh(when(ds[drinking.maxDrinks - 1]))) {
      const key = ["drink_max", pid, roundId];
      if (isNew(key)) offer(pid, card("drink_max", pid, key, text(DRINK_COPY.maxHit, "drink_max", key, { n, max: drinking.maxDrinks })));
    }
    if (pid === soleLeader && fresh(when(last)) && (!lastLeaderMsg || lastLeaderMsg.player_id !== pid)) {
      const key = ["drink_leader", roundId, pid, lastLeaderMsg ? lastLeaderMsg.id : "first"];
      if (isNew(key)) offer(pid, card("drink_leader", pid, key, text(DRINK_COPY.leader, "drink_leader", key, { n, count })));
    }
    // The field's first drink gets its own card (only while it is still that player's first, so a missed card never
    // turns into a late one), and that card also stands in for their plain "#1" card.
    const firstOfField = mine[0].player_id === pid;
    if (firstOfField && count === 1 && fresh(when(mine[0]))) {
      const key = ["drink_first_field", roundId];
      if (isNew(key)) offer(pid, card("drink_first", pid, key, text(DRINK_COPY.firstField, "drink_first", key, { n, hole: mine[0].hole })));
    }
    if (fresh(when(last)) && !(firstOfField && count === 1)) {
      const key = ["drink", pid, roundId, count];
      if (isNew(key)) {
        offer(pid, card("drink_logged", pid, key, text(count === 1 ? DRINK_COPY.loggedFirst : DRINK_COPY.logged, "drink_logged", key, { n, count, hole: last.hole })));
      }
    }
  }

  // ----- Minimum Drinks: running behind pace (hourly at most per player) -----
  if (drinking.variant !== "credit") {
    for (const r of rows) {
      if (r.holesPlayed < BEHIND_FROM_HOLE || r.holesPlayed >= 18) continue;
      const count = counts.get(r.id) || 0;
      if (drinkProgress(count, r.holesPlayed, drinking).status !== "behind") continue;
      const newest = Math.max(0, ...Object.keys(r.gross || {}).map((h) => scoreTimes[`${r.id}|${h}`] || 0));
      if (!fresh(newest)) continue;
      if (messages.some((m) => baseKind(m.kind) === "drink_behind" && m.player_id === r.id && now - new Date(m.created_at).getTime() < BEHIND_COOLDOWN_MS)) continue;
      const key = ["drink_behind", r.id, roundId, r.holesPlayed];
      if (!isNew(key)) continue;
      offer(r.id, card("drink_behind", r.id, key, text(DRINK_COPY.behind, "drink_behind", key, { n: nm(r.id), count, min: drinking.minDrinks, holes: r.holesPlayed, left: 18 - r.holesPlayed })));
    }
  }

  const events = [];
  for (const list of perPlayer.values()) events.push(list[0]); // list is already best-first

  // ----- the busiest hole (field-wide), announced at 4 and 8 drinks -----
  const totals = {};
  const newestOn = {};
  for (const d of mine) {
    totals[d.hole] = (totals[d.hole] || 0) + 1;
    newestOn[d.hole] = Math.max(newestOn[d.hole] || 0, when(d));
  }
  const holesByTotal = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  if (holesByTotal.length && (holesByTotal.length === 1 || holesByTotal[1][1] < holesByTotal[0][1])) {
    const hole = Number(holesByTotal[0][0]);
    const total = holesByTotal[0][1];
    const at = BUSY_HOLE_AT.find((t) => total >= t);
    if (at && fresh(newestOn[hole])) {
      const key = ["drink_hole", roundId, hole, at];
      if (isNew(key)) events.push(card("drink_hole", null, key, text(DRINK_COPY.busyHole, "drink_hole", key, { hole, total })));
    }
  }

  // ----- the end-of-round drink report -----
  const times = Object.values(scoreTimes);
  const lastScoreMs = times.length ? Math.max(...times) : 0;
  if (now - lastScoreMs <= RARE_MS && fieldIds && fieldIds.size > 0) {
    const field = rows.filter((r) => fieldIds.has(r.id));
    if (field.length > 0 && field.every((r) => r.holesPlayed >= 18)) events.push(...drinkReport({ roundId, field, byPlayer, holeCounts, nm, isNew }));
  }

  return events;
}

/** The end-of-round report: up to two cards (the field, then individual highlights). Quiet when the samples are too small. */
function drinkReport({ roundId, field, byPlayer, holeCounts, nm, isNew }) {
  const stats = field.map((r) => ({ id: r.id, startHole: r.startHole, rawVsPar: r.rawVsPar || {}, drinksByHole: holeCounts(r.id), drinks: byPlayer.get(r.id) || [] }));
  const out = [];

  // The field
  const lines = [];
  const vsDry = fieldDrinkVsDry(stats);
  if (vsDry.ok) {
    const verdict = Math.abs(vsDry.diff) < 0.1 ? "Basically a wash." : vsDry.diff < 0 ? `Drink holes came out ${strokesWord(vsDry.diff)} better.` : `Dry holes came out ${strokesWord(vsDry.diff)} better.`;
    lines.push(`Drink report: across ${vsDry.players} players, holes with a drink averaged ${fmt(vsDry.drinkAvg)} to par and dry holes ${fmt(vsDry.dryAvg)}. ${verdict}`);
  }
  const help = fieldDoesItHelp(stats);
  if (help.ok) {
    const verdict = Math.abs(help.diff) < 0.1 ? "No real difference." : help.diff < 0 ? "Slightly better with more." : "Slightly worse with more.";
    lines.push(`Two or more drinks on a hole: ${fmt(help.manyAvg)} vs ${fmt(help.fewAvg)} with none or one (${help.players} players). ${verdict} Fun with numbers, not advice.`);
  }
  const keyField = ["drinkreport", "field", roundId];
  if (lines.length && isNew(keyField)) out.push({ kind: "drinkreport", text: lines.join("  •  "), dedupe: keyField, playerId: null });

  // Individual highlights (each needs enough holes in both buckets, so a lucky hole or two never counts)
  const hi = [];
  let best = null;
  let worst = null;
  let improver = null;
  let gap = null;
  for (const p of stats) {
    const bw = bestWorstDrinkHole(p.rawVsPar, p.drinksByHole);
    if (bw && drinkVsDry(p.rawVsPar, p.drinksByHole).ok) {
      if (!best || bw.best.vs < best.vs) best = { id: p.id, ...bw.best };
      if (!worst || bw.worst.vs > worst.vs) worst = { id: p.id, ...bw.worst };
    }
    for (const n of [1, 2, 3]) {
      const a = afterNthDrink(p.rawVsPar, p.drinks, p.startHole, n);
      if (a.ok && -a.diff >= REPORT_MIN_IMPROVEMENT && (!improver || -a.diff > -improver.diff)) improver = { id: p.id, ...a };
    }
    const d = drinkVsDry(p.rawVsPar, p.drinksByHole);
    if (d.ok && Math.abs(d.diff) >= REPORT_MIN_GAP && (!gap || Math.abs(d.diff) > Math.abs(gap.diff))) gap = { id: p.id, ...d };
  }
  if (best && best.vs <= -1) hi.push(`Best drink hole: ${nm(best.id)}, ${vsWord(best.vs)} on #${best.hole}.`);
  if (worst && worst.vs >= 2) hi.push(`Roughest drink hole: ${nm(worst.id)}, ${vsWord(worst.vs)} on #${worst.hole}.`);
  if (improver) hi.push(`${nm(improver.id)} played ${fmt(improver.beforeAvg)} per hole before drink #${improver.n} and ${fmt(improver.afterAvg)} from it on.`);
  if (gap) {
    hi.push(
      gap.diff < 0
        ? `${nm(gap.id)} scored ${strokesWord(gap.diff)} better per hole on drink holes (${fmt(gap.drinkAvg)} vs ${fmt(gap.dryAvg)} dry).`
        : `${nm(gap.id)} scored ${strokesWord(gap.diff)} better per hole on dry holes (${fmt(gap.dryAvg)} vs ${fmt(gap.drinkAvg)} with a drink).`
    );
  }
  const keyHi = ["drinkreport", "highlights", roundId];
  if (hi.length && isNew(keyHi)) out.push({ kind: "drinkreport", text: hi.join("  •  "), dedupe: keyHi, playerId: null });
  return out;
}

