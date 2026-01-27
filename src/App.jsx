import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

// ✅ Supabase
const supabaseUrl = "https://limxknczakoydqtovvlf.supabase.co";
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpbXhrbmN6YWtveWRxdG92dmxmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2Nzg2MTcsImV4cCI6MjA4NDI1NDYxN30._0XqgEMIGr2firOgxZkNOq_11QyP9YrDrqk6feYGRbQ";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function App() {
  const [tab, setTab] = useState("players"); // players | foursomes | scores
  const [status, setStatus] = useState("Connecting…");

  // ----------------------------
  // Players
  // ----------------------------
  const [players, setPlayers] = useState([]);
  const [newName, setNewName] = useState("");
  const [newHandicap, setNewHandicap] = useState("");
  const [newCharity, setNewCharity] = useState("");

  // ----------------------------
  // Scores (selected player view)
  // ----------------------------
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [hole, setHole] = useState(1);
  const [strokes, setStrokes] = useState("");
  const [playerScores, setPlayerScores] = useState([]);
  const [loadingPlayerScores, setLoadingPlayerScores] = useState(false);

  // ----------------------------
  // Scores (ALL scores for leaderboard)
  // ----------------------------
  const [allScores, setAllScores] = useState([]);
  const [loadingAllScores, setLoadingAllScores] = useState(false);

  const selectedPlayer = useMemo(
    () => players.find((p) => p.id === selectedPlayerId),
    [players, selectedPlayerId]
  );

  // ----------------------------
  // Startup: load players + all scores
  // ----------------------------
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
    if (!selectedPlayerId && list.length > 0) setSelectedPlayerId(list[0].id);
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

    // clean up local score lists
    setAllScores((prev) => prev.filter((s) => s.player_id !== playerId));
    if (selectedPlayerId === playerId) {
      setSelectedPlayerId("");
      setPlayerScores([]);
    }
  }

  // ----------------------------
  // Load selected player scores when on Scores tab
  // ----------------------------
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
      alert("Error loading scores (check scores SELECT policy)");
      setLoadingPlayerScores(false);
      return;
    }

    setPlayerScores(data || []);
    setLoadingPlayerScores(false);
  }

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

    const { data, error } = await supabase.from("scores").insert(payload).select();

    if (error) {
      console.error(error);
      alert("Error saving score (check scores INSERT policy)");
      return;
    }

    const inserted = data?.[0];

    // Update both local lists
    setPlayerScores((prev) => [...prev, inserted].sort((a, b) => a.hole - b.hole));
    setAllScores((prev) => [inserted, ...prev]);

    setStrokes("");
  }

  // ----------------------------
  // Real gross leaderboard from ALL scores
  // ----------------------------
  const grossLeaderboard = useMemo(() => {
    // playerId -> { gross, holesPlayed, holesSet }
    const map = new Map();

    for (const s of allScores) {
      if (!s.player_id || !s.hole || !s.score) continue;

      const entry = map.get(s.player_id) || {
        gross: 0,
        holesPlayed: 0,
        holesSet: new Set(),
      };

      // Count hole only once (protects against duplicate entries)
      if (!entry.holesSet.has(s.hole)) {
        entry.holesSet.add(s.hole);
        entry.holesPlayed += 1;
        entry.gross += Number(s.score) || 0;
      }

      map.set(s.player_id, entry);
    }

    const rows = players
      .map((p) => {
        const entry = map.get(p.id);
        return {
          id: p.id,
          name: p.name,
          handicap: p.handicap,
          charity: p.charity,
          gross: entry?.gross || 0,
          holesPlayed: entry?.holesPlayed || 0,
        };
      })
      .filter((p) => p.holesPlayed > 0)
      .sort((a, b) => {
        if (a.gross === b.gross) return b.holesPlayed - a.holesPlayed; // tie-break: more holes played
        return a.gross - b.gross;
      });

    return rows;
  }, [players, allScores]);

  return (
    <div style={{ padding: 20, color: "white", fontFamily: "Arial, sans-serif" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <h1 style={{ marginTop: 0 }}>Ginvitational</h1>
        <div style={{ opacity: 0.75, marginBottom: 14 }}>{status}</div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <TabButton active={tab === "players"} onClick={() => setTab("players")}>
            Players
          </TabButton>
          <TabButton active={tab === "foursomes"} onClick={() => setTab("foursomes")}>
            Foursomes
          </TabButton>
          <TabButton active={tab === "scores"} onClick={() => setTab("scores")}>
            Scores
          </TabButton>
        </div>

        {/* Content */}
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

        {tab === "foursomes" && (
          <div style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Foursomes</h2>
            <div style={{ opacity: 0.8 }}>
              We’ll come back to foursomes. Next we’ll add realtime + net leaderboard.
            </div>
          </div>
        )}

        {tab === "scores" && (
          <div style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Scores</h2>

            {/* Scoring entry */}
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
                    <button onClick={loadAllScores} style={secondaryButtonStyle}>
                      Refresh Leaderboard
                    </button>
                  </div>
                </div>

                {/* Player scores list */}
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

                {/* Real leaderboard */}
                <div style={{ marginTop: 18 }}>
                  <h3 style={{ marginBottom: 8 }}>Leaderboard (Gross — all players)</h3>

                  {loadingAllScores ? (
                    <div>Loading leaderboard…</div>
                  ) : grossLeaderboard.length === 0 ? (
                    <div style={{ opacity: 0.8 }}>Enter some scores first.</div>
                  ) : (
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ textAlign: "left", opacity: 0.8 }}>
                          <th style={thStyle}>Pos</th>
                          <th style={thStyle}>Player</th>
                          <th style={thStyle}>Holes</th>
                          <th style={thStyle}>Gross</th>
                        </tr>
                      </thead>
                      <tbody>
                        {grossLeaderboard.map((p, idx) => (
                          <tr key={p.id} style={{ borderTop: "1px solid rgba(255,255,255,0.12)" }}>
                            <td style={tdStyle}>{idx + 1}</td>
                            <td style={tdStyle}>
                              <div style={{ fontWeight: 800 }}>{p.name}</div>
                              <div style={{ fontSize: 12, opacity: 0.75 }}>
                                HCP {p.handicap} {p.charity ? `— ${p.charity}` : ""}
                              </div>
                            </td>
                            <td style={tdStyle}>{p.holesPlayed}</td>
                            <td style={{ ...tdStyle, fontWeight: 900 }}>{p.gross}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
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
  flex: 1,
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
