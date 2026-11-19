// Snow fun: tube parks + toboggan runs at the real mountain spots, snowballs (N) and snowmen (V).
// Real places: Grouse Mountain's Sliding Zone, the Cypress Mountain snow tube park + toboggan area at Hollyburn,
// Mt Seymour's tube park, and the Whistler Blackcomb tube park at Base II. They only open when there's snow.
import * as THREE from 'three';
import { G, scene, std, addMesh, toXZ, tapped, key, clamp, lerp, pick, R, canvasTex } from './core.js';
import { heightAt, isSnow, forestHoles } from './terrain.js';
import { nearestPed, say, makeHuman } from './people.js';
import { ui } from './ui.js';
import { sfx } from './sound.js';

const PARKS = [
  { id: 'grouse', name: 'Grouse Mountain Sliding Zone', lat: 49.3797, lon: -123.0805, kinds: ['tube', 'sled'] },
  { id: 'cypress', name: 'Cypress Snow Tube Park (Hollyburn)', lat: 49.3762, lon: -123.1955, kinds: ['tube', 'sled'] },
  { id: 'seymour', name: 'Mt Seymour Tube Park', lat: 49.3665, lon: -122.9475, kinds: ['tube'] },
  { id: 'whistler', name: 'Whistler Blackcomb Tube Park', lat: 50.0985, lon: -122.9310, kinds: ['tube'] },
];
const PASS = 15, LANES = [-6, 0, 6], CARPET = 11, STEP = 2;
const snowMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });

// ---------- building a park on the real slope ----------
function bestDir(x, z, L) {
  const h0 = heightAt(x, z); let best = { drop: -1e9, a: 0 };
  for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2, d = h0 - heightAt(x + Math.sin(a) * L, z + Math.cos(a) * L); if (d > best.drop) best = { drop: d, a }; }
  return best;
}
// a lane profile that always runs downhill and never digs into bumps (it floats over dips on a snow berm)
function profile(x0, z0, dx, dz, L, flatEnd) {
  const n = Math.round(L / STEP), pts = [];
  for (let i = 0; i <= n; i++) { const x = x0 + dx * i * STEP, z = z0 + dz * i * STEP; pts.push({ x, z, g: heightAt(x, z), y: heightAt(x, z) + 0.3 }); }
  for (let i = 1; i < pts.length - 1; i++) pts[i].y = (pts[i - 1].g + pts[i].g + pts[i + 1].g) / 3 + 0.3;
  for (let i = pts.length - 2; i >= 0; i--) { const minDrop = i * STEP > L - flatEnd ? 0 : 0.09 * STEP; pts[i].y = Math.max(pts[i].y, pts[i + 1].y + minDrop); }
  return pts;
}
// strip mesh: cross-section [offset, height above the profile, colour]; the last/first points are skirts down to the ground
function stripMesh(pts, px, pz, sec) {
  const pos = [], col = [], c = new THREE.Color();
  for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < sec.length - 1; k++) {
    const q = (j, s) => { const p = pts[j], [o, h] = s; return [p.x + px * o, h === 'g' ? p.g - 0.6 : p.y + h, p.z + pz * o]; };
    const a = q(i, sec[k]), b = q(i, sec[k + 1]), d = q(i + 1, sec[k]), e = q(i + 1, sec[k + 1]);
    pos.push(...a, ...d, ...b, ...b, ...d, ...e); c.set(sec[k][2]); for (let t = 0; t < 6; t++) col.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, snowMat); m.receiveShadow = true; return m;
}
const LANE_SEC = [[-2.4, 'g', '#e9eef5'], [-2.2, 0.55, '#dfe8f3'], [-1.6, 0, '#f6f9fc'], [1.6, 0, '#f6f9fc'], [2.2, 0.55, '#dfe8f3'], [2.4, 'g', '#e9eef5']];
const CARPET_SEC = [[-1, 'g', '#e9eef5'], [-0.7, 0.12, '#2d3036'], [0.7, 0.12, '#2d3036'], [1, 'g', '#e9eef5']];

