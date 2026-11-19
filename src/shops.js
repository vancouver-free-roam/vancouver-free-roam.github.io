// Shops & money: snacks at every real café / restaurant, parody flagship stores (clothes, gear, cars, real estate),
// property that pays rent every game day, and a repeatable food-delivery gig to earn cash.
import * as THREE from 'three';
import { G, scene, std, addMesh, toXZ, canvasTex, tapped, farCull, pick } from './core.js';
import { isWater } from './terrain.js';
import { surfaceY, buildingAt, pois, nearestRoad, NX, NZ } from './city.js';
import { makeVehicle, vehicles, removeVehicle } from './vehicles.js';
import { player } from './player.js';
import { nearestPed } from './people.js';
import { ui } from './ui.js';
import { sfx } from './sound.js';
import { activeMission, discover, setWaypoint } from './missions.js';
import { enterHome } from './interiors.js';

// everything the player owns (saved in the save game)
export const OWN = { outfits: [], outfit: 'orig', rides: [], props: [], gear: [], spent: 0, gigs: 0 };
const fresh = () => ({ outfits: [], outfit: 'orig', rides: [], props: [], gear: [], spent: 0, gigs: 0 });

export const OUTFITS = [
  { id: 'orig', name: 'Your usual look', price: 0 },
  { id: 'yoga', name: 'Yoga Pants Lifestyle', price: 120, shirt: '#2d3748', pants: '#111111', joke: 'You now walk 15% more smugly.' },
  { id: 'denim', name: 'Canadian Tuxedo (denim on denim)', price: 90, shirt: '#4a6fa5', pants: '#2c4a7a', joke: 'Bold. Patriotic. Slightly itchy.' },
  { id: 'jersey', name: 'Hockey Jersey (blue & green)', price: 150, shirt: '#0b3d91', pants: '#1a202c', joke: 'This is the year. (It is never the year.)' },
  { id: 'vest', name: 'Fleece Vest Tech Bro', price: 200, shirt: '#a0aec0', pants: '#c4b59a', joke: 'You feel a sudden urge to say "synergy".' },
  { id: 'shell', name: 'Rain Shell Supreme ($600 jacket)', price: 600, shirt: '#f6e05e', pants: '#1a202c', joke: 'Waterproof, windproof and wallet-proof.' },
];
export const RIDES = [
  { type: 'car', name: 'Sensible hatchback', price: 600, color: '#2f855a' },
  { type: 'motorbike', name: 'Motorbike', price: 900, color: '#1a202c' },
  { type: 'suv', name: 'SUV (for the one snowy day a year)', price: 1200, color: '#e2e8f0' },
  { type: 'sports', name: 'Sports car (midlife crisis edition)', price: 3500, color: '#e53e3e' },
  { type: 'heli', name: 'Helicopter (skip the Lions Gate traffic)', price: 15000 },
];
const GEAR = [
  { id: 'ebike', name: 'Your own e-bike (no more rental fees)', price: 250, ride: 'bike' },
  { id: 'goldumb', name: 'Golden umbrella', price: 60 },
  { id: 'goldboard', name: 'Gold snowboard + skis (faster!)', price: 400 },
];
export const PROPS = [
  { id: 'closet', name: 'Yaletown "micro-loft" (it\'s a closet)', at: [49.2747, -123.1206], price: 800, rent: 25 },
  { id: 'loft', name: 'Gastown loft above a cocktail bar', at: [49.2836, -123.1060], price: 3000, rent: 90 },
  { id: 'shack', name: 'Kits Beach shack', at: [49.2730, -123.1540], price: 8000, rent: 250 },
  { id: 'cabin', name: 'Deep Cove cabin', at: [49.3270, -122.9500], price: 14000, rent: 420 },
  { id: 'chalet', name: 'Whistler ski chalet', at: [50.1170, -122.9600], price: 20000, rent: 650 },
  { id: 'mansion', name: 'Shaughnessy mansion', at: [49.2565, -123.1400], price: 75000, rent: 2500 },
];
const STORES = [
  { id: 'lulu', name: 'Lululemony', icon: '👖', color: '#c53030', at: [49.2683, -123.1545], open: openClothes },
  { id: 'mec', name: 'Mountain Equipment Co-Nope', icon: '🎒', color: '#2f855a', at: [49.2634, -123.1062], open: openGear },
  { id: 'cars', name: 'Kits Motors', icon: '🚗', color: '#2b6cb0', at: [49.2668, -123.1452], open: openCars },
  { id: 'realty', name: 'Re/Maxed-Out Realty', icon: '🏠', color: '#d69e2e', at: [49.2758, -123.1222], open: openRealty },
];

