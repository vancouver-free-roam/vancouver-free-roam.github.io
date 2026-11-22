// Your own street art: press I on foot facing a wall (spray paint) or open ground (sidewalk chalk).
// A paint screen opens: draw with the mouse (spray can or marker), stamp stencils, write a bubble-letter tag, pick colours,
// undo/clear, choose the size, then "Spray it!". The piece becomes a decal on the wall / ground.
// Pieces are saved in this browser (localStorage 'vfr-paint-v1', max 30, oldest goes first) and come back next time.
// Surprises: people stop to admire it (or a bylaw officer yells), rain slowly fades spray paint (chalk washes out faster),
// and sometimes when you come back, a local artist has added a little "reply" doodle. 10 pieces = secret "Banksy of Vancouver".
import * as THREE from 'three';
import { G, scene, R, pick, tapped, lockMouse, depthBias } from './core.js';
import { walkY, nearBuildings, nearestRoad } from './city.js';
import { isWater } from './terrain.js';
import { peds, say } from './people.js';
import { ui } from './ui.js';
import { sfx, noise } from './sound.js';

const KEY = 'vfr-paint-v1', MAX = 30, SZ = 256;
let discover = () => {}, player = null;
const pieces = [];   // {x, y, z, nx, nz, yaw, ground, w, img, fade, t, reply, mesh, tex, cv}
let meta = { count: 0 };

// ---------- saving ----------
function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ meta, pieces: pieces.map(p => ({ x: p.x, y: p.y, z: p.z, nx: p.nx, nz: p.nz, yaw: p.yaw, ground: p.ground, w: p.w, img: small(p.cv), fade: Math.round(p.fade * 1000) / 1000, t: p.t, reply: p.reply })) })); }
  catch (e) { /* storage full or blocked: pieces still show this session */ }
}
// saved at 128 px (about 4x smaller) so 30 pieces fit easily next to the game save
const _sm = document.createElement('canvas'); _sm.width = _sm.height = 128;
function small(cv) { const c = _sm.getContext('2d'); c.clearRect(0, 0, 128, 128); c.drawImage(cv, 0, 0, 128, 128); return _sm.toDataURL('image/png'); }
function load() {
  let d = null; try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { d = null; }
  if (!d) return; meta = d.meta || meta;
  for (const p of d.pieces || []) { const img = new Image(); img.onload = () => { const cv = document.createElement('canvas'); cv.width = cv.height = SZ; cv.getContext('2d').drawImage(img, 0, 0, SZ, SZ); addPiece({ ...p, cv }, false); }; img.src = p.img; }
}

// ---------- the decal ----------
function addPiece(p, fresh = true) {
  const tex = new THREE.CanvasTexture(p.cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.04, depthWrite: false, roughness: p.ground ? 0.95 : 0.85 }); depthBias(mat, 0.0006);
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.w), mat); plane.receiveShadow = true; plane.renderOrder = 2;
  const g = new THREE.Group(); g.add(plane);
  if (p.ground) { plane.rotation.x = -Math.PI / 2; g.position.set(p.x, p.y + 0.03, p.z); g.rotation.y = p.yaw; }
  else { g.position.set(p.x + p.nx * 0.18, p.y, p.z + p.nz * 0.18); g.rotation.y = Math.atan2(p.nx, p.nz); }
  scene.add(g); p.mesh = g; p.mat = mat; p.tex = tex; p.fade = p.fade || 0; p.t = p.t ?? G.t; p.seen = G.t;
  pieces.push(p); applyFade(p);
  while (pieces.length > MAX) { const o = pieces.shift(); scene.remove(o.mesh); o.mat.dispose(); o.tex.dispose(); }
  if (fresh) save();
}
const applyFade = p => { p.mat.opacity = 1 - Math.min(0.78, p.fade); };

