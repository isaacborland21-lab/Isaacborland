-- Graffiti removal tracker: tables + private photo bucket.
-- Run once in the Supabase SQL editor (safe to re-run; everything is IF NOT EXISTS).
--
-- Access model: the site only ever talks to these tables from API routes using the
-- service-role key (which bypasses row level security). RLS is switched ON with NO
-- policies, so the public anon key can read and write nothing here.

create table if not exists public.graffiti_incidents (
  id            bigint generated always as identity primary key,
  status        text        not null default 'reported'
                check (status in ('reported', 'scheduled', 'in_progress', 'removed')),
  lat           double precision not null check (lat between -90 and 90),
  lng           double precision not null check (lng between -180 and 180),
  address       text,
  gtype         text        not null default 'other'
                check (gtype in ('ssr', 'slap', 'bare_brick', 'other')),
  description   text,
  notes         text,
  before_photo  text,
  after_photo   text,
  reported_at   timestamptz not null default now(),
  scheduled_for date,
  started_at    timestamptz,  -- when the BEFORE photo was taken (clock start)
  finished_at   timestamptz,  -- when the AFTER photo was taken (clock stop)
  removed_at    timestamptz,  -- same moment as finished_at; decides the invoice month
  duration_min  integer     check (duration_min is null or duration_min between 0 and 1440), -- ACTUAL minutes, never changed by the billing minimum
  created_by    text        not null, -- Clerk user id
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists graffiti_incidents_reported_idx on public.graffiti_incidents (reported_at desc);
create index if not exists graffiti_incidents_removed_idx  on public.graffiti_incidents (removed_at) where removed_at is not null;

-- Reporting / multi-device additions (safe to re-run; older installs get the new columns here).
alter table public.graffiti_incidents
  add column if not exists report_photo      text,                            -- photo of the tag as first reported
  add column if not exists reported_by_name  text,
  add column if not exists urgent            boolean not null default false,
  add column if not exists claimed_by        text,                            -- Clerk user id of whoever took the job
  add column if not exists claimed_by_name   text;

-- Invoice details + who did the work (safe to re-run).
alter table public.graffiti_incidents
  add column if not exists gkind             text,   -- kind of graffiti: marker, chalk pen, sticker ...
  add column if not exists surface           text,   -- what it was on: electrical box, brick wall ...
  add column if not exists chemical          text,   -- what removed it: SSR, graffiti remover ...
  add column if not exists removed_by_name   text;   -- crew account that finished / took the job (invoice section)

-- Billing settings (rate, minimum minutes, who we bill, time zone ...). One row per setting.
create table if not exists public.graffiti_settings (
  k text primary key,
  v text
);

-- One row per month that has been marked "invoiced". It freezes the rate, the minimum and the
-- exact list of tags that were on the invoice, so later edits can be detected and flagged.
create table if not exists public.graffiti_invoices (
  month        text primary key check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  invoice_no   text        not null,
  invoice_date date        not null,
  invoiced_at  timestamptz not null default now(),
  invoiced_by  text,
  jobs         integer     not null,
  actual_min   integer     not null,
  billed_min   integer     not null,
  total_cents  integer     not null,
  rate_cents   integer     not null,
  min_minutes  integer     not null,
  round_to     integer     not null,
  job_ids      bigint[]    not null default '{}'
);

alter table public.graffiti_incidents enable row level security;
alter table public.graffiti_settings  enable row level security;
alter table public.graffiti_invoices  enable row level security;

-- Private bucket for before/after photos (never public; served through /api/graffiti/photo/<name>).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('graffiti', 'graffiti', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

-- The bucket also holds the owner's invoice spreadsheet template (under templates/), so allow .xlsx too.
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
 where id = 'graffiti';
