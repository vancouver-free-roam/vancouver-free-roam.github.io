// Guns: gun counters at real gun shops + a parody outdoors shop with a shooting range, aiming over the shoulder (or
// first person on C), hitscan bullets with damage + penetration, shotgun pellets, arrows/bolts/darts/flares/paint/
// water/foam as real arcs, bear spray as a cone. Targets, clay pigeons, breakable street props (by weapon power),
// vehicles (holes, smoke, panicking drivers), Fright Nights zombies, BC-rules hunting (licence, tags, seasons, legal
// species, weapon class; poaching = a conservation fine) and people: bullets hurt or kill pedestrians, tranq darts put
// them to sleep, bear spray stuns them, and the police come (police.js wanted stars). Children and the Downtown
// Eastside characters are never targets (the shot is blocked).
// Keys: O = draw / holster, 1-9 / 0 = pick a gun (press again to cycle that slot), mouse wheel = next gun,
// R = reload, right mouse = aim (scope on the rifles), left click = shoot (hold to draw a bow).
import * as THREE from 'three';
import { G, scene, camera, std, addMesh, canvasTex, depthBias, tapped, key, clamp, lerp, pick, R, toXZ, wrapAngle } from './core.js';
import { groundY, isWater, waterLevel, heightAt } from './terrain.js';
import { buildingAt, walkY, surfaceY, inRoadway, nearestRoad } from './city.js';
import { peds, zombies, zstats, say, makeHuman, ZONE } from './people.js';
import { vehicles, knock } from './vehicles.js';
import { _colliderGrids, collideStatic, setColliders } from './colliders.js';
import { _fauna } from './fauna.js';
import { _dtes } from './dtes.js';
import { OWN, spend } from './shops.js';
import { ui } from './ui.js';
import { beep, noise, swish } from './sound.js';
import { discover, activeMission, setWaypoint } from './missions.js';
import { camModeNow } from './player.js';
import { WANTED, addCrime, hurtCop, initPolice, updatePolice } from './police.js';
import { _air, airHooks } from './airtraffic.js';

let player = null;
const money = n => '$' + Math.round(n).toLocaleString('en-CA');

// ---------- the guns ----------
// mag = rounds per load, rate = s between shots, spread = radians at the hip (ads = aimed), dmg = damage per hit
// (a person has 100), pen = how many bodies/thin things a round goes through, power = what it can smash (1 bins and
// bottles … 4 lamp posts), fx = what kind of hit it is, proj = a slow projectile (m/s) with gravity `grav` (×g),
// kick = recoil (rad), ammo = which box it eats, cls = hunting class (big = big game, small = grouse/hare only)
export const GUNS = {
  pistol: { name: 'Range rental pistol', icon: '🔫', slot: 1, mag: 15, rate: 0.16, reload: 1.3, spread: 0.02, ads: 0.006, range: 120, kick: 0.035, ammo: '9mm', snd: 'pistol', rental: true, dmg: 40, pen: 0, power: 2, fx: 'bullet', desc: '9 mm semi-auto. Quick, light recoil. Range use only.' },
  golden: { name: 'The Golden Goose', icon: '✨', slot: 1, mag: 7, rate: 0.2, reload: 0.9, spread: 0.012, ads: 0.002, range: 300, kick: 0.04, ammo: null, snd: 'golden', golden: true, dmg: 200, pen: 2, power: 4, fx: 'bullet', desc: 'Gold-plated, one of a kind. Unlimited ammo, absurd power.' },
  rifle: { name: 'Tikka-Tikka T3 hunting rifle', icon: '🎯', slot: 2, mag: 4, rate: 1.0, reload: 2.2, spread: 0.015, ads: 0.0008, range: 800, kick: 0.09, ammo: '308', snd: 'rifle', price: 1200, scope: true, zooms: [14, 9, 5], pal: true, dmg: 130, pen: 1, power: 3, fx: 'bullet', cls: 'big', desc: '.308 bolt-action with a 3-9× scope. The classic BC deer rifle.' },
  magnum: { name: 'Wackley-Richards .375 "Bear Necessity"', icon: '🐘', slot: 2, mag: 3, rate: 1.35, reload: 2.8, spread: 0.02, ads: 0.001, range: 900, kick: 0.17, ammo: '375', snd: 'magnum', price: 2600, scope: true, zooms: [12, 7], pal: true, dmg: 240, pen: 3, power: 4, fx: 'bullet', cls: 'big', push: 1.6, desc: 'Dangerous-game magnum. Punches through 3 things, rocks parked cars, snaps lamp posts. Kicks like a moose.' },
  sniper: { name: 'Long Shot .338 "Bowen Island Express"', icon: '🔭', slot: 2, mag: 5, rate: 1.5, reload: 3.0, spread: 0.03, ads: 0.0002, range: 2200, kick: 0.13, ammo: '338', snd: 'sniper', price: 5200, scope: true, zooms: [16, 8, 4, 2, 1.1], pal: true, dmg: 260, pen: 2, power: 4, fx: 'bullet', cls: 'big', desc: 'Long-range precision rifle: 2 km reach, a 5-step zoom scope (mouse wheel while aiming), useless from the hip. Shoots down aircraft from the ground.' },
  shotgun: { name: 'Mossbergy 500 pump shotgun', icon: '💥', slot: 3, mag: 6, rate: 0.75, reload: 2.6, spread: 0.045, ads: 0.035, pellets: 9, range: 70, kick: 0.11, ammo: '12ga', snd: 'shotgun', price: 650, pal: true, dmg: 17, pen: 0, power: 3, fx: 'pellet', cls: 'small', falloff: 25, desc: '9 pellets per shell: brutal up close, weak past 25 m. Clays, grouse, zombies.' },
  rugrat: { name: 'Rugrat 10/22 (.22 LR)', icon: '🐿️', slot: 4, mag: 10, rate: 0.11, reload: 1.4, spread: 0.012, ads: 0.002, range: 150, kick: 0.015, ammo: '22', snd: 'rimfire', price: 380, pal: true, dmg: 26, pen: 0, power: 1, fx: 'bullet', cls: 'small', desc: 'Tiny .22: cheap ammo, no recoil, fast follow-ups. Cans, hares, grouse. Too weak for big game.' },
  bow: { name: 'Bow-ner Grade compound bow', icon: '🏹', slot: 5, mag: 1, rate: 0.35, reload: 0.7, spread: 0.01, ads: 0.003, range: 120, kick: 0.01, ammo: 'arrow', snd: 'bow', price: 750, charge: true, proj: 85, grav: 1, dmg: 120, pen: 0, power: 1, fx: 'arrow', cls: 'big', silent: true, desc: 'Hold the trigger to draw (a full draw = faster, flatter, harder), let go to shoot. Silent. Arrows stick where they land.' },
  crossbow: { name: 'Cross Country crossbow', icon: '🎯', slot: 5, mag: 1, rate: 0.4, reload: 2.6, spread: 0.008, ads: 0.0015, range: 140, kick: 0.04, ammo: 'bolt', snd: 'crossbow', price: 950, proj: 105, grav: 0.8, dmg: 160, pen: 1, power: 2, fx: 'arrow', cls: 'big', scope: true, zoom: 24, silent: true, desc: 'Cocked bolt, red-dot scope, near-silent. Slow to reload, hits hard.' },
  tranq: { name: 'Snooze Cruise tranquilliser rifle', icon: '💤', slot: 6, mag: 1, rate: 0.6, reload: 1.8, spread: 0.02, ads: 0.003, proj: 70, grav: 0.6, range: 80, kick: 0.03, ammo: 'dart', snd: 'tranq', price: 400, dmg: 0, power: 0, fx: 'dart', desc: 'Puts animals (and people, and police…) to sleep. Fit research collars on sleeping wildlife.' },
  flare: { name: 'Orion\'s Belt flare pistol', icon: '🎆', slot: 7, mag: 1, rate: 0.5, reload: 1.5, spread: 0.02, ads: 0.01, proj: 48, grav: 0.35, range: 200, kick: 0.05, ammo: 'flare', snd: 'flare', price: 120, dmg: 30, power: 0, fx: 'flare', desc: 'A marine distress flare: a red fireball that lights up the night for 25 s and scares everything nearby.' },
  spray: { name: 'Counter Insult bear spray', icon: '🌶️', slot: 8, mag: 100, rate: 0.06, reload: 1.2, spread: 0, ads: 0, range: 9, kick: 0, ammo: 'spray', snd: 'spray', price: 55, auto: true, cone: 0.32, dmg: 0, power: 0, fx: 'spray', perShot: 5, desc: 'Capsaicin fog, 9 m cone. Stops a charging bear (what actually works in real life). Stuns people and zombies.' },
  paint: { name: 'Splat-Tastic paintball marker', icon: '🎨', slot: 9, mag: 20, rate: 0.11, reload: 1.6, spread: 0.03, ads: 0.012, proj: 85, grav: 1, range: 90, kick: 0.012, ammo: 'paint', snd: 'paint', price: 180, auto: true, dmg: 0, power: 0, fx: 'paint', desc: 'Semi-auto paint. Splats everything in colour. Stings.' },
  water: { name: 'Super Drencher 5000', icon: '💦', slot: 0, mag: 160, rate: 0.03, reload: 2.0, spread: 0.035, ads: 0.02, proj: 21, grav: 1, range: 22, kick: 0, ammo: null, snd: 'water', price: 25, auto: true, dmg: 0, power: 0, fx: 'water', perShot: 1, desc: 'Pump-action water cannon. Refills itself (R). People love it in summer, hate it in winter.' },
  foam: { name: 'Nerf-Herder foam blaster', icon: '🟠', slot: 0, mag: 12, rate: 0.22, reload: 1.6, spread: 0.03, ads: 0.015, proj: 30, grav: 0.55, range: 40, kick: 0.005, ammo: 'foam', snd: 'foam', price: 30, dmg: 0, power: 0, fx: 'foam', desc: 'Foam darts. Completely harmless, extremely annoying.' },
};
const AMMO = {
  '9mm': ['9 mm (range box of 50)', 50, 0], '308': ['.308 Win (box of 20)', 20, 40], '375': ['.375 H&H (box of 20)', 20, 95], '338': ['.338 Lapua (box of 10)', 10, 120], '12ga': ['12 ga shells (box of 25)', 25, 20], '22': ['.22 LR (brick of 100)', 100, 12],
  arrow: ['Carbon arrows (6)', 6, 45], bolt: ['Crossbow bolts (6)', 6, 55], dart: ['Tranquilliser darts (pack of 10)', 10, 30], flare: ['Flares (4)', 4, 25], spray: ['Bear spray can', 100, 50], paint: ['Paintballs (bag of 100)', 100, 15], foam: ['Foam darts (24)', 24, 6],
};
// what each shop sells
const STOCK = {
  all: Object.keys(GUNS).filter(k => GUNS[k].price),
  gun: ['rifle', 'magnum', 'sniper', 'shotgun', 'rugrat', 'bow', 'crossbow', 'spray', 'flare'],
  hunt: ['rifle', 'shotgun', 'rugrat', 'bow', 'crossbow', 'spray', 'tranq'],
  sport: ['shotgun', 'rugrat', 'bow', 'spray', 'paint', 'foam', 'water'],
  surplus: ['flare', 'spray', 'crossbow', 'paint', 'water', 'foam'],
};
// real gun / hunting shops from OpenStreetMap (shop=weapons / hunting; the name is the real map label)
const SHOPS = [
  { name: 'Reliable Gun', at: [49.2559533, -123.090128], stock: 'gun', tags: true, note: 'The gun counter on Fraser St.' },
  { name: 'Italian Sporting Goods', at: [49.2772649, -123.043828], stock: 'hunt', tags: true, note: 'East Hastings: shotguns, hunting gear and strong opinions about espresso.' },
  { name: 'West Coast Hunting Supplies', at: [49.1832256, -123.1359476], stock: 'hunt', tags: true, note: 'Richmond: bows, crossbows and a well-thumbed regulations synopsis.' },
  { name: 'Warriors & Wonders', at: [49.260846, -123.115829], stock: 'sport', note: 'Swords on the wall, foam darts in the bargain bin.' },
];
// BC hunting, as a game: legal species, their season(s) and the tag you need (null = the licence is enough)
const LEGAL = {
  buck: { tag: 'deer', seasons: ['fall'], name: 'Black-tailed deer (buck)', big: true },
  bullelk: { tag: 'elk', seasons: ['fall'], name: 'Roosevelt elk (bull)', big: true },
  bear: { tag: 'bear', seasons: ['spring', 'fall'], name: 'Black bear', big: true },
  moose: { tag: 'moose', seasons: ['fall'], name: 'Moose', big: true },
  grouse: { tag: null, seasons: ['fall'], name: 'Sooty grouse' },
  hare: { tag: null, seasons: ['fall', 'winter'], name: 'Snowshoe hare' },
};
const TAGS = { deer: ['Deer tag (antlered bucks only)', 15], elk: ['Elk tag (bulls only)', 25], bear: ['Black bear tag', 80], moose: ['Moose tag', 50] };
// how much a hit takes to drop each animal (a person = 100)
const HP = { bear: 220, grizzly: 380, moose: 420, elk: 260, bullelk: 280, deer: 100, buck: 110, goat: 130, bighorn: 140, cougar: 110, wolf: 100, sealion: 320, coyote: 55, bobcat: 50, lynx: 50, porcupine: 35, skunk: 25, beaver: 45, otter: 40, seaotter: 40, marmot: 30, vimarmot: 30, grouse: 18, ptarmigan: 16, hare: 18, rabbit: 15 };
const animalHp = a => HP[a.id] ?? (a.S?.small ? 15 : 50);
const WHY = {
  grizzly: 'Grizzly hunting has been closed in BC since 2017.', vimarmot: 'Vancouver Island marmots are one of the most endangered mammals on Earth.', seaotter: 'Sea otters are a protected species at risk.',
  deer: 'That was a doe: your tag is for antlered bucks only (antlerless deer need a special draw).', elk: 'That was a cow elk: your tag is bulls only.', cougar: 'No cougar tags are sold here.', goat: 'Mountain goats are limited-entry only: you don\'t have that draw.',
  owl: 'Owls, eagles, hawks and songbirds are protected.', gull: 'Gulls are protected migratory birds.', crow: 'Not a game animal.', mallard: 'Ducks need a federal migratory bird permit you don\'t have.', woodduck: 'Ducks need a federal migratory bird permit you don\'t have.',
};
const SERIOUS = ['grizzly', 'vimarmot', 'seaotter', 'owl', 'sealion'];
const A = () => OWN.arms || (OWN.arms = freshArms());
const freshArms = () => ({ guns: [], ammo: {}, pal: false, licence: false, tags: {}, finds: [], last: null, hunts: 0, collars: 0, research: false });

// ---------- state ----------
const S = { out: null, mag: {}, cool: 0, reloadT: 0, ads: 0, aimP: 0.1, held: false, rmb: false, kickY: 0, kickP: 0, bloom: 0, shots: 0, hitT: 0, hitKind: '', cityWarn: 0, aimWarn: new Map(), lastUpd: 0, gameT: 30, hintT: 0, fovSet: false, aimPerson: null };
let canvasEl = null;
addEventListener('mousedown', e => { if (!G.mouse.locked) return; if (e.button === 0) S.held = true; if (e.button === 2) S.rmb = true; });
addEventListener('mouseup', e => { if (e.button === 0) S.held = false; if (e.button === 2) S.rmb = false; });
addEventListener('contextmenu', e => { if (S.out) e.preventDefault(); });

// ---------- gun models (barrel along -z, up = +y, origin = the hand) ----------
const MET = std('#2b2d30', { metalness: 0.7, roughness: 0.35 }), WOOD = std('#6b4423', { roughness: 0.6 }), BLK = std('#151515', { roughness: 0.5 }),
  GOLD = std('#d4af37', { metalness: 1, roughness: 0.22, emissive: '#3a2a00' }), ORNG = std('#dd6b20'), BLUE = std('#2b6cb0', { roughness: 0.4 }), GLASS = std('#88c0ff', { metalness: 0.2, roughness: 0.05, emissive: '#112244' });
