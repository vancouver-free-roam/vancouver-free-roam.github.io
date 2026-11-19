// Public art + historic markers from OpenStreetMap, built so you can SEE them (no button needed):
//  - well-known Vancouver pieces get their own look-alike model (Engagement rings, Trans Am Totem, Bill Reid's orca,
//    the stainless-steel Crab, Lumberman's Arch, the Millennium Gate, Love in the Rain, 900 Oranges, the Ben Franklin sub…)
//  - everything else gets a big, clear model for its kind on a proper plinth: bronze statues and busts, carved poles,
//    abstract sculptures (8 families, all different), memorials with bronze plaques, obelisks, fountains, murals
//  - a name plaque on a post in front of every named piece
// Pieces that already have a hand-built landmark (The Drop, Digital Orca, Inukshuk, A-maze-ing Laughter…) and historic
// "markers" that are really whole buildings (houses, theatres, stations) are left alone.
import * as THREE from 'three';
import { hash2, inPoly, canvasTex, pick } from './core.js';
import { surfaceY, nearBuildings, nearestRoad, NX, NZ } from './city.js';

const M = window.MAP;
// ---------- merge kit ----------
function part(geo, c, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) { return { geo, c, x, y, z, rx, ry, rz, sx, sy, sz }; }
const box = (w, h, d, c, x, y, z, rx, ry, rz) => part(new THREE.BoxGeometry(w, h, d), c, x, y, z, rx, ry, rz);
const cyl = (r1, r2, h, c, x, y, z, rx, ry, rz, seg = 12) => part(new THREE.CylinderGeometry(r1, r2, h, seg), c, x, y, z, rx, ry, rz);
const sph = (r, c, x, y, z, sx = 1, sy = 1, sz = 1, seg = 14) => part(new THREE.SphereGeometry(r, seg, Math.max(6, seg * 0.7 | 0)), c, x, y, z, 0, 0, 0, sx, sy, sz);
const tor = (R, t, c, x, y, z, rx = 0, ry = 0, rz = 0, arc = Math.PI * 2) => part(new THREE.TorusGeometry(R, t, 10, 40, arc), c, x, y, z, rx, ry, rz);
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
const MAT = {
  stone: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
  bronze: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.75 }),
  steel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.95, envMapIntensity: 1.4 }),
  paint: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.2 }),
};
const BRONZE = '#6e5233', VERD = '#4f7a6a', STEEL = '#c9ced3', STONE = '#a29d93', GRANITE = '#6f6b66', CEDAR = '#7a4e2d', BLACK = '#1d1f22';
const COLS = ['#d62828', '#1d4ed8', '#f4c430', '#16a34a', '#f97316', '#7c3aed', '#e11d48', '#0ea5e9', '#ffffff'];
const mesh = (parts, mat = 'stone') => { const m = new THREE.Mesh(merge(parts), MAT[mat]); m.castShadow = true; m.receiveShadow = true; return m; };
const group = (...ms) => { const g = new THREE.Group(); for (const m of ms) if (m) g.add(m); return g; };

// a proper standing figure (statues): legs, hips, torso, shoulders, arms, neck, head; poses
function figure(c, y0 = 0, sc = 1, pose = 'stand', x = 0, z = 0, ry = 0) {
  const P = [], S = v => v * sc, rot = (px, pz) => [x + px * Math.cos(ry) + pz * Math.sin(ry), z - px * Math.sin(ry) + pz * Math.cos(ry)];
  const add = (geoPart, px, py, pz) => { const [X, Z] = rot(px, pz); geoPart.x = X; geoPart.y = y0 + py; geoPart.z = Z; geoPart.ry = (geoPart.ry || 0) + ry; P.push(geoPart); };
  const sit = pose === 'sit', run = pose === 'run';
  add(cyl(S(0.085), S(0.065), S(0.86), c, 0, 0, 0, sit ? -1.4 : run ? 0.5 : 0, 0, 0, 8), S(-0.11), S(sit ? 0.45 : 0.45), S(sit ? 0.32 : run ? 0.15 : 0));
  add(cyl(S(0.085), S(0.065), S(0.86), c, 0, 0, 0, sit ? -1.4 : run ? -0.5 : 0, 0, 0, 8), S(0.11), S(sit ? 0.45 : 0.45), S(sit ? 0.32 : run ? -0.15 : 0));
  add(box(S(0.38), S(0.22), S(0.24), c), 0, S(sit ? 0.5 : 0.93), 0);
  add(cyl(S(0.2), S(0.16), S(0.58), c, 0, 0, 0, run ? 0.2 : 0, 0, 0, 10), 0, S(sit ? 0.86 : 1.3), 0);
  add(box(S(0.5), S(0.12), S(0.24), c), 0, S(sit ? 1.1 : 1.55), 0);
  add(cyl(S(0.055), S(0.045), S(0.62), c, 0, 0, 0, run ? -0.8 : 0, 0, pose === 'wave' ? 2.6 : 0.12, 8), S(-0.27), S(sit ? 0.86 : pose === 'wave' ? 1.82 : 1.28), 0);
  add(cyl(S(0.055), S(0.045), S(0.62), c, 0, 0, 0, run ? 0.8 : 0, 0, -0.12, 8), S(0.27), S(sit ? 0.86 : 1.28), 0);
  add(cyl(S(0.06), S(0.07), S(0.12), c), 0, S(sit ? 1.2 : 1.66), 0);
  add(sph(S(0.13), c, 0, 0, 0, 1, 1.15, 1.05), 0, S(sit ? 1.36 : 1.82), 0);
  return P;
}
const plinth = (w, h, c = GRANITE) => [box(w, h, w, c, 0, h / 2, 0), box(w + 0.3, 0.18, w + 0.3, c, 0, 0.09, 0), box(w + 0.15, 0.12, w + 0.15, c, 0, h - 0.06, 0)];

