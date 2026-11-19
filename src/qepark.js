// Queen Elizabeth Park, on top of Little Mountain (the highest point in Vancouver city):
//  - the Bloedel Conservatory: a triodetic geodesic dome (≈43 m across, 21 m tall, 1,490 plexiglass "bubbles" on an
//    aluminium frame, opened 1969). Walk in through the entrance: tropical plants, a pond and free-flying birds inside,
//    a talking parrot by the door, and the dome glows at night.
//  - the paved plaza around the dome, and the Dancing Waters fountain whose jets dance in changing patterns.
import * as THREE from 'three';
import { G, scene, std, hash2 } from './core.js';
import { groundY, heightAt } from './terrain.js';
import { addFlatSurface } from './city.js';
import { setColliders } from './colliders.js';
import { SPOTS } from './landmarks.js';
import { ui } from './ui.js';

const CX = 452.6, CZ = 4526.3, R = 21.7, H = 21;     // dome (from the OSM footprint; real: 140 ft wide, 70 ft tall)
const FX = 475.1, FZ = 4595.9;                       // Dancing Waters fountain (OSM)
export const QE_FOUNTAIN = { x: FX, z: FZ };         // details.js leaves its generic fountain out here
const gy = (x, z) => { const g = groundY(x, z); return Number.isFinite(g) ? g : heightAt(x, z); };

// ---------- little merge kit (vertex coloured) ----------
function merge(parts) {
  const pos = [], nor = [], col = [], c = new THREE.Color(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), s = new THREE.Vector3();
  for (const p of parts) {
    let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    e.set(p.rx || 0, p.ry || 0, p.rz || 0); q.setFromEuler(e); v.set(p.x || 0, p.y || 0, p.z || 0); s.set(p.sx || 1, p.sy || 1, p.sz || 1); m.compose(v, q, s); g.applyMatrix4(m);
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); c.set(p.c);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}
const VC = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });

// a flat ring/disc laid over the drawn ground (so it never floats or sinks)
function drape(cx, cz, r0, r1, color, lift = 0.07, seg = 64) {
  const geo = new THREE.RingGeometry(r0, r1, seg, 4).rotateX(-Math.PI / 2), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) + cx, z = p.getZ(i) + cz; p.setXYZ(i, x, gy(x, z) + lift, z); }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, std(color, { roughness: 0.9 })); m.receiveShadow = true; scene.add(m); return m;
}

let glass = null, birds = [], jets = null, waterTop = null, parrotT = 0, inside = false, floorY = 0, built = false;
const BIRD_COLS = [['#d62828', '#1d4ed8'], ['#f4c430', '#16a34a'], ['#1d4ed8', '#f4c430'], ['#16a34a', '#d62828'], ['#ffffff', '#f97316'], ['#f97316', '#111827'], ['#e11d48', '#22c55e']];
const _o = new THREE.Object3D();

