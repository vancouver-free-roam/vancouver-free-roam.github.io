// Public art + historic markers from OpenStreetMap, built so you can SEE them (no button needed):
//  - ~90 well-known pieces get a researched look-alike (artfamous.js: Engagement, Gate to the Northwest Passage, the Crab,
//    Bill Reid's orca, the Brockton Point poles, Terry Fox, Harry Jerome, The Birds, Human Structures, the Poodle…)
//  - every other piece is built from its REAL OSM tags (src/artdata.js: artist, material, height, description):
//    statues are jointed human figures in a pose that fits the name (runners run, chiefs welcome, mothers hold children),
//    busts, totem poles with carved crest figures, welcome figures, spindle whorls, animals and birds named in the title
//    (bear, eagle, orca, heron, salmon, horse…), everyday things (canoe, chair, globe, anchor, bell, fruit…), memorials
//    (obelisks, cairns, steles, ghost bikes, plaques), fountains, murals. Only pieces with no subject at all become an
//    abstract — and then in their real material (polished steel ribbons, rusty steel plates, carved stone, bronze forms)
//  - a name plaque on a post in front of every named piece, everything turned to face the nearest street or path
// Pieces that already have a hand-built landmark (The Drop, Digital Orca, Inukshuk, A-maze-ing Laughter…) and historic
// "markers" that are really whole buildings (houses, theatres, stations) are left alone.
import * as THREE from 'three';
import { hash2, inPoly, canvasTex, pick } from './core.js';
import { surfaceY, nearBuildings, nearestRoad, NX, NZ } from './city.js';
import { isWater, treeChunks } from './terrain.js';
import { _colliderGrids } from './colliders.js';
import { Kit, MATS, C, U, person, bust as bustFig, beast, bird, orca, pole, welcomeFigure } from './artkit.js';
import { FAMOUS, plinth } from './artfamous.js';
import { ART_DATA } from './artdata.js';

const M = window.MAP;
// ---------- the real OSM tags, matched by position ----------
const DGRID = new Map();
for (const d of ART_DATA) { const key = Math.round(d[0] / 8) + ',' + Math.round(d[1] / 8); let L = DGRID.get(key); if (!L) DGRID.set(key, L = []); L.push(d); }
export function artData(a) {
  let best = null, bd = 5; const gx = Math.round(a.x / 8), gz = Math.round(a.z / 8), name = a.n >= 0 ? M.names[a.n] : '';
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const d of DGRID.get((gx + i) + ',' + (gz + j)) || []) { const dd = Math.hypot(d[0] - a.x, d[1] - a.z) - (name && d[2] === name ? 2 : 0); if (dd < bd) { bd = dd; best = d; } }
  return best;   // [x, z, name, artist, material, height, description]
}