function signTex(text, sub, bg) {
  return canvasTex(512, 160, (c, w, h) => { c.fillStyle = bg; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.textAlign = 'center'; c.font = 'bold 64px sans-serif'; c.fillText(text, w / 2, 80); c.font = '30px sans-serif'; c.fillText(sub, w / 2, 130); }, false);
}
function buildPark(P) {
  const [cx, cz] = toXZ(P.lat, P.lon);
  const L = 150, { a, drop } = bestDir(cx, cz, L), dx = Math.sin(a), dz = Math.cos(a), px = dz, pz = -dx;
  P.dx = dx; P.dz = dz; P.px = px; P.pz = pz; P.top = { x: cx, z: cz, y: heightAt(cx, cz) };
  P.grp = new THREE.Group(); scene.add(P.grp); P.lanesGrp = new THREE.Group(); P.grp.add(P.lanesGrp);
  P.lanes = LANES.map(o => { const pts = profile(cx + px * o, cz + pz * o, dx, dz, L, 22); P.lanesGrp.add(stripMesh(pts, px, pz, LANE_SEC)); return { pts, o, busy: 0 }; });
  P.carpet = profile(cx + px * CARPET, cz + pz * CARPET, dx, dz, L, 0); P.carpet.reverse(); P.lanesGrp.add(stripMesh(P.carpet, -px, -pz, CARPET_SEC));
  // start deck, orange fence at the bottom, booth + sign at the top
  const ty = Math.max(...P.lanes.map(l => l.pts[0].y));
  const deck = addMesh(new THREE.BoxGeometry(30, 3, 9), std('#f2f6fb', { roughness: 0.9 }), cx + px * 2.5 - dx * 4.5, ty - 1.5, cz + pz * 2.5 - dz * 4.5, P.lanesGrp); deck.rotation.y = a;
  const last = P.lanes[1].pts[P.lanes[1].pts.length - 1], orange = std('#f6782a');
  for (let o = -10; o <= 10; o += 2.5) { const x = last.x + dx * 6 + px * o, z = last.z + dz * 6 + pz * o, y = heightAt(x, z); addMesh(new THREE.BoxGeometry(0.08, 1.1, 0.08), std('#555'), x, y + 0.55, z, P.lanesGrp); }
  const fence = addMesh(new THREE.BoxGeometry(21, 0.7, 0.05), orange, last.x + dx * 6, heightAt(last.x + dx * 6, last.z + dz * 6) + 0.7, last.z + dz * 6, P.lanesGrp); fence.rotation.y = a;
  const bx = cx - px * 9 - dx * 6, bz = cz - pz * 9 - dz * 6, by = Math.max(heightAt(bx, bz), ty - 0.3);
  P.booth = { x: bx, z: bz, y: by };
  const hut = new THREE.Group(); hut.position.set(bx, by, bz); hut.rotation.y = a + Math.PI; P.grp.add(hut);
  addMesh(new THREE.BoxGeometry(3.2, 2.6, 2.6), std('#b83a2e'), 0, 1.3, 0, hut);
  addMesh(new THREE.BoxGeometry(3.8, 0.25, 3.2), std('#f4f7fb'), 0, 2.75, 0, hut);   // snowy roof
  addMesh(new THREE.BoxGeometry(2.2, 1, 0.05), std('#cfe7ff', { metalness: 0.3, roughness: 0.2 }), 0, 1.5, 1.31, hut);
  for (let i = 0; i < 4; i++) addMesh(new THREE.TorusGeometry(0.55, 0.28, 8, 16), std(['#1e88e5', '#e53935', '#fdd835', '#43a047'][i]), -1.2 + i * 0.8, 0.28 + (i % 2) * 0.1, 1.8, hut).rotation.x = Math.PI / 2;
  P.signMat = new THREE.MeshBasicMaterial({ map: signTex('🛟 TUBE PARK', P.name, '#1e5aa8') });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.3), P.signMat); sign.position.set(0, 3.7, 1.0); hut.add(sign);
  const sb = sign.clone(); sb.rotation.y = Math.PI; sb.position.z = 0.98; hut.add(sb);
  forestHoles.push({ x: cx + dx * L / 2, z: cz + dz * L / 2, r2: (L / 2 + 25) ** 2 });
  P.open = null; P.drop = drop; P.npcs = [];
}

