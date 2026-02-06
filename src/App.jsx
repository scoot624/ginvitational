// App.jsx
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";

/** ✅ Supabase via env vars */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** ✅ Excel columns we expect (FOURSOME everywhere) */
const REQUIRED_COLUMNS = [
  "foursome",
  "tee_time",
  "first_name",
  "last_name",
  "handicap",
  "charity",
];

/** ---------------------------
 * Helpers
 * -------------------------- */
function normalizeHeader(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

/** Convert Excel cell into "HH:MM" (24h) for Postgres TIME */
function toTimeString(value) {
  if (value == null || value === "") return null;

  // Already a string time like "9:10" or "09:10"
  if (typeof value === "string") {
    const s = value.trim();
    const m = s.match(/^(\d{1,2}):(\d{2})/);
    if (m) return `${String(m[1]).padStart(2, "0")}:${m[2]}`;
    return s;
  }

  // Excel can parse times as Date
  if (value instanceof Date) {
    const hh = String(value.getHours()).padStart(2, "0");
    const mm = String(value.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  // Excel can store time as fraction of day (0.5 = 12:00)
  if (typeof value === "number" && Number.isFinite(value)) {
    const totalMinutes = Math.round(value * 24 * 60);
    const hh = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
    const mm = String(totalMinutes % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  return null;
}

function safeInt(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function keyFoursome(name, tee_time) {
  return `${String(name)}__${String(tee_time)}`;
}

function keyPlayer(fn, ln) {
  return `${String(fn)}__${String(ln)}`.toLowerCase();
}

/** ---------------------------
 * Minimal UI Components
 * -------------------------- */
function TopBar({ view, setView }) {
  const btn = (id, label) => (
    <button
      onClick={() => setView(id)}
      style={{
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid rgba(0,0,0,0.12)",
        background: view === id ? "rgba(0,0,0,0.06)" : "white",
        cursor: "pointer",
        fontWeight: 600,
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 14,
      }}
    >
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <div style={{ fontWeight: 900, letterSpacing: 0.2 }}>Ginvitational</div>
        <div style={{ opacity: 0.55, fontSize: 12 }}>Foursomes schema</div>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        {btn("home", "Home")}
        {btn("tee-sheet", "Tee Sheet")}
        {btn("admin", "Admin")}
      </div>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div
      style={{
        background: "white",
        border: "1px solid rgba(0,0,0,0.12)",
        borderRadius: 18,
        padding: 16,
        boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
      }}
    >
      {title ? (
        <div style={{ fontWeight: 800, marginBottom: 10 }}>{title}</div>
      ) : null}
      {children}
    </div>
  );
}

/** ---------------------------
 * Views
 * -------------------------- */
function HomeView() {
  return (
    <Card title="Home">
      <div style={{ lineHeight: 1.5 }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>
          Admin is now “Excel Upload Only”
        </div>
        <div style={{ opacity: 0.75 }}>
          Upload one spreadsheet to create all players + foursomes + tee times.
        </div>
        <div style={{ marginTop: 10, fontSize: 12, opacity: 0.65 }}>
          Excel columns: <code>{REQUIRED_COLUMNS.join(", ")}</code>
        </div>
      </div>
    </Card>
  );
}

function TeeSheetView() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr("");
      try {
        // Pull foursomes + linked players
        const { data: foursomes, error: fErr } = await supabase
          .from("foursomes")
          .select("id,name,tee_time")
          .order("tee_time", { ascending: true })
          .order("name", { ascending: true });

        if (fErr) throw fErr;

        const { data: links, error: lErr } = await supabase
          .from("foursome_players")
          .select("foursome_id, player_id");

        if (lErr) throw lErr;

        const playerIds = Array.from(new Set((links || []).map((x) => x.player_id)));
        let playersById = new Map();

        if (playerIds.length) {
          const { data: players, error: pErr } = await supabase
            .from("players")
            .select("id,first_name,last_name,handicap,charity")
            .in("id", playerIds);

          if (pErr) throw pErr;

          playersById = new Map((players || []).map((p) => [p.id, p]));
        }

        const playerIdsByFoursome = new Map();
        for (const l of links || []) {
          if (!playerIdsByFoursome.has(l.foursome_id)) playerIdsByFoursome.set(l.foursome_id, []);
          playerIdsByFoursome.get(l.foursome_id).push(l.player_id);
        }

        const built = (foursomes || []).map((f) => {
          const pids = playerIdsByFoursome.get(f.id) || [];
          const players = pids
            .map((pid) => playersById.get(pid))
            .filter(Boolean)
            .sort((a, b) => (a.last_name || "").localeCompare(b.last_name || ""));
          return { ...f, players };
        });

        if (alive) setRows(built);
      } catch (e) {
        console.error(e);
        if (alive) setErr(e?.message || "Failed to load tee sheet.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Card title="Tee Sheet">
      {loading ? (
        <div>Loading…</div>
      ) : err ? (
        <div style={{ color: "crimson", whiteSpace: "pre-wrap" }}>{err}</div>
      ) : rows.length === 0 ? (
        <div style={{ opacity: 0.75 }}>
          No foursomes found yet. Go to <b>Admin</b> and upload your Excel tee sheet.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {rows.map((f) => (
            <div
              key={f.id}
              style={{
                border: "1px solid rgba(0,0,0,0.10)",
                borderRadius: 16,
                padding: 12,
                background: "rgba(0,0,0,0.02)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontWeight: 900 }}>{f.name}</div>
                <div style={{ fontWeight: 800, opacity: 0.75 }}>{String(f.tee_time).slice(0, 5)}</div>
              </div>
              <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                {f.players.length ? (
                  f.players.map((p) => (
                    <div
                      key={p.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 10,
                        padding: "8px 10px",
                        borderRadius: 12,
                        background: "white",
                        border: "1px solid rgba(0,0,0,0.08)",
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>
                        {p.first_name} {p.last_name}
                        {p.charity ? (
                          <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.65 }}>
                            ({p.charity})
                          </span>
                        ) : null}
                      </div>
                      <div style={{ fontWeight: 800, opacity: 0.8 }}>
                        {p.handicap == null ? "—" : p.handicap}
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ opacity: 0.7, fontSize: 13 }}>No players linked.</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function AdminView() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState(null);

  const exampleText = useMemo(
    () => `foursome | tee_time | first_name | last_name | handicap | charity`,
    []
  );

  async function parseExcel(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];

    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
    if (!raw.length) throw new Error("Sheet is empty.");

    const headerRow = raw[0].map(normalizeHeader);
    const missing = REQUIRED_COLUMNS.filter((c) => !headerRow.includes(c));
    if (missing.length) {
      throw new Error(`Missing required columns: ${missing.join(", ")}`);
    }

    const rows = raw
      .slice(1)
      .filter((r) => r.some((cell) => String(cell).trim() !== ""))
      .map((r) => {
        const obj = {};
        headerRow.forEach((h, idx) => (obj[h] = r[idx]));
        return obj;
      })
      .map((r) => ({
        foursome: String(r.foursome).trim(),
        tee_time: toTimeString(r.tee_time),
        first_name: String(r.first_name).trim(),
        last_name: String(r.last_name).trim(),
        handicap: safeInt(r.handicap),
        charity: String(r.charity || "").trim() || null,
      }));

    const bad = rows.find(
      (r) => !r.foursome || !r.tee_time || !r.first_name || !r.last_name
    );
    if (bad) {
      throw new Error(
        `Bad row found. Required: foursome, tee_time, first_name, last_name.\nExample bad row: ${JSON.stringify(
          bad
        )}`
      );
    }

    return rows;
  }

  async function ensureTables() {
    // Optional safety check: not creating tables here (Supabase client can’t run DDL easily)
    // This exists to give a clearer error if tables are missing.
    const checks = [
      supabase.from("players").select("id").limit(1),
      supabase.from("foursomes").select("id").limit(1),
      supabase.from("foursome_players").select("foursome_id").limit(1),
    ];
    const results = await Promise.all(checks);
    for (const r of results) {
      if (r.error) throw r.error;
    }
  }

  async function upload(rows) {
    setBusy(true);
    setStatus("Checking tables…");
    await ensureTables();

    setStatus(`Parsed ${rows.length} rows. Upserting foursomes…`);

    // 1) Upsert foursomes (unique on name+tee_time)
    const foursomesToUpsert = Array.from(
      new Map(
        rows.map((r) => [
          keyFoursome(r.foursome, r.tee_time),
          { name: r.foursome, tee_time: r.tee_time },
        ])
      ).values()
    );

    const { data: foursomes, error: fErr } = await supabase
      .from("foursomes")
      .upsert(foursomesToUpsert, { onConflict: "name,tee_time" })
      .select("id,name,tee_time");

    if (fErr) throw fErr;

    const foursomeIdByKey = new Map(
      (foursomes || []).map((f) => [keyFoursome(f.name, String(f.tee_time).slice(0, 5)), f.id])
    );

    // 2) Insert players (we insert every time; if you want de-dupe/upsert, tell me)
    setStatus("Inserting players…");

    const { data: insertedPlayers, error: pErr } = await supabase
      .from("players")
      .insert(
        rows.map((r) => ({
          first_name: r.first_name,
          last_name: r.last_name,
          handicap: r.handicap,
          charity: r.charity,
        }))
      )
      .select("id,first_name,last_name");

    if (pErr) throw pErr;

    const playerIdByName = new Map(
      (insertedPlayers || []).map((p) => [keyPlayer(p.first_name, p.last_name), p.id])
    );

    // 3) Link players to foursomes
    setStatus("Linking players to foursomes…");

    const links = rows.map((r) => {
      const fKey = keyFoursome(r.foursome, r.tee_time);
      // tee_time from DB might include seconds; normalize to HH:MM for key match
      // We built the map with slice(0,5) above, so do the same here:
      const fId =
        foursomeIdByKey.get(keyFoursome(r.foursome, String(r.tee_time).slice(0, 5))) ||
        foursomeIdByKey.get(fKey);

      const pId = playerIdByName.get(keyPlayer(r.first_name, r.last_name));

      return { foursome_id: fId, player_id: pId };
    });

    const missingLink = links.find((l) => !l.foursome_id || !l.player_id);
    if (missingLink) {
      throw new Error(
        `Linking failed (missing id). This usually means duplicate names or a tee_time mismatch.\nExample: ${JSON.stringify(
          missingLink
        )}`
      );
    }

    const { error: lErr } = await supabase.from("foursome_players").insert(links);
    if (lErr) throw lErr;

    setStatus(
      `✅ Done. Upserted ${foursomesToUpsert.length} foursomes and uploaded ${rows.length} players.`
    );
  }

  async function handleFile(file) {
    setStatus("");
    setPreview(null);
    try {
      setBusy(true);
      setStatus("Reading Excel…");
      const rows = await parseExcel(file);
      setPreview(rows.slice(0, 12));
      await upload(rows);
    } catch (e) {
      console.error(e);
      setStatus(`❌ ${e?.message || "Upload failed"}`);
    } finally {
      setBusy(false);
    }
  }

  // Optional: “wipe tournament” helpers (kept here because you asked for Excel-only setup)
  async function wipeTournament() {
    if (!confirm("This will delete ALL foursomes + links (players stay). Continue?")) return;
    try {
      setBusy(true);
      setStatus("Deleting foursome links…");
      const { error: a } = await supabase.from("foursome_players").delete().neq("foursome_id", "00000000-0000-0000-0000-000000000000");
      if (a) throw a;

      setStatus("Deleting foursomes…");
      const { error: b } = await supabase.from("foursomes").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (b) throw b;

      setStatus("✅ Tournament wiped (players left intact).");
    } catch (e) {
      console.error(e);
      setStatus(`❌ ${e?.message || "Wipe failed"}`);
    } finally {
      setBusy(false);
    }
  }

  async function wipePlayers() {
    if (!confirm("This will delete ALL players + links. Continue?")) return;
    try {
      setBusy(true);
      setStatus("Deleting links…");
      const { error: a } = await supabase.from("foursome_players").delete().neq("foursome_id", "00000000-0000-0000-0000-000000000000");
      if (a) throw a;

      setStatus("Deleting players…");
      const { error: b } = await supabase.from("players").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (b) throw b;

      setStatus("✅ Players wiped.");
    } catch (e) {
      console.error(e);
      setStatus(`❌ ${e?.message || "Wipe failed"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Admin: Upload Tee Sheet (Excel Only)">
      <div style={{ lineHeight: 1.55 }}>
        <div style={{ opacity: 0.8 }}>
          Upload an Excel file with columns:
        </div>
        <div style={{ marginTop: 6 }}>
          <code style={{ padding: "6px 8px", borderRadius: 10, background: "rgba(0,0,0,0.04)" }}>
            {exampleText}
          </code>
        </div>

        <div style={{ marginTop: 14, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <label
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,0.12)",
              background: busy ? "rgba(0,0,0,0.05)" : "white",
              cursor: busy ? "not-allowed" : "pointer",
              fontWeight: 700,
            }}
          >
            {busy ? "Working…" : "Choose Excel File"}
            <input
              type="file"
              accept=".xlsx,.xls"
              disabled={busy}
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />
          </label>

          <button
            onClick={wipeTournament}
            disabled={busy}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,0.12)",
              background: "white",
              cursor: busy ? "not-allowed" : "pointer",
              fontWeight: 700,
            }}
            title="Deletes foursomes + links (players remain)"
          >
            Wipe Tournament
          </button>

          <button
            onClick={wipePlayers}
            disabled={busy}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,0.12)",
              background: "white",
              cursor: busy ? "not-allowed" : "pointer",
              fontWeight: 700,
            }}
            title="Deletes ALL players + links"
          >
            Wipe Players
          </button>
        </div>

        <div style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>
          {status ? status : <span style={{ opacity: 0.65 }}>No file uploaded yet.</span>}
        </div>

        {preview?.length ? (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Preview (first {preview.length} rows)</div>
            <div style={{ display: "grid", gap: 8 }}>
              {preview.map((r, idx) => (
                <div
                  key={idx}
                  style={{
                    border: "1px solid rgba(0,0,0,0.10)",
                    borderRadius: 12,
                    background: "rgba(0,0,0,0.02)",
                    padding: 10,
                    fontSize: 13,
                  }}
                >
                  <div style={{ fontWeight: 800 }}>
                    {r.first_name} {r.last_name}{" "}
                    <span style={{ opacity: 0.65 }}>
                      (hcp {r.handicap ?? "—"})
                    </span>
                  </div>
                  <div style={{ opacity: 0.75 }}>
                    Foursome: <b>{r.foursome}</b> • Tee time: <b>{r.tee_time}</b>
                    {r.charity ? <> • Charity: <b>{r.charity}</b></> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/** ---------------------------
 * App
 * -------------------------- */
export default function App() {
  const [view, setView] = useState("home");

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: 18,
        background:
          "radial-gradient(1200px 800px at 50% 20%, #ffffff 0%, #fbf4e6 55%, #f3e2c6 100%)",
        color: "#1a1a1a",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <TopBar view={view} setView={setView} />

        {view === "home" ? <HomeView /> : null}
        {view === "tee-sheet" ? <TeeSheetView /> : null}
        {view === "admin" ? <AdminView /> : null}

        <div style={{ marginTop: 14, fontSize: 12, opacity: 0.6 }}>
          Tip: If the Admin upload says tables are missing, create:{" "}
          <code>players</code>, <code>foursomes</code>, <code>foursome_players</code> in Supabase first.
        </div>
      </div>
    </div>
  );
}
