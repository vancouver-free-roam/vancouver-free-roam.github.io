// 🛹 Skateparks: every OSM skatepark (sport=skateboard) gets a real concrete park, laid out to fit its size:
// quarter pipes with curved transitions + steel coping + decks (ride up, launch straight up = vert air, come back down),
// a funbox (up ramp, flat top with grindable edges, down ramp), kickers, a bank, a ledge and a flat-bar rail.
// Skating (on the existing skateboard; controls unchanged):
//   W push · A/D steer · hold Space + let go = ollie · in the air: A/D spin, W/S = KICKFLIP / HEELFLIP (only the board
//   flips now, like real skating), hold Shift = grab · land on a rail / ledge / funbox edge = GRIND (Space = ollie out).
//   Off a quarter pipe's lip you go straight up and come back down the ramp ("air to fakie"; spin 180 to land forward).
// Games (E at a skatepark, on foot or on the board): free skate, a 60-second Trick Jam (score goals, combos), and a game
// of S.K.A.T.E. against a local (they set a trick, you match it; miss = you get a letter; spell SKATE = you lose).
// Ambient locals ride the ramps (up the quarter pipes, airs, back down).
import * as THREE from 'three';
import { G, scene, std, key, tapped, pick, R, inPoly, clamp, hash2, wrapAngle, depthBias } from './core.js';
import { groundY } from './terrain.js';
import { addDeck } from './city.js';
import { setColliders } from './colliders.js';
import { takeoff, trickHooks, trickStats } from './moves.js';
import { makeVehicle } from './vehicles.js';
import { ui } from './ui.js';
import { sfx } from './sound.js';

const parks = new Map();   // MAP area → park
let pl = null, discover = null, colList = [];
const QR = 2.4, QT = 1.32, QH = QR * (1 - Math.cos(QT)), QD = QR * Math.sin(QT);   // quarter pipe: radius, end angle (~76°), height (≈1.9 m), depth

// ---------- geometry kit (vertex coloured) ----------
function Kit() {
  const pos = [], col = [], c = new THREE.Color();
  return {
    tri(a, b, d, color) { c.set(color); for (const p of [a, b, d]) { pos.push(p[0], p[1], p[2]); col.push(c.r, c.g, c.b); } },
    quad(a, b, d, e, color) { this.tri(a, b, d, color); this.tri(a, d, e, color); },
    box(cx, cy, cz, sx, sy, sz, yaw, color) { const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed(); g.rotateY(yaw); g.translate(cx, cy, cz); c.set(color); pos.push(...g.attributes.position.array); for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b); },
    cyl(ax, ay, az, bx, by, bz, r, color) { const L = Math.hypot(bx - ax, by - ay, bz - az), g = new THREE.CylinderGeometry(r, r, L, 8).toNonIndexed(); const o = new THREE.Object3D(); o.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2); o.lookAt(bx, by, bz); o.rotateX(Math.PI / 2); o.updateMatrix(); g.applyMatrix4(o.matrix); c.set(color); pos.push(...g.attributes.position.array); for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b); },
    mesh() { if (!pos.length) return null; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals(); const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide })); m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; },
  };
}
const CONC = '#8e8b84', CONC2 = '#76736d', STEEL = '#a7adb3', DARK = '#4a4e53';