function openSpot(x, z, pad = 3) { for (let r = 0; r < 150; r += 4) for (let a = 0; a < 6.28; a += 0.4) { const X = x + Math.cos(a) * r, Z = z + Math.sin(a) * r; if (!isWater(X, Z) && !buildingAt(X, Z) && !buildingAt(X + pad, Z) && !buildingAt(X - pad, Z) && !buildingAt(X, Z + pad) && !buildingAt(X, Z - pad)) return [X, Z]; } return [x, z]; }
const near = (p, r) => Math.hypot(player.x - p.x, player.z - p.z) < r;
const money = n => '$' + Math.round(n).toLocaleString('en-CA');

// ---------- store fronts ----------
function storeSign(name, color, icon) {
  const tex = canvasTex(512, 128, (c, w, h) => { c.fillStyle = color; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.font = 'bold 46px Segoe UI, Arial'; c.textBaseline = 'middle'; c.textAlign = 'center'; c.fillText(icon + ' ' + name, w / 2, h / 2, w - 30); }, false);
  return new THREE.Mesh(new THREE.PlaneGeometry(7, 1.75), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, emissive: '#333', emissiveMap: tex }));
}
function buildStores() {
  for (const s of STORES) {
    const [x, z] = openSpot(...toXZ(...s.at), 5), y = surfaceY(x, z);
    s.x = x; s.z = z;
    const g = new THREE.Group(); g.position.set(x, y, z); scene.add(g); farCull(g, 1200);
    addMesh(new THREE.BoxGeometry(7, 4.2, 5), std('#f7f3ea'), 0, 2.1, 0, g);
    addMesh(new THREE.BoxGeometry(5.6, 2.6, 0.1), std('#9fd3e6', { metalness: 0.6, roughness: 0.1, transparent: true, opacity: 0.7 }), 0, 1.6, -2.52, g);
    addMesh(new THREE.BoxGeometry(7.4, 0.25, 1.6), std(s.color), 0, 3.3, -3.1, g).rotation.x = -0.25;
    const sg = storeSign(s.name, s.color, s.icon); sg.position.set(0, 5.2, -2.3); g.add(sg);
    const sg2 = sg.clone(); sg2.position.set(0, 5.2, 2.3); g.add(sg2);
  }
}

