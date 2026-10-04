// Danger Zone → Delete players: pick some players, or everyone.

import { useState } from "react";
import { hcpLabel } from "../../lib/golf";
import { styles } from "../../theme";

/**
 * Danger Zone → Delete players: pick some players, or delete everyone.
 * `onDelete(ids)` removes their scores and group spots too and returns a message.
 */
export function DeletePlayersPanel({ players, groupNameByPlayer, onDelete }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [filter, setFilter] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const shown = players
    .filter((p) => !filter.trim() || p.name.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const selected = players.filter((p) => picked.has(p.id));

  async function go(list, everyone) {
    if (busy || list.length === 0) return;
    if (everyone) {
      const typed = prompt(
        `This deletes ALL ${list.length} players and every score they have entered. This can't be undone.\n\nType DELETE ALL to confirm.`
      );
      if (typed == null) return;
      if (typed.trim().toUpperCase() !== "DELETE ALL") {
        setMsg("Not deleted: you didn't type DELETE ALL.");
        return;
      }
    } else if (
      !confirm(
        `Delete ${list.length} player${list.length === 1 ? "" : "s"} (${list
          .slice(0, 5)
          .map((p) => p.name)
          .join(", ")}${list.length > 5 ? ", …" : ""}) and all of their scores? This can't be undone.`
      )
    ) {
      return;
    }
    setBusy(true);
    setMsg("Deleting…");
    try {
      setMsg(await onDelete(list.map((p) => p.id)));
      setPicked(new Set());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={styles.hr} />
      <div style={{ ...styles.sectionLabel, marginTop: 14 }}>Delete players</div>
      <div style={styles.helpText}>
        Removes the players you choose (or everyone) along with their scores and their spot in a group. Groups stay,
        just emptier.
      </div>
      <button style={{ ...styles.dangerBtn, marginTop: 10, minHeight: 44 }} onClick={() => setOpen((v) => !v)}>
        {open ? "Hide" : `Delete players… (${players.length})`}
      </button>

      {open ? (
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          {players.length === 0 ? <div style={styles.helpText}>There are no players.</div> : null}
          {players.length > 8 ? (
            <input
              style={{ ...styles.input, fontSize: 16, minHeight: 46, boxSizing: "border-box" }}
              placeholder="Search players"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Search players"
            />
          ) : null}
          {players.length > 0 ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                style={{ ...styles.smallBtn, minHeight: 44 }}
                onClick={() => setPicked(new Set([...picked, ...shown.map((p) => p.id)]))}
              >
                Select {filter.trim() ? "shown" : "all"}
              </button>
              <button style={{ ...styles.smallBtn, minHeight: 44 }} onClick={() => setPicked(new Set())}>
                Clear selection
              </button>
            </div>
          ) : null}
          <div style={{ display: "grid", gap: 6, maxHeight: 360, overflowY: "auto" }}>
            {shown.map((p) => (
              <label
                key={p.id}
                style={{
                  ...styles.playerRow,
                  justifyContent: "flex-start",
                  minHeight: 44,
                  cursor: "pointer",
                  background: picked.has(p.id) ? "rgba(153,75,62,0.12)" : styles.playerRow.background,
                }}
              >
                <input
                  type="checkbox"
                  style={{ width: 22, height: 22, flex: "none" }}
                  checked={picked.has(p.id)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(p.id);
                    else next.delete(p.id);
                    setPicked(next);
                  }}
                />
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 800, overflowWrap: "anywhere" }}>{p.name}</span>
                  <span style={{ ...styles.playerMeta, display: "block" }}>
                    HCP {hcpLabel(p.handicap)} • {groupNameByPlayer.get(p.id) || "No group"}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {players.length > 0 ? (
            <div style={{ display: "grid", gap: 8 }}>
              <button
                style={{ ...styles.dangerBtn, minHeight: 48, opacity: selected.length === 0 || busy ? 0.5 : 1 }}
                disabled={selected.length === 0 || busy}
                onClick={() => go(selected, false)}
              >
                Delete selected ({selected.length})
              </button>
              <button
                style={{ ...styles.dangerBtn, minHeight: 48, opacity: busy ? 0.5 : 1 }}
                disabled={busy}
                onClick={() => go(players, true)}
              >
                Delete ALL players ({players.length})
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {msg ? <div style={styles.helpText}>{msg}</div> : null}
    </div>
  );
}
