// Places are used for what they are: every sports pitch, court, skatepark, track, playground and golf course near you comes
// alive with people doing that thing — and you can join in.
//   tennis courts   → two players rallying; E = grab a racket and play a match (Space to swing when the ball reaches you)
//   basketball      → people shooting at the hoops; E = shoot-around (hold Space for power, release to shoot)
//   soccer / fields → a kickabout; walk in and the ball is live: run into it to kick, score in the goals
//   skateparks      → concrete ramps, a rail and a box with skaters on them; E = grab a skateboard
//   running tracks  → joggers doing laps;  playgrounds → kids running around;  parks → frisbee throwers
//   golf courses    → golfers; E = driving challenge (hold Space for power, A/D to aim)
// Sport comes from the map (OSM `sport=*`, stored as area.sp); untagged pitches are guessed from their size.
import * as THREE from 'three';
import { G, scene, std, key, tapped, pick, R, hash2 } from './core.js';
import { groundY } from './terrain.js';
import { addDeck, nearestRoad, isDriveType, buildingAt } from './city.js';
const onRoad = (x, z) => { const r = nearestRoad(x, z, 14, q => isDriveType(q.t)); return (r && r.d < r.road.w / 2 + 1.5) || buildingAt(x, z); };
import { Crowd, newLook } from './people.js';
import { makeVehicle } from './vehicles.js';
import { activeMission, discover } from './missions.js';
import { ui } from './ui.js';
import { sfx } from './sound.js';

const NEAR = 300, CAP = 110;
let pl = null, crowd = null, venues = [], at = null, people = [];
const ballGeo = new THREE.SphereGeometry(1, 10, 8), discGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.025, 14);
const BALLS = { tennis: std('#d9f22e', { roughness: 0.6 }), basket: std('#e0702a', { roughness: 0.7 }), soccer: std('#f4f4f4', { roughness: 0.5 }), golf: std('#ffffff', { roughness: 0.3 }), disc: std('#ff5a1f', { roughness: 0.4 }) };
const SIZE = { tennis: 0.035, basket: 0.12, soccer: 0.11, golf: 0.021, disc: 1 };