// ---------- old merge kit (memorials, fountains) ----------
function part(geo, c, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) { return { geo, c, x, y, z, rx, ry, rz, sx, sy, sz }; }
const box = (w, h, d, c, x, y, z, rx, ry, rz) => part(new THREE.BoxGeometry(w, h, d), c, x, y, z, rx, ry, rz);
const cyl = (r1, r2, h, c, x, y, z, rx, ry, rz, seg = 12) => part(new THREE.CylinderGeometry(r1, r2, h, seg), c, x, y, z, rx, ry, rz);
const sph = (r, c, x, y, z, sx = 1, sy = 1, sz = 1, seg = 14) => part(new THREE.SphereGeometry(r, seg, Math.max(6, seg * 0.7 | 0)), c, x, y, z, 0, 0, 0, sx, sy, sz);
function merge(parts) {
  const pos = [], nor = [], col = [], c = new THREE.Color(), m = new THREE.Matrix4(), e = new THREE.Euler(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
  for (const p of parts) {
    let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    e.set(p.rx || 0, p.ry || 0, p.rz || 0); q.setFromEuler(e); v.set(p.x, p.y, p.z); s.set(p.sx || 1, p.sy || 1, p.sz || 1); m.compose(v, q, s); g.applyMatrix4(m);
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array); c.set(p.c);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(c.r, c.g, c.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}
const { BRONZE, VERD, STEEL, STONE, GRANITE, CEDAR, BLACK } = C;
const mesh = (parts, mat = 'stone') => { const m = new THREE.Mesh(merge(parts), MATS[mat]); m.castShadow = true; m.receiveShadow = true; return m; };
const group = (...ms) => { const g = new THREE.Group(); for (const m of ms) if (m) g.add(m); return g; };

// historic markers that are really whole buildings / boats already in the city (don't add anything)
const SKIP = /^h_(house|theatre|train_station|ruins|village|fort|yes|wreck|object|artifact|tomb|vehicle|no|turntable)$/;
const ON_AIRPORT = /Jade Canoe/i;   // airport.js builds the Spirit of Haida Gwaii

// ---------- materials from the real tags ----------
function matOf(material, seed) {
  const s = String(material || '').toLowerCase();
  if (/corten|weathering|rust/.test(s)) return { m: 'corten', c: C.CORTEN, k: 'corten' };
  if (/stainless|alumin|chrome|mirror|metal|steel/.test(s)) return /powder|paint/.test(s) ? { m: 'paint', c: pick(['#c4302a', '#1d4ed8', '#f4c430', '#16a34a']), k: 'painted' } : { m: 'steel', c: STEEL, k: 'steel' };
  if (/bronze|copper|brass/.test(s)) return { m: 'bronze', c: hash2(seed, 4) < 0.6 ? BRONZE : VERD, k: 'bronze' };
  if (/marble|limestone/.test(s)) return { m: 'stone', c: C.MARBLE, k: 'stone' };
  if (/granite|stone|slate|basalt|rock/.test(s)) return { m: 'stone', c: hash2(seed, 6) < 0.5 ? '#77726b' : '#9a958c', k: 'stone' };
  if (/concrete|cement/.test(s)) return { m: 'stone', c: C.CONCRETE, k: 'concrete' };
  if (/wood|cedar|timber/.test(s)) return { m: 'wood', c: CEDAR, k: 'wood' };
  if (/glass|plexi|polycarb|acrylic/.test(s)) return { m: 'glass', c: '#9fd4e8', k: 'glass' };
  if (/neon|led|light/.test(s)) return { m: 'glow', c: '#ffd36a', k: 'light' };
  if (/fibre|fiber|resin|foam|paint|plastic/.test(s)) return { m: 'paint', c: pick(['#d62828', '#f4c430', '#1d4ed8', '#16a34a', '#f97316', '#7c3aed']), k: 'painted' };
  return null;
}

// ---------- generic statue: a jointed figure in a pose that fits the name ----------
const FEMALE = /\b(queen|lady|mrs|miss|woman|women|girl|mother|madonna|goddess|nurse|emily|pauline|helen|rose|mary|victoria|evangeline|she|her|maiden|ballerina|bride|sister|grandmother|daughter|wife|caryatid)\b/i;
function statue(k, name, mt, seed, desc) {
  const n = (name + ' ' + (desc || '')).toLowerCase(), c = mt?.c || (hash2(seed, 2) < 0.6 ? BRONZE : VERD), m = mt?.m || 'bronze';
  let pose = ['stand', 'stride', 'oneHandFront', 'point', 'stand', 'walk'][Math.floor(hash2(seed, 5) * 6)], extra = {};
  if (/run|sprint|athlete|marathon|race/.test(n)) pose = 'run';
  else if (/danc|joy|freedom|celebrat|victory|triumph/.test(n)) pose = 'armsUp';
  else if (/welcom|greet|chief|host/.test(n)) pose = 'welcome';
  else if (/think|reader|reading|poet|writer|scholar|philosoph/.test(n)) pose = 'think';
  else if (/sit|seated|rest|waiting|bench/.test(n)) pose = 'sit';
  else if (/reclin|lying|sleep|dream/.test(n)) pose = 'sitGround';
  else if (/explor|captain|discover|navigat|vancouver|cook/.test(n)) pose = 'point';
  else if (/swim|diver/.test(n)) pose = 'armsUp';
  const female = FEMALE.test(n) || (!/\b(mr|sir|king|man|men|boy|father|chief|captain|lord|saint john|john|george|robert|david|harry|terry|joe|jack|simon|samuel)\b/i.test(n) && hash2(seed, 9) < 0.3);
  const plH = pose === 'sit' || pose === 'think' ? 0.6 : 0.8 + hash2(seed, 3) * 1.2;
  const y = plinth(k, 1.4, plH, hash2(seed, 7) < 0.5 ? '#8e8a83' : '#5e5b57');
  if (pose === 'sit' || pose === 'think') k.box(k.root, 1.0, 0.5, 0.6, c, m, 0, y + 0.25, -0.05);
  const hat = /soldier|veteran|firefight|miner|worker|logger|sailor|fisher/.test(n) ? (/firefight|miner|worker|logger/.test(n) ? 'helmet' : 'cap') : /king|queen/.test(n) ? 'crown' : (!female && hash2(seed, 13) < 0.2 ? pick(['top', 'bowler']) : undefined);
  const f = person(k, k.root, { y, h: 1.95 + hash2(seed, 11) * 0.45, c, m, pose, dress: female, coat: !female && hash2(seed, 15) < 0.55, suit: !female, hairStyle: female ? pick(['long', 'bun', 'short']) : hash2(seed, 17) < 0.2 ? 'bald' : 'short', beard: !female && hash2(seed, 19) < 0.3, hat, ...extra });
  if (/mother|family|child|parent/.test(n)) person(k, k.root, { x: 0.55, y, z: 0.15, h: 1.1, c, m, pose: 'stand', poseX: { armLz: 0.9 } });
  if (/angel|nike|winged/.test(n)) for (const s of [-1, 1]) k.shape(f.torso, [[0, 0], [0.8, 0.5], [1.3, 1.7], [1.0, 2.3], [0.5, 1.3]], 0.06, c, m, s * 0.13, 0.25, -0.15, 0, s < 0 ? Math.PI : 0, 0, 1);
  if (/dog|walker/.test(n)) beast(k, k.root, { kind: 'dog', s: 1.0, c, m, x: 0.8, y, z: 0.3 });
  return 1.3;
}

// ---------- things named in the title ----------
const SUBJECTS = [
  [/\bbears?\b|grizzl/i, (k, mt) => { k.box(k.root, 2.4, 0.4, 1.4, GRANITE, 'stone', 0, 0.2, 0); beast(k, k.root, { kind: /grizzl/i.test(k._name) ? 'grizzly' : 'bear', y: 0.4, c: mt?.c || '#3a2c20', m: mt?.m || 'bronze', pose: hash2(k._seed, 1) < 0.5 ? 'stand' : 'walk' }); return 1.6; }],
  [/eagle|thunderbird/i, (k, mt) => { k.cyl(k.root, 0.25, 0.35, 2.5, mt?.m === 'wood' ? CEDAR : GRANITE, mt?.m === 'wood' ? 'wood' : 'stone', 0, 1.25, 0); bird(k, k.root, { kind: 'eagle', s: 5, y: 2.5, c: mt?.c || '#3a2c20', m: mt?.m || 'bronze', pose: 'upswept', headC: mt ? undefined : '#e8e2d2' }); return 1.6; }],
  [/raven|crow|corvid/i, (k, mt) => { k.box(k.root, 1, 1, 1, GRANITE, 'stone', 0, 0.5, 0); bird(k, k.root, { kind: 'raven', s: 6, y: 1, c: mt?.m === 'steel' ? '#3a3d40' : '#141516', m: mt?.m || 'paint', pose: hash2(k._seed, 2) < 0.5 ? 'perch' : 'upswept' }); return 1.2; }],
  [/heron|crane\b/i, (k, mt) => { bird(k, k.root, { kind: 'heron', s: 4, c: mt?.c || '#8a9aa6', m: mt?.m || 'steel' }); return 1.2; }],
  [/\bowl/i, (k, mt) => { k.cyl(k.root, 0.3, 0.35, 1.5, GRANITE, 'stone', 0, 0.75, 0); bird(k, k.root, { kind: 'owl', s: 4, y: 1.5, c: mt?.c || '#6a5238', m: mt?.m || 'bronze' }); return 0.8; }],
  [/hummingbird|sparrow|\bbirds?\b|gull|duck|goose|swallow|robin|wren|kingfisher|loon|osprey/i, (k, mt) => { k.cyl(k.root, 0.12, 0.15, 3, '#555', 'steel', 0, 1.5, 0); bird(k, k.root, { kind: /gull/i.test(k._name) ? 'gull' : 'sparrow', s: 5, y: 3, c: mt?.c || '#8a6a4a', m: mt?.m || 'paint', pose: 'fly' }); return 0.8; }],
  [/orca|killer whale|\bwhales?\b|humpback/i, (k, mt) => { orca(k, k.root, { s: 0.6, y: 1.6, rx: -0.6, c: mt?.c && mt.m !== 'steel' ? mt.c : '#1b1c1e', m: mt?.m || 'paint' }); k.box(k.root, 2.4, 0.4, 2.4, C.CONCRETE, 'stone', 0, 0.2, 0); return 2; }],
  [/salmon|\bfish|trout|sturgeon/i, (k, mt) => { const c = mt?.c || '#b8bfc6', m = mt?.m || 'steel'; for (let i = 0; i < 3; i++) { const y = 1.4 + i * 0.9, x = (i - 1) * 0.9; k.cyl(k.root, 0.04, 0.05, y, '#555', 'steel', x, y / 2, 0); const n = k.node(k.root, x, y + 0.2, 0, 0, 0, -0.3 + i * 0.3); k.lathe(n, [[0.01, -0.8], [0.22, -0.4], [0.3, 0.1], [0.18, 0.6], [0.02, 0.8]], i === 1 ? '#c0392b' : c, m, 0, 0, 0, 0, 0, Math.PI / 2, 1, 1, 0.45, 10); k.add(n, U.cone(4), c, m, -0.95, 0, 0, 0, 0, Math.PI / 2, 0.3, 0.3, 0.05); } return 1.6; }],
  [/horse|pony|mare|stallion/i, (k, mt) => { beast(k, k.root, { kind: 'horse', c: mt?.c || BRONZE, m: mt?.m || 'bronze', pose: hash2(k._seed, 3) < 0.5 ? 'stand' : 'walk' }); return 1.6; }],
  [/\bcows?\b|\bbull\b|\box\b|cattle/i, (k, mt) => { beast(k, k.root, { kind: /bull|ox/i.test(k._name) ? 'bull' : 'cow', c: mt?.c || BRONZE, m: mt?.m || 'bronze' }); return 1.6; }],
  [/deer|\belk\b|moose|stag/i, (k, mt) => { beast(k, k.root, { kind: 'deer', s: /elk|moose/i.test(k._name) ? 1.5 : 1.1, c: mt?.c || BRONZE, m: mt?.m || 'bronze', headUp: 1.0 }); return 1.3; }],
  [/\bdogs?\b|puppy|poodle/i, (k, mt) => { k.box(k.root, 1.2, 0.5, 0.8, GRANITE, 'stone', 0, 0.25, 0); beast(k, k.root, { kind: /poodle/i.test(k._name) ? 'poodle' : 'dog', s: 1.6, y: 0.5, c: mt?.c || BRONZE, m: mt?.m || 'bronze', pose: 'sit' }); return 1; }],
  [/coyote|\bwolf|wolves|fox/i, (k, mt) => { beast(k, k.root, { kind: 'coyote', s: 1.4, c: mt?.c || BRONZE, m: mt?.m || 'bronze', pose: hash2(k._seed, 3) < 0.5 ? 'sit' : 'walk' }); return 1.2; }],
  [/\bgoat|sheep|ram\b/i, (k, mt) => { beast(k, k.root, { kind: 'goat', s: 1.3, c: mt?.c || '#e8e4da', m: mt?.m || 'paint' }); return 1.2; }],
  [/\bcrab/i, (k, mt) => { const c = mt?.c || '#c0392b', m = mt?.m || 'paint'; k.sph(k.root, 1, c, m, 0, 0.6, 0, 1.2, 0.4, 0.9); for (const s of [-1, 1]) { for (let i = 0; i < 3; i++) k.tube(k.root, [[s * 0.9, 0.55, -0.4 + i * 0.4], [s * 1.7, 0.8, -0.5 + i * 0.5], [s * 2.1, 0, -0.6 + i * 0.6]], 0.07, c, m, 8, 5); k.sph(k.root, 0.35, c, m, s * 1.1, 0.8, 1.2, 0.8, 0.6, 1.3); } return 1.8; }],
  [/canoe|kayak|\bboat|vessel/i, (k, mt) => { const c = mt?.c || '#8a5a3a', m = mt?.m || 'wood'; k.lathe(k.root, [[0.02, -3], [0.45, -2.4], [0.6, 0], [0.45, 2.4], [0.02, 3]], c, m, 0, 0.9, 0, Math.PI / 2, 0, 0, 1, 1, 0.55, 12); for (const s of [-1, 1]) { k.cone(k.root, 0.15, 0.9, c, m, 0, 1.3, s * 3.0, s * 0.4, 0, 0, 6); k.box(k.root, 0.4, 0.6, 0.4, GRANITE, 'stone', 0, 0.3, s * 1.6); } return 2.6; }],
  [/globe|\bworld\b|planet|earth/i, (k, mt) => { k.cyl(k.root, 0.3, 0.6, 1.2, GRANITE, 'stone', 0, 0.6, 0); k.sph(k.root, 1.3, '#2b6cb0', 'paint', 0, 2.5, 0, 1, 1, 1, 20); for (let i = 0; i < 5; i++) k.add(k.root, U.sph(8), '#4a9a4a', 'paint', Math.cos(i * 1.3) * 0.9, 2.5 + Math.sin(i * 2.1) * 0.6, Math.sin(i * 1.3) * 0.9, 0, i, 0, 0.55, 0.45, 0.5); k.tor(k.root, 1.45, 0.05, mt?.c || '#c9a24a', 'gold', 0, 2.5, 0, 0, 0, 0.4); return 1.5; }],
  [/\bsun\b|sunrise|solar/i, (k) => { k.cyl(k.root, 0.12, 0.15, 2.0, '#555', 'steel', 0, 1.0, 0); const n = k.node(k.root, 0, 3, 0, Math.PI / 2, 0, 0); k.cyl(n, 1, 1, 0.2, '#e0a020', 'gold', 0, 0, 0, 0, 0, 0, 24); for (let i = 0; i < 12; i++) { const o = k.add(n, U.cone(4), '#c06a20', 'paint', Math.cos(i * 0.52) * 1.35, 0, Math.sin(i * 0.52) * 1.35, 0, 0, 0, 0.18, 0.1, 0.5); o.rotation.set(Math.PI / 2, 0, -i * 0.52 + Math.PI / 2); } return 1.4; }],
  [/\btrees?\b|forest|cedar|grove|branch/i, (k, mt) => { const c = mt?.c || '#7a5a3a', m = mt?.m || 'bronze'; k.lathe(k.root, [[0.6, 0], [0.4, 0.8], [0.3, 4]], c, m, 0, 0, 0, 0, 0, 0, 1, 1, 1, 10); for (let i = 0; i < 6; i++) { const a = i * 1.1, y = 2.6 + i * 0.35; k.tube(k.root, [[0, y, 0], [Math.cos(a) * 1.2, y + 0.8, Math.sin(a) * 1.2], [Math.cos(a) * 1.9, y + 1.8, Math.sin(a) * 1.9]], 0.09 - i * 0.008, c, m, 8, 5); } return 1.2; }],
  [/\bchairs?\b|throne|\bseat\b/i, (k, mt) => { const c = mt?.c || '#c84a2a', m = mt?.m || 'paint', n = k.node(k.root, 0, 0, 0, 0, 0, 0, 2.4); k.box(n, 1, 0.08, 0.9, c, m, 0, 0.45, 0); k.box(n, 1, 1.0, 0.08, c, m, 0, 0.95, -0.45); for (const s of [-1, 1]) for (const t of [-1, 1]) k.box(n, 0.08, 0.45, 0.08, c, m, s * 0.45, 0.22, t * 0.4); return 1.4; }],
  [/apple|orange|avocado|pear|fruit|cherr|berr/i, (k, mt) => { const c = /orange/i.test(k._name) ? '#f07818' : /avocado|pear/i.test(k._name) ? '#5a7a2a' : '#b01e22'; k.sph(k.root, 1.2, c, mt?.m === 'stone' ? 'stone' : 'paint', 0, 1.15, 0, 1, /avocado|pear/i.test(k._name) ? 1.4 : 0.92, 1, 18); k.cyl(k.root, 0.05, 0.07, 0.5, '#5a3a20', 'paint', 0, 2.4, 0, 0.2); k.add(k.root, U.sph(8), '#3a7a2a', 'paint', 0.25, 2.5, 0, 0, 0, 0.5, 0.3, 0.05, 0.15); return 1.3; }],
  [/anchor/i, (k, mt) => { const c = mt?.c || '#2a2c2e', m = mt?.m === 'stone' ? 'stone' : 'paint'; k.box(k.root, 0.25, 3.2, 0.25, c, m, 0, 1.6, 0); k.tor(k.root, 1.1, 0.12, c, m, 0, 1.2, 0, 0, 0, Math.PI, Math.PI); k.box(k.root, 1.6, 0.2, 0.2, c, m, 0, 2.8, 0); k.tor(k.root, 0.3, 0.07, c, m, 0, 3.4, 0); for (const s of [-1, 1]) k.cone(k.root, 0.2, 0.5, c, m, s * 1.1, 1.3, 0, 0, 0, s * 0.4, 4); return 1.2; }],
  [/\bbell\b/i, (k) => { k.box(k.root, 0.3, 3.2, 0.3, CEDAR, 'wood', -1.2, 1.6, 0); k.box(k.root, 0.3, 3.2, 0.3, CEDAR, 'wood', 1.2, 1.6, 0); k.box(k.root, 2.8, 0.35, 0.5, CEDAR, 'wood', 0, 3.3, 0); k.lathe(k.root, [[0.75, 0], [0.62, 0.15], [0.45, 0.6], [0.4, 1.0], [0.2, 1.2], [0.05, 1.22]], BRONZE, 'bronze', 0, 1.9, 0); return 1.4; }],
  [/sundial|clock/i, (k) => { k.cyl(k.root, 0.35, 0.5, 1.0, GRANITE, 'stone', 0, 0.5, 0, 0, 0, 0, 12); k.cyl(k.root, 0.7, 0.7, 0.06, BRONZE, 'bronze', 0, 1.03, 0, 0, 0, 0, 24); k.shape(k.root, [[0, 0], [0.55, 0], [0, 0.5]], 0.03, BRONZE, 'bronze', 0, 1.06, -0.25, 0, Math.PI / 2, 0); return 0.8; }],
  [/flower|lily|\brose\b|blossom|tulip|bloom|poppy/i, (k, mt) => { const c = mt?.c && mt.m !== 'steel' ? mt.c : '#d6336c', m = mt?.m || 'paint'; for (let i = 0; i < 3; i++) { const x = (i - 1) * 1.0, h = 2.6 + i % 2 * 0.8; k.cyl(k.root, 0.05, 0.07, h, '#3a7a2a', 'paint', x, h / 2, 0); for (let p = 0; p < 6; p++) { const o = k.add(k.root, U.sph(8), c, m, x + Math.cos(p) * 0.35, h, Math.sin(p) * 0.35, 0, -p, 0.5, 0.42, 0.06, 0.2); } k.sph(k.root, 0.15, '#f4c430', 'paint', x, h + 0.05, 0); } return 1.6; }],
  [/\bwheels?\b|\bgear|cog|tire|tyre/i, (k, mt) => { const c = mt?.c || '#555a5e', m = mt?.m || 'steel', n = k.node(k.root, 0, 2.3, 0); k.tor(n, 1.8, 0.2, c, m); for (let i = 0; i < 6; i++) k.box(n, 0.15, 3.4, 0.15, c, m, 0, 0, 0, 0, 0, i * 0.52); for (let i = 0; i < 16; i++) k.box(n, 0.3, 0.4, 0.3, c, m, Math.cos(i * 0.39) * 2.05, Math.sin(i * 0.39) * 2.05, 0, 0, 0, i * 0.39); k.box(k.root, 2, 0.4, 0.8, C.CONCRETE, 'stone', 0, 0.2, 0); return 1.4; }],
  [/inuksuk|inukshuk/i, (k) => { for (const [w, h, d, x, y] of [[0.9, 1.2, 0.7, -0.6, 0.6], [0.9, 1.2, 0.7, 0.6, 0.6], [2.4, 0.6, 0.8, 0, 1.5], [1.1, 1.0, 0.7, 0, 2.3], [3.4, 0.5, 0.7, 0, 3.05], [0.8, 0.7, 0.6, 0, 3.65]]) k.box(k.root, w, h, d, '#7c776f', 'stone', x, y, 0); return 1.4; }],
  [/cairn|boulder|\brocks?\b|stones?\b/i, (k) => { for (let i = 0; i < 6; i++) { const s = 1.1 - i * 0.14; k.add(k.root, U.ico(1), i % 2 ? '#8a857c' : '#77726b', 'stone', (hash2(i, 1) - 0.5) * 0.2, 0.4 + i * 0.5 - i * i * 0.012, (hash2(i, 2) - 0.5) * 0.2, i, i * 2, 0, s, s * 0.6, s * 0.9); } return 1.2; }],
  [/\barch\b|gate|portal|doorway|door\b/i, (k, mt) => { const c = mt?.c || '#8a8f94', m = mt?.m || 'steel'; for (const s of [-1, 1]) k.box(k.root, 0.5, 4, 0.5, c, m, s * 1.8, 2, 0); k.tor(k.root, 1.8, 0.25, c, m, 0, 4, 0, 0, 0, 0, Math.PI); return 2.2; }],
  [/\bwaves?\b|tide|ocean|\bsea\b|water/i, (k, mt) => { const c = mt?.c || '#2c6e9a', m = mt?.m || 'paint'; const pts = []; for (let i = 0; i <= 30; i++) { const t = i / 30; pts.push([-3 + t * 5, 0.3 + Math.sin(t * Math.PI) * 3 * (1 - t * 0.3), Math.sin(t * 9) * 0.2]); } pts.push([2.4, 3.2, 0], [1.6, 2.6, 0.1]); k.tube(k.root, pts, 0.32, c, m, 40, 10); k.box(k.root, 6, 0.3, 1.2, C.CONCRETE, 'stone', 0, 0.15, 0); return 2.8; }],
  [/spiral|helix|twist/i, (k, mt) => { const c = mt?.c || STEEL, m = mt?.m || 'steel', pts = []; for (let i = 0; i <= 60; i++) { const t = i / 60; pts.push([Math.cos(t * 12) * (1.2 - t * 0.6), 0.3 + t * 5, Math.sin(t * 12) * (1.2 - t * 0.6)]); } k.tube(k.root, pts, 0.14, c, m, 80, 8); return 1.4; }],
  [/crystal|prism|shard/i, (k, mt) => { for (let i = 0; i < 5; i++) k.add(k.root, U.cone(5), i % 2 ? '#bfe3f0' : '#e2eef5', 'glass', (i - 2) * 0.5, 1.5 + i % 3 * 0.4, (i % 2) * 0.4, 0, i, (i - 2) * 0.15, 0.5, 3 + i % 3, 0.5); return 1.4; }],
  [/\bring|circle|loop|halo/i, (k, mt) => { const c = mt?.c || STEEL, m = mt?.m || 'steel'; k.tor(k.root, 2, 0.22, c, m, 0, 2.3, 0); k.box(k.root, 1.2, 0.3, 0.8, C.CONCRETE, 'stone', 0, 0.15, 0); return 2; }],
  [/column|pillar|obelisk|tower|totem/i, (k, mt) => { const c = mt?.c || '#8a857c', m = mt?.m || 'stone'; k.cyl(k.root, 0.45, 0.55, 6, c, m, 0, 3, 0, 0, 0, 0, 8); for (let i = 0; i < 5; i++) k.cyl(k.root, 0.58, 0.58, 0.12, i % 2 ? '#c9a24a' : c, i % 2 ? 'gold' : m, 0, 1 + i * 1.1, 0, 0, 0, 0, 8); return 0.8; }],
];

// ---------- abstracts, only for pieces with no subject: in their real material ----------
function abstract(k, mt, seed, scaleUp = 1) {
  const kind = mt?.k || ['steel', 'painted', 'corten', 'stone', 'bronze', 'painted'][Math.floor(hash2(seed, 21) * 6)], v = Math.floor(hash2(seed, 11) * 3), H = (3.5 + hash2(seed, 13) * 4) * scaleUp;
  const c = mt?.c || (kind === 'painted' ? pick(['#d62828', '#1d4ed8', '#f4c430', '#16a34a', '#f97316']) : kind === 'bronze' ? BRONZE : kind === 'corten' ? C.CORTEN : kind === 'stone' ? '#8a857c' : STEEL);
  const m = mt?.m || (kind === 'painted' ? 'paint' : kind === 'stone' || kind === 'concrete' ? 'stone' : kind);
  k.box(k.root, 2.6, 0.3, 2.6, '#8a857c', 'stone', 0, 0.15, 0);
  if (kind === 'steel' || kind === 'glass' || kind === 'light') {
    if (v === 0) { const pts = []; for (let i = 0; i <= 24; i++) { const t = i / 24; pts.push([Math.sin(t * 7) * 0.9, 0.3 + t * H, Math.cos(t * 5) * 0.6]); } k.tube(k.root, pts, 0.28, c, m, 40, 10); }   // polished ribbon
    else if (v === 1) { k.tor(k.root, H * 0.3, 0.12, c, m, 0, H * 0.4 + 0.3, 0, 0, 0.4, 0.2); k.tor(k.root, H * 0.24, 0.12, c, m, 0, H * 0.4 + 0.3, 0, Math.PI / 2, 0, 0); }   // interlocking rings
    else for (let i = 0; i < 6; i++) k.box(k.root, 1.0 - i * 0.08, H / 6, 0.5, c, m, 0, 0.3 + (i + 0.5) * H / 6, 0, 0, i * 0.3, 0);   // twisted stacked blades
  } else if (kind === 'painted' || kind === 'corten') {
    if (v === 0) for (let i = 0; i < 3; i++) k.shape(k.root, [[-1.2, 0], [1.4, 0], [0.6, H * (0.6 + i * 0.15)], [-0.4, H * (0.5 + i * 0.2)]], 0.08, c, m, 0, 0.3, 0, 0, i * 1.05, 0);   // intersecting plates
    else if (v === 1) { k.box(k.root, 0.5, H, 0.5, c, m, -0.8, 0.3 + H / 2, 0, 0, 0, 0.2); k.box(k.root, 0.5, H * 0.8, 0.5, c, m, 0.8, 0.3 + H * 0.4, 0, 0, 0, -0.35); k.box(k.root, H * 0.7, 0.45, 0.45, c, m, 0, 0.3 + H * 0.75, 0, 0, 0.5, 0.1); }   // leaning beams
    else { const pts = []; for (let i = 0; i <= 20; i++) { const t = i / 20; pts.push([Math.cos(t * 4.5) * 1.4, 0.3 + Math.sin(t * Math.PI) * H, Math.sin(t * 4.5) * 0.6]); } k.tube(k.root, pts, 0.3, c, m, 30, 4); }   // bent beam
  } else if (kind === 'stone' || kind === 'concrete') {
    if (v === 0) { k.add(k.root, U.sph(16), c, m, 0, 0.3 + H * 0.4, 0, 0, hash2(seed, 3) * 3, 0, 0.9, H * 0.4, 0.55); k.add(k.root, U.tor(0.35, 6.28, 20), '#2a2a2a', m, 0, 0.3 + H * 0.45, 0, 0, hash2(seed, 3) * 3 + Math.PI / 2, 0, 0.28, 0.28, 0.6); }   // carved monolith with a hole
    else if (v === 1) for (let i = 0; i < 4; i++) k.add(k.root, U.ico(1), c, m, (hash2(i, seed) - 0.5) * 0.3, 0.6 + i * 0.75, 0, i, i * 2, 0, 0.9 - i * 0.12, 0.42, 0.75 - i * 0.08);   // balanced stones
    else { k.box(k.root, 1.0, H, 0.7, c, m, -0.6, 0.3 + H / 2, 0); k.box(k.root, 1.0, H * 0.75, 0.7, c, m, 0.6, 0.3 + H * 0.375, 0.1, 0, 0.1, 0); }   // split block
  } else if (kind === 'wood') {
    pole(k, k.root, { H: H * 1.3, r: 0.4, figs: ['human', 'bear'], paint: false });
  } else {   // bronze: Moore-like organic forms
    k.sph(k.root, 1.1, c, m, -0.9, 1.3, 0, 1.6, 0.8, 1); k.sph(k.root, 0.9, c, m, 0.9, 1.5, 0.2, 1, 1.3, 0.9); k.sph(k.root, 0.7, c, m, 0.1, 2.4, 0, 1.2, 0.8, 0.9); k.add(k.root, U.tor(0.4, 6.28, 20), c, m, 0.9, 1.6, 0.3, 0, 0.8, 0, 0.5, 0.5, 0.5);
  }
  return 1.5;
}

// ---------- memorials, fountains (kept from the first version) ----------
function memorial(t, h, seed, name) {
  if (t === 'h_cannon') return { m: mesh([cyl(0.2, 0.3, 2.6, BLACK, 0, 1.1, 0.2, Math.PI / 2 - 0.15), cyl(0.6, 0.6, 0.12, '#5a4030', -0.5, 0.6, 0, 0, 0, Math.PI / 2, 16), cyl(0.6, 0.6, 0.12, '#5a4030', 0.5, 0.6, 0, 0, 0, Math.PI / 2, 16), box(0.9, 0.3, 1.4, '#5a4030', 0, 0.55, -0.3)], 'bronze'), r: 1 };
  if (t === 'h_bell') return { m: mesh([box(0.3, 3.2, 0.3, CEDAR, -1.2, 1.6, 0), box(0.3, 3.2, 0.3, CEDAR, 1.2, 1.6, 0), box(2.8, 0.35, 0.5, CEDAR, 0, 3.3, 0), part(new THREE.CylinderGeometry(0.35, 0.75, 1.2, 16, 1, true), BRONZE, 0, 2.4, 0)], 'bronze'), r: 1.2 };
  if (t === 'h_locomotive' || t === 'h_railway_car' || t === 'h_railway') return { m: mesh([box(2.9, 2.8, 13, t === 'h_locomotive' ? BLACK : '#5a2a1f', 0, 2.2, 0), cyl(1.2, 1.2, 7, BLACK, 0, 2.6, 2.5, Math.PI / 2), cyl(0.35, 0.45, 1.4, BLACK, 0, 4.4, 5), box(2.6, 0.6, 12, '#222', 0, 0.5, 0), ...[-4, -1.5, 1.5, 4].flatMap(z => [cyl(0.7, 0.7, 0.2, '#b91c1c', -1.4, 0.8, z, 0, 0, Math.PI / 2), cyl(0.7, 0.7, 0.2, '#b91c1c', 1.4, 0.8, z, 0, 0, Math.PI / 2)])], 'paint'), r: 1.6 };
  if (t === 'lighthouse' || t === 'h_lighthouse') return { m: mesh([cyl(1.6, 2, 9, '#f4f1e8', 0, 4.5, 0, 0, 0, 0, 16), cyl(1.2, 1.2, 1.4, '#c53030', 0, 9.7, 0, 0, 0, 0, 16), cyl(0.2, 1.4, 1, '#c53030', 0, 10.9, 0, 0, 0, 0, 16)]), r: 2 };
  if (t === 'h_wayside_cross') return { m: mesh([box(0.3, 4, 0.3, '#d9d5cc', 0, 2, 0), box(1.6, 0.3, 0.3, '#d9d5cc', 0, 3, 0)]), r: 0.4 };
  if (t === 'h_wayside_shrine') return { m: mesh([box(1, 1.6, 0.6, '#d9d5cc', 0, 0.8, 0), box(0.8, 0.8, 0.5, '#7a5a3a', 0, 2, 0), part(new THREE.ConeGeometry(0.8, 0.6, 4), '#5a4030', 0, 2.7, 0, 0, Math.PI / 4, 0)]), r: 0.6 };
  if (t === 'h_milestone' || t === 'h_boundary_stone') return { m: mesh([box(0.6, 1.1, 0.35, '#b8b2a6', 0, 0.55, 0), cyl(0.3, 0.3, 0.35, '#b8b2a6', 0, 1.1, 0, Math.PI / 2, 0, 0, 12)]), r: 0.5 };
  const n = String(name || '').toLowerCase();
  if (/ghost_bike/.test(n)) { const P = [cyl(0.35, 0.35, 0.05, '#f4f4f0', -0.5, 0.36, 0, Math.PI / 2, 0, 0, 16), cyl(0.35, 0.35, 0.05, '#f4f4f0', 0.55, 0.36, 0, Math.PI / 2, 0, 0, 16), box(1.0, 0.05, 0.05, '#f4f4f0', 0.05, 0.6, 0, 0, 0, 0.3), box(0.05, 0.6, 0.05, '#f4f4f0', -0.15, 0.6, 0, 0, 0, -0.3), box(0.5, 0.05, 0.05, '#f4f4f0', 0.3, 0.9, 0), box(0.25, 0.05, 0.05, '#f4f4f0', -0.25, 0.9, 0), box(0.05, 0.05, 0.45, '#f4f4f0', 0.55, 1.0, 0)]; return { m: mesh(P, 'paint'), r: 0.8 }; }
  if (/cairn/.test(n)) return { m: mesh([0, 1, 2, 3, 4].map(i => part(new THREE.IcosahedronGeometry(1, 0), i % 2 ? '#8a857c' : '#77726b', 0, 0.45 + i * 0.5, 0, i, i * 2, 0, 0.9 - i * 0.12, 0.45, 0.8 - i * 0.1)).concat([box(0.6, 0.4, 0.05, BRONZE, 0, 0.9, 0.75)]), 'stone'), r: 1 };
  if (/stele|stone|boulder/.test(n)) return { m: mesh([part(new THREE.IcosahedronGeometry(1, 1), '#7a756d', 0, 0.6, 0, 0, hash2(seed, 2) * 3, 0, 1.1, 0.75, 0.8), box(0.7, 0.45, 0.05, BRONZE, 0, 0.85, 0.72, -0.3)], 'stone'), r: 1 };
  const k = Math.floor(hash2(seed, 21) * 4);
  if (/plaque/.test(n) || t === 'h_plaque' || (t === 'h_memorial' && k === 3 && !/war/.test(n)))   // lectern with a big bronze plaque
    return { m: mesh([box(1.4, 1, 0.5, GRANITE, 0, 0.5, 0), box(1.2, 0.8, 0.08, BRONZE, 0, 1.15, 0.12, -0.6)], 'bronze'), r: 0.8 };
  if (k === 0 || t === 'obelisk' || /war_memorial|obelisk/.test(n)) return { m: mesh([box(2.6, 0.5, 2.6, GRANITE, 0, 0.25, 0), box(1.6, 1, 1.6, GRANITE, 0, 1, 0), cyl(0.25, 0.75, 7, '#b8b2a6', 0, 5, 0, 0, Math.PI / 4, 0, 4), part(new THREE.ConeGeometry(0.36, 0.7, 4), '#b8b2a6', 0, 8.85, 0, 0, Math.PI / 4, 0), box(1.0, 0.7, 0.06, BRONZE, 0, 1.1, 0.81)]), r: 1.4 };   // obelisk
  if (k === 1) return { m: mesh([box(3.4, 0.4, 1.6, GRANITE, 0, 0.2, 0), box(3, 2.2, 0.8, GRANITE, 0, 1.5, 0), box(2.2, 1.2, 0.06, BRONZE, 0, 1.6, 0.42), part(new THREE.CylinderGeometry(1.5, 1.5, 0.8, 16, 1, false, 0, Math.PI), GRANITE, 0, 2.6, 0, Math.PI / 2, 0, 0, 1, 1, 0.5)]), r: 1.8 };   // headstone wall
  return { m: mesh([box(1.8, 2.2, 1.8, '#9c978d', 0, 1.1, 0), box(2.1, 0.18, 2.1, '#9c978d', 0, 0.09, 0), sph(0.7, BRONZE, 0, 2.9, 0, 1, 0.6, 1), box(1.1, 0.7, 0.06, BRONZE, 0, 1.2, 0.93), ...[-1.5, 1.5].map(x => sph(0.5, '#2f855a', x, 0.4, 1.4, 1, 0.7, 1))], 'bronze'), r: 1.4 };   // monument with an urn + shrubs
}
function fountain(h, seed) {
  const big = hash2(seed, 31) < 0.5, R = big ? 4.2 : 3;
  const g = group(mesh([cyl(R, R + 0.2, 0.7, STONE, 0, 0.35, 0, 0, 0, 0, 28), cyl(R - 0.3, R - 0.3, 0.1, '#2c6e85', 0, 0.62, 0, 0, 0, 0, 28), cyl(0.35, 0.5, 1.8, STONE, 0, 1.3, 0), cyl(1.4, 0.7, 0.3, STONE, 0, 2.2, 0, 0, 0, 0, 18), ...(big ? [cyl(0.2, 0.3, 1.2, STONE, 0, 2.9, 0), cyl(0.8, 0.4, 0.22, STONE, 0, 3.5, 0, 0, 0, 0, 16)] : [])]));
  const jet = new THREE.Mesh(new THREE.ConeGeometry(0.6, 2.8, 12, 1, true).translate(0, 1.4, 0), new THREE.MeshStandardMaterial({ color: '#d6eef5', transparent: true, opacity: 0.55, roughness: 0.1, depthWrite: false }));
  jet.position.y = big ? 3.6 : 2.35; g.add(jet); g.userData.jet = jet; return { m: g, r: R };
}
function drinkingFountain() { return { m: mesh([cyl(0.25, 0.3, 0.9, '#8a857c', 0, 0.45, 0, 0, 0, 0, 12), cyl(0.35, 0.25, 0.12, '#8a857c', 0, 0.95, 0, 0, 0, 0, 12), box(0.06, 0.12, 0.06, '#c9ced3', 0, 1.06, 0.1)]), r: 0.4 }; }

// ---------- murals (painted on the nearest wall; a free-standing panel when there's no wall) ----------
const ART_COLS = ['#c53030', '#2b6cb0', '#d69e2e', '#2f855a', '#e2e8f0', '#1a202c', '#dd6b20', '#805ad5'];
const muralCache = new Map();
function muralTex(seed) {
  if (muralCache.has(seed)) return muralCache.get(seed);
  const rnd = (k) => hash2(seed * 1.37 + k, k * 2.11 + seed);
  const t = canvasTex(512, 256, (c, w, h) => {
    const bg = c.createLinearGradient(0, 0, w, h); bg.addColorStop(0, ART_COLS[Math.floor(rnd(1) * 8)]); bg.addColorStop(1, ART_COLS[Math.floor(rnd(2) * 8)]); c.fillStyle = bg; c.fillRect(0, 0, w, h);
    const style = Math.floor(rnd(3) * 4);
    if (style === 0) { c.fillStyle = '#1a202c'; c.beginPath(); c.moveTo(0, h); for (let x = 0; x <= w; x += 32) c.lineTo(x, h * (0.45 + 0.25 * rnd(x))); c.lineTo(w, h); c.fill(); c.fillStyle = '#f7fafc'; c.beginPath(); c.arc(w * 0.75, h * 0.25, 30, 0, 6.29); c.fill(); }
    if (style === 1) for (let i = 0; i < 14; i++) { c.fillStyle = ART_COLS[Math.floor(rnd(10 + i) * 8)]; c.beginPath(); c.arc(rnd(30 + i) * w, rnd(50 + i) * h, 15 + rnd(70 + i) * 60, 0, 6.29); c.fill(); }
    if (style === 2) { c.strokeStyle = '#111'; c.lineWidth = 10; c.fillStyle = '#c53030'; c.beginPath(); c.ellipse(w / 2, h / 2, w * 0.3, h * 0.28, 0, 0, 6.29); c.fill(); c.stroke(); c.fillStyle = '#111'; c.beginPath(); c.arc(w / 2 - 50, h / 2 - 10, 18, 0, 6.29); c.arc(w / 2 + 50, h / 2 - 10, 18, 0, 6.29); c.fill(); }
    if (style === 3) { for (let i = 0; i < 9; i++) { c.fillStyle = ART_COLS[i % 8]; c.fillRect(i * w / 9, 0, w / 9 + 1, h); } c.fillStyle = '#ffffffcc'; c.font = 'bold 64px Arial'; c.textAlign = 'center'; c.fillText(pick(['VAN', 'LOVE', 'RAIN', 'EAT', 'HOPE', 'COAST']), w / 2, h / 2 + 22); }
  }, false);
  muralCache.set(seed, t); return t;
}
function mural(a) {
  let best = null, bd = 18;
  for (const b of nearBuildings(a.x, a.z, 18)) { const P = b.p, n = P.length / 2; for (let i = 0, j = n - 1; i < n; j = i++) { const ax = P[j * 2], az = P[j * 2 + 1], dx = P[i * 2] - ax, dz = P[i * 2 + 1] - az, L = Math.hypot(dx, dz); if (L < 5) continue; const tt = Math.max(0, Math.min(1, ((a.x - ax) * dx + (a.z - az) * dz) / (L * L))), d = Math.hypot(a.x - ax - dx * tt, a.z - az - dz * tt); if (d < bd) { bd = d; let nx = dz / L, nz = -dx / L; if (inPoly(ax + dx * 0.5 + nx * 0.3, az + dz * 0.5 + nz * 0.3, P)) { nx = -nx; nz = -nz; } best = { x: ax + dx * tt, z: az + dz * tt, nx, nz, L, top: b.top }; } } }
  const w = best ? Math.min(best.L - 1, 16) : 0, hh = best ? Math.min(w * 0.55, best.top - surfaceY(best.x, best.z) - 0.4) : 0, tex = muralTex(Math.round(a.x * 7 + a.z));
  if (!best || hh < 2.5) {
    const g = new THREE.Group(), face = new THREE.Mesh(new THREE.PlaneGeometry(5, 3), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide }));
    face.position.y = 2.3; g.add(face, mesh([box(5.3, 3.3, 0.14, '#5a4030', 0, 2.3, -0.09), box(0.18, 2.2, 0.18, '#5a4030', -2.4, 1.1, -0.09), box(0.18, 2.2, 0.18, '#5a4030', 2.4, 1.1, -0.09)]));
    g.position.set(a.x, surfaceY(a.x, a.z), a.z); g.rotation.y = hash2(a.x, a.z) * 6; return { m: g, r: 0, placed: true };
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hh), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
  m.position.set(best.x + best.nx * 0.08, surfaceY(best.x, best.z) + 0.5 + hh / 2, best.z + best.nz * 0.08); m.rotation.y = Math.atan2(best.nx, best.nz);
  return { m, r: 0, placed: true, wall: true };
}

