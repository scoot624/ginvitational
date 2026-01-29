import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import "./App.css";

/**
* If you already moved these into Vercel env vars, swap to:
* const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
* const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
*/
const supabaseUrl = "https://limxknczakoydqtovvlf.supabase.co";
const supabaseAnonKey =
"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpbXhrbmN6YWtveWRxdG92dmxmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg2Nzg2MTcsImV4cCI6MjA4NDI1NDYxN30._0XqgEMIGr2firOgxZkNOq_11QyP9YrDrqk6feYGRbQ";

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const ADMIN_PIN = "112020";
const LS_ADMIN_KEY = "ginvitational_admin_enabled";

export default function App() {
const [connected, setConnected] = useState(false);

// NEW: "home" is the default
const [tab, setTab] = useState("home");

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

// Leaderboard load (simple total strokes)
async function loadLeaderboard() {
setLoadingLeaderboard(true);

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

const totals = new Map();
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
setTab("home");
}

// Admin: add/delete players
async function addPlayer(e) {
e.preventDefault();
if (!adminEnabled) return alert("Admin only");

const name = playerName.trim();
if (!name) return alert("Name is required");

const handicapNum = playerHandicap === "" ? 0 : Number(playerHandicap.trim());
if (playerHandicap !== "" && Number.isNaN(handicapNum)) {
return alert("Handicap must be a number");
}

const charity = playerCharity.trim() || null;

const { error } = await supabase.from("players").insert([{ name, handicap: handicapNum, charity }]);

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
<div className="page">
{/* HOME */}
{tab === "home" && (
<HomeScreen
connected={connected}
onLeaderboard={() => setTab("leaderboard")}
onScores={() => setTab("scores")}
onAdmin={() => setTab("admin")}
/>
)}

{/* SCORES */}
{tab === "scores" && (
<div className="screen">
<TopBar title="Enter Scores" onBack={() => setTab("home")} />

<div className="card">
<div className="muted" style={{ marginBottom: 10 }}>
Pick a player → pick a hole → enter strokes → Save.
</div>

<label className="label">
Player
<select
className="input"
value={selectedPlayerId}
onChange={(e) => setSelectedPlayerId(e.target.value)}
>
{players.map((p) => (
<option key={p.id} value={p.id}>
{p.name} (HCP {p.handicap ?? 0})
</option>
))}
</select>
</label>

<div className="row">
<label className="label" style={{ flex: 1 }}>
Hole
<select className="input" value={hole} onChange={(e) => setHole(Number(e.target.value))}>
{Array.from({ length: 18 }, (_, i) => i + 1).map((h) => (
<option key={h} value={h}>
{h}
</option>
))}
</select>
</label>

<label className="label" style={{ flex: 1 }}>
Strokes
<input
className="input"
value={strokes}
onChange={(e) => setStrokes(e.target.value)}
inputMode="numeric"
placeholder="e.g. 5"
/>
</label>

<div style={{ display: "flex", alignItems: "end" }}>
<button className="btnSmall" onClick={saveScore}>
Save
</button>
</div>
</div>

<button
className="btnSmall ghost"
onClick={() => loadScoresForPlayer(selectedPlayerId)}
disabled={loadingPlayerScores}
style={{ marginTop: 10 }}
>
{loadingPlayerScores ? "Refreshing..." : "Refresh Player Scores"}
</button>

<div style={{ marginTop: 16 }}>
<div className="sectionTitle">Scores for {selectedPlayer ? selectedPlayer.name : "—"}</div>

{playerScores.length === 0 ? (
<div className="muted">No scores yet</div>
) : (
<div className="list">
{playerScores.map((s) => (
<div key={`${s.player_id}-${s.hole}`} className="listRow">
<div>Hole {s.hole}</div>
<div className="bold">{s.score}</div>
</div>
))}
</div>
)}
</div>
</div>
</div>
)}

{/* LEADERBOARD */}
{tab === "leaderboard" && (
<div className="screen">
<TopBar title="Leaderboard" onBack={() => setTab("home")} />

<div className="card">
<div className="row" style={{ alignItems: "center", marginBottom: 10 }}>
<button className="btnSmall" onClick={loadLeaderboard} disabled={loadingLeaderboard}>
{loadingLeaderboard ? "Refreshing..." : "Refresh now"}
</button>
<div className="muted" style={{ fontSize: 13 }}>
{leaderboardStatus} • auto refresh 1 min
</div>
</div>

{leaderboardRows.length === 0 ? (
<div className="muted">No data yet</div>
) : (
<div className="list">
{leaderboardRows.map((r, idx) => (
<div key={r.id} className="listRow">
<div className="muted" style={{ width: 42 }}>
#{idx + 1}
</div>
<div style={{ flex: 1 }}>
<div className="bold">{r.name}</div>
<div className="muted" style={{ fontSize: 12 }}>
HCP {r.handicap}
{r.charity ? ` • ${r.charity}` : ""}
</div>
</div>
<div className="bold">{r.total}</div>
</div>
))}
</div>
)}
</div>
</div>
)}

{/* ADMIN */}
{tab === "admin" && (
<div className="screen">
<TopBar title="Admin" onBack={() => setTab("home")} right={adminEnabled ? <button className="btnSmall ghost" onClick={lockAdmin}>Lock</button> : null} />

<div className="card">
{!adminEnabled ? (
<>
<div className="muted" style={{ marginBottom: 10 }}>
Enter admin PIN to unlock Players + Foursomes setup.
</div>

<form onSubmit={unlockAdmin} className="row">
<input
className="input"
value={pin}
onChange={(e) => setPin(e.target.value)}
placeholder="Enter PIN"
inputMode="numeric"
style={{ flex: 1 }}
/>
<button className="btnSmall" type="submit">
Unlock
</button>
</form>

{pinError ? <div style={{ marginTop: 10, color: "#ff8b8b" }}>{pinError}</div> : null}
</>
) : (
<>
<div className="sectionTitle">Players</div>

<form onSubmit={addPlayer} style={{ display: "grid", gap: 10 }}>
<input className="input" value={playerName} onChange={(e) => setPlayerName(e.target.value)} placeholder="Name" />
<input className="input" value={playerHandicap} onChange={(e) => setPlayerHandicap(e.target.value)} placeholder="Handicap (number)" inputMode="numeric" />
<input className="input" value={playerCharity} onChange={(e) => setPlayerCharity(e.target.value)} placeholder="Charity (optional)" />
<button className="btnSmall" type="submit">Add Player</button>
</form>

<button className="btnSmall ghost" onClick={loadPlayers} disabled={loadingPlayers} style={{ marginTop: 10 }}>
{loadingPlayers ? "Refreshing..." : "Refresh Players"}
</button>

<div style={{ marginTop: 12 }}>
{players.length === 0 ? (
<div className="muted">No players yet</div>
) : (
<div className="list">
{players.map((p) => (
<div key={p.id} className="listRow">
<div style={{ flex: 1 }}>
<div className="bold">{p.name}</div>
<div className="muted" style={{ fontSize: 12 }}>
HCP {p.handicap ?? 0}
{p.charity ? ` • ${p.charity}` : ""}
</div>
</div>
<button className="btnSmall danger" onClick={() => deletePlayer(p.id)}>
Delete
</button>
</div>
))}
</div>
)}
</div>

<div style={{ marginTop: 18, paddingTop: 12, borderTop: "1px solid rgba(60,40,20,0.15)" }}>
<div className="sectionTitle">Foursomes</div>
<div className="muted">
We’ll wire foursomes back in here next (admin-only). For now, this page is just the new home look + admin lock.
</div>
</div>
</>
)}
</div>
</div>
)}
</div>
);
}

