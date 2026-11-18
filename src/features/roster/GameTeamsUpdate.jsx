// Admin → Players & Groups → "Game teams": rebuild each team game's teams from the current groups.
// A game keeps its own saved copy of its teams, so moving players between groups doesn't change the Leaderboard on its own.

import { useState } from "react";
import { useEventDataContext } from "../../hooks/eventDataContext";
import { newDrinkId } from "../../lib/drinks";
import { planTeamRebuild } from "../../lib/teamBuilder";
import { THEME, styles } from "../../theme";
import { applyTeamPlan } from "./rebuildGameTeams";

export function GameTeamsUpdate({ players, foursomes, foursomePlayers, roundId, stale, onDone }) {
  const { games, gameTeams, gameTeamMembers } = useEventDataContext();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const inputs = { games, gameTeams, gameTeamMembers, players, foursomes, foursomePlayers, roundId };
  const preview = planTeamRebuild({ ...inputs, newId: () => "" }); // just to see what would change; real ids are made when you tap the button
  if (preview.length === 0) return null; // no team games with teams: nothing to keep in step

  const changed = preview.filter((p) => p.changed);
  const shortAll = preview.flatMap((p) => p.short.map((t) => ({ team: t.name, size: p.teamSize, have: t.memberIds.length })));
  // the same short team shows up once per game; say it once
  const short = shortAll.filter((s, i) => shortAll.findIndex((o) => o.team === s.team && o.size === s.size && o.have === s.have) === i);
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

  async function update() {
    const plans = planTeamRebuild({ ...inputs, newId: newDrinkId }).filter((p) => p.changed);
    if (plans.length === 0) {
      setMsg("The games' teams already match the groups ✓");
      return;
    }
    const lines = [
      `Update the teams for ${plans.map((p) => `"${p.game.name}"`).join(", ")} to match the groups?`,
      "Scores and players aren't touched.",
    ];
    if (short.length > 0) {
      lines.push(
        `Careful: ${short.map((s) => `"${s.team}" would have ${plural(s.have, "player")} instead of ${s.size}`).join("; ")}. Fix the groups first if that's wrong (a team that is short shows fewer names on the Leaderboard).`
      );
    }
    if (!confirm(lines.join("\n\n"))) return;

    setBusy(true);
    setMsg("Updating…");
    try {
      for (const plan of plans) {
        const err = await applyTeamPlan(
          plan,
          gameTeams.filter((t) => t.game_id === plan.game.id),
          gameTeamMembers.filter((m) => m.game_id === plan.game.id)
        );
        if (err) {
          setMsg(`"${plan.game.name}": ${err}`);
          await onDone();
          return;
        }
      }
      await onDone();
      setMsg(`Updated the teams for ${plural(plans.length, "game")} ✅ The Leaderboard now follows the groups.`);
    } catch (e) {
      console.error(e);
      setMsg(`Something went wrong: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ ...styles.foursomeCard, border: `1px solid ${stale && changed.length ? THEME.accent : THEME.border}`, display: "grid", gap: 8 }}>
      <div style={styles.sectionLabel}>Game teams</div>
      <div style={styles.helpText}>
        {changed.length > 0
          ? `The groups no longer match the teams ${plural(changed.length, "game")} use: ${changed.map((p) => p.game.name).join(", ")}. Update them so the Leaderboard, TV Mode and printed cards follow.`
          : "Each game keeps its own copy of the teams. If you move players between groups, come back here to update them. Right now they match the groups ✓"}
      </div>
      {short.length > 0 ? (
        <div style={{ fontSize: 13, color: THEME.danger, fontWeight: 700 }}>
          {short.map((s) => `"${s.team}" would have ${plural(s.have, "player")} (needs ${s.size})`).join(" • ")}. Give every group its full team first.
        </div>
      ) : null}
      <button
        style={{ ...styles.bigBtn, minHeight: 48, opacity: busy || changed.length === 0 ? 0.6 : 1 }}
        disabled={busy || changed.length === 0}
        onClick={update}
      >
        Update game teams from groups
      </button>
      {msg ? <div style={styles.helpText}>{msg}</div> : null}
    </div>
  );
}
