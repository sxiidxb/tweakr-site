-- Fix 2: desktop activation rejects unprefixed keys + anon lookup returns nothing
-- Run in Supabase Dashboard > SQL Editor > New query > Run

-- 1. Backfill keys issued before the prefix fix (idempotent: only touches unprefixed rows)
update public.licenses
  set license_key = case
    when tier = 'starter' then 'TWEAKR-STARTER-' || license_key
    else 'TWEAKR-FULL-' || license_key
  end
  where license_key not like 'TWEAKR-%';

-- 2. Desktop verifies via anon REST lookup, so anon needs read access.
-- service_role bypasses RLS; anon does not.
grant select on table public.licenses to anon, authenticated;

drop policy if exists "anon verify license" on public.licenses;
create policy "anon verify license"
  on public.licenses
  for select
  to anon
  using (true);
