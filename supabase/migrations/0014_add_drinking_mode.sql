-- ============================================================
-- Ginvitational: Drinking Mode
-- ============================================================
-- An optional mode Admin can turn on for an event:
--   * Minimum Drinks — each player should reach a minimum by the end of the round (a flag, no score effect)
--   * Stroke Credit  — each logged drink removes strokes from that hole's net score, up to a maximum
-- Adds one setting column and one table. With the mode off (the default) the app behaves exactly as before.
-- Does not touch players, scores, groups, games or matches. Safe to run more than once.
-- ============================================================

-- {"enabled":true,"variant":"min"|"credit","minDrinks":4,"creditPerDrink":1,"maxDrinks":3}
alter table app_settings add column if not exists drinking jsonb;

-- One row per drink logged. The phone may supply the id, so a retry after a dropped signal can't log it twice.
create table if not exists drinks (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  round_id uuid not null references rounds(id) on delete cascade,
  hole integer not null check (hole between 1 and 18),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists drinks_round_player_hole_idx on drinks (round_id, player_id, hole);

-- Open policies, same model as the rest of the app (the Admin PIN is the gate).
alter table drinks enable row level security;

drop policy if exists drinks_select on drinks;
drop policy if exists drinks_insert on drinks;
drop policy if exists drinks_update on drinks;
drop policy if exists drinks_delete on drinks;
create policy drinks_select on drinks for select to anon using (true);
create policy drinks_insert on drinks for insert to anon with check (true);
create policy drinks_update on drinks for update to anon using (true) with check (true);
create policy drinks_delete on drinks for delete to anon using (true);
