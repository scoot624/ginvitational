// Passcode gate shown in place of a locked game's board.

import { useState } from "react";
import { THEME, styles } from "../../theme";

/** Passcode gate shown in place of a locked game's board on the Leaderboard tab. */
export function LockedBoardPanel({ game, onUnlock }) {
  const [passcode, setPasscode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setErr("");
    const result = await onUnlock(game, passcode);
    setBusy(false);
    if (!result.ok) {
      setErr(result.error);
      return;
    }
    setPasscode("");
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 18, fontWeight: 950 }}>🔒 This scoreboard is locked</div>
      <div style={styles.helpText}>Enter the passcode to reveal &quot;{game.name}&quot;.</div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, maxWidth: 360, flexWrap: "wrap" }}>
        <input
          style={{ ...styles.input, flex: 1, minWidth: 160 }}
          type="password"
          value={passcode}
          onChange={(e) => {
            setPasscode(e.target.value);
            setErr("");
          }}
          placeholder="Passcode"
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button style={styles.bigBtn} onClick={submit} disabled={busy}>
          Unlock
        </button>
      </div>

      {err ? <div style={{ ...styles.helpText, color: THEME.bad }}>{err}</div> : null}
    </div>
  );
}
