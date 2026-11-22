// Scenery: the little shapes that make streets and shores feel real, built in 300 m chunks around you.
//  - hedges and garden shrubs around houses (rhododendrons and azaleas flower pink/red in spring,
//    hydrangeas go blue/pink in summer, everything turns brown-green in winter)
//  - bushes scattered along the edges of parks and lawns
//  - driftwood logs on the beaches (very Vancouver: people sit on them, lean on them, picnic between them)
//  - boulders and rocky shore along the water, and on the mountainsides
//  - at night, raccoon families out on their rounds (and a coyote, if you're lucky)
import * as THREE from 'three';
import { G, scene, hash2, inPoly, R } from './core.js';
import { heightAt, isWater, waterLevel, maskAt, TREE_MATS, FOLIAGE } from './terrain.js';
import { shrubGeo, detailMat, DETAIL } from './trees.js';
import { surfaceY, buildingAt, nearestRoad } from './city.js';
import { setColliders } from './colliders.js';
import { ui } from './ui.js';
import { discover } from './missions.js';
import { softSpot } from './journal.js';

const M = window.MAP, CH = 300;
// ---------- indexes: houses and areas by chunk ----------
const houseBy = new Map(), areaBy = new Map();
const key = (x, z) => Math.floor(x / CH) + ',' + Math.floor(z / CH);
function push(map, k, v) { let a = map.get(k); if (!a) map.set(k, a = []); a.push(v); }
for (const b of M.blds) {
  const p = b.p; let ar = 0, cx = 0, cz = 0; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) { ar += (p[j] - p[i]) * (p[j + 1] + p[i + 1]); cx += p[i]; cz += p[i + 1]; }
  ar = Math.abs(ar / 2); cx /= p.length / 2; cz /= p.length / 2;
  if ((b.t === 1 || (b.t === 0 && ar < 260)) && ar > 40 && ar < 600) push(houseBy, key(cx, cz), { p, cx, cz, ar });
}
for (const a of M.areas) {
  if (a.line || !['park', 'grass', 'beach', 'cemetery', 'golf', 'rock'].includes(a.k)) continue;
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let i = 0; i < a.p.length; i += 2) { x0 = Math.min(x0, a.p[i]); x1 = Math.max(x1, a.p[i]); z0 = Math.min(z0, a.p[i + 1]); z1 = Math.max(z1, a.p[i + 1]); }
  const r = { a, x0, z0, x1, z1 };
  for (let i = Math.floor(x0 / CH); i <= Math.floor(x1 / CH); i++) for (let j = Math.floor(z0 / CH); j <= Math.floor(z1 / CH); j++) push(areaBy, i + ',' + j, r);
}

// ---------- shapes ----------
const hedgeGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const bushGeo = shrubGeo(61);   // leaf-cluster cards around a shady core (trees.js), drawn with the tree foliage material
const bloomGeo = new THREE.IcosahedronGeometry(0.16, 0);
const logGeo = (() => { const g = new THREE.CylinderGeometry(1, 1.1, 1, 9, 1); g.rotateZ(Math.PI / 2); const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + 1); return g; })();
const rockGeo = (() => { const g = new THREE.DodecahedronGeometry(1, 1); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.75 + hash2(Math.round(x * 7 + 3), Math.round(y * 7 + z * 3)) * 0.45; p.setXYZ(i, x * k, Math.max(-0.3, y * k * 0.7), z * k); } g.computeVertexNormals(); return g; })();
const leafMat = detailMat(new THREE.MeshLambertMaterial(), DETAIL.leaves, 0.9, 0.85, 'hedge');   // clipped hedges: little leaves all over (world-space texture)
const bloomMat = new THREE.MeshStandardMaterial({ roughness: 0.7, envMapIntensity: 0.4 });
const woodMat = detailMat(new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1 }), DETAIL.rock, 0.5, 0.6, 'driftwood');   // weathered, cracked driftwood (colour per log)
const rockMat = detailMat(new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), DETAIL.rock, 0.35, 0.8, 'rock');   // cracks, lichen and moss

