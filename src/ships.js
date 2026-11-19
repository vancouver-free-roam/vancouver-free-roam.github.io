// The working harbour: Canada Place's five white sails + cruise ships (in season), freighters anchored in English Bay,
// the container port (gantry cranes, stacks of containers, a ship at berth), a container ship sailing in under
// Lions Gate with its tugs, marinas full of moored boats, the little False Creek ferries, and seaplanes taking off
// and landing in Coal Harbour.
import * as THREE from 'three';
import { G, scene, std, addMesh, toXZ, canvasTex, R, pick, hash2, clamp } from './core.js';
import { heightAt, isWater, waterLevel, WATER_T } from './terrain.js';
import { buildings, bldGrid, addFlatSurface } from './city.js';
import { hullGeo, planeModel } from './vehicles.js';
import { waterPath } from './island.js';
import { discover } from './missions.js';
import { ui } from './ui.js';

// fuse a group of plain coloured parts into ONE mesh (one draw instead of dozens); textured parts are kept as they are
const BAKED = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
export function bake(g) {
  g.updateMatrixWorld(true); const inv = new THREE.Matrix4().copy(g.matrixWorld).invert(), parts = [], keep = [], c = new THREE.Color();
  g.traverse(o => {
    if (!o.isMesh) return; if (o.isInstancedMesh) { keep.push(o); return; }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (mats.some(m => m.map || m.transparent) || mats.length > 1) { keep.push(o); return; }
    let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    c.copy(mats[0].color || c.set('#ffffff')); const n = geo.attributes.position.count, col = new Float32Array(n * 3); for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); parts.push(geo);
  });
  if (!parts.length) return g;
  let pos = 0; for (const p of parts) pos += p.attributes.position.count;
  const P = new Float32Array(pos * 3), N = new Float32Array(pos * 3), C = new Float32Array(pos * 3); let o3 = 0;
  for (const p of parts) { P.set(p.attributes.position.array, o3); N.set(p.attributes.normal.array, o3); C.set(p.attributes.color.array, o3); o3 += p.attributes.position.count * 3; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 3)); geo.setAttribute('color', new THREE.BufferAttribute(C, 3)); geo.computeBoundingSphere();
  const out = new THREE.Group(); out.position.copy(g.position); out.rotation.copy(g.rotation); out.scale.copy(g.scale);
  const m = new THREE.Mesh(geo, BAKED); m.castShadow = true; m.receiveShadow = true; out.add(m);
  for (const k of keep) { const w = k.matrixWorld.clone(); out.updateMatrixWorld(true); k.parent.remove(k); k.matrix.multiplyMatrices(inv, w); k.matrix.decompose(k.position, k.quaternion, k.scale); out.add(k); }
  if (g.parent) { g.parent.add(out); g.parent.remove(g); }
  return out;
}
function nearLand(x, z, r) { for (let a = 0; a < 6.28; a += 0.5) if (!isWater(x + Math.cos(a) * r, z + Math.sin(a) * r)) return true; return false; }
// deep enough for a big ship: the city's harbour data has no depths (it's all "4 m"), so use distance from shore there
const deep = (x, z, d = -8) => waterLevel(x, z) === 0 && isWater(x, z) && (heightAt(x, z) < Math.min(d, -4.5) || !nearLand(x, z, -d * 12));