export function initQEPark() {
  // ground: the dome footprint's highest point = the floor; plinth wall down to the lowest
  let gmin = 1e9, gmax = -1e9; for (let a = 0; a < 6.29; a += 0.2) for (const r of [0, R * 0.5, R]) { const g = gy(CX + Math.cos(a) * r, CZ + Math.sin(a) * r); gmin = Math.min(gmin, g); gmax = Math.max(gmax, g); }
  floorY = gmax + 0.25; const base = floorY;
  const doorA = Math.atan2(FZ - CZ, FX - CX), dX = Math.cos(doorA), dZ = Math.sin(doorA);   // entrance faces the fountain plaza

  // plaza paving around the dome + around the fountain, and the walk between them
  drape(CX, CZ, R + 0.5, R + 9, '#bfb8ab');
  drape(FX, FZ, 0, 15, '#c8c1b4');
  { const L = Math.hypot(FX - CX, FZ - CZ), n = Math.ceil(L / 4), w = 3.2, P = [];
    for (let i = 0; i <= n; i++) { const t = i / n, x = CX + (FX - CX) * t, z = CZ + (FZ - CZ) * t; for (const s of [-1, 1]) { const X = x - dZ * w * s, Z = z + dX * w * s; P.push(X, gy(X, Z) + 0.06, Z); } }
    const idx = []; for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, std('#bfb8ab', { roughness: 0.9, side: THREE.DoubleSide })); m.receiveShadow = true; scene.add(m); }

  const grp = new THREE.Group(); grp.position.set(CX, 0, CZ); scene.add(grp);
  // concrete plinth ring + inside floor
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.4, R + 0.6, base - gmin + 1.4, 48, 1, true), std('#a9a49a', { roughness: 0.85, side: THREE.DoubleSide }));
  plinth.position.y = (base + 0.5 + gmin - 0.9) / 2; grp.add(plinth);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R + 0.2, 48).rotateX(-Math.PI / 2), std('#8c7b66', { roughness: 0.95 })); floor.position.y = base; floor.receiveShadow = true; grp.add(floor);
  { const P = []; for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; P.push(CX + Math.cos(a) * (R + 0.3), CZ + Math.sin(a) * (R + 0.3)); } addFlatSurface(P, base); }

  // the dome: geodesic triangles, each a little plexiglass "bubble" (centre pushed out), on an aluminium frame
  const ico = new THREE.IcosahedronGeometry(R, 5), ip = ico.attributes.position, gp = [], edges = new Map(), sy = H / R;
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), M = new THREE.Vector3();
  for (let i = 0; i < ip.count; i += 3) {
    A.fromBufferAttribute(ip, i); B.fromBufferAttribute(ip, i + 1); C.fromBufferAttribute(ip, i + 2);
    if ((A.y + B.y + C.y) / 3 < -0.3) continue;
    for (const V of [A, B, C]) { V.y = Math.max(0, V.y) * sy; }
    M.copy(A).add(B).add(C).multiplyScalar(1 / 3); const len = M.length(); M.multiplyScalar((len + 0.45) / len);
    for (const [P, Q] of [[A, B], [B, C], [C, A]]) {
      gp.push(P.x, P.y, P.z, Q.x, Q.y, Q.z, M.x, M.y, M.z);
      const k = [P, Q].map(v => v.x.toFixed(1) + ',' + v.y.toFixed(1) + ',' + v.z.toFixed(1)).sort().join('|'); if (!edges.has(k)) edges.set(k, [P.clone(), Q.clone()]);
    }
  }
  const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3)); gg.computeVertexNormals();
  glass = new THREE.MeshStandardMaterial({ color: '#b9d6de', transparent: true, opacity: 0.24, roughness: 0.06, metalness: 0.15, envMapIntensity: 1.6, side: THREE.DoubleSide, depthWrite: false, emissive: '#ffd79a', emissiveIntensity: 0 });
  const dome = new THREE.Mesh(gg, glass); dome.position.y = base + 0.4; dome.renderOrder = 2; grp.add(dome);
  const struts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.07, 1, 5).rotateX(Math.PI / 2).translate(0, 0, 0.5), std('#c9ced3', { metalness: 0.8, roughness: 0.35 }), edges.size);
  let si = 0; for (const [P, Q] of edges.values()) { _o.position.set(P.x, P.y + base + 0.4, P.z); _o.lookAt(Q.x + 0, Q.y + base + 0.4, Q.z); _o.scale.set(1, 1, P.distanceTo(Q)); _o.updateMatrix(); struts.setMatrixAt(si++, _o.matrix); }
  struts.castShadow = true; grp.add(struts);
  // base ring + entrance vestibule (dark glass doors) facing the plaza
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.25, 6, 64).rotateX(Math.PI / 2), std('#8a9096', { metalness: 0.7 })); ring.position.y = base + 0.45; grp.add(ring);
  const vest = new THREE.Group(); vest.position.set(dX * (R + 1.2), base, dZ * (R + 1.2)); vest.rotation.y = Math.atan2(dX, dZ); grp.add(vest);
  vest.add(new THREE.Mesh(merge([{ geo: new THREE.BoxGeometry(5.6, 0.35, 5), c: '#9aa0a6', y: 3.3 }, { geo: new THREE.BoxGeometry(0.35, 3.3, 5), c: '#9aa0a6', x: -2.6, y: 1.65 }, { geo: new THREE.BoxGeometry(0.35, 3.3, 5), c: '#9aa0a6', x: 2.6, y: 1.65 }]), VC));
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.6), new THREE.MeshBasicMaterial({ map: signTex() })); sign.position.set(0, 3.0, 2.52); vest.add(sign);
  // inside: tropical garden, a pond with a little bridge, birds
  const P = [], rnd = (k) => hash2(CX * 0.37 + k * 1.7, CZ * 0.11 + k * 3.1);
  P.push({ geo: new THREE.CylinderGeometry(5, 5, 0.3, 28), c: '#2f5d6e', x: -4, y: 0.05, z: -3 }, { geo: new THREE.TorusGeometry(5, 0.45, 6, 28).rotateX(Math.PI / 2), c: '#7b6f5f', x: -4, y: 0.2, z: -3 });
  P.push({ geo: new THREE.BoxGeometry(1.6, 0.25, 11), c: '#6b4a2e', x: -4, y: 0.55, z: -3, ry: 0.5 });
  for (let i = 0; i < 70; i++) {
    const a = rnd(i) * Math.PI * 2, r = 4 + rnd(i + 100) * (R - 6), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.hypot(x + 4, z + 3) < 6 || Math.abs(Math.atan2(Math.sin(a - doorA), Math.cos(a - doorA))) < 0.25) continue;   // keep the pond and the entrance path clear
    const k = rnd(i + 200), hMax = Math.max(2, H * Math.sqrt(1 - (r / R) ** 2) - 3);
    if (k < 0.3) {   // palm
      const h = Math.min(hMax, 6 + rnd(i + 300) * 9);
      P.push({ geo: new THREE.CylinderGeometry(0.18, 0.3, h, 6), c: '#7a6247', x, y: h / 2, z, rz: (rnd(i + 5) - 0.5) * 0.2 });
      for (let f = 0; f < 7; f++) { const fa = f / 7 * Math.PI * 2; P.push({ geo: new THREE.ConeGeometry(0.5, 3.4, 4).rotateX(Math.PI / 2), c: '#2f7d32', x: x + Math.cos(fa) * 1.4, y: h - 0.3, z: z + Math.sin(fa) * 1.4, ry: -fa + Math.PI / 2, rx: 0.5, sy: 0.25 }); }
    } else if (k < 0.75) {   // big-leaved bush
      const s = 0.8 + rnd(i + 400) * 1.6; P.push({ geo: new THREE.IcosahedronGeometry(s, 1), c: ['#2e7d32', '#1b5e20', '#388e3c', '#4a7c2a', '#0f5132'][i % 5], x, y: s * 0.7, z, sy: 0.8 });
    } else {   // flowers: heliconia red, orchid pink, bird of paradise orange
      const c = ['#e53935', '#ec407a', '#fb8c00', '#fdd835', '#ab47bc'][i % 5];
      for (let f = 0; f < 5; f++) P.push({ geo: new THREE.IcosahedronGeometry(0.28, 0), c, x: x + (rnd(i * 7 + f) - 0.5) * 1.6, y: 0.5 + rnd(i * 3 + f) * 0.8, z: z + (rnd(i * 5 + f) - 0.5) * 1.6 });
      P.push({ geo: new THREE.IcosahedronGeometry(0.9, 0), c: '#2e7d32', x, y: 0.5, z, sy: 0.6 });
    }
  }
  const garden = new THREE.Mesh(merge(P), VC); garden.position.y = base; garden.castShadow = true; grp.add(garden);
  // birds: body + two flapping wings each
  const bodyG = new THREE.SphereGeometry(0.18, 8, 6).scale(1, 0.8, 1.8), wingG = new THREE.PlaneGeometry(0.5, 0.22).translate(0.25, 0, 0);
  for (let i = 0; i < 16; i++) {
    const [c1, c2] = BIRD_COLS[i % BIRD_COLS.length], b = new THREE.Group();
    b.add(new THREE.Mesh(bodyG, std(c1)));
    const wm = std(c2, { side: THREE.DoubleSide }), w1 = new THREE.Mesh(wingG, wm), w2 = new THREE.Mesh(wingG, wm); w2.rotation.y = Math.PI; b.add(w1, w2);
    b.userData = { w1, w2, ph: i * 1.7, r: 4 + (i % 5) * 2.6, sp: 0.35 + (i % 4) * 0.12, dir: i % 2 ? 1 : -1, hy: 3 + (i % 6) * 1.6 };
    grp.add(b); birds.push(b);
  }
  // round wall colliders with a gap at the door
  const cl = []; for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2; if (Math.abs(Math.atan2(Math.sin(a - doorA), Math.cos(a - doorA))) < 0.09) continue; cl.push({ x: CX + Math.cos(a) * R, z: CZ + Math.sin(a) * R, r: 1.0, top: base + 6 }); }
  setColliders('bloedel', cl);

  // Dancing Waters: a round pool, a ring of jets around a tall centre jet
  const fy = gy(FX, FZ);
  const pool = new THREE.Group(); pool.position.set(FX, fy, FZ); scene.add(pool);
  pool.add(new THREE.Mesh(new THREE.TorusGeometry(9, 0.45, 8, 48).rotateX(Math.PI / 2), std('#a9a49a', { roughness: 0.85 })));
  pool.children[0].position.y = 0.35;
  waterTop = new THREE.Mesh(new THREE.CircleGeometry(8.8, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#3e7f95', roughness: 0.08, metalness: 0.2, envMapIntensity: 1.4 }));
  waterTop.position.y = 0.45; pool.add(waterTop);
  jets = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.09, 1, 10, 1, true).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: '#eef9fc', transparent: true, opacity: 0.5, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide, emissive: '#bfe6f2', emissiveIntensity: 0.15 }), 25);
  jets.position.y = 0.45; jets.frustumCulled = false; pool.add(jets);

  SPOTS.bloedel = { id: 'bloedel', name: 'Bloedel Conservatory', x: CX, z: CZ, y: base };
  built = true;
}
function signTex() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 64; const x = c.getContext('2d');
  x.fillStyle = '#1f2a2e'; x.fillRect(0, 0, 512, 64); x.fillStyle = '#e8e2cf'; x.font = 'bold 30px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('BLOEDEL CONSERVATORY', 256, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const PARROT = ['🦜 "Hello! Hello!"', '🦜 "Pretty bird! Pretty bird!"', '🦜 "Got any crackers?"', '🦜 "Go Canucks go!"', '🦜 *does a perfect SkyTrain door chime*', '🦜 "Welcome to the jungle!"'];
