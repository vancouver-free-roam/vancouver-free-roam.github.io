// Modelling kit for public art (artworks.js, artfamous.js, landmarks.js): a little scene-graph of parts that is baked into
// ONE merged, vertex-coloured mesh per material (bronze, steel, stone, paint, wood, gold, corten, glow), so a whole statue
// group costs 1-3 draw calls.
//  - person(): a jointed human figure (hips/knees/shoulders/elbows/neck) with real proportions, poses (stand, walk, run,
//    sprint, sit, think, point, wave, welcome, armsUp, crouch, kneel, sitGround…), clothes (coat, dress, suit, shorts,
//    wetsuit), hats (top, bowler, cap, crown, helmet), hair styles, beards
//  - beast(): four-legged animals (horse, bull, bear, lion, camel, dog, poodle, coyote, deer…) standing or lying
//  - bird(): perched or flying birds (sparrow, raven, eagle, heron, owl, gull)
//  - orca(): a killer whale body with dorsal fin, flukes and white patches
//  - pole(): Northwest Coast totem poles / house posts / welcome figures built from carved crest figures
//    (eagle, raven, thunderbird, bear, wolf, whale, frog, beaver, human, watchman, moon)
import * as THREE from 'three';

export const MATS = {
  stone: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 }),
  bronze: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.72 }),
  steel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.14, metalness: 0.95, envMapIntensity: 1.4 }),
  paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15 }),
  wood: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
  gold: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 1, envMapIntensity: 1.3 }),
  corten: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.25 }),
  glow: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, emissive: '#ffffff', emissiveIntensity: 0.25 }),
  glass: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.55, depthWrite: false }),
};
for (const k in MATS) MATS[k].customProgramCacheKey = () => 'art-' + k;
export const C = { BRONZE: '#6a4e30', DARKBRONZE: '#4a3826', VERD: '#4f7a6a', STEEL: '#c9ced3', STONE: '#a29d93', GRANITE: '#6f6b66', PINKGRANITE: '#b08a80', CEDAR: '#8a6446', OLDCEDAR: '#5e4636', BLACK: '#1b1c1e', WHITE: '#ece8de', RED: '#9b2d20', TEAL: '#2f7d78', GOLD: '#d4af37', CORTEN: '#8a4524', CONCRETE: '#b3aea5', MARBLE: '#e4e0d8' };

// ---------- cached unit geometries (scaled per part) ----------
const GC = new Map();
const cached = (key, f) => { let g = GC.get(key); if (!g) { g = f(); if (g.index) g = g.toNonIndexed(); GC.set(key, g); } return g; };
export const U = {
  box: () => cached('box', () => new THREE.BoxGeometry(1, 1, 1)),
  sph: (s = 14) => cached('sph' + s, () => new THREE.SphereGeometry(1, s, Math.max(6, s * 0.7 | 0))),
  cyl: (s = 12, t = 1) => cached('cyl' + s + '|' + t, () => new THREE.CylinderGeometry(t, 1, 1, s)),   // top radius t, bottom 1, height 1 (centred)
  cone: (s = 12) => cached('cone' + s, () => new THREE.ConeGeometry(1, 1, s)),
  tor: (t = 0.1, arc = 6.2832, s = 40) => cached('tor' + t + '|' + arc.toFixed(3) + '|' + s, () => new THREE.TorusGeometry(1, t, 8, s, arc)),
  oct: () => cached('oct', () => new THREE.OctahedronGeometry(1, 0)),
  ico: (d = 1) => cached('ico' + d, () => new THREE.IcosahedronGeometry(1, d)),
  hemi: (s = 14) => cached('hemi' + s, () => new THREE.SphereGeometry(1, s, 8, 0, Math.PI * 2, 0, Math.PI / 2)),
};

// ---------- the kit: nodes + parts, baked into merged meshes ----------
export function Kit() {
  const root = new THREE.Object3D(), parts = [];
  const k = {
    root, parts,
    node(parent = root, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, order) { const o = new THREE.Object3D(); o.position.set(x, y, z); if (order) o.rotation.order = order; o.rotation.set(rx, ry, rz); o.scale.setScalar(s); parent.add(o); return o; },
    add(parent, geo, c, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
      const o = new THREE.Object3D(); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.scale.set(sx, sy, sz); (parent || root).add(o); parts.push({ o, geo, c, m: m || 'stone' }); return o; },
    // shorthands (sizes are FULL widths/heights like BoxGeometry)
    box(p, w, h, d, c, m, x, y, z, rx, ry, rz) { return k.add(p, U.box(), c, m, x, y, z, rx, ry, rz, w, h, d); },
    sph(p, r, c, m, x, y, z, sx = 1, sy = 1, sz = 1, seg = 14) { return k.add(p, U.sph(seg), c, m, x, y, z, 0, 0, 0, r * sx, r * sy, r * sz); },
    cyl(p, r1, r2, h, c, m, x, y, z, rx, ry, rz, seg = 12) { const t = r2 > 0 ? Math.round(r1 / r2 * 20) / 20 : 0; return k.add(p, U.cyl(seg, t), c, m, x, y, z, rx, ry, rz, r2 || r1, h, r2 || r1); },   // r1 = top, r2 = bottom
    cone(p, r, h, c, m, x, y, z, rx, ry, rz, seg = 12) { return k.add(p, U.cone(seg), c, m, x, y, z, rx, ry, rz, r, h, r); },
    tor(p, R, t, c, m, x, y, z, rx, ry, rz, arc) { return k.add(p, U.tor(Math.round(t / R * 100) / 100, arc), c, m, x, y, z, rx, ry, rz, R, R, R); },
    geo(p, geo, c, m, x, y, z, rx, ry, rz, sx = 1, sy = sx, sz = sx) { return k.add(p, geo.index ? geo.toNonIndexed() : geo, c, m, x, y, z, rx, ry, rz, sx, sy, sz); },
    // a limb hanging DOWN from the node origin: length L, radius r0 at the top, r1 at the bottom
    limb(p, L, r0, r1, c, m, seg = 8) { return k.cyl(p, r0, r1, L, c, m, 0, -L / 2, 0, 0, 0, 0, seg); },
    // a tube along points [[x,y,z]...]
    tube(p, pts, r, c, m, seg = 24, rs = 8) { const cv = new THREE.CatmullRomCurve3(pts.map(q => new THREE.Vector3(...q))); return k.geo(p, new THREE.TubeGeometry(cv, seg, r, rs, false), c, m); },
    // a lathe (profile [[r, y]...] bottom → top)
    lathe(p, prof, c, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, seg = 16) { return k.geo(p, new THREE.LatheGeometry(prof.map(([r, yy]) => new THREE.Vector2(Math.max(0.001, r), yy)), seg), c, m, x, y, z, rx, ry, rz, sx, sy, sz); },
    // an extruded flat shape (outline [[x,y]...] in the XY plane, depth along z, centred)
    shape(p, pts, depth, c, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, bevel = 0) {
      const sh = new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b)));
      const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 8 }); g.translate(0, 0, -depth / 2);
      return k.geo(p, g, c, m, x, y, z, rx, ry, rz, s, s, s);
    },
    build() {
      root.updateMatrixWorld(true);
      const by = new Map(), col = new THREE.Color(), nm = new THREE.Matrix3();
      for (const q of parts) { let L = by.get(q.m); if (!L) by.set(q.m, L = []); L.push(q); }
      const g = new THREE.Group();
      for (const [m, L] of by) {
        let n = 0; for (const q of L) n += q.geo.attributes.position.count;
        const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), cl = new Float32Array(n * 3), v = new THREE.Vector3();
        let o = 0;
        for (const q of L) {
          const P = q.geo.attributes.position, N = q.geo.attributes.normal, M = q.o.matrixWorld; nm.getNormalMatrix(M); col.set(q.c);
          const det = M.determinant();
          for (let i = 0; i < P.count; i++) {
            const ii = det < 0 ? (i - i % 3) + 2 - i % 3 : i;   // mirrored parts: flip the winding
            v.fromBufferAttribute(P, ii).applyMatrix4(M); pos[o * 3] = v.x; pos[o * 3 + 1] = v.y; pos[o * 3 + 2] = v.z;
            v.fromBufferAttribute(N, ii).applyMatrix3(nm).normalize(); nor[o * 3] = v.x; nor[o * 3 + 1] = v.y; nor[o * 3 + 2] = v.z;
            cl[o * 3] = col.r; cl[o * 3 + 1] = col.g; cl[o * 3 + 2] = col.b; o++;
          }
        }
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('color', new THREE.BufferAttribute(cl, 3));
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, MATS[m] || MATS.stone); mesh.castShadow = m !== 'glass' && m !== 'glow'; mesh.receiveShadow = true; g.add(mesh);
      }
      return g;
    },
  };
  return k;
}

