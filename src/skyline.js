// Signature towers the map data is missing (OSM only has their low podiums), hand-built from photos:
//  - Vancouver House (Bjarke Ingels, 2020, ~150 m, 59 floors): a TRIANGLE at street level that widens floor by floor into a
//    full RECTANGLE at the top, because the Granville Bridge ramps cut the corner of the lot. White balcony bands.
//  - Paradox Vancouver (Arthur Erickson's twisting tower on West Georgia, ~188 m, 63 floors): the upper half is turned 45°
//    against the lower half, the turn happening floor by floor in the middle. Blue-grey curtain wall.
// Surprise: the Spinning Chandelier under the Granville Bridge (a giant crystal chandelier hung under the deck beside
// Vancouver House): every couple of minutes it lowers, lights up and spins, then winds back up. Secret 'chandelier'.
import * as THREE from 'three';
import { G, scene, canvasTex, hash2, inPoly } from './core.js';
import { heightAt, groundY } from './terrain.js';
import { buildings, bldGrid, surfaceY } from './city.js';
import { SPOTS } from './landmarks.js';
import { ui } from './ui.js';

const M = window.MAP;
const gy = (x, z) => { const g = groundY(x, z); return Number.isFinite(g) ? g : heightAt(x, z); };
const mats = [];

// facade texture: a 16 × 16 tile of panels × floors; `paint(ctx, px, py, pw, ph, i, j)` draws one panel; `emit` = lit windows at night
function facade(paint, glow = 0.3) {
  const map = canvasTex(512, 512, (c, W) => { const s = W / 16; for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) paint(c, i * s, j * s, s, s, i, j); });
  const emissiveMap = canvasTex(256, 256, (c, W) => { const s = W / 16; c.fillStyle = '#000'; c.fillRect(0, 0, W, W);
    for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) { const r = hash2(i * 7.1, j * 3.3); if (r > glow) continue; c.fillStyle = r < 0.05 ? '#9fc2ff' : `hsl(${34 + r * 30}, 80%, ${55 + r * 40}%)`; c.fillRect(i * s + 1, j * s + s * 0.2, s - 2, s * 0.7); } });
  const m = new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: new THREE.Color(1, 0.9, 0.75), emissiveIntensity: 0, roughness: 0.22, metalness: 0.45, envMapIntensity: 1.1 });  mats.push(m); return m;
}
// walls between a stack of floor outlines (each level the same number of corners), flat-shaded, plus a roof
function loft(levels, mat, tileW, tileH) {
  const pos = [], nor = [], uv = [], n = levels[0].p.length;
  const quad = (a, b, c, d, ua, ub, va, vb, out) => {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0]; const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
    let tri = [[a, ua, va], [b, ub, va], [c, ub, vb], [a, ua, va], [c, ub, vb], [d, ua, vb]];
    if (nx * out[0] + nz * out[1] < 0) { nx = -nx; ny = -ny; nz = -nz; tri = [tri[0], tri[2], tri[1], tri[3], tri[5], tri[4]]; }
    for (const [p, u, v] of tri) { pos.push(p[0], p[1], p[2]); nor.push(nx, ny, nz); uv.push(u / tileW, v / tileH); }
  };
  for (let L = 0; L < levels.length - 1; L++) {
    const A = levels[L], B = levels[L + 1]; let u = 0;
    const cx = A.p.reduce((s, q) => s + q[0], 0) / n, cz = A.p.reduce((s, q) => s + q[1], 0) / n;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, len = (Math.hypot(A.p[j][0] - A.p[i][0], A.p[j][1] - A.p[i][1]) + Math.hypot(B.p[j][0] - B.p[i][0], B.p[j][1] - B.p[i][1])) / 2;
      if (len < 0.01) continue;
      const mx = (A.p[i][0] + A.p[j][0]) / 2 - cx, mz = (A.p[i][1] + A.p[j][1]) / 2 - cz;
      quad([A.p[i][0], A.y, A.p[i][1]], [A.p[j][0], A.y, A.p[j][1]], [B.p[j][0], B.y, B.p[j][1]], [B.p[i][0], B.y, B.p[i][1]], u, u + len, A.y - levels[0].y, B.y - levels[0].y, [mx, mz]);
      u += len;
    }
  }
  const T = levels[levels.length - 1];   // roof (convex outline: a fan)
  for (let i = 1; i < n - 1; i++) for (const q of [T.p[0], T.p[i + 1], T.p[i]]) { pos.push(q[0], T.y, q[1]); nor.push(0, 1, 0); uv.push(0.02, 0.02); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const m = new THREE.Mesh(g, mat); m.castShadow = m.receiveShadow = true; scene.add(m); return m;
}
function addRec(name, pts, base, top) {   // a collision record (solid tower, roof you can land on)
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const rec = { p: new Float32Array(pts.flat()), top, base, x: (x0 + x1) / 2, z: (z0 + z1) / 2, name, h: top - base, x0, z0, x1, z1 };
  buildings.push(rec); bldGrid.addBox(x0, z0, x1, z1, rec);
}
const nameIdx = re => { const out = new Set(); M.names.forEach((n, i) => { if (re.test(n)) out.add(i); }); return out; };
function bldByName(re) {
  const ids = nameIdx(re); let best = null, bestA = 0;
  for (const b of M.blds) { if (!ids.has(b.n)) continue; let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let i = 0; i < b.p.length; i += 2) { x0 = Math.min(x0, b.p[i]); x1 = Math.max(x1, b.p[i]); z0 = Math.min(z0, b.p[i + 1]); z1 = Math.max(z1, b.p[i + 1]); }
    const a = (x1 - x0) * (z1 - z0); if (a > bestA && (x0 + x1) / 2 < 3000 && Math.abs((z0 + z1) / 2) < 3000) { bestA = a; best = b; } }
  return best;
}
const centroid = p => { let x = 0, z = 0; const n = p.length / 2; for (let i = 0; i < n; i++) { x += p[i * 2]; z += p[i * 2 + 1]; } return [x / n, z / n]; };
function longestDir(p) { let best = 0, d = [1, 0]; const n = p.length / 2; for (let i = 0; i < n; i++) { const j = (i + 1) % n, dx = p[j * 2] - p[i * 2], dz = p[j * 2 + 1] - p[i * 2 + 1], L = Math.hypot(dx, dz); if (L > best) { best = L; d = [dx / L, dz / L]; } } return d; }