// ---------- snacks at every real café and restaurant ----------
const FOOD = { cafe: ['☕ Buy a coffee', 5, 'coffee'], fast_food: ['🌭 Grab a quick bite', 8, 'food'], restaurant: ['🍜 Eat here', 18, 'food'], ice_cream: ['🍦 Get ice cream', 6, 'food'], pub: ['🍺 Have a pint', 9, 'food'], bar: ['🍹 Have a drink', 12, 'food'] };
const foodGrid = new Map(), foodList = [];
const fk = (i, j) => i * 100003 + j;
function buildFood() {
  for (const p of pois) { if (!FOOD[p.k]) continue; foodList.push(p); const k = fk(Math.floor(p.x / 50), Math.floor(p.z / 50)); let a = foodGrid.get(k); if (!a) foodGrid.set(k, a = []); a.push(p); }
}
function nearestFood(x, z, r) {
  let best = null, bd = r; const i0 = Math.floor(x / 50), j0 = Math.floor(z / 50);
  for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) for (const p of foodGrid.get(fk(i, j)) || []) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } }
  return best;
}
const COFFEE = ['An oat-milk lavender latte. It tastes like a candle. You love it.', 'The barista spells your name "Brayden". Close enough.', 'Pour-over, single origin, 11 minutes. Worth it?', 'A London Fog. Peak Vancouver.'];
const SNACK = ['Delicious. You rate it 5 stars on an app nobody reads.', 'You eat it standing up. Like a true local in a hurry.', 'A seagull eyes your food. You eat faster.', 'Sushi so good you consider moving here. Oh wait, you live here.'];
function buyFood(p) {
  const [, price, kind] = FOOD[p.k];
  if (!spend(price)) return;
  player.stats.bought = player.stats.bought || new Set(); player.stats.bought.add(kind);
  if (kind === 'coffee') { player.buffT = 90; player.health = Math.min(100, player.health + 20); ui.toast('☕ Caffeinated!', pick(COFFEE) + ' (run faster for 90 s)', 3500); }
  else { player.health = 100; ui.toast('😋 Yum! Full health', pick(SNACK), 3000); }
}

// ---------- spending ----------
export function spend(price) {
  if (player.money < price) { sfx.fail?.(); ui.toast('💳 Card declined', `You need ${money(price)}. Do some missions or delivery gigs (phone → Wallet).`, 3000); return false; }
  player.money -= price; OWN.spent += price; sfx.coin();
  if (OWN.spent >= 5000) discover('bigspender');
  return true;
}

// ---------- outfits ----------
export function wear(id) {
  const o = OUTFITS.find(o => o.id === id) || OUTFITS[0], m = player.model?.mats; if (!m) return;
  const look = player.char.look;
  m.shirt.color.set(o.shirt || look.shirt); m.pants.color.set(o.pants || look.pants);
  OWN.outfit = o.id;
}
async function openClothes() {
  const opts = OUTFITS.map(o => (o.id === 'orig' || OWN.outfits.includes(o.id)) ? (OWN.outfit === o.id ? '✅ Wearing: ' : '👕 Wear: ') + o.name : `${o.name} · ${money(o.price)}`);
  const i = await ui.dialog('👖 Lululemony', 'Stretchy pants, $100 water bottles and jackets for every kind of rain. What are you trying on?', [...opts, 'Just browsing']);
  const o = OUTFITS[i]; if (!o) return;
  if (o.id !== 'orig' && !OWN.outfits.includes(o.id)) { if (!spend(o.price)) return; OWN.outfits.push(o.id); player.stats.bought = player.stats.bought || new Set(); player.stats.bought.add('outfit'); ui.toast('🛍️ New outfit: ' + o.name, o.joke, 3500); }
  wear(o.id);
}

// ---------- gear ----------
export function applyGear() {
  player.goldBoard = OWN.gear.includes('goldboard');
  if (player.boardMesh) player.boardMesh.material.color.set(player.goldBoard ? '#d4af37' : '#e53e3e');
  if (player.umbrellaMesh && OWN.gear.includes('goldumb')) player.umbrellaMesh.children[0].material.color.set('#d4af37');
}
async function openGear() {
  const opts = GEAR.map(g => OWN.gear.includes(g.id) ? '✅ Owned: ' + g.name : `${g.name} · ${money(g.price)}`);
  const i = await ui.dialog('🎒 Mountain Equipment Co-Nope', 'Everything you need to look outdoorsy at the brewery. Members get a free sense of superiority.', [...opts, 'Leave']);
  const g = GEAR[i]; if (!g || OWN.gear.includes(g.id)) return;
  if (!spend(g.price)) return;
  OWN.gear.push(g.id); applyGear();
  if (g.ride) { OWN.rides.push(g.ride); callRide(g.ride); }
  ui.toast('🎒 Bought: ' + g.name, g.ride ? 'It\'s parked right outside. Call it any time from your phone (Wallet tab).' : g.id === 'goldboard' ? 'Press B or K on snow. You are now 25% faster and 100% shinier.' : 'Press U. Rain has never looked so expensive.', 4000);
}