// ---------- Canada Place: the five sails ----------
function canadaPlace() {
  const [cx0, cz0] = toXZ(49.2888, -123.1111);
  let b = null, best = 1e9;
  for (const q of buildings) { const d = Math.hypot(q.x - cx0, q.z - cz0); const nm = /Canada Place|Convention Centre East/i.test(q.name || ''); const area = (q.x1 - q.x0) * (q.z1 - q.z0); if ((nm || (d < 140 && area > 8000)) && d - (nm ? 500 : 0) < best) { best = d - (nm ? 500 : 0); b = q; } }
  let ax = 0, az = -1, len = 260, wid = 60, cx = cx0, cz = cz0, top = 22;
  if (b) {
    let L = 0; for (let i = 0; i < b.p.length; i += 2) { const j = (i + 2) % b.p.length, dx = b.p[j] - b.p[i], dz = b.p[j + 1] - b.p[i + 1], l = Math.hypot(dx, dz); if (l > L) { L = l; ax = dx / l; az = dz / l; } }
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9; for (let i = 0; i < b.p.length; i += 2) { const u = (b.p[i] - b.x) * ax + (b.p[i + 1] - b.z) * az, v = -(b.p[i] - b.x) * az + (b.p[i + 1] - b.z) * ax; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    len = u1 - u0; wid = v1 - v0; cx = b.x + ax * (u0 + u1) / 2 - az * (v0 + v1) / 2; cz = b.z + az * (u0 + u1) / 2 + ax * (v0 + v1) / 2; top = b.top;
  } else {
    // the map has no outline for it: build the whole pier — deck, convention / cruise terminal, the Pan Pacific tower
    const [bx, bz] = toXZ(49.28760, -123.11190), [tx, tz] = toXZ(49.29095, -123.11125);
    len = Math.hypot(tx - bx, tz - bz); ax = (tx - bx) / len; az = (tz - bz) / len; cx = (bx + tx) / 2; cz = (bz + tz) / 2; wid = 78; top = 24;
    const yaw = Math.atan2(ax, az), grp = new THREE.Group(); grp.position.set(cx, 0, cz); grp.rotation.y = yaw; scene.add(grp);
    const glassTex = canvasTex(512, 128, (c, w, h) => { c.fillStyle = '#d9dcd6'; c.fillRect(0, 0, w, h); for (let r = 0; r < 3; r++) { c.fillStyle = r === 1 ? '#5f7f8f' : '#7f9aa6'; c.fillRect(0, 14 + r * 38, w, 22); } c.fillStyle = 'rgba(255,255,255,0.35)'; for (let k = 0; k < w; k += 16) c.fillRect(k, 0, 2, h); }, false);
    glassTex.wrapS = THREE.RepeatWrapping; glassTex.repeat.set(6, 1);
    const facade = new THREE.MeshStandardMaterial({ map: glassTex, roughness: 0.35, metalness: 0.2 }), roof = std('#c9cbc6'), concrete = std('#a8a59c');
    addMesh(new THREE.BoxGeometry(wid, 4.5, len), concrete, 0, 2, 0, grp);                                               // pier deck (top at 4.25 m)
    addMesh(new THREE.BoxGeometry(wid - 22, 20, len * 0.86), [facade, facade, roof, roof, facade, facade], 0, 14.2, len * 0.04, grp);   // the terminal / convention building
    const tower = canvasTex(256, 512, (c, w, h) => { c.fillStyle = '#3d5d68'; c.fillRect(0, 0, w, h); c.fillStyle = '#a9c4cc'; for (let r = 0; r < 26; r++) for (let k = 0; k < 10; k++) c.fillRect(6 + k * 25, 6 + r * 19.5, 18, 11); }, false);
    const tm = new THREE.MeshStandardMaterial({ map: tower, roughness: 0.25, metalness: 0.4 });
    addMesh(new THREE.BoxGeometry(46, 70, 26), [tm, tm, roof, roof, tm, tm], 0, 59, -len * 0.42, grp);                   // Pan Pacific hotel
    for (const s of [-1, 1]) addMesh(new THREE.BoxGeometry(1.2, 1.1, len * 0.98), std('#5a5e60'), s * (wid / 2 - 0.6), 4.8, 0, grp);   // railings
    // walkable deck + solid buildings
    const P = (u, v) => [cx + ax * u - az * v, cz + az * u + ax * v], c4 = (hl, hw, uo = 0) => [...P(-hl + uo, -hw), ...P(hl + uo, -hw), ...P(hl + uo, hw), ...P(-hl + uo, hw)];
    addFlatSurface(c4(len / 2, wid / 2), 4.25);
    const solid = (p, base, topY, name) => { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9, sx = 0, sz = 0; for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); sx += p[i]; sz += p[i + 1]; } const rec = { p: new Float32Array(p), top: topY, base, x: sx / 4, z: sz / 4, name, h: topY - base, x0, z0, x1, z1 }; buildings.push(rec); bldGrid.addBox(x0, z0, x1, z1, rec); };
    solid(c4(len * 0.43, (wid - 22) / 2, len * 0.04), 4.2, 24.2, 'Canada Place');
    solid(c4(13, 23, -len * 0.42), 24, 94, 'Pan Pacific Vancouver');
    top = 24.2;
  }
  // a tensioned membrane with five peaks along the pier (the famous "sails")
  const nu = 90, nv = 18, sLen = Math.min(len * 0.62, 190), sWid = Math.min(wid * 0.8, 46), pos = [], idx = [];
  const peaks = [0.1, 0.3, 0.5, 0.7, 0.9];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const u = i / nu, v = j / nv * 2 - 1;
    let f = 0; for (const p of peaks) f = Math.max(f, Math.pow(Math.max(0, 1 - Math.abs(u - p) / 0.13), 1.5));
    const y = 2 + 24 * f * Math.pow(1 - v * v, 0.8), along = (u - 0.5) * sLen + len * 0.1, across = v * sWid / 2;
    pos.push(cx + ax * along - az * across, top + y, cz + az * along + ax * across);
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b2 = a + nv + 1; idx.push(a, b2, a + 1, a + 1, b2, b2 + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const sailMat = new THREE.MeshStandardMaterial({ color: '#fbfbf8', roughness: 0.55, side: THREE.DoubleSide, emissive: '#fff6e0', emissiveIntensity: 0 });
  const sails = new THREE.Mesh(g, sailMat); sails.castShadow = true; sails.receiveShadow = true; scene.add(sails);
  for (const p of peaks) { const along = (p - 0.5) * sLen + len * 0.1; addMesh(new THREE.CylinderGeometry(0.4, 0.5, 30, 8), std('#e8e8e4'), cx + ax * along, top + 13, cz + az * along); }
  // the province + territory flags along the promenade
  const flagCols = ['#d52b1e', '#003f87', '#007a3d', '#f7c600', '#ffffff', '#00539b'];
  for (let k = 0; k < 13; k++) { const along = -len / 2 + 15 + k * (len - 30) / 12, x = cx + ax * along + az * (wid / 2 + 3), z = cz + az * along - ax * (wid / 2 + 3), y = Math.max(heightAt(x, z), 3);
    addMesh(new THREE.CylinderGeometry(0.08, 0.1, 9, 6), std('#ddd'), x, y + 4.5, z); addMesh(new THREE.BoxGeometry(0.05, 1.1, 1.8), std(flagCols[k % flagCols.length]), x, y + 8.4, z + 0.9); }
  return { cx, cz, ax, az, len, wid, top, sailMat };
}

