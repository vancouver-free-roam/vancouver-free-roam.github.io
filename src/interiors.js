// Home interiors: walk inside the property you own. Each home is its own little "dollhouse" scene
// (no ceiling, camera looks in from the front) with furniture you can use: sleep, TV, fridge, wardrobe,
// trophies, car keys, and a speaker that throws a house party.
import * as THREE from 'three';
import { G, scene, camera, renderer, std, addMesh, canvasTex, tapped, key, pick, clamp } from './core.js';
import { makeHuman } from './people.js';
import { player } from './player.js';
import { ui } from './ui.js';
import { sfx } from './sound.js';
import { OWN, OUTFITS, RIDES, PROPS, wear, callRide, skipNight, rentPerDay } from './shops.js';
import { state, discover, MISSIONS, SIDE, SECRETS } from './missions.js';

// ---------- the homes (sizes in metres; x = right, z = toward the camera) ----------
const HOMES = {
  closet: { W: 3.4, D: 4.2, floor: '#a47c52', wall: '#ece6da', lights: 1, hello: 'Welcome home! It\'s 140 square feet. The bed is also the couch, the office and the dining room.',
    items: [['bed', -0.75, -0.95, 0], ['fridge', 1.2, -1.65, 0], ['tv', 1.35, 0.3, -Math.PI / 2], ['wardrobe', -1.38, 1.15, Math.PI / 2], ['stereo', 1.3, 1.45, 0], ['shelf', 0.42, -1.92, 0, 0.7], ['door', 0, 2.1, 0]] },
  loft: { W: 10, D: 8, floor: '#6b4a32', wall: '#b5654a', lights: 3, hello: 'Exposed brick, exposed pipes, exposed to the noise of the cocktail bar downstairs. Very Gastown.',
    items: [['bed', -3.6, -2.7, 0], ['wardrobe', -4.6, 0.3, Math.PI / 2], ['rug', 1.5, -0.6, 0], ['tv', 1.5, -3.5, 0], ['sofa', 1.5, 0.6, 0], ['kitchen', 3.6, -3.55, 0], ['fridge', 4.5, -1.9, 0], ['shelf', -1.0, -3.8, 0], ['stereo', -0.6, 2.6, 0], ['table', -2.2, 1.6, 0], ['plant', -4.5, 3.3, 0], ['keys', 4.4, 3.3, 0], ['door', 0, 4, 0]] },
  shack: { W: 7, D: 6, floor: '#d9c29a', wall: '#7fb3c8', lights: 2, hello: 'Sand everywhere. A surfboard you have never used. The sound of volleyball. Living the Kits dream.',
    items: [['bed', -2.4, -1.85, 0], ['surfboard', -3.15, 1.0, 0], ['fridge', 3.0, -2.55, 0], ['tv', 1.0, -2.75, 0], ['sofa', 1.0, 0.1, 0], ['rug', 1.0, -1.3, 0], ['wardrobe', 3.15, 0.7, -Math.PI / 2], ['stereo', -0.9, -2.75, 0], ['shelf', -2.4, 2.6, 0], ['keys', 2.9, 2.55, 0], ['plant', -3.1, -0.3, 0], ['door', 0.6, 3, 0]] },
  cabin: { W: 9, D: 7, floor: '#8a5a34', wall: '#a8754a', lights: 2, hello: 'Cedar walls, a crackling fire and a view of Indian Arm. Somewhere, a kayaker is eating a honey doughnut.',
    items: [['bed', -3.4, -2.3, 0], ['fireplace', 1.0, -3.15, 0], ['rug', 1.0, -1.6, 0], ['sofa', 1.0, -0.3, 0], ['tv', 4.1, -0.6, -Math.PI / 2], ['fridge', 3.9, -2.95, 0], ['wardrobe', -4.15, 0.7, Math.PI / 2], ['shelf', -1.4, -3.3, 0], ['stereo', -1.8, 2.6, 0], ['table', -2.0, 0.9, 0], ['keys', 3.9, 2.8, 0], ['plant', 4.0, 1.6, 0], ['door', 0.6, 3.5, 0]] },
  chalet: { W: 12, D: 10, floor: '#7a5233', wall: '#c9a27a', lights: 3, hello: 'A real Whistler chalet: antlers on the wall, a hot tub, and ski boots that will never fully dry.',
    items: [['bed', -4.8, -3.7, 0], ['wardrobe', -5.65, -0.5, Math.PI / 2], ['fireplace', 0, -4.65, 0], ['rug', 0, -2.9, 0], ['sofa', 0, -1.8, 0], ['hottub', 4.2, -3.3, 0], ['tv', 4.6, 0.8, -Math.PI / 2], ['plant', 5.4, -0.9, 0], ['shelf', -2.4, -4.75, 0], ['stereo', 2.3, -4.6, 0], ['table', -3.0, 1.6, 0], ['kitchen', -3.2, 4.1, 0], ['fridge', -1.2, 4.1, 0], ['keys', 5.2, 4.2, 0], ['door', 1.0, 5, 0]] },
  mansion: { W: 20, D: 14, floor: '#e8e2d6', wall: '#f4efe6', lights: 4, hello: 'Twelve bathrooms. A grand piano nobody can play. A hot tub. Your neighbour is a hockey player\'s accountant.',
    items: [['bed', -8, -5.6, 0], ['wardrobe', -9.6, -2.5, Math.PI / 2], ['piano', -5, -1.0, 0], ['hottub', 7.2, -4.7, 0], ['fireplace', 0, -6.65, 0], ['rug', 0, -4.6, 0], ['sofa', 0, -3.4, 0], ['tv', 3.8, -6.6, 0], ['sofa', 3.8, -3.6, 0], ['shelf', -3.5, -6.75, 0], ['kitchen', -6, 5.9, 0], ['fridge', -3.9, 6.0, 0], ['table', -6, 3.2, 0], ['stereo', 6, 1.0, 0], ['keys', 9.0, 6.0, 0], ['plant', 9.3, -1.0, 0], ['plant', -9.3, 4.0, 0], ['door', 1.5, 7, 0]] },
};
// size [w (x), d (z), h] and what E does
const KINDS = {
  bed: [1.6, 2.1, 0.6, '🛏️ Sleep until morning'], sofa: [2.2, 0.9, 0.8, '🛋️ Chill on the couch'], tv: [1.6, 0.45, 1.25, '📺 Watch TV'], fridge: [0.8, 0.7, 1.9, '🧊 Raid the fridge'],
  wardrobe: [1.4, 0.6, 2.1, '👕 Change outfit'], shelf: [1.8, 0.35, 1.7, '🏆 Look at your trophies'], stereo: [0.6, 0.45, 1.0, '🔊 Throw a house party'], kitchen: [2.6, 0.7, 0.95, '🍳 Cook something'],
  table: [1.6, 1.0, 0.75, null], fireplace: [1.8, 0.6, 1.4, '🔥 Warm up by the fire'], hottub: [2.6, 2.6, 0.8, '♨️ Soak in the hot tub'], piano: [1.7, 1.5, 1.0, '🎹 Play the piano'],
  surfboard: [0.6, 0.15, 2.2, '🏄 Admire your surfboard'], plant: [0.55, 0.55, 1.2, null], rug: [2.6, 1.8, 0.02, null], keys: [0.6, 0.6, 0.9, '🔑 Grab your car keys'], door: [1.3, 0.3, 2.2, '🚪 Go outside'],
};

