// The Downtown Eastside, shown with respect: people experiencing homelessness and addiction are PEOPLE here,
// not monsters. Tents in Oppenheimer Park, people sleeping in doorways and under the viaduct, folks asking for
// spare change (help them, chat, become friends), overdose emergencies you can reverse with a free naloxone kit,
// used needles / broken glass on some sidewalks (step around them, or dispose of them safely with a sharps box),
// a harm-reduction outreach van, and a few people elsewhere in the city with a cardboard sign.
import * as THREE from 'three';
import { G, scene, std, addMesh, toXZ, canvasTex, tapped, R, pick, hash2, inPoly } from './core.js';
import { heightAt, isWater } from './terrain.js';
import { surfaceY, buildingAt, nearestRoad, NX, NZ } from './city.js';
import { makeHuman } from './people.js';
import { SPOTS } from './landmarks.js';
import { discover, state, setWaypoint } from './missions.js';
import { ui } from './ui.js';
import { sfx } from './sound.js';

const M = window.MAP;
const C = (() => { const [x, z] = toXZ(49.2811, -123.1000); return { x, z }; })();   // Main & Hastings
const inArea = (x, z) => Math.hypot(x - C.x, z - C.z) < 750;
export const dtes = { kits: 0, sharpsBox: false, saves: 0, talks: 0, sharps: 0, served: 0 };

