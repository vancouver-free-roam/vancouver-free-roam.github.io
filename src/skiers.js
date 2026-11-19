// Skiers and snowboarders on the mountains: they appear near the resorts (and on any snowy slope you're on), carve S-turns
// down the fall line, aim for the terrain-park kickers and get real air (boarders spin 360s, skiers throw helicopters), and
// now and then one wipes out in a spectacular "yard sale". Drawn with the instanced crowd + instanced skis / boards.
import * as THREE from 'three';
import { G, scene, std, R, pick } from './core.js';
import { heightAt, groundY, isSnow, isWater } from './terrain.js';
import { surfaceY } from './city.js';
import { Crowd, newLook } from './people.js';
import { _slopes } from './slopes.js';
import { runs } from './pistes.js';

const MAX = 18, riders = [];
const JACKETS = ['#e53e3e', '#3182ce', '#38a169', '#d69e2e', '#805ad5', '#ed64a6', '#f6e05e', '#1a202c', '#f6f6f6', '#dd6b20', '#319795'];
const PANTS = ['#1a202c', '#2d3748', '#4a5568', '#2c5282', '#f6f6f6', '#744210', '#22543d'];
let crowd = null, boardIM = null, skiIM = null;
const o = new THREE.Object3D(), col = new THREE.Color();

