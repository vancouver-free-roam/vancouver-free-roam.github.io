// Street furniture near the player: traffic lights (that cycle), zebra crosswalks, stop signs, fire hydrants,
// benches, trash bins and parking meters. All instanced and rebuilt as you move around.
import * as THREE from 'three';
import { G, scene, std, hash2 } from './core.js';
import { isWater } from './terrain.js';
import { roadGrid, nodeEdges, NX, NZ, nodeY, surfaceY, walkY, buildingAt } from './city.js';
import { setColliders, fromInstances , blockedAt } from './colliders.js';
import { bake, BX, SPs } from './tint.js';

const M = window.MAP, RAD = 380;
const mk = (geo, mat, cap, color) => { const m = new THREE.InstancedMesh(geo, mat, cap); m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; if (color) m.setColorAt(0, new THREE.Color()); scene.add(m); return m; };
// Realism pass 3 (2026-11-22): every prop is several coloured shapes merged into one vertex-coloured geometry (tint.js bake),
// modelled on Vancouver's real street furniture: galvanised signal poles with yellow signal heads on black backplates and a
// pedestrian "walk / don't walk" head, stop signs with real lettering, red hydrants with yellow bonnets and nozzle caps,
// slatted wooden benches on cast-iron frames, ribbed black litter bins with a domed lid, and pay-by-plate parking meters.
const VC = (o = {}) => new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.6, ...o });
const metal = VC({ metalness: 0.55, roughness: 0.42 }), paint = VC({ roughness: 0.5 }), wood = VC({ roughness: 0.8 });
const C = (r, h, s = 10) => new THREE.CylinderGeometry(r, r, h, s);
const GALV = '#8f969c', DARK = '#16181a', SIGY = '#e8b818';
const sigPole = mk(bake([[new THREE.CylinderGeometry(0.085, 0.12, 5.2, 12).translate(0, 2.6, 0), GALV], [C(0.2, 0.05, 12).translate(0, 0.025, 0), '#7a8086'], [C(0.13, 0.25, 12).translate(0, 0.16, 0), '#868c92'], [C(0.095, 0.1, 12).translate(0, 5.25, 0), GALV],
  [BX, DARK, 0, 2.75, -0.13, 0.26, 0.42, 0.14], [BX, '#ff8a1a', -0.055, 2.82, -0.205, 0.07, 0.09, 0.01], [BX, '#e8e8e2', 0.055, 2.68, -0.205, 0.05, 0.11, 0.01], [BX, '#5a5e62', 0, 1.1, -0.1, 0.14, 0.2, 0.08], [SPs, '#d0d0c8', 0, 1.1, -0.145, 0.03, 0.03, 0.01]], 0.06), metal, 900);   // ped head (orange hand + white walker), push button
const sigArm = mk(bake([[new THREE.CylinderGeometry(0.045, 0.075, 1.3, 10).rotateX(Math.PI / 2).translate(0, 5.1, 0.6), GALV], [new THREE.CylinderGeometry(0.02, 0.02, 1.1, 6).rotateX(0.85).translate(0, 5.42, 0.42), GALV]], 0.05), metal, 900);   // tapered mast arm + tie rod
const sigBox = mk(bake([[BX, SIGY, 0, 0, 0, 0.34, 0.98, 0.26], [BX, DARK, 0, 0, -0.14, 0.62, 1.24, 0.025], [BX, SIGY, 0, 0, -0.152, 0.66, 1.28, 0.005],
  ...[0.31, 0, -0.31].flatMap(y => [[new THREE.CylinderGeometry(0.15, 0.15, 0.2, 12, 1, true, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).translate(0, y + 0.02, 0.22), DARK], [C(0.11, 0.02, 14).rotateX(Math.PI / 2).translate(0, y, 0.135), '#2a2c2e']])]), paint, 900);   // lenses face local +z = toward the approaching cars   // yellow head, black backplate with yellow border, three visors, dark lenses