// where you're aiming: the nearest wall in front of you (within 3.5 m), else the ground just ahead
function target(pl) {
  const fx = -Math.sin(pl.yaw), fz = -Math.cos(pl.yaw); let best = null, bt = 3.5;
  for (const b of nearBuildings(pl.x, pl.z, 8)) {
    if (b.raised && pl.y < b.base - 2.4) continue; const P = b.p, n = P.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = P[i * 2], az = P[i * 2 + 1], ex = P[j * 2] - ax, ez = P[j * 2 + 1] - az, den = fx * ez - fz * ex; if (Math.abs(den) < 1e-6) continue;
      const t = ((ax - pl.x) * ez - (az - pl.z) * ex) / den, u = ((ax - pl.x) * fz - (az - pl.z) * fx) / den;
      if (t > 0.1 && t < bt && u >= 0 && u <= 1) { const L = Math.hypot(ex, ez); let nx = -ez / L, nz = ex / L; if (nx * fx + nz * fz > 0) { nx = -nx; nz = -nz; } bt = t; best = { x: pl.x + fx * t, z: pl.z + fz * t, nx, nz, top: b.top, L, wall: true }; }
    }
  }
  if (best) return best;
  const x = pl.x + fx * 2, z = pl.z + fz * 2; if (isWater(x, z)) return null;
  return { x, z, ground: true, yaw: pl.yaw };
}

