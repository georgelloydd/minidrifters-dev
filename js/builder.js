// ===== Track builder: draw / edit layouts, start line, direction, checkpoints, theme; test + publish =====
const BLD = { list: [], pub: [], cur: 0, tool: 'select', v: { s: 0.2, x: 0, y: 0 }, undo: [], redo: [], hover: null, drag: null, stroke: null, real: false, bake: null, tr: null, issues: [], space: false };
const THEMES = {
  Sunset: { grass: '#4c8c3c', grass2: '#5a9c47', road: '#3a3c42', sand: '#d8c48f', tree: ['#2f6e2a', '#3f8a35'] },
  'Neon night': { grass: '#2b3346', grass2: '#323b52', road: '#26272d', sand: '#4a5068', tree: ['#1f6f8b', '#2d8fb0'], night: true },
  Snow: { grass: '#dfe8ef', grass2: '#eef3f7', road: '#4a4d55', sand: '#b9c6d2', tree: ['#2c5a3f', '#3c7452'], snow: true },
  Desert: { grass: '#d9b878', grass2: '#e2c58c', road: '#4a4038', sand: '#c79a5a', tree: ['#7a8a3a', '#93a34a'] },
  'Autumn': { grass: '#7a6a2e', grass2: '#8a7a38', road: '#3b3a3c', sand: '#c9a46a', tree: ['#b5541c', '#d9822b'] },
  'Red night': { grass: '#1b1214', grass2: '#22171a', road: '#232327', sand: '#3a2226', tree: ['#7a1420', '#a81c2c'], night: true },
};
const cv = () => $('bcv');
const cur = () => BLD.list[BLD.cur];
const clone = o => JSON.parse(JSON.stringify(o));
const R4 = v => Math.round(v * 10000) / 10000;
const clampN = v => Math.max(0.03, Math.min(0.97, v));
const norm = (x, y) => [R4(clampN(x / WORLD_W)), R4(clampN(y / WORLD_H))];
const withSeed = (d, i) => Object.assign({}, d, { seed: d.seed || (i * 977 + 13) });

// ---------- data ----------
async function BLD_init() {
  const p = await loadPublished(); BLD.pub = p.list; let drafts = null; try { drafts = JSON.parse(localStorage.getItem('md_dev_tracks') || 'null'); } catch (e) { }
  BLD.list = Array.isArray(drafts) && drafts.length ? drafts : clone(BLD.pub); $('bFrom').textContent = 'Published tracks loaded from the ' + p.from + '.';
  bindBuilder(); F1_init(); select(0); BLD_resize();
}
function saveDraft() { try { localStorage.setItem('md_dev_tracks', JSON.stringify(BLD.list)); } catch (e) { if (!BLD._qw) { BLD._qw = 1; toast('Browser storage is full (screenshots are big). Publish to free space; drafts may not survive a reload.', 'err'); } } listUI(); }
function edited(i) { return i >= BLD.pub.length || JSON.stringify(BLD.list[i]) !== JSON.stringify(BLD.pub[i]); }
function layoutChanged(i) { const a = BLD.list[i], b = BLD.pub[i]; if (!b) return false; const k = o => JSON.stringify([o.pts, o.width, o.start, o.rev, o.cps]); return k(a) !== k(b); }
function snap() { BLD.undo.push(JSON.stringify({ i: BLD.cur, d: cur() })); if (BLD.undo.length > 150) BLD.undo.shift(); BLD.redo = []; }
function change(fn, noSnap) { if (!noSnap) snap(); fn(cur()); saveDraft(); rebuild(); panelUI(); }
function undo(r) { const A = r ? BLD.redo : BLD.undo, B = r ? BLD.undo : BLD.redo; const s = A.pop(); if (!s) return; const o = JSON.parse(s); B.push(JSON.stringify({ i: o.i, d: BLD.list[o.i] })); BLD.list[o.i] = o.d; BLD.cur = o.i; saveDraft(); rebuild(); panelUI(); }
function select(i) { BLD.cur = Math.max(0, Math.min(BLD.list.length - 1, i)); rebuild(); fit(); panelUI(); listUI(); }

