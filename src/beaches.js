// Beach extras:
//  - Kitsilano Pool: Canada's longest pool (137 m), a heated SALTWATER pool right on Kits Beach (open since 1931). It isn't in
//    the map data, so it's built on the open strip along the shore at the west end of Kits Beach: a raised concrete deck,
//    turquoise water you can swim in (a "lake" via addWaterBody), lane ropes, a lifeguard chair, a sign and swimmers in summer.
//    Secret 'kitspool'.
//  - Surprise: the Polar Bear Swim at English Bay (a real tradition since 1920, every New Year's Day): on winter afternoons
//    a crowd in costumes charges into the freezing sea, shrieks, and charges back out. Swim out with them: secret 'polarbear'.
import * as THREE from 'three';
import { G, scene, toXZ, hash2, canvasTex, pick } from './core.js';
import { groundY, heightAt, isWater, addWaterBody, treeChunks } from './terrain.js';
import { _colliderGrids } from './colliders.js';
import { addFlatSurface, buildingAt, nearestRoad } from './city.js';
import { Crowd, newLook } from './people.js';
import { discover } from './missions.js';
import { ui } from './ui.js';

const gy = (x, z) => { const g = groundY(x, z); return Number.isFinite(g) ? g : heightAt(x, z); };
const SWIM = ['#e53e3e', '#2b6cb0', '#d69e2e', '#38a169', '#805ad5', '#1a202c', '#ed64a6', '#319795', '#f6e05e'];

// ---------- a tiny vertex-colour merge kit ----------
function merged(parts) {
  const pos = [], nor = [], col = [], c = new THREE.Color();
  for (const [geo, colr] of parts) { const g = geo.index ? geo.toNonIndexed() : geo; pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); c.set(colr); for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); return g;
}
const box = (sx, sy, sz, x, y, z) => new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z);

