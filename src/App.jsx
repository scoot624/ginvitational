import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

/** ✅ Supabase via env vars */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** ⛳ PARS (edit these for your course) */
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
  return { color: "rgba(255,255,255,0.85)" };
}

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function App() {
  const [tab, setTab] = useState("home"); // home | leaderboard | enter | admin

  const [status, setStatus] = useState("Loading...");
  const [players, setPlayers] = useState([]);
  const [scores, setScores] = useState([]);

  // Leaderboard scorecard modal
  const [scorecardPlayerId, setScorecardPlayerId] = useState(null);

  // Admin gate
  const [adminPin, setAdminPin] = useState("");
  const [adminOn, setAdminOn] = useState(false);

  // Admin: add player
  const [newName, setNewName] = useState("");
  const [newHandicap, setNewHandicap] = useState("");
  const [newCharity, setNewCharity] = useState("");

  // Foursomes data (admin + enter scores)
  const [foursomes, setFoursomes] = useState([]);
  const [foursomePlayers, setFoursomePlayers] = useState([]); // rows with foursome_id, player_id

  // Admin: manual foursome
  const [manualGroupName, setManualGroupName] = useState("");
  const [manualCode, setManualCode] = useState("");

  // Admin: assign
  const [assignFoursomeId, setAssignFoursomeId] = useState("");
  const [assignPlayerId, setAssignPlayerId] = useState("");

  // Enter Scores: foursome code gate
  const [entryCode, setEntryCode] = useState("");
  const [activeFoursome, setActiveFoursome] = useState(null); // {id, group_name, code}
  const [activePlayers, setActivePlayers] = useState([]); // players in the foursome

  // Enter Scores: hole-by-hole typing UI
  const [hole, setHole] = useState(1);
  const [holeInputs, setHoleInputs] = useState({}); // {player_id: "4"}

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

  async function loadFoursomes() {
    const { data, error } = await supabase
      .from("foursomes")
      .select("id,group_name,code,created_at")
      .order("created_at", { ascending: true });
    if (error) {
      console.error(error);
      return { ok: false };
    }
    setFoursomes(data || []);
    return { ok: true };
  }

  async function loadFoursomePlayers() {
    const { data, error } = await supabase
      .from("foursome_players")
      .select("id,foursome_id,player_id,created_at")
      .order("created_at", { ascending: true });
    if (error) {
      console.error(error);
      return { ok: false };
    }
    setFoursomePlayers(data || []);
    return { ok: true };
  }

  async function initialLoad() {
    setStatus("Loading...");
    const a = await loadPlayers();
    const b = await loadScores();
    const c = await loadFoursomes();
    const d = await loadFoursomePlayers();
    setStatus(a.ok && b.ok && c.ok && d.ok ? "Connected ✅" : "Connected, but some data failed ❗");
  }

  useEffect(() => {
    initialLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaderboard auto-refresh every minute while on leaderboard tab
  useEffect(() => {
    if (tab !== "leaderboard") return;
    const id = setInterval(async () => {
      await loadPlayers();
      await loadScores();
    }, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const leaderboardRows = useMemo(() => {
    // build last-write-wins map for scores by player/hole
    const scoresByPlayer = new Map();
    for (const s of scores) {
      const pid = s.player_id;
      const h = clampInt(s.hole, 0);
      const sc = clampInt(s.score, 0);
      if (h < 1 || h > 18) continue;
      if (!scoresByPlayer.has(pid)) scoresByPlayer.set(pid, {});
      const blob = scoresByPlayer.get(pid);
      if (!blob.scoresByHole) blob.scoresByHole = {};
      blob.scoresByHole[h] = sc;
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

    // Sort: scored first, then netToPar, then holesPlayed desc, then name
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

  function enterAdmin() {
    if (adminPin === "112020") {
      setAdminOn(true);
      setAdminPin("");
      setTab("admin");
    } else {
      alert("Wrong PIN");
    }
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
    if (!confirm("Delete this player? This will also delete their scores and foursome assignment.")) return;

    // delete scores
    await supabase.from("scores").delete().eq("player_id", id);
    // delete foursome_players
    await supabase.from("foursome_players").delete().eq("player_id", id);
    // delete player
    const { error } = await supabase.from("players").delete().eq("id", id);
    if (error) {
      console.error(error);
      alert("Error deleting player.");
      return;
    }
    await loadPlayers();
    await loadScores();
    await loadFoursomes();
    await loadFoursomePlayers();
  }

  function playersInFoursome(fid) {
    const pids = foursomePlayers.filter((fp) => fp.foursome_id === fid).map((x) => x.player_id);
    return players.filter((p) => pids.includes(p.id));
  }

  async function createManualFoursome() {
    if (!adminOn) return alert("Admin only.");
    const group_name = manualGroupName.trim() || "Group";
    const code = (manualCode.trim() || makeCode()).toUpperCase();

    if (code.length !== 6) return alert("Code must be exactly 6 characters.");

    const { error } = await supabase.from("foursomes").insert({ group_name, code });
    if (error) {
      console.error(error);
      alert("Error creating foursome (code may already exist).");
      return;
    }
    setManualGroupName("");
    setManualCode("");
    await loadFoursomes();
  }

  async function assignPlayerToFoursome() {
    if (!adminOn) return alert("Admin only.");
    if (!assignFoursomeId) return alert("Pick a foursome.");
    if (!assignPlayerId) return alert("Pick a player.");

    const { error } = await supabase.from("foursome_players").insert({
      foursome_id: assignFoursomeId,
      player_id: assignPlayerId,
    });

    if (error) {
      console.error(error);
      alert("Error assigning player (maybe already assigned?).");
      return;
    }

    setAssignPlayerId("");
    await loadFoursomePlayers();
  }

  async function removePlayerFromFoursome(fpRowId) {
    if (!adminOn) return alert("Admin only.");
    const { error } = await supabase.from("foursome_players").delete().eq("id", fpRowId);
    if (error) {
      console.error(error);
      alert("Error removing player.");
      return;
    }
    await loadFoursomePlayers();
  }

  async function clearFoursomes() {
    if (!adminOn) return alert("Admin only.");
    if (!confirm("Clear all foursomes + assignments? (Does not delete players or scores)")) return;

    await supabase.from("foursome_players").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("foursomes").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    await loadFoursomes();
    await loadFoursomePlayers();
  }

  async function generateRandomFoursomes() {
    if (!adminOn) return alert("Admin only.");
    if (players.length < 2) return alert("Need at least 2 players.");

    // wipe old foursomes
    await supabase.from("foursome_players").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("foursomes").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    const shuffled = shuffle(players);
    const groups = [];
    for (let i = 0; i < shuffled.length; i += 4) {
      groups.push(shuffled.slice(i, i + 4));
    }

    // create foursomes and assignments
    for (let i = 0; i < groups.length; i++) {
      const groupPlayers = groups[i];
      const group_name = `Group ${i + 1}`;
      const code = makeCode();

      const { data: fData, error: fErr } = await supabase
        .from("foursomes")
        .insert({ group_name, code })
        .select("id")
        .single();

      if (fErr) {
        console.error(fErr);
        alert("Error creating foursomes (check RLS/policies).");
        return;
      }

      const fid = fData.id;
      const inserts = groupPlayers.map((p) => ({ foursome_id: fid, player_id: p.id }));
      const { error: fpErr } = await supabase.from("foursome_players").insert(inserts);

      if (fpErr) {
        console.error(fpErr);
        alert("Error assigning players (check RLS/policies).");
        return;
      }
    }

    await loadFoursomes();
    await loadFoursomePlayers();
    alert("Foursomes generated ✅");
  }

  async function enterWithCode() {
    const code = entryCode.trim().toUpperCase();
    if (code.length !== 6) return alert("Enter a 6-character code.");

    const { data: f, error } = await supabase
      .from("foursomes")
      .select("id,group_name,code")
      .eq("code", code)
      .maybeSingle();

    if (error) {
      console.error(error);
      alert("Error checking code.");
      return;
    }
    if (!f) {
      alert("Code not found.");
      return;
    }

    const memberRows = foursomePlayers.filter((fp) => fp.foursome_id === f.id);
    const memberIds = memberRows.map((x) => x.player_id);
    const memberPlayers = players.filter((p) => memberIds.includes(p.id));

    if (memberPlayers.length === 0) {
      alert("This foursome has no players assigned yet.");
      return;
    }

    setActiveFoursome(f);
    setActivePlayers(memberPlayers);
    setHole(1);
    setHoleInputs({});
    setTab("enter");
  }

  function getExistingScore(pid, holeNum) {
    // last-write-wins is already in scores state, but easiest: find newest matching row
    const row = scores.find((s) => s.player_id === pid && clampInt(s.hole, 0) === holeNum);
    return row ? clampInt(row.score, 0) : null;
  }

  // When active foursome / hole changes, prefill inputs from existing scores
  useEffect(() => {
    if (!activeFoursome) return;
    const obj = {};
    for (const p of activePlayers) {
      const existing = getExistingScore(p.id, hole);
      obj[p.id] = existing != null ? String(existing) : "";
    }
    setHoleInputs(obj);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFoursome?.id, hole]);

  async function saveHoleThenNavigate(nextHole) {
    if (!activeFoursome) return;
    // validate + upsert each player's score for current hole
    for (const p of activePlayers) {
      const raw = (holeInputs[p.id] ?? "").trim();
      if (!raw) continue; // allow blanks
      const sc = clampInt(raw, 0);
      if (sc < 1 || sc > 20) {
        alert(`Score for ${p.name} looks wrong (1–20).`);
        return;
      }

      const { error } = await supabase
        .from("scores")
        .upsert(
          { player_id: p.id, hole, score: sc },
          { onConflict: "player_id,hole" }
        );

      if (error) {
        console.error(error);
        alert("Error saving scores. (Check scores RLS + unique constraint player_id,hole.)");
        return;
      }
    }

    await loadScores();
    setHole(nextHole);
  }

  return (
    <div style={styles.page}>
      {/* Scorecard modal (leaderboard) */}
      {scorecardPlayer && (
        <div style={styles.modalOverlay} onClick={() => setScorecardPlayerId(null)}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div style={{ minWidth: 0 }}>
                <div style={styles.modalTitle}>
                  {scorecardPlayer.name} <span style={{ opacity: 0.7 }}>(HCP {scorecardPlayer.handicap})</span>
                </div>
                <div style={styles.modalSub}>
                  Holes: {scorecardPlayer.holesPlayed} • Net vs Par:{" "}
                  {scorecardPlayer.holesPlayed === 0 ? (
                    <span style={{ opacity: 0.7 }}>—</span>
                  ) : (
                    <span style={{ fontWeight: 900, ...netColorStyle(scorecardPlayer.netToPar) }}>
                      {formatToPar(scorecardPlayer.netToPar)}
                    </span>
                  )}
                </div>
              </div>
              <button style={styles.smallBtn} onClick={() => setScorecardPlayerId(null)}>
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
                  {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => {
                    const par = PARS[h - 1];
                    const sc = scorecardPlayer.scoresByHole[h];
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
      )}

      <div style={styles.shell}>
        {/* HOME (no top nav) */}
        {tab === "home" && (
  <div style={styles.homeWrap}>
    <div style={styles.holder}>
      <div style={styles.holderTop}>
        <img
          src="/logo.png"
          alt="Ginvitational logo"
          style={styles.homeLogo}
        />
      </div>

      <div style={styles.holderInner}>
        <button style={styles.leatherBtn} onClick={() => setTab("leaderboard")}>
          Leaderboard
        </button>

        <button style={styles.leatherBtn} onClick={() => setTab("scores")}>
          Enter Scores
        </button>

        <button style={styles.leatherBtn} onClick={() => setTab("admin")}>
          Admin
        </button>
      </div>

      <div style={styles.holderBottom}>GINVITATIONAL</div>
    </div>
  </div>
)}


        {/* CODE GATE SCREEN (enter scores) */}
        {tab === "code" && (
          <div style={styles.card}>
            <div style={styles.headerRow}>
              <button style={styles.smallBtn} onClick={() => setTab("home")}>
                ← Home
              </button>
              <div style={{ fontSize: 12, opacity: 0.85 }}>{status}</div>
            </div>

            <div style={{ marginTop: 12, fontSize: 22, fontWeight: 950 }}>Enter Scores</div>
            <div style={styles.helpText}>
              Enter your <b>6-character foursome code</b> to score your group.
            </div>

            <div style={{ marginTop: 14, display: "grid", gap: 10, maxWidth: 520 }}>
              <input
                style={styles.input}
                value={entryCode}
                onChange={(e) => setEntryCode(e.target.value.toUpperCase())}
                placeholder="Enter 6-letter code (ex: A1B2C3)"
                maxLength={6}
                autoCapitalize="characters"
              />
              <button style={styles.bigBtn} onClick={enterWithCode}>
                ✅ Continue
              </button>

              <div style={{ fontSize: 12, opacity: 0.8 }}>
                You can only enter scores for your foursome code.
              </div>
            </div>
          </div>
        )}

        {/* TOP NAV (all non-home pages) */}
        {tab !== "home" && tab !== "code" && (
          {tab !== "home" && (
  <header style={styles.header}>
    <div style={styles.headerTop}>
      <div style={styles.brand}>
        <div style={styles.brandTitle}>Ginvitational</div>
        <div style={styles.brandSub}>{status}</div>
      </div>

      <nav style={styles.nav}>
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
        <button
          style={styles.navBtn}
          onClick={() => setTab("home")}
        >
          Home
        </button>
      </nav>
    </div>
  </header>
)}


        {/* LEADERBOARD */}
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
              Tap a player name to view their scorecard. Auto-refreshes every minute.
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
                        : { fontWeight: 950, ...netColorStyle(r.netToPar) };

                    return (
                      <tr key={r.id}>
                        <td style={styles.td}>{idx + 1}</td>

                        <td style={{ ...styles.td, minWidth: 180 }}>
                          <button style={styles.playerLink} onClick={() => setScorecardPlayerId(r.id)}>
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

        {/* ENTER SCORES (foursome hole-by-hole) */}
        {tab === "enter" && (
          <div style={styles.card}>
            <div style={styles.cardHeaderRow}>
              <div>
                <div style={styles.cardTitle}>Enter Scores</div>
                <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
                  Foursome: <b>{activeFoursome?.group_name}</b> • Code: <b>{activeFoursome?.code}</b>
                </div>
              </div>
              <button
                style={styles.smallBtn}
                onClick={() => {
                  setActiveFoursome(null);
                  setActivePlayers([]);
                  setEntryCode("");
                  setTab("code");
                }}
              >
                Change Code
              </button>
            </div>

            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              <div style={{ fontSize: 18, fontWeight: 950 }}>
                Hole {hole} <span style={{ opacity: 0.7 }}>(Par {PARS[hole - 1]})</span>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                {activePlayers.map((p) => (
                  <div key={p.id} style={styles.scoreRow}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {p.name}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>HCP {clampInt(p.handicap, 0)}</div>
                    </div>

                    <input
                      style={{ ...styles.input, width: 92, textAlign: "center", fontSize: 16, fontWeight: 900 }}
                      inputMode="numeric"
                      placeholder="—"
                      value={holeInputs[p.id] ?? ""}
                      onChange={(e) =>
                        setHoleInputs((prev) => ({ ...prev, [p.id]: e.target.value }))
                      }
                    />
                  </div>
                ))}
              </div>

              <div style={styles.navRow}>
                <button
                  style={styles.smallBtn}
                  disabled={hole === 1}
                  onClick={() => saveHoleThenNavigate(hole - 1)}
                >
                  ← Last Hole
                </button>

                <button
                  style={styles.bigBtn}
                  onClick={() => saveHoleThenNavigate(Math.min(18, hole + 1))}
                >
                  Save & Next →
                </button>
              </div>

              <div style={styles.helpText}>
                Type scores for your foursome, then hit <b>Save & Next</b>. You can go back with <b>Last Hole</b>.
                Leaving a box blank means “no score yet” for that hole.
              </div>
            </div>
          </div>
        )}

        {/* ADMIN */}
        {tab === "admin" && (
          <div style={styles.card}>
            <div style={styles.cardTitle}>Admin</div>

            {!adminOn ? (
              <div style={{ marginTop: 12, display: "grid", gap: 10, maxWidth: 420 }}>
                <label style={styles.label}>
                  Enter Admin PIN
                  <input
                    style={styles.input}
                    type="password"
                    value={adminPin}
                    onChange={(e) => setAdminPin(e.target.value)}
                    inputMode="numeric"
                    placeholder="••••••"
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

                  <button style={styles.dangerBtn} onClick={clearFoursomes}>
                    Clear Foursomes
                  </button>
                </div>

                <div style={styles.adminGrid}>
                  {/* Foursomes */}
                  <div style={styles.subCard}>
                    <div style={styles.subTitle}>Foursomes</div>

                    <div style={{ display: "grid", gap: 10 }}>
                      <button style={styles.bigBtn} onClick={generateRandomFoursomes}>
                        🧩 Generate Foursomes (Random)
                      </button>

                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ fontWeight: 900, opacity: 0.9 }}>Manual create</div>
                        <input
                          style={styles.input}
                          placeholder='Group name (ex: "Group A")'
                          value={manualGroupName}
                          onChange={(e) => setManualGroupName(e.target.value)}
                        />
                        <input
                          style={styles.input}
                          placeholder="Code (6 chars) — leave blank to auto-generate"
                          value={manualCode}
                          onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                          maxLength={6}
                        />
                        <button style={styles.smallBtn} onClick={createManualFoursome}>
                          Create Foursome
                        </button>
                      </div>

                      <div style={{ height: 1, background: "rgba(255,255,255,0.10)", margin: "6px 0" }} />

                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ fontWeight: 900, opacity: 0.9 }}>Assign player to foursome</div>

                        <select
                          style={styles.input}
                          value={assignFoursomeId}
                          onChange={(e) => setAssignFoursomeId(e.target.value)}
                        >
                          <option value="">Select foursome…</option>
                          {foursomes.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.group_name} — {f.code}
                            </option>
                          ))}
                        </select>

                        <select
                          style={styles.input}
                          value={assignPlayerId}
                          onChange={(e) => setAssignPlayerId(e.target.value)}
                        >
                          <option value="">Select player…</option>
                          {players.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} (HCP {clampInt(p.handicap, 0)})
                            </option>
                          ))}
                        </select>

                        <button style={styles.smallBtn} onClick={assignPlayerToFoursome}>
                          Add Player to Foursome
                        </button>
                      </div>

                      <div style={{ height: 1, background: "rgba(255,255,255,0.10)", margin: "6px 0" }} />

                      <div style={{ fontWeight: 950 }}>View codes + members</div>
                      <div style={{ display: "grid", gap: 10 }}>
                        {foursomes.map((f) => {
                          const members = playersInFoursome(f.id);
                          const memberRows = foursomePlayers.filter((fp) => fp.foursome_id === f.id);
                          return (
                            <div key={f.id} style={styles.foursomeCard}>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontWeight: 950 }}>
                                    {f.group_name}{" "}
                                    <span style={{ opacity: 0.75, fontWeight: 800 }}>
                                      (Code: {f.code})
                                    </span>
                                  </div>
                                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                                    Members: {members.length}
                                  </div>
                                </div>
                              </div>

                              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                                {memberRows.map((fp) => {
                                  const p = players.find((x) => x.id === fp.player_id);
                                  return (
                                    <div key={fp.id} style={styles.playerRow}>
                                      <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 950 }}>
                                          {p ? p.name : fp.player_id}
                                        </div>
                                        {p && (
                                          <div style={styles.playerMeta}>
                                            HCP {clampInt(p.handicap, 0)}
                                            {p.charity ? ` • ${p.charity}` : ""}
                                          </div>
                                        )}
                                      </div>
                                      <button
                                        style={styles.dangerBtn}
                                        onClick={() => removePlayerFromFoursome(fp.id)}
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  );
                                })}
                                {memberRows.length === 0 && (
                                  <div style={styles.helpText}>No players assigned.</div>
                                )}
                              </div>
                            </div>
                          );
                        })}

                        {foursomes.length === 0 && <div style={styles.helpText}>No foursomes yet.</div>}
                      </div>
                    </div>
                  </div>

                  {/* Players */}
                  <div style={styles.subCard}>
                    <div style={styles.subTitle}>Players</div>

                    <div style={{ display: "grid", gap: 10 }}>
                      <div style={{ fontWeight: 950 }}>Add Player</div>
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

                    <div style={{ height: 1, background: "rgba(255,255,255,0.10)", margin: "12px 0" }} />

                    <div style={{ fontWeight: 950 }}>Player List</div>
                    <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                      {players.map((p) => (
                        <div key={p.id} style={styles.playerRow}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis" }}>
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

        {/* Router: if code validated, jump to enter */}
        {tab === "enter" && !activeFoursome && (
          <div style={styles.card}>
            <div style={styles.cardTitle}>Enter Scores</div>
            <div style={styles.helpText}>No foursome loaded. Go back and enter your code.</div>
            <button style={styles.smallBtn} onClick={() => setTab("code")}>
              Back to Code
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Styles: phone-first */
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
    display: "grid",
    gap: 12,
  },

  header: { marginBottom: 6 },
  headerTop: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  },
  brand: { minWidth: 240 },
  brandTitle: {
    fontSize: 34,
    fontWeight: 950,
    letterSpacing: -0.6,
    lineHeight: 1.05,
  },
  brandSub: { marginTop: 6, opacity: 0.85, fontSize: 13 },
  nav: { display: "flex", gap: 10, flexWrap: "wrap" },
  navBtn: {
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.18)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 800,
  },
  navBtnActive: {
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(255,255,255,0.18)",
    border: "1px solid rgba(255,255,255,0.30)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 950,
  },

  homeCard: {
    background: "rgba(0,0,0,0.28)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 20,
    padding: 18,
    backdropFilter: "blur(12px)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
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
  cardTitle: { fontSize: 22, fontWeight: 950, letterSpacing: -0.2 },
  helpText: { marginTop: 10, fontSize: 12, opacity: 0.8, lineHeight: 1.35 },

  bigBtn: {
    padding: "14px 14px",
    borderRadius: 16,
    background: "rgba(255,255,255,0.12)",
    border: "1px solid rgba(255,255,255,0.22)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 950,
    fontSize: 16,
  },
  smallBtn: {
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.18)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 900,
  },
  dangerBtn: {
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(220,38,38,0.18)",
    border: "1px solid rgba(220,38,38,0.35)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 950,
  },

  label: { display: "grid", gap: 6, fontSize: 12, opacity: 0.9 },
  input: {
    background: "rgba(0,0,0,0.35)",
    border: "1px solid rgba(255,255,255,0.18)",
    color: "#fff",
    padding: "12px 12px",
    borderRadius: 12,
    outline: "none",
    fontSize: 14,
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
    fontWeight: 950,
    padding: 0,
    fontSize: 15,
    textAlign: "left",
  },
  playerMeta: { marginTop: 4, fontSize: 12, opacity: 0.75, whiteSpace: "normal" },
  pill: {
    display: "inline-block",
    minWidth: 28,
    padding: "4px 10px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.18)",
    fontWeight: 950,
    fontSize: 12,
  },

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
  subTitle: { fontWeight: 950, marginBottom: 10, fontSize: 16 },

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

  foursomeCard: {
    padding: 12,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.18)",
  },

  scoreRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: "10px 10px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(0,0,0,0.18)",
  },
  navRow: {
    marginTop: 10,
    display: "grid",
    gap: 10,
    gridTemplateColumns: "1fr 1fr",
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
  modalTitle: { fontSize: 18, fontWeight: 950, lineHeight: 1.1 },
  modalSub: { marginTop: 6, fontSize: 13, opacity: 0.85 },
  homeWrap: {
  minHeight: "calc(100vh - 28px)",
  display: "grid",
  placeItems: "center",
  padding: 10,
},

holder: {
  width: "min(420px, 92vw)",
  borderRadius: 26,
  padding: 18,
  background:
    "linear-gradient(180deg, rgba(120,72,38,0.95) 0%, rgba(75,40,18,0.98) 55%, rgba(55,28,12,0.98) 100%)",
  border: "1px solid rgba(0,0,0,0.35)",
  boxShadow:
    "0 24px 60px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.12)",
  position: "relative",
},

holderTop: {
  display: "grid",
  placeItems: "center",
  paddingTop: 6,
  paddingBottom: 14,
},

homeLogo: {
  width: 210,        // ~300% bigger than 74
  height: 210,
  objectFit: "contain",
  filter: "drop-shadow(0 10px 20px rgba(0,0,0,0.45))",
},

holderInner: {
  background:
    "linear-gradient(180deg, rgba(244,232,210,0.92) 0%, rgba(230,212,185,0.92) 100%)",
  borderRadius: 18,
  padding: 16,
  border: "1px solid rgba(0,0,0,0.18)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.35)",
  display: "grid",
  gap: 14,
},

leatherBtn: {
  width: "100%",
  padding: "16px 16px",
  borderRadius: 14,
  background:
    "linear-gradient(180deg, rgba(125,72,36,0.98) 0%, rgba(88,48,22,0.98) 100%)",
  border: "1px solid rgba(0,0,0,0.35)",
  color: "rgba(255,240,210,0.95)",
  fontWeight: 900,
  fontSize: 18,
  letterSpacing: 0.2,
  cursor: "pointer",
  boxShadow:
    "0 10px 22px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.10)",
},

holderBottom: {
  marginTop: 14,
  textAlign: "center",
  fontWeight: 900,
  letterSpacing: 2,
  color: "rgba(255,224,170,0.85)",
  textShadow: "0 2px 10px rgba(0,0,0,0.45)",
},
};

// Wider screens
const media = typeof window !== "undefined" ? window.matchMedia("(min-width: 820px)") : null;
if (media && media.matches) {
  styles.adminGrid.gridTemplateColumns = "1fr 1fr";
}
