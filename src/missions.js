// Characters, story missions, side jobs and secrets (easter eggs).
import * as THREE from 'three';
import { G, scene, toXZ, std, addMesh, R, pick, key, tapped } from './core.js';
import { heightAt, isWater, waterLevel } from './terrain.js';
import { surfaceY, buildingAt } from './city.js';
import { SPOTS } from './landmarks.js';
import { zstats, spawnZombie, zombies, say, ZONE, nearestPed } from './people.js';
import { animals, nearestAnimal } from './animals.js';
import { vehicles, makeVehicle, makeRunner } from './vehicles.js';
import { player } from './player.js';
import { ui } from './ui.js';
import { sfx } from './sound.js';
import { liftPrompt } from './lifts.js';
import { transitPrompt } from './transit.js';
import { detailsPrompt } from './details.js';
import { lifePrompt } from './cityevents.js';
import { seaPrompt } from './sealife.js';
import { dtesPrompt, dtes, startOverdose } from './dtes.js';
import { snowFunPrompt } from './snowfun.js';
import { slopesPrompt } from './slopes.js';
import { activityPrompt } from './activities.js';
import { qePrompt } from './qepark.js';
import { trailsPrompt } from './trails.js';
import { minigamePrompt } from './minigames.js';
import { boatPrompt } from './boats.js';
import { faunaPrompt } from './fauna.js';
import { gunPrompt } from './guns.js';
import { parkedSpots } from './streetlife.js';
import { shopPrompt, updateShops, gigText, gigActive, startGig, stopGig, OWN } from './shops.js';
import { setWeather, W, splashStats } from './weather.js';
import { EVENT_SPOTS, nearCherry } from './seasons.js';

const XZ = (lat, lon) => { const [x, z] = toXZ(lat, lon); return { x, z }; };

// ---------- characters ----------
export const CHARACTERS = [
  { id: 'kai', face: '🚲', name: 'Kai "Seawall" Nakamura', tag: 'Bike courier · Kitsilano',
    blurb: 'Lives for the seawall, fuelled entirely by oat-milk lattes. Owes his landlord three months of rent and a kombucha.',
    look: { skin: '#e0ac7e', hair: '#1b1b1b', shirt: '#2f855a', pants: '#2d3748', hat: '#c53030', backpack: '#f6ad55', fore: '#e0ac7e', shin: '#e0ac7e', beard: '#1b1b1b', lips: '#b9806a' }, start: [49.2742, -123.1545], startYaw: 0.4, where: 'Starts at Kits Beach' },
  { id: 'brenda', face: '🏡', name: 'Brenda Kowalski', tag: 'Realtor · Yaletown',
    blurb: 'Top-selling realtor. Her face is on 400 bus benches. Believes a 380 sq ft condo is "cozy luxury".',
    look: { skin: '#f5d6bd', hair: '#d9b36c', shirt: '#b83280', pants: '#1a202c', bob: '#d9b36c', fringe: '#d9b36c', lips: '#c0505a', eyes: '#4a6a8a' }, start: [49.2748, -123.1218], startYaw: 0, where: 'Starts in Yaletown' },
  { id: 'dex', face: '🎬', name: 'Dex Sterling', tag: 'Actor · "Hollywood North"',
    blurb: 'Once played "Guy #3 Who Gets Eaten" on a big TV show. Now he\'s the stand-in for the stand-in.',
    look: { skin: '#c68c5e', hair: '#3b2416', shirt: '#1a202c', pants: '#2c5282', hat: '#1a202c', beard: '#3b2416', lips: '#9a6048' }, start: [49.2843, -123.1078], startYaw: 1.2, where: 'Starts on a film set in Gastown' },
  { id: 'mei', face: '👻', name: 'Mei Chen', tag: 'Paranormal YouTuber',
    blurb: 'Hunts ghosts for 312 subscribers. Something weird is happening at Playland\'s Fright Nights… and it\'s not a costume.',
    look: { skin: '#f1c9a5', hair: '#2a2a40', shirt: '#805ad5', pants: '#1a202c', backpack: '#2d3748', long: '#2a2a40', fringe: '#2a2a40', glasses: '#111111', lips: '#c46a6a' }, start: [49.2805, -123.0985], startYaw: -1.5, where: 'Starts near Chinatown' },
];

// ---------- mission plumbing ----------
const checks = new Set();
const waitFor = fn => new Promise(res => checks.add({ fn, res }));
let active = null;           // running mission
export const state = { done: new Set(), found: new Set(), waypoint: null };
const beamMat = c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false });
const beamGeo = new THREE.CylinderGeometry(3, 3, 500, 12, 1, true);
const wpBeam = new THREE.Mesh(beamGeo, beamMat('#ffd45c')); wpBeam.visible = false; scene.add(wpBeam);

export function setWaypoint(x, z, label) {
  state.waypoint = x == null ? null : { x, z, label };
  wpBeam.visible = !!state.waypoint; if (state.waypoint) wpBeam.position.set(x, surfaceY(x, z) + 250, z);
}
class Fail extends Error {}
const dist = (p) => Math.hypot(player.x - p.x, player.z - p.z);
const timeLeft = () => active?.deadline ? Math.max(0, active.deadline - G.t) : null;
function fmt(t) { const s = Math.ceil(t); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function objective(text) {
  if (!active) return;
  active.text = text;
}
export function setDeadline(sec) { active.deadline = G.t + sec; }
// a target out on the water can't be reached on foot / by bike / by car: move it to the nearest shore
const blocked = (x, z) => isWater(x, z) || !!buildingAt(x, z) || !!buildingAt(x + 2.5, z) || !!buildingAt(x - 2.5, z) || !!buildingAt(x, z + 2.5) || !!buildingAt(x, z - 2.5);
function landPoint(p) {
  if (!blocked(p.x, p.z)) return p;
  for (let rr = 3; rr < 600; rr += 3) for (let a = 0; a < 6.28; a += 0.12) { const x = p.x + Math.cos(a) * rr, z = p.z + Math.sin(a) * rr; if (!blocked(x, z)) return { ...p, x: x + Math.cos(a) * 2, z: z + Math.sin(a) * 2 }; }
  return p;
}
function goto(p, text, { r = 14, vehicle = null, under = null } = {}) {
  const flies = vehicle && vehicle.some(v => ['heli', 'seaplane', 'jetski', 'cessna', 'jet', 'jumbo'].includes(v));
  if (!under && !flies && p !== player) p = landPoint(p);
  objective(text); setWaypoint(p.x, p.z, text);
  return waitFor(() => {
    if (active?.deadline && G.t > active.deadline) return 'fail';
    if (vehicle && (!player.vehicle || !vehicle.includes(player.vehicle.type))) return false;
    if (under && !(player.y < under)) return false;
    return dist(p) < r ? 'ok' : false;
  }).then(r => { if (r === 'fail') throw new Fail('Out of time!'); });
}
const talk = (name, text, choices) => ui.dialog(name, text, choices);

// pickups: spinning items you drive/walk through
const pickupGeo = { donut: new THREE.TorusGeometry(0.6, 0.28, 10, 20), sign: new THREE.BoxGeometry(1.2, 0.9, 0.1), box: new THREE.BoxGeometry(0.8, 0.8, 0.8), phone: new THREE.BoxGeometry(0.4, 0.7, 0.08) };
const pickupMat = { donut: std('#e9a5c0', { emissive: '#552030' }), sign: std('#fff', { emissive: '#333' }), box: std('#c9a26b', { emissive: '#332200' }), phone: std('#222', { emissive: '#113' }) };
async function collect(points, kind, text) {
  points = points.map(landPoint);
  const items = points.map(p => { const m = addMesh(pickupGeo[kind], pickupMat[kind], p.x, surfaceY(p.x, p.z) + 1.6, p.z); const b = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 80, 10, 1, true), beamMat('#ff7ad9')); b.position.set(p.x, m.position.y + 40, p.z); scene.add(b); return { p, m, b, got: false }; });
  active.markers = items;
  try {
    await waitFor(dt => {
      if (active?.deadline && G.t > active.deadline) return 'fail';
      let left = 0; let near = null, nd = 1e9;
      for (const it of items) { if (it.got) continue; it.m.rotation.y += dt * 3; const d = dist(it.p); if (d < 4) { it.got = true; it.m.visible = it.b.visible = false; sfx.coin(); } else { left++; if (d < nd) { nd = d; near = it.p; } } }
      objective(`${text} <b>${items.length - left}/${items.length}</b>`);
      if (near) setWaypoint(near.x, near.z); return left === 0 ? 'ok' : false;
    }).then(r => { if (r === 'fail') throw new Fail('Out of time!'); });
  } finally { for (const it of items) { scene.remove(it.m); scene.remove(it.b); } active && (active.markers = null); }
}
// chase a fleeing vehicle: stay within 9 m for a second (or ram it) to catch it
async function chase(v, text, hold = 1.0) {
  let t = 0;
  await waitFor(dt => {
    if (active?.deadline && G.t > active.deadline) return 'fail';
    setWaypoint(v.x, v.z); const d = Math.hypot(v.x - player.x, v.z - player.z);
    t = d < 9 ? t + dt : 0;
    objective(text + '<br><small>' + Math.round(d) + ' m away' + (d < 9 ? ' — stay close (or ram them)!' : '') + '</small>');
    return t >= hold || d < 4.5 ? 'ok' : false;
  }).then(r => { if (r === 'fail') { v.keep = false; v.ai.flee = false; v.ai.fast = 1; throw new Fail('They got away!'); } });
  v.ai.parked = true; v.ai.flee = false; v.speed = 0; v.keep = false;
}
// photo hunt: press P near each target
async function photos(targets, text) {
  const got = new Set();
  await waitFor(() => {
    if (active?.deadline && G.t > active.deadline) return 'fail';
    if (tapped('KeyP')) {
      sfx.shutter();
      const t = targets.find(t => !got.has(t.name) && t.near());
      if (t) { got.add(t.name); ui.toast('📸 ' + t.name, got.size + '/' + targets.length + ' photos', 1500); }
      else ui.toast('📸 Blurry photo of nothing', 'Get closer to something on the list', 1500);
    }
    const left = targets.filter(t => !got.has(t.name));
    objective(text + ': <b>' + got.size + '/' + targets.length + '</b> (press <b>P</b>)<br><small>Still need: ' + left.map(t => t.name).join(' · ') + '</small>');
    const ps = left.map(t => t.pos()).filter(Boolean).sort((a, b) => dist(a) - dist(b)); if (ps[0]) setWaypoint(ps[0].x, ps[0].z);
    return left.length ? false : 'ok';
  }).then(r => { if (r === 'fail') throw new Fail('Out of time!'); });
}
const near = (p, r) => () => p && Math.hypot(player.x - p.x, player.z - p.z) < r;
const reward = (money, karma = 0, msg = '') => { player.money += money; player.karma += karma; sfx.chime(); ui.toast(`✅ Mission complete! +$${money}`, msg, 3500); };