// ---------- cars ----------
let called = {};   // type -> vehicle you called
export function callRide(type) {
  const r = RIDES.find(r => r.type === type) || { type, color: '#2b6cb0' };
  if (called[type] && vehicles.includes(called[type]) && called[type].driver !== 'player') removeVehicle(called[type]);
  let x, z, yaw = player.yaw;
  if (type === 'heli') { [x, z] = openSpot(player.x + 12, player.z, 9); }
  else {
    const nr = nearestRoad(player.x, player.z, 120, rd => rd.t <= 5);
    if (nr) { const e = nr.e; x = NX(e.a) + (NX(e.b) - NX(e.a)) * nr.t; z = NZ(e.a) + (NZ(e.b) - NZ(e.a)) * nr.t; yaw = Math.atan2(-(NX(e.b) - NX(e.a)), -(NZ(e.b) - NZ(e.a))); }
    else [x, z] = openSpot(player.x + 4, player.z, 3);
  }
  if (isWater(x, z)) { ui.toast('🚫 No room here', 'Try again on dry land.', 2000); return null; }
  const v = makeVehicle(type, x, z, yaw, { keep: true, color: r.color }); v.owned = true; called[type] = v;
  return v;
}
async function openCars() {
  const opts = RIDES.map(r => OWN.rides.includes(r.type) ? '🔑 Owned: ' + r.name + ' (bring it here)' : `${r.name} · ${money(r.price)}`);
  const i = await ui.dialog('🚗 Kits Motors', 'Salesman: "This baby has heated seats AND a roof rack for your kayak. Everyone in Kits has a kayak. Do you have a kayak?"', [...opts, 'Just looking']);
  const r = RIDES[i]; if (!r) return;
  if (!OWN.rides.includes(r.type)) { if (!spend(r.price)) return; OWN.rides.push(r.type); ui.toast('🔑 You bought a ' + r.name.split(' (')[0].toLowerCase() + '!', 'It\'s yours: no karma loss, and you can call it from your phone (Wallet tab).', 4000); }
  callRide(r.type);
}