// ---------- name plaque on a post ----------
const plaqueCache = new Map();
function plaque(name, kind) {
  const key = name + '|' + kind; let tex = plaqueCache.get(key);
  if (!tex) {
    tex = canvasTex(512, 256, (c, w, h) => {
      c.fillStyle = '#2b2118'; c.fillRect(0, 0, w, h); c.strokeStyle = '#c9a25b'; c.lineWidth = 10; c.strokeRect(8, 8, w - 16, h - 16);
      c.fillStyle = '#f3e3c8'; c.textAlign = 'center'; c.textBaseline = 'middle';
      let fs = 54; c.font = `bold ${fs}px Georgia, serif`; while (c.measureText(name).width > w - 50 && fs > 22) { fs -= 3; c.font = `bold ${fs}px Georgia, serif`; }
      c.fillText(name, w / 2, h * 0.43); c.font = 'italic 30px Georgia, serif'; c.fillStyle = '#c9a25b'; c.fillText(kind, w / 2, h * 0.75);
    }, false);
    plaqueCache.set(key, tex);
  }
  const g = new THREE.Group();
  g.add(mesh([box(0.12, 1.1, 0.12, '#3d4247', 0, 0.55, 0), box(1.16, 0.6, 0.05, '#4a3a28', 0, 1.2, -0.0, -0.35)], 'bronze'));
  const f = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.2 })); f.position.set(0, 1.2 + 0.01, 0.035); f.rotation.x = -0.35; g.add(f);
  return g;
}