// ---------- the people ----------
const NAMES = ['Dale', 'Marie', 'Sonny', 'Tash', 'Uncle Ray', 'Jojo', 'Lena', 'Kev', 'Bev', 'Mikey', 'Rosie', 'Thomas', 'Angel', 'Duke', 'Patty', 'Chris', 'Nora', 'Jimmy', 'Cece', 'Wes', 'Grace', 'Benny'];
const STORIES = [
  'I fished out of Steveston for twenty years. Then my back went, then the pills, then… well. Here I am.',
  'I paint, you know. Sold one at the Carnegie art show last spring. Forty bucks!',
  'My daughter\'s in Kamloops. Gonna call her on Sunday. Haven\'t told her I\'m on the street.',
  'Lost my apartment when the building got sold. Rent went from $900 to $2,100. That was it.',
  'I\'ve been on the waitlist for housing for two years. Two years!',
  'I was a line cook at a place in Gastown. Fancy place. Fancy people. Then I got hurt.',
  'Six months clean last year. Doing it again. One day at a time, right?',
  'Grew up up north, in Prince George. Came down here for work. Didn\'t find much.',
  'The Carnegie has the cheapest coffee in the city. And a library. Best place around, honestly.',
  'People walk past like we\'re invisible. Thanks for stopping. Means a lot.',
  'I used to play guitar at the Smiling Buddha back in the day. Ask anyone.',
  'My friend overdosed last month. Someone had naloxone. He\'s alive because of a stranger.',
];
const ASK = ['Hey, got any spare change? Anything helps.', 'Spare a little change for a coffee?', 'Morning! Nice day for it, eh? …Spare a toonie?', 'Hey friend. Got a dollar or two?'];
const HI = n => [`Hey, it's you! Good to see you.`, `Look who it is! How you doing, friend?`, `There's my favourite person.`][n % 3];
const LOOKS = () => ({ skin: pick(['#f1c9a5', '#e0ac7e', '#c68c5e', '#8d5a3b', '#a96f45', '#f5d6bd']), hair: pick(['#1b1b1b', '#3b2416', '#7a6a5a', '#9a9a9a', '#5a3a22']), shirt: pick(['#4a5568', '#2d3748', '#6b4f3a', '#3c5a3c', '#7a2e2e', '#2c3e50', '#5b5b6b']), pants: pick(['#1a202c', '#2d3748', '#4a3b2a', '#3a3f4a']), hat: Math.random() < 0.6 ? pick(['#1a202c', '#7a2e2e', '#2c5282', '#4a5568', '#3c5a3c']) : null, bag: Math.random() < 0.5 ? pick(['#2d3748', '#4a3b2a', '#2c5282']) : null });
const people = [];
function addPerson(x, z, yaw, kind, citywide = false) {
  const h = makeHuman(LOOKS()); h.grp.visible = false; scene.add(h.grp);
  const p = { h, x, z, yaw, kind, name: NAMES[people.length % NAMES.length], story: STORIES[people.length % STORIES.length], friend: 0, talked: 0, citywide, props: new THREE.Group(), od: 0, odT: 0 };
  scene.add(p.props); p.props.position.set(x, surfaceY(x, z), z); p.props.rotation.y = yaw;
  if (kind === 'sleep') { addMesh(new THREE.BoxGeometry(0.9, 0.22, 2.0), std(pick(['#2c5282', '#7a2e2e', '#3c5a3c', '#5b4a7a'])), 0, 0.11, 0, p.props, false); addMesh(new THREE.BoxGeometry(1.1, 0.04, 2.2), std('#b08a5a'), 0, 0.02, 0, p.props, false); }
  else {
    addMesh(new THREE.BoxGeometry(0.8, 0.04, 0.9), std('#b08a5a'), 0, 0.02, 0.15, p.props, false);   // cardboard to sit on
    if (Math.random() < 0.45) { const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.38), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, map: canvasTex(128, 88, (c, w, h2) => { c.fillStyle = '#c8a06a'; c.fillRect(0, 0, w, h2); c.fillStyle = '#222'; c.font = 'bold 16px sans-serif'; c.textAlign = 'center'; const t = pick([['ANYTHING', 'HELPS 🙏'], ['HUNGRY', 'GOD BLESS'], ['SMILE :)', 'IT\'S FREE'], ['NEED $ FOR', 'BUS HOME']]); c.fillText(t[0], w / 2, 36); c.fillText(t[1], w / 2, 62); }, false) })); sign.position.set(0.35, 0.35, -0.35); sign.rotation.x = -0.3; p.props.add(sign); }
    if (Math.random() < 0.35) { const cart = new THREE.Group(); const wire = std('#9aa0a6', { metalness: 0.6, wireframe: true }); addMesh(new THREE.BoxGeometry(0.6, 0.55, 0.9), wire, 0, 0.75, 0, cart, false); addMesh(new THREE.BoxGeometry(0.55, 0.4, 0.8), std(pick(['#2c5282', '#3c5a3c', '#555'])), 0, 0.72, 0, cart, false); cart.position.set(-1.1, 0, 0.2); p.props.add(cart); }
    addMesh(new THREE.CylinderGeometry(0.06, 0.05, 0.1, 10), std('#ddd'), 0.3, 0.07, -0.45, p.props, false);   // the cup for change
  }
  people.push(p); return p;
}
// ---------- places: Hastings sidewalks, Oppenheimer Park tents, under the Georgia viaduct ----------
const tents = [];
function tent(x, z, yaw) {
  const g = new THREE.Group(), c = pick(['#2b6cb0', '#c05621', '#2f855a', '#718096', '#b7791f', '#9b2c2c', '#553c9a']);
  const t = addMesh(new THREE.ConeGeometry(1.35, 1.3, 4, 1), std(c, { roughness: 0.6 }), 0, 0.65, 0, g); t.rotation.y = Math.PI / 4; t.scale.set(1, 1, 1.4);
  if (Math.random() < 0.5) { const tarp = addMesh(new THREE.BoxGeometry(2.4, 0.04, 2.6), std('#2b6cb0', { roughness: 0.5 }), 0, 1.15, 0, g); tarp.rotation.z = 0.25; }   // a blue tarp over it for the rain
  addMesh(new THREE.BoxGeometry(0.5, 0.3, 0.4), std(pick(['#2d3748', '#4a3b2a', '#7a2e2e'])), 1.3, 0.15, 0.6, g);
  g.position.set(x, surfaceY(x, z), z); g.rotation.y = yaw; g.visible = false; scene.add(g); tents.push(g);
}
function placeAll() {
  // Hastings Street sidewalks (Cambie to Gore): people sitting against the walls, some asleep in doorways
  const spots = [];
  for (const r of M.roads) {
    const n = M.names[r.n] || ''; if (!/Hastings Street/.test(n) || r.t > 3) continue;
    for (let i = 1; i < r.p.length; i++) {
      const ax = NX(r.p[i - 1]), az = NZ(r.p[i - 1]), dx = NX(r.p[i]) - ax, dz = NZ(r.p[i]) - az, L = Math.hypot(dx, dz); if (L < 5) continue;
      for (let s = 6; s < L; s += 16) { const x = ax + dx * s / L, z = az + dz * s / L; if (Math.hypot(x - C.x, z - C.z) > 520) continue; for (const side of [-1, 1]) { const off = r.w / 2 + 2.15, px = x - dz / L * off * side, pz = z + dx / L * off * side; if (!buildingAt(px, pz) && !isWater(px, pz)) spots.push([px, pz, Math.atan2(-dz / L * side, dx / L * side) + Math.PI / 2]); } }
    }
  }
  spots.sort((a, b) => hash2(a[0], a[1]) - hash2(b[0], b[1]));
  spots.slice(0, 22).forEach(([x, z, yaw], i) => addPerson(x, z, yaw, i % 4 === 3 ? 'sleep' : 'sit'));
  // Oppenheimer Park: a tent village
  const [ox, oz] = toXZ(49.2826, -123.0945); let park = null, bd = 1e9;
  for (const a of M.areas) { if (a.k !== 'park' || a.line) continue; if (inPoly(ox, oz, a.p)) { park = a; break; } }
  for (let k = 0, n = 0; k < 400 && n < 24; k++) { const x = ox + R(-55, 55), z = oz + R(-45, 45); if (park && !inPoly(x, z, park.p)) continue; if (buildingAt(x, z) || tents.some(t => Math.hypot(t.position.x - x, t.position.z - z) < 4.2)) continue; tent(x, z, R(0, 6.28)); n++; if (n % 4 === 0) addPerson(x + 2.2, z + 1, R(0, 6.28), 'sit'); }
  // under the Georgia viaduct
  const [vx, vz] = toXZ(49.27860, -123.10230);
  for (let k = 0; k < 4; k++) { const x = vx + R(-30, 30), z = vz + R(-8, 8); if (!buildingAt(x, z) && !isWater(x, z)) addPerson(x, z, R(0, 6.28), 'sleep'); }
}
// ---------- the outreach van (free naloxone kits + sharps containers) + pharmacies ----------
let van = null;
function buildVan() {
  const nr = nearestRoad(C.x + 60, C.z, 120, r => r.t <= 4); let x = C.x + 60, z = C.z, yaw = 0;
  if (nr) { const e = nr.e, ax = NX(e.a), az = NZ(e.a), dx = NX(e.b) - ax, dz = NZ(e.b) - az, L = Math.hypot(dx, dz); x = ax + dx * nr.t + (-dz / L) * (nr.road.w / 2 - 1.3); z = az + dz * nr.t + (dx / L) * (nr.road.w / 2 - 1.3); yaw = Math.atan2(-dx, -dz); }
  const g = new THREE.Group(); addMesh(new THREE.BoxGeometry(2.2, 2.4, 5.6), std('#f4f4f0'), 0, 1.5, 0, g); addMesh(new THREE.BoxGeometry(2.22, 0.5, 5.62), std('#2b6cb0'), 0, 1.1, 0, g);
  for (const [sx, sz] of [[-1, -1.8], [1, -1.8], [-1, 1.8], [1, 1.8]]) addMesh(new THREE.CylinderGeometry(0.38, 0.38, 0.3, 12).rotateZ(Math.PI / 2), std('#111'), sx * 1.05, 0.38, sz, g);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 1.0), new THREE.MeshBasicMaterial({ map: canvasTex(512, 112, (c, w, h) => { c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h); c.fillStyle = '#2b6cb0'; c.font = 'bold 40px sans-serif'; c.textAlign = 'center'; c.fillText('💙 HARM REDUCTION OUTREACH', w / 2, 50); c.font = '28px sans-serif'; c.fillText('Free naloxone · sharps boxes · a friendly chat', w / 2, 92); }, false) }));
  for (const s of [-1, 1]) { const m = sign.clone(); m.position.set(s * 1.12, 2.0, 0); m.rotation.y = s * Math.PI / 2; g.add(m); }
  const worker = makeHuman({ skin: '#c68c5e', hair: '#1b1b1b', shirt: '#2b6cb0', pants: '#1a202c', hat: null, bag: null }); worker.grp.position.set(2.2, 0, 0.5); worker.grp.rotation.y = Math.PI / 2; g.add(worker.grp);
  g.position.set(x, surfaceY(x, z), z); g.rotation.y = yaw; scene.add(g); van = { g, worker, x: x + Math.cos(yaw) * 2.2, z: z - Math.sin(yaw) * 2.2 };
}
const pharmacies = M.pois.filter(p => p.k === 'pharmacy');