// ---------- human figures ----------
// facing +z, feet at y 0. o: { h, c (one colour = cast), skin, top, bottom, hair, shoe, m, pose, coat, dress, suit, shorts,
// hat: 'top'|'bowler'|'cap'|'crown'|'helmet'|'beanie', hairStyle: 'short'|'long'|'bun'|'bald'|'curly', beard, girth, headless, cape }
export const POSES = {
  stand: {}, attention: { shL: 0.05, shR: 0.05 },
  walk: { hipL: 0.38, hipR: -0.3, kneeR: 0.25, shL: -0.35, shR: 0.35, elL: 0.25, elR: 0.35 },
  run: { hipL: 0.95, kneeL: 0.55, hipR: -0.45, kneeR: 1.35, lean: 0.22, shR: 0.95, elR: 1.45, shL: -0.75, elL: 1.2, headP: -0.1 },
  sprint: { hipL: 1.25, kneeL: 0.6, hipR: -0.6, kneeR: 1.1, lean: 0.38, shR: 1.3, elR: 1.3, shL: -1.0, elL: 0.9, headP: -0.25 },
  sit: { seat: 0.5, hipL: 1.5, hipR: 1.45, kneeL: 1.45, kneeR: 1.5, shL: 0.35, shR: 0.35, elL: 0.75, elR: 0.75 },
  sitGround: { seat: 0.1, hipL: 1.0, hipR: 0.95, kneeL: 2.1, kneeR: 2.05, shL: 0.55, shR: 0.55, elL: 0.3, elR: 0.3, lean: 0.1 },
  sitTucked: { seat: 0.12, hipL: 1.2, hipR: 0.3, kneeL: 2.3, kneeR: 2.5, hipLz: 0.5, hipRz: 0.9, shL: 0.3, elL: 0.6, shR: 0.1, armRz: -0.35, lean: 0.12, headYaw: 0.5 },
  think: { seat: 0.5, hipL: 1.45, hipR: 1.5, kneeL: 1.5, kneeR: 1.45, lean: 0.55, shR: 0.75, elR: 2.45, shL: 0.6, elL: 0.9, headP: 0.35 },
  point: { shR: 2.4, armRz: -0.2, elR: 0, shL: 0.1, hipL: 0.15, headP: -0.15 },
  wave: { armRz: -2.55, elR: 0.5, shR: 0.2 },
  welcome: { armLz: 1.25, armRz: -1.25, shL: 0.35, shR: 0.35, elL: 0.2, elR: 0.2, headP: -0.1 },
  armsUp: { armLz: 2.5, armRz: -2.5, shL: 0.2, shR: 0.2, elL: 0.2, elR: 0.2, headP: -0.35, lean: -0.08 },
  torch: { shL: 2.9, shR: 2.9, elL: 0.35, elR: 0.35, armLz: 0.35, armRz: -0.35, headP: -0.2 },
  crouch: { seat: 0.55, hipL: 1.1, kneeL: 1.9, hipR: 0.4, kneeR: 2.2, lean: 0.3, shL: 1.25, elL: 1.35, shR: 1.25, elR: 1.35, kneelR: true },
  kneel: { seat: 0.62, hipL: 1.45, kneeL: 1.5, hipR: -0.05, kneeR: 1.6, kneelR: true, shL: 0.4, shR: 0.4, elL: 0.6, elR: 0.6, lean: 0.1 },
  handsFront: { shL: 0.55, shR: 0.55, elL: 1.0, elR: 1.0, armLz: -0.12, armRz: 0.12 },
  oneHandFront: { shR: 0.8, elR: 0.9, shL: 0.05 },
  stride: { hipL: 0.45, kneeL: 0.1, hipR: -0.35, kneeR: 0.25, shR: 0.5, elR: 0.4, shL: -0.2 },
  lookUp: { headP: -0.5, lean: -0.1 },
  bow: { lean: 0.6, headP: 0.2, shL: 0.6, shR: 0.6 },
};
export function person(k, parent, o = {}) {
  const P = Object.assign({}, POSES[o.pose] || POSES.stand, o.poseX || {});
  const s = (o.h || 1.78) / 1.78, g = o.girth || 1, m = o.m || 'bronze', one = o.c;
  const skin = one || o.skin || '#c69c7b', top = one || o.top || '#3a4a5c', bot = one || o.bottom || '#2e3540', hairC = one || o.hair || '#3a2a1c', shoe = one || o.shoe || '#222';
  const fig = k.node(parent, o.x || 0, o.y || 0, o.z || 0, 0, o.ry || 0, 0, s);
  const legLen = 0.46 + 0.44;
  // hip height: seated poses give it, standing ones come from the legs
  let hipY = P.seat != null ? P.seat + 0.06 : Math.max(Math.cos(P.hipL || 0) * 0.46 + Math.cos((P.hipL || 0) - (P.kneeL || 0)) * 0.44, Math.cos(P.hipR || 0) * 0.46 + Math.cos((P.hipR || 0) - (P.kneeR || 0)) * 0.44) + 0.07;
  if (P.seat == null) hipY = Math.min(hipY, legLen + 0.07);
  const hips = k.node(fig, 0, hipY, 0);
  const isDress = !!o.dress, isShorts = !!o.shorts;
  k.sph(hips, 0.17 * g, bot, m, 0, 0.02, 0, 1.18, 0.66, 0.85);
  for (const side of [1, -1]) {   // +x = the figure's LEFT
    const L = side > 0 ? 'L' : 'R', hip = k.node(hips, side * 0.095 * g, -0.02, 0, -(P['hip' + L] || 0), 0, side * (P['hip' + L + 'z'] || 0) * 0.5, 1, 'XZY');
    k.limb(hip, 0.46, 0.118 * g, 0.078 * g, isShorts ? bot : bot, m, 8);
    const knee = k.node(hip, 0, -0.46, 0, P['knee' + L] || 0, 0, 0);
    k.sph(knee, 0.078 * g, isShorts ? skin : bot, m, 0, 0, 0, 1, 1, 1, 8);
    k.limb(knee, 0.43, 0.075 * g, 0.048, isShorts ? skin : bot, m, 8);
    const ank = k.node(knee, 0, -0.43, 0, -(P['knee' + L] || 0) + (P['hip' + L] || 0) - (P.seat != null ? 0 : 0), 0, 0);
    if (!o.flippers) k.box(ank, 0.09, 0.07, 0.25, shoe, m, 0, -0.035, 0.06);
    else k.add(ank, U.box(), shoe, m, 0, -0.03, 0.22, 0.1, 0, 0, 0.2, 0.025, 0.55);   // swim fins
  }
  // torso
  const torso = k.node(hips, 0, 0.02, 0, P.lean || 0, P.twist || 0, P.tilt || 0);
  k.lathe(torso, [[0.14, 0], [0.135, 0.12], [0.15, 0.26], [0.17, 0.38], [0.165, 0.47], [0.1, 0.53], [0.05, 0.56]], top, m, 0, 0, 0, 0, 0, 0, 1.3 * g, 1, 0.82 * g, 12);
  if (o.breasts) for (const sd of [1, -1]) k.sph(torso, 0.065, top, m, sd * 0.07, 0.36, 0.085, 1, 0.9, 0.8, 8);
  if (o.suit || o.coat) { k.box(torso, 0.06, 0.32, 0.02, o.shirt || (one || '#e8e4da'), m, 0, 0.36, 0.115); }
  if (o.coat || isDress) {   // a long coat / dress hanging from the waist (stays with the hips when sitting)
    const len = isDress ? (P.seat != null ? 0.55 : hipY - 0.08) : 0.5, r1 = isDress ? 0.3 : 0.24;
    const skirt = k.node(hips, 0, 0.12, P.seat != null ? 0.12 : 0, P.seat != null ? -1.25 : 0, 0, 0);
    k.lathe(skirt, [[r1 * g, -len], [0.2 * g, -len * 0.5], [0.16 * g, 0]], isDress ? (o.skirt || top) : top, m, 0, 0, 0, 0, 0, 0, 1.15, 1, 0.85, 12);
  }
  if (o.cape) k.add(torso, U.box(), o.cape, m, 0, 0.1, -0.16, -0.08, 0, 0, 0.5, 0.95, 0.04);
  // neck + head
  k.cyl(torso, 0.05, 0.06, 0.12, skin, m, 0, 0.6, 0.01);
  if (!o.headless) {
    const head = k.node(torso, 0, 0.66, 0.015, P.headP || 0, P.headYaw || 0, 0);
    k.sph(head, 0.115, skin, m, 0, 0.1, 0, 0.92, 1.12, 1.02, 14);
    k.sph(head, 0.045, skin, m, 0, 0.03, 0.06, 1.25, 0.7, 1, 8);          // jaw
    k.cone(head, 0.022, 0.06, skin, m, 0, 0.1, 0.105, 1.35, 0, 0, 6);       // nose
    for (const sd of [1, -1]) k.sph(head, 0.022, skin, m, sd * 0.098, 0.1, 0, 0.5, 1, 0.8, 6);   // ears
    if (o.eyes) for (const sd of [1, -1]) k.sph(head, 0.013, o.eyes, m, sd * 0.036, 0.125, 0.088, 1, 1, 0.6, 6);
    const hs = o.hairStyle || 'short';
    if (hs !== 'bald') k.sph(head, 0.12, hairC, m, 0, 0.13, -0.012, 0.95, 0.92, 1.02, 12);
    if (hs === 'long') k.add(head, U.box(), hairC, m, 0, 0.0, -0.06, -0.1, 0, 0, 0.2, 0.32, 0.08);
    if (hs === 'bun') k.sph(head, 0.05, hairC, m, 0, 0.2, -0.08);
    if (hs === 'curly') k.sph(head, 0.13, hairC, m, 0, 0.14, -0.02, 1, 0.9, 1, 10);
    if (o.beard) k.sph(head, 0.075, o.beardC || hairC, m, 0, 0.02, 0.05, 1.05, 1.1, 0.85, 8);
    if (o.moustache) k.box(head, 0.07, 0.015, 0.02, hairC, m, 0, 0.055, 0.1);
    const hat = o.hat;
    if (hat === 'top') { k.cyl(head, 0.1, 0.1, 0.2, o.hatC || one || '#1b1b1b', m, 0, 0.28, 0); k.cyl(head, 0.16, 0.16, 0.015, o.hatC || one || '#1b1b1b', m, 0, 0.18, 0, 0, 0, 0, 16); }
    if (hat === 'bowler') { k.add(head, U.hemi(12), o.hatC || one || '#1b1b1b', m, 0, 0.17, 0, 0, 0, 0, 0.115, 0.12, 0.12); k.cyl(head, 0.155, 0.155, 0.015, o.hatC || one || '#1b1b1b', m, 0, 0.175, 0, 0, 0, 0, 16); }
    if (hat === 'cap') { k.add(head, U.hemi(12), o.hatC || one || '#2a4a8a', m, 0, 0.16, 0, 0, 0, 0, 0.112, 0.08, 0.115); k.box(head, 0.15, 0.012, 0.1, o.hatC || one || '#2a4a8a', m, 0, 0.165, 0.1); }
    if (hat === 'beanie') k.add(head, U.hemi(12), o.hatC || one || '#a03030', m, 0, 0.15, 0, 0, 0, 0, 0.115, 0.12, 0.118);
    if (hat === 'helmet') { k.add(head, U.hemi(12), o.hatC || one || '#d8c020', m, 0, 0.15, 0, 0, 0, 0, 0.13, 0.13, 0.15); k.box(head, 0.3, 0.012, 0.36, o.hatC || one || '#d8c020', m, 0, 0.155, -0.02); }
    if (hat === 'crown') { k.cyl(head, 0.1, 0.095, 0.09, o.hatC || one || C.GOLD, m, 0, 0.24, 0, 0, 0, 0, 10); for (let i = 0; i < 6; i++) k.cone(head, 0.02, 0.06, o.hatC || one || C.GOLD, m, Math.sin(i) * 0.09, 0.31, Math.cos(i) * 0.09); }
    if (hat === 'mask') k.box(head, 0.17, 0.07, 0.05, o.hatC || one || '#222', m, 0, 0.2, 0.06, -0.4, 0, 0);   // diving mask pushed up
    if (o.glasses) k.box(head, 0.15, 0.03, 0.02, '#111', m, 0, 0.12, 0.1);
  }
  // arms (+x = left)
  const hands = {};
  for (const side of [1, -1]) {
    const L = side > 0 ? 'L' : 'R';
    const sh = k.node(torso, side * 0.19 * g, 0.48, 0, -(P['sh' + L] || 0), 0, (P['arm' + L + 'z'] || 0) + side * 0.06, 1, 'ZXY');
    k.sph(sh, 0.085 * g, top, m, 0, 0, 0, 1, 1, 1, 8);
    k.limb(sh, 0.3, 0.075 * g, 0.058 * g, o.sleeveless ? skin : top, m, 8);
    const el = k.node(sh, 0, -0.3, 0, -(P['el' + L] || 0), 0, 0);
    k.limb(el, 0.26, 0.058 * g, 0.042, o.sleeves === 'short' || o.sleeveless ? skin : top, m, 8);
    const hand = k.node(el, 0, -0.28, 0); k.sph(hand, 0.052, skin, m, 0, -0.02, 0, 0.7, 1.1, 0.95, 8);
    hands[L] = hand;
  }
  return { fig, hips, torso, hands, s };
}

