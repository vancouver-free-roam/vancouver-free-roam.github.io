// Air traffic over Vancouver (and beyond):
//  - a Harbour Err floatplane fleet that really flies its routes: Coal Harbour <-> Victoria / Nanaimo / Whistler (Green Lake)
//    + scenic tours; they taxi out, kick up spray on the take-off run and on touch-down, and dock again
//  - "Helijest" commuter helicopters: downtown waterfront heliport <-> Victoria, and a sightseeing heli over the North Shore
//  - news / police / rescue helicopters that turn up now and then and circle near you (police searchlight at night,
//    rescue long-line with a dangling rescuer in the mountains)
//  - YVR arrivals flying the downwind leg over the city, small planes sightseeing, airliners up high with contrails
//  - surprises: a banner-towing plane over English Bay in summer, the odd hot-air balloon, a vintage biplane air show
// Everything follows smooth pre-built paths (Catmull-Rom, sampled every ~12 m), banks from real turn physics, is drawn
// as ONE baked mesh (+ a spinning prop/rotor) per aircraft, grows a little with distance so it never shrinks to nothing,
// and has nav lights / beacons / strobes / landing lights drawn as glowing points (one draw call for all of them).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, scene, camera, renderer, std, addMesh, toXZ, canvasTex, R, pick, clamp } from './core.js';
import { heightAt, isWater, waterLevel } from './terrain.js';
import { addFlatSurface } from './city.js';
import { planeModel, jetModel, heliModel, cessnaModel } from './vehicles.js';
import { runways } from './airport.js';
import { bake } from './ships.js';
import { discover } from './missions.js';
import { ui } from './ui.js';
import { noise } from './sound.js';

const V3 = THREE.Vector3, TAU = Math.PI * 2;
const _v2 = new THREE.Vector2(), _a = new V3(), _b = new V3(), _c = new V3(), _f = new V3(), _u = new V3(), _r = new V3(), _k = new V3(), _m = new THREE.Matrix4(), _e = new THREE.Euler();
const P = (x, z, y, v, o) => ({ x, z, y, v, g: 0, c: 0, sm: 0, ...o });
const LL = (la, lo, y, v, o) => { const [x, z] = toXZ(la, lo); return P(x, z, y, v, o); };
const GND = { g: 1 };
let PL = null;

// ---------- baked aircraft models ----------
const BODY_M = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.25 });
// far away an aircraft reads as a dark silhouette against the bright sky (like the real thing), not white-on-white
BODY_M.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
#ifdef USE_COLOR
{ vec4 wpA = modelMatrix * vec4(position, 1.0); float fdA = smoothstep(250.0, 1800.0, distance(wpA.xyz, cameraPosition)); vColor.rgb = mix(vColor.rgb, vec3(0.05, 0.055, 0.07), fdA * 0.92); }
#endif`); };
BODY_M.customProgramCacheKey = () => 'airtraffic-body';
function bakeGeo(root, recolor) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(), geos = [], c = new THREE.Color(), t = new THREE.Color();
  root.traverse(o => {
    if (!o.isMesh) return;
    const mt = Array.isArray(o.material) ? o.material[0] : o.material;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const own = mt.vertexColors && g.attributes.color;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && !(own && k === 'color')) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (own) { geos.push(g); return; }
    c.copy(mt.color || c.set('#ffffff'));
    if (recolor) for (const [from, to] of recolor) { t.set(from); if (Math.abs(t.r - c.r) + Math.abs(t.g - c.g) + Math.abs(t.b - c.b) < 0.02) { c.set(to); break; } }
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); geos.push(g);
  });
  const out = mergeGeometries(geos); out.computeBoundingSphere(); return out;
}
// light kinds: R/Gn/W = nav lights, B = red beacon, S = white strobe, L = landing light, F = balloon burner
const FLOAT_L = [[-7.2, 3.6, -1.2, 'R'], [7.2, 3.6, -1.2, 'Gn'], [0, 4.75, 7.5, 'W'], [0, 4.9, 6.9, 'B'], [-7.25, 3.65, -1.1, 'S'], [7.25, 3.65, -1.1, 'S'], [0, 3.3, -2.4, 'L']];
const JET_L = [[-15.9, 3.3, -7, 'R'], [15.9, 3.3, -7, 'Gn'], [0, 11.5, 17.5, 'W'], [0, 6.4, 0, 'B'], [0, 1.6, 2, 'B'], [-15.8, 3.3, -6.8, 'S'], [15.8, 3.3, -6.8, 'S'], [-3.5, 3.0, -3, 'L'], [3.5, 3.0, -3, 'L'], [0, 2.6, -16.5, 'L']];
const HELI_L = [[-1.35, 1.7, 0, 'R'], [1.35, 1.7, 0, 'Gn'], [0, 2.5, 7.1, 'W'], [0, 3.05, 1.2, 'B'], [0, 3.2, 6.7, 'S'], [0, 0.9, -1.8, 'L']];
const CESSNA_L = [[-5.5, 2.65, -0.6, 'R'], [5.5, 2.65, -0.6, 'Gn'], [0, 3.3, 5.8, 'W'], [0, 3.3, 5.4, 'B'], [-5.5, 2.7, -0.5, 'S'], [5.5, 2.7, -0.5, 'S'], [-1.5, 2.5, -0.9, 'L']];
const TYPES = {};
function defType(name, build, o) { TYPES[name] = { name, build, kind: 'fixed', d0: 1400, cap: 5, maxD: 26000, lights: [], ...o }; }
const heliCol = c => [['#c53030', c]];
defType('float', planeModel, { lights: FLOAT_L, floats: true, d0: 420, cap: 10 });
defType('float2', planeModel, { lights: FLOAT_L, floats: true, d0: 420, cap: 10, recolor: [['#1f4e8c', '#b8322a']] });
defType('float3', planeModel, { lights: FLOAT_L, floats: true, d0: 420, cap: 10, recolor: [['#1f4e8c', '#127a74'], ['#f2c230', '#f4f4f4']] });
for (const [n, col] of [['jetA', '#c8102e'], ['jetB', '#1f4e8c'], ['jetC', '#2f855a'], ['jetD', '#f28c28'], ['jetE', '#5b2a86']]) defType(n, () => jetModel(1, col), { lights: JET_L, d0: 1000, cap: 6, maxD: 60000 });
for (const [n, col] of [['helijet', '#1d3f72'], ['news', '#e8742a'], ['police', '#1a2a4a'], ['rescue', '#d41f1f'], ['tour', '#f2c230']]) defType('h_' + n, heliModel, { kind: 'heli', lights: HELI_L, d0: 330, cap: 10, recolor: heliCol(col) });
defType('cessna', cessnaModel, { lights: CESSNA_L, d0: 380, cap: 10 });
defType('cessnaY', cessnaModel, { lights: CESSNA_L, d0: 650, cap: 3.5, recolor: [['#f4f4f4', '#f2c230'], ['#c53030', '#1a1a1a']] });
defType('biplane', biplaneModel, { lights: [[-4.5, 3.0, -0.9, 'R'], [4.5, 3.0, -0.9, 'Gn']], d0: 350, cap: 8 });
defType('balloon', balloonModel, { kind: 'balloon', lights: [[0, 7.2, 0, 'F']], d0: 1600, cap: 3, maxD: 20000 });
function typeOf(name) {
  const T = TYPES[name]; if (T.geo) return T;
  const m = T.build(), spin = m.prop || m.rotor || null;
  if (spin) { spin.parent.remove(spin); T.spinPos = spin.position.clone(); T.spinAxis = m.rotor ? 'y' : 'z'; spin.position.set(0, 0, 0); spin.rotation.set(0, 0, 0); T.spinGeo = bakeGeo(spin, T.recolor); }
  T.extra = m.extra || null; if (m.extra) m.g.remove(m.extra);
  T.geo = bakeGeo(m.g, T.recolor); return T;
}
function biplaneModel() {
  const g = new THREE.Group(), red = std('#b3202a'), yel = std('#f0c33c'), wood = std('#7a4b26'), dark = std('#2a2a2a'), grey = std('#8d939a', { metalness: 0.6 });
  addMesh(new THREE.BoxGeometry(1.0, 1.1, 6.2), red, 0, 1.7, 0.6, g);
  addMesh(new THREE.BoxGeometry(0.6, 0.6, 2.6), red, 0, 1.85, 4.6, g);
  addMesh(new THREE.CylinderGeometry(0.62, 0.55, 1.0, 14).rotateX(Math.PI / 2), grey, 0, 1.7, -2.9, g);
  addMesh(new THREE.BoxGeometry(9.4, 0.13, 1.45), yel, 0, 3.05, -0.9, g);
  addMesh(new THREE.BoxGeometry(8.6, 0.13, 1.35), yel, 0, 1.25, -0.6, g);
  for (const s of [-1, 1]) { addMesh(new THREE.BoxGeometry(0.08, 1.8, 0.08), wood, s * 3.1, 2.15, -0.95, g); addMesh(new THREE.BoxGeometry(0.08, 1.8, 0.08), wood, s * 3.1, 2.15, -0.15, g); addMesh(new THREE.BoxGeometry(0.06, 1.0, 0.06), dark, s * 0.75, 0.75, -1.3, g).rotation.z = s * 0.35; addMesh(new THREE.CylinderGeometry(0.33, 0.33, 0.14, 12).rotateZ(Math.PI / 2), dark, s * 0.95, 0.33, -1.3, g); }
  addMesh(new THREE.BoxGeometry(3.3, 0.08, 0.95), yel, 0, 1.9, 5.5, g); addMesh(new THREE.BoxGeometry(0.08, 1.2, 1.0), red, 0, 2.5, 5.6, g);
  addMesh(new THREE.SphereGeometry(0.26, 10, 8), std('#5a3a22'), 0, 2.5, 0.6, g); addMesh(new THREE.BoxGeometry(0.5, 0.12, 0.08), std('#9fd4e8'), 0, 2.55, 0.3, g);
  const prop = new THREE.Group(); prop.position.set(0, 1.7, -3.45); g.add(prop);
  for (let i = 0; i < 2; i++) addMesh(new THREE.BoxGeometry(0.16, 2.3, 0.05), wood, 0, 0, 0, prop).rotation.z = i * Math.PI;
  return { g, prop };
}
const BALLOON_PAL = [['#e53e3e', '#f6e05e', '#3182ce'], ['#ff7a00', '#ffd400', '#ff7a00', '#c81e1e'], ['#2f855a', '#f7fafc'], ['#805ad5', '#f687b3', '#f7fafc', '#4fd1c5'], ['#1a365d', '#f6e05e', '#e53e3e']];
function balloonModel() {
  const g = new THREE.Group(), pal = pick(BALLOON_PAL);
  const prof = [[1.6, 0], [3.4, 2.6], [6.4, 6.6], [8.6, 10.6], [9.3, 14], [8.9, 17], [7.3, 19.8], [4.7, 21.5], [1.6, 22.1], [0, 22.15]].map(([r, y]) => new THREE.Vector2(r, y));
  const env = new THREE.LatheGeometry(prof, 24).toNonIndexed(), pos = env.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3, y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const k = Math.floor(((Math.atan2(z, x) + Math.PI) / TAU) * 12) % 12; c.set(y > 19.5 ? pal[0] : pal[k % pal.length]);
    for (let j = 0; j < 3; j++) col.set([c.r, c.g, c.b], (i + j) * 3);
  }
  env.setAttribute('color', new THREE.BufferAttribute(col, 3)); env.computeVertexNormals();
  const envM = new THREE.Mesh(env, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide })); envM.position.y = 7; g.add(envM);
  const wick = std('#8b5a2b'), rope = std('#3a3a3a');
  addMesh(new THREE.BoxGeometry(1.5, 1.1, 1.5), wick, 0, 0.55, 0, g); addMesh(new THREE.BoxGeometry(1.6, 0.12, 1.6), std('#5c3b1e'), 0, 1.12, 0, g);
  addMesh(new THREE.CylinderGeometry(0.35, 0.35, 0.5, 10), std('#9aa1a8', { metalness: 0.7 }), 0, 4.0, 0, g);
  for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) { const r = addMesh(new THREE.CylinderGeometry(0.03, 0.03, 6.2, 4), rope, x * 1.4, 4.15, z * 1.4, g); r.rotation.set(z * 0.18, 0, -x * 0.18); }
  addMesh(new THREE.SphereGeometry(0.22, 8, 6), std('#e0b48a'), 0.35, 1.5, 0.2, g); addMesh(new THREE.SphereGeometry(0.22, 8, 6), std('#c68b59'), -0.35, 1.5, -0.2, g);
  const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xffa040, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  flame.scale.set(1.6, 3.2, 1); flame.position.set(0, 5.6, 0);
  return { g, extra: flame };
}
let _glow = null;
function glowTex() { return _glow || (_glow = canvasTex(64, 64, (c, w) => { const gr = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,220,150,0.7)'); gr.addColorStop(1, 'rgba(255,140,40,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, w); }, false)); }

