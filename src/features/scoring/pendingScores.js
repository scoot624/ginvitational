// Scores waiting to upload. Entered scores are written here first, then sent, so a dropped signal never loses them.

/**
 * Scores waiting to upload. Entered scores are written here FIRST, then sent,
 * so a dropped signal (or a reload) mid-round never loses them: they stay on
 * the phone and go up the moment the connection is back.
 */
const PENDING_SCORES_KEY = "ginv_pending_scores_v1";

let pendingScoresFallback = [];

export const pendingKey = (s) => `${s.player_id}|${s.hole}|${s.round_id}`;

export function readPendingScores() {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_SCORES_KEY) || "[]");
    return Array.isArray(v) ? v : pendingScoresFallback;
  } catch {
    return pendingScoresFallback;
  }
}

export function writePendingScores(list) {
  pendingScoresFallback = list; // blocked storage: still held until the page reloads
  try {
    if (list.length) localStorage.setItem(PENDING_SCORES_KEY, JSON.stringify(list));
    else localStorage.removeItem(PENDING_SCORES_KEY);
  } catch {
    /* private window / blocked storage */
  }
}
