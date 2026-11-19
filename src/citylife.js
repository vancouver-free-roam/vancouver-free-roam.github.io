// City life near you, part 1: the stuff lying around Vancouver's streets and lanes.
//  - Street clutter (instanced, rebuilt as you move): litter bins, newspaper boxes, Lyme e-scooters left lying on the
//    sidewalk, construction zones (cones, barriers, "ROAD WORK" signs), and in the back lanes: dumpsters, recycling carts,
//    pallets, cardboard, shopping carts, the classic curbside "FREE" mattress and couch.
//    Run into small things on foot and you kick them; hit them in a vehicle and they fly (colliders.js brk + breakables.js).
//    E: rummage in bins and dumpsters (random finds), read a newspaper headline, stand a scooter up (then ride it), push a cart…
//  - Balls: soccer balls in parks and beach balls on summer beaches that you can kick around (simple physics).
//  - Graffiti: tags on back-lane walls, dumpsters and the walls under bridges (one atlas texture, one draw call).
//  - Four big hand-placed murals: Mount Pleasant (x2), Strathcona and Gastown (skipped if an OSM mural is right there).
import * as THREE from 'three';
import { G, scene, std, hash2, R, pick, canvasTex, toXZ, tapped } from './core.js';
import { isWater, groundY } from './terrain.js';
import { roadGrid, NX, NZ, walkY, surfaceY, buildingAt, nearBuildings, nearestRoad, pois, isDriveType } from './city.js';
import { setColliders, blockedAt, collideStatic } from './colliders.js';
import { makeVehicle } from './vehicles.js';
import { peds, say } from './people.js';
import { ui } from './ui.js';
import { sfx } from './sound.js';

const M = window.MAP, RAD = 230, MOVE = 100;
let discover = () => {};
const o = new THREE.Object3D(), col = new THREE.Color(), _b = new THREE.Matrix4(), _l = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

// ---------- the kit: unit box / cylinder / cone, instanced with per-instance colours ----------
const KIT = { n: { box: 0, cyl: 0, cone: 0 } };
function kitInit() {
  const mk = (geo, cap, extra = {}) => { const m = new THREE.InstancedMesh(geo, std('#ffffff', { roughness: 0.7, ...extra }), cap); m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.setColorAt(0, col.set('#fff')); scene.add(m); return m; };
  KIT.box = mk(new THREE.BoxGeometry(1, 1, 1), 5000); KIT.cyl = mk(new THREE.CylinderGeometry(1, 1, 1, 10), 1500); KIT.cone = mk(new THREE.ConeGeometry(1, 1, 12), 900, { roughness: 0.5 });
}
// one coloured part of an item: local position/size/rotation around the item's base (x, y, z, yaw)
function part(kind, bx, by, bz, yaw, lx, ly, lz, sx, sy, sz, c, rx = 0, rz = 0, ry = 0) {
  const m = KIT[kind], i = KIT.n[kind]; if (i >= m.instanceMatrix.count) return null;
  _b.makeRotationY(yaw).setPosition(bx, by, bz); _q.setFromEuler(_e.set(rx, ry, rz)); _l.compose(_p.set(lx, ly, lz), _q, _s.set(sx, sy, sz));
  _b.multiply(_l); m.setMatrixAt(i, _b); m.setColorAt(i, col.set(c)); KIT.n[kind]++; return [m, i, m.userData.ver];
}