const sigLamp = mk(new THREE.CylinderGeometry(0.105, 0.105, 0.03, 14).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 1.1 }), 900, true);
const stripe = mk(new THREE.BoxGeometry(0.5, 0.03, 3).translate(0, 0.02, 0), std('#e9e9e4', { roughness: 0.6 }), 6000);
const stopPole = mk(bake([[C(0.035, 2.45, 8).translate(0, 1.22, 0), GALV], [BX, GALV, 0, 2.3, -0.04, 0.06, 0.5, 0.03]]), metal, 800);
const OCT = new THREE.CylinderGeometry(0.38, 0.38, 0.03, 8).rotateX(Math.PI / 2).rotateZ(Math.PI / 8);
const stopSign = mk(bake([[OCT, '#e8e8e4', 0, 2.3, 0, 1, 1, 1], [OCT, '#b8b8b2', 0, 2.3, -0.02, 1.02, 1.02, 1]]), paint, 800);   // white rim + grey back (the red face + letters are the texture below)
const stopTex = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d'), oct = r => { g.beginPath(); for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + i * Math.PI / 4; g.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r); } g.closePath(); };
  oct(124); g.fillStyle = '#c8102e'; g.fill(); g.fillStyle = '#ffffff'; g.font = 'bold 84px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('STOP', 128, 134); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; })();
const stopFace = mk(new THREE.PlaneGeometry(0.7, 0.7).translate(0, 2.3, 0.018), new THREE.MeshStandardMaterial({ map: stopTex, alphaTest: 0.5, transparent: false, roughness: 0.45, emissive: '#3a0000', emissiveMap: stopTex, emissiveIntensity: 0.15 }), 800);
const HRED = '#c8241e', YEL = '#e8b41a';
const hydrant = mk(bake([[C(0.2, 0.06, 12).translate(0, 0.03, 0), HRED], [new THREE.CylinderGeometry(0.135, 0.15, 0.56, 14).translate(0, 0.34, 0), HRED], [C(0.165, 0.05, 14).translate(0, 0.08, 0), HRED], [C(0.16, 0.045, 14).translate(0, 0.62, 0), HRED],
  ...[0, 1, 2, 3, 4, 5].map(i => [SPs, '#9a1a16', Math.cos(i) * 0.17, 0.085, Math.sin(i) * 0.17, 0.018, 0.018, 0.018]),
  [C(0.055, 0.12, 10).rotateZ(Math.PI / 2).translate(0.17, 0.44, 0), HRED], [C(0.055, 0.12, 10).rotateZ(Math.PI / 2).translate(-0.17, 0.44, 0), HRED], [C(0.075, 0.12, 12).rotateX(Math.PI / 2).translate(0, 0.42, -0.17), HRED]], 0.05), paint, 1500);
const hydCap = mk(bake([[new THREE.SphereGeometry(0.15, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.7, 1).translate(0, 0.64, 0), YEL], [new THREE.CylinderGeometry(0.03, 0.045, 0.06, 5).translate(0, 0.76, 0), YEL],
  [C(0.062, 0.035, 10).rotateZ(Math.PI / 2).translate(0.245, 0.44, 0), YEL], [C(0.062, 0.035, 10).rotateZ(Math.PI / 2).translate(-0.245, 0.44, 0), YEL], [C(0.085, 0.04, 12).rotateX(Math.PI / 2).translate(0, 0.42, -0.25), YEL],
  [new THREE.TorusGeometry(0.06, 0.006, 4, 10).translate(0.2, 0.37, 0.05), '#7a7a72']], 0.04), paint, 1500);   // bonnet, operating nut, nozzle caps, chain
const benchSeat = mk(bake([...[-0.16, -0.08, 0, 0.08, 0.16].map(z => [BX, '#8a6440', 0, 0.45, z, 1.7, 0.035, 0.065])], 0.18), wood, 800);   // 5 seat slats
const benchBack = mk(bake([...[0.62, 0.74, 0.86].map(y => [BX, '#8a6440', 0, y, -0.21 - (y - 0.6) * 0.18, 1.7, 0.075, 0.03, -0.18, 0, 0])], 0.18), wood, 800);   // 3 back slats, leaning back
const benchLegs = mk(bake([...[-0.72, 0.72].flatMap(x => [[BX, '#1f2224', x, 0.22, -0.13, 0.05, 0.44, 0.05], [BX, '#1f2224', x, 0.22, 0.17, 0.05, 0.44, 0.05], [BX, '#1f2224', x, 0.425, 0, 0.05, 0.04, 0.42], [BX, '#1f2224', x, 0.66, -0.24, 0.045, 0.5, 0.04, -0.18, 0, 0],
  [new THREE.TorusGeometry(0.15, 0.02, 5, 10, Math.PI).rotateY(Math.PI / 2).translate(x, 0.6, 0.02), '#1f2224']]), [BX, '#1f2224', 0, 0.2, 0.0, 1.44, 0.03, 0.03]], 0.04), metal, 800);   // cast-iron ends with curled armrests
