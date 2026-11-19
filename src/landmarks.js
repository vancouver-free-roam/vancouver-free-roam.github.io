// Famous Vancouver landmarks and quirky local spots, placed at their real coordinates.
import * as THREE from 'three';
import { G, scene, camera, std, addMesh, toXZ, R, canvasTex, clamp } from './core.js';
import { heightAt, isWater, lakes } from './terrain.js';
import { buildings, bldGrid, surfaceY, NX, NZ, buildingAt } from './city.js';
import { makeHuman } from './people.js';

const M = window.MAP;
export const SPOTS = {};          // id -> {x, z, y, name}
export const animated = [];       // things that move every frame
const at = (lat, lon) => { const [x, z] = toXZ(lat, lon); return { x, z, y: heightAt(x, z) }; };
function spot(id, name, lat, lon, extra = {}) { const p = at(lat, lon); if (ON_LAND.has(id)) Object.assign(p, landNear(p.x, p.z)); SPOTS[id] = { id, name, ...p, ...extra }; return SPOTS[id]; }
// plaza pieces whose real spot the map's coastline puts just offshore: step onto the nearest dry ground
const ON_LAND = new Set(['orca', 'drop', 'cauldron']);
function landNear(x, z) {   // open ground: not water, not inside a building (the Convention Centre's outline covers the real plaza)
  const open = (X, Z) => !isWater(X, Z) && !buildingAt(X, Z);
  if (open(x, z)) return { x, z, y: heightAt(x, z) };
  for (let r = 4; r <= 200; r += 4) for (let a = 0; a < 6.28; a += 0.25) { const X = x + Math.cos(a) * r, Z = z + Math.sin(a) * r, X2 = X + Math.cos(a) * 7, Z2 = Z + Math.sin(a) * 7;
    if (open(X, Z) && open(X2, Z2) && open(X2 + 5, Z2) && open(X2 - 5, Z2) && open(X2, Z2 + 5) && open(X2, Z2 - 5)) return { x: X2, z: Z2, y: heightAt(X2, Z2) }; }
  return { x, z, y: heightAt(x, z) };
}
const findBld = re => buildings.filter(b => re.test(b.name)).sort((a, b) => b.top - a.top)[0];

function textPlane(text, w, h, bg = '#2f5a3a', fg = '#fff', font = 'bold 64px Georgia, serif', border = '#d9c27a') {
  const tex = canvasTex(1024, Math.round(1024 * h / w), (c, W, H) => {
    c.fillStyle = bg; c.fillRect(0, 0, W, H); c.strokeStyle = border; c.lineWidth = 14; c.strokeRect(10, 10, W - 20, H - 20);
    c.fillStyle = fg; c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle';
    const lines = text.split('\n'); lines.forEach((l, i) => c.fillText(l, W / 2, H / 2 + (i - (lines.length - 1) / 2) * parseInt(font.match(/\d+/)[0]) * 1.15, W - 60));
  }, false);
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, side: THREE.DoubleSide }));
}
// ---------- the Fairmont Hotel Vancouver (1939): the map only has its low base, so the 111 m château tower is built here ----------
// grey sandstone walls with rows of windows, a steep green copper roof with dormers and corner turrets, a cross wing behind
function hipRoof(L, W, H) {   // a hipped roof: ridge along x, slopes on all four sides
  const r = Math.max(0, L / 2 - W / 2), v = [-L / 2, 0, -W / 2, L / 2, 0, -W / 2, L / 2, 0, W / 2, -L / 2, 0, W / 2, -r, H, 0, r, H, 0];
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex([0, 4, 5, 0, 5, 1, 2, 5, 4, 2, 4, 3, 1, 5, 2, 3, 4, 0]); g.computeVertexNormals(); return g.toNonIndexed();
}
function hotelVancouver() {
  const pod = buildings.filter(b => b.name === 'Fairmont Hotel Vancouver').sort((a, b) => (b.x1 - b.x0) * (b.z1 - b.z0) - (a.x1 - a.x0) * (a.z1 - a.z0))[0]; if (!pod) return;
  // line the tower up with the podium's longest wall (downtown's tilted street grid)
  const P = pod.p, n = P.length / 2; let best = 0, yaw = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n, dx = P[j * 2] - P[i * 2], dz = P[j * 2 + 1] - P[i * 2 + 1], L = Math.hypot(dx, dz); if (L > best) { best = L; yaw = Math.atan2(dz, dx); } }
  const base = pod.base ?? heightAt(pod.x, pod.z), g = new THREE.Group(); g.position.set(pod.x, base, pod.z); g.rotation.y = -yaw;
  const winTex = canvasTex(256, 256, (c, w, h) => { c.fillStyle = '#bcb09a'; c.fillRect(0, 0, w, h); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { c.fillStyle = '#2d3238'; c.fillRect(x * 32 + 10, y * 32 + 8, 12, 18); c.fillStyle = '#d8ccb4'; c.fillRect(x * 32 + 8, y * 32 + 26, 16, 3); } c.fillStyle = 'rgba(0,0,0,0.05)'; for (let i = 0; i < 400; i++) c.fillRect(Math.random() * w, Math.random() * h, 3, 1); }, true);
  const wallMat = (L, H) => { const t = winTex.clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(L / 26, H / 26); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 }); };
  const copper = new THREE.MeshStandardMaterial({ color: '#5e9a80', roughness: 0.55, metalness: 0.35 }), trim = new THREE.MeshStandardMaterial({ color: '#d6cbb3', roughness: 0.8 });
  const block = (L, W, H, x, z, roofH) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(L, H, W), [wallMat(W, H), wallMat(W, H), trim, trim, wallMat(L, H), wallMat(L, H)]); m.position.set(x, H / 2, z); m.castShadow = m.receiveShadow = true; g.add(m);
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(L + 0.8, 0.8, W + 0.8), trim); cornice.position.set(x, H + 0.4, z); g.add(cornice);
    const r = new THREE.Mesh(hipRoof(L + 0.6, W + 0.6, roofH), copper); r.position.set(x, H + 0.8, z); r.castShadow = true; g.add(r);
    for (let k = -2; k <= 2; k++) for (const s of [-1, 1]) {   // dormers poking out of the copper
      const d = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.6, 2), trim); d.position.set(x + k * L / 6, H + 2.4, z + s * (W / 2 - 1.4)); g.add(d);
      const dr = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.6, 4), copper); dr.position.set(x + k * L / 6, H + 4.4, z + s * (W / 2 - 1.4)); dr.rotation.y = Math.PI / 4; g.add(dr);
    }
  };
  block(54, 20, 84, 0, 0, 24);             // the main slab under the great roof (to ~110 m)
  block(20, 34, 66, 0, 18, 15);            // the cross wing behind
  for (const s of [-1, 1]) { const t = new THREE.Mesh(new THREE.ConeGeometry(3.4, 12, 8), copper); t.position.set(s * 25, 90, 0); g.add(t); const c = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 6, 8), trim); c.position.set(s * 25, 82, 0); g.add(c); }   // corner turrets
  const flag = new THREE.Mesh(new THREE.BoxGeometry(0.12, 6, 0.12), trim); flag.position.set(0, 110.5, 0); g.add(flag);
  scene.add(g);
  // collisions: the tower is solid (and you can land on its roof)
  const c = Math.cos(-yaw), s = Math.sin(-yaw), W2 = (u, v) => [pod.x + u * c + v * s, pod.z - u * s + v * c];
  for (const [L, W, H, z0] of [[54, 20, 84, 0], [20, 34, 66, 18]]) {
    const pts = [W2(-L / 2, z0 - W / 2), W2(L / 2, z0 - W / 2), W2(L / 2, z0 + W / 2), W2(-L / 2, z0 + W / 2)].flat();
    let x0 = 1e9, zz0 = 1e9, x1 = -1e9, z1 = -1e9; for (let i = 0; i < 8; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); zz0 = Math.min(zz0, pts[i + 1]); z1 = Math.max(z1, pts[i + 1]); }
    const rec = { p: new Float32Array(pts), top: base + H, base, x: (x0 + x1) / 2, z: (zz0 + z1) / 2, name: 'Fairmont Hotel Vancouver', h: H, x0, z0: zz0, x1, z1 }; buildings.push(rec); bldGrid.addBox(x0, zz0, x1, z1, rec);
  }
}
function place(obj, p, rotY = 0) { obj.position.set(p.x, p.y, p.z); obj.rotation.y = rotY; scene.add(obj); return obj; }

