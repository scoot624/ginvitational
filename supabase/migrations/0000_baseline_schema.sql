-- ============================================================
-- Ginvitational: BASELINE schema (the tables that existed before 0001)
-- ============================================================
-- FOR A BRAND-NEW DATABASE ONLY. Do NOT run this on the live database —
-- those tables already exist there.
--
-- This file was reconstructed from how the live database behaves (column
-- values, and which inserts it accepts or rejects), not from a dump, so a
-- couple of details are best guesses and are marked "assumed". If you ever
-- rebuild from scratch: run this first, then 0001, 0002, ... in order.
-- Every table below uses "if not exists", so re-running is harmless.
-- ============================================================

create extension if not exists pgcrypto; -- gen_random_uuid()

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  handicap integer,                -- plus handicaps are stored as negative numbers
  charity text,
  created_at timestamptz not null default now()
  -- team_label is added by 0002
);

create table if not exists foursomes (
  id uuid primary key default gen_random_uuid(),
  group_name text not null,
  code text not null,
  tee_time time,
  starting_hole integer not null default 1,
  created_at timestamptz not null default now(),
  constraint foursomes_code_unique unique (code),
  constraint starting_hole_range check (starting_hole between 1 and 18)
  -- round_id is added by 0006
);

create table if not exists foursome_players (
  foursome_id uuid not null references foursomes(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  seat integer,                    -- assumed: an optional position within the group
  created_at timestamptz not null default now(),
  constraint foursome_players_pkey primary key (foursome_id, player_id)
);

create table if not exists scores (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  hole integer not null,
  score integer not null,
  created_at timestamptz not null default now(),
  constraint scores_hole_range check (hole between 1 and 18),
  constraint scores_score_range check (score between 1 and 20)  -- assumed 1-20 (the app only accepts 1-20)
  -- round_id is added by 0006, which also replaces this unique index with (player, hole, round)
);
create unique index if not exists scores_player_hole_unique on scores (player_id, hole);

create table if not exists broadcast_messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  kind text not null,
  text text not null,
  player_id uuid references players(id) on delete set null,
  dedupe_key text not null,
  constraint broadcast_messages_dedupe_key_key unique (dedupe_key)
  -- deleting messages is allowed by 0011
);

-- ------------------------------------------------------------
-- Open policies for the anon key — the app's access model (the Admin PIN
-- is the only gate). Policy names are assumed.
-- ------------------------------------------------------------
alter table players enable row level security;
alter table foursomes enable row level security;
alter table foursome_players enable row level security;
alter table scores enable row level security;
alter table broadcast_messages enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['players', 'foursomes', 'foursome_players', 'scores'] loop
    execute format('drop policy if exists %I on %I', t || '_select', t);
    execute format('drop policy if exists %I on %I', t || '_insert', t);
    execute format('drop policy if exists %I on %I', t || '_update', t);
    execute format('drop policy if exists %I on %I', t || '_delete', t);
    execute format('create policy %I on %I for select to anon using (true)', t || '_select', t);
    execute format('create policy %I on %I for insert to anon with check (true)', t || '_insert', t);
    execute format('create policy %I on %I for update to anon using (true) with check (true)', t || '_update', t);
    execute format('create policy %I on %I for delete to anon using (true)', t || '_delete', t);
  end loop;
end $$;

drop policy if exists broadcast_messages_select on broadcast_messages;
drop policy if exists broadcast_messages_insert on broadcast_messages;
create policy broadcast_messages_select on broadcast_messages for select to anon using (true);
create policy broadcast_messages_insert on broadcast_messages for insert to anon with check (true);
