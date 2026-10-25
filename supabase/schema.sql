-- Cap Ouest : schéma Supabase (à exécuter dans SQL Editor du projet Supabase)
-- Chaque voyage appartient à un utilisateur connecté ; les règles RLS empêchent
-- quiconque d'autre de lire ou modifier ses données.

create table if not exists trips (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null default 'Voyage Ouest',
  start_date  date not null,
  updated_at  timestamptz not null default now()
);

create table if not exists steps (
  id          uuid primary key,
  trip_id     uuid not null references trips(id) on delete cascade,
  position    int  not null,
  name        text not null,
  lat         double precision not null,
  lng         double precision not null,
  type        text not null check (type in ('start', 'b', 'c', 'dest')),
  nights      int  not null default 0 check (nights >= 0),
  updated_at  timestamptz not null default now()
);
create index if not exists steps_trip_idx on steps(trip_id, position);

alter table trips enable row level security;
alter table steps enable row level security;

create policy "trips: propriétaire" on trips
  for all using (owner = auth.uid()) with check (owner = auth.uid());

create policy "steps: propriétaire du voyage" on steps
  for all using (exists (select 1 from trips t where t.id = trip_id and t.owner = auth.uid()))
  with check (exists (select 1 from trips t where t.id = trip_id and t.owner = auth.uid()));
