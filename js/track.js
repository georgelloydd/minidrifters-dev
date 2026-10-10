// ===== Tracks: spline centreline, baked scenery canvas, nearest-point queries =====
let WORLD_W = 4400, WORLD_H = 3200; // current track's world size in px (each track can set its own with def.world)
const WORLD_DEF = [4400, 3200], PX_PER_M = 14.4; // 14.4 px = 1 m (matches the speedo: the car is ~4 m long)
function worldOf(def) { const w = def && def.world; return Array.isArray(w) && w[0] >= 1000 && w[1] >= 1000 ? [Math.min(200000, Math.round(+w[0])), Math.min(200000, Math.round(+w[1]))] : WORLD_DEF.slice(); }
function useWorld(def) { const w = worldOf(def); WORLD_W = w[0]; WORLD_H = w[1]; }
function bakeScale(W, H) { return Math.min(1, 8192 / Math.max(W, H), Math.sqrt(40e6 / (W * H))); }
const TRACKS = [
  { name: 'Sunset Circuit', width: 170, pts: [[0.12, 0.55], [0.14, 0.25], [0.3, 0.12], [0.5, 0.18], [0.62, 0.36], [0.76, 0.16], [0.9, 0.24], [0.9, 0.52], [0.76, 0.62], [0.88, 0.8], [0.7, 0.9], [0.5, 0.78], [0.36, 0.9], [0.18, 0.85]],
    th: { grass: '#4c8c3c', grass2: '#5a9c47', road: '#3a3c42', sand: '#d8c48f', tree: ['#2f6e2a', '#3f8a35'] } },
  { name: 'Neon Docks', width: 160, pts: [[0.1, 0.2], [0.35, 0.1], [0.52, 0.22], [0.42, 0.42], [0.6, 0.5], [0.72, 0.15], [0.9, 0.18], [0.92, 0.5], [0.8, 0.62], [0.9, 0.86], [0.6, 0.9], [0.48, 0.72], [0.3, 0.88], [0.1, 0.8], [0.18, 0.55], [0.08, 0.42]],
    th: { grass: '#2b3346', grass2: '#323b52', road: '#26272d', sand: '#4a5068', tree: ['#1f6f8b', '#2d8fb0'], night: true } },
  { name: 'Snowpeak Hairpins', width: 150, pts: [[0.1, 0.5], [0.12, 0.12], [0.3, 0.1], [0.32, 0.4], [0.45, 0.42], [0.47, 0.1], [0.68, 0.1], [0.7, 0.42], [0.9, 0.4], [0.9, 0.88], [0.62, 0.9], [0.6, 0.65], [0.42, 0.66], [0.4, 0.9], [0.14, 0.88]],
    th: { grass: '#dfe8ef', grass2: '#eef3f7', road: '#4a4d55', sand: '#b9c6d2', tree: ['#2c5a3f', '#3c7452'], snow: true } },
];
function crPoint(p0, p1, p2, p3, t) { const t2 = t * t, t3 = t2 * t; return [0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3), 0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]; }
function rnd(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function trackDef(x) { return x && typeof x === 'object' ? x : (TRACKS[x] || TRACKS[0]); }
function nearIdx(pts, x, y) { let bi = 0, bd = 1e18; for (let i = 0; i < pts.length; i++) { const d = (pts[i][0] - x) ** 2 + (pts[i][1] - y) ** 2; if (d < bd) { bd = d; bi = i; } } return bi; }
function buildTrack(x, noBake) {
  fixDef(trackDef(x)); useWorld(trackDef(x)); const def = trackDef(x), idx = typeof x === 'number' ? x : 0, cp = def.pts.map(p => [p[0] * WORLD_W, p[1] * WORLD_H]), raw = [];
  for (let i = 0; i < cp.length; i++) { const p0 = cp[(i - 1 + cp.length) % cp.length], p1 = cp[i], p2 = cp[(i + 1) % cp.length], p3 = cp[(i + 2) % cp.length]; for (let k = 0; k < 60; k++) raw.push(crPoint(p0, p1, p2, p3, k / 60)); }
  // resample to even spacing (~12px)
  let L = 0; const cum = [0]; for (let i = 1; i <= raw.length; i++) { const a = raw[i - 1], b = raw[i % raw.length]; L += Math.hypot(b[0] - a[0], b[1] - a[1]); cum.push(L); }
  const N = Math.round(L / 12), pts = []; let j = 0;
  for (let k = 0; k < N; k++) { const d = k * L / N; while (cum[j + 1] < d) j++; const a = raw[j], b = raw[(j + 1) % raw.length], f = (d - cum[j]) / (cum[j + 1] - cum[j] || 1); pts.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); }
  // start position + direction: rotate so pts[0] is the start line, optionally reverse
  if (def.start) { const s0 = nearIdx(pts, def.start[0] * WORLD_W, def.start[1] * WORLD_H); const r = pts.splice(0, s0); pts.push(...r); }
  if (def.rev) { const r = pts.splice(1).reverse(); pts.push(...r); }
  const dirs = pts.map((p, i) => { const q = pts[(i + 1) % N], r = pts[(i - 1 + N) % N]; return Math.atan2(q[1] - r[1], q[0] - r[0]); });
  // checkpoint gates: explicit positions projected onto the line, else 7 evenly spaced
  let gi = Array.isArray(def.cps) && def.cps.length ? def.cps.map(c => nearIdx(pts, c[0] * WORLD_W, c[1] * WORLD_H)) : [1, 2, 3, 4, 5, 6, 7].map(k => Math.floor(k * N / 8));
  gi = [...new Set(gi.filter(i => i > N * 0.02 && i < N * 0.98))].sort((a, b) => a - b);
  if (!gi.length) gi = [1, 2, 3, 4, 5, 6, 7].map(k => Math.floor(k * N / 8));
  const tr = { walls: wallSegs(def), idx, def, W: WORLD_W, H: WORLD_H, name: def.name, w: def.width, pts, dirs, n: N, len: L, th: def.th, gates: gi.map((i, k) => ({ s: k + 1, i })) };
  tr.elev = elevSecs(tr); tr.rails = railSegs(tr);
  tr.canvas = noBake ? null : bakeTrack(tr); return tr;
}
function pathTrack(g, tr) { g.beginPath(); tr.pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); }
function bakeTrack(tr, cIn) { // bakes in this track's own world size (it can re-bake later when a screenshot loads)
  const pw = WORLD_W, ph = WORLD_H; WORLD_W = tr.W || pw; WORLD_H = tr.H || ph;
  try { return bakeTrackIn(tr, cIn); } finally { WORLD_W = pw; WORLD_H = ph; }
}
function bakeTrackIn(tr, cIn) {
  const bs = tr.bs = cIn && tr.bs ? tr.bs : bakeScale(WORLD_W, WORLD_H), AF = Math.max(1, Math.min(8, WORLD_W * WORLD_H / 14080000));
  const c = cIn || document.createElement('canvas'); if (!cIn) { c.width = Math.ceil(WORLD_W * bs); c.height = Math.ceil(WORLD_H * bs); } const g = c.getContext('2d'), th = tr.th, R = rnd(tr.def.seed || (tr.idx * 977 + 13));
  // optional real-circuit scenery from an uploaded map screenshot (bakes again once the image has loaded)
  const bg = tr.def.bg, img = bg && bg.src ? bgImage(bg.src) : null, scen = !!(img && img.complete && img.naturalWidth);
  if (img && !scen && !img._failed) img.addEventListener('load', () => { bakeTrack(tr, c); if (typeof onTrackRebaked === 'function') onTrackRebaked(tr); }, { once: true });
  g.setTransform(bs, 0, 0, bs, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  g.fillStyle = th.grass; g.fillRect(0, 0, WORLD_W, WORLD_H);
  if (scen) { try { drawScenery(g, tr, img, R); } catch (e) { console.warn('[scenery]', e); } }
  else {
  for (let i = 0, nb = 2600 * AF; i < nb; i++) { g.fillStyle = R() < 0.5 ? th.grass2 : 'rgba(0,0,0,.05)'; g.globalAlpha = 0.35; g.beginPath(); g.arc(R() * WORLD_W, R() * WORLD_H, 20 + R() * 90, 0, 7); g.fill(); }
  
  }
  g.globalAlpha = 1; g.lineJoin = g.lineCap = 'round';
  // runoff, kerbs, road
  pathTrack(g, tr); g.strokeStyle = th.sand; g.lineWidth = tr.w + 110; g.stroke();
  g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = tr.w + 34; g.stroke();
  g.strokeStyle = '#f2f2f2'; g.lineWidth = tr.w + 26; g.stroke();
  g.setLineDash([34, 34]); g.strokeStyle = th.night ? '#ff2fb0' : '#d8262f'; g.stroke(); g.setLineDash([]);
  g.strokeStyle = th.road; g.lineWidth = tr.w; g.stroke();
  // asphalt grain
  g.save(); pathTrack(g, tr); g.lineWidth = tr.w; g.strokeStyle = '#000'; g.globalCompositeOperation = 'source-atop';
  for (let i = 0; i < tr.n; i += 2) { const p = tr.pts[i]; for (let k = 0; k < 3; k++) { g.fillStyle = R() < 0.5 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.06)'; g.fillRect(p[0] + (R() - 0.5) * tr.w, p[1] + (R() - 0.5) * tr.w, 3, 3); } }
  g.restore();
  // edge lines + centre dashes
  pathTrack(g, tr); g.setLineDash([40, 50]); g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 4; g.stroke(); g.setLineDash([]);
  // start / finish checker
  const p0 = tr.pts[0], a0 = tr.dirs[0], nx = -Math.sin(a0), ny = Math.cos(a0), sq = tr.w / 10;
  g.save(); g.translate(p0[0], p0[1]); g.rotate(a0); for (let r = 0; r < 2; r++) for (let k = 0; k < 10; k++) { g.fillStyle = (r + k) % 2 ? '#111' : '#fff'; g.fillRect(-sq + r * sq, -tr.w / 2 + k * sq, sq, sq); } g.restore();
  // grid boxes
  for (let s = 0; s < 8; s++) { const gp = gridSlot(tr, s); g.save(); g.translate(gp.x, gp.y); g.rotate(gp.a); g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 3; g.beginPath(); g.moveTo(34, -24); g.lineTo(40, -24); g.lineTo(40, 24); g.lineTo(34, 24); g.stroke(); g.restore(); }
  // grandstand near start
  { const gx = p0[0] + nx * (tr.w / 2 + 120), gy = p0[1] + ny * (tr.w / 2 + 120); g.save(); g.translate(gx, gy); g.rotate(a0); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(-190, -30, 400, 80); g.fillStyle = '#8a8f99'; g.fillRect(-200, -40, 400, 80); for (let i = 0; i < 260; i++) { g.fillStyle = ['#e74c3c', '#f1c40f', '#3498db', '#ecf0f1', '#9b59b6', '#2ecc71'][Math.floor(R() * 6)]; g.beginPath(); g.arc(-190 + R() * 380, -30 + R() * 60, 4, 0, 7); g.fill(); } g.fillStyle = th.night ? '#ff2fb0' : '#d8262f'; g.fillRect(-200, -52, 400, 14); g.restore(); }
  // trees / props off-track
  let placed = 0;
  for (let tries = 0; tries < 6000 * AF && placed < (scen || th.scene === 'none' ? 0 : 520 * AF); tries++) {
    const x = R() * WORLD_W, y = R() * WORLD_H; if (nearestFull(tr, x, y).d < (th.scene === 'city' ? tr.w * 1.5 + 95 : tr.w / 2 + 130)) continue; placed++;
    const r = 26 + R() * 30;
    if (th.scene === 'city' && R() < 0.88) { const bw = 40 + R() * 70, bh = 40 + R() * 70, ang = R() < 0.6 ? 0 : R() * Math.PI; g.save(); g.translate(x, y); g.rotate(ang); g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(-bw / 2 + 12, -bh / 2 + 14, bw, bh);
      const pal = th.night ? ['#1c2233', '#232b40', '#2a2f45', '#30283a'] : ['#8e949e', '#a3a9b2', '#6f757e', '#b8a58f', '#9a8f84', '#c7c9cc']; g.fillStyle = pal[Math.floor(R() * pal.length)]; g.fillRect(-bw / 2, -bh / 2, bw, bh);
      g.strokeStyle = 'rgba(0,0,0,.22)'; g.lineWidth = 3; g.strokeRect(-bw / 2 + 5, -bh / 2 + 5, bw - 10, bh - 10);
      for (let k = 0, nk = 1 + Math.floor(R() * 4); k < nk; k++) { g.fillStyle = th.night ? (R() < 0.5 ? '#ffe14d' : '#00e5ff') : '#d6d8db'; g.fillRect((R() - 0.5) * (bw - 24) - 5, (R() - 0.5) * (bh - 24) - 5, 10, 10); }
      g.restore(); continue; }
    if (th.scene === 'desert') { if (R() < 0.6) { const rr = r * 0.55; g.fillStyle = 'rgba(0,0,0,.2)'; g.beginPath(); g.ellipse(x + 8, y + 9, rr, rr * 0.75, 0, 0, 7); g.fill(); g.fillStyle = ['#9c7b55', '#a98a62', '#8a6a48'][Math.floor(R() * 3)]; g.beginPath(); g.ellipse(x, y, rr, rr * 0.75, R() * 3, 0, 7); g.fill(); g.fillStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.arc(x - rr * 0.3, y - rr * 0.25, rr * 0.35, 0, 7); g.fill(); }
      else { const cr = r * 0.22; g.fillStyle = 'rgba(0,0,0,.22)'; g.beginPath(); g.arc(x + 7, y + 8, cr * 1.6, 0, 7); g.fill(); g.fillStyle = '#4f7d3a'; for (const [ox, oy, rad] of [[0, 0, cr], [cr * 1.4, -cr * 0.4, cr * 0.6], [-cr * 1.4, cr * 0.3, cr * 0.6]]) { g.beginPath(); g.arc(x + ox, y + oy, rad, 0, 7); g.fill(); } g.fillStyle = '#6a9a4c'; g.beginPath(); g.arc(x - cr * 0.3, y - cr * 0.3, cr * 0.45, 0, 7); g.fill(); }
      continue; }
    if (th.night && R() < 0.35) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x - r + 10, y - r + 10, r * 2, r * 2.4); g.fillStyle = ['#1c2233', '#232b40', '#2a2f45'][Math.floor(R() * 3)]; g.fillRect(x - r, y - r, r * 2, r * 2.4); g.fillStyle = ['#00e5ff', '#ff2fb0', '#ffe14d'][Math.floor(R() * 3)]; g.globalAlpha = 0.7; g.fillRect(x - r, y - r, r * 2, 4); g.globalAlpha = 1; continue; }
    g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.arc(x + 12, y + 14, r, 0, 7); g.fill();
    const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r); gr.addColorStop(0, th.tree[1]); gr.addColorStop(1, th.tree[0]); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    if (th.snow) { g.fillStyle = 'rgba(255,255,255,.8)'; g.beginPath(); g.arc(x - r * 0.25, y - r * 0.25, r * 0.45, 0, 7); g.fill(); }
  }
  // tyre stacks on outside of tight corners
  for (let i = 0; i < tr.n; i += 6) { const da = angDiff(tr.dirs[(i + 6) % tr.n], tr.dirs[i]); if (Math.abs(da) < 0.12) continue; const side = da > 0 ? -1 : 1, p = tr.pts[i], d = tr.w / 2 + 70; const x = p[0] + Math.cos(tr.dirs[i] + Math.PI / 2) * d * side, y = p[1] + Math.sin(tr.dirs[i] + Math.PI / 2) * d * side; if (nearestFull(tr, x, y).d < tr.w / 2 + 50) continue; g.fillStyle = '#16161a'; g.beginPath(); g.arc(x, y, 13, 0, 7); g.fill(); g.strokeStyle = (i / 6) % 2 ? '#fff' : (th.night ? '#00e5ff' : '#d8262f'); g.lineWidth = 4; g.beginPath(); g.arc(x, y, 9, 0, 7); g.stroke(); }
  return c;
}
function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
function nearestFull(tr, x, y) { let bi = 0, bd = 1e18; for (let i = 0; i < tr.n; i += 3) { const p = tr.pts[i], d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < bd) { bd = d; bi = i; } } return refine(tr, x, y, bi, 4); }
function refine(tr, x, y, hint, win) { let bi = hint, bd = 1e18; for (let k = -win; k <= win; k++) { const i = (hint + k + tr.n) % tr.n, p = tr.pts[i], d = (p[0] - x) ** 2 + (p[1] - y) ** 2; if (d < bd) { bd = d; bi = i; } } return { i: bi, d: Math.sqrt(bd) }; }
function nearest(tr, x, y, hint) { const r = refine(tr, x, y, hint, 30); return r.d > tr.w * 1.6 ? nearestFull(tr, x, y) : r; }
function gridSlot(tr, s) { const i = (((tr.n - 6 - Math.floor(s / 2) * 7) % tr.n) + tr.n) % tr.n, p = tr.pts[i], a = tr.dirs[i], side = s % 2 ? 1 : -1, off = side * tr.w * 0.22; return { x: p[0] - Math.sin(a) * off, y: p[1] + Math.cos(a) * off, a, i }; }

