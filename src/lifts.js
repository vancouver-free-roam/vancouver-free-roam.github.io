// Real ski lifts and gondolas from OpenStreetMap (Peak 2 Peak, Sea to Sky Gondola, Grouse Skyride, Whistler chairs...). You can ride them!
// Each line is laid out like a real lift: towers that follow the ground (closer together on chairs, long spans on gondolas,
// Peak 2 Peak's famous 3 km free span), a haul rope that sags between towers and always clears the ground, proper terminal
// stations at both ends (bullwheel, roof, loading deck; enclosed glass terminals for gondolas), hanging cabins with grips and
// hanger arms, and chairs with backrests + safety bars. Everything repeated is instanced (a handful of draw calls in total).
import * as THREE from 'three';
import { G, scene, std, tapped } from './core.js';
import { heightAt, groundY } from './terrain.js';
import { setColliders } from './colliders.js';
import { buildingAt, walkY } from './city.js';
import { ui } from './ui.js';

const M = window.MAP;
export const lifts = [];
const KIND = t => /gondola|cable_car/.test(t) ? 'gondola' : 'chair';
const CFG = {
  gondola: { clear: 16, minClear: 9, station: 7.5, maxSpan: 330, sag: 0.022, drop: 2.4, spacing: 65, speed: 6, side: 3.2 },
  chair:   { clear: 9.5, minClear: 6, station: 5.2, maxSpan: 115, sag: 0.018, drop: 2.65, spacing: 20, speed: 4.2, side: 2.6 },
};
const RS = 8;   // resample step along a line (m)

// ---------- layout: ground profile → towers → sagging rope ----------
function layout(L, C) {
  // resample the OSM line every RS metres
  const P = L.raw, xs = [], zs = [], ss = [];
  let acc = 0;
  for (let i = 0; i < P.length - 1; i++) {
    const ax = P[i][0], az = P[i][1], bx = P[i + 1][0], bz = P[i + 1][1], d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / RS));
    for (let k = 0; k < n; k++) { const t = k / n; xs.push(ax + (bx - ax) * t); zs.push(az + (bz - az) * t); ss.push(acc + d * t); }
    acc += d;
  }
  xs.push(P[P.length - 1][0]); zs.push(P[P.length - 1][1]); ss.push(acc);
  const g = xs.map((x, i) => heightAt(x, zs[i])), N = xs.length;
  L.xs = xs; L.zs = zs; L.ss = ss; L.g = g; L.total = acc;
  // towers: the two terminals, then evenly spread towers on each span longer than maxSpan, then extra towers wherever the
  // sagging rope would come too close to the ground (bumps, ridges)
  const span = /Peak 2 Peak/i.test(L.name) ? 3200 : C.maxSpan;
  let T = [0, N - 1];
  { const out = [0]; const n = Math.max(1, Math.round(acc / span)); for (let k = 1; k < n; k++) { let best = 0, bd = 1e9; const want = acc * k / n; for (let i = 0; i < N; i++) { const d = Math.abs(ss[i] - want); if (d < bd) { bd = d; best = i; } } out.push(best); } out.push(N - 1); T = [...new Set(out)].sort((a, b) => a - b); }
  const H = i => i === 0 || i === N - 1 ? g[i] + C.station : g[i] + C.clear;   // rope height at a tower / terminal
  for (let pass = 0; pass < 40; pass++) {
    let worst = -1, wd = 0;
    for (let k = 0; k < T.length - 1; k++) {
      const a = T[k], b = T[k + 1], ya = H(a), yb = H(b), sp = ss[b] - ss[a];
      for (let i = a + 1; i < b; i++) { const t = (ss[i] - ss[a]) / sp, y = ya + (yb - ya) * t - 4 * C.sag * sp * t * (1 - t), lack = g[i] + C.minClear - y; if (lack > wd) { wd = lack; worst = i; } }
    }
    if (worst < 0) break;
    T.push(worst); T.sort((a, b) => a - b);
  }
  // terminals: shift the first / last tower a little inside the station so the rope runs into the bullwheel
  L.towers = T.map(i => ({ i, s: ss[i], y: H(i) }));
}
// point on the rope (centre line) at distance s; also returns the travel direction
const _q = { x: 0, y: 0, z: 0, dx: 0, dz: 1 };
function ropeAt(L, s, out = _q) {
  s = Math.max(0, Math.min(L.total, s));
  const N = L.ss.length; let lo = 0, hi = N - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L.ss[m] <= s) lo = m; else hi = m; }
  const t = (s - L.ss[lo]) / ((L.ss[hi] - L.ss[lo]) || 1);
  out.x = L.xs[lo] + (L.xs[hi] - L.xs[lo]) * t; out.z = L.zs[lo] + (L.zs[hi] - L.zs[lo]) * t;
  const dl = Math.hypot(L.xs[hi] - L.xs[lo], L.zs[hi] - L.zs[lo]) || 1; out.dx = (L.xs[hi] - L.xs[lo]) / dl; out.dz = (L.zs[hi] - L.zs[lo]) / dl;
  const T = L.towers; let k = 0; while (k < T.length - 2 && T[k + 1].s < s) k++;
  const a = T[k], b = T[k + 1], sp = b.s - a.s || 1, u = (s - a.s) / sp;
  out.y = a.y + (b.y - a.y) * u - 4 * L.C.sag * sp * u * (1 - u);
  return out;
}