// a bust: head + shoulders on a short base
export function bust(k, parent, o = {}) {
  const b = k.node(parent, o.x || 0, o.y || 0, o.z || 0, 0, o.ry || 0, 0, o.s || 1), c = o.c || C.BRONZE, m = o.m || 'bronze';
  k.lathe(b, [[0.26, 0], [0.3, 0.12], [0.28, 0.3], [0.12, 0.42], [0.07, 0.48]], c, m, 0, 0, 0, 0, 0, 0, 1.25, 1, 0.65, 14);
  k.cyl(b, 0.065, 0.075, 0.14, c, m, 0, 0.5, 0.01);
  k.sph(b, 0.12, c, m, 0, 0.66, 0.01, 0.9, 1.12, 1.02);
  k.sph(b, 0.05, c, m, 0, 0.59, 0.06, 1.25, 0.7, 1);
  k.cone(b, 0.024, 0.065, c, m, 0, 0.66, 0.115, 1.35, 0, 0, 6);
  if (o.hair !== false) k.sph(b, 0.125, c, m, 0, 0.7, -0.014, 0.95, 0.9, 1.02, 12);
  if (o.beard) k.sph(b, 0.085, c, m, 0, 0.58, 0.05, 1.05, 1.1, 0.85, 8);
  if (o.moustache) k.box(b, 0.08, 0.016, 0.02, c, m, 0, 0.615, 0.11);
  return b;
}

