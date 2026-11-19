// The player: walking, running, swimming, snowboarding, parachuting, getting in/out of vehicles, and the camera.
import * as THREE from 'three';
import { G, camera, clamp, lerp, wrapAngle, key, tapped, toXZ, std, addMesh, scene, pick } from './core.js';
import { heightAt, groundY, isWater, isSnow, waterLevel, treeChunks } from './terrain.js';
import { surfaceY, walkY, collideBuildings, buildingAt, nearestRoad, isDriveType, NX, NZ } from './city.js';
import { makeHuman, hitPedsInFront, nearestPed, talkTo, peds, say } from './people.js';
import { vehicles, nearestVehicle, drivePlayer, makeVehicle } from './vehicles.js';
import { sfx, engine } from './sound.js';
import { ui } from './ui.js';
import { isRiding } from './lifts.js';
import { collideStatic, topAt } from './colliders.js';
import { takeoff, airControl, land, resetCombo } from './moves.js';
import { pisteAt } from './pistes.js';
import { takeParked } from './streetlife.js';

export const player = {
  x: 0, z: 0, y: 0, yaw: 0, vy: 0, vx: 0, vz: 0, health: 100, money: 60, karma: 0,
  vehicle: null, flying: false, swimming: false, board: false, chute: false, onGround: true,
  model: null, char: null, attackT: 0, hurtT: 0, stats: { rode: new Set(), swam: false },
  hurt(n, src) {
    if (this.dead) return; this.health = Math.max(0, this.health - n); this.hurtT = 0.3;
    if (this.health <= 0) this.die(src);
  },
  die(src) {
    this.dead = true; sfx.fail();
    const msg = { zombie: 'The zombies got you!', goose: 'Defeated by a Canada goose. Embarrassing.', crash: 'Total wreck!', water: 'Glug glug…', fall: 'That was a long way down.' }[src] || 'Wasted!';
    // where you wake up: downtown → St. Paul's; anywhere else → patched up by paramedics right where it happened (on the nearest
    // road, out of the water). A wrecked car/bike is towed back onto the road so you aren't stranded in the mountains.
    const [hx, hz] = toXZ(49.2805, -123.1286), inTown = Math.hypot(this.x - hx, this.z - hz) < 2500;
    const veh = this.vehicle && ['road'].includes(this.vehicle.d.kind) ? this.vehicle : null;
    ui.toast('💀 ' + msg, inTown ? 'Waking up at St. Paul\'s Hospital… (-$50)' : veh ? 'Paramedics patched you up and a tow truck put you back on the road (-$50)' : 'Paramedics patched you up nearby (-$50)', 3800);
    setTimeout(() => {
      this.health = 100; this.money = Math.max(0, this.money - 50); this.dead = false; this.vy = 0;
      if (inTown) { this.exitVehicle(true); this.teleport(hx, hz); return; }
      const r = nearestRoad(this.x, this.z, 400, q => isDriveType(q.t));
      let x = this.x, z = this.z;
      if (r) { const e = r.e, t = r.t; x = NX(e.a) + (NX(e.b) - NX(e.a)) * t; z = NZ(e.a) + (NZ(e.b) - NZ(e.a)) * t; }
      if (veh && this.vehicle === veh && r) { veh.x = x; veh.z = z; veh.y = surfaceY(x, z, 1e9); veh.speed = 0; veh.vx = veh.vz = veh.vy = 0; veh.air = null; veh.yaw = Math.atan2(-(NX(r.e.b) - NX(r.e.a)), -(NZ(r.e.b) - NZ(r.e.a))); veh.pitch = veh.roll = 0; return; }
      this.exitVehicle(true); if (isWater(x, z)) { this.teleport(hx, hz); return; } this.teleport(x + 4, z);
    }, 2500);
  },
};

