// Vancouver Island + the far world: Victoria landmarks (Parliament Buildings with their famous outline lights,
// the grand ivy-covered harbour hotel, Fisgard Lighthouse), BC Fairies ferries sailing the real routes,
// and discoveries for reaching the island and Mt Baker.
import * as THREE from 'three';
import { G, scene, std, addMesh, toXZ, canvasTex, R } from './core.js';
import { heightAt, isWater, waterLevel, forestHoles } from './terrain.js';
import { discover } from './missions.js';
import { bake } from './ships.js';
import { ui } from './ui.js';

const LAT0 = 49.283, LON0 = -123.12, KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KZ = 110574;
export const toLL = (x, z) => [LAT0 - z / KZ, LON0 + x / KX];
// south-west of the Strait of Georgia = Vancouver Island (+ Gulf Islands)
export function onIsland(x, z) { const [la, lo] = toLL(x, z); return (lo + 123.2) * 1.1 + (la - 48.9) * 1.9 < 0 && la < 50.9; }

function ground(x, z) { return Math.max(heightAt(x, z), 0.5); }
const lightMat = new THREE.MeshBasicMaterial({ color: 0xffd98a });
const lights = [];   // instanced bulbs, shown at night
function bulbs(list) { const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 6, 4), lightMat, list.length); const m = new THREE.Matrix4(); list.forEach((p, i) => im.setMatrixAt(i, m.makeTranslation(p[0], p[1], p[2]))); im.visible = false; scene.add(im); lights.push(im); }

