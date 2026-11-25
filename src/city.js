// City: real OpenStreetMap streets (with bridges), buildings with windows, collisions, city trees, business signs.
import * as THREE from 'three';
import { G, scene, camera, clamp, smooth, hash2, inPoly, std, canvasTex, toXZ, farCull } from './core.js';
import { setColliders } from './colliders.js';
import { heightAt, groundY, townDensity, maskAt, makeTreeChunks, TREE_GEOS, TREE_MATS, isWater, isSnow, setForestFilter, SNOW_U } from './terrain.js';

const M = window.MAP;
export const NX = i => M.nodes[i * 2], NZ = i => M.nodes[i * 2 + 1];
export const nodeCount = M.nodes.length / 2;
export const nodeY = new Float32Array(nodeCount);
// heights for mountain-road nodes, worked out by tools/build-map.mjs
const NH = new Float32Array(nodeCount).fill(NaN);
if (M.nh) for (let i = 0; i < M.nh.length; i += 2) NH[M.nh[i]] = M.nh[i + 1];
export const nodeEdges = Array.from({ length: nodeCount }, () => []);
export const edges = [];   // {a, b, r (road index), len}
export const roadName = r => (r.n >= 0 && r.n !== undefined) ? M.names[r.n] : '';
export const isDriveType = t => t <= 6;
export const isWalkType = t => t >= 2;

// ---------- spatial grids ----------
class Grid {
  constructor(cell) { this.cell = cell; this.map = new Map(); }
  key(i, j) { return i * 100003 + j; }
  addBox(x0, z0, x1, z1, item) {
    for (let i = Math.floor(x0 / this.cell); i <= Math.floor(x1 / this.cell); i++) for (let j = Math.floor(z0 / this.cell); j <= Math.floor(z1 / this.cell); j++) {
      const k = this.key(i, j); let a = this.map.get(k); if (!a) this.map.set(k, a = []); a.push(item);
    }
  }
  near(x, z, rad, out = []) {
    out.length = 0; const seen = new Set();
    for (let i = Math.floor((x - rad) / this.cell); i <= Math.floor((x + rad) / this.cell); i++) for (let j = Math.floor((z - rad) / this.cell); j <= Math.floor((z + rad) / this.cell); j++) {
      const a = this.map.get(this.key(i, j)); if (!a) continue;
      for (const it of a) if (!seen.has(it)) { seen.add(it); out.push(it); }
    }
    return out;
  }
}
export const roadGrid = new Grid(30);      // road segments
export const bldGrid = new Grid(25);       // building indices
export const bridgeGrid = new Grid(30);    // bridge deck segments
export const buildings = [];               // {p: Float32Array, top, base, name, x, z}

// ---------- graph + bridge heights ----------
function buildGraph() {
  for (let ri = 0; ri < M.roads.length; ri++) {
    const r = M.roads[ri], p = r.p; let s0 = 0;
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1]; if (a === b) continue;
      const len = Math.hypot(NX(b) - NX(a), NZ(b) - NZ(a));
      const e = { a, b, r: ri, len, id: edges.length, s0 }; edges.push(e); s0 += len;
      nodeEdges[a].push(e); nodeEdges[b].push(e);
      const hw = r.w / 2;
      roadGrid.addBox(Math.min(NX(a), NX(b)) - hw, Math.min(NZ(a), NZ(b)) - hw, Math.max(NX(a), NX(b)) + hw, Math.max(NZ(a), NZ(b)) + hw, e);
    }
  }
  for (let i = 0; i < nodeCount; i++) nodeY[i] = isNaN(NH[i]) ? heightAt(NX(i), NZ(i)) : NH[i];
  // Engineered fixed heights (r.fx) only for region roads out in the wild (mountain highways on cliffs). In towns
  // (Burnaby, New West, North Shore…) the pre-computed heights were off by up to 13 m, so cars drove UNDER the drawn
  // street: those now drape over the drawn ground like every city street.
  for (const r of M.roads) {
    if (!r.rg || r.t > 6 || r.b) continue;
    const ns = [r.p[0], r.p[r.p.length >> 1], r.p[r.p.length - 1]];
    r.fx = r.t <= 1 || !ns.some(n => townDensity(NX(n), NZ(n)) > 0.008);   // motorways keep their engineered ramps
  }
  const keepNH = new Set(); for (const r of M.roads) if (r.fx || (r.b && r.rg)) for (const n of r.p) keepNH.add(n);
  for (let i = 0; i < nodeCount; i++) if (!isNaN(NH[i]) && !keepNH.has(i)) nodeY[i] = heightAt(NX(i), NZ(i));
  // bridges: decks are interpolated between their two land ends (mountain roads already have heights)
  const bridgeRoads = M.roads.filter(r => r.b && !r.rg);
  const onBridge = new Map(), onLand = new Set();
  for (const r of M.roads) for (const n of r.p) { if (r.b && !r.rg) { if (!onBridge.has(n)) onBridge.set(n, []); onBridge.get(n).push(r); } else onLand.add(n); }
  const parent = new Map(); const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const n of onBridge.keys()) parent.set(n, n);
  for (const r of bridgeRoads) for (let i = 1; i < r.p.length; i++) { const a = find(r.p[0]), b = find(r.p[i]); if (a !== b) parent.set(a, b); }
  const comps = new Map();
  for (const n of onBridge.keys()) { const c = find(n); if (!comps.has(c)) comps.set(c, []); comps.get(c).push(n); }
  for (const nodes of comps.values()) {
    let ends = nodes.filter(n => onLand.has(n));
    if (!ends.length) ends = nodes.filter(n => onBridge.get(n).some(r => r.p[0] === n || r.p[r.p.length - 1] === n));
    if (!ends.length) continue;
    for (const n of nodes) {
      if (onLand.has(n)) continue;
      let ws = 0, hs = 0, dmin = 1e9;
      for (const e of ends) { const d = Math.hypot(NX(n) - NX(e), NZ(n) - NZ(e)); dmin = Math.min(dmin, d); const w = 1 / (d * d + 1); ws += w; hs += w * nodeY[e]; }
      const g = heightAt(NX(n), NZ(n));
      nodeY[n] = Math.max(hs / ws, g + 7.5 * smooth(0, 60, dmin), 3);
    }
  }
  // each bridge remembers its whole connected deck (long bridges are mapped as many short pieces): the clearance arch is
  // worked out for the whole deck at once, so the pieces meet at the same height
  for (const [c, nodes] of comps) { const C = { land: nodes.filter(n => onLand.has(n)), needs: null, roads: [] }; for (const r of bridgeRoads) if (find(r.p[0]) === c) { r.comp = C; C.roads.push(r); } }
  // a ground street that meets a raised road/bridge end gets a smooth ramp up to it (instead of a step cars slip under)
  const fixedAt = n => nodeEdges[n].some(e => { const q = M.roads[e.r]; return q.t <= 6 && (q.fx || q.b); });
  for (const r of M.roads) {
    if (r.t > 6 || r.b || r.fx || r.p.length < 2) continue;
    const up = n => { if (!fixedAt(n)) return 0; const d = nodeY[n] - groundY(NX(n), NZ(n)); return d > 0.5 ? Math.min(d, 25) : 0; };
    const r0 = up(r.p[0]), r1 = up(r.p[r.p.length - 1]); if (!r0 && !r1) continue;
    let L = 0; for (let i = 1; i < r.p.length; i++) L += Math.hypot(NX(r.p[i]) - NX(r.p[i - 1]), NZ(r.p[i]) - NZ(r.p[i - 1]));
    const both = r0 && r1 ? 0.48 : 0.92;   // the ramp always lands back on the ground inside this street
    r.ramp = { r0, r1, L, R0: Math.min(clamp(r0 * 9, 20, 160), L * both), R1: Math.min(clamp(r1 * 9, 20, 160), L * both) };
  }
}
// extra height of a ramped street at distance s from its start
const rampOff = (r, s) => { const q = r.ramp; return q ? q.r0 * (1 - smooth(0, q.R0, s)) + q.r1 * (1 - smooth(0, q.R1, q.L - s)) : 0; };
function bridgeNeeds(C) {   // clearance points for a whole connected bridge deck
  if (C.needs) return C.needs; C.needs = [];
  for (const r of C.roads) for (const p of roadPoints(r, 0, true)) for (const e of roadGrid.near(p.x, p.z, 2, _bc)) {
    const q = M.roads[e.r]; if (C.roads.includes(q) || (q.b && (q.l || 1) >= (r.l || 1)) || q.t > 6 && q.t !== 7) continue;
    const ax = NX(e.a), az = NZ(e.a), dx = NX(e.b) - ax, dz = NZ(e.b) - az, L2 = dx * dx + dz * dz || 1, t = clamp(((p.x - ax) * dx + (p.z - az) * dz) / L2, 0, 1);
    if (Math.hypot(p.x - ax - dx * t, p.z - az - dz * t) > q.w / 2 + 1.5) continue;
    const under = (q.b || q.fx) ? nodeY[e.a] + (nodeY[e.b] - nodeY[e.a]) * t : heightAt(p.x, p.z);
    if (under + 5.6 > p.y + 0.05) C.needs.push([p.x, p.z, under + 5.6]);
  }
  return C.needs;
}

// ---------- road textures ----------
function asphalt(ctx, w, h, base, detail = true) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  // fine aggregate grain
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 26 + (Math.random() < 0.02 ? 30 : 0); d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  ctx.putImageData(img, 0, 0);
  if (!detail) return;
  // repair patches, oil stains and cracks
  for (let i = 0; i < 4; i++) { ctx.fillStyle = `rgba(0,0,0,${0.06 + Math.random() * 0.08})`; ctx.save(); ctx.translate(Math.random() * w, Math.random() * h); ctx.rotate(Math.random() * 3); ctx.fillRect(-20, -12, 20 + Math.random() * 50, 12 + Math.random() * 30); ctx.restore(); }
  for (let i = 0; i < 6; i++) { const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 14); g.addColorStop(0, 'rgba(10,10,12,.22)'); g.addColorStop(1, 'rgba(10,10,12,0)'); ctx.save(); ctx.translate(w * (0.3 + Math.random() * 0.4), Math.random() * h); ctx.scale(1, 1.8); ctx.fillStyle = g; ctx.fillRect(-14, -14, 28, 28); ctx.restore(); }
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) { let x = Math.random() * w, y = Math.random() * h; ctx.beginPath(); ctx.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (Math.random() - 0.5) * 18; y += Math.random() * 10; ctx.lineTo(x, y); } ctx.stroke(); }
}
function sidewalk(ctx, w, h) {
  asphalt(ctx, w, h, '#b9b5ab', false);
  ctx.fillStyle = 'rgba(0,0,0,.16)';
  for (let y = 0; y < h; y += h / 4) ctx.fillRect(0, y, w, 2);   // slab joints
  ctx.fillRect(w * 0.5, 0, 2, h);
  ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(0, h - 4, w, 4);   // curb edge
  for (let i = 0; i < 12; i++) { ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},.06)`; ctx.fillRect(Math.random() * w, Math.random() * h, 6 + Math.random() * 20, 6 + Math.random() * 20); }
}
const TEX = {
  arterial: canvasTex(512, 512, (c, w, h) => { asphalt(c, w, h, '#5b5d60'); c.fillStyle = '#e2b93b'; c.fillRect(w / 2 - 6, 0, 4, h); c.fillRect(w / 2 + 2, 0, 4, h); c.fillStyle = '#ddd'; for (const x of [w * 0.25, w * 0.75]) c.fillRect(x - 2, 0, 4, h * 0.45); c.fillStyle = '#eee'; c.fillRect(3, 0, 3, h); c.fillRect(w - 6, 0, 3, h); }),
  local: canvasTex(512, 512, (c, w, h) => { asphalt(c, w, h, '#636568'); }),   // worn mid-grey Vancouver asphalt (was near-black on screen)
  oneway: canvasTex(512, 512, (c, w, h) => { asphalt(c, w, h, '#5c5e61'); c.fillStyle = '#e8e8e2'; for (const x of [w / 3, w * 2 / 3]) c.fillRect(x - 2, 0, 4, h * 0.3); c.fillRect(10, 0, 3, h); c.fillRect(w - 13, 0, 3, h); }),
  path: canvasTex(128, 128, (c, w, h) => { asphalt(c, w, h, '#a9a69d'); c.strokeStyle = 'rgba(0,0,0,.15)'; c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke(); }),
  gravel: canvasTex(128, 128, (c, w, h) => { c.fillStyle = '#a89c86'; c.fillRect(0, 0, w, h); for (let i = 0; i < 1600; i++) { const v = 90 + Math.random() * 110; c.fillStyle = `rgb(${v},${v * 0.95},${v * 0.85})`; c.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2.5, 1 + Math.random() * 2.5); } }),
  board: canvasTex(128, 128, (c, w, h) => { for (let y = 0; y < h; y += 16) { const v = 105 + Math.random() * 40; c.fillStyle = `rgb(${v},${v * 0.72},${v * 0.48})`; c.fillRect(0, y, w, 14); c.fillStyle = 'rgba(30,20,10,.8)'; c.fillRect(0, y + 14, w, 2); c.fillStyle = 'rgba(40,30,20,.35)'; c.fillRect(Math.random() * w, y + 4, 30, 2); } }),
  steps: canvasTex(64, 128, (c, w, h) => { c.fillStyle = '#9c9890'; c.fillRect(0, 0, w, h); c.fillStyle = '#d8d4cb'; c.fillRect(0, 0, w, 14); c.fillStyle = '#5e5a54'; c.fillRect(0, h - 10, w, 10); for (let i = 0; i < 200; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); } }),
  trail: canvasTex(128, 256, (c, w, h) => { c.fillStyle = '#6e5a43'; c.fillRect(0, 0, w, h); for (let i = 0; i < 900; i++) { c.fillStyle = `rgba(${Math.random() < 0.5 ? '40,30,20' : '150,130,100'},${0.15 + Math.random() * 0.25})`; c.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 4, 2 + Math.random() * 4); } const g = c.createLinearGradient(0, 0, w, 0); g.addColorStop(0, 'rgba(60,80,40,.8)'); g.addColorStop(0.18, 'rgba(60,80,40,0)'); g.addColorStop(0.82, 'rgba(60,80,40,0)'); g.addColorStop(1, 'rgba(60,80,40,.8)'); c.fillStyle = g; c.fillRect(0, 0, w, h); for (let i = 0; i < 14; i++) { c.fillStyle = 'rgba(120,110,95,.7)'; c.beginPath(); c.arc(w * 0.2 + Math.random() * w * 0.6, Math.random() * h, 2 + Math.random() * 4, 0, 7); c.fill(); } }),
  cycle: canvasTex(128, 128, (c, w, h) => { asphalt(c, w, h, '#5b6b5e'); c.fillStyle = '#ddd'; c.fillRect(w / 2 - 2, 0, 4, h * 0.5); }),
  walk: canvasTex(256, 256, (c, w, h) => sidewalk(c, w, h)),
};
const ROAD_MATS = {
  arterial: new THREE.MeshStandardMaterial({ map: TEX.arterial, roughness: 0.85, envMapIntensity: 0.4 }),
  local: new THREE.MeshStandardMaterial({ map: TEX.local, roughness: 0.9, envMapIntensity: 0.4 }),
  oneway: new THREE.MeshStandardMaterial({ map: TEX.oneway, roughness: 0.88, envMapIntensity: 0.4 }),
  curb: new THREE.MeshStandardMaterial({ color: '#b9b5ab', roughness: 0.9 }),
  path: new THREE.MeshStandardMaterial({ map: TEX.path, roughness: 0.95 }),
  trail: new THREE.MeshStandardMaterial({ map: TEX.trail, roughness: 1 }),
  gravel: new THREE.MeshStandardMaterial({ map: TEX.gravel, roughness: 1 }),
  board: new THREE.MeshStandardMaterial({ map: TEX.board, roughness: 0.85 }),
  steps: new THREE.MeshStandardMaterial({ map: TEX.steps, roughness: 0.9 }),
  cycle: new THREE.MeshStandardMaterial({ map: TEX.cycle, roughness: 0.9 }),
  walk: new THREE.MeshStandardMaterial({ map: TEX.walk, roughness: 0.95 }),
  deck: std('#9c978d', { side: THREE.DoubleSide }),
  rail: std('#cfcac0', { side: THREE.DoubleSide }),
  bank: std('#5d5548', { side: THREE.DoubleSide, roughness: 1 }),
};
// seen from far away (flying), roads float a tiny bit higher above the ground so they don't flicker against it
// (only when you're up high: on the ground the roads stay exactly where cars and people are)
const ROAD_LIFT = { value: 0 };
for (const k of ['arterial', 'local', 'oneway', 'path', 'trail', 'gravel', 'board', 'steps', 'cycle', 'walk']) ROAD_MATS[k].customProgramCacheKey = () => 'road-' + k;   // each road kind compiles its own shader (three.js would otherwise reuse the first one for all)
for (const k of ['arterial', 'local', 'oneway', 'path', 'trail', 'gravel', 'board', 'steps', 'cycle', 'walk']) ROAD_MATS[k].onBeforeCompile = sh => {
  sh.uniforms.uRoadLift = ROAD_LIFT;
  sh.uniforms.uSnowLine = SNOW_U.line; sh.uniforms.uCitySnow = SNOW_U.city;
  sh.vertexShader = 'uniform float uRoadLift;\nvarying vec3 vRw;\n' + sh.vertexShader.replace('#include <project_vertex>', `{ vec3 rw = (modelMatrix * vec4(transformed, 1.0)).xyz; float rd = distance(cameraPosition, rw); transformed.y += max(0.0, rd - 150.0) * ${k === 'walk' || k === 'path' ? '0.0011' : '0.0016'} * uRoadLift; }
