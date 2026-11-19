// The waterfront: Vancouver's seawall (granite block walls + cap stones along the city's shore, a dark wet band with
// seaweed at the waterline, foam washing against the wall) and life on the water near the shore (kayakers, stand-up
// paddleboarders, little sailing dinghies with their sails up). Rebuilt around you as you move.
import * as THREE from 'three';
import { G, scene, std, canvasTex, pick, R } from './core.js';
import { groundY, isWater, WATER_T, townDensity, CITY } from './terrain.js';
import { Crowd, newLook } from './people.js';

const M = window.MAP, RAD = 650;
// ---------- seawall ----------
const stoneTex = canvasTex(256, 256, (c, w, h) => {
  c.fillStyle = '#8f8c86'; c.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 32) for (let x = (y / 32) % 2 ? -40 : 0; x < w; x += 80) { const v = 120 + Math.random() * 40; c.fillStyle = `rgb(${v},${v * 0.98},${v * 0.94})`; c.fillRect(x + 2, y + 2, 76, 28); }
  for (let i = 0; i < 1500; i++) { c.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`; c.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
});
const wallMat = new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.9 });
wallMat.onBeforeCompile = sh => {   // wet, dark and green below the high-tide line
  sh.vertexShader = 'varying float vWy;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vWy = (modelMatrix * vec4(transformed, 1.0)).y;');
  sh.fragmentShader = 'varying float vWy;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.32, 0.36, 0.26), 1.0 - smoothstep(0.1, 0.9, vWy));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.55, 1.0 - smoothstep(0.9, 1.3, vWy));`);
};
const capMat = std('#b4b0a6', { roughness: 0.85 });
const foamTex = canvasTex(128, 128, (c, w, h) => { c.clearRect(0, 0, w, h); for (let i = 0; i < 260; i++) { const x = Math.random() * w, y = Math.random() * h * (0.3 + 0.7 * Math.random()), r = 2 + Math.random() * 7; const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); } });
const foamMat = new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, depthWrite: false, opacity: 0.8 });
let wallMesh = null, capMesh = null, foamMesh = null, at = null;
let beachGrid = null;
function onBeach(x, z) {
  if (!beachGrid) { beachGrid = new Map(); for (const a of M.areas) { if (a.line || (a.k !== 'beach' && a.k !== 'rock')) continue; let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let i = 0; i < a.p.length; i += 2) { x0 = Math.min(x0, a.p[i]); x1 = Math.max(x1, a.p[i]); z0 = Math.min(z0, a.p[i + 1]); z1 = Math.max(z1, a.p[i + 1]); } for (let i = Math.floor((x0 - 20) / 100); i <= Math.floor((x1 + 20) / 100); i++) for (let j = Math.floor((z0 - 20) / 100); j <= Math.floor((z1 + 20) / 100); j++) { const k = i * 100003 + j; if (!beachGrid.has(k)) beachGrid.set(k, []); beachGrid.get(k).push(a.p); } } }
  for (const p of beachGrid.get(Math.floor(x / 100) * 100003 + Math.floor(z / 100)) || []) { let c = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if (((p[i + 1] > z) !== (p[j + 1] > z)) && x < (p[j] - p[i]) * (z - p[i + 1]) / (p[j + 1] - p[i + 1]) + p[i]) c = !c; if (c) return true; }
  return false;
}
const urban = (x, z) => (x > CITY.x0 && x < CITY.x1 && z > CITY.z0 && z < CITY.z1) || townDensity(x, z) > 0.004;
function buildWall(px, pz) {
  at = [px, pz];
  for (const m of [wallMesh, capMesh, foamMesh]) if (m) { scene.remove(m); m.geometry.dispose(); }
  const W = { p: [], u: [], i: [] }, C = { p: [], u: [], i: [] }, F = { p: [], u: [], i: [] };
  const quad = (B, a, b, c, d, u0, u1, v0, v1) => { const k = B.p.length / 3; B.p.push(...a, ...b, ...c, ...d); B.u.push(u0, v0, u1, v0, u1, v1, u0, v1); B.i.push(k, k + 1, k + 2, k, k + 2, k + 3); };
  for (const line of M.coast || []) {
    for (let i = 2; i < line.length; i += 2) {
      const ax = line[i - 2], az = line[i - 1], bx = line[i], bz = line[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 0.5) continue;
      if (Math.min(Math.hypot(ax - px, az - pz), Math.hypot(bx - px, bz - pz)) > RAD) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L, n = Math.max(1, Math.ceil(L / 3));
      for (let k = 0; k < n; k++) {
        const x0 = ax + ux * L * k / n, z0 = az + uz * L * k / n, x1 = ax + ux * L * (k + 1) / n, z1 = az + uz * L * (k + 1) / n, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
        let nx = -uz, nz = ux; if (isWater(mx - nx * 4, mz - nz * 4) && !isWater(mx + nx * 4, mz + nz * 4)) { nx = -nx; nz = -nz; }   // n points to the water
        if (!isWater(mx + nx * 5, mz + nz * 5) || isWater(mx - nx * 4, mz - nz * 4)) continue;
        if (!urban(mx, mz) || onBeach(mx - nx * 3, mz - nz * 3)) continue;
        // the drawn ground often reaches a few metres past the map's coastline: slide the wall out to the real water's edge
        const edge = (x, z) => { let o = 0; while (o < 30 && groundY(x + nx * o, z + nz * o) > 0.2) o += 1.5; return o; };
        const o0 = edge(x0, z0), o1 = edge(x1, z1);
        const top = Math.max(0.95, Math.min(4.5, groundY(mx + nx * ((o0 + o1) / 2 - 2.5), mz + nz * ((o0 + o1) / 2 - 2.5)) + 0.45)), d = L / n;
        const u0 = (k * d) / 4, u1 = ((k + 1) * d) / 4;
        const X0 = x0 + nx * o0, Z0 = z0 + nz * o0, X1 = x1 + nx * o1, Z1 = z1 + nz * o1;
        quad(W, [X0, -2.5, Z0], [X1, -2.5, Z1], [X1, top, Z1], [X0, top, Z0], u0, u1, 0, (top + 2.5) / 4);
        quad(C, [X0, top + 0.12, Z0], [X1, top + 0.12, Z1], [X1 - nx * 0.7, top + 0.12, Z1 - nz * 0.7], [X0 - nx * 0.7, top + 0.12, Z0 - nz * 0.7], 0, 1, 0, 1);
        quad(C, [X0 + nx * 0.05, top - 0.15, Z0 + nz * 0.05], [X1 + nx * 0.05, top - 0.15, Z1 + nz * 0.05], [X1 + nx * 0.05, top + 0.12, Z1 + nz * 0.05], [X0 + nx * 0.05, top + 0.12, Z0 + nz * 0.05], 0, 1, 0, 1);
        quad(F, [X0 + nx * 0.05, 0.04, Z0 + nz * 0.05], [X1 + nx * 0.05, 0.04, Z1 + nz * 0.05], [X1 + nx * 1.6, 0.04, Z1 + nz * 1.6], [X0 + nx * 1.6, 0.04, Z0 + nz * 1.6], u0, u1, 0, 1);
      }
    }
  }
  const mesh = (B, mat, shadow) => { if (!B.p.length) return null; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(B.u, 2)); g.setIndex(B.i); g.computeVertexNormals(); const m = new THREE.Mesh(g, mat); m.castShadow = shadow; m.receiveShadow = true; scene.add(m); return m; };
  wallMat.side = capMat.side = THREE.DoubleSide;
  wallMesh = mesh(W, wallMat, true); capMesh = mesh(C, capMat, true); foamMesh = mesh(F, foamMat, false);
}

