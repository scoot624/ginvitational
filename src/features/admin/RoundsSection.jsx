import { AdminSection } from "../../components/AdminSection";
import { useEventDataContext } from "../../hooks/eventDataContext";
import { THEME, styles } from "../../theme";

// Admin → Rounds: turn on multiple rounds, add rounds, choose the active one.

export function RoundsSection({ openAdminSection, setOpenAdminSection, setMultiRoundEnabled, setRoundActive, newRoundLabel, setNewRoundLabel, createRound, roundsMsg }) {
  const {
    appSettings,
    rounds,
  } = useEventDataContext();

  return (
          <AdminSection
            title="Rounds"
            subtitle={
              appSettings.multi_round_enabled
                ? `${rounds.length} round${rounds.length === 1 ? "" : "s"}`
                : "Single round"
            }
            open={openAdminSection === "rounds"}
            onToggle={() => setOpenAdminSection((k) => (k === "rounds" ? null : "rounds"))}
          >
            <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, color: THEME.textMuted }}>
              <input
                type="checkbox"
                checked={!!appSettings.multi_round_enabled}
                onChange={(e) => setMultiRoundEnabled(e.target.checked)}
              />
              Enable multiple rounds for this event
            </label>

            {!appSettings.multi_round_enabled ? (
              <div style={styles.helpText}>
                Off by default. This event runs one round, same as always. Turn this on for a 2-day/3-day event —
                each round gets its own tee sheet import, and the Leaderboard gets an Overall total plus a tab per
                round.
              </div>
            ) : (
              <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
                <div style={{ display: "grid", gap: 10 }}>
                  {rounds.map((r) => (
                    <div key={r.id} style={styles.foursomeCard}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ fontWeight: 950 }}>
                          {r.label}{" "}
                          {r.is_active && <span style={{ ...styles.strokePill, marginLeft: 6 }}>Active</span>}
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {!r.is_active && (
                            <button style={styles.smallBtn} onClick={() => setRoundActive(r)}>
                              Set Active
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={styles.hr} />

                <div style={styles.sectionLabel}>Add Round</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <input
                    style={{ ...styles.input, flex: 1, minWidth: 160 }}
                    value={newRoundLabel}
                    onChange={(e) => setNewRoundLabel(e.target.value)}
                    placeholder={`Round ${rounds.length + 1}`}
                  />
                  <button style={styles.bigBtn} onClick={createRound}>
                    Add Round
                  </button>
                </div>
                {roundsMsg ? <div style={styles.helpText}>{roundsMsg}</div> : null}

                <div style={styles.helpText}>
                  "Active" is the round Enter Scores codes and new tee-sheet imports default to, and the round The
                  Broadcast and player scorecards track. The Leaderboard's Overall tab and per-round tabs show every
                  round regardless of which one is active.
                </div>
              </div>
            )}
          </AdminSection>
  );
}