#include <project_vertex>
vRw = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
  // snow: trails and sidewalks above the snow line (or in a city snowfall) are snowy with packed tracks; streets stay ploughed
  // but get snowy edges + slush
  const trail = k === 'path' || k === 'walk' || k === 'cycle' || k === 'trail' || k === 'gravel' || k === 'board' || k === 'steps', wild = k === 'trail' || k === 'gravel';
  sh.fragmentShader = 'varying vec3 vRw; uniform float uSnowLine; uniform float uCitySnow;\nfloat rsH(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    { float n = rsH(floor(vRw.xz * 0.7)) * 0.5 + rsH(floor(vRw.xz * 0.08)) * 0.5;
      float sm = smoothstep(uSnowLine - 40.0, uSnowLine + 40.0, vRw.y + (n - 0.5) * 120.0), s = max(sm, uCitySnow * 0.85);
      ${wild || k === 'path' ? 'if (sm > 0.55) discard;' : ''}
      float tracks = rsH(floor(vRw.xz * 3.0)) * 0.25;
      ${trail ? 'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.89, 0.93) - tracks * 0.35, s * 0.92);' : 'diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.42, 0.44, 0.46), vec3(0.85, 0.88, 0.92), step(0.72, n)), s * 0.35);'} }`);
};

// collects ribbons per chunk + material
const CHUNK = 500;
const buckets = new Map();
function bucket(x, z, mat) {
  const k = mat + '|' + Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK);
  let b = buckets.get(k); if (!b) buckets.set(k, b = { mat, pos: [], uv: [], idx: [] }); return b;
}
// Ribbon along polyline pts [{x,z,y}], from lateral offset l0 to l1, v scaled by vScale
function ribbon(pts, l0, l1, mat, vScale = 0.1, uFlip = false) {
  if (pts.length < 2) return;
  const b = bucket(pts[0].x, pts[0].z, mat), base = b.pos.length / 3;
  let dist = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
    let dx = q.x - o.x, dz = q.z - o.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const px = -dz, pz = dx;
    if (i > 0) dist += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    const x0 = p.x + px * l0, z0 = p.z + pz * l0, x1 = p.x + px * l1, z1 = p.z + pz * l1;
    b.pos.push(x0, p.d !== undefined ? groundY(x0, z0) + p.d : p.y, z0, x1, p.d !== undefined ? groundY(x1, z1) + p.d : p.y, z1);
    b.uv.push(uFlip ? 1 : 0, dist * vScale, uFlip ? 0 : 1, dist * vScale);
    if (i > 0) { const k = base + (i - 1) * 2; b.idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
}
function flushBuckets(tiled = false) {
  const out = [];
  for (const b of buckets.values()) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    geo.setIndex(b.idx);
    geo.computeVertexNormals();
    // ribbons can be wound either way: force normals up
    const n = geo.attributes.normal; for (let i = 0; i < n.count; i++) if (n.getY(i) < 0) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
    const m = new THREE.Mesh(geo, ROAD_MATS[b.mat]); m.receiveShadow = true; scene.add(m); out.push(m);
    if (tiled) m.userData.small = b.mat === 'path' || b.mat === 'walk' || b.mat === 'cycle'; else farCull(m, m.userData.small ? 1500 : 5000);
  }
  buckets.clear(); return out;
}
for (const k of ['arterial', 'local', 'oneway', 'path', 'trail', 'gravel', 'board', 'steps', 'cycle', 'walk']) ROAD_MATS[k].side = THREE.DoubleSide;

// densify a road into points with heights
function roadPoints(r, lift, raw = false) {
  const out = [];
  const fixedH = r.b || r.fx, stepL = fixedH ? 6 : 4; let s0 = 0;
  // engineered roads never sink into the drawn hillside; draped streets follow the ground (+ a ramp up to a raised road)
  const pt = (x, z, y, s) => out.push(fixedH ? { x, z, y: (r.b ? y : Math.max(y, groundY(x, z))) + lift } : { x, z, y: groundY(x, z) + lift + rampOff(r, s), d: lift + rampOff(r, s) });
  for (let i = 0; i < r.p.length; i++) {
    const a = r.p[i]; pt(NX(a), NZ(a), nodeY[a], s0);
    if (i === r.p.length - 1) break;
    const b = r.p[i + 1], len = Math.hypot(NX(b) - NX(a), NZ(b) - NZ(a)), n = Math.floor(len / stepL);
    for (let s = 1; s < n; s++) { const t = s / n; pt(NX(a) + (NX(b) - NX(a)) * t, NZ(a) + (NZ(b) - NZ(a)) * t, nodeY[a] + (nodeY[b] - nodeY[a]) * t, s0 + len * t); }
    s0 += len;
  }
  if (r.b && !r.rg && !raw) bridgeClearance(r, out);
  if (r.b && r.t >= 7 && !raw) snapAlong(r, out);
  return out;
}
// ---- bridge sidewalks: a footway / cycleway bridge piece that runs beside a road bridge is laid parallel to the road
// deck, just outside its edge, at the deck's height (OSM draws them a few metres off, and each got its own height profile,
// so they wandered, hung beside the bridge or sank below it). Worked out once for every bridge path (`prepAlong`).
let ALONG = null, _compN = 0;
const _al = [];
function deckPts(qi) { const q = M.roads[qi]; return q._dp || (q._dp = roadPoints(q, (q.t <= 4 ? 0.26 : 0.22) + (qi % 9) * 0.004)); }
function deckHit(x, z, y, ux, uz) {   // the nearest road-bridge deck segment running alongside (x, z)
  let best = null; const seen = new Set();
  for (const e of roadGrid.near(x, z, 12, _al)) {
    const q = M.roads[e.r]; if (!q.b || q.t > 6 || seen.has(e.r)) continue; seen.add(e.r);
    const dp = deckPts(e.r), hw = q.w / 2;
    for (let j = 1; j < dp.length; j++) {
      const a = dp[j - 1], b = dp[j], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz); if (L < 0.01) continue;
      const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (L * L), 0, 1), cx = a.x + dx * t, cz = a.z + dz * t, d = Math.hypot(x - cx, z - cz), ex = d - hw;
      if (ex < -4 || ex > 9 || (best && ex >= best.ex)) continue;   // the deck whose edge reaches furthest out (OSM doubles some decks: Granville)
      const dot = (dx * ux + dz * uz) / L; if (Math.abs(dot) < 0.9) continue;   // must run alongside, not cross
      const dy = a.y + (b.y - a.y) * t; if (Math.abs(y - dy) > 70) continue;   // a path's own bridge height can be way off (Lions Gate paths sat 30 m below the deck)
      const side = Math.sign((x - a.x) * -dz + (z - a.z) * dx) || 1;
      best = { qi: e.r, j, t, d, ex, hw, side, ps: side * Math.sign(dot), key: q.comp ? (q.comp.id ??= ++_compN) : 'r' + e.r };   // ps: side seen walking along the path (pieces of one deck may be drawn either way)
    }
  }
  return best;
}
function prepAlong() {
  ALONG = 'busy'; const items = [];
  M.roads.forEach((r, ri) => {
    if (!r.b || r.t < 7) return;
    const p = roadPoints(r, 0.14), hits = p.map((pt, i) => { const q = p[Math.min(i + 1, p.length - 1)], o = p[Math.max(i - 1, 0)], L = Math.hypot(q.x - o.x, q.z - o.z) || 1; return deckHit(pt.x, pt.z, pt.y, (q.x - o.x) / L, (q.z - o.z) / L); });
    const n = hits.filter(Boolean).length; if (n < 3 || n < p.length * 0.3) return;
    let sum = 0; for (const h of hits) if (h) sum += h.ps; const ps = Math.sign(sum) || 1;
    for (let i = 0; i < hits.length; i++) if (hits[i] && hits[i].ps !== ps) hits[i] = null;   // never flip to the deck's other side (a wide main span may be its own deck: that's fine)
    // short gaps (< 25 m) between hits stay on the deck too (filled in by interpolation in snapAlong)
    const cum = [0]; for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z));
    for (let i = 0; i < hits.length; i++) if (!hits[i]) { let j = i; while (j < hits.length && !hits[j]) j++; if (i > 0 && j < hits.length && cum[j] - cum[i - 1] < 25) for (let k = i; k < j; k++) hits[k] = { gap: [i - 1, j] }; i = j; }
    const ex = hits.filter(h => h && !h.gap).map(h => h.ex).sort((a, b) => a - b);
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const q of p) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.z); z1 = Math.max(z1, q.z); }
    items.push({ r, hits, tw: r.w / 2, med: ex[ex.length >> 1], p, xz: p.filter((_, i) => i % 2 === 0), box: [x0 - 8, z0 - 8, x1 + 8, z1 + 8] });
  });
  // a sidewalk + cycle track on the same side sit next to each other, not on top (the inner one keeps the inner slot)
  const segD = (x, z, p) => { let m = 1e9; for (let i = 1; i < p.length; i++) { const a = p[i - 1], b = p[i], dx = b.x - a.x, dz = b.z - a.z, t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1); m = Math.min(m, Math.hypot(x - a.x - dx * t, z - a.z - dz * t)); } return m; };
  items.sort((a, b) => a.med - b.med); const done = [];
  for (const it of items) {
    let off = clamp(it.med, it.tw + 0.3, it.tw + 4.3);
    for (const o of done) {
      if (o.box[0] > it.box[2] || o.box[2] < it.box[0] || o.box[1] > it.box[3] || o.box[3] < it.box[1]) continue;
      if (it.xz.filter(b => segD(b.x, b.z, o.p) < 6).length >= Math.max(3, it.xz.length * 0.3)) off = Math.max(off, o.off + o.tw + it.tw + 0.3);
    }
    it.off = off; it.r._al = it; done.push(it);
  }
  for (const it of items) { delete it.p; delete it.xz; }
  ALONG = true;
}
function snapAlong(r, out) {
  if (ALONG === null) prepAlong(); if (ALONG !== true) return;
  const it = r._al; if (!it || it.hits.length !== out.length) return;
  const cum = [0]; for (let i = 1; i < out.length; i++) cum.push(cum[i - 1] + Math.hypot(out[i].x - out[i - 1].x, out[i].z - out[i - 1].z));
  const free = [], T = []; for (let i = 0; i < out.length; i++) if (!it.hits[i]) free.push(cum[i]);
  for (let i = 0; i < out.length; i++) {   // the spot beside the deck for each point
    const h = it.hits[i]; if (!h || h.gap) continue;
    const dp = deckPts(h.qi), a = dp[h.j - 1], b = dp[h.j], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
    const cx = a.x + dx * h.t, cz = a.z + dz * h.t, lat = h.side * (h.hw + it.off);
    T[i] = { x: cx - dz / L * lat, z: cz + dx / L * lat, y: a.y + (b.y - a.y) * h.t + CURB };
  }
  for (let i = 0; i < out.length; i++) { const h = it.hits[i]; if (h && h.gap) { const [u, v] = h.gap, A = T[u], B = T[v], k = (cum[i] - cum[u]) / (cum[v] - cum[u] || 1); if (A && B) T[i] = { x: A.x + (B.x - A.x) * k, z: A.z + (B.z - A.z) * k, y: A.y + (B.y - A.y) * k }; } }
  const S = T.map((g, i) => {   // light smoothing (± 2 points) so a switch between deck pieces never kinks the path
    if (!g) return g; let x = 0, z = 0, y = 0, n = 0;
    for (let k = i - 2; k <= i + 2; k++) if (T[k]) { x += T[k].x; z += T[k].z; y += T[k].y; n++; }
    return { x: x / n, z: z / n, y: y / n };
  });
  for (let i = 0; i < out.length; i++) {
    const g = S[i]; if (!g) continue;
    let df = 1e9; for (const c of free) df = Math.min(df, Math.abs(c - cum[i]));
    const w = free.length ? smooth(0, 12, df) : 1, p = out[i];   // ease between the mapped line and the deck where it leaves the bridge
    p.x += (g.x - p.x) * w; p.z += (g.z - p.z) * w; p.y += (g.y - p.y) * w;
  }
}
// make sure a bridge deck clears whatever road/track it crosses (5.6 m), with smooth ramps up from where it meets land.
// Worked out over the whole connected deck (by position), so the short pieces a long viaduct is mapped as all agree.
const _bc = [];
function bridgeClearance(r, out) {
  const C = r.comp; if (!C) return;
  const need = bridgeNeeds(C); if (!need.length) return;
  const slope = 0.14;
  for (const p of out) {
    let want = p.y; for (const [x, z, w] of need) want = Math.max(want, w + 0.0 - slope * Math.hypot(p.x - x, p.z - z));
    if (want <= p.y) continue;
    let dl = 1e9; for (const n of C.land) dl = Math.min(dl, Math.hypot(p.x - NX(n), p.z - NZ(n)));   // back down to the road where it lands
    const k = C.land.length ? smooth(0, 40, dl) : 1; p.y += (want - p.y) * k;
  }
}

export const _roadDebug = { roadPoints, nodeY };   // tests: drawn road heights
const roadTiles = new Map();
// cut a sidewalk short at a junction: it stops at the corner (half the widest crossing street + a little)
function trimAtJunctions(r, pts) {
  const cut = node => { let w = 0, n = 0; for (const e of nodeEdges[node]) { const q = M.roads[e.r]; if (q === r || q.t > 6) continue; n++; w = Math.max(w, q.w); } return n ? w / 2 + 1.2 : 0; };
  const c0 = cut(r.p[0]), c1 = cut(r.p[r.p.length - 1]); if (!c0 && !c1) return pts;
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  const L = cum[cum.length - 1]; if (L < c0 + c1 + 2) return [];
  const at = s => { let i = 1; while (i < cum.length - 1 && cum[i] < s) i++; const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1), a = pts[i - 1], b = pts[i]; return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: a.y + (b.y - a.y) * t, d: a.d }; };
  const out = [at(c0)]; for (let i = 0; i < pts.length; i++) if (cum[i] > c0 && cum[i] < L - c1) out.push(pts[i]); out.push(at(L - c1)); return out;
}
// Footpaths / cycle paths / the seawall are built level and smooth like real ones: instead of draping every vertex over
// the lumpy 10 m ground (and tilting with it sideways), each path gets one height profile along its length (every 2 m):
// the highest ground across its width (so it never sinks), dips up to ~24 m long filled in (at most ~1 m; never floating more than 2.2 m), then
// smoothed over ~12 m while staying on top of the ground. Level across the width; a skirt hides any gap at the edges.
// Wild mountain trails and engineered (fx) / bridge / ramp paths keep their old heights.
const PSTEP = 2, pathProf = new Map();
const smoothPath = r => r.t >= 7 && !r.b && !r.fx && !r.ramp && !(r.t !== 8 && r.rg && townDensity(NX(r.p[0]), NZ(r.p[0])) < 0.004);
const pathEnv = new Map(), _pn = [];
function pathProfile(ri) {
  let P = pathProf.get(ri); if (P) return P;
  // side-by-side paths (the seawall's bike lane + walking lane) share the highest ground of both, so they come out level with each other
  const E = pathEnvelope(ri), r = M.roads[ri], hw = r.w / 2, g = Array.from(E.g), n = g.length;
  for (let k = 0; k < n; k++) {
    for (const e of roadGrid.near(E.x[k], E.z[k], hw + 4, _pn)) {
      if (e.r === ri) continue; const q = M.roads[e.r]; if (!(q.sm ?? (q.sm = smoothPath(q)))) continue;
      const ax = NX(e.a), az = NZ(e.a), dx = NX(e.b) - ax, dz = NZ(e.b) - az, L2 = dx * dx + dz * dz || 1, t = clamp(((E.x[k] - ax) * dx + (E.z[k] - az) * dz) / L2, 0, 1);
      if (Math.hypot(E.x[k] - ax - dx * t, E.z[k] - az - dz * t) > hw + q.w / 2 + 1.5) continue;
      const B = pathEnvelope(e.r), f = clamp(e.s0 + t * e.len, 0, B.L) / PSTEP, i = Math.min(Math.floor(f), B.g.length - 2);
      const bg = B.g[i] + (B.g[i + 1] - B.g[i]) * (f - i);
      if (bg < E.c[k] + 1.8) g[k] = Math.max(g[k], bg);   // not a trail on the cliff above you

    }
  }
  const W = 6, dil = g.map((_, k) => { let m = -1e9; for (let j = Math.max(0, k - W); j <= Math.min(n - 1, k + W); j++) m = Math.max(m, g[j]); return m; });
  let y = dil.map((_, k) => { let m = 1e9; for (let j = Math.max(0, k - W); j <= Math.min(n - 1, k + W); j++) m = Math.min(m, dil[j]); return Math.min(m, g[k] + 1.0); });
  for (let it = 0; it < 6; it++) {   // smooth, but never (more than a few cm) below the ground
    const A = 3, s = y.map((_, k) => { let t = 0, c = 0; for (let j = Math.max(0, k - A); j <= Math.min(n - 1, k + A); j++) { t += y[j]; c++; } return t / c; });
    y = s.map((v, k) => Math.min(E.c[k] + 2.2, Math.max(v, g[k] - (it === 5 ? 0.06 : 0))));   // and never more than 2.2 m over it (feet / wheels let go at 3 m)
  }
  P = { y: Float32Array.from(y), L: E.L }; pathProf.set(ri, P); return P;
}
function pathEnvelope(ri) {   // the highest drawn ground across the path's width, every 2 m along it
  let E = pathEnv.get(ri); if (E) return E;
  const r = M.roads[ri], hw = Math.max(r.w / 2, 0.9), g = [], X = [], Z = [], C = [];
  const cum = [0]; for (let i = 1; i < r.p.length; i++) cum.push(cum[i - 1] + Math.hypot(NX(r.p[i]) - NX(r.p[i - 1]), NZ(r.p[i]) - NZ(r.p[i - 1])));
  const Lt = cum[cum.length - 1], n = Math.max(2, Math.ceil(Lt / PSTEP) + 1); let seg = 1;
  for (let k = 0; k < n; k++) {
    const s = Math.min(Lt, k * PSTEP); while (seg < cum.length - 1 && cum[seg] < s) seg++;
    const a = r.p[seg - 1], b = r.p[seg], t = (s - cum[seg - 1]) / (cum[seg] - cum[seg - 1] || 1);
    const x = NX(a) + (NX(b) - NX(a)) * t, z = NZ(a) + (NZ(b) - NZ(a)) * t, L = Math.hypot(NX(b) - NX(a), NZ(b) - NZ(a)) || 1, px = -(NZ(b) - NZ(a)) / L * hw, pz = (NX(b) - NX(a)) / L * hw;
    const c = groundY(x, z); X.push(x); Z.push(z); C.push(c);
    g.push(Math.min(c + 0.45, Math.max(c, groundY(x + px, z + pz) - 0.25, groundY(x - px, z - pz) - 0.25)));   // a steep side slope may cover the top edge a little (the data smears cliffs)
  }
  E = { g: Float32Array.from(g), c: C, x: X, z: Z, L: Lt }; pathEnv.set(ri, E); return E;
}
export const _pathDebug = { pathProfile: ri => pathProfile(ri), pathEnvelope: ri => pathEnvelope(ri), smoothPath: r => smoothPath(r), profAt: (P, s) => profAt(P, s) };   // tools/pathcheck.js
function profAt(P, s) { const f = clamp(s, 0, P.L) / PSTEP, i = Math.min(Math.floor(f), P.y.length - 2), t = f - i; return P.y[i] + (P.y[i + 1] - P.y[i]) * t; }
// a skirt down from a level path's edge to the ground wherever the ground falls away below it
function pathSkirt(pts, lat, mat) {
  const b = bucket(pts[0].x, pts[0].z, mat);
  for (let i = 1; i < pts.length; i++) {
    const e = [pts[i - 1], pts[i]].map((p, k) => { const q = pts[Math.min(i - 1 + k + 1, pts.length - 1)], o = pts[Math.max(i - 1 + k - 1, 0)]; let dx = q.x - o.x, dz = q.z - o.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L; const x = p.x - dz * lat, z = p.z + dx * lat; return { x, z, top: p.y, bot: groundY(x, z) - 0.15 }; });
    if (e[0].top - e[0].bot < 0.27 && e[1].top - e[1].bot < 0.27) continue;
    const k = b.pos.length / 3;
    for (const v of e) { b.pos.push(v.x, v.bot, v.z, v.x, v.top, v.z); b.uv.push(0, 0, 0.3, 0); }
    if (lat > 0) b.idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); else b.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);   // face outward
  }
}
// the height of the DRAWN street / sidewalk / path here (they sit a little above the ground), or null if not on one
const _ws = [];
export function pavedY(x, z) {
  let best = null, onRoad = null;   // a street you're ON beats any sidewalk that overlaps it (that flip-flop made cars bounce)
  for (const e of roadGrid.near(x, z, 4, _ws)) {
    const r = M.roads[e.r]; if (r.b) continue; if (r.t >= 7 && r.rg && isSnow(x, z)) continue;   // trails buried under mountain snow
    const ax = NX(e.a), az = NZ(e.a), dx = NX(e.b) - ax, dz = NZ(e.b) - az, L2 = dx * dx + dz * dz || 1, t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1), d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    const hw = r.w / 2, side = hasWalk(r); if (d > hw + (side ? 2.6 : 0.3)) continue;
    if (r.sm ?? (r.sm = smoothPath(r))) {   // level, smoothed path (the part inside a street's strip isn't drawn: don't stand on it)
      const y = profAt(pathProfile(e.r), e.s0 + t * e.len) + 0.14 + (e.r % 9) * 0.004;
      const gy = groundY(x, z); if (y > gy + 2.9 || (y > gy + 0.45 && inStreet(x, z, hw))) continue;   // (the edge of a higher lane beside yours)
      if (best === null || y > best) best = y; continue;
    }
    const y = (r.fx ? Math.max(nodeY[e.a] + (nodeY[e.b] - nodeY[e.a]) * t, groundY(x, z)) : groundY(x, z) + rampOff(r, e.s0 + t * e.len)) + (r.t <= 4 ? 0.26 : r.t <= 6 ? 0.22 : 0.14) + (e.r % 9) * 0.004 + (d > hw ? CURB : 0);
    if (best === null || y > best) best = y;
    if (d <= hw && r.t <= 6 && (onRoad === null || y > onRoad)) onRoad = y;
  }
  return onRoad !== null ? onRoad : best;
}
// where feet / wheels should be: the drawn pavement if you're on one (and it's not far above), else the ground or deck
export function walkY(x, z, curY = 1e9) { const s = surfaceY(x, z, curY), p = pavedY(x, z); return p !== null && p > s && (p < s + 3 || p < groundY(x, z) + 1.2) ? p : s; }   // a street drawn on low land the water mask calls "sea" still holds you up
const _is = [];
function inStreet(x, z, pad) {   // inside a ground-level street's road + generated sidewalk?
  for (const e of roadGrid.near(x, z, 6, _is)) {
    const q = M.roads[e.r]; if (q.t > 6 || q.b) continue;
    const ax = NX(e.a), az = NZ(e.a), dx = NX(e.b) - ax, dz = NZ(e.b) - az, L2 = dx * dx + dz * dz || 1, t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
    const side = hasWalk(q) ? 2.6 : 0;
    if (Math.hypot(x - ax - dx * t, z - az - dz * t) < q.w / 2 + side + pad * 0.5) return true;
  }
  return false;
}
function roadGeometry(r, ri) {   // the drawn part of a road (made per tile, only near the player)
  const jitter = (ri % 9) * 0.004, t = r.t, hw = r.w / 2;
  const wildTrail = t >= 7 && t !== 8 && r.rg && townDensity(NX(r.p[0]), NZ(r.p[0])) < 0.004;
  const su = r.su || 0, foot = t === 7 || t === 9;
  const fmat = r.s ? 'steps' : su === 3 ? 'board' : su === 2 ? 'gravel' : (su === 1 || (r.sc && su !== 4) || wildTrail) ? 'trail' : 'path';
  const mat = t <= 4 ? 'arterial' : t <= 6 ? 'local' : t === 8 ? 'cycle' : foot ? fmat : 'path';
  const lift = (t <= 4 ? 0.26 : t <= 6 ? 0.22 : 0.14) + jitter, pts = roadPoints(r, lift);
  if (t >= 7 && !r.b) {   // a path / mapped sidewalk: skip the stretches that lie inside a street's own road + sidewalk strip
    const tw = mat === 'trail' ? Math.min(hw, 0.75) : mat === 'gravel' ? Math.min(hw, 1.3) : hw;   // dirt singletrack is narrow, gravel paths a bit wider
    const vs = mat === 'steps' ? 2.8 : mat === 'board' ? 1.2 : mat === 'trail' ? 0.12 : 0.25;   // stair treads every ~36 cm, planks across
    const lvl = r.sm ?? (r.sm = smoothPath(r)), skirt = mat === 'trail' || mat === 'gravel' ? 'bank' : 'curb';
    if (lvl) { const P = pathProfile(ri); let s = 0; pts.forEach((p, i) => { if (i) s += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z); p.y = profAt(P, s) + lift; delete p.d; }); }
    let run = []; const flush = () => { if (run.length > 1) { ribbon(run, -tw, tw, mat, vs); if (lvl) { pathSkirt(run, tw, skirt); pathSkirt(run, -tw, skirt); } } run = []; };
    for (const p of pts) { if (inStreet(p.x, p.z, hw)) flush(); else run.push(p); }
    flush(); return;
  }
  ribbon(pts, -hw, hw, (t <= 4 && r.o) ? (r.w >= 8 ? 'oneway' : 'local') : mat, t <= 6 ? 0.08 : 0.25);
  if (hasWalk(r)) { const sp = trimAtJunctions(r, pts.map(p => ({ x: p.x, z: p.z, y: p.y + CURB, d: p.d !== undefined ? p.d + CURB : undefined }))); if (sp.length > 1) { ribbon(sp, hw, hw + 2.6, 'walk', 0.2); ribbon(sp, -hw - 2.6, -hw, 'walk', 0.2); for (const s2 of [-1, 1]) curbFace(sp, s2 * hw); } }
  if ((r.fx || r.ramp || r.b && r.rg) && t <= 6) { if (!r.b) for (const s of [-1, 1]) sideWall(pts, s * hw, -14, 'bank'); if (t <= 3 && !r.ramp) for (const s of [-1, 1]) sideWall(pts, s * (hw + 0.3), 0.8, 'rail'); }
  if (r.b) { const under = pts.map(p => ({ ...p, y: p.y - 1.4 })); for (const s of [-1, 1]) { sideWall(pts, s * hw, -1.5, 'deck'); sideWall(pts, s * (hw - 0.2), 1.1, 'rail'); } ribbon(under, -hw, hw, 'deck', 0.1); }
}
function buildRoads() {
  const pillars = [];
  M.roads.forEach((r, ri) => {
    const k0 = r.p[0], key = Math.floor(NX(k0) / CHUNK) + ',' + Math.floor(NZ(k0) / CHUNK);
    let tile = roadTiles.get(key); if (!tile) { const [i, j] = key.split(',').map(Number); roadTiles.set(key, tile = { cx: (i + 0.5) * CHUNK, cz: (j + 0.5) * CHUNK, roads: [], meshes: null }); } tile.roads.push(ri);
    if (!r.b && !r.fx && !r.ramp) return;   // plain (draped) streets need nothing more until they are drawn
    const jitter = (ri % 9) * 0.004;
    const t = r.t, hw = r.w / 2;
    const lift = (t <= 4 ? 0.26 : t <= 6 ? 0.22 : 0.14) + jitter;
    if (r.ramp) {   // the raised part of a ramped street is a deck you drive up (and pillars hold it up if it gets high)
      const rp = roadPoints(r, lift);
      for (let i = 1; i < rp.length; i++) { const a = rp[i - 1], b = rp[i]; if (a.d < 0.7 && b.d < 0.7) continue; bridgeGrid.addBox(Math.min(a.x, b.x) - hw, Math.min(a.z, b.z) - hw, Math.max(a.x, b.x) + hw, Math.max(a.z, b.z) + hw, { ax: a.x, az: a.z, ay: a.y, bx: b.x, bz: b.z, by: b.y, hw }); }
      return;
    }
    const pts = r.b || r.fx ? roadPoints(r, lift) : null;
    if (r.fx && !r.b) {   // engineered road: the drivable surface follows the drawn one (incl. where it rides over a hump)
      for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; bridgeGrid.addBox(Math.min(a.x, b.x) - hw, Math.min(a.z, b.z) - hw, Math.max(a.x, b.x) + hw, Math.max(a.z, b.z) + hw, { ax: a.x, az: a.z, ay: a.y, bx: b.x, bz: b.z, by: b.y, hw }); }
      return;
    }
    if (r.b && r.rg && t <= 6) {
      for (let i = 0; i < r.p.length - 1; i++) {
        const a = r.p[i], b = r.p[i + 1];
        bridgeGrid.addBox(Math.min(NX(a), NX(b)) - hw, Math.min(NZ(a), NZ(b)) - hw, Math.max(NX(a), NX(b)) + hw, Math.max(NZ(a), NZ(b)) + hw, { ax: NX(a), az: NZ(a), ay: nodeY[a] + lift, bx: NX(b), bz: NZ(b), by: nodeY[b] + lift, hw });
      }
    }
    if (r.b) {
      // the drivable surface follows the drawn deck exactly (including the clearance arch)
      if (!r.rg || t > 6) for (let i = 1; i < pts.length; i++) {   // (region bridge FOOTpaths had no walkable deck at all)
        const a = pts[i - 1], b = pts[i];
        bridgeGrid.addBox(Math.min(a.x, b.x) - hw, Math.min(a.z, b.z) - hw, Math.max(a.x, b.x) + hw, Math.max(a.z, b.z) + hw, { ax: a.x, az: a.z, ay: a.y, bx: b.x, bz: b.z, by: b.y, hw });
      }
      let acc = 0;
      for (let i = 1; i < pts.length; i++) {
        acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
        if (acc < 32) continue; acc = 0;
        const g = heightAt(pts[i].x, pts[i].z); if (pts[i].y - g < 4) continue;
        if (roadBelow(pts[i].x, pts[i].z, r)) continue;
        pillars.push({ x: pts[i].x, z: pts[i].z, top: pts[i].y - 1.4, bot: Math.min(g, -1) - 2, r: Math.max(1, hw * 0.12) });
      }
    }
  });
  setColliders('roadPillars', pillars.map(p => ({ x: p.x, z: p.z, r: p.r, top: p.top })));
  if (pillars.length) {
    const m = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.2, 1, 10).translate(0, 0.5, 0), std('#a8a399'), pillars.length), o = new THREE.Object3D();
    pillars.forEach((p, i) => { o.position.set(p.x, p.bot, p.z); o.scale.set(p.r, p.top - p.bot, p.r); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
    m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere(); scene.add(m);
  }
}
// is there a street (or path) right here, under a bridge? (pillars must not stand in it)
const _rb = [];
function roadBelow(x, z, self) {
  for (const e of roadGrid.near(x, z, 3, _rb)) {
    const q = M.roads[e.r]; if (q === self || (q.b && q !== self && false) || q.t > 7) continue;
    const ax = NX(e.a), az = NZ(e.a), dx = NX(e.b) - ax, dz = NZ(e.b) - az, L2 = dx * dx + dz * dz || 1, t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
    if (Math.hypot(x - ax - dx * t, z - az - dz * t) < q.w / 2 + 2) return true;
  }
  return false;
}
const CURB = 0.16;
// which streets get generated sidewalks: city streets incl. the in-town highway routes (Howe, Georgia, Oak…), not bridges / mountain highways
const hasWalk = r => !r.b && ((r.t >= 2 && r.t <= 5 && !(r.rg && r.t <= 3)) || (r.t === 1 && !r.rg));
// the vertical face of the curb between street and sidewalk (follows the drape like the ribbons)
function curbFace(pts, lat) {
  const b = bucket(pts[0].x, pts[0].z, 'curb'), base = b.pos.length / 3; let dist = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
    let dx = q.x - o.x, dz = q.z - o.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const x = p.x - dz * lat, z = p.z + dx * lat, top = p.d !== undefined ? groundY(x, z) + p.d : p.y;
    if (i) dist += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    b.pos.push(x, top - CURB - 0.03, z, x, top + 0.005, z); b.uv.push(0, dist * 0.1, 1, dist * 0.1);
    if (i > 0) { const k = base + (i - 1) * 2; if (lat > 0) b.idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); else b.idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }   // face the street
  }
}
function sideWall(pts, lat, height, mat) {
  const b = bucket(pts[0].x, pts[0].z, mat), base = b.pos.length / 3; let dist = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)];
    let dx = q.x - o.x, dz = q.z - o.z; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    const x = p.x - dz * lat, z = p.z + dx * lat;
    if (i) dist += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    b.pos.push(x, p.y, z, x, p.y + height, z); b.uv.push(0, dist * 0.1, 1, dist * 0.1);
    if (i > 0) { const k = base + (i - 1) * 2; b.idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
}

// Height of whatever you're standing/driving on (terrain or a bridge deck you are on)
const _near = [];
// flat surfaces you can stand/drive/land on (airport aprons)
const flatGrid = new Grid(60);
export function addFlatSurface(p, y) { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); } flatGrid.addBox(x0, z0, x1, z1, { p, y, x0, z0, x1, z1 }); }
export function addDeck(ax, az, ay, bx, bz, by, hw) { bridgeGrid.addBox(Math.min(ax, bx) - hw, Math.min(az, bz) - hw, Math.max(ax, bx) + hw, Math.max(az, bz) + hw, { ax, az, ay, bx, bz, by, hw }); }
const _fl = [];
export function surfaceY(x, z, curY = 1e9) {
  const h0 = heightAt(x, z), gd = groundY(x, z), g0 = gd < -0.3 && h0 < 0.5 && isWater(x, z) ? h0 : gd; let best = g0;   // on land: exactly the DRAWN ground   // never below the DRAWN ground (in places the raw heights dip to the sea floor)
  // a surface can be stepped onto if it's within reach of where you are now, OR so close to the ground that nothing
  // could be under it anyway (bridge ends, embankments): you can't drive "under" a deck 2 m above the dirt
  const reach = y => y <= curY + 2.2 || y < g0 + 2.2;
  for (const f of flatGrid.near(x, z, 0, _fl)) if (x > f.x0 && x < f.x1 && z > f.z0 && z < f.z1 && f.y > best && reach(f.y) && inPoly(x, z, f.p)) best = f.y;
  for (const s of bridgeGrid.near(x, z, 1, _near)) {
    const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz; if (!L2) continue;
    const t = ((x - s.ax) * dx + (z - s.az) * dz) / L2; if (t < -0.02 || t > 1.02) continue;
    const lat = Math.abs((x - s.ax) * dz - (z - s.az) * dx) / Math.sqrt(L2); if (lat > s.hw + 0.3) continue;
    const y = s.ay + (s.by - s.ay) * clamp(t, 0, 1);
    if (y > best && reach(y)) best = y;
  }
  return best;
}
export function onBridgeDeck(x, z, y) { return surfaceY(x, z, y) > heightAt(x, z) + 1; }

// ---------- buildings ----------
function facadeMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.1, envMapIntensity: 0.9 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uNight = { value: 0 }; sh.uniforms.uCitySnow = SNOW_U.city; m.userData.sh = sh;
    sh.vertexShader = 'attribute float aStyle;\nvarying float vStyle;\nvarying vec3 vWP;\nvarying vec3 vWN;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vStyle = aStyle; vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = `varying float vStyle; varying vec3 vWP; varying vec3 vWN; uniform float uNight; uniform float uCitySnow;
float fHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float fNoise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(mix(fHash(i), fHash(i + vec3(1,0,0)), f.x), mix(fHash(i + vec3(0,1,0)), fHash(i + vec3(1,1,0)), f.x), f.y), mix(mix(fHash(i + vec3(0,0,1)), fHash(i + vec3(1,0,1)), f.x), mix(fHash(i + vec3(0,1,1)), fHash(i + vec3(1,1,1)), f.x), f.y), f.z); }
` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float sty = floor(vStyle + 0.0001), bse = fract(vStyle + 0.0001) / 0.98 * 2000.0 - 100.0;
      // every building is a little different: a seed from its colour + where it stands
      float sd = fHash(floor(diffuseColor.rgb * 255.0) + vec3(floor(bse * 0.7), 3.0, 1.0)), sd2 = fract(sd * 7.31), sd3 = fract(sd * 3.17);
      vec4 P; vec3 gl; vec2 gm;
      if (sty < 0.5)      { P = vec4(3.4 + sd3 * 0.6, 1.5, 0.9, 0.82); gl = sd2 < 0.55 ? mix(vec3(0.05, 0.2, 0.2), vec3(0.06, 0.16, 0.25), sd2 / 0.55) : mix(vec3(0.07, 0.2, 0.16), vec3(0.1, 0.16, 0.22), (sd2 - 0.55) / 0.45); gm = vec2(0.04, 0.95); }   // glass tower: green-teal to blue (reflections take this tint)
      else if (sty < 1.5) { P = vec4(3.0 + sd3 * 0.5, 2.6 + sd2 * 1.4, 0.45 + sd * 0.3, 0.45 + sd2 * 0.2); gl = vec3(0.08, 0.11, 0.13); gm = vec2(0.10, 0.70); }   // concrete
      else if (sty < 2.5) { P = vec4(3.6 + sd3 * 0.5, 2.6 + sd * 1.2, 0.38 + sd2 * 0.2, 0.5 + sd * 0.15); gl = vec3(0.07, 0.08, 0.09); gm = vec2(0.15, 0.50); }   // brick
      else if (sty < 3.5) { P = vec4(2.9 + sd3 * 0.3, 3.2 + sd * 1.8, 0.28 + sd2 * 0.12, 0.38 + sd * 0.1); gl = vec3(0.09, 0.10, 0.11); gm = vec2(0.20, 0.40); }   // house
      else if (sty < 4.5) { P = vec4(5.0, 7.0, 0.70, 0.22); gl = vec3(0.12, 0.13, 0.14); gm = vec2(0.30, 0.30); }   // industrial
      else                { P = vec4(4.4, 5.0, 0.85, 0.62); gl = vec3(0.07, 0.10, 0.12); gm = vec2(0.08, 0.70); }   // shop
      float fTop = step(0.6, vWN.y), fRoof = step(5.5, sty), fWall = (1.0 - fTop) * (1.0 - fRoof);
      float fU = abs(vWN.x) > abs(vWN.z) ? vWP.z : vWP.x, rel = vWP.y - bse;
      bool shopLevel = ((sty < 0.5 && sd2 > 0.3) || (sty > 1.5 && sty < 2.5 && sd2 > 0.55) || (sty > 4.5 && sty < 5.5)) && rel < 4.4;   // a storefront ground floor on most city buildings
      float up = max(0.0, rel - (((sty < 0.5 && sd2 > 0.3) || (sty > 1.5 && sty < 2.5 && sd2 > 0.55) || (sty > 4.5 && sty < 5.5)) ? 4.4 : 0.0));
      float fFl = fract(up / P.x), fCl = fract(fU / P.y);
      float fWin = step(0.5 - P.w * 0.5, fFl) * step(fFl, 0.5 + P.w * 0.5) * step(0.5 - P.z * 0.5, fCl) * step(fCl, 0.5 + P.z * 0.5) * fWall;
      // RECESSED WINDOWS (2026-11-22): punched windows are set back into the wall (20 cm, houses 12 cm). Follow the view ray
      // into the wall to the glass plane: if it still lands inside this opening you see glass (its details shift with
      // parallax), otherwise you're looking at the reveal (the inner side of the opening): shaded soffit on top, a lit sill
      // at the bottom, half-shaded jambs at the sides. Flat painted windows were the main "blocky box" giveaway.
      float rvl = 0.0, rvShade = 1.0;
      if (sty > 0.5 && sty < 4.5 && fWin > 0.5 && !(shopLevel && rel < 4.4)) {
        vec3 Vv = normalize(cameraPosition - vWP); vec3 Tt = abs(vWN.x) > abs(vWN.z) ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
        float vn = max(abs(dot(Vv, vWN)), 0.12), dep = (sty > 2.5 && sty < 3.5) ? 0.12 : 0.2;
        float up2 = up - Vv.y * dep / vn, fU2 = fU - dot(Vv, Tt) * dep / vn;
        float wyc = (up2 / P.x - floor(up / P.x) - (0.5 - P.w * 0.5)) / P.w, wxc = (fU2 / P.y - floor(fU / P.y) - (0.5 - P.z * 0.5)) / P.z;
        float in2 = step(0.0, wyc) * step(wyc, 1.0) * step(0.0, wxc) * step(wxc, 1.0);
        rvl = 1.0 - in2;
        rvShade = wyc > 1.0 ? 0.42 : wyc < 0.0 ? 0.92 : 0.66;   // soffit / sill / jambs
        if (in2 > 0.5) { fFl = fract(up2 / P.x); fCl = fract(fU2 / P.y); }
      }
      float fR = fHash(floor(vec3(fU / P.y, up / P.x, vWN.x * 3.0 + vWN.z * 7.0)) + 0.5 + sd);
      float fBl = step(0.86, fR);
      vec3 wall = diffuseColor.rgb;
      // weathering: faint vertical streaks + grime near the ground (not on glass)
      float streak = fHash(vec3(floor(fU * 0.8), 1.0, sd)) * 0.5 + fHash(vec3(floor(fU * 2.3), 2.0, sd)) * 0.5;
      if (sty > 0.5 && sty < 5.5) wall *= 0.9 + 0.14 * streak - 0.12 * (1.0 - smoothstep(0.0, 1.4, rel));
      // soft stains and sun-faded patches (smooth noise, readable from any distance), a concrete foundation strip on houses
      if (sty > 0.5 && sty < 5.5) wall *= 0.9 + 0.17 * fNoise(vWP * 0.33 + sd * 17.0) + 0.06 * fNoise(vWP * 1.7 + sd * 5.0);
      if (sty > 2.5 && sty < 3.5) wall = mix(wall, vec3(0.5, 0.49, 0.46), step(rel, 0.55) * fWall);
      vec3 fGl = gl * (0.75 + 0.5 * fR) + wall * 0.08;
      fGl = mix(fGl, vec3(0.55, 0.5, 0.42), fBl * 0.6);
      float wyG = (fFl - (0.5 - P.w * 0.5)) / P.w, wxG = (fCl - (0.5 - P.z * 0.5)) / P.z;
      if (sty > 0.5 && sty < 5.5) {
        // glass reflects the sky (lighter towards the top of each pane) with a soft diagonal sheen
        fGl = mix(fGl, vec3(0.42, 0.52, 0.62), clamp(wyG, 0.0, 1.0) * 0.2 * (1.0 - fBl));
        float shn = fract(wxG * 0.7 + wyG * 0.5 + fR * 3.0); fGl += vec3(0.06, 0.07, 0.08) * smoothstep(0.3, 0.45, shn) * (1.0 - smoothstep(0.5, 0.65, shn));
        // life behind the windows: blinds part-way down, curtains, a pot plant on the sill
        float kind = fract(fR * 13.7);
        if (kind < 0.22) { float bh = 0.25 + fract(fR * 31.0) * 0.5; fGl = mix(fGl, vec3(0.74, 0.7, 0.62) * (0.88 + 0.12 * step(0.5, fract(wyG * 20.0))), step(1.0 - bh, wyG)); }
        else if (kind < 0.4) { float cw = 0.15 + fract(fR * 17.0) * 0.12, cu = clamp(step(wxG, cw) + step(1.0 - cw, wxG), 0.0, 1.0); vec3 cc = vec3(0.45 + 0.45 * fract(fR * 5.1), 0.35 + 0.4 * fract(fR * 7.3), 0.3 + 0.4 * fract(fR * 9.7)); fGl = mix(fGl, cc * 0.7, cu); }
        else if (kind < 0.47) { float pl = step(length(vec2((wxG - 0.3) * P.z * P.y, (wyG - 0.12) * P.w * P.x)), 0.22); fGl = mix(fGl, vec3(0.12, 0.3, 0.1), pl); }
        // panes: a glazing bar across the middle of house / brick windows
        if (sty > 1.5 && sty < 3.5) fGl = mix(fGl, vec3(0.85, 0.84, 0.8) * (sty > 2.5 ? 1.0 : 0.25), step(abs(wyG - 0.6), 0.025) * (1.0 - step(0.9, fract(fR * 3.3))));
      }
      // glass curtain walls: thin mullions; residential towers: balcony slabs with glass railings on every floor
      if (sty < 0.5) { float mul = step(fract(fU / 1.5), 0.05) + step(0.94, fFl); fGl = mix(fGl, vec3(0.2, 0.22, 0.24), clamp(mul, 0.0, 1.0) * fWin); }
      float balc = (sty < 1.5 && sd > 0.45 && up > 0.5) ? 1.0 : 0.0;
      diffuseColor.rgb = mix(wall, fGl, fWin);
      diffuseColor.rgb = mix(diffuseColor.rgb, wall * rvShade, rvl);   // the reveal of a recessed window (see above)
      fWin *= 1.0 - rvl;   // the reveal is wall: no glass shine, no frame, never lit at night
      // floor ledges / string courses on many concrete + brick buildings: a pale projecting band at each floor line with a
      // soft shadow tucked under it (breaks up the flat slab walls)
      if (sty > 0.5 && sty < 2.5 && up > 0.5 && sd3 > 0.3) {
        float lf = fract(up / P.x), notWin = fWall * (1.0 - fWin) * (1.0 - rvl);
        diffuseColor.rgb = mix(diffuseColor.rgb, wall * 1.16 + vec3(0.02), step(lf, 0.035) * notWin);
        diffuseColor.rgb *= 1.0 - 0.24 * step(0.955, lf) * notWin;
      }
      float slab = balc * step(fFl, 0.07) * fWall, rail = balc * step(0.07, fFl) * step(fFl, 0.3) * step(0.25, fract(fU / 7.0)) * fWall;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.87, 0.86), slab);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.45, 0.6, 0.66) * 0.6 + diffuseColor.rgb * 0.4, rail * 0.75);
      // the storefront: big shop windows with frames and a sign band above
      float shopWin = 0.0;
      if (shopLevel) { float sc = fract(fU / 2.6); shopWin = step(0.35, rel) * step(rel, 3.3) * step(0.04, sc) * step(sc, 0.96) * fWall; float band = step(3.3, rel) * fWall; diffuseColor.rgb = mix(diffuseColor.rgb, wall * 0.55 + vec3(0.03), band); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.16, 0.17) + vec3(0.06) * fR, shopWin); }
      // ---- close-up surface detail (fades with distance so it never shimmers) ----
      float dU = fwidth(fU) + fwidth(vWP.y), nearA = 1.0 - smoothstep(0.02, 0.08, dU), nearB = 1.0 - smoothstep(0.05, 0.3, dU);
      float wallOnly = fWall * (1.0 - fWin) * (1.0 - shopWin);
      // stucco / concrete / stone grain: every wall surface has a little texture
      if (sty > 0.5) { float gn = fHash(floor(vWP * 9.0) + sd) * 0.6 + fHash(floor(vWP * 2.3) + sd + 3.0) * 0.4; diffuseColor.rgb *= 1.0 + (gn - 0.5) * 0.12 * wallOnly * nearA; }
      if (sty > 1.5 && sty < 2.5) {   // brick: 7.5 cm courses, staggered joints, each brick a slightly different shade
        float row = vWP.y / 0.075, off = mod(floor(row), 2.0) * 0.5, bu = fU / 0.24 + off;
        float mort = max(step(0.84, fract(row)), step(0.93, fract(bu)));
        float bv = fHash(vec3(floor(bu), floor(row), sd + 5.0));
        // fade the courses out BEFORE a brick gets smaller than ~2 pixels (later fading drew wavy moiré rings), into the blended
        // colour bricks + mortar make from afar
        float nearBr = 1.0 - smoothstep(0.012, 0.04, dU);
        vec3 farBrick = mix(diffuseColor.rgb, vec3(0.62, 0.6, 0.56), 0.16);
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(farBrick, mix(diffuseColor.rgb * (0.86 + 0.26 * bv), vec3(0.62, 0.6, 0.56), mort * 0.75), nearBr), wallOnly);
      } else if (sty > 2.5 && sty < 3.5) {   // wood lap siding (the classic Vancouver house): a shadow line under every board
        float bd = fract(vWP.y / 0.18);
        diffuseColor.rgb *= mix(1.0, mix(0.89, 0.78 + 0.22 * smoothstep(0.0, 0.3, bd), 1.0 - smoothstep(0.03, 0.09, dU)), wallOnly);   // (fades to the average shade before the boards alias)
        // white trim at the corners of the wall is suggested by the frames below
      } else if (sty > 3.5 && sty < 4.5) {   // industrial: corrugated metal cladding (vertical ribs every 30 cm), still readable mid-distance
        float rib = abs(fract(fU / 0.3) - 0.5) * 2.0, midR = 1.0 - smoothstep(0.05, 0.15, dU);
        diffuseColor.rgb *= mix(1.0, mix(0.95, 0.8 + 0.28 * smoothstep(0.15, 0.6, rib), midR), wallOnly);
      } else if (sty > 0.5 && sty < 1.5) {   // concrete: panel joints + tie-hole dots
        float j = max(step(0.985, fract(up / P.x)), step(0.99, fract(fU / 3.0)));
        diffuseColor.rgb *= mix(1.0, 0.72, j * wallOnly * nearB);
      }
      if (sty > 0.5 && sty < 4.5) {   // punched windows: a frame, a shadow under the lintel (the window is set back), a stone sill below
        float wy = (fFl - (0.5 - P.w * 0.5)) / P.w, wx = (fCl - (0.5 - P.z * 0.5)) / P.z;
        float fw = 0.085 / max(P.z * P.y, 0.3), fh = 0.085 / max(P.w * P.x, 0.3);
        float frame = (step(wx, fw) + step(1.0 - fw, wx) + step(wy, fh) + step(1.0 - fh, wy) + step(abs(wx - 0.5), fw * 0.5) * step(1.2, P.z * P.y)) * fWin * (1.0 - shopWin);
        vec3 frameCol = (sty > 2.5 || sd3 > 0.55) ? vec3(0.86, 0.85, 0.82) : vec3(0.1, 0.1, 0.11);
        diffuseColor.rgb = mix(diffuseColor.rgb, frameCol, clamp(frame, 0.0, 1.0) * nearB);
        diffuseColor.rgb *= 1.0 - 0.45 * smoothstep(0.7, 1.0, wy) * fWin * (1.0 - shopWin) * nearB;
        float sill = step(-0.06 / max(P.w * P.x, 0.3), wy) * step(wy, 0.0) * step(0.0, wx) * step(wx, 1.0) * fWall * (1.0 - fWin);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.74, 0.72, 0.68), sill * nearB * step(sty, 3.5));
      }
      // flat roofs: light gravel, white/grey membrane or dark tar, by building; seams + grit up close
      { vec3 rc = sd2 < 0.4 ? vec3(0.52, 0.51, 0.49) : sd2 < 0.75 ? vec3(0.72, 0.73, 0.72) : vec3(0.26, 0.265, 0.27);
        float gr = fHash(floor(vWP * 3.0) + sd) * 0.5 + fHash(floor(vWP * 0.6) + sd + 2.0) * 0.5;
        rc *= 0.88 + 0.2 * gr - 0.12 * step(0.97, fract(vWP.x / 6.0 + sd)) * nearB;
        diffuseColor.rgb = mix(diffuseColor.rgb, rc, fTop * (1.0 - fRoof)); }
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.9, 0.94), fTop * uCitySnow * 0.95);
      // ambient occlusion (2026-11-22): walls darken where they meet the ground (contact shadow, so buildings sit on the street
      // instead of floating) and lower floors see less sky than upper floors in a street canyon
      diffuseColor.rgb *= (1.0 - 0.34 * (1.0 - smoothstep(0.0, 1.2, rel)) * fWall) * mix(1.0, 0.86 + 0.14 * smoothstep(2.0, 30.0, rel), fWall);
      fWin = max(fWin, shopWin);
      float fLit = (fWin * step(fR, 0.25 + 0.35 * sd) + shopWin * 0.7) * uNight;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, mix(gm.x, 0.8, fBl), fWin); roughnessFactor = mix(roughnessFactor, 0.9, fTop);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      metalnessFactor = mix(metalnessFactor, mix(gm.y, 0.0, fBl), fWin); metalnessFactor = mix(metalnessFactor, 0.0, fTop);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += fLit * mix(vec3(1.0, 0.8, 0.52), vec3(0.75, 0.85, 1.0), step(0.8, fract(fR * 5.7))) * (0.55 + 0.6 * fR);   // warm lamps, the odd cool TV-blue window`);
  };
  return m;
}
export const BLD_MAT = facadeMaterial();
// rain makes roads darker and shinier
let lastWet = -1; const WET_MATS = [];
// at night the streets get a soft warm glow (as if lit by street lamps), so you can still see where to go
let glowSet = false, lastGlow = -1;
export function setRoadGlow(night) {
  if (!glowSet) { glowSet = true; for (const k of ['arterial', 'local', 'oneway', 'walk', 'cycle', 'path', 'gravel', 'board', 'steps']) { const m = ROAD_MATS[k]; m.emissive = new THREE.Color('#ffd9a8'); m.emissiveMap = m.map; m.emissiveIntensity = 0; m.needsUpdate = true; } ROAD_MATS.deck.emissive = new THREE.Color('#5a5040'); }
  if (Math.abs(night - lastGlow) < 0.01) return; lastGlow = night;
  for (const k of ['arterial', 'local', 'oneway']) ROAD_MATS[k].emissiveIntensity = night * 0.9;
  for (const k of ['walk', 'cycle', 'path']) ROAD_MATS[k].emissiveIntensity = night * 0.35;
  ROAD_MATS.deck.emissiveIntensity = night * 0.6;
}
export function setWetness(w) {
  if (!WET_MATS.length) for (const m of Object.values(ROAD_MATS)) WET_MATS.push({ m, r: m.roughness, c: m.color.clone() });
  if (Math.abs(w - lastWet) < 0.02) return; lastWet = w;
  for (const o of WET_MATS) { o.m.roughness = o.r * (1 - 0.7 * w); o.m.color.copy(o.c).multiplyScalar(1 - 0.35 * w); o.m.envMapIntensity = 0.4 + 0.9 * w; }
  BLD_MAT.roughness = 0.8 - 0.25 * w;
}

