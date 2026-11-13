// A name on the Leaderboard that always stays on ONE line. If it is too long for the space it has, the text shrinks
// a little (never below MIN_SIZE) instead of wrapping onto a second line. Tapping it (when it has an onClick) opens
// that player's or team's scorecard; the arrow shows which row is open.

import { useLayoutEffect, useRef } from "react";
import { expandChevronStyle } from "./rankStyles";
import { styles } from "../../theme";

const BASE_SIZE = 15; // the normal name size (the same as the player links elsewhere)
const MIN_SIZE = 8.5; // never smaller than this; a name that still doesn't fit is cut off with "…"
const ARROW_ROOM = 24; // space kept for the arrow and its gap

export function NameLink({ text, expanded, onClick }) {
  const wrapRef = useRef(null);
  const textRef = useRef(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const el = textRef.current;
    if (!wrap || !el) return undefined;
    const fit = () => {
      el.style.fontSize = `${BASE_SIZE}px`;
      const room = wrap.clientWidth - (onClick ? ARROW_ROOM : 0); // the cell's width: it doesn't depend on the text, so this can't flip-flop
      const need = el.scrollWidth;
      const size = room > 0 && need > room ? Math.max(MIN_SIZE, Math.floor(((BASE_SIZE * room) / need) * 2) / 2) : BASE_SIZE;
      el.style.fontSize = `${size}px`;
    };
    fit();
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [text, onClick]);

  const label = (
    <span ref={textRef} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: BASE_SIZE }}>
      {text}
    </span>
  );

  return (
    <div ref={wrapRef} style={{ width: "100%", minWidth: 0 }}>
      {onClick ? (
        <button
          style={{ ...styles.playerLink, display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%", whiteSpace: "nowrap" }}
          onClick={onClick}
        >
          {label}
          <span style={{ ...expandChevronStyle(expanded), flex: "none" }}>▸</span>
        </button>
      ) : (
        <div style={{ fontWeight: 950, display: "flex" }}>{label}</div>
      )}
    </div>
  );
}
