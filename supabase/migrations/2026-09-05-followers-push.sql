-- ============================================================================
-- Muxamil.co (CommHub) — FOLLOWER DISPLAY OVERRIDE + WEB PUSH SUBSCRIPTIONS
-- ============================================================================
-- Status: OBSOLETE — KEPT FOR REFERENCE ONLY. DO NOT APPLY.
--
-- The application no longer needs this DDL: both structures are now stored
-- in the shared project's existing `settings_versions` table by the compat
-- KV store in src/lib/compat-store.ts:
--   * follower display adjustment  → section "mux:follower_adj:<userId>"
--   * web push subscriptions       → section "mux:push_sub:<sha256(endpoint)>"
-- The anon role has NO grant on settings_versions, so push credentials stay
-- server-side-only, and all writes still flow through admin-guarded /
-- user-scoped API routes (identical enforcement model).
--
-- Applying this file anyway would create structures the app no longer reads
-- or writes (mux_profiles.follower_count_adjustment, mux_push_subscriptions).
-- ============================================================================

-- (Original DDL preserved below for historical reference only.) --------------

-- 1) Follower display override (spec §31/§32) -------------------------------
-- Real follower relationships live ONLY in mux_follows and are never touched
-- by the override. Displayed count = GREATEST(0, real + adjustment), applied
-- centrally in /api/users/[id] (followersDisplayCount).
alter table mux_profiles
  add column if not exists follower_count_adjustment integer not null default 0;

alter table mux_profiles
  add constraint mux_profiles_follower_adjustment_range
  check (follower_count_adjustment between -1000000 and 1000000)
  not valid; -- not valid → cheap to add on a live table, enforced for new writes

-- Writes are server-side only (requireAdmin-guarded API → admin-JWT bridge).
-- The sibling app's mux_profiles trigger/policies already block direct
-- member writes of privileged columns; nothing extra needed for RLS here.

-- 2) Web Push subscriptions (spec §34) ----------------------------------------
-- One row per browser endpoint (unique) → multiple devices per user dedupe
-- naturally. Credentials (p256dh/auth) are readable ONLY by the owning user
-- and the service role; the VAPID private key never touches this table.
create table if not exists mux_push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references mux_profiles(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists mux_push_subscriptions_user_idx
  on mux_push_subscriptions(user_id);

alter table mux_push_subscriptions enable row level security;

drop policy if exists "mux_push_sub own read"   on mux_push_subscriptions;
drop policy if exists "mux_push_sub own insert" on mux_push_subscriptions;
drop policy if exists "mux_push_sub own delete" on mux_push_subscriptions;

create policy "mux_push_sub own read"
  on mux_push_subscriptions for select
  using (auth.uid() = user_id);

create policy "mux_push_sub own insert"
  on mux_push_subscriptions for insert
  with check (auth.uid() = user_id);

create policy "mux_push_sub own delete"
  on mux_push_subscriptions for delete
  using (auth.uid() = user_id);

-- 3) Housekeeping --------------------------------------------------------------
-- Helpful index for the notification list endpoint (idempotent).
create index if not exists mux_notifications_user_read_idx
  on mux_notifications(user_id, is_read);

-- After applying: restart is NOT required — the API probes detect the new
-- structures on their next call and every feature activates automatically.

-- 4) OPTIONAL — widen the reaction picker (spec §20 "expanded picker") -------
-- The live DB constraint mux_post_reactions_emoji_check currently allows
-- exactly: like, love, haha, wow, sad, fire. The app allowlist matches the
-- DB (they stay in sync). To widen the picker to 10 reactions, run:
-- (then update REACTION_TYPES in src/lib/types.ts to match)
-- alter table mux_post_reactions drop constraint mux_post_reactions_emoji_check;
-- alter table mux_post_reactions add constraint mux_post_reactions_emoji_check
--   check (emoji in ('like','love','haha','wow','sad','fire','party','clap','hundred','think'));