// ---------- four-legged animals ----------
// o: { kind, L (body length), H (shoulder height), c, m, pose: 'stand'|'walk'|'lie'|'sit'|'rear', headUp, x, z, ry }
const BEASTS = {
  horse: { L: 1.7, H: 1.55, g: 0.62, neck: 0.75, nA: 0.75, head: [0.26, 0.6], tail: 'long', hoof: 1, ears: 'point', mane: 1 },
  foal: { L: 1.0, H: 1.05, g: 0.38, neck: 0.5, nA: 0.8, head: [0.18, 0.42], tail: 'long', hoof: 1, ears: 'point', mane: 1 },
  bull: { L: 1.9, H: 1.45, g: 0.85, neck: 0.35, nA: 0.25, head: [0.3, 0.5], tail: 'thin', hoof: 1, ears: 'side', horns: 'bull', hump: 0.15 },
  cow: { L: 1.8, H: 1.35, g: 0.75, neck: 0.4, nA: 0.3, head: [0.26, 0.5], tail: 'thin', hoof: 1, ears: 'side', horns: 'small' },
  camel: { L: 1.6, H: 1.9, g: 0.6, neck: 0.95, nA: 0.35, head: [0.2, 0.5], tail: 'thin', hoof: 1, ears: 'small', hump: 0.4, longLeg: 1 },
  bear: { L: 1.5, H: 1.0, g: 0.85, neck: 0.3, nA: 0.25, head: [0.3, 0.42], tail: 'stub', ears: 'round', paws: 1 },
  grizzly: { L: 1.9, H: 1.25, g: 1.0, neck: 0.3, nA: 0.2, head: [0.36, 0.48], tail: 'stub', ears: 'round', paws: 1, hump: 0.2 },
  lion: { L: 1.6, H: 1.0, g: 0.62, neck: 0.3, nA: 0.5, head: [0.3, 0.42], tail: 'tuft', ears: 'round', paws: 1, maneBig: 1 },
  dog: { L: 0.8, H: 0.6, g: 0.32, neck: 0.25, nA: 0.7, head: [0.14, 0.3], tail: 'up', ears: 'flop', paws: 1 },
  coyote: { L: 0.9, H: 0.62, g: 0.3, neck: 0.25, nA: 0.55, head: [0.13, 0.32], tail: 'bushy', ears: 'point', paws: 1 },
  deer: { L: 1.2, H: 1.05, g: 0.42, neck: 0.5, nA: 0.9, head: [0.15, 0.35], tail: 'stub', hoof: 1, ears: 'big', antlers: 1 },
  poodle: { L: 0.7, H: 0.62, g: 0.3, neck: 0.3, nA: 1.1, head: [0.14, 0.26], tail: 'pom', ears: 'flop', paws: 1, poodle: 1 },
  goat: { L: 1.1, H: 0.9, g: 0.42, neck: 0.35, nA: 0.8, head: [0.15, 0.32], tail: 'stub', hoof: 1, ears: 'point', horns: 'goat', beard: 1 },
};
export function beast(k, parent, o = {}) {
  const B = BEASTS[o.kind] || BEASTS.dog, sc = o.s || 1, c = o.c || C.BRONZE, m = o.m || 'bronze', pose = o.pose || 'stand';
  const root = k.node(parent, o.x || 0, o.y || 0, o.z || 0, 0, o.ry || 0, 0, sc);
  const L = B.L, g = B.g, lie = pose === 'lie', sit = pose === 'sit', rear = pose === 'rear';
  const legH = (B.longLeg ? B.H * 0.72 : B.H - g * 0.55);
  const bodyY = lie ? g * 0.48 : B.H - g * 0.3;
  const body = k.node(root, 0, bodyY, 0, sit ? -0.55 : rear ? -0.9 : 0, 0, 0);
  k.sph(body, 1, c, m, 0, 0, 0, g * 0.5, g * 0.52, L * 0.5, 16);
  k.sph(body, 1, c, m, 0, 0.02, L * 0.26, g * 0.52, g * 0.56, L * 0.26, 12);   // chest
  if (B.hump) k.sph(body, 1, c, m, 0, g * 0.45, B.kind === 'camel' || o.kind === 'camel' ? 0 : L * 0.25, g * 0.35, B.hump * 1.4, L * 0.2, 10);
  if (B.poodle) { k.sph(body, 1, c, m, 0, 0.03, L * 0.25, g * 0.75, g * 0.75, L * 0.3, 12); }
  // legs: front (+z) and back
  const legs = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (const [sx, sz] of legs) {
    const front = sz > 0, lz = sz * L * 0.33;
    let rx = 0;
    if (pose === 'walk') rx = (sx * sz > 0 ? 0.35 : -0.3);
    if (lie) rx = front ? -1.45 : 1.45;
    if (sit && !front) rx = 1.5;
    if (rear && front) rx = -1.0;
    const hip = k.node(body, sx * g * 0.3, -g * 0.15, lz, (sit && front) ? 0.55 : rear && !front ? 0.9 : rx, 0, lie && !front ? sx * 0.3 : 0);
    const Lg = legH * (lie ? 0.85 : 1) + g * 0.15;
    k.limb(hip, Lg * 0.55, g * 0.16, g * 0.1, c, m, 8);
    const kn = k.node(hip, 0, -Lg * 0.55, 0, lie && !front ? -2.2 : 0, 0, 0);
    k.limb(kn, Lg * 0.45, g * 0.1, g * 0.07, c, m, 8);
    if (B.hoof) k.cyl(kn, g * 0.075, g * 0.09, 0.08, o.hoofC || c, m, 0, -Lg * 0.45, 0);
    else k.sph(kn, g * 0.11, c, m, 0, -Lg * 0.45 + 0.02, g * 0.05, 1, 0.6, 1.4, 8);
  }
  // neck + head
  const nA = (o.headUp ?? B.nA) - (sit ? -0.4 : 0) - (rear ? -0.6 : 0);
  const neck = k.node(body, 0, g * 0.15, L * 0.42, -nA + Math.PI / 2, 0, 0);
  k.cyl(neck, g * 0.2, g * 0.3, B.neck, c, m, 0, B.neck / 2, 0, 0, 0, 0, 10);
  if (B.mane) k.box(neck, 0.05, B.neck * 0.95, g * 0.18, o.maneC || c, m, 0, B.neck / 2, -g * 0.2);
  const head = k.node(neck, 0, B.neck, 0, nA - Math.PI / 2 + (o.headDown || 0), o.headYaw || 0, 0);
  const [hr, hl] = B.head;
  k.sph(head, 1, c, m, 0, 0, hl * 0.15, hr * 0.85, hr * 0.85, hr, 12);
  k.sph(head, 1, c, m, 0, -hr * 0.2, hl * 0.55, hr * 0.55, hr * 0.5, hl * 0.5, 10);   // snout
  k.sph(head, 1, o.noseC || C.BLACK, m, 0, -hr * 0.1, hl * 1.0, hr * 0.18, hr * 0.14, hr * 0.1, 6);
  for (const sd of [1, -1]) {
    k.sph(head, hr * 0.12, o.eyeC || '#111', m, sd * hr * 0.55, hr * 0.25, hl * 0.35, 1, 1, 0.7, 6);
    if (B.ears === 'point' || B.ears === 'big') k.cone(head, hr * (B.ears === 'big' ? 0.3 : 0.2), hr * 0.7, c, m, sd * hr * 0.45, hr * 0.9, 0, -0.2, 0, -sd * 0.35, 6);
    if (B.ears === 'round') k.sph(head, hr * 0.22, c, m, sd * hr * 0.6, hr * 0.75, -hr * 0.1, 1, 1, 0.6, 8);
    if (B.ears === 'flop') k.sph(head, hr * 0.3, c, m, sd * hr * 0.85, -hr * 0.1, 0, 0.4, 1.2, 0.7, 8);
    if (B.ears === 'side') k.sph(head, hr * 0.22, c, m, sd * hr * 0.95, hr * 0.3, 0, 1.4, 0.5, 0.7, 6);
    if (B.ears === 'small') k.sph(head, hr * 0.14, c, m, sd * hr * 0.6, hr * 0.7, -hr * 0.2, 1, 1, 0.7, 6);
    if (B.horns === 'bull') k.tube(head, [[sd * hr * 0.6, hr * 0.6, 0], [sd * hr * 1.3, hr * 0.7, hl * 0.05], [sd * hr * 1.6, hr * 1.1, hl * 0.2]], hr * 0.09, o.hornC || '#d8cdb0', m, 6, 6);
    if (B.horns === 'small') k.cone(head, hr * 0.08, hr * 0.5, o.hornC || '#d8cdb0', m, sd * hr * 0.6, hr * 0.85, 0, 0, 0, -sd * 0.6, 6);
    if (B.horns === 'goat') k.tube(head, [[sd * hr * 0.3, hr * 0.7, 0], [sd * hr * 0.4, hr * 1.4, -hr * 0.4], [sd * hr * 0.5, hr * 1.4, -hr * 1.1]], hr * 0.08, o.hornC || '#3a332a', m, 6, 6);
    if (B.antlers && o.antlers !== false) { k.tube(head, [[sd * hr * 0.4, hr * 0.8, 0], [sd * hr * 1.4, hr * 2.2, -hr * 0.3], [sd * hr * 1.8, hr * 3.4, hr * 0.3]], hr * 0.06, '#9a8a6a', m, 8, 5); k.tube(head, [[sd * hr * 1.2, hr * 1.9, -hr * 0.2], [sd * hr * 1.0, hr * 3.0, hr * 0.4]], hr * 0.05, '#9a8a6a', m, 4, 5); }
  }
  if (B.maneBig) k.sph(head, 1, o.maneC || c, m, 0, 0, -hl * 0.05, hr * 1.45, hr * 1.5, hr * 1.0, 12);
  if (B.poodle) { k.sph(head, hr * 1.0, c, m, 0, hr * 0.8, -hr * 0.1, 1, 0.8, 1, 10); }
  if (B.beard) k.cone(head, hr * 0.2, hr * 0.6, c, m, 0, -hr * 0.6, hl * 0.6, Math.PI, 0, 0, 6);
  // tail
  const tail = k.node(body, 0, g * 0.15, -L * 0.48, 0, 0, 0);
  if (B.tail === 'long') k.tube(tail, [[0, 0, 0], [0, -0.3, -0.18], [0, -0.75, -0.2]], g * 0.1, o.maneC || c, m, 8, 6);
  if (B.tail === 'thin' || B.tail === 'tuft') { k.tube(tail, [[0, 0, 0], [0, -0.2, -0.1], [0, -0.7, -0.08]], g * 0.04, c, m, 8, 5); if (B.tail === 'tuft') k.sph(tail, g * 0.1, o.maneC || c, m, 0, -0.72, -0.08); }
  if (B.tail === 'bushy') k.sph(tail, 1, c, m, 0, -0.18, -0.2, g * 0.25, g * 0.25, 0.32, 8);
  if (B.tail === 'up') k.tube(tail, [[0, 0, 0], [0, 0.15, -0.12], [0, 0.3, -0.1]], g * 0.06, c, m, 6, 5);
  if (B.tail === 'pom') { k.cyl(tail, 0.02, 0.025, 0.25, c, m, 0, 0.1, -0.05, -0.5); k.sph(tail, 0.09, c, m, 0, 0.24, -0.1); }
  if (B.poodle) for (const [sx, sz] of legs) k.sph(body, g * 0.16, c, m, sx * g * 0.3, -legH * 0.95, sz * L * 0.33);   // pom-pom ankles
  return root;
}

