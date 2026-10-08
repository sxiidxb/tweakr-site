-- Fix: "permission denied for table licenses" from generate-license edge function
-- Run this in Supabase Dashboard > SQL Editor > New query > Run
-- Project: tweakr-licensing (vtonvtzhtkwksydpilwf)

-- 1. Make sure the table exists with the columns the function needs
create table if not exists public.licenses (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  tier text not null check (tier in ('starter', 'full')),
  license_key text not null unique,
  payment_ref text unique,
  created_at timestamptz not null default now()
);

-- 2. Backfill columns if the table already existed without them
-- Keep your existing schema (hardware_id, is_active) + add what the function needs
alter table public.licenses add column if not exists email text;
alter table public.licenses add column if not exists tier text;
alter table public.licenses add column if not exists license_key text;
alter table public.licenses add column if not exists hardware_id text;
alter table public.licenses add column if not exists is_active boolean not null default true;
alter table public.licenses add column if not exists payment_ref text;
alter table public.licenses add column if not exists created_at timestamptz not null default now();

-- 3. THE ACTUAL FIX: grant access.
-- "permission denied for table" is a GRANT problem, not an RLS-policy problem.
-- The edge function uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS
-- but still needs table-level GRANTs.
grant all on table public.licenses to postgres, service_role;
grant usage, select on all sequences in schema public to postgres, service_role;

-- Allow the API roles to read only if you ever need it (remove if you want it fully private).
-- Do NOT grant insert to anon/authenticated: all writes go through the edge function
-- which uses service_role internally.
grant select on table public.licenses to authenticated;

-- 4. Keep RLS on (good practice), with an explicit policy.
-- service_role bypasses RLS, so this policy is for clarity / dashboard access.
alter table public.licenses enable row level security;

drop policy if exists "service_role full access" on public.licenses;
create policy "service_role full access"
  on public.licenses
  for all
  to service_role
  using (true)
  with check (true);