function parliament() {
  const [x, z] = toXZ(48.4197, -123.3707), y = ground(x, z), g = new THREE.Group(); g.position.set(x, y, z); scene.add(g);
  const stone = std('#c9bfae', { roughness: 0.9 }), roof = std('#6f9f8a', { roughness: 0.6, metalness: 0.3 }), dark = std('#3c3a36'), win = std('#2c3440', { roughness: 0.3 });
  addMesh(new THREE.BoxGeometry(150, 16, 24), stone, 0, 8, 0, g);
  addMesh(new THREE.BoxGeometry(150.4, 1.2, 24.4), dark, 0, 16.4, 0, g);
  for (let i = -6; i <= 6; i++) for (const yy of [5, 11]) addMesh(new THREE.BoxGeometry(3, 3.6, 0.3), win, i * 11, yy, -12.1, g);
  for (const sx of [-1, 1]) { addMesh(new THREE.BoxGeometry(18, 22, 28), stone, sx * 66, 11, 0, g); const d = addMesh(new THREE.SphereGeometry(6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), roof, sx * 66, 22, 0, g); d.scale.y = 1.3; }
  addMesh(new THREE.CylinderGeometry(11, 12, 18, 24), stone, 0, 25, 0, g);
  addMesh(new THREE.CylinderGeometry(9, 10, 10, 24), stone, 0, 39, 0, g);
  const dome = addMesh(new THREE.SphereGeometry(10, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), roof, 0, 44, 0, g); dome.scale.y = 1.5;
  addMesh(new THREE.CylinderGeometry(1.8, 2, 5, 12), roof, 0, 61, 0, g);
  addMesh(new THREE.BoxGeometry(1.2, 3.4, 1.2), std('#e8c341', { metalness: 0.8, roughness: 0.3 }), 0, 65.4, 0, g);   // the gold statue of Captain Vancouver
  addMesh(new THREE.BoxGeometry(30, 12, 8), stone, 0, 6, -15, g);   // entrance portico
  for (let i = -2; i <= 2; i++) addMesh(new THREE.CylinderGeometry(0.9, 0.9, 10, 10), stone, i * 6, 5, -19.5, g);
  // the famous outline of ~3,300 light bulbs
  const L = [];
  for (let i = -75; i <= 75; i += 2.5) { L.push([x + i, y + 17.3, z - 12.3]); L.push([x + i, y + 0.6, z - 12.3]); }
  for (const sx of [-1, 1]) for (let t = 0; t <= 22; t += 2.4) { L.push([x + sx * 75, y + t, z - 12.3]); L.push([x + sx * 57, y + t, z - 14.3]); }
  for (let a = 0; a < 6.28; a += 0.13) { L.push([x + Math.cos(a) * 12.2, y + 34.2, z + Math.sin(a) * 12.2]); L.push([x + Math.cos(a) * 10.3, y + 44.2, z + Math.sin(a) * 10.3]); }
  for (let r = 0; r < 8; r++) { const a = r / 8 * 6.28; for (let t = 0; t <= 1; t += 0.08) { const ph = t * Math.PI / 2; L.push([x + Math.cos(a) * 10.3 * Math.cos(ph), y + 44.2 + 15 * Math.sin(ph), z + Math.sin(a) * 10.3 * Math.cos(ph)]); } }
  for (const sx of [-1, 1]) for (let r = 0; r < 6; r++) { const a = r / 6 * 6.28; for (let t = 0; t <= 1; t += 0.15) { const ph = t * Math.PI / 2; L.push([x + sx * 66 + Math.cos(a) * 6.2 * Math.cos(ph), y + 22.2 + 7.8 * Math.sin(ph), z + Math.sin(a) * 6.2 * Math.cos(ph)]); } }
  bulbs(L);
  // the lawn in front, with the Inner Harbour beyond
  const lawn = addMesh(new THREE.BoxGeometry(160, 0.4, 60), std('#5d8a45'), x, y + 0.1, z - 45); lawn.receiveShadow = true;
  return { x, z };
}
function empress() {
  const [x, z] = toXZ(48.4216, -123.3678), y = ground(x, z), g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = 0.15; scene.add(g);
  const ivy = std('#5c6e3d', { roughness: 1 }), brick = std('#8a5a44'), roof = std('#6f9f8a', { roughness: 0.6, metalness: 0.3 }), win = std('#e7d9a8', { emissive: '#e7c97a', emissiveIntensity: 0.0 });
  addMesh(new THREE.BoxGeometry(95, 26, 24), ivy, 0, 13, 0, g);
  addMesh(new THREE.BoxGeometry(95.3, 4, 24.3), brick, 0, 2, 0, g);
  const r = addMesh(new THREE.CylinderGeometry(0.1, 17, 14, 4, 1), roof, 0, 33, 0, g); r.rotation.y = Math.PI / 4; r.scale.set(3.9, 1, 1);
  for (const sx of [-1, 0, 1]) { addMesh(new THREE.BoxGeometry(16, 34, 16), ivy, sx * 38, 17, 0, g); const t = addMesh(new THREE.ConeGeometry(11.5, 16, 4), roof, sx * 38, 42, 0, g); t.rotation.y = Math.PI / 4; }
  for (let i = -4; i <= 4; i++) for (let k = 0; k < 4; k++) { const w = addMesh(new THREE.BoxGeometry(2.2, 2.6, 0.3), win, i * 9.5, 6 + k * 5.5, -12.2, g); w.userData.win = true; }
  const flag = addMesh(new THREE.BoxGeometry(3, 1.6, 0.1), std('#d62828'), 0, 52, 0, g);
  return { win };
}
function fisgard() {
  const [x, z] = toXZ(48.4305, -123.4473), y = ground(x, z), g = new THREE.Group(); g.position.set(x, y, z); scene.add(g);
  addMesh(new THREE.CylinderGeometry(2.2, 2.6, 14, 14), std('#f4f4ef'), 0, 7, 0, g);
  addMesh(new THREE.BoxGeometry(8, 6, 7), std('#b33a2e'), 5, 3, 0, g);
  addMesh(new THREE.CylinderGeometry(1.7, 1.7, 2.2, 10), std('#2c3440', { metalness: 0.4 }), 0, 15.1, 0, g);
  addMesh(new THREE.ConeGeometry(2, 1.6, 10), std('#b33a2e'), 0, 17, 0, g);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(14, 140, 16, 1, true).translate(0, -70, 0).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff1b8, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.set(0, 15.2, 0); g.add(beam); return { beam };
}

