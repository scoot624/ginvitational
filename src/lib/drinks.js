// Drinking Mode logic: settings, counting drinks, the Stroke Credit map, and Minimum Drinks progress.
// Pure functions — no React, no network — tested in tests/drinks.test.mjs.
//
// Two variants (Admin picks one; with the mode off none of this changes anything):
//   "min"    Minimum Drinks: each player should reach `minDrinks` by the end of the round. A flag only.
//   "credit" Stroke Credit: each logged drink removes `creditPerDrink` strokes from that hole's NET score,
//            for at most `maxDrinks` drinks per player per round. Gross is never touched.

import { clampInt } from "./golf.js";

export const DRINKING_DEFAULTS = { enabled: false, variant: "min", minDrinks: 4, creditPerDrink: 1, maxDrinks: 3 };

/** Settings from the database (or nothing), filled in with defaults and kept to sensible whole numbers. */
export function normalizeDrinking(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    enabled: r.enabled === true,
    variant: r.variant === "credit" ? "credit" : "min",
    minDrinks: Math.min(99, Math.max(0, clampInt(r.minDrinks, DRINKING_DEFAULTS.minDrinks))),
    creditPerDrink: Math.min(10, Math.max(1, clampInt(r.creditPerDrink, DRINKING_DEFAULTS.creditPerDrink))),
    maxDrinks: Math.min(99, Math.max(0, clampInt(r.maxDrinks, DRINKING_DEFAULTS.maxDrinks))),
  };
}

export const isMinVariant = (s) => !!s?.enabled && s.variant === "min";
export const isCreditVariant = (s) => !!s?.enabled && s.variant === "credit";

/** Short description for Admin / notes, e.g. "Stroke Credit: -1 per drink, max 3". */
export function describeDrinking(s) {
  if (!s?.enabled) return "Off";
  return s.variant === "credit"
    ? `Stroke Credit: -${s.creditPerDrink} per drink, max ${s.maxDrinks}`
    : `Minimum Drinks: ${s.minDrinks}`;
}

