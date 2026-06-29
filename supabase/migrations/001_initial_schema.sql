-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Profiles (extends auth.users)
create table profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  username text unique not null,
  full_name text,
  avatar_url text,
  bio text,
  bike_model text,
  created_at timestamptz default now() not null
);

alter table profiles enable row level security;

create policy "Profiles are viewable by everyone" on profiles for select using (true);
create policy "Users can insert their own profile" on profiles for insert with check (auth.uid() = id);
create policy "Users can update their own profile" on profiles for update using (auth.uid() = id);

-- Clubs
create table clubs (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  description text,
  avatar_url text,
  is_public boolean default true not null,
  owner_id uuid references profiles(id) on delete cascade not null,
  created_at timestamptz default now() not null
);

alter table clubs enable row level security;

create policy "Public clubs are viewable by everyone" on clubs for select using (is_public = true or owner_id = auth.uid());
create policy "Authenticated users can create clubs" on clubs for insert with check (auth.uid() = owner_id);
create policy "Club owners can update" on clubs for update using (auth.uid() = owner_id);
create policy "Club owners can delete" on clubs for delete using (auth.uid() = owner_id);

-- Club members
create table club_members (
  club_id uuid references clubs(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  role text check (role in ('owner', 'admin', 'member')) default 'member' not null,
  joined_at timestamptz default now() not null,
  primary key (club_id, user_id)
);

alter table club_members enable row level security;

create policy "Club members are viewable by everyone" on club_members for select using (true);
create policy "Users can join clubs" on club_members for insert with check (auth.uid() = user_id);
create policy "Users can leave clubs" on club_members for delete using (auth.uid() = user_id);

-- Rides
create table rides (
  id uuid default uuid_generate_v4() primary key,
  title text not null,
  description text,
  route_description text,
  meeting_point text not null,
  departure_at timestamptz not null,
  max_riders int,
  is_public boolean default true not null,
  club_id uuid references clubs(id) on delete set null,
  organizer_id uuid references profiles(id) on delete cascade not null,
  created_at timestamptz default now() not null
);

alter table rides enable row level security;

create policy "Public rides are viewable by everyone" on rides for select using (is_public = true or organizer_id = auth.uid());
create policy "Authenticated users can create rides" on rides for insert with check (auth.uid() = organizer_id);
create policy "Organizers can update rides" on rides for update using (auth.uid() = organizer_id);
create policy "Organizers can delete rides" on rides for delete using (auth.uid() = organizer_id);

-- Ride members
create table ride_members (
  ride_id uuid references rides(id) on delete cascade not null,
  user_id uuid references profiles(id) on delete cascade not null,
  status text check (status in ('going', 'maybe')) default 'going' not null,
  joined_at timestamptz default now() not null,
  primary key (ride_id, user_id)
);

alter table ride_members enable row level security;

create policy "Ride members are viewable by everyone" on ride_members for select using (true);
create policy "Users can join rides" on ride_members for insert with check (auth.uid() = user_id);
create policy "Users can update their ride status" on ride_members for update using (auth.uid() = user_id);
create policy "Users can leave rides" on ride_members for delete using (auth.uid() = user_id);

-- Friendships
create table friendships (
  id uuid default uuid_generate_v4() primary key,
  requester_id uuid references profiles(id) on delete cascade not null,
  addressee_id uuid references profiles(id) on delete cascade not null,
  status text check (status in ('pending', 'accepted')) default 'pending' not null,
  created_at timestamptz default now() not null,
  unique(requester_id, addressee_id)
);

alter table friendships enable row level security;

create policy "Users can view their own friendships" on friendships for select using (auth.uid() = requester_id or auth.uid() = addressee_id);
create policy "Users can send friend requests" on friendships for insert with check (auth.uid() = requester_id);
create policy "Addressees can accept requests" on friendships for update using (auth.uid() = addressee_id);
create policy "Users can remove friendships" on friendships for delete using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, username, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();