// ---------- the famous ones (matched by name) ----------
const FAMOUS = [
  [/^Engagement$/i, () => mesh([box(3, 0.6, 3, GRANITE, 0, 0.3, 0), tor(3.2, 0.42, STEEL, -1.4, 3.9, 0, 0, 0.5, 0), tor(3.2, 0.42, STEEL, 1.4, 3.9, 0, 0, -0.5, 0), part(new THREE.OctahedronGeometry(1.1, 0), '#e8f6ff', -1.4, 7.6, 0, 0, 0.4, 0, 1, 1.3, 1)], 'steel'), 'Two giant interlocking engagement rings by Dennis Oppenheim (Sunset Beach). The diamond on top is the size of a small car.'],
  [/Trans Am Totem/i, () => { const P = [cyl(1.3, 1.5, 3.2, CEDAR, 0, 1.6, 0, 0, 0, 0, 14)]; ['#b91c1c', '#1f2937', '#e5e7eb', '#1d4ed8', '#f59e0b'].forEach((c, i) => { const ox = i % 2 ? 0.4 : -0.3, y = 3.75 + i * 1.25, L = 4.6 - i * 0.3, ry = i * 0.5, cs = Math.cos(ry), sn = Math.sin(ry);
        P.push(box(L, 0.8, 1.9, c, ox, y, 0, 0.05 * (i % 2 ? 1 : -1), ry, 0.06), box(L * 0.5, 0.45, 1.7, '#9fb7c9', ox, y + 0.6, 0, 0, ry, 0));   // crushed body + squashed glass cabin
        for (const [wx, wz] of [[-L * 0.32, 0.95], [L * 0.32, 0.95], [-L * 0.32, -0.95], [L * 0.32, -0.95]]) P.push(cyl(0.38, 0.38, 0.25, '#111', ox + wx * cs + wz * sn, y - 0.35, -wx * sn + wz * cs, Math.PI / 2, ry, 0, 10)); }); return mesh(P, 'paint'); }, 'Marcus Bowcott\'s stack of five real crushed cars on a cedar stump, by the Georgia viaduct: a "totem" to car culture.'],
  [/Killer Whale|Chief of the Undersea/i, () => mesh([cyl(3.4, 3.6, 0.8, '#5b7a8a', 0, 0.4, 0, 0, 0, 0, 24), sph(1.4, '#1f3a34', 0, 4, 0, 1, 1, 3.2, 18), part(new THREE.ConeGeometry(0.6, 2.6, 8), '#1f3a34', 0, 6, -0.6, -0.25), part(new THREE.ConeGeometry(0.9, 1.6, 6).rotateX(Math.PI / 2), '#1f3a34', 0, 3.4, -4.6, 0.6, 0, 0, 2, 0.4, 1), box(1.8, 0.2, 0.9, '#1f3a34', -1.2, 3.2, 1, 0, 0, 0.5), box(1.8, 0.2, 0.9, '#1f3a34', 1.2, 3.2, 1, 0, 0, -0.5), cyl(0.4, 0.5, 2.4, '#1f3a34', 0, 1.8, -1)], 'bronze'), 'Bill Reid\'s bronze "Chief of the Undersea World", a leaping killer whale at the Vancouver Aquarium. Bill Reid was a master Haida artist.'],
  [/^The Crab$/i, () => { const P = [cyl(4, 4.2, 0.5, '#5b7a8a', 0, 0.25, 0, 0, 0, 0, 28), sph(2.2, STEEL, 0, 2.6, 0, 1.4, 0.45, 1)]; for (const s of [-1, 1]) for (let i = 0; i < 3; i++) P.push(cyl(0.16, 0.12, 3, STEEL, s * 3.4, 1.4, -1 + i * 1.1, 0, 0, s * 0.7)); for (const s of [-1, 1]) P.push(cyl(0.2, 0.18, 2.4, STEEL, s * 1.4, 3.4, 2.6, -0.9), sph(0.7, STEEL, s * 1.6, 4.4, 3.6, 1, 0.6, 1.4)); return mesh(P, 'steel'); }, 'George Norris\'s giant stainless-steel crab guards the H.R. MacMillan Space Centre. Legend says it protects the harbour.'],
  [/Lumberman's Arch/i, () => mesh([cyl(1.1, 1.2, 9, '#8a6a4a', -7, 4.5, 0, 0, 0, 0, 14), cyl(1.1, 1.2, 9, '#8a6a4a', 7, 4.5, 0, 0, 0, 0, 14), cyl(1.3, 1.3, 19, '#9b7a55', 0, 9.6, 0, 0, 0, Math.PI / 2, 16), cyl(0.6, 0.6, 7, '#8a6a4a', -4.4, 6.8, 0, 0, 0, 0.9, 10), cyl(0.6, 0.6, 7, '#8a6a4a', 4.4, 6.8, 0, 0, 0, -0.9, 10)]), 'A single giant cedar log on log legs in Stanley Park, honouring the workers of the forest industry.'],
  [/Millennium Gate/i, () => { const P = []; for (const s of [-1, 1]) P.push(box(1.2, 8, 1.2, '#b91c1c', s * 5, 4, 0), box(2, 0.6, 2, GRANITE, s * 5, 0.3, 0)); P.push(box(12, 1.2, 1.4, '#b91c1c', 0, 8.4, 0), box(12.5, 0.4, 2.2, '#f4c430', 0, 9.1, 0), part(new THREE.ConeGeometry(8, 1.8, 4, 1), '#166534', 0, 10.1, 0, 0, Math.PI / 4, 0, 1, 1, 0.32), box(10, 0.3, 0.2, '#f4c430', 0, 7.3, 0.72), part(new THREE.ConeGeometry(4.5, 1.4, 4, 1), '#166534', 0, 11.6, 0, 0, Math.PI / 4, 0, 1, 1, 0.38)); return mesh(P, 'paint'); }, 'The Chinatown Millennium Gate on Pender Street, opened in 2002: red pillars, gold trim and green tiled roofs.'],
  [/Love in the Rain/i, () => { const P = [box(2.4, 0.4, 1, GRANITE, 0, 0.2, 0)]; for (let i = 0; i < 40; i++) { const t = i / 40 * Math.PI * 2, x = 16 * Math.sin(t) ** 3 / 16 * 1.6, y = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16 * 1.6 + 2.6; P.push(sph(0.13, BLACK, x, y, 0)); if (i % 2) P.push(box(0.14, 0.18, 0.06, COLS[i % COLS.length], x, y - 0.18, 0.1)); } P.push(cyl(0.08, 0.08, 1.2, BLACK, 0, 0.9, 0)); return mesh(P, 'paint'); }, 'A heart made for "love locks": couples clip a padlock on it instead of on bridges (which the city kept having to cut off).'],
  [/Knife Edge/i, () => mesh([box(4, 0.6, 2, GRANITE, 0, 0.3, 0), sph(1.6, BRONZE, -0.9, 2.6, 0, 0.5, 1.4, 1.1), sph(1.4, BRONZE, 1.1, 2.3, 0.2, 0.5, 1.3, 1, 18)], 'bronze'), 'Henry Moore\'s bronze "Knife Edge Two Piece" (1962): two curved blade-like halves that seem to lean toward each other.'],
  [/Photo Session/i, () => mesh([...figure(BRONZE, 0, 1, 'stand', -1.2, 0, 0), ...figure(BRONZE, 0, 0.75, 'wave', -0.4, 0.2, 0), ...figure(BRONZE, 0, 1.05, 'stand', 0.5, 0, 0), ...figure(BRONZE, 0, 0.95, 'sit', 2.6, 4, Math.PI), box(0.3, 0.22, 0.2, BLACK, 2.6, 1.3, 3.6)], 'bronze'), 'Bronze tourists posing for a photographer who is also bronze, by Dennis Oppenheim\'s neighbour in spirit, J. Seward Johnson. Stand in and join the photo.'],
  [/900 Oranges/i, () => { const P = [box(4, 0.3, 4, GRANITE, 0, 0.15, 0)]; for (let i = 0; i < 90; i++) { const a = hash2(i, 3) * 6.28, r = hash2(i, 7) * 1.6, h = (1.6 - r) * 0.8; P.push(sph(0.22, '#f97316', Math.cos(a) * r, 0.5 + h * hash2(i, 9), Math.sin(a) * r, 1, 1, 1, 8)); } return mesh(P, 'paint'); }, 'A pile of oranges (yes, really). One of the playful pieces scattered around Queen Elizabeth Park\'s plaza.'],
  [/Ben Franklin/i, () => mesh([sph(2.4, '#f2f2f0', 0, 2.4, 0, 1, 1, 4.2, 18), box(2, 2, 3.2, '#f2f2f0', 0, 4.6, 0), cyl(0.2, 0.2, 1.4, BLACK, 0, 6.2, 0.6), ...[-6, -3, 0, 3, 6].map(z => sph(0.3, '#1e3a8a', 2.35, 2.6, z, 0.3, 1, 1)), box(4, 1.2, 1, '#6b7280', -2, 0.6, 0), box(4, 1.2, 1, '#6b7280', 2, 0.6, 0)], 'paint'), 'The Ben Franklin, a real 1968 research submarine that drifted 2,400 km under the Gulf Stream for a month. Now resting at the Maritime Museum.'],
  [/Centennial Rocket/i, () => mesh([...plinth(2, 1), cyl(0.7, 0.9, 7, STEEL, 0, 4.5, 0, 0, 0, 0, 16), part(new THREE.ConeGeometry(0.7, 2.4, 16), '#d62828', 0, 9.2, 0), ...[0, 1, 2, 3].map(i => box(0.1, 1.8, 1.2, '#d62828', Math.cos(i * 1.57) * 0.9, 1.9, Math.sin(i * 1.57) * 0.9, 0, -i * 1.57, 0))], 'steel'), 'A shiny 1960s rocket for Canada\'s 100th birthday (1967). It has never left the ground, but it believes.'],
  [/Abacus/i, () => { const P = [box(5, 0.4, 0.6, BLACK, 0, 0.2, 0), box(0.3, 4, 0.6, BLACK, -2.5, 2, 0), box(0.3, 4, 0.6, BLACK, 2.5, 2, 0), box(5.3, 0.3, 0.6, BLACK, 0, 4, 0), box(5, 0.15, 0.6, BLACK, 0, 2.9, 0)]; for (let r = 0; r < 6; r++) { P.push(cyl(0.04, 0.04, 3.8, STEEL, 0, 0.8 + r * 0.5 - (r > 3 ? -0.2 : 0), 0, 0, 0, Math.PI / 2)); for (let k = 0; k < 5; k++) P.push(sph(0.2, r % 2 ? '#b91c1c' : '#f4c430', -1.6 + k * 0.45 + (r * 0.37 % 1) * 0.8, 0.8 + r * 0.5 + (r > 3 ? 0.2 : 0), 0, 1.4, 1, 1, 10)); } return mesh(P, 'paint'); }, 'A giant abacus, nodding to the generations who counted on them in Chinatown\'s shops.'],
  [/Cenotaph/i, () => mesh([box(7, 0.5, 7, GRANITE, 0, 0.25, 0), box(5, 0.6, 5, GRANITE, 0, 0.8, 0), cyl(0.5, 1.4, 10, '#b8b2a6', 0, 6, 0, 0, Math.PI / 4, 0, 4), box(1.4, 1, 0.1, BRONZE, 0, 2.2, 1.0)]), 'Victory Square Cenotaph (1924): Vancouver\'s main war memorial, where the Remembrance Day ceremony is held every November 11.'],
  [/Angel of Victory/i, () => mesh([...plinth(2.2, 2.6, '#9c978d'), ...figure(BRONZE, 2.6, 1.5, 'stand', -0.3, 0, 0), ...figure(BRONZE, 2.6, 1.15, 'wave', 0.5, 0.2, 0), box(0.1, 2.4, 1.4, BRONZE, -0.6, 4.6, -0.6, 0, 0.6, 0.3), box(0.1, 2.4, 1.4, BRONZE, 0, 4.6, -0.7, 0, -0.6, -0.3)], 'bronze'), 'An angel carrying a soldier up to heaven, outside Waterfront Station: the CPR\'s memorial to its staff who died in the World Wars.'],
  [/Inukshuk/i, () => mesh([box(1.6, 1.8, 0.9, GRANITE, -1.1, 0.9, 0), box(1.6, 1.8, 0.9, GRANITE, 1.1, 0.9, 0), box(4.6, 0.9, 1.1, '#7c776f', 0, 2.25, 0), box(2.2, 1.6, 1, GRANITE, 0, 3.5, 0), box(6.4, 0.8, 1, '#7c776f', 0, 4.7, 0), box(1.6, 1.4, 1, GRANITE, 0, 5.8, 0)]), 'An Inuksuk: a stone figure of the kind Inuit build to guide travellers. "Someone was here, you are on the right path."'],
];
// historic markers that are really whole buildings / boats already in the city (don't add anything)
const SKIP = /^h_(house|theatre|train_station|ruins|village|fort|yes|wreck|object|artifact|tomb|vehicle)$/;

// ---------- generic kinds, made big and clear ----------
function statue(h, seed) {
  const metal = h < 0.7, c = metal ? (h < 0.35 ? BRONZE : VERD) : '#d9d5cc', sc = 1.35 + hash2(seed, 2) * 0.35;
  const pose = ['stand', 'wave', 'stand', 'run', 'sit'][Math.floor(hash2(seed, 5) * 5)];
  const P = [...plinth(1.6, 1.7, '#9c978d')];
  if (pose === 'sit') P.push(box(1.2, 0.55, 0.8, c, 0, 1.7 + 0.28 * sc, 0.1));
  P.push(...figure(c, 1.7, sc, pose));
  return { m: mesh(P, metal ? 'bronze' : 'stone'), r: 1.2 };
}
function bust(h) { return { m: mesh([...plinth(0.9, 1.5, '#9c978d'), box(0.9, 0.42, 0.45, BRONZE, 0, 1.75, 0), cyl(0.09, 0.11, 0.2, BRONZE, 0, 2.02, 0), sph(0.22, BRONZE, 0, 2.3, 0, 1, 1.15, 1.05)], 'bronze'), r: 0.8 }; }
function totem(h, seed) {
  const H = 9 + h * 7, P = [cyl(0.55, 0.62, H, '#6b4a2e', 0, H / 2, 0, 0, 0, 0, 14)], cols = ['#b22222', '#111111', '#1f7a7a', '#f2f2f0'];
  for (let i = 0; i < 6; i++) { const y = 1.2 + i * (H - 2.6) / 6, c = cols[(i + Math.floor(h * 4)) % 4]; P.push(cyl(0.72, 0.7, 0.5, c, 0, y, 0, 0, 0, 0, 14), sph(0.16, '#f2f2f0', -0.28, y + 0.5, 0.58), sph(0.16, '#f2f2f0', 0.28, y + 0.5, 0.58), sph(0.08, '#111', -0.28, y + 0.5, 0.72), sph(0.08, '#111', 0.28, y + 0.5, 0.72), box(0.4, 0.18, 0.45, '#c2410c', 0, y + 0.1, 0.6)); }
  if (hash2(seed, 3) < 0.6) P.push(box(4.2, 0.28, 0.7, '#1f7a7a', 0, H - 0.9, 0, 0, 0, 0.08), box(0.9, 0.9, 1.1, '#b22222', 0, H + 0.2, 0.15), part(new THREE.ConeGeometry(0.35, 0.9, 6).rotateX(Math.PI / 2), '#f4c430', 0, H + 0.1, 1));   // thunderbird on top, wings out
  return { m: mesh(P, 'stone'), r: 0.9 };
}
function abstract(h, seed, scaleUp = 1) {
  const kind = Math.floor(hash2(seed, 11) * 8), H = (4 + hash2(seed, 13) * 5) * scaleUp, c1 = COLS[Math.floor(h * COLS.length)], c2 = COLS[Math.floor(hash2(seed, 17) * COLS.length)];
  const P = [box(2.4, 0.5, 2.4, '#8a857c', 0, 0.25, 0)]; let mat = 'paint';
  if (kind === 0) P.push(tor(H * 0.4, 0.28, c1, 0, 0.5 + H * 0.45, 0, 0, 0, 0), tor(H * 0.28, 0.22, c2, 0, 0.5 + H * 0.45, 0, 0, Math.PI / 2, 0));   // nested rings
  if (kind === 1) for (let i = 0; i < 5; i++) P.push(box(1.1 - i * 0.1, H / 5, 1.1 - i * 0.1, i % 2 ? c1 : c2, Math.sin(i * 1.7) * 0.35, 0.5 + (i + 0.5) * H / 5, Math.cos(i * 1.3) * 0.3, 0, i * 0.45, 0.12 * (i % 2 ? 1 : -1)));   // twisted stack
  if (kind === 2) { P.push(sph(H * 0.3, STEEL, 0, 0.5 + H * 0.5, 0, 1, 1, 1, 24), cyl(0.18, 0.3, H * 0.25, STEEL, 0, 0.5 + H * 0.1, 0)); mat = 'steel'; }   // mirror sphere
  if (kind === 3) for (let i = 0; i < 4; i++) P.push(part(new THREE.ConeGeometry(0.9 - i * 0.12, H * (1 - i * 0.18), 4), i % 2 ? c1 : '#e2e8f0', (i - 1.5) * 0.7, 0.5 + H * (1 - i * 0.18) / 2, (i % 2) * 0.5, 0, i * 0.7, (i - 1.5) * 0.12));   // crystal shards
  if (kind === 4) { for (let i = 0; i < 9; i++) P.push(cyl(0.11, 0.11, H, STEEL, Math.cos(i * 0.7) * 0.9, 0.5 + H / 2, Math.sin(i * 0.7) * 0.9, Math.sin(i) * 0.3, 0, Math.cos(i) * 0.3)); mat = 'steel'; }   // bundle of rods
  if (kind === 5) for (let i = 0; i < 14; i++) P.push(box(2.6, 0.22, 0.45, i % 3 ? c1 : c2, 0, 0.6 + i * H / 14, 0, 0, i * 0.4, 0));   // spiral staircase of bars
  if (kind === 6) { P.push(tor(H * 0.45, 0.45, c1, 0, 0.5, 0, 0, 0, 0, Math.PI)); }   // great arch
  if (kind === 7) { P.push(sph(1.1, BRONZE, -0.9, 1.4, 0, 1.6, 0.8, 1), sph(0.9, BRONZE, 0.9, 1.6, 0.2, 1, 1.3, 0.9), sph(0.7, BRONZE, 0.1, 2.5, 0, 1.2, 0.8, 0.9)); mat = 'bronze'; }   // Moore-style reclining forms
  return { m: mesh(P, mat), r: kind === 6 ? 0.6 : 1.4 };
}
function memorial(t, h, seed) {
  if (t === 'h_cannon') return { m: mesh([cyl(0.2, 0.3, 2.6, BLACK, 0, 1.1, 0.2, Math.PI / 2 - 0.15), cyl(0.6, 0.6, 0.12, '#5a4030', -0.5, 0.6, 0, 0, 0, Math.PI / 2, 16), cyl(0.6, 0.6, 0.12, '#5a4030', 0.5, 0.6, 0, 0, 0, Math.PI / 2, 16), box(0.9, 0.3, 1.4, '#5a4030', 0, 0.55, -0.3)], 'bronze'), r: 1 };
  if (t === 'h_bell') return { m: mesh([box(0.3, 3.2, 0.3, CEDAR, -1.2, 1.6, 0), box(0.3, 3.2, 0.3, CEDAR, 1.2, 1.6, 0), box(2.8, 0.35, 0.5, CEDAR, 0, 3.3, 0), part(new THREE.CylinderGeometry(0.35, 0.75, 1.2, 16, 1, true), BRONZE, 0, 2.4, 0)], 'bronze'), r: 1.2 };
  if (t === 'h_locomotive' || t === 'h_railway_car' || t === 'h_railway') return { m: mesh([box(2.9, 2.8, 13, t === 'h_locomotive' ? BLACK : '#5a2a1f', 0, 2.2, 0), cyl(1.2, 1.2, 7, BLACK, 0, 2.6, 2.5, Math.PI / 2), cyl(0.35, 0.45, 1.4, BLACK, 0, 4.4, 5), box(2.6, 0.6, 12, '#222', 0, 0.5, 0), ...[-4, -1.5, 1.5, 4].flatMap(z => [cyl(0.7, 0.7, 0.2, '#b91c1c', -1.4, 0.8, z, 0, 0, Math.PI / 2), cyl(0.7, 0.7, 0.2, '#b91c1c', 1.4, 0.8, z, 0, 0, Math.PI / 2)])], 'paint'), r: 1.6 };
  if (t === 'lighthouse' || t === 'h_lighthouse') return { m: mesh([cyl(1.6, 2, 9, '#f4f1e8', 0, 4.5, 0, 0, 0, 0, 16), cyl(1.2, 1.2, 1.4, '#c53030', 0, 9.7, 0, 0, 0, 0, 16), cyl(0.2, 1.4, 1, '#c53030', 0, 10.9, 0, 0, 0, 0, 16)]), r: 2 };
  if (t === 'h_ship') return { m: mesh([sph(2.4, '#f2f2f0', 0, 2.4, 0, 1, 1, 4.2)], 'paint'), r: 3 };
  if (t === 'h_wayside_cross') return { m: mesh([box(0.3, 4, 0.3, '#d9d5cc', 0, 2, 0), box(1.6, 0.3, 0.3, '#d9d5cc', 0, 3, 0)]), r: 0.4 };
  const k = Math.floor(hash2(seed, 21) * 4);
  if (t === 'h_memorial' && /plaque|milestone|boundary|sign/.test(t) || k === 3 && t === 'h_memorial')   // lectern with a big bronze plaque
    return { m: mesh([box(1.4, 1, 0.5, GRANITE, 0, 0.5, 0), box(1.2, 0.8, 0.08, BRONZE, 0, 1.15, 0.12, -0.6)], 'bronze'), r: 0.8 };
  if (k === 0 || t === 'obelisk') return { m: mesh([box(2.6, 0.5, 2.6, GRANITE, 0, 0.25, 0), box(1.6, 1, 1.6, GRANITE, 0, 1, 0), cyl(0.25, 0.75, 7, '#b8b2a6', 0, 5, 0, 0, Math.PI / 4, 0, 4), part(new THREE.ConeGeometry(0.36, 0.7, 4), '#b8b2a6', 0, 8.85, 0, 0, Math.PI / 4, 0), box(1.0, 0.7, 0.06, BRONZE, 0, 1.1, 0.81)]), r: 1.4 };   // obelisk
  if (k === 1) return { m: mesh([box(3.4, 0.4, 1.6, GRANITE, 0, 0.2, 0), box(3, 2.2, 0.8, GRANITE, 0, 1.5, 0), box(2.2, 1.2, 0.06, BRONZE, 0, 1.6, 0.42), part(new THREE.CylinderGeometry(1.5, 1.5, 0.8, 16, 1, false, 0, Math.PI), GRANITE, 0, 2.6, 0, Math.PI / 2, 0, 0, 1, 1, 0.5)]), r: 1.8 };   // headstone wall
  return { m: mesh([...plinth(1.8, 2.2, '#9c978d'), sph(0.7, BRONZE, 0, 2.9, 0, 1, 0.6, 1), box(1.1, 0.7, 0.06, BRONZE, 0, 1.2, 0.93), ...[-1.5, 1.5].map(x => sph(0.5, '#2f855a', x, 0.4, 1.4, 1, 0.7, 1))], 'bronze'), r: 1.4 };   // monument with an urn + shrubs
}
function fountain(h, seed) {
  const big = hash2(seed, 31) < 0.5, R = big ? 4.2 : 3;
  const g = group(mesh([cyl(R, R + 0.2, 0.7, STONE, 0, 0.35, 0, 0, 0, 0, 28), cyl(R - 0.3, R - 0.3, 0.1, '#2c6e85', 0, 0.62, 0, 0, 0, 0, 28), cyl(0.35, 0.5, 1.8, STONE, 0, 1.3, 0), cyl(1.4, 0.7, 0.3, STONE, 0, 2.2, 0, 0, 0, 0, 18), ...(big ? [cyl(0.2, 0.3, 1.2, STONE, 0, 2.9, 0), cyl(0.8, 0.4, 0.22, STONE, 0, 3.5, 0, 0, 0, 0, 16)] : [])]));
  const jet = new THREE.Mesh(new THREE.ConeGeometry(0.6, 2.8, 12, 1, true).translate(0, 1.4, 0), new THREE.MeshStandardMaterial({ color: '#d6eef5', transparent: true, opacity: 0.55, roughness: 0.1, depthWrite: false }));
  jet.position.y = big ? 3.6 : 2.35; g.add(jet); g.userData.jet = jet; return { m: g, r: R };
}

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
  g.add(mesh([box(0.12, 1.1, 0.12, '#3d4247', 0, 0.55, 0)], 'bronze'));
  const f = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.2 })); f.position.set(0, 1.2, 0.08); f.rotation.x = -0.35; g.add(f);
  const back = new THREE.Mesh(new THREE.BoxGeometry(1.16, 0.6, 0.05), MAT.bronze); back.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(back.geometry.attributes.position.count * 3).fill(0.35), 3)); back.position.set(0, 1.2, 0.04); back.rotation.x = -0.35; g.add(back);
  return g;
}

