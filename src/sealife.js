// Life in and around the sea: orca pods, humpback whales, Pacific white-sided dolphins (they ride your bow wave!),
// harbour seals (curious heads + seals hauled out on the shore), great blue herons, bald eagles that snatch fish,
// jumping salmon, messages in bottles… and, very rarely, something nobody can explain.
import * as THREE from 'three';
import { G, scene, R, pick, clamp, tapped } from './core.js';
import { isWater, heightAt, waterLevel } from './terrain.js';
import { SPOTS } from './landmarks.js';
import { discover, state, setWaypoint } from './missions.js';
import { ui } from './ui.js';
import { sfx } from './sound.js';

// ---------- models (coloured parts merged into one geometry; forward = -z) ----------
function blob(parts) {
  const pos = [], col = [], c = new THREE.Color(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (const [geo, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0] of parts) {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone()); q.setFromEuler(e.set(rx, ry, rz)); m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz)); g.applyMatrix4(m);
    pos.push(...g.attributes.position.array); c.set(color); for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
}
const S = () => new THREE.SphereGeometry(1, 16, 10), Bx = () => new THREE.BoxGeometry(1, 1, 1), Cn = () => new THREE.ConeGeometry(1, 1, 6), Cy = () => new THREE.CylinderGeometry(1, 1, 1, 8);
const MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide });
const GEO = {
  orca: blob([[S(), '#0d0f12', 0, 0, 0, 1.1, 1.0, 3.6], [S(), '#f4f5f2', 0, -0.42, -0.7, 0.86, 0.62, 2.5], [S(), '#f4f5f2', 0.78, 0.28, -2.15, 0.3, 0.2, 0.62], [S(), '#f4f5f2', -0.78, 0.28, -2.15, 0.3, 0.2, 0.62], [S(), '#8e959c', 0, 0.62, 0.7, 0.85, 0.42, 0.9],
    [Cn(), '#0d0f12', 0, 1.75, 0.3, 0.5, 1.9, 0.14, -0.18], [Bx(), '#0d0f12', 1.15, -0.45, -1.4, 1.3, 0.12, 0.6, 0, 0.3, -0.45], [Bx(), '#0d0f12', -1.15, -0.45, -1.4, 1.3, 0.12, 0.6, 0, -0.3, 0.45]]),
  orcaTail: blob([[S(), '#0d0f12', 0, 0, 0.9, 0.45, 0.45, 1.3], [Bx(), '#0d0f12', 0, 0, 2.1, 2.6, 0.12, 0.75], [Bx(), '#e9ebe8', 0, -0.07, 2.15, 2.0, 0.04, 0.5]]),
  hump: blob([[S(), '#2a2f35', 0, 0, 0, 1.8, 1.55, 7], [S(), '#c7cbcf', 0, -0.7, -2.5, 1.45, 0.9, 4.2], [S(), '#3a4048', 0, 1.0, -5.6, 0.9, 0.5, 1.2], [Cn(), '#2a2f35', 0, 1.6, 2.2, 0.35, 0.8, 0.5, -0.4],
    [Bx(), '#eceee8', 2.1, -0.7, -2.2, 0.55, 0.16, 4.6, 0, 0.55, -0.35], [Bx(), '#eceee8', -2.1, -0.7, -2.2, 0.55, 0.16, 4.6, 0, -0.55, 0.35]]),
  humpTail: blob([[S(), '#2a2f35', 0, 0, 1.2, 0.8, 0.8, 2.2], [Bx(), '#2a2f35', 0, 0.03, 3.3, 5.2, 0.18, 1.5], [Bx(), '#f2f2ee', 0, -0.07, 3.35, 4.6, 0.05, 1.2]]),
  dolphin: blob([[S(), '#4f5862', 0, 0, 0, 0.36, 0.38, 1.15], [S(), '#e3e6e8', 0, -0.13, -0.2, 0.3, 0.25, 0.9], [S(), '#a9b2bb', 0.18, 0, 0.25, 0.2, 0.2, 0.7], [S(), '#a9b2bb', -0.18, 0, 0.25, 0.2, 0.2, 0.7],
    [Cn(), '#4f5862', 0, 0.45, 0.05, 0.2, 0.42, 0.08, -0.5], [S(), '#4f5862', 0, -0.05, -1.25, 0.1, 0.1, 0.3], [Bx(), '#4f5862', 0, 0, 1.25, 0.7, 0.05, 0.22]]),
  sealHead: blob([[S(), '#6f6c66', 0, 0, 0, 0.26, 0.26, 0.3], [S(), '#5e5b55', 0, -0.05, -0.27, 0.13, 0.11, 0.12], [S(), '#111', 0.12, 0.06, -0.2, 0.05, 0.05, 0.03], [S(), '#111', -0.12, 0.06, -0.2, 0.05, 0.05, 0.03]]),
  sealBody: blob([[S(), '#77736a', 0, 0.3, 0, 0.42, 0.32, 0.85], [S(), '#77736a', 0, 0.42, -0.85, 0.25, 0.24, 0.28], [S(), '#2b2b2b', 0.1, 0.5, -1.07, 0.04, 0.04, 0.02], [S(), '#2b2b2b', -0.1, 0.5, -1.07, 0.04, 0.04, 0.02],
    [S(), '#5d5a53', 0.2, 0.42, 0.2, 0.08, 0.06, 0.08], [S(), '#5d5a53', -0.15, 0.5, -0.3, 0.07, 0.05, 0.07], [Bx(), '#5d5a53', 0, 0.12, 0.95, 0.5, 0.06, 0.3]]),
  heron: blob([[S(), '#7f8c9b', 0, 1.05, 0, 0.2, 0.24, 0.42], [Cy(), '#9aa7b4', 0, 1.45, -0.32, 0.05, 0.6, 0.05, -0.35], [S(), '#dfe3e6', 0, 1.78, -0.42, 0.08, 0.08, 0.12], [Cn(), '#e0b640', 0, 1.78, -0.62, 0.025, 0.25, 0.025, -Math.PI / 2],
    [Bx(), '#1b1b1b', 0, 1.82, -0.38, 0.04, 0.03, 0.2], [Cy(), '#3a3530', 0.06, 0.42, 0.05, 0.02, 0.85, 0.02], [Cy(), '#3a3530', -0.06, 0.42, 0.05, 0.02, 0.85, 0.02]]),
  eagle: blob([[S(), '#3b2a1e', 0, 0, 0, 0.18, 0.18, 0.45], [S(), '#f7f7f2', 0, 0.06, -0.48, 0.13, 0.13, 0.15], [Cn(), '#f2c230', 0, 0.03, -0.66, 0.04, 0.12, 0.04, -Math.PI / 2], [Bx(), '#f7f7f2', 0, 0, 0.55, 0.3, 0.04, 0.3]]),
  wing: blob([[Bx(), '#2e2016', 0.55, 0, 0, 1.1, 0.04, 0.42], [Bx(), '#2e2016', 1.15, 0, 0.08, 0.25, 0.03, 0.3]]),
  fish: blob([[S(), '#c8ced4', 0, 0, 0, 0.09, 0.12, 0.35], [S(), '#5c6f7e', 0, 0.06, 0, 0.06, 0.06, 0.3], [Bx(), '#c8ced4', 0, 0, 0.38, 0.02, 0.18, 0.12]]),
  bottle: blob([[Cy(), '#2f7d4a', 0, 0, 0, 0.09, 0.32, 0.09, Math.PI / 2], [Cy(), '#2f7d4a', 0, 0, -0.24, 0.04, 0.16, 0.04, Math.PI / 2], [Cy(), '#b48a5a', 0, 0, -0.34, 0.035, 0.06, 0.035, Math.PI / 2], [Cy(), '#efe6c8', 0, 0, 0.02, 0.05, 0.25, 0.05, Math.PI / 2]]),
  caddyHump: blob([[new THREE.TorusGeometry(1.4, 0.55, 8, 16, Math.PI), '#3e4a32', 0, 0, 0, 1, 1, 1, 0, Math.PI / 2], [Cn(), '#2d3624', 0, 1.95, 0, 0.25, 0.7, 0.25]]),
  caddyHead: blob([[Cy(), '#3e4a32', 0, 1.6, 0, 0.45, 3.4, 0.45], [S(), '#3e4a32', 0, 3.4, -0.45, 0.55, 0.5, 0.95], [S(), '#d9c24a', 0.32, 3.55, -0.75, 0.1, 0.1, 0.1], [S(), '#d9c24a', -0.32, 3.55, -0.75, 0.1, 0.1, 0.1],
    [Cn(), '#2d3624', 0.25, 3.95, -0.2, 0.08, 0.5, 0.08], [Cn(), '#2d3624', -0.25, 3.95, -0.2, 0.08, 0.5, 0.08], [Bx(), '#1e2418', 0, 2.6, 0.35, 0.08, 1.6, 0.5]]),
};
function mk(...geos) { const g = new THREE.Group(); const parts = geos.map(k => { const m = new THREE.Mesh(GEO[k], MAT); m.castShadow = true; g.add(m); return m; }); scene.add(g); return { g, parts }; }

