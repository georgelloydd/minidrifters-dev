-- Mini Drifters admin tools. Run once in Supabase → SQL Editor (after the game's own README SQL).
-- The admin secret itself is never stored: only its SHA-256 hash. Nothing in these tables is readable
-- with the public key; the admin functions check the secret on the server before returning anything.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.admin_config (id int primary key default 1, secret_hash text not null);
alter table public.admin_config enable row level security;   -- no policies = no public access
insert into public.admin_config (id, secret_hash) values (1, '__HASH__')
  on conflict (id) do update set secret_hash = excluded.secret_hash;

-- player keys, so a forgotten key can be looked up by name (filled in by the game when a player opens it)
create table if not exists public.player_keys (pid text primary key, key text not null, name text,
  created_at timestamptz default now(), updated_at timestamptz default now());
alter table public.player_keys enable row level security;    -- no policies = no public access

create or replace function public.register_key(p_key text, p_name text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_key !~ '^MD-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$' then return; end if;
  insert into player_keys (pid, key, name) values (substr(encode(digest('pub:' || p_key, 'sha256'), 'hex'), 1, 24), p_key, left(coalesce(p_name, ''), 14))
  on conflict (pid) do update set name = excluded.name, updated_at = now();
end $$;

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

revoke all on function public.md_is_admin(text) from public, anon, authenticated;
grant execute on function public.register_key(text, text) to anon;
grant execute on function public.admin_check(text) to anon;
grant execute on function public.admin_find_players(text, text) to anon;
grant execute on function public.admin_rename(text, text, text) to anon;
grant execute on function public.admin_delete_lap(text, bigint) to anon;
grant execute on function public.admin_clear_track(text, int) to anon;