// ---------- scene ----------
const iScene = new THREE.Scene(), iCam = new THREE.PerspectiveCamera(55, 1, 0.1, 300);
const hemi = new THREE.HemisphereLight('#fff4e0', '#4a3a2c', 1.1); iScene.add(hemi);
let room = null, home = null, prop = null, inside = false, pendingRide = null, snapCam = false;
const bg = new THREE.Color(), camTo = new THREE.Vector3();
const I = { x: 0, z: 0, yaw: 0 };
const viewTex = canvasTex(512, 256, (c, w, h) => {
  const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#6fa8dc'); g.addColorStop(0.6, '#cfe5f2'); c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.fillStyle = '#5b6f84'; c.beginPath(); c.moveTo(0, h * 0.62); for (let x = 0; x <= w; x += 16) c.lineTo(x, h * (0.42 + 0.14 * Math.abs(Math.sin(x * 0.019) + 0.5 * Math.sin(x * 0.051)))); c.lineTo(w, h); c.lineTo(0, h); c.fill();
  c.fillStyle = '#eef3f7'; for (let x = 40; x < w; x += 140) { c.beginPath(); c.moveTo(x - 18, h * 0.5); c.lineTo(x, h * 0.43); c.lineTo(x + 18, h * 0.5); c.fill(); }
  c.fillStyle = '#2f5d7c'; c.fillRect(0, h * 0.7, w, h * 0.3);
  c.fillStyle = '#3a4a5a'; for (let x = 0; x < w; x += 22) { const bh = 20 + ((x * 37) % 50); c.fillRect(x, h * 0.72 - bh, 16, bh); }
}, false);
const winMat = new THREE.MeshStandardMaterial({ map: viewTex, emissiveMap: viewTex, emissive: '#ffffff', emissiveIntensity: 1 });
const plank = col => canvasTex(256, 256, (c, w, h) => { c.fillStyle = col; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 32) { c.fillStyle = 'rgba(0,0,0,.18)'; c.fillRect(0, y, w, 2); for (let x = (y / 32 % 2) * 64; x < w; x += 128) c.fillRect(x, y, 2, 32); c.fillStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.05})`; c.fillRect(0, y + 2, w, 30); } });

function furniture(kind, g, wo) {
  const [w0, d, h] = KINDS[kind], w = wo || w0, m = (c, o) => std(c, o);
  switch (kind) {
    case 'bed': addMesh(new THREE.BoxGeometry(w, 0.35, d), m('#5a4632'), 0, 0.18, 0, g); addMesh(new THREE.BoxGeometry(w - 0.08, 0.22, d - 0.1), m('#f2efe8'), 0, 0.46, 0.04, g); addMesh(new THREE.BoxGeometry(w - 0.1, 0.24, d * 0.62), m(pick(['#2b6cb0', '#c53030', '#2f855a', '#805ad5'])), 0, 0.5, 0.32, g); addMesh(new THREE.BoxGeometry(w * 0.4, 0.14, 0.35), m('#fff'), -w * 0.22, 0.62, -d / 2 + 0.3, g); addMesh(new THREE.BoxGeometry(w * 0.4, 0.14, 0.35), m('#fff'), w * 0.22, 0.62, -d / 2 + 0.3, g); addMesh(new THREE.BoxGeometry(w, 0.9, 0.1), m('#5a4632'), 0, 0.6, -d / 2, g); break;
    case 'sofa': { const c = pick(['#4a5568', '#9c4221', '#2c5282', '#718096']); addMesh(new THREE.BoxGeometry(w, 0.42, d), m(c), 0, 0.25, 0, g); addMesh(new THREE.BoxGeometry(w, 0.5, 0.25), m(c), 0, 0.65, d / 2 - 0.12, g); for (const s of [-1, 1]) addMesh(new THREE.BoxGeometry(0.22, 0.6, d), m(c), s * (w / 2 - 0.11), 0.4, 0, g); break; }
    case 'tv': addMesh(new THREE.BoxGeometry(w, 0.5, d), m('#3a2c20'), 0, 0.25, 0, g); addMesh(new THREE.BoxGeometry(w * 0.9, 0.7, 0.06), m('#111', { metalness: 0.6, roughness: 0.2 }), 0, 0.95, 0, g); g.userData.screen = addMesh(new THREE.PlaneGeometry(w * 0.85, 0.62), new THREE.MeshBasicMaterial({ color: '#0d1a2a' }), 0, 0.95, 0.035, g, false); break;
    case 'fridge': addMesh(new THREE.BoxGeometry(w, h, d), m('#e2e8f0', { metalness: 0.5, roughness: 0.3 }), 0, h / 2, 0, g); addMesh(new THREE.BoxGeometry(0.04, 0.5, 0.04), m('#888'), w / 2 - 0.12, 1.2, d / 2 + 0.03, g); break;
    case 'wardrobe': addMesh(new THREE.BoxGeometry(w, h, d), m('#6b4f3a'), 0, h / 2, 0, g); addMesh(new THREE.BoxGeometry(0.02, h - 0.2, 0.02), m('#2a1f17'), 0, h / 2, d / 2 + 0.01, g); break;
    case 'shelf': { addMesh(new THREE.BoxGeometry(w, h, d), m('#4a3626'), 0, h / 2, 0, g); const cups = Math.min(state.done.size, 24); const gold = m('#d4af37', { metalness: 0.9, roughness: 0.25 });
      for (let i = 0; i < cups; i++) { const row = Math.floor(i / 8), col = i % 8; addMesh(new THREE.CylinderGeometry(0.06, 0.035, 0.18, 8), gold, -w / 2 + 0.14 + col * (w - 0.28) / 7, 0.45 + row * 0.5, d / 2 + 0.05, g, false); }
      for (let r = 0; r < 3; r++) addMesh(new THREE.BoxGeometry(w, 0.04, 0.2), m('#2e2219'), 0, 0.35 + r * 0.5, d / 2 + 0.08, g, false); break; }
    case 'stereo': addMesh(new THREE.BoxGeometry(w, h, d), m('#1a1a1a'), 0, h / 2, 0, g); for (const y of [0.3, 0.72]) addMesh(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 16).rotateX(Math.PI / 2), m('#444'), 0, y, d / 2 + 0.01, g, false); break;
    case 'kitchen': addMesh(new THREE.BoxGeometry(w, h, d), m('#f7fafc'), 0, h / 2, 0, g); addMesh(new THREE.BoxGeometry(w + 0.04, 0.05, d + 0.04), m('#2d3748', { roughness: 0.3 }), 0, h, 0, g); addMesh(new THREE.BoxGeometry(0.5, 0.02, 0.4), m('#111'), w * 0.25, h + 0.03, 0, g); break;
    case 'table': addMesh(new THREE.BoxGeometry(w, 0.06, d), m('#7a5a3a'), 0, h, 0, g); for (const sx of [-1, 1]) for (const sz of [-1, 1]) addMesh(new THREE.BoxGeometry(0.06, h, 0.06), m('#5a4030'), sx * (w / 2 - 0.08), h / 2, sz * (d / 2 - 0.08), g); break;
    case 'fireplace': { addMesh(new THREE.BoxGeometry(w, h, d), m('#8a8580'), 0, h / 2, 0, g); addMesh(new THREE.BoxGeometry(w * 0.55, h * 0.5, 0.05), m('#1a1310'), 0, h * 0.3, d / 2 + 0.01, g, false);
      const fire = addMesh(new THREE.ConeGeometry(0.25, 0.5, 6), new THREE.MeshBasicMaterial({ color: '#ff8a2a' }), 0, 0.3, d / 2 - 0.05, g, false); const fl = new THREE.PointLight('#ff9a40', 6, 8, 2); fl.position.set(0, 0.6, d / 2 + 0.4); g.add(fl); g.userData.fire = [fire, fl]; break; }
    case 'hottub': addMesh(new THREE.BoxGeometry(w, h, d), m('#6b4f3a'), 0, h / 2, 0, g); addMesh(new THREE.BoxGeometry(w - 0.3, 0.05, d - 0.3), new THREE.MeshStandardMaterial({ color: '#4fd1c5', emissive: '#1d6f6a', roughness: 0.1 }), 0, h - 0.08, 0, g, false); break;
    case 'piano': addMesh(new THREE.BoxGeometry(w, 0.7, d), m('#0a0a0a', { roughness: 0.15, metalness: 0.3 }), 0, 0.75, 0, g); addMesh(new THREE.BoxGeometry(w - 0.1, 0.04, 0.2), m('#fff'), 0, 0.82, d / 2 + 0.05, g, false); for (const sx of [-1, 1]) addMesh(new THREE.BoxGeometry(0.08, 0.4, 0.08), m('#0a0a0a'), sx * (w / 2 - 0.15), 0.2, 0, g); break;
    case 'surfboard': addMesh(new THREE.BoxGeometry(0.55, 2.2, 0.08), m('#f6ad55'), 0, 1.1, 0, g).rotation.z = 0.12; break;
    case 'plant': addMesh(new THREE.CylinderGeometry(0.2, 0.16, 0.4, 10), m('#b7791f'), 0, 0.2, 0, g); addMesh(new THREE.SphereGeometry(0.35, 8, 6), m('#2f855a'), 0, 0.8, 0, g); break;
    case 'rug': addMesh(new THREE.BoxGeometry(w, 0.02, d), m(pick(['#9b2c2c', '#2c5282', '#b7791f'])), 0, 0.01, 0, g, false); break;
    case 'keys': addMesh(new THREE.BoxGeometry(w, h, d), m('#5a4632'), 0, h / 2, 0, g); addMesh(new THREE.CylinderGeometry(0.15, 0.1, 0.06, 12), m('#b7791f'), 0, h + 0.03, 0, g, false); addMesh(new THREE.BoxGeometry(0.1, 0.02, 0.04), m('#ccc', { metalness: 1 }), 0, h + 0.07, 0, g, false); break;
    case 'door': addMesh(new THREE.BoxGeometry(1.1, 0.02, 0.6), m('#7a6a4a'), 0, 0.01, -0.4, g, false); break;
  }
}
function buildRoom(id) {
  if (room) iScene.remove(room);
  const H = HOMES[id], W = H.W, D = H.D, WH = 3;
  room = new THREE.Group(); iScene.add(room); room.userData.items = [];
  const ft = plank(H.floor); ft.repeat.set(W / 2, D / 2);
  addMesh(new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.6 }), 0, 0, 0, room, false);
  const wm = std(H.wall);
  addMesh(new THREE.BoxGeometry(W + 0.3, WH, 0.15), wm, 0, WH / 2, -D / 2 - 0.075, room);
  for (const s of [-1, 1]) addMesh(new THREE.BoxGeometry(0.15, WH, D), wm, s * (W / 2 + 0.075), WH / 2, 0, room);
  // low front wall with a gap for the door
  const door = H.items.find(i => i[0] === 'door'), dx = door[1];
  const L = dx - 0.75 + W / 2, R = W / 2 - (dx + 0.75);
  if (L > 0) addMesh(new THREE.BoxGeometry(L, 0.9, 0.15), wm, -W / 2 + L / 2, 0.45, D / 2 + 0.075, room);
  if (R > 0) addMesh(new THREE.BoxGeometry(R, 0.9, 0.15), wm, W / 2 - R / 2, 0.45, D / 2 + 0.075, room);
  for (const s of [-1, 1]) addMesh(new THREE.BoxGeometry(0.12, 2.3, 0.2), std('#3a2c20'), dx + s * 0.7, 1.15, D / 2 + 0.075, room);
  addMesh(new THREE.BoxGeometry(1.52, 0.12, 0.2), std('#3a2c20'), dx, 2.3, D / 2 + 0.075, room);
  // windows on the back wall with a view of the mountains and the sea
  const n = Math.max(1, Math.floor(W / 3.4));
  for (let i = 0; i < n; i++) { const x = -W / 2 + (i + 0.5) * W / n; addMesh(new THREE.PlaneGeometry(Math.min(2.2, W / n - 0.6), 1.3), winMat, x, 1.85, -D / 2 + 0.01, room, false); addMesh(new THREE.BoxGeometry(Math.min(2.2, W / n - 0.6) + 0.12, 0.08, 0.12), std('#f7fafc'), x, 1.17, -D / 2 + 0.06, room, false); }
  // lamps
  for (let i = 0; i < H.lights; i++) { const l = new THREE.PointLight('#ffe2b8', 14 + W, 0, 2); l.position.set(-W / 2 + (i + 0.5) * W / H.lights, 2.8, -D * 0.1); room.add(l); }
  for (const [kind, x, z, rot, wo] of H.items) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; room.add(g); furniture(kind, g, wo);
    let [w, d] = KINDS[kind]; if (wo) w = wo; if (Math.abs(Math.sin(rot)) > 0.5) [w, d] = [d, w];
    room.userData.items.push({ kind, g, x, z, hw: w / 2, hd: d / 2, act: KINDS[kind][3], solid: kind !== 'rug' && kind !== 'door' });
  }
  return H;
}

// ---------- in & out ----------
export const isInside = () => inside;
export const _homes = HOMES, _kinds = KINDS;
export const homeName = () => inside ? '🏠 Home: ' + prop.name : '';
export function enterHome(id) {
  if (inside || player.vehicle) return;
  prop = PROPS.find(p => p.id === id); if (!prop || !OWN.props.includes(id)) return;
  home = buildRoom(id); inside = true;
  const door = home.items.find(i => i[0] === 'door'); I.x = door[1]; I.z = door[2] - 0.9; I.yaw = 0;
  iScene.add(player.model.grp); player.model.grp.visible = true; player.umbrella = false; player.board = false;
  iScene.environment = scene.environment;
  snapCam = true; ui.prompt(''); ui.toast('🏠 ' + prop.name, home.hello, 4500);
}
export function exitHome() {
  if (!inside) return;
  endParty(); inside = false; scene.add(player.model.grp);
  if (room) { iScene.remove(room); room = null; }
  if (pendingRide) { const t = pendingRide; pendingRide = null; const v = callRide(t); if (v) ui.toast('🔑 Your ride is waiting outside', 'Press F to get in.', 2500); }
  ui.prompt('');
}

// ---------- house party ----------
let party = null;
const LOOKS = () => ({ skin: pick(['#f1c9a5', '#e0ac7e', '#c68c5e', '#8d5a3b', '#f5d6bd']), hair: pick(['#1b1b1b', '#3b2416', '#d9b36c', '#a33', '#ccc']), shirt: pick(['#e53e3e', '#3182ce', '#38a169', '#d69e2e', '#805ad5', '#ed64a6', '#fff']), pants: pick(['#1a202c', '#2c5282', '#4a5568', '#744210']) });
const PARTY = ['Someone brought a charcuterie board shaped like the Lions.', 'A guest is explaining crypto. Everyone slowly backs away.', 'Your neighbour knocks: "Keep it down!" …then joins the party.', 'Someone put on Nickelback. It\'s ironic. Mostly.', 'A guy in a fleece vest is talking about his ski season pass.', 'Three people are arguing about the best sushi in town.', 'Someone spilled red wine on the rug. Classic.'];
function startParty() {
  if (party) { ui.toast('🎉 The party is already going!', 'Dance! (Just walk around. That counts.)', 2000); return; }
  const n = Math.round(clamp(home.W * home.D / 6, 3, 16)), guests = [];
  for (let i = 0; i < n; i++) {
    let x = 0, z = 0; for (let k = 0; k < 30; k++) { x = (Math.random() - 0.5) * (home.W - 1); z = (Math.random() - 0.5) * (home.D - 1); if (!blocked(x, z, 0.4)) break; }
    const h = makeHuman(LOOKS()); iScene.add(h.grp); h.grp.position.set(x, 0, z); guests.push({ h, x, z, sp: 0.8 + Math.random(), dir: Math.random() < 0.5 ? -1 : 1, ph: Math.random() * 6 });
  }
  const disco = new THREE.PointLight('#ff3cac', 25, 0, 2); disco.position.set(0, 2.6, 0); iScene.add(disco);
  party = { guests, disco, t: 45, next: 4 };
  player.stats.party = true; sfx.chime?.();
  ui.toast('🎉 HOUSE PARTY!', home.W < 4 ? `${n} guests in a closet. Nobody can move. Best party ever.` : `${n} guests showed up. One of them brought a guitar. Oh no.`, 4000);
}
function endParty() { if (!party) return; for (const g of party.guests) iScene.remove(g.h.grp); iScene.remove(party.disco); party = null; }
function updateParty(dt) {
  if (!party) return;
  party.t -= dt; party.next -= dt;
  for (const g of party.guests) { g.ph += dt * 7 * g.sp; g.h.st.kind = 'walk'; g.h.st.amp = 0.9; g.h.st.phase = g.ph; g.h.grp.rotation.y += dt * g.dir * g.sp * 1.5; g.h.grp.position.y = Math.abs(Math.sin(g.ph)) * 0.15; g.h.pose(dt); }
  party.disco.color.setHSL((G.t * 0.6) % 1, 1, 0.55);
  if (party.next < 0) { party.next = 9; ui.toast('🎉', pick(PARTY), 3000); }
  if (party.t <= 0) { endParty(); ui.toast('🥳 Party over', 'The guests leave. Someone left a single shoe. Nobody knows whose.', 3500); }
}

// ---------- using furniture ----------
const TV = ['📺 Hockey: your team loses 4–3 in overtime. Again.', '📺 Weather: "Rain. Then more rain. Then, surprise: rain."', '📺 A home-reno show where they knock down every wall. You feel nervous.', '📺 A nature documentary about raccoons stealing compost. Inspiring.', '📺 A real estate show. A parking spot sells for $250,000.', '📺 The news: "Local man finds affordable apartment." It was a dream.', '📺 A cooking show: 14 ways to make poutine. You take notes.'];
const FRIDGE = ['Leftover sushi, oat milk and one sad lemon. You eat the sushi.', 'Half a Nanaimo bar. You eat it. No regrets.', 'Just condiments. You eat a spoonful of maple syrup. Breakfast of champions.'];
async function use(it) {
  const k = it.kind;
  if (k === 'door') { exitHome(); return; }
  if (k === 'bed') {
    const i = await ui.dialog('🛏️ Bedtime?', 'Sleep until 8 in the morning? Your tenants pay rent overnight and you wake up with full health.', ['Sleep', 'Not tired']);
    if (i !== 0) return;
    const t = document.getElementById('tunnel'); if (t) { t.innerHTML = '😴 Zzz…<small>Sleeping in your own bed</small>'; t.classList.remove('hidden'); setTimeout(() => t.classList.add('hidden'), 1800); }
    skipNight(); G.hour = 8; player.health = 100; discover('homebody');
    ui.toast('☀️ Good morning!', pick(['You dreamed you found parking downtown. Then you woke up.', 'You slept like a bear in hibernation.', 'A crow was yelling outside at 6 am. Still, 10/10 sleep.']), 4000);
  } else if (k === 'tv') { const s = it.g.userData.screen; if (s) s.material.color.setHSL(Math.random(), 0.5, 0.45); ui.toast(pick(TV), '', 3500); }
  else if (k === 'fridge') { player.health = 100; ui.toast('🧊 Snack time (full health)', pick(FRIDGE), 3000); }
  else if (k === 'kitchen') { player.health = 100; ui.toast('🍳 You cook Kraft Dinner (full health)', 'You add hot dog slices. Gourmet.', 3000); }
  else if (k === 'wardrobe') {
    const own = OUTFITS.filter(o => o.id === 'orig' || OWN.outfits.includes(o.id));
    const i = await ui.dialog('👕 Wardrobe', own.length > 1 ? 'What are you wearing today?' : 'Just your usual look in here. Buy outfits at Lululemony 👖 in Kitsilano.', [...own.map(o => (OWN.outfit === o.id ? '✅ ' : '') + o.name), 'Close']);
    if (own[i]) wear(own[i].id);
  } else if (k === 'shelf') {
    const all = MISSIONS.filter(m => m.who === player.char.id).length + SIDE.length, done = [...state.done].filter(id => SIDE.some(m => m.id === id) || MISSIONS.some(m => m.id === id && m.who === player.char.id)).length;
    await ui.dialog('🏆 Trophy shelf', `Missions done: <b>${done}/${all}</b><br>Secrets found: <b>${state.found.size}/${SECRETS.length}</b><br>Money spent in Vancouver: <b>$${Math.round(OWN.spent).toLocaleString('en-CA')}</b><br>Food deliveries: <b>${OWN.gigs}</b><br>Rent coming in: <b>$${rentPerDay().toLocaleString('en-CA')}/day</b><br><small>Every mission you finish adds a gold cup to the shelf.</small>`, ['Nice']);
  } else if (k === 'stereo') startParty();
  else if (k === 'keys') {
    if (!OWN.rides.length) { ui.toast('🔑 No car keys yet', 'Buy a ride at Kits Motors 🚗 or an e-bike at Mountain Equipment Co-Nope 🎒.', 3000); return; }
    const name = t => t === 'bike' ? 'E-bike' : (RIDES.find(r => r.type === t)?.name || t);
    const i = await ui.dialog('🔑 Car keys', 'Which ride should be waiting outside when you leave?', [...OWN.rides.map(name), 'None']);
    if (OWN.rides[i]) { pendingRide = OWN.rides[i]; ui.toast('🔑 Got the keys', name(pendingRide) + ' will be waiting outside the door.', 2500); }
  } else if (k === 'sofa') ui.toast('🛋️ You sink into the couch', pick(['You scroll your phone for 45 minutes. Productive.', 'You find $2 in the cushions! (You keep it.)', 'Perfect napping conditions.']), 3000);
  else if (k === 'fireplace') { player.health = 100; ui.toast('🔥 Cozy', 'A classic: staring at a fire while it rains outside.', 3000); }
  else if (k === 'hottub') { player.health = 100; player.karma += 0; ui.toast('♨️ Ahhh…', 'Hot tub, mountain view, maybe a light drizzle. You have peaked.', 3500); }
  else if (k === 'piano') { sfx.chime?.(); ui.toast('🎹 You play "Chopsticks"', 'With feeling. The neighbours applaud. (Sarcastically.)', 3000); }
  else if (k === 'surfboard') ui.toast('🏄 Your surfboard', 'You\'ve owned it 3 years. There are no waves at Kits Beach. It\'s decorative now.', 3500);
}

// ---------- walking around ----------
function blocked(x, z, r) { for (const it of room.userData.items) if (it.solid && Math.abs(x - it.x) < it.hw + r && Math.abs(z - it.z) < it.hd + r) return it; return null; }
const distTo = (it, x, z) => Math.hypot(Math.max(0, Math.abs(x - it.x) - it.hw), Math.max(0, Math.abs(z - it.z) - it.hd));
export function updateInterior(dt) {
  if (!inside) return;
  player.health = Math.min(100, player.health + dt * 1.5);
  const ix = (key('KeyD') || key('ArrowRight') ? 1 : 0) - (key('KeyA') || key('ArrowLeft') ? 1 : 0), iz = (key('KeyS') || key('ArrowDown') ? 1 : 0) - (key('KeyW') || key('ArrowUp') ? 1 : 0);
  const run = key('ShiftLeft') || key('ShiftRight'), sp = (run ? 5 : 2.8), l = Math.hypot(ix, iz), r = 0.3;
  if (l > 0) {
    const vx = ix / l * sp * dt, vz = iz / l * sp * dt;
    I.yaw += ((Math.atan2(-ix, -iz) - I.yaw + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 12);
    if (!blocked(I.x + vx, I.z, r)) I.x += vx;
    if (!blocked(I.x, I.z + vz, r)) I.z += vz;
    I.x = clamp(I.x, -home.W / 2 + r, home.W / 2 - r); I.z = clamp(I.z, -home.D / 2 + r, home.D / 2 - r);
  }
  const m = player.model; m.st.kind = 'walk'; m.st.amp = l > 0 ? (run ? 0.85 : 0.6) : 0; m.st.phase += dt * (l > 0 ? sp * 2.1 : 0);
  m.grp.position.set(I.x, 0, I.z); m.grp.rotation.set(0, I.yaw, 0); m.pose(dt); m.parts.stick.visible = false;
  // what's nearby?
  let best = null, bd = 0.9;
  for (const it of room.userData.items) { if (!it.act) continue; const d = distTo(it, I.x, I.z) - (it.kind === 'door' ? 0.4 : 0); if (d < bd) { bd = d; best = it; } }
  if (best && !G.dialogOpen) { ui.prompt(`<kbd>E</kbd> ${best.act}`); if (tapped('KeyE')) use(best); }
  else ui.prompt('');
  // walking out of the door gap also leaves
  if (I.z > home.D / 2 - r - 0.01 && Math.abs(I.x - home.items.find(i => i[0] === 'door')[1]) < 0.7 && iz > 0) exitHome();
  for (const it of room?.userData.items || []) if (it.g.userData.fire) { const [f, fl] = it.g.userData.fire; const k = 0.8 + Math.random() * 0.4; f.scale.set(k, 0.8 + Math.random() * 0.5, k); fl.intensity = 5 + Math.random() * 3; }
  updateParty(dt);
}
export function renderInterior() {
  const day = G.hour > (G.sunRise ?? 6.5) && G.hour < (G.sunRise ?? 6.5) + (G.dayLen ?? 13);
  winMat.emissiveIntensity = day ? 1 : 0.06; winMat.color.set(day ? '#ffffff' : '#1a2238'); hemi.intensity = day ? 1.1 : 0.45;
  iScene.background = bg.set(day ? '#2a3440' : '#0b0f16');
  if (home) {
    const s = Math.max(home.W, home.D), tx = I.x * 0.6, tz = I.z * 0.5;
    const cx = tx, fit = Math.max(1, home.W / (camera.aspect * 12)), cy = 2.6 + s * 0.55 * fit, cz = home.D / 2 + 1.6 + s * 0.35 * fit;
    camTo.set(cx, cy, cz); if (snapCam) { iCam.position.copy(camTo); snapCam = false; } else iCam.position.lerp(camTo, 0.15); iCam.lookAt(tx, 0.6, tz - 0.4);
  }
  iCam.aspect = camera.aspect; iCam.updateProjectionMatrix();
  renderer.toneMappingExposure = 0.85;
  renderer.render(iScene, iCam);
}