// ---------- venue geometry: oriented box of the polygon ----------
function obb(p) {
  let best = 0, ux = 1, uz = 0;
  for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length, dx = p[j] - p[i], dz = p[j + 1] - p[i + 1], L = Math.hypot(dx, dz); if (L > best) { best = L; ux = dx / L; uz = dz / L; } }
  const vx = -uz, vz = ux; let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
  for (let i = 0; i < p.length; i += 2) { const u = p[i] * ux + p[i + 1] * uz, v = p[i] * vx + p[i + 1] * vz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  return { x: cu * ux + cv * vx, z: cu * uz + cv * vz, ux, uz, vx, vz, L: u1 - u0, W: v1 - v0 };
}
const SPORT = s => /tennis|pickleball|badminton/.test(s) ? 'tennis' : /basketball/.test(s) ? 'basket' : /soccer|football|rugby|field_hockey|lacrosse|ultimate/.test(s) ? 'soccer' : /skateboard|bmx|roller/.test(s) ? 'skate' : /running|athletics/.test(s) ? 'track' : /baseball|softball|cricket/.test(s) ? 'ball' : /golf/.test(s) ? 'golf' : /volleyball/.test(s) ? 'field' : s ? 'field' : '';
function guess(o) { const L = o.L, W = o.W; if (L > 50) return 'soccer'; if (L > 21 && L < 40 && W > 9 && W < 22) return L < 30 ? 'tennis' : 'basket'; return 'field'; }
const local = (V, u, v) => [V.x + V.ux * u + V.vx * v, V.z + V.uz * u + V.vz * v];   // venue coords (u along, v across) → world

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
  g.fillStyle = kind === 'tennis' ? '#3d6e4f' : '#9a5a3c'; g.fillRect(0, 0, 256, 512); g.strokeStyle = '#f2f2f2'; g.lineWidth = 4;
  if (kind === 'tennis') { g.strokeRect(20, 20, 216, 472); g.strokeRect(46, 20, 164, 472); g.beginPath(); g.moveTo(46, 146); g.lineTo(210, 146); g.moveTo(46, 366); g.lineTo(210, 366); g.moveTo(128, 146); g.lineTo(128, 366); g.stroke(); }
  else { g.strokeRect(14, 14, 228, 484); g.beginPath(); g.moveTo(14, 256); g.lineTo(242, 256); g.stroke(); g.beginPath(); g.arc(128, 256, 36, 0, 7); g.stroke(); for (const y of [14, 498]) { g.beginPath(); g.arc(128, y, 90, y < 100 ? 0 : Math.PI, y < 100 ? Math.PI : Math.PI * 2); g.stroke(); g.strokeRect(96, y < 100 ? 14 : 418, 64, 80); } }
  const tex = new THREE.CanvasTexture(t); tex.colorSpace = THREE.SRGBColorSpace;
  const L = Math.min(V.L, kind === 'tennis' ? 24 : 28) , W = Math.min(V.W, kind === 'tennis' ? 11 : 15);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(W, L).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.position.set(V.x, groundY(V.x, V.z) + 0.04, V.z); m.rotation.y = Math.atan2(V.ux, V.uz); m.receiveShadow = true; scene.add(m); return m;
}
function person(V, u, v, extra = {}) { const [x, z] = local(V, u, v); const look = newLook(); look.coat = null; look.scarf = null; look.bag = null; if (G.season !== 'winter') look.shirt = pick(['#ffffff', '#e53e3e', '#3182ce', '#f6e05e', '#38a169', '#1a202c', '#ed64a6']); const p = { x, z, y: groundY(x, z), yaw: 0, cols: look, state: 'idle', kind: 'walk', phase: Math.random() * 6, amp: 0, visible: true, dirty: true, sc: extra.sc, ...extra }; people.push(p); return p; }
function ballMesh(kind) { const m = new THREE.Mesh(kind === 'disc' ? discGeo : ballGeo, BALLS[kind]); m.scale.setScalar(SIZE[kind]); m.castShadow = true; scene.add(m); return m; }