export const ART_NAMES = { sculpture: 'Sculpture', statue: 'Statue', bust: 'Bust', mural: 'Mural', installation: 'Art installation', totem_pole: 'Totem pole', relief: 'Relief', mosaic: 'Mosaic', stone: 'Stone sculpture', fountain: 'Fountain', h_memorial: 'Memorial', h_monument: 'Monument', h_plaque: 'Historic plaque', obelisk: 'Obelisk', lighthouse: 'Lighthouse', h_railway_car: 'Historic railway car', h_locomotive: 'Historic locomotive', h_cannon: 'Historic cannon', h_bell: 'Historic bell', carving: 'Wood carving', woodcarving: 'Wood carving', street_art: 'Street art', graffiti: 'Graffiti', painting: 'Painting', h_ship: 'Historic ship' };
export const kindName = a => ART_NAMES[a.t] || ART_NAMES[String(a.t).toLowerCase()] || (a.t.startsWith('h_') ? 'Historic site' : 'Public art');
const findFamous = name => name && FAMOUS.find(F => F[0].test(name) && F[1] !== null);
// the toast text: the researched fact for famous pieces, else what OSM knows (artist, material, description)
export const famousFact = a => {
  const n = a.n >= 0 ? M.names[a.n] : '', f = findFamous(n);
  if (f && f[2]) return f[2];
  const d = artData(a); if (!d) return '';
  const by = d[3] ? 'By ' + d[3].replace(/;/g, ' & ') : '', mat = d[4] ? d[4].replace(/[;_,]/g, ' ').replace(/\bstainless steel\b/, 'stainless steel') : '';
  return [by && mat ? `${by}, in ${mat}.` : by ? by + '.' : mat ? `Made of ${mat}.` : '', d[6]].filter(Boolean).join(' ').slice(0, 260);
};
const GENERIC_NAME = /^(plaque|war_memorial|totem_pole|ghost_bike|statue|bust|stone|stele|cairn|obelisk|sculpture|memorial|fountain|bench|tree|flowers|yes)$/i;

