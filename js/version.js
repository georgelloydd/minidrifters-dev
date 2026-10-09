// "Last updated" stamp + new-version check (DEV_BUILD comes from js/build.js, written by the build)
(function () {
  const B = typeof DEV_BUILD !== 'undefined' ? DEV_BUILD : null;
  const fmtT = t => { const d = new Date(t); return isNaN(d) ? '?' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  const ago = t => { const s = (Date.now() - Date.parse(t)) / 1000; return s < 90 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; };
  const tag = document.createElement('div'); tag.id = 'verTag'; document.body.appendChild(tag);
  let newer = null;
  function paint() {
    if (!B) { tag.textContent = 'Last updated: unknown build'; return; }
    if (newer) { tag.className = 'new'; tag.innerHTML = `<b>New version available</b> · ${fmtT(newer.time)} · click to reload`; tag.title = 'You are on build ' + B.id + ', the newest is ' + newer.id; return; }
    tag.className = ''; tag.innerHTML = `Last updated <b>${fmtT(B.time)}</b> <span>(${ago(B.time)}) · build ${B.id}</span>`; tag.title = 'Dev site build ' + B.id + ' · bundles game build ' + B.game.id;
  }
  tag.onclick = () => { if (newer) location.reload(); };
  async function checkSelf() {
    if (!B || location.protocol === 'file:') return;
    try { const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' }); if (!r.ok) return; const v = await r.json();
      newer = v.id !== B.id && Date.parse(v.time) > Date.parse(B.time) ? v : null; paint(); } catch (e) { }
  }
  // Deploy tab: what this dev site would deploy vs what the live game is running
  async function checkGame() {
    const el = document.getElementById('dpVer'); if (!el || !B || typeof gameUrl !== 'function' || typeof DCFG === 'undefined') return;
    let live = null; try { const r = await fetch(gameUrl() + 'version.json?t=' + Date.now(), { cache: 'no-store' }); if (r.ok) live = await r.json(); } catch (e) { }
    const mine = `This dev site deploys game build <b>${B.game.id}</b> (${fmtT(B.game.time)}).`;
    if (!live) el.innerHTML = mine + ' <span class="err">Live game: no version info yet (deployed before version stamps were added). Deploy to update it.</span>';
    else if (live.id === B.game.id) el.innerHTML = mine + ` <span class="ok">✓ Live game is up to date (deployed build ${live.id}).</span>`;
    else el.innerHTML = mine + ` <span class="err">Live game is on build ${esc2(live.id)} (${fmtT(live.time)}). ${Date.parse(live.time) < Date.parse(B.game.time) ? 'Deploy to update it.' : 'The live game is newer than this dev site. Re-run dev-setup.html with the latest files.'}</span>`;
  }
  const esc2 = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  paint(); checkSelf(); setTimeout(checkGame, 1500);
  setInterval(() => { paint(); checkSelf(); }, 60000);
  window.addEventListener('focus', () => { checkSelf(); checkGame(); });
  document.addEventListener('click', e => { if (e.target.closest('.nv[data-tab=deploy]')) checkGame(); if (e.target.closest('#dpGo')) setTimeout(checkGame, 20000); });
  window.MD_VERSION = { checkSelf, checkGame };
})();
