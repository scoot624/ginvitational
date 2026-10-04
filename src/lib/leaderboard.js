// The leaderboard rows: every player's score, net-to-par and rank for the active round.

import { PARS, netScoreForHole } from "./course.js";
import { clampInt, lastName } from "./golf.js";

/**
 * The leaderboard rows (everything the Leaderboard, TV Mode and the Broadcast
 * rank from). `cutoffMs`, when given, ignores scores saved after that moment —
 * that's how the Broadcast asks "what were the standings a few minutes ago?".
 */
export function buildLeaderboardRows(players, scores, activeRoundId, fieldOffset, cutoffMs = null) {
  // last-write-wins scores by player/hole
  const scoresByPlayer = new Map();
  for (const s of scores) {
    if (activeRoundId != null && s.round_id !== activeRoundId) continue;
    if (cutoffMs != null && new Date(s.created_at).getTime() > cutoffMs) continue;
    const pid = s.player_id;
    const h = clampInt(s.hole, 0);
    const sc = clampInt(s.score, 0);
    if (h < 1 || h > 18) continue;
    if (!scoresByPlayer.has(pid)) scoresByPlayer.set(pid, {});
    const blob = scoresByPlayer.get(pid);
    if (!blob.scoresByHole) blob.scoresByHole = {};
    blob.scoresByHole[h] = sc;
  }

  const rows = players.map((p) => {
    const blob = scoresByPlayer.get(p.id) || {};
    const scoresByHole = blob.scoresByHole || {};

    const playedHoles = Object.keys(scoresByHole)
      .map((x) => clampInt(x, 0))
      .filter((h) => h >= 1 && h <= 18)
      .sort((a, b) => a - b);

    const holesPlayed = playedHoles.length;
    // `handicap` is the player's real course handicap (shown as their
    // "HCP" badge). `playingHandicap` is what stroke/net-score math
    // actually uses — the same number, unless Field-Relative mode shifts
    // it by the field's lowest handicap.
    const handicap = clampInt(p.handicap, 0);
    const playingHandicap = handicap - fieldOffset;

    const gross = playedHoles.reduce((acc, h) => acc + scoresByHole[h], 0);
    const parPlayed = playedHoles.reduce((acc, h) => acc + PARS[h - 1], 0);

    // Real net (stroke index allocation)
    const netGross = playedHoles.reduce((acc, h) => {
      const grossHole = scoresByHole[h];
      const netHole = netScoreForHole(grossHole, playingHandicap, h);
      return acc + netHole;
    }, 0);

    const netToPar = holesPlayed === 0 ? 9999 : netGross - parPlayed;

    return {
      id: p.id,
      name: p.name,
      last: lastName(p.name),
      handicap,
      playingHandicap,
      charity: p.charity,
      holesPlayed,
      netToPar,
      scoresByHole,
      gross,
    };
  });

  // Sort: scored first, then netToPar, then holesPlayed desc, then name
  rows.sort((a, b) => {
    const aHas = a.holesPlayed > 0;
    const bHas = b.holesPlayed > 0;
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (a.netToPar !== b.netToPar) return a.netToPar - b.netToPar;
    if (a.holesPlayed !== b.holesPlayed) return b.holesPlayed - a.holesPlayed;
    return a.name.localeCompare(b.name);
  });

  // ✅ Assign display ranks with tie handling: 1, 1, 3...
  // Tie rule: same netToPar AND same holesPlayed
  let lastKey = null;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    // Only tie players who have scores; otherwise don't tie the "—" rows
    const key = r.holesPlayed > 0 ? `${r.netToPar}|${r.holesPlayed}` : `noscore|${r.id}`;

    if (i === 0) {
      r.displayRank = 1;
    } else if (key === lastKey) {
      r.displayRank = rows[i - 1].displayRank; // same rank as previous row
    } else {
      r.displayRank = i + 1; // competition ranking jump
    }

    lastKey = key;
  }

  return rows;
}
