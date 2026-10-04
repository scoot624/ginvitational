// Put each player on side A or B (Ryder Cup setup, parked for now).

import { SIDE_COLOR } from "./sideColor";
import { clampInt, hcpLabel } from "../../lib/golf";
import { THEME, styles } from "../../theme";

/** Add Game → Ryder Cup: put each player on a side. */
export function RosterPicker({ players, roster, setRoster, nameA, nameB }) {
  const sorted = [...players].sort((a, b) => a.name.localeCompare(b.name));
  const pick = (id, side) => setRoster({ ...roster, [id]: roster[id] === side ? undefined : side });
  const counts = { a: 0, b: 0 };
  for (const v of Object.values(roster)) if (v) counts[v] += 1;

  // Snake by handicap (1-2-2-1...) so both sides are about even.
  const split = () => {
    const byHcp = [...players].sort((x, y) => clampInt(x.handicap, 0) - clampInt(y.handicap, 0));
    const next = {};
    byHcp.forEach((p, i) => {
      const round = Math.floor(i / 2);
      next[p.id] = (i + (round % 2)) % 2 === 0 ? "a" : "b";
    });
    setRoster(next);
  };

  const btn = (on, side) => ({
    minWidth: 44,
    minHeight: 44,
    borderRadius: 12,
    border: `2px solid ${on ? SIDE_COLOR[side] : THEME.border}`,
    background: on ? SIDE_COLOR[side] : "transparent",
    color: on ? "#fff" : THEME.text,
    fontWeight: 800,
    cursor: "pointer",
  });

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button style={{ ...styles.smallBtn, minHeight: 44 }} onClick={split}>
          Split evenly by handicap
        </button>
        <button style={{ ...styles.smallBtn, minHeight: 44 }} onClick={() => setRoster({})}>
          Clear
        </button>
        <span style={{ fontSize: 12, color: THEME.textMuted }}>
          {nameA || "A"}: {counts.a} • {nameB || "B"}: {counts.b}
        </span>
      </div>
      <div style={{ display: "grid", gap: 6, maxHeight: 340, overflowY: "auto" }}>
        {sorted.map((p) => (
          <div key={p.id} style={{ ...styles.playerRow, padding: "6px 8px 6px 12px" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, overflowWrap: "anywhere" }}>{p.name}</div>
              <div style={styles.playerMeta}>HCP {hcpLabel(p.handicap)}</div>
            </div>
            <div style={{ display: "flex", gap: 6, flex: "none" }}>
              <button type="button" style={btn(roster[p.id] === "a", "a")} onClick={() => pick(p.id, "a")} aria-label={`${p.name} on ${nameA || "side A"}`}>
                A
              </button>
              <button type="button" style={btn(roster[p.id] === "b", "b")} onClick={() => pick(p.id, "b")} aria-label={`${p.name} on ${nameB || "side B"}`}>
                B
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