// Real looks for iconic buildings (matched by OSM name). c = wall colour, s = facade style (0 glass, 1 concrete/stone with
// windows, 2 brick/masonry, 5 shopfront), rc = roof colour, steep = a tall château roof. From photos/heritage descriptions.
const LANDMARK_LOOK = [
  [/^Fairmont Hotel Vancouver$|^Hotel Vancouver$/, { c: '#b9ae98', s: 2, rc: '#5e9a80', steep: true }],    // grey sandstone, green copper château roof
  [/^Cathedral Place$/, { c: '#cdbfa6', s: 1, rc: '#5e9a80', steep: true }],                             // limestone, faux-copper roof copying the Hotel Vancouver
  [/^Marine Building$/, { c: '#a8714f', s: 2 }],                                                          // Art Deco terracotta + warm brown brick
  [/Former Vancouver Law Courts|Vancouver Art Gallery/, { c: '#cfc6b2', s: 1 }],                          // Rattenbury's granite courthouse (the Art Gallery)
  [/^Law Courts$/, { c: '#bab4a9', s: 0 }],                                                               // Erickson's concrete + sloping glass roof
  [/^Waterfront Station$/, { c: '#9a4632', s: 2 }],                                                       // red brick, white Ionic columns
  [/^Sun Tower$/, { c: '#ddc9a0', s: 2, rc: '#b8734a' }],                                                 // cream terracotta, freshly restored copper dome
  [/^Dominion Building$/, { c: '#9b4b35', s: 2, rc: '#3c3f44' }],                                         // red brick + white terracotta, dark mansard
  [/^Royal Bank Tower$/, { c: '#9aa093', s: 1 }],                                                         // Haddington Island andesite (grey-green stone)
  [/^Scotia Tower$/, { c: '#4f4a46', s: 0 }], [/^TD Tower$|^Royal Centre$/, { c: '#2c2f34', s: 0 }],      // dark granite / black glass towers
  [/^Bentall [1-5]/, { c: '#dcd8d0', s: 1 }],                                                             // white precast + dark windows
  [/^One Wall Centre$|^Wall Centre$/, { c: '#566d82', s: 0 }], [/^MNP Tower$/, { c: '#5f7f9f', s: 0 }],
  [/^Vancouver House$/, { c: '#cdd6da', s: 0 }], [/^Hyatt Vancouver Downtown Alberni$|^Living Shangri-La$|^Shangri-La/, { c: '#5f95a6', s: 0 }],   // (OSM names Living Shangri-La's 201 m tower after the hotel inside) [/^Telus Garden/, { c: '#9fb8c0', s: 0 }], [/^Jameson House$/, { c: '#8aa6a9', s: 0 }],
  [/Harbour Centre/, { c: '#b8b2a6', s: 1 }], [/^BC Hydro$/, { c: '#8fa3a8', s: 1 }],                     // concrete tower; the Electra's blue-grey tile
  [/^Orpheum$/, { c: '#e0d0b0', s: 2 }], [/^Vogue Theatre$/, { c: '#d8d3c8', s: 1 }],
  [/^Sylvia Hotel$/, { c: '#8a4a35', s: 2 }],                                                             // ivy-covered red-brown brick
  [/^Christ Church Cathedral$/, { c: '#c8b48e', s: 2, rc: '#4f5a4f' }], [/^Holy Rosary Cathedral$/, { c: '#a9a397', s: 2, rc: '#4a4644' }],
  [/^Vancouver City Hall$/, { c: '#e3d8bd', s: 1 }], [/^Pacific Central Station$/, { c: '#e6e1d4', s: 1 }],
  [/^Hotel Europe$/, { c: '#a5674b', s: 2 }], [/^The Landing$|^Gastown Hotel$/, { c: '#8f4b33', s: 2 }],
  [/^VPL: Central Library$/, { c: '#c9a582', s: 1 }],                                                     // Safdie's sandstone-coloured "colosseum"
  [/^The Bay Building$/, { c: '#e3d6bb', s: 2 }],                                                         // cream terracotta + Corinthian columns
  [/^Carnegie Library$/, { c: '#c9b28a', s: 2, rc: '#5e9a80' }], [/^Former Main Post Office$/, { c: '#c2bdb2', s: 1 }],
  [/^Guinness Tower$/, { c: '#cbc2b2', s: 1 }], [/^Rogers Arena$|^Pacific Coliseum$|^PNE Forum$/, { c: '#d3d5d4', s: 1 }],
  [/^Museum of Anthropology$/, { c: '#b4aea3', s: 1 }], [/^Museum of Vancouver$/, { c: '#ece9e2', s: 1 }], [/^Vancouver Maritime Museum$/, { c: '#e8e4da', s: 1 }],
  [/^Chinese Cultural Centre/, { c: '#ece6da', s: 5 }], [/^Tap & Barrel Bridges$|^Bridges( Restaurant)?$/, { c: '#f2c230', s: 4 }],   // Bridges: the famous bright-yellow shed on Granville Island [/^Science World$/, { c: '#e8eaea', s: 1 }],
];
const lookByName = n => { if (!n) return null; for (const [re, L] of LANDMARK_LOOK) if (re.test(n)) return L; return null; };
// OSM often names only one part of a landmark (e.g. the Hotel Vancouver's podium); unnamed parts standing inside or right
// next to a named landmark's outline share its look
let lmAreas = null;
function lookFor(b, cx, cz) {
  const own = lookByName(b.n >= 0 ? M.names[b.n] : ''); if (own) return own;
  if (!lmAreas) { lmAreas = []; for (const q of M.blds) { const L = q.n >= 0 && lookByName(M.names[q.n]); if (!L) continue; let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let i = 0; i < q.p.length; i += 2) { x0 = Math.min(x0, q.p[i]); x1 = Math.max(x1, q.p[i]); z0 = Math.min(z0, q.p[i + 1]); z1 = Math.max(z1, q.p[i + 1]); } lmAreas.push({ L, p: q.p, x0: x0 - 6, z0: z0 - 6, x1: x1 + 6, z1: z1 + 6 }); } }
  for (const a of lmAreas) if (cx > a.x0 && cx < a.x1 && cz > a.z0 && cz < a.z1 && inPoly(cx, cz, a.p)) return a.L;
  return null;
}
// Vancouver-flavoured palettes: painted wooden houses, stucco/brick walk-ups, teal-green glass towers
const PAL = {
  // (colour pass: still realistic, but the stucco, paint and cladding you really see around Vancouver, not all beige)
  glass: ['#4f9095', '#3d7f86', '#6aa6aa', '#38708a', '#7fb3b8', '#4f7fa8', '#5e9a9c', '#46799a', '#4a8a7c', '#5f93b0', '#3f7b74', '#6d9fb5'],   // the deep teal / blue-green "Vancouver glass"
  apartment: ['#e3c99a', '#c98a6a', '#a9c4c8', '#efe0bf', '#a0573a', '#9fb894', '#d4a373', '#e8c76a', '#c99a9a', '#f1e7d0', '#88a9c3', '#b7c99a', '#e7a98c', '#7d9fa0', '#d9b8d0', '#f2d48a'],
  stone: ['#c2b49a', '#a99d86', '#d1c3a6', '#9e9584', '#b8a27f'],
  roof: ['#45484d', '#3a3633', '#5b4636', '#8a3b2e', '#3f5f4c', '#4b5f7a', '#6b5544', '#2f3236', '#9a5a3c', '#55585c', '#2f5f6b', '#7a2f2f'],
  concrete: ['#d6cdb8', '#bdb6a8', '#e6dfd0', '#a9a69f', '#d2b48f', '#ece6d8', '#a3a8a6', '#c8bfae', '#b9c4c2'],
  brick: ['#8b4a35', '#a3553a', '#7a3f2e', '#b0674a', '#6f4a3a', '#b9805a', '#94413a', '#c27a55'],
  house: ['#f0dfb4', '#c8d9cc', '#6fa38a', '#2f6b7a', '#e2a93f', '#c0493a', '#4f6e9c', '#22485c', '#9fc2dc', '#f3efe4', '#8c6aa0', '#6b8a50', '#d6704f', '#f6e3b8', '#a3a39a', '#353a42', '#e88a62', '#86bca2', '#3f7f52', '#f0cc6a', '#b04a6a', '#5aa0b8', '#e8b4a0', '#2f5a3a'],
  industrial: ['#8fa3ad', '#7c8f86', '#b5a588', '#4f7891', '#a7563f', '#c9a64a', '#5f7a5a', '#d8d2c2', '#6c7f9a', '#9a4a3a'],
  shop: ['#e2d4b6', '#b8c9b0', '#e8c48a', '#a8bfcf', '#d39a7a', '#f0e6d2', '#9fbfa8', '#c9a0b4', '#e6cf9a'],
  chalet: ['#7a5a3c', '#8b6b4a', '#6b4a32', '#a08060', '#5c4a3a', '#c9b48a', '#9a8f80', '#b8a68a'],
  chinatown: ['#9c2f2a', '#b5873a', '#3f6f5a', '#a8674a', '#8b4a35', '#c9b48a'],
  // Granville Island's painted corrugated-metal sheds (old factories turned into the market, studios and theatres)
  granville: ['#b5402f', '#d9a521', '#2f7fa3', '#3d8f5a', '#2a9187', '#7a4a8f', '#cf6a2c', '#35506b', '#c9473d', '#e0b34a', '#5a8fb8', '#9a3b3b'],
};
const inChinatown = (x, z) => x > 1050 && x < 1900 && z > 80 && z < 620;
export const inGranville = (x, z) => Math.hypot(x + 1032, z - 1305) < 255 && z < 1530;   // Granville Island (49.2712, -123.1342)
const inGastown = (x, z) => x > 450 && x < 1300 && z > -320 && z < 120;

