// The ski hills: rental huts at the real resorts (Grouse, Cypress, Seymour, Whistler, Blackcomb), skis / snowboards you can
// rent, buy, swipe off the rack or find lying in the snow, snowmobiles (rent one, or "borrow" the ski patrol's), terrain
// parks with snow kickers + a rail on the fall line, and a few mountain surprises (a lost-and-found treasure, a big hairy
// someone in the trees…).
import * as THREE from 'three';
import { G, scene, std, addMesh, toXZ, canvasTex, tapped, pick, R, hash2 } from './core.js';
import { heightAt, groundY, isSnow, isWater } from './terrain.js';
import { addDeck, buildingAt } from './city.js';
import { makeVehicle } from './vehicles.js';
import { lifts } from './lifts.js';
import { OWN, applyGear } from './shops.js';
import { activeMission, discover } from './missions.js';
import { ui } from './ui.js';
import { sfx } from './sound.js';

const RESORTS = [
  { id: 'grouse', name: 'Grouse Mountain', at: [49.3797, -123.0819] },
  { id: 'cypress', name: 'Cypress Mountain', at: [49.3963, -123.2046] },
  { id: 'seymour', name: 'Mt Seymour', at: [49.3669, -122.9487] },
  { id: 'whistler', name: 'Whistler Village', at: [50.1146, -122.9545] },
  { id: 'roundhouse', name: 'Roundhouse Lodge', at: [50.0676, -122.9470] },
  { id: 'blackcomb', name: 'Blackcomb Base', at: [50.1155, -122.9474] },
  { id: 'rendezvous', name: 'Rendezvous Lodge', at: [50.0711, -122.9121], top: 2200 },   // snapped to the highest lift top nearby
];
const PRICE = { rent: 35, sled: 80, buyski: 450, buyboard: 400 };
const rental = { ski: -1, board: -1 };   // the game day (G.doy) the rental is good for
let pl = null;

const slope = (x, z) => { const e = 4; return Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e); };
function flatSpot(x, z, r = 70) {   // flattest open spot nearby (huts, parked sleds)
  let best = [x, z], bs = 1e9;
  for (let rr = 0; rr <= r; rr += 7) for (let a = 0; a < 6.28; a += rr ? 0.5 : 7) {
    const X = x + Math.cos(a) * rr, Z = z + Math.sin(a) * rr; if (isWater(X, Z) || buildingAt(X, Z)) continue;
    const s = slope(X, Z) + rr * 0.0015; if (s < bs) { bs = s; best = [X, Z]; }
  }
  return best;
}
function downhill(x, z) { const e = 6; const gx = heightAt(x + e, z) - heightAt(x - e, z), gz = heightAt(x, z + e) - heightAt(x, z - e), L = Math.hypot(gx, gz) || 1; return [-gx / L, -gz / L]; }

// ---------- gear ----------
const owns = k => OWN.gear.includes(k === 'ski' ? 'skis' : 'board') || OWN.gear.includes('goldboard');
export function hasGear(kind) { return owns(kind) || rental[kind] === G.doy || !!activeMission(); }
function gearCheck(kind) {
  if (hasGear(kind)) return true;
  ui.toast(kind === 'ski' ? '🎿 No skis!' : '🏂 No snowboard!', 'Rent or buy some at a 🎿 rental hut at the resorts (on the map), swipe a pair off the rack, or find some lost in the snow.', 4200);
  return false;
}