/* ------------------- Components ------------------- */

function HomeScreen({ connected, onLeaderboard, onScores, onAdmin }) {
return (
<div className="home">
<div className="homeHeader">
<div className="homeIcon" aria-hidden="true">
{/* simple scroll + club icon */}
<svg width="44" height="44" viewBox="0 0 64 64" fill="none">
<rect x="18" y="10" width="28" height="34" rx="4" stroke="currentColor" strokeWidth="3" opacity="0.9" />
<line x1="22" y1="18" x2="42" y2="18" stroke="currentColor" strokeWidth="3" opacity="0.55" />
<line x1="22" y1="26" x2="42" y2="26" stroke="currentColor" strokeWidth="3" opacity="0.55" />
<path d="M40 45 C42 37, 50 32, 55 31" stroke="currentColor" strokeWidth="3" opacity="0.85" />
<path d="M55 31 L58 35 L52 36 Z" fill="currentColor" opacity="0.85" />
</svg>
</div>

<h1 className="homeTitle">The Ginvitational</h1>
<div className="homeSub">Manufacturers Golf &amp; CC</div>
<div className="homeDate">May 2026</div>

<div className="homeStatus">
<span className="homeStatusText">Connected</span>
<span className={`dot ${connected ? "ok" : "bad"}`} />
</div>
</div>

<div className="homeButtons">
<button className="bigBtn" onClick={onLeaderboard}>
<span className="btnIcon">📊</span>
<span>Leaderboard</span>
</button>

{/* IGNORE PLACE BETS FOR NOW (not shown) */}

<button className="bigBtn" onClick={onScores}>
<span className="btnIcon">👥</span>
<span>Enter Scores</span>
</button>

<button className="bigBtn" onClick={onAdmin}>
<span className="btnIcon">⚙️</span>
<span>Admin</span>
</button>
</div>
</div>
);
}

function TopBar({ title, onBack, right = null }) {
return (
<div className="topbar">
<button className="btnSmall ghost" onClick={onBack}>
← Home
</button>
<div className="topTitle">{title}</div>
<div style={{ marginLeft: "auto" }}>{right}</div>
</div>
);
}