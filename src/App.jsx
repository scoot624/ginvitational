import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

// ✅ Your Supabase project info
const supabaseUrl = "https://limxknczakoydqtovvlf.supabase.co";
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpbXhrbmN6YWtveWRxdG92dmxmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2Nzg2MTcsImV4cCI6MjA4NDI1NDYxN30._0XqgEMIGr2firOgxZkNOq_11QyP9YrDrqk6feYGRbQ";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export default function App() {
  // ----------------------------
  // Players
  // ----------------------------
  const [players, setPlayers] = useState([]);
  const [loadingPlayers, setLoadingPlayers] = useState(true);

  const [newName, setNewName] = useState("");
  const [newHandicap, setNewHandicap] = useState("");
  const [newCharity, setNewCharity] = useState("");

  // ----------------------------
  // Scores
  // ----------------------------
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [hole, setHole] = useState(1);
  const [strokes, setStrokes] = useState("");
  const [playerScores, setPlayerScores] = useState([]);
  const [loadingScores, setLoadingScores] = useState(false);

  const selectedPlayer = useMemo(
    () => players.find((p) => p.id === selectedPlayerId),
    [players, selectedPlayerId]
  );

  // ----------------------------
  // Load Players on startup
  // ----------------------------
  useEffect(() => {
    loadPlayers();
  }, []);

  async function loadPlayers() {
    setLoadingPlayers(true);
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error(error);
      alert("Error loading players");
    } else {
      setPlayers(data || []);
      // If nothing selected yet, auto-select first player (nice for scoring)
      if (!selectedPlayerId && data?.length) {
        setSelectedPlayerId(data[0].id);
      }
    }
    setLoadingPlayers(false);
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

    // Update UI
    const inserted = data?.[0];
    setPlayers((prev) => [...prev, inserted]);
    if (!selectedPlayerId) setSelectedPlayerId(inserted.id);

    // Reset form
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
      setPlayerScores([]);
    }
  }

  // ----------------------------
  // Scores helpers
  // ----------------------------
  useEffect(() => {
    if (!selectedPlayerId) {
      setPlayerScores([]);
      return;
    }
    loadScoresForPlayer(selectedPlayerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlayerId]);

  async function loadScoresForPlayer(playerId) {
    setLoadingScores(true);
    const { data, error } = await supabase
      .from("scores")
      .select("*")
      .eq("player_id", playerId)
      .order("hole", { ascending: true });

    if (error) {
      console.error(error);
      alert("Error loading scores");
      setLoadingScores(false);
      return;
    }

    setPlayerScores(data || []);
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
      alert("Error saving score");
      return;
    }

    // Add to UI and re-sort by hole
    const inserted = data?.[0];
    setPlayerScores((prev) =>
      [...prev, inserted].sort((a, b) => (a.hole ?? 0) - (b.hole ?? 0))
    );

    setStrokes("");
  }

  async function clearScoresForSelectedPlayer() {
    if (!selectedPlayerId) return;

    const ok = confirm("Delete ALL scores for this player?");
    if (!ok) return;

    const { error } = await supabase
      .from("scores")
      .delete()
      .eq("player_id", selectedPlayerId);

    if (error) {
      console.error(error);
      alert("Error clearing scores");
      return;
    }

    setPlayerScores([]);
  }

  // ----------------------------
  // UI
  // ----------------------------
  return (
    <div style={{ display: "flex", gap: 24, padding: 24 }}>
      <div style={{ width: 360 }}>
        <h1 style={{ marginTop: 0 }}>Ginvitational 🏆🏌️</h1>

        {/* Players */}
        <div style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Players</h2>

          <form onSubmit={addPlayer} style={{ display: "grid", gap: 10 }}>
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

          <div style={{ marginTop: 14 }}>
            {loadingPlayers ? (
              <div>Loading...</div>
            ) : players.length === 0 ? (
              <div>No players yet</div>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {players.map((p) => (
                  <li
                    key={p.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "6px 0",
                      borderBottom: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    <div style={{ lineHeight: 1.2 }}>
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      <div style={{ opacity: 0.8, fontSize: 12 }}>
                        HCP: {p.handicap}
                        {p.charity ? ` — ${p.charity}` : ""}
                      </div>
                    </div>
                    <button
                      onClick={() => deletePlayer(p.id)}
                      style={linkButtonStyle}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Scores */}
        <div style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Scores</h2>

          <div style={{ display: "grid", gap: 10 }}>
            <label style={labelStyle}>Player</label>
            <select
              value={selectedPlayerId}
              onChange={(e) => setSelectedPlayerId(e.target.value)}
              style={inputStyle}
            >
              {players.length === 0 ? (
                <option value="">Add a player first</option>
              ) : (
                players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (HCP {p.handicap})
                  </option>
                ))
              )}
            </select>

            <form onSubmit={saveScore} style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", gap: 10 }}>
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
              </div>

              <button style={buttonStyle} disabled={!selectedPlayerId}>
                Save Score
              </button>
            </form>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => selectedPlayerId && loadScoresForPlayer(selectedPlayerId)}
                style={secondaryButtonStyle}
                disabled={!selectedPlayerId}
              >
                Refresh
              </button>
              <button
                onClick={clearScoresForSelectedPlayer}
                style={dangerButtonStyle}
                disabled={!selectedPlayerId}
              >
                Clear Player Scores
              </button>
            </div>

            <div style={{ marginTop: 6 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                {selectedPlayer ? `Scores for ${selectedPlayer.name}` : "Scores"}
              </div>

              {loadingScores ? (
                <div>Loading scores…</div>
              ) : playerScores.length === 0 ? (
                <div style={{ opacity: 0.8 }}>No scores yet</div>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {playerScores.map((s) => (
                    <li
                      key={s.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "6px 0",
                        borderBottom: "1px solid rgba(255,255,255,0.08)",
                      }}
                    >
                      <span>Hole {s.hole}</span>
                      <span style={{ fontWeight: 700 }}>{s.score}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Foursomes placeholder (we’ll come back) */}
        <div style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>Foursomes</h2>
          <div style={{ opacity: 0.8 }}>
            We’ll come back to this once scores are working.
          </div>
        </div>
      </div>

      <div style={{ flex: 1, opacity: 0.7 }}>
        <h2 style={{ marginTop: 0 }}>Main Area</h2>
        <div>
          Later we can show leaderboard / net scoring / broadcaster updates here.
        </div>
      </div>
    </div>
  );
}

// ----------------------------
// Simple inline styles
// ----------------------------
const cardStyle = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 14,
  padding: 14,
  marginTop: 16,
};

const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.25)",
  color: "white",
  outline: "none",
};

const buttonStyle = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.10)",
  color: "white",
  fontWeight: 700,
  cursor: "pointer",
};

const secondaryButtonStyle = {
  flex: 1,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.06)",
  color: "white",
  cursor: "pointer",
};

const dangerButtonStyle = {
  flex: 1,
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,0,0,0.20)",
  color: "white",
  cursor: "pointer",
};

const linkButtonStyle = {
  background: "transparent",
  border: "none",
  color: "#7aa7ff",
  cursor: "pointer",
  fontWeight: 700,
};

const labelStyle = {
  fontSize: 12,
  opacity: 0.8,
};
