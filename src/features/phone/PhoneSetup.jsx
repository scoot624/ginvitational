// Build on my phone: a three-step tournament setup (Players, Groups, Review & Start).

import { useEffect, useMemo, useRef, useState } from "react";
import { buildPhoneGroups, formatTeeTime, phoneDraftToSheetRows, phoneSlot } from "../../lib/teeSheet";
import { THEME, styles, timeInputFix } from "../../theme";

const PHONE_DRAFT_KEY = "ginv_phone_setup_draft_v1";

const PHONE_DEFAULT_SETTINGS = { firstTee: "08:00", gapMin: 10, size: 4, shotgun: false };

function loadPhoneDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(PHONE_DRAFT_KEY) || "null");
    if (!d || !Array.isArray(d.players) || !Array.isArray(d.groups)) return null;
    return d;
  } catch {
    return null;
  }
}

function savePhoneDraft(draft) {
  try {
    if (draft) localStorage.setItem(PHONE_DRAFT_KEY, JSON.stringify(draft));
    else localStorage.removeItem(PHONE_DRAFT_KEY);
  } catch {
    /* private window / blocked storage — the flow still works, it just can't resume */
  }
}

/**
 * "Build on my phone" — the second way to start a tournament. Three short
 * steps (Players → Groups → Review & Start) that end in the exact same
 * records as the Excel import: it hands rows in the sheet's shape to the one
 * shared writer (`onStart` = runTeeSheetImport).
 */
