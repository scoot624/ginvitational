import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

function makeCode(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing 0/O/1/I
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export default function App() {
  const [players, setPlayers] = useState([]);
  const [foursomes, setFoursomes] = useState([]);
  const [loading, setLoading] = useState(true);

  // Player form
  const [name, setName] = useState("");
  const [handicap, setHandicap] = useState("");
  const [charity, setCharity] = useState("");

  const canAdd = useMemo(() => {
    return name.trim().length > 0 && String(handicap).trim().length > 0;
  }, [name, handicap]);

  // -------- LOAD EVERYTHING ON START --------
  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadPlayers(), loadFoursomes()]);
      setLoading(false);
    })();
  }, []);

  async function loadPlayers() {
    const { data, error } = await supabase
      .from("players")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("loadPlayers error:", error);
      alert("Error loading players");
      return;
    }
    setPlayers(data ?? []);
  }

  async function loadFoursomes() {
    // Load foursomes with their players via join table
    const { data, error } = await supabase
      .from("foursomes")
      .select(
        `
        id,
        code,
        group_name,
        tee_time,
        created_at,
        foursome_players (
          player_id,
          players ( id, name, handicap, charity )
        )
      `
      )
      .order("created_at", { ascending: true });

    if (error) {
      console.error("loadFoursomes error:", error);
      alert("Error loading foursomes");
      return;
    }

    const normalized =
      (data ?? []).map((f) => ({
        id: f.id,
        code: f.code,
        groupName: f.group_name,
        teeTime: f.tee_time ?? "",
        players: (f.foursome_players ?? [])
          .map((fp) => fp.players)
          .filter(Boolean),
      })) ?? [];

    setFoursomes(normalized);
  }

  // -------- PLAYERS CRUD --------
  async function addPlayer(e) {
    e.preventDefault();
    if (!canAdd) return;

    const payload = {
      name: name.trim(),
      handicap: parseInt(handicap, 10),
      charity: charity.trim() || null,
    };

    const { error } = await supabase.from("players").insert(payload);
    if (error) {
      console.error("addPlayer error:", error);
      alert("Error adding player");
      return;
    }

    setName("");
    setHandicap("");
    setCharity("");
    await loadPlayers();
  }

  async function deletePlayer(id) {
    const ok = window.confirm("Delete this player?");
    if (!ok) return;

    const { error } = await supabase.from("players").delete().eq("id", id);
    if (error) {
      console.error("deletePlayer error:", error);
      alert("Error deleting player");
      return;
    }

    await Promise.all([loadPlayers(), loadFoursomes()]);
  }

  // -------- FOURSOMES (PERSISTED) --------
  async function generateFoursomes() {
    if (players.length < 4) {
      alert("Need at least 4 players");
      return;
    }

    // Shuffle players
    const shuffled = [...players].sort(() => Math.random() - 0.5);

    // Build groups of up to 4
    const groups = [];
    for (let i = 0; i < shuffled.length; i += 4) {
      const groupPlayers = shuffled.slice(i, i + 4);
      groups.push({
        groupName: `Group ${Math.floor(i / 4) + 1}`,
        code: makeCode(6),
        players: groupPlayers,
      });
    }

    // 1) Clear existing foursomes in DB (so regen replaces)
    // If you prefer "append", remove this block.
    await clearFoursomes(false);

    // 2) Insert foursomes rows
    const { data: insertedFoursomes, error: fErr } = await supabase
      .from("foursomes")
      .insert(
        groups.map((g) => ({
          code: g.code,
          group_name: g.groupName,
          tee_time: null,
        }))
      )
      .select("id, code, group_name, tee_time, created_at");

    if (fErr) {
      console.error("insert foursomes error:", fErr);
      alert("Error creating foursomes");
      return;
    }

    // 3) Insert join rows into foursome_players
    const joinRows = [];
    for (let i = 0; i < groups.length; i++) {
      const inserted = insertedFoursomes[i];
      const group = groups[i];

      for (const p of group.players) {
        joinRows.push({
          foursome_id: inserted.id,
          player_id: p.id,
        });
      }
    }

    const { error: fpErr } = await supabase.from("foursome_players").insert(joinRows);
    if (fpErr) {
      console.error("insert foursome_players error:", fpErr);
      alert("Error attaching players to foursomes");
      return;
    }

    await loadFoursomes();
  }

  // If showAlert = true, show confirm. If false, silent (used by generate)
  async function clearFoursomes(showAlert = true) {
    if (showAlert) {
      const ok = window.confirm("Clear all foursomes?");
      if (!ok) return;
    }

    // Deleting foursomes will cascade delete foursome_players (because of on delete cascade)
    const { error } = await supabase.from("foursomes").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) {
      console.error("clearFoursomes error:", error);
      alert("Error clearing foursomes");
      return;
    }
    setFoursomes([]);
  }

  // -------- UI --------
  return (
    <div style={{ background: "#111", minHeight: "100vh", color: "#fff", padding: 24 }}>
      <div style={{ maxWidth: 520 }}>
        <h1 style={{ margin: 0, fontSize: 34 }}>Ginvitational 🏆🏌️‍♂️</h1>

        {loading && <p>Loading…</p>}

        {/* PLAYERS */}
        <div style={{ marginTop: 18, padding: 16, borderRadius: 12, background: "#1a1a1a" }}>
          <h2 style={{ marginTop: 0 }}>Players</h2>

          <form onSubmit={addPlayer} style={{ display: "grid", gap: 8 }}>
            <input
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
            />
            <input
              placeholder="Handicap"
              value={handicap}
              onChange={(e) => setHandicap(e.target.value.replace(/[^0-9]/g, ""))}
              style={inputStyle}
            />
            <input
              placeholder="Charity (optional)"
              value={charity}
              onChange={(e) => setCharity(e.target.value)}
              style={inputStyle}
            />

            <button type="submit" disabled={!canAdd} style={buttonStyle(!canAdd)}>
              Add Player
            </button>
          </form>

          <div style={{ marginTop: 12 }}>
            {players.length === 0 ? (
              <p style={{ opacity: 0.7 }}>No players yet</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {players.map((p) => (
                  <li key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <span>
                      {p.name} — HCP: {p.handicap}
                      {p.charity ? ` — ${p.charity}` : ""}
                    </span>
                    <button onClick={() => deletePlayer(p.id)} style={linkButtonStyle}>
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* FOURSOMES */}
        <div style={{ marginTop: 14, padding: 16, borderRadius: 12, background: "#1a1a1a" }}>
          <h2 style={{ marginTop: 0 }}>Foursomes</h2>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={generateFoursomes} style={buttonStyle(false)}>
              Generate Foursomes
            </button>
            <button onClick={() => clearFoursomes(true)} style={buttonStyle(false)}>
              Clear
            </button>
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            {foursomes.length === 0 ? (
              <p style={{ opacity: 0.7 }}>No foursomes yet</p>
            ) : (
              foursomes.map((f) => (
                <div key={f.id} style={{ background: "#fff", color: "#111", borderRadius: 12, padding: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <strong>{f.groupName}</strong>
                    <span style={{ opacity: 0.7, fontSize: 12 }}>Code: {f.code}</span>
                  </div>

                  <div style={{ marginTop: 10 }}>
                    {f.players.length === 0 ? (
                      <em style={{ opacity: 0.7 }}>No players in this group</em>
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {f.players.map((p) => (
                          <li key={p.id}>
                            {p.name} (HCP {p.handicap}){p.charity ? ` — ${p.charity}` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #333",
  background: "#111",
  color: "#fff",
};

const buttonStyle = (disabled) => ({
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #333",
  background: disabled ? "#333" : "#222",
  color: "#fff",
  cursor: disabled ? "not-allowed" : "pointer",
});

const linkButtonStyle = {
  background: "transparent",
  border: "none",
  color: "#8ab4ff",
  cursor: "pointer",
  textDecoration: "underline",
  padding: 0,
};