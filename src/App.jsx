import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

/** ✅ Supabase via env vars */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Course data (Blue tees, Par 72)
 * Note: Hole 18 yardage uses the bigger number (505) from your scorecard.
 */
const BLUE_YARDS = [
  371, 368, 453, 163, 412, 193, 491, 114, 460,
  414, 193, 493, 220, 400, 513, 416, 369, 505,
];

const PARS = [
  4,4,4,3,4,3,5,3,5,
  4,3,5,3,4,5,4,4,5,
];

// Stroke Index (1 hardest .. 18 easiest) from your scorecard
const STROKE_INDEX = [
  12,10,4,14,2,8,6,18,16,
  9,3,17,13,5,15,1,11,7,
];

/** Helpers */
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

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * True stroke allocation: based on Stroke Index (SI).
 * - If handicap <= 18: player gets 1 stroke on holes whose SI <= handicap
 * - If handicap > 18: player gets 2 strokes on SI <= (hcp-18) and 1 stroke on remaining SI <= 18
 */
function strokesForHole(handicap, strokeIndex) {
  const h = Math.max(0, Math.trunc(Number(handicap) || 0));
  const base = h >= strokeIndex ? 1 : 0;
  const extra = h > 18 && (h - 18) >= strokeIndex ? 1 : 0;
  return base + extra; // 0,1,2
}