// ---------- what each kind of clutter looks like and how it behaves ----------
const BIN_COL = ['#1f2a24', '#22262b', '#2f4f3a'], CART_COL = ['#2b6cb0', '#2f855a', '#1a1a1a', '#718096'], DUMP_COL = ['#2f4f3a', '#1f3a5f', '#6b3a22', '#3a3f45', '#5a6b2f'];
const NEWS_COL = ['#c53030', '#2b6cb0', '#d69e2e', '#2f855a', '#e2e8f0'];
// [radius, top, break speed, 'fly'|'tip', E action]
const KINDS = {
  cone: [0.28, 0.75, 2, 'fly', 'cone'], barrier: [0.75, 1.1, 3.5, 'fly', null], sign: [0.5, 1.6, 4, 'tip', 'sign'], bin: [0.34, 0.95, 4.5, 'fly', 'rummage'],
  newsbox: [0.34, 1.05, 6, 'fly', 'news'], scooter: [0.5, 0.35, 2, 'fly', 'scooter'], cart: [0.5, 1.0, 2.5, 'fly', 'cart'], recycle: [0.42, 1.05, 3.5, 'fly', 'rummage'],
  dumpster: [1.05, 1.4, 0, 'fly', 'dumpster'], pallet: [0.6, 0.2, 2, 'fly', null], box: [0.42, 0.7, 1.6, 'fly', null], mattress: [0.95, 0.4, 0, 'fly', 'mattress'], couch: [1.0, 0.9, 0, 'fly', 'couch'],
};
function drawItem(type, x, y, z, yaw, h) {
  const P = (k, lx, ly, lz, sx, sy, sz, c, rx, rz, ry) => part(k, x, y, z, yaw, lx, ly, lz, sx, sy, sz, c, rx, rz, ry), refs = [];
  const add = r => r && refs.push(r);
  if (type === 'cone') { add(P('box', 0, 0.02, 0, 0.42, 0.04, 0.42, '#ff6a13')); add(P('cone', 0, 0.38, 0, 0.17, 0.7, 0.17, '#ff6a13')); add(P('cyl', 0, 0.42, 0, 0.115, 0.1, 0.115, '#f4f4f4')); }
  else if (type === 'barrier') { for (const s of [-0.6, 0.6]) { add(P('box', s, 0.5, 0.18, 0.06, 1.0, 0.06, '#d4d4d4', 0.3)); add(P('box', s, 0.5, -0.18, 0.06, 1.0, 0.06, '#d4d4d4', -0.3)); } add(P('box', 0, 0.85, 0, 1.45, 0.24, 0.05, h < 0.5 ? '#ff6a13' : '#f4f4f4')); add(P('box', 0, 0.55, 0, 1.45, 0.16, 0.05, h < 0.5 ? '#f4f4f4' : '#ff6a13')); }
  else if (type === 'sign') { add(P('box', 0, 0.75, 0, 0.06, 1.5, 0.06, '#9aa0a6')); add(P('box', 0, 1.35, 0.02, 0.85, 0.85, 0.04, '#ff8c1a', 0, Math.PI / 4)); add(P('box', 0, 1.35, 0.045, 0.3, 0.3, 0.01, '#1a1a1a', 0, Math.PI / 4)); }
  else if (type === 'bin') { const c = BIN_COL[Math.floor(h * 3)]; add(P('cyl', 0, 0.45, 0, 0.3, 0.9, 0.3, c)); add(P('cyl', 0, 0.93, 0, 0.33, 0.07, 0.33, '#3a3f45')); add(P('box', 0, 0.62, 0.29, 0.22, 0.12, 0.02, '#c8c8c8')); }
  else if (type === 'newsbox') { const c = NEWS_COL[Math.floor(h * 5)]; add(P('box', 0, 0.5, 0, 0.5, 1.0, 0.44, c)); add(P('box', 0, 0.72, -0.225, 0.38, 0.3, 0.02, '#cfd8dc')); add(P('box', 0, 1.02, 0, 0.54, 0.06, 0.48, '#2d3748')); }
  else if (type === 'scooter') {   // lying on its side on the sidewalk
    add(P('box', 0, 0.1, 0, 0.17, 0.06, 0.95, '#7cc242', 0, Math.PI / 2)); add(P('box', 0.32, 0.08, -0.45, 0.85, 0.04, 0.05, '#2d3748', 0, 0, 0.15)); add(P('box', 0.72, 0.1, -0.4, 0.05, 0.05, 0.45, '#1a1a1a'));
    add(P('cyl', 0, 0.1, -0.45, 0.1, 0.05, 0.1, '#1a1a1a', 0, Math.PI / 2)); add(P('cyl', 0, 0.1, 0.45, 0.1, 0.05, 0.1, '#1a1a1a', 0, Math.PI / 2));
  }
  else if (type === 'cart') {   // a shopping cart: wire basket, handle, wheels
    add(P('box', 0, 0.78, 0, 0.55, 0.42, 0.82, '#a9b1b8')); add(P('box', 0, 0.62, 0, 0.5, 0.04, 0.78, '#7d858c')); add(P('box', 0, 1.02, 0.45, 0.58, 0.05, 0.05, '#c53030'));
    for (const [sx, sz] of [[-0.22, -0.35], [0.22, -0.35], [-0.22, 0.35], [0.22, 0.35]]) { add(P('box', sx, 0.33, sz, 0.03, 0.5, 0.03, '#a9b1b8')); add(P('cyl', sx, 0.06, sz, 0.06, 0.04, 0.06, '#1a1a1a', 0, Math.PI / 2)); }
  }
  else if (type === 'recycle') { const c = CART_COL[Math.floor(h * 4)]; add(P('box', 0, 0.48, 0, 0.6, 0.92, 0.68, c)); add(P('box', 0, 0.97, 0.02, 0.64, 0.06, 0.74, c)); add(P('cyl', 0, 0.1, 0.3, 0.1, 0.62, 0.1, '#1a1a1a', 0, Math.PI / 2)); }
  else if (type === 'dumpster') { const c = DUMP_COL[Math.floor(h * 5)]; add(P('box', 0, 0.68, 0, 1.9, 1.15, 1.1, c)); add(P('box', 0, 1.3, -0.05, 1.95, 0.08, 1.2, '#1a1a1a', 0.12)); for (const s of [-0.8, 0.8]) add(P('cyl', s, 0.08, 0.4, 0.08, 0.06, 0.08, '#111', 0, Math.PI / 2)); add(P('box', 0, 0.95, 0.56, 0.6, 0.18, 0.01, '#f4f4f4')); }
  else if (type === 'pallet') { for (const s of [-0.45, 0, 0.45]) add(P('box', s, 0.06, 0, 0.12, 0.1, 1.0, '#a07a4a')); for (const s of [-0.42, -0.14, 0.14, 0.42]) add(P('box', 0, 0.13, s, 1.2, 0.03, 0.14, '#b58c58')); }
  else if (type === 'box') { const n = 1 + Math.floor(h * 3); for (let i = 0; i < n; i++) add(P('box', (hash2(h * 99, i) - 0.5) * 0.2, 0.2 + i * 0.4, 0, 0.6 - i * 0.08, 0.4, 0.5 - i * 0.05, i % 2 ? '#b08a5a' : '#c49a64', 0, 0, hash2(i, h * 50) * 0.6)); }
  else if (type === 'mattress') { add(P('box', 0, 0.12, 0, 1.4, 0.22, 1.95, '#ece6d6', 0.05)); add(P('box', 0, 0.235, 0.2, 0.8, 0.005, 0.6, '#c9b98a')); add(P('box', 0.3, 0.24, -0.5, 0.4, 0.01, 0.28, '#f4f4f4')); }
  else if (type === 'couch') { const c = pick(['#7a5c3a', '#4a5a6b', '#8a3a3a', '#6b6b4a', '#c8b89a']); add(P('box', 0, 0.3, 0, 1.9, 0.4, 0.85, c)); add(P('box', 0, 0.7, 0.33, 1.9, 0.6, 0.22, c)); for (const s of [-0.95, 0.95]) add(P('box', s, 0.5, 0, 0.18, 0.55, 0.85, c)); add(P('box', 0.2, 0.62, -0.12, 0.5, 0.35, 0.02, '#f4f1e4', -0.4)); }
  return refs;
}

