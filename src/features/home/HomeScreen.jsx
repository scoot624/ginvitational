import { useEventDataContext } from "../../hooks/eventDataContext";
import { THEME, styles } from "../../theme";

// The Home screen.

export function HomeScreen({ logoSrc, eventName, customLogo, tagline, setTab }) {
  const {
    loadBroadcast,
  } = useEventDataContext();

  return (
          <div style={styles.homeCard}>
            <div style={{ textAlign: "center" }}>
              <img
                src={logoSrc}
                alt={`${eventName} logo`}
                style={{
                  width: 210,
                  height: "auto",
                  // A tall uploaded logo shouldn't push the menu off screen.
                  maxHeight: 200,
                  objectFit: "contain",
                  display: "block",
                  margin: "0 auto",
                  // The built-in spool's flag+needle jut out to the right, so
                  // centering its full bounding box makes the spool itself
                  // look left-of-center. Nudge right so the spool's own base
                  // lines up under "The" in the title below. (An uploaded
                  // logo is centered as-is.)
                  transform: customLogo ? "none" : "translateX(22px)",
                }}
              />

              <div style={styles.homeTitle}>
                {(() => {
                  const words = eventName.trim().split(/\s+/).filter(Boolean);
                  const first = words[0] || eventName;
                  const rest = words.slice(1).join(" ");
                  return rest ? (
                    <>
                      {first}
                      <br />
                      {rest}
                    </>
                  ) : (
                    first
                  );
                })()}
              </div>

              {tagline ? <div style={styles.homeSub}>{tagline}</div> : null}

              <div style={styles.homeRule} />
            </div>

            <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
              <button style={styles.bigBtn} onClick={() => setTab("leaderboard")}>
                Leaderboard
              </button>

              <button
                style={styles.bigBtn}
                onClick={async () => {
                  await loadBroadcast();
                  setTab("broadcast");
                }}
              >
                The Broadcast
              </button>

              <button style={styles.bigBtn} onClick={() => setTab("code")}>
                Enter Scores
              </button>

              <button style={styles.bigBtn} onClick={() => setTab("admin")}>
                Admin
              </button>
            </div>

            <div style={{ marginTop: 14, textAlign: "center", fontSize: 12, color: THEME.textMuted }}>
              Manufacturers Golf &amp; CC
            </div>
          </div>
  );
}
