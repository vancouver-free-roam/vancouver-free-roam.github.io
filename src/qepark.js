// Queen Elizabeth Park, on top of Little Mountain (the highest point in Vancouver city). Real layout from OpenStreetMap
// (src/parkdata.js, tools/fetch-parks.mjs):
//  - the Bloedel Conservatory: a triodetic geodesic dome (≈43 m across, 21 m tall, 1,490 plexiglass "bubbles" on an
//    aluminium frame, opened 1969). Walk in through the entrance: tropical plants, a pond and free-flying birds inside,
//    a talking parrot by the door, and the dome glows at night.
//  - the summit plaza and the Dancing Waters fountain (the real pool outline, jets in changing patterns, lit at night).
//  - the Large and Small Quarry Gardens: old basalt quarries sunk into the hill (terrain.js digs them in), with rock faces,
//    a waterfall cascading into a stream, stepping stones, wooden bridge rails and terraced flower beds that change with
//    the seasons.
//  - the viewpoints over the city to the North Shore mountains: stone parapets, info boards and coin binoculars (E = look).
//  - the Rose Garden, and (surprise) wedding photo shoots in the Large Quarry Garden: walk into the shot = photobomb.
import * as THREE from 'three';
import { G, scene, std, hash2, vnoise, inPoly, clamp, pick, R, key, tapped, toXZ, depthBias } from './core.js';
import { groundY, heightAt, QUARRIES } from './terrain.js';
import { addFlatSurface, nearestRoad } from './city.js';
import { setColliders } from './colliders.js';
import { SPOTS } from './landmarks.js';
import { PARKDATA } from './parkdata.js';
import { makeHuman, newLook } from './people.js';
import { discover } from './missions.js';
import { sfx } from './sound.js';
import { ui } from './ui.js';

const QE = PARKDATA.qe;
const CX = 452.6, CZ = 4526.3, R0 = 21.7, H = 21;     // dome (from the OSM footprint; real: 140 ft wide, 70 ft tall)
const POOL = QE.pool, [FX, FZ] = (() => { let x = 0, z = 0; for (let i = 0; i < POOL.length; i += 2) { x += POOL[i]; z += POOL[i + 1]; } return [x / (POOL.length / 2), z / (POOL.length / 2)]; })();
export const QE_FOUNTAIN = { x: FX, z: FZ };         // details.js leaves its generic fountain out here
const gy = (x, z) => { const g = groundY(x, z); return Number.isFinite(g) ? g : heightAt(x, z); };
const cen = p => { let x = 0, z = 0; for (let i = 0; i < p.length; i += 2) { x += p[i]; z += p[i + 1]; } return [x / (p.length / 2), z / (p.length / 2)]; };
function edgeDist(p, x, z) { let d = 1e9; for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length, ax = p[i], az = p[i + 1], bx = p[j] - ax, bz = p[j + 1] - az, L = bx * bx + bz * bz || 1, t = clamp(((x - ax) * bx + (z - az) * bz) / L, 0, 1); d = Math.min(d, Math.hypot(x - ax - bx * t, z - az - bz * t)); } return d; }
const onPath = (x, z, pad) => { const r = nearestRoad(x, z, 8); return !!(r && r.d < r.road.w / 2 + pad); };

// ---------- little merge kit (vertex coloured) ----------
function merge(parts) {
  const pos = [], nor = [], col = [], c = new THREE.Color(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
  for (const p of parts) {
    let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    e.set(p.rx || 0, p.ry || 0, p.rz || 0); q.setFromEuler(e); v.set(p.x || 0, p.y || 0, p.z || 0); s.set(p.sx || 1, p.sy || 1, p.sz || 1); m.compose(v, q, s); g.applyMatrix4(m);
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); c.set(p.c);
    const j = p.j || 0; for (let i = 0; i < g.attributes.position.count; i++) { const k = 1 + (j ? (hash2(i * 7 + pos.length, i) - 0.5) * j : 0); col.push(c.r * k, c.g * k, c.b * k); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}
const VC = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
const VCR = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });   // rock / planting
// a flat ring/disc laid over the drawn ground (so it never floats or sinks)
function drape(cx, cz, r0, r1, color, lift = 0.07, seg = 64) {
  const geo = new THREE.RingGeometry(r0, r1, seg, 4).rotateX(-Math.PI / 2), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) + cx, z = p.getZ(i) + cz; p.setXYZ(i, x, gy(x, z) + lift, z); }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, std(color, { roughness: 0.9 })); m.receiveShadow = true; scene.add(m); return m;
}
// a grid patch on the drawn ground; keeps triangles whose middle passes `keep`; colour + height bump per vertex
function patch(x0, z0, x1, z1, step, keep, colAt, lift, bump) {
  const nx = Math.ceil((x1 - x0) / step), nz = Math.ceil((z1 - z0) / step), pos = [], col = [], idx = [], c = new THREE.Color();
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const x = x0 + i * step, z = z0 + j * step; pos.push(x, gy(x, z) + lift + (bump ? bump(x, z) : 0), z); c.set(colAt(x, z)); col.push(c.r, c.g, c.b); }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, d = a + nx + 1, e = d + 1, cx = x0 + (i + 0.5) * step, cz = z0 + (j + 0.5) * step; if (keep(cx - step * 0.2, cz - step * 0.2)) idx.push(a, d, b); if (keep(cx + step * 0.2, cz + step * 0.2)) idx.push(b, d, e); }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
const slopeAt = (x, z) => { const e = 1.2; return Math.hypot(gy(x + e, z) - gy(x - e, z), gy(x, z + e) - gy(x, z - e)) / (2 * e); };

let glass = null, birds = [], jets = null, jetPts = [], waterTop = null, parrotT = 0, inside = false, floorY = 0, built = false;
let flowMat = null, fallMat = null, mist = null, plantMesh = null, roseMesh = null, plantSeason = null, views = [], viewing = null, viewFov = false;
let wedding = null, weddingT = 0, inQuarry = false, cols = [];
const BIRD_COLS = [['#d62828', '#1d4ed8'], ['#f4c430', '#16a34a'], ['#1d4ed8', '#f4c430'], ['#16a34a', '#d62828'], ['#ffffff', '#f97316'], ['#f97316', '#111827'], ['#e11d48', '#22c55e']];
const _o = new THREE.Object3D();

export function initQEPark() {
  buildDome();
  buildPlaza();
  buildQuarries();
  buildStreams();
  buildViewpoints();
  plantSeason = G.season; buildPlanting();
  setColliders('qepark', cols);
  SPOTS.qequarry = { id: 'qequarry', name: 'Quarry Garden', x: 370, z: 4488, y: gy(370, 4488) };
  built = true;
}

