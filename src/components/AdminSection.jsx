// A collapsible Admin sub-section.

import { THEME, styles } from "../theme";

/**
 * A collapsible Admin sub-section — only one open at a time (accordion),
 * so the setup page shows one decision at a time instead of everything at
 * once. `subtitle` is a short at-a-glance status shown under the title
 * while collapsed (e.g. "24 players imported").
 */
export function AdminSection({ title, subtitle, open, onToggle, danger, children }) {
  return (
    <div style={danger ? styles.subCardDanger : styles.subCard}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          width: "100%",
          gap: 10,
          background: "none",
          border: "none",
          padding: 0,
          margin: 0,
          font: "inherit",
          color: "inherit",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ ...styles.subTitle, marginBottom: subtitle && !open ? 2 : 10 }}>{title}</div>
          {subtitle && !open ? (
            <div style={{ fontSize: 12, color: THEME.textMuted }}>{subtitle}</div>
          ) : null}
        </div>
        <span style={{ fontSize: 20, opacity: 0.7, flexShrink: 0 }}>{open ? "−" : "+"}</span>
      </button>
      {open && <div style={{ marginTop: 4 }}>{children}</div>}
    </div>
  );
}