// ---------- big ships ----------
function shipSideTex(rows, cols, bg, win) { return canvasTex(512, 128, (c, w, h) => { c.fillStyle = bg; c.fillRect(0, 0, w, h); c.fillStyle = win; for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) c.fillRect(6 + k * (w - 12) / cols, 8 + r * (h - 16) / rows, (w - 12) / cols * 0.7, (h - 16) / rows * 0.45); }, false); }
function cruiseShip(name) {
  const g = new THREE.Group(), L = 290, W = 36, white = std('#f6f6f2', { roughness: 0.5 }), navy = std('#1b2a4a');
  addMesh(hullGeo(W, 14, L, 40), navy, 0, -6, 0, g);
  addMesh(hullGeo(W - 0.4, 10, L - 2, 40), white, 0, 3, 0, g);
  const deckTex = shipSideTex(9, 60, '#f6f6f2', '#3a4d6b'), deckMat = new THREE.MeshStandardMaterial({ map: deckTex, roughness: 0.4 });
  addMesh(new THREE.BoxGeometry(W - 4, 26, L * 0.72), [deckMat, deckMat, white, white, deckMat, deckMat], 0, 26, 8, g);
  addMesh(new THREE.BoxGeometry(W - 8, 6, L * 0.5), white, 0, 42, 20, g);
  addMesh(new THREE.BoxGeometry(14, 14, 18), std('#0f5fa8'), 0, 50, 70, g);   // funnel
  addMesh(new THREE.BoxGeometry(W + 2, 3, 12), white, 0, 38, -L * 0.32, g);   // bridge wings
  for (const s of [-1, 1]) for (let k = 0; k < 10; k++) addMesh(new THREE.CapsuleGeometry(1.4, 7, 4, 8).rotateX(Math.PI / 2), std('#f27b13'), s * (W / 2 + 0.6), 16, -60 + k * 14, g);
  const nameTex = canvasTex(1024, 96, (c, w, h) => { c.fillStyle = '#1b2a4a'; c.font = 'bold 70px serif'; c.textAlign = 'center'; c.fillText(name, w / 2, 72); }, false);
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(60, 6), new THREE.MeshBasicMaterial({ map: nameTex, transparent: true })); p.position.set(s * (W / 2 + 0.3), 9, -L * 0.36); p.rotation.y = s * Math.PI / 2; g.add(p); }
  scene.add(g); return bake(g);
}
const CONT_COLS = ['#c0392b', '#2c6fb7', '#e67e22', '#27ae60', '#7f8c8d', '#f1c40f', '#8e44ad', '#16a085', '#d35400', '#1f3a5f'];
const contGeo = new THREE.BoxGeometry(2.44, 2.6, 12.2), contMat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
function containerStack(list, parent) {   // list of [x,y,z,yaw]
  const m = new THREE.InstancedMesh(contGeo, contMat, list.length), o = new THREE.Object3D(), c = new THREE.Color();
  list.forEach(([x, y, z, yaw], i) => { o.position.set(x, y + 1.3, z); o.rotation.set(0, yaw, 0); o.updateMatrix(); m.setMatrixAt(i, o.matrix); m.setColorAt(i, c.set(CONT_COLS[Math.floor(hash2(x * 3.7, z * 1.3 + y) * CONT_COLS.length)])); });
  m.castShadow = true; m.receiveShadow = true; (parent || scene).add(m); return m;
}
function freighter(kind, L, hullCol) {
  const g = new THREE.Group(), W = L * 0.15, hull = std(hullCol, { roughness: 0.7 }), white = std('#eeeeea'), dark = std('#2a2a2a');
  addMesh(hullGeo(W, 8, L, L * 0.12), std('#7a2620'), 0, -8, 0, g);     // red bottom paint
  addMesh(hullGeo(W, 12, L, L * 0.12), hull, 0, -1, 0, g);
  addMesh(new THREE.BoxGeometry(W - 0.6, 0.6, L * 0.86), std('#5c5f63'), 0, 11.1, L * 0.02, g);
  // accommodation block + bridge at the stern, funnel
  addMesh(new THREE.BoxGeometry(W - 2, 16, L * 0.1), white, 0, 19, -L * 0.4 + L * 0.82, g);
  addMesh(new THREE.BoxGeometry(W + 3, 2.4, 5), white, 0, 27, -L * 0.4 + L * 0.79, g);
  addMesh(new THREE.BoxGeometry(W - 1.8, 1.3, 0.2), dark, 0, 25.5, -L * 0.4 + L * 0.77 - 2.6, g);
  addMesh(new THREE.BoxGeometry(4, 8, 5), std(pick(['#1f3a5f', '#b03a2e', '#e6b422', '#2e7d32'])), 0, 29, -L * 0.4 + L * 0.88, g);
  if (kind === 'bulk') {
    for (let k = 0; k < 6; k++) { addMesh(new THREE.BoxGeometry(W * 0.62, 1.8, L * 0.09), std('#6d4c3d'), 0, 12.3, -L * 0.36 + k * L * 0.12, g); if (k % 2 === 0 && k < 5) { addMesh(new THREE.CylinderGeometry(0.6, 0.8, 10, 8), std('#e6b422'), W * 0.3, 16, -L * 0.3 + k * L * 0.12, g); const arm = addMesh(new THREE.BoxGeometry(0.6, 0.6, 18), std('#e6b422'), W * 0.3, 20, -L * 0.3 + k * L * 0.12 + 7, g); arm.rotation.x = 0.35; } }
  } else if (kind === 'container') {
    const list = []; for (let bay = 0; bay < Math.floor(L * 0.68 / 13); bay++) for (let row = 0; row < Math.floor(W / 2.6) - 1; row++) { const tiers = 2 + Math.floor(hash2(bay * 7.1, row * 3.3 + L) * 5); for (let t = 0; t < tiers; t++) list.push([(row - (W / 2.6 - 2) / 2) * 2.55, 11.4 + t * 2.6, -L * 0.38 + bay * 13]); }
    const m = containerStack(list.map(([x, y, z]) => [x, y, z, 0]), g);
  } else {   // tanker: pipework and a catwalk
    addMesh(new THREE.BoxGeometry(1.2, 1.2, L * 0.7), std('#8a8a85'), 0, 12.6, -L * 0.06, g);
    for (let k = 0; k < 6; k++) addMesh(new THREE.CylinderGeometry(0.4, 0.4, W * 0.7, 6).rotateZ(Math.PI / 2), std('#b0412c'), 0, 12.2, -L * 0.32 + k * L * 0.1, g);
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
  scene.add(g); return bake(g);
}
const anchored = [];
function anchorShips() {
  const zones = [[49.262, 49.312, -123.275, -123.165, 13], [49.288, 49.305, -123.02, -122.96, 3]];
  for (const [s, n, w, e, count] of zones) {
    const placed = [];
    for (let k = 0; k < 400 && placed.length < count; k++) {
      const [x, z] = toXZ(R(s, n), R(w, e));
      if (!deep(x, z, -14) || nearLand(x, z, 350) || placed.some(([a, b]) => Math.hypot(a - x, b - z) < 600)) continue;
      placed.push([x, z]);
      const kind = pick(['bulk', 'bulk', 'container', 'tanker']), L = kind === 'container' ? R(220, 300) : R(170, 230);
      const g = freighter(kind, L, pick(['#1d1d1f', '#14365c', '#6b1d1d', '#2c3e50', '#1f5130', '#4a4a4a']));
      anchored.push({ g, x, z, yaw0: 0.6 + R(-0.12, 0.12), ph: Math.random() * 6 });
    }
  }
}

// ---------- the container port (Centerm, East Vancouver waterfront) ----------
function gantry() {
  const g = new THREE.Group(), red = std('#c0392b'), white = std('#e8e8e4');
  for (const s of [-1, 1]) for (const t of [-1, 1]) addMesh(new THREE.BoxGeometry(1.6, 42, 1.6), s > 0 ? red : white, s * 8, 21, t * 14, g);
  addMesh(new THREE.BoxGeometry(18, 3, 2.5), red, 0, 42, 0, g);
  addMesh(new THREE.BoxGeometry(2.5, 3, 95), white, 0, 46, -22, g);   // boom out over the ship
  addMesh(new THREE.BoxGeometry(6, 4, 8), std('#2c3e50'), 0, 43, -8, g);
  for (const t of [-1, 1]) addMesh(new THREE.BoxGeometry(1.2, 14, 1.2), white, 0, 52, t * 6, g);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
let port = null;
function buildPort() {
  // find the shoreline north of the terminal, and lay the berth along it
  let [x, z] = toXZ(49.2868, -123.0800); let k = 0; while (!isWater(x, z) && k++ < 120) z -= 5;
  if (k >= 120) return; const bx = x, bz = z;   // first water point (berth line)
  const yaw = Math.PI / 2;                      // shore runs east-west here
  const ship = freighter('container', 260, '#14365c'); ship.position.set(bx, 0, bz - 24); ship.rotation.y = yaw;
  for (let i = 0; i < 4; i++) { const c = bake(gantry()); c.position.set(bx - 90 + i * 60, Math.max(heightAt(bx - 90 + i * 60, bz + 18), 1.5), bz + 18); c.rotation.y = yaw - Math.PI / 2 + Math.PI; scene.add(c); }
  const list = []; for (let r = 0; r < 8; r++) for (let c = 0; c < 14; c++) { const px = bx - 160 + c * 13.5, pz = bz + 45 + r * 3.2, h0 = heightAt(px, pz); if (h0 < 1 || isWater(px, pz)) continue; const tiers = 1 + Math.floor(hash2(r * 3.1, c * 7.7) * 4); for (let t = 0; t < tiers; t++) list.push([px, h0 + t * 2.6, pz, Math.PI / 2]); }
  if (list.length) containerStack(list);
  port = { x: bx, z: bz };
}

// ---------- a container ship sailing in under Lions Gate (with tugs), and out again ----------
let mover = null;
function buildMover() {
  const a = toXZ(49.300, -123.235), m1 = toXZ(49.3147, -123.1395), m2 = toXZ(49.3005, -123.1100), b = port ? [port.x + 260, port.z - 60] : toXZ(49.2925, -123.0650);
  const pts = [...waterPath(a, m1, 120, 1500), ...waterPath(m1, m2, 60, 800).slice(1), ...waterPath(m2, b, 80, 1200).slice(1)];
  const len = [0]; for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const g = freighter('container', 230, '#6b1d1d'), tugs = [0, 1].map(() => { const t = new THREE.Group(); addMesh(hullGeo(9, 3.5, 26, 6), std('#c0392b'), 0, -1.5, 0, t); addMesh(new THREE.BoxGeometry(7, 4, 9), std('#f4f4f0'), 0, 4, 2, t); addMesh(new THREE.BoxGeometry(5, 2, 5), std('#2c3e50'), 0, 7, 1, t); addMesh(new THREE.CylinderGeometry(0.7, 0.7, 4, 8), std('#111'), 0, 9, 4, t); scene.add(t); return bake(t); });
  mover = { g, tugs, pts, len, s: R(0, len[len.length - 1]), dir: 1, wait: 0 };
}
function moverAt(s) { const { pts, len } = mover; let i = 1; while (i < len.length - 1 && len[i] < s) i++; const t = clamp((s - len[i - 1]) / (len[i] - len[i - 1] || 1), 0, 1), a = pts[i - 1], b = pts[i]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(-(b[0] - a[0]), -(b[1] - a[1]))]; }

// ---------- piers and docks: real walkable wooden decks wherever the map has one over the water ----------
function buildPiers() {
  const pos = [], idx = [], posts = [], DECK = 1.5;
  const quad = (a, b, c, d) => { const k = pos.length / 3; pos.push(...a, ...b, ...c, ...d); idx.push(k, k + 2, k + 1, k, k + 3, k + 2); };
  const overWater = (x, z) => isWater(x, z) && waterLevel(x, z) === 0;
  for (const ar of window.MAP.areas) {
    if (ar.k !== 'pier') continue;
    const p = ar.p;
    if (ar.line) {   // a dock / boardwalk drawn as a line: a 4 m wide deck along it
      for (let i = 2; i < p.length; i += 2) {
        const ax = p[i - 2], az = p[i - 1], bx = p[i], bz = p[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 0.5) continue;
        if (!overWater((ax + bx) / 2, (az + bz) / 2) && !overWater(ax, az) && !overWater(bx, bz)) continue;
        const nx = -(bz - az) / L * 2, nz = (bx - ax) / L * 2;
        quad([ax + nx, DECK, az + nz], [bx + nx, DECK, bz + nz], [bx - nx, DECK, bz - nz], [ax - nx, DECK, az - nz]);
        addFlatSurface([ax + nx, az + nz, bx + nx, bz + nz, bx - nx, bz - nz, ax - nx, az - nz], DECK);
        for (let s = 0; s < L; s += 5) { const t = s / L, x = ax + (bx - ax) * t, z = az + (bz - az) * t; posts.push([x + nx * 0.9, z + nz * 0.9], [x - nx * 0.9, z - nz * 0.9]); }
      }
    } else {   // a pier drawn as an area: the whole outline becomes a deck
      let wet = 0, n = 0; for (let i = 0; i < p.length; i += 2) { n++; if (overWater(p[i], p[i + 1])) wet++; }
      let cx = 0, cz = 0; for (let i = 0; i < p.length; i += 2) { cx += p[i]; cz += p[i + 1]; } cx /= p.length / 2; cz /= p.length / 2;
      if (wet < n * 0.3 && !overWater(cx, cz)) continue;
      const pts2 = []; for (let i = 0; i < p.length; i += 2) pts2.push(new THREE.Vector2(p[i], p[i + 1]));
      let tris; try { tris = THREE.ShapeUtils.triangulateShape(pts2, []); } catch (e) { continue; }
      const k = pos.length / 3; for (const q of pts2) pos.push(q.x, DECK, q.y);
      for (const [a, b, c] of tris) { const A = pts2[a], B = pts2[b], C = pts2[c], cr = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x); if (cr < 0) idx.push(k + a, k + b, k + c); else idx.push(k + a, k + c, k + b); }
      addFlatSurface(p.slice(), DECK);
      for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length, L = Math.hypot(p[j] - p[i], p[j + 1] - p[i + 1]); for (let s = 0; s < L; s += 6) posts.push([p[i] + (p[j] - p[i]) * s / L, p[i + 1] + (p[j + 1] - p[i + 1]) * s / L]); }
    }
  }
  if (!idx.length) return;
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  const planks = canvasTex(256, 256, (c, w, h) => { c.fillStyle = '#7b6a55'; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 16) { c.fillStyle = `hsl(30, 18%, ${30 + Math.random() * 10}%)`; c.fillRect(0, y, w, 14); c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, y + 14, w, 2); } });
  planks.wrapS = planks.wrapT = THREE.RepeatWrapping;
  { const uv = []; for (let i = 0; i < pos.length; i += 3) uv.push(pos[i] / 4, pos[i + 2] / 4); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); }
  const deck = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: planks, roughness: 0.9, side: THREE.DoubleSide })); deck.receiveShadow = true; deck.castShadow = true; scene.add(deck);
  const pm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.18, 1, 6).translate(0, 0.5, 0), std('#4a3d2e'), posts.length), o = new THREE.Object3D();
  posts.forEach(([x, z], i) => { o.position.set(x, -3, z); o.scale.set(1, DECK + 3.3, 1); o.updateMatrix(); pm.setMatrixAt(i, o.matrix); }); scene.add(pm);
}

