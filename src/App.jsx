import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

/** ✅ Supabase (recommended: use Vercel env vars + local .env.local) */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * ⛳ PARS (edit these to match your course)
 * Index 0 = Hole 1 par, index 17 = Hole 18 par
 */
const PARS = [
  4, 4, 3, 4, 4, 5, 4, 3, 4,
  4, 5, 3, 4, 4, 3, 4, 4, 5,
];

function formatToPar(n) {
  if (n === 0) return "E";
  if (n > 0) return `+${n}`;
  return `${n}`; // already negative
}

function clampInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

function ScorecardModal({ open, onClose, player, pars }) {
  if (!open || !player) return null;

  const holes = Array.from({ length: 18 }, (_, i) => i + 1);

  const playedHoles = holes.filter((h) => player.scoresByHole[h] != null);
  const gross = playedHoles.reduce((acc, h) => acc + player.scoresByHole[h], 0);
  const parTotalPlayed = playedHoles.reduce((acc, h) => acc + pars[h - 1], 0);
  const handicap = clampInt(player.handicap, 0);

  // simple pro-rated net for holes played
  const proratedHandicap = (handicap * playedHoles.length) / 18;
  const netGross = gross - proratedHandicap;
  const netToPar = Math.round(netGross - parTotalPlayed);

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>
              {player.name} <span style={{ opacity: 0.7 }}>(HCP {handicap})</span>
            </div>
            <div style={{ marginTop: 4, opacity: 0.85 }}>
              Holes: {playedHoles.length}/18 • Net vs Par:{" "}
              <strong>{formatToPar(netToPar)}</strong>
            </div>
          </div>
          <button style={styles.smallBtn} onClick={onClose}>
            Close
          </button>
        </div>

        <div style={{ marginTop: 10, overflowX: "auto" }}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Hole</th>
                <th style={styles.th}>Par</th>
                <th style={styles.th}>Score</th>
                <th style={styles.th}>+/-</th>
              </tr>
            </thead>
            <tbody>
              {holes.map((h) => {
                const par = pars[h - 1];
                const sc = player.scoresByHole[h];
                const diff = sc != null ? sc - par : null;
                return (
                  <tr key={h}>
                    <td style={styles.td}>{h}</td>
                    <td style={styles.td}>{par}</td>
                    <td style={styles.td}>{sc != null ? sc : "—"}</td>
                    <td style={styles.td}>
                      {diff == null ? "—" : formatToPar(diff)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td style={styles.tdStrong}>Totals</td>
                <td style={styles.tdStrong}>{parTotalPlayed}</td>
                <td style={styles.tdStrong}>{gross}</td>
                <td style={styles.tdStrong}>{formatToPar(gross - parTotalPlayed)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
          * Net is calculated as gross minus pro-rated handicap for holes played.
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("home"); // home | leaderboard | scores | admin
  const [status, setStatus] = useState("Connecting...");
  const [players, setPlayers] = useState([]);
  const [scores, setScores] = useState([]);

  // Scores form
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [hole, setHole] = useState("1");
  const [strokes, setStrokes] = useState("4");

  // Admin PIN
  const [adminPin, setAdminPin] = useState("");
  const [adminOn, setAdminOn] = useState(false);

  // Add player form (admin)
  const [newName, setNewName] = useState("");
  const [newHandicap, setNewHandicap] = useState("");
  const [newCharity, setNewCharity] = useState("");

  // Scorecard modal
  const [scorecardPlayerId, setScorecardPlayerId] = useState(null);

  async function loadPlayers() {
    const { data, error } = await supabase
      .from("players")
      .select("id,name,handicap,charity")
      .order("created_at", { ascending: true });

    if (error) {
      console.error(error);
      return { ok: false };
    }
    setPlayers(data || []);
    return { ok: true };
  }

  async function loadScores() {
    const { data, error } = await supabase
      .from("scores")
      .select("id,player_id,hole,score,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      return { ok: false };
    }
    setScores(data || []);
    return { ok: true };
  }

  async function initialLoad() {
    setStatus("Loading...");
    const a = await loadPlayers();
    const b = await loadScores();
    if (a.ok && b.ok) setStatus("Connected ✅");
    else setStatus("Connected, but some data failed ❗");
  }

  useEffect(() => {
    initialLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ Auto-refresh leaderboard every minute (only when on leaderboard tab)
  useEffect(() => {
    if (tab !== "leaderboard") return;

    const id = setInterval(() => {
      loadPlayers();
      loadScores();
    }, 60_000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const playerById = useMemo(() => {
    const m = new Map();
    for (const p of players) m.set(p.id, p);
    return m;
  }, [players]);

  const leaderboardRows = useMemo(() => {
    // build scoresByHole for each player
    const scoresByPlayer = new Map(); // playerId -> { scoresByHole: { [hole]: score } }

    for (const s of scores) {
      const pid = s.player_id;
      if (!scoresByPlayer.has(pid)) scoresByPlayer.set(pid, {});
      const obj = scoresByPlayer.get(pid);
      if (!obj.scoresByHole) obj.scoresByHole = {};
      const h = clampInt(s.hole, 0);
      const sc = clampInt(s.score, 0);
      if (h >= 1 && h <= 18) obj.scoresByHole[h] = sc; // last write wins
    }

    const rows = players.map((p) => {
      const blob = scoresByPlayer.get(p.id) || {};
      const scoresByHole = blob.scoresByHole || {};

      const playedHoles = Object.keys(scoresByHole)
        .map((x) => clampInt(x, 0))
        .filter((h) => h >= 1 && h <= 18)
        .sort((a, b) => a - b);

      const holesPlayed = playedHoles.length;

      const gross = playedHoles.reduce((acc, h) => acc + scoresByHole[h], 0);
      const parPlayed = playedHoles.reduce((acc, h) => acc + PARS[h - 1], 0);

      const handicap = clampInt(p.handicap, 0);
      const proratedHandicap = (handicap * holesPlayed) / 18;
      const netGross = gross - proratedHandicap;

      const netToPar = Math.round(netGross - parPlayed);

      return {
        id: p.id,
        name: p.name,
        handicap,
        holesPlayed,
        gross,
        parPlayed,
        netToPar,
        scoresByHole,
      };
    });

    // Sort: best netToPar first; tie-breaker: more holes played; then name
    rows.sort((a, b) => {
      if (a.netToPar !== b.netToPar) return a.netToPar - b.netToPar;
      if (a.holesPlayed !== b.holesPlayed) return b.holesPlayed - a.holesPlayed;
      return a.name.localeCompare(b.name);
    });

    return rows;
  }, [players, scores]);

  const scorecardPlayer = useMemo(() => {
    if (!scorecardPlayerId) return null;
    const row = leaderboardRows.find((r) => r.id === scorecardPlayerId);
    if (!row) return null;
    return row;
  }, [scorecardPlayerId, leaderboardRows]);

  async function saveScore() {
    const pid = selectedPlayerId;
    const h = clampInt(hole, 1);
    const sc = clampInt(strokes, 0);

    if (!pid) return alert("Pick a player first.");
    if (h < 1 || h > 18) return alert("Hole must be 1–18.");
    if (sc < 1 || sc > 20) return alert("Strokes looks wrong (try 1–20).");

    // ✅ upsert requires a unique constraint on (player_id, hole)
    // If your DB doesn't have it yet, this may error until you add it.
    const { error } = await supabase
      .from("scores")
      .upsert(
        { player_id: pid, hole: h, score: sc },
        { onConflict: "player_id,hole" }
      );

    if (error) {
      console.error(error);
      alert("Error saving score");
      return;
    }

    // refresh local list (Scores tab will show instantly)
    await loadScores();
  }

  async function addPlayer() {
    if (!adminOn) return alert("Admin only.");
    const name = newName.trim();
    if (!name) return alert("Name required.");
    const hcp = clampInt(newHandicap, 0);

    const { error } = await supabase.from("players").insert({
      name,
      handicap: hcp,
      charity: newCharity.trim() || null,
    });

    if (error) {
      console.error(error);
      alert("Error adding player");
      return;
    }

    setNewName("");
    setNewHandicap("");
    setNewCharity("");
    await loadPlayers();
  }

  async function deletePlayer(id) {
    if (!adminOn) return alert("Admin only.");
    if (!confirm("Delete this player?")) return;

    // delete scores first (optional but avoids FK issues if you add constraints later)
    await supabase.from("scores").delete().eq("player_id", id);
    const { error } = await supabase.from("players").delete().eq("id", id);

    if (error) {
      console.error(error);
      alert("Error deleting player");
      return;
    }

    await loadPlayers();
    await loadScores();
  }

  function enterAdmin() {
    if (adminPin === "112020") {
      setAdminOn(true);
      setAdminPin("");
      setTab("admin");
    } else {
      alert("Wrong PIN");
    }
  }

  return (
    <div style={styles.page}>
      <ScorecardModal
        open={!!scorecardPlayerId}
        onClose={() => setScorecardPlayerId(null)}
        player={scorecardPlayer}
        pars={PARS}
      />

      <div style={styles.header}>
        <div style={styles.title}>Ginvitational</div>
        <div style={styles.sub}>
          {status}{" "}
          <span style={{ opacity: 0.6, marginLeft: 10 }}>
            (Leaderboard auto-refreshes every 1 min)
          </span>
        </div>

        <div style={styles.nav}>
          <button style={tab === "home" ? styles.navBtnActive : styles.navBtn} onClick={() => setTab("home")}>
            Home
          </button>
          <button style={tab === "leaderboard" ? styles.navBtnActive : styles.navBtn} onClick={() => setTab("leaderboard")}>
            Leaderboard
          </button>
          <button style={tab === "scores" ? styles.navBtnActive : styles.navBtn} onClick={() => setTab("scores")}>
            Enter Scores
          </button>
          <button style={tab === "admin" ? styles.navBtnActive : styles.navBtn} onClick={() => setTab("admin")}>
            Admin
          </button>
        </div>
      </div>

      <div style={styles.content}>
        {tab === "home" && (
          <div style={styles.card}>
            <div style={{ textAlign: "center" }}>
              <img src="/logo.png" alt="Ginvitational logo" style={{ width: 70, height: 70, objectFit: "contain" }} />
              <div style={{ marginTop: 10, fontSize: 26, fontWeight: 900 }}>The Ginvitational</div>
              <div style={{ marginTop: 6, opacity: 0.8 }}>Manufacturers Golf & CC • May 2026</div>
            </div>

            <div style={{ marginTop: 22, display: "grid", gap: 14 }}>
              <button style={styles.bigBtn} onClick={() => setTab("leaderboard")}>
                📊 Leaderboard
              </button>
              <button style={styles.bigBtn} onClick={() => setTab("scores")}>
                👥 Enter Scores
              </button>
              <button style={styles.bigBtn} onClick={() => setTab("admin")}>
                ⚙️ Admin
              </button>
            </div>
          </div>
        )}

        {tab === "leaderboard" && (
          <div style={styles.card}>
            <div style={styles.cardTitleRow}>
              <div style={styles.cardTitle}>Leaderboard</div>
              <button style={styles.smallBtn} onClick={() => { loadPlayers(); loadScores(); }}>
                Refresh now
              </button>
            </div>

            <div style={{ marginTop: 10, overflowX: "auto" }}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>#</th>
                    <th style={styles.th}>Player</th>
                    <th style={styles.th}>Holes</th>
                    <th style={styles.th}>Net vs Par</th>
                    <th style={styles.th}>Gross</th>
                    <th style={styles.th}>Par (played)</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboardRows.map((r, idx) => (
                    <tr key={r.id}>
                      <td style={styles.td}>{idx + 1}</td>
                      <td style={styles.td}>
                        <button
                          style={styles.linkBtn}
                          onClick={() => setScorecardPlayerId(r.id)}
                          title="Tap to open scorecard"
                        >
                          {r.name}
                        </button>{" "}
                        <span style={{ opacity: 0.7 }}>(HCP {r.handicap})</span>
                      </td>
                      <td style={styles.td}>{r.holesPlayed}/18</td>
                      <td style={styles.td}>
                        <strong>{formatToPar(r.netToPar)}</strong>
                      </td>
                      <td style={styles.td}>{r.gross || 0}</td>
                      <td style={styles.td}>{r.parPlayed || 0}</td>
                    </tr>
                  ))}
                  {leaderboardRows.length === 0 && (
                    <tr>
                      <td style={styles.td} colSpan={6}>
                        No players yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
              * Net vs Par = (gross − pro-rated handicap) − par for holes played.
            </div>
          </div>
        )}

        {tab === "scores" && (
          <div style={styles.card}>
            <div style={styles.cardTitle}>Enter Scores</div>

            <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
              <label style={styles.label}>
                Player
                <select
                  style={styles.input}
                  value={selectedPlayerId}
                  onChange={(e) => setSelectedPlayerId(e.target.value)}
                >
                  <option value="">Select a player…</option>
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (HCP {clampInt(p.handicap, 0)})
                    </option>
                  ))}
                </select>
              </label>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10 }}>
                <label style={styles.label}>
                  Hole
                  <select style={styles.input} value={hole} onChange={(e) => setHole(e.target.value)}>
                    {Array.from({ length: 18 }, (_, i) => (
                      <option key={i + 1} value={String(i + 1)}>
                        {i + 1}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={styles.label}>
                  Strokes
                  <input
                    style={styles.input}
                    value={strokes}
                    onChange={(e) => setStrokes(e.target.value)}
                    inputMode="numeric"
                  />
                </label>

                <button style={styles.saveBtn} onClick={saveScore}>
                  Save
                </button>
              </div>
            </div>

            <div style={{ marginTop: 16, fontSize: 13, opacity: 0.8 }}>
              Tip: To **edit** a score, choose the same player + hole, enter new strokes, and hit **Save** again.
            </div>
          </div>
        )}

        {tab === "admin" && (
          <div style={styles.card}>
            <div style={styles.cardTitle}>Admin</div>

            {!adminOn ? (
              <div style={{ marginTop: 10, display: "grid", gap: 10, maxWidth: 360 }}>
                <label style={styles.label}>
                  Enter Admin PIN
                  <input
                    style={styles.input}
                    value={adminPin}
                    onChange={(e) => setAdminPin(e.target.value)}
                    inputMode="numeric"
                    placeholder="112020"
                  />
                </label>

                <button style={styles.bigBtn} onClick={enterAdmin}>
                  Unlock Admin
                </button>

                <div style={{ fontSize: 12, opacity: 0.75 }}>
                  This is a simple “front-end PIN gate” (not high security). We can harden it later.
                </div>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                  <button
                    style={styles.smallBtn}
                    onClick={() => {
                      setAdminOn(false);
                      setTab("home");
                    }}
                  >
                    Exit Admin
                  </button>

                  <button style={styles.smallBtn} onClick={() => initialLoad()}>
                    Reload Data
                  </button>
                </div>

                <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  <div style={styles.subCard}>
                    <div style={{ fontWeight: 800, marginBottom: 8 }}>Add Player</div>

                    <div style={{ display: "grid", gap: 10 }}>
                      <input
                        style={styles.input}
                        placeholder="Name"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                      />
                      <input
                        style={styles.input}
                        placeholder="Handicap"
                        value={newHandicap}
                        onChange={(e) => setNewHandicap(e.target.value)}
                        inputMode="numeric"
                      />
                      <input
                        style={styles.input}
                        placeholder="Charity (optional)"
                        value={newCharity}
                        onChange={(e) => setNewCharity(e.target.value)}
                      />

                      <button style={styles.bigBtn} onClick={addPlayer}>
                        Add Player
                      </button>
                    </div>
                  </div>

                  <div style={styles.subCard}>
                    <div style={{ fontWeight: 800, marginBottom: 8 }}>Players</div>
                    <div style={{ display: "grid", gap: 8 }}>
                      {players.map((p) => (
                        <div key={p.id} style={styles.row}>
                          <div>
                            <div style={{ fontWeight: 700 }}>{p.name}</div>
                            <div style={{ fontSize: 12, opacity: 0.75 }}>
                              HCP {clampInt(p.handicap, 0)} {p.charity ? `• ${p.charity}` : ""}
                            </div>
                          </div>
                          <button style={styles.dangerBtn} onClick={() => deletePlayer(p.id)}>
                            Delete
                          </button>
                        </div>
                      ))}
                      {players.length === 0 && <div style={{ opacity: 0.75 }}>No players.</div>}
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 14, fontSize: 12, opacity: 0.75 }}>
                  We’ll move Foursomes into Admin next and lock score-entry to a foursome code once foursomes are stable.
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "radial-gradient(circle at 30% 20%, #f5e6c8 0%, #2c2c2c 55%, #111 100%)",
    color: "#fff",
    padding: 18,
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
  },
  header: {
    maxWidth: 980,
    margin: "0 auto",
    padding: "10px 6px 0",
  },
  title: {
    fontSize: 44,
    fontWeight: 900,
    letterSpacing: -1,
  },
  sub: {
    marginTop: 6,
    opacity: 0.9,
  },
  nav: {
    marginTop: 14,
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },
  navBtn: {
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.18)",
    padding: "10px 14px",
    borderRadius: 12,
    color: "#fff",
    cursor: "pointer",
  },
  navBtnActive: {
    background: "rgba(255,255,255,0.18)",
    border: "1px solid rgba(255,255,255,0.3)",
    padding: "10px 14px",
    borderRadius: 12,
    color: "#fff",
    cursor: "pointer",
    fontWeight: 800,
  },
  content: {
    maxWidth: 980,
    margin: "18px auto 0",
  },
  card: {
    background: "rgba(0,0,0,0.35)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 18,
    padding: 18,
    backdropFilter: "blur(10px)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
  },
  subCard: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 14,
    padding: 14,
  },
  cardTitleRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  cardTitle: {
    fontSize: 26,
    fontWeight: 900,
  },
  label: {
    display: "grid",
    gap: 6,
    fontSize: 12,
    opacity: 0.9,
  },
  input: {
    background: "rgba(0,0,0,0.35)",
    border: "1px solid rgba(255,255,255,0.18)",
    color: "#fff",
    padding: "12px 12px",
    borderRadius: 12,
    outline: "none",
  },
  bigBtn: {
    background: "rgba(255,255,255,0.12)",
    border: "1px solid rgba(255,255,255,0.22)",
    color: "#fff",
    padding: "14px 14px",
    borderRadius: 16,
    cursor: "pointer",
    fontSize: 16,
    fontWeight: 800,
  },
  saveBtn: {
    background: "rgba(255,255,255,0.18)",
    border: "1px solid rgba(255,255,255,0.28)",
    color: "#fff",
    padding: "12px 14px",
    borderRadius: 14,
    cursor: "pointer",
    fontSize: 15,
    fontWeight: 900,
    alignSelf: "end",
    height: 46,
  },
  smallBtn: {
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.18)",
    color: "#fff",
    padding: "10px 12px",
    borderRadius: 12,
    cursor: "pointer",
    fontWeight: 700,
  },
  dangerBtn: {
    background: "rgba(255,80,80,0.16)",
    border: "1px solid rgba(255,80,80,0.35)",
    color: "#fff",
    padding: "10px 12px",
    borderRadius: 12,
    cursor: "pointer",
    fontWeight: 800,
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    alignItems: "center",
    padding: "10px 10px",
    borderRadius: 12,
    background: "rgba(0,0,0,0.18)",
    border: "1px solid rgba(255,255,255,0.10)",
  },

  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    overflow: "hidden",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
  },
  th: {
    textAlign: "left",
    padding: "10px 10px",
    fontSize: 12,
    letterSpacing: 0.2,
    opacity: 0.9,
    background: "rgba(255,255,255,0.07)",
    borderBottom: "1px solid rgba(255,255,255,0.10)",
  },
  td: {
    padding: "10px 10px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    fontSize: 14,
  },
  tdStrong: {
    padding: "10px 10px",
    borderTop: "1px solid rgba(255,255,255,0.12)",
    fontSize: 14,
    fontWeight: 900,
  },
  linkBtn: {
    background: "transparent",
    border: "none",
    color: "#fff",
    textDecoration: "underline",
    cursor: "pointer",
    fontWeight: 900,
    padding: 0,
  },

  // Modal
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    display: "grid",
    placeItems: "center",
    padding: 16,
    zIndex: 50,
  },
  modalCard: {
    width: "min(820px, 96vw)",
    background: "rgba(20,20,20,0.92)",
    border: "1px solid rgba(255,255,255,0.18)",
    borderRadius: 18,
    padding: 16,
    boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "center",
  },
};
