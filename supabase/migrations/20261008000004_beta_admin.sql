-- Beta portals + admin control: feedback inbox, announcements, bans.
-- Run in Supabase Dashboard > SQL Editor > New query > Run.

-- 1. Feedback / bug reports from both tiers.
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  tier text not null check (tier in ('grey', 'black')),
  kind text not null check (kind in ('bug', 'feature')),
  title text not null check (char_length(title) between 3 and 120),
  body text not null check (char_length(body) between 10 and 5000),
  app_version text,
  status text not null default 'new' check (status in ('new', 'reviewed', 'resolved')),
  created_at timestamptz not null default now()
);
create index if not exists feedback_status_idx on public.feedback (status, created_at desc);
create index if not exists feedback_tier_idx on public.feedback (tier, created_at desc);

-- 2. Broadcast announcements (admin publishes, site + apps read).
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  audience text not null check (audience in ('all', 'grey', 'black')),
  message text not null check (char_length(message) between 3 and 500),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists announcements_active_idx on public.announcements (active, created_at desc);

-- 3. Banned emails (blocked at signup + login).
create table if not exists public.bans (
  email text primary key,
  reason text,
  created_at timestamptz not null default now()
);

-- 4. Grants: edge functions use SUPABASE_SERVICE_ROLE_KEY (bypasses RLS
-- but still needs table-level GRANTs — same lesson as the licenses table).
grant all on table public.feedback to postgres, service_role;
grant all on table public.announcements to postgres, service_role;
grant all on table public.bans to postgres, service_role;
grant usage, select on all sequences in schema public to postgres, service_role;

-- 5. Keep RLS on with explicit service_role policies.
alter table public.feedback enable row level security;
alter table public.announcements enable row level security;
alter table public.bans enable row level security;

drop policy if exists "service_role full access" on public.feedback;
create policy "service_role full access"
  on public.feedback for all to service_role
  using (true) with check (true);

drop policy if exists "service_role full access" on public.announcements;
create policy "service_role full access"
  on public.announcements for all to service_role
  using (true) with check (true);

drop policy if exists "service_role full access" on public.bans;
create policy "service_role full access"
  on public.bans for all to service_role
  using (true) with check (true);