function seasonLeaf(h, c) {
  const s = G.season || 'summer';
  if (s === 'winter') return c.setHSL(0.22 + h * 0.06, 0.25, 0.2 + h * 0.06);
  if (s === 'fall') return h < 0.35 ? c.setHSL(0.05 + h * 0.1, 0.6, 0.32) : c.setHSL(0.25 + h * 0.06, 0.4, 0.22 + h * 0.05);
  return c.setHSL(0.24 + h * 0.11, 0.5 + h * 0.2, 0.19 + h * 0.1);   // rich greens: boxwood, laurel, rhododendron, lime-green spirea
}
const BLOOM = { spring: ['#e84a8a', '#f06292', '#d81b60', '#ff8a80', '#ffffff', '#ce93d8'], summer: ['#5c8de0', '#7aa7f0', '#e07ab8', '#b388ff', '#ffffff'], fall: [], winter: [] };

// ---------- chunk building ----------
const chunks = new Map();
const o = new THREE.Object3D(), col = new THREE.Color();
function roadNear(x, z, pad) { const r = nearestRoad(x, z, 14); return r && r.d < r.road.w / 2 + pad; }
function buildChunk(ci, cj) {
  const k = ci + ',' + cj, x0 = ci * CH, z0 = cj * CH, H = [], B = [], L = [], K = [], F = [];
  // hedges + shrubs around houses
  for (const h of houseBy.get(k) || []) {
    const p = h.p, n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = p[i * 2], az = p[i * 2 + 1], dx = p[j * 2] - ax, dz = p[j * 2 + 1] - az, Ln = Math.hypot(dx, dz); if (Ln < 4) continue;
      let nx = -dz / Ln, nz = dx / Ln; const mx = ax + dx / 2, mz = az + dz / 2; if (inPoly(mx + nx * 0.6, mz + nz * 0.6, p)) { nx = -nx; nz = -nz; }
      const r = hash2(mx * 1.3, mz * 0.7);
      if (r < 0.22 && Ln > 6) {   // a hedge along this side
        const off = 2.2 + hash2(mz, mx) * 1.5, hx = mx + nx * off, hz = mz + nz * off;
        if (!roadNear(hx, hz, 1.2) && !buildingAt(hx, hz)) H.push([hx, hz, Math.atan2(dx, dz), Ln * (0.7 + r), 1.3 + hash2(hx, hz) * 1.1]);
      }
      if (r > 0.55) {   // shrubs by the wall
        for (let s = 0.2; s < 0.9; s += 0.35) { const bx = ax + dx * s + nx * 1.1, bz = az + dz * s + nz * 1.1; if (hash2(bx, bz) < 0.55 && !roadNear(bx, bz, 0.8) && !buildingAt(bx, bz)) B.push([bx, bz, 0.5 + hash2(bz, bx) * 0.6]); }
      }
    }
  }
  // parks and lawns: bushes along the edges; beaches: driftwood; rocky areas: boulders
  for (const { a, x0: ax0, z0: az0, x1: ax1, z1: az1 } of areaBy.get(k) || []) {
    const px0 = Math.max(ax0, x0), px1 = Math.min(ax1, x0 + CH), pz0 = Math.max(az0, z0), pz1 = Math.min(az1, z0 + CH);
    if (a.k === 'beach') {
      // Vancouver's beach logs lie in long ROWS parallel to the water (the Park Board lines them up as seats and windbreaks).
      // Beach outlines don't follow the waterline, so: a 2 m distance-to-water map over this chunk (chamfer transform),
      // then logs laid greedily in bands 9 / 13.5 / 18 / 22.5 m from the water, each lined up with the shore
      if (px1 > px0 && pz1 > pz0) {
        const cs = 2, pad = 30, gx0 = px0 - pad, gz0 = pz0 - pad, GW = Math.ceil((px1 - px0 + 2 * pad) / cs) + 1, GH = Math.ceil((pz1 - pz0 + 2 * pad) / cs) + 1;
        const D = new Float32Array(GW * GH).fill(1e6);
        for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) if (isWater(gx0 + i * cs, gz0 + j * cs)) D[j * GW + i] = 0;
        const S2 = 1.414;
        for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) { const k = j * GW + i; let d = D[k]; if (i) d = Math.min(d, D[k - 1] + 1); if (j) { d = Math.min(d, D[k - GW] + 1); if (i) d = Math.min(d, D[k - GW - 1] + S2); if (i < GW - 1) d = Math.min(d, D[k - GW + 1] + S2); } D[k] = d; }
        for (let j = GH - 1; j >= 0; j--) for (let i = GW - 1; i >= 0; i--) { const k = j * GW + i; let d = D[k]; if (i < GW - 1) d = Math.min(d, D[k + 1] + 1); if (j < GH - 1) { d = Math.min(d, D[k + GW] + 1); if (i < GW - 1) d = Math.min(d, D[k + GW + 1] + S2); if (i) d = Math.min(d, D[k + GW - 1] + S2); } D[k] = d; }
        const ROWS = [9, 13.5, 18, 22.5], placed = ROWS.map(() => []);
        for (let j = 1; j < GH - 1; j++) for (let i = 1; i < GW - 1; i++) {
          const x = gx0 + i * cs, z = gz0 + j * cs; if (x < px0 || x >= px1 || z < pz0 || z >= pz1) continue;
          const k = j * GW + i, dw = D[k] * cs; if (dw > 26 || dw < 7) continue;
          const r = ROWS.findIndex(R => Math.abs(dw - R) < 0.9); if (r < 0) continue;
          if (placed[r].some(([px, pz]) => Math.hypot(px - x, pz - z) < 10.5)) continue;
          if (hash2(x * 0.31, z * 0.57) < 0.12 || !inPoly(x, z, a.p) || roadNear(x, z, 2) || buildingAt(x, z)) continue;
          const gxd = D[k + 1] - D[k - 1], gzd = D[k + GW] - D[k - GW], gl = Math.hypot(gxd, gzd); if (gl < 0.3) continue;   // shore normal from the distance map
          const tx = -gzd / gl, tz = gxd / gl;
          placed[r].push([x, z]);
          L.push([x, z, Math.atan2(-tz, tx) + (hash2(x, z) - 0.5) * 0.12, 7.5 + hash2(z, x) * 2.5, 0.32 + hash2(x + 1, z) * 0.26]);
        }
      }
    } else if (a.k === 'rock') {
      for (let x = px0; x < px1; x += 5) for (let z = pz0; z < pz1; z += 5) if (hash2(x, z) < 0.3 && inPoly(x, z, a.p) && !roadNear(x, z, 3.5)) K.push([x, z, 0.6 + hash2(z, x) * 1.6]);
    } else {
      for (let i = 0; i < a.p.length; i += 2) {
        const j = (i + 2) % a.p.length, ex = a.p[j] - a.p[i], ez = a.p[j + 1] - a.p[i + 1], Le = Math.hypot(ex, ez);
        for (let s = 0; s < Le; s += 9) {
          const x = a.p[i] + ex * s / Le, z = a.p[i + 1] + ez * s / Le; if (x < x0 || x >= x0 + CH || z < z0 || z >= z0 + CH) continue;
          if (hash2(x * 0.3, z * 0.3) > 0.4) continue;
          const nx = -ez / Le, nz = ex / Le, o2 = inPoly(x + nx * 3, z + nz * 3, a.p) ? 3 : -3, bx = x + nx * o2, bz = z + nz * o2;
          if (!roadNear(bx, bz, 1) && !buildingAt(bx, bz) && !isWater(bx, bz)) B.push([bx, bz, 0.7 + hash2(bx, bz) * 0.9]);
        }
      }
    }
  }
  // rocky shoreline outside the mapped city (natural coast), and boulders on the mountains
  for (let x = x0 + 4; x < x0 + CH; x += 12) for (let z = z0 + 4; z < z0 + CH; z += 12) {
    const hsh = hash2(x * 0.37, z * 0.53); if (hsh > 0.5) continue;
    const h = heightAt(x, z); if (h < 0.8) continue;
    if (maskAt(x, z) === -1 && h < 6 && waterLevel(x, z) === 0) { let shore = false; for (let b = 0; b < 6.28; b += 1.05) if (isWater(x + Math.cos(b) * 10, z + Math.sin(b) * 10)) { shore = true; break; } if (shore && !roadNear(x, z, 8) && !buildingAt(x, z)) for (let q = 0; q < 3; q++) K.push([x + R(-4, 4), z + R(-4, 4), 0.5 + Math.random() * 1.4]); }
    else if (maskAt(x, z) === -1 && h > 200 && hsh < 0.06) { const s = 0.8 + hsh * 30; if (!roadNear(x, z, 4 + s * 1.2)) K.push([x, z, s]); }   // keep the whole rock (not just its centre) well off the road
  }
  // build the instanced meshes
  const grp = new THREE.Group(); grp.userData = { cx: x0 + CH / 2, cz: z0 + CH / 2 };
  const cols = [];
  const inst = (geo, mat, list, place, color) => { if (!list.length) return null; const m = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((it, i) => { place(it); o.updateMatrix(); m.setMatrixAt(i, o.matrix); if (color) m.setColorAt(i, color(it, col)); }); m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere(); grp.add(m); return m; };
  inst(hedgeGeo, leafMat, H, ([x, z, yaw, len, ht]) => { o.position.set(x, surfaceY(x, z) - 0.05, z); o.rotation.set(0, yaw, 0); o.scale.set(1.1, ht, len); }, ([x, z], c) => c.setHSL(0.29 + hash2(x, z) * 0.05, 0.5, (G.season === 'winter' ? 0.1 : 0.13) + hash2(z, x) * 0.04));
  inst(bushGeo, FOLIAGE, B, ([x, z, s]) => { o.position.set(x, surfaceY(x, z) - 0.1, z); o.rotation.set(0, hash2(x, z) * 6, 0); o.scale.set(s, s * (0.8 + hash2(z, x) * 0.5), s); }, ([x, z], c) => seasonLeaf(hash2(x * 2, z * 2), c));
  const blooms = BLOOM[G.season] || []; if (blooms.length) for (const [x, z, s] of B) if (hash2(x * 5, z * 5) < 0.45) for (let q = 0; q < 7; q++) { const a = q * 0.9 + hash2(x, z) * 6, r = s * (0.55 + (q % 3) * 0.12); F.push([x + Math.cos(a) * r, z + Math.sin(a) * r, surfaceY(x, z) + s * (0.9 + (q % 2) * 0.35), blooms[Math.floor(hash2(x * 3, z * 7) * blooms.length)]]); }
  inst(bloomGeo, bloomMat, F, ([x, z, y]) => { o.position.set(x, y, z); o.rotation.set(0, 0, 0); o.scale.set(1, 1, 1); }, ([, , , c], cc) => cc.set(c));
  inst(logGeo, woodMat, L, ([x, z, yaw, len, r]) => { o.position.set(x, heightAt(x, z) - r * 0.5, z); o.rotation.set(0, yaw, (hash2(x, z) - 0.5) * 0.06); o.scale.set(len, r, r); },
    ([x, z], c) => c.setHSL(0.07 + hash2(x, z) * 0.04, 0.14 + hash2(z, x) * 0.2, 0.26 + hash2(x * 3, z) * 0.2));   // silver-grey to warm brown, each log its own
  inst(rockGeo, rockMat, K, ([x, z, s]) => { o.position.set(x, heightAt(x, z) - s * 0.2, z); o.rotation.set(hash2(x, z), hash2(z, x) * 6, 0); o.scale.set(s, s, s * (0.8 + hash2(x + 2, z) * 0.4)); }, ([x, z], c) => c.setHSL(0.08 + hash2(x, z) * 0.05, 0.06 + hash2(z, x) * 0.06, 0.28 + hash2(x * 3, z) * 0.14));
  scene.add(grp);
  // you bump into logs and boulders (sit on a log by jumping on it)
  const colls = []; for (const [x, z, yaw, len, r] of L) for (const s of [-0.35, 0, 0.35]) colls.push({ x: x + Math.cos(yaw) * len * s, z: z - Math.sin(yaw) * len * s, r: r + 0.25, top: heightAt(x, z) + r * 1.5 });   // (the log spans 0..2r and is sunk 0.5 r into the sand)
  for (const [x, z, s] of K) if (s > 0.9) colls.push({ x, z, r: s * 0.8, top: heightAt(x, z) + s * 0.7 });
  grp.userData.colls = colls;
  return grp;
}
let lastSeason = null, buildBudget = 0;
function refreshColliders() { const all = []; for (const g of chunks.values()) if (g) all.push(...g.userData.colls); setColliders('scenery', all); }
function updateChunks(px, pz) {
  if (G.season !== lastSeason) { lastSeason = G.season; for (const g of chunks.values()) if (g) { scene.remove(g); g.traverse(m => m.isInstancedMesh && m.dispose()); } chunks.clear(); }
  const ci = Math.floor(px / CH), cj = Math.floor(pz / CH); buildBudget = 1; let changed = false;
  for (let d = 0; d <= 2; d++) for (let i = ci - d; i <= ci + d; i++) for (let j = cj - d; j <= cj + d; j++) {
    const k = i + ',' + j; if (chunks.has(k) || buildBudget <= 0) continue; buildBudget--; chunks.set(k, buildChunk(i, j)); changed = true;
  }
  for (const [k, g] of chunks) { const [i, j] = k.split(',').map(Number); if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) > 3) { if (g) { scene.remove(g); g.traverse(m => m.isInstancedMesh && m.dispose()); } chunks.delete(k); changed = true; } }
  if (changed) refreshColliders();
}

