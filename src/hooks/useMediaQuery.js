// Live CSS media-query match for responsive layouts.

import { useEffect, useState } from "react";

/**
 * Live CSS media-query match. Inline styles can't carry @media rules, and a
 * one-time check at load goes stale the moment a tablet rotates or a
 * desktop window is resized, so this re-renders when the match changes.
 */
export function useMediaQuery(query) {
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
