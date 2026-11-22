// Seasonal fun under the street trees (near you only):
//  - Fall: crunchy leaf piles under the leafy street and yard trees. Run, bike or drive through one and it bursts into a
//    cloud of red/orange/yellow leaves (secret 'leafpile'). Piles come back once you've moved on.
//  - Spring: a carpet of pink petals on the grass under every blossoming cherry tree.
import * as THREE from 'three';
import { G, scene, hash2, depthBias, canvasTex } from './core.js';
import { treeChunks, groundY, heightAt, cherryTrees } from './terrain.js';
import { walkY, nearestRoad, buildingAt } from './city.js';
import { swish } from './sound.js';
import { discover } from './missions.js';
import { ui } from './ui.js';

const PILES = 36, CARPETS = 80, BITS = 260, LOOSE = 14;   // LOOSE = fallen leaves lying around each pile
const gy = (x, z) => { const g = groundY(x, z); return Number.isFinite(g) ? Math.max(g, walkY(x, z)) : heightAt(x, z); };
const FALLC = ['#b83224', '#d9622b', '#e8a42c', '#c7471f', '#9c3b1c', '#d8b23a', '#a8572a'].map(c => new THREE.Color(c));
const _o = new THREE.Object3D(), _c = new THREE.Color();
let pileIM = null, carpetIM = null, bitIM = null, looseIM = null, at = null, season = null, told = false;
const piles = [], bits = [];

