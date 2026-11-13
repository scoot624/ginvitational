// Which printable scorecards to print, and what is on each. Pure, no React.
//
// A team game (Better Ball, Scramble, Alternate Shot, Multi-Format Round) prints ONE CARD PER TEAM. Each hole on the
// card is either one shared box (scramble / alternate shot: the pair posts one score) or one box per player (better
// ball / total score), exactly as the game plays that hole, with the handicap-stroke dots worked out the same way the
// boards and the Enter Scores screen do. An individual game (or a team game with no teams built yet) prints one card
// per playing group, as it always has.

import { PARS, STROKE_INDEX } from "./course.js";
import { computeGameRows, teamLabel } from "./gameCalc.js";
import { isTeamFormat } from "./gameConfig.js";

const MAX_COLUMNS = 4;

/**
 * Returns the cards in print order:
 *   { kind: "group", f, members }                               one playing group, a column per player (up to 4)
 *   { kind: "team", f, team, label, members, holes, anyShared }  one team; holes[h-1] = { shared, ballStrokes } for a
 *                                                               shared box, or { shared: false, strokes: { playerId: n } }
 * `f` is the playing group the card belongs to (its tee time, starting hole and code), or null for a team nobody is
 * grouped with yet.
 */
export function buildPrintCards({ foursomes, players, foursomePlayers, game, gameTeams, gameTeamMembers, fieldOffset }) {
  const playersById = new Map((players || []).map((p) => [p.id, p]));
  const membersOfGroup = (f) => {
    const pids = foursomePlayers.filter((fp) => fp.foursome_id === f.id).map((x) => x.player_id);
    return players.filter((p) => pids.includes(p.id)).slice(0, MAX_COLUMNS);
  };
  const groupCard = (f, members) => ({ kind: "group", f, members });

  const teams = game && isTeamFormat(game.format) ? (gameTeams || []).filter((t) => t.game_id === game.id) : [];
  if (teams.length === 0) return foursomes.map((f) => groupCard(f, membersOfGroup(f)));

  // each team's players, in the order they were put on the team
  const teamMembersByTeam = new Map(teams.map((t) => [t.id, []]));
  for (const row of gameTeamMembers || []) if (teamMembersByTeam.has(row.team_id)) teamMembersByTeam.get(row.team_id).push(row.player_id);
  const membersOfTeam = (t) => (teamMembersByTeam.get(t.id) || []).map((id) => playersById.get(id)).filter(Boolean).slice(0, MAX_COLUMNS);

  // what every hole looks like for each team (shared ball or own balls, and who gets a stroke): the same numbers the boards use
  const rows = computeGameRows(game, {
    players, teams: gameTeams, teamMembersByTeam, playersById, PARS, STROKE_INDEX, fieldOffset, scoresByPlayer: new Map(),
  });
  const marksByTeam = new Map(rows.map((r) => [r.id, r.marksByHole || {}]));

  const teamCard = (t, f) => {
    const members = membersOfTeam(t);
    const marks = marksByTeam.get(t.id) || {};
    const holes = Array.from({ length: 18 }, (_, i) => marks[i + 1] || { shared: false, strokes: {} });
    return { kind: "team", f, team: t, label: teamLabel(members, t.name), members, holes, anyShared: holes.some((h) => h.shared) };
  };

  const onATeam = new Set();
  for (const t of teams) membersOfTeam(t).forEach((p) => onATeam.add(p.id));

  const cards = [];
  const placed = new Set();
  for (const f of foursomes) {
    const here = new Set(foursomePlayers.filter((fp) => fp.foursome_id === f.id).map((fp) => fp.player_id));
    // a team's card goes with the group its first player is in, so a team is never printed twice for one round
    for (const t of teams) {
      const members = membersOfTeam(t);
      if (members.length === 0 || !here.has(members[0].id)) continue;
      cards.push(teamCard(t, f));
      placed.add(t.id);
    }
    // anyone in this group who isn't on a team still gets a card
    const rest = membersOfGroup(f).filter((p) => !onATeam.has(p.id));
    if (rest.length > 0) cards.push(groupCard(f, rest));
  }
  // teams whose players aren't in any playing group yet still get a card (with the group details left blank)
  for (const t of teams) if (!placed.has(t.id) && membersOfTeam(t).length > 0) cards.push(teamCard(t, null));
  return cards;
}