// ---------- splashes and spouts ----------
const puffMat = new THREE.MeshBasicMaterial({ color: 0xf2f6f8, transparent: true, opacity: 0.8, depthWrite: false, fog: true });
const puffs = []; for (let i = 0; i < 60; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), puffMat.clone()); m.visible = false; scene.add(m); puffs.push({ m, life: 0 }); }
function puff(x, y, z, size, vy, life = 1.2) { const p = puffs.find(p => p.life <= 0); if (!p) return; p.life = p.max = life; p.vy = vy; p.size = size; p.m.position.set(x, y, z); p.m.visible = true; }
function splash(x, z, big) { for (let i = 0; i < (big ? 14 : 5); i++) puff(x + R(-1, 1) * (big ? 3 : 1), 0.3, z + R(-1, 1) * (big ? 3 : 1), big ? R(0.8, 1.8) : R(0.3, 0.6), R(2, big ? 9 : 4), R(0.8, 1.6)); sfx.splash?.(); }
function spout(x, z, tall) { for (let i = 0; i < (tall ? 9 : 5); i++) puff(x + R(-0.3, 0.3), 0.8 + i * (tall ? 0.6 : 0.35), z + R(-0.3, 0.3), tall ? R(0.4, 0.9) : R(0.25, 0.45), R(1.5, 3.5), R(1.4, 2.4)); }
function updatePuffs(dt) { for (const p of puffs) if (p.life > 0) { p.life -= dt; const t = 1 - p.life / p.max; p.m.position.y += p.vy * dt; p.vy -= 6 * dt; p.m.scale.setScalar(p.size * (0.6 + t)); p.m.material.opacity = 0.75 * (1 - t); if (p.life <= 0) p.m.visible = false; } }