// moored boats bob and roll gently on the swell (in the vertex shader: no per-frame matrix updates)
function bob(mat) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uWT = WATER_T;
    sh.vertexShader = 'uniform float uWT;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      { vec3 ip = vec3(instanceMatrix[3]); float ph = uWT * 1.1 + ip.x * 0.31 + ip.z * 0.17; transformed.y += sin(ph) * 0.07 + transformed.x * sin(ph * 0.8 + 1.3) * 0.025; }`);
  };
  mat.customProgramCacheKey = () => 'bob';
  return mat;
}
// ---------- marinas: boats tied up along every dock in the water ----------
// `moored.spots[i]` = [x, z, yaw, h, colour, scale, sail?]; boats.js borrows one with hideMoored(i) and puts it back with showMoored(i)
export const moored = { spots: [], parts: [] };
const _zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
export function hideMoored(i) { for (const p of moored.parts) { const k = p.idx.get(i); if (k === undefined) continue; p.m.setMatrixAt(k, _zeroM); p.m.instanceMatrix.needsUpdate = true; } moored.spots[i].gone = true; }
export function showMoored(i) { for (const p of moored.parts) { const k = p.idx.get(i); if (k === undefined) continue; p.m.setMatrixAt(k, p.mats[k]); p.m.instanceMatrix.needsUpdate = true; } moored.spots[i].gone = false; }
function marinas() {
  const spots = [];
  for (const a of window.MAP.areas) {
    if (a.k !== 'pier' || !a.line) continue;
    for (let i = 2; i < a.p.length; i += 2) {
      const ax = a.p[i - 2], az = a.p[i - 1], dx = a.p[i] - ax, dz = a.p[i + 1] - az, L = Math.hypot(dx, dz); if (L < 8) continue;
      const nx = -dz / L, nz = dx / L;
      for (let s = 4; s < L - 3; s += 7.5) for (const side of [-1, 1]) {
        const x = ax + dx * s / L + nx * side * 6, z = az + dz * s / L + nz * side * 6;
        if (hash2(x * 1.7, z * 2.3) < 0.28 || !isWater(x, z) || !isWater(x + nx * side * 6, z + nz * side * 6)) continue;
        spots.push([x, z, Math.atan2(nx * side, nz * side), hash2(z, x)]);
      }
    }
  }
  const hull = hullGeo(3.4, 1.4, 11, 3).translate(0, -0.6, 0), cabin = new THREE.BoxGeometry(2.4, 1.3, 4).translate(0, 1.4, 0.8), mast = new THREE.CylinderGeometry(0.07, 0.09, 13, 5).translate(0, 7.3, -0.6);
  spots.forEach(s => { s[4] = s[3] < 0.6 ? '#f4f4f0' : pick(['#1f3a5f', '#2c5f2d', '#8b1e1e', '#e8e2d0', '#1b1b1b']); s[5] = 0.8 + s[3] * 0.6; s[6] = s[3] < 0.55; });
  spots.forEach((s, i) => { s[7] = i; });
  moored.spots = spots;
  const mk = (geo, mat, list) => { const m = new THREE.InstancedMesh(geo, mat, list.length), o = new THREE.Object3D(), c = new THREE.Color(), idx = new Map(), mats = []; list.forEach((s, i) => { const [x, z, yaw, h] = s; idx.set(s[7], i); o.position.set(x, 0.1, z); o.rotation.set(0, yaw, 0); const sc = 0.8 + h * 0.6; o.scale.set(sc, sc, sc); o.updateMatrix(); m.setMatrixAt(i, o.matrix); mats.push(o.matrix.clone()); if (mat === hullMat) m.setColorAt(i, c.set(s[4])); }); m.castShadow = true; m.receiveShadow = true; scene.add(m); moored.parts.push({ m, idx, mats }); return m; };
  const hullMat = bob(new THREE.MeshStandardMaterial({ roughness: 0.4 }));
  mk(hull, hullMat, spots); mk(cabin, bob(std('#f2f2ee')), spots); const sail = spots.filter(s => s[3] < 0.55); mk(mast, bob(std('#cfcfcf', { metalness: 0.5 })), sail);
  mk(new THREE.BoxGeometry(2.44, 0.38, 3.0).translate(0, 1.55, 0.8), bob(std('#1c262e', { metalness: 0.6, roughness: 0.15 })), spots);   // cabin windows
  mk(new THREE.CylinderGeometry(0.26, 0.22, 5, 8).rotateX(Math.PI / 2).translate(0, 2.4, -3.0), bob(std('#1f4e8c', { roughness: 0.9 })), sail);   // sail cover on the boom
  return spots.length;
}