// ---------- needles and broken glass on some sidewalks ----------
const hazards = [];
let hazMesh = null, glassMesh = null;
function buildHazards() {
  for (const p of people) for (let k = 0; k < 3; k++) { const a = Math.random() * 6.28, r = R(1.5, 6), x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r; if (!buildingAt(x, z)) hazards.push({ x, z, glass: Math.random() < 0.4, done: false, hurt: false }); }
  for (const t of tents) if (Math.random() < 0.6) hazards.push({ x: t.position.x + R(-3, 3), z: t.position.z + R(-3, 3), glass: Math.random() < 0.3, done: false });
  const needleGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.14, 5).rotateZ(Math.PI / 2).translate(0, 0.02, 0), capGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.05, 6).rotateZ(Math.PI / 2).translate(0.09, 0.02, 0);
  const merged = new THREE.BufferGeometry(); { const a = needleGeo.toNonIndexed(), b = capGeo.toNonIndexed(); merged.setAttribute('position', new THREE.Float32BufferAttribute([...a.attributes.position.array, ...b.attributes.position.array], 3)); merged.computeVertexNormals(); }
  const glassGeo = new THREE.TetrahedronGeometry(0.05, 0).translate(0, 0.02, 0);
  hazMesh = new THREE.InstancedMesh(merged, std('#e8641e'), hazards.length); glassMesh = new THREE.InstancedMesh(glassGeo, new THREE.MeshStandardMaterial({ color: '#cfe8ef', transparent: true, opacity: 0.6, roughness: 0.1, metalness: 0.3 }), hazards.length * 4);
  scene.add(hazMesh, glassMesh); refreshHazards();
}
function refreshHazards() {
  const o = new THREE.Object3D(); let n = 0, gN = 0;
  for (const h of hazards) { if (h.done) continue; const y = surfaceY(h.x, h.z); if (h.glass) for (let k = 0; k < 4; k++) { o.position.set(h.x + R(-0.15, 0.15), y, h.z + R(-0.15, 0.15)); o.rotation.set(R(0, 3), R(0, 3), R(0, 3)); o.scale.setScalar(R(0.6, 1.3)); o.updateMatrix(); glassMesh.setMatrixAt(gN++, o.matrix); } else { o.position.set(h.x, y, h.z); o.rotation.set(0, hash2(h.x, h.z) * 6, 0); o.scale.setScalar(1); o.updateMatrix(); hazMesh.setMatrixAt(n++, o.matrix); } }
  hazMesh.count = n; glassMesh.count = gN; hazMesh.instanceMatrix.needsUpdate = glassMesh.instanceMatrix.needsUpdate = true;
}

