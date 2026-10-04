// Small golf/number helpers shared by the app and the calculation engines.
// One copy of each, so the leaderboard, game engines and Broadcast can't drift apart.

export function clampInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

/**
 * Full last name — everything after the first word, not just the final
 * word, so a multi-word surname (e.g. "Van Der Berg") shows in full
 * instead of being truncated to just "Berg".
 */
export function lastName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return parts.slice(1).join(" ");
}

/** 0 -> "E", 2 -> "+2", -1 -> "-1" */
export function formatToPar(n) {
  if (n === 0) return "E";
  if (n > 0) return `+${n}`;
  return `${n}`;
}

/**
 * Real handicap allocation by stroke index.
 * A positive handicap RECEIVES strokes, starting at the #1 handicap hole
 * (hardest) and working up, wrapping past 18 for handicaps above 18.
 * A plus handicap (negative) GIVES strokes back instead, using that same
 * hole order, so the result goes negative on those holes —
 * `net = gross - strokesForHandicap(...)` keeps working either way.
 * `strokeIndex` is the course's 18 stroke-index numbers, hole 1 first.
 */
export function strokesForHandicap(handicap, holeNum, strokeIndex) {
  const h = clampInt(handicap, 0);
  if (h === 0) return 0;

  const magnitude = Math.abs(h);
  const full = Math.floor(magnitude / 18);
  const rem = magnitude % 18;
  const si = strokeIndex[holeNum - 1];
  const strokes = full + (rem > 0 && si <= rem ? 1 : 0);

  return h > 0 ? strokes : 0 - strokes; // 0 - n keeps a plain 0 (not -0) when no stroke falls here
}

export const hcpLabel = (h) => (clampInt(h, 0) < 0 ? `+${Math.abs(clampInt(h, 0))}` : String(clampInt(h, 0)));
