// Vehicles: models, driving / flying / boating physics, traffic and parked vehicles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, scene, clamp, R, pick, wrapAngle, std, addMesh, key, toXZ, smooth, depthBias } from './core.js';
import { heightAt, isWater, isSnow, maskAt, waterLevel } from './terrain.js';
import { edges, nodeEdges, NX, NZ, nodeY, roadGrid, surfaceY, walkY, collideBuildings, isDriveType, nearestRoad, pois, buildingAt } from './city.js';
import { scarePeds, peds, say, makeHuman, SKIN, HAIR, PANTS } from './people.js';
import { isSignalNode, signalState } from './streetprops.js';
import { collideStatic } from './colliders.js';
import { sfx, engine, beep } from './sound.js';
import { takeoff, airControl, land } from './moves.js';
import { MODELS, DEFAULT_MODEL, calibrate, longAccel } from './vehiclemodels.js';
export { MODELS };

const M = window.MAP;
export const vehicles = [];

// ---------- type definitions ----------
export const VT = {
  car:       { name: 'Car', kind: 'road', max: 42, acc: 13, turn: 0.6, r: 1.0, len: 4.4, seat: 'sitcar', snowGrip: 0.35 },
  taxi:      { name: 'Taxi', kind: 'road', max: 40, acc: 12, turn: 0.6, r: 1.0, len: 4.6, seat: 'sitcar' },
  sports:    { name: 'Sports car', kind: 'road', max: 68, acc: 24, turn: 0.55, r: 1.0, len: 4.4, seat: 'sitcar' },
  suv:       { name: 'SUV', kind: 'road', max: 40, acc: 11, turn: 0.55, r: 1.1, len: 4.8, seat: 'sitcar', snowGrip: 0.7 },
  van:       { name: 'Food truck', kind: 'road', max: 30, acc: 8, turn: 0.5, r: 1.2, len: 5.6, seat: 'sitcar' },
  bus:       { name: 'TransLynx bus', kind: 'road', max: 24, acc: 5, turn: 0.42, r: 1.4, len: 12, seat: 'sitcar' },
  motorbike: { name: 'Motorbike', kind: 'road', max: 55, acc: 22, turn: 0.75, r: 0.6, len: 2.1, seat: 'ride', show: true },
  bike:      { name: 'Mobee share bike', kind: 'road', max: 10, acc: 6, turn: 0.9, r: 0.5, len: 1.8, seat: 'ride', show: true, pedal: true },
  snowmobile: { name: 'Snowmobile', kind: 'road', max: 30, acc: 12, turn: 0.85, r: 0.9, len: 3.0, seat: 'sitcar', show: true, sitY: 0.62, hop: 7, snowGrip: 1.15 },
  skate:     { name: 'Skateboard', kind: 'road', max: 9, acc: 5, turn: 1.15, r: 0.35, len: 0.9, seat: 'board', show: true, sitY: 0.14, hop: 6.2 },
  scooter:   { name: 'Lyme e-scooter', kind: 'road', max: 9.5, acc: 5.5, turn: 1.0, r: 0.45, len: 1.2, seat: 'stand', show: true },
  jetski:    { name: 'Jet ski', kind: 'water', max: 26, acc: 10, turn: 0.9, r: 0.9, len: 3, seat: 'ride', show: true },
  heli:      { name: 'Helicopter', kind: 'heli', max: 75, acc: 14, turn: 1.2, r: 3.5, len: 11, seat: 'sitcar' },
  seaplane:  { name: 'Seaplane', kind: 'plane', max: 85, acc: 9, turn: 0.55, r: 4, len: 10, seat: 'sitcar', vr: 26, floats: true },
  cessna:    { name: 'Cessna 172', kind: 'plane', max: 70, acc: 9, turn: 0.6, r: 3.5, len: 8, seat: 'sitcar', vr: 24, gear: true },
  jet:       { name: 'Air Canuck 737', kind: 'plane', max: 210, acc: 9, turn: 0.32, r: 12, len: 38, seat: 'sitcar', vr: 65, gear: true },
  jumbo:     { name: 'Air Canuck 747 "Moose"', kind: 'plane', max: 230, acc: 9, turn: 0.26, r: 18, len: 70, seat: 'sitcar', vr: 75, gear: true },
  kayak:     { name: 'Kayak', kind: 'water', max: 4.5, acc: 2.5, turn: 1.0, r: 0.6, len: 4, seat: 'sitcar', show: true, quiet: true, sitY: 0.05 },
  sailboat:  { name: 'Sailboat', kind: 'water', max: 9, acc: 2, turn: 0.55, r: 1.5, len: 7, seat: 'sitcar', show: true, quiet: true, sitY: 0.85 },
  speedboat: { name: 'Speedboat', kind: 'water', max: 32, acc: 12, turn: 0.7, r: 1.3, len: 6, seat: 'sitcar', show: true, sitY: 0.55 },
  yacht:     { name: 'Luxury yacht', kind: 'water', max: 14, acc: 3, turn: 0.32, r: 3, len: 16, seat: 'sitcar' },
  pickup:    { name: 'Pickup truck', kind: 'road', max: 40, acc: 11, turn: 0.52, r: 1.1, len: 5.4, seat: 'sitcar', snowGrip: 0.7 },
  tug:       { name: 'Baggage tug', kind: 'road', max: 11, acc: 6, turn: 0.8, r: 1.2, len: 3, seat: 'sitcar' },
};
// real-world car colours: mostly white, black, silver and grey, with a few blues and reds
const CAR_COLS = ['#f2f2f0', '#f2f2f0', '#e9eaec', '#16181b', '#16181b', '#1f2226', '#b9bcc0', '#a7abb0', '#c6c9cc', '#6b7076', '#5a5f66', '#3d4248', '#1f3a5f', '#2b4c7e', '#8f1d21', '#a32a26', '#3b4a3f', '#6b5b45', '#e7e1d2'];

// front of the car is -z. L length, W width, belt (beltline height), nose / tail (face heights), hood (windshield start from the
// front), ws / roofL / rw (windshield, roof, rear window lengths), roofH, cw (cabin width share), wr (wheel radius), wb (axle inset)
const SPECS = {
  car:    { L: 4.55, W: 1.8, belt: 0.98, nose: 0.78, tail: 0.92, hood: 1.15, ws: 0.75, roofL: 1.45, rw: 0.62, roofH: 1.45, cw: 0.86, wr: 0.33, wb: 0.9 },
  taxi:   { L: 4.75, W: 1.82, belt: 1.0, nose: 0.8, tail: 0.94, hood: 1.15, ws: 0.75, roofL: 1.55, rw: 0.62, roofH: 1.5, cw: 0.86, wr: 0.34, wb: 0.92 },
  sports: { L: 4.45, W: 1.92, belt: 0.86, nose: 0.6, tail: 0.84, hood: 1.45, ws: 0.95, roofL: 0.85, rw: 0.95, roofH: 1.22, cw: 0.82, wr: 0.34, wb: 0.85 },
  suv:    { L: 4.8, W: 1.95, belt: 1.18, nose: 1.0, tail: 1.1, hood: 1.0, ws: 0.65, roofL: 2.35, rw: 0.25, roofH: 1.78, cw: 0.9, wr: 0.4, wb: 0.92 },
  pickup: { L: 5.5, W: 1.98, belt: 1.18, nose: 1.05, tail: 1.12, hood: 1.25, ws: 0.6, roofL: 1.35, rw: 0.12, roofH: 1.88, cw: 0.9, wr: 0.42, wb: 1.0, bed: true },
  van:    { L: 5.6, W: 2.1, belt: 1.25, nose: 1.1, tail: 2.45, hood: 0.7, ws: 0.6, roofL: 4.2, rw: 0.02, roofH: 2.5, cw: 0.98, wr: 0.4, wb: 1.0, box: true },
  bus:    { L: 12, W: 2.55, belt: 1.35, nose: 2.9, tail: 2.9, hood: 0.05, ws: 0.15, roofL: 11.7, rw: 0.05, roofH: 3.0, cw: 0.99, wr: 0.5, wb: 2.0, box: true },
};
// ---------- real-world models (vehiclemodels.js) ----------
// each model's `d` inherits its base type's VT entry (prototype), so code that reads v.d.kind / v.d.seat … keeps working,
// and boats.js changes to VT still flow through. Engine vehicles get calibrated physics (Pk, kA, topS, share).
const STYLE_SIT = { sport: 0.64, cruiser: 0.44, adv: 0.77, moped: 0.5, mini: 0.49, road: 0.6, mtb: 0.57, cargo: 0.6, ebike: 0.6, share: 0.58 };   // rider height on each seat
for (const m of Object.values(MODELS)) {
  calibrate(m);
  const b = VT[m.base], d = Object.create(b);
  d.name = m.name; d.mdl = m; if (m.kg) d.kg = m.kg;
  if (m.Pk) { d.max = m.topS; d.acc = 27.8 / ((m.z100 || 10) / 1.2); }
  else { if (m.max) d.max = m.max; if (m.acc) d.acc = m.acc; }
  if (m.turn) d.turn = m.turn; if (m.hop) d.hop = m.hop; if (m.vr) d.vr = m.vr; if (m.style && STYLE_SIT[m.style]) d.sitY = STYLE_SIT[m.style];
  if (m.snow && b.snowGrip) d.snowGrip = b.snowGrip * m.snow; else if (m.snow) d.snowGrip = 0.35 * m.snow;
  const S0 = SPECS[m.base];
  if (S0 && m.body) { if (m.body.L) d.len = b.len * m.body.L / S0.L; if (m.body.W) d.r = b.r * m.body.W / S0.W; }
  m.d = d;
}
// the model a vehicle type gets when nobody names one
export const modelOf = (type) => MODELS[DEFAULT_MODEL[type]] || null;
// pick a random model for traffic / parking: weights from the catalogue × where and when you are (summer convertibles,
// mountain Subarus and pickups, West Van Range Rovers, Coal Harbour supercars at night…)
export function spawnContext(x, z) {
  const [lat, lon] = [49.283 - z / 111320, -123.12 + x / (111320 * Math.cos(49.283 * Math.PI / 180))];
  return { summer: G.season === 'summer', winter: G.season === 'winter', night: (G.night || 0) > 0.5, day: (G.night || 0) < 0.3,
    mountain: lat > 49.5 || isSnow(x, z, heightAt(x, z)), north: lat > 49.305 && lat < 49.5, rich: (lat > 49.28 && lat < 49.295 && lon > -123.135 && lon < -123.11) || (lat > 49.325 && lat < 49.37 && lon < -123.13) };
}
export function pickModel(bases, x, z, parked = false) {
  const c = spawnContext(x, z), list = []; let sum = 0;
  for (const m of Object.values(MODELS)) {
    if (!bases.includes(m.base)) continue;
    const w = (parked ? m.pw : m.tw) * (m.when ? m.when(c) : 1); if (!(w > 0)) continue;
    list.push([m, w]); sum += w;
  }
  let r = Math.random() * sum; for (const [m, w] of list) if ((r -= w) <= 0) return m;
  return list.length ? list[0][0] : null;
}