// ---------- False Creek ferries (little rainbow boats) ----------
const STOPS = [['Maritime Museum', 49.27720, -123.14690], ['Hornby St', 49.27730, -123.12960], ['Granville Island', 49.27320, -123.13470], ['David Lam Park', 49.27180, -123.12380], ['Yaletown', 49.27360, -123.11930], ['Stamps Landing', 49.27070, -123.11800], ['Science World', 49.27310, -123.10380], ['Olympic Village', 49.27010, -123.10790], ['Spyglass Place', 49.26990, -123.11470]];
const minis = [];
function buildMinis() {
  // each stop: the nearest water point that is really connected to the main creek (not a pond or a separate basin)
  const ok = p => isWater(p[0], p[1]) && isWater(p[0] + 6, p[1]) && isWater(p[0] - 6, p[1]) && isWater(p[0], p[1] + 6) && isWater(p[0], p[1] - 6);
  let ref = toXZ(49.2725, -123.1190); for (let r = 0; r < 300 && !ok(ref); r += 10) for (let a = 0; a < 6.28 && !ok(ref); a += 0.4) { const q = toXZ(49.2725, -123.1190); ref = [q[0] + Math.cos(a) * r, q[1] + Math.sin(a) * r]; }
  const snap = ([x, z]) => { for (let r = 0; r < 400; r += 8) for (let a = 0; a < 6.28; a += 0.35) { const p = [x + Math.cos(a) * r, z + Math.sin(a) * r]; if (!ok(p)) continue; const w = waterPath(ref, p, 10, 400); if (w.length > 2 || Math.hypot(p[0] - ref[0], p[1] - ref[1]) < 15) return p; r += 24; break; } return ref; };
  const xz = STOPS.map(([, la, lo]) => snap(toXZ(la, lo))), order = [1, 2, 3, 4, 6, 7, 8, 5, 2, 1];
  let pts = []; for (let i = 1; i < order.length; i++) { const leg = waterPath(xz[order[i - 1]], xz[order[i]], 10, 400); pts = pts.concat(i > 1 ? leg.slice(1) : leg); buildMinis.legs = (buildMinis.legs || []).concat(leg.length); }
  const len = [0]; for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const rainbow = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa'];
  for (let k = 0; k < 5; k++) {
    let g = new THREE.Group(); addMesh(hullGeo(3, 1.2, 8, 2), std('#f4f4f0'), 0, -0.5, 0, g);
    rainbow.forEach((c, i) => addMesh(new THREE.BoxGeometry(2.8, 0.25, 4.6), std(c), 0, 1.0 + i * 0.25, 0.6, g));
    addMesh(new THREE.BoxGeometry(2.8, 0.15, 4.8), std('#f4f4f0'), 0, 2.6, 0.6, g);
    scene.add(g); g = bake(g); minis.push({ g, s: len[len.length - 1] * k / 5, wait: 0, pts, len });
  }
}
function pathAt(p, s) { const { pts, len } = p; let i = 1; while (i < len.length - 1 && len[i] < s) i++; const t = clamp((s - len[i - 1]) / (len[i] - len[i - 1] || 1), 0, 1), a = pts[i - 1], b = pts[i]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(-(b[0] - a[0]), -(b[1] - a[1]))]; }

