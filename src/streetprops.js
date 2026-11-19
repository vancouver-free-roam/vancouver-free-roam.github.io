// Street furniture near the player: traffic lights (that cycle), zebra crosswalks, stop signs, fire hydrants,
// benches, trash bins and parking meters. All instanced and rebuilt as you move around.
import * as THREE from 'three';
import { G, scene, std, hash2 } from './core.js';
import { isWater } from './terrain.js';
import { roadGrid, nodeEdges, NX, NZ, nodeY, surfaceY, walkY, buildingAt } from './city.js';
import { setColliders, fromInstances , blockedAt } from './colliders.js';

const M = window.MAP, RAD = 380;
const mk = (geo, mat, cap, color) => { const m = new THREE.InstancedMesh(geo, mat, cap); m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; if (color) m.setColorAt(0, new THREE.Color()); scene.add(m); return m; };
const metal = std('#3d4247', { metalness: 0.6, roughness: 0.45 });
const sigPole = mk(new THREE.CylinderGeometry(0.09, 0.11, 5.2, 6).translate(0, 2.6, 0), metal, 900);
const sigArm = mk(new THREE.BoxGeometry(0.12, 0.12, 1).translate(0, 5.1, 0.5), metal, 900);
const sigBox = mk(new THREE.BoxGeometry(0.36, 1.0, 0.3), std('#202326'), 900);
const sigLamp = mk(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.9 }), 900, true);
const stripe = mk(new THREE.BoxGeometry(0.5, 0.03, 3).translate(0, 0.02, 0), std('#e9e9e4', { roughness: 0.6 }), 6000);
const stopPole = mk(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 5).translate(0, 1.2, 0), metal, 800);
const stopSign = mk(new THREE.CylinderGeometry(0.38, 0.38, 0.04, 8).rotateX(Math.PI / 2).rotateZ(Math.PI / 8).translate(0, 2.3, 0), std('#c8102e', { emissive: '#3a0000' }), 800);
const hydrant = mk(new THREE.CylinderGeometry(0.14, 0.17, 0.7, 8).translate(0, 0.35, 0), std('#d62828', { roughness: 0.5 }), 1500);
const hydCap = mk(new THREE.SphereGeometry(0.15, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.7, 0), std('#f2c230'), 1500);
const benchSeat = mk(new THREE.BoxGeometry(1.6, 0.08, 0.45).translate(0, 0.45, 0), std('#7a5a3a'), 800);
const benchBack = mk(new THREE.BoxGeometry(1.6, 0.4, 0.06).translate(0, 0.75, -0.2), std('#7a5a3a'), 800);
const benchLegs = mk(new THREE.BoxGeometry(1.5, 0.45, 0.4).translate(0, 0.22, 0), std('#2b2b2b', { metalness: 0.5 }), 800);
const bin = mk(new THREE.CylinderGeometry(0.28, 0.25, 0.95, 10).translate(0, 0.48, 0), std('#2f5d3a', { metalness: 0.3 }), 1200);
const meter = mk(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 5).translate(0, 0.6, 0), metal, 3000);
const meterHead = mk(new THREE.BoxGeometry(0.2, 0.3, 0.14).translate(0, 1.3, 0), std('#9aa3ab', { metalness: 0.7 }), 3000);

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler(), _c = new THREE.Color();
const put = (mesh, i, x, y, z, yaw, sx = 1, sy = 1, sz = 1) => { _e.set(0, yaw, 0); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz); _m.compose(_p, _q, _s); mesh.setMatrixAt(i, _m); };
const drive = r => r.t <= 5 && !r.b;
const free = (x, z) => !buildingAt(x, z) && !isWater(x, z);
// nothing else standing there? (trees, lamp posts, mapped benches, patio tables, and props placed earlier in this rebuild)
const taken = new Map(), tk = (x, z) => Math.floor(x / 3) * 92821 + Math.floor(z / 3);
function roomFor(x, z, r) {
  if (!free(x, z) || blockedAt(x, z, r, 'streetprops')) return false;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const q of taken.get(tk(x + i * 3, z + j * 3)) || []) if ((q[0] - x) ** 2 + (q[1] - z) ** 2 < (q[2] + r) ** 2) return false;
  return true;
}
function mark(x, z, r) { const k = tk(x, z); let a = taken.get(k); if (!a) taken.set(k, a = []); a.push([x, z, r]); }
const ground = (x, z, ny) => walkY(x, z, ny + 1.5);   // on the drawn sidewalk, not sunk into it
let cx = 1e9, cz = 1e9; const lamps = [];
export const benches = [];
export const crossings = [];   // {node, ns, ax, az, bx, bz}: crosswalks at traffic lights (people cross when that approach has red)   // {x, y, z, yaw, taken} — people sit on these   // {i, node, dir} signal lamps to animate
function rebuild(px, pz) {
  cx = px; cz = pz; lamps.length = 0; benches.length = 0; crossings.length = 0; taken.clear();
  const n = { sig: 0, st: 0, stop: 0, hyd: 0, bench: 0, bin: 0, met: 0 };
  const edges = roadGrid.near(px, pz, RAD, []), seenNode = new Set();
  for (const e of edges) {
    const r = M.roads[e.r]; if (!drive(r)) continue;
    const ax = NX(e.a), az = NZ(e.a), dx = NX(e.b) - ax, dz = NZ(e.b) - az, L = e.len || 1, ux = dx / L, uz = dz / L;
    if (Math.abs(ax - px) > RAD || Math.abs(az - pz) > RAD) continue;
    // intersections at both ends
    for (const node of [e.a, e.b]) {
      if (seenNode.has(node)) continue; seenNode.add(node);
      const inc = nodeEdges[node].filter(q => drive(M.roads[q.r]) && q.len > 8); if (inc.length < 3) continue;
      const major = inc.some(q => M.roads[q.r].t <= 4), x0 = NX(node), z0 = NZ(node), ny = nodeY[node];
      for (const q of inc) {
        const rq = M.roads[q.r], other = q.a === node ? q.b : q.a, vx = (NX(other) - x0) / q.len, vz = (NZ(other) - z0) / q.len, hw = rq.w / 2;
        // zebra crosswalk across this approach
        if (major || hash2(node, 3) < 0.5) {
          const d = hw + 2.2, cxw = x0 + vx * Math.min(d, q.len * 0.4), czw = z0 + vz * Math.min(d, q.len * 0.4), yaw = Math.atan2(vx, vz);
          if (major) crossings.push({ node, ns: Math.abs(vz) > Math.abs(vx), ax: cxw - vz * (hw + 1.3), az: czw + vx * (hw + 1.3), bx: cxw + vz * (hw + 1.3), bz: czw - vx * (hw + 1.3) });
          for (let s = -hw + 0.5; s <= hw - 0.4 && n.st < 6000; s += 1.0) { const sx = cxw - vz * s, sz = czw + vx * s; put(stripe, n.st++, sx, ground(sx, sz, ny), sz, yaw); }
        }
        // a signal (or stop sign) on the right-hand corner of each approach
        const kx = x0 + vx * (hw + 3) - vz * (hw + 1.2), kz = z0 + vz * (hw + 3) + vx * (hw + 1.2); if (!free(kx, kz)) continue; mark(kx, kz, 0.4);
        const ky = ground(kx, kz, ny), face = Math.atan2(vx, vz);
        if (major && n.sig < 900) {
          const i = n.sig++, armYaw = Math.atan2(vz, -vx);   // arm reaches out over the lane, light faces the approaching cars
          put(sigPole, i, kx, ky, kz, 0); put(sigArm, i, kx, ky, kz, armYaw);
          const hx = kx + vz * 1.0, hz = kz - vx * 1.0; put(sigBox, i, hx, ky + 4.4, hz, face); put(sigLamp, i, hx + vx * 0.16, ky + 4.4, hz + vz * 0.16, 0);
          lamps.push({ i, node, ns: Math.abs(vz) > Math.abs(vx) });
          if (hash2(node, q.len) < 0.5 && n.bin < 1200) { const bx = kx + vx * 0.9, bz = kz + vz * 0.9; if (roomFor(bx, bz, 0.35)) { mark(bx, bz, 0.35); put(bin, n.bin++, bx, ground(bx, bz, ny), bz, 0); } }
        } else if (!major && n.stop < 800) { const i = n.stop++; put(stopPole, i, kx, ky, kz, 0); put(stopSign, i, kx, ky, kz, face); }
      }
    }
    // along the street: hydrants, benches, meters
    const side = hash2(e.id, 1) < 0.5 ? 1 : -1, off = r.w / 2 + 0.9, ny0 = nodeY[e.a], ny1 = nodeY[e.b];
    for (let s = 20 + hash2(e.id, 2) * 60; s < L - 15; s += 95) {
      const x = ax + ux * s - uz * off * side, z = az + uz * s + ux * off * side; if (!roomFor(x, z, 0.35) || n.hyd >= 1500) continue; mark(x, z, 0.35);
      const y = ground(x, z, ny0 + (ny1 - ny0) * s / L); put(hydrant, n.hyd, x, y, z, 0); put(hydCap, n.hyd, x, y, z, 0); n.hyd++;
    }
    if (L > 40 && hash2(e.id, 4) < (r.t <= 3 ? 0.45 : 0.15) && n.bench < 800) {
      const s = L * (0.3 + hash2(e.id, 5) * 0.4), o = r.w / 2 + 1.6, x = ax + ux * s + uz * o * side, z = az + uz * s - ux * o * side;
      if (roomFor(x, z, 1.0)) { mark(x, z, 1.0); const y = ground(x, z, ny0 + (ny1 - ny0) * s / L), yaw = Math.atan2(-uz * side, ux * side) + Math.PI / 2; const i = n.bench++; put(benchSeat, i, x, y, z, yaw); put(benchBack, i, x, y, z, yaw); put(benchLegs, i, x, y, z, yaw); benches.push({ x, y, z, yaw, taken: 0 }); }
    }
    if (r.t >= 2 && r.t <= 4 && hash2(e.id, 6) < 0.35)   // pay parking along busy streets
      for (let s = 10; s < L - 10 && n.met < 3000; s += 7) { const o = r.w / 2 + 0.5, x = ax + ux * s - uz * o * side, z = az + uz * s + ux * o * side; if (!roomFor(x, z, 0.3)) continue; mark(x, z, 0.3); const y = ground(x, z, ny0 + (ny1 - ny0) * s / L); put(meter, n.met, x, y, z, 0); put(meterHead, n.met, x, y, z, Math.atan2(ux, uz)); n.met++; }
  }
  const set = (m, c) => { m.count = c; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; };
  for (const m of [sigPole, sigArm, sigBox, sigLamp]) set(m, n.sig);
  set(stripe, n.st); for (const m of [stopPole, stopSign]) set(m, n.stop); for (const m of [hydrant, hydCap]) set(m, n.hyd);
  for (const m of [benchSeat, benchBack, benchLegs]) set(m, n.bench); set(bin, n.bin); for (const m of [meter, meterHead]) set(m, n.met);
  const cl = []; fromInstances(sigPole, 0.15, 5, cl); fromInstances(stopPole, 0.08, 2.4, cl, { brk: 5, kind: 'tip', parts: [stopSign] }); fromInstances(hydrant, 0.22, 0.75, cl, { brk: 6, kind: 'hydrant', parts: [hydCap] }); fromInstances(benchSeat, 0.6, 0.9, cl); fromInstances(bin, 0.3, 1, cl, { brk: 4, kind: 'fly' }); fromInstances(meter, 0.08, 1.4, cl, { brk: 5, kind: 'tip', parts: [meterHead] }); setColliders('streetprops', cl);
  lastPhase = -1;
}
// is there a traffic light at this street-graph node? (same rule as the props above; cached)
const sigCache = new Map();
export function isSignalNode(node) {
  let v = sigCache.get(node);
  if (v === undefined) { const inc = nodeEdges[node].filter(q => drive(M.roads[q.r]) && q.len > 8); v = inc.length >= 3 && inc.some(q => M.roads[q.r].t <= 4); sigCache.set(node, v); }
  return v;
}
// traffic light colours: north-south and east-west approaches take turns (40 s cycle)
const GREEN = new THREE.Color('#22e05a'), YELLOW = new THREE.Color('#ffc21a'), RED = new THREE.Color('#ff2a2a');
let lastPhase = -1;
export function signalState(node, ns) { const t = ((G.t + hash2(node, 9) * 40) % 40) / 40, a = t < 0.42 ? 'g' : t < 0.5 ? 'y' : 'r'; return ns ? a : (t >= 0.5 && t < 0.92 ? 'g' : t >= 0.92 ? 'y' : 'r'); }
export function updateStreetProps(pl) {
  if (Math.abs(pl.x - cx) > 120 || Math.abs(pl.z - cz) > 120) rebuild(pl.x, pl.z);
  const ph = Math.floor(G.t * 2); if (ph === lastPhase) return; lastPhase = ph;
  for (const l of lamps) { const s = signalState(l.node, l.ns); sigLamp.setColorAt(l.i, s === 'g' ? GREEN : s === 'y' ? YELLOW : RED); }
  if (sigLamp.instanceColor) sigLamp.instanceColor.needsUpdate = true;
}