// ---------- riding ----------
const tubeMesh = new THREE.Group();
addMesh(new THREE.TorusGeometry(0.62, 0.3, 10, 20), std('#1e88e5', { roughness: 0.5 }), 0, 0.3, 0, tubeMesh).rotation.x = Math.PI / 2;
addMesh(new THREE.CylinderGeometry(0.4, 0.4, 0.06, 16), std('#14549a'), 0, 0.12, 0, tubeMesh);
const sledMesh = new THREE.Group();
addMesh(new THREE.BoxGeometry(0.62, 0.12, 1.7), std('#d62828', { roughness: 0.4 }), 0, 0.12, 0, sledMesh);
addMesh(new THREE.BoxGeometry(0.62, 0.35, 0.12), std('#d62828', { roughness: 0.4 }), 0, 0.3, -0.85, sledMesh).rotation.x = -0.5;
tubeMesh.visible = sledMesh.visible = false; scene.add(tubeMesh, sledMesh);

let pl = null, ride = null;   // ride: { P, lane, s, v, off, spin, spinV, kind } or { P, carpet: true, s }
export const snowStats = { runs: 0, snowballs: 0, hits: 0, snowmen: 0 };
function laneAt(pts, s, out) {
  const f = clamp(s / STEP, 0, pts.length - 1.001), i = Math.floor(f), t = f - i, a = pts[i], b = pts[i + 1];
  out.x = lerp(a.x, b.x, t); out.z = lerp(a.z, b.z, t); out.y = lerp(a.y, b.y, t); out.slope = (a.y - b.y) / STEP; return out;
}
const _q = {};
function startRide(P, kind) {
  const free = P.lanes.filter(l => l.busy <= 0), lane = (free.length ? free : P.lanes)[Math.floor(Math.random() * (free.length || P.lanes.length))];
  ride = { P, lane, s: 0, v: 1.5, off: 0, spin: 0, spinV: R(-1.5, 1.5), kind };
  pl.board = false; pl.boardMesh.visible = false; pl.vx = pl.vz = 0;
  ui.toast(kind === 'tube' ? '🛟 Wheee!' : '🛷 Toboggan time!', kind === 'tube' ? 'A/D to nudge the tube · W to push off · it spins, that\'s the fun part' : 'A/D to lean · W to push off · hold on to your hat', 2600);
}
function endRide(atBottom) {
  const r = ride; ride = null; tubeMesh.visible = sledMesh.visible = false;
  if (r && !r.carpet) { const end = laneAt(r.lane.pts, r.s, _q); pl.x = end.x + r.P.px * 2.8 * Math.sign(r.lane.o || 1); pl.z = end.z + r.P.pz * 2.8 * Math.sign(r.lane.o || 1); pl.y = heightAt(pl.x, pl.z); }
  pl.vy = 0; pl.model.st.kind = 'walk'; pl.model.st.amp = 0;
  if (atBottom) { snowStats.runs++; pl.stats.tubeRuns = snowStats.runs; ui.toast('🏁 What a run!', `Run #${snowStats.runs}. Walk to the dark conveyor belt and press E to ride the magic carpet back up.`, 3200); }
}
function updateRide(dt) {
  const m = pl.model;
  if (ride.carpet) {
    ride.s += 6 * dt; if (tapped('Space')) ride.s = 1e9;
    const p = laneAt(ride.P.carpet, ride.s, _q); pl.x = p.x; pl.z = p.z; pl.y = p.y + 0.15;
    pl.yaw = Math.atan2(ride.P.dx, ride.P.dz); m.st.kind = 'walk'; m.st.amp = 0;
    if (ride.s >= (ride.P.carpet.length - 1) * STEP) { ride = null; ui.toast('🔝 Back at the top', 'E at the booth for another run!', 2000); }
  } else {
    const pts = ride.lane.pts, end = (pts.length - 1) * STEP, p = laneAt(pts, ride.s, _q);
    const ix = (key('KeyD') || key('ArrowRight') ? 1 : 0) - (key('KeyA') || key('ArrowLeft') ? 1 : 0);
    const fric = ride.kind === 'sled' ? 0.05 : 0.07, runout = ride.s > end - 22;
    ride.v += (9.8 * p.slope * 0.9 - 9.8 * fric - 0.006 * ride.v * ride.v - (runout ? 2.5 : 0)) * dt;
    if ((key('KeyW') || key('ArrowUp')) && ride.v < 4 && !runout) ride.v += 3 * dt;
    ride.v = clamp(ride.v, 0, ride.kind === 'sled' ? 20 : 17); ride.s += ride.v * dt;
    ride.off += ix * 2.2 * dt * (ride.kind === 'sled' ? 1 : 0.6) + Math.sin(G.t * 1.7 + ride.spin) * 0.15 * dt * ride.v / 8;
    if (Math.abs(ride.off) > 1.25) { ride.off = Math.sign(ride.off) * 1.25; if (ride.kind === 'tube') { ride.spinV = -ride.spinV + R(-1, 1); sfx.thwack?.(); } }
    ride.spin += ride.spinV * dt * (0.4 + ride.v / 8);
    const q = laneAt(pts, ride.s, _q), P = ride.P;
    pl.x = q.x + P.px * ride.off; pl.z = q.z + P.pz * ride.off; pl.y = q.y;
    const fwd = Math.atan2(-P.dx, -P.dz);   // facing downhill
    const mesh = ride.kind === 'tube' ? tubeMesh : sledMesh; tubeMesh.visible = ride.kind === 'tube'; sledMesh.visible = ride.kind === 'sled';
    pl.yaw = ride.kind === 'tube' ? fwd + ride.spin : fwd + ix * 0.15;
    mesh.position.set(pl.x, pl.y, pl.z); mesh.rotation.set(-Math.atan(q.slope) * 0.8, pl.yaw, 0, 'YXZ');
    m.st.kind = 'sit'; m.st.amp = 0;
    if (ride.v > 10 && Math.random() < dt * 0.4) ui.toast(pick(['😱 WHEEEEE!', '🌀 Spinning!', '💨 So fast!', '😂 AAAAAH!']), '', 900);
    if (ride.s >= end - 0.5 || (runout && ride.v < 0.3)) { endRide(true); return; }
  }
  if (!ride) return;
  m.grp.visible = true; m.grp.position.set(pl.x, pl.y + (ride.carpet ? 0 : ride.kind === 'tube' ? 0.42 : 0.2), pl.z); m.grp.rotation.set(0, pl.yaw, 0); m.pose(dt);
}