// ---------- seaplanes: the Coal Harbour floatplane terminal, departures and arrivals ----------
const planes = [];
let lane = null;
function buildSeaplanes() {
  const [tx, tz] = toXZ(49.2913, -123.1175);
  // the floating dock + terminal
  addMesh(new THREE.BoxGeometry(92, 0.6, 4), std('#8a8378'), tx, 0.3, tz);
  const hut = addMesh(new THREE.BoxGeometry(14, 5, 8), std('#e9e4d6'), tx + 22, 2.8, tz + 6);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.6), new THREE.MeshBasicMaterial({ map: canvasTex(512, 80, (c, w, h) => { c.fillStyle = '#1f4e8c'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.font = 'bold 52px sans-serif'; c.textAlign = 'center'; c.fillText('HARBOUR ERR ✈', w / 2, 60); }, false) }));
  sign.position.set(tx + 22, 6.2, tz + 1.9); sign.rotation.y = Math.PI; scene.add(sign);
  // the floatplanes themselves (parked, taxiing, flying to Victoria / Nanaimo / Whistler) live in airtraffic.js
}

// ---------- init & update ----------
let CP = null, cruise = [], cruiseSeason = null, sawCruise = false;
function setCruise() {
  cruiseSeason = G.season; for (const c of cruise) scene.remove(c); cruise = [];
  const n = { summer: 2, spring: 1, fall: 1, winter: 0 }[G.season] ?? 1, names = ['DREAM OF THE SEAS', 'PACIFIC PRINCESSA', 'NORWEGIAN FJORDY'];
  for (let i = 0; i < n; i++) {
    const s = i ? -1 : 1, off = CP.wid / 2 + 22, along = CP.len * 0.05;
    const x = CP.cx + CP.ax * along + CP.az * off * s, z = CP.cz + CP.az * along - CP.ax * off * s, g = cruiseShip(names[i]);
    g.position.set(x, 0, z); g.rotation.y = Math.atan2(-CP.ax, -CP.az) + Math.PI; g.traverse(o => { if (o.isMesh) o.castShadow = true; }); cruise.push(g);
  }
}
export function initShips() {
  CP = canadaPlace(); setCruise(); anchorShips(); buildPort(); buildMover(); buildPiers(); marinas(); buildMinis(); buildSeaplanes();
}
export function updateShips(dt, pl) {
  if (G.season !== cruiseSeason) setCruise();
  CP.sailMat.emissiveIntensity = (G.night || 0) > 0.5 ? 0.35 : 0;
  for (const s of anchored) { s.g.position.set(s.x, Math.sin(G.t * 0.3 + s.ph) * 0.2, s.z); s.g.rotation.set(Math.sin(G.t * 0.25 + s.ph) * 0.006, s.yaw0 + Math.sin(G.t * 0.004 + s.ph) * 0.4, Math.sin(G.t * 0.35 + s.ph) * 0.01); }
  if (mover) {
    const L = mover.len[mover.len.length - 1];
    if (mover.wait > 0) mover.wait -= dt; else { mover.s += mover.dir * 5 * dt; if (mover.s > L || mover.s < 0) { mover.s = clamp(mover.s, 0, L); mover.dir *= -1; mover.wait = 240; } }
    const [x, z, yaw] = moverAt(mover.s), y2 = mover.dir > 0 ? yaw : yaw + Math.PI; mover.g.position.set(x, Math.sin(G.t * 0.3) * 0.15, z); mover.g.rotation.y = y2;
    mover.tugs.forEach((t, i) => { const [tx, tz, ty] = moverAt(clamp(mover.s + mover.dir * (i ? -150 : 140), 0, L)); t.position.set(tx + Math.cos(ty) * (i ? 18 : -18), Math.sin(G.t * 0.8 + i) * 0.2, tz - Math.sin(ty) * (i ? 18 : -18)); t.rotation.y = mover.dir > 0 ? ty : ty + Math.PI; });
  }
  for (const m of minis) { if (m.wait > 0) { m.wait -= dt; continue; } const L = m.len[m.len.length - 1]; m.s = (m.s + 3.2 * dt) % L; const [x, z, yaw] = pathAt(m, m.s); m.g.position.set(x, Math.sin(G.t * 2 + m.s) * 0.06, z); m.g.rotation.y = yaw; }
  const dc = Math.hypot(pl.x - CP.cx, pl.z - CP.cz);
  if (!sawCruise && cruise.length && dc < 350) { sawCruise = true; ui.toast('🛳️ Cruise ship in port!', 'Canada Place: the sails, the cruise ships, the Alaska tourists in matching windbreakers.', 3500); discover('cruise'); }
}
export const _ships = { anchored, minis, planes, get mover() { return mover; }, get CP() { return CP; } };