// a small box on a roof (no bottom face), drawn in the roof style so it gets no windows
function roofBox(ch, x, y, z, sx, sy, sz, col) {
  const hx = sx / 2, hz = sz / 2, Y = y + sy;
  const faces = [
    [[x - hx, Y, z - hz], [x - hx, Y, z + hz], [x + hx, Y, z + hz], [x + hx, Y, z - hz], [0, 127, 0]],
    [[x - hx, y, z + hz], [x + hx, y, z + hz], [x + hx, Y, z + hz], [x - hx, Y, z + hz], [0, 0, 127]],
    [[x + hx, y, z - hz], [x - hx, y, z - hz], [x - hx, Y, z - hz], [x + hx, Y, z - hz], [0, 0, -127]],
    [[x + hx, y, z + hz], [x + hx, y, z - hz], [x + hx, Y, z - hz], [x + hx, Y, z + hz], [127, 0, 0]],
    [[x - hx, y, z - hz], [x - hx, y, z + hz], [x - hx, Y, z + hz], [x - hx, Y, z - hz], [-127, 0, 0]],
  ];
  for (const [a, b, c, d, n] of faces) { const k = ch.pos.length / 3; for (const v of [a, b, c, d]) { ch.pos.push(...v); ch.nor.push(...n); ch.col.push(...col); ch.sty.push(6); } ch.idx.push(k, k + 1, k + 2, k, k + 2, k + 3); }
}
// adds a gabled or hipped roof (with a little overhang) on top of a box-like house
function addRoof(ch, R, top, wallCol, cx, cz) {
  const { ux, uz, vx, vz, u0, u1, v0, v1, rh, hip, rc } = R, vm = (v0 + v1) / 2, ov = 0.4, drop = ov * rh / ((v1 - v0) / 2);
  const W = (u, v, y) => [u * ux + v * vx, y, u * uz + v * vz];
  const ou = hip ? ov : 0.25, eY = top - drop;
  const e00 = W(u0 - ou, v0 - ov, eY), e10 = W(u1 + ou, v0 - ov, eY), e11 = W(u1 + ou, v1 + ov, eY), e01 = W(u0 - ou, v1 + ov, eY);
  const r0 = W(u0 + hip - (hip ? 0 : ou), vm, top + rh), r1 = W(u1 - hip + (hip ? 0 : ou), vm, top + rh);
  const roofC = [Math.round(rc.r * 255), Math.round(rc.g * 255), Math.round(rc.b * 255)];
  const centre = [cx, top, cz];
  // one flat polygon, wound so its normal points away from the middle of the house
  const face = (vs, colr, style) => {
    const [a, b, c] = vs, n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
    const L = Math.hypot(...n) || 1; let nx = n[0] / L, ny = n[1] / L, nz = n[2] / L;
    const mx = vs.reduce((s, v) => s + v[0], 0) / vs.length, my = vs.reduce((s, v) => s + v[1], 0) / vs.length, mz = vs.reduce((s, v) => s + v[2], 0) / vs.length;
    const out = (mx - centre[0]) * nx + (my - centre[1] + 0.01) * ny + (mz - centre[2]) * nz < 0;
    if (out) { vs = vs.slice().reverse(); nx = -nx; ny = -ny; nz = -nz; }
    const k = ch.pos.length / 3;
    for (const v of vs) { ch.pos.push(v[0], v[1], v[2]); ch.nor.push(nx * 127, ny * 127, nz * 127); ch.col.push(...colr); ch.sty.push(style); }
    for (let i = 1; i < vs.length - 1; i++) ch.idx.push(k, k + i, k + i + 1);
  };
  face([e00, e10, r1, r0], roofC, 6); face([e11, e01, r0, r1], roofC, 6);
  if (hip) { face([e01, e00, r0], roofC, 6); face([e10, e11, r1], roofC, 6); }
  else {   // gable ends are part of the wall (house colour, with windows)
    const g0a = W(u0, v0, top), g0b = W(u0, v1, top), g0r = W(u0, vm, top + rh), g1a = W(u1, v0, top), g1b = W(u1, v1, top), g1r = W(u1, vm, top + rh);
    face([g0a, g0b, g0r], wallCol, 3); face([g1a, g1b, g1r], wallCol, 3);
  }
}
const BT = 600;   // building tile size (m)
function buildBuildings(progress) {
  const chunks = new Map();
  const col = new THREE.Color(), tmp = new THREE.Vector2();
  let n = 0;
  for (const b of M.blds) {
    if (++n % 4000 === 0) progress(`Raising buildings… ${n.toLocaleString()} / ${M.blds.length.toLocaleString()}`, 0.35 + 0.35 * n / M.blds.length);
    const p = b.p, cnt = p.length / 2; if (cnt < 3) continue;
    if (b.n >= 0 && /Science World|World of Science|Bloedel Floral Conservatory/i.test(M.names[b.n])) continue;   // replaced by the custom dome
    let cx = 0, cz = 0, gmin = 1e9, gsum = 0;
    for (let i = 0; i < cnt; i++) { cx += p[i * 2]; cz += p[i * 2 + 1]; const g = heightAt(p[i * 2], p[i * 2 + 1]); gmin = Math.min(gmin, g); gsum += g; }
    cx /= cnt; cz /= cnt;
    if (maskAt(cx, cz) === 0) continue;
    const gavg = gsum / cnt; let base = gmin - 1.5, top = Math.max(gavg, 1) + b.h, raised = 0;
    // raised structures (stations/walkways over a street): float them so you can drive underneath
    if (b.mh > 2) raised = b.mh;
    else if (b.h >= 6) {
      // does a street run through this building? (count road sample points inside the footprint)
      let x0b = 1e9, z0b = 1e9, x1b = -1e9, z1b = -1e9;
      for (let i = 0; i < cnt; i++) { x0b = Math.min(x0b, p[i * 2]); x1b = Math.max(x1b, p[i * 2]); z0b = Math.min(z0b, p[i * 2 + 1]); z1b = Math.max(z1b, p[i * 2 + 1]); }
      let inside = 0;
      for (const e of roadGrid.near(cx, cz, Math.max(x1b - x0b, z1b - z0b) / 2 + 5, _r)) {
        const rd = M.roads[e.r]; if (!isDriveType(rd.t) || rd.b) continue;
        const steps = Math.max(2, Math.ceil(e.len / 3));
        for (let s2 = 0; s2 <= steps && inside < 3; s2++) { const x = NX(e.a) + (NX(e.b) - NX(e.a)) * s2 / steps, z = NZ(e.a) + (NZ(e.b) - NZ(e.a)) * s2 / steps; if (x > x0b && x < x1b && z > z0b && z < z1b && inPoly(x, z, p)) inside++; }
        if (inside >= 3) break;
      }
      // big buildings (airport terminals, malls…) are never lifted: the road runs past/under a separate deck, not through them
      if (inside >= 2 && (x1b - x0b) * (z1b - z0b) < 6000) raised = b.ly >= 1 && b.h < 25 ? 6.2 * Math.min(2, b.ly) : 5;   // station/walkway over the street, or an archway
    }
    if (raised) { base = gavg + raised; top = Math.max(top, base + Math.max(3.5, b.h - raised)); }
    const hsh = hash2(Math.round(cx), Math.round(cz));
    // style (real material from the map first, then building type + neighbourhood)
    let area = 0; for (let i = 0, j = cnt - 1; i < cnt; j = i++) area += (p[j * 2] - p[i * 2]) * (p[j * 2 + 1] + p[i * 2 + 1]); area = Math.abs(area / 2);
    const houseLike = b.t === 1 || (b.t === 0 && area < 320 && b.h <= 11) || (b.t === 2 && area < 450 && b.h <= 12);
    let style, pal;
    const gi = b.h < 18 && inGranville(cx, cz);
    if (cz < -30000) { style = b.h > 14 ? 2 : 3; pal = PAL.chalet; }   // Squamish + Whistler: mountain lodges
    else if (gi) { style = 4; pal = PAL.granville; }                     // Granville Island: painted corrugated sheds
    else if (b.m) { [style, pal] = { 1: [2, PAL.brick], 2: [0, PAL.glass], 3: [3, PAL.house], 4: [1, PAL.concrete], 5: [2, PAL.stone], 6: [4, PAL.industrial], 7: [1, PAL.apartment] }[b.m]; }
    else if (houseLike) { style = 3; pal = PAL.house; }
    else if (b.t === 2 && b.h < 20 && !inChinatown(cx, cz) && !inGastown(cx, cz)) { style = hsh < 0.65 ? 1 : 2; pal = style === 1 ? PAL.apartment : PAL.brick; }
    else if (b.t === 4) { style = 4; pal = PAL.industrial; }
    else if (b.h >= 40) { style = hsh < 0.7 ? 0 : 1; pal = style ? PAL.concrete : PAL.glass; }
    else if (inChinatown(cx, cz)) { style = hsh < 0.7 ? 2 : 5; pal = PAL.chinatown; }
    else if (inGastown(cx, cz)) { style = 2; pal = PAL.brick; }
    else if (b.h >= 20) { style = hsh < 0.35 ? 0 : hsh < 0.8 ? 1 : 2; pal = style === 0 ? PAL.glass : style === 1 ? PAL.concrete : PAL.brick; }
    else if (b.t === 3) { style = 5; pal = PAL.shop; }
    else if (b.h < 10) { style = 3; pal = PAL.house; }
    else { style = hsh < 0.45 ? 2 : hsh < 0.85 ? 1 : 5; pal = style === 2 ? PAL.brick : style === 1 ? PAL.concrete : PAL.shop; }
    if (b.c) { try { col.set(b.c); } catch (e) { col.set(pal[Math.floor(hsh * pal.length)]); } } else col.set(pal[Math.floor(hash2(cz, cx) * pal.length) % pal.length]);
    const LK0 = lookFor(b, cx, cz); if (LK0) { col.set(LK0.c); style = LK0.s; }   // iconic buildings: their real colours
    const LK = LK0 && (!LK0.steep || b.h >= 25) ? LK0 : LK0 && { ...LK0, steep: false, rc: null };   // the château roof only on the tall part
    // geometry
    const key = Math.floor(cx / BT) + ',' + Math.floor(cz / BT);
    const pts = []; for (let i = 0; i < cnt; i++) pts.push(new THREE.Vector2(p[i * 2], p[i * 2 + 1]));
    const r = Math.round(col.r * 255), gC = Math.round(col.g * 255), bl = Math.round(col.b * 255);
    // pitched roof (gabled or hipped) for houses, small walk-ups and mountain chalets on box-like footprints
    let roof = null;
    if (((houseLike || gi || (cz < -30000 && b.h <= 14)) && cnt <= 16 && b.rs !== 3 && b.rs !== 6) || (LK && (LK.steep || (LK.rc && [1, 2, 4].includes(b.rs))) && cnt <= 40)) {   // + the real pitched/copper roofs of landmark buildings
      let bestL = 0, ux = 1, uz = 0;
      for (let i = 0; i < cnt; i++) { const a = pts[i], c = pts[(i + 1) % cnt], L = Math.hypot(c.x - a.x, c.y - a.y); if (L > bestL) { bestL = L; ux = (c.x - a.x) / L; uz = (c.y - a.y) / L; } }
      const range = (ax, az) => { let lo = 1e9, hi = -1e9; for (const q of pts) { const d = q.x * ax + q.y * az; lo = Math.min(lo, d); hi = Math.max(hi, d); } return [lo, hi]; };
      let [u0, u1] = range(ux, uz), vx = -uz, vz = ux, [v0, v1] = range(vx, vz);
      if (v1 - v0 > u1 - u0) { [ux, uz, vx, vz] = [vx, vz, -ux, -uz]; [u0, u1] = range(ux, uz); [v0, v1] = range(vx, vz); }   // ridge runs along the long side
      const W = u1 - u0, D = v1 - v0;
      if (D > 3 && area / (W * D) > (LK?.rc ? 0.5 : 0.78)) {
        const half = D / 2, rh = LK?.steep ? Math.min(14, half * 1.1) : Math.min(4.5, half * 0.75), hipped = LK?.steep || b.rs === 2 || b.rs === 4 || (b.rs !== 1 && hash2(cz, cx + 7) > 0.55);
        top -= rh * 0.55;   // the roof is part of the building's height
        let rc = null; if (LK?.rc) rc = new THREE.Color(LK.rc); else if (b.rc) { try { rc = new THREE.Color(b.rc); } catch (e) { rc = null; } }
        if (!rc) rc = new THREE.Color(PAL.roof[Math.floor(hash2(cx + 3, cz) * PAL.roof.length) % PAL.roof.length]);
        roof = { ux, uz, vx, vz, u0, u1, v0, v1, rh, hip: hipped ? Math.min(half, W * 0.3) : 0, rc };
      }
    }
    let items = chunks.get(key); if (!items) chunks.set(key, items = []);
    // OSM often maps the same wall twice (a building and its building:part, or neighbours drawn over each other): give each
    // building's DRAWN outline its own tiny push outward (3–13 cm) and its roof a tiny height nudge, so coplanar walls and
    // roofs never fight (that flicker read as flashing buildings). Collisions keep the real outline.
    const grow = 0.03 + hash2(cx * 1.37, cz * 0.71) * 0.1, gp = new Float32Array(cnt * 2);
    for (let i = 0; i < cnt; i++) { const dx = p[i * 2] - cx, dz = p[i * 2 + 1] - cz, L = Math.hypot(dx, dz) || 1; gp[i * 2] = p[i * 2] + dx / L * grow; gp[i * 2 + 1] = p[i * 2 + 1] + dz / L * grow; }
    items.push({ p: gp, cnt, r, gC, bl, roof, top: top + hash2(cz * 0.9, cx * 1.3) * 0.08, base, raised, style, h: b.h, area, cx, cz });
    // collision record
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (let i = 0; i < cnt; i++) { x0 = Math.min(x0, p[i * 2]); x1 = Math.max(x1, p[i * 2]); z0 = Math.min(z0, p[i * 2 + 1]); z1 = Math.max(z1, p[i * 2 + 1]); }
    const rec = { p: Float32Array.from(p), top, base, raised, x: cx, z: cz, name: b.n >= 0 && b.n !== undefined ? M.names[b.n] : '', h: b.h, x0, z0, x1, z1, house: houseLike && !raised && cz > -30000 && b.t !== 7, bt: b.t, area };
    buildings.push(rec); bldGrid.addBox(x0, z0, x1, z1, rec);
  }
  for (const [key, items] of chunks) { const [i, j] = key.split(',').map(Number); bldTiles.push({ cx: (i + 0.5) * BT, cz: (j + 0.5) * BT, items, mesh: null, tall: items.some(it => it.h >= 35) }); }
}
// ---------- roof edges: every flat roof gets a parapet (low wall + stone coping); brick/stone/older buildings get a projecting
// cornice, glass towers a dark metal crown. Corners are mitred so the ring is closed. ----------
function quadOut(ch, P, n, col, sty) {   // 4 corners [x,y,z]; winding chosen so the face points along n
  const k = ch.pos.length / 3; for (const q of P) { ch.pos.push(q[0], q[1], q[2]); ch.nor.push(Math.round(n[0] * 127), Math.round(n[1] * 127), Math.round(n[2] * 127)); ch.col.push(col[0], col[1], col[2]); ch.sty.push(sty); }
  const ux = P[1][0] - P[0][0], uy = P[1][1] - P[0][1], uz = P[1][2] - P[0][2], vx = P[2][0] - P[0][0], vy = P[2][1] - P[0][1], vz = P[2][2] - P[0][2];
  const cxp = uy * vz - uz * vy, cyp = uz * vx - ux * vz, czp = ux * vy - uy * vx;
  if (cxp * n[0] + cyp * n[1] + czp * n[2] >= 0) ch.idx.push(k, k + 1, k + 2, k, k + 2, k + 3); else ch.idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
}
function ringOffset(pts, d) {   // offset a closed outline outward by d (mitred, clamped at sharp corners); returns [points, edge normals]
  const n = pts.length; let s = 0; for (let i = 0; i < n; i++) { const a = pts[i], c = pts[(i + 1) % n]; s += a.x * c.y - c.x * a.y; }
  const sg = s > 0 ? 1 : -1, en = [];
  for (let i = 0; i < n; i++) { const a = pts[i], c = pts[(i + 1) % n], ex = c.x - a.x, ez = c.y - a.y, L = Math.hypot(ex, ez) || 1; en.push([sg * ez / L, -sg * ex / L]); }
  const out = [];
  for (let i = 0; i < n; i++) { const p0 = en[(i - 1 + n) % n], p1 = en[i]; let mx = p0[0] + p1[0], mz = p0[1] + p1[1]; const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml; const cs = Math.max(0.35, mx * p1[0] + mz * p1[1]); out.push([pts[i].x + mx * d / cs, pts[i].y + mz * d / cs]); }
  return [out, en];
}
function addParapet(ch, pts, top, style, col, cx, cz, h) {
  const n = pts.length; if (n > 60) return;
  const hs = hash2(cx * 1.7, cz * 0.9), ph = style === 0 ? 1.2 + hs * 1.8 : 0.7 + hs * 0.5;   // glass towers: a taller crown
  const oldStyle = style === 2 || style === 5 && hs > 0.5;   // brick / stone / heritage shops: a cornice that sticks out
  const [inner] = ringOffset(pts, -0.28), [outer, en] = ringOffset(pts, oldStyle ? 0.32 : 0.04);
  const wall = style === 0 ? [46, 52, 58] : col, cap = style === 0 ? [70, 76, 82] : [Math.min(255, col[0] * 0.55 + 105), Math.min(255, col[1] * 0.55 + 103), Math.min(255, col[2] * 0.55 + 98)];
  const y0 = oldStyle ? top - 0.55 : top, y1 = top + ph;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, e = en[i], A = pts[i], C = pts[j], Ao = outer[i], Co = outer[j], Ai = inner[i], Ci = inner[j];
    if (Math.hypot(C.x - A.x, C.y - A.y) < 0.3) continue;
    // outer face (no windows: style 6 keeps its own colour)
    quadOut(ch, [[Ao[0], y0, Ao[1]], [Co[0], y0, Co[1]], [Co[0], y1, Co[1]], [Ao[0], y1, Ao[1]]], [e[0], 0, e[1]], oldStyle ? cap : wall, 6);
    if (oldStyle) quadOut(ch, [[A.x, y0, A.y], [C.x, y0, C.y], [Co[0], y0, Co[1]], [Ao[0], y0, Ao[1]]], [0, -1, 0], [Math.round(cap[0] * 0.6), Math.round(cap[1] * 0.6), Math.round(cap[2] * 0.6)], 6);   // cornice underside
    // inner face (seen from the roof) + the coping on top
    quadOut(ch, [[Ai[0], top, Ai[1]], [Ci[0], top, Ci[1]], [Ci[0], y1, Ci[1]], [Ai[0], y1, Ai[1]]], [-e[0], 0, -e[1]], [Math.round(wall[0] * 0.8), Math.round(wall[1] * 0.8), Math.round(wall[2] * 0.8)], 6);
    quadOut(ch, [[Ao[0], y1, Ao[1]], [Co[0], y1, Co[1]], [Ci[0], y1, Ci[1]], [Ai[0], y1, Ai[1]]], [0, 1, 0], cap, 6);
  }
}
// ---------- building geometry is made per 400 m tile, only near the player (keeps memory + load time down) ----------
function emitBuilding(ch, it) {
  const { p, cnt, r, gC, bl, roof, top, base, raised, style, area, cx, cz } = it, b = { h: it.h };
  const pts = []; for (let i = 0; i < cnt; i++) pts.push(new THREE.Vector2(p[i * 2], p[i * 2 + 1]));
  for (let i = 0; i < cnt; i++) {
    const a = pts[i], c = pts[(i + 1) % cnt];
    let ex = c.x - a.x, ez = c.y - a.y; const L = Math.hypot(ex, ez); if (L < 0.01) continue;
    let nx = -ez / L, nz = ex / L;
    const mx = (a.x + c.x) / 2 + nx * 0.05, mz = (a.y + c.y) / 2 + nz * 0.05;
    const flip = inPoly(mx, mz, p);
    if (flip) { nx = -nx; nz = -nz; }
    const k = ch.pos.length / 3;
    ch.pos.push(a.x, base, a.y, c.x, base, c.y, c.x, top, c.y, a.x, top, a.y);
    for (let q = 0; q < 4; q++) { ch.nor.push(nx * 127, 0, nz * 127); ch.col.push(r, gC, bl); ch.sty.push(style); }
    if (!flip) ch.idx.push(k, k + 1, k + 2, k, k + 2, k + 3); else ch.idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
  }
  if (raised) {   // underside, so a raised structure looks solid from the street below
    const tris = THREE.ShapeUtils.triangulateShape(pts, []), bk = ch.pos.length / 3;
    for (const pt of pts) { ch.pos.push(pt.x, base, pt.y); ch.nor.push(0, -127, 0); ch.col.push(r, gC, bl); ch.sty.push(6); }
    for (const [a, b2, c] of tris) { const A = pts[a], B = pts[b2], Cc = pts[c], cross = (B.x - A.x) * (Cc.y - A.y) - (B.y - A.y) * (Cc.x - A.x); if (cross < 0) ch.idx.push(bk + a, bk + c, bk + b2); else ch.idx.push(bk + a, bk + b2, bk + c); }
  }
  if (!roof && b.h >= 6 && cz > -30000 && cnt >= 3) addParapet(ch, pts, top, style, [r, gC, bl], cx, cz, b.h);
  if (roof) addRoof(ch, roof, top, [r, gC, bl], cx, cz);
  else {
    const tris = THREE.ShapeUtils.triangulateShape(pts, []);
    const rk = ch.pos.length / 3;
    for (const pt of pts) { ch.pos.push(pt.x, top, pt.y); ch.nor.push(0, 127, 0); ch.col.push(r, gC, bl); ch.sty.push(style); }
    for (const [a, b2, c] of tris) {
      const A = pts[a], B = pts[b2], C = pts[c];
      const cross = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
      if (cross < 0) ch.idx.push(rk + a, rk + b2, rk + c); else ch.idx.push(rk + a, rk + c, rk + b2);
    }
    // rooftop clutter on bigger flat roofs: AC units, an elevator/stair housing, vents
    if (b.h >= 10 && area > 150 && !raised && cz > -30000) {
      let x0r = 1e9, z0r = 1e9, x1r = -1e9, z1r = -1e9; for (const q of pts) { x0r = Math.min(x0r, q.x); x1r = Math.max(x1r, q.x); z0r = Math.min(z0r, q.y); z1r = Math.max(z1r, q.y); }
      const nBox = 1 + Math.floor(hash2(cx * 0.7, cz * 1.3) * 3.5);
      for (let k = 0; k < nBox; k++) {
        const hx = hash2(cx + k * 3.1, cz), hz = hash2(cz - k * 1.7, cx), bx = x0r + (x1r - x0r) * (0.2 + 0.6 * hx), bz = z0r + (z1r - z0r) * (0.2 + 0.6 * hz);
        if (!inPoly(bx, bz, p) || !inPoly(bx + 2.5, bz, p) || !inPoly(bx - 2.5, bz, p) || !inPoly(bx, bz + 2.5, p) || !inPoly(bx, bz - 2.5, p)) continue;
        const big = k === 0 && b.h > 20, sx = big ? 4 + hx * 2 : 1.4 + hx * 1.6, sz = big ? 4 + hz * 2 : 1.2 + hz * 1.4, sy = big ? 3.2 : 1.1 + hz * 0.6;
        const shade = big ? [Math.round(r * 0.85), Math.round(gC * 0.85), Math.round(bl * 0.85)] : [158, 162, 166];
        roofBox(ch, bx, top, bz, sx, sy, sz, shade);
      }
    }
  }
}
const bldTiles = [];
function makeTileMesh(t) {
  const ch = { pos: [], nor: [], col: [], sty: [], idx: [] };
  for (const it of t.items) { const s0 = ch.sty.length; emitBuilding(ch, it); const fr = Math.max(0, Math.min(1, (it.base + 100) / 2000)) * 0.98; for (let k = s0; k < ch.sty.length; k++) ch.sty[k] += fr; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(ch.pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Int8Array(ch.nor), 3, true));
  geo.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(ch.col), 3, true));
  geo.setAttribute('aStyle', new THREE.BufferAttribute(new Float32Array(ch.sty), 1));
  geo.setIndex(ch.pos.length / 3 > 65000 ? new THREE.Uint32BufferAttribute(ch.idx, 1) : new THREE.Uint16BufferAttribute(ch.idx, 1));
  geo.computeBoundingSphere();
  const m = new THREE.Mesh(geo, BLD_MAT); m.castShadow = true; m.receiveShadow = true; scene.add(m); t.mesh = m;
}
const BLD_NEAR = 4500, BLD_DROP = 5500, SKY_NEAR = 9000, SKY_DROP = 10500;   // tiles with towers stay visible further (the skyline)
// call every frame: builds the nearest missing tiles (all of them within 1.2 km right away), drops far ones
const ROAD_NEAR = 2800, ROAD_DROP = 3400;
function updateRoadTiles(px, pz, budget) {
  const todo = [];
  for (const t of roadTiles.values()) {
    const d = Math.hypot(t.cx - px, t.cz - pz);
    if (t.meshes) { if (d > ROAD_DROP + EXTRA) { for (const m of t.meshes) { scene.remove(m); m.geometry.dispose(); } t.meshes = null; } else for (const m of t.meshes) m.visible = !m.userData.small || d < 1000 + EXTRA * 0.4; }
    else if (d < ROAD_NEAR + EXTRA) todo.push([d, t]);
  }
  todo.sort((a, b) => a[0] - b[0]);
  const t0 = performance.now(); for (const [d, t] of todo) { if (performance.now() - t0 > budget && d > 700) break; for (const ri of t.roads) roadGeometry(M.roads[ri], ri); t.meshes = flushBuckets(true); }
}
let EXTRA = 0;   // when you fly high, roads + buildings are drawn further out
export function updateBuildingTiles(px, pz, budget = 4) {   // budget = milliseconds per frame (tiles right next to you are always made at once)
  const alt = Math.max(0, camera.position.y - heightAt(camera.position.x, camera.position.z)), want = Math.min(3500, Math.max(0, alt - 40) * 5);
  EXTRA = want > EXTRA ? Math.min(want, EXTRA + 60) : Math.max(want, EXTRA - 20);   // grow quickly, shrink slowly (no popping)
  ROAD_LIFT.value = Math.min(1, Math.max(0, (alt - 25) / 120));   // roads only float (anti-flicker) when you're flying
  updateRoadTiles(px, pz, budget);
  let todo = [];
  for (const t of bldTiles) {
    const d = Math.hypot(t.cx - px, t.cz - pz), near = (t.tall ? SKY_NEAR : BLD_NEAR) + EXTRA, drop = (t.tall ? SKY_DROP : BLD_DROP) + EXTRA + 300;
    if (t.mesh && d > drop) { scene.remove(t.mesh); t.mesh.geometry.dispose(); t.mesh = null; }
    else if (!t.mesh && d < near) todo.push([d, t]);
  }
  if (!todo.length) return 0;
  todo.sort((a, b) => a[0] - b[0]);
  const t0 = performance.now(); let n = 0; for (const [d, t] of todo) { if (performance.now() - t0 > budget && d > 600) break; makeTileMesh(t); n++; }
  return todo.length - n;
}

