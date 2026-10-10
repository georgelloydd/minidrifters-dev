-- Mini Drifters: complete Supabase setup (game + admin). Paste into Supabase -> SQL Editor and press Run.
-- Works on an empty project and is safe to run again. The admin secret is never stored, only its SHA-256 hash.
create extension if not exists pgcrypto with schema extensions;
grant usage on schema public to anon;

-- ===== tables =====
create table if not exists public.profiles (id text primary key, data jsonb not null, updated_at timestamptz default now());

-- one row per player per track: their best lap. Faster laps replace it (see submit_lap).
create table if not exists public.laps (
  id bigint generated always as identity primary key,
  track int not null, pid text not null, name text, color text, body text,
  lap_ms int not null check (lap_ms > 3000), score int, created_at timestamptz default now(),
  unique (track, pid));
create index if not exists laps_track_ms on public.laps (track, lap_ms);
alter table public.laps add column if not exists replay text;   -- ghost replay of the lap

-- admin 'troll' handling tweaks per player (read by the game, written only by the dev dashboard)
create table if not exists public.player_tweaks (pid text primary key, data jsonb not null, updated_at timestamptz default now());

create table if not exists public.player_keys (pid text primary key, key text not null, name text,
  created_at timestamptz default now(), updated_at timestamptz default now());

create table if not exists public.admin_config (id int primary key default 1, secret_hash text not null);
insert into public.admin_config (id, secret_hash) values (1, '__HASH__')
  on conflict (id) do update set secret_hash = excluded.secret_hash;

-- ===== access rules =====
alter table public.profiles enable row level security;
alter table public.laps enable row level security;
alter table public.player_keys enable row level security;   -- no policies = no public access
alter table public.admin_config enable row level security;  -- no policies = no public access
alter table public.player_tweaks enable row level security;
drop policy if exists "read tweaks" on public.player_tweaks;
create policy "read tweaks" on public.player_tweaks for select using (true);
grant select on public.player_tweaks to anon;

drop policy if exists "read laps" on public.laps;
drop policy if exists "add laps" on public.laps;
drop policy if exists "read profile" on public.profiles;
drop policy if exists "save profile" on public.profiles;
drop policy if exists "update profile" on public.profiles;
create policy "read laps" on public.laps for select using (true);           -- laps are only written through submit_lap
create policy "read profile" on public.profiles for select using (true);
create policy "save profile" on public.profiles for insert with check (true);
create policy "update profile" on public.profiles for update using (true);
grant select on public.laps to anon;
grant select, insert, update on public.profiles to anon;

-- ===== game functions =====
-- save a lap: adds the player's time, or replaces it only if the new lap is faster
create or replace function public.submit_lap(p_track int, p_pid text, p_name text, p_color text, p_body text, p_lap_ms int, p_score int)
returns void language sql security definer set search_path = public as $$
  insert into laps (track, pid, name, color, body, lap_ms, score)
  values (p_track, left(p_pid, 24), left(p_name, 14), left(p_color, 24), left(p_body, 24), p_lap_ms, p_score)
  on conflict (track, pid) do update
    set lap_ms = excluded.lap_ms, score = excluded.score, name = excluded.name, color = excluded.color, body = excluded.body, replay = null, created_at = now()
    where excluded.lap_ms < laps.lap_ms;
$$;

-- name changes: only the owner of an account key can rename their leaderboard times
create or replace function public.rename_player(p_key text, p_name text) returns void
language sql security definer set search_path = public, extensions as $$
  update public.laps set name = left(btrim(p_name), 14)
  where pid = left(encode(extensions.digest('pub:' || p_key, 'sha256'), 'hex'), 24)
    and length(btrim(p_name)) between 2 and 14;
$$;

-- paint changes: only the owner of an account key can recolour their leaderboard times
create or replace function public.set_color(p_key text, p_color text) returns void
language sql security definer set search_path = public, extensions as $$
  update public.laps set color = left(p_color, 24)
  where pid = left(encode(extensions.digest('pub:' || p_key, 'sha256'), 'hex'), 24)
    and p_color ~ '^#[0-9a-fA-F]{6}$';
$$;
grant execute on function public.set_color(text, text) to anon;

