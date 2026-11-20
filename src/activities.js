// Places are used for what they are: every sports pitch, court, skatepark, track, playground and golf course near you comes
// alive with people doing that thing — and you can join in. Every game starts with a how-to card (Space to start,
// Esc to quit), has a score card while you play, and offers E = play again at the end.
//   tennis / pickleball → a match vs the local (auto-run to the ball, Space to swing on time, A/D aim, W smash, S drop shot)
//   basketball          → 10-shot shoot-around from 5 spots (hold Space, let go in the green zone)
//   soccer / fields     → kickabout (dribble by walking into the ball, Space = shoot at the goal you face) or E = penalties
//   golf courses        → driving challenge;  pitch & putt / putting greens → 3 holes of pitch & putt with aim line
//   lawn bowling greens → 2 ends of lawn bowls vs a club member (the bowl curves: the dotted line shows where)
//   table tennis tables → ping pong (minigames.js overlay)
//   skateparks          → borrow a board;  tracks → joggers;  playgrounds → kids;  other fields → frisbee / catch
// Sport comes from the map (OSM `sport=*`, stored as area.sp); untagged pitches are guessed from their size.
import * as THREE from 'three';
import { G, scene, std, key, tapped, pick, R, inPoly, wrapAngle, clamp } from './core.js';
import { groundY } from './terrain.js';
import { addDeck, nearestRoad, isDriveType, buildingAt } from './city.js';
import { Crowd, newLook } from './people.js';
import { makeVehicle } from './vehicles.js';
import { activeMission, discover } from './missions.js';
import { openGame } from './minigames.js';
import { ui } from './ui.js';
import { sfx } from './sound.js';
const onRoad = (x, z) => { const r = nearestRoad(x, z, 14, q => isDriveType(q.t)); return (r && r.d < r.road.w / 2 + 1.5) || buildingAt(x, z); };

const NEAR = 300, CAP = 110;
let pl = null, crowd = null, venues = [], at = null, people = [];
const ballGeo = new THREE.SphereGeometry(1, 12, 9), discGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.025, 14);
const BALLS = { tennis: std('#d9f22e', { roughness: 0.6 }), basket: std('#e0702a', { roughness: 0.7 }), soccer: std('#f4f4f4', { roughness: 0.5 }), golf: std('#ffffff', { roughness: 0.3 }), disc: std('#ff5a1f', { roughness: 0.4 }), bowlA: std('#1a1a1a', { roughness: 0.25, metalness: 0.2 }), bowlB: std('#7a1f2b', { roughness: 0.25, metalness: 0.2 }), jack: std('#fffde8', { roughness: 0.3 }) };
const SIZE = { tennis: 0.05, basket: 0.12, soccer: 0.11, golf: 0.045, disc: 1, bowlA: 0.11, bowlB: 0.11, jack: 0.055 };

// ---------- venue geometry: oriented box of the polygon ----------
function obb(p) {
  let best = 0, ux = 1, uz = 0;
  for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length, dx = p[j] - p[i], dz = p[j + 1] - p[i + 1], L = Math.hypot(dx, dz); if (L > best) { best = L; ux = dx / L; uz = dz / L; } }
  const vx = -uz, vz = ux; let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
  for (let i = 0; i < p.length; i += 2) { const u = p[i] * ux + p[i + 1] * uz, v = p[i] * vx + p[i + 1] * vz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  return { x: cu * ux + cv * vx, z: cu * uz + cv * vz, ux, uz, vx, vz, L: u1 - u0, W: v1 - v0 };
}
const SPORT = s => /table_tennis/.test(s) ? 'pingpong' : /tennis|pickleball|badminton|padel/.test(s) ? 'tennis' : /basketball/.test(s) ? 'basket' : /soccer|football|rugby|field_hockey|lacrosse|ultimate/.test(s) ? 'soccer' : /skateboard|bmx|roller/.test(s) ? 'skate' : /running|athletics/.test(s) ? 'track' : /baseball|softball|cricket/.test(s) ? 'ball' : /golf/.test(s) ? 'golf' : /bowls/.test(s) ? 'bowls' : /volleyball/.test(s) ? 'field' : s ? 'field' : '';
function guess(o) { const L = o.L, W = o.W; if (L > 50) return 'soccer'; if (L > 21 && L < 40 && W > 9 && W < 22) return L < 30 ? 'tennis' : 'basket'; return 'field'; }
const local = (V, u, v) => [V.x + V.ux * u + V.vx * v, V.z + V.uz * u + V.vz * v];   // venue coords (u along, v across) → world
const toUV = (V, x, z) => { const dx = x - V.x, dz = z - V.z; return [dx * V.ux + dz * V.uz, dx * V.vx + dz * V.vz]; };
const boxDist = (V, x, z) => { const [u, v] = toUV(V, x, z); return Math.hypot(Math.max(0, Math.abs(u) - V.L / 2), Math.max(0, Math.abs(v) - V.W / 2)); };
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);   // the yaw that faces along (dx, dz) (forward = (-sin, -cos))

// one merged, vertex-coloured mesh per venue for its props (nets, hoops, goals, ramps)
function propBuilder() {
  const pos = [], nor = [], colA = [], c = new THREE.Color();
  return {
    add(geo, color, x, y, z, yaw = 0, rx = 0) { const g = (geo.index ? geo.toNonIndexed() : geo.clone()); g.rotateX(rx); g.rotateY(yaw); g.translate(x, y, z); c.set(color); pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); for (let i = 0; i < g.attributes.position.count; i++) colA.push(c.r, c.g, c.b); },
    build() { if (!pos.length) return null; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colA, 3)); const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })); m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; },
  };
}
function courtLines(V, kind) {   // painted court surface + lines
  const t = document.createElement('canvas'); t.width = 256; t.height = 512; const g = t.getContext('2d');
  g.fillStyle = kind === 'tennis' ? '#3d6e4f' : kind === 'bowls' ? '#4f8f3a' : '#9a5a3c'; g.fillRect(0, 0, 256, 512); g.strokeStyle = '#f2f2f2'; g.lineWidth = 4;
  if (kind === 'tennis') { g.strokeRect(20, 20, 216, 472); g.strokeRect(46, 20, 164, 472); g.beginPath(); g.moveTo(46, 146); g.lineTo(210, 146); g.moveTo(46, 366); g.lineTo(210, 366); g.moveTo(128, 146); g.lineTo(128, 366); g.stroke(); }
  else if (kind === 'bowls') { g.fillStyle = '#58993f'; for (let y = 0; y < 512; y += 64) g.fillRect(0, y, 256, 32); g.strokeStyle = '#ffffff88'; g.lineWidth = 2; for (const x of [64, 128, 192]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); } }
  else { g.strokeRect(14, 14, 228, 484); g.beginPath(); g.moveTo(14, 256); g.lineTo(242, 256); g.stroke(); g.beginPath(); g.arc(128, 256, 36, 0, 7); g.stroke(); for (const y of [14, 498]) { g.beginPath(); g.arc(128, y, 90, y < 100 ? 0 : Math.PI, y < 100 ? Math.PI : Math.PI * 2); g.stroke(); g.strokeRect(96, y < 100 ? 14 : 418, 64, 80); } }
  const tex = new THREE.CanvasTexture(t); tex.colorSpace = THREE.SRGBColorSpace;
  const L = kind === 'bowls' ? V.L - 1 : Math.min(V.L, kind === 'tennis' ? 24 : 28), W = kind === 'bowls' ? V.W - 1 : Math.min(V.W, kind === 'tennis' ? 11 : 15);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(W, L).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.position.set(V.x, groundY(V.x, V.z) + 0.04, V.z); m.rotation.y = Math.atan2(V.ux, V.uz); m.receiveShadow = true; scene.add(m); return m;
}
function person(V, u, v, extra = {}) { const [x, z] = local(V, u, v); const look = newLook(); look.coat = null; look.scarf = null; look.bag = null; if (G.season !== 'winter') look.shirt = pick(['#ffffff', '#e53e3e', '#3182ce', '#f6e05e', '#38a169', '#1a202c', '#ed64a6']); const p = { x, z, y: groundY(x, z), yaw: 0, cols: look, state: 'idle', kind: 'walk', phase: Math.random() * 6, amp: 0, visible: true, dirty: true, sc: extra.sc, ...extra }; people.push(p); return p; }
function ballMesh(kind) { const m = new THREE.Mesh(kind === 'disc' ? discGeo : ballGeo, BALLS[kind]); m.scale.setScalar(SIZE[kind]); m.castShadow = true; scene.add(m); return m; }