// ---------- real estate ----------
export const rentPerDay = () => PROPS.filter(p => OWN.props.includes(p.id)).reduce((a, p) => a + p.rent, 0);
async function openRealty() {
  const opts = PROPS.map(p => OWN.props.includes(p.id) ? `🏠 Owned: ${p.name} (+${money(p.rent)}/day)` : `${p.name} · ${money(p.price)} → +${money(p.rent)}/day rent`);
  const realtor = player.char.id === 'brenda' ? 'Your rival realtor sneers: "Oh, it\'s YOU, Brenda. Fine. I\'ll sell to you. Cash only."' : 'Realtor: "It\'s a great time to buy! (It is always a great time to buy.) Tenants pay you rent every game day at midnight."';
  const i = await ui.dialog('🏠 Re/Maxed-Out Realty', realtor, [...opts, 'Keep renting']);
  const p = PROPS[i]; if (!p || OWN.props.includes(p.id)) return;
  if (!spend(p.price)) return;
  OWN.props.push(p.id); discover('landlord'); buildDoor(p);
  ui.toast('🏠 SOLD! ' + p.name, `Tenants pay you ${money(p.rent)} every game day. Walk in through the 🏠 front door, or go home for free from your phone (Wallet tab).`, 5000);
}
export function goHome(id) {
  const p = PROPS.find(p => p.id === id); if (!p) return;
  if (player.vehicle) player.exitVehicle(true);
  buildDoor(p); player.teleport(p.dx, p.dz + 2.5);
}
// the front door of a place you own (walk up + E to go inside)
const doors = new Map();
function buildDoor(p) {
  if (doors.has(p.id)) return;
  const [x, z] = openSpot(...toXZ(...p.at), 3), y = surfaceY(x, z); p.dx = x; p.dz = z;
  const g = new THREE.Group(); g.position.set(x, y, z); scene.add(g); farCull(g, 900); doors.set(p.id, g);
  addMesh(new THREE.BoxGeometry(2.0, 0.2, 1.4), std('#9a9a92'), 0, 0.1, 0.4, g);
  addMesh(new THREE.BoxGeometry(1.6, 2.6, 0.3), std('#f7f3ea'), 0, 1.3, 0, g);
  addMesh(new THREE.BoxGeometry(1.1, 2.1, 0.08), std('#2f855a'), 0, 1.15, 0.17, g);
  addMesh(new THREE.SphereGeometry(0.05, 8, 6), std('#d4af37', { metalness: 1, roughness: 0.3 }), 0.4, 1.1, 0.23, g, false);
  addMesh(new THREE.BoxGeometry(0.9, 0.02, 0.5), std('#7a6a4a'), 0, 0.21, 0.75, g, false);
  const sg = storeSign('Your place', '#2f855a', '🏠'); sg.scale.setScalar(0.45); sg.position.set(0, 2.95, 0.18); g.add(sg);
}
let lastHour = null;
export function skipNight() { payday(); lastHour = null; }
function payday() {
  const rent = rentPerDay(); if (!rent) return;
  player.money += rent; sfx.coin();
  ui.toast('🏠 Rent day! +' + money(rent), pick(['Your tenants paid on time. Suspicious.', 'One tenant paid in exposure. You took it anyway.', 'A tenant asks you to fix the leak. You pretend not to see the text.']), 4500);
}

// ---------- delivery gig ----------
let gig = null;
const DISHES = ['a poke bowl', 'butter chicken', 'a hot dog with seaweed on it', 'dim sum for 8', 'one (1) fry', 'a $24 avocado toast', 'pho', 'a whole pizza and 6 Nanaimo bars'];
export const gigActive = () => !!gig;
export function startGig() {
  if (gig) return false;
  const am = activeMission(); if (am && am.m.id !== 'gigeconomy') { ui.toast('📱 Finish your mission first', 'One job at a time!', 2500); return false; }
  const c = foodList.filter(p => { const d = Math.hypot(p.x - player.x, p.z - player.z); return d > 150 && d < 1000; });
  if (!c.length) { ui.toast('📱 No orders out here', 'Head into the city, where the restaurants are.', 3000); return false; }
  const from = pick(c); let to = null;
  for (let k = 0; k < 60 && !to; k++) {
    const a = Math.random() * 6.28, r = 400 + Math.random() * 900, nr = nearestRoad(from.x + Math.cos(a) * r, from.z + Math.sin(a) * r, 80, rd => rd.t >= 3 && rd.t <= 5);
    if (!nr) continue; const e = nr.e, x = NX(e.a) + (NX(e.b) - NX(e.a)) * nr.t, z = NZ(e.a) + (NZ(e.b) - NZ(e.a)) * nr.t;
    if (!isWater(x, z) && !buildingAt(x, z)) to = { x, z };
  }
  if (!to) { ui.toast('📱 No orders right now', 'Try again in a minute.', 2500); return false; }
  const d = Math.hypot(from.x - player.x, from.z - player.z) + Math.hypot(to.x - from.x, to.z - from.z);
  gig = { stage: 'pickup', from, to, dish: pick(DISHES), pay: Math.round(15 + d / 50), end: G.t + d / 6 + 60 };
  setWaypoint(from.x, from.z, 'Pickup');
  ui.toast('📱 New order: ' + gig.dish, `Pick it up at the 📍 restaurant, then deliver it. Pays ${money(gig.pay)} + tip if you're fast.`, 4000);
  return true;
}
export function stopGig() { gig = null; setWaypoint(null); }
export function cancelGig() { if (!gig) return; gig = null; setWaypoint(null); ui.toast('📱 Order cancelled', 'The customer leaves you a 1-star review: "never came 😡".', 2500); }
export function gigText() {
  if (!gig) return '';
  const tl = Math.max(0, gig.end - G.t), mm = Math.floor(tl / 60), ss = String(Math.floor(tl % 60)).padStart(2, '0');
  const tgt = gig.stage === 'pickup' ? gig.from : gig.to, d = Math.round(Math.hypot(tgt.x - player.x, tgt.z - player.z));
  return `🛵 <b>Delivery:</b> ${gig.stage === 'pickup' ? 'pick up ' + gig.dish : 'deliver ' + gig.dish} · ${d} m<br>⏱️ ${tl > 0 ? mm + ':' + ss : 'late!'} · ${money(gig.pay)}`;
}
function updateGig() {
  if (!gig) return;
  if (gig.stage === 'pickup' && near(gig.from, 28)) { gig.stage = 'drop'; setWaypoint(gig.to.x, gig.to.z, 'Drop-off'); sfx.chime?.(); ui.toast('📦 Order picked up', 'Now deliver it to the 📍. Don\'t eat any.', 2500); }
  else if (gig.stage === 'drop' && near(gig.to, 15)) {
    const fast = G.t <= gig.end, tip = fast ? Math.round(gig.pay * 0.5) : 0, pay = fast ? gig.pay : Math.round(gig.pay / 2);
    player.money += pay + tip; sfx.coin(); setWaypoint(null);
    OWN.gigs++; player.stats.gigs = (player.stats.gigs || 0) + 1;
    ui.toast(`✅ Delivered! +${money(pay + tip)}`, fast ? `Tip: ${money(tip)}. The customer says "you're a legend". 5 stars.` : 'It was cold. Half pay and a 2-star review: "soggy fries".', 3500);
    gig = null;
  }
}

