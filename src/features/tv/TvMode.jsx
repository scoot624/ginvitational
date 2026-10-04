// TV Mode: one full-screen standings + Broadcast layout for a big screen (and a phone-friendly version).

import { rankCellContent } from "../../components/LeaderIcons";
import { BroadcastIcon } from "../broadcast/BroadcastFeed";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { formatToPar } from "../../lib/golf";
import { isLeaderRow, lastPlaceRank } from "../../lib/ranking";
import { FONT_BODY, FONT_DISPLAY, PALETTE } from "../../theme";

/** Display-only palette for TV Mode: dark ground, light text, brighter score colors for across-the-room reading. */
const TV = {
  bg: "#0A1812",
  text: "#F7F2E7",
  muted: "rgba(247, 242, 231, 0.62)",
  line: "rgba(237, 231, 216, 0.18)",
  gold: PALETTE.whickerBasket,
  under: "#6EE7A8",
  over: "#FF9C8A",
};

/**
 * TV Mode — one static, full-screen, display-only layout for a big screen:
 * standings on top (~72%), the latest broadcast messages along the bottom.
 * Everything is sized with clamp()/vh/em so it scales with the screen; the
 * standings flow into as many columns as it takes to keep every player on
 * screen at a readable size, so nothing needs scrolling.
 */
