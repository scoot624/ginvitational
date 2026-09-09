-- ============================================================
-- Ginvitational: Multi-Game Architecture — Stage 1 schema
-- ============================================================
-- Safe to run: only CREATEs new tables. Does not touch
-- players, scores, foursomes, or foursome_players.
-- ============================================================

-- One row per game running on the event.
-- Every event always has >=1 row here (Simple Mode = exactly 1).
create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  format text not null check (
    format in ('individual_net', 'individual_gross', 'better_ball_2', 'better_ball_4')
  ),
  handicap_pct integer not null default 100 check (handicap_pct between 0 and 150),

  -- e.g. {"scoresCounted": 2, "slots": ["gross","net"]}
  counting_rule jsonb not null default '{"scoresCounted":1,"slots":["net"]}'::jsonb,
  constraint games_counting_rule_shape check (
    jsonb_typeof(counting_rule -> 'slots') = 'array'
    and jsonb_array_length(counting_rule -> 'slots') = (counting_rule ->> 'scoresCounted')::int
    and (counting_rule ->> 'scoresCounted')::int between 1 and 4
  ),

  is_default boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Only one game can ever be marked as the permanent default.
create unique index if not exists games_one_default_idx
  on games (is_default) where is_default = true;

-- A team within one specific game (2-man / 4-man formats only).
create table if not exists game_teams (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

-- Which players are on which team, for which game.
create table if not exists game_team_members (
  game_id uuid not null references games(id) on delete cascade,
  team_id uuid not null references game_teams(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, player_id),
  -- a player can only be on one team within a given game
  unique (game_id, player_id)
);

-- Single-row settings table. Holds the Admin "multi-game enabled" toggle.
create table if not exists app_settings (
  id integer primary key default 1,
  multi_game_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint app_settings_singleton check (id = 1)
);

insert into app_settings (id, multi_game_enabled)
values (1, false)
on conflict (id) do nothing;

-- Seed the always-present default game so existing events keep
-- working exactly as they do today (Individual Net, 100% handicap).
insert into games (name, format, handicap_pct, counting_rule, is_default, active, sort_order)
select 'Individual Net', 'individual_net', 100,
       '{"scoresCounted":1,"slots":["net"]}'::jsonb, true, true, 0
where not exists (select 1 from games where is_default = true);

-- ------------------------------------------------------------
-- RLS: matches the existing app's model (fully open to the
-- anon key; access is gated client-side by the Admin PIN, same
-- as players/foursomes/scores today). Not introducing a new
-- security model here, just replicating the current one.
-- ------------------------------------------------------------
alter table games enable row level security;
alter table game_teams enable row level security;
alter table game_team_members enable row level security;
alter table app_settings enable row level security;

create policy games_select on games for select to anon using (true);
create policy games_insert on games for insert to anon with check (true);
create policy games_update on games for update to anon using (true) with check (true);
create policy games_delete on games for delete to anon using (true);

create policy game_teams_select on game_teams for select to anon using (true);
create policy game_teams_insert on game_teams for insert to anon with check (true);
create policy game_teams_update on game_teams for update to anon using (true) with check (true);
create policy game_teams_delete on game_teams for delete to anon using (true);

create policy game_team_members_select on game_team_members for select to anon using (true);
create policy game_team_members_insert on game_team_members for insert to anon with check (true);
create policy game_team_members_update on game_team_members for update to anon using (true) with check (true);
create policy game_team_members_delete on game_team_members for delete to anon using (true);

create policy app_settings_select on app_settings for select to anon using (true);
create policy app_settings_update on app_settings for update to anon using (true) with check (true);
