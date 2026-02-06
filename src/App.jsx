import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

/** ✅ Supabase via env vars */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** ⛳ PARS (Blue tees, Par 72; hole 18 is par 5) */
const PARS = [
  4, 4, 4, 3, 4, 3, 5, 3, 5,
  4, 3, 5, 3, 4, 5, 4, 4, 5,
];

/** 🧮 Stroke Index — Manufacturers GC (Blue Tees, Men’s) (1 = hardest)
 * If these ever change, just update this array.
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

/** Real handicap allocation by stroke index */
function strokesOnHole(courseHcp, holeNum) {
  const h = clampInt(courseHcp, 0);
  if (h <= 0) return 0;

  const full = Math.floor(h / 18);
  const rem = h % 18;
  const si = STROKE_INDEX[holeNum - 1];

  return full + (rem > 0 && si <= rem ? 1 : 0);
}

function netScoreForHole(grossScore, courseHcp, holeNum) {
  return grossScore - strokesOnHole(courseHcp, holeNum);
}

function errToText(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (err.message) return err.message;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function lastName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts[parts.length - 1];
}

/** --- Brand palette --- */
const PALETTE = {
  // Primary
  fairwayGreen: "#1E3D34",
  deepMeadow: "#071F13",
  black: "#000000",
  white: "#FFFFFF",

  // Secondary
  sandstone: "#F2EBDD",
  teeSand: "#CBBD97",
  puttingGreen: "#8E998B",
  juniperLeaf: "#385230",
  oliveGrove: "#46492B",

  // Accent
  whickerBasket: "#9F7750",
  salmonRose: "#994B3E",
  admiralBlue: "#243144",
};

const THEME = {
  bg: PALETTE.sandstone,
  ink: PALETTE.deepMeadow,

  surface: "rgba(7, 31, 19, 0.86)",
  surfaceSoft: "rgba(30, 61, 52, 0.44)",
  surfaceUltraSoft: "rgba(30, 61, 52, 0.26)",

  border: "rgba(30, 61, 52, 0.26)",
  borderStrong: "rgba(30, 61, 52, 0.46)",

  text: "rgba(242, 235, 221, 0.98)",
  textMuted: "rgba(242, 235, 221, 0.78)",
  textFaint: "rgba(242, 235, 221, 0.60)",

  btn: "rgba(203, 189, 151, 0.14)",
  btnBorder: "rgba(242, 235, 221, 0.30)",
  btnStrong: "rgba(203, 189, 151, 0.20)",

  accent: PALETTE.whickerBasket,
  danger: PALETTE.salmonRose,

  good: "#2F8F62",
  bad: PALETTE.salmonRose,
};

function netColorStyle(netToPar) {
  if (netToPar < 0) return { color: THEME.good };
  if (netToPar > 0) return { color: THEME.bad };
  return { color: THEME.textMuted };
}