// ---------- building the venues near you ----------
function buildVenue(a) {
  const V = obb(a.p); V.name = a.n !== undefined ? window.MAP.names[a.n] || '' : '';
  V.kind = SPORT(a.sp || '') || (a.k === 'golf' ? 'golf' : a.k === 'playground' ? 'play' : guess(V));
  if (V.kind === 'golf' && (a.k === 'pitch' || /pitch|putt|par 3|chipping/i.test(V.name))) V.kind = 'putt';
  V.a = a; V.np = []; V.meshes = [];
  const P = propBuilder(), yaw = Math.atan2(V.ux, V.uz), gy = groundY(V.x, V.z);
  const at2 = (u, v) => { const [x, z] = local(V, u, v); return [x, groundY(x, z), z]; };
  if (V.kind === 'tennis') {
    V.meshes.push(courtLines(V, 'tennis'));
    const nw = Math.min(V.W, 12.8);
    for (const s of [-1, 1]) { const [x, y, z] = at2(0, s * nw / 2); P.add(new THREE.CylinderGeometry(0.04, 0.04, 1.07, 6), '#333333', x, y + 0.53, z); }
    { const [x, y, z] = at2(0, 0); P.add(new THREE.BoxGeometry(nw, 0.9, 0.02), '#1a1a1a', x, y + 0.5, z, yaw); P.add(new THREE.BoxGeometry(nw, 0.06, 0.03), '#ffffff', x, y + 0.95, z, yaw); }
    V.b = clamp(V.L / 2 - 1.2, 4, 11.5); V.hw = clamp(V.W / 2 - 1, 2, 4.1);
    V.A = person(V, -V.b, 0, { racket: true }); V.B = person(V, V.b, 0, { racket: true }); V.ball = ballMesh('tennis'); V.t = 0; V.dir = 1; V.tv = 0;
  } else if (V.kind === 'pingpong') {   // an outdoor concrete ping-pong table
    const [x, y, z] = at2(0, 0);
    P.add(new THREE.BoxGeometry(1.525, 0.06, 2.74), '#2b5d8a', x, y + 0.74, z, yaw); P.add(new THREE.BoxGeometry(1.53, 0.005, 0.03), '#ffffff', x, y + 0.775, z, yaw); P.add(new THREE.BoxGeometry(0.02, 0.005, 2.74), '#ffffff', x, y + 0.775, z, yaw);
    P.add(new THREE.BoxGeometry(1.75, 0.15, 0.02), '#dddddd', x, y + 0.85, z, yaw); P.add(new THREE.BoxGeometry(0.5, 0.72, 1.6), '#8a8a85', x, y + 0.36, z, yaw);
    V.L = Math.max(V.L, 4); V.W = Math.max(V.W, 3);
  } else if (V.kind === 'basket') {
    if (V.W > 9 || V.L > 18) V.meshes.push(courtLines(V, 'basket'));
    V.hoops = [];
    for (const s of V.L > 18 ? [-1, 1] : [1]) {
      const hu = s * (Math.min(V.L, 28) / 2 - 1.2), [x, y, z] = at2(hu + s * 0.9, 0), [rx, ry, rz] = at2(hu, 0);
      P.add(new THREE.CylinderGeometry(0.08, 0.1, 3.4, 8), '#3a3f45', x, y + 1.7, z); P.add(new THREE.BoxGeometry(1.8, 1.05, 0.05), '#f4f4f4', rx + V.ux * s * 0.3, y + 3.3, rz + V.uz * s * 0.3, yaw);
      P.add(new THREE.TorusGeometry(0.23, 0.02, 6, 16), '#e04a1a', rx, y + 3.05, rz, 0, Math.PI / 2);
      V.hoops.push({ x: rx, y: y + 3.05, z: rz, s });
    }
    V.shooters = [person(V, -2, 1.5), person(V, 2, -2), person(V, 4, 2)]; V.ball = ballMesh('basket'); V.t = 0; V.who = 0;
  } else if (V.kind === 'soccer') {
    for (const s of [-1, 1]) { const [x, y, z] = at2(s * (V.L / 2 - 1), 0); for (const w of [-3.66, 3.66]) { const [px, , pz] = at2(s * (V.L / 2 - 1), w); P.add(new THREE.BoxGeometry(0.12, 2.44, 0.12), '#ffffff', px, y + 1.22, pz); } P.add(new THREE.BoxGeometry(7.4, 0.12, 0.12), '#ffffff', x, y + 2.44, z, yaw); V['goal' + s] = { x, z, s }; }
    V.players = []; for (let i = 0; i < 8; i++) V.players.push(person(V, R(-V.L * 0.35, V.L * 0.35), R(-V.W * 0.35, V.W * 0.35), { tm: i % 2 }));
    V.ball = ballMesh('soccer'); V.bx = V.x; V.bz = V.z; V.by = gy + 0.11; V.bvx = 0; V.bvz = 0; V.bvy = 0; V.pass = { from: 0, to: 1, t: 0 };
  } else if (V.kind === 'skate') {
    // concrete quarter pipes at both ends, a fun box and a rail in the middle (all decks: ride them with the skateboard)
    const conc = '#b8b5ad';
    for (const s of [-1, 1]) { const u = s * (V.L / 2 - 3), [x, y, z] = at2(u, 0), w = Math.min(V.W * 0.8, 10); if (onRoad(x, z) || onRoad(...local(V, u - s * 3, 0))) continue; for (let k = 0; k < 6; k++) { const hh = 0.35 * (k + 1); P.add(new THREE.BoxGeometry(w, hh, 0.55), conc, x - V.ux * s * k * 0.5, y + hh / 2, z - V.uz * s * k * 0.5, yaw); } const [x0, y0, z0] = at2(u - s * 3, 0); addDeck(x0, z0, y0, x, z, y + 2.1, w / 2); }
    if (!onRoad(...local(V, -2.5, -V.W * 0.2)) && !onRoad(...local(V, 2.5, -V.W * 0.2))) { const [x, y, z] = at2(0, -V.W * 0.2); P.add(new THREE.BoxGeometry(2.2, 0.5, 5), conc, x, y + 0.25, z, yaw); const [ax, , az] = at2(-2.5, -V.W * 0.2), [bx, , bz] = at2(2.5, -V.W * 0.2); addDeck(ax, az, y + 0.5, bx, bz, y + 0.5, 1.1); }
    if (!onRoad(...local(V, -3, V.W * 0.22)) && !onRoad(...local(V, 3, V.W * 0.22))) { const [x, y, z] = at2(0, V.W * 0.22); P.add(new THREE.BoxGeometry(0.06, 0.06, 6), '#c9ced3', x, y + 0.45, z, yaw); for (const u of [-2.5, 2.5]) { const [px, py, pz] = at2(u, V.W * 0.22); P.add(new THREE.BoxGeometry(0.05, 0.45, 0.05), '#c9ced3', px, py + 0.22, pz); } }
    V.skaters = []; V.lim = Math.min(V.L / 2 - 4, 20);
    for (let i = 0; i < 4; i++) { const v = R(-V.W / 3, V.W / 3); if (onRoad(...local(V, -V.lim, v)) || onRoad(...local(V, V.lim, v)) || onRoad(...local(V, 0, v))) continue; V.skaters.push(person(V, 0, v, { skate: true, sp: R(3, 6), dir: Math.random() < 0.5 ? 1 : -1, v })); }
  } else if (V.kind === 'track') {
    V.runners = []; for (let i = 0; i < 5; i++) V.runners.push(person(V, 0, 0, { run: true, ang: Math.random() * 6.28, sp: R(2.6, 4) }));
  } else if (V.kind === 'play') {
    V.kids = []; for (let i = 0; i < 5; i++) V.kids.push(person(V, R(-V.L / 3, V.L / 3), R(-V.W / 3, V.W / 3), { sc: R(0.55, 0.7), kid: true, tx: 0, tz: 0, tt: 0 }));
  } else if (V.kind === 'golf' || V.kind === 'putt') {
    V.golfers = []; for (let i = 0; i < 3; i++) { const g = person(V, R(-V.L / 3, V.L / 3), R(-V.W / 3, V.W / 3), { golfer: true, t: Math.random() * 8 }); if (!inPoly(g.x, g.z, a.p)) { g.visible = false; g.off = true; } g.cols.shirt = pick(['#ffffff', '#f6e05e', '#ed64a6', '#63b3ed']); g.cols.pants = pick(['#c4b59a', '#2d3748', '#ffffff']); g.cols.hat = '#ffffff'; V.golfers.push(g); }
  } else if (V.kind === 'bowls') {   // a lawn bowling green: striped turf, white-clad bowlers rolling woods
    V.meshes.push(courtLines(V, 'bowls'));
    V.bowlers = []; for (let i = 0; i < 2; i++) { const b = person(V, -V.L / 2 + 2, (i - 0.5) * V.W * 0.4, { bowler: true, t: Math.random() * 6 }); b.cols.shirt = '#ffffff'; b.cols.pants = '#ffffff'; b.cols.hat = '#f4f1e6'; V.bowlers.push(b); }
  } else {   // 'field' / 'ball': two people playing catch or frisbee
    V.A = person(V, -9, 0); V.B = person(V, 9, 0); V.ball = ballMesh(V.kind === 'ball' ? 'tennis' : 'disc'); if (V.kind === 'ball') V.ball.scale.setScalar(0.037); V.t = 0; V.dir = 1;
  }
  const m = P.build(); if (m) V.meshes.push(m);
  return V;
}
function clearVenues() { for (const V of venues) { for (const m of V.meshes) { scene.remove(m); m.geometry.dispose(); } if (V.ball) scene.remove(V.ball); } venues = []; people = []; }
function rebuild(px, pz) {
  if (game) return;   // don't rebuild under a running game
  clearVenues(); at = [px, pz];
  const list = [];
  for (const a of window.MAP.areas) {
    if (a.line || !(a.k === 'pitch' || a.k === 'playground' || a.k === 'golf')) continue;
    const x = a.p[0], z = a.p[1], far = a.k === 'golf' ? 2500 : NEAR + 300; if (Math.abs(x - px) > far || Math.abs(z - pz) > far) continue;
    const o = obb(a.p); const d = Math.max(0, Math.hypot(o.x - px, o.z - pz) - Math.max(o.L, o.W) / 2); if (d > NEAR) continue;   // distance to the venue's EDGE (golf courses are huge)
    if (a.k === 'golf' && (o.L < 80) && !(a.n !== undefined && /putt|pitch|par 3/i.test(window.MAP.names[a.n] || ''))) continue;
    list.push({ a, d });
  }
  list.sort((p, q) => p.d - q.d);
  for (const { a } of list.slice(0, 16)) { if (people.length > CAP - 10) break; venues.push(buildVenue(a)); }
}