export function updateCityNight() { const sh = BLD_MAT.userData.sh; if (sh) sh.uniforms.uNight.value = G.night; }

// ---------- collisions ----------
const _b = [];
// pushes a circle (obj.x, obj.z, radius) out of buildings. Returns true if it hit something.
export function collideBuildings(obj, r, y = -1e9) {
  let hit = false;
  for (const b of bldGrid.near(obj.x, obj.z, r + 1, _b)) {
    if (y > b.top - 0.3 || (b.raised && y < b.base - 2.4) || obj.x < b.x0 - r || obj.x > b.x1 + r || obj.z < b.z0 - r || obj.z > b.z1 + r) continue;
    const p = b.p, n = p.length / 2;
    let best = 1e9, bx = 0, bz = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const ax = p[j * 2], az = p[j * 2 + 1], cx = p[i * 2], cz = p[i * 2 + 1], dx = cx - ax, dz = cz - az, L2 = dx * dx + dz * dz || 1;
      const t = clamp(((obj.x - ax) * dx + (obj.z - az) * dz) / L2, 0, 1), qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(obj.x - qx, obj.z - qz);
      if (d < best) { best = d; bx = qx; bz = qz; }
    }
    const inside = inPoly(obj.x, obj.z, p);
    if (!inside && best >= r) continue;
    hit = true;
    let nx = obj.x - bx, nz = obj.z - bz; const L = Math.hypot(nx, nz) || 1; nx /= L; nz /= L;
    if (inside) { nx = -nx; nz = -nz; obj.x = bx + nx * r; obj.z = bz + nz * r; }
    else { obj.x = bx + nx * r; obj.z = bz + nz * r; }
  }
  return hit;
}
export const nearBuildings = (x, z, r) => bldGrid.near(x, z, r, []);
export function buildingAt(x, z) { for (const b of bldGrid.near(x, z, 0, _b)) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && inPoly(x, z, b.p)) return b; return null; }
const _r = [];
// is (x, z) on the driving part of any ground-level street or lane (+ pad)? Props (poles, lamps, signs, cones) check this so
// nothing ends up standing where cars drive (a pole placed beside one street used to land in the middle of a crossing lane)
const _cw = [];
export function inRoadway(x, z, pad = 0.4, skipR = -1) {   // skipR: ignore this road (roadwork cones in their own curb lane)
  for (const e of roadGrid.near(x, z, 14, _cw)) {
    const q = M.roads[e.r]; if (q.t > 6 || q.b || e.r === skipR) continue;
    const ax = NX(e.a), az = NZ(e.a), dx = NX(e.b) - ax, dz = NZ(e.b) - az, L2 = dx * dx + dz * dz || 1, t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
    if (Math.hypot(x - ax - dx * t, z - az - dz * t) < q.w / 2 + pad) return true;
  }
  return false;
}
export function nearestRoad(x, z, rad = 40, filter = () => true) {
  let best = null, bd = rad;
  for (const e of roadGrid.near(x, z, rad, _r)) {
    if (!filter(M.roads[e.r])) continue;
    const ax = NX(e.a), az = NZ(e.a), dx = NX(e.b) - ax, dz = NZ(e.b) - az, L2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1), d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < bd) { bd = d; best = { e, t, d, road: M.roads[e.r] }; }
  }
  return best;
}

