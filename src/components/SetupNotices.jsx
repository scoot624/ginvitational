// The one-time 'paste this into Supabase' notices shown until a database change has been run.

import { useState } from "react";
import { BRANDING_SQL } from "../lib/branding";
import { THEME, styles } from "../theme";

/**
 * Shown in the Tagline/Logo sections until the database has the two columns
 * they save into (migration 0010). Gives the admin the exact SQL to run.
 */
export function BrandingSetupNotice() {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 800 }}>One-time setup needed</div>
      <div style={styles.helpText}>
        This needs two new settings in the database. In Supabase, open <b>SQL Editor</b>, paste the lines below and
        click <b>Run</b>, then come back here and tap <b>Reload Data</b>.
      </div>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          marginTop: 8,
          padding: 10,
          borderRadius: 12,
          border: `1px solid ${THEME.border}`,
          background: "rgba(22,35,29,0.05)",
          fontSize: 12,
          color: THEME.text,
        }}
      >
        {BRANDING_SQL}
      </pre>
      <button
        style={{ ...styles.smallBtn, marginTop: 8 }}
        onClick={() => {
          navigator.clipboard
            ?.writeText(BRANDING_SQL)
            .then(() => setCopied(true))
            .catch(() => {});
        }}
      >
        {copied ? "Copied ✅" : "Copy SQL"}
      </button>
    </div>
  );
}

/** Shown in the Danger Zone until the database allows deleting Broadcast messages (migration 0011). */
export function ClearMessagesSetupNotice() {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 800 }}>One-time setup needed</div>
      <div style={styles.helpText}>
        The database doesn't allow deleting Broadcast messages yet. In Supabase, open <b>SQL Editor</b>, paste the
        lines below and click <b>Run</b>, then come back here and tap <b>Clear all messages</b> again.
      </div>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          marginTop: 8,
          padding: 10,
          borderRadius: 12,
          border: `1px solid ${THEME.border}`,
          background: "rgba(22,35,29,0.05)",
          fontSize: 12,
          color: THEME.text,
        }}
      >
        {CLEAR_MESSAGES_SQL}
      </pre>
      <button
        style={{ ...styles.smallBtn, marginTop: 8, minHeight: 44 }}
        onClick={() => {
          Promise.resolve(navigator.clipboard?.writeText(CLEAR_MESSAGES_SQL)).then(
            () => setCopied(true),
            () => setCopied(false)
          );
        }}
      >
        {copied ? "Copied ✅" : "Copy SQL"}
      </button>
    </div>
  );
}

const CLEAR_MESSAGES_SQL = `drop policy if exists "allow delete broadcast_messages" on broadcast_messages;
create policy "allow delete broadcast_messages"
  on broadcast_messages for delete
  using (true);`;

export function MatchSetupNotice() {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 800 }}>One-time setup needed</div>
      <div style={styles.helpText}>
        Match Play and Ryder Cup need a few new tables in the database. In Supabase, open <b>SQL Editor</b>, paste
        the text below and click <b>Run</b>, then come back here and tap <b>Reload Data</b>.
      </div>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          marginTop: 8,
          padding: 10,
          borderRadius: 12,
          border: `1px solid ${THEME.border}`,
          background: "rgba(22,35,29,0.05)",
          fontSize: 12,
          color: THEME.text,
          maxHeight: 220,
          overflowY: "auto",
        }}
      >
        {MATCH_PLAY_SQL}
      </pre>
      <button
        style={{ ...styles.smallBtn, marginTop: 8, minHeight: 44 }}
        onClick={() => {
          Promise.resolve(navigator.clipboard?.writeText(MATCH_PLAY_SQL)).then(
            () => setCopied(true),
            () => setCopied(false)
          );
        }}
      >
        {copied ? "Copied ✅" : "Copy SQL"}
      </button>
    </div>
  );
}

/** One-time database setup for Match Play / Ryder Cup (same as migrations/0012). */
const MATCH_PLAY_SQL = `alter table games drop constraint if exists games_format_check;
alter table games add constraint games_format_check check (
  format in (
    'individual_net', 'individual_gross', 'better_ball_2', 'better_ball_4',
    'composite', 'scramble_2', 'scramble_4',
    'match_play', 'ryder_cup'
  )
);
alter table games add column if not exists config jsonb;

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  round_id uuid not null references rounds(id) on delete cascade,
  match_type text not null check (match_type in ('singles', 'fourball', 'foursomes')),
  label text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists match_players (
  match_id uuid not null references matches(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  side text not null check (side in ('a', 'b')),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (match_id, player_id)
);

create index if not exists matches_game_idx on matches (game_id);
create index if not exists match_players_player_idx on match_players (player_id);

alter table matches enable row level security;
alter table match_players enable row level security;

drop policy if exists matches_select on matches;
drop policy if exists matches_insert on matches;
drop policy if exists matches_update on matches;
drop policy if exists matches_delete on matches;
create policy matches_select on matches for select to anon using (true);
create policy matches_insert on matches for insert to anon with check (true);
create policy matches_update on matches for update to anon using (true) with check (true);
create policy matches_delete on matches for delete to anon using (true);

drop policy if exists match_players_select on match_players;
drop policy if exists match_players_insert on match_players;
drop policy if exists match_players_update on match_players;
drop policy if exists match_players_delete on match_players;
create policy match_players_select on match_players for select to anon using (true);
create policy match_players_insert on match_players for insert to anon with check (true);
create policy match_players_update on match_players for update to anon using (true) with check (true);
create policy match_players_delete on match_players for delete to anon using (true);`;

/** Shown in Admin → Drinking Mode until the database has its setting and table (migration 0014). */
export function DrinkingSetupNotice() {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 800 }}>One-time setup needed</div>
      <div style={styles.helpText}>
        Drinking Mode needs one new setting and one new table in the database. In Supabase, open <b>SQL Editor</b>,
        paste the text below and click <b>Run</b>, then come back here and tap <b>Reload Data</b>.
      </div>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          marginTop: 8,
          padding: 10,
          borderRadius: 12,
          border: `1px solid ${THEME.border}`,
          background: "rgba(22,35,29,0.05)",
          fontSize: 12,
          color: THEME.text,
          maxHeight: 220,
          overflowY: "auto",
        }}
      >
        {DRINKING_SQL}
      </pre>
      <button
        style={{ ...styles.smallBtn, marginTop: 8, minHeight: 44 }}
        onClick={() => {
          Promise.resolve(navigator.clipboard?.writeText(DRINKING_SQL)).then(
            () => setCopied(true),
            () => setCopied(false)
          );
        }}
      >
        {copied ? "Copied ✅" : "Copy SQL"}
      </button>
    </div>
  );
}

/** One-time database setup for Drinking Mode (same as migrations/0014). */
const DRINKING_SQL = `alter table app_settings add column if not exists drinking jsonb;

create table if not exists drinks (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  round_id uuid not null references rounds(id) on delete cascade,
  hole integer not null check (hole between 1 and 18),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists drinks_round_player_hole_idx on drinks (round_id, player_id, hole);

alter table drinks enable row level security;

drop policy if exists drinks_select on drinks;
drop policy if exists drinks_insert on drinks;
drop policy if exists drinks_update on drinks;
drop policy if exists drinks_delete on drinks;
create policy drinks_select on drinks for select to anon using (true);
create policy drinks_insert on drinks for insert to anon with check (true);
create policy drinks_update on drinks for update to anon using (true) with check (true);
create policy drinks_delete on drinks for delete to anon using (true);`;