// ---------- rental huts ----------
const wood = std('#7a5534', { roughness: 0.9 }), roofM = std('#2f3b46', { roughness: 0.7 }), snowM = std('#f4f7fb', { roughness: 0.85 });
const RACK_COLS = ['#e53e3e', '#3182ce', '#38a169', '#d69e2e', '#805ad5', '#1a202c', '#ed64a6', '#f6f6f6'];
function hutSign(text) { return canvasTex(512, 128, (c, w, h) => { c.fillStyle = '#1e3a5f'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.font = 'bold 52px Segoe UI, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, w / 2, h / 2, w - 24); }, false); }
function buildHut(Rs) {
  let [x0, z0] = toXZ(...Rs.at);
  if (Rs.top) { let best = -1e9; for (const L of lifts) for (const p of [L.pts[0], L.pts[L.pts.length - 1]]) if (Math.hypot(p.x - x0, p.z - z0) < Rs.top && p.y > best) { best = p.y; Rs.snap = [p.x + 25, p.z + 25]; } if (Rs.snap) [x0, z0] = Rs.snap; }
  const [x, z] = flatSpot(x0, z0), y = heightAt(x, z), [dx, dz] = downhill(x, z), yaw = Math.atan2(-dx, -dz);
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = yaw; scene.add(g);
  addMesh(new THREE.BoxGeometry(6, 3.2, 4.6), wood, 0, 1.6, 0, g);
  for (const s of [-1, 1]) { const r = addMesh(new THREE.BoxGeometry(3.6, 0.15, 5.4), roofM, s * 1.55, 3.85, 0, g); r.rotation.z = -s * 0.55; const sn = addMesh(new THREE.BoxGeometry(3.4, 0.12, 5.2), snowM, s * 1.6, 3.98, 0, g, false); sn.rotation.z = -s * 0.55; }
  addMesh(new THREE.BoxGeometry(2.4, 1.2, 0.1), std('#20262e', { roughness: 0.2, metalness: 0.5 }), -1.2, 1.9, -2.32, g, false);   // service window
  const sg = addMesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ map: hutSign('🎿 RENTALS 🏂') }), 0, 3.1, -2.36, g, false); sg.rotation.y = Math.PI;
  // ski + board racks out front, full of colourful gear (you could just… take a pair)
  for (let i = 0; i < 9; i++) { const k = i % 3 === 2; const m = addMesh(k ? new THREE.BoxGeometry(0.3, 1.5, 0.04) : new THREE.BoxGeometry(0.08, 1.75, 0.03), std(RACK_COLS[(i * 3 + Rs.id.length) % RACK_COLS.length], { roughness: 0.4 }), -2.6 + i * 0.36 + (k ? 0.05 : 0), 0.85, -3.1, g, false); m.rotation.x = -0.18; }
  addMesh(new THREE.BoxGeometry(3.4, 0.08, 0.08), std('#555'), -1.2, 1.35, -3.0, g, false);
  Rs.hut = { x, z, y, yaw, fx: dx, fz: dz };
  // a snowmobile parked by the hut (the ski patrol's…)
  const sx = x + dz * 7, sz = z - dx * 7; Rs.sled = makeVehicle('snowmobile', sx, sz, yaw + 0.4, { color: pick(['#c53030', '#1a202c', '#2b6cb0', '#d69e2e']) }); Rs.sled.keep = true;
}