// ---------- trees in parks and forests ----------
const PALMS = (() => { const [x, z] = toXZ(49.2860, -123.1420); return { x, z }; })();   // English Bay / Davie: the palm trees
function buildCityTrees(progress) {
  const list = [];
  // land: the city mask inside the city, and anything that isn't water outside it (Burnaby, the North Shore, Richmond, Victoria…)
  const onLand = (x, z) => { const m = maskAt(x, z); return m === 1 || (m === -1 && !isWater(x, z) && heightAt(x, z) > 0.5); };
  // no park trees on sports pitches, courts, playgrounds or beaches (they're open ground)
  const openGrid = new Map();
  for (const a of M.areas) { if (a.line || !(a.k === 'pitch' || a.k === 'playground' || a.k === 'beach')) continue; let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let i = 0; i < a.p.length; i += 2) { x0 = Math.min(x0, a.p[i]); x1 = Math.max(x1, a.p[i]); z0 = Math.min(z0, a.p[i + 1]); z1 = Math.max(z1, a.p[i + 1]); } for (let i = Math.floor(x0 / 100); i <= Math.floor(x1 / 100); i++) for (let j = Math.floor(z0 / 100); j <= Math.floor(z1 / 100); j++) { const k = i * 100003 + j; if (!openGrid.has(k)) openGrid.set(k, []); openGrid.get(k).push(a.p); } }
  const onOpen = (x, z) => { const l = openGrid.get(Math.floor(x / 100) * 100003 + Math.floor(z / 100)); if (!l) return false; for (const p of l) if (inPoly(x, z, p)) return true; return false; };
  const ok = (x, z) => {
    if (!onLand(x, z) || onOpen(x, z)) return false;
    for (const e of roadGrid.near(x, z, 6, _r)) {
      const r = M.roads[e.r], ax = NX(e.a), az = NZ(e.a), dx = NX(e.b) - ax, dz = NZ(e.b) - az, L2 = dx * dx + dz * dz || 1;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < r.w / 2 + 1.5) return false;
    }
    return !buildingAt(x, z);
  };
  // nudge a tree off any road or path it overlaps (onto the sidewalk / grass); null if there's no room
  // (only streets count: trees beside sidewalks/paths are fine, their crowns are well above your head)
  const roadGap = (x, z, crown, push) => {
    let worst = 1e9, moved = false;
    for (const e of roadGrid.near(x, z, 14, _r)) {
      const r = M.roads[e.r]; if (!isDriveType(r.t)) continue;
      const ax = NX(e.a), az = NZ(e.a), dx = NX(e.b) - ax, dz = NZ(e.b) - az, L2 = dx * dx + dz * dz || 1;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1), qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(x - qx, z - qz);
      worst = Math.min(worst, d - r.w / 2);
      const need = r.w / 2 + crown;
      if (push && d < need) { const L = Math.sqrt(L2), nx = d > 0.05 ? (x - qx) / d : -dz / L, nz = d > 0.05 ? (z - qz) / d : dx / L; x = qx + nx * (need + 0.2); z = qz + nz * (need + 0.2); moved = true; }
    }
    return { x, z, worst, moved };
  };
  const offRoads = (x, z, crown) => {
    for (let it = 0; it < 4; it++) { const g = roadGap(x, z, crown, true); x = g.x; z = g.z; if (!g.moved) break; }
    if (roadGap(x, z, 0, false).worst < 0.6 || buildingAt(x, z) || !onLand(x, z)) return null;   // trunk must be off the street
    return [x, z];
  };
  for (let i = 0; i < M.trees.length; i += 2) {
    if (!onLand(M.trees[i], M.trees[i + 1])) continue;
    const s = 2.3 + Math.random() * 1.9, roll = Math.random(), palmZone = Math.hypot(M.trees[i] - PALMS.x, M.trees[i + 1] - PALMS.z) < 900;
    const k = palmZone && roll < 0.08 ? 6 : roll < 0.18 ? 3 : roll < 0.32 ? 4 : roll < 0.5 ? 5 : 1;   // cherry, columnar, broad, palm, or the usual
    const p = offRoads(M.trees[i], M.trees[i + 1], s * (k === 5 ? 0.8 : k === 4 ? 0.3 : 0.55) + 0.3); if (!p) continue;
    list.push({ x: p[0], z: p[1], y: heightAt(p[0], p[1]), s: k === 6 ? s * 0.75 : s, h: s * (k === 4 ? 4.4 : k === 5 ? 2.8 : k === 6 ? 3.6 : k === 3 ? 2.4 : 3.3), k, r: Math.random() * 6 });
  }
  const TT = window.__treeT = [performance.now()];
  // boulevard trees: Vancouver's residential streets are lined with trees, but the map only has a few of them. Each street
  // gets one species (cities plant a block at a time), a tree every ~13 m just behind the sidewalk, with gaps for driveways.
  {
    const have = new Set(), key = (x, z) => Math.floor(x / 7) * 100003 + Math.floor(z / 7);
    for (const t of list) have.add(key(t.x, t.z));
    const near = (x, z) => { const i = Math.floor(x / 7), j = Math.floor(z / 7); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (have.has((i + a) * 100003 + j + b)) return true; return false; };
    M.roads.forEach((r, ri) => {
      if (!hasWalk(r) || r.t < 3 || r.t > 5) return;
      const h0 = hash2(ri, 77), h1 = hash2(77, ri);
      if (h0 < 0.12) return;   // some streets have no trees
      if (r.rg && townDensity(NX(r.p[0]), NZ(r.p[0])) < 0.004) return;   // out of town
      // (mature boulevard trees: most older Vancouver streets have big canopies, taller than the houses)
      const k = h1 < 0.22 ? 3 : h1 < 0.6 ? 1 : h1 < 0.75 ? 4 : 5, s0 = (k === 3 ? 2.4 : 2.6) + hash2(ri, 5) * 2.0, off = r.w / 2 + 2.6 + 1.0, step = (r.rg ? 14 : 11) + hash2(5, ri) * 5;
      for (let i = 1; i < r.p.length; i++) {
        const ax = NX(r.p[i - 1]), az = NZ(r.p[i - 1]), dx = NX(r.p[i]) - ax, dz = NZ(r.p[i]) - az, L = Math.hypot(dx, dz); if (L < 20) continue;
        const ux = dx / L, uz = dz / L;
        for (let d = 9; d < L - 9; d += step) for (const side of [-1, 1]) {
          const x = ax + ux * d - uz * off * side, z = az + uz * d + ux * off * side;
          if (hash2(x * 0.37, z * 0.41) < 0.3) continue;   // driveways, gaps, a missing tree
          if (near(x, z) || !onLand(x, z) || buildingAt(x, z) || buildingAt(x + ux * 2.5, z + uz * 2.5) || buildingAt(x - ux * 2.5, z - uz * 2.5)) continue;
          if (roadGap(x, z, 0, false).worst < 2.4) continue;   // not on a crossing street
          const s = s0 * (0.85 + hash2(z, x) * 0.3); have.add(key(x, z));
          list.push({ x, z, y: heightAt(x, z), s, h: s * (k === 4 ? 4.4 : k === 5 ? 2.8 : k === 3 ? 2.4 : 3.3), k, r: hash2(x, z) * 6 });
        }
      }
    });
    TT.push(performance.now());
    // back-yard trees: about half the houses have one (or two) in the yard: on the North Shore often a big fir or cedar
    for (const b of M.blds) {
      if (!(b.t === 1 || b.t === 0) || b.h > 12) continue;
      const p = b.p; let cx = 0, cz = 0, rr = 0; for (let i = 0; i < p.length; i += 2) { cx += p[i]; cz += p[i + 1]; } cx /= p.length / 2; cz /= p.length / 2;
      for (let i = 0; i < p.length; i += 2) rr = Math.max(rr, Math.hypot(p[i] - cx, p[i + 1] - cz)); if (rr > 16 || rr < 4) continue;
      const hh = hash2(cx * 0.13, cz * 0.17); if (hh > 0.42) continue;
      const north = cz < -2600, n = hh < 0.1 ? 2 : 1;
      for (let q = 0; q < n; q++) {
        const a = hash2(cz + q, cx) * 6.283, d = rr + 3 + hash2(cx + q, cz) * 5, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
        if (near(x, z) || !onLand(x, z) || buildingAt(x, z) || roadGap(x, z, 0, false).worst < 3) continue;
        const roll = hash2(x, z), con = north ? roll < 0.55 : roll < 0.18, s = con ? 3 + hash2(z, x) * 2.5 : 2.5 + hash2(z, x) * 2.1;
        const k = con ? [0, 7, 8][Math.floor(hash2(x + 1, z) * 3)] : roll > 0.9 ? 3 : roll > 0.7 ? 5 : 1;
        have.add(key(x, z)); list.push({ x, z, y: heightAt(x, z), s, h: con ? s * (5 + hash2(x, z + 1) * 1.5) : s * (k === 5 ? 2.8 : k === 3 ? 2.4 : 3.3), k, r: hash2(x, z) * 6 });
      }
    }
  }
  TT.push(performance.now());
  for (const a of M.areas) {
    if (!['wood', 'park', 'cemetery', 'golf'].includes(a.k) || a.line) continue;
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (let i = 0; i < a.p.length; i += 2) { x0 = Math.min(x0, a.p[i]); x1 = Math.max(x1, a.p[i]); z0 = Math.min(z0, a.p[i + 1]); z1 = Math.max(z1, a.p[i + 1]); }
    const area = (x1 - x0) * (z1 - z0), dens = a.k === 'wood' ? 1 / 110 : 1 / 650, n = Math.min(40000, Math.floor(area * dens));
    for (let k = 0; k < n; k++) {
      const x = x0 + Math.random() * (x1 - x0), z = z0 + Math.random() * (z1 - z0);
      if (maskAt(x, z) === -1 && townDensity(x, z) < 0.004) continue;   // wild woods outside town: the forest cells (terrain.js) grow those
      if (!inPoly(x, z, a.p) || !ok(x, z)) continue;
      const wood = a.k === 'wood', con = wood ? Math.random() < 0.75 : Math.random() < 0.3;
      const s = con ? (wood ? 4 + Math.random() * 4 : 2.5 + Math.random() * 3) : 2.2 + Math.random() * 2;
      // conifers are wide at the bottom, so keep them further from roads and paths
      if (con) { let bad = false; for (const e of roadGrid.near(x, z, s + 6, _r)) { const r = M.roads[e.r], ax = NX(e.a), az = NZ(e.a), dx = NX(e.b) - ax, dz = NZ(e.b) - az, L2 = dx * dx + dz * dz || 1, t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1); if (Math.hypot(x - ax - dx * t, z - az - dz * t) < r.w / 2 + s * 0.9) { bad = true; break; } } if (bad) continue; }
      list.push({ x, z, y: heightAt(x, z) - 0.2, s, h: con ? s * (wood ? 6 + Math.random() * 1.5 : 5) : s * 3.1, k: con ? [0, 0, 7, 7, 8][Math.floor(Math.random() * 5)] : (() => { const q = Math.random(); return q < 0.08 ? 3 : q < 0.3 ? 5 : q < 0.4 ? 4 : 1; })(), r: Math.random() * 6 });
    }
  }
  progress(`Planting ${list.length.toLocaleString()} trees…`, 0.78);
  TT.push(performance.now()); makeTreeChunks(list, TREE_GEOS, TREE_MATS); TT.push(performance.now());
  setColliders('trees', list.map(t => ({ x: t.x, z: t.z, r: t.k === 0 || t.k === 7 || t.k === 8 ? 0.45 : 0.3, top: t.y + t.h * 0.5, brk: t.h < 11 ? 12 : t.h < 16 ? 19 : undefined, kind: 'tip', refs: t.refs, base: t.y })));   // small street trees snap if you hit them fast
}