// ---------- helpers ----------
// the city harbour data has no depths (all "4 m"), so out there use distance from shore instead
const sea = (x, z, d = -8) => waterLevel(x, z) === 0 && isWater(x, z) && (heightAt(x, z) < Math.min(d, -4.5) || !nearShore(x, z, -d * 10));
function nearShore(x, z, r) { for (let a = 0; a < 6.28; a += 0.785) if (!isWater(x + Math.cos(a) * r, z + Math.sin(a) * r)) return true; return false; }
function shorePoint(pl, rMin, rMax) {   // a beach/rock spot right next to the water
  for (let k = 0; k < 20; k++) {
    const a = Math.random() * 6.28, r = R(rMin, rMax), x = pl.x + Math.cos(a) * r, z = pl.z + Math.sin(a) * r, h = heightAt(x, z);
    if (h < 0.8 || h > 4 || isWater(x, z)) continue;
    for (let b = 0; b < 6.28; b += 0.785) { const wx = x + Math.cos(b) * 6, wz = z + Math.sin(b) * 6; if (isWater(wx, wz) && waterLevel(wx, wz) === 0) return { x, z, h, yaw: Math.atan2(-(wx - x), -(wz - z)), wx, wz }; }
  }
  return null;
}
const seen = new Set();
function sighted(id, title, text) { if (seen.has(id)) return; seen.add(id); ui.toast(title, text, 4200); try { discover(id); } catch (e) { } }

