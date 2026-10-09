addEventListener('error', e => { console.error(e.error || e.message); try { toast('Error: ' + String((e.error && e.error.message) || e.message).slice(0, 160), 'err'); } catch (x) { } });
addEventListener('unhandledrejection', e => { console.error(e.reason); try { toast('Error: ' + String((e.reason && e.reason.message) || e.reason).slice(0, 160), 'err'); } catch (x) { } });
// ===== Mini Drifters dev site: access gate, players, leaderboard moderation, deploy =====
// Security model: this site's code is public, so the gate is NOT what protects anything by itself.
// Player keys + moderation are protected by Supabase functions that check the admin secret on the server.
// Publishing/deploying is protected by the GitHub token, which only lives in this tab's memory.
const $ = id => document.getElementById(id);
const H = 'https:' + '//';
const ADMIN_SQL = "-- Mini Drifters: complete Supabase setup (game + admin). Paste into Supabase -> SQL Editor and press Run.\n-- Works on an empty project and is safe to run again. The admin secret is never stored, only its SHA-256 hash.\ncreate extension if not exists pgcrypto with schema extensions;\ngrant usage on schema public to anon;\n\n-- ===== tables =====\ncreate table if not exists public.profiles (id text primary key, data jsonb not null, updated_at timestamptz default now());\n\n-- one row per player per track: their best lap. Faster laps replace it (see submit_lap).\ncreate table if not exists public.laps (\n  id bigint generated always as identity primary key,\n  track int not null, pid text not null, name text, color text, body text,\n  lap_ms int not null check (lap_ms > 3000), score int, created_at timestamptz default now(),\n  unique (track, pid));\ncreate index if not exists laps_track_ms on public.laps (track, lap_ms);\n\ncreate table if not exists public.player_keys (pid text primary key, key text not null, name text,\n  created_at timestamptz default now(), updated_at timestamptz default now());\n\ncreate table if not exists public.admin_config (id int primary key default 1, secret_hash text not null);\ninsert into public.admin_config (id, secret_hash) values (1, '__HASH__')\n  on conflict (id) do update set secret_hash = excluded.secret_hash;\n\n-- ===== access rules =====\nalter table public.profiles enable row level security;\nalter table public.laps enable row level security;\nalter table public.player_keys enable row level security;   -- no policies = no public access\nalter table public.admin_config enable row level security;  -- no policies = no public access\n\ndrop policy if exists \"read laps\" on public.laps;\ndrop policy if exists \"add laps\" on public.laps;\ndrop policy if exists \"read profile\" on public.profiles;\ndrop policy if exists \"save profile\" on public.profiles;\ndrop policy if exists \"update profile\" on public.profiles;\ncreate policy \"read laps\" on public.laps for select using (true);           -- laps are only written through submit_lap\ncreate policy \"read profile\" on public.profiles for select using (true);\ncreate policy \"save profile\" on public.profiles for insert with check (true);\ncreate policy \"update profile\" on public.profiles for update using (true);\ngrant select on public.laps to anon;\ngrant select, insert, update on public.profiles to anon;\n\n-- ===== game functions =====\n-- save a lap: adds the player's time, or replaces it only if the new lap is faster\ncreate or replace function public.submit_lap(p_track int, p_pid text, p_name text, p_color text, p_body text, p_lap_ms int, p_score int)\nreturns void language sql security definer set search_path = public as $$\n  insert into laps (track, pid, name, color, body, lap_ms, score)\n  values (p_track, left(p_pid, 24), left(p_name, 14), left(p_color, 24), left(p_body, 24), p_lap_ms, p_score)\n  on conflict (track, pid) do update\n    set lap_ms = excluded.lap_ms, score = excluded.score, name = excluded.name, color = excluded.color, body = excluded.body, created_at = now()\n    where excluded.lap_ms < laps.lap_ms;\n$$;\n\n-- name changes: only the owner of an account key can rename their leaderboard times\ncreate or replace function public.rename_player(p_key text, p_name text) returns void\nlanguage sql security definer set search_path = public, extensions as $$\n  update public.laps set name = left(btrim(p_name), 14)\n  where pid = left(encode(extensions.digest('pub:' || p_key, 'sha256'), 'hex'), 24)\n    and length(btrim(p_name)) between 2 and 14;\n$$;\n\n-- remembers account keys so a forgotten key can be looked up by name on the dev dashboard\ncreate or replace function public.register_key(p_key text, p_name text) returns void\nlanguage plpgsql security definer set search_path = public, extensions as $$\nbegin\n  if p_key !~ '^MD-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$' then return; end if;\n  insert into player_keys (pid, key, name) values (substr(encode(digest('pub:' || p_key, 'sha256'), 'hex'), 1, 24), p_key, left(coalesce(p_name, ''), 14))\n  on conflict (pid) do update set name = excluded.name, updated_at = now();\nend $$;\n\n-- ===== admin functions (dev dashboard) =====\ncreate or replace function public.md_is_admin(p_secret text) returns boolean\nlanguage sql security definer set search_path = public, extensions as $$\n  select exists (select 1 from admin_config where id = 1 and secret_hash = encode(digest(coalesce(p_secret, ''), 'sha256'), 'hex'));\n$$;\n\ncreate or replace function public.admin_check(p_secret text) returns boolean\nlanguage plpgsql security definer set search_path = public, extensions as $$\nbegin\n  if not md_is_admin(p_secret) then perform pg_sleep(1); return false; end if;  -- slows down guessing\n  return true;\nend $$;\n\ncreate or replace function public.admin_find_players(p_secret text, p_query text)\nreturns table (pid text, key text, name text, created_at timestamptz, updated_at timestamptz, best_ms int, laps bigint)\nlanguage plpgsql security definer set search_path = public, extensions as $$\nbegin\n  if not md_is_admin(p_secret) then perform pg_sleep(1); raise exception 'not allowed'; end if;\n  return query select k.pid, k.key, k.name, k.created_at, k.updated_at,\n    (select min(l.lap_ms)::int from laps l where l.pid = k.pid), (select count(*) from laps l where l.pid = k.pid)\n  from player_keys k\n  where coalesce(p_query, '') = '' or k.name ilike '%' || p_query || '%' or k.pid ilike p_query || '%' or k.key ilike '%' || p_query || '%'\n  order by k.updated_at desc limit 200;\nend $$;\n\ncreate or replace function public.admin_rename(p_secret text, p_pid text, p_name text) returns void\nlanguage plpgsql security definer set search_path = public, extensions as $$\nbegin\n  if not md_is_admin(p_secret) then raise exception 'not allowed'; end if;\n  update player_keys set name = left(p_name, 14), updated_at = now() where pid = p_pid;\n  update laps set name = left(p_name, 14) where pid = p_pid;\nend $$;\n\ncreate or replace function public.admin_delete_lap(p_secret text, p_id bigint) returns void\nlanguage plpgsql security definer set search_path = public, extensions as $$\nbegin\n  if not md_is_admin(p_secret) then raise exception 'not allowed'; end if;\n  delete from laps where id = p_id;\nend $$;\n\ncreate or replace function public.admin_clear_track(p_secret text, p_track int) returns void\nlanguage plpgsql security definer set search_path = public, extensions as $$\nbegin\n  if not md_is_admin(p_secret) then raise exception 'not allowed'; end if;\n  delete from laps where track = p_track;\nend $$;\n\n-- Purge all: deletes every lap time on every track\ncreate or replace function public.admin_purge_all(p_secret text) returns bigint\nlanguage plpgsql security definer set search_path = public, extensions as $$\ndeclare n bigint;\nbegin\n  if not md_is_admin(p_secret) then perform pg_sleep(1); raise exception 'not allowed'; end if;\n  delete from laps where true; get diagnostics n = row_count; return n;\nend $$;\n\n-- ===== who can call what =====\nrevoke all on function public.md_is_admin(text) from public, anon, authenticated;\ngrant execute on function public.submit_lap(int, text, text, text, text, int, int) to anon;\ngrant execute on function public.rename_player(text, text) to anon;\ngrant execute on function public.register_key(text, text) to anon;\ngrant execute on function public.admin_check(text) to anon;\ngrant execute on function public.admin_find_players(text, text) to anon;\ngrant execute on function public.admin_rename(text, text, text) to anon;\ngrant execute on function public.admin_delete_lap(text, bigint) to anon;\ngrant execute on function public.admin_clear_track(text, int) to anon;\ngrant execute on function public.admin_purge_all(text) to anon;\n\nnotify pgrst, 'reload schema';\n";
const DCFG = Object.assign({ sbUrl: '', sbKey: '', gameRepo: 'georgelloydd/minidrifters', branch: 'main', gameUrl: '' }, JSON.parse(localStorage.getItem('md_dev_cfg') || '{}'));
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
  DCFG.sbUrl = $('gUrl').value.trim(); DCFG.sbKey = $('gKey').value.trim(); saveD(); SECRET = $('gSecret').value.trim(); $('gMsg').textContent = '';
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
function setTab(t) { document.querySelectorAll('.nv').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); document.querySelectorAll('.tab').forEach(s => s.classList.toggle('hidden', s.id !== 'tab-' + t)); if (t === 'tracks') BLD_resize(); if (t === 'lb') lbTrackSelect(); }
let ENTERED = false;
function enterApp() {
  if (ENTERED) return; ENTERED = true;
  $('gameLink').href = gameUrl(); $('gameLink').textContent = gameUrl().replace(/^https?:\/\//, '');
  $('dpRepo').value = DCFG.gameRepo; $('dpUrl').value = DCFG.gameUrl; $('dpSb').checked = true; $('dpSbInfo').textContent = DCFG.sbUrl ? sbBase().replace(/^https?:\/\//, '') : 'not set';
  $('dpN').textContent = Object.keys(GAME_FILES).length;
  BLD_init(); setTab('tracks');
}

// ---------- players ----------
let PL = [];
async function findPlayers() {
  $('plBody').innerHTML = '<tr><td colspan="7" class="dim">Searching…</td></tr>';
  try { PL = await rpc('admin_find_players', { p_query: $('plQ').value.trim() }) || []; }
  catch (e) { $('plBody').innerHTML = `<tr><td colspan="7" class="err">${esc(e.message)}</td></tr>`; return; }
  $('plCount').textContent = PL.length + (PL.length === 200 ? '+ ' : ' ') + 'players';
  if (!PL.length) { $('plBody').innerHTML = '<tr><td colspan="7" class="dim">No players found. Players appear here after they open the updated game once.</td></tr>'; return; }
  $('plBody').innerHTML = PL.map((p, i) => `<tr><td><b>${esc(p.name || '—')}</b></td><td class="mono"><span class="key" data-i="${i}">MD-••••-••••-••••</span> <button class="mini" data-show="${i}">Show</button> <button class="mini" data-copy="${i}">Copy</button></td><td class="mono dim">${esc(p.pid.slice(0, 10))}…</td><td class="mono">${fmtMs(p.best_ms)}</td><td>${p.laps || 0}</td><td class="dim">${p.updated_at ? new Date(p.updated_at).toLocaleString() : ''}</td><td><button class="mini" data-ren="${i}">Rename</button></td></tr>`).join('');
}
function plClick(e) {
  const b = e.target.closest('button'); if (!b) return; const p = PL[+(b.dataset.show || b.dataset.copy || b.dataset.ren)];
  if (b.dataset.show !== undefined) { const s = document.querySelector(`.key[data-i="${b.dataset.show}"]`); const on = b.textContent === 'Show'; s.textContent = on ? p.key : 'MD-••••-••••-••••'; b.textContent = on ? 'Hide' : 'Show'; }
  if (b.dataset.copy !== undefined) navigator.clipboard.writeText(p.key).then(() => toast('Key copied for ' + p.name + '. Send it to them privately: anyone with it can use their account.', 'ok'));
  if (b.dataset.ren !== undefined) { const n = prompt('New name for ' + p.name + ' (max 14 characters):', p.name); if (!n || !n.trim()) return; rpc('admin_rename', { p_pid: p.pid, p_name: n.trim().slice(0, 14) }).then(() => { toast('Renamed. Their leaderboard times now show ' + n.trim().slice(0, 14) + '.', 'ok'); findPlayers(); }).catch(er => toast(er.message, 'err')); }
}

// ---------- leaderboard moderation ----------
let LBR = [];
function lbTrackSelect() { const s = $('lbT'), v = s.value; s.innerHTML = BLD.list.map((t, i) => `<option value="${i}">${i + 1}. ${esc(t.name)}${t.hidden ? ' (hidden)' : ''}</option>`).join(''); if (v) s.value = v; }
async function loadLaps() {
  const t = +$('lbT').value || 0; $('lbBody').innerHTML = '<tr><td colspan="5" class="dim">Loading…</td></tr>';
  try { LBR = await sb('GET', `laps?track=eq.${t}&select=id,name,pid,lap_ms,created_at&order=lap_ms.asc&limit=200`) || []; } catch (e) { $('lbBody').innerHTML = `<tr><td colspan="5" class="err">${esc(e.message)}</td></tr>`; return; }
  $('lbBody').innerHTML = LBR.length ? LBR.map((r, i) => `<tr><td>${i + 1}</td><td><b>${esc(r.name)}</b> <span class="dim mono">${esc(r.pid.slice(0, 8))}</span></td><td class="mono">${fmtMs(r.lap_ms)}</td><td class="dim">${new Date(r.created_at).toLocaleString()}</td><td><button class="mini red" data-del="${i}">Delete</button></td></tr>`).join('') : '<tr><td colspan="5" class="dim">No lap times on this track yet.</td></tr>';
}
async function lbClick(e) { const b = e.target.closest('[data-del]'); if (!b) return; const r = LBR[+b.dataset.del]; if (!confirm(`Delete ${r.name}'s ${fmtMs(r.lap_ms)}?`)) return; try { await rpc('admin_delete_lap', { p_id: r.id }); toast('Lap deleted.', 'ok'); loadLaps(); } catch (er) { toast(er.message, 'err'); } }
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
    if ($('dpSb').checked && DCFG.sbUrl && DCFG.sbKey) { files['js/config.js'] = b64('// ===== Online services (written by the Mini Drifters dev site) =====\nconst ONLINE = {\n  SUPABASE_URL: ' + JSON.stringify(sbBase()) + ',\n  SUPABASE_ANON_KEY: ' + JSON.stringify(DCFG.sbKey.trim()) + ',\n};\n'); dlog('Writing js/config.js with your Supabase project', 'dim'); }
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
  $('gUrl').value = DCFG.sbUrl; $('gKey').value = DCFG.sbKey;
  if (!DCFG.sbUrl) { try { const t = await (await fetch(gameUrl() + 'js/config.js?t=' + Date.now(), { cache: 'no-store' })).text(); const u = (t.match(/SUPABASE_URL:\s*["']([^"']*)["']/) || [])[1], k = (t.match(/SUPABASE_ANON_KEY:\s*["']([^"']*)["']/) || [])[1]; if (u && k) { $('gUrl').value = u; $('gKey').value = k; $('gAuto').textContent = 'Supabase settings read from the live game.'; } } catch (e) { } }
  $('gGo').onclick = () => unlock(false); $('gSecret').onkeydown = e => { if (e.key === 'Enter') unlock(false); };
  $('gGen').onclick = async () => { const r = crypto.getRandomValues(new Uint8Array(24)), A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = 'MDADMIN'; for (let i = 0; i < 24; i++) { if (i % 6 === 0) s += '-'; s += A[r[i] % 32]; } $('gSecret').value = s; $('gSecret').type = 'text'; showSql(await sha(s)); $('gGenMsg').textContent = 'Save this secret in your password manager now. It is not stored anywhere, only its hash goes into the SQL.'; };
  $('gOwn').onclick = async () => { const s = $('gSecret').value.trim(); if (s.length < 16) return $('gGenMsg').textContent = 'Use at least 16 characters (or press Generate).'; showSql(await sha(s)); $('gGenMsg').textContent = 'SQL made for the secret in the box above.'; };
  $('gCopy').onclick = () => navigator.clipboard.writeText($('gSql').value).then(() => toast('SQL copied. Paste it into Supabase → SQL Editor → Run.', 'ok'));
  document.querySelectorAll('.nv').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  $('lockBtn').onclick = lock; $('plGo').onclick = findPlayers; $('plQ').onkeydown = e => { if (e.key === 'Enter') findPlayers(); }; $('plBody').onclick = plClick;
  $('lbGo').onclick = loadLaps; $('lbT').onchange = loadLaps; $('lbBody').onclick = lbClick; $('lbClear').onclick = () => clearTrack(+$('lbT').value || 0); $('lbPurge').onclick = purgeAll; $('dpGo').onclick = deployGame;
  $('ghTok').oninput = () => $('ghState').classList.toggle('on', !!$('ghTok').value.trim());
  const s = localStorage.getItem('md_dev_secret'); if (s && DCFG.sbUrl) { $('gSecret').value = s; $('gRem').checked = true; unlock(true); }
})();