-- remembers account keys so a forgotten key can be looked up by name on the dev dashboard
create or replace function public.register_key(p_key text, p_name text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_key !~ '^MD-[A-Z0-9][A-Z0-9-]{1,30}[A-Z0-9]$' then return; end if;
  insert into player_keys (pid, key, name) values (substr(encode(digest('pub:' || p_key, 'sha256'), 'hex'), 1, 24), p_key, left(coalesce(p_name, ''), 14))
  on conflict (pid) do update set name = excluded.name, updated_at = now();
end $$;

-- ===== admin functions (dev dashboard) =====
create or replace function public.md_is_admin(p_secret text) returns boolean
language sql security definer set search_path = public, extensions as $$
  select exists (select 1 from admin_config where id = 1 and secret_hash = encode(digest(coalesce(p_secret, ''), 'sha256'), 'hex'));
$$;

create or replace function public.admin_check(p_secret text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not md_is_admin(p_secret) then perform pg_sleep(1); return false; end if;  -- slows down guessing
  return true;
end $$;

create or replace function public.admin_find_players(p_secret text, p_query text)
returns table (pid text, key text, name text, created_at timestamptz, updated_at timestamptz, best_ms int, laps bigint)
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not md_is_admin(p_secret) then perform pg_sleep(1); raise exception 'not allowed'; end if;
  return query select k.pid, k.key, k.name, k.created_at, k.updated_at,
    (select min(l.lap_ms)::int from laps l where l.pid = k.pid), (select count(*) from laps l where l.pid = k.pid)
  from player_keys k
  where coalesce(p_query, '') = '' or k.name ilike '%' || p_query || '%' or k.pid ilike p_query || '%' or k.key ilike '%' || p_query || '%'
  order by k.updated_at desc limit 200;
end $$;

create or replace function public.admin_rename(p_secret text, p_pid text, p_name text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not md_is_admin(p_secret) then raise exception 'not allowed'; end if;
  update player_keys set name = left(p_name, 14), updated_at = now() where pid = p_pid;
  update laps set name = left(p_name, 14) where pid = p_pid;
end $$;

create or replace function public.admin_delete_lap(p_secret text, p_id bigint) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not md_is_admin(p_secret) then raise exception 'not allowed'; end if;
  delete from laps where id = p_id;
end $$;

create or replace function public.admin_clear_track(p_secret text, p_track int) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not md_is_admin(p_secret) then raise exception 'not allowed'; end if;
  delete from laps where track = p_track;
end $$;

-- Purge all: deletes every lap time on every track
create or replace function public.admin_purge_all(p_secret text) returns bigint
language plpgsql security definer set search_path = public, extensions as $$
declare n bigint;
begin
  if not md_is_admin(p_secret) then perform pg_sleep(1); raise exception 'not allowed'; end if;
  delete from laps where true; get diagnostics n = row_count; return n;
end $$;

-- same as above but also stores the lap's ghost replay
create or replace function public.submit_lap(p_track int, p_pid text, p_name text, p_color text, p_body text, p_lap_ms int, p_score int, p_replay text)
returns void language sql security definer set search_path = public as $$
  insert into laps (track, pid, name, color, body, lap_ms, score, replay)
  values (p_track, left(p_pid, 24), left(p_name, 14), left(p_color, 24), left(p_body, 24), p_lap_ms, p_score, left(p_replay, 200000))
  on conflict (track, pid) do update
    set lap_ms = excluded.lap_ms, score = excluded.score, name = excluded.name, color = excluded.color, body = excluded.body, replay = excluded.replay, created_at = now()
    where excluded.lap_ms < laps.lap_ms;
$$;

-- every player: account keys joined with saved profiles (and their troll tweaks)
create or replace function public.admin_list_players(p_secret text)
returns table (pid text, key text, name text, profile_id text, data jsonb, tweaks jsonb, created_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  if not md_is_admin(p_secret) then perform pg_sleep(1); raise exception 'not allowed'; end if;
  return query
  with kk as (select k.pid as kpid, k.key as kkey, k.name as kname, k.created_at as kc, k.updated_at as ku, encode(digest('priv:' || k.key, 'sha256'), 'hex') as priv from player_keys k)
  select kk.kpid, kk.kkey, coalesce(kk.kname, p.data->'cfg'->>'name'), p.id, p.data, t.data, coalesce(kk.kc, p.updated_at), greatest(kk.ku, p.updated_at)
  from kk full outer join profiles p on p.id = kk.priv
  left join player_tweaks t on t.pid = kk.kpid
  order by greatest(kk.ku, p.updated_at) desc nulls last limit 5000;
end $$;

-- edit a player's name (everywhere) and/or their raw profile
create or replace function public.admin_save_player(p_secret text, p_pid text, p_profile_id text, p_name text, p_data jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not md_is_admin(p_secret) then raise exception 'not allowed'; end if;
  if p_pid is not null and coalesce(btrim(p_name), '') <> '' then
    update player_keys set name = left(btrim(p_name), 14), updated_at = now() where pid = p_pid;
    update laps set name = left(btrim(p_name), 14) where pid = p_pid;
  end if;
  if p_profile_id is not null and p_data is not null then
    update profiles set data = p_data, updated_at = now() where id = p_profile_id;
  end if;
end $$;

-- give a player a new key: moves their times, profile and tweaks over to it
create or replace function public.admin_change_key(p_secret text, p_pid text, p_new_key text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare old_key text; np text; npriv text; op text;
begin
  if not md_is_admin(p_secret) then raise exception 'not allowed'; end if;
  if p_new_key !~ '^MD-[A-Z0-9][A-Z0-9-]{1,30}[A-Z0-9]$' then raise exception 'Key must start with MD- then 3 to 32 letters, numbers or dashes'; end if;
  select k.key into old_key from player_keys k where k.pid = p_pid; if old_key is null then raise exception 'Player not found'; end if;
  np := substr(encode(digest('pub:' || p_new_key, 'sha256'), 'hex'), 1, 24);
  npriv := encode(digest('priv:' || p_new_key, 'sha256'), 'hex'); op := encode(digest('priv:' || old_key, 'sha256'), 'hex');
  if np = p_pid then return np; end if;
  if exists (select 1 from player_keys k where k.pid = np) then raise exception 'That key already belongs to another player'; end if;
  delete from laps where pid = np; delete from profiles where id = npriv; delete from player_tweaks where pid = np;
  update laps set pid = np where pid = p_pid;
  update profiles set id = npriv where id = op;
  update player_tweaks set pid = np where pid = p_pid;
  update player_keys set pid = np, key = p_new_key, updated_at = now() where pid = p_pid;
  return np;
end $$;

-- delete a player completely: key, profile, tweaks and all their lap times
create or replace function public.admin_delete_player(p_secret text, p_pid text, p_profile_id text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not md_is_admin(p_secret) then raise exception 'not allowed'; end if;
  if p_pid is not null then
    delete from laps where pid = p_pid; delete from player_tweaks where pid = p_pid; delete from player_keys where pid = p_pid;
  end if;
  if p_profile_id is not null then delete from profiles where id = p_profile_id; end if;
end $$;

-- troll tab: set (or with null, reset) a player's handling tweaks
create or replace function public.admin_set_tweaks(p_secret text, p_pid text, p_data jsonb) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not md_is_admin(p_secret) then raise exception 'not allowed'; end if;
  if p_data is null or p_data = '{}'::jsonb then delete from player_tweaks where pid = p_pid;
  else insert into player_tweaks (pid, data) values (p_pid, p_data) on conflict (pid) do update set data = excluded.data, updated_at = now(); end if;
end $$;

-- ===== who can call what =====
revoke all on function public.md_is_admin(text) from public, anon, authenticated;
grant execute on function public.submit_lap(int, text, text, text, text, int, int) to anon;
grant execute on function public.rename_player(text, text) to anon;
grant execute on function public.register_key(text, text) to anon;
grant execute on function public.admin_check(text) to anon;
grant execute on function public.admin_find_players(text, text) to anon;
grant execute on function public.admin_rename(text, text, text) to anon;
grant execute on function public.admin_delete_lap(text, bigint) to anon;
grant execute on function public.admin_clear_track(text, int) to anon;
grant execute on function public.admin_purge_all(text) to anon;
grant execute on function public.submit_lap(int, text, text, text, text, int, int, text) to anon;
grant execute on function public.admin_list_players(text) to anon;
grant execute on function public.admin_save_player(text, text, text, text, jsonb) to anon;
grant execute on function public.admin_change_key(text, text, text) to anon;
grant execute on function public.admin_delete_player(text, text, text) to anon;
grant execute on function public.admin_set_tweaks(text, text, jsonb) to anon;


-- ===== unique driver names (case-insensitive). 'Driver' is kept for guests =====
create or replace function public.name_available(p_name text, p_key text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select length(btrim(coalesce(p_name, ''))) between 2 and 14
    and lower(btrim(p_name)) !~ '^driver[0-9]*$'
    and not exists (select 1 from player_keys k where lower(btrim(k.name)) = lower(btrim(p_name))
      and k.pid <> left(encode(extensions.digest('pub:' || coalesce(p_key, ''), 'sha256'), 'hex'), 24))
    and not exists (select 1 from laps l where lower(btrim(l.name)) = lower(btrim(p_name))
      and l.pid <> left(encode(extensions.digest('pub:' || coalesce(p_key, ''), 'sha256'), 'hex'), 24));
$$;

create or replace function public.rename_player(p_key text, p_name text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.name_available(p_name, p_key) then raise exception 'That name is already taken' using errcode = '23505'; end if;
  update public.laps set name = left(btrim(p_name), 14)
  where pid = left(encode(extensions.digest('pub:' || p_key, 'sha256'), 'hex'), 24);
  update public.player_keys set name = left(btrim(p_name), 14), updated_at = now()
  where pid = left(encode(extensions.digest('pub:' || p_key, 'sha256'), 'hex'), 24);
end $$;

create or replace function public.register_key(p_key text, p_name text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_key !~ '^MD-[A-Z0-9][A-Z0-9-]{1,30}[A-Z0-9]$' then return; end if;
  if not public.name_available(p_name, p_key) then raise exception 'That name is already taken' using errcode = '23505'; end if;
  insert into player_keys (pid, key, name) values (substr(encode(digest('pub:' || p_key, 'sha256'), 'hex'), 1, 24), p_key, left(btrim(p_name), 14))
  on conflict (pid) do update set name = excluded.name, updated_at = now();
end $$;

grant execute on function public.name_available(text, text) to anon;
grant execute on function public.rename_player(text, text) to anon;
grant execute on function public.register_key(text, text) to anon;

-- ===== Track submissions (minidrifters/build -> dev dashboard Review tab) =====
create table if not exists public.track_submissions (id bigserial primary key, pid text not null, author text, name text not null,
  def jsonb not null, status text not null default 'pending', note text, created_at timestamptz default now());
alter table public.track_submissions enable row level security;

create or replace function public.submit_track(p_key text, p_name text, p_def jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare k record; nid bigint;
begin
  select pid, name into k from player_keys where key = p_key; if not found then raise exception 'Sign in to submit tracks.'; end if;
  if (select count(*) from track_submissions where pid = k.pid and status = 'pending') >= 5 then raise exception 'You already have 5 tracks waiting for review.'; end if;
  if length(trim(coalesce(p_name, ''))) < 1 or length(p_def::text) > 20000 or jsonb_typeof(p_def->'pts') <> 'array'
     or jsonb_array_length(p_def->'pts') < 4 or jsonb_array_length(p_def->'pts') > 200 then raise exception 'That track is not valid.'; end if;
  insert into track_submissions (pid, author, name, def) values (k.pid, k.name, left(trim(p_name), 40), p_def) returning id into nid;
  return nid;
end $$;

create or replace function public.my_submissions(p_key text) returns table (id bigint, name text, status text, note text, created_at timestamptz)
language sql security definer set search_path = public as $$
  select s.id, s.name, s.status, s.note, s.created_at from track_submissions s join player_keys k on k.pid = s.pid
  where k.key = p_key order by s.created_at desc limit 30;
$$;

create or replace function public.admin_list_submissions(p_secret text) returns setof public.track_submissions
language plpgsql security definer set search_path = public as $$
begin
  if not md_is_admin(p_secret) then raise exception 'not allowed'; end if;
  return query select * from track_submissions order by (status = 'pending') desc, created_at desc limit 200;
end $$;

create or replace function public.admin_set_submission(p_secret text, p_id bigint, p_status text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not md_is_admin(p_secret) then raise exception 'not allowed'; end if;
  if p_status = 'delete' then delete from track_submissions where id = p_id; return; end if;
  update track_submissions set status = p_status, note = p_note where id = p_id;
end $$;

grant execute on function public.submit_track(text, text, jsonb) to anon;
grant execute on function public.my_submissions(text) to anon;
grant execute on function public.admin_list_submissions(text) to anon;
grant execute on function public.admin_set_submission(text, bigint, text, text) to anon;

notify pgrst, 'reload schema';
