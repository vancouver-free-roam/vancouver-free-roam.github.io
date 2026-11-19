// Boats you can actually use.
// 1) F at any boat tied up in a marina: "borrow" it (-1 karma). The moored (instanced) boat disappears and a real, drivable
//    boat of a matching type and colour takes its place. Walk away and it drifts back to its slip.
// 2) Every boat type handles differently (driveBoat, plugged into vehicles.js through `boatHook`):
//    kayaks paddle in strokes and can spin on the spot; sailboats need the WIND (no sailing straight into it, they heel over,
//    the sail swings out); speedboats climb onto the plane and slam over waves; yachts are heavy and slow to turn; jet skis
//    carve and catch air. Spray, wake foam and sounds to match.
// 3) E at a charter dock: hop aboard with a host (whale watching, sunset party yacht, fishing charter, a tech bro's yacht
//    shoot, plane spotting, a dragon boat race, a water taxi, a pirate kids' cruise, a rich retiree's yacht). Each one is
//    a scripted ride along a real water route with events, little games, money, karma and secrets.
//    Space = fast-forward, Space again = skip to the end, F = jump overboard.
// 4) Surprises on the water: a seal flops aboard, rogue waves, dolphin escorts, a flotilla of lost rubber ducks.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, scene, std, addMesh, toXZ, canvasTex, R, pick, clamp, tapped, key, wrapAngle } from './core.js';
import { isWater, waterLevel } from './terrain.js';
import { walkY, buildingAt } from './city.js';
import { makeVehicle, removeVehicle, hullGeo, VT, boatHook, planeModel } from './vehicles.js';
import { moored, hideMoored, showMoored } from './ships.js';
import { makeHuman, SKIN, HAIR, PANTS } from './people.js';
import { discover, activeMission } from './missions.js';
import { ui } from './ui.js';
import { sfx, engine, beep } from './sound.js';
import { _sea } from './sealife.js';
import { player } from './player.js';

// ---------- wind (sailboats) ----------
// WIND.yaw = the heading that points straight INTO the wind (westerlies most of the time); str 0.3 (light) .. 1.2 (storm)
export const WIND = { yaw: Math.PI / 2, str: 0.7, t: Math.random() * 1000 };
function updateWind(dt) {
  WIND.t += dt;
  WIND.yaw = Math.PI / 2 + Math.sin(WIND.t * 0.004) * 0.8 + Math.sin(WIND.t * 0.019) * 0.2;
  WIND.str = clamp(0.6 + 0.22 * Math.sin(WIND.t * 0.011) + (G.wet || 0) * 0.4, 0.3, 1.2);
}
const compass = yaw => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((-yaw * 180 / Math.PI) % 360 + 360) % 360 / 45) % 8];