// ===== Real-circuit scenery: a north-up map screenshot placed under the track (def.bg) =====
// bg = { src, x, y (centre, 0-1 of world), w (width, 0-1 of world), rot (radians), mode: 'stylised' | 'photo', bmin (building detection 0.3-0.8) }
const BG_IMGS = {}, SCEN_CACHE = {}; let TRACK_ASSET_BASE = '';
function bgImage(src) {
  const u = /^(data:|blob:|https?:)/.test(src) ? src : TRACK_ASSET_BASE + src; let i = BG_IMGS[u];
  if (!i) { i = new Image(); if (!u.startsWith('data:') && !u.startsWith('blob:')) i.crossOrigin = 'anonymous'; i.onerror = () => { i._failed = true; }; i.src = u; BG_IMGS[u] = i; }
  return i;
}
function bgPlace(g, bg, img, k) {
  const s = bg.w * WORLD_W / img.naturalWidth; g.save(); g.scale(k, k); g.translate(bg.x * WORLD_W, bg.y * WORLD_H); g.rotate(bg.rot || 0); g.scale(s, s); g.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2); g.restore();
}
// 0 ground, 1 trees/grass, 2 water, 3 building, 4 paved (roads, car parks, tarmac)
function sceneryClasses(bg, img) {
  const key = [bg.src.length, bg.src.slice(-40), bg.x, bg.y, bg.w, bg.rot, bg.bmin].join('|'); if (SCEN_CACHE[key]) return SCEN_CACHE[key];
  const K = Math.max(3, Math.ceil(Math.sqrt(WORLD_W * WORLD_H / 1.6e6))), W = Math.ceil(WORLD_W / K), H = Math.ceil(WORLD_H / K), c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true }); bgPlace(g, bg, img, 1 / K);
  const px = g.getImageData(0, 0, W, H).data, m = new Uint8Array(W * H), bmin = bg.bmin || 0.45;
  for (let i = 0, j = 0; i < m.length; i++, j += 4) {
    if (px[j + 3] < 128) continue; const r = px[j], gg = px[j + 1], b = px[j + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), l = (mx + mn) / 510, d = (mx - mn) / 255, s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1) || 1);
    let h = 0; if (d) { h = mx === r ? ((gg - b) / (mx - mn)) % 6 : mx === gg ? (b - r) / (mx - mn) + 2 : (r - gg) / (mx - mn) + 4; h = (h * 60 + 360) % 360; }
    if (s > 0.16 && d > 0.06) m[i] = h >= 180 && h <= 250 ? 2 : h >= 60 && h < 180 ? 1 : h >= 35 && h < 60 && l > 0.6 ? 4 : 0;
    else m[i] = l >= 0.985 ? 4 : l > 0.935 ? 0 : l > bmin ? 3 : 4;
  }
  // smooth: majority of the 3x3 neighbourhood removes map labels, outlines and noise
  const o = new Uint8Array(m.length), cnt = new Uint8Array(5);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    cnt.fill(0); for (let dy = -1; dy <= 1; dy++) { const yy = Math.min(H - 1, Math.max(0, y + dy)); for (let dx = -1; dx <= 1; dx++) cnt[m[yy * W + Math.min(W - 1, Math.max(0, x + dx))]]++; }
    let best = m[y * W + x]; for (let k = 0; k < 5; k++) if (cnt[k] > cnt[best]) best = k; o[y * W + x] = cnt[best] >= 4 ? best : m[y * W + x];
  }
  return (SCEN_CACHE[key] = { K, W, H, m: o });
}
function hexRgb(h) { const n = parseInt(String(h).slice(1), 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function drawScenery(g, tr, img, R) {
  const bg = tr.def.bg, th = tr.th;
  if (bg.mode === 'photo') { bgPlace(g, bg, img, 1); g.fillStyle = th.night ? 'rgba(4,6,22,.4)' : 'rgba(0,0,0,.06)'; g.fillRect(0, 0, WORLD_W, WORLD_H); return; }
  const S = sceneryClasses(bg, img), { K, W, H, m } = S, night = !!th.night;
  const pal = [hexRgb(th.grass), hexRgb(th.grass2), night ? [22, 48, 78] : th.snow ? [150, 182, 205] : [72, 138, 190], hexRgb(th.road), night ? [44, 47, 58] : th.snow ? [190, 196, 204] : [150, 153, 160]];
  const veg = hexRgb(th.tree[0]); pal[1] = pal[1].map((v, i) => Math.round(v * 0.55 + veg[i] * 0.45));
  const base = document.createElement('canvas'), roof = document.createElement('canvas'), sh = document.createElement('canvas'); [base, roof, sh].forEach(x => { x.width = W; x.height = H; });
  const bd = base.getContext('2d').createImageData(W, H), rd = roof.getContext('2d').createImageData(W, H), sd = sh.getContext('2d').createImageData(W, H);
  const roofs = night ? [[58, 64, 88], [48, 54, 76], [70, 62, 84]] : th.snow ? [[236, 240, 244], [222, 228, 234], [210, 214, 220]] : [[214, 208, 198], [196, 192, 186], [178, 70, 58], [226, 222, 214], [150, 156, 166]];
  for (let i = 0, j = 0; i < m.length; i++, j += 4) {
    const k = m[i], n = ((i * 2654435761) >>> 24) / 255 * 10 - 5; const c = pal[k === 3 ? 4 : k];
    bd.data[j] = c[0] + n; bd.data[j + 1] = c[1] + n; bd.data[j + 2] = c[2] + n; bd.data[j + 3] = 255;
    if (k === 3) { const x = i % W, y = (i / W) | 0, q = roofs[((((x >> 4) * 73856093) ^ ((y >> 4) * 19349663)) >>> 0) % roofs.length];
      rd.data[j] = q[0] + n; rd.data[j + 1] = q[1] + n; rd.data[j + 2] = q[2] + n; rd.data[j + 3] = 255; sd.data[j + 3] = 255; }
  }
  base.getContext('2d').putImageData(bd, 0, 0); roof.getContext('2d').putImageData(rd, 0, 0); sh.getContext('2d').putImageData(sd, 0, 0);
  g.save(); g.imageSmoothingEnabled = true; g.drawImage(base, 0, 0, W * K, H * K);
  // buildings: soft drop shadow, darker edge, then the roof
  g.globalAlpha = night ? 0.55 : 0.32; g.drawImage(sh, 14, 18, W * K, H * K); g.drawImage(sh, 7, 9, W * K, H * K);
  g.globalAlpha = 1; g.filter = 'brightness(0.72)'; g.drawImage(roof, 2, 2, W * K, H * K); g.filter = 'none'; g.drawImage(roof, 0, 0, W * K, H * K);
  if (night) { g.globalAlpha = 0.6; for (let t = 0; t < 1400; t++) { const x = (R() * W) | 0, y = (R() * H) | 0; if (m[y * W + x] !== 3) continue; g.fillStyle = ['#ffe14d', '#00e5ff', '#ff2fb0'][(R() * 3) | 0]; g.fillRect(x * K, y * K, 5, 5); } g.globalAlpha = 1; }
  g.restore();
  // trees on the green areas, kept clear of the road
  let placed = 0;
  const AF = Math.max(1, Math.min(8, WORLD_W * WORLD_H / 14080000)); for (let t = 0; t < 14000 * AF && placed < 900 * AF; t++) {
    const x = R() * WORLD_W, y = R() * WORLD_H, k = m[((y / K) | 0) * W + ((x / K) | 0)]; if (k !== 1 || R() < 0.35) continue; if (nearestFull(tr, x, y).d < tr.w / 2 + 120) continue; placed++;
    const r = 16 + R() * 22; g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.arc(x + 9, y + 11, r, 0, 7); g.fill();
    const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r); gr.addColorStop(0, th.tree[1]); gr.addColorStop(1, th.tree[0]); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    if (th.snow) { g.fillStyle = 'rgba(255,255,255,.8)'; g.beginPath(); g.arc(x - r * 0.25, y - r * 0.25, r * 0.45, 0, 7); g.fill(); }
  }
}

// Sharp road on top of a down-sampled bake (huge / real-scale tracks). Only the part on screen is drawn.
function drawRoadLive(g, tr, x0, y0, x1, y1) {
  const P = tr.pts, n = tr.n, m = tr.w + 80, th = tr.th, vis = new Uint8Array(n); let any = 0;
  for (let k = 0; k < n; k++) { const q = P[k]; if (q[0] > x0 - m && q[0] < x1 + m && q[1] > y0 - m && q[1] < y1 + m) { vis[k] = 1; any = 1; } }
  if (!any) return;
  const path = test => { const p = new Path2D(); let on = false; for (let k = 0; k <= n; k++) { const i = k % n, j = (k + 1) % n; if (k < n && vis[i] && test(i)) { if (!on) { p.moveTo(P[i][0], P[i][1]); on = true; } p.lineTo(P[j][0], P[j][1]); } else on = false; } return p; };
  const all = path(() => true);
  g.save(); g.lineJoin = g.lineCap = 'round';
  g.strokeStyle = '#f2f2f2'; g.lineWidth = tr.w + 26; g.stroke(all);
  g.lineCap = 'butt'; g.strokeStyle = th.night ? '#ff2fb0' : '#d8262f'; g.stroke(path(i => ((i / 3) | 0) % 2 === 0));
  g.lineCap = 'round'; g.strokeStyle = th.road; g.lineWidth = tr.w; g.stroke(all);
  g.lineCap = 'butt'; g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 4; g.stroke(path(i => i % 8 < 3));
  const p0 = P[0], a0 = tr.dirs[0], sq = tr.w / 10;
  if (vis[0]) { g.save(); g.translate(p0[0], p0[1]); g.rotate(a0); for (let r = 0; r < 2; r++) for (let k = 0; k < 10; k++) { g.fillStyle = (r + k) % 2 ? '#111' : '#fff'; g.fillRect(-sq + r * sq, -tr.w / 2 + k * sq, sq, sq); } g.restore();
    for (let s = 0; s < 8; s++) { const gp = gridSlot(tr, s); g.save(); g.translate(gp.x, gp.y); g.rotate(gp.a); g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 3; g.beginPath(); g.moveTo(34, -24); g.lineTo(40, -24); g.lineTo(40, 24); g.lineTo(34, 24); g.stroke(); g.restore(); } }
  g.restore();
}

// ---------- safety: repair broken / partial track data so a bad tracks.json can't crash the game ----------
const DEF_TH = { grass: '#4c8c3c', grass2: '#5a9c47', road: '#3a3c42', sand: '#d8c48f', tree: ['#2f6e2a', '#3f8a35'] };
const finPt = p => Array.isArray(p) && p.length >= 2 && p[0] !== null && p[1] !== null && isFinite(p[0]) && isFinite(p[1]);
function fixDef(d) {
  if (!d || d._ok) return d;
  if (!Array.isArray(d.pts)) d.pts = [];
  d.pts = d.pts.filter(finPt).map(p => [Math.max(0, Math.min(1, +p[0])), Math.max(0, Math.min(1, +p[1]))]);
  if (d.pts.length < 4) d.pts = TRACKS[0] && TRACKS[0] !== d && TRACKS[0].pts.length >= 4 ? TRACKS[0].pts.map(p => p.slice()) : [[0.2, 0.3], [0.8, 0.3], [0.8, 0.7], [0.2, 0.7]];
  d.width = Math.max(60, Math.min(400, +d.width || 170));
  d.name = String(d.name || 'Track').slice(0, 40);
  const th = d.th && typeof d.th === 'object' ? d.th : {}; d.th = Object.assign({}, DEF_TH, th);
  if (!Array.isArray(d.th.tree) || d.th.tree.length < 2) d.th.tree = DEF_TH.tree.slice();
  if (d.start && !finPt(d.start)) delete d.start;
  if (d.cps && !Array.isArray(d.cps)) delete d.cps; else if (d.cps) d.cps = d.cps.filter(finPt);
  if (d.walls && !Array.isArray(d.walls)) delete d.walls; else if (d.walls) d.walls = d.walls.filter(w => Array.isArray(w)).map(w => w.filter(finPt)).filter(w => w.length >= 2);
  if (d.elev && !Array.isArray(d.elev)) delete d.elev; else if (d.elev) d.elev = d.elev.filter(e => e && (e.t === 'bridge' || e.t === 'tunnel') && finPt(e.a) && finPt(e.b));
  if (d.spawn && !(typeof d.spawn === 'object' && finPt(d.spawn.p))) delete d.spawn;
  if (d.th.scene && !['city', 'desert', 'none'].includes(d.th.scene)) delete d.th.scene;
  Object.defineProperty(d, '_ok', { value: true, enumerable: false, configurable: true, writable: true });
  return d;
}
// ---------- barriers: def.walls = [[[nx,ny],[nx,ny],...], ...] (normalised polylines) ----------
const WALL_R = 17;
function wallSegs(def) {
  const S = []; if (!def || !Array.isArray(def.walls)) return S;
  for (const w of def.walls) { if (!Array.isArray(w)) continue; for (let i = 1; i < w.length; i++) { const a = w[i - 1], b = w[i]; if (!finPt(a) || !finPt(b)) continue;
    const ax = a[0] * WORLD_W, ay = a[1] * WORLD_H, bx = b[0] * WORLD_W, by = b[1] * WORLD_H; if (Math.hypot(bx - ax, by - ay) < 1) continue;
    S.push({ ax, ay, bx, by, x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) }); } }
  return S;
}
function drawWalls(g, tr) {
  const S = tr && tr.walls; if (!S || !S.length) return;
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); for (const s of S) { g.moveTo(s.ax, s.ay); g.lineTo(s.bx, s.by); }
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 16; g.stroke();
  g.strokeStyle = '#c9ced6'; g.lineWidth = 11; g.stroke();
  g.setLineDash([22, 22]); g.strokeStyle = tr.th && tr.th.night ? '#ff2fb0' : '#d8262f'; g.lineWidth = 5; g.stroke(); g.setLineDash([]);
  g.restore();
}
function wallCollide(c, tr) { return segCollide(c, tr && tr.walls, null); }
function segCollide(c, S, L) {
  if (!S || !S.length) return false; let hit = false;
  for (const s of S) {
    if (L !== null && s.L !== L) continue;
    if (c.x < s.x0 - WALL_R || c.x > s.x1 + WALL_R || c.y < s.y0 - WALL_R || c.y > s.y1 + WALL_R) continue;
    const dx = s.bx - s.ax, dy = s.by - s.ay, L2 = dx * dx + dy * dy, t = Math.max(0, Math.min(1, ((c.x - s.ax) * dx + (c.y - s.ay) * dy) / L2));
    const qx = s.ax + dx * t, qy = s.ay + dy * t; let nx = c.x - qx, ny = c.y - qy, d = Math.hypot(nx, ny);
    if (d >= WALL_R) continue;
    if (d < 1e-3) { const l = Math.sqrt(L2); nx = -dy / l; ny = dx / l; if (nx * c.vx + ny * c.vy > 0) { nx = -nx; ny = -ny; } } else { nx /= d; ny /= d; }
    c.x = qx + nx * WALL_R; c.y = qy + ny * WALL_R;
    const vn = c.vx * nx + c.vy * ny; if (vn < 0) { c.vx -= 1.4 * vn * nx; c.vy -= 1.4 * vn * ny; c.vx *= 0.82; c.vy *= 0.82; c.wallHit = Math.max(c.wallHit || 0, -vn); }
    hit = true;
  }
  return hit;
}