// ================= the Bloedel Conservatory =================
function buildDome() {
  let gmin = 1e9, gmax = -1e9; for (let a = 0; a < 6.29; a += 0.2) for (const r of [0, R0 * 0.5, R0]) { const g = gy(CX + Math.cos(a) * r, CZ + Math.sin(a) * r); gmin = Math.min(gmin, g); gmax = Math.max(gmax, g); }
  floorY = gmax + 0.25; const base = floorY;
  const doorA = Math.atan2(FZ - CZ, FX - CX), dX = Math.cos(doorA), dZ = Math.sin(doorA);   // entrance faces the fountain plaza
  drape(CX, CZ, R0 + 0.5, R0 + 9, '#bfb8ab');
  { const L = Math.hypot(FX - CX, FZ - CZ), n = Math.ceil(L / 4), w = 3.2, P = [];   // the walk from the dome to the fountain plaza
    for (let i = 0; i <= n; i++) { const t = i / n, x = CX + (FX - CX) * t, z = CZ + (FZ - CZ) * t; for (const s of [-1, 1]) { const X = x - dZ * w * s, Z = z + dX * w * s; P.push(X, gy(X, Z) + 0.06, Z); } }
    const idx = []; for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, std('#bfb8ab', { roughness: 0.9, side: THREE.DoubleSide })); m.receiveShadow = true; scene.add(m); }

  const grp = new THREE.Group(); grp.position.set(CX, 0, CZ); scene.add(grp);
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(R0 + 0.4, R0 + 0.6, base - gmin + 1.4, 48, 1, true), std('#a9a49a', { roughness: 0.85, side: THREE.DoubleSide }));
  plinth.position.y = (base + 0.5 + gmin - 0.9) / 2; grp.add(plinth);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R0 + 0.2, 48).rotateX(-Math.PI / 2), std('#8c7b66', { roughness: 0.95 })); floor.position.y = base; floor.receiveShadow = true; grp.add(floor);
  { const P = []; for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; P.push(CX + Math.cos(a) * (R0 + 0.3), CZ + Math.sin(a) * (R0 + 0.3)); } addFlatSurface(P, base); }
  const ico = new THREE.IcosahedronGeometry(R0, 5), ip = ico.attributes.position, gp = [], edges = new Map(), sy = H / R0;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), M = new THREE.Vector3();
  for (let i = 0; i < ip.count; i += 3) {
    A.fromBufferAttribute(ip, i); B.fromBufferAttribute(ip, i + 1); C.fromBufferAttribute(ip, i + 2);
    if ((A.y + B.y + C.y) / 3 < -0.3) continue;
    for (const V of [A, B, C]) { V.y = Math.max(0, V.y) * sy; }
    M.copy(A).add(B).add(C).multiplyScalar(1 / 3); const len = M.length(); M.multiplyScalar((len + 0.45) / len);
    for (const [P, Q] of [[A, B], [B, C], [C, A]]) {
      gp.push(P.x, P.y, P.z, Q.x, Q.y, Q.z, M.x, M.y, M.z);
      const k = [P, Q].map(v => v.x.toFixed(1) + ',' + v.y.toFixed(1) + ',' + v.z.toFixed(1)).sort().join('|'); if (!edges.has(k)) edges.set(k, [P.clone(), Q.clone()]);
    }
  }
  const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3)); gg.computeVertexNormals();
  glass = new THREE.MeshStandardMaterial({ color: '#b9d6de', transparent: true, opacity: 0.24, roughness: 0.06, metalness: 0.15, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false, emissive: '#ffd79a', emissiveIntensity: 0 });
  const dome = new THREE.Mesh(gg, glass); dome.position.y = base + 0.4; dome.renderOrder = 2; grp.add(dome);
  const struts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.07, 1, 5).rotateX(Math.PI / 2).translate(0, 0, 0.5), std('#c9ced3', { metalness: 0.8, roughness: 0.35 }), edges.size);
  let si = 0; for (const [P, Q] of edges.values()) { _o.position.set(P.x, P.y + base + 0.4, P.z); _o.lookAt(Q.x + 0, Q.y + base + 0.4, Q.z); _o.scale.set(1, 1, P.distanceTo(Q)); _o.updateMatrix(); struts.setMatrixAt(si++, _o.matrix); }
  struts.castShadow = true; grp.add(struts);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R0, 0.25, 6, 64).rotateX(Math.PI / 2), std('#8a9096', { metalness: 0.7 })); ring.position.y = base + 0.45; grp.add(ring);
  const vest = new THREE.Group(); vest.position.set(dX * (R0 + 1.2), base, dZ * (R0 + 1.2)); vest.rotation.y = Math.atan2(dX, dZ); grp.add(vest);
  vest.add(new THREE.Mesh(merge([{ geo: new THREE.BoxGeometry(5.6, 0.35, 5), c: '#9aa0a6', y: 3.3 }, { geo: new THREE.BoxGeometry(0.35, 3.3, 5), c: '#9aa0a6', x: -2.6, y: 1.65 }, { geo: new THREE.BoxGeometry(0.35, 3.3, 5), c: '#9aa0a6', x: 2.6, y: 1.65 }]), VC));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.6), new THREE.MeshBasicMaterial({ map: textTex('BLOEDEL CONSERVATORY', '#1f2a2e', '#e8e2cf', 512, 64, 30) })); sign.position.set(0, 3.0, 2.52); vest.add(sign);
  const P = [], rnd = (k) => hash2(CX * 0.37 + k * 1.7, CZ * 0.11 + k * 3.1);
  P.push({ geo: new THREE.CylinderGeometry(5, 5, 0.3, 28), c: '#2f5d6e', x: -4, y: 0.05, z: -3 }, { geo: new THREE.TorusGeometry(5, 0.45, 6, 28).rotateX(Math.PI / 2), c: '#7b6f5f', x: -4, y: 0.2, z: -3 });
  P.push({ geo: new THREE.BoxGeometry(1.6, 0.25, 11), c: '#6b4a2e', x: -4, y: 0.55, z: -3, ry: 0.5 });
  for (let i = 0; i < 70; i++) {
    const a = rnd(i) * Math.PI * 2, r = 4 + rnd(i + 100) * (R0 - 6), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x + 4, z + 3) < 6 || Math.abs(Math.atan2(Math.sin(a - doorA), Math.cos(a - doorA))) < 0.25) continue;
    const k = rnd(i + 200), hMax = Math.max(2, H * Math.sqrt(1 - (r / R0) ** 2) - 3);
    if (k < 0.3) {
      const h = Math.min(hMax, 6 + rnd(i + 300) * 9);
      P.push({ geo: new THREE.CylinderGeometry(0.18, 0.3, h, 6), c: '#7a6247', x, y: h / 2, z, rz: (rnd(i + 5) - 0.5) * 0.2 });
      for (let f = 0; f < 7; f++) { const fa = f / 7 * Math.PI * 2; P.push({ geo: new THREE.ConeGeometry(0.5, 3.4, 4).rotateX(Math.PI / 2), c: '#2f7d32', x: x + Math.cos(fa) * 1.4, y: h - 0.3, z: z + Math.sin(fa) * 1.4, ry: -fa + Math.PI / 2, rx: 0.5, sy: 0.25 }); }
    } else if (k < 0.75) {
      const s = 0.8 + rnd(i + 400) * 1.6; P.push({ geo: new THREE.IcosahedronGeometry(s, 1), c: ['#2e7d32', '#1b5e20', '#388e3c', '#4a7c2a', '#0f5132'][i % 5], x, y: s * 0.7, z, sy: 0.8 });
    } else {
      const c = ['#e53935', '#ec407a', '#fb8c00', '#fdd835', '#ab47bc'][i % 5];
      for (let f = 0; f < 5; f++) P.push({ geo: new THREE.IcosahedronGeometry(0.28, 0), c, x: x + (rnd(i * 7 + f) - 0.5) * 1.6, y: 0.5 + rnd(i * 3 + f) * 0.8, z: z + (rnd(i * 5 + f) - 0.5) * 1.6 });
      P.push({ geo: new THREE.IcosahedronGeometry(0.9, 0), c: '#2e7d32', x, y: 0.5, z, sy: 0.6 });
    }
  }
  const garden = new THREE.Mesh(merge(P), VC); garden.position.y = base; garden.castShadow = true; grp.add(garden);
  const bodyG = new THREE.SphereGeometry(0.18, 8, 6).scale(1, 0.8, 1.8), wingG = new THREE.PlaneGeometry(0.5, 0.22).translate(0.25, 0, 0);
  for (let i = 0; i < 16; i++) {
    const [c1, c2] = BIRD_COLS[i % BIRD_COLS.length], b = new THREE.Group();
    b.add(new THREE.Mesh(bodyG, std(c1)));
    const wm = std(c2, { side: THREE.DoubleSide }), w1 = new THREE.Mesh(wingG, wm), w2 = new THREE.Mesh(wingG, wm); w2.rotation.y = Math.PI; b.add(w1, w2);
    b.userData = { w1, w2, ph: i * 1.7, r: 4 + (i % 5) * 2.6, sp: 0.35 + (i % 4) * 0.12, dir: i % 2 ? 1 : -1, hy: 3 + (i % 6) * 1.6 };
    grp.add(b); birds.push(b);
  }
  const cl = []; for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2; if (Math.abs(Math.atan2(Math.sin(a - doorA), Math.cos(a - doorA))) < 0.09) continue; cl.push({ x: CX + Math.cos(a) * R0, z: CZ + Math.sin(a) * R0, r: 1.0, top: base + 6 }); }
  setColliders('bloedel', cl);
  SPOTS.bloedel = { id: 'bloedel', name: 'Bloedel Conservatory', x: CX, z: CZ, y: base };
}
function textTex(text, bg, fg, w, h, size, sub) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h); x.fillStyle = fg; x.font = `bold ${size}px Georgia, serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
  if (Array.isArray(text)) text.forEach((t, i) => { x.font = i ? `${Math.round(size * 0.55)}px Arial, sans-serif` : `bold ${size}px Georgia, serif`; x.fillText(t, w / 2, h * (0.2 + i * (0.7 / text.length))); });
  else x.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

// ================= the summit plaza + Dancing Waters =================
function buildPlaza() {
  // paving around the pool (out to 7 m from its edge) and the real plaza patches from the map
  const [px0, pz0, px1, pz1] = bbox(POOL, 9);
  const pave = patch(px0, pz0, px1, pz1, 0.8, (x, z) => !inPoly(x, z, POOL) && edgeDist(POOL, x, z) < 7, (x, z) => ((Math.floor(x / 1.2) + Math.floor(z / 1.2)) & 1) ? '#c3bcae' : '#b9b2a4', 0.06);
  if (pave) { const m = new THREE.Mesh(pave, VCR); depthBias(m.material = VCR.clone(), 0.0003); m.receiveShadow = true; scene.add(m); }
  for (const pz of QE.plaza) { if (pz.p.length < 8) continue; const [a, b, c, d] = bbox(pz.p, 0.5); if (Math.hypot((a + c) / 2 - CX, (b + d) / 2 - CZ) > 260) continue; const wood = pz.s === 'wood'; const g = patch(a, b, c, d, 0.6, (x, z) => inPoly(x, z, pz.p), (x, z) => wood ? ((Math.floor(x * 2.5) & 1) ? '#8a6542' : '#7d5a3a') : '#bdb5a6', wood ? 0.12 : 0.06); if (g) { const m = new THREE.Mesh(g, VCR.clone()); depthBias(m.material, 0.0003); m.receiveShadow = true; scene.add(m); } }
  // the pool: a basin whose water stands level a little above the highest ground inside it
  let top = -1e9; for (let i = 0; i < POOL.length; i += 2) top = Math.max(top, gy(POOL[i], POOL[i + 1])); const wl = top + 0.35;
  const shape = []; for (let i = 0; i < POOL.length - 2; i += 2) shape.push(new THREE.Vector2(POOL[i], POOL[i + 1]));
  const tris = THREE.ShapeUtils.triangulateShape(shape, []), wp = [], wi = [];
  for (const v of shape) wp.push(v.x, wl, v.y); for (const t of tris) wi.push(t[0], t[2], t[1]);
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); wg.setIndex(wi); wg.computeVertexNormals(); if (wg.attributes.normal.getY(0) < 0) { wg.setIndex(tris.flatMap(t => [t[0], t[1], t[2]])); wg.computeVertexNormals(); }
  waterTop = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: '#3b7f97', roughness: 0.06, metalness: 0.25, envMapIntensity: 1.5 })); scene.add(waterTop);
  // coping: a granite kerb all round (outer wall down to the ground, a flat cap)
  const kp = [], ki = []; const n = shape.length;
  for (let i = 0; i < n; i++) { const a = shape[i], b = shape[(i + 1) % n], dx = b.x - a.x, dz = b.y - a.y, L = Math.hypot(dx, dz) || 1, ox = dz / L * 0.45, oz = -dx / L * 0.45, base = kp.length / 3;
    for (const [x, z] of [[a.x, a.y], [b.x, b.y]]) kp.push(x, wl + 0.18, z); for (const [x, z] of [[a.x + ox, a.y + oz], [b.x + ox, b.y + oz]]) kp.push(x, wl + 0.18, z); for (const [x, z] of [[a.x + ox, a.y + oz], [b.x + ox, b.y + oz]]) kp.push(x, gy(x, z) - 0.2, z); for (const [x, z] of [[a.x, a.y], [b.x, b.y]]) kp.push(x, wl - 0.3, z);
    ki.push(base, base + 2, base + 1, base + 1, base + 2, base + 3, base + 2, base + 4, base + 3, base + 3, base + 4, base + 5, base, base + 1, base + 6, base + 1, base + 7, base + 6); }
  const kg = new THREE.BufferGeometry(); kg.setAttribute('position', new THREE.Float32BufferAttribute(kp, 3)); kg.setIndex(ki); kg.computeVertexNormals();
  scene.add(new THREE.Mesh(kg, std('#a39d93', { roughness: 0.8, side: THREE.DoubleSide })));
  // the jets: a grid over the pool, 1.2 m in from the edge (they dance in patterns: waves, rings, chequers, sparkles)
  for (let x = FX - 20; x < FX + 20; x += 2.4) for (let z = FZ - 20; z < FZ + 20; z += 2.4) if (inPoly(x, z, POOL) && edgeDist(POOL, x, z) > 1.3) jetPts.push([x, z, Math.hypot(x - FX, z - FZ)]);
  jetPts.push([FX, FZ, 0, 1]);
  jets = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.07, 1, 10, 1, true).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: '#eef9fc', transparent: true, opacity: 0.5, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide, emissive: '#bfe6f2', emissiveIntensity: 0.15 }), jetPts.length);
  jets.position.y = wl; jets.frustumCulled = false; scene.add(jets);
  jets.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(jetPts.length * 3).fill(1), 3);
}
const bbox = (p, pad = 0) => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); } return [x0 - pad, z0 - pad, x1 + pad, z1 + pad]; };

// ================= the quarry gardens =================
function buildQuarries() {
  const parts = [];
  for (const Q of QUARRIES) {
    heightAt(Q.x0 + 1, Q.z0 + 1);   // (makes sure the floor level is worked out)
    // rock: re-skin every steep part of the dug-out edge as dark basalt with columns, ledges, moss and ivy
    const [a, b, c, d] = bbox(Q.p, 6);
    const g = patch(a, b, c, d, 1.0, (x, z) => edgeDist(Q.p, x, z) < 13 && (inPoly(x, z, Q.p) || edgeDist(Q.p, x, z) < 2) && slopeAt(x, z) > 0.42,
      (x, z) => { const n = vnoise(x * 0.25, z * 0.25), m = vnoise(x * 0.07 + 9, z * 0.07), st = Math.abs(Math.sin((x * 0.9 + z * 0.43) * 2.1)), col = new THREE.Color(m > 0.64 ? '#46602f' : n > 0.66 ? '#7a736a' : st > 0.8 ? '#6a645c' : '#57524c'); col.multiplyScalar(0.78 + vnoise(x * 1.7, z * 1.7) * 0.42); return '#' + col.getHexString(); },
      0.12, (x, z) => { const along = (x * 0.9 + z * 0.43); return (Math.abs(Math.sin(along * 2.1)) * 0.35 + vnoise(x * 0.5, z * 0.5) * 0.45) * clamp(slopeAt(x, z) * 1.4 - 0.5, 0, 1); });
    if (g) { const m = new THREE.Mesh(g, VCR); m.receiveShadow = true; m.castShadow = true; scene.add(m); }
    // boulders and fallen rock along the foot of the faces
    for (let i = 0; i < Q.p.length; i += 2) {
      const j = (i + 2) % Q.p.length, L = Math.hypot(Q.p[j] - Q.p[i], Q.p[j + 1] - Q.p[i + 1]), [qx, qz] = cen(Q.p);
      for (let t = 0; t < L; t += 3.2) {
        const s = t / L, ex = Q.p[i] + (Q.p[j] - Q.p[i]) * s, ez = Q.p[i + 1] + (Q.p[j + 1] - Q.p[i + 1]) * s, dx = qx - ex, dz = qz - ez, dl = Math.hypot(dx, dz), k = hash2(Math.floor(ex * 3), Math.floor(ez * 3));
        if (k < 0.45) continue; const x = ex + dx / dl * (Q.edge + 0.5 + k * 2), z = ez + dz / dl * (Q.edge + 0.5 + k * 2); if (onPath(x, z, 0.8) || slopeAt(ex + dx / dl * 4, ez + dz / dl * 4) < 0.3) continue;
        const r = 0.5 + k * 1.1; parts.push({ geo: new THREE.DodecahedronGeometry(r, 0), c: k > 0.8 ? '#3f5a2c' : '#4a4743', x, y: gy(x, z) + r * 0.35, z, ry: k * 9, rx: k * 3, sy: 0.7, j: 0.25 }); cols.push({ x, z, r: r * 0.9, top: gy(x, z) + r }); }
    }
  }
  // OSM cliff lines outside the quarries: rocky outcrops (3 m high, stepped)
  for (const p of QE.cliff) for (let i = 0; i + 3 < p.length; i += 2) {
    const L = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]); for (let t = 0; t < L; t += 1.6) {
      const s = t / L, x = p[i] + (p[i + 2] - p[i]) * s, z = p[i + 1] + (p[i + 3] - p[i + 1]) * s;
      if (QUARRIES.some(Q => inPoly(x, z, Q.p) || edgeDist(Q.p, x, z) < 4) || onPath(x, z, 0.6)) continue;
      const k = hash2(Math.floor(x * 5), Math.floor(z * 5)), h = 1.8 + k * 1.8;
      for (let l = 0; l < 3; l++) { const r = (1.25 - l * 0.3) * (0.8 + k * 0.5); parts.push({ geo: new THREE.DodecahedronGeometry(r, 0), c: k > 0.7 && l === 2 ? '#3f5a2c' : l === 1 ? '#4d4945' : '#45423e', x: x + (hash2(l, Math.floor(x)) - 0.5) * 0.6, y: gy(x, z) - 0.3 + l * h / 3 + r * 0.4, z: z + (hash2(Math.floor(z), l) - 0.5) * 0.6, sy: 0.8, sx: 1.2, ry: k * 7 + l, j: 0.25 }); }
      cols.push({ x, z, r: 0.9, top: gy(x, z) + h - 0.4 });
    }
  }
  if (parts.length) { const m = new THREE.Mesh(merge(parts), VCR); m.castShadow = true; m.receiveShadow = true; scene.add(m); }
}

// streams + the waterfall (animated water textures), stepping stones, wooden bridge rails
function buildStreams() {
  const tex = new THREE.CanvasTexture((() => { const c = document.createElement('canvas'); c.width = 64; c.height = 256; const x = c.getContext('2d'); x.fillStyle = '#29525c'; x.fillRect(0, 0, 64, 256); for (let i = 0; i < 70; i++) { x.fillStyle = `rgba(220,238,242,${0.08 + Math.random() * 0.25})`; x.fillRect(Math.random() * 64, Math.random() * 256, 1 + Math.random() * 3, 6 + Math.random() * 30); } return c; })());
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  flowMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92 }); depthBias(flowMat, 0.0004);
  const ribbon = (pts, w, lift, mat) => {   // a strip along a polyline, draped
    const P = [], U = [], I = []; let u = 0;
    const res = []; for (let i = 0; i + 3 < pts.length; i += 2) { const L = Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]), n = Math.max(1, Math.ceil(L / 0.8)); for (let k = 0; k < n; k++) res.push([pts[i] + (pts[i + 2] - pts[i]) * k / n, pts[i + 1] + (pts[i + 3] - pts[i + 1]) * k / n]); } res.push([pts[pts.length - 2], pts[pts.length - 1]]);
    for (let i = 0; i < res.length; i++) { const a = res[Math.max(0, i - 1)], b = res[Math.min(res.length - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L; if (i) u += Math.hypot(res[i][0] - res[i - 1][0], res[i][1] - res[i - 1][1]); const ww = w * (0.8 + vnoise(u * 0.3, 3) * 0.4);
      for (const s of [-1, 1]) { const x = res[i][0] + nx * ww / 2 * s, z = res[i][1] + nz * ww / 2 * s; P.push(x, gy(x, z) + lift, z); U.push(s < 0 ? 0 : 1, -u / 6); } if (i) { const q = (i - 1) * 2; I.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); g.computeVertexNormals();
    if (g.attributes.normal.getY(0) < 0) { for (let k = 0; k < I.length; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; } g.setIndex(I); g.computeVertexNormals(); }
    const m = new THREE.Mesh(g, mat); scene.add(m); return m;
  };
  for (const s of QE.stream) { if (s.length < 4) continue; const [x, z] = cen(s); if (Math.hypot(x - CX, z - CZ) > 450) continue; ribbon(s, 1.1, 0.1, flowMat); }
  // the waterfall: tumbles down the rock face above the OSM waterfall point into a plunge pool
  fallMat = new THREE.MeshStandardMaterial({ map: tex.clone(), color: '#ffffff', roughness: 0.2, transparent: true, opacity: 0.9, emissive: '#d6eef3', emissiveIntensity: 0.55 }); fallMat.map.wrapS = fallMat.map.wrapT = THREE.RepeatWrapping; depthBias(fallMat, 0.0006);
  for (let [fx, fz] of QE.fall) {
    // climb toward the highest ground within 12 m: that's where the water comes over the edge
    let bx = fx, bz = fz, bh = gy(fx, fz); for (let a = 0; a < 6.28; a += 0.2) for (let r = 2; r <= 12; r += 1) { const x = fx + Math.cos(a) * r, z = fz + Math.sin(a) * r, h = gy(x, z) - r * 0.15; if (h > bh) { bh = h; bx = x; bz = z; } }
    // then down the quarry face: follow the steepest way down until the ground flattens out
    const path = [bx, bz, fx, fz]; let cx = fx, cz = fz;
    for (let k = 0; k < 24; k++) { let best = null, bh2 = gy(cx, cz); for (let a2 = 0; a2 < 6.28; a2 += 0.39) { const x = cx + Math.cos(a2) * 1.5, z = cz + Math.sin(a2) * 1.5, h = gy(x, z); if (h < bh2 - 0.05) { bh2 = h; best = [x, z]; } } if (!best || gy(cx, cz) - bh2 < 0.2) break; cx = best[0]; cz = best[1]; path.push(cx, cz); }
    ribbon(path, 3.0, 0.9, fallMat);
    pondAt(cx, cz, 3.6); fx = cx; fz = cz;
    const n = 120, mg = new THREE.BufferGeometry(), mp = new Float32Array(n * 3); for (let i = 0; i < n; i++) mp.set([fx + R(-2, 2), gy(fx, fz) + R(0, 2.5), fz + R(-2, 2)], i * 3);
    mg.setAttribute('position', new THREE.BufferAttribute(mp, 3)); mist = new THREE.Points(mg, new THREE.PointsMaterial({ color: '#f4fbff', size: 0.16, transparent: true, opacity: 0.3, depthWrite: false })); mist.userData = { fx, fz }; scene.add(mist);
  }
  // the quarry pond where the stream ends, + the Duck Pond area streams already come from the map
  const big = QUARRIES.find(q => /Large/.test(q.n)); if (big) { let lo = null, lh = 1e9; for (let x = big.x0; x < big.x1; x += 3) for (let z = big.z0; z < big.z1; z += 3) if (inPoly(x, z, big.p) && edgeDist(big.p, x, z) > 12 && !onPath(x, z, 3)) { const h = gy(x, z); if (h < lh) { lh = h; lo = [x, z]; } } if (lo) pondAt(lo[0], lo[1], 6.5); }
  // stepping stones across the streams
  const sp = [];
  for (const [x, z] of QE.stones) {
    let best = null, bd = 9; for (const s of QE.stream) for (let i = 0; i + 3 < s.length; i += 2) { const d = Math.hypot(s[i] - x, s[i + 1] - z); if (d < bd) { bd = d; best = [s[i + 2] - s[i], s[i + 3] - s[i + 1]]; } }
    const a = best ? Math.atan2(best[1], best[0]) + Math.PI / 2 : 0;
    for (let k = -2; k <= 2; k++) { const px = x + Math.cos(a) * k * 0.75, pz = z + Math.sin(a) * k * 0.75; sp.push({ geo: new THREE.CylinderGeometry(0.34, 0.4, 0.22, 8), c: '#8b867d', x: px, y: gy(px, pz) + 0.14, z: pz, ry: k, j: 0.2 }); }
  }
  // wooden rails on the wood footbridges (the decks themselves are drawn by city.js from the map)
  for (const b of QE.bridge) { if (b.s !== 'wood' || b.p.length < 4) continue; const [x0, z0] = b.p, x1 = b.p[b.p.length - 2], z1 = b.p[b.p.length - 1], L = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / L, dz = (z1 - z0) / L;
    for (const s of [-1, 1]) { for (let t = 0; t <= L + 0.01; t += L / Math.max(1, Math.round(L / 1.6))) { const x = x0 + dx * t - dz * 1.05 * s, z = z0 + dz * t + dx * 1.05 * s, y = Math.max(gy(x, z), gy(x0 + dx * t, z0 + dz * t)); sp.push({ geo: new THREE.BoxGeometry(0.12, 1.0, 0.12), c: '#6b4a2b', x, y: y + 0.5, z }); }
      const mx = (x0 + x1) / 2 - dz * 1.05 * s, mz = (z0 + z1) / 2 + dx * 1.05 * s, ya = Math.max(gy(x0, z0), gy(x0 - dz * s, z0 + dx * s)), yb = Math.max(gy(x1, z1), gy(x1 - dz * s, z1 + dx * s));
      sp.push({ geo: new THREE.BoxGeometry(0.1, 0.1, L + 0.3), c: '#7d5a3a', x: mx, y: (ya + yb) / 2 + 1.0, z: mz, ry: Math.atan2(dx, dz), rx: -Math.atan2(yb - ya, L) }); }
  }
  if (sp.length) { const m = new THREE.Mesh(merge(sp), VCR); m.castShadow = true; m.receiveShadow = true; scene.add(m); }
}
function pondAt(x, z, r) {
  const g = new THREE.CircleGeometry(1, 28), p = g.attributes.position; let lo = 1e9; for (let a = 0; a < 6.28; a += 0.4) lo = Math.min(lo, gy(x + Math.cos(a) * r, z + Math.sin(a) * r));
  for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getY(i), p.getX(i)), d = Math.hypot(p.getX(i), p.getY(i)), k = r * (1 + (vnoise(Math.cos(a) * 2 + x, Math.sin(a) * 2) - 0.5) * 0.4) * d, px = x + Math.cos(a) * k, pz = z + Math.sin(a) * k; p.setXYZ(i, px, gy(px, pz) + 0.14, pz); }
  g.computeVertexNormals(); if (g.attributes.normal.getY(0) < 0) { const I = g.index.array; for (let k = 0; k < I.length; k += 3) { const t = I[k + 1]; I[k + 1] = I[k + 2]; I[k + 2] = t; } g.computeVertexNormals(); }
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#2c5f6c', roughness: 0.05, metalness: 0.2, envMapIntensity: 1.3 })); depthBias(m.material, 0.0005); scene.add(m);
  const rim = []; for (let a = 0; a < 6.28; a += 0.45) { const k = r * (1.05 + (vnoise(Math.cos(a) * 2 + x, Math.sin(a) * 2) - 0.5) * 0.4), px = x + Math.cos(a) * k, pz = z + Math.sin(a) * k, s = 0.35 + hash2(Math.floor(px * 3), Math.floor(pz * 3)) * 0.45; rim.push({ geo: new THREE.DodecahedronGeometry(s, 0), c: '#5e5a54', x: px, y: gy(px, pz) + s * 0.3, z: pz, sy: 0.6, ry: a * 3, j: 0.3 }); }
  scene.add(new THREE.Mesh(merge(rim), VCR));
}

// ================= seasonal planting: quarry terraces + the Rose Garden =================
const SEASON_FLOWERS = {
  spring: ['#f6e05e', '#e53e3e', '#ed64a6', '#fbb6ce', '#ffffff', '#9f7aea', '#f6ad55'],   // tulips, daffodils, azaleas
  summer: ['#e53e3e', '#805ad5', '#ed8936', '#ffffff', '#ecc94b', '#d53f8c', '#4299e1'],   // annual bedding: begonias, salvias, marigolds
  fall: ['#dd6b20', '#c05621', '#b7791f', '#9b2c2c', '#ecc94b', '#d69e2e'],                // chrysanthemums, asters, fall leaves
  winter: ['#b83280', '#d53f8c', '#ffffff', '#702459'],                                     // heather, hellebores, ornamental kale
};
function buildPlanting() {
  for (const m of [plantMesh, roseMesh]) if (m) { scene.remove(m); m.geometry.dispose(); }
  const s = G.season || 'summer', FL = SEASON_FLOWERS[s], P = [];
  for (const Q of QUARRIES) {
    for (let x = Q.x0; x < Q.x1; x += 2.1) for (let z = Q.z0; z < Q.z1; z += 2.1) {
      const jx = x + (hash2(Math.floor(x * 7), Math.floor(z * 3)) - 0.5) * 1.6, jz = z + (hash2(Math.floor(z * 7), Math.floor(x * 3)) - 0.5) * 1.6;
      if (!inPoly(jx, jz, Q.p) || edgeDist(Q.p, jx, jz) < 1.5 || onPath(jx, jz, 1.1) || slopeAt(jx, jz) > 0.5 || nearWater(jx, jz)) continue;
      const k = hash2(Math.floor(jx * 11), Math.floor(jz * 13)), band = vnoise(jx * 0.06, jz * 0.06), y = gy(jx, jz);
      if (band > 0.62) {   // flower beds: dense low clumps in bands that follow the terraces
        const c = FL[Math.floor(vnoise(jx * 0.11, jz * 0.11) * FL.length * 0.999)];
        for (let f = 0; f < 4; f++) { const fx = jx + (hash2(f, Math.floor(jx * 9)) - 0.5) * 1.6, fz = jz + (hash2(Math.floor(jz * 9), f) - 0.5) * 1.6; P.push({ geo: new THREE.IcosahedronGeometry(0.34, 1), c: '#2f5a2a', x: fx, y: gy(fx, fz) + 0.12, z: fz, sy: 0.45, j: 0.2 }); if (!(s === 'winter' && f % 2)) for (let b = 0; b < 5; b++) P.push({ geo: new THREE.IcosahedronGeometry(0.11, 0), c, x: fx + (hash2(b, f + Math.floor(fx * 5)) - 0.5) * 0.55, y: gy(fx, fz) + 0.3 + hash2(b + 3, f) * 0.12, z: fz + (hash2(f + Math.floor(fz * 5), b) - 0.5) * 0.55, j: 0.3 }); }
      } else if (k < 0.18) {   // Japanese maple: a short trunk under flat, layered crowns (red in spring/fall, green in summer, bare-ish in winter)
        const c = s === 'fall' ? '#b91c1c' : s === 'spring' ? '#9b2c2c' : s === 'winter' ? '#5b4636' : (k < 0.09 ? '#7f1d1d' : '#4d7c2f');
        P.push({ geo: new THREE.CylinderGeometry(0.1, 0.16, 1.6, 6), c: '#4a3426', x: jx, y: y + 0.8, z: jz });
        if (s !== 'winter') for (let l = 0; l < 9; l++) { const a = l * 2.4, r = l === 0 ? 0 : 0.6 + hash2(l, Math.floor(jx)) * 0.7; P.push({ geo: new THREE.IcosahedronGeometry(0.55 + hash2(Math.floor(jz), l) * 0.35, 1), c, x: jx + Math.cos(a) * r, y: y + 1.7 + (l % 3) * 0.3 - r * 0.25, z: jz + Math.sin(a) * r, sy: 0.6, j: 0.35 }); }
      } else if (k < 0.34) {   // rhododendron / azalea mound (blooms in spring)
        const r = 0.8 + k * 2; P.push({ geo: new THREE.IcosahedronGeometry(r, 1), c: '#2d5a27', x: jx, y: y + r * 0.55, z: jz, sy: 0.75, j: 0.25 });
        if (s === 'spring') for (let f = 0; f < 8; f++) { const a = f * 0.8, fx = jx + Math.cos(a) * r * 0.8, fz = jz + Math.sin(a) * r * 0.8; P.push({ geo: new THREE.IcosahedronGeometry(0.22, 0), c: k < 0.26 ? '#e53e8a' : '#f56565', x: fx, y: y + r * 0.75 + (f % 3) * 0.12, z: fz }); }
      } else if (k < 0.44) {   // dwarf conifer (blue-green cone)
        const h = 1 + k * 2.4; P.push({ geo: new THREE.ConeGeometry(h * 0.35, h, 7), c: k < 0.39 ? '#3d6b5a' : '#4f7a3a', x: jx, y: y + h / 2, z: jz, j: 0.2 });
      } else if (k < 0.5) {   // ornamental grass
        P.push({ geo: new THREE.ConeGeometry(0.45, 1.1, 6, 1, true), c: s === 'winter' || s === 'fall' ? '#c9a66b' : '#8aa35a', x: jx, y: y + 0.55, z: jz, rx: Math.PI, sy: -1 });
      } else if (k < 0.62) {   // ferns / low groundcover
        P.push({ geo: new THREE.IcosahedronGeometry(0.55, 0), c: '#3c6e2c', x: jx, y: y + 0.18, z: jz, sy: 0.45, j: 0.2 });
      }
    }
  }
  plantMesh = new THREE.Mesh(merge(P), VCR); plantMesh.castShadow = true; plantMesh.receiveShadow = true; scene.add(plantMesh);
  // the Rose Garden: rows of rose bushes (blooming June–October), a white arch at the end
  const RG = QE.garden.find(g => g.n === 'Rose Garden'), RP = [];
  if (RG) {
    const [a, b, c, d] = bbox(RG.p), ROSE = ['#c53030', '#e53e3e', '#ed64a6', '#fbb6ce', '#f6e05e', '#ffffff', '#f6ad55'];
    for (let x = a; x < c; x += 1.6) for (let z = b; z < d; z += 1.6) {
      if (!inPoly(x, z, RG.p) || edgeDist(RG.p, x, z) < 1 || onPath(x, z, 0.8) || Math.floor((x + z) / 5) % 3 === 0) continue;   // beds with grass walks between
      const y = gy(x, z), k = hash2(Math.floor(x * 5), Math.floor(z * 5)), rc = ROSE[Math.floor(hash2(Math.floor(x / 5), Math.floor(z / 5)) * ROSE.length)];
      RP.push({ geo: new THREE.IcosahedronGeometry(0.5, 1), c: s === 'winter' ? '#5b4636' : '#2f5b2a', x, y: y + 0.45, z, sy: s === 'winter' ? 0.5 : 0.9, j: 0.3 });
      if (s === 'summer' || s === 'fall' || (s === 'spring' && k < 0.3)) for (let f = 0; f < (s === 'spring' ? 2 : 6); f++) { const fx = x + (hash2(f, Math.floor(x * 7)) - 0.5) * 0.9, fz = z + (hash2(Math.floor(z * 7), f) - 0.5) * 0.9; RP.push({ geo: new THREE.IcosahedronGeometry(0.12, 0), c: rc, x: fx, y: y + 0.65 + hash2(f, f + 3) * 0.35, z: fz }); }
    }
    const [rx, rz] = cen(RG.p), ry = gy(rx, rz);
    for (const s2 of [-1, 1]) RP.push({ geo: new THREE.BoxGeometry(0.15, 2.4, 0.15), c: '#f4f4f0', x: rx + s2 * 1.2, y: ry + 1.2, z: rz });
    RP.push({ geo: new THREE.TorusGeometry(1.2, 0.08, 6, 16, Math.PI), c: '#f4f4f0', x: rx, y: ry + 2.4, z: rz });
    if (s === 'summer') for (let f = 0; f < 14; f++) { const a = f / 13 * Math.PI; RP.push({ geo: new THREE.IcosahedronGeometry(0.16, 0), c: '#e53e3e', x: rx + Math.cos(a) * 1.25, y: ry + 2.4 + Math.sin(a) * 1.25, z: rz + 0.1 }); }
    roseMesh = new THREE.Mesh(merge(RP), VCR); roseMesh.castShadow = true; scene.add(roseMesh);
  }
}
function nearWater(x, z) { for (const s of QE.stream) for (let i = 0; i < s.length; i += 2) if (Math.abs(s[i] - x) < 2.2 && Math.abs(s[i + 1] - z) < 2.2) return true; return false; }

// ================= viewpoints =================
const SIGHTS = [
  ['🏙️ Downtown', 'The towers of downtown, 5 km north. Harbour Centre\'s saucer and the Vancouver House twist are easy to spot.'],
  ['🏔️ The North Shore', 'Grouse Mountain\'s ski runs, Cypress to the left, Mt Seymour to the right — and the twin peaks of The Lions on a clear day.'],
  ['🛩️ A floatplane', 'A floatplane is lifting off from Coal Harbour, right in front of the North Shore mountains.'],
  ['🦅 A bald eagle', 'A bald eagle is riding the warm air over the hill. They nest in Stanley Park.'],
  ['🚢 A cruise ship', 'A cruise ship is easing out of Canada Place toward Lions Gate Bridge.'],
  ['💍 A proposal!', 'Down by the Photo Session statue, someone just got down on one knee. She said yes!'],
  ['🏟️ BC Place', 'The white roof of BC Place stadium glows over False Creek.'],
  ['🌉 Lions Gate Bridge', 'Just visible past the downtown towers: the green suspension bridge to the North Shore.'],
];
function buildViewpoints() {
  const P = [];
  for (const [vx, vz] of QE.view) {
    // which way is "out": the steepest way down from here (the view)
    let best = 0, ba = -Math.PI / 2; for (let a = 0; a < 6.28; a += 0.2) { const d = gy(vx, vz) - gy(vx + Math.cos(a) * 12, vz + Math.sin(a) * 12) + (Math.sin(a) < 0 ? 1.5 : 0); if (d > best) { best = d; ba = a; } }
    const ux = Math.cos(ba), uz = Math.sin(ba), y0 = gy(vx, vz);
    // curved stone parapet 3 m out, with a cap
    for (let t = -0.85; t <= 0.85; t += 0.17) { const a = ba + t, x = vx + Math.cos(a) * 3.2, z = vz + Math.sin(a) * 3.2, y = gy(x, z); P.push({ geo: new THREE.BoxGeometry(0.45, 0.95, 0.62), c: '#9c958a', x, y: y + 0.42, z, ry: -a, j: 0.15 }, { geo: new THREE.BoxGeometry(0.55, 0.1, 0.64), c: '#b5afa4', x, y: y + 0.95, z, ry: -a }); cols.push({ x, z, r: 0.35, top: y + 1.0 }); }
    // two coin binoculars on pedestals
    const bins = [];
    for (const s of [-1, 1]) { const x = vx + ux * 2.2 - uz * 1.4 * s, z = vz + uz * 2.2 + ux * 1.4 * s, y = gy(x, z), yaw = Math.atan2(-ux, -uz);
      P.push({ geo: new THREE.CylinderGeometry(0.09, 0.13, 1.2, 8), c: '#2d5a3d', x, y: y + 0.6, z }, { geo: new THREE.BoxGeometry(0.34, 0.3, 0.5), c: '#2d5a3d', x, y: y + 1.35, z, ry: yaw }, { geo: new THREE.CylinderGeometry(0.08, 0.08, 0.3, 8), c: '#1a202c', x: x + ux * 0.28 - uz * 0.09, y: y + 1.4, z: z + uz * 0.28 + ux * 0.09, rx: Math.PI / 2, ry: yaw }, { geo: new THREE.CylinderGeometry(0.08, 0.08, 0.3, 8), c: '#1a202c', x: x + ux * 0.28 + uz * 0.09, y: y + 1.4, z: z + uz * 0.28 - ux * 0.09, rx: Math.PI / 2, ry: yaw });
      bins.push([x, z]); cols.push({ x, z, r: 0.3, top: y + 1.5 }); }
    // info board
    const bx = vx - ux * 0.5 + uz * 3.6, bz = vz - uz * 0.5 - ux * 3.6, by = gy(bx, bz);
    P.push({ geo: new THREE.BoxGeometry(0.1, 1.1, 0.1), c: '#4a3426', x: bx, y: by + 0.55, z: bz }, { geo: new THREE.BoxGeometry(1.3, 0.85, 0.08), c: '#4a3426', x: bx, y: by + 1.35, z: bz, ry: Math.atan2(ux, uz), rx: -0.35 });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.75), new THREE.MeshStandardMaterial({ map: textTex(['LITTLE MOUNTAIN · 152 m', 'The highest point in Vancouver', 'Downtown 5 km · Grouse Mtn 13 km · The Lions 23 km'], '#f1ead6', '#2d3b2f', 512, 320, 40) }));
    board.position.set(bx + ux * -0.05, by + 1.36, bz + uz * -0.05); board.rotation.order = 'YXZ'; board.rotation.set(-0.35, Math.atan2(-ux, -uz), 0); scene.add(board);
    views.push({ x: vx, z: vz, bins, yaw: Math.atan2(-ux, -uz) });
  }
  const m = new THREE.Mesh(merge(P), VCR); m.castShadow = true; m.receiveShadow = true; scene.add(m);
}
// E at the binoculars: a zoomed view for a while (A/D and the mouse look around), with a random sighting
export function qePrompt(pl) {
  if (!built || pl.vehicle || viewing) return '';
  for (const v of views) for (const [x, z] of v.bins) if (Math.hypot(pl.x - x, pl.z - z) < 1.6) {
    if (tapped('KeyE')) { if (pl.money < 1) { ui.toast('🪙 No loonie?', 'The binoculars cost $1.', 1400); return ''; } pl.money -= 1; sfx.coin?.(); viewing = { t: 0, yaw: v.yaw, x: pl.x, z: pl.z, ex: x - Math.sin(v.yaw) * 0.35, ey: gy(x, z) + 1.42, ez: z - Math.cos(v.yaw) * 0.35, pl }; pl.freeze = true; pl.noJump = true; G.camYaw = v.yaw; G.camPitch = 0.02; const s = pick(SIGHTS); ui.toast('🔭 ' + s[0], s[1], 5000); discover('qeview'); }
    return '<kbd>E</kbd> 🔭 Look through the binoculars ($1)';
  }
  return '';
}
let lastPl = null;
export function qeCamera(camera, dt) {
  if (viewing) lastPl = viewing.pl;
  if (viewing) {   // looking through the eyepiece: the camera sits in the binoculars, zoomed in
    const want = 14; camera.fov += (want - camera.fov) * Math.min(1, dt * 4); camera.updateProjectionMatrix(); viewFov = true;
    camera.position.set(viewing.ex, viewing.ey, viewing.ez); camera.rotation.set(-G.camPitch, G.camYaw, 0, 'YXZ'); camera.updateMatrixWorld(); viewing.pl.model.grp.visible = false;
  } else if (viewFov) { viewFov = false; lastPl?.model && (lastPl.model.grp.visible = true); }
}

// ================= the wedding photo shoot (surprise) =================
function spawnWedding() {
  const big = QUARRIES.find(q => /Large/.test(q.n)); if (!big) return;
  let spot = null; for (let k = 0; k < 60 && !spot; k++) { const x = big.x0 + 12 + Math.random() * (big.x1 - big.x0 - 24), z = big.z0 + 10 + Math.random() * (big.z1 - big.z0 - 20); if (inPoly(x, z, big.p) && edgeDist(big.p, x, z) > 10 && slopeAt(x, z) < 0.25 && !nearWater(x, z)) spot = [x, z]; }
  if (!spot) return;
  const skin = () => pick(['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac']);
  const bl = { skin: skin(), hair: pick(['#2b1d14', '#6b4226', '#d4a95b', '#111111']), shirt: '#fbfbf8', skirt: '#fbfbf8', hipc: '#fbfbf8', pants: null, hat: null, bag: null };
  bl.pants = bl.skin; bl.shin = bl.skin; bl.bun = bl.hair;
  const bride = makeHuman(bl), groom = makeHuman({ skin: skin(), hair: '#1b1b1b', shirt: '#1f2433', pants: '#1f2433', hat: null, bag: null });
  const pl2 = newLook(); pl2.hat = null; const photog = makeHuman({ ...pl2, shirt: '#2d3748', pants: '#1a202c' });
  const g1 = newLook(); g1.shirt = '#d6bcfa'; g1.skirt = '#d6bcfa'; g1.hipc = '#d6bcfa'; g1.pants = g1.skin; const maid = makeHuman(g1);
  const [x, z] = spot, a = Math.random() * 6.28, ux = Math.cos(a), uz = Math.sin(a);
  const put = (h, px, pz, yaw) => { h.grp.position.set(px, gy(px, pz), pz); h.grp.rotation.y = yaw; scene.add(h.grp); };
  put(bride, x - uz * 0.45, z + ux * 0.45, Math.atan2(-ux, -uz) + 0.5); put(groom, x + uz * 0.45, z - ux * 0.45, Math.atan2(-ux, -uz) - 0.5);
  const cx = x + ux * 7, cz = z + uz * 7; put(photog, cx, cz, Math.atan2(ux, uz)); put(maid, x - uz * 3.5 + ux * 2, z + ux * 3.5 + uz * 2, Math.atan2(-ux, -uz));
  const flash = new THREE.PointLight('#ffffff', 0, 12); flash.position.set(cx, gy(cx, cz) + 1.6, cz); scene.add(flash);
  wedding = { x, z, cx, cz, people: [bride, groom, photog, maid], flash, t: 0, said: false, bombed: false };
}
function dropWedding() { if (!wedding) return; for (const h of wedding.people) scene.remove(h.grp); scene.remove(wedding.flash); wedding = null; }
function updateWedding(dt, pl) {
  const day = (G.hour ?? 12) > 9.5 && (G.hour ?? 12) < 18.5 && (G.wet || 0) < 0.3, d = Math.hypot(pl.x - 370, pl.z - 4488);
  if (!wedding && day && d < 220 && weddingT <= 0) { weddingT = 600; if (Math.random() < 0.65) spawnWedding(); }
  if (wedding && (d > 320 || !day)) dropWedding();
  weddingT -= dt; if (!wedding) return;
  const w = wedding; w.t += dt;
  for (const h of w.people) { h.st.kind = 'walk'; h.st.amp = 0; h.pose(dt); }
  w.people[3].st.kind = 'wave'; w.people[3].st.amp = 1; w.people[3].st.phase += dt * 3;
  w.flash.intensity = (w.t % 4) < 0.08 ? 30 : 0; if ((w.t % 4) < dt && Math.hypot(pl.x - w.cx, pl.z - w.cz) < 25) sfx.shutter?.();
  const dw = Math.hypot(pl.x - w.x, pl.z - w.z);
  if (!w.said && dw < 18) { w.said = true; ui.toast('💍 A wedding photo shoot', 'The Quarry Garden is one of Vancouver\'s favourite wedding photo spots. Try not to walk into the shot… (or do).', 4500); }
  // photobomb: standing between the photographer and the couple
  const ax = w.cx - w.x, az = w.cz - w.z, L = Math.hypot(ax, az), t = ((pl.x - w.x) * ax + (pl.z - w.z) * az) / (L * L), off = Math.abs((pl.x - w.x) * az - (pl.z - w.z) * ax) / L;
  if (!w.bombed && t > 0.05 && t < 0.9 && off < 1.6) { w.bombed = true; w.flash.intensity = 30; sfx.shutter?.(); ui.toast('📸 PHOTOBOMB!', pick(['You are now in their wedding album forever. The bride laughs. The photographer does not.', '"Can we… get one without the stranger?" — the photographer, sighing.']), 4000); discover('photobomb'); pl.karma = (pl.karma || 0) - 1; }
}

// ================= update =================
const PARROT = ['🦜 "Hello! Hello!"', '🦜 "Pretty bird! Pretty bird!"', '🦜 "Got any crackers?"', '🦜 "Go Canucks go!"', '🦜 *does a perfect SkyTrain door chime*', '🦜 "Welcome to the jungle!"'];
const QUARRY_FACT = 'Little Mountain was quarried for basalt in the early 1900s: its rock paved Vancouver\'s first roads. The worked-out pits were turned into sunken gardens, with this waterfall pouring over the old quarry face.';
export function updateQEPark(dt, pl) {
  if (!built) return;
  if (viewing) { viewing.t += dt; if (tapped('Escape') || tapped('KeyE') && viewing.t > 0.3 || viewing.t > 14 || Math.hypot(pl.x - viewing.x, pl.z - viewing.z) > 1) { viewing = null; pl.freeze = false; pl.noJump = false; } else { if (key('KeyA')) G.camYaw += dt * 0.25; if (key('KeyD')) G.camYaw -= dt * 0.25; if (key('KeyW')) G.camPitch = Math.max(-0.3, G.camPitch - dt * 0.15); if (key('KeyS')) G.camPitch = Math.min(0.4, G.camPitch + dt * 0.15); } }
  const d = Math.hypot(pl.x - CX, pl.z - CZ); if (d > 650) return;
  const t = G.t;
  if (plantSeason !== G.season) { plantSeason = G.season; buildPlanting(); }
  glass.emissiveIntensity = 0.45 * (G.night || 0);
  for (const b of birds) {
    const u = b.userData, a = t * u.sp * u.dir + u.ph, r = u.r + Math.sin(t * 0.3 + u.ph) * 1.5;
    b.position.set(Math.cos(a) * r, floorY + u.hy + Math.sin(t * 0.8 + u.ph) * 1.2, Math.sin(a) * r);
    b.rotation.set(0, Math.atan2(-Math.sin(a) * u.dir, Math.cos(a) * u.dir), 0);
    const f = Math.sin(t * 16 + u.ph) * 0.9; u.w1.rotation.z = f; u.w2.rotation.z = -f;
  }
  // water flowing in the streams and down the waterfall; mist drifting up
  if (flowMat) flowMat.map.offset.y = (flowMat.map.offset.y + dt * 0.35) % 1;
  if (fallMat) fallMat.map.offset.y = (fallMat.map.offset.y + dt * 1.6) % 1;
  if (mist) { const p = mist.geometry.attributes.position, { fx, fz } = mist.userData, b = gy(fx, fz); for (let i = 0; i < p.count; i++) { let y = p.getY(i) + dt * 0.6; if (y > b + 3) { y = b; p.setX(i, fx + R(-2, 2)); p.setZ(i, fz + R(-2, 2)); } p.setY(i, y); } p.needsUpdate = true; }
  // Dancing Waters: a new pattern every 8 seconds (wave, rings, chequers, sparkle, all-up finale); coloured light at night
  if (d < 420) {
    const mode = Math.floor(t / 8) % 5, n = G.night || 0, c = new THREE.Color();
    for (let i = 0; i < jetPts.length; i++) {
      const [x, z, r, centre] = jetPts[i]; let h;
      if (centre) h = 4 + Math.sin(t * 1.3) * 2.5 + (mode === 4 ? 4 : 0);
      else if (mode === 0) h = 1.2 + 1.1 * Math.sin(t * 3 - (x - FX) * 0.35);
      else if (mode === 1) h = 0.4 + 2.2 * Math.max(0, Math.sin(t * 2.2 - r * 0.45));
      else if (mode === 2) h = ((Math.round((x - FX) / 2.4) + Math.round((z - FZ) / 2.4) + Math.floor(t * 1.5)) & 1) ? 2.4 : 0.3;
      else if (mode === 3) h = hash2(i, Math.floor(t * 3)) > 0.7 ? 2.8 : 0.2;
      else h = 1.2 + (t % 8) * 0.35;
      _o.position.set(x - 0, 0, z - 0); _o.rotation.set(0, 0, 0); const w = h < 0.35 ? 0 : centre ? 1.6 : 1; _o.scale.set(w, Math.max(0.01, h), w); _o.position.set(x, 0, z); _o.updateMatrix(); jets.setMatrixAt(i, _o.matrix);
      if (n > 0.2) c.setHSL((t * 0.05 + r * 0.02) % 1, 0.8, 0.5 + 0.3 * (1 - n)); else c.setRGB(1, 1, 1); jets.setColorAt(i, c);
    }
    jets.material.emissiveIntensity = 0.15 + n * 0.9; jets.instanceMatrix.needsUpdate = true; jets.instanceColor.needsUpdate = true;
  }
  // inside the dome: welcome + the talking parrot by the door
  const nowIn = d < R0 - 1 && Math.abs(pl.y - floorY) < 4;
  if (nowIn && !inside) ui.toast('🌴 Bloedel Conservatory', '26 °C and humid in here! Over 500 tropical plants and 100+ free-flying birds under 1,490 plexiglass bubbles.', 4000);
  inside = nowIn; parrotT -= dt;
  if (nowIn && parrotT < 0 && Math.random() < dt * 0.2) { parrotT = 12; ui.toast(PARROT[Math.floor(Math.random() * PARROT.length)], '', 2500); }
  // down in a quarry garden
  const q = QUARRIES.find(Q => inPoly(pl.x, pl.z, Q.p) && edgeDist(Q.p, pl.x, pl.z) > 6);
  if (q && !inQuarry && !pl.vehicle) { ui.toast('🪨 ' + q.n, QUARRY_FACT, 6000); discover('quarrygarden'); }
  inQuarry = !!q;
  updateWedding(dt, pl);
}
export const _qe = { get floorY() { return floorY; }, CX, CZ, R: R0, views, get wedding() { return wedding; }, spawnWedding, QUARRIES, FX, FZ };