// ---------- the paint screen ----------
const COLS = ['#ff2d55', '#ff9500', '#ffe600', '#34c759', '#00c7be', '#2f80ff', '#af52de', '#ff5ec4', '#ffffff', '#111111', '#8e5a2b', '#c0c0c0'];
const STAMPS = { '❤️': heart, '⭐': star, '👑': crown, '🙂': smile, '🍁': leaf, '🦝': raccoon, '⛰️': mountains, '🐋': orca };
let ov = null, cv = null, ctx = null, st = null;
function css() {
  const s = document.createElement('style'); s.textContent = `
  #paintov{position:fixed;inset:0;background:rgba(8,12,18,.72);display:flex;align-items:center;justify-content:center;z-index:60;font-family:Segoe UI,Arial,sans-serif;color:#fff}
  #paintov .box{background:#1b2330;border-radius:14px;padding:14px 16px;display:flex;gap:14px;box-shadow:0 10px 40px #000a;max-width:96vw;flex-wrap:wrap}
  #paintov canvas{width:384px;height:384px;border-radius:8px;cursor:crosshair;touch-action:none;background:var(--bg)}
  #paintov .side{width:250px;display:flex;flex-direction:column;gap:8px;font-size:13px}
  #paintov h3{margin:0 0 2px;font-size:18px} #paintov .row{display:flex;flex-wrap:wrap;gap:5px;align-items:center}
  #paintov .sw{width:24px;height:24px;border-radius:50%;border:2px solid #fff3;cursor:pointer} #paintov .sw.on{border-color:#fff;transform:scale(1.15)}
  #paintov button{background:#2f3b4d;color:#fff;border:0;border-radius:7px;padding:6px 9px;cursor:pointer;font-size:13px} #paintov button.on{background:#2f80ff}
  #paintov button.go{background:#34c759;font-weight:bold;font-size:15px;padding:9px} #paintov input[type=text]{width:120px;padding:5px;border-radius:6px;border:0}
  #paintov small{opacity:.7}`; document.head.appendChild(s);
}
function openPaint(pl) {
  const tg = target(pl); if (!tg) { ui.toast('🎨 Nowhere to paint', 'Face a wall (spray paint) or stand on solid ground (chalk).', 2000); return; }
  if (!ov) build();
  st = { tg, color: tg.ground ? '#ffffff' : '#ff2d55', size: 10, tool: tg.ground ? 'marker' : 'spray', undo: [], w: tg.ground ? 2.2 : Math.min(3, Math.max(1, (tg.L || 3) - 0.4)), drawing: false };
  ctx.clearRect(0, 0, SZ, SZ); refresh();
  ov.style.setProperty('--bg', tg.ground ? '#77736b' : '#9a8f84'); ov.querySelector('h3').textContent = tg.ground ? '🖍️ Sidewalk chalk' : '🎨 Spray paint';
  ov.style.display = 'flex'; G.dialogOpen = true; document.exitPointerLock?.();
}
function closePaint() { ov.style.display = 'none'; G.dialogOpen = false; lockMouse(); }
function refresh() {
  ov.querySelectorAll('.sw').forEach(b => b.classList.toggle('on', b.dataset.c === st.color));
  ov.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === st.tool));
  ov.querySelector('#pszv').textContent = st.w.toFixed(1) + ' m'; ov.querySelector('#psz').value = st.w;
  ov.querySelector('#pcount').textContent = `Your pieces: ${pieces.length}/${MAX} (the oldest is painted over when full)`;
}
function build() {
  css(); ov = document.createElement('div'); ov.id = 'paintov'; ov.style.display = 'none';
  ov.innerHTML = `<div class="box"><canvas width="${SZ}" height="${SZ}"></canvas><div class="side"><h3></h3>
    <small>Draw with the mouse. Make your mark on Vancouver!</small>
    <div class="row">${COLS.map(c => `<div class="sw" data-c="${c}" style="background:${c}"></div>`).join('')}<input type="color" id="pcol" value="#ff2d55" style="width:30px;height:26px;border:0;background:none"></div>
    <div class="row"><button data-tool="spray">💨 Spray</button><button data-tool="marker">🖊️ Marker</button><button data-tool="drip">💧 Drippy</button><button data-tool="erase">🧽 Erase</button></div>
    <div class="row">Brush <input type="range" id="pbr" min="3" max="40" value="10" style="width:150px"></div>
    <div class="row">${Object.keys(STAMPS).map(k => `<button data-st="${k}">${k}</button>`).join('')}</div>
    <div class="row"><input type="text" id="ptag" maxlength="10" placeholder="Your tag"><button id="ptagb">✍️ Tag it</button></div>
    <div class="row">Size on the wall <input type="range" id="psz" min="0.8" max="4" step="0.1" style="width:90px"> <b id="pszv"></b></div>
    <div class="row"><button id="pundo">↩️ Undo</button><button id="pclear">🗑️ Clear</button><button id="prand">🎲 Surprise me</button></div>
    <small id="pcount"></small>
    <div class="row"><button class="go" id="pgo">🎨 Spray it!</button><button id="pcancel">Cancel</button></div></div></div>`;
  document.body.appendChild(ov); cv = ov.querySelector('canvas'); ctx = cv.getContext('2d');
  const snap = () => { st.undo.push(ctx.getImageData(0, 0, SZ, SZ)); if (st.undo.length > 25) st.undo.shift(); };
  ov.querySelectorAll('.sw').forEach(b => b.onclick = () => { st.color = b.dataset.c; if (st.tool === 'erase') st.tool = 'spray'; refresh(); });
  ov.querySelector('#pcol').oninput = e => { st.color = e.target.value; refresh(); };
  ov.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => { st.tool = b.dataset.tool; refresh(); });
  ov.querySelector('#pbr').oninput = e => { st.size = +e.target.value; };
  ov.querySelector('#psz').oninput = e => { st.w = +e.target.value; refresh(); };
  ov.querySelectorAll('[data-st]').forEach(b => b.onclick = () => { snap(); STAMPS[b.dataset.st](ctx, R(60, 196), R(60, 196), R(40, 70), st.color); sfx.swing?.(); });
  ov.querySelector('#ptagb').onclick = () => { const t = ov.querySelector('#ptag').value.trim(); if (!t) return; snap(); tag(ctx, t, st.color); noise(0.4, 0.03, 3000); };
  ov.querySelector('#pundo').onclick = () => { const d = st.undo.pop(); if (d) ctx.putImageData(d, 0, 0); };
  ov.querySelector('#pclear').onclick = () => { snap(); ctx.clearRect(0, 0, SZ, SZ); };
  ov.querySelector('#prand').onclick = () => { snap(); const c = pick(COLS.slice(0, 8)); pick(Object.values(STAMPS))(ctx, 128, 110, 80, c); tag(ctx, pick(['VAN', 'EH', 'RAIN', '604', 'YVR', 'ORCA', 'MOSS']), pick(COLS.slice(0, 8)), 200); };
  ov.querySelector('#pcancel').onclick = closePaint;
  ov.querySelector('#pgo').onclick = place;
  ov.addEventListener('keydown', e => { if (e.code === 'Escape') closePaint(); e.stopPropagation(); });
  let last = null;
  const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * SZ, (e.clientY - r.top) / r.height * SZ]; };
  cv.onpointerdown = e => { snap(); st.drawing = true; last = pos(e); stroke(last, last); cv.setPointerCapture(e.pointerId); if (st.tool === 'spray' || st.tool === 'drip') noise(0.25, 0.02, 3500); };
  cv.onpointermove = e => { if (!st.drawing) return; const p = pos(e); stroke(last, p); last = p; };
  cv.onpointerup = () => { st.drawing = false; if (st.tool === 'drip') drips(); };
}
function stroke(a, b) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 2)), s = st.size;
  ctx.globalCompositeOperation = st.tool === 'erase' ? 'destination-out' : 'source-over';
  for (let i = 0; i <= n; i++) {
    const x = a[0] + (b[0] - a[0]) * i / n, y = a[1] + (b[1] - a[1]) * i / n;
    if (st.tool === 'spray' || st.tool === 'drip') { ctx.fillStyle = st.color; for (let k = 0; k < s * 0.9; k++) { const r = s * Math.sqrt(Math.random()) * 0.9, an = Math.random() * 6.28; ctx.globalAlpha = 0.35; ctx.fillRect(x + Math.cos(an) * r, y + Math.sin(an) * r, 1.4, 1.4); } ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(x, y, s * 0.45, 0, 6.29); ctx.fill(); }
    else { ctx.fillStyle = st.color; ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(x, y, s / 2, 0, 6.29); ctx.fill(); }
    if (st.tool === 'drip' && Math.random() < 0.08) st.dripPts = [...(st.dripPts || []), [x, y]];
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}
function drips() { ctx.fillStyle = st.color; for (const [x, y] of st.dripPts || []) { const L = R(10, 45); ctx.fillRect(x - 1.2, y, 2.4, L); ctx.beginPath(); ctx.arc(x, y + L, 2.6, 0, 6.29); ctx.fill(); } st.dripPts = []; }
function place() {
  const pl = player, tg = st.tg;
  // a nearly empty canvas? don't place it
  const d = ctx.getImageData(0, 0, SZ, SZ).data; let n = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > 20) n++;
  if (n < 30) { ui.toast('🎨 Empty canvas', 'Draw something first (or press 🎲 Surprise me).', 1800); return; }
  const c2 = document.createElement('canvas'); c2.width = c2.height = SZ; c2.getContext('2d').drawImage(cv, 0, 0);
  let y;
  if (tg.ground) y = walkY(tg.x, tg.z, pl.y + 1);
  else { const gy = walkY(tg.x + tg.nx * 0.6, tg.z + tg.nz * 0.6, pl.y + 1); y = Math.max(gy + st.w / 2 + 0.15, Math.min(pl.y + 1.45, tg.top - st.w / 2 - 0.1)); }
  addPiece({ x: tg.x, y, z: tg.z, nx: tg.nx || 0, nz: tg.nz || 0, yaw: tg.yaw || 0, ground: !!tg.ground, w: st.w, cv: c2, fade: 0, t: G.t, reply: false });
  closePaint(); meta.count++; save(); react(tg);
  if (meta.count >= 10) discover('banksy');
}
// what people think of it
function react(tg) {
  const pl = player, lane = nearestRoad(tg.x, tg.z, 9, r => r.t === 6 && !(r.n >= 0)), main = nearestRoad(tg.x, tg.z, 20, r => r.t <= 4);
  noise(0.6, 0.04, 3200);
  let msg;
  if (tg.ground) { pl.karma += 1; msg = 'Sidewalk chalk: totally legal, totally adorable. The rain will wash it away eventually. (+1 karma)'; }
  else if (lane) { pl.karma += 1; msg = 'Back-lane art! The neighbours actually like it. (+1 karma)'; }
  else if (main && Math.random() < 0.6) {
    pl.karma -= 1; msg = 'Painting a building on a main street… a bylaw officer saw that. (-1 karma)';
    const p = peds.find(q => Math.hypot(q.x - pl.x, q.z - pl.z) < 30); if (p) say(p, pick(['HEY! That\'s a $500 fine! …okay, it\'s actually pretty good.', 'Bylaw! Stop right there! …Is that a raccoon? Cute.', 'I\'m calling 311! …after I take a photo.']), 3200);
  } else msg = pick(['Fresh paint! Vancouver has a new piece of street art.', 'Nice! You left your mark on the city.']);
  ui.toast(tg.ground ? '🖍️ Chalk art!' : '🎨 You made street art!', msg + ` (${meta.count} piece${meta.count === 1 ? '' : 's'} so far)`, 4000);
  let k = 0; for (const p of peds) { if (k > 2 || Math.hypot(p.x - pl.x, p.z - pl.z) > 22 || Math.random() < 0.4) continue; k++; p.state = 'talk'; p.timer = 3; say(p, pick(['Ooh, art!', 'Is that a Banksy?!', 'My kid could do that. …My kid is very talented.', 'Love it! Very Mount Pleasant.', 'Put it on Instagram!', '10/10, no notes.', 'Is that… me?']), 2800); }
}
// a local "replies" to your piece while you're away: a small doodle next to it
function reply(p) {
  const c = p.cv.getContext('2d'), col = pick(['#ffe600', '#00c7be', '#ff9500', '#ffffff', '#af52de']), x = R(30, 70), y = R(190, 230);
  pick([heart, star, crown, smile])(c, x, y, 26, col); c.fillStyle = col; c.font = 'bold 16px "Comic Sans MS", Arial'; c.fillText(pick(['nice!', '+1', 'lol', 'yes', '♥ u']), x + 18, y + 8);
  p.tex.needsUpdate = true; p.reply = true; save();
  ui.toast('✍️ Someone replied to your art!', 'A local artist added a little doodle next to your piece. That\'s street-art friendship.', 3500);
}