// ---------- background tubers so the park feels alive ----------
const LOOK = () => ({ skin: pick(['#f1c9a5', '#e0ac7e', '#c68c5e', '#8d5a3b']), hair: pick(['#1b1b1b', '#3b2416', '#d9b36c']), shirt: pick(['#e53e3e', '#3182ce', '#38a169', '#d69e2e', '#805ad5', '#ed64a6']), pants: pick(['#1a202c', '#2c5282', '#4a5568']) });
function updateNPCs(P, dt, near) {
  if (near && P.open && !P.npcs.length) for (let i = 0; i < 4; i++) {
    const h = makeHuman(LOOK()); scene.add(h.grp); const t = tubeMesh.clone(); t.visible = true; scene.add(t);
    P.npcs.push({ h, t, lane: P.lanes[i % 3], s: -R(0, 60), v: 0, spin: R(0, 6), sv: R(-1.5, 1.5) });
  }
  if ((!near || !P.open) && P.npcs.length) { for (const n of P.npcs) { scene.remove(n.h.grp, n.t); } P.npcs = []; }
  for (const n of P.npcs) {
    const pts = n.lane.pts, end = (pts.length - 1) * STEP;
    if (n.s < 0) { n.s += dt * 8; const p = laneAt(pts, 0, _q); n.h.grp.position.set(p.x - P.dx * 3 + P.px * 3, p.y, p.z - P.dz * 3); n.t.position.set(p.x - P.dx * 3 + P.px * 4, p.y, p.z - P.dz * 3); n.h.st.kind = 'walk'; n.h.st.amp = 0; n.h.pose(dt); continue; }
    const p = laneAt(pts, n.s, _q); n.v = clamp(n.v + (9.8 * p.slope * 0.9 - 0.7 - 0.006 * n.v * n.v - (n.s > end - 22 ? 2.5 : 0)) * dt, 0, 15); n.v = Math.max(n.v, n.s < end - 22 ? 1.5 : 0);
    n.s += n.v * dt; n.spin += n.sv * dt;
    if (n.s >= end - 0.5 || (n.s > end - 22 && n.v < 0.3)) { n.s = -R(10, 40); n.v = 0; continue; }
    const q = laneAt(pts, n.s, _q); n.t.position.set(q.x, q.y, q.z); n.t.rotation.y = n.spin;
    n.h.grp.position.set(q.x, q.y + 0.42, q.z); n.h.grp.rotation.y = n.spin; n.h.st.kind = 'sit'; n.h.st.amp = 0; n.h.pose(dt);
  }
}

