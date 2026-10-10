// ===== Track builder: draw / edit layouts, start line, direction, checkpoints, theme; test + publish =====
const BLD = { list: [], pub: [], cur: 0, tool: 'select', v: { s: 0.2, x: 0, y: 0 }, undo: [], redo: [], hover: null, drag: null, stroke: null, real: false, bake: null, tr: null, issues: [], space: false };
const THEMES = {
  City: { grass: '#8b9097', grass2: '#959aa1', road: '#2f3136', sand: '#b4b7bb', tree: ['#3f6b35', '#4f8442'], scene: 'city' },
  'City night': { grass: '#22252d', grass2: '#282c35', road: '#1d1e22', sand: '#3a3e48', tree: ['#1f4f3a', '#2b6a4c'], night: true, scene: 'city' },
  Forest: { grass: '#2f5e2a', grass2: '#376b31', road: '#36383d', sand: '#8a7a55', tree: ['#1d4a1f', '#2a6229'] },
  Coast: { grass: '#e3d3a0', grass2: '#ead9a8', road: '#3c3e44', sand: '#f1e4bc', tree: ['#3f8a5a', '#55a66d'] },
  Canyon: { grass: '#c27a4a', grass2: '#cc8656', road: '#46392f', sand: '#d9a273', tree: ['#7a8a3a', '#93a34a'], scene: 'desert' },
  Sunset: { grass: '#4c8c3c', grass2: '#5a9c47', road: '#3a3c42', sand: '#d8c48f', tree: ['#2f6e2a', '#3f8a35'] },
  'Neon night': { grass: '#2b3346', grass2: '#323b52', road: '#26272d', sand: '#4a5068', tree: ['#1f6f8b', '#2d8fb0'], night: true },
  Snow: { grass: '#dfe8ef', grass2: '#eef3f7', road: '#4a4d55', sand: '#b9c6d2', tree: ['#2c5a3f', '#3c7452'], snow: true },
  Desert: { grass: '#d9b878', grass2: '#e2c58c', road: '#4a4038', sand: '#c79a5a', tree: ['#7a8a3a', '#93a34a'], scene: 'desert' },
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
  bindBuilder(); bindWorldUI(); F1_init(); select(0); BLD_resize();
}
function saveDraft() { try { localStorage.setItem('md_dev_tracks', JSON.stringify(BLD.list)); } catch (e) { if (!BLD._qw) { BLD._qw = 1; toast('Browser storage is full (screenshots are big). Publish to free space; drafts may not survive a reload.', 'err'); } } listUI(); }
function edited(i) { return i >= BLD.pub.length || JSON.stringify(BLD.list[i]) !== JSON.stringify(BLD.pub[i]); }
function layoutChanged(i) { const a = BLD.list[i], b = BLD.pub[i]; if (!b) return false; const k = o => JSON.stringify([o.pts, o.width, o.start, o.rev, o.cps, o.walls || [], o.elev || []]); return k(a) !== k(b); }
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
function explicitCps() { const d = cur(), tr = BLD.tr; d.cps = tr.gates.map(g => { const n = norm(...tr.pts[g.i]); return g.a || g.b ? [n[0], n[1], Math.round(gateW(tr, g, -1)), Math.round(gateW(tr, g, 1))] : n; }); }
function hitGateEnd(w) { const tr = BLD.tr, R = Math.max(22, 16 / BLD.v.s); let best = null, bd = R * R; tr.gates.forEach((g, k) => { const p = tr.pts[g.i], a = tr.dirs[g.i], nx = -Math.sin(a), ny = Math.cos(a); for (const s of [-1, 1]) { const ww = gateW(tr, g, s), q = (p[0] + nx * ww * s - w[0]) ** 2 + (p[1] + ny * ww * s - w[1]) ** 2; if (q < bd) { bd = q; best = { k, s }; } } }); return best; }
function segDist(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }

// ---------- drawing a layout ----------
function finishStroke(S, msg) {
  let len = 0; for (let i = 1; i < S.length; i++) len += Math.hypot(S[i][0] - S[i - 1][0], S[i][1] - S[i - 1][1]);
  if (len < 1600) return toast('Draw a bigger loop: drag around the whole circuit in one go.', 'err');
  const N = Math.max(8, Math.min(msg ? 48 : 36, Math.round(len / 330))), step = len / N, out = [S[0]]; let acc = 0;
  for (let i = 1; i < S.length && out.length < N; i++) { let a = S[i - 1], b = S[i], sl = Math.hypot(b[0] - a[0], b[1] - a[1]); while (acc + sl >= step && out.length < N) { const t = (step - acc) / sl; a = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; out.push(a); sl = Math.hypot(b[0] - a[0], b[1] - a[1]); acc = 0; } acc += sl; }
  if (Math.hypot(out[out.length - 1][0] - out[0][0], out[out.length - 1][1] - out[0][1]) < step * 0.5) out.pop();
  const sm = out.map((p, i) => { const a = out[(i - 1 + out.length) % out.length], c = out[(i + 1) % out.length]; return [p[0] * 0.6 + (a[0] + c[0]) * 0.2, p[1] * 0.6 + (a[1] + c[1]) * 0.2]; });
  change(d => { d.pts = sm.map(p => norm(p[0], p[1])); delete d.start; delete d.cps; delete d.rev; });
  setTool('select'); if (msg) return toast(msg + ' (' + sm.length + ' points). Drag points to tweak it, then Save.', 'ok'); toast('Track created from your drawing (' + sm.length + ' points). Drag points to refine; start line is where you started drawing.', 'ok');
}

