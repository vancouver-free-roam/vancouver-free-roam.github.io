// Smash! Small street stuff breaks when a vehicle hits it fast enough (see colliders.js `brk`):
//  - poles, signs, parking meters, lamp posts, flagpoles and small street trees TOPPLE over the way you hit them
//  - bins, sandwich boards, planters and patio tables FLY off, tumbling
//  - fire hydrants pop and shoot a geyser of water for half a minute (people nearby love it / hate it)
// The real (instanced) piece is hidden and a loose copy does the falling. City crews put things back once you've gone.
import * as THREE from 'three';
import { G, scene, R, pick } from './core.js';
import { setBreakHandler, propKg } from './colliders.js';
import { updateCrashFx } from './crashfx.js';
import { surfaceY } from './city.js';
import { peds, say } from './people.js';
import { ui } from './ui.js';
import { sfx } from './sound.js';

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
const debris = [], hidden = [], geysers = [];
let told = false, hydrants = 0;
const dropT = () => G.t;

function hide(c) {
  const saved = [];
  for (const [m, i, ver] of c.refs || []) {
    if (i >= m.count) continue;
    const orig = new THREE.Matrix4(); if (m.userData.ring) { m.userData.ring.orig(m, i, orig); m.userData.ring.setBroken(m, i, true); } else m.getMatrixAt(i, orig); saved.push([m, i, ver, orig]);   // trees near you are drawn by the detailed "near ring" (trees.js)
    m.setMatrixAt(i, ZERO); m.instanceMatrix.needsUpdate = true;
  }
  hidden.push({ c, saved, t: G.t });
  return saved;
}
function breakIt(c, dir, speed, obj) {
  c.gone = true;
  const saved = hide(c); if (!saved.length) return;
  dir = dir || [0, -1]; const dx = dir[0], dz = dir[1];
  // a loose copy of the pieces, grouped around the base so it can tip over
  const base = new THREE.Vector3(c.x, c.base ?? surfaceY(c.x, c.z), c.z), g = new THREE.Group(); g.position.copy(base); scene.add(g);
  for (const [m, idx, , orig] of saved) {
    const mat = Array.isArray(m.material) ? m.material[0] : m.material, piece = new THREE.Mesh(m.geometry, mat);
    _m.makeTranslation(-base.x, -base.y, -base.z).multiply(orig); piece.matrixAutoUpdate = false; piece.matrix.copy(_m); piece.castShadow = true;
    if (m.instanceColor) { const col = new THREE.Color(); m.getColorAt(idx, col); piece.material = mat.clone(); piece.material.color.copy(col); if (mat.onBeforeCompile) { piece.material.onBeforeCompile = mat.onBeforeCompile; piece.material.customProgramCacheKey = mat.customProgramCacheKey; } }
    g.add(piece);
  }
  const kind = c.kind || 'tip';
  // mass decides the fling: a bus sends a bin flying ~1.25x its speed, a bike only nudges a sandwich board along
  const mp = obj?.kg || 1400, mo = propKg(c), fling = kind === 'fly' ? Math.min(1.3, 1.25 * mp / (mp + mo)) : 0.55 * Math.min(1, mp / (mp + mo) * 1.3);
  // tall poles hit not much faster than their break speed BEND over instead of falling flat
  const tall = c.top - (c.base || 0) > 4, maxAng = kind === 'tip' && tall && speed < (c.brk || 10) * 1.5 ? R(0.45, 0.95) : Math.PI / 2 - 0.08;
  const d = { g, kind, t: 0, axis: new THREE.Vector3(dz, 0, -dx).normalize(), ang: 0, maxAng, angV: 0.6 + speed * 0.09, vx: dx * speed * fling, vz: dz * speed * fling, vy: kind === 'fly' ? (3 + speed * 0.15) * Math.min(1, fling + 0.3) : 0, spin: new THREE.Vector3(R(-6, 6), R(-6, 6), R(-6, 6)) };
  if (maxAng < 1) d.vx = d.vz = 0;   // bent: stays rooted
  debris.push(d);
  sfx.bump?.(); if (kind === 'tip' && c.top - (c.base || 0) > 4) sfx.thwack?.();
  if (kind === 'hydrant') {
    hydrants++; window.__game?.player && (window.__game.player.karma -= 1);
    geysers.push(makeGeyser(base, 30));
    ui.toast('💦 You knocked over a fire hydrant!', hydrants === 1 ? 'Instant water park. Kids love it. The city does not. (-1 karma)' : 'Again?! The fire department knows your licence plate now. (-1 karma)', 3500);
  } else if (!told) { told = true; ui.toast('💥 Smash!', 'Small stuff (signs, poles, bins, little trees) breaks if you hit it fast enough. Buildings, pillars and big trees won\'t.', 4000); }
  for (const p of peds) if (Math.abs(p.x - c.x) < 18 && Math.abs(p.z - c.z) < 18 && Math.random() < 0.4) { say(p, pick(['WHOA!', 'Holy crap!', 'Did you just…?!', 'Somebody call the city!', 'That\'s coming out of my taxes!', 'Insurance is gonna LOVE that.']), 2200); }
}
// a burst hydrant: a column of water + spray
const waterMat = new THREE.MeshBasicMaterial({ color: '#d8f0ff', transparent: true, opacity: 0.55, depthWrite: false }), dropGeo = new THREE.SphereGeometry(0.09, 5, 4);
function makeGeyser(base, life) {
  const g = new THREE.Group(); g.position.copy(base); scene.add(g);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.25, 1, 10, 1, true).translate(0, 0.5, 0), waterMat); g.add(col);
  const drops = new THREE.InstancedMesh(dropGeo, waterMat, 80); drops.frustumCulled = false; g.add(drops);
  const P = []; for (let i = 0; i < 80; i++) P.push({ x: 0, y: R(0, 6), z: 0, vx: R(-2, 2), vy: R(2, 9), vz: R(-2, 2) });
  return { g, col, drops, P, life, t: 0, wet: new Set() };
}
const _o = new THREE.Object3D();
export function updateBreakables(dt, pl) {
  updateCrashFx(dt, pl);
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i]; d.t += dt;
    if (d.kind === 'fly') {
      d.vy -= 18 * dt; d.g.position.x += d.vx * dt; d.g.position.y += d.vy * dt; d.g.position.z += d.vz * dt;
      const gy = surfaceY(d.g.position.x, d.g.position.z, d.g.position.y + 1);
      if (d.g.position.y < gy) { d.g.position.y = gy; d.vy = Math.abs(d.vy) > 2 ? -d.vy * 0.3 : 0; d.vx *= 0.6; d.vz *= 0.6; d.spin.multiplyScalar(0.5); }
      d.g.rotation.x += d.spin.x * dt; d.g.rotation.y += d.spin.y * dt; d.g.rotation.z += d.spin.z * dt;
    } else {   // tip over: rotate about the base, faster as it falls, a little bounce at the end
      if (d.ang < d.maxAng) { d.angV += dt * 4 * Math.cos(d.ang * 0.5); d.ang = Math.min(d.maxAng, d.ang + d.angV * dt); }
      d.g.quaternion.setFromAxisAngle(d.axis, d.ang); d.g.position.x += d.vx * dt * Math.max(0, 1 - d.t * 2); d.g.position.z += d.vz * dt * Math.max(0, 1 - d.t * 2);
    }
    if (d.t > 25) { d.g.traverse(o => { if (o.material?.transparent === false) { o.material = o.material.clone(); o.material.transparent = true; } }); }
    if (d.t > 25) d.g.traverse(o => { if (o.material) o.material.opacity = Math.max(0, 1 - (d.t - 25) / 3); });
    if (d.t > 28 || Math.hypot(d.g.position.x - pl.x, d.g.position.z - pl.z) > 600) { scene.remove(d.g); debris.splice(i, 1); }
  }
  // the hydrant geysers
  for (let i = geysers.length - 1; i >= 0; i--) {
    const q = geysers[i]; q.t += dt; const k = Math.min(1, q.t * 3) * Math.max(0, Math.min(1, (q.life - q.t) / 4)), h = 7 * k * (0.9 + Math.sin(q.t * 9) * 0.1);
    q.col.scale.set(1 + Math.sin(q.t * 13) * 0.1, Math.max(0.01, h), 1 + Math.cos(q.t * 11) * 0.1);
    q.P.forEach((p, j) => { p.vy -= 12 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; if (p.y < 0) { p.x = 0; p.z = 0; p.y = h * R(0.6, 1); p.vx = R(-2.5, 2.5); p.vy = R(-1, 3); p.vz = R(-2.5, 2.5); } _o.position.set(p.x, p.y, p.z); _o.scale.setScalar(k); _o.updateMatrix(); q.drops.setMatrixAt(j, _o.matrix); });
    q.drops.instanceMatrix.needsUpdate = true;
    for (const p of peds) if (!q.wet.has(p) && Math.hypot(p.x - q.g.position.x, p.z - q.g.position.z) < 5) { q.wet.add(p); say(p, pick(['AAH! I\'m soaked!', 'Free shower! Woo!', 'My phone! MY PHONE!', 'Best day ever!', 'This is SO Vancouver.']), 2500); }
    if (Math.hypot(pl.x - q.g.position.x, pl.z - q.g.position.z) < 3 && !pl.vehicle && !q.playerWet) { q.playerWet = true; ui.toast('💦 Splash!', 'You ran through the hydrant. Refreshing!', 1800); }
    if (q.t > q.life) { scene.remove(q.g); geysers.splice(i, 1); }
  }
  // city crews put broken things back once you're out of sight
  for (let i = hidden.length - 1; i >= 0; i--) {
    const h = hidden[i]; if (G.t - h.t < 60 || Math.hypot(h.c.x - pl.x, h.c.z - pl.z) < 150) continue;
    for (const [m, idx, ver, orig] of h.saved) if ((m.userData.ver || 0) === ver && idx < m.count) { m.setMatrixAt(idx, orig); m.instanceMatrix.needsUpdate = true; m.userData.ring?.setBroken(m, idx, false); }
    h.c.gone = false; hidden.splice(i, 1);
  }
}
setBreakHandler(breakIt);
export const _breakables = { debris, hidden, geysers };