// ---------- ambient play ----------
const arc = (ax, ay, az, bx, by, bz, t, h) => [ax + (bx - ax) * t, ay + (by - ay) * t + Math.sin(Math.PI * t) * h, az + (bz - az) * t];
function faceTo(p, x, z) { p.yaw = Math.atan2(-(x - p.x), -(z - p.z)); }
function stepTo(p, x, z, sp, dt) { const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz); if (d < 0.2) { p.amp = 0; p.kind = 'walk'; return true; } const s = Math.min(d, sp * dt); p.x += dx / d * s; p.z += dz / d * s; p.y = groundY(p.x, p.z); faceTo(p, x, z); p.kind = 'walk'; p.amp = Math.min(0.9, sp / 4); p.phase += dt * sp * 3.2; return false; }
function swingPose(p, dt) { if (p.swingT > 0) { p.swingT -= dt; p.kind = 'swing'; p.swing = 1 - p.swingT / 0.45; } }
function updateVenue(V, dt) {
  if (V === game?.V) return;   // the mini-game drives this one
  if (V.kind === 'tennis' || V.kind === 'field' || V.kind === 'ball') {
    const A = V.A, B = V.B, from = V.dir > 0 ? A : B, to = V.dir > 0 ? B : A, dur = V.kind === 'tennis' ? 1.25 : 1.8, bl = V.b || 9;
    V.t += dt / dur;
    if (!V.tgt) { V.tgt = local(V, (V.dir > 0 ? bl : -bl) + R(-1.5, 1.5), R(-3, 3) * (V.kind === 'tennis' ? V.hw / 4 : 1)); }
    stepTo(to, V.tgt[0], V.tgt[1], 3, dt); faceTo(from, to.x, to.z); swingPose(A, dt); swingPose(B, dt);
    const [x, y, z] = arc(from.x, from.y + 1.1, from.z, V.tgt[0], groundY(V.tgt[0], V.tgt[1]) + 1.1, V.tgt[1], Math.min(1, V.t), V.kind === 'tennis' ? 1.6 : 2.6);
    V.ball.position.set(x, y, z); if (V.kind === 'field') V.ball.rotation.y += dt * 12;
    if (V.t >= 1) { V.t = 0; V.dir *= -1; to.swingT = V.kind === 'tennis' ? 0.45 : 0; V.tgt = null; if (V.kind === 'tennis' && Math.random() < 0.08) { V.t = -1.2; } }   // the odd missed ball (a pause)
  } else if (V.kind === 'basket') {
    const s = V.shooters[V.who], h = V.hoops[0]; V.t += dt;
    for (const p of V.shooters) if (p !== s) { p.kind = 'walk'; p.amp = 0; faceTo(p, h.x, h.z); }
    if (V.t < 1.2) { faceTo(s, h.x, h.z); s.kind = 'walk'; s.amp = 0; V.ball.position.set(s.x, s.y + 1.2 + Math.abs(Math.sin(V.t * 8)) * -0.8 + 0.4, s.z); }
    else if (V.t < 2.2) { const t = V.t - 1.2; V.made = V.made ?? Math.random() < 0.55; const [x, y, z] = arc(s.x, s.y + 2.1, s.z, h.x, h.y + (V.made ? 0 : 0.15), h.z, t, 1.6); V.ball.position.set(x, y, z); }
    else if (V.t < 2.9) { const t = V.t - 2.2; V.ball.position.set(h.x + (V.made ? 0 : t * 1.5), h.y - t * 4.2, h.z + (V.made ? 0 : t)); V.ball.position.y = Math.max(V.ball.position.y, groundY(h.x, h.z) + 0.12); }
    else { V.t = 0; V.made = undefined; V.who = (V.who + 1) % V.shooters.length; }
    V.ball.rotation.x += dt * 8;
  } else if (V.kind === 'skate') for (const s of V.skaters) { const L = V.lim; s.u = s.u ?? R(-L, L); s.u += s.dir * s.sp * dt; if (Math.abs(s.u) > L) { s.dir *= -1; s.u = Math.sign(s.u) * L; } const [x, z] = local(V, s.u, s.v ?? (s.v = R(-V.W / 3, V.W / 3))); s.x = x; s.z = z; s.hop = Math.max(0, (s.hop || 0) - dt); if (!s.hop && Math.random() < dt * 0.4) s.hop = 0.5; s.y = groundY(x, z) + 0.14 + (s.hop ? Math.sin((0.5 - s.hop) / 0.5 * Math.PI) * 0.6 : 0); s.yaw = Math.atan2(-(V.ux * s.dir), -(V.uz * s.dir)) + 1.2; s.kind = 'board'; s.amp = 0; }
  else if (V.kind === 'track') for (const r of V.runners) { r.ang += dt * r.sp / (V.L * 0.4); const [x, z] = local(V, Math.cos(r.ang) * V.L * 0.42, Math.sin(r.ang) * V.W * 0.4); stepTo(r, x, z, r.sp * 1.4, dt); r.amp = 0.95; }
  else if (V.kind === 'play') for (const k of V.kids) { k.tt -= dt; if (k.tt < 0) { k.tt = R(1, 4); [k.tx, k.tz] = local(V, R(-V.L / 3, V.L / 3), R(-V.W / 3, V.W / 3)); } stepTo(k, k.tx, k.tz, 3.2, dt); }
  else if (V.kind === 'golf' || V.kind === 'putt') for (const g of V.golfers) { g.t += dt; const c = g.t % 9; if (c < 1.6) { g.kind = 'swing'; g.swing = Math.min(1, c / 1.2); } else { g.kind = 'walk'; g.amp = 0; } }
  else if (V.kind === 'bowls') for (const b of V.bowlers) { b.t += dt; const c = b.t % 7; faceTo(b, ...local(V, V.L / 2, 0)); b.kind = c < 1 ? 'swing' : 'walk'; b.swing = Math.min(1, c); b.amp = 0; }
}
function updateSoccer(V, dt, daylight) {
  const live = boxDist(V, pl.x, pl.z) < 4 && !pl.vehicle;
  const ps = daylight ? V.players : [];
  if (!live && !V.free && ps.length) {   // a passing drill: the ball rolls from one player to another
    const P0 = ps[V.pass.from], P1 = ps[V.pass.to]; V.pass.t += dt / 1.6;
    stepTo(P1, P1.x, P1.z, 0, dt); faceTo(P1, P0.x, P0.z); faceTo(P0, P1.x, P1.z);
    V.bx = P0.x + (P1.x - P0.x) * Math.min(1, V.pass.t); V.bz = P0.z + (P1.z - P0.z) * Math.min(1, V.pass.t); V.by = groundY(V.bx, V.bz) + 0.11;
    if (V.pass.t >= 1) { V.pass = { from: V.pass.to, to: Math.floor(Math.random() * ps.length), t: 0 }; if (V.pass.to === V.pass.from) V.pass.to = (V.pass.to + 1) % ps.length; }
    for (const p of ps) if (p !== P0 && p !== P1) { p.kind = 'walk'; p.amp = 0; }
  } else if (!(game?.V === V && game.kind === 'pens')) {   // live ball: dribble by walking into it, Space = shoot; goals count
    const kick = (vx, vz, up) => { V.bvx = vx; V.bvz = vz; V.bvy = up; sfx.bump?.(); };
    const dpl = Math.hypot(pl.x - V.bx, pl.z - V.bz), ps2 = Math.hypot(pl.vx || 0, pl.vz || 0);
    if (!V.free && live) {   // you walked on: a local passes you the ball
      const dx = pl.x - V.bx, dz = pl.z - V.bz, d = Math.hypot(dx, dz) || 1, v = Math.min(14, d * 0.62 + 1.5); kick(dx / d * v, dz / d * v, 0.5); V.lastKick = 'them';
      if (!V.toldSoccer) { V.toldSoccer = true; ui.toast('⚽ "Hey! Join in!"', 'A local passes you the ball. Walk into it to dribble, press Space near it to shoot at the goal you face. (E = penalty shootout)', 4500); }
    }
    V.free = true;
    // only the two nearest locals chase the ball, and they give you room (no tackling) while you have it
    const byDist = [...ps].sort((p, q) => Math.hypot(p.x - V.bx, p.z - V.bz) - Math.hypot(q.x - V.bx, q.z - V.bz)), mine = live && dpl < 3.2;
    for (let i = 0; i < byDist.length; i++) { const p = byDist[i]; if (i < 2 && !mine) stepTo(p, V.bx, V.bz, i === 0 ? 3.4 : 2.4, dt); else if (i < 2 && mine && Math.hypot(p.x - pl.x, p.z - pl.z) > 4) stepTo(p, pl.x, pl.z, 1.5, dt); else { p.kind = 'walk'; p.amp = 0; faceTo(p, V.bx, V.bz); } }
    const near = byDist[0], nd = near ? Math.hypot(near.x - V.bx, near.z - V.bz) : 99;
    if (near && nd < 0.8 && !mine && Math.hypot(V.bvx, V.bvz) < 3) {   // they pass it around (and sometimes back to you)
      const to = live && Math.random() < 0.5 ? pl : byDist[1 + Math.floor(Math.random() * Math.max(1, byDist.length - 1))] || pl, dx = to.x - V.bx, dz = to.z - V.bz, d = Math.hypot(dx, dz) || 1, v = Math.min(12, d * 0.62 + 1.5);
      kick(dx / d * v, dz / d * v, R(0, 1.5)); V.lastKick = 'them';
    }
    if (!game && live && dpl < 3) pl.noJump = true;   // Space kicks while the ball is close
    if (live && dpl < 1.8 && tapped('Space')) {   // shoot: aim assist toward the goal you're facing
      const fx = -Math.sin(pl.yaw), fz = -Math.cos(pl.yaw); let ax = fx, az = fz;
      for (const s of [-1, 1]) { const g = V['goal' + s], gx = g.x - V.bx, gz = g.z - V.bz, gd = Math.hypot(gx, gz); if ((gx * fx + gz * fz) / gd > 0.5 && gd < 70) { ax = gx / gd + R(-0.04, 0.04); az = gz / gd + R(-0.04, 0.04); } }
      const pw = 17 + Math.min(6, ps2); kick(ax * pw, az * pw, R(1.5, 3.5)); V.lastKick = 'you'; pl.attackT = 0.3;
    } else if (dpl < 0.75 && ps2 > 0.5) { kick((pl.vx || 0) * 1.25, (pl.vz || 0) * 1.25, 0.3); V.lastKick = 'you'; }   // dribble: the ball runs just ahead of you
    V.bvy -= 9.8 * dt; V.bx += V.bvx * dt; V.bz += V.bvz * dt; V.by += V.bvy * dt;
    const gy = groundY(V.bx, V.bz) + 0.11; if (V.by < gy) { V.by = gy; V.bvy = Math.abs(V.bvy) > 1.5 ? -V.bvy * 0.45 : 0; V.bvx *= 1 - dt * 0.65; V.bvz *= 1 - dt * 0.65; }
    // goal? (ball crosses the end line between the posts)
    const [u, v] = toUV(V, V.bx, V.bz);
    if (Math.abs(u) > V.L / 2 - 1 && Math.abs(v) < 3.6 && V.by - groundY(V.bx, V.bz) < 2.44) {   // (by is a WORLD height: the old "by < 2.5" never scored above 2.5 m elevation)
      if (V.lastKick === 'you') { pl.money += 10; sfx.coin?.(); ui.toast('⚽ GOOOOAL!', pick(['The kids are in disbelief. (+$10)', 'Top bins! (+$10)', 'Somewhere, a commentator just screamed. (+$10)']), 2600); pl.stats.goals = (pl.stats.goals || 0) + 1; discover('goal'); }
      else if (ps.length) ui.toast('⚽ They scored!', 'The locals do a very long celebration.', 1600);
      V.bx = V.x; V.bz = V.z; V.bvx = V.bvz = V.bvy = 0;
    }
    if (Math.abs(u) > V.L / 2 + 6 || Math.abs(v) > V.W / 2 + 6) { V.bx = V.x; V.bz = V.z; V.bvx = V.bvz = 0; }   // out of play: back to the middle
    if (!live && Math.hypot(V.bvx, V.bvz) < 0.2) V.free = false;
  }
  V.ball.position.set(V.bx, V.by, V.bz); V.ball.rotation.x += Math.hypot(V.bvx, V.bvz) * dt * 4;
}