function box(g, mat, w, h, l, x, y, z, rx = 0) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; g.add(m); return m; }
function cyl(g, mat, r, l, x, y, z, r2 = r) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, l, 10).rotateX(Math.PI / 2), mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; }
function gunModel(id) {
  const g = new THREE.Group(); let muz;
  if (id === 'pistol' || id === 'golden') {
    const M = id === 'golden' ? GOLD : BLK, M2 = id === 'golden' ? GOLD : MET;
    box(g, M, 0.032, 0.1, 0.045, 0, -0.01, 0.015, 0.22); box(g, M2, 0.036, 0.04, 0.19, 0, 0.055, -0.05); box(g, M, 0.012, 0.03, 0.04, 0, 0.022, -0.02);
    muz = new THREE.Vector3(0, 0.055, -0.15);
  } else if (id === 'rifle' || id === 'tranq') {
    const ST = id === 'tranq' ? ORNG : WOOD;
    box(g, ST, 0.045, 0.09, 0.32, 0, -0.01, 0.2); box(g, ST, 0.04, 0.05, 0.36, 0, 0.0, -0.18); box(g, MET, 0.045, 0.055, 0.22, 0, 0.035, -0.04);
    cyl(g, MET, 0.011, 0.42, 0, 0.045, -0.5); box(g, MET, 0.012, 0.012, 0.05, 0.03, 0.05, 0.02);
    if (id === 'rifle') { cyl(g, BLK, 0.022, 0.32, 0, 0.11, -0.06); cyl(g, BLK, 0.028, 0.05, 0, 0.11, -0.24, 0.022); cyl(g, BLK, 0.026, 0.04, 0, 0.11, 0.11, 0.022); box(g, MET, 0.01, 0.03, 0.02, 0, 0.08, -0.12); box(g, MET, 0.01, 0.03, 0.02, 0, 0.08, 0.02); }
    else { cyl(g, MET, 0.02, 0.16, 0, -0.04, 0.0); box(g, std('#e53e3e', { emissive: '#400' }), 0.01, 0.01, 0.04, 0, 0.045, -0.73); }
    muz = new THREE.Vector3(0, 0.045, -0.72);
  } else if (id === 'shotgun') {
    box(g, WOOD, 0.045, 0.1, 0.32, 0, -0.015, 0.2); box(g, MET, 0.048, 0.07, 0.24, 0, 0.03, -0.05);
    cyl(g, MET, 0.013, 0.56, 0, 0.05, -0.45); cyl(g, MET, 0.011, 0.44, 0, 0.02, -0.4); cyl(g, WOOD, 0.022, 0.18, 0, 0.022, -0.32);
    muz = new THREE.Vector3(0, 0.05, -0.73);
  } else if (id === 'sniper') {
    const ST = std('#4a4f3a', { roughness: 0.7 });
    box(g, ST, 0.05, 0.12, 0.34, 0, -0.02, 0.2); box(g, ST, 0.05, 0.06, 0.42, 0, 0, -0.17); box(g, MET, 0.05, 0.06, 0.26, 0, 0.035, -0.04); cyl(g, MET, 0.014, 0.75, 0, 0.045, -0.66, 0.011); cyl(g, BLK, 0.02, 0.08, 0, 0.045, -1.06);
    cyl(g, BLK, 0.03, 0.42, 0, 0.13, -0.06); cyl(g, BLK, 0.04, 0.08, 0, 0.13, -0.3, 0.03); cyl(g, BLK, 0.035, 0.05, 0, 0.13, 0.17, 0.03);
    for (const sx of [-1, 1]) box(g, MET, 0.012, 0.2, 0.012, sx * 0.04, -0.07, -0.34, -0.3 * sx);   // bipod legs
    muz = new THREE.Vector3(0, 0.045, -1.1);
  } else if (id === 'magnum' || id === 'rugrat') {
    const big = id === 'magnum', ST = big ? std('#3a2a1a', { roughness: 0.5 }) : std('#2d3748', { roughness: 0.7 });
    box(g, ST, 0.05, big ? 0.1 : 0.08, 0.32, 0, -0.01, 0.2); box(g, ST, 0.045, 0.05, big ? 0.4 : 0.3, 0, 0, -0.16); box(g, MET, 0.048, 0.06, 0.22, 0, 0.035, -0.04);
    cyl(g, MET, big ? 0.015 : 0.009, big ? 0.5 : 0.38, 0, 0.045, big ? -0.52 : -0.42, big ? 0.012 : 0.009);
    if (big) { cyl(g, BLK, 0.026, 0.34, 0, 0.12, -0.06); cyl(g, BLK, 0.033, 0.06, 0, 0.12, -0.25, 0.026); box(g, MET, 0.02, 0.02, 0.04, 0, 0.05, -0.79); }
    else box(g, BLK, 0.035, 0.06, 0.04, 0, -0.04, -0.06);   // rotary magazine
    muz = new THREE.Vector3(0, 0.045, big ? -0.78 : -0.62);
  } else if (id === 'bow') {
    const riser = std('#3a3f2a', { roughness: 0.6 }), cam = std('#222'), str = new THREE.LineBasicMaterial({ color: '#ddd' });
    box(g, riser, 0.03, 0.26, 0.04, 0, 0.05, -0.12);
    for (const s of [-1, 1]) { const limb = box(g, BLK, 0.025, 0.36, 0.03, 0, 0.05 + s * 0.3, -0.06, s * 0.35); limb.userData.limb = s; const c = cyl(g, cam, 0.03, 0.02, 0, 0.05 + s * 0.47, 0.0); c.rotation.set(0, Math.PI / 2, 0); }
    const sg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.52, 0.0), new THREE.Vector3(0, 0.05, 0.02), new THREE.Vector3(0, -0.42, 0.0)]); const line = new THREE.Line(sg, str); line.userData.string = true; g.add(line);
    const arrow = cyl(g, std('#d69e2e'), 0.004, 0.7, 0, 0.05, -0.33); arrow.userData.arrow = true;
    muz = new THREE.Vector3(0, 0.05, -0.68);
  } else if (id === 'crossbow') {
    box(g, std('#2f3a2a'), 0.04, 0.08, 0.32, 0, -0.01, 0.18); box(g, MET, 0.04, 0.04, 0.5, 0, 0.03, -0.2);
    const limbs = box(g, BLK, 0.62, 0.03, 0.04, 0, 0.04, -0.42); void limbs; cyl(g, BLK, 0.02, 0.14, 0, 0.09, -0.06);
    const sg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.31, 0.04, -0.41), new THREE.Vector3(0, 0.05, -0.12), new THREE.Vector3(0.31, 0.04, -0.41)]); g.add(new THREE.Line(sg, new THREE.LineBasicMaterial({ color: '#ddd' })));
    cyl(g, std('#c53030'), 0.005, 0.4, 0, 0.06, -0.3);
    muz = new THREE.Vector3(0, 0.06, -0.5);
  } else if (id === 'flare') {
    const OR = std('#ed8936', { roughness: 0.4 }); box(g, OR, 0.035, 0.11, 0.05, 0, -0.01, 0.01, 0.2); cyl(g, OR, 0.026, 0.2, 0, 0.055, -0.08); cyl(g, BLK, 0.028, 0.03, 0, 0.055, -0.18);
    muz = new THREE.Vector3(0, 0.055, -0.2);
  } else if (id === 'spray') {
    cyl(g, std('#c53030', { roughness: 0.35 }), 0.03, 0.2, 0, 0.0, -0.05).rotation.set(0, 0, 0); box(g, std('#f6e05e'), 0.062, 0.05, 0.06, 0, 0.0, -0.08); box(g, BLK, 0.02, 0.03, 0.03, 0, 0.0, -0.17);
    muz = new THREE.Vector3(0, 0.0, -0.19);
  } else if (id === 'water') {
    const TK = std('#38b2ac', { roughness: 0.3, transparent: true, opacity: 0.85 }), BOD = std('#f6e05e', { roughness: 0.4 });
    box(g, BOD, 0.05, 0.08, 0.36, 0, 0.02, -0.12); cyl(g, std('#dd6b20'), 0.02, 0.18, 0, 0.03, -0.38); const tank = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8).scale(1, 0.9, 1.4), TK); tank.position.set(0, 0.11, 0.02); g.add(tank); box(g, std('#805ad5'), 0.04, 0.1, 0.05, 0, -0.04, 0.03, 0.2);
    muz = new THREE.Vector3(0, 0.03, -0.48);
  } else if (id === 'foam') {
    box(g, std('#dd6b20'), 0.05, 0.08, 0.28, 0, 0.02, -0.08); box(g, std('#3182ce'), 0.04, 0.1, 0.05, 0, -0.04, 0.03, 0.2); cyl(g, std('#f6e05e'), 0.03, 0.08, 0, 0.09, -0.06); cyl(g, std('#3182ce'), 0.018, 0.12, 0, 0.03, -0.26);
    muz = new THREE.Vector3(0, 0.03, -0.32);
  } else {   // paintball marker
    box(g, BLUE, 0.04, 0.07, 0.24, 0, 0.02, -0.05); box(g, BLK, 0.03, 0.1, 0.04, 0, -0.04, 0.03, 0.2); cyl(g, BLK, 0.016, 0.26, 0, 0.04, -0.3);
    const hop = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8).scale(0.8, 0.9, 1.3), std('#e2e8f0', { transparent: true, opacity: 0.75, roughness: 0.2 })); hop.position.set(0, 0.13, -0.02); g.add(hop);
    for (let i = 0; i < 5; i++) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 4), std(['#e53e3e', '#38a169', '#d69e2e', '#805ad5', '#ed64a6'][i])); b.position.set((i % 3 - 1) * 0.025, 0.11 + (i % 2) * 0.03, -0.02 + (i - 2) * 0.02); g.add(b); }
    cyl(g, std('#a0aec0', { metalness: 0.8, roughness: 0.3 }), 0.03, 0.22, 0, -0.02, 0.17);
    muz = new THREE.Vector3(0, 0.04, -0.44);
  }
  g.userData.muz = muz; return g;
}
const handGuns = {}; let handGrp = null, viewGrp = null; const viewGuns = {};
function ensureModels() {
  if (handGrp || !player?.model?.parts?.armR) return;
  handGrp = new THREE.Group(); handGrp.position.set(0, -0.62, 0); handGrp.rotation.x = -Math.PI / 2; player.model.parts.armR.add(handGrp);
  viewGrp = new THREE.Group(); scene.add(viewGrp); viewGrp.visible = false;
  for (const id in GUNS) { const h = gunModel(id); h.visible = false; handGrp.add(h); handGuns[id] = h; const v = gunModel(id); v.visible = false; v.traverse(o => { o.castShadow = false; }); viewGrp.add(v); viewGuns[id] = v; }
}

// ---------- effects: muzzle flash, tracers, particles, bullet holes / paint splats ----------
const glowTex = canvasTex(64, 64, (c, w, h) => { const gr = c.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(0.25, 'rgba(255,210,90,0.9)'); gr.addColorStop(1, 'rgba(255,120,20,0)'); c.fillStyle = gr; c.fillRect(0, 0, w, h); }, false);
const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); flash.visible = false; flash.renderOrder = 10; scene.add(flash); let flashT = 0;
const TR = 40, trPos = new Float32Array(TR * 6), trCol = new Float32Array(TR * 6), trLife = new Float32Array(TR), trBase = new Float32Array(TR * 3); let trI = 0;
const trGeo = new THREE.BufferGeometry(); trGeo.setAttribute('position', new THREE.BufferAttribute(trPos, 3)); trGeo.setAttribute('color', new THREE.BufferAttribute(trCol, 3));
const tracers = new THREE.LineSegments(trGeo, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })); tracers.frustumCulled = false; scene.add(tracers);
function tracer(a, b, col = [1, 0.85, 0.5]) { const i = trI++ % TR; trPos.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6); trBase.set(col, i * 3); trLife[i] = 1; }
const PN = 700, pPos = new Float32Array(PN * 3), pCol = new Float32Array(PN * 3), pVel = new Float32Array(PN * 3), pLife = new Float32Array(PN), pBase = new Float32Array(PN * 3); let pI = 0;
const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const parts = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.05, vertexColors: true, sizeAttenuation: true })); parts.frustumCulled = false; scene.add(parts);
for (let i = 0; i < PN; i++) pPos[i * 3 + 1] = -1e5;
function burst(p, n, col, spd = 3, up = 2, jitter = 0.15) {
  const c = new THREE.Color(col);
  for (let k = 0; k < n; k++) { const i = pI++ % PN; pPos.set([p.x, p.y, p.z], i * 3); pVel.set([R(-spd, spd), R(0, up) + R(-spd, spd) * 0.4, R(-spd, spd)], i * 3); pLife[i] = R(0.6, 1.4); const j = 1 + R(-jitter, jitter); pBase.set([c.r * j, c.g * j, c.b * j], i * 3); }
}
const DEC = 260, decGeo = new THREE.CircleGeometry(0.5, 10), decMat = new THREE.MeshStandardMaterial({ roughness: 0.9, transparent: true, opacity: 0.92, depthWrite: false, side: THREE.DoubleSide }); depthBias(decMat, 0.0005);
const decals = new THREE.InstancedMesh(decGeo, decMat, DEC); decals.count = 0; decals.frustumCulled = false; scene.add(decals); let decI = 0;
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _up = new THREE.Vector3(0, 0, 1), _s = new THREE.Vector3();
function decal(p, n, size, col) {
  const i = decI++ % DEC; _q.setFromUnitVectors(_up, n); _m4.compose(_v.copy(p).addScaledVector(n, 0.015), _q, _s.set(size, size, size)); decals.setMatrixAt(i, _m4); decals.setColorAt(i, new THREE.Color(col));
  decals.count = Math.min(DEC, Math.max(decals.count, i + 1)); decals.instanceMatrix.needsUpdate = true; if (decals.instanceColor) decals.instanceColor.needsUpdate = true;
}
function updateFx(dt) {
  if (flashT > 0) { flashT -= dt; if (flashT <= 0) flash.visible = false; }
  for (let i = 0; i < TR; i++) { if (trLife[i] <= 0) continue; trLife[i] -= dt * 9; const k = Math.max(0, trLife[i]); for (let e = 0; e < 2; e++) trCol.set([trBase[i * 3] * k, trBase[i * 3 + 1] * k, trBase[i * 3 + 2] * k], i * 6 + e * 3); }
  trGeo.attributes.color.needsUpdate = true; trGeo.attributes.position.needsUpdate = true;
  for (let i = 0; i < PN; i++) {
    if (pLife[i] <= 0) continue; pLife[i] -= dt; const b = i * 3;
    if (pLife[i] <= 0) { pPos[b + 1] = -1e5; continue; }
    pVel[b + 1] -= 9.8 * dt; pPos[b] += pVel[b] * dt; pPos[b + 1] += pVel[b + 1] * dt; pPos[b + 2] += pVel[b + 2] * dt;
    const gy = groundY(pPos[b], pPos[b + 2]); if (pPos[b + 1] < gy + 0.02) { pPos[b + 1] = gy + 0.02; pVel[b] *= 0.5; pVel[b + 2] *= 0.5; pVel[b + 1] *= -0.25; }
    const k = Math.min(1, pLife[i] * 2); pCol[b] = pBase[b] * k; pCol[b + 1] = pBase[b + 1] * k; pCol[b + 2] = pBase[b + 2] * k;
  }
  pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
}

// ---------- sounds ----------
const SND = {
  pistol: () => { noise(0.22, 0.32, 2600); beep([95], 0.12, 'sine', 0.18); },
  golden: () => { noise(0.22, 0.3, 2800); beep([95], 0.12, 'sine', 0.16); beep([1568, 2093, 2637], 0.12, 'triangle', 0.04, 0.05); },
  rifle: () => { noise(0.7, 0.42, 1500); beep([60], 0.28, 'sine', 0.24); setTimeout(() => noise(1.1, 0.07, 450), 260); },
  shotgun: () => { noise(0.55, 0.5, 950); beep([52], 0.22, 'sine', 0.3); setTimeout(() => noise(0.9, 0.06, 400), 200); },
  paint: () => { noise(0.06, 0.12, 3800); beep([640], 0.03, 'square', 0.02); },
  tranq: () => { noise(0.14, 0.12, 2200); },
  magnum: () => { noise(0.9, 0.55, 1100); beep([42], 0.4, 'sine', 0.35); setTimeout(() => noise(1.6, 0.1, 380), 300); setTimeout(() => noise(1.4, 0.05, 260), 900); },
  sniper: () => { noise(0.6, 0.5, 1800); beep([50], 0.3, 'sine', 0.3); setTimeout(() => noise(2.2, 0.08, 330), 500); setTimeout(() => noise(1.6, 0.04, 220), 1500); },
  rimfire: () => { noise(0.08, 0.16, 4200); beep([180], 0.04, 'square', 0.03); },
  bow: () => { swish(0.18, 0.08, 1600, 0.01); beep([95, 70], 0.12, 'sine', 0.1, 0.02); },
  crossbow: () => { noise(0.06, 0.2, 2500); beep([120, 80], 0.1, 'sine', 0.14, 0.02); swish(0.2, 0.05, 2200, 0.01); },
  draw: () => beep([140, 160, 180], 0.08, 'sine', 0.02, 0.1),
  flare: () => { noise(0.18, 0.22, 1600); swish(1.1, 0.06, 900, 0.05); },
  spray: () => swish(0.12, 0.05, 5200, 0.01),
  water: () => swish(0.08, 0.025, 2800, 0.01),
  foam: () => { noise(0.05, 0.06, 1200); beep([520], 0.03, 'sine', 0.02); },
  hitBody: () => { noise(0.08, 0.14, 380); beep([90], 0.08, 'sine', 0.08); }, metal: () => beep([2400, 1800, 2600], 0.25, 'triangle', 0.03, 0.02), thunk: () => { noise(0.06, 0.16, 700); beep([150], 0.05, 'square', 0.03); },
  glassCar: () => { noise(0.35, 0.18, 7000); beep([3600, 4400], 0.06, 'triangle', 0.03, 0.03); }, squish: () => swish(0.15, 0.06, 1200, 0.01), boing: () => beep([600, 300], 0.1, 'sine', 0.03, 0.05),
  dry: () => beep([2300], 0.02, 'square', 0.05),
  reload: () => beep([720, 480, 900], 0.04, 'square', 0.04, 0.22), pump: () => { noise(0.08, 0.12, 1200); setTimeout(() => noise(0.08, 0.12, 900), 140); }, bolt: () => beep([500, 800], 0.05, 'square', 0.04, 0.18),
  ding: () => beep([1650, 1655, 1648], 0.7, 'sine', 0.07, 0.01), gong: () => beep([420, 423], 1.4, 'sine', 0.1, 0.01), glass: () => { noise(0.25, 0.16, 6500); beep([3300, 4200, 3800], 0.07, 'triangle', 0.03, 0.03); },
  clay: () => { noise(0.12, 0.14, 4000); }, ric: () => beep([3200, 2100], 0.12, 'sawtooth', 0.015, 0.06), thud: () => noise(0.1, 0.12, 500), splat: () => noise(0.08, 0.12, 1800), splash: () => noise(0.3, 0.12, 1400),
};

// ---------- hit tests ----------
// closest approach of the ray segment o + d·s (0..len) to the segment A..B → [s, distance]
function segSeg(o, d, len, A, B) {
  const ux = B.x - A.x, uy = B.y - A.y, uz = B.z - A.z, wx = o.x - A.x, wy = o.y - A.y, wz = o.z - A.z;
  const b = d.x * ux + d.y * uy + d.z * uz, c = ux * ux + uy * uy + uz * uz || 1e-6, dd = d.x * wx + d.y * wy + d.z * wz, e = ux * wx + uy * wy + uz * wz, den = c - b * b;
  let s = den > 1e-6 ? (b * e - c * dd) / den : 0; s = clamp(s, 0, len);
  let t = clamp((ux * (o.x + d.x * s - A.x) + uy * (o.y + d.y * s - A.y) + uz * (o.z + d.z * s - A.z)) / c, 0, 1);
  s = clamp(d.x * (A.x + ux * t - o.x) + d.y * (A.y + uy * t - o.y) + d.z * (A.z + uz * t - o.z), 0, len);
  const px = o.x + d.x * s - A.x - ux * t, py = o.y + d.y * s - A.y - uy * t, pz = o.z + d.z * s - A.z - uz * t;
  return [s, Math.hypot(px, py, pz)];
}
function raySphere(o, d, len, cx, cy, cz, r) {
  const lx = cx - o.x, ly = cy - o.y, lz = cz - o.z, s = lx * d.x + ly * d.y + lz * d.z; if (s < -r) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - s * s; if (d2 > r * r) return -1; const t = s - Math.sqrt(r * r - d2); return t >= 0 && t <= len ? t : (s >= 0 && s <= len ? s : -1);
}
const _A = new THREE.Vector3(), _B = new THREE.Vector3();
function capsule(o, d, len, x, y0, y1, z, r) { _A.set(x, y0, z); _B.set(x, y1, z); const [s, dist] = segSeg(o, d, len, _A, _B); return dist < r ? s : -1; }
const near = (o, len, x, z) => Math.abs(x - o.x) < len + 6 && Math.abs(z - o.z) < len + 6;
function animalBox(a) {
  const rig = _fauna.rigs[a.id], sc = a.sc || 1;
  if (!rig || rig.type === 'bird') return { bird: true, y: a.y + 0.18 * sc + (a.alt || 0), r: 0.32 * sc + 0.08, L: 0 };
  const H = rig.slots[0].at[1] || 0.5, L = (rig.slots[0].at[2] || H * 0.6) + H * 0.3;
  return { y: a.y + H * sc * (a.lie ? 0.55 : 0.95) + (a.stand || 0) * H * sc * 0.6, r: H * sc * 0.42 + 0.08, L: L * sc };
}
// people + things with people inside: never hit, only "found" so the shot can be blocked
// people (pedestrians, Downtown Eastside characters, police officers). pad > 0 = a fatter test for "pointing at"
// someone. kid / dtes = never a target (the shot is blocked).
function peopleHit(o, d, len, pad = 0, s0 = 0, skip = null) {
  let best = null, bt = len;
  const take = (t, h) => { if (t >= s0 && t < bt) { bt = t; best = { ...h, t }; } };
  for (const p of peds) {
    if (p === skip || p.visible === false || p.x > 1e5 || p.state === 'dead' || !near(o, len, p.x, p.z)) continue; const sc = p.sc || 1, kid = sc < 0.8, lying = p.state === 'down';
    if (lying) { take(capsule(o, d, bt, p.x, p.y + 0.15, p.y + 0.35, p.z, 0.5 + pad), { kind: 'person', obj: p, kid }); continue; }
    take(raySphere(o, d, bt, p.x, p.y + 1.6 * sc, p.z, 0.14 * sc + pad), { kind: 'person', obj: p, kid, head: true });
    take(capsule(o, d, bt, p.x, p.y + 0.2 * sc, p.y + 1.45 * sc, p.z, 0.27 + pad), { kind: 'person', obj: p, kid });
  }
  for (const p of (_dtes.people || [])) { if (p.x === undefined || p === skip || !near(o, len, p.x, p.z)) continue; const y = p.y ?? walkY(p.x, p.z); take(capsule(o, d, bt, p.x, y + 0.1, y + 1.5, p.z, 0.45 + pad), { kind: 'person', obj: p, dtes: true }); }
  for (const c of WANTED.cops) { if (c.hp <= 0 || c === skip || !near(o, len, c.x, c.z)) continue; const lying = c.state === 'sleep' || c.state === 'dead';
    if (lying) take(capsule(o, d, bt, c.x, c.y + 0.15, c.y + 0.35, c.z, 0.5 + pad), { kind: 'person', obj: c, cop: true });
    else { take(raySphere(o, d, bt, c.x, c.y + 1.6, c.z, 0.14 + pad), { kind: 'person', obj: c, cop: true, head: true }); take(capsule(o, d, bt, c.x, c.y + 0.2, c.y + 1.45, c.z, 0.27 + pad), { kind: 'person', obj: c, cop: true }); } }
  return best;
}
function entityHit(o, d, len, s0 = 0, skip = null) {
  let best = null, bt = len;
  const take = (t, h) => { if (t >= s0 && t < bt) { bt = t; best = { ...h, t }; } };
  for (const z of zombies) { if (z === skip || z.state === 'dead' || !near(o, len, z.x, z.z)) continue; take(raySphere(o, d, bt, z.x, z.y + 1.62, z.z, 0.2), { kind: 'zombie', obj: z, head: true }); take(capsule(o, d, bt, z.x, z.y + 0.3, z.y + 1.45, z.z, 0.36), { kind: 'zombie', obj: z }); }
  for (const a of _fauna.live) {
    if (a === skip || a.vis === false || a.down === 'dead' || !near(o, len, a.x, a.z)) continue; const b = animalBox(a);
    if (b.bird || b.L < 0.2) take(raySphere(o, d, bt, a.x, b.y, a.z, b.r), { kind: 'animal', obj: a });
    else { const fx = -Math.sin(a.yaw) * b.L * 0.6, fz = -Math.cos(a.yaw) * b.L * 0.6; _A.set(a.x - fx, b.y, a.z - fz); _B.set(a.x + fx, b.y, a.z + fz); const [s, dist] = segSeg(o, d, bt, _A, _B); if (dist < b.r) take(s, { kind: 'animal', obj: a }); }
  }
  for (const t of targets) { if (t === skip || !t.alive || !near(o, len, t.x, t.z)) continue; take(raySphere(o, d, bt, t.x, t.y, t.z, t.r), { kind: 'target', obj: t }); }
  for (const c of _air.air) { if (c === skip || !c.g.visible || c.remove || c.landedT || !near(o, len, c.g.position.x, c.g.position.z)) continue; take(raySphere(o, d, bt, c.g.position.x, c.g.position.y, c.g.position.z, airR(c) * 0.75), { kind: 'aircraft', obj: c }); }
  for (const v of vehicles) { if (v === skip || v.driver === 'player' || v === player?.vehicle || !near(o, len, v.x, v.z) || v.hidden) continue; const r = Math.min(2.6, (v.d?.len || 4) * 0.36); take(raySphere(o, d, bt, v.x, (v.y || 0) + 0.8, v.z, r), { kind: 'vehicle', obj: v, occupied: !!(v.driver || v.ai || v.rider || v.script) }); }
  return best;
}
// march through the world: ground, water, buildings, solid props
const CELL = 16, ck = (i, j) => i * 100003 + j;
function worldHit(o, d, s0, s1) {
  let s = s0, lastCell = null, cand = [];
  while (s < s1) {
    const x = o.x + d.x * s, y = o.y + d.y * s, z = o.z + d.z * s;
    if (isWater(x, z) && y < waterLevel(x, z)) return { kind: 'water', t: s };
    if (y < groundY(x, z) - 0.02) return { kind: 'ground', t: s, n: new THREE.Vector3(0, 1, 0) };
    { const w = walkY(x, z, y + 0.25); if (w < y + 0.3 && y < w - 0.02) return { kind: 'ground', t: s, n: new THREE.Vector3(0, 1, 0) }; }   // bridge decks, sidewalks
    const b = buildingAt(x, z); if (b && y < b.top + 0.1 && y > (b.base ?? -1e9) - 0.1) return { kind: 'building', t: s, b };
    const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL), cKey = ck(ci, cj);
    if (cKey !== lastCell) { lastCell = cKey; cand = []; for (const g of _colliderGrids.values()) { const a = g.get(cKey); if (a) for (const c of a) if (!c.gone) cand.push(c); } }
    for (const c of cand) { if (y > c.top || y < (c.base ?? c.top - 12) - 0.3) continue; const dx = x - c.x, dz = z - c.z; if (dx * dx + dz * dz < c.r * c.r) return { kind: 'prop', t: s, c }; }
    s += s < 30 ? 0.25 : s < 120 ? 0.5 : 1;
  }
  return null;
}
function castSeg(o, d, len, s0 = 0, skipObj = null) {
  const ppl = peopleHit(o, d, len, 0, s0, skipObj), ent = entityHit(o, d, len, s0, skipObj);
  let best = ent; if (ppl && (!best || ppl.t < best.t)) best = ppl;
  const w = worldHit(o, d, s0, best ? best.t : len);
  if (w) best = w;
  if (best) best.p = new THREE.Vector3().copy(o).addScaledVector(d, best.t);
  return best;
}