// ---------- the animals ----------
const A = [];
const count = k => A.filter(a => a.k === k).length;
function spawnSwimmer(k, x, z, yaw) {
  const S = { orca: { geos: ['orca', 'orcaTail'], sp: 4.2, tail: 3.4, len: 3.6, breach: 0.14, under: [6, 14], surfaces: [2, 4] }, hump: { geos: ['hump', 'humpTail'], sp: 2.2, tail: 6.8, len: 7, breach: 0.1, under: [14, 30], surfaces: [3, 5] }, caddy: { geos: [], sp: 2, len: 6 } }[k];
  const o = mk(...S.geos); if (o.parts[1]) o.parts[1].position.z = S.tail;
  const a = { k, S, o, x, z, yaw, y: -6, pitch: 0, roll: 0, st: 'under', t: R(1, 4), u: 0, left: Math.floor(R(...S.surfaces)), ph: Math.random() * 6 };
  A.push(a); return a;
}
function spawnPod(pl, d) {
  for (let k = 0; k < 20; k++) {
    const a = Math.random() * 6.28, r = R(250, 900), x = pl.x + Math.cos(a) * r, z = pl.z + Math.sin(a) * r;
    if (!sea(x, z, d) || nearShore(x, z, 80)) continue;
    return { x, z, yaw: Math.random() * 6.28 };
  }
  return null;
}
function steer(a, dt, depth) {
  const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw);
  if (!sea(a.x + fx * 60, a.z + fz * 60, depth)) a.yaw += 1.4 * dt; else a.yaw += Math.sin(G.t * 0.07 + a.ph) * 0.12 * dt;
  a.x += fx * a.sp * dt; a.z += fz * a.sp * dt;
}
function updateWhale(a, dt, pl) {
  const S = a.S; a.sp = S.sp; steer(a, dt, -6);
  const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw), big = a.k === 'hump';
  if (a.st === 'under') { a.y = -6; a.pitch = 0; a.roll = 0; a.t -= dt; if (a.t < 0) { a.u = 0; a.st = Math.random() < S.breach ? 'breach' : 'surf'; if (a.st === 'breach') splash(a.x, a.z, false); } }
  else if (a.st === 'surf') {
    a.u += dt / (big ? 4.2 : 2.6); const u = Math.min(1, a.u);
    a.y = (big ? -2.2 : -1.55) + Math.sin(Math.PI * u) * (big ? 2.1 : 1.65); a.pitch = Math.cos(Math.PI * u) * (big ? 0.12 : 0.25);
    if (a.u > 0.25 && !a.blew) { a.blew = true; spout(a.x + fx * S.len * 0.75, a.z + fz * S.len * 0.75, big); }
    if (a.u >= 1) { a.blew = false; a.left--; if (a.left > 0) { a.st = 'under'; a.t = R(2, 4); } else { a.st = big ? 'fluke' : 'under'; a.u = 0; a.t = R(...S.under); a.left = Math.floor(R(...S.surfaces)); } }
  } else if (a.st === 'fluke') {   // humpback's deep dive: the tail lifts high out of the water
    a.u += dt / 4.5; a.pitch = -Math.min(1.25, a.u * 2.2); a.y = -1.2 - a.u * 5;
    if (a.u >= 1) { a.st = 'under'; a.t = R(...S.under); }
  } else if (a.st === 'breach') {
    a.u += dt / (big ? 3.2 : 2.4); const u = Math.min(1, a.u);
    a.y = -7 + Math.sin(Math.PI * u) * (big ? 13 : 10); a.pitch = 1.25 - u * 2.1; a.roll = big ? u * 1.6 : 0;
    if (a.u >= 1) { splash(a.x + fx * 3, a.z + fz * 3, true); a.st = 'under'; a.t = R(4, 9); a.roll = 0; }
  }
  a.o.g.visible = a.y > -5.5;
  a.o.g.position.set(a.x, a.y, a.z); a.o.g.rotation.set(a.pitch, a.yaw, a.roll, 'YXZ');
  if (a.o.parts[1]) a.o.parts[1].rotation.x = Math.sin(G.t * (big ? 1.2 : 2.2) + a.ph) * 0.25 + (a.st === 'fluke' ? -0.4 : 0);
  const d = Math.hypot(a.x - pl.x, a.z - pl.z);
  if (a.o.g.visible && d < 500) {
    if (a.k === 'orca') sighted('orcapod', a.st === 'breach' ? '🐋 An orca just BREACHED!' : '🐋 Orcas!', 'A pod of killer whales (the Southern Residents, maybe?). They are actually huge dolphins. Fun fact: each pod has its own dialect of calls.');
    else sighted('humpback', a.st === 'breach' ? '🐳 A humpback BREACH!' : '🐳 A humpback whale!', 'Humpbacks came back to the Salish Sea after almost 100 years. Watch for the spout, then the tail.');
  }
}

