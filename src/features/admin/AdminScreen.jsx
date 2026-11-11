import { DangerZoneSection } from "./DangerZoneSection";
import { EventNameSection } from "./EventNameSection";
import { GamesSection } from "./GamesSection";
import { DrinkingModeSection } from "./DrinkingModeSection";
import { HandicapBasisSection } from "./HandicapBasisSection";
import { ImportSection } from "./ImportSection";
import { LogoSection } from "./LogoSection";
import { PlayersGroupsSection } from "./PlayersGroupsSection";
import { RoundsSection } from "./RoundsSection";
import { StartTournamentSection } from "./StartTournamentSection";
import { TaglineSection } from "./TaglineSection";
import { runTeeSheetImport } from "../import/runTeeSheetImport";
import { PhoneSetup } from "../phone/PhoneSetup";
import { useEventDataContext } from "../../hooks/eventDataContext";
import { supabase } from "../../lib/supabase";
import { errToText } from "../../lib/util";
import { THEME, styles } from "../../theme";

// The Admin screen: the passcode gate, the top buttons, and the sections.

export function AdminScreen({ adminOn, adminPin, setAdminPin, enterAdmin, setAdminOn, setTab, printGame, setPrintGameId, logoSrc, setPrintAllOn, phoneSetupOn, eventName, setPhoneSetupOn, isWide, openAdminSection, setOpenAdminSection, tagline, customLogo, setMultiRoundEnabled, setRoundActive, newRoundLabel, setNewRoundLabel, createRound, roundsMsg, deleteGame, deleteRound }) {
  const {
    lastLoadErrors,
    lastLoadAt,
    games,
    appSettings,
    rounds,
    foursomes,
    loadPlayers,
    loadFoursomes,
    loadFoursomePlayers,
    loadAppSettings,
    initialLoad,
    activeRound,
  } = useEventDataContext();

  return (
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
              const { error } = await supabase
                .from("app_settings")
                .update({ event_name: name, updated_at: new Date().toISOString() })
                .eq("id", 1);
              if (error) {
                console.error(error);
                return errToText(error);
              }
              await loadAppSettings();
              return null;
            }}
            rounds={rounds}
            multiRound={!!appSettings.multi_round_enabled}
            activeRound={activeRound}
            foursomes={foursomes}
            onStart={(rows, opts) => runTeeSheetImport({ foursomes, initialLoad }, rows, opts)}
            onExit={() => setPhoneSetupOn(false)}
            onGoto={(t) => {
              setPhoneSetupOn(false);
              setTab(t);
            }}
          />
        ) : (
        <div style={{ ...styles.adminGrid, gridTemplateColumns: isWide ? "1fr 1fr" : "1fr" }}>
          {/* Start a Tournament — two ways in, same result */}
          <StartTournamentSection openAdminSection={openAdminSection} setOpenAdminSection={setOpenAdminSection} setPhoneSetupOn={setPhoneSetupOn} />

          {/* Event Name */}
          <EventNameSection adminOn={adminOn} eventName={eventName} openAdminSection={openAdminSection} setOpenAdminSection={setOpenAdminSection} />

          {/* Tagline */}
          <TaglineSection adminOn={adminOn} tagline={tagline} openAdminSection={openAdminSection} setOpenAdminSection={setOpenAdminSection} />

          {/* Main logo */}
          <LogoSection adminOn={adminOn} customLogo={customLogo} openAdminSection={openAdminSection} setOpenAdminSection={setOpenAdminSection} logoSrc={logoSrc} />

          {/* Handicap Basis */}
          <HandicapBasisSection adminOn={adminOn} openAdminSection={openAdminSection} setOpenAdminSection={setOpenAdminSection} />

          {/* Drinking Mode */}
          <DrinkingModeSection adminOn={adminOn} openAdminSection={openAdminSection} setOpenAdminSection={setOpenAdminSection} />

          {/* Import Tee Sheet */}
          <ImportSection adminOn={adminOn} openAdminSection={openAdminSection} setOpenAdminSection={setOpenAdminSection} />

          {/* Players & Groups — edit after the tournament is set up */}
          <PlayersGroupsSection openAdminSection={openAdminSection} setOpenAdminSection={setOpenAdminSection} />

          {/* Multi-Game setup */}
          <GamesSection adminOn={adminOn} openAdminSection={openAdminSection} setOpenAdminSection={setOpenAdminSection} />

          {/* Multi-Round setup */}
          <RoundsSection openAdminSection={openAdminSection} setOpenAdminSection={setOpenAdminSection} setMultiRoundEnabled={setMultiRoundEnabled} setRoundActive={setRoundActive} newRoundLabel={newRoundLabel} setNewRoundLabel={setNewRoundLabel} createRound={createRound} roundsMsg={roundsMsg} />

          {/* Danger Zone — every irreversible action lives here, away from routine buttons */}
          <DangerZoneSection adminOn={adminOn} openAdminSection={openAdminSection} setOpenAdminSection={setOpenAdminSection} deleteGame={deleteGame} deleteRound={deleteRound} />

        </div>
        )}
      </>
    )}
  </div>
  );
}
