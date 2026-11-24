// Lived-in neighbourhoods: every house near you gets what real Vancouver houses have —
//  - a raised front porch facing the street (deck, posts, a little roof), front steps and a coloured front door
//  - a concrete front walk to the sidewalk, and (on many) a picket or wood fence with a gate gap
//  - a brick chimney up one side wall, porch lights that glow at night
//  - green / black / blue city carts by the side of the house (out at the curb on garbage day)
//  - wooden power poles with crossarms and sagging lines down the back lanes
// All boxes are one instanced unit-cube mesh with per-instance colours (+ cylinders for poles / lines): a few draw calls.
import * as THREE from 'three';
import { G, scene, std, hash2 } from './core.js';
import { groundY } from './terrain.js';
import { buildings, bldGrid, nearestRoad, isDriveType, roadGrid, NX, NZ, roadName, buildingAt, inRoadway } from './city.js';
import { setColliders } from './colliders.js';
import { _fronts } from './storefronts.js';

const M = window.MAP, RAD = 230, CAP = 26000, PCAP = 1500;
let boxIM = null, cylIM = null, lineIM = null, glowIM = null;
let at = null, nb = 0, nc = 0, nl = 0, ng = 0;
const o = new THREE.Object3D(), col = new THREE.Color();
const DOOR = ['#8f1d21', '#1f3a5f', '#2f5d3a', '#1a1a1a', '#d69e2e', '#f2f2f0', '#6b4a2e', '#2b6cb0', '#9b2c6b'];
const TRIM = ['#f4f2ec', '#f4f2ec', '#e8e2d4', '#2a2a2a', '#8a8f94'];
function init() {
  const mk = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, n); m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; scene.add(m); return m; };
  boxIM = mk(new THREE.BoxGeometry(1, 1, 1), std('#ffffff', { roughness: 0.75 }), CAP); boxIM.setColorAt(0, col.set('#fff'));
  cylIM = mk(new THREE.CylinderGeometry(1, 1, 1, 7), std('#5a4330', { roughness: 0.95 }), PCAP);
  lineIM = mk(new THREE.CylinderGeometry(1, 1, 1, 4).rotateX(Math.PI / 2).translate(0, 0, 0.5), std('#1a1a1a', { roughness: 0.6 }), PCAP * 4); lineIM.castShadow = false;
  glowIM = mk(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshStandardMaterial({ color: '#fff3d0', emissive: '#ffcf7a', emissiveIntensity: 0.1 }), 2000); glowIM.castShadow = false;
}
// a box: centre (x, y, z), size (w along the yaw's local x, h, d along local z), rotated by yaw
function box(x, y, z, w, h, d, yaw, c) { if (nb >= CAP) return; o.position.set(x, y, z); o.rotation.set(0, yaw, 0); o.scale.set(w, h, d); o.updateMatrix(); boxIM.setMatrixAt(nb, o.matrix); boxIM.setColorAt(nb, col.set(c)); nb++; }
function seg(ax, ay, az, bx, by, bz, r) { if (nl >= PCAP * 4) return; const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz); o.position.set(ax, ay, az); o.rotation.set(-Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(dx, dz), 0, 'YXZ'); o.scale.set(r, r, L); o.updateMatrix(); lineIM.setMatrixAt(nl++, o.matrix); }

