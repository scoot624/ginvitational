import { BroadcastFeed } from "./BroadcastFeed";
import { useEventDataContext } from "../../hooks/eventDataContext";
import { styles } from "../../theme";

// The Broadcast page.

export function BroadcastScreen({ setTab, visibleBroadcast }) {
  const {
    loadPlayers,
    loadScores,
    loadBroadcast,
  } = useEventDataContext();

  return (
          <div style={styles.card}>
            <div style={styles.cardHeaderRow}>
              <div style={styles.cardTitle}>The Broadcast</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  style={styles.smallBtn}
                  onClick={async () => {
                    await loadPlayers();
                    await loadScores();
                    await loadBroadcast();
                  }}
                >
                  Refresh
                </button>
                <button style={styles.smallBtn} onClick={() => setTab("home")}>
                  Home
                </button>
              </div>
            </div>

            <div style={styles.helpText}>
              Moe!!! Give us the updates.
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <BroadcastFeed messages={visibleBroadcast} />
            </div>
          </div>
  );
}
