// ===== Real circuits: import a GeoJSON layout + a Google Maps screenshot for buildings, trees, water =====
THEMES['Grand Prix'] = { grass: '#4f8a3a', grass2: '#5d9a46', road: '#34363c', sand: '#cdb98a', tree: ['#2e6b2a', '#3d8535'] };
TOOLS.img = ['Image (I)', 'Drag to move the screenshot, scroll to resize it. Use the panel sliders to rotate, or Align with 2 points for an exact fit.'];
BLD.imgA = 0.55;
const onTrackRebaked = () => { if (typeof draw === 'function') draw(); };

// ---------- GeoJSON ----------
function geoLines(j) {
  const L = [], add = (geom, name, props) => { if (!geom) return; const t = geom.type, c = geom.coordinates;
    if (t === 'LineString') L.push({ name, props, parts: [c] }); else if (t === 'MultiLineString') L.push({ name, props, parts: c });
    else if (t === 'Polygon') L.push({ name, props, parts: [c[0]] }); else if (t === 'MultiPolygon') L.push({ name, props, parts: [c[0][0]] });
    else if (t === 'GeometryCollection') (geom.geometries || []).forEach(g => add(g, name, props)); };
  const feats = j.type === 'FeatureCollection' ? j.features || [] : j.type === 'Feature' ? [j] : [{ geometry: j, properties: {} }];
  feats.forEach((f, i) => { const p = f.properties || {}; add(f.geometry, String(p.Name || p.name || p.Location || p.id || ('Circuit ' + (i + 1))), p); });
  return L.filter(x => x.parts.some(p => Array.isArray(p) && p.length >= 4));
}
function joinParts(parts) {
  const rest = parts.filter(p => p.length >= 2).map(p => p.slice()); rest.sort((a, b) => b.length - a.length); let line = rest.shift();
  const d = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
  while (rest.length) { const e = line[line.length - 1]; let bi = 0, br = false, bd = 1e18; rest.forEach((p, i) => { const a = d(e, p[0]), b = d(e, p[p.length - 1]); if (a < bd) { bd = a; bi = i; br = false; } if (b < bd) { bd = b; bi = i; br = true; } }); const p = rest.splice(bi, 1)[0]; line = line.concat(br ? p.reverse() : p); }
  return line;
}
function resampleLoop(P, step) {
  const out = [], n = P.length; let carry = 0;
  for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]); let t = carry; while (t < L) { out.push([a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L]); t += step; } carry = t - L; }
  return out;
}
function rdp(P, eps) {
  if (P.length < 3) return P.slice(); const a = P[0], b = P[P.length - 1]; let bi = 0, bd = -1;
  for (let i = 1; i < P.length - 1; i++) { const q = segDist(P[i], a, b); if (q > bd) { bd = q; bi = i; } }
  if (bd <= eps) return [a, b]; const l = rdp(P.slice(0, bi + 1), eps), r = rdp(P.slice(bi), eps); return l.slice(0, -1).concat(r);
}
function rdpLoop(P, eps) { let far = 0, fd = -1; P.forEach((p, i) => { const q = (p[0] - P[0][0]) ** 2 + (p[1] - P[0][1]) ** 2; if (q > fd) { fd = q; far = i; } }); const A = rdp(P.slice(0, far + 1), eps), B = rdp(P.slice(far).concat([P[0]]), eps); return A.slice(0, -1).concat(B.slice(0, -1)); }
function geoToTrack(item) {
  const line = joinParts(item.parts).map(c => [+c[0], +c[1]]).filter(c => isFinite(c[0]) && isFinite(c[1]) && Math.abs(c[1]) <= 90);
  if (line.length < 4) throw new Error('That shape has too few points');
  const lat0 = line.reduce((s, c) => s + c[1], 0) / line.length, lon0 = line.reduce((s, c) => s + c[0], 0) / line.length, kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  let P = line.map(([lo, la]) => [(lo - lon0) * kx, -(la - lat0) * ky]);
  while (P.length > 4 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 1) P.pop(); // closed ring duplicate
  let lenM = 0; P.forEach((p, i) => { const q = P[(i + 1) % P.length]; lenM += Math.hypot(q[0] - p[0], q[1] - p[1]); });
  const xs = P.map(p => p[0]), ys = P.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const s = Math.min(WORLD_W * 0.84 / Math.max(1, x1 - x0), WORLD_H * 0.84 / Math.max(1, y1 - y0)), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  P = P.map(p => [(p[0] - cx) * s + WORLD_W / 2, (p[1] - cy) * s + WORLD_H / 2]);
  const Rs = resampleLoop(P, 24); let eps = 3, out; do { out = rdpLoop(Rs, eps); eps *= 1.25; } while (out.length > 150);
  if (out.length < 8) out = resampleLoop(P, (lenM * s) / 16);
  return { name: item.name.slice(0, 32), width: 150, pts: out.map(p => norm(p[0], p[1])), start: norm(P[0][0], P[0][1]), th: clone(THEMES['Grand Prix']), geo: { km: Math.round(lenM / 10) / 100, mpp: Math.round(1000 / s) / 1000 } };
}
function pickCircuit(items) {
  return new Promise(res => {
    const ov = document.createElement('div'); ov.className = 'geoDlg'; ov.innerHTML = `<div class="geoBox"><h3>Pick a circuit</h3><p class="sm">This file has ${items.length} layouts.</p><input id="geoQ" placeholder="Search…"><select id="geoSel" size="10"></select><div class="row"><button class="mini" id="geoNo">Cancel</button><button class="mini on" id="geoOk">Import</button></div></div>`;
    document.body.appendChild(ov); const sel = ov.querySelector('#geoSel'), q = ov.querySelector('#geoQ');
    const fill = () => { const f = q.value.toLowerCase(); sel.innerHTML = items.map((x, i) => [x, i]).filter(([x]) => (x.name + ' ' + (x.props.Location || '')).toLowerCase().includes(f)).map(([x, i]) => `<option value="${i}">${esc(x.name)}${x.props.Location ? ' · ' + esc(x.props.Location) : ''}</option>`).join(''); sel.selectedIndex = 0; };
    fill(); q.oninput = fill; q.focus(); const done = v => { ov.remove(); res(v); };
    ov.querySelector('#geoNo').onclick = () => done(null); ov.querySelector('#geoOk').onclick = () => done(sel.value === '' ? null : items[+sel.value]); sel.ondblclick = () => done(items[+sel.value]);
  });
}
async function importGeo(file) {
  let j; try { j = JSON.parse(await file.text()); } catch (e) { return toast('That file is not valid GeoJSON.', 'err'); }
  const items = geoLines(j); if (!items.length) return toast('No circuit line found (needs a LineString, MultiLineString or Polygon).', 'err');
  const it = items.length === 1 ? items[0] : await pickCircuit(items); if (!it) return;
  try { const d = geoToTrack(it); BLD.list.push(d); saveDraft(); select(BLD.list.length - 1); toast(`Imported ${d.name} (${d.geo.km} km). Now add a Google Maps screenshot under Scenery image for buildings and trees.`, 'ok'); }
  catch (e) { toast('Import failed: ' + e.message, 'err'); }
}

