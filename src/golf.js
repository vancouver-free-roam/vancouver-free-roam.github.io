// ⛳ The real pitch & putt courses of Vancouver, Burnaby, the North Shore and Richmond — every one playable.
// Hole layouts come from OpenStreetMap (src/parkdata.js, made by tools/fetch-parks.mjs): golf=hole lines (tee → pin),
// greens, pins, tees, bunkers, water hazards and fairways. Courses with no mapped holes get holes laid out inside the
// real course outline (MAP.areas). Courses are drawn only when you are near (mowed approach stripes, greens + fringe,
// tee boxes with markers, bunkers, ponds, flags, hole signs, benches, ball washers, a clubhouse booth).
// The game itself (clubs, wind, flight + spin + roll, sloped greens with a putting read, scorecard vs par, hole-in-one,
// crows that steal balls, geese on the greens…) is registered into activities.js as GAMES.course, so it shares the
// how-to card / score card / Esc / play-again flow with the other sports.
import * as THREE from 'three';
import { G, scene, std, key, tapped, pick, R, inPoly, wrapAngle, clamp, hash2, vnoise, depthBias } from './core.js';
import { groundY, isWater, treeChunks, clearZones } from './terrain.js';
import { _colliderGrids } from './colliders.js';
import { nearestRoad, isDriveType, buildingAt } from './city.js';
import { PARKDATA } from './parkdata.js';
import { ui } from './ui.js';
import { sfx } from './sound.js';

const NAME_RE = { qe: /^Queen Elizabeth Pitch/, stanley: /^Stanley Park Pitch/, rupert: /^Rupert Park Pitch/, wrich: /^West Richmond Pitch/, ambleside: /^Ambleside Par 3/, kensington: /^Kensington Pitch/, central: /^Central Park Pitch/, murdo: /^Murdo Frazer/ };
const FEE = { qe: 14, stanley: 14, rupert: 13, wrich: 12, ambleside: 16, kensington: 12, central: 12, murdo: 8 };
export const COURSES = [];
let pl = null, H = null, built = new Set();
const cen = p => { let x = 0, z = 0, n = p.length / 2; for (let i = 0; i < p.length; i += 2) { x += p[i]; z += p[i + 1]; } return [x / n, z / n]; };
function edgeDist(p, x, z) { let d = 1e9; for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length, ax = p[i], az = p[i + 1], bx = p[j] - ax, bz = p[j + 1] - az, L = bx * bx + bz * bz || 1, t = clamp(((x - ax) * bx + (z - az) * bz) / L, 0, 1); d = Math.min(d, Math.hypot(x - ax - bx * t, z - az - bz * t)); } return d; }
function segDist(path, x, z) { let d = 1e9, u = 0, best = 0; for (let i = 0; i + 3 < path.length; i += 2) { const ax = path[i], az = path[i + 1], bx = path[i + 2] - ax, bz = path[i + 3] - az, L2 = bx * bx + bz * bz || 1, L = Math.sqrt(L2), t = clamp(((x - ax) * bx + (z - az) * bz) / L2, 0, 1), dd = Math.hypot(x - ax - bx * t, z - az - bz * t); if (dd < d) { d = dd; best = u + t * L; } u += L; } return [d, best]; }
const blob = (x, z, rx, rz, a, seed) => { const o = []; for (let i = 0; i < 18; i++) { const t = i / 18 * Math.PI * 2, k = 1 + (hash2(seed * 7 + i, seed) - 0.5) * 0.22; const px = Math.cos(t) * rx * k, pz = Math.sin(t) * rz * k; o.push(x + px * Math.cos(a) - pz * Math.sin(a), z + px * Math.sin(a) + pz * Math.cos(a)); } return o; };
const onRoadAt = (x, z) => { const r = nearestRoad(x, z, 16, q => isDriveType(q.t)); return !!((r && r.d < r.road.w / 2 + 1) || buildingAt(x, z)); };

