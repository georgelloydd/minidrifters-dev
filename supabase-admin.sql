

-- ===== Key requests: players who forgot their key ask from the game; the admin approves and the game signs in =====
create table if not exists public.key_requests (
  id bigserial primary key,
  name text not null,
  note text,
  dev text,
  token_hash text not null,
  status text not null default 'pending',
  pid text,
  key text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table public.key_requests enable row level security;

create or replace function public.request_key(p_name text, p_note text, p_dev text, p_token text)
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare n bigint;
begin
  if coalesce(btrim(p_name), '') = '' then raise exception 'Type the name you played as.'; end if;
  if length(coalesce(p_token, '')) < 16 then raise exception 'bad request'; end if;
  if (select count(*) from key_requests r where r.dev = p_dev and r.status = 'pending') >= 3 then
    raise exception 'You already have requests waiting. The admin will get to them soon.';
  end if;
  if (select count(*) from key_requests r where r.created_at > now() - interval '1 hour') > 60 then
    raise exception 'Too many requests right now, try again later.';
  end if;
  insert into key_requests (name, note, dev, token_hash)
  values (left(btrim(p_name), 20), nullif(left(btrim(coalesce(p_note, '')), 300), ''), left(coalesce(p_dev, ''), 60), encode(digest(p_token, 'sha256'), 'hex'))
  returning id into n;
  return n;
end $$;

create or replace function public.check_key_request(p_id bigint, p_token text)
returns table (status text, key text) language sql security definer set search_path = public, extensions as $$
  select r.status, case when r.status = 'approved' then r.key end
  from key_requests r
  where r.id = p_id and r.token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

create or replace function public.admin_list_key_requests(p_secret text)
returns table (id bigint, name text, note text, dev text, status text, pid text, created_at timestamptz, resolved_at timestamptz)
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not md_is_admin(p_secret) then perform pg_sleep(1); raise exception 'not allowed'; end if;
  return query select r.id, r.name, r.note, r.dev, r.status, r.pid, r.created_at, r.resolved_at
    from key_requests r order by (r.status = 'pending') desc, r.created_at desc limit 300;
end $$;

create or replace function public.admin_resolve_key_request(p_secret text, p_id bigint, p_pid text, p_status text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare k text;
begin
  if not md_is_admin(p_secret) then perform pg_sleep(1); raise exception 'not allowed'; end if;
  if p_status = 'approved' then
    select pk.key into k from player_keys pk where pk.pid = p_pid;
    if k is null then raise exception 'That player has no key'; end if;
    update key_requests set status = 'approved', pid = p_pid, key = k, resolved_at = now() where key_requests.id = p_id;
  else
    update key_requests set status = 'declined', key = null, resolved_at = now() where key_requests.id = p_id;
  end if;
end $$;

-- ===== Dashboard: leaderboard totals without the 1000-row API limit =====
create or replace function public.admin_lap_stats(p_secret text, p_tz text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare tz text := coalesce(nullif(p_tz, ''), 'UTC');
begin
  if not md_is_admin(p_secret) then perform pg_sleep(1); raise exception 'not allowed'; end if;
  begin perform now() at time zone tz; exception when others then tz := 'UTC'; end;
  return jsonb_build_object(
    'total', (select count(*) from laps),
    'week', (select count(*) from laps where created_at > now() - interval '7 days'),
    'tracks', (select coalesce(jsonb_object_agg(track, n), '{}'::jsonb) from (select track, count(*) n from laps group by track) x),
    'tracks7', (select coalesce(jsonb_object_agg(track, n), '{}'::jsonb) from (select track, count(*) n from laps where created_at > now() - interval '7 days' group by track) x),
    'days', (select coalesce(jsonb_object_agg(d, n), '{}'::jsonb) from (select to_char(created_at at time zone tz, 'YYYY-MM-DD') d, count(*) n from laps where created_at > now() - interval '32 days' group by 1) x)
  );
end $$;

grant execute on function public.request_key(text, text, text, text) to anon;
grant execute on function public.check_key_request(bigint, text) to anon;
grant execute on function public.admin_list_key_requests(text) to anon;
grant execute on function public.admin_resolve_key_request(text, bigint, text, text) to anon;
grant execute on function public.admin_lap_stats(text, text) to anon;