// ---------- screenshot ----------
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not read that image')); i.src = src; }); }
async function uploadShot(file) {
  try {
    const u = URL.createObjectURL(file), im = await loadImg(u), k = Math.min(1, 2000 / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement('canvas');
    c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
    const src = c.toDataURL('image/jpeg', 0.82); const aspect = c.height / c.width;
    change(d => { d.bg = { src, x: 0.5, y: 0.5, w: 1, rot: 0, mode: 'stylised', bmin: 0.45, aspect }; fitImg(d); });
    setTool('img'); toast('Screenshot added. Line it up with the track: drag to move, scroll to resize, or Align with 2 points.', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}
function fitImg(d) { // guess: the circuit fills most of the screenshot
  const P = BLD.tr.pts, xs = P.map(p => p[0]), ys = P.map(p => p[1]), bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys), a = d.bg.aspect || 0.6;
  d.bg.x = R4((Math.max(...xs) + Math.min(...xs)) / 2 / WORLD_W); d.bg.y = R4((Math.max(...ys) + Math.min(...ys)) / 2 / WORLD_H); d.bg.w = R4(Math.max(bw, bh / a) * 1.25 / WORLD_W); d.bg.rot = 0;
}
function imgCorners(bg) { const img = bgImage(bg.src), w = bg.w * WORLD_W, h = w * (img.naturalWidth ? img.naturalHeight / img.naturalWidth : bg.aspect || 0.6), c = Math.cos(bg.rot || 0), s = Math.sin(bg.rot || 0), X = bg.x * WORLD_W, Y = bg.y * WORLD_H; return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [X + (u * w / 2) * c - (v * h / 2) * s, Y + (u * w / 2) * s + (v * h / 2) * c]); }
function drawBgOverlay(g, px) {
  const d = cur(); if (!d.bg || !d.bg.src) return; if (BLD.real && BLD.tool !== 'img') return;
  const img = bgImage(d.bg.src); if (!img.complete || !img.naturalWidth) { if (!img._hooked) { img._hooked = 1; img.addEventListener('load', () => draw(), { once: true }); } return; }
  g.save(); g.globalAlpha = BLD.imgA; bgPlace(g, d.bg, img, 1); g.restore();
  if (BLD.tool === 'img') { const C = imgCorners(d.bg); g.strokeStyle = '#00e5ff'; g.lineWidth = 2 * px; g.setLineDash([10 * px, 8 * px]); g.beginPath(); C.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.stroke(); g.setLineDash([]); }
}
function drawAlignMarks(g, px) {
  if (!BLD.align) return; BLD.align.pts.forEach((p, i) => { g.save(); g.translate(p[0], p[1]); g.scale(px, px); g.fillStyle = i % 2 ? '#19d36b' : '#00e5ff'; g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 11, 0, 7); g.fill(); g.stroke(); g.fillStyle = '#000'; g.font = '900 11px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(i < 2 ? 'A' : 'B', 0, 1); g.restore(); });
  const P = BLD.align.pts; for (let i = 1; i < P.length; i += 2) { g.strokeStyle = '#fff'; g.lineWidth = 2 * px; g.beginPath(); g.moveTo(P[i - 1][0], P[i - 1][1]); g.lineTo(P[i][0], P[i][1]); g.stroke(); }
}
const ALIGN_STEPS = ['Align 1/4: click a landmark on the SCREENSHOT (e.g. a hairpin apex).', 'Align 2/4: now click the same spot on YOUR TRACK.', 'Align 3/4: click a second landmark on the screenshot, far from the first.', 'Align 4/4: click that same spot on your track.'];
function alignStart() { if (!cur().bg) return toast('Upload a screenshot first.', 'err'); setTool('img'); BLD.align = { pts: [] }; $('bHint').textContent = ALIGN_STEPS[0]; draw(); }
function alignClick(w) {
  const A = BLD.align; A.pts.push(w); if (A.pts.length < 4) { $('bHint').textContent = ALIGN_STEPS[A.pts.length]; return draw(); }
  const [p1, t1, p2, t2] = A.pts, vp = [p2[0] - p1[0], p2[1] - p1[1]], vt = [t2[0] - t1[0], t2[1] - t1[1]], lp = Math.hypot(...vp); BLD.align = null; setTool('img');
  if (lp < 30) return toast('The two landmarks were too close together, try again further apart.', 'err');
  const k = Math.hypot(...vt) / lp, th = Math.atan2(vt[1], vt[0]) - Math.atan2(vp[1], vp[0]), c = Math.cos(th) * k, s = Math.sin(th) * k;
  change(d => { const X = d.bg.x * WORLD_W - p1[0], Y = d.bg.y * WORLD_H - p1[1]; d.bg.x = R4((t1[0] + X * c - Y * s) / WORLD_W); d.bg.y = R4((t1[1] + X * s + Y * c) / WORLD_H); d.bg.w = R4(d.bg.w * k); d.bg.rot = Math.round((((d.bg.rot || 0) + th + Math.PI * 3) % (Math.PI * 2) - Math.PI) * 10000) / 10000; });
  toast('Screenshot aligned to your track.', 'ok');
}
function imgDown(w) {
  const d = cur(); if (!d.bg) return toast('Upload a screenshot first (panel → Scenery image).', 'err');
  if (BLD.align) return alignClick(w); snap(); BLD.drag = { img: true, sx: w[0], sy: w[1], ox: d.bg.x, oy: d.bg.y };
}
function imgMove(w) { const D = BLD.drag, b = cur().bg; b.x = R4(D.ox + (w[0] - D.sx) / WORLD_W); b.y = R4(D.oy + (w[1] - D.sy) / WORLD_H); rebuild(); }
function imgWheel(e) {
  const d = cur(); if (!d.bg || e.ctrlKey) return false; const w = toWorld(e), f = Math.exp(-e.deltaY * 0.0012), now = Date.now();
  change(dd => { const b = dd.bg, X = b.x * WORLD_W, Y = b.y * WORLD_H; b.w = R4(Math.max(0.05, Math.min(6, b.w * f))); b.x = R4((w[0] + (X - w[0]) * f) / WORLD_W); b.y = R4((w[1] + (Y - w[1]) * f) / WORLD_H); }, now - (BLD._wt || 0) < 700); BLD._wt = now; return true;
}

// ---------- publishing: screenshots go to tracks/img/ in the game repo, tracks.json just references them ----------
function hashStr(s) { let h = 2166136261 >>> 0, h2 = 5381; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h = Math.imul(h ^ c, 16777619) >>> 0; h2 = (Math.imul(h2, 33) ^ c) >>> 0; } return h.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'); }
async function uploadTrackImages(list) {
  const out = clone(list), need = out.filter(t => t.bg && /^data:image\//.test(t.bg.src || '')); if (!need.length) return out;
  const repo = DCFG.gameRepo, br = (await gh(repo, 'GET', '')).data.default_branch || 'main';
  for (const t of need) {
    const data = t.bg.src.split(',')[1], path = 'tracks/img/' + hashStr(data) + (t.bg.src.startsWith('data:image/png') ? '.png' : '.jpg');
    const ex = await gh(repo, 'GET', '/contents/' + path + '?ref=' + br, null, [404]);
    if (ex.status === 404) await gh(repo, 'PUT', '/contents/' + path, { message: 'Track scenery: ' + t.name, content: data, branch: br });
    BG_IMGS[TRACK_ASSET_BASE + path] = bgImage(t.bg.src); t.bg.src = path; // keep showing the local copy while Pages rebuilds
  }
  return out;
}

// ---------- UI ----------
function F1_init() {
  TRACK_ASSET_BASE = gameUrl();
  $('bDup').insertAdjacentHTML('afterend', '<button id="bGeo" class="mini" title="Import a real circuit layout (.geojson)">+ From GeoJSON</button><input type="file" id="bGeoFile" accept=".geojson,.json,application/geo+json,application/json" class="hidden"><input type="file" id="pImgFile" accept="image/*" class="hidden">');
  const sep = document.querySelector('#bBar .sep'); const tb = document.createElement('button'); tb.dataset.tool = 'img'; tb.innerHTML = 'Image <kbd>I</kbd>'; sep.parentNode.insertBefore(tb, sep); tb.onclick = () => { BLD.align = null; setTool('img'); };
  $('pThemes').insertAdjacentHTML('afterend', `<div class="ah">Scenery image</div>
    <p class="sm">Upload a north-up Google Maps screenshot of the circuit. Buildings, trees, water and car parks around your track are turned into game scenery. Turn on the realistic preview to see the result.</p>
    <div class="row"><button id="pImg" class="mini">Upload screenshot</button><button id="pImgDel" class="mini">Remove</button></div>
    <div id="pImgOpts" class="hidden">
      <label>Style<select id="pImgMode"><option value="stylised">Stylised (game look)</option><option value="photo">Photo (raw screenshot)</option></select></label>
      <label>Overlay opacity (editor only) <span id="pImgAv"></span><input type="range" id="pImgA" min="0" max="1" step="0.05"></label>
      <label>Size <span id="pImgSv"></span><input type="range" id="pImgS" min="0.1" max="4" step="0.005"></label>
      <label>Rotate <span id="pImgRv"></span><input type="range" id="pImgR" min="-180" max="180" step="0.5"></label>
      <label>Building detection <span id="pImgBv"></span><input type="range" id="pImgB" min="0.25" max="0.85" step="0.01"></label>
      <div class="row"><button id="pImgFit" class="mini">Fit to track</button><button id="pImgAlign" class="mini">Align with 2 points</button></div>
    </div><p class="sm" id="pGeo"></p>`);
  $('bGeo').onclick = () => $('bGeoFile').click(); $('bGeoFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importGeo(f); };
  $('pImg').onclick = () => $('pImgFile').click(); $('pImgFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) uploadShot(f); };
  $('pImgDel').onclick = () => { if (cur().bg && confirm('Remove the scenery screenshot from this track?')) change(d => delete d.bg); };
  $('pImgMode').onchange = e => change(d => d.bg.mode = e.target.value);
  $('pImgA').oninput = e => { BLD.imgA = +e.target.value; imgPanelUI(); draw(); };
  [['pImgS', (d, v) => d.bg.w = v], ['pImgR', (d, v) => d.bg.rot = Math.round(v * Math.PI / 180 * 10000) / 10000], ['pImgB', (d, v) => d.bg.bmin = v]].forEach(([id, fn]) => { $(id).onpointerdown = () => snap(); $(id).oninput = e => change(d => fn(d, +e.target.value), true); });
  $('pImgFit').onclick = () => change(d => fitImg(d)); $('pImgAlign').onclick = alignStart;
}
function imgPanelUI() {
  const d = cur(), b = d.bg; if (!$('pImgOpts')) return; $('pImgOpts').classList.toggle('hidden', !b); $('pImgDel').classList.toggle('hidden', !b); $('pImg').textContent = b ? 'Replace screenshot' : 'Upload screenshot';
  if (b) { $('pImgMode').value = b.mode || 'stylised'; $('pImgA').value = BLD.imgA; $('pImgAv').textContent = Math.round(BLD.imgA * 100) + '%'; $('pImgS').value = b.w; $('pImgSv').textContent = b.w.toFixed(2); const deg = Math.round((b.rot || 0) * 1800 / Math.PI) / 10; $('pImgR').value = deg; $('pImgRv').textContent = deg + '°'; $('pImgB').value = b.bmin || 0.45; $('pImgBv').textContent = (b.bmin || 0.45).toFixed(2); }
  $('pGeo').textContent = d.geo ? `Real circuit: ${d.geo.km} km · 1 px ≈ ${d.geo.mpp} m. Real F1 roads are ~15 m wide, so a game-width road may overlap on tight sections: lower Width if red rings appear.` : '';
}