// ---------- laying out the holes ----------
function layout(C) {
  const area = window.MAP.areas.find(a => a.k === 'golf' && !a.line && a.n !== undefined && NAME_RE[C.id].test(window.MAP.names[a.n] || ''));
  C.poly = area ? area.p : null;
  if (!C.poly) { const pts = [...C.green.flat(), ...C.tee.flat()]; if (!pts.length) return false; const [x, z] = cen(pts); C.poly = blob(x, z, 120, 90, 0, 3); }
  const inside = (x, z, m = 0) => inPoly(x, z, C.poly) && edgeDist(C.poly, x, z) >= m && !onRoadAt(x, z) && !isWater(x, z);
  const greens = C.green.map(p => ({ p, c: cen(p), used: false }));
  const pins = C.pin.map(p => [p[0], p[1]]);
  const tees = C.tee.map(p => ({ p, c: p.length > 2 ? cen(p) : [p[0], p[1]] }));
  const greenFor = (x, z) => { let best = null, bd = 22; for (const g of greens) { const d = inPoly(x, z, g.p) ? 0 : Math.hypot(g.c[0] - x, g.c[1] - z); if (d < bd && !g.used) { bd = d; best = g; } } return best; };
  const pinIn = g => { for (const p of pins) if (inPoly(p[0], p[1], g.p)) return p; return g.c; };
  const holes = [];
  for (const h of C.hole) {
    const p = h.p; if (p.length < 4) continue;
    let px = p[p.length - 2], pz = p[p.length - 1]; const tx = p[0], tz = p[1];
    let bd = 14, snap = null; for (const q of pins) { const d = Math.hypot(q[0] - px, q[1] - pz); if (d < bd) { bd = d; snap = q; } } if (snap) { px = snap[0]; pz = snap[1]; }
    const g = greenFor(px, pz); if (g) g.used = true;
    let tp = null, td = 9; for (const t of tees) { const d = t.p.length > 2 && inPoly(tx, tz, t.p) ? 0 : Math.hypot(t.c[0] - tx, t.c[1] - tz); if (d < td) { td = d; tp = t; } }
    holes.push({ ref: h.ref, tee: [tx, tz], pin: [px, pz], green: g ? g.p : null, teeP: tp && tp.p.length > 2 ? tp.p : null, path: p.slice(), par: h.par || 3 });
  }
  // greens with no hole line (Ambleside, Kensington, missing holes): walk them in order, each tee just past the last green
  const spare = greens.filter(g => !g.used);
  const want = C.holes;
  const start = C.club.length ? (C.club[0].length > 2 ? cen(C.club[0]) : C.club[0]) : null;
  const ordered = [];
  if (holes.length) {
    // fill missing refs in between with the closest spare green to the previous hole
    const byRef = new Map(holes.map(h => [h.ref, h]));
    for (let r = 1; r <= want; r++) {
      if (byRef.has(r)) { ordered.push(byRef.get(r)); continue; }
      const prev = ordered[ordered.length - 1]; if (!prev || !spare.length) continue;
      let best = null, bd = 1e9; for (const g of spare) { if (g.used) continue; const d = Math.hypot(g.c[0] - prev.pin[0], g.c[1] - prev.pin[1]); if (d < bd && d > 25) { bd = d; best = g; } }
      if (best) { best.used = true; ordered.push(fromGreen(prev.pin, best, r)); }
    }
  } else if (spare.length) {
    let cur = start || (() => { let s = spare[0].c; for (const g of spare) if (g.c[0] + g.c[1] < s[0] + s[1]) s = g.c; return [s[0] - 30, s[1] - 30]; })();
    for (let r = 1; r <= want && spare.some(g => !g.used); r++) {
      let best = null, bd = 1e9; for (const g of spare) { if (g.used) continue; const d = Math.hypot(g.c[0] - cur[0], g.c[1] - cur[1]); if (d < bd) { bd = d; best = g; } }
      best.used = true; const h = fromGreen(cur, best, r); ordered.push(h); cur = h.pin;
    }
  }
  function fromGreen(from, g, r) {
    const pin = pinIn(g), dx = pin[0] - from[0], dz = pin[1] - from[1], d = Math.hypot(dx, dz) || 1, ux = dx / d, uz = dz / d;
    let off = Math.min(12, d * 0.3); if (d - off < 35) off = Math.max(4, d - 35);
    const tee = [from[0] + ux * off, from[1] + uz * off];
    return { ref: r, tee, pin, green: g.p, teeP: null, path: [tee[0], tee[1], pin[0], pin[1]], par: 3, gen: true };
  }
  // still short: lay new holes out inside the course outline, each starting beside the last green
  const all = ordered.slice();
  let cur = all.length ? all[all.length - 1].pin : (start || cen(C.poly));
  let tries = 0;
  while (all.length < want && tries++ < 60) {
    const r = all.length + 1; let best = null, bs = -1e9;
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2 + hash2(r, k) * 0.3, len = 38 + hash2(k, r * 3) * 50, ux = Math.cos(a), uz = Math.sin(a);
      const tee = [cur[0] + ux * 9, cur[1] + uz * 9], pin = [tee[0] + ux * len, tee[1] + uz * len];
      let ok = true; for (let s = 0; s <= 1.0001; s += 0.1) if (!inside(tee[0] + (pin[0] - tee[0]) * s, tee[1] + (pin[1] - tee[1]) * s, 7)) { ok = false; break; } if (!ok) continue;
      let clash = 1e9; for (const h of all) { clash = Math.min(clash, Math.hypot(h.pin[0] - pin[0], h.pin[1] - pin[1]), Math.hypot(h.tee[0] - pin[0], h.tee[1] - pin[1]), segDist(h.path, pin[0], pin[1])[0], segDist(h.path, (tee[0] + pin[0]) / 2, (tee[1] + pin[1]) / 2)[0]); }
      if (clash < 16) continue;
      const sc = Math.min(clash, 60) + len * 0.3 + hash2(k * 5, r) * 10; if (sc > bs) { bs = sc; best = { tee, pin }; }
    }
    if (!best) { if (!all.length) break; cur = cen(C.poly); const c2 = all[Math.floor(hash2(tries, 9) * all.length)]; cur = [(cur[0] + c2.tee[0]) / 2 + (hash2(tries, 1) - 0.5) * 40, (cur[1] + c2.tee[1]) / 2 + (hash2(tries, 2) - 0.5) * 40]; continue; }
    const a = Math.atan2(best.pin[1] - best.tee[1], best.pin[0] - best.tee[0]);
    all.push({ ref: r, tee: best.tee, pin: best.pin, green: blob(best.pin[0], best.pin[1], 8, 6.5, a + 0.3, r * 13 + C.id.length), teeP: null, path: [best.tee[0], best.tee[1], best.pin[0], best.pin[1]], par: 3, gen: true });
    cur = best.pin;
  }
  if (!all.length) return false;
  // finish each hole: green outline, tee box, length, elevation, hazards near it, a description
  C.holes18 = all.map((h, i) => {
    h.n = i + 1;
    if (!h.green) { const a = Math.atan2(h.pin[1] - h.tee[1], h.pin[0] - h.tee[0]); h.green = blob(h.pin[0], h.pin[1], 8, 6.5, a, i * 17 + 5); }
    if (!inPoly(h.pin[0], h.pin[1], h.green)) { const c = cen(h.green); h.pin = [h.pin[0] * 0.5 + c[0] * 0.5, h.pin[1] * 0.5 + c[1] * 0.5]; }
    const dx = h.pin[0] - h.tee[0], dz = h.pin[1] - h.tee[1]; h.yaw = Math.atan2(-dx, -dz);
    if (!h.teeP) { const ux = dx / Math.hypot(dx, dz), uz = dz / Math.hypot(dx, dz), vx = -uz, vz = ux, x = h.tee[0] - ux * 1.5, z = h.tee[1] - uz * 1.5; h.teeP = [x - ux * 3 - vx * 2.5, z - uz * 3 - vz * 2.5, x + ux * 3 - vx * 2.5, z + uz * 3 - vz * 2.5, x + ux * 3 + vx * 2.5, z + uz * 3 + vz * 2.5, x - ux * 3 + vx * 2.5, z - uz * 3 + vz * 2.5]; }
    let L = 0; for (let k = 0; k + 3 < h.path.length; k += 2) L += Math.hypot(h.path[k + 2] - h.path[k], h.path[k + 3] - h.path[k + 1]); h.len = L;
    h.par = L > 150 ? 4 : 3;
    h.dy = groundY(h.pin[0], h.pin[1]) - groundY(h.tee[0], h.tee[1]);
    h.water = C.water.filter(w => segDist(h.path, ...cen(w))[0] < 25).length > 0;
    h.sand = C.bunker.filter(b => segDist(h.path, ...cen(b))[0] < 18).length > 0;
    // tilted greens: each green leans 1–2.5 % one way (the "break"), plus gentle bumps
    h.tilt = [Math.cos(hash2(i, 77) * 6.28) * (0.01 + hash2(i, 78) * 0.015), Math.sin(hash2(i, 77) * 6.28) * (0.01 + hash2(i, 78) * 0.015)];
    return h;
  });
  // generated bunkers beside about half the greens (if the course has none mapped)
  if (!C.bunker.length) for (const h of C.holes18) { if (hash2(h.n, 31) > 0.5) continue; const a = Math.atan2(h.pin[1] - h.tee[1], h.pin[0] - h.tee[0]) + (hash2(h.n, 32) < 0.5 ? 1.7 : -1.7), c = cen(h.green), r = Math.max(...h.green.map((v, k) => k % 2 ? Math.abs(v - c[1]) : Math.abs(v - c[0]))) + 3.5, x = c[0] + Math.cos(a) * r, z = c[1] + Math.sin(a) * r; if (!inside(x, z, 2)) continue; C.bunker.push(blob(x, z, 3.2, 2, a + 1.57, h.n * 3)); }
  const h1 = C.holes18[0], bx = h1.tee[0] + Math.sin(h1.yaw) * 9, bz = h1.tee[1] + Math.cos(h1.yaw) * 9;   // the booth sits just behind the first tee
  const ok = !onRoadAt(bx, bz) && inPoly(bx, bz, C.poly);
  C.booth = start && Math.hypot(start[0] - h1.tee[0], start[1] - h1.tee[1]) < 120 ? start : ok ? [bx, bz] : [h1.tee[0] + Math.cos(h1.yaw) * 6, h1.tee[1] - Math.sin(h1.yaw) * 6];
  C.par = C.holes18.reduce((s, h) => s + h.par, 0);
  return true;
}

// ---------- what the ball is lying on ----------
export function lieAt(C, x, z, hole) {
  for (const w of C.water) if (inPoly(x, z, w)) return 'water';
  if (isWater(x, z)) return 'water';
  for (const b of C.bunker) if (inPoly(x, z, b)) return 'sand';
  for (const h of C.holes18) { if (inPoly(x, z, h.green)) return 'green'; }
  for (const h of C.holes18) if (edgeDist(h.green, x, z) < 1.4) return 'fringe';
  for (const h of C.holes18) if (inPoly(x, z, h.teeP)) return 'tee';
  for (const f of C.fairway) if (inPoly(x, z, f)) return 'fairway';
  for (const h of C.holes18) if (segDist(h.path, x, z)[0] < fwW(h) / 2 && Math.hypot(x - h.tee[0], z - h.tee[1]) > 3) return 'fairway';
  if (!inPoly(x, z, C.poly) && edgeDist(C.poly, x, z) > 2.5) return 'ob';
  if (onRoadAt(x, z)) return 'ob';
  return 'rough';
}
const fwW = h => clamp(h.len * 0.16, 7, 13);
const FRIC = { green: 0.72, fringe: 1.7, fairway: 2.3, tee: 2.3, rough: 5.5, sand: 15, water: 30, ob: 4 };
const LAND = { green: 1.0, fringe: 0.8, fairway: 0.75, tee: 0.75, rough: 0.35, sand: 0.03, water: 0, ob: 0.4 };   // how much speed survives the first bounce
// slope pull (m/s²): greens follow the hill a little + their own tilt and bumps; elsewhere the hill itself
function slopeAcc(C, h, x, z, lie) {
  const e = 0.7, gx = (groundY(x + e, z) - groundY(x - e, z)) / (2 * e), gz = (groundY(x, z + e) - groundY(x, z - e)) / (2 * e);
  if (lie === 'green' || lie === 'fringe') { const b = (vnoise(x * 0.18 + 40, z * 0.18) - 0.5) * 0.02, b2 = (vnoise(x * 0.18, z * 0.18 + 40) - 0.5) * 0.02; return [-(gx * 0.3 + (h?.tilt[0] || 0) + b) * 9.8 * 0.71, -(gz * 0.3 + (h?.tilt[1] || 0) + b2) * 9.8 * 0.71]; }
  return [-gx * 9.8 * 0.45, -gz * 9.8 * 0.45];
}

