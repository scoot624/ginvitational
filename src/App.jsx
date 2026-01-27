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
  // Scores
  // ----------------------------
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [hole, setHole] = useState(1);
  const [strokes, setStrokes] = useState("");
  const [scores, setScores] = useState([]);
  const [loadingScores, setLoadingScores] = useState(false);

  const selectedPlayer = useMemo(
    () => players.find((p) => p.id === selectedPlayerId),
    [players, selectedPlayerId]
  );

  // ----------------------------
  // Load Players (startup)
  // ----------------------------
  useEffect(() => {
    (async () => {
      await loadPlayers();
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

    // auto-pick first player for scoring
    if (!selectedPlayerId && list.length > 0) setSelectedPlayerId(list[0].id);
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
    if (selectedPlayerId === playerId) {
      setSelectedPlayerId("");
      setScores([]);
    }
  }

  // ----------------------------
  // Scores: load for selected player
  // ----------------------------
  useEffect(() => {
    if (tab !== "scores") return;
    if (!selectedPlayerId) return;
    loadScoresForPlayer(selectedPlayerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedPlayerId]);

  async function loadScoresForPlayer(playerId) {
    setLoadingScores(true);

    const { data, error } = await supabase
      .from("scores")
      .select("*")
      .eq("player_id", playerId)
      .order("hole", { ascending: true });

    if (error) {
      console.error(error);
      alert("Error loading scores (check scores SELECT policy)");
      setLoadingScores(false);
      return;
    }

    setScores(data || []);
    setLoadingScores(false);
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
    setScores((prev) => [...prev, inserted].sort((a, b) => a.hole - b.hole));
    setStrokes("");
  }

  // ----------------------------
  // Leaderboard (gross total from scores table)
  // ----------------------------
  const leaderboard = useMemo(() => {
    const totals = new Map(); // playerId -> gross total
    for (const s of scores) {
      totals.set(s.player_id, (totals.get(s.player_id) || 0) + (s.score || 0));
    }

    return players
      .map((p) => ({ ...p, gross: totals.get(p.id) || 0 }))
      .filter((p) => p.gross > 0)
      .sort((a, b) => a.gross - b.gross);
  }, [players, scores]);

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
              We’ll fix foursomes later. For now, scoring is the priority.
            </div>
          </div>
        )}

        {tab === "scores" && (
          <div style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Scores</h2>

            {players.length === 0 ? (
              <div style={{ opacity: 0.8 }}>Add players first.</div>
            ) : (
              <>
                <div style={{ display: "grid", gap: 10, maxWidth: 460 }}>
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

                    <div style={{ width: 140, alignSelf: "end" }}>
                      <button style={buttonStyle}>Save</button>
                    </div>
                  </form>

                  <button
                    onClick={() => selectedPlayerId && loadScoresForPlayer(selectedPlayerId)}
                    style={secondaryButtonStyle}
                  >
                    Refresh Scores
                  </button>
                </div>

                <div style={{ marginTop: 18 }}>
                  <h3 style={{ marginBottom: 8 }}>
                    {selectedPlayer ? `Scores for ${selectedPlayer.name}` : "Scores"}
                  </h3>

                  {loadingScores ? (
                    <div>Loading…</div>
                  ) : scores.length === 0 ? (
                    <div style={{ opacity: 0.8 }}>No scores yet</div>
                  ) : (
                    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                      {scores.map((s) => (
                        <li key={s.id} style={scoreRowStyle}>
                          <span>Hole {s.hole}</span>
                          <span style={{ fontWeight: 800 }}>{s.score}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div style={{ marginTop: 18 }}>
                  <h3 style={{ marginBottom: 8 }}>Leaderboard (Gross for selected player’s scores)</h3>
                  {leaderboard.length === 0 ? (
                    <div style={{ opacity: 0.8 }}>Enter some scores first.</div>
                  ) : (
                    <ol>
                      {leaderboard.map((p) => (
                        <li key={p.id}>
                          <b>{p.name}</b> — {p.gross}
                        </li>
                      ))}
                    </ol>
                  )}
                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
                    Next step: we’ll load *all* players’ scores and compute real leaderboard + net.
                  </div>
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