// ---------- Kits Pool ----------
const POOL = { L: 137, W: 40, M: 7 };   // length, width, deck margin
let pool = null;
function findPoolSpot() {
  const [gx, gz] = toXZ(49.2737, -123.1565);
  let best = null, bestS = -1e9;
  for (let cx = gx - 220; cx <= gx + 220; cx += 10) for (let cz = gz - 220; cz <= gz + 220; cz += 10) {
    if (isWater(cx, cz) || buildingAt(cx, cz)) continue;
    // the nearest water direction: the pool's long side runs along the shore
    let wa = null, wd = 1e9; for (let r = 15; r <= 75 && wa === null; r += 10) for (let b = 0; b < 6.283; b += 0.26) if (isWater(cx + Math.cos(b) * r, cz + Math.sin(b) * r)) { wa = b; wd = r; break; }
    if (wa === null) continue;
    const nx = Math.cos(wa), nz = Math.sin(wa), ux = -nz, uz = nx, hl = POOL.L / 2 + POOL.M, hw = POOL.W / 2 + POOL.M;
    let ok = true, gmin = 1e9, gmax = -1e9;
    for (let a = -1; a <= 1 && ok; a += 1 / 6) for (let b = -1; b <= 1; b += 0.5) {
      const x = cx + ux * a * hl + nx * b * hw, z = cz + uz * a * hl + nz * b * hw, h = gy(x, z);
      if (isWater(x, z) || buildingAt(x, z) || h < 1.4 || h > 20) { ok = false; break; }
      const r = nearestRoad(x, z, 20, rd => rd.t <= 5); if (r && r.d < r.road.w / 2 + 2) { ok = false; break; }   // (footpaths like the seawall path may run under it: the real path goes round the pool)
      gmin = Math.min(gmin, h); gmax = Math.max(gmax, h);
    }
    if (!ok || gmax - gmin > 3.5) continue;
    // the seaward deck edge should sit close to the water
    const sx = cx + nx * hw, sz = cz + nz * hw; let sd = 60; for (let r = 2; r < 60; r += 2) if (isWater(sx + nx * r, sz + nz * r)) { sd = r; break; }
    const s = -Math.hypot(cx - gx, cz - gz) * 0.6 - sd * 3 - (gmax - gmin) * 4;
    if (s > bestS) { bestS = s; best = { cx, cz, ux, uz, nx, nz, gmin, gmax }; }
  }
  return best;
}
function buildPool() {
  const s = findPoolSpot(); if (!s) { console.warn('Kits Pool: no spot found'); return; }
  const { cx, cz, ux, uz, nx, nz, gmin, gmax } = s, { L, W, M } = POOL;
  const y0 = gmax + 2.0, wl = y0 - 0.25, floor = gmax + 0.05, yaw = Math.atan2(-uz, ux);
  const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = yaw; scene.add(g);
  const P = (u, v) => [cx + ux * u + nx * v, cz + uz * u + nz * v];   // u along, v toward the sea
  // the group's local x runs along the pool (ux, uz); local z runs across it, and seaSign says which way is the sea
  const lz = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw), seaSign = Math.sign(lz.x * nx + lz.z * nz) || 1;   // local +z = sea side if seaSign > 0
  const deckH = y0 - (gmin - 0.6), dc = '#d9d5cc', cope = '#f4f2ec';
  const parts = [
    [box(L + 2 * M, deckH, M, 0, y0 - deckH / 2, (W / 2 + M / 2)), dc], [box(L + 2 * M, deckH, M, 0, y0 - deckH / 2, -(W / 2 + M / 2)), dc],
    [box(M, deckH, W, L / 2 + M / 2, y0 - deckH / 2, 0), dc], [box(M, deckH, W, -(L / 2 + M / 2), y0 - deckH / 2, 0), dc],
    [box(L + 0.6, 0.12, 0.5, 0, y0 + 0.02, W / 2 + 0.1), cope], [box(L + 0.6, 0.12, 0.5, 0, y0 + 0.02, -W / 2 - 0.1), cope],
    [box(0.5, 0.12, W, L / 2 + 0.1, y0 + 0.02, 0), cope], [box(0.5, 0.12, W, -L / 2 - 0.1, y0 + 0.02, 0), cope],
    [box(L, 0.2, W, 0, floor, 0), '#5fc3d8'],                                                    // aqua floor
    [box(L, y0 - floor, 0.15, 0, (y0 + floor) / 2, W / 2 - 0.05), '#6fcbd9'], [box(L, y0 - floor, 0.15, 0, (y0 + floor) / 2, -W / 2 + 0.05), '#6fcbd9'],   // tiled walls
    [box(0.15, y0 - floor, W, L / 2 - 0.05, (y0 + floor) / 2, 0), '#6fcbd9'], [box(0.15, y0 - floor, W, -L / 2 + 0.05, (y0 + floor) / 2, 0), '#6fcbd9'],
  ];
  for (let k = -6; k <= 6; k++) parts.push([box(L - 6, 0.03, 0.3, 0, floor + 0.11, k * 2.6), '#1f4f8a']);   // lane lines on the floor
  // steps up from the beach on the land side, a lifeguard chair, ladders
  const land = -seaSign; for (let st = 0; st < 5; st++) parts.push([box(10, (y0 - gmin) * (st + 1) / 5, 1.2, 0, gmin - 0.4 + (y0 - gmin) * (st + 1) / 10 + 0.2, land * (W / 2 + M + 0.6 + (4 - st) * 1.2)), '#cfcac0']);
  for (const lx of [-0.6, 0.6]) for (const lzz of [-0.5, 0.5]) parts.push([box(0.12, 2.6, 0.12, L * 0.15 + lx, y0 + 1.3, seaSign * (W / 2 + 2) + lzz), '#f7f7f7']);
  parts.push([box(1.5, 0.12, 1.3, L * 0.15, y0 + 2.6, seaSign * (W / 2 + 2)), '#f7f7f7'], [box(1.3, 0.9, 0.1, L * 0.15, y0 + 3.1, seaSign * (W / 2 + 2.6)), '#d62828']);
  for (const ex of [-L / 2 + 3, L / 2 - 3]) for (const ez of [-W / 2 + 0.3, W / 2 - 0.3]) for (const rx of [-0.3, 0.3]) parts.push([box(0.06, 1.1, 0.06, ex + rx, y0 + 0.5, ez), '#c9ced3']);
  const shell = new THREE.Mesh(merged(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 })); shell.castShadow = shell.receiveShadow = true; g.add(shell);
  // lane ropes: red and white floats
  const ropes = []; for (let k = -2; k <= 3; k++) for (let q = 0; q < L / 1.5; q++) ropes.push([new THREE.CylinderGeometry(0.1, 0.1, 1.4, 8).rotateZ(Math.PI / 2).translate(-L / 2 + 0.75 + q * 1.5, wl + 0.03, k * 2.6 - 5), q % 4 < 2 ? '#d62828' : '#f4f4f4']);
  const rope = new THREE.Mesh(merged(ropes), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 })); g.add(rope);
  // the water: bright turquoise, see-through to the floor, glowing a little
  const wtex = canvasTex(256, 256, (c, w) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, w); c.strokeStyle = 'rgba(255,255,255,0.0)'; for (let i = 0; i < 90; i++) { c.strokeStyle = `rgba(200,240,250,${0.25 + Math.random() * 0.3})`; c.lineWidth = 2; c.beginPath(); const x = Math.random() * w, y = Math.random() * w; c.moveTo(x, y); c.bezierCurveTo(x + 20, y - 10, x + 40, y + 12, x + 60, y); c.stroke(); } });
  wtex.repeat.set(L / 9, W / 9);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(L, W).rotateX(-Math.PI / 2).translate(0, wl, 0), new THREE.MeshStandardMaterial({ color: '#13a6c6', map: wtex, transparent: true, opacity: 0.8, roughness: 0.08, metalness: 0.05, envMapIntensity: 0.55, emissive: '#0a5f7c', emissiveIntensity: 0.3, depthWrite: false }));
  g.add(water);
  // sign at the steps
  const signT = canvasTex(512, 160, (c, w, h) => { c.fillStyle = '#123a5a'; c.fillRect(0, 0, w, h); c.strokeStyle = '#7fd6e3'; c.lineWidth = 8; c.strokeRect(6, 6, w - 12, h - 12); c.fillStyle = '#fff'; c.textAlign = 'center'; c.font = 'bold 54px Arial'; c.fillText('KITSILANO POOL', w / 2, 70); c.font = '28px Arial'; c.fillStyle = '#bfeef5'; c.fillText('Saltwater · 137 m · Since 1931', w / 2, 120); }, false);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.9), new THREE.MeshStandardMaterial({ map: signT, roughness: 0.6, side: THREE.DoubleSide })); sign.position.set(8, y0 + 2.6, land * (W / 2 + M - 0.3)); g.add(sign);
  for (const sx of [5.2, 10.8]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3.6, 0.15), new THREE.MeshStandardMaterial({ color: '#444' })); post.position.set(sx, y0 + 1.8, land * (W / 2 + M - 0.3)); g.add(post); }
  // walkable deck (4 strips around the water, so the water itself stays swimmable) and the water body
  const strip = (u0, u1, v0, v1) => addFlatSurface(new Float32Array([...P(u0, v0), ...P(u1, v0), ...P(u1, v1), ...P(u0, v1)]), y0);
  // (local z ↔ world v: local +z is the sea side when seaSign > 0)
  const V = vz => vz * seaSign;
  strip(-L / 2 - M, L / 2 + M, V(W / 2), V(W / 2 + M)); strip(-L / 2 - M, L / 2 + M, V(-W / 2 - M), V(-W / 2));
  strip(L / 2, L / 2 + M, V(-W / 2), V(W / 2)); strip(-L / 2 - M, -L / 2, V(-W / 2), V(W / 2));
  const body = addWaterBody({ p: [...P(-L / 2, -W / 2), ...P(L / 2, -W / 2), ...P(L / 2, W / 2), ...P(-L / 2, W / 2)], y: wl, name: 'Kitsilano Pool' });
  // park trees planted where the pool now stands: hide them (tree chunks + the detailed near ring) and drop their trunks
  const inside = (x, z) => { const du = (x - cx) * ux + (z - cz) * uz, dv = (x - cx) * nx + (z - cz) * nz; return Math.abs(du) < L / 2 + M + 1 && Math.abs(dv) < W / 2 + M + 1; };
  const Z0 = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const grp of treeChunks) { if (Math.abs(grp.userData.cx - cx) > 600 || Math.abs(grp.userData.cz - cz) > 600) continue;
    for (const m of grp.children) { if (!m.userData.items) continue; for (const t of m.userData.items) if (inside(t.x, t.z)) for (const [mm, i] of t.refs || []) { mm.userData.ring?.setBroken(mm, i, true); mm.setMatrixAt(i, Z0); mm.instanceMatrix.needsUpdate = true; } } }
  const tg = _colliderGrids.get('trees'); if (tg) for (const [k, a] of tg) { const f = a.filter(c => !inside(c.x, c.z)); if (f.length !== a.length) tg.set(k, f); }
  pool = { g, cx, cz, ux, uz, nx, nz, y0, wl, body, P, seaSign, swimmers: [], crowd: new Crowd(18), water, wtex };
  for (let i = 0; i < 18; i++) {   // lap swimmers in the roped lanes, waders and floaters in the rest
    const lap = i < 9, lane = lap ? (i % 5) : 0, look = newLook(); look.shirt = look.skin; look.pants = pick(SWIM); look.coat = null; look.scarf = null; look.bag = null; look.hat = Math.random() < 0.5 ? pick(['#f6e05e', '#e53e3e', '#ffffff', '#2b6cb0']) : null;
    pool.swimmers.push({ lap, u: (Math.random() - 0.5) * (L - 8), v: lap ? lane * 2.6 - 3.7 : 4 + Math.random() * (W / 2 - 6), dir: Math.random() < 0.5 ? 1 : -1, sp: lap ? 0.9 + Math.random() * 0.6 : 0.15, x: 0, y: 0, z: 0, yaw: 0, cols: look, state: 'walk', kind: 'swim', phase: Math.random() * 6, amp: 0.6, visible: true, dirty: true });
  }
  SPOTS_INFO.pool = { x: cx, z: cz };
}
function updatePool(dt, pl) {
  if (!pool) return;
  const d = Math.hypot(pl.x - pool.cx, pl.z - pool.cz); pool.g.visible = d < 3000;
  if (d > 700) { if (pool.lastVis) { pool.crowd.draw([]); pool.lastVis = false; } return; }
  pool.wtex.offset.x += dt * 0.01; pool.wtex.offset.y += dt * 0.006;
  const open = (G.season === 'summer' || G.season === 'spring') && G.hour > 7 && G.hour < 20.5 && (G.wet || 0) < 0.5;
  const list = [];
  if (open) for (const s of pool.swimmers) {
    s.u += s.dir * s.sp * dt; if (Math.abs(s.u) > POOL.L / 2 - 2) { s.dir = -s.dir; s.u = Math.sign(s.u) * (POOL.L / 2 - 2); }   // turn at the wall
    if (!s.lap) s.v += Math.sin(G.t * 0.3 + s.phase) * dt * 0.1;
    const [x, z] = pool.P(s.u, s.v * pool.seaSign); s.x = x; s.z = z; s.phase += dt * 3; s.y = pool.wl - 0.82 + Math.sin(s.phase * 0.7) * 0.06;   // (the swim pose lies flat: backs and heads break the surface)
    const fx = pool.ux * s.dir, fz = pool.uz * s.dir; s.yaw = Math.atan2(-fx, -fz); list.push(s);
  }
  pool.crowd.draw(list); pool.lastVis = true;
  if (pl.swimming && Math.abs(pl.y - pool.wl) < 1.5 && pl.x > pool.body.x0 && pl.x < pool.body.x1 && pl.z > pool.body.z0 && pl.z < pool.body.z1) {
    if (!pool.told) { pool.told = true; ui.toast('🏊 Kitsilano Pool', 'Canada\'s longest pool: 137 m of heated SALT water, right beside the beach. One length is more than a football field.', 5000); }
    discover('kitspool');
  }
}