// ---------- drawing a course ----------
const MAT = {};
function mat(name, k) { if (!MAT[name]) { MAT[name] = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: name === 'water' ? 0.12 : 0.92, metalness: name === 'water' ? 0.1 : 0 }); depthBias(MAT[name], k); } return MAT[name]; }
class Drape {
  constructor() { this.pos = []; this.col = []; this.idx = []; }
  // make every triangle of the last patch face up (polygons come clockwise or anticlockwise)
  up(i0) { const P = this.pos, I = this.idx; for (let i = i0; i < I.length; i += 3) { const a = I[i] * 3, b = I[i + 1] * 3, c = I[i + 2] * 3, cr = (P[b + 2] - P[a + 2]) * (P[c] - P[a]) - (P[b] - P[a]) * (P[c + 2] - P[a + 2]); if (cr < 0) { const t = I[i + 1]; I[i + 1] = I[i + 2]; I[i + 2] = t; } } }
  // a grid over the box; keeps the triangles whose middle passes `inside`; every vertex sits on the drawn ground + lift
  grid(x0, z0, x1, z1, step, inside, colAt, lift) {
    const nx = Math.max(1, Math.ceil((x1 - x0) / step)), nz = Math.max(1, Math.ceil((z1 - z0) / step)), base = this.pos.length / 3, c = new THREE.Color();
    if ((nx + 1) * (nz + 1) > 90000) return;
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const x = x0 + i * step, z = z0 + j * step; this.pos.push(x, groundY(x, z) + lift, z); c.set(colAt(x, z)); this.col.push(c.r, c.g, c.b); }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = base + j * (nx + 1) + i, b = a + 1, d = a + nx + 1, e = d + 1, cx = x0 + (i + 0.5) * step, cz = z0 + (j + 0.5) * step;
      if (inside(cx - step * 0.17, cz - step * 0.17)) this.idx.push(a, d, b);
      if (inside(cx + step * 0.17, cz + step * 0.17)) this.idx.push(b, d, e);
    }
  }
  // smooth-edged patch: rings from the middle out to the outline (edges split every ~1.2 m); `band` adds a collar outside
  radial(p, colAt, lift, band = 0, rings = 5) {
    const [cx, cz] = cen(p), B = [];
    for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length, n = Math.max(1, Math.ceil(Math.hypot(p[j] - p[i], p[j + 1] - p[i + 1]) / 1.2)); for (let k = 0; k < n; k++) B.push([p[i] + (p[j] - p[i]) * k / n, p[i + 1] + (p[j + 1] - p[i + 1]) * k / n]); }
    const i0 = this.idx.length, N = B.length, c = new THREE.Color(), base = this.pos.length / 3, put = (x, z) => { this.pos.push(x, groundY(x, z) + lift, z); c.set(colAt(x, z)); this.col.push(c.r, c.g, c.b); };
    const fr = band ? [0, 1] : Array.from({ length: rings + 1 }, (_, r) => r / rings);
    for (const f of fr) for (const [bx, bz] of B) { if (band) { const dx = bx - cx, dz = bz - cz, d = Math.hypot(dx, dz) || 1; put(bx + dx / d * band * f, bz + dz / d * band * f); } else put(cx + (bx - cx) * f, cz + (bz - cz) * f); }
    for (let r = 0; r < fr.length - 1; r++) for (let i = 0; i < N; i++) { const a = base + r * N + i, b = base + r * N + (i + 1) % N, d = a + N, e = b + N; if (!band && r === 0) { this.idx.push(a, e, d); continue; } this.idx.push(a, b, d, b, e, d); }
    this.up(i0);
  }
  // a mowed strip along a polyline, rounded at both ends
  ribbon(path, len, w, colAt, lift, u0, u1, seed) {
    const i0 = this.idx.length, c = new THREE.Color(), base = this.pos.length / 3, across = 7; let rows = 0;
    for (let u = u0; u <= u1; u += 0.75) {
      let acc = 0, x = path[0], z = path[1], dx = 1, dz = 0;
      for (let i = 0; i + 3 < path.length; i += 2) { const L = Math.hypot(path[i + 2] - path[i], path[i + 3] - path[i + 1]); if (acc + L >= u || i + 4 >= path.length) { const t = clamp((u - acc) / (L || 1), 0, 1); x = path[i] + (path[i + 2] - path[i]) * t; z = path[i + 1] + (path[i + 3] - path[i + 1]) * t; dx = (path[i + 2] - path[i]) / (L || 1); dz = (path[i + 3] - path[i + 1]) / (L || 1); break; } acc += L; }
      const end = Math.min(1, (u - u0) / 7, (u1 - u) / 7), hw = w / 2 * (0.82 + vnoise(u * 0.06, seed) * 0.36) * Math.sqrt(Math.max(0.02, end));
      for (let k = 0; k < across; k++) { const s = (k / (across - 1) - 0.5) * 2 * hw, px = x - dz * s, pz = z + dx * s; this.pos.push(px, groundY(px, pz) + lift, pz); c.set(colAt(px, pz, u)); this.col.push(c.r, c.g, c.b); }
      rows++;
    }
    for (let r = 0; r < rows - 1; r++) for (let k = 0; k < across - 1; k++) { const a = base + r * across + k, b = a + 1, d = a + across, e = d + 1; this.idx.push(a, d, b, b, d, e); }
    this.up(i0);
  }
  poly(p, step, colAt, lift, pad = 0, test) { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); } this.grid(x0 - pad, z0 - pad, x1 + pad, z1 + pad, step, test || ((x, z) => inPoly(x, z, p)), colAt, lift); }
  mesh(m) { if (!this.idx.length) return null; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3)); g.setIndex(this.idx); g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(this.pos.length).map((_, i) => i % 3 === 1 ? 1 : 0), 3)); const me = new THREE.Mesh(g, m); me.receiveShadow = true; scene.add(me); return me; }   // flat-up normals: no faceted shading on the turf
}
function kit() {   // merged vertex-coloured props
  const pos = [], nor = [], col = [], c = new THREE.Color();
  return {
    add(geo, color, x, y, z, ry = 0, rx = 0, rz = 0) { const g = geo.index ? geo.toNonIndexed() : geo.clone(); g.rotateZ(rz); g.rotateX(rx); g.rotateY(ry); g.translate(x, y, z); c.set(color); pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b); },
    build() { if (!pos.length) return null; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65 })); m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; },
  };
}
const BOX = new THREE.BoxGeometry(1, 1, 1), CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 8), SPH = new THREE.SphereGeometry(0.5, 10, 8);
const shade = (hex, k) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return '#' + c.getHexString(); };
const FW_A = '#3a6c26', FW_B = '#457b2e', GR_A = '#4a8a32', GR_B = '#539538', FRINGE = '#335f24', TEE_A = '#407629', TEE_B = '#4a822f';
function clearTrees(C) {
  const block = (x, z) => C.holes18.some(h => { const [d, u] = segDist(h.path, x, z); return (d < fwW(h) / 2 + 1.5 && u > 1 && u < h.len - 1) || edgeDist(h.green, x, z) < 3 || inPoly(x, z, h.green) || Math.hypot(x - h.tee[0], z - h.tee[1]) < 5; });
  const Z0 = new THREE.Matrix4().makeScale(0, 0, 0), [cx, cz] = cen(C.poly);
  for (const grp of treeChunks) { if (Math.abs(grp.userData.cx - cx) > 900 || Math.abs(grp.userData.cz - cz) > 900) continue;
    for (const m of grp.children) { if (!m.userData.items) continue; for (const t of m.userData.items) if (inPoly(t.x, t.z, C.poly) && block(t.x, t.z)) for (const [mm, i] of t.refs || []) { mm.userData.ring?.setBroken(mm, i, true); mm.setMatrixAt(i, Z0); mm.instanceMatrix.needsUpdate = true; } } }
  const tg = _colliderGrids.get('trees'); if (tg) for (const [k, a] of tg) { const f = a.filter(c => !(inPoly(c.x, c.z, C.poly) && block(c.x, c.z))); if (f.length !== a.length) tg.set(k, f); }
}
function buildCourse(C) {
  C.meshes = [];
  const fw = new Drape(), gr = new Drape(), fr = new Drape(), te = new Drape(), sa = new Drape(), wa = new Drape();
  for (const h of C.holes18) {
    const w = fwW(h), dx = h.pin[0] - h.tee[0], dz = h.pin[1] - h.tee[1], d = Math.hypot(dx, dz), ux = dx / d, uz = dz / d;
    // mowed approach: light/dark stripes across the line of play
    fw.ribbon(h.path, h.len, w, (x, z, u) => (Math.floor(u / 4.5) & 1) ? FW_A : FW_B, 0.05, 4, h.len - 2, h.n);
    // green (two-way checkerboard mowing) + darker fringe collar
    gr.radial(h.green, (x, z) => (Math.floor(x / 2.6) + Math.floor(z / 2.6)) & 1 ? GR_A : GR_B, 0.1);
    fr.radial(h.green, () => FRINGE, 0.08, 1.5);
    te.radial(h.teeP, (x, z) => (Math.floor(((x - h.tee[0]) * ux + (z - h.tee[1]) * uz) / 1.5) & 1) ? TEE_A : TEE_B, 0.09, 0, 2);
  }
  for (const f of C.fairway) fw.radial(f, (x, z) => (Math.floor((x + z) / 4.5) & 1) ? FW_A : FW_B, 0.05);
  for (const b of C.bunker) { sa.radial(b, (x, z) => shade('#d9c697', 0.94 + vnoise(x * 0.9, z * 0.9) * 0.12), 0.07, 0, 3); fr.radial(b, () => '#3f6a2a', 0.075, 0.6); }
  for (const p of C.water) wa.radial(p, (x, z) => shade('#2c5c69', 0.9 + vnoise(x * 0.3, z * 0.3) * 0.2), 0.12, 0, 3);
  // park trees standing on the lines of play, greens or tees: hidden (real courses keep them between the holes)
  if (!C.cleared) { C.cleared = true; clearTrees(C); }
  for (const [D, n, k] of [[fw, 'fairway', 0.00018], [fr, 'fringe', 0.00024], [gr, 'green', 0.0003], [te, 'tee', 0.00028], [sa, 'sand', 0.0003], [wa, 'water', 0.00032]]) { const m = D.mesh(mat(n, k)); if (m) C.meshes.push(m); }
  // props: flags, cups, tee markers, benches, ball washers, bins, the clubhouse booth
  const K = kit(), mk = ['#e53e3e', '#f4f4f4', '#3182ce', '#f6e05e'];
  for (const h of C.holes18) {
    const [px, pz] = h.pin, py = groundY(px, pz) + 0.1;
    const tx = h.tee[0], tz = h.tee[1], ty = groundY(tx, tz) + 0.09, vx = Math.cos(h.yaw), vz = -Math.sin(h.yaw), c = mk[h.n % 4];
    for (const s of [-1, 1]) K.add(SPH.clone().scale(0.18, 0.18, 0.18), c, tx + vx * 2.2 * s, ty + 0.09, tz + vz * 2.2 * s);
    // the hole sign: post + board (the number board texture is a separate atlas mesh)
    const sx = tx + vx * 3.6 + Math.sin(h.yaw) * 2, sz = tz + vz * 3.6 + Math.cos(h.yaw) * 2, sy = groundY(sx, sz);
    K.add(BOX.clone().scale(0.1, 1.1, 0.1), '#6b4a2b', sx, sy + 0.55, sz, h.yaw);
    h.sign = [sx, sy + 1.25, sz];
    if (h.n % 3 === 1) {   // ball washer + bin
      const wx = tx - vx * 3.4, wz = tz - vz * 3.4, wy = groundY(wx, wz);
      K.add(CYL.clone().scale(0.07, 0.95, 0.07), '#2d3748', wx, wy + 0.47, wz); K.add(BOX.clone().scale(0.22, 0.26, 0.16), '#2b6cb0', wx, wy + 1.05, wz, h.yaw); K.add(CYL.clone().scale(0.05, 0.25, 0.05), '#cbd5e0', wx, wy + 1.27, wz);
      K.add(CYL.clone().scale(0.42, 0.85, 0.42), '#2f855a', wx - Math.sin(h.yaw) * 1.1, groundY(wx, wz) + 0.42, wz - Math.cos(h.yaw) * 1.1);
    }
    if (h.n % 4 === 2) {   // a bench behind the tee
      const bx = tx + Math.sin(h.yaw) * 4.5, bz = tz + Math.cos(h.yaw) * 4.5, by = groundY(bx, bz);
      if (!onRoadAt(bx, bz)) { K.add(BOX.clone().scale(1.7, 0.06, 0.45), '#8b5a2b', bx, by + 0.45, bz, h.yaw); K.add(BOX.clone().scale(1.7, 0.4, 0.06), '#8b5a2b', bx + Math.sin(h.yaw) * 0.22, by + 0.75, bz + Math.cos(h.yaw) * 0.22, h.yaw); for (const s of [-0.75, 0.75]) K.add(BOX.clone().scale(0.08, 0.45, 0.45), '#3a3a3a', bx + vx * s, by + 0.22, bz + vz * s, h.yaw); }
    }
  }
  // clubhouse booth (a little green-roofed hut with a club rack) unless OSM maps a real clubhouse building there
  { const [bx, bz] = C.booth, by = groundY(bx, bz), y0 = C.holes18[0].yaw + Math.PI;
    if (!buildingAt(bx, bz)) {
      K.add(BOX.clone().scale(3.2, 2.5, 2.6), '#f1ead6', bx, by + 1.25, bz, y0); K.add(BOX.clone().scale(3.8, 0.25, 3.2), '#2f6b3a', bx, by + 2.65, bz, y0);
      K.add(BOX.clone().scale(1.8, 0.9, 0.05), '#1a202c', bx - Math.sin(y0) * 1.31, by + 1.5, bz - Math.cos(y0) * 1.31, y0);
    }
    const rx = bx + Math.cos(y0) * 2.4, rz = bz - Math.sin(y0) * 2.4, ry = groundY(rx, rz);
    K.add(BOX.clone().scale(1.2, 0.9, 0.4), '#5b3a1e', rx, ry + 0.45, rz, y0);
    for (let i = 0; i < 6; i++) K.add(CYL.clone().scale(0.02, 1.0, 0.02), '#c0c4c8', rx + Math.cos(y0) * (i - 2.5) * 0.18, ry + 1.2, rz - Math.sin(y0) * (i - 2.5) * 0.18, y0, 0, 0.15);
    C.boothSign = [bx - Math.sin(y0) * 1.33, by + 2.25, bz - Math.cos(y0) * 1.33, y0];
  }
  const km = K.build(); if (km) C.meshes.push(km);
  // flag poles + flags: one instanced pole, flags as one mesh (waved in updateGolf)
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 2.1, 5).translate(0, 1.05, 0), std('#f4f4f4'), C.holes18.length);
  const flagG = new THREE.PlaneGeometry(0.5, 0.33, 4, 1).translate(0.25, 1.92, 0), flags = new THREE.InstancedMesh(flagG, new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide }), C.holes18.length);
  const cups = new THREE.InstancedMesh(new THREE.CircleGeometry(0.11, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#0d0d0d' }), C.holes18.length);
  depthBias(cups.material, 0.0006);
  const o = new THREE.Object3D(), fc = new THREE.Color();
  C.holes18.forEach((h, i) => { o.position.set(h.pin[0], groundY(h.pin[0], h.pin[1]) + 0.1, h.pin[1]); o.rotation.set(0, 0, 0); o.updateMatrix(); poles.setMatrixAt(i, o.matrix); cups.setMatrixAt(i, o.matrix); flags.setMatrixAt(i, o.matrix); flags.setColorAt(i, fc.set(h.n <= 9 ? '#e53e3e' : '#f6c90e')); });
  for (const m of [poles, flags, cups]) { m.castShadow = m !== cups; scene.add(m); C.meshes.push(m); }
  C.flags = flags; C.poles = poles; C.cups = cups;
  // hole signs + the booth sign: one canvas atlas
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 1024; const x = cv.getContext('2d');
  const cell = (i) => [(i % 4) * 256, Math.floor(i / 4) * 128];
  C.holes18.forEach((h, i) => { const [u, v] = cell(i); x.fillStyle = '#2f5d3a'; x.fillRect(u + 4, v + 4, 248, 120); x.strokeStyle = '#e8dcb5'; x.lineWidth = 5; x.strokeRect(u + 10, v + 10, 236, 108); x.fillStyle = '#f3ead0'; x.font = 'bold 54px Georgia, serif'; x.textAlign = 'left'; x.textBaseline = 'middle'; x.fillText(String(h.n), u + 24, v + 64); x.font = 'bold 26px Arial, sans-serif'; x.fillText('PAR ' + h.par, u + 120, v + 46); x.fillText(Math.round(h.len) + ' m', u + 120, v + 84); });
  { const [u, v] = cell(18); x.fillStyle = '#f3ead0'; x.fillRect(u, v, 512, 128); x.fillStyle = '#2f5d3a'; x.font = 'bold 30px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('PITCH & PUTT', u + 256, v + 40); x.font = '22px Arial, sans-serif'; x.fillText(`${C.holes18.length} holes · par ${C.par} · green fee $${FEE[C.id]}`, u + 256, v + 88); }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const P = [], U = [], I = [];
  const quad = (cx, cy, cz, yaw, w, hgt, u0, v0, u1, v1) => { const b = P.length / 3, vx = Math.cos(yaw) * w / 2, vz = -Math.sin(yaw) * w / 2, nx = -Math.sin(yaw) * 0.06, nz = -Math.cos(yaw) * 0.06; for (const s of [1, -1]) { const ox = nx * s, oz = nz * s, bb = P.length / 3; P.push(cx - vx * s + ox, cy - hgt / 2, cz - vz * s + oz, cx + vx * s + ox, cy - hgt / 2, cz + vz * s + oz, cx + vx * s + ox, cy + hgt / 2, cz + vz * s + oz, cx - vx * s + ox, cy + hgt / 2, cz - vz * s + oz); U.push(u0, 1 - v1, u1, 1 - v1, u1, 1 - v0, u0, 1 - v0); I.push(bb, bb + 1, bb + 2, bb, bb + 2, bb + 3); } return b; };
  C.holes18.forEach((h, i) => { const [u, v] = cell(i); quad(h.sign[0], h.sign[1], h.sign[2], h.yaw + Math.PI, 0.8, 0.4, u / 1024, v / 1024, (u + 256) / 1024, (v + 128) / 1024); });
  { const [u, v] = cell(18), b = C.boothSign; quad(b[0], b[1], b[2], b[3] + Math.PI, 2.6, 0.65, u / 1024, v / 1024, (u + 512) / 1024, (v + 128) / 1024); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); sg.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); sg.setIndex(I); sg.computeVertexNormals();
  const sm = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 })); scene.add(sm); C.meshes.push(sm);
  // a resident Canada goose that wanders the course (it likes greens)
  C.goose = makeGoose(); scene.add(C.goose); C.meshes.push(C.goose); C.gooseT = { h: C.holes18[Math.floor(Math.random() * C.holes18.length)], t: 0, x: 0, z: 0 };
  { const g = C.gooseT, c = cen(g.h.green); g.x = c[0] + 4; g.z = c[1] + 2; }
}
function dropCourse(C) { for (const m of C.meshes || []) { scene.remove(m); m.geometry?.dispose?.(); m.traverse?.(o => o.geometry?.dispose?.()); } C.meshes = null; C.flags = null; C.goose = null; }
function makeGoose() {
  const K = kit();
  K.add(SPH.clone().scale(0.38, 0.3, 0.62), '#6b5b4b', 0, 0.42, 0); K.add(SPH.clone().scale(0.3, 0.2, 0.36), '#efe9dd', 0, 0.36, 0.1);
  K.add(CYL.clone().scale(0.07, 0.48, 0.07), '#111111', 0, 0.72, -0.32, 0, -0.35); K.add(SPH.clone().scale(0.13, 0.12, 0.2), '#111111', 0, 0.97, -0.42); K.add(SPH.clone().scale(0.09, 0.07, 0.05), '#f4f4f4', 0, 0.96, -0.38);
  K.add(BOX.clone().scale(0.05, 0.04, 0.1), '#1a1a1a', 0, 0.95, -0.56); for (const s of [-0.1, 0.1]) K.add(CYL.clone().scale(0.03, 0.3, 0.03), '#2d2d2d', s, 0.15, 0);
  const m = K.build(); scene.remove(m); const g = new THREE.Group(); g.add(m); return g;
}
function makeCrow() { const K = kit(); K.add(SPH.clone().scale(0.16, 0.14, 0.3), '#111216', 0, 0, 0); K.add(SPH.clone().scale(0.1, 0.1, 0.12), '#111216', 0, 0.06, -0.2); K.add(BOX.clone().scale(0.03, 0.03, 0.09), '#222222', 0, 0.05, -0.32); K.add(BOX.clone().scale(0.9, 0.02, 0.22), '#15161a', 0, 0.03, 0.02); const m = K.build(); scene.remove(m); const g = new THREE.Group(); g.add(m); scene.add(g); return g; }