function pileGeo() {   // a lumpy low mound of leaves, each vertex its own fall colour
  const g = new THREE.SphereGeometry(1, 22, 8, 0, Math.PI * 2, 0, Math.PI / 2), p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {   // (a shared seam vertex must move the same way, so the noise uses the rounded position)
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), kx = Math.round(x * 40), kz = Math.round(z * 40), ky = Math.round(y * 40);
    const n = 0.72 + 0.5 * hash2(kx * 0.37 + ky, kz * 0.41 - ky);
    p.setXYZ(i, x * n, y * (0.55 + 0.9 * hash2(kz * 0.53, kx * 0.29 + ky)), z * n);
    const c = FALLC[Math.floor(hash2(kx * 1.3 + ky, kz * 1.1) * FALLC.length) % FALLC.length], sh = 0.75 + 0.35 * hash2(kz, kx); col[i * 3] = c.r * sh; col[i * 3 + 1] = c.g * sh; col[i * 3 + 2] = c.b * sh;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
}
function init() {
  pileIM = new THREE.InstancedMesh(pileGeo(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), PILES);
  pileIM.count = 0; pileIM.castShadow = pileIM.receiveShadow = true; pileIM.frustumCulled = false; scene.add(pileIM);
  const petals = canvasTex(256, 256, (c, W) => {   // scattered petals, thicker in the middle, fading out at the edge
    for (let i = 0; i < 1100; i++) { const a = Math.random() * 6.283, r = Math.pow(Math.random(), 0.7) * W * 0.48, x = W / 2 + Math.cos(a) * r, y = W / 2 + Math.sin(a) * r;
      c.fillStyle = `hsla(${338 + Math.random() * 16}, ${80 + Math.random() * 20}%, ${70 + Math.random() * 14}%, ${0.95 * Math.pow(1 - r / (W * 0.48), 0.6)})`; c.beginPath(); c.ellipse(x, y, 2.6, 1.7, Math.random() * 3, 0, 6.283); c.fill(); } }, false);
  const carpetM = new THREE.MeshStandardMaterial({ map: petals, transparent: true, alphaTest: 0.05, depthWrite: false, roughness: 0.9 }); depthBias(carpetM, 0.0004);   // (depthBias returns nothing)
  carpetIM = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), carpetM, CARPETS);
  carpetIM.count = 0; carpetIM.receiveShadow = true; carpetIM.frustumCulled = false; scene.add(carpetIM);
  bitIM = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.13, 0.09), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 }), BITS);
  bitIM.count = 0; bitIM.frustumCulled = false; bitIM.setColorAt(0, _c.set('#fff')); scene.add(bitIM);
  const looseM = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.85 }); depthBias(looseM, 0.0003);
  looseIM = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.16, 0.11).rotateX(-Math.PI / 2), looseM, PILES * LOOSE);
  looseIM.count = 0; looseIM.frustumCulled = false; looseIM.setColorAt(0, _c.set('#fff')); scene.add(looseIM);
}
const offStreet = (x, z) => { const r = nearestRoad(x, z, 14, rd => rd.t <= 6); return !r || r.d > r.road.w / 2 + 1.6; };
function nearTrees(px, pz, R, kinds) {   // leafy trees around you, from the city tree chunks
  const out = [];
  for (const grp of treeChunks) { if (Math.abs(grp.userData.cx - px) > R + 300 || Math.abs(grp.userData.cz - pz) > R + 300) continue;
    for (const m of grp.children) { if (!m.userData.crown || !kinds.has(m.userData.k)) continue;
      for (const t of m.userData.items) if (Math.abs(t.x - px) < R && Math.abs(t.z - pz) < R) out.push(t); } }
  return out;
}
const LEAFY = new Set([1, 3, 4, 5]);
function rebuild(px, pz) {
  at = [px, pz]; season = G.season;
  // fall leaf piles (under about 1 in 3 leafy trees, nearest first)
  piles.length = 0;
  if (season === 'fall') {
    const ts = nearTrees(px, pz, 150, LEAFY).filter(t => hash2(t.x * 0.7, t.z * 0.3) < 0.36).sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz));
    for (const t of ts) { if (piles.length >= PILES) break;
      const a = hash2(t.z, t.x) * 6.283, d = 1.2 + t.s * 0.35, x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
      if (!offStreet(x, z) || buildingAt(x, z)) continue;
      piles.push({ x, z, y: gy(x, z), r: 0.9 + hash2(x, z) * 0.6, yaw: a, gone: false }); }
  }
  // spring petal carpets under the cherries
  let n = 0;
  if (season === 'spring') for (const t of cherryTrees) { if (n >= CARPETS) break; if (Math.abs(t.x - px) > 160 || Math.abs(t.z - pz) > 160) continue;
    const r = t.s * 1.25, y = gy(t.x, t.z) + 0.05; _o.position.set(t.x, y, t.z); _o.rotation.set(0, hash2(t.x, t.z) * 6.283, 0); _o.scale.set(r, 1, r); _o.updateMatrix(); carpetIM.setMatrixAt(n++, _o.matrix); }
  carpetIM.count = n; carpetIM.instanceMatrix.needsUpdate = true;
  drawPiles();
}
function drawPiles() {
  let n = 0, m = 0;
  for (const p of piles) { if (p.gone) continue; _o.position.set(p.x, p.y - 0.05, p.z); _o.rotation.set(0, p.yaw, 0); _o.scale.set(p.r, p.r * 0.42, p.r * 0.9); _o.updateMatrix(); pileIM.setMatrixAt(n++, _o.matrix);
    for (let k = 0; k < LOOSE; k++) {   // stray leaves blown off the pile
      const a = hash2(p.x + k, p.z) * 6.283, d = p.r * (1.0 + hash2(p.z, p.x + k) * 1.1), x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      _o.position.set(x, gy(x, z) + 0.02, z); _o.rotation.set((hash2(k, p.x) - 0.5) * 0.4, a * 3, 0); _o.scale.setScalar(0.8 + hash2(p.x, k) * 0.6); _o.updateMatrix();
      looseIM.setMatrixAt(m, _o.matrix); looseIM.setColorAt(m, FALLC[Math.floor(hash2(p.x + k * 3.1, p.z - k) * FALLC.length) % FALLC.length]); m++; } }   // (x can be negative: never index with x itself)
  pileIM.count = n; pileIM.instanceMatrix.needsUpdate = true;
  looseIM.count = m; looseIM.instanceMatrix.needsUpdate = true; if (looseIM.instanceColor) looseIM.instanceColor.needsUpdate = true;
}
function burst(p, speed) {
  p.gone = true; drawPiles();
  const k = Math.min(70, 30 + speed * 3);
  for (let i = 0; i < k; i++) {
    if (bits.length >= BITS) bits.shift();
    const a = Math.random() * 6.283, s = 1.5 + Math.random() * 2.5 + speed * 0.15;
    bits.push({ x: p.x + (Math.random() - 0.5) * p.r, y: p.y + 0.3, z: p.z + (Math.random() - 0.5) * p.r, vx: Math.cos(a) * s, vy: 3 + Math.random() * 4 + speed * 0.12, vz: Math.sin(a) * s, rx: Math.random() * 6, ry: Math.random() * 6, sp: 3 + Math.random() * 6, life: 4 + Math.random() * 3, gy: p.y, col: FALLC[i % FALLC.length] });
  }
  swish(0.6, 0.05, 1800, 0.02);
  if (!told) { told = true; ui.toast('🍂 CRUNCH!', 'You ploughed straight through a leaf pile. Somewhere, a neighbour with a rake is sighing.', 3500); }
  discover('leafpile');
}
function updateBits(dt) {
  let n = 0;
  for (let i = bits.length - 1; i >= 0; i--) {
    const b = bits[i]; b.life -= dt; if (b.life <= 0) { bits.splice(i, 1); continue; }
    if (b.y > b.gy + 0.03) { b.vy -= 4.5 * dt; b.vx *= 1 - dt * 1.4; b.vz *= 1 - dt * 1.4; if (b.vy < -1.2) b.vy = -1.2;   // leaves flutter, they don't drop like stones
      b.x += (b.vx + Math.sin(b.life * b.sp) * 0.6) * dt; b.y += b.vy * dt; b.z += b.vz * dt; b.rx += dt * b.sp; b.ry += dt * b.sp * 0.7; if (b.y < b.gy + 0.03) { b.y = b.gy + 0.03; b.rx = Math.PI / 2; } }
  }
  for (const b of bits) { _o.position.set(b.x, b.y, b.z); _o.rotation.set(b.rx, b.ry, 0); _o.scale.setScalar(1); _o.updateMatrix(); bitIM.setMatrixAt(n, _o.matrix); bitIM.setColorAt(n, b.col); n++; }
  bitIM.count = n; bitIM.instanceMatrix.needsUpdate = true; if (bitIM.instanceColor) bitIM.instanceColor.needsUpdate = true;
}
export function updateTreeSeason(dt, player) {
  if (!pileIM) init();
  const px = player.x, pz = player.z;
  if (!at || season !== G.season || Math.hypot(px - at[0], pz - at[1]) > 60) rebuild(px, pz);
  const v = player.vehicle, speed = v ? Math.abs(v.speed || 0) : player.running ? 6 : 0, py = v ? v.y : player.y;
  if (speed > 2.5) for (const p of piles) if (!p.gone && Math.hypot(p.x - px, p.z - pz) < p.r + (v ? 1.2 : 0.4) && Math.abs(py - p.y) < 2) burst(p, speed);
  updateBits(dt);
}
export const _treeSeason = { piles, bits, rebuild: () => { at = null; }, burst };
