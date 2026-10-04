// Print scorecards: two per landscape sheet at 100% scale.

import { STROKE_INDEX, strokesOnHole } from "../../lib/course";
import { clampInt, lastName } from "../../lib/golf";
import { formatTeeTime } from "../../lib/teeSheet";
import { FONT_DISPLAY } from "../../theme";

export function PrintTwoUpScorecards({ foursomes, players, foursomePlayers, eventName, logoSrc, game, fieldOffset }) {
  // members per foursome (up to 4)
  const membersByFid = new Map();
  for (const f of foursomes) {
    const pids = foursomePlayers.filter((fp) => fp.foursome_id === f.id).map((x) => x.player_id);
    const mem = players.filter((p) => pids.includes(p.id)).slice(0, 4);
    membersByFid.set(f.id, mem);
  }

  // Everyone starting on the same hole (just different tee times) → the tee
  // time is what tells the cards apart, so print that. If starting holes
  // differ (shotgun / split tees) → print the starting hole instead.
  const startHoles = new Set(foursomes.map((f) => String(f.starting_hole ?? "").trim() || "1"));
  const showTeeTime = startHoles.size <= 1;

  // 2 per page
  const pages = [];
  for (let i = 0; i < foursomes.length; i += 2) pages.push([foursomes[i], foursomes[i + 1] || null]);

  return (
    <div id="printRoot" style={ps.root}>
      {pages.map((pair, idx) => (
        <div className="printPage" key={idx} style={ps.page}>
          <div style={ps.twoUpRow}>
            <div style={ps.col}>
              {pair[0] && (
                <PrintOneGroupCard
                  f={pair[0]}
                  members={membersByFid.get(pair[0].id) || []}
                  showTeeTime={showTeeTime}
                  eventName={eventName}
                  logoSrc={logoSrc}
                  game={game}
                  fieldOffset={fieldOffset}
                />
              )}
            </div>

            <div style={ps.col}>
              {pair[1] && (
                <PrintOneGroupCard
                  f={pair[1]}
                  members={membersByFid.get(pair[1].id) || []}
                  showTeeTime={showTeeTime}
                  eventName={eventName}
                  logoSrc={logoSrc}
                  game={game}
                  fieldOffset={fieldOffset}
                />
              )}
            </div>
          </div>
        </div>
      ))}
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
    if (game && (game.format === "scramble_2" || game.format === "scramble_4")) return { pct: null, shared: true };
    if (!game || game.format !== "composite") return { pct: clampInt(game?.handicap_pct, 100), shared: false };
    const seg = (game.segments || []).find((s) => (s.holes || []).includes(h));
    if (!seg) return { pct: 100, shared: false };
    if (seg.formatType === "shared") return { pct: null, shared: true };
    return { pct: clampInt(seg.handicapPct, 100), shared: false };
  }

  const hasSharedHoles =
    game?.format === "scramble_2" ||
    game?.format === "scramble_4" ||
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
      <div style={ps.headerRow}>
        <div style={{ flex: "1 1 0", minWidth: 0 }}>
          <div style={ps.title}>{eventName || "The Ginvitational"}</div>

          {/* Meta block */}
          <div style={ps.metaBlock}>
            <div style={ps.metaLine}>
              <span style={ps.metaLabel}>Group Name:</span> <span>{f.group_name || ""}</span>
            </div>
            {/* Only the detail that tells the groups apart: tee time when everyone
                starts on the same hole, otherwise the starting hole. */}
            {showTeeTime ? (
              <div style={ps.metaLine}>
                <span style={ps.metaLabel}>Tee Time:</span> <span>{formatTeeTime(f.tee_time)}</span>
              </div>
            ) : (
              <div style={ps.metaLine}>
                <span style={ps.metaLabel}>Starting Hole:</span> <span>{f.starting_hole || ""}</span>
              </div>
            )}
            <div style={ps.metaLine}>
              <span style={ps.metaLabel}>Handicap:</span>{" "}
              <span>
                {game ? game.name : "Course Handicap"}
                {game && game.format !== "composite" && game.format !== "scramble_2" && game.format !== "scramble_4"
                  ? ` • ${clampInt(game.handicap_pct, 100)}% allocation`
                  : ""}
                {offset !== 0 ? " • Field-Relative" : ""}
              </span>
            </div>
            {hasSharedHoles && (
              <div style={{ ...ps.metaLine, fontSize: 10, opacity: 0.75 }}>
                Scramble-style holes aren't dot-marked — allocate by the team's blended handicap.
              </div>
            )}
          </div>
        </div>

        <img src={logoSrc} alt="" style={ps.logo} />
      </div>

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
      <div style={ps.bottomRow}>
        <div style={ps.bottomInner}>
          <span style={{ fontWeight: 700 }}>Group Code</span>
          <span style={{ marginLeft: 10, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
            {f.code || ""}
          </span>
        </div>
      </div>
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

  tdOutInTotal: { border: "1px solid #000", padding: "2px 4px", fontSize: 11, textAlign: "right", fontWeight: 700 },

  playerLast: { fontWeight: 900, fontSize: 11, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  playerHcp: { fontWeight: 700, fontSize: 10, marginTop: 1 },

  // Bottom code
  bottomRow: { marginTop: 8, display: "flex", justifyContent: "center" },
  bottomInner: { fontSize: 11 },
};