export function buildLandmarks() {
  const white = std('#f3f1ec', { roughness: 0.45 }), bronze = std('#7a5a35', { metalness: 0.7, roughness: 0.45 }), stone = std('#9c9a95', { flatShading: true });

  hotelVancouver();

  // Science World dome
  { const p = spot('science', 'Science World', 49.2734, -123.1038); const g = new THREE.Group();
    addMesh(new THREE.CylinderGeometry(18, 22, 12, 24), white, 0, 6, 0, g);
    addMesh(new THREE.IcosahedronGeometry(25, 3), std('#d8dde2', { metalness: 0.95, roughness: 0.2, flatShading: true }), 0, 34, 0, g);
    place(g, p); }

  // East Van Cross (Ken Lum's "Monument for East Vancouver"): EAST down, VAN across, sharing the A. Glows at night.
  { const p = spot('eastvan', 'East Van Cross', 49.2653, -123.0779); const g = new THREE.Group(), C = 3, base = 4;
    const frame = std('#3a3f45', { metalness: 0.6, roughness: 0.4 });
    const letterMat = ch => { const tex = canvasTex(256, 256, (c, w, h) => { c.fillStyle = '#20252b'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.font = 'bold 220px Arial, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(ch, w / 2, h / 2 + 10); }, false);
      return new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.3, roughness: 0.6 }); };
    const mats = [];
    const cell = (ch, col, row) => {
      const y = base + (3.5 - row) * C, x = col * C, m = letterMat(ch); mats.push(m);
      addMesh(new THREE.BoxGeometry(C, C, 0.7), frame, x, y, 0, g);
      for (const s of [1, -1]) { const pl = addMesh(new THREE.PlaneGeometry(C - 0.3, C - 0.3), m, x, y, s * 0.36, g, false); if (s < 0) pl.rotation.y = Math.PI; }
    };
    cell('E', 0, 0); cell('A', 0, 1); cell('S', 0, 2); cell('T', 0, 3); cell('V', -1, 1); cell('N', 1, 1);
    addMesh(new THREE.BoxGeometry(1.2, base, 0.7), frame, 0, base / 2, 0, g);
    addMesh(new THREE.BoxGeometry(4, 0.4, 3), std('#8a8a85'), 0, 0.2, 0, g);
    place(g, p, 0.35);
    animated.push(() => { const k = 0.3 + (G.night || 0) * 2.2; for (const m of mats) m.emissiveIntensity = k; }); }

  // Canada Place sails
  { const p = spot('canada', 'Canada Place', 49.2888, -123.1111); const b = findBld(/Canada Place|Convention Centre East|Pan Pacific/i);
    const top = b ? b.top : p.y + 20, cx = b ? b.x : p.x, cz = b ? b.z : p.z;
    /* the sails + cruise ships are built in ships.js */ }

  // Harbour Centre (1977): a 28-storey office slab (concrete bands + dark bronze glass), a concrete core rising out of it to
  // the "flying saucer" Lookout + revolving restaurant (deck ~168 m), an antenna to ~177 m, and the yellow glass SkyLift
  // elevators riding up the outside
  { const b = findBld(/^Harbour Centre$/i) || findBld(/Harbour Centre/i); const p = spot('harbour', 'Harbour Centre Lookout', 49.2847, -123.1118);
    const x = b ? b.x : p.x, z = b ? b.z : p.z, y0 = b ? b.base ?? p.y : p.y, g = new THREE.Group(); g.position.set(x, y0, z); g.rotation.y = -0.69;   // downtown grid
    const bandTex = canvasTex(64, 256, (c, w, h) => { for (let i = 0; i < 16; i++) { c.fillStyle = '#c9c1b1'; c.fillRect(0, i * 16, w, 6); c.fillStyle = '#3a3128'; c.fillRect(0, i * 16 + 6, w, 10); } }, true);
    bandTex.wrapS = bandTex.wrapT = THREE.RepeatWrapping; bandTex.repeat.set(4, 105 / 16 / 3.75);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(38, 105, 30), new THREE.MeshStandardMaterial({ map: bandTex, roughness: 0.55, metalness: 0.2 })); slab.position.y = 52.5; slab.castShadow = true; g.add(slab);
    addMesh(new THREE.BoxGeometry(39, 2, 31), std('#cfc8b8'), 0, 106, 0, g);
    addMesh(new THREE.CylinderGeometry(7, 7, 38, 20), std('#cfc8ba', { roughness: 0.8 }), 0, 106 + 19, 0, g);              // the core above the offices
    addMesh(new THREE.CylinderGeometry(22, 15, 10, 40), std('#d8d2c4', { roughness: 0.7 }), 0, 145, 0, g);                 // saucer underside
    addMesh(new THREE.CylinderGeometry(22.3, 22.3, 5, 40), std('#1c2b33', { metalness: 0.9, roughness: 0.08 }), 0, 151.5, 0, g);   // the glass lookout ring
    addMesh(new THREE.CylinderGeometry(19, 22.3, 4, 40), std('#d8d2c4', { roughness: 0.7 }), 0, 156, 0, g);                // roof
    addMesh(new THREE.CylinderGeometry(0.5, 1.1, 20, 8), std('#c8c8c8', { metalness: 0.6 }), 0, 168, 0, g);                // antenna
    addMesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff3b30' }), 0, 178.3, 0, g, false); // aircraft warning light
    for (const s of [-1, 1]) {   // two SkyLift glass elevators running up the outside of the tower
      addMesh(new THREE.BoxGeometry(2.4, 147, 0.6), std('#2a2f33', { metalness: 0.5 }), s * 3.2, 73.5, 15.6, g);
      const cab = addMesh(new THREE.BoxGeometry(2.6, 3, 2.2), std('#f2c230', { emissive: '#7a5a00', emissiveIntensity: 0.5, metalness: 0.3, roughness: 0.2 }), s * 3.2, 10, 16.8, g); cab.userData.ph = s > 0 ? 0 : 0.5;
      animated.push(() => { const t = ((G.t || 0) / 70 + cab.userData.ph) % 1, u = t < 0.5 ? t * 2 : 2 - t * 2; cab.position.y = 3 + u * 140; });   // up and down all day
    }
    scene.add(g); SPOTS.harbour.y = y0 + 152; }

  // Olympic Cauldron + Digital Orca + The Drop (Jack Poole Plaza)
  { const p = spot('cauldron', 'Olympic Cauldron', 49.2893, -123.1170); const g = new THREE.Group();
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; const s = addMesh(new THREE.BoxGeometry(1.2, 18, 1.2), white, Math.cos(a) * 5, 8, Math.sin(a) * 5, g); s.rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25); }
    const flame = addMesh(new THREE.ConeGeometry(2.5, 7, 12), new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.85 }), 0, 19, 0, g, false); flame.visible = false;
    place(g, p); SPOTS.cauldron.flame = flame; }
  // Douglas Coupland's Digital Orca (2009): an ~8 m killer whale leaping out of the plaza, "pixelated" into black and white
  // powder-coated cubes (white belly, chin and eye patch), its tail still in the ground
  { const p = spot('orca', 'Digital Orca', 49.2897, -123.1160); const g = new THREE.Group(), C = 0.62, cells = [], col = [];
    const spine = t => { const a = -0.25 + t * 1.6; return [Math.cos(a) * 6 - 3, Math.sin(a) * 5.2 + 0.2]; };   // an arc rising out of the ground
    const rad = t => 1.55 * Math.sin(Math.PI * Math.min(1, t * 1.15)) ** 0.7 + 0.15;                             // body thickness along it
    const seen = new Set();
    for (let t = 0; t <= 1; t += 0.008) {
      const [sx, sy] = spine(t), [nx, ny] = spine(t + 0.01), L = Math.hypot(nx - sx, ny - sy) || 1, ux = (nx - sx) / L, uy = (ny - sy) / L, r = rad(t);
      for (let a = -r; a <= r; a += C * 0.6) for (let zz = -r; zz <= r; zz += C * 0.6) {
        if (a * a / (r * r) + zz * zz / (r * r * 0.7) > 1) continue;
        const x = sx - uy * a, y = sy + ux * a; if (y < -0.2) continue;
        const key = Math.round(x / C) + ',' + Math.round(y / C) + ',' + Math.round(zz / C); if (seen.has(key)) continue; seen.add(key);
        const belly = a < -r * 0.35, patch = t > 0.82 && t < 0.9 && a > 0 && Math.abs(zz) > r * 0.45, chin = t > 0.93;
        cells.push(Math.round(x / C) * C, Math.round(y / C) * C, Math.round(zz / C) * C); col.push(belly || patch || chin ? 1 : 0);
      }
    }
    { const [fx, fy] = spine(0.55); for (let k = 0; k < 6; k++) { const key = Math.round(fx / C) + ',' + Math.round((fy + 1.4 + k * C) / C) + ',0'; if (!seen.has(key)) { seen.add(key); cells.push(Math.round(fx / C) * C - k * 0.12, Math.round((fy + 1.4 + k * C) / C) * C, 0); col.push(0); } } }   // dorsal fin
    for (const s of [-1, 1]) for (let k = 1; k <= 3; k++) { const [px, py] = spine(0.7); cells.push(px - 0.6, py - 0.9 - k * 0.3, s * (1.2 + k * C)); col.push(0); }   // pectoral fins
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(C * 0.96, C * 0.96, C * 0.96), new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.3 }), col.length), o = new THREE.Object3D(), cc = new THREE.Color();
    for (let i = 0; i < col.length; i++) { o.position.set(cells[i * 3], cells[i * 3 + 1], cells[i * 3 + 2]); o.updateMatrix(); im.setMatrixAt(i, o.matrix); im.setColorAt(i, cc.set(col[i] ? '#f2f2f0' : '#141414')); }
    im.castShadow = true; g.add(im); place(g, p, 0.6); }
  // The Drop (Inges Idee, 2009): a ~20 m deep-blue raindrop, slender and leaning at a jaunty angle, rising from Bon Voyage Plaza
  { const p = spot('drop', 'The Drop', 49.2889, -123.1150); const g = new THREE.Group();
    const prof = []; for (let i = 0; i <= 40; i++) { const t = i / 40, r = t < 0.72 ? 0.35 + 1.3 * Math.pow(t / 0.72, 1.6) : 1.65 * Math.sqrt(Math.max(0, 1 - ((t - 0.72) / 0.28) ** 2)); prof.push(new THREE.Vector2(Math.max(0.02, r), t * 19)); }
    const drop = new THREE.Mesh(new THREE.LatheGeometry(prof, 32), std('#1f5fd1', { roughness: 0.25, metalness: 0.15 })); drop.rotation.z = 0.32; drop.position.x = -0.3; drop.castShadow = true; g.add(drop);
    // the slim tail bends back toward the ground like a falling droplet's
    addMesh(new THREE.CylinderGeometry(0.9, 1.2, 0.5, 20), std('#8a8f96'), 0, 0.25, 0, g); place(g, p, 0.4); }

  // Gastown: steam clock + Gassy Jack
  // Raymond Saunders' steam clock (1977): ~5.2 m, Victorian bronze case on a stepped granite base, glass panels showing the
  // brass works and the steel balls, four white clock faces under a little roof, and five brass steam whistles on top
  { const p = spot('steamclock', 'Gastown Steam Clock', 49.2844, -123.1088); const g = new THREE.Group(), br = std('#4a3a26', { metalness: 0.65, roughness: 0.45 }), brass = std('#c9a24a', { metalness: 0.85, roughness: 0.3 });
    addMesh(new THREE.BoxGeometry(1.7, 0.45, 1.7), std('#7b7b78'), 0, 0.22, 0, g); addMesh(new THREE.BoxGeometry(1.4, 0.4, 1.4), std('#8a8a86'), 0, 0.65, 0, g);
    addMesh(new THREE.BoxGeometry(1.05, 2.4, 1.05), br, 0, 2.05, 0, g);                                              // the case
    for (const [x, z, ry] of [[0, 0.53, 0], [0, -0.53, Math.PI], [0.53, 0, Math.PI / 2], [-0.53, 0, -Math.PI / 2]]) {
      const w = addMesh(new THREE.PlaneGeometry(0.7, 1.8), std('#2a2a22', { metalness: 0.3, roughness: 0.15, emissive: '#3a2a10', emissiveIntensity: 0.4 }), x * 1.02, 2.1, z * 1.02, g, false); w.rotation.y = ry;   // glass showing the works
      const f = addMesh(new THREE.CircleGeometry(0.42, 24), std('#f4efe0', { emissive: '#3a3020', emissiveIntensity: 0.6 }), x * 1.16, 3.85, z * 1.16, g, false); f.rotation.y = ry;   // clock faces
    }
    addMesh(new THREE.BoxGeometry(1.25, 1.1, 1.25), br, 0, 3.85, 0, g);
    for (const y of [3.28, 4.42]) addMesh(new THREE.BoxGeometry(1.4, 0.12, 1.4), brass, 0, y, 0, g);              // gilded mouldings
    addMesh(new THREE.ConeGeometry(0.95, 0.6, 4).rotateY(Math.PI / 4), br, 0, 4.78, 0, g);
    for (const [x, z] of [[0, 0], [0.32, 0.32], [-0.32, 0.32], [0.32, -0.32], [-0.32, -0.32]]) addMesh(new THREE.CylinderGeometry(x || z ? 0.07 : 0.1, x || z ? 0.07 : 0.1, x || z ? 0.42 : 0.6, 10), brass, x, 5.15 + (x || z ? 0 : 0.08), z, g);   // 5 whistles
    place(g, p); SPOTS.steamclock.steam = [];
    for (let i = 0; i < 6; i++) { const s = addMesh(new THREE.SphereGeometry(0.4, 8, 6), new THREE.MeshBasicMaterial({ color: '#eee', transparent: true, opacity: 0.6, depthWrite: false }), p.x, p.y + 7.5, p.z, scene, false); s.userData.ph = i / 6; SPOTS.steamclock.steam.push(s); } }
  { const p = spot('gassyjack', 'Gassy Jack statue', 49.2840, -123.1040); const g = new THREE.Group();
    addMesh(new THREE.CylinderGeometry(0.7, 0.8, 1.3, 14), std('#6b4a2b'), 0, 0.65, 0, g);
    const jack = makeHuman({ skin: '#7a5a35', hair: '#5a4025', shirt: '#6b5030', pants: '#5a4428', hat: '#5a4428' });
    scene.remove(jack.grp); g.add(jack.grp); jack.grp.position.y = 1.3; jack.grp.traverse(o => o.isMesh && (o.material = bronze)); jack.st.kind = 'stand'; jack.pose();
    place(g, p, 2.4); }

  // English Bay: Inukshuk + A-maze-ing Laughter
  { const p = spot('inukshuk', 'English Bay Inukshuk', 49.2867, -123.1432); const g = new THREE.Group();
    for (const [w, h, d, x, y] of [[1.6, 3.4, 1.6, -1.6, 1.7], [1.6, 3.4, 1.6, 1.6, 1.7], [5.5, 1.4, 1.8, 0, 4.1], [2, 2, 1.6, 0, 5.8], [8.5, 1.1, 1.6, 0, 7.35], [1.5, 1.4, 1.5, 0, 8.6]]) addMesh(new THREE.BoxGeometry(w, h, d), stone, x, y, 0, g);
    place(g, p, 0.8); }
  { const p = spot('laughter', 'A-maze-ing Laughter', 49.2873, -123.1415);
    for (let i = 0; i < 14; i++) {
      const h = makeHuman({ skin: '#6f6f72', hair: '#6f6f72', shirt: '#6f6f72', pants: '#6f6f72' });
      // Yue Minjun's 14 cast-bronze (dark golden-brown) self-portraits, ~3 m tall, bald, bare-chested, frozen mid-laugh,
      // standing in a loose grid, each in a different pose (bent double, leaning back, hands on knees…)
      h.grp.traverse(o => o.isMesh && (o.material = std('#6e4f2f', { metalness: 0.7, roughness: 0.38 })));
      const gx = i % 5, gz = Math.floor(i / 5), x = p.x + (gx - 2) * 4.2 + R(-0.6, 0.6), z = p.z + (gz - 1) * 4.6 + R(-0.6, 0.6); h.grp.position.set(x, heightAt(x, z), z);
      h.grp.rotation.y = R(-Math.PI, Math.PI); h.grp.scale.setScalar(1.7); h.st.kind = 'stand'; h.pose();
      const pose = i % 4, body = h.grp.children[0];
      if (pose === 0) { body.rotation.x = 0.45; h.parts.armL.rotation.x = -0.9; h.parts.armR.rotation.x = -0.9; }                  // bent double laughing
      else if (pose === 1) { body.rotation.x = -0.3; h.parts.armL.rotation.z = -0.6; h.parts.armR.rotation.z = 0.6; }             // head thrown back
      else if (pose === 2) { body.rotation.x = 0.15; h.parts.armL.rotation.x = -2.4; h.parts.armR.rotation.x = -0.5; }            // one arm up
      else { body.rotation.x = 0.25; h.parts.armL.rotation.x = -0.4; h.parts.armR.rotation.x = -0.4; h.parts.armL.rotation.z = 0.5; h.parts.armR.rotation.z = -0.5; }   // hands together
      if (h.parts.head) h.parts.head.scale.setScalar(1.25);   // big laughing heads
    } }

  // Chinatown Millennium Gate + Sun Yat-Sen garden pavilion
  { const p = spot('gate', 'Chinatown Millennium Gate', 49.2800, -123.1043); const g = new THREE.Group(), red = std('#b3261e'), green = std('#2e6b4f', { flatShading: true }), gold = std('#d4a017', { metalness: 0.6, roughness: 0.4 });
    for (const x of [-7, -3.5, 3.5, 7]) addMesh(new THREE.BoxGeometry(1, x === -7 || x === 7 ? 7 : 10, 1), red, x, (x === -7 || x === 7 ? 7 : 10) / 2, 0, g);
    addMesh(new THREE.BoxGeometry(17, 1.2, 2.2), red, 0, 10.5, 0, g);
    addMesh(new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4).scale(13, 3, 4), green, 0, 12.5, 0, g);
    addMesh(new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4).scale(8, 2.4, 3.2), green, 0, 15, 0, g);
    addMesh(new THREE.BoxGeometry(6, 1.6, 0.3), gold, 0, 9, 1.2, g);
    for (const s of [-1, 1]) addMesh(new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4).scale(5, 1.8, 3), green, s * 7, 8, 0, g);
    place(g, p, 0); }
  { const p = spot('sunyatsen', 'Dr. Sun Yat-Sen Classical Chinese Garden', 49.2797, -123.1035); const g = new THREE.Group();
    for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) addMesh(new THREE.CylinderGeometry(0.2, 0.2, 3), std('#7a2018'), x, 1.5, z, g);
    addMesh(new THREE.ConeGeometry(1, 1, 6).scale(4.5, 2, 4.5), std('#3a5a48', { flatShading: true }), 0, 4, 0, g); place(g, p); }

  // Woodward's W
  { const p = spot('woodwards', 'Woodward\'s W', 49.2827, -123.1074); const b = findBld(/Woodward/i); const top = Math.max(b ? b.top : 0, p.y + 120);
    const w = new THREE.Group(); addMesh(new THREE.CylinderGeometry(0.4, 0.4, 12), std('#888'), 0, 6, 0, w);
    const sign = textPlane('W', 9, 9, '#b3121b', '#fff', 'bold 900px Georgia', '#b3121b'); sign.position.y = 16; w.add(sign);
    w.position.set(b ? b.x : p.x, top, b ? b.z : p.z); scene.add(w); animated.push(dt => { sign.rotation.y += dt * 0.6; }); }

  // (the Hotel Vancouver's tower + copper roof are built by hotelVancouver() above)

  // BC Place masts
  { const b = findBld(/BC Place/i); const p = spot('bcplace', 'BC Place', 49.2768, -123.1120); const x = b ? b.x : p.x, z = b ? b.z : p.z, top = b ? b.top : p.y + 50;
    for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; addMesh(new THREE.CylinderGeometry(0.6, 1, 30, 6), white, x + Math.cos(a) * 85, top + 8, z + Math.sin(a) * 70); }
    addMesh(new THREE.SphereGeometry(1, 40, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(80, 14, 66), std('#eef0f2', { roughness: 0.35 }), x, top - 2, z); }

  // Stanley Park: totem poles, 9 O'Clock Gun, Girl in a Wetsuit, Siwash Rock, Hollow Tree, Prospect Point
  { const p = spot('totems', 'Brockton Point Totem Poles', 49.2995, -123.1213); const tc = ['#9b2d20', '#1b1b1b', '#2f6f6a', '#c98b2b', '#e6dcc3'];
    for (let i = 0; i < 9; i++) { const a = -1.2 + i * 0.3, x = p.x + Math.cos(a) * 14, z = p.z + Math.sin(a) * 14, h = R(8, 13), y = heightAt(x, z);
      for (let s = 0; s < 5; s++) addMesh(new THREE.CylinderGeometry(0.65, 0.7, h / 5, 10), std(tc[(i + s) % 5]), x, y + h / 5 * (s + 0.5), z);
      if (i % 3 === 0) addMesh(new THREE.BoxGeometry(5, 0.6, 0.6), std(tc[(i + 2) % 5]), x, y + h * 0.88, z).rotation.y = -a; } }
  { const p = spot('ninegun', 'Nine O\'Clock Gun', 49.2965, -123.1225); const g = new THREE.Group();
    addMesh(new THREE.CylinderGeometry(0.35, 0.5, 3.2, 12).rotateZ(Math.PI / 2), std('#222', { metalness: 0.7 }), 0, 1.2, 0, g);
    for (const [x, z] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]]) addMesh(new THREE.BoxGeometry(0.3, 3.2, 0.3), white, x, 1.6, z, g);
    addMesh(new THREE.ConeGeometry(4.5, 1.5, 4).rotateY(Math.PI / 4), std('#2f5a3a'), 0, 3.9, 0, g); place(g, p); }
  { const p = spot('wetsuit', 'Girl in a Wetsuit', 49.3029, -123.1263); const g = new THREE.Group();
    addMesh(new THREE.DodecahedronGeometry(2.2), stone, 0, 0, 0, g);
    const h = makeHuman({ skin: '#3a3a3a', hair: '#3a3a3a', shirt: '#3a3a3a', pants: '#3a3a3a' }); scene.remove(h.grp); g.add(h.grp); h.grp.position.y = 1.5; h.grp.traverse(o => o.isMesh && (o.material = bronze)); h.st.kind = 'sit'; h.pose();
    place(g, { ...p, y: 0 }); }
  { const p = spot('siwash', 'Siwash Rock', 49.3054, -123.1550); const g = new THREE.Group();
    addMesh(new THREE.CylinderGeometry(4, 7, 16, 9).translate(0, 8, 0), std('#6e6a62', { flatShading: true }), 0, -2, 0, g);
    addMesh(new THREE.ConeGeometry(2.5, 8, 7), std('#264a2c'), 0, 18, 0, g); place(g, { ...p, y: 0 }); }
  { const p = spot('hollowtree', 'The Hollow Tree', 49.3008, -123.1546); const g = new THREE.Group();
    addMesh(new THREE.CylinderGeometry(3.4, 4.5, 14, 14, 1, true), std('#5a4030', { side: THREE.DoubleSide, flatShading: true }), 0, 7, 0, g); place(g, p); }
  spot('prospect', 'Prospect Point', 49.3134, -123.1410);

  // Lions Gate Bridge towers and cables, built along the real bridge
  { const lg = M.roads.filter(r => r.b && /Lions Gate/i.test(M.names[r.n] || ''));
    if (lg.length) {
      let pts = []; for (const r of lg) for (const n of r.p) pts.push(n); pts = [...new Set(pts)].map(n => ({ x: NX(n), z: NZ(n) }));
      pts.sort((a, b) => a.z - b.z); const A = pts[0], B = pts[pts.length - 1];
      const len = Math.hypot(B.x - A.x, B.z - A.z), ux = (B.x - A.x) / len, uz = (B.z - A.z) / len, px = -uz, pz = ux, green = std('#3d6b4f', { metalness: 0.4, roughness: 0.5 });
      const deck = t => surfaceY(A.x + ux * len * t, A.z + uz * len * t, 1e9);
      const tops = [];
      for (const t of [0.3, 0.62]) { const x = A.x + ux * len * t, z = A.z + uz * len * t, d = deck(t);
        for (const s of [-1, 1]) addMesh(new THREE.BoxGeometry(2.5, d + 85, 3), green, x + px * s * 9, (d + 85) / 2 - 10, z + pz * s * 9);
        for (const hy of [d + 40, d + 70]) addMesh(new THREE.BoxGeometry(20, 2.2, 2.4), green, x, hy, z).rotation.y = Math.atan2(ux, uz) + Math.PI / 2;
        tops.push({ t, y: d + 72 }); }
      const hangers = [];
      for (const s of [-1, 1]) {
        const c = [[0.02, deck(0.02) + 2], [tops[0].t, tops[0].y], [0.46, deck(0.46) + 12], [tops[1].t, tops[1].y], [0.98, deck(0.98) + 2]].map(([t, y]) => new THREE.Vector3(A.x + ux * len * t + px * s * 9, y, A.z + uz * len * t + pz * s * 9));
        const curve = new THREE.CatmullRomCurve3(c); addMesh(new THREE.TubeGeometry(curve, 160, 0.45, 6), std('#5b6b62', { metalness: 0.6 }));
        for (let u = 0.03; u < 0.97; u += 0.006) { const q = curve.getPointAt(u); const t = ((q.x - A.x) * ux + (q.z - A.z) * uz) / len; const dy = deck(clamp(t, 0, 1)) + 1; if (q.y - dy > 1.5) hangers.push(q.x, q.y, q.z, q.x, dy, q.z); }
      }
      const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(hangers, 3));
      scene.add(new THREE.LineSegments(hg, new THREE.LineBasicMaterial({ color: 0x55665c })));
      SPOTS.lionsgate = { id: 'lionsgate', name: 'Lions Gate Bridge', x: A.x + ux * len * 0.46, z: A.z + uz * len * 0.46, y: deck(0.46) };
      // the two concrete lion statues guarding the Stanley Park (south) end of the bridge
      const hw = Math.max(...lg.map(r => r.w)) / 2, stone = std('#cfc8b8', { roughness: 0.85 }), dark = std('#a39b88', { roughness: 0.9 });
      for (const s of [-1, 1]) {
        const x = B.x + ux * 6 + px * s * (hw + 3.2), z = B.z + uz * 6 + pz * s * (hw + 3.2), y = surfaceY(x, z, 1e9), g = new THREE.Group();
        addMesh(new THREE.BoxGeometry(2.2, 1.8, 4.2), dark, 0, 0.9, 0, g);   // pedestal
        addMesh(new THREE.BoxGeometry(1.5, 0.9, 2.6), stone, 0, 2.25, 0.3, g);   // lying body
        addMesh(new THREE.SphereGeometry(0.85, 10, 8).scale(1, 1.05, 0.9), stone, 0, 3.0, -1.15, g);   // maned head
        addMesh(new THREE.BoxGeometry(0.62, 0.45, 0.6), stone, 0, 2.85, -1.85, g);   // muzzle
        for (const p of [-0.42, 0.42]) addMesh(new THREE.BoxGeometry(0.38, 0.3, 1.3), stone, p, 1.95, -1.6, g);   // front paws
        addMesh(new THREE.CylinderGeometry(0.1, 0.12, 1.6, 6).rotateX(Math.PI / 2), stone, 0.55, 1.95, 1.9, g);   // tail
        g.position.set(x, y, z); g.rotation.y = Math.atan2(ux, uz); scene.add(g);   // facing the bridge
      }    } }

  // Dude Chilling Park (Guelph Park, Mount Pleasant) - the famous joke sign
  { const p = spot('dude', 'Dude Chilling Park', 49.2636, -123.0957); const g = new THREE.Group(), wood = std('#6b4a2b');
    for (const s of [-1, 1]) addMesh(new THREE.BoxGeometry(0.25, 2.6, 0.25), wood, s * 2.1, 1.3, 0, g);
    const sign = textPlane('DUDE CHILLING\nPARK', 4.6, 1.6, '#2f5a3a', '#f3ead2', 'bold 120px Georgia, serif'); sign.position.y = 2.1; g.add(sign);
    const bench = new THREE.Group(); bench.position.set(0, 0, 4); g.add(bench);
    addMesh(new THREE.BoxGeometry(2.2, 0.12, 0.5), wood, 0, 0.5, 0, bench); addMesh(new THREE.BoxGeometry(2.2, 0.5, 0.08), wood, 0, 0.85, 0.24, bench);
    for (const s of [-1, 1]) addMesh(new THREE.BoxGeometry(0.1, 0.5, 0.45), std('#333'), s, 0.25, 0, bench);
    const rf = new THREE.Group(); rf.position.set(6, 0, 1); g.add(rf);
    addMesh(new THREE.CapsuleGeometry(0.6, 3, 6, 10).rotateZ(Math.PI / 2), bronze, 0, 0.7, 0, rf); addMesh(new THREE.SphereGeometry(0.5, 10, 8), bronze, 2.2, 1.3, 0, rf);
    place(g, p, 0.3); SPOTS.dude.bench = { x: p.x + Math.sin(0.3) * 4, z: p.z + Math.cos(0.3) * 4 }; }

  // Granville Island: the painted "Giants" silos + market sign
  { const p = spot('giants', 'Granville Island Giants', 49.2713, -123.1360); const g = new THREE.Group();
    const cols = ['#e94f37', '#f6c445', '#3f88c5', '#44bba4', '#a23b72', '#f18f01'];
    for (let i = 0; i < 6; i++) {
      const tex = canvasTex(256, 512, (c, w, h) => { c.fillStyle = cols[i]; c.fillRect(0, 0, w, h); for (let k = 0; k < 40; k++) { c.fillStyle = cols[(i + k) % 6]; c.fillRect(Math.random() * w, Math.random() * h, 20 + Math.random() * 60, 10 + Math.random() * 40); } c.fillStyle = '#f1c9a5'; c.beginPath(); c.arc(w / 2, h * 0.25, 60, 0, 7); c.fill(); c.fillStyle = '#111'; c.fillRect(w / 2 - 30, h * 0.22, 12, 12); c.fillRect(w / 2 + 18, h * 0.22, 12, 12); }, false);
      addMesh(new THREE.CylinderGeometry(4, 4, 22, 20), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }), (i % 3) * 8.5, 11, Math.floor(i / 3) * 8.5, g);
    }
    place(g, p); const ms = spot('market', 'Granville Island Public Market', 49.2712, -123.1340);
    const sign = textPlane('PUBLIC MARKET', 12, 2, '#b3261e', '#fff', 'bold 110px Arial', '#f6c445'); sign.position.set(ms.x, ms.y + 9, ms.z); scene.add(sign); }

  // Kits beach + pool, Second Beach
  spot('kits', 'Kitsilano Beach', 49.2745, -123.1540);
  spot('englishbay', 'English Bay Beach', 49.2866, -123.1428);
  { const p = spot('beachlogs', 'Kits Beach logs', 49.2753, -123.1545);
    for (let i = 0; i < 16; i++) { const x = p.x + R(-60, 60), z = p.z + R(-12, 12); if (isWater(x, z)) continue; addMesh(new THREE.CylinderGeometry(0.4, 0.45, R(6, 12), 8).rotateZ(Math.PI / 2), std('#8a6f55'), x, heightAt(x, z) + 0.35, z).rotation.y = R(-0.4, 0.4); } }

  // Playland / PNE: Ferris wheel, wooden roller coaster, Fright Nights sign
  { const p = spot('playland', 'Playland (Fright Nights!)', 49.2826, -123.0378); const g = new THREE.Group();
    const wheel = new THREE.Group(); wheel.position.set(0, 22, 0); g.add(wheel);
    addMesh(new THREE.TorusGeometry(18, 0.4, 6, 48), std('#e2e8f0', { metalness: 0.6 }), 0, 0, 0, wheel);
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; addMesh(new THREE.BoxGeometry(0.25, 18, 0.25), std('#e2e8f0'), Math.cos(a) * 9, Math.sin(a) * 9, 0, wheel).rotation.z = a + Math.PI / 2;
      addMesh(new THREE.BoxGeometry(2, 1.8, 1.6), std(['#e53e3e', '#f6e05e', '#38b2ac', '#805ad5'][i % 4]), Math.cos(a) * 18, Math.sin(a) * 18 - 1.4, 0, wheel); }
    for (const s of [-1, 1]) addMesh(new THREE.BoxGeometry(0.8, 24, 0.8), std('#bbb'), s * 4, 11, 2, g).rotation.z = s * 0.2;
    animated.push(dt => { wheel.rotation.z += dt * 0.12; });
    const cs = new THREE.Group(); cs.position.set(50, 0, 0); g.add(cs); const wd = std('#d8c7a3');
    for (let i = 0; i < 40; i++) { const x = (i % 20) * 4 - 40, h = 8 + Math.sin(i * 0.7) * 6 + (i < 20 ? 6 : 0), z = i < 20 ? -10 : 10; addMesh(new THREE.BoxGeometry(0.4, h, 0.4), wd, x, h / 2, z, cs); addMesh(new THREE.BoxGeometry(4.2, 0.4, 2.4), wd, x, h, z, cs); }
    const sign = textPlane('FRIGHT NIGHTS', 22, 4, '#1a0d1f', '#ff7a1a', 'bold 150px Impact, sans-serif', '#7cfc00'); sign.position.set(0, 9, 30); g.add(sign);
    place(g, p); }

  // Grouse Mountain: chalet, wind turbine "Eye of the Wind", ski lift, grizzly habitat
  { const p = spot('grouse', 'Grouse Mountain Peak Chalet', 49.3785, -123.0815); const g = new THREE.Group();
    addMesh(new THREE.BoxGeometry(34, 10, 20), std('#6b4a32'), 0, 5, 0, g); addMesh(new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4).scale(36, 8, 23), std('#3d2b1f', { flatShading: true }), 0, 14, 0, g);
    place(g, p); }
  { const p = spot('eyewind', 'Eye of the Wind turbine', 49.3797, -123.0820); const g = new THREE.Group();
    addMesh(new THREE.CylinderGeometry(1.4, 2.2, 65, 12), white, 0, 32.5, 0, g); addMesh(new THREE.BoxGeometry(4, 4, 7), white, 0, 66, 0, g);
    const blades = new THREE.Group(); blades.position.set(0, 66, -4); g.add(blades);
    for (let i = 0; i < 3; i++) addMesh(new THREE.BoxGeometry(1.4, 18, 0.3).translate(0, 9, 0), white, 0, 0, 0, blades).rotation.z = i * Math.PI * 2 / 3;
    animated.push(dt => { blades.rotation.z += dt * 1.2; }); place(g, p); }
  buildLandmarks2();
  spot('seymour', 'Mount Seymour ski area', 49.3672, -122.9480); spot('cypress', 'Cypress Mountain ski area', 49.3960, -123.2040);
  // (The Lions themselves are real terrain now: terrain.js draws that area at full detail from everywhere.)
  // Cleveland Dam: concrete gravity dam (~91 m high, ~195 m crest) at the south end of Capilano Lake, with a gated spillway
  { const lake = lakes.find(l => /Capilano/.test(l.name || ''));
    if (lake) {
      let tip = null; for (let i = 0; i < lake.p.length; i += 2) if (!tip || lake.p[i + 1] > tip[1]) tip = [lake.p[i], lake.p[i + 1]];
      const crestY = lake.y + 4, zA = tip[1] + 2;
      // find the canyon walls along the dam axis (east-west)
      let xw = tip[0], xe = tip[0];
      while (xw > tip[0] - 160 && heightAt(xw, zA) < crestY) xw -= 2;
      while (xe < tip[0] + 160 && heightAt(xe, zA) < crestY) xe += 2;
      xw -= 6; xe += 6;
      const L = xe - xw, cxm = (xw + xe) / 2, baseY = Math.min(heightAt(cxm, zA + 60), crestY - 60) - 4, H = crestY - baseY;
      const concTex = canvasTex(256, 256, (c, w, h) => { c.fillStyle = '#bdb8ad'; c.fillRect(0, 0, w, h); for (let i = 0; i < 1800; i++) { c.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.07})`; c.fillRect(Math.random() * w, Math.random() * h, 3, 3); } c.fillStyle = 'rgba(0,0,0,.12)'; for (let y = 0; y < h; y += 32) c.fillRect(0, y, w, 2); for (let i = 0; i < 6; i++) { c.fillStyle = 'rgba(60,50,40,.08)'; c.fillRect(Math.random() * w, 0, 10 + Math.random() * 20, h); } });
      concTex.repeat.set(L / 20, H / 20);
      const conc = new THREE.MeshStandardMaterial({ map: concTex, color: '#8f8a82', roughness: 0.92 });   // weathered grey concrete
      // cross-section: vertical upstream face, 7 m crest, downstream face sloping 0.78 : 1
      const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(0, H); sh.lineTo(7, H); sh.lineTo(7 + H * 0.78, 0); sh.closePath();
      const geo = new THREE.ExtrudeGeometry(sh, { depth: L, bevelEnabled: false });   // shape x = downstream (south), y = up, extruded along +z
      geo.rotateY(-Math.PI / 2);   // extrusion axis -> along x (east-west), downstream -> +z (south)
      const dam = new THREE.Mesh(geo, conc); dam.position.set(xe, baseY, zA); dam.castShadow = true; dam.receiveShadow = true; scene.add(dam);
      // crest road + railings + lamps
      const g = new THREE.Group(); g.position.set(0, 0, 0); scene.add(g);
      addMesh(new THREE.BoxGeometry(L, 0.3, 6), std('#55585c'), cxm, crestY + 0.15, zA + 3.5, g);
      for (const zz of [zA + 0.4, zA + 6.6]) addMesh(new THREE.BoxGeometry(L, 1.0, 0.25), std('#d9d5cc'), cxm, crestY + 0.8, zz, g);
      for (let x = xw + 10; x < xe; x += 25) addMesh(new THREE.CylinderGeometry(0.08, 0.1, 4.5, 6), std('#3d4247', { metalness: 0.6 }), x, crestY + 2.4, zA + 6.6, g);
      // spillway: three radial gates between piers in the middle, white water down the chute
      const sw = 42, sx0 = cxm - sw / 2;
      for (let i = 0; i <= 3; i++) addMesh(new THREE.BoxGeometry(3, 9, 12), conc, sx0 + i * (sw / 3), crestY + 3, zA + 4, g);
      for (let i = 0; i < 3; i++) addMesh(new THREE.BoxGeometry(sw / 3 - 3, 6, 0.6), std('#5c6670', { metalness: 0.7, roughness: 0.4 }), sx0 + (i + 0.5) * (sw / 3), crestY + 1.5, zA + 1.5, g);
      addMesh(new THREE.BoxGeometry(sw + 3, 1.2, 12), conc, cxm, crestY + 7.6, zA + 4, g);   // walkway over the gates
      const foam = canvasTex(128, 256, (c, w, h) => { c.fillStyle = '#e8f1f4'; c.fillRect(0, 0, w, h); for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(${120 + Math.random() * 60},${160 + Math.random() * 60},${180 + Math.random() * 50},${0.25 + Math.random() * 0.4})`; c.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 8 + Math.random() * 30); } });
      foam.repeat.set(3, 4);
      const chuteLen = Math.hypot(H * 0.78, H), chute = new THREE.Mesh(new THREE.PlaneGeometry(sw - 2, chuteLen), new THREE.MeshStandardMaterial({ map: foam, roughness: 0.3, transparent: true, opacity: 0.92, emissive: '#26363d' }));
      chute.position.set(cxm, baseY + H / 2 + 0.6, zA + 7 + H * 0.39 + 0.5); chute.rotation.x = -Math.atan2(H * 0.78, H); scene.add(chute);
      const spray = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8).scale(sw * 0.7, 6, 14), new THREE.MeshBasicMaterial({ color: '#eef6f8', transparent: true, opacity: 0.35, depthWrite: false }));
      spray.position.set(cxm, baseY + 4, zA + 7 + H * 0.78 + 4); scene.add(spray);
      animated.push(() => { foam.offset.y = -(G.t * 0.9) % 1; spray.material.opacity = 0.28 + Math.sin(G.t * 3) * 0.06; });
      spot('clevelanddam', 'Cleveland Dam', 49.3617, -123.1108); Object.assign(SPOTS.clevelanddam, { x: cxm, z: zA + 3, y: crestY });
    } }
  spot('westlion', 'The West Lion', 49.4575, -123.1875);
  { const p = SPOTS.westlion; const top = at(49.4577, -123.1864); p.x = top.x; p.z = top.z; p.y = top.y; addMesh(new THREE.CylinderGeometry(0.06, 0.06, 4), std('#ddd'), p.x, p.y + 2, p.z); addMesh(new THREE.BoxGeometry(1.8, 0.9, 0.05), std('#d52b1e'), p.x + 0.9, p.y + 3.5, p.z); }

  // Deep Cove: doughnut shop + kayaks; Capilano suspension bridge
  { const p = spot('deepcove', 'Deep Cove (honey doughnuts!)', 49.3290, -122.9490); const g = new THREE.Group();
    addMesh(new THREE.BoxGeometry(9, 5, 7), std('#f0d9a8'), 0, 2.5, 0, g); addMesh(new THREE.TorusGeometry(1.6, 0.6, 10, 24), std('#d9a441'), 0, 6.5, 3.6, g);
    place(g, p); }
  { const a = at(49.3428, -123.1153), b = at(49.3433, -123.1135), g = new THREE.Group();
    const len = Math.hypot(b.x - a.x, b.z - a.z), y = Math.max(a.y, b.y) + 2;
    addMesh(new THREE.BoxGeometry(1.4, 0.15, len), std('#8a6f55'), 0, 0, 0, g);
    for (const s of [-1, 1]) addMesh(new THREE.BoxGeometry(0.06, 1.1, len), std('#555'), s * 0.75, 0.55, 0, g);
    g.position.set((a.x + b.x) / 2, y - 6, (a.z + b.z) / 2); g.rotation.y = Math.atan2(b.x - a.x, b.z - a.z); scene.add(g);
    SPOTS.capilano = { id: 'capilano', name: 'Capilano Suspension Bridge', x: g.position.x, z: g.position.z, y: g.position.y, deck: { a, b, y: y - 6 } };
    animated.push(dt => { g.rotation.z = Math.sin(G.t * 1.3) * 0.03; }); }
}

