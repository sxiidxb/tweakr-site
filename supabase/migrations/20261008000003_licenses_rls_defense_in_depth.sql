-- Defense-in-depth: row-level security on the licenses table.
--
-- The auth-handler edge function reads licenses using the service_role key
-- (which bypasses RLS), so this policy does NOT affect that path. It only
-- stops a leaked anon key (or any future client-side direct call) from
-- being able to SELECT all rows.
--
-- Policy summary:
--   - service_role: full access (service_role bypasses RLS anyway, but the
--     explicit GRANT already in place is kept for clarity)
--   - authenticated: SELECT only when licenses.email = auth.email()
--   - anon, other roles: no access
--
-- Run this in Supabase Dashboard > SQL Editor > New query > Run.
-- Project: tweakr-licensing (vtonvtzhtkwksydpilwf)

alter table public.licenses enable row level security;

-- Drop the old, overly-permissive policy from 20261008000000 if it's still there.
drop policy if exists "service_role full access" on public.licenses;

-- Service role still gets explicit access for clarity.
create policy "service_role full access"
  on public.licenses
  for all
  to service_role
  using (true)
  with check (true);

-- A logged-in user can read only their own license rows.
-- (The auth-handler edge function reads via service_role, so this is
-- belt-and-suspenders in case anything ever calls the table directly.)
create policy "users read own licenses"
  on public.licenses
  for select
  to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- Explicitly deny everything else to anon and unauthenticated roles.
-- (RLS already denies by default, but we make it crystal clear.)
revoke all on table public.licenses from anon;