// ---------- snowballs (N) and snowmen (V) ----------
const ballGeo = new THREE.SphereGeometry(0.11, 8, 6), ballMat = std('#ffffff', { roughness: 0.8 });
const balls = [];
function throwBall() {
  const yaw = G.camYaw, f = [-Math.sin(yaw), -Math.cos(yaw)];
  const b = addMesh(ballGeo, ballMat, pl.x + f[0] * 0.5, pl.y + 1.6, pl.z + f[1] * 0.5, scene, false);
  balls.push({ b, vx: f[0] * 17, vy: 4.5 - G.camPitch * 6, vz: f[1] * 17, t: 0 });
  pl.yaw = Math.atan2(-f[0], -f[1]); pl.attackT = 0.3; snowStats.snowballs++; sfx.swing?.();
}
function updateBalls(dt) {
  for (let i = balls.length - 1; i >= 0; i--) {
    const o = balls[i]; o.t += dt; o.vy -= 9.8 * dt; o.b.position.x += o.vx * dt; o.b.position.y += o.vy * dt; o.b.position.z += o.vz * dt;
    const { x, y, z } = o.b.position, ped = nearestPed(x, z, 0.9);
    let done = y < heightAt(x, z) || o.t > 4;
    if (ped && y - heightAt(x, z) < 2) { done = true; snowStats.hits++; say(ped, pick(['Hey!! 😆', 'Oh, it\'s ON!', 'SNOWBALL FIGHT!', 'Right in the toque!', 'Not the hair! ❄️', 'I will get you back!']), 2200); if (snowStats.hits % 5 === 0) ui.toast('❄️ Snowball sniper', `${snowStats.hits} direct hits. Vancouver has never seen such aim.`, 2000); }
    if (done) { scene.remove(o.b); balls.splice(i, 1); }
  }
}
const snowmen = [];
function snowman(x, z, yaw) {
  const g = new THREE.Group(), white = std('#f7f9fc', { roughness: 0.9 }), coal = std('#111');
  addMesh(new THREE.SphereGeometry(0.55, 14, 10), white, 0, 0.45, 0, g); addMesh(new THREE.SphereGeometry(0.4, 14, 10), white, 0, 1.15, 0, g); addMesh(new THREE.SphereGeometry(0.28, 14, 10), white, 0, 1.68, 0, g);
  addMesh(new THREE.ConeGeometry(0.05, 0.3, 8), std('#ff7a1a'), 0, 1.68, 0.38, g).rotation.x = Math.PI / 2;
  for (const s of [-1, 1]) { addMesh(new THREE.SphereGeometry(0.035, 6, 4), coal, s * 0.1, 1.76, 0.25, g); addMesh(new THREE.CylinderGeometry(0.02, 0.025, 0.7), std('#5a3b22'), s * 0.6, 1.25, 0, g).rotation.z = s * 1.0; }
  for (let i = 0; i < 3; i++) addMesh(new THREE.SphereGeometry(0.04, 6, 4), coal, 0, 1.0 + i * 0.16, 0.39 - Math.abs(i - 1) * 0.02, g);
  addMesh(new THREE.TorusGeometry(0.27, 0.06, 6, 14), std(pick(['#d62828', '#1e5aa8', '#2f855a'])), 0, 1.45, 0, g).rotation.x = Math.PI / 2;
  if (Math.random() < 0.5) addMesh(new THREE.CylinderGeometry(0.2, 0.22, 0.3, 12), coal, 0, 2.0, 0, g);   // top hat
  else addMesh(new THREE.SphereGeometry(0.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), std(pick(['#d62828', '#f6c343', '#805ad5'])), 0, 1.86, 0, g);   // toque
  g.position.set(x, heightAt(x, z), z); g.rotation.y = yaw; scene.add(g); snowmen.push(g);
  if (snowmen.length > 15) scene.remove(snowmen.shift());
}