// ---------- the Polar Bear Swim ----------
let pb = null;
const COSTUME = ['#e53e3e', '#f6e05e', '#38a169', '#805ad5', '#ed64a6', '#2b6cb0', '#ff8c00', '#ffffff', '#1a202c', '#00b5d8'];
function polarSpot() {
  const [x0, z0] = toXZ(49.2866, -123.1430);   // English Bay Beach
  let sand = null; for (let r = 0; r < 120 && !sand; r += 4) for (let b = 0; b < 6.283; b += 0.4) { const x = x0 + Math.cos(b) * r, z = z0 + Math.sin(b) * r; if (isWater(x, z) || buildingAt(x, z)) continue;
    let wa = null; for (let q = 0; q < 6.283; q += 0.2) if (isWater(x + Math.cos(q) * 30, z + Math.sin(q) * 30)) { wa = q; break; }
    if (wa !== null && !isWater(x + Math.cos(wa) * 8, z + Math.sin(wa) * 8)) { sand = { x, z, wx: Math.cos(wa), wz: Math.sin(wa) }; break; } }
  return sand;
}
function startPolar() {
  const s = polarSpot(); if (!s) return null;
  const crowd = new Crowd(42), people = [];
  for (let i = 0; i < 42; i++) {
    const look = newLook(); look.shirt = pick(COSTUME); look.pants = Math.random() < 0.5 ? look.skin : pick(COSTUME); look.hat = Math.random() < 0.6 ? pick(COSTUME) : null; look.coat = null; look.scarf = Math.random() < 0.3 ? pick(COSTUME) : null; look.bag = null;
    const side = (Math.random() - 0.5) * 50, back = Math.random() * 10, bx = s.x - s.wz * side - s.wx * back, bz = s.z + s.wx * side - s.wz * back;
    let dw = 0; while (dw < 90 && !isWater(bx + s.wx * dw, bz + s.wz * dw)) dw += 1;   // where the water starts for this runner
    people.push({ bx, bz, out: dw + 6 + Math.random() * 10, sp: 3.5 + Math.random() * 2.5, delay: Math.random() * 2.5, x: 0, y: 0, z: 0, yaw: 0, cols: look, state: 'walk', kind: 'dance', phase: Math.random() * 6, amp: 0.7, visible: true, dirty: true });
  }
  return { s, crowd, people, t: 0, told: false };
}
const PB_LEN = 150;   // seconds: gather 25, charge in, splash, charge out, shiver
function updatePolar(dt, pl) {
  const [ex, ez] = toXZ(49.2866, -123.1430), d = Math.hypot(pl.x - ex, pl.z - ez);
  const open = G.season === 'winter' && G.hour > 12.5 && G.hour < 16.5;
  if (!pb) { if (open && d < 450) pb = startPolar(); if (!pb) return; }
  pb.t += dt; const t = pb.t, s = pb.s;
  if (!pb.told && d < 500) { pb.told = true; ui.toast('🐻‍❄️ Polar Bear Swim!', 'A crowd in costumes is about to charge into the freezing sea at English Bay (a Vancouver tradition since 1920). Brave enough to swim out with them?', 6000); }
  for (const p of pb.people) {
    const tt = t - 25 - p.delay; let dist;   // distance out from the start line
    if (tt < 0) { dist = 0; p.kind = 'dance'; p.amp = 0.5; p.phase += dt * 4; }
    else if (tt < p.out / p.sp) { dist = tt * p.sp; p.kind = 'walk'; p.amp = 1; p.phase += dt * 11; }
    else if (tt < p.out / p.sp + 35) { dist = p.out; p.kind = 'swim'; p.amp = 0.8; p.phase += dt * 6; }
    else if (tt < p.out / p.sp * 2 + 35) { dist = p.out - (tt - p.out / p.sp - 35) * p.sp * 1.3; p.kind = 'walk'; p.amp = 1; p.phase += dt * 13; }
    else { dist = -2; p.kind = 'idle'; p.amp = 0.2; p.phase += dt * 22; }   // shivering
    dist = Math.max(-2, dist);
    p.x = p.bx + s.wx * dist; p.z = p.bz + s.wz * dist;
    const g0 = gy(p.x, p.z);
    p.y = p.kind === 'swim' ? Math.max(g0 - 0.6, -1.45 + Math.sin(p.phase) * 0.06) : Math.max(g0, -1.0);   // wading in, then swimming (sea level 0)
    const back = p.kind === 'walk' && tt > p.out / p.sp + 35; p.yaw = Math.atan2(back ? s.wx : -s.wx, back ? s.wz : -s.wz);
  }
  pb.crowd.draw(pb.people);
  // joining in: be in the water near them while they splash
  if (t > 30 && t < 110 && !pl.vehicle && (pl.swimming || isWater(pl.x, pl.z)) && pb.people.some(p => p.kind === 'swim' && Math.hypot(p.x - pl.x, p.z - pl.z) < 25)) {   // (wading in counts: they splash in the shallows)
    if (!pb.joined) { pb.joined = true; ui.toast('🥶 You did it!', 'You took the plunge with the Polar Bear Swim. The water is about 6°C. Everyone is screaming. Nobody regrets it.', 5000); }
    discover('polarbear');
  }
  if (t > PB_LEN || (d > 1500 && t > 5)) { pb.crowd.draw([]); for (const m of Object.values(pb.crowd.meshes)) { scene.remove(m); m.dispose(); } pb = null; lastPB = G.t; }   // next one in 5 minutes
}
let lastPB = -1e9;
const SPOTS_INFO = {};
export function initBeaches() { try { buildPool(); } catch (e) { console.warn('Kits Pool failed', e); } }
export function updateBeaches(dt, pl) {
  updatePool(dt, pl);
  if (pb || G.t - lastPB > 300) updatePolar(dt, pl);
}
export const _beaches = { get pool() { return pool; }, get pb() { return pb; }, startPolar: () => { lastPB = -1e9; pb = startPolar(); return pb; }, SPOTS_INFO };
