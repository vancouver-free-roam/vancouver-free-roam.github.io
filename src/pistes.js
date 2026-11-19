// The real ski runs (OpenStreetMap piste:type=downhill) on Grouse, Cypress, Seymour and Whistler Blackcomb:
//  - each run is a cleared, groomed corridor (no forest on it) drawn with corduroy grooming lines — only when there's snow
//  - a sign at the top of every named run with its difficulty (● green, ■ blue, ◆ black, ◆◆ double black) and name
//  - riding one tells you which run you're on; NPC skiers (skiers.js) ride the runs instead of random slopes
import * as THREE from 'three';
import { G, scene, canvasTex, std } from './core.js';
import { groundY, heightAt, SNOW_U, setPisteFilter } from './terrain.js';
import { ui } from './ui.js';

const M = window.MAP;
export const runs = [];   // {d, name, pts: [[x,z]...], hw, top: [x,z], area?}
const HW = [22, 20, 17, 13, 10, 9];   // half-width by difficulty (novice wide, expert narrow)
const DIFF = [['●', '#2f9e44', 'Beginner'], ['●', '#2f9e44', 'Easy'], ['■', '#1c6dd0', 'Intermediate'], ['◆', '#111111', 'Advanced'], ['◆◆', '#111111', 'Expert'], ['◆◆', '#c92a2a', 'Off-piste']];
const grid = new Map(), CELL = 60;
const gk = (i, j) => i * 100003 + j;
function addSeg(s) { const x0 = Math.min(s.ax, s.bx) - s.hw, x1 = Math.max(s.ax, s.bx) + s.hw, z0 = Math.min(s.az, s.bz) - s.hw, z1 = Math.max(s.az, s.bz) + s.hw; for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) { const k = gk(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(s); } }
// the run at (x, z), or null
export function pisteAt(x, z, pad = 0) {
  const l = grid.get(gk(Math.floor(x / CELL), Math.floor(z / CELL))); if (!l) return null;
  for (const s of l) {
    if (s.poly) { const p = s.poly; let c = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if (((p[i + 1] > z) !== (p[j + 1] > z)) && x < (p[j] - p[i]) * (z - p[i + 1]) / (p[j + 1] - p[i + 1]) + p[i]) c = !c; if (c) return s.run; continue; }
    const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2));
    if (Math.hypot(x - s.ax - dx * t, z - s.az - dz * t) < s.hw + pad) return s.run;
  }
  return null;
}
// groomed snow: bright, with corduroy lines across the slope; invisible where there's no snow (summer: it's just mountain)
const groomMat = new THREE.MeshStandardMaterial({ color: '#f4f7fb', roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
groomMat.onBeforeCompile = sh => {
  sh.uniforms.uSnowLine = SNOW_U.line; sh.uniforms.uCitySnow = SNOW_U.city;
  sh.vertexShader = 'varying vec3 vPw; attribute float aAlong;\nvarying float vAlong;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vPw = (modelMatrix * vec4(transformed, 1.0)).xyz; vAlong = aAlong;');
  sh.fragmentShader = 'varying vec3 vPw; varying float vAlong; uniform float uSnowLine; uniform float uCitySnow;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    { float s = smoothstep(uSnowLine - 30.0, uSnowLine + 60.0, vPw.y); if (s < 0.5) discard;
      float fw = fwidth(vAlong), near = 1.0 - smoothstep(0.08, 0.6, fw);
      float cord = 0.5 + 0.5 * sin(vAlong * 6.2832 / 0.12);   // corduroy ridges every 12 cm
      diffuseColor.rgb *= 1.0 - 0.06 * cord * near; }`);
};
groomMat.customProgramCacheKey = () => 'groom';
function ribbon(run, pos, along, idx) {
  const P = run.pts, base = pos.length / 3; let acc = 0; const pts = [];
  for (let i = 0; i < P.length - 1; i++) { const [ax, az] = P[i], [bx, bz] = P[i + 1], d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / 8)); for (let k = 0; k < n; k++) pts.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]); }
  pts.push(P[P.length - 1]);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], o = pts[Math.max(i - 1, 0)]; let dx = q[0] - o[0], dz = q[1] - o[1]; const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    if (i) acc += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
    for (const s of [-1, 1]) { const x = p[0] - dz * run.hw * s, z = p[1] + dx * run.hw * s; pos.push(x, groundY(x, z) + 0.12, z); along.push(acc); }
    if (i) { const k = base + (i - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
}
function areaMesh(run, pos, along, idx) {
  const p = run.poly, pts = []; for (let i = 0; i < p.length; i += 2) pts.push(new THREE.Vector2(p[i], p[i + 1]));
  if (pts.length < 3) return;
  const tris = THREE.ShapeUtils.triangulateShape(pts, []), base = pos.length / 3;
  for (const v of pts) { pos.push(v.x, groundY(v.x, v.y) + 0.12, v.y); along.push(v.x * 0.7 + v.y * 0.7); }
  for (const [a, b, c] of tris) idx.push(base + a, base + b, base + c);
}
let built = false;
export function initPistes() {
  for (const pz of M.pistes || []) {
    if (pz.k !== 'downhill' || pz.p.length < 4) continue;
    const name = pz.n >= 0 ? M.names[pz.n] : '';
    const pts = []; for (let i = 0; i < pz.p.length; i += 2) pts.push([pz.p[i], pz.p[i + 1]]);
    if (pz.a) { const run = { d: pz.d, name, poly: pz.p, pts, hw: 0, area: true }; runs.push(run); addSeg({ poly: pz.p, run, ax: Math.min(...pz.p.filter((_, i) => i % 2 === 0)), bx: Math.max(...pz.p.filter((_, i) => i % 2 === 0)), az: Math.min(...pz.p.filter((_, i) => i % 2)), bz: Math.max(...pz.p.filter((_, i) => i % 2)), hw: 0 }); continue; }
    // lines run downhill: flip if drawn uphill
    if (heightAt(...pts[0]) < heightAt(...pts[pts.length - 1])) pts.reverse();
    const run = { d: pz.d, name, pts, hw: HW[pz.d] ?? 16, top: pts[0] }; runs.push(run);
    for (let i = 0; i < pts.length - 1; i++) addSeg({ ax: pts[i][0], az: pts[i][1], bx: pts[i + 1][0], bz: pts[i + 1][1], hw: run.hw, run });
  }
  setPisteFilter((x, z) => !pisteAt(x, z, 4));   // no forest on the runs
}
function buildMeshes() {
  built = true;
  const pos = [], along = [], idx = [];
  for (const r of runs) (r.area ? areaMesh : ribbon)(r, pos, along, idx);
  if (!pos.length) return;
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1)); g.setIndex(idx); g.computeVertexNormals();
  const n = g.attributes.normal; for (let i = 0; i < n.count; i++) if (n.getY(i) < 0) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  const m = new THREE.Mesh(g, groomMat); m.receiveShadow = true; scene.add(m);
}
// run signs at the top of named runs (near you only; textures cached)
const signs = new Map(), texCache = new Map(); let signAt = null;
function signTex(run) {
  const key = run.name + run.d; if (texCache.has(key)) return texCache.get(key);
  const [sym, col, label] = DIFF[run.d] ?? DIFF[2];
  const t = canvasTex(256, 128, (c, w, h) => { c.fillStyle = '#f7f3e8'; c.fillRect(0, 0, w, h); c.strokeStyle = '#333'; c.lineWidth = 6; c.strokeRect(3, 3, w - 6, h - 6); c.fillStyle = col; c.font = 'bold 54px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(sym, w / 2, 40); c.fillStyle = '#111'; c.font = 'bold 26px Segoe UI, Arial'; c.fillText(run.name || label, w / 2, 92, w - 20); }, false);
  texCache.set(key, t); return t;
}
const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), postMat = std('#5a4330'), boardGeo = new THREE.PlaneGeometry(1.4, 0.7);
function updateSigns(px, pz) {
  if (signAt && Math.hypot(px - signAt[0], pz - signAt[1]) < 150) return; signAt = [px, pz];
  for (const [r, g] of signs) if (Math.hypot(r.top[0] - px, r.top[1] - pz) > 700) { scene.remove(g); signs.delete(r); }
  for (const r of runs) {
    if (!r.top || !r.name || signs.has(r) || Math.hypot(r.top[0] - px, r.top[1] - pz) > 600) continue;
    const [x, z] = r.top, [nx, nz] = r.pts[1], y = groundY(x, z), g = new THREE.Group(); g.position.set(x - (nz - z) * 0.0 + (z - nz) * 0, y, z);
    const dx = nx - x, dz = nz - z, L = Math.hypot(dx, dz) || 1, sx = -dz / L * (r.hw + 1.5), sz = dx / L * (r.hw + 1.5); g.position.set(x + sx, groundY(x + sx, z + sz), z + sz);
    const post = new THREE.Mesh(postGeo, postMat); post.position.y = 1.3; g.add(post);
    const b = new THREE.Mesh(boardGeo, new THREE.MeshBasicMaterial({ map: signTex(r), side: THREE.DoubleSide })); b.position.y = 2.35; b.rotation.y = Math.atan2(-dx, -dz); g.add(b);
    scene.add(g); signs.set(r, g);
  }
}
let lastRun = null, runT = 0;
export function updatePistes(dt, pl) {
  if (!built) buildMeshes();
  updateSigns(pl.x, pl.z);
  runT -= dt; if (runT > 0) return; runT = 0.5;
  if (!pl.board) { lastRun = null; return; }
  const r = pisteAt(pl.x, pl.z);
  if (r && r !== lastRun && r.name) { const [sym, , label] = DIFF[r.d] ?? DIFF[2]; ui.toast(`${sym} ${r.name}`, `${label} run`, 2200); }
  if (r) lastRun = r;
}
export const _pistes = runs;