// ---------- placement along the real streets and lanes ----------
let items = [], coll = [], cx = 1e9, cz = 1e9, built = false;
const smashed = new Map();   // place → time it was knocked over (stays gone for a minute, like breakables)
const keyOf = (x, z) => Math.round(x * 2) + ',' + Math.round(z * 2);
const isLane = r => r.t === 6 && !(r.n >= 0);
const supermarkets = pois.filter(p => p.k === 'shop' && /supermarket|convenience|department/.test(p.s || ''));
function free(x, z, r) { return !isWater(x, z) && !buildingAt(x, z) && !blockedAt(x, z, r + 0.15) && !items.some(it => Math.abs(it.x - x) < r + it.r && Math.abs(it.z - z) < r + it.r); }
function addItem(type, x, z, yaw, h, extra = {}) {
  const K = KINDS[type]; if (!free(x, z, K[0])) return null;
  const k = keyOf(x, z), st = smashed.get(k); if (st !== undefined && G.t - st < 60) return null;
  const y = walkY(x, z), refs = drawItem(type, x, y, z, yaw, h); if (!refs.length) return null;
  const c = { x, z, r: K[0], top: y + K[1], base: y, refs, kind: K[3] };
  if (K[2]) c.brk = K[2];
  const it = { type, x, z, y, yaw, r: K[0], c, act: K[4], key: k, h, ...extra }; items.push(it); coll.push(c); return it;
}
// graffiti quads (built into one mesh)
let gPos = [], gUv = [], gIdx = [], graffMesh = null;
function tagQuad(cx_, cy, cz, nx, nz, w, hgt, cell) {
  const rx = nz, rz = -nx, u0 = (cell % 4) / 4, v0 = 1 - (Math.floor(cell / 4) + 1) / 8, i0 = gPos.length / 3;
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { gPos.push(cx_ + rx * a * w / 2 + nx * 0.05, cy + b * hgt / 2, cz + rz * a * w / 2 + nz * 0.05); gUv.push(u0 + (a + 1) / 2 * 0.25, v0 + (b + 1) / 2 * 0.125); }
  gIdx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
}
// the building wall nearest to (x, z) that faces it, roughly parallel to (ux, uz)
function wallNear(x, z, ux, uz, dmax = 9) {
  let best = null, bd = dmax;
  for (const b of nearBuildings(x, z, dmax + 2)) {
    if (b.raised) continue; const p = b.p, n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = p[i * 2], az = p[i * 2 + 1], dx = p[j * 2] - ax, dz = p[j * 2 + 1] - az, L = Math.hypot(dx, dz); if (L < 3.5) continue;
      if (Math.abs((dx * ux + dz * uz) / L) < 0.8) continue;
      const t = Math.max(0.15, Math.min(0.85, ((x - ax) * dx + (z - az) * dz) / (L * L))), qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(x - qx, z - qz);
      if (d < 1 || d >= bd) continue;
      let nx = -dz / L, nz = dx / L; if ((x - qx) * nx + (z - qz) * nz < 0) { nx = -nx; nz = -nz; }
      bd = d; best = { x: qx, z: qz, nx, nz, L, top: b.top, b };
    }
  }
  return best;
}
function rebuild(px, pz) {
  for (const it of items) if (it.c.gone) smashed.set(it.key, G.t);
  for (const [k, t] of smashed) if (G.t - t > 70) smashed.delete(k);
  items = []; coll = []; for (const k of ['box', 'cyl', 'cone']) { KIT.n[k] = 0; KIT[k].userData.ver = (KIT[k].userData.ver || 0) + 1; }
  gPos = []; gUv = []; gIdx = [];
  const winter = G.season === 'winter';
  for (const e of roadGrid.near(px, pz, RAD, [])) {
    const r = M.roads[e.r]; if (r.b || r.t > 6 || r.t < 2) continue;
    const ax = NX(e.a), az = NZ(e.a), L = e.len || 1, ux = (NX(e.b) - ax) / L, uz = (NZ(e.b) - az) / L, he = hash2(e.a * 7 + 3, e.b * 13 + 1);
    if (Math.hypot(ax + ux * L / 2 - px, az + uz * L / 2 - pz) > RAD + L / 2) continue;
    if (isLane(r)) {   // back lanes: dumpsters, carts, pallets, mattresses… and graffiti on the walls
      for (let s = 6; s < L - 4; s += 13) {
        const h = hash2(e.a + s * 3.1, e.b - s), side = h < 0.5 ? 1 : -1, off = r.w / 2 + 0.9;
        const x = ax + ux * s - uz * off * side, z = az + uz * s + ux * off * side, yaw = Math.atan2(ux, uz);
        const h2 = hash2(e.b + s, e.a * 3 + s);
        if (h2 < 0.16) { const d = addItem('dumpster', x - uz * 0.3 * side, z + ux * 0.3 * side, yaw + (side > 0 ? Math.PI / 2 : -Math.PI / 2), h); if (d && h < 0.8) { const nx = uz * side, nz = -ux * side; tagQuad(d.x + nx * 0.56, d.y + 0.72, d.z + nz * 0.56, nx, nz, 1.5, 0.75, Math.floor(h * 997) % 32); } }
        else if (h2 < 0.34) { for (let k = 0; k < 2 + Math.floor(h * 2); k++) addItem('recycle', x + ux * k * 0.75, z + uz * k * 0.75, yaw + R(-0.2, 0.2), hash2(k, s + e.a)); }
        else if (h2 < 0.4) addItem('pallet', x, z, yaw + h, h);
        else if (h2 < 0.47) addItem('box', x, z, yaw + h * 3, h);
        else if (h2 < 0.49) addItem('mattress', x, z, yaw + 0.3, h);
        else if (h2 < 0.505) { const c = addItem('couch', x, z, yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2), h); }
        else if (h2 < 0.53) addItem('cart', x, z, yaw + h * 6, h);
        // graffiti on the garage / building wall beside the lane
        if (hash2(s * 1.7 + e.a, e.b) < 0.45) {
          const w0 = wallNear(ax + ux * s, az + uz * s, ux, uz, 9);
          if (w0) { const w = Math.min(w0.L - 0.6, 1.6 + h * 2.4), gy = walkY(w0.x + w0.nx, w0.z + w0.nz), top = Math.min(w0.top - 0.2, gy + 3.2); if (top - gy > 1.4) tagQuad(w0.x, Math.min(top - w / 4, gy + 0.6 + w / 4 + h * 0.6), w0.z, w0.nx, w0.nz, w, w / 2, Math.floor(hash2(s, e.a) * 32)); }
        }
      }
      continue;
    }
    if (!isDriveType(r.t) || r.t > 5) continue;
    // a construction zone takes over the curb lane of a few streets
    if (he < (winter ? 0.012 : 0.03) && L > 35 && r.t >= 3) {
      const side = he < 0.015 ? 1 : -1, off = r.w / 2 - 0.9, s0 = L * 0.25, s1 = Math.min(L * 0.8, s0 + 40), yaw = Math.atan2(ux, uz);
      const at = s => [ax + ux * s - uz * off * side, az + uz * s + ux * off * side];
      for (let s = s0; s <= s1; s += 3.2) { const [x, z] = at(s); addItem('cone', x, z, 0, hash2(s, he)); }
      { const [x, z] = at(s0 - 4); addItem('sign', x - uz * 0.5 * side, z + ux * 0.5 * side, yaw + (side > 0 ? 0 : Math.PI), 0, { zone: true }); }
      for (const s of [s0 + 6, s1 - 6]) { const [x, z] = at(s); addItem('barrier', x - uz * 0.4 * side, z + ux * 0.4 * side, yaw, hash2(s, 2)); }
    }
    // sidewalks: litter bins, news boxes, dumped scooters
    for (let s = 8; s < L - 6; s += 38) {
      const h = hash2(e.a * 1.3 + s, e.b * 0.7 - s), side = h < 0.5 ? 1 : -1, off = r.w / 2 + 0.75, yaw = Math.atan2(ux, uz);
      const x = ax + ux * s - uz * off * side, z = az + uz * s + ux * off * side, h2 = hash2(s + e.b, e.a);
      if (h2 < 0.05) addItem('bin', x, z, yaw, h);
      else if (h2 < 0.075 && r.t <= 4) { addItem('newsbox', x, z, yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2), h); addItem('newsbox', x + ux * 0.6, z + uz * 0.6, yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2), 1 - h); }
      else if (h2 < 0.105 && !winter) addItem('scooter', x - uz * 0.5 * side, z + ux * 0.5 * side, yaw + h * 3, h);
      else if (h2 < 0.112) addItem('box', x - uz * 0.6 * side, z + ux * 0.6 * side, yaw, h);
    }
  }
  // shopping carts abandoned around supermarkets
  for (const p of supermarkets) {
    if (Math.abs(p.x - px) > RAD || Math.abs(p.z - pz) > RAD) continue;
    const n = 1 + Math.floor(hash2(p.x, p.z) * 3);
    for (let k = 0; k < n; k++) { const a = hash2(p.x + k, p.z - k) * 6.28, d = 10 + hash2(k, p.x) * 18; addItem('cart', p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, a, hash2(k, 5)); }
  }
  // tags on the walls under bridges (and on a concrete pier wall there)
  for (const e of roadGrid.near(px, pz, RAD, [])) {
    const r = M.roads[e.r]; if (!r.b || r.t > 6) continue;
    const ax = NX(e.a), az = NZ(e.a), L = e.len || 1, ux = (NX(e.b) - ax) / L, uz = (NZ(e.b) - az) / L;
    for (let s = 10; s < L - 10; s += 30) {
      const x = ax + ux * s, z = az + uz * s, g = groundY(x, z), deck = surfaceY(x, z, 1e9); if (deck - g < 5 || deck - g > 14 || g < 0.3 || isWater(x, z)) continue;
      if (hash2(x, z) > 0.5 || nearestRoad(x, z, 6, q => q !== r && q.t <= 7)) continue;
      const y0 = walkY(x, z, g + 1);   // a pier wall across the bridge, tagged on both sides
      const P = (lx, ly, lz, sx, sy, sz, c) => part('box', x, y0, z, Math.atan2(ux, uz), lx, ly, lz, sx, sy, sz, c);
      P(0, (deck - y0 - 0.6) / 2, 0, 5.5, deck - y0 - 0.6, 0.7, '#9a9a94');
      for (const k of [-1.8, 0, 1.8]) coll.push({ x: x + uz * k, z: z - ux * k, r: 0.7, top: deck - 0.6 });
      for (const sd of [1, -1]) tagQuad(x + ux * 0.36 * sd, y0 + 1.6, z + uz * 0.36 * sd, ux * sd, uz * sd, 3.6, 1.8, Math.floor(hash2(s, sd + e.a) * 32));
    }
  }
  for (const k of ['box', 'cyl', 'cone']) { const m = KIT[k]; m.count = KIT.n[k]; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  setColliders('citylife', coll);
  if (graffMesh) { graffMesh.geometry.dispose(); scene.remove(graffMesh); graffMesh = null; }
  if (gIdx.length) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(gPos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(gUv, 2)); g.setIndex(gIdx); g.computeVertexNormals();
    graffMesh = new THREE.Mesh(g, graffMat()); graffMesh.receiveShadow = true; graffMesh.frustumCulled = false; scene.add(graffMesh);
  }
}

