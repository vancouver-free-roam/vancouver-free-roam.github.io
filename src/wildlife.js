// Little everyday wildlife around the player: pigeons and crows pecking on sidewalks, gulls by the water,
// squirrels in parks. Birds flap away when you come close. Instanced, spawned near the player, recycled when far.
import * as THREE from 'three';
import { G, scene, R, pick } from './core.js';
import { isWater, heightAt, isNorthShoreTown, isRichmond, maskAt } from './terrain.js';
import { roadGrid, NX, NZ, surfaceY, buildingAt, isDriveType } from './city.js';
// mountain, forest, shore and park animals live in fauna.js now (real bears, elk, marmots…); plants in flora.js
import { updateFauna } from './fauna.js';
import { updateFlora } from './flora.js';
import { softSpot } from './journal.js';
import { bake, tintShader, SP, SPs, CN, BX, cylD } from './tint.js';

const M = window.MAP, BIRDS = 220, SQ = 30;
// Realism pass (2026-11-22): real-sized birds modelled from coloured shapes (tint.js bake, own colours per species): a plump
// body, breast, neck, head with beak + eyes, tail, legs, and wings that fold back along the body or flap from the shoulder.
// The instance colour only shades each bird a little (pigeons vary from pale to dark grey).
const mk = (geo, cap, mat) => { const m = new THREE.InstancedMesh(geo, mat || new THREE.MeshStandardMaterial({ roughness: 0.8 }), cap); m.count = 0; m.frustumCulled = false; m.castShadow = true; m.setColorAt(0, new THREE.Color()); scene.add(m); return m; };
function birdGeo(o) {   // forward = -z, origin at the feet; numbers are for a 0.32 m pigeon, scaled by k
  const k = o.len / 0.32, P = (g, c, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) => [g, c, x * k, y * k, z * k, sx * k, sy * k, sz * k, rx, ry, rz];
  const body = bake([P(SP, o.body, 0, 0.14, 0, 0.074, 0.07, 0.13), P(SP, o.breast || o.body, 0, 0.135, -0.07, 0.068, 0.07, 0.072), P(SP, o.belly || o.breast || o.body, 0, 0.11, -0.01, 0.06, 0.05, 0.1),
    P(SP, o.neck || o.head, 0, 0.19, -0.085, 0.042, 0.052, 0.042, 0.4), o.neck2 && P(SP, o.neck2, 0, 0.185, -0.075, 0.046, 0.03, 0.03),
    P(SP, o.head, 0, 0.233, -0.105, 0.033, 0.032, 0.039), P(CN, o.beak, 0, 0.228 - (o.drop || 0), -0.142 - (o.bl || 0.022) / 2, 0.009 * (o.bw || 1), o.bl || 0.025, 0.007 * (o.bw || 1), -Math.PI / 2 - (o.hook || 0)),
    o.cere && P(SPs, o.cere, 0, 0.234, -0.133, 0.008, 0.006, 0.007), o.spot && P(SPs, o.spot, 0, 0.222, -0.15, 0.004, 0.004, 0.004),
    P(SPs, o.eye, -0.024, 0.24, -0.114, 0.006, 0.006, 0.005), P(SPs, o.eye, 0.024, 0.24, -0.114, 0.006, 0.006, 0.005), P(SPs, '#050505', -0.026, 0.24, -0.116, 0.003, 0.003, 0.003), P(SPs, '#050505', 0.026, 0.24, -0.116, 0.003, 0.003, 0.003),
    P(BX, o.tail || o.body, 0, 0.135, 0.15, 0.065, 0.01, 0.11, 0.18), o.tailTip && P(BX, o.tailTip, 0, 0.125, 0.2, 0.066, 0.011, 0.025, 0.18),
    P(cylD(0.004, 0.0035, 0.085, 5), o.legs, -0.02, 0.087, 0.0, 1, 1, 1), P(cylD(0.004, 0.0035, 0.085, 5), o.legs, 0.02, 0.087, 0.0, 1, 1, 1), P(BX, o.legs, -0.02, 0.003, -0.012, 0.012, 0.004, 0.035), P(BX, o.legs, 0.02, 0.003, -0.012, 0.012, 0.004, 0.035)], 0.08);
  const wing = s => bake([P(SP, o.wing, s * 0.12, 0, 0.03, 0.13, 0.009, 0.07), P(SP, o.wing2 || o.wing, s * 0.2, 0, 0.05, 0.09, 0.008, 0.06), P(SP, o.tip, s * 0.29, 0, 0.07, 0.07, 0.007, 0.05),
    o.bar && P(BX, o.bar, s * 0.09, 0.006, 0.055, 0.1, 0.004, 0.012), o.bar && P(BX, o.bar, s * 0.11, 0.006, 0.08, 0.1, 0.004, 0.012), o.tipSpot && P(SPs, o.tipSpot, s * 0.33, 0.004, 0.08, 0.012, 0.004, 0.012)], 0.06);
  return { body, wl: wing(-1), wr: wing(1), shoulder: [0.06 * k, 0.175 * k, -0.04 * k] };
}
const BIRD_DEF = {
  pigeon: { len: 0.32, body: '#8e959d', breast: '#9a909a', belly: '#9aa1a8', neck: '#4f7466', neck2: '#7a5a86', head: '#6e7680', beak: '#3a3a3a', cere: '#ecebe4', eye: '#e0782a', tail: '#6a7078', tailTip: '#2e3238', legs: '#c86a6a', wing: '#9aa1a9', wing2: '#8a929a', tip: '#3e434a', bar: '#2a2d32' },
  crow: { len: 0.42, body: '#141416', head: '#121214', beak: '#101012', bl: 0.035, bw: 1.6, hook: 0.08, eye: '#1a1a1a', legs: '#151515', wing: '#17171a', tip: '#101012', gloss: true },
  gull: { len: 0.6, body: '#f2f3f2', head: '#f6f7f6', beak: '#e8c23a', bl: 0.03, bw: 1.3, drop: 0.002, spot: '#c8281e', eye: '#d8c64a', tail: '#f2f3f2', legs: '#e0a0a0', wing: '#aab4bd', wing2: '#a4aeb8', tip: '#1c1c1e', tipSpot: '#f4f4f4' },
};
const KIND = { pigeon: { col: ['#ffffff', '#e8e8e8', '#cfcfcf', '#f4efe8', '#bdbdbd'], sc: 1, flee: 5 }, crow: { col: ['#ffffff', '#f0f0f0'], sc: 1, flee: 6 }, gull: { col: ['#ffffff', '#f6f6f6'], sc: 1, flee: 7 } };
for (const [k, o] of Object.entries(BIRD_DEF)) { const g = birdGeo(o), mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: o.gloss ? 0.42 : 0.75, envMapIntensity: o.gloss ? 0.7 : 0.3 }); KIND[k].m = { body: mk(g.body, BIRDS, mat), wl: mk(g.wl, BIRDS, mat), wr: mk(g.wr, BIRDS, mat) }; KIND[k].shoulder = g.shoulder; }
// grey squirrels (a third of Vancouver's are the black colour form): fur parts take the instance colour, tail curls up over the back
const sqMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }); sqMat.onBeforeCompile = tintShader; sqMat.customProgramCacheKey = () => 'squirrelTint';
const sqBody = mk(bake([[SP, 'F', 0, 0.09, 0, 0.05, 0.055, 0.09], [SP, 'F', 0, 0.085, 0.05, 0.056, 0.06, 0.06], [SP, 'F1.45', 0, 0.072, -0.025, 0.038, 0.035, 0.065], [SP, 'F', 0, 0.13, -0.088, 0.034, 0.034, 0.042], [SP, 'F1.4', 0, 0.12, -0.118, 0.018, 0.017, 0.02],
  [SPs, '#0a0a0a', 0, 0.123, -0.137, 0.006, 0.005, 0.004], [SPs, '#0a0a0a', -0.022, 0.142, -0.105, 0.006, 0.007, 0.006], [SPs, '#0a0a0a', 0.022, 0.142, -0.105, 0.006, 0.007, 0.006], [CN, 'F', -0.017, 0.168, -0.08, 0.009, 0.022, 0.006], [CN, 'F', 0.017, 0.168, -0.08, 0.009, 0.022, 0.006],
  [cylD(0.008, 0.006, 0.06, 5), 'F0.9', -0.022, 0.07, -0.06], [cylD(0.008, 0.006, 0.06, 5), 'F0.9', 0.022, 0.07, -0.06], [SP, 'F0.9', -0.03, 0.025, 0.05, 0.016, 0.02, 0.045], [SP, 'F0.9', 0.03, 0.025, 0.05, 0.016, 0.02, 0.045]]), SQ, sqMat);
