// Handicap-stroke markers: a filled dot for each stroke received on a hole, or a "+" where a plus handicap gives one back.

import { STROKE_COLOR } from "../theme";

/** The dots (up to three) or the "+" for one hole. Nothing when there is no stroke. */
export function StrokeDots({ n, size = 6 }) {
  if (!n) return null;
  if (n < 0) {
    return (
      <span title="Gives a stroke back" style={{ fontSize: size + 5, fontWeight: 950, lineHeight: 1, color: STROKE_COLOR }}>
        +
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={n === 1 ? "Gets a stroke" : `Gets ${n} strokes`}
      title={n === 1 ? "Gets a stroke" : `Gets ${n} strokes`}
      style={{ display: "inline-flex", gap: 1, alignItems: "center" }}
    >
      {Array.from({ length: Math.min(n, 3) }, (_, i) => (
        <span key={i} style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", background: STROKE_COLOR }} />
      ))}
    </span>
  );
}

/** A scorecard cell's value with its strokes marked in the corner (or the marker on its own while the hole is still blank). */
export function WithStrokes({ n, children }) {
  const blank = children === "" || children == null;
  if (!n) return <>{blank ? "" : children}</>;
  if (blank) return <StrokeDots n={n} size={6} />;
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      {children}
      <span style={{ position: "absolute", top: -4, right: -9, lineHeight: 0 }}>
        <StrokeDots n={n} size={5} />
      </span>
    </span>
  );
}

