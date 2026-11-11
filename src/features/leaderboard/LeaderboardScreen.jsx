import { rankCellContent } from "../../components/LeaderIcons";
import { DrinkBadge } from "../drinks/DrinkBadge";
import { LockedBoardPanel } from "./LockedBoardPanel";
import { expandChevronStyle, expandRowCellStyle } from "./rankStyles";
import { ScorecardDetail } from "./ScorecardDetail";
import { MatchBoard } from "../match/MatchBoard";
import { useEventDataContext } from "../../hooks/eventDataContext";
import { ROUND_OVERALL } from "../../lib/config";
import { GAME_SCORE_LABELS, isMatchFormat, isSharedBallFormat } from "../../lib/gameConfig";
import { formatToPar } from "../../lib/golf";
import { lastPlaceRank } from "../../lib/ranking";
import { THEME, netColorStyle, styles } from "../../theme";

// The Leaderboard screen: round and game tabs, and the board for the selected game.

export function LeaderboardScreen({ selectedRoundId, setSelectedRoundId, gameResults, selectedGameId, setSelectedGameId, unlockGameBoard, matchEntriesByGame, scorecardPlayerId, setScorecardPlayerId, scorecardPlayer }) {
  const {
    appSettings,
    rounds,
    loadPlayers,
    loadScores,
    loadRounds,
    loadGames,
    loadGameTeams,
    loadGameTeamMembers,
    leaderboardRows,
    activeRound,
  } = useEventDataContext();

  return (
          <div style={styles.card}>
            <div style={styles.cardHeaderRow}>
              <div style={styles.cardTitle}>Leaderboard</div>
              <button
                style={styles.smallBtn}
                onClick={async () => {
                  await loadPlayers();
                  await loadScores();
                  await loadGames();
                  await loadGameTeams();
                  await loadGameTeamMembers();
                  await loadRounds();
                }}
              >
                Refresh
              </button>
            </div>

            {/* Round tabs — only when multi-round is on with 2+ rounds. */}
            {appSettings.multi_round_enabled && rounds.length > 1 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                {[{ id: ROUND_OVERALL, label: "Overall" }, ...rounds.map((r) => ({ id: r.id, label: r.label }))].map(
                  (opt) => {
                    const isActive = selectedRoundId ? selectedRoundId === opt.id : opt.id === activeRound?.id;
                    return (
                      <button
                        key={opt.id}
                        style={isActive ? styles.tabBtnActive : styles.tabBtn}
                        onClick={() => setSelectedRoundId(opt.id)}
                      >
                        {opt.label}
                      </button>
                    );
                  }
                )}
              </div>
            )}

            {/* Game tabs — only when more than one game is active. A Simple
                Mode event (the common case) never sees this and renders
                exactly as before. */}
            {gameResults.length > 1 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                {gameResults.map(({ game }) => {
                  // No game is favored by default — the first active one
                  // (by sort order) shows until you pick a different tab.
                  const isActive = selectedGameId ? selectedGameId === game.id : game.id === gameResults[0]?.game.id;
                  return (
                    <button
                      key={game.id}
                      style={isActive ? styles.tabBtnActive : styles.tabBtn}
                      onClick={() => setSelectedGameId(game.id)}
                    >
                      {game.locked ? "🔒 " : ""}
                      {game.name}
                    </button>
                  );
                })}
              </div>
            )}

            {(() => {
              const showRoundTabs = appSettings.multi_round_enabled && rounds.length > 1;

              // Tighter cells than the app-wide table styles, just for the
              // Leaderboard — keeps Player + Score visible together on a
              // phone screen without horizontal scrolling.
              const lbTh = { ...styles.th, padding: "6px 6px", fontSize: 11 };
              const lbTd = { ...styles.td, padding: "8px 6px", fontSize: 13 };
              const lbPill = { ...styles.pill, minWidth: 22, padding: "3px 8px", fontSize: 11 };

              const lockCheckEntry =
                gameResults.length > 0
                  ? gameResults.find((g) => g.game.id === selectedGameId) || gameResults[0]
                  : null;

              if (lockCheckEntry && lockCheckEntry.game.locked) {
                return <LockedBoardPanel game={lockCheckEntry.game} onUnlock={unlockGameBoard} />;
              }

              if (!lockCheckEntry) {
                return <div style={styles.helpText}>No games configured yet.</div>;
              }

              if (isMatchFormat(lockCheckEntry.game.format)) {
                const mg = lockCheckEntry.game;
                const mcfg = mg.config || {};
                return (
                  <>
                    <div style={styles.helpText}>
                      {mg.format === "ryder_cup" ? "Ryder Cup" : "Match play"} — {mg.name}. Auto-refreshes every minute.
                    </div>
                    <MatchBoard
                      game={mg}
                      entries={matchEntriesByGame.get(mg.id) || []}
                      rounds={rounds}
                      selection={selectedRoundId || activeRound?.id}
                      showSessions={showRoundTabs}
                      sideNames={[mcfg.sideA?.name || "Side A", mcfg.sideB?.name || "Side B"]}
                    />
                  </>
                );
              }

              if (gameResults.length <= 1 && !showRoundTabs) {
                const lastRank = lastPlaceRank(leaderboardRows);
                return (
              <>
                <div style={styles.helpText}>
                  Tap a player name to view their scorecard. Auto-refreshes every minute.
                </div>

                <div style={styles.tableWrap}>
                  {/* table-layout: fixed + explicit column widths — without
                      this, an expanded player's 18-hole scorecard (below,
                      in a colSpan cell) would force this whole table, and
                      everything above it, as wide as all 18 holes instead
                      of scrolling inside its own row. */}
                  <table style={{ ...styles.table, tableLayout: "fixed", minWidth: 0 }}>
                    <thead>
                      <tr>
                        <th style={{ ...lbTh, width: "16%" }}>#</th>
                        <th style={{ ...lbTh, width: "44%" }}>Player</th>
                        <th style={{ ...lbTh, width: "22%", textAlign: "center" }}>Net vs Par</th>
                        <th style={{ ...lbTh, width: "18%", textAlign: "center" }}>Holes</th>
                      </tr>
                    </thead>

                    <tbody>
                      {leaderboardRows.map((r, idx) => {
                        const displayNet = r.holesPlayed === 0 ? "—" : formatToPar(r.netToPar);
                        const netStyle =
                          r.holesPlayed === 0
                            ? { opacity: 0.6, color: THEME.textMuted }
                            : { fontWeight: 950, ...netColorStyle(r.netToPar) };

                        const expanded = r.id === scorecardPlayerId;

                        return [
                          <tr key={r.id}>
                            <td style={{ ...lbTd, padding: "8px 2px 8px 6px" }}>{rankCellContent(r, idx, lastRank)}</td>

                            <td style={{ ...lbTd, minWidth: 120 }}>
                              <button
                                style={{ ...styles.playerLink, display: "inline-flex", alignItems: "center", gap: 6 }}
                                onClick={() => setScorecardPlayerId((id) => (id === r.id ? null : r.id))}
                              >
                                {r.name}
                                <span style={expandChevronStyle(expanded)}>▸</span>
                              </button>
                              <div style={styles.playerMeta}>
                                HCP {r.handicap}
                                {r.charity ? ` • ${r.charity}` : ""}
                              </div>
                              <DrinkBadge playerId={r.id} roundId={activeRound?.id} holesPlayed={r.holesPlayed} />
                            </td>

                            <td style={{ ...lbTd, textAlign: "center" }}>
                              <span style={netStyle}>{displayNet}</span>
                            </td>

                            <td style={{ ...lbTd, textAlign: "center" }}>
                              <span style={lbPill}>{r.holesPlayed}</span>
                            </td>
                          </tr>,
                          expanded && (
                            <tr key={`${r.id}-detail`}>
                              <td colSpan={4} style={expandRowCellStyle}>
                                <ScorecardDetail player={scorecardPlayer} game={null} />
                              </td>
                            </tr>
                          ),
                        ];
                      })}

                      {leaderboardRows.length === 0 && (
                        <tr>
                          <td style={lbTd} colSpan={4}>
                            No players yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
                );
              }

              const { game, rows } = lockCheckEntry;
              const lastRank = lastPlaceRank(rows);
              const isTeamFormat =
                game.format === "better_ball_2" ||
                game.format === "better_ball_4" ||
                isSharedBallFormat(game.format) ||
                game.format === "composite";
              const scoreLabel = GAME_SCORE_LABELS[game.format] || "Score vs Par";

              return (
                  <>
                    <div style={styles.helpText}>
                      {isTeamFormat
                        ? `Team leaderboard for ${game.name}.`
                        : "Tap a player name to view their scorecard."}{" "}
                      Auto-refreshes every minute.
                    </div>

                    <div style={styles.tableWrap}>
                      {/* table-layout: fixed — see the matching comment on
                          the simple leaderboard table above. */}
                      <table style={{ ...styles.table, tableLayout: "fixed", minWidth: 0 }}>
                        <thead>
                          <tr>
                            <th style={{ ...lbTh, width: "16%" }}>#</th>
                            <th style={{ ...lbTh, width: "44%" }}>{isTeamFormat ? "Team" : "Player"}</th>
                            <th style={{ ...lbTh, width: "22%", textAlign: "center" }}>{scoreLabel}</th>
                            <th style={{ ...lbTh, width: "18%", textAlign: "center" }}>Holes</th>
                          </tr>
                        </thead>

                        <tbody>
                          {rows.map((r, idx) => {
                            const displayScore = r.holesPlayed === 0 ? "—" : formatToPar(r.toPar);
                            const scoreStyle =
                              r.holesPlayed === 0
                                ? { opacity: 0.6, color: THEME.textMuted }
                                : { fontWeight: 950, ...netColorStyle(r.toPar) };

                            const expanded = !isTeamFormat && r.id === scorecardPlayerId;

                            return [
                              <tr key={r.id}>
                                <td style={{ ...lbTd, padding: "8px 2px 8px 6px" }}>{rankCellContent(r, idx, lastRank)}</td>

                                <td style={{ ...lbTd, minWidth: 120 }}>
                                  {isTeamFormat ? (
                                    <>
                                      <div style={{ fontWeight: 950 }}>{r.name}</div>
                                      <div style={styles.playerMeta}>
                                        {r.members.map((m) => `${m.name} (HCP ${m.handicap})`).join(" • ")}
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        style={{
                                          ...styles.playerLink,
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: 6,
                                        }}
                                        onClick={() => setScorecardPlayerId((id) => (id === r.id ? null : r.id))}
                                      >
                                        {r.name}
                                        <span style={expandChevronStyle(expanded)}>▸</span>
                                      </button>
                                      <div style={styles.playerMeta}>
                                        HCP {r.handicap}
                                        {r.charity ? ` • ${r.charity}` : ""}
                                      </div>
                                      <DrinkBadge
                                        playerId={r.id}
                                        roundId={selectedRoundId === ROUND_OVERALL ? null : selectedRoundId || activeRound?.id}
                                        holesPlayed={r.holesPlayed}
                                      />
                                    </>
                                  )}
                                </td>

                                <td style={{ ...lbTd, textAlign: "center" }}>
                                  <span style={scoreStyle}>{displayScore}</span>
                                </td>

                                <td style={{ ...lbTd, textAlign: "center" }}>
                                  <span style={lbPill}>{r.holesPlayed}</span>
                                </td>
                              </tr>,
                              expanded && (
                                <tr key={`${r.id}-detail`}>
                                  <td colSpan={4} style={expandRowCellStyle}>
                                    <ScorecardDetail player={scorecardPlayer} game={game} />
                                  </td>
                                </tr>
                              ),
                            ];
                          })}

                          {rows.length === 0 && (
                            <tr>
                              <td style={lbTd} colSpan={4}>
                                No {isTeamFormat ? "teams" : "players"} yet.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
              );
            })()}
          </div>
  );
}
