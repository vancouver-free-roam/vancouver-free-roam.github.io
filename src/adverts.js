// Advertising around the city (all PARODY brands, never real logos), built near you as you move:
//  - big billboards on posts along highways and main roads, and billboards on the roofs of mid-rise buildings
//  - LED screens on downtown towers that flip to a new ad every few seconds (bright at night)
//  - backlit ad panels next to bus stops and on downtown sidewalks (two-sided)
//  - paper posters stapled to lamp posts (lost cats, band nights, roommates wanted…)
// The ads are painted once into texture atlases; every kind of face is ONE merged mesh (a handful of draw calls).
import * as THREE from 'three';
import { G, scene, std, hash2, canvasTex, toXZ, pick } from './core.js';
import { isWater, groundY } from './terrain.js';
import { roadGrid, NX, NZ, walkY, buildingAt, nearBuildings, nearestRoad, bldGrid } from './city.js';
import { transitStops } from './transit.js';
import { _colliderGrids, setColliders } from './colliders.js';

const M = window.MAP;
// [brand, tagline, small print, background, text colour, accent, icon]
const ADS = [
  ['Lululemony', 'Stretchy pants for your stretchy rent.', 'Now in "Drizzle Grey"', '#c62828', '#ffffff', '#ffcdd2', '🧘'],
  ['TransLynx', 'SkyTrain: 40% fewer delays*', '*on Tuesdays', '#0d47a1', '#ffffff', '#ffd54f', '🚆'],
  ['Harbour Err', 'Fly to Victoria. Arrive slightly damp.', 'Floatplanes since forever', '#00695c', '#ffffff', '#b2dfdb', '🛩️'],
  ['Mountain Equipment Co-Nope', 'Gear for the hike you\'ll do "next weekend".', 'Members save. Eventually.', '#2e7d32', '#ffffff', '#c5e1a5', '🎒'],
  ['Re/Maxed-Out Realty', 'Cozy studio, 210 sq ft. $2,900/mo.', 'View of a wall. Very private.', '#1a237e', '#ffffff', '#ff5252', '🏠'],
  ['Barbucks Coffee', 'Your name, spelled wrong, since 1971.', 'Try the Pumpkin Spice Drizzle', '#1b5e20', '#ffffff', '#ffffff', '☕'],
  ['BC Fairies', 'Sail to the Island. Bring snacks.', 'Lots of snacks. 95 minutes.', '#01579b', '#ffffff', '#ffeb3b', '⛴️'],
  ['Vancouver Canooks', 'This is the year.', '(Again.)', '#00205b', '#ffffff', '#00843d', '🏒'],
  ['Tourism Raincouver', 'Come for the mountains.', 'Stay because you can\'t afford to leave.', '#37474f', '#ffffff', '#80deea', '🏔️'],
  ['Japa-Dogg', 'Hot dogs with seaweed. Trust us.', 'As seen on every food blog', '#f9a825', '#212121', '#d32f2f', '🌭'],
  ['Kompass Card', 'Tap. Tap again. Tap harder.', 'It works most of the time!', '#263238', '#ffffff', '#29b6f6', '💳'],
  ['Save-Almost-On-Foods', 'Groceries at almost reasonable prices.', 'Bananas: $0.79. Everything else: lol', '#c62828', '#ffffff', '#fff176', '🛒'],
  ['Paris Drugs', 'A TV, cough syrup and a canoe.', 'One store. Everything.', '#0d47a1', '#ffffff', '#ef5350', '📺'],
  ['Whistlr', 'Ski all day. Pay all week.', 'Lift tickets from $1 million', '#4a148c', '#ffffff', '#ce93d8', '⛷️'],
  ['Lotto 6/49-ish', 'Win a down payment!', '(on a parking spot)', '#f57f17', '#212121', '#ffffff', '🎟️'],
  ['City of Vancouver', 'Please don\'t feed the raccoons.', 'They have a union now.', '#455a64', '#ffffff', '#ffd54f', '🦝'],
  ['Rodgers Wireless', '5G in the SkyTrain tunnel!*', '*no', '#b71c1c', '#ffffff', '#ffffff', '📶'],
  ['Skip the Washes', 'Dinner in 45 minutes. Or 90.', 'Tip your rider. They biked up a hill.', '#ef6c00', '#ffffff', '#212121', '🛵'],
  ['Kits Motors', 'Buy a car. Sit in traffic in style.', 'Burrard St · 0% fun financing', '#212121', '#ffffff', '#ffc107', '🚗'],
  ['Goose Watch BC', 'Canada geese: they will win.', 'Do not make eye contact.', '#3e2723', '#ffffff', '#a1887f', '🪿'],
  ['Granville Island Fudge Co.', 'Life is short. Eat the fudge.', 'Seagull-proof bags available', '#6d4c41', '#fff8e1', '#ffcc80', '🍫'],
  ['Pacific Rain Gear', 'You don\'t need an umbrella.', 'You need a lifestyle.', '#006064', '#ffffff', '#ffeb3b', '🧥'],
  ['Grouse Grind', '2,830 stairs pretending to be a trail.', 'Bragging rights included', '#33691e', '#ffffff', '#dce775', '🥾'],
  ['Oat Milk Council', 'Cows are tired. Ask for oat.', '+$0.85', '#f5f0e1', '#4e342e', '#8d6e63', '🥛'],
];
const POSTERS = [['LOST CAT', 'Answers to "Mr. Biscuits". Does not answer.', '#ffffff'], ['ROOMMATE WANTED', 'Closet available. $1,400. Utilities extra.', '#fff59d'], ['LIVE TONIGHT', 'THE SOGGY BOTTOMS + Wet Socks', '#f48fb1'], ['YOGA IN THE RAIN', 'Every Sunday, Kits Beach. Bring a towel.', '#b3e5fc'],
  ['HAVE YOU SEEN THIS GOOSE?', 'He stole my sandwich. Reward: $5', '#ffffff'], ['GUITAR LESSONS', 'I know Wonderwall. Tear a tab →', '#c5e1a5'], ['FREE COUCH', 'In the lane. It\'s still there. Please.', '#ffe0b2'], ['SAVE THE BLACKBERRIES', 'Community picking day Sat 10am', '#d1c4e9'],
  ['MISSING: MY UMBRELLA', 'Last seen flying over Robson St', '#ffffff'], ['BOOK CLUB', 'We read 2 pages and drink wine', '#ffccbc'], ['DOG WALKER', 'Reliable. Loves dogs. Fears geese.', '#dcedc8'], ['GARAGE SALE', 'Everything must go. Even Gary.', '#fff59d'],
  ['IMPROV NIGHT', 'Yes, and… it\'s raining', '#b2ebf2'], ['ROOM FOR RENT', 'Top bunk. Ocean view (if you lean)', '#ffffff'], ['DRUM CIRCLE', 'Trout Lake, sunset, all welcome', '#ffecb3'], ['LOST: SENSE OF DIRECTION', 'Last seen in a Richmond mall', '#e1bee7']];