function initialsFromName(name) {
  const s = (name || "").trim();
  if (!s) return "";
  if (s.includes(",")) {
    const [last, first] = s.split(",").map((x) => x.trim());
    return `${(first?.[0] || "").toUpperCase()}${(last?.[0] || "").toUpperCase()}`;
  }
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${(parts[0][0] || "").toUpperCase()}${(parts[parts.length - 1][0] || "").toUpperCase()}`;
}

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

/** Printable scorecards (GolfGenius style) */
function PrintableScorecards({ foursomes, foursomePlayers, players }) {
  const membersFor = (fid) => {
    const rows = foursomePlayers
      .filter((fp) => fp.foursome_id === fid)
      .slice()
      .sort((a, b) => (a.seat ?? 99) - (b.seat ?? 99));
    const ps = rows
      .map((r) => players.find((p) => p.id === r.player_id))
      .filter(Boolean);
    return ps.slice(0, 4);
  };

  const frontHoles = [1,2,3,4,5,6,7,8,9];
  const backHoles  = [10,11,12,13,14,15,16,17,18];

  const outYards = sum(BLUE_YARDS.slice(0, 9));
  const inYards  = sum(BLUE_YARDS.slice(9, 18));
  const totalYards = outYards + inYards;

  const outPar = sum(PARS.slice(0, 9));
  const inPar  = sum(PARS.slice(9, 18));
  const totalPar = outPar + inPar;

  return (
    <div className="gg-print">
      {foursomes.map((f) => {
        const members = membersFor(f.id);
        const teeTime = (f.tee_time_text || "").trim();

        return (
          <div key={f.id} className="gg-page">
            <div className="gg-header">
              <div className="gg-left">
                <div className="gg-event">The Ginvitational</div>
                <div className="gg-round">Round 1</div>
              </div>

              <div className="gg-center">
                <div className="gg-club">Manufacturers Golf &amp; Country Club</div>
              </div>

              <div className="gg-right">
                <div className="gg-meta">
                  Blue Tees • Par 72{teeTime ? ` • ${teeTime}` : ""}
                </div>
              </div>
            </div>

            <div className="gg-line">
              <div>Competitor: ____________________</div>
              <div>Marker: ____________________</div>
              <div className="gg-date">
                Scorecard • Group: <b>{f.group_name || "Group"}</b> • Code: <b>{f.code}</b>
              </div>
            </div>

            <div className="gg-grids">
              {/* FRONT 9 */}
              <div className="gg-gridWrap">
                <table className="gg-table">
                  <thead>
                    <tr>
                      <th className="gg-label" />
                      {frontHoles.map((h) => (
                        <th key={h} className="gg-hole">{h}</th>
                      ))}
                      <th className="gg-sum">Out</th>
                    </tr>
                    <tr>
                      <th className="gg-label">BLUE</th>
                      {frontHoles.map((h) => (
                        <th key={h} className="gg-num">{BLUE_YARDS[h - 1]}</th>
                      ))}
                      <th className="gg-num">{outYards}</th>
                    </tr>
                    <tr>
                      <th className="gg-label">PAR</th>
                      {frontHoles.map((h) => (
                        <th key={h} className="gg-num">{PARS[h - 1]}</th>
                      ))}
                      <th className="gg-num">{outPar}</th>
                    </tr>
                    <tr>
                      <th className="gg-label">STROKE INDEX</th>
                      {frontHoles.map((h) => (
                        <th key={h} className="gg-num">{STROKE_INDEX[h - 1]}</th>
                      ))}
                      <th className="gg-num" />
                    </tr>
                  </thead>

                  <tbody>
                    {members.map((p) => {
                      const hcp = Math.max(0, Math.trunc(Number(p.handicap) || 0));
                      return (
                        <tr key={p.id}>
                          <td className="gg-player">
                            {p.name}
                          </td>

                          {frontHoles.map((h) => {
                            const si = STROKE_INDEX[h - 1];
                            const s = strokesForHole(hcp, si);
                            return (
                              <td key={h} className="gg-cell">
                                <span className="gg-dot">{s >= 1 ? "•" : ""}</span>
                                <span className="gg-blank" />
                              </td>
                            );
                          })}

                          <td className="gg-cell gg-sumCell" />
                        </tr>
                      );
                    })}

                    {Array.from({ length: Math.max(0, 4 - members.length) }).map((_, i) => (
                      <tr key={`padf-${i}`}>
                        <td className="gg-player">&nbsp;</td>
                        {frontHoles.map((h) => <td key={h} className="gg-cell" />)}
                        <td className="gg-cell gg-sumCell" />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* BACK 9 */}
              <div className="gg-gridWrap">
                <table className="gg-table">
                  <thead>
                    <tr>
                      <th className="gg-label" />
                      {backHoles.map((h) => (
                        <th key={h} className="gg-hole">{h}</th>
                      ))}
                      <th className="gg-sum">In</th>
                      <th className="gg-sum">Tot</th>
                      <th className="gg-sum">PH</th>
                      <th className="gg-sum">Net</th>
                    </tr>
                    <tr>
                      <th className="gg-label" />
                      {backHoles.map((h) => (
                        <th key={h} className="gg-num">{BLUE_YARDS[h - 1]}</th>
                      ))}
                      <th className="gg-num">{inYards}</th>
                      <th className="gg-num">{totalYards}</th>
                      <th className="gg-num" />
                      <th className="gg-num" />
                    </tr>
                    <tr>
                      <th className="gg-label" />
                      {backHoles.map((h) => (
                        <th key={h} className="gg-num">{PARS[h - 1]}</th>
                      ))}
                      <th className="gg-num">{inPar}</th>
                      <th className="gg-num">{totalPar}</th>
                      <th className="gg-num" />
                      <th className="gg-num" />
                    </tr>
                    <tr>
                      <th className="gg-label" />
                      {backHoles.map((h) => (
                        <th key={h} className="gg-num">{STROKE_INDEX[h - 1]}</th>
                      ))}
                      <th className="gg-num" />
                      <th className="gg-num" />
                      <th className="gg-num" />
                      <th className="gg-num" />
                    </tr>
                  </thead>

                  <tbody>
                    {members.map((p) => {
                      const hcp = Math.max(0, Math.trunc(Number(p.handicap) || 0));
                      const init = initialsFromName(p.name);
                      return (
                        <tr key={p.id}>
                          <td className="gg-player gg-initialsCol">
                            <div className="gg-initials">{init}</div>
                          </td>

                          {backHoles.map((h) => {
                            const si = STROKE_INDEX[h - 1];
                            const s = strokesForHole(hcp, si);
                            return (
                              <td key={h} className="gg-cell">
                                <span className="gg-dot">{s >= 1 ? "•" : ""}</span>
                                <span className="gg-blank" />
                              </td>
                            );
                          })}

                          <td className="gg-cell gg-sumCell" />
                          <td className="gg-cell gg-sumCell" />
                          <td className="gg-cell gg-ph">{hcp}</td>
                          <td className="gg-cell gg-sumCell" />
                        </tr>
                      );
                    })}

                    {Array.from({ length: Math.max(0, 4 - members.length) }).map((_, i) => (
                      <tr key={`padb-${i}`}>
                        <td className="gg-player gg-initialsCol">&nbsp;</td>
                        {backHoles.map((h) => <td key={h} className="gg-cell" />)}
                        <td className="gg-cell gg-sumCell" />
                        <td className="gg-cell gg-sumCell" />
                        <td className="gg-cell gg-ph" />
                        <td className="gg-cell gg-sumCell" />
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="gg-footer">
              <div>Competitor: ____________________</div>
              <div>Marker: ____________________</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("home"); // home | leaderboard | code | enter | admin
  const [status, setStatus] = useState("Loading...");

  const [players, setPlayers] = useState([]);
  const [scores, setScores] = useState([]);

  // Foursomes data
  const [foursomes, setFoursomes] = useState([]);
  const [foursomePlayers, setFoursomePlayers] = useState([]); // id,foursome_id,player_id,seat

  // Leaderboard modal
  const [scorecardPlayerId, setScorecardPlayerId] = useState(null);

  // Admin gate
  const [adminPin, setAdminPin] = useState("");
  const [adminOn, setAdminOn] = useState(false);

  // Admin: add player
  const [newFirst, setNewFirst] = useState("");
  const [newLast, setNewLast] = useState("");
  const [newHandicap, setNewHandicap] = useState("");
  const [newCharity, setNewCharity] = useState("");

  // Admin: manual foursome create
  const [manualGroupName, setManualGroupName] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [manualTeeTime, setManualTeeTime] = useState("");

  // Admin: CSV upload status
  const [csvStatus, setCsvStatus] = useState("");

  // Enter scores: foursome code gate
  const [entryCode, setEntryCode] = useState("");
  const [activeFoursome, setActiveFoursome] = useState(null);
  const [activePlayers, setActivePlayers] = useState([]);

  // Enter scores: hole-by-hole UI
  const [hole, setHole] = useState(1);
  const [holeInputs, setHoleInputs] = useState({}); // {player_id: "4"}

  /** Loads */
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
    // tee_time_text is optional; if your table doesn't have it, Supabase will just ignore it in selects if not present.
    // But if select fails because the column doesn't exist, remove tee_time_text from this select.
    const { data, error } = await supabase
      .from("foursomes")
      .select("id,group_name,code,tee_time_text,created_at")
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
      .select("id,foursome_id,player_id,seat,created_at")
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

  // Auto-refresh leaderboard every minute
  useEffect(() => {
    if (tab !== "leaderboard") return;
    const id = setInterval(async () => {
      await loadPlayers();
      await loadScores();
    }, 60_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  /** Admin */
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
    const first = newFirst.trim();
    const last = newLast.trim();
    const name = `${first} ${last}`.trim();
    const handicap = clampInt(newHandicap, 0);
    const charity = newCharity.trim() || null;

    if (!first || !last) return alert("First + last name required.");

    const { error } = await supabase.from("players").insert({ name, handicap, charity });
    if (error) {
      console.error(error);
      alert("Error adding player.");
      return;
    }

    setNewFirst("");
    setNewLast("");
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
      alert("Error deleting player.");
      return;
    }

    await loadPlayers();
    await loadScores();
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

  async function createManualFoursome() {
    if (!adminOn) return alert("Admin only.");
    const group_name = manualGroupName.trim() || "Group";
    const code = (manualCode.trim() || makeCode()).toUpperCase();
    const tee_time_text = (manualTeeTime || "").trim() || null;

    if (code.length !== 6) return alert("Code must be exactly 6 characters.");

    const payload = { group_name, code };
    if (tee_time_text) payload.tee_time_text = tee_time_text;

    const { error } = await supabase.from("foursomes").insert(payload);
    if (error) {
      console.error(error);
      alert("Error creating foursome (code may already exist).");
      return;
    }

    setManualGroupName("");
    setManualCode("");
    setManualTeeTime("");
    await loadFoursomes();
  }

  async function generateRandomFoursomes() {
    if (!adminOn) return alert("Admin only.");
    if (players.length < 2) return alert("Need at least 2 players.");

    await clearFoursomes();

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
        alert("Error creating foursomes (check RLS/policies).");
        return;
      }

      const fid = fData.id;
      const inserts = groupPlayers.map((p, idx) => ({
        foursome_id: fid,
        player_id: p.id,
        seat: idx + 1,
      }));
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

  function playersInFoursome(fid) {
    const rows = foursomePlayers.filter((fp) => fp.foursome_id === fid);
    const pids = rows.map((x) => x.player_id);
    return players.filter((p) => pids.includes(p.id));
  }

  /** CSV Upload (export from Excel as CSV) */
  function parseCsv(text) {
    // simple CSV parser that supports quoted fields
    const rows = [];
    let i = 0;
    let field = "";
    let row = [];
    let inQuotes = false;

    const pushField = () => {
      row.push(field);
      field = "";
    };

    const pushRow = () => {
      // ignore empty trailing row
      if (row.some((x) => (x || "").trim() !== "")) rows.push(row);
      row = [];
    };

    while (i < text.length) {
      const c = text[i];

      if (inQuotes) {
        if (c === '"') {
          const next = text[i + 1];
          if (next === '"') {
            field += '"';
            i += 2;
            continue;
          } else {
            inQuotes = false;
            i += 1;
            continue;
          }
        } else {
          field += c;
          i += 1;
          continue;
        }
      } else {
        if (c === '"') {
          inQuotes = true;
          i += 1;
          continue;
        }
        if (c === ",") {
          pushField();
          i += 1;
          continue;
        }
        if (c === "\n") {
          pushField();
          pushRow();
          i += 1;
          continue;
        }
        if (c === "\r") {
          i += 1;
          continue;
        }
        field += c;
        i += 1;
      }
    }

    pushField();
    pushRow();
    return rows;
  }

  async function handleCsvFile(file) {
    if (!adminOn) return alert("Admin only.");
    if (!file) return;

    setCsvStatus("Reading CSV...");

    const text = await file.text();
    const rows = parseCsv(text);

    if (!rows.length) {
      setCsvStatus("No rows found.");
      return;
    }

    // Expected header columns:
    // Group, TeeTime, FirstName, LastName, Handicap, Charity
    const header = rows[0].map((x) => (x || "").trim().toLowerCase());
    const colIndex = (name) => header.indexOf(name.toLowerCase());

    const idxGroup = colIndex("group");
    const idxTee = colIndex("teetime");
    const idxFirst = colIndex("firstname");
    const idxLast = colIndex("lastname");
    const idxHcp = colIndex("handicap");
    const idxCharity = colIndex("charity");

    if ([idxGroup, idxFirst, idxLast, idxHcp].some((x) => x === -1)) {
      setCsvStatus("CSV header missing required columns. Need: Group, FirstName, LastName, Handicap (TeeTime/Charity optional).");
      return;
    }

    const dataRows = rows.slice(1);

    // Build group map: groupName -> { teeTime, players[] }
    const groups = new Map();
    for (const r of dataRows) {
      const groupName = (r[idxGroup] || "").trim();
      const first = (r[idxFirst] || "").trim();
      const last = (r[idxLast] || "").trim();
      const handicap = clampInt(r[idxHcp], 0);
      const charity = idxCharity === -1 ? "" : (r[idxCharity] || "").trim();
      const teeTime = idxTee === -1 ? "" : (r[idxTee] || "").trim();

      if (!groupName || !first || !last) continue;

      if (!groups.has(groupName)) groups.set(groupName, { teeTime, players: [] });
      const g = groups.get(groupName);

      if (!g.teeTime && teeTime) g.teeTime = teeTime;

      g.players.push({
        name: `${first} ${last}`.trim(),
        handicap,
        charity: charity || null,
      });
    }

    if (groups.size === 0) {
      setCsvStatus("No valid rows found (check group/name columns).");
      return;
    }

    // Confirm overwrite
    if (!confirm(`This will CLEAR existing foursomes + assignments and ADD players from CSV.\n\nContinue?`)) {
      setCsvStatus("Cancelled.");
      return;
    }

    try {
      setCsvStatus("Clearing foursomes...");
      await clearFoursomes();

      // 1) Insert players (dedupe by exact name)
      setCsvStatus("Creating players...");
      const existingByName = new Map(players.map((p) => [p.name.trim().toLowerCase(), p]));
      const createdPlayers = [];

      for (const [, g] of groups) {
        for (const p of g.players) {
          const key = p.name.trim().toLowerCase();
          if (existingByName.has(key)) continue;

          const { data, error } = await supabase
            .from("players")
            .insert({ name: p.name, handicap: p.handicap, charity: p.charity })
            .select("id,name,handicap,charity")
            .single();

          if (error) {
            console.error(error);
            throw new Error(`Failed to create player: ${p.name}`);
          }

          existingByName.set(key, data);
          createdPlayers.push(data);
        }
      }

      // Refresh players list so ids exist in state
      await loadPlayers();

      // 2) Create foursomes and assignments
      setCsvStatus("Creating groups + assignments...");
      for (const [groupName, g] of groups) {
        const code = makeCode().toUpperCase();
        const payload = { group_name: groupName, code };
        if (g.teeTime) payload.tee_time_text = g.teeTime;

        const { data: fData, error: fErr } = await supabase
          .from("foursomes")
          .insert(payload)
          .select("id")
          .single();

        if (fErr) {
          console.error(fErr);
          throw new Error(`Failed to create group: ${groupName}`);
        }

        const fid = fData.id;

        const groupPlayers = g.players.slice(0, 4); // cap at 4
        const inserts = groupPlayers.map((p, idx) => {
          const found = existingByName.get(p.name.trim().toLowerCase());
          return { foursome_id: fid, player_id: found.id, seat: idx + 1 };
        });

        const { error: aErr } = await supabase.from("foursome_players").insert(inserts);
        if (aErr) {
          console.error(aErr);
          throw new Error(`Failed assignments for group: ${groupName}`);
        }
      }

      await loadFoursomes();
      await loadFoursomePlayers();
      setCsvStatus(`Done ✅ Created ${groups.size} groups.`);
      alert("CSV imported ✅");
    } catch (e) {
      console.error(e);
      setCsvStatus(`Error: ${e.message || "Import failed"}`);
      alert("CSV import failed. Check console + RLS policies.");
    }
  }

  /** Enter scores gate */
  async function enterWithCode() {
    const code = entryCode.trim().toUpperCase();
    if (code.length !== 6) return alert("Enter a 6-character code.");

    const { data: f, error } = await supabase
      .from("foursomes")
      .select("id,group_name,code,tee_time_text")
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

    if (memberPlayers.length === 0) return alert("This foursome has no players assigned yet.");

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
        alert("Error saving scores. Check scores RLS + unique constraint player_id,hole.");
        return;
      }
    }

    await loadScores();
    setHole(nextHole);
  }

  /** Leaderboard - true SI allocation */
  const leaderboardRows = useMemo(() => {
    // last-write-wins per player/hole
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

      // true strokes used based on SI for holes played
      const strokesUsed = playedHoles.reduce((acc, h) => acc + strokesForHole(handicap, STROKE_INDEX[h - 1]), 0);
      const netGross = gross - strokesUsed;
      const netToPar = holesPlayed === 0 ? 9999 : Math.round(netGross - parPlayed);

      return {
        id: p.id,
        name: p.name,
        handicap,
        charity: p.charity,
        holesPlayed,
        gross,
        strokesUsed,
        netToPar,
        scoresByHole,
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

  /** Scorecard modal rows (gross+net+dot) */
  const scorecardRows = useMemo(() => {
    if (!scorecardPlayer) return [];
    const hcp = clampInt(scorecardPlayer.handicap, 0);

    return Array.from({ length: 18 }, (_, i) => {
      const h = i + 1;
      const par = PARS[h - 1];
      const gross = scorecardPlayer.scoresByHole[h];
      const strokes = strokesForHole(hcp, STROKE_INDEX[h - 1]);
      const net = gross != null ? gross - strokes : null;
      const netDiff = net != null ? net - par : null;
      return { h, par, gross, net, netDiff, strokes };
    });
  }, [scorecardPlayer]);

  const scorecardTotals = useMemo(() => {
    if (!scorecardPlayer) return null;
    const played = scorecardRows.filter((r) => r.gross != null);
    const holesPlayed = played.length;
    const gross = played.reduce((a, r) => a + r.gross, 0);
    const strokesUsed = played.reduce((a, r) => a + r.strokes, 0);
    const net = gross - strokesUsed;
    const parPlayed = played.reduce((a, r) => a + r.par, 0);
    const netToPar = holesPlayed ? Math.round(net - parPlayed) : null;
    return { holesPlayed, gross, strokesUsed, net, parPlayed, netToPar };
  }, [scorecardPlayer, scorecardRows]);

  /** Print */
  function printScorecards() {
    window.print();
  }

  return (
    <div style={styles.page}>
      <style>{`
        @page { size: letter landscape; margin: 0.35in; }

        @media print {
          #app-shell { display: none !important; }
          #print-root { display: block !important; }
          body { background: #fff !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .gg-page { page-break-after: always; }
          .gg-page:last-child { page-break-after: auto; }
        }

        .gg-print { font-family: Arial, Helvetica, sans-serif; color: #111; }
        .gg-page { background: #fff; }

        .gg-header {
          display: grid;
          grid-template-columns: 1fr 2fr 1fr;
          align-items: end;
          gap: 8px;
          margin-bottom: 6px;
        }
        .gg-event { font-weight: 800; font-size: 14px; }
        .gg-round { font-size: 11px; margin-top: 2px; }
        .gg-club { text-align: center; font-weight: 800; font-size: 13px; }
        .gg-meta { text-align: right; font-size: 11px; }

        .gg-line {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 10px;
          font-size: 11px;
          margin-bottom: 8px;
        }
        .gg-date { text-align: right; }

        .gg-grids {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
          align-items: start;
        }

        .gg-table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
          border: 1px solid #333;
          font-size: 11px;
        }
        .gg-table th, .gg-table td {
          border: 1px solid #777;
          padding: 3px 4px;
          vertical-align: middle;
        }

        .gg-label {
          width: 190px;
          text-align: left;
          font-weight: 700;
          background: #fff;
        }

        .gg-hole { text-align: center; font-weight: 800; width: 30px; }
        .gg-num  { text-align: center; font-weight: 700; }
        .gg-sum  { text-align: center; font-weight: 800; width: 44px; }
        .gg-sumCell { width: 44px; }

        .gg-player {
          font-weight: 700;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .gg-initialsCol { width: 70px; }
        .gg-initials { font-weight: 800; letter-spacing: 0.5px; }

        .gg-cell { height: 22px; position: relative; }
        .gg-dot {
          position: absolute;
          left: 4px;
          top: 2px;
          font-weight: 900;
          font-size: 14px;
          line-height: 1;
        }

        .gg-blank { display: block; height: 100%; width: 100%; }
        .gg-ph { width: 44px; text-align: center; font-weight: 800; }

        .gg-footer {
          margin-top: 10px;
          display: flex;
          justify-content: space-between;
          font-size: 11px;
        }
      `}</style>

      {/* PRINT ROOT (hidden on screen, shown in print) */}
      <div id="print-root" style={{ display: "none" }}>
        <PrintableScorecards
          foursomes={foursomes}
          foursomePlayers={foursomePlayers}
          players={players}
        />
      </div>

      {/* APP SHELL (hidden during print) */}
      <div id="app-shell" style={styles.shell}>
        {/* Scorecard modal */}
        {scorecardPlayer && (
          <div style={styles.modalOverlay} onClick={() => setScorecardPlayerId(null)}>
            <div style={styles.modalCard} onClick={(e) => e.stopPropagation()}>
              <div style={styles.modalHeader}>
                <div style={{ minWidth: 0 }}>
                  <div style={styles.modalTitle}>
                    {scorecardPlayer.name} <span style={{ opacity: 0.7 }}>(HCP {scorecardPlayer.handicap})</span>
                  </div>
                  {scorecardTotals?.holesPlayed ? (
                    <div style={styles.modalSub}>
                      Holes: {scorecardTotals.holesPlayed} • HCP strokes used: {scorecardTotals.strokesUsed} • Net vs Par:{" "}
                      <span style={{ fontWeight: 900, ...netColorStyle(scorecardTotals.netToPar) }}>
                        {formatToPar(scorecardTotals.netToPar)}
                      </span>
                    </div>
                  ) : (
                    <div style={styles.modalSub}>No scores yet.</div>
                  )}
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
                      <th style={styles.th}>Gross</th>
                      <th style={styles.th}>Net</th>
                      <th style={styles.th}>Net +/-</th>
                    </tr>
                  </thead>

                  <tbody>
                    {scorecardRows.map((r) => {
                      const diffStyle =
                        r.netDiff == null
                          ? {}
                          : r.netDiff < 0
                          ? { color: "#16a34a", fontWeight: 900 }
                          : r.netDiff > 0
                          ? { color: "#dc2626", fontWeight: 900 }
                          : { opacity: 0.9, fontWeight: 900 };

                      return (
                        <tr key={r.h}>
                          <td style={styles.td}>
                            {r.h}{" "}
                            {r.strokes > 0 ? (
                              <span title={`Gets ${r.strokes} stroke(s) here`} style={{ fontWeight: 900 }}>
                                ●
                              </span>
                            ) : null}
                          </td>
                          <td style={styles.td}>{r.par}</td>
                          <td style={styles.td}>{r.gross != null ? r.gross : "—"}</td>
                          <td style={styles.td}>{r.net != null ? r.net : "—"}</td>
                          <td style={{ ...styles.td, ...diffStyle }}>
                            {r.netDiff == null ? "—" : formatToPar(r.netDiff)}
                          </td>
                        </tr>
                      );
                    })}

                    {/* Aggregate net +/- row */}
                    <tr>
                      <td style={{ ...styles.td, fontWeight: 950 }} colSpan={4}>
                        Total Net +/-
                      </td>
                      <td style={{ ...styles.td, fontWeight: 950, ...(scorecardTotals?.netToPar != null ? netColorStyle(scorecardTotals.netToPar) : {}) }}>
                        {scorecardTotals?.netToPar == null ? "—" : formatToPar(scorecardTotals.netToPar)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
                Dots (●) mark holes where handicap strokes apply using Stroke Index allocation.
              </div>
            </div>
          </div>
        )}

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
                  Simple front-end PIN gate.
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

                  <button style={styles.smallBtn} onClick={printScorecards}>
                    🖨️ Print Scorecards
                  </button>

                  <button style={styles.dangerBtn} onClick={clearFoursomes}>
                    Clear Foursomes
                  </button>
                </div>

                <div style={styles.adminGrid}>
                  {/* Tournament Setup */}
                  <div style={styles.subCard}>
                    <div style={styles.subTitle}>Tournament Setup (Excel → CSV Upload)</div>

                    <div style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.35 }}>
                      Export your Excel sheet as <b>CSV</b> with columns:
                      <div style={{ marginTop: 6, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                        Group, TeeTime, FirstName, LastName, Handicap, Charity
                      </div>
                      <div style={{ marginTop: 6 }}>
                        Import will <b>clear existing foursomes + assignments</b> and create groups + players.
                      </div>
                    </div>

                    <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                      <input
                        style={styles.input}
                        type="file"
                        accept=".csv,text/csv"
                        onChange={(e) => handleCsvFile(e.target.files?.[0] || null)}
                      />
                      {csvStatus ? <div style={{ fontSize: 12, opacity: 0.9 }}>{csvStatus}</div> : null}
                    </div>

                    <div style={{ height: 1, background: "rgba(255,255,255,0.10)", margin: "12px 0" }} />

                    <button style={styles.bigBtn} onClick={generateRandomFoursomes}>
                      🧩 Generate Foursomes (Random)
                    </button>
                  </div>

                  {/* Foursomes */}
                  <div style={styles.subCard}>
                    <div style={styles.subTitle}>Foursomes</div>

                    <div style={{ display: "grid", gap: 10 }}>
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
                        <input
                          style={styles.input}
                          placeholder="Tee time (optional, e.g. 9:12 AM)"
                          value={manualTeeTime}
                          onChange={(e) => setManualTeeTime(e.target.value)}
                        />
                        <button style={styles.smallBtn} onClick={createManualFoursome}>
                          Create Foursome
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
                                    {f.group_name || "Group"}{" "}
                                    <span style={{ opacity: 0.75, fontWeight: 800 }}>
                                      (Code: {f.code})
                                    </span>
                                  </div>
                                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                                    Members: {members.length}{f.tee_time_text ? ` • Tee: ${f.tee_time_text}` : ""}
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
                      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                        <input
                          style={styles.input}
                          placeholder="First name"
                          value={newFirst}
                          onChange={(e) => setNewFirst(e.target.value)}
                        />
                        <input
                          style={styles.input}
                          placeholder="Last name"
                          value={newLast}
                          onChange={(e) => setNewLast(e.target.value)}
                        />
                      </div>
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

        {/* Safety fallback */}
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
    width: "min(920px, 96vw)",
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

// Wider screens
const media = typeof window !== "undefined" ? window.matchMedia("(min-width: 820px)") : null;
if (media && media.matches) {
  styles.adminGrid.gridTemplateColumns = "1fr 1fr";
}
