-- Add a coupon column to track which code (e.g. First100, 100Sai) was
-- used to mint each license. Nullable because most licenses are paid.
--
-- Run this in Supabase Dashboard > SQL Editor > New query > Run.
-- Project: tweakr-licensing (vtonvtzhtkwksydpilwf)

alter table public.licenses
  add column if not exists coupon text;

-- Optional: a partial index so support / analytics can quickly list
-- coupon-based free licenses without scanning paid ones.
create index if not exists licenses_coupon_idx
  on public.licenses (coupon)
  where coupon is not null;