// ---------- render ----------
function BLD_resize() { const c = cv(); if (!c) return; const r = c.parentElement.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1); c.width = Math.max(10, r.width * dpr); c.height = Math.max(10, r.height * dpr); c.style.width = r.width + 'px'; c.style.height = r.height + 'px'; if (!BLD._fitted && r.width > 50) { BLD._fitted = true; fit(); } draw(); }
function fit() { const c = cv(); if (!c) return; const r = c.getBoundingClientRect(); if (r.width < 50) return; const s = Math.min((r.width - 40) / WORLD_W, (r.height - 40) / WORLD_H); BLD.v = { s, x: (r.width - WORLD_W * s) / 2, y: (r.height - WORLD_H * s) / 2 }; draw(); }
function draw() {
  const c = cv(), tr = BLD.tr; if (!c || !tr) return; const g = c.getContext('2d'), dpr = c.width / (c.getBoundingClientRect().width || 1), v = BLD.v, px = 1 / v.s, th = tr.th, d = cur();
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#07070a'; g.fillRect(0, 0, c.width, c.height);
  g.setTransform(dpr * v.s, 0, 0, dpr * v.s, dpr * v.x, dpr * v.y);
  if (BLD.real && BLD.bake) { g.drawImage(BLD.bake, 0, 0, WORLD_W, WORLD_H); if (BLD.bake.width < WORLD_W * 0.99) drawRoadLive(g, tr, -v.x / v.s, -v.y / v.s, (c.width / dpr - v.x) / v.s, (c.height / dpr - v.y) / v.s); }
  else {
    g.fillStyle = th.grass; g.fillRect(0, 0, WORLD_W, WORLD_H); g.strokeStyle = 'rgba(255,255,255,.05)'; const GS = 200 * Math.pow(2, Math.max(0, Math.ceil(Math.log2(Math.max(WORLD_W, WORLD_H) / 8800)))); g.lineWidth = Math.max(2, GS / 100); g.beginPath(); for (let x = GS; x < WORLD_W; x += GS) { g.moveTo(x, 0); g.lineTo(x, WORLD_H); } for (let y = GS; y < WORLD_H; y += GS) { g.moveTo(0, y); g.lineTo(WORLD_W, y); } g.stroke();
    drawZoneGround(g, tr); g.lineJoin = g.lineCap = 'round'; pathTrack(g, tr); g.strokeStyle = th.sand; g.lineWidth = tr.w + 80; g.stroke(); g.strokeStyle = '#eee'; g.lineWidth = tr.w + 18; g.stroke(); g.setLineDash([26, 26]); g.strokeStyle = '#d42020'; g.stroke(); g.setLineDash([]);
    g.strokeStyle = th.road; g.lineWidth = tr.w; g.stroke(); g.setLineDash([40, 55]); g.strokeStyle = 'rgba(255,255,255,.28)'; g.lineWidth = 4; g.stroke(); g.setLineDash([]); drawZoneItems(g, tr, th);
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
  tr.gates.forEach((gt, k) => { const p = tr.pts[gt.i], a = tr.dirs[gt.i], nx = -Math.sin(a), ny = Math.cos(a), hot = BLD.hover && BLD.hover.gate === k, he = BLD.hover && BLD.hover.end, ed = BLD.tool === 'cp';
    const wa = gateW(tr, gt, -1), wb = gateW(tr, gt, 1);
    if (ed) { g.strokeStyle = hot ? '#fff' : 'rgba(255,212,0,.5)'; g.lineWidth = 2.5 * px; g.setLineDash([10 * px, 8 * px]); g.beginPath(); g.moveTo(p[0] - nx * wa, p[1] - ny * wa); g.lineTo(p[0] + nx * wb, p[1] + ny * wb); g.stroke(); g.setLineDash([]); }
    for (const s of [-1, 1]) { const w = s < 0 ? wa : wb, cx = p[0] + nx * w * s, cy = p[1] + ny * w * s, on = he && he.k === k && he.s === s; drawTyreRow(g, cx, cy, Math.cos(a), Math.sin(a), on ? '#fff' : '#ffd400'); if (ed) { g.strokeStyle = on ? '#fff' : 'rgba(255,255,255,.55)'; g.lineWidth = 2 * px; g.beginPath(); g.arc(cx, cy, Math.max(22, 14 * px), 0, 7); g.stroke(); } }
    if (ed) { g.save(); g.translate(p[0], p[1]); g.scale(px, px); g.fillStyle = hot ? '#fff' : '#ffd400'; g.beginPath(); g.arc(0, 0, 7, 0, 7); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 2; g.stroke(); g.restore(); } });
  // issues
  for (const it of BLD.issues) { g.strokeStyle = it.t === 'edge' ? '#ff9a2a' : it.t === 'sharp' ? '#ffd400' : '#ff2a2a'; g.lineWidth = 3 * px; g.beginPath(); g.arc(it.p[0], it.p[1], it.t === 'sharp' ? 18 * px : tr.w * 0.6, 0, 7); g.stroke(); }
  // control points
  if (BLD.tool === 'select' || BLD.tool === 'draw') { g.strokeStyle = 'rgba(255,42,42,.55)'; g.lineWidth = 1.5 * px; g.setLineDash([6 * px, 6 * px]); g.beginPath(); d.pts.forEach((p, i) => i ? g.lineTo(p[0] * WORLD_W, p[1] * WORLD_H) : g.moveTo(p[0] * WORLD_W, p[1] * WORLD_H)); g.closePath(); g.stroke(); g.setLineDash([]);
    d.pts.forEach((p, i) => { const hot = BLD.hover && BLD.hover.pt === i; g.save(); g.translate(p[0] * WORLD_W, p[1] * WORLD_H); g.scale(px, px); g.fillStyle = hot ? '#ff2a2a' : '#fff'; g.strokeStyle = hot ? '#fff' : '#ff2a2a'; g.lineWidth = 2.5; g.beginPath(); g.arc(0, 0, hot ? 9 : 7, 0, 7); g.fill(); g.stroke(); g.restore(); }); }
  if (BLD.stroke) { g.strokeStyle = '#ff2a2a'; g.lineWidth = 6 * px; g.lineJoin = 'round'; g.beginPath(); BLD.stroke.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); }
  drawElevAll(g, BLD.tr, 0.5); drawSpawn(g); drawStandSel(g); drawWalls(g, BLD.tr); wallHover(g); elevPreview(g); if (BLD.wstroke && BLD.wstroke.length) { g.save(); g.strokeStyle = '#ffb02e'; g.lineWidth = Math.max(11, 3 / BLD.v.s); g.lineCap = g.lineJoin = 'round'; g.beginPath(); (BLD.wsnap || BLD.wstroke).forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); g.restore(); }
  objOverlay(g, px);
  drawAlignMarks(g, px);
  g.setTransform(1, 0, 0, 1, 0, 0);
}

