// Interface: messages, dialog, minimap, phone (missions / map / secrets / help).
import { G, clamp } from './core.js';
import { CITY, maskAt, heightAt, DEM_RECT, DEM2_RECT, DEM3_RECT, lakes } from './terrain.js';
let farMap = null; const FM = 400;

const $ = id => document.getElementById(id);
export const ui = {};
let toastT = 0;
ui.toast = (msg, sub = '', ms = 2200) => { const t = $('toast'); t.innerHTML = msg + (sub ? `<small>${sub}</small>` : ''); t.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(() => t.style.opacity = 0, ms); };
ui.prompt = html => { const p = $('prompt'); if (!html) p.classList.add('hidden'); else { p.innerHTML = html; p.classList.remove('hidden'); } };
ui.objective = html => { const o = $('objective'); if (!html) o.classList.add('hidden'); else { o.innerHTML = html; o.classList.remove('hidden'); } };

// dialog with choices; returns a promise of the chosen index
ui.dialog = (name, text, choices = ['OK']) => new Promise(res => {
  $('dname').textContent = name; $('dtext').innerHTML = text; const b = $('dbtns'); b.innerHTML = '';
  G.dialogOpen = true; document.exitPointerLock?.();
  choices.forEach((c, i) => { const btn = document.createElement('button'); btn.textContent = c; if (i > 0) btn.className = 'alt'; btn.onclick = () => { $('dialog').classList.add('hidden'); G.dialogOpen = false; res(i); }; b.appendChild(btn); });
  $('dialog').classList.remove('hidden');
});

