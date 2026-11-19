// The "details" layer, all from real OpenStreetMap points:
//  - park & street furniture: benches, picnic tables, drinking fountains, washrooms, BBQs, bins, bike racks,
//    clocks, flagpoles (Canadian flags), ATMs, info boards, shelters, playground equipment, fitness stations
//  - artworks + history: sculptures, statues, busts, totem poles, murals, fountains, memorials, monuments, plaques…
//  - flower beds, gardens and community-garden plots; soccer goals on fields
//  - steeples / domes / pagoda roofs on places of worship
// Furniture is instanced near the player; artworks are built near the player and dropped when far.
import * as THREE from 'three';
import { G, scene, std, canvasTex, hash2, inPoly, tapped, pick } from './core.js';
import { heightAt, isWater } from './terrain.js';
import { surfaceY, buildingAt, nearBuildings, pois } from './city.js';
import { setColliders, fromInstances } from './colliders.js';
import { ui } from './ui.js';
import { QE_FOUNTAIN } from './qepark.js';
import { buildArt, kindName, famousFact } from './artworks.js';
import { SPOTS } from './landmarks.js';

const M = window.MAP;
const FURN = M.furn || [], ART = M.art || [];

// ---------- tiny geometry kit: merge coloured boxes/cylinders into one geometry ----------
function part(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { return { geo, color, x, y, z, rx, ry, rz }; }
const box = (w, h, d, c, x, y, z, rx, ry, rz) => part(new THREE.BoxGeometry(w, h, d), c, x, y, z, rx, ry, rz);
const cyl = (r1, r2, h, c, x, y, z, rx, ry, rz, seg = 8) => part(new THREE.CylinderGeometry(r1, r2, h, seg), c, x, y, z, rx, ry, rz);
function merge(parts) {
  const pos = [], nor = [], col = [], c = new THREE.Color(), m = new THREE.Matrix4(), e = new THREE.Euler(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  for (const p of parts) {
    let g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    e.set(p.rx, p.ry, p.rz); q.setFromEuler(e); v.set(p.x, p.y, p.z); m.compose(v, q, s); g = g.clone().applyMatrix4(m);
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); c.set(p.color);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}
const VC = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
const VCmetal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.7 });
const WOOD = '#7a5a3a', DWOOD = '#5a4030', METAL = '#3d4247', RED = '#d64545', YEL = '#f2c230', BLU = '#3182ce', GRN = '#2f855a';