// ---------- story missions ----------
const P = (lat, lon) => XZ(lat, lon);
export const MISSIONS = [
  // ---- Kai ----
  { id: 'kai1', who: 'kai', title: 'Oat Milk Emergency', desc: 'A Gastown café ran out of oat milk. Civilisation is collapsing. Grab a carton from Granville Island and get it there fast.', start: P(49.2742, -123.1545),
    async run() {
      await talk('Barista Skye (on the phone)', 'Kai! We are OUT of oat milk. People are drinking DAIRY. Someone just cried. Get a carton from Granville Island Market and bring it to Gastown. You have 8 minutes. Bikes are faster than cars in this city, trust me.', ['On it!']);
      setDeadline(480);
      await goto(P(49.2712, -123.1342), 'Pick up the oat milk at <b>Granville Island Public Market</b>');
      ui.toast('🥛 Got the oat milk!', 'Now to Gastown, quickly!');
      await goto(P(49.2841, -123.1075), 'Deliver the oat milk to the café by the <b>Gastown Steam Clock</b>');
      reward(120, 1, 'The café crowd gives you a slow clap. Someone offers you kombucha.');
    } },
  { id: 'kai2', who: 'kai', title: 'Seawall Sprint', desc: 'Race around the Stanley Park seawall on a bike. Grab a bike from any Mobee bike-share station.', start: P(49.2925, -123.1260),
    async run() {
      await talk('Rival cyclist Chad', 'Bro. I did the seawall in like, 4 minutes on my $9,000 carbon bike. You on a share bike? LOL. Hit all the checkpoints. Bikes only. Go!', ['You\'re on, Chad']);
      if (!player.vehicle || !['bike', 'motorbike', 'scooter'].includes(player.vehicle.type)) await goto(player, 'Get on a <b>bike</b> (look for 🚲 on the map or a Mobee station)', { r: 9999, vehicle: ['bike', 'scooter'] });
      setDeadline(900);
      const cps = [[49.2985, -123.1185], [49.3020, -123.1240], [49.3110, -123.1375], [49.3060, -123.1530], [49.3000, -123.1580], [49.2930, -123.1505], [49.2870, -123.1430]];
      for (let i = 0; i < cps.length; i++) await goto(P(...cps[i]), `Seawall checkpoint <b>${i + 1}/${cps.length}</b> — on your bike!`, { r: 22, vehicle: ['bike', 'scooter'] });
      reward(200, 1, 'Chad is speechless. He\'s going to post about it anyway.');
    } },
  { id: 'kai3', who: 'kai', title: 'Goose Diplomacy', desc: 'The Stanley Park geese stole your sandwich. Get it back. They will not go quietly.', start: P(49.2955, -123.1380),
    async run() {
      await talk('Kai (thinking)', 'That goose took my vegan banh mi and LOOKED me in the eye. This is personal. The sandwich is near Lost Lagoon. Grab it and run!', ['Honk honk, it\'s on']);
      const sp = P(49.2950, -123.1395);
      for (const a of animals) if (a.kind === 'goose' && Math.hypot(a.x - sp.x, a.z - sp.z) < 200) { a.flock = { x: sp.x, z: sp.z }; }
      setDeadline(120);
      await collect([sp], 'box', 'Grab your sandwich');
      const from = { x: player.x, z: player.z }; setWaypoint(null);
      objective('RUN! Get <b>80 m</b> away from the geese');
      await waitFor(() => Math.hypot(player.x - from.x, player.z - from.z) > 80 ? 'ok' : (G.t > active.deadline ? 'fail' : false)).then(r => { if (r === 'fail') throw new Fail('The geese won.'); });
      reward(80, 0, 'You escaped with 70% of the sandwich. Victory.');
    } },
  // ---- Brenda ----
  { id: 'bre1', who: 'brenda', title: 'Open House Blitz', desc: 'Put OPEN HOUSE signs at four listings before the 2pm open houses. Driving recommended.', start: P(49.2748, -123.1218),
    async run() {
      await talk('Brenda', 'Four listings, four signs, five minutes. "Charming" means tiny, "character" means it leaks, and "close to transit" means there\'s a bus stop outside the bedroom. Let\'s sell some dreams!', ['Let\'s go!']);
      setDeadline(300);
      await collect([P(49.2790, -123.1300), P(49.2865, -123.1330), P(49.2820, -123.1200), P(49.2765, -123.1140)], 'sign', 'Place OPEN HOUSE signs');
      reward(250, -1, 'All four places got 40 offers each. Over asking. In cash.');
    } },
  { id: 'bre2', who: 'brenda', title: 'The 380 sq ft Dream', desc: 'Pick up a client at Waterfront Station and show them a "luxury micro-suite" in Yaletown.', start: P(49.2860, -123.1115),
    async run() {
      await talk('Client Gary', 'Hi Brenda! My budget is $1.4 million. I\'d like a 3-bedroom house with a yard, close to downtown?', ['Haha. Haha. Get in.']);
      setDeadline(240);
      await goto(P(49.2740, -123.1205), 'Drive Gary to the micro-suite in <b>Yaletown</b>');
      const c = await talk('Gary', 'This is… the whole condo? The bed folds into the fridge? Be honest with me, Brenda. Is this a good deal?', ['Be honest: "No, Gary. Rent for now."', 'Upsell: "It\'s an INVESTMENT, Gary."']);
      if (c === 0) reward(100, 3, 'Gary is grateful. You feel strange. Is this… integrity?'); else reward(400, -3, 'Gary signs. He will live in a fridge. You buy a boat.');
    } },
  { id: 'bre3', who: 'brenda', title: 'SOLD: Grouse Mountain', desc: 'A billionaire wants "a place with a view". Plant a SOLD sign on top of Grouse Mountain. A helicopter would help…', start: P(49.2869, -123.1050),
    async run() {
      await talk('Brenda', 'The client wants the top of Grouse Mountain. It\'s not for sale. Details! Take the helicopter at the waterfront heliport and plant the sign at the summit. 10 minutes.', ['Lift off!']);
      setDeadline(600);
      await goto({ ...SPOTS.grouse }, 'Plant the SOLD sign by the <b>Grouse Mountain chalet</b>', { r: 60 });
      addMesh(new THREE.BoxGeometry(3, 2, 0.15), std('#c53030', { emissive: '#400' }), SPOTS.grouse.x + 30, SPOTS.grouse.y + 2, SPOTS.grouse.z);
      reward(1000, -2, 'The grizzly bears were not consulted.');
    } },
  // ---- Dex ----
  { id: 'dex1', who: 'dex', title: 'Craft Services Run', desc: 'The director wants donuts. Six of them. Scattered across downtown, because film crews are chaos.', start: P(49.2843, -123.1078),
    async run() {
      await talk('Director Lars', 'Dex, darling, you\'re not in this scene. Your character died in the cold open. But we NEED donuts. Six. Four minutes. Go go go!', ['I\'m a trained actor!']);
      setDeadline(240);
      await collect([P(49.2850, -123.1120), P(49.2830, -123.1160), P(49.2815, -123.1100), P(49.2860, -123.1050), P(49.2800, -123.1135), P(49.2875, -123.1145)], 'donut', 'Grab donuts');
      reward(150, 0, 'Lars eats all six. You get a "thanks, buddy".');
    } },
  { id: 'dex2', who: 'dex', title: 'The Aerial Shot', desc: 'Fly the camera helicopter around BC Place, then UNDER the Lions Gate Bridge. Because cinema.', start: P(49.2869, -123.1050),
    async run() {
      await talk('Director Lars', 'We need a sweeping helicopter shot. Circle BC Place, then fly UNDER the Lions Gate Bridge. Our pilot quit, so… you\'re the pilot now. You have a license, right? Don\'t answer that.', ['Rolling!']);
      if (player.vehicle?.type !== 'heli') await goto({ x: player.x, z: player.z }, 'Get in the <b>helicopter</b> at the heliport (F)', { r: 99999, vehicle: ['heli'] });
      setDeadline(480);
      const bp = SPOTS.bcplace;
      await goto({ x: bp.x, z: bp.z }, 'Fly over <b>BC Place</b>', { r: 120, vehicle: ['heli'] });
      const lg = SPOTS.lionsgate || P(49.3155, -123.1385);
      await goto({ x: lg.x, z: lg.z }, 'Fly <b>UNDER</b> the Lions Gate Bridge deck!', { r: 60, vehicle: ['heli'], under: (lg.y || 60) - 6 });
      reward(500, 0, '"THAT\'S A WRAP!" — the shot goes viral. You\'re still not credited.');
    } },
  { id: 'dex3', who: 'dex', title: 'Paparazzi Panic', desc: 'Get from the film set to English Bay in the red sports car before the paparazzi catch you.', start: P(49.2841, -123.1080),
    async run() {
      await talk('Dex', 'Paparazzi! They think I\'m someone famous. I am NOT going to correct them. The red sports car is parked right here. English Bay, two and a half minutes!', ['Floor it']);
      setDeadline(150);
      if (player.vehicle?.type !== 'sports') await goto({ x: player.x, z: player.z }, 'Get in the <b>red sports car</b>', { r: 99999, vehicle: ['sports'] });
      await goto({ ...SPOTS.inukshuk }, 'Reach the <b>Inukshuk at English Bay</b>', { r: 30 });
      reward(220, 0, 'One photo gets out. The headline: "Who Is This Man?"');
    } },
  // ---- Mei ----
  { id: 'mei1', who: 'mei', title: 'Something\'s Off at Playland', desc: 'Fright Nights at Playland. The "actors" are a bit… too convincing. Film three of them up close.', start: P(49.2805, -123.0985),
    async run() {
      await talk('Mei', 'Hey besties, it\'s Mei! Today we\'re at Playland\'s Fright Nights where people say the zombie actors don\'t clock out. Smash that subscribe button. Let\'s go get footage!', ['Start recording']);
      await goto({ x: ZONE.x, z: ZONE.z }, 'Head to <b>Playland</b> on East Hastings', { r: 250 });
      let shots = 0, cool = 0;
      objective('Film zombies up close (within 8 m)');
      await waitFor(dt => { cool -= dt; const z = zombies.find(z => z.state !== 'dead' && Math.hypot(z.x - player.x, z.z - player.z) < 8); if (z && cool <= 0) { shots++; cool = 2; sfx.coin(); ui.toast(`📸 Footage ${shots}/3`, ''); } objective(`Film zombies up close: <b>${shots}/3</b> (hockey stick: click)`); return shots >= 3 ? 'ok' : false; });
      reward(120, 0, 'The footage gets 9 views. Three are your mom.');
    } },
  { id: 'mei2', who: 'mei', title: 'Hockey Stick Justice', desc: 'They\'re real. Grab your Canucks stick and take out 15 zombies before they reach the Hastings bus.', start: { x: ZONE.x - 260, z: ZONE.z - 30 },
    async run() {
      await talk('Mei', 'OK this is NOT a costume. Good thing I always carry a hockey stick. Very normal Vancouver thing. Click to swing!', ['Go Canucks Go!']);
      const k0 = zstats.kills;
      await waitFor(() => { objective(`Take out zombies: <b>${zstats.kills - k0}/15</b> (click to swing your stick)`); return zstats.kills - k0 >= 15 ? 'ok' : false; });
      reward(300, 2, 'Livestream peaks at 4.2 million viewers. Sponsors are calling.');
    } },
  { id: 'mei3', who: 'mei', title: 'Patient Zero', desc: 'Find the Zombie King by the Ferris wheel and end this.', start: { x: ZONE.x - 120, z: ZONE.z + 60 },
    async run() {
      const k = spawnZombie(SPOTS.playland.x + 5, SPOTS.playland.z + 12); k.keep = true; k.cols.shirt = '#d4a017'; k.speed = 1.8; say(k, 'I AM THE ZOMBIE KING!', 4000, 'zombie');
      const before = zstats.kills;
      await goto({ x: k.x, z: k.z }, 'Find the <b>Zombie King</b> by the Ferris wheel', { r: 30 });
      await waitFor(() => { objective('Defeat the <b>Zombie King</b> (golden shirt)'); return k.state === 'dead' ? 'ok' : false; });
      await talk('The "Zombie King"', 'OW! OK OK! I\'m not a zombie, I\'m Todd from marketing! The others are real though. Probably. Please don\'t put this on YouTube.', ['Already uploaded, Todd.']);
      reward(500, 1, 'The video goes viral. You are now a Vancouver legend.');
    } },
  // ---- Stage 2: Sea-to-Sky ----
  { id: 'kai4', who: 'kai', title: 'Valley Trail Dash', desc: 'A Whistler bakery needs its sourdough at Green Lake. Bike the Valley Trail before it goes stale.', start: P(50.1160, -122.9535),
    async run() {
      await talk('Baker Jean-Luc', 'Kai! My sourdough must reach the Green Lake float-plane dock in seven minutes or it becomes… regular bread. Take a bike. Allez!', ['Oui chef!']);
      if (!player.vehicle || !['bike', 'scooter', 'motorbike'].includes(player.vehicle.type)) await goto({ x: player.x, z: player.z }, 'Grab a <b>bike</b> (there are some by the village)', { r: 1e6, vehicle: ['bike', 'scooter', 'motorbike'] });
      setDeadline(420);
      await goto({ ...SPOTS.greenlake }, 'Deliver the sourdough to <b>Green Lake</b>', { r: 60 });
      reward(220, 1, 'The bread is still warm. A floatplane pilot weeps with joy.');
    } },
  { id: 'bre4', who: 'brenda', title: 'The $14 Million Chalet', desc: 'Drive a tech billionaire from Whistler Village to a "cozy" lakefront chalet on Alta Lake.', start: P(50.1170, -122.9520),
    async run() {
      await talk('Billionaire Skyler', 'I need a ski chalet. Something modest. 9 bedrooms, a hot tub, and a hot tub for the hot tub. Show me something on Alta Lake.', ['Right this way!']);
      setDeadline(300);
      await goto({ ...SPOTS.altalake }, 'Drive Skyler to the chalet on <b>Alta Lake</b>', { r: 150 });
      const c = await talk('Skyler', "It's perfect. But will I actually use it? I'm only here two weekends a year.", ['Be honest: "Rent it out to locals."', 'Upsell: "Buy TWO, Skyler."']);
      if (c === 0) reward(300, 4, 'Skyler rents it to ski instructors at a fair price. Whistler locals cheer.'); else reward(1400, -4, 'Skyler buys two. Both sit empty. You buy a slightly bigger boat.');
    } },
  { id: 'dex4', who: 'dex', title: 'Powder Stunt Double', desc: "The star won't ski. You will. Shred 300 m of vertical on Whistler Mountain in 3 minutes for the movie.", start: P(50.0640, -122.9480),
    async run() {
      await talk('Director Lars', "Dex, darling, the star \"pulled a hamstring\" (he's in the hot tub). Put on skis (K) or a board (B) and drop 300 metres. Cameras are rolling!", ['Action!']);
      setDeadline(180);
      let top = null;
      await waitFor(() => { if (G.t > active.deadline) return 'fail'; if (!player.board) { top = null; objective('Press <b>K</b> for skis or <b>B</b> for a snowboard'); return false; } if (top === null) top = player.y; const d = top - player.y; objective('Shred! Vertical: <b>' + Math.max(0, Math.round(d)) + '/300 m</b>'); return d >= 300 ? 'ok' : false; }).then(r => { if (r === 'fail') throw new Fail('Out of time! The star is back from the hot tub.'); });
      reward(450, 0, "Perfect take. The poster has the star's face photoshopped onto your body.");
    } },
  { id: 'mei4', who: 'mei', title: 'Ghosts of Britannia Mine', desc: 'Something is moaning inside the old Britannia copper mine. Investigate. Bring your stick.', start: P(49.6215, -123.2010),
    async run() {
      await talk('Mei', "Hey besties! We're at the Britannia Mine on the Sea-to-Sky. Old miners say you can still hear them at night… OK that was definitely a groan.", ['Roll camera']);
      const b = SPOTS.britannia; const ghosts = [];
      for (let i = 0; i < 8; i++) { const z = spawnZombie(b.x + R(-30, 30), b.z + R(-30, 30)); z.keep = true; z.cols.shirt = '#d4a017'; z.cols.pants = '#3a3a30'; ghosts.push(z); }
      await waitFor(() => { const left = ghosts.filter(g => g.state !== 'dead').length; objective('Defeat the mine "ghosts": <b>' + (8 - left) + '/8</b> (click to swing)'); setWaypoint(b.x, b.z); return left === 0 ? 'ok' : false; });
      await talk('Museum volunteer Doug', "Ow! OW! We're the Britannia Mine zombie walk! It's a fundraiser! …The real one is still inside, though. We don't talk about him.", ['…nope. Leaving.']);
      reward(400, 1, 'Episode title: "I FOUGHT 8 MINE GHOSTS (they were volunteers)". 2 million views.');
    } },
  // ---- Stage 3: YVR airport ----
  { id: 'kai5', who: 'kai', title: 'Passport Panic', desc: 'Your roommate flew out of YVR without his passport. Of course he did. Get it to the terminal in 9 minutes.', start: P(49.2742, -123.1545),
    async run() {
      await talk('Roommate Tyler (calling from the gate)', 'Bro. BRO. I left my passport on the couch. My flight to Cancún boards in 9 minutes. You\'re the fastest guy I know. Also I ate your leftovers.', ['Ugh. Fine.']);
      setDeadline(540);
      await goto(P(49.1952, -123.1770), 'Rush the passport to the <b>YVR main terminal</b>', { r: 70 });
      reward(200, 1, 'Tyler makes the flight. He sends you a photo of a beach. Rude.');
    } },
  { id: 'bre5', who: 'brenda', title: 'Sky-High Listings', desc: 'Show a client three West Vancouver mansions — from the air. Fly a Cessna from the YVR South Terminal over each one.', start: P(49.1874, -123.1715),
    async run() {
      await talk('Brenda', 'My client only buys houses she can see from a plane. Normal. Take a Cessna from the South Terminal and fly over the three British Properties listings.', ['Ready for take-off']);
      if (player.vehicle?.type !== 'cessna') await goto({ x: player.x, z: player.z }, 'Get in a <b>Cessna</b> at the South Terminal (F)', { r: 1e6, vehicle: ['cessna'] });
      setDeadline(900);
      const homes = [[49.3550, -123.1450], [49.3480, -123.1750], [49.3620, -123.1900]];
      for (let i = 0; i < 3; i++) await goto(P(...homes[i]), 'Fly over listing <b>' + (i + 1) + '/3</b> in West Vancouver', { r: 300, vehicle: ['cessna'] });
      reward(900, -1, 'She buys all three. She will visit them once. By helicopter.');
    } },
  { id: 'dex5', who: 'dex', title: 'Red Carpet Arrival', desc: 'A Hollywood star lands at YVR. Pick them up at the terminal and get them to the Orpheum premiere in 11 minutes.', start: P(49.1952, -123.1770),
    async run() {
      await talk('Star (sunglasses indoors)', 'Darling! I need to be at the Orpheum in eleven minutes. The red carpet waits for no one. Is this your car? It smells like donuts.', ['It\'s craft services, sir.']);
      if (!player.vehicle || player.vehicle.d.kind !== 'road') await goto({ x: player.x, z: player.z }, 'Get any <b>car</b> (F) — "borrow" one if you have to', { r: 1e6, vehicle: ['car', 'taxi', 'sports', 'suv', 'van', 'bus', 'motorbike'] });
      setDeadline(660);
      await goto(P(49.2801, -123.1206), 'Drive the star to the <b>Orpheum Theatre</b> on Granville Street', { r: 40 });
      reward(500, 0, 'The star thanks you on the carpet. Cameras flash. They call you "Kevin".');
    } },
  { id: 'mei5', who: 'mei', title: 'Flight 1313', desc: 'An empty plane arrived at YVR with no passengers. Just… groaning. Investigate the south apron.', start: P(49.1880, -123.1720),
    async run() {
      await talk('Mei', 'Besties, a flight landed at YVR with NOBODY on it. Except, apparently, the zombies. This is fine. Get the stick.', ['Livestream: ON']);
      const c = P(49.1872, -123.1700), crew = [];
      for (let i = 0; i < 10; i++) { const z = spawnZombie(c.x + R(-40, 40), c.z + R(-40, 40)); z.keep = true; z.cols.shirt = '#1f4e8c'; crew.push(z); }
      await waitFor(() => { const left = crew.filter(g => g.state !== 'dead').length; objective('Stop the zombie flight crew: <b>' + (10 - left) + '/10</b>'); setWaypoint(c.x, c.z); return left === 0 ? 'ok' : false; });
      await talk('Flight attendant (recovering)', 'Ugh… what happened? Last thing I remember, someone served the "mystery chicken" on the red-eye from Toronto…', ['Never eat the chicken.']);
      reward(600, 2, 'Air Canuck gives you free flights for life. In the middle seat.');
    } },
  // ---- Stage 9: finales ----
  { id: 'kai6', who: 'kai', title: 'The Wedding Cake', desc: 'FINALE: deliver a five-tier wedding cake by bike from Granville Island to the Stanley Park Pavilion. Bump into things more than twice and it\'s over.', start: P(49.2712, -123.1342),
    async run() {
      await talk('Very stressed bride', 'Kai, my baker\'s van broke down. You\'re the best bike courier in Vancouver. The cake is five tiers. Lemon-lavender. Do NOT bump into anything. The ceremony starts in seven minutes.', ['Gently. Got it.']);
      if (!player.vehicle || !['bike', 'scooter'].includes(player.vehicle.type)) await goto({ x: player.x, z: player.z }, 'Grab a <b>bike</b> (cake strapped to the back)', { r: 1e6, vehicle: ['bike', 'scooter'] });
      setDeadline(420); const b0 = player.stats.bumps || 0;
      const pav = P(49.2975, -123.1360);
      await waitFor(() => {
        const bumps = (player.stats.bumps || 0) - b0; if (bumps > 2) return 'smash'; if (G.t > active.deadline) return 'fail';
        setWaypoint(pav.x, pav.z); objective('Deliver the cake to the <b>Stanley Park Pavilion</b><br>🎂 Cake health: <b>' + ['💯', '🙂', '😬'][bumps] + '</b> (' + (2 - bumps) + ' bumps left)');
        return dist(pav) < 25 ? 'ok' : false;
      }).then(r => { if (r === 'smash') throw new Fail('The cake is now a pancake. The bride is crying. So are you.'); if (r === 'fail') throw new Fail('The ceremony started without cake!'); });
      await talk('The bride', 'It\'s PERFECT! You\'re invited! Sit at table 9, next to my uncle who talks about crypto.', ['Congratulations! 🎉']);
      reward(600, 3, '🏆 Kai\'s story complete! Best courier in Vancouver. The seawall knows your name.');
    } },
  { id: 'bre6', who: 'brenda', title: 'Contract Chase', desc: 'FINALE: your arch-rival realtor Chad Huckster stole the signed contract for a $9 million penthouse. Chase down his sports car!', start: P(49.2745, -123.1210),
    async run() {
      await talk('Brenda', 'CHAD. HUCKSTER. He grabbed my signed contract and jumped in his Lamborghini-ish sports car! Get a car. Any car. That commission is MINE.', ['After him!']);
      if (!player.vehicle || player.vehicle.d.kind !== 'road') await goto({ x: player.x, z: player.z }, 'Get in any <b>car or motorbike</b> (F)', { r: 1e6, vehicle: ['car', 'taxi', 'sports', 'suv', 'van', 'motorbike', 'bus'] });
      const chad = makeRunner('sports', player.x + 60, player.z + 60, 1.4); if (!chad) throw new Fail('Chad vanished. Suspicious.');
      say({ x: chad.x, z: chad.z, y: chad.y }, 'Catch me if you can, Brenda!');
      setDeadline(240);
      await chase(chad, 'Catch <b>Chad Huckster</b>\'s sports car!');
      await talk('Chad Huckster', 'Fine! FINE! Here\'s your contract. You know you have a 400-bus-bench advantage, Brenda.', ['400 and counting, Chad.']);
      reward(1500, 1, '🏆 Brenda\'s story complete! Vancouver\'s #1 realtor. Your face is now on 500 bus benches.');
    } },
  { id: 'dex6', who: 'dex', title: 'The Poster Shoot', desc: 'FINALE: your first starring role! Photograph four Vancouver landmarks for the movie poster, then get to the premiere at the Orpheum.', start: P(49.2836, -123.1066),
    async run() {
      await talk('Director Lars', 'Dex, darling, you got the LEAD. The poster needs Vancouver: Lions Gate, Science World, Canada Place, Harbour Centre. Snap them all with P, then come to the Orpheum. Fifteen minutes!', ['I was born for this.']);
      setDeadline(900);
      await photos([
        { name: 'Lions Gate Bridge', near: near(SPOTS.lionsgate, 300), pos: () => SPOTS.lionsgate },
        { name: 'Science World', near: near(SPOTS.science, 200), pos: () => SPOTS.science },
        { name: 'Canada Place', near: near(SPOTS.canada, 200), pos: () => SPOTS.canada },
        { name: 'Harbour Centre', near: near(SPOTS.harbour, 200), pos: () => SPOTS.harbour },
      ], 'Photograph landmarks for the poster');
      await goto(P(49.2801, -123.1206), 'Get to the premiere at the <b>Orpheum</b>', { r: 40 });
      reward(1200, 1, '🏆 Dex\'s story complete! Standing ovation. Your name is finally in the credits. Spelled right!');
    } },
  { id: 'mei6', who: 'mei', title: 'The Last Stream', desc: 'FINALE: the zombies have reached downtown. Hold the line at Waterfront Station, live, for the whole internet.', start: P(49.2846, -123.1130),
    async run() {
      await talk('Mei', 'Besties… this is it. The zombies followed me downtown. Two million of you are watching. Waterfront Station is where it ends. Stick ready. Go Canucks.', ['GO LIVE']);
      G.hour = 22; const c = P(49.2857, -123.1116), horde = [];
      for (let i = 0; i < 20; i++) { const a = Math.random() * 6.28, r = 20 + Math.random() * 50; const z = spawnZombie(c.x + Math.cos(a) * r, c.z + Math.sin(a) * r); z.keep = true; z.speed = 1.6; horde.push(z); }
      await waitFor(() => { const left = horde.filter(z => z.state !== 'dead').length; objective('Hold the line at <b>Waterfront Station</b>: <b>' + (20 - left) + '/20</b> zombies stopped'); setWaypoint(c.x, c.z); return left === 0 ? 'ok' : false; });
      await talk('Mei (to camera)', 'We… did it. Chat is going absolutely feral. Thank you to my 312 original subscribers. And to my sponsor, Raincouver Umbrellas. Use code MEI for 10% off.', ['Signing off. 💜']);
      reward(1500, 2, '🏆 Mei\'s story complete! 10 million subscribers. The zombies have their own fan page now.');
    } },
];