// ---------- UI ----------
const TOOLS = { stand: ['Grandstand (G)', 'Click or drag to move the grandstand. Scroll to turn it, right-click to remove it.'], obj: ['Objects (O)', 'Click to place the object picked on the right. Drag an object to move it, scroll over it to turn it, right-click it to delete it.'], spawn: ['TT spawn (P)', 'Click where time trials should start. The car faces along the track. Right-click to remove it (time trials then start on the grid).'], elev: ['Bridge / tunnel (E)', 'Pick Bridge or Tunnel on the right, then drag along the road from where it starts to where it ends. Bridges go over the rest of the track, tunnels go under it. Right-click one to delete it.'], wall: ['Barriers (B)', 'Drag beside the road and the barrier sticks to the edge of the run-off, following every corner (hold Alt to draw freehand). Drag away from the road for a freehand wall. Right-click a barrier to delete it.'], select: ['Select (V)', 'Drag the white points to reshape. Double-click the road to add a point, right-click a point to delete it. Drag empty space to pan, scroll to zoom.'], draw: ['Draw (D)', 'Click and drag one continuous loop. Let go and the track is built from your drawing. You drive in the direction you drew.'], start: ['Start (S)', 'Click anywhere on the road to move the start / finish line and grid there.'], cp: ['Checkpoints (C)', 'Click the road to add a checkpoint. Drag the middle dot to slide it along the road, drag either tyre row to make it wider or narrower, right-click the dot to delete. Players count it anywhere between the tyres.'] };
function setTool(t) { BLD.tool = t; document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t)); $('bHint').textContent = TOOLS[t][1]; cv().style.cursor = t === 'img' ? 'move' : t === 'draw' || t === 'wall' || t === 'obj' || t === 'elev' || t === 'spawn' ? 'crosshair' : t === 'select' ? 'default' : 'copy'; draw(); }
function listUI() {
  $('bList').innerHTML = BLD.list.map((t, i) => `<div class="ti${i === BLD.cur ? ' on' : ''}" data-i="${i}"><span class="tn">${i + 1}. ${esc(t.name)}</span>${i >= BLD.pub.length ? '<i class="bd new">NEW</i>' : edited(i) ? '<i class="bd ed">EDITED</i>' : ''}${t.hidden ? '<i class="bd hd">HIDDEN</i>' : ''}</div>`).join('');
  const dirty = BLD.list.some((t, i) => edited(i)) || BLD.list.length !== BLD.pub.length; $('bPub').classList.toggle('pulse', dirty); $('bDirty').textContent = dirty ? 'Unpublished changes (saved as drafts in this browser)' : 'Everything is published';
}
function panelUI() {
  try { objUI(); } catch (e) { }
  try { const E = cur().elev || [], nb = E.filter(e => e.t === 'bridge').length, nt = E.length - nb; $('pElev').textContent = E.length ? nb + ' bridge' + (nb === 1 ? '' : 's') + ', ' + nt + ' tunnel' + (nt === 1 ? '' : 's') + '.' : 'None yet. Choose one, then drag along the road.'; document.querySelectorAll('[data-et]').forEach(b => b.classList.toggle('on', b.dataset.et === (BLD.elevT || 'bridge'))); $('pElevClr').disabled = !E.length; $('pScene').value = (cur().th && cur().th.scene) || ''; $('pWallSnap').checked = BLD.wallSnap !== false; const Z = cur().zones || []; $('pZones').textContent = Z.length ? Z.length + ' area' + (Z.length === 1 ? '' : 's') + ': ' + Z.map(z => '"' + z.q + '"').join(', ') : 'None yet. Lasso an area and describe what goes there.'; $('pZoneClr').disabled = !Z.length; } catch (e) { }
  try { const n = (cur() && cur().walls || []).length; if ($('pWalls')) $('pWalls').textContent = n ? n + ' barrier' + (n > 1 ? 's' : '') + ' on this track.' : 'No barriers yet. Pick the Barriers tool (B) and drag on the map.'; if ($('pWallClr')) $('pWallClr').disabled = !n; } catch (e) { }
  const d = cur(), i = BLD.cur, th = d.th; $('pName').value = d.name; $('pW').value = d.width; $('pWv').textContent = d.width;
  ['grass', 'grass2', 'road', 'sand'].forEach(k => $('c_' + k).value = th[k]); $('c_tree0').value = th.tree[0]; $('c_tree1').value = th.tree[1]; $('pNight').checked = !!th.night; $('pSnow').checked = !!th.snow;
  try { $('pStandTog').textContent = d.stand === false ? 'Put back' : 'Remove'; } catch (e) { }
  $('pCps').textContent = (BLD.tr ? BLD.tr.gates.length : 0) + (d.cps ? ' gates (custom)' : ' gates (automatic)'); $('pDir').textContent = d.rev ? 'Reversed' : 'As drawn';
  $('pHide').checked = !!d.hidden; $('pHideRow').classList.toggle('hidden', i >= BLD.pub.length); $('pDel').classList.toggle('hidden', i < BLD.pub.length);
  $('pLbWarn').classList.toggle('hidden', !layoutChanged(i)); $('pIdx').textContent = 'Track #' + (i + 1) + ' · leaderboard id ' + i;
  worldPanelUI(); imgPanelUI();
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
  $('pStandTool').onclick = () => setTool('stand');
  $('pStandTog').onclick = () => change(d => { if (d.stand === false) delete d.stand; else d.stand = false; });
  $('pStandAuto').onclick = () => change(d => delete d.stand);
  if ($('pWallClr')) $('pWallClr').onclick = () => { const n = (cur().walls || []).length; if (!n || !confirm('Delete all ' + n + ' barriers on this track?')) return; change(d => delete d.walls); };
  if ($('pWallTool')) $('pWallTool').onclick = () => setTool('wall');
  $('pWallSnap').onchange = e => { BLD.wallSnap = e.target.checked; };
  document.querySelectorAll('[data-et]').forEach(b => b.onclick = () => { BLD.elevT = b.dataset.et; setTool('elev'); panelUI(); });
  $('pElevClr').onclick = () => { const n = (cur().elev || []).length; if (n && confirm('Remove all ' + n + ' bridges/tunnels?')) change(d => delete d.elev); };
  if ($('pCity')) $('pCity').onclick = () => { const d0 = cur(); if (!BLD.tr) return; if ((d0.walls || []).length && !confirm('The City preset replaces the barriers on this track with smooth city barriers on both sides. Continue?')) return;
    const W = cityBarriers(BLD.tr); change(d => { const night = d.th && d.th.night; d.th = clone(THEMES[night ? 'City night' : 'City']); if (W.length) d.walls = W.map(w => (w[0] = [w[0][0], w[0][1], 4], w)); else delete d.walls; }); toast('City preset added: buildings + ' + W.length + ' smooth barrier' + (W.length === 1 ? '' : 's') + '.', 'ok'); };
  $('pScene').onchange = e => { const v = e.target.value; change(d => { d.th = d.th || {}; if (v) d.th.scene = v; else delete d.th.scene; }); };
  objBind();
  $('pZoneClr').onclick = () => { if (confirm('Remove the old AI decor areas from this track?')) change(d => delete d.zones); };
  $('pWallType').innerHTML = WALL_TYPES.map((n, i) => '<option value="' + i + '">' + n + '</option>').join(''); BLD.wallType = Math.max(0, Math.min(5, +(localStorage.getItem('md_wall_type') || 0) || 0)); $('pWallType').value = BLD.wallType;
  $('pWallType').onchange = e => { BLD.wallType = +e.target.value; localStorage.setItem('md_wall_type', BLD.wallType); if (BLD.tool !== 'wall') setTool('wall'); };
  $('pWallAll').onclick = () => { if (!(cur().walls || []).length) return toast('No barriers on this track yet.', 'err'); change(d => d.walls.forEach(w => { w[0] = [w[0][0], w[0][1], BLD.wallType]; })); toast('All barriers are now ' + WALL_TYPES[BLD.wallType] + '.', 'ok'); };
  $('pLayoutAI').onclick = genLayout;
  $('pHide').onchange = e => change(d => { if (e.target.checked) d.hidden = true; else delete d.hidden; });
  $('pDel').onclick = () => { if (BLD.cur < BLD.pub.length || !confirm('Delete ' + cur().name + '?')) return; BLD.list.splice(BLD.cur, 1); saveDraft(); select(BLD.cur - 1); };
  $('pLbClear').onclick = () => clearTrack(BLD.cur);
  // canvas input
  c.oncontextmenu = e => { e.preventDefault(); const w = toWorld(e);
    if (BLD.tool === 'obj') { const k = hitObj(w); if (k >= 0) { BLD.hover = null; change(d => { d.objs.splice(k, 1); if (!d.objs.length) delete d.objs; }); toast('Object removed.', 'ok'); } return; }
    if (BLD.tool === 'select') { const h = hitHandle(w); if (h >= 0) { if (cur().pts.length <= 4) return toast('A track needs at least 4 points.', 'err'); change(d => d.pts.splice(h, 1)); } }
    if (BLD.tool === 'stand') { if (cur().stand !== false) { change(d => d.stand = false); toast('Grandstand removed.', 'ok'); } return; }
    if (BLD.tool === 'spawn') { if (cur().spawn) { change(d => delete d.spawn); toast('Spawn removed: time trials start on the grid.', 'ok'); } return; }
    if (BLD.tool === 'elev') { const k = hitElev(w); if (k >= 0) { change(d => { d.elev.splice(k, 1); if (!d.elev.length) delete d.elev; }); toast('Removed.', 'ok'); } return; }
    if (BLD.tool === 'wall') { const k = hitWall(w); if (k >= 0) { BLD.hover = null; change(d => { d.walls.splice(k, 1); if (!d.walls.length) delete d.walls; }); toast('Barrier deleted.', 'ok'); } return; }
    if (BLD.tool === 'cp') { const k = hitGate(w); if (k >= 0) { if (BLD.tr.gates.length <= 2) return toast('Keep at least 2 checkpoints.', 'err'); snap(); explicitCps(); change(d => d.cps.splice(k, 1), true); } } };
  c.ondblclick = e => { if (BLD.tool !== 'select') return; const w = toWorld(e); if (onRoad(w) < 0) return; const P = cur().pts.map(p => [p[0] * WORLD_W, p[1] * WORLD_H]); let bi = 0, bd = 1e18; P.forEach((p, i) => { const q = segDist(w, p, P[(i + 1) % P.length]); if (q < bd) { bd = q; bi = i; } }); change(d => d.pts.splice(bi + 1, 0, norm(w[0], w[1]))); };
  c.onpointerdown = e => { c.setPointerCapture(e.pointerId); const w = toWorld(e);
    if (e.button === 1 || BLD.space) return BLD.drag = { pan: true, x: e.clientX, y: e.clientY, vx: BLD.v.x, vy: BLD.v.y };
    if (e.button !== 0) return;
    if (BLD.tool === 'select') { const h = hitHandle(w); if (h >= 0) { snap(); BLD.drag = { pt: h }; } else BLD.drag = { pan: true, x: e.clientX, y: e.clientY, vx: BLD.v.x, vy: BLD.v.y }; }
    else if (BLD.tool === 'draw') BLD.stroke = [w];
    else if (BLD.tool === 'wall') { BLD.wstroke = [w]; BLD.wsnap = null; draw(); }
    else if (BLD.tool === 'obj') { const k = hitObj(w); if (k >= 0) { snap(); BLD.drag = { obj: k }; } else placeObj(w); }
    else if (BLD.tool === 'elev') { BLD.estroke = [w]; draw(); }
    else if (BLD.tool === 'start') { const i = onRoad(w); if (i < 0) return toast('Click on the road.', 'err'); change(d => d.start = norm(...BLD.tr.pts[i])); }
    else if (BLD.tool === 'spawn') { change(d => d.spawn = { p: norm(w[0], w[1]) }); toast('Time trial spawn set.', 'ok'); }
    else if (BLD.tool === 'stand') { snap(); const sp = standPos(BLD.tr), on = sp && Math.abs((w[0] - sp.x) * Math.cos(sp.a) + (w[1] - sp.y) * Math.sin(sp.a)) < 210 && Math.abs(-(w[0] - sp.x) * Math.sin(sp.a) + (w[1] - sp.y) * Math.cos(sp.a)) < 60, a = sp ? sp.a : BLD.tr.dirs[nearestFull(BLD.tr, w[0], w[1]).i]; BLD.drag = { stand: true, a, dx: on ? sp.x - w[0] : 0, dy: on ? sp.y - w[1] : 0 }; cur().stand = { p: norm(w[0] + BLD.drag.dx, w[1] + BLD.drag.dy), a: Math.round(a * 1000) / 1000 }; rebuild(); }
    else if (BLD.tool === 'img') imgDown(w);
    else if (BLD.tool === 'cp') { const he = hitGateEnd(w), k = he ? -1 : hitGate(w); if (he) { snap(); explicitCps(); BLD.drag = { gend: he }; } else if (k >= 0) { snap(); explicitCps(); BLD.drag = { gate: k }; } else { const i = onRoad(w); if (i < 0) return; if (i < BLD.tr.n * 0.03 || i > BLD.tr.n * 0.97) return toast('Too close to the start line.', 'err'); snap(); explicitCps(); change(d => d.cps.push(norm(...BLD.tr.pts[i])), true); } } };
  c.onpointermove = e => { const w = toWorld(e), D = BLD.drag;
    if (D && D.pan) { BLD.v.x = D.vx + e.clientX - D.x; BLD.v.y = D.vy + e.clientY - D.y; return draw(); }
    if (D && D.img) { imgMove(w); return; }
    if (D && D.pt !== undefined) { cur().pts[D.pt] = norm(w[0], w[1]); return rebuild(); }
    if (D && D.stand) { cur().stand = { p: norm(w[0] + D.dx, w[1] + D.dy), a: Math.round(D.a * 1000) / 1000 }; return rebuild(); }
    if (D && D.gate !== undefined) { const i = nearestFull(BLD.tr, w[0], w[1]).i; const o = cur().cps[D.gate] || [], n = norm(...BLD.tr.pts[i]); cur().cps[D.gate] = o.length > 3 ? [n[0], n[1], o[2], o[3]] : n; return rebuild(); }
    if (D && D.gend) { const tr = BLD.tr, gt = tr.gates[D.gend.k], c = cur().cps[D.gend.k]; if (!gt || !c) return; const p = tr.pts[gt.i], a = tr.dirs[gt.i], lat = ((w[0] - p[0]) * -Math.sin(a) + (w[1] - p[1]) * Math.cos(a)) * D.gend.s, v = Math.round(Math.max(20, Math.min(600, lat))), A = D.gend.s < 0 ? v : Math.round(gateW(tr, gt, -1)), Bw = D.gend.s > 0 ? v : Math.round(gateW(tr, gt, 1)); cur().cps[D.gend.k] = [c[0], c[1], A, Bw]; return rebuild(); }
    if (BLD.wstroke) { const l = BLD.wstroke[BLD.wstroke.length - 1]; if (Math.hypot(w[0] - l[0], w[1] - l[1]) > 8 / BLD.v.s) { BLD.wstroke.push(w); BLD.wsnap = BLD.wallSnap !== false && !e.altKey ? snapWall(BLD.wstroke) : null; draw(); } return; }
    if (D && D.obj !== undefined) { const o = cur().objs[D.obj]; o[1] = +(w[0] / WORLD_W).toFixed(5); o[2] = +(w[1] / WORLD_H).toFixed(5); return rebuild(); }
    if (BLD.tool === 'obj' && !D) { BLD.objCur = w; const k = hitObj(w); BLD.hover = { obj: k }; draw(); return; }
    if (BLD.estroke) { const l = BLD.estroke[BLD.estroke.length - 1]; if (Math.hypot(w[0] - l[0], w[1] - l[1]) > 8 / BLD.v.s) { BLD.estroke.push(w); draw(); } return; }
    if (BLD.tool === 'wall' && !D) { const k = hitWall(w); if (k !== (BLD.hover && BLD.hover.wall)) { BLD.hover = { wall: k }; BLD._hk = null; draw(); } return; }
    if (BLD.stroke) { const l = BLD.stroke[BLD.stroke.length - 1]; if (Math.hypot(w[0] - l[0], w[1] - l[1]) > 6 / BLD.v.s) { BLD.stroke.push(w); draw(); } return; }
    const hv = BLD.tool === 'select' ? { pt: hitHandle(w) } : BLD.tool === 'cp' ? (e2 => e2 ? { gate: -1, end: e2 } : { gate: hitGate(w) })(hitGateEnd(w)) : null; const k = JSON.stringify(hv); if (k !== BLD._hk) { BLD._hk = k; BLD.hover = hv; draw(); } };
  c.onpointerup = e => { if (BLD.estroke) { const S = BLD.estroke; BLD.estroke = null; finishElev(S); return; } if (BLD.wstroke) { const S = BLD.wstroke; BLD.wstroke = null; BLD.wsnap = null; finishWall(S, toWorld(e), e.altKey); return; } const D = BLD.drag; BLD.drag = null; if (BLD.stroke) { const S = BLD.stroke; BLD.stroke = null; draw(); finishStroke(S); } else if (D && !D.pan) { saveDraft(); panelUI(); } };
  c.onwheel = e => { e.preventDefault(); if (standWheel(e)) return; if (objWheel(e)) return; if (BLD.tool === 'img' && imgWheel(e)) return; const r = c.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, f = Math.exp(-e.deltaY * 0.0015), s = Math.max(0.002, Math.min(4, BLD.v.s * f)); BLD.v.x = mx - (mx - BLD.v.x) * s / BLD.v.s; BLD.v.y = my - (my - BLD.v.y) * s / BLD.v.s; BLD.v.s = s; draw(); };
  addEventListener('resize', BLD_resize);
  addEventListener('keydown', e => { if ($('tab-tracks').classList.contains('hidden') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(e.shiftKey); return; } if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); undo(true); return; }
    if (e.code === 'Space') { BLD.space = true; e.preventDefault(); } const m = { g: 'stand', v: 'select', d: 'draw', s: 'start', c: 'cp', i: 'img', b: 'wall', e: 'elev', p: 'spawn', o: 'obj' }[e.key.toLowerCase()]; if (m && !e.ctrlKey && !e.metaKey) setTool(m); if (e.key.toLowerCase() === 'f') fit();
    if ((e.key === 'Delete' || e.key === 'Backspace') && BLD.hover && BLD.hover.pt >= 0 && cur().pts.length > 4) change(d => d.pts.splice(BLD.hover.pt, 1)); });
  addEventListener('keyup', e => { if (e.code === 'Space') BLD.space = false; });
}