// ======================================================================================================
// ---------- the sports mini-games ----------
// Every game: phase 'intro' (how-to card, Space to start) → 'play' → 'over' (result card, E = play again).
// Esc quits at any time; walking far away quits too. Space is reserved for the game (no jumping), and in games
// where W A S D aim, you stand still (player.freeze).
let game = null, card = null;
let racket = null, club = null;
function showCard(html) {
  if (!card) {
    card = document.createElement('div'); card.id = 'sportcard';
    card.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:40;background:#0b1622e6;border:2px solid #ffd45c;border-radius:14px;padding:10px 18px;color:#fff;font:15px Segoe UI,Arial,sans-serif;text-align:center;max-width:min(600px,92vw);pointer-events:none;box-shadow:0 4px 24px #0008;line-height:1.45';
    document.body.appendChild(card);
  }
  card.innerHTML = html || ''; card.style.display = html ? '' : 'none';
}
const K = s => `<kbd style="background:#333;border:1px solid #777;border-radius:4px;padding:0 5px">${s}</kbd>`;
function meter(v, zone, tick) {   // a power bar: v 0..1, optional green zone [a, b] and an ideal tick
  return `<div style="position:relative;width:300px;height:16px;margin:6px auto 2px;background:#2d3748;border-radius:8px;overflow:hidden">${zone ? `<div style="position:absolute;left:${zone[0] * 100}%;width:${(zone[1] - zone[0]) * 100}%;top:0;bottom:0;background:#38a16999"></div>` : ''}<div style="position:absolute;left:0;top:0;bottom:0;width:${clamp(v, 0, 1) * 100}%;background:linear-gradient(90deg,#f6e05e,#ed8936,#e53e3e)"></div>${tick !== undefined ? `<div style="position:absolute;left:calc(${clamp(tick, 0, 1) * 100}% - 1px);top:0;bottom:0;width:3px;background:#fff"></div>` : ''}</div>`;
}
function gearOnPlayer() {
  if (racket || !pl.model?.parts?.armR) return;
  racket = new THREE.Group(); pl.model.parts.armR.add(racket); racket.position.set(0, -0.62, 0);
  const r1 = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.3, 6), std('#222222')); r1.position.set(0, -0.15, -0.05); racket.add(r1);
  const r2 = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.015, 6, 16).scale(1, 1.3, 1), std('#e53e3e')); r2.position.set(0, -0.45, -0.05); racket.add(r2);
  const r3 = new THREE.Mesh(new THREE.CircleGeometry(0.12, 12).scale(1, 1.3, 1), new THREE.MeshStandardMaterial({ color: '#eeeeee', transparent: true, opacity: 0.35, side: THREE.DoubleSide })); r3.position.copy(r2.position); racket.add(r3);
  club = new THREE.Group(); pl.model.parts.armR.add(club); club.position.set(0, -0.62, 0);
  const c1 = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.0, 6), std('#c0c4c8', { metalness: 0.8 })); c1.position.set(0, -0.5, -0.1); club.add(c1);
  const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.05, 0.12), std('#2d3748', { metalness: 0.6 })); c2.position.set(0, -1.0, -0.14); club.add(c2);
  racket.visible = club.visible = false;
}
// a flat ring on the ground (where the ball will land / the hole / the jack)
const ringGeo = new THREE.RingGeometry(0.42, 0.6, 28).rotateX(-Math.PI / 2);
let ringM = null; function ring() { if (!ringM) { ringM = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffd45c', transparent: true, opacity: 0.85, depthWrite: false })); ringM.renderOrder = 3; scene.add(ringM); } ringM.visible = true; return ringM; }
let vRingM = null; function vRing() { if (!vRingM) { vRingM = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 24), new THREE.MeshBasicMaterial({ color: '#ffd45c', side: THREE.DoubleSide, depthWrite: false })); scene.add(vRingM); } return vRingM; }   // standing up (the aim spot in a goal)
// dotted aim line
let aimLine = null; const AIM_N = 40;
function showAim(pts) {
  if (!aimLine) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(AIM_N * 3), 3)); aimLine = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffffff', size: 0.16, transparent: true, opacity: 0.9, depthWrite: false })); aimLine.frustumCulled = false; scene.add(aimLine); }
  const a = aimLine.geometry.attributes.position; if (!pts) { aimLine.visible = false; return; } aimLine.visible = true;
  for (let i = 0; i < AIM_N; i++) { const p = pts[Math.min(pts.length - 1, Math.floor(i * pts.length / AIM_N))]; a.setXYZ(i, p[0], groundY(p[0], p[1]) + 0.08, p[1]); }
  a.needsUpdate = true; aimLine.geometry.computeBoundingSphere();
}
function aimCam(yaw, dt, pitch = 0.22) { if (Math.abs(G.mouse?.dx || 0) > 2) return; G.camYaw += wrapAngle(yaw - G.camYaw) * Math.min(1, dt * 5); G.camPitch += (pitch - G.camPitch) * Math.min(1, dt * 3); }
const extras = [];   // meshes a game added (flags, cups, bowls): removed when it ends
function addExtra(m) { scene.add(m); extras.push(m); return m; }
function clearExtras() { for (const m of extras) scene.remove(m); extras.length = 0; }

const GAMES = {};
function begin(kind, V, opts = {}) {
  const def = GAMES[kind]; if (!def) return;
  if (activeMission()) { ui.toast('Busy!', 'Finish your mission first.', 1500); return; }
  game = { kind, V, def, phase: 'intro', t: 0, ...opts }; pl.noJump = true; pl.freeze = !!def.freeze; pl.vx = pl.vz = 0;
  def.setup?.(game);
}
function endGame(msg, sub) {
  if (!game) return;
  game.def.cleanup?.(game); clearExtras(); if (ringM) ringM.visible = false; showAim(null);
  if (game.V?.ball && game.kind === 'golf') { scene.remove(game.V.ball); game.V.ball = null; }
  if (game.V?.A) game.V.A.visible = true;
  game = null; pl.noJump = false; pl.freeze = false; racket && (racket.visible = false); club && (club.visible = false); showCard(null);
  if (msg) ui.toast(msg, sub || '', 3000);
}
function finish(title, sub, win) { game.phase = 'over'; game.res = { title, sub, win }; if (win) sfx.chime?.(); else sfx.fail?.(); }
function updateGame(dt) {
  const g = game, def = g.def;
  if (pl.vehicle || pl.transit) return endGame();
  if (tapped('Escape')) return endGame(def.title + ': you left the game', 'Come back any time.');
  if (g.V && boxDist(g.V, pl.x, pl.z) > (def.leave || 30)) return endGame(def.title + ': you walked away', 'Game abandoned.');
  if (g.phase === 'intro') {
    showCard(`<b style="font-size:19px;color:#ffd45c">${def.title}</b><br>${def.how.join('<br>')}<br><span style="color:#9ae6b4">${K('Space')} start · ${K('Esc')} quit</span>`);
    def.aim?.(g, dt);
    if (tapped('Space') || tapped('Enter')) { g.phase = 'play'; g.t = 0; g.lock = true; def.start?.(g); }
    return;
  }
  if (g.phase === 'over') {
    showCard(`<b style="font-size:19px;color:${g.res.win ? '#9ae6b4' : '#ffd45c'}">${g.res.title}</b><br>${g.res.sub}<br><span style="color:#9ae6b4">${K('E')} play again · ${K('Esc')} done</span>`);
    def.aim?.(g, dt);
    if (tapped('KeyE')) { const { kind, V } = g; def.cleanup?.(g); clearExtras(); game = null; begin(kind, V); if (game) { game.phase = 'play'; game.def.start?.(game); } }
    return;
  }
  if (g.lock) { if (key('Space')) { showCard(def.card(g)); return; } g.lock = false; }   // the Space that started the game isn't a shot
  g.t += dt; def.step(g, dt);
  if (game === g && g.phase === 'play') showCard(def.card(g));
}

// ---------- 🎾 tennis ----------
const TN = ['0', '15', '30', '40'];
GAMES.tennis = {
  title: '🎾 Tennis', freeze: true, leave: 14,
  how: [`You run to the ball by yourself. Just press ${K('Space')} (or click) to swing when the ball reaches the yellow ring: it turns <b style="color:#9ae6b4">green</b> = swing now!`, `Hold ${K('A')} / ${K('D')} while you swing to aim left / right, ${K('W')} = smash, ${K('S')} = drop shot. First to 4 points wins.`],
  setup(g) { const V = g.V; g.me = 0; g.them = 0; g.server = 'you'; g.rally = 0; g.cool = 0; const [x, z] = local(V, -V.b, 0); pl.teleport(x, z); gearOnPlayer(); racket.visible = true; V.A.visible = false; V.ball.position.set(x, groundY(x, z) + 1, z); g.serveWait = 0; },
  aim(g, dt) { aimCam(yawTo(g.V.ux, g.V.uz), dt); },
  start(g) { g.serveWait = 0.5; },
  launch(g, fx, fy, fz, tu, tv, to, dur, h) { const [x, z] = local(g.V, tu, tv); g.ball = { ax: fx, ay: fy, az: fz, bx: x, by: groundY(x, z) + 1.0, bz: z, t: 0, dur, h, to, hit: false }; },
  point(g, who, msg) {
    if (who === 'you') g.me++; else g.them++; g.ball = null; g.rally = 0; g.server = g.server === 'you' ? 'them' : 'you'; g.serveWait = 1.6;
    const sc = g.me >= 3 && g.them >= 3 ? (g.me === g.them ? 'Deuce' : (g.me > g.them ? 'Advantage you' : 'Advantage them')) : `${TN[Math.min(3, g.me)]} – ${TN[Math.min(3, g.them)]}`;
    ui.toast((who === 'you' ? '🎾 ' : '😬 ') + msg, sc, 1400); if (who === 'you') sfx.coin?.();
    if ((g.me >= 4 || g.them >= 4) && Math.abs(g.me - g.them) >= 2) { const won = g.me > g.them; ringM && (ringM.visible = false); if (won) { pl.money += 40; pl.stats.tennisWins = (pl.stats.tennisWins || 0) + 1; discover('tennis'); } finish(won ? '🏆 Game, set and match!' : '😅 You lost this one', won ? 'Your opponent offers a sweaty handshake. (+$40)' : 'Good rallies though. Their backhand is suspiciously good.', won); }
    else if (Math.random() < 0.05) { g.serveWait = 2.5; ui.toast('🐕 A golden retriever steals the ball!', 'It does a lap of the court. Everyone waits. Play on!', 2400); }
  },
  step(g, dt) {
    const V = g.V, B = V.B; aimCam(yawTo(V.ux, V.uz), dt); swingPose(B, dt); g.cool -= dt;
    const swing = tapped('Space') || G.mouse.click;
    if (swing && g.cool <= 0) { pl.attackT = 0.35; pl.model.st.kind = 'swing'; }
    if (!g.ball) {   // between points: serve
      g.serveWait -= dt; const [hx, hz] = local(V, -V.b, 0); stepTo(B, ...local(V, V.b, 0), 4, dt);
      pl.x += (hx - pl.x) * Math.min(1, dt * 4); pl.z += (hz - pl.z) * Math.min(1, dt * 4);
      if (g.serveWait > 0) return;
      if (g.server === 'them') { B.swingT = 0.45; this.launch(g, B.x, B.y + 2.2, B.z, -V.b + R(1, 3), R(-V.hw, V.hw) * 0.8, 'you', 1.35, 1.2); }
      else if (swing) { this.launch(g, pl.x, pl.y + 2.2, pl.z, V.b - R(1, 3), R(-V.hw, V.hw) * 0.7, 'them', 1.15, 1.2); g.ball.miss = Math.random() < 0.15; g.ball.ace = g.ball.miss; sfx.bump?.(); }
      return;
    }
    const b = g.ball; b.t += dt / b.dur;
    const t = Math.min(b.t, 1.35), [x, y, z] = arc(b.ax, b.ay, b.az, b.bx, b.by, b.bz, t, b.h);
    V.ball.position.set(x, Math.max(groundY(x, z) + 0.05, y), z);
    const rem = (1 - b.t) * b.dur;
    if (b.to === 'you') {
      const r = ring(); r.position.set(b.bx, groundY(b.bx, b.bz) + 0.06, b.bz); r.material.color.set(rem < 0.42 && rem > -0.16 ? '#38e07b' : '#ffd45c');
      pl.x += clamp(b.bx - pl.x, -6 * dt, 6 * dt); pl.z += clamp(b.bz - pl.z, -6 * dt, 6 * dt); pl.yaw = yawTo(V.ux, V.uz);   // auto-run to the ball
      if (swing && g.cool <= 0 && !b.hit) {
        if (rem > 0.42) { g.cool = 0.3; ui.toast('Too early!', 'Wait for the green ring', 700); }
        else if (rem > -0.16) {
          const q = 1 - clamp(Math.abs(rem - 0.06) / 0.3, 0, 1), ix = (key('KeyD') ? 1 : 0) - (key('KeyA') ? 1 : 0), side = Math.sign((Math.cos(G.camYaw) * V.vx - Math.sin(G.camYaw) * V.vz) || 1);
          const smash = key('KeyW'), drop = key('KeyS'); b.hit = true; g.rally++; sfx.thwack?.();
          const out = q < 0.3 && Math.random() < 0.35;
          const tu = out ? V.b + 2.8 : drop ? R(2.5, 4) : smash ? V.b - 0.6 : V.b - R(1.5, 3), tv = clamp(ix * side * V.hw * 0.85 + R(-0.6, 0.6), -V.hw, V.hw);
          const dur = clamp(1.15 - q * 0.22 - (smash ? 0.18 : 0) + (drop ? 0.35 : 0), 0.7, 1.6);
          this.launch(g, pl.x, pl.y + 1.0, pl.z, tu, tv, 'them', dur, drop ? 2.6 : smash ? 0.8 : 1.4);
          g.ball.out = out; g.ball.miss = !out && Math.random() < Math.min(0.6, 0.05 + q * 0.13 + (ix ? 0.09 : 0) + (smash ? 0.08 : 0) + (drop ? 0.1 : 0) + g.rally * 0.03);
          ui.toast(q > 0.8 ? '💥 Perfect!' : q > 0.45 ? 'Good hit' : 'Scrappy…', '', 500); ringM.visible = false;
        }
      }
      if (!b.hit && rem < -0.2) this.point(g, 'them', pick(['Missed it!', 'Too late!', 'It whizzed past you.']));
    } else {
      stepTo(B, b.bx, b.bz, 5, dt);
      if (b.t >= 1) {
        if (b.out) return this.point(g, 'them', 'Out! Just long.');
        if (b.miss) { B.swingT = 0.45; if (b.t > 1.3) this.point(g, 'you', b.ace ? 'ACE!' : pick(['Winner!', 'Down the line!', 'They couldn\'t reach it!'])); return; }
        B.swingT = 0.45; sfx.bump?.(); this.launch(g, B.x, B.y + 1.0, B.z, -V.b + R(0.5, 3), R(-V.hw, V.hw) * 0.85, 'you', Math.max(0.95, 1.35 - g.rally * 0.035), 1.6);
      }
    }
  },
  card(g) { const sc = g.me >= 3 && g.them >= 3 ? (g.me === g.them ? 'Deuce' : g.me > g.them ? 'Advantage YOU' : 'Advantage THEM') : `You <b>${TN[Math.min(3, g.me)]}</b> – <b>${TN[Math.min(3, g.them)]}</b> Them`; return `🎾 ${sc} · rally ${g.rally}<br><small>${!g.ball && g.server === 'you' && g.serveWait <= 0 ? `Your serve: press ${K('Space')}` : `${K('Space')} swing on the green ring · hold ${K('A')}/${K('D')} aim · ${K('W')} smash · ${K('S')} drop · ${K('Esc')} quit`}</small>`; },
  cleanup(g) { ringM && (ringM.visible = false); },
};