// ---------- models ----------
const glassM = std('#1b2630', { metalness: 0.9, roughness: 0.08 });
const tireM = std('#151515', { roughness: 0.9 });
const chromeM = std('#d0d4d8', { metalness: 1, roughness: 0.25 });
const lightM = new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#fff3d0', emissiveIntensity: 1.2 });
const tailM = new THREE.MeshStandardMaterial({ color: '#500', emissive: '#ff2020', emissiveIntensity: 0.6 });
// headlights and tail lights glow brighter at night
export function setCarLights(night) { lightM.emissiveIntensity = 1.2 + night * 4; tailM.emissiveIntensity = 0.6 + night * 2; }
const wheelGeo = r => new THREE.CylinderGeometry(r, r, 0.26, 16).rotateZ(Math.PI / 2);
// ---- car bodies: a real side profile (nose, hood, windshield, roof, trunk) extruded with rounded edges and wheel arches
// cut out, a narrower glass cabin on top, plus grille, plates, mirrors, skirts and five-spoke alloys. Small parts are merged
// per car type (cached), so a car is ~20 draw calls like before. ----
const wheelCache = new Map(), bodyCache = new Map();
const decalM = std('#f4f4f0', { roughness: 0.35 }), rimM = std('#a3a9af', { metalness: 0.85, roughness: 0.3 }), trimM = std('#141518', { roughness: 0.55 }), plateM = std('#f1f1ea', { roughness: 0.5 }), archM = std('#070707', { roughness: 1 });
// a soft dark patch under each car (contact shadow / ambient occlusion) so cars sit ON the road instead of floating
const blobTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 4, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
const blobM = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
let carMatsBiased = false;
const placed = (geo, x, y, z, rx = 0) => { const q = geo.clone(); if (rx) q.rotateX(rx); q.translate(x, y, z); return q; };
function wheelGeos(r) {
  if (wheelCache.has(r)) return wheelCache.get(r);
  const pts = [], w = 0.12; pts.push(new THREE.Vector2(r * 0.62, -w)); for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + Math.PI * i / 8; pts.push(new THREE.Vector2(r - 0.05 + Math.cos(a) * 0.05, Math.sin(a) * w)); } pts.push(new THREE.Vector2(r * 0.62, w));
  const tyre = new THREE.LatheGeometry(pts, 22).rotateX(Math.PI / 2).rotateY(Math.PI / 2);   // lathe axis y → x
  const parts = [new THREE.CylinderGeometry(r * 0.63, r * 0.63, 0.16, 18).rotateZ(Math.PI / 2)];
  for (let k = 0; k < 5; k++) parts.push(placed(new THREE.BoxGeometry(0.03, r * 1.12, r * 0.17), 0.09, 0, 0, k * Math.PI * 2 / 5), placed(new THREE.BoxGeometry(0.03, r * 1.12, r * 0.17), -0.09, 0, 0, k * Math.PI * 2 / 5));
  const rim = mergeGeometries(parts.map(p => p.index ? p.toNonIndexed() : p));
  const out = { tyre, rim }; wheelCache.set(r, out); return out;
}
function wheel(parent, x, y, z, r, front, list) {
  const piv = new THREE.Group(); piv.position.set(x, y, z); parent.add(piv);
  const { tyre, rim } = wheelGeos(r);
  const w = addMesh(tyre, tireM, 0, 0, 0, piv); addMesh(rim, rimM, 0, 0, 0, w, false);
  list.push({ piv, w, front, r });
}
let LO = false;   // low-detail mode (parked cars): fewer curve/bevel segments
function extrudeSide(shape, width, bev) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.01, width - bev * 2), bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: LO ? 1 : 3, curveSegments: LO ? 3 : 10 });
  g.rotateY(-Math.PI / 2); g.translate((width - bev * 2) / 2, 0, 0); g.computeVertexNormals(); return g;
}
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z).toNonIndexed();
function bodyGeos(id, lo = false) {
  const key = lo ? id + ':lo' : id; if (bodyCache.has(key)) return bodyCache.get(key);
  LO = lo;
  const MD = MODELS[id], type = MD ? MD.base : id, xs = MD?.x || [];
  const S = MD && MD.body ? { ...SPECS[type], ...MD.body } : SPECS[type], { L, W, belt, nose, tail, wr, wb } = S, f = -L / 2, r = L / 2, bot = 0.3, bev = type === 'bus' ? 0.12 : 0.09;
  const ax = [f + wb, r - wb], ar = wr + 0.07, ay = wr;
  // lower body: bumper, nose, hood rising to the windshield, beltline, trunk/tail, rear bumper; wheel arches cut from the bottom
  const s = new THREE.Shape();   // shape x = car z, shape y = height
  s.moveTo(f + 0.12, bot);
  s.lineTo(ax[0] - ar, bot); s.absarc(ax[0], ay, ar, Math.PI, 0, true); s.lineTo(ax[1] - ar, bot); s.absarc(ax[1], ay, ar, Math.PI, 0, true);
  s.lineTo(r - 0.1, bot); s.quadraticCurveTo(r, bot, r, bot + 0.12);
  s.lineTo(r, tail - 0.1); s.quadraticCurveTo(r, tail, r - 0.15, tail);
  if (S.box) s.lineTo(f + S.hood + 0.3, tail); else { s.lineTo(r - S.rw * 0.4 - 0.25, belt + 0.02); s.lineTo(f + S.hood, belt); }
  if (S.box && type === 'bus') { s.lineTo(f + 0.12, tail); s.quadraticCurveTo(f, tail, f, tail - 0.12); }
  else s.quadraticCurveTo(f + 0.25, nose + (belt - nose) * 0.35, f + 0.05, nose - 0.04);
  s.quadraticCurveTo(f, nose - 0.1, f, nose - 0.22);
  s.lineTo(f, bot + 0.12); s.quadraticCurveTo(f, bot, f + 0.12, bot);
  const body = extrudeSide(s, W, bev);
  let cabin = null, roof = null;
  if (!S.box) {   // the glasshouse, narrower than the body, with a painted roof panel
    const c0 = f + S.hood, c1 = c0 + S.ws, c2 = c1 + S.roofL, c3 = c2 + S.rw, rh = S.roofH;
    const c = new THREE.Shape(); c.moveTo(c0, belt - 0.02); c.lineTo(c1 - 0.12, rh - 0.03); c.quadraticCurveTo(c1, rh, c1 + 0.15, rh); c.lineTo(c2 - 0.15, rh); c.quadraticCurveTo(c2, rh, c2 + 0.08, rh - 0.05); c.lineTo(c3, belt - 0.02); c.lineTo(c0, belt - 0.02);
    cabin = extrudeSide(c, W * S.cw, 0.06);
    const rf = new THREE.Shape(); rf.moveTo(c1 + 0.04, rh - 0.05); rf.lineTo(c2 - 0.04, rh - 0.05); rf.lineTo(c2 - 0.12, rh + 0.02); rf.lineTo(c1 + 0.12, rh + 0.02); rf.lineTo(c1 + 0.04, rh - 0.05);
    roof = extrudeSide(rf, W * S.cw + 0.02, 0.04);
  }
  // small parts, merged per material
  const trim = [], plates = [], heads = [], tails = [], arches = [], mirrors = [];
  for (const zz of ax) arches.push(new THREE.CylinderGeometry(wr + 0.06, wr + 0.06, W - 0.32, 14).rotateZ(Math.PI / 2).translate(0, ay, zz).toNonIndexed());
  const mid = (ax[0] + ax[1]) / 2, span = ax[1] - ax[0] - 2 * ar;
  for (const sd of [-1, 1]) {
    trim.push(box(0.03, 0.12, span, sd * (W / 2 + 0.005), 0.4, mid));   // side skirt
    if (!S.box) {
      const dz = f + S.hood + S.ws + (type === 'sports' ? 0.85 : 1.0);
      trim.push(box(0.012, belt - 0.42, 0.012, sd * (W / 2 + 0.006), (belt + 0.42) / 2, dz));   // door seam
      trim.push(box(0.03, 0.03, 0.16, sd * (W / 2 + 0.012), belt - 0.12, f + S.hood + S.ws + 0.35));   // handle
      mirrors.push(box(0.22, 0.11, 0.09, sd * (W / 2 + 0.07), belt + 0.08, f + S.hood + 0.15));
    }
    heads.push(box(type === 'bus' ? 0.3 : 0.4, 0.1, 0.06, sd * (W / 2 - 0.32), type === 'bus' ? 0.75 : nose - 0.17, f + 0.02));
    tails.push(box(type === 'bus' ? 0.25 : 0.44, type === 'bus' ? 0.3 : 0.11, 0.05, sd * (W / 2 - 0.27), type === 'bus' ? 1.0 : tail - 0.18, r + 0.01));
  }
  if (xs.includes('bigGrille')) trim.push(box(W * 0.78, Math.min(0.5, nose * 0.48), 0.05, 0, nose * 0.58, f - 0.01));   // full-size truck grille
  else if (!xs.includes('nogrille')) trim.push(box(type === 'sports' ? W * 0.5 : W * 0.56, Math.min(0.26, nose * 0.3), 0.04, 0, type === 'bus' ? 0.6 : nose * 0.6, f - 0.005));   // grille (EVs have none)
  trim.push(box(W - 0.06, 0.16, 0.08, 0, 0.38, f + 0.01), box(W - 0.06, 0.16, 0.08, 0, 0.38, r - 0.01));   // bumpers
  plates.push(box(0.52, 0.12, 0.02, 0, 0.52, f - 0.03), box(0.52, 0.12, 0.02, 0, Math.min(tail - 0.4, 0.75), r + 0.03));
  if (S.bed) { const c3 = f + S.hood + S.ws + S.roofL + S.rw; trim.push(box(W - 0.24, 0.04, r - c3 - 0.25, 0, belt + 0.005, (c3 + r) / 2 + 0.02)); }   // the open bed
  const M = a => a.length ? mergeGeometries(a) : null;
  const out = { body, cabin, roof, S, ax, trim: M(trim), plates: M(plates), heads: M(heads), tails: M(tails), arches: M(arches), mirrors: M(mirrors) };
  LO = false; bodyCache.set(key, out); return out;
}
// one-draw-call versions of a car for instancing (parked cars): { paint, dark } geometries, front = -z, sitting on y = 0
const _pc = new Map();
export function parkedCarGeos(type) {
  if (_pc.has(type)) return _pc.get(type);
  const Bc = bodyGeos(type, true), S = Bc.S, strip = g => { g = g.index ? g.toNonIndexed() : g.clone(); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g; };
  const wheels = [];
  for (const zz of Bc.ax) for (const sd of [-1, 1]) wheels.push(strip(new THREE.CylinderGeometry(S.wr, S.wr, 0.24, 9, 1).rotateZ(Math.PI / 2)).translate(sd * (S.W / 2 - 0.13), S.wr, zz));
  const paint = mergeGeometries([Bc.body, Bc.roof, Bc.mirrors].filter(Boolean).map(strip));
  const dark = mergeGeometries([Bc.cabin, Bc.trim, Bc.tails, ...wheels].filter(Boolean).map(strip));
  const out = { paint, dark, L: S.L, W: S.W }; _pc.set(type, out); return out;
}
function carModel(id, color) {
  const g = new THREE.Group(), wheels = [], MD = MODELS[id], type = MD ? MD.base : id, xs = MD?.x || [];
  const paint = MD?.metal ? std(color, { metalness: 0.95, roughness: 0.42, envMapIntensity: 1.3 }) : std(color, { metalness: 0.6, roughness: 0.28, envMapIntensity: 1.2 });
  const B = bodyGeos(id), S = B.S, { L, W } = S, f = -L / 2, r = L / 2;
  addMesh(B.body, paint, 0, 0, 0, g);
  if (!carMatsBiased) {   // details sitting ON the body (plates, arches, trim, lights) win over it; glass sits a hair behind the roof skin
    carMatsBiased = true; depthBias(blobM, 0.0006); for (const m of [trimM, plateM, archM, lightM, tailM, decalM]) depthBias(m, 0.0002); depthBias(glassM, -0.00015);
  }
  const sh = addMesh(blobGeo, blobM, 0, 0.04, 0, g, false); sh.scale.set(W + 0.7, 1, L + 0.9); sh.receiveShadow = false; sh.renderOrder = 1;
  if (B.cabin) { addMesh(B.cabin, glassM, 0, 0, 0, g); addMesh(B.roof, paint, 0, 0, 0, g, false); }
  if (B.mirrors) addMesh(B.mirrors, paint, 0, 0, 0, g, false);
  addMesh(B.trim, trimM, 0, 0, 0, g, false); addMesh(B.plates, plateM, 0, 0, 0, g, false); addMesh(B.arches, archM, 0, 0, 0, g, false);
  addMesh(B.heads, lightM, 0, 0, 0, g, false); addMesh(B.tails, tailM, 0, 0, 0, g, false);
  const c1 = f + S.hood + S.ws, c2 = c1 + S.roofL, cwH = W * S.cw / 2;   // roof span (cars)
  if (type === 'bus') {   // a band of windows down both sides, the windshield, the TransLynx yellow stripe, a destination sign
    for (const sd of [-1, 1]) addMesh(new THREE.BoxGeometry(0.03, 1.05, L - 1.8), glassM, sd * (W / 2 + 0.005), 1.95, 0.45, g, false);
    addMesh(new THREE.BoxGeometry(W - 0.25, 1.45, 0.03), glassM, 0, 1.85, f - 0.005, g, false);
    for (const sd of [-1, 1]) addMesh(new THREE.BoxGeometry(0.03, 0.3, L - 0.4), std('#f6c400'), sd * (W / 2 + 0.006), 1.15, 0, g, false);
    addMesh(new THREE.BoxGeometry(1.3, 0.22, 0.03), std('#111', { emissive: '#ff9a00', emissiveIntensity: 0.8 }), 0, 2.72, f - 0.01, g, false);
  } else if (type === 'van') {   // cab windows (+ the serving hatch with its glowing menu strip on food trucks)
    const T = S.tail, wy = T * 0.69, wh = Math.min(0.75, T * 0.34);
    addMesh(new THREE.BoxGeometry(W - 0.2, wh, 0.03), glassM, 0, wy, f + S.hood + 0.29, g, false);
    for (const sd of [-1, 1]) addMesh(new THREE.BoxGeometry(0.03, wh * 0.8, 0.7), glassM, sd * (W / 2 + 0.005), wy, f + S.hood + 0.7, g, false);
    if (!MD || xs.includes('foodtruck')) {
      addMesh(new THREE.BoxGeometry(0.04, 1.0, 2.6), std('#2a2a2a'), W / 2 + 0.01, 1.5, 0.6, g);
      addMesh(new THREE.BoxGeometry(0.05, 0.4, 2.8), std('#f6ad55', { emissive: '#7a4a00' }), W / 2 + 0.02, 2.15, 0.6, g);
    }
    if (xs.includes('westy')) {   // camper: white upper half, window band down the sides, pop-top roof
      const up = std('#f4f1e6', { roughness: 0.4 });
      addMesh(new THREE.BoxGeometry(W + 0.025, T * 0.42, L - 0.5), up, 0, T * 0.76, 0.15, g);
      for (const sd of [-1, 1]) addMesh(new THREE.BoxGeometry(0.03, wh * 0.75, L - 1.9), glassM, sd * (W / 2 + 0.02), wy, 0.45, g, false);
      addMesh(new THREE.BoxGeometry(W * 0.82, 0.16, 2.5), up, 0, T + 0.07, 0.35, g);
      addMesh(new THREE.BoxGeometry(W * 0.84, 0.04, 2.55), std('#c9a46a'), 0, T - 0.005, 0.35, g, false);
      addMesh(new THREE.BoxGeometry(0.5, 0.08, 0.04), up, 0, 0.82, f - 0.03, g, false);
    }
    if (xs.includes('courier')) for (const sd of [-1, 1]) {   // postal red + blue bands
      addMesh(new THREE.BoxGeometry(0.02, 0.22, L - 0.9), std('#d2232a'), sd * (W / 2 + 0.012), 1.05, 0.2, g, false);
      addMesh(new THREE.BoxGeometry(0.02, 0.08, L - 0.9), std('#1f3a7a'), sd * (W / 2 + 0.012), 0.86, 0.2, g, false);
    }
    if (xs.includes('icecream')) {   // pastel band, a giant cone on the roof, glowing menu boards
      for (const sd of [-1, 1]) { addMesh(new THREE.BoxGeometry(0.02, 0.35, L - 0.6), std('#f7a8c8'), sd * (W / 2 + 0.012), 1.2, 0.1, g, false); addMesh(new THREE.BoxGeometry(0.03, 0.8, 1.6), std('#5bc0eb', { emissive: '#1d5f7a', emissiveIntensity: 0.4 }), sd * (W / 2 + 0.02), 1.75, 0.8, g, false); }
      addMesh(new THREE.ConeGeometry(0.42, 1.1, 14).rotateX(Math.PI), std('#d9a066'), 0, T + 0.6, 0.6, g);
      addMesh(new THREE.SphereGeometry(0.5, 14, 10), std('#ffc0d9'), 0, T + 1.25, 0.6, g); addMesh(new THREE.SphereGeometry(0.12, 8, 6), std('#c53030'), 0, T + 1.78, 0.6, g);
    }
  }
  if (type === 'taxi') addMesh(new THREE.BoxGeometry(0.7, 0.22, 0.3), std('#fff', { emissive: '#ffd84a', emissiveIntensity: 0.5 }), 0, S.roofH + 0.12, f + S.hood + S.ws + S.roofL / 2, g);
  // ---- per-model extras ----
  if (xs.includes('rack') && B.cabin) for (const sd of [-1, 1]) addMesh(new THREE.BoxGeometry(0.05, 0.06, S.roofL + 0.1), trimM, sd * cwH * 0.78, S.roofH + 0.06, (c1 + c2) / 2, g, false);
  if (xs.includes('kayak?') && Math.random() < 0.5 && B.cabin) {   // BC classic: a kayak on the roof
    const k = addMesh(new THREE.SphereGeometry(1, 14, 8).scale(0.3, 0.16, 2.3), std(pick(['#f6c400', '#e85d04', '#2b6cb0', '#38a169', '#c53030'])), 0, S.roofH + 0.27, (c1 + c2) / 2, g); k.castShadow = true;
  }
  if (xs.includes('spoiler')) {   // rally wing on posts
    for (const sd of [-1, 1]) addMesh(new THREE.BoxGeometry(0.05, 0.16, 0.08), trimM, sd * W * 0.32, S.belt + 0.09, r - 0.3, g, false);
    addMesh(new THREE.BoxGeometry(W * 0.78, 0.04, 0.3), paint, 0, S.belt + 0.18, r - 0.3, g, false);
  }
  if (xs.includes('spoilerS')) addMesh(new THREE.BoxGeometry(W * 0.7, 0.05, 0.16), trimM, 0, Math.max(S.belt, S.tail) + 0.03, r - 0.12, g, false);
  if (xs.includes('scoop')) addMesh(new THREE.BoxGeometry(0.55, 0.09, 0.45), paint, 0, S.nose + (S.belt - S.nose) * 0.78 + 0.03, f + S.hood * 0.62, g, false);
  if (xs.includes('spare')) { addMesh(new THREE.CylinderGeometry(0.4, 0.4, 0.26, 18).rotateX(Math.PI / 2), tireM, 0, S.tail * 0.68, r + 0.16, g); addMesh(new THREE.CylinderGeometry(0.25, 0.25, 0.28, 12).rotateX(Math.PI / 2), rimM, 0, S.tail * 0.68, r + 0.165, g, false); }
  if (xs.includes('stripes') && B.cabin) for (const sd of [-1, 1]) {   // twin racing stripes over the roof and hood
    addMesh(new THREE.BoxGeometry(0.17, 0.012, S.roofL - 0.2), decalM, sd * 0.16, S.roofH + 0.025, (c1 + c2) / 2, g, false);
    const hd = addMesh(new THREE.BoxGeometry(0.17, 0.012, S.hood * 0.8), decalM, sd * 0.16, S.nose + (S.belt - S.nose) * 0.62 + 0.02, f + S.hood * 0.5, g, false); hd.rotation.x = Math.atan2(S.belt - S.nose, S.hood) * 0.9;
  }
  if (xs.includes('share')) {   // car-share livery: blue side stripe + roof sign
    for (const sd of [-1, 1]) addMesh(new THREE.BoxGeometry(0.02, 0.14, L * 0.72), std('#1b6fd8'), sd * (W / 2 + 0.012), (S.belt + 0.45) / 2, 0.1, g, false);
    addMesh(new THREE.BoxGeometry(0.42, 0.16, 0.12), std('#1b6fd8', { emissive: '#0a3a8a', emissiveIntensity: 0.6 }), 0, S.roofH + 0.15, (c1 + c2) / 2 - 0.2, g, false);
  }
  if (xs.includes('louvers') && B.cabin) {   // DeLorean rear window louvers
    const lv = addMesh(new THREE.BoxGeometry(W * S.cw * 0.9, 0.04, S.rw * 0.95), trimM, 0, (S.roofH + S.belt) / 2 + 0.04, c2 + S.rw / 2, g, false); lv.rotation.x = Math.atan2(S.roofH - S.belt, S.rw);
  }
  for (const zz of B.ax) for (const sd of [-1, 1]) wheel(g, sd * (W / 2 - 0.13), S.wr, zz, S.wr, zz < 0, wheels);
  return { g, wheels };
}
// a TransLynx city bus (used by transit.js for the bus routes)
export function busModel(color = '#1f4e8c') { const { g } = carModel('bus', color); g.traverse(o => { if (o.isMesh) o.castShadow = true; }); scene.add(g); return g; }
// ---- per-model two-wheelers (front = -z). Each style builds its own silhouette so a superbike, a cruiser, a Vespa and a
// cargo bike read differently from across the street. Wheels are pushed as {piv, w, front, r} so they spin and steer. ----
const darkM = std('#1b1c1f', { roughness: 0.6 }), seatM = std('#141414', { roughness: 0.8 }), alloyM = std('#9aa0a6', { metalness: 0.8, roughness: 0.35 });
function tw(g, wheels, z, y, r, wide, front, bicycle) {
  const piv = new THREE.Group(); piv.position.set(0, y, z); g.add(piv);
  const w = bicycle ? addMesh(new THREE.TorusGeometry(r - wide, wide, 6, 22).rotateY(Math.PI / 2), tireM, 0, 0, 0, piv)
    : addMesh(new THREE.CylinderGeometry(r, r, wide, 18).rotateZ(Math.PI / 2), tireM, 0, 0, 0, piv);
  addMesh(new THREE.CylinderGeometry(bicycle ? 0.04 : r * 0.62, bicycle ? 0.04 : r * 0.62, bicycle ? 0.1 : wide + 0.02, 12).rotateZ(Math.PI / 2), bicycle ? alloyM : rimM, 0, 0, 0, w, false);
  if (bicycle) for (let k = 0; k < 6; k++) addMesh(new THREE.BoxGeometry(0.006, (r - wide) * 2, 0.006), alloyM, 0, 0, 0, w, false).rotation.x = k * Math.PI / 6;
  wheels.push({ piv, w, front, r });
}
const tube = (g, m, ax, ay, az, bx, by, bz, t = 0.035) => {   // a frame tube from A to B
  const L = Math.hypot(bx - ax, by - ay, bz - az), me = addMesh(new THREE.CylinderGeometry(t, t, L, 6), m, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, g, false);
  me.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(bx - ax, by - ay, bz - az).normalize()); return me;
};
const STYLED = {
  // ---- motorbikes ----
  sport(g, W, c) {   // full fairing, fuel tank hump, up-swept tail, clip-ons, small screen
    tw(g, W, -0.7, 0.31, 0.31, 0.13, true); tw(g, W, 0.68, 0.31, 0.31, 0.19, false);
    const fr = addMesh(new THREE.BoxGeometry(0.36, 0.48, 0.9), c, 0, 0.66, -0.22, g); fr.rotation.x = 0.18;
    addMesh(new THREE.SphereGeometry(0.22, 12, 8).scale(1, 0.7, 1.5), c, 0, 0.92, -0.02, g);   // tank
    const tl = addMesh(new THREE.BoxGeometry(0.22, 0.14, 0.62), c, 0, 0.95, 0.42, g); tl.rotation.x = -0.22;   // tail
    addMesh(new THREE.BoxGeometry(0.24, 0.07, 0.4), seatM, 0, 0.94, 0.22, g, false);
    const sc = addMesh(new THREE.BoxGeometry(0.3, 0.2, 0.02), glassM, 0, 1.05, -0.6, g, false); sc.rotation.x = -0.9;
    addMesh(new THREE.BoxGeometry(0.56, 0.035, 0.035), darkM, 0, 0.93, -0.48, g, false);
    addMesh(new THREE.BoxGeometry(0.22, 0.09, 0.04), lightM, 0, 0.82, -0.73, g, false); addMesh(new THREE.BoxGeometry(0.12, 0.04, 0.03), tailM, 0, 0.98, 0.74, g, false);
    tube(g, chromeM, 0.13, 0.42, 0.25, 0.15, 0.62, 0.62, 0.05);   // exhaust
    tube(g, alloyM, 0, 0.31, -0.7, 0, 0.88, -0.5, 0.03);   // fork
  },
  cruiser(g, W, c) {   // long and low: teardrop tank, big chrome V-twin, wide pulled-back bars, fat fenders, twin pipes
    tw(g, W, -0.86, 0.33, 0.33, 0.16, true); tw(g, W, 0.8, 0.33, 0.33, 0.22, false);
    addMesh(new THREE.SphereGeometry(0.24, 14, 10).scale(0.95, 0.7, 1.55), c, 0, 0.86, -0.25, g);
    for (const s of [-1, 1]) { const cyl = addMesh(new THREE.CylinderGeometry(0.09, 0.1, 0.34, 12), chromeM, 0, 0.55, -0.05 + s * 0.1, g, false); cyl.rotation.x = s * 0.5; }
    addMesh(new THREE.BoxGeometry(0.3, 0.2, 0.3), darkM, 0, 0.42, 0.05, g);
    addMesh(new THREE.BoxGeometry(0.34, 0.09, 0.52), seatM, 0, 0.73, 0.3, g, false);
    addMesh(new THREE.TorusGeometry(0.36, 0.05, 6, 14, Math.PI * 0.6).rotateY(Math.PI / 2).rotateX(-Math.PI * 0.2), c, 0, 0.35, 0.8, g, false);   // rear fender
    addMesh(new THREE.TorusGeometry(0.36, 0.05, 6, 14, Math.PI * 0.5).rotateY(Math.PI / 2).rotateX(Math.PI * 0.35), c, 0, 0.35, -0.86, g, false);
    tube(g, chromeM, -0.3, 1.08, -0.42, 0.3, 1.08, -0.42, 0.022); for (const s of [-1, 1]) tube(g, chromeM, s * 0.3, 1.08, -0.42, s * 0.36, 1.02, -0.25, 0.022);
    tube(g, chromeM, 0, 0.33, -0.86, 0, 1.0, -0.55, 0.035);
    addMesh(new THREE.SphereGeometry(0.11, 12, 8), lightM, 0, 0.92, -0.72, g, false); addMesh(new THREE.BoxGeometry(0.1, 0.05, 0.04), tailM, 0, 0.62, 1.1, g, false);
    for (const y of [0.3, 0.4]) tube(g, chromeM, 0.2, y, -0.05, 0.22, y + 0.05, 1.05, 0.045);
  },
  adv(g, W, c) {   // tall adventure bike: beak fender, tall screen, crash bars, aluminium panniers + top box
    tw(g, W, -0.78, 0.36, 0.36, 0.12, true); tw(g, W, 0.72, 0.35, 0.35, 0.17, false);
    addMesh(new THREE.BoxGeometry(0.42, 0.36, 0.7), c, 0, 0.88, -0.15, g);
    const bk = addMesh(new THREE.BoxGeometry(0.18, 0.05, 0.42), c, 0, 0.86, -0.75, g, false); bk.rotation.x = -0.35;
    const sc = addMesh(new THREE.BoxGeometry(0.34, 0.34, 0.02), glassM, 0, 1.32, -0.48, g, false); sc.rotation.x = -0.4;
    addMesh(new THREE.BoxGeometry(0.3, 0.08, 0.56), seatM, 0, 1.06, 0.25, g, false);
    for (const s of [-1, 1]) addMesh(new THREE.BoxGeometry(0.2, 0.34, 0.46), alloyM, s * 0.32, 0.78, 0.48, g);
    addMesh(new THREE.BoxGeometry(0.38, 0.28, 0.34), alloyM, 0, 1.2, 0.72, g);
    addMesh(new THREE.BoxGeometry(0.7, 0.04, 0.04), darkM, 0, 1.18, -0.42, g, false);
    tube(g, alloyM, 0, 0.36, -0.78, 0, 1.08, -0.45, 0.035);
    addMesh(new THREE.BoxGeometry(0.2, 0.12, 0.04), lightM, 0, 1.02, -0.64, g, false); addMesh(new THREE.BoxGeometry(0.12, 0.05, 0.03), tailM, 0, 1.08, 0.9, g, false);
  },
  moped(g, W, c) {   // Vespa-style: small wheels, leg shield, floorboard, rounded rear body, round headlight on the bars
    tw(g, W, -0.6, 0.2, 0.2, 0.11, true); tw(g, W, 0.52, 0.2, 0.2, 0.12, false);
    const sh = addMesh(new THREE.BoxGeometry(0.42, 0.62, 0.06), c, 0, 0.62, -0.44, g); sh.rotation.x = 0.2;
    addMesh(new THREE.BoxGeometry(0.34, 0.06, 0.55), darkM, 0, 0.3, -0.12, g);
    addMesh(new THREE.SphereGeometry(0.3, 14, 10).scale(1, 0.85, 1.35), c, 0, 0.52, 0.38, g);
    addMesh(new THREE.BoxGeometry(0.28, 0.08, 0.55), seatM, 0, 0.8, 0.3, g, false);
    tube(g, c, 0, 0.2, -0.6, 0, 1.0, -0.5, 0.045);
    addMesh(new THREE.BoxGeometry(0.5, 0.06, 0.08), c, 0, 1.02, -0.5, g); addMesh(new THREE.SphereGeometry(0.075, 10, 8), lightM, 0, 1.04, -0.56, g, false);
    addMesh(new THREE.TorusGeometry(0.22, 0.04, 6, 12, Math.PI * 0.8).rotateY(Math.PI / 2).rotateX(Math.PI * 0.1), c, 0, 0.22, -0.6, g, false);
    addMesh(new THREE.BoxGeometry(0.1, 0.05, 0.03), tailM, 0, 0.66, 0.8, g, false);
  },
  mini(g, W, c) {   // Grom: chunky little bike, fat 12" wheels
    tw(g, W, -0.55, 0.25, 0.25, 0.14, true); tw(g, W, 0.52, 0.25, 0.25, 0.16, false);
    addMesh(new THREE.BoxGeometry(0.34, 0.3, 0.6), c, 0, 0.6, -0.12, g);
    addMesh(new THREE.BoxGeometry(0.26, 0.08, 0.5), seatM, 0, 0.78, 0.25, g, false);
    addMesh(new THREE.BoxGeometry(0.2, 0.12, 0.3), c, 0, 0.74, 0.5, g);
    tube(g, alloyM, 0, 0.25, -0.55, 0, 0.92, -0.4, 0.03); addMesh(new THREE.BoxGeometry(0.58, 0.035, 0.035), darkM, 0, 0.95, -0.4, g, false);
    addMesh(new THREE.BoxGeometry(0.18, 0.1, 0.04), lightM, 0, 0.82, -0.55, g, false); tube(g, chromeM, 0.15, 0.38, 0.1, 0.18, 0.62, 0.6, 0.04);
  },
  // ---- bicycles (thin tubes, spoked wheels) ----
  share(g, W, c) {   // Mobee: step-through, chunky, basket at the front
    tw(g, W, -0.55, 0.36, 0.36, 0.04, true, true); tw(g, W, 0.55, 0.36, 0.36, 0.04, false, true);
    tube(g, c, 0, 0.42, 0.1, 0, 0.66, -0.48, 0.045); tube(g, c, 0, 0.42, 0.1, 0, 0.9, 0.2, 0.04); tube(g, c, 0, 0.36, 0.55, 0, 0.42, 0.1, 0.03);
    tube(g, alloyM, 0, 0.36, -0.55, 0, 0.98, -0.5, 0.025);
    addMesh(new THREE.BoxGeometry(0.55, 0.04, 0.04), darkM, 0, 0.98, -0.5, g, false); addMesh(new THREE.BoxGeometry(0.17, 0.07, 0.27), seatM, 0, 0.93, 0.2, g, false);
    addMesh(new THREE.BoxGeometry(0.36, 0.24, 0.28), c, 0, 0.84, -0.76, g);
    addMesh(new THREE.TorusGeometry(0.36, 0.03, 4, 14, Math.PI * 0.6).rotateY(Math.PI / 2).rotateX(-Math.PI * 0.25), c, 0, 0.36, 0.55, g, false);
  },
  road(g, W, c) {   // road bike: skinny tyres, diamond frame, drop bars, high saddle
    tw(g, W, -0.5, 0.34, 0.34, 0.014, true, true); tw(g, W, 0.5, 0.34, 0.34, 0.014, false, true);
    const bb = [0, 0.32, 0.03], st = [0, 0.86, 0.17], ht = [0, 0.82, -0.42];
    tube(g, c, ...bb, ...st, 0.022); tube(g, c, ...bb, ...ht, 0.026); tube(g, c, ...st, ...ht, 0.02); tube(g, c, ...bb, 0, 0.34, 0.5, 0.015); tube(g, c, ...st, 0, 0.34, 0.5, 0.013);
    tube(g, c, 0, 0.34, -0.5, ...ht, 0.018);
    addMesh(new THREE.TorusGeometry(0.1, 0.014, 5, 10, Math.PI).rotateY(Math.PI / 2), darkM, 0.2, 0.84, -0.52, g, false); addMesh(new THREE.TorusGeometry(0.1, 0.014, 5, 10, Math.PI).rotateY(Math.PI / 2), darkM, -0.2, 0.84, -0.52, g, false);
    addMesh(new THREE.BoxGeometry(0.42, 0.025, 0.025), darkM, 0, 0.93, -0.46, g, false); addMesh(new THREE.BoxGeometry(0.12, 0.04, 0.26), seatM, 0, 0.95, 0.2, g, false);
  },
  mtb(g, W, c) {   // full-suspension mountain bike: fat knobby tyres, suspension fork, wide flat bar, rear shock
    tw(g, W, -0.56, 0.37, 0.37, 0.06, true, true); tw(g, W, 0.56, 0.37, 0.37, 0.06, false, true);
    const bb = [0, 0.36, 0.05], ht = [0, 0.86, -0.38];
    tube(g, c, ...bb, ...ht, 0.04); tube(g, c, ...bb, 0, 0.88, 0.12, 0.032); tube(g, c, ...bb, 0, 0.37, 0.56, 0.025); tube(g, c, 0, 0.62, 0.2, 0, 0.37, 0.56, 0.022);
    tube(g, chromeM, 0, 0.37, -0.56, ...ht, 0.032); addMesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 8), std('#e85d04'), 0, 0.56, -0.03, g, false).rotation.x = 1.0;
    addMesh(new THREE.BoxGeometry(0.76, 0.03, 0.03), darkM, 0, 0.96, -0.36, g, false); addMesh(new THREE.BoxGeometry(0.13, 0.05, 0.26), seatM, 0, 0.92, 0.14, g, false);
  },
  cargo(g, W, c) {   // long-john cargo e-bike: small front wheel far ahead, a big kid box in between, battery, rain canopy hoops
    tw(g, W, -1.0, 0.26, 0.26, 0.04, true, true); tw(g, W, 0.62, 0.34, 0.34, 0.045, false, true);
    tube(g, c, 0, 0.28, -1.0, 0, 0.3, 0.05, 0.045); tube(g, c, 0, 0.3, 0.05, 0, 0.92, 0.25, 0.04); tube(g, c, 0, 0.3, 0.05, 0, 0.34, 0.62, 0.03);
    addMesh(new THREE.BoxGeometry(0.6, 0.42, 0.72), std('#2a2d31', { roughness: 0.7 }), 0, 0.55, -0.48, g);
    addMesh(new THREE.BoxGeometry(0.56, 0.06, 0.66), c, 0, 0.78, -0.48, g, false);
    for (const z of [-0.78, -0.2]) addMesh(new THREE.TorusGeometry(0.28, 0.012, 4, 12, Math.PI).rotateY(Math.PI / 2).rotateY(Math.PI / 2), darkM, 0, 0.78, z, g, false);
    addMesh(new THREE.BoxGeometry(0.1, 0.12, 0.36), darkM, 0, 0.5, 0.2, g); tube(g, alloyM, 0, 0.6, -0.1, 0, 1.05, -0.05, 0.022);
    addMesh(new THREE.BoxGeometry(0.62, 0.03, 0.03), darkM, 0, 1.05, -0.05, g, false); addMesh(new THREE.BoxGeometry(0.17, 0.06, 0.27), seatM, 0, 0.95, 0.26, g, false);
  },
  ebike(g, W, c) {   // commuter e-bike: fenders, rack, chunky down-tube battery, hub motor
    tw(g, W, -0.55, 0.35, 0.35, 0.035, true, true); tw(g, W, 0.55, 0.35, 0.35, 0.035, false, true);
    const bb = [0, 0.33, 0.05], ht = [0, 0.84, -0.4];
    tube(g, c, ...bb, ...ht, 0.034); tube(g, c, ...bb, 0, 0.88, 0.17, 0.03); tube(g, c, ...bb, 0, 0.35, 0.55, 0.02); tube(g, c, 0, 0.75, 0.15, 0, 0.35, 0.55, 0.018);
    const bat = addMesh(new THREE.BoxGeometry(0.09, 0.1, 0.42), darkM, 0, 0.6, -0.17, g, false); bat.rotation.x = Math.atan2(0.84 - 0.33, 0.45);
    addMesh(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 12).rotateZ(Math.PI / 2), darkM, 0, 0.35, 0.55, g, false);
    tube(g, alloyM, 0, 0.35, -0.55, ...ht, 0.024); addMesh(new THREE.BoxGeometry(0.56, 0.03, 0.03), darkM, 0, 0.95, -0.42, g, false);
    addMesh(new THREE.BoxGeometry(0.16, 0.06, 0.26), seatM, 0, 0.94, 0.17, g, false); addMesh(new THREE.BoxGeometry(0.16, 0.02, 0.36), alloyM, 0, 0.78, 0.4, g, false);
    addMesh(new THREE.BoxGeometry(0.08, 0.06, 0.04), lightM, 0, 0.88, -0.48, g, false);
  },
};
function twoWheeler(type, color, style) {
  const g = new THREE.Group(), wheels = [], c = std(color, { metalness: 0.4, roughness: 0.4 });
  if (style && STYLED[style]) { STYLED[style](g, wheels, c); return { g, wheels }; }
  if (type === 'bike') {
    for (const z of [-0.55, 0.55]) { const piv = new THREE.Group(); piv.position.set(0, 0.36, z); g.add(piv); const w = addMesh(new THREE.TorusGeometry(0.33, 0.035, 6, 20).rotateY(Math.PI / 2), tireM, 0, 0, 0, piv); wheels.push({ piv, w, front: z < 0, r: 0.36 }); }
    addMesh(new THREE.BoxGeometry(0.06, 0.06, 1.0), c, 0, 0.62, 0, g).rotation.x = 0.15;
    addMesh(new THREE.BoxGeometry(0.06, 0.55, 0.06), c, 0, 0.6, 0.18, g);
    addMesh(new THREE.BoxGeometry(0.06, 0.6, 0.06), c, 0, 0.66, -0.48, g).rotation.x = -0.25;
    addMesh(new THREE.BoxGeometry(0.55, 0.04, 0.04), std('#222'), 0, 0.98, -0.55, g);
    addMesh(new THREE.BoxGeometry(0.16, 0.06, 0.26), std('#222'), 0, 0.9, 0.2, g);
    addMesh(new THREE.BoxGeometry(0.34, 0.24, 0.26), c, 0, 0.82, -0.75, g);
  } else if (type === 'scooter') {
    for (const z of [-0.45, 0.45]) { const piv = new THREE.Group(); piv.position.set(0, 0.11, z); g.add(piv); const w = addMesh(wheelGeo(0.11), tireM, 0, 0, 0, piv); wheels.push({ piv, w, front: z < 0, r: 0.11 }); }
    addMesh(new THREE.BoxGeometry(0.18, 0.05, 0.85), std('#222'), 0, 0.15, 0, g);
    addMesh(new THREE.BoxGeometry(0.05, 1.0, 0.05), c, 0, 0.65, -0.45, g);
    addMesh(new THREE.BoxGeometry(0.45, 0.04, 0.04), std('#222'), 0, 1.13, -0.45, g);
  } else if (type === 'motorbike') {
    for (const z of [-0.7, 0.7]) { const piv = new THREE.Group(); piv.position.set(0, 0.32, z); g.add(piv); const w = addMesh(wheelGeo(0.32), tireM, 0, 0, 0, piv); wheels.push({ piv, w, front: z < 0, r: 0.32 }); }
    addMesh(new THREE.BoxGeometry(0.34, 0.35, 1.0), c, 0, 0.62, -0.1, g);
    addMesh(new THREE.BoxGeometry(0.3, 0.12, 0.6), std('#111'), 0, 0.83, 0.25, g);
    addMesh(new THREE.BoxGeometry(0.6, 0.05, 0.05), chromeM, 0, 1.0, -0.6, g);
    addMesh(new THREE.BoxGeometry(0.2, 0.2, 0.05), lightM, 0, 0.8, -0.72, g, false);
  } else if (type === 'jetski') {
    addMesh(new THREE.BoxGeometry(1.1, 0.5, 3), c, 0, 0.25, 0, g);
    addMesh(new THREE.ConeGeometry(0.55, 1, 4).rotateX(-Math.PI / 2).rotateZ(Math.PI / 4).scale(1, 0.5, 1), c, 0, 0.25, -1.9, g);
    addMesh(new THREE.BoxGeometry(0.5, 0.25, 1.2), std('#111'), 0, 0.6, 0.3, g);
    addMesh(new THREE.BoxGeometry(0.6, 0.05, 0.05), std('#222'), 0, 0.95, -0.5, g);
  }
  return { g, wheels };
}
// snowmobile: two front skis with curled tips, a sculpted hood + windshield, seat, rubber track with bogie wheels, headlight
function sledModel(color) {
  const g = new THREE.Group(), c = std(color || '#c53030', { metalness: 0.35, roughness: 0.35 }), dark = std('#1a1b1e', { roughness: 0.7 });
  for (const s of [-1, 1]) {
    addMesh(new THREE.BoxGeometry(0.14, 0.04, 1.4), dark, s * 0.5, 0.04, -0.7, g);
    addMesh(new THREE.TorusGeometry(0.16, 0.025, 6, 10, Math.PI / 2).rotateY(Math.PI / 2), dark, s * 0.5, 0.2, -1.4, g);   // curled tip
    addMesh(new THREE.BoxGeometry(0.05, 0.4, 0.06), chromeM, s * 0.5, 0.25, -0.65, g);   // ski strut
  }
  const hood = new THREE.Shape(); hood.moveTo(-1.55, 0.2); hood.lineTo(-1.5, 0.55); hood.quadraticCurveTo(-0.9, 0.95, -0.35, 0.95); hood.lineTo(0.0, 0.62); hood.lineTo(1.25, 0.62); hood.lineTo(1.3, 0.3); hood.lineTo(-0.2, 0.2); hood.lineTo(-1.55, 0.2);
  const hg = new THREE.ExtrudeGeometry(hood, { depth: 0.75, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.06, bevelSegments: 2 }).rotateY(-Math.PI / 2).translate(0.375, 0, 0); hg.computeVertexNormals();
  addMesh(hg, c, 0, 0, 0, g);
  addMesh(new THREE.BoxGeometry(0.8, 0.42, 0.03), glassM, 0, 1.12, -0.42, g, false).rotation.x = -0.55;   // windshield
  addMesh(new THREE.BoxGeometry(0.52, 0.18, 1.2), dark, 0, 0.78, 0.55, g);   // seat
  addMesh(new THREE.BoxGeometry(0.6, 0.38, 1.9), std('#101012', { roughness: 0.95 }), 0, 0.2, 0.55, g);   // track
  for (const z of [-0.2, 0.3, 0.8, 1.3]) addMesh(new THREE.CylinderGeometry(0.11, 0.11, 0.66, 10).rotateZ(Math.PI / 2), chromeM, 0, 0.12, z, g, false);
  addMesh(new THREE.BoxGeometry(0.85, 0.05, 0.05), dark, 0, 1.0, -0.15, g);   // handlebar
  addMesh(new THREE.BoxGeometry(0.34, 0.12, 0.05), lightM, 0, 0.62, -1.58, g, false);
  addMesh(new THREE.BoxGeometry(0.3, 0.08, 0.04), tailM, 0, 0.55, 1.47, g, false);
  return { g, wheels: [] };
}
// boats: a hull with a pointed bow (front = -z)
export function hullGeo(w, h, L, bow) {
  const s = new THREE.Shape(); s.moveTo(-w / 2, -L / 2); s.lineTo(w / 2, -L / 2); s.lineTo(w / 2, L / 2 - bow); s.lineTo(0, L / 2); s.lineTo(-w / 2, L / 2 - bow); s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false }).rotateX(-Math.PI / 2);
}
function boatModel(type, color) {
  const g = new THREE.Group(), white = std('#f4f4f2', { roughness: 0.4 }), c = std(color, { roughness: 0.4 });
  if (type === 'kayak') {
    addMesh(new THREE.SphereGeometry(1, 14, 8).scale(0.36, 0.2, 2.0), c, 0, 0.08, 0, g);
    addMesh(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 14).scale(1, 1, 1.6), std('#1a202c'), 0, 0.22, 0.1, g, false);
    const paddle = addMesh(new THREE.BoxGeometry(2.2, 0.04, 0.05), std('#2d3748'), 0, 0.75, -0.25, g, false);
    for (const s of [-1, 1]) addMesh(new THREE.BoxGeometry(0.35, 0.03, 0.16), std('#f6e05e'), s * 1.1, 0, 0, paddle, false);
  } else if (type === 'sailboat') {
    addMesh(hullGeo(2.4, 1.0, 7, 2.2), white, 0, -0.2, 0, g);
    addMesh(new THREE.BoxGeometry(2.42, 0.18, 4.6), c, 0, 0.35, 0.9, g);
    addMesh(new THREE.BoxGeometry(1.5, 0.6, 2.2), white, 0, 1.0, 0.3, g);
    addMesh(new THREE.CylinderGeometry(0.07, 0.09, 10, 8), std('#cbd5e0', { metalness: 0.7 }), 0, 5.8, -0.6, g);
    const sail = new THREE.Shape(); sail.moveTo(0, 0); sail.lineTo(0, 8.6); sail.lineTo(3.2, 0); sail.closePath();
    addMesh(new THREE.ShapeGeometry(sail).rotateY(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#fdfdf8', side: THREE.DoubleSide, roughness: 0.9 }), 0.02, 1.3, -0.7, g);
    const jib = new THREE.Shape(); jib.moveTo(0, 0); jib.lineTo(0, 7.5); jib.lineTo(-2.6, 0); jib.closePath();
    addMesh(new THREE.ShapeGeometry(jib).rotateY(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#f2f2ea', side: THREE.DoubleSide, roughness: 0.9 }), 0.02, 1.3, -0.8, g);
  } else if (type === 'speedboat') {
    addMesh(hullGeo(2.2, 0.9, 6, 2.0), white, 0, -0.25, 0, g);
    addMesh(new THREE.BoxGeometry(2.22, 0.2, 3.6), c, 0, 0.2, 0.9, g);
    addMesh(new THREE.BoxGeometry(1.9, 0.5, 0.06), glassM, 0, 0.95, -0.3, g, false).rotation.x = -0.5;
    for (const s of [-1, 1]) addMesh(new THREE.BoxGeometry(0.6, 0.4, 0.6), std('#e2e8f0'), s * 0.45, 0.85, 0.6, g);
    addMesh(new THREE.BoxGeometry(0.5, 0.6, 0.5), std('#1a202c'), 0, 0.5, 3.1, g);
  } else if (type === 'yacht') {
    addMesh(hullGeo(4.6, 2.2, 16, 4.5), white, 0, -0.9, 0, g);
    addMesh(new THREE.BoxGeometry(4.62, 0.3, 10), std('#1a365d'), 0, 0.2, 2.0, g);
    addMesh(new THREE.BoxGeometry(3.8, 2.0, 8), white, 0, 2.3, 1.5, g);
    addMesh(new THREE.BoxGeometry(3.82, 0.8, 7.6), glassM, 0, 2.5, 1.5, g, false);
    addMesh(new THREE.BoxGeometry(3.0, 1.4, 4.5), white, 0, 4.0, 2.0, g);
    addMesh(new THREE.BoxGeometry(3.02, 0.6, 4.2), glassM, 0, 4.1, 2.0, g, false);
    for (const s of [-1, 1]) addMesh(new THREE.BoxGeometry(0.05, 0.6, 12), chromeM, s * 2.25, 1.6, 1.0, g, false);
    addMesh(new THREE.CylinderGeometry(0.06, 0.06, 2.5, 6), chromeM, 0, 5.8, 2.6, g, false);
  }
  return { g, wheels: [] };
}
export function heliModel() {
  const g = new THREE.Group(), body = std('#c53030', { metalness: 0.4, roughness: 0.35 }), white = std('#f2f2f2', { metalness: 0.3, roughness: 0.35 });
  addMesh(new THREE.SphereGeometry(1.4, 18, 14).scale(1, 0.95, 1.6), body, 0, 1.7, 0, g);
  addMesh(new THREE.SphereGeometry(1.2, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2).scale(1.05, 0.9, 1.1), glassM, 0, 1.85, -1.1, g);
  addMesh(new THREE.BoxGeometry(0.4, 0.45, 5).translate(0, 0, 2.5), white, 0, 1.9, 1.5, g);
  addMesh(new THREE.BoxGeometry(0.1, 1.3, 0.8), body, 0, 2.4, 6.6, g);
  for (const s of [-1, 1]) { addMesh(new THREE.BoxGeometry(0.12, 0.12, 3.2), chromeM, s * 1.1, 0.12, 0, g); addMesh(new THREE.BoxGeometry(0.08, 0.6, 0.08), chromeM, s * 1.0, 0.45, -0.8, g); addMesh(new THREE.BoxGeometry(0.08, 0.6, 0.08), chromeM, s * 1.0, 0.45, 0.8, g); }
  const rotor = new THREE.Group(); rotor.position.set(0, 3.15, 0); g.add(rotor);
  addMesh(new THREE.CylinderGeometry(0.15, 0.15, 0.5), chromeM, 0, -0.2, 0, rotor);
  for (let i = 0; i < 2; i++) addMesh(new THREE.BoxGeometry(0.35, 0.05, 10.5), std('#222'), 0, 0, 0, rotor).rotation.y = i * Math.PI / 2;
  const tail = new THREE.Group(); tail.position.set(0.25, 2.5, 6.6); g.add(tail);
  addMesh(new THREE.BoxGeometry(0.05, 1.6, 0.18), std('#222'), 0, 0, 0, tail);
  return { g, wheels: [], rotor, tail };
}
export function jetModel(S, color) {
  const g = new THREE.Group(), white = std('#f4f5f6', { metalness: 0.35, roughness: 0.3 }), tail = std(color || '#c8102e', { metalness: 0.3, roughness: 0.35 }), grey = std('#9aa3ab', { metalness: 0.6, roughness: 0.3 });
  const body = new THREE.Group(); body.scale.setScalar(S); g.add(body);
  addMesh(new THREE.CapsuleGeometry(2, 32, 8, 18).rotateX(Math.PI / 2), white, 0, 4.2, 0, body);
  addMesh(new THREE.BoxGeometry(4.02, 0.4, 30), tail, 0, 3.4, 0, body);
  for (let i = 0; i < 18; i++) for (const s of [-1, 1]) addMesh(new THREE.BoxGeometry(0.05, 0.4, 0.3), glassM, s * 2.0, 4.9, -13 + i * 1.5, body, false);
  addMesh(new THREE.BoxGeometry(2.8, 0.7, 1.2), glassM, 0, 5.0, -17.2, body, false);
  for (const s of [-1, 1]) {
    const wing = addMesh(new THREE.BoxGeometry(16, 0.5, 5).translate(s * 8, 0, 0), white, s * 1.5, 3.2, 0, body); wing.rotation.y = s * 0.45;
    addMesh(new THREE.CylinderGeometry(1.1, 1.1, 4, 14).rotateX(Math.PI / 2), grey, s * 6, 2.0, -2.5, body);
    const hs = addMesh(new THREE.BoxGeometry(6, 0.3, 2.4).translate(s * 3, 0, 0), white, s * 0.6, 5.0, 16, body); hs.rotation.y = s * 0.4;
  }
  addMesh(new THREE.BoxGeometry(0.4, 7, 4.5), tail, 0, 8, 15.5, body).rotation.x = -0.35;
  for (const [x, z] of [[0, -13], [-2.2, 1.5], [2.2, 1.5]]) { addMesh(new THREE.CylinderGeometry(0.12, 0.12, 2.2), grey, x, 1.4, z, body); addMesh(new THREE.CylinderGeometry(0.55, 0.55, 0.5, 12).rotateZ(Math.PI / 2), tireM, x, 0.55, z, body); }
  return { g, wheels: [] };
}
export function cessnaModel() {
  const g = new THREE.Group(), white = std('#f4f4f4', { metalness: 0.3, roughness: 0.35 }), red = std('#c53030', { metalness: 0.3, roughness: 0.4 });
  addMesh(new THREE.BoxGeometry(1.2, 1.4, 5).translate(0, 0, 0.6), white, 0, 1.8, 0, g);
  addMesh(new THREE.BoxGeometry(0.7, 0.8, 3).translate(0, 0, 1.5), white, 0, 1.9, 2.4, g);
  addMesh(new THREE.BoxGeometry(1.22, 0.3, 5.02), red, 0, 1.4, 0.6, g);
  addMesh(new THREE.BoxGeometry(1.22, 0.55, 1.4), glassM, 0, 2.3, -0.9, g);
  addMesh(new THREE.BoxGeometry(11, 0.15, 1.5), white, 0, 2.65, -0.6, g);
  addMesh(new THREE.BoxGeometry(3.4, 0.1, 0.9), white, 0, 2.0, 5.3, g); addMesh(new THREE.BoxGeometry(0.1, 1.3, 1), red, 0, 2.6, 5.4, g);
  for (const [x, z] of [[0, -1.8], [-1, 0.2], [1, 0.2]]) { addMesh(new THREE.CylinderGeometry(0.05, 0.05, 1), std('#666'), x, 0.7, z, g); addMesh(new THREE.CylinderGeometry(0.25, 0.25, 0.15, 12).rotateZ(Math.PI / 2), tireM, x, 0.25, z, g); }
  const prop = new THREE.Group(); prop.position.set(0, 1.8, -2.0); g.add(prop);
  for (let i = 0; i < 2; i++) addMesh(new THREE.BoxGeometry(0.12, 1.8, 0.05), std('#222'), 0, 0, 0, prop).rotation.z = i * Math.PI;
  return { g, wheels: [], prop };
}
function tugModel() {
  const g = new THREE.Group(), wheels = [], yel = std('#f2c230');
  addMesh(new THREE.BoxGeometry(1.6, 0.8, 2.6), yel, 0, 0.75, 0, g); addMesh(new THREE.BoxGeometry(1.4, 0.9, 1), glassM, 0, 1.6, 0.4, g);
  for (const [x, z] of [[-0.8, -0.9], [0.8, -0.9], [-0.8, 0.9], [0.8, 0.9]]) wheel(g, x, 0.35, z, 0.35, z < 0, wheels);
  for (let i = 0; i < 2; i++) { addMesh(new THREE.BoxGeometry(1.5, 0.3, 2.2), std('#555'), 0, 0.5, 3.5 + i * 3, g); for (let k = 0; k < 3; k++) addMesh(new THREE.BoxGeometry(0.6, 0.5, 0.5), std(['#2b6cb0', '#c53030', '#2f855a', '#d69e2e'][(i + k) % 4]), -0.4 + k * 0.4, 0.9, 3.5 + i * 3, g); }
  return { g, wheels };
}
export function planeModel() {
  const g = new THREE.Group(), white = std('#f4f4f4', { metalness: 0.3, roughness: 0.35 }), blue = std('#1f4e8c', { metalness: 0.3, roughness: 0.4 }), yel = std('#f2c230');
  addMesh(new THREE.BoxGeometry(1.4, 1.6, 7).translate(0, 0, 0.3), white, 0, 2.7, 0, g);
  addMesh(new THREE.BoxGeometry(0.9, 0.9, 3.5).translate(0, 0, 1.75), white, 0, 2.9, 3.6, g);
  addMesh(new THREE.BoxGeometry(1.42, 0.5, 7.02), blue, 0, 2.3, 0.3, g);
  addMesh(new THREE.BoxGeometry(1.42, 0.55, 1.5), glassM, 0, 3.2, -2.1, g);
  addMesh(new THREE.BoxGeometry(14.5, 0.22, 1.9), white, 0, 3.6, -1.2, g);
  addMesh(new THREE.BoxGeometry(14.5, 0.06, 0.4), yel, 0, 3.72, -1.2, g);
  addMesh(new THREE.BoxGeometry(4.5, 0.12, 1.1), white, 0, 3.1, 6.8, g);
  addMesh(new THREE.BoxGeometry(0.12, 1.8, 1.3), blue, 0, 3.9, 6.9, g);
  for (const s of [-1, 1]) {
    addMesh(new THREE.CapsuleGeometry(0.35, 6, 4, 10).rotateX(Math.PI / 2), white, s * 1.5, 0.45, 0, g);
    addMesh(new THREE.BoxGeometry(0.08, 1.7, 0.08), chromeM, s * 1.0, 1.3, -1.6, g).rotation.z = s * 0.4;
    addMesh(new THREE.BoxGeometry(0.08, 1.7, 0.08), chromeM, s * 1.0, 1.3, 1.6, g).rotation.z = s * 0.4;
  }
  const prop = new THREE.Group(); prop.position.set(0, 2.7, -3.35); g.add(prop);
  addMesh(new THREE.ConeGeometry(0.3, 0.5, 10).rotateX(-Math.PI / 2), yel, 0, 0, -0.1, prop);
  for (let i = 0; i < 3; i++) addMesh(new THREE.BoxGeometry(0.16, 1.2, 0.05).translate(0, 0.6, 0), std('#222'), 0, 0, 0, prop).rotation.z = i * Math.PI * 2 / 3;
  return { g, wheels: [], prop };
}

// ---------- the vehicle object ----------
let uid = 0;
export function makeVehicle(type, x, z, yaw = 0, opts = {}) {
  // type may be a base type ('car') or a real model id ('civic'); a base type gets its default model
  let MD = MODELS[type] || (opts.model && MODELS[opts.model]) || null;
  if (MODELS[type]) type = MD.base; else if (!MD) MD = modelOf(type);
  const d = MD ? MD.d : VT[type];
  const color = opts.color || (MD?.cols ? pick(MD.cols) : null) || (type === 'taxi' ? '#f2c230' : type === 'bus' ? '#1f4e8c' : type === 'bike' ? '#2b6cb0' : type === 'scooter' ? '#7cc242' : type === 'van' ? '#e8e2d0' : type === 'sports' ? pick(['#e53e3e', '#f6e05e', '#1a202c', '#38a169']) : pick(CAR_COLS));
  const mdl = d.kind === 'heli' ? heliModel() : type === 'seaplane' ? planeModel() : type === 'cessna' ? cessnaModel() : (type === 'jet' || type === 'jumbo') ? jetModel(type === 'jumbo' ? 1.75 : 1, color) : type === 'tug' ? tugModel() : type === 'skate' ? skateModel(color) : type === 'snowmobile' ? sledModel(color) : ['bike', 'scooter', 'motorbike', 'jetski'].includes(type) ? twoWheeler(type, color, MD?.style) : ['kayak', 'sailboat', 'speedboat', 'yacht'].includes(type) ? boatModel(type, color) : carModel(MD && SPECS[type] ? MD.id : type, color);
  if (MD?.scale) mdl.g.scale.set(...MD.scale);
  mdl.g.rotation.order = 'YXZ'; scene.add(mdl.g);
  const v = { id: uid++, type, d, x, z, y: 0, yaw, pitch: 0, roll: 0, speed: 0, speedAbs: 0, vy: 0, vx: 0, vz: 0, steer: 0, throttle: 0, rotorSpin: 0, driver: null, ai: null, ...mdl, keep: !!opts.keep, label: opts.label, model: MD, gr: 1, vp: 0 };
  v.y = d.kind === 'water' || d.kind === 'plane' && isWater(x, z) ? waterLevel(x, z) + 0.05 : surfaceY(x, z, opts.y ?? 1e9);
  if (opts.y !== undefined) v.y = opts.y;
  syncModel(v); vehicles.push(v); return v;
}
export function removeVehicle(v) { scene.remove(v.g); const i = vehicles.indexOf(v); if (i >= 0) vehicles.splice(i, 1); }
function syncModel(v) { const sk = v.type === 'skate'; v.g.position.set(v.x, v.y, v.z); v.g.rotation.set(v.pitch + (v.vp || 0) + (v.air && !sk ? v.air.flip : 0), v.yaw, v.roll + (v.air && sk ? v.air.flip : 0), 'YXZ'); }   // skateboards flip around their long axis (kickflip)
function skateModel(color) { const g = new THREE.Group(); addMesh(new THREE.BoxGeometry(0.24, 0.03, 0.82), std(color || '#1a1a1a'), 0, 0.12, 0, g); addMesh(new THREE.BoxGeometry(0.22, 0.005, 0.8), std('#f6c343'), 0, 0.137, 0, g, false); for (const z of [-0.28, 0.28]) { addMesh(new THREE.BoxGeometry(0.2, 0.03, 0.05), std('#b0b4b8', { metalness: 0.7 }), 0, 0.09, z, g); for (const x of [-0.1, 0.1]) addMesh(new THREE.CylinderGeometry(0.035, 0.035, 0.035, 10).rotateZ(Math.PI / 2), std('#f4f4ef'), x, 0.04, z, g); } return { g, wheels: [] }; }

// ---------- player driving physics ----------
const fwd = v => [-Math.sin(v.yaw), -Math.cos(v.yaw)];
export const boatHook = {};   // boats.js plugs in its own per-type boat physics (boatHook.drive)
export function drivePlayer(v, dt, input) {
  const d = v.d;
  if (d.kind === 'water' && boatHook.drive) return boatHook.drive(v, dt, input);
  if (d.kind === 'heli') return flyHeli(v, dt, input);
  if (d.kind === 'plane') return flyPlane(v, dt, input);
  const snow = isSnow(v.x, v.z, v.y) && d.kind === 'road';
  const grip = snow ? (d.snowGrip || 0.3) : 1 - 0.35 * (G.wet || 0);   // rain = slippery
  if (d.mdl?.Pk) roadEngine(v, dt, input, d.mdl, snow, grip); else {
  // smooth steering: the wheel turns in gradually and re-centres a bit faster when you let go
  v.steer += (input.steer * d.turn - v.steer) * Math.min(1, dt * (input.steer ? 3.2 : 6));
  // Shift = extra effort: pedal / push / kick harder on bikes, boards and scooters, or floor it in anything with an engine
  const light = d.show && d.kind === 'road', human = d.pedal || v.type === 'skate' || v.type === 'scooter';
  // full effort: a strong rider sprints a bike to ~55 km/h, kicks an e-scooter to ~50, pushes a skateboard to ~42
  const SPRINT = { bike: 1.65, scooter: 1.6, skate: 1.45 };
  const effort = input.boost ? (SPRINT[v.type] || (human ? 1.5 : 1.22)) : 1, vmax = d.max * effort, acc = d.acc * (input.boost ? (human ? 1.75 : 1.3) : 1);
  if (input.up) v.speed += (v.speed < 0 ? acc * 2 : acc * Math.max(0, 1 - v.speed / vmax)) * dt * (snow ? 0.6 : 1);   // no engine braking above top speed (downhill keeps its speed)
  if (input.down) v.speed -= (v.speed > 0 ? d.acc * 2.2 : d.acc * 0.6) * dt;
  if (input.brake) { const s = Math.sign(v.speed); v.speed -= s * d.acc * 2.8 * dt; if (Math.sign(v.speed) !== s) v.speed = 0; }
  // air drag: real (speed²) drag on bikes/boards, so coasting down a 6% hill reaches ~40 km/h, a 10% hill ~55 km/h
  if (light && !snow) v.speed -= 0.0035 * v.speed * Math.abs(v.speed) * dt; else v.speed -= v.speed * (snow ? 0.05 : 0.18) * dt;
  if (!input.up && !input.down) { const s = Math.sign(v.speed); v.speed -= s * (snow ? 0.5 : light ? 0.08 : 0.25) * dt; if (Math.sign(v.speed) !== s) v.speed = 0; }   // rolling resistance: you can coast (a car rolls down a steep street in neutral too)
  v.speed -= 9.8 * Math.sin(v.pitch) * dt;   // gravity: hills slow you down going up and speed you up going down
  v.speed = clamp(v.speed, -d.max * 0.3, d.max * (light ? 2.1 : 1.6));   // downhill you can go well past the flat-ground top speed
  const steerEff = v.steer * (1 - Math.min(0.8, Math.abs(v.speed) / d.max));
  const maxYaw = d.kind === 'water' ? 0.9 : d.show ? 2.2 : 1.35;   // never spin faster than this (radians per second)
  const yawRate = clamp(v.speed / (d.len * 0.55) * Math.tan(steerEff), -maxYaw, maxYaw);
  v.yaw += yawRate * dt * (snow ? 0.8 : 1);
  // slide on snow / handbrake drift
  const [fx, fz] = fwd(v);
  const tvx = fx * v.speed, tvz = fz * v.speed, g2 = input.brake && Math.abs(v.speed) > 10 ? 0.12 : grip;
  v.vx += (tvx - v.vx) * Math.min(1, dt * 8 * g2); v.vz += (tvz - v.vz) * Math.min(1, dt * 8 * g2);
  }
  const [fx, fz] = fwd(v);
  const ox = v.x, oz = v.z;
  v.x += v.vx * dt; v.z += v.vz * dt;
  if (d.kind === 'water') {
    if (!isWater(v.x, v.z)) { v.x = ox; v.z = oz; v.speed *= -0.3; v.vx = v.vz = 0; sfx.bump(); }
    v.y = waterLevel(v.x, v.z) + 0.05 + Math.sin(G.t * 3 + v.id) * 0.06; v.pitch = -Math.min(0.15, Math.abs(v.speed) / 160); v.roll = -v.steer * Math.min(1, Math.abs(v.speed) / 15) * 0.35;
  } else {
    // buildings
    let hit = false;
    // on the road itself, building outlines that poke into the street (map data overlap) don't block you
    const rd = nearestRoad(v.x, v.z, 14, q => isDriveType(q.t)), onRoad = rd && rd.d < rd.road.w / 2 - 1.2 && Math.abs(surfaceY(v.x, v.z, v.y + 1) - v.y) < 1.5;
    if (!onRoad) for (const off of [0, d.len * 0.35, -d.len * 0.35]) {
      const p = { x: v.x + fx * off, z: v.z + fz * off }, ox = p.x, oz = p.z;
      if (collideBuildings(p, d.r, v.y)) { hit = true; v.x += p.x - ox; v.z += p.z - oz; }
    }
    for (const off of [0, d.len * 0.35, -d.len * 0.35]) {   // trees, poles, hydrants, benches, pillars…
      const p = { x: v.x + fx * off, z: v.z + fz * off, kg: massOf(v) }, ox = p.x, oz = p.z;
      const sg = Math.sign(v.speed) || 1;
      if (collideStatic(p, d.r * 0.85, v.y + 0.3, Math.abs(v.speed), [fx * sg, fz * sg])) { hit = true; v.x += p.x - ox; v.z += p.z - oz; }
      if (p.broke) { v.speed *= p.kg / (p.kg + p.brokeKg * 1.6); p.broke = 0; }   // you smashed through something small: a bus barely slows, a bike nearly stops
    }
    if (hit) { if (Math.abs(v.speed) > 6) { sfx.bump(); input.onCrash?.(Math.abs(v.speed)); } v.speed *= -0.25; v.vx *= 0.3; v.vz *= 0.3; }
    // ground / bridges / air
    const s = walkY(v.x, v.z, v.y - 1.4);   // the drawn pavement; cars can climb a curb (0.8 m), not jump up onto a bridge deck above them
    const two = d.show && d.kind === 'road';
    // bunny hop / ollie: a quick tap is a small hop, a full 1-second load-up is about 2.7x the height
    if (two && input.hop && v.y <= s + 0.3) { v.vy = (d.hop || (v.type === 'motorbike' ? 7.5 : 6.5)) * (1 + 0.75 * Math.min(1, input.hop)); v.y = s + 0.35; sfx.bump?.(); if (input.hop > 0.85) input.onBigHop?.(); }
    if (v.y > s + (v.air || v.vy > 1.5 ? 0.3 : 0.6)) {   // small drops (curbs, dips) keep the wheels on the ground
      if (!v.air) { takeoff(v, v.x, v.z); if (two && input.jump && v.vy > 1) v.vy *= 1.35; }   // holding Space off a ramp lip = extra pop
      if (two) airControl(v, dt, input.steer, (input.down ? 1 : 0) - (input.up ? 1 : 0), 7, v.type === 'skate' ? 12 : 6.5);   // board flips spin fast   // A/D spin, W/S flip
      v.vy -= (two ? (input.jump && v.vy < 4 ? 11 : 14.5) : 17) * dt; v.y += v.vy * dt;   // floaty hang time (more while holding Space)
      if (v.y <= s) { v.y = s; if (v.vy < -8) sfx.bump(); v.vy = 0; const r = land(v, v.x, v.z, two ? 'bike' : 'car', input.player); if (r === 'bail' && two) input.onBail?.(); }
    } else {
      // suspension: small steps (curbs, road seams, the drawn-ground triangles) are eased over instead of snapped to
      const step = s - v.y, ny = Math.abs(step) < 0.45 ? v.y + step * Math.min(1, dt * 14) : s;
      v.vy = (ny - v.y) / Math.max(dt, 1e-3); v.vy = Math.min(v.vy, 16); v.y = ny;   // keep the ramp's upward speed so kickers launch you
      if (v.air) { const r = land(v, v.x, v.z, two ? 'bike' : 'car', input.player); if (r === 'bail' && two) input.onBail?.(); }
    }
    const hf = walkY(v.x + fx * d.len * 0.4, v.z + fz * d.len * 0.4, v.y - 1.4), hb = walkY(v.x - fx * d.len * 0.4, v.z - fz * d.len * 0.4, v.y - 1.4);
    const tp = Math.atan2(hf - hb, d.len * 0.8); v.pitch += (tp - v.pitch) * Math.min(1, dt * (v.air ? 10 : 5));   // gentler nose bob over bumps
    const lean = d.show && d.kind === 'road' ? -v.steer * Math.min(1, Math.abs(v.speed) / 10) * 0.45 : (v.rollT ?? -v.steer * Math.min(1, Math.abs(v.speed) / 30) * 0.05);
    v.roll += (lean - v.roll) * Math.min(1, dt * 6);
    if (isWater(v.x, v.z) && v.y < waterLevel(v.x, v.z) - 0.8) input.onSink?.();
    if (v.speedAbs > 3) { const hits = scarePeds(v.x, v.z, 9, Math.abs(v.speed), d.r + 0.6); if (hits) input.onHitPed?.(hits); }
  }
  v.speedAbs = Math.abs(v.speed);
  for (const w of v.wheels) { w.w.rotation.x -= v.speed * dt / w.r; if (w.front) w.piv.rotation.y = v.steer * 0.7; }
  syncModel(v);
  if (d.mdl?.Pk) engineSound(v, d.mdl, input); else engine(!d.quiet && (d.kind !== 'road' || !d.pedal && v.type !== 'scooter'), v.speedAbs, v.type === 'motorbike' ? 'motorbike' : v.type === 'jetski' ? 'jetski' : v.type === 'bus' ? 'bus' : 'car');
}

// ---------- real-model road physics (cars, trucks, motorbikes, buses: anything with a calibrated engine) ----------
// Longitudinal: engine push capped by traction (vehiclemodels.js longAccel), real braking, aero + rolling drag, engine
// braking when you lift off, gravity on hills. Lateral: bicycle-model yaw from the real wheelbase, speed-sensitive steering,
// a cornering limit from tyre grip (push past it and the car understeers), handbrake drifts and power-oversteer on
// strong rear-wheel-drive cars (the tail steps out if you floor it mid-corner), and a little drift assist so slides are
// catchable (arcade best practice). Body squats/dives/rolls with the forces (visual only: v.vp and v.rollT).
function roadEngine(v, dt, input, M, snow, wetGrip) {
  const d = v.d, two = d.show;
  const gripMul = snow ? (d.snowGrip || 0.35) : wetGrip;   // rain/snow reduce both launch and cornering grip
  v.steer += (input.steer * d.turn - v.steer) * Math.min(1, dt * (input.steer ? 3.2 : 6) * (M.resp || 1));
  const s = v.speed, as = Math.abs(s), boost = input.boost ? 1.22 : 1;
  let a = 0, push = 0, trac = M.mu * 1.25 * 9.81 * M.share * gripMul;
  if (input.up) {
    if (s < -0.3) a += M.brk * 0.8 * Math.min(1, gripMul * 1.2);   // W while rolling backwards = brake first
    else { push = Math.max(0, longAccel(M, Math.max(0, s), 1, boost, gripMul) + M.kA * s * s + M.crr); a += push; }
  }
  if (input.down) {
    if (s > 0.5) a -= M.brk * Math.min(1, 0.35 + gripMul * 0.75);   // real braking (ABS): ~0.9 g on dry tarmac, much less on snow
    else if (s > -8) a -= Math.min(4.5, trac * 0.7);   // reverse
  }
  if (input.brake && as > 0.3) a -= Math.sign(s) * 5.5 * Math.min(1, gripMul + 0.2);   // handbrake locks the rear
  const lift = !input.up && !input.down ? (two ? 0.9 : 1.1) : 0;   // engine braking when you lift off the gas
  a -= Math.sign(s) * (M.kA * s * s + M.crr + lift);
  const nv = s + a * dt; v.speed = (Math.sign(nv) !== Math.sign(s) && s !== 0 && !input.up && !input.down) ? 0 : nv;
  v.speed -= 9.81 * Math.sin(v.pitch) * dt;
  v.speed = clamp(v.speed, -9, M.topS * 1.6);
  v.longA += (a - (v.longA || 0)) * Math.min(1, dt * 6);
  // ---- steering: kinematic yaw (v·tanδ/wheelbase), less lock at speed, capped by the tyres' cornering grip ----
  const sp = v.speed, steerAng = v.steer / (1 + Math.abs(sp) / (two ? 20 : 15));
  let yawRate = sp * Math.tan(steerAng) / M.wb;
  const latMax = M.mu * 9.81 * gripMul * 1.12;
  v.under = 0;
  if (Math.abs(yawRate * sp) > latMax && Math.abs(sp) > 1) { const lim = latMax / Math.abs(sp); v.under = 1 - lim / Math.abs(yawRate); yawRate = Math.sign(yawRate) * lim; }
  // ---- drifting ----
  const rwd = M.drive === 'rwd' && !two, dr = M.drift || 1;
  const powerOver = rwd && input.up && Math.abs(input.steer) > 0 && push >= trac * 0.97 && sp > 4 && sp < 30 && M.Pk > 80;
  const want = (input.brake && Math.abs(sp) > 8 && !two) || powerOver ? 1 : 0;
  v.drift = (v.drift || 0) + (want - (v.drift || 0)) * Math.min(1, dt * (want ? 4 * dr : 1.6));
  if (v.drift > 0.05) yawRate += input.steer * 0.8 * dr * v.drift * Math.min(1, Math.abs(sp) / 12);   // drift assist: steer into / out of the slide
  const maxYaw = (two ? 2.2 : 1.35) * Math.sqrt(M.resp || 1) * (1 + 0.5 * v.drift);
  yawRate = clamp(yawRate, -maxYaw, maxYaw);
  v.yaw += yawRate * dt;
  // ---- velocity follows the heading: tyres grip hard, unless sliding ----
  const [fx, fz] = fwd(v), k = 8 * Math.min(1.2, gripMul * (M.mu / 0.9)) * (1 - 0.88 * v.drift);
  v.vx += (fx * v.speed - v.vx) * Math.min(1, dt * k); v.vz += (fz * v.speed - v.vz) * Math.min(1, dt * k);
  const slip = Math.abs(-v.vx * fz + v.vz * fx) / Math.max(3, Math.abs(v.speed));
  if (slip > 0.12) v.speed -= Math.sign(v.speed) * slip * 4 * dt;   // a slide scrubs speed
  v.slip = slip;
  // ---- weight transfer (visual): squat on the gas, dive on the brakes, roll outward in corners ----
  if (!two) {
    v.vp += (clamp(v.longA / 9.81, -1, 1) * 0.03 * (M.soft || 1) - v.vp) * Math.min(1, dt * 7);
    v.rollT = clamp(yawRate * v.speed / 9.81, -1.2, 1.2) * 0.05 * (M.soft || 1);
  }
}
// engine note: revs climb through the real number of gears and drop at each upshift; EVs whine; hybrids glide silently
function engineSound(v, M, input) {
  const s = Math.abs(v.speed), n = M.gears || 5;
  if (M.ev || (M.hyb && s < 9 && !input.boost)) return engine(true, s, 'car', { rpm: Math.min(1, s / M.topS), ev: true });
  let rpm, load = input.up ? 1 : 0.3;
  if (n <= 1) rpm = Math.min(1, 0.3 + 0.55 * Math.sqrt(s / M.topS) + (input.up ? 0.12 : 0));   // CVT: holds the revs
  else {
    const top = i => M.topS * Math.pow(i / n, 0.72);
    while (v.gr < n && s > top(v.gr) * 0.94) { v.gr++; v.shiftT = 0.12; }
    while (v.gr > 1 && s < top(v.gr - 1) * 0.62) v.gr--;
    rpm = 0.18 + 0.82 * Math.min(1, s / top(v.gr));
    if (v.shiftT > 0) { v.shiftT -= G.dt || 0.016; load = 0.2; rpm *= 0.85; }
  }
  engine(true, s, 'car', { rpm, pitch: M.pitch || 1, vol: M.vol || 1, load });
}
function flyHeli(v, dt, input) {
  v.rotorSpin = Math.min(1, v.rotorSpin + dt * 0.5);
  const lift = v.rotorSpin > 0.8;
  const [fx, fz] = fwd(v);
  const ax = (input.up ? 1 : 0) - (input.down ? 1 : 0), sx = (key('KeyE') ? 1 : 0) - (key('KeyQ') ? 1 : 0);
  v.yaw += input.steer * v.d.turn * dt;
  const acc = v.d.acc * (input.boost ? 1.4 : 1), vmax = v.d.max * (input.boost ? 1.25 : 1);   // Shift = more power
  v.vx += (fx * ax * acc + -fz * sx * acc * 0.6) * dt; v.vz += (fz * ax * acc + fx * sx * acc * 0.6) * dt;
  v.vx *= 1 - dt * 0.45; v.vz *= 1 - dt * 0.45;
  const sp = Math.hypot(v.vx, v.vz); if (sp > vmax) { v.vx *= vmax / sp; v.vz *= vmax / sp; }
  if (lift) v.vy += ((input.jump ? 9 : 0) - (input.descend ? 9 : 0)) * dt * 1.6;
  v.vy *= 1 - dt * 1.4; if (!lift) v.vy -= 6 * dt;
  v.x += v.vx * dt; v.z += v.vz * dt; v.y += v.vy * dt;
  const ground = Math.max(surfaceY(v.x, v.z, v.y + 3), isWater(v.x, v.z) ? waterLevel(v.x, v.z) : -1e9);
  if (v.y < ground) { if (v.vy < -10) input.onCrash?.(30); v.y = ground; v.vy = Math.max(0, v.vy); v.vx *= 0.9; v.vz *= 0.9; }
  v.y = Math.min(v.y, 2500);
  if (collideBuildings(v, 3, v.y + 2)) { const s2 = Math.hypot(v.vx, v.vz); if (s2 > 18) input.onCrash?.(s2); v.vx *= -0.3; v.vz *= -0.3; }
  const fwdSpeed = v.vx * fx + v.vz * fz, sideSpeed = -v.vx * fz + v.vz * fx;
  v.pitch += (-fwdSpeed / v.d.max * 0.35 - v.pitch) * Math.min(1, dt * 3);
  v.roll += (-sideSpeed / v.d.max * 0.4 - input.steer * 0.12 - v.roll) * Math.min(1, dt * 3);
  v.speed = fwdSpeed; v.speedAbs = Math.hypot(v.vx, v.vz, v.vy);
  v.rotor.rotation.y += dt * 40 * v.rotorSpin; v.tail.rotation.x += dt * 60 * v.rotorSpin;
  syncModel(v); engine(true, v.speedAbs + 40 * v.rotorSpin, 'heli');
  if (v.y - ground < 15 && sp > 5) scarePeds(v.x, v.z, 25);
}
function flyPlane(v, dt, input) {
  const d = v.d;
  if (v.crashed) {   // a mechanic patches it up after a few seconds (only a really reckless crash wrecks it, and even then not forever)
    v.speed = 0; v.throttle = 0; v.crashT = (v.crashT || 0) + dt; syncModel(v); engine(false, 0);
    if (v.crashT > 6) { repair(v); input.onRepair?.(); }
    return;
  }
  if (input.up) v.throttle = Math.min(1, v.throttle + dt * 0.45);
  if (input.down) v.throttle = Math.max(0, v.throttle - dt * 0.6);
  const prevY = v.y;
  const ow = isWater(v.x, v.z), wl = waterLevel(v.x, v.z), gy = ow ? wl : surfaceY(v.x, v.z, v.y + 3);
  const onSurface = v.y <= gy + 0.4 && (ow ? d.floats : d.gear);
  let acc = (v.throttle * d.max * (input.boost ? 1.2 : 1) - v.speed) * (onSurface ? 0.22 : 0.3) * (input.boost ? 1.3 : 1);   // Shift = extra power
  if (onSurface && input.down && v.throttle === 0) acc -= 9;   // wheel brakes
  v.speed = Math.max(0, v.speed + acc * dt);
  const canFly = v.speed > d.vr;
  const climb = (input.jump ? 1 : 0) - (input.descend ? 1 : 0);
  const agl = v.y - gy, nearGround = agl < 10 && (ow ? d.floats : d.gear);
  let pitchT = canFly ? climb * (d.gear && d.max > 120 ? 0.25 : 0.4) : (onSurface ? 0 : -0.15);   // too slow = a gentle glide, not a nosedive
  if (nearGround && pitchT < 0) pitchT = Math.max(pitchT, -0.1 * Math.max(0.2, agl / 10));   // auto-flare: the nose comes up for a soft touchdown
  v.pitch += (pitchT - v.pitch) * Math.min(1, dt * 1.5);
  v.yaw += input.steer * d.turn * dt * (onSurface ? 0.6 : 1);
  v.roll += ((onSurface ? 0 : -input.steer * 0.6) - v.roll) * Math.min(1, dt * 2.5);
  const [fx, fz] = fwd(v), hs = v.speed * Math.cos(v.pitch);
  v.x += fx * hs * dt; v.z += fz * hs * dt;
  v.y += v.speed * Math.sin(v.pitch) * dt - (canFly || onSurface ? 0 : 4 * dt);
  const ow2 = isWater(v.x, v.z), g2 = ow2 ? waterLevel(v.x, v.z) : surfaceY(v.x, v.z, v.y + 3);
  if (v.y < g2 + 0.05) {
    const ok = ow2 ? d.floats : d.gear, sink = (prevY - v.y) / Math.max(dt, 1e-3);
    // only a truly reckless arrival breaks it: diving in nose-first, slamming down, or cartwheeling on a wingtip
    const hard = sink > 16 || v.pitch < -0.55 || Math.abs(v.roll) > 1.0;
    if ((!ok && v.speed > 30) || (ok && hard && v.speed > 35)) { input.onCrash?.(Math.max(40, v.speed)); crash(v); }
    else if (ok && sink > 6) { sfx.bump?.(); input.onBumpyLanding?.(); }   // a bumpy landing: just a thud
    v.y = g2 + 0.05; if (!climb || !canFly) v.pitch = Math.max(v.pitch, 0);
    v.roll *= 0.5;
    if (!ok) v.speed = Math.min(v.speed, 7);   // belly-landing / wheels in the water: slows you right down (but a seaplane can still taxi over a bit of shore)
  }
  if (v.y < 400 && collideBuildings(v, d.r, v.y + 1)) {   // into a building: wrecked only if you hit it fast
    if (v.speed > 30) { input.onCrash?.(Math.max(40, v.speed)); crash(v); } else { v.speed = 0; v.throttle = 0; sfx.bump?.(); }
  }
  v.speedAbs = Math.abs(v.speed);
  if (v.prop) v.prop.rotation.z += dt * (8 + v.throttle * 60);
  syncModel(v); engine(true, v.speed, 'plane');
}
function crash(v) {
  if (v.crashed) return; v.crashed = true; v.crashT = 0; v.speed = 0; v.throttle = 0;
  v.g.traverse(o => { if (o.isMesh && o.material) { o.userData.okMat = o.material; o.material = o.material.clone(); o.material.color?.multiplyScalar(0.25); } });
  v.smoke = addMesh(new THREE.SphereGeometry(3, 8, 6), new THREE.MeshBasicMaterial({ color: '#333', transparent: true, opacity: 0.5, depthWrite: false }), 0, 4, 0, v.g, false);
  sfx.bump(); sfx.splash();
}
function repair(v) {
  v.crashed = false; v.crashT = 0; v.pitch = 0; v.roll = 0;
  v.g.traverse(o => { if (o.userData?.okMat) { o.material.dispose?.(); o.material = o.userData.okMat; delete o.userData.okMat; } });
  if (v.smoke) { v.g.remove(v.smoke); v.smoke = null; }
}

// ---------- traffic + parked vehicles near the player ----------
function spawnTraffic(px, pz, parked) {
  const cands = roadGrid.near(px, pz, 320, []);
  for (let tries = 0; tries < 10; tries++) {
    const e = cands[Math.floor(Math.random() * cands.length)]; if (!e) return;
    const r = M.roads[e.r]; if (!isDriveType(r.t) || r.t === 6 && !parked || parked && (r.t !== 5 || (r.o ? r.w < 9.3 : r.w < 13.6))) continue;   // parked only where two lanes stay clear
    const t = Math.random() * e.len, x = NX(e.a) + (NX(e.b) - NX(e.a)) * t / e.len, z = NZ(e.a) + (NZ(e.b) - NZ(e.a)) * t / e.len;
    const dd = Math.hypot(x - px, z - pz); if (dd < 90 || dd > 320) continue;
    if (vehicles.some(o => Math.hypot(o.x - x, o.z - z) < 12)) continue;
    // a real model, weighted by how common it is here and now (vehiclemodels.js tw / pw / when)
    const MD = parked ? pickModel(['car', 'suv', 'pickup', 'motorbike', 'van', 'sports'], x, z, true) : pickModel(['car', 'suv', 'pickup', 'taxi', 'van', 'sports', 'motorbike', 'bus'], x, z);
    const type = MD ? MD.id : 'car';
    const dir = r.o ? 1 : (Math.random() < 0.5 ? 1 : -1);
    const v = makeVehicle(type, x, z, 0, { y: nodeY[e.a] + (nodeY[e.b] - nodeY[e.a]) * t / e.len + 0.8 }); v.ai = { e, dir, t, parked, wait: 0, side: parked ? r.w / 2 - 1.2 : (r.o ? 0 : r.w / 4), k: aiPace(v) };
    if (parked) v.ai.side *= Math.random() < 0.5 ? 1 : -1;
    aiPlace(v); return;
  }
}
// cyclists riding in the curb lane (they stop at red lights too)
function spawnCyclist(px, pz) {
  const cands = roadGrid.near(px, pz, 260, []);
  for (let tries = 0; tries < 8; tries++) {
    const e = cands[Math.floor(Math.random() * cands.length)]; if (!e) return;
    const r = M.roads[e.r]; if (r.t < 3 || r.t > 5 || r.b || e.len < 20) continue;
    const t = Math.random() * e.len, x = NX(e.a) + (NX(e.b) - NX(e.a)) * t / e.len, z = NZ(e.a) + (NZ(e.b) - NZ(e.a)) * t / e.len, dd = Math.hypot(x - px, z - pz);
    if (dd < 70 || dd > 260 || vehicles.some(o => Math.hypot(o.x - x, o.z - z) < 10)) continue;
    const v = makeVehicle(pick(['roadbike', 'roadbike', 'mtb', 'ebike', 'ebike', 'cargo', 'mobee']), x, z, 0, { y: nodeY[e.a] + (nodeY[e.b] - nodeY[e.a]) * t / e.len + 0.8 });
    v.ai = { e, dir: r.o ? 1 : (Math.random() < 0.5 ? 1 : -1), t, parked: false, wait: 0, side: r.w / 2 - 0.9, cyc: true, k: v.model?.style === 'road' ? 1.2 : v.model?.style === 'share' ? 0.8 : R(0.9, 1.05) };
    const rider = makeHuman({ skin: pick(SKIN), hair: pick(HAIR), shirt: pick(['#e53e3e', '#38b2ac', '#ecc94b', '#1a202c', '#805ad5', '#f7fafc']), pants: pick(PANTS), hat: pick(['#e2e8f0', '#1a202c', '#c53030', '#2b6cb0']) });
    v.g.add(rider.grp); rider.grp.position.set(0, 0.55, 0); rider.grp.rotation.set(0, 0, 0); v.rider = rider;
    aiPlace(v); return;
  }
}
// a vehicle that drives away from the player (for chase missions)
export function makeRunner(type, x, z, fast = 1.5) {
  const nr = nearestRoad(x, z, 200, r => isDriveType(r.t) && r.t !== 6); if (!nr) return null;
  const e = nr.e, v = makeVehicle(type, x, z, 0, { keep: true, y: nodeY[e.a] + (nodeY[e.b] - nodeY[e.a]) * nr.t + 0.8 });
  v.ai = { e, dir: 1, t: nr.t * e.len, parked: false, wait: 0, side: M.roads[e.r].o ? 0 : M.roads[e.r].w / 4, flee: true, fast };
  aiPlace(v); return v;
}
// driver personality: every AI driver has their own pace; slow old vans and buses dawdle, sports cars push on
function aiPace(v) {
  const M = v.model; let k = R(0.88, 1.1);
  if (M) { if (M.base === 'sports') k *= 1.08; if (M.top < 140) k *= 0.85; if (M.base === 'bus') k *= 0.9; }
  return k;
}
function aiPlace(v) {
  const a = v.ai, A = a.dir > 0 ? a.e.a : a.e.b, B = a.dir > 0 ? a.e.b : a.e.a;
  const ax = NX(A), az = NZ(A), dx = NX(B) - ax, dz = NZ(B) - az, L = a.e.len || 1, ux = dx / L, uz = dz / L;
  const tx = ax + ux * a.t - uz * a.side, tz = az + uz * a.t + ux * a.side;
  if (a.rejoin > 0) { const dt = G.dt || 0.016, f = Math.min(1, dt * 2.5); a.rejoin -= dt; v.x += (tx - v.x) * f; v.z += (tz - v.z) * f; } else { v.x = tx; v.z = tz; }   // after a crash: steer back into the lane
  const ty = Math.atan2(-ux, -uz); v.yaw = a.parked ? ty : v.yaw + wrapAngle(ty - v.yaw) * 0.25;
  const s = walkY(v.x, v.z, v.y - 1.0); v.y += (s - v.y) * 0.5;
}
let lastHorn = -99;
function aiDrive(v, dt, pl) {
  const a = v.ai;
  if (a.parked) { syncModel(v); return; }
  const r = M.roads[a.e.r];
  const target = (a.cyc ? 5.5 : ((r.t === 0 ? 27 : r.t === 1 ? (r.rg ? 25 : 16) : r.t === 2 ? (r.rg ? 19 : 15) : r.t <= 4 ? 12 : 8.5) * (a.fast || 1))) * (a.k || 1);
  // look ahead for obstacles
  const [fx, fz] = fwd(v); let blocked = false;
  const check = (x, z) => { const dx = x - v.x, dz = z - v.z, ahead = dx * fx + dz * fz, side = Math.abs(-dx * fz + dz * fx); return ahead > 0 && ahead < 11 && side < 2.2; };
  if (check(pl.x, pl.z) && !a.flee) blocked = true;
  if (!a.flee) for (const o of vehicles) if (o !== v && Math.abs(o.x - v.x) < 14 && Math.abs(o.z - v.z) < 14 && check(o.x, o.z)) { blocked = true; break; }
  if (!a.flee) for (const p of peds) if (Math.abs(p.x - v.x) < 10 && Math.abs(p.z - v.z) < 10 && check(p.x, p.z)) { blocked = true; break; }
  // traffic lights: ease to a stop at the line on red (and on yellow if there's room to stop)
  let want = blocked ? 0 : target, nearSignal = false;
  if (!a.flee) {
    const node = a.dir > 0 ? a.e.b : a.e.a, rem = a.e.len - a.t;
    if (rem < 45 && isSignalNode(node)) {
      nearSignal = true;
      const ns = Math.abs(NZ(a.e.b) - NZ(a.e.a)) > Math.abs(NX(a.e.b) - NX(a.e.a)), s = signalState(node, ns), line = r.w / 2 + 5;
      if (rem > line - 1.5 && (s === 'r' || (s === 'y' && rem > line + 6))) want = Math.min(want, Math.max(0, (rem - line) * 1.1));
    }
  }
  v.speed += (want - v.speed) * Math.min(1, dt * (want < v.speed ? 3 : 1));
  if (nearSignal && v.speed < 1) blocked = false;   // waiting at a light is normal, no honking
  // honk only when stuck a while, close to the player, and not more than once every few seconds
  if (blocked) { a.wait += dt; const dp = Math.hypot(v.x - pl.x, v.z - pl.z); if (a.wait > 4 && dp < 70 && G.t - lastHorn > 4 && Math.random() < dt * 0.5) { sfx.horn(Math.max(0.25, 1 - dp / 70)); a.wait = 0; lastHorn = G.t; } } else a.wait = 0;
  a.t += v.speed * dt;
  let guard = 0;
  while (a.t > a.e.len && guard++ < 4) {
    a.t -= a.e.len;
    const node = a.dir > 0 ? a.e.b : a.e.a;
    let opts = nodeEdges[node].filter(e => e !== a.e && isDriveType(M.roads[e.r].t) && M.roads[e.r].t !== 6 && !(M.roads[e.r].o && e.b === node));
    if (!opts.length) opts = [a.e];
    let ne = opts[Math.floor(Math.random() * opts.length)];
    if (a.flee && opts.length > 1) { const far = n => Math.hypot(NX(n) - pl.x, NZ(n) - pl.z); ne = opts.slice().sort((p, q) => far(q.a === node ? q.b : q.a) - far(p.a === node ? p.b : p.a))[Math.random() < 0.75 ? 0 : 1]; }
    const nr = M.roads[ne.r];
    a.e = ne; a.dir = ne.a === node ? 1 : -1; a.side = a.cyc ? nr.w / 2 - 0.9 : nr.o ? 0 : nr.w / 4;
    if (a.e === ne && opts.length === 1 && ne === a.e && nr.o && a.dir < 0) a.dir = 1;
  }
  aiPlace(v);
  for (const w of v.wheels) w.w.rotation.x -= v.speed * dt / w.r;
  v.speedAbs = v.speed; syncModel(v);
  if (v.rider) { const st = v.rider.st; st.kind = 'ride'; st.amp = 0; st.phase += dt * v.speed * 1.6; v.rider.pose(dt); }
}

export function updateVehicles(dt, pl) {
  const px = pl.x, pz = pl.z;
  // despawn far traffic
  for (let i = vehicles.length - 1; i >= 0; i--) {
    const v = vehicles[i]; if (v.keep || v.driver) continue;
    if (Math.hypot(v.x - px, v.z - pz) > 420) removeVehicle(v);
  }
  const cyclists = vehicles.filter(v => v.ai && v.ai.cyc).length;
  if (cyclists < 6 && Math.random() < 0.05) spawnCyclist(px, pz);
  const ai = vehicles.filter(v => v.ai && !v.ai.parked && !v.ai.cyc).length, parked = vehicles.filter(v => v.ai && v.ai.parked).length;
  if (!pl.flying || pl.vehicle?.y < 80) {
    if (ai < (G.trafficTarget ?? 28)) spawnTraffic(px, pz, false);
    if (parked < 16) spawnTraffic(px, pz, true);
  }
  spawnNearbyMicromobility(px, pz);
  for (const v of vehicles) {
    if (v.driver === 'player') { v.g.visible = true; continue; }
    // parked/fixed vehicles far away are not drawn (big planes and boats stay visible further)
    const vd = Math.abs(v.x - px) + Math.abs(v.z - pz); v.g.visible = vd < (v.d.kind === 'plane' || v.d.kind === 'water' || v.d.kind === 'heli' ? 3000 : 900) || !!v.script;
    if (v.knock) { knockStep(v, dt); continue; }   // shoved / spun / tipped over (crash physics below)
    if (!v.g.visible && !v.ai) continue;
    if (v.ai) { aiDrive(v, dt, pl); if (v.model?.id === 'icecream') iceCreamJingle(v, pl); }
    else if ((v.d.kind === 'water' || v.d.kind === 'plane') && isWater(v.x, v.z) && v.y < waterLevel(v.x, v.z) + 1) { v.y = waterLevel(v.x, v.z) + 0.05 + Math.sin(G.t * 1.5 + v.id) * 0.05; syncModel(v); }
    else if (v.d.kind === 'heli' && v.rotorSpin > 0) { v.rotorSpin = Math.max(0, v.rotorSpin - dt * 0.2); v.rotor.rotation.y += dt * 40 * v.rotorSpin; }
  }
  // crashes: the player's ride vs every other vehicle, and shoved vehicles vs the ones they slide into (chain reactions)
  const pv = pl.vehicle;
  if (pv && pv.d.kind === 'road' && !pv.air) for (const o of vehicles) if (o !== pv && o.d.kind === 'road') collidePair(pv, o, pl);
  for (const o of vehicles) if (o.knock && o !== pv) for (const q of vehicles) if (q !== o && q !== pv && q.d.kind === 'road' && (!q.knock || q.id > o.id)) collidePair(o, q, null);
  // on foot: sprinting into a parked bike or scooter knocks it over
  if (!pv && dt > 0) {
    const fvx = (px - (pl._lx ?? px)) / dt, fvz = (pz - (pl._lz ?? pz)) / dt, fs = Math.hypot(fvx, fvz);
    if (fs > 3.5 && fs < 20) for (const o of vehicles) {
      if (!o.d.show || o.d.kind !== 'road' || o.driver || (o.ai && !o.ai.parked) || Math.abs(o.roll) > 0.8 || Math.abs(o.x - px) > 2 || Math.abs(o.z - pz) > 2) continue;
      if (Math.hypot(o.x - px, o.z - pz) < o.d.r + 0.5 && Math.abs(o.y - pl.y) < 1.5) { knock(o, fvx * 0.5, fvz * 0.5, R(-2, 2), fs); sfx.bump(); crashHooks.hit?.(null, o, fs, pl); }
    }
  }
  pl._lx = px; pl._lz = pz;
}

// ---------- crash physics: who gets shoved, spun, rocked or tipped over ----------
// mass decides everything: a bus barely notices a bike, a bike stops dead against a bus, a parked car slides and spins
const BASE_KG = { bike: 16, scooter: 15, skate: 4, motorbike: 190, snowmobile: 250, bus: 12500, van: 2600, pickup: 2300, suv: 2000, tug: 2500, sports: 1500, taxi: 1500 };
export function massOf(v) { return (v.d.kg || BASE_KG[v.type] || 1450) + (v.driver || v.rider ? 75 : 0); }
export const crashHooks = {};   // crashfx.js: car alarms, angry drivers, hubcaps…
const bodyW = v => v.model?.body?.W || SPECS[v.type]?.W || (v.d.show ? 0.6 : 1.9);
const bodyL = v => v.model?.body?.L || SPECS[v.type]?.L || v.d.len;
const velOf = (v, pl) => v.knock ? [v.knock.vx, v.knock.vz] : (pl && v === pl.vehicle) ? [v.vx, v.vz] : (v.ai && !v.ai.parked) ? [-Math.sin(v.yaw) * v.speed, -Math.cos(v.yaw) * v.speed] : [0, 0];
// closest points between two 2D segments (each vehicle is a capsule along its length)
function segClosest(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1x = bx - ax, d1z = bz - az, d2x = dx - cx, d2z = dz - cz, rx = ax - cx, rz = az - cz;
  const a = d1x * d1x + d1z * d1z, e = d2x * d2x + d2z * d2z, f = d2x * rx + d2z * rz;
  let s, t;
  if (a < 1e-6 && e < 1e-6) { s = t = 0; }
  else if (a < 1e-6) { s = 0; t = clamp(f / e, 0, 1); }
  else { const c = d1x * rx + d1z * rz; if (e < 1e-6) { t = 0; s = clamp(-c / a, 0, 1); } else { const b = d1x * d2x + d1z * d2z, den = a * e - b * b; s = den > 1e-6 ? clamp((b * f - c * e) / den, 0, 1) : 0; t = (b * s + f) / e; if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); } } }
  return [ax + d1x * s, az + d1z * s, cx + d2x * t, cz + d2z * t];
}
function capsule(v) { const W = bodyW(v), h = Math.max(0, bodyL(v) / 2 - W / 2), fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw); return [v.x + fx * h, v.z + fz * h, v.x - fx * h, v.z - fz * h, W / 2]; }
let bumpCool = 0;
function collidePair(a, b, pl) {
  if (Math.abs(a.x - b.x) > 16 || Math.abs(a.z - b.z) > 16 || Math.abs(a.y - b.y) > 2 || b.d.kind !== 'road' || b.script) return;
  const A = capsule(a), B = capsule(b), [px, pz, qx, qz] = segClosest(A[0], A[1], A[2], A[3], B[0], B[1], B[2], B[3]);
  let nx = qx - px, nz = qz - pz; const dist = Math.hypot(nx, nz), min = A[4] + B[4];
  if (dist >= min) return;
  if (dist < 1e-3) { nx = b.x - a.x; nz = b.z - a.z; const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l; } else { nx /= dist; nz /= dist; }
  const ma = massOf(a), mb = massOf(b), [avx, avz] = velOf(a, pl), [bvx, bvz] = velOf(b, pl);
  const vr = (avx - bvx) * nx + (avz - bvz) * nz;   // closing speed along the contact normal
  const heavyAI = b.ai && !b.ai.parked && !b.knock;
  const J = vr > 0.5 ? 1.25 * vr / (1 / ma + 1 / mb) : 0, dvb = J / mb;
  const moveB = !heavyAI || dvb > 0.5;
  // push apart (heavier one moves less; moving AI traffic only moves if it really gets knocked)
  const over = min - dist + 0.02, sa = moveB ? mb / (ma + mb) : 1;
  a.x -= nx * over * sa; a.z -= nz * over * sa;
  if (moveB) { b.x += nx * over * (1 - sa); b.z += nz * over * (1 - sa); }
  if (!J) { if (moveB && !b.knock && !b.ai) syncModel(b); return; }
  // spin: the hit lands off-centre on b (contact point on its surface), so it turns
  const cx = qx - nx * B[4] - b.x, cz = qz - nz * B[4] - b.z, L = bodyL(b), W = bodyW(b), I = mb * (L * L + W * W) / 12;
  const dw = clamp((cz * nx - cx * nz) * J / I, -4, 4);
  if (moveB) knock(b, nx * dvb, nz * dvb, dw, vr);
  // a: the player's ride loses speed by the mass ratio (or bounces back); a shoved car just keeps sliding
  const dva = J / ma;
  if (pl) {
    const nvx = avx - nx * dva, nvz = avz - nz * dva, fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
    a.vx = nvx; a.vz = nvz; a.speed = nvx * fx + nvz * fz;
    a.yaw -= clamp((cz * nx - cx * nz) * J / (ma * (bodyL(a) ** 2 + bodyW(a) ** 2) / 12), -0.6, 0.6) * 0.15;   // a little twitch back
    if (vr > 2.5) { sfx.bump(); if (vr > 6 && G.t > bumpCool) { bumpCool = G.t + 0.8; pl.stats && (pl.stats.bumps = (pl.stats.bumps || 0) + 1); } }
    if (a.d.show && dva > 6) a.roll = clamp(a.roll + R(-0.6, 0.6), -0.9, 0.9);   // two-wheeler: a big wobble
    crashHooks.hit?.(a, b, vr, pl);
  } else { a.knock.vx -= nx * dva; a.knock.vz -= nz * dva; if (vr > 3) sfx.bump(); crashHooks.hit?.(a, b, vr, null); }
}
// start (or add to) a vehicle's "knocked loose" slide
export function knock(o, ix, iz, dw, hit) {
  if (o.driver === 'player') return;
  let k = o.knock;
  if (!k) { const [vx, vz] = velOf(o, null); k = o.knock = { vx, vz, w: 0, rv: 0, pv: 0, t: 0, rest: 0, tip: 0, wob: 0, sc: o.g.scale.clone() }; o.speed = 0; }
  k.vx += ix; k.vz += iz; k.w += dw; if (Math.hypot(ix, iz) > 0.3 || Math.abs(dw) > 0.1) { k.t = 0; k.rest = 0; k.up = false; }   // a gentle touch doesn't restart the "get back up" timer
  const rx = Math.cos(o.yaw), rz = -Math.sin(o.yaw), lat = ix * rx + iz * rz, lon = -(ix * -Math.sin(o.yaw) + iz * -Math.cos(o.yaw));
  if (o.d.show) { if (!(Math.abs(o.roll) > 0.6 && k.tip) && (Math.hypot(ix, iz) > 0.8 || hit > 3)) { k.tip = (lat > 0 ? -1 : 1) * R(1.35, 1.5); k.rv = -Math.sign(lat || 1) * Math.min(3, 0.5 + hit * 0.15); } }   // already lying down: stays on that side
  else { k.rv += clamp(-lat * 0.09, -0.9, 0.9); k.pv += clamp(lon * 0.05, -0.5, 0.5); k.wob = Math.min(1, k.wob + hit / 12); if (hit > 9) o.dent = Math.min(0.1, (o.dent || 0) + hit * 0.003); }
}
function knockStep(v, dt) {
  const k = v.knock; k.t += dt;
  const two = v.d.show, down = two && Math.abs(v.roll) > 0.8, sp = Math.hypot(k.vx, k.vz);
  const fr = (down ? 5.5 : two ? 4 : 7) * dt;   // tyres skidding sideways (or a bike sliding on its side)
  if (sp > fr) { k.vx -= k.vx / sp * fr; k.vz -= k.vz / sp * fr; } else k.vx = k.vz = 0;
  k.w *= Math.exp(-dt * (down ? 3 : 2.2));
  const ox = v.x, oz = v.z; v.x += k.vx * dt; v.z += k.vz * dt; v.yaw += k.w * dt;
  // walls stop it (map outlines that poke into the street don't), small street stuff gets smashed by a sliding car
  const rd = nearestRoad(v.x, v.z, 14, q => isDriveType(q.t)), onRoad = rd && rd.d < rd.road.w / 2 - 1.2;
  const p = { x: v.x, z: v.z, kg: massOf(v) };
  if ((!onRoad && collideBuildings(p, v.d.r, v.y)) | collideStatic(p, v.d.r * 0.85, v.y + 0.3, sp, sp > 0.1 ? [k.vx / sp, k.vz / sp] : null)) { v.x = p.x; v.z = p.z; k.vx *= -0.2; k.vz *= -0.2; k.w *= 0.5; }
  if (p.broke) { const f = p.kg / (p.kg + (p.brokeKg || 0) * 1.6); k.vx *= f; k.vz *= f; }
  const s = walkY(v.x, v.z, v.y - 1.0); v.y += (s - v.y) * Math.min(1, dt * 10);
  if (two) {   // falls over, faster as it goes, with a little bounce on the ground
    if (k.tip && !k.up) { k.rv += Math.sign(k.tip) * dt * 9; v.roll += k.rv * dt; if (Math.abs(v.roll) >= Math.abs(k.tip)) { v.roll = k.tip; k.rv = -k.rv * 0.25; if (Math.abs(k.rv) < 0.3) k.rv = 0; } }
  } else {     // body rocks on its springs, nose dips/lifts, and the panels wobble
    k.rv += (-38 * v.roll - 4.5 * k.rv) * dt; v.roll += k.rv * dt;
    k.pv += (-45 * v.pitch - 5 * k.pv) * dt; v.pitch += k.pv * dt;
    const w = k.wob * Math.sin(k.t * 30) * Math.exp(-k.t * 4) * 0.06, dn = v.dent || 0;
    v.g.scale.set(k.sc.x * (1 + w), k.sc.y * (1 - w * 0.6 - dn * 0.4), k.sc.z * (1 - dn));
  }
  for (const wh of v.wheels) wh.w.rotation.x -= sp * dt / wh.r;
  syncModel(v);
  if (v.rider && v.rider.pose) { const st = v.rider.st; st.kind = 'ride'; st.amp = 0; v.rider.pose(dt); }
  // settled?
  if (sp > 0.15 || Math.abs(k.w) > 0.06 || k.t < 0.8 || (!two && Math.abs(k.rv) > 0.05)) return;
  k.rest += dt;
  const a = v.ai;
  if (!a || a.parked) { if (!two) v.roll = v.pitch = 0; v.g.scale.set(k.sc.x, k.sc.y * (1 - (v.dent || 0) * 0.4), k.sc.z * (1 - (v.dent || 0))); v.knock = null; syncModel(v); return; }   // parked things just stay where they ended up
  if (two && k.tip) {   // a knocked-down cyclist picks the bike up after a few seconds
    if (k.rest < 3) return;
    k.up = true; v.roll *= Math.exp(-dt * 4); syncModel(v); if (Math.abs(v.roll) > 0.05) return;
  } else if (k.rest < 2.2) return;
  // the driver collects themselves and drives off: back to the nearest lane
  v.roll = v.pitch = 0; v.knock = null;
  if (!two) v.g.scale.set(k.sc.x, k.sc.y * (1 - (v.dent || 0) * 0.4), k.sc.z * (1 - (v.dent || 0)));
  const nr = nearestRoad(v.x, v.z, 25, r => isDriveType(r.t) && r.t !== 6 && (!a.cyc || (r.t >= 3 && r.t <= 5)));
  if (!nr || nr.d > 14) { v.ai = null; syncModel(v); return; }   // too far off the road: left there (towed away later)
  const r = nr.road, ex = NX(nr.e.b) - NX(nr.e.a), ez = NZ(nr.e.b) - NZ(nr.e.a), fwdDot = -Math.sin(v.yaw) * ex - Math.cos(v.yaw) * ez;
  a.e = nr.e; a.t = nr.t * nr.e.len; a.dir = r.o ? 1 : (fwdDot >= 0 ? 1 : -1); if (a.dir < 0) a.t = nr.e.len - a.t;
  a.side = a.cyc ? r.w / 2 - 0.9 : r.o ? 0 : r.w / 4; a.rejoin = 1.6; a.wait = 0; v.speed = 0;
}

