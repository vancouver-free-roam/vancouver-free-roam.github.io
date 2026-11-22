// Neighbourhood character pieces (from Dav's reference photos):
//  - Granville Island: the red GRANVILLE ISLAND sign on its steel frame over Anderson Street, right under the Granville
//    Bridge (letters glow at night), and the big PUBLIC MARKET sign on the market building's street side.
//    (The painted sheds are city.js PAL.granville / inGranville; the painted silos are landmarks.js 'giants'.)
//  - Chinatown: strings of red lanterns across East Pender and Keefer, glowing at night.
//  - Surprise: a lion dance parades along East Pender every few minutes (two dancers in a red-and-gold lion, a drummer
//    and a cymbal player, firecracker pops). Get close for the secret 'liondance'.
import * as THREE from 'three';
import { G, scene, canvasTex, hash2, toXZ, std } from './core.js';
import { groundY, heightAt } from './terrain.js';
import { surfaceY, walkY, buildingAt, nearestRoad, buildings } from './city.js';
import { makeHuman, newLook } from './people.js';
import { SPOTS } from './landmarks.js';
import { swish } from './sound.js';
import { discover } from './missions.js';
import { ui } from './ui.js';

const M = window.MAP;
// street level here (sidewalk/road at ground level: never a bridge deck overhead, so it works under the Granville Bridge)
const gy = (x, z) => { const g = groundY(x, z), g0 = Number.isFinite(g) ? g : heightAt(x, z); return walkY(x, z, g0 + 0.5); };
const nameIds = re => { const s = new Set(); M.names.forEach((n, i) => { if (re.test(n)) s.add(i); }); return s; };
const NX = i => M.nodes[i * 2], NZ = i => M.nodes[i * 2 + 1];
const glowMats = [];   // emissive materials that light up at night: [material, day, night]

// a text sign (transparent canvas), double-sided
function letters(text, w, h, col, font, glow = true) {
  const tex = canvasTex(1024, Math.round(1024 * h / w), (c, W, H) => { c.clearRect(0, 0, W, H); c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = 10; c.strokeStyle = 'rgba(40,10,10,0.9)'; c.strokeText(text, W / 2, H / 2 + 4, W - 20); c.fillStyle = col; c.fillText(text, W / 2, H / 2 + 4, W - 20); }, false);
  const m = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.5, emissive: new THREE.Color(col), emissiveMap: tex, emissiveIntensity: 0.15 });
  if (glow) glowMats.push([m, 0.15, 1.6]);
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
}

// ---------- Granville Island entrance sign ----------
function granvilleSign() {
  const ids = nameIds(/^Anderson Street$/), I = SPOTS.market; if (!I) return;
  let best = null, bs = -1e9;
  for (const r of M.roads) { if (!ids.has(r.n)) continue;
    for (let k = 0; k + 1 < r.p.length; k++) { const ax = NX(r.p[k]), az = NZ(r.p[k]), bx = NX(r.p[k + 1]), bz = NZ(r.p[k + 1]), L = Math.hypot(bx - ax, bz - az);
      for (let s = 0; s <= L; s += 3) { const x = ax + (bx - ax) * s / L, z = az + (bz - az) * s / L, g0 = gy(x, z), deck = surfaceY(x, z);
        if (deck - g0 < 11) continue;   // under the bridge deck
        const sc = -Math.hypot(x - I.x, z - I.z); if (sc > bs) { bs = sc; best = { x, z, y: g0, ux: (bx - ax) / L, uz: (bz - az) / L, w: r.w }; } } } }
  if (!best) return;
  const { x, z, y, ux, uz, w } = best, half = w / 2 + 1.6, steel = std('#3b4046', { metalness: 0.6, roughness: 0.45 });
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = Math.atan2(ux, uz); scene.add(g);   // local x runs across the road
  for (const s of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.45, 8.6, 0.45), steel); post.position.set(s * half, 4.3, 0); post.castShadow = true; g.add(post); }
  for (const yy of [5.6, 8.3]) { const beam = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.5, 0.3, 0.3), steel); beam.position.set(0, yy, 0); g.add(beam); }
  for (let k = -4; k <= 4; k++) { const d = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.9, 0.08), steel); d.position.set(k * half / 4.5, 6.95, 0); d.rotation.z = k % 2 ? 0.5 : -0.5; g.add(d); }   // the truss
  const sign = letters('GRANVILLE ISLAND', half * 1.9, 2.1, '#e0262a', 'bold 150px Arial Black, Arial'); sign.position.set(0, 6.95, 0.22); g.add(sign);
  BUILT.gate = g;
}
const BUILT = {};