// ---------- shared meshes ----------
const steel = std('#8d949b', { metalness: 0.7, roughness: 0.35 }), darkSteel = std('#3b4046', { metalness: 0.6, roughness: 0.45 }), ropeM = std('#2a2c2f', { metalness: 0.6, roughness: 0.5 });
const concrete = std('#a7a49c', { roughness: 0.95 }), roofM = std('#3a4249', { metalness: 0.4, roughness: 0.5 }), glassM = std('#2a3a44', { metalness: 0.8, roughness: 0.1 }), woodM = std('#6b4a32', { roughness: 0.9 });
function merged(parts) {   // [geometry, x, y, z, rx, ry, rz] → one geometry
  const geos = parts.map(([g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0]) => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k); g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z); return g; });
  const n = geos.reduce((a, g) => a + g.attributes.position.count, 0), pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let o = 0;
  for (const g of geos) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); return out;
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d), Cy = (r1, r2, h, n = 10) => new THREE.CylinderGeometry(r1, r2, h, n);
// tower: a tapered tubular column (unit height, scaled per tower) …
const columnGeo = merged([[Cy(0.32, 0.55, 1, 12), 0, 0.5, 0], [Cy(0.9, 1.1, 0.25, 12), 0, 0.12, 0]]);
// … and its head: crossarm across both ropes with sheave trains, a maintenance ladder hoop and a lightning rod (per kind)
function headGeo(C) { const w = C.side * 2 + 1.6; return merged([[B(w, 0.45, 0.45), 0, 0, 0], ...[-1, 1].flatMap(s => [[B(0.25, 0.25, 3.2), s * C.side, -0.35, 0], [Cy(0.28, 0.28, 0.12, 12), s * C.side, -0.25, -1.1, 0, 0, Math.PI / 2], [Cy(0.28, 0.28, 0.12, 12), s * C.side, -0.25, 0, 0, 0, Math.PI / 2], [Cy(0.28, 0.28, 0.12, 12), s * C.side, -0.25, 1.1, 0, 0, Math.PI / 2]]), [Cy(0.03, 0.03, 2.2, 4), 0, 1.3, 0], [B(w, 0.06, 0.9), 0, 0.3, -0.55]]); }
const ropeGeo = Cy(1, 1, 1, 6).rotateX(Math.PI / 2);   // unit rope segment along z (scaled per segment)
// gondola cabin: rounded body + window band + roof + hanger arm + grip (two materials: paint, dark)
const cabinBody = merged([[new THREE.CapsuleGeometry(1.05, 0.9, 4, 12), 0, 0, 0, 0, 0, 0], [B(1.9, 0.12, 1.6), 0, 1.05, 0]]);
cabinBody.scale(1, 1, 0.85);
const cabinDark = merged([[Cy(1.07, 1.07, 0.75, 14, 1), 0, 0.15, 0], [B(0.1, 2.0, 0.1), 0, 2.1, 0], [B(0.5, 0.3, 0.4), 0, 3.15, 0], [B(0.9, 0.08, 0.08), 0, 1.15, 0]]);
cabinDark.scale(1, 1, 0.86);
// chair: padded seat + backrest (paint), frame + hanger + safety bar + footrest (dark)
const chairSeat = merged([[B(2.6, 0.14, 0.62), 0, 0, -0.05], [B(2.6, 0.62, 0.12), 0, 0.36, -0.38, -0.2]]);
const chairFrame = merged([[B(0.08, 2.4, 0.08), 0, 1.25, -0.45], [B(2.7, 0.06, 0.06), 0, 0.72, -0.45], [B(0.06, 0.06, 0.7), -1.32, 0.3, 0.05], [B(0.06, 0.06, 0.7), 1.32, 0.3, 0.05], [B(2.6, 0.05, 0.05), 0, 0.62, 0.42], [B(2.4, 0.05, 0.3), 0, -0.35, 0.55], [B(0.4, 0.25, 0.3), 0, 2.6, -0.45]]);
// terminal stations: concrete deck, steel frame, big horizontal bullwheel, roof; gondolas get an enclosed glass terminal
function stationParts(C, gondola) {
  const w = C.side * 2 + 4, L = gondola ? 18 : 12;
  return {
    deck: merged([[B(w + 4, 6, L + 4), 0, -2.0, 0]]),
    frame: merged([...[-1, 1].flatMap(s => [-1, 1].map(t => [B(0.5, C.station + 1.8, 0.5), s * (w / 2), (C.station + 1.8) / 2 + 1, t * (L / 2 - 1)])), [B(w, 0.6, L), 0, C.station + 2.2, 0]]),
    wheel: merged([[Cy(C.side, C.side, 0.35, 28), 0, C.station + 0.2, L / 2 - C.side - 0.2], [Cy(0.5, 0.5, 1.6, 10), 0, C.station + 1.1, L / 2 - C.side - 0.2]]),
    roof: merged([[B(w + 2, 0.3, L + 2), 0, C.station + 2.9, 0], [B(w + 2.4, 0.2, L + 2.4), 0, C.station + 3.1, 0]]),
    glass: gondola ? merged([[B(w - 0.4, C.station + 1.4, 0.15), 0, (C.station + 1.4) / 2 + 1.2, L / 2 - 0.6], ...[-1, 1].map(s => [B(0.15, C.station + 1.4, L - 2), s * (w / 2 - 0.2), (C.station + 1.4) / 2 + 1.2, 0])]) : null,
    hut: merged([[B(3, 2.6, 3), (w / 2 + 2.4), 2.5, -L / 2 + 2.5], [B(3.4, 0.25, 3.4), (w / 2 + 2.4), 3.9, -L / 2 + 2.5]]),
    L, w,
  };
}
function instanced(geo, mat, list, shadow = true) {
  if (!list.length) return null;
  const m = new THREE.InstancedMesh(geo, mat, list.length), o = new THREE.Object3D();
  list.forEach((t, i) => { o.position.set(t[0], t[1], t[2]); o.rotation.set(t[4] || 0, t[3] || 0, 0, 'YXZ'); o.scale.set(t[5] ?? 1, t[6] ?? 1, t[7] ?? 1); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
  m.castShadow = shadow; m.receiveShadow = true; m.computeBoundingSphere(); scene.add(m); return m;
}

export function initLifts() {
  const cols = [], heads = { gondola: [], chair: [] }, ropes = [], st = { gondola: { deck: [], frame: [], wheel: [], roof: [], glass: [], hut: [] }, chair: { deck: [], frame: [], wheel: [], roof: [], glass: [], hut: [] } }, coll = [];
  for (const raw of M.lifts || []) {
    const kind = KIND(raw.t), C = CFG[kind], gondola = kind === 'gondola';
    const name = raw.n >= 0 ? M.names[raw.n] : (gondola ? 'Gondola' : 'Chairlift');
    const P = []; for (let i = 0; i < raw.p.length; i += 2) P.push([raw.p[i], raw.p[i + 1]]);
    if (P.length < 2) continue;
    const L = { name, kind, gondola, C, raw: P, phase: Math.random() * 1000 };
    layout(L, C);
    if (L.total < 60) continue;
    // towers (not at the two terminals)
    for (const t of L.towers) {
      if (t.i === 0 || t.i === L.xs.length - 1) continue;
      const x = L.xs[t.i], z = L.zs[t.i], gy = L.g[t.i] - 0.5, h = t.y - gy + 0.6, d = ropeAt(L, t.s, {}), yaw = Math.atan2(d.dx, d.dz);
      cols.push([x, gy, z, yaw, 0, 1, h, 1]); heads[kind].push([x, t.y + 0.45, z, yaw]); coll.push({ x, z, r: 0.7, top: gy + h });
    }
    // the rope: both sides, sagging between towers, one instanced segment every ~12 m
    for (const s of [-1, 1]) {
      let prev = null;
      for (let u = 0; u <= L.total + 0.01; u += Math.min(12, L.total / 4)) {
        const p = ropeAt(L, u, {}), x = p.x - p.dz * s * C.side, z = p.z + p.dx * s * C.side;
        if (prev) { const dx = x - prev[0], dy = p.y - prev[1], dz = z - prev[2], len = Math.hypot(dx, dy, dz); ropes.push([(x + prev[0]) / 2, (p.y + prev[1]) / 2, (z + prev[2]) / 2, Math.atan2(dx, dz), -Math.atan2(dy, Math.hypot(dx, dz)), gondola ? 0.055 : 0.045, gondola ? 0.055 : 0.045, len]); }
        prev = [x, p.y, z];
      }
    }
    // stations at both ends, lined up with the rope; the bullwheel end faces outward
    const sp = stationParts(C, gondola); L.sp = sp; L.ends = [];
    for (const [s, sign] of [[0, -1], [L.total, 1]]) {
      const p = ropeAt(L, s, {}), yaw = Math.atan2(p.dx * sign, p.dz * sign), gy = heightAt(p.x, p.z) - 1.0;
      const cx = p.x + p.dx * sign * (sp.L / 2 - 2), cz = p.z + p.dz * sign * (sp.L / 2 - 2);
      const mapped = buildingAt(p.x, p.z) || buildingAt(cx, cz);   // the real terminal building is already in the map: don't stack a second one inside it
      if (!mapped) for (const part of ['deck', 'frame', 'wheel', 'roof', 'glass', 'hut']) st[kind][part].push([cx, gy, cz, yaw]);
      L.ends.push({ x: p.x, z: p.z, y: gy + 1.2, cx, cz, yaw, out: sign });
      if (!mapped) coll.push({ x: cx, z: cz, r: gondola ? 3 : 1.2, top: gy + C.station + 3 });   // the station core (you can still walk onto the deck)
    }
    L.pts = [new THREE.Vector3(L.xs[0], L.ends[0].y + C.station, L.zs[0]), new THREE.Vector3(L.xs.at(-1), L.ends[1].y + C.station, L.zs.at(-1))];   // (other modules read the two ends)
    // moving carriers: gondola cabins (colourful, Peak 2 Peak red) or chairs
    const n = Math.max(2, Math.floor(L.total * 2 / C.spacing));
    const paint = gondola ? (/Peak 2 Peak/i.test(name) ? '#c53030' : /Sea to Sky/i.test(name) ? '#2b6cb0' : /Skyride/i.test(name) ? '#d14b2a' : '#e2e8f0') : '#2b5c9e';
    L.carA = new THREE.InstancedMesh(gondola ? cabinBody : chairSeat, std(paint, { metalness: 0.3, roughness: 0.4 }), n);
    L.carB = new THREE.InstancedMesh(gondola ? cabinDark : chairFrame, gondola ? glassM : darkSteel, n);
    for (const m of [L.carA, L.carB]) { m.castShadow = true; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); }
    L.n = n; L.speed = C.speed;
    lifts.push(L);
  }
  instanced(columnGeo, steel, cols);
  for (const k of ['gondola', 'chair']) instanced(headGeo(CFG[k]), darkSteel, heads[k]);
  instanced(ropeGeo, ropeM, ropes, false);
  for (const k of ['gondola', 'chair']) { const sp = stationParts(CFG[k], k === 'gondola'); instanced(sp.deck, concrete, st[k].deck); instanced(sp.frame, steel, st[k].frame); instanced(sp.wheel, darkSteel, st[k].wheel); instanced(sp.roof, roofM, st[k].roof); if (sp.glass) instanced(sp.glass, glassM, st[k].glass); instanced(sp.hut, woodM, st[k].hut); }
  setColliders('lifts', coll);
}

// where a carrier on the up (+1) or down (-1) line hangs, at distance s
const _o = new THREE.Object3D();
function carrierPose(L, s, line, out) {
  const p = ropeAt(L, s, out), C = L.C;
  out.rx = p.x - p.dz * line * C.side; out.rz = p.z + p.dx * line * C.side; out.ry = p.y - C.drop - (L.gondola ? 0.9 : 0);
  out.yaw = Math.atan2(p.dx * line, p.dz * line);
  return out;
}
export let riding = null;
const _c = {};
export function updateLifts(dt, pl, ui) {
  for (const L of lifts) {
    const near = Math.hypot(L.xs[0] - pl.x, L.zs[0] - pl.z) < 9000 || Math.hypot(L.xs.at(-1) - pl.x, L.zs.at(-1) - pl.z) < 9000;
    L.carA.visible = L.carB.visible = near; if (!near) continue;
    L.phase = (L.phase + dt * L.speed) % (L.total * 2);
    for (let k = 0; k < L.n; k++) {
      let u = (L.phase + k * L.total * 2 / L.n) % (L.total * 2); const up = u < L.total; if (!up) u = L.total * 2 - u;
      // carriers slow right down through the terminals (detachable lifts) — and swing a little in the wind
      carrierPose(L, u, up ? 1 : -1, _c);
      const sw = Math.sin(G.t * 0.9 + k * 1.7) * (L.gondola ? 0.03 : 0.05) * (1 + (G.cloud || 0));
      _o.position.set(_c.rx, _c.ry, _c.rz); _o.rotation.set(sw, _c.yaw, 0, 'YXZ'); _o.updateMatrix();
      L.carA.setMatrixAt(k, _o.matrix); L.carB.setMatrixAt(k, _o.matrix);
    }
    L.carA.instanceMatrix.needsUpdate = L.carB.instanceMatrix.needsUpdate = true;
  }
  // riding: you sit in a cabin / on a chair on the up line (or down line when riding back)
  if (riding) {
    // real lift speed; Space once = fast-forward ×6, Space again = skip to the end
    const L = riding.L; riding.u += riding.dir * L.speed * (riding.ff ? 6 : 1) * (riding.mul || 1) * dt;
    carrierPose(L, riding.u, riding.dir, _c);
    pl.x = _c.rx; pl.z = _c.rz; pl.y = _c.ry + (L.gondola ? -1.35 : -0.45); pl.vy = 0; pl.yaw = _c.yaw + Math.PI;
    let done = riding.dir > 0 ? riding.u >= L.total : riding.u <= 0;
    if (tapped('KeyF')) { riding = null; pl.chute = true; ui.toast('🪂 You jumped off the lift!', 'Good thing you packed a parachute', 2500); return true; }
    if (tapped('Space')) {
      if (!riding.ff) { riding.ff = true; ui.toast('⏩ Fast-forward', '×6 speed. Press Space again to skip to the end of the lift.', 2200); }
      else { done = true; ui.toast('😴 You dozed off…', 'The liftie wakes you at the end: "End of the line, buddy!"', 2000); }
    }
    // something to look at halfway
    if (!riding.mid && Math.abs(riding.u - L.total / 2) < L.total * 0.05) { riding.mid = true; const t = liftSight(L); if (t) ui.toast(t[0], t[1], 4500); }
    if (done) {   // step off onto the snow / deck beside the station (never inside the terminal building)
      const e = L.ends[riding.dir > 0 ? 1 : 0], px = -Math.cos(e.yaw), pz = Math.sin(e.yaw);
      [pl.x, pl.z] = clearSpot(e.x + px * (L.sp.w / 2 + 4), e.z + pz * (L.sp.w / 2 + 4)); pl.y = walkY(pl.x, pl.z, Math.max(groundY(pl.x, pl.z), heightAt(pl.x, pl.z)) + 1);
      ui.toast('🚡 Arrived!', L.name + (riding.dir > 0 ? ' (top)' : ' (bottom)'), 2000); pl.onLiftArrive?.(L); riding = null;
    }
    return true;
  }
  return false;
}
export function liftPrompt(pl) {
  if (riding || pl.vehicle) return '';
  for (const L of lifts) for (const [e, dir] of [[L.ends[0], 1], [L.ends[1], -1]]) {
    if (Math.hypot(e.cx - pl.x, e.cz - pl.z) < (L.gondola ? 16 : 12) && Math.abs(e.y - pl.y) < 8) {
      if (tapped('KeyE')) { riding = { L, u: dir > 0 ? 0 : L.total, dir }; ui.toast('🚡 ' + L.name, `About ${Math.max(1, Math.round(L.total / L.speed / 60))} min ride · Space: speed up · Space again: skip · F: jump off`, 3500); }
      return `<kbd>E</kbd> 🚡 Ride the ${L.name}${dir < 0 ? ' (back down)' : ''}`;
    }
  }
  return '';
}
export const isRiding = () => !!riding;
// a spot out of any building (some lift ends are inside the real OSM terminal building)
function clearSpot(x, z) { for (let r = 0; r < 60; r += 2) for (let a = 0; a < 6.28; a += 0.5) { const X = x + Math.cos(a) * r, Z = z + Math.sin(a) * r; if (!buildingAt(X, Z) && !buildingAt(X + 1.5, Z) && !buildingAt(X - 1.5, Z) && !buildingAt(X, Z + 1.5) && !buildingAt(X, Z - 1.5)) return [X, Z]; } return [x, z]; }
// what you see on the way up (real details)
function liftSight(L) {
  const n = L.name;
  if (/Peak 2 Peak/i.test(n)) return ['🫣 Glass-floor cabin!', 'You are about 436 m above Fitzsimmons Creek, on the longest free span of any lift in the world (3 km).'];
  if (/Sea to Sky/i.test(n)) return ['🏔️ Howe Sound', 'The Stawamus Chief on one side, the whole fjord on the other. Someone drops their phone. It does not come back.'];
  if (/Skyride/i.test(n)) return ['🐻 Look down!', 'Grouse Mountain\'s resident grizzlies, Grinder and Coola, are wandering their enclosure below.'];
  if (/Whistler Village|Blackcomb Gondola|Excalibur/i.test(n)) return ['🚵 Bike park below', 'Mountain bikers fly down the trails under the cabin. One of them waves. Mid-jump.'];
  return pick([['🧤 A glove falls', 'Someone on the chair ahead drops a glove. It lands perfectly on a tree. It lives there now.'], ['🐿️ Whistling marmot', 'A marmot whistles from a rock below. (Whistler is named after them!)'], ['🎿 Chairlift chat', 'The stranger next to you tells you about his GoPro. All of it.'], ['🦅 Raven', 'A raven glides past at eye level and croaks something rude.']]);
}
const pick = a => a[Math.floor(Math.random() * a.length)];
export const _lifts = { ropeAt, CFG, ride(L, dir, mul = 1) { riding = L ? { L, u: dir > 0 ? 0 : L.total, dir, mul } : null; }, get riding() { return riding; } };   // for tests