// ---------- every frame ----------
export function initShops() { buildStores(); buildFood(); }
export function shopMarkers() { return STORES.map(s => ({ x: s.x, z: s.z, icon: s.icon })); }
export function shopPrompt(pl) {
  if (pl.vehicle || pl.transit || G.dialogOpen) return '';
  for (const p of PROPS) if (p.dx !== undefined && OWN.props.includes(p.id) && Math.hypot(pl.x - p.dx, pl.z - (p.dz + 0.8)) < 3) {
    if (tapped('KeyE')) { const am = activeMission(); if (gig) ui.toast('📱 Deliver your order first!', '', 2000); else if (am && am.m.id !== 'housewarming') ui.toast('Finish your mission first', 'Home will still be here.', 2000); else enterHome(p.id); }
    return '<kbd>E</kbd> 🏠 Go inside: ' + p.name;
  }
  for (const s of STORES) if (near(s, 9)) { if (tapped('KeyE')) s.open(); return `<kbd>E</kbd> ${s.icon} Shop at ${s.name}`; }
  const f = !nearestPed(pl.x, pl.z, 2.2) && nearestFood(pl.x, pl.z, 14);   // someone right next to you? then E is for chatting
  if (f) { const [label, price] = FOOD[f.k]; if (tapped('KeyE')) buyFood(f); return `<kbd>E</kbd> ${label} (${money(price)})`; }
  return '';
}
export function updateShops() {
  if (player.buffT > 0) player.buffT -= G.dt;
  if (lastHour !== null && lastHour > 20 && G.hour < 4) payday();   // only a real midnight (not setting the clock back)
  lastHour = G.hour;
  updateGig();
}

// ---------- save / load ----------
export function shopSave() { return { ...OWN }; }
export function shopLoad(s) {
  Object.assign(OWN, fresh(), s || {}); called = {}; gig = null; lastHour = null;
  wear(OWN.outfit); applyGear();
  for (const p of PROPS) if (OWN.props.includes(p.id)) buildDoor(p);
}
