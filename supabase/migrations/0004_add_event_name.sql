-- ============================================================
-- Ginvitational: editable event name
-- ============================================================
-- Adds one column to the existing app_settings singleton table.
-- Defaults to "The Ginvitational" so nothing currently displayed
-- changes until an admin edits it.
-- ============================================================

alter table app_settings add column if not exists event_name text not null default 'The Ginvitational';
