import { useState } from "react";
import { AdminSection } from "../../components/AdminSection";
import { ClearMessagesSetupNotice } from "../../components/SetupNotices";
import { DeletePlayersPanel } from "../roster/DeletePlayersPanel";
import { useEventDataContext } from "../../hooks/eventDataContext";
import { readPendingScores } from "../scoring/pendingScores";
import { ADMIN_PIN } from "../../lib/config";
import { supabase } from "../../lib/supabase";
import { errToText } from "../../lib/util";
import { THEME, styles } from "../../theme";

// Admin → Danger Zone (behind the Admin passcode): clear foursomes, clear Broadcast messages, delete players, games and rounds.

export function DangerZoneSection({ adminOn, openAdminSection, setOpenAdminSection, deleteGame, deleteRound, discardUnsentScores }) {
  const {
    players,
    games,
    appSettings,
    rounds,
    scores,
    drinks,
    drinksTableReady,
    drinkLog,
    broadcastMsgs,
    foursomes,
    foursomePlayers,
    loadBroadcast,
    loadScores,
    loadDrinks,
    initialLoad,
    activeRound,
  } = useEventDataContext();

  // Delete scores: which round ("all" or a round id), and whether the logged drinks go too
  const [scoreScope, setScoreScope] = useState("all");
  const [alsoDrinks, setAlsoDrinks] = useState(false);
  const [scoresMsg, setScoresMsg] = useState("");
  const [scoresBusy, setScoresBusy] = useState(false);
  const manyRounds = appSettings.multi_round_enabled && rounds.length > 1;
  const scopeRoundId = manyRounds && scoreScope !== "all" ? scoreScope : null;
  const scopeScores = scopeRoundId ? scores.filter((s) => s.round_id === scopeRoundId) : scores;
  const scopeDrinks = scopeRoundId ? (drinks || []).filter((d) => d.round_id === scopeRoundId) : drinks || [];

  // Admin → Danger Zone
  const [dangerUnlocked, setDangerUnlocked] = useState(false);

  const [dangerPin, setDangerPin] = useState("");

  const [dangerPinMsg, setDangerPinMsg] = useState("");

  const [clearMsg, setClearMsg] = useState("");

  const [clearNeedsSetup, setClearNeedsSetup] = useState(false);

  // Admin → Danger Zone → Clear all messages
  async function clearBroadcastMessages() {
    if (!adminOn) return alert("Admin only.");
    const head = await supabase.from("broadcast_messages").select("id", { count: "exact", head: true });
    const total = head.count ?? broadcastMsgs.length;
    if (!total) {
      setClearMsg("There are no Broadcast messages to clear.");
      return;
    }
    if (!confirm(`Delete all ${total} Broadcast messages? This can't be undone.`)) return;
    setClearMsg("Clearing…");
    const { data, error } = await supabase
      .from("broadcast_messages")
      .delete()
      .gte("created_at", "1970-01-01T00:00:00Z")
      .select("id");
    if (error) {
      console.error(error);
      setClearMsg(`Error clearing messages: ${errToText(error)}`);
      return;
    }
    if ((data || []).length === 0) {
      // The database accepted the request but removed nothing: delete isn't allowed yet.
      setClearNeedsSetup(true);
      setClearMsg("Nothing was deleted. The database needs a one-time permission first (see below).");
      return;
    }
    setClearNeedsSetup(false);
    await loadBroadcast();
    setClearMsg(`Cleared ${data.length} messages ✅`);
  }

  function unlockDanger() {
    if (dangerPin === ADMIN_PIN) {
      setDangerUnlocked(true);
      setDangerPin("");
      setDangerPinMsg("");
    } else {
      setDangerPinMsg("Wrong passcode.");
      setDangerPin("");
    }
  }

  // Deletes players along with everything that points at them (their scores,
  // their group spots, any game-team spots and their Broadcast cards).
  async function deletePlayers(ids) {
    if (!adminOn) return "Admin only.";
    for (let i = 0; i < ids.length; i += 40) {
      const part = ids.slice(i, i + 40);
      await supabase.from("broadcast_messages").delete().in("player_id", part); // best effort
      for (const table of ["foursome_players", "scores", "game_team_members"]) {
        const { error } = await supabase.from(table).delete().in("player_id", part);
        if (error) {
          console.error(error);
          return `Error removing ${table}: ${errToText(error)}`;
        }
      }
      const { data, error } = await supabase.from("players").delete().in("id", part).select("id");
      if (error) {
        console.error(error);
        return `Error deleting players: ${errToText(error)}`;
      }
      if ((data || []).length < part.length) {
        await initialLoad();
        return "Some players could not be deleted (the database refused). Reload and check the list.";
      }
    }
    await initialLoad();
    return `Deleted ${ids.length} player${ids.length === 1 ? "" : "s"} ✅`;
  }

  // Admin → Danger Zone → Delete scores: removes entered scores (all rounds, or one round) and nothing else —
  // players, groups, games and rounds stay. Optionally the logged drinks too.
  async function deleteScores() {
    if (!adminOn) return alert("Admin only.");
    const roundId = scopeRoundId;
    const dropDrinks = alsoDrinks && drinksTableReady;
    const nScores = scopeScores.length;
    const nDrinks = dropDrinks ? scopeDrinks.length : 0;
    if (nScores === 0 && nDrinks === 0) {
      setScoresMsg("There are no scores to delete.");
      return;
    }
    const unsent = readPendingScores().filter((q) => !roundId || q.round_id === roundId).length;
    const where = roundId ? rounds.find((r) => r.id === roundId)?.label || "that round" : manyRounds ? "every round" : "this event";
    const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
    const lines = [`Delete ${plural(nScores, "score")} for ${where}?`];
    if (nDrinks) lines.push(`This also deletes ${plural(nDrinks, "logged drink")}.`);
    if (unsent) lines.push(`${plural(unsent, "score")} still waiting to upload on this phone will be thrown away too.`);
    lines.push("Players, groups and games are kept. This can't be undone.");
    if (!confirm(lines.join("\n\n"))) return;

    setScoresBusy(true);
    setScoresMsg("Deleting…");
    try {
      let q = supabase.from("scores").delete({ count: "exact" });
      q = roundId ? q.eq("round_id", roundId) : q.gte("created_at", "1970-01-01T00:00:00Z");
      const res = await q;
      if (res.error) {
        console.error(res.error);
        setScoresMsg(`Error deleting scores: ${errToText(res.error)}`);
        await loadScores();
        return;
      }
      if (nScores > 0 && !res.count) {
        // The database accepted the request but removed nothing: deleting scores isn't allowed.
        setScoresMsg("Nothing was deleted: the database refused. Reload and check the Leaderboard.");
        await loadScores();
        return;
      }
      let drinksGone = 0;
      if (dropDrinks) {
        let dq = supabase.from("drinks").delete({ count: "exact" });
        dq = roundId ? dq.eq("round_id", roundId) : dq.gte("created_at", "1970-01-01T00:00:00Z");
        const dres = await dq;
        if (dres.error) {
          console.error(dres.error);
          setScoresMsg(`Deleted ${plural(res.count || 0, "score")}, but the drinks could not be deleted: ${errToText(dres.error)}`);
          discardUnsentScores?.(roundId);
          await loadScores();
          await loadDrinks();
          return;
        }
        drinksGone = dres.count || 0;
        drinkLog?.clearPending?.(roundId);
      }
      discardUnsentScores?.(roundId); // so a retry on this phone can't bring deleted scores back
      await loadScores();
      if (dropDrinks) await loadDrinks();
      setScoresMsg(
        `Deleted ${plural(res.count || 0, "score")}${drinksGone ? ` and ${plural(drinksGone, "drink")}` : ""} ✅ Players and groups are untouched.`
      );
    } finally {
      setScoresBusy(false);
    }
  }

  async function clearFoursomes() {
    if (!adminOn) return alert("Admin only.");
    if (!confirm("Clear all foursomes + assignments? (Does not delete players or scores)")) return;

    const delFP = await supabase
      .from("foursome_players")
      .delete()
      .neq("foursome_id", "00000000-0000-0000-0000-000000000000");
    if (delFP.error) {
      console.error(delFP.error);
      alert(`Could not clear the assignments: ${errToText(delFP.error)}`);
      return;
    }

    const delF = await supabase
      .from("foursomes")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");
    if (delF.error) {
      console.error(delF.error);
      alert(`Could not clear the foursomes: ${errToText(delF.error)}`);
      await initialLoad();
      return;
    }

    await initialLoad();
  }

  return (
          <AdminSection
            title="⚠️ Danger Zone"
            danger
            open={openAdminSection === "danger"}
            onToggle={() => {
              // Opening the Danger Zone always asks for the passcode again.
              setDangerUnlocked(false);
              setDangerPin("");
              setDangerPinMsg("");
              setOpenAdminSection((k) => (k === "danger" ? null : "danger"));
            }}
          >
            {!dangerUnlocked ? (
              <div style={{ display: "grid", gap: 10, maxWidth: 360 }}>
                <div style={styles.helpText}>Enter the Admin passcode to open the Danger Zone.</div>
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  style={{ ...styles.input, fontSize: 16, minHeight: 46, boxSizing: "border-box" }}
                  value={dangerPin}
                  onChange={(e) => {
                    setDangerPin(e.target.value);
                    setDangerPinMsg("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") unlockDanger();
                  }}
                  placeholder="Passcode"
                />
                <button style={{ ...styles.bigBtn, minHeight: 48 }} onClick={unlockDanger}>
                  Unlock Danger Zone
                </button>
                {dangerPinMsg ? (
                  <div style={{ fontSize: 13, color: THEME.danger, fontWeight: 700 }}>{dangerPinMsg}</div>
                ) : null}
              </div>
            ) : (
              <>
            <div style={styles.helpText}>Every action below is irreversible. Each one asks you to confirm first.</div>

            <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
              <div>
                <div style={styles.sectionLabel}>Clear Foursomes</div>
                <div style={styles.helpText}>
                  Removes every foursome and player assignment for this event. Does not delete players or scores.
                </div>
                <button style={{ ...styles.dangerBtn, marginTop: 10 }} onClick={clearFoursomes}>
                  Clear Foursomes
                </button>
              </div>

              <div>
                <div style={styles.hr} />
                <div style={{ ...styles.sectionLabel, marginTop: 14 }}>Delete scores</div>
                <div style={styles.helpText}>
                  Removes the scores entered so far ({scopeScores.length} right now) so you can start the scoring over. Players,
                  groups, games and rounds are kept. Broadcast cards already posted stay until you clear them below.
                </div>
                {manyRounds ? (
                  <label style={{ ...styles.label, marginTop: 10 }}>
                    Which scores
                    <select style={styles.input} value={scoreScope} onChange={(e) => setScoreScope(e.target.value)}>
                      <option value="all">All rounds</option>
                      {rounds.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label} only
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {drinksTableReady ? (
                  <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, fontSize: 13 }}>
                    <input type="checkbox" checked={alsoDrinks} onChange={(e) => setAlsoDrinks(e.target.checked)} />
                    Also delete the logged drinks ({scopeDrinks.length})
                  </label>
                ) : null}
                <button
                  style={{ ...styles.dangerBtn, marginTop: 10, minHeight: 44, opacity: scoresBusy ? 0.6 : 1 }}
                  disabled={scoresBusy}
                  onClick={deleteScores}
                >
                  Delete scores
                </button>
                {scoresMsg ? <div style={styles.helpText}>{scoresMsg}</div> : null}
              </div>

              <div>
                <div style={styles.hr} />
                <div style={{ ...styles.sectionLabel, marginTop: 14 }}>Clear all messages</div>
                <div style={styles.helpText}>
                  Deletes every message on The Broadcast (and the TV Mode strip). Scores and players are not touched.
                </div>
                <button style={{ ...styles.dangerBtn, marginTop: 10, minHeight: 44 }} onClick={clearBroadcastMessages}>
                  Clear all messages
                </button>
                {clearMsg ? <div style={styles.helpText}>{clearMsg}</div> : null}
                {clearNeedsSetup ? <ClearMessagesSetupNotice /> : null}
              </div>

              <DeletePlayersPanel
                players={players}
                groupNameByPlayer={
                  new Map(
                    foursomePlayers
                      .filter((fp) => foursomes.some((f) => f.id === fp.foursome_id && (!f.round_id || f.round_id === activeRound?.id)))
                      .map((fp) => [fp.player_id, foursomes.find((f) => f.id === fp.foursome_id)?.group_name])
                  )
                }
                onDelete={deletePlayers}
              />

              {games.length > 0 && (
                <div>
                  <div style={styles.hr} />
                  <div style={{ ...styles.sectionLabel, marginTop: 14 }}>Delete a Game</div>
                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    {games.map((g) => (
                      <div
                        key={g.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <span style={{ fontSize: 13 }}>{g.name}</span>
                        <button style={styles.dangerBtn} onClick={() => deleteGame(g)}>
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {appSettings.multi_round_enabled && rounds.length > 0 && (
                <div>
                  <div style={styles.hr} />
                  <div style={{ ...styles.sectionLabel, marginTop: 14 }}>Delete a Round</div>
                  <div style={styles.helpText}>Also removes that round's foursomes and every score entered for it.</div>
                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    {rounds.map((r) => (
                      <div
                        key={r.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <span style={{ fontSize: 13 }}>{r.label}</span>
                        <button style={styles.dangerBtn} onClick={() => deleteRound(r)}>
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
              </>
            )}
          </AdminSection>
  );
}