// ---------- the range + shop ("Shoot the Breeze Range" and Cabbagela's Outdoors) ----------
const targets = [];   // {x, y, z, r, alive, onHit(h)}
const RANGE = { built: false, x: 0, z: 0, y: 0, yaw: 0, grp: null, paper: [], plates: [], bottles: [], clays: [], gong: null, ch: null, desk: null, shop: null, officer: null, gull: null, coon: null, surpriseT: 70 };
function findRangeSpot(lat, lon) {
  const [cx, cz] = toXZ(lat, lon);
  for (let r = 0; r < 1600; r += 40) for (let a = 0; a < 6.28; a += r ? 40 / r : 7) for (const yaw of [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4, Math.PI, -Math.PI / 2]) {
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, c = Math.cos(yaw), sn = Math.sin(yaw); let ok = true, lo = 1e9, hi = -1e9;
    for (let lz = 16; lz >= -72 && ok; lz -= 8) for (let lx = -24; lx <= 17 && ok; lx += 8) {
      const X = x + c * lx + sn * lz, Z = z - sn * lx + c * lz;
      if (isWater(X, Z) || buildingAt(X, Z) || inRoadway(X, Z, 3)) { ok = false; break; }
      const h = groundY(X, Z); lo = Math.min(lo, h); hi = Math.max(hi, h); if (hi - lo > 4 || h < 0.5) ok = false;
    }
    if (!ok) continue;
    for (let lz = 14; lz >= -70 && ok; lz -= 4) for (let lx = -22; lx <= 15; lx += 4) { const X = x + c * lx + sn * lz, Z = z - sn * lx + c * lz; if (buildingAt(X, Z) || inRoadway(X, Z, 2) || isWater(X, Z) || surfaceY(X, Z, 1e9) > groundY(X, Z) + 0.8) { ok = false; break; } }   // nothing overhead (a motorway bridge once ran over it)
    if (!ok) continue;
    const nr = nearestRoad(x + c * -18, z - sn * -18, 140); if (!nr) continue;
    return { x, z, yaw };
  }
  return null;
}
function paperTex() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const c = cv.getContext('2d');
  const draw = () => { c.fillStyle = '#f4efe2'; c.fillRect(0, 0, 128, 128); for (let k = 10; k >= 1; k--) { c.beginPath(); c.arc(64, 64, k * 5.8, 0, 7); c.fillStyle = k <= 2 ? '#c53030' : k <= 6 ? '#1a1a1a' : '#f4efe2'; c.fill(); c.strokeStyle = k <= 6 && k > 2 ? '#f4efe2' : '#1a1a1a'; c.lineWidth = 0.8; c.stroke(); } c.fillStyle = '#1a1a1a'; c.font = 'bold 10px Arial'; c.fillText('SHOOT THE BREEZE', 14, 124); };
  draw(); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.userData = { c, draw }; return t;
}
const loc = (lx, ly, lz) => { const c = Math.cos(RANGE.yaw), s = Math.sin(RANGE.yaw); const x = RANGE.x + c * lx + s * lz, z = RANGE.z - s * lx + c * lz; return [x, z]; };
function lgy(lx, lz) { const [x, z] = loc(lx, 0, lz); return groundY(x, z) - RANGE.y; }   // ground height in range-local y
function buildRange() {
  const sp = findRangeSpot(49.2042, -123.0760) || findRangeSpot(49.2290, -123.0050);
  if (!sp) { console.warn('guns: no room for the range'); return; }
  Object.assign(RANGE, sp); RANGE.y = groundY(sp.x, sp.z);
  const g = new THREE.Group(); g.position.set(RANGE.x, RANGE.y, RANGE.z); g.rotation.y = RANGE.yaw; scene.add(g); RANGE.grp = g;
  // floor: gravel lanes draped over the real ground, concrete firing line
  const floor = (x0, x1, z0, z1, col, k, lift = 0.05) => { const nx = Math.ceil((x1 - x0) / 2), nz = Math.ceil((z0 - z1) / 2), geo = new THREE.PlaneGeometry(x1 - x0, z0 - z1, nx, nz).rotateX(-Math.PI / 2); const P = geo.attributes.position;
    for (let i = 0; i < P.count; i++) { const lx = P.getX(i) + (x0 + x1) / 2, lz = P.getZ(i) + (z0 + z1) / 2; P.setXYZ(i, lx, lgy(lx, lz) + lift, lz); } geo.computeVertexNormals(); const m = std(col, { roughness: 0.95 }); depthBias(m, k); const mesh = new THREE.Mesh(geo, m); mesh.receiveShadow = true; g.add(mesh); return mesh; };
  floor(-14, 14, 0, -68, '#9a8f74', 0.0004); floor(-24, 14, 9, 0, '#b8b4ab', 0.0006, 0.07);
  // earth berms (stop bullets: registered as solid props)
  const earth = std('#6b5a3a', { roughness: 1 }), cols = [];
  const berm = (x, z, w, l, h) => { const b = addMesh(new THREE.BoxGeometry(w, h + 3, l), earth, x, lgy(x, z) + h / 2 - 1.5, z, g); b.receiveShadow = true; for (let s = -l / 2; s <= l / 2; s += 2.5) for (let q = -w / 2; q <= w / 2; q += 2.5) { const [X, Z] = loc(x + q, 0, z + s); cols.push({ x: X, z: Z, r: 1.6, top: RANGE.y + lgy(x, z) + h, noStand: true }); } };
  berm(-15.5, -33, 2.4, 66, 3.6); berm(15.5, -33, 2.4, 66, 3.6); berm(0, -69.5, 33, 3, 7);
  setColliders('gunrange', cols);
  // roof over the firing line + benches
  const post = std('#4a5568', { metalness: 0.5 }), roof = std('#2f855a', { side: THREE.DoubleSide });
  for (const x of [-13, -4.4, 4.4, 13]) for (const z of [0.2, 5.5]) addMesh(new THREE.CylinderGeometry(0.08, 0.08, 3.4, 8), post, x, lgy(x, z) + 1.7, z, g);
  addMesh(new THREE.BoxGeometry(27, 0.12, 6.4), roof, 0, lgy(0, 3) + 3.45, 2.85, g);
  const lane = [-9, -3, 3, 9];
  for (const x of lane) { addMesh(new THREE.BoxGeometry(1.6, 0.06, 0.8), WOOD, x, lgy(x, -0.4) + 0.95, -0.4, g); for (const dx of [-0.7, 0.7]) addMesh(new THREE.BoxGeometry(0.06, 0.95, 0.7), post, x + dx, lgy(x, -0.4) + 0.47, -0.4, g); }
  const sign = canvasTex(512, 96, (c, w, h) => { c.fillStyle = '#1c4532'; c.fillRect(0, 0, w, h); c.fillStyle = '#f6e05e'; c.font = 'bold 44px Segoe UI, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('🎯 SHOOT THE BREEZE RANGE', w / 2, h / 2, w - 20); }, false);
  const sg = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.7), new THREE.MeshStandardMaterial({ map: sign, emissive: '#333', emissiveMap: sign })); sg.position.set(0, lgy(0, 6) + 4.4, 6.06); sg.rotation.y = Math.PI; g.add(sg);
  const sg2 = sg.clone(); sg2.position.z = -0.35; sg2.rotation.y = 0; sg2.position.y -= 0.0; g.add(sg2);
  // paper targets at 10 / 25 / 50 m
  const frame = std('#7a5a3a');
  [[-9, -10], [-3, -25], [3, -25], [9, -50]].forEach(([x, z], i) => {
    const gy = lgy(x, z), tex = paperTex(), m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide })); m.position.set(x, gy + 1.45, z); g.add(m);
    for (const dx of [-0.6, 0.6]) addMesh(new THREE.BoxGeometry(0.07, 2.1, 0.07), frame, x + dx, gy + 1.05, z - 0.03, g);
    const [X, Z] = loc(x, 0, z), T = { x: X, y: RANGE.y + gy + 1.45, z: Z, r: 0.56, alive: true, paper: true, mesh: m, tex, lx: x, lz: z, dist: -z, onHit: hitPaper };
    targets.push(T); RANGE.paper.push(T);
  });
  // steel plate rack at 18 m
  addMesh(new THREE.BoxGeometry(5.2, 0.12, 0.12), MET, 0, lgy(0, -18) + 0.85, -18, g); for (const dx of [-2.6, 2.6]) addMesh(new THREE.BoxGeometry(0.1, 1, 0.1), MET, dx, lgy(0, -18) + 0.45, -18, g);
  const plateM = std('#f7fafc', { metalness: 0.4, roughness: 0.5 });
  for (let i = 0; i < 6; i++) { const x = -2.1 + i * 0.84, gy = lgy(x, -18); const piv = new THREE.Group(); piv.position.set(x, gy + 0.91, -18); g.add(piv); const pm = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.02, 16).rotateX(Math.PI / 2), plateM); pm.position.y = 0.2; pm.castShadow = true; piv.add(pm);
    const [X, Z] = loc(x, 0, -18), T = { x: X, y: RANGE.y + gy + 1.11, z: Z, r: 0.2, alive: true, plate: true, piv, onHit: hitPlate }; targets.push(T); RANGE.plates.push(T); }
  // bottle table at 12 m
  const tz = -13, tx = -5; addMesh(new THREE.BoxGeometry(3.4, 0.08, 0.7), WOOD, tx, lgy(tx, tz) + 0.9, tz, g); for (const dx of [-1.5, 1.5]) addMesh(new THREE.BoxGeometry(0.08, 0.9, 0.6), WOOD, tx + dx, lgy(tx, tz) + 0.45, tz, g);
  for (let i = 0; i < 10; i++) { const x = tx - 1.45 + i * 0.32, can = i % 3 === 2, col = can ? pick(['#c53030', '#e2e8f0', '#2b6cb0']) : pick(['#2f6b3a', '#6b3a1a', '#3a7a5a']);
    const m = new THREE.Mesh(can ? new THREE.CylinderGeometry(0.035, 0.035, 0.12, 10) : new THREE.CylinderGeometry(0.018, 0.04, 0.26, 10), std(col, can ? { metalness: 0.8, roughness: 0.3 } : { roughness: 0.1, transparent: true, opacity: 0.85 }));
    const y = lgy(tx, tz) + 0.94 + (can ? 0.06 : 0.13); m.position.set(x, y, tz); g.add(m);
    const [X, Z] = loc(x, 0, tz), T = { x: X, y: RANGE.y + y, z: Z, r: 0.12, alive: true, bottle: true, can, mesh: m, col, onHit: hitBottle }; targets.push(T); RANGE.bottles.push(T); }
  // 60 m gong + trap house
  { const x = -12, z = -62, gy = lgy(x, z); addMesh(new THREE.BoxGeometry(2.2, 0.12, 0.12), MET, x, gy + 2.3, z, g); for (const dx of [-1.1, 1.1]) addMesh(new THREE.BoxGeometry(0.1, 2.3, 0.1), MET, x + dx, gy + 1.15, z, g);
    const piv = new THREE.Group(); piv.position.set(x, gy + 2.25, z); g.add(piv); const gm = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.04, 20).rotateX(Math.PI / 2), std('#c8a040', { metalness: 0.8, roughness: 0.35 })); gm.position.y = -0.75; piv.add(gm);
    const [X, Z] = loc(x, 0, z); const T = { x: X, y: RANGE.y + gy + 1.5, z: Z, r: 0.58, alive: true, gong: true, piv, onHit: hitGong }; targets.push(T); RANGE.gong = T; }
  addMesh(new THREE.BoxGeometry(2.4, 1.2, 2), std('#a0aec0', { roughness: 1 }), 11, lgy(11, -14) + 0.6, -14, g);
  // range desk + range officer, the shop
  const [dx, dz] = loc(-17, 0, 3); RANGE.desk = { x: dx, z: dz };
  addMesh(new THREE.BoxGeometry(2.6, 1.1, 0.8), std('#2c5282'), -17, lgy(-17, 3) + 0.55, 3, g);
  const off = makeHuman({ skin: '#c68c5e', hair: '#3b2416', shirt: '#dd6b20', pants: '#2d3748', hat: '#1a202c', beard: '#3b2416' }); scene.remove(off.grp); g.add(off.grp); off.grp.position.set(-17, lgy(-17, 4) , 4); off.grp.rotation.y = Math.PI; off.st.kind = 'idle'; off.pose(0); RANGE.officer = off;
  const sx = -23, sz = 13, [shx, shz] = loc(sx, 0, sz); RANGE.shop = { x: shx, z: shz };
  const sgy = lgy(sx, sz); addMesh(new THREE.BoxGeometry(5, 4, 5), std('#f7f3ea'), sx, sgy + 2, sz - 0.5 + 2.5, g);
  const st2 = canvasTex(512, 128, (c, w, h) => { c.fillStyle = '#744210'; c.fillRect(0, 0, w, h); c.fillStyle = '#fefcbf'; c.font = 'bold 46px Segoe UI, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('🦌 Cabbagela\'s Outdoors', w / 2, h / 2, w - 24); }, false);
  const s3 = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 1.35), new THREE.MeshStandardMaterial({ map: st2, emissive: '#333', emissiveMap: st2, side: THREE.DoubleSide })); s3.position.set(sx, sgy + 4.7, sz + 0.0); g.add(s3);
  RANGE.built = true;
}
function hitPaper(T, h) {
  // where on the paper? (local plane coords)
  T.mesh.updateMatrixWorld(); const lp = T.mesh.worldToLocal(h.p.clone()), u = (lp.x / 1.1 + 0.5) * 128, v = (0.5 - lp.y / 1.1) * 128;
  const rr = Math.hypot(u - 64, v - 64) / 5.8, ring = rr < 10 ? Math.max(1, 10 - Math.floor(rr)) : 0;
  const c = T.tex.userData.c; c.fillStyle = h.paint || '#111'; c.beginPath(); c.arc(u, v, h.paint ? 5 : 1.8, 0, 7); c.fill(); T.tex.needsUpdate = true;
  if (ring) { hitMark(ring === 10 ? 'bull' : 'hit'); ui.toast(ring === 10 ? '🎯 BULLSEYE!' : '🎯 ' + ring + ' ring', Math.round(T.dist) + ' m target', 900); } else ui.toast('Paper, but no ring', 'Off the scoring rings', 700);
  const ch = RANGE.ch; if (ch && ch.kind === 'bull') { ch.score += ring; ch.n++; }
  return true;
}
function hitPlate(T) { T.alive = false; T.fall = 1; SND.ding(); hitMark('hit'); const ch = RANGE.ch; if (ch && ch.kind === 'plates') ch.n++; else T.reset = G.t + 6; return true; }
function hitBottle(T, h) { T.alive = false; T.mesh.visible = false; if (T.can) { SND.ric(); burst(T.mesh.getWorldPosition(_v), 6, T.col, 2, 3); } else { SND.glass(); burst(T.mesh.getWorldPosition(_v), 22, T.col, 2.5, 2.5, 0.3); } hitMark('hit'); const ch = RANGE.ch; if (ch && ch.kind === 'bottles') ch.n++; else T.reset = G.t + 15; return true; }
function hitGong(T) { SND.gong(); T.swing = 1; hitMark('hit'); if (!S.gongToast || G.t - S.gongToast > 4) { S.gongToast = G.t; ui.toast('🔔 BWONNNG!', 'The 60 m gong. Nice shooting.', 1200); } if (RANGE.ch?.kind === 'gong') RANGE.ch.n++; return false; }
function resetRange(what) {
  if (what === 'plates' || what === 'all') for (const T of RANGE.plates) { T.alive = true; T.fall = 0; T.piv.rotation.x = 0; T.reset = 0; }
  if (what === 'bottles' || what === 'all') for (const T of RANGE.bottles) { T.alive = true; T.mesh.visible = true; T.reset = 0; }
  if (what === 'paper' || what === 'all') for (const T of RANGE.paper) { T.tex.userData.draw(); T.tex.needsUpdate = true; T.alive = true; T.mesh.visible = true; }
}
// clay pigeons
const clayGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.025, 14), clayM = std('#ed8936', { roughness: 0.7 }), goldClayM = std('#ffd700', { metalness: 0.9, roughness: 0.2, emissive: '#553300' });
function throwClay() {
  const [x, z] = loc(11, 0, -14), gold = Math.random() < 0.07, m = new THREE.Mesh(clayGeo, gold ? goldClayM : clayM); scene.add(m);
  const c = Math.cos(RANGE.yaw), s = Math.sin(RANGE.yaw), lvx = R(-17, -11), lvz = R(-5, 2), vx = c * lvx + s * lvz, vz = -s * lvx + c * lvz;
  const T = { x, y: RANGE.y + lgy(11, -14) + 1.3, z, r: 0.32, alive: true, clay: true, gold, mesh: m, vx, vy: R(10, 13), vz, onHit: hitClay };
  targets.push(T); RANGE.clays.push(T); noise(0.1, 0.1, 800);
}
function hitClay(T) {
  T.alive = false; scene.remove(T.mesh); SND.clay(); burst(_v.set(T.x, T.y, T.z), 26, T.gold ? '#ffd700' : '#ed8936', 3, 2); hitMark('hit');
  const ch = RANGE.ch; if (ch && ch.kind === 'clays') { ch.n++; player.money += T.gold ? 50 : 5; if (T.gold) { ui.toast('🌟 GOLDEN CLAY!', '+$50. Rare as a sunny February.', 2200); discover('goldenclay'); } }
  return true;
}