// ---------- BC Fairies ferries on the real routes ----------
const ROUTES = [
  { name: 'Tsawwassen ⇄ Swartz Bay', pts: [[49.0060, -123.1335], [48.6895, -123.4095]] },
  { name: 'Horseshoe Bay ⇄ Departure Bay', pts: [[49.3740, -123.2725], [49.1955, -123.9420]] },
];
export function ferryModel() {
  const g = new THREE.Group(), white = std('#f3f4f1', { roughness: 0.6 }), blue = std('#1e4a8a'), dark = std('#20262e', { roughness: 0.3 });
  addMesh(new THREE.BoxGeometry(24, 8, 150), white, 0, 3, 0, g);
  addMesh(new THREE.BoxGeometry(24.2, 2.2, 150.2), blue, 0, 1.2, 0, g);
  addMesh(new THREE.BoxGeometry(24.4, 1.4, 150.4), std('#9e2b25'), 0, -0.4, 0, g);
  addMesh(new THREE.BoxGeometry(22, 4, 110), white, 0, 9, 0, g);
  addMesh(new THREE.BoxGeometry(22.2, 1.4, 110.2), dark, 0, 9.6, 0, g);
  addMesh(new THREE.BoxGeometry(18, 3.5, 60), white, 0, 12.7, 0, g);
  addMesh(new THREE.BoxGeometry(18.2, 1.2, 12), dark, 0, 13.4, -24, g);
  for (const s of [-1, 1]) { addMesh(new THREE.BoxGeometry(3, 6, 6), white, 0, 17, s * 12, g); addMesh(new THREE.BoxGeometry(3.1, 1.6, 6.1), blue, 0, 19.2, s * 12, g); addMesh(new THREE.BoxGeometry(3.15, 0.8, 6.15), std('#c8302a'), 0, 18.1, s * 12, g); }
  const tex = canvasTex(1024, 128, (c, w, h) => { c.fillStyle = '#1e4a8a'; c.font = 'bold 92px sans-serif'; c.textAlign = 'center'; c.fillText('BC FAIRIES ✨', w / 2, 100); }, false);
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(60, 7.5), new THREE.MeshBasicMaterial({ map: tex, transparent: true })); p.position.set(s * 11.15, 9, 0); p.rotation.y = s * Math.PI / 2; g.add(p); }
  scene.add(g); return bake(g);
}
const ferries = [];
// shortest route over open water (A* on a 200 m grid, staying off the shoreline), then straightened
export function waterPath(a, b, C = 200, M = 8000) {
  const x0 = Math.min(a[0], b[0]) - M, z0 = Math.min(a[1], b[1]) - M, W = Math.ceil((Math.max(a[0], b[0]) + M - x0) / C), H = Math.ceil((Math.max(a[1], b[1]) + M - z0) / C);
  const cost = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const x = x0 + i * C, z = z0 + j * C; const h = heightAt(x, z); cost[j * W + i] = !isWater(x, z) || waterLevel(x, z) !== 0 ? 0 : h > -12 ? 4 : 1; }
  const cell = p => { let bi = -1, bd = 1e18; const ci = Math.round((p[0] - x0) / C), cj = Math.round((p[1] - z0) / C); for (let j = cj - 15; j <= cj + 15; j++) for (let i = ci - 15; i <= ci + 15; i++) { if (i < 0 || j < 0 || i >= W || j >= H || !cost[j * W + i]) continue; const d = (i - ci) ** 2 + (j - cj) ** 2; if (d < bd) { bd = d; bi = j * W + i; } } return bi; };
  const s = cell(a), g = cell(b); if (s < 0 || g < 0) return [a, b];
  const gs = new Float32Array(W * H).fill(1e9), from = new Int32Array(W * H).fill(-1), heap = [[0, s]]; gs[s] = 0;
  const push = e => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const hx = k => Math.hypot(k % W - g % W, Math.floor(k / W) - Math.floor(g / W));
  while (heap.length) {
    const [fk, k] = pop(); if (k === g) break; if (fk - hx(k) > gs[k] + 1e-3) continue;
    const ki = k % W, kj = Math.floor(k / W);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const ni = ki + di, nj = kj + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue; const n = nj * W + ni; if (!cost[n]) continue; const ng = gs[k] + Math.hypot(di, dj) * cost[n]; if (ng < gs[n]) { gs[n] = ng; from[n] = k; push([ng + hx(n), n]); } }
  }
  if (from[g] < 0) return [a, b];
  const cells = []; for (let k = g; k >= 0; k = from[k]) cells.push([x0 + (k % W) * C, z0 + Math.floor(k / W) * C]); cells.reverse();
  const clear = (p, q) => { const L = Math.hypot(q[0] - p[0], q[1] - p[1]); for (let d = 0; d < L; d += Math.min(60, C * 0.8)) { const x = p[0] + (q[0] - p[0]) * d / L, z = p[1] + (q[1] - p[1]) * d / L; if (!isWater(x, z) || heightAt(x, z) > (C < 100 ? -3 : -6)) return false; } return true; };
  const out = [cells[0]]; let i = 0; while (i < cells.length - 1) { let j = cells.length - 1; while (j > i + 1 && !clear(cells[i], cells[j])) j--; out.push(cells[j]); i = j; }
  return [a, ...out, b];
}
function buildFerries() {
  for (const r of ROUTES) {
    r.xz = waterPath(toXZ(...r.pts[0]), toXZ(...r.pts[1])); r.len = [0]; for (let i = 1; i < r.xz.length; i++) r.len.push(r.len[i - 1] + Math.hypot(r.xz[i][0] - r.xz[i - 1][0], r.xz[i][1] - r.xz[i - 1][1]));
    const L = r.len[r.len.length - 1];
    for (const [s, dir] of [[L * 0.2, 1], [L * 0.7, -1]]) ferries.push({ r, s, dir, g: ferryModel(), dwell: 0 });
  }
}
function at(r, s) { s = Math.max(0, Math.min(r.len[r.len.length - 1], s)); let i = 1; while (i < r.len.length - 1 && r.len[i] < s) i++; const t = (s - r.len[i - 1]) / (r.len[i] - r.len[i - 1]), a = r.xz[i - 1], b = r.xz[i]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(-(b[0] - a[0]), -(b[1] - a[1]))]; }