// dolphins: a group that porpoises along and rides the bow wave of fast boats
function spawnDolphins(p) { const n = Math.floor(R(5, 10)); for (let i = 0; i < n; i++) { const o = mk('dolphin'); A.push({ k: 'dolphin', o, x: p.x + R(-12, 12), z: p.z + R(-12, 12), yaw: p.yaw + R(-0.2, 0.2), sp: 6, ph: Math.random() * 6, y: -1, life: R(90, 160) }); } }
function updateDolphin(a, dt, pl) {
  const v = pl.vehicle, boat = v && v.d.kind === 'water' && Math.abs(v.speed || 0) > 7;
  const bd = boat ? Math.hypot(v.x - a.x, v.z - a.z) : 1e9;
  if (boat && bd < 180) {   // bow riding!
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), side = (a.ph % 2 < 1 ? -1 : 1) * (2 + (a.ph % 1) * 3), tx = v.x + fx * (6 + a.ph % 4 * 2) + fz * side, tz = v.z + fz * (6 + a.ph % 4 * 2) - fx * side;
    a.yaw += Math.atan2(Math.sin(Math.atan2(-(tx - a.x), -(tz - a.z)) - a.yaw), Math.cos(Math.atan2(-(tx - a.x), -(tz - a.z)) - a.yaw)) * Math.min(1, dt * 3);
    a.sp = clamp(Math.abs(v.speed) + Math.hypot(tx - a.x, tz - a.z) * 0.5, 5, 24);
    if (bd < 30) sighted('dolphins', '🐬 Dolphins are riding your bow wave!', 'Pacific white-sided dolphins: they LOVE fast boats. Keep going!');
  } else { a.sp = 6; const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw); if (!sea(a.x + fx * 40, a.z + fz * 40, -4)) a.yaw += 1.6 * dt; else a.yaw += Math.sin(G.t * 0.2 + Math.floor(a.ph)) * 0.15 * dt; }
  a.x += -Math.sin(a.yaw) * a.sp * dt; a.z += -Math.cos(a.yaw) * a.sp * dt;
  a.ph2 = (a.ph2 || a.ph) + dt * (2.2 + a.sp * 0.12); const s = Math.sin(a.ph2);
  a.y = -0.9 + Math.max(0, s) * (1.4 + (a.ph % 1) * 0.8); const pitch = s > 0 ? Math.cos(a.ph2) * 0.6 : 0;
  if (s > 0.97 && !a.sp1) { a.sp1 = true; splash(a.x, a.z, false); } if (s < 0) a.sp1 = false;
  a.o.g.visible = a.y > -0.85; a.o.g.position.set(a.x, a.y, a.z); a.o.g.rotation.set(pitch, a.yaw, 0, 'YXZ');
  if (!boat && Math.hypot(a.x - pl.x, a.z - pl.z) < 300) sighted('dolphinspod', '🐬 Dolphins!', 'A pod of Pacific white-sided dolphins. Tip: drive a fast boat near them…');
  a.life -= dt; return a.life > 0;
}