// ---------- night visitors: raccoons (and the odd coyote) ----------
const critterMat = new THREE.MeshStandardMaterial({ roughness: 0.9, vertexColors: true });
function critterGeo(body, mask, tail, s) {
  const parts = [], add = (geo, c, x, y, z, sx = 1, sy = 1, sz = 1) => { const g = geo.clone(); g.scale(sx, sy, sz); g.translate(x, y, z); const cc = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = cc.r; a[i * 3 + 1] = cc.g; a[i * 3 + 2] = cc.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); parts.push(g.index ? g.toNonIndexed() : g); };
  const S = new THREE.SphereGeometry(1, 10, 8), Bx = new THREE.BoxGeometry(1, 1, 1);
  add(S, body, 0, 0.32 * s, 0, 0.22 * s, 0.18 * s, 0.38 * s); add(S, body, 0, 0.38 * s, -0.4 * s, 0.15 * s, 0.13 * s, 0.16 * s); add(S, mask, 0, 0.4 * s, -0.48 * s, 0.13 * s, 0.05 * s, 0.08 * s);
  add(S, '#222', 0, 0.36 * s, -0.56 * s, 0.03 * s, 0.03 * s, 0.03 * s);
  for (const e of [-1, 1]) add(Bx, body, e * 0.08 * s, 0.53 * s, -0.38 * s, 0.05 * s, 0.08 * s, 0.03 * s);
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(Bx, '#2a2622', lx * 0.12 * s, 0.1 * s, lz * 0.22 * s, 0.06 * s, 0.2 * s, 0.06 * s);
  for (let i = 0; i < 4; i++) add(S, i % 2 ? tail[0] : tail[1], 0, 0.32 * s, (0.42 + i * 0.1) * s, 0.07 * s, 0.07 * s, 0.07 * s);
  let pos = [], colr = []; for (const g of parts) { pos.push(...g.attributes.position.array); colr.push(...g.attributes.color.array); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3)); g.computeVertexNormals(); return g;
}
const raccoonGeo = critterGeo('#7c7871', '#1c1b1a', ['#2a2826', '#bdb8ad'], 1), coyoteGeo = critterGeo('#9b8366', '#d8cbb3', ['#8a7358', '#5a4a38'], 1.7);
const critters = [];
let critterT = 3;
function updateCritters(dt, pl) {
  const night = (G.night || 0) > 0.6;
  critterT -= dt;
  if (night && critterT < 0 && critters.length < 5 && !pl.vehicle && !pl.transit) {
    critterT = R(6, 14);
    const houses = houseBy.get(key(pl.x, pl.z)) || [];
    if (houses.length && Math.random() < 0.7) {   // a raccoon family on its rounds
      const h = houses[Math.floor(Math.random() * houses.length)], n = 1 + Math.floor(Math.random() * 4), yaw = Math.random() * 6.28;
      for (let i = 0; i < n; i++) { const m = new THREE.Mesh(raccoonGeo, critterMat); m.castShadow = true; m.scale.setScalar(i ? 0.55 : 1); scene.add(m); critters.push({ m, k: 'raccoon', x: h.cx + 4 + i * 0.9, z: h.cz + 4, yaw, sp: 1.1, lead: i, life: 50, ph: Math.random() * 6 }); }
    } else if (Math.random() < 0.35) {
      const a = Math.random() * 6.28, x = pl.x + Math.cos(a) * 60, z = pl.z + Math.sin(a) * 60;
      if (!isWater(x, z) && !buildingAt(x, z)) { const m = new THREE.Mesh(coyoteGeo, critterMat); m.castShadow = true; scene.add(m); critters.push({ m, k: 'coyote', x, z, yaw: Math.random() * 6.28, sp: 2.4, life: 40, ph: 0 }); }
    }
  }
  for (let i = critters.length - 1; i >= 0; i--) {
    const c = critters[i], d = Math.hypot(c.x - pl.x, c.z - pl.z);
    c.life -= dt; const scared = d < (c.k === 'coyote' ? 25 : 7);
    if (scared) { c.yaw = Math.atan2(pl.x - c.x, pl.z - c.z); if (!c.told) { c.told = true; softSpot(c.k); if (c.k === 'raccoon') { ui.toast('🦝 Trash pandas!', 'A raccoon family on their nightly rounds. They know which bins have the good stuff.', 3500); discover('raccoons'); } else { ui.toast('🐺 A coyote!', 'Coyotes live right in the city: Stanley Park, Pacific Spirit, even backyards. It trots off without a sound.', 3500); discover('coyote'); } } }
    else c.yaw += Math.sin(G.t * 0.5 + c.ph + i) * dt * 0.6;
    const sp = c.sp * (scared ? 2.4 : 1), nx = c.x - Math.sin(c.yaw) * sp * dt, nz = c.z - Math.cos(c.yaw) * sp * dt;
    if (!buildingAt(nx, nz) && !isWater(nx, nz)) { c.x = nx; c.z = nz; } else c.yaw += 2;
    c.m.position.set(c.x, surfaceY(c.x, c.z) + Math.abs(Math.sin(G.t * 9 + i)) * 0.03, c.z); c.m.rotation.y = c.yaw;
    if (c.life < 0 || d > 220 || !night) { scene.remove(c.m); critters.splice(i, 1); }
  }
}

export function updateScenery(dt, pl) {
  updateChunks(pl.x, pl.z);
  for (const [k, g] of chunks) if (g) g.visible = Math.hypot(g.userData.cx - pl.x, g.userData.cz - pl.z) < 750;
  updateCritters(dt, pl);
}
export const _scenery = { chunks, critters };