// ---------- map size + real scale ----------
const R6 = v => Math.round(v * 1e6) / 1e6, clampWorld = v => Math.max(1000, Math.min(200000, Math.round(+v || 0)));
// keep = keep the track's real size (just add/remove space around it); otherwise the track scales with the map
function setWorld(w, h, keep, centre) {
  w = clampWorld(w); h = clampWorld(h);
  change(d => {
    const [ow, oh] = worldOf(d), c = centre || [ow / 2, oh / 2];
    if (keep) {
      const M = p => [R6((p[0] * ow - c[0] + w / 2) / w), R6((p[1] * oh - c[1] + h / 2) / h)];
      d.pts = d.pts.map(M); if (d.start) d.start = M(d.start); if (d.stand) delete d.stand; if (Array.isArray(d.cps)) d.cps = d.cps.map(c => { const m = M(c); return c.length > 3 ? [m[0], m[1], c[3], c[2]] : m; }); if (Array.isArray(d.walls)) d.walls = d.walls.map(w => { const t = w[0] && w[0][2], o = w.map(M); if (t && o[0]) o[0] = [o[0][0], o[0][1], t]; return o; }); if (d.spawn && d.spawn.p) d.spawn.p = M(d.spawn.p); if (Array.isArray(d.elev)) d.elev.forEach(e => ['a', 'm', 'b'].forEach(k => { if (e[k]) e[k] = M(e[k]); }));
      if (d.bg) { const q = M([d.bg.x, d.bg.y]); d.bg.x = q[0]; d.bg.y = q[1]; d.bg.w = R6(d.bg.w * ow / w); }
    }
    if (w === WORLD_DEF[0] && h === WORLD_DEF[1]) delete d.world; else d.world = [w, h];
  });
  fit();
}
function trackBox() { const P = BLD.tr.pts, xs = P.map(p => p[0]), ys = P.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
function scaleWorld(f, msg) { const [w, h] = worldOf(cur()); if (w * f > 200000 || h * f > 200000) return toast('That would make the map bigger than 200,000 px.', 'err'); setWorld(w * f, h * f, false); if (msg) toast(msg, 'ok'); }
function bindWorldUI() {
  if (!$('pWW')) return;
  $('pWSet').onclick = () => setWorld($('pWW').value, $('pWH').value, $('pWKeep').checked);
  [$('pWW'), $('pWH')].forEach(i => i.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') $('pWSet').click(); });
  $('pKm').onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') $('pKmGo').click(); };
  document.querySelectorAll('[data-ws]').forEach(b => b.onclick = () => {
    const k = b.dataset.ws;
    if (k === 'fit') { const [x0, y0, x1, y1] = trackBox(), m = cur().width / 2 + 450; return setWorld(Math.max(2000, x1 - x0 + m * 2), Math.max(1500, y1 - y0 + m * 2), true, [(x0 + x1) / 2, (y0 + y1) / 2]); }
    setWorld(WORLD_DEF[0] * +k, WORLD_DEF[1] * +k, $('pWKeep').checked);
  });
  $('pKmGo').onclick = () => { const km = +$('pKm').value; if (!(km > 0.1 && km < 40)) return toast('Enter the real lap length in km (for example 5.891).', 'err'); scaleWorld(km * 1000 * PX_PER_M / BLD.tr.len, 'Scaled so one lap is ' + km + ' km at game scale.'); };
  $('pF1').onclick = () => {
    const d = cur();
    if (d.geo && d.geo.mpp && Math.abs(d.geo.mpp * PX_PER_M - 1) > 0.02) { const f = d.geo.mpp * PX_PER_M; change(dd => { dd.geo.mpp = Math.round(1000 / PX_PER_M) / 1000; if ((dd.width || 150) < 180) dd.width = 190; }); return scaleWorld(f, 'Now at real F1 scale (1 m = ' + PX_PER_M + ' px).'); }
    const km = d.geo && d.geo.km ? d.geo.km : +$('pKm').value; if (!(km > 0.1)) return toast('Enter the real lap length in km first, then press Scale to length.', 'err');
    if ((d.width || 150) < 180) change(dd => { dd.width = 190; });
    scaleWorld(km * 1000 * PX_PER_M / BLD.tr.len, 'Scaled to a real ' + km + ' km lap.');
  };
}
function worldPanelUI() {
  if (!$('pWW')) return; const d = cur(), [w, h] = worldOf(d), km = v => (v / PX_PER_M / 1000).toFixed(2);
  $('pWW').value = w; $('pWH').value = h; if (document.activeElement !== $('pKm')) $('pKm').value = d.geo && d.geo.km ? d.geo.km : BLD.tr ? km(BLD.tr.len) : '';
  $('pWInfo').textContent = `Map ${km(w)} × ${km(h)} km · lap ${BLD.tr ? km(BLD.tr.len) : '?'} km · road ${(d.width / PX_PER_M).toFixed(1)} m wide (car is about 4 m long)`;
}

// ---------- barriers ----------
function wallN(w) { return [Math.round(Math.max(0, Math.min(1, w[0] / WORLD_W)) * 1e6) / 1e6, Math.round(Math.max(0, Math.min(1, w[1] / WORLD_H)) * 1e6) / 1e6]; }
function simplifyLine(P, tol) { if (P.length < 3) return P.slice(); let md = 0, mi = 0; const a = P[0], b = P[P.length - 1]; for (let i = 1; i < P.length - 1; i++) { const d = segDist(P[i], a, b); if (d > md) { md = d; mi = i; } } if (md <= tol) return [a, b]; return simplifyLine(P.slice(0, mi + 1), tol).slice(0, -1).concat(simplifyLine(P.slice(mi), tol)); }
// smooth, even spacing so barriers never kink or jump
function wResample(P, step) { if (P.length < 2) return P.slice(); const out = [P[0].slice()]; let need = step;
  for (let i = 1; i < P.length; i++) { let a = P[i - 1]; const b = P[i]; let d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (d >= need) { const t = need / d; a = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; out.push(a); d -= need; need = step; } need -= d; }
  const l = P[P.length - 1], o = out[out.length - 1]; if (Math.hypot(l[0] - o[0], l[1] - o[1]) > step * 0.35) out.push(l.slice()); else out[out.length - 1] = l.slice(); return out; }
function wAvg(P, passes) { let A = P; for (let n = 0; n < passes; n++) { if (A.length < 3) return A; A = A.map((p, i) => i === 0 || i === A.length - 1 ? p : [(A[i - 1][0] + 2 * p[0] + A[i + 1][0]) / 4, (A[i - 1][1] + 2 * p[1] + A[i + 1][1]) / 4]); } return A; }
function wChaikin(P, it) { let A = P; for (let n = 0; n < it; n++) { if (A.length < 3) return A; const R = [A[0]]; for (let i = 0; i < A.length - 1; i++) { const p = A[i], q = A[i + 1]; R.push([p[0] * .75 + q[0] * .25, p[1] * .75 + q[1] * .25], [p[0] * .25 + q[0] * .75, p[1] * .25 + q[1] * .75]); } R.push(A[A.length - 1]); A = R; } return A; }
function smoothFree(S) { return wChaikin(wAvg(wResample(S, 12), 4), 2); }
function wallDist(p, L) { if (L.length === 1) return Math.hypot(p[0] - L[0][0], p[1] - L[0][1]); let b = 1e18; for (let i = 1; i < L.length; i++) b = Math.min(b, segDist(p, L[i - 1], L[i])); return b; }
// overlapping / touching barriers are joined into one
function mergeWalls(P, walls) {
  const M = 34, removed = []; let cur = P, changed = true;
  while (changed) { changed = false;
    for (let k = 0; k < walls.length; k++) { if (removed.includes(k)) continue;
      const W = walls[k].map(q => [q[0] * WORLD_W, q[1] * WORLD_H]); if (W.length < 2) continue;
      const on = cur.map(p => wallDist(p, W) < M); if (!on.some(Boolean)) continue;
      if (W.every(p => wallDist(p, cur) < M)) { removed.push(k); changed = true; continue; } // new one covers the old one
      if (on.every(Boolean)) { cur = W; removed.push(k); changed = true; continue; }       // old one already covers the new one
      const runs = []; let st = -1; for (let i = 0; i <= cur.length; i++) { const off = i < cur.length && !on[i]; if (off && st < 0) st = i; if (!off && st >= 0) { runs.push([st, i - 1]); st = -1; } }
      const e0 = W[0], e1 = W[W.length - 1], parts = []; let ok = true;
      for (const [x, y] of runs) {
        if (x > 0 && y < cur.length - 1) { ok = false; break; } // touches in the middle: a crossing, keep separate
        const bp = cur[x > 0 ? x - 1 : y + 1], d0 = Math.hypot(bp[0] - e0[0], bp[1] - e0[1]), d1 = Math.hypot(bp[0] - e1[0], bp[1] - e1[1]);
        if (Math.min(d0, d1) > M * 3) { ok = false; break; }
        let seg = cur.slice(x, y + 1); if (x === 0) seg = seg.reverse(); parts.push({ end: d0 < d1 ? 0 : 1, seg });
      }
      if (!ok || !parts.length || (parts.length === 2 && parts[0].end === parts[1].end)) continue;
      let res = W.slice(); for (const p of parts) res = p.end ? res.concat(p.seg) : p.seg.slice().reverse().concat(res);
      cur = res; removed.push(k); changed = true;
    }
  }
  return { pts: cur, removed };
}
function finishWall(S, last, free) {
  if (last && S.length && Math.hypot(last[0] - S[S.length - 1][0], last[1] - S[S.length - 1][1]) > 1) S.push(last);
  let len = 0; for (let i = 1; i < S.length; i++) len += Math.hypot(S[i][0] - S[i - 1][0], S[i][1] - S[i - 1][1]);
  if (S.length < 2 || len < 40) { draw(); return toast('Drag further to draw a barrier.', 'err'); }
  let P = null; if (!free && BLD.wallSnap !== false) P = snapWall(S); if (!P) P = smoothFree(S);
  const m = mergeWalls(P, (cur() && cur().walls) || []);
  let pts = m.pts; if (m.removed.length) pts = wChaikin(wAvg(wResample(pts, 12), 2), 1);
  pts = simplifyLine(pts, 1.2).map(wallN); if (pts.length < 2) { draw(); return; } if (BLD.wallType) pts[0] = [pts[0][0], pts[0][1], BLD.wallType];
  change(d => { const W = (Array.isArray(d.walls) ? d.walls : []).filter((_, i) => !m.removed.includes(i)); W.push(pts); d.walls = W; });
  if (m.removed.length) toast('Joined into one barrier.', 'ok');
}
function hitWall(w) {
  const W = cur() && cur().walls; if (!Array.isArray(W)) return -1; const r = Math.max(14, 12 / BLD.v.s); let best = -1, bd = r;
  W.forEach((L, k) => { for (let i = 1; i < L.length; i++) { const d = segDist(w, [L[i - 1][0] * WORLD_W, L[i - 1][1] * WORLD_H], [L[i][0] * WORLD_W, L[i][1] * WORLD_H]); if (d < bd) { bd = d; best = k; } } });
  return best;
}
function wallHover(g) {
  const k = BLD.tool === 'wall' && BLD.hover ? BLD.hover.wall : -1, L = k >= 0 && cur().walls && cur().walls[k]; if (!L) return;
  g.save(); g.strokeStyle = 'rgba(255,60,60,.9)'; g.lineWidth = Math.max(18, 5 / BLD.v.s); g.lineCap = g.lineJoin = 'round'; g.beginPath(); L.forEach((p, i) => i ? g.lineTo(p[0] * WORLD_W, p[1] * WORLD_H) : g.moveTo(p[0] * WORLD_W, p[1] * WORLD_H)); g.stroke(); g.restore();
}

// ---------- barriers stick to the run-off edge ----------
function snapWall(S) {
  const tr = BLD.tr; if (!tr || !S || S.length < 2) return null; const N = tr.n, ro = tr.w / 2 + RUNOFF + 11; S = wResample(S, 10);
  // follow the stroke along the road step by step, so it can never jump to another part of the track
  let prev = nearestFull(tr, S[0][0], S[0][1]).i, side = 0, near = 0, tot = 0; const i0 = prev;
  for (const p of S) { const r = refine(tr, p[0], p[1], prev, 24), q = tr.pts[r.i], a = tr.dirs[r.i];
    side += Math.sign((p[0] - q[0]) * -Math.sin(a) + (p[1] - q[1]) * Math.cos(a)); if (Math.abs(r.d - ro) < 140) near++;
    let d = r.i - prev; if (d > N / 2) d -= N; if (d < -N / 2) d += N; tot += d; prev = r.i; }
  if (near < S.length * 0.7) return null; const sd = side >= 0 ? 1 : -1, cnt = Math.min(N, Math.abs(tot)), dir = tot >= 0 ? 1 : -1; if (cnt < 3) return null;
  const out = []; for (let k = 0; k <= cnt; k++) { const i = ((i0 + dir * k) % N + N) % N, q = tr.pts[i], a = tr.dirs[i]; out.push([q[0] - Math.sin(a) * ro * sd, q[1] + Math.cos(a) * ro * sd]); }
  const ok = out.filter(p => nearestFull(tr, p[0], p[1]).d > ro - 25); // skip the inside of tight hairpins
  return ok.length >= 2 ? wallHug(tr, wChaikin(wAvg(ok, 4), 2), ro) : null;
}
// ---------- bridges / tunnels ----------
function finishElev(S) {
  const tr = BLD.tr; draw(); if (!tr || S.length < 2) return; const r = S.map(p => nearestFull(tr, p[0], p[1]));
  if (r.filter(x => x.d < tr.w * 1.2).length < r.length * 0.7) return toast('Drag along the road to mark a bridge or tunnel.', 'err');
  const a = r[0].i, b = r[r.length - 1].i, m = r[Math.floor(r.length / 2)].i; if (Math.min((b - a + tr.n) % tr.n, (a - b + tr.n) % tr.n) < 8) return toast('Drag further along the road.', 'err');
  const P = i => wallN(tr.pts[i]), t = BLD.elevT || 'bridge';
  change(d => { if (!Array.isArray(d.elev)) d.elev = []; d.elev.push({ t, a: P(a), m: P(m), b: P(b) }); }); toast((t === 'bridge' ? 'Bridge' : 'Tunnel') + ' added.', 'ok');
}
function hitElev(w) {
  const tr = BLD.tr; if (!tr || !tr.elev || !tr.elev.length) return -1; const r = nearestFull(tr, w[0], w[1]); if (r.d > tr.w) return -1;
  for (const s of tr.elev) if ((r.i - s.i0 + tr.n) % tr.n <= s.len) return s.k; return -1;
}
function elevPreview(g) {
  const S = BLD.estroke; if (!S || S.length < 2) return; g.save(); g.strokeStyle = (BLD.elevT || 'bridge') === 'bridge' ? 'rgba(80,190,255,.85)' : 'rgba(255,170,60,.85)'; g.lineWidth = Math.max(BLD.tr ? BLD.tr.w * 0.6 : 60, 3 / BLD.v.s); g.lineCap = g.lineJoin = 'round';
  g.beginPath(); S.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); g.restore();
}

function drawSpawn(g) {
  const sp = cur().spawn; if (!sp || !sp.p || !BLD.tr) return; const x = sp.p[0] * WORLD_W, y = sp.p[1] * WORLD_H, r = nearestFull(BLD.tr, x, y), a = BLD.tr.dirs[r.i], k = Math.max(1, 0.6 / BLD.v.s);
  g.save(); g.translate(x, y); g.scale(k, k); g.rotate(a); g.fillStyle = 'rgba(40,220,120,.95)'; g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.moveTo(40, 0); g.lineTo(-30, -22); g.lineTo(-16, 0); g.lineTo(-30, 22); g.closePath(); g.fill(); g.stroke();
  g.rotate(-a); g.fillStyle = '#fff'; g.font = 'bold 15px sans-serif'; g.textAlign = 'center'; g.fillText('TT SPAWN', 0, -36); g.restore();
}

// ---------- City preset: smooth barriers one track width beyond each road edge ----------
function cityBarriers(tr) {
  const off = tr.w * 1.5 + 22, out = [], N = tr.pts.length;
  for (const sd of [1, -1]) {
    const P = tr.pts.map((p, i) => { const d = tr.dirs[i]; return [p[0] - Math.sin(d) * off * sd, p[1] + Math.cos(d) * off * sd]; });
    const ok = P.map(q => nearestFull(tr, q[0], q[1]).d > off * 0.96);
    let st = ok.findIndex((v, i) => v && !ok[(i - 1 + N) % N]); const all = st < 0; if (all && !ok[0]) continue; if (st < 0) st = 0;
    const runs = []; let R = [], i = 0;
    while (i < N) { const k = (st + i) % N; if (ok[k]) { R.push(P[k]); i++; continue; }
      let j = i; while (j < N && !ok[(st + j) % N]) j++;
      const a = R[R.length - 1], b = j < N ? P[(st + j) % N] : null; let clear = !!(a && b && Math.hypot(b[0] - a[0], b[1] - a[1]) < off * 3);
      if (clear) for (let t = 0.2; t < 1; t += 0.2) if (nearestFull(tr, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t).d < off * 0.8) { clear = false; break; }
      if (!clear && R.length) { runs.push(R); R = []; } i = j; }
    if (R.length) runs.push(R);
    if (all && runs[0]) runs[0].push(runs[0][0].slice());
    // a closed ring is smoothed with wrap-around so there is no kink where it joins up
    const cyc = (A, passes) => { for (let n = 0; n < passes; n++) { const M = A.length; A = A.map((p, i) => { const a = A[(i - 1 + M) % M], b = A[(i + 1) % M]; return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4]; }); } return A; };
    const keepOut = A => A.map(p => { const r = nearestFull(tr, p[0], p[1]), need = tr.w * 1.5 + 6; if (r.d >= need) return p; const c = tr.pts[r.i], dx = p[0] - c[0], dy = p[1] - c[1], L = Math.hypot(dx, dy) || 1; return [c[0] + dx / L * need, c[1] + dy / L * need]; });
    for (const Q of runs) { if (Q.length < 6) continue; let W;
      if (all) { W = wResample(Q, 14); W.pop(); for (let k = 0; k < 3; k++) W = keepOut(cyc(W, 6)); W.push(W[0].slice()); }
      else { W = wResample(Q, 14); for (let k = 0; k < 3; k++) W = keepOut(wAvg(W, 6)); W = wChaikin(W, 1); }
      W = simplifyLine(W, 0.8); if (W.length >= 2) out.push(W.map(q => [q[0] / WORLD_W, q[1] / WORLD_H])); }
  }
  return out;
}

