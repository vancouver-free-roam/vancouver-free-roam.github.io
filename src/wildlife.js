// Little everyday wildlife around the player: pigeons and crows pecking on sidewalks, gulls by the water,
// squirrels in parks. Birds flap away when you come close. Instanced, spawned near the player, recycled when far.
import * as THREE from 'three';
import { G, scene, R, pick } from './core.js';
import { isWater, heightAt, isNorthShoreTown, isRichmond, maskAt } from './terrain.js';
import { roadGrid, NX, NZ, surfaceY, buildingAt, isDriveType } from './city.js';

const M = window.MAP, BIRDS = 220, SQ = 30;
const mk = (geo, cap) => { const m = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), cap); m.count = 0; m.frustumCulled = false; m.castShadow = true; m.setColorAt(0, new THREE.Color()); scene.add(m); return m; };
const body = mk(new THREE.SphereGeometry(0.12, 8, 6).scale(0.9, 0.85, 1.7), BIRDS);
const headM = mk(new THREE.SphereGeometry(0.065, 6, 5).translate(0, 0.08, -0.17), BIRDS);
const wingL = mk(new THREE.BoxGeometry(0.32, 0.02, 0.16).translate(-0.16, 0, 0), BIRDS), wingR = mk(new THREE.BoxGeometry(0.32, 0.02, 0.16).translate(0.16, 0, 0), BIRDS);
const sqBody = mk(new THREE.SphereGeometry(0.1, 8, 6).scale(0.8, 0.8, 1.4).translate(0, 0.1, 0), SQ), sqTail = mk(new THREE.SphereGeometry(0.09, 6, 5).scale(0.7, 1.6, 0.7).translate(0, 0.2, 0.15), SQ);
const KIND = { pigeon: { col: ['#7d8590', '#8f97a1', '#6b7280', '#a0a7b0'], sc: 1, flee: 5 }, crow: { col: ['#121214', '#1a1a1e'], sc: 1.15, flee: 6 }, gull: { col: ['#f2f3f5', '#e9ecef'], sc: 1.55, flee: 7 } };
const flocks = [], squirrels = [];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _w = new THREE.Matrix4();

