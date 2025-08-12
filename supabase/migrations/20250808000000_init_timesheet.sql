begin;

create extension if not exists "pgcrypto";

-- Master data tables
create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.business_units (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

-- Timesheet entries (textual refs; simple mode)
create table if not exists public.timesheet_entries (
  id text primary key,
  person text not null,
  project text not null,
  business_unit text not null,
  year int not null,
  iso_week int not null,
  week_start date not null,
  mon int default 0,
  tue int default 0,
  wed int default 0,
  thu int default 0,
  fri int default 0,
  sat int default 0,
  sun int default 0,
  total int generated always as (
    coalesce(mon,0)+coalesce(tue,0)+coalesce(wed,0)+coalesce(thu,0)+coalesce(fri,0)
  ) stored,
  notes text default '',
  created_at timestamptz not null default now()
);

-- Helpful indexes
create index if not exists idx_timesheet_entries_year_week on public.timesheet_entries(year, iso_week);
create index if not exists idx_timesheet_entries_created_at on public.timesheet_entries(created_at desc);

-- RLS
alter table public.people enable row level security;
alter table public.projects enable row level security;
alter table public.business_units enable row level security;
alter table public.timesheet_entries enable row level security;

-- Permissive policies (dev/testing). Adjust to your auth model in prod.
create policy "people_select_all" on public.people for select using (true);
create policy "people_insert_all" on public.people for insert with check (true);
create policy "people_update_all" on public.people for update using (true) with check (true);
create policy "people_delete_all" on public.people for delete using (true);

create policy "projects_select_all" on public.projects for select using (true);
create policy "projects_insert_all" on public.projects for insert with check (true);
create policy "projects_update_all" on public.projects for update using (true) with check (true);
create policy "projects_delete_all" on public.projects for delete using (true);

create policy "bus_select_all" on public.business_units for select using (true);
create policy "bus_insert_all" on public.business_units for insert with check (true);
create policy "bus_update_all" on public.business_units for update using (true) with check (true);
create policy "bus_delete_all" on public.business_units for delete using (true);

create policy "ts_select_all" on public.timesheet_entries for select using (true);
create policy "ts_insert_all" on public.timesheet_entries for insert with check (true);
create policy "ts_update_all" on public.timesheet_entries for update using (true) with check (true);
create policy "ts_delete_all" on public.timesheet_entries for delete using (true);

commit;