export function TvMode({ eventName, subtitle, board, messages, forms, onExit }) {
  const rows = board?.rows || [];
  const locked = !!board?.game?.locked;
  // A phone (narrow) or a phone turned sideways (short) can't show 40-odd
  // players at a readable size on one screen the way a TV can, so there the
  // standings become one normal-sized column that scrolls, and the broadcast
  // strip shrinks to fit under it.
  const compact = useMediaQuery("(max-width: 999px), (max-height: 560px)");
  const short = useMediaQuery("(max-height: 560px)");
  // Fewer, wider columns beat many narrow ones: a name needs ~400px at TV
  // text sizes, so 3 columns (not 4) for a typical 40-ish player field.
  const cols = compact ? 1 : rows.length <= 10 ? 1 : rows.length <= 24 ? 2 : rows.length <= 45 ? 3 : 4;
  const perCol = Math.max(1, Math.ceil(rows.length / cols));
  // ~62vh is what the standings get after the header; text is ~55% of a row.
  const rowFont = compact
    ? "clamp(15px, min(4.4vw, 4vh), 20px)"
    : `clamp(14px, ${((62 / perCol) * 0.55).toFixed(2)}vh, 44px)`;
  const lastRank = lastPlaceRank(rows);
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const recent = (messages || []).slice(0, compact ? (short ? 2 : 3) : 4);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        padding: "clamp(12px, 2.2vh, 32px) clamp(16px, 2.6vw, 56px)",
        background: TV.bg,
        color: TV.text,
        fontFamily: FONT_BODY,
        overflow: "hidden",
      }}
    >
      <style>{"@keyframes tvFlicker { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.18); } }"}</style>
      <button
        onClick={onExit}
        title="Exit TV Mode"
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          zIndex: 1,
          opacity: compact ? 0.4 : 0.18,
          background: "transparent",
          border: `1px solid ${TV.line}`,
          color: TV.text,
          borderRadius: 8,
          padding: compact ? "6px 10px" : "4px 10px",
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        Exit TV Mode
      </button>

      <section
        style={{
          flex: compact ? "1 1 0" : "0 0 72%",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "baseline",
            justifyContent: "space-between",
            columnGap: 16,
            rowGap: 2,
            // keep the title clear of the Exit button in the corner
            paddingRight: compact ? 104 : "clamp(80px, 8vw, 140px)",
            paddingBottom: "clamp(4px, 1vh, 14px)",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: "1ch", minWidth: 0 }}>
            <span
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 600,
                fontSize: compact ? "clamp(20px, 6vw, 30px)" : "clamp(20px, 4.2vh, 56px)",
                whiteSpace: "nowrap",
              }}
            >
              {eventName}
            </span>
            {subtitle ? (
              <span
                style={{
                  color: TV.muted,
                  fontSize: compact ? 13 : "clamp(12px, 2vh, 26px)",
                  whiteSpace: "nowrap",
                }}
              >
                {subtitle}
              </span>
            ) : null}
          </div>
          <span style={{ color: TV.muted, fontSize: compact ? 13 : "clamp(12px, 2vh, 26px)", whiteSpace: "nowrap" }}>
            {today}
          </span>
        </div>

        {locked ? (
          <div
            style={{
              flex: 1,
              display: "grid",
              placeItems: "center",
              fontSize: "clamp(20px, 5vh, 64px)",
              fontWeight: 700,
              color: TV.muted,
            }}
          >
            🔒 This scoreboard is locked
          </div>
        ) : rows.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: "grid",
              placeItems: "center",
              fontSize: "clamp(18px, 4vh, 52px)",
              color: TV.muted,
            }}
          >
            No players yet.
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "grid",
              columnGap: "clamp(16px, 2.4vw, 48px)",
              fontSize: rowFont,
              ...(compact
                ? {
                    // one column, fixed-height rows, scrolls under the header
                    gridTemplateColumns: "minmax(0, 1fr)",
                    gridAutoRows: "2.4em",
                    alignContent: "start",
                    overflowY: "auto",
                    overscrollBehavior: "contain",
                  }
                : {
                    gridAutoFlow: "column",
                    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${perCol}, minmax(0, 1fr))`,
                  }),
            }}
          >
            {rows.map((r, idx) => {
              const played = r.holesPlayed > 0;
              const scoreColor = !played ? TV.muted : r.toPar < 0 ? TV.under : r.toPar > 0 ? TV.over : TV.text;
              return (
                <div
                  key={r.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "2.6em minmax(0, 1fr) auto auto",
                    alignItems: "center",
                    columnGap: "0.6em",
                    padding: "0 0.5em",
                    minHeight: 0,
                    borderBottom: `1px solid ${TV.line}`,
                    background: isLeaderRow(r) ? "rgba(159, 119, 80, 0.22)" : "transparent",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", fontWeight: 700, color: TV.muted }}>
                    {rankCellContent(r, idx, lastRank, "1.1em")}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.35em", minWidth: 0 }}>
                    <span
                      style={{
                        minWidth: 0,
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {r.name}
                    </span>
                    {forms?.[r.id] === "fire" && (
                      <span title="On fire" style={{ flex: "none", animation: "tvFlicker 1.1s ease-in-out infinite" }}>
                        🔥
                      </span>
                    )}
                    {forms?.[r.id] === "ice" && (
                      <span title="Ice cold" style={{ flex: "none" }}>
                        ❄️
                      </span>
                    )}
                  </div>
                  <div style={{ fontWeight: 900, minWidth: "2.4em", textAlign: "right", color: scoreColor }}>
                    {played ? formatToPar(r.toPar) : "—"}
                  </div>
                  <div style={{ fontSize: "0.6em", minWidth: "4.4em", textAlign: "right", color: TV.muted }}>
                    {!played ? "" : r.holesPlayed === 18 ? "F" : `Thru ${r.holesPlayed}`}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div style={{ height: 1, background: TV.line, margin: "clamp(6px, 1.2vh, 16px) 0" }} />

      <section
        style={{
          // TV: share the bottom 28% evenly. Phone: just as tall as its few
          // messages need, so the standings above get everything else.
          flex: compact ? "0 0 auto" : 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            fontSize: "clamp(11px, 1.6vh, 20px)",
            letterSpacing: 2,
            textTransform: "uppercase",
            fontWeight: 700,
            color: TV.gold,
          }}
        >
          The Broadcast
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-evenly",
            gap: compact ? 6 : 0,
            paddingTop: compact ? 6 : 0,
            overflow: "hidden",
          }}
        >
          {recent.length === 0 ? (
            <div style={{ color: TV.muted, fontSize: compact ? 14 : "clamp(14px, 2.5vh, 32px)" }}>
              No updates yet — they'll show up here as scores come in.
            </div>
          ) : (
            recent.map((m) => (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "0.8em",
                  fontSize: compact ? "clamp(13px, 3.8vw, 17px)" : "clamp(14px, 2.5vh, 32px)",
                  lineHeight: 1.2,
                  minHeight: 0,
                  overflow: "hidden",
                }}
              >
                <span style={{ flex: "none", minWidth: "4.5em", fontSize: "0.65em", color: TV.muted }}>
                  {new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </span>
                <span style={{ flex: "none", alignSelf: "center", display: "flex" }}>
                  <BroadcastIcon kind={m.kind} height="1.1em" />
                </span>
                <span
                  style={{
                    fontWeight: 600,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {m.text}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
