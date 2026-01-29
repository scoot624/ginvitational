import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

/**
 * If you already moved these into Vercel env vars, keep them there and replace
 * the lines below with:
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

  // Tabs: "players" | "foursomes" | "scores" | "leaderboard" | "admin"
  const [tab, setTab] = useState("players");

  // Admin state
  const [adminEnabled, setAdminEnabled] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");

  // Players
  const [players, setPlayers] = useState([]);
  const [loadingPlayers, setLoadingPlayers] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [playerHandicap, setPlayerHandicap] = useState("");
  const [playerCharity, setPlayerCharity] = useState("");

  // --- Initial connect + restore admin flag
  useEffect(() => {
    // restore admin mode if previously enabled on this browser
    const saved = localStorage.getItem(LS_ADMIN_KEY);
    if (saved === "true") setAdminEnabled(true);

    // quick connection test
    (async () => {
      const { error } = await supabase.from("players").select("id").limit(1);
      setConnected(!error);
      if (error) console.error("Supabase connection error:", error);
    })();
  }, []);

  // --- Load players (used in multiple tabs)
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
    }
    setLoadingPlayers(false);
  }

  useEffect(() => {
    loadPlayers();
  }, []);

  // --- Admin auth handlers
  function handleUnlockAdmin(e) {
    e.preventDefault();
    setPinError("");

    if (pin.trim() === ADMIN_PIN) {
      setAdminEnabled(true);
      localStorage.setItem(LS_ADMIN_KEY, "true");
      setPin("");
      setTab("admin");
    } else {
      setPinError("Wrong PIN. Try again.");
    }
  }

  function handleLockAdmin() {
    setAdminEnabled(false);
    localStorage.removeItem(LS_ADMIN_KEY);
    setPin("");
    setPinError("");
    setTab("players");
  }

  // --- Admin: add player
  async function addPlayer(e) {
    e.preventDefault();
    if (!adminEnabled) return alert("Admin only");

    const name = playerName.trim();
    if (!name) return alert("Name is required");

    const handicapNum =
      playerHandicap === "" ? null : Number(playerHandicap.trim());
    if (playerHandicap !== "" && Number.isNaN(handicapNum)) {
      return alert("Handicap must be a number");
    }

    const charity = playerCharity.trim() || null;

    const { error } = await supabase.from("players").insert([
      {
        name,
        handicap: handicapNum ?? 0,
        charity,
      },
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

  // --- Admin: delete player
  async function deletePlayer(id) {
    if (!adminEnabled) return alert("Admin only");
    const ok = confirm("Delete this player?");
    if (!ok) return;

    const { error } = await supabase.from("players").delete().eq("id", id);
    if (error) {
      console.error(error);
      alert("Error deleting player");
      return;
    }
    await loadPlayers();
  }

  const headerStyle = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  };

  const pillStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    fontSize: 14,
    opacity: 0.9,
  };

  const tabs = useMemo(
    () => [
      { key: "players", label: "Players" },
      { key: "foursomes", label: "Foursomes" },
      { key: "scores", label: "Scores" },
      { key: "leaderboard", label: "Leaderboard" },
      { key: "admin", label: "Admin" },
    ],
    []
  );

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <div style={headerStyle}>
        <h1 style={{ margin: 0 }}>Ginvitational 🏆🏌️</h1>
        <div style={pillStyle}>
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
            <button onClick={handleLockAdmin}>Lock Admin</button>
          ) : (
            <span style={{ opacity: 0.8, fontSize: 14 }}>Admin locked</span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.15)",
              background: tab === t.key ? "rgba(255,255,255,0.12)" : "transparent",
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === "players" && (
        <Card title="Players (read-only)">
          <div style={{ opacity: 0.85, marginBottom: 12 }}>
            This view is for everyone. Admin can add/delete in the Admin tab.
          </div>

          <button onClick={loadPlayers} disabled={loadingPlayers}>
            {loadingPlayers ? "Refreshing..." : "Refresh Players"}
          </button>

          <div style={{ marginTop: 12 }}>
            {players.length === 0 ? (
              <div>No players yet</div>
            ) : (
              <ul style={{ lineHeight: 1.9 }}>
                {players.map((p) => (
                  <li key={p.id}>
                    <strong>{p.name}</strong> — HCP: {p.handicap ?? 0}
                    {p.charity ? ` — ${p.charity}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      )}

      {tab === "admin" && (
        <Card title="Admin">
          {!adminEnabled ? (
            <>
              <div style={{ marginBottom: 10, opacity: 0.9 }}>
                Enter the admin PIN to unlock player setup + foursomes setup.
              </div>

              <form onSubmit={handleUnlockAdmin} style={{ display: "flex", gap: 10 }}>
                <input
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="Enter PIN"
                  inputMode="numeric"
                  style={{ padding: 10, borderRadius: 10, width: 180 }}
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
                Admin is unlocked ✅ (This is saved on this browser.)
              </div>

              {/* Player add */}
              <div style={{ marginBottom: 18 }}>
                <h3 style={{ margin: "0 0 10px 0" }}>Add Player</h3>
                <form onSubmit={addPlayer} style={{ display: "grid", gap: 10, maxWidth: 420 }}>
                  <input
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    placeholder="Name"
                    style={{ padding: 10, borderRadius: 10 }}
                  />
                  <input
                    value={playerHandicap}
                    onChange={(e) => setPlayerHandicap(e.target.value)}
                    placeholder="Handicap (number)"
                    inputMode="numeric"
                    style={{ padding: 10, borderRadius: 10 }}
                  />
                  <input
                    value={playerCharity}
                    onChange={(e) => setPlayerCharity(e.target.value)}
                    placeholder="Charity (optional)"
                    style={{ padding: 10, borderRadius: 10 }}
                  />
                  <button type="submit">Add Player</button>
                </form>
              </div>

              {/* Player list w/ delete */}
              <div>
                <h3 style={{ margin: "0 0 10px 0" }}>Manage Players</h3>
                <button onClick={loadPlayers} disabled={loadingPlayers}>
                  {loadingPlayers ? "Refreshing..." : "Refresh Players"}
                </button>

                <div style={{ marginTop: 12 }}>
                  {players.length === 0 ? (
                    <div>No players yet</div>
                  ) : (
                    <ul style={{ lineHeight: 2 }}>
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

              {/* Placeholder for foursomes admin later */}
              <div style={{ marginTop: 18, opacity: 0.75 }}>
                Next: we’ll add “Create / Assign Foursomes” here (admin-only).
              </div>
            </>
          )}
        </Card>
      )}

      {tab === "foursomes" && (
        <Card title="Foursomes">
          <div style={{ opacity: 0.85 }}>
            We’ll come back to this. Right now, foursomes creation is not stable, so we’re
            focusing on admin + scoring.
          </div>
        </Card>
      )}

      {tab === "scores" && (
        <Card title="Scores">
          <div style={{ opacity: 0.85 }}>
            Next we’ll add: enter foursome code → see only your group → submit/edit scores.
          </div>
        </Card>
      )}

      {tab === "leaderboard" && (
        <Card title="Leaderboard">
          <div style={{ opacity: 0.85 }}>
            Next we’ll wire this to scores and refresh every minute.
          </div>
        </Card>
      )}
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
        maxWidth: 560,
      }}
    >
      <h2 style={{ marginTop: 0 }}>{title}</h2>
      {children}
    </div>
  );
}
