// Shares the app's loaded data (see useEventData) with every screen and Admin section,
// so they can read players, scores, games and the loaders without passing everything down by hand.
import { createContext, useContext } from "react";

export const EventDataContext = createContext(null);

export function useEventDataContext() {
  const data = useContext(EventDataContext);
  if (!data) throw new Error("useEventDataContext must be used inside <EventDataContext.Provider>");
  return data;
}