// ---------- building a park ----------
export function ensurePark(V, a, onRoad) {
  if (parks.has(a)) return parks.get(a);
  const P = { V, els: [], segs: [], qps: [], base: 0, crowd: 0 };
  parks.set(a, P);
  const loc = (u, v) => [V.x + V.ux * u + V.vx * v, V.z + V.uz * u + V.vz * v];
  const fits = (u0, u1, v0, v1) => { for (const u of [u0, (u0 + u1) / 2, u1]) for (const v of [v0, (v0 + v1) / 2, v1]) { const [x, z] = loc(u, v); if (!inPoly(x, z, a.p) && Math.hypot(x - V.x, z - V.z) > Math.max(V.L, V.W) * 0.62) return false; if (onRoad(x, z)) return false; } return true; };
  // the pad: one level, the highest ground under the park (the ramps stand on it; a kerb hides the step)
  let hi = -1e9, lo = 1e9; for (let u = -V.L / 2; u <= V.L / 2; u += 3) for (let v = -V.W / 2; v <= V.W / 2; v += 3) { const [x, z] = loc(u, v); const h = groundY(x, z); hi = Math.max(hi, h); lo = Math.min(lo, h); }
  const b = P.base = hi + 0.08; const K = Kit();
  { // concrete pad with saw-cut joints (drawn as a single slab; addFlatSurface would block the decks, so each part is a low deck)
    const L = Math.max(8, V.L - 0.6), W = Math.max(6, V.W - 0.6), n = Math.ceil(L / 2.5), m = Math.ceil(W / 2.5);
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { const u0 = -L / 2 + i * L / n, u1 = u0 + L / n, v0 = -W / 2 + j * W / m, v1 = v0 + W / m, [x0, z0] = loc(u0, v0), [x1, z1] = loc(u1, v0), [x2, z2] = loc(u1, v1), [x3, z3] = loc(u0, v1), c = ['#8a8780', '#86837c', '#8d8a83'][(i * 7 + j * 3) % 3]; K.quad([x0, b, z0], [x3, b, z3], [x2, b, z2], [x1, b, z1], c); }
    for (let i = 1; i < n; i++) { const u = -L / 2 + i * L / n, [ax, az] = loc(u - 0.025, -W / 2), [bx, bz] = loc(u + 0.025, -W / 2), [cx, cz] = loc(u + 0.025, W / 2), [dx, dz] = loc(u - 0.025, W / 2); K.quad([ax, b + 0.006, az], [dx, b + 0.006, dz], [cx, b + 0.006, cz], [bx, b + 0.006, bz], '#5f5c57'); }
    for (let j = 1; j < m; j++) { const v = -W / 2 + j * W / m, [ax, az] = loc(-L / 2, v - 0.025), [bx, bz] = loc(L / 2, v - 0.025), [cx, cz] = loc(L / 2, v + 0.025), [dx, dz] = loc(-L / 2, v + 0.025); K.quad([ax, b + 0.006, az], [dx, b + 0.006, dz], [cx, b + 0.006, cz], [bx, b + 0.006, bz], '#5f5c57'); }
    for (const [ua, va, ub, vb] of [[-L / 2, -W / 2, L / 2, -W / 2], [L / 2, -W / 2, L / 2, W / 2], [L / 2, W / 2, -L / 2, W / 2], [-L / 2, W / 2, -L / 2, -W / 2]]) { const [xa, za] = loc(ua, va), [xb, zb] = loc(ub, vb); K.quad([xa, b, za], [xb, b, zb], [xb, lo - 0.4, zb], [xa, lo - 0.4, za], CONC2); }
    for (let u = -L / 2; u < L / 2; u += 4) { addDeck(...loc(u + 2, -W / 2), b, ...loc(u + 2, W / 2), b, 2.05); }
  }
  const L = V.L, W = V.W;
  // quarter pipes at both ends
  if (L >= 22) for (const s of [-1, 1]) {
    const w = Math.min(W - 2, 10), u0 = s * (L / 2 - 0.8 - QD - 2.2); if (w < 4 || !fits(Math.min(u0, u0 + s * (QD + 2.2)), Math.max(u0, u0 + s * (QD + 2.2)), -w / 2, w / 2)) continue;
    quarterPipe(P, K, loc, u0, s, 0, w);
  }
  // funbox in the middle (with grindable top edges), offset to one side if there's room for a rail beside it
  if (L >= 18) { const vc = W >= 14 ? -W * 0.16 : 0; if (fits(-5.2, 5.2, vc - 1.9, vc + 1.9)) funbox(P, K, loc, 0, vc); }
  // ledge + rail along the other side
  if (W >= 10) { const vr = W * 0.24; if (fits(-3, 3, vr - 0.5, vr + 0.5)) rail(P, K, loc, -3, 3, vr); }
  if (W >= 8) { const vl = W >= 14 ? W * 0.36 : -W * 0.3; if (fits(-3.2, 3.2, vl - 0.5, vl + 0.5)) ledge(P, K, loc, -L * 0.18 - 1, -L * 0.18 + 4, vl); }
  // a kicker aimed down the park, and a bank along a side
  if (L >= 16) { const uk = -L * 0.18, vk = W >= 14 ? W * 0.12 : -W * 0.25; if (fits(uk - 2.6, uk + 0.2, vk - 1.1, vk + 1.1)) kicker(P, K, loc, uk, vk, 1); }
  if (W >= 16 && L >= 26) { const vb = -W / 2 + 0.6; if (fits(-L * 0.25, L * 0.25, vb, vb + 3)) bank(P, K, loc, -L * 0.25, L * 0.25, vb, 1); }
  if (!P.els.length) { const vr = 0; if (fits(-2.5, 2.5, vr - 0.4, vr + 0.4)) rail(P, K, loc, -2.5, 2.5, vr); }
  P.mesh = K.mesh();
  setColliders('skatepark', colList);
  return P;
}
// quarter pipe: transition starts at u0 and rises toward +s; the deck platform sits behind it
function quarterPipe(P, K, loc, u0, s, vc, w) {
  const b = P.base, N = 12, prof = [];
  for (let k = 0; k <= N; k++) { const th = QT * k / N; prof.push([QR * Math.sin(th), QR * (1 - Math.cos(th))]); }
  const at = (du, v, h) => { const [x, z] = loc(u0 + s * du, vc + v); return [x, b + h, z]; };
  for (let k = 0; k < N; k++) { const [d0, h0] = prof[k], [d1, h1] = prof[k + 1]; K.quad(at(d0, -w / 2, h0), at(d1, -w / 2, h1), at(d1, w / 2, h1), at(d0, w / 2, h0), k % 2 ? CONC : '#95928b'); for (const side of [-1, 1]) K.quad(at(d0, side * w / 2, 0), at(d0, side * w / 2, h0), at(d1, side * w / 2, h1), at(d1, side * w / 2, 0), CONC2); }
  const D = 2.2;   // deck platform
  K.quad(at(QD, -w / 2, QH), at(QD + D, -w / 2, QH), at(QD + D, w / 2, QH), at(QD, w / 2, QH), '#83807a');
  K.quad(at(QD + D, -w / 2, QH), at(QD + D, -w / 2, -0.4), at(QD + D, w / 2, -0.4), at(QD + D, w / 2, QH), CONC2);
  for (const side of [-1, 1]) K.quad(at(QD, side * w / 2, 0), at(QD, side * w / 2, QH), at(QD + D, side * w / 2, QH), at(QD + D, side * w / 2, 0), CONC2);
  K.cyl(...at(QD, -w / 2, QH + 0.03), ...at(QD, w / 2, QH + 0.03), 0.045, STEEL);   // coping
  for (let v = -w / 2; v <= w / 2 + 0.01; v += w / 4) K.cyl(...at(QD + D - 0.15, v, QH), ...at(QD + D - 0.15, v, QH + 1.0), 0.03, DARK);   // railing at the back
  K.cyl(...at(QD + D - 0.15, -w / 2, QH + 1.0), ...at(QD + D - 0.15, w / 2, QH + 1.0), 0.03, DARK);
  for (let k = 0; k < N; k++) { const [d0, h0] = prof[k], [d1, h1] = prof[k + 1], A = at(d0, 0, h0), B = at(d1, 0, h1); addDeck(A[0], A[2], A[1], B[0], B[2], B[1], w / 2); }
  { const A = at(QD, 0, QH), B = at(QD + D - 0.1, 0, QH); addDeck(A[0], A[2], A[1], B[0], B[2], B[1], w / 2); }
  for (let v = -w / 2; v <= w / 2; v += 0.8) { const [x, , z] = at(QD + D, v, 0); colList.push({ x, z, r: 0.35, top: b + QH + 1 }); }
  const [lx, , lz] = at(QD, 0, QH), dir = [P.V.ux * s, P.V.uz * s];
  const q = { u0, s, vc, w, lip: [lx, lz], y: b + QH, dir, yawUp: Math.atan2(-dir[0], -dir[1]) }; P.qps.push(q); P.els.push({ k: 'qp', ...q });
}
function funbox(P, K, loc, uc, vc) {
  const b = P.base, H = 0.9, T = 2.2, RL = 3.0, w = 3.6, at = (u, v, h) => { const [x, z] = loc(uc + u, vc + v); return [x, b + h, z]; };
  const prof = [[-T - RL, 0], [-T, H], [T, H], [T + RL, 0]];
  for (let k = 0; k < 3; k++) { const [u0, h0] = prof[k], [u1, h1] = prof[k + 1]; K.quad(at(u0, -w / 2, h0), at(u1, -w / 2, h1), at(u1, w / 2, h1), at(u0, w / 2, h0), k === 1 ? '#8a877f' : CONC); for (const side of [-1, 1]) K.quad(at(u0, side * w / 2, 0), at(u0, side * w / 2, h0), at(u1, side * w / 2, h1), at(u1, side * w / 2, 0), CONC2); }
  for (const side of [-1, 1]) { K.box(...at(0, side * (w / 2 - 0.03), H + 0.01), 2 * T, 0.05, 0.08, Math.atan2(P.V.ux, P.V.uz) + Math.PI / 2, STEEL); const A = at(-T + 0.1, side * (w / 2 - 0.05), H + 0.02), B = at(T - 0.1, side * (w / 2 - 0.05), H + 0.02); P.segs.push({ ax: A[0], az: A[2], ay: A[1], bx: B[0], bz: B[2], by: B[1], k: 'ledge' }); }
  for (let k = 0; k < 3; k++) { const [u0, h0] = prof[k], [u1, h1] = prof[k + 1], A = at(u0, 0, h0), B = at(u1, 0, h1); addDeck(A[0], A[2], A[1], B[0], B[2], B[1], w / 2); }
  P.els.push({ k: 'box', uc, vc, H, T, RL, w });
}
function kicker(P, K, loc, uk, vk, s) {
  const b = P.base, H = 0.85, Lk = 2.4, w = 2.0, at = (u, v, h) => { const [x, z] = loc(uk + s * u, vk + v); return [x, b + h, z]; };
  K.quad(at(-Lk, -w / 2, 0), at(0, -w / 2, H), at(0, w / 2, H), at(-Lk, w / 2, 0), '#99968f'); K.quad(at(0, -w / 2, H), at(0, -w / 2, 0), at(0, w / 2, 0), at(0, w / 2, H), CONC2);
  for (const side of [-1, 1]) K.tri(at(-Lk, side * w / 2, 0), at(0, side * w / 2, H), at(0, side * w / 2, 0), CONC2);
  K.cyl(...at(0, -w / 2, H), ...at(0, w / 2, H), 0.035, STEEL);
  const A = at(-Lk, 0, 0), B = at(0, 0, H); addDeck(A[0], A[2], A[1], B[0], B[2], B[1], w / 2);
  P.els.push({ k: 'kick', uk, vk, s, H, Lk, w });
}
function bank(P, K, loc, u0, u1, v0, s) {
  const b = P.base, H = 1.2, D = 2.6, at = (u, v, h) => { const [x, z] = loc(u, v); return [x, b + h, z]; };
  K.quad(at(u0, v0 + D, 0), at(u1, v0 + D, 0), at(u1, v0, H), at(u0, v0, H), '#93908a'); K.quad(at(u0, v0, H), at(u1, v0, H), at(u1, v0 - 0.6, H), at(u0, v0 - 0.6, H), CONC2);
  for (const u of [u0, u1]) K.quad(at(u, v0 + D, 0), at(u, v0, H), at(u, v0 - 0.6, H), at(u, v0 - 0.6, 0), CONC2);
  for (let u = u0 + 1; u < u1; u += 2) { const A = at(u, v0 + D, 0), B = at(u, v0, H); addDeck(A[0], A[2], A[1], B[0], B[2], B[1], 1.0); }
  P.els.push({ k: 'bank', u0, u1, v0, D, H });
}
function rail(P, K, loc, u0, u1, v) {
  const b = P.base, H = 0.45, [ax, az] = loc(u0, v), [bx, bz] = loc(u1, v);
  K.cyl(ax, b + H, az, bx, b + H, bz, 0.035, '#c9cfd4');
  for (const t of [0.05, 0.5, 0.95]) { const x = ax + (bx - ax) * t, z = az + (bz - az) * t; K.cyl(x, b, z, x, b + H, z, 0.03, DARK); }
  P.segs.push({ ax, az, ay: b + H + 0.02, bx, bz, by: b + H + 0.02, k: 'rail' });
  for (let t = 0; t <= 1; t += 0.12) colList.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, r: 0.12, top: b + H });
  P.els.push({ k: 'rail', u0, u1, v });
}
function ledge(P, K, loc, u0, u1, v) {
  const b = P.base, H = 0.5, [ax, az] = loc(u0, v), [bx, bz] = loc(u1, v), L = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(bx - ax, bz - az);
  K.box((ax + bx) / 2, b + H / 2, (az + bz) / 2, 0.6, H, L, yaw, '#7f7c76'); for (const s of [-1, 1]) K.box((ax + bx) / 2 + Math.cos(yaw) * 0.28 * s, b + H + 0.005, (az + bz) / 2 - Math.sin(yaw) * 0.28 * s, 0.06, 0.03, L, yaw, STEEL);
  P.segs.push({ ax, az, ay: b + H + 0.02, bx, bz, by: b + H + 0.02, k: 'ledge' });
  for (let t = 0; t <= 1; t += 0.1) colList.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, r: 0.32, top: b + H });
  P.els.push({ k: 'ledge', u0, u1, v });
}
// height of the riding surface above the pad (for the locals)
function surfH(P, u, v) {
  let h = 0;
  for (const e of P.els) {
    if (e.k === 'qp' && Math.abs(v - e.vc) < e.w / 2) { const du = (u - e.u0) * e.s; if (du > 0) h = Math.max(h, du >= QD ? QH : QR - Math.sqrt(Math.max(0, QR * QR - du * du))); }
    else if (e.k === 'box' && Math.abs(v - e.vc) < e.w / 2) { const du = Math.abs(u - e.uc); if (du < e.T) h = Math.max(h, e.H); else if (du < e.T + e.RL) h = Math.max(h, e.H * (1 - (du - e.T) / e.RL)); }
    else if (e.k === 'kick' && Math.abs(v - e.vk) < e.w / 2) { const du = (u - e.uk) * e.s; if (du > -e.Lk && du < 0) h = Math.max(h, e.H * (1 + du / e.Lk)); }
  }
  return h;
}