const bin = mk(bake([[new THREE.CylinderGeometry(0.27, 0.25, 0.86, 18).translate(0, 0.45, 0), '#1c1f1d'], ...Array.from({ length: 18 }, (_, i) => { const a = i / 18 * Math.PI * 2; return [BX, '#2a2e2b', Math.cos(a) * 0.268, 0.45, Math.sin(a) * 0.268, 0.025, 0.8, 0.03, 0, -a, 0]; }),
  [new THREE.SphereGeometry(0.285, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1).translate(0, 0.88, 0), '#1c1f1d'], [BX, '#050505', 0, 0.96, -0.2, 0.26, 0.09, 0.12, -0.5, 0, 0], [C(0.27, 0.05, 18).translate(0, 0.05, 0), '#2f3330'],
  [BX, '#2b6cb0', 0, 0.66, -0.262, 0.16, 0.12, 0.01], [BX, '#f2f2ee', 0, 0.66, -0.264, 0.06, 0.05, 0.005]], 0.06), paint, 1200);   // ribbed body, domed lid with a dropping slot, a little blue recycling label
const meter = mk(bake([[C(0.04, 1.15, 8).translate(0, 0.58, 0), '#5a5e62'], [C(0.1, 0.03, 10).translate(0, 0.015, 0), '#4a4e52']]), metal, 3000);
const meterHead = mk(bake([[BX, '#3a3f44', 0, 1.33, 0, 0.22, 0.36, 0.16], [new THREE.CylinderGeometry(0.11, 0.11, 0.16, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 1.51, 0), '#3a3f44'], [BX, '#1e3a3a', 0, 1.41, -0.081, 0.15, 0.08, 0.01], [BX, '#9a9e98', 0, 1.3, -0.081, 0.12, 0.08, 0.01],
  [BX, '#111', 0, 1.22, -0.081, 0.08, 0.012, 0.012], [BX, '#2b6cb0', 0, 1.48, -0.083, 0.16, 0.035, 0.008]], 0.04), metal, 3000);   // screen, keypad, card slot, blue "Pay by plate" band

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
          const hx = kx + vz * 1.0, hz = kz - vx * 1.0; put(sigBox, i, hx, ky + 4.4, hz, face); put(sigLamp, i, hx + vx * 0.16, ky + 4.4, hz + vz * 0.16, face);
          lamps.push({ i, node, ns: Math.abs(vz) > Math.abs(vx), x: hx + vx * 0.16, y: ky + 4.4, z: hz + vz * 0.16, face });
          if (hash2(node, q.len) < 0.5 && n.bin < 1200) { const bx = kx + vx * 0.9, bz = kz + vz * 0.9; if (roomFor(bx, bz, 0.35)) { mark(bx, bz, 0.35); put(bin, n.bin++, bx, ground(bx, bz, ny), bz, 0); } }
        } else if (!major && n.stop < 800) { const i = n.stop++; put(stopPole, i, kx, ky, kz, face); put(stopSign, i, kx, ky, kz, face); put(stopFace, i, kx, ky, kz, face); }
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
  set(stripe, n.st); for (const m of [stopPole, stopSign, stopFace]) set(m, n.stop); for (const m of [hydrant, hydCap]) set(m, n.hyd);
  for (const m of [benchSeat, benchBack, benchLegs]) set(m, n.bench); set(bin, n.bin); for (const m of [meter, meterHead]) set(m, n.met);
  const cl = []; fromInstances(sigPole, 0.15, 5, cl); fromInstances(stopPole, 0.08, 2.4, cl, { brk: 5, kind: 'tip', parts: [stopSign, stopFace] }); fromInstances(hydrant, 0.22, 0.75, cl, { brk: 6, kind: 'hydrant', parts: [hydCap] }); fromInstances(benchSeat, 0.6, 0.9, cl); fromInstances(bin, 0.3, 1, cl, { brk: 4, kind: 'fly' }); fromInstances(meter, 0.08, 1.4, cl, { brk: 5, kind: 'tip', parts: [meterHead] }); setColliders('streetprops', cl);
  lastPhase = -1;
}
export const _streetprops = { lamps, benches, get center() { return [cx, cz]; } };   // for tests / screenshots
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
  // the lit lens moves: red on top, yellow in the middle, green at the bottom
  for (const l of lamps) { const s = signalState(l.node, l.ns); sigLamp.setColorAt(l.i, s === 'g' ? GREEN : s === 'y' ? YELLOW : RED); put(sigLamp, l.i, l.x, l.y + (s === 'r' ? 0.31 : s === 'g' ? -0.31 : 0), l.z, l.face); }
  if (sigLamp.instanceColor) sigLamp.instanceColor.needsUpdate = true; sigLamp.instanceMatrix.needsUpdate = true;
}
