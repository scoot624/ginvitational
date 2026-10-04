// Style bits for a Leaderboard row that expands to show a scorecard.

import { THEME } from "../../theme";

/** Chevron shown next to an expandable player name, rotated open/closed. */
export function expandChevronStyle(open) {
  return {
    display: "inline-block",
    fontSize: 10,
    opacity: 0.7,
    transition: "transform 0.15s ease",
    transform: open ? "rotate(90deg)" : "rotate(0deg)",
  };
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
export const expandRowCellStyle = {
  width: "1px",
  padding: 0,
  background: "rgba(22,35,29,0.035)",
  borderTop: `1px solid ${THEME.border}`,
  borderBottom: `1px solid ${THEME.border}`,
};