function sidewalkSpot(px, pz) {
  const es = roadGrid.near(px + R(-120, 120), pz + R(-120, 120), 40, []);
  for (let k = 0; k < 6 && es.length; k++) {
    const e = pick(es), r = M.roads[e.r]; if (r.b) continue;
    const t = Math.random(), x0 = NX(e.a) + (NX(e.b) - NX(e.a)) * t, z0 = NZ(e.a) + (NZ(e.b) - NZ(e.a)) * t, L = e.len || 1, ux = (NX(e.b) - NX(e.a)) / L, uz = (NZ(e.b) - NZ(e.a)) / L, side = Math.random() < 0.5 ? 1 : -1;
    const off = isDriveType(r.t) ? r.w / 2 + 1.5 : 1.5, x = x0 - uz * off * side, z = z0 + ux * off * side;
    if (buildingAt(x, z) || isWater(x, z)) continue;
    const d = Math.hypot(x - px, z - pz); if (d < 35 || d > 150) continue;
    return [x, z];
  }
  return null;
}
function nearWater(x, z) { for (const [dx, dz] of [[30, 0], [-30, 0], [0, 30], [0, -30]]) if (isWater(x + dx, z + dz)) return true; return false; }
function spawnFlock(px, pz) {
  const s = sidewalkSpot(px, pz); if (!s) return;
  const [x, z] = s, kind = nearWater(x, z) ? (Math.random() < 0.8 ? 'gull' : 'crow') : (Math.random() < 0.6 ? 'pigeon' : 'crow'), K = KIND[kind];
  const n = kind === 'gull' ? Math.floor(R(3, 8)) : Math.floor(R(4, 11)), birds = [];
  for (let i = 0; i < n; i++) birds.push({ ox: R(-2.5, 2.5), oz: R(-2.5, 2.5), y: 0, vx: 0, vy: 0, vz: 0, yaw: R(0, 6.28), ph: R(0, 10), col: pick(K.col), fly: false });
  flocks.push({ x, z, kind, birds, gy: surfaceY(x, z), scared: false, t: 0 });
}
function spawnSquirrel(px, pz) {
  for (let k = 0; k < 10; k++) {
    const a = M.areas[Math.floor(Math.random() * M.areas.length)]; if (a.line || !['park', 'wood', 'grass', 'cemetery'].includes(a.k)) continue;
    const x = a.p[0] + R(-10, 10), z = a.p[1] + R(-10, 10), d = Math.hypot(x - px, z - pz); if (d < 25 || d > 160 || isWater(x, z) || buildingAt(x, z)) continue;
    squirrels.push({ x, z, tx: x, tz: z, yaw: 0, wait: R(0, 2), ph: 0, col: Math.random() < 0.7 ? '#6b6f73' : '#1a1a1a' }); return;
  }
}
let spawnT = 0;
export function updateWildlife(dt, pl) {
  if (!pl.char) return;
  updateFauna(dt, pl);
  const px = pl.x, pz = pl.z, onLand = heightAt(px, pz) < 300 && !pl.flying;
  spawnT -= dt;
  if (spawnT < 0 && onLand) { spawnT = 0.7; if (flocks.length < 7) spawnFlock(px, pz); if (squirrels.length < 6) spawnSquirrel(px, pz); }
  for (let i = flocks.length - 1; i >= 0; i--) { const f = flocks[i]; if (Math.hypot(f.x - px, f.z - pz) > 220 || (f.scared && f.t > 9)) flocks.splice(i, 1); }
  for (let i = squirrels.length - 1; i >= 0; i--) if (Math.hypot(squirrels[i].x - px, squirrels[i].z - pz) > 200) squirrels.splice(i, 1);
  const vel = pl.vehicle ? pl.vehicle.speedAbs : Math.hypot(pl.vx || 0, pl.vz || 0);
  let n = 0;
  for (const f of flocks) {
    const K = KIND[f.kind], d = Math.hypot(f.x - px, f.z - pz);
    if (!f.scared && (d < K.flee + (pl.vehicle ? 6 : 0) || (vel > 6 && d < 14))) { f.scared = true; f.t = 0; for (const b of f.birds) { const ax = f.x + b.ox - px, az = f.z + b.oz - pz, L = Math.hypot(ax, az) || 1; b.fly = true; b.vx = ax / L * R(3, 6); b.vz = az / L * R(3, 6); b.vy = R(3.5, 6); } }
    f.t += dt;
    for (const b of f.birds) {
      if (n >= BIRDS) break;
      b.ph += dt * (b.fly ? 26 : 6);
      let pitch = 0, flap = 0;
      if (b.fly) { b.ox += b.vx * dt; b.oz += b.vz * dt; b.y += b.vy * dt; b.vy = Math.max(1.2, b.vy - dt * 1.5); b.yaw = Math.atan2(-b.vx, -b.vz); flap = Math.sin(b.ph) * 0.9; pitch = -0.2; }
      else {   // pecking around
        pitch = Math.max(0, Math.sin(b.ph * 0.9)) * 0.7;
        if (Math.random() < dt * 0.6) { b.yaw += R(-1.2, 1.2); b.hop = 0.25; }
        if (b.hop > 0) { b.hop -= dt; b.ox -= Math.sin(b.yaw) * dt * 0.8; b.oz -= Math.cos(b.yaw) * dt * 0.8; }
        flap = -1.2;   // wings folded (tucked along the body)
      }
      const x = f.x + b.ox, z = f.z + b.oz, y = (b.fly ? f.gy : surfaceY(x, z, f.gy + 1)) + 0.13 * K.sc + b.y, s = K.sc;
      _e.set(pitch, b.yaw, 0); _q.setFromEuler(_e); _p.set(x, y, z); _s.setScalar(s); _m.compose(_p, _q, _s);
      body.setMatrixAt(n, _m); headM.setMatrixAt(n, _m);
      _w.makeRotationZ(b.fly ? flap : 0.15); _w.multiplyMatrices(_m, _w); if (!b.fly) _w.multiply(new THREE.Matrix4().makeScale(0.45, 1, 1)); wingL.setMatrixAt(n, _w);
      _w.makeRotationZ(b.fly ? -flap : -0.15); _w.multiplyMatrices(_m, _w); if (!b.fly) _w.multiply(new THREE.Matrix4().makeScale(0.45, 1, 1)); wingR.setMatrixAt(n, _w);
      _c.set(b.col); for (const m of [body, headM, wingL, wingR]) m.setColorAt(n, _c);
      n++;
    }
  }
  for (const m of [body, headM, wingL, wingR]) { m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  // squirrels: dash, stop, look around; bolt away from you
  let k = 0;
  for (const q of squirrels) {
    if (k >= SQ) break;
    const d = Math.hypot(q.x - px, q.z - pz);
    if (d < 6) { q.tx = q.x + (q.x - px) * 2; q.tz = q.z + (q.z - pz) * 2; q.wait = 0; }
    q.wait -= dt;
    if (q.wait <= 0) { const dx = q.tx - q.x, dz = q.tz - q.z, L = Math.hypot(dx, dz); if (L < 0.3) { q.wait = R(0.5, 3); q.tx = q.x + R(-6, 6); q.tz = q.z + R(-6, 6); } else { const sp = d < 6 ? 6 : 3.5, st = Math.min(L, sp * dt), nx = q.x + dx / L * st, nz = q.z + dz / L * st; if (!buildingAt(nx, nz) && !isWater(nx, nz)) { q.x = nx; q.z = nz; } else q.tx = q.x; q.yaw = Math.atan2(-dx, -dz); q.ph += dt * 20; } }
    const y = surfaceY(q.x, q.z) + Math.abs(Math.sin(q.ph)) * 0.08;
    _e.set(0, q.yaw, 0); _q.setFromEuler(_e); _p.set(q.x, y, q.z); _s.setScalar(1); _m.compose(_p, _q, _s);
    sqBody.setMatrixAt(k, _m); sqTail.setMatrixAt(k, _m); _c.set(q.col); sqBody.setColorAt(k, _c); sqTail.setColorAt(k, _c); k++;
  }
  for (const m of [sqBody, sqTail]) { m.count = k; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
}

// ---------- mountain & forest wildlife: deer, mountain goats, black bears, cougars ----------
function mergeParts(parts) {
  const pos = [], col = [], c = new THREE.Color();
  for (const [geo, color, x, y, z, rx = 0, rz = 0] of parts) { let g = geo.index ? geo.toNonIndexed() : geo.clone(); g.rotateX(rx); g.rotateZ(rz); g.translate(x, y, z); pos.push(...g.attributes.position.array); c.set(color); for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
function quad(body, col, { len = 1.2, hgt = 0.9, wid = 0.4, leg = 0.7, neck = 0, head = 0.3, tail = 0.15, tailCol = col, extra = [] }) {
  const P = [[B(wid, hgt * 0.45, len), col, 0, leg + hgt * 0.22, 0], [B(head * 0.9, head, head * 1.4), col, 0, leg + hgt * 0.45 + neck, -len / 2 - head * 0.4]];
  if (neck) P.push([B(head * 0.6, neck + 0.2, head * 0.6), col, 0, leg + hgt * 0.3 + neck / 2, -len / 2], 0);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.push([B(wid * 0.22, leg, wid * 0.22), col, sx * wid * 0.32, leg / 2, sz * len * 0.38]);
  P.push([B(0.08, 0.08, tail), tailCol, 0, leg + hgt * 0.3, len / 2 + tail / 2, 0.5]);
  return mergeParts(P.filter(p => p).concat(extra));
}
const FAUNA = {
  deer: { geo: quad(0, '#8b6a48', { len: 1.3, hgt: 0.8, wid: 0.38, leg: 0.8, neck: 0.4, head: 0.28, tail: 0.18, tailCol: '#f4f1e8', extra: [[B(0.04, 0.4, 0.04), '#d9c8a8', -0.1, 2.05, -1.0, 0, 0.4], [B(0.04, 0.4, 0.04), '#d9c8a8', 0.1, 2.05, -1.0, 0, -0.4]] }), cap: 14, flee: 32, speed: 7, max: 10 },
  goat: { geo: quad(0, '#efeee6', { len: 1.1, hgt: 0.85, wid: 0.45, leg: 0.6, neck: 0.15, head: 0.3, tail: 0.1, extra: [[B(0.05, 0.25, 0.05), '#1a1a1a', -0.08, 1.4, -0.75, -0.3], [B(0.05, 0.25, 0.05), '#1a1a1a', 0.08, 1.4, -0.75, -0.3]] }), cap: 10, flee: 22, speed: 4, max: 7 },
  bear: { geo: quad(0, '#16120f', { len: 1.6, hgt: 1.1, wid: 0.7, leg: 0.55, head: 0.42, tail: 0.08 }), cap: 3, flee: 0, speed: 1.4, max: 2 },
  cougar: { geo: quad(0, '#a8875c', { len: 1.5, hgt: 0.6, wid: 0.36, leg: 0.5, head: 0.3, tail: 0.9 }), cap: 2, flee: 45, speed: 9, max: 1 },
};
const faunaMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
for (const f of Object.values(FAUNA)) { f.im = new THREE.InstancedMesh(f.geo, faunaMat, f.cap); f.im.count = 0; f.im.frustumCulled = false; f.im.castShadow = true; scene.add(f.im); }
const fauna = [];
let faunaT = 0, bearWarned = 0;
function wild(x, z) { const h = heightAt(x, z); return h > 25 && !isWater(x, z) && !buildingAt(x, z) && !isNorthShoreTown(x, z, h) && !isRichmond(x, z) && maskAt(x, z) === -1 ? h : null; }
function spawnFauna(pl) {
  const a = Math.random() * 6.28, r = 90 + Math.random() * 150, x = pl.x + Math.cos(a) * r, z = pl.z + Math.sin(a) * r, h = wild(x, z); if (h === null) return;
  const slope = Math.abs(heightAt(x + 8, z) - heightAt(x - 8, z)) + Math.abs(heightAt(x, z + 8) - heightAt(x, z - 8)), count = k => fauna.filter(f => f.k === k).length, night = (G.night || 0) > 0.5;
  let k = null;
  if (h > 1150 && slope > 6) k = 'goat';
  else if (h < 1400 && Math.random() < 0.06 && count('bear') < FAUNA.bear.max) k = 'bear';
  else if (h < 1300 && Math.random() < (night ? 0.06 : 0.015) && count('cougar') < FAUNA.cougar.max) k = 'cougar';
  else if (h < 1300) k = 'deer';
  if (!k || count(k) >= FAUNA[k].max) return;
  const n = k === 'deer' ? 1 + Math.floor(Math.random() * 3) : k === 'goat' ? 1 + Math.floor(Math.random() * 3) : 1;
  for (let i = 0; i < n && count(k) < FAUNA[k].max; i++) fauna.push({ k, x: x + R(-6, 6), z: z + R(-6, 6), yaw: Math.random() * 6.28, tx: null, wait: R(0, 4), flee: 0, ph: Math.random() * 6 });
}
function updateFauna(dt, pl) {
  faunaT -= dt;
  const outThere = !pl.transit && wild(pl.x, pl.z) !== null;
  if (faunaT < 0 && outThere) { faunaT = 1.5; if (fauna.length < 14) spawnFauna(pl); }
  for (let i = fauna.length - 1; i >= 0; i--) if (Math.hypot(fauna[i].x - pl.x, fauna[i].z - pl.z) > 380) fauna.splice(i, 1);
  const n = {}; for (const k in FAUNA) n[k] = 0;
  const _m4 = new THREE.Matrix4(), _q4 = new THREE.Quaternion(), _v4 = new THREE.Vector3(), _s4 = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  for (const f of fauna) {
    const S = FAUNA[f.k], d = Math.hypot(f.x - pl.x, f.z - pl.z);
    if (S.flee && d < S.flee) f.flee = 4;
    if (f.k === 'bear' && d < 14 && G.t - bearWarned > 30) { bearWarned = G.t; import('./ui.js').then(m => m.ui.toast('🐻 A black bear!', 'Stay calm, talk to it, and back away slowly. Do NOT run. (It is more scared of you. Probably.)', 4500)); }
    let sp = 0;
    if (f.flee > 0) { f.flee -= dt; const ax = f.x - pl.x, az = f.z - pl.z, L = Math.hypot(ax, az) || 1; f.tx = f.x + ax / L * 30; f.tz = f.z + az / L * 30; sp = S.speed; }
    else { f.wait -= dt; if (f.wait < 0 && f.tx === null) { f.tx = f.x + R(-25, 25); f.tz = f.z + R(-25, 25); } sp = S.speed * 0.18; }
    if (f.tx !== null) {
      const dx = f.tx - f.x, dz = f.tz - f.z, L = Math.hypot(dx, dz);
      if (L < 0.5) { f.tx = null; f.wait = R(2, 8); }
      else { const st = Math.min(L, sp * dt), nx = f.x + dx / L * st, nz = f.z + dz / L * st; if (wild(nx, nz) !== null) { f.x = nx; f.z = nz; } else f.tx = null; f.yaw = Math.atan2(-dx, -dz); f.ph += dt * sp * 3; }
    }
    if (n[f.k] >= S.cap) continue;
    const y = heightAt(f.x, f.z) + (f.tx !== null ? Math.abs(Math.sin(f.ph)) * (f.flee > 0 ? 0.25 : 0.04) : 0);
    _q4.setFromAxisAngle(up, f.yaw); _m4.compose(_v4.set(f.x, y, f.z), _q4, _s4); S.im.setMatrixAt(n[f.k]++, _m4);
  }
  for (const k in FAUNA) { FAUNA[k].im.count = n[k]; FAUNA[k].im.instanceMatrix.needsUpdate = true; }
}