// ---------- furniture models (code -> {geo, r (collision radius), h}) ----------
const FMODEL = {
  1: { geo: merge([box(1.7, 0.08, 0.45, WOOD, 0, 0.45, 0), box(1.7, 0.4, 0.06, WOOD, 0, 0.75, -0.2), box(0.08, 0.45, 0.4, METAL, -0.7, 0.22, 0), box(0.08, 0.45, 0.4, METAL, 0.7, 0.22, 0)]), r: 0.6, h: 1 },
  2: { geo: merge([box(1.9, 0.07, 0.8, WOOD, 0, 0.75, 0), box(1.9, 0.06, 0.3, WOOD, 0, 0.45, 0.65), box(1.9, 0.06, 0.3, WOOD, 0, 0.45, -0.65), box(0.08, 0.75, 1.6, DWOOD, -0.7, 0.37, 0, 0.0), box(0.08, 0.75, 1.6, DWOOD, 0.7, 0.37, 0)]), r: 1.0, h: 0.8 },
  3: { geo: merge([cyl(0.2, 0.25, 0.9, '#6b7076', 0, 0.45, 0), cyl(0.28, 0.2, 0.12, '#9aa3ab', 0, 0.95, 0)]), r: 0.3, h: 1 },
  4: { geo: merge([box(2.6, 2.6, 2.6, '#8a7f6f', 0, 1.3, 0), box(3.0, 0.2, 3.0, '#4a4f55', 0, 2.7, 0), box(0.9, 2.0, 0.05, '#2b4c7e', -0.6, 1.0, 1.31), box(0.9, 2.0, 0.05, '#7a2b2b', 0.6, 1.0, 1.31)]), r: 1.8, h: 2.8 },
  5: { geo: merge([cyl(0.06, 0.06, 0.9, METAL, 0, 0.45, 0), box(0.7, 0.25, 0.45, '#1a1a1a', 0, 0.95, 0)]), r: 0.45, h: 1.1 },
  6: { geo: merge([cyl(0.25, 0.22, 0.9, '#2f5d3a', 0, 0.45, 0), cyl(0.27, 0.27, 0.05, '#1a1a1a', 0, 0.92, 0)]), r: 0.3, h: 1 },
  7: { geo: merge([0, 1, 2, 3].map(i => box(0.06, 0.8, 0.7, '#9aa3ab', -0.9 + i * 0.6, 0.4, 0))), r: 0.0, h: 0.8 },
  8: { geo: merge([cyl(0.12, 0.15, 3.6, '#1f3a30', 0, 1.8, 0), cyl(0.38, 0.38, 0.18, '#1f3a30', 0, 3.8, 0, Math.PI / 2), cyl(0.33, 0.33, 0.2, '#f4f1e8', 0, 3.8, 0, Math.PI / 2)]), r: 0.25, h: 4 },
  10: { geo: merge([box(0.8, 1.7, 0.6, '#3d4a5a', 0, 0.85, 0), box(0.6, 0.35, 0.05, '#0d1a2a', 0, 1.35, 0.31)]), r: 0.5, h: 1.8 },
  11: { geo: merge([cyl(0.06, 0.06, 2.6, RED, -1.5, 1.2, 0.5, 0.35), cyl(0.06, 0.06, 2.6, RED, -1.5, 1.2, -0.5, -0.35), cyl(0.06, 0.06, 2.6, RED, 1.5, 1.2, 0.5, 0.35), cyl(0.06, 0.06, 2.6, RED, 1.5, 1.2, -0.5, -0.35), cyl(0.05, 0.05, 3.1, METAL, 0, 2.4, 0, 0, 0, Math.PI / 2), box(0.5, 0.05, 0.22, '#1a1a1a', -0.6, 0.5, 0), box(0.5, 0.05, 0.22, '#1a1a1a', 0.6, 0.5, 0), cyl(0.01, 0.01, 1.9, '#888', -0.6, 1.45, 0), cyl(0.01, 0.01, 1.9, '#888', 0.6, 1.45, 0)]), r: 1.6, h: 2.5 },
  12: { geo: merge([box(1.2, 0.1, 1.2, YEL, 0, 1.5, 0), ...[[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]].map(([x, z]) => cyl(0.05, 0.05, 1.5, BLU, x, 0.75, z)), box(0.6, 0.06, 2.6, RED, 0, 0.85, 1.75, 0.55), box(0.5, 1.5, 0.05, BLU, 0, 0.75, -0.65, -0.25)]), r: 1.4, h: 1.6 },
  13: { geo: merge([...[0, 1, 2].flatMap(i => [box(2.4, 0.06, 0.06, i % 2 ? YEL : RED, 0, 0.6 + i * 0.6, -1.2), box(2.4, 0.06, 0.06, i % 2 ? YEL : RED, 0, 0.6 + i * 0.6, 1.2), box(0.06, 0.06, 2.4, BLU, -1.2, 0.6 + i * 0.6, 0), box(0.06, 0.06, 2.4, BLU, 1.2, 0.6 + i * 0.6, 0)]), ...[[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]].map(([x, z]) => cyl(0.05, 0.05, 1.9, METAL, x, 0.95, z))]), r: 1.6, h: 1.9 },
  14: { geo: merge([box(3, 0.08, 3, '#e6d3a3', 0, 0.04, 0), box(3.2, 0.3, 0.15, DWOOD, 0, 0.15, 1.55), box(3.2, 0.3, 0.15, DWOOD, 0, 0.15, -1.55), box(0.15, 0.3, 3.2, DWOOD, 1.55, 0.15, 0), box(0.15, 0.3, 3.2, DWOOD, -1.55, 0.15, 0)]), r: 0, h: 0.3 },
  15: { geo: merge([box(0.2, 0.4, 0.2, METAL, 0, 0.2, 0), box(3, 0.08, 0.25, YEL, 0, 0.42, 0, 0, 0, 0.12)]), r: 0.4, h: 0.6 },
  16: { geo: merge([cyl(0.05, 0.08, 0.4, METAL, 0, 0.2, 0), box(0.25, 0.35, 0.7, GRN, 0, 0.55, 0), box(0.2, 0.25, 0.2, GRN, 0, 0.8, -0.35)]), r: 0.4, h: 0.9 },
  17: { geo: merge([box(2.2, 0.12, 2.2, BLU, 0, 1.6, 0), ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => cyl(0.07, 0.07, 3.2, YEL, x, 1.6, z)), box(2.4, 0.15, 2.4, RED, 0, 3.2, 0), box(0.7, 0.06, 2.4, RED, 0, 0.9, 2.2, 0.6), box(0.5, 1.6, 0.06, GRN, -1.2, 0.8, 0, 0, Math.PI / 2, 0.3)]), r: 1.6, h: 3.3 },
  18: { geo: merge([cyl(1.0, 1.0, 0.1, RED, 0, 0.3, 0, 0, 0, 0, 16), cyl(0.04, 0.04, 0.9, YEL, 0, 0.75, 0)]), r: 1.0, h: 1 },
  19: { geo: merge([cyl(0.06, 0.06, 2.4, METAL, -0.8, 1.2, 0), cyl(0.06, 0.06, 2.4, METAL, 0.8, 1.2, 0), cyl(0.04, 0.04, 1.6, '#9aa3ab', 0, 2.2, 0, 0, 0, Math.PI / 2), box(1.2, 0.1, 0.4, GRN, 0, 0.5, 0.6)]), r: 0.9, h: 2.4 },
  20: { geo: merge([box(0.08, 1.6, 0.08, DWOOD, -0.6, 0.8, 0), box(0.08, 1.6, 0.08, DWOOD, 0.6, 0.8, 0), box(1.4, 0.95, 0.08, '#2f5d3a', 0, 1.55, 0), box(1.3, 0.85, 0.02, '#e9e1c9', 0, 1.55, 0.05)]), r: 0.7, h: 2 },
  21: { geo: merge([box(3.5, 0.15, 2.4, '#5a4a3a', 0, 2.6, 0, 0.1), ...[[-1.6, -1.1], [1.6, -1.1], [-1.6, 1.1], [1.6, 1.1]].map(([x, z]) => box(0.12, 2.6, 0.12, DWOOD, x, 1.3, z))]), r: 0.3, h: 2.7 },
};
// flagpole (9) is drawn separately so the flag can wave
const flagTex = canvasTex(256, 128, (c, w, h) => {
  c.fillStyle = '#d52b1e'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffffff'; c.fillRect(w / 4, 0, w / 2, h);
  // maple leaf (simplified)
  c.fillStyle = '#d52b1e'; c.beginPath(); const cx = w / 2, cy = h / 2 + 4, s = 1.6;
  const pts = [[0, -34], [6, -22], [14, -26], [10, -6], [22, -14], [20, -8], [30, -10], [26, 0], [32, 4], [12, 14], [14, 22], [2, 18], [2, 34], [-2, 34], [-2, 18], [-14, 22], [-12, 14], [-32, 4], [-26, 0], [-30, -10], [-20, -8], [-22, -14], [-10, -6], [-14, -26], [-6, -22]];
  pts.forEach(([x, y], i) => (i ? c.lineTo : c.moveTo).call(c, cx + x * s * 0.5, cy + y * s * 0.5)); c.closePath(); c.fill();
}, false);
const flagMat = new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.8 });

