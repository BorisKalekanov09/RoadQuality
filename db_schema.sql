-- Roads: registered road segments for monitoring
create table if not exists roads (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  status text check (status in ('idle', 'recording')) default 'idle',
  description text,
  start_lat float,
  start_lng float,
  end_lat float,
  end_lng float,
  created_at timestamptz default now()
);

-- Measurements: aggregated sensor data per recording session
create table if not exists measurements (
  id uuid default gen_random_uuid() primary key,
  road_id uuid references roads(id) on delete cascade,
  quality float check (quality >= 0 and quality <= 1),
  condition text,
  holes_count int check (holes_count >= 0),
  latitude float,
  longitude float,
  timestamp timestamptz default now()
);

-- Workers: linked to Supabase Auth (worker dashboard access)
create table if not exists workers (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  email text,
  created_at timestamptz default now()
);

-- Seed data for testing (optional)
insert into roads (name, status, description, start_lat, start_lng, end_lat, end_lng)
values 
('Partizanska Boulevard', 'idle', 'Main boulevard in Skopje', 41.9992, 21.4168, 42.0012, 21.4325),
('Ilinden Avenue', 'idle', 'Government area road', 41.9985, 21.4250, 42.0005, 21.4400)
;

insert into measurements (road_id, quality, condition, holes_count, latitude, longitude)
select id, 0.84, 'GOOD', 1, start_lat, start_lng from roads where name = 'Partizanska Boulevard' limit 1;

insert into measurements (road_id, quality, condition, holes_count, latitude, longitude)
select id, 0.45, 'POOR', 8, start_lat, start_lng from roads where name = 'Ilinden Avenue' limit 1;

-- Enable RLS
alter table workers enable row level security;

drop policy if exists "Workers can view own profile" on workers;
create policy "Workers can view own profile" on workers
  for select using (auth.uid() = id);

drop policy if exists "Workers can update own profile" on workers;
create policy "Workers can update own profile" on workers
  for update using (auth.uid() = id);

-- Trigger to create worker record on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.workers (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Enable Realtime (ignore error if tables already in publication)
do $$
begin
  alter publication supabase_realtime add table roads;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table measurements;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table workers;
exception when duplicate_object then null;
end $$;