// ---------- geometry ----------
function rebuild() {
  const d = cur(); BLD.tr = buildTrack(withSeed(d, BLD.cur), true); BLD.issues = findIssues(BLD.tr); BLD.bake = null;
  clearTimeout(BLD._bt); if (BLD.real) BLD._bt = setTimeout(() => { BLD.bake = buildTrack(withSeed(cur(), BLD.cur)).canvas; draw(); }, 350);
  draw(); issuesUI();
}
function findIssues(tr) {
  const P = tr.pts, n = tr.n, out = [], gap = Math.ceil(tr.w * 2.6 / 12), lim = tr.w * 1.02, st = 3;
  for (let i = 0; i < n; i += st) { for (let j = i + gap; j < n; j += st) { if (n - (j - i) < gap) continue; const dx = P[i][0] - P[j][0], dy = P[i][1] - P[j][1]; if (dx * dx + dy * dy < lim * lim) { out.push({ p: P[i], t: 'overlap' }); break; } } if (out.length > 80) break; }
  const m = tr.w / 2 + 50; for (let i = 0; i < n; i += 6) { const p = P[i]; if (p[0] < m || p[1] < m || p[0] > WORLD_W - m || p[1] > WORLD_H - m) out.push({ p, t: 'edge' }); }
  let sharp = 0; for (let i = 0; i < n; i += 2) { const a = angDiff(tr.dirs[(i + 2) % n], tr.dirs[i]); if (Math.abs(a) / 24 > 1 / (tr.w * 0.36)) { out.push({ p: P[i], t: 'sharp' }); if (++sharp > 30) break; } }
  return out;
}
function toWorld(e) { const r = cv().getBoundingClientRect(); return [(e.clientX - r.left - BLD.v.x) / BLD.v.s, (e.clientY - r.top - BLD.v.y) / BLD.v.s]; }
function hitHandle(w) { const d = cur(), R = 13 / BLD.v.s; let bi = -1, bd = R * R; d.pts.forEach((p, i) => { const q = (p[0] * WORLD_W - w[0]) ** 2 + (p[1] * WORLD_H - w[1]) ** 2; if (q < bd) { bd = q; bi = i; } }); return bi; }
function hitGate(w) { const tr = BLD.tr, R = 18 / BLD.v.s; let bk = -1, bd = R * R; tr.gates.forEach((g, k) => { const p = tr.pts[g.i], q = (p[0] - w[0]) ** 2 + (p[1] - w[1]) ** 2; if (q < bd) { bd = q; bk = k; } }); return bk; }
function onRoad(w) { const r = nearestFull(BLD.tr, w[0], w[1]); return r.d < BLD.tr.w * 0.9 ? r.i : -1; }
function explicitCps() { const d = cur(); d.cps = BLD.tr.gates.map(g => norm(...BLD.tr.pts[g.i])); }
function segDist(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }

// ---------- drawing a layout ----------
function finishStroke(S) {
  let len = 0; for (let i = 1; i < S.length; i++) len += Math.hypot(S[i][0] - S[i - 1][0], S[i][1] - S[i - 1][1]);
  if (len < 1600) return toast('Draw a bigger loop: drag around the whole circuit in one go.', 'err');
  const N = Math.max(8, Math.min(36, Math.round(len / 330))), step = len / N, out = [S[0]]; let acc = 0;
  for (let i = 1; i < S.length && out.length < N; i++) { let a = S[i - 1], b = S[i], sl = Math.hypot(b[0] - a[0], b[1] - a[1]); while (acc + sl >= step && out.length < N) { const t = (step - acc) / sl; a = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; out.push(a); sl = Math.hypot(b[0] - a[0], b[1] - a[1]); acc = 0; } acc += sl; }
  if (Math.hypot(out[out.length - 1][0] - out[0][0], out[out.length - 1][1] - out[0][1]) < step * 0.5) out.pop();
  const sm = out.map((p, i) => { const a = out[(i - 1 + out.length) % out.length], c = out[(i + 1) % out.length]; return [p[0] * 0.6 + (a[0] + c[0]) * 0.2, p[1] * 0.6 + (a[1] + c[1]) * 0.2]; });
  change(d => { d.pts = sm.map(p => norm(p[0], p[1])); delete d.start; delete d.cps; delete d.rev; });
  setTool('select'); toast('Track created from your drawing (' + sm.length + ' points). Drag points to refine; start line is where you started drawing.', 'ok');
}