let board = null, skis = null;
export function initPlayer(char) {
  player.char = char;
  player.model = makeHuman(char.look);
  // snowboard: a real rounded board shape with bindings (the rider stands sideways on it)
  board = new THREE.Group(); player.model.grp.add(board); board.visible = false; player.boardMesh = board;
  { const s = new THREE.Shape(), w = 0.14, l = 0.78; s.moveTo(-w, -l + 0.14); s.lineTo(-w + 0.012, l - 0.14); s.quadraticCurveTo(-w, l, 0, l); s.quadraticCurveTo(w, l, w - 0.012, l - 0.14); s.lineTo(w, -l + 0.14); s.quadraticCurveTo(w, -l, 0, -l); s.quadraticCurveTo(-w, -l, -w, -l + 0.14);
    const deck = addMesh(new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1 }).rotateX(-Math.PI / 2), std('#e53e3e', { roughness: 0.35 }), 0, 0.07, 0, board); board.material = deck.material; board.userData.deck = deck;
    for (const z of [-0.24, 0.24]) { addMesh(new THREE.BoxGeometry(0.24, 0.08, 0.16), std('#1a1a1a'), 0, 0.13, z, board); addMesh(new THREE.BoxGeometry(0.24, 0.16, 0.03), std('#1a1a1a'), 0, 0.2, z + 0.08, board); } }
  skis = new THREE.Group(); player.model.grp.add(skis); skis.visible = false;
  // (old box skis were replaced: see below)
  player.umbrellaMesh = new THREE.Group(); player.model.grp.add(player.umbrellaMesh); player.umbrellaMesh.visible = false;
  addMesh(new THREE.ConeGeometry(0.8, 0.38, 10), std('#c53030', { side: THREE.DoubleSide }), 0.2, 2.2, 0, player.umbrellaMesh); addMesh(new THREE.CylinderGeometry(0.02, 0.02, 1), std('#222'), 0.2, 1.75, 0, player.umbrellaMesh);
  { const skiM = std('#2b6cb0', { roughness: 0.35 }), dark = std('#1a1a1a'); player.skiMat = skiM;
    for (const s of [-1, 1]) {
      addMesh(new THREE.BoxGeometry(0.085, 0.025, 1.6), skiM, s * 0.12, 0.06, 0.05, skis);
      const tip = addMesh(new THREE.BoxGeometry(0.085, 0.025, 0.22), skiM, s * 0.12, 0.1, -0.83, skis); tip.rotation.x = 0.45;   // turned-up tip
      addMesh(new THREE.BoxGeometry(0.11, 0.07, 0.3), dark, s * 0.12, 0.1, 0.02, skis);   // binding
      addMesh(new THREE.CylinderGeometry(0.012, 0.012, 1.25), std('#cccccc', { metalness: 0.7 }), s * 0.4, 0.62, -0.15, skis).rotation.x = 0.3;   // poles
      addMesh(new THREE.TorusGeometry(0.05, 0.008, 4, 10).rotateX(Math.PI / 2), dark, s * 0.4, 0.06, -0.33, skis);   // basket
    } }
  player.chuteMesh = addMesh(new THREE.SphereGeometry(4, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.5), std('#f6ad55', { side: THREE.DoubleSide }), 0, 7, 0, player.model.grp, false); player.chuteMesh.visible = false;
  const [x, z] = toXZ(char.start[0], char.start[1]);
  player.teleport(x, z);
  G.camYaw = player.yaw = char.startYaw || 0;
}
player.teleport = function (x, z, y) { this.x = x; this.z = z; this.y = y ?? surfaceY(x, z, 1e9); this.vy = 0; this.vx = this.vz = 0; };

player.enterVehicle = function (v) {
  const fromCyclist = !!v.rider;
  if (v.rider) { v.g.remove(v.rider.grp); v.rider = null; v.ai = null; this.karma -= 2; ui.toast('🚲 You yanked a cyclist off their bike!', '"MY CARBON FRAME!" they yell, in full Lycra. (-2 karma)', 3000); }
  if (v.ai) {
    if (!v.ai.parked) { say({ x: v.x, z: v.z, y: v.y }, 'Hey!'); ui.toast('You "borrowed" a ' + v.d.name.toLowerCase(), 'The driver says: "Hey! That\'s my car! …Sorry, eh."', 2500); this.karma -= 1; }
    v.ai = null;
  }
  // share bikes and scooters are free to "borrow" (you just lose a bit of karma, like with cars)
  if (v.type === 'bike' && !v.owned && !fromCyclist) { this.karma -= 1; ui.toast('🚲 You "borrowed" a Mobee bike', 'Free! You jiggled the lock until it gave up. (-1 karma) · W to pedal, G to ring the bell', 2600); }
  if (v.type === 'scooter') { this.karma -= 1; ui.toast('🛴 You "borrowed" a Lyme scooter', 'Free! The app is very disappointed in you. (-1 karma)', 2600); }
  v.driver = 'player'; v.keep = true; this.vehicle = v; this.stats.rode.add(v.type);
  this.model.grp.visible = !!v.d.show; this.board = false; board.visible = false; skis.visible = false;
  if (v.d.kind === 'heli') ui.toast('🚁 Helicopter', 'Space = up · X = down · W/S forward/back · A/D turn · Q/E slide · Shift = faster', 3500);
  if (v.d.kind === 'plane') ui.toast(v.d.floats ? '🛩️ Seaplane' : '✈️ ' + v.d.name, `Hold W for throttle · lift off above ${Math.round(v.d.vr * 3.6)} km/h with Space · X = dive · A/D turn · Shift = extra power · S = brake on the ground`, 5000);
  if (v.type === 'jet' || v.type === 'jumbo') ui.toast('✈️ ' + v.d.name, 'Captain speaking: "Please fasten your seatbelts. I have never flown before." · Hold W, steer down the runway, Space to lift off above ' + Math.round(v.d.vr * 3.6) + ' km/h', 6000);
};
player.exitVehicle = function (force) {
  const v = this.vehicle; if (!v) return;
  if (camera.fov !== 65) { camera.fov = 65; camera.updateProjectionMatrix(); }   // drop the speed-rush wide view
  const g = surfaceY(v.x, v.z, v.y);
  if (!force && (v.d.kind === 'heli' || v.d.kind === 'plane') && v.y - g > 6) { this.chute = true; ui.toast('🪂 Parachute!', 'You jumped out. The aircraft is on its own now…', 2500); }
  v.driver = null; if (v.d.kind !== 'heli' && v.d.kind !== 'plane') v.speed = 0; v.vx = v.vz = 0;
  const side = v.d.len > 3 ? 2.2 : 1.0;
  this.x = v.x - Math.cos(v.yaw) * side; this.z = v.z + Math.sin(v.yaw) * side; this.y = v.y + 0.5; this.vy = 0;
  if (v.d.kind === 'water' || isWater(this.x, this.z)) { this.y = waterLevel(this.x, this.z); }
  this.vehicle = null; this.model.grp.visible = true; engine(false, 0);
};

