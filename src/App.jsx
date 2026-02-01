import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

/** ✅ Supabase via env vars */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** ⛳ PARS (Blue tees, Par 72) — you said this is correct */
const PARS = [
  4, 4, 4, 3, 4, 3, 5, 3, 5,
  4, 3, 5, 3, 4, 5, 4, 4, 5,
];

/** 🧠 STROKE INDEX (Men’s Handicap row from your scorecard)
 *  1 = hardest hole, 18 = easiest
 *  Index corresponds to hole number (array index 0 => hole 1)
 */
const STROKE_INDEX = [
  12, 10, 4, 14, 2, 8, 6, 18, 16,
  9, 3, 17, 13, 5, 15, 1, 11, 7,
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

function makeCode(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function normalizeName(s) {
  return (s || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function safeStr(v) {
  return (v ?? "").toString().trim();
}

function parseHandicap(v) {
  const s = safeStr(v);
  if (s === "") return { value: 0, missing: true, invalid: false };
  const n = Number(s);
  if (!Number.isFinite(n)) return { value: 0, missing: false, invalid: true };
  return { value: Math.trunc(n), missing: false, invalid: false };
}

/** True stroke index allocation:
 *  - base strokes per hole = floor(H/18)
 *  - remainder strokes go to the hardest holes first (SI 1..rem)
 */
function strokesForHole(handicap, strokeIndex) {
  const h = Math.max(0, clampInt(handicap, 0));
  const si = clampInt(strokeIndex, 18);
  const base = Math.floor(h / 18);
  const rem = h % 18;
  const extra = si <= rem ? 1 : 0;
  return base + extra;
}

function strokesUsedForPlayedHoles(handicap, playedHoles) {
  return playedHoles.reduce((acc, holeNum) => {
    const si = STROKE_INDEX[holeNum - 1];
    return acc + strokesForHole(handicap, si);
  }, 0);
}

async function readExcelFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

export default function App() {
  const [tab, setTab] = useState("home"); // home | leaderboard | code | enter | admin
  const [status, setStatus] = useState("Loading...");

  const [players, setPlayers] = useState([]);
  const [scores, setScores] = useState([]);

  // Leaderboard scorecard modal
  const [scorecardPlayerId, setScorecardPlayerId] = useState(null);

  // Admin gate
  const [adminPin, setAdminPin] = useState("");
  const [adminOn, setAdminOn] = useState(false);

  // Admin: Excel upload
  const [uploadPreview, setUploadPreview] = useState(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  const [replaceAssignments, setReplaceAssignments] = useState(true);
  const [regenCodes, setRegenCodes] = useState(false);

  // Foursomes data
  const [foursomes, setFoursomes] = useState([]);
  const [foursomePlayers, setFoursomePlayers] = useState([]); // rows with foursome_id, player_id, seat?

  // Enter Scores: code gate
  const [entryCode, setEntryCode] = useState("");
  const [activeFoursome, setActiveFoursome] = useState(null);
  const [activePlayers, setActivePlayers] = useState([]);

  // Enter Scores: hole-by-hole UI
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
    try {
      const { data, error } = await supabase
        .from("foursomes")
        .select("id,group_name,code,tee_time_text,created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      setFoursomes(data || []);
      return { ok: true };
    } catch (e) {
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
  }

  async function loadFoursomePlayers() {
    try {
      const { data, error } = await supabase
        .from("foursome_players")
        .select("id,foursome_id,player_id,seat,created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      setFoursomePlayers(data || []);
      return { ok: true };
    } catch (e) {
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
    // last-write-wins by player/hole
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

      // ✅ True SI allocation (not prorated)
      const strokesUsed = strokesUsedForPlayedHoles(handicap, playedHoles);
      const netGross = gross - strokesUsed;
      const netToPar = holesPlayed === 0 ? 9999 : Math.round(netGross - parPlayed);

      return {
        id: p.id,
        name: p.name,
        handicap,
        charity: p.charity,
        holesPlayed,
        netToPar,
        scoresByHole,
        strokesUsed,
      };
    });

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
    if (!f) return alert("Code not found.");

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
    const row = scores.find((s) => s.player_id === pid && clampInt(s.hole, 0) === holeNum);
    return row ? clampInt(row.score, 0) : null;
  }

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

    for (const p of activePlayers) {
      const raw = (holeInputs[p.id] ?? "").trim();
      if (!raw) continue;
      const sc = clampInt(raw, 0);
      if (sc < 1 || sc > 20) {
        alert(`Score for ${p.name} looks wrong (1–20).`);
        return;
      }

      const { error } = await supabase
        .from("scores")
        .upsert({ player_id: p.id, hole, score: sc }, { onConflict: "player_id,hole" });

      if (error) {
        console.error(error);
        alert("Error saving scores. (Check scores RLS + unique constraint player_id,hole.)");
        return;
      }
    }

    await loadScores();
    setHole(nextHole);
  }

  // ------------------------
  // ADMIN: Excel Preview/Apply
  // Excel headers required:
  // first_name | last_name | handicap | charity | group_name | tee_time
  // ------------------------

  function buildTournamentPreview(rows) {
    const errors = [];
    const warnings = [];
    const cleaned = [];
    const groups = new Map(); // group_name -> { tee_time_text, members: [] }
    const nameCounts = new Map();

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const first = safeStr(r.first_name);
      const last = safeStr(r.last_name);
      const group = safeStr(r.group_name);
      const tee = safeStr(r.tee_time);
      const charity = safeStr(r.charity) || null;

      if (!first || !last) {
        errors.push(`Row ${i + 2}: first_name and last_name are required.`);
        continue;
      }
      if (!group) {
        errors.push(`Row ${i + 2}: group_name is required.`);
        continue;
      }

      const fullName = `${first} ${last}`.trim();
      const norm = normalizeName(fullName);

      const hc = parseHandicap(r.handicap);
      if (hc.invalid) errors.push(`Row ${i + 2}: handicap is not a number for "${fullName}".`);
      if (hc.missing) warnings.push(`Row ${i + 2}: handicap missing for "${fullName}" (defaults to 0).`);

      nameCounts.set(norm, (nameCounts.get(norm) || 0) + 1);

      cleaned.push({
        name: fullName,
        name_norm: norm,
        handicap: hc.value,
        charity,
        group_name: group,
        tee_time_text: tee || null,
        rowIndex: i,
      });

      if (!groups.has(group)) groups.set(group, { tee_time_text: tee || null, members: [] });
      const g = groups.get(group);
      if (!g.tee_time_text && tee) g.tee_time_text = tee;
      g.members.push(fullName);
    }

    for (const [norm, count] of nameCounts.entries()) {
      if (count > 1) warnings.push(`Duplicate player in upload: "${norm}" appears ${count} times.`);
    }

    for (const [gname, g] of groups.entries()) {
      if (g.members.length > 4) warnings.push(`Group "${gname}" has ${g.members.length} players (more than 4).`);
      if (!g.tee_time_text) warnings.push(`Group "${gname}" missing tee_time (optional).`);
    }

    const existingPlayerMap = new Map(players.map((p) => [normalizeName(p.name), p]));
    const newPlayers = cleaned.filter((x) => !existingPlayerMap.has(x.name_norm));
    const existingCount = cleaned.length - newPlayers.length;

    const existingGroupMap = new Map(foursomes.map((f) => [safeStr(f.group_name), f]));
    const newGroups = Array.from(groups.keys()).filter((g) => !existingGroupMap.has(g));

    return {
      ok: errors.length === 0,
      counts: {
        rows: rows.length,
        validRows: cleaned.length,
        players: cleaned.length,
        existingPlayers: existingCount,
        newPlayers: newPlayers.length,
        groups: groups.size,
        newGroups: newGroups.length,
      },
      groups: Array.from(groups.entries()).map(([group_name, v]) => ({
        group_name,
        tee_time_text: v.tee_time_text,
        members: v.members,
      })),
      cleaned,
      errors,
      warnings,
    };
  }

  async function applyTournamentSetup(preview) {
    if (!adminOn) return alert("Admin only.");
    if (!preview?.ok) return alert("Fix upload errors before applying.");

    setUploadBusy(true);
    setUploadMsg("Applying tournament setup…");

    try {
      // fresh players
      const { data: pData, error: pErr } = await supabase
        .from("players")
        .select("id,name,handicap,charity,created_at");
      if (pErr) throw pErr;

      const playerByNorm = new Map((pData || []).map((p) => [normalizeName(p.name), p]));

      // upsert players by name
      for (const row of preview.cleaned) {
        const existing = playerByNorm.get(row.name_norm);
        if (existing) {
          const { error } = await supabase
            .from("players")
            .update({ handicap: row.handicap, charity: row.charity })
            .eq("id", existing.id);
          if (error) throw error;
        } else {
          const { data: ins, error } = await supabase
            .from("players")
            .insert({ name: row.name, handicap: row.handicap, charity: row.charity })
            .select("id,name,handicap,charity")
            .single();
          if (error) throw error;
          playerByNorm.set(row.name_norm, ins);
        }
      }

      // fresh foursomes
      let foursomesNow = [];
      let hasTeeTime = false;

      try {
        const { data, error } = await supabase
          .from("foursomes")
          .select("id,group_name,code,tee_time_text,created_at");
        if (error) throw error;
        foursomesNow = data || [];
        hasTeeTime = true;
      } catch {
        const { data, error } = await supabase
          .from("foursomes")
          .select("id,group_name,code,created_at");
        if (error) throw error;
        foursomesNow = data || [];
        hasTeeTime = false;
      }

      const foursomeByName = new Map(foursomesNow.map((f) => [safeStr(f.group_name), f]));

      // upsert groups
      for (const g of preview.groups) {
        const existing = foursomeByName.get(g.group_name);

        if (existing) {
          const patch = {
            ...(regenCodes ? { code: makeCode(6) } : {}),
            ...(hasTeeTime ? { tee_time_text: g.tee_time_text || null } : {}),
          };

          const { error } = await supabase
            .from("foursomes")
            .update(patch)
            .eq("id", existing.id);
          if (error) throw error;
        } else {
          const base = { group_name: g.group_name, code: makeCode(6) };

          if (hasTeeTime) {
            const { data: ins, error } = await supabase
              .from("foursomes")
              .insert({ ...base, tee_time_text: g.tee_time_text || null })
              .select("id,group_name,code,tee_time_text")
              .single();
            if (error) throw error;
            foursomeByName.set(g.group_name, ins);
          } else {
            const { data: ins, error } = await supabase
              .from("foursomes")
              .insert(base)
              .select("id,group_name,code")
              .single();
            if (error) throw error;
            foursomeByName.set(g.group_name, ins);
          }
        }
      }

      // replace assignments
      if (replaceAssignments) {
        const { error } = await supabase
          .from("foursome_players")
          .delete()
          .neq("id", "00000000-0000-0000-0000-000000000000");
        if (error) throw error;
      }

      // insert assignments (seat based on file order within group)
      const groupSeat = new Map();
      const inserts = [];

      for (const row of preview.cleaned) {
        const f = foursomeByName.get(row.group_name);
        const p = playerByNorm.get(row.name_norm);
        if (!f || !p) continue;

        const nextSeat = (groupSeat.get(row.group_name) || 0) + 1;
        groupSeat.set(row.group_name, nextSeat);

        inserts.push({
          foursome_id: f.id,
          player_id: p.id,
          seat: nextSeat,
        });
      }

      if (inserts.length) {
        const { error } = await supabase.from("foursome_players").insert(inserts);
        if (error) throw error;
      }

      await initialLoad();
      setUploadMsg("Applied ✅");
      alert("Tournament setup applied ✅");
      setUploadPreview(null);
    } catch (err) {
      console.error(err);
      setUploadMsg("Apply failed ❌");
      alert("Apply failed. Open DevTools Console for the exact error.");
    } finally {
      setUploadBusy(false);
    }
  }

  // Derive strokes used for scorecard player (based on the holes they’ve actually entered)
  const scorecardPlayedHoles = useMemo(() => {
    if (!scorecardPlayer) return [];
    return Object.keys(scorecardPlayer.scoresByHole || {})
      .map((x) => clampInt(x, 0))
      .filter((h) => h >= 1 && h <= 18)
      .sort((a, b) => a - b);
  }, [scorecardPlayer]);

  const scorecardStrokesUsed = useMemo(() => {
    if (!scorecardPlayer) return 0;
    return strokesUsedForPlayedHoles(scorecardPlayer.handicap, scorecardPlayedHoles);
  }, [scorecardPlayer, scorecardPlayedHoles]);

  return (
    <div style={styles.page}>
      {/* Scorecard modal */}
      {scorecardPlayer && (
        <div style={styles.modalOverlay} onClick={() => setScorecardPlayerId(null)}>
          <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalHeader}>
              <div style={{ minWidth: 0 }}>
                <div style={styles.modalTitle}>
                  {scorecardPlayer.name}{" "}
                  <span style={{ opacity: 0.7 }}>(HCP {scorecardPlayer.handicap})</span>
                </div>

                <div style={styles.modalSub}>
                  Holes: {scorecardPlayer.holesPlayed}
                  {" • "}HCP strokes used: <b>{scorecardStrokesUsed}</b>
                  {" • "}Net vs Par:{" "}
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
                    <th style={styles.th}>SI</th>
                    <th style={styles.th}>HCP</th>
                    <th style={styles.th}>Gross</th>
                    <th style={styles.th}>Net</th>
                    <th style={styles.th}>Net +/-</th>
                  </tr>
                </thead>

                <tbody>
                  {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => {
                    const par = PARS[h - 1];
                    const si = STROKE_INDEX[h - 1];

                    const sc = scorecardPlayer.scoresByHole[h]; // gross
                    const hcpStrokes = strokesForHole(scorecardPlayer.handicap, si);

                    const netSc = sc != null ? sc - hcpStrokes : null;
                    const netDiff = netSc != null ? netSc - par : null;

                    const netDiffStyle =
                      netDiff == null
                        ? {}
                        : netDiff < 0
                        ? { color: "#16a34a", fontWeight: 800 }
                        : netDiff > 0
                        ? { color: "#dc2626", fontWeight: 800 }
                        : { opacity: 0.9, fontWeight: 800 };

                    // ✅ Mark holes where the player gets strokes
                    const getsStrokes = hcpStrokes > 0;
                    const rowStyle = getsStrokes
                      ? {
                          background: "rgba(245, 230, 200, 0.08)",
                          boxShadow: "inset 3px 0 0 rgba(245, 230, 200, 0.55)",
                        }
                      : {};

                    return (
                      <tr key={h} style={rowStyle}>
                        <td style={styles.td}>
                          {h} {getsStrokes ? <span style={{ opacity: 0.9 }}>★</span> : null}
                        </td>
                        <td style={styles.td}>{par}</td>
                        <td style={styles.td}>{si}</td>
                        <td style={styles.td}>{hcpStrokes}</td>
                        <td style={styles.td}>{sc != null ? sc : "—"}</td>
                        <td style={styles.td}>{netSc != null ? netSc : "—"}</td>
                        <td style={{ ...styles.td, ...netDiffStyle }}>
                          {netDiff == null ? "—" : formatToPar(netDiff)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
              Handicap is allocated by Stroke Index (SI). ★ indicates holes where handicap strokes apply.
            </div>
          </div>
        </div>
      )}

      <div style={styles.shell}>
        {/* HOME */}
        {tab === "home" && (
          <div style={styles.homeCard}>
            <div style={{ textAlign: "center" }}>
              <img
                src="/logo.png"
                alt="Ginvitational logo"
                style={{ width: 220, height: 220, objectFit: "contain" }}
              />
              <div style={{ marginTop: 12, fontSize: 34, fontWeight: 950, letterSpacing: -0.5 }}>
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
              <button style={styles.bigBtn} onClick={() => setTab("code")}>
                📝 Enter Scores
              </button>
              <button style={styles.bigBtn} onClick={() => setTab("admin")}>
                ⚙️ Admin
              </button>
            </div>
          </div>
        )}

        {/* CODE GATE */}
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

        {/* TOP NAV */}
        {tab !== "home" && tab !== "code" && (
          <header style={styles.header}>
            <div style={styles.headerTop}>
              <div style={styles.brand}>
                <div style={styles.brandTitle}>Ginvitational</div>
                <div style={styles.brandSub}>{status}</div>
              </div>

              <nav style={styles.nav}>
                <button style={styles.navBtn} onClick={() => setTab("home")}>
                  Home
                </button>
                <button
                  style={tab === "leaderboard" ? styles.navBtnActive : styles.navBtn}
                  onClick={() => setTab("leaderboard")}
                >
                  Leaderboard
                </button>
                <button style={styles.navBtn} onClick={() => setTab("code")}>
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

        {/* LEADERBOARD */}
        {tab === "leaderboard" && (
          <div style={styles.card}>
            <div style={styles.cardHeaderRow}>
              <div style={styles.cardTitle}>Leaderboard</div>
              <button style={styles.smallBtn} onClick={async () => { await loadPlayers(); await loadScores(); }}>
                Refresh
              </button>
            </div>

            <div style={styles.helpText}>
              Tap a player name to view their scorecard. Handicap uses true Stroke Index allocation.
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
                            {r.holesPlayed > 0 ? ` • Strokes used: ${r.strokesUsed}` : ""}
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

        {/* ENTER SCORES */}
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
                      onChange={(e) => setHoleInputs((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>

              <div style={styles.navRow}>
                <button style={styles.smallBtn} disabled={hole === 1} onClick={() => saveHoleThenNavigate(hole - 1)}>
                  ← Last Hole
                </button>

                <button style={styles.bigBtn} onClick={() => saveHoleThenNavigate(Math.min(18, hole + 1))}>
                  Save & Next →
                </button>
              </div>

              <div style={styles.helpText}>
                Type scores for your foursome, then hit <b>Save & Next</b>. Leaving a box blank means “no score yet”.
              </div>
            </div>
          </div>
        )}

        {/* ADMIN (Excel Upload) */}
        {tab === "admin" && (
          <div style={styles.card}>
            <div style={styles.cardTitle}>Admin</div>
            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>ADMIN BUILD: EXCEL-UPLOAD v1</div>

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

                <div style={styles.helpText}>Upload an Excel file to set up players + groups + tee times.</div>
              </div>
            ) : (
              <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
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

                <div style={styles.subCard}>
                  <div style={styles.subTitle}>Tournament Setup Upload</div>
                  <div style={styles.helpText}>
                    Required headers: <b>first_name</b>, <b>last_name</b>, <b>handicap</b>, <b>charity</b>,{" "}
                    <b>group_name</b>, <b>tee_time</b>.
                  </div>

                  <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      disabled={uploadBusy}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;

                        setUploadMsg("");
                        setUploadPreview(null);

                        try {
                          const rows = await readExcelFile(file);
                          const prev = buildTournamentPreview(rows);
                          setUploadPreview(prev);
                        } catch (err) {
                          console.error(err);
                          alert("Could not read Excel file.");
                        }
                      }}
                    />

                    <label style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <input
                        type="checkbox"
                        checked={replaceAssignments}
                        onChange={(e) => setReplaceAssignments(e.target.checked)}
                        disabled={uploadBusy}
                      />
                      <div style={{ fontSize: 13, opacity: 0.9 }}>
                        Replace all foursome assignments from this file (recommended)
                      </div>
                    </label>

                    <label style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <input
                        type="checkbox"
                        checked={regenCodes}
                        onChange={(e) => setRegenCodes(e.target.checked)}
                        disabled={uploadBusy}
                      />
                      <div style={{ fontSize: 13, opacity: 0.9 }}>
                        Regenerate all foursome codes (OFF by default)
                      </div>
                    </label>

                    {uploadPreview ? (
                      <div style={{ marginTop: 6, display: "grid", gap: 10 }}>
                        <div style={{ fontWeight: 950 }}>Preview</div>

                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 13, opacity: 0.9 }}>
                          <span style={styles.pill}>Rows: {uploadPreview.counts.rows}</span>
                          <span style={styles.pill}>Players: {uploadPreview.counts.players}</span>
                          <span style={styles.pill}>Groups: {uploadPreview.counts.groups}</span>
                          <span style={styles.pill}>New Players: {uploadPreview.counts.newPlayers}</span>
                          <span style={styles.pill}>New Groups: {uploadPreview.counts.newGroups}</span>
                        </div>

                        {uploadPreview.errors.length > 0 && (
                          <div
                            style={{
                              padding: 10,
                              borderRadius: 12,
                              border: "1px solid rgba(220,38,38,0.35)",
                              background: "rgba(220,38,38,0.10)",
                            }}
                          >
                            <div style={{ fontWeight: 950, marginBottom: 6 }}>Errors (fix before applying)</div>
                            <div style={{ display: "grid", gap: 6, fontSize: 12, opacity: 0.95 }}>
                              {uploadPreview.errors.slice(0, 15).map((x, i) => (
                                <div key={i}>• {x}</div>
                              ))}
                              {uploadPreview.errors.length > 15 && <div>…and more</div>}
                            </div>
                          </div>
                        )}

                        {uploadPreview.warnings.length > 0 && (
                          <div
                            style={{
                              padding: 10,
                              borderRadius: 12,
                              border: "1px solid rgba(255,255,255,0.18)",
                              background: "rgba(255,255,255,0.06)",
                            }}
                          >
                            <div style={{ fontWeight: 950, marginBottom: 6 }}>Warnings</div>
                            <div style={{ display: "grid", gap: 6, fontSize: 12, opacity: 0.9 }}>
                              {uploadPreview.warnings.slice(0, 15).map((x, i) => (
                                <div key={i}>• {x}</div>
                              ))}
                              {uploadPreview.warnings.length > 15 && <div>…and more</div>}
                            </div>
                          </div>
                        )}

                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                          <button
                            style={styles.bigBtn}
                            disabled={uploadBusy || !uploadPreview.ok}
                            onClick={() => applyTournamentSetup(uploadPreview)}
                          >
                            {uploadBusy ? "Applying…" : "✅ Apply Tournament Setup"}
                          </button>

                          <button
                            style={styles.smallBtn}
                            disabled={uploadBusy}
                            onClick={() => {
                              setUploadPreview(null);
                              setUploadMsg("");
                            }}
                          >
                            Clear Upload
                          </button>
                        </div>

                        {uploadMsg && <div style={{ fontSize: 12, opacity: 0.85 }}>{uploadMsg}</div>}

                        <div style={{ marginTop: 6 }}>
                          <div style={{ fontWeight: 900, opacity: 0.9, marginBottom: 6 }}>Groups (from upload)</div>
                          <div style={{ display: "grid", gap: 8 }}>
                            {uploadPreview.groups.slice(0, 12).map((g) => (
                              <div key={g.group_name} style={styles.foursomeCard}>
                                <div style={{ fontWeight: 950 }}>
                                  {g.group_name}
                                  {g.tee_time_text ? <span style={{ opacity: 0.75 }}> • {g.tee_time_text}</span> : null}
                                </div>
                                <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
                                  {g.members.join(", ")}
                                </div>
                              </div>
                            ))}
                            {uploadPreview.groups.length > 12 && (
                              <div style={styles.helpText}>…and {uploadPreview.groups.length - 12} more groups</div>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div style={styles.helpText}>
                        Upload a file to see a preview. Nothing writes until you click <b>Apply</b>.
                      </div>
                    )}
                  </div>
                </div>

                <div style={styles.subCard}>
                  <div style={styles.subTitle}>Current Foursome Codes</div>
                  <div style={styles.helpText}>Players enter scores using their group’s 6-character code.</div>

                  <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                    {foursomes.map((f) => (
                      <div key={f.id} style={styles.foursomeCard}>
                        <div style={{ fontWeight: 950 }}>
                          {f.group_name}{" "}
                          <span style={{ opacity: 0.75, fontWeight: 800 }}>(Code: {f.code})</span>
                        </div>
                        {typeof f.tee_time_text !== "undefined" && f.tee_time_text ? (
                          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
                            Tee time: {f.tee_time_text}
                          </div>
                        ) : null}
                      </div>
                    ))}
                    {foursomes.length === 0 && <div style={styles.helpText}>No foursomes yet.</div>}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Styles */
const styles = {
  page: {
    minHeight: "100vh",
    padding: 14,
    background: "radial-gradient(circle at 30% 20%, #f5e6c8 0%, #2c2c2c 55%, #111 100%)",
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

  subCard: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 14,
    padding: 14,
  },
  subTitle: { fontWeight: 950, marginBottom: 10, fontSize: 16 },

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
};
