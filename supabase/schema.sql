-- Mishwaar database. Run once in the Supabase SQL editor.
-- Accounts use Supabase Auth (email + password). Name, phone and role live in user_metadata
-- and are copied into public.profiles by a trigger.

-- =====================================================================
-- Places added by people using the app (OpenStreetMap places are not stored here)
-- =====================================================================
create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('bus', 'moto')),
  kind text not null check (kind in ('bus_station', 'bus_stop', 'bus_place', 'motorcycle_shop', 'motorcycle_repair', 'motorcycle_parts', 'moto_place')),
  name text not null default '' check (char_length(name) <= 120),
  lat double precision not null check (lat between 12 and 19.1),
  lng double precision not null check (lng between 41.8 and 54.7),
  governorate text not null,
  created_by uuid not null references auth.users (id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists places_category_idx on public.places (category);

-- One rating (1–5 stars) per person per place. place_id is 'osm:n123…' or 'user:<uuid>'.
create table if not exists public.ratings (
  place_id text not null check (place_id ~ '^(osm:[nwr][0-9]+|user:[0-9a-f-]{36})$'),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  stars smallint not null check (stars between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (place_id, user_id)
);

create or replace view public.place_rating_summary
with (security_invoker = true) as
  select place_id, round(avg(stars)::numeric, 2) as avg_stars, count(*)::int as count
  from public.ratings
  group by place_id;

alter table public.places enable row level security;
alter table public.ratings enable row level security;

-- Anyone (even signed out) can read places and ratings, so the map works for everyone.
create policy "places are public" on public.places for select using (true);
create policy "ratings are public" on public.ratings for select using (true);

-- Signed-in people add places as themselves and can fix or remove their own.
create policy "add own places" on public.places for insert to authenticated with check (created_by = auth.uid());
create policy "edit own places" on public.places for update to authenticated using (created_by = auth.uid());
create policy "delete own places" on public.places for delete to authenticated using (created_by = auth.uid());

-- Signed-in people rate as themselves; re-rating replaces their earlier stars.
create policy "add own rating" on public.ratings for insert to authenticated with check (user_id = auth.uid());
create policy "change own rating" on public.ratings for update to authenticated using (user_id = auth.uid());
create policy "remove own rating" on public.ratings for delete to authenticated using (user_id = auth.uid());

grant select on public.place_rating_summary to anon, authenticated;

-- =====================================================================
-- Roads people draw (paths missing from the base map)
-- =====================================================================
create table if not exists public.roads (
  id uuid primary key default gen_random_uuid(),
  name text not null default '' check (char_length(name) <= 120),
  points jsonb not null check (jsonb_typeof(points) = 'array' and jsonb_array_length(points) between 2 and 500),
  governorate text not null,
  created_by uuid not null references auth.users (id) on delete cascade default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.roads enable row level security;
create policy "roads are public" on public.roads for select using (true);
create policy "add own roads" on public.roads for insert to authenticated with check (created_by = auth.uid());
create policy "edit own roads" on public.roads for update to authenticated using (created_by = auth.uid());
create policy "delete own roads" on public.roads for delete to authenticated using (created_by = auth.uid());

-- =====================================================================
-- Taxi
-- =====================================================================

-- One row per account, filled from the sign-up form (name, phone, role).
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  phone text not null default '',
  role text not null default 'rider' check (role in ('rider', 'driver')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "read own profile" on public.profiles for select to authenticated using (id = auth.uid());

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, phone, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    case when new.raw_user_meta_data->>'role' = 'driver' then 'driver' else 'rider' end
  )
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Drivers: car details and identity document. An admin approves them:
-- Table editor → drivers → set status to 'approved' (or 'rejected').
create table if not exists public.drivers (
  id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  phone text not null,
  car_model text not null,
  car_color text not null default '',
  plate text not null,
  doc_type text not null check (doc_type in ('national_id', 'passport')),
  doc_number text not null,
  doc_path text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  online boolean not null default false,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.drivers enable row level security;
create policy "read own driver row" on public.drivers for select to authenticated using (id = auth.uid());
create policy "register as driver" on public.drivers for insert to authenticated with check (id = auth.uid() and status = 'pending' and online = false);
create policy "update own driver row" on public.drivers for update to authenticated using (id = auth.uid());

-- Drivers can't approve themselves or go online before approval.
create or replace function public.guard_driver_update() returns trigger
language plpgsql as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user <> 'postgres' then
    if new.status is distinct from old.status then
      new.status := case when old.status = 'rejected' then 'pending' else old.status end;
    end if;
    if new.online and new.status <> 'approved' then
      raise exception 'mishwaar: لم تتم الموافقة على حسابك كسائق بعد.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_driver_update on public.drivers;
create trigger guard_driver_update before update on public.drivers for each row execute function public.guard_driver_update();

create or replace function public.is_approved_driver(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.drivers where id = uid and status = 'approved')
$$;

-- Ride requests. Names, phones and car details are copied in when the ride changes hands,
-- so each side sees only what they need (phone numbers only after a driver accepts).
create table if not exists public.rides (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'requested' check (status in ('requested', 'accepted', 'arrived', 'completed', 'cancelled')),
  customer_id uuid not null references auth.users (id) on delete cascade,
  customer_name text not null default '',
  customer_phone text not null default '',
  driver_id uuid references auth.users (id) on delete set null,
  driver_name text not null default '',
  driver_phone text not null default '',
  driver_car text not null default '',
  driver_plate text not null default '',
  pickup_lat double precision not null check (pickup_lat between 12 and 19.1),
  pickup_lng double precision not null check (pickup_lng between 41.8 and 54.7),
  pickup_note text not null default '' check (char_length(pickup_note) <= 200),
  destination text not null default '' check (char_length(destination) <= 200),
  driver_lat double precision,
  driver_lng double precision,
  cancel_reason text not null default '',
  cancelled_by text check (cancelled_by in ('customer', 'driver')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  arrived_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists rides_open_idx on public.rides (created_at) where status = 'requested';
create index if not exists rides_customer_idx on public.rides (customer_id, created_at desc);
create index if not exists rides_driver_idx on public.rides (driver_id, created_at desc);
alter table public.rides enable row level security;
-- Riders see their rides; approved drivers also see open requests from the last 30 minutes.
create policy "see own rides and open requests" on public.rides for select to authenticated using (
  customer_id = auth.uid() or driver_id = auth.uid()
  or (status = 'requested' and created_at > now() - interval '30 minutes' and public.is_approved_driver(auth.uid()))
);
-- No insert/update policies: every change goes through the functions below.

create table if not exists public.ride_messages (
  id bigint generated always as identity primary key,
  ride_id uuid not null references public.rides (id) on delete cascade,
  sender_id uuid references auth.users (id) on delete set null default auth.uid(),
  kind text not null default 'text' check (kind in ('text', 'system')),
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists ride_messages_ride_idx on public.ride_messages (ride_id, created_at);
alter table public.ride_messages enable row level security;
create policy "ride parties read messages" on public.ride_messages for select to authenticated using (
  exists (select 1 from public.rides r where r.id = ride_id and (r.customer_id = auth.uid() or r.driver_id = auth.uid()))
);
create policy "ride parties send messages" on public.ride_messages for insert to authenticated with check (
  sender_id = auth.uid() and kind = 'text'
  and exists (select 1 from public.rides r where r.id = ride_id and r.status in ('accepted', 'arrived')
              and (r.customer_id = auth.uid() or r.driver_id = auth.uid()))
);

-- ---------- ride actions ----------
create or replace function public.request_ride(p_lat double precision, p_lng double precision, p_note text, p_destination text)
returns public.rides language plpgsql security definer set search_path = public as $$
declare r public.rides; prof public.profiles;
begin
  if auth.uid() is null then raise exception 'mishwaar: سجّل الدخول أولًا.'; end if;
  if exists (select 1 from rides where customer_id = auth.uid() and status in ('requested', 'accepted', 'arrived')) then
    raise exception 'mishwaar: لديك طلب جارٍ بالفعل.';
  end if;
  select * into prof from profiles where id = auth.uid();
  insert into rides (customer_id, customer_name, pickup_lat, pickup_lng, pickup_note, destination)
  values (auth.uid(), coalesce(prof.name, ''), p_lat, p_lng, left(coalesce(p_note, ''), 200), left(coalesce(p_destination, ''), 200))
  returning * into r;
  return r;
end $$;

-- First driver to accept wins: the update only matches while the ride is still 'requested'.
create or replace function public.accept_ride(p_ride uuid)
returns public.rides language plpgsql security definer set search_path = public as $$
declare r public.rides; d public.drivers; prof public.profiles; cust public.profiles;
begin
  select * into d from drivers where id = auth.uid() and status = 'approved';
  if not found then raise exception 'mishwaar: حسابك كسائق غير مفعّل بعد.'; end if;
  if exists (select 1 from rides where driver_id = auth.uid() and status in ('accepted', 'arrived')) then
    raise exception 'mishwaar: أنهِ رحلتك الحالية أولًا.';
  end if;
  select * into prof from profiles where id = auth.uid();
  update rides set status = 'accepted', driver_id = auth.uid(), driver_name = coalesce(prof.name, ''),
    driver_phone = d.phone, driver_car = concat_ws(' · ', nullif(d.car_model, ''), nullif(d.car_color, '')), driver_plate = d.plate,
    driver_lat = d.lat, driver_lng = d.lng, accepted_at = now(), updated_at = now(), cancel_reason = '', cancelled_by = null
  where id = p_ride and status = 'requested' and customer_id <> auth.uid()
  returning * into r;
  if not found then return null; end if; -- another driver got there first
  select * into cust from profiles where id = r.customer_id;
  update rides set customer_phone = coalesce(cust.phone, '') where id = r.id returning * into r;
  insert into ride_messages (ride_id, sender_id, kind, body) values (r.id, null, 'system', 'قبل ' || r.driver_name || ' الطلب وهو في الطريق.');
  return r;
end $$;

-- Rider cancels: the ride ends. Driver cancels: the request opens again for other drivers.
create or replace function public.cancel_ride(p_ride uuid, p_reason text)
returns public.rides language plpgsql security definer set search_path = public as $$
declare r public.rides; reason text := left(coalesce(nullif(trim(p_reason), ''), 'بدون سبب'), 300);
begin
  select * into r from rides where id = p_ride and status in ('requested', 'accepted', 'arrived') for update;
  if not found then raise exception 'mishwaar: هذا الطلب لم يعد جاريًا.'; end if;
  if r.customer_id = auth.uid() then
    update rides set status = 'cancelled', cancel_reason = reason, cancelled_by = 'customer', updated_at = now() where id = r.id returning * into r;
    insert into ride_messages (ride_id, sender_id, kind, body) values (r.id, null, 'system', 'ألغى الراكب الطلب: ' || reason);
  elsif r.driver_id = auth.uid() then
    insert into ride_messages (ride_id, sender_id, kind, body) values (r.id, null, 'system', 'ألغى السائق ' || r.driver_name || ': ' || reason);
    update rides set status = 'requested', driver_id = null, driver_name = '', driver_phone = '', driver_car = '', driver_plate = '',
      driver_lat = null, driver_lng = null, customer_phone = '', accepted_at = null,
      cancel_reason = reason, cancelled_by = 'driver', created_at = now(), updated_at = now()
    where id = r.id returning * into r;
  else
    raise exception 'mishwaar: لا يمكنك إلغاء هذا الطلب.';
  end if;
  return r;
end $$;

create or replace function public.mark_arrived(p_ride uuid)
returns public.rides language plpgsql security definer set search_path = public as $$
declare r public.rides;
begin
  update rides set status = 'arrived', arrived_at = now(), updated_at = now()
  where id = p_ride and driver_id = auth.uid() and status = 'accepted' returning * into r;
  if found then insert into ride_messages (ride_id, sender_id, kind, body) values (r.id, null, 'system', 'وصل السائق إلى مكان الراكب.'); end if;
  return r;
end $$;

create or replace function public.complete_ride(p_ride uuid)
returns public.rides language plpgsql security definer set search_path = public as $$
declare r public.rides;
begin
  update rides set status = 'completed', completed_at = now(), updated_at = now()
  where id = p_ride and status = 'arrived' and (driver_id = auth.uid() or customer_id = auth.uid()) returning * into r;
  if found then insert into ride_messages (ride_id, sender_id, kind, body) values (r.id, null, 'system', 'انتهت الرحلة.'); end if;
  return r;
end $$;

-- Driver's live position: on their driver row, and on the ride while it's active.
create or replace function public.update_driver_position(p_lat double precision, p_lng double precision, p_ride uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update drivers set lat = p_lat, lng = p_lng, updated_at = now() where id = auth.uid();
  if p_ride is not null then
    update rides set driver_lat = p_lat, driver_lng = p_lng where id = p_ride and driver_id = auth.uid() and status in ('accepted', 'arrived');
  end if;
end $$;

revoke all on function public.request_ride, public.accept_ride, public.cancel_ride, public.mark_arrived,
  public.complete_ride, public.update_driver_position from public, anon;
grant execute on function public.request_ride, public.accept_ride, public.cancel_ride, public.mark_arrived,
  public.complete_ride, public.update_driver_position to authenticated;

-- Live updates in the app
alter publication supabase_realtime add table public.rides, public.ride_messages;

-- ---------- push notifications ----------
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create policy "manage own push subscriptions" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- identity documents (private storage; only the driver and admins can see them) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('driver-docs', 'driver-docs', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;
create policy "drivers upload own documents" on storage.objects for insert to authenticated
  with check (bucket_id = 'driver-docs' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "drivers read own documents" on storage.objects for select to authenticated
  using (bucket_id = 'driver-docs' and (storage.foldername(name))[1] = auth.uid()::text);