// ---------- kayaks, paddleboards and dinghies ----------
const MAXC = 14, craft = []; let crowd = null, kayakIM, supIM, dinghyIM, sailIM;
function initCraft() {
  crowd = new Crowd(MAXC);
  const mk = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, n); m.count = 0; m.frustumCulled = false; m.castShadow = true; m.setColorAt(0, new THREE.Color()); scene.add(m); return m; };
  kayakIM = mk(new THREE.SphereGeometry(1, 14, 8).scale(0.32, 0.17, 2.1), std('#ffffff', { roughness: 0.4 }), MAXC);
  supIM = mk(new THREE.BoxGeometry(0.75, 0.1, 3.2), std('#ffffff', { roughness: 0.4 }), MAXC);
  const hull = new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(0.75, 0.5, 2.1);
  dinghyIM = mk(hull, std('#f4f4f0', { roughness: 0.4 }), MAXC);
  const sail = new THREE.BufferGeometry(); sail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.4, 0.6, 0, 5.2, 0.4, 0, 0.4, 2.2, 0, 0.4, 0.6, 0, 5.2, 0.4, 0, 0.4, -1.0], 3)); sail.computeVertexNormals();
  sailIM = mk(sail, new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide, roughness: 0.8 }), MAXC);
}
function spawnCraft(px, pz) {
  for (let t = 0; t < 30; t++) {
    const a = Math.random() * 6.28, d = R(80, 900), x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
    if (!isWater(x, z)) continue;
    let shore = false; for (let b = 0; b < 6.28 && !shore; b += 0.7) if (!isWater(x + Math.cos(b) * 250, z + Math.sin(b) * 250)) shore = true; if (!shore) continue;   // stay near shore
    const kind = pick(['kayak', 'kayak', 'sup', 'sup', 'dinghy']), look = newLook(); look.coat = null; look.bag = null; look.shirt = pick(['#f6e05e', '#e53e3e', '#ed8936', '#3182ce', '#ffffff']); look.hat = Math.random() < 0.5 ? pick(['#ffffff', '#f6e05e', '#1a202c']) : null;
    return { kind, x, z, y: 0, head: Math.random() * 6.28, sp: kind === 'dinghy' ? R(2.5, 4.5) : R(0.9, 1.6), t: Math.random() * 10, col: pick(['#e53e3e', '#f6e05e', '#ed8936', '#38a169', '#3182ce', '#ffffff']), cols: look, state: 'idle', kind2: kind, visible: true, dirty: true, phase: 0, amp: 0, yaw: 0 };
  }
  return null;
}
const o = new THREE.Object3D(), col = new THREE.Color();
function updateCraft(dt, pl) {
  const ok = (G.hour ?? 12) > 7 && (G.hour ?? 12) < 20.5 && (G.wet || 0) < 0.4 && (G.season !== 'winter' || Math.random() < 0.3);
  for (let i = craft.length - 1; i >= 0; i--) if (!ok || Math.hypot(craft[i].x - pl.x, craft[i].z - pl.z) > 1300) craft.splice(i, 1);
  if (ok && craft.length < MAXC && Math.random() < dt * 2) { const c = spawnCraft(pl.x, pl.z); if (c) craft.push(c); }
  let nk = 0, ns = 0, nd = 0;
  for (const c of craft) {
    c.t += dt;
    const ax = c.x + Math.sin(c.head) * 18, az = c.z + Math.cos(c.head) * 18;
    if (!isWater(ax, az)) c.head += dt * 1.5; else c.head += Math.sin(c.t * 0.21) * dt * 0.15;   // wander, turn away from land
    c.x += Math.sin(c.head) * c.sp * dt; c.z += Math.cos(c.head) * c.sp * dt;
    const bob = Math.sin(WATER_T.value * 1.3 + c.x * 0.3) * 0.05;
    const yaw = c.head + Math.PI;   // models face -z
    o.position.set(c.x, 0.05 + bob, c.z); o.rotation.set(Math.sin(c.t * 1.7) * 0.03, c.head, c.kind === 'dinghy' ? 0.18 : Math.sin(c.t * 2) * 0.04, 'YXZ'); o.updateMatrix();
    if (c.kind === 'kayak') { kayakIM.setMatrixAt(nk, o.matrix); kayakIM.setColorAt(nk, col.set(c.col)); nk++; c.y = bob - 0.35; c.kind2 = 'sitcar'; }
    else if (c.kind === 'sup') { supIM.setMatrixAt(ns, o.matrix); supIM.setColorAt(ns, col.set(c.col)); ns++; c.y = bob + 0.1; c.kind2 = 'stand'; }
    else { dinghyIM.setMatrixAt(nd, o.matrix); sailIM.setMatrixAt(nd, o.matrix); dinghyIM.setColorAt(nd, col.set('#f4f4f0')); sailIM.setColorAt(nd, col.set(c.col === '#ffffff' ? '#ffffff' : '#f8f6ee')); nd++; c.y = bob - 0.2; c.kind2 = 'sitcar'; }
    c.yaw = yaw; c.state = 'idle'; c.kind = c.kind; c.phase += dt * 2;
  }
  kayakIM.count = nk; supIM.count = ns; dinghyIM.count = nd; sailIM.count = nd;
  for (const m of [kayakIM, supIM, dinghyIM, sailIM]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  // draw the people: the crowd poses by `kind`, so lend it the seated / standing pose for a moment
  const people = craft.map(c => ({ ...c, kind: c.kind2, slot: undefined }));
  crowd.draw(people);
}
export function updateWaterfront(dt, pl) {
  if (!crowd) initCraft();
  if (!at || Math.hypot(pl.x - at[0], pl.z - at[1]) > 220) buildWall(pl.x, pl.z);
  foamTex.offset.y = (WATER_T.value * 0.05) % 1; foamMat.opacity = 0.55 + 0.3 * Math.sin(WATER_T.value * 0.9);
  updateCraft(dt, pl);
}
export const _water = { get craft() { return craft.length; }, get wall() { return wallMesh?.geometry.attributes.position.count || 0; } };
