import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

/** ✅ Supabase via env vars */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * ⛳ PARS (set these to match your course)
 * index 0 = hole 1 par ... index 17 = hole 18 par
 */
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
  return `${n}`; // negative already has -
}

function netColorStyle(netToPar) {
  if (netToPar < 0) return { color: "#16a34a" }; // green
  if (netToPar > 0) return { color: "#dc2626" }; // red
  return { color: "rgba(255,255,255,0.78)" }; // neutral
}

/** Modal: player scorecard (tap player on leaderboard) */
function ScorecardModal({ open, onClose, player, pars }) {
  if (!open || !player) return null;

  const holes = Array.from({ length: 18 }, (_, i) => i + 1);
  const playedHoles = holes.filter((h) => player.scoresByHole[h] != null);

  const gross = playedHoles.reduce((acc, h) => acc + player.scoresByHole[h], 0);
  const parPlayed = playedHoles.reduce((acc, h) => acc + pars[h - 1], 0);

  const handicap = clampInt(player.handicap, 0);
  const proratedHandicap = (handicap * playedHoles.length) / 18;
  const netGross = gross - proratedHandicap;
  const netToPar = Math.round(netGross - parPlayed);

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <div style={{ minWidth: 0 }}>
            <div style={styles.modalTitle}>
              {player.name}{" "}
              <span style={{ opacity: 0.7 }}>(HCP {handicap})</span>
            </div>
            <div style={styles.modalSub}>
              Holes: {playedHoles.length} • Net vs Par:{" "}
              <span style={{ fontWeight: 900, ...netColorStyle(netToPar) }}>
                {formatToPar(netToPar)}
              </span>
            </div>
          </div>
          <button style={styles.smallBtn} onClick={onClose}>
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
              {holes.map((h) => {
                const par = pars[h - 1];
                const sc = player.scoresByHole[h];
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
          Net is computed as gross minus <b>pro-rated handicap</b> for holes played.
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("home"); // home | leaderboard | scores | admin
  const [status, setStatus] = useState("Connecting...");

  const [players, setPlayers] = useState([]);
  const [scores, setScores] = useState([]);

  // Admin
  const [adminPin, setAdminPin] = useState("");
  const [adminOn, setAdminOn] = useState(false);
  const [newName, setNewName] = useState("");
  const [newHandicap, setNewHandicap] = useState("");
  const [newCharity, setNewCharity] = useState("");

  // Scorecard modal
  const [scorecardPlayerId, setScorecardPlayerId] = useState(null);

  // ✅ Enter Scores UX (foursome-code gated)
  const [foursomeCode, setFoursomeCode] = useState("");
  const [activeFoursome, setActiveFoursome] = useState(null); // { id, code, group_name }
  const [foursomePlayers, setFoursomePlayers] = useState([]); // [{id,name,handicap,charity,slot}]
  const [holeIndex, setHoleIndex] = useState(1); // 1-18
  const [holeInputs, setHoleInputs] = useState({}); // { [playerId]: "4" }
  const [savingHole, setSavingHole] = useState(false);

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

  async function initialLoad() {
    setStatus("Loading...");
    const a = await loadPlayers();
    const b = await loadScores();
    setStatus(a.ok && b.ok ? "Connected ✅" : "Connected, but some data failed ❗");
  }

  useEffect(() => {
    initialLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ auto-refresh leaderboard every minute (only while on leaderboard tab)
  useEffect(() => {
    if (tab !== "leaderboard") return;

    const id = setInterval(() => {
      loadPlayers();
      loadScores();
    }, 60_000);

    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  /** Build leaderboard rows */
  const leaderboardRows = useMemo(() => {
    // build player -> scoresByHole (last write wins)
    const scoresByPlayer = new Map();

    for (const s of scores) {
      const pid = s.player_id;
      const h = clampInt(s.hole, 0);
      const sc = clampInt(s.score, 0);
      if (h < 1 || h > 18) continue;

      if (!scoresByPlayer.has(pid)) scoresByPlayer.set(pid, {});
      const obj = scoresByPlayer.get(pid);
      if (!obj.scoresByHole) obj.scoresByHole = {};
      obj.scoresByHole[h] = sc;
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

    // Sort: players w/ scores first, then netToPar, tie-breaker holesPlayed (more), then name
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

  /** Admin login */
  function enterAdmin() {
    if (adminPin === "112020") {
      setAdminOn(true);
      setAdminPin("");
      setTab("admin");
    } else {
      alert("Wrong PIN");
    }
  }

  /** Admin: add player */
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
    if (!confirm("Delete this player?")) return;

    await supabase.from("scores").delete().eq("player_id", id);
    const { error } = await supabase.from("players").delete().eq("id", id);
    if (error) {
      console.error(error);
      alert("Error deleting player.");
      return;
    }
    await loadPlayers();
    await loadScores();
  }

  /** -------------------------------------------
   * ✅ Enter Scores (Foursome code gated)
   * ------------------------------------------*/
  const scoresMap = useMemo(() => {
    // last-write-wins map: `${pid}-${hole}` => score
    const map = new Map();
    for (const s of scores) {
      const pid = s.player_id;
      const h = clampInt(s.hole, 0);
      const sc = clampInt(s.score, 0);
      if (!pid || h < 1 || h > 18) continue;
      map.set(`${pid}-${h}`, sc);
    }
    return map;
  }, [scores]);

  function hydrateHoleInputs(h) {
    const next = {};
    for (const p of foursomePlayers) {
      const key = `${p.id}-${h}`;
      const val = scoresMap.get(key);
      next[p.id] = val != null ? String(val) : "";
    }
    setHoleInputs(next);
  }

  // When foursomePlayers change or hole changes, prefill inputs
  useEffect(() => {
    if (tab !== "scores") return;
    if (!activeFoursome) return;
    if (foursomePlayers.length === 0) return;
    hydrateHoleInputs(holeIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, activeFoursome, foursomePlayers, holeIndex, scoresMap]);

  async function connectFoursomeByCode() {
    const code = foursomeCode.trim().toUpperCase();
    if (!code) return alert("Enter your group code.");

    // 1) fetch foursome
    const { data: f, error: fErr } = await supabase
      .from("foursomes")
      .select("id,code,group_name")
      .eq("code", code)
      .maybeSingle();

    if (fErr) {
      console.error(fErr);
      alert("Could not look up that code.");
      return;
    }
    if (!f) {
      alert("Invalid code.");
      return;
    }

    // 2) fetch foursome_players joined to players
    const { data: fp, error: fpErr } = await supabase
      .from("foursome_players")
      .select("slot, player_id, players:player_id(id,name,handicap,charity)")
      .eq("foursome_id", f.id)
      .order("slot", { ascending: true });

    if (fpErr) {
      console.error(fpErr);
      alert("Found the foursome, but could not load its players.");
      return;
    }

    const normalized = (fp || [])
      .filter((row) => row.players)
      .map((row) => ({
        id: row.players.id,
        name: row.players.name,
        handicap: row.players.handicap,
        charity: row.players.charity,
        slot: row.slot,
      }));

    if (normalized.length === 0) {
      alert("This foursome has no players assigned yet.");
      return;
    }

    setActiveFoursome({ id: f.id, code: f.code, groupName: f.group_name || "Your Group" });
    setFoursomePlayers(normalized);
    setHoleIndex(1);
    setFoursomeCode("");
    await loadScores(); // ensure freshest scores
  }

  function setInputScore(pid, val) {
    const cleaned = String(val).replace(/[^0-9]/g, "");
    // Allow empty while typing; final validation happens on Next/Last
    if (cleaned.length > 2) return;
    setHoleInputs((prev) => ({ ...prev, [pid]: cleaned }));
  }

  function validateAllFilled() {
    // Requirement: must fill every player before Next/Last
    for (const p of foursomePlayers) {
      const raw = holeInputs[p.id];
      const n = clampInt(raw, 0);
      if (!raw || n < 1 || n > 20) {
        return {
          ok: false,
          message: `Enter a valid score (1–20) for ${p.name} on Hole ${holeIndex}.`,
        };
      }
    }
    return { ok: true };
  }

  async function saveCurrentHole() {
    const check = validateAllFilled();
    if (!check.ok) {
      alert(check.message);
      return false;
    }

    setSavingHole(true);
    try {
      const payload = foursomePlayers.map((p) => ({
        player_id: p.id,
        hole: holeIndex,
        score: clampInt(holeInputs[p.id], 0),
      }));

      const { error } = await supabase
        .from("scores")
        .upsert(payload, { onConflict: "player_id,hole" });

      if (error) {
        console.error(error);
        alert(
          "Error saving scores. (If upsert fails, you may need a UNIQUE constraint on scores(player_id, hole).)"
        );
        return false;
      }

      await loadScores();
      return true;
    } finally {
      setSavingHole(false);
    }
  }

  async function goNextHole() {
    const ok = await saveCurrentHole();
    if (!ok) return;
    setHoleIndex((h) => Math.min(18, h + 1));
  }

  async function goPrevHole() {
    const ok = await saveCurrentHole();
    if (!ok) return;
    setHoleIndex((h) => Math.max(1, h - 1));
  }

  function exitFoursomeScoring() {
    setActiveFoursome(null);
    setFoursomePlayers([]);
    setHoleIndex(1);
    setHoleInputs({});
  }

  /** -------------------------------------------
   * Render
   * ------------------------------------------*/
  const showHeaderNav = tab !== "home";

  return (
    <div style={styles.page}>
      <ScorecardModal
        open={!!scorecardPlayerId}
        onClose={() => setScorecardPlayerId(null)}
        player={scorecardPlayer}
        pars={PARS}
      />

      <div style={styles.shell}>
        {showHeaderNav && (
          <header style={styles.header}>
            <div style={styles.headerTop}>
              <div style={styles.brand}>
                <div style={styles.brandTitleSmall}>Ginvitational</div>
                <div style={styles.brandSubSmall}>{status}</div>
              </div>

              <nav style={styles.nav}>
                <button
                  style={tab === "home" ? styles.navBtnActive : styles.navBtn}
                  onClick={() => setTab("home")}
                >
                  Home
                </button>
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
              </nav>
            </div>
          </header>
        )}

        <main style={styles.content}>
          {/* HOME */}
          {tab === "home" && (
            <div style={styles.card}>
              <div style={{ textAlign: "center" }}>
                <img
                  src="/logo.png"
                  alt="Ginvitational logo"
                  style={{ width: 222, height: 222, objectFit: "contain" }} // ✅ 300% bigger than 74
                />
                <div style={{ marginTop: 12, fontSize: 32, fontWeight: 900 }}>
                  The Ginvitational
                </div>
                <div style={{ marginTop: 8, opacity: 0.82, fontSize: 14 }}>
                  Manufacturers Golf & CC • May 2026
                </div>
              </div>

              <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
                <button style={styles.bigBtn} onClick={() => setTab("leaderboard")}>
                  📊 Leaderboard
                </button>
                <button style={styles.bigBtn} onClick={() => setTab("scores")}>
                  📝 Enter Scores
                </button>
                <button style={styles.bigBtn} onClick={() => setTab("admin")}>
                  ⚙️ Admin
                </button>
              </div>
            </div>
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
                Tap a player name to view their scorecard. Leaderboard auto-refreshes every minute.
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
                          : { fontWeight: 900, ...netColorStyle(r.netToPar) };

                      return (
                        <tr key={r.id}>
                          <td style={styles.td}>{idx + 1}</td>

                          <td style={{ ...styles.td, minWidth: 180 }}>
                            <button
                              style={styles.playerLink}
                              onClick={() => setScorecardPlayerId(r.id)}
                            >
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

          {/* ENTER SCORES (NEW UX) */}
          {tab === "scores" && (
            <div style={styles.card}>
              <div style={styles.cardHeaderRow}>
                <div style={styles.cardTitle}>Enter Scores</div>
                {activeFoursome && (
                  <button style={styles.smallBtn} onClick={exitFoursomeScoring}>
                    Change Code
                  </button>
                )}
              </div>

              {!activeFoursome ? (
                <div style={{ marginTop: 12, display: "grid", gap: 10, maxWidth: 420 }}>
                  <div style={styles.helpText}>
                    Enter your <b>group code</b> to load your foursome.
                  </div>

                  <label style={styles.label}>
                    Group Code
                    <input
                      style={styles.input}
                      value={foursomeCode}
                      onChange={(e) => setFoursomeCode(e.target.value.toUpperCase())}
                      placeholder="ABC123"
                      autoCapitalize="characters"
                    />
                  </label>

                  <button style={styles.bigBtn} onClick={connectFoursomeByCode}>
                    Load Foursome
                  </button>

                  <div style={styles.helpText}>
                    If your code is valid but players don’t load, it usually means the foursome hasn’t been assigned
                    players yet.
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ marginTop: 10, ...styles.helpText }}>
                    <b>{activeFoursome.groupName}</b> • Code: <b>{activeFoursome.code}</b>
                  </div>

                  <div style={styles.holeHeader}>
                    <div>
                      <div style={styles.holeTitle}>
                        Hole {holeIndex} <span style={{ opacity: 0.75 }}>• Par {PARS[holeIndex - 1]}</span>
                      </div>
                      <div style={styles.holeSub}>
                        Enter everyone’s score, then use Next/Last. It saves automatically.
                      </div>
                    </div>

                    <div style={styles.holeNav}>
                      <button
                        style={styles.smallBtn}
                        onClick={goPrevHole}
                        disabled={savingHole || holeIndex === 1}
                      >
                        ◀ Last Hole
                      </button>
                      <button
                        style={styles.smallBtn}
                        onClick={goNextHole}
                        disabled={savingHole || holeIndex === 18}
                      >
                        Next Hole ▶
                      </button>
                    </div>
                  </div>

                  <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                    {foursomePlayers.map((p) => (
                      <div key={p.id} style={styles.scoreRow}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 900, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis" }}>
                            {p.name}
                          </div>
                          <div style={styles.playerMeta}>
                            HCP {clampInt(p.handicap, 0)}
                            {p.charity ? ` • ${p.charity}` : ""}
                          </div>
                        </div>

                        <input
                          style={styles.scoreInput}
                          value={holeInputs[p.id] ?? ""}
                          onChange={(e) => setInputScore(p.id, e.target.value)}
                          inputMode="numeric"
                          placeholder="4"
                        />
                      </div>
                    ))}
                  </div>

                  <div style={styles.helpText}>
                    <b>Required:</b> you must enter a score for every player before moving holes.
                    <br />
                    Tip: to edit, go back to the hole, change the number, then hit Next/Last again.
                  </div>

                  {savingHole && (
                    <div style={{ marginTop: 10, fontSize: 13, opacity: 0.9 }}>
                      Saving…
                    </div>
                  )}
                </>
              )}
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
                      value={adminPin}
                      onChange={(e) => setAdminPin(e.target.value)}
                      inputMode="numeric"
                      placeholder="112020"
                    />
                  </label>

                  <button style={styles.bigBtn} onClick={enterAdmin}>
                    Unlock Admin
                  </button>

                  <div style={styles.helpText}>
                    This is a simple front-end PIN gate. We can harden security later.
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
                  </div>

                  <div style={styles.adminGrid}>
                    <div style={styles.subCard}>
                      <div style={styles.subTitle}>Add Player</div>

                      <div style={{ display: "grid", gap: 10 }}>
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
                    </div>

                    <div style={styles.subCard}>
                      <div style={styles.subTitle}>Players</div>

                      <div style={{ display: "grid", gap: 8 }}>
                        {players.map((p) => (
                          <div key={p.id} style={styles.playerRow}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis" }}>
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
        </main>
      </div>
    </div>
  );
}

/** Inline styles: phone-first and clean */
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
  },

  header: { marginBottom: 12 },
  headerTop: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  brand: { minWidth: 220 },
  brandTitleSmall: { fontSize: 20, fontWeight: 900, letterSpacing: -0.2 },
  brandSubSmall: { marginTop: 4, opacity: 0.8, fontSize: 12 },

  nav: { display: "flex", gap: 10, flexWrap: "wrap" },
  navBtn: {
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.18)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 700,
  },
  navBtnActive: {
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(255,255,255,0.18)",
    border: "1px solid rgba(255,255,255,0.3)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 900,
  },

  content: { display: "grid", gap: 12 },

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
  cardTitle: { fontSize: 22, fontWeight: 900, letterSpacing: -0.2 },

  helpText: {
    marginTop: 10,
    fontSize: 12,
    opacity: 0.8,
    lineHeight: 1.35,
  },

  bigBtn: {
    padding: "14px 14px",
    borderRadius: 16,
    background: "rgba(255,255,255,0.12)",
    border: "1px solid rgba(255,255,255,0.22)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 900,
    fontSize: 16,
  },
  smallBtn: {
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.18)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 800,
  },
  dangerBtn: {
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(220,38,38,0.18)",
    border: "1px solid rgba(220,38,38,0.35)",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 900,
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
    fontWeight: 900,
    padding: 0,
    fontSize: 15,
    textAlign: "left",
  },
  playerMeta: {
    marginTop: 4,
    fontSize: 12,
    opacity: 0.75,
    whiteSpace: "normal",
  },
  pill: {
    display: "inline-block",
    minWidth: 28,
    padding: "4px 10px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.10)",
    border: "1px solid rgba(255,255,255,0.18)",
    fontWeight: 900,
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
  subTitle: { fontWeight: 900, marginBottom: 10 },
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

  // ✅ new enter-scores styles
  holeHeader: {
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap",
  },
  holeTitle: { fontSize: 20, fontWeight: 900, letterSpacing: -0.2 },
  holeSub: { marginTop: 4, fontSize: 12, opacity: 0.8 },
  holeNav: { display: "flex", gap: 10, flexWrap: "wrap" },
  scoreRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    background: "rgba(0,0,0,0.18)",
    border: "1px solid rgba(255,255,255,0.10)",
  },
  scoreInput: {
    width: 84,
    textAlign: "center",
    fontSize: 20,
    fontWeight: 900,
    padding: "10px 10px",
    borderRadius: 14,
    background: "rgba(0,0,0,0.35)",
    border: "1px solid rgba(255,255,255,0.18)",
    color: "#fff",
    outline: "none",
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
  modalTitle: { fontSize: 18, fontWeight: 900, lineHeight: 1.1 },
  modalSub: { marginTop: 6, fontSize: 13, opacity: 0.85 },
};

// simple responsive tweak
if (typeof window !== "undefined") {
  const media = window.matchMedia("(min-width: 720px)");
  if (media && media.matches) {
    styles.adminGrid.gridTemplateColumns = "1fr 1fr";
  }
}