// ---------- prompts & per-frame update ----------
let checkT = 0;
export function initSnowFun(player) { pl = player; for (const P of PARKS) buildPark(P); player.snowRide = dt => { if (!ride) return false; updateRide(dt); return true; }; }
export function snowFunPrompt(player) {
  if (ride || player.vehicle || player.transit || G.dialogOpen) return '';
  for (const P of PARKS) {
    const db = Math.hypot(P.booth.x - player.x, P.booth.z - player.z);
    if (db < 7) {
      if (!P.open) { if (tapped('KeyE')) ui.toast('⛔ Closed for the season', 'The tube park opens when there\'s snow. Tip: phone → World → Winter.', 3500); return `<kbd>E</kbd> 🛟 ${P.name} (closed)`; }
      if (tapped('KeyE')) openBooth(P);
      return `<kbd>E</kbd> 🛟 ${P.name}${P.pass ? ' (day pass ✓)' : ''}`;
    }
    if (P.open) { const b = P.carpet[0]; if (Math.hypot(b.x - player.x, b.z - player.z) < 7) { if (tapped('KeyE')) { ride = { P, carpet: true, s: 0 }; ui.toast('🟫 Magic carpet', 'The conveyor belt takes you back up. Space = skip.', 2000); } return '<kbd>E</kbd> 🟫 Ride the magic carpet up'; } }
  }
  return '';
}
async function openBooth(P) {
  const opts = P.kinds.map(k => k === 'tube' ? '🛟 Snow tube' : '🛷 Toboggan');
  const i = await ui.dialog('🛟 ' + P.name, P.pass ? 'Your day pass is good all day. Pick your ride!' : `Day pass: <b>$${PASS}</b>. Unlimited runs, magic carpet included.`, [...opts.map(o => P.pass ? o : `${o} ($${PASS} day pass)`), ...(P.pass ? [] : ['🤫 Sneak under the rope (free, -1 karma)']), 'Never mind']);
  if (i < 0 || i >= opts.length + (P.pass ? 0 : 1)) return;
  if (!P.pass) {
    if (i < opts.length && pl.money >= PASS) { pl.money -= PASS; sfx.coin?.(); P.pass = true; }
    else { pl.karma -= 1; ui.toast(i < opts.length ? '💳 Card declined…' : '🤫 Sneaky!', 'You duck under the rope. The liftie in the booth just sighs. (-1 karma)', 2500); P.pass = true; }
  }
  startRide(P, P.kinds[i < opts.length ? i : 0]);
}
export function updateSnowFun(dt, player) {
  checkT -= dt;
  if (checkT < 0) { checkT = 2; for (const P of PARKS) { const o = isSnow(P.top.x, P.top.z, P.top.y); if (o !== P.open) { P.open = o; P.lanesGrp.visible = o; P.signMat.map = signTex(o ? '🛟 TUBE PARK' : '⛔ CLOSED', o ? P.name : 'Opens with the snow', o ? '#1e5aa8' : '#7a2d2d'); } } }
  for (const P of PARKS) updateNPCs(P, dt, Math.hypot(P.top.x - player.x, P.top.z - player.z) < 450);
  updateBalls(dt);
  if (ride || player.vehicle || player.transit || player.board || G.dialogOpen) return;
  const snowy = isSnow(player.x, player.z);
  if (tapped('KeyN')) { if (snowy && player.onGround) throwBall(); else ui.toast('No snow here', 'Snowballs need snow: head up the mountains (or wait for winter).', 1800); }
  if (tapped('KeyV')) {
    if (snowy && player.onGround) { const f = [-Math.sin(player.yaw), -Math.cos(player.yaw)]; snowman(player.x + f[0] * 1.6, player.z + f[1] * 1.6, player.yaw + Math.PI); snowStats.snowmen++; player.stats.snowmen = snowStats.snowmen; ui.toast('⛄ You built a snowman!', snowStats.snowmen === 1 ? 'Carrot nose and everything. (V builds another)' : `Snowman #${snowStats.snowmen}. An army is forming.`, 2200); }
    else ui.toast('No snow here', 'Snowmen need snow: head up the mountains (or wait for winter).', 1800);
  }
}
export const _parks = PARKS;   // for tests
export const snowMarkers =() => PARKS.filter(P => P.top).map(P => ({ x: P.booth.x, z: P.booth.z, icon: '🛟' }));
