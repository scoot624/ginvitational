// Pure tee-sheet and tee-time helpers: reading Excel times and names, the
// "Build on my phone" group/tee-time builder, and tee-time formatting.
// No React, no network — tested in tests/teeSheet.test.mjs.

/** "13:12:00" -> "1:12 PM". The database keeps 24-hour time with seconds; this is how people read a tee time. */
export function formatTeeTime(t) {
  const raw = String(t ?? "").trim();
  const m = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(raw);
  if (!m) return raw;
  const hour24 = Number(m[1]);
  if (hour24 > 23) return raw;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${m[2]} ${hour24 < 12 ? "AM" : "PM"}`;
}

/** Splits `n` players into the fewest groups of at most `size`, as evenly as possible (9 -> 3/3/3, not 4/4/1). */
export function groupSizes(n, size) {
  if (n <= 0) return [];
  const groups = Math.ceil(n / size);
  const base = Math.floor(n / groups);
  const extra = n % groups;
  return Array.from({ length: groups }, (_, i) => base + (i < extra ? 1 : 0));
}

/** "09:50" + 15 -> "10:05". Wraps past midnight; returns "" for anything that isn't HH:MM. */
export function addMinutesToTime(hhmm, minutes) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return "";
  const total = (((Number(m[1]) * 60 + Number(m[2]) + Math.round(minutes)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Shotgun start: spread `groupCount` groups across the 18 holes (11 groups -> 1,2,4,5,7,9,10,12,14,15,17). */
export function shotgunHole(index, groupCount) {
  return (Math.floor((index * 18) / Math.max(1, groupCount)) % 18) + 1;
}

/**
 * Builds the starting groups for the phone flow: players in the order entered,
 * split evenly, with tee times (first + gap per group) or shotgun holes.
 * `players` need only an `id`; returns [{ name, teeTime, startingHole, playerIds }].
 */
export function buildPhoneGroups(players, { size, firstTee, gapMin, shotgun }) {
  const sizes = groupSizes(players.length, size);
  let at = 0;
  return sizes.map((count, i) => {
    const playerIds = players.slice(at, at + count).map((p) => p.id);
    at += count;
    return {
      name: `Group ${i + 1}`,
      teeTime: shotgun ? firstTee : addMinutesToTime(firstTee, i * gapMin) || firstTee,
      startingHole: shotgun ? shotgunHole(i, sizes.length) : 1,
      playerIds,
    };
  });
}

/**
 * Turns the phone draft into the SAME row shape the Excel parser produces, so
 * the one import writer (runTeeSheetImport) handles both. A group's name is its
 * "team" value, exactly like a spreadsheet's Team column. Empty groups are skipped.
 */
export function phoneDraftToSheetRows(players, groups) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const rows = [];
  for (const g of groups) {
    for (const id of g.playerIds) {
      const p = byId.get(id);
      if (!p) continue;
      rows.push({
        team: g.name.trim(),
        tee_time: g.teeTime,
        starting_hole: g.startingHole,
        first_name: p.name.trim(),
        last_name: "",
        handicap: p.handicap,
        charity: p.charity || "",
      });
    }
  }
  return rows;
}

/** A group's tee time + starting hole from the tee-time settings (position `i` of `count`). */
export function phoneSlot(settings, i, count) {
  return {
    teeTime: settings.shotgun
      ? settings.firstTee
      : addMinutesToTime(settings.firstTee, i * settings.gapMin) || settings.firstTee,
    startingHole: settings.shotgun ? shotgunHole(i, count) : 1,
  };
}

export function excelTimeToDbTime(v) {
  // Return "HH:MM:SS" or null
  if (v == null || v === "") return null;

  // If sheet_to_json gives a Date
  if (v instanceof Date && Number.isFinite(v.getTime())) {
    const hh = String(v.getHours()).padStart(2, "0");
    const mm = String(v.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}:00`;
  }

  // If Excel time fraction (e.g., 0.375)
  const n = Number(v);
  if (Number.isFinite(n)) {
    const totalSeconds = Math.round(n * 24 * 60 * 60);
    const hh = String(Math.floor(totalSeconds / 3600) % 24).padStart(2, "0");
    const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
    return `${hh}:${mm}:00`;
  }

  // If string like "9:00 AM" or "09:00"
  const s = String(v).trim();
  if (!s) return null;

  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const [h, m] = s.split(":");
    return `${String(h).padStart(2, "0")}:${m}:00`;
  }

  const d = new Date(`1970-01-01 ${s}`);
  if (Number.isFinite(d.getTime())) {
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}:00`;
  }

  return null;
}

export function fullNameFromRow(row) {
  const first = String(row.first_name || "").trim();
  const last = String(row.last_name || "").trim();
  return `${first} ${last}`.trim().replace(/\s+/g, " ");
}
