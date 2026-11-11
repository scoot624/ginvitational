-- ============================================================
-- Ginvitational: 2-Man Alternate Shot game format
-- ============================================================
-- Allows a new game format ('alt_shot_2'). It is scored and handicapped exactly like the
-- 2-Man Scramble: one shared score per hole and a blended team handicap (handicap_allowance,
-- e.g. [35, 15] = lowest-handicap partner, highest-handicap partner).
-- Does not touch players, scores, groups, or existing games. Safe to run more than once.
-- ============================================================

alter table games drop constraint if exists games_format_check;
alter table games add constraint games_format_check check (
  format in (
    'individual_net', 'individual_gross', 'better_ball_2', 'better_ball_4',
    'composite', 'scramble_2', 'scramble_4', 'alt_shot_2',
    'match_play', 'ryder_cup'
  )
);

alter table games drop constraint if exists games_handicap_allowance_shape;
alter table games add constraint games_handicap_allowance_shape check (
  handicap_allowance is null
  or (
    jsonb_typeof(handicap_allowance) = 'array'
    and (
      (format in ('scramble_2', 'alt_shot_2') and jsonb_array_length(handicap_allowance) = 2)
      or (format = 'scramble_4' and jsonb_array_length(handicap_allowance) = 4)
      or (format not in ('scramble_2', 'scramble_4', 'alt_shot_2'))
    )
  )
);