// harbour seals: curious heads in the water near shore, and seals lying on the rocks
function updateSealHead(a, dt, pl) {
  a.t -= dt; if (a.t < 0) { a.up = !a.up; a.t = a.up ? R(6, 16) : R(3, 8); if (a.up) { const r = Math.min(a.r, 30); a.x += R(-r, r) * 0.3; a.z += R(-r, r) * 0.3; } }
  a.y = a.up ? -0.12 + Math.sin(G.t * 1.3 + a.ph) * 0.05 : -1.5; a.o.g.visible = a.up;
  const d = Math.hypot(a.x - pl.x, a.z - pl.z); a.yaw = Math.atan2(-(pl.x - a.x), -(pl.z - a.z));   // they stare at you
  a.o.g.position.set(a.x, a.y, a.z); a.o.g.rotation.set(0, a.yaw, 0);
  if (a.up && d < 60) sighted('seal', '🦭 A harbour seal is watching you', 'Big dark eyes, zero shame. Harbour seals pop up all over Vancouver\'s waters.');
  if (a.up && d < 8 && (pl.swimming || pl.vehicle?.d.kind === 'water') && !a.boop) { a.boop = true; ui.toast('🦭 Boop!', pick(['The seal sniffs your face and sinks away. Rude.', 'The seal snorts, splashes you and disappears.', 'It looked you in the eye. You both felt something.']), 2500); splash(a.x, a.z, false); a.up = false; a.t = 6; }
  return !isWater(a.x, a.z) ? false : true;
}
function updateHaulout(a, dt, pl) {
  const d = Math.hypot(a.x - pl.x, a.z - pl.z);
  if (!a.flee && d < 14) { a.flee = true; ui.toast('🦭 Flop flop flop SPLASH', 'The seals on the rocks slide into the water.', 1800); }
  if (a.flee) { const dx = a.wx - a.x, dz = a.wz - a.z, L = Math.hypot(dx, dz); if (L < 0.6) { splash(a.x, a.z, false); return false; } a.x += dx / L * 3 * dt; a.z += dz / L * 3 * dt; a.y = Math.max(-0.4, heightAt(a.x, a.z)); }
  else a.y = a.h + Math.sin(G.t * 0.6 + a.ph) * 0.02;
  a.o.g.position.set(a.x, a.y, a.z); a.o.g.rotation.set(0, a.yaw, Math.sin(G.t * 0.3 + a.ph) * 0.06);
  return true;
}
// great blue herons: stand like statues at the water's edge, fly off when you get close
function updateHeron(a, dt, pl) {
  const d = Math.hypot(a.x - pl.x, a.z - pl.z);
  if (!a.fly && d < 18) { a.fly = true; a.yaw = Math.atan2(pl.x - a.x, pl.z - a.z); sighted('heron', '🪶 Great blue heron', 'Stanley Park has one of the biggest urban heron colonies in North America.'); }
  if (a.fly) { a.t = (a.t || 0) + dt; a.x += -Math.sin(a.yaw) * 7 * dt; a.z += -Math.cos(a.yaw) * 7 * dt; a.y += (a.t < 3 ? 3 : 0.5) * dt; if (a.t > 9) return false; }
  else a.y = a.h;
  a.o.g.position.set(a.x, a.y, a.z); a.o.g.rotation.set(a.fly ? -0.5 : 0, a.yaw, 0); return true;
}
// bald eagles: soar in circles, sometimes swoop down and snatch a fish
function updateEagle(a, dt, pl) {
  a.ang += dt * 0.25 * a.dir; a.t -= dt;
  if (a.st === 'soar') { a.x = a.cx + Math.cos(a.ang) * a.r; a.z = a.cz + Math.sin(a.ang) * a.r; a.y += (a.alt - a.y) * Math.min(1, dt); a.yaw = Math.atan2(Math.sin(a.ang) * a.dir, -Math.cos(a.ang) * a.dir);
    if (a.t < 0) { a.t = R(10, 25); if (isWater(a.x, a.z) && Math.random() < 0.5) { a.st = 'dive'; a.u = 0; a.y0 = a.y; } } }
  else { a.u += dt / 3; a.y = a.y0 * (1 - Math.sin(Math.PI * Math.min(1, a.u))) + 0.6 * Math.sin(Math.PI * Math.min(1, a.u)); a.x += -Math.sin(a.yaw) * 9 * dt; a.z += -Math.cos(a.yaw) * 9 * dt;
    if (a.u > 0.5 && !a.got) { a.got = true; splash(a.x, a.z, false); if (Math.hypot(a.x - pl.x, a.z - pl.z) < 350) sighted('eagle', '🦅 A bald eagle just snatched a fish!', 'Talons out, straight into the water and gone. BC has more bald eagles than almost anywhere.'); }
    if (a.u >= 1) { a.st = 'soar'; a.got = false; a.cx = a.x - Math.cos(a.ang) * a.r; a.cz = a.z - Math.sin(a.ang) * a.r; } }
  const flap = a.st === 'dive' ? -0.6 : Math.sin(G.t * 2 + a.ph) * (Math.sin(G.t * 0.3 + a.ph) > 0.7 ? 0.35 : 0.05);
  a.o.parts[1].rotation.z = flap; a.o.parts[2].rotation.z = -flap;
  a.o.g.position.set(a.x, a.y, a.z); a.o.g.rotation.set(a.st === 'dive' ? (a.u < 0.5 ? 0.6 : -0.5) : 0, a.yaw, a.st === 'soar' ? 0.35 * a.dir : 0, 'YXZ');
  return Math.hypot(a.x - pl.x, a.z - pl.z) < 900;
}
function makeEagle(x, z, y) { const o = mk('eagle', 'wing', 'wing'); o.parts[2].scale.x = -1; return { k: 'eagle', o, cx: x, cz: z, r: R(40, 90), ang: Math.random() * 6.28, dir: Math.random() < 0.5 ? -1 : 1, alt: y, x, z, y, st: 'soar', t: R(5, 15), ph: Math.random() * 6, yaw: 0 }; }
// jumping salmon (mostly in late summer and fall when they head for the rivers)
function jumpFish(pl) {
  for (let k = 0; k < 8; k++) { const x = pl.x + R(-120, 120), z = pl.z + R(-120, 120); if (!isWater(x, z) || waterLevel(x, z) !== 0) continue; const o = mk('fish'); A.push({ k: 'fish', o, x, z, y: -0.3, vy: R(4, 6), yaw: Math.random() * 6.28 }); splash(x, z, false); return; }
}
function updateFish(a, dt) { a.vy -= 12 * dt; a.y += a.vy * dt; a.x += -Math.sin(a.yaw) * 1.5 * dt; a.z += -Math.cos(a.yaw) * 1.5 * dt; a.o.g.position.set(a.x, a.y, a.z); a.o.g.rotation.set(-a.vy * 0.15, a.yaw, Math.sin(G.t * 30) * 0.4, 'YXZ'); if (a.y < -0.3) { splash(a.x, a.z, false); return false; } return true; }