// ---------- the locals riding the ramps (activities.js people; called from its updateVenue) ----------
export function skaterStep(V, s, dt) {
  const P = V.park; if (!P) return;
  const qp = P.qps; const lim = qp.length ? Math.abs(qp[0].u0) + QD - 0.3 : Math.min(V.L / 2 - 3, 18);
  s.dir = s.dir || 1; s.sp = s.sp || R(3.5, 5.5); s.v = s.v ?? R(-V.W / 4, V.W / 4); s.u = s.u ?? R(-lim * 0.5, lim * 0.5);
  if (s.vert > 0) {   // an air above the coping: up, a little grab, back down facing the other way
    s.vert -= dt; const t = 1 - s.vert / 0.9; s.hop = 0; s.yOff = Math.sin(t * Math.PI) * 1.3; if (s.vert <= 0) { s.dir *= -1; s.yOff = 0; }
  } else {
    const h = surfH(P, s.u, s.v), sp = s.sp * Math.max(0.35, 1 - h / (QH * 1.4)); s.u += s.dir * sp * dt;
    const end = qp.find(q => q.s === s.dir && Math.abs(s.v - q.vc) < q.w / 2 - 0.4);
    if (end && (s.u - end.u0) * end.s > QD - 0.25) { s.u = end.u0 + end.s * (QD - 0.25); s.vert = 0.9; }
    else if (Math.abs(s.u) > lim) { s.dir *= -1; s.u = Math.sign(s.u) * lim; }
    s.hop = Math.max(0, (s.hop || 0) - dt); if (!s.hop && Math.random() < dt * 0.25 && h < 0.1) s.hop = 0.55;
    s.yOff = s.hop ? Math.sin((0.55 - s.hop) / 0.55 * Math.PI) * 0.55 : 0;
  }
  const [x, z] = [V.x + V.ux * s.u + V.vx * s.v, V.z + V.uz * s.u + V.vz * s.v];
  s.x = x; s.z = z; s.y = P.base + surfH(P, s.u, s.v) + 0.14 + (s.yOff || 0);
  s.yaw = Math.atan2(-(V.ux * s.dir), -(V.uz * s.dir)) + 1.2 + (s.vert > 0 ? (1 - s.vert / 0.9) * Math.PI : 0); s.kind = 'board'; s.amp = 0;
}

