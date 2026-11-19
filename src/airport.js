// YVR Vancouver International Airport: real runways/taxiways/aprons, tower, signs, parked + flying airliners.
import * as THREE from 'three';
import { G, scene, std, addMesh, toXZ, canvasTex, R, pick, farCull } from './core.js';
import { heightAt } from './terrain.js';
import { makeVehicle, vehicles } from './vehicles.js';
import { SPOTS } from './landmarks.js';
import { addFlatSurface, addDeck } from './city.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
const pending = new Map();
function queue(geo, mat) { if (!pending.has(mat)) pending.set(mat, []); pending.get(mat).push(geo.index ? geo.toNonIndexed() : geo); }
function flush() { for (const [mat, geos] of pending) { for (const g of geos) { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); } const m = new THREE.Mesh(mergeGeometries(geos), mat); m.receiveShadow = true; scene.add(m); } pending.clear(); }

const M = window.MAP;
export const AIRPORT = { spots: {} };
const at = (lat, lon) => { const [x, z] = toXZ(lat, lon); return { x, z, y: heightAt(x, z) }; };

const runwayTex = canvasTex(256, 512, (c, w, h) => {
  c.fillStyle = '#3d3f42'; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 4000; i++) { c.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.07})`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  c.fillStyle = '#f2f2f2'; c.fillRect(6, 0, 5, h); c.fillRect(w - 11, 0, 5, h);   // edge lines
  c.fillRect(w / 2 - 3, 0, 6, h * 0.45);                                          // centre dashes
});
const taxiTex = canvasTex(128, 256, (c, w, h) => {
  c.fillStyle = '#4a4c4f'; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 1500; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  c.fillStyle = '#e8c43a'; c.fillRect(w / 2 - 2, 0, 4, h);
});
const keysTex = canvasTex(256, 128, (c, w, h) => { c.fillStyle = '#3d3f42'; c.fillRect(0, 0, w, h); c.fillStyle = '#f2f2f2'; for (let i = 0; i < 12; i++) c.fillRect(10 + i * 20, 10, 10, h - 20); }, false);

const skirtMat = std('#6f6d68', { roughness: 1, side: THREE.DoubleSide });
function skirt(pts, y, closed) {
  const pos = [], idx = []; const n = pts.length;
  for (let i = 0; i < n; i++) { pos.push(pts[i].x, y, pts[i].z, pts[i].x, y - 8, pts[i].z); if (i < n - 1 || closed) { const k = i * 2, k2 = ((i + 1) % n) * 2; idx.push(k, k2, k + 1, k + 1, k2, k2 + 1); } }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  queue(geo, skirtMat);
}
function strip(pts, w, y, mat, vScale) {
  const pos = [], uv = [], idx = []; let dist = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
    let dx = q.x - o.x, dz = q.z - o.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    if (i) dist += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    pos.push(p.x + dz * w / 2, y, p.z - dx * w / 2, p.x - dz * w / 2, y, p.z + dx * w / 2); uv.push(0, dist * vScale, 1, dist * vScale);
    if (i) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx); geo.computeVertexNormals();
  queue(geo, mat); const m = null;
  const L = [], Rr = []; for (let i = 0; i < pos.length; i += 6) { L.push({ x: pos[i], z: pos[i + 2] }); Rr.push({ x: pos[i + 3], z: pos[i + 5] }); }
  skirt(L, y, false); skirt(Rr, y, false);
  for (let i = 1; i < pts.length; i++) addDeck(pts[i - 1].x, pts[i - 1].z, y, pts[i].x, pts[i].z, y, w / 2);
  return m;
}

export const runways = [];
export function buildAirport() {
  const aero = M.aero || []; if (!aero.length) return;
  const rwMat = new THREE.MeshStandardMaterial({ map: runwayTex, roughness: 0.9, side: THREE.DoubleSide });
  const twMat = new THREE.MeshStandardMaterial({ map: taxiTex, roughness: 0.9, side: THREE.DoubleSide });
  const keyMat = new THREE.MeshStandardMaterial({ map: keysTex, roughness: 0.9, side: THREE.DoubleSide });
  // the whole airport sits on one flat level (real airports are flat!)
  const samples = []; for (const f of aero) for (let i = 0; i < f.p.length; i += 2) samples.push(heightAt(f.p[i], f.p[i + 1]));
  samples.sort((p, q) => p - q); const LV = samples[Math.floor(samples.length * 0.9)] + 0.05;
  AIRPORT.level = LV;
  // aprons (concrete pads)
  const apronMat = std('#8d8b86', { roughness: 0.95, side: THREE.DoubleSide });
  for (const a of M.areas) {
    if (a.ae !== 'apron' || a.line) continue;
    const sh = new THREE.Shape(); for (let i = 0; i < a.p.length; i += 2) i ? sh.lineTo(a.p[i], -a.p[i + 1]) : sh.moveTo(a.p[i], -a.p[i + 1]);
    const ag = new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2);
    ag.translate(0, LV + 0.12, 0); queue(ag, apronMat);
    const ring = []; for (let i = 0; i < a.p.length; i += 2) ring.push({ x: a.p[i], z: a.p[i + 1] }); skirt(ring, LV + 0.12, true);
    addFlatSurface(a.p, LV + 0.12);
  }
  for (const a of aero) {
    const pts = []; for (let i = 0; i < a.p.length; i += 2) pts.push({ x: a.p[i], z: a.p[i + 1] });
    const ymax = LV;
    if (a.t === 'runway') {
      strip(pts, a.w, ymax + 0.3, rwMat, 1 / 60);
      const s = pts[0], e = pts[pts.length - 1], len = Math.hypot(e.x - s.x, e.z - s.z), ux = (e.x - s.x) / len, uz = (e.z - s.z) / len;
      for (const [p, dir] of [[s, 1], [e, -1]]) strip([{ x: p.x + ux * dir * 10, z: p.z + uz * dir * 10 }, { x: p.x + ux * dir * 60, z: p.z + uz * dir * 60 }], a.w * 0.9, ymax + 0.33, keyMat, 1 / 50);
      runways.push({ s, e, len, ux, uz, y: ymax + 0.3, w: a.w, ref: a.ref });
    } else strip(pts, a.w, ymax + 0.25, twMat, 1 / 30);
  }
  runways.sort((a, b) => b.len - a.len);
  flush();

  // control tower, YVR sign, Jade Canoe, flight path park
  const tw = at(49.1937, -123.1838); AIRPORT.spots.tower = { ...tw, name: 'YVR Control Tower' };
  addMesh(new THREE.CylinderGeometry(4, 6, 70, 16), std('#d8d4cc'), tw.x, tw.y + 35, tw.z);
  addMesh(new THREE.CylinderGeometry(9, 7, 8, 16), std('#1c2b33', { metalness: 0.9, roughness: 0.1 }), tw.x, tw.y + 74, tw.z);
  addMesh(new THREE.CylinderGeometry(10, 10, 1.5, 16), std('#d8d4cc'), tw.x, tw.y + 78.5, tw.z);
  addMesh(new THREE.CylinderGeometry(0.2, 0.2, 10), std('#ccc'), tw.x, tw.y + 84, tw.z);
  const sp = at(49.1925, -123.1760); AIRPORT.spots.yvr = { ...sp, name: 'YVR sign' };
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(24, 8), new THREE.MeshStandardMaterial({ map: canvasTex(768, 256, (c, w, h) => { c.fillStyle = '#0b4f6c'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.font = 'bold 200px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('YVR', w / 2, h / 2 + 10); }, false), side: THREE.DoubleSide }));
  sign.position.set(sp.x, sp.y + 6, sp.z); sign.rotation.y = 0.3; scene.add(sign);
  const jc = at(49.1955, -123.1788); AIRPORT.spots.jade = { ...jc, name: 'The Jade Canoe' }; { const g = new THREE.Group(); g.position.set(jc.x, jc.y, jc.z); scene.add(g);
    addMesh(new THREE.CapsuleGeometry(1.4, 8, 6, 12).rotateZ(Math.PI / 2).scale(1, 0.6, 1), std('#1f4d3a', { metalness: 0.3, roughness: 0.3 }), 0, 1.6, 0, g);
    for (let i = 0; i < 6; i++) addMesh(new THREE.CapsuleGeometry(0.35, 1, 4, 8), std('#1f4d3a', { metalness: 0.3, roughness: 0.3 }), -3.5 + i * 1.4, 2.8, 0, g); }
  const lb = at(49.1963, -123.1400); AIRPORT.spots.planespot = { ...lb, name: 'Larry Berg Flight Path Park' };
  addMesh(new THREE.BoxGeometry(6, 0.3, 1.5), std('#6b4a2b'), lb.x, lb.y + 0.5, lb.z);
  AIRPORT.spots.iona = { ...at(49.2190, -123.2160), name: 'Iona Beach jetty' };
  for (const [k, v] of Object.entries(AIRPORT.spots)) SPOTS[k] = { id: k, ...v };

  // parked airliners on the aprons near the main terminal, small planes at the South Terminal
  const gates = [[49.1972, -123.1830, 2.6], [49.1980, -123.1795, 2.9], [49.1945, -123.1858, 1.2], [49.1935, -123.1835, 1.4], [49.1990, -123.1840, 3.3]];
  gates.forEach(([lat, lon, yaw], i) => { const p = at(lat, lon); makeVehicle(i === 4 ? 'jumbo' : 'jet', p.x, p.z, yaw, { keep: true, y: Math.max(LV + 0.15, heightAt(p.x, p.z)) }); });
  for (const [lat, lon, yaw] of [[49.1868, -123.1690, 0.4], [49.1872, -123.1700, 0.4], [49.1876, -123.1710, 0.4]]) { const p = at(lat, lon); makeVehicle('cessna', p.x, p.z, yaw, { keep: true, y: Math.max(LV + 0.15, heightAt(p.x, p.z)) }); }
  { const p = at(49.1958, -123.1760); makeVehicle('tug', p.x, p.z, 1.2, { keep: true }); }
  { const p = at(49.1880, -123.1730); makeVehicle('heli', p.x, p.z, 0, { keep: true }); }

  // AI traffic: one plane landing, one taking off, forever
  if (runways.length) { for (let k = 0; k < 2; k++) { const v = makeVehicle('jet', 0, 0, 0, { keep: true, color: k ? '#c53030' : '#1f4e8c' }); v.ai = null; v.script = { k, t: k * 40 }; scriptPlanes.push(v); } }
}

// scripted airliners: k=0 lands on the main runway, k=1 takes off from the second one
const scriptPlanes = [];
export function updateAirport(dt) {
  for (const v of scriptPlanes) {
    if (v.driver === 'player') { scriptPlanes.splice(scriptPlanes.indexOf(v), 1); break; }
    const rw = runways[v.script.k % runways.length]; if (!rw) continue;
    const s = v.script; s.t += dt;
    const T = 120; if (s.t > T) s.t = 0;
    const t = s.t;
    let along, y, pitch = 0;
    if (s.k === 0) {   // landing: approach from 9 km out along the runway line, 3 degree glide
      const touch = 60;
      if (t < touch) { along = -9000 + (t / touch) * 9000; y = rw.y + Math.max(0, -along) * 0.052 + 0.1; pitch = -0.04; }
      else { const u = Math.min(1, (t - touch) / 35); along = rw.len * 0.55 * (1 - (1 - u) * (1 - u)); y = rw.y; pitch = 0; }
    } else {           // take-off roll, then climb out
      const roll = 35;
      if (t < roll) { const u = t / roll; along = rw.len * 0.7 * u * u; y = rw.y; }
      else { const u = t - roll; along = rw.len * 0.7 + u * 85; y = rw.y + u * u * 0.6 + u * 4; pitch = 0.18; }
    }
    v.x = rw.s.x + rw.ux * along; v.z = rw.s.z + rw.uz * along; v.y = y; v.pitch = pitch; v.yaw = Math.atan2(-rw.ux, -rw.uz);
    v.speedAbs = 70; v.g.position.set(v.x, v.y, v.z); v.g.rotation.set(v.pitch, v.yaw, 0);
    if (v.prop) v.prop.rotation.z += dt * 40;
  }
}
