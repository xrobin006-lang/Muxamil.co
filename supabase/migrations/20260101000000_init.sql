-- ============================================================================
-- Muxamil.co — complete Supabase database setup
-- ============================================================================
-- Run this ONCE on a FRESH Supabase project (SQL Editor → New query → paste →
-- Run). It creates everything the application needs:
--
--   • tables            mux_profiles, mux_posts, mux_post_attachments,
--                       mux_communities, mux_community_posts,
--                       mux_community_post_attachments, mux_conversations,
--                       mux_messages, mux_notifications, mux_site_settings,
--                       audit_logs, profiles (shared auth-pool table)
--   • function          generate_referral_code() — used when provisioning the
--                       shared `profiles` row for a new auth user
--   • trigger           mux_profiles_guard_privileged_fields — rejects
--                       service-role writes to role / status / email /
--                       verification fields (only an authenticated ADMIN user
--                       JWT may change them; see src/lib/admin-auth.ts)
--   • row level security  enabled on every table; the app talks to Supabase
--                       ONLY server-side with the service-role key (which
--                       bypasses RLS), so no anon/authenticated policies are
--                       granted except the admin bridge on mux_profiles
--   • storage buckets   mux-avatars, mux-post-images, mux-post-videos,
--                       mux-post-documents (public) and
--                       mux-message-attachments (private, signed URLs)
--   • seed              the single mux_site_settings row (id = 1)
--
-- If you point the app at an EXISTING project that already has the mux_*
-- tables (e.g. the live Muxamil.co database), do NOT run this file —
-- everything already exists there.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- 1) Shared profiles table (auth-pool; audit_logs.actor_id references it)
-- ============================================================================
create table if not exists public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  email          text not null,
  username       text,
  full_name      text default '',
  phone          text,
  avatar_url     text,
  bio            text,
  status         text not null default 'pending',
  role           text not null default 'member',   -- shared convention: member | super_admin
  referral_code  text not null,
  referred_by_id uuid references public.profiles (id),
  last_active_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists profiles_referral_code_key on public.profiles (referral_code);
create index if not exists profiles_email_idx on public.profiles (email);

-- ============================================================================
-- 2) Community app profiles
-- ============================================================================
create table if not exists public.mux_profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  email          text not null,
  full_name      text not null default '',
  avatar_url     text,
  role           text not null default 'user',     -- 'user' | 'admin'
  status         text not null default 'active',   -- 'active' | 'blocked'
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  username       text,
  bio            text not null default '',
  is_verified    boolean not null default false,
  verified_at    timestamptz,
  verified_by    uuid references public.mux_profiles (id),
  avatar_config  jsonb,                            -- holds banner_url (profile banner)
  appearance     jsonb,
  last_active_at timestamptz not null default now()
);

create unique index if not exists mux_profiles_email_key on public.mux_profiles (email);
create unique index if not exists mux_profiles_username_key on public.mux_profiles (username);
create index if not exists mux_profiles_role_idx on public.mux_profiles (role);

-- ============================================================================
-- 3) Official posts + attachments
-- ============================================================================
create table if not exists public.mux_posts (
  id                    uuid primary key default gen_random_uuid(),
  title                 text not null,
  slug                  text not null,
  content               text not null default '',
  excerpt               text,
  category_id           uuid,
  author_id             uuid not null references public.mux_profiles (id) on delete cascade,
  is_published          boolean not null default false,
  is_pinned             boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  published_at          timestamptz,
  like_count_adjustment integer not null default 0,
  view_count_adjustment integer not null default 0,
  status                text,                      -- 'published' | 'draft' (mirrors is_published)
  post_type             text not null default 'article',  -- article|announcement|tutorial|image|video|pdf|link
  cover_image           text,
  link_url              text,
  views_count           integer not null default 0,
  views_real            integer not null default 0,
  likes_count           integer not null default 0,
  likes_real            integer not null default 0
);

create unique index if not exists mux_posts_slug_key on public.mux_posts (slug);
create index if not exists mux_posts_author_id_idx on public.mux_posts (author_id);
create index if not exists mux_posts_published_idx on public.mux_posts (is_published, created_at desc);

create table if not exists public.mux_post_attachments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.mux_posts (id) on delete cascade,
  author_id  uuid not null references public.mux_profiles (id) on delete cascade,
  file_name  text not null,
  file_url   text not null,
  file_type  text not null,                        -- image | video | audio | document
  mime_type  text not null,
  file_size  integer not null default 0,
  created_at timestamptz not null default now(),
  file_path  text,                                 -- storage object path
  sort_order integer not null default 0
);

create index if not exists mux_post_attachments_post_id_idx on public.mux_post_attachments (post_id);