// ---------- PUBLIC MARKET sign on the market building ----------
function marketSign() {
  const ms = SPOTS.market; if (!ms) return;
  const b = buildingAt(ms.x, ms.z) || buildings.filter(q => Math.hypot(q.x - ms.x, q.z - ms.z) < 70).sort((p, q) => (q.x1 - q.x0) * (q.z1 - q.z0) - (p.x1 - p.x0) * (p.z1 - p.z0))[0]; if (!b) return;   // the market hall (or the biggest shed right there)
  // the wall that faces the nearest street
  let best = null, bd = 1e9; const n = b.p.length / 2;
  for (let i = 0; i < n; i++) { const j = (i + 1) % n, ax = b.p[i * 2], az = b.p[i * 2 + 1], bx = b.p[j * 2], bz = b.p[j * 2 + 1], L = Math.hypot(bx - ax, bz - az); if (L < 12) continue;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, r = nearestRoad(mx, mz, 60, rd => rd.t <= 6); const d = r ? r.d : 99; if (d < bd) { bd = d; best = { mx, mz, ux: (bx - ax) / L, uz: (bz - az) / L, L }; } }
  if (!best) return;
  let nx = -best.uz, nz = best.ux; if (buildingAt(best.mx + nx * 2, best.mz + nz * 2) === b) { nx = -nx; nz = -nz; }   // outward
  const w = Math.min(18, best.L * 0.8), g = new THREE.Group(); g.position.set(best.mx + nx * 0.35, b.top - 0.6, best.mz + nz * 0.35); g.rotation.y = Math.atan2(nx, nz); scene.add(g);
  const board = new THREE.Mesh(new THREE.BoxGeometry(w, 2.6, 0.25), std('#a3201d', { roughness: 0.6 })); board.position.y = 1.3; g.add(board);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.18, 0.32), std('#e8b931', { metalness: 0.4 })); trim.position.y = 2.62; g.add(trim);
  const txt = letters('PUBLIC MARKET', w * 0.92, 2.0, '#ffffff', 'bold 170px Arial Black, Arial'); txt.position.set(0, 1.3, 0.14); g.add(txt);
  BUILT.market = g;
}

// ---------- Chinatown lanterns ----------
const CT = { x0: 1050, x1: 1900, z0: 80, z1: 620 };
let lantIM = null, capIM = null, lantM = null;
function chinatownLanterns() {
  const ids = nameIds(/^(East |West )?Pender Street$|^(East )?Keefer Street$/), spots = [], wire = [];
  for (const r of M.roads) { if (!ids.has(r.n)) continue;
    let acc = 0;
    for (let k = 0; k + 1 < r.p.length; k++) { const ax = NX(r.p[k]), az = NZ(r.p[k]), bx = NX(r.p[k + 1]), bz = NZ(r.p[k + 1]), L = Math.hypot(bx - ax, bz - az); if (L < 1) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux, half = r.w / 2 + 3.2;
      for (let s = (22 - acc % 22); s < L; s += 22) { const x = ax + ux * s, z = az + uz * s; if (x < CT.x0 || x > CT.x1 || z < CT.z0 || z > CT.z1) continue;
        const y = gy(x, z) + 7.2, A = [x - nx * half, y, z - nz * half], B = [x + nx * half, y, z + nz * half], N = 14, pts = [];
        for (let q = 0; q <= N; q++) { const t = q / N; pts.push([A[0] + (B[0] - A[0]) * t, y - Math.sin(Math.PI * t) * 0.9, A[2] + (B[2] - A[2]) * t]); }
        for (let q = 0; q < N; q++) wire.push(...pts[q], ...pts[q + 1]);
        for (let q = 1; q <= 6; q++) { const t = q / 7; spots.push([A[0] + (B[0] - A[0]) * t, y - Math.sin(Math.PI * t) * 0.9 - 0.55, A[2] + (B[2] - A[2]) * t, hash2(x + q, z) * 6]); } }
      acc += L; } }
  if (!spots.length) return;
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
  scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: '#222222' })));
  lantM = new THREE.MeshStandardMaterial({ color: '#d81e1e', roughness: 0.55, emissive: new THREE.Color('#ff4a1c'), emissiveIntensity: 0.12 }); glowMats.push([lantM, 0.12, 1.5]);
  lantIM = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), lantM, spots.length);
  capIM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.16, 1, 10), std('#d4a017', { metalness: 0.6, roughness: 0.4 }), spots.length * 2);
  const o = new THREE.Object3D(); let c = 0;
  spots.forEach(([x, y, z, r], i) => {
    o.position.set(x, y, z); o.rotation.set(0, r, 0); o.scale.set(0.34, 0.42, 0.34); o.updateMatrix(); lantIM.setMatrixAt(i, o.matrix);
    for (const dy of [0.43, -0.43]) { o.position.set(x, y + dy, z); o.scale.set(1, 0.08, 1); o.updateMatrix(); capIM.setMatrixAt(c++, o.matrix); } });
  lantIM.castShadow = true; scene.add(lantIM); scene.add(capIM);
}

