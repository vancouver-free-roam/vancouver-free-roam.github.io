// Night lights: street lamps along the real streets near the player (instanced), real light pools under the
// closest lamps, a warm glow on road surfaces at night, and headlights on the vehicle you drive (L toggles).
import * as THREE from 'three';
import { G, scene, std, tapped } from './core.js';
import { isWater } from './terrain.js';
import { roadGrid, NX, NZ, nodeY, surfaceY, walkY, buildingAt, setRoadGlow } from './city.js';
import { setCarLights } from './vehicles.js';
import { setColliders, fromInstances, blockedAt } from './colliders.js';
import { ui } from './ui.js';
import { bake } from './tint.js';

const M = window.MAP;
const CAP = 3000, RAD = 450, SPACING = 38, POOL = 8;
export const LIGHT = { pool: 160, head: 1100 };   // light strengths (this game's lighting scale)
let HEAD_I = LIGHT.head;
// Realism pass 3: a tapered galvanised pole on a base, a curved "davit" arm and a cobra-head luminaire (the glowing part is
// only the glass lens underneath)
const poleM = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, metalness: 0.55, roughness: 0.42 });
const headM = new THREE.MeshStandardMaterial({ color: '#fff8e8', emissive: '#ffd28a', emissiveIntensity: 0.1, roughness: 0.2 });
const mk = (geo, mat) => { const m = new THREE.InstancedMesh(geo, mat, CAP); m.count = 0; m.frustumCulled = false; m.castShadow = false; scene.add(m); return m; };
const GV = '#8a9096';
const poles = mk(bake([[new THREE.CylinderGeometry(0.07, 0.12, 6.6, 12).translate(0, 3.5, 0), GV], [new THREE.CylinderGeometry(0.17, 0.2, 0.45, 12).translate(0, 0.22, 0), '#7c8288'], [new THREE.CylinderGeometry(0.25, 0.25, 0.04, 12).translate(0, 0.02, 0), '#70767c'], [new THREE.CylinderGeometry(0.13, 0.13, 0.08, 12).translate(0, 0.48, 0), '#7c8288']], 0.05), poleM);
const davit = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 6.6, 0), new THREE.Vector3(0.05, 7.0, 0), new THREE.Vector3(0.35, 7.2, 0), new THREE.Vector3(1.0, 7.15, 0), new THREE.Vector3(1.3, 7.05, 0)]), 12, 0.05, 8);
const arms = mk(bake([[davit, GV], [new THREE.SphereGeometry(0.22, 14, 8).scale(1.75, 0.42, 0.85).translate(1.5, 6.98, 0), '#9aa0a4'], [new THREE.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.7, 0.3, 0.8).translate(1.5, 7.0, 0), '#b0b4b6']], 0.04), poleM);
const heads = mk(new THREE.SphereGeometry(0.16, 14, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(1.7, 0.35, 0.8).translate(1.52, 6.93, 0), headM);
// pole banners: a fabric panel on two little arms, on the road side of the pole (local +x = toward the road)
const banners = mk(new THREE.BoxGeometry(0.62, 1.3, 0.02).translate(0.42, 4.6, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, side: THREE.DoubleSide }));
banners.castShadow = true; banners.setColorAt(0, new THREE.Color());
const _bc = new THREE.Color();
const BANNER = [['#c53030', '#f6f6f6'], ['#2b6cb0', '#f6e05e'], ['#2f855a', '#f6f6f6', '#c53030'], ['#805ad5', '#ed64a6'], ['#dd6b20', '#1a1a1a'], ['#319795', '#f6f6f6']];
const lamps = [];   // {hx, hy, hz} head positions (for the light pool)
let cx = 1e9, cz = 1e9;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0), _near = [];