// ---------- AI decor areas: lasso an area, describe it, built-in generator or Gemini fills it ----------
const ZTYPES = ['tree', 'pine', 'palm', 'bush', 'flowers', 'rock', 'cactus', 'building', 'house', 'lamp', 'tyres', 'car', 'tent', 'crowd', 'hay', 'bench', 'umbrella'];
const COLW = { red: '#d8262f', blue: '#2f6fd8', green: '#3f9a46', yellow: '#f1c40f', orange: '#f08a24', purple: '#8e44ad', pink: '#ff6fae', white: '#f2f2f2', black: '#222222', grey: '#8e949e', gray: '#8e949e', brown: '#8a5a3a', gold: '#d4a017' };
function polyArea(P) { let a = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += (P[j][0] + P[i][0]) * (P[j][1] - P[i][1]); return Math.abs(a / 2); }
function polyBox(P) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const q of P) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); } return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }; }
// keep a snapped barrier exactly on the run-off edge, never inside it
function wallHug(tr, P, ro) {
  const push = A => A.map(p => { const r = nearestFull(tr, p[0], p[1]); if (r.d >= ro - 1) return p; const q = tr.pts[r.i], dx = p[0] - q[0], dy = p[1] - q[1], l = Math.hypot(dx, dy) || 1; return [q[0] + dx / l * ro, q[1] + dy / l * ro]; });
  let A = push(P); A = push(wAvg(A, 2)); return A;
}

