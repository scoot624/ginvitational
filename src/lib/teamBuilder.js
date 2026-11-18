// Building a game's teams from the players and playing groups. Pure, no React, no network.
//
// Add Game uses this to make a game's teams when the game is created, and "Update game teams" (Admin → Players & Groups)
// uses the very same rules to rebuild them after players are moved between groups. A game keeps its own saved copy of its
// teams (so a later change to the groups never silently changes a game that is already being played); updating it is a
// deliberate step.

import { GAME_FORMAT_TEAM_SIZE, isTeamFormat } from "./gameConfig.js";
import { clampInt } from "./golf.js";

/**
 * The people teams are made from: players who share a "team" value (the tee sheet's team column, kept in step with their
 * group name), otherwise each playing group of the round. Returns { source: "column" | "groups", teams: [{ label, members }] }.
 */
export function teamPool(players, foursomes, foursomePlayers, roundId) {
  const byLabel = new Map();
  for (const p of players) {
    const label = String(p.team_label || "").trim();
    if (!label) continue;
    if (!byLabel.has(label)) byLabel.set(label, []);
    byLabel.get(label).push(p);
  }
  if (byLabel.size > 0) {
    return { source: "column", teams: Array.from(byLabel.entries()).map(([label, members]) => ({ label, members })) };
  }

  const byId = new Map(players.map((p) => [p.id, p]));
  const teams = foursomes
    .filter((f) => !f.round_id || f.round_id === roundId)
    .map((f) => ({
      label: f.group_name,
      members: foursomePlayers
        .filter((fp) => fp.foursome_id === f.id)
        .map((fp) => byId.get(fp.player_id))
        .filter(Boolean),
    }))
    .filter((t) => t.members.length > 0);
  return { source: "groups", teams };
}

/**
 * Teams of the given size, ready to preview or save. A bigger group is split into pairs for a 2-man game:
 * "balanced" pairs the lowest handicap with the highest, "order" pairs them as listed, "keep" leaves the whole group as one team.
 */
export function teamGroupsForSize(poolTeams, teamSize, split = "balanced") {
  const out = [];
  for (const t of poolTeams) {
    if (teamSize === 2 && t.members.length > 2 && split !== "keep") {
      const sorted = split === "order" ? [...t.members] : [...t.members].sort((x, y) => clampInt(x.handicap, 0) - clampInt(y.handicap, 0));
      const pairs = [];
      if (split === "order") {
        for (let i = 0; i < sorted.length; i += 2) pairs.push(sorted.slice(i, i + 2));
      } else {
        let lo = 0;
        let hi = sorted.length - 1;
        while (lo < hi) pairs.push([sorted[lo++], sorted[hi--]]);
        if (lo === hi) pairs.push([sorted[lo]]);
      }
      pairs.forEach((members, i) => out.push({ label: `${t.label} ${String.fromCharCode(65 + i)}`, members, mismatched: members.length !== teamSize }));
    } else {
      out.push({ label: t.label, members: t.members, mismatched: t.members.length !== teamSize });
    }
  }
  return out;
}

/** A team game's team size: fixed by its format, or (a multi-format round) the usual size of the teams it already has. */
export function teamSizeOf(game, teamsOfGame, membersByTeam) {
  if (GAME_FORMAT_TEAM_SIZE[game.format]) return GAME_FORMAT_TEAM_SIZE[game.format];
  const sizes = teamsOfGame.map((t) => (membersByTeam.get(t.id) || []).length).filter((n) => n > 0);
  if (sizes.length === 0) return 2;
  const counts = new Map();
  for (const n of sizes) counts.set(n, (counts.get(n) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

const teamKey = (ids) => [...ids].sort().join(",");

/**
 * What "Update game teams" would do, game by game, for every team game that already has teams: the teams the current
 * groups give, and whether that differs from what the game has saved (by who is on which team).
 * `short` lists teams that wouldn't have the right number of players (a group of 3 splits into a pair and a single, which
 * would show just one name on the Leaderboard), so the screen can warn before anything is changed.
 * Returns [{ game, teamSize, teams: [{ id, name, memberIds, mismatched }], changed, removed, added, short }].
 */
export function planTeamRebuild({ games, gameTeams, gameTeamMembers, players, foursomes, foursomePlayers, roundId, newId }) {
  const pool = teamPool(players, foursomes, foursomePlayers, roundId);
  const plans = [];
  for (const game of games) {
    if (!isTeamFormat(game.format)) continue;
    const oldTeams = gameTeams.filter((t) => t.game_id === game.id);
    if (oldTeams.length === 0) continue; // never built: nothing to update
    const membersByTeam = new Map(oldTeams.map((t) => [t.id, []]));
    for (const m of gameTeamMembers) if (membersByTeam.has(m.team_id)) membersByTeam.get(m.team_id).push(m.player_id);

    const teamSize = teamSizeOf(game, oldTeams, membersByTeam);
    const fresh = teamGroupsForSize(pool.teams, teamSize, "balanced").filter((g) => g.members.length > 0);
    const teams = fresh.map((g) => ({ id: newId(), name: g.label, memberIds: g.members.map((p) => p.id), mismatched: g.members.length !== teamSize }));

    const oldKeys = new Set(oldTeams.map((t) => teamKey(membersByTeam.get(t.id))));
    const newKeys = new Set(teams.map((t) => teamKey(t.memberIds)));
    const added = [...newKeys].filter((k) => !oldKeys.has(k)).length;
    const removed = [...oldKeys].filter((k) => !newKeys.has(k)).length;
    plans.push({ game, teamSize, teams, changed: added > 0 || removed > 0, added, removed, short: teams.filter((t) => t.mismatched) });
  }
  return plans;
}
