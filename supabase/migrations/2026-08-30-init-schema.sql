-- ============================================================================
-- Muxamil.co (CommHub) — COMPLETE DATABASE SCHEMA
-- ============================================================================
-- Reconstructed 1:1 from the production Supabase project (19 mux_* tables).
-- Run this in the SQL editor of a FRESH Supabase project to stand up the
-- entire database. Idempotent: safe to re-run.
--
-- Contents:
--   1. Tables (PK / FK / defaults, exactly as live)
--   2. Indexes (FK columns + hot query paths)
--   3. RLS (enabled everywhere; access is mediated by the Next.js backend
--      using the service key — clients never talk to Postgres directly)
--   4. auth.users → mux_profiles provisioning trigger
--   5. updated_at maintenance trigger
--   6. Seed row (mux_site_settings) + AI system account note
--
-- NOTE — shared projects: this schema is namespaced with the mux_ prefix and
-- can coexist with other applications in the same database.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) TABLES
-- ---------------------------------------------------------------------------

-- Members / staff. id mirrors auth.users (1:1). Service-key inserts happen
-- through the app (see src/lib/provision.ts); the trigger below covers
-- auth-side signups.
create table if not exists mux_profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  email          text not null unique,
  full_name      text not null default '',
  username       text unique,
  bio            text default '',
  avatar_url     text,
  avatar_config  jsonb,
  appearance     jsonb,
  role           text not null default 'user' check (role in ('user','admin')),
  status         text not null default 'active' check (status in ('active','blocked')),
  is_verified    boolean default false,
  verified_at    timestamptz,
  verified_by    uuid references mux_profiles(id),
  last_active_at timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Global site settings — single row, id = 1.
create table if not exists mux_site_settings (
  id                          integer primary key default 1 check (id = 1),
  site_name                   text not null default 'Muxamil.co',
  site_description            text not null default 'Stay Connected. Stay Informed. A simple community information channel.',
  logo_url                    text not null default '/logo.png',
  favicon_url                 text not null default '/favicon-32.png',
  support_email               text not null default '',
  contact_enabled             boolean not null default true,
  registration_enabled        boolean not null default true,
  maintenance_mode            boolean not null default false,
  likes_enabled               boolean default true,
  views_enabled               boolean default true,
  follow_enabled              boolean default true,
  community_enabled           boolean default true,
  community_approval_required boolean default true,
  social_links_enabled        boolean default true,
  verification_enabled        boolean default true,
  updated_by                  uuid references mux_profiles(id),
  updated_at                  timestamptz not null default now()
);

-- Content categories (admin-managed, ordered, activatable).
create table if not exists mux_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  slug        text not null unique,
  description text,
  color       text,
  icon        text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Official posts (the platform feed) + engagement counter columns.
