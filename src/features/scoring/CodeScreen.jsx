import { THEME, styles } from "../../theme";

// Enter Scores, step 1: type your group code.

export function CodeScreen({ setTab, visibleStatus, entryCode, setEntryCode, enterWithCode }) {

  return (
          <div style={styles.card}>
            <div style={styles.headerRow}>
              <button style={styles.smallBtn} onClick={() => setTab("home")}>
                Home
              </button>
              {visibleStatus ? <div style={{ fontSize: 12, color: THEME.textMuted }}>{visibleStatus}</div> : null}
            </div>

            <div style={{ marginTop: 12, fontSize: 22, fontWeight: 950, letterSpacing: -0.2 }}>
              Enter Scores
            </div>
            <div style={styles.helpText}>
              Enter your <b>6-character foursome code</b> to score your group.
            </div>

            <div style={{ marginTop: 14, display: "grid", gap: 10, maxWidth: 520 }}>
              <input
                style={styles.input}
                value={entryCode}
                onChange={(e) => setEntryCode(e.target.value.toUpperCase())}
                placeholder="Enter 6-character code"
                maxLength={6}
                autoCapitalize="characters"
              />
              <button style={styles.bigBtn} onClick={enterWithCode}>
                Continue
              </button>

              <div style={{ fontSize: 12, color: THEME.textMuted }}>
                You can only enter scores for your foursome code.
              </div>
            </div>
          </div>
  );
}
