// Handicap strokes for the Enter Scores screen: does this player (or shared-ball team) get a stroke on this hole?
// Pure, no React. It follows the same rules the boards use (the game's handicap %, the blended team handicap for a
// scramble / alternate-shot ball, a multi-format round's per-segment rules, match-play handicaps), so the marker on the
// entry screen always agrees with the score that ends up on the Leaderboard.

import { buildHoleSegmentMap, compositeSharedHandicap, scrambleTeamHandicap, strokesOnHoleForGame } from "./gameCalc.js";
import { isMatchFormat, isSharedBallFormat } from "./gameConfig.js";
import { clampInt } from "./golf.js";
import { matchStrokesOnHole } from "./matchPlay.js";

/**
 * entry: { players: [{ id, handicap }], shared }  (one player on their own ball, or a pair/team sharing one ball)
 * env:   { games, gameTeams, gameTeamMembers, playersById, matches, matchPlayers, roundId, fieldOffset, STROKE_INDEX }
 * Returns { strokes, shared, game }: strokes is how many the entry gets on that hole (negative = a plus handicap gives
 * one back, 0 = none). The game is the first active one that applies to the entry, in the order the games are listed.
 */
export function strokesForEntry(entry, hole, env) {
  const SI = env.STROKE_INDEX;
  const off = clampInt(env.fieldOffset, 0);
  const active = (env.games || []).filter((g) => g.active);
  const first = entry.players[0];
  const none = { strokes: 0, shared: !!entry.shared, game: null };
  if (!first) return none;

  const own = (p, pct) => strokesOnHoleForGame(clampInt(p.handicap, 0) - off, pct, hole, SI);

  // The players on this player's team in a team game, or null if they aren't on one.
  const teamMembers = (game) => {
    const teamIds = new Set((env.gameTeams || []).filter((t) => t.game_id === game.id).map((t) => t.id));
    const mine = (env.gameTeamMembers || []).find((m) => teamIds.has(m.team_id) && m.player_id === first.id);
    if (!mine) return null;
    return (env.gameTeamMembers || [])
      .filter((m) => m.team_id === mine.team_id)
      .map((m) => env.playersById.get(m.player_id))
      .filter(Boolean);
  };

  // This player's match in a match-play game this round, with both sides filled in.
  const matchFor = (game) => {
    const m = (env.matches || []).find(
      (x) => x.game_id === game.id && x.round_id === env.roundId && (env.matchPlayers || []).some((mp) => mp.match_id === x.id && mp.player_id === first.id)
    );
    if (!m) return null;
    const side = (s) =>
      (env.matchPlayers || [])
        .filter((mp) => mp.match_id === m.id && mp.side === s)
        .sort((a, b) => a.position - b.position)
        .map((mp) => env.playersById.get(mp.player_id))
        .filter(Boolean);
    const cfg = game.config || {};
    return {
      match: { ...m, sideA: side("a"), sideB: side("b") },
      ctx: { STROKE_INDEX: SI, handicapMode: cfg.handicapMode || "off_lowest", handicapPct: game.handicap_pct, fieldOffset: off },
    };
  };

  if (entry.shared) {
    for (const g of active) {
      if (isMatchFormat(g.format)) {
        const mf = matchFor(g);
        if (mf && mf.match.match_type === "foursomes") {
          const side = mf.match.sideA.some((p) => p.id === first.id) ? "a" : "b";
          return { strokes: matchStrokesOnHole(mf.match, mf.ctx, hole).team[side], shared: true, game: g };
        }
        continue;
      }
      if (isSharedBallFormat(g.format)) {
        const members = teamMembers(g);
        if (members) return { strokes: strokesOnHoleForGame(scrambleTeamHandicap(members, g, off), 100, hole, SI), shared: true, game: g };
        continue;
      }
      if (g.format === "composite") {
        const seg = buildHoleSegmentMap(g.segments).get(hole);
        const members = seg && seg.formatType === "shared" ? teamMembers(g) : null;
        if (members) return { strokes: strokesOnHoleForGame(compositeSharedHandicap(members, seg, off), 100, hole, SI), shared: true, game: g };
      }
    }
    return none;
  }

  for (const g of active) {
    if (g.format === "individual_net" || g.format === "better_ball_2" || g.format === "better_ball_4") {
      return { strokes: own(first, clampInt(g.handicap_pct, 100)), shared: false, game: g };
    }
    if (g.format === "composite") {
      const seg = buildHoleSegmentMap(g.segments).get(hole);
      if (seg && seg.formatType === "individual") return { strokes: own(first, clampInt(seg.handicapPct, 100)), shared: false, game: g };
      continue;
    }
    if (isMatchFormat(g.format)) {
      const mf = matchFor(g);
      if (mf && mf.match.match_type !== "foursomes") {
        const r = matchStrokesOnHole(mf.match, mf.ctx, hole);
        const a = mf.match.sideA.findIndex((p) => p.id === first.id);
        const strokes = a >= 0 ? r.a[a] : r.b[mf.match.sideB.findIndex((p) => p.id === first.id)];
        return { strokes: strokes ?? 0, shared: false, game: g };
      }
    }
    // Individual Gross has no strokes; a scramble / alternate-shot game has none for a player on their own.
  }
  // No game at all (a plain event): everyone plays off their own handicap.
  if (active.length === 0) return { strokes: own(first, 100), shared: false, game: null };
  return none;
}