const sqTail = mk(bake([[0.1, 0.1, 0.036], [0.135, 0.14, 0.05], [0.15, 0.19, 0.058], [0.13, 0.235, 0.054], [0.09, 0.255, 0.044]].flatMap(([z, y, r]) => [[SP, 'F', 0, y, z, r * 0.75, r, r * 1.05], [SP, 'F1.3', 0, y + r * 0.1, z + r * 0.45, r * 0.85, r * 0.85, r * 0.6], [SP, 'F0.8', 0, y - r * 0.2, z - r * 0.3, r * 0.6, r * 0.8, r * 0.7]]), 0.3), SQ, sqMat);   // a bushy plume curling over the back, pale fringe
export const flocks = [], squirrels = [];   // (exported for tests / screenshots)
const _fold = new THREE.Matrix4().makeScale(0.6, 1.3, 1);
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
    squirrels.push({ x, z, tx: x, tz: z, yaw: 0, wait: R(0, 2), ph: 0, col: Math.random() < 0.65 ? pick(['#4e4842', '#56504a', '#5c5248']) : '#1c1b1a' }); return;
  }
}
let spawnT = 0;
export function updateWildlife(dt, pl) {
  if (!pl.char) return;
  updateFauna(dt, pl); updateFlora(dt, pl);
  for (const f of flocks) if (Math.hypot(f.x - pl.x, f.z - pl.z) < 18) softSpot(f.kind);
  for (const q of squirrels) if (Math.hypot(q.x - pl.x, q.z - pl.z) < 15) softSpot('greysquirrel');
  const px = pl.x, pz = pl.z, onLand = heightAt(px, pz) < 300 && !pl.flying;
  spawnT -= dt;
  if (spawnT < 0 && onLand) { spawnT = 0.7; if (flocks.length < 7) spawnFlock(px, pz); if (squirrels.length < 6) spawnSquirrel(px, pz); }
  for (let i = flocks.length - 1; i >= 0; i--) { const f = flocks[i]; if (Math.hypot(f.x - px, f.z - pz) > 220 || (f.scared && f.t > 9)) flocks.splice(i, 1); }
  for (let i = squirrels.length - 1; i >= 0; i--) if (Math.hypot(squirrels[i].x - px, squirrels[i].z - pz) > 200) squirrels.splice(i, 1);
  const vel = pl.vehicle ? pl.vehicle.speedAbs : Math.hypot(pl.vx || 0, pl.vz || 0);
  const cnt = { pigeon: 0, crow: 0, gull: 0 };
  for (const f of flocks) {
    const K = KIND[f.kind], d = Math.hypot(f.x - px, f.z - pz);
    if (!f.scared && (d < K.flee + (pl.vehicle ? 6 : 0) || (vel > 6 && d < 14))) { f.scared = true; f.t = 0; for (const b of f.birds) { const ax = f.x + b.ox - px, az = f.z + b.oz - pz, L = Math.hypot(ax, az) || 1; b.fly = true; b.vx = ax / L * R(3, 6); b.vz = az / L * R(3, 6); b.vy = R(3.5, 6); } }
    f.t += dt;
    for (const b of f.birds) {
      if (cnt[f.kind] >= BIRDS) break; const n = cnt[f.kind]++, KM = K.m;
      b.ph += dt * (b.fly ? 26 : 6);
      let pitch = 0, flap = 0;
      if (b.fly) { b.ox += b.vx * dt; b.oz += b.vz * dt; b.y += b.vy * dt; b.vy = Math.max(1.2, b.vy - dt * 1.5); b.yaw = Math.atan2(-b.vx, -b.vz); flap = Math.sin(b.ph) * 0.9; pitch = -0.2; }
      else {   // pecking around
        pitch = Math.max(0, Math.sin(b.ph * 0.9)) * 0.7;
        if (Math.random() < dt * 0.6) { b.yaw += R(-1.2, 1.2); b.hop = 0.25; }
        if (b.hop > 0) { b.hop -= dt; b.ox -= Math.sin(b.yaw) * dt * 0.8; b.oz -= Math.cos(b.yaw) * dt * 0.8; }
        flap = -1.2;   // wings folded (tucked along the body)
      }
      const x = f.x + b.ox, z = f.z + b.oz, y = (b.fly ? f.gy : surfaceY(x, z, f.gy + 1)) + b.y, s = K.sc;
      _e.set(b.fly ? 0.15 : -pitch * 0.9, b.yaw, 0); _q.setFromEuler(_e); _p.set(x, y, z); _s.setScalar(s); _m.compose(_p, _q, _s);   // pecking = head down (forward is -z, so negative pitch)
      KM.body.setMatrixAt(n, _m);
      // wings hinge at the shoulder: folded back along the body on the ground, flapping up and down in the air
      const sh = K.shoulder;
      for (const [wm, sg] of [[KM.wl, -1], [KM.wr, 1]]) {
        _e.set(0, b.fly ? 0 : -sg * 1.38, b.fly ? -sg * flap : -sg * 0.18, 'XYZ'); _w.makeRotationFromEuler(_e); _w.setPosition(sg * sh[0], sh[1], sh[2]); _w.premultiply(_m); if (!b.fly) _w.multiply(_fold); wm.setMatrixAt(n, _w);   // folded wings tuck in (primaries overlap)
      }
      _e.order = 'YXZ';
      _c.set(b.col); for (const m of [KM.body, KM.wl, KM.wr]) m.setColorAt(n, _c);
    }
  }
  for (const k in cnt) for (const m of Object.values(KIND[k].m)) { m.count = cnt[k]; m.visible = cnt[k] > 0; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  // squirrels: dash, stop, look around; bolt away from you
  let k = 0;
  for (const q of squirrels) {
    if (k >= SQ) break;
    const d = Math.hypot(q.x - px, q.z - pz);
    if (d < 6) { q.tx = q.x + (q.x - px) * 2; q.tz = q.z + (q.z - pz) * 2; q.wait = 0; }
    q.wait -= dt;
    if (q.wait <= 0) { const dx = q.tx - q.x, dz = q.tz - q.z, L = Math.hypot(dx, dz); if (L < 0.3) { q.wait = R(0.5, 3); q.tx = q.x + R(-6, 6); q.tz = q.z + R(-6, 6); } else { const sp = d < 6 ? 6 : 3.5, st = Math.min(L, sp * dt), nx = q.x + dx / L * st, nz = q.z + dz / L * st; if (!buildingAt(nx, nz) && !isWater(nx, nz)) { q.x = nx; q.z = nz; } else q.tx = q.x; q.yaw = Math.atan2(-dx, -dz); q.ph += dt * 20; } }
    // running = bounding (body rocks), stopped = now and then sits up on its haunches to look around; the tail flicks
    const run = q.wait <= 0, bound = run ? Math.sin(q.ph) : 0;
    if (!run && q.sitT === undefined && Math.random() < dt * 0.6) q.sitT = R(0.8, 2.5);
    if (q.sitT !== undefined) { q.sitT -= dt; if (q.sitT <= 0 || run) q.sitT = undefined; }
    const sitUp = q.sitT !== undefined ? 1 : 0, y = surfaceY(q.x, q.z) + Math.abs(bound) * 0.06 + sitUp * 0.03;
    _e.set(bound * 0.25 + sitUp * 0.95, q.yaw, 0, 'YXZ'); _q.setFromEuler(_e); _p.set(q.x, y, q.z); _s.setScalar(1); _m.compose(_p, _q, _s);
    sqBody.setMatrixAt(k, _m);
    _e.set(Math.sin(G.t * 9 + q.x) * (run ? 0.1 : 0.04) - sitUp * 0.5, 0, 0, 'XYZ'); _w.makeRotationFromEuler(_e); _w.setPosition(0, 0.09, 0.08); _w.premultiply(_m); _w.multiply(new THREE.Matrix4().makeTranslation(0, -0.09, -0.08)); sqTail.setMatrixAt(k, _w);
    _e.order = 'YXZ'; _c.set(q.col); sqBody.setColorAt(k, _c); sqTail.setColorAt(k, _c); k++;
  }
  for (const m of [sqBody, sqTail]) { m.count = k; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
}

