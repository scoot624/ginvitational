// Print scorecards on landscape sheets at 100% scale.
// A team game prints one card per team, laid out like the Leaderboard's scorecard (holes across the top, a row for each
// thing to write down), two stacked on each sheet. An individual game prints one card per playing group, two side by
// side. See lib/printCards for what goes on each card.

import { STROKE_INDEX, strokesOnHole } from "../../lib/course";
import { isSharedBallFormat } from "../../lib/gameConfig";
import { clampInt, hcpLabel, lastName, surname } from "../../lib/golf";
import { buildPrintCards, teamCardLayout } from "../../lib/printCards";
import { formatTeeTime } from "../../lib/teeSheet";
import { FONT_DISPLAY } from "../../theme";

export function PrintTwoUpScorecards({ foursomes, players, foursomePlayers, gameTeams, gameTeamMembers, eventName, logoSrc, game, fieldOffset }) {
  const cards = buildPrintCards({ foursomes, players, foursomePlayers, game, gameTeams, gameTeamMembers, fieldOffset });

  // Everyone starting on the same hole (just different tee times) → the tee
  // time is what tells the cards apart, so print that. If starting holes
  // differ (shotgun / split tees) → print the starting hole instead.
  const startHoles = new Set(foursomes.map((f) => String(f.starting_hole ?? "").trim() || "1"));
  const showTeeTime = startHoles.size <= 1;

  // Team cards are wide (holes across the page): two stacked per sheet. Group cards are tall: two side by side per sheet.
  const pairUp = (list) => {
    const out = [];
    for (let i = 0; i < list.length; i += 2) out.push([list[i], list[i + 1] || null]);
    return out;
  };
  const teamPages = pairUp(cards.filter((c) => c.kind === "team"));
  const groupPages = pairUp(cards.filter((c) => c.kind !== "team"));
  const teamCard = (card) => (
    <PrintTeamCard card={card} showTeeTime={showTeeTime} eventName={eventName} logoSrc={logoSrc} game={game} fieldOffset={fieldOffset} />
  );
  const groupCard = (card) => (
    <PrintOneGroupCard f={card.f} members={card.members} showTeeTime={showTeeTime} eventName={eventName} logoSrc={logoSrc} game={game} fieldOffset={fieldOffset} />
  );

  return (
    <div id="printRoot" style={ps.root}>
      {teamPages.map((pair, idx) => (
        <div className="printPage" key={`team-${idx}`} style={ps.page}>
          <div style={ps.stack}>
            {pair[0] && teamCard(pair[0])}
            {pair[1] && teamCard(pair[1])}
          </div>
        </div>
      ))}
      {groupPages.map((pair, idx) => (
        <div className="printPage" key={`group-${idx}`} style={ps.page}>
          <div style={ps.twoUpRow}>
            <div style={ps.col}>{pair[0] && groupCard(pair[0])}</div>

            <div style={ps.col}>{pair[1] && groupCard(pair[1])}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Title, group / team details and logo at the top of a card. `teamLabel` adds a "Team:" line; `note` adds a small grey line. */
function CardHeader({ f, showTeeTime, eventName, logoSrc, game, offset, teamLabel, note }) {
  const g = f || {};
  return (
    <div style={ps.headerRow}>
      <div style={{ flex: "1 1 0", minWidth: 0 }}>
        <div style={ps.title}>{eventName || "The Ginvitational"}</div>

        {/* Meta block */}
        <div style={ps.metaBlock}>
          {teamLabel ? (
            <div style={ps.metaLine}>
              <span style={ps.metaLabel}>Team:</span> <span style={{ fontWeight: 700 }}>{teamLabel}</span>
            </div>
          ) : null}
          <div style={ps.metaLine}>
            <span style={ps.metaLabel}>Group Name:</span> <span>{g.group_name || ""}</span>
          </div>
          {/* Only the detail that tells the groups apart: tee time when everyone
              starts on the same hole, otherwise the starting hole. */}
          {showTeeTime ? (
            <div style={ps.metaLine}>
              <span style={ps.metaLabel}>Tee Time:</span> <span>{formatTeeTime(g.tee_time)}</span>
            </div>
          ) : (
            <div style={ps.metaLine}>
              <span style={ps.metaLabel}>Starting Hole:</span> <span>{g.starting_hole || ""}</span>
            </div>
          )}
          <div style={ps.metaLine}>
            <span style={ps.metaLabel}>Handicap:</span>{" "}
            <span>
              {game ? game.name : "Course Handicap"}
              {game && game.format !== "composite" && !isSharedBallFormat(game.format)
                ? ` • ${clampInt(game.handicap_pct, 100)}% allocation`
                : ""}
              {offset !== 0 ? " • Field-Relative" : ""}
            </span>
          </div>
          {note ? <div style={{ ...ps.metaLine, fontSize: 10, opacity: 0.75 }}>{note}</div> : null}
        </div>
      </div>

      <img src={logoSrc} alt="" style={ps.logo} />
    </div>
  );
}

/** The group code row at the bottom of a card (it is what opens the group on the Enter Scores screen). */
function CardFooter({ f }) {
  return (
    <div style={ps.bottomRow}>
      <div style={ps.bottomInner}>
        <span style={{ fontWeight: 700 }}>Group Code</span>
        <span style={{ marginLeft: 10, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
          {(f && f.code) || ""}
        </span>
      </div>
    </div>
  );
}

/**
 * One scorecard for one TEAM, laid out like the Leaderboard's scorecard: holes across the top and a row for each thing to
 * write down (what the rows are is worked out in lib/printCards teamCardLayout). Greyed cells are holes a row doesn't
 * apply to; dots mark handicap strokes; the Out / In / Total columns sit where they do on the Leaderboard.
 */
export function PrintTeamCard({ card, showTeeTime, eventName, logoSrc, game, fieldOffset }) {
  const layout = teamCardLayout(card);
  const g = card.f || {};
  const offset = clampInt(fieldOffset, 0);
  const who = (p) => `${surname(p.name)} (${hcpLabel(p.handicap)})`;
  const dotStr = (k) => (k > 0 ? "•".repeat(k) : k < 0 ? "+".repeat(-k) : "");

  // columns: holes 1-9, OUT, holes 10-18, IN, TOT
  const holeNums = Array.from({ length: 18 }, (_, i) => i + 1);
  const cols = [
    ...holeNums.slice(0, 9).map((h) => ({ key: `h${h}`, hole: h })),
    { key: "out", label: "OUT", from: 0, to: 9 },
    ...holeNums.slice(9).map((h) => ({ key: `h${h}`, hole: h })),
    { key: "in", label: "IN", from: 9, to: 18 },
    { key: "tot", label: "TOT", from: 0, to: 18 },
  ];
  const parSum = (from, to) => layout.parRow.slice(from, to).reduce((a, b) => a + b, 0);
  // roomy boxes to write in; a card with lots of rows (a 4-person team with shared holes) gets slightly shorter ones so two still fit a sheet
  const boxH = layout.rows.length <= 5 ? 36 : 28;

  return (
    <div style={ps.wideCard}>
      <div style={ps.wideHeader}>
        <div style={{ flex: "1 1 0", minWidth: 0 }}>
          <div style={ps.wideTitle}>{eventName || "The Ginvitational"}</div>
          <div style={ps.wideMeta}>
            <b>Team:</b> {card.members.map(who).join(" / ")}
          </div>
          <div style={ps.wideMeta}>
            Group {g.group_name || ""} • {showTeeTime ? `Tee time ${formatTeeTime(g.tee_time)}` : `Starting hole ${g.starting_hole || ""}`} • Handicap:{" "}
            {game ? game.name : "Course Handicap"}
            {offset !== 0 ? " • Field-Relative" : ""}
          </div>
        </div>
        <div style={ps.wideSide}>
          <img src={logoSrc} alt="" style={ps.wideLogo} />
          <div style={ps.wideCode}>
            <b>Group Code</b>{" "}
            <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>{g.code || ""}</span>
          </div>
        </div>
      </div>

      <table style={ps.wideTable}>
        <colgroup>
          <col style={{ width: "13%" }} />
          {cols.map((c) => (
            <col key={c.key} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th style={ps.wLabelHead}>Hole</th>
            {cols.map((c) => (
              <th key={c.key} style={c.hole ? ps.wHead : { ...ps.wHead, ...ps.wTotalTint }}>
                {c.hole || c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={ps.wLabel}>H.I</td>
            {cols.map((c) => (
              <td key={c.key} style={c.hole ? ps.wSmall : { ...ps.wSmall, ...ps.wTotalTint }}>
                {c.hole ? STROKE_INDEX[c.hole - 1] : ""}
              </td>
            ))}
          </tr>
          <tr>
            <td style={ps.wLabel}>Par</td>
            {cols.map((c) => (
              <td key={c.key} style={c.hole ? ps.wSmall : { ...ps.wSmall, ...ps.wTotalTint, fontWeight: 700 }}>
                {c.hole ? layout.parRow[c.hole - 1] : parSum(c.from, c.to)}
              </td>
            ))}
          </tr>
          {layout.rows.map((row) => (
            <tr key={row.key}>
              <td style={ps.wLabel}>{row.player ? who(row.player) : row.label}</td>
              {cols.map((c) => {
                if (!c.hole) return row.totals === "box" ? <td key={c.key} style={ps.wBox}><div style={{ ...ps.wWrite, height: boxH }} /></td> : <td key={c.key} style={ps.wHatch} />;
                const cell = row.cells[c.hole - 1];
                if (!cell.box) return <td key={c.key} style={ps.wHatch} />;
                return (
                  <td key={c.key} style={ps.wBox}>
                    <div style={{ ...ps.wWrite, height: boxH }} />
                    <div style={ps.wDots}>{dotStr(cell.dots)}</div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PrintOneGroupCard({ f, members, showTeeTime, eventName, logoSrc, game, fieldOffset }) {
  const cols = [0, 1, 2, 3].map((i) => members[i] || null);
  const offset = clampInt(fieldOffset, 0);

  // The handicap % that applies to hole `h` for the selected game. A simple
  // format (Individual Net/Gross, Better Ball) uses one flat % for every
  // hole. A composite (Multi-Format Round) game applies a different % per
  // hole segment. A "shared" segment (Scramble) uses one blended TEAM
  // handicap rather than each player's own — the print card doesn't have
  // team-pairing data to know who's on a team with whom, so those holes are
  // intentionally left without dots rather than guessing wrong.
  function pctForHole(h) {
    if (game && isSharedBallFormat(game.format)) return { pct: null, shared: true };
    if (!game || game.format !== "composite") return { pct: clampInt(game?.handicap_pct, 100), shared: false };
    const seg = (game.segments || []).find((s) => (s.holes || []).includes(h));
    if (!seg) return { pct: 100, shared: false };
    if (seg.formatType === "shared") return { pct: null, shared: true };
    return { pct: clampInt(seg.handicapPct, 100), shared: false };
  }

  const hasSharedHoles =
    isSharedBallFormat(game?.format) ||
    (game?.format === "composite" && (game.segments || []).some((s) => s.formatType === "shared"));

  // "•" for a received stroke, "+" for a plus-handicap player giving one back.
  const dotStr = (n) => (n > 0 ? "•".repeat(n) : n < 0 ? "+".repeat(-n) : "");

  const holeRows = (start, end) =>
    Array.from({ length: end - start + 1 }, (_, k) => {
      const h = start + k;
      const { pct, shared } = pctForHole(h);
      return (
        <tr key={h}>
          <td style={ps.tdHole}>{h}</td>
          <td style={ps.tdHi}>{STROKE_INDEX[h - 1]}</td>

          {cols.map((p, i) => {
            const playingHcp = p && !shared ? Math.round((clampInt(p.handicap, 0) - offset) * (pct / 100)) : 0;
            const strokes = p && !shared ? strokesOnHole(playingHcp, h) : 0;
            return (
              <td key={`${h}-${i}`} style={ps.tdScore}>
                {/* score writing area */}
                <div style={ps.scoreWriteArea} />
                {/* dots in top-right of cell */}
                <div style={ps.dotCorner}>{p ? dotStr(strokes) : ""}</div>
              </td>
            );
          })}
        </tr>
      );
    });

  return (
    <div style={ps.cardOuter}>
      {/* Header: title + group details on the left, spool logo top-right. The
          logo spans the height of the text beside it, so it adds no height. */}
      <CardHeader
        f={f}
        showTeeTime={showTeeTime}
        eventName={eventName}
        logoSrc={logoSrc}
        game={game}
        offset={offset}
        note={hasSharedHoles ? "Scramble / alternate-shot holes aren't dot-marked — allocate by the team's blended handicap." : null}
      />

      {/* Main table */}
      <table style={ps.table}>
        <thead>
          <tr>
            <th style={ps.thHole}>Hole</th>
            <th style={ps.thHi}>H.I</th>
            {cols.map((p, i) => (
              <th key={i} style={ps.thPlayer}>
                <div style={ps.playerLast}>{p ? (lastName(p.name) || p.name) : "Last Name"}</div>
                <div style={ps.playerHcp}>HCP {p ? clampInt(p.handicap, 0) : ""}</div>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {holeRows(1, 9)}

          {/* OUT */}
          <tr>
            <td style={ps.tdOutInTotal}>Out</td>
            <td style={ps.tdOutInTotal} />
            {cols.map((_, i) => (
              <td key={`out-${i}`} style={ps.tdScore}>
                <div style={ps.scoreWriteArea} />
              </td>
            ))}
          </tr>

          {holeRows(10, 18)}

          {/* IN */}
          <tr>
            <td style={ps.tdOutInTotal}>In</td>
            <td style={ps.tdOutInTotal} />
            {cols.map((_, i) => (
              <td key={`in-${i}`} style={ps.tdScore}>
                <div style={ps.scoreWriteArea} />
              </td>
            ))}
          </tr>

          {/* TOTAL */}
          <tr>
            <td style={ps.tdOutInTotal}>Total</td>
            <td style={ps.tdOutInTotal} />
            {cols.map((_, i) => (
              <td key={`tot-${i}`} style={ps.tdScore}>
                <div style={ps.scoreWriteArea} />
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      {/* Bottom code row */}
      <CardFooter f={f} />
    </div>
  );
}

const ps = {
  // Laid out for ONE landscape sheet holding two cards side by side (see the
  // @page rule below). Widths are percentages and the card height is ~7.2in
  // at most, so it fits Letter and A4 landscape with no print-preview zoom.
  root: { background: "white", color: "black" },
  page: { width: "100%" },
  twoUpRow: { display: "flex", gap: "0.2in", alignItems: "flex-start" },
  col: { flex: "1 1 0", minWidth: 0 },

  // Team cards: holes across the page, two stacked on a landscape sheet
  stack: { display: "flex", flexDirection: "column", gap: "0.15in" },
  wideCard: { border: "2px solid #000", padding: 8, boxSizing: "border-box", breakInside: "avoid" },
  wideHeader: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 6 },
  wideTitle: { fontFamily: FONT_DISPLAY, fontSize: 20, fontWeight: 600, lineHeight: 1.1, letterSpacing: -0.2 },
  wideMeta: { fontSize: 10.5, lineHeight: 1.3, marginTop: 2 },
  wideSide: { flex: "none", display: "flex", alignItems: "center", gap: 10 },
  wideLogo: { display: "block", height: 44, width: "auto", maxWidth: 80, objectFit: "contain" },
  wideCode: { fontSize: 10.5, whiteSpace: "nowrap" },
  wideTable: { width: "100%", borderCollapse: "collapse", tableLayout: "fixed" },
  wLabelHead: { border: "1px solid #000", padding: "2px 4px", fontSize: 10, textAlign: "left" },
  wHead: { border: "1px solid #000", padding: "2px 0", fontSize: 10, textAlign: "center" },
  wLabel: { border: "1px solid #000", padding: "2px 4px", fontSize: 10, fontWeight: 700, textAlign: "left", lineHeight: 1.15 },
  wSmall: { border: "1px solid #000", padding: "1px 0", fontSize: 9.5, textAlign: "center" },
  wTotalTint: { background: "#eee", WebkitPrintColorAdjust: "exact", printColorAdjust: "exact", fontWeight: 800 },
  wBox: { border: "1px solid #000", padding: 0, position: "relative" },
  wWrite: { height: 26, width: "100%" },
  wDots: { position: "absolute", top: 0, right: 2, fontSize: 11, lineHeight: 1, letterSpacing: 0.5 },
  wHatch: {
    border: "1px solid #000",
    padding: 0,
    background: "repeating-linear-gradient(135deg, #fff 0, #fff 3px, #bbb 3px, #bbb 4px)",
    WebkitPrintColorAdjust: "exact",
    printColorAdjust: "exact",
  },

  // Outer card border
  cardOuter: { border: "2px solid #000", padding: 10, boxSizing: "border-box" },

  // Header
  headerRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  title: { fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 600, lineHeight: 1.1, letterSpacing: -0.2, textAlign: "left" },
  // ~76px tall = the height of the title + group details beside it.
  // An uploaded logo can be any shape, so cap its width and fit it inside the box.
  logo: { flex: "none", display: "block", height: 76, width: "auto", maxWidth: 110, objectFit: "contain" },

  // Meta
  metaBlock: { marginTop: 4, marginBottom: 6, fontSize: 11, lineHeight: 1.25 },
  metaLine: { marginTop: 1 },
  metaLabel: { display: "inline-block", width: 84 },

  // Table — fixed layout with percentage columns so it can never be wider
  // than its card: 10% hole + 10% index + 4 player columns of 20%.
  table: { width: "100%", borderCollapse: "collapse", tableLayout: "fixed" },

  thHole: { border: "1px solid #000", padding: 3, fontSize: 11, textAlign: "center", width: "10%" },
  thHi: { border: "1px solid #000", padding: 3, fontSize: 11, textAlign: "center", width: "10%" },
  thPlayer: { border: "1px solid #000", padding: 3, fontSize: 11, textAlign: "center", width: "20%", overflow: "hidden" },

  tdHole: { border: "1px solid #000", padding: "2px 4px", fontSize: 11, textAlign: "right" },
  tdHi: { border: "1px solid #000", padding: "2px 4px", fontSize: 11, textAlign: "center" },

  // Score cell with corner dots
  // No explicit cell height: it would stack on top of the padding and make
  // every row taller than the write area inside it.
  tdScore: { border: "1px solid #000", padding: 2, position: "relative" },
  scoreWriteArea: { height: 21, width: "100%" },
  dotCorner: { position: "absolute", top: 1, right: 3, fontSize: 12, lineHeight: 1, letterSpacing: 1 },
  // a tiny reminder in a shared box that this hole is one score for the whole team
  teamBallTag: { position: "absolute", top: 2, left: 4, fontSize: 7, lineHeight: 1, textTransform: "uppercase", letterSpacing: 0.6, opacity: 0.55 },

  tdOutInTotal: { border: "1px solid #000", padding: "2px 4px", fontSize: 11, textAlign: "right", fontWeight: 700 },

  playerLast: { fontWeight: 900, fontSize: 11, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  playerHcp: { fontWeight: 700, fontSize: 10, marginTop: 1 },

  // Bottom code
  bottomRow: { marginTop: 8, display: "flex", justifyContent: "center" },
  bottomInner: { fontSize: 11 },
};