// ---------- maps ----------
let cityMap, regionMap, corridorMap, regionBase, corridorBase;
import { roadGrid } from './city.js';
const CM = 3, RM = 12, KM = 40;   // metres per pixel
export function buildMaps() {
  const M = window.MAP;
  // city detail map
  const w = Math.round((CITY.x1 - CITY.x0) / CM), h = Math.round((CITY.z1 - CITY.z0) / CM);
  cityMap = document.createElement('canvas'); cityMap.width = w; cityMap.height = h; const g = cityMap.getContext('2d');
  const img = g.createImageData(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const m = maskAt(CITY.x0 + i * CM, CITY.z0 + j * CM), k = (j * w + i) * 4; if (m === 0) { img.data[k] = 82; img.data[k + 1] = 150; img.data[k + 2] = 196; } else { img.data[k] = 232; img.data[k + 1] = 229; img.data[k + 2] = 222; } img.data[k + 3] = 255; }
  g.putImageData(img, 0, 0);
  const P = (x, z) => [(x - CITY.x0) / CM, (z - CITY.z0) / CM];
  const poly = (p, close) => { g.beginPath(); for (let i = 0; i < p.length; i += 2) { const [X, Z] = P(p[i], p[i + 1]); i ? g.lineTo(X, Z) : g.moveTo(X, Z); } if (close) g.closePath(); };
  for (const a of M.areas) { if (a.line || a.k === 'water') continue; const c = { park: '#b5d99c', wood: '#8fc27a', grass: '#c3dfa8', golf: '#b5d99c', pitch: '#a6d68c', cemetery: '#b9d4a3', beach: '#f2e5b5', playground: '#e3d1a5' }[a.k]; if (!c) continue; poly(a.p, true); g.fillStyle = c; g.fill(); }
  g.fillStyle = '#d2cdc3'; for (const b of M.blds) { poly(b.p, true); g.fill(); }
  const NX = i => M.nodes[i * 2], NZ = i => M.nodes[i * 2 + 1];
  const drawRoads = (filter, color, width) => { g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round'; g.lineJoin = 'round'; for (const r of M.roads) { if (!filter(r)) continue; g.beginPath(); r.p.forEach((n, i) => { const [X, Z] = P(NX(n), NZ(n)); i ? g.lineTo(X, Z) : g.moveTo(X, Z); }); g.stroke(); } };
  drawRoads(r => r.t === 7 || r.t === 8, '#c8b89a', 1);
  drawRoads(r => r.t >= 5 && r.t <= 6, '#ffffff', 3);
  drawRoads(r => r.t >= 3 && r.t <= 4, '#ffffff', 4.5);
  drawRoads(r => r.t <= 2, '#f6d860', 5.5);
  // region map (mountains)
  const rw = Math.round((DEM_RECT.x1 - DEM_RECT.x0) / RM), rh = Math.round((DEM_RECT.z1 - DEM_RECT.z0) / RM);
  regionMap = document.createElement('canvas'); regionMap.width = rw; regionMap.height = rh; const rg = regionMap.getContext('2d'), ri = rg.createImageData(rw, rh);
  for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) {
    const x = DEM_RECT.x0 + i * RM, z = DEM_RECT.z0 + j * RM, hh = heightAt(x, z), k = (j * rw + i) * 4;
    const shade = clamp(1 + (heightAt(x - RM, z - RM) - hh) * 0.02, 0.6, 1.4);
    let c = hh < -0.5 ? [82, 150, 196] : hh > 1000 ? [245, 247, 250] : hh > 300 ? [120, 160, 110] : [190, 205, 170];
    if (hh >= -0.5) c = c.map(v => clamp(v * shade, 0, 255));
    ri.data[k] = c[0]; ri.data[k + 1] = c[1]; ri.data[k + 2] = c[2]; ri.data[k + 3] = 255;
  }
  rg.putImageData(ri, 0, 0);
  rg.drawImage(cityMap, (CITY.x0 - DEM_RECT.x0) / RM, (CITY.z0 - DEM_RECT.z0) / RM, (CITY.x1 - CITY.x0) / RM, (CITY.z1 - CITY.z0) / RM);
  rg.strokeStyle = '#7a7d82'; rg.lineCap = 'butt';
  for (const a of M.aero || []) { rg.lineWidth = Math.max(1, a.w / RM); rg.beginPath(); for (let i = 0; i < a.p.length; i += 2) { const X = (a.p[i] - DEM_RECT.x0) / RM, Z = (a.p[i + 1] - DEM_RECT.z0) / RM; i ? rg.lineTo(X, Z) : rg.moveTo(X, Z); } rg.stroke(); }
  // Sea-to-Sky corridor map (Horseshoe Bay -> Squamish -> Whistler)
  const kw = Math.round((DEM2_RECT.x1 - DEM2_RECT.x0) / KM), kh = Math.round((DEM2_RECT.z1 - DEM2_RECT.z0) / KM);
  corridorMap = document.createElement('canvas'); corridorMap.width = kw; corridorMap.height = kh; const kg = corridorMap.getContext('2d'), ki = kg.createImageData(kw, kh);
  for (let j = 0; j < kh; j++) for (let i = 0; i < kw; i++) {
    const x = DEM2_RECT.x0 + i * KM, z = DEM2_RECT.z0 + j * KM, hh = heightAt(x, z), k = (j * kw + i) * 4;
    const shade = clamp(1 + (heightAt(x - KM, z - KM) - hh) * 0.012, 0.6, 1.4);
    let c = hh < -0.5 ? [82, 150, 196] : hh > 1500 ? [245, 247, 250] : hh > 900 ? [205, 215, 205] : hh > 300 ? [120, 160, 110] : [175, 200, 150];
    if (hh >= -0.5) c = c.map(v => clamp(v * shade, 0, 255));
    ki.data[k] = c[0]; ki.data[k + 1] = c[1]; ki.data[k + 2] = c[2]; ki.data[k + 3] = 255;
  }
  kg.putImageData(ki, 0, 0);
  // the far world map (Vancouver Island, Gulf Islands, Fraser Valley, Mt Baker, Olympics)
  if (DEM3_RECT.x1 > DEM3_RECT.x0) {
    const fw = Math.round((DEM3_RECT.x1 - DEM3_RECT.x0) / FM), fh = Math.round((DEM3_RECT.z1 - DEM3_RECT.z0) / FM);
    farMap = document.createElement('canvas'); farMap.width = fw; farMap.height = fh; const fg = farMap.getContext('2d'), fi = fg.createImageData(fw, fh);
    for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) {
      const x = DEM3_RECT.x0 + i * FM, z = DEM3_RECT.z0 + j * FM, hh = heightAt(x, z), k = (j * fw + i) * 4;
      const shade = clamp(1 + (heightAt(x - FM, z - FM) - hh) * 0.006, 0.6, 1.4);
      let c = hh < -0.5 ? [82, 150, 196] : hh > 1900 ? [245, 247, 250] : hh > 1100 ? [205, 215, 205] : hh > 300 ? [120, 160, 110] : [175, 200, 150];
      if (hh >= -0.5) c = c.map(v => clamp(v * shade, 0, 255));
      fi.data[k] = c[0]; fi.data[k + 1] = c[1]; fi.data[k + 2] = c[2]; fi.data[k + 3] = 255;
    }
    fg.putImageData(fi, 0, 0);
    fg.font = 'bold 13px Segoe UI'; fg.textAlign = 'center'; fg.fillStyle = '#123'; fg.strokeStyle = 'rgba(255,255,255,0.8)'; fg.lineWidth = 3;
    for (const [n, la, lo] of [['Vancouver', 49.27, -123.10], ['Victoria', 48.43, -123.37], ['Nanaimo', 49.165, -123.94], ['Mt Baker', 48.777, -121.814], ['Whistler', 50.116, -122.957], ['Tofino', 49.153, -125.906], ['Courtenay', 49.69, -124.99], ['Abbotsford', 49.05, -122.31], ['Bellingham', 48.76, -122.48], ['Olympic Mts', 47.80, -123.71], ['Salt Spring', 48.80, -123.50], ['Sechelt', 49.47, -123.76], ['Squamish', 49.70, -123.15]]) {
      const x = (n === 'Vancouver' ? 1 : 1) * ((lo + 123.12) * 111320 * Math.cos(49.283 * Math.PI / 180) - DEM3_RECT.x0) / FM, z = (-(la - 49.283) * 110574 - DEM3_RECT.z0) / FM;
      fg.strokeText(n, x, z); fg.fillText(n, x, z);
    }
  }
  const NXr = i => M.nodes[i * 2], NZr = i => M.nodes[i * 2 + 1];
  for (const [cv, ctx, R0, mpp] of [[regionMap, rg, DEM_RECT, RM], [corridorMap, kg, DEM2_RECT, KM]]) {
    ctx.fillStyle = 'rgb(82,150,196)';
    for (const l of lakes) { ctx.beginPath(); for (let i = 0; i < l.p.length; i += 2) { const X = (l.p[i] - R0.x0) / mpp, Z = (l.p[i + 1] - R0.z0) / mpp; i ? ctx.lineTo(X, Z) : ctx.moveTo(X, Z); } ctx.fill(); }
    // keep a copy without roads for the minimap (roads are drawn sharp on top there)
    const base = document.createElement('canvas'); base.width = cv.width; base.height = cv.height; base.getContext('2d').drawImage(cv, 0, 0);
    if (cv === regionMap) regionBase = base; else corridorBase = base;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const r of M.roads) { if (!r.rg || r.t > 6) continue; ctx.strokeStyle = r.t <= 1 ? '#f6d860' : '#ffffff'; ctx.lineWidth = r.t <= 1 ? (mpp > 20 ? 2.5 : 3.5) : (mpp > 20 ? 1 : 2); ctx.beginPath(); r.p.forEach((n, i) => { const X = (NXr(n) - R0.x0) / mpp, Z = (NZr(n) - R0.z0) / mpp; i ? ctx.lineTo(X, Z) : ctx.moveTo(X, Z); }); ctx.stroke(); }
  }
}