// ---------- side jobs (anyone) ----------
export const SIDE = [
  { id: 'chill', title: 'Dude, Chill', desc: 'Sit on the bench at Dude Chilling Park and do absolutely nothing for 15 seconds.', start: () => SPOTS.dude.bench,
    async run() {
      await talk('A very relaxed dude', 'Duuude. This park is literally named after chilling. Sit on that bench. Don\'t move. Don\'t check your phone. Just… be.', ['Maximum chill']);
      let t = 0; const b = SPOTS.dude.bench;
      await waitFor(dt => {
        const sitting = Math.hypot(player.x - b.x, player.z - b.z) < 2 && !player.vehicle;
        const moving = ['KeyW', 'KeyA', 'KeyS', 'KeyD'].some(k => key(k));
        if (sitting && !moving) { t += dt; player.model.st.kind = 'sit'; } else t = Math.max(0, t - dt * 2);
        objective(sitting ? `Chilling… <b>${Math.floor(t)}/15</b> s (don't move!)` : 'Sit on the bench (walk to it, then don\'t move)'); setWaypoint(b.x, b.z);
        return t >= 15 ? 'ok' : false;
      });
      reward(50, 2, '😎 Achievement: Maximum Chill. Your blood pressure dropped 20 points.');
    } },
  { id: 'polar', title: 'Polar Bear Swim', desc: 'A Vancouver New Year\'s tradition: swim in English Bay for 20 seconds. Brrr.', start: () => XZ(49.2862, -123.1432),
    async run() {
      await talk('Lifeguard', 'Water\'s a refreshing 8 degrees today! Get in and swim for 20 seconds. Bonus points for screaming.', ['AAAAAAH']);
      let t = 0; await waitFor(dt => { if (player.swimming) t += dt; objective(`Swim in English Bay: <b>${Math.floor(t)}/20</b> s`); return t >= 20 ? 'ok' : false; });
      reward(60, 1, '🥶 You can no longer feel your toes. Worth it.');
    } },
  { id: 'taxi', title: 'Taxi Hustle', desc: 'Grab any taxi and drive three fares across town.', start: () => XZ(49.2858, -123.1118),
    async run() {
      await talk('Dispatch', 'We\'ve got more fares than drivers! Find a yellow taxi (they drive around everywhere), then take three fares. Tips depend on speed!', ['Taxi!']);
      if (player.vehicle?.type !== 'taxi') await goto({ x: player.x, z: player.z }, 'Hop into a <b>yellow taxi</b> (F next to one; traffic taxis count)', { r: 1e6, vehicle: ['taxi'] });
      const stops = [[49.2768, -123.1120, 'BC Place'], [49.2830, -123.1215, 'Vancouver Art Gallery'], [49.2712, -123.1342, 'Granville Island'], [49.2860, -123.1415, 'English Bay'], [49.2795, -123.1010, 'Chinatown'], [49.2635, -123.0960, 'Mount Pleasant']];
      let total = 0;
      for (let i = 0; i < 3; i++) { const s = pick(stops); const t0 = G.t; await goto(P(s[0], s[1]), `Fare ${i + 1}/3: take the passenger to <b>${s[2]}</b>`, { r: 25, vehicle: ['taxi'] }); const fare = Math.max(15, Math.round(80 - (G.t - t0))); total += fare; sfx.coin(); ui.toast(`🚕 Fare: $${fare}`, pick(['"Keep the change!"', '"You drive like my uncle in Richmond."', '"Five stars, eh!"'])); }
      reward(total, 0, 'Not bad for a side hustle.');
    } },
  { id: 'orca', title: 'Orca Spotting', desc: 'Get within 40 m of an orca. Jet skis are at Coal Harbour, Granville Island and English Bay.', start: () => XZ(49.2928, -123.1300),
    async run() {
      await talk('Whale-watching guide', 'A pod of orcas is out today! Get close — but respectfully. Use a jet ski or the seaplane.', ['🐋 Let\'s go']);
      await waitFor(() => { const o = nearestAnimal('orca', player.x, player.z, 40); const n = nearestAnimal('orca', player.x, player.z, 1e6); if (n) setWaypoint(n.x, n.z); objective('Find an <b>orca</b> (they swim in English Bay and Burrard Inlet)'); return o ? 'ok' : false; });
      reward(150, 2, '🐋 The orca looks at you. You feel seen. Life-changing.');
    } },
  { id: 'shred', title: 'Summit Shred', desc: 'Snowboard 200 m of vertical down from the top of Grouse Mountain.', start: () => SPOTS.grouse,
    async run() {
      await talk('Ski patrol', 'Fresh powder up top! Press B on the snow to strap on a board. Drop 200 vertical metres without taking it off.', ['Send it!']);
      let top = null;
      await waitFor(() => { if (!player.board) { top = null; objective('Press <b>B</b> on snow to snowboard, then ride downhill'); return false; } if (top === null) top = player.y; const drop = top - player.y; objective(`Shred! Vertical drop: <b>${Math.max(0, Math.round(drop))}/200 m</b>`); return drop >= 200 ? 'ok' : false; });
      reward(200, 0, '🏂 Sick run. A guy in a GoPro helmet says "rad".');
    } },
  { id: 'raccoon', title: 'Raccoon Heist', desc: 'A raccoon stole a tourist\'s phone in Chinatown. Catch the little bandit.', start: () => XZ(49.2797, -123.1012),
    async run() {
      await talk('Panicked tourist', 'A RACCOON took my phone! It was wearing a little mask! Like a real bandit! Please catch it!', ['On it']);
      const rc = animals.filter(a => a.kind === 'raccoon').sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z))[0];
      setDeadline(150);
      await waitFor(() => { if (G.t > active.deadline) return 'fail'; setWaypoint(rc.x, rc.z); objective('Catch the <b>raccoon</b>! (run into it)'); return Math.hypot(rc.x - player.x, rc.z - player.z) < 1.6 ? 'ok' : false; }).then(r => { if (r === 'fail') throw new Fail('The raccoon got away. It\'s posting selfies now.'); });
      reward(90, 2, '🦝 The phone has 400 new raccoon selfies on it.');
    } },
  { id: 'dunk', title: 'Scooter Dunk', desc: 'A shady guy will pay you to ride a Lyme scooter off the seawall into False Creek. This is bad. Very bad.', start: () => XZ(49.2725, -123.1240),
    async run() {
      const c = await talk('Shady guy in a Canada Goose jacket', 'Psst. Twenty bucks if you ride one of those Lyme scooters off the seawall into False Creek. For "content".', ['Do it (bad karma)', 'No way']);
      if (c === 1) { player.karma += 1; ui.toast('😇 Good choice', 'The scooter lives to scoot another day'); return; }
      await waitFor(() => { objective('Ride a <b>Lyme scooter</b> into False Creek'); return player.stats.dunked ? 'ok' : false; });
      reward(20, -3, '😈 The scooter is now a reef. The fish are confused.');
    } },
  { id: 'grind', title: 'The Grouse Grind', desc: '"Mother Nature\'s Stairmaster". Hike from the base to the summit on foot in under 15 minutes.', start: () => XZ(49.3713, -123.0990),
    async run() {
      await talk('Very fit person in Lululime leggings', 'The Grind is 2,830 steps straight up. My personal best is 31 minutes, BTW. On foot only — no helicopters, Brenda.', ['Let\'s grind']);
      setDeadline(900);
      await goto({ ...SPOTS.grouse }, 'Hike to the <b>Grouse summit chalet</b> ON FOOT', { r: 70 });
      if (player.vehicle) throw new Fail('That was not on foot!');
      reward(250, 1, '🥵 You did the Grind! You will now mention this in every conversation.');
    } },
  { id: 'lion', title: 'Lion Tamer', desc: 'Reach the summit of the West Lion, the famous twin peaks above the city.', start: () => XZ(49.3960, -123.2040),
    async run() {
      await talk('Hiker', 'The Lions! Two big rocky peaks you can see from all over Vancouver. Get to the top of the West Lion. Bring snacks.', ['Onwards!']);
      await goto({ ...SPOTS.westlion }, 'Reach the summit flag of <b>The West Lion</b>', { r: 50 });
      reward(400, 1, '🦁 You can see Vancouver Island from here. And your apartment. It\'s tiny.');
    } },
  { id: 'sprint', title: 'Sea-to-Sky Sprint', desc: 'Drive the famous Sea-to-Sky Highway from Horseshoe Bay to the Stawamus Chief in under 25 minutes.', start: () => XZ(49.3770, -123.2700),
    async run() {
      await talk('Road-trip buddy', 'Sea-to-Sky Highway! Ocean on one side, mountains on the other. Get us to the Chief in Squamish. Grab any car — the faster the better.', ['Road trip!']);
      if (!player.vehicle || player.vehicle.d.kind !== 'road') await goto({ x: player.x, z: player.z }, 'Get in any <b>car or motorbike</b> (F)', { r: 1e6, vehicle: ['car', 'taxi', 'sports', 'suv', 'van', 'motorbike', 'bus'] });
      setDeadline(1500);
      await goto(P(49.6560, -123.1570), 'Follow the <b>Sea-to-Sky Highway</b> north past Britannia Beach', { r: 200 });
      await goto({ ...SPOTS.chiefbase }, 'Park at the <b>Stawamus Chief</b> trailhead', { r: 120 });
      reward(350, 0, '🏔️ That view never gets old. Your playlist was perfect.');
    } },
  { id: 'chiefhike', title: 'Top of the Chief', desc: "Hike from the trailhead to the summit of the Stawamus Chief on foot. It's steep. Like, ladders-and-chains steep.", start: () => SPOTS.chiefbase,
    async run() {
      await talk('Climber with a chalk bag', "Chief's a big granite wall — climbers come from all over the world. You're hiking the back side, though. On foot! No helicopters, Brenda.", ['Up we go']);
      setDeadline(1200);
      await goto({ ...SPOTS.chief }, 'Hike to the <b>Chief summit</b> ON FOOT', { r: 60 });
      if (player.vehicle) throw new Fail('That was not on foot!');
      reward(280, 1, '🧗 The view over Howe Sound is unreal. You eat a squished granola bar like a king.');
    } },
  { id: 'p2p', title: 'Peak to Peak', desc: 'Ride the record-breaking Peak 2 Peak Gondola between Whistler and Blackcomb mountains.', start: () => SPOTS.roundhouse,
    async run() {
      await talk('Lift operator', 'The Peak 2 Peak! 4.4 km long, 436 m above the valley floor at its highest. Hop on at the station and ride it all the way across.', ["Let's ride"]);
      player.stats.p2p = false;
      await waitFor(() => { objective('Find the <b>Peak 2 Peak</b> station and press <b>E</b> to ride it end to end'); return player.stats.p2p ? 'ok' : false; });
      reward(200, 1, '🚡 You looked down through the glass floor. Your stomach is still up there.');
    } },
  { id: 'powder', title: 'Whistler Powder Day', desc: 'Ski or snowboard 600 m of vertical without taking them off. Start up at the Roundhouse.', start: () => SPOTS.roundhouse,
    async run() {
      await talk('Ski instructor Sven', "Powder day! Nobody is working today. Press K for skis or B for a board, point it downhill and don't stop for 600 vertical metres.", ['Send it!']);
      let top = null;
      await waitFor(() => { if (!player.board) { top = null; objective('Press <b>K</b> (skis) or <b>B</b> (board) on the snow'); return false; } if (top === null) top = player.y; const d = top - player.y; objective('Vertical drop: <b>' + Math.max(0, Math.round(d)) + '/600 m</b>'); return d >= 600 ? 'ok' : false; });
      reward(350, 0, '❄️ Legendary run. Now for the most important part: après.');
    } },
  { id: 'floatplane', title: 'Floatplane Getaway', desc: 'Fly a seaplane from Coal Harbour all the way to Whistler and land on Green Lake.', start: () => XZ(49.2915, -123.1185),
    async run() {
      await talk('Harbour Err pilot', 'Downtown to Whistler in 30 minutes instead of 2 hours of traffic! Take a plane, fly north up Howe Sound, and land on Green Lake. Gently. Please.', ['Clear for take-off']);
      if (player.vehicle?.type !== 'seaplane') await goto({ x: player.x, z: player.z }, 'Get in a <b>seaplane</b> (F)', { r: 1e6, vehicle: ['seaplane'] });
      await goto({ ...SPOTS.greenlake }, 'Fly to <b>Green Lake</b> (north of Whistler) and land on the water', { r: 400, vehicle: ['seaplane'] });
      await waitFor(() => { objective('Land on <b>Green Lake</b> and slow down'); return player.vehicle?.type === 'seaplane' && player.vehicle.y < waterLevel(player.x, player.z) + 1 && player.vehicle.speedAbs < 12 ? 'ok' : false; });
      reward(500, 0, '🛩️ Smooth landing. A loon gives you a nod of respect.');
    } },
  { id: 'flightschool', title: 'Flight School', desc: 'Take off in a Cessna from the YVR South Terminal, fly over the Iona Beach jetty, then come back and land on a runway.', start: () => XZ(49.1874, -123.1715),
    async run() {
      await talk('Instructor Barb', 'Welcome to flight school! Hold W for throttle, roll down the runway, and pull up with Space once you\'re past 85 km/h. Fly over the Iona jetty, then land back here. Gently. I have a mortgage.', ['Roger that']);
      if (player.vehicle?.type !== 'cessna') await goto({ x: player.x, z: player.z }, 'Get in a <b>Cessna</b> (F)', { r: 1e6, vehicle: ['cessna'] });
      await waitFor(() => { objective('Take off! (W for throttle, Space to pull up)'); return player.flying ? 'ok' : false; });
      await goto({ ...SPOTS.iona }, 'Fly over the <b>Iona Beach jetty</b>', { r: 350, vehicle: ['cessna'] });
      await waitFor(() => { const v = player.vehicle; const ap = SPOTS.yvr; setWaypoint(ap.x, ap.z); objective('Land on a <b>YVR runway</b> and stop (S = brakes)'); return v?.type === 'cessna' && !player.flying && v.speedAbs < 2 && !v.crashed && Math.hypot(v.x - ap.x, v.z - ap.z) < 3500 ? 'ok' : false; });
      reward(400, 1, '🛬 Barb unclenches. "That was… a landing!" You earn your wings (sticker).');
    } },
  { id: 'skydive', title: 'Skydive English Bay', desc: 'Climb above 1000 m in any plane or helicopter, jump out (F), and parachute onto English Bay Beach.', start: () => XZ(49.1874, -123.1715),
    async run() {
      await talk('Skydive bro Brayden', 'Dude. Get above 1,000 metres, press F to jump out, and land on English Bay Beach. The parachute opens automatically. Probably.', ['Probably?!']);
      await waitFor(() => { objective('Climb above <b>1000 m</b> in a plane or helicopter (now ' + Math.round(player.y) + ' m)'); return player.vehicle && player.y > 1000 && (player.vehicle.d.kind === 'plane' || player.vehicle.d.kind === 'heli') ? 'ok' : false; });
      const eb = SPOTS.englishbay;
      await waitFor(() => { setWaypoint(eb.x, eb.z); objective('Fly over English Bay and <b>jump out (F)</b>'); return !player.vehicle && player.chute ? 'ok' : false; });
      await waitFor(() => { objective('Steer your parachute to <b>English Bay Beach</b> (WASD)'); return !player.chute && !player.vehicle ? 'ok' : false; });
      if (Math.hypot(player.x - eb.x, player.z - eb.z) > 250) throw new Fail('You landed ' + Math.round(Math.hypot(player.x - eb.x, player.z - eb.z)) + ' m from the beach. A seagull laughs at you.');
      reward(500, 0, '🪂 Perfect landing! Sunbathers clap. One of them is Brayden\'s mom.');
    } },
  { id: 'luggage', title: 'Lost Luggage', desc: 'Drive the baggage tug around the YVR apron and collect 6 lost suitcases in 4 minutes.', start: () => XZ(49.1958, -123.1760),
    async run() {
      await talk('Baggage supervisor', 'Six bags fell off the cart. One of them is "making noises". Use the yellow tug, grab them all, four minutes. Don\'t hit any planes. Those are expensive.', ['On it']);
      setDeadline(240);
      const c = XZ(49.1960, -123.1810), pts = []; for (let i = 0; i < 6; i++) pts.push({ x: c.x + R(-250, 250), z: c.z + R(-180, 180) });
      await collect(pts, 'box', 'Collect lost luggage');
      reward(180, 1, 'The noisy bag was full of maple syrup and a confused cat. Both returned safely.');
    } },
  { id: 'jumbo', title: 'Air Canuck Joyride', desc: 'Borrow a parked airliner, take off, and fly over the Lions above 1,800 m. The passengers wanted a view.', start: () => XZ(49.1972, -123.1825),
    async run() {
      await talk('Very calm pilot', 'I\'m on my lunch break. The passengers want to see the Lions. Planes are parked at the gates. Please bring it back. Or don\'t. It\'s Friday.', ['Uh… OK!']);
      if (!player.vehicle || !['jet', 'jumbo'].includes(player.vehicle.type)) await goto({ x: player.x, z: player.z }, 'Get in an <b>airliner</b> at the gates (F)', { r: 1e6, vehicle: ['jet', 'jumbo'] });
      const wl = SPOTS.westlion;
      await waitFor(() => { setWaypoint(wl.x, wl.z); const d = Math.hypot(player.x - wl.x, player.z - wl.z); objective('Fly over <b>the Lions</b> above 1,800 m (now ' + Math.round(player.y) + ' m, ' + (d / 1000).toFixed(1) + ' km away)'); return ['jet', 'jumbo'].includes(player.vehicle?.type) && d < 2000 && player.y > 1800 ? 'ok' : false; });
      reward(800, -2, '✈️ "Ladies and gentlemen, on your left: the Lions. On your right: our insurance premiums."');
    } },
  { id: 'planespot', title: 'Planespotting', desc: 'Relax at Larry Berg Flight Path Park and watch the jets land right over your head for 30 seconds.', start: () => SPOTS.planespot,
    async run() {
      await talk('Retired planespotter Gord', 'This is the best spot in the city. Planes come in so low you can read the tires. Sit with me for thirty seconds. That\'s an A321, by the way. Of course it is.', ['Wow, Gord']);
      let t = 0; const p = SPOTS.planespot;
      await waitFor(dt => { const near = Math.hypot(player.x - p.x, player.z - p.z) < 40 && !player.vehicle; if (near) t += dt; objective(near ? 'Planespotting… <b>' + Math.floor(t) + '/30</b> s' : 'Stay near Gord at the park'); return t >= 30 ? 'ok' : false; });
      reward(80, 2, '🛬 Gord gives you his spare binoculars. You are now a planespotter. There is no going back.');
    } },
  { id: 'nextstopyvr', title: 'Next Stop: YVR', desc: 'Ride the Canada Line SkyTrain from Waterfront Station all the way to YVR–Airport.', start: () => XZ(49.2851, -123.1100),
    async run() {
      await talk('Lost tourist with three suitcases', 'Excuse me, is this the train to the airport? I have a flight in 40 minutes. Can you ride with me? I don\'t trust robots that drive trains.', ['Sure, hop on']);
      player.stats.lastStop = null;
      await waitFor(() => { objective('Press <b>E</b> at the Waterfront station and take the <b>Canada Line → YVR–Airport</b>'); return player.stats.lastStop === 'YVR–Airport' ? 'ok' : false; });
      reward(120, 2, '✈️ The tourist makes the flight and gives you a maple cookie. It\'s from Toronto. You eat it anyway.');
    } },
  { id: 'seabusrun', title: 'SeaBus Lunch Run', desc: 'Take the SeaBus across Burrard Inlet to Lonsdale Quay for fish and chips.', start: () => XZ(49.2862, -123.1093),
    async run() {
      await talk('Hungry coworker', 'The best fish and chips are at Lonsdale Quay. Take the SeaBus, it\'s like a ferry but with fewer seagulls. Bring me back extra tartar sauce.', ['On it']);
      player.stats.lastStop = null;
      await waitFor(() => { objective('Take the <b>SeaBus</b> to <b>Lonsdale Quay</b> (E at the terminal)'); return player.stats.lastStop === 'Lonsdale Quay' && player.stats.lastLine === 'seabus' ? 'ok' : false; });
      reward(90, 1, '🐟 Lunch acquired. A seagull steals one fry. You let it go. It\'s their city too.');
    } },
  { id: 'transitpro', title: 'Transit Nerd', desc: 'Ride the Expo Line, Millennium Line, Canada Line AND the SeaBus. All of them. For the badge.', start: () => XZ(49.2620, -123.0678),
    async run() {
      await talk('Transit nerd with a lanyard', 'Did you know the Expo Line opened for Expo 86? Of course you did. Ride every line and the SeaBus and you get my rarest badge.', ['…OK']);
      player.stats.rideTransit = new Set();
      await waitFor(() => { const r = player.stats.rideTransit; objective('Ride them all: ' + ['expo', 'mill', 'canada', 'seabus'].map(k => (r.has(k) ? '✅ ' : '⬜ ') + { expo: 'Expo', mill: 'Millennium', canada: 'Canada', seabus: 'SeaBus' }[k]).join(' · ')); return ['expo', 'mill', 'canada', 'seabus'].every(k => r.has(k)) ? 'ok' : false; });
      reward(300, 1, '🏅 You get the badge. It\'s laminated. The nerd is crying happy tears.');
    } },
  // ---- Stage 10: buses ----
  { id: 'ferrybus', title: 'Catch the Ferry', desc: 'Ride the 250 bus from Georgia & Granville all the way to Horseshoe Bay before the ferry leaves.', start: () => XZ(49.2836, -123.1172),
    async run() {
      await talk('Backpacker with a giant map', 'I need to catch the ferry to Bowen Island! Google says take the 250. Google also said the Lions Gate Bridge is "light traffic". Come with me?', ['Let\'s ride']);
      player.stats.lastStop = null;
      await waitFor(() => { objective('Press <b>E</b> at the bus stop and take the <b>🚌 Bus 250 → Horseshoe Bay</b>'); return player.stats.lastStop === 'Horseshoe Bay' && player.stats.lastLine === 'bus' ? 'ok' : false; });
      reward(110, 2, '⛴️ The backpacker makes the ferry and yells "CANADA IS SO NICE" from the deck. Correct.');
    } },
  { id: 'lazygrind', title: 'The Lazy Grind', desc: 'Your friend wants to "do the Grouse Grind". Take the 232 bus from Lonsdale Quay to the base instead. Nobody has to know.', start: () => XZ(49.3104, -123.0822),
    async run() {
      await talk('Friend in brand-new hiking gear', 'Today I conquer the Grouse Grind! …Can we take the bus to the bottom though? My calves are, like, decorative.', ['Bus it is']);
      player.stats.lastStop = null;
      await waitFor(() => { objective('Take the <b>🚌 Bus 232 → Grouse Mountain base</b> from Lonsdale Quay'); return player.stats.lastStop === 'Grouse Mountain base' && player.stats.lastLine === 'bus' ? 'ok' : false; });
      reward(90, 1, '🥾 Your friend takes 40 selfies at the trailhead, then rides the gondola up. "Grind complete."');
    } },
  { id: 'busbingo', title: 'Bus Bingo', desc: 'Ride every TransLynx bus route: the 99 B-Line, the 5 Robson, the 250 and the 232.', start: () => XZ(49.2635, -123.1150),
    async run() {
      await talk('Retired bus driver Doreen', 'Forty years I drove these routes, honey. Ride every one of them and I\'ll give you my lucky transfer. It expired in 1994, but it\'s lucky.', ['Deal, Doreen']);
      player.stats.rideBus = new Set();
      const R = { b99: '99', b5: '5', b250: '250', b232: '232' };
      await waitFor(() => { const r = player.stats.rideBus; objective('Ride every route: ' + Object.keys(R).map(k => (r.has(k) ? '✅ ' : '⬜ ') + R[k]).join(' · ')); return Object.keys(R).every(k => r.has(k)) ? 'ok' : false; });
      reward(250, 2, '🎟️ Doreen hands you the lucky transfer and a butterscotch candy. You feel blessed.');
    } },
  // ---- Stage 12: home interiors ----
  { id: 'housewarming', title: 'Housewarming Party', desc: 'Get a place of your own (Re/Maxed-Out Realty in Yaletown) and throw a housewarming party.', start: () => XZ(49.2764, -123.1212),
    async run() {
      await talk('Your friend Priya', 'You\'re buying a place?! In THIS market? Okay, if you actually do it, you HAVE to throw a housewarming. I\'ll bring the good chips.', ['Party time']);
      player.stats.party = false;
      await waitFor(() => { objective(OWN.props.length ? 'Go inside your place (E at the green 🏠 door, or phone → Wallet → Go home) and press <b>E</b> on the 🔊 speaker' : 'Buy any home at <b>Re/Maxed-Out Realty</b> 🏠 (a closet starts at $800)'); return player.stats.party ? 'ok' : false; });
      reward(200, 2, '🎉 Best housewarming ever. Priya brought the good chips AND a plant that will die in two weeks.');
    } },
  // ---- Stage 11: shops & money ----
  { id: 'gigeconomy', title: 'Gig Economy', desc: 'Sign up for the Skip-the-Dishwasher food delivery app and finish 3 deliveries.', start: () => XZ(49.2822, -123.1205),
    async run() {
      await talk('Delivery app recruiter', 'Be your own boss! Set your own hours! Earn up to $9 an hour! (Before gas.) Just do 3 deliveries and you\'re officially part of the gig economy.', ['Sign me up']);
      player.stats.gigs = 0;
      await waitFor(() => { if (!gigActive() && player.stats.gigs < 3) startGig(); objective(`3 deliveries: <b>${player.stats.gigs}/3</b><br>${gigText()}`); return player.stats.gigs >= 3 ? 'ok' : false; });
      stopGig(); reward(150, 1, '📱 The app gives you a badge: "Hustler". It does not give you health insurance.');
    } },
  { id: 'outreach', usesE: true, title: 'Outreach Shift', desc: 'Volunteer with the harm-reduction outreach team on the Downtown Eastside: check in on people and be ready with naloxone.', start: () => XZ(49.2812, -123.0992),
    async run() {
      await talk('Outreach worker Jess', 'Thanks for coming out! Here are two naloxone kits. Check in on three people: say hi, ask how they\'re doing, maybe share a coffee. And keep your eyes open. If someone goes down, you\'ll know what to do.', ['I\'m ready']);
      dtes.kits = Math.max(dtes.kits, 2); const t0 = dtes.talks, s0 = dtes.saves;
      await waitFor(() => { objective(`Check in on people around Hastings and Oppenheimer Park (<kbd>E</kbd>): <b>${Math.min(3, dtes.talks - t0)}/3</b>`); return dtes.talks - t0 >= 3 ? 'ok' : false; });
      startOverdose(true) || startOverdose(false);
      await waitFor(() => { objective('🆘 Someone collapsed! Find them (🆘 on the map) and give <b>naloxone</b> (<kbd>E</kbd>)'); if (dtes.kits < 1) dtes.kits = 1; return dtes.saves > s0 ? 'ok' : false; });
      reward(120, 3, '💙 Jess: "You were calm, you were kind, and you saved a life today. Come back any time."');
    } },
  { id: 'sharps', usesE: true, title: 'Sharps Sweep', desc: 'Help the street-cleaning crew: safely pick up 8 used needles or broken glass around Oppenheimer Park and Hastings.', start: () => XZ(49.2822, -123.0952),
    async run() {
      await talk('Crew lead Marcus', 'Kids play in this park. Grab a sharps box (here, take one) and pick up any needles or broken glass you see. Never with bare hands, never recap a needle.', ['On it']);
      dtes.sharpsBox = true; const s0 = dtes.sharps;
      await waitFor(() => { objective(`Safely pick up needles / glass (walk up + <kbd>E</kbd>): <b>${Math.min(8, dtes.sharps - s0)}/8</b>`); return dtes.sharps - s0 >= 8 ? 'ok' : false; });
      reward(80, 2, '🧹 Marcus: "Park\'s safer for everyone now. Thanks, friend."');
    } },
  { id: 'treatyoself', title: 'Treat Yourself', desc: 'Your friend says you deserve it. Buy a coffee, some food and a new outfit.', start: () => XZ(49.2690, -123.1530),
    async run() {
      await talk('Friend holding six shopping bags', 'You work SO hard. Treat yourself! Coffee from any café, food from anywhere, and a new outfit from Lululemony. Life is short. Pants are stretchy.', ['Treat myself']);
      player.stats.bought = new Set();
      const L = { coffee: '☕ coffee', food: '🍜 food', outfit: '👖 outfit' };
      await waitFor(() => { const b = player.stats.bought; objective('Treat yourself: ' + Object.keys(L).map(k => (b.has(k) ? '✅ ' : '⬜ ') + L[k]).join(' · ') + '<br><small>Press E at any café or restaurant, and at Lululemony 👖</small>'); return Object.keys(L).every(k => b.has(k)) ? 'ok' : false; });
      reward(60, 1, '🛍️ You treated yourself. Your bank account did not. Worth it.');
    } },
  // ---- Stage 8: North Shore ----
  { id: 'quarry', title: 'Quarry Rock Hike', desc: 'Hike from Deep Cove up to Quarry Rock for the view over Indian Arm. On foot, under 12 minutes.', start: () => XZ(49.3290, -122.9480),
    async run() {
      await talk('Kayak rental guy', 'Quarry Rock is the best short hike on the North Shore. Up through the forest, big rock, huge view. And then honey doughnuts. On foot, please!', ['Let\'s hike']);
      setDeadline(720);
      await goto({ ...SPOTS.quarryrock }, 'Hike up to <b>Quarry Rock</b> ON FOOT', { r: 40 });
      if (player.vehicle) throw new Fail('That was not on foot!');
      reward(160, 1, '🌲 Indian Arm sparkles below. A dog steals your trail mix. Worth it.');
    } },
  { id: 'lynnloop', title: 'Free Bridge Run', desc: 'Two suspension bridges, one afternoon: cross the Capilano bridge area, then the free Lynn Canyon bridge.', start: () => XZ(49.3420, -123.1150),
    async run() {
      await talk('Budget backpacker', 'Capilano costs $70. Lynn Canyon is FREE. Visit both and tell me which one wobbles more. For science.', ['For science!']);
      await goto({ ...SPOTS.capilano }, 'Visit the <b>Capilano Suspension Bridge</b>', { r: 60 });
      await goto({ ...SPOTS.lynncanyon }, 'Now the free <b>Lynn Canyon Suspension Bridge</b>', { r: 50 });
      reward(140, 1, '🌉 Verdict: Lynn Canyon wobbles more AND it\'s free. The backpacker weeps with joy.');
    } },
  // ---- Stage 9: more side jobs ----
  { id: 'bikethief', title: 'Stop That Thief!', desc: 'Someone just stole a tourist\'s motorbike on the Coal Harbour seawall. Chase them down!', start: () => XZ(49.2895, -123.1200),
    async run() {
      await talk('Tourist from Ohio', 'Excuse me! That guy just took my rental motorbike! Is that… is that normal here?! Please get it back!', ['Not normal. On it!']);
      if (!player.vehicle || player.vehicle.d.kind !== 'road') await goto({ x: player.x, z: player.z }, 'Get any <b>car or motorbike</b> (F)', { r: 1e6, vehicle: ['car', 'taxi', 'sports', 'suv', 'van', 'motorbike', 'bus'] });
      const thief = makeRunner('motorbike', player.x + 40, player.z + 40, 1.4); if (!thief) throw new Fail('The thief escaped down an alley.');
      setDeadline(200);
      await chase(thief, 'Catch the <b>motorbike thief</b>!');
      reward(220, 2, '🏍️ The thief says sorry. Very Canadian. The tourist gives you an "Ohio" fridge magnet.');
    } },
  { id: 'foodtruck', title: 'Food Truck Rush', desc: 'Drive the food truck to three hungry lunch crowds before they all go to the sushi place instead.', start: () => XZ(49.2722, -123.1350),
    async run() {
      await talk('Chef Rosa', 'My driver quit! Three lunch crowds are waiting: Kits Beach, English Bay and BC Place. Take the truck, eight minutes. Tacos wait for no one.', ['Taco time!']);
      if (player.vehicle?.type !== 'van') await goto({ x: player.x, z: player.z }, 'Get in the <b>food truck</b> (F)', { r: 1e6, vehicle: ['van'] });
      setDeadline(480);
      for (const [lat, lon, name] of [[49.2745, -123.1540, 'Kits Beach'], [49.2866, -123.1425, 'English Bay'], [49.2768, -123.1120, 'BC Place']]) { await goto(P(lat, lon), 'Serve the lunch crowd at <b>' + name + '</b>', { r: 60, vehicle: ['van'] }); sfx.coin(); ui.toast('🌮 Sold out at ' + name + '!', '', 1500); }
      reward(300, 1, '🌮 Record day! Rosa names a taco after you. It has too much cilantro.');
    } },
  { id: 'nightmarket', title: 'Night Market Munchies', desc: 'Grab five famous snacks at the Richmond Night Market in three minutes before the lines get too long.', start: () => XZ(49.1950, -123.1290),
    async run() {
      await talk('Foodie friend', 'Tornado potato, dragon\'s beard candy, bubble tea, squid on a stick and mochi waffles. Five snacks, three minutes. Lines are getting LONG. GO!', ['Snack attack!']);
      setDeadline(180); const c = XZ(49.1946, -123.1270), pts = []; for (let i = 0; i < 5; i++) pts.push({ x: c.x + R(-120, 120), z: c.z + R(-90, 90) });
      await collect(pts, 'donut', 'Grab night market snacks');
      reward(140, 1, '🍢 You are so full. You buy one more bubble tea anyway.');
    } },
  { id: 'wildlife', title: 'Wildlife Photographer', desc: 'A nature magazine wants photos of an orca, a black bear and a bald eagle. Get close and press P.', start: () => XZ(49.3005, -123.1310),
    async run() {
      await talk('Magazine editor', 'Three photos: an orca in the water, a black bear on the North Shore, and a bald eagle (try Brackendale or Stanley Park). Get close, and press P. Don\'t get eaten.', ['Say cheese, bear']);
      const kind = k => ({ near: () => !!nearestAnimal(k, player.x, player.z, 90), pos: () => nearestAnimal(k, player.x, player.z, 1e6) });
      await photos([{ name: 'Orca', ...kind('orca') }, { name: 'Black bear', ...kind('bear') }, { name: 'Bald eagle', ...kind('eagle') }], 'Wildlife photos');
      reward(400, 2, '📸 Cover photo! The bear\'s agent wants royalties.');
    } },
  { id: 'rescue', title: 'North Shore Rescue', desc: 'A hiker is lost in the backcountry behind Grouse Mountain. Fly the helicopter, pick them up, and get them to Lions Gate Hospital.', start: () => XZ(49.2878, -123.1036),
    async run() {
      await talk('Rescue coordinator', 'We got a call from a hiker in flip-flops with no flashlight. Classic. Take the helicopter, find them behind Grouse, and fly them to Lions Gate Hospital. Twelve minutes.', ['Lifting off!']);
      if (player.vehicle?.type !== 'heli') await goto({ x: player.x, z: player.z }, 'Get in the <b>helicopter</b> (F)', { r: 1e6, vehicle: ['heli'] });
      setDeadline(720);
      await goto(P(49.3900, -123.1000), 'Find the <b>lost hiker</b> behind Grouse Mountain', { r: 80, vehicle: ['heli'] });
      ui.toast('🧗 Hiker on board!', '"I thought it was a 20-minute walk…"', 2500);
      await goto(P(49.3205, -123.0700), 'Fly to <b>Lions Gate Hospital</b>', { r: 90, vehicle: ['heli'] });
      reward(500, 4, '🚁 Hiker safe! North Shore Rescue thanks you. Please donate to North Shore Rescue (the real one!).');
    } },
  { id: 'canucks', title: 'Canucks Game Night', desc: 'Pick up four friends from around town and get to Rogers Arena before puck drop.', start: () => XZ(49.2626, -123.1150),
    async run() {
      await talk('Your friend Jas', 'Game seven, baby! Grab Mo in Kits, Priya on Main, Tyler in the West End and Lin in Chinatown, then Rogers Arena. Ten minutes to puck drop. Wear something blue!', ['GO CANUCKS GO!']);
      setDeadline(600);
      await collect([P(49.2680, -123.1550), P(49.2630, -123.1000), P(49.2850, -123.1350), P(49.2800, -123.1000)], 'box', 'Pick up your friends');
      await goto(P(49.2778, -123.1089), 'Get to <b>Rogers Arena</b> for puck drop', { r: 70 });
      reward(250, 1, '🏒 Canucks win in overtime! The whole city honks. A stranger hugs you for nine minutes.');
    } },
  { id: 'parking', usesE: true, title: 'Parking Enforcer', desc: 'A rogue parking company will pay you to stick fake tickets on 6 parked cars. Extremely Vancouver. Extremely bad.', start: () => XZ(49.2815, -123.1240),
    async run() {
      const c = await talk('Shady man in a reflective vest', 'Six parked cars, six "tickets". Just walk up and press E. Nobody will know. Except everybody, when they read them.', ['Do it (bad karma)', 'Absolutely not']);
      if (c === 1) { player.karma += 1; ui.toast('😇 Good call', 'Vancouver parking is hard enough already.'); return; }
      const done = new Set();
      await waitFor(() => {
        const key = c => Math.round(c.x) + ',' + Math.round(c.z);   // curbside cars are rebuilt as you move: remember them by place
        const cars = [...vehicles.filter(v => v.ai?.parked), ...parkedSpots].filter(c => !done.has(key(c))).sort((a, b) => dist(a) - dist(b));
        if (cars[0]) setWaypoint(cars[0].x, cars[0].z);
        if (tapped('KeyE') && !player.vehicle && cars[0] && dist(cars[0]) < 5) { done.add(key(cars[0])); sfx.coin(); ui.toast('🎫 Ticket placed', ['"Parking in a parking spot: $95"', '"Too shiny: $60"', '"Car looked sad: $40"'][done.size % 3], 1500); }
        objective('Stick fake tickets on <b>parked cars</b>: <b>' + done.size + '/6</b> (walk up + <b>E</b>)'); return done.size >= 6 ? 'ok' : false;
      });
      reward(80, -3, '😈 Six angry drivers. One of them is your landlord.');
    } },
  { id: 'tourguide', title: 'Seawall Tour Guide', desc: 'Lead a group of tourists on foot along the seawall: Canada Place, Coal Harbour, the totem poles and English Bay.', start: () => XZ(49.2885, -123.1125),
    async run() {
      await talk('Tour group (all wearing the same hat)', 'We would like ze authentic Vancouver experience! Walk us along the seawall. On foot. We have the matching hats.', ['Follow me!']);
      setDeadline(900);
      for (const [lat, lon, name] of [[49.2905, -123.1230, 'Coal Harbour'], [49.2995, -123.1213, 'the Brockton Point totem poles'], [49.2866, -123.1425, 'English Bay']]) {
        await goto(P(lat, lon), 'Lead the tour to <b>' + name + '</b> (on foot!)', { r: 40 });
        if (player.vehicle) throw new Fail('The tourists can\'t keep up with your vehicle!');
        ui.toast('📢 "And here we have ' + name + '!"', 'The tourists take 400 photos.', 2000);
      }
      reward(260, 2, '🧢 Five-star review: "Very authentic. It rained."');
    } },
  // ---- Stage 5: weather ----
  { id: 'stormchaser', title: 'Storm Chaser', desc: 'A rare Vancouver thunderstorm is rolling in! Snap 3 photos of lightning (press P right after a flash).', start: () => XZ(49.2866, -123.1420),
    async run() {
      await talk('Weather nerd with a tripod', 'Thunderstorms almost never happen here! Press P to take a photo right after the lightning flashes. I need three good ones for my weather blog. All 11 readers are waiting.', ['Let\'s chase it!']);
      setWeather('storm', { lock: true });
      try {
        let shots = 0;
        await waitFor(() => { if (tapped('KeyP')) { sfx.shutter(); if (G.t - W.lastBolt < 1.5) { shots++; ui.toast('📸 Got it! ' + shots + '/3', 'That one\'s going on the fridge.', 1500); } else ui.toast('📸 Too slow…', 'Just a photo of dark clouds. Very moody.', 1200); } objective('Photograph lightning: <b>' + shots + '/3</b> (press <b>P</b> right after a flash)'); return shots >= 3 ? 'ok' : false; });
        reward(250, 1, '⚡ Your photo goes viral: "Lightning over English Bay". You are now a weather influencer.');
      } finally { W.locked = false; }
    } },
  { id: 'umbrellahero', usesE: true, title: 'Umbrella Hero', desc: 'It\'s pouring downtown and nobody brought an umbrella. Hand out 5 umbrellas (press E next to people).', start: () => XZ(49.2826, -123.1205),
    async run() {
      await talk('Umbrella shop owner', 'Classic Vancouver: 300 rainy days a year and still nobody owns an umbrella. Take this box and hand them out. Spread the dry.', ['Spread the dry!']);
      setWeather('rain', { lock: true });
      try {
        const given = new Set();
        await waitFor(() => { if (tapped('KeyE')) { const p = nearestPed(player.x, player.z, 3.5); if (p && !given.has(p)) { given.add(p); p.umb = 3; p.keep = true; say(p, ['Oh my gosh, thank you!', 'A hero! A dry hero!', 'Sorry, I mean, thank you!'][given.size % 3]); sfx.coin(); } } objective('Give umbrellas to people: <b>' + given.size + '/5</b> (walk up and press <b>E</b>)'); return given.size >= 5 ? 'ok' : false; });
        reward(120, 3, '☂️ Five dry Vancouverites. One of them will lose it by Friday.');
      } finally { W.locked = false; }
    } },
  { id: 'splashzone', title: 'Splash Zone', desc: 'A bored teenager will pay you to drive through puddles and splash 6 people. This is very, very rude.', start: () => XZ(49.2780, -123.1240),
    async run() {
      const c = await talk('Bored teenager', 'It\'s raining, there are puddles everywhere, and people are walking right next to them. Splash six of them with a car. I\'ll pay you twenty bucks. For the content.', ['Do it (bad karma)', 'No, that\'s mean']);
      if (c === 1) { player.karma += 1; ui.toast('😇 Good call', 'Nobody deserves a puddle to the face.'); return; }
      setWeather('rain', { lock: true });
      try {
        const start = splashStats.soaked;
        await waitFor(() => { const n = splashStats.soaked - start; objective('Drive fast through <b>puddles</b> next to people: <b>' + Math.min(6, n) + '/6</b> soaked'); return n >= 6 ? 'ok' : false; });
        reward(20, -3, '😈 Six soggy strangers. Somewhere, your mom felt a disturbance.');
      } finally { W.locked = false; }
    } },
];