// ---------- on-foot movement ----------
function moveOnFoot(dt) {
  const m = player.model.st;
  let sprint = 0;
  let ix = (key('KeyD') || key('ArrowRight') ? 1 : 0) - (key('KeyA') || key('ArrowLeft') ? 1 : 0);
  let iz = (key('KeyW') || key('ArrowUp') ? 1 : 0) - (key('KeyS') || key('ArrowDown') ? 1 : 0);
  const run = key('ShiftLeft') || key('ShiftRight'); player.running = run && (ix || iz);
  const ground = walkY(player.x, player.z, player.y);
  const wl = waterLevel(player.x, player.z);
  const water = isWater(player.x, player.z) && ground < wl - 0.6;
  const snow = isSnow(player.x, player.z, ground);
  player.swimming = water && player.y <= wl + 0.2;
  if (player.swimming) player.stats.swam = true;

  // snowboard
  if (tapped('KeyU')) { player.umbrella = !player.umbrella; ui.toast(player.umbrella ? '☂️ Umbrella up!' : '☂️ Umbrella away', player.umbrella ? 'You are now officially a Vancouverite.' : '', 1500); }
  player.umbrellaMesh.visible = !!player.umbrella;
  for (const [k, kind] of [['KeyB', 'board'], ['KeyK', 'ski']]) if (tapped(k)) {
    if (player.board === kind) player.board = false;
    else if (snow) { if (player.gearCheck && !player.gearCheck(kind)) continue; player.board = kind; ui.toast(kind === 'ski' ? '⛷️ Skis on!' : '🏂 Snowboard on!', `Point downhill · A/D to carve · ${kind === 'ski' ? 'K' : 'B'} to take them off`, 2500); }
    else if (kind === 'board' && !player.swimming) { const sk = makeVehicle('skate', player.x, player.z, player.yaw, { color: ['#1a1a1a', '#c53030', '#2b6cb0', '#2f855a'][Math.floor(Math.random() * 4)] }); player.enterVehicle(sk); ui.toast('🛹 Skateboard!', 'W push · Space ollie · in the air: A/D spin, W/S flip · F hop off. Find the 🛹 ramps!', 3500); }
    else ui.toast('No snow here', 'Skis work on the snowy mountains (Grouse, Seymour, Cypress, Whistler Blackcomb)', 2200);
  }
  if (player.board && !snow) player.board = false;
  board.visible = player.board === 'board'; skis.visible = player.board === 'ski';

  const camF = [-Math.sin(G.camYaw), -Math.cos(G.camYaw)], camR = [Math.cos(G.camYaw), -Math.sin(G.camYaw)];
  if (player.board) {
    // slide down the real slope
    // gravity pulls you down the real slope (sin of the slope angle × g); carving REDIRECTS your speed toward where the board
    // points (it doesn't throw it away), skidding sideways scrubs a little; groomed runs are faster than deep powder
    const e = 4, gx = (heightAt(player.x + e, player.z) - heightAt(player.x - e, player.z)) / (2 * e), gz = (heightAt(player.x, player.z + e) - heightAt(player.x, player.z - e)) / (2 * e);
    const gl = Math.hypot(gx, gz), sinA = gl / Math.sqrt(1 + gl * gl);
    player.yaw += -ix * (1.9 - Math.min(0.9, Math.hypot(player.vx, player.vz) / 40)) * dt;   // turning gets slower at high speed
    const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
    if (gl > 1e-4 && player.onGround) { player.vx += -gx / gl * sinA * 9.8 * dt; player.vz += -gz / gl * sinA * 9.8 * dt; }
    let sp0 = Math.hypot(player.vx, player.vz);
    if (sp0 > 0.05) {
      const va = Math.atan2(player.vx, player.vz), ha = Math.atan2(fx, fz) + (Math.cos(Math.atan2(fx, fz) - va) < 0 ? Math.PI : 0);   // riding switch counts too
      const diff = wrapAngle(ha - va), turn = Math.max(-dt * 3.2, Math.min(dt * 3.2, diff)), na = va + turn;
      sp0 -= sp0 * Math.abs(Math.sin(diff)) * 0.9 * dt;   // skidding sideways scrubs speed
      player.vx = Math.sin(na) * sp0; player.vz = Math.cos(na) * sp0;
    } else { player.vx += fx * 0.6 * dt; player.vz += fz * 0.6 * dt; }
    const groomed = pisteAt?.(player.x, player.z), mu = groomed ? 0.03 : 0.07, tuck = iz > 0, sp1 = Math.hypot(player.vx, player.vz);
    let dec = mu * 9.8 + (tuck ? 0.0012 : 0.0026) * sp1 * sp1 + (iz < 0 ? 6 : 0);   // snow friction + air drag (tuck = less) + S to scrub speed
    if (tuck && sp1 < 6) { player.vx += fx * 1.5 * dt; player.vz += fz * 1.5 * dt; }   // skate / push on the flats
    if (sp1 > 0.01) { const k = Math.max(0, sp1 - dec * dt) / sp1; player.vx *= k; player.vz *= k; }
    const sp = Math.hypot(player.vx, player.vz); const cap = player.goldBoard ? 48 : 40; if (sp > cap) { player.vx *= cap / sp; player.vz *= cap / sp; }
    player.boardSpeed = sp;
    { const want = 65 + Math.min(16, sp * 0.45); if (Math.abs(camera.fov - want) > 0.05) { camera.fov += (want - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); } }   // a rush of speed
    m.kind = player.board === 'ski' ? 'ski' : 'board'; m.amp = 0;
  } else {
    if (camera.fov !== 65) { camera.fov += (65 - camera.fov) * Math.min(1, dt * 3); if (Math.abs(camera.fov - 65) < 0.05) camera.fov = 65; camera.updateProjectionMatrix(); }
    player.runT = run && (ix || iz) && player.onGround ? (player.runT || 0) + dt : run ? player.runT || 0 : 0;
    sprint = Math.min(1, Math.max(0, (player.runT - 0.8) / 1.2));
    const speed = player.swimming ? 2.4 : run ? (player.buffT > 0 ? 11.5 : 8.5) + sprint * 2.5 : (player.buffT > 0 ? 5 : 4.2);
    let mx = camF[0] * iz + camR[0] * ix, mz = camF[1] * iz + camR[1] * ix; const ml = Math.hypot(mx, mz);
    if (ml > 0) { mx /= ml; mz /= ml; player.yaw += wrapAngle(Math.atan2(-mx, -mz) - player.yaw) * Math.min(1, dt * 12); }
    const k = player.onGround || player.swimming ? Math.min(1, dt * 12) : Math.min(1, dt * 2);
    player.vx = lerp(player.vx, mx * speed * (ml > 0 ? 1 : 0), k); player.vz = lerp(player.vz, mz * speed * (ml > 0 ? 1 : 0), k);
    const sp = Math.hypot(player.vx, player.vz);
    m.kind = player.swimming ? 'swim' : (player.attackT > 0 ? 'swing' : 'walk');
    m.amp = player.swimming ? 0.6 : clamp(sp / 4, 0, 1) * (run ? 0.85 : 0.6); m.phase += dt * (player.swimming ? 4 : sp * 2.1);
  }
  player.x += player.vx * dt; player.z += player.vz * dt;
  const preX = player.x, preZ = player.z;
  if (!player.swimming) { collideBuildings(player, 0.35, player.y); collideStatic(player, 0.3, player.y + 0.3); }
  // climb: push into a wall and hold Space (any building; tall ones take a while)
  const pushed = Math.hypot(player.x - preX, player.z - preZ) > 0.001 && (ix || iz);
  player.climbing = pushed && key('Space') && !player.board && !player.swimming;
  if (player.climbing) { player.vy = 3.2; player.onGround = false; m.kind = 'swim'; m.amp = 0.8; m.phase += dt * 6; if (!player.toldClimb) { player.toldClimb = true; ui.toast('🧗 Climbing!', 'Keep holding W + Space. At the top you step onto the roof. (Space in the air on the way down opens a parachute.)', 3500); } }
  // dance (X): people nearby cheer, some join in
  if (tapped('KeyX') && player.onGround) { player.danceT = 6; for (const p of peds) if (Math.hypot(p.x - player.x, p.z - player.z) < 14 && p.state === 'walk') { if (Math.random() < 0.35) { p.state = 'idle'; p.timer = 6; p.kind = 'dance'; } else if (Math.random() < 0.5) say(p, ['Woo!', 'Get it!', '🕺 Yesss', 'Who taught you that?!', 'Is this a TikTok?'][Math.floor(Math.random() * 5)], 2000); } }
  if (player.danceT > 0) { player.danceT -= dt; if (Math.hypot(player.vx, player.vz) > 0.5) player.danceT = 0; else { m.kind = 'dance'; m.phase += dt * 4; m.amp = 1; } }
  // sprinting into people knocks them over
  if (sprint > 0.5 && Math.hypot(player.vx, player.vz) > 9) for (const p of peds) { if (p.state === 'down' || Math.abs(p.x - player.x) > 1 || Math.abs(p.z - player.z) > 1 || Math.hypot(p.x - player.x, p.z - player.z) > 0.8) continue; p.state = 'down'; p.timer = 2.5; p.x += player.vx * 0.08; p.z += player.vz * 0.08; say(p, ['OOF!', 'HEY!', 'Watch it!', 'What the—?!', 'My coffee!!'][Math.floor(Math.random() * 5)], 2000); player.karma -= 0.5; player.vx *= 0.7; player.vz *= 0.7; sfx.bump?.(); }
  const roofOf = v => v.d.roof || (v.d.len > 9 ? 3.2 : v.d.len > 5.2 ? 2.1 : 1.5);   // bus / van-truck / car
  for (const v of vehicles) { if (v.d.kind === 'water' || v.d.show) continue; const dx = player.x - v.x, dz = player.z - v.z, d = Math.hypot(dx, dz), r = Math.min(v.d.len / 2, 2.2); if (d < r && d > 0.01 && Math.abs(v.y - player.y) < 2 && player.y < v.y + roofOf(v) - 0.3) { player.x = v.x + dx / d * r; player.z = v.z + dz / d * r; } }

  // vertical
  let g2 = walkY(player.x, player.z, player.y);
  if (player.board || !player.vehicle) g2 = Math.max(g2, groundY(player.x, player.z));   // stand on the DRAWN snow/ground (never sunk into it)
  { const rb = buildingAt(player.x, player.z); if (rb && !rb.raised && rb.top <= player.y + 0.6 && rb.top > g2) g2 = rb.top; }   // on a roof
  { const ot = topAt(player.x, player.z, 0.3, player.y); if (ot > g2) g2 = ot; }   // on top of a bench, rock, parked car, statue base…
  for (const v of vehicles) {   // on the roof of a car / bus (it carries you along)
    if (v.d.kind === 'water' || v.d.show || v === player.vehicle) continue;
    const dx = player.x - v.x, dz = player.z - v.z; if (Math.abs(dx) > 7 || Math.abs(dz) > 7) continue;
    const s = Math.sin(v.yaw), c = Math.cos(v.yaw), along = dx * s + dz * c, side = dx * c - dz * s, top = v.y + roofOf(v);
    if (Math.abs(along) < v.d.len / 2 - 0.2 && Math.abs(side) < Math.max(0.9, v.d.r) && top <= player.y + 0.45 && top > g2) { g2 = top; if (player.onGround && v.speed) { player.x += (v.vx || 0) * dt; player.z += (v.vz || 0) * dt; } }
  }
  if (player.swimming || (isWater(player.x, player.z) && player.y <= wl + 0.3 && g2 < wl - 0.6)) {
    player.y = lerp(player.y, wl - 1.05, Math.min(1, dt * 5)); player.vy = 0; player.onGround = false;
  } else {
    if (!player.board && !player.climbing) {
      if (key('Space') && player.onGround) player.charge = Math.min(1, (player.charge || 0) + dt);
      else if (player.charge > 0) { if (player.onGround) { player.vy = 6.4 + (player.charge > 0.15 ? player.charge * 12 : 0); player.onGround = false; takeoff(player, player.x, player.z); if (player.charge > 0.6) ui.toast(player.charge >= 1 ? '🚀 MEGA jump!' : '🦘 Super jump!', '', 900); } player.charge = 0; }
      if (tapped('Space') && !player.onGround && player.air && player.air.t > 0.12) {
        if (player.y - g2 > 12 && player.vy < -4 && !player.chute) { player.chute = true; ui.toast('🪂 Parachute!', 'Steer with W A S D. Land softly.', 2200); }
        else if (!player.flipT) { player.flipT = 0.55; player.flipDir = Math.random() < 0.5 ? 1 : -1; }
      }
    }
    if (player.board && player.onGround) {   // ollie on a snowboard / skis: hold Space to crouch + charge, let go to pop
      if (key('Space')) player.charge = Math.min(1, (player.charge || 0) + dt * 1.4);
      else if (player.charge > 0) { player.vy = 8 + player.charge * 9; player.onGround = false; player.y += 0.2; player.charge = 0; }
    }
    const prevY = player.y;
    // hang time: a little floatier than real life, and floatier still while you keep holding Space
    player.vy -= (player.chute ? 3 : !player.onGround && key('Space') && player.vy < 4 ? 12.5 : 17) * dt; if (player.chute) player.vy = Math.max(player.vy, -5);
    player.y += player.vy * dt;
    if (player.board && player.air) airControl(player, dt, -ix, iz > 0 ? -1 : iz < 0 ? 1 : 0, 6, 6);
    if (player.flipT > 0) { player.flipT -= dt; if (player.flipT <= 0) { player.flipT = 0; ui.toast(player.flipDir > 0 ? '🤸 Frontflip!' : '🤸 Backflip!', '', 900); player.stats.flips = (player.stats.flips || 0) + 1; } }
    if (player.y <= g2) {
      const hard = player.vy < -27 && !player.chute;
      if (hard && (key('ShiftLeft') || key('ShiftRight')) && player.vy > -38) { ui.toast('🤸 Roll!', 'Rolled out of it like a pro.', 1200); }
      else if (hard) player.hurt(60, 'fall');
      else if (player.vy < -20 && !player.chute && !player.board) player.hurt(10, 'fall');
      if (player.air) { const r = land(player, player.x, player.z, player.board ? 'board' : 'foot', player); if (r === 'bail' && player.board) { player.vx *= 0.2; player.vz *= 0.2; player.hurt(8, 'crash'); } }
      if (player.board) { player.vy = Math.min(16, Math.max(-30, (g2 - (player.lastG ?? g2)) / Math.max(dt, 1e-3))); }   // keep the slope's speed: crests launch you
      else player.vy = 0;
      player.y = g2; player.onGround = true; player.chute = false; player.flipT = 0;
    } else if (player.y - g2 > 0.4) {
      if (player.onGround && !player.air) { takeoff(player, player.x, player.z); if (player.board && player.charge > 0) { player.vy += 3 + player.charge * 7; player.charge = 0; ui.toast('💥 Popped the lip!', '', 800); } }   // holding Space off a kicker = big air
      player.onGround = false;
    }
    player.lastG = g2;
  }
  player.chuteMesh.visible = player.chute;

  // attack with the hockey stick
  player.attackT -= dt;
  if (G.mouse.click && player.attackT <= 0) {
    player.attackT = 0.45; sfx.swing(); m.swing = 0;
    const hits = hitPedsInFront(player.x, player.z, player.yaw);
    if (hits) { sfx.thwack(); if (hits < 10) player.karma -= 1; }
  }
  player.model.parts.stick.visible = player.attackT > 0 || player.inZombieZone;
  if (player.attackT > 0) m.swing = 1 - player.attackT / 0.45;   // swing progress 0..1
}