// ---------- elevation: def.elev = [{ t: 'bridge'|'tunnel', a, m, b }] (normalised points on the road; m picks which way round) ----------
function elevSecs(tr) {
  const E = tr.def.elev, N = tr.n; tr.layerAt = null; if (!Array.isArray(E) || !E.length) return [];
  const L = new Int8Array(N), S = [], ix = p => nearIdx(tr.pts, p[0] * tr.W, p[1] * tr.H);
  E.forEach((e, k) => {
    if (!e || !finPt(e.a) || !finPt(e.b)) return; let a = ix(e.a), b = ix(e.b); const m = finPt(e.m) ? ix(e.m) : null; let len = (b - a + N) % N;
    if (m !== null && (m - a + N) % N > len) { const t = a; a = b; b = t; len = (b - a + N) % N; }
    if (len < 6 || len > N - 6) return; const v = e.t === 'tunnel' ? -1 : 1; for (let j = 0; j <= len; j++) L[(a + j) % N] = v;
    S.push({ t: v < 0 ? 'tunnel' : 'bridge', i0: a, len, k });
  });
  if (S.length) tr.layerAt = L; return S;
}
function secIdx(tr, s, step) { const r = []; for (let k = 0; k < s.len; k += step) r.push((s.i0 + k) % tr.n); r.push((s.i0 + s.len) % tr.n); return r; }
function secPts(tr, s, off, step) { return secIdx(tr, s, step || 2).map(i => { const p = tr.pts[i], a = tr.dirs[i]; return [p[0] - Math.sin(a) * off, p[1] + Math.cos(a) * off]; }); }
function secPath(g, tr, s, off, step) { g.beginPath(); secPts(tr, s, off, step).forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); }
function railSegs(tr) {
  const R = []; for (const s of tr.elev || []) { const L = s.t === 'tunnel' ? -1 : 1, off = tr.w / 2 + (L > 0 ? 14 : 10);
    for (const sd of [-1, 1]) { const P = secPts(tr, s, off * sd, 3); for (let i = 1; i < P.length; i++) { const [ax, ay] = P[i - 1], [bx, by] = P[i]; if (Math.hypot(bx - ax, by - ay) < 1) continue; R.push({ L, ax, ay, bx, by, x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by) }); } } }
  return R;
}
function carLayer(tr, c) { if (!tr || !tr.layerAt) return 0; const r = nearest(tr, c.x, c.y, c._lh != null ? c._lh : (c.hint || 0)); c._lh = r.i; return tr.layerAt[r.i]; }
function drawTunnelFloor(g, tr) {
  const S = (tr.elev || []).filter(s => s.t === 'tunnel'); if (!S.length) return; g.save(); g.lineJoin = 'round'; g.lineCap = 'butt';
  for (const s of S) { secPath(g, tr, s, 0); g.strokeStyle = '#5a5d64'; g.lineWidth = tr.w + 30; g.stroke(); g.strokeStyle = '#1f2025'; g.lineWidth = tr.w; g.stroke();
    g.setLineDash([40, 50]); g.strokeStyle = 'rgba(255,220,150,.3)'; g.lineWidth = 4; g.stroke(); g.setLineDash([]);
    for (const sd of [-1, 1]) secPts(tr, s, (tr.w / 2 + 7) * sd, 14).forEach(p => { g.fillStyle = 'rgba(255,196,110,.16)'; g.beginPath(); g.arc(p[0], p[1], 30, 0, 7); g.fill(); g.fillStyle = '#ffd88a'; g.beginPath(); g.arc(p[0], p[1], 5, 0, 7); g.fill(); }); }
  g.restore();
}
function drawTunnelRoof(g, tr, alpha) {
  const S = (tr.elev || []).filter(s => s.t === 'tunnel'); if (!S.length || alpha <= 0.02) return; g.save(); g.lineJoin = 'round'; g.lineCap = 'butt'; g.globalAlpha = Math.min(1, alpha);
  for (const s of S) { secPath(g, tr, s, 0); g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = tr.w + 52; g.stroke(); g.strokeStyle = tr.th.grass2 || tr.th.grass; g.lineWidth = tr.w + 44; g.stroke();
    g.strokeStyle = 'rgba(0,0,0,.08)'; g.lineWidth = tr.w * 0.5; g.stroke();
    for (const i of [s.i0, (s.i0 + s.len) % tr.n]) { const p = tr.pts[i], a = tr.dirs[i]; g.save(); g.translate(p[0], p[1]); g.rotate(a); g.fillStyle = '#2c2d33'; g.fillRect(-9, -tr.w / 2 - 26, 18, tr.w + 52); g.fillStyle = '#8b8f97'; g.fillRect(-4, -tr.w / 2 - 26, 8, tr.w + 52); g.restore(); } }
  g.restore();
}
function drawBridges(g, tr) {
  const S = (tr.elev || []).filter(s => s.t === 'bridge'); if (!S.length) return; g.save(); g.lineJoin = 'round'; g.lineCap = 'butt';
  for (const s of S) {
    g.save(); g.translate(18, 20); secPath(g, tr, s, 0); g.strokeStyle = 'rgba(0,0,0,.32)'; g.lineWidth = tr.w + 36; g.stroke(); g.restore();
    secPath(g, tr, s, 0); g.strokeStyle = '#9aa0a8'; g.lineWidth = tr.w + 32; g.stroke(); g.strokeStyle = tr.th.road || '#3a3c42'; g.lineWidth = tr.w; g.stroke();
    g.setLineDash([40, 50]); g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 4; g.stroke(); g.setLineDash([]);
    for (const sd of [-1, 1]) { secPath(g, tr, s, (tr.w / 2 + 14) * sd); g.strokeStyle = '#e6e9ee'; g.lineWidth = 6; g.stroke(); g.setLineDash([5, 28]); g.strokeStyle = '#4a4d55'; g.lineWidth = 10; g.stroke(); g.setLineDash([]); }
  }
  g.restore();
}
function drawElevAll(g, tr, roofA) { drawTunnelFloor(g, tr); drawTunnelRoof(g, tr, roofA); drawBridges(g, tr); }

// ---------- lap replays (ghosts): one sample every 100 ms of [x, y, angle], delta-encoded ----------
function encRep(L) { if (!L || L.length < 5) return null; let px = 0, py = 0, pa = 0; const o = []; for (const [x, y, a] of L) { o.push(x - px, y - py, a - pa); px = x; py = y; pa = a; } return 'R1:' + o.join(','); }
function decRep(s) { if (typeof s !== 'string' || !s.startsWith('R1:')) return null; const v = s.slice(3).split(',').map(Number), L = []; let x = 0, y = 0, a = 0; for (let i = 0; i + 2 < v.length; i += 3) { if (!isFinite(v[i]) || !isFinite(v[i + 1]) || !isFinite(v[i + 2])) return null; x += v[i]; y += v[i + 1]; a += v[i + 2]; L.push([x, y, a / 100]); } return L.length > 4 ? L : null; }