// ---------- secrets / easter eggs ----------
export const SECRETS = [
  ['dude', 'Dude Chilling Park', 'The sign started as an art prank. The city loved it so much they made it official.'],
  ['steamclock', 'Gastown Steam Clock', '*toot toot* It whistles every 15 minutes. Everyone films it. Every time.'],
  ['gassyjack', 'Gassy Jack', 'Gastown is named after this guy, a famously talkative saloon owner. Respect.'],
  ['inukshuk', 'English Bay Inukshuk', 'A stone landmark meaning "you are on the right path".'],
  ['laughter', 'A-maze-ing Laughter', '14 giant laughing bronze guys. You can\'t help but laugh too.'],
  ['cauldron', 'Olympic Cauldron', 'Vancouver 2010! Press E here to light it.'],
  ['orca', 'Digital Orca', 'An orca made of giant pixels. Very Minecraft. Very Vancouver.'],
  ['drop', 'The Drop', 'A giant blue raindrop. Because of course Vancouver has a rain statue.'],
  ['gate', 'Chinatown Millennium Gate', 'Welcome to one of the biggest historic Chinatowns in North America.'],
  ['sunyatsen', 'Sun Yat-Sen Garden', 'A peaceful classical Chinese garden. Shh. Zen mode.'],
  ['woodwards', 'Woodward\'s W', 'The giant red W that used to sit on the old department store.'],
  ['totems', 'Brockton Point Totem Poles', 'Beautiful carved totem poles by First Nations artists.'],
  ['ninegun', 'Nine O\'Clock Gun', 'A cannon that fires every night at 9pm. Come back at 9pm game time!'],
  ['wetsuit', 'Girl in a Wetsuit', 'Not a mermaid. People keep calling her a mermaid.'],
  ['siwash', 'Siwash Rock', 'A rock pillar with a tree growing on top. Stubborn little tree.'],
  ['hollowtree', 'The Hollow Tree', 'A giant hollow cedar stump. People used to park cars in it for photos.'],
  ['prospect', 'Prospect Point', 'Great view of the Lions Gate Bridge and the North Shore.'],
  ['lionsgate', 'Lions Gate Bridge', 'Built in 1938 by the Guinness family. Yes, the beer people.'],
  ['science', 'Science World', 'The big golf ball. Locals have strong feelings about calling it a golf ball.'],
  ['canada', 'Canada Place', 'The white "sails" where cruise ships dock.'],
  ['harbour', 'Harbour Centre', 'The flying saucer on a stick. The yellow elevator goes up the outside!'],
  ['bcplace', 'BC Place', 'Home of the BC Lions and the Whitecaps. The roof lights up at night.'],
  ['giants', 'Granville Island Giants', 'Six cement silos painted into colourful giants.'],
  ['market', 'Granville Island Market', 'Doughnuts, fish, flowers, and seagulls who will steal all of them.'],
  ['playland', 'Playland', 'Old-school amusement park with a wooden roller coaster. Currently: zombies.'],
  ['grouse', 'Grouse Mountain', 'Peak of Vancouver. Ski runs, lumberjack shows, and grizzly bears.'],
  ['eyewind', 'Eye of the Wind', 'A wind turbine with a viewing pod on top of Grouse.'],
  ['grizzlies', 'Coola & Grinder', 'Two orphaned grizzly bears who live at the Grouse refuge. Big good boys.'],
  ['seymour', 'Mount Seymour', 'Snowboard heaven. Also tubing. Mostly tubing.'],
  ['cypress', 'Cypress Mountain', 'Hosted Olympic snowboarding and freestyle skiing in 2010!'],
  ['westlion', 'The West Lion', 'You climbed a famous peak. Your knees will remember this.'],
  ['deepcove', 'Deep Cove', 'Kayaks + the famous honey doughnuts. Press E for a doughnut ($3, heals you).'],
  ['capilano', 'Capilano Suspension Bridge', 'A wobbly footbridge 70 m above a canyon. Don\'t look down.'],
  ['kits', 'Kitsilano Beach', 'Volleyball, logs to sit on, and the longest saltwater pool in Canada.'],
  ['crows', 'The Crow Commute', 'Every evening thousands of crows fly east to sleep in Burnaby. True story.'],
  ['chief', 'Stawamus Chief', 'A 700 m granite monolith. One of the biggest in the world!'],
  ['shannon', 'Shannon Falls', 'Third-highest waterfall in BC — 335 m of falling water.'],
  ['brandywine', 'Brandywine Falls', 'A 70 m drop into a canyon of old lava flows. Yes, lava!'],
  ['britannia', 'Britannia Mine', 'Once the biggest copper mine in the British Empire. Now a museum (and a zombie walk).'],
  ['ferry', 'BC Fairies', "The ferry to Bowen Island and the Sunshine Coast. Bring snacks, it's always late."],
  ['porteau', 'Porteau Cove', 'Scuba divers explore sunken ships here. Brrr.'],
  ['spit', 'The Squamish Spit', 'Squamish is the windsurfing and kiteboarding capital of Canada.'],
  ['rings', 'Whistler Olympic Rings', 'Whistler hosted the alpine skiing at the 2010 Winter Olympics.'],
  ['whistlervillage', 'Whistler Village', 'Après-ski capital of the world. Prices: also world-class.'],
  ['ilanaaq', 'Ilanaaq the Inukshuk', 'The giant stone friend on Whistler Mountain — the symbol of the 2010 Games.'],
  ['peak2peak', 'Peak 2 Peak Gondola', 'You rode one of the longest, highest lifts on Earth!'],
  ['greenlake', 'Green Lake', 'Floatplanes land here, right next to Whistler. Glacier-blue water.'],
  ['altalake', 'Alta Lake', 'Paddleboards, swimming docks, and very expensive cabins.'],
  ['brackendale', 'Brackendale Eagles', 'Thousands of bald eagles come here every winter to eat salmon.'],
  ['yvr', 'YVR Airport', 'Vancouver International — voted best airport in North America more times than Gord can count.'],
  ['tower', 'YVR Control Tower', 'The air traffic controllers can see you. They are judging your taxiing.'],
  ['jade', 'The Jade Canoe', 'Bill Reid\'s "Spirit of Haida Gwaii" — a giant bronze canoe full of mythical passengers.'],
  ['planespot', 'Larry Berg Flight Path Park', 'Planes land right over this park. Bring earplugs and a camera.'],
  ['iona', 'Iona Beach Jetty', 'A 4 km jetty straight out into the ocean, right next to the runways.'],
  ['skytrain', 'SkyTrain', 'One of the longest driverless train systems in the world. Sit at the front and pretend you\'re driving!'],
  ['homebody', 'Homebody', 'You slept in your own bed in your own Vancouver home. Most people here only dream about that.'],
  ['landlord', 'Landlord', 'You bought your first Vancouver property. Your parents are so proud. Your bank is so rich.'],
  ['bigspender', 'Big Spender', 'You spent $5,000 in Vancouver. That\'s roughly two months of rent for a closet.'],
  ['clevelanddam', 'Cleveland Dam', 'The 91 m concrete dam holding back Capilano Lake, the drinking water for half of Metro Vancouver. Walk across the crest and watch the spillway roar.'],
  ['bloedel', 'Into the Jungle', 'You walked into the Bloedel Conservatory, the bubble dome on top of Little Mountain: a tropical rainforest with free-flying parrots, in the middle of Vancouver.'],
  ['liondance', 'Lion Dance', 'You met the lion dance on East Pender. In Chinese tradition the lion scares off bad luck with drums, cymbals and firecrackers, especially at Lunar New Year, when Vancouver\'s Chinatown parade draws huge crowds.'],
  ['kitspool', 'Saltwater Laps', 'You swam in Kitsilano Pool: 137 m of heated saltwater right on Kits Beach, Canada\'s longest pool, open since 1931.'],
  ['polarbear', 'Polar Bear', 'You charged into English Bay with the Polar Bear Swim. Vancouverites have done it every New Year\'s Day since 1920, often in costume, with thousands of people.'],
  ['leafpile', 'Crunch Time', 'You crashed through a pile of fall leaves. Vancouver\'s maples, oaks and chestnuts drop millions of leaves every October, and every kid knows what they\'re for.'],
  ['chandelier', 'The Spinning Chandelier', 'You stood under the giant crystal chandelier hanging beneath the Granville Bridge, right beside Vancouver House, the tower that starts as a triangle and ends as a rectangle. A few times a day it drops, lights up and spins.'],
  ['eastvan', 'East Van Cross', 'Ken Lum\'s glowing "Monument for East Vancouver": EAST down, VAN across. Pure East Van pride (best seen from the SkyTrain at night).'],
  ['taxiride', 'Backseat Passenger', 'You took a taxi and survived the driver\'s opinions on hockey.'],
  ['bus', 'Thank You, Driver!', 'You rode a TransLynx bus and said thank you at the back door, like every polite Vancouverite.'],
  ['seabus', 'SeaBus', 'A passenger ferry across Burrard Inlet since 1977. Best cheap harbour cruise in town.'],
  ['waterfront', 'Waterfront Station', 'The grand old 1914 railway station, now the hub for SkyTrain, SeaBus and West Coast Express.'],
  ['lonsdale', 'Lonsdale Quay', 'Public market on the North Shore waterfront. Great views back at downtown.'],
  ['raincouver', 'Raincouver', 'You stood in a downpour with no umbrella for 10 seconds. You are a true local now.'],
  ['rainbow', 'Rainbow', 'After the rain, a rainbow over the city. Worth every drop.'],
  ['cherry', 'Cherry Blossoms', 'Vancouver has over 40,000 cherry trees. You found one in bloom. Instagram is calling.'],
  ['fireworks', 'Celebration of Light', 'Summer fireworks over English Bay. Half a million people watch. You got a great spot.'],
  ['xmastree', 'Christmas at Robson Square', 'A giant tree and free skating. Very cozy. Hot chocolate is $7.'],
  ['pumpkin', 'The Giant Pumpkin', 'Fall at Granville Island means pumpkins the size of a Smart car.'],
  ['lynncanyon', 'Lynn Canyon Suspension Bridge', 'The free suspension bridge. 50 m above the canyon. Locals say "why pay for Capilano?"'],
  ['quarryrock', 'Quarry Rock', 'The famous Deep Cove hike: a big rock with a view over Indian Arm. Bring a doughnut.'],
  ['orcapod', 'Orcas!', 'You spotted a pod of killer whales in the Salish Sea.'],
  ['humpback', 'Humpback Whale', 'A humpback, back in BC waters after nearly a century away.'],
  ['dolphins', 'Bow Riders', 'Pacific white-sided dolphins surfed the bow wave of your boat.'],
  ['seal', 'Harbour Seal', 'A curious seal popped up to stare at you. It won the staring contest.'],
  ['heron', 'Great Blue Heron', 'Stood perfectly still… until you got too close.'],
  ['eagle', 'Fish Snatcher', 'You saw a bald eagle pluck a fish right out of the sea.'],
  ['caddy', 'Caddy', 'You saw Cadborosaurus, the legendary BC sea serpent. Sure you did.'],
  ['island', 'Island Time', 'You made it to Vancouver Island. Everything is 15 minutes slower here.'],
  ['parliament', 'The Legislature', 'The BC Parliament Buildings in Victoria, outlined in 3,300 light bulbs at night.'],
  ['baker', 'Mount Baker', 'You got up close to the big snowy volcano you can see from all over Vancouver.'],
  ['peacock', 'Peacock Show', 'A Beacon Hill Park peacock fanned its tail just for you. Probably.'],
  ['waterballet', 'Pickle Boat Ballet', 'You caught the Victoria Harbour Ferries dancing in the Inner Harbour.'],
  ['vicchinatown', 'Gate of Harmonious Interest', 'Victoria has the oldest Chinatown in Canada. Fan Tan Alley is just around the corner.'],
  ['mile0', 'Mile 0', 'The start of the Trans-Canada Highway. Only 7,821 km to go.'],
  ['stuntjump', 'Stunt Jump', 'You launched a vehicle off a ramp: over a second of air or 25 m. Insurance hates you.'],
  ['grind', 'Mother Nature\'s Stairmaster', 'You climbed the whole Grouse Grind against the clock.'],
  ['goal', 'Top Bins', 'You scored a goal in a park kickabout.'],
  ['tennis', 'Game, Set, Match', 'You beat a local at tennis on a real public court.'],
  ['hoops', 'Hot Hand', 'You made 7 of 10 shots in a shoot-around.'],
  ['golf', 'Grip It and Rip It', 'You hit a 200 m drive on a golf course.'],
  ['skatepark', 'Park Rat', 'You borrowed a board at a real skatepark.'],
  ['sasquatch', 'Was That…?', 'Something big and hairy watched you from the edge of the trees. Then it was gone.'],
  ['goldstash', 'The Golden Board', 'You dug a legendary golden snowboard out of the snow near Blackcomb\'s Rendezvous Lodge.'],
  ['sledneck', 'Sledneck', 'You rode a snowmobile for a whole kilometre of snow.'],
  ['kickerpark', 'Send It', 'You landed a trick off a kicker in a resort terrain park.'],
  ['flip', 'Flip Out', 'You landed a flip on wheels or a board.'],
  ['kites', 'Kite Day', 'Kites dancing over Garry Point Park in Steveston.'],
  ['nightmarket', 'Night Market', 'You found the Richmond Night Market. Your diet did not survive.'],
  ['lifesaver', 'Lifesaver', 'You reversed an overdose with naloxone. Somebody gets to see tomorrow because of you.'],
  ['newfriend', 'New Friend', 'You made a friend on Hastings Street. Kindness is free.'],
  ['cruise', 'Cruise Season', 'A giant cruise ship docked at Canada Place, bound for Alaska.'],
  ['raccoons', 'Trash Pandas', 'You met a raccoon family on their night shift.'],
  ['coyote', 'City Coyote', 'A coyote trotted past you in the middle of the city.'],
  ['planespotter', 'Plane Spotter', 'You watched 10 floatplanes take off or land up close. Coal Harbour is one of the busiest seaplane harbours on Earth.'],
  ['biplane', 'Barnstormer', 'A vintage biplane looped the loop right over your head, smoke on.'],
  ['balloon', 'Up, Up and Away', 'You spotted a hot-air balloon drifting over the city.'],
  ['bannerplane', 'Read the Sky', 'A little plane towed a banner over English Bay. Somebody paid good money for that message.'],
  ['allvehicles', 'Ride Everything', 'You\'ve ridden a bike, scooter, car, motorbike, jet ski, helicopter AND seaplane.'],
  // games within the game (minigames.js)
  ['arcade', 'Insert Coin', 'You dropped a loonie into a real arcade cabinet.'],
  ['gullinvaders', 'Fry Defender', 'You cleared a whole wave of Seagull Invaders.'],
  ['crossgranville', 'Frogger Who?', 'You docked at all five Granville Island slips in Cross Granville.'],
  ['snake', 'Twenty-Car Train', 'Your SkyTrain Snake grew 20 cars long.'],
  ['breakout', 'Demolition Permit', 'You knocked down a whole wall in Gastown Brick Breaker.'],
  ['clawprize', 'The Claw Chose You', 'You actually won a plush toy from a claw machine.'],
  ['goldsquatch', 'Legendary Plush', 'You pulled the GOLDEN SASQUATCH out of a claw machine. Nobody believes you.'],
  ['fishing', 'Gone Fishin\'', 'You caught a salmon off the end of a pier.'],
  ['caddyjr', 'Caddy Jr.', 'You hooked a baby sea serpent… and let it go.'],
  ['busker', 'Street Star', 'You played an A-grade busking set. People filmed it.'],
  ['bullseye', 'Bullseye!', 'You hit the bull in pub darts.'],
  ['trivia', 'Quiz Khalifa', 'You got 5 out of 5 at pub trivia night.'],
  ['checkers', 'Park Champion', 'You beat a park checkers champion at their own table.'],
  ['hotdog', 'Lunch Rush Legend', 'You served 10 hot dogs in one Nori-Dog shift.'],
  ['payphone', 'Ring Ring', 'You answered the payphone in Blood Alley and solved all six riddles.'],
  ['troll', 'Troll Toll Paid', 'You remembered 8 lanterns in a row for the troll under the Burrard Bridge.'],
  ['basement', 'The Basement', 'You found a secret arcade under a hatch in Shanghai Alley.'],
  ['trashking', 'Trash Panda King', 'You scored 1,000 in Raccoon Run.'],
  ['holeinone', 'Hole in One!', 'You aced a hole at a real pitch & putt.'],
  ['pitchputt', 'Weekend Golfer', 'You played a full round of pitch & putt.'],
  ['golfcrow', 'Fowl Play', 'A crow stole your golf ball mid-round. Local rules: play it where it drops.'],
  ['golfgoose', 'Goose Hazard', 'Your ball bounced off a Canada goose on the green. It has not forgiven you.'],
  ['quarrygarden', 'Rock Bottom', 'You went down into the Quarry Garden at Queen Elizabeth Park: an old basalt quarry turned into a sunken garden with a waterfall.'],
  ['qeview', 'Top of the City', 'You looked through the coin binoculars on Little Mountain, the highest point in Vancouver.'],
  ['grind', 'Grind Time', 'You grinded a rail or ledge at a skatepark.'],
  ['skatejam', 'Sponsored', 'You scored 4,000+ points in a 60-second Trick Jam at a skatepark.'],
  ['skategame', 'S.K.A.T.E. Champ', 'You beat a local skater at a game of S.K.A.T.E.'],
  ['photobomb', 'Photobomb!', 'You walked into a wedding photo shoot in the Quarry Garden. You are in their album forever.'],
  ['lawnbowls', 'Bowled Over', 'You beat a club member at lawn bowls.'],
  ['pingpong', 'Ping Pong Wizard', 'You won a game of park ping pong.'],
  ['bowling', 'Strike a Pose', 'You beat a league regular at the bowling alley.'],
  ['poolshark', 'Pool Shark', 'You cleared a pool table without sinking the 8 early.'],
  ['chess', 'Grandmaster of the Park', 'You checkmated a park chess player.'],
  ['typewriter', 'The Last Typewriter', 'You typed 30+ words per minute on the library\'s old typewriter.'],
  ['whack', 'Raccoon Union Problem', 'You scored 300 at Whack-a-Raccoon in a Kits back lane.'],
  ['goosechase', 'Goose Chase', 'You chased down a Canada goose and got your sandwich back.'],
  ['ufo', 'Lights Over Grouse', 'You saw a UFO over the North Shore mountains. Nobody believes you.'],
  ['backyardbear', 'Bear in the Yard', 'A black bear raided a green bin in a North Shore back yard. Lock your bins!'],
  ['hollywoodnorth', 'Hollywood North', 'You walked right into a film shoot. "CUT!"'],
  ['muralhunter', 'Mural Hunter', 'You found 3 of the big murals around Mount Pleasant, Strathcona and Gastown.'],
  ['banksy', 'Banksy of Vancouver', 'You left 10 pieces of your own street art around the city.'],
  ['dumpsterdive', 'Lane Treasure', 'You found a golden pinecone trophy in a back-lane dumpster.'],
  ['crowfries', 'Crow Heist', 'You watched a crow steal someone\'s fries. Crows remember faces.'],
  // vehicles (vehiclemodels.js, garage.js)
  ['garage10', 'Petrolhead', 'You drove 10 different vehicle models.'],
  ['garage25', 'Car Collector', 'You drove 25 different vehicle models. Your insurance company is nervous.'],
  ['outatime', 'Outatime', 'You hit 88 miles per hour in the DeLorian. Great Scott!'],
  ['supercar', 'Coal Harbour Cruiser', 'You took the lime-green supercar for a spin.'],
  ['drift', 'Sideways', 'You held a drift for three whole seconds.'],
  ['carshare', 'Home Zone', 'You unlocked an Ev-Oh car share like a real Vancouverite.'],
  // boats (boats.js)
  ['marinathief', 'Yacht Rock', 'You "borrowed" a boat from a marina. The owner is going to be SO confused.'],
  ['oldsalt', 'Old Salt', 'You sailed a whole kilometre using nothing but the wind.'],
  ['whalewatch', 'Whale of a Time', 'You went on a whale-watching tour and the whales actually showed up.'],
  ['boozecruise', 'Sunset Sipper', 'You partied around Stanley Park on a sunset cruise.'],
  ['charterfish', 'Reel Deal', 'You reeled in a Chinook salmon on a fishing charter in Howe Sound.'],
  ['techbro', 'Content Crew', 'You shot "content" for a tech bro on his (leased) yacht.'],
  ['planespotting', 'Plane Bingo', 'You spotted a Beaver, an Otter and a Caravan from the water.'],
  ['dragonboat', 'Dragon Slayer', 'You helped a False Creek dragon boat team win a race.'],
  ['watertaxi', 'Little Blue Boat', 'You took a water taxi across False Creek.'],
  ['pirates', 'Barnacle Bill', 'You won the water-cannon battle on a pirate kids\' cruise.'],
  ['retiree', 'Flattery Floats', 'You complimented a retiree\'s boat and got a free trip to Bowen Island for ice cream.'],
  ['sealaboard', 'Stowaway', 'A harbour seal flopped onto your boat for a nap.'],
  ['roguewave', 'Rogue Wave', 'A freak wave tossed your boat. You lived to tell the tale.'],
  ['rubberducks', 'Friendly Floatees', 'You found a flotilla of lost rubber ducks bobbing in the sea.'],
  // wildlife & plants (fauna.js, flora.js, journal.js)
  ['spiritbear', 'Spirit Bear', 'You saw a white Kermode bear: a black bear with a rare gene for white fur. BC\'s official mammal.'],
  ['bearcubs', 'Up the Tree!', 'A mother bear huffed and her cubs scrambled up a tree. Give mom lots of room.'],
  ['heybear', 'Hey Bear!', 'You calmly made noise and the bear wandered off. Textbook bear safety.'],
  ['bearfishing', 'Gone Fishing', 'You watched a bear catch a salmon in a North Shore river.'],
  ['salmonrun', 'The Salmon Run', 'You saw salmon fighting their way upstream to spawn in the fall.'],
  ['elkbugle', 'The Bugle', 'A bull elk bugled in the Sea-to-Sky valley. The eeriest sound in the forest.'],
  ['rams', 'Headbangers', 'Two bighorn rams smashed horns right in front of you.'],
  ['wolfpack', 'The Pack', 'You crossed paths with a grey wolf pack.'],
  ['moose', 'Moose on the Loose', 'You saw a moose. Bigger than you thought, right?'],
  ['cougar', 'Ghost Cat', 'You saw a cougar. Most British Columbians never do.'],
  ['lynx', 'Snow Ghost', 'A Canada lynx padded past on its giant snowshoe paws.'],
  ['whistler', 'The Whistler', 'A hoary marmot whistled at you. Whistler Mountain is named after them!'],
  ['skunked', 'Skunked', 'You got too close to a skunk. Everyone can smell it.'],
  ['seaotter', 'Raft of Otters', 'You found sea otters floating on their backs, holding paws.'],
  ['sealions', 'Bark Bark', 'A colony of Steller sea lions barked at you from the rocks.'],
  ['beaverslap', 'Tail Slap', 'A beaver slapped its tail on the water to warn everyone you were coming.'],
  ['gullheist', 'Seagull Heist', 'A gull snatched your food right out of your hand.'],
  ['wildfine', 'Don\'t Feed the Wildlife', 'You fed a wild animal and a conservation officer fined you. Worth it? (No.)'],
  ['naturephotog', 'Nature Photographer', 'You sold photos of 10 different species.'],
  ['naturalist', 'Naturalist', 'You recorded 10 species in your field guide.'],
  ['fieldguide', 'Field Guide Pro', 'You recorded 30 species in your field guide.'],
  ['botanist', 'Botanist', 'You found 15 different BC plants.'],
  ['ghostpipe', 'Ghost Pipe', 'You found a ghostly white plant that lives without sunlight.'],
  ['fairyslipper', 'Fairy Slipper', 'You found a tiny pink calypso orchid on the forest floor.'],
  ['phantomorchid', 'Phantom Orchid', 'You found one of the rarest plants in Canada.'],
  ['chocolily', 'Chocolate Lily', 'You found a chocolate lily in a Garry oak meadow.'],
  ['ancientcedar', 'The Old One', 'You stood under a cedar that was already old when Captain Vancouver sailed by.'],
  ['fairyring', 'Fairy Ring', 'You found a perfect ring of red-and-white mushrooms. Don\'t step inside…'],
  // guns.js: range, finds, hunting
  ['gunrange', 'Shoot the Breeze', 'You fired your first shots at the range. Ear protection: recommended.'],
  ['platerack', 'Plate Rack Dash', 'All six steel plates down in under 6 seconds.'],
  ['bottlebash', 'Bottle Bash', 'You cleared the whole bottle table in 20 seconds.'],
  ['claymaster', 'Clay Master', '8 or more clay pigeons out of 10. Pull!'],
  ['goldenclay', 'Golden Clay', 'You smashed the rare golden clay pigeon.'],
  ['bullseye', 'Marksman', '45+ out of 50 on the 25 m paper target.'],
  ['goldengun', 'The Golden Goose', 'You found the gold-plated pistol hidden on Deadman\'s Island.'],
  ['paintfind', 'Hollow Tree Paintball', 'Someone left a paintball marker inside Stanley Park\'s Hollow Tree.'],
  ['hiddenrifle', 'Grandpa Walt\'s Rifle', 'You found an old hunting rifle in a blind near Lynn Headwaters.'],
  ['trashbandit', 'Trash Bandit', 'A raccoon ran off with your bullseye target.'],
  ['zombiehunter', 'Fright Nights Sharpshooter', '25 Playland zombies dropped with a gun.'],
  ['pal', 'Licensed', 'You passed the firearms safety course and got your PAL.'],
  ['firsthunt', 'Clean, Legal Harvest', 'A legal hunt: licence, tag, season, the right animal. Meat to the food bank.'],
  ['collared', 'Wildlife Biologist', 'You darted an animal and fitted a research GPS collar.'],
];
const SECRET_IDS = new Set(SECRETS.map(s => s[0]));
export function discover(id) {
  if (state.found.has(id) || !SECRET_IDS.has(id)) return;
  state.found.add(id); const s = SECRETS.find(s => s[0] === id);
  player.money += 25; sfx.chime(); ui.toast('🔎 Secret found: ' + s[1], s[2] + ' (+$25)', 4500);
}

