import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

// ✅ Supabase
const supabaseUrl = "https://limxknczakoydqtovvlf.supabase.co";
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpbXhrbmN6YWtveWRxdG92dmxmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2Nzg2MTcsImV4cCI6MjA4NDI1NDYxN30._0XqgEMIGr2firOgxZkNOq_11QyP9YrDrqk6feYGRbQ";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ⛳ Course (par + handicap ranking per hole; 1 = hardest)
const COURSE = {
  name: "Manufacturers' Golf & Country Club",
  par: 72,
  holes: [
    { number: 1, par: 4, hcp: 12 },
    { number: 2, par: 4, hcp: 10 },
    { number: 3, par: 4, hcp: 4 },
    { number: 4, par: 3, hcp: 14 },
    { number: 5, par: 4, hcp: 2 },
    { number: 6, par: 3, hcp: 8 },
    { number: 7, par: 5, hcp: 6 },
    { number: 8, par: 3, hcp: 18 },
    { number: 9, par: 5, hcp: 16 },
    { number: 10, par: 4, hcp: 9 },
    { number: 11, par: 3, hcp: 3 },
    { number: 12, par: 5, hcp: 17 },
    { number: 13, par: 3, hcp: 13 },
    { number: 14, par: 4, hcp: 5 },
    { number: 15, par: 5, hcp: 15 },
    { number: 16, par: 4, hcp: 1 },
    { number: 17, par: 4, hcp: 11 },
    { number: 18, par: 5, hcp: 7 },
  ],
};

function toParString(n) {
  if (n === 0) return "E";
  return n > 0 ? `+${n}` : `${n}`;
}