export function PhoneSetup({
  eventName,
  onSaveEventName,
  rounds,
  multiRound,
  activeRound,
  foursomes,
  onStart,
  onExit,
  onGoto,
}) {
  const saved = useMemo(() => loadPhoneDraft(), []);
  const [step, setStep] = useState(saved?.step || 1);
  const [people, setPeople] = useState(saved?.players || []);
  const [groups, setGroups] = useState(saved?.groups || []);
  const [groupsFor, setGroupsFor] = useState(saved?.groupsFor || "");
  const [settings, setSettings] = useState({ ...PHONE_DEFAULT_SETTINGS, ...(saved?.settings || {}) });
  const [nameDraft, setNameDraft] = useState(saved?.nameDraft ?? eventName);
  const [roundId, setRoundId] = useState(saved?.roundId || "");
  const [replace, setReplace] = useState(true);

  // Step 1 form
  const [fName, setFName] = useState("");
  const [fHcp, setFHcp] = useState("");
  const [fPlus, setFPlus] = useState(false);
  const [fCharity, setFCharity] = useState("");
  const [editId, setEditId] = useState(null);
  const [formErr, setFormErr] = useState("");
  const nameRef = useRef(null);

  // Step 2
  const [sel, setSel] = useState(null); // { gi, pid }
  const [notice, setNotice] = useState("");

  // Step 3 / done
  const [busy, setBusy] = useState(false);
  const [startMsg, setStartMsg] = useState("");
  const [done, setDone] = useState(null); // { roundId, names, playerCount }
  const [shareMsg, setShareMsg] = useState("");

  const targetRoundId = multiRound ? roundId || activeRound?.id || "" : activeRound?.id || "";
  const existingForRound = foursomes.filter((f) => f.round_id === targetRoundId);
  const peopleSig = people.map((p) => p.id).join(",");

  useEffect(() => {
    if (done) return;
    savePhoneDraft({ step, players: people, groups, groupsFor, settings, nameDraft, roundId });
  }, [step, people, groups, groupsFor, settings, nameDraft, roundId, done]);

  function rebuild(why) {
    setGroups(buildPhoneGroups(people, settings));
    setGroupsFor(peopleSig);
    setSel(null);
    setNotice(why || "");
  }

  function goStep(n) {
    if (n >= 2 && people.length === 0) return;
    if (n >= 2 && groupsFor !== peopleSig) {
      rebuild(groups.length ? "Your player list changed, so the groups were rebuilt." : "");
    } else {
      setNotice("");
    }
    setStep(n);
    window.scrollTo?.({ top: 0 });
  }

  // ---------- Step 1 ----------
  function resetForm() {
    setFName("");
    setFHcp("");
    setFPlus(false);
    setFCharity("");
    setEditId(null);
    setFormErr("");
  }

  function submitPlayer() {
    const name = fName.trim().replace(/\s+/g, " ");
    if (!name) return setFormErr("Enter the player's name.");
    if (!/^\d{1,2}$/.test(fHcp.trim()) || Number(fHcp.trim()) > 54) {
      return setFormErr("Enter a handicap from 0 to 54 (use the Plus box for a plus handicap).");
    }
    if (people.some((p) => p.id !== editId && p.name.toLowerCase() === name.toLowerCase())) {
      return setFormErr(`${name} is already on the list.`);
    }
    const n = Number(fHcp.trim());
    const handicap = fPlus && n !== 0 ? -n : n;
    const charity = fCharity.trim();
    if (editId) {
      setPeople((l) => l.map((p) => (p.id === editId ? { ...p, name, handicap, charity } : p)));
    } else {
      const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      setPeople((l) => [...l, { id, name, handicap, charity }]);
    }
    resetForm();
    nameRef.current?.focus();
  }

  function editPlayer(p) {
    setEditId(p.id);
    setFName(p.name);
    setFHcp(String(Math.abs(p.handicap)));
    setFPlus(p.handicap < 0);
    setFCharity(p.charity || "");
    setFormErr("");
    nameRef.current?.focus();
  }

  function removePlayer(p) {
    if (!confirm(`Remove ${p.name}?`)) return;
    setPeople((l) => l.filter((x) => x.id !== p.id));
    if (editId === p.id) resetForm();
  }

  // ---------- Step 2 ----------
  // Tee-time settings re-stamp every group's time/hole; players and names stay put.
  function applyTee(next) {
    setSettings(next);
    setGroups((gs) => gs.map((g, i) => ({ ...g, ...phoneSlot(next, i, gs.length) })));
  }

  function setGroup(i, patch) {
    setGroups((gs) => gs.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  }

  function tapPlayer(gi, pid) {
    if (!sel) return setSel({ gi, pid });
    if (sel.pid === pid) return setSel(null);
    setGroups((gs) => {
      const next = gs.map((g) => ({ ...g, playerIds: [...g.playerIds] }));
      const a = next[sel.gi];
      const b = next[gi];
      const ia = a.playerIds.indexOf(sel.pid);
      const ib = b.playerIds.indexOf(pid);
      if (ia < 0 || ib < 0) return gs;
      a.playerIds[ia] = pid;
      b.playerIds[ib] = sel.pid;
      return next;
    });
    setSel(null);
  }

  function moveHere(gi) {
    if (!sel || sel.gi === gi) return;
    setGroups((gs) => {
      if (gs[gi].playerIds.length >= 4) return gs;
      return gs.map((g, j) => {
        if (j === sel.gi) return { ...g, playerIds: g.playerIds.filter((x) => x !== sel.pid) };
        if (j === gi) return { ...g, playerIds: [...g.playerIds, sel.pid] };
        return g;
      });
    });
    setSel(null);
  }

  function refill() {
    if (!confirm("Re-fill the groups from scratch? Any moves or edits you made to groups will be lost.")) return;
    rebuild("");
  }

  // ---------- Step 3 ----------
  const personById = new Map(people.map((p) => [p.id, p]));
  const filledGroups = groups.filter((g) => g.playerIds.length > 0);
  const groupNames = filledGroups.map((g) => g.name.trim());
  const problems = [];
  if (people.length === 0) problems.push("Add at least one player.");
  if (groupNames.some((n) => !n)) problems.push("Every group needs a name.");
  const dupName = groupNames.find((n, i) => n && groupNames.findIndex((m) => m.toLowerCase() === n.toLowerCase()) !== i);
  if (dupName) problems.push(`Group names must be different (“${dupName}” is used twice).`);
  if (filledGroups.some((g) => !g.teeTime)) problems.push("Every group needs a tee time.");
  if (multiRound && !targetRoundId) problems.push("Pick a round.");
  const warnings = [];
  if (filledGroups.some((g) => g.playerIds.length === 1)) warnings.push("At least one group has only 1 player.");
  if (groups.length > filledGroups.length) warnings.push("Empty groups are left out.");
  if (existingForRound.length > 0 && !replace) {
    warnings.push("Existing groups with the same name keep their current tee time and hole.");
  }

  async function start() {
    if (busy || problems.length) return;
    const doReplace = existingForRound.length > 0 && replace;
    if (doReplace && !confirm(`This replaces the ${existingForRound.length} existing group(s) for this round (players and scores are kept). Continue?`)) return;
    setBusy(true);
    setStartMsg("Starting…");
    try {
      const name = nameDraft.trim();
      if (name && name !== eventName) {
        const nameErr = await onSaveEventName(name);
        if (nameErr) {
          setStartMsg(`Could not save the tournament name, so nothing was started: ${nameErr}`);
          return;
        }
      }
      const rows = phoneDraftToSheetRows(people, filledGroups);
      const ok = await onStart(rows, { replace: doReplace, targetRoundId, say: setStartMsg });
      if (ok) {
        savePhoneDraft(null);
        setDone({ roundId: targetRoundId, names: groupNames, playerCount: people.length });
      }
    } finally {
      setBusy(false);
    }
  }

  // ---------- shared bits ----------
  const bigField = { ...styles.input, fontSize: 16, minHeight: 46, boxSizing: "border-box", width: "100%" };
  const tap = { minHeight: 44, minWidth: 44 };
  const stepLabel = ["Players", "Groups", "Review & Start"];
  const hcpText = (h) => (h < 0 ? `+${Math.abs(h)}` : String(h));

  // ---------- Done ----------
  if (done) {
    const made = done.names
      .map((n) => foursomes.find((f) => f.round_id === done.roundId && String(f.group_name || "").trim().toLowerCase() === n.toLowerCase()))
      .filter(Boolean)
      .sort((a, b) => String(a.tee_time || "").localeCompare(String(b.tee_time || "")) || String(a.group_name).localeCompare(String(b.group_name), undefined, { numeric: true }));
    const text =
      `${eventName} — group codes\n` +
      made
        .map((f) => {
          const when = [formatTeeTime(f.tee_time), f.starting_hole && f.starting_hole !== 1 ? `hole ${f.starting_hole}` : ""].filter(Boolean).join(", ");
          return `${f.group_name}${when ? ` (${when})` : ""}: ${f.code}`;
        })
        .join("\n");
    return (
      <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
        <div style={styles.subCard}>
          <div style={{ ...styles.cardTitle, fontSize: 20 }}>Started ✅</div>
          <div style={styles.helpText}>
            {done.playerCount} players • {done.names.length} groups. Give each group its code so they can enter scores.
          </div>
          <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
            {made.map((f) => (
              <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "10px 12px", border: `1px solid ${THEME.border}`, borderRadius: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800 }}>{f.group_name}</div>
                  <div style={{ fontSize: 12, color: THEME.textMuted }}>
                    {formatTeeTime(f.tee_time) || "No tee time"} • Hole {f.starting_hole || 1}
                  </div>
                </div>
                <div style={{ fontFamily: "ui-monospace, Menlo, Consolas, monospace", fontWeight: 900, fontSize: 20, letterSpacing: 2 }}>{f.code}</div>
              </div>
            ))}
          </div>
          {made.length < done.names.length ? <div style={styles.helpText}>Some codes are still loading — tap Reload Data above if any are missing.</div> : null}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
            {typeof navigator !== "undefined" && navigator.share ? (
              <button style={{ ...styles.bigBtn, ...tap }} onClick={() => navigator.share({ title: `${eventName} group codes`, text }).catch(() => {})}>
                Share codes
              </button>
            ) : (
              <button
                style={{ ...styles.bigBtn, ...tap }}
                onClick={() => {
                  Promise.resolve(navigator.clipboard?.writeText(text)).then(() => setShareMsg("Copied ✅"), () => setShareMsg("Could not copy."));
                }}
              >
                Copy codes
              </button>
            )}
            <button style={{ ...styles.smallBtn, ...tap }} onClick={() => onGoto("leaderboard")}>
              Leaderboard
            </button>
            <button style={{ ...styles.smallBtn, ...tap }} onClick={onExit}>
              Back to Admin
            </button>
          </div>
          {shareMsg ? <div style={styles.helpText}>{shareMsg}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 14, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button style={{ ...styles.smallBtn, ...tap }} onClick={onExit}>
          ← Back to Admin
        </button>
        {people.length > 0 || groups.length > 0 ? (
          <button
            style={{ ...styles.smallBtn, ...tap }}
            onClick={() => {
              if (!confirm("Start over? This clears the players and groups you have entered here.")) return;
              savePhoneDraft(null);
              setPeople([]);
              setGroups([]);
              setGroupsFor("");
              setSettings({ ...PHONE_DEFAULT_SETTINGS });
              setStep(1);
              setSel(null);
              setNotice("");
              setStartMsg("");
              resetForm();
            }}
          >
            Start over
          </button>
        ) : null}
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 12 }} aria-label="Progress">
        {stepLabel.map((l, i) => (
          <div key={l} style={{ flex: 1, minWidth: 0 }}>
            <div style={{ height: 5, borderRadius: 3, background: i + 1 <= step ? THEME.accent : THEME.border }} />
            <div style={{ fontSize: 11, marginTop: 4, fontWeight: i + 1 === step ? 800 : 500, color: i + 1 === step ? THEME.text : THEME.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {i + 1}. {l}
            </div>
          </div>
        ))}
      </div>

      {step === 1 && (
        <div style={{ ...styles.subCard, marginTop: 12 }}>
          <div style={styles.subTitle}>Add players</div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitPlayer();
            }}
            style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1fr)" }}
          >
            <label style={styles.label}>
              Name
              <input
                ref={nameRef}
                style={bigField}
                value={fName}
                autoComplete="off"
                autoCapitalize="words"
                enterKeyHint="next"
                placeholder="First Last"
                onChange={(e) => {
                  setFName(e.target.value);
                  setFormErr("");
                }}
              />
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10, alignItems: "end" }}>
              <label style={styles.label}>
                Handicap
                <input
                  style={bigField}
                  value={fHcp}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="e.g. 12"
                  onChange={(e) => {
                    setFHcp(e.target.value.replace(/[^\d]/g, "").slice(0, 2));
                    setFormErr("");
                  }}
                />
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 46, fontSize: 14, color: THEME.text }}>
                <input type="checkbox" style={{ width: 22, height: 22 }} checked={fPlus} onChange={(e) => setFPlus(e.target.checked)} />
                Plus
              </label>
            </div>
            <label style={styles.label}>
              Charity (optional)
              <input style={bigField} value={fCharity} autoComplete="off" enterKeyHint="done" onChange={(e) => setFCharity(e.target.value)} />
            </label>
            {formErr ? <div style={{ fontSize: 13, color: THEME.danger, fontWeight: 700 }}>{formErr}</div> : null}
            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" style={{ ...styles.bigBtn, flex: 1, minHeight: 48 }}>
                {editId ? "Save changes" : "Add player"}
              </button>
              {editId ? (
                <button type="button" style={{ ...styles.smallBtn, ...tap }} onClick={resetForm}>
                  Cancel
                </button>
              ) : null}
            </div>
          </form>

          <div style={{ ...styles.sectionLabel, marginTop: 16 }}>Players ({people.length})</div>
          {people.length === 0 ? (
            <div style={styles.helpText}>No players yet. Add the first one above.</div>
          ) : (
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              {people.map((p, i) => (
                <div
                  key={p.id}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px 6px 12px", border: `1px solid ${editId === p.id ? THEME.accent : THEME.border}`, borderRadius: 12, minWidth: 0 }}
                >
                  <button
                    type="button"
                    onClick={() => editPlayer(p)}
                    style={{ flex: 1, minWidth: 0, minHeight: 44, textAlign: "left", background: "none", border: "none", padding: 0, font: "inherit", color: "inherit", cursor: "pointer" }}
                  >
                    <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {i + 1}. {p.name}
                    </div>
                    <div style={{ fontSize: 12, color: THEME.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      HCP {hcpText(p.handicap)}
                      {p.charity ? ` • ${p.charity}` : ""} • tap to edit
                    </div>
                  </button>
                  <button type="button" aria-label={`Remove ${p.name}`} style={{ ...styles.smallBtn, ...tap, padding: 0 }} onClick={() => removePlayer(p)}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          <div style={styles.subCard}>
            <div style={styles.subTitle}>Tee times</div>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)" }}>
              <label style={styles.label}>
                First tee time
                <input type="time" style={{ ...bigField, ...timeInputFix }} value={settings.firstTee} onChange={(e) => applyTee({ ...settings, firstTee: e.target.value })} />
              </label>
              <label style={styles.label}>
                Minutes between groups
                <input
                  style={{ ...bigField, opacity: settings.shotgun ? 0.5 : 1 }}
                  inputMode="numeric"
                  disabled={settings.shotgun}
                  value={settings.gapMin}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d]/g, "").slice(0, 3);
                    applyTee({ ...settings, gapMin: v === "" ? 0 : Number(v) });
                  }}
                />
              </label>
            </div>
            <label style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44, marginTop: 8, fontSize: 14 }}>
              <input type="checkbox" style={{ width: 22, height: 22 }} checked={settings.shotgun} onChange={(e) => applyTee({ ...settings, shotgun: e.target.checked })} />
              Shotgun start (everyone tees off together from different holes)
            </label>
            <div style={{ display: "flex", gap: 10, alignItems: "end", marginTop: 8, flexWrap: "wrap" }}>
              <label style={{ ...styles.label, width: 150 }}>
                Players per group
                <select style={bigField} value={settings.size} onChange={(e) => setSettings({ ...settings, size: Number(e.target.value) })}>
                  <option value={2}>Up to 2</option>
                  <option value={3}>Up to 3</option>
                  <option value={4}>Up to 4</option>
                </select>
              </label>
              <button style={{ ...styles.smallBtn, ...tap }} onClick={refill}>
                Re-fill groups
              </button>
            </div>
            <div style={styles.helpText}>
              Changing the tee-time settings updates every group&apos;s time. After changing players per group, tap Re-fill groups.
            </div>
          </div>

          {notice ? <div style={{ ...styles.subCard, fontSize: 13 }}>{notice}</div> : null}

          <div style={{ fontSize: 13, color: THEME.textMuted }}>
            {sel
              ? `Selected ${personById.get(sel.pid)?.name}. Tap another player to swap, or “Move here” on a group.`
              : "Tap a player to move or swap them."}
          </div>

          {groups.map((g, gi) => {
            const full = g.playerIds.length >= 4;
            return (
              <div key={gi} style={styles.subCard}>
                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1fr)" }}>
                  <label style={styles.label}>
                    Group name
                    <input style={bigField} value={g.name} onChange={(e) => setGroup(gi, { name: e.target.value })} />
                  </label>
                  <div style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1fr) 88px" }}>
                    <label style={styles.label}>
                      Tee time
                      <input type="time" style={{ ...bigField, ...timeInputFix }} value={g.teeTime} onChange={(e) => setGroup(gi, { teeTime: e.target.value })} />
                    </label>
                    <label style={styles.label}>
                      Hole
                      <input
                        style={bigField}
                        inputMode="numeric"
                        value={g.startingHole}
                        onChange={(e) => {
                          const v = e.target.value.replace(/[^\d]/g, "").slice(0, 2);
                          setGroup(gi, { startingHole: v === "" ? "" : Math.min(18, Number(v)) });
                        }}
                        onBlur={() => {
                          if (!(Number(g.startingHole) >= 1)) setGroup(gi, { startingHole: 1 });
                        }}
                      />
                    </label>
                  </div>
                </div>
                <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                  {g.playerIds.map((pid) => {
                    const p = personById.get(pid);
                    if (!p) return null;
                    const on = sel?.pid === pid;
                    return (
                      <button
                        key={pid}
                        type="button"
                        onClick={() => tapPlayer(gi, pid)}
                        style={{
                          ...tap,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 8,
                          textAlign: "left",
                          padding: "8px 12px",
                          borderRadius: 12,
                          font: "inherit",
                          color: THEME.text,
                          cursor: "pointer",
                          border: `2px solid ${on ? THEME.accent : THEME.border}`,
                          background: on ? THEME.btnStrong : "transparent",
                        }}
                      >
                        <span style={{ fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                        <span style={{ fontSize: 12, color: THEME.textMuted, flexShrink: 0 }}>HCP {hcpText(p.handicap)}</span>
                      </button>
                    );
                  })}
                  {g.playerIds.length === 0 ? <div style={{ fontSize: 12, color: THEME.textMuted }}>Empty — this group will be left out.</div> : null}
                  {sel && sel.gi !== gi ? (
                    <button type="button" disabled={full} onClick={() => moveHere(gi)} style={{ ...styles.smallBtn, ...tap, opacity: full ? 0.45 : 1 }}>
                      {full ? "Group is full (4)" : "Move here"}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {step === 3 && (
        <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
          <div style={styles.subCard}>
            <div style={styles.subTitle}>Review</div>
            <label style={styles.label}>
              Tournament name
              <input style={bigField} value={nameDraft} placeholder="The Ginvitational" onChange={(e) => setNameDraft(e.target.value)} />
            </label>
            {multiRound ? (
              <label style={{ ...styles.label, marginTop: 10 }}>
                Round
                <select style={bigField} value={targetRoundId} onChange={(e) => setRoundId(e.target.value)}>
                  {rounds.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                      {r.is_active ? " (active)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div style={{ marginTop: 12, fontWeight: 800 }}>
              {people.length} players • {filledGroups.length} groups
              {settings.shotgun ? " • shotgun start" : ""}
            </div>
            {existingForRound.length > 0 ? (
              <label style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44, marginTop: 8, fontSize: 14 }}>
                <input type="checkbox" style={{ width: 22, height: 22 }} checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                Replace the {existingForRound.length} existing group(s) for this round (recommended)
              </label>
            ) : null}
            {warnings.map((w) => (
              <div key={w} style={{ marginTop: 8, fontSize: 13, color: THEME.textMuted }}>⚠️ {w}</div>
            ))}
            {problems.map((w) => (
              <div key={w} style={{ marginTop: 8, fontSize: 13, color: THEME.danger, fontWeight: 700 }}>{w}</div>
            ))}
          </div>

          {filledGroups.map((g, i) => (
            <div key={i} style={styles.subCard}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                <div style={{ fontWeight: 800 }}>{g.name || "(unnamed)"}</div>
                <div style={{ fontSize: 13, color: THEME.textMuted }}>
                  {formatTeeTime(g.teeTime) || "No time"} • Hole {g.startingHole || 1}
                </div>
              </div>
              <div style={{ marginTop: 6, display: "grid", gap: 2, fontSize: 14 }}>
                {g.playerIds.map((pid) => {
                  const p = personById.get(pid);
                  return p ? (
                    <div key={pid} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                      <span style={{ color: THEME.textMuted }}>{hcpText(p.handicap)}</span>
                    </div>
                  ) : null;
                })}
              </div>
            </div>
          ))}
          {startMsg ? <div style={styles.helpText}>{startMsg}</div> : null}
        </div>
      )}

      {/* Sticky Back / Next so the buttons stay reachable on a long list */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          marginTop: 14,
          padding: "10px 0 calc(10px + env(safe-area-inset-bottom, 0px))",
          background: THEME.surface,
          display: "flex",
          gap: 10,
          zIndex: 5,
          borderTop: `1px solid ${THEME.border}`,
        }}
      >
        {step > 1 ? (
          <button style={{ ...styles.bigBtn, minHeight: 48, flex: 1 }} onClick={() => goStep(step - 1)} disabled={busy}>
            Back
          </button>
        ) : null}
        {step < 3 ? (
          <button
            style={{ ...styles.bigBtn, minHeight: 48, flex: 2, background: THEME.btnStrong, opacity: people.length === 0 ? 0.45 : 1 }}
            disabled={people.length === 0}
            onClick={() => goStep(step + 1)}
          >
            {step === 1 ? `Next: Groups (${people.length})` : "Next: Review"}
          </button>
        ) : (
          <button
            style={{ ...styles.bigBtn, minHeight: 48, flex: 2, background: THEME.btnStrong, opacity: busy || problems.length ? 0.45 : 1 }}
            disabled={busy || problems.length > 0}
            onClick={start}
          >
            {busy ? "Starting…" : "Start Tournament"}
          </button>
        )}
      </div>
    </div>
  );
}