// ---------- challenges (E at the range desk) ----------
const CH = {
  plates: { name: 'Plate Rack Dash', help: 'Knock down all 6 steel plates (18 m) as fast as you can. Under 6 s = $60, under 10 s = $35, under 15 s = $15.' },
  bottles: { name: 'Bottle Bash', help: '20 seconds, 10 bottles and cans on the 12 m table. $3 each, +$20 if you clear the table.' },
  clays: { name: 'Pull! (clay pigeons)', help: '10 clays fly across the range from the trap house. $5 a hit. A shotgun helps (pellets spread). Watch for the golden clay.' },
  bull: { name: 'Bullseye (25 m paper)', help: '5 shots at a 25 m paper target. Score 45+ for $50 (aim with the right mouse button; breathe).' },
};
async function openDesk() {
  if (S.busy) return; S.busy = true;
  const has = A().guns.length > 0, rent = !A().guns.includes('pistol');
  const opts = [...Object.values(CH).map(c => '🎯 ' + c.name), rent ? '🔫 Rent the range pistol + 50 rounds ($25)' : '🔫 Buy another box of 9 mm ($12)', '♻️ Reset all targets', '👋 Never mind'];
  const i = await ui.dialog('🦺 Range Officer Rhonda', 'Welcome to <b>Shoot the Breeze</b>! Rules: muzzle downrange, finger off the trigger until you\'re on target, and nobody goes past the line while it\'s hot. ' + (has ? 'Pick a challenge:' : 'No gun yet? Rent one here, or visit Cabbagela\'s next door.'), opts);
  S.busy = false; const ids = Object.keys(CH);
  if (i < ids.length) { if (!A().guns.length) { ui.toast('You need a gun first', 'Rent the range pistol, or shop at Cabbagela\'s next door.', 2500); return; } startCh(ids[i]); }
  else if (i === ids.length) { if (rent) { if (!spend(25)) return; give('pistol', 50); ui.toast('🔫 Range pistol rented', 'It stays at the range (hand it back by walking away). O = draw it, click = shoot, R = reload, right mouse = aim.', 5000); } else { if (!spend(12)) return; A().ammo['9mm'] = (A().ammo['9mm'] || 0) + 50; } }
  else if (i === ids.length + 1) resetRange('all');
}
function startCh(kind) {
  resetRange(kind === 'plates' ? 'plates' : kind === 'bottles' ? 'bottles' : kind === 'bull' ? 'paper' : 'none');
  RANGE.ch = { kind, t: 0, n: 0, score: 0, shots: 0, thrown: 0, started: kind !== 'plates' };
  ui.toast('🎯 ' + CH[kind].name, CH[kind].help, 4500); beep([880, 880, 1320], 0.12, 'square', 0.05, 0.35);
  if (!S.out) draw(A().last && A().guns.includes(A().last) ? A().last : A().guns[0]);
}
function updateCh(dt) {
  const ch = RANGE.ch; if (!ch) return;
  if (Math.hypot(player.x - RANGE.x, player.z - RANGE.z) > 120) { RANGE.ch = null; ui.toast('Challenge cancelled', 'You left the range.', 1500); return; }
  if (ch.started) ch.t += dt;
  let obj = '';
  if (ch.kind === 'plates') { obj = `🎯 Plate Rack: ${ch.n}/6 · ${ch.t.toFixed(2)} s`; if (ch.n >= 6) { const t = ch.t, pay = t < 6 ? 60 : t < 10 ? 35 : t < 15 ? 15 : 0; player.money += pay; ui.toast('🏁 All plates down: ' + t.toFixed(2) + ' s', pay ? '+' + money(pay) : 'Under 15 s pays. Try again!', 3500); if (t < 6) discover('platerack'); end(); } }
  else if (ch.kind === 'bottles') { obj = `🍾 Bottle Bash: ${ch.n}/10 · ${Math.max(0, 20 - ch.t).toFixed(1)} s`; if (ch.n >= 10 || ch.t > 20) { const pay = ch.n * 3 + (ch.n >= 10 ? 20 : 0); player.money += pay; ui.toast('🍾 ' + ch.n + ' / 10 smashed', '+' + money(pay) + (ch.n >= 10 ? ' (table cleared!)' : ''), 3000); if (ch.n >= 10) discover('bottlebash'); end(); } }
  else if (ch.kind === 'clays') {
    obj = `🥏 Clays: ${ch.n} hit · ${ch.thrown}/10 thrown`;
    if (ch.thrown < 10 && ch.t > 1.5 + ch.thrown * 2.6) { ch.thrown++; throwClay(); ui.toast('PULL!', '', 500); }
    if (ch.thrown >= 10 && !RANGE.clays.some(c => c.alive)) { ui.toast('🥏 ' + ch.n + ' / 10 clays', ch.n >= 8 ? 'Clay master! (paid $5 a hit)' : 'Paid $5 a hit', 3000); if (ch.n >= 8) discover('claymaster'); end(); }
  }
  else if (ch.kind === 'bull') { obj = `🎯 Bullseye: ${ch.n}/5 shots · score ${ch.score}`; if (ch.n >= 5) { const pay = ch.score >= 45 ? 50 : 0; player.money += pay; ui.toast('🎯 Score ' + ch.score + ' / 50', pay ? '+$50. Marksman!' : '45+ pays $50', 3500); if (pay) discover('bullseye'); end(); } }
  G.sideObj = obj;
  function end() { RANGE.ch = null; sfxDone(); }
}
const sfxDone = () => beep([523, 659, 784], 0.15, 'triangle', 0.06, 0.12);
// surprises: a gull swipes a bottle, a raccoon runs off with a paper target
const gullGeo = (() => { const g = new THREE.Group(); const w = std('#f7fafc'), gr = std('#a0aec0'); addMesh(new THREE.SphereGeometry(0.16, 10, 8).scale(1, 0.8, 1.8), w, 0, 0, 0, g); addMesh(new THREE.SphereGeometry(0.08, 8, 6), w, 0, 0.08, -0.26, g); addMesh(new THREE.ConeGeometry(0.025, 0.1, 6).rotateX(-Math.PI / 2), std('#ecc94b'), 0, 0.07, -0.37, g); for (const s of [-1, 1]) { const wg = addMesh(new THREE.BoxGeometry(0.5, 0.02, 0.2), gr, s * 0.3, 0.05, 0, g); wg.name = 'w' + s; } return g; })();
const coonGeo = (() => { const g = new THREE.Group(); const f = std('#6b6b6b'), d = std('#1a1a1a'); addMesh(new THREE.SphereGeometry(0.22, 10, 8).scale(1, 0.8, 1.5), f, 0, 0.3, 0, g); addMesh(new THREE.SphereGeometry(0.13, 10, 8), f, 0, 0.38, -0.32, g); addMesh(new THREE.BoxGeometry(0.2, 0.05, 0.03), d, 0, 0.4, -0.43, g); for (let i = 0; i < 4; i++) addMesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 8).rotateX(1.3), i % 2 ? d : f, 0, 0.32 - i * 0.02, 0.32 + i * 0.1, g); for (const [x, z] of [[-0.12, -0.18], [0.12, -0.18], [-0.12, 0.18], [0.12, 0.18]]) addMesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2), d, x, 0.1, z, g); return g; })();
function rangeSurprise(dt) {
  RANGE.surpriseT -= dt;
  const at = Math.hypot(player.x - RANGE.x, player.z - RANGE.z) < 90;
  if (RANGE.surpriseT < 0 && at) {
    RANGE.surpriseT = R(70, 140);
    const bot = RANGE.bottles.filter(b => b.alive);
    if (Math.random() < 0.55 && bot.length && !RANGE.gull) { const b = pick(bot), g = gullGeo.clone(); scene.add(g); RANGE.gull = { g, b, t: 0, from: new THREE.Vector3(b.x + 30, b.y + 18, b.z + 10) }; }
    else if (!RANGE.coon) { const T = pick(RANGE.paper.filter(p => p.alive)); if (T) { const g = coonGeo.clone(); scene.add(g); RANGE.coon = { g, T, t: 0 }; } }
  }
  const G1 = RANGE.gull; if (G1) {
    G1.t += dt; const b = G1.b, g = G1.g;
    for (const s of [-1, 1]) { const w = g.getObjectByName('w' + s); if (w) w.rotation.z = Math.sin(G.t * 16) * 0.6 * s; }
    if (G1.t < 3) { g.position.lerpVectors(G1.from, _v.set(b.x, b.y + 0.15, b.z), G1.t / 3); g.lookAt(b.x, b.y, b.z); g.rotateY(Math.PI); }
    else if (G1.t < 3.1) { if (b.alive) { b.alive = false; b.mesh.visible = false; b.reset = G.t + 25; ui.toast('🐦 A seagull stole a bottle!', 'Gulls are protected migratory birds: hold your fire and let the thief go. (It\'ll be back for your fries.)', 4000); say(player, 'HEY! That\'s range property!', 1800); } }
    else { g.position.addScaledVector(_v2.set(-1, 0.6, -0.4).normalize(), dt * 9); if (G1.t > 12) { scene.remove(g); RANGE.gull = null; } }
  }
  const C = RANGE.coon; if (C) {
    C.t += dt; const T = C.T, [sx, sz] = loc(T.lx + 12, 0, T.lz + 3);
    const p = C.t < 4 ? _v.set(lerp(sx, T.x, C.t / 4), 0, lerp(sz, T.z, C.t / 4)) : _v.set(T.x, 0, T.z).add(_v2.set(-Math.sin(RANGE.yaw), 0, -Math.cos(RANGE.yaw)).multiplyScalar((C.t - 4) * 5));
    C.g.position.set(p.x, groundY(p.x, p.z) + 0.02, p.z); C.g.rotation.y = C.t < 4 ? Math.atan2(-(T.x - sx), -(T.z - sz)) : RANGE.yaw;
    if (C.t >= 4 && T.alive) { T.alive = false; T.mesh.visible = false; T.reset = G.t + 40; ui.toast('🦝 A raccoon stole the bullseye!', 'It drags your paper target off into the berm. It\'ll be back. Probably with friends.', 4000); discover('trashbandit'); }
    if (C.t > 4) { C.g.add(T.carry ||= (() => { const m = T.mesh.clone(); m.scale.setScalar(0.5); m.position.set(0, 0.55, -0.2); return m; })()); }
    if (C.t > 13) { scene.remove(C.g); RANGE.coon = null; }
  }
  for (const T of RANGE.paper) if (!T.alive && T.reset && G.t > T.reset) { T.alive = true; T.mesh.visible = true; T.reset = 0; T.tex.userData.draw(); T.tex.needsUpdate = true; }
}

// ---------- hidden finds ----------
const FINDS = [
  { id: 'golden', at: [49.29245, -123.11780], gun: 'golden', ammo: 0, title: '✨ THE GOLDEN GOOSE', text: 'A gold-plated pistol in a dusty lockbox on Deadman\'s Island. Unlimited ammo, one of a kind. (It still won\'t point at people: it\'s golden, not evil.)', secret: 'goldengun' },
  { id: 'paint', at: [49.30105, -123.14555], gun: 'paint', ammo: 60, title: '🎨 Someone\'s lost paintball marker', text: 'Wedged inside Stanley Park\'s Hollow Tree, with 60 balls. Paint splats wash off in the rain.', secret: 'paintfind' },
  { id: 'rifle', at: [49.3605, -123.0275], gun: 'rifle', ammo: 10, title: '🎯 An old hunting rifle', text: 'Left in a hunting blind near Lynn Headwaters by "Grandpa Walt" (his name is carved on the stock). 10 rounds. Hunting still needs a licence + tag from Cabbagela\'s.', secret: 'hiddenrifle' },
  { id: 'crate', at: [49.2829, -123.0363], ammo: { '9mm': 50, '308': 10, '12ga': 25, paint: 100 }, title: '🧟 Fright Nights supply crate', text: 'Stencilled "PLAYLAND STAFF ONLY: ZOMBIE CONTINGENCY". Ammo for everything you own.', repeat: true },
];
const sparkTex = glowTex;
function buildFinds() {
  for (const f of FINDS) {
    let [x, z] = toXZ(...f.at);
    for (let r = 0; r < 60 && (isWater(x, z) || buildingAt(x, z)); r += 3) { const a = r * 1.7; x += Math.cos(a) * 3; z += Math.sin(a) * 3; }
    f.x = x; f.z = z; const y = walkY(x, z); f.y = y;
    const g = new THREE.Group(); g.position.set(x, y, z); scene.add(g); f.g = g;
    if (f.gun) { const m = gunModel(f.gun); m.rotation.set(0, 0.6, Math.PI / 2); m.position.y = 0.12; m.scale.setScalar(1.4); g.add(m); addMesh(new THREE.BoxGeometry(0.6, 0.1, 0.35), std(f.gun === 'golden' ? '#2a2a2a' : '#5a4a32'), 0, 0.05, 0, g); }
    else { addMesh(new THREE.BoxGeometry(1, 0.6, 0.6), std('#4a5a2a'), 0, 0.3, 0, g); addMesh(new THREE.BoxGeometry(1.02, 0.08, 0.62), std('#ecc94b'), 0, 0.45, 0, g); }
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 })); sp.scale.setScalar(0.9); sp.position.y = 0.6; g.add(sp); f.sp = sp;
  }
}
function updateFinds() {
  for (const f of FINDS) { if (!f.g) continue; const got = A().finds.includes(f.id) && !(f.repeat && G.t > (f.next || 0)); f.g.visible = !got && Math.hypot(player.x - f.x, player.z - f.z) < 160; if (f.g.visible) { f.sp.material.opacity = 0.35 + Math.sin(G.t * 4) * 0.25; f.g.rotation.y += G.dt * 0.4; } }
}
function takeFind(f) {
  if (f.gun) give(f.gun, f.ammo); else for (const [k, n] of Object.entries(f.ammo)) A().ammo[k] = (A().ammo[k] || 0) + n;
  if (!A().finds.includes(f.id)) A().finds.push(f.id); if (f.repeat) f.next = G.t + 600;
  ui.toast(f.title, f.text + (f.gun ? ` Press <kbd>O</kbd> or <kbd>${GUNS[f.gun].slot}</kbd> to draw it.` : ''), 6500); beep([659, 988, 1319], 0.18, 'triangle', 0.06, 0.1); if (f.secret) discover(f.secret);
}

// ---------- the shop ----------
const QUIZ_PAL = [
  ['What\'s the first thing you do when you pick up a firearm?', ['Check it\'s unloaded ("prove it safe")', 'Look down the barrel', 'Dry-fire it to test it'], 0],
  ['Where should the muzzle always point?', ['At whatever you\'re talking about', 'In a safe direction', 'Up at the sky, always'], 1],
  ['Where is your finger until you\'re ready to shoot?', ['Resting on the trigger', 'Off the trigger, along the frame', 'Inside the trigger guard'], 1],
  ['Before you shoot, be sure of…', ['Your target AND what\'s beyond it', 'The wind direction only', 'Nothing: just shoot'], 0],
  ['How do you carry a gun in a car in BC?', ['Loaded, for emergencies', 'Unloaded, and out of sight', 'On the dashboard'], 1],
];
const QUIZ_CORE = [
  ['Can you shoot a black bear cub, or a mother with cubs?', ['Yes, with a bear tag', 'No: never', 'Only in the fall'], 1],
  ['Grizzly bear hunting in BC is…', ['Open in the spring', 'Closed since 2017', 'Open with a grizzly tag'], 1],
  ['You harvested a buck. What about your tag?', ['Cancel it right away, then keep it with the animal', 'Use it again next time', 'Give it to a friend'], 0],
  ['Can you shoot from a road or out of a vehicle?', ['Yes, if the engine is off', 'No', 'Only on logging roads'], 1],
  ['Hunting in city parks, Stanley Park or a provincial park is…', ['Fine before 9 am', 'Not allowed', 'Fine with a bow'], 1],
  ['Can you hunt deer with a handgun in Canada?', ['No: handguns aren\'t allowed for hunting', 'Yes', 'Only small ones'], 0],
];
async function quiz(title, Q, n) {
  const qs = [...Q].sort(() => Math.random() - 0.5).slice(0, n);
  for (let k = 0; k < qs.length; k++) { const [q, opts, ok] = qs[k]; const i = await ui.dialog(title + ` (${k + 1}/${n})`, q, opts); if (i !== ok) { ui.toast('❌ Not quite', 'The instructor sighs and hands you the manual: "' + opts[ok] + '". Try again any time.', 4500); return false; } }
  return true;
}
const stars = (n, of = 5) => '★'.repeat(clamp(Math.round(n), 0, of)) + '☆'.repeat(of - clamp(Math.round(n), 0, of));
const rating = gd => `power ${stars(gd.dmg >= 200 ? 5 : gd.dmg >= 120 ? 4 : gd.dmg >= 60 || gd.pellets ? 3 : gd.dmg > 0 ? 2 : 0)} · range ${stars(gd.range >= 400 ? 5 : gd.range >= 140 ? 4 : gd.range >= 80 ? 3 : gd.range >= 30 ? 2 : 1)}`;
async function openShop(shop = null) {
  if (S.busy) return; S.busy = true;
  try {
    const AR = A(), opts = [], acts = [], list = STOCK[shop?.stock || 'all'], title = shop ? '🔫 ' + shop.name : '🦌 Cabbagela\'s Outdoors';
    const add = (t, f) => { opts.push(t); acts.push(f); };
    if (!AR.pal && list.some(id => GUNS[id].pal)) add('🪪 Take the safety course → PAL licence ($60)', async () => { if (player.money < 60) return ui.toast('Not enough money', '$60 for the course', 2000); if (await quiz('🪪 Canadian Firearms Safety Course', QUIZ_PAL, 3)) { spend(60); AR.pal = true; ui.toast('🪪 You got your PAL!', 'Possession & Acquisition Licence: you can now buy rifles and shotguns. (The real course is a full day, plus an exam and a background check.)', 6000); discover('pal'); } });
    const buy = id => { const gd = GUNS[id]; if (gd.pal && !AR.pal) return ui.toast('🪪 PAL first', 'In Canada you need a Possession & Acquisition Licence to buy a rifle or shotgun. Take the safety course at the counter.', 4000); if (!spend(gd.price)) return; give(id, gd.ammo ? AMMO[gd.ammo][1] : 0); if (id === 'tranq') AR.research = true;
      ui.toast('🛍️ ' + gd.name, gd.desc + ` Press ${gd.slot} (or O) to draw it.` + (id === 'tranq' ? ' Comes with a BC Wildlife Research volunteer card: E on a sleeping animal = GPS collar ($60).' : ''), 6500); discover('armory'); if (AR.guns.length >= 8) discover('arsenal'); };
    const mine = list.filter(id => !AR.guns.includes(id));
    if (mine.length) add(`🔫 Guns & gear (${mine.length} for sale)…`, async () => {
      const i = await ui.dialog(title + ': the rack', mine.map(id => `<b>${GUNS[id].icon} ${GUNS[id].name}</b> · ${money(GUNS[id].price)}${GUNS[id].pal && !AR.pal ? ' <i>(needs PAL)</i>' : ''}<br><small>${rating(GUNS[id])} · ${GUNS[id].desc}</small>`).join('<br>'), [...mine.map(id => `${GUNS[id].icon} ${GUNS[id].name.split(' (')[0]} ${money(GUNS[id].price)}`), '↩️ Back']);
      if (i < mine.length) buy(mine[i]);
    });
    for (const [k, [nm, n, pr]] of Object.entries(AMMO)) { if (!pr) continue; const own = Object.keys(GUNS).some(id => GUNS[id].ammo === k && AR.guns.includes(id)); if (own) add(`📦 ${nm} · ${money(pr)}  (have ${AR.ammo[k] || 0})`, () => { if (spend(pr)) { AR.ammo[k] = (AR.ammo[k] || 0) + n; SND.reload(); } }); }
    if (!shop || shop.tags) {
      if (!AR.licence) add('🦌 Hunter course → BC hunting licence ($32)', async () => { if (player.money < 32) return ui.toast('Not enough money', '', 1500); if (await quiz('🦌 CORE hunter education', QUIZ_CORE, 3)) { spend(32); AR.licence = true; ui.toast('🦌 BC hunting licence', 'Now buy a tag for the animal you want to hunt. Small game (grouse, snowshoe hare) only needs the licence. Read the regulations before you go!', 6000); } });
      else for (const [k, [nm, pr]] of Object.entries(TAGS)) add(`🏷️ ${nm} · ${money(pr)}${AR.tags[k] ? ` (have ${AR.tags[k]})` : ''}`, () => { if (spend(pr)) { AR.tags[k] = (AR.tags[k] || 0) + 1; ui.toast('🏷️ ' + nm, 'One tag = one animal. Cancel it right after a harvest (the game does that for you).', 3000); } });
      add('📖 Read the hunting regulations (+ where to hunt)', () => { ui.dialog('📖 BC Hunting & Trapping Regulations (game version)', 'Open seasons: <b>buck deer</b>, <b>bull elk</b>, <b>moose</b> + <b>grouse</b> in the fall; <b>black bear</b> in spring and fall (never cubs, never a mother with cubs, never a white "spirit" bear); <b>snowshoe hare</b> fall + winter.<br><br>Closed: grizzlies (since 2017), does, cows, mountain goats and anything else.<br>No hunting in town, in city parks, from a road or a vehicle, or with a handgun. Big game: a centrefire rifle, a bow or a crossbow. Small game: a shotgun or a .22.<br><br>Poaching = a conservation officer fine, and the serious stuff gets your gun seized.<br><br>Good spot: Crown land in the Squamish valley, north of town. (We\'ll set a waypoint.)', ['📍 Set the waypoint', 'OK']).then(i => { if (i === 0) setWaypoint({ x: toXZ(49.795, -123.12)[0], z: toXZ(49.795, -123.12)[1] }); }); });
    }
    add('👋 Just looking', () => { });
    const i = await ui.dialog(title, (shop ? shop.note : 'Camo, coolers and every shade of fleece.') + ' <i>Handguns: none for sale (Canada froze handgun sales in 2022).</i><br>You have ' + money(player.money) + '.', opts);
    S.busy = false; await acts[i]?.();
  } finally { S.busy = false; }
}
function give(id, ammo) {
  const AR = A(); if (!AR.guns.includes(id)) AR.guns.push(id); const k = GUNS[id].ammo;
  if (k) AR.ammo[k] = (AR.ammo[k] || 0) + (ammo || 0);
  if (S.mag[id] === undefined) S.mag[id] = 0; reloadNow(id, true);
}
function reloadNow(id, silent) { const gd = GUNS[id], AR = A(); const need = gd.mag - (S.mag[id] || 0); if (need <= 0) return; if (!gd.ammo) { S.mag[id] = gd.mag; return; } const n = Math.min(need, AR.ammo[gd.ammo] || 0); S.mag[id] = (S.mag[id] || 0) + n; AR.ammo[gd.ammo] = (AR.ammo[gd.ammo] || 0) - n; }