const instanced = {}, CAP = 2500;
for (const k of Object.keys(FMODEL)) { const im = new THREE.InstancedMesh(FMODEL[k].geo, VC, CAP); im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true; scene.add(im); instanced[k] = im; }
const poleIM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.08, 9, 6).translate(0, 4.5, 0), std('#cfd4d8', { metalness: 0.8, roughness: 0.3 }), 300); poleIM.count = 0; poleIM.frustumCulled = false; scene.add(poleIM);
const flags = []; for (let i = 0; i < 40; i++) { const f = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.9, 8, 1).translate(0.9, 0, 0), flagMat); f.visible = false; scene.add(f); flags.push(f); }

// ---------- flowers, gardens, community-garden plots, soccer goals (static, chunked) ----------
const FLOWER_COLS = { spring: ['#f6e05e', '#f56565', '#ed64a6', '#ffffff', '#9f7aea', '#fbd38d'], summer: ['#e53e3e', '#f6ad55', '#ecc94b', '#ed64a6', '#805ad5', '#ffffff', '#4299e1'], fall: ['#dd6b20', '#c05621', '#d69e2e', '#9b2c2c', '#b7791f'], winter: ['#4a5568', '#2d3748', '#718096'] };
const flowerChunks = [];
function buildFlowers() {
  const byChunk = new Map(), add = (x, z, kind) => { const k = Math.floor(x / 400) + ',' + Math.floor(z / 400); let a = byChunk.get(k); if (!a) byChunk.set(k, a = []); a.push([x, z, kind]); };
  for (const a of M.areas) {
    if (a.line) continue;
    const flower = a.k === 'flower', garden = a.g, allot = a.k === 'allot'; if (!flower && !garden && !allot) continue;
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let i = 0; i < a.p.length; i += 2) { x0 = Math.min(x0, a.p[i]); x1 = Math.max(x1, a.p[i]); z0 = Math.min(z0, a.p[i + 1]); z1 = Math.max(z1, a.p[i + 1]); }
    if ((x1 - x0) * (z1 - z0) > 400000) continue;
    if (flower) { for (let x = x0; x < x1; x += 1.1) for (let z = z0; z < z1; z += 1.1) if (inPoly(x, z, a.p)) add(x + (hash2(x, z) - 0.5) * 0.6, z + (hash2(z, x) - 0.5) * 0.6, 0); }
    else if (garden) {   // flower borders along the edge + scattered shrubs
      for (let i = 0; i < a.p.length; i += 2) { const j = (i + 2) % a.p.length, ax = a.p[i], az = a.p[i + 1], dx = a.p[j] - ax, dz = a.p[j + 1] - az, L = Math.hypot(dx, dz); for (let s = 0; s < L; s += 1.3) { const nx = -dz / L, nz = dx / L, px = ax + dx * s / L, pz = az + dz * s / L; for (const o of [1.2, -1.2]) if (inPoly(px + nx * o, pz + nz * o, a.p)) { add(px + nx * o, pz + nz * o, 0); break; } } }
      for (let x = x0; x < x1; x += 7) for (let z = z0; z < z1; z += 7) if (hash2(x, z) < 0.35 && inPoly(x, z, a.p)) add(x, z, 1);
    } else {   // community garden: rows of raised beds
      for (let x = x0 + 1.5; x < x1 - 1.5; x += 3.2) for (let z = z0 + 1.5; z < z1 - 1.5; z += 5.5) if (inPoly(x, z, a.p) && inPoly(x + 1.2, z + 2, a.p)) add(x, z, 2);
    }
  }
  // soccer goals at both ends of big rectangular fields
  for (const a of M.areas) {
    if (a.k !== 'pitch' || a.line || a.p.length < 8 || a.p.length > 14) continue;
    let bestL = 0, ux = 1, uz = 0; for (let i = 0; i < a.p.length; i += 2) { const j = (i + 2) % a.p.length, dx = a.p[j] - a.p[i], dz = a.p[j + 1] - a.p[i + 1], L = Math.hypot(dx, dz); if (L > bestL) { bestL = L; ux = dx / L; uz = dz / L; } }
    if (bestL < 45 || bestL > 130) continue;
    let cx = 0, cz = 0, n = a.p.length / 2; for (let i = 0; i < a.p.length; i += 2) { cx += a.p[i]; cz += a.p[i + 1]; } cx /= n; cz /= n;
    for (const s of [-1, 1]) add(cx + ux * s * (bestL / 2 - 2), cz + uz * s * (bestL / 2 - 2), s > 0 ? 3 : 4);
    flowerChunks.goalYaw = flowerChunks.goalYaw || new Map(); flowerChunks.goalYaw.set(Math.round(cx) + ',' + Math.round(cz), Math.atan2(ux, uz));
  }
  const flowerGeo = new THREE.IcosahedronGeometry(0.28, 0).scale(1, 0.7, 1).translate(0, 0.25, 0), shrubGeo = new THREE.IcosahedronGeometry(0.8, 0).scale(1, 0.8, 1).translate(0, 0.6, 0);
  const bedGeo = merge([box(1.4, 0.35, 4, DWOOD, 0, 0.17, 0), box(1.25, 0.25, 3.8, '#3f6b33', 0, 0.42, 0)]);
  const goalGeo = merge([cyl(0.06, 0.06, 2.4, '#ffffff', -3.6, 1.2, 0), cyl(0.06, 0.06, 2.4, '#ffffff', 3.6, 1.2, 0), cyl(0.06, 0.06, 7.3, '#ffffff', 0, 2.4, 0, 0, 0, Math.PI / 2), box(7.3, 2.4, 0.02, '#d8dde2', 0, 1.2, 1.4)]);
  const flowerMat = new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true, envMapIntensity: 0.4 }), shrubMat = new THREE.MeshStandardMaterial({ color: '#2f6a2c', roughness: 0.95, flatShading: true, envMapIntensity: 0.25 });
  const o = new THREE.Object3D(), col = new THREE.Color();
  for (const [key, items] of byChunk) {
    const grp = new THREE.Group(), [ci, cj] = key.split(',').map(Number); grp.userData.cx = (ci + 0.5) * 400; grp.userData.cz = (cj + 0.5) * 400;
    for (const [kind, geo, mat] of [[0, flowerGeo, flowerMat], [1, shrubGeo, shrubMat], [2, bedGeo, VC], [3, goalGeo, VC], [4, goalGeo, VC]]) {
      const sub = items.filter(t => t[2] === kind); if (!sub.length) continue;
      const m = new THREE.InstancedMesh(geo, mat, sub.length);
      sub.forEach(([x, z], i) => {
        const yaw = kind >= 3 ? (flowerChunks.goalYaw?.get([...flowerChunks.goalYaw.keys()].find(k => { const [a, b] = k.split(',').map(Number); return Math.hypot(a - x, b - z) < 70; })) || 0) + (kind === 4 ? Math.PI : 0) + Math.PI / 2 : hash2(x, z) * 6;
        o.position.set(x, surfaceY(x, z), z); o.rotation.set(0, yaw, 0); const s = kind === 0 ? 0.8 + hash2(z, x) * 0.6 : 1; o.scale.set(s, s, s); o.updateMatrix(); m.setMatrixAt(i, o.matrix);
        if (kind === 0) m.setColorAt(i, col.set('#ffffff'));
      });
      if (kind === 0) m.userData.flowers = sub;
      m.castShadow = kind > 0; m.receiveShadow = true; m.computeBoundingSphere(); grp.add(m);
    }
    scene.add(grp); flowerChunks.push(grp);
  }
  recolorFlowers();
}
let flowerSeason = null;
function recolorFlowers() {
  flowerSeason = G.season; const cols = FLOWER_COLS[G.season] || FLOWER_COLS.summer, c = new THREE.Color();
  for (const grp of flowerChunks) for (const m of grp.children) if (m.userData.flowers) { m.userData.flowers.forEach(([x, z], i) => m.setColorAt(i, c.set(cols[Math.floor(hash2(x * 3.1, z * 1.7) * cols.length) % cols.length]))); if (m.instanceColor) m.instanceColor.needsUpdate = true; }
}