// ---------- a few people elsewhere in the city ----------
let cityT = 5;
function updateCitywide(dt, pl) {
  cityT -= dt; if (cityT > 0) return; cityT = 8;
  for (let i = people.length - 1; i >= 0; i--) { const p = people[i]; if (p.citywide && Math.hypot(p.x - pl.x, p.z - pl.z) > 400) { scene.remove(p.h.grp, p.props); people.splice(i, 1); } }
  if (inArea(pl.x, pl.z) || pl.vehicle || people.filter(p => p.citywide).length >= 2 || Math.random() > 0.35) return;
  const nr = nearestRoad(pl.x + R(-120, 120), pl.z + R(-120, 120), 80, r => r.t >= 2 && r.t <= 4); if (!nr) return;
  const e = nr.e, ax = NX(e.a), az = NZ(e.a), dx = NX(e.b) - ax, dz = NZ(e.b) - az, L = Math.hypot(dx, dz) || 1, side = Math.random() < 0.5 ? 1 : -1, off = nr.road.w / 2 + 2.1;
  const x = ax + dx * nr.t - dz / L * off * side, z = az + dz * nr.t + dx / L * off * side;
  if (buildingAt(x, z) || isWater(x, z) || Math.hypot(x - pl.x, z - pl.z) < 40) return;
  addPerson(x, z, Math.atan2(-dz / L * side, dx / L * side) + Math.PI / 2, 'sit', true);
}