// ---------- draw / holster / reload ----------
function draw(id) {
  if (!id || !A().guns.includes(id)) return;
  if (player.vehicle || player.transit || player.swimming || G.dialogOpen) { ui.toast('Not now', player.vehicle ? 'Guns stay holstered in vehicles (BC law: unloaded and out of sight).' : '', 1500); return; }
  ensureModels(); S.out = id; A().last = id; player.gunOut = true; S.cool = 0.35; S.reloadT = 0; S.charge = 0; if (S.mag[id] === undefined) { S.mag[id] = 0; reloadNow(id, true); }
  for (const k in handGuns) handGuns[k].visible = k === id; for (const k in viewGuns) viewGuns[k].visible = k === id;
  S.aimP = clamp(G.camPitch - 0.25, -1.1, 1.1); SND.reload();
  const gd = GUNS[id];
  if (!S.hinted) { S.hinted = true; ui.toast(gd.icon + ' ' + gd.name, 'Mouse = aim · click = shoot · right mouse = aim down sights' + (gd.scope ? ' (scope)' : '') + ' · R = reload · O = holster · 1-9, 0 or the mouse wheel = switch', 5500); }
  else ui.toast(gd.icon + ' ' + gd.name, rating(gd), 1200);
  return true;
}
function holster() { if (!S.out) return; S.out = null; player.gunOut = false; S.ads = 0; S.charge = 0; for (const k in handGuns) handGuns[k].visible = false; if (viewGrp) viewGrp.visible = false; setHud(); }
function startReload() {
  const id = S.out, gd = GUNS[id]; if (!id || S.reloadT > 0 || S.mag[id] >= gd.mag) return;
  if (gd.ammo && !(A().ammo[gd.ammo] > 0)) { SND.dry(); ui.toast('Out of ammo', gd.rental ? 'Buy another box at the range desk.' : 'Buy more at a gun shop (🎯 on the map) or Cabbagela\'s Outdoors at the range.', 2500); return; }
  S.reloadT = gd.reload; ({ shotgun: SND.pump, rifle: SND.bolt, magnum: SND.bolt, bow: SND.draw, crossbow: SND.draw, water: () => swish(1.2, 0.04, 900, 0.3) })[id]?.() ?? SND.reload();
}
// guns in a slot, in order (pressing the same number again cycles through them)
function slotGuns(n) { return Object.keys(GUNS).filter(id => GUNS[id].slot === n && A().guns.includes(id)); }
function cycle(dir) { const own = Object.keys(GUNS).filter(id => A().guns.includes(id)); if (!own.length) return; const i = own.indexOf(S.out); draw(own[(i + dir + own.length) % own.length]); }

// ---------- shooting ----------
function aimDir(out) { const y = G.camYaw, p = S.aimP, cp = Math.cos(p); return out.set(-Math.sin(y) * cp, -Math.sin(p), -Math.cos(y) * cp).normalize(); }
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _pd = new THREE.Vector3(), _mz = new THREE.Vector3();
const projs = [];
function muzzleWorld(out) {
  const fp = camModeNow() === 2 || (GUNS[S.out]?.scope && S.ads > 0.5);
  const src = fp ? viewGuns[S.out] : handGuns[S.out]; if (!src) return out.copy(camera.position);
  src.updateMatrixWorld(true); return out.copy(src.userData.muz).applyMatrix4(src.matrixWorld);
}
function fire(charge = 1) {
  const id = S.out, gd = GUNS[id]; if (!id || S.cool > 0 || S.reloadT > 0) return false;
  if ((S.mag[id] || 0) <= 0) { SND.dry(); S.cool = 0.25; startReload(); return false; }
  camera.updateMatrixWorld(); _o.copy(camera.position); aimDir(_d);
  const skip = Math.max(0.5, (player.x - _o.x) * _d.x + (player.y + 1.4 - _o.y) * _d.y + (player.z - _o.z) * _d.z + 0.4);
  // children and the Downtown Eastside characters are never targets: the trigger won't move
  if (gd.fx !== 'water' && gd.fx !== 'foam') { const ppl = peopleHit(_o, _d, gd.range, 0.1, skip - 0.6); if (ppl && (ppl.kid || ppl.dtes) && !worldHit(_o, _d, skip, ppl.t)) { blockedShot(ppl); S.cool = 0.6; return false; } }
  S.mag[id] -= gd.perShot ? Math.min(S.mag[id], gd.perShot) : 1; S.cool = gd.rate; S.shots++;
  SND[gd.snd]?.(); muzzleWorld(_mz);
  const big = gd.fx === 'bullet' || gd.fx === 'pellet' || gd.fx === 'flare';
  flash.position.copy(_mz); flash.scale.setScalar(gd.fx === 'flare' ? 0.5 : id === 'magnum' ? R(0.7, 1) : id === 'rugrat' ? 0.18 : R(0.35, 0.6)); flash.visible = big; flashT = id === 'magnum' ? 0.07 : 0.05;
  if (gd.fx === 'spray') { sprayCone(gd); return true; }
  const spr = lerp(gd.spread, gd.ads, S.ads) + S.bloom, n = gd.pellets || 1;
  for (let k = 0; k < n; k++) {
    _pd.copy(_d); _pd.x += R(-1, 1) * spr; _pd.y += R(-1, 1) * spr; _pd.z += R(-1, 1) * spr; _pd.normalize();
    if (gd.proj) { const sp = gd.proj * (gd.charge ? 0.45 + 0.55 * charge : 1); projs.push({ p: _mz.clone(), v: _pd.clone().multiplyScalar(sp), id, life: gd.fx === 'flare' ? 25 : 4, dmg: gd.dmg * (gd.charge ? 0.35 + 0.65 * charge : 1), pen: gd.pen || 0, col: gd.fx === 'paint' ? pick(['#e53e3e', '#38a169', '#d69e2e', '#805ad5', '#ed64a6', '#3182ce']) : '#e53e3e', mesh: projMesh(id), hit: [] }); continue; }
    // hitscan: the round keeps going through up to `pen` bodies / thin things
    let s0 = skip, pen = gd.pen || 0, dmg = gd.dmg, last = null, end = null;
    for (let step = 0; step < 6; step++) {
      const h = castSeg(_o, _pd, gd.range, s0, last); if (!h) break; end = h.p;
      const dist = h.t, fall = gd.falloff ? clamp(1 - (dist - gd.falloff) / (gd.range - gd.falloff), 0.15, 1) : 1;
      const soft = impact(h, _pd, id, null, dmg * fall);
      if (!soft || pen <= 0) break; pen--; dmg *= 0.6; s0 = h.t + 0.35; last = h.obj || null;
    }
    tracer(_mz, end || _v2.copy(_o).addScaledVector(_pd, gd.range), gd.golden ? [1, 0.85, 0.2] : id === 'magnum' ? [1, 0.7, 0.3] : [1, 0.8, 0.45]);
  }
  S.bloom = Math.min(0.06, S.bloom + gd.kick * 0.25);
  S.kickP += gd.kick * (1 - S.ads * 0.4); S.kickY += R(-0.4, 0.4) * gd.kick;
  if (!gd.silent) noisy(id);
  if (Math.hypot(player.x - RANGE.x, player.z - RANGE.z) < 80 && !S.rangeHi) { S.rangeHi = true; discover('gunrange'); }
  if ((S.mag[id] || 0) <= 0 && GUNS[id].ammo !== null) setTimeout(() => { if (S.out === id) startReload(); }, gd.rate * 1000);
  return true;
}
// bear spray: a 9 m cone of orange fog
function sprayCone(gd) {
  const o = _mz, d = _d;
  for (let k = 0; k < 10; k++) { const i = pI++ % PN; pPos.set([o.x, o.y, o.z], i * 3); const sp = R(6, 11); pVel.set([d.x * sp + R(-1.3, 1.3), d.y * sp + R(-0.6, 1.2), d.z * sp + R(-1.3, 1.3)], i * 3); pLife[i] = R(0.6, 1.1); pBase.set([1, R(0.45, 0.6), 0.2], i * 3); }
  const inCone = (x, y, z) => { const dx = x - player.x, dy = y - (player.y + 1.3), dz = z - player.z, L = Math.hypot(dx, dy, dz); return L < gd.range && L > 0.2 && (dx * d.x + dy * d.y + dz * d.z) / L > Math.cos(gd.cone); };
  for (const a of _fauna.live) if (!a.down && inCone(a.x, a.y + 0.7, a.z) && G.t - (a.sprayT || -9) > 1) { a.sprayT = G.t; _fauna.setSt(a, 'flee', 14); a.tx = a.x + (a.x - player.x) * 5; a.tz = a.z + (a.z - player.z) * 5; say(a, a.kind === 'bear' ? '*COUGH* *HUFF* (nope nope nope)' : '*sneeze*', 1600); if (a.kind === 'bear' && !S.sprayToast) { S.sprayToast = 1; ui.toast('🌶️ Bear spray works', 'Studies of real bear encounters found spray stopped the bear about 9 times out of 10 (better than guns). Keep it on your belt, not in your pack.', 6000); discover('bearspray'); } }
  for (const z of zombies) if (z.state !== 'dead' && inCone(z.x, z.y + 1.2, z.z)) { z.slowT = 6; if (Math.random() < 0.1) say(z, 'Hrrkk! *cough*', 1000, 'zombie'); }
  for (const p of peds) if (p.state !== 'dead' && p.state !== 'down' && p.x < 1e5 && inCone(p.x, p.y + 1.3, p.z)) { if ((p.sc || 1) < 0.8) continue; p.state = 'down'; p.timer = 7; p.after = 'flee'; say(p, pick(['*COUGH* MY EYES!', 'AAAH it BURNS!', '*cough cough* WHY?!']), 2000); crime(1, p.x, p.z, 'assault'); }
  for (const c of WANTED.cops) if (c.hp > 0 && c.state === 'run' && inCone(c.x, c.y + 1.3, c.z)) hurtCop(c, 'stun', 0);
}
const projGeo = { paint: new THREE.SphereGeometry(0.03, 6, 4), tranq: new THREE.CylinderGeometry(0.008, 0.008, 0.14, 5).rotateX(Math.PI / 2), bow: new THREE.CylinderGeometry(0.005, 0.005, 0.72, 5).rotateX(Math.PI / 2), crossbow: new THREE.CylinderGeometry(0.006, 0.006, 0.42, 5).rotateX(Math.PI / 2), flare: new THREE.SphereGeometry(0.06, 8, 6), water: new THREE.SphereGeometry(0.035, 5, 4), foam: new THREE.CylinderGeometry(0.012, 0.012, 0.07, 6).rotateX(Math.PI / 2) };
const projMat = { bow: std('#d69e2e'), crossbow: std('#c53030'), flare: new THREE.MeshBasicMaterial({ color: '#ff5a3c' }), water: new THREE.MeshStandardMaterial({ color: '#9fd8f0', transparent: true, opacity: 0.6, roughness: 0.05 }), foam: std('#dd6b20'), tranq: std('#e53e3e', { emissive: '#222' }) };
function projMesh(id) {
  const m = new THREE.Mesh(projGeo[id] || projGeo.paint, projMat[id] || std(pick(['#e53e3e', '#38a169', '#d69e2e', '#805ad5']), { emissive: '#222' }));
  if (id === 'flare') { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ff4a2a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); sp.scale.setScalar(5); m.add(sp); m.userData.glow = sp; }
  scene.add(m); return m;
}
const stuck = [];   // arrows / bolts / foam darts stuck where they landed
function stick(P, p, d) { P.mesh.position.copy(p).addScaledVector(d, -0.25); P.mesh.lookAt(_v.copy(P.mesh.position).add(d)); stuck.push({ m: P.mesh, t: G.t + 40 }); if (stuck.length > 40) scene.remove(stuck.shift().m); }
function updateProjs(dt) {
  for (let i = projs.length - 1; i >= 0; i--) {
    const P = projs[i], gd = GUNS[P.id]; P.life -= dt; P.v.y -= 9.8 * dt * (gd.grav ?? 1);
    if (P.id === 'flare') { P.v.multiplyScalar(1 - dt * 0.15); if (Math.random() < 0.6) burst(P.p, 1, '#ff7a3a', 0.4, 0.6); P.mesh.userData.glow.scale.setScalar(5 + Math.sin(G.t * 30) * 0.8); }
    if (P.landed) { P.life -= 0; if (P.life < 0) { scene.remove(P.mesh); projs.splice(i, 1); } continue; }
    const L = P.v.length() * dt, d = _pd.copy(P.v).normalize(); const h = castSeg(P.p, d, L, 0, P.hit[P.hit.length - 1]);
    if (h) {
      const soft = impact(h, d, P.id, P.col, P.dmg);
      if (soft && P.pen > 0) { P.pen--; P.dmg *= 0.6; P.hit.push(h.obj); P.p.copy(h.p).addScaledVector(d, 0.3); continue; }
      if (P.id === 'bow' || P.id === 'crossbow' || P.id === 'foam') { stick(P, h.p, d); projs.splice(i, 1); continue; }
      if (P.id === 'flare' && h.kind === 'ground' && G.season === 'summer' && (G.wet || 0) < 0.1 && !habitatAt(h.p.x, h.p.z).town && !G.fireWarn) { G.fireWarn = 1; addFire(h.p.x, h.p.y, h.p.z, 30, 1.6); ui.toast('🔥 Wildfire!', 'Dry summer grass catches instantly. (In real BC, a campfire ban usually means flares too.) It burns out after a while.', 4500); setTimeout(() => G.fireWarn = 0, 30000); }
      if (P.id === 'flare' && (h.kind === 'ground' || h.kind === 'building' || h.kind === 'prop')) { P.landed = true; P.mesh.position.copy(h.p).addScaledVector(d, -0.1); P.v.set(0, 0, 0); continue; }
      scene.remove(P.mesh); projs.splice(i, 1); continue;
    }
    P.p.addScaledVector(d, L); P.mesh.position.copy(P.p); P.mesh.lookAt(_v.copy(P.p).add(d));
    if (P.life < 0) { scene.remove(P.mesh); projs.splice(i, 1); }
  }
  for (let i = stuck.length - 1; i >= 0; i--) if (G.t > stuck[i].t) { scene.remove(stuck[i].m); stuck.splice(i, 1); }
}
// what a hit does. Returns true when the round could carry on through (a body, a paper target, a thin panel).
function impact(h, d, id, col, dmg = GUNS[id].dmg) {
  const gd = GUNS[id], fx = gd.fx, n = _v.copy(d).negate();
  if (h.t > 600 && ['person', 'zombie', 'animal', 'target', 'vehicle', 'aircraft'].includes(h.kind)) longShot(h.t);
  if (h.kind === 'target') { h.paint = fx === 'paint' ? col : null; if (fx === 'water' || fx === 'foam') { SND.boing(); return false; } const solid = h.obj.onHit(h.obj, h); if (fx === 'paint') decal(h.p, n, 0.12, col); else if (h.obj.paper) decal(h.p, n, 0.012, '#111'); else if (!solid) burst(h.p, 5, '#ffe9a8', 2, 1); return !!h.obj.paper; }
  if (h.kind === 'person') return hitPerson(h, d, id, col, dmg);
  if (h.kind === 'zombie') {
    const z = h.obj;
    if (fx === 'paint') { decal(h.p, n, 0.1, col); say(z, pick(['Urr? (I\'m… purple now)', 'Mrrgh… paint?']), 1500, 'zombie'); return false; }
    if (fx === 'water' || fx === 'foam') { if (Math.random() < 0.2) say(z, 'Mrr? (refreshing)', 1000, 'zombie'); return false; }
    if (fx === 'dart') { z.state = 'dead'; z.timer = 3; say(z, 'Zzz…urrk', 1200, 'zombie'); hitMark('hit'); return false; }
    const zz = h.head ? 'head' : bodyZone(h, z); z.hp = (z.hp ?? 100) - dmg * (zz === 'head' ? 3 : zz === 'torso' ? 1 : 0.5) * (fx === 'flare' ? 3 : 1); burst(h.p, 10, '#4a6a2a', 2, 2); SND.hitBody(); if (zz === 'leg') { z.slowT = 9999; say(z, '*drags its leg*', 1200, 'zombie'); }
    if (z.hp <= 0) { z.state = 'dead'; z.timer = 3; zstats.kills++; A().zk = (A().zk || 0) + 1; say(z, h.head ? 'URK!' : 'Urrk…', 1000, 'zombie'); hitMark(h.head ? 'bull' : 'hit'); if (h.head && Math.random() < 0.3) ui.toast('🧟 HEADSHOT', 'Fright Nights: ' + A().zk + ' zombies down', 900); if (A().zk >= 25) discover('zombiehunter'); }
    else { hitMark('hit'); z.yaw += R(-0.6, 0.6); say(z, pick(['Grraah!', 'Hnnngh…', 'BRAAAINS (angrily)']), 900, 'zombie'); }
    return true;
  }
  if (h.kind === 'animal') { shootAnimal(h.obj, id, h, col, dmg); return true; }
  if (h.kind === 'aircraft') { if (fx === 'water' || fx === 'foam' || fx === 'paint' || fx === 'dart') { if (fx === 'paint') decal(h.p, n, 0.3, col); return false; } hitAircraft(h, d, id, dmg * (fx === 'flare' ? 3 : 1)); return false; }
  if (fx === 'paint') { decal(h.p, h.n || n, R(0.12, 0.22), col); SND.splat(); burst(h.p, 6, col, 1.2, 1); return false; }
  if (fx === 'water') { if (Math.random() < 0.3) burst(h.p, 3, '#cfe8f0', 0.8, 1); if (Math.random() < 0.15) SND.squish(); return false; }
  if (fx === 'foam') { SND.boing(); return false; }
  if (fx === 'dart' || fx === 'arrow') { SND.thunk(); if (h.kind === 'vehicle') hitVehicle(h, d, id, dmg * 0.3); return false; }
  if (h.kind === 'water') { SND.splash(); burst(h.p, id === 'magnum' ? 22 : 10, '#cfe8f0', 0.8, id === 'magnum' ? 6 : 3.5); return false; }
  if (h.kind === 'vehicle') { hitVehicle(h, d, id, dmg); return false; }
  if (h.kind === 'prop') {
    const c = h.c, ht = c.top - (c.base ?? c.top - 2), need = c.kind === 'fly' ? 1 : c.kind === 'hydrant' ? 2 : ht < 2.6 ? 2 : ht < 7 ? 4 : 99;
    if (c.brk && (gd.power || 0) >= need) { const o = { x: c.x, z: c.z }; collideStatic(o, 0.01, c.top - 0.2, Math.max(c.brk + 2, 13), _v2.set(d.x, 0, d.z).normalize()); hitMark('hit'); SND.ric(); burst(h.p, 10, '#cbd5e0', 2.5, 2); return false; }
    SND.ric(); burst(h.p, 6, '#ffe08a', 2.5, 1.5); decal(h.p, n, 0.014, '#2a2a2a'); return false;
  }
  if (fx === 'flare') { burst(h.p, 20, '#ff6a2a', 2, 3); return false; }
  // ground / buildings
  burst(h.p, id === 'magnum' ? 14 : 6, h.kind === 'ground' ? '#8a7a5a' : '#c0b8a8', id === 'magnum' ? 3 : 1.6, 1.8); decal(h.p, h.n || n, id === 'shotgun' ? 0.012 : id === 'magnum' ? 0.03 : id === 'rugrat' ? 0.008 : 0.016, '#262626'); if (Math.random() < 0.3) SND.ric();
  return false;
}
// vehicles: bullet holes, broken glass, smoke when it's had enough; a big round shoves it; drivers bail or floor it
function hitVehicle(h, d, id, dmg) {
  const v = h.obj, gd = GUNS[id]; v.gunHp = (v.gunHp ?? 300) - dmg;
  decal(h.p, _v.copy(d).negate(), id === 'magnum' ? 0.03 : 0.015, '#1a1a1a'); burst(h.p, 6, '#ffe08a', 3, 2);
  if (Math.random() < 0.35) { SND.glassCar(); burst(h.p, 10, '#cfe8f0', 2, 2); } else SND.metal();
  if (gd.push && knock) try { knock(v, d.x * gd.push, d.z * gd.push, R(-0.4, 0.4), 4); } catch (e) { /* knock is optional */ }
  if (h.occupied && v.ai && !v.ai.flee) { v.ai.flee = true; crime(1, v.x, v.z, 'shooting at a car'); if (G.t - (S.carToast || -99) > 8) { S.carToast = G.t; ui.toast('🚗 The driver floors it!', 'Tyres squeal as they speed away from you.', 2200); } }
  if (gd.fx === 'flare') v.gunHp -= 250;
  if (v.gunHp <= -150 && !v.burning) { v.burning = true; v.smk && (v.smk.end = 0); v.fire = addFire(0, 0, 0, 90, 1.1, { obj: v, oy: 0.9 }); ui.toast('🔥 It\'s on fire!', 'Fuel is leaking into the flames. Get back!', 2500); setTimeout(() => { if (vehicles.includes(v)) { explode(v.x, v.y || walkY(v.x, v.z), v.z, 1.2, 'car explosion'); v.d = Object.create(v.d); v.d.max = 0; v.wreck = true; v.g.traverse(o => { if (o.isMesh && o.material && !o.material.userData?.burnt) { o.material = o.material.clone(); o.material.color?.multiplyScalar(0.15); o.material.userData = { burnt: true }; } }); } }, 4500); }
  if (v.gunHp <= 0 && !v.smoking) { v.smoking = true; v.smk = addFire(0, 0, 0, 240, 0.8, { flame: false, obj: v, oy: 1 }); ui.toast('💨 That vehicle\'s had it', 'Steam pours from the engine. It\'s not going anywhere fast.', 2500); if (v.d) { v.d = Object.create(v.d); v.d.max = (v.d.max || 20) * 0.3; } }
  if (!h.occupied && G.t - (S.carToast || -99) > 25) { S.carToast = G.t; ui.toast('🚗 *PING* *CRASH*', 'Holes, cracked glass, and somebody\'s insurance premium going up.', 1800); }
}
const smokeCars = () => vehicles.filter(v => v.smoking && Math.hypot(v.x - player.x, v.z - player.z) < 150);
// people: bullets hurt or kill, darts put them to sleep, paint/foam/water just annoy them. Every hit is a crime.
function hitPerson(h, d, id, col, dmg) {
  const p = h.obj, gd = GUNS[id], fx = gd.fx;
  if (h.kid || h.dtes) return false;
  if (h.cop) {
    if (fx === 'dart') { hurtCop(p, 'sleep', 0); hitMark('hit'); return false; }
    if (fx === 'paint' || fx === 'foam' || fx === 'water') { say(p, pick(['That\'s assaulting an officer, pal!', 'Oh, you\'re in TROUBLE now.']), 1500); crime(1, p.x, p.z, 'assaulting an officer'); return false; }
    const z = bodyZone(h, p); hurtCop(p, 'hit', dmg * ZONE_MULT[z]); SND.hitBody(); bleed(h.p, d, dmg * ZONE_MULT[z]); if (p.hp <= 0) pool(p.x, p.y, p.z, 0.6); hitMark(z === 'head' ? 'bull' : 'hit'); return true;
  }
  if (fx === 'paint') { decal(h.p, _v.copy(d).negate(), 0.1, col); say(p, pick(['OW! Paintball?! Really?!', 'My NEW jacket!', 'That STINGS!']), 1800); p.state = 'flee'; p.timer = 6; player.karma -= 1; return false; }
  if (fx === 'water') { if (G.t - (p.wetT || -99) > 3) { p.wetT = G.t; const hot = G.season === 'summer' && G.hour > 10 && G.hour < 19; say(p, hot ? pick(['Ha! Thanks, it\'s HOT!', 'Again! Again!', 'Best day ever!']) : pick(['HEY! My PHONE!', 'It\'s ' + (G.season === 'winter' ? 'FREEZING' : 'cold') + ', you maniac!', 'Not cool. Literally.']), 1800); if (!hot) { p.state = 'flee'; p.timer = 4; } else if (!S.waterFun) { S.waterFun = 1; discover('drencher'); } } return false; }
  if (fx === 'foam') { say(p, pick(['Pew pew? Grow up.', 'Is that… a Nerf dart?', 'I will NOT be dueling you.', '*picks up the dart and fires it back*']), 1800); SND.boing(); return false; }
  if (fx === 'dart') { p.state = 'down'; p.timer = 25; p.after = 'groggy'; say(p, 'wha… *yawn*… zzz', 1500); hitMark('hit'); crime(1, p.x, p.z, 'darting a person'); return false; }
  // a real hit: WHERE it lands decides what happens
  const zone = bodyZone(h, p), mult = ZONE_MULT[zone];
  p.hp = (p.hp ?? 100) - dmg * mult * (fx === 'flare' ? 0.8 : 1); SND.hitBody(); bleed(h.p, d, dmg * mult);
  scareAround(35, true, p);
  if (p.hp <= 0) { p.state = 'dead'; p.timer = 45; p.say = null; p.bleedT = 0; hitMark(zone === 'head' ? 'bull' : 'hit'); pool(p.x, p.y, p.z, 0.55 + Math.min(0.5, dmg / 400)); player.karma -= 10; S.kills = (S.kills || 0) + 1; crime(2, p.x, p.z, 'murder'); paramedics(p); }
  else {
    p.bleedT = G.t + 25; hitMark('hit'); player.karma -= 4; crime(1, p.x, p.z, 'assault');
    if (zone === 'leg') { p.limp = true; p.speed = Math.min(p.speed || 1.3, 0.55); p.state = 'down'; p.timer = 3; p.after = 'flee'; say(p, pick(['AAAH! MY LEG!', 'I can\'t walk! Somebody HELP!', 'My KNEE!']), 2200); }
    else if (zone === 'arm') { p.armHurt = true; p.state = 'flee'; p.timer = 10; say(p, pick(['ARGH! My ARM!', 'I\'m hit! It\'s my arm!', 'Ow ow OW!']), 2200); }
    else { p.state = 'down'; p.timer = zone === 'head' ? 6 : 3.5; p.after = 'flee'; say(p, fx === 'flare' ? pick(['AAAH! FIRE! STOP, DROP AND ROLL!', 'I\'M ON FIRE!']) : pick(['AAAH! I\'m HIT!', 'Call an ambulance!', 'Why?! WHY?!']), 2000); }
  }
  return true;
}
// head / torso / arm / leg from where on the body the round landed
const ZONE_MULT = { head: 2.6, torso: 1, arm: 0.4, leg: 0.5 };
function bodyZone(h, p) {
  if (h.head) return 'head';
  const sc = p.sc || 1, ly = (h.p.y - (p.y || 0)) / sc; if (ly < 0.85) return 'leg';
  const rx = Math.cos(p.yaw || 0), rz = -Math.sin(p.yaw || 0), side = (h.p.x - p.x) * rx + (h.p.z - p.z) * rz;
  return Math.abs(side) > 0.17 * sc && ly < 1.45 ? 'arm' : 'torso';
}
// blood: a spray of drops where it hits, a few spatters on the ground behind, a pool under the fallen
function bleed(p, d, amount) {
  const n = Math.round(clamp(amount / 8, 4, 18)); burst(p, n, '#8a0f0f', 1.3, 1.2, 0.25);
  for (let k = 0; k < Math.min(3, n / 5); k++) { const x = p.x + d.x * R(0.4, 1.6) + R(-0.3, 0.3), z = p.z + d.z * R(0.4, 1.6) + R(-0.3, 0.3); decal(_v2.set(x, walkY(x, z, p.y) + 0.02, z), _up2, R(0.05, 0.14), '#5a0a0a'); }
}
const _up2 = new THREE.Vector3(0, 1, 0);
function pool(x, y, z, size) { decal(_v2.set(x, walkY(x, z, y + 0.5) + 0.02, z), _up2, size, '#4a0808'); }
// the walking wounded leave a trail of drops
function updateBleeding(dt) {
  for (const p of peds) if (p.bleedT > G.t && p.x < 1e5 && Math.random() < dt * 2.5) { burst(_v.set(p.x, p.y + 0.9, p.z), 1, '#8a0f0f', 0.2, 0.2); if (Math.random() < 0.5) decal(_v2.set(p.x + R(-0.2, 0.2), walkY(p.x, p.z, p.y + 0.5) + 0.02, p.z + R(-0.2, 0.2)), _up2, R(0.03, 0.07), '#5a0a0a'); }
  for (const a of _fauna.live) if (a.bleedT > G.t && !a.down && Math.random() < dt * 2) decal(_v2.set(a.x, walkY(a.x, a.z, a.y + 0.5) + 0.02, a.z), _up2, R(0.04, 0.09), '#5a0a0a');
}
function crime(level, x, z) { addCrime(level, x, z); }
function longShot(t) { if (t > (S.longBest || 0)) { S.longBest = t; ui.toast('🔭 Long shot: ' + Math.round(t).toLocaleString('en-CA') + ' m', t > 1500 ? 'That\'s past the length of the Lions Gate Bridge. Absurd.' : 'Further than most hunters would ever try.', 2200); } if (t > 1000) discover('longshot'); }
// where an animal was hit, along its body (front = the head end)
function animalZone(a, h) {
  const b = animalBox(a); if (b.bird || b.L < 0.2) return 'body';
  const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw), along = ((h.p.x - a.x) * fx + (h.p.z - a.z) * fz) / (b.L * 0.6), low = h.p.y < b.y - b.r * 0.45;
  if (along > 1.1) return 'head'; if (low) return 'leg'; if (along > 0.2) return 'vitals'; if (along < -0.45) return 'rear'; return 'body';
}
function paramedics(p) { setTimeout(() => { if (p.state === 'dead' && Math.hypot(p.x - player.x, p.z - player.z) < 200 && G.t - (S.ambT || -99) > 30) { S.ambT = G.t; ui.toast('🚑 Paramedics are on the way', 'Sirens in the distance. The street goes very quiet.', 2500); beep([700, 900, 700, 900], 0.3, 'sine', 0.02, 0.3); } }, 4000); }

