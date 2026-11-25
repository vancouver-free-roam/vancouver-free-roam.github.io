// Street life details near the player:
//  - cars parked nose-to-tail along the curbs (instanced, real car shapes, realistic colours, gaps at hydrants/junctions)
//  - Vancouver's trolleybus overhead wires on the real trolley streets: poles on both sidewalks, span wires across the
//    street and a pair of contact wires above each direction of travel
// Both are rebuilt as you move (instanced: a handful of draw calls).
import * as THREE from 'three';
import { G, scene, std, hash2 } from './core.js';
import { groundY, isWater } from './terrain.js';
import { roadGrid, NX, NZ, nodeEdges, roadName, buildingAt, walkY } from './city.js';
import { parkedCarGeos, MODELS, makeVehicle, vehicles, crashHooks } from './vehicles.js';
import { setColliders, blockedAt } from './colliders.js';

const M = window.MAP;
const PRAD = 250, WRAD = 450, CAP = 700;
const COLS = ['#f2f2f0', '#f2f2f0', '#e9eaec', '#16181b', '#16181b', '#1f2226', '#b9bcc0', '#a7abb0', '#c6c9cc', '#6b7076', '#5a5f66', '#3d4248', '#1f3a5f', '#2b4c7e', '#8f1d21', '#a32a26', '#3b4a3f', '#6b5b45', '#e7e1d2'];
// real models parked at the curb, as common as they are on Vancouver streets (vehiclemodels.js pw weights)
const TYPES = Object.values(MODELS).filter(m => ['car', 'suv', 'pickup', 'sports'].includes(m.base) && m.pw > 0 && (m.body?.L || 4.6) < 6.0).map(m => m.id);
const CUM = []; { let a = 0; for (const t of TYPES) { a += MODELS[t].pw; CUM.push(a); } for (let i = 0; i < CUM.length; i++) CUM[i] /= a; }
const typeAt = h => { for (let i = 0; i < CUM.length; i++) if (h <= CUM[i]) return TYPES[i]; return TYPES[TYPES.length - 1]; };
const sets = {};
const o = new THREE.Object3D(), col = new THREE.Color();
function initSets() {
  const paintM = std('#ffffff', { metalness: 0.55, roughness: 0.3, envMapIntensity: 1.1 }), darkM = std('#15171a', { metalness: 0.6, roughness: 0.25 });
  for (const t of new Set(TYPES)) {
    const g = parkedCarGeos(t), mk = (geo, mat) => { const m = new THREE.InstancedMesh(geo, mat, CAP); m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; scene.add(m); return m; };
    sets[t] = { paint: mk(g.paint, paintM), dark: mk(g.dark, darkM), L: g.L, W: g.W, n: 0 };
    sets[t].paint.setColorAt(0, col.set('#fff'));
  }
}
const TROLLEY = /^(Robson Street|Davie Street|Denman Street|Granville Street|(West |East )?Hastings Street|(West |East )?Pender Street|Main Street|(West |East )?Broadway|Commercial Drive|Fraser Street|West 4th Avenue|Burrard Street|Cambie Street|Kingsway|Dunbar Street|Macdonald Street|Nanaimo Street|Victoria Drive|Oak Street|Powell Street|Cordova Street|Seymour Street|Howe Street)$/;
let poleIM = null, wireIM = null, armIM = null;
function initWires() {
  const mk = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, n); m.count = 0; m.frustumCulled = false; scene.add(m); return m; };
  poleIM = mk(new THREE.CylinderGeometry(0.11, 0.15, 1, 8).translate(0, 0.5, 0), std('#5b6168', { metalness: 0.6, roughness: 0.45 }), 4000); poleIM.castShadow = true;
  wireIM = mk(new THREE.CylinderGeometry(1, 1, 1, 4).rotateX(Math.PI / 2).translate(0, 0, 0.5), std('#202224', { metalness: 0.5, roughness: 0.5 }), 16000);
  armIM = mk(new THREE.BoxGeometry(0.06, 0.06, 1).translate(0, 0, 0.5), std('#3a3f45', { metalness: 0.5 }), 4000);
}
const seg = (im, i, ax, ay, az, bx, by, bz, r) => { const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz) || 0.01; o.position.set(ax, ay, az); o.rotation.set(-Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(dx, dz), 0, 'YXZ'); o.scale.set(r, r, L); o.updateMatrix(); im.setMatrixAt(i, o.matrix); };