export default function App() {
  const [tab, setTab] = useState("players"); // players | foursomes | scores | leaderboard
  const [status, setStatus] = useState("Connecting…");

  // Players
  const [players, setPlayers] = useState([]);
  const [newName, setNewName] = useState("");
  const [newHandicap, setNewHandicap] = useState("");
  const [newCharity, setNewCharity] = useState("");

  // Scores (selected player)
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [hole, setHole] = useState(1);
  const [strokes, setStrokes] = useState("");
  const [playerScores, setPlayerScores] = useState([]);
  const [loadingPlayerScores, setLoadingPlayerScores] = useState(false);

  // All scores (leaderboard)
  const [allScores, setAllScores] = useState([]);
  const [loadingAllScores, setLoadingAllScores] = useState(false);

  // Leaderboard auto-refresh
  const [autoRefreshOn, setAutoRefreshOn] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);

  const selectedPlayer = useMemo(
    () => players.find((p) => p.id === selectedPlayerId),
    [players, selectedPlayerId]
  );

  // Startup
  useEffect(() => {
    (async () => {
      await loadPlayers();
      await loadAllScores();
      setStatus("Connected ✅");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadPlayers() {
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error(error);
      setStatus("Error loading players");
      return;
    }

    const list = data || [];
    setPlayers(list);

    if (!selectedPlayerId && list.length > 0) {
      setSelectedPlayerId(list[0].id);
    }
  }

  async function loadAllScores() {
    setLoadingAllScores(true);

    const { data, error } = await supabase
      .from("scores")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      alert("Error loading ALL scores (check scores SELECT policy)");
      setLoadingAllScores(false);
      return;
    }

    setAllScores(data || []);
    setLastUpdated(new Date());
    setLoadingAllScores(false);
  }

  async function addPlayer(e) {
    e.preventDefault();

    if (!newName.trim()) return alert("Name is required");
    if (newHandicap === "" || isNaN(Number(newHandicap)))
      return alert("Handicap must be a number");

    const payload = {
      name: newName.trim(),
      handicap: Number(newHandicap),
      charity: newCharity.trim() ? newCharity.trim() : null,
    };

    const { data, error } = await supabase.from("players").insert(payload).select();

    if (error) {
      console.error(error);
      alert("Error adding player");
      return;
    }

    const inserted = data?.[0];
    setPlayers((prev) => [...prev, inserted]);
    if (!selectedPlayerId) setSelectedPlayerId(inserted.id);

    setNewName("");
    setNewHandicap("");
    setNewCharity("");
  }

  async function deletePlayer(playerId) {
    const ok = confirm("Delete this player?");
    if (!ok) return;

    const { error } = await supabase.from("players").delete().eq("id", playerId);

    if (error) {
      console.error(error);
      alert("Error deleting player");
      return;
    }

    setPlayers((prev) => prev.filter((p) => p.id !== playerId));
    setAllScores((prev) => prev.filter((s) => s.player_id !== playerId));

    if (selectedPlayerId === playerId) {
      setSelectedPlayerId("");
      setPlayerScores([]);
    }
  }

  // Load selected player scores when on Scores tab
  useEffect(() => {
    if (tab !== "scores") return;
    if (!selectedPlayerId) return;
    loadScoresForPlayer(selectedPlayerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedPlayerId]);

  async function loadScoresForPlayer(playerId) {
    setLoadingPlayerScores(true);

    const { data, error } = await supabase
      .from("scores")
      .select("*")
      .eq("player_id", playerId)
      .order("hole", { ascending: true });

    if (error) {
      console.error(error);
      alert("Error loading player scores (check scores SELECT policy)");
      setLoadingPlayerScores(false);
      return;
    }

    setPlayerScores(data || []);
    setLoadingPlayerScores(false);
  }

  // ✅ UPSERT score: update hole if already exists
  async function saveScore(e) {
    e.preventDefault();

    if (!selectedPlayerId) return alert("Pick a player first");
    if (strokes === "" || isNaN(Number(strokes)))
      return alert("Score must be a number");

    const payload = {
      player_id: selectedPlayerId,
      hole: Number(hole),
      score: Number(strokes),
    };

    const { data, error } = await supabase
      .from("scores")
      .upsert(payload, { onConflict: "player_id,hole" })
      .select();

    if (error) {
      console.error(error);
      alert("Error saving score");
      return;
    }

    const saved = data?.[0];
    if (!saved) return;

    // Update selected player's scores list
    setPlayerScores((prev) => {
      const filtered = prev.filter((s) => Number(s.hole) !== Number(saved.hole));
      return [...filtered, saved].sort((a, b) => a.hole - b.hole);
    });

    // Update all scores list used for leaderboard (replace that player+hole)
    setAllScores((prev) => {
      const filtered = prev.filter(
        (s) =>
          !(
            s.player_id === saved.player_id &&
            Number(s.hole) === Number(saved.hole)
          )
      );
      return [saved, ...filtered];
    });

    setLastUpdated(new Date());
    setStrokes("");
  }

  // ✅ Leaderboard auto-refresh every 60 seconds (ONLY on leaderboard tab)
  useEffect(() => {
    if (!autoRefreshOn) return;
    if (tab !== "leaderboard") return;

    // refresh immediately when entering leaderboard
    loadAllScores();

    const id = setInterval(() => {
      loadAllScores();
    }, 60000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, autoRefreshOn]);

  // ---- NET calc helpers ----
  const holesByDifficulty = useMemo(() => {
    return [...COURSE.holes].sort((a, b) => a.hcp - b.hcp); // 1 hardest
  }, []);

  function strokesOnHole(playerHandicap, holeNumber) {
    const h = Math.max(0, Math.floor(Number(playerHandicap) || 0));
    if (h <= 0) return 0;

    const base = Math.floor(h / 18);
    const remainder = h % 18;

    const rankIndex = holesByDifficulty.findIndex((x) => x.number === holeNumber);
    const extra = rankIndex >= 0 && rankIndex < remainder ? 1 : 0;

    return base + extra;
  }

  // Build net leaderboard from allScores
  const netLeaderboard = useMemo(() => {
    // Latest score per player+hole (since we load desc, first seen wins)
    const latest = new Map();
    for (const s of allScores) {
      if (!s.player_id || !s.hole || !s.score) continue;
      const key = `${s.player_id}-${s.hole}`;
      if (!latest.has(key)) latest.set(key, s);
    }

    // Group by player
    const byPlayer = new Map();
    for (const s of latest.values()) {
      const arr = byPlayer.get(s.player_id) || [];
      arr.push({ hole: Number(s.hole), score: Number(s.score) });
      byPlayer.set(s.player_id, arr);
    }

    const rows = players
      .map((p) => {
        const scoresArr = byPlayer.get(p.id) || [];
        if (scoresArr.length === 0) return null;

        let gross = 0;
        let parForPlayed = 0;
        let strokesUsed = 0;

        for (const sc of scoresArr) {
          gross += sc.score;

          const holeMeta = COURSE.holes.find((h) => h.number === sc.hole);
          if (holeMeta) parForPlayed += holeMeta.par;

          strokesUsed += strokesOnHole(p.handicap, sc.hole);
        }

        const net = gross - strokesUsed;
        const toPar = net - parForPlayed;

        return {
          id: p.id,
          name: p.name,
          handicap: p.handicap,
          charity: p.charity,
          holesPlayed: scoresArr.length,
          gross,
          net,
          toPar,
        };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (a.net === b.net) return b.holesPlayed - a.holesPlayed;
        return a.net - b.net;
      });

    return rows;
  }, [players, allScores, holesByDifficulty]);

  return (
    <div style={{ padding: 20, color: "white", fontFamily: "Arial, sans-serif" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <h1 style={{ marginTop: 0 }}>Ginvitational</h1>
        <div style={{ opacity: 0.75, marginBottom: 14 }}>{status}</div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <TabButton active={tab === "players"} onClick={() => setTab("players")}>
            Players
          </TabButton>
          <TabButton active={tab === "foursomes"} onClick={() => setTab("foursomes")}>
            Foursomes
          </TabButton>
          <TabButton active={tab === "scores"} onClick={() => setTab("scores")}>
            Scores
          </TabButton>
          <TabButton active={tab === "leaderboard"} onClick={() => setTab("leaderboard")}>
            Leaderboard
          </TabButton>
        </div>

        {/* Players */}
        {tab === "players" && (
          <div style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Players</h2>

            <form onSubmit={addPlayer} style={{ display: "grid", gap: 10, maxWidth: 380 }}>
              <input
                placeholder="Name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={inputStyle}
              />
              <input
                placeholder="Handicap"
                value={newHandicap}
                onChange={(e) => setNewHandicap(e.target.value)}
                style={inputStyle}
              />
              <input
                placeholder="Charity (optional)"
                value={newCharity}
                onChange={(e) => setNewCharity(e.target.value)}
                style={inputStyle}
              />
              <button style={buttonStyle}>Add Player</button>
            </form>

            <div style={{ marginTop: 16 }}>
              {players.length === 0 ? (
                <div style={{ opacity: 0.8 }}>No players yet</div>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {players.map((p) => (
                    <li key={p.id} style={rowStyle}>
                      <div>
                        <div style={{ fontWeight: 700 }}>{p.name}</div>
                        <div style={{ fontSize: 12, opacity: 0.8 }}>
                          HCP: {p.handicap} {p.charity ? `— ${p.charity}` : ""}
                        </div>
                      </div>
                      <button onClick={() => deletePlayer(p.id)} style={linkButtonStyle}>
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Foursomes placeholder */}
        {tab === "foursomes" && (
          <div style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Foursomes</h2>
            <div style={{ opacity: 0.8 }}>
              We’ll come back to foursomes (RLS + saving). Scoring + leaderboard first.
            </div>
          </div>
        )}

        {/* Scores */}
        {tab === "scores" && (
          <div style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Scores</h2>

            {players.length === 0 ? (
              <div style={{ opacity: 0.8 }}>Add players first.</div>
            ) : (
              <>
                <div style={{ display: "grid", gap: 10, maxWidth: 520 }}>
                  <label style={labelStyle}>Player</label>
                  <select
                    value={selectedPlayerId}
                    onChange={(e) => setSelectedPlayerId(e.target.value)}
                    style={inputStyle}
                  >
                    {players.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} (HCP {p.handicap})
                      </option>
                    ))}
                  </select>

                  <form onSubmit={saveScore} style={{ display: "flex", gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Hole</label>
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
                    </div>

                    <div style={{ flex: 1 }}>
                      <label style={labelStyle}>Strokes</label>
                      <input
                        value={strokes}
                        onChange={(e) => setStrokes(e.target.value)}
                        placeholder="e.g. 5"
                        style={inputStyle}
                      />
                    </div>

                    <div style={{ width: 160, alignSelf: "end" }}>
                      <button style={buttonStyle}>Save</button>
                    </div>
                  </form>

                  <div style={{ display: "flex", gap: 10 }}>
                    <button
                      onClick={() => selectedPlayerId && loadScoresForPlayer(selectedPlayerId)}
                      style={secondaryButtonStyle}
                    >
                      Refresh Player Scores
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: 18 }}>
                  <h3 style={{ marginBottom: 8 }}>
                    {selectedPlayer ? `Scores for ${selectedPlayer.name}` : "Scores"}
                  </h3>

                  {loadingPlayerScores ? (
                    <div>Loading…</div>
                  ) : playerScores.length === 0 ? (
                    <div style={{ opacity: 0.8 }}>No scores yet</div>
                  ) : (
                    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                      {playerScores.map((s) => (
                        <li key={s.id} style={scoreRowStyle}>
                          <span>Hole {s.hole}</span>
                          <span style={{ fontWeight: 800 }}>{s.score}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Leaderboard */}
        {tab === "leaderboard" && (
          <div style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Leaderboard (Net)</h2>

            <div
              style={{
                display: "flex",
                gap: 10,
                marginBottom: 12,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <button onClick={loadAllScores} style={secondaryButtonStyle}>
                Refresh Now
              </button>

              <label style={{ display: "flex", gap: 8, alignItems: "center", opacity: 0.9 }}>
                <input
                  type="checkbox"
                  checked={autoRefreshOn}
                  onChange={(e) => setAutoRefreshOn(e.target.checked)}
                />
                Auto-refresh (every 60s)
              </label>

              <span style={{ fontSize: 12, opacity: 0.75 }}>
                {lastUpdated ? `Last updated: ${lastUpdated.toLocaleTimeString()}` : ""}
              </span>
            </div>

            {loadingAllScores ? (
              <div>Loading leaderboard…</div>
            ) : netLeaderboard.length === 0 ? (
              <div style={{ opacity: 0.8 }}>Enter some scores first.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", opacity: 0.8 }}>
                    <th style={thStyle}>Pos</th>
                    <th style={thStyle}>Player</th>
                    <th style={thStyle}>Holes</th>
                    <th style={thStyle}>Gross</th>
                    <th style={thStyle}>Net</th>
                    <th style={thStyle}>To Par</th>
                  </tr>
                </thead>
                <tbody>
                  {netLeaderboard.map((p, idx) => (
                    <tr
                      key={p.id}
                      style={{ borderTop: "1px solid rgba(255,255,255,0.12)" }}
                    >
                      <td style={tdStyle}>{idx + 1}</td>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 800 }}>{p.name}</div>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>
                          HCP {p.handicap} {p.charity ? `— ${p.charity}` : ""}
                        </div>
                      </td>
                      <td style={tdStyle}>{p.holesPlayed}</td>
                      <td style={tdStyle}>{p.gross}</td>
                      <td style={{ ...tdStyle, fontWeight: 900 }}>{p.net}</td>
                      <td style={{ ...tdStyle, fontWeight: 900 }}>{toParString(p.toPar)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 8 }}>
              Net = Gross − handicap strokes on hardest holes (based on hole HCP). To Par is for holes played.
            </div>
          </div>
        )}
      </div>

      <div style={bgStyle} />
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "10px 14px",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.16)",
        background: active ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.06)",
        color: "white",
        fontWeight: 800,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

const bgStyle = {
  position: "fixed",
  inset: 0,
  background: "radial-gradient(circle at top left, #463a2b, #0b0b0b 60%)",
  zIndex: -1,
};

const cardStyle = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 14,
  padding: 16,
};

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(0,0,0,0.25)",
  color: "white",
  outline: "none",
};

const buttonStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(255,255,255,0.12)",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
};

const secondaryButtonStyle = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.16)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  fontWeight: 800,
  cursor: "pointer",
};

const linkButtonStyle = {
  background: "transparent",
  border: "none",
  color: "#7aa7ff",
  cursor: "pointer",
  fontWeight: 800,
};

const rowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 0",
  borderBottom: "1px solid rgba(255,255,255,0.10)",
};

const scoreRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  padding: "8px 0",
  borderBottom: "1px solid rgba(255,255,255,0.10)",
};

const labelStyle = {
  fontSize: 12,
  opacity: 0.8,
};

const thStyle = { padding: "10px 8px" };
const tdStyle = { padding: "10px 8px", verticalAlign: "top" };