// ---------- hunting ----------
function inSeason(id) { const L = LEGAL[id]; return L && L.seasons.includes(G.season || 'summer'); }
function shootAnimal(a, id, h, col, dmg) {
  const gd = GUNS[id], fx = gd.fx, flee = (m = 3, t = 8) => { _fauna.setSt(a, 'flee', t); a.tx = a.x + (a.x - player.x) * m; a.tz = a.z + (a.z - player.z) * m; };
  if (fx === 'paint') { decal(h.p, _v.copy(h.p).sub(camera.position).normalize().negate(), 0.12, col); flee(); player.karma -= 1; ui.toast('🎨 You paintballed a ' + a.S.name.toLowerCase(), 'It bolts, very confused and very purple. Not cool: they\'re wild animals. (-1 karma)', 3000); return; }
  if (fx === 'water' || fx === 'foam') { flee(2, 5); if (Math.random() < 0.3) say(a, fx === 'water' ? '*shakes off*' : '*sniffs the dart, unimpressed*', 1200); return; }
  if (fx === 'dart') { down(a, 'sleep'); hitMark('hit'); ui.toast('💤 Dart hit', a.S.name + ' is getting sleepy… In a few seconds you can walk up and press E to fit a research GPS collar.', 4000); return; }
  if (a.fence || a.resident) { ui.toast('🐻 Not this one', 'That\'s a well-known local bear on the wildlife cameras. The shot goes wide on purpose: your hands are shaking.', 3500); return; }
  // a real hit: does it go down?
  const az = animalZone(a, h), am = { vitals: 1.6, head: 2, body: 1, rear: 0.55, leg: 0.45 }[az];
  a.hp = (a.hp ?? animalHp(a)) - dmg * am * (fx === 'flare' ? 0.5 : 1); SND.hitBody(); bleed(h.p, _v2.copy(h.p).sub(camera.position).normalize().clone(), dmg * am * 0.6); a.bleedT = G.t + 40; a.lastZone = az;
  if (a.hp > 0) {
    hitMark('hit'); a.wounded = true;
    if ((a.kind === 'bear' || a.id === 'moose') && Math.random() < 0.55) { _fauna.setSt(a, a.kind === 'bear' ? 'chase' : 'charge', 6); say(a, a.kind === 'bear' ? '*ROAR*' : '*SNORT*', 1500); ui.toast('🐻 It\'s CHARGING!', 'A wounded animal is the most dangerous kind. Bear spray (slot 8) or a clean follow-up shot, now!', 3500); }
    else flee(5, 14);
    if (az === 'leg' || az === 'rear') { a.limp = true; }
    if (G.t - (S.woundT || -99) > 30) { S.woundT = G.t; ui.toast('⚠️ Wounded, not down (' + az + ' hit)', `${gd.name.split(' (')[0]} hit for ${Math.round(dmg)}, but a ${a.S.name.toLowerCase()} takes about ${animalHp(a)}. Ethical hunters use enough gun and aim just behind the front leg (heart and lungs).`, 6000); }
    return;
  }
  const why = legalWhy(a, id);
  down(a, 'dead'); hitMark('bull'); pool(a.x, a.y, a.z, 0.4 + (a.sc || 1) * 0.35); if (az === 'vitals' || az === 'head') ui.toast(az === 'head' ? '🎯 Head shot' : '🎯 Heart-lung shot', az === 'vitals' ? 'Right behind the front leg: quick and clean, the way it should be.' : 'Instant. (Hunters usually avoid head shots: too easy to miss and only wound.)', 2200);
  if (!why) {
    const L = LEGAL[a.id]; if (L.tag) A().tags[L.tag]--; a.legal = true;
    ui.toast('🦌 Clean, legal harvest', `${L.name}${L.tag ? ' · tag cancelled' : ''}. Walk up and press E to field-dress it and pack it out.`, 5000);
  } else {
    a.legal = false; const serious = SERIOUS.includes(a.id) || a.white || a.cub, fine = serious ? pick([2300, 3450]) : pick([575, 805, 1150]);
    player.money = Math.max(0, player.money - fine); player.karma -= serious ? 10 : 5;
    let seized = ''; if (serious && A().guns.includes(id) && !GUNS[id].golden) { A().guns = A().guns.filter(g => g !== id); holster(); seized = ` Your ${GUNS[id].name} was seized.`; }
    setTimeout(() => ui.toast('🚔 POACHING: fined ' + money(fine), `A BC Conservation Officer steps out of the trees. ${why}${seized} (-${serious ? 10 : 5} karma)`, 8000), 900);
    discover('wildfine');
  }
}
function legalWhy(a, gun) {
  const L = LEGAL[a.id], c = habitatAt(a.x, a.z);
  const g = GUNS[gun];
  if (gun === 'flare') return 'A flare gun is a distress signal, not a hunting weapon.';
  if (gun === 'pistol' || gun === 'golden') return 'Handguns can\'t be used for hunting in Canada.';
  if (a.white) return 'You shot a Kermode "spirit bear". They\'re protected, sacred to the Gitga\'at and Kitasoo/Xai\'xais Nations, and there are only a few hundred.';
  if (a.cub || (a.cubs && a.cubs.length)) return 'Bear cubs and mothers with cubs are never legal.';
  if (!L) return WHY[a.id] || (a.S.name + ' is not a game animal you can hunt.');
  if (!A().licence) return 'You don\'t have a BC hunting licence (Cabbagela\'s sells them).';
  if (!inSeason(a.id)) return `${L.name} season is closed in ${G.season} (open: ${L.seasons.join(' + ')}).`;
  if (L.tag && !(A().tags[L.tag] > 0)) return `You need a ${TAGS[L.tag][0].toLowerCase()} for that.`;
  if (L.big && g.cls !== 'big') return 'Big game needs a centrefire rifle, a bow or a crossbow (a .22 or birdshot only wounds it).';
  if (!L.big && g.cls !== 'small' && gun !== 'bow' && gun !== 'crossbow') return 'Use a shotgun or a .22 for small game (a big rifle just destroys it).';
  if (c.town || c.city || c.park) return 'No hunting in town or in parks.';
  if (nearestRoad(player.x, player.z, 6, r => r.t <= 5)) return 'No shooting from a road.';
  return null;
}
const habitatAt = (x, z) => { try { return _fauna.habitat(x, z); } catch (e) { return {}; } };
function down(a, kind) {
  a.down = kind; a.downT = kind === 'sleep' ? 40 : 240; a.spd = 0; a.amp = 0; a.fly = 0; a.alt = 0; a.stand = 0; a.lie = kind === 'dead' ? 0.7 : 1; a.roll = kind === 'dead' ? 1.35 : 0.25;
  a.y = walkY(a.x, a.z, a.y + 1.5); for (const cb of a.cubs || []) { cb.st = 'up'; }
}
function updateDowned(dt) {
  for (const a of _fauna.live) {
    if (!a.down) continue; a.downT -= dt; a.spd = 0; a.amp = 0;
    if (a.down === 'sleep' && a.downT < 0) { a.down = null; a.lie = 0; a.roll = 0; _fauna.setSt(a, 'flee', 8); a.tx = a.x + (a.x - player.x) * 4 + R(-10, 10); a.tz = a.z + (a.z - player.z) * 4 + R(-10, 10); say(a, '*yawn* …!!', 1500); }
    else if (a.down === 'dead' && (a.downT < 0 || Math.hypot(a.x - player.x, a.z - player.z) > 300)) a.gone = true;
  }
}
// help hunters find game: with a licence, in season, in the backcountry, legal animals turn up now and then
function updateGame(dt) {
  S.gameT -= dt; if (S.gameT > 0) return; S.gameT = R(40, 75);
  if (!A().licence || player.vehicle || player.transit || !S.out) return;
  const c = habitatAt(player.x, player.z); if (!c.wild || c.town || c.city) return;
  const ok = Object.keys(LEGAL).filter(id => inSeason(id) && (!LEGAL[id].tag || A().tags[LEGAL[id].tag] > 0) && !(id === 'bullelk' && player.z > -40000) && !(id === 'moose' && player.z > -60000));
  if (!ok.length) return;
  if (_fauna.live.some(a => ok.includes(a.id) && !a.down && Math.hypot(a.x - player.x, a.z - player.z) < 220)) return;
  for (let k = 0; k < 12; k++) {
    const ang = R(0, 6.28), r = R(70, 130), x = player.x + Math.cos(ang) * r, z = player.z + Math.sin(ang) * r, h = habitatAt(x, z);
    if (h.water || h.blocked || !h.wild || h.town) continue;
    const id = pick(ok), a = _fauna.make(id, x, z); if (id === 'buck' && Math.random() < 0.6) _fauna.make('deer', x + R(-6, 6), z + R(-6, 6));
    ui.toast(id === 'grouse' ? '🐦 A grouse is drumming nearby…' : id === 'hare' ? '🐇 Fresh hare tracks…' : '👣 Fresh tracks: there\'s game nearby', 'Look around (' + Math.round(r) + ' m or so). Check it\'s legal before you shoot: antlers? cubs?', 4000);
    void a; return;
  }
}
function downedPrompt() {
  let best = null, bd = 4; for (const a of _fauna.live) { if (!a.down) continue; const d = Math.hypot(a.x - player.x, a.z - player.z); if (d < bd) { bd = d; best = a; } }
  if (!best) return '';
  if (best.down === 'sleep') {
    if (!A().research) return `💤 The ${best.S.name.toLowerCase()} is fast asleep`;
    if (best.collared) return `💤 Collared ${best.S.name.toLowerCase()}, snoring`;
    if (tapped('KeyE')) { best.collared = true; A().collars++; player.money += 60; ui.toast('📡 GPS collar fitted', `BC Wildlife Research thanks you: your ${best.S.name.toLowerCase()} will help map how animals move between the mountains and the city. +$60`, 4500); discover('collared'); }
    return `<kbd>E</kbd> 📡 Fit a research GPS collar (${best.S.name.toLowerCase()})`;
  }
  if (tapped('KeyE')) {
    best.gone = true;
    if (best.legal) { A().hunts++; const pay = LEGAL[best.id].big ? 90 : 20; player.money += pay; ui.toast('🥩 Packed out', `You field-dressed the ${best.S.name.toLowerCase()} and donated some of the meat to a food bank. Wild game is lean, local and good eating. +${money(pay)}`, 5000); discover('firsthunt'); player.stats.hunts = A().hunts; }
    else ui.toast('🚔 Evidence', 'The conservation officer takes the animal as evidence. That\'s the end of that.', 3000);
  }
  return `<kbd>E</kbd> ${best.legal ? '🔪 Field-dress and pack out' : '🚔 Hand it over to the conservation officer'}`;
}