// ---------- mission start markers ----------
const startMarkers = [];
export function refreshMarkers() { for (const s of startMarkers) s.b.visible = !state.done.has(s.m.id) && !active; }
export function initMissions(charId) {
  SPOTS.waterfront = { id: 'waterfront', name: 'Waterfront Station', ...XZ(49.2857, -123.1116) }; SPOTS.lonsdale = { id: 'lonsdale', name: 'Lonsdale Quay', ...XZ(49.3100, -123.0832) };
  player.onTransitArrive = (P, stop) => { player.stats.lastStop = stop.name; player.stats.lastLine = P.kind === 'bus' ? 'bus' : P.id; discover(P.kind === 'taxi' ? 'taxiride' : P.kind === 'bus' ? 'bus' : P.id === 'seabus' ? 'seabus' : 'skytrain'); };
  player.onLiftArrive = L => { if (/Peak 2 Peak/i.test(L.name)) { player.stats.p2p = true; discover('peak2peak'); } };
  for (const m of MISSIONS.filter(m => m.who === charId)) addStart(m, '#ffd45c', '⭐');
  for (const m of SIDE) addStart(m, '#4fd1c5', '💼');
}
function addStart(m, color, icon) {
  const p = typeof m.start === 'function' ? m.start() : m.start; if (!p) return;
  const b = new THREE.Mesh(beamGeo, beamMat(color)); b.scale.set(0.6, 0.3, 0.6); b.position.set(p.x, surfaceY(p.x, p.z) + 75, p.z); scene.add(b);
  startMarkers.push({ m, p, b, icon, color });
}
export const missionMarkers = () => {
  const out = startMarkers.filter(s => !state.done.has(s.m.id) && !active).map(s => ({ x: s.p.x, z: s.p.z, icon: s.icon, edge: s.icon === '⭐' }));
  if (state.waypoint) out.push({ x: state.waypoint.x, z: state.waypoint.z, color: '#ffd45c', r: 6, edge: true });
  if (active?.markers) for (const it of active.markers) if (!it.got) out.push({ x: it.p.x, z: it.p.z, color: '#ff7ad9', r: 4, edge: false });
  return out;
};
export const activeMission = () => active;

