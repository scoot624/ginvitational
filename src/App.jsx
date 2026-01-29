import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

/**
 * If you already moved these into Vercel env vars, replace with:
 *   const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
 *   const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
 */
const supabaseUrl = "https://limxknczakoydqtovvlf.supabase.co";
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpbXhrbmN6YWtveWRxdG92dmxmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2Nzg2MTcsImV4cCI6MjA4NDI1NDYxN30._0XqgEMIGr2firOgxZkNOq_11QyP9YrDrqk6feYGRbQ";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const ADMIN_PIN = "112020";
const LS_ADMIN_KEY = "ginvitational_admin_enabled";

export default function App() {
  const [connected, setConnected] = useState(false);

  // public tabs: scores | leaderboard | admin
  const [tab, setTab] = useState("scores");

  // Admin state
  const [adminEnabled, setAdminEnabled] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");

  // Players (admin-managed; also used by scoring dropdown)
  const [players, setPlayers] = useState([]);
  const [loadingPlayers, setLoadingPlayers] = useState(false);

  // Admin: player form
  const [playerName, setPlayerName] = useState("");
  const [playerHandicap, setPlayerHandicap] = useState("");
  const [playerCharity, setPlayerCharity] = useState("");

  // Scores entry
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [hole, setHole] = useState(1);
  const [strokes, setStrokes] = useState("");
  const [playerScores, setPlayerScores] = useState([]);
  const [loadingPlayerScores, setLoadingPlayerScores] = useState(false);

  // Leaderboard
  const [leaderboardRows, setLeaderboardRows] = useState([]);
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);
  const [leaderboardStatus, setLeaderboardStatus] = useState("—");

  const tabs = useMemo(
    () => [
      { key: "scores", label: "Enter Scores" },
      { key: "leaderboard", label: "Leaderboard" },
      { key: "admin", label: "Admin" },
    ],
    []
  );

  // Connect + restore admin
  useEffect(() => {
    const saved = localStorage.getItem(LS_ADMIN_KEY);
    if (saved === "true") setAdminEnabled(true);

    (async () => {
      const { error } = await supabase.from("players").select("id").limit(1);
      setConnected(!error);
      if (error) console.error("Supabase connect error:", error);
    })();
  }, []);

  // Load players
  async function loadPlayers() {
    setLoadingPlayers(true);
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error(error);
      alert("Error loading players");
      setPlayers([]);
    } else {
      setPlayers(data || []);
      // default selected player if empty
      if (!selectedPlayerId && (data || []).length > 0) {
        setSelectedPlayerId(data[0].id);
      }
    }
    setLoadingPlayers(false);
  }

  useEffect(() => {
    loadPlayers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load selected player's scores
  async function loadScoresForPlayer(playerId) {
    if (!playerId) return;
    setLoadingPlayerScores(true);

    const { data, error } = await supabase
      .from("scores")
      .select("*")
      .eq("player_id", playerId)
      .order("hole", { ascending: true });

    if (error) {
      console.error(error);
      alert("Error loading scores");
      setPlayerScores([]);
    } else {
      setPlayerScores(data || []);
    }

    setLoadingPlayerScores(false);
  }

  useEffect(() => {
    if (selectedPlayerId) loadScoresForPlayer(selectedPlayerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlayerId]);

  // Save score (UPSERT)
  async function saveScore(e) {
    e.preventDefault();

    if (!selectedPlayerId) return alert("Pick a player first");
    const strokesNum = Number(strokes);
    if (!strokes || Number.isNaN(strokesNum)) return alert("Strokes must be a number");

    // We are assuming you've created the unique constraint:
    // unique (player_id, hole)
    // If you haven't, upsert won't work reliably.
    const { error } = await supabase
      .from("scores")
      .upsert(
        [{ player_id: selectedPlayerId, hole: Number(hole), score: strokesNum }],
        { onConflict: "player_id,hole" }
      );

    if (error) {
      console.error(error);
      alert("Error saving score");
      return;
    }

    setStrokes("");
    await loadScoresForPlayer(selectedPlayerId);
  }

  // Leaderboard load (simple: total strokes; later: net)
  async function loadLeaderboard() {
    setLoadingLeaderboard(true);

    // Pull all players + scores, then aggregate in JS (simple + works without SQL views)
    const [{ data: pData, error: pErr }, { data: sData, error: sErr }] = await Promise.all([
      supabase.from("players").select("id,name,handicap,charity"),
      supabase.from("scores").select("player_id,score"),
    ]);

    if (pErr || sErr) {
      console.error(pErr || sErr);
      setLeaderboardStatus("Error loading leaderboard");
      setLeaderboardRows([]);
      setLoadingLeaderboard(false);
      return;
    }

    const totals = new Map(); // player_id -> total strokes
    for (const s of sData || []) {
      totals.set(s.player_id, (totals.get(s.player_id) || 0) + (s.score || 0));
    }

    const rows =
      (pData || []).map((p) => ({
        id: p.id,
        name: p.name,
        handicap: p.handicap ?? 0,
        charity: p.charity ?? null,
        total: totals.get(p.id) ?? 0,
      })) || [];

    rows.sort((a, b) => a.total - b.total);
    setLeaderboardRows(rows);
    setLeaderboardStatus(`Updated ${new Date().toLocaleTimeString()}`);
    setLoadingLeaderboard(false);
  }

  // Refresh leaderboard every minute when on leaderboard tab
  useEffect(() => {
    let timer = null;

    if (tab === "leaderboard") {
      loadLeaderboard();
      timer = setInterval(loadLeaderboard, 60_000);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Admin auth
  function unlockAdmin(e) {
    e.preventDefault();
    setPinError("");

    if (pin.trim() === ADMIN_PIN) {
      setAdminEnabled(true);
      localStorage.setItem(LS_ADMIN_KEY, "true");
      setPin("");
    } else {
      setPinError("Wrong PIN. Try again.");
    }
  }

  function lockAdmin() {
    setAdminEnabled(false);
    localStorage.removeItem(LS_ADMIN_KEY);
    setPin("");
    setPinError("");
    setTab("scores");
  }

  // Admin: add/delete players
  async function addPlayer(e) {
    e.preventDefault();
    if (!adminEnabled) return alert("Admin only");

    const name = playerName.trim();
    if (!name) return alert("Name is required");

    const handicapNum =
      playerHandicap === "" ? 0 : Number(playerHandicap.trim());
    if (playerHandicap !== "" && Number.isNaN(handicapNum)) {
      return alert("Handicap must be a number");
    }

    const charity = playerCharity.trim() || null;

    const { error } = await supabase.from("players").insert([
      { name, handicap: handicapNum, charity },
    ]);

    if (error) {
      console.error(error);
      alert("Error adding player");
      return;
    }

    setPlayerName("");
    setPlayerHandicap("");
    setPlayerCharity("");
    await loadPlayers();
  }

  async function deletePlayer(id) {
    if (!adminEnabled) return alert("Admin only");
    if (!confirm("Delete this player?")) return;

    const { error } = await supabase.from("players").delete().eq("id", id);
    if (error) {
      console.error(error);
      alert("Error deleting player");
      return;
    }
    await loadPlayers();
  }

  const selectedPlayer = players.find((p) => p.id === selectedPlayerId);

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <Header connected={connected} adminEnabled={adminEnabled} onLock={lockAdmin} />

      {/* Tabs */}
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={tabBtnStyle(tab === t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ENTER SCORES (public) */}
      {tab === "scores" && (
        <Card title="Enter Scores">
          <div style={{ marginBottom: 10, opacity: 0.85 }}>
            Pick a player, pick a hole, enter strokes, hit Save. Re-enter a hole to update it.
          </div>

          <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
            <label>
              <div style={labelStyle}>Player</div>
              <select
                value={selectedPlayerId}
                onChange={(e) => setSelectedPlayerId(e.target.value)}
                style={inputStyle}
              >
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (HCP {p.handicap ?? 0})
                  </option>
                ))}
              </select>
            </label>

            <div style={{ display: "flex", gap: 10 }}>
              <label style={{ flex: 1 }}>
                <div style={labelStyle}>Hole</div>
                <select
                  value={hole}
                  onChange={(e) => setHole(Number(e.target.value))}
                  style={inputStyle}
                >
                  {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ flex: 1 }}>
                <div style={labelStyle}>Strokes</div>
                <input
                  value={strokes}
                  onChange={(e) => setStrokes(e.target.value)}
                  inputMode="numeric"
                  placeholder="e.g. 5"
                  style={inputStyle}
                />
              </label>

              <div style={{ display: "flex", alignItems: "end" }}>
                <button onClick={saveScore} style={{ padding: "10px 16px", borderRadius: 10 }}>
                  Save
                </button>
              </div>
            </div>

            <button
              onClick={() => loadScoresForPlayer(selectedPlayerId)}
              disabled={loadingPlayerScores}
              style={{ width: 220 }}
            >
              {loadingPlayerScores ? "Refreshing..." : "Refresh Player Scores"}
            </button>
          </div>

          <div style={{ marginTop: 16 }}>
            <h3 style={{ margin: "0 0 10px 0" }}>
              Scores for {selectedPlayer ? selectedPlayer.name : "—"}
            </h3>

            {playerScores.length === 0 ? (
              <div style={{ opacity: 0.85 }}>No scores yet</div>
            ) : (
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.12)" }}>
                {playerScores.map((s) => (
                  <div
                    key={`${s.player_id}-${s.hole}`}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "10px 0",
                      borderBottom: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    <div>Hole {s.hole}</div>
                    <div style={{ fontWeight: 700 }}>{s.score}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* LEADERBOARD (public) */}
      {tab === "leaderboard" && (
        <Card title="Leaderboard">
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
            <button onClick={loadLeaderboard} disabled={loadingLeaderboard}>
              {loadingLeaderboard ? "Refreshing..." : "Refresh now"}
            </button>
            <div style={{ opacity: 0.8, fontSize: 14 }}>{leaderboardStatus}</div>
            <div style={{ marginLeft: "auto", opacity: 0.75, fontSize: 14 }}>
              Auto-refresh every 1 min
            </div>
          </div>

          {leaderboardRows.length === 0 ? (
            <div style={{ opacity: 0.85 }}>No data yet</div>
          ) : (
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.12)" }}>
              {leaderboardRows.map((r, idx) => (
                <div
                  key={r.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "50px 1fr 110px",
                    gap: 10,
                    padding: "10px 0",
                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                    alignItems: "center",
                  }}
                >
                  <div style={{ opacity: 0.85 }}>#{idx + 1}</div>
                  <div>
                    <div style={{ fontWeight: 700 }}>{r.name}</div>
                    <div style={{ opacity: 0.75, fontSize: 13 }}>
                      HCP {r.handicap}
                      {r.charity ? ` • ${r.charity}` : ""}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", fontWeight: 800 }}>
                    {r.total}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ADMIN */}
      {tab === "admin" && (
        <Card title="Admin">
          {!adminEnabled ? (
            <>
              <div style={{ marginBottom: 10, opacity: 0.9 }}>
                Enter admin PIN to unlock Players + Foursomes setup.
              </div>

              <form onSubmit={unlockAdmin} style={{ display: "flex", gap: 10 }}>
                <input
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="Enter PIN"
                  inputMode="numeric"
                  style={{ ...inputStyle, width: 200 }}
                />
                <button type="submit">Unlock</button>
              </form>

              {pinError ? (
                <div style={{ marginTop: 10, color: "salmon" }}>{pinError}</div>
              ) : null}
            </>
          ) : (
            <>
              <div style={{ marginBottom: 14, opacity: 0.9 }}>
                Admin unlocked ✅ (saved on this browser).{" "}
                <button onClick={lockAdmin} style={{ marginLeft: 10 }}>
                  Lock
                </button>
              </div>

              {/* Players admin */}
              <div style={{ marginBottom: 18 }}>
                <h3 style={{ margin: "0 0 10px 0" }}>Players</h3>

                <form onSubmit={addPlayer} style={{ display: "grid", gap: 10, maxWidth: 420 }}>
                  <input
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    placeholder="Name"
                    style={inputStyle}
                  />
                  <input
                    value={playerHandicap}
                    onChange={(e) => setPlayerHandicap(e.target.value)}
                    placeholder="Handicap (number)"
                    inputMode="numeric"
                    style={inputStyle}
                  />
                  <input
                    value={playerCharity}
                    onChange={(e) => setPlayerCharity(e.target.value)}
                    placeholder="Charity (optional)"
                    style={inputStyle}
                  />
                  <button type="submit">Add Player</button>
                </form>

                <div style={{ marginTop: 12 }}>
                  <button onClick={loadPlayers} disabled={loadingPlayers}>
                    {loadingPlayers ? "Refreshing..." : "Refresh Players"}
                  </button>
                </div>

                <div style={{ marginTop: 12 }}>
                  {players.length === 0 ? (
                    <div>No players yet</div>
                  ) : (
                    <ul style={{ lineHeight: 2, paddingLeft: 18 }}>
                      {players.map((p) => (
                        <li key={p.id} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                          <div style={{ flex: 1 }}>
                            <strong>{p.name}</strong> — HCP: {p.handicap ?? 0}
                            {p.charity ? ` — ${p.charity}` : ""}
                          </div>
                          <button onClick={() => deletePlayer(p.id)}>Delete</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              {/* Foursomes admin placeholder */}
              <div style={{ marginTop: 18, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.12)" }}>
                <h3 style={{ margin: "0 0 10px 0" }}>Foursomes</h3>
                <div style={{ opacity: 0.8 }}>
                  We’ll add “Create / Assign Foursomes” here next (admin-only). Your current foursomes logic is still
                  failing, so we’re leaving it out for now.
                </div>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}

/* ---------- UI helpers ---------- */

function Header({ connected, adminEnabled, onLock }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
      <h1 style={{ margin: 0 }}>Ginvitational</h1>

      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14, opacity: 0.9 }}>
        <span>Connected</span>
        <span
          style={{
            display: "inline-block",
            width: 10,
            height: 10,
            borderRadius: 999,
            background: connected ? "limegreen" : "crimson",
          }}
        />
      </div>

      <div style={{ marginLeft: "auto" }}>
        {adminEnabled ? (
          <button onClick={onLock}>Lock Admin</button>
        ) : (
          <span style={{ opacity: 0.8, fontSize: 14 }}>Admin locked</span>
        )}
      </div>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div
      style={{
        padding: 18,
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.06)",
        maxWidth: 620,
      }}
    >
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {children}
    </div>
  );
}

function tabBtnStyle(active) {
  return {
    padding: "8px 14px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.15)",
    background: active ? "rgba(255,255,255,0.12)" : "transparent",
    cursor: "pointer",
  };
}

const inputStyle = {
  padding: 10,
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(0,0,0,0.15)",
  color: "inherit",
};

const labelStyle = {
  fontSize: 13,
  opacity: 0.8,
  marginBottom: 6,
};