// ---------- people ----------
// children and the Downtown Eastside characters are never targets
function blockedShot(h) {
  SND.dry(); player.karma -= 2;
  if (h.kid) say(h.obj, pick(['MOMMY!', 'AAAH!', '😭']), 1800);
  else say(h.obj, pick(['Whoa, whoa, put that away!', 'Not cool, man.', 'Hey! I\'m just sitting here!']), 2000);
  scareAround(20, true);
  if (G.t - (S.blockT || -99) > 20) { S.blockT = G.t; ui.toast('🛑 Your finger freezes on the trigger', h.kid ? 'That\'s a kid. Not in this game, not ever. (-2 karma)' : 'Not the people living rough on Hastings: they\'re here as neighbours, not targets. (-2 karma)', 4500); }
}
function scareAround(r, scream, except = null) {
  for (const p of peds) { if (p === except || p.state === 'dead' || p.state === 'down') continue; const d = Math.hypot(p.x - player.x, p.z - player.z); if (d < r && p.state !== 'xwait' && p.state !== 'xcross') { p.state = 'flee'; p.timer = R(5, 9); if (scream && Math.random() < 0.5) say(p, pick(['AAAAH!', 'GUN!!', 'Call 911!', 'RUN!', 'Nope nope nope', 'Get DOWN!'])); } }
}
function noisy(id) {
  const loud = id === 'magnum' ? 110 : id === 'rifle' || id === 'shotgun' ? 75 : id === 'rugrat' ? 25 : 45;
  const c = habitatAt(player.x, player.z), atRange = Math.hypot(player.x - RANGE.x, player.z - RANGE.z) < 90, zone = Math.hypot(player.x - ZONE.x, player.z - ZONE.z) < ZONE.r + 40;
  if (!atRange && !zone && (c.town || c.city)) { scareAround(loud, true); if (G.t - S.cityWarn > 90) { S.cityWarn = G.t; ui.toast('😱 Gunshots in the city!', 'Everyone nearby runs for cover. Hit somebody and the police come.', 3500); } }
  for (const a of _fauna.live) if (!a.down && Math.hypot(a.x - player.x, a.z - player.z) < loud * 1.6) { if (a.kind !== 'bear' || Math.random() < 0.7) { _fauna.setSt(a, 'flee', 8); a.tx = a.x + (a.x - player.x) * 3; a.tz = a.z + (a.z - player.z) * 3; } }
}
// pointing a gun at someone: they scream and run (police officers yell back)
function aimAtPeople() {
  camera.updateMatrixWorld(); aimDir(_d); const h = peopleHit(camera.position, _d, 70, 0.25); S.aimPerson = null;
  if (!h || worldHit(camera.position, _d, 1, h.t)) return;
  S.aimPerson = h; const p = h.obj;
  if (G.t - (S.aimWarn.get(p) || -99) < 12) return; S.aimWarn.set(p, G.t);
  if (h.cop) { say(p, pick(['DROP THE WEAPON!', 'Lower it! NOW!', 'Don\'t do it!']), 1800); return; }
  if (p.state === 'down') return;
  if (!h.dtes) { p.state = 'flee'; p.timer = R(5, 8); }
  say(p, pick(h.dtes ? ['Whoa, whoa, put that away!', 'Not cool, man.'] : h.kid ? ['MOMMY!', '😭'] : ['AAAAH!', 'Don\'t shoot!!', 'Put it DOWN!', 'Help! HELP!', '😱', 'Take my wallet, just GO!']), 2200);
}

// ---------- HUD ----------
let hud = null, xh = null, scopeEl = null, hm = null;
function makeHud() {
  if (hud) return;
  const st = document.createElement('style'); st.textContent = `#gunhud{position:fixed;right:18px;bottom:150px;background:rgba(10,14,20,.72);color:#fff;font:600 14px Segoe UI,Arial;padding:8px 12px;border-radius:10px;z-index:30;pointer-events:none;text-align:right;line-height:1.35}#gunhud b{font-size:22px}#gunhud small{opacity:.75;font-weight:400}
#xhair{position:fixed;left:50%;top:50%;width:0;height:0;z-index:31;pointer-events:none}#xhair i{position:absolute;background:#fff;box-shadow:0 0 2px #000}#xhair .h{height:2px;width:9px;top:-1px}#xhair .v{width:2px;height:9px;left:-1px}#xhair .dot{width:3px;height:3px;left:-1.5px;top:-1.5px;border-radius:2px}
#xhair.red i{background:#ff4040}#hitm{position:fixed;left:50%;top:50%;width:26px;height:26px;margin:-13px;z-index:32;pointer-events:none;opacity:0;transition:opacity .15s}#hitm:before,#hitm:after{content:'';position:absolute;left:12px;top:0;width:2px;height:26px;background:#fff;transform:rotate(45deg)}#hitm:after{transform:rotate(-45deg)}#hitm.bull:before,#hitm.bull:after{background:#ffd700}
#scope{position:fixed;inset:0;z-index:29;pointer-events:none;background:radial-gradient(circle at 50% 50%,transparent 0,transparent 33vmin,rgba(0,0,0,.6) 33.5vmin,#000 34.5vmin);display:none}#scope:before,#scope:after{content:'';position:absolute;background:#000}#scope:before{left:0;right:0;top:50%;height:2px;margin-top:-1px}#scope:after{top:0;bottom:0;left:50%;width:2px;margin-left:-1px}`;
  document.head.appendChild(st);
  hud = document.createElement('div'); hud.id = 'gunhud'; hud.style.display = 'none'; document.body.appendChild(hud);
  xh = document.createElement('div'); xh.id = 'xhair'; xh.style.display = 'none'; xh.innerHTML = '<i class="h" style="left:-15px"></i><i class="h" style="left:6px"></i><i class="v" style="top:-15px"></i><i class="v" style="top:6px"></i><i class="dot"></i>'; document.body.appendChild(xh);
  scopeEl = document.createElement('div'); scopeEl.id = 'scope'; document.body.appendChild(scopeEl);
  hm = document.createElement('div'); hm.id = 'hitm'; document.body.appendChild(hm);
  setInterval(() => { if (performance.now() - S.lastUpd > 300) { hud.style.display = 'none'; xh.style.display = 'none'; scopeEl.style.display = 'none'; } }, 250);
}
function hitMark(kind) { if (!hm) return; hm.className = kind === 'bull' ? 'bull' : ''; hm.style.opacity = 1; clearTimeout(hm._t); hm._t = setTimeout(() => hm.style.opacity = 0, 160); }
function setHud() {
  makeHud(); const id = S.out;
  if (!id) { hud.style.display = 'none'; xh.style.display = 'none'; scopeEl.style.display = 'none'; return; }
  const gd = GUNS[id], res = gd.ammo ? (A().ammo[gd.ammo] || 0) : '∞', scope = gd.scope && S.ads > 0.6;
  hud.style.display = 'block'; hud.innerHTML = `${gd.icon} ${gd.name}<br><b>${S.mag[id] || 0}</b> / ${gd.mag} <small>· ${res} spare</small>${S.reloadT > 0 ? '<br><small>reloading…</small>' : ''}${S.charge > 0 ? '<br><span style="display:inline-block;width:120px;height:8px;background:#333;border-radius:4px;overflow:hidden"><span style="display:block;height:100%;width:' + Math.round(S.charge * 100) + '%;background:' + (S.charge >= 1 ? '#48bb78' : '#ecc94b') + '"></span></span>' : ''}${A().licence && Object.values(A().tags).some(n => n > 0) ? '<br><small>🏷️ ' + Object.entries(A().tags).filter(e => e[1] > 0).map(e => e[0] + ' ×' + e[1]).join(', ') + '</small>' : ''}`;
  xh.style.display = scope ? 'none' : 'block'; scopeEl.style.display = scope ? 'block' : 'none';
  const gap = 6 + (lerp(gd.spread, gd.ads, S.ads) + S.bloom) * 260; const ii = xh.children; ii[0].style.left = (-gap - 9) + 'px'; ii[1].style.left = gap + 'px'; ii[2].style.top = (-gap - 9) + 'px'; ii[3].style.top = gap + 'px';
  xh.className = S.aimPerson ? 'red' : '';
}

// ---------- every frame ----------
export function updateGuns(dt, pl) {
  player = pl; S.lastUpd = performance.now(); updateFx(dt); updateProjs(dt); updateDowned(dt); updateFinds(); updatePolice(dt);
  if (RANGE.built) { updateCh(dt); rangeSurprise(dt); updateRangeBits(dt); if (A().guns.includes('pistol') && GUNS.pistol.rental && Math.hypot(pl.x - RANGE.x, pl.z - RANGE.z) > 220) { A().guns = A().guns.filter(g => g !== 'pistol'); if (S.out === 'pistol') holster(); ui.toast('🔫 Rental returned', 'The range pistol stays at the range. Come back any time.', 2500); } }
  updateGame(dt); updateShopSigns();
  for (const z of zombies) if (z.slowT > 0) z.slowT -= dt;
  updateBleeding(dt);
  updateFires(dt);
  // keys
  if (!G.dialogOpen && !pl.transit) {
    if (tapped('KeyO')) { if (S.out) holster(); else draw(A().last && A().guns.includes(A().last) ? A().last : A().guns[0]) || (A().guns.length ? 0 : ui.toast('No guns yet', 'Gun shops are 🎯 on the map (Cabbagela\'s at the range rents a pistol too), and a few guns are hidden around town…', 3500)); }
    for (let n = 0; n <= 9; n++) if (tapped('Digit' + n)) { const ids = slotGuns(n); if (!ids.length) continue; const i = ids.indexOf(S.out); draw(ids[(i + 1) % ids.length]); }
    if (S.out && G.mouse.wheel) { if (GUNS[S.out].scope && S.ads > 0.5) { const n = (GUNS[S.out].zooms || [0]).length; S.zi = clamp((S.zi ?? 1) - Math.sign(G.mouse.wheel), 0, n - 1); G.mouse.wheel = 0; } else cycle(Math.sign(G.mouse.wheel)); }
  }
  if (!S.out) { setHud(); return; }
  if (pl.vehicle || pl.transit || pl.dead || pl.swimming || !A().guns.includes(S.out)) { holster(); return; }
  const gd = GUNS[S.out];
  S.cool -= dt; S.bloom = Math.max(0, S.bloom - dt * 0.12);
  if (S.reloadT > 0) { S.reloadT -= dt; if (S.reloadT <= 0) { S.reloadT = 0; reloadNow(S.out); } }
  if (tapped('KeyR')) startReload();
  S.ads += ((S.rmb ? 1 : 0) - S.ads) * Math.min(1, dt * 10);
  if (!G.dialogOpen) {
    if (gd.charge) {   // bow: hold to draw, let go to loose
      if (S.held && S.cool <= 0 && S.reloadT <= 0 && (S.mag[S.out] || 0) > 0) { if (!S.charge) SND.draw(); S.charge = Math.min(1, (S.charge || 0) + dt / 0.9); }
      else if (!S.held && S.charge > 0) { fire(S.charge); S.charge = 0; }
      if (G.mouse.click && !S.held && !S.charge) fire(0.6);   // a quick tap (no mouse hold, e.g. a bot) = a 60% draw
    } else if (G.mouse.click || (gd.auto && S.held)) fire();
  }
  // face where you aim; arms up holding the gun (one hand for pistols, flares and the spray can)
  pl.yaw = G.camYaw; if (!pl.board) pl.model.grp.rotation.y = pl.yaw;
  const P = pl.model.parts, one = ['pistol', 'golden', 'flare', 'spray'].includes(S.out), up = Math.PI / 2 - S.aimP + S.kickP * 2;
  P.armR.rotation.x = up; P.armR.rotation.z = one ? -0.22 : -0.08;
  P.armL.rotation.x = up + (one ? 0 : 0.12); P.armL.rotation.z = one ? 0.45 : 0.62;
  if (S.out === 'bow') { P.armL.rotation.x = up; P.armL.rotation.z = 0.15; P.armR.rotation.x = up - 0.2 - (S.charge || 0) * 0.5; P.armR.rotation.z = -0.1 - (S.charge || 0) * 0.5; }
  if (S.out === 'spray' && !(S.held || G.mouse.click)) { P.armL.rotation.x = 0.2; P.armL.rotation.z = 0.1; }
  if (P.stick) P.stick.visible = false;
  aimAtPeople(); setHud();
}
function updateRangeBits(dt) {
  for (const T of RANGE.plates) { if (T.fall > 0 && T.piv.rotation.x > -1.5) T.piv.rotation.x -= dt * 9; if (!T.alive && T.reset && G.t > T.reset) { T.alive = true; T.piv.rotation.x = 0; T.reset = 0; } }
  for (const T of RANGE.bottles) if (!T.alive && T.reset && G.t > T.reset) { T.alive = true; T.mesh.visible = true; T.reset = 0; }
  const gg = RANGE.gong; if (gg && gg.swing) { gg.swing = Math.max(0, gg.swing - dt * 0.5); gg.piv.rotation.x = Math.sin(G.t * 6) * 0.25 * gg.swing; }
  for (let i = RANGE.clays.length - 1; i >= 0; i--) { const T = RANGE.clays[i]; if (!T.alive) { RANGE.clays.splice(i, 1); targets.splice(targets.indexOf(T), 1); continue; }
    T.vy -= 6.5 * dt; T.x += T.vx * dt; T.y += T.vy * dt; T.z += T.vz * dt; T.mesh.position.set(T.x, T.y, T.z); T.mesh.rotation.y += dt * 20;
    if (T.y < groundY(T.x, T.z) + 0.05) { T.alive = false; scene.remove(T.mesh); burst(_v.set(T.x, T.y, T.z), 6, '#ed8936', 1, 1); } }
}
// the camera: over the right shoulder (closer + zoomed when aiming), first person on C, a scope on the rifle
export function gunCamera(cam, dt) {
  if (!S.out || player.vehicle || player.transit) { if (S.fovSet) { cam.fov += (65 - cam.fov) * Math.min(1, dt * 8); if (Math.abs(cam.fov - 65) < 0.1) { cam.fov = 65; S.fovSet = false; } cam.updateProjectionMatrix(); } if (viewGrp) viewGrp.visible = false; return; }
  const gd = GUNS[S.out], fp = camModeNow() === 2, scope = gd.scope && S.ads > 0.5;
  const zs_ = gd.zooms || [gd.zoom || 9]; S.zi = clamp(S.zi ?? 1, 0, zs_.length - 1); const zoom = scope ? lerp(65, zs_[S.zi], S.ads) : lerp(65, fp ? 48 : 44, S.ads), zs = zoom / 65;
  const sens = G.settings?.sens ?? 1, inv = G.settings?.invertY ? -1 : 1;
  G.camYaw += G.mouse.dx * 0.0025 * sens * (1 - zs);   // undo part of the turn when zoomed (finer aim)
  S.aimP = clamp(S.aimP + G.mouse.dy * 0.0022 * sens * inv * zs, -1.15, 1.15);
  // recoil kicks the view up, then it settles back
  S.aimP -= S.kickP * dt * 14; G.camYaw += S.kickY * dt * 10; S.kickP = Math.max(0, S.kickP - dt * S.kickP * 14 - dt * 0.01); S.kickY *= Math.max(0, 1 - dt * 10);
  G.camPitch = clamp(S.aimP + 0.25, -0.35, 1.35);
  aimDir(_d); const fx = _d.x, fy = _d.y, fz = _d.z, rx = Math.cos(G.camYaw), rz = -Math.sin(G.camYaw);
  const hx = player.x, hy = player.y + 1.58, hz = player.z;
  if (fp || scope) { cam.position.set(hx + fx * 0.12, hy + 0.06, hz + fz * 0.12); }
  else {
    let dist = lerp(2.4, 1.35, S.ads); const side = lerp(0.95, 0.62, S.ads);
    for (let k = 1; k <= 8; k++) { const f = k / 8, x = hx - fx * dist * f + rx * side * f, z = hz - fz * dist * f + rz * side * f, y = hy + 0.1 - fy * dist * f, b = buildingAt(x, z); if (b && y < b.top && y > (b.base ?? -1e9)) { dist *= Math.max(0.15, (k - 1.5) / 8); break; } }
    cam.position.set(hx - fx * dist + rx * side, hy + 0.2 - fy * dist, hz - fz * dist + rz * side);
    const gy = walkY(cam.position.x, cam.position.z, cam.position.y) + 0.3; if (cam.position.y < gy) cam.position.y = gy;
  }
  cam.lookAt(cam.position.x + fx, cam.position.y + fy, cam.position.z + fz);
  if (Math.abs(cam.fov - zoom) > 0.05) { cam.fov = zoom; cam.updateProjectionMatrix(); S.fovSet = true; }
  // first person: the gun in front of the camera
  if (viewGrp) {
    viewGrp.visible = fp && !scope; if (viewGrp.visible) { cam.updateMatrixWorld(); viewGrp.position.copy(cam.position); viewGrp.quaternion.copy(cam.quaternion); viewGrp.translateX(lerp(0.17, 0.0, S.ads)); viewGrp.translateY(lerp(-0.17, -0.11, S.ads) + S.kickP * 0.4); viewGrp.translateZ(-0.38 + S.kickP * 0.6); viewGrp.rotateX(S.kickP * 2); }
  }
  if (scope) player.model.grp.visible = false; else if (!fp) player.model.grp.visible = true;
}


// ---------- fire, smoke and explosions ----------
// soft round particles with their own alpha (log-depth aware), one additive set for flames, one normal set for smoke
const SPRITE_VS = `attribute float aSize; attribute vec4 aCol; uniform float uScale; varying vec4 vCol;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() { vCol = aCol; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / max(0.5, -mv.z); gl_Position = projectionMatrix * mv;
#include <logdepthbuf_vertex>
}`;
const SPRITE_FS = `varying vec4 vCol;
#include <logdepthbuf_pars_fragment>
void main() {
#include <logdepthbuf_fragment>
  float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard; gl_FragColor = vec4(vCol.rgb, vCol.a * smoothstep(0.5, 0.05, r)); }`;