// ---------- overdoses ----------
let odT = 90, odPerson = null;
export function startOverdose(near = true) {
  const pl = window.__game.player, cands = people.filter(p => p.kind === 'sit' && !p.od && (!near || Math.hypot(p.x - pl.x, p.z - pl.z) < 220));
  if (!cands.length) return null; const p = pick(cands); p.od = 1; p.odT = 150; odPerson = p;
  ui.toast('🆘 Someone has collapsed!', `${p.name} is slumped over and not breathing properly. It could be an overdose. Get to them fast (🆘 on your map).`, 5000); sfx.horn?.(0.15);
  return p;
}
function revive(p, how) {
  p.od = 2; p.odT = 4;
  if (how === 'naloxone') { dtes.kits--; dtes.saves++; window.__game.player.karma += 3; window.__game.player.stats.saves = dtes.saves; ui.toast('💙 You gave naloxone', `Spray in the nose… a few long seconds… ${p.name} gasps and starts breathing again. You saved a life. (Paramedics are on the way: naloxone can wear off.)`, 6000); discover('lifesaver'); }
  else ui.toast('🚑 Paramedics arrived', `They gave ${p.name} oxygen and naloxone. They'll be okay, this time. Tip: free naloxone kits at the outreach van or any pharmacy.`, 5500);
}
export function dtesMarkers() { return [...(odPerson && odPerson.od === 1 ? [{ x: odPerson.x, z: odPerson.z, icon: '🆘', edge: true }] : []), ...(van ? [{ x: van.x, z: van.z, icon: '💙' }] : [])]; }

