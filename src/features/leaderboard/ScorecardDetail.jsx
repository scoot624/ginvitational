// Hole-by-hole scorecard shown inline under an expanded Leaderboard row.

import { PARS, STROKE_INDEX } from "../../lib/course";
import { strokesOnHoleForGame } from "../../lib/gameCalc";
import { clampInt, formatToPar } from "../../lib/golf";
import { THEME, styles } from "../../theme";

/**
 * Hole-by-hole scorecard, shown inline under a Leaderboard row when that
 * player is expanded (replaces the old full-screen modal).
 */
export function ScorecardDetail({ player, game }) {
  // The +/- row follows the game being viewed: Individual Gross counts every
  // stroke, Individual Net takes the game's handicap % off by Stroke Index.
  // With no game given (Simple Mode) it is plain net at 100%, as before.
  const isGross = game?.format === "individual_gross";
  const pct = clampInt(game?.handicap_pct, 100);

  // One entry per hole — computed once, then laid out as COLUMNS below
  // (holes running left-to-right, like a real scorecard) instead of rows.
  const holes = (() => {
    let cum = 0; // running cumulative to-par across holes (net or gross, per the game)

    return Array.from({ length: 18 }, (_, i) => i + 1).map((h) => {
      const par = PARS[h - 1];
      const sc = player.scoresByHole[h];
      const si = STROKE_INDEX[h - 1];
      const strokes = isGross ? 0 : strokesOnHoleForGame(player.playingHandicap, pct, h, STROKE_INDEX);

      const countedSc = sc != null ? sc - strokes : null;
      const netDiff = countedSc != null ? countedSc - par : null;
      if (netDiff != null) cum += netDiff;

      // The "+/-" row shows the running cumulative-to-par through this
      // hole (what used to be a separate "Total" row), so it's colored by
      // the cumulative's sign, not the single hole's.
      const cumStyle =
        netDiff == null
          ? {}
          : cum < 0
          ? { color: THEME.good, fontWeight: 900 }
          : cum > 0
          ? { color: THEME.bad, fontWeight: 900 }
          : { opacity: 0.9, fontWeight: 900 };

      return { h, par, sc, si, strokes, netDiff, cum, cumStyle };
    });
  })();

  // Front nine / back nine / full-round totals. Par is the full nine's par;
  // score and net only add up holes actually played (this is live scoring),
  // and read "—" until a hole in that stretch has a score.
  const sumRange = (from, to) => {
    const hs = holes.slice(from, to);
    const played = hs.filter((x) => x.sc != null);
    return {
      par: hs.reduce((a, x) => a + x.par, 0),
      score: played.length ? played.reduce((a, x) => a + x.sc, 0) : null,
      net: played.length ? played.reduce((a, x) => a + x.netDiff, 0) : null,
    };
  };
  // Holes 1–9, OUT, holes 10–18, IN, TOT — the usual scorecard order.
  const columns = [
    ...holes.slice(0, 9).map((hd) => ({ key: `h${hd.h}`, hd })),
    { key: "out", label: "OUT", sum: sumRange(0, 9) },
    ...holes.slice(9).map((hd) => ({ key: `h${hd.h}`, hd })),
    { key: "in", label: "IN", sum: sumRange(9, 18) },
    { key: "tot", label: "TOT", sum: sumRange(0, 18) },
  ];
  const netSumStyle = (n) =>
    n == null ? {} : n < 0 ? { color: THEME.good } : n > 0 ? { color: THEME.bad } : { opacity: 0.9 };

  // The row-label column is pinned (position: sticky) so it stays in view,
  // with a faint right-edge shadow so it visually reads as a "frozen" pane,
  // while the 18 hole columns scroll underneath it horizontally.
  const stickyShadow = "2px 0 4px rgba(0,0,0,0.10)";
  const labelHeadStyle = {
    ...styles.th,
    position: "sticky",
    left: 0,
    background: THEME.surface,
    boxShadow: stickyShadow,
    fontSize: 10,
    padding: "6px 8px",
    zIndex: 1,
  };
  const labelCellStyle = {
    ...styles.td,
    position: "sticky",
    left: 0,
    background: THEME.surface,
    boxShadow: stickyShadow,
    fontWeight: 800,
    fontSize: 11,
    padding: "6px 8px",
    zIndex: 1,
  };
  // table-layout: fixed (below) splits the remaining width evenly across
  // all 18 hole <col>s, so every hole lines up in a uniform grid — a
  // hole's own content (the stroke dot/"+") no longer makes its column
  // render wider or narrower than its neighbors.
  const headStyle = { ...styles.th, textAlign: "center", fontSize: 10, padding: "6px 4px" };
  const cellStyle = { ...styles.td, textAlign: "center", fontSize: 11, padding: "6px 4px" };
  // OUT / IN / TOT columns: bold on a faint tint so they read as totals.
  const sumTint = "rgba(22,35,29,0.06)";
  const sumHeadStyle = { ...headStyle, background: sumTint, fontWeight: 900 };
  const sumCellStyle = { ...cellStyle, background: sumTint, fontWeight: 800 };
  // Fixed-height slot under every hole number, whether or not that hole
  // has a stroke mark — this is what keeps the hole numbers themselves
  // sitting at the same height across every column.
  const markSlotStyle = { height: 9, display: "flex", alignItems: "center", justifyContent: "center" };

  return (
    <div style={{ padding: "10px 8px" }}>
      {/* overscrollBehaviorX stops a horizontal scroll here from chaining
          into the Leaderboard's own horizontally-scrollable table once this
          one hits its edge. */}
      <div style={{ width: "100%", overflowX: "auto", overscrollBehaviorX: "contain" }}>
        <table style={{ ...styles.table, tableLayout: "fixed", minWidth: 56 + 18 * 26 + 3 * 36 }}>
          <colgroup>
            <col style={{ width: 56 }} />
            {columns.map((c) => (
              <col key={c.key} style={{ width: c.hd ? 26 : 36 }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th style={labelHeadStyle}>Hole</th>
              {columns.map((c) =>
                c.hd ? (
                  <th key={c.key} style={headStyle}>
                    <span style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <span>{c.hd.h}</span>
                      <span style={markSlotStyle}>
                        {c.hd.strokes > 0 ? (
                          <span style={styles.strokeDot} />
                        ) : c.hd.strokes < 0 ? (
                          <span style={styles.giveBackMark}>+</span>
                        ) : null}
                      </span>
                    </span>
                  </th>
                ) : (
                  <th key={c.key} style={sumHeadStyle}>
                    <span style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <span>{c.label}</span>
                      <span style={markSlotStyle} />
                    </span>
                  </th>
                )
              )}
            </tr>
          </thead>

          <tbody>
            <tr>
              <td style={labelCellStyle}>SI</td>
              {columns.map((c) => (
                <td key={c.key} style={c.hd ? cellStyle : sumCellStyle}>
                  {c.hd ? c.hd.si : ""}
                </td>
              ))}
            </tr>
            <tr>
              <td style={labelCellStyle}>Par</td>
              {columns.map((c) => (
                <td key={c.key} style={c.hd ? cellStyle : sumCellStyle}>
                  {c.hd ? c.hd.par : c.sum.par}
                </td>
              ))}
            </tr>
            <tr>
              <td style={labelCellStyle}>Score</td>
              {columns.map((c) => (
                <td key={c.key} style={c.hd ? cellStyle : sumCellStyle}>
                  {c.hd ? (c.hd.sc != null ? c.hd.sc : "—") : c.sum.score != null ? c.sum.score : "—"}
                </td>
              ))}
            </tr>
            <tr>
              <td style={labelCellStyle}>+/-</td>
              {columns.map((c) =>
                c.hd ? (
                  <td key={c.key} style={{ ...cellStyle, ...c.hd.cumStyle }}>
                    {c.hd.netDiff == null ? "—" : formatToPar(c.hd.cum)}
                  </td>
                ) : (
                  <td key={c.key} style={{ ...sumCellStyle, fontWeight: 900, ...netSumStyle(c.sum.net) }}>
                    {c.sum.net == null ? "—" : formatToPar(c.sum.net)}
                  </td>
                )
              )}
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8, color: THEME.textMuted }}>
        {isGross
          ? "+/- is gross score vs par (no handicap strokes)."
          : `+/- is net score vs par, using ${pct === 100 ? "" : `${pct}% of the `}handicap by Stroke Index.`}
        {!isGross && pct !== 0 && player.playingHandicap < 0 && ' A "+" marks a hole where this plus handicap gives a stroke back.'}
      </div>
    </div>
  );
}