// ---------- terrain parks: kickers + a rail down the fall line ----------
const kickMat = std('#eef3f8', { roughness: 0.75 }), railM = std('#cfd6dc', { metalness: 0.85, roughness: 0.3 });
function wedge(L, W, H) {
  const g = new THREE.BufferGeometry(), v = [-W / 2, 0, 0, W / 2, 0, 0, W / 2, H, -L, -W / 2, H, -L, -W / 2, 0, -L, W / 2, 0, -L];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex([0, 1, 2, 0, 2, 3, 3, 2, 5, 3, 5, 4, 0, 3, 4, 1, 5, 2]); g.computeVertexNormals(); return g;
}
const kickers = [];
// a snow kicker that follows the slope: starts flush with the snow, rises H above the snow at the lip (drawn = ridden)
function kicker(x, z, dx, dz, L, W, H, list = kickers) {
  const ex = x + dx * L, ez = z + dz * L, g0 = groundY(x, z) - 0.03, g1 = groundY(ex, ez), px = -dz * W / 2, pz = dx * W / 2;
  const v = [x - px, g0, z - pz, x + px, g0, z + pz, ex + px, g1 + H, ez + pz, ex - px, g1 + H, ez - pz, ex - px, g1 - 0.3, ez - pz, ex + px, g1 - 0.3, ez + pz];
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex([0, 2, 1, 0, 3, 2, 3, 5, 2, 3, 4, 5, 0, 4, 3, 1, 2, 5]); g.computeVertexNormals();
  const m = new THREE.Mesh(g, kickMat); m.castShadow = m.receiveShadow = true; m.material.side = THREE.DoubleSide; scene.add(m);
  addDeck(x, z, g0 + 0.03, ex, ez, g1 + H, W / 2); list.push({ x, z, ex, ez }); return [ex, ez];
}
// a jib (rail / wide box / fallen log) along the slope, h above the snow; it's a deck so you slide along it
function jib(x, z, dx, dz, L, h, kind) {
  const ex = x + dx * L, ez = z + dz * L, y0 = groundY(x, z) + h, y1 = groundY(ex, ez) + h;
  const geo = kind === 'box' ? new THREE.BoxGeometry(1.1, 0.12, 1) : kind === 'log' ? new THREE.CylinderGeometry(0.32, 0.38, 1, 10).rotateX(Math.PI / 2) : new THREE.CylinderGeometry(0.05, 0.05, 1, 8).rotateX(Math.PI / 2);
  const mat = kind === 'box' ? std('#e8542a', { roughness: 0.5 }) : kind === 'log' ? std('#5a3b22', { roughness: 1 }) : railM;
  const m = addMesh(geo, mat, (x + ex) / 2, (y0 + y1) / 2 - (kind === 'log' ? 0.3 : 0), (z + ez) / 2); m.scale.z = Math.hypot(L, y1 - y0); m.lookAt(ex, y1 - (kind === 'log' ? 0.3 : 0), ez);
  if (kind !== 'log') for (const t of [0.1, 0.5, 0.9]) { const px = x + dx * L * t, pz = z + dz * L * t, gy = groundY(px, pz); addMesh(new THREE.BoxGeometry(kind === 'box' ? 0.9 : 0.06, h, 0.06), kind === 'box' ? std('#555') : railM, px, gy + h / 2, pz); }
  addDeck(x, z, y0 + 0.06, ex, ez, y1 + 0.06, kind === 'box' ? 0.6 : 0.35); kickers.push({ x, z, ex, ez, rail: true });
}
function parkSign(x, z, dx, dz, text) {
  const px = -dz, pz = dx, y = groundY(x, z);
  for (const s of [-1, 1]) addMesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 6), std('#333'), x + px * s * 3, y + 2, z + pz * s * 3);
  const t = canvasTex(512, 96, (c, w, h) => { c.fillStyle = '#ff7a1a'; c.fillRect(0, 0, w, h); c.fillStyle = '#111'; c.font = 'bold 54px Segoe UI, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, w / 2, h / 2, w - 20); }, false);
  const b = addMesh(new THREE.PlaneGeometry(6, 1.1), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }), x, y + 3.6, z, scene, false); b.lookAt(x - dx, y + 3.6, z - dz);
}
function buildPark(Rs) {
  const h = Rs.hut; let x = h.x + h.fx * 55, z = h.z + h.fz * 55;
  let [dx, dz] = downhill(x, z); parkSign(x, z, dx, dz, '⚡ TERRAIN PARK ⚡');
  const line = [['k', 6, 4, 1.4], ['k', 8, 4.5, 2.0], ['rail', 12, 0.9], ['box', 10, 0.6], ['k', 10, 5, 2.6], ['log', 9, 0.5]];
  if (Rs.id === 'whistler' || Rs.id === 'blackcomb' || Rs.id === 'cypress') line.push(['k', 16, 8, 4.8]);   // the Big Air jump
  for (const [k, L, a, b] of line) {
    x += dx * 30; z += dz * 30; [dx, dz] = downhill(x, z);
    if (isWater(x, z) || buildingAt(x, z)) continue;
    if (k === 'k') kicker(x, z, dx, dz, L, a, b); else jib(x, z, dx, dz, L, k === 'rail' ? a : a, k);
    x += dx * L; z += dz * L;
  }
  // natural "booters" built by locals all over the hill
  for (let i = 0; i < 6; i++) {
    const a = hash2(h.x + i, h.z) * 6.28, r = 180 + hash2(h.z, i * 7) * 700, bx = h.x + Math.cos(a) * r, bz = h.z + Math.sin(a) * r;
    if (isWater(bx, bz) || buildingAt(bx, bz)) continue; const s = slope(bx, bz); if (s < 0.12 || s > 0.6) continue;
    const [ddx, ddz] = downhill(bx, bz); kicker(bx, bz, ddx, ddz, 5, 3, 1.3);
  }
}