// ---------- clubs, wind, flight ----------
const CLUBS = [
  { id: '9i', name: '9-iron', carry: 105, loft: 0.72, roll: 0.42 },
  { id: 'pw', name: 'Pitching wedge', carry: 85, loft: 0.82, roll: 0.3 },
  { id: 'sw', name: 'Sand wedge', carry: 62, loft: 0.98, roll: 0.16 },
  { id: 'lw', name: 'Lob wedge', carry: 42, loft: 1.12, roll: 0.08 },
  { id: 'pt', name: 'Putter', putt: true },
];
const LIE_CARRY = { tee: 1, fairway: 1, fringe: 0.95, green: 0.9, rough: 0.82, sand: 0.62 };
// fly a ball: returns the arc points and where/how fast it lands (no randomness: the aim preview uses it too)
function flight(x, z, yaw, club, p, wind, lie) {
  const carry = club.carry * p * (LIE_CARRY[lie] ?? 1) * (lie === 'sand' && club.id === 'sw' ? 1.25 : 1);
  const v0 = Math.sqrt(9.8 * Math.max(1, carry) / Math.sin(2 * club.loft)), fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  let vx = fx * v0 * Math.cos(club.loft), vz = fz * v0 * Math.cos(club.loft), vy = v0 * Math.sin(club.loft), y = groundY(x, z) + 0.05;
  const pts = [[x, y, z]], dt = 1 / 30;
  for (let i = 0; i < 400; i++) {
    vx += (wind[0] * 0.16 - vx * 0.012) * dt; vz += (wind[1] * 0.16 - vz * 0.012) * dt; vy -= 9.8 * dt;
    x += vx * dt; z += vz * dt; y += vy * dt; pts.push([x, y, z]);
    const gy = groundY(x, z); if (vy < 0 && y <= gy + 0.03) { pts[pts.length - 1][1] = gy + 0.03; break; }
  }
  return { pts, x, z, vx, vz, vy, carry };
}
function windNow() { const sp = clamp(R(0, 3.5) + (G.wet || 0) * 4 + (G.weather?.type === 'storm' ? 4 : 0), 0, 9), a = -Math.PI / 2 + R(-1.1, 1.1); return [Math.cos(a) * sp, Math.sin(a) * sp]; }   // mostly a westerly (blowing toward +x)