function frontOf(b) {   // the wall facing the nearest street: edge mid, outward normal, along-direction, length, distance to street centre
  const p = b.p, n = p.length / 2; let best = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1], L = Math.hypot(bx - ax, bz - az); if (L < 4.5) continue;
    const tx = (bx - ax) / L, tz = (bz - az) / L, mx = (ax + bx) / 2, mz = (az + bz) / 2;
    let nx = -tz, nz = tx; if ((mx - b.x) * nx + (mz - b.z) * nz < 0) { nx = -nx; nz = -nz; }
    const r = nearestRoad(mx + nx * 4, mz + nz * 4, 32, q => q.t >= 3 && q.t <= 5); if (!r) continue;
    // the road must be in front (roughly along the normal), not beside the house
    const ex = NX(r.e.a) + (NX(r.e.b) - NX(r.e.a)) * r.t, ez = NZ(r.e.a) + (NZ(r.e.b) - NZ(r.e.a)) * r.t, dx = ex - mx, dz = ez - mz, d = Math.hypot(dx, dz);
    if ((dx * nx + dz * nz) / (d || 1) < 0.75) continue;
    if (!best || d < best.d) best = { mx, mz, nx, nz, tx, tz, L, d, rw: r.road.w, rd: r };
  }
  return best;
}
let shopGrid = null;
function hasShop(b) {   // a storefront on this building = it's a shop, not a house
  if (!shopGrid) { shopGrid = new Map(); for (const f of _fronts) { const k = Math.floor(f.x / 30) * 100003 + Math.floor(f.z / 30); if (!shopGrid.has(k)) shopGrid.set(k, []); shopGrid.get(k).push(f); } }
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const f of shopGrid.get((Math.floor(b.x / 30) + i) * 100003 + Math.floor(b.z / 30) + j) || []) if (f.x > b.x0 - 3 && f.x < b.x1 + 3 && f.z > b.z0 - 3 && f.z < b.z1 + 3) return true;
  return false;
}
function decorate(b, idx) {
  if (hasShop(b)) return;
  const F = frontOf(b); if (!F) return;
  if (F.rd.road.t <= 4 && b.bt !== 1) return;   // on a main road and not mapped as a house: probably a shop or office
  const h1 = hash2(b.x * 0.73, b.z * 1.31), h2 = hash2(b.z * 0.57, b.x * 1.9), h3 = hash2(b.x + 11, b.z - 7);
  const yaw = Math.atan2(F.nx, F.nz), trim = TRIM[Math.floor(h1 * TRIM.length)], gy = groundY(F.mx, F.mz);
  const yard = F.d - (F.rw / 2 + 2.6 + 0.3);   // front yard depth (wall to sidewalk)
  // porch: raised deck + posts + roof, steps down to the yard, front door, porch light
  const side = (h2 - 0.5) * Math.max(0, F.L - 5) * 0.6, cx = F.mx + F.tx * side, cz = F.mz + F.tz * side;
  const deckH = 0.55 + h3 * 0.8, pw = Math.min(F.L - 1, 2.4 + h1 * 2), pd = 1.6 + h2 * 0.8;
  if (yard > pd + 1.5) {
    const px = cx + F.nx * pd / 2, pz = cz + F.nz * pd / 2;
    box(px, gy + deckH / 2, pz, pw, deckH, pd, yaw, h3 > 0.5 ? '#9a9a96' : '#7a5d43');   // deck (painted grey or stained wood)
    for (const s of [-1, 1]) { const qx = px + F.tx * s * (pw / 2 - 0.12) + F.nx * (pd / 2 - 0.12), qz = pz + F.tz * s * (pw / 2 - 0.12) + F.nz * (pd / 2 - 0.12); box(qx, gy + deckH + 1.25, qz, 0.18, 2.5, 0.18, yaw, trim); }
    box(px + F.nx * 0.1, gy + deckH + 2.55, pz + F.nz * 0.1, pw + 0.5, 0.16, pd + 0.4, yaw, '#4a4d52');   // porch roof
    for (const s of [-1, 1]) box(px + F.tx * s * (pw / 2 - 0.03), gy + deckH + 0.45, pz + F.tz * s * (pw / 2 - 0.03), 0.06, 0.9, pd, yaw, trim);   // side railings
    const steps = Math.max(2, Math.round(deckH / 0.19)), sw = 1.3;
    for (let k = 0; k < steps; k++) { const out = pd + 0.15 + k * 0.28, hk = deckH - (k + 1) * deckH / steps; if (hk <= 0.02) break; box(cx + F.nx * out, gy + hk / 2, cz + F.nz * out, sw, hk, 0.3, yaw, h3 > 0.5 ? '#a8a8a2' : '#7a5d43'); }
    box(cx + F.nx * 0.04, gy + deckH + 1.05, cz + F.nz * 0.04, 1.0, 2.1, 0.08, yaw, DOOR[Math.floor(h2 * DOOR.length)]);   // door
    box(cx + F.nx * 0.03, gy + deckH + 1.05, cz + F.nz * 0.03, 1.2, 2.3, 0.05, yaw, trim);   // door frame
    if (ng < 2000) { o.position.set(cx + F.nx * 0.2 + F.tx * 0.75, gy + deckH + 2.0, cz + F.nz * 0.2 + F.tz * 0.75); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); o.updateMatrix(); glowIM.setMatrixAt(ng++, o.matrix); }
    porchColl.push({ x: px, z: pz, r: Math.min(pw, pd) / 2, top: gy + deckH + 2.6 });
    // front walk from the steps to the sidewalk
    const w0 = pd + 0.15 + steps * 0.28, w1 = yard; if (w1 > w0 + 0.5) { const wl = w1 - w0, wm = (w0 + w1) / 2; box(cx + F.nx * wm, groundY(cx + F.nx * wm, cz + F.nz * wm) + 0.04, cz + F.nz * wm, 1.1, 0.08, wl, yaw, '#b5b1a7'); }
    // fence along the front of the lot, with a gap for the walk
    if (h1 < 0.55 && yard > 3) {
      const fx = cx + F.nx * (yard - 0.2), fz = cz + F.nz * (yard - 0.2), half = F.L / 2 + 2.2, picket = h1 < 0.3, fh = picket ? 0.95 : 1.15, fc = picket ? '#f2f0ea' : '#6e5440';
      for (const s of [-1, 1]) {
        const a0 = 0.7 * s, a1 = (half + Math.abs(side)) * s, mid = (a0 + a1) / 2, len = Math.abs(a1 - a0), ex = fx + F.tx * mid, ez = fz + F.tz * mid, ey = groundY(ex, ez);
        if (buildingAt(ex, ez)) continue;
        box(ex, ey + fh * 0.75, ez, len, 0.07, 0.06, yaw, fc); box(ex, ey + fh * 0.3, ez, len, 0.07, 0.06, yaw, fc);   // rails
        if (picket) for (let q = 0; q < len; q += 0.16) { const qx = fx + F.tx * (a0 + s * q), qz = fz + F.tz * (a0 + s * q); box(qx, ey + fh / 2, qz, 0.08, fh, 0.03, yaw, fc); }
        else for (let q = 0; q < len; q += 0.12) { const qx = fx + F.tx * (a0 + s * q), qz = fz + F.tz * (a0 + s * q); box(qx, ey + fh / 2, qz, 0.11, fh, 0.025, yaw, q % 0.24 < 0.12 ? fc : '#5e4636'); }
      }
    }
  }
  // brick chimney up one side wall (older houses)
  if (h2 > 0.45 && b.h > 5) { const s = h1 < 0.5 ? -1 : 1, chx = F.mx + F.tx * s * (F.L / 2 + 0.3) - F.nx * F.L * 0.25, chz = F.mz + F.tz * s * (F.L / 2 + 0.3) - F.nz * F.L * 0.25, top = b.top + 2.6; if (!buildingAt(chx + F.tx * s * 0.8, chz + F.tz * s * 0.8)) { box(chx, (gy + top) / 2, chz, 0.85, top - gy, 0.75, yaw, '#7a3b2e'); box(chx, top + 0.1, chz, 1.0, 0.2, 0.9, yaw, '#5e2c22'); } }
  // the three city carts: green (compost), black (garbage), blue (recycling) — beside the house, or out at the curb on garbage day
  if (h3 < 0.7) {
    const curbDay = ((idx + Math.floor(G.doy || 0)) % 7) === 0, s = h2 < 0.5 ? -1 : 1;
    const bx0 = curbDay ? F.mx + F.nx * (yard + 1.2) : F.mx + F.tx * s * (F.L / 2 + 0.7) + F.nx * 0.5, bz0 = curbDay ? F.mz + F.nz * (yard + 1.2) : F.mz + F.tz * s * (F.L / 2 + 0.7) + F.nz * 0.5;
    if (!buildingAt(bx0, bz0)) ['#2f7d32', '#1f1f1f', '#2b6cb0'].forEach((c, k) => { const qx = bx0 + F.tx * (k - 1) * 0.75, qz = bz0 + F.tz * (k - 1) * 0.75, qy = groundY(qx, qz) + (curbDay ? 0.16 : 0); box(qx, qy + 0.52, qz, 0.6, 1.0, 0.7, yaw, c); box(qx, qy + 1.05, qz + 0, 0.64, 0.06, 0.74, yaw, c); });
  }
}
let porchColl = [];
function laneways(px, pz) {   // power poles + lines down the back lanes (unnamed service roads)
  let np = 0; const seen = new Set();
  for (const e of roadGrid.near(px, pz, RAD, [])) {
    if (seen.has(e.id)) continue; seen.add(e.id);
    const r = M.roads[e.r]; if (r.t !== 6 || roadName(r) || r.b || r.rg) continue;
    const ax = NX(e.a), az = NZ(e.a), L = e.len; if (L < 30) continue;
    const ux = (NX(e.b) - ax) / L, uz = (NZ(e.b) - az) / L, off = r.w / 2 + 0.6, n = Math.max(1, Math.round(L / 34)), poles = [];
    for (let k = 0; k <= n; k++) { const s = L * k / n, x = ax + ux * s - uz * off, z = az + uz * s + ux * off; if (Math.hypot(x - px, z - pz) > RAD || buildingAt(x, z) || inRoadway(x, z, 0.35)) { poles.push(null); continue; } const g = groundY(x, z); poles.push([x, g + 10.4, z]);   // (inRoadway: end poles used to land in the crossing lane / street)
      if (np < PCAP) { o.position.set(x, g + 5.2, z); o.rotation.set(0, 0, 0); o.scale.set(0.15, 10.4, 0.15); o.updateMatrix(); cylIM.setMatrixAt(np++, o.matrix); }
      box(x, g + 9.9, z, 2.2, 0.12, 0.12, Math.atan2(ux, uz), '#5a4330');   // crossarm
      if (hash2(x, z) < 0.25) box(x - uz * 0.35, g + 8.4, z + ux * 0.35, 0.55, 0.9, 0.55, 0, '#7d8288');   // a transformer can
    }
    for (let k = 0; k < poles.length - 1; k++) { const A = poles[k], B = poles[k + 1]; if (!A || !B) continue; for (const lat of [-0.9, 0, 0.9]) { const sx = -uz * lat, sz = ux * lat, mx = (A[0] + B[0]) / 2 + sx, mz = (A[2] + B[2]) / 2 + sz, my = (A[1] + B[1]) / 2 - 0.55 - 0.45; seg(A[0] + sx, A[1] - 0.45, A[2] + sz, mx, my, mz, 0.012); seg(mx, my, mz, B[0] + sx, B[1] - 0.45, B[2] + sz, 0.012); } }   // lines sag in the middle
    porchColl.push(...poles.filter(Boolean).map(q => ({ x: q[0], z: q[2], r: 0.2, top: q[1] })));
  }
  return np;
}
function rebuild(px, pz) {
  at = [px, pz]; nb = nc = nl = ng = 0; porchColl = [];
  const seen = new Set(); let idx = 0;
  for (const b of bldGrid.near(px, pz, RAD, [])) { if (seen.has(b) || !b.house) continue; seen.add(b); if (Math.hypot(b.x - px, b.z - pz) > RAD) continue; decorate(b, idx++); }
  const np = laneways(px, pz);
  cylIM.count = np; boxIM.count = nb; lineIM.count = nl; glowIM.count = ng;
  for (const m of [boxIM, cylIM, lineIM, glowIM]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  setColliders('houses', porchColl);
}
export function updateHouseDetail(px, pz) {
  if (!boxIM) init();
  if (!at || Math.hypot(px - at[0], pz - at[1]) > 90) rebuild(px, pz);
  glowIM.material.emissiveIntensity = 0.1 + 2.2 * (G.night || 0);   // porch lights at night
}
export const _houses = { get boxes() { return nb; }, get poles() { return cylIM?.count; } };