// ---------- AI layout generator ----------
function shapeOutline(q) {
  const s = ' ' + q.toLowerCase() + ' ', w = (...x) => x.some(k => new RegExp('\\b' + k + '\\b').test(s)), C = [];
  const ring = (n, fx, fy) => { for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; C.push([fx(t), fy(t)]); } };
  const ngon = (n, rot) => { for (let i = 0; i < n; i++) { const t = rot + i / n * Math.PI * 2; C.push([Math.cos(t), Math.sin(t)]); } };
  if (w('heart')) ring(48, t => 16 * Math.sin(t) ** 3, t => -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)));
  else if (w('star')) { for (let i = 0; i < 10; i++) { const t = -Math.PI / 2 + i / 10 * Math.PI * 2, r = i % 2 ? 0.55 : 1; C.push([Math.cos(t) * r, Math.sin(t) * r]); } }
  else if (w('chair', 'seat')) C.push([0, 0], [0.22, 0], [0.22, 0.52], [1, 0.52], [1, 1], [0.78, 1], [0.78, 0.76], [0.22, 0.76], [0.22, 1], [0, 1]);
  else if (w('triangle', 'triangular')) ngon(3, -Math.PI / 2);
  else if (w('pentagon')) ngon(5, -Math.PI / 2);
  else if (w('hexagon')) ngon(6, 0);
  else if (w('octagon')) ngon(8, Math.PI / 8);
  else if (w('square')) C.push([0, 0], [1, 0], [1, 1], [0, 1]);
  else if (w('rectangle', 'rectangular', 'box', 'oblong')) C.push([0, 0], [1, 0], [1, 0.55], [0, 0.55]);
  else if (w('oval', 'ellipse', 'egg', 'oval-shaped', 'nascar', 'speedway')) ring(40, t => Math.cos(t), t => Math.sin(t) * 0.58);
  else if (w('circle', 'round', 'ring', 'circular')) ring(40, t => Math.cos(t), t => Math.sin(t));
  else if (w('l', 'l-shape', 'l-shaped')) C.push([0, 0], [0.36, 0], [0.36, 0.64], [1, 0.64], [1, 1], [0, 1]);
  else if (w('u', 'u-shape', 'u-shaped', 'horseshoe')) C.push([0, 0], [0.32, 0], [0.32, 0.62], [0.68, 0.62], [0.68, 0], [1, 0], [1, 1], [0, 1]);
  else if (w('t', 't-shape', 't-shaped')) C.push([0, 0], [1, 0], [1, 0.34], [0.67, 0.34], [0.67, 1], [0.33, 1], [0.33, 0.34], [0, 0.34]);
  else if (w('cross', 'plus')) C.push([0.34, 0], [0.66, 0], [0.66, 0.34], [1, 0.34], [1, 0.66], [0.66, 0.66], [0.66, 1], [0.34, 1], [0.34, 0.66], [0, 0.66], [0, 0.34], [0.34, 0.34]);
  else if (w('diamond', 'rhombus')) C.push([0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]);
  else return null;
  return C;
}
function applyOutline(C, msg) {
  const B = polyBox(C), m = 0.1, sc = Math.min(WORLD_W * (1 - 2 * m) / (B.w || 1), WORLD_H * (1 - 2 * m) / (B.h || 1)), ox = (WORLD_W - B.w * sc) / 2 - B.x0 * sc, oy = (WORLD_H - B.h * sc) / 2 - B.y0 * sc;
  const P = C.map(p => [p[0] * sc + ox, p[1] * sc + oy]);
  finishStroke(wResample(P.concat([P[0]]), 30), msg);
}
async function genLayout() {
  const q = (prompt('What shape should the track be?\ncircle, oval, square, rectangle, triangle, star, heart, chair, diamond, hexagon, L, U, T or cross', BLD.lastL || '') || '').trim().slice(0, 160); if (!q) return; BLD.lastL = q;
  if ((cur().pts || []).length > 2 && !confirm('Replace this track\'s layout with a "' + q + '" shape? (Undo works too.)')) return;
  const C = shapeOutline(q), how = 'Shapes';
  if (!C) return toast('The built-in generator knows circle, oval, square, rectangle, triangle, star, heart, chair, diamond, hexagon, L, U, T and cross.', 'err');
  applyOutline(C, 'Made a "' + q + '" layout');
}

