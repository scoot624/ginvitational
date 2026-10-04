// The trophy (1st) and LEX headcover (last) icons, and the # column cell that uses them.

import { isLastRow, isLeaderRow } from "../lib/ranking";

/**
 * Trophy badge shown in the # column in place of the rank number for
 * whoever is in sole or tied first place. The PNG is pre-cropped to just
 * the crystal (no nameplate base) and pre-shrunk to ~4x its display size —
 * letting the browser squash the original 1672px photo down to a ~26px
 * icon is what made it look blurry.
 */
export function LeaderIcon({ height = "20px" }) {
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
export function LastPlaceIcon({ height = "20px" }) {
  return (
    <img
      src="/lex-headcover.png"
      alt="Last"
      title="The LEX"
      style={{ display: "block", height, width: `calc(${height} * 1.9)` }}
    />
  );
}

/** What the # column shows: trophy for 1st, LEX for last, otherwise the number. */
// eslint-disable-next-line react-refresh/only-export-components -- a helper that returns an element, kept beside the icons it uses
export function rankCellContent(r, idx, lastRank, iconHeight) {
  if (isLeaderRow(r)) return <LeaderIcon height={iconHeight} />;
  if (isLastRow(r, lastRank)) return <LastPlaceIcon height={iconHeight} />;
  return r.displayRank ?? idx + 1;
}