function gearGeos() {
  const s = new THREE.Shape(), w = 0.14, l = 0.78;
  s.moveTo(-w, -l + 0.14); s.lineTo(-w, l - 0.14); s.quadraticCurveTo(-w, l, 0, l); s.quadraticCurveTo(w, l, w, l - 0.14); s.lineTo(w, -l + 0.14); s.quadraticCurveTo(w, -l, 0, -l); s.quadraticCurveTo(-w, -l, -w, -l + 0.14);
  const board = new THREE.ExtrudeGeometry(s, { depth: 0.03, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, 0.07, 0);
  const ski = (x) => [new THREE.BoxGeometry(0.085, 0.025, 1.6).translate(x, 0.06, 0.05), new THREE.BoxGeometry(0.085, 0.025, 0.22).rotateX(0.45).translate(x, 0.1, -0.83)];
  const parts = [...ski(-0.12), ...ski(0.12)].map(g => g.toNonIndexed());
  const n = parts.reduce((a, g) => a + g.attributes.position.count, 0), pos = new Float32Array(n * 3), nor = new Float32Array(n * 3); let k = 0;
  for (const g of parts) { pos.set(g.attributes.position.array, k * 3); nor.set(g.attributes.normal.array, k * 3); k += g.attributes.position.count; }
  const skisG = new THREE.BufferGeometry(); skisG.setAttribute('position', new THREE.BufferAttribute(pos, 3)); skisG.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return { board, skisG };
}
export function initSkiers() {
  crowd = new Crowd(MAX);
  const { board, skisG } = gearGeos();
  boardIM = new THREE.InstancedMesh(board, std('#ffffff', { roughness: 0.35 }), MAX); skiIM = new THREE.InstancedMesh(skisG, std('#ffffff', { roughness: 0.35 }), MAX);
  for (const m of [boardIM, skiIM]) { m.count = 0; m.frustumCulled = false; m.castShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.setColorAt(0, col.set('#fff')); scene.add(m); }
}
const fall = (x, z) => { const e = 5; const gx = heightAt(x + e, z) - heightAt(x - e, z), gz = heightAt(x, z + e) - heightAt(x, z - e), L = Math.hypot(gx, gz); return { dx: -gx / (L || 1), dz: -gz / (L || 1), s: L / (2 * e) }; };
function nearResort(px, pz) { let best = null, bd = 2600; for (const r of _slopes.RESORTS) if (r.hut) { const d = Math.hypot(r.hut.x - px, r.hut.z - pz); if (d < bd) { bd = d; best = r.hut; } } return best; }
function spawn(px, pz) {
  const hut = nearResort(px, pz), cx = hut ? hut.x : px, cz = hut ? hut.z : pz;
  // a real ski run near you: start somewhere along its upper part
  if (Math.random() < 0.85) { const near = runs.filter(r => !r.area && r.pts.length > 3 && r.pts.some((p, i) => i % 4 === 0 && Math.hypot(p[0] - px, p[1] - pz) < 550)); if (near.length) { const run = near[Math.floor(Math.random() * near.length)], i0 = Math.floor(Math.random() * run.pts.length * 0.6), [x, z] = run.pts[i0], y = groundY(x, z); if (isSnow(x, z, y) && Math.hypot(x - px, z - pz) < 650) { const r = make(x, z, y); r.run = run; r.seg = i0; r.lane = (Math.random() - 0.5) * 1.2; return r; } } }
  for (let t = 0; t < 25; t++) {
    const a = Math.random() * 6.28, d = R(60, hut ? 700 : 420), x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (Math.hypot(x - px, z - pz) > 650 || isWater(x, z)) continue;
    const y = groundY(x, z), f = fall(x, z); if (!isSnow(x, z, y) || f.s < 0.08 || f.s > 0.75) continue;
    return make(x, z, y, f);
  }
  return null;
}
function make(x, z, y, f = fall(x, z)) {
  {
    const look = newLook(); look.shirt = pick(JACKETS); look.pants = pick(PANTS); look.hat = pick(['#1a202c', '#f6f6f6', '#c53030', '#2b6cb0', '#d69e2e', '#38a169']); look.coat = null; look.skirt = null; look.bag = Math.random() < 0.3 ? pick(['#1a202c', '#c53030']) : null; look.glasses = '#f6ad55';   // goggles
    const board = Math.random() < 0.45;
    return { x, z, y, cols: look, kind: board ? 'board' : 'ski', board, state: 'ride', visible: true, dirty: true, phase: 0, amp: 0, yaw: 0, head: Math.atan2(f.dx, f.dz), sp: R(4, 8), t: Math.random() * 10, freq: R(0.6, 1.1), vy: 0, air: false, spin: 0, flat: 0, gear: pick(JACKETS), skill: Math.random() };
  }
  return null;
}
export function updateSkiers(dt, pl) {
  if (!crowd) return;
  const want = (isSnow(pl.x, pl.z) || nearResort(pl.x, pl.z)) && !pl.transit ? MAX : 0;
  for (let i = riders.length - 1; i >= 0; i--) { const r = riders[i]; if (r.gone || Math.hypot(r.x - pl.x, r.z - pl.z) > 800 || riders.length > want) riders.splice(i, 1); }
  for (let k = 0; k < 2 && riders.length < want; k++) { const r = spawn(pl.x, pl.z); if (r) riders.push(r); }
  const kick = _slopes.kickers;
  for (const r of riders) {
    r.t += dt;
    if (r.state === 'down') { r.timer -= dt; if (r.timer < 0) { r.state = 'ride'; r.sp = 2; } continue; }   // picking themselves up
    const f = fall(r.x, r.z);
    if (!r.air) {
      // carve S-turns around the fall line; good riders aim for a kicker below them
      let target = Math.atan2(f.dx, f.dz) + Math.sin(r.t * r.freq) * (0.55 + 0.35 * (1 - r.skill));
      if (r.run) { const P = r.run.pts; while (r.seg < P.length - 1 && Math.hypot(P[r.seg + 1][0] - r.x, P[r.seg + 1][1] - r.z) < 14) r.seg++; if (r.seg >= P.length - 1) { r.gone = true; continue; } const q = P[Math.min(P.length - 1, r.seg + 1)], dx = q[0] - r.x, dz = q[1] - r.z, L = Math.hypot(dx, dz) || 1, lat = r.run.hw * (0.55 * Math.sin(r.t * r.freq) + r.lane * 0.3); target = Math.atan2(dx + (-dz / L) * lat, dz + (dx / L) * lat); }
      if (r.skill > 0.35) for (const k of kick) { const dx = k.x - r.x, dz = k.z - r.z, d = Math.hypot(dx, dz); if (d > 6 && d < 110 && dx * f.dx + dz * f.dz > d * 0.6) { target = Math.atan2(dx, dz); break; } }
      let dh = target - r.head; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); r.head += Math.max(-1.6 * dt, Math.min(1.6 * dt, dh));
      const along = Math.sin(r.head) * f.dx + Math.cos(r.head) * f.dz;   // how downhill we're pointing
      r.sp += (f.s * 9.8 * Math.max(0.3, along) * 0.95 - 0.006 * r.sp * r.sp - 0.25) * dt; r.sp = Math.max(3, Math.min(9 + r.skill * 10, r.sp));
      if (f.s < 0.05) r.flat += dt; else r.flat = 0;
    }
    const ox = r.x, oz = r.z;
    r.x += Math.sin(r.head) * r.sp * dt; r.z += Math.cos(r.head) * r.sp * dt;
    const g = Math.max(groundY(r.x, r.z), surfaceY(r.x, r.z, r.y + 0.6));   // kickers + rails are decks
    if (r.air) {
      r.vy -= 20 * dt; r.y += r.vy * dt; r.spin += dt * (r.board ? 7 : 5.5) * (r.trick || 0);
      if (r.y <= g) { r.air = false; r.y = g; const off = Math.abs(Math.atan2(Math.sin(r.spin), Math.cos(r.spin))); r.spin = 0; if (off > 0.8 || Math.random() < 0.06) { r.state = 'down'; r.timer = R(2, 4); r.sp = 0; } }
    } else {
      const vy = (g - r.y) / Math.max(dt, 1e-3);
      if (r.lastVy !== undefined && r.lastVy > 2.5 && vy < r.lastVy - 4) { r.air = true; r.vy = r.lastVy; r.trick = r.skill > 0.5 && Math.random() < 0.7 ? (Math.random() < 0.5 ? 1 : -1) : 0; }   // left the lip of a kicker
      else r.y = g;
      r.lastVy = Math.min(12, vy);
    }
    if (!isSnow(r.x, r.z, r.y) || r.flat > 4) r.gone = true;
    r.yaw = r.head + Math.PI + (r.board ? 1.25 : 0) + r.spin; r.kind = r.board ? 'board' : 'ski'; r.amp = 0; r.phase += dt;
  }
  crowd.draw(riders);
  let n = 0, nb = 0, ns = 0;
  for (const r of riders) {
    if (!r.visible || r.slot === undefined) continue;
    const lying = r.state === 'down';
    o.position.set(r.x, r.y - (lying ? 0 : 0), r.z); o.rotation.set(0, r.head + Math.PI + r.spin, lying ? 1.2 : 0, 'YXZ'); o.updateMatrix();
    const m = r.board ? boardIM : skiIM, i = r.board ? nb++ : ns++;
    m.setMatrixAt(i, o.matrix); m.setColorAt(i, col.set(r.gear)); n++;
  }
  boardIM.count = nb; skiIM.count = ns;
  for (const m of [boardIM, skiIM]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
}
export const _skiers = riders;   // for tests