// ---------- minimap ----------
const mm = () => $('minimap');
export function drawMinimap(pl, markers) {
  const c = mm(), g = c.getContext('2d'), W = c.width;
  const speed = pl.vehicle ? pl.vehicle.speedAbs : 0, flying = pl.flying;
  const range = flying ? 3000 : clamp(380 + speed * 14, 380, 1100), s = W / range;
  g.save(); g.fillStyle = '#5296c4'; g.fillRect(0, 0, W, W);
  g.translate(W / 2, W / 2); g.rotate(G.camYaw); g.translate(-W / 2, -W / 2);
  const inR = (R0, m = 0) => pl.x > R0.x0 + m && pl.x < R0.x1 - m && pl.z > R0.z0 + m && pl.z < R0.z1 - m;
  if (range < 1500 && inR(CITY)) g.drawImage(cityMap, (pl.x - CITY.x0) / CM - range / CM / 2, (pl.z - CITY.z0) / CM - range / CM / 2, range / CM, range / CM, 0, 0, W, W);
  else {
    const vec = range <= 1200;
    if (inR(DEM_RECT, 600)) g.drawImage(vec ? regionBase : regionMap, (pl.x - DEM_RECT.x0) / RM - range / RM / 2, (pl.z - DEM_RECT.z0) / RM - range / RM / 2, range / RM, range / RM, 0, 0, W, W);
    else if (inR(DEM2_RECT, 600) || !farMap) g.drawImage(vec ? corridorBase : corridorMap, (pl.x - DEM2_RECT.x0) / KM - range / KM / 2, (pl.z - DEM2_RECT.z0) / KM - range / KM / 2, range / KM, range / KM, 0, 0, W, W);
    else g.drawImage(farMap, (pl.x - DEM3_RECT.x0) / FM - range / FM / 2, (pl.z - DEM3_RECT.z0) / FM - range / FM / 2, range / FM, range / FM, 0, 0, W, W);
    const M = window.MAP; g.lineCap = 'round';
    if (vec) for (const e of roadGrid.near(pl.x, pl.z, range * 0.75, [])) {
      const r = M.roads[e.r]; if (r.t > 8) continue;
      g.strokeStyle = r.t <= 1 ? '#f6d860' : r.t <= 6 ? '#ffffff' : '#c8b89a'; g.lineWidth = Math.max(r.t <= 6 ? 2 : 1, r.w * s);
      g.beginPath(); g.moveTo((M.nodes[e.a * 2] - pl.x) * s + W / 2, (M.nodes[e.a * 2 + 1] - pl.z) * s + W / 2); g.lineTo((M.nodes[e.b * 2] - pl.x) * s + W / 2, (M.nodes[e.b * 2 + 1] - pl.z) * s + W / 2); g.stroke();
    }
  }
  for (const m of markers) {
    let x = (m.x - pl.x) * s, z = (m.z - pl.z) * s; const d = Math.hypot(x, z), max = W / 2 - 10;
    const rot = [x * Math.cos(G.camYaw) - z * Math.sin(G.camYaw), x * Math.sin(G.camYaw) + z * Math.cos(G.camYaw)];
    if (d > max) { if (!m.edge) continue; x *= max / d; z *= max / d; }
    g.save(); g.translate(W / 2 + x, W / 2 + z); g.rotate(-G.camYaw);
    g.fillStyle = m.color || '#ffd45c'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
    if (m.icon) { g.font = '15px Segoe UI Emoji'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(m.icon, 0, 0); }
    else { g.beginPath(); g.arc(0, 0, m.r || 5, 0, 7); g.fill(); g.stroke(); }
    g.restore();
  }
  g.restore();
  // player arrow (always points up = camera direction)
  g.save(); g.translate(W / 2, W / 2); g.rotate(-(pl.yaw - G.camYaw));
  g.fillStyle = '#e63946'; g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 4); g.lineTo(-6, 7); g.closePath(); g.fill(); g.stroke(); g.restore();
  // north marker
  g.save(); g.translate(W / 2, W / 2); g.rotate(G.camYaw); g.fillStyle = '#fff'; g.font = 'bold 13px Segoe UI'; g.textAlign = 'center'; g.fillText('N', 0, -W / 2 + 16); g.restore();
}