-- ============================================================================
-- 4) Communities + community posts
-- ============================================================================
create table if not exists public.mux_communities (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null,
  description   text not null default '',
  owner_id      uuid not null references public.mux_profiles (id) on delete cascade,
  avatar_url    text,
  cover_url     text,
  status        text not null default 'active',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  is_active     boolean not null default true,
  members_count integer not null default 0
);

-- ONE community per user EVER (the app rejects a second row for the same owner).
create unique index if not exists mux_communities_owner_id_key on public.mux_communities (owner_id);
create unique index if not exists mux_communities_slug_key on public.mux_communities (slug);

create table if not exists public.mux_community_posts (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null references public.mux_communities (id) on delete cascade,
  author_id     uuid not null references public.mux_profiles (id) on delete cascade,
  title         text not null,
  content       text not null default '',
  excerpt       text,
  status        text not null default 'pending',   -- 'pending' | 'approved' | 'rejected'
  admin_note    text,                              -- rejection reason / approval note
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  link_url      text,
  reviewed_by   uuid references public.mux_profiles (id),
  reviewed_at   timestamptz
);

create index if not exists mux_community_posts_community_id_idx
  on public.mux_community_posts (community_id, status, created_at desc);

create table if not exists public.mux_community_post_attachments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.mux_community_posts (id) on delete cascade,
  file_name  text not null,
  file_url   text not null,
  file_type  text not null,
  mime_type  text not null,
  file_size  integer not null default 0,
  created_at timestamptz not null default now(),
  file_path  text,
  sort_order integer not null default 0
);

create index if not exists mux_community_post_attachments_post_id_idx
  on public.mux_community_post_attachments (post_id);

-- ============================================================================
-- 5) Admin ↔ member chat (one conversation per member)
-- ============================================================================
create table if not exists public.mux_conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.mux_profiles (id) on delete cascade,
  admin_id    uuid references public.mux_profiles (id),
  post_id     uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  subject     text,
  status      text not null default 'active',
  last_msg_at timestamptz not null default now()
);

create unique index if not exists mux_conversations_user_id_key on public.mux_conversations (user_id);

create table if not exists public.mux_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.mux_conversations (id) on delete cascade,
  sender_id       uuid not null references public.mux_profiles (id) on delete cascade,
  message         text not null default '',
  attachment_url  text,                            -- absolute SIGNED URL (private bucket)
  attachment_name text,
  attachment_type text,                            -- image | file | audio
  is_read         boolean not null default false,
  created_at      timestamptz not null default now(),
  attachment_path text,                            -- storage object path
  read_at         timestamptz,
  updated_at      timestamptz not null default now()
);

create index if not exists mux_messages_conversation_id_idx
  on public.mux_messages (conversation_id, created_at asc);

-- ============================================================================
-- 6) Notifications + site settings + audit log
-- ============================================================================
create table if not exists public.mux_notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.mux_profiles (id) on delete cascade,
  actor_id    uuid references public.mux_profiles (id) on delete set null,
  type        text not null,                       -- verification | message | community_approved | ...
  entity_id   text,
  entity_slug text,
  message     text not null,
  is_read     boolean not null default false,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists mux_notifications_user_id_idx
  on public.mux_notifications (user_id, is_read, created_at desc);

create table if not exists public.mux_site_settings (
  id                          integer primary key default 1,
  site_name                   text not null default 'Muxamil.co',
  site_description            text not null default 'Stay Connected. Stay Informed. A simple community information channel.',
  logo_url                    text not null default '/branding/muxamil-logo-icon.png',
  favicon_url                 text not null default '/favicon-32.png',
  support_email               text not null default '',
  contact_enabled             boolean not null default true,
  registration_enabled        boolean not null default true,
  maintenance_mode            boolean not null default false,
  updated_at                  timestamptz not null default now(),
  likes_enabled               boolean not null default true,
  views_enabled               boolean not null default true,
  follow_enabled              boolean not null default true,
  community_enabled           boolean not null default true,
  community_approval_required boolean not null default true,
  social_links_enabled        boolean not null default true,
  verification_enabled        boolean not null default true,
  updated_by                  uuid
);

create table if not exists public.audit_logs (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid references public.profiles (id) on delete set null,
  action     text not null,                        -- e.g. 'user.verified', 'community_post.approved'
  target     text,                                 -- 'user:<id>' | 'post:<id>' | ...
  meta       jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_logs_created_at_idx on public.audit_logs (created_at desc);

-- ============================================================================
-- 7) Referral code generator (used by src/lib/provision.ts)
-- ============================================================================
create or replace function public.generate_referral_code()
returns text
language sql
as $$
  select (
    select string_agg(
      substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1),
      ''
    )
    from generate_series(1, 8)
  );
$$;