// ---------- Vancouver House ----------
let chand = null;
function vancouverHouse() {
  const site = bldByName(/^Vancouver House$/); if (!site) return;
  const [sx, sz] = centroid(site.p);
  // the Granville Bridge and its ramps around the lot (segments, with the drawn half-width)
  const ids = nameIdx(/^Granville Bridge$/), segs = [];
  for (const r of M.roads) if (ids.has(r.n) && r.t <= 3) for (let k = 0; k + 1 < r.p.length; k++) { const a = r.p[k], b = r.p[k + 1], ax = M.nodes[a * 2], az = M.nodes[a * 2 + 1], bx = M.nodes[b * 2], bz = M.nodes[b * 2 + 1]; if (Math.hypot((ax + bx) / 2 - sx, (az + bz) / 2 - sz) < 320) segs.push([ax, az, bx, bz, r.w / 2]); }
  const segNear = (x, z) => { let best = 1e9, s = null, q = null; for (const g of segs) { const dx = g[2] - g[0], dz = g[3] - g[1], L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - g[0]) * dx + (z - g[1]) * dz) / L2)), px = g[0] + dx * t, pz = g[1] + dz * t, d = Math.hypot(x - px, z - pz) - g[4]; if (d < best) { best = d; s = g; q = [px, pz]; } } return { d: best, s, q }; };
  // the tower stands on the part of the lot farthest from every ramp; its long side runs along the nearest one
  let cx = sx, cz = sz, bestD = -1; { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let i = 0; i < site.p.length; i += 2) { x0 = Math.min(x0, site.p[i]); x1 = Math.max(x1, site.p[i]); z0 = Math.min(z0, site.p[i + 1]); z1 = Math.max(z1, site.p[i + 1]); }
    for (let x = x0; x <= x1; x += 3) for (let z = z0; z <= z1; z += 3) { if (!inPoly(x, z, site.p)) continue; const d = segs.length ? segNear(x, z).d : 0; if (d > bestD) { bestD = d; cx = x; cz = z; } } }
  const nb = segNear(cx, cz); let ux = 1, uz = 0, vx = 0, vz = 1;
  if (nb.s) { const L = Math.hypot(nb.s[2] - nb.s[0], nb.s[3] - nb.s[1]) || 1; ux = (nb.s[2] - nb.s[0]) / L; uz = (nb.s[3] - nb.s[1]) / L; vx = -uz; vz = ux; if ((nb.q[0] - cx) * vx + (nb.q[1] - cz) * vz < 0) { vx = -vx; vz = -vz; } }   // +v: toward the bridge
  const base = gy(cx, cz) - 1, H = 150, FL = 59, Wh = Math.max(8, Math.min(13, bestD - 2)), Lh = Wh * 1.75;
  const P = (u, v) => [cx + ux * u + vx * v, cz + uz * u + vz * v];
  const A = P(-Lh, -Wh), B = P(Lh, -Wh), C = P(Lh, Wh), D = P(-Lh, Wh), mid = P(0, 0);
  const levels = []; for (let f = 0; f <= FL; f++) { const t = f / FL, s = Math.pow(Math.min(1, Math.max(0, (t - 0.03) / 0.97)), 0.85);
    levels.push({ y: base + t * H, p: [A, B, [mid[0] + (C[0] - mid[0]) * s, mid[1] + (C[1] - mid[1]) * s], D] }); }
  const mat = facade((c, x, y, w, h, i, j) => {
    const k = hash2(i * 1.7, j * 2.3); c.fillStyle = `rgb(${44 + k * 18},${66 + k * 20},${74 + k * 22})`; c.fillRect(x, y, w, h);   // deep glass, set back
    c.fillStyle = 'rgba(160,190,195,0.55)'; c.fillRect(x, y + h * 0.55, w, h * 0.3);                                              // glass balcony railing
    c.fillStyle = '#eef0ee'; c.fillRect(x, y + h * 0.84, w, h * 0.16);                                                               // white slab edge
    if (i % 4 === 0) { c.fillStyle = 'rgba(230,232,230,0.8)'; c.fillRect(x, y, w * 0.06, h); } });
  loft(levels, mat, 24, 16 * H / FL);
  addRec('Vancouver House', [A, B, mid, D], base, base + H);
  SPOTS.vanhouse = { id: 'vanhouse', name: 'Vancouver House', x: cx, z: cz, y: base };
  // the chandelier hangs under the bridge deck near the tower, where the deck is high enough above the street
  let ch = null, chS = -1e9;
  for (const g of segs) for (let t = 0.1; t < 0.95; t += 0.1) { const x = g[0] + (g[2] - g[0]) * t, z = g[1] + (g[3] - g[1]) * t, deck = surfaceY(x, z), g0 = gy(x, z), clr = deck - g0;
    if (clr < 13 || g0 < 0.5) continue; const sc = -Math.hypot(x - cx, z - cz) + Math.min(clr, 22) * 3; if (sc > chS) { chS = sc; ch = [x, z, deck, g0]; } }
  if (ch) buildChandelier(...ch);
}

