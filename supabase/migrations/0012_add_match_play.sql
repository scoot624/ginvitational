-- ============================================================
-- Ginvitational: Match Play + Ryder Cup formats
-- ============================================================
-- Adds two new game formats ('match_play', 'ryder_cup'), a config column
-- for their settings, and the tables that hold the matches.
-- Does not touch players, scores, groups, or existing games.
-- Safe to run more than once.
-- ============================================================

alter table games drop constraint if exists games_format_check;
alter table games add constraint games_format_check check (
  format in (
    'individual_net', 'individual_gross', 'better_ball_2', 'better_ball_4',
    'composite', 'scramble_2', 'scramble_4',
    'match_play', 'ryder_cup'
  )
);

-- e.g. {"handicapMode":"off_lowest","sideA":{"name":"USA"},"sideB":{"name":"Europe"},"pointsWin":1,"pointsHalf":0.5}
alter table games add column if not exists config jsonb;

-- One row per match. A round is a "session".
create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  round_id uuid not null references rounds(id) on delete cascade,
  match_type text not null check (match_type in ('singles', 'fourball', 'foursomes')),
  label text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Who plays in each match, and on which side.
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

-- Open policies, same model as the rest of the app (the Admin PIN is the gate).
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
create policy match_players_delete on match_players for delete to anon using (true);