// ---------- graffiti atlas (32 tags, painted once) ----------
let _gm = null;
const TAGS = ['RAIN', 'VAN', 'EH?!', '604', 'ORCA', 'KOZY', 'DREB', 'GEESE', 'YVR', 'SKUNK', 'TRASH PANDA', 'MOSS', 'SALTY', 'DRIZZL', 'KITS', 'EASTVAN', 'BOWEN', 'CRUZ', 'ZEPH', 'LOL', 'NOPE', 'UMBRELLA', 'HYPE', 'BLOOP'];
function graffMat() {
  if (_gm) return _gm;
  const tex = canvasTex(1024, 1024, (c, W, H) => {
    c.clearRect(0, 0, W, H);
    const PAL = ['#ff3b6b', '#21d4fd', '#ffe600', '#7cff4f', '#b06bff', '#ff8a00', '#ffffff', '#00e0b0', '#ff5ec4', '#3a7bff'];
    for (let i = 0; i < 32; i++) {
      const x0 = (i % 4) * 256, y0 = Math.floor(i / 4) * 128, rnd = k => hash2(i * 7.7 + k, k * 3.3 + i);
      c.save(); c.beginPath(); c.rect(x0, y0, 256, 128); c.clip(); c.translate(x0 + 128, y0 + 64);
      const style = i % 8, fill = PAL[Math.floor(rnd(1) * PAL.length)], out = rnd(2) < 0.5 ? '#111' : PAL[Math.floor(rnd(3) * PAL.length)];
      if (style === 6) {   // a smiley / crown / heart throw-up
        c.lineWidth = 6; c.strokeStyle = '#111'; c.fillStyle = fill; const k = Math.floor(rnd(4) * 3);
        if (k === 0) { c.beginPath(); c.arc(0, 0, 44, 0, 6.29); c.fill(); c.stroke(); c.fillStyle = '#111'; c.fillRect(-18, -16, 8, 14); c.fillRect(10, -16, 8, 14); c.beginPath(); c.arc(0, 4, 24, 0.3, 2.8); c.stroke(); }
        else if (k === 1) { c.beginPath(); c.moveTo(-60, 30); c.lineTo(-60, -30); c.lineTo(-30, 0); c.lineTo(0, -40); c.lineTo(30, 0); c.lineTo(60, -30); c.lineTo(60, 30); c.closePath(); c.fill(); c.stroke(); }
        else { c.beginPath(); c.moveTo(0, 40); c.bezierCurveTo(-90, -20, -30, -70, 0, -25); c.bezierCurveTo(30, -70, 90, -20, 0, 40); c.fill(); c.stroke(); c.fillStyle = '#111'; c.font = 'bold 22px Arial'; c.textAlign = 'center'; c.fillText('VAN', 0, 0); }
      } else if (style === 7) {   // a stencil
        c.fillStyle = rnd(5) < 0.5 ? '#111' : '#f4f4f4'; c.font = 'bold 26px "Courier New", monospace'; c.textAlign = 'center';
        c.fillText(pick(['OBEY THE GEESE', 'RENT IS THEFT', 'STAY DRY', 'NO VIEW', 'BIKE LANE 4EVA', 'PAY MORE', 'SALMON > YOU', 'WHERE IS SUMMER']), 0, 10);
        c.beginPath(); c.arc(-90, -30, 12, 0, 6.29); c.arc(90, -30, 12, 0, 6.29); c.fill();
      } else {   // a bubble / wildstyle word with an outline, a highlight and drips
        const word = TAGS[Math.floor(rnd(6) * TAGS.length)]; let fs = 70; c.font = `900 ${fs}px "Arial Black", Impact, sans-serif`;
        while (c.measureText(word).width > 225 && fs > 26) { fs -= 4; c.font = `900 ${fs}px "Arial Black", Impact, sans-serif`; }
        c.transform(1, (rnd(7) - 0.5) * 0.3, (rnd(8) - 0.5) * 0.6, 1, 0, 0); c.textAlign = 'center'; c.textBaseline = 'middle';
        c.lineJoin = 'round'; c.lineWidth = style < 3 ? 14 : 6; c.strokeStyle = out; c.strokeText(word, 0, 4);
        if (style < 5) { const gr = c.createLinearGradient(0, -30, 0, 30); gr.addColorStop(0, fill); gr.addColorStop(1, PAL[Math.floor(rnd(9) * PAL.length)]); c.fillStyle = gr; c.fillText(word, 0, 4); c.lineWidth = 2; c.strokeStyle = '#ffffffaa'; c.strokeText(word, -2, 0); }
        else { c.lineWidth = 3; c.strokeStyle = fill; c.strokeText(word, 0, 4); }
        c.fillStyle = out; for (let k = 0; k < 6; k++) { const dx = (rnd(10 + k) - 0.5) * 200, L = 10 + rnd(20 + k) * 30; c.fillRect(dx, 26, 3, L); c.beginPath(); c.arc(dx + 1.5, 26 + L, 3, 0, 6.29); c.fill(); }
      }
      c.restore();
    }
  }, false);
  _gm = new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.08, depthWrite: false, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  return _gm;
}