// ---------- 🏀 basketball shoot-around ----------
GAMES.hoops = {
  title: '🏀 Shoot-around', freeze: true, leave: 12,
  how: [`10 shots from 5 spots. Hold ${K('Space')} to build power and let go when the bar is in the <b style="color:#9ae6b4">green zone</b>.`, 'Three in a row and you\'re ON FIRE (the green zone grows). Make 6 to win.'],
  spots(g) { const V = g.V, h = V.hoops[0], dx = -V.ux * h.s, dz = -V.uz * h.s, px = V.vx, pz = V.vz; return [[4.2, 0], [2.4, 0.8], [5.5, -0.75], [5.5, 0.75], [6.6, 0.15]].map(([d, a]) => [h.x + (dx * Math.cos(a) + px * Math.sin(a)) * d, h.z + (dz * Math.cos(a) + pz * Math.sin(a)) * d]); },
  setup(g) { g.shot = 0; g.made = 0; g.streak = 0; g.charge = 0; g.fly = null; g.sp = this.spots(g); this.place(g); },
  place(g) { const [x, z] = g.sp[g.shot % 5]; pl.teleport(x, z); const h = g.V.hoops[0]; pl.yaw = yawTo(h.x - x, h.z - z); },
  need(g) { const h = g.V.hoops[0]; return clamp(0.3 + Math.hypot(pl.x - h.x, pl.z - h.z) * 0.085, 0.3, 0.9); },
  aim(g, dt) { const h = g.V.hoops[0]; aimCam(yawTo(h.x - pl.x, h.z - pl.z), dt, 0.12); },
  step(g, dt) {
    const V = g.V, h = V.hoops[0]; this.aim(g, dt);
    if (!g.fly) {
      V.ball.position.set(pl.x - Math.sin(pl.yaw) * 0.4, pl.y + 1.3 + (key('Space') ? 0.5 : 0), pl.z - Math.cos(pl.yaw) * 0.4);
      if (key('Space')) g.charge = Math.min(1.1, g.charge + dt * 0.75);
      else if (g.charge > 0) {
        const need = this.need(g), err = Math.abs(g.charge - need), fire = g.streak >= 3 ? 0.04 : 0, d = Math.hypot(pl.x - h.x, pl.z - h.z);
        const made = err < 0.06 + fire || (err < 0.13 + fire && Math.random() < 0.55);
        g.fly = { t: 0, made, x0: pl.x, y0: pl.y + 2.2, z0: pl.z, short: g.charge < need, d }; g.charge = 0; pl.attackT = 0.3; g.shot++;
      }
    } else {
      const f = g.fly; f.t += dt;
      if (f.t < 1) { const [x, y, z] = arc(f.x0, f.y0, f.z0, h.x + (f.made ? 0 : f.short ? -0.35 : 0.3) * (h.x - f.x0) / Math.max(f.d, 0.1), h.y + 0.1, h.z, f.t, 1.5 + f.d * 0.12); V.ball.position.set(x, y, z); }
      else if (f.t < 1.6) V.ball.position.set(h.x + (f.made ? 0 : (f.t - 1) * 2), Math.max(groundY(h.x, h.z) + 0.12, h.y - (f.t - 1) * 5), h.z + (f.made ? 0 : (f.t - 1)));
      else {
        if (f.made) { g.made++; g.streak++; pl.money += 3; sfx.coin?.(); ui.toast(g.streak === 3 ? '🔥 HE\'S ON FIRE!' : pick(['🏀 Swish!', '🏀 Nothing but net!', '🏀 Bucket!']), '+$3', 900); } else { g.streak = 0; ui.toast(pick(['🧱 Brick!', 'Clank…', 'Airball!']), f.short ? 'Too soft: let go a bit later' : 'Too hard: let go a bit sooner', 1100); }
        g.fly = null; V.ball.material = g.streak >= 3 ? FIRE_M : BALLS.basket;
        if (g.shot >= 10) { pl.stats.hoops = Math.max(pl.stats.hoops || 0, g.made); if (g.made >= 7) discover('hoops'); const win = g.made >= 6; if (win) pl.money += 10; finish(`🏀 ${g.made}/10`, win ? (g.made >= 8 ? 'Scouts are calling. (+$10 bonus)' : 'Solid shooting. (+$10 bonus)') : 'Make 6 to win. There\'s always next time.', win); }
        else this.place(g);
      }
    }
  },
  card(g) { const need = this.need(g), fire = g.streak >= 3 ? 0.04 : 0; return `🏀 Shot <b>${Math.min(10, g.shot + 1)}</b>/10 · made <b>${g.made}</b>${g.streak >= 3 ? ' · 🔥 ON FIRE' : ''}${meter(g.charge, [need - 0.06 - fire, need + 0.06 + fire])}<small>Hold ${K('Space')}, let go in the green · ${K('Esc')} quit</small>`; },
  cleanup(g) { g.V.ball.material = BALLS.basket; },
};
const FIRE_M = std('#ff7a1a', { emissive: '#ff4500', emissiveIntensity: 1.2 });

// ---------- ⛳ golf driving challenge ----------
GAMES.golf = {
  title: '⛳ Driving challenge', freeze: true, leave: 400,
  how: [`5 balls, longest drive wins cash. ${K('A')} / ${K('D')} aim.`, `Hold ${K('Space')}: the power bar goes up AND back down. Let go at the very top (the white tick) for a perfect strike.`],
  setup(g) { g.balls = 5; g.best = 0; g.charge = 0; g.hold = 0; g.fly = null; gearOnPlayer(); club.visible = true; if (!g.V.ball) g.V.ball = ballMesh('golf'); g.yaw = pl.yaw; },
  aim(g, dt) { if (key('KeyA')) g.yaw += dt * 1.0; if (key('KeyD')) g.yaw -= dt * 1.0; pl.yaw = g.yaw; aimCam(g.yaw, dt); },
  step(g, dt) {
    const V = g.V;
    if (!g.fly) {
      this.aim(g, dt);
      if (key('Space')) { g.hold += dt; const c = (g.hold / 1.1) % 2; g.charge = c < 1 ? c : 2 - c; }
      else if (g.hold > 0) {
        const p = g.charge, perfect = p > 0.95, dist = 50 + p * 190 + (perfect ? 18 : 0), side = (perfect ? R(-0.02, 0.02) : R(-0.1, 0.1) * (1.2 - p));
        g.fly = { t: 0, dist: dist * R(0.94, 1.04), x0: pl.x, z0: pl.z, y0: pl.y + 0.05, fx: -Math.sin(g.yaw + side), fz: -Math.cos(g.yaw + side), dur: 2 + p * 2.5, perfect, goose: Math.random() < 0.04 };
        g.hold = 0; g.charge = 0; g.balls--; pl.model.st.kind = 'swing'; pl.attackT = 0.5; sfx.thwack?.(); if (perfect) ui.toast('💥 Perfect strike!', '', 800);
      }
      V.ball.position.set(pl.x - Math.sin(pl.yaw) * 0.6, groundY(pl.x, pl.z) + 0.045, pl.z - Math.cos(pl.yaw) * 0.6);
      showAim([0, 1].map(k => [pl.x - Math.sin(g.yaw) * (0.6 + k * 40), pl.z - Math.cos(g.yaw) * (0.6 + k * 40)]));
    } else {
      showAim(null); const f = g.fly; f.t += dt / f.dur; const t = Math.min(1, f.t), dd = f.goose ? Math.min(f.dist, 70) : f.dist, x = f.x0 + f.fx * dd * t, z = f.z0 + f.fz * dd * t;
      V.ball.position.set(x, Math.max(groundY(x, z) + 0.045, f.y0 + Math.sin(Math.PI * t) * dd * 0.18), z);
      if (f.t >= 1.2) {
        const d = f.goose ? 0 : f.dist; g.best = Math.max(g.best, d);
        ui.toast(f.goose ? '🪿 FORE! …HONK!' : '⛳ ' + Math.round(d) + ' m', f.goose ? 'A Canada goose headed the ball out of the air. It looks proud. (Doesn\'t count.)' : d > 200 ? 'Monster drive!' : d > 140 ? 'Nice and straight.' : 'Shanked it a bit.', 1800); g.fly = null;
        if (g.balls <= 0) { const cash = Math.round(g.best / 10); pl.money += cash; pl.stats.drive = Math.max(pl.stats.drive || 0, g.best); if (g.best > 200) discover('golf'); finish(`⛳ Longest drive: ${Math.round(g.best)} m`, `+$${cash}. Caddy says: "not bad for someone in sneakers."`, g.best > 160); }
      }
    }
  },
  card(g) { return `⛳ Balls left <b>${g.balls}</b> · best <b>${Math.round(g.best)} m</b>${meter(g.charge, [0.95, 1], 0.97)}<small>${K('A')}/${K('D')} aim · hold ${K('Space')}, let go at the top · ${K('Esc')} quit</small>`; },
  cleanup(g) { showAim(null); },
};