// ---------- Paradox Vancouver (the twist) ----------
function paradox() {
  const site = bldByName(/^Paradox Vancouver$|^Trump International/); if (!site) return;
  const [cx, cz] = centroid(site.p), [ux, uz] = longestDir(site.p), base = gy(cx, cz) - 1, H = 188, FL = 63, Lh = 18, Wh = 12;
  const levels = []; for (let f = 0; f <= FL; f++) {
    const t = f / FL, a = Math.PI / 4 * (t < 0.4 ? 0 : t > 0.53 ? 1 : (1 - Math.cos((t - 0.4) / 0.13 * Math.PI)) / 2), ca = Math.cos(a), sa = Math.sin(a);
    const ax = ux * ca - uz * sa, az = ux * sa + uz * ca, bx = -az, bz = ax;
    levels.push({ y: base + t * H, p: [[-Lh, -Wh], [Lh, -Wh], [Lh, Wh], [-Lh, Wh]].map(([u, v]) => [cx + ax * u + bx * v, cz + az * u + bz * v]) });
  }
  const mat = facade((c, x, y, w, h, i, j) => {
    const k = hash2(i * 3.1, j * 1.3); c.fillStyle = `rgb(${52 + k * 22},${84 + k * 24},${112 + k * 26})`; c.fillRect(x, y, w, h);   // blue-grey curtain wall
    const gr = c.createLinearGradient(x, y, x + w, y + h); gr.addColorStop(0, 'rgba(255,255,255,0.12)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = gr; c.fillRect(x, y, w, h);
    c.fillStyle = '#7d8c99'; c.fillRect(x, y + h * 0.88, w, h * 0.12); c.fillStyle = '#a9b4bd'; c.fillRect(x, y, w * 0.07, h); }, 0.3);
  loft(levels, mat, 24, 16 * H / FL);
  addRec('Paradox Vancouver', levels[0].p, base, base + H * 0.45);   // (the lower half; the twisted top half overhangs it a little)
  addRec('Paradox Vancouver', levels[FL].p, base + H * 0.45, base + H);
}

// ---------- the Spinning Chandelier ----------
function buildChandelier(x, z, deckY, g0) {
  const g = new THREE.Group(), gold = new THREE.MeshStandardMaterial({ color: '#c9a659', metalness: 0.9, roughness: 0.3, emissive: '#3a2a08', emissiveIntensity: 0 });
  const crystalM = new THREE.MeshStandardMaterial({ color: '#f4f8ff', metalness: 0.2, roughness: 0.05, emissive: '#fff3d8', emissiveIntensity: 0, envMapIntensity: 2.2, transparent: true, opacity: 0.92 });
  const add = (geo, mat, px, py, pz) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); g.add(m); return m; };
  add(new THREE.CylinderGeometry(0.09, 0.09, 6.4, 8), gold, 0, -3.2, 0);   // the stem (the cable runs up into the deck)
  const tiers = [[-1.4, 0.9, 10], [-2.8, 1.6, 14], [-4.2, 2.15, 18], [-5.4, 1.4, 12]];   // [y, radius, arms]
  const crystals = [];
  for (const [ty, r, n] of tiers) {
    add(new THREE.TorusGeometry(r, 0.06, 6, 40).rotateX(Math.PI / 2), gold, 0, ty, 0);
    for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2, ax = Math.cos(a) * r, az = Math.sin(a) * r;
      const arm = add(new THREE.CylinderGeometry(0.035, 0.035, r, 5), gold, ax / 2, ty + 0.15, az / 2); arm.rotation.z = Math.PI / 2; arm.rotation.y = -a;
      add(new THREE.CylinderGeometry(0.07, 0.09, 0.35, 8), gold, ax, ty + 0.2, az);   // candle cups
      for (let d = 0; d < 4; d++) crystals.push([ax * (1 + d * 0.02), ty - 0.25 - d * 0.32, az * (1 + d * 0.02), 0.11 - d * 0.015]); }
    for (let k = 0; k < n * 2; k++) { const a = (k + 0.5) / (n * 2) * Math.PI * 2; for (let d = 0; d < 3; d++) crystals.push([Math.cos(a) * r * (0.97 - d * 0.03), ty - 0.15 - d * 0.28, Math.sin(a) * r * (0.97 - d * 0.03), 0.08]); }
  }
  crystals.push([0, -6.25, 0, 0.32]);   // the big drop at the bottom
  const inst = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), crystalM, crystals.length), mm = new THREE.Matrix4();
  crystals.forEach(([cx2, cy, cz2, s], i) => { mm.makeScale(s, s * 1.8, s); mm.setPosition(cx2, cy, cz2); inst.setMatrixAt(i, mm); });
  g.add(inst);
  const lamp = new THREE.PointLight('#ffe6b8', 0, 40, 2); lamp.position.set(0, -3.5, 0); g.add(lamp);
  const top = deckY - 2.3, drop = Math.max(0, Math.min(6, top - 6.6 - (g0 + 3.2)));
  g.position.set(x, top, z); scene.add(g);
  chand = { g, x, z, top, drop, gold, crystalM, lamp, t: 40 + Math.random() * 40, told: false };
  SPOTS.chandelier = { id: 'chandelier', name: 'The Spinning Chandelier', x, z, y: g0 };
}
const CYCLE = 150;   // seconds: lower (10 s), spin (35 s), wind back up (10 s), rest
function updateChandelier(dt, player) {
  const c = chand; if (!c) return;
  const d = Math.hypot(player.x - c.x, player.z - c.z); c.g.visible = d < 2500; if (d > 900) return;
  c.t = (c.t + dt) % CYCLE; const t = c.t;
  const low = t < 10 ? (1 - Math.cos(t / 10 * Math.PI)) / 2 : t < 45 ? 1 : t < 55 ? (1 + Math.cos((t - 45) / 10 * Math.PI)) / 2 : 0;
  const spin = t > 8 && t < 47 ? Math.min(1, (t - 8) / 6, (47 - t) / 6) : 0;
  c.g.position.y = c.top - c.drop * low;
  c.g.rotation.y += dt * spin * 1.6;
  c.g.rotation.z = Math.sin(t * 1.3) * 0.02 * spin;   // a little swing
  const glow = Math.max(low, (G.night || 0) * 0.35);
  c.crystalM.emissiveIntensity = glow * (0.7 + 0.3 * Math.sin(t * 9)); c.gold.emissiveIntensity = glow * 0.6; c.lamp.intensity = glow * 120;
  if (t < 1 && d < 160 && !c.told) { c.told = true; ui.toast('✨ The Spinning Chandelier', 'Under the Granville Bridge, a giant crystal chandelier lowers, lights up and spins. Public art, a few times a day. Look up!', 5000); }
  if (t > 60) c.told = false;
}

export function initSkyline() { vancouverHouse(); paradox(); }
export function updateSkyline(dt, player) {
  const n = G.night || 0; for (const m of mats) m.emissiveIntensity = n * 0.45;
  updateChandelier(dt, player);
}
export const _skyline = { get chand() { return chand; } };