// ---------- the game ----------
const SHOOT_T = 1.05;
function scoreName(d, s) { return s === 1 ? '🎯 HOLE IN ONE!!' : d <= -2 ? '🦅 Eagle!' : d === -1 ? '🐦 Birdie!' : d === 0 ? '⛳ Par' : d === 1 ? 'Bogey' : d === 2 ? 'Double bogey' : 'Triple+'; }
function scoreCol(d) { return d <= -1 ? '#fc8181' : d === 0 ? '#ffffff' : d === 1 ? '#90cdf4' : '#a0aec0'; }
function windTxt(g) { const sp = Math.hypot(g.wind[0], g.wind[1]); if (sp < 0.6) return '🍃 calm'; const rel = wrapAngle(Math.atan2(-g.wind[0], -g.wind[1]) - g.yaw), ar = ['↑', '↖', '←', '↙', '↓', '↘', '→', '↗'][((Math.round(rel / (Math.PI / 4)) % 8) + 8) % 8]; const help = Math.cos(rel) > 0.5 ? 'helping' : Math.cos(rel) < -0.5 ? 'into you' : 'across'; return `💨 ${ar} ${sp.toFixed(1)} m/s ${help}`; }

const COURSE_GAME = {
  title: '⛳ Pitch & Putt', freeze: true, leave: 45,
  how: [],
  setup(g) {
    const C = g.C; g.title = `⛳ ${C.name}`;
    this.how = [`<i>${C.info}</i>`,
      `${H.K('A')} / ${H.K('D')} aim (${H.K('Shift')} = fine) · ${H.K('W')} / ${H.K('S')} change club · hold ${H.K('Space')} and let go: the bar fills, then turns <b style="color:#fc8181">red</b> = over-swing (longer but wild).`,
      'The yellow ring shows where the ball LANDS (then it rolls: wedges stop quicker). Watch the wind 💨. On the green the dotted line shows the start of your putt: read the slope!',
      `${H.K('Space')} = play ${C.holes18.length > 9 ? 'the front 9' : 'all ' + C.holes18.length + ' holes'}${C.holes18.length > 9 ? ` · ${H.K('Enter')} = all ${C.holes18.length} holes` : ''}`];
    COURSE_GAME.title = g.title;
    g.ballM = H.addExtra(H.ballMesh('golf')); H.gearOnPlayer(); H.club().visible = true;
    g.list = C.holes18.slice(0, Math.min(9, C.holes18.length)); g.i = 0; g.cards = []; g.wind = windNow(); g.ci = 1;
    this.tee(g);
  },
  start(g) { if (key('Enter') || key('NumpadEnter')) { g.list = g.C.holes18.slice(); this.tee(g); } g.started = true; },
  tee(g) {
    const h = g.list[g.i]; g.h = h; g.b = { x: h.tee[0], z: h.tee[1], vx: 0, vz: 0 }; g.strokes = 0; g.state = 'aim'; g.charge = 0; g.hold = 0; g.fy = 0; g.lie = 'tee'; g.ev = null;
    g.yaw = Math.atan2(-(h.pin[0] - h.tee[0]), -(h.pin[1] - h.tee[1])); g.ci = this.suggest(g); this.stand(g);
    if (g.i > 0 && Math.random() < 0.5) g.wind = windNow();
    if (g.started) ui.toast(`Hole ${h.n} · Par ${h.par} · ${Math.round(h.len)} m`, this.describe(h), 2600);
  },
  describe(h) { const t = []; if (h.dy < -3) t.push(`downhill ${Math.round(-h.dy)} m (plays shorter)`); else if (h.dy > 3) t.push(`uphill ${Math.round(h.dy)} m (take more club)`); if (h.water) t.push('water in play 💧'); if (h.sand) t.push('bunkers by the green'); if (h.path.length > 4) t.push('a dogleg'); return t.length ? t.join(', ') : pick(['A gentle one.', 'Straight at the flag.', 'Nice view from this tee.']); },
  dist(g) { return Math.hypot(g.h.pin[0] - g.b.x, g.h.pin[1] - g.b.z); },
  plays(g) { return this.dist(g) - (groundY(g.h.pin[0], g.h.pin[1]) - groundY(g.b.x, g.b.z)) * -1.0; },
  suggest(g) { const lie = lieAt(g.C, g.b.x, g.b.z), d = this.dist(g); if ((lie === 'green' && (inPoly(g.b.x, g.b.z, g.h.green) || d < 14)) || (lie === 'fringe' && d < 12)) return 4; const p = this.plays(g); for (let i = 3; i >= 0; i--) if (CLUBS[i].carry * (1 + CLUBS[i].roll * 0.35) * 0.95 >= p) return i; return 0; },
  stand(g) { const px = g.b.x + Math.cos(g.yaw) * 0.55, pz = g.b.z - Math.sin(g.yaw) * 0.55; pl.teleport(px, pz); pl.yaw = g.yaw; },
  aim(g, dt) { H.aimCam(g.yaw, dt, CLUBS[g.ci].putt ? 0.36 : 0.24); },
  step(g, dt) {
    const C = g.C, h = g.h, club = CLUBS[g.ci];
    if (C.flags) waveFlags(C);
    g.ballM.position.set(g.b.x, groundY(g.b.x, g.b.z) + 0.045 + (g.fy || 0), g.b.z);
    if (g.ev) return this.event(g, dt);
    if (g.state === 'aim') {
      const fine = key('ShiftLeft') || key('ShiftRight'); if (key('KeyA')) g.yaw += dt * (fine ? 0.1 : 0.55); if (key('KeyD')) g.yaw -= dt * (fine ? 0.1 : 0.55);
      if (tapped('KeyW')) g.ci = (g.ci + CLUBS.length - 1) % CLUBS.length; if (tapped('KeyS')) g.ci = (g.ci + 1) % CLUBS.length;
      pl.yaw = g.yaw; this.stand(g); this.aim(g, dt);
      if (key('Space')) { g.hold += dt; g.charge = Math.min(1.2, g.hold / (club.putt ? 1.35 : SHOOT_T)); }
      const p = key('Space') ? Math.min(1, g.charge) : (g.last?.[g.ci] ?? this.ideal(g));
      g.lie = lieAt(C, g.b.x, g.b.z);
      if (club.putt) { const pts = this.rollSim(g, g.b.x, g.b.z, g.yaw, this.puttV(p), 300); H.showAim(pts.slice(0, Math.max(4, Math.floor(pts.length * 0.55)))); H.ringOff(); }
      else { const f = flight(g.b.x, g.b.z, g.yaw, club, p, g.wind, g.lie); H.showAim(f.pts.map(q => [q[0], q[2]])); const r = H.ring(); r.position.set(f.x, groundY(f.x, f.z) + 0.07, f.z); r.scale.setScalar(1.6); r.material.color.set('#ffd45c'); }
      if (!key('Space') && g.hold > 0) this.hit(g, club);
    } else if (g.state === 'fly') {
      const f = g.fly; f.t += dt * 1.15; const i = Math.min(f.pts.length - 1, Math.floor(f.t * 30)), q = f.pts[i];
      g.b.x = q[0]; g.b.z = q[2]; g.fy = Math.max(0, q[1] - groundY(q[0], q[2]) - 0.045);
      if (f.crow && f.t > 0.4) return this.crowGrab(g);
      if (i >= f.pts.length - 1) {
        g.fy = 0; const lie = lieAt(C, g.b.x, g.b.z), dc = this.dist(g);
        if (dc < 0.16 && lie === 'green') { g.b.x = h.pin[0]; g.b.z = h.pin[1]; ui.toast('💥 SLAM DUNK!', 'Straight into the cup on the fly!', 1500); return this.holed(g); }
        if (lie === 'water') return this.penalty(g, '💦 Splash!', 'In the water. +1 stroke, play again from where you hit it.');
        if (lie === 'ob') return this.penalty(g, '🚫 Out of bounds', '+1 stroke. Back to where you hit it.');
        const k = LAND[lie] * f.club.roll * (lie === 'green' && f.club.loft > 0.95 ? 0.5 : 1) * 1.6;   // lob shots check up on the green (backspin)
        g.b.vx = f.vx * k; g.b.vz = f.vz * k; g.bounce = Math.min(0.6, Math.abs(f.vy) * 0.04 * LAND[lie]); g.bt = 0; g.state = 'roll';
        if (lie === 'sand') ui.toast('🏖️ In the bunker', 'Take the sand wedge and give it a good thump.', 1400);
      }
    } else if (g.state === 'roll') {
      g.bt += dt; g.fy = g.bounce * Math.max(0, Math.sin(g.bt * 7)) * Math.exp(-g.bt * 5);
      const moving = this.rollStep(g, g.b, dt), sp = Math.hypot(g.b.vx, g.b.vz), dc = this.dist(g);
      if (C.goose?.visible && Math.hypot(g.b.x - C.gooseT.x, g.b.z - C.gooseT.z) < 0.45 && sp > 0.3) { const a = R(-1.4, 1.4), c = Math.cos(a), s = Math.sin(a); [g.b.vx, g.b.vz] = [(g.b.vx * c - g.b.vz * s) * 0.5, (g.b.vx * s + g.b.vz * c) * 0.5]; C.gooseT.flee = 2; H.discover('golfgoose'); ui.toast('🪿 HONK!', 'Your ball bounced off the goose. It is furious.', 1500); sfx.horn?.(); }
      if (dc < 0.11 && sp < 1.7) { g.b.x = h.pin[0]; g.b.z = h.pin[1]; g.b.vx = g.b.vz = 0; return this.holed(g); }
      if (dc < 0.11 && !g.lipped) { g.lipped = true; const a = R(-0.6, 0.6), c = Math.cos(a), s = Math.sin(a); [g.b.vx, g.b.vz] = [(g.b.vx * c - g.b.vz * s) * 0.55, (g.b.vx * s + g.b.vz * c) * 0.55]; ui.toast('😱 Lipped out!', 'Too fast: it spun round the cup.', 1000); }
      if (dc > 0.4) g.lipped = false;
      const lie = lieAt(C, g.b.x, g.b.z);
      if (lie === 'water') return this.penalty(g, '💦 Rolled into the water', '+1 stroke, play again from where you hit it.');
      if (lie === 'ob') return this.penalty(g, '🚫 Rolled out of bounds', '+1 stroke. Back to where you hit it.');
      if (!moving) { g.state = 'rest'; g.wait = 0.7; }
    } else if (g.state === 'rest-hole') {
      g.wait -= dt; if (g.wait <= 0) this.tee(g);
    } else if (g.state === 'rest') {
      g.wait -= dt; if (g.wait > 0) return;
      if (this.dist(g) < 0.5 && lieAt(C, g.b.x, g.b.z) === 'green') { g.strokes++; g.b.x = h.pin[0]; g.b.z = h.pin[1]; ui.toast('👌 Gimme!', 'Tapped in from close range (+1 stroke).', 1100); return this.holed(g); }
      if (g.strokes >= 6) { ui.toast('🫳 Picked up', 'Max 6 strokes a hole (pitch & putt house rule).', 1400); g.strokes = 6; return this.holed(g, true); }
      // surprises while you walk up to your ball
      const lie = lieAt(C, g.b.x, g.b.z);
      if (!g.crowDone && (lie === 'rough' || lie === 'fairway') && this.dist(g) > 12 && Math.random() < (C.id === 'stanley' ? 0.12 : 0.05)) { g.crowDone = true; return this.startCrow(g); }
      if (!g.goldDone && lie === 'rough' && Math.random() < 0.04) { g.goldDone = true; pl.money += 25; sfx.coin?.(); ui.toast('✨ A golden golf ball!', 'Lost in the rough by somebody fancy. Finders keepers (+$25).', 2200); }
      g.state = 'aim'; g.hold = 0; g.charge = 0; g.yaw = Math.atan2(-(h.pin[0] - g.b.x), -(h.pin[1] - g.b.z)); g.ci = this.suggest(g); this.stand(g);
    }
  },
  ideal(g) { const club = CLUBS[g.ci]; if (club.putt) { const d = this.dist(g); return clamp(Math.sqrt(2 * FRIC.green * d * 1.05) / this.puttV(1), 0, 1); } return clamp(this.plays(g) * (1 - club.roll * 0.45) / (club.carry * (LIE_CARRY[g.lie] ?? 1)), 0, 1); },
  puttV(p) { return Math.sqrt(2 * FRIC.green * 26) * p; },
  rollStep(g, b, dt) {
    const sp = Math.hypot(b.vx, b.vz); if (sp < 0.03) { b.vx = b.vz = 0; return false; }
    const lie = lieAt(g.C, b.x, b.z), [ax, az] = slopeAcc(g.C, g.h, b.x, b.z, lie);
    b.vx += ax * dt; b.vz += az * dt;
    const s2 = Math.hypot(b.vx, b.vz), k = Math.max(0, s2 - (FRIC[lie] ?? 3) * dt) / (s2 || 1); b.vx *= k; b.vz *= k;
    if (lie === 'green' && Math.hypot(b.vx, b.vz) < 0.12 && Math.hypot(ax, az) < 0.25) { b.vx = b.vz = 0; return false; }
    b.x += b.vx * dt; b.z += b.vz * dt; return true;
  },
  rollSim(g, x, z, yaw, v0, n) { const b = { x, z, vx: -Math.sin(yaw) * v0, vz: -Math.cos(yaw) * v0 }, pts = [[x, z]]; for (let i = 0; i < n && this.rollStep(g, b, 1 / 30); i++) { if (i % 2 === 0) pts.push([b.x, b.z]); if (Math.hypot(b.x - g.h.pin[0], b.z - g.h.pin[1]) < 0.11 && Math.hypot(b.vx, b.vz) < 1.7) break; } pts.push([b.x, b.z]); return pts; },
  hit(g, club) {
    const p = g.charge, over = Math.max(0, p - 1); g.hold = 0; g.charge = 0; g.strokes++; g.prev = { x: g.b.x, z: g.b.z }; (g.last = g.last || {})[g.ci] = Math.min(1, p);
    pl.attackT = 0.45; pl.model.st.kind = 'swing'; H.showAim(null); H.ringOff();
    const lie = g.lie, err = (club.putt ? 0.006 : 0.02) + over * 0.5 + (lie === 'rough' ? 0.03 : lie === 'sand' && club.id !== 'sw' ? 0.06 : 0);
    const yaw = g.yaw + R(-1, 1) * err;
    if (club.putt) { sfx.bump?.(); const v = this.puttV(Math.min(1, p)) * R(0.985, 1.015) * (lie === 'fringe' ? 0.92 : lie === 'rough' ? 0.6 : 1); g.b.vx = -Math.sin(yaw) * v; g.b.vz = -Math.cos(yaw) * v; g.state = 'roll'; g.bounce = 0; g.bt = 0; return; }
    sfx.thwack?.(); if (over > 0.05) ui.toast('💪 Over-swing!', 'Extra distance… somewhere.', 700);
    const pw = Math.min(1, p) + over * 0.6, f = flight(g.b.x, g.b.z, yaw, club, pw * R(0.97, 1.03), g.wind, lie);
    g.fly = { pts: f.pts, t: 0, vx: f.vx, vz: f.vz, vy: f.vy, club, crow: false }; g.state = 'fly';
    if (lie === 'sand' && Math.random() < (club.id === 'sw' ? 0.1 : 0.45)) { g.fly.pts = g.fly.pts.slice(0, 6); g.fly.vx *= 0.05; g.fly.vz *= 0.05; ui.toast('🏖️ Thud', 'It barely got out of the sand.', 1000); }
  },
  penalty(g, a, b) { g.strokes++; g.b.x = g.prev.x; g.b.z = g.prev.z; g.b.vx = g.b.vz = 0; g.fy = 0; ui.toast(a, b, 1800); sfx.splash?.(); g.state = 'rest'; g.wait = 0.4; },
  // 🐦‍⬛ a crow lands, grabs your ball and drops it somewhere else
  startCrow(g) { g.ev = { kind: 'crow', t: 0, crow: g.crowM || (g.crowM = makeCrow()) }; const a = R(0, 6.28); g.ev.from = [g.b.x + Math.cos(a) * 30, g.b.z + Math.sin(a) * 30]; const b = R(0, 6.28), d = R(8, 22); let tx = g.b.x + Math.cos(b) * d, tz = g.b.z + Math.sin(b) * d; if (lieAt(g.C, tx, tz) === 'ob' || lieAt(g.C, tx, tz) === 'water') { tx = g.b.x; tz = g.b.z; } g.ev.to = [tx, tz]; g.ev.crow.visible = true; },
  crowGrab(g) { this.startCrow(g); },
  event(g, dt) {
    const e = g.ev; e.t += dt; const c = e.crow, by = groundY(g.b.x, g.b.z);
    if (e.t < 1.6) { const t = e.t / 1.6; c.position.set(e.from[0] + (g.b.x - e.from[0]) * t, by + 0.2 + (1 - t) * 8, e.from[1] + (g.b.z - e.from[1]) * t); c.rotation.y = Math.atan2(-(g.b.x - e.from[0]), -(g.b.z - e.from[1])); }
    else if (e.t < 2.2) { c.position.y = by + 0.2; if (!e.said) { e.said = true; H.discover('golfcrow'); ui.toast('🐦‍⬛ CAW!', pick(['A crow grabbed your ball! (Local rule: play it where it drops.)', 'A Stanley Park crow has claimed your ball.', 'The crow thinks your ball is an egg.']), 2400); } }
    else if (e.t < 4.2) { const t = (e.t - 2.2) / 2; g.b.x = g.b.x + (e.to[0] - g.b.x) * Math.min(1, dt * 1.5); g.b.z = g.b.z + (e.to[1] - g.b.z) * Math.min(1, dt * 1.5); g.fy = 3 + Math.sin(t * Math.PI) * 4; c.position.set(g.b.x, groundY(g.b.x, g.b.z) + g.fy + 0.12, g.b.z); c.rotation.y = Math.atan2(-(e.to[0] - g.b.x), -(e.to[1] - g.b.z)); }
    else if (e.t < 4.8) { g.fy = Math.max(0, g.fy - dt * 12); c.position.y += dt * 6; }
    else { c.visible = false; g.fy = 0; g.b.x = e.to[0]; g.b.z = e.to[1]; g.ev = null; g.state = 'rest'; g.wait = 0.3; g.crowDone = true; }
    c.children[0].scale.x = 1 + Math.sin(G.t * 30) * 0.25;
  },
  holed(g, pickup) {
    const h = g.h, d = g.strokes - h.par; g.cards.push({ n: h.n, s: g.strokes, par: h.par });
    if (!pickup) {
      sfx.chime?.(); ui.toast(scoreName(d, g.strokes), `${g.strokes} stroke${g.strokes > 1 ? 's' : ''} (par ${h.par})`, 2000);
      if (g.strokes === 1) { H.discover('holeinone'); pl.money += 100; ui.toast('🎯 HOLE IN ONE!!', 'Tradition says the hole-in-one buys a round at the clubhouse… that\'s $20. You still made $80. Confetti!', 4000); confetti(h.pin[0], groundY(h.pin[0], h.pin[1]), h.pin[1]); }
      if (d === 0) pl.money += 3; if (d < 0) pl.money += 8;
    }
    g.i++; if (g.i >= g.list.length) return this.done(g);
    g.state = 'rest-hole'; g.wait = 1.4;
  },
  done(g) {
    const tot = g.cards.reduce((s, c) => s + c.s, 0), par = g.cards.reduce((s, c) => s + c.par, 0), d = tot - par, win = d <= 0;
    H.discover('pitchputt'); pl.stats.golfRounds = (pl.stats.golfRounds || 0) + 1; const best = (pl.stats.golfBest = pl.stats.golfBest || {}); const key2 = g.C.id + g.cards.length; const isBest = best[key2] === undefined || d < best[key2]; if (isBest) best[key2] = d;
    if (win) pl.money += 20;
    H.finish(`⛳ ${g.C.name}: ${tot} (${d === 0 ? 'even par' : (d > 0 ? '+' : '') + d})`, `${this.cardRow(g)}<br>${win ? 'At or under par! The clubhouse pays a $20 bonus and the starter nods at you.' : pick(['The geese laugh at you, but you had fun.', 'The crows are already gossiping about your short game.', 'A retiree in plaid shorts gives you a thumbs up anyway.'])}${isBest ? '<br>⭐ New personal best here!' : ''}`, win);
  },
  cardRow(g) { return g.list.map((h, i) => { const c = g.cards[i]; return `<span style="display:inline-block;width:22px;text-align:center;${i === g.i ? 'outline:1px solid #ffd45c;' : ''}color:${c ? scoreCol(c.s - c.par) : '#718096'}">${c ? c.s : h.n}</span>`; }).join(''); },
  card(g) {
    if (g.state === 'rest-hole' || !g.h) return `⛳ ${this.cardRow(g)}`;
    const h = g.h, club = CLUBS[g.ci], d = this.dist(g), tot = g.cards.reduce((s, c) => s + c.s - c.par, 0), lie = g.lie || 'tee';
    const read = club.putt ? (() => { const [ax, az] = slopeAcc(g.C, h, g.b.x, g.b.z, 'green'), fx = -Math.sin(g.yaw), fz = -Math.cos(g.yaw), along = ax * fx + az * fz, side = ax * -fz + az * fx, m = Math.hypot(ax, az) / 9.8 / 0.71 * 100; return ` · slope ${m.toFixed(1)}% ${along > 0.04 ? 'downhill' : along < -0.04 ? 'uphill' : ''} ${side > 0.04 ? 'breaks right ↱' : side < -0.04 ? 'breaks left ↰' : 'straight'}`; })() : '';
    const over = g.charge > 1, tick = this.ideal(g);
    const bar = `<div style="position:relative;width:300px;height:16px;margin:6px auto 2px;background:#2d3748;border-radius:8px;overflow:hidden"><div style="position:absolute;left:83.3%;right:0;top:0;bottom:0;background:#e53e3e55"></div><div style="position:absolute;left:0;top:0;bottom:0;width:${clamp(g.charge / 1.2, 0, 1) * 100}%;background:${over ? '#e53e3e' : 'linear-gradient(90deg,#f6e05e,#ed8936)'}"></div><div style="position:absolute;left:calc(${clamp(tick, 0, 1) / 1.2 * 100}% - 1px);top:0;bottom:0;width:3px;background:#fff"></div></div>`;
    return `⛳ Hole <b>${h.n}</b> (${g.i + 1}/${g.list.length}) · par ${h.par} · stroke <b>${g.strokes + (g.state === 'aim' ? 1 : 0)}</b> · ${d.toFixed(d < 10 ? 1 : 0)} m${!club.putt ? ` (plays ${Math.round(this.plays(g))} m)` : ''} · ${tot === 0 ? 'E' : (tot > 0 ? '+' : '') + tot}<br>🏌️ <b>${club.name}</b>${club.putt ? '' : ` (${club.carry} m)`} · lie: ${lie} · ${windTxt(g)}${read}${bar}<div style="font-size:12px">${this.cardRow(g)}</div><small>${H.K('A')}/${H.K('D')} aim · ${H.K('W')}/${H.K('S')} club · hold ${H.K('Space')}, let go · ${H.K('Esc')} quit</small>`;
  },
  cleanup(g) { H.showAim(null); H.ringOff(); if (g.crowM) g.crowM.visible = false; },
};
function confetti(x, y, z) {
  const n = 160, g = new THREE.BufferGeometry(), P = new Float32Array(n * 3), V = [], C = new Float32Array(n * 3), c = new THREE.Color();
  for (let i = 0; i < n; i++) { P.set([x, y + 0.5, z], i * 3); V.push([R(-3, 3), R(5, 10), R(-3, 3)]); c.setHSL(Math.random(), 0.9, 0.6); C.set([c.r, c.g, c.b], i * 3); }
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  const m = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.18, vertexColors: true })); m.frustumCulled = false; scene.add(m);
  let t = 0; const tick = () => { t += 0.016; for (let i = 0; i < n; i++) { V[i][1] -= 9.8 * 0.016 * 0.4; P[i * 3] += V[i][0] * 0.016; P[i * 3 + 1] = Math.max(y, P[i * 3 + 1] + V[i][1] * 0.016); P[i * 3 + 2] += V[i][2] * 0.016; } g.attributes.position.needsUpdate = true; if (t < 4) requestAnimationFrame(tick); else { scene.remove(m); g.dispose(); } }; tick();
}
const _o = new THREE.Object3D();
function waveFlags(C) {
  // the flag of the hole being played flutters; all flags turn with the breeze
  const a = G.t;
  C.holes18.forEach((h, i) => { _o.position.set(h.pin[0], groundY(h.pin[0], h.pin[1]) + 0.1, h.pin[1]); _o.rotation.set(0, Math.sin(a * 2.3 + i) * 0.35 + 1.2, 0); _o.updateMatrix(); C.flags.setMatrixAt(i, _o.matrix); });
  C.flags.instanceMatrix.needsUpdate = true;
}