// ---------- big map (phone) ----------
// the map view that contains the player
export function mapViewFor(pl) { const inR = R0 => pl.x > R0.x0 && pl.x < R0.x1 && pl.z > R0.z0 && pl.z < R0.z1; return inR(DEM_RECT) ? 'van' : inR(DEM2_RECT) ? 's2s' : 'far'; }
// big, clear "you are here": pulsing ring, an arrow pointing the way you face, and a label
function youAreHere(g, X, Z, yaw) {
  const t = performance.now() / 600;
  g.save(); g.translate(X, Z);
  g.strokeStyle = 'rgba(230,57,70,0.55)'; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, 16 + (t % 1) * 14, 0, 7); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(0, 0, 13, 0, 7); g.fill();
  g.rotate(-yaw); g.fillStyle = '#e63946'; g.strokeStyle = '#fff'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(0, -15); g.lineTo(10, 11); g.lineTo(0, 5); g.lineTo(-10, 11); g.closePath(); g.fill(); g.stroke();
  g.restore();
  g.font = 'bold 15px Segoe UI'; g.textAlign = 'center'; g.lineWidth = 4; g.strokeStyle = '#fff'; g.strokeText('YOU', X, Z - 24); g.fillStyle = '#c1121f'; g.fillText('YOU', X, Z - 24);
}
export function drawBigMap(canvas, pl, markers, onPick, view = 'van') {
  if (view === 'me') return drawAroundMe(canvas, pl, markers, onPick);
  const g = canvas.getContext('2d'), RR = view === 'van' ? DEM_RECT : view === 'far' && farMap ? DEM3_RECT : DEM2_RECT, img = view === 'van' ? regionMap : view === 'far' && farMap ? farMap : corridorMap;
  canvas.height = Math.round(canvas.width * (RR.z1 - RR.z0) / (RR.x1 - RR.x0)); const W = canvas.width, H = canvas.height;
  g.drawImage(img, 0, 0, W, H);
  const sx = W / (RR.x1 - RR.x0), sz = H / (RR.z1 - RR.z0);
  const X = x => (x - RR.x0) * sx, Z = z => (z - RR.z0) * sz;
  for (const m of markers) { g.font = '14px Segoe UI Emoji'; g.textAlign = 'center'; g.textBaseline = 'middle'; if (m.icon) g.fillText(m.icon, X(m.x), Z(m.z)); else { g.fillStyle = m.color || '#ffd45c'; g.beginPath(); g.arc(X(m.x), Z(m.z), 4, 0, 7); g.fill(); } }
  youAreHere(g, X(pl.x), Z(pl.z), pl.yaw || 0);
  canvas.onclick = e => { const r = canvas.getBoundingClientRect(); const x = RR.x0 + (e.clientX - r.left) / r.width * (RR.x1 - RR.x0), z = RR.z0 + (e.clientY - r.top) / r.height * (RR.z1 - RR.z0); onPick(x, z); };
}