// ---------- the big murals (Vancouver Mural Festival style), hand-placed ----------
const MURALS = [
  { lat: 49.2632, lon: -123.1003, name: 'Orca Sunrise', where: 'Mount Pleasant', fact: 'Since 2016 the Vancouver Mural Festival has painted hundreds of walls, most of them around Main Street in Mount Pleasant.' },
  { lat: 49.2660, lon: -123.0990, name: 'Rain City Umbrellas', where: 'Mount Pleasant', fact: 'Vancouver gets about 160 days of rain a year. Locals mostly refuse umbrellas anyway.' },
  { lat: 49.2772, lon: -123.0925, name: 'Raccoon Royalty', where: 'Strathcona', fact: 'Strathcona is Vancouver\'s oldest residential neighbourhood, full of colourful heritage houses (and raccoons).' },
  { lat: 49.2836, lon: -123.1052, name: 'Salmon Run', where: 'Gastown', fact: 'Every fall salmon still swim up streams around the city, even a few restored ones in city parks.' },
];
function muralTex(k) {
  return canvasTex(1024, 512, (c, W, H) => {
    if (k === 0) {
      const sky = c.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#ff7e5f'); sky.addColorStop(0.55, '#feb47b'); sky.addColorStop(0.56, '#1b4f72'); sky.addColorStop(1, '#0b2540'); c.fillStyle = sky; c.fillRect(0, 0, W, H);
      c.fillStyle = '#ffe28a'; c.beginPath(); c.arc(720, 230, 90, 0, 6.29); c.fill();
      for (const [y, colr, a] of [[260, '#5b3a6e', 1], [280, '#3d2a52', 1.4]]) { c.fillStyle = colr; c.beginPath(); c.moveTo(0, 290); for (let x = 0; x <= W; x += 64) c.lineTo(x, y - 80 * Math.abs(Math.sin(x * 0.006 * a + a))); c.lineTo(W, 290); c.fill(); }
      for (const [x, y, s] of [[260, 380, 1], [520, 420, 0.7]]) {
        c.save(); c.translate(x, y); c.scale(s, s); c.rotate(-0.25); c.fillStyle = '#0d0d10'; c.beginPath(); c.ellipse(0, 0, 150, 48, 0, 0, 6.29); c.fill();
        c.beginPath(); c.moveTo(-10, -40); c.lineTo(20, -150); c.lineTo(50, -40); c.fill(); c.beginPath(); c.moveTo(140, 0); c.lineTo(210, -40); c.lineTo(200, 10); c.lineTo(210, 50); c.fill();
        c.fillStyle = '#f4f4f4'; c.beginPath(); c.ellipse(-95, -12, 26, 10, -0.2, 0, 6.29); c.fill(); c.beginPath(); c.ellipse(-40, 30, 70, 14, 0, 0, 6.29); c.fill(); c.restore();
      }
      c.strokeStyle = '#ffffff55'; c.lineWidth = 4; for (let i = 0; i < 12; i++) { c.beginPath(); c.moveTo(i * 90, 320 + (i % 3) * 50); c.quadraticCurveTo(i * 90 + 40, 300 + (i % 3) * 50, i * 90 + 80, 320 + (i % 3) * 50); c.stroke(); }
    } else if (k === 1) {
      c.fillStyle = '#1d2b53'; c.fillRect(0, 0, W, H); c.strokeStyle = '#8fb3ff66'; c.lineWidth = 3;
      for (let i = 0; i < 160; i++) { const x = hash2(i, 1) * W, y = hash2(i, 2) * H; c.beginPath(); c.moveTo(x, y); c.lineTo(x - 8, y + 30); c.stroke(); }
      const P = ['#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#ff77a8', '#83769c'];
      for (let i = 0; i < 14; i++) { const x = 60 + hash2(i, 3) * (W - 120), y = 70 + hash2(i, 4) * (H - 160), r = 40 + hash2(i, 5) * 50; c.fillStyle = P[i % P.length]; c.beginPath(); c.arc(x, y, r, Math.PI, 0); c.fill(); c.strokeStyle = '#111'; c.lineWidth = 4; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + r * 0.9); c.arc(x - 9, y + r * 0.9, 9, 0, Math.PI); c.stroke(); }
      c.fillStyle = '#fff'; c.font = '900 92px "Arial Black", Impact, sans-serif'; c.textAlign = 'center'; c.fillText('RAIN CITY', W / 2, H - 40);
    } else if (k === 2) {
      const P = ['#f94144', '#f3722c', '#f9c74f', '#90be6d', '#43aa8b', '#577590']; for (let i = 0; i < 24; i++) { c.fillStyle = P[i % 6]; c.beginPath(); c.arc((i % 8) * 140 + 40, Math.floor(i / 8) * 190 + 40, 70, 0, 6.29); c.fill(); }
      c.save(); c.translate(W / 2, H / 2 + 30); c.fillStyle = '#8d9096'; c.beginPath(); c.ellipse(0, 0, 230, 190, 0, 0, 6.29); c.fill();
      for (const s of [-1, 1]) { c.beginPath(); c.moveTo(s * 120, -140); c.lineTo(s * 190, -250); c.lineTo(s * 220, -110); c.fill(); }
      c.fillStyle = '#1b1b1f'; c.beginPath(); c.ellipse(0, -30, 210, 62, 0, 0, 6.29); c.fill(); c.fillStyle = '#f2f2f2'; for (const s of [-1, 1]) { c.beginPath(); c.arc(s * 85, -30, 34, 0, 6.29); c.fill(); }
      c.fillStyle = '#111'; for (const s of [-1, 1]) { c.beginPath(); c.arc(s * 85, -28, 17, 0, 6.29); c.fill(); } c.beginPath(); c.ellipse(0, 60, 30, 20, 0, 0, 6.29); c.fill();
      c.fillStyle = '#ffd60a'; c.beginPath(); c.moveTo(-120, -175); c.lineTo(-120, -260); c.lineTo(-60, -215); c.lineTo(0, -280); c.lineTo(60, -215); c.lineTo(120, -260); c.lineTo(120, -175); c.closePath(); c.fill(); c.restore();
    } else {
      const g = c.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#0f4c5c'); g.addColorStop(1, '#2c7da0'); c.fillStyle = g; c.fillRect(0, 0, W, H);
      for (let i = 0; i < 11; i++) {
        const x = 50 + i * 90 + hash2(i, 9) * 30, y = 110 + hash2(i, 8) * 280; c.save(); c.translate(x, y); c.rotate(-0.4 + hash2(i, 7) * 0.3);
        c.fillStyle = i % 3 ? '#e85d4a' : '#c0392b'; c.beginPath(); c.ellipse(0, 0, 70, 24, 0, 0, 6.29); c.fill(); c.beginPath(); c.moveTo(60, 0); c.lineTo(100, -26); c.lineTo(100, 26); c.fill();
        c.fillStyle = '#5a7d3a'; c.beginPath(); c.ellipse(-48, 0, 26, 20, 0, 0, 6.29); c.fill(); c.fillStyle = '#111'; c.beginPath(); c.arc(-56, -6, 4, 0, 6.29); c.fill(); c.restore();
      }
      c.strokeStyle = '#ffffff40'; c.lineWidth = 6; for (let y = 40; y < H; y += 70) { c.beginPath(); for (let x = 0; x <= W; x += 20) c.lineTo(x, y + Math.sin(x * 0.02 + y) * 12); c.stroke(); }
    }
  }, false);
}
const murals = [];
function placeMurals() {
  for (const [k, m] of MURALS.entries()) {
    const [x, z] = toXZ(m.lat, m.lon); m.x = x; m.z = z; m.k = k;
    if ((M.art || []).some(a => /mural|street_art|graffiti|painting/.test(String(a.t)) && Math.hypot(a.x - x, a.z - z) < 25)) continue;   // a real OSM mural is already painted here
    let best = null, bd = 1e9;
    for (const b of nearBuildings(x, z, 70)) {
      if (b.raised || b.top - b.base < 6) continue; const p = b.p, n = p.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, ax = p[i * 2], az = p[i * 2 + 1], dx = p[j * 2] - ax, dz = p[j * 2 + 1] - az, L = Math.hypot(dx, dz); if (L < 12) continue;
        const mx = ax + dx / 2, mz = az + dz / 2; let nx = -dz / L, nz = dx / L; if ((mx - b.x) * nx + (mz - b.z) * nz < 0) { nx = -nx; nz = -nz; }
        if (buildingAt(mx + nx * 4, mz + nz * 4)) continue;   // it has to face open space (a street, a lot, a lane)
        const d = Math.hypot(mx - x, mz - z) - L * 0.3; if (d < bd) { bd = d; best = { mx, mz, nx, nz, L, top: b.top }; }
      }
    }
    if (!best) continue;
    const gy = walkY(best.mx + best.nx, best.mz + best.nz), w = Math.min(best.L - 1, 22), h = Math.min(w / 2, best.top - gy - 0.6); if (h < 4) continue;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: muralTex(k), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    mesh.position.set(best.mx + best.nx * 0.07, gy + 0.4 + h / 2, best.mz + best.nz * 0.07); mesh.rotation.y = Math.atan2(best.nx, best.nz); mesh.receiveShadow = true; mesh.visible = false; scene.add(mesh);
    murals.push({ ...m, mesh, x: mesh.position.x, z: mesh.position.z });
  }
}

