// The course: pars, stroke index, and net-score math for it. Change PARS / STROKE_INDEX here for a different course.

import { strokesForHandicap } from "./golf.js";

/** ⛳ PARS (Blue tees, Par 72; hole 18 is par 5) */
export const PARS = [
  4, 4, 4, 3, 4, 3, 5, 3, 5,
  4, 3, 5, 3, 4, 5, 4, 4, 5,
];

/** 🧮 Stroke Index — Manufacturers GC (Blue Tees, Men’s) (1 = hardest)
 * If these ever change, just update this array.
 */
export const STROKE_INDEX = [
  12, 10, 4, 14, 2, 8, 6, 18, 16,
  9, 3, 17, 13, 5, 15, 1, 11, 7,
];

/**
 * Real handicap allocation by stroke index.
 * A positive handicap RECEIVES strokes, starting at the #1 handicap hole
 * (hardest) and working up. A plus handicap (negative) GIVES strokes back
 * instead, using that same hole order, so the result goes negative on
 * those holes — `net = gross - strokesOnHole(...)` keeps working either way.
 */
export function strokesOnHole(courseHcp, holeNum) {
  return strokesForHandicap(courseHcp, holeNum, STROKE_INDEX);
}

/** `credit` is Drinking Mode's Stroke Credit on that hole (0 when the mode is off): it lowers net, never gross. */
export function netScoreForHole(grossScore, courseHcp, holeNum, credit = 0) {
  return grossScore - strokesOnHole(courseHcp, holeNum) - credit;
}