// ---------- lost gear in the snow (find it, keep it) ----------
const FINDS = [
  ['skis', '🎿 Somebody\'s skis!', 'Stuck in a snowbank with a note: "back in 5 min — Chad". It\'s been three seasons. They\'re yours now.'],
  ['board', '🏂 A lost snowboard!', 'Covered in stickers from 2009. It still rips.'],
  ['skis', '🎿 Vintage neon skis!', 'Straight out of a 1988 ski movie. You can hear the synth music.'],
  ['board', '🏂 A snowboard in a tree well!', 'Its owner probably went home on the gondola. Finders keepers.'],
];
const stashes = [];
function buildStashes(Rs, i) {
  const h = Rs.hut; let seed = i * 7 + 3;
  for (let k = 0; k < 2; k++) {
    for (let t = 0; t < 30; t++) {
      const a = hash2(seed++, 4) * 6.28, r = 150 + hash2(seed++, 9) * 650, x = h.x + Math.cos(a) * r, z = h.z + Math.sin(a) * r;
      if (isWater(x, z) || buildingAt(x, z) || slope(x, z) > 0.6) continue;
      const f = FINDS[(i + k) % FINDS.length], gold = Rs.id === 'rendezvous' && k === 1;
      const g = new THREE.Group(), y = heightAt(x, z); g.position.set(x, y, z); scene.add(g);
      const col = gold ? std('#d4af37', { metalness: 0.9, roughness: 0.25, emissive: '#4a3a00' }) : std(pick(RACK_COLS), { roughness: 0.4 });
      if (f[0] === 'skis' && !gold) for (const s of [-1, 1]) { const m = addMesh(new THREE.BoxGeometry(0.08, 1.7, 0.03), col, s * 0.12, 0.7, 0, g); m.rotation.z = s * 0.25; }
      else { const m = addMesh(new THREE.BoxGeometry(0.3, 1.5, 0.05), col, 0, 0.62, 0, g); m.rotation.x = 0.2; }
      addMesh(new THREE.SphereGeometry(0.7, 10, 6, 0, 6.28, 0, 1.4).scale(1, 0.5, 1), snowM, 0, 0, 0, g, false);   // snowbank
      stashes.push({ id: Rs.id + k, x, z, g, f, gold });
      break;
    }
  }
}

// ---------- the big hairy someone in the trees ----------
let squatch = null;
function makeSquatch() {
  const g = new THREE.Group(), fur = std('#4a3424', { roughness: 1 });
  addMesh(new THREE.CapsuleGeometry(0.42, 0.9, 4, 10), fur, 0, 1.45, 0, g);
  addMesh(new THREE.SphereGeometry(0.3, 10, 8), fur, 0, 2.3, -0.05, g);
  for (const s of [-1, 1]) { addMesh(new THREE.CapsuleGeometry(0.13, 0.85, 4, 8), fur, s * 0.52, 1.35, 0, g); addMesh(new THREE.CapsuleGeometry(0.17, 0.7, 4, 8), fur, s * 0.2, 0.45, 0, g); }
  g.scale.setScalar(1.15); g.visible = false; scene.add(g); return { g, t: 0, on: false };
}