// ---------- placeable objects: def.objs = [[type, nx, ny, size, angleDeg, '#colour' or ''], ...], drawn in game by drawZoneItems ----------
const OBJ_NAMES = { tree: 'Tree', pine: 'Pine tree', palm: 'Palm tree', bush: 'Bush', flowers: 'Flowers', rock: 'Rock', cactus: 'Cactus', building: 'Building', house: 'House', lamp: 'Street lamp', tyres: 'Tyre stack', car: 'Parked car', tent: 'Tent', crowd: 'Crowd', hay: 'Hay bale', bench: 'Bench', umbrella: 'Umbrella' };
const OBJ_SIZE = { tree: 60, pine: 56, palm: 60, bush: 40, flowers: 36, rock: 34, cactus: 40, building: 140, house: 90, lamp: 14, tyres: 16, car: 44, tent: 50, crowd: 70, hay: 26, bench: 36, umbrella: 40 };
BLD.obj = Object.assign({ t: 'tree', s: 60, a: 0, c: '' }, (() => { try { return JSON.parse(localStorage.getItem('md_obj') || '{}'); } catch (e) { return {}; } })());
if (!OBJ_NAMES[BLD.obj.t]) BLD.obj.t = 'tree';
function objSave() { localStorage.setItem('md_obj', JSON.stringify(BLD.obj)); }
function hitObj(w) { const O = cur().objs || []; for (let k = O.length - 1; k >= 0; k--) { const o = O[k], r = Math.max(12 / BLD.v.s, (+o[3] || 20) / 2 + 4); if (Math.hypot(o[1] * WORLD_W - w[0], o[2] * WORLD_H - w[1]) < r) return k; } return -1; }
function placeObj(w) {
  if (w[0] < 0 || w[1] < 0 || w[0] > WORLD_W || w[1] > WORLD_H) return toast('Place objects inside the map.', 'err');
  if ((cur().objs || []).length >= 800) return toast('800 objects is the limit for one track.', 'err');
  const O = BLD.obj; change(d => (d.objs = d.objs || []).push([O.t, +(w[0] / WORLD_W).toFixed(5), +(w[1] / WORLD_H).toFixed(5), O.s, O.a, O.c || '']));
}
function objWheel(e) {
  if (BLD.tool !== 'obj') return false; const k = hitObj(toWorld(e)); if (k < 0) return false;
  snap(); const o = cur().objs[k]; o[4] = (((+o[4] || 0) + (e.deltaY > 0 ? 15 : -15)) % 360 + 360) % 360; saveDraft(); rebuild(); return true;
}
function objOverlay(g, px) {
  if (BLD.tool !== 'obj' || !BLD.tr) return; const O = cur().objs || [], hk = BLD.hover && BLD.hover.obj;
  g.save(); O.forEach((o, k) => { const r = Math.max(8 * px, (+o[3] || 20) / 2 + 4); g.strokeStyle = k === hk ? '#ffd400' : 'rgba(255,255,255,.45)'; g.lineWidth = (k === hk ? 3 : 1.5) * px; g.setLineDash(k === hk ? [] : [5 * px, 5 * px]); g.beginPath(); g.arc(o[1] * WORLD_W, o[2] * WORLD_H, r, 0, 7); g.stroke(); });
  g.setLineDash([]);
  if (BLD.objCur && !(hk >= 0) && !BLD.drag) { const w = BLD.objCur, O2 = BLD.obj; g.globalAlpha = 0.6; try { drawZoneItems(g, { def: { objs: [[O2.t, w[0] / WORLD_W, w[1] / WORLD_H, O2.s, O2.a, O2.c || '']] }, th: BLD.tr.th }, BLD.tr.th); } catch (e) { } }
  g.restore();
}
function objUI() {
  const n = (cur().objs || []).length; $('pObjs').textContent = n ? n + ' object' + (n === 1 ? '' : 's') + ' placed' : 'Pick an object, click Place, then click on the map.';
  $('pZoneClr').style.display = (cur().zones || []).length ? '' : 'none';
}
function objBind() {
  const O = BLD.obj, T = $('pObjType');
  T.innerHTML = Object.keys(OBJ_NAMES).map(k => '<option value="' + k + '">' + OBJ_NAMES[k] + '</option>').join(''); T.value = O.t;
  T.onchange = e => { O.t = e.target.value; O.s = OBJ_SIZE[O.t] || 40; $('pObjSize').value = O.s; objSave(); setTool('obj'); };
  $('pObjSize').value = O.s; $('pObjSize').oninput = e => { O.s = +e.target.value; objSave(); draw(); };
  $('pObjRot').value = O.a; $('pObjRot').oninput = e => { O.a = +e.target.value; objSave(); draw(); };
  $('pObjAuto').checked = !O.c; if (O.c) $('pObjCol').value = O.c;
  $('pObjAuto').onchange = e => { O.c = e.target.checked ? '' : $('pObjCol').value; objSave(); draw(); };
  $('pObjCol').oninput = e => { O.c = e.target.value; $('pObjAuto').checked = false; objSave(); draw(); };
  $('pObjTool').onclick = () => setTool('obj');
  $('pObjClr').onclick = () => { if (!(cur().objs || []).length) return toast('No objects on this track yet.', 'err'); if (confirm('Remove all placed objects from this track?')) change(d => delete d.objs); };
}

let STW = 0;
function standWheel(e) {
  if (BLD.tool !== 'stand' || !BLD.tr) return false; const sp = standPos(BLD.tr); if (!sp) return false;
  if (Date.now() - STW > 600) snap(); STW = Date.now();
  cur().stand = { p: norm(sp.x, sp.y), a: Math.round((sp.a + Math.sign(e.deltaY) * (e.shiftKey ? 0.02 : 0.1)) * 1000) / 1000 }; rebuild(); saveDraft(); return true;
}
function drawStandSel(g) {
  if (BLD.tool !== 'stand' || !BLD.tr) return; const sp = standPos(BLD.tr); if (!sp) return;
  g.save(); g.translate(sp.x, sp.y); g.rotate(sp.a); g.setLineDash([16, 10]); g.strokeStyle = '#ffb02e'; g.lineWidth = Math.max(3, 2 / BLD.v.s); g.strokeRect(-210, -60, 420, 112); g.restore();
}
