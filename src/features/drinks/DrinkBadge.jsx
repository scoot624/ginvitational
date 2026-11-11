// A player's drink count for a leaderboard row. Renders nothing when Drinking Mode is off.
//   Minimum Drinks: "🍺 2 of 4", "🍺 5 ✓", with a quiet "behind pace" flag mid-round and a final "⚑ short" at 18 holes.
//   Stroke Credit:  "🍺 2 of 3" (the drinks that count toward the credit).

import { useEventDataContext } from "../../hooks/eventDataContext";
import { drinkProgress, drinksInRound } from "../../lib/drinks";
import { THEME } from "../../theme";

export function DrinkBadge({ playerId, roundId, holesPlayed }) {
  const { drinking, drinksView } = useEventDataContext();
  if (!drinking.enabled || !roundId) return null;

  const count = drinksInRound(drinksView, playerId, roundId);

  if (drinking.variant === "credit") {
    return <div style={{ marginTop: 2, fontSize: 12, color: THEME.textMuted }}>🍺 {Math.min(count, drinking.maxDrinks)} of {drinking.maxDrinks}</div>;
  }

  const { status, target } = drinkProgress(count, holesPlayed, drinking);
  return (
    <div style={{ marginTop: 2, fontSize: 12, color: THEME.textMuted }}>
      🍺 {status === "met" ? `${count} ✓` : `${count} of ${target}`}
      {status === "behind" ? <span style={{ marginLeft: 6, color: THEME.bad, fontWeight: 700 }}>behind pace</span> : null}
      {status === "short" ? <span style={{ marginLeft: 6, color: THEME.bad, fontWeight: 700 }}>⚑ short</span> : null}
    </div>
  );
}
