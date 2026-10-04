// Match play engine: turns the per-hole scores already entered into the state
// of each match ("2 UP thru 11", "3&2", halved) and the points they are worth.
// Pure functions — no network, no React — so it is tested with made-up scores.
//
// A match has two sides. Singles: one player a side. Four-ball: two a side,
// each plays their own ball and the better net counts. Foursomes (alternate
// shot): two a side, ONE score per side per hole (Enter Scores saves the same
// value under both partners, the same way it does for a scramble).

import { strokesOnHoleForGame } from "./gameCalc.js";
import { shortName } from "./broadcastEngine.js";

export const MATCH_TYPES = {
  singles: { label: "Singles", perSide: 1 },
  fourball: { label: "Four-ball", perSide: 2 },
  foursomes: { label: "Foursomes", perSide: 2 },
};

export const HANDICAP_MODES = {
  off_lowest: "Strokes off the lowest",
  full: "Full handicap (net)",
  gross: "Gross (no handicap)",
};

const clampInt = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

/** "Scott J." / "Scott J. / Dan R." */
export function sideLabel(players) {
  return players.map((p) => shortName(p.name)).join(" / ") || "—";
}

/**
 * Handicap strokes each side plays with in this match (before the hole's
 * stroke index decides where they fall).
 *   gross       → nobody gets any
 *   full        → own handicap × %
 *   off_lowest  → the lowest handicap in the match plays to scratch and the
 *                 others get the difference (× %)
 * Foursomes uses ONE handicap per side: half of the pair's combined handicap.
 * Returns { a: [per-player strokes] | number, b: ... } — see strokesFor().
 */
function matchHandicaps(match, { handicapMode, handicapPct, fieldOffset }) {
  const pct = clampInt(handicapPct, 100) / 100;
  const off = clampInt(fieldOffset, 0);
  const eff = (p) => clampInt(p.handicap, 0) - off;

  if (handicapMode === "gross") {
    return { a: match.sideA.map(() => 0), b: match.sideB.map(() => 0), team: { a: 0, b: 0 } };
  }

  if (match.match_type === "foursomes") {
    const team = (side) => Math.round((side.reduce((s, p) => s + eff(p), 0) / Math.max(1, side.length)) * pct);
    let a = team(match.sideA);
    let b = team(match.sideB);
    if (handicapMode === "off_lowest") {
      const low = Math.min(a, b);
      a -= low;
      b -= low;
    }
    return { a: match.sideA.map(() => 0), b: match.sideB.map(() => 0), team: { a, b } };
  }

  const all = [...match.sideA, ...match.sideB].map((p) => Math.round(eff(p) * pct));
  const low = handicapMode === "off_lowest" && all.length ? Math.min(...all) : 0;
  const a = match.sideA.map((p) => Math.round(eff(p) * pct) - low);
  const b = match.sideB.map((p) => Math.round(eff(p) * pct) - low);
  return { a, b, team: { a: 0, b: 0 } };
}

/**
 * match: { id, match_type, sideA: [{id,name,handicap}], sideB: [...] }
 * ctx:   { scoresByPlayer: Map(pid -> {hole: gross}), PARS, STROKE_INDEX,
 *          handicapMode, handicapPct, fieldOffset, startHole, pointsWin, pointsHalf }
 * Returns the match's state; see the fields below.
 */