let cx = 1e9, cz = 1e9, wx = 1e9, wz = 1e9;
export const parkedSpots = [];   // {x, z, yaw, t, col, S, i} of every curbside parked car near you (missions use these)
const taken = new Set();         // cars you've driven away from the curb (by place) stay gone
let coll = [];
const spotKey = (x, z) => Math.round(x) + ',' + Math.round(z);
const stillLoose = k => { const v = loose.get(k); if (v && vehicles.includes(v)) return true; loose.delete(k); return false; };
// F next to a curbside car: it becomes a real car you can drive (the parked copy disappears)
export function takeParked(px, pz, r = 4) {
  let best = null, bd = r; for (const s of parkedSpots) { const d = Math.hypot(s.x - px, s.z - pz); if (d < bd) { bd = d; best = s; } }
  if (!best) return null;
  removeSpot(best); taken.add(spotKey(best.x, best.z));
  return best;
}
function removeSpot(best) {
  o.position.set(0, -9999, 0); o.scale.set(0, 0, 0); o.updateMatrix(); best.S.paint.setMatrixAt(best.i, o.matrix); best.S.dark.setMatrixAt(best.i, o.matrix); best.S.paint.instanceMatrix.needsUpdate = best.S.dark.instanceMatrix.needsUpdate = true;
  parkedSpots.splice(parkedSpots.indexOf(best), 1);
  coll = coll.filter(c => c.spot !== best); setColliders('parked', coll);
}
// crash into a curbside car: the drawn copy is swapped for a real car right there, which the crash physics
// (vehicles.js collidePair) then shoves, spins and rocks. It stays where it ends up until you're far away.
const loose = new Map();   // spot key -> the real car standing in for it
function hitParked(c) {
  const s = c.spot; if (!parkedSpots.includes(s)) return;
  removeSpot(s);
  const v = makeVehicle(s.t, s.x, s.z, s.yaw, { color: s.col, y: walkY(s.x, s.z, groundY(s.x, s.z) + 0.5) });
  v.ai = { parked: true, e: null }; v.fromCurb = true; loose.set(spotKey(s.x, s.z), v);
  crashHooks.parked?.(v);
}
function rebuildParked(px, pz) {
  cx = px; cz = pz; parkedSpots.length = 0; for (const s of Object.values(sets)) s.n = 0;
  coll = []; const seen = new Set();
  for (const e of roadGrid.near(px, pz, PRAD, [])) {
    if (seen.has(e.id)) continue; seen.add(e.id);
    const r = M.roads[e.r]; if (r.b || r.t > 6 || r.rg || r.t < 3 && !r.o) continue;
    // how many sides can have parking and still leave two full lanes (7 m) clear down the middle — and, on two-way
    // streets, keep clear of where traffic drives (w/4 from the centre, ±1 m)
    const sides = r.o ? (r.w >= 11.6 ? 2 : r.w >= 9.3 ? 1 : 0) : (r.w >= 13.6 ? 2 : 0);   // two-way: traffic at w/4 must clear the parked cars
    if (!sides) continue;
    const ax = NX(e.a), az = NZ(e.a), L = e.len; if (L < 30) continue;
    const ux = (NX(e.b) - ax) / L, uz = (NZ(e.b) - az) / L;
    if (Math.abs(ax - px) > PRAD + 50 || Math.abs(az - pz) > PRAD + 50) continue;
    const busy = r.t <= 4, fill = busy ? 0.62 : 0.72;
    for (const side of sides === 2 ? [-1, 1] : [1]) {
      const off = r.w / 2 - 1.15;
      for (let s = 14 + hash2(e.id, side) * 4; s < L - 14; s += 6.4) {
        if (hash2(e.id * 3 + side, Math.floor(s)) > fill) continue;
        const x = ax + ux * s - uz * off * side, z = az + uz * s + ux * off * side;
        if (Math.hypot(x - px, z - pz) > PRAD || isWater(x, z) || buildingAt(x, z) || blockedAt(x, z, 2.3, 'parked') || taken.has(spotKey(x, z)) || stillLoose(spotKey(x, z))) continue;   // not in front of hydrants, poles, trees
        const t = typeAt(hash2(x * 0.7, z * 0.7)), S = sets[t]; if (S.n >= CAP) continue;
        const yaw = Math.atan2(-ux * side, -uz * side);   // parked facing the way traffic goes on that side
        const y = groundY(x, z) + 0.22;
        o.position.set(x, y, z); o.rotation.set(0, yaw, 0); o.scale.set(1, 1, 1); o.updateMatrix();
        const pal = MODELS[t].cols || COLS, paint = pal[Math.floor(hash2(z, x) * pal.length)];
        S.paint.setMatrixAt(S.n, o.matrix); S.dark.setMatrixAt(S.n, o.matrix); S.paint.setColorAt(S.n, col.set(paint));
        const spot = { x, z, yaw, t, col: paint, S, i: S.n }; S.n++;
        for (const k of [-1, 0, 1]) coll.push({ x: x + ux * k * 1.5, z: z + uz * k * 1.5, r: 1.0, top: y + 1.5, spot, onHit: hitParked });
        parkedSpots.push(spot);
      }
    }
  }
  for (const S of Object.values(sets)) { for (const m of [S.paint, S.dark]) { m.count = S.n; m.visible = S.n > 0; m.instanceMatrix.needsUpdate = true; } if (S.paint.instanceColor) S.paint.instanceColor.needsUpdate = true; }
  setColliders('parked', coll);
}
function rebuildWires(px, pz) {
  wx = px; wz = pz; let np = 0, nw = 0, na = 0; const seen = new Set();
  for (const e of roadGrid.near(px, pz, WRAD, [])) {
    if (seen.has(e.id)) continue; seen.add(e.id);
    const r = M.roads[e.r]; if (r.b || r.t > 4 || !TROLLEY.test(roadName(r))) continue;
    const ax = NX(e.a), az = NZ(e.a), L = e.len; if (L < 8) continue;
    const ux = (NX(e.b) - ax) / L, uz = (NZ(e.b) - az) / L, hw = r.w / 2;
    if (Math.hypot(ax - px, az - pz) > WRAD + L) continue;
    // contact wire pairs: over each lane direction (2-way: at ±w/4; one-way: one pair over the middle)
    const lanes = r.o ? [0] : [-r.w / 4, r.w / 4];
    const n = Math.max(1, Math.round(L / 32)), pts = [];
    for (let k = 0; k <= n; k++) { const s = L * k / n, x = ax + ux * s, z = az + uz * s; pts.push([x, z, groundY(x, z)]); }
    for (let k = 0; k <= n; k++) {
      const [x, z, g] = pts[k], hy = g + 6.1;
      if (k < n || nodeEdges[e.b].length < 3) for (const s of [-1, 1]) {   // poles on both sidewalks with a span wire between them
        const qx = x - uz * (hw + 0.9) * s, qz = z + ux * (hw + 0.9) * s; if (buildingAt(qx, qz) || np >= 4000) continue;
        o.position.set(qx, groundY(qx, qz), qz); o.rotation.set(0, 0, 0); o.scale.set(1, 7.2, 1); o.updateMatrix(); poleIM.setMatrixAt(np++, o.matrix);
      }
      if (na < 4000) seg(armIM, na++, x - uz * (hw + 0.9), hy + 0.35, z + ux * (hw + 0.9), x + uz * (hw + 0.9), hy + 0.35, z - ux * (hw + 0.9), 1);   // span wire
      if (k < n) for (const lo of lanes) for (const d of [-0.3, 0.3]) {
        const [x2, z2, g2] = pts[k + 1]; if (nw >= 16000) break;
        seg(wireIM, nw++, x - uz * (lo + d), hy, z + ux * (lo + d), x2 - uz * (lo + d), g2 + 6.1, z2 + ux * (lo + d), 0.018);
      }
    }
  }
  poleIM.count = np; wireIM.count = nw; armIM.count = na;
  for (const m of [poleIM, wireIM, armIM]) m.instanceMatrix.needsUpdate = true;
}
export function initStreetLife() { initSets(); initWires(); }
export function updateStreetLife(px, pz) {
  if (Math.hypot(px - cx, pz - cz) > 110) rebuildParked(px, pz);
  else if (Math.hypot(px - wx, pz - wz) > 150) rebuildWires(px, pz);
}
export const _street = { sets, get wires() { return wireIM?.count; }, get poles() { return poleIM?.count; } };