// ---------- grinds, vert airs and grabs (runs after the vehicle physics) ----------
let gr = null, vert = null, wasAir = false, lastVy = 0, grab = 0, grCool = 0, sparks = null;
function nearParks(x, z) { const o = []; for (const P of parks.values()) if (Math.abs(P.V.x - x) < 90 && Math.abs(P.V.z - z) < 90) o.push(P); return o; }
function startGrind(v, P, s) {
  const dx = s.bx - s.ax, dz = s.bz - s.az, L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, t = clamp(((v.x - s.ax) * ux + (v.z - s.az) * uz) / L, 0, 1);
  const hv = Math.hypot(v.vx, v.vz) || Math.abs(v.speed) || 1, c = ((v.vx || 0) * ux + (v.vz || 0) * uz) / hv, slide = Math.abs(c) < 0.45;
  const dir = c >= 0 ? 1 : -1, name = s.k === 'rail' ? (slide ? 'Boardslide' : key('KeyW') ? 'Nosegrind' : key('KeyS') ? '5-0 Grind' : '50-50 Grind') : (slide ? 'Lipslide' : key('KeyW') ? 'Crooked Grind' : '5-0 Grind');
  gr = { s, L, ux, uz, t, dir, sp: clamp(hv * (slide ? 0.8 : 0.95), 2.8, 9), time: 0, name, slide };
  sfx.bump?.();
}
function grindStep(v, dt) {
  const g = gr, s = g.s; g.t += g.dir * g.sp * dt / g.L; g.time += dt; g.sp = Math.max(2.4, g.sp - dt * (g.slide ? 1.2 : 0.5));
  const t = clamp(g.t, 0, 1); v.x = s.ax + (s.bx - s.ax) * t; v.z = s.az + (s.bz - s.az) * t; v.y = s.ay + (s.by - s.ay) * t + 0.02; v.vy = 0;
  v.yaw = Math.atan2(-g.ux * g.dir, -g.uz * g.dir) + (g.slide ? Math.PI / 2 : 0); v.speed = g.slide ? 0 : g.sp; v.vx = g.ux * g.dir * g.sp; v.vz = g.uz * g.dir * g.sp;
  if (v.air) { v.air.spin = 0; v.air.flip = 0; v.air.t = 0; }
  if (sparks) { sparks.visible = true; const p = sparks.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setXYZ(i, v.x + R(-0.15, 0.15), v.y + R(0, 0.25), v.z + R(-0.15, 0.15)); p.needsUpdate = true; }
  const pop = tapped('Space');
  if (g.t <= 0 || g.t >= 1 || pop) {
    const dist = g.time * g.sp, pts = Math.round(60 + g.time * 50 + dist * 8 + (g.slide ? 30 : 0));
    v.vy = pop ? 5.2 : 2.2; v.speed = g.sp; v.yaw = Math.atan2(-g.ux * g.dir, -g.uz * g.dir); v.y += 0.05; takeoff(v, v.x, v.z); v.air.t = 0.2;
    trickStats.combo++; const mult = Math.min(4, trickStats.combo), cash = Math.round(pts / 12) * mult; pl.money += cash; pl.stats.grinds = (pl.stats.grinds || 0) + 1;
    ui.toast(`🛹 ${g.name}!`, `${dist.toFixed(1)} m · ${g.time.toFixed(1)} s${mult > 1 ? ` · combo x${mult}` : ''} · +$${cash}`, 2200); sfx.coin?.();
    onTrick({ names: [g.name], pts: pts * mult, grind: true, t: g.time });
    discover?.('grind'); gr = null; grCool = 0.35; if (sparks) sparks.visible = false;
  }
}
function updateBoardTricks(dt) {
  const v = pl.vehicle; grCool -= dt;
  if (!v || v.type !== 'skate') { gr = null; vert = null; wasAir = false; if (sparks) sparks.visible = false; return; }
  if (gr) { grindStep(v, dt); wasAir = true; return; }
  let air = !!v.air; const ps = nearParks(v.x, v.z);
  // reaching the coping with speed: the near-vertical wall sends you straight up (the deck behind would just roll you over)
  if (!air && Math.abs(v.speed) > 2.6) for (const P of ps) for (const q of P.qps) {
    const du = (v.x - q.lip[0]) * q.dir[0] + (v.z - q.lip[1]) * q.dir[1], dv = Math.abs((v.x - q.lip[0]) * -q.dir[1] + (v.z - q.lip[1]) * q.dir[0]);
    const mv = (v.vx || 0) * q.dir[0] + (v.vz || 0) * q.dir[1];
    if (du > -1.0 && du < 1.3 && dv < q.w / 2 - 0.2 && mv > 2.4 && v.y > q.y - 0.6) {
      const up = Math.min(11, mv * 0.95 + 0.8), fdot = -Math.sin(v.yaw) * q.dir[0] + -Math.cos(v.yaw) * q.dir[1];
      v.x = q.lip[0] - q.dir[0] * 0.3; v.z = q.lip[1] - q.dir[1] * 0.3; v.y = q.y + 0.4; v.vy = up; takeoff(v, v.x, v.z);
      v.speed = (fdot > 0 ? -1 : 1) * 0.3; v.vx = -q.dir[0] * 0.3; v.vz = -q.dir[1] * 0.3; v.air.bonus = 40; vert = { q }; air = true; wasAir = true; lastVy = up;
      if (!q.told) { q.told = true; ui.toast('🛹 Vert!', 'Up the quarter pipe and straight into the air. Spin (A/D), kickflip (W/S) or grab (Shift), then come back down the ramp.', 3500); }
      break;
    }
  }
  // just left the ground: off a quarter pipe lip, going up? → vert air (straight up, back down the ramp)
  if (air && !wasAir) for (const P of ps) for (const q of P.qps) {
    const du = (v.x - q.lip[0]) * q.dir[0] + (v.z - q.lip[1]) * q.dir[1], dv = Math.abs((v.x - q.lip[0]) * -q.dir[1] + (v.z - q.lip[1]) * q.dir[0]);
    const fdot = -Math.sin(v.yaw) * q.dir[0] + -Math.cos(v.yaw) * q.dir[1];
    if (du > -1.4 && du < 0.8 && dv < q.w / 2 && v.vy > 1 && Math.abs(fdot) > 0.3) { vert = { q, back: fdot > 0 }; v.vy = Math.max(v.vy, 4.5) + Math.abs(v.speed) * 0.25; v.speed = (fdot > 0 ? -1 : 1) * 0.35; v.air.bonus = 40; break; }
  }
  if (air) {
    lastVy = v.vy;
    if (key('ShiftLeft') || key('ShiftRight')) { grab += dt; if (grab > 0.25) v.air.bonus = (v.air.bonus || 0) + dt * 60; }
    const gname = grab > 0.25 ? (vert ? 'Method air' : 'Indy grab') : '';
    v.air.tag = vert ? (gname || (Math.abs(v.air.spin) > 1.5 ? 'Air' : 'Air to fakie')) : gname || undefined;
    // falling onto a rail / ledge / funbox edge = grind
    if (v.vy < 0.5 && grCool <= 0) for (const P of ps) for (const s of P.segs) {
      const dx = s.bx - s.ax, dz = s.bz - s.az, L = Math.hypot(dx, dz), t = ((v.x - s.ax) * dx + (v.z - s.az) * dz) / (L * L); if (t < 0.03 || t > 0.97) continue;
      const lat = Math.abs((v.x - s.ax) * dz - (v.z - s.az) * dx) / L, sy = s.ay + (s.by - s.ay) * t, dy = v.y - sy;
      if (lat < 0.5 && dy > -0.3 && dy < 0.55) { startGrind(v, P, s); grab = 0; vert = null; return; }
    }
  } else {
    if (wasAir && vert) {   // came back down the quarter pipe: ride away down the ramp
      const down = [-vert.q.dir[0], -vert.q.dir[1]], f = [-Math.sin(v.yaw), -Math.cos(v.yaw)], sp = Math.min(11, Math.abs(lastVy) * 0.9 + 1.5);
      if (f[0] * down[0] + f[1] * down[1] < 0) v.yaw = Math.atan2(-down[0], -down[1]);   // landed backwards: ride away (fakie, shown facing down the ramp)
      v.speed = sp;
      v.vx = down[0] * sp; v.vz = down[1] * sp; vert = null;
    }
    grab = 0; vert = null;
  }
  wasAir = air;
}