// surprise: the ice cream truck plays its tune when it's near you (a little 8-note jingle every ~7 s)
let jingleT = 0;
function iceCreamJingle(v, pl) {
  const dd = Math.hypot(v.x - pl.x, v.z - pl.z); if (dd > 70 || G.t < jingleT) return;
  jingleT = G.t + 7; beep([784, 659, 784, 880, 784, 659, 523, 587], 0.16, 'triangle', 0.05 * Math.max(0.25, 1 - dd / 70), 0.19);
  if (!pl.vehicle && dd < 25 && Math.random() < 0.3) say({ x: v.x, z: v.z, y: v.y + 1 }, pick(['🍦 Ice cream!', 'Get your Drippy Dip!', '🍦🍦🍦']));
}
// bike-share bikes at real bike-share stations, scooters and bikes sprinkled around
const stationsDone = new Set();
let microTimer = 0;
function spawnNearbyMicromobility(px, pz) {
  microTimer -= G.dt; if (microTimer > 0) return; microTimer = 1.5;
  for (const p of pois) {
    if (p.k !== 'bicycle_rental' || stationsDone.has(p) || Math.hypot(p.x - px, p.z - pz) > 300) continue;
    stationsDone.add(p);
    for (let i = 0; i < 2; i++) makeVehicle('bike', p.x + i * 1.2, p.z + 1, 0, { keep: true });
  }
  const loose = vehicles.filter(v => !v.keep && !v.ai && (v.type === 'scooter' || v.type === 'bike')).length;
  if (loose < 10) {
    const nr = nearestRoad(px + R(-200, 200), pz + R(-200, 200), 40, r => r.t >= 2 && r.t <= 8);
    if (nr && Math.hypot(NX(nr.e.a) - px, NZ(nr.e.a) - pz) > 60) {
      const r = nr.road, x = NX(nr.e.a) + (NX(nr.e.b) - NX(nr.e.a)) * nr.t, z = NZ(nr.e.a) + (NZ(nr.e.b) - NZ(nr.e.a)) * nr.t;
      const off = r.t <= 6 ? r.w / 2 + 1.3 : 0.8, ang = Math.atan2(NX(nr.e.b) - NX(nr.e.a), NZ(nr.e.b) - NZ(nr.e.a));
      makeVehicle(Math.random() < 0.7 ? 'scooter' : 'bike', x + Math.cos(ang) * off, z - Math.sin(ang) * off, R(0, 6));
    }
  }
}

