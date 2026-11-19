// Richmond surprises: kites over Garry Point Park (Steveston) on dry days, and the Richmond Night Market on
// spring/summer nights (stalls, glowing lanterns, food smells you can almost see, a crowd).
import * as THREE from 'three';
import { G, scene, std, addMesh, toXZ, canvasTex, R, pick } from './core.js';
import { heightAt, isWater } from './terrain.js';
import { surfaceY, buildingAt } from './city.js';
import { makeHuman } from './people.js';
import { discover } from './missions.js';
import { ui } from './ui.js';

// ---------- kites ----------
const kites = [];
function kiteModel(kind, c1, c2) {
  const g = new THREE.Group();
  const tex = canvasTex(128, 128, (c, w, h) => { c.fillStyle = c1; c.fillRect(0, 0, w, h); c.fillStyle = c2; if (kind === 0) { c.beginPath(); c.moveTo(w / 2, 0); c.lineTo(w, h / 2); c.lineTo(w / 2, h); c.closePath(); c.fill(); } else { for (let i = 0; i < 4; i++) c.fillRect(0, i * h / 4, w, h / 8); } c.strokeStyle = '#222'; c.lineWidth = 4; c.strokeRect(2, 2, w - 4, h - 4); }, false);
  const mat = new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.6 });
  if (kind === 0) {   // diamond kite
    const s = new THREE.Shape(); s.moveTo(0, 1.2); s.lineTo(0.8, 0.2); s.lineTo(0, -1.2); s.lineTo(-0.8, 0.2); s.closePath();
    const geo = new THREE.ShapeGeometry(s); const uv = geo.attributes.uv, p = geo.attributes.position; for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + 0.8) / 1.6, (p.getY(i) + 1.2) / 2.4);
    g.add(new THREE.Mesh(geo, mat));
  } else if (kind === 1) {   // box kite
    for (const y of [-0.6, 0.6]) addMesh(new THREE.BoxGeometry(0.9, 0.5, 0.9), mat, 0, y, 0, g, false);
    for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) addMesh(new THREE.BoxGeometry(0.04, 2, 0.04), std('#5a4030'), x, 0, z, g, false);
  } else {   // a long dragon kite: a chain of discs
    for (let i = 0; i < 9; i++) { const d = addMesh(new THREE.CircleGeometry(0.55 - i * 0.03, 12), new THREE.MeshStandardMaterial({ color: i ? (i % 2 ? c1 : c2) : '#d62828', side: THREE.DoubleSide }), 0, 0, i * 0.9, g, false); d.userData.seg = i; }
  }
  // the tail
  const tail = []; for (let i = 0; i < 12; i++) tail.push(0, -1.2 - i * 0.5, 0);
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(tail, 3));
  if (kind !== 2) g.add(new THREE.Line(tg, new THREE.LineBasicMaterial({ color: c2 })));
  scene.add(g); return g;
}
const stringGeo = new THREE.BufferGeometry(); stringGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6 * 8), 3));
const strings = new THREE.LineSegments(stringGeo, new THREE.LineBasicMaterial({ color: 0xeeeeee, transparent: true, opacity: 0.7 })); strings.frustumCulled = false; scene.add(strings);
function makeKites() {
  const [cx, cz] = toXZ(49.1268, -123.1945);
  const cols = [['#f6c343', '#d62828'], ['#1e88e5', '#ffffff'], ['#8e24aa', '#fdd835'], ['#43a047', '#ff7043'], ['#ff4081', '#3949ab'], ['#ffffff', '#e53935'], ['#00acc1', '#fdd835'], ['#f4511e', '#212121']];
  for (let i = 0; i < 8; i++) {
    let ax = cx + R(-80, 80), az = cz + R(-60, 60); for (let k = 0; k < 10 && (isWater(ax, az) || buildingAt(ax, az)); k++) { ax = cx + R(-80, 80); az = cz + R(-60, 60); }
    kites.push({ g: kiteModel(i % 3, ...cols[i]), ax, az, len: R(35, 70), ph: Math.random() * 6, h: makeHuman({ skin: pick(['#f1c9a5', '#e0ac7e', '#c68c5e', '#8d5a3b']), hair: pick(['#1b1b1b', '#3b2416']), shirt: pick(['#e53e3e', '#3182ce', '#38a169', '#d69e2e']), pants: pick(['#1a202c', '#2c5282']) }) });
    scene.add(kites[i].h.grp);
  }
}
let kiteSeen = false;
function updateKites(dt, pl) {
  const fly = (G.wet || 0) < 0.3 && (G.night || 0) < 0.5, near = Math.hypot(kites[0].ax - pl.x, kites[0].az - pl.z) < 1500;
  const pos = stringGeo.attributes.position;
  kites.forEach((k, i) => {
    k.g.visible = k.h.grp.visible = fly && near; if (!k.g.visible) return;
    const gy = surfaceY(k.ax, k.az), wind = 0.4 + Math.sin(G.t * 0.1) * 0.15;   // the wind blows from the sea (west)
    const kx = k.ax + k.len * 0.55 + Math.sin(G.t * 0.7 + k.ph) * 4, ky = gy + k.len * 0.8 + Math.sin(G.t * 1.3 + k.ph) * 3, kz = k.az + Math.cos(G.t * 0.5 + k.ph) * 6;
    k.g.position.set(kx, ky, kz); k.g.rotation.set(Math.sin(G.t * 2 + k.ph) * 0.25, Math.PI / 2 + Math.sin(G.t * 0.9 + k.ph) * 0.3, Math.sin(G.t * 1.7 + k.ph) * 0.35);
    k.g.children.forEach(c => { if (c.userData.seg) c.position.y = Math.sin(G.t * 3 - c.userData.seg * 0.7) * 0.4; });
    k.h.grp.position.set(k.ax, gy, k.az); k.h.grp.rotation.y = -Math.PI / 2; k.h.st.kind = 'walk'; k.h.st.amp = 0; k.h.pose(dt);
    pos.setXYZ(i * 2, k.ax + 0.3, gy + 1.4, k.az); pos.setXYZ(i * 2 + 1, kx, ky, kz);
  });
  pos.needsUpdate = true; strings.visible = fly && near;
  if (fly && near && !kiteSeen && Math.hypot(kites[0].ax - pl.x, kites[0].az - pl.z) < 250) { kiteSeen = true; ui.toast('🪁 Kites over Garry Point!', 'The wind off the Strait makes Steveston\'s Garry Point Park the kite-flying spot in Metro Vancouver.', 4000); discover('kites'); }
}