export const ART_NAMES = { sculpture: 'Sculpture', statue: 'Statue', bust: 'Bust', mural: 'Mural', installation: 'Art installation', totem_pole: 'Totem pole', relief: 'Relief', mosaic: 'Mosaic', stone: 'Stone sculpture', fountain: 'Fountain', h_memorial: 'Memorial', h_monument: 'Monument', h_plaque: 'Historic plaque', obelisk: 'Obelisk', lighthouse: 'Lighthouse', h_railway_car: 'Historic railway car', h_locomotive: 'Historic locomotive', h_cannon: 'Historic cannon', h_bell: 'Historic bell', carving: 'Wood carving', woodcarving: 'Wood carving', street_art: 'Street art', graffiti: 'Graffiti', painting: 'Painting', h_ship: 'Historic ship' };
export const kindName = a => ART_NAMES[a.t] || ART_NAMES[String(a.t).toLowerCase()] || (a.t.startsWith('h_') ? 'Historic site' : 'Public art');
export const famousFact = a => { const n = a.n >= 0 ? M.names[a.n] : ''; const f = n && FAMOUS.find(F => F[0].test(n)); return f ? f[2] : ''; };

// build one piece: returns a Group positioned in the world (or null), plus its footprint radius in userData.r
export function buildArt(a) {
  const t = String(a.t).toLowerCase(), h = hash2(a.x, a.z), seed = a.x * 0.37 + a.z * 1.3, name = a.n >= 0 ? M.names[a.n] : '';
  if (SKIP.test(t)) return null;
  let res = null;
  const fam = name && FAMOUS.find(F => F[0].test(name));
  if (fam) res = { m: fam[1](), r: 3 };
  if (fam && /Millennium Gate/i.test(name)) {   // the gate stands ACROSS Pender Street
    const nr = nearestRoad(a.x, a.z, 40, r => r.t <= 6);
    if (nr) { const e = nr.e, ax = NX(e.a), az = NZ(e.a), dx = NX(e.b) - ax, dz = NZ(e.b) - az, L = Math.hypot(dx, dz) || 1, cx = ax + dx * nr.t, cz = az + dz * nr.t;
      res.m.scale.x = (nr.road.w + 3) / 10; res.m.position.set(cx, surfaceY(cx, cz), cz); res.m.rotation.y = Math.atan2(dx / L, dz / L);
      const g = new THREE.Group(); g.add(res.m); g.userData.r = 0; return g; }
  }
  else if (/mural|street_art|graffiti|painting|mosaic/.test(t)) res = mural(a);
  else if (t === 'statue') res = statue(h, seed);
  else if (t === 'bust') res = bust(h);
  else if (/totem/.test(t) || /carving/.test(t)) res = totem(h, seed);
  else if (t === 'fountain') res = fountain(h, seed);
  else if (t.startsWith('h_') || t === 'obelisk' || t === 'lighthouse') res = memorial(t, h, seed);
  else if (t === 'stone') res = { m: mesh([part(new THREE.IcosahedronGeometry(1.6, 1), GRANITE, 0, 1.2, 0, 0, 0, 0, 1.4, 0.9, 1)]), r: 1.8 };
  else res = abstract(h, seed, t === 'installation' ? 1.2 : 1);
  if (!res) return null;
  const g = res.placed && !name ? res.m : new THREE.Group();
  if (g !== res.m) {
    if (res.placed) g.add(res.m);   // murals are already in world coordinates
    else { res.m.position.set(a.x, surfaceY(a.x, a.z), a.z); res.m.rotation.y = h * 6.28; g.add(res.m); }
    if (name && !/^(plaque|war_memorial|totem_pole|ghost_bike)$/i.test(name)) {   // the name plaque, in front of the piece
      const ang = hash2(a.z, a.x) * 6.28, d = (res.wall ? 1.4 : (res.r || 1) + 1.6);
      let px = a.x + Math.sin(ang) * d, pz = a.z + Math.cos(ang) * d;
      if (res.wall) { px = res.m.position.x + Math.sin(res.m.rotation.y) * 1.4; pz = res.m.position.z + Math.cos(res.m.rotation.y) * 1.4; }
      const pq = plaque(name, kindName(a)); pq.position.set(px, surfaceY(px, pz), pz); pq.rotation.y = res.wall ? res.m.rotation.y : ang; g.add(pq);
    }
  }
  g.userData.r = res.r || 0; g.userData.jet = res.m.userData?.jet; g.userData.wall = !!res.wall;
  return g;
}