// ---------- the lion dance ----------
let lion = null, lionWait = 60;
function lionRoute() {   // East Pender through Chinatown, as one ordered polyline
  const ids = nameIds(/^East Pender Street$/), segs = [];
  for (const r of M.roads) { if (!ids.has(r.n)) continue; for (let k = 0; k + 1 < r.p.length; k++) { const a = [NX(r.p[k]), NZ(r.p[k])], b = [NX(r.p[k + 1]), NZ(r.p[k + 1])]; if ((a[0] > CT.x0 && a[0] < CT.x1 && a[1] > CT.z0 && a[1] < CT.z1) || (b[0] > CT.x0 && b[0] < CT.x1 && b[1] > CT.z0 && b[1] < CT.z1)) segs.push([a, b]); } }
  if (!segs.length) return null;
  // order the points along the street's main direction
  const pts = segs.flat(); let mx = 0, mz = 0; pts.forEach(p => { mx += p[0]; mz += p[1]; }); mx /= pts.length; mz /= pts.length;
  let a = 0, b = 0, c = 0; pts.forEach(p => { const dx = p[0] - mx, dz = p[1] - mz; a += dx * dx; b += dx * dz; c += dz * dz; }); const ang = 0.5 * Math.atan2(2 * b, a - c), ux = Math.cos(ang), uz = Math.sin(ang);
  const uniq = []; for (const p of pts.sort((p, q) => (p[0] * ux + p[1] * uz) - (q[0] * ux + q[1] * uz))) if (!uniq.length || Math.hypot(p[0] - uniq[uniq.length - 1][0], p[1] - uniq[uniq.length - 1][1]) > 3) uniq.push(p);
  const out = [uniq[0]], lens = [0]; for (let i = 1; i < uniq.length; i++) { out.push(uniq[i]); lens.push(lens[i - 1] + Math.hypot(uniq[i][0] - uniq[i - 1][0], uniq[i][1] - uniq[i - 1][1])); }
  return { pts: out, lens, total: lens[lens.length - 1] };
}
function along(R, s) { s = Math.max(0, Math.min(R.total - 0.01, s)); let i = 1; while (i < R.lens.length - 1 && R.lens[i] < s) i++; const t = (s - R.lens[i - 1]) / (R.lens[i] - R.lens[i - 1] || 1), a = R.pts[i - 1], b = R.pts[i]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, b[0] - a[0], b[1] - a[1]]; }
function buildLion() {
  const R = lionRoute(); if (!R || R.total < 80) return null;
  const red = std('#c8161d', { roughness: 0.5 }), gold = std('#e8b52a', { metalness: 0.5, roughness: 0.35 }), white = std('#f7f3ea', { roughness: 0.8 }), black = std('#111111');
  const scaleTex = canvasTex(256, 128, (c, w, h) => { c.fillStyle = '#c8161d'; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 16) for (let x = (y / 16) % 2 ? 8 : 0; x < w; x += 16) { c.strokeStyle = '#f0c040'; c.lineWidth = 2; c.beginPath(); c.arc(x + 8, y + 12, 7, Math.PI, 0); c.stroke(); } c.fillStyle = '#f7f3ea'; c.fillRect(0, h - 14, w, 14); });
  const g = new THREE.Group(); scene.add(g);
  const head = new THREE.Group(); head.position.set(0, 1.55, -1.3); g.add(head);
  const add = (geo, mat, x, y, z, p = head) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; p.add(m); return m; };
  add(new THREE.BoxGeometry(1.15, 0.95, 1.0), red, 0, 0, 0); add(new THREE.BoxGeometry(1.2, 0.18, 1.05), gold, 0, 0.5, 0);
  for (const s of [-1, 1]) { add(new THREE.SphereGeometry(0.2, 12, 10), white, s * 0.3, 0.2, -0.5); add(new THREE.SphereGeometry(0.09, 10, 8), black, s * 0.3, 0.2, -0.68); add(new THREE.BoxGeometry(0.3, 0.06, 0.06), gold, s * 0.3, 0.42, -0.52); }
  add(new THREE.ConeGeometry(0.12, 0.45, 8), gold, 0, 0.72, -0.2);                       // the horn
  const jaw = add(new THREE.BoxGeometry(1.0, 0.25, 0.7), gold, 0, -0.55, -0.15);           // the snapping jaw
  for (let k = 0; k < 9; k++) add(new THREE.BoxGeometry(0.12, 0.35, 0.12), white, -0.56 + k * 0.14, -0.35, 0.45);   // white fur fringe
  const body = add(new THREE.BoxGeometry(1.05, 0.9, 2.6), new THREE.MeshStandardMaterial({ map: scaleTex, roughness: 0.7 }), 0, 1.25, 0.25, g);
  const tail = add(new THREE.ConeGeometry(0.28, 0.7, 8), gold, 0, 1.25, 1.75, g); tail.rotation.x = Math.PI / 2;
  const look = () => { const l = newLook(); l.pants = '#e8b52a'; l.shoes = '#111'; l.coat = null; l.hat = null; return l; };
  const front = makeHuman(look()), back = makeHuman(look());   // the two dancers inside (only their golden trousers show)
  for (const h of [front, back]) { h.parts.torso.visible = false; h.parts.head.visible = false; h.parts.armL.visible = false; h.parts.armR.visible = false; g.add(h.grp); }
  front.grp.position.set(0, 0, -0.85); back.grp.position.set(0, 0, 0.9);
  const dl = newLook(); dl.shirt = '#c8161d'; dl.pants = '#111'; const drummer = makeHuman(dl), cl = newLook(); cl.shirt = '#e8b52a'; cl.pants = '#111'; const cymbal = makeHuman(cl);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.5, 18), red); drum.rotation.x = Math.PI / 2; drum.position.set(0, 1.0, -0.45); drummer.grp.add(drum);
  const sparkG = new THREE.BufferGeometry(); sparkG.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(90), 3));
  const sparks = new THREE.Points(sparkG, new THREE.PointsMaterial({ color: '#ffd27a', size: 0.25, transparent: true, opacity: 0 })); sparks.frustumCulled = false; scene.add(sparks);
  return { R, g, head, jaw, body, tail, front, back, drummer, cymbal, sparks, s: 0, dir: 1, t: 0, boom: 0, told: false, sv: [] };
}
function updateLion(dt, pl) {
  const near = Math.hypot(pl.x - (CT.x0 + CT.x1) / 2, pl.z - (CT.z0 + CT.z1) / 2) < 650, day = G.hour > 10 && G.hour < 19.5 && (G.wet || 0) < 0.5;
  if (!lion) { lionWait -= dt; if (lionWait > 0 || !near || !day) return; lion = buildLion(); lionWait = 200; if (!lion) return; lion.s = Math.random() < 0.5 ? 5 : lion.R.total - 5; lion.dir = lion.s < 10 ? 1 : -1; }
  const L = lion; L.t += dt;
  // the lion prances: forward in bursts, pauses to bow, shake its head and snap its jaw
  const surge = 0.5 + 0.5 * Math.sin(L.t * 0.9); L.s += L.dir * dt * 1.6 * surge;
  const [x, z, dx, dz] = along(L.R, L.s), side = (L.R.total ? 1 : 0) * 2.2, yaw = Math.atan2(-dx * L.dir, -dz * L.dir);
  const ox = Math.cos(yaw) * side, oz = -Math.sin(yaw) * side;   // walk a little off the centre line
  L.g.position.set(x + ox, gy(x + ox, z + oz), z + oz); L.g.rotation.y = yaw;
  L.head.rotation.set(Math.sin(L.t * 3.1) * 0.25 - 0.1, Math.sin(L.t * 1.7) * 0.45, Math.sin(L.t * 2.3) * 0.15); L.head.position.y = 1.55 + Math.max(0, Math.sin(L.t * 2.2)) * 0.45;
  L.jaw.position.y = -0.55 - Math.max(0, Math.sin(L.t * 6)) * 0.12;
  L.body.rotation.z = Math.sin(L.t * 2.4) * 0.12; L.body.position.y = 1.25 + Math.sin(L.t * 4.4) * 0.08; L.tail.rotation.z = Math.sin(L.t * 5) * 0.6;
  for (const h of [L.front, L.back]) { h.st.kind = 'walk'; h.st.amp = 0.9; h.st.phase += dt * 9 * (0.4 + surge); h.pose(dt); }
  const place = (h, back, kind, sp) => { const [hx, hz] = along(L.R, L.s - L.dir * back); h.grp.position.set(hx + ox * 1.6, gy(hx + ox * 1.6, hz + oz * 1.6), hz + oz * 1.6); h.grp.rotation.y = yaw; h.st.kind = kind; h.st.amp = 0.6; h.st.phase += dt * sp; h.pose(dt); };
  place(L.drummer, 6, 'walk', 5); place(L.cymbal, 8, 'dance', 7);
  // drum beats + firecrackers
  L.boom -= dt; if (L.boom < 0) { L.boom = 0.45; if (Math.hypot(pl.x - x, pl.z - z) < 120) swish(0.12, 0.05, 220, 0.005); }
  const sp = L.sparks.geometry.attributes.position;
  if (Math.random() < dt * 0.25) { L.sv = []; for (let i = 0; i < 30; i++) L.sv.push([x + ox * 2 + (Math.random() - 0.5), gy(x, z) + 0.2, z + oz * 2 + (Math.random() - 0.5), (Math.random() - 0.5) * 4, 2 + Math.random() * 4, (Math.random() - 0.5) * 4]); L.sparks.material.opacity = 1; if (Math.hypot(pl.x - x, pl.z - z) < 150) for (let k = 0; k < 4; k++) setTimeout(() => swish(0.05, 0.06, 3500, 0.001), k * 90); }
  L.sv.forEach((v, i) => { v[4] -= 9.8 * dt; v[0] += v[3] * dt; v[1] += v[4] * dt; v[2] += v[5] * dt; sp.setXYZ(i, v[0], v[1], v[2]); }); sp.needsUpdate = true; L.sparks.material.opacity = Math.max(0, L.sparks.material.opacity - dt * 0.8);
  const d = Math.hypot(pl.x - x, pl.z - z);
  if (!L.told && d < 220) { L.told = true; ui.toast('🦁 Lion dance!', 'Drums and firecrackers on East Pender: a red-and-gold lion is dancing through Chinatown to bring good luck. Get close!', 5000); }
  if (d < 18) discover('liondance');
  if (L.s < 0 || L.s > L.R.total || L.t > 240) {   // it reached the end of the street: everyone goes home
    for (const o of [L.g, L.drummer.grp, L.cymbal.grp, L.sparks]) scene.remove(o); lion = null;
  }
}

export function initDistricts() {
  for (const [f, n] of [[granvilleSign, 'Granville sign'], [marketSign, 'market sign'], [chinatownLanterns, 'Chinatown lanterns']]) try { f(); } catch (e) { console.warn(n + ' failed', e); }
}
export function updateDistricts(dt, pl) {
  const n = G.night || 0; for (const [m, d, nt] of glowMats) m.emissiveIntensity = d + (nt - d) * n;
  updateLion(dt, pl);
}
export const _districts = { get lion() { return lion; }, spawnLion: () => { lionWait = 0; }, glowMats, BUILT };