// ---------- Victoria surprises ----------
// Chinatown's Gate of Harmonious Interest (Fisgard St) and the Mile 0 marker of the Trans-Canada Highway
function chinatownGate() {
  const [x, z] = toXZ(48.42955, -123.36760), y = ground(x, z), g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = Math.PI / 2; scene.add(g);
  const red = std('#b3261e'), green = std('#2f7d4a', { roughness: 0.5 }), gold = std('#e0b23a', { metalness: 0.6, roughness: 0.3 });
  for (const s of [-1, 1]) { addMesh(new THREE.CylinderGeometry(0.45, 0.5, 7.5, 12), red, s * 4.5, 3.75, 0, g); addMesh(new THREE.BoxGeometry(1.4, 0.6, 1.4), std('#cfc8b8'), s * 4.5, 0.3, 0, g); }
  addMesh(new THREE.BoxGeometry(11, 0.8, 1.2), red, 0, 6.6, 0, g);
  const roof = addMesh(new THREE.CylinderGeometry(0.2, 2.2, 1.4, 4, 1), green, 0, 8.1, 0, g); roof.scale.set(4, 1, 0.9); roof.rotation.y = Math.PI / 4;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 1.1), new THREE.MeshBasicMaterial({ map: canvasTex(512, 128, (c, w, h) => { c.fillStyle = '#b3261e'; c.fillRect(0, 0, w, h); c.strokeStyle = '#e0b23a'; c.lineWidth = 8; c.strokeRect(6, 6, w - 12, h - 12); c.fillStyle = '#e0b23a'; c.font = 'bold 70px serif'; c.textAlign = 'center'; c.fillText('同濟共和', w / 2, 92); }, false) }));
  sign.position.set(0, 5.6, 0.62); g.add(sign); const sb = sign.clone(); sb.rotation.y = Math.PI; sb.position.z = -0.62; g.add(sb);
  for (const s of [-1, 1]) addMesh(new THREE.SphereGeometry(0.5, 10, 8), gold, s * 3.5, 9.1, 0, g);
  return { x, z };
}
function mileZero() {
  const [x, z] = toXZ(48.40760, -123.36840), y = ground(x, z), g = new THREE.Group(); g.position.set(x, y, z); scene.add(g);
  addMesh(new THREE.CylinderGeometry(0.12, 0.12, 3, 8), std('#6b6b6b'), 0, 1.5, 0, g);
  const p = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, map: canvasTex(256, 192, (c, w, h) => { c.fillStyle = '#1f6f3a'; c.fillRect(0, 0, w, h); c.strokeStyle = '#fff'; c.lineWidth = 6; c.strokeRect(5, 5, w - 10, h - 10); c.fillStyle = '#fff'; c.textAlign = 'center'; c.font = 'bold 60px sans-serif'; c.fillText('MILE 0', w / 2, 80); c.font = 'bold 22px sans-serif'; c.fillText('TRANS-CANADA HWY', w / 2, 125); c.font = '18px sans-serif'; c.fillText("St. John's, NL  7,821 km", w / 2, 160); }, false) }));
  p.position.y = 2.6; g.add(p); return { x, z };
}
// the peacocks of Beacon Hill Park (they really live there, and they really do this)
function peacockModel() {
  const g = new THREE.Group(), blue = std('#1f4fb3', { roughness: 0.4, metalness: 0.2 });
  addMesh(new THREE.SphereGeometry(0.22, 10, 8), blue, 0, 0.55, 0, g).scale.set(1, 1, 1.5);
  addMesh(new THREE.CylinderGeometry(0.05, 0.07, 0.45, 8), blue, 0, 0.85, -0.22, g).rotation.x = 0.3;
  addMesh(new THREE.SphereGeometry(0.08, 8, 6), blue, 0, 1.08, -0.3, g);
  addMesh(new THREE.ConeGeometry(0.02, 0.12, 6), std('#2a2a2a'), 0, 1.22, -0.3, g);
  for (const s of [-1, 1]) addMesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4), std('#8a7b6a'), s * 0.07, 0.2, 0, g);
  const tail = new THREE.Group(); tail.position.set(0, 0.55, 0.3); g.add(tail);
  tail.add(new THREE.Mesh(new THREE.CircleGeometry(1.1, 24, 0, Math.PI), FAN_MAT));
  scene.add(g); return { g, tail };
}
const FAN_MAT = new THREE.MeshStandardMaterial({ transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, map: canvasTex(256, 256, (c, w, h) => { c.translate(w / 2, h); for (let i = 0; i < 70; i++) { const a = -Math.PI + (i / 69) * Math.PI, r = 110 + (i % 3) * 12; c.strokeStyle = '#2f6b3a'; c.lineWidth = 6; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * r, Math.sin(a) * r); c.stroke(); c.fillStyle = '#d9b33c'; c.beginPath(); c.arc(Math.cos(a) * r, Math.sin(a) * r, 10, 0, 7); c.fill(); c.fillStyle = '#1b3fa0'; c.beginPath(); c.arc(Math.cos(a) * r, Math.sin(a) * r, 5, 0, 7); c.fill(); } }, false) });
const peacocks = [];
function makePeacocks() {
  const [cx, cz] = toXZ(48.41250, -123.36350);
  for (let i = 0; i < 7; i++) { const m = peacockModel(); peacocks.push({ ...m, x: cx + R(-120, 120), z: cz + R(-120, 120), yaw: Math.random() * 6.28, t: R(0, 6), fan: 0, cx, cz }); }
}
function updatePeacocks(dt, pl) {
  for (const p of peacocks) {
    const d = Math.hypot(p.x - pl.x, p.z - pl.z); p.g.visible = d < 400; if (!p.g.visible) continue;
    p.t -= dt;
    if (p.t < 0) { p.t = R(3, 9); p.showing = Math.random() < (d < 25 ? 0.6 : 0.2); p.tx = p.cx + R(-140, 140); p.tz = p.cz + R(-140, 140); }
    if (p.showing) { p.fan = Math.min(1, p.fan + dt * 1.5); p.yaw += Math.sin(G.t * 0.8) * dt * 0.4; if (d < 25 && !p.saw) { p.saw = true; ui.toast('🦚 A peacock is showing off!', 'The peacocks of Beacon Hill Park have roamed free here since the 1890s. They scream. A lot.', 4000); discover('peacock'); } }
    else { p.fan = Math.max(0, p.fan - dt * 2); const dx = p.tx - p.x, dz = p.tz - p.z, L = Math.hypot(dx, dz); if (L > 1) { p.x += dx / L * 0.7 * dt; p.z += dz / L * 0.7 * dt; p.yaw = Math.atan2(-dx, -dz); } }
    p.tail.rotation.x = -1.4 + p.fan * 1.4; p.tail.scale.setScalar(0.25 + p.fan * 0.75); p.tail.position.y = 0.55 + p.fan * 0.1;
    p.g.position.set(p.x, ground(p.x, p.z), p.z); p.g.rotation.y = p.yaw;
  }
}
// Victoria Harbour Ferries: little green "pickle boats" zipping around the Inner Harbour. At 11 am they do a water ballet.
const pickles = [];
function makePickles() {
  const [cx, cz] = toXZ(48.42420, -123.37200);
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group(); addMesh(new THREE.BoxGeometry(2.6, 0.9, 6), std('#2f8f4e'), 0, 0.3, 0, g); addMesh(new THREE.BoxGeometry(2.4, 1.3, 3.2), std('#f4f4ef'), 0, 1.35, 0.4, g); addMesh(new THREE.BoxGeometry(2.6, 0.2, 3.6), std('#2f8f4e'), 0, 2.1, 0.4, g); addMesh(new THREE.ConeGeometry(1.3, 1.6, 4), std('#2f8f4e'), 0, 0.3, -3.6, g).rotation.set(-Math.PI / 2, Math.PI / 4, 0);
    scene.add(g); pickles.push({ g, cx, cz, a: i / 6 * 6.28, r: R(40, 120), sp: R(0.05, 0.09) * (i % 2 ? 1 : -1), i, px: cx, pz: cz });
  }
}
let balletSeen = false;
function updatePickles(dt, pl) {
  const ballet = G.hour >= 11 && G.hour < 11.25, near = Math.hypot(pickles[0].cx - pl.x, pickles[0].cz - pl.z) < 900;
  for (const p of pickles) {
    p.g.visible = near; if (!near) continue;
    let x, z;
    if (ballet) { const t = G.t * 0.25 + p.i / 6 * 6.28; x = p.cx + Math.cos(t) * 40; z = p.cz + Math.sin(t) * 40; }
    else { p.a += p.sp * dt; x = p.cx + Math.cos(p.a) * p.r; z = p.cz + Math.sin(p.a) * p.r * 0.6; if (!isWater(x, z)) { p.sp = -p.sp; p.r = R(30, 110); } }
    const dx = x - p.px, dz = z - p.pz; if (Math.hypot(dx, dz) > 0.01) p.yaw = Math.atan2(-dx, -dz); p.px = x; p.pz = z;
    p.g.position.set(x, Math.sin(G.t * 1.5 + p.i) * 0.08, z); p.g.rotation.y = (p.yaw || 0) + (ballet && Math.sin(G.t * 0.7 + p.i) > 0.6 ? G.t * 2 : 0);
  }
  if (ballet && near && !balletSeen) { balletSeen = true; ui.toast('🩰 The Harbour Ferry water ballet!', 'Every so often the little pickle boats dance in the Inner Harbour. Victoria is adorable.', 4500); discover('waterballet'); }
  if (!ballet) balletSeen = false;
}
let CG = null, M0 = null;
function initVictoriaFun() { CG = chinatownGate(); M0 = mileZero(); makePeacocks(); makePickles(); }
function updateVictoriaFun(dt, pl) {
  updatePeacocks(dt, pl); updatePickles(dt, pl);
  if (Math.hypot(pl.x - CG.x, pl.z - CG.z) < 25) discover('vicchinatown');
  if (Math.hypot(pl.x - M0.x, pl.z - M0.z) < 15) discover('mile0');
}