// ---------- balls: soccer balls in parks, beach balls on summer beaches ----------
const BALLS = 10, balls = [];
let soccerIM = null, beachIM = null, ballT = 0;
function initBalls() {
  const soccer = canvasTex(256, 128, (c, W, H) => { c.fillStyle = '#f4f4f4'; c.fillRect(0, 0, W, H); c.fillStyle = '#1a1a1a'; for (let i = 0; i < 12; i++) { const x = (i % 6) * 44 + (Math.floor(i / 6) ? 22 : 0) + 10, y = Math.floor(i / 6) * 60 + 30; c.beginPath(); for (let k = 0; k < 5; k++) { const a = k * 1.2566; c.lineTo(x + Math.cos(a) * 13, y + Math.sin(a) * 13); } c.fill(); } }, false);
  const beach = canvasTex(256, 64, (c, W, H) => { const P = ['#e53e3e', '#f4f4f4', '#2b6cb0', '#f6e05e', '#38a169', '#f4f4f4']; for (let i = 0; i < 6; i++) { c.fillStyle = P[i]; c.fillRect(i * W / 6, 0, W / 6 + 1, H); } c.fillStyle = '#f4f4f4'; c.fillRect(0, 0, W, 6); c.fillRect(0, H - 6, W, 6); }, false);
  const mk = (r, tex) => { const m = new THREE.InstancedMesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5 }), BALLS); m.count = 0; m.castShadow = true; m.frustumCulled = false; scene.add(m); return m; };
  soccerIM = mk(0.11, soccer); beachIM = mk(0.3, beach);
}
function spawnBall(px, pz) {
  const beachy = G.season === 'summer' && G.night < 0.3 && G.wet < 0.2;
  for (let k = 0; k < 8; k++) {
    const a = M.areas[Math.floor(Math.random() * M.areas.length)]; if (a.line || !(a.k === 'park' || a.k === 'pitch' || a.k === 'grass' || (beachy && a.k === 'beach'))) continue;
    const x = a.p[0] + R(-12, 12), z = a.p[1] + R(-12, 12), d = Math.hypot(x - px, z - pz); if (d < 25 || d > 140 || isWater(x, z) || buildingAt(x, z)) continue;
    balls.push({ x, z, y: walkY(x, z) + 1, vx: 0, vy: 0, vz: 0, beach: a.k === 'beach', spin: new THREE.Quaternion(), r: a.k === 'beach' ? 0.3 : 0.11 }); return;
  }
}
function kickBall(b, dx, dz, power) { const L = Math.hypot(dx, dz) || 1; b.vx = dx / L * power; b.vz = dz / L * power; b.vy = b.beach ? 2 + power * 0.45 : 1 + power * 0.25; sfx.thwack?.(); }
const _ax = new THREE.Vector3(), _bq = new THREE.Quaternion();
function updateBalls(dt, pl, spd) {
  ballT -= dt; if (ballT < 0) { ballT = 3; if (balls.length < (G.wet > 0.5 ? 2 : 5) && !pl.flying) spawnBall(pl.x, pl.z); }
  let ns = 0, nb = 0;
  for (let i = balls.length - 1; i >= 0; i--) {
    const b = balls[i], d = Math.hypot(b.x - pl.x, b.z - pl.z); if (d > 200) { balls.splice(i, 1); continue; }
    // you touch it: kick it the way you're going (cars kick hard)
    const reach = b.r + (pl.vehicle ? (pl.vehicle.d.r || 1) : 0.45);
    if (d < reach && Math.abs(b.y - (pl.vehicle ? pl.vehicle.y : pl.y)) < 2 && spd > 0.8) kickBall(b, b.x - pl.x + pl.dvx * 0.2, b.z - pl.z + pl.dvz * 0.2, Math.min(28, spd * (pl.vehicle ? 1.3 : 1.6) + 2));
    for (const p of peds) if (Math.abs(p.x - b.x) < 0.6 && Math.abs(p.z - b.z) < 0.6 && Math.hypot(b.vx, b.vz) < 3 && Math.random() < 0.3) { kickBall(b, b.x - p.x + R(-0.5, 0.5), b.z - p.z + R(-0.5, 0.5), R(3, 7)); if (Math.random() < 0.3) say(p, pick(['Heads up!', 'Pass!', 'Nice!', 'Oops, sorry!'])); }
    b.vy -= (b.beach ? 6 : 14) * dt; const ox = b.x, oz = b.z; b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt;
    if (buildingAt(b.x, b.z)) { b.x = ox; b.z = oz; b.vx *= -0.5; b.vz *= -0.5; }
    const gy = walkY(b.x, b.z, b.y + 0.5) + b.r;
    if (b.y < gy) { b.y = gy; b.vy = Math.abs(b.vy) > 1.2 ? -b.vy * (b.beach ? 0.55 : 0.5) : 0; const f = Math.exp(-dt * (b.beach ? 1.6 : 1.1)); b.vx *= f; b.vz *= f; }
    else { const f = Math.exp(-dt * (b.beach ? 0.8 : 0.05)); b.vx *= f; b.vz *= f; }
    if (isWater(b.x, b.z) && b.y < 0.5) { b.y = Math.max(b.y, b.r * 0.4); b.vy = 0; b.vx *= 0.98; b.vz *= 0.98; }
    const sp = Math.hypot(b.vx, b.vz); if (sp > 0.05) { _ax.set(b.vz, 0, -b.vx).normalize(); _bq.setFromAxisAngle(_ax, sp * dt / b.r); b.spin.premultiply(_bq); }
    const im = b.beach ? beachIM : soccerIM, n = b.beach ? nb++ : ns++; _b.compose(_p.set(b.x, b.y, b.z), b.spin, _s.set(1, 1, 1)); im.setMatrixAt(n, _b);
  }
  soccerIM.count = ns; beachIM.count = nb; soccerIM.instanceMatrix.needsUpdate = true; beachIM.instanceMatrix.needsUpdate = true;
}