export function nearestVehicle(x, z, y, rad = 3.5) {
  let b = null, bd = rad;
  for (const v of vehicles) { const d = Math.hypot(v.x - x, v.z - z) - (v.d.len > 6 ? Math.min(v.d.len * 0.3, 14) : 0); if (d < bd && Math.abs(v.y - y) < (v.d.len > 30 ? 8 : 4) && !v.script) { bd = d; b = v; } }
  return b;
}

// fixed vehicles around the city
export function placeFixedVehicles() {
  const findWater = (x, z) => { for (let r = 0; r < 120; r += 4) for (let a = 0; a < 6.28; a += 0.4) { const X = x + Math.cos(a) * r, Z = z + Math.sin(a) * r; if (isWater(X, Z) && isWater(X + 8, Z) && isWater(X - 8, Z) && isWater(X, Z + 8) && isWater(X, Z - 8)) return [X, Z]; } return [x, z]; };
  const findLand = (x, z) => { for (let r = 0; r < 80; r += 3) for (let a = 0; a < 6.28; a += 0.5) { const X = x + Math.cos(a) * r, Z = z + Math.sin(a) * r; if (!isWater(X, Z) && !buildingAt(X, Z)) return [X, Z]; } return [x, z]; };
  const at = (lat, lon) => toXZ(lat, lon);
  // Harbour air seaplanes in Coal Harbour
  let [x, z] = findWater(...at(49.2915, -123.1185)); makeVehicle('beaver', x, z, 0.4, { keep: true, label: 'Harbour Err Beaver' });
  [x, z] = findWater(...at(49.2925, -123.1225)); makeVehicle('otter', x, z, 1.2, { keep: true, label: 'Harbour Err Otter' });
  // helicopter on the waterfront heliport + one on top of a hospital-ish pad near BC Place
  [x, z] = findLand(...at(49.2869, -123.1050)); const hp = makeVehicle('astar', x, z, 0, { keep: true }); helipad(hp);
  [x, z] = findLand(...at(49.2745, -123.1105)); helipad(makeVehicle('jetranger', x, z, 1.5, { keep: true }));
  // jet skis
  for (const [lat, lon] of [[49.2928, -123.1300], [49.2725, -123.1318], [49.2862, -123.1425], [49.2752, -123.1525]]) { [x, z] = findWater(...at(lat, lon)); makeVehicle(pick(['spark', 'spark', 'rxp']), x, z, R(0, 6), { keep: true }); }
  // boats: kayaks, sailboats, speedboats and yachts (swim or walk up and press F)
  // boats look further for open water (bigger boats need more room) and point at the most open water
  const roomy = (X, Z, m) => isWater(X, Z) && isWater(X + m, Z) && isWater(X - m, Z) && isWater(X, Z + m) && isWater(X, Z - m);
  const boat = (type, lat, lon, color) => {
    const [x0, z0] = at(lat, lon), m = VT[type].len * 0.6 + 2; let bx = x0, bz = z0;
    find: for (let r = 0; r < 500; r += 5) for (let a = 0; a < 6.28; a += 0.25) { const X = x0 + Math.cos(a) * r, Z = z0 + Math.sin(a) * r; if (roomy(X, Z, m)) { bx = X; bz = Z; break find; } }
    let best = 0, by = 0; for (let k = 0; k < 16; k++) { const yw = k / 16 * Math.PI * 2, fx = -Math.sin(yw), fz = -Math.cos(yw); let d = 0; while (d < 80 && isWater(bx + fx * d, bz + fz * d)) d += 4; if (d > best) { best = d; by = yw; } }
    const alt = { speedboat: ['bowrider', 'bowrider', 'rib'], kayak: ['seakayak', 'sup', null] }[type];
    makeVehicle(alt ? (pick(alt) || type) : type, bx, bz, by, { keep: true, color });
  };
  for (let i = 0; i < 3; i++) boat('kayak', 49.3292 + i * 0.0003, -122.9462, pick(['#f6e05e', '#e53e3e', '#38a169']));   // Deep Cove
  boat('kayak', 49.2722, -123.1340, '#ed8936'); boat('kayak', 49.2755, -123.1560, '#e53e3e'); boat('kayak', 50.1105, -122.9800, '#38a169'); boat('kayak', 49.3765, -123.2760, '#f6e05e');
  boat('sailboat', 49.2780, -123.1570, '#2b6cb0'); boat('sailboat', 49.2870, -123.1500, '#c53030'); boat('sailboat', 49.2752, -123.1980, '#2f855a'); boat('sailboat', 49.6880, -123.1620, '#2b6cb0');
  boat('speedboat', 49.2918, -123.1272, '#c53030'); boat('speedboat', 49.2718, -123.1290, '#2b6cb0'); boat('speedboat', 49.3745, -123.2735, '#1a202c');
  boat('yacht', 49.2912, -123.1290, '#ffffff', 2.4); boat('yacht', 49.2905, -123.1335, '#ffffff', 2.6); boat('yacht', 49.3758, -123.2770, '#ffffff', 1.2);
  // fun parked rides
  [x, z] = findLand(...at(49.2841, -123.1080)); makeVehicle('corvette', x, z, 1.6, { keep: true, color: '#c53030' });
  // surprises: a lime-green supercar at Coal Harbour, an offshore racer in the marina, a stainless-steel time machine in a Gastown lane, a camper van at Kits Beach
  [x, z] = findLand(...at(49.2905, -123.1258)); makeVehicle('lambo', x, z, 0.9, { keep: true, color: '#8fd400' });
  [x, z] = findWater(...at(49.2908, -123.1245)); makeVehicle('cigarette', x, z, 0.5, { keep: true });
  [x, z] = findLand(...at(49.2836, -123.1062)); makeVehicle('delorian', x, z, 2.2, { keep: true });
  [x, z] = findLand(...at(49.2745, -123.1545)); makeVehicle('westy', x, z, 0.4, { keep: true, color: '#c97a2b' });
  [x, z] = findLand(...at(49.2722, -123.1350)); makeVehicle('van', x, z, 0.3, { keep: true });
  // Sea-to-Sky + Whistler
  [x, z] = findWater(...at(50.1440, -122.9500)); makeVehicle('seaplane', x, z, 2.5, { keep: true, label: 'Harbour Err seaplane' });
  [x, z] = findWater(...at(50.1100, -122.9810)); makeVehicle('jetski', x, z, 1, { keep: true, color: '#38b2ac' });
  [x, z] = findWater(...at(49.3755, -123.2750)); makeVehicle('jetski', x, z, 1, { keep: true, color: '#e53e3e' });
  [x, z] = findLand(...at(50.1185, -122.9470)); helipad(makeVehicle('heli', x, z, 0.5, { keep: true }));
  [x, z] = findLand(...at(49.7010, -123.1560)); helipad(makeVehicle('heli', x, z, 2, { keep: true }));
  [x, z] = findLand(...at(49.3770, -123.2705)); makeVehicle('p911', x, z, 0, { keep: true, color: '#e6b400' });
  for (let i = 0; i < 4; i++) { [x, z] = findLand(...at(50.1162 + i * 0.00005, -122.9532)); makeVehicle(i < 2 ? 'mtb' : 'roadbike', x + i * 1.2, z, 0, { keep: true }); }
  for (let i = 0; i < 2; i++) { [x, z] = findLand(...at(49.7005, -123.1545)); makeVehicle('bike', x + i * 1.2, z, 0, { keep: true }); }
}
function helipad(v) {
  const m = addMesh(new THREE.CylinderGeometry(9, 9, 0.3, 32), std('#3a3d40'), v.x, v.y + 0.05, v.z);
  addMesh(new THREE.TorusGeometry(6.5, 0.25, 4, 40).rotateX(Math.PI / 2), std('#f6e05e'), v.x, v.y + 0.25, v.z, scene, false);
  addMesh(new THREE.BoxGeometry(1, 0.05, 6), std('#fff'), v.x - 1.8, v.y + 0.22, v.z, scene, false); addMesh(new THREE.BoxGeometry(1, 0.05, 6), std('#fff'), v.x + 1.8, v.y + 0.22, v.z, scene, false); addMesh(new THREE.BoxGeometry(2.6, 0.05, 1), std('#fff'), v.x, v.y + 0.22, v.z, scene, false);
  v.y += 0.3; syncModel(v);
}
