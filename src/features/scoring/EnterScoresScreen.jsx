import { useEventDataContext } from "../../hooks/eventDataContext";
import { PARS } from "../../lib/course";
import { clampInt } from "../../lib/golf";
import { THEME, styles } from "../../theme";

// Enter Scores, step 2: type each hole for your group.

export function EnterScoresScreen({ activeFoursome, setActiveFoursome, setActivePlayers, setEntryCode, setTab, hole, roundComplete, setRoundComplete, saveHoleThenNavigate, holeEntryGroups, activePlayers, holeInputs, setHoleInputs }) {
  const {
    appSettings,
    rounds,
  } = useEventDataContext();

  return (
          <div style={styles.card}>
            <div style={styles.cardHeaderRow}>
              <div>
                <div style={styles.cardTitle}>Enter Scores</div>
                <div style={{ fontSize: 12, color: THEME.textMuted, marginTop: 6 }}>
                  Foursome: <b>{activeFoursome?.group_name}</b> • Code: <b>{activeFoursome?.code}</b>
                  {appSettings.multi_round_enabled && activeFoursome && (
                    <>
                      {" "}
                      • Round: <b>{rounds.find((r) => r.id === activeFoursome.round_id)?.label || "—"}</b>
                    </>
                  )}
                </div>
              </div>
              <button
                style={styles.smallBtn}
                onClick={() => {
                  setActiveFoursome(null);
                  setActivePlayers([]);
                  setEntryCode("");
                  setTab("code");
                }}
              >
                Change Code
              </button>
            </div>

            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              {(() => {
                // Shotgun start: a group can start on any hole, plays 18 in
                // order from there, and wraps around (e.g. start on 10 ->
                // 10,11,...,18,1,2,...,9). "Last Hole"/"Save & Next" wrap
                // through 1<->18 instead of stopping dead at the ends, and
                // "starting hole" — not hole 1 — is this group's true start.
                const startingHole = clampInt(activeFoursome?.starting_hole, 1);
                const prevHole = hole === 1 ? 18 : hole - 1;
                const nextHole = hole === 18 ? 1 : hole + 1;

                if (roundComplete) {
                  return (
                    <div style={{ display: "grid", gap: 10 }}>
                      <div style={{ fontSize: 18, fontWeight: 950 }}>All 18 holes entered ✅</div>
                      <div style={styles.helpText}>
                        Your group is all set. Tap below if you need to go back and fix a hole.
                      </div>
                      <button
                        style={styles.smallBtn}
                        onClick={() => {
                          setRoundComplete(false);
                          saveHoleThenNavigate(prevHole);
                        }}
                      >
                        Review Last Hole
                      </button>
                    </div>
                  );
                }

                return (
                  <>
                    <div style={{ fontSize: 18, fontWeight: 950 }}>
                      Hole {hole}{" "}
                      <span style={{ opacity: 0.75, fontWeight: 700 }}>(Par {PARS[hole - 1]})</span>
                    </div>

                    <div style={{ display: "grid", gap: 10 }}>
                      {holeEntryGroups(hole, activePlayers).map((grp) => (
                        <div key={grp.key} style={styles.scoreRow}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis" }}>
                              {grp.players.map((p) => p.name).join(" / ")}
                            </div>
                            <div style={{ fontSize: 12, color: THEME.textMuted }}>
                              {grp.shared
                                ? "Team score — one shared ball"
                                : `HCP ${clampInt(grp.players[0].handicap, 0)}`}
                            </div>
                          </div>

                          <input
                            style={{ ...styles.input, width: 92, textAlign: "center", fontSize: 16, fontWeight: 900 }}
                            inputMode="numeric"
                            placeholder="—"
                            value={holeInputs[grp.players[0].id] ?? ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              setHoleInputs((prev) => {
                                const next = { ...prev };
                                for (const p of grp.players) next[p.id] = val;
                                return next;
                              });
                            }}
                          />
                        </div>
                      ))}
                    </div>

                    <div style={styles.navRow}>
                      <button
                        style={styles.smallBtn}
                        disabled={hole === startingHole}
                        onClick={() => saveHoleThenNavigate(prevHole)}
                      >
                        Last Hole
                      </button>

                      <button
                        style={styles.bigBtn}
                        onClick={async () => {
                          const saved = await saveHoleThenNavigate(nextHole);
                          if (saved && nextHole === startingHole) setRoundComplete(true);
                        }}
                      >
                        {nextHole === startingHole ? "Save & Finish" : "Save & Next"}
                      </button>
                    </div>

                    <div style={styles.helpText}>
                      Type scores for your foursome, then hit <b>Save & Next</b>. You can go back with{" "}
                      <b>Last Hole</b>. Leaving a box blank means “no score yet”.
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
  );
}
