addEventListener('error', e => { console.error(e.error || e.message); try { toast('Error: ' + String((e.error && e.error.message) || e.message).slice(0, 160), 'err'); } catch (x) { } });
addEventListener('unhandledrejection', e => { console.error(e.reason); try { toast('Error: ' + String((e.reason && e.reason.message) || e.reason).slice(0, 160), 'err'); } catch (x) { } });
// ===== Mini Drifters dev site: access gate, players, leaderboard moderation, deploy =====
// Security model: this site's code is public, so the gate is NOT what protects anything by itself.
// Player keys + moderation are protected by Supabase functions that check the admin secret on the server.
// Publishing/deploying is protected by the GitHub token, which only lives in this tab's memory.
const $ = id => document.getElementById(id);
const H = 'https:' + '//';
const ADMIN_SQL = "-- Mini Drifters: complete Supabase setup (game + admin). Paste into Supabase -> SQL Editor and press Run.\n-- Works on an empty project and is safe to run again. The admin secret is never stored, only its SHA-256 hash.\ncreate extension if not exists pgcrypto with schema extensions;\ngrant usage on schema public to anon;\n\n-- ===== tables =====\ncreate table if not exists public.profiles (id text primary key, data jsonb not null, updated_at timestamptz default now());\n\n-- one row per player per track: their best lap. Faster laps replace it (see submit_lap).\ncreate table if not exists public.laps (\n  id bigint generated always as identity primary key,\n  track int not null, pid text not null, name text, color text, body text,\n  lap_ms int not null check (lap_ms > 3000), score int, created_at timestamptz default now(),\n  unique (track, pid));\ncreate index if not exists laps_track_ms on public.laps (track, lap_ms);\nalter table public.laps add column if not exists replay text;   -- ghost replay of the lap\n\n-- admin 'troll' handling tweaks per player (read by the game, written only by the dev dashboard)\ncreate table if not exists public.player_tweaks (pid text primary key, data jsonb not null, updated_at timestamptz default now());\n\ncreate table if not exists public.player_keys (pid text primary key, key text not null, name text,\n  created_at timestamptz default now(), updated_at timestamptz default now());\n\ncreate table if not exists public.admin_config (id int primary key default 1, secret_hash text not null);\ninsert into public.admin_config (id, secret_hash) values (1, '__HASH__')\n  on conflict (id) do update set secret_hash = excluded.secret_hash;\n\n-- ===== access rules =====\nalter table public.profiles enable row level security;\nalter table public.laps enable row level security;\nalter table public.player_keys enable row level security;   -- no policies = no public access\nalter table public.admin_config enable row level security;  -- no policies = no public access\nalter table public.player_tweaks enable row level security;\ndrop policy if exists \"read tweaks\" on public.player_tweaks;\ncreate policy \"read tweaks\" on public.player_tweaks for select using (true);\ngrant select on public.player_tweaks to anon;\n\ndrop policy if exists \"read laps\" on public.laps;\ndrop policy if exists \"add laps\" on public.laps;\ndrop policy if exists \"read profile\" on public.profiles;\ndrop policy if exists \"save profile\" on public.profiles;\ndrop policy if exists \"update profile\" on public.profiles;\ncreate policy \"read laps\" on public.laps for select using (true);           -- laps are only written through submit_lap\ncreate policy \"read profile\" on public.profiles for select using (true);\ncreate policy \"save profile\" on public.profiles for insert with check (true);\ncreate policy \"update profile\" on public.profiles for update using (true);\ngrant select on public.laps to anon;\ngrant select, insert, update on public.profiles to anon;\n\n-- ===== game functions =====\n-- save a lap: adds the player's time, or replaces it only if the new lap is faster\ncreate or replace function public.submit_lap(p_track int, p_pid text, p_name text, p_color text, p_body text, p_lap_ms int, p_score int)\nreturns void language sql security definer set search_path = public as $$\n  insert into laps (track, pid, name, color, body, lap_ms, score)\n  values (p_track, left(p_pid, 24), left(p_name, 14), left(p_color, 24), left(p_body, 24), p_lap_ms, p_score)\n  on conflict (track, pid) do update\n    set lap_ms = excluded.lap_ms, score = excluded.score, name = excluded.name, color = excluded.color, body = excluded.body, replay = null, created_at = now()\n    where excluded.lap_ms < laps.lap_ms;\n$$;\n\n-- name changes: only the owner of an account key can rename their leaderboard times\ncreate or replace function public.rename_player(p_key text, p_name text) returns void\nlanguage sql security definer set search_path = public, extensions as $$\n  update public.laps set name = left(btrim(p_name), 14)\n  where pid = left(encode(extensions.digest('pub:' || p_key, 'sha256'), 'hex'), 24)\n    and length(btrim(p_name)) between 2 and 14;\n$$;\n\n-- remembers account keys so a forgotten key can be looked up by name on the dev dashboard\ncreate or replace function public.register_key(p_key text, p_name text) returns void\nlanguage plpgsql security definer set search_path = public, extensions as $$\nbegin\n  if p_key !~ '^MD-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$' then return; end if;\n  insert into player_keys (pid, key, name) values (substr(encode(digest('pub:' || p_key, 'sha256'), 'hex'), 1, 24), p_key, left(coalesce(p_name, ''), 14))\n  on conflict (pid) do update set name = excluded.name, updated_at = now();\nend $$;\n\n-- ===== admin functions (dev dashboard) =====\ncreate or replace function public.md_is_admin(p_secret text) returns boolean\nlanguage sql security definer set search_path = public, extensions as $$\n  select exists (select 1 from admin_config where id = 1 and secret_hash = encode(digest(coalesce(p_secret, ''), 'sha256'), 'hex'));\n$$;\n\ncreate or replace function public.admin_check(p_secret text) returns boolean\nlanguage plpgsql security definer set search_path = public, extensions as $$\nbegin\n  if not md_is_admin(p_secret) then perform pg_sleep(1); return false; end if;  -- slows down guessing\n  return true;\nend $$;\n\ncreate or replace function public.admin_find_players(p_secret text, p_query text)\nreturns table (pid text, key text, name text, created_at timestamptz, updated_at timestamptz, best_ms int, laps bigint)\nlanguage plpgsql security definer set search_path = public, extensions as $$\nbegin\n  if not md_is_admin(p_secret) then perform pg_sleep(1); raise exception 'not allowed'; end if;\n  return query select k.pid, k.key, k.name, k.created_at, k.updated_at,\n    (select min(l.lap_ms)::int from laps l where l.pid = k.pid), (select count(*) from laps l where l.pid = k.pid)\n  from player_keys k\n  where coalesce(p_query, '') = '' or k.name ilike '%' || p_query || '%' or k.pid ilike p_query || '%' or k.key ilike '%' || p_query || '%'\n  order by k.updated_at desc limit 200;\nend $$;\n\ncreate or replace function public.admin_rename(p_secret text, p_pid text, p_name text) returns void\nlanguage plpgsql security definer set search_path = public, extensions as $$\nbegin\n  if not md_is_admin(p_secret) then raise exception 'not allowed'; end if;\n  update player_keys set name = left(p_name, 14), updated_at = now() where pid = p_pid;\n  update laps set name = left(p_name, 14) where pid = p_pid;\nend $$;\n\ncreate or replace function public.admin_delete_lap(p_secret text, p_id bigint) returns void\nlanguage plpgsql security definer set search_path = public, extensions as $$\nbegin\n  if not md_is_admin(p_secret) then raise exception 'not allowed'; end if;\n  delete from laps where id = p_id;\nend $$;\n\ncreate or replace function public.admin_clear_track(p_secret text, p_track int) returns void\nlanguage plpgsql security definer set search_path = public, extensions as $$\nbegin\n  if not md_is_admin(p_secret) then raise exception 'not allowed'; end if;\n  delete from laps where track = p_track;\nend $$;\n\n-- Purge all: deletes every lap time on every track\ncreate or replace function public.admin_purge_all(p_secret text) returns bigint\nlanguage plpgsql security definer set search_path = public, extensions as $$\ndeclare n bigint;\nbegin\n  if not md_is_admin(p_secret) then perform pg_sleep(1); raise exception 'not allowed'; end if;\n  delete from laps where true; get diagnostics n = row_count; return n;\nend $$;\n\n-- same as above but also stores the lap's ghost replay\ncreate or replace function public.submit_lap(p_track int, p_pid text, p_name text, p_color text, p_body text, p_lap_ms int, p_score int, p_replay text)\nreturns void language sql security definer set search_path = public as $$\n  insert into laps (track, pid, name, color, body, lap_ms, score, replay)\n  values (p_track, left(p_pid, 24), left(p_name, 14), left(p_color, 24), left(p_body, 24), p_lap_ms, p_score, left(p_replay, 200000))\n  on conflict (track, pid) do update\n    set lap_ms = excluded.lap_ms, score = excluded.score, name = excluded.name, color = excluded.color, body = excluded.body, replay = excluded.replay, created_at = now()\n    where excluded.lap_ms < laps.lap_ms;\n$$;\n\n-- every player: account keys joined with saved profiles (and their troll tweaks)\ncreate or replace function public.admin_list_players(p_secret text)\nreturns table (pid text, key text, name text, profile_id text, data jsonb, tweaks jsonb, created_at timestamptz, updated_at timestamptz)\nlanguage plpgsql security definer set search_path = public, extensions as $$\n#variable_conflict use_column\nbegin\n  if not md_is_admin(p_secret) then perform pg_sleep(1); raise exception 'not allowed'; end if;\n  return query\n  with kk as (select k.pid as kpid, k.key as kkey, k.name as kname, k.created_at as kc, k.updated_at as ku, encode(digest('priv:' || k.key, 'sha256'), 'hex') as priv from player_keys k)\n  select kk.kpid, kk.kkey, coalesce(kk.kname, p.data->'cfg'->>'name'), p.id, p.data, t.data, coalesce(kk.kc, p.updated_at), greatest(kk.ku, p.updated_at)\n  from kk full outer join profiles p on p.id = kk.priv\n  left join player_tweaks t on t.pid = kk.kpid\n  order by greatest(kk.ku, p.updated_at) desc nulls last limit 5000;\nend $$;\n\n-- edit a player's name (everywhere) and/or their raw profile\ncreate or replace function public.admin_save_player(p_secret text, p_pid text, p_profile_id text, p_name text, p_data jsonb) returns void\nlanguage plpgsql security definer set search_path = public, extensions as $$\nbegin\n  if not md_is_admin(p_secret) then raise exception 'not allowed'; end if;\n  if p_pid is not null and coalesce(btrim(p_name), '') <> '' then\n    update player_keys set name = left(btrim(p_name), 14), updated_at = now() where pid = p_pid;\n    update laps set name = left(btrim(p_name), 14) where pid = p_pid;\n  end if;\n  if p_profile_id is not null and p_data is not null then\n    update profiles set data = p_data, updated_at = now() where id = p_profile_id;\n  end if;\nend $$;\n\n-- give a player a new key: moves their times, profile and tweaks over to it\ncreate or replace function public.admin_change_key(p_secret text, p_pid text, p_new_key text) returns text\nlanguage plpgsql security definer set search_path = public, extensions as $$\ndeclare old_key text; np text; npriv text; op text;\nbegin\n  if not md_is_admin(p_secret) then raise exception 'not allowed'; end if;\n  if p_new_key !~ '^MD-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$' then raise exception 'Key must look like MD-XXXX-XXXX-XXXX'; end if;\n  select k.key into old_key from player_keys k where k.pid = p_pid; if old_key is null then raise exception 'Player not found'; end if;\n  np := substr(encode(digest('pub:' || p_new_key, 'sha256'), 'hex'), 1, 24);\n  npriv := encode(digest('priv:' || p_new_key, 'sha256'), 'hex'); op := encode(digest('priv:' || old_key, 'sha256'), 'hex');\n  if np = p_pid then return np; end if;\n  if exists (select 1 from player_keys k where k.pid = np) then raise exception 'That key already belongs to another player'; end if;\n  delete from laps where pid = np; delete from profiles where id = npriv; delete from player_tweaks where pid = np;\n  update laps set pid = np where pid = p_pid;\n  update profiles set id = npriv where id = op;\n  update player_tweaks set pid = np where pid = p_pid;\n  update player_keys set pid = np, key = p_new_key, updated_at = now() where pid = p_pid;\n  return np;\nend $$;\n\n-- delete a player completely: key, profile, tweaks and all their lap times\ncreate or replace function public.admin_delete_player(p_secret text, p_pid text, p_profile_id text) returns void\nlanguage plpgsql security definer set search_path = public, extensions as $$\nbegin\n  if not md_is_admin(p_secret) then raise exception 'not allowed'; end if;\n  if p_pid is not null then\n    delete from laps where pid = p_pid; delete from player_tweaks where pid = p_pid; delete from player_keys where pid = p_pid;\n  end if;\n  if p_profile_id is not null then delete from profiles where id = p_profile_id; end if;\nend $$;\n\n-- troll tab: set (or with null, reset) a player's handling tweaks\ncreate or replace function public.admin_set_tweaks(p_secret text, p_pid text, p_data jsonb) returns void\nlanguage plpgsql security definer set search_path = public, extensions as $$\nbegin\n  if not md_is_admin(p_secret) then raise exception 'not allowed'; end if;\n  if p_data is null or p_data = '{}'::jsonb then delete from player_tweaks where pid = p_pid;\n  else insert into player_tweaks (pid, data) values (p_pid, p_data) on conflict (pid) do update set data = excluded.data, updated_at = now(); end if;\nend $$;\n\n-- ===== who can call what =====\nrevoke all on function public.md_is_admin(text) from public, anon, authenticated;\ngrant execute on function public.submit_lap(int, text, text, text, text, int, int) to anon;\ngrant execute on function public.rename_player(text, text) to anon;\ngrant execute on function public.register_key(text, text) to anon;\ngrant execute on function public.admin_check(text) to anon;\ngrant execute on function public.admin_find_players(text, text) to anon;\ngrant execute on function public.admin_rename(text, text, text) to anon;\ngrant execute on function public.admin_delete_lap(text, bigint) to anon;\ngrant execute on function public.admin_clear_track(text, int) to anon;\ngrant execute on function public.admin_purge_all(text) to anon;\ngrant execute on function public.submit_lap(int, text, text, text, text, int, int, text) to anon;\ngrant execute on function public.admin_list_players(text) to anon;\ngrant execute on function public.admin_save_player(text, text, text, text, jsonb) to anon;\ngrant execute on function public.admin_change_key(text, text, text) to anon;\ngrant execute on function public.admin_delete_player(text, text, text) to anon;\ngrant execute on function public.admin_set_tweaks(text, text, jsonb) to anon;\n\nnotify pgrst, 'reload schema';\n";
const DCFG = Object.assign({ sbUrl: '', sbKey: '', srv: '', gameRepo: 'georgelloydd/minidrifters', branch: 'main', gameUrl: '' }, JSON.parse(localStorage.getItem('md_dev_cfg') || '{}'));
function saveD() { localStorage.setItem('md_dev_cfg', JSON.stringify(DCFG)); }
function gameUrl() { if (DCFG.gameUrl) return DCFG.gameUrl.replace(/\/?$/, '/'); const [o, n] = DCFG.gameRepo.split('/'); return H + o.toLowerCase() + '.github.io/' + n + '/'; }
let SECRET = '';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const b64 = s => btoa(unescape(encodeURIComponent(s)));
const unb64 = s => decodeURIComponent(escape(atob(s.replace(/\s/g, ''))));
function fmtMs(ms) { if (!ms) return '—'; const m = Math.floor(ms / 60000), s = (ms % 60000) / 1000; return m + ':' + s.toFixed(3).padStart(6, '0'); }
async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
function toast(m, kind) { const t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = m; $('toasts').appendChild(t); setTimeout(() => t.remove(), kind === 'err' ? 7000 : 3500); }

