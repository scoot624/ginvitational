import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { buildScoresByPlayer, computeGameRows, mergeGameRowsAcrossRounds } from "./lib/gameCalc";
import { computeBroadcastEvents, planPosts, safeDedupeKey, shortName, SWING_WINDOW_MS } from "./lib/broadcastEngine";

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

/** Shared passcode: Admin gate + locked-scoreboard unlock use the same code. */
const ADMIN_PIN = "112020";

/** Leaderboard round-selector sentinel: cumulative total across every round. */
const ROUND_OVERALL = "overall";

/** Multi-Game: format labels + one-tap presets (Admin "Add Game" flow) */
const GAME_FORMAT_LABELS = {
  individual_net: "Individual Net",
  individual_gross: "Individual Gross",
  better_ball_2: "2-Man Better Ball",
  better_ball_4: "4-Man Better Ball",
  scramble_2: "2-Man Scramble",
  scramble_4: "4-Man Scramble",
  composite: "Multi-Format Round",
};

const GAME_FORMAT_TEAM_SIZE = {
  individual_net: 1,
  individual_gross: 1,
  better_ball_2: 2,
  better_ball_4: 4,
  scramble_2: 2,
  scramble_4: 4,
  // composite's team size is admin-chosen (newGameTeamSize), not fixed by format
};

const GAME_SCORE_LABELS = {
  individual_net: "Net vs Par",
  individual_gross: "Gross vs Par",
  better_ball_2: "Team vs Par",
  better_ball_4: "Team vs Par",
  scramble_2: "Team vs Par",
  scramble_4: "Team vs Par",
  composite: "Team vs Par",
};

// Default ranked handicap-% allowance (lowest handicap on the team through
// highest) offered when an admin picks a Scramble format — editable before
// creating the game.
const SCRAMBLE_DEFAULT_PCTS = {
  scramble_2: [35, 15],
  scramble_4: [40, 30, 20, 10],
};

// A composite game's per-segment format choices. "individual" segments
// (Best Ball, Combined Score) reuse the counting-rule engine; "shared"
// segments (Scramble) use one team score + a blended team handicap.
const SEGMENT_FORMAT_OPTIONS = {
  best_ball: { label: "Best Ball", kind: "individual", scoresCounted: 1, slots: ["net"] },
  combined: { label: "Combined Score", kind: "individual", scoresCounted: 2, slots: ["net", "net"] },
  scramble: { label: "Scramble", kind: "shared" },
};

// Each preset: { label, handicapPct, scoresCounted, slots }
const GAME_PRESETS = {
  individual_net: [{ key: "standard", label: "Standard", handicapPct: 100, scoresCounted: 1, slots: ["net"] }],
  individual_gross: [{ key: "standard", label: "Standard", handicapPct: 100, scoresCounted: 1, slots: ["gross"] }],
  better_ball_2: [
    { key: "best_net", label: "Best Net", handicapPct: 90, scoresCounted: 1, slots: ["net"] },
    { key: "net_gross", label: "1 Net + 1 Gross", handicapPct: 90, scoresCounted: 2, slots: ["net", "gross"] },
  ],
  better_ball_4: [
    { key: "best_net", label: "Best Net", handicapPct: 80, scoresCounted: 1, slots: ["net"] },
    { key: "two_net", label: "2 Net", handicapPct: 80, scoresCounted: 2, slots: ["net", "net"] },
    { key: "two_gross_one_net", label: "2 Gross + 1 Net", handicapPct: 80, scoresCounted: 3, slots: ["gross", "gross", "net"] },
  ],
};