// ---------- init / update / prompt / markers ----------
export function initGolf(player, helpers) {
  pl = player; H = helpers;
  for (const c of PARKDATA.courses) { const C = { ...c, hole: c.hole, green: c.green.slice(), pin: c.pin, tee: c.tee, bunker: c.bunker.slice(), water: c.water, fairway: c.fairway, club: c.club }; try { if (layout(C)) COURSES.push(C); } catch (e) { console.warn('golf layout', c.id, e); } }
  H.register('course', COURSE_GAME);
  // no bushes or wild plants on greens, tees and the mowed strips
  for (const C of COURSES) { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; const p = C.poly; for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
    clearZones.push((x, z) => x > x0 - 20 && x < x1 + 20 && z > z0 - 20 && z < z1 + 20 && C.holes18.some(h => edgeDist(h.green, x, z) < 3 || inPoly(x, z, h.green) || inPoly(x, z, h.teeP) || Math.hypot(x - h.tee[0], z - h.tee[1]) < 5 || segDist(h.path, x, z)[0] < fwW(h) / 2 + 1)); }
}
let chk = 0;
export function updateGolf(dt, player) {
  chk -= dt;
  if (chk < 0) { chk = 1; for (const C of COURSES) { const d = Math.hypot(player.x - C.booth[0], player.z - C.booth[1]); if (!C.meshes && d < 650) { buildCourse(C); } else if (C.meshes && d > 900 && H.current()?.C !== C) dropCourse(C); } }
  for (const C of COURSES) if (C.meshes && C.goose) {   // the goose: waddles about a green, grazes, flees when you get close (or get hit)
    const g = C.gooseT; g.t -= dt; const dp = Math.hypot(player.x - g.x, player.z - g.z);
    if (g.flee > 0 || dp < 3) { g.flee = Math.max(0, (g.flee || 0) - dt); const a = Math.atan2(g.z - player.z, g.x - player.x); g.x += Math.cos(a) * dt * 2.4; g.z += Math.sin(a) * dt * 2.4; if (!inPoly(g.x, g.z, C.poly)) { g.h = pick(C.holes18); const c = cen(g.h.green); g.x = c[0] + 3; g.z = c[1]; } }
    else if (g.t < 0) { g.t = R(2, 6); const c = cen(g.h.green); g.tx = c[0] + R(-7, 7); g.tz = c[1] + R(-7, 7); if (Math.random() < 0.08) g.h = pick(C.holes18); }
    else if (g.tx !== undefined) { const dx = g.tx - g.x, dz = g.tz - g.z, d = Math.hypot(dx, dz); if (d > 0.2) { g.x += dx / d * dt * 0.6; g.z += dz / d * dt * 0.6; g.yaw = Math.atan2(-dx, -dz); } }
    C.goose.position.set(g.x, groundY(g.x, g.z), g.z); C.goose.rotation.set(0, g.yaw || 0, 0); C.goose.children[0].rotation.x = Math.sin(G.t * 2 + g.x) > 0.6 ? -0.5 : 0;
    C.goose.visible = (G.hour ?? 12) > 6 && (G.hour ?? 12) < 21;
  }
}
export function golfPrompt(player) {
  if (H.current() || player.vehicle || player.transit || G.dialogOpen) return '';
  for (const C of COURSES) {
    if (!C.meshes) continue;
    const atBooth = Math.hypot(player.x - C.booth[0], player.z - C.booth[1]) < 8 || Math.hypot(player.x - C.holes18[0].tee[0], player.z - C.holes18[0].tee[1]) < 8;
    if (!atBooth && !inPoly(player.x, player.z, C.poly)) continue;
    const fee = FEE[C.id] || 12;
    if (tapped('KeyE')) {
      if (player.money < fee) { ui.toast('💸 Not enough cash', `The green fee is $${fee}.`, 1600); return ''; }
      player.money -= fee; sfx.coin?.(); H.begin('course', { ...H.obb(C.poly), a: { p: C.poly } }, { C });
    }
    return `<kbd>E</kbd> ⛳ Play ${C.name}: ${C.holes18.length} holes, par ${C.par} ($${fee}, rental clubs included)`;
  }
  return '';
}
export function golfMarkers() { return COURSES.map(C => ({ x: C.booth[0], z: C.booth[1], icon: '⛳' })); }
export const _golf = { COURSES, CLUBS, flight, lieAt, buildCourse, game: COURSE_GAME };
