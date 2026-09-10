-- ============================================================
-- Ginvitational: standalone 2-Man / 4-Man Scramble game formats
-- ============================================================
-- Adds two new allowed formats ('scramble_2', 'scramble_4') and one
-- new nullable column (handicap_allowance) to the existing games
-- table. Purely additive — no existing rows or other tables touched.
--
-- handicap_allowance holds a plain array of percentages, ranked from
-- the team's lowest handicap to its highest, e.g.:
--   scramble_2: [35, 15]           -- low-handicap partner, high-handicap partner
--   scramble_4: [40, 30, 20, 10]   -- lowest through highest of the four
-- The team's blended handicap = sum(each ranked player's handicap *
-- their percentage). This generalizes the low/high two-role model a
-- composite game's "shared" Scramble segment already uses (see
-- 0005_add_composite_game_format.sql) to a full per-rank breakdown,
-- which a 4-man team needs.
-- ============================================================

alter table games drop constraint if exists games_format_check;
alter table games add constraint games_format_check check (
  format in (
    'individual_net', 'individual_gross', 'better_ball_2', 'better_ball_4',
    'composite', 'scramble_2', 'scramble_4'
  )
);

alter table games add column if not exists handicap_allowance jsonb;

alter table games add constraint games_handicap_allowance_shape check (
  handicap_allowance is null
  or (
    jsonb_typeof(handicap_allowance) = 'array'
    and (
      (format = 'scramble_2' and jsonb_array_length(handicap_allowance) = 2)
      or (format = 'scramble_4' and jsonb_array_length(handicap_allowance) = 4)
      or (format not in ('scramble_2', 'scramble_4'))
    )
  )
);