// ---------- spray + wake particles (two Points clouds, additive: a dead particle is just black) ----------
const dotTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'), g = x.createRadialGradient(16, 16, 1, 16, 16, 16); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
function cloud(n, size, grav) {
  const geo = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsMaterial({ size, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const p = new THREE.Points(geo, m); p.frustumCulled = false; scene.add(p);
  return { p, pos, col, n, grav, life: new Float32Array(n), max: new Float32Array(n), vel: new Float32Array(n * 3), b: new Float32Array(n), i: 0, live: 0 };
}
let SPRAY = null, FOAM = null;
function emit(C, x, y, z, vx, vy, vz, life, bright = 0.75) {
  const i = C.i; C.i = (C.i + 1) % C.n;
  C.pos[i * 3] = x; C.pos[i * 3 + 1] = y; C.pos[i * 3 + 2] = z; C.vel[i * 3] = vx; C.vel[i * 3 + 1] = vy; C.vel[i * 3 + 2] = vz;
  C.life[i] = C.max[i] = life; C.b[i] = bright; C.live = 2;
}
function stepCloud(C, dt) {
  if (!C.live) return; let any = false; const dk = 1 - 0.75 * (G.night || 0);   // foam doesn't glow in the dark
  for (let i = 0; i < C.n; i++) {
    if (C.life[i] <= 0) continue; any = true;
    C.life[i] -= dt; const k = Math.max(0, C.life[i] / C.max[i]) * C.b[i] * dk;
    C.vel[i * 3 + 1] -= C.grav * dt;
    C.pos[i * 3] += C.vel[i * 3] * dt; C.pos[i * 3 + 1] += C.vel[i * 3 + 1] * dt; C.pos[i * 3 + 2] += C.vel[i * 3 + 2] * dt;
    C.col[i * 3] = C.col[i * 3 + 1] = C.col[i * 3 + 2] = C.life[i] > 0 ? k : 0;
  }
  C.p.geometry.attributes.position.needsUpdate = true; C.p.geometry.attributes.color.needsUpdate = true;
  if (!any) C.live--;
}
function splashAt(x, z, n = 18, up = 5) { const y = waterLevel(x, z) + 0.2; for (let k = 0; k < n; k++) emit(SPRAY, x + R(-1.5, 1.5), y, z + R(-1.5, 1.5), R(-3, 3), R(up * 0.5, up * 1.3), R(-3, 3), R(0.6, 1.2)); sfx.splash(); }

// ---------- per-type boat physics ----------
// max/acc m/s, drag (coasting), turn (rad/s at full rudder), yawK (how fast the turn rate builds), grip (how quickly the hull
// stops sliding sideways), wave (how much it bobs), lean (+ = banks into turns, - = rolls out)
const FEEL = {
  kayak:     { max: 4.6, acc: 2.6, drag: 0.55, turn: 1.3, yawK: 3.5, grip: 3.5, wave: 1.3, lean: 0.03, quiet: true, spin: true },
  sailboat:  { max: 10.5, acc: 1.3, drag: 0.12, turn: 0.6, yawK: 1.8, grip: 2.0, wave: 0.9, lean: -0.004, quiet: true, sail: true },
  speedboat: { max: 32, acc: 11, drag: 0.22, turn: 0.95, yawK: 4, grip: 1.7, wave: 0.8, lean: 0.02, snd: 'jetski', planes: true, hops: 1 },
  yacht:     { max: 15, acc: 2.0, drag: 0.1, turn: 0.32, yawK: 0.7, grip: 1.1, wave: 0.35, lean: -0.01, snd: 'bus' },
  jetski:    { max: 27, acc: 12, drag: 0.3, turn: 1.7, yawK: 6, grip: 2.4, wave: 1.0, lean: 0.035, snd: 'jetski', hops: 1.6, planes: true },
};
export const _feel = FEEL;
function driveBoat(v, dt, input) {
  const F = FEEL[v.type] || FEEL.speedboat;
  const b = v.boat || (v.boat = { yr: 0, ph: 0, h: 0, vy: 0, kr: 0, heel: 0, em: 0, fm: 0, dist: 0, cap: 0 });
  let sp = v.speed || 0;
  if (F.sail) {
    // how well you sail depends on the angle to the wind: nothing within ~40° of it ("in irons"), best across it
    const rel = wrapAngle(v.yaw - WIND.yaw), off = Math.abs(rel), s = Math.sign(rel || 1);
    const pol = off < 0.7 ? 0.04 : off < 1.75 ? 0.3 + 0.7 * (off - 0.7) / 1.05 : 1 - 0.32 * (off - 1.75) / 1.39;
    const trim = input.up ? 1 : input.down ? 0.1 : 0.6, tgt = F.max * WIND.str * pol * trim * (input.boost ? 1.12 : 1);   // Shift = hike out over the rail
    sp += (tgt - sp) * Math.min(1, dt * (tgt > sp ? F.acc * 0.35 : 0.35));
    b.irons = off < 0.7; b.pol = pol;
    b.heel += (s * Math.min(0.42, WIND.str * Math.sin(off) * trim * 0.5) - b.heel) * Math.min(1, dt * 1.5);   // heels away from the wind
    const boom = -s * clamp(0.15 + (off - 0.7) * 0.5, 0.15, 1.35) + (b.irons ? Math.sin(G.t * 9) * 0.15 : 0);   // sail swings out to leeward (luffs in irons)
    for (const k of [4, 5]) { const m = v.g.children[k]; if (m) m.rotation.y += (boom - m.rotation.y) * Math.min(1, dt * 2); }
  } else {
    // Shift = extra effort: paddle harder (kayak ~1.4× top speed) or open the throttle further (motor boats ~1.2×)
    const eff = input.boost ? (F.spin ? 1.4 : 1.2) : 1, vmax = F.max * eff;
    if (input.boost && F.spin && (input.up || input.down)) b.ph += dt * 3;   // faster paddle strokes
    if (input.up) sp += F.acc * (input.boost ? 1.3 : 1) * (F.spin ? 0.45 + 1.1 * Math.max(0, Math.sin(b.ph)) : 1) * Math.max(0, 1 - sp / vmax) * dt;   // kayaks: in strokes
    if (input.down) sp -= (sp > 0.3 ? F.acc * 1.2 : F.acc * 0.45) * dt;
    if (input.brake) sp -= sp * 1.6 * dt;
    sp -= sp * F.drag * dt * (input.up ? 0.15 : 1);
    sp = clamp(sp, -F.max * 0.3, vmax);
    if (Math.abs(sp) < 0.03 && !input.up && !input.down) sp = 0;
  }
  if (F.spin) {   // paddle animation
    if (input.up || input.down || input.steer) b.ph += dt * 5.5;
    const pd = v.g.children[2]; if (pd) { pd.rotation.z = Math.sin(b.ph) * 0.55; pd.rotation.y = Math.cos(b.ph) * 0.25; }
  }
  // steering: the rudder needs water flowing past it (kayaks and jet skis less so); big boats build up a turn slowly
  const eff = F.spin ? 1 : clamp(Math.abs(sp) / (F.max * 0.3), 0.12, 1) * (sp < -0.1 ? -1 : 1);
  b.yr += (input.steer * F.turn * eff - b.yr) * Math.min(1, dt * F.yawK);
  v.yaw += b.yr * dt;
  // the hull slides a bit in turns (velocity lags the heading)
  const fx = -Math.sin(v.yaw), fz = -Math.cos(v.yaw);
  v.vx += (fx * sp - v.vx) * Math.min(1, dt * F.grip); v.vz += (fz * sp - v.vz) * Math.min(1, dt * F.grip);
  const nx = v.x + v.vx * dt, nz = v.z + v.vz * dt, half = v.d.len * 0.45, sg = sp < 0 ? -1 : 1;
  if (!isWater(nx, nz) || !isWater(nx + fx * half * sg, nz + fz * half * sg)) {
    const hit = Math.hypot(v.vx, v.vz); v.vx *= -0.25; v.vz *= -0.25; sp *= -0.25;
    if (hit > 3) { sfx.bump(); if (hit > 13) input.onCrash?.(hit + 12); }
  } else { v.x = nx; v.z = nz; }
  // waves, hops over the swell at speed, rogue-wave kicks
  const a = Math.abs(sp), wl = waterLevel(v.x, v.z), A = (0.05 + 0.22 * (G.wet || 0)) * F.wave;
  if (F.hops && a > 15 && b.h <= 0 && Math.random() < dt * (0.5 + (G.wet || 0) * 2) * F.hops) b.vy = R(1.2, 3) * F.hops * a / F.max * (1 + (G.wet || 0));
  if (b.vy || b.h > 0) { b.vy -= 14 * dt; b.h += b.vy * dt; if (b.h <= 0) { if (b.vy < -3.5) { splashAt(v.x, v.z, 10, 3); if (a > 20 && !b.toldAir) { b.toldAir = true; ui.toast('🌊 Airborne!', 'Every wave is a ramp if you\'re brave enough.', 1500); } } b.h = 0; b.vy = 0; } }
  v.y = wl + 0.05 + Math.sin(G.t * 1.6 + v.id) * A + b.h;
  let pt = Math.cos(G.t * 1.3 + v.id) * A * 0.5;
  if (F.planes) pt += Math.sin(clamp((a - 3) / 13, 0, 1) * Math.PI) * 0.12 + (a > 14 ? 0.035 : 0);   // bow-up "hump", then flat on the plane
  else pt += Math.min(0.05, a * 0.004);
  if (b.h > 0) pt += b.vy * 0.03;
  v.pitch += (pt - v.pitch) * Math.min(1, dt * 4);
  b.kr *= Math.exp(-dt * 1.2);
  if (b.cap > 0) { b.cap = Math.min(Math.PI * 2, b.cap + dt * 4.5); if (b.cap >= Math.PI * 2) b.cap = 0; }   // kayak roll!
  const rt = -b.yr * F.lean * a + b.heel + Math.sin(G.t * 1.1 + v.id * 2) * A * 0.6 + Math.sin(G.t * 3) * b.kr + b.cap;
  v.roll = b.cap > 0 ? b.cap : v.roll + (rt - v.roll) * Math.min(1, dt * 3);
  v.speed = sp; v.speedAbs = a; b.dist += a * dt;
  v.g.position.set(v.x, v.y, v.z); v.g.rotation.set(v.pitch, v.yaw, v.roll, 'YXZ');
  // spray at the bow, a rooster tail behind jet skis / speedboats, foam in the wake
  if (a > 1.2) {
    b.fm += dt * a * 0.9; const L = v.d.len / 2;
    while (b.fm > 1) { b.fm--; const sd = Math.random() < 0.5 ? -1 : 1, w = v.d.r * 0.8; emit(FOAM, v.x - fx * L - fz * sd * w * R(0, 1), wl + 0.08, v.z - fz * L + fx * sd * w * R(0, 1), -fz * sd * R(0, 0.6), 0, fx * sd * R(0, 0.6), R(2, 4), 0.35); }
  }
  if (!F.quiet && a > 6) {
    b.em += dt * a * (F.planes ? 1.6 : 0.6); const L = v.d.len / 2;
    while (b.em > 1) { b.em--; const sd = Math.random() < 0.5 ? -1 : 1;
      if (Math.random() < 0.5) emit(SPRAY, v.x + fx * L * 0.4 - fz * sd * v.d.r, wl + 0.3, v.z + fz * L * 0.4 + fx * sd * v.d.r, -fz * sd * R(2, 5) + v.vx * 0.3, R(1.5, 3.5), fx * sd * R(2, 5) + v.vz * 0.3, R(0.5, 0.9));
      else if (F.planes) emit(SPRAY, v.x - fx * L, wl + 0.3, v.z - fz * L, -v.vx * 0.15 + R(-0.6, 0.6), R(2, 5) * a / F.max * 1.6, -v.vz * 0.15 + R(-0.6, 0.6), R(0.6, 1.1)); }
  }
  engine(!F.quiet, a, F.snd || 'car');
  if (v.type === 'sailboat' && b.dist > 1000 && WIND) discover('oldsalt');
}

// ---------- borrowing a moored marina boat (F) ----------
const borrowed = [];
function mooredNear(x, z, y) {
  let best = -1, bd = 3.8; const sp = moored.spots;
  if (Math.abs(y) > 5) return -1;
  for (let i = 0; i < sp.length; i++) {
    const s = sp[i]; if (s.gone) continue; const dx = x - s[0], dz = z - s[1]; if (Math.abs(dx) > 20 || Math.abs(dz) > 20) continue;
    const c = Math.cos(s[2]), sn = Math.sin(s[2]), lx = dx * c - dz * sn, lz = dx * sn + dz * c;
    const d = Math.hypot(Math.max(0, Math.abs(lz) - 5.5 * s[5]), Math.max(0, Math.abs(lx) - 1.7 * s[5]));
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
const BORROW_LINES = {
  sailboat: ['The owner left a note: "Back Tuesday. Don\'t touch my boat." Oops.', 'There\'s a cat asleep below deck. It\'s your first mate now.', 'Name on the back: "KNOT ON CALL". You approve.'],
  speedboat: ['The key was on a foam float shaped like a banana. Of course it was.', 'The name on the back: "REEL ESTATE". It\'s a West Van boat.', 'The cooler is full of energy drinks and regret.'],
  yacht: ['The name on the back: "SEA-ESTA". The fridge has $300 worth of oysters.', 'A tiny dog in a life jacket stares at you from the couch. It doesn\'t bark. It judges.', 'Name: "KNOTORIOUS". There\'s a hot tub on board. Of course there is.'],
};
function borrowBoat() {
  if (player.vehicle) return false;
  const i = mooredNear(player.x, player.z, player.y); if (i < 0) return false;
  const s = moored.spots[i], type = s[6] ? 'sailboat' : s[5] > 1.12 ? 'yacht' : 'speedboat';
  const col = type === 'yacht' ? '#ffffff' : s[4] === '#f4f4f0' ? pick(['#1f3a5f', '#2b6cb0', '#c53030', '#2c5f2d']) : s[4];
  const v = makeVehicle(type, s[0], s[1], s[2] + Math.PI, { keep: true, color: col });
  hideMoored(i); borrowed.push({ v, i });
  player.enterVehicle(v); player.karma -= 1; player.stats.boatsBorrowed = (player.stats.boatsBorrowed || 0) + 1;
  lastVeh = v; boatCam(v); const tip = TIPS[type][1];
  ui.toast('🔑 You "borrowed" a ' + v.d.name.toLowerCase() + ' from the marina', pick(BORROW_LINES[type]) + ' (-1 karma)<br>' + (typeof tip === 'function' ? tip() : tip), 6500);
  discover('marinathief');
  return true;
}
// stepping off a boat: onto the dock / shore if one is within reach (instead of always into the sea)
function stepAshore(v) {
  for (let r = 2; r <= 9; r += 1) for (let a = 0; a < 6.28; a += 0.4) {
    const x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r, h = walkY(x, z, 4);
    if (h > waterLevel(x, z) + 0.4 && h < 6 && !buildingAt(x, z)) { player.x = x; player.z = z; player.y = h; player.vy = 0; return true; }
  }
  return false;
}
const TIPS = {
  kayak: ['🛶 Kayak', 'W = paddle (in strokes) · A/D turn, even standing still · silent: sneak up on the seals'],
  sailboat: ['⛵ Sailboat', () => `The WIND does the work (from the ${compass(WIND.yaw)} right now). W = pull the sails in, S = let them out. You can't sail straight into the wind: zig-zag!`],
  speedboat: ['🚤 Speedboat', 'W throttle · climb onto the plane above ~50 km/h · S reverse · Space brake · hit waves fast for air'],
  yacht: ['🛥️ Luxury yacht', 'Heavy! It turns slowly and stops slowly. You drive from the flybridge, like a Bond villain.'],
  jetski: ['🌊 Jet ski', 'Carves hard and leans into turns · catch air off the waves · Space brake'],
};

// ---------- water routes ----------
// A* on a grid of "roomy" water cells (any water: sea, False Creek, lakes), then pulled tight and smoothed
function waterRoute(a, b, C = 25, M = 350) {
  const x0 = Math.min(a[0], b[0]) - M, z0 = Math.min(a[1], b[1]) - M, W = Math.ceil((Math.max(a[0], b[0]) + M - x0) / C) + 1, H = Math.ceil((Math.max(a[1], b[1]) + M - z0) / C) + 1;
  const ok = new Uint8Array(W * H), h = C * 0.5;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) { const x = x0 + i * C, z = z0 + j * C; ok[j * W + i] = isWater(x, z) && isWater(x + h, z) && isWater(x - h, z) && isWater(x, z + h) && isWater(x, z - h) ? 1 : 0; }
  // the nearest roomy cell that can be reached from p in a straight line over water (not across a pier or a point of land)
  const cell = p => { const c = [], ci = Math.round((p[0] - x0) / C), cj = Math.round((p[1] - z0) / C); for (let j = cj - 16; j <= cj + 16; j++) for (let i = ci - 16; i <= ci + 16; i++) { if (i < 0 || j < 0 || i >= W || j >= H || !ok[j * W + i]) continue; c.push([(i - ci) ** 2 + (j - cj) ** 2, j * W + i]); } c.sort((u, v) => u[0] - v[0]); for (const [, k] of c.slice(0, 60)) if (lineOnWater(p, [x0 + (k % W) * C, z0 + Math.floor(k / W) * C])) return k; return c.length ? c[0][1] : -1; };
  const retry = () => M < 2000 ? waterRoute(a, b, C * 1.6, M * 4) : [a, b];
  const s = cell(a), g = cell(b); if (s < 0 || g < 0) return retry();
  const gs = new Float32Array(W * H).fill(1e9), from = new Int32Array(W * H).fill(-1), heap = [[0, s]]; gs[s] = 0;
  const push = e => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const hx = k => Math.hypot(k % W - g % W, Math.floor(k / W) - Math.floor(g / W));
  while (heap.length) {
    const [fk, k] = pop(); if (k === g) break; if (fk - hx(k) > gs[k] + 1e-3) continue;
    const ki = k % W, kj = Math.floor(k / W);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue; const ni = ki + di, nj = kj + dj; if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const n = nj * W + ni; if (!ok[n] || (di && dj && (!ok[kj * W + ni] || !ok[nj * W + ki]))) continue;
      const ng = gs[k] + Math.hypot(di, dj); if (ng < gs[n]) { gs[n] = ng; from[n] = k; push([ng + hx(n), n]); }
    }
  }
  if (from[g] < 0 && g !== s) return retry();
  const cells = []; for (let k = g; k >= 0; k = from[k]) cells.push([x0 + (k % W) * C, z0 + Math.floor(k / W) * C]); cells.reverse();
  const clear = (p, q) => { const L = Math.hypot(q[0] - p[0], q[1] - p[1]), ux = (q[0] - p[0]) / (L || 1), uz = (q[1] - p[1]) / (L || 1); for (let d = 0; d < L; d += 6) { const x = p[0] + ux * d, z = p[1] + uz * d; if (!isWater(x, z) || !isWater(x - uz * 5, z + ux * 5) || !isWater(x + uz * 5, z - ux * 5)) return false; } return true; };
  const out = [cells[0]]; let i = 0; while (i < cells.length - 1) { let j = cells.length - 1; while (j > i + 1 && !clear(cells[i], cells[j])) j--; out.push(cells[j]); i = j; }
  return [a, ...out, b];
}
function makePath(pts) {
  let P = [];   // densify every 8 m, then smooth (keeping every point on water)
  for (let i = 1; i < pts.length; i++) { const [ax, az] = pts[i - 1], [bx, bz] = pts[i], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 8)); for (let k = i > 1 ? 1 : 0; k <= n; k++) P.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]); }
  for (let pass = 0; pass < 4; pass++) { const Q = P.map(p => p.slice()); for (let i = 2; i < P.length - 2; i++) { let x = 0, z = 0; for (let k = -2; k <= 2; k++) { x += P[i + k][0]; z += P[i + k][1]; } x /= 5; z /= 5; if (isWater(x, z)) Q[i] = [x, z]; } P = Q; }
  const len = [0]; for (let i = 1; i < P.length; i++) len.push(len[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  return { pts: P, len, L: len[len.length - 1] };
}
function pathAt(p, s) {
  const { pts, len } = p; s = clamp(s, 0, p.L); let lo = 0, hi = len.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (len[m] < s) lo = m; else hi = m; }
  const t = (s - len[lo]) / ((len[hi] - len[lo]) || 1), a = pts[lo], b = pts[hi]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
function pathYaw(p, s) { const a = pathAt(p, s - 6), b = pathAt(p, s + 6); return Math.atan2(-(b[0] - a[0]), -(b[1] - a[1])); }

// ---------- charter boat models (front = -z) ----------
const MC = new Map(); const mt = c => { if (!MC.has(c)) MC.set(c, std(c, { roughness: 0.5 })); return MC.get(c); };
const bx = (g, w, h, d, x, y, z, c) => addMesh(new THREE.BoxGeometry(w, h, d), mt(c), x, y, z, g);
const cy = (g, r1, r2, h, x, y, z, c, seg = 8) => addMesh(new THREE.CylinderGeometry(r1, r2, h, seg), mt(c), x, y, z, g);
const hl = (g, w, h, L, bow, c, y) => addMesh(hullGeo(w, h, L, bow), mt(c), 0, y, 0, g);
function sign(g, text, bg, fg, w, h, x, y, z, ry = 0) {
  const tex = canvasTex(512, Math.round(512 * h / w), (c, W, H) => { c.fillStyle = bg; c.fillRect(0, 0, W, H); c.fillStyle = fg; c.font = `bold ${Math.round(H * 0.6)}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, W / 2, H / 2 + 2); }, false);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.y = ry; g.add(m); return m;
}
function rails(g, w, L, y, z0, c = '#cbd5e0') { for (const s of [-1, 1]) bx(g, 0.05, 0.05, L, s * w / 2, y + 0.9, z0, c); for (let z = z0 - L / 2; z <= z0 + L / 2 + 0.01; z += L / 4) for (const s of [-1, 1]) bx(g, 0.04, 0.9, 0.04, s * w / 2, y + 0.45, z, c); }
function person(look, sc = 1) { const h = makeHuman({ skin: pick(SKIN), hair: pick(HAIR), pants: pick(PANTS), shirt: '#e2e8f0', ...look }); h.grp.scale.setScalar(sc); return h; }
const SHIRTS = ['#e53e3e', '#38b2ac', '#ecc94b', '#805ad5', '#f7fafc', '#ed64a6', '#48bb78', '#4299e1', '#1a202c'];
// each returns { g, seat:[x,y,z,ry,pose], host:[x,y,z,ry], len, crew:[humans], anim(dt, R) }
const MODELS = {
  tour() {   // whale-watching boat: white aluminium hull, orange stripe, cabin with an open top deck
    const g = new THREE.Group(); hl(g, 3.8, 1.6, 15, 3.5, '#eef0f0', -0.9); bx(g, 3.82, 0.35, 10.5, 0, 0.45, 2.0, '#e8742c');
    bx(g, 3.2, 2.0, 7, 0, 1.7, 1.2, '#f7f7f4'); bx(g, 3.24, 0.7, 6.4, 0, 1.95, 1.2, '#1c262e'); rails(g, 3.2, 7, 2.7, 1.2, '#e8742c');
    sign(g, 'WAIL WATCHERS 🐋', '#e8742c', '#fff', 5, 0.7, 0, 3.2, -2.35);
    return { g, seat: [0.8, 2.7, 1.8, 0, 'stand'], host: [-0.7, 2.7, -1.2, Math.PI], len: 15 };
  },
  party() {   // two-deck party yacht with string lights, a disco ball and dancing guests
    const g = new THREE.Group(); hl(g, 5, 2.0, 22, 5, '#ffffff', -1.0); bx(g, 5.02, 0.3, 15, 0, 0.5, 2.5, '#1a365d');
    bx(g, 4.2, 2.2, 12, 0, 2.1, 2.5, '#fbfbf8'); bx(g, 4.24, 0.8, 11.4, 0, 2.3, 2.5, '#141c24'); bx(g, 4.4, 0.15, 13, 0, 3.27, 2.5, '#d9d4c7'); rails(g, 4.3, 12, 3.33, 2.5, '#e2e8f0');
    cy(g, 0.06, 0.06, 4, 0, 5.3, -3.5, '#cbd5e0'); bx(g, 1.6, 1.0, 0.8, 0, 3.85, 6.5, '#2d3748');   // mast, DJ booth
    const ball = addMesh(new THREE.SphereGeometry(0.4, 12, 8), std('#e2e8f0', { metalness: 1, roughness: 0.15 }), 0, 6.2, 1.5, g); cy(g, 0.03, 0.03, 1.6, 0, 7.1, 1.5, '#888');
    const bulbs = []; const bm = ['#ff4d6d', '#ffd166', '#06d6a0', '#4cc9f0', '#f72585'].map(c => new THREE.MeshBasicMaterial({ color: c }));
    for (let i = 0; i <= 14; i++) for (const s of [-1, 1]) { const t = i / 14, z = -3.5 + t * 10.5, y = 7.2 - Math.sin(t * Math.PI) * 1.4 - t * 2.2; const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), bm[(i + (s > 0 ? 2 : 0)) % 5]); m.position.set(s * (2.0 * t), y, z); g.add(m); bulbs.push(m); }
    sign(g, 'SUNSET SIPPER', '#1a365d', '#ffd166', 4, 0.6, 0, 2.9, -3.55);
    const crew = []; for (let i = 0; i < 6; i++) { const h = person({ shirt: pick(SHIRTS) }); g.add(h.grp); h.grp.position.set(R(-1.5, 1.5), 3.35, R(-2, 5)); h.grp.rotation.y = R(0, 6.28); h.st.kind = 'dance'; h.st.amp = 1; crew.push(h); }
    return { g, seat: [0.6, 3.35, 2.0, 0, 'dance'], host: [0, 3.35, 6.0, 0], len: 22, crew,
      anim(dt) { ball.rotation.y += dt * 1.5; const n = G.night || 0; bulbs.forEach((m, i) => { m.visible = n > 0.2 || Math.sin(G.t * 3 + i) > -0.2; }); crew.forEach((h, i) => { h.st.phase += dt * (3.5 + i * 0.3); h.pose(dt); }); } };
  },
  fish() {   // fishing boat: blue hull, wheelhouse, rods at the stern
    const g = new THREE.Group(); hl(g, 3.2, 1.5, 11, 3, '#1f4e8c', -0.8); bx(g, 3.22, 0.25, 7, 0, 0.6, 1.6, '#f4f4f0');
    bx(g, 2.4, 2.0, 3, 0, 1.7, -1.2, '#f4f4f0'); bx(g, 2.44, 0.6, 2.6, 0, 2.0, -1.2, '#1c262e'); cy(g, 0.05, 0.05, 3, 0, 3.8, -1.5, '#cbd5e0');
    for (const [x, ry] of [[-1.3, 0.5], [1.3, -0.5], [-0.6, 0.2], [0.6, -0.2]]) { const r = cy(g, 0.02, 0.03, 3.2, x, 2.0, 4.6, '#222'); r.rotation.set(0.6, 0, ry); }
    sign(g, 'REEL DEAL 🎣', '#1f4e8c', '#fff', 2.4, 0.5, 0, 2.95, -2.71);
    return { g, seat: [0.5, 0.72, 3.4, Math.PI, 'stand'], host: [-0.6, 0.72, 2.2, Math.PI * 0.8], len: 11 };
  },
  techbro() {   // sleek black yacht "SERIES B" with a drone
    const g = new THREE.Group(); hl(g, 4.4, 2.0, 20, 5.5, '#121418', -1.0); bx(g, 4.42, 0.12, 14, 0, 0.75, 2.0, '#d4af37');
    bx(g, 3.6, 1.5, 10, 0, 1.75, 1.5, '#1b1f24'); bx(g, 3.64, 0.6, 9.6, 0, 1.85, 1.5, '#0a0d10'); bx(g, 3.0, 1.0, 5, 0, 3.0, 2.0, '#1b1f24'); bx(g, 3.04, 0.45, 4.6, 0, 3.05, 2.0, '#0a0d10');
    sign(g, 'SERIES B', '#121418', '#d4af37', 3.6, 0.6, 0, 0.5, 9.85, Math.PI);
    const drone = new THREE.Group(); bx(drone, 0.5, 0.12, 0.5, 0, 0, 0, '#e2e8f0'); for (const [x, z] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) cy(drone, 0.16, 0.16, 0.02, x, 0.08, z, '#333', 10); g.add(drone);
    return { g, seat: [0.6, 1.0, 7.5, Math.PI, 'stand'], host: [-0.8, 1.0, 7.0, Math.PI], len: 20,
      anim(dt) { drone.position.set(Math.sin(G.t * 0.7) * 4, 6 + Math.sin(G.t * 1.3) * 0.5, 12 + Math.cos(G.t * 0.5) * 2); drone.rotation.y = G.t; } };
  },
  spotter() {   // pontoon boat with a striped canopy
    const g = new THREE.Group(); for (const s of [-1, 1]) addMesh(new THREE.CapsuleGeometry(0.4, 6.5, 4, 10).rotateX(Math.PI / 2), mt('#c0c6cc'), s * 1.1, 0.1, 0, g);
    bx(g, 2.8, 0.15, 7.5, 0, 0.6, 0, '#a0835c'); for (const [x, z] of [[-1.3, -2.5], [1.3, -2.5], [-1.3, 2.5], [1.3, 2.5]]) cy(g, 0.04, 0.04, 2.0, x, 1.65, z, '#ddd');
    bx(g, 3.0, 0.1, 5.6, 0, 2.7, 0, '#38a169'); bx(g, 3.02, 0.12, 1.0, 0, 2.72, -1.5, '#f7fafc'); bx(g, 3.02, 0.12, 1.0, 0, 2.72, 1.0, '#f7fafc'); bx(g, 2.4, 0.5, 0.6, 0, 0.95, 1.8, '#2f855a');
    sign(g, 'PLANE BINGO ✈', '#38a169', '#fff', 2.6, 0.45, 0, 2.4, -2.8);
    return { g, seat: [0.6, 0.68, 0.6, 0, 'stand'], host: [-0.7, 0.68, -1.6, Math.PI], len: 8 };
  },
  dragon(col = '#c53030', team = SHIRTS) {   // dragon boat: long and narrow, carved head + tail, 10 paddlers and a drummer
    const g = new THREE.Group(); hl(g, 1.5, 0.7, 13, 2, col, -0.3); bx(g, 1.52, 0.08, 10, 0, 0.42, 0.4, '#d4af37');
    const head = new THREE.Group(); head.position.set(0, 0.5, -6.6); g.add(head); cy(head, 0.18, 0.25, 1.4, 0, 0.6, 0, col).rotation.x = -0.4;
    bx(head, 0.5, 0.45, 0.9, 0, 1.3, -0.45, col); bx(head, 0.42, 0.12, 0.7, 0, 1.05, -0.6, '#d4af37'); for (const s of [-1, 1]) { bx(head, 0.08, 0.08, 0.08, s * 0.22, 1.42, -0.75, '#f6e05e'); cy(head, 0.02, 0.06, 0.5, s * 0.15, 1.65, -0.2, '#d4af37').rotation.x = 0.6; }
    cy(g, 0.05, 0.2, 1.4, 0, 1.0, 6.6, col).rotation.x = 0.7;
    const paddlers = new THREE.Group(); g.add(paddlers); const paddles = [];
    for (let i = 0; i < 5; i++) for (const s of [-1, 1]) {
      const z = -3.2 + i * 1.3, sh = pick(team), p = new THREE.Group(); p.position.set(s * 0.42, 0.4, z); paddlers.add(p);
      bx(p, 0.34, 0.5, 0.25, 0, 0.35, 0, sh); addMesh(new THREE.SphereGeometry(0.13, 8, 6), mt(pick(SKIN)), 0, 0.72, 0, p, false);
      const pd = new THREE.Group(); pd.position.set(s * 0.2, 0.45, 0); p.add(pd); bx(pd, 0.04, 1.4, 0.04, 0, -0.5, 0, '#8b5a2b'); bx(pd, 0.04, 0.35, 0.16, 0, -1.2, 0, '#8b5a2b'); paddles.push({ pd, s, i });
    }
    const drum = cy(g, 0.3, 0.3, 0.4, 0, 0.6, -5.2, '#7b341e', 12);
    return { g, seat: [0.42, 0.4, 3.3, 0, 'sit'], host: [0, 0.4, -5.7, Math.PI], len: 13, paddles,
      anim(dt, R) { const sp = R?.dragonSpeed ?? 0, ph = (g.userData.ph = (g.userData.ph || 0) + dt * (2 + sp * 0.9)); paddles.forEach(({ pd, s, i }) => { pd.rotation.x = Math.sin(ph - i * 0.15) * 0.7; pd.rotation.z = s * (0.25 + Math.cos(ph - i * 0.15) * 0.15); }); drum.rotation.y += dt; } };
  },
  taxi() {   // little blue water taxi with a canopy
    const g = new THREE.Group(); hl(g, 2.6, 1.1, 7, 2, '#2b6cb0', -0.55); bx(g, 2.62, 0.2, 4.6, 0, 0.45, 0.8, '#f7fafc');
    for (const [x, z] of [[-1.1, -1], [1.1, -1], [-1.1, 2.6], [1.1, 2.6]]) cy(g, 0.04, 0.04, 1.6, x, 1.35, z, '#e2e8f0');
    bx(g, 2.5, 0.1, 4.2, 0, 2.15, 0.8, '#f6e05e'); for (const s of [-1, 1]) bx(g, 0.5, 0.4, 3, s * 0.8, 0.75, 1.0, '#2c5282');
    sign(g, 'AQUA-BUSY', '#f6e05e', '#1a365d', 2.2, 0.35, 0, 1.95, -1.26);
    return { g, seat: [0.8, 0.55, 1.6, 0, 'sit'], host: [-0.6, 0.55, -0.6, 0], len: 7 };
  },
  pirate() {   // pirate ship: wooden hull, two masts with square sails, jolly roger, cannons, kids
    const g = new THREE.Group(); hl(g, 4.2, 2.4, 16, 4, '#5a3a1e', -1.2); bx(g, 4.24, 0.25, 12, 0, 1.15, 2.0, '#d4af37'); bx(g, 4.0, 1.5, 3.5, 0, 1.95, 6.0, '#6b4423');
    const sailM = new THREE.MeshStandardMaterial({ color: '#efe6cf', side: THREE.DoubleSide, roughness: 0.9 });
    for (const [z, hgt] of [[-2.5, 9], [3, 8]]) { cy(g, 0.12, 0.16, hgt, 0, 1.2 + hgt / 2, z, '#3b2412'); for (const k of [0.45, 0.78]) { const s = new THREE.Mesh(new THREE.PlaneGeometry(3.6 - k * 1.5, hgt * 0.28), sailM); s.position.set(0, 1.2 + hgt * k, z + 0.15); g.add(s); bx(g, 4 - k * 1.5, 0.1, 0.1, 0, 1.2 + hgt * k + hgt * 0.14, z, '#3b2412'); } }
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, map: canvasTex(128, 80, (c, W, H) => { c.fillStyle = '#111'; c.fillRect(0, 0, W, H); c.fillStyle = '#fff'; c.beginPath(); c.arc(64, 34, 15, 0, 7); c.fill(); c.fillStyle = '#111'; c.fillRect(56, 30, 5, 5); c.fillRect(67, 30, 5, 5); c.fillStyle = '#fff'; c.save(); c.translate(64, 58); c.rotate(0.6); c.fillRect(-26, -3, 52, 6); c.rotate(-1.2); c.fillRect(-26, -3, 52, 6); c.restore(); }, false) }));
    flag.position.set(0, 10.6, -2.1); g.add(flag);
    for (let i = 0; i < 3; i++) for (const s of [-1, 1]) { const c = cy(g, 0.16, 0.2, 1.1, s * 2.15, 1.45, -1.5 + i * 2.2, '#1a1a1a'); c.rotation.z = s * Math.PI / 2; }
    sign(g, "PIRATE PETE'S 🏴‍☠️", '#5a3a1e', '#f6e05e', 3.8, 0.55, 0, 2.05, 7.76, Math.PI);
    const crew = []; for (let i = 0; i < 4; i++) { const h = person({ shirt: pick(['#e53e3e', '#1a1a1a', '#f7fafc']), hat: pick(['#1a1a1a', '#e53e3e']) }, 0.62); g.add(h.grp); h.grp.position.set(R(-1.4, 1.4), 1.2, R(-4, 3)); h.grp.rotation.y = R(0, 6.28); h.st.kind = i % 2 ? 'wave' : 'walk'; crew.push(h); }
    return { g, seat: [0.9, 1.2, 1.0, 0, 'stand'], host: [0, 2.7, 6.0, 0], len: 16, crew,
      anim(dt) { flag.rotation.y = Math.sin(G.t * 3) * 0.3; crew.forEach((h, i) => { h.st.phase += dt * 3; h.st.amp = i % 2 ? 1 : 0.6; h.pose(dt); }); } };
  },
  classic() {   // a retiree's varnished mahogany classic yacht
    const g = new THREE.Group(); hl(g, 3.6, 1.6, 14, 3.5, '#7a3b1a', -0.8); bx(g, 3.62, 0.12, 10, 0, 0.75, 1.5, '#f7fafc');
    bx(g, 2.6, 1.4, 5, 0, 1.5, -0.5, '#f7f3e8'); bx(g, 2.64, 0.4, 4.6, 0, 1.6, -0.5, '#1c262e'); bx(g, 2.8, 0.12, 5.4, 0, 2.25, -0.5, '#7a3b1a');
    rails(g, 3.4, 9, 0.8, 1.8, '#d4af37'); cy(g, 0.05, 0.05, 6, 0, 5.2, -1.5, '#d9c9a8');
    const flag = sign(g, '', '#c53030', '#fff', 1.0, 0.6, 0.55, 7.8, -1.5); flag.material.map = canvasTex(64, 40, (c) => { c.fillStyle = '#d52b1e'; c.fillRect(0, 0, 64, 40); c.fillStyle = '#fff'; c.fillRect(16, 0, 32, 40); c.fillStyle = '#d52b1e'; c.font = 'bold 24px sans-serif'; c.textAlign = 'center'; c.fillText('🍁', 32, 30); }, false);
    sign(g, 'SECOND WIND', '#7a3b1a', '#f6e05e', 2.8, 0.45, 0, 0.3, 6.95, Math.PI);
    return { g, seat: [0.7, 0.82, 4.0, Math.PI, 'sit'], host: [-0.8, 0.82, 3.6, Math.PI, 'sit'], len: 14, anim() { flag.rotation.y = Math.sin(G.t * 4) * 0.25; } };
  },
};

// ---------- the charters ----------
const say = (who, text, ms = 4200) => ui.toast(who, text, ms);
let _hud = null;
function hud(html) {
  if (!_hud) { _hud = document.createElement('div'); _hud.style.cssText = 'position:fixed;bottom:64px;left:50%;transform:translateX(-50%);background:rgba(10,20,30,.66);color:#fff;padding:6px 16px;border-radius:12px;font:600 14px Segoe UI,Arial,sans-serif;z-index:9;pointer-events:none;text-align:center;max-width:90vw'; document.body.appendChild(_hud); }
  _hud.style.display = html ? '' : 'none'; if (html && _hud.innerHTML !== html) _hud.innerHTML = html;
}
// a timing bar: a marker swings back and forth, press E while it's in the green
function timingBar(t, speed = 2.2) { const p = Math.sin(t * speed), i = Math.round((p + 1) * 10); let s = ''; for (let k = 0; k <= 20; k++) s += k === i ? '<span style="color:#fff">●</span>' : `<span style="color:${Math.abs(k - 10) <= 2 ? '#48bb78' : '#4a5568'}">━</span>`; return { html: s, hit: Math.abs(p) < 0.2 }; }
const bar = (f, col = '#48bb78', n = 16) => { const k = Math.round(clamp(f, 0, 1) * n); return `<span style="color:${col}">${'█'.repeat(k)}</span><span style="color:#4a5568">${'█'.repeat(n - k)}</span>`; };

// whale watching: stop in open water and the whales come to you
function whaleStop(R) {
  R.hold = 32; const [x, z] = [R.x, R.z], fx = -Math.sin(R.yaw), fz = -Math.cos(R.yaw);
  say('🐋 Captain Marnie', '"Engines off, everyone. Quiet… I\'ve got blows on the horizon. Port side!"', 4500);
  R.whales = [];
  for (let i = 0; i < 4; i++) { const a = _sea.spawnSwimmer('orca', x + fx * 70 - fz * R2(-30, 30), z + fz * 70 + fx * R2(-30, 30), R.yaw + Math.PI / 2 + R2(-0.2, 0.2)); a.t = R2(0.5, 4); if (i === 3) a.o.g.scale.setScalar(0.6); R.whales.push(a); }
  const h = _sea.spawnSwimmer('hump', x - fx * 120 + fz * 60, z - fz * 120 - fx * 60, R.yaw); h.t = 6; R.whales.push(h);
  R.after(9, () => { const a = R.whales[0]; if (a) { a.st = 'breach'; a.u = 0; } say('🐋 ORCA BREACH!', 'The whole boat screams. Captain Marnie: "THAT is why I do this job."', 4500); });
  R.after(20, () => say('🐳 Humpback!', '"She\'s showing us her tail: a deep dive. Each tail is like a fingerprint. We call this one… Gerald."', 4500));
  R.after(28, () => discover('whalewatch'));
}
function reelGame(R) {
  R.hold = 999; let ten = 0.2, dist = 40, snaps = 0, surge = 0;
  say('🎣 FISH ON!', 'Skip Gus: "That\'s a big one! Hold E to reel, let go when the line goes red or it\'ll snap!"', 4500);
  R.mini = { noSkip: true, update(dt) {
    const reel = key('KeyE'); surge -= dt; if (surge < 0) surge = R2(1.2, 3);
    const pull = surge < 0.6 ? 0.55 : 0.12;   // the fish makes a run now and then
    ten += (reel ? 0.42 + pull : -0.5 + pull * 0.6) * dt; ten = clamp(ten, 0, 1.05);
    dist += (reel ? -6 : 1.2) * dt + (surge < 0.6 ? 2.5 * dt : 0); dist = Math.min(dist, 60);
    if (ten >= 1) { snaps++; ten = 0.2; dist = Math.min(60, dist + 15); sfx.fail(); say('💥 SNAP!', snaps < 3 ? 'The line broke! Gus ties a new hook on in record time: "It\'s still down there. Go again!"' : 'Gus: "The one that got away. Every fisherman has one."', 3000); if (snaps >= 3) { R.hold = 0; return true; } }
    hud(`🎣 Tension ${bar(ten, ten > 0.8 ? '#e53e3e' : ten > 0.6 ? '#ecc94b' : '#48bb78')} · Fish: ${Math.max(0, dist).toFixed(0)} m<br><small>hold <b>E</b> to reel · let go when it's red</small>`);
    if (dist <= 0) {
      R.hold = 4; const r = Math.random(), [n, cash] = r < 0.62 ? ['a 9 kg Chinook salmon', 45] : r < 0.8 ? ['a lingcod with a face only a mother could love', 25] : r < 0.93 ? ['a Dungeness crab, very offended', 12] : ['an old rubber boot (with a smaller rubber boot inside)', 1];
      player.money += cash; sfx.coin(); say('🐟 You landed ' + n + '!', `Gus buys it off you at the dock price: +$${cash}. "Not bad for a landlubber!"`, 5000);
      if (cash >= 45) discover('charterfish'); player.stats.charterFish = (player.stats.charterFish || 0) + 1; return true;
    }
    return false;
  } };
}
const R2 = (a, b) => a + (b - a) * Math.random();
function timedShots(R, { n, need, title, help, onHit, onMiss, onEnd, speed = 2.2, hold = true }) {
  let t = 0, shots = 0, hits = 0, cool = 0; if (hold) R.hold = 999;
  R.mini = { update(dt) {
    t += dt; cool -= dt; const tb = timingBar(t, speed);
    hud(`${title} · ${hits}/${need} · shots left: ${n - shots}<br>${tb.html}<br><small>${help}</small>`);
    if (tapped('KeyE') && cool <= 0) { shots++; cool = 0.4; if (tb.hit) { hits++; onHit(hits); } else onMiss(); }
    if (hits >= need || shots >= n) { R.hold = 3; onEnd(hits >= need, hits); return true; }
    return false;
  } };
}
// the dragon boat race: alternate A and D in time with the drum
function dragonRace(R) {
  let power = 0, last = '', beatT = 0, strokes = 0, finished = false;
  R.rivals.forEach(r => { r.s = 0; });
  say('🥁 GO GO GO!', 'Coach Lin: "Alternate A and D with the drum! Every stroke counts!"', 3000);
  R.dragonSpeed = 0; R.realTime = true;
  R.mini = { noSkip: true, update(dt) {
    beatT += dt; if (beatT > 0.45) { beatT -= 0.45; beep([110], 0.08, 'sine', 0.12); }
    for (const [k, side] of [['KeyA', 'A'], ['ArrowLeft', 'A'], ['KeyD', 'D'], ['ArrowRight', 'D']]) if (tapped(k)) { if (side !== last) { power += 0.24 + (beatT < 0.12 || beatT > 0.33 ? 0.08 : 0); strokes++; } else power -= 0.1; last = side; }
    power = clamp(power - 0.5 * dt, 0, 1.6); R.dragonSpeed = (1.5 + power * 3.2) * 2 * (key('ShiftLeft') || key('ShiftRight') ? 1.4 : 1);   // Shift = dig in harder
    let pos = 1; for (const r of R.rivals) { r.s += r.v * dt; if (r.s > R.s) pos++; }
    hud(`🐉 Power ${bar(power / 1.6, '#e53e3e')} · ${['🥇 1st', '🥈 2nd', '🥉 3rd'][pos - 1]} · ${Math.max(0, R.P.L - R.s).toFixed(0)} m to go<br><small>alternate <b>A</b> / <b>D</b> in time with the drum · hold <b>Shift</b> to dig in</small>`);
    if (R.s >= R.P.L - 1 && !finished) {
      finished = true; R.realTime = false;
      if (pos === 1) { player.money += 50; sfx.chime(); say('🏆 WE WON!', 'The team lifts you onto their shoulders (in a boat, carefully). Coach Lin hands you $50 and a medal made of a bottle cap. (+$50)', 5500); discover('dragonboat'); }
      else { player.money += 10; say(pos === 2 ? '🥈 Second!' : '🥉 Third…', 'Coach Lin: "We\'ll get them at the real festival in June." Here\'s $10 for the effort.', 4500); }
      player.stats.dragonRaces = (player.stats.dragonRaces || 0) + 1; return true;
    }
    return false;
  } };
}

// the charter list. dock = where the boat ties up (the host stands on the nearest shore/dock), route = waypoints (lat, lon),
// loop = comes back to the dock; dur = how long the ride takes at normal pace (seconds; long routes are time-lapsed)
const CHARTERS = [
  { id: 'whale', icon: '🐋', title: 'Wail Watchers whale tour', boat: 'tour', dock: [49.2729, -123.1352], fare: 45, speed: 11, dur: 150, cam: 22,
    host: ['Captain Marnie', { shirt: '#e8742c', hat: '#1f3a5f', hair: '#d9b36c' }],
    pitch: 'Captain Marnie: "Orcas, humpbacks, the works! We go out past Point Grey into the Strait. 98% sighting rate*!"<br><br><small>*The other 2% get a free muffin.</small>',
    route: [[49.2850, -123.1700], [49.2960, -123.2250], [49.3040, -123.2700]], loop: true,
    ev: [[0.03, R => say('🐋 Captain Marnie', '"Welcome aboard! Rain jackets under the seats. Life jackets too. Mostly the same thing."')],
      [0.15, R => say('🌉 Burrard Bridge', '"Look up! The bridge has fancy stone bits so ships would think Vancouver was classy. It worked."')],
      [0.3, R => say('🏖️ Spanish Banks', '"At low tide you can walk out almost a kilometre here. Do NOT try that with this boat."')],
      [0.47, whaleStop], [0.7, R => say('🦭 Sea lions!', '"Steller sea lions on that buoy. The big one is called Moose. He weighs as much as a small car and has the attitude of a big one."')],
      [0.92, R => say('🐋 Captain Marnie', '"Thanks for coming! Tips go in the orca-shaped jar. The orca is also judging you."')]],
    end(R) { player.stats.charters.add('whale'); } },
  { id: 'party', icon: '🥂', title: 'Sunset Sipper party cruise', boat: 'party', dock: [49.2905, -123.1235], fare: 30, speed: 7, dur: 140, cam: 26,
    host: ['DJ Kenzie', { shirt: '#d53f8c', hair: '#b5442c' }],
    pitch: 'DJ Kenzie: "Sunset cruise round Stanley Park! Mocktails, bad dancing, a disco ball and NO judgement. $30, all you can dance."',
    choices: (t) => G.hour > 7 && G.hour < 18 ? ['🥂 Party! ($30)', '🌅 Party, and skip to sunset ($30)', 'No thanks'] : ['🥂 Party! ($30)', 'No thanks'],
    choose(i, t) { if (i === 1 && t.length === 3) G.hour = 19.6; return i === 0 || (i === 1 && t.length === 3); },
    route: [[49.3015, -123.1170], [49.3140, -123.1390], [49.3060, -123.1600], [49.2880, -123.1580]], loop: true,
    ev: [[0.05, R => say('🎶 DJ Kenzie', '"This first song is for everyone who still owns a Canucks 2011 jersey. Yes. All of you."')],
      [0.2, R => say('🎉 Conga line!', 'Somebody starts a conga line. It goes around the deck twice and into the bathroom. Nobody asks.')],
      [0.38, R => { say('🆘 PARTY FOUL!', 'A guy in a fedora fell overboard trying to film a selfie! Press E to throw him the life ring!', 5000); let t = 6; R.offer = { label: '🛟 Throw the life ring', t, fn() { player.karma += 2; sfx.chime(); say('🛟 Got him!', 'He climbs back aboard, phone still recording. "This is going to do NUMBERS." (+2 karma)'); player.stats.lifeRing = true; } }; }],
      [0.55, R => { R.offer = { label: '🎤 Grab the karaoke mic', fn() { beep([392, 440, 494, 523, 587, 659], 0.18, 'square', 0.05, 0.12); say('🎤 You sang "Summer of \'69"', pick(['Everyone sings along. Bryan Adams is from here, it\'s practically the law.', 'A seagull lands on the railing to listen. Then leaves. Harsh.', 'People clap. Some of them sincerely.'])); player.karma += 1; } }; say('🎤 Karaoke time!', 'DJ Kenzie waves the mic at you. Press E to sing.'); }],
      [0.7, R => say('🌅 Golden hour', 'The sun drops behind Vancouver Island and the whole city turns orange. Even the DJ stops talking for a second.')],
      [0.9, R => say('🎶 DJ Kenzie', '"Last song! Hug a stranger! Consent first! Love you, Vancouver!"')]],
    end(R) { player.stats.charters.add('party'); discover('boozecruise'); } },
  { id: 'fish', icon: '🎣', title: 'Reel Deal fishing charter', boat: 'fish', dock: [49.3745, -123.2715], fare: 60, speed: 9, dur: 120, cam: 16,
    host: ['Skip Gus', { shirt: '#f6e05e', hat: '#2d3748', hair: '#8a8a8a' }],
    pitch: 'Skip Gus: "Salmon\'s running out in Howe Sound. Rod, bait, licence and my terrible jokes all included. $60. You keep what you catch. Or sell it to me."',
    route: [[49.3690, -123.2880], [49.3600, -123.3150]], loop: true,
    ev: [[0.05, R => say('🎣 Skip Gus', '"Why don\'t fish play basketball? They\'re afraid of the net. …I have 40 more of those."')],
      [0.25, R => say('🏔️ Howe Sound', '"That\'s Bowen Island, and behind it the Sea to Sky. Best office in the world, this."')],
      [0.45, R => reelGame(R)],
      [0.8, R => say('🦅 Bald eagle', 'An eagle follows the boat, hoping for scraps. Gus throws it a herring. It catches it in mid-air. Show-off.')]],
    end(R) { player.stats.charters.add('fish'); } },
  { id: 'techbro', icon: '📸', title: 'Crew for Chad\'s yacht shoot', boat: 'techbro', dock: [49.2893, -123.1290], fare: 0, speed: 9, dur: 140, cam: 22,
    host: ['Chad', { shirt: '#f7fafc', pants: '#c4a484', hair: '#d9b36c' }],
    pitch: 'Chad (crypto founder, "pre-revenue"): "Bro. My crew quit. I need someone to take content of me on MY yacht. I\'ll pay you $25 for every shot that slaps."<br><br><small>(The yacht is leased. Do not mention the yacht is leased.)</small>',
    route: [[49.3010, -123.1200], [49.3130, -123.1380], [49.2975, -123.1585], [49.2840, -123.1520]], loop: true,
    ev: [[0.03, R => say('📸 Chad', '"Okay so the brand is: relatable billionaire. Make me look like I own the mountains."')],
      [0.24, R => photoShoot(R, 'Lions Gate Bridge', '"Get the bridge AND my jawline."')],
      [0.48, R => photoShoot(R, 'Siwash Rock', '"Rock in the back, me in the front. Rock is the side character."')],
      [0.72, R => photoShoot(R, 'English Bay skyline', '"Golden hour. Me. Skyline. Caption: \'grind never stops\'."')],
      [0.9, R => say('📸 Chad', pick(['"My portfolio is down 94% but my vibe is up 300%."', '"Do you want to invest in my DAO? It\'s a boat. For dogs."', '"Delete the one where I tripped. Actually, post it. Engagement is engagement."']))]],
    end(R) { player.stats.charters.add('techbro'); if ((R.shots || 0) >= 2) discover('techbro'); } },
  { id: 'spot', icon: '✈️', title: 'Plane Bingo spotting tour', boat: 'spotter', dock: [49.2910, -123.1160], fare: 20, speed: 4, dur: 130, cam: 16,
    host: ['Dot', { shirt: '#38a169', hat: '#f6e05e', hair: '#e2e8f0' }],
    pitch: 'Dot (retired air-traffic controller): "Three floatplanes, three squares on your bingo card. Spot the Beaver, the Otter and the Caravan. Binoculars included. $20."',
    route: [[49.2985, -123.1080], [49.2975, -123.1250], [49.2945, -123.1180]], loop: true,
    ev: [[0.04, R => say('✈️ Dot', '"Coal Harbour is one of the busiest seaplane ports in the WORLD. Boats, planes, kayaks and geese all share one bit of water. It\'s beautiful chaos."')],
      [0.15, R => planePass(R, 'Beaver', '🦫 de Havilland Beaver: built in Toronto in the 50s, still flying every day. Older than your parents.')],
      [0.45, R => planePass(R, 'Otter', '🦦 A Twin Otter: two engines, 19 seats, goes to Victoria in 35 minutes.')],
      [0.75, R => planePass(R, 'Caravan', '🚐 A Cessna Caravan on floats. Dot whispers: "That one\'s the minivan of the sky."')]],
    end(R) { player.stats.charters.add('spot'); if ((R.spotted || 0) >= 3) { setTimeout(() => discover('planespotting'), 4600); say('🎉 BINGO!', 'Dot hands you a laminated certificate and a sticker. You will treasure this forever. (+$15)', 4500); player.money += 15; } } },
  { id: 'dragon', icon: '🐉', title: 'Dragon boat team (short a paddler)', boat: 'dragon', dock: [49.2733, -123.1012], fare: 0, speed: 3, dur: 999, cam: 18, oneWay: true,
    host: ['Coach Lin', { shirt: '#c53030', hat: '#1a1a1a' }],
    pitch: 'Coach Lin: "Our paddler pulled a hamstring doing a TikTok dance. You! You have arms. Race to the finish buoy against the Kits Krakens and the Yaletown Yuppies. Win = $50."',
    route: [[49.2727, -123.1100]],
    ev: [[0.0, R => dragonRace(R)]],
    end(R) { player.stats.charters.add('dragon'); } },
  { id: 'taxi', icon: '⛴️', title: 'Aqua-Busy water taxi', boat: 'taxi', dock: [49.2752, -123.1300], fare: 6, speed: 4.5, dur: 70, cam: 14, oneWay: true, taxi: true,
    host: ['Ravi the skipper', { shirt: '#2b6cb0', hat: '#f7fafc' }],
    pitch: 'Ravi: "Little blue boats, big blue heart. $6 anywhere in False Creek. Where to?"',
    dests: [['🛍️ Granville Island', 49.2731, -123.1358], ['🏙️ Yaletown', 49.2737, -123.1196], ['🔮 Science World', 49.2726, -123.1040], ['🏅 Olympic Village', 49.2707, -123.1088], ['⚓ Maritime Museum (Kits)', 49.2795, -123.1440]],
    ev: [[0.15, R => say('⛴️ Ravi', pick(['"I\'ve driven this boat 40,000 times. I still wave at every kayak."', '"Fun fact: False Creek isn\'t a creek. And it\'s not false. Nobody knows."', '"That duck has been following me for three years. His name is Kevin."']))],
      [0.6, R => say('🌊 Wake!', 'A speedboat zooms past way too fast. Ravi shakes his fist. "FIVE KNOTS, BRANDON!"')]],
    end(R) { player.stats.charters.add('taxi'); discover('watertaxi'); } },
  { id: 'pirate', icon: '🏴‍☠️', title: "Pirate Pete's plunder cruise", boat: 'pirate', dock: [49.2774, -123.1468], fare: 15, speed: 6, dur: 150, cam: 22,
    host: ['Pirate Pete', { shirt: '#1a1a1a', hat: '#1a1a1a', pants: '#7b341e' }],
    pitch: 'Pirate Pete: "ARRR! A kids\' pirate cruise, but we\'re short a grown-up to man the water cannon! The Royal Navy (a rubber dinghy) is coming for our treasure! $15."',
    route: [[49.2810, -123.1560], [49.2865, -123.1480]], loop: true,
    ev: [[0.04, R => say('🏴‍☠️ Pirate Pete', '"Every pirate needs a pirate name. Yours is… Barnacle Bill. No refunds on pirate names."')],
      [0.3, R => { spawnDinghy(R); say('⚓ ENEMY SHIP!', 'The Royal Navy (two kids in a grey dinghy with a flag) is attacking! Man the water cannon!', 4000);
        timedShots(R, { n: 8, need: 4, title: '💦 Water cannon', help: 'press <b>E</b> when the dot is in the green', speed: 2.6,
          onHit: h => { soak(R); say('💦 DIRECT HIT!', pick(['"AAARGH!" the Navy kids scream with delight.', 'The kids cheer: "AGAIN! AGAIN!"', 'Pirate Pete: "THAT\'S MY BARNACLE BILL!"']), 2000); },
          onMiss: () => { soak(R, true); say('💨 Missed!', pick(['Your shot hits a confused seagull.', 'The Navy kids blow a raspberry at you.']), 1600); },
          onEnd: (won) => { R.wonPirate = won; if (won) say('🏴‍☠️ VICTORY!', 'The Royal Navy surrenders a juice box. The kids chant your pirate name.', 4500); else say('⚓ Retreat!', 'The Navy kids steal the treasure map. It was a drawing of a cat anyway.', 4500); dropDinghy(R); } }); }],
      [0.85, R => say('💰 Treasure!', 'The kids open the chest: chocolate gold coins! They give you one. It\'s already melted. Perfect.')]],
    end(R) { player.stats.charters.add('pirate'); if (R.wonPirate) { setTimeout(() => discover('pirates'), 3600); player.money += 15; player.karma += 1; ui.toast('🏴‍☠️ Pirate Pete refunds your ticket', '"Best Barnacle Bill we ever had." (+$15, +1 karma)', 3500); } } },
  { id: 'retiree', icon: '💎', title: 'Mildred\'s yacht "Second Wind"', boat: 'classic', dock: [49.3330, -123.1845], fare: 0, speed: 9, dur: 160, cam: 18,
    host: ['Mildred', { shirt: '#9f7aea', pants: '#f7fafc', hat: '#f7fafc', hair: '#e2e8f0' }],
    pitch: 'An elegant retiree is polishing the brass on a beautiful old wooden yacht. She looks up at you, expectantly.',
    choices: () => ['😍 "What a GORGEOUS boat!"', '🤔 "Is that a big canoe?"', '💸 "How much to rent it?"', 'Walk away'],
    choose(i) {
      if (i === 0) { say('💎 Mildred', '"Oh, you have TASTE. 1947, Honduran mahogany. Hop on, dear, we\'re going to Bowen for ice cream."', 4000); return true; }
      if (i === 1) { say('💎 Mildred', '"A CANOE?!" She sprays you with the deck hose. You deserved that.', 3500); player.karma -= 1; sfx.splash(); }
      if (i === 2) say('💎 Mildred', '"Rent? Darling, she\'s not a scooter." She goes back to polishing.', 3500);
      return false;
    },
    route: [[49.3270, -123.2300], [49.3500, -123.3100], [49.3780, -123.3200]], loop: true,
    ev: [[0.05, R => say('💎 Mildred', '"My late husband Harold named her Second Wind. I sold his golf clubs to pay for the engine. Best day of my life."')],
      [0.25, R => say('💎 Mildred', '"In 1978 I sailed her to Desolation Sound with nothing but a compass and a bottle of gin. Mostly gin."')],
      [0.5, R => { R.hold = 12; player.health = 100; player.money += 50; sfx.coin(); say('🍦 Snug Cove, Bowen Island', 'Mildred buys you an ice cream (fully healed) and slips you $50 "for gas money, dear". (+$50)', 5000); }],
      [0.75, R => say('💎 Mildred', '"Never buy a boat, dear. Make friends with people who have boats. That\'s the secret."')]],
    end(R) { player.stats.charters.add('retiree'); discover('retiree'); } },
];
export const _charters = CHARTERS;   // for tests

// ---- charter helpers used by the scripts above ----
function photoShoot(R, place, line) {
  say('📸 Chad: ' + place, line, 3500);
  timedShots(R, { n: 3, need: 1, title: '📸 ' + place, help: 'press <b>E</b> to snap when the dot is in the green', speed: 3,
    onHit: () => { sfx.shutter(); R.shots = (R.shots || 0) + 1; player.money += 25; say('📸 *click*', pick(['Chad: "THAT\'S the thumbnail, bro." (+$25)', 'Chad: "I look like I own a hockey team. Love it." (+$25)', 'Chad: "Posting it. 4 likes already. Two are my mom." (+$25)'])); },
    onMiss: () => { sfx.shutter(); say('📸 *click*', pick(['Chad: "My eyes were closed. AGAIN."', 'Chad: "You got the seagull, not me."', 'Chad: "Bro, that\'s your thumb."']), 1800); },
    onEnd: () => {} });
}
function planePass(R, kind, fact) {
  const p = planeModel(); p.g.rotation.order = 'YXZ'; scene.add(p.g);
  const side = Math.random() < 0.5 ? -1 : 1, rx = Math.cos(R.yaw), rz = -Math.sin(R.yaw), fx = -Math.sin(R.yaw), fz = -Math.cos(R.yaw);
  const sx = R.x - fx * 380 + rx * side * 60, sz = R.z - fz * 380 + rz * side * 60; let t = 0, got = false;
  say('✈️ Dot', `"Incoming! ${kind} at six o'clock. Get your binoculars on it and press E when it's close!"`, 3500);
  R.hold = 999;
  R.mini = { update(dt) {
    t += dt; const s = t * 38, x = sx + fx * s, z = sz + fz * s, y = Math.max(0.05, (s - 250) * 0.12);
    p.g.position.set(x, y, z); p.g.rotation.set(y > 0.1 ? 0.12 : 0, R.yaw, 0, 'YXZ'); if (p.prop) p.prop.rotation.z += dt * 60;
    if (y < 0.2 && Math.random() < dt * 20) emit(SPRAY, x, 0.3, z, R2(-1, 1), R2(1, 3), R2(-1, 1), 0.8);
    const d = Math.hypot(x - R.x, z - R.z), close = d < 140;
    hud(`🔭 ${kind}: ${close ? '<b style="color:#48bb78">IN SIGHT — press E!</b>' : d.toFixed(0) + ' m'} · Bingo card: ${R.spotted || 0}/3`);
    if (!got && close && tapped('KeyE')) { got = true; R.spotted = (R.spotted || 0) + 1; player.money += 5; sfx.coin(); say('🔭 Spotted: ' + kind + '! (+$5)', fact, 5000); }
    if (t > 22) { scene.remove(p.g); R.hold = 0; if (!got) say('✈️ Missed it!', 'Dot: "It\'s fine. There\'s always another one. Every four minutes, actually."', 2500); return true; }
    return false;
  } };
}
function spawnDinghy(R) {
  const g = new THREE.Group(); addMesh(new THREE.TorusGeometry(1.2, 0.4, 8, 16).rotateX(Math.PI / 2).scale(1, 1, 1.8), mt('#4a5568'), 0, 0.3, 0, g);
  bx(g, 1.5, 0.1, 3.6, 0, 0.1, 0, '#2d3748'); cy(g, 0.02, 0.02, 2, 0, 1.2, 1.2, '#ddd'); sign(g, '⚓ ROYAL NAVY', '#1a365d', '#fff', 1.2, 0.5, 0.6, 2.0, 1.2);
  for (const z of [-0.6, 0.6]) { const h = person({ shirt: '#1a365d', hat: '#f7fafc' }, 0.55); g.add(h.grp); h.grp.position.set(0, 0.2, z); h.st.kind = 'wave'; h.st.amp = 1; R.dinghyKids = (R.dinghyKids || []).concat(h); }
  scene.add(g); R.dinghy = g; R.dinghyA = 0;
}
function dropDinghy(R) { if (R.dinghy) { scene.remove(R.dinghy); R.dinghy = null; } }
function soak(R, miss) {
  if (!R.dinghy) return; const p = R.dinghy.position, fx = p.x - R.x, fz = p.z - R.z, L = Math.hypot(fx, fz) || 1;
  for (let k = 0; k < 30; k++) { const t = k / 30, ox = miss ? R2(-6, 6) : 0; emit(SPRAY, R.x + fx * t + ox, 2.5 + Math.sin(t * Math.PI) * 4, R.z + fz * t + ox, fx / L * 2, R2(0, 2), fz / L * 2, 0.6 + t * 0.4, 0.9); }
  if (!miss) splashAt(p.x, p.z, 16, 4);
}

// ---- charter runtime ----
const docks = [];   // { C, built, berth:[x,z], byaw, stand:[x,z,y], M (model), host (makeHuman), P (path) }
let ride = null;
function roomy(x, z, m) { return isWater(x, z) && isWater(x + m, z) && isWater(x - m, z) && isWater(x, z + m) && isWater(x, z - m); }
const deckAt = (x, z) => walkY(x, z, 6) > waterLevel(x, z) + 0.4;   // a pier / float deck over the water
function lineOnWater(a, b) { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let d = 0; d < L; d += 8) if (!isWater(a[0] + (b[0] - a[0]) * d / L, a[1] + (b[1] - a[1]) * d / L)) return false; return true; }
function findBerth(x0, z0, len) {
  const m = len * 0.45 + 2, k = m * 0.7;
  for (let r = 0; r < 400; r += 5) for (let a = 0; a < 6.28; a += 0.3) {
    const x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r;
    if (roomy(x, z, m) && !deckAt(x, z) && !deckAt(x + k, z) && !deckAt(x - k, z) && !deckAt(x, z + k) && !deckAt(x, z - k)) return [x, z];
  }
  return [x0, z0];
}
function findStand(x0, z0) {
  for (let r = 3; r < 300; r += 3) for (let a = 0; a < 6.28; a += 0.25) { const x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r, h = walkY(x, z, 5); if (h > waterLevel(x, z) + 0.4 && h < 8 && !buildingAt(x, z)) return [x, z, h]; }
  return [x0, z0, 1];
}
function openYaw(x, z) { let best = 0, by = 0; for (let k = 0; k < 16; k++) { const yw = k / 16 * Math.PI * 2, fx = -Math.sin(yw), fz = -Math.cos(yw); let d = 0; while (d < 120 && isWater(x + fx * d, z + fz * d)) d += 6; if (d > best) { best = d; by = yw; } } return by; }
function buildDock(D) {
  const C = D.C; D.built = true;
  const [x0, z0] = toXZ(C.dock[0], C.dock[1]);
  // the host's spot on the shore/dock first, then the nearest roomy water to it for the boat (so they're side by side)
  D.M = MODELS[C.boat](); D.stand = findStand(x0, z0);
  D.berth = findBerth(D.stand[0], D.stand[1], D.M.len * 0.6); D.byaw = openYaw(...D.berth);
  D.stand = findStand(...D.berth);   // and the host walks to the bit of shore closest to the boat
  D.M.g.rotation.order = 'YXZ'; scene.add(D.M.g);
  D.host = person(C.host[1]); D.host.grp.position.set(D.stand[0], D.stand[2], D.stand[1]);
  D.host.grp.rotation.y = Math.atan2(-(player.x - D.stand[0]), -(player.z - D.stand[1]));
  placeIdle(D, 0);
}
function buildPath(D, toXZpt) {
  const C = D.C;
  const wps = toXZpt ? [toXZpt] : C.route.map(([la, lo]) => findBerth(...toXZ(la, lo), 10));
  let all = [D.berth];
  for (const w of wps) {
    const a = all[all.length - 1], leg = waterRoute(a, w);
    if (leg.length === 2 && !lineOnWater(a, w) && !toXZpt) continue;   // a waypoint we can't reach by water: skip it
    all = all.concat(leg.slice(1));
  }
  if (C.loop) { const leg = waterRoute(all[all.length - 1], D.berth); all = all.concat(leg.slice(1)); }
  return makePath(all);
}
function placeIdle(D, dt) {
  const [x, z] = D.berth, g = D.M.g; g.visible = true;
  g.position.set(x, waterLevel(x, z) + Math.sin(G.t * 1.2 + x) * 0.06, z); g.rotation.set(Math.sin(G.t * 0.9 + z) * 0.01, D.byaw, Math.sin(G.t * 0.7 + x) * 0.02, 'YXZ');
  D.M.anim?.(dt, null);
}
function chartersNear(r) { return docks.filter(D => D.built && D.stand && Math.hypot(D.stand[0] - player.x, D.stand[1] - player.z) < r); }
function canBoard() { return !ride && !player.vehicle && !player.transit && !G.dialogOpen && !activeMission() && !player.dead; }
export function boatPrompt(pl) {
  if (ride) return ride.offer ? `<kbd>E</kbd> ${ride.offer.label}` : '';
  if (!canBoard()) return '';
  for (const D of docks) {
    if (!D.built || D.busy) continue;
    const dS = Math.hypot(D.stand[0] - pl.x, D.stand[1] - pl.z), dB = Math.hypot(D.berth[0] - pl.x, D.berth[1] - pl.z);
    if (Math.min(dS, dB - D.M.len * 0.3) > 9 || Math.abs(pl.y - D.stand[2]) > 4) continue;
    const C = D.C;
    if (tapped('KeyE')) offerCharter(D);
    return `<kbd>E</kbd> ${C.icon} ${C.title}${C.fare > 0 ? ` ($${C.fare})` : C.fare === 0 && !C.taxi ? ' (free)' : ''} · ${C.host[0]}`;
  }
  return '';
}
async function offerCharter(D) {
  const C = D.C;
  if (C.taxi) {
    const opts = C.dests.map(d => d[0] + ` ($${C.fare})`).concat(['No thanks']);
    const i = await ui.dialog(C.icon + ' ' + C.title, C.pitch, opts); if (i >= C.dests.length) return;
    if (player.money < C.fare) { ui.toast('💸 Not enough cash', `Ravi: "It's $${C.fare}, friend. I take cash, cards and interesting stories."`, 2500); return; }
    player.money -= C.fare; sfx.coin(); const d = C.dests[i]; startCharter(D, toXZ(d[1], d[2]), d[0]); return;
  }
  const opts = C.choices ? C.choices() : [C.fare > 0 ? `🛥️ Hop aboard ($${C.fare})` : '🛥️ Hop aboard', 'No thanks'];
  const i = await ui.dialog(C.icon + ' ' + C.title, C.pitch, opts);
  const yes = C.choose ? C.choose(i, opts) : i === 0; if (!yes) return;
  if (C.fare > 0) { if (player.money < C.fare) { ui.toast('💸 Not enough cash', `It's $${C.fare}. Maybe do a delivery gig first?`, 2500); return; } player.money -= C.fare; sfx.coin(); }
  startCharter(D);
}
function startCharter(D, dest, destName) {
  const C = D.C;
  const P = buildPath(D, dest ? findBerth(dest[0], dest[1], 8) : null);
  const tl = C.realTime ? 1 : Math.max(1, P.L / (C.speed * C.dur));
  ride = { D, C, P, s: 0, v: 0, tl, ff: false, hold: 0, mini: null, offer: null, ei: 0, timers: [], x: D.berth[0], z: D.berth[1], yaw: D.byaw, camDist: G.camDist, destName, dest,
    after(t, fn) { this.timers.push({ t, fn }); }, rivals: [] };
  D.busy = true;
  player.stats.charters = player.stats.charters || new Set();
  player.transit = true; player.vy = 0; G.camDist = C.cam || 18;
  D.M.g.add(D.host.grp); D.host.grp.position.set(D.M.host[0], D.M.host[1], D.M.host[2]); D.host.grp.rotation.set(0, D.M.host[3], 0);
  if (C.id === 'dragon') for (const [col, team, off] of [['#2b6cb0', ['#2b6cb0', '#f7fafc'], -9], ['#d69e2e', ['#1a202c', '#ecc94b'], 9]]) { const m = MODELS.dragon(col, team); m.g.rotation.order = 'YXZ'; scene.add(m.g); ride.rivals.push({ m, off, s: 0, v: R(7.2, 8.6) }); }
  ui.toast(`${C.icon} ${C.title}${destName ? ' → ' + destName : ''}`, (C.id === 'dragon' ? '' : 'Space: speed up · Space again: skip to the end · ') + 'F: jump overboard', 3500);
}
function endCharter(how) {
  const R = ride, D = R.D, C = R.C; ride = null; hud('');
  for (const r of R.rivals) scene.remove(r.m.g); dropDinghy(R);
  if (R.mini && R.mini.cleanup) R.mini.cleanup();
  player.transit = false; G.camDist = R.camDist; player.model.grp.visible = true;
  D.M.g.remove(D.host.grp); scene.add(D.host.grp); D.host.grp.position.set(D.stand[0], D.stand[2], D.stand[1]); D.host.grp.rotation.set(0, 0, 0);
  if (how === 'overboard') {
    const [x, z] = [R.x + Math.cos(R.yaw) * 4, R.z - Math.sin(R.yaw) * 4]; player.x = x; player.z = z; player.y = waterLevel(x, z) - 0.5; sfx.splash(); splashAt(x, z, 20, 5);
    ui.toast('🌊 You jumped overboard!', pick([`${C.host[0]} yells: "WE HAVE A RUNNER!"`, 'The water is… bracing. That\'s the Vancouver word for "freezing".', 'Everyone on deck films it. You\'re going viral, just not how you hoped.']), 3500);
    D.busy = false; return;
  }
  let sx, sz, sy;
  if (C.oneWay) { const end = pathAt(R.P, R.P.L), st = findStand(end[0], end[1]); [sx, sz, sy] = st; D.ret = { P: R.P, s: R.s }; }   // the boat heads home on its own
  else [sx, sz, sy] = D.stand;
  player.x = sx; player.z = sz; player.y = sy; player.vy = 0;
  if (how === 'skip') ui.toast('⏭️ Skipped ahead…', 'You dozed off in the sun and woke up at the dock. Sunburnt.', 2500);
  else C.end?.(R);
  D.busy = !!D.ret; R.timers.length = 0;
}
const _v = new THREE.Vector3();
function updateRide(dt) {
  const R = ride, C = R.C, D = R.D, P = R.P;
  if (tapped('KeyF')) return endCharter('overboard');
  if (tapped('Space') && !(R.mini && R.mini.noSkip)) {
    if (!R.ff) { R.ff = true; ui.toast('⏩ Fast-forward', 'Press Space again to skip to the end.', 1800); }
    else return endCharter('skip');
  }
  const mul = R.ff ? 6 : 1, dtE = dt * mul;
  // timers + offers
  for (let i = R.timers.length - 1; i >= 0; i--) { R.timers[i].t -= dtE; if (R.timers[i].t <= 0) { const f = R.timers[i].fn; R.timers.splice(i, 1); f(R); } }
  if (R.offer) { if (tapped('KeyE')) { const o = R.offer; R.offer = null; o.fn(); } else if (R.offer.t !== undefined) { R.offer.t -= dt; if (R.offer.t < 0) { R.offer = null; say('🛟 The crew fished him out', 'He\'s fine. His phone is not.', 2500); } } }
  // the mini-game (if any) decides when we move on
  if (R.mini && R.mini.update(dt)) { R.mini = null; hud(''); if (R.hold > 900) R.hold = 0; }
  if (!R.mini) hud(R.offer ? `<kbd>E</kbd> ${R.offer.label}` : (R.ff ? '⏩ Fast-forward · <b>Space</b> again: skip · <b>F</b>: jump overboard' : '<b>Space</b>: speed up · <b>F</b>: jump overboard'));
  // move along the route (time-lapsed on long routes; the dragon race is real-time and powered by you)
  let target = C.speed;
  if (R.dragonSpeed !== undefined) target = R.dragonSpeed;
  if (R.hold > 0) { R.hold -= dt; target = 0; }   // stops (whales, ice cream) always play at normal speed
  const remain = P.L - R.s, tl = R.realTime || R.dragonSpeed !== undefined ? 1 : R.tl;
  if (R.dragonSpeed === undefined) target = Math.min(target, Math.sqrt(2 * 0.9 * remain / tl) + 0.4);
  R.v += (target - R.v) * Math.min(1, dt * (target < R.v ? 1.5 : 0.6));
  R.s = Math.min(P.L, R.s + R.v * tl * dtE);
  // fast-forward only speeds up the sailing in between: anything that happens (whales, a fish, a game) drops back to normal speed
  while (R.ei < C.ev.length && R.s / P.L >= C.ev[R.ei][0]) { const e = C.ev[R.ei++]; e[1](R); if (R.mini || R.hold > 0 || R.offer) R.ff = false; }
  // pose the boat
  const [x, z] = pathAt(P, R.s), yawT = pathYaw(P, R.s);
  R.yaw += wrapAngle(yawT - R.yaw) * Math.min(1, dt * 2.5); R.x = x; R.z = z;
  const wl = waterLevel(x, z), A = 0.06 + 0.2 * (G.wet || 0), g = D.M.g;
  R.kick = (R.kick || 0) * Math.exp(-dt * 1.5);
  g.position.set(x, wl + Math.sin(G.t * 1.3) * A * 0.6, z); g.rotation.set(Math.cos(G.t * 1.1) * A * 0.08 + Math.min(0.04, R.v * 0.004), R.yaw, Math.sin(G.t * 0.9) * A * 0.12 + Math.sin(G.t * 3) * R.kick, 'YXZ');
  D.M.anim?.(dt, R);
  if (R.v > 1.5) { R.fm = (R.fm || 0) + dt * Math.min(30, R.v * 2); const fx = -Math.sin(R.yaw), fz = -Math.cos(R.yaw), L = D.M.len / 2; while (R.fm > 1) { R.fm--; emit(FOAM, x - fx * L + R2(-1, 1), wl + 0.08, z - fz * L + R2(-1, 1), R2(-0.4, 0.4), 0, R2(-0.4, 0.4), R2(2, 4), 0.35); } }
  // rivals in the dragon race paddle alongside
  for (const r of R.rivals) { const [rx0, rz0] = pathAt(P, r.s), ry = pathYaw(P, r.s), ox = Math.cos(ry) * r.off, oz = -Math.sin(ry) * r.off; r.m.g.position.set(rx0 + ox, waterLevel(rx0, rz0), rz0 + oz); r.m.g.rotation.set(0, ry, 0, 'YXZ'); r.m.anim?.(dt, { dragonSpeed: r.v * 0.5 }); }
  if (R.dinghy) { R.dinghyA += dt * 0.35; const a = R.dinghyA, dx = x + Math.cos(a) * 28, dz = z + Math.sin(a) * 28; R.dinghy.position.set(dx, wl + Math.sin(G.t * 2) * 0.1, dz); R.dinghy.rotation.y = -a; (R.dinghyKids || []).forEach(h => { h.st.phase += dt * 4; h.pose(dt); }); }
  // you, on deck
  g.updateMatrixWorld(true); const S = D.M.seat; _v.set(S[0], S[1], S[2]).applyMatrix4(g.matrixWorld);
  player.x = _v.x; player.z = _v.z; player.y = _v.y;
  const m = player.model; m.grp.visible = true; m.grp.position.copy(_v); m.grp.rotation.set(0, R.yaw + S[3], 0, 'YXZ');
  m.st.kind = S[4] === 'dance' ? 'dance' : S[4] === 'sit' ? 'sit' : 'walk'; m.st.amp = S[4] === 'dance' ? 1 : 0; m.st.phase += dt * 4; m.pose(dt);
  const h = D.host; h.st.kind = D.M.host[4] || (R.mini ? 'wave' : 'walk'); h.st.amp = R.mini ? 1 : 0; h.st.phase += dt * 3; h.pose(dt);
  if (!G.mouse.dx) G.camYaw += wrapAngle(R.yaw + Math.PI * 0.15 - G.camYaw) * Math.min(1, dt * 0.6);
  surprises(dt, { x, z, yaw: R.yaw, g, deck: S[1], ride: R });
  if (R.s >= P.L - 0.5 && !R.mini && R.hold <= 0) endCharter('done');
}