// messages in bottles: E to fish one out (sometimes it's a treasure map to a secret)
const NOTES = ['"If found, please return to Tofino. Or keep it. There\'s $20 inside. Surf\'s up." — Kyle', '"Day 3 on the ferry. Still no sign of the Sunshine Breakfast. Send help."', '"To whoever finds this: Granville Island\'s best doughnut is NOT the one with the line. Trust me."', '"Dear future person: did they ever finish the Broadway subway?"',
  '"I threw my ex\'s Canucks jersey in the ocean with this note. No regrets."', '"Help, I am trapped in a bottle factory." (ink smudged)', '"The orcas told me a secret. I will never tell. — a very old sailor"'];
let bottle = null;
function updateBottle(dt, pl) {
  if (!bottle) return;
  const b = bottle; b.t += dt; b.o.g.position.set(b.x, Math.sin(b.t * 1.7) * 0.08, b.z); b.o.g.rotation.set(Math.sin(b.t) * 0.3, b.t * 0.2, Math.sin(b.t * 1.3) * 0.25);
  if (Math.hypot(b.x - pl.x, b.z - pl.z) > 700) { scene.remove(b.o.g); bottle = null; }
}
export function seaPrompt(pl) {
  if (!bottle || Math.hypot(bottle.x - pl.x, bottle.z - pl.z) > 5 || !(pl.swimming || pl.vehicle?.d.kind === 'water')) return '';
  if (tapped('KeyE')) {
    scene.remove(bottle.o.g); bottle = null; sfx.coin?.();
    const left = Object.values(SPOTS).filter(s => !state.found.has(s.id));
    if (left.length && Math.random() < 0.45) { const s = pick(left); setWaypoint(s.x, s.z, 'Treasure map'); ui.toast('🍾 A message in a bottle!', 'It\'s an old hand-drawn map with an X on it… (waypoint set to a secret spot!)', 4500); }
    else { const cash = Math.round(R(20, 120)); pl.money += cash; ui.toast('🍾 A message in a bottle!', pick(NOTES) + ` (+$${cash} rolled up inside)`, 5000); }
    pl.stats.bottles = (pl.stats.bottles || 0) + 1;
  }
  return '<kbd>E</kbd> 🍾 Fish out the message in a bottle';
}

// the legend: Cadborosaurus ("Caddy"), BC's sea serpent. Very, very rare and only far out from the city.
function spawnCaddy(p) {
  const o = { g: new THREE.Group(), parts: [] }; scene.add(o.g);
  for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(GEO.caddyHump, MAT); m.position.z = 3 + i * 4.2; m.scale.setScalar(1 - i * 0.15); o.g.add(m); o.parts.push(m); }
  const h = new THREE.Mesh(GEO.caddyHead, MAT); o.g.add(h); o.parts.push(h);
  A.push({ k: 'caddy', o, x: p.x, z: p.z, yaw: p.yaw, sp: 2.5, y: -6, t: 0, ph: 0 });
}
function updateCaddy(a, dt, pl) {
  a.t += dt; steer(a, dt, -10);
  a.y = a.t < 4 ? -6 + a.t * 1.5 : a.t < 30 ? 0 : -(a.t - 30) * 1.2;
  a.o.parts.forEach((m, i) => { m.position.y = Math.sin(G.t * 1.5 - i * 0.9) * 0.35; });
  a.o.g.position.set(a.x, a.y, a.z); a.o.g.rotation.y = a.yaw; a.o.g.visible = a.y > -5;
  if (a.y > -1 && Math.hypot(a.x - pl.x, a.z - pl.z) < 400) sighted('caddy', '🐉 Was that… CADDY?!', 'Cadborosaurus, the sea serpent of BC legend, seen since the 1930s. Nobody will believe you. Nobody.');
  return a.t < 36;
}