// ---------- building the venues near you ----------
function buildVenue(a) {
  const V = obb(a.p); V.kind = SPORT(a.sp || '') || (a.k === 'golf' ? 'golf' : a.k === 'playground' ? 'play' : guess(V)); V.a = a; V.np = []; V.meshes = [];
  const P = propBuilder(), yaw = Math.atan2(V.ux, V.uz), gy = groundY(V.x, V.z);
  const at2 = (u, v) => { const [x, z] = local(V, u, v); return [x, groundY(x, z), z]; };
  if (V.kind === 'tennis') {
    V.meshes.push(courtLines(V, 'tennis'));
    for (const s of [-1, 1]) { const [x, y, z] = at2(0, s * 6.4); P.add(new THREE.CylinderGeometry(0.04, 0.04, 1.07, 6), '#333333', x, y + 0.53, z); }
    { const [x, y, z] = at2(0, 0); P.add(new THREE.BoxGeometry(12.8, 0.9, 0.02), '#1a1a1a', x, y + 0.5, z, yaw); P.add(new THREE.BoxGeometry(12.8, 0.06, 0.03), '#ffffff', x, y + 0.95, z, yaw); }
    V.A = person(V, -10, 0, { racket: true }); V.B = person(V, 10, 0, { racket: true }); V.ball = ballMesh('tennis'); V.t = 0; V.dir = 1; V.tv = 0;
  } else if (V.kind === 'basket') {
    if (V.W > 9 || V.L > 18) V.meshes.push(courtLines(V, 'basket'));
    V.hoops = [];
    for (const s of V.L > 18 ? [-1, 1] : [1]) {
      const hu = s * (Math.min(V.L, 28) / 2 - 1.2), [x, y, z] = at2(hu + s * 0.9, 0), [rx, ry, rz] = at2(hu, 0);
      P.add(new THREE.CylinderGeometry(0.08, 0.1, 3.4, 8), '#3a3f45', x, y + 1.7, z); P.add(new THREE.BoxGeometry(1.8, 1.05, 0.05), '#f4f4f4', rx + V.ux * s * 0.3, y + 3.3, rz + V.uz * s * 0.3, yaw);
      P.add(new THREE.TorusGeometry(0.23, 0.02, 6, 16), '#e04a1a', rx, y + 3.05, rz, 0, Math.PI / 2);
      V.hoops.push({ x: rx, y: y + 3.05, z: rz });
    }
    V.shooters = [person(V, -2, 1.5), person(V, 2, -2), person(V, 4, 2)]; V.ball = ballMesh('basket'); V.t = 0; V.who = 0;
  } else if (V.kind === 'soccer') {
    for (const s of [-1, 1]) { const [x, y, z] = at2(s * (V.L / 2 - 1), 0); for (const w of [-3.66, 3.66]) { const [px, , pz] = at2(s * (V.L / 2 - 1), w); P.add(new THREE.BoxGeometry(0.12, 2.44, 0.12), '#ffffff', px, y + 1.22, pz); } P.add(new THREE.BoxGeometry(7.4, 0.12, 0.12), '#ffffff', x, y + 2.44, z, yaw); V['goal' + s] = { x, z }; }
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
  } else if (V.kind === 'golf') {
    V.golfers = []; for (let i = 0; i < 3; i++) { const g = person(V, R(-V.L / 3, V.L / 3), R(-V.W / 3, V.W / 3), { golfer: true, t: Math.random() * 8 }); g.cols.shirt = pick(['#ffffff', '#f6e05e', '#ed64a6', '#63b3ed']); g.cols.pants = pick(['#c4b59a', '#2d3748', '#ffffff']); g.cols.hat = '#ffffff'; V.golfers.push(g); }
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
    const x = a.p[0], z = a.p[1]; if (Math.abs(x - px) > NEAR + 300 || Math.abs(z - pz) > NEAR + 300) continue;
    const o = obb(a.p); const d = Math.hypot(o.x - px, o.z - pz); if (d > NEAR) continue;
    if (a.k === 'golf' && (o.L < 80)) continue;
    list.push({ a, d });
  }
  list.sort((p, q) => p.d - q.d);
  for (const { a } of list.slice(0, 14)) { if (people.length > CAP - 10) break; venues.push(buildVenue(a)); }
}