// ---------- Supabase ----------
function sbBase() { let u = DCFG.sbUrl.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, ''); if (u && !/^https?:/.test(u)) u = H + u; return u; }
async function sb(method, path, body) {
  const key = DCFG.sbKey.trim(), h = { apikey: key, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  if (key.startsWith('eyJ')) h.Authorization = 'Bearer ' + key;
  const r = await fetch(sbBase() + '/rest/v1/' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { }
  if (!r.ok) { const e = new Error((j && (j.message || j.hint)) || ('HTTP ' + r.status)); e.status = r.status; e.code = j && j.code; throw e; }
  return j;
}
const rpc = (fn, args) => sb('POST', 'rpc/' + fn, Object.assign({ p_secret: SECRET }, args || {}));

// ---------- GitHub ----------
function token() { const t = $('ghTok').value.trim(); if (!t) { $('ghTok').focus(); throw new Error('Paste your GitHub token in the top bar first.'); } return t; }
async function gh(repo, method, path, body, okStatus) {
  const r = await fetch(H + 'api.github.com/repos/' + repo + path, { method, headers: { Authorization: 'Bearer ' + token(), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { }
  if (!r.ok && !(okStatus || []).includes(r.status)) { const hint = r.status === 401 ? ' (token wrong or expired)' : r.status === 403 ? ' (token is missing a permission for ' + repo + ')' : r.status === 404 ? ' (repo not found, or the token does not include ' + repo + ')' : ''; const e = new Error(((j && j.message) || ('HTTP ' + r.status)) + hint); e.status = r.status; throw e; }
  return { status: r.status, data: j };
}
// tracks.json in the game repo is what the live game loads (deploys never overwrite it)
async function publishTracks(list, message) {
  const repo = DCFG.gameRepo, info = (await gh(repo, 'GET', '')).data, br = info.default_branch || 'main';
  const ex = await gh(repo, 'GET', '/contents/tracks.json?ref=' + br, null, [404]);
  const body = { message, content: b64(JSON.stringify({ version: 1, tracks: list }, null, 1)), branch: br }; if (ex.status === 200) body.sha = ex.data.sha;
  const r = await gh(repo, 'PUT', '/contents/tracks.json', body); return r.data.commit;
}
async function loadPublished() {
  try { const r = await fetch(gameUrl() + 'tracks.json?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) { const j = await r.json(); if (Array.isArray(j.tracks) && j.tracks.length) return { list: j.tracks, from: 'live site' }; } } catch (e) { }
  if ($('ghTok').value.trim()) { try { const ex = await gh(DCFG.gameRepo, 'GET', '/contents/tracks.json', null, [404]); if (ex.status === 200) return { list: JSON.parse(unb64(ex.data.content)).tracks, from: 'GitHub' }; } catch (e) { } }
  return { list: JSON.parse(JSON.stringify(TRACKS)), from: 'built-in tracks' };
}

// ---------- gate ----------
function showSql(hash) { $('gSql').value = ADMIN_SQL.replace('__HASH__', hash); $('gSqlBox').classList.remove('hidden'); }
async function unlock(auto) {
  DCFG.sbUrl = $('gUrl').value.trim(); DCFG.sbKey = $('gKey').value.trim(); DCFG.srv = ($('gSrv') ? $('gSrv').value : '').trim(); saveD(); SECRET = $('gSecret').value.trim(); $('gMsg').textContent = '';
  if (!DCFG.sbUrl || !DCFG.sbKey) return $('gMsg').textContent = 'Fill in the Supabase URL and publishable key (the same ones the game uses).';
  if (!SECRET) return $('gMsg').textContent = 'Enter your admin secret key.';
  $('gGo').disabled = true; $('gGo').textContent = 'CHECKING…';
  try {
    const ok = await sb('POST', 'rpc/admin_check', { p_secret: SECRET });
    if (ok !== true) throw new Error('Wrong secret key.');
    if ($('gRem').checked) localStorage.setItem('md_dev_secret', SECRET); else localStorage.removeItem('md_dev_secret');
    $('gate').classList.add('hidden'); $('app').classList.remove('hidden'); enterApp();
  } catch (e) {
    SECRET = ''; localStorage.removeItem('md_dev_secret');
    $('gMsg').textContent = /admin_check|PGRST202|schema cache/i.test(e.message) || e.status === 404 ? 'Supabase doesn\'t have the admin functions yet. Open "First-time setup" below, make a secret and run the SQL.' : /fetch/i.test(e.message) ? 'Could not reach Supabase. Check the URL.' : e.message;
    if (auto) $('gMsg').textContent = '';
  } finally { $('gGo').disabled = false; $('gGo').textContent = 'UNLOCK'; }
}
function lock() { localStorage.removeItem('md_dev_secret'); SECRET = ''; $('ghTok').value = ''; location.reload(); }

// ---------- tabs ----------
function setTab(t) { document.querySelectorAll('.nv').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); document.querySelectorAll('.tab').forEach(s => s.classList.toggle('hidden', s.id !== 'tab-' + t)); if (t === 'tracks') BLD_resize(); if (t === 'lb') lbTrackSelect(); if ((t === 'players' || t === 'troll') && !PL.length) loadPlayers(); }
let ENTERED = false;
function enterApp() {
  if (ENTERED) return; ENTERED = true;
  $('gameLink').href = gameUrl(); $('gameLink').textContent = gameUrl().replace(/^https?:\/\//, '');
  $('dpRepo').value = DCFG.gameRepo; $('dpUrl').value = DCFG.gameUrl; $('dpSb').checked = true; $('dpSbInfo').textContent = DCFG.sbUrl ? sbBase().replace(/^https?:\/\//, '') : 'not set';
  $('dpN').textContent = Object.keys(GAME_FILES).length;
  BLD_init(); setTab('tracks');
}

// ---------- players ----------
let PL = [], PLV = [];
const plLabel = p => p.name || (p.data && p.data.cfg && p.data.cfg.name) || 'Unnamed';
async function loadPlayers() {
  $('plBody').innerHTML = '<tr><td colspan="6" class="dim">Loading…</td></tr>';
  try { PL = await rpc('admin_list_players', {}) || []; }
  catch (e) { $('plBody').innerHTML = `<tr><td colspan="6" class="err">${esc(/admin_list_players|PGRST202|404/.test(e.message) ? 'Run the updated SQL in Supabase first (it adds the new player tools), then press Refresh.' : e.message)}</td></tr>`; return false; }
  renderPlayers(); trFill(); return true;
}
function renderPlayers() {
  const q = $('plQ').value.trim().toLowerCase();
  PLV = PL.filter(p => !q || [plLabel(p), p.key, p.pid, p.profile_id].some(v => String(v || '').toLowerCase().includes(q)));
  $('plCount').textContent = PLV.length + ' of ' + PL.length + ' players';
  if (!PLV.length) { $('plBody').innerHTML = `<tr><td colspan="6" class="dim">${PL.length ? 'Nobody matches that filter.' : 'No players yet.'}</td></tr>`; return; }
  $('plBody').innerHTML = PLV.map((p, i) => { const s = (p.data && p.data.stats) || {}, prof = p.profile_id ? `${s.sessions || 0} sessions · ${s.races || 0} races · ${(+s.dist || 0).toFixed(1)} km` : '<span class="dim">no profile</span>';
    return `<tr><td><b>${esc(plLabel(p))}</b>${p.tweaks ? ' <span title="Trolled">😈</span>' : ''}</td><td class="mono">${p.key ? `<span class="key" data-i="${i}">MD-••••-••••-••••</span> <button class="mini" data-show="${i}">Show</button> <button class="mini" data-copy="${i}">Copy</button>` : '<span class="dim">no key</span>'}</td><td class="mono dim">${esc((p.pid || '—').slice(0, 10))}</td><td class="small">${prof}</td><td class="dim">${p.updated_at ? new Date(p.updated_at).toLocaleString() : ''}</td><td style="white-space:nowrap"><button class="mini" data-edit="${i}">Edit</button>${p.pid ? ` <button class="mini" data-troll="${i}">Troll</button>` : ''} <button class="mini red" data-delp="${i}">Delete</button></td></tr>`; }).join('');
}
function plClick(e) {
  const b = e.target.closest('button'); if (!b) return; const p = PLV[+(b.dataset.show ?? b.dataset.copy ?? b.dataset.edit ?? b.dataset.troll ?? b.dataset.delp)]; if (!p) return;
  if (b.dataset.show !== undefined) { const s = document.querySelector(`.key[data-i="${b.dataset.show}"]`); const on = b.textContent === 'Show'; s.textContent = on ? p.key : 'MD-••••-••••-••••'; b.textContent = on ? 'Hide' : 'Show'; }
  if (b.dataset.copy !== undefined) navigator.clipboard.writeText(p.key).then(() => toast('Key copied for ' + plLabel(p) + '. Send it to them privately: anyone with it can use their account.', 'ok'));
  if (b.dataset.edit !== undefined) editPlayer(p);
  if (b.dataset.troll !== undefined) { setTab('troll'); $('trP').value = p.pid; trShow(); }
  if (b.dataset.delp !== undefined) delPlayer(p);
}
function modal(html) { $('mBox').innerHTML = html; $('modal').style.display = 'flex'; }
function closeModal() { $('modal').style.display = 'none'; $('mBox').innerHTML = ''; if (RP) { cancelAnimationFrame(RP.raf); RP = null; } }
function editPlayer(p) {
  modal(`<h2>Edit ${esc(plLabel(p))}</h2>
  <div class="row"><span class="dim small" style="width:90px">Name</span><input id="ePName" maxlength="14" value="${esc(plLabel(p))}" ${p.pid ? '' : 'disabled'}></div>
  <div class="row"><span class="dim small" style="width:90px">Player key</span><input id="ePKey" class="mono" value="${esc(p.key || '')}" ${p.pid ? '' : 'disabled'} style="flex:1"><button class="mini" id="ePGen" ${p.pid ? '' : 'disabled'}>New key</button></div>
  <p class="dim small">A new key keeps their times and profile. They then sign in with the new key; the old one stops working.</p>
  <div class="dim small">Profile (JSON: name, car look, settings and stats)</div>
  <textarea id="ePData" class="mono" style="width:100%;height:300px;box-sizing:border-box" ${p.profile_id ? '' : 'disabled'}>${esc(p.profile_id ? JSON.stringify(p.data, null, 2) : 'This player has no saved profile yet.')}</textarea>
  <div class="row"><button class="red" id="ePSave">Save</button><button class="mini" id="ePCancel">Cancel</button><span id="ePMsg" class="small"></span></div>`);
  $('ePCancel').onclick = closeModal;
  $('ePGen').onclick = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', r = crypto.getRandomValues(new Uint8Array(12)); let s = 'MD'; for (let i = 0; i < 12; i++) { if (i % 4 === 0) s += '-'; s += A[r[i] % 32]; } $('ePKey').value = s; };
  $('ePSave').onclick = async () => { const m = $('ePMsg'); m.textContent = 'Saving…'; m.className = 'small dim';
    try { let data = null;
      if (p.profile_id) { try { data = JSON.parse($('ePData').value); } catch (e) { throw new Error('Profile JSON is not valid: ' + e.message); } if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The profile must be a JSON object { … }.'); }
      const name = $('ePName').value.trim().slice(0, 14); if (p.pid && !name) throw new Error('Name cannot be empty.');
      if (data && name && data.cfg && typeof data.cfg === 'object') data.cfg.name = name;
      await rpc('admin_save_player', { p_pid: p.pid || null, p_profile_id: p.profile_id || null, p_name: p.pid ? name : null, p_data: data });
      const nk = $('ePKey').value.trim().toUpperCase();
      if (p.pid && nk && nk !== p.key) { if (!/^MD-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(nk)) throw new Error('Key must look like MD-XXXX-XXXX-XXXX.'); await rpc('admin_change_key', { p_pid: p.pid, p_new_key: nk }); }
      toast('Saved ' + (name || plLabel(p)) + '.', 'ok'); closeModal(); loadPlayers();
    } catch (e) { m.textContent = e.message; m.className = 'small err'; } };
}
async function delPlayer(p) {
  if (prompt(`Delete ${plLabel(p)} completely? This removes their key, profile, troll settings and every leaderboard time.\n\nType DELETE to confirm.`) !== 'DELETE') return;
  try { await rpc('admin_delete_player', { p_pid: p.pid || null, p_profile_id: p.profile_id || null }); toast('Deleted ' + plLabel(p) + '.', 'ok'); loadPlayers(); } catch (e) { toast(e.message, 'err'); }
}
// ---------- troll ----------
const TW_FIELDS = [['maxs', 'Top speed', 0.2, 4], ['engine', 'Acceleration', 0.1, 6], ['brake', 'Braking', 0.1, 5], ['rev', 'Reverse speed', 0.1, 5], ['steer', 'Turning speed', 0.1, 4], ['grip', 'Grip', 0.05, 5], ['drift', 'Drift grip', 0.05, 5], ['dmom', 'Drift speed boost', 0, 6], ['hb', 'Handbrake grip', 0.05, 5], ['off', 'Off-road slowdown', 0, 5]];
const TW_PRESETS = { Rocket: { maxs: 2.2, engine: 3 }, Snail: { maxs: 0.35, engine: 0.4 }, Ice: { grip: 0.15, drift: 0.25, hb: 0.3 }, 'Drift god': { drift: 1.8, dmom: 3, steer: 1.3 }, 'Shopping trolley': { steer: 0.35, grip: 0.4 }, 'No brakes': { brake: 0.1, rev: 0.1 }, Inverted: { inv: 1 } };
let TRW = {};
function trSummary(t) { return Object.keys(t || {}).filter(k => k === 'inv' ? t.inv : t[k] !== 1).map(k => k === 'inv' ? 'inverted steering' : ((TW_FIELDS.find(f => f[0] === k) || [k, k])[1] + ' ×' + t[k])).join(', ') || 'default'; }
function trFill() {
  const s = $('trP'), v = s.value, P = PL.filter(p => p.pid);
  s.innerHTML = '<option value="">Choose a player…</option>' + P.map(p => `<option value="${esc(p.pid)}">${esc(plLabel(p))} · ${esc(p.pid.slice(0, 10))}${p.tweaks ? ' 😈' : ''}</option>`).join('');
  if (v && P.some(p => p.pid === v)) s.value = v; trShow();
  const T = P.filter(p => p.tweaks); $('trList').innerHTML = T.length ? T.map(p => `<div>😈 <b>${esc(plLabel(p))}</b> · ${esc(trSummary(p.tweaks))}</div>`).join('') : 'Nobody right now.';
}
function trShow(keep) {
  const p = PL.find(q => q.pid === $('trP').value); if (!keep) TRW = Object.assign({}, (p && p.tweaks) || {}); const dis = p ? '' : 'disabled';
  $('trBox').innerHTML = (p ? '' : '<p class="dim small">Pick a player above, or press Troll next to them on the Players tab.</p>') +
    `<div class="row wrap"><span class="dim small">Presets:</span>${Object.keys(TW_PRESETS).map(k => `<button class="mini" data-trp="${esc(k)}" ${dis}>${esc(k)}</button>`).join('')}</div>` +
    TW_FIELDS.map(([k, label, lo, hi]) => { const v = TRW[k] ?? 1; return `<div class="row"><span style="width:160px">${label}</span><input type="range" min="${lo}" max="${hi}" step="0.05" value="${v}" data-tw="${k}" style="flex:1" ${dis}><b class="mono" id="twv_${k}" style="width:60px;text-align:right">×${(+v).toFixed(2)}</b></div>`; }).join('') +
    `<label class="chk"><input type="checkbox" id="twInv" ${TRW.inv ? 'checked' : ''} ${dis}> Inverted steering (left is right)</label>`;
  $('trBox').querySelectorAll('[data-tw]').forEach(r => r.oninput = () => { TRW[r.dataset.tw] = +r.value; $('twv_' + r.dataset.tw).textContent = '×' + (+r.value).toFixed(2); });
  $('twInv').onchange = e => { TRW.inv = e.target.checked ? 1 : 0; };
  $('trBox').querySelectorAll('[data-trp]').forEach(b => b.onclick = () => { TRW = Object.assign({}, TW_PRESETS[b.dataset.trp]); trShow(true); });
  $('trSave').disabled = $('trReset').disabled = !p;
}
async function trSave() {
  const pid = $('trP').value; if (!pid) return; const d = {};
  for (const [k] of TW_FIELDS) if (TRW[k] != null && Math.abs(TRW[k] - 1) > 0.001) d[k] = Math.round(TRW[k] * 100) / 100; if (TRW.inv) d.inv = 1;
  try { await rpc('admin_set_tweaks', { p_pid: pid, p_data: Object.keys(d).length ? d : null }); toast(Object.keys(d).length ? 'Saved. It applies to their car within about 15 seconds.' : 'Everything is default, so their tweaks were cleared.', 'ok'); await loadPlayers(); } catch (e) { toast(e.message, 'err'); }
}
async function trReset() {
  const pid = $('trP').value; if (!pid) return;
  try { await rpc('admin_set_tweaks', { p_pid: pid, p_data: null }); TRW = {}; toast('Reset to default. Their car goes back to normal within about 15 seconds.', 'ok'); await loadPlayers(); } catch (e) { toast(e.message, 'err'); }
}
// ---------- replay viewer (cheat checks) ----------
let RP = null;
async function openReplay(r) {
  if (!r) return; let row;
  try { row = ((await sb('GET', `laps?id=eq.${r.id}&select=replay,lap_ms,name,track`)) || [])[0]; } catch (e) { return toast(e.message, 'err'); }
  const L = row && decRep(row.replay); if (!L) return toast('No replay for this lap. It was set before replays existed (or from an old game version).', 'err');
  const def = BLD.list[row.track]; if (!def) return toast('Track not found.', 'err');
  const W0 = WORLD_W, H0 = WORLD_H; let tr; try { tr = buildTrack(JSON.parse(JSON.stringify(def))); } finally { WORLD_W = W0; WORLD_H = H0; }
  const N = tr.n, sp = []; let maxV = 0, jumps = 0, offS = 0, prog = 0, last = null;
  L.forEach((p, i) => { const q = last == null ? nearestFull(tr, p[0], p[1]) : nearest(tr, p[0], p[1], last); if (last != null) { let dd = q.i - last; if (dd > N / 2) dd -= N; if (dd < -N / 2) dd += N; prog += dd; } last = q.i; if (q.d > tr.w / 2 + 60) offS++;
    const v = i ? Math.hypot(p[0] - L[i - 1][0], p[1] - L[i - 1][1]) * 10 : 0; sp.push(v); maxV = Math.max(maxV, v); if (v > 1700) jumps++; });
  const dur = (L.length - 1) * 100, flags = [];
  if (Math.abs(dur - row.lap_ms) > 300 + row.lap_ms * 0.03) flags.push(`Replay lasts ${fmtMs(dur)} but the lap time is ${fmtMs(row.lap_ms)}`);
  if (maxV > 980 * 1.15) flags.push(`Top speed ${Math.round(maxV * 0.25)} km/h is above the normal max of about ${Math.round(980 * 0.25)} km/h (or they were trolled)`);
  if (jumps) flags.push(jumps + ' teleport jump' + (jumps > 1 ? 's' : ''));
  if (prog < N * 0.9) flags.push(`Only ${Math.max(0, Math.round(prog / N * 100))}% of the track was driven (shortcut?)`);
  if (offS > 3) flags.push(`${(offS / 10).toFixed(1)} s spent beyond the run-off (possible cut)`);
  modal(`<h2>Replay · ${esc(row.name)} · ${fmtMs(row.lap_ms)}</h2><div class="small">${flags.length ? flags.map(f => `<div class="err">⚠ ${esc(f)}</div>`).join('') : '<div style="color:#5bd17a">✓ Nothing suspicious found automatically. Watch it to be sure.</div>'}</div>
  <canvas id="rpCv" width="880" height="540" style="width:100%;background:#000;border-radius:6px;margin-top:8px"></canvas>
  <div class="row"><button class="mini" id="rpPlay">Pause</button><select id="rpSpd"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="4">4×</option></select><input type="range" id="rpT" min="0" max="${L.length - 1}" step="0.1" value="0" style="flex:1"><span class="mono small" id="rpInfo" style="width:150px"></span><button class="mini" id="rpClose">Close</button></div>`);
  const cv = $('rpCv'), g = cv.getContext('2d'), s = Math.min(cv.width / tr.W, cv.height / tr.H), ox = (cv.width - tr.W * s) / 2, oy = (cv.height - tr.H * s) / 2, cs = Math.max(1, 16 / (58 * s));
  RP = { t: 0, play: true, last: performance.now(), raf: 0, L };
  $('rpPlay').onclick = () => { RP.play = !RP.play; $('rpPlay').textContent = RP.play ? 'Pause' : 'Play'; };
  $('rpT').oninput = e => { RP.t = +e.target.value; }; $('rpClose').onclick = closeModal;
  const frame = () => { if (!RP || RP.L !== L) return; const now = performance.now();
    if (RP.play) { RP.t += (now - RP.last) / 100 * +$('rpSpd').value; if (RP.t >= L.length - 1) RP.t = 0; $('rpT').value = RP.t; } RP.last = now;
    g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height); g.save(); g.translate(ox, oy); g.scale(s, s);
    if (tr.canvas) g.drawImage(tr.canvas, 0, 0, tr.W, tr.H); try { drawElevAll(g, tr, 0.4); drawWalls(g, tr); } catch (e) { }
    g.lineWidth = 3 / s; for (let i = 1; i < L.length; i++) { const v = Math.min(1, sp[i] / 980); g.strokeStyle = `hsl(${120 - v * 120},90%,55%)`; g.beginPath(); g.moveTo(L[i - 1][0], L[i - 1][1]); g.lineTo(L[i][0], L[i][1]); g.stroke(); }
    const i = Math.min(L.length - 2, Math.floor(RP.t)), f = RP.t - i, A = L[i], B = L[i + 1] || A;
    g.translate(A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f); g.rotate(A[2] + (B[2] - A[2]) * f); g.scale(cs, cs);
    g.fillStyle = '#ff2a2a'; g.strokeStyle = '#fff'; g.lineWidth = 2 / (s * cs); g.fillRect(-29, -14, 58, 28); g.strokeRect(-29, -14, 58, 28); g.fillStyle = '#fff'; g.fillRect(16, -10, 10, 20); g.restore();
    $('rpInfo').textContent = fmtMs(Math.max(1, Math.round(RP.t * 100))) + ' · ' + Math.round((sp[Math.round(RP.t)] || 0) * 0.25) + ' km/h';
    RP.raf = requestAnimationFrame(frame); };
  frame();
}

// ---------- leaderboard moderation ----------
let LBR = [];
function lbTrackSelect() { const s = $('lbT'), v = s.value; s.innerHTML = BLD.list.map((t, i) => `<option value="${i}">${i + 1}. ${esc(t.name)}${t.hidden ? ' (hidden)' : ''}</option>`).join(''); if (v) s.value = v; }
async function loadLaps() {
  const t = +$('lbT').value || 0; $('lbBody').innerHTML = '<tr><td colspan="5" class="dim">Loading…</td></tr>';
  try { LBR = await sb('GET', `laps?track=eq.${t}&select=id,name,pid,lap_ms,created_at&order=lap_ms.asc&limit=200`) || []; } catch (e) { $('lbBody').innerHTML = `<tr><td colspan="5" class="err">${esc(e.message)}</td></tr>`; return; }
  $('lbBody').innerHTML = LBR.length ? LBR.map((r, i) => `<tr><td>${i + 1}</td><td><b>${esc(r.name)}</b> <span class="dim mono">${esc(r.pid.slice(0, 8))}</span></td><td class="mono">${fmtMs(r.lap_ms)}</td><td class="dim">${new Date(r.created_at).toLocaleString()}</td><td style="white-space:nowrap"><button class="mini" data-rep="${i}">▶ Replay</button> <button class="mini red" data-del="${i}">Delete</button></td></tr>`).join('') : '<tr><td colspan="5" class="dim">No lap times on this track yet.</td></tr>';
}
async function lbClick(e) { const rb = e.target.closest('[data-rep]'); if (rb) return openReplay(LBR[+rb.dataset.rep]); const b = e.target.closest('[data-del]'); if (!b) return; const r = LBR[+b.dataset.del]; if (!confirm(`Delete ${r.name}'s ${fmtMs(r.lap_ms)}?`)) return; try { await rpc('admin_delete_lap', { p_id: r.id }); toast('Lap deleted.', 'ok'); loadLaps(); } catch (er) { toast(er.message, 'err'); } }
async function purgeAll() { if (prompt('This deletes EVERY lap time on EVERY track for all players. It cannot be undone. Type PURGE to confirm.') !== 'PURGE') return; try { const n = await rpc('admin_purge_all', {}); toast('Purged ' + (n || 0) + ' lap time' + (n === 1 ? '' : 's') + ' from all leaderboards.', 'ok'); if (!$('tab-lb').classList.contains('hidden')) loadLaps(); } catch (e) { toast(/404|PGRST202|admin_purge_all/.test(e.message) ? 'Run the admin SQL again in Supabase (it adds the Purge all function), then retry.' : e.message, 'err'); } }
async function clearTrack(t) { const name = (BLD.list[t] || {}).name || ('track ' + t); if (prompt(`This deletes EVERY lap time on "${name}". Type CLEAR to confirm.`) !== 'CLEAR') return; try { await rpc('admin_clear_track', { p_track: t }); toast('Leaderboard for ' + name + ' cleared. (Players\' personal bests stay in their profiles.)', 'ok'); if (!$('tab-lb').classList.contains('hidden')) loadLaps(); } catch (e) { toast(e.message, 'err'); } }

// ---------- deploy the game ----------
function dlog(m, c) { const d = document.createElement('div'); d.className = c || ''; d.textContent = m; $('dpLog').appendChild(d); $('dpLog').scrollTop = 1e9; }
async function deployGame() {
  $('dpLog').innerHTML = ''; $('dpGo').disabled = true;
  try {
    DCFG.gameRepo = $('dpRepo').value.trim().replace(/^https?:\/\/github.com\//, '').replace(/\.git$/, ''); DCFG.gameUrl = $('dpUrl').value.trim(); saveD(); const repo = DCFG.gameRepo;
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Game repo should look like owner/name');
    dlog('Checking access to ' + repo + '…'); const info = (await gh(repo, 'GET', '')).data; if (info.permissions && !info.permissions.push) throw new Error('This token can read ' + repo + ' but not write to it (needs Contents: Read and write)');
    const branch = info.default_branch || 'main', message = $('dpMsg').value.trim() || 'Update Mini Drifters';
    let ref = await gh(repo, 'GET', '/git/ref/heads/' + branch, null, [404, 409]);
    if (ref.status !== 200) { dlog('Repo is empty, creating the first commit…'); await gh(repo, 'PUT', '/contents/README.md', { message: 'Initial commit', content: GAME_FILES['README.md'] || b64('# Mini Drifters'), branch }); ref = await gh(repo, 'GET', '/git/ref/heads/' + branch); }
    const head = ref.data.object.sha, base = (await gh(repo, 'GET', '/git/commits/' + head)).data.tree.sha; dlog('✓ Access OK, ' + branch + ' is at ' + head.slice(0, 7), 'ok');
    const files = Object.assign({}, GAME_FILES);
    if ($('dpSb').checked && DCFG.sbUrl && DCFG.sbKey) { files['js/config.js'] = b64('// ===== Online services (written by the Mini Drifters dev site) =====\nconst ONLINE = {\n  SUPABASE_URL: ' + JSON.stringify(sbBase()) + ',\n  SUPABASE_ANON_KEY: ' + JSON.stringify(DCFG.sbKey.trim()) + ',\n  GAME_SERVER: ' + JSON.stringify((DCFG.srv || '').trim()) + ',\n};\n'); dlog('Writing js/config.js with your Supabase project', 'dim'); }
    else { const ex = await gh(repo, 'GET', '/contents/js/config.js?ref=' + branch, null, [404]); if (ex.status === 200) { delete files['js/config.js']; dlog('Keeping the repo\'s existing js/config.js', 'dim'); } }
    const tree = [], paths = Object.keys(files); let n = 0;
    for (const path of paths) { const b = (await gh(repo, 'POST', '/git/blobs', { content: files[path], encoding: 'base64' })).data; tree.push({ path, mode: '100644', type: 'blob', sha: b.sha }); dlog(`  uploaded ${path} (${++n}/${paths.length})`, 'dim'); }
    const t = (await gh(repo, 'POST', '/git/trees', { base_tree: base, tree })).data;
    if (t.sha === base) dlog('Nothing changed: the live game already has these exact files.', 'ok');
    else { const c = (await gh(repo, 'POST', '/git/commits', { message, tree: t.sha, parents: [head] })).data; await gh(repo, 'PATCH', '/git/refs/heads/' + branch, { sha: c.sha }); dlog('✓ Committed ' + c.sha.slice(0, 7) + ': ' + message, 'ok'); }
    try { const p = await gh(repo, 'GET', '/pages', null, [404]); if (p.status === 404) { await gh(repo, 'POST', '/pages', { source: { branch, path: '/' } }); dlog('✓ GitHub Pages switched on (first build takes a minute or two)', 'ok'); } else dlog('✓ GitHub Pages rebuilds in about a minute. tracks.json was left as it is.', 'ok'); }
    catch (e) { dlog('Could not check Pages (' + e.message + '). If the site is not live: Settings → Pages → Deploy from branch → ' + branch + ' / root.', 'err'); }
    dlog('Live at ' + gameUrl() + ' (hard-refresh with Ctrl+Shift+R)', 'ok');
  } catch (e) { dlog('✗ ' + e.message, 'err'); }
  finally { $('dpGo').disabled = false; }
}

// ---------- boot ----------
(async function boot() {
  $('gUrl').value = DCFG.sbUrl; $('gKey').value = DCFG.sbKey; if ($('gSrv')) $('gSrv').value = DCFG.srv || '';
  if (!DCFG.sbUrl) { try { const t = await (await fetch(gameUrl() + 'js/config.js?t=' + Date.now(), { cache: 'no-store' })).text(); const u = (t.match(/SUPABASE_URL:\s*["']([^"']*)["']/) || [])[1], k = (t.match(/SUPABASE_ANON_KEY:\s*["']([^"']*)["']/) || [])[1]; if (u && k) { $('gUrl').value = u; $('gKey').value = k; const gs = (t.match(/GAME_SERVER:\s*["']([^"']*)["']/) || [])[1]; if (gs && $('gSrv') && !$('gSrv').value) $('gSrv').value = gs; $('gAuto').textContent = 'Supabase settings read from the live game.'; } } catch (e) { } }
  $('gGo').onclick = () => unlock(false); $('gSecret').onkeydown = e => { if (e.key === 'Enter') unlock(false); };
  $('gGen').onclick = async () => { const r = crypto.getRandomValues(new Uint8Array(24)), A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = 'MDADMIN'; for (let i = 0; i < 24; i++) { if (i % 6 === 0) s += '-'; s += A[r[i] % 32]; } $('gSecret').value = s; $('gSecret').type = 'text'; showSql(await sha(s)); $('gGenMsg').textContent = 'Save this secret in your password manager now. It is not stored anywhere, only its hash goes into the SQL.'; };
  $('gOwn').onclick = async () => { const s = $('gSecret').value.trim(); if (s.length < 16) return $('gGenMsg').textContent = 'Use at least 16 characters (or press Generate).'; showSql(await sha(s)); $('gGenMsg').textContent = 'SQL made for the secret in the box above.'; };
  $('gCopy').onclick = () => navigator.clipboard.writeText($('gSql').value).then(() => toast('SQL copied. Paste it into Supabase → SQL Editor → Run.', 'ok'));
  document.querySelectorAll('.nv').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  $('lockBtn').onclick = lock; $('plGo').onclick = loadPlayers; $('plQ').oninput = renderPlayers; $('trP').onchange = () => trShow(); $('trLoad').onclick = loadPlayers; $('trSave').onclick = trSave; $('trReset').onclick = trReset; $('modal').onclick = e => { if (e.target.id === 'modal') closeModal(); }; $('plBody').onclick = plClick;
  $('lbGo').onclick = loadLaps; $('lbT').onchange = loadLaps; $('lbBody').onclick = lbClick; $('lbClear').onclick = () => clearTrack(+$('lbT').value || 0); $('lbPurge').onclick = purgeAll; $('dpGo').onclick = deployGame; $('svGo').onclick = deployServer; $('svRepo').value = DCFG.srvRepo || ((DCFG.gameRepo || 'owner/x').split('/')[0] + '/minidrifters-server');
  $('ghTok').oninput = () => $('ghState').classList.toggle('on', !!$('ghTok').value.trim());
  const s = localStorage.getItem('md_dev_secret'); if (s && DCFG.sbUrl) { $('gSecret').value = s; $('gRem').checked = true; unlock(true); }
})();

// ===== Deploy the multiplayer game server to GitHub =====
const SERVER_FILES = {"server.js": "Ly8gPT09PT0gTWluaSBEcmlmdGVycyBnYW1lIHNlcnZlciA9PT09PQovLyBBIHRpbnkgV2ViU29ja2V0IHJlbGF5OiB0aGUgaG9zdCdzIGdhbWUgc3RpbGwgcnVucyB0aGUgcmFjZSwgYnV0IGV2ZXJ5IG1lc3NhZ2UgZ29lcyB0aHJvdWdoIHRoaXMKLy8gc2VydmVyIGluc3RlYWQgb2YgdGhlIGhvc3QncyBvd24gaW50ZXJuZXQgY29ubmVjdGlvbi4gVGhhdCBtZWFuczoKLy8gIC0gdGhlIGhvc3Qgb25seSB1cGxvYWRzIE9ORSBjb3B5IG9mIGVhY2ggdXBkYXRlICh0aGUgc2VydmVyIGNvcGllcyBpdCB0byBldmVyeW9uZSkKLy8gIC0gbm8gcGVlci10by1wZWVyIGNvbm5lY3Rpb24gcHJvYmxlbXMgb24gc2Nob29sIC8gd29yayBXaS1GaQovLyAgLSBubyBwbGF5ZXIgbGltaXQgZnJvbSB0aGUgaG9zdCdzIHVwbG9hZCBzcGVlZAovLyBJdCBhbHNvIHNlcnZlcyB0aGUgT3BlbiByb29tcyBsaXN0IChyZXBsYWNlcyB0aGUgU3VwYWJhc2Ugcm9vbSBsaXN0KS4KLy8gUnVuOiAgbnBtIGluc3RhbGwgJiYgbnBtIHN0YXJ0ICAgICAgKFBPUlQgZW52IHZhciwgZGVmYXVsdCA4MDgwKQondXNlIHN0cmljdCc7CmNvbnN0IGh0dHAgPSByZXF1aXJlKCdodHRwJyk7CmNvbnN0IHsgV2ViU29ja2V0U2VydmVyIH0gPSByZXF1aXJlKCd3cycpOwoKY29uc3QgUE9SVCA9ICtwcm9jZXNzLmVudi5QT1JUIHx8IDgwODA7CmNvbnN0IE1BWF9NU0cgPSA2NCAqIDEwMjQ7ICAgICAgICAgIC8vIGlnbm9yZSBhbnl0aGluZyBiaWdnZXIgdGhhbiB0aGlzCmNvbnN0IE1BWF9QRVJfU0VDID0gMTIwOyAgICAgICAgICAgIC8vIHBlciBjb25uZWN0aW9uLCBnZW5lcm91cyAoZ2FtZSBzZW5kcyB+MjAvcykKY29uc3QgQ09ERV9SRSA9IC9eW0EtWjAtOV17MywxMn0kLzsKY29uc3QgQUxQSEEgPSAnQUJDREVGR0hKS0xNTlBRUlNUVVZXWFlaMjM0NTY3ODknOwoKY29uc3Qgcm9vbXMgPSBuZXcgTWFwKCk7ICAgICAgICAgICAgLy8gY29kZSAtPiB7IGhvc3QsIGNsaWVudHM6IE1hcChpZCAtPiB3cyksIG1ldGEsIHB1YmxpYywgY3JlYXRlZCB9CmxldCBuZXh0SWQgPSAxOwoKZnVuY3Rpb24gcmFuZENvZGUoKSB7IGxldCBzID0gJyc7IGZvciAobGV0IGkgPSAwOyBpIDwgNTsgaSsrKSBzICs9IEFMUEhBW01hdGguZmxvb3IoTWF0aC5yYW5kb20oKSAqIEFMUEhBLmxlbmd0aCldOyByZXR1cm4gczsgfQpmdW5jdGlvbiBzZW5kKHdzLCBvYmopIHsgaWYgKHdzICYmIHdzLnJlYWR5U3RhdGUgPT09IDEpIHRyeSB7IHdzLnNlbmQodHlwZW9mIG9iaiA9PT0gJ3N0cmluZycgPyBvYmogOiBKU09OLnN0cmluZ2lmeShvYmopKTsgfSBjYXRjaCAoZSkgeyB9IH0KZnVuY3Rpb24gcm9vbUxpc3QoKSB7CiAgY29uc3Qgb3V0ID0gW107CiAgZm9yIChjb25zdCBbY29kZSwgcl0gb2Ygcm9vbXMpIGlmIChyLnB1YmxpYyAmJiByLm1ldGEpIG91dC5wdXNoKE9iamVjdC5hc3NpZ24oe30sIHIubWV0YSwgeyBjb2RlLCBwbGF5ZXJzOiByLmNsaWVudHMuc2l6ZSArIDEgfSkpOwogIHJldHVybiBvdXQuc29ydCgoYSwgYikgPT4gKChhLmluUmFjZSB8IDApIC0gKGIuaW5SYWNlIHwgMCkpIHx8IChiLnBsYXllcnMgLSBhLnBsYXllcnMpKS5zbGljZSgwLCAyMDApOwp9Cgpjb25zdCBzZXJ2ZXIgPSBodHRwLmNyZWF0ZVNlcnZlcigocmVxLCByZXMpID0+IHsKICByZXMuc2V0SGVhZGVyKCdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nLCAnKicpOwogIHJlcy5zZXRIZWFkZXIoJ0NhY2hlLUNvbnRyb2wnLCAnbm8tc3RvcmUnKTsKICBjb25zdCB1cmwgPSAocmVxLnVybCB8fCAnLycpLnNwbGl0KCc/JylbMF07CiAgaWYgKHVybCA9PT0gJy9yb29tcycpIHsgcmVzLnNldEhlYWRlcignQ29udGVudC1UeXBlJywgJ2FwcGxpY2F0aW9uL2pzb24nKTsgcmV0dXJuIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkocm9vbUxpc3QoKSkpOyB9CiAgaWYgKHVybCA9PT0gJy8nIHx8IHVybCA9PT0gJy9oZWFsdGgnKSB7IHJlcy5zZXRIZWFkZXIoJ0NvbnRlbnQtVHlwZScsICd0ZXh0L3BsYWluJyk7IHJldHVybiByZXMuZW5kKCdNaW5pIERyaWZ0ZXJzIHNlcnZlciBPSy4gUm9vbXM6ICcgKyByb29tcy5zaXplICsgJ1xuJyk7IH0KICByZXMuc3RhdHVzQ29kZSA9IDQwNDsgcmVzLmVuZCgnbm90IGZvdW5kJyk7Cn0pOwoKY29uc3Qgd3NzID0gbmV3IFdlYlNvY2tldFNlcnZlcih7IHNlcnZlciwgbWF4UGF5bG9hZDogTUFYX01TRywgcGVyTWVzc2FnZURlZmxhdGU6IGZhbHNlIH0pOwoKd3NzLm9uKCdjb25uZWN0aW9uJywgd3MgPT4gewogIHdzLmlkID0gJ3AnICsgKG5leHRJZCsrKS50b1N0cmluZygzNikgKyBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zbGljZSgyLCA2KTsKICB3cy5yb29tID0gbnVsbDsgd3MuaXNIb3N0ID0gZmFsc2U7IHdzLmFsaXZlID0gdHJ1ZTsgd3MubiA9IDA7IHdzLm5UID0gRGF0ZS5ub3coKTsKICB3cy5vbigncG9uZycsICgpID0+IHsgd3MuYWxpdmUgPSB0cnVlOyB9KTsKICBzZW5kKHdzLCB7IG9wOiAnaWQnLCBpZDogd3MuaWQgfSk7CgogIHdzLm9uKCdtZXNzYWdlJywgKGJ1ZiwgaXNCaW4pID0+IHsKICAgIGlmIChpc0JpbikgcmV0dXJuOwogICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTsgaWYgKG5vdyAtIHdzLm5UID4gMTAwMCkgeyB3cy5uVCA9IG5vdzsgd3MubiA9IDA7IH0gaWYgKCsrd3MubiA+IE1BWF9QRVJfU0VDKSByZXR1cm47CiAgICBsZXQgbTsgdHJ5IHsgbSA9IEpTT04ucGFyc2UoYnVmLnRvU3RyaW5nKCkpOyB9IGNhdGNoIChlKSB7IHJldHVybjsgfQogICAgaWYgKCFtIHx8IHR5cGVvZiBtICE9PSAnb2JqZWN0JykgcmV0dXJuOwogICAgY29uc3QgciA9IHdzLnJvb20gJiYgcm9vbXMuZ2V0KHdzLnJvb20pOwogICAgc3dpdGNoIChtLm9wKSB7CiAgICAgIGNhc2UgJ2hvc3QnOiB7CiAgICAgICAgaWYgKHdzLnJvb20pIHJldHVybjsKICAgICAgICBsZXQgY29kZSA9IHR5cGVvZiBtLmNvZGUgPT09ICdzdHJpbmcnID8gbS5jb2RlLnRvVXBwZXJDYXNlKCkgOiAnJzsKICAgICAgICBpZiAoY29kZSAmJiAoIUNPREVfUkUudGVzdChjb2RlKSB8fCByb29tcy5oYXMoY29kZSkpKSByZXR1cm4gc2VuZCh3cywgeyBvcDogJ2VycicsIHR5cGU6ICd1bmF2YWlsYWJsZS1pZCcgfSk7CiAgICAgICAgaWYgKCFjb2RlKSB7IGRvIGNvZGUgPSByYW5kQ29kZSgpOyB3aGlsZSAocm9vbXMuaGFzKGNvZGUpKTsgfQogICAgICAgIHJvb21zLnNldChjb2RlLCB7IGhvc3Q6IHdzLCBjbGllbnRzOiBuZXcgTWFwKCksIG1ldGE6IG51bGwsIHB1YmxpYzogbS5wdWJsaWMgIT09IGZhbHNlLCBjcmVhdGVkOiBub3cgfSk7CiAgICAgICAgd3Mucm9vbSA9IGNvZGU7IHdzLmlzSG9zdCA9IHRydWU7IHNlbmQod3MsIHsgb3A6ICdob3N0ZWQnLCBjb2RlIH0pOwogICAgICAgIGJyZWFrOwogICAgICB9CiAgICAgIGNhc2UgJ2pvaW4nOiB7CiAgICAgICAgaWYgKHdzLnJvb20pIHJldHVybjsKICAgICAgICBjb25zdCBjb2RlID0gU3RyaW5nKG0uY29kZSB8fCAnJykudG9VcHBlckNhc2UoKSwgcm9vbSA9IHJvb21zLmdldChjb2RlKTsKICAgICAgICBpZiAoIXJvb20pIHJldHVybiBzZW5kKHdzLCB7IG9wOiAnZXJyJywgdHlwZTogJ3BlZXItdW5hdmFpbGFibGUnIH0pOwogICAgICAgIHdzLnJvb20gPSBjb2RlOyByb29tLmNsaWVudHMuc2V0KHdzLmlkLCB3cyk7CiAgICAgICAgc2VuZChyb29tLmhvc3QsIHsgb3A6ICdjb25uJywgaWQ6IHdzLmlkIH0pOyBzZW5kKHdzLCB7IG9wOiAnam9pbmVkJywgY29kZSB9KTsKICAgICAgICBicmVhazsKICAgICAgfQogICAgICBjYXNlICdtZXRhJzogaWYgKHIgJiYgd3MuaXNIb3N0ICYmIG0ubWV0YSAmJiB0eXBlb2YgbS5tZXRhID09PSAnb2JqZWN0JykgeyByLm1ldGEgPSBtLm1ldGE7IHIucHVibGljID0gbS5wdWJsaWMgIT09IGZhbHNlOyB9IGJyZWFrOwogICAgICBjYXNlICd1cCc6IGlmIChyICYmICF3cy5pc0hvc3QpIHNlbmQoci5ob3N0LCB7IG9wOiAnZnJvbScsIGlkOiB3cy5pZCwgZDogbS5kIH0pOyBicmVhazsgICAgICAgICAgLy8gY2xpZW50IC0+IGhvc3QKICAgICAgY2FzZSAndG8nOiBpZiAociAmJiB3cy5pc0hvc3QpIHNlbmQoci5jbGllbnRzLmdldChtLmlkKSwgeyBvcDogJ2QnLCBkOiBtLmQgfSk7IGJyZWFrOyAgICAgICAgICAgICAgLy8gaG9zdCAtPiBvbmUgY2xpZW50CiAgICAgIGNhc2UgJ2FsbCc6IGlmIChyICYmIHdzLmlzSG9zdCkgeyBjb25zdCBzID0gSlNPTi5zdHJpbmdpZnkoeyBvcDogJ2QnLCBkOiBtLmQgfSk7IGZvciAoY29uc3QgYyBvZiByLmNsaWVudHMudmFsdWVzKCkpIHNlbmQoYywgcyk7IH0gYnJlYWs7IC8vIGhvc3QgLT4gZXZlcnlvbmUgKHNlcmlhbGlzZWQgb25jZSkKICAgICAgY2FzZSAna2ljayc6IGlmIChyICYmIHdzLmlzSG9zdCkgeyBjb25zdCBjID0gci5jbGllbnRzLmdldChtLmlkKTsgaWYgKGMpIHsgci5jbGllbnRzLmRlbGV0ZShtLmlkKTsgYy5yb29tID0gbnVsbDsgc2VuZChjLCB7IG9wOiAnY2xvc2VkJyB9KTsgfSB9IGJyZWFrOwogICAgICBjYXNlICdsZWF2ZSc6IGxlYXZlKHdzKTsgYnJlYWs7CiAgICAgIGNhc2UgJ3BpbmcnOiBzZW5kKHdzLCB7IG9wOiAncG9uZycsIHQ6IG0udCB9KTsgYnJlYWs7CiAgICB9CiAgfSk7CiAgd3Mub24oJ2Nsb3NlJywgKCkgPT4gbGVhdmUod3MpKTsKICB3cy5vbignZXJyb3InLCAoKSA9PiB7IH0pOwp9KTsKCmZ1bmN0aW9uIGxlYXZlKHdzKSB7CiAgY29uc3QgY29kZSA9IHdzLnJvb207IGlmICghY29kZSkgcmV0dXJuOyB3cy5yb29tID0gbnVsbDsKICBjb25zdCByID0gcm9vbXMuZ2V0KGNvZGUpOyBpZiAoIXIpIHJldHVybjsKICBpZiAod3MuaXNIb3N0ICYmIHIuaG9zdCA9PT0gd3MpIHsgcm9vbXMuZGVsZXRlKGNvZGUpOyBmb3IgKGNvbnN0IGMgb2Ygci5jbGllbnRzLnZhbHVlcygpKSB7IGMucm9vbSA9IG51bGw7IHNlbmQoYywgeyBvcDogJ2hvc3Rnb25lJyB9KTsgfSB9CiAgZWxzZSBpZiAoci5jbGllbnRzLmRlbGV0ZSh3cy5pZCkpIHNlbmQoci5ob3N0LCB7IG9wOiAnY2xvc2UnLCBpZDogd3MuaWQgfSk7CiAgd3MuaXNIb3N0ID0gZmFsc2U7Cn0KCi8vIGRyb3AgZGVhZCBjb25uZWN0aW9ucyBldmVyeSAyMCBzIChhbHNvIGtlZXBzIHByb3hpZXMgZnJvbSBjbG9zaW5nIGlkbGUgc29ja2V0cykKc2V0SW50ZXJ2YWwoKCkgPT4geyBmb3IgKGNvbnN0IHdzIG9mIHdzcy5jbGllbnRzKSB7IGlmICghd3MuYWxpdmUpIHsgd3MudGVybWluYXRlKCk7IGNvbnRpbnVlOyB9IHdzLmFsaXZlID0gZmFsc2U7IHRyeSB7IHdzLnBpbmcoKTsgfSBjYXRjaCAoZSkgeyB9IH0gfSwgMjAwMDApOwoKc2VydmVyLmxpc3RlbihQT1JULCAoKSA9PiBjb25zb2xlLmxvZygnTWluaSBEcmlmdGVycyBzZXJ2ZXIgbGlzdGVuaW5nIG9uICcgKyBQT1JUKSk7Cm1vZHVsZS5leHBvcnRzID0geyBzZXJ2ZXIsIHJvb21zIH07Cg==", "package.json": "ewogICJuYW1lIjogIm1pbmlkcmlmdGVycy1zZXJ2ZXIiLAogICJ2ZXJzaW9uIjogIjEuMC4wIiwKICAicHJpdmF0ZSI6IHRydWUsCiAgImRlc2NyaXB0aW9uIjogIk1pbmkgRHJpZnRlcnMgbXVsdGlwbGF5ZXIgcmVsYXkgc2VydmVyIiwKICAibWFpbiI6ICJzZXJ2ZXIuanMiLAogICJzY3JpcHRzIjogeyAic3RhcnQiOiAibm9kZSBzZXJ2ZXIuanMiIH0sCiAgImVuZ2luZXMiOiB7ICJub2RlIjogIj49MTgiIH0sCiAgImRlcGVuZGVuY2llcyI6IHsgIndzIjogIl44LjE4LjAiIH0KfQo=", "render.yaml": "c2VydmljZXM6CiAgLSB0eXBlOiB3ZWIKICAgIG5hbWU6IG1pbmlkcmlmdGVycy1zZXJ2ZXIKICAgIHJ1bnRpbWU6IG5vZGUKICAgIHJlZ2lvbjogZnJhbmtmdXJ0CiAgICBwbGFuOiBmcmVlCiAgICBidWlsZENvbW1hbmQ6IG5wbSBpbnN0YWxsCiAgICBzdGFydENvbW1hbmQ6IG5wbSBzdGFydAogICAgaGVhbHRoQ2hlY2tQYXRoOiAvaGVhbHRoCg==", "Dockerfile": "RlJPTSBub2RlOjIwLWFscGluZQpXT1JLRElSIC9hcHAKQ09QWSBwYWNrYWdlLmpzb24gLi8KUlVOIG5wbSBpbnN0YWxsIC0tb21pdD1kZXYKQ09QWSBzZXJ2ZXIuanMgLi8KRU5WIFBPUlQ9ODA4MApFWFBPU0UgODA4MApDTUQgWyJub2RlIiwgInNlcnZlci5qcyJdCg==", "fly.toml": "IyBGbHkuaW86IExvbmRvbiByZWdpb24gPSBsb3dlc3QgbGFnIGluIHRoZSBVSy4gRGVwbG95IHdpdGg6ICBmbHkgbGF1bmNoIC0tY29weS1jb25maWcgLS1uby1kZXBsb3kgJiYgZmx5IGRlcGxveQphcHAgPSAibWluaWRyaWZ0ZXJzLXNlcnZlciIKcHJpbWFyeV9yZWdpb24gPSAibGhyIgoKW2J1aWxkXQoKW2h0dHBfc2VydmljZV0KICBpbnRlcm5hbF9wb3J0ID0gODA4MAogIGZvcmNlX2h0dHBzID0gdHJ1ZQogIGF1dG9fc3RvcF9tYWNoaW5lcyA9ICJzdG9wIgogIGF1dG9fc3RhcnRfbWFjaGluZXMgPSB0cnVlCiAgbWluX21hY2hpbmVzX3J1bm5pbmcgPSAwCgpbW3ZtXV0KICBzaXplID0gInNoYXJlZC1jcHUtMXgiCiAgbWVtb3J5ID0gIjI1Nm1iIgo=", "README.md": "IyBNaW5pIERyaWZ0ZXJzIGdhbWUgc2VydmVyCgpBIHNtYWxsIFdlYlNvY2tldCByZWxheSBmb3IgbXVsdGlwbGF5ZXIuIFJhY2VzIGFuZCB0aGUgT3BlbiByb29tcyBsaXN0IGdvIHRocm91Z2ggdGhpcyBzZXJ2ZXIgaW5zdGVhZCBvZgpwZWVyLXRvLXBlZXIsIHNvIGl0J3Mgc21vb3RoZXIsIHdvcmtzIG9uIFdpLUZpIHRoYXQgYmxvY2tzIHBlZXItdG8tcGVlciwgYW5kIGhhbmRsZXMgZmFyIG1vcmUgcGxheWVycy4KTGVhZGVyYm9hcmRzIGFuZCBhY2NvdW50cyBzdGlsbCB1c2UgU3VwYWJhc2UgKHRoYXQgcGFydCBpc24ndCByZWFsLXRpbWUsIHNvIGl0IGRvZXNuJ3QgY2F1c2UgbGFnKS4KCiMjIEVhc2llc3Q6IFJlbmRlciAoZnJlZSkKMS4gUHV0IHRoaXMgYHNlcnZlcmAgZm9sZGVyIGluIGl0cyBvd24gR2l0SHViIHJlcG8gKGUuZy4gYG1pbmlkcmlmdGVycy1zZXJ2ZXJgKS4KMi4gT24gaHR0cHM6Ly9yZW5kZXIuY29tIHNpZ24gaW4gd2l0aCBHaXRIdWIg4oaSICoqTmV3IOKGkiBCbHVlcHJpbnQqKiDihpIgcGljayB0aGUgcmVwbyAoaXQgcmVhZHMgYHJlbmRlci55YW1sYCkuCjMuIFdoZW4gaXQncyBsaXZlIHlvdSBnZXQgYSBVUkwgbGlrZSBgaHR0cHM6Ly9taW5pZHJpZnRlcnMtc2VydmVyLm9ucmVuZGVyLmNvbWAuCjQuIEluIHRoZSBkZXYgZGFzaGJvYXJkIOKGkiBTZXR0aW5ncywgcGFzdGUgaXQgaW50byAqKkdhbWUgc2VydmVyIFVSTCoqIGFuZCBwdWJsaXNoLiAoT3IgZWRpdCBganMvY29uZmlnLmpzYDoKICAgYEdBTUVfU0VSVkVSOiAnd3NzOi8vbWluaWRyaWZ0ZXJzLXNlcnZlci5vbnJlbmRlci5jb20nYC4pCgpUaGUgZnJlZSBwbGFuIHNsZWVwcyBhZnRlciAxNSBtaW51dGVzIHdpdGggbm9ib2R5IG9uIGl0OyB0aGUgZmlyc3QgcGVyc29uIHRvIG9wZW4gTXVsdGlwbGF5ZXIgd2FrZXMgaXQKKHRha2VzIHVwIHRvIGFib3V0IGEgbWludXRlKS4gVGhlIGdhbWUgc2hvd3MgIndha2luZyB0aGUgc2VydmVyIHVwIiB3aGlsZSB0aGF0IGhhcHBlbnMuCgojIyBMb3dlc3QgbGFnIGluIHRoZSBVSzogRmx5LmlvIChMb25kb24pCk5lZWRzIGEgY2FyZCwgY29zdHMgYSBmZXcgcGVuY2UvcG91bmRzIGEgbW9udGggZm9yIHRoaXMgc2l6ZS4KYGBgCmZseSBsYXVuY2ggLS1jb3B5LWNvbmZpZyAtLW5vLWRlcGxveQpmbHkgZGVwbG95CmBgYApVUkw6IGB3c3M6Ly88eW91ci1hcHA+LmZseS5kZXZgCgojIyBSYWlsd2F5IC8gYW55IFZQUwpJdCdzIGEgbm9ybWFsIE5vZGUgYXBwOiBgbnBtIGluc3RhbGwgJiYgbnBtIHN0YXJ0YCwgbGlzdGVucyBvbiBgJFBPUlRgIChkZWZhdWx0IDgwODApLiBBIERvY2tlcmZpbGUgaXMgaW5jbHVkZWQuCgojIyBDaGVjayBpdApPcGVuIHRoZSBVUkwgaW4gYSBicm93c2VyOiBpdCBzaG91bGQgc2F5IGBNaW5pIERyaWZ0ZXJzIHNlcnZlciBPS2AuIGAvcm9vbXNgIGxpc3RzIG9wZW4gcm9vbXMuCg=="};
function slog(m, c) { const d = document.createElement('div'); d.className = c || ''; d.textContent = m; $('svLog').appendChild(d); $('svLog').scrollTop = 1e9; }
async function deployServer() {
  $('svLog').innerHTML = ''; $('svGo').disabled = true;
  try {
    let repo = $('svRepo').value.trim().replace(/^https?:\/\/github.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Server repo should look like owner/name');
    if (!Object.keys(SERVER_FILES).length) throw new Error('This dev site has no server files bundled. Rebuild it.');
    DCFG.srvRepo = repo; saveD();
    slog('Checking ' + repo + '…');
    let info = await gh(repo, 'GET', '', null, [404]);
    if (info.status === 404) {
      slog('Repo not found, trying to create it…', 'dim');
      const r = await fetch(H + 'api.github.com/user/repos', { method: 'POST', headers: { Authorization: 'Bearer ' + token(), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: repo.split('/')[1], description: 'Mini Drifters multiplayer game server', private: false, auto_init: true }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error('Could not create ' + repo + ' (' + (j.message || 'HTTP ' + r.status) + '). Make an empty repo with that name at github.com/new (tick "Add a README"), make sure your token includes it with Contents: Read and write, then press again.');
      if (j.full_name && j.full_name.toLowerCase() !== repo.toLowerCase()) { repo = j.full_name; $('svRepo').value = repo; DCFG.srvRepo = repo; saveD(); }
      slog('✓ Created ' + repo, 'ok');
      for (let k = 0; k < 6; k++) { await new Promise(r => setTimeout(r, 1500)); info = await gh(repo, 'GET', '', null, [404]); if (info.status === 200) break; }
      if (info.status !== 200) throw new Error('Created ' + repo + ' but this token cannot see it. Add the repo to your token (Contents: Read and write), then press again.');
    }
    if (info.data.permissions && !info.data.permissions.push) throw new Error('This token can read ' + repo + ' but not write to it (needs Contents: Read and write)');
    const branch = info.data.default_branch || 'main';
    let ref = await gh(repo, 'GET', '/git/ref/heads/' + branch, null, [404, 409]);
    if (ref.status !== 200) { slog('Repo is empty, creating the first commit…', 'dim'); await gh(repo, 'PUT', '/contents/README.md', { message: 'Initial commit', content: SERVER_FILES['README.md'], branch }); ref = await gh(repo, 'GET', '/git/ref/heads/' + branch); }
    const head = ref.data.object.sha, base = (await gh(repo, 'GET', '/git/commits/' + head)).data.tree.sha; slog('✓ Access OK, ' + branch + ' is at ' + head.slice(0, 7), 'ok');
    const sub = repo.toLowerCase() === String(DCFG.gameRepo || '').toLowerCase() ? 'server/' : '';
    const files = Object.assign({}, SERVER_FILES);
    if (sub) files['render.yaml'] = btoa(atob(files['render.yaml']).replace('    runtime: node\n', '    runtime: node\n    rootDir: server\n'));
    const tree = [], paths = Object.keys(files); let n = 0;
    for (const p of paths) { const b = (await gh(repo, 'POST', '/git/blobs', { content: files[p], encoding: 'base64' })).data; const path = (p === 'render.yaml' ? '' : sub) + p; tree.push({ path, mode: '100644', type: 'blob', sha: b.sha }); slog(`  uploaded ${path} (${++n}/${paths.length})`, 'dim'); }
    const t = (await gh(repo, 'POST', '/git/trees', { base_tree: base, tree })).data;
    if (t.sha === base) slog('Nothing changed: the repo already has these exact files.', 'ok');
    else { const c = (await gh(repo, 'POST', '/git/commits', { message: 'Update Mini Drifters game server', tree: t.sha, parents: [head] })).data; await gh(repo, 'PATCH', '/git/refs/heads/' + branch, { sha: c.sha }); slog('✓ Committed ' + c.sha.slice(0, 7) + ' to ' + repo, 'ok'); }
    slog('Next: render.com → New → Blueprint → pick ' + repo + '. When it says Live, copy its URL into Settings → Game server URL, then press DEPLOY GAME. (If Render is already set up it redeploys by itself.)', 'ok');
  } catch (e) { slog('✗ ' + e.message, 'err'); }
  finally { $('svGo').disabled = false; }
}

// ===== custom dropdowns: replaces the browser's native <select> look, keeps the real select underneath =====
(function () {
  const P = HTMLSelectElement.prototype, dV = Object.getOwnPropertyDescriptor(P, 'value'), dI = Object.getOwnPropertyDescriptor(P, 'selectedIndex');
  let open = null;
  const close = () => { if (!open) return; open.w.classList.remove('open'); open.list.remove(); open = null; };
  const pick = (s, i) => { if (i < 0 || i >= s.options.length || s.options[i].disabled) return; if (s.selectedIndex !== i) { dI.set.call(s, i); s._csUpd(); s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); } };
  function enh(s) {
    if (s.dataset.cs || s.multiple || s.size > 1 || !s.parentNode) return; s.dataset.cs = '1';
    const w = document.createElement('div'); w.className = 'csel'; const b = document.createElement('button'); b.type = 'button'; b.className = 'csel-btn';
    if (s.id) w.dataset.for = s.id; s.parentNode.insertBefore(w, s); w.appendChild(s); w.appendChild(b); s.tabIndex = -1;
    const upd = () => { const o = s.options[s.selectedIndex]; b.textContent = o ? o.textContent : ''; b.disabled = s.disabled; w.classList.toggle('dis', s.disabled); w.classList.toggle('hidden', s.classList.contains('hidden')); w.style.display = s.style.display === 'none' ? 'none' : ''; };
    s._csUpd = upd; upd();
    Object.defineProperty(s, 'value', { configurable: true, get() { return dV.get.call(this); }, set(v) { dV.set.call(this, v); upd(); } });
    Object.defineProperty(s, 'selectedIndex', { configurable: true, get() { return dI.get.call(this); }, set(v) { dI.set.call(this, v); upd(); } });
    s.addEventListener('change', upd);
    new MutationObserver(upd).observe(s, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'selected', 'class', 'style'] });
    b.addEventListener('keydown', e => { const k = e.key; if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); let i = s.selectedIndex; do { i += k === 'ArrowDown' ? 1 : -1; } while (i >= 0 && i < s.options.length && s.options[i].disabled); pick(s, i); if (open) { close(); b.click(); } } });
    b.addEventListener('click', e => {
      e.stopPropagation(); if (open && open.s === s) return close(); close(); if (s.disabled) return;
      const list = document.createElement('div'); list.className = 'csel-list';
      [...s.options].forEach((o, i) => { if (o.hidden) return; const it = document.createElement('div'); it.className = 'csel-opt' + (i === s.selectedIndex ? ' sel' : '') + (o.disabled ? ' dis' : ''); it.textContent = o.textContent;
        it.addEventListener('mousedown', ev => { ev.preventDefault(); ev.stopPropagation(); if (o.disabled) return; pick(s, i); close(); b.focus(); }); list.appendChild(it); });
      document.body.appendChild(list); const r = b.getBoundingClientRect(), below = innerHeight - r.bottom - 10, above = r.top - 10, h = Math.min(list.scrollHeight, 320);
      list.style.minWidth = r.width + 'px'; list.style.left = Math.max(6, Math.min(r.left, innerWidth - list.offsetWidth - 6)) + 'px';
      if (below < h && above > below) { list.style.bottom = (innerHeight - r.top + 4) + 'px'; list.style.maxHeight = Math.min(320, above) + 'px'; } else { list.style.top = (r.bottom + 4) + 'px'; list.style.maxHeight = Math.max(100, Math.min(320, below)) + 'px'; }
      const cur = list.querySelector('.sel'); if (cur) cur.scrollIntoView({ block: 'nearest' });
      w.classList.add('open'); open = { s, w, list };
    });
  }
  document.addEventListener('mousedown', e => { if (open && !open.list.contains(e.target) && !open.w.contains(e.target)) close(); }, true);
  document.addEventListener('scroll', e => { if (open && !open.list.contains(e.target)) close(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) { close(); e.stopPropagation(); e.preventDefault(); } }, true);
  addEventListener('resize', close);
  const scan = n => { if (n.tagName === 'SELECT') enh(n); else if (n.querySelectorAll) n.querySelectorAll('select').forEach(enh); };
  const go = () => { scan(document.body); new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) scan(n); }).observe(document.body, { childList: true, subtree: true }); };
  if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
  window.cselRefresh = () => document.querySelectorAll('select').forEach(s => s._csUpd && s._csUpd());
})();