// ---------- every frame ----------
export function updatePlayer(dt) {
  if (player.dead) return;
  if (player.transit) return;   // riding the SkyTrain / SeaBus
  if (player.snowRide?.(dt)) return;   // snow tube / toboggan / magic carpet (snowfun.js)
  if (isRiding()) { const st = player.model.st; st.kind = 'sitcar'; st.amp = 0; player.model.grp.visible = true; player.model.grp.position.set(player.x, player.y, player.z); player.model.pose(dt); return; }
  player.health = Math.min(100, player.health + dt * 1.5);
  const v = player.vehicle;
  if (tapped('KeyF')) {
    if (v) player.exitVehicle();
    else {
      const nv = nearestVehicle(player.x, player.z, player.y);
      if (nv) player.enterVehicle(nv);
      else if (player.borrowBoat?.()) { /* a boat tied up in a marina (boats.js) */ }
      else { const ps = takeParked(player.x, player.z, 4.2); if (ps) {   // a car parked at the curb: borrow it
        const car = makeVehicle(ps.t, ps.x, ps.z, ps.yaw, { color: ps.col, y: walkY(ps.x, ps.z) + 0.2 }); player.enterVehicle(car); player.karma -= 1;
        ui.toast('🔑 Borrowed a parked car', ['The owner left the keys in the cupholder. Classic.', 'It smells like air freshener and regret.', 'There\'s a parking ticket on the windshield already.', 'The radio is stuck on smooth jazz.'][Math.floor(Math.random() * 4)] + ' (-1 karma)', 2600); } }
    }
  }
  if (player.vehicle) {
    // bikes / boards / motorbikes / snowmobiles: hold Space to load up, let go to jump (longer hold = more air)
    let hopP = 0; const vd = player.vehicle.d;
    if (vd.show && vd.kind === 'road') { if (key('Space')) player.hopC = Math.min(1, (player.hopC || 0) + dt * 1.3); else if (player.hopC) { hopP = 0.01 + player.hopC; player.hopC = 0; } }
    const input = {
      up: key('KeyW') || key('ArrowUp'), down: key('KeyS') || key('ArrowDown'), steer: (key('KeyA') || key('ArrowLeft') ? 1 : 0) - (key('KeyD') || key('ArrowRight') ? 1 : 0),
      brake: key('Space') && player.vehicle.d.kind !== 'heli' && player.vehicle.d.kind !== 'plane' && !(player.vehicle.d.show && player.vehicle.d.kind === 'road'), jump: key('Space'), hop: hopP, player, onBigHop: () => ui.toast('🚀 Big air!', '', 700),
      onBail: () => { const veh = player.vehicle; player.exitVehicle(true); player.vy = 3; player.hurt(10, 'crash'); if (veh) { veh.speed = 0; veh.air = null; } }, descend: key('KeyX'), boost: key('ShiftLeft') || key('ShiftRight'),   // in the air: X = down / dive, Shift = more power (not Ctrl: Ctrl+W closes the browser tab)
      onCrash: s => { if (G.t < (player.crashCool || 0)) return; player.crashCool = G.t + 0.8;   // one hit = one crash (scraping along a wall/rock used to count every frame)
        player.stats.bumps = (player.stats.bumps || 0) + 1; if (s > 25) { player.hurt(['plane', 'heli'].includes(player.vehicle?.d.kind) ? s * 1.2 : (s - 18) * 2.2, 'crash'); ui.toast('💥 CRASH!', player.vehicle && ['plane', 'heli'].includes(player.vehicle.d.kind) ? 'Hang tight: a mechanic is on the way to patch it up.' : '', player.vehicle && ['plane', 'heli'].includes(player.vehicle.d.kind) ? 4000 : 1200); } },
      onRepair: () => ui.toast('🔧 Patched up!', pick(['A mechanic duct-taped the wing back on. Ready for take-off.', 'Good as new. Mostly.', 'The mechanic says: "Maybe land on the wheels next time?"']), 3000),
      onBumpyLanding: () => { if (G.t > (player.bumpyT || 0)) { player.bumpyT = G.t + 4; ui.toast('🛬 Bumpy landing!', pick(['The passengers clap anyway.', 'Spilled coffee, no damage.', 'Butter it next time!']), 1800); } },
      onSink: () => { if (player.vehicle.type === 'scooter') player.stats.dunked = true; ui.toast('🌊 You drove into the ocean!', 'That\'s not how ferries work.', 2500); sfx.splash(); const veh = player.vehicle; player.exitVehicle(true); veh.driver = null; },
      onHitPed: n => { player.karma -= n; },
    };
    drivePlayer(player.vehicle, dt, input);
    if (tapped('KeyG')) { if (player.vehicle.type === 'bike' || player.vehicle.type === 'scooter') sfx.bikeBell(); else sfx.horn(); for (const p of peds) if (Math.hypot(p.x - player.x, p.z - player.z) < 15 && Math.random() < 0.5) say(p, ['Rude!', 'HEY!', 'Sorry!', '😠'][Math.floor(Math.random() * 4)]); }
    const pv = player.vehicle;
    if (pv) {
      player.x = pv.x; player.z = pv.z; player.y = pv.y; player.yaw = pv.yaw;
      player.flying = (pv.d.kind === 'heli' || pv.d.kind === 'plane') && pv.y - surfaceY(pv.x, pv.z, pv.y) > 3;
      if (pv.d.show) {
        const st = player.model.st; st.kind = pv.d.seat; st.phase += dt * pv.speedAbs * (pv.d.pedal ? 1.6 : 0); st.amp = 0;
        player.model.grp.position.set(pv.x, pv.y + (pv.d.sitY ?? (pv.type === 'scooter' ? 0.2 : pv.type === 'jetski' ? 0.45 : 0.55)), pv.z); player.model.grp.rotation.set(pv.pitch + (pv.air ? pv.air.flip : 0), pv.yaw, pv.roll, 'YXZ');
        player.model.pose(dt);
      }
    }
  } else {
    player.flying = false;
    moveOnFoot(dt);
    const flipA = player.flipT > 0 ? (1 - player.flipT / 0.55) * Math.PI * 2 * player.flipDir : player.air && player.board ? player.air.flip : 0;
    player.model.grp.position.set(player.x, player.y - (player.charge || 0) * 0.35, player.z); const stance = player.board === 'board' ? 1.25 : 0; board.rotation.y = -stance;   // snowboarders ride sideways
    player.model.grp.rotation.set(flipA, player.yaw + stance, 0, 'YXZ');
    player.model.pose(dt);
  }
}

