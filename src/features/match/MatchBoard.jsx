// Leaderboard view for a Match Play game: one card per match with live status and a hole-by-hole strip.

import { SIDE_COLOR } from "./sideColor";
import { ROUND_OVERALL } from "../../lib/config";
import { MATCH_TYPES, computeRyderCup } from "../../lib/matchPlay";
import { FONT_DISPLAY, THEME, styles } from "../../theme";

const fmtPts = (x) => {
  const whole = Math.floor(x + 1e-9);
  const half = Math.abs(x - whole - 0.5) < 1e-9;
  if (half) return whole === 0 ? "½" : `${whole}½`;
  return String(Math.round(x * 100) / 100);
};

/** Hole-by-hole strip: coloured by who won each hole, in the order the group plays. */
function MatchStrip({ result }) {
  const cells = Array.from({ length: 18 }, (_, i) => result.holes[i] || null);
  return (
    <div style={{ display: "flex", gap: 2, marginTop: 8 }} aria-hidden="true">
      {cells.map((c, i) => (
        <div
          key={i}
          title={c ? `Hole ${c.hole}` : ""}
          style={{
            flex: "1 1 0",
            maxWidth: 16,
            height: 8,
            borderRadius: 2,
            background: !c ? "transparent" : c.result === "a" ? SIDE_COLOR.a : c.result === "b" ? SIDE_COLOR.b : THEME.textFaint,
            border: c ? "none" : `1px solid ${THEME.border}`,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Leaderboard view for a Match Play / Ryder Cup game: the team score header
 * (Ryder Cup) and one card per match, grouped by session (round).
 * `entries` = [{ match, result, roundId }] already worked out from the scores.
 */
export function MatchBoard({ game, entries, rounds, selection, showSessions, sideNames }) {
  const isRyder = game.format === "ryder_cup";
  const shown = showSessions && selection && selection !== ROUND_OVERALL ? entries.filter((e) => e.roundId === selection) : entries;
  const roundIds = rounds.map((r) => r.id);
  const { overall } = computeRyderCup(shown, roundIds);
  const [nameA, nameB] = sideNames;
  const live = Math.abs(overall.projA - overall.a) > 1e-9 || Math.abs(overall.projB - overall.b) > 1e-9;

  const sessions = (showSessions ? rounds : [{ id: null, label: "" }])
    .map((r) => ({ round: r, items: shown.filter((e) => (r.id ? e.roundId === r.id : true)) }))
    .filter((s) => s.items.length > 0);

  return (
    <div style={{ display: "grid", gap: 12, marginTop: 4 }}>
      {isRyder && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
            alignItems: "center",
            gap: 10,
            padding: "14px 12px",
            borderRadius: 16,
            border: `1px solid ${THEME.border}`,
            background: "rgba(159, 119, 80, 0.10)",
          }}
        >
          {[
            { name: nameA, pts: overall.a, proj: overall.projA, color: SIDE_COLOR.a, align: "left" },
            null,
            { name: nameB, pts: overall.b, proj: overall.projB, color: SIDE_COLOR.b, align: "right" },
          ].map((s, i) =>
            s ? (
              <div key={i} style={{ textAlign: s.align, minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: s.color, overflowWrap: "anywhere" }}>{s.name}</div>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 40, lineHeight: 1.05, color: THEME.text }}>
                  {fmtPts(s.pts)}
                </div>
                {live && <div style={{ fontSize: 11, color: THEME.textMuted }}>live {fmtPts(s.proj)}</div>}
              </div>
            ) : (
              <div key={i} style={{ fontSize: 12, color: THEME.textMuted, textAlign: "center" }}>
                {overall.finished}/{overall.matches}
                <br />
                final
              </div>
            )
          )}
        </div>
      )}

      {sessions.length === 0 && (
        <div style={styles.helpText}>
          No matches yet. Add them in Admin → Games → this game → Manage matches.
        </div>
      )}

      {sessions.map(({ round, items }) => (
        <div key={round.id || "all"} style={{ display: "grid", gap: 8 }}>
          {showSessions && round.label ? (
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.6, textTransform: "uppercase", color: THEME.textMuted }}>
              {round.label}
            </div>
          ) : null}
          {items.map(({ match, result }) => {
            const type = MATCH_TYPES[match.match_type]?.label || match.match_type;
            const leaderColor = result.leader ? SIDE_COLOR[result.leader] : THEME.textMuted;
            return (
              <div key={match.id} style={{ ...styles.foursomeCard }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11, letterSpacing: 1.1, textTransform: "uppercase", fontWeight: 700, color: THEME.textMuted }}>
                  <span>{match.label || "Match"} · {type}</span>
                  {result.status === "final" ? <span>Final</span> : result.status === "in_progress" ? <span>Live</span> : null}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", gap: 8, alignItems: "center", marginTop: 8 }}>
                  <div style={{ fontWeight: result.winner === "a" || result.leader === "a" ? 900 : 700, color: SIDE_COLOR.a, overflowWrap: "anywhere", fontSize: 14 }}>
                    {result.nameA}
                  </div>
                  <div style={{ fontSize: 11, color: THEME.textFaint }}>vs</div>
                  <div style={{ textAlign: "right", fontWeight: result.winner === "b" || result.leader === "b" ? 900 : 700, color: SIDE_COLOR.b, overflowWrap: "anywhere", fontSize: 14 }}>
                    {result.nameB}
                  </div>
                </div>
                <div style={{ marginTop: 8, fontWeight: 900, fontSize: 15, color: result.status === "not_started" ? THEME.textMuted : leaderColor }}>
                  {result.text}
                </div>
                <MatchStrip result={result} />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