// ---------- birds ----------
// o: { kind: 'sparrow'|'raven'|'eagle'|'heron'|'owl'|'gull'|'thunder', s, c (body), c2 (belly/wings), pose: 'perch'|'fly'|'upswept', x, y, z, ry }
export function bird(k, parent, o = {}) {
  const sc = o.s || 1, m = o.m || 'paint', c = o.c || '#6b5a48', c2 = o.c2 || c, kind = o.kind || 'sparrow', fly = o.pose === 'fly', up = o.pose === 'upswept';
  const root = k.node(parent, o.x || 0, o.y || 0, o.z || 0, 0, o.ry || 0, 0, sc);
  const heron = kind === 'heron', owl = kind === 'owl', legH = heron ? 0.55 : owl ? 0.06 : 0.08;
  const body = k.node(root, 0, legH + (heron ? 0.15 : 0.12), 0, fly ? 0 : owl ? -1.2 : heron ? -0.4 : -0.35, 0, 0);
  k.sph(body, 1, c, m, 0, 0, 0, heron ? 0.13 : 0.12, heron ? 0.13 : 0.12, heron ? 0.28 : 0.2, 12);
  k.sph(body, 1, c2, m, 0, -0.035, 0.02, 0.1, 0.09, 0.16, 10);   // breast
  const head = k.node(body, 0, heron ? 0.38 : 0.07, heron ? 0.2 : 0.17, fly ? 0 : owl ? 1.2 : heron ? 0.4 : 0.35, 0, 0);
  if (heron) k.cyl(body, 0.035, 0.05, 0.36, c, m, 0, 0.2, 0.17, 0.3);
  k.sph(head, owl ? 0.11 : 0.075, o.headC || c, m, 0, 0, 0, 1, 1, 1.05, 10);
  const beakL = heron ? 0.22 : kind === 'raven' ? 0.11 : kind === 'eagle' ? 0.08 : 0.05;
  k.cone(head, owl ? 0.015 : 0.024, beakL, o.beakC || (kind === 'eagle' ? '#e0b020' : '#3a3530'), m, 0, -0.01, (owl ? 0.1 : 0.07) + beakL / 2, Math.PI / 2, 0, 0, 6);
  for (const sd of [1, -1]) k.sph(head, owl ? 0.03 : 0.014, owl ? '#f2c030' : '#0d0d0d', m, sd * (owl ? 0.045 : 0.05), 0.015, owl ? 0.08 : 0.045, 1, 1, 0.6, 6);
  if (kind === 'sparrow' && o.male) { k.box(head, 0.06, 0.04, 0.02, '#1b1b1b', m, 0, -0.04, 0.07); k.sph(head, 0.074, '#7a6a5a', m, 0, 0.02, -0.005, 1, 0.75, 1.05, 10); }
  if (kind === 'eagle') k.sph(head, 0.082, '#f4f1e8', m, 0, 0.005, -0.005, 1, 1, 1.05, 10);
  // wings
  for (const sd of [1, -1]) {
    const w = k.node(body, sd * 0.1, 0.03, 0.02, 0, 0, fly ? sd * 0.1 : up ? sd * 1.25 : sd * -0.15, 1, 'ZXY');
    const span = fly || up ? (kind === 'eagle' || kind === 'thunder' ? 0.55 : heron ? 0.6 : 0.3) : 0.12;
    if (fly || up) k.add(w, U.sph(10), o.wingC || c, m, sd * span, 0, 0, 0, 0, 0, span, 0.025, 0.13);
    else k.add(w, U.sph(10), o.wingC || c, m, sd * 0.01, 0.01, -0.03, 0.15, 0, 0, 0.05, 0.1, 0.2);
  }
  k.add(body, U.box(), o.tailC || c, m, 0, 0.0, -0.24, 0.3, 0, 0, 0.12, 0.02, 0.18);   // tail
  if (!fly) for (const sd of [1, -1]) { k.cyl(root, 0.008, 0.01, legH + 0.06, o.legC || '#8a6a4a', m, sd * 0.04, (legH + 0.06) / 2, 0.01); k.box(root, 0.03, 0.01, 0.06, o.legC || '#8a6a4a', m, sd * 0.04, 0.005, 0.03); }
  return root;
}

