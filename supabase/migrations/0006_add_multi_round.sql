-- ============================================================
-- Ginvitational: Multi-Round / Multi-Day support
-- ============================================================
-- Adds a `rounds` table and attaches every existing score and
-- foursome to a single auto-created "Round 1", so nothing currently
-- live changes. Opt-in via app_settings.multi_round_enabled.
-- ============================================================

-- One row per round/day. Exactly one is "active" at a time — that's
-- the round Enter Scores' code lookups and new tee-sheet imports
-- default to, and the round the Broadcast feed / scorecard popup track.
create table if not exists rounds (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  sort_order integer not null default 0,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index if not exists rounds_one_active_idx
  on rounds (is_active) where is_active = true;

-- Seed the always-present default round.
insert into rounds (label, sort_order, is_active)
select 'Round 1', 0, true
where not exists (select 1 from rounds);

-- ------------------------------------------------------------
-- scores: attach every existing row to the seeded round, then
-- require round_id on all rows going forward, then widen the
-- uniqueness rule from (player_id, hole) to (player_id, hole, round_id)
-- so the same hole can be scored once per round instead of once ever.
-- ------------------------------------------------------------
alter table scores add column if not exists round_id uuid references rounds(id);

update scores set round_id = (select id from rounds order by sort_order asc limit 1)
where round_id is null;

alter table scores alter column round_id set not null;

drop index if exists scores_player_hole_unique;
create unique index if not exists scores_player_hole_round_unique
  on scores (player_id, hole, round_id);

-- ------------------------------------------------------------
-- foursomes: same attach-then-require pattern. Each round gets its
-- own foursomes/tee times/codes (pairings can differ per round).
-- ------------------------------------------------------------
alter table foursomes add column if not exists round_id uuid references rounds(id);

update foursomes set round_id = (select id from rounds order by sort_order asc limit 1)
where round_id is null;

alter table foursomes alter column round_id set not null;

-- ------------------------------------------------------------
-- app_settings: the Admin on/off toggle.
-- ------------------------------------------------------------
alter table app_settings add column if not exists multi_round_enabled boolean not null default false;

-- ------------------------------------------------------------
-- RLS: same open model as every other table here.
-- ------------------------------------------------------------
alter table rounds enable row level security;
create policy rounds_select on rounds for select to anon using (true);
create policy rounds_insert on rounds for insert to anon with check (true);
create policy rounds_update on rounds for update to anon using (true) with check (true);
create policy rounds_delete on rounds for delete to anon using (true);