// ---------- steeples, domes, pagoda roofs, minarets on places of worship ----------
function worshipTop(p) {
  const b = buildingAt(p.x, p.z) || nearBuildings(p.x, p.z, 15).sort((a, c) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(c.x - p.x, c.z - p.z))[0]; if (!b) return null;
  const rel = (p.s || '').split(';')[0], y = b.top, P = [];
  if (rel === 'muslim') P.push(cyl(3, 3, 1.2, '#e9e4d8', 0, 0.6, 0, 0, 0, 0, 16), part(new THREE.SphereGeometry(3, 16, 10, 0, 6.29, 0, Math.PI / 2), '#2f855a', 0, 1.2, 0), cyl(0.6, 0.6, 12, '#e9e4d8', 6, 6, 0), part(new THREE.ConeGeometry(0.7, 2, 8), '#2f855a', 6, 13, 0));
  else if (rel === 'sikh') P.push(cyl(2.4, 2.4, 1, '#f4f1e8', 0, 0.5, 0, 0, 0, 0, 16), part(new THREE.SphereGeometry(2.6, 16, 10, 0, 6.29, 0, Math.PI * 0.6), '#d4af37', 0, 1.6, 0), cyl(0.08, 0.08, 2, '#d4af37', 0, 4.5, 0));
  else if (rel === 'buddhist' || rel === 'taoist') for (let i = 0; i < 3; i++) P.push(part(new THREE.ConeGeometry(5 - i * 1.3, 1.6, 4), i % 2 ? '#c53030' : '#2f4f4f', 0, 0.8 + i * 1.8, 0, 0, Math.PI / 4, 0), box(2.6 - i * 0.6, 1, 2.6 - i * 0.6, '#c53030', 0, 1.7 + i * 1.8, 0));
  else if (rel === 'hindu') for (let i = 0; i < 4; i++) P.push(box(5 - i * 1.1, 1.5, 5 - i * 1.1, i % 2 ? '#f6ad55' : '#f4f1e8', 0, 0.75 + i * 1.5, 0));
  else if (rel === 'jewish') P.push(box(2.6, 2.6, 0.2, '#2b4c7e', 0, 1.3, 0), part(new THREE.TorusGeometry(0.9, 0.08, 6, 6), '#d4af37', 0, 1.3, 0.15));
  else P.push(box(3, 6, 3, '#d9d5cc', 0, 3, 0), part(new THREE.ConeGeometry(2.3, 9, 4), '#4a5568', 0, 10.5, 0, 0, Math.PI / 4, 0), box(0.2, 2.2, 0.2, '#d4af37', 0, 16, 0), box(1.1, 0.2, 0.2, '#d4af37', 0, 16.5, 0));   // church steeple + cross
  const m = new THREE.Mesh(merge(P), VC); m.position.set(b.x, y - 0.2, b.z); m.castShadow = true; return m;
}