export function updateQEPark(dt, pl) {
  if (!built) return;
  const d = Math.hypot(pl.x - CX, pl.z - CZ); if (d > 600) return;
  const t = G.t;
  glass.emissiveIntensity = 0.45 * (G.night || 0);
  // birds circle and swoop inside the dome
  for (const b of birds) {
    const u = b.userData, a = t * u.sp * u.dir + u.ph, r = u.r + Math.sin(t * 0.3 + u.ph) * 1.5;
    b.position.set(Math.cos(a) * r, floorY + u.hy + Math.sin(t * 0.8 + u.ph) * 1.2, Math.sin(a) * r);
    b.rotation.set(0, Math.atan2(-Math.sin(a) * u.dir, Math.cos(a) * u.dir), 0);
    const f = Math.sin(t * 16 + u.ph) * 0.9; u.w1.rotation.z = f; u.w2.rotation.z = -f;
  }
  // fountain: a new pattern every 7 seconds (wave, pulse, alternate, spiral)
  if (d < 400) {
    const mode = Math.floor(t / 7) % 4;
    for (let i = 0; i < 25; i++) {
      let h;
      if (i === 24) h = 4 + Math.sin(t * 1.3) * 2.5 + (mode === 1 ? 3 : 0);
      else { const a = i / 24 * Math.PI * 2, x = Math.cos(a) * 6.5, z = Math.sin(a) * 6.5;
        h = mode === 0 ? 1.6 + 1.4 * Math.sin(t * 3 - i * 0.52) : mode === 1 ? 2 + 1.8 * Math.max(0, Math.sin(t * 2)) : mode === 2 ? ((i + Math.floor(t * 1.5)) % 2 ? 3.2 : 0.5) : 0.6 + 2.6 * ((i / 24 + t * 0.4) % 1);
        _o.position.set(x, 0, z); }
      if (i === 24) _o.position.set(0, 0, 0);
      _o.rotation.set(0, 0, 0); const w = h < 0.45 ? 0 : i === 24 ? 1.6 : 1; _o.scale.set(w, Math.max(0.01, h), w); _o.updateMatrix(); jets.setMatrixAt(i, _o.matrix);
    }
    jets.instanceMatrix.needsUpdate = true;
  }
  // inside: welcome + the talking parrot by the door
  const nowIn = d < R - 1 && Math.abs(pl.y - floorY) < 4;
  if (nowIn && !inside) ui.toast('🌴 Bloedel Conservatory', '26 °C and humid in here! Over 500 tropical plants and 100+ free-flying birds under 1,490 plexiglass bubbles.', 4000);
  inside = nowIn; parrotT -= dt;
  if (nowIn && parrotT < 0 && Math.random() < dt * 0.2) { parrotT = 12; ui.toast(PARROT[Math.floor(Math.random() * PARROT.length)], '', 2500); }
}
export const _qe = { get floorY() { return floorY; }, CX, CZ, R };