// what a piece will be built as (also used by the tally)
export function classify(a) {
  const t = String(a.t).toLowerCase(), name = a.n >= 0 ? M.names[a.n] : '';
  if (SKIP.test(t)) return 'skip';
  if (ON_AIRPORT.test(name)) return 'skip';
  if (findFamous(name)) return 'famous';
  if (/mural|street_art|graffiti|painting|mosaic/.test(t)) return 'mural';
  if (t === 'fountain') return 'fountain';
  const n = name.toLowerCase(), d = name && !GENERIC_NAME.test(name) ? name : '';
  if (t === 'h_memorial' || t === 'h_monument') { if (/^statue$/.test(n)) return 'statue'; if (/^bust$/.test(n)) return 'bust'; if (/^fountain$/.test(n)) return 'drink'; }
  if (/totem|carving/.test(t) || /totem|house post|welcom|\bpole\b|spindle/i.test(name)) return /welcom/i.test(name) ? 'welcome' : 'totem';
  if (t === 'statue') return d && SUBJECTS.some(S => S[0].test(d) && !/tree|column|tower|arch|gate|ring|wave|water/i.test(S[0].source)) && !/\b(man|woman|girl|boy|figure|people)\b/i.test(d) ? 'subject' : 'statue';
  if (t === 'bust') return 'bust';
  if (t.startsWith('h_') || t === 'obelisk' || t === 'lighthouse') return 'memorial';
  if (d && /\b(man|woman|girl|boy|figures?|people|swimmer|dancer|reader|thinker|family|mother|child|lady|king|queen|poet|soldier|worker)\b/i.test(d)) return 'statue';
  if (d && SUBJECTS.some(S => S[0].test(d))) return 'subject';
  const dd = artData(a); if (dd && /\b(statue|figure of|bronze figure|depicts a (man|woman|boy|girl))\b/i.test(dd[6])) return 'statue';
  return 'abstract';
}