// ---------- surprises on the water ----------
let surpT = R(30, 60), seal = null;
const ducks = { m: null, beak: null, list: [], seen: false };
function sealModel() {
  const g = new THREE.Group(), c = mt('#77736a');
  addMesh(new THREE.SphereGeometry(1, 12, 8).scale(0.42, 0.3, 0.85), c, 0, 0.3, 0, g); addMesh(new THREE.SphereGeometry(0.26, 10, 8), c, 0, 0.5, -0.85, g);
  for (const s of [-1, 1]) addMesh(new THREE.SphereGeometry(0.045, 6, 4), mt('#111'), s * 0.1, 0.58, -1.07, g, false);
  bx(g, 0.5, 0.06, 0.3, 0, 0.12, 0.95, '#5d5a53'); return g;
}
function surprise(kind, ctx) {
  const fx = -Math.sin(ctx.yaw), fz = -Math.cos(ctx.yaw);
  if (kind === 'seal' && !seal) {
    const g = sealModel(); ctx.g.add(g); g.position.set(0, ctx.deck + 0.02, ctx.v ? 0.2 : 2.5); g.rotation.y = R(0, 6.28); seal = { g, t: 20, parent: ctx.g };
    if (ctx.v && ctx.v.type === 'kayak') { g.position.set(0, 0.25, 1.3); g.scale.setScalar(0.8); }
    splashAt(ctx.x + fz * 2, ctx.z - fx * 2, 12, 3);
    ui.toast('🦭 A seal just flopped onto the boat!', pick(['It looks at you like YOU are the one who doesn\'t belong here.', 'It burps. It smells like 400 herring. It refuses to leave.', 'Harbour seals do this to get a rest. This one has chosen violence (napping).']), 4500); discover('sealaboard');
  } else if (kind === 'wave') {
    if (ctx.v) { const b = ctx.v.boat || {}; b.vy = 4.2; b.h = 0.01; b.kr = 0.5; ctx.v.speed *= 0.6; if (ctx.v.type === 'kayak' && Math.random() < 0.6) { b.cap = 0.01; ui.toast('🌊 ROGUE WAVE!', 'Your kayak rolls ALL the way over… and back up! A perfect kayak roll, completely by accident. Legend.', 3500); } else ui.toast('🌊 ROGUE WAVE!', 'Out of nowhere! The boat leaps and you get a face full of Pacific Ocean.', 3000); }
    else { ctx.ride.kick = 0.35; ui.toast('🌊 ROGUE WAVE!', `The boat lurches, someone's hot dog flies overboard and ${ctx.ride.C.host[0]} pretends that was planned.`, 3500); }
    for (let k = 0; k < 40; k++) emit(SPRAY, ctx.x + fx * 3 + R(-3, 3), waterLevel(ctx.x, ctx.z) + 0.5, ctx.z + fz * 3 + R(-3, 3), R(-4, 4) - fx * 3, R(4, 9), R(-4, 4) - fz * 3, R(0.8, 1.5), 0.9);
    sfx.splash(); discover('roguewave');
  } else if (kind === 'dolphins') {
    _sea.spawnDolphins({ x: ctx.x + fx * 50, z: ctx.z + fz * 50, yaw: ctx.yaw }); ui.toast('🐬 Dolphin escort!', 'A pod of Pacific white-sided dolphins races up to the boat to play in the bow wave. Everybody lose their minds!', 4500);
  } else if (kind === 'ducks') spawnDucks(ctx.x + fx * R(60, 110) + fz * R(-30, 30), ctx.z + fz * R(60, 110) - fx * R(-30, 30));
}
function updateSeal(dt) { if (seal) { seal.t -= dt; if (seal.t < 0) { const w = new THREE.Vector3(); seal.g.getWorldPosition(w); seal.parent.remove(seal.g); splashAt(w.x, w.z, 12, 3); ui.toast('🦭 Sploosh', 'The seal slides off and swims away. You feel oddly abandoned.', 2200); seal = null; } } }
function surprises(dt, ctx) {
  surpT -= dt; if (surpT > 0) return; surpT = R(45, 90);
  let sea = waterLevel(ctx.x, ctx.z) === 0;   // dolphins only out in open sea (no land within 150 m), not in False Creek
  for (let a = 0; a < 6.28 && sea; a += 0.785) if (!isWater(ctx.x + Math.cos(a) * 150, ctx.z + Math.sin(a) * 150)) sea = false;
  const opts = ['seal', 'wave', 'ducks'].concat(sea ? ['dolphins', 'dolphins'] : []);
  if (ctx.v && ctx.v.speedAbs < 1.5 && Math.random() < 0.6) return;   // sitting still: less happens
  surprise(pick(opts), ctx);
}
function duckGeo() {
  const parts = [new THREE.SphereGeometry(0.22, 10, 8).scale(1, 0.75, 1.25).translate(0, 0.12, 0), new THREE.SphereGeometry(0.13, 10, 8).translate(0, 0.33, -0.17), new THREE.ConeGeometry(0.03, 0.06, 4).scale(1, 1, 1).translate(0, 0.08, 0.32)];
  return { body: mergeGeometries(parts.slice(0, 2).map(p => p.toNonIndexed())), beak: new THREE.BoxGeometry(0.12, 0.04, 0.1).translate(0, 0.31, -0.33) };
}
function spawnDucks(x, z) {
  if (!ducks.m) { const g = duckGeo(); ducks.m = new THREE.InstancedMesh(g.body, std('#ffd400', { roughness: 0.35 }), 60); ducks.beak = new THREE.InstancedMesh(g.beak, std('#ff7a00'), 60); ducks.m.frustumCulled = ducks.beak.frustumCulled = false; scene.add(ducks.m); scene.add(ducks.beak); }
  ducks.list = []; for (let i = 0; i < 60; i++) { const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * 18; if (!isWater(x + Math.cos(a) * r, z + Math.sin(a) * r)) continue; ducks.list.push({ x: x + Math.cos(a) * r, z: z + Math.sin(a) * r, yaw: R(0, 6.28), vx: 0, vz: 0, ph: R(0, 6) }); }
  ducks.seen = false; ducks.m.visible = ducks.beak.visible = true;
}
const _o = new THREE.Object3D();
function updateDucks(dt) {
  if (!ducks.m || !ducks.m.visible) return;
  let near = 1e9; const pv = player.vehicle, px = player.x, pz = player.z;
  ducks.list.forEach((d, i) => {
    const dx = d.x - px, dz = d.z - pz, dd = Math.hypot(dx, dz); near = Math.min(near, dd);
    if (dd < (pv ? pv.d.r + 3 : 2.2) && dd > 0.01) { const push = (pv ? Math.max(3, pv.speedAbs) : 2.5) / dd; d.vx += dx * push * dt * 3; d.vz += dz * push * dt * 3; if (Math.random() < 0.08) beep([1400, 1900], 0.06, 'sine', 0.03, 0.05); }
    d.vx *= Math.exp(-dt); d.vz *= Math.exp(-dt); const nx = d.x + (d.vx + 0.15) * dt, nz = d.z + (d.vz + 0.05) * dt; if (isWater(nx, nz)) { d.x = nx; d.z = nz; }   // the tide carries them east
    d.yaw += Math.sin(G.t * 0.3 + d.ph) * dt * 0.4;
    _o.position.set(d.x, waterLevel(d.x, d.z) - 0.04 + Math.sin(G.t * 2 + d.ph) * 0.04, d.z); _o.rotation.set(Math.sin(G.t * 1.7 + d.ph) * 0.12, d.yaw, Math.sin(G.t * 1.3 + d.ph) * 0.12); _o.updateMatrix();
    ducks.m.setMatrixAt(i, _o.matrix); ducks.beak.setMatrixAt(i, _o.matrix);
  });
  ducks.m.count = ducks.beak.count = ducks.list.length; ducks.m.instanceMatrix.needsUpdate = ducks.beak.instanceMatrix.needsUpdate = true;
  if (!ducks.seen && near < 45) { ducks.seen = true; ui.toast('🦆 A flotilla of rubber ducks?!', 'In 1992 a shipping container of 28,000 bath toys fell into the Pacific. These "Friendly Floatees" have been washing up for decades. Some of them are here, apparently.', 6000); discover('rubberducks'); }
  if (near > 900) ducks.m.visible = ducks.beak.visible = false;
}

