// App look and feel: colors, fonts and the shared inline styles used across every screen.

/** --- Brand palette --- */
export const PALETTE = {
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
export const THEME = {
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

export const FONT_DISPLAY = "'Fraunces', ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif";

export const FONT_BODY = "'Public Sans', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

export function netColorStyle(netToPar) {
  if (netToPar < 0) return { color: THEME.good };
  if (netToPar > 0) return { color: THEME.bad };
  return { color: THEME.textMuted };
}

/** Styles */
export const styles = {
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