// ---------- init / prompts / update ----------
export function initSlopes(player) {
  pl = player; player.gearCheck = gearCheck;
  OWN.stash = OWN.stash || [];
  RESORTS.forEach((Rs, i) => { buildHut(Rs); buildPark(Rs); buildStashes(Rs, i); });
  squatch = makeSquatch();
}
export const slopeMarkers = () => RESORTS.filter(r => r.hut).map(r => ({ x: r.hut.x, z: r.hut.z, icon: '🎿' }));
const near = (p, r) => Math.hypot(p.x - pl.x, p.z - pl.z) < r;
export function slopesPrompt(player) {
  if (player.vehicle || player.transit || G.dialogOpen) return '';
  for (const Rs of RESORTS) if (Rs.hut && near(Rs.hut, 7)) { if (tapped('KeyE')) openHut(Rs); return `<kbd>E</kbd> 🎿 ${Rs.name} rentals`; }
  for (const s of stashes) if (s.g.visible && near(s, 3)) { if (tapped('KeyE')) pickStash(s); return `<kbd>E</kbd> ${s.gold ? '✨ Something golden in the snow' : s.f[0] === 'skis' ? '🎿 Skis in the snow' : '🏂 A snowboard in the snow'}`; }
  return '';
}
function give(id) { if (!OWN.gear.includes(id)) OWN.gear.push(id); applyGear?.(); }
function pickStash(s) {
  s.g.visible = false; (OWN.stash ||= []).push(s.id); sfx.coin?.();
  if (s.gold) { give('goldboard'); ui.toast('✨ THE GOLDEN BOARD!', 'Legend says a pro left it up here after the 2010 Olympics. Gold board + skis: faster on every run!', 5000); discover('goldstash'); return; }
  give(s.f[0]); ui.toast(s.f[1], s.f[2], 4500);
}
async function openHut(Rs) {
  const own = { ski: OWN.gear.includes('skis'), board: OWN.gear.includes('board') }, today = k => rental[k] === G.doy;
  const opts = [
    own.ski ? '✅ You own skis' : today('ski') ? '✅ Skis rented for today' : `🎿 Rent skis for the day · $${PRICE.rent}`,
    own.board ? '✅ You own a snowboard' : today('board') ? '✅ Board rented for today' : `🏂 Rent a snowboard for the day · $${PRICE.rent}`,
    own.ski ? '—' : `🎿 Buy your own skis · $${PRICE.buyski}`,
    own.board ? '—' : `🏂 Buy your own snowboard · $${PRICE.buyboard}`,
    `🛷 Rent a snowmobile · $${PRICE.sled}`,
    '🤫 Grab a pair off the rack when nobody\'s looking (-2 karma)',
    'Just looking',
  ];
  const lines = ['"Bro. The pow is SO deep today."', '"Helmets are free. Brains are not."', '"Boots are size 9 or size 13. Pick your pain."', '"Last guy tried to ski in jeans. We don\'t talk about him."'];
  const i = await ui.dialog('🎿 ' + Rs.name + ' Rentals', 'Rental tech: ' + pick(lines) + '<br><small>Rentals last until midnight. Gear you buy is yours forever.</small>', opts);
  const pay = n => { if (pl.money < n) { ui.toast('💳 Card declined', 'Not enough money. (There\'s always the rack…)', 2500); return false; } pl.money -= n; sfx.coin?.(); return true; };
  if (i === 0 && !own.ski && !today('ski') && pay(PRICE.rent)) { rental.ski = G.doy; ui.toast('🎿 Skis rented!', 'Press K on the snow to click in. Good until midnight.', 3500); }
  else if (i === 1 && !own.board && !today('board') && pay(PRICE.rent)) { rental.board = G.doy; ui.toast('🏂 Board rented!', 'Press B on the snow to strap in. Good until midnight.', 3500); }
  else if (i === 2 && !own.ski && pay(PRICE.buyski)) { give('skis'); ui.toast('🎿 Your own skis!', 'K on any snowy mountain, forever.', 3500); }
  else if (i === 3 && !own.board && pay(PRICE.buyboard)) { give('board'); ui.toast('🏂 Your own snowboard!', 'B on any snowy mountain, forever.', 3500); }
  else if (i === 4 && pay(PRICE.sled)) { spawnSled(Rs, true); }
  else if (i === 5) {
    pl.karma -= 2; const kind = Math.random() < 0.5 ? 'ski' : 'board'; give(kind === 'ski' ? 'skis' : 'board');
    ui.toast(kind === 'ski' ? '🎿 Swiped a pair of skis!' : '🏂 Swiped a snowboard!', pick(['The rental tech was busy explaining wax to a tourist. (-2 karma)', 'Someone yells "HEY!" but they\'re in ski boots. You\'re long gone. (-2 karma)', 'Nobody saw. Except a whisky jack. It judges you. (-2 karma)']), 4000);
  }
}
function spawnSled(Rs, paid) {
  const h = Rs.hut, x = h.x - h.fz * 6 + h.fx * 4, z = h.z + h.fx * 6 + h.fz * 4;
  const v = makeVehicle('snowmobile', x, z, h.yaw, { color: pick(['#f6e05e', '#38a169', '#e53e3e', '#3182ce']) }); v.owned = true; v.keep = true;
  pl.enterVehicle(v); ui.toast('🛷 Snowmobile!', 'W/S throttle, A/D steer, Space = jump (A/D spin, W/S flip in the air). It crawls on dry ground. F to hop off.', 4500);
}
let sqT = 30, tipT = 0, sledDist = 0;
export function updateSlopes(dt, player) {
  // snowmobiles bog down off the snow
  const v = player.vehicle;
  if (v && v.type === 'snowmobile') {
    if (!isSnow(v.x, v.z, v.y)) { v.speed = Math.max(-4, Math.min(v.speed, 7)); tipT -= dt; if (tipT < 0) { tipT = 20; ui.toast('🛷 Scraaape…', 'Snowmobiles need snow. On dry ground they crawl.', 2200); } }
    else { sledDist += Math.abs(v.speed) * dt; if (sledDist > 1000) discover('sledneck'); }
  }
  // the kicker park: first trick landed off one = secret
  if (player.air && player.board && kickers.some(k => near(k, 20))) player.kickAir = true;
  if (player.kickAir && !player.air) { player.kickAir = false; if ((player.stats.tricks || 0) > 0) discover('kickerpark'); }
  // stashes already found stay gone
  if (OWN.stash) for (const s of stashes) if (s.g.visible && OWN.stash.includes(s.id)) s.g.visible = false;
  // rentals end at midnight
  for (const k of ['ski', 'board']) if (rental[k] >= 0 && rental[k] !== G.doy) { rental[k] = -1; if (player.board === k && !hasGear(k)) { player.board = false; ui.toast('⏰ Rental returned', 'It\'s past midnight: the rental shop wants its gear back.', 3000); } }
  // a big hairy someone at the edge of the trees: only on snowy mountains, rarely, and gone when you get close
  sqT -= dt;
  if (!squatch.on && sqT < 0) {
    sqT = 40;
    if (isSnow(player.x, player.z) && !player.vehicle && Math.random() < 0.35) {
      const a = Math.random() * 6.28, d = R(70, 110), x = player.x + Math.cos(a) * d, z = player.z + Math.sin(a) * d;
      if (!isWater(x, z) && !buildingAt(x, z)) { squatch.on = true; squatch.t = 0; squatch.g.position.set(x, heightAt(x, z), z); squatch.g.lookAt(player.x, heightAt(x, z), player.z); squatch.g.visible = true; squatch.dir = a; }
    }
  }
  if (squatch.on) {
    const g = squatch.g, d = Math.hypot(g.position.x - player.x, g.position.z - player.z); squatch.t += dt;
    if (d < 85 && squatch.t > 0.5) discover('sasquatch');
    if (d < 45 || squatch.t > 25) {   // it turns and lopes off into the forest
      const ax = Math.cos(squatch.dir), az = Math.sin(squatch.dir); g.position.x += ax * 9 * dt; g.position.z += az * 9 * dt; g.position.y = heightAt(g.position.x, g.position.z); g.rotation.y = Math.atan2(ax, az);
      if (d > 140) { squatch.on = false; g.visible = false; }
    }
  }
}
export const _slopes = { RESORTS, stashes, kickers, rental };   // for tests