function clampInt(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

const DEFAULT_TAGLINE = "Drink Good. Play Good. Do Good.";

/** What an admin runs once in Supabase before the tagline/logo settings can be saved (same as migrations/0010). */
const BRANDING_SQL =
  "alter table app_settings add column if not exists tagline text;\n" +
  "alter table app_settings add column if not exists logo_data text;";

/**
 * Turns an uploaded image file into a small PNG data URL for the main logo.
 * The logo is stored with the other settings and loaded on every visit, so
 * it's resized in the browser first (longest side <= 640px — plenty for the
 * Home screen at 3x and for print) and shrunk further if it's still big.
 * Transparency is kept. Throws an Error with a plain-English message.
 */
async function fileToLogoDataUrl(file) {
  if (!file || !/^image\//.test(file.type)) {
    throw new Error("Please choose an image file (PNG, JPG, WebP or SVG).");
  }
  if (file.size > 8 * 1024 * 1024) throw new Error("That image is over 8 MB — please pick a smaller one.");

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Couldn't read that image — try a PNG or JPG."));
      el.src = url;
    });
    const w0 = img.naturalWidth || 512; // an SVG with no size can report 0
    const h0 = img.naturalHeight || 512;

    for (const maxDim of [640, 480, 320]) {
      const scale = Math.min(1, maxDim / Math.max(w0, h0));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w0 * scale));
      canvas.height = Math.max(1, Math.round(h0 * scale));
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/png");
      if (dataUrl.length <= 450_000 || maxDim === 320) return dataUrl;
    }
    throw new Error("Couldn't shrink that image enough — try a simpler one.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------- Phone setup ("Build on my phone") helpers: pure, no React ---------- */

/** Splits `n` players into the fewest groups of at most `size`, as evenly as possible (9 -> 3/3/3, not 4/4/1). */
function groupSizes(n, size) {
  if (n <= 0) return [];
  const groups = Math.ceil(n / size);
  const base = Math.floor(n / groups);
  const extra = n % groups;
  return Array.from({ length: groups }, (_, i) => base + (i < extra ? 1 : 0));
}

/** "09:50" + 15 -> "10:05". Wraps past midnight; returns "" for anything that isn't HH:MM. */
function addMinutesToTime(hhmm, minutes) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return "";
  const total = (((Number(m[1]) * 60 + Number(m[2]) + Math.round(minutes)) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Shotgun start: spread `groupCount` groups across the 18 holes (11 groups -> 1,2,4,5,7,9,10,12,14,15,17). */
function shotgunHole(index, groupCount) {
  return (Math.floor((index * 18) / Math.max(1, groupCount)) % 18) + 1;
}

/**
 * Builds the starting groups for the phone flow: players in the order entered,
 * split evenly, with tee times (first + gap per group) or shotgun holes.
 * `players` need only an `id`; returns [{ name, teeTime, startingHole, playerIds }].
 */
function buildPhoneGroups(players, { size, firstTee, gapMin, shotgun }) {
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
function phoneDraftToSheetRows(players, groups) {
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

/** "13:12:00" -> "1:12 PM". The database keeps 24-hour time with seconds; this is how people read a tee time. */
function formatTeeTime(t) {
  const raw = String(t ?? "").trim();
  const m = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(raw);
  if (!m) return raw;
  const hour24 = Number(m[1]);
  if (hour24 > 23) return raw;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour12}:${m[2]} ${hour24 < 12 ? "AM" : "PM"}`;
}

function formatToPar(n) {
  if (n === 0) return "E";
  if (n > 0) return `+${n}`;
  return `${n}`;
}

/**
 * Real handicap allocation by stroke index.
 * A positive handicap RECEIVES strokes, starting at the #1 handicap hole
 * (hardest) and working up. A plus handicap (negative) GIVES strokes back
 * instead, using that same hole order, so the result goes negative on
 * those holes — `net = gross - strokesOnHole(...)` keeps working either way.
 */
function strokesOnHole(courseHcp, holeNum) {
  const h = clampInt(courseHcp, 0);
  if (h === 0) return 0;

  const magnitude = Math.abs(h);
  const full = Math.floor(magnitude / 18);
  const rem = magnitude % 18;
  const si = STROKE_INDEX[holeNum - 1];
  const strokes = full + (rem > 0 && si <= rem ? 1 : 0);

  return h > 0 ? strokes : -strokes;
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

/**
 * Full last name — everything after the first word, not just the final
 * word, so a multi-word surname (e.g. "Van Der Berg") shows in full
 * instead of being truncated to just "Berg".
 */
function lastName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return parts.slice(1).join(" ");
}

/** --- Brand palette --- */
const PALETTE = {
  // Primary
  fairwayGreen: "#1E3D34",
  deepMeadow: "#071F13",
  nightFairway: "#0E211A",
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

// "Fairway Editorial" theme: a solid deep-green page (nightFairway) with
// cream "paper" cards floating on top, instead of the old light gradient
// page + dark glass cards. Most of the app lives inside a card, so THEME.*
// below are tuned for dark ink on a paper surface; the handful of things
// that sit directly on the dark page itself (the top nav bar) use the
// separate chrome* tokens instead.
const THEME = {
  bg: PALETTE.nightFairway,
  ink: PALETTE.deepMeadow,

  surface: "rgba(247, 242, 231, 0.97)",
  surfaceSoft: "rgba(247, 242, 231, 0.95)",
  surfaceUltraSoft: "rgba(22, 35, 29, 0.035)",

  border: "rgba(22, 35, 29, 0.12)",
  borderStrong: "rgba(22, 35, 29, 0.22)",

  text: PALETTE.deepMeadow,
  textMuted: "#4E5C54",
  textFaint: "#7C8A81",

  btn: "rgba(159, 119, 80, 0.16)",
  btnBorder: "rgba(22, 35, 29, 0.20)",
  btnStrong: "rgba(159, 119, 80, 0.30)",

  accent: PALETTE.whickerBasket,
  danger: PALETTE.salmonRose,

  good: "#2F8F62",
  bad: PALETTE.salmonRose,

  // Chrome — for the top nav bar, which sits directly on the dark page
  // background rather than inside a paper card.
  chromeText: "rgba(237, 231, 216, 0.94)",
  chromeTextMuted: "rgba(237, 231, 216, 0.64)",
  chromeBorder: "rgba(237, 231, 216, 0.20)",
};

const FONT_DISPLAY = "'Fraunces', ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif";
const FONT_BODY = "'Public Sans', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

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

/** Passcode gate shown in place of a locked game's board on the Leaderboard tab. */
function LockedBoardPanel({ game, onUnlock }) {
  const [passcode, setPasscode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setErr("");
    const result = await onUnlock(game, passcode);
    setBusy(false);
    if (!result.ok) {
      setErr(result.error);
      return;
    }
    setPasscode("");
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 18, fontWeight: 950 }}>🔒 This scoreboard is locked</div>
      <div style={styles.helpText}>Enter the passcode to reveal &quot;{game.name}&quot;.</div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, maxWidth: 360, flexWrap: "wrap" }}>
        <input
          style={{ ...styles.input, flex: 1, minWidth: 160 }}
          type="password"
          value={passcode}
          onChange={(e) => {
            setPasscode(e.target.value);
            setErr("");
          }}
          placeholder="Passcode"
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button style={styles.bigBtn} onClick={submit} disabled={busy}>
          Unlock
        </button>
      </div>

      {err ? <div style={{ ...styles.helpText, color: THEME.bad }}>{err}</div> : null}
    </div>
  );
}

/** Chevron shown next to an expandable player name, rotated open/closed. */
function expandChevronStyle(open) {
  return {
    display: "inline-block",
    fontSize: 10,
    opacity: 0.7,
    transition: "transform 0.15s ease",
    transform: open ? "rotate(90deg)" : "rotate(0deg)",
  };
}

/**
 * Trophy badge shown in the # column in place of the rank number for
 * whoever is in sole or tied first place. The PNG is pre-cropped to just
 * the crystal (no nameplate base) and pre-shrunk to ~4x its display size —
 * letting the browser squash the original 1672px photo down to a ~26px
 * icon is what made it look blurry.
 */
function LeaderIcon({ height = "20px" }) {
  return (
    <img
      src="/leader-trophy.png"
      alt="1st"
      title="Current leader"
      style={{ display: "block", height, width: `calc(${height} * 1.4)` }}
    />
  );
}

/**
 * The LEX (iron headcover) badge shown in the # column in place of the rank
 * number for whoever is in last place. Pre-trimmed and pre-shrunk like the
 * trophy (see LeaderIcon); width:height matches the trimmed artwork's ~1.89
 * ratio.
 */
function LastPlaceIcon({ height = "20px" }) {
  return (
    <img
      src="/lex-headcover.png"
      alt="Last"
      title="The LEX"
      style={{ display: "block", height, width: `calc(${height} * 1.9)` }}
    />
  );
}

/** True once a leaderboard row's own rank/holesPlayed show it's in the lead. */
function isLeaderRow(r) {
  return r.displayRank === 1 && r.holesPlayed > 0;
}

/**
 * The displayRank that counts as "last place" — taken from the worst row
 * among players who have actually played a hole (unstarted players sit
 * below them but aren't last yet). Returns null when nobody has played, or
 * when every scored player is tied for first, so the leader's trophy always
 * wins and a field with no scores is simply numbered.
 */
function lastPlaceRank(rows) {
  const scored = rows.filter((r) => r.holesPlayed > 0);
  if (scored.length === 0) return null;
  const rank = scored[scored.length - 1].displayRank;
  return rank === 1 ? null : rank;
}

/** True for rows tied at the bottom of the scored field (see lastPlaceRank). */
function isLastRow(r, lastRank) {
  return lastRank != null && r.holesPlayed > 0 && r.displayRank === lastRank;
}

/** What the # column shows: trophy for 1st, LEX for last, otherwise the number. */
function rankCellContent(r, idx, lastRank, iconHeight) {
  if (isLeaderRow(r)) return <LeaderIcon height={iconHeight} />;
  if (isLastRow(r, lastRank)) return <LastPlaceIcon height={iconHeight} />;
  return r.displayRank ?? idx + 1;
}

/** Display-only palette for TV Mode: dark ground, light text, brighter score colors for across-the-room reading. */
const TV = {
  bg: "#0A1812",
  text: "#F7F2E7",
  muted: "rgba(247, 242, 231, 0.62)",
  line: "rgba(237, 231, 216, 0.18)",
  gold: PALETTE.whickerBasket,
  under: "#6EE7A8",
  over: "#FF9C8A",
};

/**
 * "On fire" / "ice cold" for a player's most recent holes, judged NET vs par
 * (same basis as the leaderboard and the broadcast's "net birdie" lines):
 *   fire — last two holes both net birdie or better
 *   ice  — last two holes both net bogey or worse, OR the last hole alone is
 *          net double bogey or worse
 * "Last" follows the order the group actually plays — a shotgun group that
 * starts on 10 plays 10…18 then 1…9 — not hole-number order. Nothing is
 * remembered between refreshes; it only reads the scores already loaded, so
 * a streak ends the moment the next hole breaks it. Finished players get
 * nothing (they're not "on" anything any more). Returns "fire", "ice" or null.
 */
function formStreak(p, startHole) {
  if (!p || !p.scoresByHole || p.holesPlayed >= 18) return null;
  const start = Math.min(18, Math.max(1, clampInt(startHole, 1)));

  const vsPar = [];
  for (let i = 0; i < 18; i++) {
    const h = ((start - 1 + i) % 18) + 1;
    const gross = p.scoresByHole[h];
    vsPar.push(gross == null ? null : netScoreForHole(gross, p.playingHandicap, h) - PARS[h - 1]);
  }

  let last = -1;
  for (let i = 17; i >= 0; i--) {
    if (vsPar[i] != null) {
      last = i;
      break;
    }
  }
  if (last < 0) return null;

  const a = vsPar[last];
  const b = last > 0 ? vsPar[last - 1] : null;
  if (a >= 2) return "ice";
  if (b != null && a >= 1 && b >= 1) return "ice";
  if (b != null && a <= -1 && b <= -1) return "fire";
  return null;
}

/**
 * TV Mode — one static, full-screen, display-only layout for a big screen:
 * standings on top (~72%), the latest broadcast messages along the bottom.
 * Everything is sized with clamp()/vh/em so it scales with the screen; the
 * standings flow into as many columns as it takes to keep every player on
 * screen at a readable size, so nothing needs scrolling.
 */
function TvMode({ eventName, subtitle, board, messages, forms, onExit }) {
  const rows = board?.rows || [];
  const locked = !!board?.game?.locked;
  // A phone (narrow) or a phone turned sideways (short) can't show 40-odd
  // players at a readable size on one screen the way a TV can, so there the
  // standings become one normal-sized column that scrolls, and the broadcast
  // strip shrinks to fit under it.
  const compact = useMediaQuery("(max-width: 999px), (max-height: 560px)");
  const short = useMediaQuery("(max-height: 560px)");
  // Fewer, wider columns beat many narrow ones: a name needs ~400px at TV
  // text sizes, so 3 columns (not 4) for a typical 40-ish player field.
  const cols = compact ? 1 : rows.length <= 10 ? 1 : rows.length <= 24 ? 2 : rows.length <= 45 ? 3 : 4;
  const perCol = Math.max(1, Math.ceil(rows.length / cols));
  // ~62vh is what the standings get after the header; text is ~55% of a row.
  const rowFont = compact
    ? "clamp(15px, min(4.4vw, 4vh), 20px)"
    : `clamp(14px, ${((62 / perCol) * 0.55).toFixed(2)}vh, 44px)`;
  const lastRank = lastPlaceRank(rows);
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const recent = (messages || []).slice(0, compact ? (short ? 2 : 3) : 4);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        padding: "clamp(12px, 2.2vh, 32px) clamp(16px, 2.6vw, 56px)",
        background: TV.bg,
        color: TV.text,
        fontFamily: FONT_BODY,
        overflow: "hidden",
      }}
    >
      <style>{"@keyframes tvFlicker { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.18); } }"}</style>
      <button
        onClick={onExit}
        title="Exit TV Mode"
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          zIndex: 1,
          opacity: compact ? 0.4 : 0.18,
          background: "transparent",
          border: `1px solid ${TV.line}`,
          color: TV.text,
          borderRadius: 8,
          padding: compact ? "6px 10px" : "4px 10px",
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        Exit TV Mode
      </button>

      <section
        style={{
          flex: compact ? "1 1 0" : "0 0 72%",
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "baseline",
            justifyContent: "space-between",
            columnGap: 16,
            rowGap: 2,
            // keep the title clear of the Exit button in the corner
            paddingRight: compact ? 104 : "clamp(80px, 8vw, 140px)",
            paddingBottom: "clamp(4px, 1vh, 14px)",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: "1ch", minWidth: 0 }}>
            <span
              style={{
                fontFamily: FONT_DISPLAY,
                fontWeight: 600,
                fontSize: compact ? "clamp(20px, 6vw, 30px)" : "clamp(20px, 4.2vh, 56px)",
                whiteSpace: "nowrap",
              }}
            >
              {eventName}
            </span>
            {subtitle ? (
              <span
                style={{
                  color: TV.muted,
                  fontSize: compact ? 13 : "clamp(12px, 2vh, 26px)",
                  whiteSpace: "nowrap",
                }}
              >
                {subtitle}
              </span>
            ) : null}
          </div>
          <span style={{ color: TV.muted, fontSize: compact ? 13 : "clamp(12px, 2vh, 26px)", whiteSpace: "nowrap" }}>
            {today}
          </span>
        </div>

        {locked ? (
          <div
            style={{
              flex: 1,
              display: "grid",
              placeItems: "center",
              fontSize: "clamp(20px, 5vh, 64px)",
              fontWeight: 700,
              color: TV.muted,
            }}
          >
            🔒 This scoreboard is locked
          </div>
        ) : rows.length === 0 ? (
          <div
            style={{
              flex: 1,
              display: "grid",
              placeItems: "center",
              fontSize: "clamp(18px, 4vh, 52px)",
              color: TV.muted,
            }}
          >
            No players yet.
          </div>
        ) : (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "grid",
              columnGap: "clamp(16px, 2.4vw, 48px)",
              fontSize: rowFont,
              ...(compact
                ? {
                    // one column, fixed-height rows, scrolls under the header
                    gridTemplateColumns: "minmax(0, 1fr)",
                    gridAutoRows: "2.4em",
                    alignContent: "start",
                    overflowY: "auto",
                    overscrollBehavior: "contain",
                  }
                : {
                    gridAutoFlow: "column",
                    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${perCol}, minmax(0, 1fr))`,
                  }),
            }}
          >
            {rows.map((r, idx) => {
              const played = r.holesPlayed > 0;
              const scoreColor = !played ? TV.muted : r.toPar < 0 ? TV.under : r.toPar > 0 ? TV.over : TV.text;
              return (
                <div
                  key={r.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "2.6em minmax(0, 1fr) auto auto",
                    alignItems: "center",
                    columnGap: "0.6em",
                    padding: "0 0.5em",
                    minHeight: 0,
                    borderBottom: `1px solid ${TV.line}`,
                    background: isLeaderRow(r) ? "rgba(159, 119, 80, 0.22)" : "transparent",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", fontWeight: 700, color: TV.muted }}>
                    {rankCellContent(r, idx, lastRank, "1.1em")}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.35em", minWidth: 0 }}>
                    <span
                      style={{
                        minWidth: 0,
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {r.name}
                    </span>
                    {forms?.[r.id] === "fire" && (
                      <span title="On fire" style={{ flex: "none", animation: "tvFlicker 1.1s ease-in-out infinite" }}>
                        🔥
                      </span>
                    )}
                    {forms?.[r.id] === "ice" && (
                      <span title="Ice cold" style={{ flex: "none" }}>
                        ❄️
                      </span>
                    )}
                  </div>
                  <div style={{ fontWeight: 900, minWidth: "2.4em", textAlign: "right", color: scoreColor }}>
                    {played ? formatToPar(r.toPar) : "—"}
                  </div>
                  <div style={{ fontSize: "0.6em", minWidth: "4.4em", textAlign: "right", color: TV.muted }}>
                    {!played ? "" : r.holesPlayed === 18 ? "F" : `Thru ${r.holesPlayed}`}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div style={{ height: 1, background: TV.line, margin: "clamp(6px, 1.2vh, 16px) 0" }} />

      <section
        style={{
          // TV: share the bottom 28% evenly. Phone: just as tall as its few
          // messages need, so the standings above get everything else.
          flex: compact ? "0 0 auto" : 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            fontSize: "clamp(11px, 1.6vh, 20px)",
            letterSpacing: 2,
            textTransform: "uppercase",
            fontWeight: 700,
            color: TV.gold,
          }}
        >
          The Broadcast
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-evenly",
            gap: compact ? 6 : 0,
            paddingTop: compact ? 6 : 0,
            overflow: "hidden",
          }}
        >
          {recent.length === 0 ? (
            <div style={{ color: TV.muted, fontSize: compact ? 14 : "clamp(14px, 2.5vh, 32px)" }}>
              No updates yet — they'll show up here as scores come in.
            </div>
          ) : (
            recent.map((m) => (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "0.8em",
                  fontSize: compact ? "clamp(13px, 3.8vw, 17px)" : "clamp(14px, 2.5vh, 32px)",
                  lineHeight: 1.2,
                  minHeight: 0,
                  overflow: "hidden",
                }}
              >
                <span style={{ flex: "none", minWidth: "4.5em", fontSize: "0.65em", color: TV.muted }}>
                  {new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                </span>
                <span style={{ flex: "none", alignSelf: "center", display: "flex" }}>
                  <BroadcastIcon kind={m.kind} height="1.1em" />
                </span>
                <span
                  style={{
                    fontWeight: 600,
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {m.text}
                </span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * The <td> wrapping an expanded scorecard row — a light tint, not a card.
 * `width: "1px"` is a standard table trick: in auto table layout, a
 * colSpan cell's own content would otherwise force the whole table (and
 * everything above it) wider to fit all 18 hole columns. This tells the
 * layout engine the cell itself needs no extra width, so the table stays
 * sized by the normal row's columns, and ScorecardDetail's own
 * `overflow-x: auto` div is what ends up scrolling, not the whole table.
 */
const expandRowCellStyle = {
  width: "1px",
  padding: 0,
  background: "rgba(22,35,29,0.035)",
  borderTop: `1px solid ${THEME.border}`,
  borderBottom: `1px solid ${THEME.border}`,
};

/**
 * Hole-by-hole scorecard, shown inline under a Leaderboard row when that
 * player is expanded (replaces the old full-screen modal).
 */
function ScorecardDetail({ player }) {
  // One entry per hole — computed once, then laid out as COLUMNS below
  // (holes running left-to-right, like a real scorecard) instead of rows.
  const holes = (() => {
    let cum = 0; // running cumulative NET-to-par across holes

    return Array.from({ length: 18 }, (_, i) => i + 1).map((h) => {
      const par = PARS[h - 1];
      const sc = player.scoresByHole[h];
      const si = STROKE_INDEX[h - 1];
      const strokes = strokesOnHole(player.playingHandicap, h);

      const netSc = sc != null ? netScoreForHole(sc, player.playingHandicap, h) : null;
      const netDiff = netSc != null ? netSc - par : null;
      if (netDiff != null) cum += netDiff;

      // The "Net +/-" row shows the running cumulative-to-par through this
      // hole (what used to be a separate "Total" row), so it's colored by
      // the cumulative's sign, not the single hole's.
      const cumStyle =
        netDiff == null
          ? {}
          : cum < 0
          ? { color: THEME.good, fontWeight: 900 }
          : cum > 0
          ? { color: THEME.bad, fontWeight: 900 }
          : { opacity: 0.9, fontWeight: 900 };

      return { h, par, sc, si, strokes, netDiff, cum, cumStyle };
    });
  })();

  // Front nine / back nine / full-round totals. Par is the full nine's par;
  // score and net only add up holes actually played (this is live scoring),
  // and read "—" until a hole in that stretch has a score.
  const sumRange = (from, to) => {
    const hs = holes.slice(from, to);
    const played = hs.filter((x) => x.sc != null);
    return {
      par: hs.reduce((a, x) => a + x.par, 0),
      score: played.length ? played.reduce((a, x) => a + x.sc, 0) : null,
      net: played.length ? played.reduce((a, x) => a + x.netDiff, 0) : null,
    };
  };
  // Holes 1–9, OUT, holes 10–18, IN, TOT — the usual scorecard order.
  const columns = [
    ...holes.slice(0, 9).map((hd) => ({ key: `h${hd.h}`, hd })),
    { key: "out", label: "OUT", sum: sumRange(0, 9) },
    ...holes.slice(9).map((hd) => ({ key: `h${hd.h}`, hd })),
    { key: "in", label: "IN", sum: sumRange(9, 18) },
    { key: "tot", label: "TOT", sum: sumRange(0, 18) },
  ];
  const netSumStyle = (n) =>
    n == null ? {} : n < 0 ? { color: THEME.good } : n > 0 ? { color: THEME.bad } : { opacity: 0.9 };

  // The row-label column is pinned (position: sticky) so it stays in view,
  // with a faint right-edge shadow so it visually reads as a "frozen" pane,
  // while the 18 hole columns scroll underneath it horizontally.
  const stickyShadow = "2px 0 4px rgba(0,0,0,0.10)";
  const labelHeadStyle = {
    ...styles.th,
    position: "sticky",
    left: 0,
    background: THEME.surface,
    boxShadow: stickyShadow,
    fontSize: 10,
    padding: "6px 8px",
    zIndex: 1,
  };
  const labelCellStyle = {
    ...styles.td,
    position: "sticky",
    left: 0,
    background: THEME.surface,
    boxShadow: stickyShadow,
    fontWeight: 800,
    fontSize: 11,
    padding: "6px 8px",
    zIndex: 1,
  };
  // table-layout: fixed (below) splits the remaining width evenly across
  // all 18 hole <col>s, so every hole lines up in a uniform grid — a
  // hole's own content (the stroke dot/"+") no longer makes its column
  // render wider or narrower than its neighbors.
  const headStyle = { ...styles.th, textAlign: "center", fontSize: 10, padding: "6px 4px" };
  const cellStyle = { ...styles.td, textAlign: "center", fontSize: 11, padding: "6px 4px" };
  // OUT / IN / TOT columns: bold on a faint tint so they read as totals.
  const sumTint = "rgba(22,35,29,0.06)";
  const sumHeadStyle = { ...headStyle, background: sumTint, fontWeight: 900 };
  const sumCellStyle = { ...cellStyle, background: sumTint, fontWeight: 800 };
  // Fixed-height slot under every hole number, whether or not that hole
  // has a stroke mark — this is what keeps the hole numbers themselves
  // sitting at the same height across every column.
  const markSlotStyle = { height: 9, display: "flex", alignItems: "center", justifyContent: "center" };

  return (
    <div style={{ padding: "10px 8px" }}>
      {/* overscrollBehaviorX stops a horizontal scroll here from chaining
          into the Leaderboard's own horizontally-scrollable table once this
          one hits its edge. */}
      <div style={{ width: "100%", overflowX: "auto", overscrollBehaviorX: "contain" }}>
        <table style={{ ...styles.table, tableLayout: "fixed", minWidth: 56 + 18 * 26 + 3 * 36 }}>
          <colgroup>
            <col style={{ width: 56 }} />
            {columns.map((c) => (
              <col key={c.key} style={{ width: c.hd ? 26 : 36 }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th style={labelHeadStyle}>Hole</th>
              {columns.map((c) =>
                c.hd ? (
                  <th key={c.key} style={headStyle}>
                    <span style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <span>{c.hd.h}</span>
                      <span style={markSlotStyle}>
                        {c.hd.strokes > 0 ? (
                          <span style={styles.strokeDot} />
                        ) : c.hd.strokes < 0 ? (
                          <span style={styles.giveBackMark}>+</span>
                        ) : null}
                      </span>
                    </span>
                  </th>
                ) : (
                  <th key={c.key} style={sumHeadStyle}>
                    <span style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <span>{c.label}</span>
                      <span style={markSlotStyle} />
                    </span>
                  </th>
                )
              )}
            </tr>
          </thead>

          <tbody>
            <tr>
              <td style={labelCellStyle}>SI</td>
              {columns.map((c) => (
                <td key={c.key} style={c.hd ? cellStyle : sumCellStyle}>
                  {c.hd ? c.hd.si : ""}
                </td>
              ))}
            </tr>
            <tr>
              <td style={labelCellStyle}>Par</td>
              {columns.map((c) => (
                <td key={c.key} style={c.hd ? cellStyle : sumCellStyle}>
                  {c.hd ? c.hd.par : c.sum.par}
                </td>
              ))}
            </tr>
            <tr>
              <td style={labelCellStyle}>Score</td>
              {columns.map((c) => (
                <td key={c.key} style={c.hd ? cellStyle : sumCellStyle}>
                  {c.hd ? (c.hd.sc != null ? c.hd.sc : "—") : c.sum.score != null ? c.sum.score : "—"}
                </td>
              ))}
            </tr>
            <tr>
              <td style={labelCellStyle}>Net +/-</td>
              {columns.map((c) =>
                c.hd ? (
                  <td key={c.key} style={{ ...cellStyle, ...c.hd.cumStyle }}>
                    {c.hd.netDiff == null ? "—" : formatToPar(c.hd.cum)}
                  </td>
                ) : (
                  <td key={c.key} style={{ ...sumCellStyle, fontWeight: 900, ...netSumStyle(c.sum.net) }}>
                    {c.sum.net == null ? "—" : formatToPar(c.sum.net)}
                  </td>
                )
              )}
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8, color: THEME.textMuted }}>
        Net +/- uses real handicap allocation by Stroke Index.
        {player.playingHandicap < 0 && ' A "+" marks a hole where this plus handicap gives a stroke back.'}
      </div>
    </div>
  );
}

/**
 * Live CSS media-query match. Inline styles can't carry @media rules, and a
 * one-time check at load goes stale the moment a tablet rotates or a
 * desktop window is resized, so this re-renders when the match changes.
 */
function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export default function App() {
  const isWide = useMediaQuery("(min-width: 820px)"); // 2-column Admin on tablets/desktops
  const [tab, setTab] = useState("home"); // home | leaderboard | code | enter | admin | broadcast
  const [status, setStatus] = useState("Loading...");

  // Diagnostics (kept)
  const [lastLoadErrors, setLastLoadErrors] = useState([]);
  const [lastLoadAt, setLastLoadAt] = useState(null);

  const [players, setPlayers] = useState([]);
  const [scores, setScores] = useState([]);

  // Multi-Game (Stage 2: loaded + computed, not yet rendered anywhere)
  const [games, setGames] = useState([]);
  const [gameTeams, setGameTeams] = useState([]);
  const [gameTeamMembers, setGameTeamMembers] = useState([]);
  const [appSettings, setAppSettings] = useState({
    multi_game_enabled: false,
    multi_round_enabled: false,
    event_name: "The Ginvitational",
    handicap_basis: "course",
  });

  // Multi-Round
  const [rounds, setRounds] = useState([]);

  // Broadcast
  const [broadcastMsgs, setBroadcastMsgs] = useState([]);
  const [broadcastLoaded, setBroadcastLoaded] = useState(false);
  const [acePopup, setAcePopup] = useState(null);
  // Admin → Danger Zone
  const [dangerUnlocked, setDangerUnlocked] = useState(false);
  const [dangerPin, setDangerPin] = useState("");
  const [dangerPinMsg, setDangerPinMsg] = useState("");
  const [clearMsg, setClearMsg] = useState("");
  const [clearNeedsSetup, setClearNeedsSetup] = useState(false);

  // Leaderboard scorecard modal
  const [scorecardPlayerId, setScorecardPlayerId] = useState(null);

  // Leaderboard: which game tab is showing (only relevant when >1 active game)
  const [selectedGameId, setSelectedGameId] = useState(null);

  // Leaderboard: which round is showing (null => defaults to the active round)
  const [selectedRoundId, setSelectedRoundId] = useState(null);

  // Admin gate
  const [adminPin, setAdminPin] = useState("");
  const [adminOn, setAdminOn] = useState(false);
  const [printAllOn, setPrintAllOn] = useState(false);
  // Which active game's handicap rule the printed scorecards should match.
  // Defaults to the same game the Leaderboard defaults to (the first active
  // game, by sort order) — see `printGame` below.
  const [printGameId, setPrintGameId] = useState(null);

  // Admin: editable event name
  const [eventNameDraft, setEventNameDraft] = useState("");
  const [eventNameMsg, setEventNameMsg] = useState("");

  // Admin: editable tagline + uploadable main logo. `brandingReady` is false
  // until the one-time database change (migration 0010) has been made.
  const [brandingReady, setBrandingReady] = useState(true);
  const [taglineDraft, setTaglineDraft] = useState("");
  const [taglineMsg, setTaglineMsg] = useState("");
  const [logoDraft, setLogoDraft] = useState(null); // data URL awaiting "Save logo"
  const [logoMsg, setLogoMsg] = useState("");

  // Foursomes data (admin + enter scores)
  const [foursomes, setFoursomes] = useState([]);
  const [foursomePlayers, setFoursomePlayers] = useState([]);

  // Enter Scores: foursome code gate
  const [entryCode, setEntryCode] = useState("");
  const [activeFoursome, setActiveFoursome] = useState(null);
  const [activePlayers, setActivePlayers] = useState([]);

  // Enter Scores: hole-by-hole typing UI
  const [hole, setHole] = useState(1);
  const [holeInputs, setHoleInputs] = useState({});
  // True once this foursome has wrapped all the way back around to their
  // starting hole after entering their 18th hole (shotgun starts).
  const [roundComplete, setRoundComplete] = useState(false);

  // Admin: Excel import (tee sheet)
  const [teeSheetFile, setTeeSheetFile] = useState(null);
  const [teeSheetRows, setTeeSheetRows] = useState([]);
  // Foursomes sanity-check list is collapsed by default — after an import,
  // most visits to Admin don't need every player re-scanned every time.

  // Admin: which of the setup sections (Event Name, Import, Games, etc.) is
  // expanded — only one at a time, so the page shows one decision at a time
  // instead of everything at once. Set on PIN unlock in enterAdmin().
  const [openAdminSection, setOpenAdminSection] = useState(null);
  // "Build on my phone" setup flow replaces the Admin accordion while open.
  const [phoneSetupOn, setPhoneSetupOn] = useState(false);
  const [importReplaceFoursomes, setImportReplaceFoursomes] = useState(true);
  const [importMsg, setImportMsg] = useState("");
  const [importRoundId, setImportRoundId] = useState(null);

  // Admin: Multi-Game setup (Stage 3)
  const [newGameFormat, setNewGameFormat] = useState("individual_net");
  const [newGamePresetKey, setNewGamePresetKey] = useState(null);
  const [newGameName, setNewGameName] = useState("");
  const [newGameHandicapPct, setNewGameHandicapPct] = useState(100);
  const [newGameAdvancedOn, setNewGameAdvancedOn] = useState(false);
  const [newGameScoresCounted, setNewGameScoresCounted] = useState(1);
  const [newGameSlots, setNewGameSlots] = useState(["net"]);
  const [gamesMsg, setGamesMsg] = useState("");

  // Admin: Composite (multi-format) game builder
  const [newGameTeamSize, setNewGameTeamSize] = useState(2);
  const [newGameSegments, setNewGameSegments] = useState([]);

  // Admin: Scramble ranked handicap-% builder (lowest handicap on the
  // team through highest — length matches the format's team size)
  const [newGameScramblePcts, setNewGameScramblePcts] = useState(SCRAMBLE_DEFAULT_PCTS.scramble_2);

  // Admin: Rounds
  const [newRoundLabel, setNewRoundLabel] = useState("");
  const [roundsMsg, setRoundsMsg] = useState("");

  async function loadPlayers() {
    const { data, error } = await supabase
      .from("players")
      .select("id,name,handicap,charity,team_label,created_at")
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
      .select("id,player_id,hole,score,round_id,created_at")
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
      .select("id,group_name,code,tee_time,starting_hole,round_id,created_at")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("loadFoursomes error:", error);
      return { ok: false, where: "foursomes", error: errToText(error) };
    }
    setFoursomes(data || []);
    return { ok: true, where: "foursomes" };
  }

  async function loadRounds() {
    const { data, error } = await supabase
      .from("rounds")
      .select("id,label,sort_order,is_active,created_at")
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("loadRounds error:", error);
      return { ok: false, where: "rounds", error: errToText(error) };
    }
    setRounds(data || []);
    return { ok: true, where: "rounds" };
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

  async function loadGames() {
    const { data, error } = await supabase
      .from("games")
      .select(
        "id,name,format,handicap_pct,counting_rule,segments,handicap_allowance,is_default,active,locked,sort_order,created_at"
      )
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("loadGames error:", error);
      return { ok: false, where: "games", error: errToText(error) };
    }
    setGames(data || []);
    return { ok: true, where: "games" };
  }

  async function loadGameTeams() {
    const { data, error } = await supabase
      .from("game_teams")
      .select("id,game_id,name,created_at")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("loadGameTeams error:", error);
      return { ok: false, where: "game_teams", error: errToText(error) };
    }
    setGameTeams(data || []);
    return { ok: true, where: "game_teams" };
  }

  async function loadGameTeamMembers() {
    const { data, error } = await supabase
      .from("game_team_members")
      .select("game_id,team_id,player_id,created_at")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("loadGameTeamMembers error:", error);
      return { ok: false, where: "game_team_members", error: errToText(error) };
    }
    setGameTeamMembers(data || []);
    return { ok: true, where: "game_team_members" };
  }

  async function loadAppSettings() {
    const baseCols = "id,multi_game_enabled,multi_round_enabled,event_name,handicap_basis,updated_at";

    // Ask for the tagline/logo columns too. Until migration 0010 has been run
    // they don't exist and that query fails — so fall back to the original
    // columns instead of taking the whole app down.
    let { data, error } = await supabase
      .from("app_settings")
      .select(`${baseCols},tagline,logo_data`)
      .eq("id", 1)
      .maybeSingle();
    const brandingColumnsExist = !error;
    if (error) {
      ({ data, error } = await supabase.from("app_settings").select(baseCols).eq("id", 1).maybeSingle());
    }

    if (error) {
      console.error("loadAppSettings error:", error);
      return { ok: false, where: "app_settings", error: errToText(error) };
    }
    setBrandingReady(brandingColumnsExist);
    setAppSettings(
      data || {
        multi_game_enabled: false,
        multi_round_enabled: false,
        event_name: "The Ginvitational",
        handicap_basis: "course",
      }
    );
    return { ok: true, where: "app_settings" };
  }

  async function loadBroadcast() {
    // newest first
    const { data, error } = await supabase
      .from("broadcast_messages")
      .select("id,created_at,kind,text,player_id,dedupe_key")
      .order("created_at", { ascending: false })
      .limit(400);

    if (error) {
      console.error("loadBroadcast error:", error);
      return { ok: false, where: "broadcast_messages", error: errToText(error) };
    }
    setBroadcastMsgs(data || []);
    setBroadcastLoaded(true);
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
    results.push(await loadGames());
    results.push(await loadGameTeams());
    results.push(await loadGameTeamMembers());
    results.push(await loadRounds());
    results.push(await loadAppSettings());

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
  }, [tab]);

  // TV Mode: the standings and the broadcast strip each refresh on their own
  // timer, with an immediate refresh on entry, so nobody has to touch the TV.
  useEffect(() => {
    if (tab !== "tv") return;
    const refreshStandings = async () => {
      await loadPlayers();
      await loadScores();
      await loadGames(); // picks up a game being locked/unlocked
    };
    refreshStandings();
    loadBroadcast();
    const standingsId = setInterval(refreshStandings, 30_000);
    const broadcastId = setInterval(loadBroadcast, 45_000);
    return () => {
      clearInterval(standingsId);
      clearInterval(broadcastId);
    };
  }, [tab]);

  useEffect(() => {
  const handler = () => setPrintAllOn(false);
  window.addEventListener("afterprint", handler);
  return () => window.removeEventListener("afterprint", handler);
}, []);

  // Event name, editable from Admin — shown on Home, the top nav, print
  // scorecards, and the browser tab title.
  const eventName = appSettings.event_name || "The Ginvitational";

  // The "Connected ✅" status is an admin detail. Everywhere else it stays
  // hidden — except a failure, which is worth seeing wherever it happens.
  const visibleStatus = tab === "admin" || status.startsWith("FAIL") ? status : "";

  useEffect(() => {
    if (typeof document !== "undefined") document.title = eventName;
  }, [eventName]);

  // Keep the Admin draft in sync with the saved value (e.g. after a save,
  // or on initial load), without clobbering what's being typed elsewhere.
  useEffect(() => {
    setEventNameDraft(eventName);
  }, [eventName]);

  // Tagline: not set yet (null) means the default; saved blank means none.
  const tagline = appSettings.tagline == null ? DEFAULT_TAGLINE : appSettings.tagline.trim();
  useEffect(() => {
    setTaglineDraft(tagline);
  }, [tagline]);

  // Main logo: the uploaded one if there is one, else the built-in spool.
  const customLogo = !!appSettings.logo_data;
  const logoSrc = appSettings.logo_data || "/logo.png";

  // Carry a custom logo to the browser tab icon and the iOS "Add to Home
  // Screen" icon too (the originals are put back if it's reset). An app that
  // was already installed to a home screen keeps the icon it was installed
  // with — that one comes from the install manifest, not from this page.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]').forEach((el) => {
      if (el.dataset.origHref === undefined) {
        el.dataset.origHref = el.getAttribute("href") || "";
        el.dataset.origType = el.getAttribute("type") || "";
      }
      el.setAttribute("href", appSettings.logo_data || el.dataset.origHref);
      if (appSettings.logo_data) el.setAttribute("type", "image/png");
      else if (el.dataset.origType) el.setAttribute("type", el.dataset.origType);
      else el.removeAttribute("type");
    });
  }, [appSettings.logo_data]);

  // Field-Relative handicap basis: every player's handicap minus the lowest
  // handicap among everyone imported for the event (0 in Course Handicap
  // mode, the default). A negative fieldOffset (the lowest in the field is
  // itself a plus handicap) raises everyone else's number; a positive one
  // lowers it. Used everywhere a handicap feeds into stroke/net-score math —
  // never for the raw "HCP" badges players see next to their name.
  const fieldOffset = useMemo(() => {
    if (appSettings.handicap_basis !== "field_relative") return 0;
    if (!players.length) return 0;
    return Math.min(...players.map((p) => clampInt(p.handicap, 0)));
  }, [players, appSettings.handicap_basis]);

  const leaderboardRows = useMemo(
    () => buildLeaderboardRows(players, scores, rounds.find((r) => r.is_active)?.id ?? null, fieldOffset),
    [players, scores, rounds, fieldOffset]
  );

  // --- Multi-Game (Stage 2) ---
  // Computed alongside the original leaderboardRows above, which is left
  // untouched. Nothing renders from this yet (see Stage 4).
  const playersById = useMemo(() => {
    const m = new Map();
    for (const p of players) m.set(p.id, p);
    return m;
  }, [players]);

  const teamMembersByTeamMap = useMemo(() => {
    const m = new Map();
    for (const row of gameTeamMembers) {
      if (!m.has(row.team_id)) m.set(row.team_id, []);
      m.get(row.team_id).push(row.player_id);
    }
    return m;
  }, [gameTeamMembers]);

  const activeRound = useMemo(() => rounds.find((r) => r.is_active) || rounds[0] || null, [rounds]);

  // The game printed scorecards match. Defaults to the same game the
  // Leaderboard defaults to (the first active game, by sort order).
  const printGame = useMemo(() => {
    const activeGames = games.filter((g) => g.active);
    return activeGames.find((g) => g.id === printGameId) || activeGames[0] || null;
  }, [games, printGameId]);

  // { [roundId]: Map(playerId -> {hole: grossScore}) } — one scoped map per round.
  const scoresByRoundThenPlayer = useMemo(() => {
    const map = new Map();
    for (const r of rounds) map.set(r.id, buildScoresByPlayer(scores, r.id));
    return map;
  }, [scores, rounds]);

  const gameResults = useMemo(() => {
    const activeGames = games.filter((g) => g.active);
    const ctxBase = {
      players,
      teams: gameTeams,
      teamMembersByTeam: teamMembersByTeamMap,
      playersById,
      PARS,
      STROKE_INDEX,
      fieldOffset,
    };

    const roundSelection = selectedRoundId || activeRound?.id || null;

    if (roundSelection === ROUND_OVERALL) {
      return activeGames.map((game) => {
        const perRoundRows = rounds.map((r) =>
          computeGameRows(game, { ...ctxBase, scoresByPlayer: scoresByRoundThenPlayer.get(r.id) || new Map() })
        );
        return { game, rows: mergeGameRowsAcrossRounds(perRoundRows) };
      });
    }

    const scoresByPlayer = roundSelection
      ? scoresByRoundThenPlayer.get(roundSelection) || new Map()
      : buildScoresByPlayer(scores); // rounds not loaded yet — fall back to unscoped

    return activeGames.map((game) => ({
      game,
      rows: computeGameRows(game, { ...ctxBase, scoresByPlayer }),
    }));
  }, [
    games,
    gameTeams,
    teamMembersByTeamMap,
    players,
    playersById,
    rounds,
    scoresByRoundThenPlayer,
    selectedRoundId,
    activeRound,
    scores,
    fieldOffset,
  ]);

  // Temporary Stage 2 verification hook: lets us confirm gameResults
  // matches the live leaderboard before anything is wired to the UI.
  // Safe to remove once Stage 4 renders gameResults directly.
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.__gameResults = gameResults;
      window.__appSettings = appSettings;
    }
  }, [gameResults, appSettings]);

  const scorecardPlayer = useMemo(() => {
    if (!scorecardPlayerId) return null;
    return leaderboardRows.find((r) => r.id === scorecardPlayerId) || null;
  }, [scorecardPlayerId, leaderboardRows]);

  // TV Mode flames/ice cubes: { [playerId]: "fire" | "ice" }. Each group's
  // starting hole decides which holes count as their "most recent" ones.
  const tvForms = useMemo(() => {
    const roundId = activeRound?.id;
    const startByFoursome = new Map(
      foursomes.filter((f) => !f.round_id || f.round_id === roundId).map((f) => [f.id, f.starting_hole])
    );
    const startByPlayer = new Map();
    for (const fp of foursomePlayers) {
      if (startByFoursome.has(fp.foursome_id)) startByPlayer.set(fp.player_id, startByFoursome.get(fp.foursome_id));
    }
    const out = {};
    for (const p of leaderboardRows) {
      const form = formStreak(p, startByPlayer.get(p.id));
      if (form) out[p.id] = form;
    }
    return out;
  }, [leaderboardRows, foursomes, foursomePlayers, activeRound]);

  /** -----------------------
   *  THE BROADCAST
   *  What counts as a "moment" lives in ./lib/broadcastEngine (pure and
   *  tested). This just feeds it the data that is already loaded and saves
   *  whatever it decides. It runs whenever the scores change (a save here, or
   *  a refresh from anyone's phone) — not on a timer — and every card has a
   *  unique key in the database, so two phones can never post the same one.
   * ----------------------*/

  // The tick reads everything from this ref so it always sees the latest data,
  // not whatever was loaded when the function was created.
  const liveRef = useRef(null);
  const tickBusyRef = useRef(false);
  useEffect(() => {
    liveRef.current = { leaderboardRows, scores, players, rounds, foursomes, foursomePlayers, broadcastMsgs, eventName, fieldOffset };
  });

  async function insertBroadcastRows(rows) {
    for (const r of rows) {
      const { error } = await supabase
        .from("broadcast_messages")
        .insert({ kind: r.kind, text: r.text, player_id: r.playerId, dedupe_key: safeDedupeKey(r.dedupe) });
      if (!error) continue;
      const msg = errToText(error).toLowerCase();
      if (msg.includes("duplicate") || msg.includes("unique")) continue; // another phone got there first
      console.error("insertBroadcast error:", error);
    }
  }

  async function runBroadcastTick() {
    const s = liveRef.current;
    if (!s || tickBusyRef.current || s.leaderboardRows.length === 0) return;
    tickBusyRef.current = true;
    try {
      const now = Date.now();
      const roundId = s.rounds.find((r) => r.is_active)?.id ?? null;

      // Which group each player is in this round, and where that group starts.
      const roundFoursomes = new Map(
        s.foursomes.filter((f) => !f.round_id || f.round_id === roundId).map((f) => [f.id, f])
      );
      const startByPlayer = new Map();
      const groupByPlayer = new Map();
      for (const fp of s.foursomePlayers) {
        const f = roundFoursomes.get(fp.foursome_id);
        if (!f) continue;
        startByPlayer.set(fp.player_id, f.starting_hole);
        groupByPlayer.set(fp.player_id, f.group_name);
      }

      const scoreTimes = {};
      for (const sc of s.scores) {
        if (roundId != null && sc.round_id !== roundId) continue;
        scoreTimes[`${sc.player_id}|${sc.hole}`] = new Date(sc.created_at).getTime();
      }

      const rows = s.leaderboardRows.map((r) => {
        const vsPar = {};
        for (const [h, g] of Object.entries(r.scoresByHole)) {
          vsPar[h] = netScoreForHole(g, r.playingHandicap, Number(h)) - PARS[Number(h) - 1];
        }
        return {
          id: r.id,
          name: r.name,
          holesPlayed: r.holesPlayed,
          netToPar: r.netToPar,
          displayRank: r.displayRank,
          gross: r.scoresByHole,
          vsPar,
          startHole: startByPlayer.get(r.id) ?? 1,
          group: groupByPlayer.get(r.id) || null,
        };
      });

      // "Standings a few minutes ago": the same leaderboard math, ignoring scores saved since.
      const prevRows = buildLeaderboardRows(s.players, s.scores, roundId, s.fieldOffset, now - SWING_WINDOW_MS);
      const prevRanks = new Map(prevRows.filter((r) => r.holesPlayed > 0).map((r) => [r.id, r.displayRank]));
      const fieldIds = new Set(startByPlayer.keys());

      const events = computeBroadcastEvents({
        now,
        eventName: s.eventName,
        roundId,
        pars: PARS,
        rows,
        scoreTimes,
        prevRanks,
        fieldIds,
        messages: s.broadcastMsgs,
      });
      if (events.length === 0) return;
      await insertBroadcastRows(planPosts(events, { now, messages: s.broadcastMsgs }));
      await loadBroadcast();
    } finally {
      tickBusyRef.current = false;
    }
  }

  // Check for new cards whenever fresh scores/players arrive (and once the saved log has loaded).
  useEffect(() => {
    if (!broadcastLoaded) return;
    runBroadcastTick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scores, players, broadcastLoaded]);

  // Every open phone picks up new cards (and a hole-in-one popup) within ~30 seconds.
  useEffect(() => {
    const id = setInterval(loadBroadcast, 30_000);
    return () => clearInterval(id);
  }, []);

  // Keep players/scores fresh for anyone just sitting on another tab.
  useEffect(() => {
    const id = setInterval(async () => {
      await loadPlayers();
      await loadScores();
    }, 180_000);
    return () => clearInterval(id);
  }, []);

  // Hole-in-one popup: the newest ace from the last 10 minutes this phone hasn't dismissed yet.
  useEffect(() => {
    if (acePopup) return;
    const seen = readSeenAces();
    const m = broadcastMsgs.find(
      (x) => x.kind === "ace" && Date.now() - new Date(x.created_at).getTime() < ACE_POPUP_MS && !seen.includes(x.id)
    );
    if (m) setAcePopup(m);
  }, [broadcastMsgs, acePopup]);

  function dismissAce() {
    if (acePopup) rememberSeenAce(acePopup.id);
    setAcePopup(null);
  }

  // Cards the feed and TV Mode show (hidden rows only exist so nothing is announced twice).
  const visibleBroadcast = useMemo(
    () => broadcastMsgs.filter((m) => !String(m.kind || "").startsWith("hidden_")),
    [broadcastMsgs]
  );

  // Admin → Danger Zone → Clear all messages
  async function clearBroadcastMessages() {
    if (!adminOn) return alert("Admin only.");
    const head = await supabase.from("broadcast_messages").select("id", { count: "exact", head: true });
    const total = head.count ?? broadcastMsgs.length;
    if (!total) {
      setClearMsg("There are no Broadcast messages to clear.");
      return;
    }
    if (!confirm(`Delete all ${total} Broadcast messages? This can't be undone.`)) return;
    setClearMsg("Clearing…");
    const { data, error } = await supabase
      .from("broadcast_messages")
      .delete()
      .gte("created_at", "1970-01-01T00:00:00Z")
      .select("id");
    if (error) {
      console.error(error);
      setClearMsg(`Error clearing messages: ${errToText(error)}`);
      return;
    }
    if ((data || []).length === 0) {
      // The database accepted the request but removed nothing: delete isn't allowed yet.
      setClearNeedsSetup(true);
      setClearMsg("Nothing was deleted. The database needs a one-time permission first (see below).");
      return;
    }
    setClearNeedsSetup(false);
    await loadBroadcast();
    setClearMsg(`Cleared ${data.length} messages ✅`);
  }

  function unlockDanger() {
    if (dangerPin === ADMIN_PIN) {
      setDangerUnlocked(true);
      setDangerPin("");
      setDangerPinMsg("");
    } else {
      setDangerPinMsg("Wrong passcode.");
      setDangerPin("");
    }
  }

  function enterAdmin() {
    if (adminPin === ADMIN_PIN) {
      setAdminOn(true);
      setAdminPin("");
      setTab("admin");
      // First-run: nothing imported yet, so open straight to "Start a
      // Tournament". Once an event is set up, start collapsed and let them
      // pick what to tweak.
      setOpenAdminSection(foursomes.length === 0 ? "start" : null);
    } else {
      alert("Wrong PIN");
    }
  }

  // Deletes players along with everything that points at them (their scores,
  // their group spots, any game-team spots and their Broadcast cards).
  async function deletePlayers(ids) {
    if (!adminOn) return "Admin only.";
    for (let i = 0; i < ids.length; i += 40) {
      const part = ids.slice(i, i + 40);
      await supabase.from("broadcast_messages").delete().in("player_id", part); // best effort
      for (const table of ["foursome_players", "scores", "game_team_members"]) {
        const { error } = await supabase.from(table).delete().in("player_id", part);
        if (error) {
          console.error(error);
          return `Error removing ${table}: ${errToText(error)}`;
        }
      }
      const { data, error } = await supabase.from("players").delete().in("id", part).select("id");
      if (error) {
        console.error(error);
        return `Error deleting players: ${errToText(error)}`;
      }
      if ((data || []).length < part.length) {
        await initialLoad();
        return "Some players could not be deleted (the database refused). Reload and check the list.";
      }
    }
    await initialLoad();
    return `Deleted ${ids.length} player${ids.length === 1 ? "" : "s"} ✅`;
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

  // ---------------------------
  // MULTI-GAME (Stage 3: Admin)
  // ---------------------------

  async function setMultiGameEnabled(next) {
    if (!adminOn) return alert("Admin only.");
    const { error } = await supabase
      .from("app_settings")
      .update({ multi_game_enabled: next, updated_at: new Date().toISOString() })
      .eq("id", 1);

    if (error) {
      console.error(error);
      alert(`Error updating setting: ${errToText(error)}`);
      return;
    }
    await loadAppSettings();
  }

  // 'course': everyone's own handicap, as entered.
  // 'field_relative': everyone's handicap minus the lowest handicap among
  // every player imported for the event, so the best player in the field
  // plays to scratch. Affects the Leaderboard, print scorecards, and the
  // scorecard popup — see `fieldOffset` below.
  async function setHandicapBasis(next) {
    if (!adminOn) return alert("Admin only.");
    const { error } = await supabase
      .from("app_settings")
      .update({ handicap_basis: next, updated_at: new Date().toISOString() })
      .eq("id", 1);

    if (error) {
      console.error(error);
      alert(`Error updating setting: ${errToText(error)}`);
      return;
    }
    await loadAppSettings();
  }

  async function saveEventName() {
    if (!adminOn) return alert("Admin only.");
    const name = eventNameDraft.trim() || "The Ginvitational";
    setEventNameMsg("Saving…");

    const { error } = await supabase
      .from("app_settings")
      .update({ event_name: name, updated_at: new Date().toISOString() })
      .eq("id", 1);

    if (error) {
      console.error(error);
      setEventNameMsg(`Error saving: ${errToText(error)}`);
      return;
    }
    await loadAppSettings();
    setEventNameMsg("Saved ✅");
  }

  async function saveTagline() {
    if (!adminOn) return alert("Admin only.");
    setTaglineMsg("Saving…");

    // Blank is allowed and means "no tagline" (stored as "", not null — null
    // is reserved for "never set", which shows the default).
    const { error } = await supabase
      .from("app_settings")
      .update({ tagline: taglineDraft.trim(), updated_at: new Date().toISOString() })
      .eq("id", 1);

    if (error) {
      console.error(error);
      setTaglineMsg(`Error saving: ${errToText(error)}`);
      return;
    }
    await loadAppSettings();
    setTaglineMsg("Saved ✅");
  }

  async function onLogoPicked(file) {
    if (!file) return;
    setLogoMsg("Processing…");
    try {
      setLogoDraft(await fileToLogoDataUrl(file));
      setLogoMsg("Preview above — click Save logo to use it everywhere.");
    } catch (e) {
      setLogoDraft(null);
      setLogoMsg(e.message || "Couldn't use that image.");
    }
  }

  async function saveLogo(nextLogoData) {
    if (!adminOn) return alert("Admin only.");
    setLogoMsg("Saving…");

    const { error } = await supabase
      .from("app_settings")
      .update({ logo_data: nextLogoData, updated_at: new Date().toISOString() })
      .eq("id", 1);

    if (error) {
      console.error(error);
      setLogoMsg(`Error saving: ${errToText(error)}`);
      return;
    }
    setLogoDraft(null);
    await loadAppSettings();
    setLogoMsg(nextLogoData ? "Saved ✅ — the new logo is live." : "Back to the default logo ✅");
  }

  async function setMultiRoundEnabled(next) {
    if (!adminOn) return alert("Admin only.");
    const { error } = await supabase
      .from("app_settings")
      .update({ multi_round_enabled: next, updated_at: new Date().toISOString() })
      .eq("id", 1);

    if (error) {
      console.error(error);
      alert(`Error updating setting: ${errToText(error)}`);
      return;
    }
    await loadAppSettings();
  }

  async function createRound() {
    if (!adminOn) return alert("Admin only.");
    const label = newRoundLabel.trim() || `Round ${rounds.length + 1}`;

    const { error } = await supabase.from("rounds").insert({
      label,
      sort_order: rounds.length,
      is_active: false,
    });

    if (error) {
      console.error(error);
      setRoundsMsg(`Error creating round: ${errToText(error)}`);
      return;
    }
    setNewRoundLabel("");
    setRoundsMsg(`"${label}" created ✅`);
    await loadRounds();
  }

  async function setRoundActive(round) {
    if (!adminOn) return alert("Admin only.");

    const clear = await supabase.from("rounds").update({ is_active: false }).eq("is_active", true);
    if (clear.error) {
      console.error(clear.error);
      setRoundsMsg(`Error updating rounds: ${errToText(clear.error)}`);
      return;
    }

    const { error } = await supabase.from("rounds").update({ is_active: true }).eq("id", round.id);
    if (error) {
      console.error(error);
      setRoundsMsg(`Error updating rounds: ${errToText(error)}`);
      return;
    }
    await loadRounds();
  }

  async function deleteRound(round) {
    if (!adminOn) return alert("Admin only.");
    if (rounds.length <= 1) return alert("At least one round must remain.");
    if (
      !confirm(
        `Delete "${round.label}"? This also removes its foursomes and every score entered for it. This can't be undone.`
      )
    )
      return;

    await supabase.from("foursome_players").delete().in(
      "foursome_id",
      foursomes.filter((f) => f.round_id === round.id).map((f) => f.id)
    );
    await supabase.from("foursomes").delete().eq("round_id", round.id);
    await supabase.from("scores").delete().eq("round_id", round.id);

    const { error } = await supabase.from("rounds").delete().eq("id", round.id);
    if (error) {
      console.error(error);
      setRoundsMsg(`Error deleting round: ${errToText(error)}`);
      return;
    }

    if (round.is_active) {
      const nextRound = rounds.find((r) => r.id !== round.id);
      if (nextRound) await setRoundActive(nextRound);
    }

    await initialLoad();
  }

  function applyPreset(preset) {
    setNewGamePresetKey(preset.key);
    setNewGameHandicapPct(preset.handicapPct);
    setNewGameScoresCounted(preset.scoresCounted);
    setNewGameSlots(preset.slots);
    setNewGameAdvancedOn(false);
  }

  function selectNewGameFormat(format) {
    setNewGameFormat(format);
    setNewGameName(GAME_FORMAT_LABELS[format]);

    if (format === "composite") {
      setNewGameTeamSize(2);
      setNewGameSegments([
        { fromHole: 1, toHole: 6, formatKey: "best_ball", handicapPct: 100, lowPct: 35, highPct: 15 },
        { fromHole: 7, toHole: 12, formatKey: "scramble", handicapPct: 100, lowPct: 35, highPct: 15 },
        { fromHole: 13, toHole: 18, formatKey: "combined", handicapPct: 100, lowPct: 35, highPct: 15 },
      ]);
      return;
    }

    if (format === "scramble_2" || format === "scramble_4") {
      setNewGameScramblePcts(SCRAMBLE_DEFAULT_PCTS[format]);
      return;
    }

    const presets = GAME_PRESETS[format] || [];
    if (presets[0]) applyPreset(presets[0]);
  }

  // --- Scramble ranked handicap-% builder ---
  function setScramblePct(index, value) {
    setNewGameScramblePcts((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  // --- Composite (multi-format) segment builder ---
  function addSegment() {
    setNewGameSegments((prev) => [
      ...prev,
      { fromHole: 1, toHole: 1, formatKey: "best_ball", handicapPct: 100, lowPct: 35, highPct: 15 },
    ]);
  }

  function updateSegment(index, patch) {
    setNewGameSegments((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function removeSegment(index) {
    setNewGameSegments((prev) => prev.filter((_, i) => i !== index));
  }

  /** Holes 1-18 not covered by any segment yet, for a non-blocking hint. */
  function segmentCoverageGaps(segments) {
    const covered = new Set();
    for (const s of segments) {
      const from = Math.min(clampInt(s.fromHole, 1), clampInt(s.toHole, 1));
      const to = Math.max(clampInt(s.fromHole, 1), clampInt(s.toHole, 1));
      for (let h = from; h <= to; h++) covered.add(h);
    }
    const gaps = [];
    for (let h = 1; h <= 18; h++) if (!covered.has(h)) gaps.push(h);
    return gaps;
  }

  // Advanced counting-rule builder: keep `slots` in sync with `scoresCounted`
  function setAdvancedScoresCounted(n) {
    const count = Math.min(4, Math.max(1, clampInt(n, 1)));
    setNewGameScoresCounted(count);
    setNewGameSlots((prev) => {
      const next = prev.slice(0, count);
      while (next.length < count) next.push("net");
      return next;
    });
  }

  function setAdvancedSlot(index, value) {
    setNewGameSlots((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  /** Groups current players by team_label, for the given team size. */
  function teamPreviewGroups(teamSize) {
    const byLabel = new Map();
    for (const p of players) {
      const label = String(p.team_label || "").trim();
      if (!label) continue;
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label).push(p);
    }
    return Array.from(byLabel.entries()).map(([label, members]) => ({
      label,
      members,
      mismatched: members.length !== teamSize,
    }));
  }

  async function createGame() {
    if (!adminOn) return alert("Admin only.");
    const name = newGameName.trim() || GAME_FORMAT_LABELS[newGameFormat];
    const isComposite = newGameFormat === "composite";
    const isScramble = newGameFormat === "scramble_2" || newGameFormat === "scramble_4";
    const handicap_pct = clampInt(newGameHandicapPct, 100);

    let counting_rule = null;
    let segments = null;
    let handicap_allowance = null;

    if (isScramble) {
      const teamSize = GAME_FORMAT_TEAM_SIZE[newGameFormat];
      const pcts = newGameScramblePcts.slice(0, teamSize).map((p) => clampInt(p, 0));
      if (pcts.length !== teamSize) {
        alert("Handicap % looks incomplete. Check every rank has a value.");
        return;
      }
      handicap_allowance = pcts;
    } else if (isComposite) {
      if (newGameSegments.length === 0) {
        alert("Add at least one segment first.");
        return;
      }
      segments = newGameSegments.map((s) => {
        const opt = SEGMENT_FORMAT_OPTIONS[s.formatKey] || SEGMENT_FORMAT_OPTIONS.best_ball;
        const from = Math.min(clampInt(s.fromHole, 1), clampInt(s.toHole, 1));
        const to = Math.max(clampInt(s.fromHole, 1), clampInt(s.toHole, 1));
        const holes = [];
        for (let h = from; h <= to; h++) holes.push(h);

        if (opt.kind === "shared") {
          return {
            holes,
            formatType: "shared",
            label: opt.label,
            handicapAllowance: { lowPct: clampInt(s.lowPct, 0), highPct: clampInt(s.highPct, 0) },
          };
        }
        return {
          holes,
          formatType: "individual",
          label: opt.label,
          countingRule: { scoresCounted: opt.scoresCounted, slots: opt.slots },
          handicapPct: clampInt(s.handicapPct, 100),
        };
      });
    } else {
      const scoresCounted = clampInt(newGameScoresCounted, 1);
      const slots = newGameSlots.slice(0, scoresCounted);
      if (slots.length !== scoresCounted) {
        alert("Counting rule looks incomplete. Check the advanced settings.");
        return;
      }
      counting_rule = { scoresCounted, slots };
    }

    const isTeamFormat =
      newGameFormat === "better_ball_2" || newGameFormat === "better_ball_4" || isScramble || isComposite;
    const teamSize = isComposite ? clampInt(newGameTeamSize, 2) : GAME_FORMAT_TEAM_SIZE[newGameFormat];
    const teamGroups = isTeamFormat ? teamPreviewGroups(teamSize).filter((g) => g.members.length > 0) : [];

    if (isTeamFormat && teamGroups.length === 0) {
      alert(
        "No team groupings found. Add a \"team\" column to your tee sheet (players sharing a value become a team) and re-import, then try again."
      );
      return;
    }

    setGamesMsg("Creating game…");

    const insertPayload = {
      name,
      format: newGameFormat,
      handicap_pct,
      is_default: false,
      active: true,
      sort_order: games.length,
    };
    if (isScramble) {
      insertPayload.handicap_allowance = handicap_allowance; // counting_rule keeps its DB default; unused for Scramble
    } else if (isComposite) {
      insertPayload.segments = segments; // counting_rule keeps its DB default; unused for composite games
    } else {
      insertPayload.counting_rule = counting_rule;
    }

    const { data: gameRow, error: gameError } = await supabase
      .from("games")
      .insert(insertPayload)
      .select("id")
      .single();

    if (gameError) {
      console.error(gameError);
      setGamesMsg(`Error creating game: ${errToText(gameError)}`);
      return;
    }

    if (isTeamFormat) {
      for (const group of teamGroups) {
        const { data: teamRow, error: teamError } = await supabase
          .from("game_teams")
          .insert({ game_id: gameRow.id, name: group.label })
          .select("id")
          .single();

        if (teamError) {
          console.error(teamError);
          setGamesMsg(`Game created, but error building team "${group.label}": ${errToText(teamError)}`);
          continue;
        }

        const memberRows = group.members.map((p) => ({
          game_id: gameRow.id,
          team_id: teamRow.id,
          player_id: p.id,
        }));

        const { error: memberError } = await supabase.from("game_team_members").insert(memberRows);
        if (memberError) {
          console.error(memberError);
          setGamesMsg(`Game created, but error assigning team "${group.label}": ${errToText(memberError)}`);
        }
      }
    }

    setGamesMsg(`"${name}" created ✅`);
    setNewGameName("");
    await loadGames();
    await loadGameTeams();
    await loadGameTeamMembers();
  }

  async function deleteGame(game) {
    if (!adminOn) return alert("Admin only.");
    if (!confirm(`Delete "${game.name}"? This also removes its team assignments (not players or scores).`)) return;

    const { error } = await supabase.from("games").delete().eq("id", game.id);
    if (error) {
      console.error(error);
      alert(`Error deleting game: ${errToText(error)}`);
      return;
    }
    await loadGames();
    await loadGameTeams();
    await loadGameTeamMembers();
  }

  async function toggleGameActive(game) {
    if (!adminOn) return alert("Admin only.");
    const { error } = await supabase.from("games").update({ active: !game.active }).eq("id", game.id);
    if (error) {
      console.error(error);
      alert(`Error updating game: ${errToText(error)}`);
      return;
    }
    await loadGames();
  }

  // Admin already passed the PIN gate to get here, so this is a free toggle
  // (no re-prompt) — the passcode gate lives on the public Leaderboard side.
  async function toggleGameLocked(game) {
    if (!adminOn) return alert("Admin only.");
    const { error } = await supabase.from("games").update({ locked: !game.locked }).eq("id", game.id);
    if (error) {
      console.error(error);
      alert(`Error updating game: ${errToText(error)}`);
      return;
    }
    await loadGames();
  }

  // Leaderboard-side unlock: anyone who knows the passcode can reveal a
  // locked board. Unlocking is global (persisted), matching how locking
  // itself works — meant for a "reveal to everyone" moment, not a private
  // per-viewer peek.
  async function unlockGameBoard(game, passcode) {
    if (passcode !== ADMIN_PIN) {
      return { ok: false, error: "Incorrect passcode." };
    }
    const { error } = await supabase.from("games").update({ locked: false }).eq("id", game.id);
    if (error) {
      console.error(error);
      return { ok: false, error: errToText(error) };
    }
    await loadGames();
    return { ok: true };
  }

  async function enterWithCode() {
    const code = entryCode.trim().toUpperCase();
    if (code.length !== 6) return alert("Enter a 6-character code.");

    const { data: f, error } = await supabase
      .from("foursomes")
      .select("id,group_name,code,tee_time,starting_hole,round_id")
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
    setHole(clampInt(f.starting_hole, 1));
    setHoleInputs({});
    setRoundComplete(false);
    setTab("enter");
  }

  function getExistingScore(pid, holeNum, roundId) {
    const row = scores.find(
      (s) => s.player_id === pid && clampInt(s.hole, 0) === holeNum && (roundId == null || s.round_id === roundId)
    );
    return row ? clampInt(row.score, 0) : null;
  }

  /**
   * Groups the active foursome's players for one hole's entry row(s).
   * Normally one group per player. But if this hole is shared scoring —
   * every hole in a standalone Scramble game, or a "shared" segment
   * (Scramble) of an active composite game — and 2+ of these players are
   * teammates in that game, they collapse into one shared group — same
   * score gets saved under every member (saveHoleThenNavigate doesn't need
   * to change: it already just writes whatever's in holeInputs[p.id] for
   * each player).
   */
  function holeEntryGroups(holeNum, playersInGroup) {
    for (const g of games) {
      if (!g.active) continue;

      const isScramble = g.format === "scramble_2" || g.format === "scramble_4";
      let isSharedHole = isScramble; // every hole is shared in a standalone Scramble game

      if (!isScramble) {
        if (g.format !== "composite") continue;
        const seg = (g.segments || []).find((s) => (s.holes || []).includes(holeNum));
        isSharedHole = !!seg && seg.formatType === "shared";
      }
      if (!isSharedHole) continue;

      const teamIdsForGame = new Set(gameTeams.filter((t) => t.game_id === g.id).map((t) => t.id));
      const membersByTeam = new Map();
      for (const row of gameTeamMembers) {
        if (!teamIdsForGame.has(row.team_id)) continue;
        if (!membersByTeam.has(row.team_id)) membersByTeam.set(row.team_id, []);
        membersByTeam.get(row.team_id).push(row.player_id);
      }

      const idsInGroup = new Set(playersInGroup.map((p) => p.id));
      const consumed = new Set();
      const groups = [];

      for (const memberIds of membersByTeam.values()) {
        const presentIds = memberIds.filter((pid) => idsInGroup.has(pid));
        if (presentIds.length >= 2) {
          const groupPlayers = presentIds.map((pid) => playersInGroup.find((p) => p.id === pid)).filter(Boolean);
          groups.push({ key: presentIds.join("-"), players: groupPlayers, shared: true });
          for (const pid of presentIds) consumed.add(pid);
        }
      }

      for (const p of playersInGroup) {
        if (!consumed.has(p.id)) groups.push({ key: p.id, players: [p], shared: false });
      }

      groups.sort((a, b) => playersInGroup.indexOf(a.players[0]) - playersInGroup.indexOf(b.players[0]));
      return groups;
    }

    return playersInGroup.map((p) => ({ key: p.id, players: [p], shared: false }));
  }

  useEffect(() => {
    if (!activeFoursome) return;
    const obj = {};
    for (const p of activePlayers) {
      const existing = getExistingScore(p.id, hole, activeFoursome.round_id);
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
        .upsert(
          { player_id: p.id, hole, score: sc, round_id: activeFoursome.round_id },
          { onConflict: "player_id,hole,round_id" }
        );

      if (error) {
        console.error(error);
        alert(`Error saving scores: ${errToText(error)}`);
        return;
      }
    }

    await loadScores();
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

function excelTimeToDbTime(v) {
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
  await runTeeSheetImport(teeSheetRows, { replace: importReplaceFoursomes, targetRoundId, say: setImportMsg });
}

async function runTeeSheetImport(rows, { replace, targetRoundId, say }) {
  try {
    // Optional wipe (you have this checkbox already) — scoped to this round only,
    // so re-importing for one round never touches another round's foursomes.
    if (replace) {
      const roundFoursomeIds = foursomes.filter((f) => f.round_id === targetRoundId).map((f) => f.id);

      if (roundFoursomeIds.length) {
        const delFP = await supabase.from("foursome_players").delete().in("foursome_id", roundFoursomeIds);
        if (delFP.error) {
          console.error(delFP.error);
          say(`Error clearing assignments: ${errToText(delFP.error)}`);
          return false;
        }
      }

      const delF = await supabase.from("foursomes").delete().eq("round_id", targetRoundId);

      if (delF.error) {
        console.error(delF.error);
        say(`Error clearing foursomes: ${errToText(delF.error)}`);
        return false;
      }
    }

    // ---------- Build desired players list from sheet ----------
    const desiredPlayers = [];
    for (const r of rows) {
      const name = fullNameFromRow(r);
      if (!name) continue;

      desiredPlayers.push({
        name,
        handicap: clampInt(r.handicap, 0),
        charity: String(r.charity || "").trim() || null,
        // The "team" column drives both the physical foursome (below) and
        // this — players sharing a value here are also the pool a
        // 2-man/4-man game's teams are built from. One column, one group.
        team_label: String(r.team || "").trim() || null,
      });
    }

    // ---------- Read fresh players from DB ----------
    const playersBefore = await supabase
      .from("players")
      .select("id,name,handicap,charity,team_label")
      .order("created_at", { ascending: true });

    if (playersBefore.error) {
      console.error(playersBefore.error);
      say(`Error reading players: ${errToText(playersBefore.error)}`);
      return false;
    }

    const existingByName = new Map(
      (playersBefore.data || []).map((p) => [String(p.name || "").trim().toLowerCase(), p])
    );

    // New players get inserted. Players already in the system get their
    // handicap/charity/team synced to match the sheet, so re-uploading a
    // corrected sheet actually fixes a typo instead of only adding new people.
    const missingPlayers = [];
    const updatedPlayers = [];
    for (const p of desiredPlayers) {
      const key = p.name.toLowerCase();
      const existing = existingByName.get(key);

      if (!existing) {
        existingByName.set(key, p);
        missingPlayers.push(p);
        continue;
      }

      const changed =
        clampInt(existing.handicap, 0) !== p.handicap ||
        (existing.charity || null) !== p.charity ||
        (existing.team_label || null) !== p.team_label;

      if (changed) {
        updatedPlayers.push({
          id: existing.id,
          name: p.name, // upsert still validates NOT NULL columns even on the update path
          handicap: p.handicap,
          charity: p.charity,
          team_label: p.team_label,
        });
      }
    }

    if (missingPlayers.length) {
      const insPlayers = await supabase.from("players").insert(missingPlayers);
      if (insPlayers.error) {
        console.error(insPlayers.error);
        say(`Error inserting players: ${errToText(insPlayers.error)}`);
        return false;
      }
    }

    if (updatedPlayers.length) {
      const updPlayers = await supabase.from("players").upsert(updatedPlayers, { onConflict: "id" });
      if (updPlayers.error) {
        console.error(updPlayers.error);
        say(`Error updating players: ${errToText(updPlayers.error)}`);
        return false;
      }
    }

    // Re-read players (fresh IDs)
    const playersAfter = await supabase
      .from("players")
      .select("id,name")
      .order("created_at", { ascending: true });

    if (playersAfter.error) {
      console.error(playersAfter.error);
      say(`Error reloading players: ${errToText(playersAfter.error)}`);
      return false;
    }

    const playerIdByName = new Map(
      (playersAfter.data || []).map((p) => [String(p.name || "").trim().toLowerCase(), p.id])
    );

    // ---------- Build group list + metadata from sheet ----------
    // "team" is the one column that drives grouping — the foursome (this
    // round's physical playing group + tee time/code) and the game-team
    // pool (players.team_label, above) are the same value on purpose.
    const groupsNeeded = Array.from(
      new Set(rows.map((r) => String(r.team || "").trim()).filter(Boolean))
    );

    const groupMeta = new Map();
    for (const r of rows) {
      const group_name = String(r.team || "").trim();
      if (!group_name) continue;

      if (!groupMeta.has(group_name.toLowerCase())) {
        const rawStart = Number(r.starting_hole);
        const safeStart = rawStart >= 1 && rawStart <= 18 ? Math.trunc(rawStart) : 1;

        groupMeta.set(group_name.toLowerCase(), {
          tee_time: excelTimeToDbTime(r.tee_time),
          starting_hole: safeStart,
        });
      }
    }

    // Read existing foursomes (fresh), scoped to this round
    const existingF = await supabase
      .from("foursomes")
      .select("id,group_name,code,tee_time,starting_hole,created_at")
      .eq("round_id", targetRoundId);

    if (existingF.error) {
      console.error(existingF.error);
      say(`Error reading foursomes: ${errToText(existingF.error)}`);
      return false;
    }

    const foursomeByGroup = new Map(
      (existingF.data || []).map((f) => [String(f.group_name || "").trim().toLowerCase(), f])
    );

    // ---------- Create missing foursomes using metadata ----------
    let newFoursomes = 0;

    for (const group_name of groupsNeeded) {
      const key = group_name.toLowerCase();
      if (foursomeByGroup.has(key)) continue;

      let created = null;
      const meta = groupMeta.get(key) || {};

      for (let tries = 0; tries < 10 && !created; tries++) {
        const code = makeCode(6);
        const res = await supabase
          .from("foursomes")
          .insert({
            group_name,
            code,
            tee_time: meta.tee_time ?? null,
            starting_hole: meta.starting_hole ?? 1,
            round_id: targetRoundId,
          })
          .select("id,group_name,code")
          .single();

        if (!res.error) created = res.data;
      }

      if (!created) {
        say(`Could not create foursome "${group_name}". (RLS / code unique / schema issue)`);
        return false;
      }

      newFoursomes += 1;
    }

    // Re-read foursomes (fresh IDs), scoped to this round
    const foursomesAfter = await supabase
      .from("foursomes")
      .select("id,group_name")
      .eq("round_id", targetRoundId)
      .order("created_at", { ascending: true });

    if (foursomesAfter.error) {
      console.error(foursomesAfter.error);
      say(`Error reloading foursomes: ${errToText(foursomesAfter.error)}`);
      return false;
    }

    const foursomeIdByGroup = new Map(
      (foursomesAfter.data || []).map((f) => [String(f.group_name || "").trim().toLowerCase(), f.id])
    );

    // ---------- Assign players to foursomes ----------
    const existingAssign = await supabase
      .from("foursome_players")
      .select("foursome_id,player_id");

    if (existingAssign.error) {
      console.error(existingAssign.error);
      say(`Error reading existing assignments: ${errToText(existingAssign.error)}`);
      return false;
    }

    const existingSet = new Set(
      (existingAssign.data || []).map((fp) => `${fp.foursome_id}::${fp.player_id}`)
    );

    const assignmentInserts = [];
    for (const r of rows) {
      const group = String(r.team || "").trim();
      const name = fullNameFromRow(r);
      if (!group || !name) continue;

      const fid = foursomeIdByGroup.get(group.toLowerCase());
      const pid = playerIdByName.get(name.toLowerCase());
      if (!fid || !pid) continue;

      const k = `${fid}::${pid}`;
      if (existingSet.has(k)) continue;

      existingSet.add(k);
      assignmentInserts.push({ foursome_id: fid, player_id: pid });
    }

    if (assignmentInserts.length) {
      const insFP = await supabase.from("foursome_players").insert(assignmentInserts);
      if (insFP.error) {
        console.error(insFP.error);
        say(`Error inserting assignments: ${errToText(insFP.error)}`);
        return false;
      }
    }

    // Refresh UI state after import
    await initialLoad();

    say(
      `Import complete ✅ New players: ${missingPlayers.length} • Updated players: ${updatedPlayers.length} • New foursomes: ${newFoursomes} • New assignments: ${assignmentInserts.length}`
    );
    return true;
  } catch (e) {
    console.error(e);
    say(`Import crashed: ${errToText(e)}`);
    return false;
  }
}

function PrintTwoUpScorecards({ foursomes, players, foursomePlayers, strokesOnHole, clampInt, lastName, STROKE_INDEX, eventName, logoSrc, game, fieldOffset }) {
  // members per foursome (up to 4)
  const membersByFid = new Map();
  for (const f of foursomes) {
    const pids = foursomePlayers.filter((fp) => fp.foursome_id === f.id).map((x) => x.player_id);
    const mem = players.filter((p) => pids.includes(p.id)).slice(0, 4);
    membersByFid.set(f.id, mem);
  }

  // Everyone starting on the same hole (just different tee times) → the tee
  // time is what tells the cards apart, so print that. If starting holes
  // differ (shotgun / split tees) → print the starting hole instead.
  const startHoles = new Set(foursomes.map((f) => String(f.starting_hole ?? "").trim() || "1"));
  const showTeeTime = startHoles.size <= 1;

  // 2 per page
  const pages = [];
  for (let i = 0; i < foursomes.length; i += 2) pages.push([foursomes[i], foursomes[i + 1] || null]);

  return (
    <div id="printRoot" style={ps.root}>
      {pages.map((pair, idx) => (
        <div className="printPage" key={idx} style={ps.page}>
          <div style={ps.twoUpRow}>
            <div style={ps.col}>
              {pair[0] && (
                <PrintOneGroupCard
                  f={pair[0]}
                  members={membersByFid.get(pair[0].id) || []}
                  showTeeTime={showTeeTime}
                  strokesOnHole={strokesOnHole}
                  clampInt={clampInt}
                  lastName={lastName}
                  STROKE_INDEX={STROKE_INDEX}
                  eventName={eventName}
                  logoSrc={logoSrc}
                  game={game}
                  fieldOffset={fieldOffset}
                />
              )}
            </div>

            <div style={ps.col}>
              {pair[1] && (
                <PrintOneGroupCard
                  f={pair[1]}
                  members={membersByFid.get(pair[1].id) || []}
                  showTeeTime={showTeeTime}
                  strokesOnHole={strokesOnHole}
                  clampInt={clampInt}
                  lastName={lastName}
                  STROKE_INDEX={STROKE_INDEX}
                  eventName={eventName}
                  logoSrc={logoSrc}
                  game={game}
                  fieldOffset={fieldOffset}
                />
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PrintOneGroupCard({ f, members, showTeeTime, strokesOnHole, clampInt, lastName, STROKE_INDEX, eventName, logoSrc, game, fieldOffset }) {
  const cols = [0, 1, 2, 3].map((i) => members[i] || null);
  const offset = clampInt(fieldOffset, 0);

  // The handicap % that applies to hole `h` for the selected game. A simple
  // format (Individual Net/Gross, Better Ball) uses one flat % for every
  // hole. A composite (Multi-Format Round) game applies a different % per
  // hole segment. A "shared" segment (Scramble) uses one blended TEAM
  // handicap rather than each player's own — the print card doesn't have
  // team-pairing data to know who's on a team with whom, so those holes are
  // intentionally left without dots rather than guessing wrong.
  function pctForHole(h) {
    if (game && (game.format === "scramble_2" || game.format === "scramble_4")) return { pct: null, shared: true };
    if (!game || game.format !== "composite") return { pct: clampInt(game?.handicap_pct, 100), shared: false };
    const seg = (game.segments || []).find((s) => (s.holes || []).includes(h));
    if (!seg) return { pct: 100, shared: false };
    if (seg.formatType === "shared") return { pct: null, shared: true };
    return { pct: clampInt(seg.handicapPct, 100), shared: false };
  }

  const hasSharedHoles =
    game?.format === "scramble_2" ||
    game?.format === "scramble_4" ||
    (game?.format === "composite" && (game.segments || []).some((s) => s.formatType === "shared"));

  // "•" for a received stroke, "+" for a plus-handicap player giving one back.
  const dotStr = (n) => (n > 0 ? "•".repeat(n) : n < 0 ? "+".repeat(-n) : "");

  const holeRows = (start, end) =>
    Array.from({ length: end - start + 1 }, (_, k) => {
      const h = start + k;
      const { pct, shared } = pctForHole(h);
      return (
        <tr key={h}>
          <td style={ps.tdHole}>{h}</td>
          <td style={ps.tdHi}>{STROKE_INDEX[h - 1]}</td>

          {cols.map((p, i) => {
            const playingHcp = p && !shared ? Math.round((clampInt(p.handicap, 0) - offset) * (pct / 100)) : 0;
            const strokes = p && !shared ? strokesOnHole(playingHcp, h) : 0;
            return (
              <td key={`${h}-${i}`} style={ps.tdScore}>
                {/* score writing area */}
                <div style={ps.scoreWriteArea} />
                {/* dots in top-right of cell */}
                <div style={ps.dotCorner}>{p ? dotStr(strokes) : ""}</div>
              </td>
            );
          })}
        </tr>
      );
    });

  return (
    <div style={ps.cardOuter}>
      {/* Header: title + group details on the left, spool logo top-right. The
          logo spans the height of the text beside it, so it adds no height. */}
      <div style={ps.headerRow}>
        <div style={{ flex: "1 1 0", minWidth: 0 }}>
          <div style={ps.title}>{eventName || "The Ginvitational"}</div>

          {/* Meta block */}
          <div style={ps.metaBlock}>
            <div style={ps.metaLine}>
              <span style={ps.metaLabel}>Group Name:</span> <span>{f.group_name || ""}</span>
            </div>
            {/* Only the detail that tells the groups apart: tee time when everyone
                starts on the same hole, otherwise the starting hole. */}
            {showTeeTime ? (
              <div style={ps.metaLine}>
                <span style={ps.metaLabel}>Tee Time:</span> <span>{formatTeeTime(f.tee_time)}</span>
              </div>
            ) : (
              <div style={ps.metaLine}>
                <span style={ps.metaLabel}>Starting Hole:</span> <span>{f.starting_hole || ""}</span>
              </div>
            )}
            <div style={ps.metaLine}>
              <span style={ps.metaLabel}>Handicap:</span>{" "}
              <span>
                {game ? game.name : "Course Handicap"}
                {game && game.format !== "composite" && game.format !== "scramble_2" && game.format !== "scramble_4"
                  ? ` • ${clampInt(game.handicap_pct, 100)}% allocation`
                  : ""}
                {offset !== 0 ? " • Field-Relative" : ""}
              </span>
            </div>
            {hasSharedHoles && (
              <div style={{ ...ps.metaLine, fontSize: 10, opacity: 0.75 }}>
                Scramble-style holes aren't dot-marked — allocate by the team's blended handicap.
              </div>
            )}
          </div>
        </div>

        <img src={logoSrc} alt="" style={ps.logo} />
      </div>

      {/* Main table */}
      <table style={ps.table}>
        <thead>
          <tr>
            <th style={ps.thHole}>Hole</th>
            <th style={ps.thHi}>H.I</th>
            {cols.map((p, i) => (
              <th key={i} style={ps.thPlayer}>
                <div style={ps.playerLast}>{p ? (lastName(p.name) || p.name) : "Last Name"}</div>
                <div style={ps.playerHcp}>HCP {p ? clampInt(p.handicap, 0) : ""}</div>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {holeRows(1, 9)}

          {/* OUT */}
          <tr>
            <td style={ps.tdOutInTotal}>Out</td>
            <td style={ps.tdOutInTotal} />
            {cols.map((_, i) => (
              <td key={`out-${i}`} style={ps.tdScore}>
                <div style={ps.scoreWriteArea} />
              </td>
            ))}
          </tr>

          {holeRows(10, 18)}

          {/* IN */}
          <tr>
            <td style={ps.tdOutInTotal}>In</td>
            <td style={ps.tdOutInTotal} />
            {cols.map((_, i) => (
              <td key={`in-${i}`} style={ps.tdScore}>
                <div style={ps.scoreWriteArea} />
              </td>
            ))}
          </tr>

          {/* TOTAL */}
          <tr>
            <td style={ps.tdOutInTotal}>Total</td>
            <td style={ps.tdOutInTotal} />
            {cols.map((_, i) => (
              <td key={`tot-${i}`} style={ps.tdScore}>
                <div style={ps.scoreWriteArea} />
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      {/* Bottom code row */}
      <div style={ps.bottomRow}>
        <div style={ps.bottomInner}>
          <span style={{ fontWeight: 700 }}>Group Code</span>
          <span style={{ marginLeft: 10, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>
            {f.code || ""}
          </span>
        </div>
      </div>
    </div>
  );
}

const ps = {
  // Laid out for ONE landscape sheet holding two cards side by side (see the
  // @page rule below). Widths are percentages and the card height is ~7.2in
  // at most, so it fits Letter and A4 landscape with no print-preview zoom.
  root: { background: "white", color: "black" },
  page: { width: "100%" },
  twoUpRow: { display: "flex", gap: "0.2in", alignItems: "flex-start" },
  col: { flex: "1 1 0", minWidth: 0 },

  // Outer card border
  cardOuter: { border: "2px solid #000", padding: 10, boxSizing: "border-box" },

  // Header
  headerRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  title: { fontFamily: FONT_DISPLAY, fontSize: 26, fontWeight: 600, lineHeight: 1.1, letterSpacing: -0.2, textAlign: "left" },
  // ~76px tall = the height of the title + group details beside it.
  // An uploaded logo can be any shape, so cap its width and fit it inside the box.
  logo: { flex: "none", display: "block", height: 76, width: "auto", maxWidth: 110, objectFit: "contain" },

  // Meta
  metaBlock: { marginTop: 4, marginBottom: 6, fontSize: 11, lineHeight: 1.25 },
  metaLine: { marginTop: 1 },
  metaLabel: { display: "inline-block", width: 84 },

  // Table — fixed layout with percentage columns so it can never be wider
  // than its card: 10% hole + 10% index + 4 player columns of 20%.
  table: { width: "100%", borderCollapse: "collapse", tableLayout: "fixed" },

  thHole: { border: "1px solid #000", padding: 3, fontSize: 11, textAlign: "center", width: "10%" },
  thHi: { border: "1px solid #000", padding: 3, fontSize: 11, textAlign: "center", width: "10%" },
  thPlayer: { border: "1px solid #000", padding: 3, fontSize: 11, textAlign: "center", width: "20%", overflow: "hidden" },

  tdHole: { border: "1px solid #000", padding: "2px 4px", fontSize: 11, textAlign: "right" },
  tdHi: { border: "1px solid #000", padding: "2px 4px", fontSize: 11, textAlign: "center" },

  // Score cell with corner dots
  // No explicit cell height: it would stack on top of the padding and make
  // every row taller than the write area inside it.
  tdScore: { border: "1px solid #000", padding: 2, position: "relative" },
  scoreWriteArea: { height: 21, width: "100%" },
  dotCorner: { position: "absolute", top: 1, right: 3, fontSize: 12, lineHeight: 1, letterSpacing: 1 },

  tdOutInTotal: { border: "1px solid #000", padding: "2px 4px", fontSize: 11, textAlign: "right", fontWeight: 700 },

  playerLast: { fontWeight: 900, fontSize: 11, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  playerHcp: { fontWeight: 700, fontSize: 10, marginTop: 1 },

  // Bottom code
  bottomRow: { marginTop: 8, display: "flex", justifyContent: "center" },
  bottomInner: { fontSize: 11 },
};

  return (
  <div className="appPage" style={styles.page}>

    {/* Scorecard printing: only while a print is in progress (printAllOn),
        so the landscape page setup never leaks into any other printing. One
        landscape sheet = two cards side by side. The rest of the app is
        display:none'd (not just invisible) so it can't add blank sheets. */}
    {printAllOn && (
      <style>{`
        @page { size: landscape; margin: 0.3in; }
        @media print {
          html, body { background: #fff !important; margin: 0 !important; }
          .noPrint { display: none !important; }
          .appPage { padding: 0 !important; min-height: 0 !important; background: #fff !important; }
          #printRoot { background: #fff !important; color: #000 !important; padding: 0 !important; margin: 0 !important; }
          .printPage { break-after: page; page-break-after: always; break-inside: avoid; }
          .printPage:last-child { break-after: auto; page-break-after: auto; }
        }
      `}</style>
    )}

      {tab === "tv" && (
        <TvMode
          eventName={eventName}
          subtitle={[
            gameResults.length > 1
              ? (gameResults.find((g) => g.game.id === selectedGameId) || gameResults[0]).game.name
              : null,
            appSettings.multi_round_enabled
              ? (selectedRoundId || activeRound?.id) === ROUND_OVERALL
                ? "Overall"
                : rounds.find((r) => r.id === (selectedRoundId || activeRound?.id))?.label
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          board={gameResults.find((g) => g.game.id === selectedGameId) || gameResults[0] || null}
          messages={visibleBroadcast}
          forms={tvForms}
          onExit={() => setTab("home")}
        />
      )}

      <div className="noPrint" style={tab === "tv" ? { display: "none" } : styles.shell}>
        {/* HOME (no top nav) */}
        {tab === "home" && (
          <div style={styles.homeCard}>
            <div style={{ textAlign: "center" }}>
              <img
                src={logoSrc}
                alt={`${eventName} logo`}
                style={{
                  width: 210,
                  height: "auto",
                  // A tall uploaded logo shouldn't push the menu off screen.
                  maxHeight: 200,
                  objectFit: "contain",
                  display: "block",
                  margin: "0 auto",
                  // The built-in spool's flag+needle jut out to the right, so
                  // centering its full bounding box makes the spool itself
                  // look left-of-center. Nudge right so the spool's own base
                  // lines up under "The" in the title below. (An uploaded
                  // logo is centered as-is.)
                  transform: customLogo ? "none" : "translateX(22px)",
                }}
              />

              <div style={styles.homeTitle}>
                {(() => {
                  const words = eventName.trim().split(/\s+/).filter(Boolean);
                  const first = words[0] || eventName;
                  const rest = words.slice(1).join(" ");
                  return rest ? (
                    <>
                      {first}
                      <br />
                      {rest}
                    </>
                  ) : (
                    first
                  );
                })()}
              </div>

              {tagline ? <div style={styles.homeSub}>{tagline}</div> : null}

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
              Manufacturers Golf &amp; CC
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
              {visibleStatus ? <div style={{ fontSize: 12, color: THEME.textMuted }}>{visibleStatus}</div> : null}
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
                <div style={styles.brandTitle}>{eventName}</div>
                {visibleStatus ? <div style={styles.brandSub}>{visibleStatus}</div> : null}
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
              Moe!!! Give us the updates.
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <BroadcastFeed messages={visibleBroadcast} />
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
                  await loadGames();
                  await loadGameTeams();
                  await loadGameTeamMembers();
                  await loadRounds();
                }}
              >
                Refresh
              </button>
            </div>

            {/* Round tabs — only when multi-round is on with 2+ rounds. */}
            {appSettings.multi_round_enabled && rounds.length > 1 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                {[{ id: ROUND_OVERALL, label: "Overall" }, ...rounds.map((r) => ({ id: r.id, label: r.label }))].map(
                  (opt) => {
                    const isActive = selectedRoundId ? selectedRoundId === opt.id : opt.id === activeRound?.id;
                    return (
                      <button
                        key={opt.id}
                        style={isActive ? styles.tabBtnActive : styles.tabBtn}
                        onClick={() => setSelectedRoundId(opt.id)}
                      >
                        {opt.label}
                      </button>
                    );
                  }
                )}
              </div>
            )}

            {/* Game tabs — only when more than one game is active. A Simple
                Mode event (the common case) never sees this and renders
                exactly as before. */}
            {gameResults.length > 1 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                {gameResults.map(({ game }) => {
                  // No game is favored by default — the first active one
                  // (by sort order) shows until you pick a different tab.
                  const isActive = selectedGameId ? selectedGameId === game.id : game.id === gameResults[0]?.game.id;
                  return (
                    <button
                      key={game.id}
                      style={isActive ? styles.tabBtnActive : styles.tabBtn}
                      onClick={() => setSelectedGameId(game.id)}
                    >
                      {game.locked ? "🔒 " : ""}
                      {game.name}
                    </button>
                  );
                })}
              </div>
            )}

            {(() => {
              const showRoundTabs = appSettings.multi_round_enabled && rounds.length > 1;

              // Tighter cells than the app-wide table styles, just for the
              // Leaderboard — keeps Player + Score visible together on a
              // phone screen without horizontal scrolling.
              const lbTh = { ...styles.th, padding: "6px 6px", fontSize: 11 };
              const lbTd = { ...styles.td, padding: "8px 6px", fontSize: 13 };
              const lbPill = { ...styles.pill, minWidth: 22, padding: "3px 8px", fontSize: 11 };

              const lockCheckEntry =
                gameResults.length > 0
                  ? gameResults.find((g) => g.game.id === selectedGameId) || gameResults[0]
                  : null;

              if (lockCheckEntry && lockCheckEntry.game.locked) {
                return <LockedBoardPanel game={lockCheckEntry.game} onUnlock={unlockGameBoard} />;
              }

              if (!lockCheckEntry) {
                return <div style={styles.helpText}>No games configured yet.</div>;
              }

              if (gameResults.length <= 1 && !showRoundTabs) {
                const lastRank = lastPlaceRank(leaderboardRows);
                return (
              <>
                <div style={styles.helpText}>
                  Tap a player name to view their scorecard. Auto-refreshes every minute.
                </div>

                <div style={styles.tableWrap}>
                  {/* table-layout: fixed + explicit column widths — without
                      this, an expanded player's 18-hole scorecard (below,
                      in a colSpan cell) would force this whole table, and
                      everything above it, as wide as all 18 holes instead
                      of scrolling inside its own row. */}
                  <table style={{ ...styles.table, tableLayout: "fixed", minWidth: 0 }}>
                    <thead>
                      <tr>
                        <th style={{ ...lbTh, width: "16%" }}>#</th>
                        <th style={{ ...lbTh, width: "44%" }}>Player</th>
                        <th style={{ ...lbTh, width: "22%", textAlign: "center" }}>Net vs Par</th>
                        <th style={{ ...lbTh, width: "18%", textAlign: "center" }}>Holes</th>
                      </tr>
                    </thead>

                    <tbody>
                      {leaderboardRows.map((r, idx) => {
                        const displayNet = r.holesPlayed === 0 ? "—" : formatToPar(r.netToPar);
                        const netStyle =
                          r.holesPlayed === 0
                            ? { opacity: 0.6, color: THEME.textMuted }
                            : { fontWeight: 950, ...netColorStyle(r.netToPar) };

                        const expanded = r.id === scorecardPlayerId;

                        return [
                          <tr key={r.id}>
                            <td style={{ ...lbTd, padding: "8px 2px 8px 6px" }}>{rankCellContent(r, idx, lastRank)}</td>

                            <td style={{ ...lbTd, minWidth: 120 }}>
                              <button
                                style={{ ...styles.playerLink, display: "inline-flex", alignItems: "center", gap: 6 }}
                                onClick={() => setScorecardPlayerId((id) => (id === r.id ? null : r.id))}
                              >
                                {r.name}
                                <span style={expandChevronStyle(expanded)}>▸</span>
                              </button>
                              <div style={styles.playerMeta}>
                                HCP {r.handicap}
                                {r.charity ? ` • ${r.charity}` : ""}
                              </div>
                            </td>

                            <td style={{ ...lbTd, textAlign: "center" }}>
                              <span style={netStyle}>{displayNet}</span>
                            </td>

                            <td style={{ ...lbTd, textAlign: "center" }}>
                              <span style={lbPill}>{r.holesPlayed}</span>
                            </td>
                          </tr>,
                          expanded && (
                            <tr key={`${r.id}-detail`}>
                              <td colSpan={4} style={expandRowCellStyle}>
                                <ScorecardDetail player={scorecardPlayer} />
                              </td>
                            </tr>
                          ),
                        ];
                      })}

                      {leaderboardRows.length === 0 && (
                        <tr>
                          <td style={lbTd} colSpan={4}>
                            No players yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
                );
              }

              const { game, rows } = lockCheckEntry;
              const lastRank = lastPlaceRank(rows);
              const isTeamFormat =
                game.format === "better_ball_2" ||
                game.format === "better_ball_4" ||
                game.format === "scramble_2" ||
                game.format === "scramble_4" ||
                game.format === "composite";
              const scoreLabel = GAME_SCORE_LABELS[game.format] || "Score vs Par";

              return (
                  <>
                    <div style={styles.helpText}>
                      {isTeamFormat
                        ? `Team leaderboard for ${game.name}.`
                        : "Tap a player name to view their scorecard."}{" "}
                      Auto-refreshes every minute.
                    </div>

                    <div style={styles.tableWrap}>
                      {/* table-layout: fixed — see the matching comment on
                          the simple leaderboard table above. */}
                      <table style={{ ...styles.table, tableLayout: "fixed", minWidth: 0 }}>
                        <thead>
                          <tr>
                            <th style={{ ...lbTh, width: "16%" }}>#</th>
                            <th style={{ ...lbTh, width: "44%" }}>{isTeamFormat ? "Team" : "Player"}</th>
                            <th style={{ ...lbTh, width: "22%", textAlign: "center" }}>{scoreLabel}</th>
                            <th style={{ ...lbTh, width: "18%", textAlign: "center" }}>Holes</th>
                          </tr>
                        </thead>

                        <tbody>
                          {rows.map((r, idx) => {
                            const displayScore = r.holesPlayed === 0 ? "—" : formatToPar(r.toPar);
                            const scoreStyle =
                              r.holesPlayed === 0
                                ? { opacity: 0.6, color: THEME.textMuted }
                                : { fontWeight: 950, ...netColorStyle(r.toPar) };

                            const expanded = !isTeamFormat && r.id === scorecardPlayerId;

                            return [
                              <tr key={r.id}>
                                <td style={{ ...lbTd, padding: "8px 2px 8px 6px" }}>{rankCellContent(r, idx, lastRank)}</td>

                                <td style={{ ...lbTd, minWidth: 120 }}>
                                  {isTeamFormat ? (
                                    <>
                                      <div style={{ fontWeight: 950 }}>{r.name}</div>
                                      <div style={styles.playerMeta}>
                                        {r.members.map((m) => `${m.name} (HCP ${m.handicap})`).join(" • ")}
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        style={{
                                          ...styles.playerLink,
                                          display: "inline-flex",
                                          alignItems: "center",
                                          gap: 6,
                                        }}
                                        onClick={() => setScorecardPlayerId((id) => (id === r.id ? null : r.id))}
                                      >
                                        {r.name}
                                        <span style={expandChevronStyle(expanded)}>▸</span>
                                      </button>
                                      <div style={styles.playerMeta}>
                                        HCP {r.handicap}
                                        {r.charity ? ` • ${r.charity}` : ""}
                                      </div>
                                    </>
                                  )}
                                </td>

                                <td style={{ ...lbTd, textAlign: "center" }}>
                                  <span style={scoreStyle}>{displayScore}</span>
                                </td>

                                <td style={{ ...lbTd, textAlign: "center" }}>
                                  <span style={lbPill}>{r.holesPlayed}</span>
                                </td>
                              </tr>,
                              expanded && (
                                <tr key={`${r.id}-detail`}>
                                  <td colSpan={4} style={expandRowCellStyle}>
                                    <ScorecardDetail player={scorecardPlayer} />
                                  </td>
                                </tr>
                              ),
                            ];
                          })}

                          {rows.length === 0 && (
                            <tr>
                              <td style={lbTd} colSpan={4}>
                                No {isTeamFormat ? "teams" : "players"} yet.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
              );
            })()}
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
                  {appSettings.multi_round_enabled && activeFoursome && (
                    <>
                      {" "}
                      • Round: <b>{rounds.find((r) => r.id === activeFoursome.round_id)?.label || "—"}</b>
                    </>
                  )}
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
              {(() => {
                // Shotgun start: a group can start on any hole, plays 18 in
                // order from there, and wraps around (e.g. start on 10 ->
                // 10,11,...,18,1,2,...,9). "Last Hole"/"Save & Next" wrap
                // through 1<->18 instead of stopping dead at the ends, and
                // "starting hole" — not hole 1 — is this group's true start.
                const startingHole = clampInt(activeFoursome?.starting_hole, 1);
                const prevHole = hole === 1 ? 18 : hole - 1;
                const nextHole = hole === 18 ? 1 : hole + 1;

                if (roundComplete) {
                  return (
                    <div style={{ display: "grid", gap: 10 }}>
                      <div style={{ fontSize: 18, fontWeight: 950 }}>All 18 holes entered ✅</div>
                      <div style={styles.helpText}>
                        Your group is all set. Tap below if you need to go back and fix a hole.
                      </div>
                      <button
                        style={styles.smallBtn}
                        onClick={() => {
                          setRoundComplete(false);
                          saveHoleThenNavigate(prevHole);
                        }}
                      >
                        Review Last Hole
                      </button>
                    </div>
                  );
                }

                return (
                  <>
                    <div style={{ fontSize: 18, fontWeight: 950 }}>
                      Hole {hole}{" "}
                      <span style={{ opacity: 0.75, fontWeight: 700 }}>(Par {PARS[hole - 1]})</span>
                    </div>

                    <div style={{ display: "grid", gap: 10 }}>
                      {holeEntryGroups(hole, activePlayers).map((grp) => (
                        <div key={grp.key} style={styles.scoreRow}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis" }}>
                              {grp.players.map((p) => p.name).join(" / ")}
                            </div>
                            <div style={{ fontSize: 12, color: THEME.textMuted }}>
                              {grp.shared
                                ? "Scramble — team score"
                                : `HCP ${clampInt(grp.players[0].handicap, 0)}`}
                            </div>
                          </div>

                          <input
                            style={{ ...styles.input, width: 92, textAlign: "center", fontSize: 16, fontWeight: 900 }}
                            inputMode="numeric"
                            placeholder="—"
                            value={holeInputs[grp.players[0].id] ?? ""}
                            onChange={(e) => {
                              const val = e.target.value;
                              setHoleInputs((prev) => {
                                const next = { ...prev };
                                for (const p of grp.players) next[p.id] = val;
                                return next;
                              });
                            }}
                          />
                        </div>
                      ))}
                    </div>

                    <div style={styles.navRow}>
                      <button
                        style={styles.smallBtn}
                        disabled={hole === startingHole}
                        onClick={() => saveHoleThenNavigate(prevHole)}
                      >
                        Last Hole
                      </button>

                      <button
                        style={styles.bigBtn}
                        onClick={async () => {
                          await saveHoleThenNavigate(nextHole);
                          if (nextHole === startingHole) setRoundComplete(true);
                        }}
                      >
                        {nextHole === startingHole ? "Save & Finish" : "Save & Next"}
                      </button>
                    </div>

                    <div style={styles.helpText}>
                      Type scores for your foursome, then hit <b>Save & Next</b>. You can go back with{" "}
                      <b>Last Hole</b>. Leaving a box blank means “no score yet”.
                    </div>
                  </>
                );
              })()}
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
            background: "rgba(22,35,29,0.05)",
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

          <label
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              fontSize: 12,
              color: THEME.textMuted,
              padding: "0 6px",
            }}
          >
            Print stroke dots for
            <select
              style={{ ...styles.input, minWidth: 170, padding: "6px 8px" }}
              value={printGame?.id || ""}
              onChange={(e) => setPrintGameId(e.target.value)}
            >
              {games
                .filter((g) => g.active)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </select>
          </label>

          <button
  style={styles.smallBtn}
  onClick={async () => {
    // make sure latest foursomes + assignments are loaded before printing
    await loadFoursomes();
    await loadFoursomePlayers();
    await loadPlayers();
    // The cards carry the logo and the serif title: make sure both are loaded
    // before the print dialog opens, even if this page was opened straight to
    // Admin (never showed Home).
    await Promise.all([
      new Promise((resolve) => {
        const img = new Image();
        img.onload = resolve;
        img.onerror = resolve;
        img.src = logoSrc;
      }),
      document.fonts ? document.fonts.load("600 26px Fraunces").catch(() => {}) : null,
    ]);

    setPrintAllOn(true);
    setTimeout(() => window.print(), 100);
  }}
>
  Print Scorecards
</button>

          <button style={styles.smallBtn} onClick={() => setTab("tv")}>
            Launch TV Mode
          </button>

        </div>

        {phoneSetupOn ? (
          <PhoneSetup
            eventName={eventName}
            onSaveEventName={async (name) => {
              await supabase
                .from("app_settings")
                .update({ event_name: name, updated_at: new Date().toISOString() })
                .eq("id", 1);
              await loadAppSettings();
            }}
            rounds={rounds}
            multiRound={!!appSettings.multi_round_enabled}
            activeRound={activeRound}
            foursomes={foursomes}
            onStart={(rows, opts) => runTeeSheetImport(rows, opts)}
            onExit={() => setPhoneSetupOn(false)}
            onGoto={(t) => {
              setPhoneSetupOn(false);
              setTab(t);
            }}
          />
        ) : (
        <div style={{ ...styles.adminGrid, gridTemplateColumns: isWide ? "1fr 1fr" : "1fr" }}>
          {/* Start a Tournament — two ways in, same result */}
          <AdminSection
            title="Start a Tournament"
            subtitle={foursomes.length > 0 ? `${foursomes.length} groups set up` : "Upload an Excel sheet or build it on your phone"}
            open={openAdminSection === "start"}
            onToggle={() => setOpenAdminSection((k) => (k === "start" ? null : "start"))}
          >
            <div style={styles.helpText}>Two ways to set up players, groups and tee times. Both give the same result.</div>
            <div style={{ display: "grid", gap: 10, marginTop: 10, gridTemplateColumns: "minmax(0, 1fr)" }}>
              <button style={{ ...styles.bigBtn, minHeight: 52 }} onClick={() => setPhoneSetupOn(true)}>
                📱 Build on my phone
              </button>
              <button style={{ ...styles.bigBtn, minHeight: 52 }} onClick={() => setOpenAdminSection("import")}>
                📄 Upload Excel sheet
              </button>
            </div>
          </AdminSection>

          {/* Event Name */}
          <AdminSection
            title="Event Name"
            subtitle={eventName || "Not set"}
            open={openAdminSection === "eventName"}
            onToggle={() => setOpenAdminSection((k) => (k === "eventName" ? null : "eventName"))}
          >
            <div style={styles.helpText}>Shown on Home, the top nav, print scorecards, and the browser tab.</div>

            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input
                style={{ ...styles.input, flex: 1, minWidth: 200 }}
                value={eventNameDraft}
                onChange={(e) => {
                  setEventNameDraft(e.target.value);
                  setEventNameMsg("");
                }}
                placeholder="The Ginvitational"
              />
              <button style={styles.bigBtn} onClick={saveEventName}>
                Save
              </button>
            </div>

            {eventNameMsg ? <div style={styles.helpText}>{eventNameMsg}</div> : null}
          </AdminSection>

          {/* Tagline */}
          <AdminSection
            title="Tagline"
            subtitle={tagline || "None"}
            open={openAdminSection === "tagline"}
            onToggle={() => setOpenAdminSection((k) => (k === "tagline" ? null : "tagline"))}
          >
            <div style={styles.helpText}>
              Shown on the Home screen under the event name. Leave it blank to show no tagline.
            </div>

            {!brandingReady ? (
              <BrandingSetupNotice />
            ) : (
              <>
                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <input
                    style={{ ...styles.input, flex: 1, minWidth: 200 }}
                    value={taglineDraft}
                    onChange={(e) => {
                      setTaglineDraft(e.target.value);
                      setTaglineMsg("");
                    }}
                    placeholder={DEFAULT_TAGLINE}
                  />
                  <button style={styles.bigBtn} onClick={saveTagline}>
                    Save
                  </button>
                </div>
                {taglineMsg ? <div style={styles.helpText}>{taglineMsg}</div> : null}
              </>
            )}
          </AdminSection>

          {/* Main logo */}
          <AdminSection
            title="Logo"
            subtitle={customLogo ? "Custom logo" : "Default logo"}
            open={openAdminSection === "logo"}
            onToggle={() => setOpenAdminSection((k) => (k === "logo" ? null : "logo"))}
          >
            <div style={styles.helpText}>
              Your main logo — shown on the Home screen, the printed scorecards, and as the browser tab icon. Any
              image works; it's resized automatically. A PNG with a transparent background looks best.
            </div>

            {!brandingReady ? (
              <BrandingSetupNotice />
            ) : (
              <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ ...styles.label, marginBottom: 6 }}>{logoDraft ? "Current" : "Current logo"}</div>
                    <img
                      src={logoSrc}
                      alt="Current logo"
                      style={{ display: "block", maxWidth: 140, maxHeight: 110, objectFit: "contain" }}
                    />
                  </div>
                  {logoDraft ? (
                    <div>
                      <div style={{ ...styles.label, marginBottom: 6 }}>New logo (not saved yet)</div>
                      <img
                        src={logoDraft}
                        alt="New logo preview"
                        style={{ display: "block", maxWidth: 140, maxHeight: 110, objectFit: "contain" }}
                      />
                    </div>
                  ) : null}
                </div>

                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  onChange={(e) => {
                    onLogoPicked(e.target.files?.[0] || null);
                    e.target.value = ""; // picking the same file again should still fire
                  }}
                />

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {logoDraft ? (
                    <>
                      <button style={styles.bigBtn} onClick={() => saveLogo(logoDraft)}>
                        Save logo
                      </button>
                      <button
                        style={styles.smallBtn}
                        onClick={() => {
                          setLogoDraft(null);
                          setLogoMsg("");
                        }}
                      >
                        Cancel
                      </button>
                    </>
                  ) : null}
                  {customLogo && !logoDraft ? (
                    <button
                      style={styles.smallBtn}
                      onClick={() => {
                        if (confirm("Go back to the default logo?")) saveLogo(null);
                      }}
                    >
                      Use default logo
                    </button>
                  ) : null}
                </div>

                {logoMsg ? <div style={styles.helpText}>{logoMsg}</div> : null}
              </div>
            )}
          </AdminSection>

          {/* Handicap Basis */}
          <AdminSection
            title="Handicap Basis"
            subtitle={appSettings.handicap_basis === "field_relative" ? "Field-Relative" : "Course Handicap"}
            open={openAdminSection === "handicapBasis"}
            onToggle={() => setOpenAdminSection((k) => (k === "handicapBasis" ? null : "handicapBasis"))}
          >
            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, color: THEME.textMuted }}>
                <input
                  type="radio"
                  name="handicapBasis"
                  checked={(appSettings.handicap_basis || "course") === "course"}
                  onChange={() => setHandicapBasis("course")}
                />
                Course Handicap — everyone plays off their own handicap.
              </label>

              <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, color: THEME.textMuted }}>
                <input
                  type="radio"
                  name="handicapBasis"
                  checked={appSettings.handicap_basis === "field_relative"}
                  onChange={() => setHandicapBasis("field_relative")}
                />
                Field-Relative — everyone plays off the lowest handicap among all imported players.
              </label>
            </div>

            <div style={styles.helpText}>
              Applies to the Leaderboard, print scorecards, and the scorecard popup. A plus handicap now correctly
              gives strokes back (marked with a "+") instead of being treated as scratch.
            </div>
          </AdminSection>

          {/* Import Tee Sheet */}
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

          {/* Players & Groups — edit after the tournament is set up */}
          <AdminSection
            title="Players & Groups"
            subtitle={`${players.length} players • ${foursomes.length} groups`}
            open={openAdminSection === "foursomes"}
            onToggle={() => setOpenAdminSection((k) => (k === "foursomes" ? null : "foursomes"))}
          >
            <div style={{ marginTop: 8 }}>
              <RosterEditor
                players={players}
                foursomes={foursomes}
                foursomePlayers={foursomePlayers}
                rounds={rounds}
                activeRound={activeRound}
                multiRound={!!appSettings.multi_round_enabled}
                onChanged={initialLoad}
              />
            </div>
          </AdminSection>

          {/* Multi-Game setup */}
          <AdminSection
            title="Games"
            subtitle={
              games.length > 0
                ? `${games.length} game${games.length === 1 ? "" : "s"} configured`
                : "No games yet"
            }
            open={openAdminSection === "games"}
            onToggle={() => setOpenAdminSection((k) => (k === "games" ? null : "games"))}
          >

            <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, color: THEME.textMuted }}>
              <input
                type="checkbox"
                checked={!!appSettings.multi_game_enabled}
                onChange={(e) => setMultiGameEnabled(e.target.checked)}
              />
              Enable multiple games for this event
            </label>

            {!appSettings.multi_game_enabled && (
              <div style={styles.helpText}>
                Off by default. Every game below still works — lock/unlock, activate/deactivate, delete — this
                just hides the "Add Game" builder until you need more than one game running at once.
              </div>
            )}

            <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
                <div style={{ display: "grid", gap: 10 }}>
                  {games.map((g) => (
                    <div key={g.id} style={styles.foursomeCard}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 950 }}>
                            {g.name}{" "}
                            {!g.active && (
                              <span style={{ ...styles.strokePill, marginLeft: 6, opacity: 0.6 }}>Inactive</span>
                            )}
                            {g.locked && (
                              <span style={{ ...styles.strokePill, marginLeft: 6 }}>🔒 Locked</span>
                            )}
                          </div>
                          {g.format === "composite" ? (
                            <div style={{ fontSize: 12, color: THEME.textMuted, marginTop: 6 }}>
                              {GAME_FORMAT_LABELS[g.format]} —{" "}
                              {(g.segments || [])
                                .map((s) => `Holes ${Math.min(...s.holes)}-${Math.max(...s.holes)}: ${s.label}`)
                                .join(" • ")}
                            </div>
                          ) : g.format === "scramble_2" || g.format === "scramble_4" ? (
                            <div style={{ fontSize: 12, color: THEME.textMuted, marginTop: 6 }}>
                              {GAME_FORMAT_LABELS[g.format]} • HCP {(g.handicap_allowance || []).join("/")}%
                              (low → high)
                            </div>
                          ) : (
                            <div style={{ fontSize: 12, color: THEME.textMuted, marginTop: 6 }}>
                              {GAME_FORMAT_LABELS[g.format]} • HCP {g.handicap_pct}% • Counts{" "}
                              {g.counting_rule?.scoresCounted} ({(g.counting_rule?.slots || []).join(" + ")})
                            </div>
                          )}
                          {(g.format === "better_ball_2" ||
                            g.format === "better_ball_4" ||
                            g.format === "scramble_2" ||
                            g.format === "scramble_4" ||
                            g.format === "composite") && (
                            <div style={{ fontSize: 12, color: THEME.textMuted, marginTop: 6 }}>
                              Teams: {gameTeams.filter((t) => t.game_id === g.id).length}
                            </div>
                          )}
                        </div>

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button style={styles.smallBtn} onClick={() => toggleGameLocked(g)}>
                            {g.locked ? "Unlock" : "Lock"}
                          </button>
                          <button style={styles.smallBtn} onClick={() => toggleGameActive(g)}>
                            {g.active ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {games.length === 0 && <div style={styles.helpText}>No games yet.</div>}
                </div>

                {appSettings.multi_game_enabled && (
                  <>
                    <div style={styles.hr} />

                    <div style={styles.sectionLabel}>Add Game</div>

                    <div style={{ display: "grid", gap: 10 }}>
                  <label style={styles.label}>
                    Format
                    <select
                      style={styles.input}
                      value={newGameFormat}
                      onChange={(e) => selectNewGameFormat(e.target.value)}
                    >
                      {Object.entries(GAME_FORMAT_LABELS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label style={styles.label}>
                    Name
                    <input
                      style={styles.input}
                      value={newGameName}
                      onChange={(e) => setNewGameName(e.target.value)}
                    />
                  </label>

                  {(GAME_PRESETS[newGameFormat] || []).length > 1 && (
                    <div>
                      <div style={{ ...styles.label, marginBottom: 6 }}>Preset</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {GAME_PRESETS[newGameFormat].map((preset) => (
                          <button
                            key={preset.key}
                            style={newGamePresetKey === preset.key ? styles.navBtnActive : styles.smallBtn}
                            onClick={() => applyPreset(preset)}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {newGameFormat === "scramble_2" || newGameFormat === "scramble_4" ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={styles.label}>
                        Handicap % per player, lowest handicap to highest — a blend, not a per-player deduction
                      </div>
                      {newGameScramblePcts.map((pct, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ fontSize: 12, color: THEME.textMuted, minWidth: 120 }}>
                            {i === 0
                              ? "Lowest handicap"
                              : i === newGameScramblePcts.length - 1
                              ? "Highest handicap"
                              : `${i + 1}${i === 1 ? "nd" : "rd"} lowest`}
                          </span>
                          <input
                            style={{ ...styles.input, width: 80 }}
                            type="number"
                            min={0}
                            max={100}
                            value={pct}
                            onChange={(e) => setScramblePct(i, e.target.value)}
                          />
                          <span style={{ fontSize: 12, color: THEME.textMuted }}>%</span>
                        </div>
                      ))}
                      <div style={styles.helpText}>
                        Team handicap = each teammate's own handicap × their %, added together. The two defaults
                        above are a common starting point — change them to whatever your event uses.
                      </div>
                    </div>
                  ) : (
                    newGameFormat !== "composite" && (
                      <label style={styles.label}>
                        Handicap %
                        <input
                          style={styles.input}
                          type="number"
                          min={0}
                          max={150}
                          value={newGameHandicapPct}
                          onChange={(e) => setNewGameHandicapPct(e.target.value)}
                          disabled={newGameFormat === "individual_gross"}
                        />
                      </label>
                    )
                  )}

                  {newGameFormat !== "composite" && newGameFormat !== "scramble_2" && newGameFormat !== "scramble_4" && (
                    <label
                      style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, color: THEME.textMuted }}
                    >
                      <input
                        type="checkbox"
                        checked={newGameAdvancedOn}
                        onChange={(e) => setNewGameAdvancedOn(e.target.checked)}
                      />
                      Advanced: build a custom counting rule
                    </label>
                  )}

                  {newGameFormat !== "composite" &&
                    newGameFormat !== "scramble_2" &&
                    newGameFormat !== "scramble_4" &&
                    newGameAdvancedOn && (
                    <div
                      style={{
                        display: "grid",
                        gap: 10,
                        padding: 12,
                        borderRadius: 12,
                        border: `1px solid ${THEME.border}`,
                      }}
                    >
                      <label style={styles.label}>
                        Scores counted per hole (1–4)
                        <input
                          style={styles.input}
                          type="number"
                          min={1}
                          max={4}
                          value={newGameScoresCounted}
                          onChange={(e) => setAdvancedScoresCounted(e.target.value)}
                        />
                      </label>
                      <div style={{ display: "grid", gap: 8 }}>
                        {newGameSlots.map((slot, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
                            <span style={{ color: THEME.textMuted, minWidth: 56 }}>Slot {i + 1}</span>
                            <select style={styles.input} value={slot} onChange={(e) => setAdvancedSlot(i, e.target.value)}>
                              <option value="net">Net</option>
                              <option value="gross">Gross</option>
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {newGameFormat === "composite" && (
                    <div style={{ display: "grid", gap: 10 }}>
                      <label style={styles.label}>
                        Team size
                        <select
                          style={styles.input}
                          value={newGameTeamSize}
                          onChange={(e) => setNewGameTeamSize(clampInt(e.target.value, 2))}
                        >
                          <option value={2}>2-Man</option>
                          <option value={4}>4-Man</option>
                        </select>
                      </label>

                      <div style={styles.label}>Segments (holes 1–18)</div>

                      {newGameSegments.map((seg, i) => {
                        const opt = SEGMENT_FORMAT_OPTIONS[seg.formatKey] || SEGMENT_FORMAT_OPTIONS.best_ball;
                        return (
                          <div
                            key={i}
                            style={{
                              display: "grid",
                              gap: 8,
                              padding: 12,
                              borderRadius: 12,
                              border: `1px solid ${THEME.border}`,
                            }}
                          >
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <span style={{ fontSize: 12, color: THEME.textMuted }}>Holes</span>
                              <input
                                style={{ ...styles.input, width: 64 }}
                                type="number"
                                min={1}
                                max={18}
                                value={seg.fromHole}
                                onChange={(e) => updateSegment(i, { fromHole: e.target.value })}
                              />
                              <span style={{ fontSize: 12, color: THEME.textMuted }}>to</span>
                              <input
                                style={{ ...styles.input, width: 64 }}
                                type="number"
                                min={1}
                                max={18}
                                value={seg.toHole}
                                onChange={(e) => updateSegment(i, { toHole: e.target.value })}
                              />
                              <select
                                style={{ ...styles.input, flex: 1, minWidth: 140 }}
                                value={seg.formatKey}
                                onChange={(e) => updateSegment(i, { formatKey: e.target.value })}
                              >
                                {Object.entries(SEGMENT_FORMAT_OPTIONS).map(([key, o]) => (
                                  <option key={key} value={key}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                              {newGameSegments.length > 1 && (
                                <button style={styles.dangerBtn} onClick={() => removeSegment(i)}>
                                  Remove
                                </button>
                              )}
                            </div>

                            {opt.kind === "shared" ? (
                              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                                <span style={{ fontSize: 12, color: THEME.textMuted }}>% of lower handicap</span>
                                <input
                                  style={{ ...styles.input, width: 72 }}
                                  type="number"
                                  min={0}
                                  max={150}
                                  value={seg.lowPct}
                                  onChange={(e) => updateSegment(i, { lowPct: e.target.value })}
                                />
                                <span style={{ fontSize: 12, color: THEME.textMuted }}>% of higher handicap</span>
                                <input
                                  style={{ ...styles.input, width: 72 }}
                                  type="number"
                                  min={0}
                                  max={150}
                                  value={seg.highPct}
                                  onChange={(e) => updateSegment(i, { highPct: e.target.value })}
                                />
                              </div>
                            ) : (
                              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                                <span style={{ fontSize: 12, color: THEME.textMuted }}>Handicap %</span>
                                <input
                                  style={{ ...styles.input, width: 72 }}
                                  type="number"
                                  min={0}
                                  max={150}
                                  value={seg.handicapPct}
                                  onChange={(e) => updateSegment(i, { handicapPct: e.target.value })}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}

                      <button style={styles.smallBtn} onClick={addSegment}>
                        + Add Segment
                      </button>

                      <div style={styles.helpText}>
                        {(() => {
                          const gaps = segmentCoverageGaps(newGameSegments);
                          return gaps.length === 0
                            ? "All 18 holes are covered ✓"
                            : `Not yet covered: hole${gaps.length > 1 ? "s" : ""} ${gaps.join(", ")}`;
                        })()}
                      </div>
                    </div>
                  )}

                  {(newGameFormat === "better_ball_2" ||
                    newGameFormat === "better_ball_4" ||
                    newGameFormat === "scramble_2" ||
                    newGameFormat === "scramble_4" ||
                    newGameFormat === "composite") && (
                    <div style={styles.helpText}>
                      Teams come from your tee sheet's "team" column.
                      {(() => {
                        const teamSize =
                          newGameFormat === "composite" ? clampInt(newGameTeamSize, 2) : GAME_FORMAT_TEAM_SIZE[newGameFormat];
                        const groups = teamPreviewGroups(teamSize);
                        if (groups.length === 0) {
                          return ' No team groupings found yet — add a "team" column to the tee sheet and re-import.';
                        }
                        return (
                          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                            {groups.map((g) => (
                              <div key={g.label} style={{ color: g.mismatched ? THEME.bad : THEME.textMuted }}>
                                Team "{g.label}": {g.members.map((m) => m.name).join(", ")}
                                {g.mismatched ? ` (expected ${teamSize})` : ""}
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  <button style={styles.bigBtn} onClick={createGame}>
                    Create Game
                    </button>
                    {gamesMsg ? <div style={styles.helpText}>{gamesMsg}</div> : null}
                    </div>
                  </>
                )}
            </div>
          </AdminSection>

          {/* Multi-Round setup */}
          <AdminSection
            title="Rounds"
            subtitle={
              appSettings.multi_round_enabled
                ? `${rounds.length} round${rounds.length === 1 ? "" : "s"}`
                : "Single round"
            }
            open={openAdminSection === "rounds"}
            onToggle={() => setOpenAdminSection((k) => (k === "rounds" ? null : "rounds"))}
          >
            <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, color: THEME.textMuted }}>
              <input
                type="checkbox"
                checked={!!appSettings.multi_round_enabled}
                onChange={(e) => setMultiRoundEnabled(e.target.checked)}
              />
              Enable multiple rounds for this event
            </label>

            {!appSettings.multi_round_enabled ? (
              <div style={styles.helpText}>
                Off by default. This event runs one round, same as always. Turn this on for a 2-day/3-day event —
                each round gets its own tee sheet import, and the Leaderboard gets an Overall total plus a tab per
                round.
              </div>
            ) : (
              <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
                <div style={{ display: "grid", gap: 10 }}>
                  {rounds.map((r) => (
                    <div key={r.id} style={styles.foursomeCard}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <div style={{ fontWeight: 950 }}>
                          {r.label}{" "}
                          {r.is_active && <span style={{ ...styles.strokePill, marginLeft: 6 }}>Active</span>}
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {!r.is_active && (
                            <button style={styles.smallBtn} onClick={() => setRoundActive(r)}>
                              Set Active
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div style={styles.hr} />

                <div style={styles.sectionLabel}>Add Round</div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <input
                    style={{ ...styles.input, flex: 1, minWidth: 160 }}
                    value={newRoundLabel}
                    onChange={(e) => setNewRoundLabel(e.target.value)}
                    placeholder={`Round ${rounds.length + 1}`}
                  />
                  <button style={styles.bigBtn} onClick={createRound}>
                    Add Round
                  </button>
                </div>
                {roundsMsg ? <div style={styles.helpText}>{roundsMsg}</div> : null}

                <div style={styles.helpText}>
                  "Active" is the round Enter Scores codes and new tee-sheet imports default to, and the round The
                  Broadcast and player scorecards track. The Leaderboard's Overall tab and per-round tabs show every
                  round regardless of which one is active.
                </div>
              </div>
            )}
          </AdminSection>

          {/* Danger Zone — every irreversible action lives here, away from routine buttons */}
          <AdminSection
            title="⚠️ Danger Zone"
            danger
            open={openAdminSection === "danger"}
            onToggle={() => {
              // Opening the Danger Zone always asks for the passcode again.
              setDangerUnlocked(false);
              setDangerPin("");
              setDangerPinMsg("");
              setOpenAdminSection((k) => (k === "danger" ? null : "danger"));
            }}
          >
            {!dangerUnlocked ? (
              <div style={{ display: "grid", gap: 10, maxWidth: 360 }}>
                <div style={styles.helpText}>Enter the Admin passcode to open the Danger Zone.</div>
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  style={{ ...styles.input, fontSize: 16, minHeight: 46, boxSizing: "border-box" }}
                  value={dangerPin}
                  onChange={(e) => {
                    setDangerPin(e.target.value);
                    setDangerPinMsg("");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") unlockDanger();
                  }}
                  placeholder="Passcode"
                />
                <button style={{ ...styles.bigBtn, minHeight: 48 }} onClick={unlockDanger}>
                  Unlock Danger Zone
                </button>
                {dangerPinMsg ? (
                  <div style={{ fontSize: 13, color: THEME.danger, fontWeight: 700 }}>{dangerPinMsg}</div>
                ) : null}
              </div>
            ) : (
              <>
            <div style={styles.helpText}>Every action below is irreversible. Each one asks you to confirm first.</div>

            <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
              <div>
                <div style={styles.sectionLabel}>Clear Foursomes</div>
                <div style={styles.helpText}>
                  Removes every foursome and player assignment for this event. Does not delete players or scores.
                </div>
                <button style={{ ...styles.dangerBtn, marginTop: 10 }} onClick={clearFoursomes}>
                  Clear Foursomes
                </button>
              </div>

              <div>
                <div style={styles.hr} />
                <div style={{ ...styles.sectionLabel, marginTop: 14 }}>Clear all messages</div>
                <div style={styles.helpText}>
                  Deletes every message on The Broadcast (and the TV Mode strip). Scores and players are not touched.
                </div>
                <button style={{ ...styles.dangerBtn, marginTop: 10, minHeight: 44 }} onClick={clearBroadcastMessages}>
                  Clear all messages
                </button>
                {clearMsg ? <div style={styles.helpText}>{clearMsg}</div> : null}
                {clearNeedsSetup ? <ClearMessagesSetupNotice /> : null}
              </div>

              <DeletePlayersPanel
                players={players}
                groupNameByPlayer={
                  new Map(
                    foursomePlayers
                      .filter((fp) => foursomes.some((f) => f.id === fp.foursome_id && (!f.round_id || f.round_id === activeRound?.id)))
                      .map((fp) => [fp.player_id, foursomes.find((f) => f.id === fp.foursome_id)?.group_name])
                  )
                }
                onDelete={deletePlayers}
              />

              {games.length > 0 && (
                <div>
                  <div style={styles.hr} />
                  <div style={{ ...styles.sectionLabel, marginTop: 14 }}>Delete a Game</div>
                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    {games.map((g) => (
                      <div
                        key={g.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <span style={{ fontSize: 13 }}>{g.name}</span>
                        <button style={styles.dangerBtn} onClick={() => deleteGame(g)}>
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {appSettings.multi_round_enabled && rounds.length > 0 && (
                <div>
                  <div style={styles.hr} />
                  <div style={{ ...styles.sectionLabel, marginTop: 14 }}>Delete a Round</div>
                  <div style={styles.helpText}>Also removes that round's foursomes and every score entered for it.</div>
                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    {rounds.map((r) => (
                      <div
                        key={r.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                          flexWrap: "wrap",
                        }}
                      >
                        <span style={{ fontSize: 13 }}>{r.label}</span>
                        <button style={styles.dangerBtn} onClick={() => deleteRound(r)}>
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
              </>
            )}
          </AdminSection>
        </div>
        )}
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
   {acePopup && <AcePopup msg={acePopup} players={players} onClose={dismissAce} />}
   {printAllOn && (
  <PrintTwoUpScorecards
    foursomes={foursomes}
    players={players}
    foursomePlayers={foursomePlayers}
    strokesOnHole={strokesOnHole}
    clampInt={clampInt}
    lastName={lastName}
    STROKE_INDEX={STROKE_INDEX}
    eventName={eventName}
    logoSrc={logoSrc}
    game={printGame}
    fieldOffset={fieldOffset}
  />
)}
</div>
  );
}

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

/** A group's tee time + starting hole from the tee-time settings (position `i` of `count`). */
function phoneSlot(settings, i, count) {
  return {
    teeTime: settings.shotgun
      ? settings.firstTee
      : addMinutesToTime(settings.firstTee, i * settings.gapMin) || settings.firstTee,
    startingHole: settings.shotgun ? shotgunHole(i, count) : 1,
  };
}

/**
 * "Build on my phone" — the second way to start a tournament. Three short
 * steps (Players → Groups → Review & Start) that end in the exact same
 * records as the Excel import: it hands rows in the sheet's shape to the one
 * shared writer (`onStart` = runTeeSheetImport).
 */
function PhoneSetup({
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
      if (name && name !== eventName) await onSaveEventName(name);
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
                <input type="time" style={bigField} value={settings.firstTee} onChange={(e) => applyTee({ ...settings, firstTee: e.target.value })} />
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
                <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) 64px" }}>
                  <label style={styles.label}>
                    Group name
                    <input style={bigField} value={g.name} onChange={(e) => setGroup(gi, { name: e.target.value })} />
                  </label>
                  <label style={styles.label}>
                    Tee time
                    <input type="time" style={bigField} value={g.teeTime} onChange={(e) => setGroup(gi, { teeTime: e.target.value })} />
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

/**
 * The leaderboard rows (everything the Leaderboard, TV Mode and the Broadcast
 * rank from). `cutoffMs`, when given, ignores scores saved after that moment —
 * that's how the Broadcast asks "what were the standings a few minutes ago?".
 */
function buildLeaderboardRows(players, scores, activeRoundId, fieldOffset, cutoffMs = null) {
  // last-write-wins scores by player/hole
  const scoresByPlayer = new Map();
  for (const s of scores) {
    if (activeRoundId != null && s.round_id !== activeRoundId) continue;
    if (cutoffMs != null && new Date(s.created_at).getTime() > cutoffMs) continue;
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
    // `handicap` is the player's real course handicap (shown as their
    // "HCP" badge). `playingHandicap` is what stroke/net-score math
    // actually uses — the same number, unless Field-Relative mode shifts
    // it by the field's lowest handicap.
    const handicap = clampInt(p.handicap, 0);
    const playingHandicap = handicap - fieldOffset;

    const gross = playedHoles.reduce((acc, h) => acc + scoresByHole[h], 0);
    const parPlayed = playedHoles.reduce((acc, h) => acc + PARS[h - 1], 0);

    // Real net (stroke index allocation)
    const netGross = playedHoles.reduce((acc, h) => {
      const grossHole = scoresByHole[h];
      const netHole = netScoreForHole(grossHole, playingHandicap, h);
      return acc + netHole;
    }, 0);

    const netToPar = holesPlayed === 0 ? 9999 : netGross - parPlayed;

    return {
      id: p.id,
      name: p.name,
      last: lastName(p.name),
      handicap,
      playingHandicap,
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

  // ✅ Assign display ranks with tie handling: 1, 1, 3...
  // Tie rule: same netToPar AND same holesPlayed
  let lastKey = null;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    // Only tie players who have scores; otherwise don't tie the "—" rows
    const key = r.holesPlayed > 0 ? `${r.netToPar}|${r.holesPlayed}` : `noscore|${r.id}`;

    if (i === 0) {
      r.displayRank = 1;
    } else if (key === lastKey) {
      r.displayRank = rows[i - 1].displayRank; // same rank as previous row
    } else {
      r.displayRank = i + 1; // competition ranking jump
    }

    lastKey = key;
  }

  return rows;
}

/** Hole-in-one popup: shown for 10 minutes after the card is posted, once per phone. */
const ACE_POPUP_MS = 10 * 60 * 1000;
const SEEN_ACES_KEY = "ginv_seen_aces";
let seenAcesFallback = [];

function readSeenAces() {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_ACES_KEY) || "[]");
    return Array.isArray(v) ? v : seenAcesFallback;
  } catch {
    return seenAcesFallback;
  }
}

function rememberSeenAce(id) {
  seenAcesFallback = [...seenAcesFallback, id].slice(-50);
  try {
    localStorage.setItem(SEEN_ACES_KEY, JSON.stringify([...readSeenAces().filter((x) => x !== id), id].slice(-50)));
  } catch {
    /* blocked storage: the in-memory list still stops a repeat until the page reloads */
  }
}

function AcePopup({ msg, players, onClose }) {
  const player = players.find((p) => p.id === msg.player_id);
  const hole = String(msg.dedupe_key || "").split("|")[2];
  const name = player ? shortName(player.name) : null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Hole in one"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 300,
        display: "grid",
        placeItems: "center",
        padding: 16,
        background: "rgba(5, 12, 9, 0.78)",
      }}
    >
      <style>{"@keyframes acePop { 0% { transform: scale(0.8); opacity: 0; } 60% { transform: scale(1.04); } 100% { transform: scale(1); opacity: 1; } }"}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(420px, 100%)",
          boxSizing: "border-box",
          textAlign: "center",
          padding: "28px 20px 22px",
          borderRadius: 22,
          background: THEME.surface,
          border: `2px solid ${THEME.accent}`,
          boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
          animation: "acePop 0.35s ease-out",
        }}
      >
        <div style={{ fontSize: 44, lineHeight: 1 }}>🎉⛳🎉</div>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 600, fontSize: 28, marginTop: 10, color: THEME.text }}>
          HOLE IN ONE!
        </div>
        <div style={{ fontSize: 17, lineHeight: 1.4, marginTop: 10, color: THEME.text, overflowWrap: "anywhere" }}>
          {name
            ? `${name} just made a hole-in-one${hole ? ` on #${hole}` : ""}! Drinks are on them. 🍻`
            : msg.text}
        </div>
        <button style={{ ...styles.bigBtn, marginTop: 18, minHeight: 48, width: "100%" }} onClick={onClose}>
          Let's go! 🎉
        </button>
      </div>
    </div>
  );
}

// How each kind of Broadcast card looks. Older kinds from earlier versions fall back to a plain 📣 card.
const BROADCAST_KIND = {
  leader: { label: "New leader", accent: "#B08A2E", big: false },
  champion: { label: "Champion", accent: "#B08A2E", big: true },
  lex: { label: "The LEX", accent: "#994B3E", big: false },
  lexfinal: { label: "The LEX", accent: "#994B3E", big: true },
  fire: { label: "On fire", emoji: "🔥", accent: "#E0732B" },
  ice: { label: "Iced", emoji: "❄️", accent: "#4C8FBF" },
  swing: { label: "Big swing", emoji: "↕️", accent: "#6B7F73" },
  eagle: { label: "Eagle", emoji: "🦅", accent: "#2F7D5B", big: true },
  ace: { label: "Hole in one", emoji: "🎉", accent: "#D4A017", big: true },
  war: { label: "Lead battle", emoji: "⚔️", accent: "#7A4E8C" },
  hotgroup: { label: "Hot group", emoji: "🌶️", accent: "#E0732B" },
  recap: { label: "Recap", emoji: "⛳", accent: "#4E5C54" },
  roundup: { label: "Roundup", emoji: "📣", accent: "#4E5C54" },
};

function BroadcastIcon({ kind, height = "22px" }) {
  if (kind === "leader" || kind === "champion") return <LeaderIcon height={height} />;
  if (kind === "lex" || kind === "lexfinal") return <LastPlaceIcon height={height} />;
  return <span style={{ fontSize: height, lineHeight: 1 }}>{BROADCAST_KIND[kind]?.emoji || "📣"}</span>;
}

function timeAgo(ms, now) {
  const mins = Math.max(0, Math.round((now - ms) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 24 * 60) return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** The Broadcast page: newest 25 cards, grouped, with a "Show earlier" button. */
function BroadcastFeed({ messages }) {
  const [shown, setShown] = useState(25);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (messages.length === 0) {
    return (
      <div style={styles.broadcastItem}>
        <div style={{ fontWeight: 950 }}>No updates yet</div>
        <div style={{ marginTop: 6, color: THEME.textMuted, fontSize: 12 }}>
          Once scores start coming in, the moments worth talking about will show up here.
        </div>
      </div>
    );
  }

  const today = new Date(now).toDateString();
  const groupOf = (ms) => {
    if (now - ms < 15 * 60000) return "Just now";
    return new Date(ms).toDateString() === today
      ? "Earlier today"
      : new Date(ms).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  };

  const visible = messages.slice(0, shown);
  const groups = visible.map((m) => groupOf(new Date(m.created_at).getTime()));
  return (
    <>
      {visible.map((m, i) => {
        const ms = new Date(m.created_at).getTime();
        const meta = BROADCAST_KIND[m.kind] || { label: "Update", accent: THEME.borderStrong };
        const heading = i === 0 || groups[i] !== groups[i - 1] ? groups[i] : null;
        return (
          <div key={m.id} style={{ display: "grid", gap: 8 }}>
            {heading ? (
              <div
                style={{
                  marginTop: 4,
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: 1.6,
                  textTransform: "uppercase",
                  color: THEME.textMuted,
                }}
              >
                {heading}
              </div>
            ) : null}
            <div
              style={{
                ...styles.broadcastItem,
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
                borderLeft: `5px solid ${meta.accent}`,
                background: meta.big ? "rgba(159, 119, 80, 0.12)" : styles.broadcastItem.background,
              }}
            >
              <div style={{ flex: "none", width: 48, minHeight: 28, display: "grid", placeItems: "center" }}>
                <BroadcastIcon kind={m.kind} height={meta.big ? "30px" : "24px"} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700, color: THEME.textMuted }}>
                  {meta.label} • {timeAgo(ms, now)}
                </div>
                <div
                  style={{
                    marginTop: 4,
                    fontWeight: meta.big ? 800 : 600,
                    fontSize: meta.big ? 17 : 15,
                    lineHeight: 1.35,
                    overflowWrap: "anywhere",
                  }}
                >
                  {m.text}
                </div>
              </div>
            </div>
          </div>
        );
      })}
      {messages.length > shown ? (
        <button style={{ ...styles.smallBtn, minHeight: 44 }} onClick={() => setShown((n) => n + 25)}>
          Show earlier ({messages.length - shown} more)
        </button>
      ) : null}
    </>
  );
}

/** Shown in the Danger Zone until the database allows deleting Broadcast messages (migration 0011). */
function ClearMessagesSetupNotice() {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 800 }}>One-time setup needed</div>
      <div style={styles.helpText}>
        The database doesn't allow deleting Broadcast messages yet. In Supabase, open <b>SQL Editor</b>, paste the
        lines below and click <b>Run</b>, then come back here and tap <b>Clear all messages</b> again.
      </div>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          marginTop: 8,
          padding: 10,
          borderRadius: 12,
          border: `1px solid ${THEME.border}`,
          background: "rgba(22,35,29,0.05)",
          fontSize: 12,
          color: THEME.text,
        }}
      >
        {CLEAR_MESSAGES_SQL}
      </pre>
      <button
        style={{ ...styles.smallBtn, marginTop: 8, minHeight: 44 }}
        onClick={() => {
          Promise.resolve(navigator.clipboard?.writeText(CLEAR_MESSAGES_SQL)).then(
            () => setCopied(true),
            () => setCopied(false)
          );
        }}
      >
        {copied ? "Copied ✅" : "Copy SQL"}
      </button>
    </div>
  );
}

const CLEAR_MESSAGES_SQL = `drop policy if exists "allow delete broadcast_messages" on broadcast_messages;
create policy "allow delete broadcast_messages"
  on broadcast_messages for delete
  using (true);`;

const hcpLabel = (h) => (clampInt(h, 0) < 0 ? `+${Math.abs(clampInt(h, 0))}` : String(clampInt(h, 0)));
const toTimeInput = (t) => (t ? String(t).slice(0, 5) : "");
const MAX_GROUP_SIZE = 4;

/** Name / handicap (with Plus box) / charity fields shared by "Add player" and "Edit player". */
function PlayerFields({ draft, setDraft, onSubmit, submitLabel, onCancel, busy, children }) {
  const field = { ...styles.input, fontSize: 16, minHeight: 46, boxSizing: "border-box", width: "100%" };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      style={{ display: "grid", gap: 10, gridTemplateColumns: "minmax(0, 1fr)" }}
    >
      <label style={styles.label}>
        Name
        <input
          style={field}
          value={draft.name}
          autoComplete="off"
          autoCapitalize="words"
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10, alignItems: "end" }}>
        <label style={styles.label}>
          Handicap
          <input
            style={field}
            value={draft.hcp}
            inputMode="numeric"
            pattern="[0-9]*"
            onChange={(e) => setDraft({ ...draft, hcp: e.target.value.replace(/[^\d]/g, "").slice(0, 2) })}
          />
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 46, fontSize: 14, color: THEME.text }}>
          <input
            type="checkbox"
            style={{ width: 22, height: 22 }}
            checked={draft.plus}
            onChange={(e) => setDraft({ ...draft, plus: e.target.checked })}
          />
          Plus
        </label>
      </div>
      <label style={styles.label}>
        Charity (optional)
        <input style={field} value={draft.charity} autoComplete="off" onChange={(e) => setDraft({ ...draft, charity: e.target.value })} />
      </label>
      {children}
      <div style={{ display: "flex", gap: 10 }}>
        <button type="submit" disabled={busy} style={{ ...styles.bigBtn, flex: 1, minHeight: 48, opacity: busy ? 0.6 : 1 }}>
          {submitLabel}
        </button>
        {onCancel ? (
          <button type="button" style={{ ...styles.smallBtn, minHeight: 44 }} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

const emptyPlayerDraft = { name: "", hcp: "", plus: false, charity: "" };
const draftFromPlayer = (p) => ({
  name: p.name || "",
  hcp: String(Math.abs(clampInt(p.handicap, 0))),
  plus: clampInt(p.handicap, 0) < 0,
  charity: p.charity || "",
});

/** Validates a player draft; returns { error } or { name, handicap, charity }. */
function readPlayerDraft(draft, players, selfId) {
  const name = draft.name.trim().replace(/\s+/g, " ");
  if (!name) return { error: "Enter the player's name." };
  if (!/^\d{1,2}$/.test(draft.hcp.trim()) || Number(draft.hcp.trim()) > 54) {
    return { error: "Enter a handicap from 0 to 54 (use the Plus box for a plus handicap)." };
  }
  if (players.some((p) => p.id !== selfId && String(p.name || "").trim().toLowerCase() === name.toLowerCase())) {
    return { error: `${name} is already a player.` };
  }
  const n = Number(draft.hcp.trim());
  return { name, handicap: draft.plus && n !== 0 ? -n : n, charity: draft.charity.trim() || null };
}

/** One group: summary, and an editor for its name / tee time / hole / members. */
function RosterGroupCard({ f, members, otherGroups, unassigned, inOtherGroups, ops, busy, multiRound, roundLabel }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(f.group_name || "");
  const [time, setTime] = useState(toTimeInput(f.tee_time));
  const [hole, setHole] = useState(String(f.starting_hole || 1));
  const [addId, setAddId] = useState("");
  const field = { ...styles.input, fontSize: 16, minHeight: 46, boxSizing: "border-box", width: "100%" };
  const full = members.length >= MAX_GROUP_SIZE;

  const open = () => {
    setName(f.group_name || "");
    setTime(toTimeInput(f.tee_time));
    setHole(String(f.starting_hole || 1));
    setAddId("");
    setEditing(true);
  };

  return (
    <div style={styles.foursomeCard}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 950, overflowWrap: "anywhere" }}>
            {f.group_name} <span style={{ opacity: 0.78, fontWeight: 800 }}>(Code: {f.code})</span>
          </div>
          <div style={{ fontSize: 12, color: THEME.textMuted, marginTop: 6 }}>
            {multiRound ? <>Round: <b>{roundLabel}</b> • </> : null}
            Tee: <b>{formatTeeTime(f.tee_time) || "—"}</b> • Start Hole: <b>{f.starting_hole || "—"}</b> • Members:{" "}
            <b>{members.length}</b>
          </div>
        </div>
        <button style={{ ...styles.smallBtn, minHeight: 44, flex: "none" }} onClick={() => (editing ? setEditing(false) : open())}>
          {editing ? "Close" : "Edit"}
        </button>
      </div>

      {editing ? (
        <div style={{ display: "grid", gap: 10, marginTop: 12, gridTemplateColumns: "minmax(0, 1fr)" }}>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) 64px" }}>
            <label style={styles.label}>
              Group name
              <input style={field} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label style={styles.label}>
              Tee time
              <input type="time" style={field} value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
            <label style={styles.label}>
              Hole
              <input
                style={field}
                inputMode="numeric"
                value={hole}
                onChange={(e) => setHole(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
              />
            </label>
          </div>
          <button
            style={{ ...styles.bigBtn, minHeight: 48, opacity: busy ? 0.6 : 1 }}
            disabled={busy}
            onClick={() => ops.saveGroup(f, { name, time, hole })}
          >
            Save group
          </button>

          <div style={styles.sectionLabel}>Members</div>
          {members.length === 0 ? <div style={styles.helpText}>No players in this group.</div> : null}
          {members.map((p) => (
            <div key={p.id} style={{ ...styles.playerRow, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0, flex: "1 1 140px" }}>
                <div style={{ fontWeight: 950, overflowWrap: "anywhere" }}>{p.name}</div>
                <div style={styles.playerMeta}>HCP {hcpLabel(p.handicap)}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {otherGroups.length > 0 ? (
                  <select
                    aria-label={`Move ${p.name} to another group`}
                    style={{ ...field, width: "auto", minHeight: 44, fontSize: 14, padding: "6px 8px" }}
                    value=""
                    disabled={busy}
                    onChange={(e) => e.target.value && ops.moveMember(p, e.target.value)}
                  >
                    <option value="">Move to…</option>
                    {otherGroups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.group_name}
                      </option>
                    ))}
                  </select>
                ) : null}
                <button style={{ ...styles.smallBtn, minHeight: 44 }} disabled={busy} onClick={() => ops.removeMember(f, p)}>
                  Remove
                </button>
              </div>
            </div>
          ))}

          <label style={styles.label}>
            Add a player to this group
            <div style={{ display: "flex", gap: 8 }}>
              <select style={{ ...field, flex: 1 }} value={addId} disabled={full} onChange={(e) => setAddId(e.target.value)}>
                <option value="">{full ? `Group is full (${MAX_GROUP_SIZE})` : "Choose a player…"}</option>
                {unassigned.length > 0 && (
                  <optgroup label="Not in a group">
                    {unassigned.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {inOtherGroups.length > 0 && (
                  <optgroup label="In another group (moves them)">
                    {inOtherGroups.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              <button
                style={{ ...styles.smallBtn, minHeight: 46, opacity: !addId || busy || full ? 0.5 : 1 }}
                disabled={!addId || busy || full}
                onClick={async () => {
                  await ops.addMember(addId, f);
                  setAddId("");
                }}
              >
                Add
              </button>
            </div>
          </label>

          <div style={styles.hr} />
          <button style={{ ...styles.dangerBtn, minHeight: 44 }} disabled={busy} onClick={() => ops.deleteGroup(f, members)}>
            Delete this group
          </button>
          <div style={styles.helpText}>The players stay in the event; they just won&apos;t be in a group.</div>
        </div>
      ) : (
        <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
          {members.map((p) => (
            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 14 }}>
              <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{p.name}</span>
              <span style={{ color: THEME.textMuted, flex: "none" }}>HCP {hcpLabel(p.handicap)}</span>
            </div>
          ))}
          {members.length === 0 ? <div style={styles.helpText}>No players assigned.</div> : null}
        </div>
      )}
    </div>
  );
}

/** One player row with an inline editor. */
function RosterPlayerRow({ p, groupName, players, ops, busy }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(draftFromPlayer(p));
  const [err, setErr] = useState("");
  return (
    <div style={{ ...styles.playerRow, flexDirection: "column", alignItems: "stretch" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 950, overflowWrap: "anywhere" }}>{p.name}</div>
          <div style={styles.playerMeta}>
            HCP {hcpLabel(p.handicap)}
            {p.charity ? ` • ${p.charity}` : ""} • {groupName || "No group"}
          </div>
        </div>
        <button
          style={{ ...styles.smallBtn, minHeight: 44, flex: "none" }}
          onClick={() => {
            setDraft(draftFromPlayer(p));
            setErr("");
            setEditing((v) => !v);
          }}
        >
          {editing ? "Close" : "Edit"}
        </button>
      </div>
      {editing ? (
        <div style={{ marginTop: 10 }}>
          <PlayerFields
            draft={draft}
            setDraft={(d) => {
              setDraft(d);
              setErr("");
            }}
            busy={busy}
            submitLabel="Save player"
            onCancel={() => setEditing(false)}
            onSubmit={async () => {
              const r = readPlayerDraft(draft, players, p.id);
              if (r.error) return setErr(r.error);
              const ok = await ops.savePlayer(p, r);
              if (ok) setEditing(false);
            }}
          >
            {err ? <div style={{ fontSize: 13, color: THEME.danger, fontWeight: 700 }}>{err}</div> : null}
          </PlayerFields>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Admin → Players & Groups: edit players (name, handicap, charity), add a
 * player, and edit groups after they exist (name, tee time, starting hole,
 * who is in them, add/delete a group). Works on the active round (or the
 * round you pick when several rounds are on).
 */
function RosterEditor({ players, foursomes, foursomePlayers, rounds, activeRound, multiRound, onChanged }) {
  const [roundPick, setRoundPick] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [addingGroup, setAddingGroup] = useState(false);
  const [gDraft, setGDraft] = useState({ name: "", time: "", hole: "1" });
  const [addingPlayer, setAddingPlayer] = useState(false);
  const [pDraft, setPDraft] = useState(emptyPlayerDraft);
  const [pGroup, setPGroup] = useState("");
  const [pErr, setPErr] = useState("");
  const [filter, setFilter] = useState("");
  const field = { ...styles.input, fontSize: 16, minHeight: 46, boxSizing: "border-box", width: "100%" };

  const roundId = multiRound ? roundPick || activeRound?.id || "" : activeRound?.id || "";
  const groups = useMemo(() => {
    return foursomes
      .filter((f) => !f.round_id || f.round_id === roundId)
      .sort(
        (a, b) =>
          String(a.tee_time || "99").localeCompare(String(b.tee_time || "99")) ||
          String(a.group_name).localeCompare(String(b.group_name), undefined, { numeric: true })
      );
  }, [foursomes, roundId]);

  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const groupOfPlayer = useMemo(() => {
    const ids = new Set(groups.map((g) => g.id));
    const m = new Map();
    for (const fp of foursomePlayers) {
      if (!ids.has(fp.foursome_id)) continue;
      m.set(fp.player_id, groups.find((g) => g.id === fp.foursome_id));
    }
    return m;
  }, [groups, foursomePlayers]);
  const membersOf = (f) =>
    foursomePlayers
      .filter((fp) => fp.foursome_id === f.id)
      .map((fp) => playerById.get(fp.player_id))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));

  const sameName = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

  // Run one change: show errors, otherwise reload the data and confirm.
  async function run(fn, okText = "Saved ✅") {
    if (busy) return false;
    setBusy(true);
    setMsg("Saving…");
    try {
      const err = await fn();
      if (err) {
        setMsg(err);
        return false;
      }
      await onChanged();
      setMsg(okText);
      return true;
    } catch (e) {
      console.error(e);
      setMsg(`Something went wrong: ${errToText(e)}`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  // A player's game "team" follows their group name (same as the import does),
  // but only when it was following the old name, so a hand-set team is left alone.
  async function syncTeamLabel(playerIds, fromName, toName) {
    for (const id of playerIds) {
      const p = playerById.get(id);
      if (!p) continue;
      const label = String(p.team_label || "").trim();
      if (label && !sameName(label, fromName)) continue;
      const { error } = await supabase.from("players").update({ team_label: toName || null }).eq("id", id);
      if (error) return errToText(error);
    }
    return null;
  }

  function validateGroup(d, selfId) {
    const name = d.name.trim();
    if (!name) return { error: "Give the group a name." };
    if (groups.some((g) => g.id !== selfId && sameName(g.group_name, name))) return { error: `There is already a group called "${name}".` };
    const hole = Number(d.hole);
    if (!(hole >= 1 && hole <= 18)) return { error: "Starting hole must be 1 to 18." };
    return { name, hole: Math.trunc(hole), tee_time: d.time ? `${d.time}:00` : null };
  }

  const ops = {
    saveGroup: (f, d) =>
      run(async () => {
        const v = validateGroup(d, f.id);
        if (v.error) return v.error;
        const { error } = await supabase
          .from("foursomes")
          .update({ group_name: v.name, tee_time: v.tee_time, starting_hole: v.hole })
          .eq("id", f.id);
        if (error) return errToText(error);
        if (!sameName(f.group_name, v.name)) {
          return syncTeamLabel(membersOf(f).map((p) => p.id), f.group_name, v.name);
        }
        return null;
      }),

    removeMember: (f, p) =>
      run(async () => {
        const { error } = await supabase.from("foursome_players").delete().eq("foursome_id", f.id).eq("player_id", p.id);
        if (error) return errToText(error);
        return syncTeamLabel([p.id], f.group_name, null);
      }),

    // Moves (or adds) a player into a group, taking them out of any other group this round.
    addMember: (playerId, f) =>
      run(async () => {
        const p = playerById.get(playerId);
        if (!p) return "That player no longer exists.";
        if (membersOf(f).length >= MAX_GROUP_SIZE && groupOfPlayer.get(playerId)?.id !== f.id) {
          return `${f.group_name} is full (${MAX_GROUP_SIZE} players).`;
        }
        const from = groupOfPlayer.get(playerId);
        if (from?.id === f.id) return null;
        if (from) {
          const del = await supabase.from("foursome_players").delete().eq("foursome_id", from.id).eq("player_id", playerId);
          if (del.error) return errToText(del.error);
        }
        const ins = await supabase.from("foursome_players").insert({ foursome_id: f.id, player_id: playerId });
        if (ins.error) return errToText(ins.error);
        return syncTeamLabel([playerId], from ? from.group_name : null, f.group_name);
      }),

    moveMember: (p, toId) => {
      const to = groups.find((g) => g.id === toId);
      return to ? ops.addMember(p.id, to) : Promise.resolve(false);
    },

    deleteGroup: async (f, members) => {
      if (!confirm(`Delete "${f.group_name}"? Its ${members.length} player(s) stay in the event but won't be in a group.`)) return false;
      return run(async () => {
        const a = await supabase.from("foursome_players").delete().eq("foursome_id", f.id);
        if (a.error) return errToText(a.error);
        const b = await supabase.from("foursomes").delete().eq("id", f.id);
        if (b.error) return errToText(b.error);
        return syncTeamLabel(members.map((p) => p.id), f.group_name, null);
      }, "Group deleted ✅");
    },

    savePlayer: (p, v) =>
      run(async () => {
        const { error } = await supabase
          .from("players")
          .update({ name: v.name, handicap: v.handicap, charity: v.charity })
          .eq("id", p.id);
        return error ? errToText(error) : null;
      }),
  };

  async function createGroup() {
    const v = validateGroup(gDraft, null);
    if (v.error) return setMsg(v.error);
    if (!roundId) return setMsg("No round to add the group to yet — reload the page and try again.");
    const ok = await run(async () => {
      let created = false;
      for (let tries = 0; tries < 10 && !created; tries++) {
        const { error } = await supabase
          .from("foursomes")
          .insert({ group_name: v.name, code: makeCode(6), tee_time: v.tee_time, starting_hole: v.hole, round_id: roundId });
        if (!error) created = true;
      }
      return created ? null : "Could not create the group (try again).";
    }, `Added "${v.name}" ✅`);
    if (ok) {
      setGDraft({ name: "", time: "", hole: "1" });
      setAddingGroup(false);
    }
  }

  async function createPlayer() {
    const v = readPlayerDraft(pDraft, players, null);
    if (v.error) return setPErr(v.error);
    const group = groups.find((g) => g.id === pGroup) || null;
    if (group && membersOf(group).length >= MAX_GROUP_SIZE) return setPErr(`${group.group_name} is full (${MAX_GROUP_SIZE} players).`);
    const ok = await run(async () => {
      const { data, error } = await supabase
        .from("players")
        .insert({ name: v.name, handicap: v.handicap, charity: v.charity, team_label: group ? group.group_name : null })
        .select("id")
        .single();
      if (error) return errToText(error);
      if (group) {
        const ins = await supabase.from("foursome_players").insert({ foursome_id: group.id, player_id: data.id });
        if (ins.error) return errToText(ins.error);
      }
      return null;
    }, `Added ${v.name} ✅`);
    if (ok) {
      setPDraft(emptyPlayerDraft);
      setPGroup("");
      setPErr("");
      setAddingPlayer(false);
    }
  }

  const shownPlayers = players
    .filter((p) => !filter.trim() || p.name.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
      <div style={styles.helpText}>
        Change a player or a group any time, even after the tournament has started. A player&apos;s scores stay with
        them. Existing 2-man / 4-man game teams are not changed.
      </div>

      {multiRound ? (
        <label style={styles.label}>
          Round
          <select style={field} value={roundId} onChange={(e) => setRoundPick(e.target.value)}>
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
                {r.is_active ? " (active)" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {msg ? <div style={{ fontSize: 13, fontWeight: 700, color: /✅/.test(msg) ? THEME.text : THEME.danger }}>{msg}</div> : null}

      <div style={styles.sectionLabel}>Groups ({groups.length})</div>
      {groups.length === 0 ? <div style={styles.helpText}>No groups yet.</div> : null}
      {groups.map((f) => {
        const members = membersOf(f);
        const memberIds = new Set(members.map((p) => p.id));
        const others = players.filter((p) => !memberIds.has(p.id));
        return (
          <RosterGroupCard
            key={f.id}
            f={f}
            members={members}
            otherGroups={groups.filter((g) => g.id !== f.id)}
            unassigned={others.filter((p) => !groupOfPlayer.has(p.id)).sort((a, b) => a.name.localeCompare(b.name))}
            inOtherGroups={others.filter((p) => groupOfPlayer.has(p.id)).sort((a, b) => a.name.localeCompare(b.name))}
            ops={ops}
            busy={busy}
            multiRound={multiRound}
            roundLabel={rounds.find((r) => r.id === f.round_id)?.label || "—"}
          />
        );
      })}

      {addingGroup ? (
        <div style={{ ...styles.foursomeCard, display: "grid", gap: 10 }}>
          <div style={styles.sectionLabel}>New group</div>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) 64px" }}>
            <label style={styles.label}>
              Group name
              <input style={field} value={gDraft.name} onChange={(e) => setGDraft({ ...gDraft, name: e.target.value })} />
            </label>
            <label style={styles.label}>
              Tee time
              <input type="time" style={field} value={gDraft.time} onChange={(e) => setGDraft({ ...gDraft, time: e.target.value })} />
            </label>
            <label style={styles.label}>
              Hole
              <input
                style={field}
                inputMode="numeric"
                value={gDraft.hole}
                onChange={(e) => setGDraft({ ...gDraft, hole: e.target.value.replace(/[^\d]/g, "").slice(0, 2) })}
              />
            </label>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button style={{ ...styles.bigBtn, flex: 1, minHeight: 48 }} disabled={busy} onClick={createGroup}>
              Add group
            </button>
            <button style={{ ...styles.smallBtn, minHeight: 44 }} onClick={() => setAddingGroup(false)}>
              Cancel
            </button>
          </div>
          <div style={styles.helpText}>A code is made for it automatically. Add players to it afterwards with Edit.</div>
        </div>
      ) : (
        <button style={{ ...styles.smallBtn, minHeight: 44 }} onClick={() => setAddingGroup(true)}>
          + Add group
        </button>
      )}

      <div style={styles.hr} />
      <div style={styles.sectionLabel}>Players ({players.length})</div>

      {addingPlayer ? (
        <div style={{ ...styles.foursomeCard }}>
          <div style={{ ...styles.sectionLabel, marginBottom: 10 }}>New player</div>
          <PlayerFields
            draft={pDraft}
            setDraft={(d) => {
              setPDraft(d);
              setPErr("");
            }}
            busy={busy}
            submitLabel="Add player"
            onCancel={() => setAddingPlayer(false)}
            onSubmit={createPlayer}
          >
            <label style={styles.label}>
              Put in a group (optional)
              <select style={field} value={pGroup} onChange={(e) => setPGroup(e.target.value)}>
                <option value="">No group yet</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id} disabled={membersOf(g).length >= MAX_GROUP_SIZE}>
                    {g.group_name}
                    {membersOf(g).length >= MAX_GROUP_SIZE ? " (full)" : ""}
                  </option>
                ))}
              </select>
            </label>
            {pErr ? <div style={{ fontSize: 13, color: THEME.danger, fontWeight: 700 }}>{pErr}</div> : null}
          </PlayerFields>
        </div>
      ) : (
        <button style={{ ...styles.smallBtn, minHeight: 44 }} onClick={() => setAddingPlayer(true)}>
          + Add player
        </button>
      )}

      {players.length > 8 ? (
        <input
          style={field}
          placeholder="Search players"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Search players"
        />
      ) : null}
      <div style={{ display: "grid", gap: 8 }}>
        {shownPlayers.map((p) => (
          <RosterPlayerRow key={p.id} p={p} groupName={groupOfPlayer.get(p.id)?.group_name} players={players} ops={ops} busy={busy} />
        ))}
        {shownPlayers.length === 0 ? <div style={styles.helpText}>No players match.</div> : null}
      </div>
    </div>
  );
}

/**
 * Danger Zone → Delete players: pick some players, or delete everyone.
 * `onDelete(ids)` removes their scores and group spots too and returns a message.
 */
function DeletePlayersPanel({ players, groupNameByPlayer, onDelete }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(() => new Set());
  const [filter, setFilter] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const shown = players
    .filter((p) => !filter.trim() || p.name.toLowerCase().includes(filter.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const selected = players.filter((p) => picked.has(p.id));

  async function go(list, everyone) {
    if (busy || list.length === 0) return;
    if (everyone) {
      const typed = prompt(
        `This deletes ALL ${list.length} players and every score they have entered. This can't be undone.\n\nType DELETE ALL to confirm.`
      );
      if (typed == null) return;
      if (typed.trim().toUpperCase() !== "DELETE ALL") {
        setMsg("Not deleted: you didn't type DELETE ALL.");
        return;
      }
    } else if (
      !confirm(
        `Delete ${list.length} player${list.length === 1 ? "" : "s"} (${list
          .slice(0, 5)
          .map((p) => p.name)
          .join(", ")}${list.length > 5 ? ", …" : ""}) and all of their scores? This can't be undone.`
      )
    ) {
      return;
    }
    setBusy(true);
    setMsg("Deleting…");
    try {
      setMsg(await onDelete(list.map((p) => p.id)));
      setPicked(new Set());
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={styles.hr} />
      <div style={{ ...styles.sectionLabel, marginTop: 14 }}>Delete players</div>
      <div style={styles.helpText}>
        Removes the players you choose (or everyone) along with their scores and their spot in a group. Groups stay,
        just emptier.
      </div>
      <button style={{ ...styles.dangerBtn, marginTop: 10, minHeight: 44 }} onClick={() => setOpen((v) => !v)}>
        {open ? "Hide" : `Delete players… (${players.length})`}
      </button>

      {open ? (
        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          {players.length === 0 ? <div style={styles.helpText}>There are no players.</div> : null}
          {players.length > 8 ? (
            <input
              style={{ ...styles.input, fontSize: 16, minHeight: 46, boxSizing: "border-box" }}
              placeholder="Search players"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Search players"
            />
          ) : null}
          {players.length > 0 ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                style={{ ...styles.smallBtn, minHeight: 44 }}
                onClick={() => setPicked(new Set([...picked, ...shown.map((p) => p.id)]))}
              >
                Select {filter.trim() ? "shown" : "all"}
              </button>
              <button style={{ ...styles.smallBtn, minHeight: 44 }} onClick={() => setPicked(new Set())}>
                Clear selection
              </button>
            </div>
          ) : null}
          <div style={{ display: "grid", gap: 6, maxHeight: 360, overflowY: "auto" }}>
            {shown.map((p) => (
              <label
                key={p.id}
                style={{
                  ...styles.playerRow,
                  justifyContent: "flex-start",
                  minHeight: 44,
                  cursor: "pointer",
                  background: picked.has(p.id) ? "rgba(153,75,62,0.12)" : styles.playerRow.background,
                }}
              >
                <input
                  type="checkbox"
                  style={{ width: 22, height: 22, flex: "none" }}
                  checked={picked.has(p.id)}
                  onChange={(e) => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(p.id);
                    else next.delete(p.id);
                    setPicked(next);
                  }}
                />
                <span style={{ minWidth: 0 }}>
                  <span style={{ fontWeight: 800, overflowWrap: "anywhere" }}>{p.name}</span>
                  <span style={{ ...styles.playerMeta, display: "block" }}>
                    HCP {hcpLabel(p.handicap)} • {groupNameByPlayer.get(p.id) || "No group"}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {players.length > 0 ? (
            <div style={{ display: "grid", gap: 8 }}>
              <button
                style={{ ...styles.dangerBtn, minHeight: 48, opacity: selected.length === 0 || busy ? 0.5 : 1 }}
                disabled={selected.length === 0 || busy}
                onClick={() => go(selected, false)}
              >
                Delete selected ({selected.length})
              </button>
              <button
                style={{ ...styles.dangerBtn, minHeight: 48, opacity: busy ? 0.5 : 1 }}
                disabled={busy}
                onClick={() => go(players, true)}
              >
                Delete ALL players ({players.length})
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {msg ? <div style={styles.helpText}>{msg}</div> : null}
    </div>
  );
}

/**
 * A collapsible Admin sub-section — only one open at a time (accordion),
 * so the setup page shows one decision at a time instead of everything at
 * once. `subtitle` is a short at-a-glance status shown under the title
 * while collapsed (e.g. "24 players imported").
 */
function AdminSection({ title, subtitle, open, onToggle, danger, children }) {
  return (
    <div style={danger ? styles.subCardDanger : styles.subCard}>
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          width: "100%",
          gap: 10,
          background: "none",
          border: "none",
          padding: 0,
          margin: 0,
          font: "inherit",
          color: "inherit",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ ...styles.subTitle, marginBottom: subtitle && !open ? 2 : 10 }}>{title}</div>
          {subtitle && !open ? (
            <div style={{ fontSize: 12, color: THEME.textMuted }}>{subtitle}</div>
          ) : null}
        </div>
        <span style={{ fontSize: 20, opacity: 0.7, flexShrink: 0 }}>{open ? "−" : "+"}</span>
      </button>
      {open && <div style={{ marginTop: 4 }}>{children}</div>}
    </div>
  );
}

/**
 * Shown in the Tagline/Logo sections until the database has the two columns
 * they save into (migration 0010). Gives the admin the exact SQL to run.
 */
function BrandingSetupNotice() {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 800 }}>One-time setup needed</div>
      <div style={styles.helpText}>
        This needs two new settings in the database. In Supabase, open <b>SQL Editor</b>, paste the lines below and
        click <b>Run</b>, then come back here and tap <b>Reload Data</b>.
      </div>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          marginTop: 8,
          padding: 10,
          borderRadius: 12,
          border: `1px solid ${THEME.border}`,
          background: "rgba(22,35,29,0.05)",
          fontSize: 12,
          color: THEME.text,
        }}
      >
        {BRANDING_SQL}
      </pre>
      <button
        style={{ ...styles.smallBtn, marginTop: 8 }}
        onClick={() => {
          navigator.clipboard
            ?.writeText(BRANDING_SQL)
            .then(() => setCopied(true))
            .catch(() => {});
        }}
      >
        {copied ? "Copied ✅" : "Copy SQL"}
      </button>
    </div>
  );
}

/** Styles */
const styles = {
  page: {
    minHeight: "100vh",
    padding: 14,
    background: THEME.bg,
    color: THEME.text,
    fontFamily: FONT_BODY,
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
    fontWeight: 700,
    letterSpacing: -0.6,
    lineHeight: 1.05,
    color: THEME.chromeText,
    fontFamily: FONT_DISPLAY,
  },
  brandSub: { marginTop: 6, fontSize: 13, color: THEME.chromeTextMuted },

  // Top nav bar — sits directly on the dark page background, so it uses
  // the chrome* tokens rather than the paper-card text/border tokens.
  nav: { display: "flex", gap: 10, flexWrap: "wrap" },
  navBtn: {
    padding: "10px 12px",
    borderRadius: 999,
    background: "transparent",
    border: `1px solid ${THEME.chromeBorder}`,
    color: THEME.chromeText,
    cursor: "pointer",
    fontWeight: 600,
  },
  navBtnActive: {
    padding: "10px 12px",
    borderRadius: 999,
    background: PALETTE.whickerBasket,
    border: `1px solid ${PALETTE.whickerBasket}`,
    color: PALETTE.deepMeadow,
    cursor: "pointer",
    fontWeight: 700,
  },

  // In-card pill tabs (Leaderboard round/game switchers, Admin's game
  // preset picker) — these sit on a paper card, so unlike navBtn/
  // navBtnActive above they use the ink/border tokens, not chrome*.
  tabBtn: {
    padding: "10px 12px",
    borderRadius: 12,
    background: "transparent",
    border: `1px solid ${THEME.border}`,
    color: THEME.textMuted,
    cursor: "pointer",
    fontWeight: 700,
  },
  tabBtnActive: {
    padding: "10px 12px",
    borderRadius: 12,
    background: THEME.btnStrong,
    border: `1px solid ${PALETTE.whickerBasket}`,
    color: THEME.text,
    cursor: "pointer",
    fontWeight: 950,
  },

  homeCard: {
    // A menu card, not a page: on wide screens keep it phone-card sized and
    // centered instead of stretching its buttons across the whole shell.
    boxSizing: "border-box",
    width: "100%",
    maxWidth: 460,
    justifySelf: "center",
    background: THEME.surfaceSoft,
    border: `1px solid ${THEME.border}`,
    borderRadius: 22,
    padding: 18,
    boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
  },
  homeTitle: {
    marginTop: 10,
    fontSize: 38,
    fontWeight: 600,
    letterSpacing: -0.6,
    color: THEME.text,
    fontFamily: FONT_DISPLAY,
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
    background: "rgba(22,35,29,0.15)",
  },

  card: {
    background: THEME.surface,
    border: `1px solid ${THEME.border}`,
    borderRadius: 18,
    padding: 16,
    boxShadow: "0 20px 50px rgba(0,0,0,0.40)",
    // Grid items default to min-width:auto, which lets a wide child (e.g.
    // the Leaderboard table) stretch this card — and every ancestor up to
    // the page — past the viewport instead of scrolling inside tableWrap's
    // own overflow-x. This is what actually lets it shrink and scroll.
    minWidth: 0,
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
    fontWeight: 600,
    letterSpacing: -0.2,
    color: THEME.text,
    fontFamily: FONT_DISPLAY,
  },
  helpText: { marginTop: 10, fontSize: 12, lineHeight: 1.35, color: THEME.textMuted },

  bigBtn: {
    padding: "14px 14px",
    borderRadius: 16,
    background: THEME.btn,
    border: `1px solid ${THEME.btnBorder}`,
    color: THEME.text,
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 16,
    letterSpacing: 0.2,
  },
  smallBtn: {
    padding: "10px 12px",
    borderRadius: 12,
    background: "rgba(22,35,29,0.05)",
    border: `1px solid ${THEME.border}`,
    color: THEME.text,
    cursor: "pointer",
    fontWeight: 700,
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

  // minWidth:0 — same grid-item overflow trap as `card`/`subCard`: this is
  // a grid item wherever it's used (a labeled field inside another grid),
  // so without it a wide child (e.g. a <select> with a long option) can
  // stretch the whole chain of ancestors instead of just wrapping/shrinking.
  label: { display: "grid", gap: 6, fontSize: 12, color: THEME.textMuted, minWidth: 0 },

  input: {
    background: "rgba(22,35,29,0.05)",
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
    background: "rgba(22,35,29,0.03)",
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
    textDecorationColor: "rgba(159,119,80,0.55)",
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
strokeDot: {
  display: "inline-block",
  width: 8,
  height: 8,
  borderRadius: "50%",
  background: "rgba(203,189,151,0.85)",
},
// A plus-handicap player gives a stroke back on this hole, instead of
// receiving one — marked with "+" rather than the filled dot above.
giveBackMark: {
  display: "inline-block",
  fontSize: 11,
  fontWeight: 950,
  lineHeight: 1,
  color: THEME.textMuted,
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
    background: "rgba(22,35,29,0.035)",
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
    minWidth: 0, // see the matching note on `card` — same grid-item overflow trap
  },
  subCardDanger: {
    background: "rgba(153,75,62,0.08)",
    border: "1px solid rgba(153,75,62,0.40)",
    borderRadius: 14,
    padding: 14,
    minWidth: 0,
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
  hr: { height: 1, background: "rgba(22,35,29,0.12)", margin: "8px 0" },

  playerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    padding: "10px 10px",
    borderRadius: 12,
    background: "rgba(22,35,29,0.035)",
    border: `1px solid ${THEME.border}`,
  },

  foursomeCard: {
    padding: 12,
    borderRadius: 14,
    border: `1px solid ${THEME.border}`,
    background: "rgba(22,35,29,0.035)",
  },

  scoreRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: "10px 10px",
    borderRadius: 14,
    border: `1px solid ${THEME.border}`,
    background: "rgba(22,35,29,0.035)",
  },
  navRow: {
    marginTop: 10,
    display: "grid",
    gap: 10,
    gridTemplateColumns: "1fr 1fr",
  },
};