// ---------- third-person camera (stops in front of buildings + trees) ----------
const camTarget = new THREE.Vector3(), camPos = new THREE.Vector3(); let camSmoothY = 0;
let lastMouse = 0, camFrac = 1, camMode = 0, fpHidden = false;
const CAM_MODES = ['🎥 Normal camera', '🔭 Far camera', '👀 First-person view', '🦅 Bird\'s-eye view'];
const _dir = new THREE.Vector3();
// tree crowns near the city, for camera collision (built once)
let treeGrid = null; const TG = 20;
function buildTreeGrid() {
  treeGrid = new Map();
  for (const grp of treeChunks) for (const m of grp.children) {
    if (!m.userData.crown) continue; const { items, part, k } = m.userData;
    for (const t of items) {
      const y0 = t.y + (part.y || 0) * t.h, y1 = y0 + part.sy * t.h, r = t.s * part.sx * 0.85, c = { x: t.x, z: t.z, y0, y1, r, cone: k === 0 || k === 2 };
      const key = Math.floor(t.x / TG) + ',' + Math.floor(t.z / TG); if (!treeGrid.has(key)) treeGrid.set(key, []); treeGrid.get(key).push(c);
    }
  }
}
function treeHit(x, y, z) {
  const a = treeGrid.get(Math.floor(x / TG) + ',' + Math.floor(z / TG)); if (!a) return false;
  for (const c of a) {
    if (y < c.y0 || y > c.y1) continue;
    const rr = c.cone ? c.r * (1 - (y - c.y0) / (c.y1 - c.y0)) : c.r;
    if (Math.abs(x - c.x) < rr && Math.abs(z - c.z) < rr && Math.hypot(x - c.x, z - c.z) < rr) return true;
  }
  return false;
}
// how far along the line from the player to the camera we can go before hitting something (0..1)
function clearFraction(tx, ty, tz, cx, cy, cz) {
  if (!treeGrid) buildTreeGrid();
  const N = 18;
  for (let i = 2; i <= N; i++) {
    const f = i / N, x = tx + (cx - tx) * f, y = ty + (cy - ty) * f, z = tz + (cz - tz) * f;
    const b = buildingAt(x, z); if (b && y < b.top + 0.5 && y > b.base) return (i - 1.5) / N;
    if (treeHit(x, y, z)) return (i - 1.5) / N;
  }
  return 1;
}
export const _camDebug = { clearFraction, treeHit: (x, y, z) => { if (!treeGrid) buildTreeGrid(); return treeHit(x, y, z); } };
export function updateCamera(dt) {
  if (G.mouse.dx || G.mouse.dy) lastMouse = G.t;
  const sens = G.settings?.sens ?? 1, inv = G.settings?.invertY ? -1 : 1;
  G.camYaw -= G.mouse.dx * 0.0025 * sens; G.camPitch = clamp(G.camPitch + G.mouse.dy * 0.0022 * sens * inv, -0.35, 1.35);
  G.camDist = clamp(G.camDist + G.mouse.wheel * 1.2, 2.5, 60);
  if (tapped('KeyC') && !G.dialogOpen && !player.transit) { camMode = (camMode + 1) % 4; ui.toast(CAM_MODES[camMode], 'Press C to switch camera', 1500); }
  const v = player.vehicle;
  // first-person: hide your own body (put it back when you switch away)
  if (camMode === 2 && !player.transit) { player.model.grp.visible = false; fpHidden = true; }
  else if (fpHidden) { fpHidden = false; player.model.grp.visible = !player.transit && (!v || !!v.d.show); }
  if (camMode === 2 && !player.transit) {
    if (v && G.t - lastMouse > 1.2 && v.speedAbs > 2) G.camYaw += wrapAngle(v.yaw - G.camYaw) * Math.min(1, dt * 4);
    const eye = v ? (v.d.kind === 'plane' || v.d.kind === 'heli' ? 2.4 : v.type === 'bus' || v.type === 'yacht' ? 3.0 : v.d.show ? 1.7 : 1.25) : 1.65;
    const fx = -Math.sin(v ? v.yaw : G.camYaw), fz = -Math.cos(v ? v.yaw : G.camYaw), fwd = v ? Math.min(1.5, v.d.len * 0.15) : 0.15;
    camera.position.set(player.x + fx * fwd, player.y + eye, player.z + fz * fwd);
    const p = G.camPitch - 0.25, cp = Math.cos(p);
    _dir.set(-Math.sin(G.camYaw) * cp, -Math.sin(p), -Math.cos(G.camYaw) * cp);
    camera.lookAt(camera.position.x + _dir.x, camera.position.y + _dir.y, camera.position.z + _dir.z);
    return;
  }
  if (camMode === 3 && !player.transit) {
    const up = 55 + (v ? Math.min(60, v.speedAbs * 1.2) : 0) + (player.flying ? 40 : 0);
    camPos.set(player.x + Math.sin(G.camYaw) * 6, player.y + up, player.z + Math.cos(G.camYaw) * 6);
    camera.position.lerp(camPos, Math.min(1, dt * 6)); camera.lookAt(player.x, player.y, player.z);
    return;
  }
  let dist = camMode === 1 ? Math.max(G.camDist * 2.2, 22) : G.camDist, h = 1.6;
  if (v) {
    const base = { heli: 18, seaplane: 22, cessna: 16, jet: 60, jumbo: 95, bus: 16, van: 10 }[v.type] ?? (v.d.show ? 5.5 : 8);
    dist = Math.max(base * (camMode === 1 ? 2 : 1), dist); h = v.d.kind === 'heli' || v.d.kind === 'plane' ? 4 : 1.8;
    // a rush of speed on the ground and water: the view widens as you go faster, and on bikes/boards the camera tucks in
    // low behind you (close to the street, so the road and kerbs stream past)
    if (v.d.kind !== 'plane' && v.d.kind !== 'heli') {
      const sp = Math.abs(v.speed || 0), light = v.d.show;
      const want = 65 + Math.min(light ? 22 : 15, sp * (light ? 1.0 : 0.3));
      if (Math.abs(camera.fov - want) > 0.05) { camera.fov += (want - camera.fov) * Math.min(1, dt * 2.5); camera.updateProjectionMatrix(); }
      if (light && camMode === 0) { dist *= 1 - Math.min(0.25, sp * 0.018); h = 1.8 - Math.min(0.5, sp * 0.035); }
    } else if (camera.fov !== 65) { camera.fov += (65 - camera.fov) * Math.min(1, dt * 3); if (Math.abs(camera.fov - 65) < 0.05) camera.fov = 65; camera.updateProjectionMatrix(); }
    if (G.t - lastMouse > 1.2 && (v.speedAbs > 2 || v.d.kind === 'plane')) { G.camYaw += wrapAngle(v.yaw - G.camYaw) * Math.min(1, dt * 2.5); G.camPitch += ((v.d.kind === 'plane' ? 0.18 - v.pitch * 0.5 : 0.22) - G.camPitch) * Math.min(1, dt * 1.5); }
  } else if (player.board && G.t - lastMouse > 1) G.camYaw += wrapAngle(player.yaw - G.camYaw) * Math.min(1, dt * 2);
  // the camera's height follows a SMOOTHED copy of yours, so little road bumps, curbs and kerb edges don't shake the view
  const moving = v || player.transit, rawY = player.y + h;
  if (!(Math.abs(camSmoothY - rawY) < 6) || !moving) camSmoothY = rawY; else camSmoothY += (rawY - camSmoothY) * Math.min(1, dt * (v && v.d.kind === 'plane' ? 8 : 5));
  camTarget.set(player.x, camSmoothY, player.z);
  const cp = Math.cos(G.camPitch), dx = Math.sin(G.camYaw) * dist * cp, dy = Math.sin(G.camPitch) * dist, dz = Math.cos(G.camYaw) * dist * cp;
  // pull the camera in if a building or tree is in the way; ease back out when it clears. In a vehicle it eases IN too
  // (street trees whizzing past used to make it snap in and out every second)
  const f = player.transit ? 1 : clearFraction(camTarget.x, camTarget.y, camTarget.z, camTarget.x + dx, camTarget.y + dy, camTarget.z + dz);
  camFrac = f < camFrac ? (v ? camFrac + (f - camFrac) * Math.min(1, dt * 9) : f) : camFrac + (f - camFrac) * Math.min(1, dt * 2.5);
  const k = Math.max(camFrac, Math.min(1, 1.6 / dist));
  camPos.set(camTarget.x + dx * k, camTarget.y + dy * k, camTarget.z + dz * k);
  const gy = surfaceY(camPos.x, camPos.z, camPos.y) + 0.6; if (camPos.y < gy) camPos.y = gy; { const cw = waterLevel(camPos.x, camPos.z); if (camPos.y < cw + 0.4 && isWater(camPos.x, camPos.z)) camPos.y = cw + 0.4; }
  camera.position.lerp(camPos, moving ? Math.min(1, dt * 12) : 1);
  camera.lookAt(camTarget);
}