// ---------- init + update ----------
let lastVeh = null;
function boatCam(v) { const want = { yacht: 20, sailboat: 13, speedboat: 10 }[v.type]; if (want && G.camDist < want) G.camDist = want; }   // big boats: pull the camera back so you see the boat
export function initBoats() {
  boatHook.drive = driveBoat;
  SPRAY = cloud(900, 0.7, 9); FOAM = cloud(1400, 2.2, 0);
  VT.yacht.show = true; VT.yacht.sitY = 4.72; VT.yacht.seat = 'walk';   // drive the yacht from the flybridge, standing
  VT.sailboat.max = FEEL.sailboat.max; VT.speedboat.max = FEEL.speedboat.max; VT.yacht.max = FEEL.yacht.max;
  player.borrowBoat = borrowBoat;
  const ex = player.exitVehicle; player.exitVehicle = function (force) { const v = this.vehicle; ex.call(this, force); if (v && v.d.kind === 'water' && !force) stepAshore(v); };
  for (const C of CHARTERS) docks.push({ C, built: false });
}
export function updateBoats(dt, pl) {
  updateWind(dt); stepCloud(SPRAY, dt); stepCloud(FOAM, dt); updateDucks(dt); updateSeal(dt);
  // build the charter docks you get close to (lazy: the boats, the host, the berth)
  for (const D of docks) {
    if (!D.built) { const [x, z] = toXZ(D.C.dock[0], D.C.dock[1]); if (Math.abs(x - pl.x) < 1500 && Math.abs(z - pl.z) < 1500) buildDock(D); continue; }
    if (D.ret) {   // a one-way boat (water taxi, dragon boat) motoring back to its dock
      const far = Math.hypot(D.berth[0] - pl.x, D.berth[1] - pl.z) > 400 && Math.hypot(D.M.g.position.x - pl.x, D.M.g.position.z - pl.z) > 400;
      D.ret.s -= dt * (far ? 200 : 6);
      if (D.ret.s <= 0) { D.ret = null; D.busy = false; continue; }
      const [x, z] = pathAt(D.ret.P, D.ret.s); D.M.g.position.set(x, waterLevel(x, z), z); D.M.g.rotation.set(0, pathYaw(D.ret.P, D.ret.s) + Math.PI, 0, 'YXZ'); D.M.anim?.(dt, { dragonSpeed: 2 });
      continue;
    }
    if (D.busy) continue;
    const far = Math.hypot(D.berth[0] - pl.x, D.berth[1] - pl.z) > 2500; D.M.g.visible = !far; D.host.grp.visible = !far;
    if (!far) { placeIdle(D, dt); const h = D.host, d = Math.hypot(D.stand[0] - pl.x, D.stand[1] - pl.z); h.grp.rotation.y = Math.atan2(-(pl.x - D.stand[0]), -(pl.z - D.stand[1])); h.st.kind = d < 14 ? 'wave' : 'walk'; h.st.amp = d < 14 ? 1 : 0; h.st.phase += dt * 3; h.pose(dt); }
  }
  if (ride) { updateRide(dt); return; }
  // your own boat: type tips, sailing hints, surprises
  const v = pl.vehicle;
  if (v !== lastVeh) { lastVeh = v; if (v && TIPS[v.type]) { const t = TIPS[v.type]; ui.toast(t[0], typeof t[1] === 'function' ? t[1]() : t[1], 5000); boatCam(v); } }
  if (v && v.d.kind === 'water') {
    if (v.type === 'sailboat') { const b = v.boat || {}; hud(`🌬️ Wind from the <b>${compass(WIND.yaw)}</b> ${'▮'.repeat(Math.round(WIND.str * 5))} · ${b.irons ? '<b style="color:#fc8181">In irons! Turn away from the wind</b>' : `sails drawing ${Math.round((b.pol || 0) * 100)}%`} · ${Math.round(v.speedAbs * 3.6)} km/h`); }
    else hud('');
    surprises(dt, { x: v.x, z: v.z, yaw: v.yaw, g: v.g, deck: v.type === 'yacht' ? 3.3 : v.type === 'sailboat' ? 0.45 : v.type === 'speedboat' ? 0.4 : 0.3, v });
  } else if (_hud && _hud.style.display !== 'none') hud('');
  // abandoned borrowed boats drift back to their slips once you're far away
  for (let i = borrowed.length - 1; i >= 0; i--) { const b = borrowed[i], s = moored.spots[b.i]; if (b.v.driver !== 'player' && Math.hypot(pl.x - s[0], pl.z - s[1]) > 350 && Math.hypot(pl.x - b.v.x, pl.z - b.v.z) > 350) { removeVehicle(b.v); showMoored(b.i); borrowed.splice(i, 1); } }
}
export const isOnCharter = () => !!ride;
export const charterName = () => ride ? `${ride.C.icon} ${ride.C.title}${ride.destName ? ' → ' + ride.destName : ''}` : '';
export function charterMarkers() { return docks.filter(D => D.built && !D.busy).map(D => ({ x: D.stand[0], z: D.stand[1], icon: D.C.icon })); }
export const _boats = { docks, CHARTERS, borrowed, WIND, FEEL, get ride() { return ride; }, startCharter: (id, dest) => { const D = docks.find(d => d.C.id === id); if (!D.built) buildDock(D); startCharter(D, dest); return ride; }, borrowBoat, mooredNear, surprise: (k) => { const v = player.vehicle; surprise(k, v ? { x: v.x, z: v.z, yaw: v.yaw, g: v.g, deck: 0.4, v } : { x: ride.x, z: ride.z, yaw: ride.yaw, g: ride.D.M.g, deck: ride.D.M.seat[1], ride }); }, endCharter, waterRoute,
  // checker: build every charter's route and count route points that are not on water
  checkRoutes(ids) { const out = []; for (const D of docks) { if (ids && !ids.includes(D.C.id)) continue; if (!D.built) buildDock(D); for (const dd of D.C.dests || [null]) { const P = buildPath(D, dd ? findBerth(...toXZ(dd[1], dd[2]), 8) : null); let bad = 0, fb = null; for (const p of P.pts) if (!isWater(p[0], p[1])) { bad++; fb = fb || p.map(Math.round); } out.push({ id: D.C.id + (dd ? ':' + dd[0] : ''), L: Math.round(P.L), pts: P.pts.length, bad, fb, standDist: Math.round(Math.hypot(D.stand[0] - D.berth[0], D.stand[1] - D.berth[1])) }); } } return out; } };
