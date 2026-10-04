import { useState } from "react";
import { AdminSection } from "../../components/AdminSection";
import { ClearMessagesSetupNotice } from "../../components/SetupNotices";
import { DeletePlayersPanel } from "../roster/DeletePlayersPanel";
import { useEventDataContext } from "../../hooks/eventDataContext";
import { ADMIN_PIN } from "../../lib/config";
import { supabase } from "../../lib/supabase";
import { errToText } from "../../lib/util";
import { THEME, styles } from "../../theme";

// Admin → Danger Zone (behind the Admin passcode): clear foursomes, clear Broadcast messages, delete players, games and rounds.

export function DangerZoneSection({ adminOn, openAdminSection, setOpenAdminSection, deleteGame, deleteRound }) {
  const {
    players,
    games,
    appSettings,
    rounds,
    broadcastMsgs,
    foursomes,
    foursomePlayers,
    loadBroadcast,
    initialLoad,
    activeRound,
  } = useEventDataContext();

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