// ---------- killer whale ----------
export function orca(k, parent, o = {}) {
  const sc = o.s || 1, m = o.m || 'bronze', c = o.c || '#181a1c', w = o.w || '#eceae4';
  const root = k.node(parent, o.x || 0, o.y || 0, o.z || 0, o.rx || 0, o.ry || 0, o.rz || 0, sc);
  // body along +z (head at +z), length ~ 6
  k.lathe(root, [[0.05, -3.1], [0.35, -2.6], [0.75, -1.6], [1.0, -0.4], [1.02, 0.6], [0.85, 1.7], [0.5, 2.6], [0.1, 3.0]], c, m, 0, 0, 0, Math.PI / 2, 0, 0, 1, 1, 0.92, 18);
  k.sph(root, 1, w, m, 0, -0.45, 1.3, 0.62, 0.55, 1.5, 12);   // white belly/chin
  for (const sd of [1, -1]) k.sph(root, 1, w, m, sd * 0.62, 0.42, 1.95, 0.08, 0.16, 0.38, 8);   // eye patches
  k.shape(root, [[0, 0], [0.5, 0], [0.1, 1.9], [-0.15, 1.8]], 0.14, c, m, 0, 0.82, -0.3, 0, Math.PI / 2, 0, 1);   // dorsal fin
  for (const sd of [1, -1]) k.add(root, U.sph(10), c, m, sd * 0.95, -0.45, 1.2, 0.3, 0, sd * 0.6, 0.65, 0.07, 0.38);   // pectoral fins
  for (const sd of [1, -1]) k.add(root, U.sph(10), c, m, sd * 0.55, 0, -3.15, 0, sd * 0.5, 0, 0.75, 0.06, 0.32);   // flukes
  return root;
}