// ---------- ambient play ----------
const arc = (ax, ay, az, bx, by, bz, t, h) => [ax + (bx - ax) * t, ay + (by - ay) * t + Math.sin(Math.PI * t) * h, az + (bz - az) * t];
function faceTo(p, x, z) { p.yaw = Math.atan2(-(x - p.x), -(z - p.z)); }
function stepTo(p, x, z, sp, dt) { const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz); if (d < 0.2) { p.amp = 0; p.kind = 'walk'; return true; } const s = Math.min(d, sp * dt); p.x += dx / d * s; p.z += dz / d * s; p.y = groundY(p.x, p.z); faceTo(p, x, z); p.kind = 'walk'; p.amp = Math.min(0.9, sp / 4); p.phase += dt * sp * 3.2; return false; }
function swingPose(p, dt) { if (p.swingT > 0) { p.swingT -= dt; p.kind = 'swing'; p.swing = 1 - p.swingT / 0.45; } }
function updateVenue(V, dt) {
  if (V === game?.V) return;   // the mini-game drives this one
  if (V.kind === 'tennis' || V.kind === 'field' || V.kind === 'ball') {
    const A = V.A, B = V.B, from = V.dir > 0 ? A : B, to = V.dir > 0 ? B : A, dur = V.kind === 'tennis' ? 1.25 : 1.8;
    V.t += dt / dur;
    if (!V.tgt) { V.tgt = local(V, (V.dir > 0 ? 10 : -10) + R(-1.5, 1.5), R(-3, 3)); }
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
  } else if (V.kind === 'soccer') updateSoccer(V, dt);
  else if (V.kind === 'skate') for (const s of V.skaters) { const L = V.lim; s.u = s.u ?? R(-L, L); s.u += s.dir * s.sp * dt; if (Math.abs(s.u) > L) { s.dir *= -1; s.u = Math.sign(s.u) * L; } const [x, z] = local(V, s.u, s.v ?? (s.v = R(-V.W / 3, V.W / 3))); s.x = x; s.z = z; s.hop = Math.max(0, (s.hop || 0) - dt); if (!s.hop && Math.random() < dt * 0.4) s.hop = 0.5; s.y = groundY(x, z) + 0.14 + (s.hop ? Math.sin((0.5 - s.hop) / 0.5 * Math.PI) * 0.6 : 0); s.yaw = Math.atan2(-(V.ux * s.dir), -(V.uz * s.dir)) + 1.2; s.kind = 'board'; s.amp = 0; }
  else if (V.kind === 'track') for (const r of V.runners) { r.ang += dt * r.sp / (V.L * 0.4); const [x, z] = local(V, Math.cos(r.ang) * V.L * 0.42, Math.sin(r.ang) * V.W * 0.4); stepTo(r, x, z, r.sp * 1.4, dt); r.amp = 0.95; }
  else if (V.kind === 'play') for (const k of V.kids) { k.tt -= dt; if (k.tt < 0) { k.tt = R(1, 4); [k.tx, k.tz] = local(V, R(-V.L / 3, V.L / 3), R(-V.W / 3, V.W / 3)); } stepTo(k, k.tx, k.tz, 3.2, dt); }
  else if (V.kind === 'golf') for (const g of V.golfers) { g.t += dt; const c = g.t % 9; if (c < 1.6) { g.kind = 'swing'; g.swing = Math.min(1, c / 1.2); } else { g.kind = 'walk'; g.amp = 0; } }
}
function updateSoccer(V, dt) {
  const live = Math.hypot(pl.x - V.x, pl.z - V.z) < Math.max(V.L, V.W) / 2 + 4 && !pl.vehicle;
  const ps = V.players;
  if (!live && !V.free) {   // a passing drill: the ball rolls from one player to another
    const P0 = ps[V.pass.from], P1 = ps[V.pass.to]; V.pass.t += dt / 1.6;
    stepTo(P1, P1.x, P1.z, 0, dt); faceTo(P1, P0.x, P0.z); faceTo(P0, P1.x, P1.z);
    V.bx = P0.x + (P1.x - P0.x) * Math.min(1, V.pass.t); V.bz = P0.z + (P1.z - P0.z) * Math.min(1, V.pass.t); V.by = groundY(V.bx, V.bz) + 0.11;
    if (V.pass.t >= 1) { V.pass = { from: V.pass.to, to: Math.floor(Math.random() * ps.length), t: 0 }; if (V.pass.to === V.pass.from) V.pass.to = (V.pass.to + 1) % ps.length; }
    for (const p of ps) if (p !== P0 && p !== P1) { p.kind = 'walk'; p.amp = 0; }
  } else {   // live ball: you (and they) run into it to kick it; goals count
    V.free = true;
    let near = null, nd = 1e9; for (const p of ps) { const d = Math.hypot(p.x - V.bx, p.z - V.bz); if (d < nd) { nd = d; near = p; } }
    for (const p of ps) { if (p === near || Math.hypot(p.x - V.bx, p.z - V.bz) < 12) stepTo(p, V.bx, V.bz, p === near ? 4.5 : 2.5, dt); else { p.kind = 'walk'; p.amp = 0; } }
    const kick = (vx, vz, up) => { V.bvx = vx; V.bvz = vz; V.bvy = up; sfx.bump?.(); };
    if (near && nd < 0.8 && Math.hypot(V.bvx, V.bvz) < 4) { const g = V['goal' + (near.tm ? -1 : 1)], dx = g.x - V.bx, dz = g.z - V.bz, d = Math.hypot(dx, dz); kick(dx / d * R(6, 11) + R(-2, 2), dz / d * R(6, 11) + R(-2, 2), R(0, 3)); V.lastKick = 'them'; }
    const dpl = Math.hypot(pl.x - V.bx, pl.z - V.bz), ps2 = Math.hypot(pl.vx || 0, pl.vz || 0);
    if (dpl < 0.9 && ps2 > 0.5) { kick((pl.vx || 0) * 1.9, (pl.vz || 0) * 1.9, ps2 > 8 ? 3.5 : 1); V.lastKick = 'you'; }
    V.bvy -= 9.8 * dt; V.bx += V.bvx * dt; V.bz += V.bvz * dt; V.by += V.bvy * dt;
    const gy = groundY(V.bx, V.bz) + 0.11; if (V.by < gy) { V.by = gy; V.bvy = Math.abs(V.bvy) > 1.5 ? -V.bvy * 0.45 : 0; V.bvx *= 1 - dt * 1.2; V.bvz *= 1 - dt * 1.2; }
    // goal? (ball crosses the end line between the posts)
    const u = (V.bx - V.x) * V.ux + (V.bz - V.z) * V.uz, v = (V.bx - V.x) * V.vx + (V.bz - V.z) * V.vz;
    if (Math.abs(u) > V.L / 2 - 1 && Math.abs(v) < 3.6 && V.by < 2.5) {
      if (V.lastKick === 'you') { pl.money += 10; sfx.coin?.(); ui.toast('⚽ GOOOOAL!', pick(['The kids are in disbelief.', 'Top bins! (+$10)', 'Somewhere, a commentator just screamed. (+$10)']), 2600); pl.stats.goals = (pl.stats.goals || 0) + 1; discover('goal'); }
      V.bx = V.x; V.bz = V.z; V.bvx = V.bvz = V.bvy = 0;
    }
    if (Math.abs(u) > V.L / 2 + 6 || Math.abs(v) > V.W / 2 + 6) { V.bx = V.x; V.bz = V.z; V.bvx = V.bvz = 0; }   // out of play: back to the middle
    if (!live && Math.hypot(V.bvx, V.bvz) < 0.2) V.free = false;
  }
  V.ball.position.set(V.bx, V.by, V.bz); V.ball.rotation.x += Math.hypot(V.bvx, V.bvz) * dt * 4;
}