// ---------- Richmond Night Market ----------
const market = { g: new THREE.Group(), people: [], lanterns: null };
const STALLS = ['🍢 Skewer Kingdom', '🥔 Tornado Taters', '🧋 Bubble Tea Lab', '🦑 Squid on a Stick', '🥟 Dumpling Dynasty', '🍡 Mochi Mochi', '🍜 Noodle Ninja', '🦞 Lobster Tails', '🍗 Fried Chicken Bros', '🍓 Strawberry Sando', '🌶️ Stinky Tofu (you\'ve been warned)', '🍦 Dragon\'s Breath Ice Cream', '🧸 Plushie Prize Game', '📱 Phone Cases 3 for $10', '🍥 Takoyaki Town', '🥭 Mango Everything'];
function makeMarket() {
  const [cx, cz] = toXZ(49.19460, -123.13800); let ox = cx, oz = cz;
  for (let k = 0; k < 30 && buildingAt(ox, oz); k++) { ox = cx + R(-120, 120); oz = cz + R(-120, 120); }
  market.x = ox; market.z = oz; const y = surfaceY(ox, oz); market.g.position.set(ox, y, oz); scene.add(market.g);
  const canopy = ['#d62828', '#f6c343', '#1e88e5', '#ffffff', '#43a047', '#ff7043'];
  STALLS.forEach((name, i) => {
    const row = i < 8 ? -1 : 1, x = (i % 8 - 3.5) * 6, z = row * 7, g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = row > 0 ? Math.PI : 0; market.g.add(g);
    addMesh(new THREE.BoxGeometry(5, 1, 2), std('#f2f2ee'), 0, 0.5, 0, g);
    for (const s of [-1, 1]) for (const t of [-1, 1]) addMesh(new THREE.CylinderGeometry(0.05, 0.05, 2.8), std('#888'), s * 2.4, 1.4, t * 0.9, g);
    addMesh(new THREE.BoxGeometry(5.3, 0.2, 2.6), std(canopy[i % canopy.length]), 0, 2.85, 0, g);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.7), new THREE.MeshBasicMaterial({ map: canvasTex(512, 80, (c, w, h) => { c.fillStyle = '#1a1a1a'; c.fillRect(0, 0, w, h); c.fillStyle = '#ffd54f'; c.font = 'bold 40px sans-serif'; c.textAlign = 'center'; c.fillText(name, w / 2, 54); }, false) }));
    sign.position.set(0, 2.45, -1.31); sign.rotation.y = Math.PI; g.add(sign);
    for (let k = 0; k < 3; k++) addMesh(new THREE.BoxGeometry(0.5, 0.25, 0.4), std(pick(['#ff7043', '#fdd835', '#8d6e63', '#ec407a'])), -1.5 + k * 1.5, 1.12, -0.3, g, false);   // food on display
  });
  // strings of glowing lanterns over the aisle
  const lanternPos = []; for (let i = 0; i < 40; i++) lanternPos.push([(i % 20 - 9.5) * 2.4, 4 + Math.sin(i) * 0.2, i < 20 ? -2.2 : 2.2]);
  const lm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshStandardMaterial({ color: '#ff3b30', emissive: '#ff5a36', emissiveIntensity: 1.6 }), lanternPos.length), o = new THREE.Object3D();
  lanternPos.forEach((p, i) => { o.position.set(...p); o.updateMatrix(); lm.setMatrixAt(i, o.matrix); }); market.g.add(lm); market.lanterns = lm;
  market.glow = new THREE.PointLight('#ffb070', 60, 45, 2); market.glow.position.set(0, 6, 0); market.g.add(market.glow);
  for (let i = 0; i < 16; i++) { const h = makeHuman({ skin: pick(['#f1c9a5', '#e0ac7e', '#c68c5e', '#8d5a3b', '#f5d6bd']), hair: pick(['#1b1b1b', '#3b2416', '#d9b36c']), shirt: pick(['#e53e3e', '#3182ce', '#38a169', '#d69e2e', '#805ad5', '#ed64a6', '#fff']), pants: pick(['#1a202c', '#2c5282', '#4a5568']) }); market.g.add(h.grp); market.people.push({ h, x: R(-22, 22), z: R(-3, 3), tx: R(-22, 22), stop: R(0, 4), ph: Math.random() * 6 }); }
}
let marketSeen = false;
function updateMarket(dt, pl) {
  const open = (G.season === 'summer' || G.season === 'spring') && (G.hour >= 19 || G.hour < 0.5), d = Math.hypot(market.x - pl.x, market.z - pl.z);
  market.g.visible = open && d < 1500; if (!market.g.visible) return;
  for (const p of market.people) {
    if (p.stop > 0) { p.stop -= dt; p.h.st.kind = 'walk'; p.h.st.amp = 0; }
    else { const dx = p.tx - p.x; if (Math.abs(dx) < 0.3) { p.stop = R(2, 7); p.tx = R(-22, 22); } else { p.x += Math.sign(dx) * 1.1 * dt; p.ph += dt * 4.5; p.h.st.kind = 'walk'; p.h.st.amp = 0.6; p.h.st.phase = p.ph; } p.h.grp.rotation.y = dx > 0 ? -Math.PI / 2 : Math.PI / 2; }
    p.h.grp.position.set(p.x, 0, p.z); p.h.pose(dt);
  }
  if (d < 80 && !marketSeen) { marketSeen = true; ui.toast('🏮 Richmond Night Market!', 'The biggest night market in North America: 100+ food stalls, lanterns and a line for everything.', 4500); discover('nightmarket'); }
}

export function initRichmond() { makeKites(); makeMarket(); }
export function updateRichmond(dt, pl) { updateKites(dt, pl); updateMarket(dt, pl); }
