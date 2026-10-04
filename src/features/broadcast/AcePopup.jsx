// The in-app hole-in-one popup.

import { shortName } from "../../lib/broadcastEngine";
import { FONT_DISPLAY, THEME, styles } from "../../theme";

export function AcePopup({ msg, players, onClose }) {
  const player = players.find((p) => p.id === msg.player_id);
  const hole = String(msg.dedupe_key || "").split("|")[2];
  const name = player ? shortName(player.name) : null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Hole in one"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        display: "grid",
        placeItems: "center",
        padding: 16,
        background: "rgba(5, 12, 9, 0.78)",
      }}
    >
      <style>{"@keyframes acePop { 0% { transform: scale(0.8); opacity: 0; } 60% { transform: scale(1.04); } 100% { transform: scale(1); opacity: 1; } }"}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(420px, 100%)",
          boxSizing: "border-box",
          textAlign: "center",
          padding: "28px 20px 22px",
          borderRadius: 22,
          background: THEME.surface,
          border: `2px solid ${THEME.accent}`,
          boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
          animation: "acePop 0.35s ease-out",
        }}
      >
        <div style={{ fontSize: 44, lineHeight: 1 }}>🎉⛳🎉</div>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 28, marginTop: 10, color: THEME.text }}>
          HOLE IN ONE!
        </div>
        <div style={{ fontSize: 17, lineHeight: 1.4, marginTop: 10, color: THEME.text, overflowWrap: "anywhere" }}>
          {name
            ? `${name} just made a hole-in-one${hole ? ` on #${hole}` : ""}! Drinks are on them. 🍻`
            : msg.text}
        </div>
        <button style={{ ...styles.bigBtn, marginTop: 18, minHeight: 48, width: "100%" }} onClick={onClose}>
          Let's go! 🎉
        </button>
      </div>
    </div>
  );
}