// ---------- mini-games ----------
let game = null;
let racket = null, club = null;
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
function endGame(msg, sub) { if (game?.V?.ball && game.kind === 'golf') scene.remove(game.V.ball); game = null; racket && (racket.visible = false); club && (club.visible = false); ui.objective?.(null); if (msg) ui.toast(msg, sub || '', 4000); }
function startTennis(V) {
  game = { kind: 'tennis', V, me: 0, them: 0, t: 0, dir: -1, rally: 0, swingAt: -9 };
  const [x, z] = local(V, -10, 0); pl.x = x; pl.z = z; pl.vx = pl.vz = 0; gearOnPlayer(); racket.visible = true;
  V.A.visible = false;   // you take player A's place
  ui.toast('🎾 Tennis!', 'Move with W A S D to where the ball is going, press Space to swing as it reaches you. First to 3 points.', 4200);
}
function startHoops(V) { game = { kind: 'hoops', V, shots: 10, made: 0, charge: 0, fly: null }; ui.toast('🏀 Shoot-around!', 'Hold Space to power up, release to shoot. 10 shots. The closer the power is to perfect, the better.', 4200); }
function startGolf(V) {
  game = { kind: 'golf', V, balls: 5, best: 0, charge: 0, fly: null }; gearOnPlayer(); club.visible = true;
  game.V.ball = ballMesh('golf'); ui.toast('⛳ Driving challenge!', 'A/D to aim, hold Space for power, release to hit. 5 balls, longest drive wins cash.', 4200);
}
function updateGame(dt) {
  const g = game, V = g.V; pl.stats = pl.stats || {};
  if (pl.vehicle || G.dialogOpen) return endGame();
  if (g.kind === 'tennis') {
    if (Math.hypot(pl.x - V.x, pl.z - V.z) > Math.max(V.L, 30)) return endGame('🎾 You walked off the court', 'Match abandoned.');
    if (tapped('Space')) { g.swingAt = G.t; pl.model.st.kind = 'swing'; pl.attackT = 0.35; }
    const B = V.B; g.t += dt / 1.15;
    if (!g.tgt) g.tgt = g.dir < 0 ? local(V, -10 + R(-1.5, 1.5), R(-4, 4)) : local(V, 10 + R(-1.5, 1.5), R(-3.5, 3.5));
    const from = g.dir < 0 ? B : { x: pl.x, y: pl.y, z: pl.z };
    if (g.dir > 0) stepTo(B, g.tgt[0], g.tgt[1], 4, dt); swingPose(B, dt); faceTo(B, pl.x, pl.z);
    const [x, y, z] = arc(from.x, from.y + 1.1, from.z, g.tgt[0], groundY(g.tgt[0], g.tgt[1]) + 1.0, g.tgt[1], Math.min(1, g.t), 1.6);
    V.ball.position.set(x, y, z);
    if (g.t >= 1) {
      if (g.dir < 0) {   // the ball has reached your side: did you get there and swing in time?
        const ok = Math.hypot(pl.x - g.tgt[0], pl.z - g.tgt[1]) < 2.2 && G.t - g.swingAt < 0.55;
        if (ok) { g.rally++; g.dir = 1; g.t = 0; g.tgt = null; sfx.bump?.(); }
        else { g.them++; ui.toast('🎾 ' + pick(['Out!', 'Missed it!', 'Ace!', 'Too slow!']), `You ${g.me} – ${g.them} them`, 1500); g.dir = -1; g.t = -0.8; g.tgt = null; g.rally = 0; }
      } else {   // reached them: they return it… or miss
        if (Math.random() < 0.14 + g.rally * 0.06) { g.me++; ui.toast('🎾 ' + pick(['Winner!', 'Down the line!', 'They couldn\'t reach it!']), `You ${g.me} – ${g.them} them`, 1500); g.rally = 0; g.t = -0.8; }
        else { B.swingT = 0.45; g.t = 0; }
        g.dir = -1; g.tgt = null;
      }
    }
    ui.objective?.(`🎾 Tennis — you <b>${g.me}</b> : <b>${g.them}</b> them · rally ${g.rally}`);
    if (g.me >= 3 || g.them >= 3) { const won = g.me >= 3; V.A.visible = true; if (won) { pl.money += 40; pl.stats.tennisWins = (pl.stats.tennisWins || 0) + 1; discover('tennis'); } endGame(won ? '🏆 You won the match!' : '😅 You lost the match', won ? 'Your opponent offers a sweaty handshake. (+$40)' : 'Good rallies though. Play again any time (E).'); }
  } else if (g.kind === 'hoops') {
    const h = V.hoops[0], d = Math.hypot(pl.x - h.x, pl.z - h.z);
    if (d > 16) return endGame('🏀 You left the court', `Made ${g.made}/${10 - g.shots}.`);
    if (!g.fly) {
      faceTo(pl, h.x, h.z); pl.yaw = Math.atan2(-(h.x - pl.x), -(h.z - pl.z));
      if (key('Space')) g.charge = Math.min(1, g.charge + dt * 0.9);
      else if (g.charge > 0) { const need = Math.min(1, 0.25 + d / 9), err = Math.abs(g.charge - need), made = err < 0.07 + (d < 3 ? 0.05 : 0); g.fly = { t: 0, made, x0: pl.x, y0: pl.y + 2.2, z0: pl.z, short: g.charge < need }; g.charge = 0; g.shots--; }
      V.ball.position.set(pl.x - Math.sin(pl.yaw) * 0.4, pl.y + 1.3, pl.z - Math.cos(pl.yaw) * 0.4);
      const need = Math.min(1, 0.25 + d / 9), bar = n => '▮'.repeat(Math.round(n * 20)).padEnd(20, '▯');
      ui.objective?.(`🏀 Shots left <b>${g.shots}</b> · made <b>${g.made}</b><br>${bar(g.charge)} power ${Math.round(g.charge * 100)}% (aim ≈ ${Math.round(need * 100)}%)`);
    } else {
      const f = g.fly; f.t += dt;
      if (f.t < 1) { const [x, y, z] = arc(f.x0, f.y0, f.z0, h.x + (f.made ? 0 : f.short ? -0.35 : 0.3) * (h.x - f.x0) / Math.max(d, 0.1), h.y + 0.1, h.z, f.t, 1.5 + d * 0.12); V.ball.position.set(x, y, z); }
      else if (f.t < 1.6) V.ball.position.set(h.x + (f.made ? 0 : (f.t - 1) * 2), Math.max(groundY(h.x, h.z) + 0.12, h.y - (f.t - 1) * 5), h.z + (f.made ? 0 : (f.t - 1)));
      else { if (f.made) { g.made++; pl.money += 3; sfx.coin?.(); ui.toast(pick(['🏀 Swish!', '🏀 Nothing but net!', '🏀 Bucket!']), '+$3', 900); } else ui.toast(pick(['🧱 Brick!', 'Clank…', 'Airball!']), f.short ? 'Too soft' : 'Too hard', 900); g.fly = null; if (g.shots <= 0) { pl.stats.hoops = Math.max(pl.stats.hoops || 0, g.made); if (g.made >= 7) discover('hoops'); endGame(`🏀 ${g.made}/10!`, g.made >= 8 ? 'Are you a Raptor now?' : g.made >= 5 ? 'Solid shooting.' : 'There\'s always next time.'); } }
    }
  } else if (g.kind === 'golf') {
    if (!g.fly) {
      if (key('KeyA')) pl.yaw += dt * 1.2; if (key('KeyD')) pl.yaw -= dt * 1.2;
      if (key('Space')) g.charge = Math.min(1, g.charge + dt * 0.7);
      else if (g.charge > 0) { const p = g.charge, dist = 40 + p * p * 210 * R(0.85, 1.12), side = R(-0.12, 0.12) * (1.2 - p); g.fly = { t: 0, dist, x0: pl.x, z0: pl.z, y0: pl.y + 0.05, fx: -Math.sin(pl.yaw + side), fz: -Math.cos(pl.yaw + side), dur: 2 + p * 2.5 }; g.charge = 0; g.balls--; pl.model.st.kind = 'swing'; pl.attackT = 0.5; sfx.bump?.(); }
      V.ball.position.set(pl.x - Math.sin(pl.yaw) * 0.6, groundY(pl.x, pl.z) + 0.03, pl.z - Math.cos(pl.yaw) * 0.6);
      ui.objective?.(`⛳ Balls left <b>${g.balls}</b> · best <b>${Math.round(g.best)} m</b><br>${'▮'.repeat(Math.round(g.charge * 20)).padEnd(20, '▯')} power ${Math.round(g.charge * 100)}%`);
    } else {
      const f = g.fly; f.t += dt / f.dur; const t = Math.min(1, f.t), x = f.x0 + f.fx * f.dist * t, z = f.z0 + f.fz * f.dist * t;
      V.ball.position.set(x, Math.max(groundY(x, z) + 0.03, f.y0 + Math.sin(Math.PI * t) * f.dist * 0.18), z);
      if (f.t >= 1.25) { g.best = Math.max(g.best, f.dist); ui.toast('⛳ ' + Math.round(f.dist) + ' m', f.dist > 200 ? 'Monster drive!' : f.dist > 140 ? 'Nice and straight.' : 'Shanked it a bit.', 1400); g.fly = null; if (g.balls <= 0) { const cash = Math.round(g.best / 10); pl.money += cash; pl.stats.drive = Math.max(pl.stats.drive || 0, g.best); if (g.best > 200) discover('golf'); endGame(`⛳ Longest drive: ${Math.round(g.best)} m`, `+$${cash}. Caddy says: "not bad for someone in sneakers."`); } }
    }
  }
}