// ---------- E: using the clutter ----------
const HEADLINES = ['"LOCAL MAN SEES SUN, CALLS 911"', '"Condo sells for $1.2M. It is a parking spot."', '"Seawall cyclist and pedestrian finally agree on something (it was the weather)"', '"Canucks win! (preseason)"', '"Goose elected to Park Board"', '"SkyTrain delayed by a very polite raccoon"', '"Expert: it will rain tomorrow. Also the day after."', '"Man finds affordable rent, wakes up"', '"Kits Beach volleyball player spikes ball into 2026"', '"Mountains \'out\' for third day in a row, city in shock"', '"Opinion: is a $9 latte too much? (It is $11 now)"', '"Film crew turns Gastown into New York again"'];
const FINDS = [
  ['🥪 Half a sandwich', 'Still in the wrapper. Probably fine. (+10 health)', pl => { pl.health = Math.min(100, pl.health + 10); }],
  ['🥫 Empty cans', 'Bottle deposit! (+$1)', pl => { pl.money += 1; }],
  ['💵 A crumpled $5 bill', 'Somebody\'s bad day is your good day. (+$5)', pl => { pl.money += 5; }],
  ['🧤 One left glove', 'Vancouver is full of single gloves. Nobody knows where the right ones go.'],
  ['📼 A VHS tape', '"Happy Gilmore". Somebody was filming it in Vancouver once. Probably.'],
  ['🧢 A Canucks toque', 'From the 2011 playoffs. It has seen things.'],
  ['🌂 Three broken umbrellas', 'The wind took them. The wind always wins.'],
  ['🍕 A pizza box', 'Empty. Except for a lonely crust. And hope.'],
  ['🦝 A RACCOON!', 'It stares at you. You stare back. It keeps eating. This is its bin now.'],
  ['📄 A lottery ticket', 'Scratched. Lost. Just like the person who threw it out.'],
];
const RARE = ['🏆 A golden pinecone trophy!', 'Engraved "Best Lane in East Van 2019". A collector paid you $100 on the spot. (+$100)'];
let lastE = 0, msgItem = null;
export function cityLifePrompt(pl) {
  if (pl.vehicle || pl.transit || G.dialogOpen) return '';
  let best = null, bd = 2.4;
  for (const it of items) { if (!it.act || it.c.gone) continue; const d = Math.hypot(it.x - pl.x, it.z - pl.z) - it.r; if (d < bd) { bd = d; best = it; } }
  for (const b of balls) { const d = Math.hypot(b.x - pl.x, b.z - pl.z) - b.r; if (d < Math.min(bd, 1.6)) { bd = d; best = { ball: b }; } }
  if (!best) return '';
  if (best.ball) { if (tapped('KeyE')) kickBall(best.ball, -Math.sin(pl.yaw), -Math.cos(pl.yaw), best.ball.beach ? 9 : 16); return `<kbd>E</kbd> ⚽ Kick the ${best.ball.beach ? 'beach ball' : 'ball'}`; }
  const it = best, used = it.used && G.t - it.used < 120;
  const label = { cone: '🚧 Knock over the cone', sign: '🚧 Read the sign', rummage: used ? '🗑️ (already rummaged)' : '🗑️ Rummage in the bin', dumpster: used ? '🗑️ (already rummaged)' : '🗑️ Dumpster dive', news: '📰 Read the headline', scooter: '🛴 Stand the scooter up', cart: '🛒 Shove the shopping cart', mattress: '🛏️ Look at the free mattress', couch: '🛋️ Sit on the curb couch' }[it.act];
  if (tapped('KeyE') && G.t - lastE > 0.3) { lastE = G.t; useItem(it, pl); }
  return `<kbd>E</kbd> ${label}`;
}
function knock(it, dx, dz, speed) { const L = Math.hypot(dx, dz) || 1; collideStatic({ x: it.c.x - dx / L * 0.01, z: it.c.z - dz / L * 0.01 }, 0.02, -1e9, Math.max(it.c.brk || 3, speed), [dx / L, dz / L]); }
function useItem(it, pl) {
  const fx = -Math.sin(pl.yaw), fz = -Math.cos(pl.yaw);
  if (it.act === 'cone') { knock(it, fx, fz, 7); ui.toast('🚧 Bonk.', pick(['A road worker sighs from somewhere.', 'The cone has been liberated.', 'Somewhere, a city engineer feels a disturbance.']), 1800); return; }
  if (it.act === 'cart') { knock(it, fx, fz, 9); ui.toast('🛒 Wheeee!', pick(['The wobbly wheel had other plans.', 'It rolls off with more purpose than most people on Granville Street.']), 1800); return; }
  if (it.act === 'sign') { ui.toast('🚧 ' + pick(['ROAD WORK AHEAD', 'LANE CLOSED · SORRY · PROBABLY UNTIL 2031', 'WATER MAIN WORK. YES, AGAIN.', 'FUTURE HOME OF ANOTHER GLASS TOWER']), pick(['Vancouver has two seasons: rain and construction.', 'The crew went for coffee in 2024.']), 3200); return; }
  if (it.act === 'news') { sfx.swing?.(); ui.toast('📰 The Daily Drizzle', pick(HEADLINES), 4200); return; }
  if (it.act === 'mattress') { ui.toast('🛏️ "FREE"', pick(['It is damp. It has a story. It is the most Vancouver thing on this street.', 'Vancouver\'s official lane decoration since 1986.']), 3500); return; }
  if (it.act === 'couch') { pl.health = Math.min(100, pl.health + 8); ui.toast('🛋️ Ahh.', 'You sit on the curb couch for a minute. A neighbour waves. It feels like home. (+8 health)', 3200); return; }
  if (it.act === 'scooter') {
    it.c.gone = true; for (const [m, i] of it.refs || it.c.refs) { m.setMatrixAt(i, ZERO); m.instanceMatrix.needsUpdate = true; } smashed.set(it.key, G.t);
    makeVehicle('scooter', it.x, it.z, it.yaw); pl.karma += 1; sfx.coin?.(); ui.toast('🛴 Good citizen!', 'You stood up a Lyme scooter somebody dumped. Press F to ride it. (+1 karma)', 3000); return;
  }
  if (it.act === 'rummage' || it.act === 'dumpster') {
    if (it.used && G.t - it.used < 120) { ui.toast('🗑️ Nothing left', 'You already went through this one.', 1500); return; }
    it.used = G.t; sfx.bump?.();
    if (G.night > 0.5 && Math.random() < 0.35) { ui.toast('🦝 HISSSS!', 'A raccoon family was having dinner in there. They are not sharing. (Respect the trash pandas.)', 3500); spawnRaccoon?.(it.x, it.z); return; }
    if (it.act === 'dumpster' && Math.random() < 0.04) { pl.money += 100; ui.toast(RARE[0], RARE[1], 4500); discover('dumpsterdive'); return; }
    const f = pick(FINDS); f[2]?.(pl); ui.toast(f[0], f[1], 3200);
    if (Math.random() < 0.3) for (const p of peds) if (Math.hypot(p.x - pl.x, p.z - pl.z) < 12) { say(p, pick(['…are you okay?', 'Find anything good?', 'That\'s MY bin, buddy.', 'Very sustainable of you.']), 2400); break; }
  }
}
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
let spawnRaccoon = null;
export function setRaccoonSpawner(fn) { spawnRaccoon = fn; }