function rebuild(px, pz) {
  cx = px; cz = pz; lamps.length = 0; let n = 0, nb = 0;
  for (const e of roadGrid.near(px, pz, RAD, _near)) {
    const r = M.roads[e.r]; if (r.t > 5 || n >= CAP) continue;
    const ax = NX(e.a), az = NZ(e.a), dx = NX(e.b) - ax, dz = NZ(e.b) - az, L = Math.hypot(dx, dz); if (L < 12) continue;
    const ux = dx / L, uz = dz / L, off = r.w / 2 + 1.3;
    for (let k = 0, s = 12 + (e.id % 3) * 8; s < L - 4 && n < CAP; k++, s += SPACING) {
      const side = (k + e.id) % 2 ? 1 : -1, nx = -uz * side, nz = ux * side;
      const x = ax + ux * s + nx * off, z = az + uz * s + nz * off;
      if (Math.hypot(x - px, z - pz) > RAD || isWater(x, z) || buildingAt(x, z) || blockedAt(x, z, 0.4, 'lampposts')) continue;   // not inside a tree / bench / hydrant
      const ny = nodeY[e.a] + (nodeY[e.b] - nodeY[e.a]) * (s / L), y = walkY(x, z, ny + 2);
      const yaw = Math.atan2(nz, -nx);   // the arm (local +x) points back toward the road
      _q.setFromAxisAngle(_up, yaw); _p.set(x, y, z); _m.compose(_p, _q, _s);
      poles.setMatrixAt(n, _m); arms.setMatrixAt(n, _m); heads.setMatrixAt(n, _m);
      // main streets: a neighbourhood banner on each pole (colours pick a theme per street), hanging toward the road
      if (r.t <= 4 && nb < CAP) { banners.setMatrixAt(nb, _m); const th = BANNER[(e.r * 7) % BANNER.length]; banners.setColorAt(nb, _bc.set(th[k % th.length])); nb++; }
      lamps.push({ x: x - nx * 1.5, y: y + 6.85, z: z - nz * 1.5 }); n++;
    }
  }
  for (const m of [poles, arms, heads]) { m.count = n; m.instanceMatrix.needsUpdate = true; }
  banners.count = nb; banners.instanceMatrix.needsUpdate = true; if (banners.instanceColor) banners.instanceColor.needsUpdate = true;
  setColliders('lampposts', fromInstances(poles, 0.15, 7, [], { brk: 11, kind: 'tip', parts: [arms, heads] }));
}

// real lights under the nearest few lamps (a fixed number, so shaders never recompile)
const pool = [];
for (let i = 0; i < POOL; i++) { const l = new THREE.PointLight('#ffcf8a', 0, 30, 2); scene.add(l); pool.push(l); }
let poolT = 0;
function updatePool(px, pz, night) {
  poolT -= G.dt; if (poolT > 0) { for (const l of pool) l.intensity = l.userData.on ? night * LIGHT.pool : 0; return; }
  poolT = 0.25;
  const best = lamps.map(l => [Math.hypot(l.x - px, l.z - pz), l]).sort((a, b) => a[0] - b[0]).slice(0, POOL);
  pool.forEach((l, i) => { const b = best[i]; l.userData.on = !!b && night > 0.05; if (b) l.position.set(b[1].x, b[1].y - 0.3, b[1].z); l.intensity = l.userData.on ? night * LIGHT.pool : 0; });
}

// headlights on the player's vehicle
const head = new THREE.SpotLight('#fff4e0', 0, 110, 0.55, 0.55, 1.4); scene.add(head); scene.add(head.target);
let mode = 'auto';   // auto (on at night) | on | off
export function updateNightLights(pl) {
  const night = G.night || 0;
  if (Math.hypot(pl.x - cx, pl.z - cz) > 120) rebuild(pl.x, pl.z);
  headM.emissiveIntensity = 0.1 + night * 3;
  updatePool(pl.x, pl.z, night);
  setRoadGlow(night);
  setCarLights(night);
  const v = pl.vehicle;
  if (v && tapped('KeyL')) { mode = mode === 'auto' ? (night > 0.35 ? 'off' : 'on') : mode === 'on' ? 'off' : 'on'; ui.toast(mode === 'on' ? '💡 Headlights ON' : '🌑 Headlights OFF', 'Press L to switch', 1500); }
  const on = v && (mode === 'on' || (mode === 'auto' && (night > 0.35 || (G.fogW || 0) > 0.5)));
  if (on) {
    const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw), f = (v.d.len || 4) / 2;
    head.position.set(v.x + fx * f, v.y + 1.0, v.z + fz * f);
    head.target.position.set(v.x + fx * (f + 30), v.y - 1.5, v.z + fz * (f + 30));
    head.intensity = LIGHT.head;
  } else head.intensity = 0;
}