/** Oldest first; ties broken by id so every phone sorts the same way. */
export function sortDrinks(drinks) {
  return [...(drinks || [])].sort(
    (a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")) || String(a.id).localeCompare(String(b.id))
  );
}

/** Drinks belonging to one round (or all of them when roundId is null/undefined). */
export function drinksForRound(drinks, roundId) {
  return (drinks || []).filter((d) => roundId == null || d.round_id === roundId);
}

/** Map(playerId -> total drinks). */
export function drinkCountsByPlayer(drinks) {
  const m = new Map();
  for (const d of drinks || []) m.set(d.player_id, (m.get(d.player_id) || 0) + 1);
  return m;
}

/** Map(playerId -> { hole: drinksOnThatHole }). */
export function drinkCountsByPlayerHole(drinks) {
  const m = new Map();
  for (const d of drinks || []) {
    if (!m.has(d.player_id)) m.set(d.player_id, {});
    const byHole = m.get(d.player_id);
    byHole[d.hole] = (byHole[d.hole] || 0) + 1;
  }
  return m;
}

/**
 * Stroke Credit: Map(playerId -> { hole: strokesCredited }). Only the first `maxDrinks` drinks per player count
 * (oldest first), however many were logged, so no phone can ever hand out extra credit.
 * Empty in every other situation (mode off, Minimum Drinks) — which is how "nothing changes" is guaranteed.
 */
export function creditMap(drinks, settings) {
  const out = new Map();
  if (!isCreditVariant(settings)) return out;
  const perPlayer = new Map();
  for (const d of sortDrinks(drinks)) {
    const n = perPlayer.get(d.player_id) || 0;
    if (n >= settings.maxDrinks) continue;
    perPlayer.set(d.player_id, n + 1);
    if (!out.has(d.player_id)) out.set(d.player_id, {});
    const byHole = out.get(d.player_id);
    byHole[d.hole] = (byHole[d.hole] || 0) + settings.creditPerDrink;
  }
  return out;
}

/** Strokes of credit this player has on this hole (0 when none). */
export function creditFor(map, playerId, hole) {
  return (map && map.get(playerId)?.[hole]) || 0;
}

/** A shared ball (scramble / foursomes) gets the credit of every partner's drinks on the hole. */
export function sharedCredit(map, playerIds, hole) {
  return (playerIds || []).reduce((sum, id) => sum + creditFor(map, id, hole), 0);
}

/** How many of a player's drinks still count / can still be logged under the credit variant's cap. */
export function creditRemaining(count, settings) {
  return Math.max(0, (settings?.maxDrinks ?? 0) - count);
}

/**
 * Minimum Drinks progress for one player.
 *   met      reached the minimum (the count keeps going up, no cap)
 *   short    finished 18 holes under the minimum — the final flag
 *   behind   not there yet, and fewer than the pace (minimum x holes played / 18, rounded down)
 *   on_pace  not there yet, but keeping up
 */
export function drinkProgress(count, holesPlayed, settings) {
  const target = settings?.minDrinks ?? 0;
  const played = Math.max(0, Math.min(18, clampInt(holesPlayed, 0)));
  let status = "on_pace";
  if (count >= target) status = "met";
  else if (played >= 18) status = "short";
  else if (count < Math.floor((target * played) / 18)) status = "behind";
  return { count, target, status };
}

// ---------- logging: counts, the "can I log another?" rule, and the unsent-drinks queue ----------

/** Drinks a player has logged on one hole of a round. */
export function drinksOnHole(drinks, playerId, roundId, hole) {
  return (drinks || []).filter((d) => d.player_id === playerId && d.round_id === roundId && d.hole === hole).length;
}

/** Drinks a player has logged in a whole round. */
export function drinksInRound(drinks, playerId, roundId) {
  return (drinks || []).filter((d) => d.player_id === playerId && d.round_id === roundId).length;
}

/** Stroke Credit stops at the maximum (the button shows "Max reached"); Minimum Drinks never blocks. */
export function canLogDrink(countInRound, settings) {
  if (!settings?.enabled) return { ok: false, reason: "off" };
  if (settings.variant === "credit" && countInRound >= settings.maxDrinks) return { ok: false, reason: "max" };
  return { ok: true, reason: null };
}

/** A fresh id the phone can choose itself, so a retry after a dropped signal can't log a drink twice. */
export function newDrinkId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const hex = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
}

/**
 * Drinks as this phone sees them: what the database has, plus drinks logged here that have not uploaded yet,
 * minus drinks undone here that have not been deleted yet.
 * `ops` = [{ op: "add", id, player_id, round_id, hole, created_at } | { op: "remove", id }], oldest first.
 */
export function mergeDrinks(serverDrinks, ops) {
  const removed = new Set((ops || []).filter((o) => o.op === "remove").map((o) => o.id));
  const out = (serverDrinks || []).filter((d) => !removed.has(d.id));
  const have = new Set(out.map((d) => d.id));
  for (const o of ops || []) {
    if (o.op !== "add" || removed.has(o.id) || have.has(o.id)) continue;
    out.push({ id: o.id, player_id: o.player_id, round_id: o.round_id, hole: o.hole, note: o.note ?? null, created_at: o.created_at });
    have.add(o.id);
  }
  return out;
}

/** Queue a new drink. */
export function queueDrinkAdd(ops, drink) {
  return [...(ops || []), { op: "add", ...drink }];
}

/**
 * Undo the most recent drink a player logged on a hole. A drink that has not uploaded yet is simply taken back
 * out of the queue; one that has is queued for deletion. Returns { ops, undoneId } (undoneId null if there was none).
 */
export function queueDrinkUndo(ops, view, { player_id, round_id, hole }) {
  const latest = sortDrinks((view || []).filter((d) => d.player_id === player_id && d.round_id === round_id && d.hole === hole)).pop();
  if (!latest) return { ops: ops || [], undoneId: null };
  const pendingAdd = (ops || []).some((o) => o.op === "add" && o.id === latest.id);
  return {
    ops: pendingAdd ? (ops || []).filter((o) => !(o.op === "add" && o.id === latest.id)) : [...(ops || []), { op: "remove", id: latest.id }],
    undoneId: latest.id,
  };
}