function puffSet(n, additive) {
  const geo = new THREE.BufferGeometry(), pos = new Float32Array(n * 3).fill(-1e5), col = new Float32Array(n * 4), size = new Float32Array(n);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aCol', new THREE.BufferAttribute(col, 4)); geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({ vertexShader: SPRITE_VS, fragmentShader: SPRITE_FS, uniforms: { uScale: { value: 600 } }, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts);
  return { n, pos, col, size, geo, mat, vel: new Float32Array(n * 3), life: new Float32Array(n), life0: new Float32Array(n), s0: new Float32Array(n), i: 0, additive };
}
const FLAME = puffSet(900, true), SMOKE = puffSet(700, false);
function emit(P, x, y, z, vx, vy, vz, life, size) { const i = P.i++ % P.n; P.pos.set([x, y, z], i * 3); P.vel.set([vx, vy, vz], i * 3); P.life[i] = P.life0[i] = life; P.s0[i] = size; }
function stepPuffs(P, dt, smoke) {
  for (let i = 0; i < P.n; i++) {
    if (P.life[i] <= 0) { P.col[i * 4 + 3] = 0; continue; }
    P.life[i] -= dt; const b = i * 3, age = 1 - P.life[i] / P.life0[i];
    P.vel[b + 1] += (smoke ? 0.6 : 2.5) * dt; P.vel[b] += (smoke ? 1.2 : 0.3) * dt; P.vel[b] *= 1 - dt * (smoke ? 0.3 : 1.2); P.vel[b + 2] *= 1 - dt * (smoke ? 0.3 : 1.2);
    P.pos[b] += P.vel[b] * dt; P.pos[b + 1] += P.vel[b + 1] * dt; P.pos[b + 2] += P.vel[b + 2] * dt;
    const c = i * 4;
    if (smoke) { const g = 0.18 + age * 0.35; P.col[c] = g; P.col[c + 1] = g; P.col[c + 2] = g * 1.02; P.col[c + 3] = (age < 0.1 ? age * 10 : 1) * (1 - age) * 0.55; P.size[i] = P.s0[i] * (1 + age * 3); }
    else { P.col[c] = 1; P.col[c + 1] = 0.85 - age * 0.7; P.col[c + 2] = 0.35 - age * 0.35; P.col[c + 3] = (1 - age) * 0.9; P.size[i] = P.s0[i] * (1 - age * 0.6); }
    if (P.life[i] <= 0) P.pos[b + 1] = -1e5;
  }
  P.geo.attributes.position.needsUpdate = true; P.geo.attributes.aCol.needsUpdate = true; P.geo.attributes.aSize.needsUpdate = true;
  P.mat.uniforms.uScale.value = innerHeight / (2 * Math.tan(camera.fov * Math.PI / 360));
}
const fires = [];   // { x, y, z, end, size, flame, obj (follow), oy }
export function addFire(x, y, z, dur, size = 1, o = {}) { const f = { x, y, z, end: G.t + dur, size, flame: o.flame !== false, obj: o.obj || null, oy: o.oy || 0, ox: o.ox || 0 }; fires.push(f); if (fires.length > 40) fires.shift(); return f; }
function updateFires(dt) {
  for (let i = fires.length - 1; i >= 0; i--) {
    const f = fires[i]; if (G.t > f.end || f.obj?.gone) { fires.splice(i, 1); continue; }
    if (f.obj) { const o = f.obj, g = o.g || o; f.x = (g.position?.x ?? o.x) + f.ox; f.y = (g.position?.y ?? o.y) + f.oy; f.z = (g.position?.z ?? o.z); }
    if (Math.abs(f.x - camera.position.x) + Math.abs(f.z - camera.position.z) > 6000) continue;
    const left = Math.min(1, (f.end - G.t) / 6), wet = 1 - (G.wet || 0) * 0.5;
    if (f.flame) for (let k = 0; k < Math.ceil(f.size * 30 * dt * left * wet + Math.random()); k++) emit(FLAME, f.x + R(-0.5, 0.5) * f.size, f.y + R(0, 0.3), f.z + R(-0.5, 0.5) * f.size, R(-0.4, 0.4), R(1.5, 3.5) * Math.sqrt(f.size), R(-0.4, 0.4), R(0.4, 0.9), R(0.5, 1.1) * f.size);
    if (Math.random() < dt * f.size * (f.flame ? 9 : 6)) emit(SMOKE, f.x + R(-0.4, 0.4) * f.size, f.y + (f.flame ? 1.2 : 0.3) * f.size, f.z + R(-0.4, 0.4) * f.size, R(-0.3, 0.3), R(1.5, 2.8), R(-0.3, 0.3), R(4, 8), R(1.2, 2.2) * f.size);
  }
  stepPuffs(FLAME, dt, false); stepPuffs(SMOKE, dt, true);
  if (fires.some(f => f.flame && Math.hypot(f.x - player.x, f.z - player.z) < 30) && Math.random() < dt * 3) noise(0.5, 0.025, 600);   // crackle
}
// a fuel tank / an aircraft hitting the ground: fireball, debris, a shock that knocks things over, then it burns
export function explode(x, y, z, size = 1, cause = 'explosion') {
  for (let k = 0; k < 60 * size; k++) emit(FLAME, x + R(-1, 1) * size, y + R(0, 1.5) * size, z + R(-1, 1) * size, R(-6, 6) * size, R(2, 9) * size, R(-6, 6) * size, R(0.5, 1.3), R(1.2, 2.6) * size);
  for (let k = 0; k < 25 * size; k++) emit(SMOKE, x + R(-2, 2) * size, y + R(0, 3) * size, z + R(-2, 2) * size, R(-2, 2), R(2, 5), R(-2, 2), R(6, 12), R(2.5, 4.5) * size);
  burst(_v.set(x, y + 1, z), 30, '#3a3a3a', 7 * size, 7 * size);
  const d = Math.hypot(x - camera.position.x, y - camera.position.y, z - camera.position.z);
  setTimeout(() => { noise(2.2, Math.min(0.7, 0.9 * size / (1 + d / 120)), 260); beep([38, 30], 0.7, 'sine', Math.min(0.35, 0.4 * size / (1 + d / 120)), 0.05); }, Math.min(2500, d / 343 * 1000));   // sound arrives at the speed of sound
  if (d < 60) S.kickP += 0.04 * size;
  decal(_v2.set(x, walkY(x, z, y + 1) + 0.03, z), _up2, 2.2 * size, '#141414');
  // the shock wave
  const R2 = 9 * size;
  for (const p of peds) { if (p.state === 'dead' || p.x > 1e5) continue; const dd = Math.hypot(p.x - x, p.z - z); if (dd < R2 && (p.sc || 1) >= 0.8) { if (dd < R2 * 0.35) { p.state = 'dead'; p.timer = 45; crime(2, p.x, p.z); player.karma -= 10; } else { p.state = 'down'; p.timer = 4; p.after = 'flee'; say(p, pick(['WHOA!', 'AAAH!', 'My ears!']), 1500); } } else if (dd < R2 * 4) { p.state = 'flee'; p.timer = 8; } }
  for (const v of vehicles) { const dd = Math.hypot(v.x - x, v.z - z); if (dd < R2 && dd > 0.5 && v !== player.vehicle) try { knock(v, (v.x - x) / dd * 6 * size, (v.z - z) / dd * 6 * size, R(-1, 1), 10); } catch (e) { /* optional */ } }
  { const dd = Math.hypot(player.x - x, player.z - z); if (dd < R2 * 0.8 && !player.vehicle) { player.hurt?.(Math.round(60 * size * (1 - dd / (R2 * 0.8))), cause); player.vy = 6; } }
  for (const a of _fauna.live) if (!a.down && Math.hypot(a.x - x, a.z - z) < R2 * 6) { _fauna.setSt(a, 'flee', 10); a.tx = a.x + (a.x - x) * 3; a.tz = a.z + (a.z - z) * 3; }
  addFire(x, y, z, 45 * size, 1.4 * size);
}

// ---------- aircraft: shoot the cockpit or an engine to bring it down ----------
const AIR_HP = { jet: 450, jumbo: 800, heli: 160, fixed: 150, balloon: 50 };
function airKind(c) { return c.T.kind === 'heli' ? 'heli' : c.T.kind === 'balloon' ? 'balloon' : /jumbo|747|wide/i.test(c.type) ? 'jumbo' : /jet|yvr|high|air/i.test(c.type) && !/cessna|beaver|otter|float|bi/i.test(c.type) ? 'jet' : 'fixed'; }
function airR(c) { if (c.br === undefined) { const sc = c.g.scale.x || 1; c.g.scale.setScalar(1); const b = new THREE.Box3().setFromObject(c.g), s = b.getSize(new THREE.Vector3()); c.br = Math.max(4, Math.max(s.x, s.z) / 2); c.g.scale.setScalar(sc); } return c.br * (c.g.scale.x || 1); }
function hitAircraft(h, d, id, dmg) {
  const c = h.obj, K = airKind(c), Rr = airR(c), pos = c.g.position, fx = -Math.sin(c.hd || 0), fz = -Math.cos(c.hd || 0);
  const along = ((h.p.x - pos.x) * fx + (h.p.z - pos.z) * fz) / Rr, low = h.p.y < pos.y;
  const zone = K === 'balloon' ? (h.p.y < pos.y - Rr * 0.3 ? 'basket' : 'envelope') : along > 0.45 ? 'cockpit' : K === 'heli' ? (Math.abs(along) < 0.3 ? 'engine' : along < -0.5 ? 'tail rotor' : 'body') : (Math.abs(along) < 0.25 && low ? 'engine' : along < -0.55 ? 'tail' : 'wing');
  const mult = { cockpit: 3, engine: 2, 'tail rotor': 2.5, basket: 2, envelope: 1, body: 1, tail: 0.8, wing: 0.6 }[zone];
  c.ahp = (c.ahp ?? AIR_HP[K]) - dmg * mult; burst(h.p, 8, '#ffe08a', 3, 2); SND.metal();
  if (!c.shotHit) { c.shotHit = true; crime(1, pos.x, pos.z); }
  if (zone === 'cockpit' && dmg >= 100 && K !== 'jumbo') c.ahp = Math.min(c.ahp, 0);   // the pilot is hit
  const max = AIR_HP[K];
  if (c.ahp < max * 0.6 && !c.smk && K !== 'balloon') { c.smk = addFire(0, 0, 0, 600, K === 'jumbo' || K === 'jet' ? 2.2 : 1.1, { flame: false, obj: c.g }); }
  if (c.ahp < max * 0.25 && !c.fireOn && K !== 'balloon') { c.fireOn = addFire(0, 0, 0, 600, K === 'jumbo' || K === 'jet' ? 1.8 : 0.9, { obj: c.g }); }
  if (G.t - (S.airToast || -99) > 3) { S.airToast = G.t; ui.toast('✈️ Hit: ' + zone, c.ahp <= 0 ? 'It\'s going down!' : K === 'balloon' ? 'Hissss… the envelope is leaking.' : `Damage ${Math.round(100 - Math.max(0, c.ahp) / max * 100)}%. Cockpit and engines are the weak spots.`, 1800); }
  if (c.ahp <= 0 && !c.shot) shootDown(c, K, zone);
}
function shootDown(c, K, zone) {
  c.shot = true; c.fallK = K; const sp = Math.max(K === 'heli' ? 8 : 25, c.v || 30), fx = -Math.sin(c.hd || 0), fz = -Math.cos(c.hd || 0);
  c.fv = new THREE.Vector3(fx * sp, K === 'balloon' ? -1 : -2, fz * sp); c.spinR = R(0.6, 1.6) * (Math.random() < 0.5 ? -1 : 1);
  if (!c.fireOn && K !== 'balloon') c.fireOn = addFire(0, 0, 0, 600, K === 'jumbo' || K === 'jet' ? 1.8 : 0.9, { obj: c.g });
  ui.toast(K === 'balloon' ? '🎈 The balloon is coming down!' : '🔥 MAYDAY! MAYDAY!', K === 'balloon' ? 'Slowly, thankfully. The pilot is very, very cross.' : zone === 'cockpit' ? 'You hit the cockpit. It\'s spiralling down…' : 'Smoke pours from the ' + zone + '. It\'s going down…', 4000);
  if (K !== 'balloon') { player.karma -= 50; crime(3, c.g.position.x, c.g.position.z); } else { player.karma -= 10; crime(1, c.g.position.x, c.g.position.z); }
}
// called by airtraffic.js stepCraft for a shot-down aircraft
function fallStep(c, dt) {
  const g = c.g, p = g.position, K = c.fallK;
  c.fv.y -= 9.8 * dt * (K === 'balloon' ? 0.05 : K === 'heli' ? 0.9 : 0.55); if (K === 'balloon') c.fv.y = Math.max(c.fv.y, -2.2);
  c.fv.x *= 1 - dt * 0.05; c.fv.z *= 1 - dt * 0.05;
  p.addScaledVector(c.fv, dt);
  if (K === 'heli') g.rotateY(c.spinR * 4 * dt); else if (K !== 'balloon') { g.rotateZ(c.spinR * dt); g.rotateX(-0.25 * dt); }
  if (c.spin) c.spin.rotation.y += 20 * dt;
  const gy = isWater(p.x, p.z) ? waterLevel(p.x, p.z) : groundY(p.x, p.z), b = buildingAt(p.x, p.z), floor = Math.max(gy, b && p.y > (b.base ?? 0) ? b.top : gy);
  if (p.y <= floor + 1) {
    if (K === 'balloon') { c.fv.set(0, 0, 0); if (!c.landedT) { c.landedT = G.t; ui.toast('🎈 Touchdown', 'The balloon flops onto the ground. Everyone climbs out, shaken but fine.', 3000); } if (G.t - c.landedT > 25) { c.remove = true; c.shot = false; c.ahp = undefined; c.shotHit = false; c.landedT = 0; } return; }
    const water = isWater(p.x, p.z);
    if (water) { burst(_v.set(p.x, gy, p.z), 80, '#e8f4f8', 6, 12); SND.splash(); addFire(p.x, gy, p.z, 40, 1.5, { flame: false }); }
    else explode(p.x, floor, p.z, K === 'jumbo' ? 3 : K === 'jet' ? 2.2 : 1.3, 'plane crash');
    ui.toast('💥 It crashed', water ? 'It hit the water. Rescue boats are racing out.' : 'A fireball, then black smoke rising over the city. Every siren in town is heading here.', 4500); discover('mayday');
    g.visible = false; c.remove = true; if (c.smk) c.smk.end = 0; if (c.fireOn) c.fireOn.end = 0;
    c.shot = false; c.ahp = undefined; c.smk = c.fireOn = null; c.shotHit = false; c.landedT = 0;   // airtraffic.js pools and reuses aircraft
  }
}
airHooks.shot = fallStep;

// ---------- gun counters at the real gun shops (outside their front door) ----------
function buildShops() {
  for (const sh of SHOPS) {
    const [px, pz] = toXZ(...sh.at); let best = null;
    for (let r = 0; r <= 40 && !best; r += 2) for (let a = 0; a < 6.28; a += r ? 2 / r : 7) { const x = px + Math.cos(a) * r, z = pz + Math.sin(a) * r; if (!isWater(x, z) && !buildingAt(x, z) && !inRoadway(x, z, 0.6)) { best = [x, z]; break; } }
    if (!best) continue; const [x, z] = best, y = walkY(x, z, groundY(x, z) + 0.5); sh.x = x; sh.z = z;
    const nr = nearestRoad(x, z, 40, r => r.t <= 6); let yaw = 0;
    if (nr) { const e = nr.e, M = window.MAP; void M; const bx = px - x, bz = pz - z; yaw = Math.atan2(bx, bz) + Math.PI; }
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = yaw; scene.add(g); sh.g = g;
    addMesh(new THREE.BoxGeometry(2.4, 1.05, 0.7), std('#3a2a1a'), 0, 0.52, 0, g); addMesh(new THREE.BoxGeometry(2.5, 0.06, 0.8), std('#a0aec0', { metalness: 0.5 }), 0, 1.08, 0, g);
    for (const dx of [-1.15, 1.15]) addMesh(new THREE.BoxGeometry(0.08, 2.6, 0.08), MET, dx, 1.3, -0.3, g);
    const tex = canvasTex(512, 128, (c, w, h) => { c.fillStyle = '#1a202c'; c.fillRect(0, 0, w, h); c.strokeStyle = '#ecc94b'; c.lineWidth = 6; c.strokeRect(4, 4, w - 8, h - 8); c.fillStyle = '#ecc94b'; c.font = 'bold 40px Segoe UI, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('🎯 ' + sh.name, w / 2, 46, w - 30); c.fillStyle = '#fff'; c.font = '26px Segoe UI, Arial'; c.fillText('GUNS · AMMO · LICENCES', w / 2, 94); }, false);
    const sg = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.62), new THREE.MeshStandardMaterial({ map: tex, emissive: '#444', emissiveMap: tex, side: THREE.DoubleSide })); sg.position.set(0, 2.45, -0.3); g.add(sg);
    // a few long guns on a rack behind the counter + a stuffed moose head (surprise)
    for (let i = 0; i < 3; i++) { const m = gunModel(['rifle', 'shotgun', 'magnum'][i]); m.rotation.set(0, 0, Math.PI / 2); m.position.set(-0.6 + i * 0.6, 1.45, -0.32); m.scale.setScalar(0.9); g.add(m); }
    const clerk = makeHuman({ skin: pick(['#e0ac7e', '#c68c5e', '#f1c9a5']), hair: '#6b6b6b', shirt: pick(['#4a5a2a', '#7a2a2a', '#2a4a6a']), pants: '#2d3748', hat: pick(['#c53030', '#2f855a', null]), beard: '#7a7a7a' }); scene.remove(clerk.grp); g.add(clerk.grp); clerk.grp.position.set(0, 0, -0.75); clerk.st.kind = 'idle'; clerk.pose(0); sh.clerk = clerk;
  }
}
function updateShopSigns() { for (const sh of SHOPS) if (sh.g) sh.g.visible = Math.hypot(player.x - sh.x, player.z - sh.z) < 700; }

// ---------- prompts (E) + markers ----------
export function gunPrompt(pl) {
  player = pl; if (pl.vehicle || pl.transit || G.dialogOpen) return '';
  const dp = downedPrompt(); if (dp) return dp;
  for (const f of FINDS) if (f.g?.visible && Math.hypot(pl.x - f.x, pl.z - f.z) < 3.5) { if (tapped('KeyE')) takeFind(f); return `<kbd>E</kbd> ${f.gun ? GUNS[f.gun].icon + ' Pick it up' : '📦 Open the crate'}`; }
  for (const sh of SHOPS) if (sh.x !== undefined && Math.hypot(pl.x - sh.x, pl.z - sh.z) < 3.5) { if (tapped('KeyE')) openShop(sh); return '<kbd>E</kbd> 🎯 Gun counter: ' + sh.name; }
  if (!RANGE.built) return '';
  if (Math.hypot(pl.x - RANGE.shop.x, pl.z - RANGE.shop.z) < 4.5) { if (tapped('KeyE')) openShop(); return '<kbd>E</kbd> 🦌 Shop at Cabbagela\'s Outdoors'; }
  if (Math.hypot(pl.x - RANGE.desk.x, pl.z - RANGE.desk.z) < 3.5) { if (tapped('KeyE')) { if (activeMission()) ui.toast('Finish your mission first', '', 1500); else openDesk(); } return '<kbd>E</kbd> 🎯 Range desk (challenges, rent a pistol)'; }
  return '';
}
export function gunMarkers() { return [...(RANGE.built ? [{ x: RANGE.shop.x, z: RANGE.shop.z, icon: '🎯' }] : []), ...SHOPS.filter(s => s.x !== undefined).map(s => ({ x: s.x, z: s.z, icon: '🎯' }))]; }
export function initGuns(pl) { player = pl; makeHud(); initPolice(pl, () => { const id = S.out; if (!id || GUNS[id].golden) return null; A().guns = A().guns.filter(g => g !== id); holster(); return GUNS[id].name; }); try { buildShops(); } catch (e) { console.warn('guns: shops', e); } try { buildRange(); } catch (e) { console.warn('guns: range', e); } try { buildFinds(); } catch (e) { console.warn('guns: finds', e); } }
export function gunsLoad() { const src = OWN.arms; OWN.arms = Object.assign(freshArms(), src || {}); OWN.arms.guns = OWN.arms.guns.filter(g => GUNS[g] && !GUNS[g].rental); S.mag = {}; holster(); }   // after shopLoad (the rental pistol never leaves the range)
export const _guns = { S, GUNS, SHOPS, WANTED, RANGE, targets, FINDS, LEGAL, A, give, draw, holster, fire, cycle, impact, startCh, castSeg, peopleHit, legalWhy, down, openShop, openDesk, aim: (yaw, p) => { G.camYaw = yaw; S.aimP = p; }, aimAt(x, y, z) { const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z; G.camYaw = Math.atan2(-(x - cx), -(z - cz)); S.aimP = -Math.atan2(y - cy, Math.hypot(x - cx, z - cz)); } };