export async function startMission(m) {
  if (active) return;
  active = { m, deadline: null, text: '' };
  for (const s of startMarkers) s.b.visible = false;
  try {
    await m.run();
    state.done.add(m.id); state.last = { id: m.id, ok: true };
  } catch (e) {
    state.last = { id: m.id, ok: false, reason: e?.message || String(e) };
    if (e instanceof Fail) { sfx.fail(); ui.toast('❌ Mission failed', e.message, 3500); } else { console.error(e); ui.toast('❌ Mission failed', 'Something went wrong', 3000); }
  } finally {
    checks.clear(); active = null; setWaypoint(null); ui.objective(null);
    for (const s of startMarkers) s.b.visible = !state.done.has(s.m.id);
  }
}
export function cancelMission() { if (!active) return; checks.forEach(c => c.res('fail')); }

// ---------- per frame ----------
let promptFor = null, lastGun = -1, lastWhistle = -1;
export function updateMissions(dt) {
  updateShops();
  for (const c of [...checks]) { const r = c.fn(dt); if (r) { checks.delete(c); c.res(r); } }
  if (active) {
    const tl = timeLeft();
    ui.objective(`<b>${active.m.title}</b><br>${active.text}${tl !== null ? `<br>⏱️ ${fmt(tl)}` : ''}${state.waypoint ? `<br><small>${Math.round(dist(state.waypoint))} m away</small>` : ''}`);
  } else ui.objective(gigText() || G.sideObj || (state.waypoint ? `📍 Waypoint: <b>${Math.round(dist(state.waypoint))} m</b>` : null));
  G.sideObj = null;   // timers / hunts (Grouse Grind, payphone riddles, goose chase) set this every frame before updateMissions runs
  if (state.waypoint && !active && !gigActive() && dist(state.waypoint) < 25) setWaypoint(null);

  // mission start prompts
  promptFor = null;
  if (!active && !G.dialogOpen) for (const s of startMarkers) {
    if (state.done.has(s.m.id)) continue;
    if (dist(s.p) < 6) { promptFor = s; break; }
  }
  let prompt = '';
  if (promptFor) { prompt = `<kbd>E</kbd> ${promptFor.icon} ${promptFor.m.title}`; if (tapped('KeyE')) ui.dialog(promptFor.m.title, promptFor.m.desc, ['Start', 'Not now']).then(i => { if (i === 0) startMission(promptFor.m); }); }

  // secrets by proximity
  for (const id of Object.keys(SPOTS)) { const s = SPOTS[id]; if (!state.found.has(id) && Math.hypot(player.x - s.x, player.z - s.z) < (['westlion', 'clevelanddam', 'grouse', 'chief', 'ilanaaq', 'britannia', 'shannon', 'brandywine', 'yvr', 'tower', 'planespot', 'iona'].includes(id) ? 70 : ['greenlake', 'altalake', 'spit', 'ferry', 'brackendale', 'porteau'].includes(id) ? 300 : id === 'lionsgate' ? 40 : 18)) discover(id); }
  const gr = animals.find(a => a.name === 'Coola'); if (gr && Math.hypot(gr.x - player.x, gr.z - player.z) < 25) discover('grizzlies');
  if (G.hour > 17.5 && G.hour < 20 && G.night < 0.8) { const c = animals.find(a => a.kind === 'crow' && Math.hypot(a.x - player.x, a.z - player.z) < 60); if (c) discover('crows'); }
  if (['bike', 'scooter', 'car', 'motorbike', 'jetski', 'heli', 'seaplane'].every(t => player.stats.rode.has(t) || (t === 'car' && [...player.stats.rode].some(r => ['car', 'taxi', 'sports', 'suv', 'van', 'bus'].includes(r))))) discover('allvehicles');

  // interactive spots
  const near = id => SPOTS[id] && Math.hypot(player.x - SPOTS[id].x, player.z - SPOTS[id].z) < 10 && !player.vehicle;
  if (!prompt && near('cauldron') && !SPOTS.cauldron.lit) { prompt = '<kbd>E</kbd> Light the Olympic Cauldron'; if (tapped('KeyE')) { SPOTS.cauldron.lit = true; sfx.chime(); ui.toast('🔥 The cauldron is lit!', 'Somewhere, a 2010 hockey fan sheds a tear'); } }
  if (!prompt && near('deepcove')) { prompt = '<kbd>E</kbd> Buy a honey doughnut ($3)'; if (tapped('KeyE') && player.money >= 3) { player.money -= 3; player.health = 100; sfx.coin(); ui.toast('🍩 Honey doughnut!', 'Fully healed. Worth the ferry-less drive.'); } }
  if (!prompt && near('gassyjack')) { prompt = '<kbd>E</kbd> Talk to Gassy Jack'; if (tapped('KeyE')) ui.toast('🗿 "…"', 'He is a statue. But somehow, he still talks too much.'); }
  if (!prompt && near('laughter')) { prompt = '<kbd>E</kbd> Laugh with them'; if (tapped('KeyE')) { sfx.beep?.(); ui.toast('😂 HAHAHAHA', 'A passing tourist joins in. Now everyone is laughing.'); player.karma += 0; } }
  if (!prompt) prompt = boatPrompt(player);   // charter boats (within 9 m of a host; and on-board offers during a charter)
  if (!prompt) prompt = liftPrompt(player);
  if (!prompt) prompt = transitPrompt(player);
  if (!prompt) prompt = gunPrompt(player);   // guns.js: downed animals, hidden finds, gun shop + range desk
  if (!prompt) prompt = faunaPrompt(player);   // wildlife: make noise at a bear, watch an animal, eat ripe berries (fauna.js / flora.js)
  if (!prompt) prompt = minigamePrompt(player);   // before shops: the pub chalkboards sit right outside pubs that sell pints
  if (!prompt) prompt = qePrompt(player);   // Queen Elizabeth Park coin binoculars
  if (!prompt) prompt = activityPrompt(player);   // sports courts/fields too: a café 14 m away used to hide "play tennis"
  if (!prompt) prompt = shopPrompt(player);
  if (!prompt) prompt = dtesPrompt(player);
  if (!prompt) prompt = seaPrompt(player);
  if (!prompt) prompt = snowFunPrompt(player);
  if (!prompt) prompt = slopesPrompt(player);
  if (!prompt) prompt = trailsPrompt(player);
  if (!prompt) prompt = lifePrompt(player);   // city life: events, bins, cones, scooters, balls…
  if (!prompt) prompt = detailsPrompt(player);
  ui.prompt(prompt);

  // timed events: steam clock whistles every 15 game-minutes, 9 o'clock gun
  const q = Math.floor(G.hour * 4);
  if (q !== lastWhistle) { lastWhistle = q; if (SPOTS.steamclock && Math.hypot(player.x - SPOTS.steamclock.x, player.z - SPOTS.steamclock.z) < 150) sfx.steamWhistle(); }
  if (Math.floor(G.hour) === 21 && lastGun !== Math.floor(G.t / 600)) { lastGun = Math.floor(G.t / 600); if (Math.hypot(player.x - SPOTS.ninegun.x, player.z - SPOTS.ninegun.z) < 600) { sfx.gun(); ui.toast('💥 BOOM!', 'The Nine O\'Clock Gun! Every night since 1898.'); } }

  // seasonal secrets
  if (G.season === 'spring' && !player.vehicle && nearCherry(player.x, player.z)) discover('cherry');
  if (G.fireworksOn && Math.hypot(player.x - EVENT_SPOTS.fireworks.x, player.z - EVENT_SPOTS.fireworks.z) < 1500) discover('fireworks');
  if (G.season === 'winter' && EVENT_SPOTS.xmastree && Math.hypot(player.x - EVENT_SPOTS.xmastree.x, player.z - EVENT_SPOTS.xmastree.z) < 25) discover('xmastree');
  if (G.season === 'fall' && EVENT_SPOTS.pumpkin && Math.hypot(player.x - EVENT_SPOTS.pumpkin.x, player.z - EVENT_SPOTS.pumpkin.z) < 25) discover('pumpkin');
  // ski missions: make snow if the season doesn't have enough
  G.snowLineOverride = ['shred', 'powder', 'dex4'].includes(active?.m.id) ? 700 : null;
  // weather secrets
  if (G.wet > 0.6 && !player.vehicle && !player.umbrella && !player.transit) { player.stats.soakT = (player.stats.soakT || 0) + dt; if (player.stats.soakT > 10) discover('raincouver'); } else player.stats.soakT = 0;
  if (W.rainbow > 0.3 && G.night < 0.3) discover('rainbow');
  // scooter dunk detection
  if (player.vehicle?.type === 'scooter' && isWater(player.x, player.z) && player.y < waterLevel(player.x, player.z) + 0.2) player.stats.dunked = true;
}