-- ============================================================================
-- 8) Row Level Security
-- ----------------------------------------------------------------------------
-- The application accesses Supabase ONLY through its own Next.js API routes
-- using the service-role key, which bypasses RLS. Enabling RLS with no
-- policies therefore locks every table down for anon/authenticated clients
-- (defense in depth — even the publishable/anon key can do nothing).
--
-- The single exception: the admin bridge (src/lib/admin-auth.ts) updates
-- mux_profiles with an authenticated ADMIN user JWT (required by the
-- privileged-fields trigger below), so exactly that is allowed.
-- ============================================================================
alter table public.profiles                       enable row level security;
alter table public.mux_profiles                   enable row level security;
alter table public.mux_posts                      enable row level security;
alter table public.mux_post_attachments           enable row level security;
alter table public.mux_communities                enable row level security;
alter table public.mux_community_posts            enable row level security;
alter table public.mux_community_post_attachments enable row level security;
alter table public.mux_conversations              enable row level security;
alter table public.mux_messages                   enable row level security;
alter table public.mux_notifications              enable row level security;
alter table public.mux_site_settings              enable row level security;
alter table public.audit_logs                     enable row level security;

drop policy if exists mux_profiles_admin_update on public.mux_profiles;
create policy mux_profiles_admin_update on public.mux_profiles
  for update to authenticated
  using (
    exists (
      select 1 from public.mux_profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  )
  with check (
    exists (
      select 1 from public.mux_profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- ============================================================================
-- 9) Privileged-fields guard on mux_profiles
-- ----------------------------------------------------------------------------
-- Mirrors the production security model: the service-role key must NOT be
-- able to grant itself admin rights, verify users, or block/unblock accounts
-- through direct table writes. Only an authenticated ADMIN user JWT may
-- change these fields (the app does this via src/lib/admin-auth.ts), plus
-- the SQL editor / migration role for bootstrap and maintenance.
--
-- All other columns (name, bio, avatar, banner, last_active_at, ...) remain
-- writable with the service-role key — the trigger only fires when one of
-- the privileged columns actually changes.
-- ============================================================================
create or replace function public.mux_profiles_guard_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  claims   jsonb := null;
  act_role text := '';
  act_uid  uuid := null;
  is_admin boolean := false;
begin
  -- Fire only when a privileged column actually changes.
  if new.role = old.role
     and new.status = old.status
     and new.email = old.email
     and new.is_verified is not distinct from old.is_verified
     and new.verified_at is not distinct from old.verified_at
     and new.verified_by is not distinct from old.verified_by
  then
    return new;
  end if;

  -- SQL editor / migrations (postgres owner) always pass — bootstrap path.
  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  begin
    claims := current_setting('request.jwt.claims', true)::jsonb;
  exception when others then
    claims := null;
  end;

  act_role := coalesce(claims ->> 'role', '');
  if act_role = 'authenticated' and claims ? 'sub' then
    act_uid := (claims ->> 'sub')::uuid;
    select exists (
      select 1 from public.mux_profiles p
      where p.id = act_uid and p.role = 'admin'
    ) into is_admin;
    if is_admin then
      return new;
    end if;
  end if;

  raise exception 'You are not allowed to change role, status, email, or verification fields'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists mux_profiles_guard_privileged_fields on public.mux_profiles;
create trigger mux_profiles_guard_privileged_fields
  before update on public.mux_profiles
  for each row
  execute function public.mux_profiles_guard_privileged_fields();

-- ============================================================================
-- 10) Storage buckets
-- ----------------------------------------------------------------------------
-- Public buckets serve files straight from
--   https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
-- (no storage policies needed). mux-message-attachments is PRIVATE: the app
-- uploads and reads it server-side only and hands out 1-year signed URLs.
-- Uploads happen exclusively server-side with the service-role key, so no
-- storage policies are created for any bucket.
-- ============================================================================
insert into storage.buckets (id, name, public)
values
  ('mux-avatars',             'mux-avatars',             true),
  ('mux-post-images',         'mux-post-images',         true),
  ('mux-post-videos',         'mux-post-videos',         true),
  ('mux-post-documents',      'mux-post-documents',      true),
  ('mux-message-attachments', 'mux-message-attachments', false)
on conflict (id) do nothing;

-- Upload limits aligned with the app's server-side validation
-- (src/app/api/upload/route.ts).
update storage.buckets set file_size_limit = 10485760  -- 10 MB (app cap: 8 MB)
  where id = 'mux-avatars';
update storage.buckets set file_size_limit = 104857600 -- 100 MB (app cap: 100 MB)
  where id in ('mux-post-images', 'mux-post-videos', 'mux-post-documents');
update storage.buckets set file_size_limit = 31457280  -- 30 MB (app cap: 25 MB)
  where id = 'mux-message-attachments';

-- ============================================================================
-- 11) Seed the single site-settings row
-- ============================================================================
insert into public.mux_site_settings (id, logo_url, favicon_url)
values (1, '/branding/muxamil-logo-icon.png', '/favicon-32.png')
on conflict (id) do nothing;