// ---------- rail lines (SkyTrain guideway + freight rail) ----------
export const railLines = [];
// SkyTrain track heights: up on a guideway only where the map says it's a bridge/viaduct, at ground level
// elsewhere (e.g. under the Georgia Viaduct and in the Grandview Cut), with smooth ramps in between.
const RAIL_Y = new Map(), rk = (x, z) => Math.round(x) + ',' + Math.round(z);
export const railY = (x, z, fallback) => RAIL_Y.get(rk(x, z)) ?? fallback;
function computeRailHeights() {
  // extra points every 15 m so crossings with roads can be handled exactly (transit.js uses these same points)
  for (const r of M.rails) {
    if (r.t !== 1 || r.tu || r.dense) continue;
    const p = r.p, out = [p[0], p[1]];
    for (let i = 2; i < p.length; i += 2) { const ax = p[i - 2], az = p[i - 1], bx = p[i], bz = p[i + 1], k = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 15)); for (let j = 1; j <= k; j++) out.push(ax + (bx - ax) * j / k, az + (bz - az) * j / k); }
    r.p = out; r.dense = true;
  }
  const nodes = new Map();
  for (const r of M.rails) {
    if (r.t !== 1 || r.tu) continue;
    let prev = null; const lift = r.b ? (r.l >= 2 ? 8.5 : 7) : 0.4;
    for (let i = 0; i < r.p.length; i += 2) {
      const x = r.p[i], z = r.p[i + 1], k = rk(x, z);
      let n = nodes.get(k); if (!n) nodes.set(k, n = { x, z, g: heightAt(x, z), lift: 0, fixed: false, nb: [] });
      n.lift = Math.max(n.lift, lift); if (r.b) n.fixed = true;
      if (prev && prev !== n) { const d = Math.hypot(n.x - prev.x, n.z - prev.z); prev.nb.push([n, d]); n.nb.push([prev, d]); } prev = n;
    }
  }
  // ground track ramps up to meet a bridge over 120 m (distance along the track to the nearest bridge node)
  const RAMP = 120, dist = new Map(), q = [];
  for (const n of nodes.values()) if (n.fixed) { dist.set(n, 0); n.from = n; q.push(n); }
  while (q.length) {
    let bi = 0; for (let i = 1; i < q.length; i++) if (dist.get(q[i]) < dist.get(q[bi])) bi = i;
    const u = q.splice(bi, 1)[0], du = dist.get(u); if (du > RAMP) continue;
    for (const [v, w] of u.nb) if (!v.fixed && du + w < (dist.get(v) ?? 1e9)) { dist.set(v, du + w); v.from = u.from; q.push(v); }
  }
  for (const [k, n] of nodes) {
    let y = n.g + n.lift;
    if (!n.fixed && dist.has(n)) { const f = Math.max(0, 1 - dist.get(n) / RAMP), top = n.from.g + n.from.lift; y = Math.max(y, (n.g + 0.4) + (top - (n.g + 0.4)) * f); }
    RAIL_Y.set(k, y);
  }
  // crossings: go UNDER higher road bridges (e.g. the Georgia/Dunsmuir viaducts), keep clear OVER streets
  const _n = [];
  for (const r of M.rails) {
    if (r.t !== 1 || r.tu) continue;
    const P = r.p, cnt = P.length / 2, ys = [], cum = [0];
    for (let i = 0; i < cnt; i++) { ys.push(RAIL_Y.get(rk(P[i * 2], P[i * 2 + 1]))); if (i) cum.push(cum[i - 1] + Math.hypot(P[i * 2] - P[i * 2 - 2], P[i * 2 + 1] - P[i * 2 - 1])); }
    const out = ys.slice();
    for (let i = 0; i < cnt; i++) {
      const x = P[i * 2], z = P[i * 2 + 1], g = heightAt(x, z);
      for (const e of roadGrid.near(x, z, 7, _n)) {
        const rd = M.roads[e.r]; if (rd.t > 6) continue;
        const ax = NX(e.a), az = NZ(e.a), dx = NX(e.b) - ax, dz = NZ(e.b) - az, L2 = dx * dx + dz * dz || 1, t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
        if (Math.hypot(x - ax - dx * t, z - az - dz * t) > rd.w / 2 + 3) continue;
        const ry = nodeY[e.a] + (nodeY[e.b] - nodeY[e.a]) * t, gap = ys[i] - ry;
        if (gap > 5.5 || gap < -6) continue;   // already clear
        const under = rd.b && (rd.l || 1) > (r.l || 0) && ry - g > 5;
        const target = under ? Math.max(g + 0.4, ry - 6.5) : ry + 5.8;
        for (let j = 0; j < cnt; j++) {
          const d = Math.abs(cum[j] - cum[i]); if (d > 90) continue;
          const v = ys[j] + (target - ys[j]) * (1 - d / 90);
          out[j] = under ? Math.min(out[j], Math.max(v, heightAt(P[j * 2], P[j * 2 + 1]) + 0.4)) : Math.max(out[j], v);
        }
      }
    }
    for (let i = 0; i < cnt; i++) RAIL_Y.set(rk(P[i * 2], P[i * 2 + 1]), out[i]);
  }
}
function buildRails() {
  computeRailHeights();
  const pillars = [];
  for (const r of M.rails) {
    if (r.tu) continue;
    const pts = []; for (let i = 0; i < r.p.length; i += 2) { const x = r.p[i], z = r.p[i + 1], g = heightAt(x, z); pts.push({ x, z, y: r.t === 1 ? railY(x, z, g + 0.4) - 0.1 : g + 0.3 }); }
    if (r.t === 1) {
      ribbon(pts, -3, 3, 'deck', 0.1); for (const s of [-1, 1]) sideWall(pts, s * 3, -1.2, 'deck'); railLines.push(pts);
      // concrete pillars under raised track, about every 25 m
      let acc = 12;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], L = Math.hypot(b.x - a.x, b.z - a.z);
        for (; acc < L; acc += 25) { const t = acc / L, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = a.y + (b.y - a.y) * t, g = heightAt(x, z); if (y - g > 3.2 && !isWater(x, z) && !roadBelow(x, z, null)) pillars.push(x, g, z, y - 1.2 - g); }
        acc -= L;
      }
    } else ribbon(pts, -1.6, 1.6, 'path', 0.5);
  }
  flushBuckets();
  const n = pillars.length / 4; if (!n) return;
  { const cl = []; for (let i = 0; i < n; i++) cl.push({ x: pillars[i * 4], z: pillars[i * 4 + 2], r: 0.9, top: pillars[i * 4 + 1] + pillars[i * 4 + 3] }); setColliders('railPillars', cl); }
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 1, 1.6).translate(0, 0.5, 0), ROAD_MATS.deck, n), o = new THREE.Object3D();
  for (let i = 0; i < n; i++) { o.position.set(pillars[i * 4], pillars[i * 4 + 1] - 0.5, pillars[i * 4 + 2]); o.scale.set(1, pillars[i * 4 + 3] + 0.5, 1); o.updateMatrix(); im.setMatrixAt(i, o.matrix); }
  im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere(); scene.add(im);
}

// ---------- business + place signs (real names from OpenStreetMap) ----------
const signPool = [];
const signCache = new Map();
function signTexture(text, kind) {
  if (signCache.has(text)) return signCache.get(text);
  const icon = { cafe: '☕', restaurant: '🍽️', fast_food: '🍔', bar: '🍺', pub: '🍺', shop: '🛍️', ice_cream: '🍦', hotel: '🏨', museum: '🏛️', artwork: '🎨', attraction: '⭐', station: '🚆', cinema: '🎬', theatre: '🎭', nightclub: '🪩', bicycle_rental: '🚲', library: '📚', gallery: '🖼️', historic: '📜', viewpoint: '📷' }[kind] || '📍';
  const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d');
  g.font = 'bold 40px Segoe UI, sans-serif'; const label = icon + ' ' + text; const w = Math.min(500, g.measureText(label).width + 40);
  g.fillStyle = 'rgba(12,22,32,0.82)'; g.beginPath(); g.roundRect((512 - w) / 2, 8, w, 80, 18); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, 256, 50, 470);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; signCache.set(text, t); return t;
}
export const pois = M.pois.map(p => ({ ...p, name: M.names[p.n] }));
const poiGrid = new Grid(60); for (const p of pois) poiGrid.addBox(p.x, p.z, p.x, p.z, p);
function initSigns() {
  for (let i = 0; i < 26; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: true }));
    s.scale.set(7, 1.3, 1); s.visible = false; scene.add(s); signPool.push(s);
  }
}
let signTimer = 0; const _p = [];
export function updateSigns(px, pz, dt) {
  signTimer -= dt; if (signTimer > 0) return; signTimer = 0.6;
  const near = poiGrid.near(px, pz, 90, _p).map(p => [p, Math.hypot(p.x - px, p.z - pz)]).filter(a => a[1] < 90 && !a[0].front).sort((a, b) => a[1] - b[1]).slice(0, signPool.length);
  signPool.forEach((s, i) => {
    const it = near[i]; if (!it) { s.visible = false; return; }
    const p = it[0]; s.material.map = signTexture(p.name, p.k); s.material.needsUpdate = true;
    s.position.set(p.x, surfaceY(p.x, p.z) + 4.2, p.z); s.visible = true;
  });
}
export const findPoi = re => pois.find(p => re.test(p.name));

export function initCity(progress) {
  const T = [performance.now()], tick = () => T.push(performance.now()); window.__city = T;
  progress('Connecting the streets…', 0.25); buildGraph(); tick();
  setForestFilter((x, z) => { for (const e of roadGrid.near(x, z, 12, _r)) { const r = M.roads[e.r], ax = NX(e.a), az = NZ(e.a), dx = NX(e.b) - ax, dz = NZ(e.b) - az, L2 = dx * dx + dz * dz || 1, t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1); if (Math.hypot(x - ax - dx * t, z - az - dz * t) < r.w / 2 + 6) return false; } return !buildingAt(x, z); });
  progress('Paving the roads and bridges…', 0.3); buildRoads(); tick(); buildRails(); tick();
  buildBuildings(progress); tick();
  progress('Planting trees…', 0.75); buildCityTrees(progress); tick();
  initSigns(); tick();
}