function makeCode(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
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

/** Broadcast helpers */
function nowKeyMinute() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}T${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(
    2,
    "0"
  )}`;
}

function safeDedupeKey(parts) {
  return parts
    .map((p) => String(p ?? "").trim().toLowerCase().replace(/\s+/g, "_"))
    .join("|")
    .slice(0, 240);
}

export default function App() {
  const [tab, setTab] = useState("home"); // home | leaderboard | code | enter | admin | broadcast
  const [status, setStatus] = useState("Loading...");

  // Diagnostics (kept)
  const [lastLoadErrors, setLastLoadErrors] = useState([]);
  const [lastLoadAt, setLastLoadAt] = useState(null);

  const [players, setPlayers] = useState([]);
  const [scores, setScores] = useState([]);

  // Broadcast
  const [broadcastMsgs, setBroadcastMsgs] = useState([]);
  const lastSnapshotRef = useRef(null);

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
  const [foursomePlayers, setFoursomePlayers] = useState([]);

  // Admin: manual foursome
  const [manualGroupName, setManualGroupName] = useState("");
  const [manualCode, setManualCode] = useState("");

  // Admin: assign
  const [assignFoursomeId, setAssignFoursomeId] = useState("");
  const [assignPlayerId, setAssignPlayerId] = useState("");

  // Enter Scores: foursome code gate
  const [entryCode, setEntryCode] = useState("");
  const [activeFoursome, setActiveFoursome] = useState(null);
  const [activePlayers, setActivePlayers] = useState([]);

  // Enter Scores: hole-by-hole typing UI
  const [hole, setHole] = useState(1);
  const [holeInputs, setHoleInputs] = useState({});

  // Admin: Excel import (tee sheet)
  const [teeSheetFile, setTeeSheetFile] = useState(null);
  const [teeSheetRows, setTeeSheetRows] = useState([]);
  const [importReplaceFoursomes, setImportReplaceFoursomes] = useState(true);
  const [importMsg, setImportMsg] = useState("");

  async function loadPlayers() {
    const { data, error } = await supabase
      .from("players")
      .select("id,name,handicap,charity,created_at")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("loadPlayers error:", error);
      return { ok: false, where: "players", error: errToText(error) };
    }
    setPlayers(data || []);
    return { ok: true, where: "players" };
  }

  async function loadScores() {
    const { data, error } = await supabase
      .from("scores")
      .select("id,player_id,hole,score,created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("loadScores error:", error);
      return { ok: false, where: "scores", error: errToText(error) };
    }
    setScores(data || []);
    return { ok: true, where: "scores" };
  }

  async function loadFoursomes() {
    const { data, error } = await supabase
      .from("foursomes")
      .select("id,group_name,code,created_at")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("loadFoursomes error:", error);
      return { ok: false, where: "foursomes", error: errToText(error) };
    }
    setFoursomes(data || []);
    return { ok: true, where: "foursomes" };
  }

  async function loadFoursomePlayers() {
    const { data, error } = await supabase
      .from("foursome_players")
      .select("foursome_id,player_id,seat,created_at")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("loadFoursomePlayers error:", error);
      return { ok: false, where: "foursome_players", error: errToText(error) };
    }
    setFoursomePlayers(data || []);
    return { ok: true, where: "foursome_players" };
  }

  async function loadBroadcast() {
    // newest first
    const { data, error } = await supabase
      .from("broadcast_messages")
      .select("id,created_at,kind,text,player_id,dedupe_key")
      .order("created_at", { ascending: false })
      .limit(5000);

    if (error) {
      console.error("loadBroadcast error:", error);
      return { ok: false, where: "broadcast_messages", error: errToText(error) };
    }
    setBroadcastMsgs(data || []);
    return { ok: true, where: "broadcast_messages" };
  }

  async function initialLoad() {
    setStatus("Loading...");
    setLastLoadErrors([]);

    const results = [];
    results.push(await loadPlayers());
    results.push(await loadScores());
    results.push(await loadFoursomes());
    results.push(await loadFoursomePlayers());
    results.push(await loadBroadcast());

    const fails = results.filter((r) => !r.ok);
    setLastLoadErrors(fails);
    setLastLoadAt(new Date().toISOString());

    if (fails.length === 0) {
      setStatus("Connected ✅");
      return;
    }

    const first = fails[0];
    setStatus(`FAIL: ${first.where} → ${first.error}`);
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
    // last-write-wins scores by player/hole
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

      // Real net (stroke index allocation)
      const netGross = playedHoles.reduce((acc, h) => {
        const grossHole = scoresByHole[h];
        const netHole = netScoreForHole(grossHole, handicap, h);
        return acc + netHole;
      }, 0);

      const netToPar = holesPlayed === 0 ? 9999 : netGross - parPlayed;

      return {
        id: p.id,
        name: p.name,
        last: lastName(p.name),
        handicap,
        charity: p.charity,
        holesPlayed,
        netToPar,
        scoresByHole,
        gross,
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

  /** -----------------------
   *  BROADCAST ENGINE
   *  Runs every 3 minutes
   * ----------------------*/
  async function insertBroadcast(kind, text, dedupeParts, player_id = null) {
    const dedupe_key = safeDedupeKey(dedupeParts);

    const { error } = await supabase
      .from("broadcast_messages")
      .insert({ kind, text, player_id, dedupe_key });

    // Ignore duplicates (unique dedupe_key)
    if (error) {
      const msg = errToText(error);
      if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) return;
      console.error("insertBroadcast error:", error);
    }
  }

  function computeNetStats(row) {
    const played = Object.keys(row.scoresByHole || {})
      .map((x) => clampInt(x, 0))
      .filter((h) => h >= 1 && h <= 18)
      .sort((a, b) => a - b);

    let netBirdies = 0;
    let bogeyFree = true;
    let netDoubles = 0;
    let netTriplesPlus = 0;

    for (const h of played) {
      const gross = row.scoresByHole[h];
      const net = netScoreForHole(gross, row.handicap, h);
      const par = PARS[h - 1];

      if (net <= par - 1) netBirdies += 1;
      if (net > par) bogeyFree = false;

      const over = net - par;
      if (over >= 2 && over < 3) netDoubles += 1;
      if (over >= 3) netTriplesPlus += 1;
    }

    // Front/back splits (net to par)
    const front = played.filter((h) => h >= 1 && h <= 9);
    const back = played.filter((h) => h >= 10 && h <= 18);

    const frontNetToPar =
      front.length === 0
        ? null
        : front.reduce((acc, h) => acc + (netScoreForHole(row.scoresByHole[h], row.handicap, h) - PARS[h - 1]), 0);

    const backNetToPar =
      back.length === 0
        ? null
        : back.reduce((acc, h) => acc + (netScoreForHole(row.scoresByHole[h], row.handicap, h) - PARS[h - 1]), 0);

    return {
      played,
      netBirdies,
      bogeyFree,
      netDoubles,
      netTriplesPlus,
      frontNetToPar,
      backNetToPar,
    };
  }

  async function runBroadcastTick() {
    // need leaderboard computed
    if (!leaderboardRows || leaderboardRows.length === 0) return;

    // Snapshot current ranks
    const ranked = leaderboardRows
      .filter((r) => r.holesPlayed > 0) // only consider players with scores
      .map((r, idx) => ({ ...r, rank: idx + 1 }));

    if (ranked.length === 0) return;

    const current = new Map();
    for (const r of ranked) {
      const stats = computeNetStats(r);
      current.set(r.id, {
        id: r.id,
        last: r.last,
        name: r.name,
        rank: r.rank,
        holes: r.holesPlayed,
        netToPar: r.netToPar,
        stats,
      });
    }

    const prev = lastSnapshotRef.current;
    lastSnapshotRef.current = current;

    // First run: don't spam historical events; just set baseline
    if (!prev) return;

    // Determine leader + LEX (last among scored)
    const leader = ranked[0];
    const lex = ranked[ranked.length - 1];

    const prevLeader = Array.from(prev.values()).find((x) => x.rank === 1);
    const prevLex = Array.from(prev.values()).reduce((acc, x) => (!acc || x.rank > acc.rank ? x : acc), null);

    // New overall leader
    if (prevLeader && prevLeader.id !== leader.id) {
      const t = `${leader.last} takes the lead. Net ${formatToPar(leader.netToPar)}.`;
      await insertBroadcast(
        "leader",
        t,
        ["leader", nowKeyMinute(), leader.id, leader.netToPar, leader.holesPlayed],
        leader.id
      );
    }

    // New LEX
    if (prevLex && prevLex.id !== lex.id) {
      const t = `${lex.last} just inherited The LEX. Someone check on them.`;
      await insertBroadcast("lex", t, ["lex", nowKeyMinute(), lex.id, lex.netToPar, lex.holesPlayed], lex.id);
    }

    // New Top 5 entrant (someone who wasn't in top 5 before, now is)
    const prevTop5 = new Set(Array.from(prev.values()).filter((x) => x.rank <= 5).map((x) => x.id));
    for (const r of ranked.filter((x) => x.rank <= 5)) {
      if (!prevTop5.has(r.id)) {
        const t = `${r.last} just cracked the Top 5. Net ${formatToPar(r.netToPar)}.`;
        await insertBroadcast("top5", t, ["top5_in", nowKeyMinute(), r.id, r.rank, r.netToPar], r.id);
      }
    }

    // Moved up/down X spots (only if absolute change >= 2)
    for (const r of ranked) {
      const p = prev.get(r.id);
      if (!p) continue;
      const delta = p.rank - r.rank; // positive means moved up
      if (Math.abs(delta) >= 2) {
        const dir = delta > 0 ? "up" : "down";
        const spots = Math.abs(delta);
        const t = `${r.last} moved ${dir} ${spots} spot${spots === 1 ? "" : "s"} to #${r.rank}.`;
        await insertBroadcast(
          "move",
          t,
          ["move", nowKeyMinute(), r.id, p.rank, r.rank, r.netToPar],
          r.id
        );
      }
    }

    // Player-specific triggers
    for (const r of ranked) {
      const cur = current.get(r.id);
      const p = prev.get(r.id);
      if (!cur || !p) continue;

      const curStats = cur.stats;
      const prevStats = p.stats;

      // 3rd net birdie of the day
      if ((prevStats?.netBirdies ?? 0) < 3 && curStats.netBirdies >= 3) {
        const t = `${r.last} just posted their 3rd net birdie of the day. Heating up.`;
        await insertBroadcast(
          "birdies",
          t,
          ["3rd_net_birdie", nowKeyMinute(), r.id, curStats.netBirdies, cur.holes],
          r.id
        );
      }

      // Bogey-free through X holes (net bogey-free)
      // milestones to avoid spam:
      const milestones = [6, 9, 12, 15, 18];
      for (const m of milestones) {
        const was = (p.holes ?? 0) >= m && prevStats?.bogeyFree;
        const now = cur.holes >= m && curStats.bogeyFree;
        if (!was && now) {
          const t = `${r.last} is bogey-free through ${m}. Quietly lethal.`;
          await insertBroadcast(
            "bogeyfree",
            t,
            ["bogeyfree", m, nowKeyMinute(), r.id, cur.holes],
            r.id
          );
        }
      }

      // Double / triple disaster (net)
      if ((prevStats?.netDoubles ?? 0) < curStats.netDoubles) {
        const t = `${r.last} just took a net double. Damage control mode.`;
        await insertBroadcast(
          "disaster",
          t,
          ["net_double", nowKeyMinute(), r.id, curStats.netDoubles, cur.holes],
          r.id
        );
      }
      if ((prevStats?.netTriplesPlus ?? 0) < curStats.netTriplesPlus) {
        const t = `${r.last} just found a net triple (or worse). The course demanded tribute.`;
        await insertBroadcast(
          "disaster",
          t,
          ["net_triple", nowKeyMinute(), r.id, curStats.netTriplesPlus, cur.holes],
          r.id
        );
      }

      // Front / Back split (announce once when they complete either 9)
      // Only announce for leader/top5 and LEX to keep it cleaner
      const isLeaderOrTop5 = r.rank <= 5;
      const isLex = r.id === lex.id;

      if (isLeaderOrTop5 || isLex) {
        const prevFrontDone = (prevStats?.played || []).filter((h) => h <= 9).length >= 9;
        const curFrontDone = (curStats.played || []).filter((h) => h <= 9).length >= 9;

        if (!prevFrontDone && curFrontDone && curStats.frontNetToPar != null) {
          const t = `${r.last} turned in ${formatToPar(curStats.frontNetToPar)} on the front.`;
          await insertBroadcast(
            "split",
            t,
            ["front_split", nowKeyMinute(), r.id, curStats.frontNetToPar],
            r.id
          );
        }

        const prevBackDone = (prevStats?.played || []).filter((h) => h >= 10).length >= 9;
        const curBackDone = (curStats.played || []).filter((h) => h >= 10).length >= 9;

        if (!prevBackDone && curBackDone && curStats.backNetToPar != null) {
          const t = `${r.last} played the back in ${formatToPar(curStats.backNetToPar)}.`;
          await insertBroadcast(
            "split",
            t,
            ["back_split", nowKeyMinute(), r.id, curStats.backNetToPar],
            r.id
          );
        }
      }

      // Hole highlights (net birdie) only for current leader + current LEX
      // Detect newly added hole(s) since last snapshot and check if any of those were net birdies
      const prevPlayed = new Set(prevStats?.played || []);
      const newHoles = (curStats.played || []).filter((h) => !prevPlayed.has(h));

      const highlightAllowed = r.id === leader.id || r.id === lex.id;
      if (highlightAllowed && newHoles.length > 0) {
        for (const h of newHoles) {
          const gross = r.scoresByHole[h];
          if (gross == null) continue;
          const net = netScoreForHole(gross, r.handicap, h);
          const par = PARS[h - 1];
          if (net <= par - 1) {
            const si = STROKE_INDEX[h - 1];
            const who = r.id === leader.id ? "Leader" : "The LEX";
            const t = `${who} alert: ${r.last} just made a net birdie on #${h} (SI ${si}).`;
            await insertBroadcast(
              "highlight",
              t,
              ["highlight_birdie", nowKeyMinute(), r.id, h, net, par, r.rank],
              r.id
            );
          }
        }
      }
    }

    // Refresh broadcast list after inserts
    await loadBroadcast();
  }

  // Broadcast tick every 3 minutes
  useEffect(() => {
    const id = setInterval(async () => {
      // Keep underlying data fresh for broadcasting
      await loadPlayers();
      await loadScores();
      await runBroadcastTick();
    }, 180_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players.length]); // stable enough; avoids re-registering constantly

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
      alert(`Error adding player: ${errToText(error)}`);
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

    await supabase.from("scores").delete().eq("player_id", id);
    await supabase.from("foursome_players").delete().eq("player_id", id);

    const { error } = await supabase.from("players").delete().eq("id", id);
    if (error) {
      console.error(error);
      alert(`Error deleting player: ${errToText(error)}`);
      return;
    }
    await initialLoad();
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
      alert(`Error creating foursome: ${errToText(error)}`);
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
      alert(`Error assigning player: ${errToText(error)}`);
      return;
    }

    setAssignPlayerId("");
    await loadFoursomePlayers();
  }

  async function removePlayerFromFoursome(foursome_id, player_id) {
    if (!adminOn) return alert("Admin only.");
    const { error } = await supabase
      .from("foursome_players")
      .delete()
      .eq("foursome_id", foursome_id)
      .eq("player_id", player_id);

    if (error) {
      console.error(error);
      alert(`Error removing player: ${errToText(error)}`);
      return;
    }
    await loadFoursomePlayers();
  }

  async function clearFoursomes() {
    if (!adminOn) return alert("Admin only.");
    if (!confirm("Clear all foursomes + assignments? (Does not delete players or scores)")) return;

    await supabase
      .from("foursome_players")
      .delete()
      .neq("foursome_id", "00000000-0000-0000-0000-000000000000");

    await supabase
      .from("foursomes")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    await initialLoad();
  }

  async function generateRandomFoursomes() {
    if (!adminOn) return alert("Admin only.");
    if (players.length < 2) return alert("Need at least 2 players.");

    await supabase
      .from("foursome_players")
      .delete()
      .neq("foursome_id", "00000000-0000-0000-0000-000000000000");

    await supabase
      .from("foursomes")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    const shuffled = shuffle(players);
    const groups = [];
    for (let i = 0; i < shuffled.length; i += 4) groups.push(shuffled.slice(i, i + 4));

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
        alert(`Error creating foursomes: ${errToText(fErr)}`);
        return;
      }

      const fid = fData.id;
      const inserts = groupPlayers.map((p) => ({ foursome_id: fid, player_id: p.id }));
      const { error: fpErr } = await supabase.from("foursome_players").insert(inserts);

      if (fpErr) {
        console.error(fpErr);
        alert(`Error assigning players: ${errToText(fpErr)}`);
        return;
      }
    }

    await initialLoad();
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
      alert(`Error checking code: ${errToText(error)}`);
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
        alert(`Error saving scores: ${errToText(error)}`);
        return;
      }
    }

    await loadScores();
    await runBroadcastTick(); // immediate check after a save (still respects dedupe)
    setHole(nextHole);
  }

  // ---------------------------
  // EXCEL IMPORT
  // ---------------------------
  function normKey(k) {
    return String(k || "").trim().toLowerCase().replace(/\s+/g, "_");
  }

  function fullNameFromRow(row) {
    const first = String(row.first_name || "").trim();
    const last = String(row.last_name || "").trim();
    return `${first} ${last}`.trim().replace(/\s+/g, " ");
  }

  async function parseTeeSheetFile(file) {
    setImportMsg("");
    setTeeSheetFile(file);

    if (!file) {
      setTeeSheetRows([]);
      return;
    }

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];

      const raw = XLSX.utils.sheet_to_json(ws, { defval: "" });
      if (!raw || raw.length === 0) {
        setTeeSheetRows([]);
        setImportMsg("No rows found in the spreadsheet.");
        return;
      }

      const rows = raw.map((r) => {
        const out = {};
        for (const [k, v] of Object.entries(r)) out[normKey(k)] = v;
        return out;
      });

      const required = ["foursome", "first_name", "last_name"];
      const missing = required.filter((k) => !Object.prototype.hasOwnProperty.call(rows[0] || {}, k));
      if (missing.length) {
        setTeeSheetRows([]);
        setImportMsg(`Missing required columns: ${missing.join(", ")}`);
        return;
      }

      setTeeSheetRows(rows);
      setImportMsg(`Loaded ${rows.length} rows from "${sheetName}".`);
    } catch (e) {
      console.error(e);
      setTeeSheetRows([]);
      setImportMsg("Could not read that Excel file.");
    }
  }

  async function importFromTeeSheet() {
    if (!adminOn) return alert("Admin only.");
    if (!teeSheetRows.length) return alert("Upload a tee sheet first.");

    setImportMsg("Importing…");

    if (importReplaceFoursomes) {
      await supabase
        .from("foursome_players")
        .delete()
        .neq("foursome_id", "00000000-0000-0000-0000-000000000000");

      await supabase
        .from("foursomes")
        .delete()
        .neq("id", "00000000-0000-0000-0000-000000000000");
    }

    await initialLoad();

    const existingByName = new Map(players.map((p) => [String(p.name || "").trim().toLowerCase(), p]));
    const desiredPlayers = [];

    for (const r of teeSheetRows) {
      const name = fullNameFromRow(r);
      if (!name) continue;

      desiredPlayers.push({
        name,
        handicap: clampInt(r.handicap, 0),
        charity: String(r.charity || "").trim() || null,
      });
    }

    const missingPlayers = [];
    for (const p of desiredPlayers) {
      const key = p.name.toLowerCase();
      if (!existingByName.has(key)) {
        existingByName.set(key, p);
        missingPlayers.push(p);
      }
    }

    if (missingPlayers.length) {
      const { error } = await supabase.from("players").insert(missingPlayers);
      if (error) {
        console.error(error);
        setImportMsg(`Error inserting players: ${errToText(error)}`);
        return;
      }
    }

    await loadPlayers();
    const playerIdByName = new Map(players.map((p) => [String(p.name || "").trim().toLowerCase(), p.id]));

    const groupsNeeded = Array.from(
      new Set(teeSheetRows.map((r) => String(r.foursome || "").trim()).filter(Boolean))
    );

    const existingF = await supabase.from("foursomes").select("id,group_name,code,created_at");
    if (existingF.error) {
      console.error(existingF.error);
      setImportMsg(`Error reading foursomes: ${errToText(existingF.error)}`);
      return;
    }

    const foursomeByGroup = new Map(
      (existingF.data || []).map((f) => [String(f.group_name || "").trim().toLowerCase(), f])
    );

    for (const group_name of groupsNeeded) {
      const key = group_name.toLowerCase();
      if (foursomeByGroup.has(key)) continue;

      let created = null;
      for (let tries = 0; tries < 10 && !created; tries++) {
        const code = makeCode(6);
        const { data, error } = await supabase
          .from("foursomes")
          .insert({ group_name, code })
          .select("id,group_name,code")
          .single();

        if (!error) created = data;
      }

      if (!created) {
        setImportMsg(`Could not create foursome "${group_name}". (RLS / code unique / schema issue)`);
        return;
      }
    }

    await loadFoursomes();
    await loadFoursomePlayers();

    const foursomeIdByGroup = new Map(
      foursomes.map((f) => [String(f.group_name || "").trim().toLowerCase(), f.id])
    );

    const existingAssign = new Set(foursomePlayers.map((fp) => `${fp.foursome_id}::${fp.player_id}`));

    const assignmentInserts = [];
    for (const r of teeSheetRows) {
      const group = String(r.foursome || "").trim();
      const name = fullNameFromRow(r);
      if (!group || !name) continue;

      const fid = foursomeIdByGroup.get(group.toLowerCase());
      const pid = playerIdByName.get(name.toLowerCase());
      if (!fid || !pid) continue;

      const key = `${fid}::${pid}`;
      if (existingAssign.has(key)) continue;

      existingAssign.add(key);
      assignmentInserts.push({ foursome_id: fid, player_id: pid });
    }

    if (assignmentInserts.length) {
      const { error } = await supabase.from("foursome_players").insert(assignmentInserts);
      if (error) {
        console.error(error);
        setImportMsg(`Error inserting foursome assignments: ${errToText(error)}`);
        return;
      }
    }

    await initialLoad();
    setImportMsg(`Import complete ✅ New players: ${missingPlayers.length} • New assignments: ${assignmentInserts.length}`);
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
                  {scorecardPlayer.name}{" "}
                  <span style={{ opacity: 0.75, fontWeight: 700 }}>(HCP {scorecardPlayer.handicap})</span>
                </div>
                <div style={styles.modalSub}>
                  Holes: {scorecardPlayer.holesPlayed} • Net vs Par:{" "}
                  {scorecardPlayer.holesPlayed === 0 ? (
                    <span style={{ opacity: 0.75 }}>—</span>
                  ) : (
                    <span style={{ fontWeight: 950, ...netColorStyle(scorecardPlayer.netToPar) }}>
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
                    <th style={styles.th}>SI</th>
                    <th style={styles.th}>Par</th>
                    <th style={styles.th}>Score</th>
                    <th style={styles.th}>+/-</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => {
                    const par = PARS[h - 1];
                    const sc = scorecardPlayer.scoresByHole[h];
                    const si = STROKE_INDEX[h - 1];
                    const strokes = strokesOnHole(scorecardPlayer.handicap, h);

                    // +/- here stays gross vs par (your printed cards are gross)
                    const diff = sc != null ? sc - par : null;

                    const diffStyle =
                      diff == null
                        ? {}
                        : diff < 0
                        ? { color: THEME.good, fontWeight: 900 }
                        : diff > 0
                        ? { color: THEME.bad, fontWeight: 900 }
                        : { opacity: 0.9, fontWeight: 900 };

                    return (
                      <tr key={h}>
                        <td style={styles.td}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <span>{h}</span>
                            {strokes > 0 && <span style={styles.strokePill}>{`+${strokes}`}</span>}
                          </span>
                        </td>
                        <td style={styles.td}>{si}</td>
                        <td style={styles.td}>{par}</td>
                        <td style={styles.td}>{sc != null ? sc : "—"}</td>
                        <td style={{ ...styles.td, ...diffStyle }}>{diff == null ? "—" : formatToPar(diff)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8, color: THEME.textMuted }}>
              Net uses real handicap allocation by Stroke Index; printed cards remain gross.
            </div>
          </div>
        </div>
      )}

      <div style={styles.shell}>
        {/* HOME (no top nav) */}
        {tab === "home" && (
          <div style={styles.homeCard}>
            <div style={{ textAlign: "center" }}>
              <img
                src="/logo.png"
                alt="Ginvitational logo"
                style={{ width: 210, height: "auto", display: "block", margin: "0 auto" }}
              />

              <div style={styles.homeTitle}>The Ginvitational</div>

              <div style={styles.homeSub}>Drink Good. Play Good. Do Good.</div>

              <div style={styles.homeRule} />
            </div>

            <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
              <button style={styles.bigBtn} onClick={() => setTab("leaderboard")}>
                Leaderboard
              </button>

              <button
                style={styles.bigBtn}
                onClick={async () => {
                  await loadBroadcast();
                  setTab("broadcast");
                }}
              >
                The Broadcast
              </button>

              <button style={styles.bigBtn} onClick={() => setTab("code")}>
                Enter Scores
              </button>

              <button style={styles.bigBtn} onClick={() => setTab("admin")}>
                Admin
              </button>
            </div>

            <div style={{ marginTop: 14, textAlign: "center", fontSize: 12, color: THEME.textMuted }}>
              Manufacturers Golf &amp; CC • May 2026
            </div>
          </div>
        )}

        {/* CODE GATE SCREEN (enter scores) */}
        {tab === "code" && (
          <div style={styles.card}>
            <div style={styles.headerRow}>
              <button style={styles.smallBtn} onClick={() => setTab("home")}>
                Home
              </button>
              <div style={{ fontSize: 12, color: THEME.textMuted }}>{status}</div>
            </div>

            <div style={{ marginTop: 12, fontSize: 22, fontWeight: 950, letterSpacing: -0.2 }}>
              Enter Scores
            </div>
            <div style={styles.helpText}>
              Enter your <b>6-character foursome code</b> to score your group.
            </div>

            <div style={{ marginTop: 14, display: "grid", gap: 10, maxWidth: 520 }}>
              <input
                style={styles.input}
                value={entryCode}
                onChange={(e) => setEntryCode(e.target.value.toUpperCase())}
                placeholder="Enter 6-character code"
                maxLength={6}
                autoCapitalize="characters"
              />
              <button style={styles.bigBtn} onClick={enterWithCode}>
                Continue
              </button>

              <div style={{ fontSize: 12, color: THEME.textMuted }}>
                You can only enter scores for your foursome code.
              </div>
            </div>
          </div>
        )}

        {/* TOP NAV (all non-home pages) */}
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
                <button
                  style={tab === "broadcast" ? styles.navBtnActive : styles.navBtn}
                  onClick={async () => {
                    await loadBroadcast();
                    setTab("broadcast");
                  }}
                >
                  The Broadcast
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

        {/* BROADCAST */}
        {tab === "broadcast" && (
          <div style={styles.card}>
            <div style={styles.cardHeaderRow}>
              <div style={styles.cardTitle}>The Broadcast</div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  style={styles.smallBtn}
                  onClick={async () => {
                    await loadPlayers();
                    await loadScores();
                    await runBroadcastTick();
                    await loadBroadcast();
                  }}
                >
                  Refresh
                </button>
                <button style={styles.smallBtn} onClick={() => setTab("home")}>
                  Home
                </button>
              </div>
            </div>

            <div style={styles.helpText}>
              Fun tournament updates. Net scoring only. Trophy: <b>Agro Crag</b>. Last place: <b>The LEX</b>.
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              {broadcastMsgs.length === 0 && (
                <div style={styles.broadcastItem}>
                  <div style={{ fontWeight: 950 }}>No updates yet</div>
                  <div style={{ marginTop: 6, color: THEME.textMuted, fontSize: 12 }}>
                    Once scores start coming in, this will fill up automatically every ~3 minutes.
                  </div>
                </div>
              )}

              {broadcastMsgs.map((m) => (
                <div key={m.id} style={styles.broadcastItem}>
                  <div style={{ fontSize: 12, color: THEME.textMuted }}>
                    {new Date(m.created_at).toLocaleString()}
                  </div>
                  <div style={{ marginTop: 6, fontWeight: 950 }}>{m.text}</div>
                </div>
              ))}
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
                        ? { opacity: 0.6, color: THEME.textMuted }
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

        {/* ENTER SCORES */}
        {tab === "enter" && (
          <div style={styles.card}>
            <div style={styles.cardHeaderRow}>
              <div>
                <div style={styles.cardTitle}>Enter Scores</div>
                <div style={{ fontSize: 12, color: THEME.textMuted, marginTop: 6 }}>
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
                Hole {hole}{" "}
                <span style={{ opacity: 0.75, fontWeight: 700 }}>(Par {PARS[hole - 1]})</span>
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                {activePlayers.map((p) => (
                  <div key={p.id} style={styles.scoreRow}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {p.name}
                      </div>
                      <div style={{ fontSize: 12, color: THEME.textMuted }}>
                        HCP {clampInt(p.handicap, 0)}
                      </div>
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
                <button
                  style={styles.smallBtn}
                  disabled={hole === 1}
                  onClick={() => saveHoleThenNavigate(hole - 1)}
                >
                  Last Hole
                </button>

                <button style={styles.bigBtn} onClick={() => saveHoleThenNavigate(Math.min(18, hole + 1))}>
                  Save & Next
                </button>
              </div>

              <div style={styles.helpText}>
                Type scores for your foursome, then hit <b>Save & Next</b>. You can go back with <b>Last Hole</b>. Leaving
                a box blank means “no score yet”.
              </div>
            </div>
          </div>
        )}

        {/* ADMIN */}
        {tab === "admin" && (
          <div style={styles.card}>
            <div style={styles.cardTitle}>Admin</div>

            {lastLoadErrors.length > 0 && (
              <div style={{ ...styles.helpText, marginTop: 10 }}>
                <div style={{ fontWeight: 950 }}>Load Errors</div>
                <div style={{ marginTop: 6, fontSize: 12, color: THEME.textMuted }}>
                  Last load: {lastLoadAt || "—"}
                </div>
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    marginTop: 8,
                    background: "rgba(7,31,19,0.22)",
                    padding: 10,
                    borderRadius: 12,
                    border: `1px solid ${THEME.border}`,
                    fontSize: 12,
                    color: THEME.text,
                  }}
                >
                  {JSON.stringify(lastLoadErrors, null, 2)}
                </pre>
              </div>
            )}

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

                <div style={styles.helpText}>Simple front-end PIN gate. (We can harden security later.)</div>
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
                  {/* Import Tee Sheet */}
                  <div style={styles.subCard}>
                    <div style={styles.subTitle}>Import Tee Sheet</div>

                    <div style={{ display: "grid", gap: 10 }}>
                      <input type="file" accept=".xlsx,.xls" onChange={(e) => parseTeeSheetFile(e.target.files?.[0] || null)} />

                      <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, color: THEME.textMuted }}>
                        <input
                          type="checkbox"
                          checked={importReplaceFoursomes}
                          onChange={(e) => setImportReplaceFoursomes(e.target.checked)}
                        />
                        Replace existing foursomes + assignments first (recommended)
                      </label>

                      <button style={styles.bigBtn} onClick={importFromTeeSheet}>
                        Import Players + Foursomes + Assignments
                      </button>

                      {importMsg ? <div style={styles.helpText}>{importMsg}</div> : null}

                      {teeSheetRows.length > 0 && (
                        <div style={{ fontSize: 12, color: THEME.textMuted }}>
                          Preview (first 5 rows):
                          <pre
                            style={{
                              whiteSpace: "pre-wrap",
                              marginTop: 8,
                              background: "rgba(7,31,19,0.22)",
                              padding: 10,
                              borderRadius: 12,
                              border: `1px solid ${THEME.border}`,
                            }}
                          >
                            {JSON.stringify(teeSheetRows.slice(0, 5), null, 2)}
                          </pre>
                        </div>
                      )}

                      {teeSheetFile ? (
                        <div style={{ fontSize: 12, color: THEME.textMuted }}>
                          File: <b>{teeSheetFile.name}</b>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {/* Foursomes */}
                  <div style={styles.subCard}>
                    <div style={styles.subTitle}>Foursomes</div>

                    <div style={{ display: "grid", gap: 10 }}>
                      <button style={styles.bigBtn} onClick={generateRandomFoursomes}>
                        Generate Foursomes (Random)
                      </button>

                      <div style={styles.hr} />

                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={styles.sectionLabel}>Manual create</div>
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

                      <div style={styles.hr} />

                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={styles.sectionLabel}>Assign player to foursome</div>

                        <select style={styles.input} value={assignFoursomeId} onChange={(e) => setAssignFoursomeId(e.target.value)}>
                          <option value="">Select foursome…</option>
                          {foursomes.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.group_name} — {f.code}
                            </option>
                          ))}
                        </select>

                        <select style={styles.input} value={assignPlayerId} onChange={(e) => setAssignPlayerId(e.target.value)}>
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

                      <div style={styles.hr} />

                      <div style={{ fontWeight: 950, letterSpacing: 0.2 }}>View codes + members</div>
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
                                    <span style={{ opacity: 0.78, fontWeight: 800 }}>(Code: {f.code})</span>
                                  </div>
                                  <div style={{ fontSize: 12, color: THEME.textMuted }}>Members: {members.length}</div>
                                </div>
                              </div>

                              <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                                {memberRows.map((fp) => {
                                  const p = players.find((x) => x.id === fp.player_id);
                                  return (
                                    <div key={`${fp.foursome_id}-${fp.player_id}`} style={styles.playerRow}>
                                      <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 950 }}>{p ? p.name : fp.player_id}</div>
                                        {p && (
                                          <div style={styles.playerMeta}>
                                            HCP {clampInt(p.handicap, 0)}
                                            {p.charity ? ` • ${p.charity}` : ""}
                                          </div>
                                        )}
                                      </div>
                                      <button style={styles.dangerBtn} onClick={() => removePlayerFromFoursome(fp.foursome_id, fp.player_id)}>
                                        Remove
                                      </button>
                                    </div>
                                  );
                                })}
                                {memberRows.length === 0 && <div style={styles.helpText}>No players assigned.</div>}
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
                      <div style={{ fontWeight: 950, letterSpacing: 0.2 }}>Add Player</div>
                      <input style={styles.input} placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
                      <input style={styles.input} placeholder="Handicap" value={newHandicap} onChange={(e) => setNewHandicap(e.target.value)} inputMode="numeric" />
                      <input style={styles.input} placeholder="Charity (optional)" value={newCharity} onChange={(e) => setNewCharity(e.target.value)} />
                      <button style={styles.bigBtn} onClick={addPlayer}>
                        Add Player
                      </button>
                    </div>

                    <div style={styles.hr} />

                    <div style={{ fontWeight: 950, letterSpacing: 0.2 }}>Player List</div>
                    <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                      {players.map((p) => (
                        <div key={p.id} style={styles.playerRow}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
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

        {/* Router fallback */}
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

/** Styles */
const styles = {
  page: {
    minHeight: "100vh",
    padding: 14,
    background: `radial-gradient(circle at 20% 10%, ${PALETTE.teeSand} 0%, ${PALETTE.sandstone} 34%, ${PALETTE.fairwayGreen} 140%)`,
    color: THEME.text,
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
    color: THEME.text,
  },
  brandSub: { marginTop: 6, fontSize: 13, color: THEME.textMuted },

  nav: { display: "flex", gap: 10, flexWrap: "wrap" },
  navBtn: {
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(7,31,19,0.40)",
    border: `1px solid ${THEME.border}`,
    color: THEME.text,
    cursor: "pointer",
    fontWeight: 850,
    backdropFilter: "blur(8px)",
  },
  navBtnActive: {
    padding: "10px 12px",
    borderRadius: 12,
    background: THEME.btnStrong,
    border: `1px solid ${THEME.borderStrong}`,
    color: THEME.text,
    cursor: "pointer",
    fontWeight: 950,
    backdropFilter: "blur(8px)",
  },

  homeCard: {
    background: THEME.surfaceSoft,
    border: `1px solid ${THEME.border}`,
    borderRadius: 22,
    padding: 18,
    backdropFilter: "blur(14px)",
    boxShadow: "0 18px 55px rgba(7,31,19,0.35)",
  },
  homeTitle: {
    marginTop: 10,
    fontSize: 38,
    fontWeight: 950,
    letterSpacing: -0.6,
    color: THEME.text,
    fontFamily: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  },
  homeSub: {
    marginTop: 10,
    fontSize: 13,
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: THEME.textMuted,
  },
  homeRule: {
    margin: "16px auto 0",
    width: "72%",
    height: 1,
    background: "rgba(242,235,221,0.32)",
  },

  card: {
    background: THEME.surface,
    border: `1px solid ${THEME.border}`,
    borderRadius: 18,
    padding: 16,
    backdropFilter: "blur(12px)",
    boxShadow: "0 16px 48px rgba(7,31,19,0.35)",
  },
  cardHeaderRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: 950,
    letterSpacing: -0.2,
    color: THEME.text,
    fontFamily: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  },
  helpText: { marginTop: 10, fontSize: 12, lineHeight: 1.35, color: THEME.textMuted },

  bigBtn: {
    padding: "14px 14px",
    borderRadius: 16,
    background: THEME.btn,
    border: `1px solid ${THEME.btnBorder}`,
    color: THEME.text,
    cursor: "pointer",
    fontWeight: 950,
    fontSize: 16,
    letterSpacing: 0.2,
  },
  smallBtn: {
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(242,235,221,0.08)",
    border: `1px solid ${THEME.border}`,
    color: THEME.text,
    cursor: "pointer",
    fontWeight: 900,
    letterSpacing: 0.2,
  },
  dangerBtn: {
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(153,75,62,0.16)",
    border: "1px solid rgba(153,75,62,0.40)",
    color: THEME.text,
    cursor: "pointer",
    fontWeight: 950,
    letterSpacing: 0.2,
  },

  label: { display: "grid", gap: 6, fontSize: 12, color: THEME.textMuted },

  input: {
    background: "rgba(7,31,19,0.34)",
    border: `1px solid ${THEME.border}`,
    color: THEME.text,
    padding: "12px 12px",
    borderRadius: 12,
    outline: "none",
    fontSize: 14,
  },

  tableWrap: {
    marginTop: 12,
    overflowX: "auto",
    borderRadius: 14,
    border: `1px solid ${THEME.border}`,
    background: "rgba(7,31,19,0.20)",
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
    background: "rgba(203,189,151,0.10)",
    borderBottom: `1px solid ${THEME.border}`,
    whiteSpace: "nowrap",
    color: THEME.text,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  td: {
    padding: "10px 10px",
    borderBottom: `1px solid ${THEME.border}`,
    fontSize: 14,
    verticalAlign: "top",
    whiteSpace: "nowrap",
    color: THEME.text,
  },

  playerLink: {
    background: "transparent",
    border: "none",
    color: THEME.text,
    cursor: "pointer",
    textDecoration: "underline",
    fontWeight: 950,
    padding: 0,
    fontSize: 15,
    textAlign: "left",
    textUnderlineOffset: 3,
    textDecorationColor: "rgba(242,235,221,0.45)",
  },
  playerMeta: { marginTop: 4, fontSize: 12, color: THEME.textMuted, whiteSpace: "normal" },

  pill: {
    display: "inline-block",
    minWidth: 28,
    padding: "4px 10px",
    borderRadius: 999,
    background: "rgba(203,189,151,0.14)",
    border: `1px solid ${THEME.border}`,
    fontWeight: 950,
    fontSize: 12,
    color: THEME.text,
  },

  strokePill: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 950,
    background: "rgba(203,189,151,0.18)",
    border: `1px solid ${THEME.border}`,
    color: THEME.text,
  },

  broadcastItem: {
    padding: 12,
    borderRadius: 14,
    border: `1px solid ${THEME.border}`,
    background: "rgba(7,31,19,0.16)",
  },

  adminGrid: {
    marginTop: 14,
    display: "grid",
    gap: 12,
    gridTemplateColumns: "1fr",
  },
  subCard: {
    background: THEME.surfaceUltraSoft,
    border: `1px solid ${THEME.border}`,
    borderRadius: 14,
    padding: 14,
  },
  subTitle: {
    fontWeight: 950,
    marginBottom: 10,
    fontSize: 16,
    color: THEME.text,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  sectionLabel: {
    fontWeight: 950,
    opacity: 0.9,
    color: THEME.text,
    letterSpacing: 0.2,
  },
  hr: { height: 1, background: "rgba(242,235,221,0.16)", margin: "8px 0" },

  playerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    padding: "10px 10px",
    borderRadius: 12,
    background: "rgba(7,31,19,0.18)",
    border: `1px solid ${THEME.border}`,
  },

  foursomeCard: {
    padding: 12,
    borderRadius: 14,
    border: `1px solid ${THEME.border}`,
    background: "rgba(7,31,19,0.16)",
  },

  scoreRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: "10px 10px",
    borderRadius: 14,
    border: `1px solid ${THEME.border}`,
    background: "rgba(7,31,19,0.16)",
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
    background: "rgba(7,31,19,0.72)",
    display: "grid",
    placeItems: "center",
    padding: 14,
    zIndex: 50,
  },
  modalCard: {
    width: "min(920px, 96vw)",
    maxHeight: "86vh",
    overflow: "auto",
    background: "rgba(7,31,19,0.92)",
    border: `1px solid ${THEME.borderStrong}`,
    borderRadius: 18,
    padding: 14,
    boxShadow: "0 22px 70px rgba(7,31,19,0.55)",
  },
  modalHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 10,
    flexWrap: "wrap",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 950,
    lineHeight: 1.1,
    color: THEME.text,
    fontFamily: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  },
  modalSub: { marginTop: 6, fontSize: 13, color: THEME.textMuted },
};

// Wider screens
const media = typeof window !== "undefined" ? window.matchMedia("(min-width: 820px)") : null;
if (media && media.matches) {
  styles.adminGrid.gridTemplateColumns = "1fr 1fr";
}
