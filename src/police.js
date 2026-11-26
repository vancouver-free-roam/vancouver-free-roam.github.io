// Police: a wanted level (1–5 stars) for hurting people with guns (guns.js calls addCrime). Officers run at you from
// a parked cruiser (flashing light bar + siren). Get caught = BUSTED (fine, the gun you were holding is seized, you're
// released outside VPD headquarters). Lose them = the stars cool off. Officers are people too: guns.js can hit them.
import * as THREE from 'three';
import { G, scene, std, addMesh, toXZ, pick, R, clamp } from './core.js';
import { walkY, nearestRoad, NX, NZ } from './city.js';
import { isWater } from './terrain.js';
import { makeHuman, say, peds } from './people.js';
import { makeVehicle, removeVehicle } from './vehicles.js';
import { ui } from './ui.js';
import { beep } from './sound.js';

export const WANTED = { stars: 0, heat: 0, coolT: 0, seen: 0, cops: [], cars: [], busted: 0, sirenT: 0 };
let player = null, hud = null, onBusted = null;
const COP_LOOK = () => ({ skin: pick(['#f1c9a5', '#e0ac7e', '#c68c5e', '#8d5a3b', '#5c3a24']), hair: pick(['#1b1b1b', '#3b2416', '#6b4423', '#a8763e']), shirt: '#1d2b4a', pants: '#141c2e', hat: '#121a2d', shoes: '#111' });
const HQ = toXZ(49.2655, -123.1146);   // VPD headquarters, Cambie St
export function initPolice(pl, bustedFn) { player = pl; onBusted = bustedFn; }
// level: 1 = assault, 2 = killing, 3 = killing an officer. Only counts if someone saw it.
export function addCrime(level, x, z) {
  let witness = WANTED.cops.some(c => c.hp > 0 && Math.hypot(c.x - x, c.z - z) < 90);
  if (!witness) for (const p of peds) { if (p.state !== 'dead' && p.x < 1e5 && Math.hypot(p.x - x, p.z - z) < 70) { witness = true; break; } }
  if (!witness) { if (G.t - (WANTED.noWit || -99) > 60) { WANTED.noWit = G.t; ui.toast('🤫 Nobody saw that', 'No witnesses, no police. (Your karma saw it, though.)', 2500); } return; }
  const before = WANTED.stars; if (!before) WANTED.spawnT = 0.8; WANTED.heat += level; WANTED.stars = clamp(Math.ceil(WANTED.heat / 1.5), 1, 5); WANTED.coolT = 0;
  if (WANTED.stars > before) { siren(); ui.toast('🚨 ' + '★'.repeat(WANTED.stars) + '☆'.repeat(5 - WANTED.stars) + ' WANTED', WANTED.stars === 1 ? 'Someone called 911. VPD is on the way: lose them, or get caught.' : 'More officers are coming. Get out of sight!', 3500); }
}
function siren() { beep([960, 760, 960, 760], 0.28, 'sawtooth', 0.025, 0.3); }
function spot(dist) {
  for (let k = 0; k < 16; k++) {
    const a = R(0, 6.28), x = player.x + Math.cos(a) * dist, z = player.z + Math.sin(a) * dist, nr = nearestRoad(x, z, 50, r => r.t <= 6);
    if (!nr) continue; const e = nr.e, X = NX(e.a) + (NX(e.b) - NX(e.a)) * nr.t, Z = NZ(e.a) + (NZ(e.b) - NZ(e.a)) * nr.t;
    if (!isWater(X, Z)) return { x: X, z: Z, yaw: Math.atan2(-(NX(e.b) - NX(e.a)), -(NZ(e.b) - NZ(e.a))) };
  }
  return null;
}
const barM = [std('#e53e3e', { emissive: '#ff2020', emissiveIntensity: 2 }), std('#3182ce', { emissive: '#2060ff', emissiveIntensity: 2 })];
function spawnUnit() {
  const s = spot(R(70, 110)); if (!s) return;
  let car = null; try { car = makeVehicle('car', s.x, s.z, s.yaw, { color: '#f4f4f4', y: walkY(s.x, s.z) + 0.2 }); car.keep = true; car.police = true;
    const bar = new THREE.Group(); bar.position.set(0, 1.55, 0.1); car.g.add(bar); const L = addMesh(new THREE.BoxGeometry(0.5, 0.12, 0.22), barM[0], -0.27, 0, 0, bar), Rr = addMesh(new THREE.BoxGeometry(0.5, 0.12, 0.22), barM[1], 0.27, 0, 0, bar);
    addMesh(new THREE.BoxGeometry(1.9, 0.05, 0.5), std('#1d2b4a'), 0, -0.25, 0, car.g).position.set(0, 0.75, 0.3); car.bar = [L, Rr]; WANTED.cars.push(car); } catch (e) { car = null; }
  const n = WANTED.stars >= 3 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const m = makeHuman(COP_LOOK()), x = s.x + R(-2, 2), z = s.z + R(-2, 2);
    const c = { m, x, z, y: walkY(x, z), yaw: 0, hp: 100, cop: true, state: 'run', t: 0, grab: 0, car, sc: 1, visible: true };
    m.grp.position.set(x, c.y, z); WANTED.cops.push(c); say(c, pick(['VPD! Drop the weapon!', 'Police! Hands where I can see them!', 'Stop right there!', 'Suspect on foot, in pursuit!']), 2200);
  }
}
function removeCop(c) { scene.remove(c.m.grp); WANTED.cops.splice(WANTED.cops.indexOf(c), 1); }
// guns.js: what a shot does to an officer
export function hurtCop(c, kind, dmg) {
  if (c.hp <= 0) return;
  if (kind === 'sleep') { c.state = 'sleep'; c.t = 20; say(c, 'zzz… backup… zzz', 1500); addCrime(1, c.x, c.z); return; }
  if (kind === 'stun') { c.state = 'stun'; c.t = 6; say(c, '*cough* MY EYES! *cough*', 1500); addCrime(1, c.x, c.z); return; }
  c.hp -= dmg; if (c.hp <= 0) { c.state = 'dead'; c.t = 40; addCrime(3, c.x, c.z); } else { c.state = 'stun'; c.t = 1.5; say(c, 'Officer down! Officer DOWN!', 1500); addCrime(1, c.x, c.z); }
}
function busted() {
  const fine = 150 * WANTED.stars; player.money = Math.max(0, player.money - fine); const lost = onBusted?.();
  WANTED.stars = 0; WANTED.heat = 0; WANTED.busted++;
  for (const c of [...WANTED.cops]) removeCop(c); for (const v of WANTED.cars) removeVehicle(v); WANTED.cars = [];
  player.teleport?.(HQ[0], HQ[1]);
  ui.toast('🚔 BUSTED!', `A night in a VPD cell, a ${'$' + fine} fine${lost ? ', and your ' + lost + ' was seized as evidence' : ''}. They let you out on Cambie St in the morning.`, 6500);
  G.hour = 8;
}
export function updatePolice(dt) {
  if (!player) return;
  makeHud();
  // spawn officers while wanted
  const alive = WANTED.cops.filter(c => c.hp > 0 && c.state !== 'sleep');
  if (WANTED.stars > 0 && alive.length < Math.min(8, WANTED.stars * 2) && !player.transit) { WANTED.spawnT = (WANTED.spawnT || 0) - dt; if (WANTED.spawnT <= 0) { WANTED.spawnT = 4; spawnUnit(); } }
  // sirens + light bars
  WANTED.sirenT -= dt; if (WANTED.stars > 0 && WANTED.sirenT < 0) { WANTED.sirenT = 3.2; if (WANTED.cars.some(v => Math.hypot(v.x - player.x, v.z - player.z) < 160)) siren(); }
  const ph = Math.floor(G.t * 6) % 2; for (const v of WANTED.cars) if (v.bar) { v.bar[0].visible = ph === 0 || WANTED.stars === 0; v.bar[1].visible = ph === 1 || WANTED.stars === 0; }
  // officers
  let near = false;
  for (const c of [...WANTED.cops]) {
    const d = Math.hypot(player.x - c.x, player.z - c.z), m = c.m;
    if (c.state === 'dead' || c.state === 'sleep' || c.state === 'stun') {
      c.t -= dt; m.grp.rotation.set(c.state === 'stun' ? 0 : -Math.PI / 2, c.yaw, 0, 'YXZ'); m.grp.position.set(c.x, c.y + (c.state === 'stun' ? 0 : 0.15), c.z); m.st.amp = 0; m.pose(dt);
      if (c.t < 0) { if (c.state === 'dead') { removeCop(c); continue; } c.state = 'run'; m.grp.rotation.set(0, c.yaw, 0); say(c, c.hp > 0 ? 'You\'re under arrest!' : '', 1500); }
      continue;
    }
    if (d > 260 || WANTED.stars === 0) { c.t += dt; if (WANTED.stars === 0 && c.t > 1) { removeCop(c); continue; } if (d > 260) { removeCop(c); continue; } }
    if (d < 45) near = true;
    if (WANTED.stars > 0) {
      const sp = player.vehicle ? 7.5 : 6.4, dx = player.x - c.x, dz = player.z - c.z;
      if (d > 1.3) { c.x += dx / d * sp * dt; c.z += dz / d * sp * dt; }
      c.yaw = Math.atan2(-dx, -dz); c.y = walkY(c.x, c.z, c.y + 1);
      m.st.kind = 'walk'; m.st.amp = 0.95; m.st.phase += dt * 11;
      if (d < 1.7 && !player.vehicle) { c.grab += dt; if (c.grab > 1.2) { busted(); return; } } else c.grab = Math.max(0, c.grab - dt);
      if (Math.random() < dt * 0.25) say(c, pick(['STOP! POLICE!', 'Drop it!', 'You can\'t outrun the radio!', 'Suspect heading ' + (dx > 0 ? 'west' : 'east') + '!']), 1800);
    }
    m.grp.position.set(c.x, c.y, c.z); m.grp.rotation.set(0, c.yaw, 0); m.pose(dt);
  }
  // cooling off: out of sight of every officer for a while = one star less
  if (WANTED.stars > 0) {
    WANTED.coolT += near ? -dt : dt; WANTED.coolT = Math.max(0, WANTED.coolT);
    if (WANTED.coolT > 22) { WANTED.coolT = 0; WANTED.stars--; WANTED.heat = WANTED.stars * 1.5; ui.toast(WANTED.stars ? '🚨 ' + '★'.repeat(WANTED.stars) + ' (cooling off)' : '😮‍💨 You lost the police', WANTED.stars ? 'Keep out of sight.' : 'The sirens fade away.', 2500); }
  }
  for (const v of [...WANTED.cars]) if (WANTED.stars === 0 && Math.hypot(v.x - player.x, v.z - player.z) > 200 && v.driver !== 'player') { removeVehicle(v); WANTED.cars.splice(WANTED.cars.indexOf(v), 1); }
  hud.style.display = WANTED.stars ? 'block' : 'none'; if (WANTED.stars) hud.innerHTML = '<span style="color:#ffd700">' + '★'.repeat(WANTED.stars) + '</span><span style="opacity:.35">' + '★'.repeat(5 - WANTED.stars) + '</span>';
}
function makeHud() { if (hud) return; hud = document.createElement('div'); hud.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);font:700 26px Segoe UI,Arial;letter-spacing:4px;text-shadow:0 0 4px #000,0 0 8px #000;z-index:30;pointer-events:none;display:none'; document.body.appendChild(hud); }
export function copTalkers() { return WANTED.cops; }
export const _police = { WANTED, spawnUnit, busted, addCrime };
