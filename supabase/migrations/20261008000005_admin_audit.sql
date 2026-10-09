-- Admin audit log, feedback status workflow, license app_version.
-- Run in Supabase Dashboard > SQL Editor > New query > Run.

-- 1. Audit log: every admin action recorded (actor, action, detail).
create table if not exists public.admin_audit (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_time_idx on public.admin_audit (created_at desc);

grant all on table public.admin_audit to postgres, service_role;
alter table public.admin_audit enable row level security;
drop policy if exists "service_role full access" on public.admin_audit;
create policy "service_role full access"
  on public.admin_audit for all to service_role
  using (true) with check (true);

-- 2. Feedback statuses: pending → in_progress → resolved / dismissed.
update public.feedback set status = 'pending' where status = 'new';
update public.feedback set status = 'in_progress' where status = 'reviewed';
do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.feedback'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%status%'
  loop
    execute format('alter table public.feedback drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.feedback
  add constraint feedback_status_check
  check (status in ('pending', 'in_progress', 'resolved', 'dismissed'));
alter table public.feedback alter column status set default 'pending';

-- 3. Track which app version a license last checked in with.
alter table public.licenses add column if not exists app_version text;