// ---------- rolling balls on grass (pitch & putt, lawn bowls) ----------
// friction a (m/s²), slope pull from the drawn ground, optional bias (a sideways curve that grows as the ball slows)
function rollStep(b, dt, fric, bias = 0) {
  const sp = Math.hypot(b.vx, b.vz); if (sp < 0.04) { b.vx = b.vz = 0; return false; }
  const e = 0.8, gx = (groundY(b.x + e, b.z) - groundY(b.x - e, b.z)) / (2 * e), gz = (groundY(b.x, b.z + e) - groundY(b.x, b.z - e)) / (2 * e);
  b.vx -= gx * 9.8 * 0.45 * dt; b.vz -= gz * 9.8 * 0.45 * dt;
  const k = Math.max(0, sp - fric * dt) / sp; b.vx *= k; b.vz *= k;
  if (bias) { const s2 = Math.hypot(b.vx, b.vz) || 1, lat = bias * dt * clamp(1.6 / (s2 + 0.6), 0.2, 1.3); b.vx += -b.vz / s2 * lat; b.vz += b.vx / s2 * lat; }
  b.x += b.vx * dt; b.z += b.vz * dt; return true;
}
function simulate(x, z, yaw, v0, fric, bias, n = 400) {   // the path a rolled ball will take (for the dotted aim line / the AI)
  const b = { x, z, vx: -Math.sin(yaw) * v0, vz: -Math.cos(yaw) * v0 }, pts = [[x, z]];
  for (let i = 0; i < n && rollStep(b, 1 / 30, fric, bias); i++) if (i % 3 === 0) pts.push([b.x, b.z]);
  pts.push([b.x, b.z]); return pts;
}
function flagAt(x, z) {
  const y = groundY(x, z), g = new THREE.Group(); g.position.set(x, y, z);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 2.2, 6), std('#f4f4f4')); pole.position.y = 1.1; g.add(pole);
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.32), new THREE.MeshStandardMaterial({ color: '#e53e3e', side: THREE.DoubleSide })); fl.position.set(0.25, 1.98, 0); g.add(fl);
  const cup = new THREE.Mesh(new THREE.CircleGeometry(0.12, 18).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#0c0c0c' })); cup.position.y = 0.03; g.add(cup);
  const green = new THREE.Mesh(new THREE.CircleGeometry(5, 28).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#6fbf4f', roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })); green.position.y = 0.02; g.add(green);
  g.userData.flag = fl; return addExtra(g);
}

// ---------- 🏌️ pitch & putt ----------
GAMES.putt = {
  title: '🏌️ Pitch & Putt', freeze: true, leave: 60,
  how: [`3 holes. ${K('A')} / ${K('D')} aim (the dotted line shows the shot), hold ${K('Space')} for power and let go.`, 'Far from the flag you chip (the ball flies, then rolls); close in you putt. The white tick on the bar = about the right power for a putt.'],
  setup(g) {
    const V = g.V, big = V.L > 60, Lh = big ? clamp(V.L * 0.45, 30, 75) : Math.max(4, V.L * 0.7);
    g.holes = []; for (let i = 0; i < 3; i++) {
      const dir = i % 2 ? -1 : 1, v = big ? (i - 1) * Math.min(V.W * 0.25, 25) : (i - 1) * V.W * 0.2;
      let tu = -dir * Lh / 2, cu = dir * Lh / 2; const ok = (u, vv) => inPoly(...local(V, u, vv), V.a.p);
      for (let k = 0; k < 8 && !(ok(tu, v) && ok(cu, v)); k++) { tu *= 0.8; cu *= 0.8; }
      const [tx, tz] = local(V, tu, v), [cx, cz] = local(V, cu, v + R(-2, 2) * (big ? 1 : 0.3)), d = Math.hypot(cx - tx, cz - tz);
      g.holes.push({ tx, tz, cx, cz, par: d > 22 ? 3 : 2 });
    }
    g.hole = 0; g.total = 0; g.ballM = ballMesh('golf'); addExtra(g.ballM); gearOnPlayer(); club.visible = true; this.tee(g);
  },
  tee(g) { const H = g.holes[g.hole]; g.b = { x: H.tx, z: H.tz, vx: 0, vz: 0 }; g.strokes = 0; g.state = 'aim'; g.charge = 0; clearFlag(g); g.flag = flagAt(H.cx, H.cz); g.yaw = yawTo(H.cx - H.tx, H.cz - H.tz); this.stand(g); },
  stand(g) { const px = g.b.x + Math.cos(g.yaw) * 0.55, pz = g.b.z - Math.sin(g.yaw) * 0.55; pl.teleport(px, pz); pl.yaw = g.yaw; },
  dist(g) { const H = g.holes[g.hole]; return Math.hypot(H.cx - g.b.x, H.cz - g.b.z); },
  aim(g, dt) { aimCam(g.yaw, dt, 0.28); },
  step(g, dt) {
    const H = g.holes[g.hole], d = this.dist(g), chip = d > 18;
    if (g.flag) g.flag.userData.flag.rotation.y = Math.sin(G.t * 3) * 0.3;
    g.ballM.position.set(g.b.x, groundY(g.b.x, g.b.z) + 0.045 + (g.fy || 0), g.b.z);
    if (g.state === 'aim') {
      if (key('KeyA')) g.yaw += dt * (key('ShiftLeft') ? 0.15 : 0.6); if (key('KeyD')) g.yaw -= dt * (key('ShiftLeft') ? 0.15 : 0.6);
      pl.yaw = g.yaw; this.stand(g); aimCam(g.yaw, dt, 0.28);
      if (key('Space')) g.charge = Math.min(1, g.charge + dt * 0.55);
      const p = key('Space') ? g.charge : g.last ?? (chip ? d / 112 : d / 22);
      if (chip) { const c = p * 100; showAim(Array.from({ length: 12 }, (_, i) => [g.b.x - Math.sin(g.yaw) * c * i / 11, g.b.z - Math.cos(g.yaw) * c * i / 11])); }
      else showAim(simulate(g.b.x, g.b.z, g.yaw, Math.sqrt(2 * 1.2 * 22 * p), 1.2, 0, 300));
      if (!key('Space') && g.charge > 0) {
        g.strokes++; g.prev = { x: g.b.x, z: g.b.z }; g.last = g.charge; pl.attackT = 0.4; sfx.thwack?.();
        const q = g.charge; g.charge = 0; showAim(null);
        if (chip) { const c = q * 100 * R(0.93, 1.05), yaw = g.yaw + R(-0.05, 0.05); g.state = 'fly'; g.fly = { t: 0, x0: g.b.x, z0: g.b.z, x1: g.b.x - Math.sin(yaw) * c, z1: g.b.z - Math.cos(yaw) * c, dur: 0.8 + c / 45, h: c * 0.22, yaw, c }; }
        else { const v0 = Math.sqrt(2 * 1.2 * 22 * q); g.b.vx = -Math.sin(g.yaw) * v0; g.b.vz = -Math.cos(g.yaw) * v0; g.state = 'roll'; }
      }
    } else if (g.state === 'fly') {
      const f = g.fly; f.t += dt / f.dur; const t = Math.min(1, f.t);
      g.b.x = f.x0 + (f.x1 - f.x0) * t; g.b.z = f.z0 + (f.z1 - f.z0) * t; g.fy = Math.sin(Math.PI * t) * f.h;
      if (f.t >= 1) { g.fy = 0; const v = Math.sqrt(2 * 1.2 * f.c * 0.12); g.b.vx = -Math.sin(f.yaw) * v; g.b.vz = -Math.cos(f.yaw) * v; g.state = 'roll'; }
    } else if (g.state === 'roll') {
      const moving = rollStep(g.b, dt, 1.2), sp = Math.hypot(g.b.vx, g.b.vz), dc = this.dist(g);
      if (dc < 0.13 && sp < 2.4) { g.b.x = H.cx; g.b.z = H.cz; g.b.vx = g.b.vz = 0; return this.holed(g); }
      if (dc < 0.13 && sp >= 2.4 && !g.lipped) { g.lipped = true; const a = R(-0.4, 0.4), c = Math.cos(a), s = Math.sin(a); [g.b.vx, g.b.vz] = [(g.b.vx * c - g.b.vz * s) * 0.6, (g.b.vx * s + g.b.vz * c) * 0.6]; ui.toast('😱 Lipped out!', '', 900); }
      if (dc > 0.4) g.lipped = false;
      if (!inPoly(g.b.x, g.b.z, g.V.a.p) && boxDist(g.V, g.b.x, g.b.z) > 2) { g.b.x = g.prev.x; g.b.z = g.prev.z; g.b.vx = g.b.vz = 0; g.strokes++; ui.toast('🚫 Out of bounds', '+1 stroke penalty. Back to where you hit it.', 1500); }
      if (!moving || sp < 0.04) { if (g.strokes >= 7) { ui.toast('🫳 Picked up', 'Max 7 strokes on a hole.', 1200); g.strokes = 8; return this.holed(g, true); } g.state = 'aim'; g.last = undefined; g.yaw = yawTo(H.cx - g.b.x, H.cz - g.b.z); }
    }
  },
  holed(g, pickup) {
    const H = g.holes[g.hole], diff = g.strokes - H.par; g.total += diff;
    if (!pickup) { sfx.chime?.(); const name = g.strokes === 1 ? '🎯 HOLE IN ONE!!' : diff <= -2 ? '🦅 Eagle!' : diff === -1 ? '🐦 Birdie!' : diff === 0 ? '⛳ Par' : diff === 1 ? 'Bogey' : 'Double bogey+'; ui.toast(name, `${g.strokes} strokes (par ${H.par})`, 1800); if (g.strokes === 1) { discover('holeinone'); pl.money += 50; } if (diff <= 0) pl.money += 5; }
    g.hole++; if (g.hole >= 3) { const win = g.total <= 0; discover('pitchputt'); clearFlag(g); return finish(`🏌️ Round done: ${g.total === 0 ? 'even par' : (g.total > 0 ? '+' : '') + g.total}`, win ? 'At or under par: the clubhouse cat nods at you. ($5 for every hole at par or better)' : 'The geese laugh at you, but you had fun.', win); }
    this.tee(g);
  },
  card(g) { if (g.hole >= 3) return ''; const H = g.holes[g.hole], d = this.dist(g), chip = d > 18; return `🏌️ Hole <b>${g.hole + 1}</b>/3 · par ${H.par} · stroke <b>${g.strokes + (g.state === 'aim' ? 1 : 0)}</b> · ${d.toFixed(1)} m to the pin · total ${g.total === 0 ? 'E' : (g.total > 0 ? '+' : '') + g.total}${meter(g.charge, null, chip ? d / 112 : d / 22)}<small>${chip ? '🏌️ Chip' : '⛳ Putt'} · ${K('A')}/${K('D')} aim (${K('Shift')} = fine) · hold ${K('Space')}, let go · ${K('Esc')} quit</small>`; },
  cleanup(g) { clearFlag(g); showAim(null); },
};
function clearFlag(g) { if (g.flag) { scene.remove(g.flag); g.flag = null; } }

// ---------- 🥌 lawn bowls ----------
const BOWL_R = 0.11, JACK_R = 0.055, BFRIC = 1.5, BIAS = 0.9;   // (friction 0.75 made each bowl roll for ~8 s)
GAMES.bowls = {
  title: '🟢 Lawn bowls', freeze: true, leave: 25,
  how: ['Roll your black bowls as close to the little white jack as you can. Bowls are lopsided: they CURVE as they slow down.', `${K('A')} / ${K('D')} aim (the dotted line shows the curve), ${K('Q')} switch hand (curve left/right), hold ${K('Space')} for power and let go. 2 ends, 4 bowls each.`],
  setup(g) { const V = g.V; g.opp = pick(['Doreen (club champion since 1987)', 'Mr. Pemberton', 'Auntie Lil', 'Gordon in the bucket hat']); g.end = 0; g.me = 0; g.them = 0; g.hand = 1; this.newEnd(g); },
  newEnd(g) {
    const V = g.V, len = Math.min(V.L - 3, 30); g.mat = local(V, -len / 2, 0); for (const b of g.balls || []) scene.remove(b.m);
    const [jx, jz] = local(V, -len / 2 + clamp(len * 0.75, 6, 26), R(-0.6, 0.6));
    g.jack = { x: jx, z: jz, vx: 0, vz: 0, r: JACK_R, m: addExtra(ballMesh('jack')), mass: 0.3 };
    g.balls = [g.jack]; g.n = 0; g.turn = 'you'; g.state = 'aim'; g.charge = 0; g.wait = 0;
    g.yaw = yawTo(jx - g.mat[0], jz - g.mat[1]); pl.teleport(g.mat[0] + Math.cos(g.yaw) * 0.6, g.mat[1] - Math.sin(g.yaw) * 0.6);
    const r = ring(); r.scale.setScalar(0.35); r.position.set(jx, groundY(jx, jz) + 0.05, jz);
  },
  roll(g, who, yaw, p) { const v0 = Math.sqrt(2 * BFRIC * p * Math.min(g.V.L, 34)); const b = { x: g.mat[0], z: g.mat[1], vx: -Math.sin(yaw) * v0, vz: -Math.cos(yaw) * v0, r: BOWL_R, who, mass: 1, hand: who === 'you' ? g.hand : (g.aiHand || 1), m: addExtra(ballMesh(who === 'you' ? 'bowlA' : 'bowlB')) }; g.balls.push(b); g.n++; g.state = 'roll'; sfx.swing?.(); },
  ai(g) {   // the opponent tries a few lines and picks the one that stops closest to the jack, then misses a bit
    let best = null, bd = 1e9; g.aiHand = Math.random() < 0.5 ? 1 : -1; const base = yawTo(g.jack.x - g.mat[0], g.jack.z - g.mat[1]);
    for (let a = -0.25; a <= 0.25; a += 0.025) for (let p = 0.4; p <= 1; p += 0.05) { const pts = simulate(g.mat[0], g.mat[1], base + a, Math.sqrt(2 * BFRIC * p * Math.min(g.V.L, 34)), BFRIC, BIAS * g.aiHand, 500), e = pts[pts.length - 1], d = Math.hypot(e[0] - g.jack.x, e[1] - g.jack.z); if (d < bd) { bd = d; best = [base + a, p]; } }
    this.roll(g, 'them', best[0] + R(-0.025, 0.025), best[1] * R(0.95, 1.05));
  },
  step(g, dt) {
    const V = g.V; for (const b of g.balls) b.m.position.set(b.x, groundY(b.x, b.z) + b.r, b.z);
    if (g.state === 'aim') {
      if (g.turn === 'you') {
        if (key('KeyA')) g.yaw += dt * 0.35; if (key('KeyD')) g.yaw -= dt * 0.35; if (tapped('KeyQ')) { g.hand *= -1; ui.toast(g.hand > 0 ? 'Forehand: curves left' : 'Backhand: curves right', '', 900); }
        pl.yaw = g.yaw; aimCam(g.yaw, dt, 0.3);
        if (key('Space')) g.charge = Math.min(1, g.charge + dt * 0.45);
        const p = key('Space') ? g.charge : (g.last ?? 0.7);
        showAim(simulate(g.mat[0], g.mat[1], g.yaw, Math.sqrt(2 * BFRIC * p * Math.min(V.L, 34)), BFRIC, BIAS * g.hand, 500));
        if (!key('Space') && g.charge > 0) { g.last = g.charge; this.roll(g, 'you', g.yaw, g.charge); g.charge = 0; showAim(null); pl.attackT = 0.4; }
      } else { showAim(null); g.wait -= dt; if (g.wait <= 0) this.ai(g); }
    } else if (g.state === 'roll') {
      let moving = false;
      for (const b of g.balls) if (rollStep(b, dt, BFRIC, b.hand ? BIAS * b.hand : 0)) moving = true;
      for (let i = 0; i < g.balls.length; i++) for (let j = i + 1; j < g.balls.length; j++) {   // bowls knock each other (and the jack)
        const a = g.balls[i], b = g.balls[j], dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), m = a.r + b.r; if (d >= m || d < 1e-6) continue;
        const nx = dx / d, nz = dz / d, rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz; const push = (m - d) / 2; a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
        if (rv < 0) { const imp = -1.9 * rv / (1 / a.mass + 1 / b.mass); a.vx -= imp / a.mass * nx; a.vz -= imp / a.mass * nz; b.vx += imp / b.mass * nx; b.vz += imp / b.mass * nz; sfx.bump?.(); }
      }
      for (const b of g.balls) { const [u, v] = toUV(V, b.x, b.z); if (Math.abs(u) > V.L / 2 + 0.5 || Math.abs(v) > V.W / 2 + 0.5) { b.vx = b.vz = 0; b.dead = true; b.m.visible = false; if (b === g.jack) { b.x = local(V, 0, 0)[0]; b.z = local(V, 0, 0)[1]; b.dead = false; b.m.visible = true; } } }
      ringM && ringM.position.set(g.jack.x, groundY(g.jack.x, g.jack.z) + 0.05, g.jack.z);
      if (!moving) {
        if (Math.random() < 0.04 && g.n === 4) { g.jack.x += R(-0.3, 0.3); g.jack.z += R(-0.3, 0.3); ui.toast('🐦‍⬛ A crow hops onto the green…', 'It nudges the jack 30 cm and flies off. Unbelievable.', 2200); }
        const dj = b => b.dead ? 99 : Math.hypot(b.x - g.jack.x, b.z - g.jack.z) - b.r;
        const mine = g.balls.filter(b => b.who === 'you').map(dj).sort((a, b) => a - b), theirs = g.balls.filter(b => b.who === 'them').map(dj).sort((a, b) => a - b);
        const lead = (mine[0] ?? 99) < (theirs[0] ?? 99) ? 'You are holding shot!' : 'They are holding shot.';
        if (g.n >= 8) {
          let pts, who; if ((mine[0] ?? 99) < (theirs[0] ?? 99)) { who = 'you'; pts = mine.filter(d => d < (theirs[0] ?? 99)).length; g.me += pts; } else { who = 'them'; pts = theirs.filter(d => d < (mine[0] ?? 99)).length; g.them += pts; }
          ui.toast(who === 'you' ? `🟢 You win the end: ${pts} shot${pts > 1 ? 's' : ''}` : `🔴 ${g.opp.split(' ')[0]} wins the end: ${pts}`, `You ${g.me} – ${g.them} them`, 2400);
          g.end++; if (g.end >= 2) { const win = g.me > g.them; if (win) { pl.money += 25; discover('lawnbowls'); } return finish(win ? '🟢 You win at lawn bowls!' : g.me === g.them ? '🤝 A draw' : '🔴 You lost', `${g.me} – ${g.them}. ${win ? g.opp.split(' ')[0] + ' invites you to the Tuesday league and pays you $25 "membership refund".' : g.opp.split(' ')[0] + ' offers you a cup of tea and some "tips".'}`, win); }
          g.state = 'wait'; g.wait = 2.5; return;
        }
        ui.toast(lead, '', 900); g.turn = g.turn === 'you' ? 'them' : 'you'; g.state = 'aim'; g.wait = 1.2;
      }
    } else if (g.state === 'wait') { g.wait -= dt; if (g.wait <= 0) this.newEnd(g); }
  },
  card(g) { const d = g.jack ? Math.hypot(g.jack.x - g.mat[0], g.jack.z - g.mat[1]) : 0; return `🟢 End <b>${Math.min(2, g.end + 1)}</b>/2 · bowl ${Math.min(8, g.n + 1)}/8 · You <b>${g.me}</b> – <b>${g.them}</b> ${g.opp.split(' ')[0]} · jack ${d.toFixed(0)} m${g.turn === 'you' ? meter(g.charge) : '<br>' + g.opp.split(' ')[0] + ' is bowling…'}<small>${K('A')}/${K('D')} aim · ${K('Q')} ${g.hand > 0 ? 'forehand ↰' : 'backhand ↱'} · hold ${K('Space')}, let go · ${K('Esc')} quit</small>`; },
  cleanup(g) { ringM && (ringM.visible = false, ringM.scale.setScalar(1)); showAim(null); },
};

