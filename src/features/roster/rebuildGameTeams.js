// Saving rebuilt game teams to the database (the plan itself comes from lib/teamBuilder planTeamRebuild).

import { supabase } from "../../lib/supabase";
import { errToText } from "../../lib/util";

/**
 * Replaces ONE game's saved teams with the planned ones (plan.teams: { id, name, memberIds }). Scores don't belong to
 * teams, so nothing is lost. If anything fails part-way, the game's old teams are put back exactly as they were, and the
 * returned text says so. Returns null on success, otherwise a message to show.
 */
export async function applyTeamPlan(plan, oldTeams, oldMembers) {
  const gameId = plan.game.id;

  // a player can only be on one team per game, so the old teams go first (their members go with them)
  const del = await supabase.from("game_teams").delete().eq("game_id", gameId);
  if (del.error) return errToText(del.error);

  let failure = null;
  const teamRows = plan.teams.map((t) => ({ id: t.id, game_id: gameId, name: t.name }));
  const memberRows = plan.teams.flatMap((t) => t.memberIds.map((player_id) => ({ game_id: gameId, team_id: t.id, player_id })));
  const addTeams = await supabase.from("game_teams").insert(teamRows);
  if (addTeams.error) {
    failure = errToText(addTeams.error);
  } else if (memberRows.length > 0) {
    const addMembers = await supabase.from("game_team_members").insert(memberRows);
    if (addMembers.error) failure = errToText(addMembers.error);
  }
  if (!failure) return null;

  // put the old teams back
  await supabase.from("game_teams").delete().eq("game_id", gameId);
  const back1 = await supabase.from("game_teams").insert(oldTeams.map((t) => ({ id: t.id, game_id: t.game_id, name: t.name })));
  const back2 = oldMembers.length
    ? await supabase.from("game_team_members").insert(oldMembers.map((m) => ({ game_id: m.game_id, team_id: m.team_id, player_id: m.player_id })))
    : { error: null };
  return back1.error || back2.error
    ? `${failure}. The old teams could not be fully put back: reload and check Admin → Games.`
    : `${failure}. The old teams were put back.`;
}