// face the nearest street or path; 'water' = toward the nearest water
function faceYaw(a, face) {
  if (typeof face === 'number') return face;
  if (face === 'west') return -Math.PI / 2;
  if (face === 'water') { let best = null, bd = 1e9; for (let i = 0; i < 16; i++) { const an = i / 16 * Math.PI * 2; for (let r = 10; r <= 120; r += 10) { const x = a.x + Math.sin(an) * r, z = a.z + Math.cos(an) * r; if (isWater(x, z)) { if (r < bd) { bd = r; best = an; } break; } } } if (best !== null) return best; }
  const nr = nearestRoad(a.x, a.z, 60);
  if (nr) { const e = nr.e, ax = NX(e.a), az = NZ(e.a), px = ax + (NX(e.b) - ax) * nr.t, pz = az + (NZ(e.b) - az) * nr.t; if (Math.hypot(px - a.x, pz - a.z) > 0.5) return Math.atan2(px - a.x, pz - a.z); }
  return hash2(a.x, a.z) * 6.28;
}

// a mapped street/park tree standing right where a sculpture is (the Trans Am Totem's median) hides the piece: remove it
const cleared = new Set(), Z0 = new THREE.Matrix4().makeScale(0, 0, 0);
function clearTrees(x, z, r) {
  const key = Math.round(x) + ',' + Math.round(z); if (cleared.has(key)) return; cleared.add(key);
  const r2 = r * r;
  for (const grp of treeChunks) { if (Math.abs(grp.userData.cx - x) > 300 + r || Math.abs(grp.userData.cz - z) > 300 + r) continue;
    for (const m of grp.children) { if (!m.userData.items) continue; for (const t of m.userData.items) if ((t.x - x) ** 2 + (t.z - z) ** 2 < r2) for (const [mm, i] of t.refs || []) { mm.userData.ring?.setBroken(mm, i, true); mm.setMatrixAt(i, Z0); mm.instanceMatrix.needsUpdate = true; } } }
  const tg = _colliderGrids.get('trees'); if (tg) for (const [k, L] of tg) { const f = L.filter(c => (c.x - x) ** 2 + (c.z - z) ** 2 >= r2); if (f.length !== L.length) tg.set(k, f); }
}