// zoomed-in map around the player: the best background image for where you are + every street drawn sharp + street names
function drawAroundMe(canvas, pl, markers, onPick) {
  const g = canvas.getContext('2d'), W = canvas.width; canvas.height = W; const range = 2400, s = W / range, x0 = pl.x - range / 2, z0 = pl.z - range / 2;
  const inR = (R0, m = 0) => pl.x > R0.x0 + m && pl.x < R0.x1 - m && pl.z > R0.z0 + m && pl.z < R0.z1 - m;
  g.fillStyle = '#5296c4'; g.fillRect(0, 0, W, W);
  const src = inR(CITY, range / 2 + 20) ? [cityMap, CITY, CM] : inR(DEM_RECT, range / 2) ? [regionBase || regionMap, DEM_RECT, RM] : inR(DEM2_RECT, 300) ? [corridorBase || corridorMap, DEM2_RECT, KM] : [farMap || corridorMap, farMap ? DEM3_RECT : DEM2_RECT, farMap ? FM : KM];
  const [img, R0, mpp] = src; g.imageSmoothingEnabled = true;
  g.drawImage(img, (x0 - R0.x0) / mpp, (z0 - R0.z0) / mpp, range / mpp, range / mpp, 0, 0, W, W);
  const M = window.MAP, X = x => (x - x0) * s, Z = z => (z - z0) * s; g.lineCap = 'round';
  const segs = roadGrid.near(pl.x, pl.z, range * 0.72, []);
  for (const pass of [0, 1]) for (const e of segs) {
    const r = M.roads[e.r]; if (r.t > 8) continue;
    const big = r.t <= 1, w = Math.max(r.t <= 6 ? 2.2 : 1.2, r.w * s) + (pass ? 0 : 2);
    g.strokeStyle = pass ? (big ? '#f6d860' : r.t <= 4 ? '#ffffff' : r.t <= 6 ? '#f4f4f4' : '#d8c9a6') : 'rgba(0,0,0,0.18)'; g.lineWidth = w;
    g.beginPath(); g.moveTo(X(M.nodes[e.a * 2]), Z(M.nodes[e.a * 2 + 1])); g.lineTo(X(M.nodes[e.b * 2]), Z(M.nodes[e.b * 2 + 1])); g.stroke();
  }
  // street names (one label per named street, on its longest piece in view)
  const best = new Map(); for (const e of segs) { const r = M.roads[e.r]; if (r.n === undefined || r.n < 0 || r.t > 6) continue; const L = e.len || 0; if (!best.has(r.n) || best.get(r.n).len < L) best.set(r.n, { e, len: L }); }
  g.font = '12px Segoe UI'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const [n, { e }] of best) { const ax = X(M.nodes[e.a * 2]), az = Z(M.nodes[e.a * 2 + 1]), bx = X(M.nodes[e.b * 2]), bz = Z(M.nodes[e.b * 2 + 1]); const mx = (ax + bx) / 2, mz = (az + bz) / 2; if (mx < 20 || mz < 20 || mx > W - 20 || mz > W - 20 || Math.hypot(bx - ax, bz - az) < 40) continue; let ang = Math.atan2(bz - az, bx - ax); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI; g.save(); g.translate(mx, mz); g.rotate(ang); g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.strokeText(M.names[n], 0, 0); g.fillStyle = '#333'; g.fillText(M.names[n], 0, 0); g.restore(); }
  for (const m of markers) { const mx = X(m.x), mz = Z(m.z); if (mx < 0 || mz < 0 || mx > W || mz > W) continue; g.font = '18px Segoe UI Emoji'; if (m.icon) g.fillText(m.icon, mx, mz); else { g.fillStyle = m.color || '#ffd45c'; g.beginPath(); g.arc(mx, mz, 6, 0, 7); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 1.5; g.stroke(); } }
  // scale bar + north
  g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(14, W - 34, 210, 24); g.fillStyle = '#222'; g.fillRect(20, W - 18, 500 * s, 4); g.font = '12px Segoe UI'; g.textAlign = 'left'; g.fillText('500 m', 26 + 500 * s, W - 16);
  g.font = 'bold 16px Segoe UI'; g.textAlign = 'center'; g.lineWidth = 4; g.strokeStyle = '#fff'; g.strokeText('N ↑', W - 30, 26); g.fillStyle = '#222'; g.fillText('N ↑', W - 30, 26);
  youAreHere(g, W / 2, W / 2, pl.yaw || 0);
  canvas.onclick = e => { const r = canvas.getBoundingClientRect(); onPick(x0 + (e.clientX - r.left) / r.width * range, z0 + (e.clientY - r.top) / r.height * range); };
}