export function computeMatchResult(match, ctx) {
  const { scoresByPlayer, STROKE_INDEX } = ctx;
  const pointsWin = ctx.pointsWin ?? 1;
  const pointsHalf = ctx.pointsHalf ?? 0.5;
  const hcp = matchHandicaps(match, ctx);
  const start = Math.min(18, Math.max(1, clampInt(ctx.startHole, 1)));
  const shared = match.match_type === "foursomes";

  const grossOf = (p, h) => (scoresByPlayer.get(p.id) || {})[h];
  const strokes = (ph, h) => strokesOnHoleForGame(ph, 100, h, STROKE_INDEX);

  // One side's net on a hole, or null if the side has no score for it yet.
  const sideNet = (side, key, h) => {
    if (shared) {
      const g = side.map((p) => grossOf(p, h)).find((v) => v != null);
      return g == null ? null : g - strokes(hcp.team[key], h);
    }
    const nets = [];
    side.forEach((p, i) => {
      const g = grossOf(p, h);
      if (g != null) nets.push(g - strokes(hcp[key][i], h));
    });
    if (nets.length === 0) return null;
    // Singles needs the one player; four-ball takes the better of whoever has scored.
    return Math.min(...nets);
  };

  const holes = []; // { hole, result: 'a' | 'b' | 'h' } in play order, up to where scoring stops
  let diff = 0; // positive = side A is up
  let decidedAt = null;
  for (let i = 0; i < 18; i++) {
    const h = ((start - 1 + i) % 18) + 1;
    const a = sideNet(match.sideA, "a", h);
    const b = sideNet(match.sideB, "b", h);
    if (a == null || b == null) break;
    const result = a < b ? "a" : a > b ? "b" : "h";
    diff += result === "a" ? 1 : result === "b" ? -1 : 0;
    holes.push({ hole: h, result });
    if (Math.abs(diff) > 18 - holes.length) {
      decidedAt = holes.length;
      break;
    }
  }

  const played = holes.length;
  const remaining = 18 - played;
  const nameA = sideLabel(match.sideA);
  const nameB = sideLabel(match.sideB);
  const leader = diff > 0 ? "a" : diff < 0 ? "b" : null;
  const leaderName = leader === "a" ? nameA : leader === "b" ? nameB : "";

  let status = "in_progress";
  if (played === 0) status = "not_started";
  else if (decidedAt != null || played === 18) status = "final";

  let text;
  if (status === "not_started") {
    text = "Not started";
  } else if (status === "final") {
    if (diff === 0) text = "Halved";
    else if (decidedAt != null && remaining > 0) text = `${leaderName} wins ${Math.abs(diff)}&${remaining}`;
    else text = `${leaderName} wins ${Math.abs(diff)} UP`;
  } else if (diff === 0) {
    text = `All square thru ${played}`;
  } else {
    text = `${leaderName} ${Math.abs(diff)} UP thru ${played}${Math.abs(diff) === remaining ? " (dormie)" : ""}`;
  }

  const points =
    status !== "final"
      ? { a: 0, b: 0 }
      : diff > 0
      ? { a: pointsWin, b: 0 }
      : diff < 0
      ? { a: 0, b: pointsWin }
      : { a: pointsHalf, b: pointsHalf };
  // Live total: a match that is in progress counts as if it ended now.
  const projected =
    status === "not_started"
      ? { a: 0, b: 0 }
      : status === "final"
      ? points
      : diff > 0
      ? { a: pointsWin, b: 0 }
      : diff < 0
      ? { a: 0, b: pointsWin }
      : { a: pointsHalf, b: pointsHalf };

  return {
    status,
    holesPlayed: played,
    diff,
    leader,
    winner: status === "final" ? leader : null,
    text,
    nameA,
    nameB,
    holes,
    points,
    projected,
  };
}

/**
 * Ryder Cup totals: [{ roundId, a, b, projA, projB }] per session (round) in the order given, plus overall.
 * `entries` = [{ roundId, result }] — one per match.
 */
export function computeRyderCup(entries, roundIds) {
  const sessions = roundIds.map((roundId) => ({ roundId, a: 0, b: 0, projA: 0, projB: 0, matches: 0, finished: 0 }));
  const bySession = new Map(sessions.map((s) => [s.roundId, s]));
  const overall = { a: 0, b: 0, projA: 0, projB: 0, matches: 0, finished: 0 };
  for (const { roundId, result } of entries) {
    const s = bySession.get(roundId);
    for (const t of s ? [s, overall] : [overall]) {
      t.a += result.points.a;
      t.b += result.points.b;
      t.projA += result.projected.a;
      t.projB += result.projected.b;
      t.matches += 1;
      if (result.status === "final") t.finished += 1;
    }
  }
  return { sessions, overall };
}