// build one piece: returns a Group positioned in the world (or null), plus its footprint radius in userData.r
export function buildArt(a) {
  const t = String(a.t).toLowerCase(), h = hash2(a.x, a.z), seed = a.x * 0.37 + a.z * 1.3, name = a.n >= 0 ? M.names[a.n] : '';
  const kind = classify(a); if (kind === 'skip') return null;
  const data = artData(a), mt = matOf(data?.[4], seed);
  let res = null, opts = {};
  const kitBuild = f => { const k = Kit(); k._name = name; k._seed = seed; const r = f(k); if (r === null) return null; return { m: k.build(), r: r ?? 1.5 }; };
  if (kind === 'famous') {
    const fam = findFamous(name); opts = fam[3] || {};
    if (/Millennium Gate/i.test(name)) return null;   // landmarks.js builds the gate
    res = kitBuild(k => fam[1](k, { a, name, data }));
    if (!res) return null;
  }
  else if (kind === 'mural') res = mural(a);
  else if (kind === 'statue') res = kitBuild(k => statue(k, GENERIC_NAME.test(name) ? '' : name, mt, seed, data?.[6]));
  else if (kind === 'bust') res = kitBuild(k => { const y = plinth(k, 0.9, 1.5, '#8e8a83'); bustFig(k, k.root, { y, s: 1.35, c: mt?.c || BRONZE, m: mt?.m || 'bronze', beard: h < 0.3, moustache: h < 0.5 }); return 0.8; });
  else if (kind === 'welcome') res = kitBuild(k => { welcomeFigure(k, k.root, { H: data?.[5] > 2 ? Math.min(data[5], 8) : 4.5 + h * 2 }); return 1.2; });
  else if (kind === 'totem') res = kitBuild(k => {
    const figsets = [['bear', 'human', 'eagle'], ['frog', 'bear', 'raven'], ['whale', 'wolf', 'thunderbird'], ['human', 'beaver', 'eagle', 'watchman'], ['bear', 'salmon', 'human', 'thunderbird'], ['raven', 'bear', 'moon']];
    const houseP = /house post|post/i.test(name), H = data?.[5] > 2 ? Math.min(data[5], 18) : houseP ? 4.5 : 7 + h * 6;
    if (/spindle/i.test(name)) { const n = k.node(k.root, 0, 2.6, 0, Math.PI / 2, 0, 0); k.cyl(k.root, 0.12, 0.15, 2, '#555', 'steel', 0, 1, 0); k.cyl(n, 1.3, 1.3, 0.2, CEDAR, 'wood', 0, 0, 0, 0, 0, 0, 28); k.tor(n, 1.15, 0.06, '#161616', 'wood', 0, 0.11, 0, Math.PI / 2); return 1.4; }
    pole(k, k.root, { H, r: houseP ? 0.7 : 0.45 + h * 0.15, figs: houseP ? ['bear', 'human'] : figsets[Math.floor(hash2(seed, 3) * 6)], paint: !/carving|woodcarving/.test(t) || h < 0.5 }); return houseP ? 1.6 : 1.3; });
  else if (kind === 'subject') { const S = SUBJECTS.find(S => S[0].test(name)); res = kitBuild(k => S[1](k, mt)); }
  else if (kind === 'fountain') res = fountain(h, seed);
  else if (kind === 'drink') res = drinkingFountain();
  else if (kind === 'memorial') res = memorial(t, h, seed, name);
  else res = kitBuild(k => t === 'stone' ? (k.add(k.root, U.ico(1), '#77726b', 'stone', 0, 1.0, 0, 0, h * 3, 0, 1.6, 1.1, 1.3), 1.8) : abstract(k, mt, seed, t === 'installation' ? 1.15 : 1));
  if (!res) return null;
  const g = res.placed && !name ? res.m : new THREE.Group();
  if (g !== res.m) {
    let yaw = 0;
    if (res.placed) g.add(res.m);   // murals are already in world coordinates
    else {
      let y = surfaceY(a.x, a.z);
      if (opts.roof) for (const b of nearBuildings(a.x, a.z, 30)) if (inPoly(a.x, a.z, b.p)) y = Math.max(y, b.top);
      yaw = opts.face === 'keep' ? 0 : faceYaw(a, opts.face);
      res.m.position.set(a.x, y, a.z); res.m.rotation.y = yaw; g.add(res.m);
      if (!opts.roof && kind !== 'memorial' && kind !== 'fountain' && kind !== 'drink') clearTrees(a.x, a.z, Math.min(6, (res.r || 1) + 1.5));
    }
    if (name && !GENERIC_NAME.test(name) && !opts.noPlaque) {   // the name plaque, in front of the piece
      const ang = res.wall ? res.m.rotation.y : yaw + (hash2(a.z, a.x) - 0.5) * 0.9, d = (res.wall ? 1.4 : Math.min(res.r || 1, 6) + 1.4);
      const px = res.wall ? res.m.position.x + Math.sin(ang) * 1.4 : a.x + Math.sin(ang) * d, pz = res.wall ? res.m.position.z + Math.cos(ang) * 1.4 : a.z + Math.cos(ang) * d;
      const pq = plaque(name, kindName(a)); pq.position.set(px, surfaceY(px, pz), pz); pq.rotation.y = ang; g.add(pq);
    }
  }
  g.userData.r = res.r || 0; g.userData.jet = res.m.userData?.jet; g.userData.wall = !!res.wall; g.userData.kind = kind;
  return g;
}

// tally for tests: how every piece in the map is built
export function artTally() {
  const out = {}; for (const a of M.art || []) { const k = classify(a); out[k] = (out[k] || 0) + 1; }
  const named = (M.art || []).filter(a => a.n >= 0 && !GENERIC_NAME.test(M.names[a.n]));
  out.namedAbstract = named.filter(a => classify(a) === 'abstract').map(a => M.names[a.n]);
  return out;
}