// ---------- updating near the player ----------
let fx = 1e9, fz = 1e9; const flagList = [];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();
function rebuildFurniture(px, pz) {
  fx = px; fz = pz; const n = {}; flagList.length = 0; let poles = 0;
  for (let i = 0; i < FURN.length; i += 3) {
    const code = FURN[i], x = FURN[i + 1], z = FURN[i + 2]; if (Math.abs(x - px) > 450 || Math.abs(z - pz) > 450) continue;
    const y = surfaceY(x, z);
    if (code === 9) { if (poles < 300) { _p.set(x, y, z); _q.identity(); _m.compose(_p, _q, _s); poleIM.setMatrixAt(poles++, _m); flagList.push({ x, y: y + 8.4, z, ph: hash2(x, z) * 6 }); } continue; }
    const im = instanced[code]; if (!im) continue; const k = n[code] || 0; if (k >= CAP) continue;
    _e.set(0, hash2(x * 1.3, z) * 6.28, 0); _q.setFromEuler(_e); _p.set(x, y, z); _m.compose(_p, _q, _s); im.setMatrixAt(k, _m); n[code] = k + 1;
  }
  const cl = [];
  for (const k of Object.keys(instanced)) { const im = instanced[k]; im.count = n[k] || 0; im.instanceMatrix.needsUpdate = true; if (FMODEL[k].r > 0) fromInstances(im, FMODEL[k].r, FMODEL[k].h, cl); }
  poleIM.count = poles; poleIM.instanceMatrix.needsUpdate = true; fromInstances(poleIM, 0.12, 9, cl, { brk: 10, kind: 'tip' });
  setColliders('furniture', cl);
}
const built = new Map();   // art record -> mesh
const worship = new Map();
let artT = 0;
function updateArt(px, pz) {
  artT -= G.dt; if (artT > 0) return; artT = 0.8;
  for (const a of ART) {
    const d = Math.max(Math.abs(a.x - px), Math.abs(a.z - pz)), have = built.get(a);
    if (d < 450 && have === undefined) { const m = landmarkHere(a) ? null : buildArt(a); if (m) scene.add(m); built.set(a, m || null); }
    else if (d > 560 && have !== undefined) { if (have) { scene.remove(have); have.traverse?.(o => o.geometry?.dispose()); } built.delete(a); }
  }
  for (const p of pois) {
    if (p.k !== 'place_of_worship') continue;
    const d = Math.max(Math.abs(p.x - px), Math.abs(p.z - pz)), have = worship.get(p);
    if (d < 900 && have === undefined) { const m = worshipTop(p); if (m) scene.add(m); worship.set(p, m || null); }
    else if (d > 1100 && have !== undefined) { if (have) scene.remove(have); worship.delete(p); }
  }
  // art you can walk into is solid (statues, sculptures, totems, fountains)
  const cl = []; for (const [a, m] of built) if (m && !m.userData.wall && m.userData.r > 0) { if (m.userData.top === undefined) { const bb = new THREE.Box3().setFromObject(m.children[0] || m); m.userData.top = isFinite(bb.max.y) ? bb.max.y : surfaceY(a.x, a.z) + 3; } cl.push({ x: a.x, z: a.z, r: Math.min(3.5, m.userData.r * 0.8), top: m.userData.top }); } setColliders('art', cl);   // you can climb onto a statue's base or a big sculpture
}
// famous pieces that landmarks.js already builds by hand: don't draw a second, generic one on top
const LANDMARK_ART = { orca: 30, drop: 30, inukshuk: 30, laughter: 40, wetsuit: 30, gate: 35, totems: 45, ninegun: 25, steamclock: 20, gassyjack: 20, cauldron: 35, eastvan: 30, giants: 25, dude: 25, sunyatsen: 40, woodwards: 30, hollowtree: 25, siwash: 40, bloedel: 30 };
function landmarkHere(a) {
  if (Math.hypot(a.x - QE_FOUNTAIN.x, a.z - QE_FOUNTAIN.z) < 10) return true;   // qepark.js builds the Dancing Waters
  for (const id in LANDMARK_ART) { const s = SPOTS[id]; if (s && Math.hypot(a.x - s.x, a.z - s.z) < LANDMARK_ART[id]) return true; }
  return false;
}
// walk up to a piece and its story pops up by itself (once per piece per visit) — no button needed
const ABOUT = {
  sculpture: ['Big new buildings in Vancouver must put money into public art: that is why sculptures pop up in plazas all over town.', 'Many of the city\'s sculptures came from the Vancouver Biennale, which left art all along the seawall.'],
  statue: ['Bronze goes green over time: copper reacting with rain. In Vancouver there is a LOT of rain.'],
  bust: ['A bust shows only the head and shoulders: cheaper than a statue, and less for the pigeons to sit on.'],
  mural: ['The Vancouver Mural Festival has painted hundreds of walls since 2016, mostly around Mount Pleasant and Strathcona.'],
  installation: ['An installation is art you walk around or through. It changes as you move.'],
  totem_pole: ['Totem poles are carved from western red cedar; each figure is a crest that tells a family\'s story.'],
  fountain: ['Most city fountains recycle their water. Please do not wash your feet in it (people do).'],
};
const HIST = ['Vancouver was incorporated in 1886 and almost all of it burned down that same year. Its history is young, but it is everywhere.', 'This is the unceded land of the Musqueam, Squamish and Tsleil-Waututh Nations, who have lived here for thousands of years.'];
const shown = new Set(); let infoT = 0;
export function detailsPrompt(pl) {
  infoT -= G.dt || 0; if (pl.vehicle && pl.vehicle.speedAbs > 6) return ''; if (infoT > 0) return '';
  for (const [a, m] of built) {
    if (!m || shown.has(a)) continue;
    const reach = (m.userData.r || 1) + 5; if (Math.abs(a.x - pl.x) > reach || Math.abs(a.z - pl.z) > reach || Math.hypot(a.x - pl.x, a.z - pl.z) > reach) continue;
    shown.add(a); infoT = 4;
    const name = a.n >= 0 ? M.names[a.n] : '', kind = kindName(a), hist = a.t.startsWith('h_'), fact = famousFact(a) || pick(hist ? HIST : ABOUT[a.t] || ABOUT.sculpture);
    pl.stats = pl.stats || {}; const seen = (pl.stats.artSeen = pl.stats.artSeen || []), key = Math.round(a.x) + ',' + Math.round(a.z), first = !seen.includes(key);
    let extra = ''; if (first) { seen.push(key); if (seen.length % 10 === 0) { pl.money += 25; pl.karma += 1; extra = ` 🏅 Art Walk: ${seen.length} pieces seen! A gallery owner tips you $25.`; } }
    ui.toast(`${hist ? '📜' : '🎨'} ${name || kind}`, (name ? kind + ' · ' : '') + fact + extra, 6000);
    break;
  }
  return '';
}
export function artCamera() {}   // (the old press-E camera; nothing to do now)
export function initDetails() { buildFlowers(); }
export function updateDetails(pl) {
  if (Math.abs(pl.x - fx) > 120 || Math.abs(pl.z - fz) > 120) rebuildFurniture(pl.x, pl.z);
  updateArt(pl.x, pl.z);
  if (G.season !== flowerSeason) recolorFlowers();
  for (const c of flowerChunks) c.visible = Math.abs(c.userData.cx - pl.x) < 900 && Math.abs(c.userData.cz - pl.z) < 900;
  // waving flags on the nearest flagpoles, bubbling fountains
  const near = flagList.map(f => [Math.hypot(f.x - pl.x, f.z - pl.z), f]).sort((a, b) => a[0] - b[0]);
  flags.forEach((m, i) => { const f = near[i]?.[1]; if (!f || near[i][0] > 300) { m.visible = false; return; } m.visible = true; m.position.set(f.x, f.y, f.z); m.rotation.set(0, 0.6 + Math.sin(G.t * 0.7 + f.ph) * 0.4, 0);
    const pos = m.geometry.attributes.position; for (let k = 0; k < pos.count; k++) { const x = pos.getX(k); pos.setZ(k, Math.sin(x * 2.6 - G.t * 6 + f.ph) * 0.12 * x); } pos.needsUpdate = true; });
  for (const [a, m] of built) if (m?.userData?.jet) m.userData.jet.scale.y = 0.9 + Math.sin(G.t * 9 + a.x) * 0.1;
}