-- views_real / likes_real are true row counts; views_count / likes_count are
-- the displayed values (real + admin adjustment). The app never trusts
-- client-supplied counts.
create table if not exists mux_posts (
  id                    uuid primary key default gen_random_uuid(),
  title                 text not null,
  slug                  text not null unique,
  content               text not null default '',
  excerpt               text,
  category_id           uuid references mux_categories(id) on delete set null,
  author_id             uuid not null references mux_profiles(id) on delete cascade,
  post_type             text not null default 'article'
                        check (post_type in ('article','update','announcement','event')),
  cover_image           text,
  link_url              text,
  status                text check (status in ('published','draft','scheduled','deleted')),
  is_published          boolean not null default false,
  is_pinned             boolean not null default false,
  published_at          timestamptz,
  views_count           integer not null default 0,
  views_real            integer not null default 0,
  likes_count           integer not null default 0,
  likes_real            integer not null default 0,
  view_count_adjustment integer default 0,
  like_count_adjustment integer default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Post media/CTA attachments. CTA buttons are stored as
-- file_type='document' + mime_type='cta' (documented workaround for the
-- live CHECK constraint — see 2026-08-30-pending-features.sql).
create table if not exists mux_post_attachments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references mux_posts(id) on delete cascade,
  author_id  uuid not null references mux_profiles(id) on delete cascade,
  file_name  text not null,
  file_url   text not null,
  file_type  text not null check (file_type in ('image','video','audio','document')),
  mime_type  text not null,
  file_size  integer not null default 0,
  file_path  text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Verified-member communities (one per owner, enforced app-side + unique FK).
create table if not exists mux_communities (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null unique references mux_profiles(id) on delete cascade,
  name          text not null,
  slug          text not null unique,
  description   text default '',
  avatar_url    text,
  cover_url     text,
  status        text not null default 'active' check (status in ('active','inactive')),
  is_active     boolean not null default true,
  members_count integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists mux_community_members (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references mux_communities(id) on delete cascade,
  user_id      uuid not null references mux_profiles(id) on delete cascade,
  role         text not null default 'member' check (role in ('member','moderator')),
  joined_at    timestamptz not null default now(),
  unique (community_id, user_id)
);

-- Community posts go through the admin approval workflow.
create table if not exists mux_community_posts (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references mux_communities(id) on delete cascade,
  author_id    uuid not null references mux_profiles(id) on delete cascade,
  title        text not null,
  content      text default '',
  excerpt      text,
  link_url     text,
  status       text not null default 'pending'
               check (status in ('pending','approved','rejected')),
  admin_note   text,
  reviewed_by  uuid references mux_profiles(id),
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists mux_community_post_attachments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references mux_community_posts(id) on delete cascade,
  file_name  text not null,
  file_url   text not null,
  file_type  text not null,
  mime_type  text not null,
  file_size  integer default 0,
  file_path  text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Threaded comments (parent_id = self-reference for replies).
create table if not exists mux_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references mux_posts(id) on delete cascade,
  user_id    uuid not null references mux_profiles(id) on delete cascade,
  parent_id  uuid references mux_comments(id) on delete cascade,
  content    text not null,
  is_hidden  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mux_comment_likes (
  id         uuid primary key default gen_random_uuid(),
  comment_id uuid not null references mux_comments(id) on delete cascade,
  user_id    uuid not null references mux_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (comment_id, user_id)
);

create table if not exists mux_post_likes (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references mux_posts(id) on delete cascade,
  user_id    uuid not null references mux_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

-- View dedup: one row per (post, user) or anonymous viewer_hash per day.
create table if not exists mux_post_views (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references mux_posts(id) on delete cascade,
  user_id     uuid references mux_profiles(id) on delete cascade,
  viewer_hash text,
  viewed_at   timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create table if not exists mux_bookmarks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references mux_profiles(id) on delete cascade,
  post_id    uuid not null references mux_posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, post_id)
);

create table if not exists mux_follows (
  id           uuid primary key default gen_random_uuid(),
  follower_id  uuid not null references mux_profiles(id) on delete cascade,
  following_id uuid not null references mux_profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (follower_id, following_id),
  check (follower_id <> following_id)
);

-- Admin <-> member private support conversations (one per member).
create table if not exists mux_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null unique references mux_profiles(id) on delete cascade,
  admin_id    uuid references mux_profiles(id),
  post_id     uuid references mux_posts(id) on delete set null,
  subject     text,
  status      text not null default 'active' check (status in ('active','closed')),
  last_msg_at timestamptz default now(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists mux_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references mux_conversations(id) on delete cascade,
  sender_id       uuid not null references mux_profiles(id) on delete cascade,
  message         text not null default '',
  attachment_url  text,
  attachment_name text,
  attachment_type text,
  attachment_path text,
  is_read         boolean not null default false,
  read_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists mux_notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references mux_profiles(id) on delete cascade,
  actor_id    uuid references mux_profiles(id) on delete set null,
  type        text not null,
  entity_id   text,
  entity_slug text,
  message     text not null,
  is_read     boolean not null default false,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists mux_social_links (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  url          text not null,
  platform     text not null default 'website',
  icon         text default 'link',
  enabled      boolean not null default true,
  display_order integer not null default 0,
  created_by   uuid references mux_profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2) INDEXES (FK paths + hot queries)
-- ---------------------------------------------------------------------------
create index if not exists idx_profiles_role           on mux_profiles(role);
create index if not exists idx_profiles_verified       on mux_profiles(is_verified) where is_verified;
create index if not exists idx_profiles_status         on mux_profiles(status);
create index if not exists idx_profiles_last_active    on mux_profiles(last_active_at);
create index if not exists idx_posts_feed              on mux_posts(status, is_pinned desc, published_at desc);
create index if not exists idx_posts_author            on mux_posts(author_id);
create index if not exists idx_posts_category          on mux_posts(category_id);
create index if not exists idx_posts_published_at      on mux_posts(published_at desc);
create index if not exists idx_attachments_post        on mux_post_attachments(post_id, sort_order);
create index if not exists idx_comments_post           on mux_comments(post_id, created_at);
create index if not exists idx_comments_parent         on mux_comments(parent_id);
create index if not exists idx_comment_likes_comment   on mux_comment_likes(comment_id);
create index if not exists idx_likes_post              on mux_post_likes(post_id);
create index if not exists idx_likes_user              on mux_post_likes(user_id);
create index if not exists idx_views_post              on mux_post_views(post_id, viewed_at desc);
create index if not exists idx_views_hash              on mux_post_views(post_id, viewer_hash);
create index if not exists idx_bookmarks_user          on mux_bookmarks(user_id, created_at desc);
create index if not exists idx_follows_following       on mux_follows(following_id);
create index if not exists idx_follows_follower        on mux_follows(follower_id);
create index if not exists idx_communities_slug        on mux_communities(slug);
create index if not exists idx_community_posts_status  on mux_community_posts(community_id, status, created_at desc);
create index if not exists idx_community_posts_author  on mux_community_posts(author_id);
create index if not exists idx_community_attach_post   on mux_community_post_attachments(post_id, sort_order);
create index if not exists idx_conversations_admin     on mux_conversations(admin_id, last_msg_at desc);
create index if not exists idx_messages_conversation   on mux_messages(conversation_id, created_at);
create index if not exists idx_messages_unread         on mux_messages(conversation_id) where is_read = false;
create index if not exists idx_notifications_user      on mux_notifications(user_id, is_read, created_at desc);
create index if not exists idx_social_links_order      on mux_social_links(enabled, display_order);

-- ---------------------------------------------------------------------------
-- 3) ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
-- The application talks to Postgres exclusively through the Next.js backend
-- (service key). RLS is therefore ENABLED on every table with NO public
-- policies: anon/authenticated clients get nothing, the service role
-- bypasses RLS by design. This is intentional defense-in-depth — do not add
-- permissive policies unless you change the architecture.
do $$
declare t text;
begin
  foreach t in array array[
    'mux_profiles','mux_site_settings','mux_categories','mux_posts',
    'mux_post_attachments','mux_communities','mux_community_members',
    'mux_community_posts','mux_community_post_attachments','mux_comments',
    'mux_comment_likes','mux_post_likes','mux_post_views','mux_bookmarks',
    'mux_follows','mux_conversations','mux_messages','mux_notifications',
    'mux_social_links'
  ] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4) AUTH USER → PROFILE TRIGGER
-- ---------------------------------------------------------------------------
-- Creates the mux_profiles row the moment a signup lands in auth.users
-- (runs as postgres, RLS-safe). The app also provisions lazily on first
-- login (src/lib/provision.ts) so both paths converge.
create or replace function mux_handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into mux_profiles (id, email, full_name, username, created_at, updated_at, last_active_at)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(lower(new.email),'@',1)),
    coalesce(new.raw_user_meta_data->>'username', split_part(lower(new.email),'@',1) || '_' || substr(new.id::text,1,4)),
    now(), now(), now()
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function mux_handle_new_user();

-- ---------------------------------------------------------------------------
-- 5) updated_at MAINTENANCE
-- ---------------------------------------------------------------------------
-- Keeps updated_at fresh on UPDATE when the statement doesn't set it
-- explicitly (the app usually sets it itself; harmless double-guard).
create or replace function mux_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'mux_profiles','mux_categories','mux_posts','mux_communities',
    'mux_community_posts','mux_comments','mux_conversations',
    'mux_messages','mux_social_links'
  ] loop
    execute format('drop trigger if exists touch_updated_at on %I', t);
    execute format(
      'create trigger touch_updated_at before update on %I
       for each row execute function mux_touch_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6) SEED
