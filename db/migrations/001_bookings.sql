-- Court bookings table, booking rules and row-level security.
-- Run this once in the Neon SQL editor, then refresh the Data API schema.
--
-- Booking rules (also mirrored in src/config.ts for the UI):
--   * courts c1..c4, 1-hour slots starting 07:00..20:00, club time America/New_York
--   * no bookings for slots that have already started
--   * bookings open 14 days in advance (today + 13)
--   * at most 2 bookings per user per day
--   * one booking per court/slot

create table if not exists public.bookings (
  id          uuid primary key default gen_random_uuid(),
  court_id    text not null check (court_id in ('c1', 'c2', 'c3', 'c4')),
  date        date not null,
  hour        smallint not null check (hour between 7 and 20),
  user_id     text not null default auth.user_id(),
  user_name   text not null default '',
  created_at  timestamptz not null default now(),
  constraint bookings_slot_unique unique (court_id, date, hour)
);

create index if not exists bookings_user_date_idx on public.bookings (user_id, date);

-- Rules enforced on insert. SECURITY DEFINER so it can read neon_auth."user"
-- for the display name; identity always comes from the JWT, never the client.
create or replace function public.bookings_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  club_tz constant text := 'America/New_York';
  club_today date := (now() at time zone club_tz)::date;
  existing int;
begin
  new.user_id := auth.user_id();
  if new.user_id is null then
    raise exception 'You must be signed in to book.';
  end if;

  select coalesce(nullif(u.name, ''), u.email)
    into new.user_name
    from neon_auth."user" u
   where u.id::text = new.user_id;
  new.user_name := coalesce(new.user_name, 'Player');

  if ((new.date + make_time(new.hour, 0, 0)) at time zone club_tz) <= now() then
    raise exception 'That slot has already started.';
  end if;

  if new.date > club_today + 13 then
    raise exception 'Bookings open 14 days in advance.';
  end if;

  -- Serialise concurrent bookings by the same user on the same day.
  perform pg_advisory_xact_lock(hashtext(new.user_id || ':' || new.date::text));

  select count(*) into existing
    from public.bookings b
   where b.user_id = new.user_id and b.date = new.date;
  if existing >= 2 then
    raise exception 'You can book at most 2 slots per day.';
  end if;

  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists bookings_before_insert on public.bookings;
create trigger bookings_before_insert
  before insert on public.bookings
  for each row execute function public.bookings_before_insert();

-- Slots that have already started can't be cancelled.
create or replace function public.bookings_before_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if ((old.date + make_time(old.hour, 0, 0)) at time zone 'America/New_York') <= now() then
    raise exception 'That booking has already started and can no longer be cancelled.';
  end if;
  return old;
end;
$$;

drop trigger if exists bookings_before_delete on public.bookings;
create trigger bookings_before_delete
  before delete on public.bookings
  for each row execute function public.bookings_before_delete();

-- Row-level security: everyone signed in sees the schedule; you can only
-- create and cancel your own bookings. No updates.
alter table public.bookings enable row level security;

drop policy if exists bookings_select on public.bookings;
create policy bookings_select on public.bookings
  for select to authenticated
  using (true);

drop policy if exists bookings_insert on public.bookings;
create policy bookings_insert on public.bookings
  for insert to authenticated
  with check (user_id = auth.user_id());

drop policy if exists bookings_delete on public.bookings;
create policy bookings_delete on public.bookings
  for delete to authenticated
  using (user_id = auth.user_id());

revoke all on public.bookings from anon;
revoke all on public.bookings from authenticated;
grant select, insert, delete on public.bookings to authenticated;

revoke all on function public.bookings_before_insert() from public;
