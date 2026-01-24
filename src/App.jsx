import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://limxknczakoydqtovvlf.supabase.co";
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpbXhrbmN6YWtveWRxdG92dmxmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2Nzg2MTcsImV4cCI6MjA4NDI1NDYxN30._0XqgEMIGr2firOgxZkNOq_11QyP9YrDrqk6feYGRbQ";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Random 6-character code like "A7K2QZ"
function makeCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Shuffle an array (Fisher-Yates)
function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = a[i];
    a[i] = a[j];
    a[j] = temp;
  }
  return a;
}

function App() {
  const [players, setPlayers] = useState([]);
  const [name, setName] = useState("");
  const [handicap, setHandicap] = useState("");
  const [charity, setCharity] = useState("");
  const [foursomes, setFoursomes] = useState([]);

  useEffect(() => {
    loadPlayers();
  }, []);

  async function loadPlayers() {
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error(error);
      return;
    }

    setPlayers(data || []);
  }

  async function addPlayer() {
    if (name.trim() === "") {
      alert("Please enter a name");
      return;
    }

    const parsedHandicap =
      handicap.trim() === "" ? null : parseInt(handicap.trim(), 10);

    const { error } = await supabase.from("players").insert([
      {
        name: name.trim(),
        handicap: parsedHandicap,
        charity: charity.trim() === "" ? null : charity.trim(),
      },
    ]);

    if (error) {
      console.error(error);
      alert("Failed to add player");
      return;
    }

    setName("");
    setHandicap("");
    setCharity("");
    loadPlayers();
  }

  async function deletePlayer(id) {
    const ok = window.confirm("Delete this player?");
    if (!ok) return;

    const { error } = await supabase.from("players").delete().eq("id", id);

    if (error) {
      console.error(error);
      alert("Failed to delete player");
      return;
    }

    loadPlayers();
  }

  function generateFoursomes() {
    if (players.length < 2) {
      alert("Add at least 2 players first");
      return;
    }

    const shuffledPlayers = shuffle(players);
    const groups = [];

    for (let i = 0; i < shuffledPlayers.length; i += 4) {
      const groupPlayers = shuffledPlayers.slice(i, i + 4);

      groups.push({
        id: Date.now().toString() + "-" + i,
        code: makeCode(),
        groupName: "Group " + (Math.floor(i / 4) + 1),
        players: groupPlayers,
      });
    }

    setFoursomes(groups);
  }

  function clearFoursomes() {
    setFoursomes([]);
  }

  return (
    <div
      style={{
        padding: 20,
        maxWidth: 900,
        fontFamily: "sans-serif",
        background: "#111",
        color: "#f5f5f5",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ marginBottom: 8 }}>Ginvitational 🍸🏌️</h1>

      <h2 style={{ marginTop: 20 }}>Players</h2>

      <div style={{ display: "grid", gap: 8, maxWidth: 520 }}>
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ padding: 10 }}
        />

        <input
          placeholder="Handicap"
          value={handicap}
          onChange={(e) => setHandicap(e.target.value.replace(/[^0-9]/g, ""))}
          style={{ padding: 10 }}
        />

        <input
          placeholder="Charity (optional)"
          value={charity}
          onChange={(e) => setCharity(e.target.value)}
          style={{ padding: 10 }}
        />

        <button onClick={addPlayer} style={{ padding: "10px 14px" }}>
          Add Player
        </button>
      </div>

      <ul style={{ marginTop: 16, paddingLeft: 18 }}>
        {players.map((player) => (
          <li key={player.id} style={{ marginBottom: 8 }}>
            <strong>{player.name}</strong> — HCP: {player.handicap ?? "-"} —{" "}
            {player.charity ?? ""}
            <button
              onClick={() => deletePlayer(player.id)}
              style={{ marginLeft: 10, padding: "4px 8px" }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      <hr style={{ margin: "24px 0", borderColor: "#333" }} />

      <h2>Foursomes</h2>

      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <button onClick={generateFoursomes} style={{ padding: "10px 14px" }}>
          Generate Foursomes
        </button>

        <button onClick={clearFoursomes} style={{ padding: "10px 14px" }}>
          Clear
        </button>
      </div>

      {foursomes.length === 0 ? (
        <div style={{ opacity: 0.8 }}>No foursomes yet — click Generate.</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {foursomes.map((group) => (
            <div
              key={group.id}
              style={{
                border: "1px solid #ddd",
                borderRadius: 10,
                padding: 12,
                background: "#fff",
                color: "#111", // ✅ THIS FIXES THE “BLANK” NAMES
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>{group.groupName}</strong>
                <span
                  style={{
                    fontFamily: "monospace",
                    background: "#f4f4f4",
                    padding: "4px 8px",
                    borderRadius: 6,
                  }}
                >
                  Code: {group.code}
                </span>
              </div>

              <ul style={{ marginTop: 10, paddingLeft: 18 }}>
                {group.players.map((p) => (
                  <li key={p.id} style={{ marginBottom: 4 }}>
                    {p.name} (HCP: {p.handicap ?? "-"})
                    {p.charity ? " — 🎗️ " + p.charity : ""}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
