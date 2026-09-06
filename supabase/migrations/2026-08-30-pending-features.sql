-- ============================================================================
-- Muxamil.co (CommHub) — PENDING SCHEMA MIGRATIONS
-- ============================================================================
-- Status: NOT APPLIED. The application currently runs against a shared live
-- Supabase project whose database password is not available to this
-- deployment, so DDL cannot be executed from here. All features below are
-- implemented either as documented workarounds (already live) or are
-- explicitly blocked and surfaced honestly in the UI as unavailable.
--
-- WHEN DB ACCESS IS AVAILABLE, review + run these statements in the Supabase
-- SQL editor, then remove the corresponding workarounds noted below.
-- ============================================================================

-- 1) CTA attachment type (workaround live today) -----------------------------
-- mux_post_attachments has a CHECK constraint allowing only
-- image|video|audio|document. CTA buttons are currently stored as
-- file_type='document' + mime_type='cta' (readers accept both conventions).
-- Proper fix:
ALTER TABLE mux_post_attachments DROP CONSTRAINT mux_post_attachments_file_type_check;
ALTER TABLE mux_post_attachments ADD CONSTRAINT mux_post_attachments_file_type_check
  CHECK (file_type IN ('image','video','audio','document','cta'));
-- Then migrate existing rows and update src/lib/post-dto.ts + the inserters
-- in src/app/api/posts/route.ts / posts/[id]/route.ts to write 'cta'.

-- 2) Poll system (BLOCKED — feature not implemented) --------------------------
-- No poll tables exist. Spec sections 31–33, 56, 78, 96, 119 require:
create table if not exists mux_polls (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references mux_posts(id) on delete cascade,
  question text not null,
  status text not null default 'open',        -- open | closed
  allow_vote_change boolean not null default false,
  display_adjustment integer not null default 0,
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists mux_poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references mux_polls(id) on delete cascade,
  label text not null,
  sort_order integer not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists mux_poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references mux_polls(id) on delete cascade,
  option_id uuid not null references mux_poll_options(id) on delete cascade,
  user_id uuid not null references mux_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (poll_id, user_id)
);
-- RLS: members read open polls + insert own votes; only service-role/admin
-- updates polls/options. Enable row level security on all three tables and
-- add policies mirroring mux_post_likes.

-- 3) Notification preferences (BLOCKED — no persistence) ----------------------
-- Spec section 42. mux_profiles.appearance is owned by the sibling app and is
-- not safe to reuse. Dedicated table:
create table if not exists mux_notification_prefs (
  user_id uuid primary key references mux_profiles(id) on delete cascade,
  new_posts boolean not null default true,
  reactions boolean not null default true,
  replies boolean not null default true,
  mentions boolean not null default true,
  updated_at timestamptz not null default now()
);

-- 4) Profile banner (BLOCKED — no column) -------------------------------------
-- Spec section 15. Add a banner column + reuse the mux-avatars bucket
-- (path profiles/{userId}/banner-...) or a dedicated public bucket:
alter table mux_profiles add column if not exists banner_url text;

-- 5) Scheduled-post publication cron (Vercel) ---------------------------------
-- The realtime service (mini-services/realtime-service) already runs a 60s
-- server-side publisher loop, so scheduling works wherever that service runs.
-- On Vercel (no long-running process) add an equivalent cron in vercel.json:
--   { "crons": [{ "path": "/api/cron/publish-scheduled", "schedule": "* * * *" }] }
-- and protect that route with the CRON_SECRET env var.

-- 6) Helpful indexes (optional, small data today) -----------------------------
create index if not exists mux_posts_category_id_idx on mux_posts(category_id);
create index if not exists mux_posts_status_idx on mux_posts(status);
create index if not exists mux_comments_post_id_idx on mux_comments(post_id);
create index if not exists mux_notifications_user_read_idx on mux_notifications(user_id, is_read);
create index if not exists mux_bookmarks_user_idx on mux_bookmarks(user_id);
create index if not exists mux_follows_following_idx on mux_follows(following_id);