// ---------- spawning & update ----------
let spawnT = 2;
const DOWNTOWN = { x: 0, z: 0 };
function spawn(pl) {
  const onWater = pl.swimming || pl.vehicle?.d.kind === 'water' || pl.vehicle?.type === 'seaplane';
  let nearSea = onWater; if (!nearSea) for (let a = 0; a < 6.28 && !nearSea; a += 0.785) if (sea(pl.x + Math.cos(a) * 400, pl.z + Math.sin(a) * 400, -2)) nearSea = true;
  if (!nearSea) return;
  const far = Math.hypot(pl.x - DOWNTOWN.x, pl.z - DOWNTOWN.z) > 12000;
  if (count('orca') === 0 && Math.random() < 0.07) { const p = spawnPod(pl, -15); if (p) { const n = Math.floor(R(3, 6)); for (let i = 0; i < n; i++) { const a = spawnSwimmer('orca', p.x + R(-25, 25), p.z + R(-25, 25), p.yaw + R(-0.15, 0.15)); a.t = R(0.5, 5); if (i === 0) a.o.g.scale.setScalar(1.15); if (i === n - 1) a.o.g.scale.setScalar(0.6); } } }
  if (count('hump') === 0 && Math.random() < (far ? 0.06 : 0.035)) { const p = spawnPod(pl, -25); if (p) spawnSwimmer('hump', p.x, p.z, p.yaw); }
  if (count('dolphin') === 0 && Math.random() < 0.07) { const p = spawnPod(pl, -10); if (p) spawnDolphins(p); }
  if (far && count('caddy') === 0 && Math.random() < 0.006) { const p = spawnPod(pl, -30); if (p) spawnCaddy(p); }
  if (count('seal') < 5 && Math.random() < 0.5) { for (let k = 0; k < 10; k++) { const a = Math.random() * 6.28, r = R(25, 220), x = pl.x + Math.cos(a) * r, z = pl.z + Math.sin(a) * r; if (sea(x, z, -2) && nearShore(x, z, 120)) { const o = mk('sealHead'); A.push({ k: 'seal', o, x, z, y: -1, r: 30, up: false, t: R(0, 4), ph: Math.random() * 6 }); break; } } }
  if (count('haul') < 4 && Math.random() < 0.15) { const s = shorePoint(pl, 60, 300); if (s) for (let i = 0; i < Math.floor(R(1, 4)); i++) { const o = mk('sealBody'); A.push({ k: 'haul', o, x: s.x + R(-3, 3), z: s.z + R(-3, 3), h: s.h, yaw: s.yaw + Math.PI + R(-0.6, 0.6), wx: s.wx, wz: s.wz, ph: Math.random() * 6 }); } }
  if (count('heron') < 3 && Math.random() < 0.2) { const s = shorePoint(pl, 40, 250); if (s) { const o = mk('heron'); A.push({ k: 'heron', o, x: s.x, z: s.z, h: s.h, y: s.h, yaw: s.yaw }); } }
  if (count('eagle') < 2 && Math.random() < 0.12) A.push(makeEagle(pl.x + R(-300, 300), pl.z + R(-300, 300), Math.max(heightAt(pl.x, pl.z), 0) + R(55, 110)));
  if (Math.random() < (G.season === 'fall' || G.season === 'summer' ? 0.35 : 0.1)) jumpFish(pl);
  if (!bottle && onWater && Math.random() < 0.03) { for (let k = 0; k < 10; k++) { const a = Math.random() * 6.28, r = R(40, 160), x = pl.x + Math.cos(a) * r, z = pl.z + Math.sin(a) * r; if (sea(x, z, -2)) { bottle = { o: mk('bottle'), x, z, t: 0 }; break; } } }
}
export function updateSeaLife(dt, pl) {
  spawnT -= dt; if (spawnT < 0) { spawnT = 2.5; if (!pl.transit) spawn(pl); }
  for (let i = A.length - 1; i >= 0; i--) {
    const a = A[i]; let keep = true;
    if (a.k === 'orca' || a.k === 'hump') updateWhale(a, dt, pl);
    else if (a.k === 'dolphin') keep = updateDolphin(a, dt, pl);
    else if (a.k === 'seal') keep = updateSealHead(a, dt, pl);
    else if (a.k === 'haul') keep = updateHaulout(a, dt, pl);
    else if (a.k === 'heron') keep = updateHeron(a, dt, pl);
    else if (a.k === 'eagle') keep = updateEagle(a, dt, pl);
    else if (a.k === 'fish') keep = updateFish(a, dt);
    else if (a.k === 'caddy') keep = updateCaddy(a, dt, pl);
    const lim = a.k === 'orca' || a.k === 'hump' || a.k === 'caddy' ? 2200 : a.k === 'eagle' ? 1000 : 600;
    if (!keep || Math.hypot(a.x - pl.x, a.z - pl.z) > lim) { scene.remove(a.o.g); A.splice(i, 1); }
  }
  updateBottle(dt, pl); updatePuffs(dt);
}
export const _sea = { A, spawnSwimmer, spawnDolphins, spawnCaddy, get bottle() { return bottle; } };   // for tests
