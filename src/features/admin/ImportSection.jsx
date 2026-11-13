import { useState } from "react";
import { AdminSection } from "../../components/AdminSection";
import { runTeeSheetImport } from "../import/runTeeSheetImport";
import { useEventDataContext } from "../../hooks/eventDataContext";
import { fullNameFromRow, normKey } from "../../lib/teeSheet";
import { THEME, styles } from "../../theme";

// Admin → Import Tee Sheet: upload the Excel sheet and import players, groups and tee times.

export function ImportSection({ adminOn, openAdminSection, setOpenAdminSection }) {
  const {
    players,
    appSettings,
    rounds,
    foursomes,
    initialLoad,
    activeRound,
  } = useEventDataContext();

  // Admin: Excel import (tee sheet)
  const [teeSheetFile, setTeeSheetFile] = useState(null);

  const [teeSheetRows, setTeeSheetRows] = useState([]);

  const [importReplaceFoursomes, setImportReplaceFoursomes] = useState(true);

  const [importMsg, setImportMsg] = useState("");

  const [importRoundId, setImportRoundId] = useState(null);

async function parseTeeSheetFile(file) {
  setImportMsg("");
  setTeeSheetFile(file);

  if (!file) {
    setTeeSheetRows([]);
    return;
  }

  try {
    // Loaded on demand — the Excel library is only needed here, during an
    // Admin import, so nobody else has to download it just to open the app.
    const XLSX = await import("xlsx");
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

    // Require these columns (matches your sheet)
    const required = ["team", "tee_time", "starting_hole", "first_name", "last_name"];
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

  const targetRoundId = appSettings.multi_round_enabled ? importRoundId || activeRound?.id : activeRound?.id;
  if (!targetRoundId) {
    setImportMsg("No round to import into yet — reload the page and try again.");
    return;
  }

  setImportMsg("Importing…");
  await runTeeSheetImport({ foursomes, initialLoad }, teeSheetRows, { replace: importReplaceFoursomes, targetRoundId, say: setImportMsg });
}

  return (
          <AdminSection
            title="Import Tee Sheet"
            subtitle={players.length > 0 ? `${players.length} players imported` : "No import yet"}
            open={openAdminSection === "import"}
            onToggle={() => setOpenAdminSection((k) => (k === "import" ? null : "import"))}
          >

            {/* gridTemplateColumns: minmax(0,1fr) instead of the implicit
                default column — a grid track otherwise sizes to the widest
                child's min-content (e.g. the preview table below), which
                stretches every other field in this grid along with it. */}
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1fr)" }}>
              {appSettings.multi_round_enabled && (
                <label style={styles.label}>
                  Round
                  <select
                    style={styles.input}
                    value={importRoundId || activeRound?.id || ""}
                    onChange={(e) => setImportRoundId(e.target.value)}
                  >
                    {rounds.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                        {r.is_active ? " (active)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div style={{ display: "grid", gap: 6 }}>
                <a
                  href={`${import.meta.env.BASE_URL}Ginvitational_TeeSheet_Template.xlsx`}
                  download="Ginvitational_TeeSheet_Template.xlsx"
                  style={{ ...styles.smallBtn, minHeight: 44, boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", textDecoration: "none" }}
                >
                  ⬇ Download Excel template
                </a>
                <div style={styles.helpText}>
                  Fill in the first sheet (one row per player), then choose the file below. The second sheet explains each column.
                </div>
              </div>

              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => parseTeeSheetFile(e.target.files?.[0] || null)}
              />

              <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, color: THEME.textMuted }}>
                <input
                  type="checkbox"
                  checked={importReplaceFoursomes}
                  onChange={(e) => setImportReplaceFoursomes(e.target.checked)}
                />
                Replace existing foursomes + assignments first (recommended)
              </label>

              <button style={styles.bigBtn} onClick={importFromTeeSheet}>
                Import Tee Sheet
              </button>

              {importMsg ? <div style={styles.helpText}>{importMsg}</div> : null}

              {teeSheetRows.length > 0 && (
                <div style={{ fontSize: 12, color: THEME.textMuted, minWidth: 0 }}>
                  Preview (first 5 of {teeSheetRows.length} rows):
                  <div style={{ marginTop: 8, overflowX: "auto" }}>
                    <table style={styles.table}>
                      <thead>
                        <tr>
                          <th style={styles.th}>Team</th>
                          <th style={styles.th}>Tee</th>
                          <th style={styles.th}>Hole</th>
                          <th style={styles.th}>Name</th>
                          <th style={styles.th}>HCP</th>
                          <th style={styles.th}>Charity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {teeSheetRows.slice(0, 5).map((r, i) => (
                          <tr key={i}>
                            <td style={styles.td}>{r.team || "—"}</td>
                            <td style={styles.td}>{r.tee_time || "—"}</td>
                            <td style={styles.td}>{r.starting_hole || "—"}</td>
                            <td style={styles.td}>{fullNameFromRow(r) || "—"}</td>
                            <td style={styles.td}>{r.handicap ?? "—"}</td>
                            <td style={styles.td}>{r.charity || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {teeSheetFile ? (
                <div style={{ fontSize: 12, color: THEME.textMuted }}>
                  File: <b>{teeSheetFile.name}</b>
                </div>
              ) : null}
            </div>
          </AdminSection>
  );
}