// ---------- the atlases ----------
function wrap(c, text, x, y, maxW, lh) { const words = text.split(' '); let line = ''; for (const w of words) { const t = line ? line + ' ' + w : w; if (c.measureText(t).width > maxW && line) { c.fillText(line, x, y); y += lh; line = w; } else line = t; } if (line) c.fillText(line, x, y); return y; }
function fit(c, text, maxW, size, weight = '900', font = '"Arial Black", Arial, sans-serif') { let s = size; c.font = `${weight} ${s}px ${font}`; while (c.measureText(text).width > maxW && s > 14) { s -= 2; c.font = `${weight} ${s}px ${font}`; } return s; }
// landscape: 4 x 8 cells of 512 x 256 (billboards, screens)
const landTex = canvasTex(2048, 2048, (c) => {
  ADS.forEach((a, i) => {
    const x = (i % 4) * 512, y = Math.floor(i / 4) * 256; c.save(); c.translate(x, y); c.beginPath(); c.rect(0, 0, 512, 256); c.clip();
    c.fillStyle = a[3]; c.fillRect(0, 0, 512, 256); c.fillStyle = a[5]; c.globalAlpha = 0.25; c.beginPath(); c.arc(430, 40, 150, 0, 6.29); c.fill(); c.globalAlpha = 1;
    c.fillRect(0, 238, 512, 18); c.font = '96px "Segoe UI Emoji", "Apple Color Emoji", sans-serif'; c.textBaseline = 'middle'; c.fillText(a[6], 18, 128);
    c.fillStyle = a[4]; c.textBaseline = 'alphabetic'; fit(c, a[0], 360, 46); c.fillText(a[0], 138, 70);
    c.font = '600 28px Arial, sans-serif'; const yy = wrap(c, a[1], 138, 120, 360, 32); c.font = 'italic 20px Arial, sans-serif'; c.globalAlpha = 0.85; wrap(c, a[2], 138, yy + 34, 360, 22); c.restore();
  });
}, false);
// portrait: 8 x 4 cells of 256 x 512 (bus-stop and sidewalk panels)
const portTex = canvasTex(2048, 2048, (c) => {
  ADS.forEach((a, i) => {
    const x = (i % 8) * 256, y = Math.floor(i / 8) * 512; c.save(); c.translate(x, y); c.beginPath(); c.rect(0, 0, 256, 512); c.clip();
    const g = c.createLinearGradient(0, 0, 0, 512); g.addColorStop(0, a[3]); g.addColorStop(1, '#00000066'); c.fillStyle = a[3]; c.fillRect(0, 0, 256, 512); c.fillStyle = g; c.fillRect(0, 0, 256, 512);
    c.font = '120px "Segoe UI Emoji", "Apple Color Emoji", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(a[6], 128, 130);
    c.fillStyle = a[4]; c.textBaseline = 'alphabetic'; fit(c, a[0], 230, 34); c.fillText(a[0], 128, 270); c.font = '600 22px Arial, sans-serif'; const yy = wrap(c, a[1], 128, 315, 220, 27);
    c.font = 'italic 17px Arial, sans-serif'; wrap(c, a[2], 128, yy + 30, 220, 20); c.fillStyle = a[5]; c.fillRect(20, 488, 216, 6); c.restore();
  });
}, false);
// posters: 8 x 2 cells of 128 x 256
const postTex = canvasTex(1024, 512, (c) => {
  POSTERS.forEach((p, i) => {
    const x = (i % 8) * 128, y = Math.floor(i / 8) * 256; c.save(); c.translate(x, y); c.fillStyle = p[2]; c.fillRect(4, 4, 120, 248);
    c.fillStyle = '#111'; c.textAlign = 'center'; fit(c, p[0], 112, 20, 'bold', 'Impact, Arial, sans-serif'); wrap(c, p[0], 64, 34, 112, 20);
    c.fillStyle = '#9e9e9e'; c.fillRect(24, 80, 80, 70); c.font = '44px "Segoe UI Emoji", sans-serif'; c.fillText(['🐈', '🛏️', '🎸', '🧘', '🪿', '🎸', '🛋️', '🫐', '☂️', '📚', '🐕', '🏷️', '🎭', '🛏️', '🥁', '🧭'][i], 64, 132);
    c.fillStyle = '#222'; c.font = '13px Arial'; wrap(c, p[1], 64, 172, 110, 15);
    for (let k = 0; k < 7; k++) { c.fillStyle = '#ddd'; c.fillRect(8 + k * 16, 222, 12, 30); c.save(); c.translate(14 + k * 16, 250); c.rotate(-Math.PI / 2); c.fillStyle = '#333'; c.font = '8px Arial'; c.fillText('604-555', 0, 0); c.restore(); }
    c.restore();
  });
}, false);
const mkMat = (map, emi) => new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: '#ffffff', emissiveIntensity: emi, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
const boardMat = mkMat(landTex, 0.05), screenMat = mkMat(landTex, 0.9), panelMat = mkMat(portTex, 0.35), posterMat = new THREE.MeshStandardMaterial({ map: postTex, roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
screenMat.roughness = 0.25;

// ---------- merged quad builder ----------
class Quads {
  constructor(mat) { this.mat = mat; this.mesh = null; this.reset(); }
  reset() { this.pos = []; this.uv = []; this.idx = []; this.slots = []; }
  // centre, outward normal (nx, nz), size, atlas cell [u0, v0, u1, v1]
  add(x, y, z, nx, nz, w, h, cell) {
    const rx = nz, rz = -nx, i0 = this.pos.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { this.pos.push(x + rx * a * w / 2 + nx * 0.02, y + b * h / 2, z + rz * a * w / 2 + nz * 0.02); }
    this.setUV(i0, cell); this.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3); return i0;
  }
  setUV(i0, [u0, v0, u1, v1], arr = this.uv) { const k = i0 * 2; arr[k] = u0; arr[k + 1] = v0; arr[k + 2] = u1; arr[k + 3] = v0; arr[k + 4] = u1; arr[k + 5] = v1; arr[k + 6] = u0; arr[k + 7] = v1; }
  build() {
    if (this.mesh) { scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    if (!this.idx.length) return;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2)); g.setIndex(this.idx); g.computeVertexNormals();
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.receiveShadow = true; scene.add(this.mesh);
  }
}
const land = i => { i = i % ADS.length; const c = i % 4, r = Math.floor(i / 4); return [c / 4, 1 - (r + 1) / 8, (c + 1) / 4, 1 - r / 8]; };
const port = i => { i = i % ADS.length; const c = i % 8, r = Math.floor(i / 8); return [c / 8, 1 - (r + 1) / 4, (c + 1) / 8, 1 - r / 4]; };
const post = i => { i = i % POSTERS.length; const c = i % 8, r = Math.floor(i / 8); return [c / 8, 1 - (r + 1) / 2, (c + 1) / 8, 1 - r / 2]; };
const boards = new Quads(boardMat), screens = new Quads(screenMat), panels = new Quads(panelMat), posters = new Quads(posterMat);