// ---------- glowing lights (all aircraft, one draw call) ----------
const LMAX = 1600, lPos = new Float32Array(LMAX * 3), lCol = new Float32Array(LMAX * 3), lSz = new Float32Array(LMAX);
const lGeo = new THREE.BufferGeometry();
lGeo.setAttribute('position', new THREE.BufferAttribute(lPos, 3).setUsage(THREE.DynamicDrawUsage));
lGeo.setAttribute('aCol', new THREE.BufferAttribute(lCol, 3).setUsage(THREE.DynamicDrawUsage));
lGeo.setAttribute('aSize', new THREE.BufferAttribute(lSz, 1).setUsage(THREE.DynamicDrawUsage));
const lMat = new THREE.ShaderMaterial({
  vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aSize; attribute vec3 aCol; varying vec3 vC;
void main() { vC = aCol; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = aSize;
#include <logdepthbuf_vertex>
}`,
  fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
varying vec3 vC;
void main() {
#include <logdepthbuf_fragment>
  float r = length(gl_PointCoord - 0.5) * 2.0; if (r > 1.0) discard; float a = pow(1.0 - r, 1.7); gl_FragColor = vec4(vC * (0.7 + 1.6 * a), a); }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
const lPts = new THREE.Points(lGeo, lMat); lPts.frustumCulled = false; lPts.renderOrder = 5;
let nl = 0;
function addLight(p, col, size) { if (nl >= LMAX || size <= 0) return; lPos[nl * 3] = p.x; lPos[nl * 3 + 1] = p.y; lPos[nl * 3 + 2] = p.z; lCol[nl * 3] = col[0]; lCol[nl * 3 + 1] = col[1]; lCol[nl * 3 + 2] = col[2]; lSz[nl] = size; nl++; }
const COL = { R: [1, 0.12, 0.08], Gn: [0.1, 1, 0.35], W: [1, 1, 1], B: [1, 0.1, 0.05], S: [1, 1, 1], L: [1, 0.93, 0.78], F: [1, 0.6, 0.2], blue: [0.3, 0.5, 1], amber: [1, 0.7, 0.2] };

// ---------- puffs: water spray, contrails, air-show smoke (one draw call) ----------
const PMAX = 5000, pa = {}; for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'age', 'life', 's0', 's1', 'a0', 'gr', 'dr']) pa[k] = new Float32Array(PMAX);
const PK = Object.keys(pa); let np = 0;
const pPos = new Float32Array(PMAX * 3), pSz = new Float32Array(PMAX), pAl = new Float32Array(PMAX), pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSz, 1).setUsage(THREE.DynamicDrawUsage));
pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(pAl, 1).setUsage(THREE.DynamicDrawUsage));
const pU = { uScale: { value: 800 }, uLight: { value: 1 }, uFogC: { value: new THREE.Color() }, uFogD: { value: 0 } };
const pMat = new THREE.ShaderMaterial({
  uniforms: pU,
  vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
attribute float aSize; attribute float aAlpha; uniform float uScale; uniform float uFogD; varying float vA; varying float vFog;
void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; float d = max(-mv.z, 0.1);
  gl_PointSize = clamp(aSize * uScale / d, 0.0, 380.0); vA = aAlpha; float f = uFogD * d; vFog = 1.0 - exp(-f * f);
#include <logdepthbuf_vertex>
}`,
  fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uLight; uniform vec3 uFogC; varying float vA; varying float vFog;
void main() {
#include <logdepthbuf_fragment>
  vec2 q = gl_PointCoord - 0.5; float r = dot(q, q) * 4.0; if (r > 1.0) discard; float a = vA * (1.0 - r) * (1.0 - r);
  gl_FragColor = vec4(mix(vec3(uLight), uFogC, vFog), a); }`,
  transparent: true, depthWrite: false,
});
const pPts = new THREE.Points(pGeo, pMat); pPts.frustumCulled = false; pPts.renderOrder = 4;
function puff(x, y, z, vx, vy, vz, life, s0, s1, a0, gr = 0, dr = 0) {
  if (np >= PMAX) return; const i = np++;
  pa.x[i] = x; pa.y[i] = y; pa.z[i] = z; pa.vx[i] = vx; pa.vy[i] = vy; pa.vz[i] = vz; pa.age[i] = 0; pa.life[i] = life; pa.s0[i] = s0; pa.s1[i] = s1; pa.a0[i] = a0; pa.gr[i] = gr; pa.dr[i] = dr;
}
function updatePuffs(dt) {
  for (let i = 0; i < np; i++) {
    pa.age[i] += dt;
    if (pa.age[i] >= pa.life[i]) { np--; for (const k of PK) pa[k][i] = pa[k][np]; i--; continue; }
    const d = Math.max(0, 1 - pa.dr[i] * dt);
    pa.vx[i] *= d; pa.vz[i] *= d; pa.vy[i] = pa.vy[i] * d - pa.gr[i] * dt;
    pa.x[i] += pa.vx[i] * dt; pa.y[i] += pa.vy[i] * dt; pa.z[i] += pa.vz[i] * dt;
    const k = pa.age[i] / pa.life[i];
    pPos[i * 3] = pa.x[i]; pPos[i * 3 + 1] = pa.y[i]; pPos[i * 3 + 2] = pa.z[i];
    pSz[i] = pa.s0[i] + (pa.s1[i] - pa.s0[i]) * Math.sqrt(k); pAl[i] = pa.a0[i] * Math.pow(1 - k, 1.4) * Math.min(1, pa.age[i] * 5);
  }
  pGeo.setDrawRange(0, np);
  for (const n of ['position', 'aSize', 'aAlpha']) pGeo.attributes[n].needsUpdate = true;
  const sz = renderer.getDrawingBufferSize(_v2); pU.uScale.value = sz.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  const day = 1 - (G.night || 0); pU.uLight.value = 0.16 + 0.84 * day; if (scene.fog) { pU.uFogC.value.copy(scene.fog.color); pU.uFogD.value = scene.fog.density * 0.35; }
}

// ---------- routes: smooth paths sampled every few metres ----------
// pts: {x, z, y, v (m/s), g (on the water/ground), c (keep this much clear of the terrain), sm (smoke on)}
function buildRoute(pts, o = {}) {
  const step = o.step || 12, closed = !!o.closed, n = closed ? pts.length : pts.length - 1;
  const curve = new THREE.CatmullRomCurve3(pts.map(p => new V3(p.x, p.y, p.z)), closed, 'centripetal');
  const X = [], Y = [], Z = [], Vv = [], Gd = [], Cl = [], Sm = [], p = new V3();
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / step)), gnd = a.g && b.g;
    for (let j = 0; j < k; j++) {
      const t = j / k; curve.getPoint((i + t) / n, p);
      X.push(p.x); Z.push(p.z); Y.push(gnd ? a.y + (b.y - a.y) * t : Math.max(p.y, Math.min(a.y, b.y)));
      Vv.push(a.v + (b.v - a.v) * t); Gd.push(gnd ? 1 : 0); Cl.push(a.c && b.c ? Math.min(a.c, b.c) : 0); Sm.push(a.sm && b.sm ? 1 : 0);
    }
  }
  const e = closed ? pts[0] : pts[pts.length - 1];
  X.push(closed ? X[0] : e.x); Y.push(closed ? Y[0] : e.y); Z.push(closed ? Z[0] : e.z); Vv.push(e.v); Gd.push(closed ? Gd[0] : e.g ? 1 : 0); Cl.push(0); Sm.push(0);
  const N = X.length;
  // keep clear of the mountains (only where asked), then smooth the climbs so nothing jumps
  let any = false;
  for (let i = 0; i < N; i++) if (Cl[i]) { any = true; Y[i] = Math.max(Y[i], Math.max(0, heightAt(X[i], Z[i])) + Cl[i]); }
  const S = new Float32Array(N); for (let i = 1; i < N; i++) S[i] = S[i - 1] + Math.hypot(X[i] - X[i - 1], Z[i] - Z[i - 1], Y[i] - Y[i - 1]);
  if (any) {
    for (let i = 1; i < N; i++) if (!Gd[i]) Y[i] = Math.max(Y[i], Y[i - 1] - 0.13 * (S[i] - S[i - 1]));
    for (let i = N - 2; i >= 0; i--) if (!Gd[i]) Y[i] = Math.max(Y[i], Y[i + 1] - 0.13 * (S[i + 1] - S[i]));
    for (let i = 1; i < N; i++) S[i] = S[i - 1] + Math.hypot(X[i] - X[i - 1], Z[i] - Z[i - 1], Y[i] - Y[i - 1]);
  }
  return { X: Float32Array.from(X), Y: Float32Array.from(Y), Z: Float32Array.from(Z), V: Float32Array.from(Vv), G: Uint8Array.from(Gd), SM: Uint8Array.from(Sm), S, n: N, len: S[N - 1], closed };
}
let _li = 0, _lt = 0;
function posAt(r, s, out) {
  s = r.closed ? ((s % r.len) + r.len) % r.len : clamp(s, 0, r.len);
  let lo = 0, hi = r.n - 2; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (r.S[mid] <= s) lo = mid; else hi = mid - 1; }
  const t = clamp((s - r.S[lo]) / ((r.S[lo + 1] - r.S[lo]) || 1), 0, 1); _li = lo; _lt = t;
  return out.set(r.X[lo] + (r.X[lo + 1] - r.X[lo]) * t, r.Y[lo] + (r.Y[lo + 1] - r.Y[lo]) * t, r.Z[lo] + (r.Z[lo + 1] - r.Z[lo]) * t);
}
function cruiseLeg(a, b, alt, v, c = 300) {
  const d = Math.hypot(b.x - a.x, b.z - a.z), k = Math.floor(d / 15000), out = [];
  for (let i = 1; i <= k; i++) { const t = i / (k + 1); out.push(P(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, alt, v, { c })); }
  return out;
}

// ---------- aircraft objects ----------
const air = [];   // everything flying or parked that we update
const pool = {};
function craft(type) {
  const T = typeOf(type), reuse = pool[type]?.pop();
  if (reuse) { reuse.route = null; reuse.onEnd = null; reuse.tick = null; reuse.st = ''; reuse.remove = false; reuse.up.set(0, 1, 0); reuse.land = false; reuse.lit = false; reuse.maxD = 0; reuse.mult = null; reuse.high = false; reuse.llAlt = 0; reuse.hidden = false; reuse.burning = false; air.push(reuse); scene.add(reuse.g); return reuse; }
  const g = new THREE.Group(), body = new THREE.Mesh(T.geo, BODY_M); body.castShadow = true; g.add(body);
  let spin = null;
  if (T.spinGeo) { spin = new THREE.Mesh(T.spinGeo, BODY_M); spin.position.copy(T.spinPos); g.add(spin); }
  let extra = null; if (T.extra) { extra = T.extra.clone(); extra.material = T.extra.material.clone(); g.add(extra); }
  g.visible = false; scene.add(g);
  const c = { type, T, g, spin, extra, up: new V3(0, 1, 0), hd: 0, ph: Math.random() * 10, sc: 1, d: 1e9, s: 0, v: 0, rs: 0, route: null, lit: false, land: false, wasG: false, st: '', maxD: 0, hearT: 0 };
  air.push(c); return c;
}
function drop(c) { c.remove = true; }
function fly(c, route, s = 0, onEnd = null) { c.route = route; c.s = s; c.onEnd = onEnd; c.wasG = !!route.G[0]; }
// orientation from the path: fixed wings bank with the real turn (lift = turn acceleration + gravity), helis tilt into it
function pose(c, dt, inst) {
  const r = c.route, T = c.T, heli = T.kind === 'heli', D = heli ? 8 : 18;
  posAt(r, c.s, _a); const i = _li, gnd = r.G[i] && r.G[i + 1];
  c.v = r.V[i] + (r.V[i + 1] - r.V[i]) * _lt; c.smoke = r.SM[i];
  posAt(r, c.s + D, _b); posAt(r, c.s - D, _c);
  _f.subVectors(_b, _c); const fl = _f.length(); if (fl > 0.01) _f.divideScalar(fl); else _f.set(-Math.sin(c.hd), 0, -Math.cos(c.hd));
  _k.copy(_b).add(_c).addScaledVector(_a, -2).multiplyScalar(c.v * c.v / (D * D));   // acceleration around the curve
  c.g.position.copy(_a);
  const ease = inst ? 1 : 1 - Math.exp(-dt * (gnd ? 8 : 4.5));
  if (heli) {
    const hx = _f.x, hz = _f.z, hl = Math.hypot(hx, hz);
    if (hl > 0.35 && c.v > 1.5) { const want = Math.atan2(-hx, -hz); let dd = want - c.hd; dd = Math.atan2(Math.sin(dd), Math.cos(dd)); c.hd += inst ? dd : clamp(dd, -1.3 * dt, 1.3 * dt); }
    _r.set(-Math.sin(c.hd), 0, -Math.cos(c.hd));
    if (gnd) _u.set(0, 1, 0); else { _u.set(0, 9.8, 0).addScaledVector(_k, 0.8).addScaledVector(_r, Math.min(c.v, 70) * 0.03); _u.y = Math.max(_u.y, 3); }
    c.up.lerp(_u.normalize(), ease).normalize();
    _f.copy(_r);
  } else {
    if (gnd) _u.set(0, 1, 0); else { _u.copy(_k).addScaledVector(_f, -_k.dot(_f)); _u.y += 9.8; }
    if (_u.lengthSq() > 4) c.up.lerp(_u.normalize(), ease).normalize();
    if (!gnd) _f.addScaledVector(c.up, 0.045).normalize();   // a little nose-up attitude
    c.hd = Math.atan2(-_f.x, -_f.z);
  }
  _c.copy(_f).negate();                 // back
  _r.crossVectors(c.up, _c).normalize(); // right
  _u.crossVectors(_c, _r);              // true up
  _m.makeBasis(_r, _u, _c); c.g.quaternion.setFromRotationMatrix(_m);
  return gnd;
}
function parkPose(c, x, y, z, yaw, bob = 0) {
  c.g.position.set(x, y + bob * Math.sin(G.t * 1.3 + c.ph) * 0.06, z);
  _e.set(bob * Math.sin(G.t * 0.9 + c.ph) * 0.012, yaw, bob * Math.sin(G.t * 1.1 + c.ph) * 0.02, 'YXZ'); c.g.quaternion.setFromEuler(_e); c.hd = yaw;
}

// ---------- floatplane harbours + fleet ----------
const HB = {};
function waterSpot(x, z, clear, avoid = []) {
  for (let r = 0; r < 500; r += 6) for (let k = 0; k < (r ? 16 : 1); k++) {
    const a = k / 16 * TAU, X = x + Math.cos(a) * r, Z = z + Math.sin(a) * r;
    if (!isWater(X, Z) || avoid.some(([ax, az]) => Math.hypot(ax - X, az - Z) < 16)) continue;
    let ok = true; for (let j = 0; j < 8 && ok; j++) ok = isWater(X + Math.cos(j * 0.785) * clear, Z + Math.sin(j * 0.785) * clear);
    if (ok) return [X, Z];
  }
  return [x, z];
}
function noseToShore(x, z) { for (let r = 10; r < 150; r += 10) for (let k = 0; k < 16; k++) { const a = k / 16 * TAU, X = x + Math.cos(a) * r, Z = z + Math.sin(a) * r; if (!isWater(X, Z)) return Math.atan2(-(X - x), -(Z - z)); } return 0; }
function harbour(id, name, A, B, slots, o = {}) {
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]), f = [(B[0] - A[0]) / L, (B[1] - A[1]) / L], wl = waterLevel(A[0], A[1]);
  const h = { id, name, A, B, L, f, wl, next: 0, slots: [], ...o };
  const done = [];
  for (const s of slots) {
    let [x, z, yaw] = s;
    if (o.findSlots) { [x, z] = waterSpot(x, z, 9, done); yaw = noseToShore(x, z); }
    done.push([x, z]); h.slots.push({ x, z, yaw, c: null });
  }
  HB[id] = h; return h;
}
const at = (h, k, n = 0) => { const nn = [h.f[1], -h.f[0]]; return [h.A[0] + h.f[0] * k + nn[0] * n, h.A[1] + h.f[1] * k + nn[1] * n]; };
const atB = (h, k, n = 0) => { const nn = [h.f[1], -h.f[0]]; return [h.B[0] + h.f[0] * k + nn[0] * n, h.B[1] + h.f[1] * k + nn[1] * n]; };
function initHarbours() {
  const [tx, tz] = toXZ(49.2913, -123.1175);   // the Harbour Err dock (ships.js builds the dock + terminal)
  const LG = toXZ(49.315, -123.138);           // Lions Gate Bridge
  HB.lg = LG;
  harbour('coal', 'Coal Harbour', [tx + 80, tz - 70], [tx + 1680, tz - 390], [...Array(6)].map((_, i) => [tx - 35 + i * 14, tz - 9, Math.PI]), {
    landRev: true,
    out: h => [P(...atB(h, 700), h.wl + 150, 52), P(h.B[0] + 1300, h.B[1] - 1300, 260, 55), P(1000, -2900, 380, 58), P(LG[0], LG[1], 480, 60, { c: 150 })],
    in: () => [P(LG[0], LG[1], 500, 60, { c: 150 }), P(2000, -2650, 320, 52)],
  });
  { const [cx, cz] = toXZ(48.4225, -123.375); harbour('vic', 'Victoria Inner Harbour', [cx + 150, cz - 300], [cx - 1350, cz - 400], [0, 1, 2, 3].map(i => [cx + 120 + i * 40, cz - 110 + i * 15]), { findSlots: true }); }
  { const [cx, cz] = toXZ(49.170, -123.930); harbour('nan', 'Nanaimo Harbour', [cx, cz + 250], [cx - 100, cz - 750], [0, 1, 2].map(i => [cx + 150, cz + 150 + i * 30]), { findSlots: true }); }
  { const [cx, cz] = toXZ(50.145, -122.945); harbour('green', 'Green Lake (Whistler)', [cx - 500, cz], [cx + 800, cz - 750], [0, 1, 2].map(i => [cx - 470 + i * 20, cz + 70 + i * 15]), { findSlots: true }); }
  for (const h of Object.values(HB)) if (h.slots) { if (!h.out) h.out = hh => [P(...at(hh, hh.L + 1500), hh.wl + 260, 55, { c: 120 })]; if (!h.in) h.in = () => []; }
}
function departPts(h, sl) {
  const { A, L, wl } = h, dx = A[0] - sl.x, dz = A[1] - sl.z, dl = Math.hypot(dx, dz) || 1, y = wl + 0.05;
  return [P(sl.x, sl.z, y, 1.5, GND), P(sl.x + dx / dl * 28, sl.z + dz / dl * 28, y, 4, GND), P(...at(h, 0), y, 5, GND), P(...at(h, 45), y, 9, GND), P(...at(h, L * 0.42), y, 31, GND), P(...at(h, L * 0.62), wl + 16, 40), P(...at(h, L), wl + 80, 48), ...h.out(h)];
}
function arrivePts(h, sl, skipIn) {
  const { wl, L } = h, y = wl + 0.05, pre = skipIn ? [] : h.in(h);
  let land;
  if (h.landRev) land = [P(...atB(h, 3000, 500), wl + 200, 48, { c: 60 }), P(...atB(h, 1600), wl + 85, 42), P(...atB(h, 600), wl + 28, 36), P(...atB(h, -150), y, 30, GND), P(...at(h, 260), y, 7, GND)];
  else land = [P(...at(h, -3200), wl + 260, 48, { c: 150 }), P(...at(h, -1800), wl + 130, 44, { c: 60 }), P(...at(h, -600), wl + 40, 36, { c: 25 }), P(...at(h, 120), y, 30, GND), P(...at(h, L * 0.55), y, 7, GND), P(...at(h, L * 0.5, 35), y, 4, GND)];
  const q = land[land.length - 1], dx = q.x - sl.x, dz = q.z - sl.z, dl = Math.hypot(dx, dz) || 1;
  return [...pre, ...land, P(sl.x + dx / dl * 28, sl.z + dz / dl * 28, y, 3, GND), P(sl.x, sl.z, y, 1, GND)];
}
const TOUR = () => [LL(49.36, -123.11, 900, 55, { c: 250 }), LL(49.38, -123.08, 1500, 55, { c: 250 }), LL(49.372, -123.02, 1300, 55, { c: 250 }), LL(49.33, -122.95, 600, 55, { c: 200 }), LL(49.305, -123.0, 350, 52, { c: 120 })];
function planeRoute(h1, sl1, h2, sl2, tour) {
  const dep = departPts(h1, sl1), arr = arrivePts(h2, sl2, tour), mid = tour ? TOUR() : [];
  const a = dep[dep.length - 1], b = mid[0] || arr[0], alt = h1.id === 'green' || h2.id === 'green' ? 2600 : 1000;
  return buildRoute(tour ? [...dep, ...mid, ...arr] : [...dep, ...cruiseLeg(a, b, alt, 62), ...arr], { step: 15 });
}
const fleet = [];
const freeSlot = h => h.slots.find(s => !s.c);
function dockAt(c, h, sl, timer) { c.st = 'dock'; c.h = h; c.sl = sl; sl.c = c; c.route = null; c.timer = timer; c.lit = false; c.land = false; }
const turnaround = h => h.id === 'coal' ? R(40, 150) : R(120, 300);
function startPlane(c, seedFrac = null) {
  const h1 = c.h; let h2, tour = false;
  if (h1.id === 'coal') { const d = pick(['vic', 'vic', 'vic', 'nan', 'nan', 'green', 'tour', 'tour', 'tour']); tour = d === 'tour'; h2 = tour ? h1 : HB[d]; } else h2 = HB.coal;
  let sl2 = freeSlot(h2);
  if (!sl2 && tour) sl2 = c.sl;   // a tour comes home to its own berth
  if (!sl2) return false;
  const sl1 = c.sl; sl1.c = null; sl2.c = c;
  const route = planeRoute(h1, sl1, h2, sl2, tour);
  c.st = 'fly'; c.lit = true; c.dest = h2; c.destSl = sl2;
  fly(c, route, seedFrac === null ? 0 : route.len * seedFrac, cc => dockAt(cc, h2, sl2, turnaround(h2)));
  c.mult = () => (c.d > 14000 && c.s > 9000 && route.len - c.s > 9000 ? 5 : 1);   // far from you, long legs fast-forward
  return true;
}
function initFleet() {
  const types = ['float', 'float', 'float', 'float2', 'float3'];
  const place = [['coal', 5], ['vic', 2], ['nan', 1], ['green', 1]];
  let k = 0;
  for (const [id, n] of place) for (let i = 0; i < n; i++) { const c = craft(types[k++ % types.length]); fleet.push(c); dockAt(c, HB[id], HB[id].slots[i], id === 'coal' ? 8 + i * R(15, 35) : R(30, 250)); }
  for (let i = 0; i < 7; i++) {   // some already in the air when the game starts
    const h = pick([HB.coal, HB.vic, HB.nan, HB.green, HB.coal]), sl = freeSlot(h); if (!sl) continue;
    const c = craft(types[k++ % types.length]); fleet.push(c);
    dockAt(c, h, sl, 0); if (!startPlane(c, R(0.15, 0.85))) c.timer = R(20, 120);
  }
}
const canFloat = () => (G.fogW || 0) < 0.55 && (G.wet || 0) < 0.75 && (G.night || 0) < 0.6;
let seenFloats = 0, toastFloat = false;
function updateFleet(dt) {
  for (const c of fleet) {
    if (c.remove) continue;
    if (c.st === 'dock') {
      c.timer -= dt;
      if (c.timer < 0) { if (canFloat() && G.t > c.h.next && startPlane(c)) c.h.next = G.t + 25; else c.timer = R(15, 40); }
    }
  }
}

// ---------- heliports + Helijest + the sightseeing heli ----------
const pads = {}, helis = [];
let padLights = [];
function hTex(label) {
  return canvasTex(256, 256, (c, w) => {
    c.fillStyle = '#2f3438'; c.fillRect(0, 0, w, w); c.strokeStyle = '#f2c230'; c.lineWidth = 10; c.beginPath(); c.arc(w / 2, w / 2, w * 0.42, 0, TAU); c.stroke();
    c.fillStyle = '#ffffff'; c.font = 'bold 150px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(label, w / 2, w / 2 + 6);
  }, false);
}
function buildHeliport(id, x, z, y, padXs, overWater, name) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  const W = padXs.length * 26 + 4, D = 26, deck = std('#7c8288');
  addMesh(new THREE.BoxGeometry(W, 0.7, D), deck, 0, y - 0.35, 0, g);
  if (overWater) for (let i = -1; i <= 1; i += 2) for (let j = -1; j <= 1; j += 2) for (const k of [0, 0.5]) addMesh(new THREE.CylinderGeometry(0.45, 0.45, y + 6, 8), std('#5b5048'), i * (W / 2 - 1.5) * (1 - k), y / 2 - 3, j * (D / 2 - 1.5), g, false);
  for (const s of [-1, 1]) addMesh(new THREE.BoxGeometry(W, 0.9, 0.12), std('#d8dadc', { metalness: 0.5 }), 0, y + 0.45, s * D / 2, g, false);
  addMesh(new THREE.BoxGeometry(7, 3.4, 4.5), std('#e8e4da'), W / 2 - 5, y + 1.7, D / 2 - 3.2, g);
  addMesh(new THREE.CylinderGeometry(0.07, 0.07, 5, 6), std('#ddd'), -W / 2 + 1.5, y + 2.5, -D / 2 + 1.5, g, false);
  addMesh(new THREE.ConeGeometry(0.45, 2.4, 10, 1, true).rotateZ(Math.PI / 2), std('#ff7a1a'), -W / 2 + 2.7, y + 4.6, -D / 2 + 1.5, g, false);
  const out = bake(g);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(6.5, 1.2), new THREE.MeshBasicMaterial({ map: canvasTex(512, 96, (c, w, h) => { c.fillStyle = '#1d3f72'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.font = 'bold 60px sans-serif'; c.textAlign = 'center'; c.fillText('HELIJEST 🚁', w / 2, 70); }, false) }));
  sign.position.set(x + W / 2 - 5, y + 3.9, z + D / 2 - 0.9); scene.add(sign);
  const list = [];
  padXs.forEach((px, i) => {
    const hm = new THREE.Mesh(new THREE.PlaneGeometry(18, 18).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: hTex('H'), roughness: 0.9 }));
    hm.position.set(x + px, y + 0.03, z); hm.receiveShadow = true; scene.add(hm);
    const p = { id: id + i, x: x + px, z, y: y + 0.05, hd: Math.PI / 2, name, c: null }; pads[p.id] = p; list.push(p);
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; padLights.push(new V3(x + px + Math.cos(a) * 9.2, y + 0.15, z + Math.sin(a) * 9.2)); }
  });
  addFlatSurface([x - W / 2, z - D / 2, x + W / 2, z - D / 2, x + W / 2, z + D / 2, x - W / 2, z + D / 2], y);
  return list;
}
function initHeliports() {
  const dt = toXZ(49.2875, -123.106); dt[1] += 58;
  buildHeliport('dt', dt[0], dt[1], 5, [-13, 13], true, 'Vancouver Harbour Heliport');
  const [vx, vz] = toXZ(48.4155, -123.388), vx2 = vx + 100, vy = Math.max(0.5, heightAt(vx2, vz)) + 0.6;
  buildHeliport('vic', vx2, vz, vy, [0], false, 'Victoria Harbour Heliport');
}
function helijetPts(a, b) {   // a, b = pads; reversible on the way back
  const dtP = a.id.startsWith('dt') ? a : b, vP = a === dtP ? b : a;
  const side = [P(dtP.x, dtP.z, dtP.y, 0.6, GND), P(dtP.x, dtP.z, dtP.y + 30, 3), P(dtP.x - 150, dtP.z - 250, dtP.y + 90, 18), P(-300, -2300, 300, 45), P(-3300, -3300, 450, 62, { c: 150 })];
  const vside = [P(vP.x - 1600, vP.z - 1100, 300, 50, { c: 80 }), P(vP.x - 350, vP.z - 250, vP.y + 70, 16), P(vP.x, vP.z, vP.y + 25, 3), P(vP.x, vP.z, vP.y, 0.6, GND)];
  let pts = [...side, ...cruiseLeg(side[side.length - 1], vside[0], 500, 68, 200), ...vside];
  if (a !== dtP) pts = pts.reverse();
  return buildRoute(pts, { step: 10 });
}
function tourPts(p) {
  return buildRoute([P(p.x, p.z, p.y, 0.6, GND), P(p.x, p.z, p.y + 30, 3), P(p.x - 200, p.z - 300, p.y + 110, 20), P(HB.lg[0], HB.lg[1], 260, 40, { c: 120 }), LL(49.36, -123.112, 700, 42, { c: 220 }),
    LL(49.381, -123.081, 1450, 40, { c: 220 }), LL(49.406, -123.09, 1550, 40, { c: 220 }), LL(49.457, -123.186, 1950, 42, { c: 260 }), LL(49.396, -123.205, 1350, 45, { c: 220 }),
    LL(49.335, -123.165, 420, 45, { c: 150 }), LL(49.302, -123.137, 250, 35, { c: 110 }), P(p.x - 300, p.z - 350, p.y + 90, 16), P(p.x, p.z, p.y + 25, 3), P(p.x, p.z, p.y, 0.6, GND)], { step: 10 });
}
function startHeli(c) {
  const from = c.pad, to = c.isTour ? from : (from.id.startsWith('dt') ? pads.vic0 : pads.dt0);
  const route = c.isTour ? tourPts(from) : helijetPts(from, to);
  c.st = 'fly'; c.lit = true;
  fly(c, route, 0, cc => { cc.st = 'pad'; cc.pad = to; cc.timer = cc.isTour ? R(60, 140) : R(120, 260); cc.route = null; cc.lit = false; });
  c.mult = () => (c.d > 14000 && c.s > 9000 && route.len - c.s > 9000 ? 5 : 1);
}
function initHelis() {
  const a = craft('h_helijet'), b = craft('h_helijet'), t = craft('h_tour');
  for (const [c, p, tm, tour] of [[a, pads.dt0, 25, false], [b, pads.vic0, 90, false], [t, pads.dt1, 60, true]]) { c.st = 'pad'; c.pad = p; p.c = c; c.timer = tm; c.isTour = tour; helis.push(c); }
}
function updateHelis(dt) {
  for (const c of helis) if (c.st === 'pad') { c.timer -= dt; if (c.timer < 0) startHeli(c); }
}

// ---------- special helicopters: news / police / rescue ----------
let special = null, specialT = 45, rope = null, rescuer = null, beam = null, beamSpot = null;
function initSpecialBits() {
  rope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1, 4).translate(0, -0.5, 0), std('#222')); rope.visible = false; scene.add(rope);
  rescuer = new THREE.Group(); addMesh(new THREE.BoxGeometry(0.55, 1.2, 0.35), std('#ff6a00'), 0, -0.6, 0, rescuer); addMesh(new THREE.SphereGeometry(0.2, 8, 6), std('#f6e05e'), 0, 0.15, 0, rescuer);
  addMesh(new THREE.BoxGeometry(0.5, 0.9, 0.3), std('#c53030'), 0.45, -1.0, 0.1, rescuer); rescuer.visible = false; scene.add(rescuer);
  beam = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 20, 1, true).translate(0, -0.5, 0), new THREE.MeshBasicMaterial({ color: 0xfff4d0, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  beam.visible = false; scene.add(beam);
  beamSpot = new THREE.Mesh(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTex(), color: 0xfff4d0, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
  beamSpot.visible = false; scene.add(beamSpot);
}
const SPECIAL_TXT = {
  news: ['📺 NOOZ Chopper 13', 'A news helicopter is circling overhead. Wave, you might be on the 6 o\'clock news!'],
  police: ['🚔 Police helicopter', 'Air 1 is circling the neighbourhood. It\'s not looking for you. Probably.'],
  rescue: ['🆘 Rescue helicopter', 'A rescuer dangles on a long-line under the helicopter. North Shore mountains: always pack the ten essentials!'],
  coast: ['🛟 Coast guard hovercraft? No: helicopter', 'A rescue helicopter is sweeping the water. Somebody\'s paddleboard drifted too far.'],
};
function spawnSpecial(kind) {
  const pl = PL, gh = Math.max(0, heightAt(pl.x, pl.z));
  if (!kind) kind = gh > 250 ? 'rescue' : isWater(pl.x, pl.z) ? pick(['coast', 'news']) : (G.night || 0) > 0.5 ? pick(['police', 'police', 'news']) : pick(['news', 'news', 'police', 'coast']);
  const resc = kind === 'rescue' || kind === 'coast';
  const tx = pl.x + R(-350, 350), tz = pl.z + R(-350, 350), gr = Math.max(0, heightAt(tx, tz)), alt = gr + (kind === 'rescue' ? 75 : R(190, 270)), rad = kind === 'rescue' ? 90 : R(230, 330);
  const a0 = R(0, TAU), dir = Math.random() < 0.5 ? 1 : -1, ex = a0 + R(1.6, 3);
  const pts = [P(tx + Math.cos(a0) * 5200, tz + Math.sin(a0) * 5200, alt + 200, 62, { c: 150 }), P(tx + Math.cos(a0) * (rad + 700), tz + Math.sin(a0) * (rad + 700), alt + 50, 42, { c: 100 })];
  const laps = kind === 'rescue' ? 3 : 2, sp = kind === 'rescue' ? 14 : 30;
  for (let k = 0; k <= 12 * laps; k++) { const an = a0 + dir * k / 12 * TAU; pts.push(P(tx + Math.cos(an) * rad, tz + Math.sin(an) * rad, alt, sp, { c: kind === 'rescue' ? 60 : 140 })); }
  pts.push(P(tx + Math.cos(ex) * 1600, tz + Math.sin(ex) * 1600, alt + 120, 52, { c: 150 }), P(tx + Math.cos(ex) * 6000, tz + Math.sin(ex) * 6000, alt + 260, 62, { c: 150 }));
  const c = craft('h_' + (kind === 'coast' ? 'rescue' : kind));
  c.lit = true; c.kind = kind; c.tx = tx; c.tz = tz; c.told = false; c.orbitS = 0;
  const r = buildRoute(pts, { step: 10 }); c.orbitS = Math.hypot(pts[0].x - pts[1].x, pts[0].z - pts[1].z) + 50;
  fly(c, r, 0, cc => { drop(cc); special = null; rope.visible = rescuer.visible = beam.visible = beamSpot.visible = false; });
  c.tick = specialTick; special = c; return c;
}
function specialTick(c, dt) {
  if (!c.told && c.s > c.orbitS && Math.hypot(c.tx - PL.x, c.tz - PL.z) < 1500) { c.told = true; const [t, b] = SPECIAL_TXT[c.kind]; ui.toast(t, b, 4500); }
  const p = c.g.position;
  const line = c.kind === 'rescue' && c.s > c.orbitS - 300 && c.d < 4000;
  rope.visible = rescuer.visible = line;
  if (line) {
    const L = 28 * c.sc, sw = Math.sin(G.t * 0.9) * 0.12; rope.position.copy(p); rope.scale.set(c.sc, L, c.sc); rope.rotation.set(sw, 0, sw * 0.6);
    _k.set(0, -L, 0).applyEuler(rope.rotation).add(p); rescuer.position.copy(_k); rescuer.scale.setScalar(c.sc); rescuer.rotation.y += dt * 0.4;
  }
  const lamp = c.kind === 'police' && (G.night || 0) > 0.45 && c.d < 6000;
  beam.visible = beamSpot.visible = lamp;
  if (lamp) {
    const gx = c.tx + Math.sin(G.t * 0.37) * 70, gz = c.tz + Math.cos(G.t * 0.29) * 70, gy = Math.max(0, heightAt(gx, gz)) + 0.6;
    _b.set(gx, gy, gz); _a.subVectors(_b, p); const L = _a.length(); _a.divideScalar(L);
    beam.position.copy(p); beam.quaternion.setFromUnitVectors(_k.set(0, -1, 0), _a); beam.scale.set(L * 0.07, L, L * 0.07);
    beamSpot.position.copy(_b); beamSpot.scale.setScalar(L * 0.07 + 2);
  }
}

// ---------- YVR arrivals over the city, small planes, high jets with contrails ----------
const JETS = ['jetA', 'jetA', 'jetB', 'jetC', 'jetD', 'jetE'];
let arrT = 20, cessT = 40, highT = 5;
function yvrArrival(frac = 0) {
  const rw = runways[1]; if (!rw) return;
  const u = [rw.ux, rw.uz], n = [rw.uz, -rw.ux], y0 = rw.y + 0.1, th = (a, b = 0) => [rw.s.x + u[0] * a + n[0] * b, rw.s.z + u[1] * a + n[1] * b];
  const pts = [P(14000, -2600, 2700, 125, { c: 400 }), P(7000, -1900, 2200, 115, { c: 400 }), P(1500, -900, 1750, 105, { c: 300 }), P(-4000, 0, 1350, 95, { c: 250 }), P(-9500, 1800, 1050, 90, { c: 250 }),
    P(...th(-10500, 4200), 760, 85), P(...th(-6500), y0 + 340, 78), P(...th(-2500), y0 + 130, 74), P(...th(300), y0, 70, GND), P(...th(1900), y0, 25, GND), P(...th(2350), y0, 10, GND)];
  const c = craft(pick(JETS)), r = buildRoute(pts, { step: 25 }); c.lit = true; c.llAlt = 2600;
  fly(c, r, r.len * frac, drop);
}
const VFR = [[49.19, -123.17, 160], [49.222, -123.212, 320], [49.268, -123.262, 420], [49.287, -123.165, 420], [49.306, -123.152, 450], [49.316, -123.139, 470], [49.302, -123.06, 470], [49.25, -123.06, 520], [49.205, -123.105, 320], [49.192, -123.158, 120]];
function vfrFlight(frac = 0) {
  let pts = VFR.map(([la, lo, y], i) => LL(la, lo, y, 48, { c: i && i < VFR.length - 1 ? 140 : 0 }));
  if (Math.random() < 0.5) pts = pts.reverse();
  const c = craft('cessna'), r = buildRoute(pts, { step: 15 }); c.lit = true; c.llAlt = 350;
  fly(c, r, r.len * frac, drop);
}
let highN = 0;
function highJet(frac = 0) {
  const a = R(0, TAU), off = R(-14000, 14000), dx = Math.cos(a), dz = Math.sin(a), cx = PL.x - dz * off, cz = PL.z + dx * off, y = R(9500, 11500);
  const c = craft(pick(JETS)); c.lit = true; c.maxD = 70000; c.high = true; c.puffT = 0; highN++;
  const r = buildRoute([P(cx - dx * 42000, cz - dz * 42000, y, 235), P(cx + dx * 42000, cz + dz * 42000, y, 235)], { step: 400 });
  fly(c, r, r.len * frac, cc => { drop(cc); highN--; });
  c.tick = contrail;
}
function contrail(c, dt) {
  if ((G.night || 0) > 0.7 || (G.wet || 0) > 0.4 || (G.fogW || 0) > 0.4) return;
  c.puffT -= dt; if (c.puffT > 0) return; c.puffT = 0.18;
  _k.set(0, 0, 45 * c.sc).applyQuaternion(c.g.quaternion).add(c.g.position);
  puff(_k.x + R(-4, 4), _k.y + R(-3, 3), _k.z + R(-4, 4), R(-1, 1), R(-0.5, 0.5), R(-1, 1), 70, 16, 95, 0.2);
}

// ---------- surprises: banner plane, hot-air balloon, vintage biplane ----------
const BANNERS = ['MARRY ME, PRIYA? 💍', 'HONK IF YOU LOVE RAIN', 'McDOUGAL\'S: NOW WITH 20% MORE FRIES', 'WEAR SUNSCREEN, VANCOUVER ☀', 'GO CANUCKERS GO! 🏒', 'YOUR RENT WENT UP. SORRY.', 'SEAWALL: STAY IN YOUR LANE 🚲', 'FREE HUGS AT KITS BEACH'];
let banner = null, bannerMesh = null, towRope = null, bannerDay = -1;
function initBanner() {
  const pts = [LL(49.2745, -123.152, 230, 38), LL(49.2855, -123.142, 230, 38), LL(49.293, -123.152, 230, 38), LL(49.302, -123.16, 230, 38), LL(49.293, -123.19, 230, 38), LL(49.278, -123.212, 230, 38), LL(49.272, -123.18, 230, 38)];
  banner = craft('cessnaY'); banner.lit = true; banner.mult = () => 1;
  fly(banner, buildRoute(pts, { closed: true, step: 12 }), 0, null); banner.g.visible = false;
  const geo = new THREE.PlaneGeometry(36, 5, 18, 1); geo.translate(18, 0, 0);
  bannerMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: bannerTex(BANNERS[0]), side: THREE.DoubleSide, roughness: 0.9 })); bannerMesh.userData.base = geo.attributes.position.array.slice(); scene.add(bannerMesh);
  towRope = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 4).translate(0, 0.5, 0).rotateX(Math.PI / 2), std('#333')); scene.add(towRope);
  bannerMesh.visible = towRope.visible = false;
}
function bannerTex(txt) {
  return canvasTex(1024, 140, (c, w, h) => { c.fillStyle = '#fbfaf2'; c.fillRect(0, 0, w, h); c.fillStyle = '#c81e1e'; c.fillRect(0, 0, w, 10); c.fillRect(0, h - 10, w, 10); c.font = 'bold 84px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(txt, w / 2, h / 2 + 4, w - 40); }, false);
}
const bannerOn = () => G.season === 'summer' && (G.night || 0) < 0.3 && (G.wet || 0) < 0.15 && (G.fogW || 0) < 0.3;
let bannerTold = false;
function updateBanner() {
  const on = bannerOn(), c = banner;
  if (on !== c.active && (c.d > 1800 || !c.g.visible)) {
    c.active = on;
    if (on && bannerDay !== G.doy) { bannerDay = G.doy; const t = BANNERS[(G.doy || 0) % BANNERS.length]; bannerMesh.material.map.dispose(); bannerMesh.material.map = bannerTex(t); c.bannerTxt = t; }
  }
  c.hidden = !c.active;
  const show = c.active && c.d < 26000; bannerMesh.visible = towRope.visible = show;
  if (!show) return;
  // the banner hangs 45 m behind, flapping in the slipstream
  const sc = Math.min(c.sc, 2.5), q = c.g.quaternion, p = c.g.position;
  _a.set(0, 0, 1).applyQuaternion(q); _a.y = 0; _a.normalize();
  const tail = _k.set(0, 2.2, 5.5).multiplyScalar(c.sc).applyQuaternion(q).add(p), front = _b.copy(tail).addScaledVector(_a, 30 * sc); front.y -= 6 * sc;
  towRope.position.copy(tail); towRope.lookAt(front); towRope.scale.set(sc, sc, tail.distanceTo(front));
  bannerMesh.position.copy(front); bannerMesh.rotation.set(0, Math.atan2(-_a.z, _a.x), 0); bannerMesh.scale.setScalar(sc);
  const pos = bannerMesh.geometry.attributes.position, base = bannerMesh.userData.base;
  for (let i = 0; i < pos.count; i++) { const x = base[i * 3]; pos.array[i * 3 + 2] = Math.sin(x * 0.45 - G.t * 9) * 0.5 * (x / 36); }
  pos.needsUpdate = true;
  if (!bannerTold && c.d < 900 && PL) { bannerTold = true; ui.toast('✈️ Banner plane!', `"${c.bannerTxt || BANNERS[0]}" is being towed over English Bay.`, 4500); discover('bannerplane'); }
}
let balloon = null, balloonT = 150;
function spawnBalloon() {
  const a = R(0, TAU), px = PL.x - Math.cos(a) * 2400 + R(-900, 900), pz = PL.z - Math.sin(a) * 2400 + R(-900, 900);
  const c = craft('balloon'); c.maxD = 20000; c.lit = true; c.hd = R(0, TAU);
  const gr = Math.max(0, heightAt(px, pz));
  c.b = { x: px, z: pz, y: gr + R(250, 450), vx: Math.cos(a) * 3.2, vz: Math.sin(a) * 3.2, vy: 0, burn: 0, burnT: 2, life: 900, told: false };
  c.tick = balloonTick; balloon = c;
}
function balloonTick(c, dt) {
  const b = c.b; b.life -= dt;
  const gr = Math.max(0, heightAt(b.x, b.z)), want = gr + 300 + Math.sin(G.t * 0.05) * 120;
  b.burnT -= dt; if (b.burnT < 0) { b.burn = b.y < want ? R(1.5, 4) : 0; b.burnT = R(5, 11); if (b.burn && c.d < 220) noise(b.burn, 0.05, 420); }
  b.burn = Math.max(0, b.burn - dt);
  b.vy += ((b.burn > 0 ? 0.35 : -0.12) - b.vy * 0.05) * dt; b.vy = clamp(b.vy, -1.6, 1.6);
  b.x += b.vx * dt; b.z += b.vz * dt; b.y = Math.max(gr + 40, b.y + b.vy * dt);
  c.hd += dt * 0.02; parkPose(c, b.x, b.y, b.z, c.hd, 0);
  if (c.extra) { c.extra.visible = b.burn > 0; c.extra.scale.set(1.6, 2.6 + Math.random() * 1.2, 1); }
  c.burning = b.burn > 0;
  if (!b.told && c.d < 900) { b.told = true; ui.toast('🎈 Hot-air balloon!', 'A balloon is drifting over the city. Listen for the burner: FWOOOSH.', 4500); discover('balloon'); }
  if (b.life < 0 || Math.hypot(b.x - PL.x, b.z - PL.z) > 6500) { drop(c); balloon = null; }
}
let biplane = null, biplaneT = 240;
function spawnBiplane() {
  const eb = toXZ(49.287, -123.16), near = Math.hypot(eb[0] - PL.x, eb[1] - PL.z) < 4000;
  const C = near ? [eb[0] + R(-300, 300), eb[1] + R(-200, 200)] : [PL.x + R(-300, 300), PL.z + R(-300, 300)];
  const base = Math.max(0, heightAt(C[0], C[1])) + 230, a = R(0, TAU), d = [Math.cos(a), Math.sin(a)], lf = [d[1], -d[0]];
  const p = (along, side, up, v, sm = 1) => P(C[0] + d[0] * along + lf[0] * side, C[1] + d[1] * along + lf[1] * side, base + up, v, { sm });
  const pts = [p(-3800, 0, 160, 62, 0), p(-700, 0, 0, 60, 0), p(-250, 0, 0, 60)];
  const loop = (along, side, sign) => { for (let k = 0; k <= 12; k++) { const f = k / 12 * TAU; pts.push(p(along + sign * 115 * Math.sin(f), side, 115 * (1 - Math.cos(f)), 60 - 22 * (1 - Math.cos(f)) / 2)); } };
  loop(0, 0, 1);
  pts.push(p(450, 0, 0, 56));
  for (let k = 1; k <= 12; k++) { const f = k / 12 * TAU; pts.push(p(450 + 520 * k / 12, 34 * Math.sin(f), 34 * (1 - Math.cos(f)), 52)); }
  for (let k = 1; k <= 7; k++) { const th = k / 7 * Math.PI; pts.push(p(970 + 230 * Math.sin(th), 230 * (1 - Math.cos(th)), 170 * Math.sin(th), 56 - 14 * Math.sin(th), 0)); }
  pts.push(p(700, 460, 0, 60)); loop(250, 460, -1);
  pts.push(p(-400, 460, 0, 58), p(-4200, 600, 220, 62, 0));
  const c = craft('biplane'); c.lit = true; c.told = false; c.showC = C; c.smT = 0;
  fly(c, buildRoute(pts, { step: 6 }), 0, cc => { drop(cc); biplane = null; });
  c.tick = (cc, dt) => {
    if (cc.smoke) { cc.smT -= dt; if (cc.smT < 0) { cc.smT = 0.05; _k.set(0, 1.5, 5).multiplyScalar(cc.sc).applyQuaternion(cc.g.quaternion).add(cc.g.position); puff(_k.x, _k.y, _k.z, R(-0.5, 0.5), R(-0.2, 0.4), R(-0.5, 0.5), 22, 2.5, 16, 0.75, 0, 0.1); } }
    if (!cc.told && cc.smoke && cc.d < 1400) { cc.told = true; ui.toast('🛩️ Air show!', 'A vintage biplane is looping the loop. Smoke on!', 4500); discover('biplane'); }
  };
  biplane = c;
}

// ---------- update loop ----------
let lastT = 0;
function stepCraft(c, dt) {
  c.d = c.g.position.distanceTo(camera.position);
  if (c.route) {
    const mult = c.mult ? c.mult() : 1;
    c.s += c.v * dt * mult + (c.v < 0.5 ? 0.5 * dt : 0);
    if (!c.route.closed && c.s >= c.route.len) { c.s = c.route.len; const f = c.onEnd; c.route = null; if (f) f(c); if (c.remove || !c.route) return; }
    const gnd = pose(c, dt, mult > 1);
    if (c.T.floats) {
      if (c.wasG && !gnd) { onLift(c); } else if (!c.wasG && gnd) { onTouch(c); }
      if (gnd && c.v > 6 && c.d < 2500) floatSpray(c, dt);
    }
    if (c.T.kind === 'heli' && c.d < 2500) heliWash(c, dt);
    c.wasG = gnd; c.gnd = gnd;
    c.land = c.lit && c.g.position.y < (c.llAlt || (c.T.kind === 'heli' ? 400 : 450));
  } else if (c.st === 'dock') { c.gnd = true; if (c.d < 4000) parkPose(c, c.sl.x, c.h.wl + 0.05, c.sl.z, c.sl.yaw, 1); else c.g.position.set(c.sl.x, c.h.wl + 0.05, c.sl.z); }
  else if (c.st === 'pad') { c.gnd = true; parkPose(c, c.pad.x, c.pad.y, c.pad.z, c.pad.hd, 0); c.up.set(0, 1, 0); }
  if (c.tick) c.tick(c, dt);
  if (c.remove) return;
  c.sc = clamp(c.d / c.T.d0, 1, c.route && !c.gnd ? c.T.cap : 1.2);   // airborne ones grow with distance so they never shrink to nothing; parked ones stay true size c.g.scale.setScalar(c.sc);
  c.g.visible = !c.hidden && c.d < (c.maxD || c.T.maxD);
  if (c.spin) {
    const want = c.st === 'dock' ? (c.timer < 9 ? 45 : 0) : c.st === 'pad' ? (c.timer < 14 ? 30 : 0) : c.route ? (c.T.kind === 'heli' ? 30 : 45) : 0;
    c.rs += (want - c.rs) * Math.min(1, dt * 0.6); c.spin.visible = c.d < 900;
    if (c.spin.visible) { if (c.T.spinAxis === 'y') c.spin.rotation.y += c.rs * dt; else c.spin.rotation.z += c.rs * dt; }
    if (c.st === 'dock' && c.timer < 9 && c.timer + dt >= 9 && c.d < 260) noise(2.5, 0.05, 260);
  }
}
function onLift(c) {
  if (c.d < 900) { seenFloats++; if (!toastFloat && c.d < 700) { toastFloat = true; ui.toast('🛩️ Floatplane take-off!', `Coal Harbour is one of the busiest seaplane harbours in the world. This one is off to ${c.dest?.id === 'coal' ? 'a scenic tour of the mountains' : c.dest?.name || 'Victoria'}.`, 4000); } if (seenFloats >= 10) discover('planespotter'); }
  if (c.d < 350) noise(3, 0.07, 240);
}
function onTouch(c) {
  if (c.d < 900) { seenFloats++; if (seenFloats >= 10) discover('planespotter'); }
  if (c.d < 2500) for (let i = 0; i < 40; i++) { _k.set(R(-2.5, 2.5), 0.3, R(-1, 3)).multiplyScalar(c.sc).applyQuaternion(c.g.quaternion).add(c.g.position); puff(_k.x, c.h ? c.dest.wl + 0.3 : _k.y, _k.z, R(-6, 6), R(2, 7), R(-6, 6), R(0.9, 1.6), 1.2 * c.sc, 4.5 * c.sc, 0.8, 9.8, 0.6); }
  if (c.d < 300) noise(1.2, 0.08, 900);
}
function floatSpray(c, dt) {
  const n = Math.min(6, Math.floor(c.v * dt * 1.6 + Math.random()));
  _f.set(0, 0, -1).applyQuaternion(c.g.quaternion); _r.set(1, 0, 0).applyQuaternion(c.g.quaternion);
  for (let i = 0; i < n; i++) {
    const s = Math.random() < 0.5 ? -1 : 1; _k.set(s * 1.5, 0.25, R(1.5, 3)).multiplyScalar(c.sc).applyQuaternion(c.g.quaternion).add(c.g.position);
    const out = R(1.5, 4.5) * s, up = R(1.5, 2.5 + c.v * 0.12);
    puff(_k.x, _k.y, _k.z, _r.x * out - _f.x * c.v * 0.25, up, _r.z * out - _f.z * c.v * 0.25, R(0.7, 1.4), 0.8 * c.sc, 3 + c.v * 0.06, 0.65, 9.8, 0.8);
  }
}
function heliWash(c, dt) {
  const p = c.g.position, wl = waterLevel(p.x, p.z), h = p.y - wl;
  if (h > 28 || !isWater(p.x, p.z) || Math.random() > dt * 40) return;
  const a = R(0, TAU), r = R(2, 6);
  puff(p.x + Math.cos(a) * r, wl + 0.4, p.z + Math.sin(a) * r, Math.cos(a) * 10, R(0.5, 2.5), Math.sin(a) * 10, R(1, 1.8), 1.5, 6, 0.5 * (1 - h / 28), 1.5, 0.9);
}
function lightsFor(c) {
  if (!c.g.visible || c.d > 45000) return;
  const n = G.night || 0, pr = renderer.getPixelRatio(), q = c.g.quaternion, p = c.g.position, t = G.t + c.ph;
  for (const [x, y, z, k] of c.T.lights) {
    let size = 0;
    if (k === 'R' || k === 'Gn' || k === 'W') { if (!c.lit || n < 0.12) continue; size = 2 + 4.5 * n; }
    else if (k === 'B') { if (!c.lit || (t % 1.3) > 0.16) continue; size = 3 + 5 * n; }
    else if (k === 'S') { if (!c.lit) continue; const s = t % 1.6; if (!(s < 0.05 || (s > 0.16 && s < 0.21))) continue; size = 4 + 9 * n; }
    else if (k === 'L') { if (!c.land) continue; size = (c.T.kind === 'fixed' && c.T.d0 > 3000 ? 7 : 4) + 11 * n; }
    else if (k === 'F') { if (!c.burning) continue; size = 6 + 14 * n; }
    _k.set(x, y, z).multiplyScalar(c.sc).applyQuaternion(q).add(p);
    addLight(_k, COL[k], size * pr);
  }
}
export function initAirTraffic() {
  scene.add(lPts); scene.add(pPts);
  initHarbours(); initFleet(); initHeliports(); initHelis(); initSpecialBits(); initBanner();
  // a few planes already on their way when you start
  if (runways[1]) for (const f of [0.15, 0.45, 0.75]) yvrArrival(f);
  vfrFlight(0.4);
}
export function updateAirTraffic(dt, pl) {
  PL = pl; if (dt <= 0) return; dt = Math.min(dt, 0.1);
  updateFleet(dt); updateHelis(dt);
  if ((arrT -= dt) < 0) { arrT = R(75, 120); yvrArrival(); }
  if ((cessT -= dt) < 0) { cessT = R(130, 240); vfrFlight(); }
  if ((highT -= dt) < 0) { highT = R(45, 100); if (highN < 3) highJet(Math.random() < 0.5 ? 0 : R(0.2, 0.5)); }
  if ((specialT -= dt) < 0) { specialT = R(100, 220); if (!special && !G.dialogOpen) spawnSpecial(); }
  const day = (G.night || 0) < 0.35, dry = (G.wet || 0) < 0.15 && (G.fogW || 0) < 0.3;
  if ((balloonT -= dt) < 0) { balloonT = R(300, 600); if (!balloon && day && dry && Math.random() < 0.6) spawnBalloon(); }
  if ((biplaneT -= dt) < 0) { biplaneT = R(360, 600); if (!biplane && day && dry) spawnBiplane(); }
  nl = 0;
  for (let i = 0; i < air.length; i++) {
    const c = air[i]; stepCraft(c, dt);
    if (c.remove) { scene.remove(c.g); c.g.visible = false; (pool[c.type] ||= []).push(c); air.splice(i--, 1); continue; }
    lightsFor(c);
  }
  updateBanner();
  // heliport edge lights at night (green ring)
  if ((G.night || 0) > 0.3) { const pr = renderer.getPixelRatio(); for (const v of padLights) if (Math.abs(v.x - camera.position.x) + Math.abs(v.z - camera.position.z) < 4000) addLight(v, COL.Gn, 3.5 * pr); }
  for (const n of ['position', 'aCol', 'aSize']) lGeo.attributes[n].needsUpdate = true; lGeo.setDrawRange(0, nl);
  updatePuffs(dt);
}
export const _air = { air, fleet, helis, HB, pads, spawnSpecial, spawnBalloon, spawnBiplane, yvrArrival, highJet, vfrFlight, get special() { return special; }, get banner() { return banner; }, get np() { return np; }, get nl() { return nl; } };