// ---------- per frame ----------
let lx = 0, lz = 0, kickT = 0;
export function initCityLife(pl, disc) { if (disc) discover = disc; kitInit(); initBalls(); placeMurals(); }
export const cityItems = () => items;
export function updateCityLife(dt, pl) {
  if (!pl.char) return;
  const px = pl.x, pz = pl.z;
  pl.dvx = dt > 0 ? (px - lx) / dt : 0; pl.dvz = dt > 0 ? (pz - lz) / dt : 0; lx = px; lz = pz;
  let spd = Math.hypot(pl.dvx, pl.dvz); if (spd > 60) spd = 0;   // a teleport, not a run
  if (Math.hypot(px - cx, pz - cz) > MOVE || !built) { cx = px; cz = pz; built = true; rebuild(px, pz); }
  // on foot: running into small things kicks them over / away
  kickT -= dt;
  if (!pl.vehicle && !pl.transit && spd > 2.2 && kickT < 0) for (const it of items) {
    const c = it.c; if (c.gone || !c.brk) continue; const dx = c.x - px, dz = c.z - pz, d = Math.hypot(dx, dz);
    if (d < c.r + 0.6 && (dx * pl.dvx + dz * pl.dvz) > 0 && pl.y < c.top) { knock(it, pl.dvx, pl.dvz, spd * 1.5); kickT = 0.25; if (it.type === 'cone' || it.type === 'box') sfx.thwack?.(); break; }
  }
  updateBalls(dt, pl, pl.vehicle ? Math.abs(pl.vehicle.speed || 0) : spd);
  for (const m of murals) {
    const d = Math.hypot(m.x - px, m.z - pz); m.mesh.visible = d < 900;
    if (!m.seen && d < 28 && !pl.vehicle?.d?.kind?.includes?.('plane')) {
      m.seen = true; pl.stats.murals = (pl.stats.murals || 0) + 1; ui.toast('🎨 Mural: ' + m.name, m.where + '. ' + m.fact, 5000);
      if (pl.stats.murals >= 3) discover('muralhunter');
    }
  }
}
export const _citylife = { get items() { return items; }, balls, murals, KIT, rebuild: () => { built = false; } };
