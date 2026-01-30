import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

/** ✅ Supabase via env vars */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * ⛳ PARS (set these to match your course)
 * index 0 = hole 1 par ... index 17 = hole 18 par
 */
const PARS = [
  4, 4, 4, 3, 4, 3, 5, 3, 5,
  4, 3, 5, 3, 4, 5, 4, 4, 5,
];

function clampInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function formatToPar(n) {
  if (n === 0) return "E";
  if (n > 0) return `+${n}`;
  return `${n}`;
}

function netColorStyle(netToPar) {
  if (netToPar < 0) return { color: "#16a34a" };
  if (netToPar > 0) return { color: "#dc2626" };
  return { color: "rgba(255,255,255,0.78)" };
}

function ScorecardModal({ open, onClose, player, pars }) {
  if (!open || !player) return null;

  const holes = Array.from({ length: 18 }, (_, i) => i + 1);

  const playedHoles = holes.filter((h) => player.scoresByHole[h] != null);
  const gross = playedHoles.reduce((acc, h) => acc + player.scoresByHole[h], 0);
  const parPlayed = playedHoles.reduce((acc, h) => acc + pars[h - 1], 0);

  const handicap = clampInt(player.handicap, 0);
  const proratedHandicap = (handicap * playedHoles.length) / 18;
  const netGross = gross - proratedHandicap;
  const netToPar = Math.round(netGross - parPlayed);

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <div style={{ minWidth: 0 }}>
            <div style={styles.modalTitle}>
              {player.name} <span style={{ opacity: 0.7 }}>(HCP {handicap})</span>
            </div>
            <div style={styles.modalSub}>
              Holes: {playedHoles.length} • Net vs Par:{" "}
              <span style={{ fontWeight: 900, ...netColorStyle(netToPar) }}>
                {formatToPar(netToPar)}
              </span>
            </div>
          </div>
          <button style={styles.smallBtn} onClick={onClose}>
            Close
          </button>
        </div>

        <div style={{ marginTop: 12, overflowX: "auto" }}>
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

                const diffStyle =
                  diff == null
                    ? {}
                    : diff < 0
                      ? { color: "#16a34a", fontWeight: 800 }
                      : diff > 0
                        ? { color: "#dc2626", fontWeight: 800 }
                        : { opacity: 0.9, fontWeight: 800 };

                return (
                  <tr key={h}>
                    <td style={styles.td}>{h}</td>
                    <td style={styles.td}>{par}</td>
                    <td style={styles.td}>{sc != null ? sc : "—"}</td>
                    <td style={{ ...styles.td, ...diffStyle }}>
                      {diff == null ? "—" : formatToPar(diff)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
          Net is computed as gross minus **pro-rated handicap** for holes played.
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

  // Scores entry
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [hole, setHole] = useState("1");
  const [strokes, setStrokes] = useState("4");

  // Admin
  const [adminPin, setAdminPin] = useState("");
  const [adminOn, setAdminOn] = useState(false);

  // Admin: add player
  const [newName, setNewName] = useState("");
  const [newHandicap, setNewHandicap] = useState("");
  const [newCharity, setNewCharity] = useState("");

  // Scorecard modal
  const [scorecardPlayerId, setScorecardPlayerId] = useState(null);

  // ✅ Header should show everywhere EXCEPT the landing home page
  const showHeader = tab !== "home";

  async function loadPlayers() {
    const { data, error } = await supabase
      .from("players")
      .select("id,name,handicap,charity,created_at")
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
    setStatus(a.ok && b.ok ? "Connected ✅" : "Connected, but some data failed ❗");
  }

  useEffect(() => {
    initialLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ auto-refresh leaderboard every minute (only while on leaderboard tab)
  useEffect(() => {
    if (tab !== "leaderboard") return;

    const id = setInterval(() => {
      loadPlayers();
      loadScores();
    }, 60_000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const leaderboardRows = useMemo(() => {
    // build player -> scoresByHole (last write wins)
    const scoresByPlayer = new Map();

    for (const s of scores) {
      const pid = s.player_id;
      const h = clampInt(s.hole, 0);
      const sc = clampInt(s.score, 0);
      if (h < 1 || h > 18) continue;

      if (!scoresByPlayer.has(pid)) scoresByPlayer.set(pid, {});
      const obj = scoresByPlayer.get(pid);
      if (!obj.scoresByHole) obj.scoresByHole = {};
      obj.scoresByHole[h] = sc;
    }

    const rows = players.map((p) => {
      const blob = scoresByPlayer.get(p.id) || {};
      const scoresByHole = blob.scoresByHole || {};

      const playedHoles = Object.keys(scoresByHole)
        .map((x) => clampInt(x, 0))
        .filter((h) => h >= 1 && h <= 18)
        .sort((a, b) => a - b);

      const holesPlayed = playedHoles.length;
      const handicap = clampInt(p.handicap, 0);

      const gross = playedHoles.reduce((acc, h) => acc + scoresByHole[h], 0);
      const parPlayed = playedHoles.reduce((acc, h) => acc + PARS[h - 1], 0);

      const proratedHandicap = (handicap * holesPlayed) / 18;
      const netGross = gross - proratedHandicap;
      const netToPar = holesPlayed === 0 ? 9999 : Math.round(netGross - parPlayed);

      return {
        id: p.id,
        name: p.name,
        handicap,
        charity: p.charity,
        holesPlayed,
        netToPar,
        scoresByHole,
      };
    });

    // Sort: players w/ scores first, then netToPar, tie-breaker holesPlayed (more), then name
    rows.sort((a, b) => {
      const aHas = a.holesPlayed > 0;
      const bHas = b.holesPlayed > 0;
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (a.netToPar !== b.netToPar) return a.netToPar - b.netToPar;
      if (a.holesPlayed !== b.holesPlayed) return b.holesPlayed - a.holesPlayed;
      return a.name.localeCompare(b.name);
    });

    return rows;
  }, [players, scores]);

  const scorecardPlayer = useMemo(() => {
    if (!scorecardPlayerId) return null;
    return leaderboardRows.find((r) => r.id === scorecardPlayerId) || null;
  }, [scorecardPlayerId, leaderboardRows]);

  async function saveScore() {
    const pid = selectedPlayerId;
    const h = clampInt(hole, 1);
    const sc = clampInt(strokes, 0);

    if (!pid) return alert("Pick a player first.");
    if (h < 1 || h > 18) return alert("Hole must be 1–18.");
    if (sc < 1 || sc > 20) return alert("Strokes looks wrong (try 1–20).");

    const { error } = await supabase
      .from("scores")
      .upsert({ player_id: pid, hole: h, score: sc }, { onConflict: "player_id,hole" });

    if (error) {
      console.error(error);
      alert(
        "Error saving score. (If you haven’t added unique constraint on player_id+hole, upsert may fail.)"
      );
      return;
    }

    await loadScores();
  }

  async function addPlayer() {
    if (!adminOn) return alert("Admin only.");

    const name = newName.trim();
    const handicap = clampInt(newHandicap, 0);
    const charity = newCharity.trim() || null;

    if (!name) return alert("Name required.");

    const { error } = await supabase.from("players").insert({ name, handicap, charity });

    if (error) {
      console.error(error);
      alert("Error adding player.");
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

    // delete scores first (helps avoid FK issues later)
    await supabase.from("scores").delete().eq("player_id", id);
    const { error } = await supabase.from("players").delete().eq("id", id);

    if (error) {
      console.error(error);
      alert("Error deleting player.");
      return;
    }

    await loadPlayers();
    await loadScores();
  }

  function enterAdmin() {
    if (adminPin === "112020") {
      setAdminOn(true);
      setAdminPin("");
      // stay on admin tab
    } else {
      alert("Wrong PIN");
    }
  }

  /** ✅ placeholder for now — we’ll fix Supabase RLS next */
  async function generateFoursomes() {
    if (!adminOn) return alert("Admin only.");

    try {
      // Intentionally minimal: we’ll implement correctly once your tables/policies are confirmed.
      alert("Generate Foursomes clicked. Next step: fix Supabase insert/RLS.");
    } catch (e) {
      console.error(e);
      alert("Error creating foursomes (check RLS/policies).");
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

      <div style={styles.shell}>
        {/* ✅ Header shown on Leaderboard/Scores/Admin only */}
        {showHeader && (
          <header style={styles.header}>
            <div style={styles.headerTop}>
              <div style={styles.brand}>
                <div style={styles.brandTitle}>Ginvitational</div>
                <div style={styles.brandSub}>{status}</div>
              </div>

              <nav style={styles.nav}>
                <button
                  style={tab === "home" ? styles.navBtnActive : styles.navBtn}
                  onClick={() => setTab("home")}
                >
                  Home
                </button>
                <button
                  style={tab === "leaderboard" ? styles.navBtnActive : styles.navBtn}
                  onClick={() => setTab("leaderboard")}
                >
                  Leaderboard
                </button>
                <button
                  style={tab === "scores" ? styles.navBtnActive : styles.navBtn}
                  onClick={() => setTab("scores")}
                >
                  Enter Scores
                </button>
                <button
                  style={tab === "admin" ? styles.navBtnActive : styles.navBtn}
                  onClick={() => setTab("admin")}
                >
                  Admin
                </button>
              </nav>
            </div>
          </header>
        )}

        <main style={styles.content}>
          {/* ✅ HOME/LANDING (no header, no status text) */}
          {tab === "home" && (
            <div style={styles.card}>
              <div style={{ textAlign: "center" }}>
                <img
                  src="/logo.png"
                  alt="Ginvitational logo"
                  // ✅ 300% bigger than before (74 -> 222)
                  style={{ width: 222, height: 222, objectFit: "contain" }}
                />
                <div style={{ marginTop: 14, fontSize: 34, fontWeight: 900 }}>
                  The Ginvitational
                </div>
                <div style={{ marginTop: 8, opacity: 0.82, fontSize: 14 }}>
                  Manufacturers Golf & CC • May 2026
                </div>
              </div>

              <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
                <button style={styles.bigBtn} onClick={() => setTab("leaderboard")}>
                  📊 Leaderboard
                </button>

                {/* ✅ “Enter Scores” is now a true button again (your request #2) */}
                <button style={styles.bigBtn} onClick={() => setTab("scores")}>
                  📝 Enter Scores
                </button>

                <button
                  style={styles.bigBtn}
                  onClick={() => {
                    // ✅ If already unlocked, go straight in
                    setTab("admin");
                  }}
                >
                  ⚙️ Admin
                </button>
              </div>
            </div>
          )}

          {tab === "leaderboard" && (
            <div style={styles.card}>
              <div style={styles.cardHeaderRow}>
                <div style={styles.cardTitle}>Leaderboard</div>
                <button
                  style={styles.smallBtn}
                  onClick={async () => {
                    await loadPlayers();
                    await loadScores();
                  }}
                >
                  Refresh
                </button>
              </div>

              <div style={styles.helpText}>
                Tap a player name to view their scorecard. Leaderboard auto-refreshes every minute.
              </div>

              <div style={styles.tableWrap}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}>#</th>
                      <th style={styles.th}>Player</th>
                      <th style={{ ...styles.th, textAlign: "center" }}>Holes</th>
                      <th style={{ ...styles.th, textAlign: "center" }}>Net vs Par</th>
                    </tr>
                  </thead>

                  <tbody>
                    {leaderboardRows.map((r, idx) => {
                      const displayNet = r.holesPlayed === 0 ? "—" : formatToPar(r.netToPar);
                      const netStyle =
                        r.holesPlayed === 0
                          ? { opacity: 0.6 }
                          : { fontWeight: 900, ...netColorStyle(r.netToPar) };

                      return (
                        <tr key={r.id}>
                          <td style={styles.td}>{idx + 1}</td>

                          <td style={{ ...styles.td, minWidth: 180 }}>
                            <button
                              style={styles.playerLink}
                              onClick={() => setScorecardPlayerId(r.id)}
                            >
                              {r.name}
                            </button>
                            <div style={styles.playerMeta}>
                              HCP {r.handicap}
                              {r.charity ? ` • ${r.charity}` : ""}
                            </div>
                          </td>

                          <td style={{ ...styles.td, textAlign: "center" }}>
                            <span style={styles.pill}>{r.holesPlayed}</span>
                          </td>

                          <td style={{ ...styles.td, textAlign: "center" }}>
                            <span style={netStyle}>{displayNet}</span>
                          </td>
                        </tr>
                      );
                    })}

                    {leaderboardRows.length === 0 && (
                      <tr>
                        <td style={styles.td} colSpan={4}>
                          No players yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "scores" && (
            <div style={styles.card}>
              <div style={styles.cardTitle}>Enter Scores</div>

              <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
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

                <div style={styles.scoreGrid}>
                  <label style={styles.label}>
                    Hole
                    <select
                      style={styles.input}
                      value={hole}
                      onChange={(e) => setHole(e.target.value)}
                    >
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
                      placeholder="4"
                    />
                  </label>

                  <button style={styles.saveBtn} onClick={saveScore}>
                    Save
                  </button>
                </div>

                <div style={styles.helpText}>
                  To edit a score: pick the same player + hole, enter the new number, hit Save again.
                </div>
              </div>
            </div>
          )}

          {tab === "admin" && (
            <div style={styles.card}>
              <div style={styles.cardTitle}>Admin</div>

              {!adminOn ? (
                <div style={{ marginTop: 12, display: "grid", gap: 10, maxWidth: 420 }}>
                  <label style={styles.label}>
                    Enter Admin PIN
                    <input
                      style={styles.input}
                      value={adminPin}
                      onChange={(e) => setAdminPin(e.target.value)}
                      inputMode="numeric"
                      placeholder="Enter PIN"
                      type="password"   // ✅ hides pin (dots)
                      autoComplete="off"
                    />
                  </label>

                  <button style={styles.bigBtn} onClick={enterAdmin}>
                    Unlock Admin
                  </button>

                  <div style={styles.helpText}>
                    Simple front-end PIN gate. We can harden security later.
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
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

                    <button style={styles.smallBtn} onClick={generateFoursomes}>
                      🧩 Generate Foursomes
                    </button>
                  </div>

                  <div style={styles.adminGrid}>
                    <div style={styles.subCard}>
                      <div style={styles.subTitle}>Add Player</div>

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
                      <div style={styles.subTitle}>Players</div>

                      <div style={{ display: "grid", gap: 8 }}>
                        {players.map((p) => (
                          <div key={p.id} style={styles.playerRow}>
                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontWeight: 900,
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {p.name}
                              </div>
                              <div style={styles.playerMeta}>
                                HCP {clampInt(p.handicap, 0)}
                                {p.charity ? ` • ${p.charity}` : ""}
                              </div>
                            </div>

                            <button style={styles.dangerBtn} onClick={() => deletePlayer(p.id)}>
                              Delete
                            </button>
                          </div>
                        ))}

                        {players.length === 0 && <div style={styles.helpText}>No players.</div>}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

/** Inline styles: phone-first and clean */
const styles = {
  page: {
    minHeight: "100vh",
    padding: 14,
    background:
      "radial-gradient(circle at 30% 20%, #f5e6c8 0%, #2c2c2c 55%, #111 100%)",
    color: "#fff",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
  },
  shell: {
    maxWidth: 980,
    margin: "0 auto",
  },
  header: {
    marginBottom: 12,
  },
  headerTop: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  brand: {
    minWidth: 260,
  },
  brandTitle: {
    fontSize: 34,
    fontWeight: 900,
    letterSpacing: -0.6,
    lineHeight: 1.05,
  },
  brandSub: {
    marginTop: 6,
    opacity: 0.85,
    fontSize: 13,
  },
  nav: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },
  navBtn: {
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.18)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  },
  navBtnActive: {
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(255,255,255,0.18)",
    border: "1px solid rgba(255,255,255,0.3)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 900,
  },
  content: {
    display: "grid",
    gap: 12,
  },
  card: {
    background: "rgba(0,0,0,0.35)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 18,
    padding: 16,
    backdropFilter: "blur(10px)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
  },
  cardHeaderRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: 900,
    letterSpacing: -0.2,
  },
  helpText: {
    marginTop: 10,
    fontSize: 12,
    opacity: 0.8,
    lineHeight: 1.35,
  },
  bigBtn: {
    padding: "14px 14px",
    borderRadius: 16,
    background: "rgba(255,255,255,0.12)",
    border: "1px solid rgba(255,255,255,0.22)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 16,
  },
  smallBtn: {
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.18)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 800,
  },
  dangerBtn: {
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(220,38,38,0.18)",
    border: "1px solid rgba(220,38,38,0.35)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 900,
  },

  // form
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
    fontSize: 14,
  },
  scoreGrid: {
    display: "grid",
    gap: 10,
    gridTemplateColumns: "1fr 1fr",
  },
  saveBtn: {
    gridColumn: "1 / -1",
    padding: "12px 14px",
    borderRadius: 14,
    background: "rgba(255,255,255,0.18)",
    border: "1px solid rgba(255,255,255,0.28)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 15,
  },

  // table
  tableWrap: {
    marginTop: 12,
    overflowX: "auto",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
  },
  table: {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    minWidth: 520,
  },
  th: {
    textAlign: "left",
    padding: "10px 10px",
    fontSize: 12,
    opacity: 0.9,
    background: "rgba(255,255,255,0.07)",
    borderBottom: "1px solid rgba(255,255,255,0.10)",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "10px 10px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    fontSize: 14,
    verticalAlign: "top",
    whiteSpace: "nowrap",
  },
  playerLink: {
    background: "transparent",
    border: "none",
    color: "#fff",
    cursor: "pointer",
    textDecoration: "underline",
    fontWeight: 900,
    padding: 0,
    fontSize: 15,
    textAlign: "left",
  },
  playerMeta: {
    marginTop: 4,
    fontSize: 12,
    opacity: 0.75,
    whiteSpace: "normal",
  },
  pill: {
    display: "inline-block",
    minWidth: 28,
    padding: "4px 10px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.18)",
    fontWeight: 900,
    fontSize: 12,
  },

  // admin layout
  adminGrid: {
    marginTop: 14,
    display: "grid",
    gap: 12,
    gridTemplateColumns: "1fr",
  },
  subCard: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 14,
    padding: 14,
  },
  subTitle: {
    fontWeight: 900,
    marginBottom: 10,
  },
  playerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    padding: "10px 10px",
    borderRadius: 12,
    background: "rgba(0,0,0,0.18)",
    border: "1px solid rgba(255,255,255,0.10)",
  },

  // modal
  modalOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.58)",
    display: "grid",
    placeItems: "center",
    padding: 14,
    zIndex: 50,
  },
  modalCard: {
    width: "min(860px, 96vw)",
    maxHeight: "86vh",
    overflow: "auto",
    background: "rgba(20,20,20,0.92)",
    border: "1px solid rgba(255,255,255,0.18)",
    borderRadius: 18,
    padding: 14,
    boxShadow: "0 20px 60px rgba(0,0,0,0.55)",
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
    flexWrap: "wrap",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 900,
    lineHeight: 1.1,
  },
  modalSub: {
    marginTop: 6,
    fontSize: 13,
    opacity: 0.85,
  },
};

/** Phone-friendly tweak: score grid becomes 3 columns on larger screens, and admin becomes 2 columns */
const media = typeof window !== "undefined" ? window.matchMedia("(min-width: 720px)") : null;
if (media && media.matches) {
  styles.scoreGrid.gridTemplateColumns = "1fr 1fr auto";
  styles.saveBtn.gridColumn = "auto";
  styles.saveBtn.height = 46;

  styles.adminGrid.gridTemplateColumns = "1fr 1fr";
}