-- ---------------------------------------------------------------------------
insert into mux_site_settings (id, site_name, logo_url, favicon_url)
values (1, 'Muxamil.co', '/branding/muxamil-logo-icon.png', '/favicon-32.png')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- STORAGE BUCKETS (create in Dashboard → Storage, or via SQL below)
--   mux-avatars            PUBLIC  — profile & community avatars
--   mux-post-images        PUBLIC  — post image media
--   mux-post-videos        PUBLIC  — post video media
--   mux-post-documents     PUBLIC  — post documents (pdf etc.)
--   mux-message-attachments PRIVATE — chat attachments (signed URLs only)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values
  ('mux-avatars',            'mux-avatars',            true),
  ('mux-post-images',        'mux-post-images',        true),
  ('mux-post-videos',        'mux-post-videos',        true),
  ('mux-post-documents',     'mux-post-documents',     true),
  ('mux-message-attachments','mux-message-attachments', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- AI SYSTEM ACCOUNT (optional fixture)
-- ---------------------------------------------------------------------------
-- The admin "AI reply" feature attributes generated replies to a dedicated
-- system profile (username 'muxamil.ai'). It is created automatically on
-- first use by /api/admin/ai/post — no action needed here. To pre-seed it
-- manually, create the auth user ai@muxamil.co.local first, then the
-- trigger above inserts its mux_profiles row; the app renames it.

-- ============================================================================
-- DONE. Next steps:
--   * Apply supabase/migrations/2026-08-30-pending-features.sql when you
--     want polls / notification preferences / profile banners (documented).
--   * Configure env vars (see .env.example) and create the admin account.
-- ============================================================================