// ---------- stencils ----------
function heart(c, x, y, s, col) { c.fillStyle = col; c.strokeStyle = '#111'; c.lineWidth = 3; c.beginPath(); c.moveTo(x, y + s * 0.45); c.bezierCurveTo(x - s * 1.1, y - s * 0.2, x - s * 0.4, y - s * 0.9, x, y - s * 0.3); c.bezierCurveTo(x + s * 0.4, y - s * 0.9, x + s * 1.1, y - s * 0.2, x, y + s * 0.45); c.fill(); c.stroke(); }
function star(c, x, y, s, col) { c.fillStyle = col; c.strokeStyle = '#111'; c.lineWidth = 3; c.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? s * 0.4 : s * 0.9, a = i / 10 * 6.283 - Math.PI / 2; c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } c.closePath(); c.fill(); c.stroke(); }
function crown(c, x, y, s, col) { c.fillStyle = col; c.strokeStyle = '#111'; c.lineWidth = 3; c.beginPath(); c.moveTo(x - s, y + s * 0.4); c.lineTo(x - s, y - s * 0.4); c.lineTo(x - s * 0.5, y); c.lineTo(x, y - s * 0.6); c.lineTo(x + s * 0.5, y); c.lineTo(x + s, y - s * 0.4); c.lineTo(x + s, y + s * 0.4); c.closePath(); c.fill(); c.stroke(); }
function smile(c, x, y, s, col) { c.fillStyle = col; c.strokeStyle = '#111'; c.lineWidth = 4; c.beginPath(); c.arc(x, y, s * 0.8, 0, 6.29); c.fill(); c.stroke(); c.fillStyle = '#111'; c.fillRect(x - s * 0.35, y - s * 0.35, s * 0.15, s * 0.3); c.fillRect(x + s * 0.2, y - s * 0.35, s * 0.15, s * 0.3); c.beginPath(); c.arc(x, y + s * 0.05, s * 0.45, 0.3, 2.84); c.stroke(); }
function leaf(c, x, y, s, col) { c.fillStyle = col; c.beginPath(); const P = [[0, -1], [0.18, -0.6], [0.45, -0.75], [0.38, -0.3], [0.85, -0.42], [0.62, -0.05], [0.8, 0.12], [0.35, 0.2], [0.42, 0.45], [0.05, 0.3], [0.05, 0.75], [-0.05, 0.75], [-0.05, 0.3], [-0.42, 0.45], [-0.35, 0.2], [-0.8, 0.12], [-0.62, -0.05], [-0.85, -0.42], [-0.38, -0.3], [-0.45, -0.75], [-0.18, -0.6]]; P.forEach(([a, b]) => c.lineTo(x + a * s, y + b * s)); c.closePath(); c.fill(); }
function raccoon(c, x, y, s, col) { c.fillStyle = '#8d9096'; c.beginPath(); c.ellipse(x, y, s * 0.8, s * 0.65, 0, 0, 6.29); c.fill(); for (const d of [-1, 1]) { c.beginPath(); c.moveTo(x + d * s * 0.45, y - s * 0.45); c.lineTo(x + d * s * 0.7, y - s * 0.95); c.lineTo(x + d * s * 0.8, y - s * 0.35); c.fill(); } c.fillStyle = '#1b1b1f'; c.beginPath(); c.ellipse(x, y - s * 0.08, s * 0.72, s * 0.2, 0, 0, 6.29); c.fill(); c.fillStyle = '#fff'; for (const d of [-1, 1]) { c.beginPath(); c.arc(x + d * s * 0.3, y - s * 0.08, s * 0.11, 0, 6.29); c.fill(); } c.fillStyle = '#111'; c.beginPath(); c.arc(x, y + s * 0.28, s * 0.1, 0, 6.29); c.fill(); c.fillStyle = col; c.fillRect(x - s * 0.8, y + s * 0.7, s * 1.6, s * 0.12); }
function mountains(c, x, y, s, col) { c.fillStyle = col; c.beginPath(); c.moveTo(x - s * 1.3, y + s * 0.5); c.lineTo(x - s * 0.5, y - s * 0.6); c.lineTo(x - s * 0.1, y - s * 0.1); c.lineTo(x + s * 0.4, y - s * 0.75); c.lineTo(x + s * 1.3, y + s * 0.5); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.moveTo(x + s * 0.4, y - s * 0.75); c.lineTo(x + s * 0.2, y - s * 0.45); c.lineTo(x + s * 0.6, y - s * 0.45); c.fill(); }
function orca(c, x, y, s, col) { c.fillStyle = '#111'; c.beginPath(); c.ellipse(x, y, s, s * 0.35, -0.15, 0, 6.29); c.fill(); c.beginPath(); c.moveTo(x - s * 0.1, y - s * 0.3); c.lineTo(x + s * 0.05, y - s * 1.0); c.lineTo(x + s * 0.3, y - s * 0.3); c.fill(); c.fillStyle = '#fff'; c.beginPath(); c.ellipse(x - s * 0.55, y - s * 0.08, s * 0.16, s * 0.07, -0.2, 0, 6.29); c.fill(); c.beginPath(); c.ellipse(x - s * 0.2, y + s * 0.18, s * 0.45, s * 0.1, 0, 0, 6.29); c.fill(); c.strokeStyle = col; c.lineWidth = 4; c.beginPath(); for (let i = 0; i < 8; i++) c.lineTo(x - s * 1.2 + i * s * 0.35, y + s * 0.6 + Math.sin(i * 1.6) * 6); c.stroke(); }
function tag(c, text, col, yy = 128) {
  let fs = 80; c.font = `900 ${fs}px "Arial Black", Impact, sans-serif`; while (c.measureText(text).width > 230 && fs > 20) { fs -= 4; c.font = `900 ${fs}px "Arial Black", Impact, sans-serif`; }
  c.save(); c.translate(128, yy); c.transform(1, -0.08, -0.25, 1, 0, 0); c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
  c.lineWidth = 16; c.strokeStyle = '#111'; c.strokeText(text, 0, 0); c.lineWidth = 7; c.strokeStyle = '#fff'; c.strokeText(text, 0, 0);
  const g = c.createLinearGradient(0, -fs / 2, 0, fs / 2); g.addColorStop(0, col); g.addColorStop(1, '#111'); c.fillStyle = col; c.fillText(text, 0, 0); c.globalAlpha = 0.35; c.fillStyle = g; c.fillText(text, 0, 0); c.restore();
}