// ---------- Stage 2: Sea-to-Sky, Squamish, Whistler ----------
function waterfall(lat, lon, w, h, name, id) {
  const p = spot(id, name, lat, lon);
  const tex = canvasTex(64, 256, (c, W, H) => { c.fillStyle = 'rgba(255,255,255,0.0)'; c.clearRect(0, 0, W, H); for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.6})`; c.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 4, 10 + Math.random() * 40); } });
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.position.set(p.x, p.y + h / 2, p.z); scene.add(m);
  const mist = addMesh(new THREE.SphereGeometry(w * 0.6, 12, 8), new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.25, depthWrite: false }), p.x, p.y + 2, p.z, scene, false);
  animated.push(dt => { tex.offset.y += dt * 1.2; m.lookAt(camera.position.x, m.position.y, camera.position.z); mist.scale.setScalar(1 + Math.sin(G.t * 3) * 0.05); });
}
function buildLandmarks2() {
  const white = std('#f3f1ec', { roughness: 0.45 }), stone = std('#8f8d88', { flatShading: true });
  // Stawamus Chief summit + trailhead
  const chief = spot('chief', 'Stawamus Chief summit', 49.6825, -123.1366);
  addMesh(new THREE.CylinderGeometry(0.06, 0.06, 3), std('#ddd'), chief.x, chief.y + 1.5, chief.z); addMesh(new THREE.BoxGeometry(1.6, 0.8, 0.05), std('#2f855a'), chief.x + 0.8, chief.y + 2.6, chief.z);
  { const p = spot('chiefbase', 'Stawamus Chief trailhead', 49.6770, -123.1545); const s = textPlane('STAWAMUS CHIEF\nTRAIL', 4, 1.8, '#5a3d22', '#f3ead2', 'bold 90px Georgia'); s.position.set(p.x, p.y + 1.8, p.z); scene.add(s); }
  waterfall(49.6705, -123.1580, 14, 90, 'Shannon Falls', 'shannon');
  waterfall(49.9637, -123.1255, 10, 70, 'Brandywine Falls', 'brandywine');
  // Britannia Mine: stepped mill building + giant haul truck
  { const p = spot('britannia', 'Britannia Mine Museum', 49.6195, -123.2034); const g = new THREE.Group(), wood = std('#6b5a48'), roof = std('#5a5f63');
    for (let i = 0; i < 6; i++) { addMesh(new THREE.BoxGeometry(30, 10, 14), wood, 0, i * 8 + 5, -i * 10, g); addMesh(new THREE.BoxGeometry(31, 1, 15), roof, 0, i * 8 + 10.5, -i * 10, g); }
    const truck = new THREE.Group(); truck.position.set(30, 0, 10); g.add(truck);
    addMesh(new THREE.BoxGeometry(7, 4, 10), std('#f2c230'), 0, 4, 0, truck); for (const [x, z] of [[-3.5, -3], [3.5, -3], [-3.5, 3], [3.5, 3]]) addMesh(new THREE.CylinderGeometry(1.8, 1.8, 1.2, 16).rotateZ(Math.PI / 2), std('#111'), x, 1.8, z, truck);
    place(g, p, 1.2); }
  // Horseshoe Bay ferry
  { const [fx, fz] = toXZ(49.3740, -123.2745); const g = new THREE.Group();
    addMesh(new THREE.BoxGeometry(24, 8, 130), white, 0, 3, 0, g); addMesh(new THREE.BoxGeometry(24.2, 2, 130.2), std('#1d3557'), 0, -0.5, 0, g);
    addMesh(new THREE.BoxGeometry(20, 8, 80), white, 0, 11, 5, g); addMesh(new THREE.BoxGeometry(20.1, 1.5, 80.1), std('#1d3557'), 0, 9, 5, g);
    addMesh(new THREE.CylinderGeometry(2, 2.5, 7), std('#c53030'), 0, 18, 15, g);
    const sign = textPlane('BC FAIRIES', 18, 3, '#1d3557', '#fff', 'bold 130px Arial', '#1d3557'); sign.position.set(12.2, 11, 5); sign.rotation.y = Math.PI / 2; g.add(sign);
    g.position.set(fx, -0.5, fz); g.rotation.y = 0.6; scene.add(g); SPOTS.ferry = { id: 'ferry', name: 'Horseshoe Bay ferry', x: fx, z: fz, y: 0 }; animated.push(() => { g.position.y = -0.5 + Math.sin(G.t * 0.6) * 0.15; }); }
  // Porteau Cove pier
  { const p = spot('porteau', 'Porteau Cove', 49.5578, -123.2370); addMesh(new THREE.BoxGeometry(5, 1, 70), std('#8a7a66'), p.x - 40, 2, p.z); }
  // Squamish Spit kite surfers
  { const p = spot('spit', 'Squamish Spit kiters', 49.6950, -123.1735); const cols = ['#e53e3e', '#f6e05e', '#38b2ac', '#805ad5', '#dd6b20'];
    for (let i = 0; i < 6; i++) {
      const k = new THREE.Group(); scene.add(k);
      addMesh(new THREE.TorusGeometry(5, 0.8, 4, 16, Math.PI).scale(1, 0.5, 0.3), std(cols[i % 5], { side: THREE.DoubleSide }), 0, 22, 0, k, false);
      addMesh(new THREE.BoxGeometry(0.5, 0.1, 1.5), std('#222'), 0, 0.2, 0, k);
      const ph = i * 1.3; animated.push(() => { const a = G.t * 0.15 + ph; k.position.set(p.x - 250 + Math.cos(a) * 180, Math.sin(G.t * 2 + i) * 0.2, p.z - 300 + Math.sin(a * 1.3) * 250); k.rotation.y = a; });
    } }
  // Whistler: Olympic rings, village sign, Ilanaaq inukshuk on Whistler Peak
  { const p = spot('rings', 'Whistler Olympic Rings', 50.1150, -122.9548); const g = new THREE.Group(), cols = ['#0085c7', '#000000', '#df0024', '#f4c300', '#009f3d'];
    cols.forEach((c, i) => addMesh(new THREE.TorusGeometry(2.2, 0.28, 10, 32), std(c, { metalness: 0.4, roughness: 0.4 }), (i - 2) * 2.6, i % 2 ? 4.2 : 5.6, 0, g));
    addMesh(new THREE.BoxGeometry(14, 1.2, 1.5), std('#5a4a3a'), 0, 0.6, 0, g); place(g, p, 0.4); }
  { const p = spot('whistlervillage', 'Whistler Village', 50.1160, -122.9535); const s = textPlane('WHISTLER\nVILLAGE', 6, 2.6, '#2f5a3a', '#f3ead2', 'bold 110px Georgia'); s.position.set(p.x + 20, p.y + 2.5, p.z + 20); scene.add(s); }
  { const p = spot('ilanaaq', 'Ilanaaq Inukshuk (Whistler Peak)', 50.0640, -122.9465); const g = new THREE.Group();
    for (const [w, h, d, x, y] of [[2.4, 5, 2.4, -2.4, 2.5], [2.4, 5, 2.4, 2.4, 2.5], [8, 2, 2.6, 0, 6], [3, 3, 2.4, 0, 8.5], [12, 1.6, 2.4, 0, 10.8], [2.2, 2, 2.2, 0, 12.6]]) addMesh(new THREE.BoxGeometry(w, h, d), stone, x, y, 0, g);
    place(g, p, 0.3); }
  spot('greenlake', 'Green Lake', 50.1435, -122.9500);
  // North Shore: Lynn Canyon suspension bridge (free, and wobblier than Capilano), Quarry Rock lookout
  { const a = at(49.3433, -123.0196), b = at(49.3439, -123.0186), g = new THREE.Group();
    const len = Math.hypot(b.x - a.x, b.z - a.z), y = Math.max(a.y, b.y);
    addMesh(new THREE.BoxGeometry(1.2, 0.15, len), std('#8a6f55'), 0, 0, 0, g);
    for (const s of [-1, 1]) addMesh(new THREE.BoxGeometry(0.06, 1.1, len), std('#555'), s * 0.65, 0.55, 0, g);
    g.position.set((a.x + b.x) / 2, y - 5, (a.z + b.z) / 2); g.rotation.y = Math.atan2(b.x - a.x, b.z - a.z); scene.add(g);
    SPOTS.lynncanyon = { id: 'lynncanyon', name: 'Lynn Canyon Suspension Bridge', x: g.position.x, z: g.position.z, y: g.position.y };
    animated.push(() => { g.rotation.z = Math.sin(G.t * 1.7) * 0.04; }); }
  { const p = spot('quarryrock', 'Quarry Rock lookout', 49.3346, -122.9481);
    addMesh(new THREE.DodecahedronGeometry(3.5), std('#8f8d88', { flatShading: true }), p.x, p.y - 1, p.z);
    const s = textPlane('QUARRY ROCK', 3.2, 1.1, '#5a3d22', '#f3ead2', 'bold 90px Georgia'); s.position.set(p.x + 4, p.y + 1.6, p.z); scene.add(s); } spot('altalake', 'Alta Lake', 50.1100, -122.9810);
  spot('roundhouse', 'Roundhouse Lodge', 50.0640, -122.9480); spot('brackendale', 'Brackendale eagles', 49.7740, -123.1500);
}

function skiLift(lat0, lon0, lat1, lon1) {
  const a = at(lat0, lon0), b = at(lat1, lon1), n = 6, pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = heightAt(x, z); addMesh(new THREE.CylinderGeometry(0.4, 0.5, 12), std('#666'), x, y + 6, z); pts.push(new THREE.Vector3(x, y + 11.5, z)); }
  const geo = new THREE.BufferGeometry().setFromPoints(pts); scene.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x222222 })));
  const chairs = [];
  for (let i = 0; i < 10; i++) { const c = addMesh(new THREE.BoxGeometry(1.6, 0.8, 0.8), std('#d62828'), 0, 0, 0); c.userData.u = i / 10; chairs.push(c); }
  const curve = new THREE.CatmullRomCurve3(pts);
  animated.push(dt => { for (const c of chairs) { c.userData.u = (c.userData.u + dt * 0.01) % 1; const q = curve.getPointAt(c.userData.u); c.position.set(q.x, q.y - 1.8, q.z); } });
}

export function updateLandmarks(dt) {
  for (const f of animated) f(dt);
  const sc = SPOTS.steamclock; if (sc?.steam) for (const s of sc.steam) { s.userData.ph = (s.userData.ph + dt * 0.35) % 1; const t = s.userData.ph; s.position.y = sc.y + 7.3 + t * 5; s.scale.setScalar(0.6 + t * 2.4); s.material.opacity = 0.55 * (1 - t); }
  const cd = SPOTS.cauldron; if (cd?.flame) { cd.flame.visible = cd.lit || G.night > 0.6; cd.flame.scale.y = 1 + Math.sin(G.t * 9) * 0.12; }
}
