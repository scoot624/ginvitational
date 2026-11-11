// On fire / ice cold detection for a player's most recent holes (used by TV Mode).

import { PARS, netScoreForHole } from "./course.js";
import { clampInt } from "./golf.js";

/**
 * "On fire" / "ice cold" for a player's most recent holes, judged NET vs par
 * (same basis as the leaderboard and the broadcast's "net birdie" lines):
 *   fire — last two holes both net birdie or better
 *   ice  — last two holes both net bogey or worse, OR the last hole alone is
 *          net double bogey or worse
 * "Last" follows the order the group actually plays — a shotgun group that
 * starts on 10 plays 10…18 then 1…9 — not hole-number order. Nothing is
 * remembered between refreshes; it only reads the scores already loaded, so
 * a streak ends the moment the next hole breaks it. Finished players get
 * nothing (they're not "on" anything any more). Returns "fire", "ice" or null.
 */
export function formStreak(p, startHole) {
  if (!p || !p.scoresByHole || p.holesPlayed >= 18) return null;
  const start = Math.min(18, Math.max(1, clampInt(startHole, 1)));

  const vsPar = [];
  for (let i = 0; i < 18; i++) {
    const h = ((start - 1 + i) % 18) + 1;
    const gross = p.scoresByHole[h];
    vsPar.push(gross == null ? null : netScoreForHole(gross, p.playingHandicap, h, p.creditByHole?.[h] || 0) - PARS[h - 1]);
  }

  let last = -1;
  for (let i = 17; i >= 0; i--) {
    if (vsPar[i] != null) {
      last = i;
      break;
    }
  }
  if (last < 0) return null;

  const a = vsPar[last];
  const b = last > 0 ? vsPar[last - 1] : null;
  if (a >= 2) return "ice";
  if (b != null && a >= 1 && b >= 1) return "ice";
  if (b != null && a <= -1 && b <= -1) return "fire";
  return null;
}
