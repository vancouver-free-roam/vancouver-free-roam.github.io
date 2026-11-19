// Beach life on the real beaches (English Bay, Kits, Jericho, Spanish Banks, Ambleside, Wreck…): sunbathers on towels,
// striped umbrellas, people sitting and chatting, swimmers bobbing offshore, a lifeguard tower with its lifeguard on the
// bigger beaches, and volleyball nets. How busy it gets depends on the season, the time of day and the weather.
import * as THREE from 'three';
import { G, scene, std, pick, hash2 } from './core.js';
import { groundY, isWater, waterLevel } from './terrain.js';
import { Crowd, newLook } from './people.js';
import { setColliders } from './colliders.js';

const RAD = 420, CAP = 150, TCAP = 60;
const TOWEL = ['#e53e3e', '#3182ce', '#f6e05e', '#38a169', '#ed64a6', '#ffffff', '#dd6b20', '#805ad5', '#319795'];
const SWIM = ['#e53e3e', '#1a202c', '#3182ce', '#f6e05e', '#ed64a6', '#38a169', '#ffffff'];
let crowd = null, people = [], towelIM, umbIM, umbPoleIM, towerIM, crossIM, netIM;
const o = new THREE.Object3D(), col = new THREE.Color();
let at = null, lastWarm = -1, checkT = 0;
function mk(geo, mat, n, shadow = true) { const m = new THREE.InstancedMesh(geo, mat, n); m.count = 0; m.castShadow = shadow; m.receiveShadow = true; m.frustumCulled = false; scene.add(m); return m; }
function merge(parts) { const pos = []; for (const g of parts) pos.push(...(g.index ? g.toNonIndexed() : g).attributes.position.array); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g; }
export function initBeachLife() {
  crowd = new Crowd(CAP);
  towelIM = mk(new THREE.BoxGeometry(0.9, 0.04, 1.8).translate(0, 0.05, 0), std('#ffffff', { roughness: 0.95 }), CAP, false); towelIM.setColorAt(0, col.set('#fff'));
  umbIM = mk(new THREE.ConeGeometry(1.25, 0.45, 12, 1, true).translate(0, 2.1, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.7, side: THREE.DoubleSide }), TCAP); umbIM.setColorAt(0, col.set('#fff'));
  umbPoleIM = mk(new THREE.CylinderGeometry(0.025, 0.025, 2.2, 6).translate(0, 1.1, 0), std('#dddddd', { metalness: 0.5 }), TCAP);
  // lifeguard tower: 4 white legs, platform, back + seat, a little roof (white) and the red cross sign (red)
  const legs = []; for (const x of [-0.8, 0.8]) for (const z of [-0.6, 0.6]) legs.push(new THREE.BoxGeometry(0.12, 2.2, 0.12).translate(x, 1.1, z));
  towerIM = mk(merge([...legs, new THREE.BoxGeometry(2, 0.12, 1.6).translate(0, 2.25, 0), new THREE.BoxGeometry(1.1, 0.9, 0.08).translate(0, 2.8, 0.55), new THREE.BoxGeometry(1.1, 0.08, 0.6).translate(0, 2.65, 0.25), new THREE.BoxGeometry(2.2, 0.08, 1.8).translate(0, 3.9, 0.1), ...[-0.9, 0.9].map(x => new THREE.BoxGeometry(0.06, 1.6, 0.06).translate(x, 3.1, 0.65)), new THREE.BoxGeometry(0.1, 1.2, 0.1).translate(0.9, 1.3, -1.1).rotateX(0.5)]), std('#f4f4f2', { roughness: 0.6 }), 20);
  crossIM = mk(merge([new THREE.BoxGeometry(0.7, 0.18, 0.02).translate(0, 2.85, -0.0), new THREE.BoxGeometry(0.18, 0.7, 0.02).translate(0, 2.85, -0.0)]), std('#d62828', { roughness: 0.5 }), 20, false);
  netIM = mk(merge([new THREE.CylinderGeometry(0.05, 0.05, 2.5, 6).translate(-4.6, 1.25, 0), new THREE.CylinderGeometry(0.05, 0.05, 2.5, 6).translate(4.6, 1.25, 0), new THREE.BoxGeometry(9.0, 0.9, 0.02).translate(0, 1.95, 0)]), new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.8, transparent: true, opacity: 0.75 }), 20, false);
}
function warmth() {
  const s = { summer: 1, spring: 0.35, fall: 0.2, winter: 0.04 }[G.season] ?? 0.5, h = G.hour ?? 12;
  const day = h < 9 || h > 20.5 ? 0 : h < 11 ? (h - 9) / 2 : h > 18.5 ? (20.5 - h) / 2 : 1;
  const wx = Math.max(0, 1 - (G.wet || 0) * 3) * (1 - 0.5 * Math.max(0, (G.cloud || 0) - 0.3));
  return s * day * wx;
}
function rebuild(px, pz, warm) {
  at = [px, pz]; lastWarm = warm; people = [];
  let nt = 0, nu = 0, nTow = 0, nNet = 0; const coll = [];
  for (const a of window.MAP.areas) {
    if (a.k !== 'beach' || a.line) continue;
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let i = 0; i < a.p.length; i += 2) { x0 = Math.min(x0, a.p[i]); x1 = Math.max(x1, a.p[i]); z0 = Math.min(z0, a.p[i + 1]); z1 = Math.max(z1, a.p[i + 1]); }
    if (x1 < px - RAD || x0 > px + RAD || z1 < pz - RAD || z0 > pz + RAD) continue;
    const inP = (x, z) => { let c = false; const p = a.p; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if (((p[i + 1] > z) !== (p[j + 1] > z)) && x < (p[j] - p[i]) * (z - p[i + 1]) / (p[j + 1] - p[i + 1]) + p[i]) c = !c; return c; };
    const seed = Math.floor(x0 * 7 + z0 * 3); let k = 0;
    x0 = Math.max(x0, px - RAD); x1 = Math.min(x1, px + RAD); z0 = Math.max(z0, pz - RAD); z1 = Math.min(z1, pz + RAD);
    const area = (x1 - x0) * (z1 - z0); if (area <= 0) continue;
    const rnd = () => hash2(seed + k * 1.37, ++k * 0.91);
    // the lifeguard tower and volleyball nets (always there in summer; towers stay year-round)
    if (area > 2500 && nTow < 20) for (let t = 0; t < 40; t++) { const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0), h = groundY(x, z); if (!inP(x, z) || h < 1.3 || h > 2.6 || isWater(x, z)) continue; let wa = 0; for (let b = 0; b < 6.28; b += 0.3) if (isWater(x + Math.cos(b) * 40, z + Math.sin(b) * 40)) { wa = b; break; } o.position.set(x, h - 0.1, z); o.rotation.set(0, Math.atan2(-Math.cos(wa), -Math.sin(wa)) + Math.PI, 0); o.scale.set(1, 1, 1); o.updateMatrix(); towerIM.setMatrixAt(nTow, o.matrix); crossIM.setMatrixAt(nTow, o.matrix); nTow++; coll.push({ x, z, r: 1.1, top: h + 4 });
      if (warm > 0.3) { const lg = { x, z, y: h + 2.32, yaw: o.rotation.y + Math.PI, cols: { ...newLook(), shirt: '#d62828', pants: '#d62828', hat: '#f6e05e', coat: null, skirt: null, bag: null }, state: 'sit', kind: 'sit', phase: 0, amp: 0, visible: true, dirty: true }; people.push(lg); } break; }
    if (area > 5000 && nNet < 20 && warm > 0.2) for (let t = 0; t < 30; t++) { const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0), h = groundY(x, z); if (!inP(x, z) || h < 2.2 || isWater(x, z)) continue; o.position.set(x, h - 0.05, z); o.rotation.set(0, rnd() * 3.14, 0); o.scale.set(1, 1, 1); o.updateMatrix(); netIM.setMatrixAt(nNet++, o.matrix); for (let pl = 0; pl < 4 && people.length < CAP; pl++) { const side = pl < 2 ? -1 : 1, lx = (pl % 2 ? 2 : -2), lz = side * (2 + rnd() * 2), c = Math.cos(o.rotation.y), s2 = Math.sin(o.rotation.y); const look = newLook(); look.shirt = pick(SWIM); look.pants = pick(SWIM); look.coat = null; look.hat = null; people.push({ x: x + lx * c + lz * s2, z: z - lx * s2 + lz * c, y: h, yaw: o.rotation.y + (side > 0 ? 0 : Math.PI), cols: look, state: 'idle', kind: 'dance', phase: rnd() * 6, amp: 0.6, visible: true, dirty: true, vb: true }); } break; }
    // sunbathers + umbrellas + sitters, and a few swimmers just offshore
    const n = Math.min(70, Math.floor(area / 160 * warm));
    for (let t = 0; t < n * 4 && people.length < CAP && nt < CAP; t++) {
      const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0); if (Math.hypot(x - px, z - pz) > RAD || !inP(x, z)) continue;
      const h = groundY(x, z); if (h < 1.35 || isWater(x, z)) continue;
      const yaw = rnd() * 6.28, look = newLook(); look.shirt = pick(SWIM); look.pants = rnd() < 0.5 ? pick(SWIM) : look.skin; look.coat = null; look.scarf = null; look.bag = null; if (rnd() < 0.5) look.hat = null;
      o.position.set(x, h + 0.01, z); o.rotation.set(0, yaw, 0); o.scale.set(1, 1, 1); o.updateMatrix(); towelIM.setMatrixAt(nt, o.matrix); towelIM.setColorAt(nt, col.set(TOWEL[Math.floor(rnd() * TOWEL.length)])); nt++;
      const sit = rnd() < 0.3;
      people.push({ x: x + (sit ? Math.sin(yaw) * 0.5 : 0), z: z + (sit ? Math.cos(yaw) * 0.5 : 0), y: h + (sit ? -0.45 : 0.05), yaw, cols: look, state: sit ? 'sit' : 'down', kind: sit ? 'sit' : 'walk', phase: 0, amp: 0, visible: true, dirty: true });
      if (rnd() < 0.3 && nu < TCAP) { const ux = x + Math.cos(yaw) * 1.1, uz = z - Math.sin(yaw) * 1.1; o.position.set(ux, groundY(ux, uz), uz); o.rotation.set((rnd() - 0.5) * 0.2, rnd() * 6, (rnd() - 0.5) * 0.2); o.updateMatrix(); umbIM.setMatrixAt(nu, o.matrix); umbPoleIM.setMatrixAt(nu, o.matrix); umbIM.setColorAt(nu, col.set(TOWEL[Math.floor(rnd() * TOWEL.length)])); nu++; }
    }
    for (let t = 0; t < Math.floor(n / 5) * 6 && people.length < CAP; t++) {   // swimmers: in the water, 10–60 m out
      const x = x0 + rnd() * (x1 - x0) * 1.4 - (x1 - x0) * 0.2, z = z0 + rnd() * (z1 - z0) * 1.4 - (z1 - z0) * 0.2; if (!isWater(x, z) || Math.hypot(x - px, z - pz) > RAD) continue;
      let shore = false; for (let b = 0; b < 6.28 && !shore; b += 0.8) if (!isWater(x + Math.cos(b) * 50, z + Math.sin(b) * 50)) shore = true; if (!shore) continue;
      const look = newLook(); look.hat = rnd() < 0.4 ? pick(['#f6e05e', '#e53e3e', '#ffffff']) : null; look.shirt = look.skin;
      people.push({ x, z, y: waterLevel(x, z) - 1.45, yaw: rnd() * 6.28, cols: look, state: 'walk', kind: 'swim', phase: rnd() * 6, amp: 0.6, visible: true, dirty: true, swim: true });
    }
  }
  towelIM.count = nt; umbIM.count = nu; umbPoleIM.count = nu; towerIM.count = nTow; crossIM.count = nTow; netIM.count = nNet;
  for (const m of [towelIM, umbIM, umbPoleIM, towerIM, crossIM, netIM]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  setColliders('beach', coll);
}
export function updateBeachLife(dt, pl) {
  if (!crowd) return;
  checkT -= dt;
  if (checkT < 0) { checkT = 4; const w = warmth(); if (!at || Math.hypot(pl.x - at[0], pl.z - at[1]) > 150 || Math.abs(w - lastWarm) > 0.15) rebuild(pl.x, pl.z, w); }
  for (const p of people) {
    if (p.swim) { p.phase += dt * 3; p.y = waterLevel(p.x, p.z) - 1.45 + Math.sin(p.phase * 0.7) * 0.08; p.x += Math.sin(p.yaw) * dt * 0.4; p.z += Math.cos(p.yaw) * dt * 0.4; if (Math.random() < dt * 0.1) p.yaw += (Math.random() - 0.5) * 2; }
    else if (p.vb) p.phase += dt * 5;   // volleyball players bouncing on their toes
  }
  crowd.draw(people);
}
export const _beach = { get people() { return people.length; }, get towels() { return towelIM?.count; } };