// ---------- per frame ----------
let admireT = 10, saveT = 15, dirty = false;
export function initPaint(pl, disc) { player = pl; if (disc) discover = disc; load(); }
export function updatePaint(dt, pl) {
  if (!pl.char || G.dialogOpen) return;
  if (tapped('KeyI') && !pl.vehicle && !pl.transit && !pl.flying && !pl.swimming) openPaint(pl);
  // rain fades the paint (chalk much faster); people walking past admire your pieces; sometimes a local replies
  admireT -= dt; saveT -= dt;
  for (const p of pieces) {
    const d = Math.hypot(p.x - pl.x, p.z - pl.z); p.mesh.visible = d < 450;
    if (G.wet > 0.35) { p.fade += dt * G.wet * (p.ground ? 0.004 : 0.00035); applyFade(p); dirty = true; }
    if (d > 300) p.away = true;
    else if (p.away && d < 40) { p.away = false; if (!p.reply && G.t - p.t > 300 && Math.random() < 0.18) reply(p); }
    if (admireT < 0 && d < 60) for (const q of peds) if (Math.hypot(q.x - p.x, q.z - p.z) < 5 && q.state === 'walk' && Math.random() < 0.5) { admireT = R(15, 30); q.state = 'talk'; q.timer = 2.5; say(q, pick(['Who painted this? It\'s great!', 'Ooh, new street art!', 'This wasn\'t here last week.', 'I\'d buy this as a print.', 'The city should keep this one.']), 2600); break; }
  }
  if (admireT < 0) admireT = 3;
  if (saveT < 0) { saveT = 20; if (dirty) { dirty = false; save(); } }
}
export const _paint = { pieces, target, openPaint, closePaint, place, get st() { return st; }, get ctx() { return ctx; }, tag, STAMPS, meta: () => meta, reply };