// ---------- session games: Trick Jam + S.K.A.T.E. ----------
let session = null, card = null;
function showCard(html) {
  if (!card) { card = document.createElement('div'); card.id = 'skatecard'; card.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:40;background:#111827e6;border:2px solid #f6ad55;border-radius:14px;padding:8px 18px;color:#fff;font:15px Segoe UI,Arial,sans-serif;text-align:center;max-width:min(620px,92vw);pointer-events:none;box-shadow:0 4px 24px #0008;line-height:1.45'; document.body.appendChild(card); }
  card.innerHTML = html || ''; card.style.display = html ? '' : 'none';
}
const KB = s => `<kbd style="background:#333;border:1px solid #777;border-radius:4px;padding:0 5px">${s}</kbd>`;
const HOWTO = `${KB('W')} push · hold ${KB('Space')} + let go = ollie · air: ${KB('A')}/${KB('D')} spin, ${KB('W')}/${KB('S')} kickflip / heelflip, hold ${KB('Shift')} grab · drop onto rails/ledges = grind`;
const DIFF = { 'Kickflip': 0.8, 'Heelflip': 0.75, '180': 0.85, '360': 0.55, '180 + Kickflip': 0.5, '180 + Heelflip': 0.45, 'Double Kickflip': 0.35, '50-50 Grind': 0.8, '5-0 Grind': 0.7, 'Boardslide': 0.7, 'Lipslide': 0.6, 'Nosegrind': 0.6, 'Indy grab': 0.75, 'Air to fakie': 0.8, 'Method air': 0.6, 'Indy grab + 180': 0.45 };
function canon(ev) { return ev.names.filter(n => n !== 'Big air').join(' + ') || 'Big air'; }
function setList(P) { return Object.keys(DIFF).filter(t => (P.qps.length || !/fakie|Method/.test(t)) && (P.segs.some(s => s.k === 'rail') || !/Board|Nose|50-50/.test(t)) && (P.segs.length || !/Grind|slide/.test(t))); }
const LOCALS = ['Jaden', 'Kiko', 'Mo', 'Big Tash', 'Ollie (yes, really)', 'Priya', 'Dusty'];
function onTrick(ev) {
  const S = session; if (!S || !ev) return;
  if (S.kind === 'jam') {
    if (ev.bail) { S.combo = 0; return; }
    S.score += ev.pts || 0; S.tricks++; S.best = Math.max(S.best, ev.pts || 0); S.last = canon(ev);
  } else if (S.kind === 'skate') {
    if (S.phase === 'match') {   // your attempt at the local's trick
      const ok = !ev.bail && canon(ev) === S.trick; S.phase = 'wait'; S.wait = 2.2;
      if (ok) { ui.toast('✅ Matched!', `You landed the ${S.trick}. No letter.`, 2000); sfx.coin?.(); }
      else { S.you++; ui.toast(`❌ ${ev.bail ? 'Bail!' : 'That was a ' + canon(ev)} — letter "${'SKATE'[S.you - 1]}"`, `${S.local} needed a ${S.trick}.`, 2600); sfx.fail?.(); }
      if (S.you >= 5) return endSkate(false);
    } else if (S.phase === 'yourset') {   // you set a trick: the local tries to match it
      if (ev.bail) { ui.toast('😬 Missed your set', `Your turn passes to ${S.local}.`, 2000); S.setter = 'them'; S.phase = 'wait'; S.wait = 2; return; }
      S.trick = canon(ev); const p = DIFF[S.trick] ?? 0.45; S.phase = 'them-match'; S.wait = 2.6; S.lands = Math.random() < p * 0.92;
      ui.toast(`🎯 You set: ${S.trick}`, `${S.local} has to match it…`, 2200);
    }
  }
}
function startSession(kind, P) {
  if (!pl.vehicle || pl.vehicle.type !== 'skate') { const sk = makeVehicle('skate', pl.x, pl.z, pl.yaw, { color: pick(['#1a1a1a', '#c53030', '#2b6cb0', '#d69e2e']) }); pl.enterVehicle(sk); }
  trickStats.combo = 0;
  if (kind === 'jam') { session = { kind, P, t: 60, score: 0, tricks: 0, best: 0, last: '' }; ui.toast('⏱️ Trick Jam: 60 seconds!', 'Land tricks, chain combos (don\'t bail!). Goals: 1,500 Local · 4,000 Sponsored · 8,000 PRO', 3500); }
  else { session = { kind, P, local: pick(LOCALS), you: 0, them: 0, setter: 'them', phase: 'wait', wait: 1.5, trick: '', list: setList(P) }; ui.toast(`🛹 Game of S.K.A.T.E. vs ${session.local}`, 'They set a trick, you match it. Miss = a letter. Land your own set trick and they have to match yours. Spell SKATE = you lose.', 5000); }
}
function endJam() {
  const S = session; session = null; showCard(null);
  const tier = S.score >= 8000 ? ['🏆 PRO!', 150] : S.score >= 4000 ? ['⭐ Sponsored', 60] : S.score >= 1500 ? ['👍 Local', 20] : ['🙂 Keep practising', 0];
  pl.money += tier[1]; if (tier[1] >= 60) discover?.('skatejam'); pl.stats.jamBest = Math.max(pl.stats.jamBest || 0, S.score);
  ui.toast(`⏱️ Time! ${tier[0]}`, `${S.score.toLocaleString()} points from ${S.tricks} tricks (best ${S.best}). ${tier[1] ? `+$${tier[1]}` : 'Goals: 1,500 / 4,000 / 8,000.'}`, 5000); sfx.chime?.();
}
function endSkate(win) {
  const S = session; session = null; showCard(null);
  if (win) { pl.money += 40; discover?.('skategame'); ui.toast(`🏆 You beat ${S.local} at S.K.A.T.E.!`, `They spell ${'SKATE'.slice(0, S.them)}. +$40 and a new respect from the locals.`, 4500); sfx.chime?.(); }
  else ui.toast(`🛹 ${S.local} wins`, `You spelled S.K.A.T.E. They let you keep the board for the afternoon. Rematch?`, 4500);
}
function updateSession(dt) {
  const S = session; if (!S) return;
  const far = Math.hypot(pl.x - S.P.V.x, pl.z - S.P.V.z) > Math.max(S.P.V.L, S.P.V.W) / 2 + 30;
  if (tapped('Escape') || far || (!pl.vehicle && (S.off = (S.off || 0) + dt) > 4)) { ui.toast('🛹 Session over', far ? 'You left the park.' : 'Come back any time.', 1800); session = null; showCard(null); return; }
  if (pl.vehicle) S.off = 0;
  if (S.kind === 'jam') {
    S.t -= dt; if (S.t <= 0) return endJam();
    const goal = S.score >= 8000 ? 'PRO reached!' : S.score >= 4000 ? 'next: 8,000 PRO' : S.score >= 1500 ? 'next: 4,000 Sponsored' : 'next: 1,500 Local';
    showCard(`⏱️ <b style="font-size:20px;color:${S.t < 10 ? '#fc8181' : '#f6ad55'}">${Math.ceil(S.t)}</b> s · <b>${S.score.toLocaleString()}</b> pts · ${goal}${trickStats.combo > 1 ? ` · combo x${Math.min(4, trickStats.combo)}` : ''}${S.last ? `<br><small>last: ${S.last}</small>` : ''}<br><small>${HOWTO} · ${KB('Esc')} stop</small>`);
  } else {
    const L = n => `<span style="letter-spacing:3px;font-weight:bold">${'SKATE'.split('').map((c, i) => `<span style="color:${i < n ? '#fc8181' : '#4a5568'}">${c}</span>`).join('')}</span>`;
    if (S.phase === 'wait') { S.wait -= dt; if (S.wait <= 0) {
      if (S.setter === 'them') { S.trick = pick(S.list); S.phase = 'them-set'; S.wait = 2.4; ui.toast(`🛹 ${S.local} goes for a ${S.trick}…`, '', 2000); }
      else { S.phase = 'yourset'; S.t = 30; ui.toast('🎯 Your turn to set a trick', 'Land any trick: they have to copy it.', 2500); } } }
    else if (S.phase === 'them-set') { S.wait -= dt; if (S.wait <= 0) { if (Math.random() < (DIFF[S.trick] ?? 0.5) + 0.08) { S.phase = 'match'; S.t = 30; ui.toast(`🤙 ${S.local} landed a ${S.trick}!`, 'Your turn: match it (one try).', 2600); } else { ui.toast(`💥 ${S.local} bailed the ${S.trick}`, 'Your turn to set.', 2200); S.setter = 'you'; S.phase = 'wait'; S.wait = 1.6; } } }
    else if (S.phase === 'them-match') { S.wait -= dt; if (S.wait <= 0) { if (S.lands) ui.toast(`🤙 ${S.local} matched it`, 'Set another one!', 2000); else { S.them++; ui.toast(`💥 ${S.local} missed! Letter "${'SKATE'[S.them - 1]}"`, 'Keep setting.', 2200); sfx.coin?.(); if (S.them >= 5) return endSkate(true); } S.phase = 'wait'; S.wait = 1.4; } }
    else if (S.phase === 'match' || S.phase === 'yourset') { S.t -= dt; if (S.t <= 0) { if (S.phase === 'match') onTrick({ bail: true, names: [] }); else { ui.toast('⏳ Too slow', `Turn passes to ${S.local}.`, 1800); S.setter = 'them'; S.phase = 'wait'; S.wait = 1.5; } } }
    const what = S.phase === 'match' ? `Match: <b style="color:#fbd38d">${S.trick}</b> (${Math.ceil(S.t)} s, one try)` : S.phase === 'yourset' ? `Set a trick! (${Math.ceil(S.t)} s)` : S.phase === 'them-set' ? `${S.local} is trying a ${S.trick}…` : S.phase === 'them-match' ? `${S.local} tries your ${S.trick}…` : '…';
    showCard(`🛹 S.K.A.T.E. · You ${L(S.you)} · ${S.local} ${L(S.them)}<br>${what}<br><small>${HOWTO} · ${KB('Esc')} stop</small>`);
  }
}

// ---------- prompt / init / update ----------
export function skatePrompt(player, V) {
  if (session || G.dialogOpen) return '';
  let P = null; if (V?.park) P = V.park; else for (const p of parks.values()) { const dx = player.x - p.V.x, dz = player.z - p.V.z, u = dx * p.V.ux + dz * p.V.uz, v = dx * p.V.vx + dz * p.V.vz; if (Math.abs(u) < p.V.L / 2 + 2 && Math.abs(v) < p.V.W / 2 + 2) { P = p; break; } }
  if (!P) return '';
  const onBoard = player.vehicle?.type === 'skate'; if (player.vehicle && !onBoard) return '';
  if (tapped('KeyE')) {
    ui.dialog('🛹 Skatepark', 'Locals are shredding. What do you want to do?', [onBoard ? '🛹 Just skate' : '🛹 Borrow a board & free skate', '⏱️ Trick Jam (60 s, score goals)', '🔤 Game of S.K.A.T.E. vs a local', 'Cancel']).then(i => {
      if (i === 0 && !onBoard) { const sk = makeVehicle('skate', player.x, player.z, player.yaw, { color: pick(['#1a1a1a', '#c53030', '#2b6cb0']) }); player.enterVehicle(sk); ui.toast('🛹 A local lends you a board', HOWTO.replace(/<[^>]+>/g, ''), 6000); discover?.('skatepark'); }
      else if (i === 1) startSession('jam', P); else if (i === 2) startSession('skate', P);
    });
  }
  return `<kbd>E</kbd> 🛹 Skatepark: ${onBoard ? 'Trick Jam / S.K.A.T.E.' : 'borrow a board, Trick Jam, S.K.A.T.E.'}`;
}
export function initSkateparks(player, disc) {
  pl = player; discover = disc;
  trickHooks.push(ev => { if (ev.sk || ev.bail) onTrick(ev); });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
  sparks = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffd27a', size: 0.09, transparent: true, opacity: 0.9, depthWrite: false })); sparks.frustumCulled = false; sparks.visible = false; scene.add(sparks);
}
export function updateSkateparks(dt) { if (!pl) return; updateBoardTricks(dt); updateSession(dt); }
export const _skate = { parks, get session() { return session; }, startSession, get grind() { return gr; }, surfH, QH, QD };
