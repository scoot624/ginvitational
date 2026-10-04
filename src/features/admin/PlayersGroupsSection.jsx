import { AdminSection } from "../../components/AdminSection";
import { RosterEditor } from "../roster/RosterEditor";
import { useEventDataContext } from "../../hooks/eventDataContext";

// Admin → Players & Groups: the editor for players and groups, after the tournament is set up.

export function PlayersGroupsSection({ openAdminSection, setOpenAdminSection }) {
  const {
    players,
    appSettings,
    rounds,
    foursomes,
    foursomePlayers,
    initialLoad,
    activeRound,
  } = useEventDataContext();

  return (
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
  );
}