// ---------- E prompts ----------
let busy = false;
export function dtesPrompt(pl) {
  if (busy || pl.vehicle || pl.transit || G.dialogOpen) return '';
  // overdose first (it's urgent)
  if (odPerson && odPerson.od === 1 && Math.hypot(odPerson.x - pl.x, odPerson.z - pl.z) < 3) {
    if (tapped('KeyE')) { if (dtes.kits > 0) revive(odPerson, 'naloxone'); else { busy = true; ui.dialog('🆘 ' + odPerson.name + ' is not breathing', 'You don\'t have a naloxone kit. Call 911 and stay with them: talk to them, keep them on their side.', ['📞 Call 911 and stay', '🏃 Run to the outreach van for a kit']).then(i => { busy = false; if (i === 0) { odPerson.odT = Math.min(odPerson.odT, 15); odPerson.called = true; ui.toast('📞 911', 'Paramedics are on their way. Stay with them.', 3000); } else if (van) setWaypoint(van.x, van.z, 'Outreach van'); }); } }
    return `<kbd>E</kbd> 💙 Help ${odPerson.name}${dtes.kits > 0 ? ' (give naloxone)' : ''}`;
  }
  if (van && Math.hypot(van.x - pl.x, van.z - pl.z) < 4) {
    if (tapped('KeyE')) { busy = true; ui.dialog('💙 Outreach worker', 'Hey! We hand out free naloxone kits and sharps boxes, and check in on folks. Naloxone reverses an opioid overdose: spray it in the nose, call 911, stay with them.', ['💙 Free naloxone kit', '🧰 Sharps container (for safe needle pickup)', 'Thanks!']).then(i => { busy = false; if (i === 0) { dtes.kits = Math.min(3, dtes.kits + 1); ui.toast('💙 Naloxone kit', `You have ${dtes.kits}. Look for 🆘 on the map if someone needs help.`, 3000); } if (i === 1) { dtes.sharpsBox = true; ui.toast('🧰 Sharps container', 'Now you can safely pick up used needles you find (E). Never with bare hands!', 3500); } }); }
    return '<kbd>E</kbd> 💙 Talk to the outreach worker (free naloxone)';
  }
  for (const ph of pharmacies) if (Math.abs(ph.x - pl.x) < 9 && Math.abs(ph.z - pl.z) < 9 && Math.hypot(ph.x - pl.x, ph.z - pl.z) < 9) { if (tapped('KeyE')) { dtes.kits = Math.min(3, dtes.kits + 1); ui.toast('💊 Free naloxone kit', `Pharmacies in BC hand them out for free. You have ${dtes.kits}.`, 3000); } return '<kbd>E</kbd> 💊 Ask for a free naloxone kit'; }
  if (dtes.sharpsBox) for (const h of hazards) if (!h.done && Math.abs(h.x - pl.x) < 1.6 && Math.abs(h.z - pl.z) < 1.6) { if (tapped('KeyE')) { h.done = true; dtes.sharps++; pl.money += 2; pl.karma += 1; refreshHazards(); ui.toast(h.glass ? '🧹 Swept up the glass' : '🧰 Needle disposed safely', dtes.sharps % 5 === 0 ? `${dtes.sharps} cleaned up. The street is a little safer.` : '', 1500); } return `<kbd>E</kbd> 🧰 Safely pick up the ${h.glass ? 'broken glass' : 'used needle'}`; }
  let best = null, bd = 2.6; for (const p of people) { if (p.od || !p.h.grp.visible) continue; const d = Math.hypot(p.x - pl.x, p.z - pl.z); if (d < bd) { bd = d; best = p; } }
  if (best) { if (tapped('KeyE')) talkTo(best, pl); return `<kbd>E</kbd> 💬 ${best.friend >= 3 ? 'Say hi to ' + best.name : best.kind === 'sleep' ? 'Check on the person sleeping' : 'Talk to ' + best.name}`; }
  return '';
}
async function talkTo(p, pl) {
  busy = true; dtes.talks++;
  if (p.kind === 'sleep') { const i = await ui.dialog('😴 Someone sleeping', `${p.name} is asleep in a sleeping bag. Breathing slowly and steadily. They're okay.`, ['Leave them be', 'Leave a sandwich ($4) next to them']); busy = false; if (i === 1 && pl.money >= 4) { pl.money -= 4; pl.karma += 1; ui.toast('🥪 Left a sandwich', 'Small things matter.', 2000); } return; }
  const friendly = p.friend >= 3, line = friendly ? HI(p.talked++) : pick(ASK);
  const i = await ui.dialog(`🧍 ${p.name}`, line, ['🪙 Give $2', '💵 Give $5', '💸 Give $20', '☕ Buy them a coffee ($3)', '💬 Just chat', 'Sorry, not today']);
  busy = false;
  const give = [2, 5, 20, 3][i];
  if (give) {
    if (pl.money < give) { ui.toast('Your pockets are empty', 'They shrug: "No worries. Have a good one."', 2200); return; }
    pl.money -= give; pl.karma += give >= 20 ? 3 : give >= 5 ? 2 : 1; p.friend += give >= 20 ? 3 : give >= 5 ? 2 : 1;
    ui.toast(i === 3 ? '☕ "Double double? You\'re a saint."' : `"Thank you. Really."`, pick(['They smile for the first time today.', 'They fist-bump you.', '"God bless, friend."', '"Stay warm out there, eh?"']), 2600);
  } else if (i === 4) { p.friend += 1; ui.toast(`💬 ${p.name}`, p.story, 6000); }
  else { ui.toast('"No worries. Have a good one."', '', 1800); return; }
  if (p.friend >= 3 && !p.isFriend) {
    p.isFriend = true; ui.toast(`🤝 ${p.name} is your friend now`, 'They\'ll say hi when you walk by.', 3500); discover('newfriend');
    const left = Object.values(SPOTS).filter(s => !state.found.has(s.id));
    if (left.length && Math.random() < 0.6) { const s = pick(left); setWaypoint(s.x, s.z, `${p.name}'s tip`); setTimeout(() => ui.toast(`💡 ${p.name}: "Hey, I'll tell you a secret spot…"`, '(Waypoint set.)', 4000), 3800); }
  }
}