// ---------- HUD ----------
const PLACE_NAMES = [];
export function updateHud(pl, placeName) {
  $('money').textContent = Math.round(pl.money);
  $('health').textContent = Math.round(pl.health);
  $('karma').textContent = pl.karma >= 5 ? '😇 ' + pl.karma : pl.karma <= -5 ? '😈 ' + pl.karma : '🙂 ' + pl.karma;
  const h = Math.floor(G.hour), m = Math.floor((G.hour - h) * 60);
  $('clock').textContent = `${({ spring: '🌸', summer: '🌞', fall: '🍂', winter: '❄️' })[G.season] || ''} ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'} · ${G.night > 0.5 && !(G.wet > 0.05) ? '🌙' : (G.weatherIcon || '☀️')} ${G.weatherName || ''}`;
  $('place').textContent = placeName;
  const v = pl.vehicle, vb = $('vehicle');
  if (v) { vb.classList.remove('hidden'); const alt = v.d.kind === 'heli' || v.d.kind === 'plane' ? ` <small>alt ${Math.round(v.y)} m</small>` : ''; vb.innerHTML = `<span class="vname">${v.label || v.d.name}</span>${Math.round(v.speedAbs * 3.6)}<small>km/h</small>${alt}`; }
  else vb.classList.add('hidden');
}