// ---------- structures (instanced boxes: posts, frames, catwalks, lamps) ----------
let frameIM = null, nf = 0; const o = new THREE.Object3D(), col = new THREE.Color();
function initFrames() { frameIM = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), std('#ffffff', { metalness: 0.5, roughness: 0.5 }), 3000); frameIM.count = 0; frameIM.castShadow = true; frameIM.receiveShadow = true; frameIM.frustumCulled = false; frameIM.setColorAt(0, col.set('#fff')); scene.add(frameIM); }
function fbox(x, y, z, w, h, d, yaw, c) { if (nf >= 3000) return; o.position.set(x, y, z); o.rotation.set(0, yaw, 0); o.scale.set(w, h, d); o.updateMatrix(); frameIM.setMatrixAt(nf, o.matrix); frameIM.setColorAt(nf, col.set(c)); nf++; }

// a billboard: face centre (x, fy, z) facing (nx, nz), w x h, on legs down to gy
function billboard(x, gy, z, nx, nz, w, h, fy, ad, legs = true) {
  const yaw = Math.atan2(nx, nz), bx = x - nx * 0.18, bz = z - nz * 0.18;
  fbox(bx, fy, bz, w + 0.4, h + 0.4, 0.3, yaw, '#3a3f45');                     // the frame / back
  boards.add(x, fy, z, nx, nz, w, h, land(ad));
  fbox(x + nx * 0.6, fy - h / 2 - 0.3, z + nz * 0.6, w, 0.08, 1.0, yaw, '#5a6068');   // catwalk
  for (const s of [-0.33, 0, 0.33]) fbox(x + nx * 0.9 + nz * w * s, fy - h / 2 - 0.1, z + nz * 0.9 - nx * w * s, 0.25, 0.2, 0.35, yaw, G.night > 0.3 ? '#fff4c2' : '#8a9096');   // floodlights
  if (legs) { const top = fy - h / 2; for (const s of (w > 9 ? [-0.3, 0.3] : [0])) fbox(bx - nx * 0.3 + nz * w * s, (gy + top) / 2, bz - nz * 0.3 - nx * w * s, 0.45, top - gy, 0.45, yaw, '#4a5058'); }
}
// a two-sided backlit panel on a stand
function panel(x, z, yaw, adA, adB, kind = 0) {
  const gy = walkY(x, z), nx = Math.sin(yaw), nz = Math.cos(yaw);
  fbox(x, gy + 1.25, z, 1.35, 2.3, 0.22, yaw, kind ? '#2d3748' : '#4a5568');
  panels.add(x + nx * 0.11, gy + 1.3, z + nz * 0.11, nx, nz, 1.15, 1.85, port(adA)); panels.add(x - nx * 0.11, gy + 1.3, z - nz * 0.11, -nx, -nz, 1.15, 1.85, port(adB));
  return { x, z, r: 0.5, top: gy + 2.4 };
}
let cx = 1e9, cz = 1e9, built = false; const screenList = [];
const DT = (() => { const [x0, z0] = toXZ(49.292, -123.145), [x1, z1] = toXZ(49.270, -123.097); return { x0, z0, x1, z1 }; })();
const downtown = (x, z) => x > DT.x0 && x < DT.x1 && z > DT.z0 && z < DT.z1;
function rebuild(px, pz) {
  for (const q of [boards, screens, panels, posters]) q.reset(); nf = 0; screenList.length = 0; const coll = [];
  const H = (a, b) => hash2(Math.round(a), Math.round(b));
  // 1. billboards on posts beside highways and main roads
  const seen = new Set();
  for (const e of roadGrid.near(px, pz, 700, [])) {
    const r = M.roads[e.r]; if (r.t > 2 || r.b) continue;
    const ax = NX(e.a), az = NZ(e.a), L = e.len || 1, ux = (NX(e.b) - ax) / L, uz = (NZ(e.b) - az) / L;
    for (let s = 20; s < L - 10; s += 60) {
      const x0 = ax + ux * s, z0 = az + uz * s, cell = Math.floor(x0 / 260) * 9973 + Math.floor(z0 / 260); if (seen.has(cell)) continue;
      if (H(x0, z0) > (r.t <= 1 ? 0.35 : 0.12) || Math.hypot(x0 - px, z0 - pz) > 700) continue;
      const side = H(z0, x0) < 0.5 ? 1 : -1, off = r.w / 2 + 9, x = x0 - uz * off * side, z = z0 + ux * off * side;
      // face the traffic coming toward it, turned a little toward the road
      const ang = Math.atan2(-ux, -uz) + side * 0.45, nx = Math.sin(ang), nz = Math.cos(ang);
      const w = r.t <= 1 ? 12 : 9, h = w / 2;
      let ok = !isWater(x, z) && !nearestRoad(x, z, 5);
      for (const k of [-0.5, 0, 0.5]) if (ok && buildingAt(x + nz * w * k, z - nx * w * k)) ok = false;
      if (!ok) continue; seen.add(cell);
      const gy = Math.min(groundY(x + nz * w * 0.3, z - nx * w * 0.3), groundY(x - nz * w * 0.3, z - -nx * w * 0.3), groundY(x, z));
      billboard(x, gy, z, nx, nz, w, h, gy + 6 + h / 2, Math.floor(H(x * 3, z) * ADS.length));
      coll.push({ x: x - nx * 0.5, z: z - nz * 0.5, r: 0.5, top: gy + 6 });
    }
  }
  // 2. rooftop billboards + 3. LED screens on downtown towers
  for (const b of bldGrid.near(px, pz, 500, [])) {
    if (b.house || b.raised) continue; const hgt = b.top - b.base, hb = hash2(b.x * 1.1, b.z * 0.9), d = Math.hypot(b.x - px, b.z - pz); if (d > 500) continue;
    if (hb < 0.045 && hgt > 8 && hgt < 36 && b.area > 220 && b.area < 5000 && buildingAt(b.x, b.z) === b) {
      const nr = nearestRoad(b.x, b.z, 60, q => q.t <= 4); if (nr) {
        const ex = NX(nr.e.a) + (NX(nr.e.b) - NX(nr.e.a)) * nr.t, ez = NZ(nr.e.a) + (NZ(nr.e.b) - NZ(nr.e.a)) * nr.t, L = Math.hypot(ex - b.x, ez - b.z) || 1, nx = (ex - b.x) / L, nz = (ez - b.z) / L;
        const w = Math.min(10, Math.sqrt(b.area) * 0.7), h = w * 0.4;
        if (w > 5 && buildingAt(b.x + nz * w / 2, b.z - nx * w / 2) === b && buildingAt(b.x - nz * w / 2, b.z + nx * w / 2) === b) billboard(b.x, b.top, b.z, nx, nz, w, h, b.top + 1.6 + h / 2, Math.floor(hb * 9999) % ADS.length);
      }
    }
    if (downtown(b.x, b.z) && hgt > 14 && hb > 0.86 && d < 450) {
      const p = b.p, n = p.length / 2; let best = null;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, ax = p[i * 2], az = p[i * 2 + 1], dx = p[j * 2] - ax, dz = p[j * 2 + 1] - az, L = Math.hypot(dx, dz); if (L < 9) continue;
        const mx = ax + dx / 2, mz = az + dz / 2; let nx = -dz / L, nz = dx / L; if ((mx - b.x) * nx + (mz - b.z) * nz < 0) { nx = -nx; nz = -nz; }
        if (buildingAt(mx + nx * 6, mz + nz * 6) || !nearestRoad(mx + nx * 8, mz + nz * 8, 14, q => q.t <= 4)) continue;
        if (!best || L > best.L) best = { mx, mz, nx, nz, L };
      }
      if (best) {
        const w = Math.min(best.L - 2, 10), h = w * 0.5, y = b.base + Math.min(hgt - h / 2 - 1, 7 + h / 2), yaw = Math.atan2(best.nx, best.nz);
        fbox(best.mx + best.nx * 0.25, y, best.mz + best.nz * 0.25, w + 0.5, h + 0.5, 0.25, yaw, '#15171a');
        const k = Math.floor(hb * 997), i0 = screens.add(best.mx + best.nx * 0.4, y, best.mz + best.nz * 0.4, best.nx, best.nz, w, h, land(k));
        screenList.push({ i0, k, t: hash2(k, 3) * 8 });
      }
    }
  }
  // 4. backlit ad panels by bus stops, and on busy downtown sidewalks
  for (const s of transitStops()) {
    if (s.kind !== 'bus' || Math.abs(s.x - px) > 320 || Math.abs(s.z - pz) > 320) continue;
    const nr = nearestRoad(s.x, s.z, 20, q => q.t <= 6); if (!nr) continue;
    const ux = NX(nr.e.b) - NX(nr.e.a), uz = NZ(nr.e.b) - NZ(nr.e.a), L = Math.hypot(ux, uz) || 1, yaw = Math.atan2(ux / L, uz / L);
    for (const sg of [1, -1]) { const x = s.x + ux / L * 2.9 * sg, z = s.z + uz / L * 2.9 * sg; if (!buildingAt(x, z) && !isWater(x, z)) { coll.push(panel(x, z, yaw + Math.PI / 2, Math.floor(H(x, z) * 99), Math.floor(H(z, x) * 99), 1)); break; } }
  }
  for (const e of roadGrid.near(px, pz, 300, [])) {
    const r = M.roads[e.r]; if (r.t > 3 || r.t < 2 || r.b) continue;
    const ax = NX(e.a), az = NZ(e.a), L = e.len || 1, ux = (NX(e.b) - ax) / L, uz = (NZ(e.b) - az) / L;
    for (let s = 15; s < L - 15; s += 45) {
      const x0 = ax + ux * s, z0 = az + uz * s, h = H(x0 * 1.7, z0); if (h > (downtown(x0, z0) ? 0.2 : 0.05)) continue;
      const side = h < 0.025 ? 1 : -1, off = r.w / 2 + 1.1, x = x0 - uz * off * side, z = z0 + ux * off * side;
      if (buildingAt(x, z) || isWater(x, z) || Math.hypot(x - px, z - pz) > 300) continue;
      coll.push(panel(x, z, Math.atan2(ux, uz), Math.floor(h * 997), Math.floor(h * 7919)));
    }
  }
  // 5. posters stapled to lamp posts
  const lp = _colliderGrids.get('lampposts');
  if (lp) for (const a of lp.values()) for (const c of a) {
    if (c.gone || Math.abs(c.x - px) > 200 || Math.abs(c.z - pz) > 200) continue; const h = H(c.x * 5, c.z * 3); if (h > 0.35) continue;
    const gy = walkY(c.x, c.z), n = 1 + Math.floor(h * 6);
    for (let k = 0; k < n; k++) { const a = h * 40 + k * 1.9, nx = Math.sin(a), nz = Math.cos(a); posters.add(c.x + nx * 0.17, gy + 1.45 + (k % 2) * 0.55, c.z + nz * 0.17, nx, nz, 0.3, 0.6, post(Math.floor(h * 997) + k)); }
  }
  for (const q of [boards, screens, panels, posters]) q.build();
  frameIM.count = nf; frameIM.instanceMatrix.needsUpdate = true; if (frameIM.instanceColor) frameIM.instanceColor.needsUpdate = true;
  setColliders('adverts', coll);
}

// ---------- per frame ----------
let flipT = 0;
export function initAdverts() { initFrames(); }
export function updateAdverts(dt, pl) {
  if (!pl.char) return;
  if (Math.hypot(pl.x - cx, pl.z - cz) > 150 || !built) { cx = pl.x; cz = pl.z; built = true; rebuild(pl.x, pl.z); }
  // screens flip to the next ad; everything glows more at night
  flipT -= dt;
  if (flipT < 0 && screens.mesh && screenList.length) {
    flipT = 0.5; const uv = screens.mesh.geometry.attributes.uv; let ch = false;
    for (const s of screenList) { s.t += 0.5; if (s.t > 8) { s.t = 0; s.k++; screens.setUV(s.i0, land(s.k), uv.array); ch = true; } }
    if (ch) uv.needsUpdate = true;
  }
  boardMat.emissiveIntensity = 0.04 + G.night * 0.55; screenMat.emissiveIntensity = 0.75 - G.night * 0.3; panelMat.emissiveIntensity = 0.25 + G.night * 0.35;
}
export const _adverts = { boards, screens, panels, posters, screenList, get frames() { return nf; }, rebuild: () => { built = false; } };
