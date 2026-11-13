// Hole-by-hole scorecard for a TEAM, shown inline under an expanded team row on the Leaderboard.
// Holes a pair plays their own balls show each player's score; scramble / alternate-shot holes show the one team ball.
// "Team" is the score that counts on the hole (net), and "+/-" is the running total against the team's par.

import { StrokeDots, WithStrokes } from "../../components/StrokeMarks";
import { useEventDataContext } from "../../hooks/eventDataContext";
import { PARS, STROKE_INDEX } from "../../lib/course";
import { drinksOnHole } from "../../lib/drinks";
import { formatToPar, surname } from "../../lib/golf";
import { THEME, styles } from "../../theme";

export function TeamScorecardDetail({ row, roundId }) {
  const { drinking, drinksView } = useEventDataContext();
  const detail = row.detailByHole || {};
  const marks = row.marksByHole || {};
  const members = row.members || [];
  const drinksOn = drinking.enabled && !!roundId;

  // One entry per hole, then laid out as columns (holes left to right, like a real scorecard).
  const holes = Array.from({ length: 18 }, (_, i) => i + 1).map((h) => {
    const d = detail[h] || null;
    const m = marks[h] || null;
    return {
      h,
      si: STROKE_INDEX[h - 1],
      d,
      m, // what the hole looks like for this team (shared ball or own balls, and who gets a stroke), scored or not
      par: m ? m.par : d ? d.par : PARS[h - 1], // the team's par (two scores added = two pars)
      drinks: drinksOn ? members.reduce((a, m) => a + drinksOnHole(drinksView, m.id, roundId, h), 0) : 0,
    };
  });
  const showDrinks = holes.some((x) => x.drinks > 0); // the 🍺 row only appears once somebody on the team has had a drink
  let cum = 0;
  for (const x of holes) {
    if (!x.d) continue;
    cum += x.d.counted - x.d.par;
    x.cum = cum;
  }
  const isShared = (x) => (x.m ? x.m.shared : !!(x.d && x.d.shared));
  const isSolo = (x) => (x.m ? !x.m.shared : !!(x.d && !x.d.shared));
  const anyShared = holes.some(isShared);
  const anySolo = holes.some(isSolo);
  const anyStrokes = holes.some((x) => x.m && (x.m.ballStrokes || Object.values(x.m.strokes || {}).some(Boolean)));

  // Totals for a stretch of holes (OUT / IN / TOT): only holes that have been scored count toward scores.
  const sumRange = (from, to) => {
    const hs = holes.slice(from, to);
    const played = hs.filter((x) => x.d);
    const grossFor = (m) => {
      const own = played.filter((x) => !x.d.shared && x.d.grosses[m.id] != null);
      return own.length ? own.reduce((a, x) => a + x.d.grosses[m.id], 0) : null;
    };
    const ball = played.filter((x) => x.d.shared);
    return {
      par: hs.reduce((a, x) => a + x.par, 0),
      counted: played.length ? played.reduce((a, x) => a + x.d.counted, 0) : null,
      net: played.length ? played.reduce((a, x) => a + x.d.counted - x.d.par, 0) : null,
      ball: ball.length ? ball.reduce((a, x) => a + x.d.gross, 0) : null,
      member: Object.fromEntries(members.map((m) => [m.id, grossFor(m)])),
      drinks: hs.reduce((a, x) => a + x.drinks, 0),
    };
  };
  const columns = [
    ...holes.slice(0, 9).map((hd) => ({ key: `h${hd.h}`, hd })),
    { key: "out", label: "OUT", sum: sumRange(0, 9) },
    ...holes.slice(9).map((hd) => ({ key: `h${hd.h}`, hd })),
    { key: "in", label: "IN", sum: sumRange(9, 18) },
    { key: "tot", label: "TOT", sum: sumRange(0, 18) },
  ];
  const show = (v) => (v == null || v === "" ? "" : v);
  const netColor = (n) => (n == null ? {} : n < 0 ? { color: THEME.good } : n > 0 ? { color: THEME.bad } : { opacity: 0.9 });

  const LABEL_W = 72;
  const stickyShadow = "2px 0 4px rgba(0,0,0,0.10)";
  const labelBase = {
    position: "sticky",
    left: 0,
    background: THEME.surface,
    boxShadow: stickyShadow,
    padding: "6px 8px",
    zIndex: 1,
    maxWidth: LABEL_W,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
  const labelHeadStyle = { ...styles.th, ...labelBase, fontSize: 10 };
  const labelCellStyle = { ...styles.td, ...labelBase, fontWeight: 800, fontSize: 11 };
  const headStyle = { ...styles.th, textAlign: "center", fontSize: 10, padding: "6px 4px" };
  const cellStyle = { ...styles.td, textAlign: "center", fontSize: 11, padding: "6px 4px" };
  const sumTint = "rgba(22,35,29,0.06)";
  const sumHeadStyle = { ...headStyle, background: sumTint, fontWeight: 900 };
  const sumCellStyle = { ...cellStyle, background: sumTint, fontWeight: 800 };

  // Rows between Par and the team total: the shared ball, each player's own ball, drinks.
  const lines = [
    { label: "SI", hole: (x) => x.si, sum: () => "" },
    { label: "Par", hole: (x) => x.par, sum: (s) => s.par },
    ...(anyShared
      ? [
          {
            label: "Team ball",
            hole: (x) => (isShared(x) ? <WithStrokes n={x.m ? x.m.ballStrokes : 0}>{x.d && x.d.shared ? x.d.gross : ""}</WithStrokes> : ""),
            sum: (s) => show(s.ball),
          },
        ]
      : []),
    ...(anySolo
      ? members.map((m) => ({
          label: surname(m.name),
          hole: (x) =>
            isSolo(x) ? (
              <WithStrokes n={x.m && x.m.strokes ? x.m.strokes[m.id] : 0}>{x.d && !x.d.shared && x.d.grosses[m.id] != null ? x.d.grosses[m.id] : ""}</WithStrokes>
            ) : (
              ""
            ),
          sum: (s) => show(s.member[m.id]),
        }))
      : []),
    ...(showDrinks ? [{ label: "🍺", hole: (x) => (x.drinks > 0 ? x.drinks : ""), sum: (s) => (s.drinks > 0 ? s.drinks : "") }] : []),
    { label: "Team", hole: (x) => (x.d ? x.d.counted : ""), sum: (s) => show(s.counted), bold: true },
  ];

  return (
    <div style={{ padding: "10px 8px" }}>
      <div style={{ width: "100%", overflowX: "auto", overscrollBehaviorX: "contain" }}>
        <table style={{ ...styles.table, tableLayout: "fixed", minWidth: LABEL_W + 18 * 26 + 3 * 36 }}>
          <colgroup>
            <col style={{ width: LABEL_W }} />
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
                    {c.hd.h}
                  </th>
                ) : (
                  <th key={c.key} style={sumHeadStyle}>
                    {c.label}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {lines.map((ln) => (
              <tr key={ln.label}>
                <td style={labelCellStyle}>{ln.label}</td>
                {columns.map((c) => (
                  <td key={c.key} style={{ ...(c.hd ? cellStyle : sumCellStyle), ...(ln.bold ? { fontWeight: 900 } : null) }}>
                    {c.hd ? ln.hole(c.hd) : ln.sum(c.sum)}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <td style={labelCellStyle}>+/-</td>
              {columns.map((c) =>
                c.hd ? (
                  <td
                    key={c.key}
                    style={{
                      ...cellStyle,
                      fontWeight: 900,
                      ...(c.hd.d ? (c.hd.cum < 0 ? { color: THEME.good } : c.hd.cum > 0 ? { color: THEME.bad } : { opacity: 0.9 }) : null),
                    }}
                  >
                    {c.hd.d ? formatToPar(c.hd.cum) : "—"}
                  </td>
                ) : (
                  <td key={c.key} style={{ ...sumCellStyle, fontWeight: 900, ...netColor(c.sum.net) }}>
                    {c.sum.net == null ? "—" : formatToPar(c.sum.net)}
                  </td>
                )
              )}
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8, color: THEME.textMuted }}>
        Team is the score that counts on each hole (net, after handicap strokes
        {showDrinks && drinking.variant === "credit" ? " and drink credit" : ""}). +/- is the running total against the team's par.
        {anyShared ? " Team ball is the one score the pair posts for a scramble or alternate-shot hole." : ""}
        {anyStrokes ? " A dot marks a handicap stroke (a stroke the player, or the team ball, gets on that hole)." : ""}
      </div>
    </div>
  );
}