// ---------- prompts, init, update ----------
export function initActivities(player) { pl = player; crowd = new Crowd(CAP); }
export function activityPrompt(player) {
  if (game || player.vehicle || player.transit || G.dialogOpen) return '';
  for (const V of venues) {
    const d = Math.hypot(player.x - V.x, player.z - V.z), inside = d < Math.max(V.L, V.W) / 2 + 3;
    if (!inside) continue;
    if (V.kind === 'tennis') { if (tapped('KeyE')) { if (activeMission()) ui.toast('Busy!', 'Finish your mission first.', 1500); else startTennis(V); } return '<kbd>E</kbd> 🎾 Grab a racket and play tennis'; }
    if (V.kind === 'basket') { if (tapped('KeyE')) { if (activeMission()) ui.toast('Busy!', 'Finish your mission first.', 1500); else startHoops(V); } return '<kbd>E</kbd> 🏀 Shoot some hoops'; }
    if (V.kind === 'skate') { if (tapped('KeyE')) { const sk = makeVehicle('skate', player.x, player.z, player.yaw, { color: pick(['#1a1a1a', '#c53030', '#2b6cb0']) }); player.enterVehicle(sk); ui.toast('🛹 A local lends you a board', 'Space = ollie, A/D spin and W/S flip in the air. Ride the quarter pipes, box and rail!', 3500); discover('skatepark'); } return '<kbd>E</kbd> 🛹 Borrow a skateboard'; }
    if (V.kind === 'golf' && d < 60) { if (tapped('KeyE')) { if (activeMission()) ui.toast('Busy!', 'Finish your mission first.', 1500); else startGolf(V); } return '<kbd>E</kbd> ⛳ Take a club: driving challenge'; }
    if (V.kind === 'soccer' && !V.toldSoccer) { V.toldSoccer = true; ui.toast('⚽ Kickabout!', 'Run into the ball to kick it (sprint = harder). Score in either goal.', 3000); }
  }
  return '';
}
let checkT = 0;
export function updateActivities(dt, player) {
  if (!crowd) return;
  checkT -= dt;
  if (checkT < 0) { checkT = 1.5; if (!at || Math.hypot(player.x - at[0], player.z - at[1]) > 120) rebuild(player.x, player.z); }
  const daylight = (G.hour ?? 12) > 7 && (G.hour ?? 12) < 21.5 && (G.wet || 0) < 0.4;
  for (const V of venues) { const on = daylight || V === game?.V; for (const p of [V.A, V.B, ...(V.shooters || []), ...(V.players || []), ...(V.skaters || []), ...(V.runners || []), ...(V.kids || []), ...(V.golfers || [])]) if (p && !(p === V.A && game?.V === V)) p.visible = on; if (V.ball) V.ball.visible = on; if (on) updateVenue(V, dt); }
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
export const _act = { get venues() { return venues; }, get game() { return game; } };