// ---------- per frame ----------
let hurtCool = 0;
export function updateDtes(dt, pl) {
  const near = Math.hypot(pl.x - C.x, pl.z - C.z) < 1200;
  for (const t of tents) t.visible = near;
  if (hazMesh) hazMesh.visible = glassMesh.visible = near;
  updateCitywide(dt, pl);
  for (const p of people) {
    const d = Math.hypot(p.x - pl.x, p.z - pl.z), vis = d < (p.citywide ? 400 : 650);
    p.h.grp.visible = vis; p.props.visible = vis; if (!vis) continue;
    const y = surfaceY(p.x, p.z), st = p.h.st;
    if (p.kind === 'sleep') { p.h.grp.position.set(p.x, y + 0.25, p.z); p.h.grp.rotation.set(-Math.PI / 2, p.yaw, 0, 'YXZ'); st.kind = 'stand'; st.amp = 0; }
    else if (p.od === 1) {   // overdose: slumped right over, then lying down
      p.odT -= dt; p.h.grp.position.set(p.x, y + 0.35, p.z); p.h.grp.rotation.set(p.odT > 130 ? 0.9 : Math.PI / 2 * 0.95, p.yaw, 0.2, 'YXZ'); st.kind = 'sit'; st.amp = 0;
      if (p.odT < 0) { revive(p, 'paramedics'); }
    } else if (p.od === 2) { p.odT -= dt; p.h.grp.position.set(p.x, y + 0.45, p.z); p.h.grp.rotation.set(Math.max(0, p.odT / 4) * 1.2, p.yaw, 0, 'YXZ'); st.kind = 'sit'; if (p.odT < 0) { p.od = 0; if (odPerson === p) odPerson = null; } }
    else {
      p.h.grp.position.set(p.x, y + 0.45, p.z); p.h.grp.rotation.set(0, p.yaw + (d < 8 ? Math.atan2(Math.sin(Math.atan2(-(pl.x - p.x), -(pl.z - p.z)) - p.yaw), Math.cos(Math.atan2(-(pl.x - p.x), -(pl.z - p.z)) - p.yaw)) * 0.6 : 0), 0); st.kind = 'sit'; st.amp = 0;
      if (p.isFriend && d < 9 && !p.waved) { p.waved = true; ui.toast(`👋 ${p.name}`, HI(p.talked++), 2000); }
      if (d > 30) p.waved = false;
    }
    p.h.pose(dt);
  }
  // overdose events near the people here
  odT -= dt;
  if (odT < 0) { odT = R(150, 300); if (!odPerson && (near || people.some(p => p.citywide)) && !pl.transit) startOverdose(true); }
  // stepping on a needle / glass (on foot, moving)
  hurtCool -= dt;
  if (near && !pl.vehicle && hurtCool < 0 && Math.hypot(pl.vx || 0, pl.vz || 0) > 1) for (const h of hazards) if (!h.done && Math.abs(h.x - pl.x) < 0.35 && Math.abs(h.z - pl.z) < 0.35) { hurtCool = 3; pl.health -= 6; ui.toast(h.glass ? '🩹 Ouch! Broken glass' : '🩹 Ouch! A used needle', h.glass ? 'Watch your step around here.' : 'Watch where you step. Get a sharps box from the outreach van to pick them up safely.', 3200); break; }
}
export function initDtes() { placeAll(); buildVan(); buildHazards(); }
export const _dtes = { people, hazards, tents, get van() { return van; }, get od() { return odPerson; }, revive, refreshHazards };