let P = null, E = null, F = null, checkT = 0, ferryNear = false;
export function initIsland() {
  // downtowns and ferry terminals: no forest
  for (const [la, lo, r] of [[48.4235, -123.3640, 2600], [48.4480, -123.3600, 2200], [49.1660, -123.9400, 2200], [49.1935, -123.9530, 600], [48.6890, -123.4100, 500], [49.0060, -123.1330, 700], [49.1530, -125.9060, 900]]) { const [x, z] = toXZ(la, lo); forestHoles.push({ x, z, r2: r * r }); } P = parliament(); E = empress(); F = fisgard(); buildFerries(); initVictoriaFun(); }
export function updateIsland(dt, pl) {
  const night = (G.night || 0) > 0.5;
  for (const l of lights) l.visible = night;
  E.win.emissiveIntensity = night ? 1.2 : 0;
  F.beam.visible = night || (G.fogW || 0) > 0.3; F.beam.rotation.y += dt * 0.9;
  for (const f of ferries) {
    const L = f.r.len[f.r.len.length - 1];
    if (f.dwell > 0) f.dwell -= dt;
    else { f.s += f.dir * 10.5 * dt; if (f.s >= L || f.s <= 0) { f.s = Math.max(0, Math.min(L, f.s)); f.dir *= -1; f.dwell = 90; } }
    const [x, z, yaw] = at(f.r, f.s), ease = Math.min(f.s, L - f.s) < 300 ? 0.6 : 1;
    f.g.position.set(x, Math.sin(G.t * 0.4 + f.s * 0.01) * 0.25 * ease, z); f.g.rotation.y = yaw + (f.dir > 0 ? 0 : Math.PI);
  }
  updateVictoriaFun(dt, pl);
  checkT -= dt; if (checkT > 0) return; checkT = 1.5;
  if (!pl.transit && onIsland(pl.x, pl.z) && !isWater(pl.x, pl.z)) discover('island');
  if (Math.hypot(pl.x - P.x, pl.z - P.z) < 120) discover('parliament');
  const [bx, bz] = toXZ(48.7768, -121.8144), [ax, az] = toXZ(48.8463, -121.6930);
  if (Math.hypot(pl.x - bx, pl.z - bz) < 3000 || Math.hypot(pl.x - ax, pl.z - az) < 1500) discover('baker');
  const nf = ferries.some(f => Math.hypot(f.g.position.x - pl.x, f.g.position.z - pl.z) < 400);
  if (nf && !ferryNear) ui.toast('⛴️ BC Fairies ferry', 'A big ferry glides past. Somewhere on board, someone is eating a Sunshine Breakfast.', 3000);
  ferryNear = nf;
}
export const _island = { ferries, ROUTES };
