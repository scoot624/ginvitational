-- ============================================================
-- Ginvitational: let Admin → Danger Zone → "Clear all messages" work
-- ============================================================
-- The Broadcast table had no DELETE policy, so the app could post messages
-- but never remove them. This adds one (open, like the rest of the app's
-- policies — the Danger Zone itself is behind the Admin passcode).
-- Safe to run more than once.
-- ============================================================

drop policy if exists "allow delete broadcast_messages" on broadcast_messages;
create policy "allow delete broadcast_messages"
  on broadcast_messages for delete
  using (true);