// ---------- ⚽ penalty shootout ----------
GAMES.pens = {
  title: '⚽ Penalty shootout', freeze: true, leave: 30,
  how: [`5 penalties against the local keeper. ${K('A')} / ${K('D')} aim left/right, ${K('W')} / ${K('S')} aim high/low (the yellow ring in the goal).`, `Hold ${K('Space')} for power and let go. Corners are hard to save, but too much power sails over the bar. Score 3 to win.`],
  setup(g) { const V = g.V; g.goal = V['goal1']; g.s = 1; g.shots = 0; g.goals = 0; g.charge = 0; g.state = 'aim'; g.ax = 0; g.ay = 1; this.spot(g); g.keeper = V.players[0]; },
  spot(g) { const V = g.V; const [x, z] = local(V, g.s * (V.L / 2 - 1 - 11), 0); V.bx = x; V.bz = z; V.by = groundY(x, z) + 0.11; V.bvx = V.bvz = V.bvy = 0; const [px, pz] = local(V, g.s * (V.L / 2 - 1 - 13), 0); pl.teleport(px, pz); pl.yaw = yawTo(V.ux * g.s, V.uz * g.s); g.state = 'aim'; g.t2 = 0; },
  aim(g, dt) { aimCam(yawTo(g.V.ux * g.s, g.V.uz * g.s), dt, 0.15); },
  step(g, dt) {
    const V = g.V, kp = g.keeper, [kgx, kgz] = local(V, g.s * (V.L / 2 - 1.3), g.kv || 0); this.aim(g, dt);
    if (kp) { kp.visible = true; kp.x += (kgx - kp.x) * Math.min(1, dt * 8); kp.z += (kgz - kp.z) * Math.min(1, dt * 8); kp.y = groundY(kp.x, kp.z) + (g.kjump || 0); faceTo(kp, pl.x, pl.z); kp.kind = 'walk'; kp.amp = g.state === 'aim' ? 0.3 : 0; kp.phase += dt * 6; }
    const [gx, gz] = local(V, g.s * (V.L / 2 - 1), g.ax), r = vRing();
    if (g.state === 'aim') {
      if (key('KeyA') || key('KeyD')) { const side = Math.sign((Math.cos(G.camYaw) * V.vx - Math.sin(G.camYaw) * V.vz) || 1); g.ax = clamp(g.ax + ((key('KeyD') ? 1 : 0) - (key('KeyA') ? 1 : 0)) * side * dt * 3, -3.4, 3.4); }
      if (key('KeyW')) g.ay = Math.min(2.2, g.ay + dt * 1.5); if (key('KeyS')) g.ay = Math.max(0.2, g.ay - dt * 1.5);
      r.visible = true; r.position.set(gx, groundY(gx, gz) + g.ay, gz); r.rotation.set(0, Math.atan2(V.ux, V.uz), 0);
      if (key('Space')) g.charge = Math.min(1, g.charge + dt * 0.8);
      else if (g.charge > 0) {
        const p = g.charge; g.charge = 0; g.shots++; g.state = 'fly'; g.t2 = 0; pl.attackT = 0.3; sfx.thwack?.();
        const over = p > 0.92 && Math.random() < 0.55, weak = p < 0.35;
        const dive = Math.random() < 0.3 ? 0 : (Math.random() < 0.5 ? -1 : 1) * R(1.2, 3);   // the keeper guesses
        const reach = 1.2 + (g.ay < 1.4 ? 0.4 : 0) - (Math.abs(g.ax) > 2.6 ? 0.5 : 0) - (p > 0.75 ? 0.3 : 0) + (weak ? 1.5 : 0);
        g.shot = { over, saved: !over && Math.abs(dive - g.ax) < reach, dive, dur: 0.75 - p * 0.35, x0: V.bx, z0: V.bz, y0: V.by, tx: gx, tz: gz, ty: groundY(gx, gz) + (over ? 3.2 : g.ay) };
      }
    } else if (g.state === 'fly') {
      const s = g.shot; g.t2 += dt; const t = Math.min(1, g.t2 / s.dur); r.visible = false;
      g.kv = (g.kv || 0) + (s.dive - (g.kv || 0)) * Math.min(1, dt * 7); g.kjump = Math.sin(Math.min(1, g.t2 / s.dur) * Math.PI) * 0.5;
      const tx = s.saved ? s.x0 + (s.tx - s.x0) * 0.93 : s.tx, tz = s.saved ? s.z0 + (s.tz - s.z0) * 0.93 : s.tz;
      V.bx = s.x0 + (tx - s.x0) * t; V.bz = s.z0 + (tz - s.z0) * t; V.by = s.y0 + (s.ty - s.y0) * t + Math.sin(Math.PI * t) * 0.4;
      if (g.t2 > s.dur + 0.6) {
        if (s.over) ui.toast('🚀 Over the bar!', 'Into the trees. A squirrel is not impressed.', 1200);
        else if (s.saved) ui.toast('🧤 SAVED!', pick(['The keeper does a little dance.', 'Right at them.', 'What a stop!']), 1200);
        else { g.goals++; pl.money += 4; sfx.coin?.(); ui.toast('⚽ GOAL!', pick(['Bottom corner!', 'Keeper went the wrong way!', 'Top bins!']) + ' (+$4)', 1200); }
        g.kv = 0; g.kjump = 0;
        if (g.shots >= 5) { const win = g.goals >= 3; if (win) { pl.money += 15; discover('goal'); } return finish(`⚽ ${g.goals}/5 penalties`, win ? 'You win the shootout! The locals chant your name (badly). (+$15)' : 'The keeper wins this time.', win); }
        this.spot(g);
      }
    }
    V.ball.position.set(V.bx, V.by, V.bz);
  },
  card(g) { return `⚽ Penalty <b>${Math.min(5, g.shots + (g.state === 'aim' ? 1 : 0))}</b>/5 · goals <b>${g.goals}</b>${meter(g.charge, [0.45, 0.92])}<small>${K('A')}/${K('D')} left/right · ${K('W')}/${K('S')} high/low · hold ${K('Space')}, let go in the green · ${K('Esc')} quit</small>`; },
  cleanup(g) { vRingM && (vRingM.visible = false); if (g.keeper) g.keeper.y = groundY(g.keeper.x, g.keeper.z); g.V.free = false; },
};

