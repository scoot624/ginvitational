// Who counts as the leader / last place on a leaderboard (ties share the spot).

/** True once a leaderboard row's own rank/holesPlayed show it's in the lead. */
export function isLeaderRow(r) {
  return r.displayRank === 1 && r.holesPlayed > 0;
}

/**
 * The displayRank that counts as "last place" — taken from the worst row
 * among players who have actually played a hole (unstarted players sit
 * below them but aren't last yet). Returns null when nobody has played, or
 * when every scored player is tied for first, so the leader's trophy always
 * wins and a field with no scores is simply numbered.
 */
export function lastPlaceRank(rows) {
  const scored = rows.filter((r) => r.holesPlayed > 0);
  if (scored.length === 0) return null;
  const rank = scored[scored.length - 1].displayRank;
  return rank === 1 ? null : rank;
}

/** True for rows tied at the bottom of the scored field (see lastPlaceRank). */
export function isLastRow(r, lastRank) {
  return lastRank != null && r.holesPlayed > 0 && r.displayRank === lastRank;
}