// ---------- Northwest Coast poles ----------
// figures (bottom → top): 'bear','eagle','raven','thunderbird','wolf','whale','frog','beaver','human','watchmen','moon','salmon','sisiutl'
const POLE_PAINT = { black: '#161616', red: '#8e2a1e', teal: '#2c7470', white: '#e6dcc5', yellow: '#c7972f' };
export function pole(k, parent, o = {}) {
  const H = o.H || 10, figs = o.figs || ['bear', 'eagle'], R = o.r || 0.5, wood = o.wood || C.OLDCEDAR, painted = o.paint !== false, m = 'wood';
  const P = painted ? POLE_PAINT : { black: '#3a2c20', red: '#5a3c28', teal: '#4a4234', white: '#a08a70', yellow: '#8a6a48' };
  const root = k.node(parent, o.x || 0, 0, o.z || 0, 0, o.ry || 0, 0);
  k.cyl(root, R * 0.9, R, H, wood, m, 0, H / 2, 0, 0, 0, 0, 14);
  const n = figs.length, step = (H - 0.4) / n;
  // each crest figure's body is painted its own colour (Kwakwaka'wakw poles are bright; Haida/Nisga'a poles mostly bare cedar with black + red)
  const BODY = { bear: '#2a201a', grizzly: '#3a2a1e', wolf: '#3a3a3c', raven: '#141414', whale: '#161616', frog: '#2c7470', thunderbird: '#2c7470', beaver: '#5a3a22', salmon: '#8e2a1e', sisiutl: '#2c7470' };
  if (painted) figs.forEach((f, i) => { if (BODY[f]) k.cyl(root, R * 1.012, R * 1.012, step * 0.86, BODY[f], m, 0, 0.4 + i * step + step * 0.47, 0, 0, 0, 0, 14); });
  figs.forEach((f, i) => {
    const y = 0.4 + i * step, h = step, cy = y + h * 0.55, f0 = k.node(root, 0, 0, 0);
    const eyes = (ey, sz = 1, ex = 0.32) => { for (const sd of [1, -1]) { k.sph(f0, R * 0.26 * sz, P.white, m, sd * R * ex, ey, R * 0.86, 1.35, 0.85, 0.4, 10); k.sph(f0, R * 0.12 * sz, P.black, m, sd * R * ex, ey, R * 0.95, 1.2, 1, 0.4, 8); k.box(f0, R * 0.6 * sz, R * 0.1, R * 0.15, P.black, m, sd * R * ex, ey + R * 0.3 * sz, R * 0.88, 0, 0, sd * -0.15); } };
    const band = (yy, col, hh = 0.14) => k.cyl(f0, R * 1.02, R * 1.02, hh, col, m, 0, yy, 0, 0, 0, 0, 14);
    const mouth = (yy, w = 0.9, col = P.red) => { k.box(f0, R * w, R * 0.16, R * 0.3, col, m, 0, yy, R * 0.85); for (let t = -2; t <= 2; t++) k.box(f0, R * 0.07, R * 0.1, R * 0.08, P.white, m, t * R * w * 0.18, yy, R * 1.0); };
    const arms = (yy, col = wood) => { for (const sd of [1, -1]) { k.add(f0, U.cyl(8), col, m, sd * R * 0.75, yy, R * 0.55, 0.3, 0, sd * 1.1, R * 0.17, h * 0.42, R * 0.17); k.sph(f0, R * 0.2, col, m, sd * R * 0.25, yy - h * 0.12, R * 0.92, 1.3, 0.8, 0.6, 8); } };
    const ears = (yy, col = wood) => { for (const sd of [1, -1]) k.sph(f0, R * 0.25, col, m, sd * R * 0.6, yy, R * 0.25, 0.7, 1, 0.6, 8); };
    switch (f) {
      case 'bear': case 'grizzly': ears(y + h * 0.92); eyes(y + h * 0.7); k.sph(f0, R * 0.42, wood, m, 0, y + h * 0.48, R * 0.85, 1.1, 0.7, 0.9, 10); k.sph(f0, R * 0.12, P.black, m, 0, y + h * 0.55, R * 1.22, 1.3, 0.8, 0.6, 6); mouth(y + h * 0.36, 1.0); arms(y + h * 0.18); band(y + h * 0.02, P.black, 0.08); break;
      case 'wolf': ears(y + h * 0.95); eyes(y + h * 0.72, 0.85); k.add(f0, U.cyl(8), wood, m, 0, y + h * 0.5, R * 1.25, Math.PI / 2, 0, 0, R * 0.3, R * 1.0, R * 0.25); mouth(y + h * 0.42, 0.7); arms(y + h * 0.2); break;
      case 'eagle': eyes(y + h * 0.72); k.add(f0, U.cone(8), P.yellow, m, 0, y + h * 0.5, R * 1.15, 1.85, 0, 0, R * 0.32, R * 0.9, R * 0.25); k.add(f0, U.cone(6), P.yellow, m, 0, y + h * 0.3, R * 1.3, Math.PI, 0, 0, R * 0.13, R * 0.4, R * 0.13); for (const sd of [1, -1]) k.add(f0, U.box(), P.black, m, sd * R * 1.05, y + h * 0.45, R * 0.1, 0, 0, sd * 0.25, R * 0.3, h * 0.75, R * 0.7); break;
      case 'raven': eyes(y + h * 0.75, 0.9); k.add(f0, U.cone(8), P.black, m, 0, y + h * 0.55, R * 1.65, Math.PI / 2 + 0.12, 0, 0, R * 0.28, R * 1.9, R * 0.22); for (const sd of [1, -1]) k.add(f0, U.box(), P.black, m, sd * R * 1.0, y + h * 0.35, R * 0.15, 0, 0, sd * 0.15, R * 0.25, h * 0.6, R * 0.7); break;
      case 'thunderbird': eyes(y + h * 0.55); k.add(f0, U.cone(8), P.teal, m, 0, y + h * 0.4, R * 1.2, 2.0, 0, 0, R * 0.32, R * 0.95, R * 0.28); k.sph(f0, R * 0.5, P.teal, m, 0, y + h * 0.9, R * 0.2, 1.1, 0.6, 1, 8);
        for (const sd of [1, -1]) { k.shape(f0, [[0, 0], [R * 4.2, R * 0.9], [R * 4.6, R * 0.2], [R * 3.8, -R * 0.4], [R * 2.6, -R * 0.2], [R * 1.4, -R * 0.6], [0, -R * 0.5]], R * 0.22, P.black, m, sd * R * 0.6, y + h * 0.75, 0, 0, sd < 0 ? Math.PI : 0, 0.12 * sd, 1);
          k.shape(f0, [[R * 0.8, -R * 0.1], [R * 3.5, R * 0.55], [R * 3.4, R * 0.15], [R * 0.9, -R * 0.35]], R * 0.26, P.red, m, sd * R * 0.6, y + h * 0.75, 0, 0, sd < 0 ? Math.PI : 0, 0.12 * sd, 1); } break;
      case 'whale': eyes(y + h * 0.6, 0.8); k.add(f0, U.box(), P.black, m, 0, y + h * 0.55, R * 1.6, 0.2, 0, 0, R * 0.25, h * 0.75, R * 1.1); mouth(y + h * 0.28, 1.1); k.box(f0, R * 1.6, h * 0.18, R * 0.25, P.black, m, 0, y + h * 0.08, R * 0.8); break;   // dorsal fin sticking out front, tail flukes
      case 'frog': for (const sd of [1, -1]) k.sph(f0, R * 0.3, P.teal, m, sd * R * 0.42, y + h * 0.7, R * 0.82, 1, 1, 0.7, 10); eyes(y + h * 0.72, 0.7, 0.42); k.box(f0, R * 1.7, R * 0.2, R * 0.3, P.red, m, 0, y + h * 0.42, R * 0.86); for (const sd of [1, -1]) k.add(f0, U.cyl(6), P.teal, m, sd * R * 0.8, y + h * 0.18, R * 0.7, 0, 0, sd * 0.9, R * 0.15, h * 0.4, R * 0.15); break;
      case 'beaver': ears(y + h * 0.95); eyes(y + h * 0.75, 0.8); for (const sd of [1, -1]) k.box(f0, R * 0.16, R * 0.42, R * 0.12, P.white, m, sd * R * 0.1, y + h * 0.48, R * 1.0); k.box(f0, R * 0.9, h * 0.38, R * 0.18, P.black, m, 0, y + h * 0.16, R * 0.92); arms(y + h * 0.32); break;   // big teeth + cross-hatched tail held in front
      case 'human': case 'watchman': { eyes(y + h * 0.72, 0.75, 0.3); k.cone(f0, R * 0.1, R * 0.3, wood, m, 0, y + h * 0.62, R * 1.0, Math.PI / 2, 0, 0, 6); mouth(y + h * 0.5, 0.5); arms(y + h * 0.25, wood); band(y + h * 0.88, P.black, 0.1);
        if (f === 'watchman') { k.cyl(f0, R * 0.55, R * 0.65, h * 0.6, wood, m, 0, y + h * 1.1, 0); for (let r = 0; r < 4; r++) k.cyl(f0, R * 0.42, R * 0.48, 0.1, P.black, m, 0, y + h * 1.45 + r * 0.16, 0); } break; }
      case 'moon': k.cyl(f0, R * 1.9, R * 1.9, R * 0.3, wood, m, 0, cy, R * 0.6, Math.PI / 2, 0, 0, 24); eyes(cy + R * 0.3, 1.1); k.cone(f0, R * 0.15, R * 0.4, wood, m, 0, cy, R * 1.05, Math.PI / 2, 0, 0, 6); mouth(cy - R * 0.5, 0.7); k.tor(f0, R * 1.9, R * 0.12, P.red, m, 0, cy, R * 0.78); break;
      case 'salmon': k.add(f0, U.sph(10), P.red, m, 0, cy, R * 0.85, 0, 0, 0, R * 0.45, h * 0.45, R * 0.3); eyes(cy + h * 0.25, 0.5, 0.15); break;
      case 'sisiutl': for (const sd of [1, -1]) { k.add(f0, U.cyl(8), P.teal, m, sd * R * 1.4, cy, R * 0.6, 0, 0, Math.PI / 2, R * 0.2, R * 2.2, R * 0.2); k.sph(f0, R * 0.3, P.teal, m, sd * R * 2.5, cy, R * 0.6); k.box(f0, R * 0.12, R * 0.6, R * 0.12, P.red, m, sd * R * 2.5, cy + R * 0.35, R * 0.6); } eyes(cy + R * 0.2, 0.8); break;
    }
  });
  // weathered cedar grain bands
  if (o.top === 'flat') k.cyl(root, R * 0.9, R * 0.9, 0.08, P.black, m, 0, H + 0.04, 0);
  return root;
}
// a carved welcome figure: a human with raised open arms (Coast Salish style)
export function welcomeFigure(k, parent, o = {}) {
  const H = o.H || 5, R = H * 0.11, wood = o.wood || C.CEDAR, m = 'wood', root = k.node(parent, o.x || 0, 0, o.z || 0, 0, o.ry || 0, 0);
  k.cyl(root, R * 0.95, R * 1.05, H * 0.8, wood, m, 0, H * 0.4, 0, 0, 0, 0, 12);
  k.sph(root, R * 0.95, wood, m, 0, H * 0.88, 0, 1, 1.25, 1, 12);
  for (const sd of [1, -1]) { k.sph(root, R * 0.24, '#e6dcc5', m, sd * R * 0.35, H * 0.9, R * 0.8, 1.3, 0.8, 0.4, 8); k.sph(root, R * 0.11, '#161616', m, sd * R * 0.35, H * 0.9, R * 0.9, 1, 1, 0.4, 6); }
  k.cone(root, R * 0.15, R * 0.45, wood, m, 0, H * 0.86, R * 1.0, Math.PI / 2, 0, 0, 6);
  k.box(root, R * 0.5, R * 0.1, R * 0.2, '#8e2a1e', m, 0, H * 0.8, R * 0.85);
  for (const sd of [1, -1]) { const sh = k.node(root, sd * R * 1.0, H * 0.68, 0, 0, 0, sd * 2.0); k.limb(sh, H * 0.2, R * 0.28, R * 0.22, wood, m); const el = k.node(sh, 0, -H * 0.2, 0, 0, 0, -sd * 0.9); k.limb(el, H * 0.16, R * 0.22, R * 0.18, wood, m); k.sph(el, R * 0.3, wood, m, 0, -H * 0.17, R * 0.1, 0.6, 1.1, 0.4, 8); }
  if (o.hat) { k.cyl(root, R * 0.5, R * 1.25, R * 0.55, '#8a6a48', m, 0, H * 0.99, 0, 0, 0, 0, 12); }
  for (let i = 0; i < 3; i++) k.cyl(root, R * 1.07, R * 1.07, R * 0.12, ['#8e2a1e', '#161616', '#2c7470'][i], m, 0, H * (0.45 + i * 0.08), 0);
  return root;
}
