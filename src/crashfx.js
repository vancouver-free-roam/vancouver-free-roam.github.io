// Crash surprises (the physics itself is in vehicles.js `collidePair` / `knockStep`):
//  - bump a parked car and its alarm may go off: WEE-OO with blinking indicators, and the street stares at you
//  - the driver of a car you hit (or a cyclist you knock down) has words for you
//  - a hard hit can pop a hubcap off, which rolls away down the street, wobbles and spins down flat like a coin
import * as THREE from 'three';
import { G, scene, R, pick, std } from './core.js';
import { walkY } from './city.js';
import { groundY } from './terrain.js';
import { crashHooks } from './vehicles.js';
import { peds, say } from './people.js';
import { ui } from './ui.js';
import { beep } from './sound.js';

const alarms = [], caps = [];
let alarmTold = false, sayT = 0, capTold = false;
const blinkM = new THREE.MeshBasicMaterial({ color: '#ffa31a' }), blinkGeo = new THREE.BoxGeometry(0.22, 0.12, 0.08);
const capGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.04, 18).rotateX(Math.PI / 2), capM = std('#c9ccd0', { metalness: 0.9, roughness: 0.25 });

function startAlarm(v) {
  if (v.alarm || v.d.show || alarms.length > 3) return;
  const L = (v.model?.body?.L || v.d.len) / 2, W = (v.model?.body?.W || 1.8) / 2 - 0.1, g = new THREE.Group();
  for (const [x, z] of [[-W, -L], [W, -L], [-W, L], [W, L]]) { const m = new THREE.Mesh(blinkGeo, blinkM); m.position.set(x, 0.75, z); g.add(m); }
  v.g.add(g); v.alarm = { g, t: 0, beat: 0 }; alarms.push(v);
  if (!alarmTold) { alarmTold = true; ui.toast('🚨 WEE-OO WEE-OO!', 'You set off a car alarm. The whole block is looking at you.', 3000); }
  for (const p of peds) if (Math.abs(p.x - v.x) < 25 && Math.abs(p.z - v.z) < 25 && Math.random() < 0.5) say(p, pick(['Is that YOUR car?', 'Somebody turn that off!', 'Every. Single. Night.', 'I was SLEEPING.', 'Nice one, genius.', '🙉']), 2400);
}
function popCap(v, pl) {
  if (caps.length >= 4 || v.d.show || v.type === 'bus') return;
  const m = new THREE.Mesh(capGeo, capM); m.castShadow = true; scene.add(m);
  const a = R(0, Math.PI * 2), sp = R(4, 8);
  caps.push({ m, x: v.x + Math.cos(a) * 1.2, z: v.z + Math.sin(a) * 1.2, y: v.y + 0.35, dir: a, sp, roll: 0, lean: 0, spin: 0, t: 0 });
  if (!capTold && pl) { capTold = true; ui.toast('🛞 There goes a hubcap…', 'It\'s rolling away down the street. Classic.', 2500); }
}
crashHooks.parked = v => { if (Math.random() < 0.6 || !alarmTold) startAlarm(v); };
crashHooks.hit = (a, b, vr, pl) => {
  if (!pl) return;   // shoved car into shoved car: no extra lines
  if (b.fromCurb || (!b.ai && !b.d.show)) { if (vr > 2 && Math.random() < 0.5) startAlarm(b); }
  if (vr > 9 && Math.random() < 0.45) popCap(b, pl);
  if (G.t < sayT) return;
  if (b.ai?.cyc && vr > 2) {
    sayT = G.t + 5; pl.karma = (pl.karma || 0) - 1;
    ui.toast('🚲 Cyclist down!', pick(['"I HAVE A BELL, YOU KNOW!"', '"This is a BIKE LANE!"', '"My Strava segment! RUINED!"', '"I\'m fine. I\'m FINE. My carbon frame is not."']) + ' (-1 karma)', 2600);
  } else if (b.ai && !b.ai.parked && !b.d.show && vr > 3) {
    sayT = G.t + 6;
    ui.toast('😠 The other driver:', pick(['"I JUST got it detailed!"', '"Do you even have insurance?!"', '"Learn to drive! This isn\'t Calgary!"', '"My dashcam got ALL of that, buddy."', '"Oh, come ON. It\'s a lease!"', '"Sorry! …wait, why am I saying sorry? YOU hit ME!"']), 2600);
  }
  if (vr > 7) for (const p of peds) if (Math.abs(p.x - b.x) < 20 && Math.abs(p.z - b.z) < 20 && Math.random() < 0.3) say(p, pick(['OOF!', 'Did you see that?!', 'Somebody call the insurance guy!', 'I\'m filming this.', '😱']), 2000);
};

export function updateCrashFx(dt, pl) {
  for (let i = alarms.length - 1; i >= 0; i--) {
    const v = alarms[i], A = v.alarm; A.t += dt; A.beat -= dt;
    const on = Math.floor(A.t * 3) % 2 === 0; A.g.visible = on;
    const dd = Math.hypot(v.x - pl.x, v.z - pl.z);
    if (A.beat <= 0 && dd < 120) { A.beat = 0.7; beep([880, 660], 0.3, 'square', 0.035 * Math.max(0.15, 1 - dd / 120), 0.35); }
    if (A.t > 10 || !v.g.parent) { v.g.remove(A.g); v.alarm = null; alarms.splice(i, 1); }
  }
  for (let i = caps.length - 1; i >= 0; i--) {
    const c = caps[i]; c.t += dt;
    // rolls on its edge; as it slows it leans over and spins faster and faster until it lies flat (like a coin)
    c.sp = Math.max(0, c.sp - dt * 1.1); c.dir += dt * 0.4 * Math.sin(c.t * 1.3);
    c.x += Math.cos(c.dir) * c.sp * dt; c.z += Math.sin(c.dir) * c.sp * dt; c.roll += c.sp * dt / 0.2;
    if (c.sp < 1.2) { c.lean = Math.min(Math.PI / 2, c.lean + dt * (0.4 + c.lean * 1.6)); c.spin += dt * (4 + c.lean * 14) * (1 - c.lean / (Math.PI / 2)); }
    const gy = walkY(c.x, c.z, groundY(c.x, c.z) + 0.6);
    c.m.position.set(c.x, gy + 0.2 * Math.cos(c.lean) + 0.02, c.z);
    c.m.rotation.set(0, -c.dir + c.spin, 0); c.m.rotateX(c.lean); c.m.rotateZ(-c.roll);   // the disc's axis is local z: lean tips it over, roll turns it like a wheel
    if (c.t > 30 || Math.hypot(c.x - pl.x, c.z - pl.z) > 400) { scene.remove(c.m); caps.splice(i, 1); }
  }
}
export const _crashfx = { alarms, caps, startAlarm, popCap, get sayT() { return sayT; } };