// ---------- render ----------
function BLD_resize() { const c = cv(); if (!c) return; const r = c.parentElement.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1); c.width = Math.max(10, r.width * dpr); c.height = Math.max(10, r.height * dpr); c.style.width = r.width + 'px'; c.style.height = r.height + 'px'; if (!BLD._fitted && r.width > 50) { BLD._fitted = true; fit(); } draw(); }
function fit() { const c = cv(); if (!c) return; const r = c.getBoundingClientRect(); if (r.width < 50) return; const s = Math.min((r.width - 40) / WORLD_W, (r.height - 40) / WORLD_H); BLD.v = { s, x: (r.width - WORLD_W * s) / 2, y: (r.height - WORLD_H * s) / 2 }; draw(); }
function draw() {
  const c = cv(), tr = BLD.tr; if (!c || !tr) return; const g = c.getContext('2d'), dpr = c.width / (c.getBoundingClientRect().width || 1), v = BLD.v, px = 1 / v.s, th = tr.th, d = cur();
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#07070a'; g.fillRect(0, 0, c.width, c.height);
  g.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.x, dpr * v.y);
  if (BLD.real && BLD.bake) g.drawImage(BLD.bake, 0, 0);
  else {
    g.fillStyle = th.grass; g.fillRect(0, 0, WORLD_W, WORLD_H); g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 2; g.beginPath(); for (let x = 200; x < WORLD_W; x += 200) { g.moveTo(x, 0); g.lineTo(x, WORLD_H); } for (let y = 200; y < WORLD_H; y += 200) { g.moveTo(0, y); g.lineTo(WORLD_W, y); } g.stroke();
    g.lineJoin = g.lineCap = 'round'; pathTrack(g, tr); g.strokeStyle = th.sand; g.lineWidth = tr.w + 80; g.stroke(); g.strokeStyle = '#eee'; g.lineWidth = tr.w + 18; g.stroke(); g.setLineDash([26, 26]); g.strokeStyle = '#d42020'; g.stroke(); g.setLineDash([]);
    g.strokeStyle = th.road; g.lineWidth = tr.w; g.stroke(); g.setLineDash([40, 55]); g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 4; g.stroke(); g.setLineDash([]);
  }
  drawBgOverlay(g, px);
  g.strokeStyle = 'rgba(255,0,0,.9)'; g.lineWidth = 3 * px; g.strokeRect(0, 0, WORLD_W, WORLD_H);
  // direction arrows
  const step = Math.max(20, Math.floor(tr.n / 16)); g.fillStyle = 'rgba(255,255,255,.55)';
  for (let i = step / 2 | 0; i < tr.n; i += step) { const p = tr.pts[i], a = tr.dirs[i]; g.save(); g.translate(p[0], p[1]); g.rotate(a); g.beginPath(); g.moveTo(16, 0); g.lineTo(-8, -12); g.lineTo(-2, 0); g.lineTo(-8, 12); g.closePath(); g.fill(); g.restore(); }
  // grid slots + start line
  for (let s = 0; s < 8; s++) { const q = gridSlot(tr, s); g.save(); g.translate(q.x, q.y); g.rotate(q.a); g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 3; g.strokeRect(-30, -15, 60, 30); g.restore(); }
  { const p = tr.pts[0], a = tr.dirs[0], sq = tr.w / 12; g.save(); g.translate(p[0], p[1]); g.rotate(a); for (let r = 0; r < 2; r++) for (let k = 0; k < 12; k++) { g.fillStyle = (r + k) % 2 ? '#111' : '#fff'; g.fillRect(-sq + r * sq, -tr.w / 2 + k * sq, sq, sq); } g.restore();
    g.save(); g.translate(p[0], p[1]); g.scale(px, px); g.fillStyle = '#19d36b'; g.beginPath(); g.arc(0, 0, 11, 0, 7); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 2; g.stroke(); g.fillStyle = '#000'; g.font = '900 11px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('S', 0, 1); g.restore(); }
  // checkpoint gates
  tr.gates.forEach((gt, k) => { const p = tr.pts[gt.i], a = tr.dirs[gt.i], nx = -Math.sin(a), ny = Math.cos(a), hw = tr.w / 2 + 14, hot = BLD.hover && BLD.hover.gate === k;
    g.strokeStyle = hot ? '#fff' : '#ffd400'; g.lineWidth = 6; g.setLineDash([18, 12]); g.beginPath(); g.moveTo(p[0] - nx * hw, p[1] - ny * hw); g.lineTo(p[0] + nx * hw, p[1] + ny * hw); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#ff2a2a'; for (const s of [-1, 1]) { g.beginPath(); g.arc(p[0] + nx * hw * s, p[1] + ny * hw * s, 9, 0, 7); g.fill(); }
    g.save(); g.translate(p[0], p[1]); g.scale(px, px); g.fillStyle = hot ? '#fff' : '#ffd400'; g.beginPath(); g.arc(0, 0, 12, 0, 7); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 2; g.stroke(); g.fillStyle = '#000'; g.font = '900 12px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(k + 1, 0, 1); g.restore(); });
  // issues
  for (const it of BLD.issues) { g.strokeStyle = it.t === 'edge' ? '#ff9a2a' : it.t === 'sharp' ? '#ffd400' : '#ff2a2a'; g.lineWidth = 3 * px; g.beginPath(); g.arc(it.p[0], it.p[1], it.t === 'sharp' ? 18 * px : tr.w * 0.6, 0, 7); g.stroke(); }
  // control points
  if (BLD.tool === 'select' || BLD.tool === 'draw') { g.strokeStyle = 'rgba(255,42,42,.55)'; g.lineWidth = 1.5 * px; g.setLineDash([6 * px, 6 * px]); g.beginPath(); d.pts.forEach((p, i) => i ? g.lineTo(p[0] * WORLD_W, p[1] * WORLD_H) : g.moveTo(p[0] * WORLD_W, p[1] * WORLD_H)); g.closePath(); g.stroke(); g.setLineDash([]);
    d.pts.forEach((p, i) => { const hot = BLD.hover && BLD.hover.pt === i; g.save(); g.translate(p[0] * WORLD_W, p[1] * WORLD_H); g.scale(px, px); g.fillStyle = hot ? '#ff2a2a' : '#fff'; g.strokeStyle = hot ? '#fff' : '#ff2a2a'; g.lineWidth = 2.5; g.beginPath(); g.arc(0, 0, hot ? 9 : 7, 0, 7); g.fill(); g.stroke(); g.restore(); }); }
  if (BLD.stroke) { g.strokeStyle = '#ff2a2a'; g.lineWidth = 6 * px; g.lineJoin = 'round'; g.beginPath(); BLD.stroke.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); }
  drawAlignMarks(g, px);
  g.setTransform(1, 0, 0, 1, 0, 0);
}

// ---------- UI ----------
const TOOLS = { select: ['Select (V)', 'Drag the white points to reshape. Double-click the road to add a point, right-click a point to delete it. Drag empty space to pan, scroll to zoom.'], draw: ['Draw (D)', 'Click and drag one continuous loop. Let go and the track is built from your drawing. You drive in the direction you drew.'], start: ['Start (S)', 'Click anywhere on the road to move the start / finish line and grid there.'], cp: ['Checkpoints (C)', 'Click the road to add a gate. Drag a yellow gate along the road to move it, right-click to delete. Gates must be passed in order to count a lap.'] };
function setTool(t) { BLD.tool = t; document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t)); $('bHint').textContent = TOOLS[t][1]; cv().style.cursor = t === 'img' ? 'move' : t === 'draw' ? 'crosshair' : t === 'select' ? 'default' : 'copy'; draw(); }
function listUI() {
  $('bList').innerHTML = BLD.list.map((t, i) => `<div class="ti${i === BLD.cur ? ' on' : ''}" data-i="${i}"><span class="tn">${i + 1}. ${esc(t.name)}</span>${i >= BLD.pub.length ? '<i class="bd new">NEW</i>' : edited(i) ? '<i class="bd ed">EDITED</i>' : ''}${t.hidden ? '<i class="bd hd">HIDDEN</i>' : ''}</div>`).join('');
  const dirty = BLD.list.some((t, i) => edited(i)) || BLD.list.length !== BLD.pub.length; $('bPub').classList.toggle('pulse', dirty); $('bDirty').textContent = dirty ? 'Unpublished changes (saved as drafts in this browser)' : 'Everything is published';
}
function panelUI() {
  const d = cur(), i = BLD.cur, th = d.th; $('pName').value = d.name; $('pW').value = d.width; $('pWv').textContent = d.width;
  ['grass', 'grass2', 'road', 'sand'].forEach(k => $('c_' + k).value = th[k]); $('c_tree0').value = th.tree[0]; $('c_tree1').value = th.tree[1]; $('pNight').checked = !!th.night; $('pSnow').checked = !!th.snow;
  $('pCps').textContent = (BLD.tr ? BLD.tr.gates.length : 0) + (d.cps ? ' gates (custom)' : ' gates (automatic)'); $('pDir').textContent = d.rev ? 'Reversed' : 'As drawn';
  $('pHide').checked = !!d.hidden; $('pHideRow').classList.toggle('hidden', i >= BLD.pub.length); $('pDel').classList.toggle('hidden', i < BLD.pub.length);
  $('pLbWarn').classList.toggle('hidden', !layoutChanged(i)); $('pIdx').textContent = 'Track #' + (i + 1) + ' · leaderboard id ' + i;
  imgPanelUI();
}
function issuesUI() { const c = { overlap: 0, edge: 0, sharp: 0 }; BLD.issues.forEach(x => c[x.t]++); const m = []; if (c.overlap) m.push('<span class="err">● Road overlaps itself (red rings)</span>'); if (c.edge) m.push('<span style="color:#ff9a2a">● Too close to the map edge (orange)</span>'); if (c.sharp) m.push('<span style="color:#ffd400">● Very tight corners (yellow), may be undriveable</span>'); if (BLD.tr && BLD.tr.gates.length < 2) m.push('<span class="err">● Add at least 2 checkpoints</span>'); $('pIssues').innerHTML = m.length ? m.join('<br>') : '<span class="ok">✓ No layout problems found</span>'; }
function newTrack(fromDef) { const n = BLD.list.length + 1, d = fromDef ? Object.assign(clone(fromDef), { name: fromDef.name + ' copy', hidden: false }) : { name: 'New track ' + n, width: 170, pts: Array.from({ length: 12 }, (_, k) => { const a = k / 12 * Math.PI * 2; return [R4(0.5 + Math.cos(a) * 0.34), R4(0.5 + Math.sin(a) * 0.3)]; }), th: clone(THEMES.Sunset) }; delete d.seed; BLD.list.push(d); saveDraft(); select(BLD.list.length - 1); toast('Added track #' + BLD.list.length + '. Use Draw (D) to sketch a layout.', 'ok'); }
function testDrive() {
  const d = withSeed(clone(cur()), BLD.cur), big = !!(d.bg && /^data:/.test(d.bg.src || '')); delete d.hidden; try { localStorage.setItem('md_test_track', JSON.stringify(d)); } catch (e) { if (big) return toast('Screenshot too big to test-drive before publishing. Publish first, then test.', 'err'); }
  window.open(gameUrl() + '?test=1' + (big ? '' : '#track=' + encodeURIComponent(b64(JSON.stringify(d)))), '_blank');
  toast('Opening a test drive in the live game. Test laps never go on the leaderboards.', 'ok');
}
async function publish() {
  const ch = BLD.list.map((t, i) => edited(i) ? (i >= BLD.pub.length ? 'new: ' : 'edited: ') + t.name : null).filter(Boolean);
  if (!ch.length) return toast('Nothing to publish: no changes since the last publish.', 'ok');
  if (!confirm('Publish to ' + DCFG.gameRepo + '/tracks.json?\n\n' + ch.join('\n') + '\n\nThe live game picks it up within a minute or two.')) return;
  $('bPub').disabled = true; $('bPub').textContent = 'PUBLISHING…';
  try { BLD.list = await uploadTrackImages(BLD.list); const c = await publishTracks(BLD.list, 'Tracks: ' + ch.join(', ').slice(0, 180)); const lc = BLD.list.map((t, i) => layoutChanged(i) ? i : -1).filter(i => i >= 0); BLD.pub = clone(BLD.list); saveDraft(); panelUI(); toast('Published (' + (c && c.sha ? c.sha.slice(0, 7) : 'ok') + '). Hard-refresh the game in a minute to see it.', 'ok'); if (lc.length) toast('Layouts changed on: ' + lc.map(i => BLD.list[i].name).join(', ') + '. Old lap times there may no longer be fair; you can clear them in Leaderboards.', ''); }
  catch (e) { toast('Publish failed: ' + e.message, 'err'); }
  finally { $('bPub').disabled = false; $('bPub').textContent = 'PUBLISH TO GAME'; }
}
function bindBuilder() {
  const c = cv();
  document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool)); setTool('select');
  $('bList').onclick = e => { const t = e.target.closest('.ti'); if (t) select(+t.dataset.i); };
  $('bNew').onclick = () => newTrack(); $('bDup').onclick = () => newTrack(cur()); $('bUndo').onclick = () => undo(false); $('bRedo').onclick = () => undo(true); $('bFit').onclick = fit;
  $('bReal').onchange = e => { BLD.real = e.target.checked; rebuild(); }; $('bTest').onclick = testDrive; $('bPub').onclick = publish;
  $('bExport').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, tracks: BLD.list }, null, 1)], { type: 'application/json' })); a.download = 'tracks.json'; a.click(); };
  $('bImport').onclick = () => $('bFile').click(); $('bFile').onchange = async e => { try { const j = JSON.parse(await e.target.files[0].text()), L = Array.isArray(j) ? j : j.tracks; if (!Array.isArray(L) || !L.every(t => Array.isArray(t.pts))) throw new Error('No tracks in that file'); if (!confirm('Replace your drafts with ' + L.length + ' tracks from the file?')) return; BLD.list = L; saveDraft(); select(0); } catch (er) { toast(er.message, 'err'); } e.target.value = ''; };
  $('bDiscard').onclick = () => { if (!confirm('Throw away all unpublished changes and go back to the published tracks?')) return; BLD.list = clone(BLD.pub); BLD.undo = []; BLD.redo = []; saveDraft(); select(Math.min(BLD.cur, BLD.list.length - 1)); };
  $('pName').oninput = () => change(d => d.name = $('pName').value.slice(0, 32) || 'Track', BLD._nameSnap); $('pName').onfocus = () => { snap(); BLD._nameSnap = true; }; $('pName').onblur = () => BLD._nameSnap = false;
  $('pW').onpointerdown = () => snap(); $('pW').oninput = () => change(d => d.width = +$('pW').value, true);
  ['grass', 'grass2', 'road', 'sand'].forEach(k => $('c_' + k).oninput = e => change(d => d.th[k] = e.target.value, true)); $('c_tree0').oninput = e => change(d => d.th.tree[0] = e.target.value, true); $('c_tree1').oninput = e => change(d => d.th.tree[1] = e.target.value, true);
  document.querySelectorAll('#pal input[type=color]').forEach(i => i.onpointerdown = () => snap());
  $('pNight').onchange = e => change(d => d.th.night = e.target.checked || undefined); $('pSnow').onchange = e => change(d => d.th.snow = e.target.checked || undefined);
  $('pThemes').innerHTML = Object.keys(THEMES).map(k => `<button class="mini" data-th="${k}" style="border-left:10px solid ${THEMES[k].grass}">${k}</button>`).join(''); $('pThemes').onclick = e => { const b = e.target.closest('[data-th]'); if (b) change(d => d.th = clone(THEMES[b.dataset.th])); };
  $('pFlip').onclick = () => change(d => { if (d.rev) delete d.rev; else d.rev = true; });
  $('pAuto').onclick = () => { const N = Math.max(2, Math.min(24, +$('pAutoN').value || 7)), tr = BLD.tr; change(d => d.cps = Array.from({ length: N }, (_, k) => norm(...tr.pts[Math.floor((k + 1) * tr.n / (N + 1))]))); };
  $('pCpReset').onclick = () => change(d => delete d.cps);
  $('pHide').onchange = e => change(d => { if (e.target.checked) d.hidden = true; else delete d.hidden; });
  $('pDel').onclick = () => { if (BLD.cur < BLD.pub.length || !confirm('Delete ' + cur().name + '?')) return; BLD.list.splice(BLD.cur, 1); saveDraft(); select(BLD.cur - 1); };
  $('pLbClear').onclick = () => clearTrack(BLD.cur);
  // canvas input
  c.oncontextmenu = e => { e.preventDefault(); const w = toWorld(e);
    if (BLD.tool === 'select') { const h = hitHandle(w); if (h >= 0) { if (cur().pts.length <= 4) return toast('A track needs at least 4 points.', 'err'); change(d => d.pts.splice(h, 1)); } }
    if (BLD.tool === 'cp') { const k = hitGate(w); if (k >= 0) { if (BLD.tr.gates.length <= 2) return toast('Keep at least 2 checkpoints.', 'err'); snap(); explicitCps(); change(d => d.cps.splice(k, 1), true); } } };
  c.ondblclick = e => { if (BLD.tool !== 'select') return; const w = toWorld(e); if (onRoad(w) < 0) return; const P = cur().pts.map(p => [p[0] * WORLD_W, p[1] * WORLD_H]); let bi = 0, bd = 1e18; P.forEach((p, i) => { const q = segDist(w, p, P[(i + 1) % P.length]); if (q < bd) { bd = q; bi = i; } }); change(d => d.pts.splice(bi + 1, 0, norm(w[0], w[1]))); };
  c.onpointerdown = e => { c.setPointerCapture(e.pointerId); const w = toWorld(e);
    if (e.button === 1 || BLD.space) return BLD.drag = { pan: true, x: e.clientX, y: e.clientY, vx: BLD.v.x, vy: BLD.v.y };
    if (e.button !== 0) return;
    if (BLD.tool === 'select') { const h = hitHandle(w); if (h >= 0) { snap(); BLD.drag = { pt: h }; } else BLD.drag = { pan: true, x: e.clientX, y: e.clientY, vx: BLD.v.x, vy: BLD.v.y }; }
    else if (BLD.tool === 'draw') BLD.stroke = [w];
    else if (BLD.tool === 'start') { const i = onRoad(w); if (i < 0) return toast('Click on the road.', 'err'); change(d => d.start = norm(...BLD.tr.pts[i])); }
    else if (BLD.tool === 'img') imgDown(w);
    else if (BLD.tool === 'cp') { const k = hitGate(w); if (k >= 0) { snap(); explicitCps(); BLD.drag = { gate: k }; } else { const i = onRoad(w); if (i < 0) return; if (i < BLD.tr.n * 0.03 || i > BLD.tr.n * 0.97) return toast('Too close to the start line.', 'err'); snap(); explicitCps(); change(d => d.cps.push(norm(...BLD.tr.pts[i])), true); } } };
  c.onpointermove = e => { const w = toWorld(e), D = BLD.drag;
    if (D && D.pan) { BLD.v.x = D.vx + e.clientX - D.x; BLD.v.y = D.vy + e.clientY - D.y; return draw(); }
    if (D && D.img) { imgMove(w); return; }
    if (D && D.pt !== undefined) { cur().pts[D.pt] = norm(w[0], w[1]); return rebuild(); }
    if (D && D.gate !== undefined) { const i = nearestFull(BLD.tr, w[0], w[1]).i; cur().cps[D.gate] = norm(...BLD.tr.pts[i]); return rebuild(); }
    if (BLD.stroke) { const l = BLD.stroke[BLD.stroke.length - 1]; if (Math.hypot(w[0] - l[0], w[1] - l[1]) > 6 / BLD.v.s) { BLD.stroke.push(w); draw(); } return; }
    const hv = BLD.tool === 'select' ? { pt: hitHandle(w) } : BLD.tool === 'cp' ? { gate: hitGate(w) } : null; const k = JSON.stringify(hv); if (k !== BLD._hk) { BLD._hk = k; BLD.hover = hv; draw(); } };
  c.onpointerup = () => { const D = BLD.drag; BLD.drag = null; if (BLD.stroke) { const S = BLD.stroke; BLD.stroke = null; draw(); finishStroke(S); } else if (D && !D.pan) { saveDraft(); panelUI(); } };
  c.onwheel = e => { e.preventDefault(); if (BLD.tool === 'img' && imgWheel(e)) return; const r = c.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, f = Math.exp(-e.deltaY * 0.0015), s = Math.max(0.05, Math.min(2, BLD.v.s * f)); BLD.v.x = mx - (mx - BLD.v.x) * s / BLD.v.s; BLD.v.y = my - (my - BLD.v.y) * s / BLD.v.s; BLD.v.s = s; draw(); };
  addEventListener('resize', BLD_resize);
  addEventListener('keydown', e => { if ($('tab-tracks').classList.contains('hidden') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(e.shiftKey); return; } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); undo(true); return; }
    if (e.code === 'Space') { BLD.space = true; e.preventDefault(); } const m = { v: 'select', d: 'draw', s: 'start', c: 'cp', i: 'img' }[e.key.toLowerCase()]; if (m && !e.ctrlKey && !e.metaKey) setTool(m); if (e.key.toLowerCase() === 'f') fit();
    if ((e.key === 'Delete' || e.key === 'Backspace') && BLD.hover && BLD.hover.pt >= 0 && cur().pts.length > 4) change(d => d.pts.splice(BLD.hover.pt, 1)); });
  addEventListener('keyup', e => { if (e.code === 'Space') BLD.space = false; });
}
