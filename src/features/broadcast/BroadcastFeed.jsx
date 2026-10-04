// The Broadcast page: card styles per kind, and the grouped feed with Show earlier.

import { useEffect, useState } from "react";
import { LastPlaceIcon, LeaderIcon } from "../../components/LeaderIcons";
import { THEME, styles } from "../../theme";

// How each kind of Broadcast card looks. Older kinds from earlier versions fall back to a plain 📣 card.
const BROADCAST_KIND = {
  leader: { label: "New leader", accent: "#B08A2E", big: false },
  champion: { label: "Champion", accent: "#B08A2E", big: true },
  lex: { label: "The LEX", accent: "#994B3E", big: false },
  lexfinal: { label: "The LEX", accent: "#994B3E", big: true },
  fire: { label: "On fire", emoji: "🔥", accent: "#E0732B" },
  ice: { label: "Iced", emoji: "❄️", accent: "#4C8FBF" },
  swing: { label: "Big swing", emoji: "↕️", accent: "#6B7F73" },
  eagle: { label: "Eagle", emoji: "🦅", accent: "#2F7D5B", big: true },
  ace: { label: "Hole in one", emoji: "🎉", accent: "#D4A017", big: true },
  war: { label: "Lead battle", emoji: "⚔️", accent: "#7A4E8C" },
  hotgroup: { label: "Hot group", emoji: "🌶️", accent: "#E0732B" },
  recap: { label: "Recap", emoji: "⛳", accent: "#4E5C54" },
  roundup: { label: "Roundup", emoji: "📣", accent: "#4E5C54" },
};

export function BroadcastIcon({ kind, height = "22px" }) {
  if (kind === "leader" || kind === "champion") return <LeaderIcon height={height} />;
  if (kind === "lex" || kind === "lexfinal") return <LastPlaceIcon height={height} />;
  return <span style={{ fontSize: height, lineHeight: 1 }}>{BROADCAST_KIND[kind]?.emoji || "📣"}</span>;
}

function timeAgo(ms, now) {
  const mins = Math.max(0, Math.round((now - ms) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** The Broadcast page: newest 25 cards, grouped, with a "Show earlier" button. */
export function BroadcastFeed({ messages }) {
  const [shown, setShown] = useState(25);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (messages.length === 0) {
    return (
      <div style={styles.broadcastItem}>
        <div style={{ fontWeight: 950 }}>No updates yet</div>
        <div style={{ marginTop: 6, color: THEME.textMuted, fontSize: 12 }}>
          Once scores start coming in, the moments worth talking about will show up here.
        </div>
      </div>
    );
  }

  const today = new Date(now).toDateString();
  const groupOf = (ms) => {
    if (now - ms < 15 * 60000) return "Just now";
    return new Date(ms).toDateString() === today
      ? "Earlier today"
      : new Date(ms).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  };

  const visible = messages.slice(0, shown);
  const groups = visible.map((m) => groupOf(new Date(m.created_at).getTime()));
  return (
    <>
      {visible.map((m, i) => {
        const ms = new Date(m.created_at).getTime();
        const meta = BROADCAST_KIND[m.kind] || { label: "Update", accent: THEME.borderStrong };
        const heading = i === 0 || groups[i] !== groups[i - 1] ? groups[i] : null;
        return (
          <div key={m.id} style={{ display: "grid", gap: 8 }}>
            {heading ? (
              <div
                style={{
                  marginTop: 4,
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: 1.6,
                  textTransform: "uppercase",
                  color: THEME.textMuted,
                }}
              >
                {heading}
              </div>
            ) : null}
            <div
              style={{
                ...styles.broadcastItem,
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                borderLeft: `5px solid ${meta.accent}`,
                background: meta.big ? "rgba(159, 119, 80, 0.12)" : styles.broadcastItem.background,
              }}
            >
              <div style={{ flex: "none", width: 48, minHeight: 28, display: "grid", placeItems: "center" }}>
                <BroadcastIcon kind={m.kind} height={meta.big ? "30px" : "24px"} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700, color: THEME.textMuted }}>
                  {meta.label} • {timeAgo(ms, now)}
                </div>
                <div
                  style={{
                    marginTop: 4,
                    fontWeight: meta.big ? 800 : 600,
                    fontSize: meta.big ? 17 : 15,
                    lineHeight: 1.35,
                    overflowWrap: "anywhere",
                  }}
                >
                  {m.text}
                </div>
              </div>
            </div>
          </div>
        );
      })}
      {messages.length > shown ? (
        <button style={{ ...styles.smallBtn, minHeight: 44 }} onClick={() => setShown((n) => n + 25)}>
          Show earlier ({messages.length - shown} more)
        </button>
      ) : null}
    </>
  );
}