// ---------- prompts, init, update ----------
export function initActivities(player) { pl = player; crowd = new Crowd(CAP); }
export function activityPrompt(player) {
  if (game || player.vehicle || player.transit || G.dialogOpen) return '';
  let best = null, bd = 1e9;
  for (const V of venues) {   // the venue you're standing in (or right next to); the smallest wins when they overlap
    const d = boxDist(V, player.x, player.z); if (d > 2.5) continue;
    if ((V.kind === 'golf' || V.kind === 'putt') && !inPoly(player.x, player.z, V.a.p)) continue;
    const s = V.L * V.W; if (s < bd) { bd = s; best = V; }
  }
  if (!best) return '';
  const V = best, E = tapped('KeyE');
  if (V.kind === 'tennis') { if (E) begin('tennis', V); return `<kbd>E</kbd> 🎾 Play a tennis match vs the local`; }
  if (V.kind === 'basket') { if (E) begin('hoops', V); return '<kbd>E</kbd> 🏀 Shoot-around (10 shots)'; }
  if (V.kind === 'skate') { if (E) { const sk = makeVehicle('skate', player.x, player.z, player.yaw, { color: pick(['#1a1a1a', '#c53030', '#2b6cb0']) }); player.enterVehicle(sk); ui.toast('🛹 A local lends you a board', 'W push · hold Space and let go to ollie · A/D spin and W/S flip in the air · F hop off. Ride the quarter pipes, box and rail!', 4000); discover('skatepark'); } return '<kbd>E</kbd> 🛹 Borrow a skateboard'; }
  if (V.kind === 'golf') { if (E) begin('golf', V); return '<kbd>E</kbd> ⛳ Driving challenge (5 balls)'; }
  if (V.kind === 'putt') { if (E) begin('putt', V); return `<kbd>E</kbd> 🏌️ Play 3 holes of pitch & putt${V.name ? ' at ' + V.name : ''}`; }
  if (V.kind === 'bowls') { if (E) begin('bowls', V); return '<kbd>E</kbd> 🟢 Play lawn bowls with a club member'; }
  if (V.kind === 'pingpong') { if (E) { if (activeMission()) ui.toast('Busy!', 'Finish your mission first.', 1500); else openGame('pingpong'); } return '<kbd>E</kbd> 🏓 Play ping pong'; }
  if (V.kind === 'soccer') { if (E) begin('pens', V); return `<kbd>E</kbd> ⚽ Penalty shootout · or just play: walk into the ball to dribble, <kbd>Space</kbd> shoots`; }
  return '';
}
let checkT = 0;
export function updateActivities(dt, player) {
  if (!crowd) return;
  checkT -= dt;
  if (checkT < 0) { checkT = 1.5; if (!at || Math.hypot(player.x - at[0], player.z - at[1]) > 120) rebuild(player.x, player.z); }
  const daylight = (G.hour ?? 12) > 7 && (G.hour ?? 12) < 21.5 && (G.wet || 0) < 0.4;
  if (!game) pl.noJump = false;
  for (const V of venues) {
    const on = daylight || V === game?.V;
    for (const p of [V.A, V.B, ...(V.shooters || []), ...(V.players || []), ...(V.skaters || []), ...(V.runners || []), ...(V.kids || []), ...(V.golfers || []), ...(V.bowlers || [])]) if (p && !p.off && !(p === V.A && game?.V === V)) p.visible = on;
    if (V.kind === 'soccer') { V.ball.visible = true; updateSoccer(V, dt, daylight || game?.V === V); continue; }   // the ball is always there to kick, even at night
    if (V.ball) V.ball.visible = on; if (on) updateVenue(V, dt);
  }
  if (game) updateGame(dt);
  crowd.draw(people);
  drawItems();
}
// rackets in the tennis players' hands, boards under the skaters (small instanced extras)
let racketIM = null, boardIM = null;
const _o = new THREE.Object3D();
function drawItems() {
  if (!racketIM) {
    racketIM = new THREE.InstancedMesh(new THREE.TorusGeometry(0.13, 0.02, 6, 14).scale(1, 1.3, 1), std('#e53e3e'), 40); boardIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.03, 0.8), std('#2d3748'), 40);
    for (const m of [racketIM, boardIM]) { m.frustumCulled = false; scene.add(m); }
  }
  let nr = 0, nb = 0;
  for (const p of people) {
    if (!p.visible) continue;
    if (p.racket && nr < 40) { const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw); _o.position.set(p.x + rx * 0.45, p.y + 1.0 + (p.kind === 'swing' ? 0.3 : 0), p.z + rz * 0.45); _o.rotation.set(0, p.yaw, 0); _o.updateMatrix(); racketIM.setMatrixAt(nr++, _o.matrix); }
    if (p.skate && nb < 40) { _o.position.set(p.x, p.y - 0.1, p.z); _o.rotation.set(0, p.yaw - 1.2, 0); _o.updateMatrix(); boardIM.setMatrixAt(nb++, _o.matrix); }
  }
  racketIM.count = nr; boardIM.count = nb; racketIM.instanceMatrix.needsUpdate = boardIM.instanceMatrix.needsUpdate = true;
}
export const _act = { get venues() { return venues; }, get game() { return game; }, begin, endGame, GAMES, rollStep, simulate };
