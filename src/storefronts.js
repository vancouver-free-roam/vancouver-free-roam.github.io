// Shop fronts: every café, restaurant, bar and shop from the map gets a glass front, an awning and a name board on the
// wall of its real building. Big chains get parody signs. Cafés and restaurants get sidewalk patios with people eating.
// Everything is instanced and only built near the player (rebuilt as you move).
import * as THREE from 'three';
import { G, scene, std, canvasTex, hash2, inPoly } from './core.js';
import { pois, nearBuildings, nearestRoad, isDriveType, surfaceY, buildingAt } from './city.js';
import { isWater } from './terrain.js';
import { setColliders, fromInstances } from './colliders.js';

const M = window.MAP;
// ---------- parody chains (never the real logos) ----------
const CHAINS = [
  [/mcdonald/i, "McDougal's", '#da291c', '#ffc72c', 'M'], [/starbucks/i, 'Starbeans Coffee', '#00704a', '#ffffff', '★'],
  [/tim horton/i, 'Tim Horbits', '#c8102e', '#ffffff', '🍩'], [/subway/i, 'Subwaze', '#008938', '#ffc600', '🥖'],
  [/^a ?& ?w\b|a&w/i, 'B&W Burgers', '#f37021', '#4a230b', '🍔'], [/wendy/i, "Windy's", '#e2203a', '#ffffff', '🌬️'],
  [/burger king/i, 'Burger Prince', '#f5ebdc', '#d62300', '👑'], [/kfc|kentucky/i, 'Kentucky Fried Goose', '#a3080c', '#ffffff', '🪿'],
  [/domino/i, "Dominowhoa's", '#006491', '#ffffff', '🎲'], [/pizza hut/i, 'Pizza Hutch', '#ee3124', '#ffffff', '🍕'],
  [/7-?eleven|seven eleven/i, '6-Twelve', '#ffffff', '#008061', '🏪'], [/shoppers drug/i, 'Shoppers Rug Mart', '#e31837', '#ffffff', '💊'],
  [/london drugs/i, 'London Shrugs', '#003da5', '#ffffff', '🤷'], [/save-?on/i, 'Save-Some-Foods', '#e21a23', '#ffffff', '🛒'],
  [/safeway/i, 'Safe-ish-way', '#e21836', '#ffffff', '🛒'], [/whole foods/i, 'Hole Foods', '#00674b', '#ffffff', '🥬'],
  [/dairy queen/i, 'Dairy Princess', '#ee3e42', '#ffffff', '🍦'], [/canadian tire/i, 'Canadian Tired', '#d71920', '#ffffff', '😴'],
  [/chevron/i, 'Chevroff', '#0054a4', '#ffffff', '⛽'], [/petro-?canada/i, 'Petro-Canadeh', '#da291c', '#ffffff', '⛽'], [/\besso\b/i, 'Ess-Oh', '#0047ba', '#ffffff', '⛽'],
  [/blenz/i, 'Blendz Coffee', '#4a2c2a', '#f2c14e', '☕'], [/jj bean/i, 'JJ Beanz', '#1d1d1b', '#ffffff', '☕'], [/waves coffee/i, 'Wavez Coffee', '#0f4c81', '#ffffff', '☕'],
  [/booster juice/i, 'Booster Joose', '#6cb33f', '#ffffff', '🥤'], [/chipotle/i, 'Chipotle-ish', '#451400', '#ffffff', '🌯'], [/\bh ?& ?m\b/i, 'H&Mmm', '#cc071e', '#ffffff', '👕'],
  [/lululemon/i, 'Lululemony', '#c53030', '#ffffff', '👖'], [/winners/i, 'Winnerz', '#ffffff', '#b0161c', '🏆'], [/uniqlo/i, 'Unicorno', '#e60012', '#ffffff', '🦄'],
  [/royal bank|\brbc\b/i, 'Royal Bank of Canoe', '#005daa', '#ffd200', '🛶'], [/\btd\b|toronto.dominion|td canada trust/i, 'TD: Totally Dollars', '#008a00', '#ffffff', '💵'], [/scotiabank/i, 'Scotchabank', '#ec111a', '#ffffff', '🥃'],
  [/\bbmo\b|bank of montreal/i, 'BMOney', '#0079c1', '#ffffff', '💰'], [/cibc/i, 'CIBCeeya', '#c41f3e', '#e8c26a', '👋'], [/vancity/i, 'Vancitty', '#e2231a', '#ffffff', '🐱'], [/hsbc/i, 'HSBeeSee', '#db0011', '#ffffff', '🐝'],
  [/coast capital/i, 'Coast Capitalism', '#00a3ad', '#ffffff', '🌊'], [/canada post|postes canada/i, 'Canada Pest', '#d52b1e', '#ffffff', '📮'], [/rexall/i, 'Rexhaul Pharmacy', '#004b8d', '#ffffff', '💊'], [/pharmasave/i, 'PharmaShave', '#e31837', '#ffffff', '💊'],
  [/cobs bread/i, 'Cobz Bread', '#6b3e26', '#f5e6c8', '🥖'], [/nando/i, "Nandude's", '#d20a11', '#ffffff', '🐓'], [/earls/i, 'Earls-ish', '#1d1d1b', '#c9a25b', '🍽️'],
];
const SHELL = [/^shell$/i, 'Shellfish Gas', '#fbce07', '#dd1d21', '🐚'];
const CUISINE = { sushi: ['🍣', '#1d2b4a', '#ffffff'], japanese: ['🍣', '#1d2b4a', '#ffffff'], ramen: ['🍜', '#1d2b4a', '#ffffff'], chinese: ['🥟', '#b71c1c', '#ffd54f'], dim_sum: ['🥟', '#b71c1c', '#ffd54f'],
  pizza: ['🍕', '#1b5e20', '#ffffff'], italian: ['🍝', '#1b5e20', '#ffffff'], indian: ['🍛', '#7b1f1f', '#ffb300'], vietnamese: ['🍜', '#2e5d3a', '#ffe082'], thai: ['🍜', '#4a148c', '#ffd54f'],
  mexican: ['🌮', '#e65100', '#ffffff'], burger: ['🍔', '#c62828', '#ffd54f'], korean: ['🍲', '#263238', '#ff8a65'], greek: ['🥙', '#0d47a1', '#ffffff'], seafood: ['🦞', '#01579b', '#ffffff'],
  french: ['🥐', '#1a237e', '#ffffff'], sandwich: ['🥪', '#5d4037', '#ffffff'], coffee_shop: ['☕', '#3e2b20', '#f3e3c8'], breakfast: ['🍳', '#f9a825', '#3e2723'], ice_cream: ['🍦', '#f8bbd0', '#6a1b4d'] };
const KIND = { cafe: ['☕', '#3e2b20', '#f3e3c8', ['#2f5d3a', '#6b3e26', '#1d3b4a', '#8a6a3a']], restaurant: ['🍽️', '#4a1c1c', '#ffffff', ['#8b1e1e', '#1f3d5a', '#2f5d3a', '#c79a3b', '#3b3b3b']],
  fast_food: ['🍔', '#c62828', '#ffd54f', ['#ffb300', '#c62828']], bar: ['🍹', '#1b3a2a', '#e8d29a', ['#1b3a2a', '#3b2414']], pub: ['🍺', '#3b2414', '#e8d29a', ['#1b3a2a', '#3b2414', '#5a1f1f']],
  ice_cream: ['🍦', '#f8bbd0', '#6a1b4d', ['#f48fb1', '#81d4fa']], shop: ['🛍️', '#263238', '#ffffff', ['#00838f', '#6a1b9a', '#c62828', '#2e7d32', '#ef6c00', '#37474f', '#ad1457']],
  fuel: ['⛽', '#ffffff', '#c62828', ['#c62828']], bicycle_rental: null,
  bank: ['🏦', '#1f3a5f', '#ffffff', ['#1f3a5f', '#2c5282']], pharmacy: ['💊', '#ffffff', '#2f855a', ['#2f855a']], clinic: ['🩺', '#ffffff', '#c53030', ['#e2e8f0']], doctors: ['🩺', '#ffffff', '#c53030', ['#e2e8f0']],
  dentist: ['🦷', '#ffffff', '#2b6cb0', ['#bee3f8']], post_office: ['📮', '#d52b1e', '#ffffff', ['#d52b1e']], veterinary: ['🐾', '#ffffff', '#2f855a', ['#68d391']], car_wash: ['🚿', '#2b6cb0', '#ffffff', ['#2b6cb0']],
  office: ['🏢', '#2d3748', '#e2e8f0', ['#2d3748', '#4a5568']], craft: ['🔨', '#5a4030', '#f3e3c8', ['#6b4f3a']], marketplace: ['🧺', '#2f855a', '#ffffff', ['#c53030', '#2f855a', '#d69e2e']],
  community_centre: ['🏛️', '#2c5282', '#ffffff', ['#2c5282']], library: ['📚', '#2f4858', '#ffffff', ['#2f4858']], townhall: ['🏛️', '#1a365d', '#ffffff', ['#1a365d']], courthouse: ['⚖️', '#1a365d', '#ffffff', ['#1a365d']],
  fire_station: ['🚒', '#c53030', '#ffffff', ['#c53030']], police: ['🚓', '#1a365d', '#ffffff', ['#1a365d']], school: ['🏫', '#2f855a', '#ffffff', ['#2f855a']], kindergarten: ['🧸', '#ed64a6', '#ffffff', ['#f6ad55']],
  childcare: ['🧸', '#ed64a6', '#ffffff', ['#f6ad55']], college: ['🎓', '#1a365d', '#ffffff', ['#1a365d']], university: ['🎓', '#1a365d', '#ffffff', ['#1a365d']], cinema: ['🎬', '#1a1a1a', '#f6e05e', ['#c53030']],
  theatre: ['🎭', '#5a1f1f', '#f6e05e', ['#5a1f1f']], hotel: ['🏨', '#1a202c', '#e8c26a', ['#1a202c']], arts_centre: ['🎨', '#805ad5', '#ffffff', ['#805ad5']], social_facility: ['🤝', '#2c7a7b', '#ffffff', ['#2c7a7b']],
  museum: ['🏛️', '#4a3626', '#f3e3c8', ['#4a3626']], gallery: ['🖼️', '#1a1a1a', '#ffffff', ['#1a1a1a']], nightclub: ['🪩', '#1a1a1a', '#ed64a6', ['#1a1a1a']] };
const EATS = new Set(['cafe', 'restaurant', 'fast_food', 'bar', 'pub', 'ice_cream']);

function styleFor(p) {
  const id = (p.b >= 0 && p.b !== undefined ? M.names[p.b] + ' ' : '') + (p.name || '');
  for (const [re, name, bg, fg, logo] of CHAINS) if (re.test(id)) return { name, bg, fg, logo, awn: bg, chain: true };
  if (p.k === 'fuel' && SHELL[0].test((p.b >= 0 ? M.names[p.b] : p.name) || '')) return { name: SHELL[1], bg: SHELL[2], fg: SHELL[3], logo: SHELL[4], awn: SHELL[2], chain: true };
  const K = KIND[p.k]; if (!K) return null;
  const cu = p.s && CUISINE[String(p.s).split(';')[0]];
  const [logo, bg, fg] = cu || K, h = hash2(p.x, p.z);
  return { name: p.name, bg, fg, logo, awn: K[3][Math.floor(h * K[3].length) % K[3].length] };
}

// ---------- find each shop's wall (the side of its building that faces a street) ----------
const fronts = [];
// Some places are only mapped as a NAMED BUILDING (e.g. the McDonald's by Main Street–Science World station) with no
// shop point inside: give those a shop point too, so they get their signs, glass front and food counter.
const FOODCHAIN = /mcdonald|tim horton|subway|a ?& ?w|wendy|burger king|kfc|kentucky|domino|pizza hut|dairy queen|chipotle|nando|booster juice/i, COFFEECHAIN = /starbucks|blenz|jj bean|waves coffee/i;
function poisFromBuildings() {
  let n = 0;
  for (const b of M.blds) {
    if (!(b.n >= 0)) continue; const name = M.names[b.n]; if (!CHAINS.some(c => c[0].test(name))) continue;
    let cx = 0, cz = 0; const k = b.p.length / 2; for (let i = 0; i < b.p.length; i += 2) { cx += b.p[i]; cz += b.p[i + 1]; } cx /= k; cz /= k;
    if (pois.some(p => Math.abs(p.x - cx) < 45 && Math.abs(p.z - cz) < 45 && (p.name === name || (p.b >= 0 && M.names[p.b] === name)))) continue;
    const kind = FOODCHAIN.test(name) ? 'fast_food' : COFFEECHAIN.test(name) ? 'cafe' : /bank|rbc|td|bmo|cibc|vancity|hsbc|coast capital/i.test(name) ? 'bank' : /drug|pharma|rexall/i.test(name) ? 'pharmacy' : /petro|chevron|esso|shell/i.test(name) ? 'fuel' : 'shop';
    pois.push({ k: kind, n: b.n, x: cx, z: cz, s: kind === 'fast_food' ? 'burger' : undefined, b: b.n, name, fromBld: true }); n++;
  }
  return n;
}
export const fromBuildings = poisFromBuildings();   // runs at load, before shops.js builds its food counters
function placeFronts() {
  const taken = [];
  for (const p of pois) {
    if (!KIND[p.k] && p.k !== 'fuel') continue;
    const st = styleFor(p); if (!st) continue;
    let best = null, bs = 1e9;
    for (const b of nearBuildings(p.x, p.z, 25)) {
      if (b.h < 3.5) continue;
      const P = b.p, n = P.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const ax = P[j * 2], az = P[j * 2 + 1], dx = P[i * 2] - ax, dz = P[i * 2 + 1] - az, L = Math.hypot(dx, dz); if (L < 3.5) continue;
        const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / (L * L))), qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(p.x - qx, p.z - qz);
        if (d > 30 || d >= bs) continue;
        let nx = dz / L, nz = -dx / L; const mx = ax + dx / 2, mz = az + dz / 2; if (inPoly(mx + nx * 0.3, mz + nz * 0.3, P)) { nx = -nx; nz = -nz; }
        const street = nearestRoad(mx + nx * 9, mz + nz * 9, 10, r => r.t <= 6);
        const score = d + (street ? 0 : 14);
        if (score < bs) { bs = score; best = { ax, az, dx: dx / L, dz: dz / L, L, t: t * L, nx, nz }; }
      }
    }
    if (!best || bs > 34) continue;
    const w = Math.max(3, Math.min(best.L - 0.6, p.k === 'fuel' ? 9 : 7)), s = Math.max(w / 2 + 0.3, Math.min(best.L - w / 2 - 0.3, best.t));
    const x = best.ax + best.dx * s + best.nx * 0.02, z = best.az + best.dz * s + best.nz * 0.02;
    if (taken.some(q => Math.hypot(q[0] - x, q[1] - z) < w * 0.8)) continue;
    taken.push([x, z]);
    const y = surfaceY(x + best.nx * 1.2, z + best.nz * 1.2);
    const f = { p, st, x, y, z, w, nx: best.nx, nz: best.nz, tx: best.dx, tz: best.dz, yaw: Math.atan2(best.nx, best.nz), patio: [] , extras: [] };
    // sidewalk patio for places to eat (if there's room between the wall and the street)
    const free = (X, Z) => !buildingAt(X, Z) && !isWater(X, Z) && !(r => r && r.d < r.road.w / 2 + 0.7)(nearestRoad(X, Z, 12, rd => isDriveType(rd.t)));
    const h = hash2(x * 1.3, z * 0.7);
    if (EATS.has(p.k) && (p.os || h < 0.7) && free(x + f.nx * 3.6, z + f.nz * 3.6) && free(x + f.nx * 2.2 + f.tx * w / 3, z + f.nz * 2.2 + f.tz * w / 3)) {
      const nt = Math.max(1, Math.min(3, Math.floor(w / 2.3)));
      for (let k = 0; k < nt; k++) { const o = (k - (nt - 1) / 2) * 2.3; f.patio.push({ x: x + f.nx * 2.4 + f.tx * o, z: z + f.nz * 2.4 + f.tz * o, seed: hash2(x + k, z - k) }); }
    }
    if (EATS.has(p.k) && h > 0.35 && free(x + f.nx * 1.4 + f.tx * (w / 2 + 0.6), z + f.nz * 1.4 + f.tz * (w / 2 + 0.6))) f.extras.push({ kind: 'board', x: x + f.nx * 1.4 + f.tx * (w / 2 + 0.6), z: z + f.nz * 1.4 + f.tz * (w / 2 + 0.6) });
    if (h < 0.4) for (const sd of [-1, 1]) { const X = x + f.nx * 0.6 + f.tx * sd * (w / 2 + 0.4), Z = z + f.nz * 0.6 + f.tz * sd * (w / 2 + 0.4); if (free(X, Z)) f.extras.push({ kind: 'planter', x: X, z: Z }); }
    p.front = true; fronts.push(f);
  }
}

// ---------- instanced pieces ----------
const CAP = 1600, PCAP = 1400, DCAP = 2600;
const mk = (geo, mat, cap, color) => { const m = new THREE.InstancedMesh(geo, mat, cap); m.count = 0; m.frustumCulled = false; m.receiveShadow = true; if (color) m.setColorAt(0, new THREE.Color()); scene.add(m); return m; };
const white = new THREE.Color('#ffffff');
const glassM = new THREE.MeshStandardMaterial({ color: '#22313a', metalness: 0.4, roughness: 0.12, emissive: '#ffd59a', emissiveIntensity: 0 });
// Interior mapping: each pane traces your view ray into a fake 4.5 m deep shop (floor, ceiling with lights, side walls, a
// back wall of stocked shelves or a counter) — real depth and parallax from a single flat quad. Every shop gets its own
// colours from its position. Lit a little by day (shops are bright inside), brightly at night.
glassM.onBeforeCompile = sh => {
  sh.vertexShader = 'varying vec3 vGW; varying vec3 vGL; varying vec3 vGT; varying vec3 vGN; varying float vGW2; varying vec3 vGO;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
    { mat4 gm = modelMatrix * instanceMatrix; vGW = (gm * vec4(transformed, 1.0)).xyz; vGT = normalize(gm[0].xyz); vGN = normalize(gm[2].xyz); vGW2 = length(gm[0].xyz); vGO = gm[3].xyz;
      vGL = vec3(transformed.x * vGW2, transformed.y, 0.0); }`);
  sh.fragmentShader = 'varying vec3 vGW; varying vec3 vGL; varying vec3 vGT; varying vec3 vGN; varying float vGW2; varying vec3 vGO;\nfloat gH(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }\nvec3 gInterior;\n' + sh.fragmentShader
    .replace('#include <color_fragment>', `#include <color_fragment>
    { vec3 V = normalize(vGW - cameraPosition); float vx = dot(V, vGT), vy = V.y, vz = dot(V, vGN);
      float px = vGL.x, py = vGL.y, D = 4.5, W = vGW2 * 0.5, y0 = 0.1, y1 = 2.75;
      float seed = gH(vGO.xz * 0.37);
      float t = 1e5; int hit = 0;
      if (vz < -1e-3) { float tb = D / -vz; t = tb; hit = 0; }
      if (vy < -1e-3) { float tf = (y0 - py) / vy; if (tf < t) { t = tf; hit = 1; } }
      if (vy > 1e-3) { float tc = (y1 - py) / vy; if (tc < t) { t = tc; hit = 2; } }
      if (abs(vx) > 1e-3) { float ts = ((vx > 0.0 ? W : -W) - px) / vx; if (ts > 0.0 && ts < t) { t = ts; hit = 3; } }
      vec3 hp = vec3(px + vx * t, py + vy * t, -vz * t);
      vec3 wallC = mix(vec3(0.82, 0.8, 0.76), vec3(0.55 + 0.4 * gH(vec2(seed, 1.0)), 0.45 + 0.4 * gH(vec2(seed, 2.0)), 0.4 + 0.4 * gH(vec2(seed, 3.0))), 0.55);
      vec3 c;
      if (hit == 0) {   // back wall: shelves full of goods (or a counter + menu board for cafés)
        float shelf = step(0.88, fract(hp.y / 0.45)) * step(0.5, hp.y);
        float item = gH(floor(vec2(hp.x / 0.22, hp.y / 0.45)) + seed * 17.0);
        vec3 goods = vec3(0.3 + 0.6 * gH(vec2(item, 4.0)), 0.25 + 0.6 * gH(vec2(item, 5.0)), 0.2 + 0.6 * gH(vec2(item, 6.0)));
        float stocked = step(0.25, item) * step(0.55, hp.y) * step(hp.y, 2.3) * step(fract(hp.y / 0.45), 0.8);
        c = mix(wallC, goods, stocked * 0.85); c = mix(c, vec3(0.25, 0.22, 0.2), shelf);
        float counter = step(hp.y, 1.05) * step(seed, 0.4); c = mix(c, vec3(0.35, 0.25, 0.18), counter);
      } else if (hit == 1) { c = mix(vec3(0.42, 0.32, 0.22), vec3(0.6, 0.6, 0.58), step(0.5, seed)) * (0.85 + 0.15 * step(0.5, fract(hp.z / 0.6 + floor(hp.x / 0.15) * 0.5))); }   // wood planks or tile
      else if (hit == 2) { c = vec3(0.9); float lamp = step(0.82, fract(hp.z / 1.5)) * step(0.7, fract(hp.x / 1.8)); c = mix(c, vec3(3.0, 2.7, 2.2), lamp); }   // ceiling + light panels
      else { c = wallC * 0.85; }
      c *= 0.55 + 0.45 * smoothstep(0.0, 4.5, 4.5 - hp.z * 0.6);   // a touch darker deeper in
      gInterior = c;
      diffuseColor.rgb = mix(diffuseColor.rgb, c * 0.6, 0.55); }`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
    totalEmissiveRadiance = gInterior * (0.22 + length(emissive) * 1.1);`);
};
const glass = mk(new THREE.PlaneGeometry(1, 2.5).translate(0, 1.35, 0), glassM, CAP);
const fascia = mk(new THREE.BoxGeometry(1, 0.95, 0.14).translate(0, 3.25, 0.07), std('#ffffff'), CAP, true);
const awning = mk(new THREE.BoxGeometry(1, 0.06, 1.3).translate(0, 0, 0.65), std('#ffffff', { roughness: 0.9 }), CAP, true);
const tableTop = mk(new THREE.CylinderGeometry(0.45, 0.45, 0.04, 14).translate(0, 0.74, 0), std('#e8e4dc'), PCAP);
const tableLeg = mk(new THREE.CylinderGeometry(0.04, 0.06, 0.74, 6).translate(0, 0.37, 0), std('#333333', { metalness: 0.6 }), PCAP);
const chair = mk(new THREE.BoxGeometry(0.42, 0.06, 0.42).translate(0, 0.45, 0), std('#6b4f3a'), PCAP * 2);
const chairBack = mk(new THREE.BoxGeometry(0.42, 0.45, 0.05).translate(0, 0.7, -0.2), std('#6b4f3a'), PCAP * 2);
const umb = mk(new THREE.ConeGeometry(1.25, 0.5, 10, 1, true).translate(0, 2.35, 0), new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide, roughness: 0.9 }), PCAP, true);
const umbPole = mk(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 5).translate(0, 1.2, 0), std('#cccccc', { metalness: 0.6 }), PCAP);
const plate = mk(new THREE.CylinderGeometry(0.12, 0.1, 0.03, 10).translate(0, 0.77, 0), std('#ffffff'), PCAP * 2);
const body = mk(new THREE.BoxGeometry(0.38, 0.55, 0.24).translate(0, 0.78, 0), std('#ffffff'), DCAP, true);
const legs = mk(new THREE.BoxGeometry(0.34, 0.14, 0.45).translate(0, 0.5, 0.18), std('#2d3748'), DCAP);
const head = mk(new THREE.SphereGeometry(0.13, 10, 8).translate(0, 1.2, 0), std('#ffffff', { roughness: 0.6 }), DCAP, true);
const board = mk(new THREE.ConeGeometry(0.42, 1.0, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 0.45).translate(0, 0.5, 0), std('#1e1e1e'), PCAP);
const planter = mk(new THREE.BoxGeometry(0.7, 0.5, 0.7).translate(0, 0.25, 0), std('#7a6a5a'), PCAP);
const bush = mk(new THREE.IcosahedronGeometry(0.42, 0).translate(0, 0.75, 0), std('#3f7a3a', { flatShading: true }), PCAP);
const blade = mk(new THREE.BoxGeometry(0.07, 0.9, 0.8), std('#ffffff', { roughness: 0.5 }), CAP, true);
const bracket = mk(new THREE.BoxGeometry(0.04, 0.04, 1.1), std('#2a2a2a', { metalness: 0.6 }), CAP);
const neonM = new THREE.MeshBasicMaterial({ color: '#555555', toneMapped: false });
const neon = mk(new THREE.BoxGeometry(0.09, 0.05, 0.86), neonM, CAP * 2, true);
const NEON = ['#ff3da8', '#3dfcff', '#ff4b2b', '#fff23d', '#7dff5a', '#b06bff'];
const rack = mk(new THREE.TorusGeometry(0.38, 0.025, 6, 14, Math.PI).translate(0, 0.02, 0), std('#9aa0a6', { metalness: 0.8, roughness: 0.3 }), CAP * 2);
const newsbox = mk(new THREE.BoxGeometry(0.45, 1.0, 0.42).translate(0, 0.5, 0), std('#ffffff', { roughness: 0.5 }), CAP * 3, true);
const NEWS = ['#1f5fa8', '#c53030', '#e2e2e2', '#2f855a', '#d69e2e', '#1a1a1a'];
const SKIN = ['#f1c9a5', '#e0ac7e', '#c68c5e', '#8d5a3b', '#f5d6bd', '#a8714a'], SHIRT = ['#e53e3e', '#3182ce', '#38a169', '#d69e2e', '#805ad5', '#ed64a6', '#f7fafc', '#2d3748', '#dd6b20', '#319795'];

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);
const put = (mesh, i, x, y, z, yaw, sx = 1, sy = 1, sz = 1, tilt = 0) => { _e.set(tilt, yaw, 0, 'YXZ'); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz); _m.compose(_p, _q, _s); mesh.setMatrixAt(i, _m); };
let cx = 1e9, cz = 1e9; const diners = [];
function rebuild(px, pz) {
  cx = px; cz = pz; diners.length = 0;
  const n = { f: 0, t: 0, c: 0, d: 0, b: 0, pl: 0, bl: 0, ne: 0, r: 0, nb: 0 };
  for (const f of fronts) {
    if (Math.abs(f.x - px) > 420 || Math.abs(f.z - pz) > 420 || n.f >= CAP) continue;
    put(glass, n.f, f.x + f.nx * 0.03, f.y, f.z + f.nz * 0.03, f.yaw, f.w - 0.4);
    put(fascia, n.f, f.x, f.y, f.z, f.yaw, f.w); fascia.setColorAt(n.f, _c.set(f.st.bg));
    put(awning, n.f, f.x, f.y + 2.8, f.z, f.yaw, f.w + 0.2, 1, 1, 0.32); awning.setColorAt(n.f, _c.set(f.st.awn));
    n.f++;
    // a blade sign sticking out from the wall above the awning (neon-trimmed on bars / restaurants: glows at night)
    const hb = hash2(f.x * 1.7, f.z * 0.3);
    if (hb < 0.45 && n.bl < CAP) {
      const s = hb < 0.22 ? -1 : 1, bx = f.x + f.tx * s * (f.w / 2 - 0.4) + f.nx * 0.55, bz = f.z + f.tz * s * (f.w / 2 - 0.4) + f.nz * 0.55;
      put(blade, n.bl, bx, f.y + 4.2, bz, f.yaw); blade.setColorAt(n.bl, _c.set(f.st.bg)); put(bracket, n.bl, bx - f.nx * 0.5, f.y + 4.72, bz - f.nz * 0.5, f.yaw); n.bl++;
      if (hb < 0.3 && n.ne < CAP * 2) { const nc = NEON[Math.floor(hb * 977) % NEON.length]; for (const dy of [-0.48, 0.48]) { put(neon, n.ne, bx, f.y + 4.2 + dy, bz, f.yaw); neon.setColorAt(n.ne, _c.set(nc)); n.ne++; } }
    }
    // sidewalk clutter in front of the shops: bike racks (inverted U hoops) and clusters of newspaper boxes
    const hr = hash2(f.z * 1.3, f.x * 0.9);
    if (hr < 0.22 && n.r < CAP) { for (const k of [-0.45, 0.45]) { const rx = f.x + f.nx * 2.2 + f.tx * (k + f.w * 0.25), rz = f.z + f.nz * 2.2 + f.tz * (k + f.w * 0.25); put(rack, n.r++, rx, surfaceY(rx, rz, f.y + 1), rz, f.yaw); } }
    else if (hr > 0.86 && n.nb < CAP) { for (let k = 0; k < 3; k++) { const rx = f.x + f.nx * 2.3 + f.tx * (k - 1) * 0.5 - f.tx * f.w * 0.3, rz = f.z + f.nz * 2.3 + f.tz * (k - 1) * 0.5 - f.tz * f.w * 0.3; put(newsbox, n.nb, rx, surfaceY(rx, rz, f.y + 1), rz, f.yaw); newsbox.setColorAt(n.nb, _c.set(NEWS[(k + Math.floor(hr * 31)) % NEWS.length])); n.nb++; } }
    for (const t of f.patio) {
      if (n.t >= PCAP) break;
      const y = surfaceY(t.x, t.z, f.y + 1);
      put(tableTop, n.t, t.x, y, t.z, 0); put(tableLeg, n.t, t.x, y, t.z, 0);
      const hasUmb = t.seed < 0.65; put(umbPole, n.t, t.x, hasUmb ? y : y - 10, t.z, 0); put(umb, n.t, t.x, hasUmb ? y : y - 10, t.z, 0); umb.setColorAt(n.t, _c.set(t.seed < 0.3 ? '#f7f3ea' : f.st.awn));
      for (let s = 0; s < 2; s++) {
        const sd = s ? 1 : -1, ox = f.tx * sd * 0.62, oz = f.tz * sd * 0.62, yaw = Math.atan2(-ox, -oz);   // chairs either side, facing the table
        const ci = n.c++; put(chair, ci, t.x + ox, y, t.z + oz, yaw); put(chairBack, ci, t.x + ox, y, t.z + oz, yaw);
        put(plate, ci, t.x + ox * 0.45, y, t.z + oz * 0.45, 0);
        const seated = hash2(t.x * 3 + s, t.z) < 0.72;
        if (seated && n.d < DCAP) {
          const d = n.d++, hh = hash2(t.z + s, t.x * 2);
          put(body, d, t.x + ox * 1.05, y, t.z + oz * 1.05, yaw); body.setColorAt(d, _c.set(SHIRT[Math.floor(hh * SHIRT.length) % SHIRT.length]));
          put(legs, d, t.x + ox * 1.05, y, t.z + oz * 1.05, yaw);
          put(head, d, t.x + ox * 1.05, y, t.z + oz * 1.05, 0); head.setColorAt(d, _c.set(SKIN[Math.floor(hh * 97) % SKIN.length]));
          diners.push({ i: d, x: t.x + ox * 1.05, y, z: t.z + oz * 1.05, ph: hh * 20, lx: -ox, lz: -oz });
        }
      }
      n.t++;
    }
    for (const e of f.extras) {
      const y = surfaceY(e.x, e.z, f.y + 1);
      if (e.kind === 'board' && n.b < PCAP) put(board, n.b++, e.x, y, e.z, f.yaw);
      else if (e.kind === 'planter' && n.pl < PCAP) { put(planter, n.pl, e.x, y, e.z, f.yaw); put(bush, n.pl, e.x, y, e.z, f.yaw); n.pl++; }
    }
  }
  const set = (m, c) => { m.count = c; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; };
  for (const m of [glass, fascia, awning]) set(m, n.f);
  for (const m of [tableTop, tableLeg, umb, umbPole]) set(m, n.t);
  for (const m of [chair, chairBack, plate]) set(m, n.c);
  for (const m of [body, legs, head]) set(m, n.d);
  set(board, n.b); set(planter, n.pl); set(bush, n.pl);
  set(blade, n.bl); set(bracket, n.bl); set(neon, n.ne); set(rack, n.r); set(newsbox, n.nb);
  const cl = []; fromInstances(tableTop, 0.75, 0.8, cl, { brk: 6, kind: 'fly', parts: [tableLeg, umb, umbPole] }); fromInstances(planter, 0.4, 0.8, cl, { brk: 5, kind: 'fly', parts: [bush] }); fromInstances(board, 0.3, 1, cl, { brk: 3, kind: 'fly' }); setColliders('patios', cl);
}

// ---------- name boards (real names for local places, parody names for chains) ----------
const texCache = new Map();
function signTex(st) {
  const key = st.name + '|' + st.bg; if (texCache.has(key)) return texCache.get(key);
  const t = canvasTex(512, 96, (c, w, h) => {
    c.fillStyle = st.bg; c.fillRect(0, 0, w, h);
    if (st.logo === 'M') { drawArches(c, 10, 10, 84, 76, st.fg); }
    else if (st.logo === '★') { c.fillStyle = '#ffffff'; c.beginPath(); c.arc(50, h / 2, 38, 0, 6.29); c.fill(); c.fillStyle = st.bg; c.font = '54px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('★', 50, h / 2 + 3); }
    else { c.font = '58px Segoe UI Emoji, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(st.logo || '', 50, h / 2 + 3); }
    c.fillStyle = st.fg; c.font = `bold ${st.chain ? 50 : 44}px ${st.chain ? 'Arial Black, Arial' : 'Georgia, serif'}`; c.textAlign = 'left'; c.textBaseline = 'middle'; c.fillText(st.name || '', 100, h / 2 + 2, w - 112);
  }, false);
  texCache.set(key, t); if (texCache.size > 400) texCache.delete(texCache.keys().next().value);
  return t;
}
const SIGNS = 48, signs = [];
for (let i = 0; i < SIGNS; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.6, emissive: '#ffffff', emissiveIntensity: 0.15 })); m.visible = false; scene.add(m); signs.push(m); }
let signT = 0;
function updateSignBoards(px, pz) {
  signT -= G.dt; if (signT > 0) return; signT = 0.5;
  const near = fronts.filter(f => Math.abs(f.x - px) < 160 && Math.abs(f.z - pz) < 160).map(f => [Math.hypot(f.x - px, f.z - pz), f]).sort((a, b) => a[0] - b[0]).slice(0, SIGNS);
  signs.forEach((m, i) => {
    const it = near[i]; if (!it) { m.visible = false; return; }
    const f = it[1], ww = f.w - 0.3;
    if (m.userData.f !== f) { m.userData.f = f; m.material.map = m.material.emissiveMap = signTex(f.st); m.material.needsUpdate = true; }
    m.scale.set(ww, Math.min(0.8, ww * 96 / 512 * 1.4), 1); m.position.set(f.x + f.nx * 0.16, f.y + 3.25, f.z + f.nz * 0.16); m.rotation.set(0, f.yaw, 0); m.visible = true;
  });
}

// the big golden double-arch "M" (two tall arches sharing a middle leg)
function drawArches(c, x, y, w, h, col) {
  c.save(); c.strokeStyle = col; c.lineWidth = w * 0.17; c.lineCap = 'butt';
  const b = y + h, m = x + w / 2;
  c.beginPath(); c.moveTo(x + w * 0.08, b); c.quadraticCurveTo(x + w * 0.27, y - h * 0.95, m, y + h * 0.62); c.quadraticCurveTo(x + w * 0.73, y - h * 0.95, x + w * 0.92, b); c.stroke();
  c.restore();
}
// logos for the projecting / pylon signs
const logoCache = new Map();
function logoTex(st) {
  if (logoCache.has(st.name)) return logoCache.get(st.name);
  const t = canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = st.bg; c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 4, 0, 6.29); c.fill();
    c.strokeStyle = st.fg; c.lineWidth = 10; c.beginPath(); c.arc(w / 2, h / 2, w / 2 - 14, 0, 6.29); c.stroke();
    if (st.logo === 'M') drawArches(c, 48, 60, 160, 130, st.fg);
    else if (st.logo === '★') { c.fillStyle = st.fg; c.font = 'bold 150px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('★', w / 2, h / 2 + 8); }
    else { c.font = '120px Segoe UI Emoji, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(st.logo || '', w / 2, h / 2 + 6); }
  }, false);
  logoCache.set(st.name, t); return t;
}
function archSignTex() {
  return canvasTex(256, 256, (c, w, h) => { c.fillStyle = '#da291c'; c.fillRect(0, 0, w, h); drawArches(c, 28, 34, 200, 150, '#ffc72c'); c.fillStyle = '#ffffff'; c.font = 'bold 34px Arial Black, Arial'; c.textAlign = 'center'; c.fillText("McDougal's", w / 2, 232); }, false);
}
let ARCH_TEX = null;
const chainSigns = new Map();   // front -> group (only near the player)
const poleM = new THREE.MeshStandardMaterial({ color: '#8c939a', metalness: 0.7, roughness: 0.35 });
function makeChainSign(f) {
  const g = new THREE.Group(), st = f.st;
  if (st.name === "McDougal's") {
    // tall roadside pylon with the golden arches on top
    ARCH_TEX = ARCH_TEX || archSignTex();
    const px = f.x + f.nx * 3.2 + f.tx * (f.w / 2 + 1.6), pz = f.z + f.nz * 3.2 + f.tz * (f.w / 2 + 1.6);
    const y = surfaceY(px, pz, f.y + 2);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 9, 10), poleM); pole.position.set(px, y + 4.5, pz); g.add(pole);
    const mat = new THREE.MeshStandardMaterial({ map: ARCH_TEX, emissiveMap: ARCH_TEX, emissive: '#ffffff', emissiveIntensity: 0.25, roughness: 0.5 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3.4, 0.45), [std('#b51f16'), std('#b51f16'), std('#b51f16'), std('#b51f16'), mat, mat]);
    box.position.set(px, y + 10.3, pz); box.rotation.y = f.yaw; g.add(box); g.userData.glow = [mat];
    // and a 3D golden "M" on the roofline above the door
    const archM = new THREE.MeshStandardMaterial({ color: '#ffc72c', emissive: '#ffb000', emissiveIntensity: 0.2, metalness: 0.3, roughness: 0.35 });
    for (const s of [-1, 1]) { const arch = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.13, 8, 20, Math.PI), archM); arch.scale.set(1, 1.7, 1); arch.position.set(f.x + f.nx * 0.25 + f.tx * s * 0.6, f.y + 4.05, f.z + f.nz * 0.25 + f.tz * s * 0.6); arch.rotation.y = f.yaw; g.add(arch); }
    g.userData.glow.push(archM);
  } else {
    // round logo sign sticking out from the wall, like a real shopping street
    const mat = new THREE.MeshStandardMaterial({ map: logoTex(st), emissiveMap: logoTex(st), emissive: '#ffffff', emissiveIntensity: 0.2, roughness: 0.5, transparent: true, alphaTest: 0.5 });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.1, 24).rotateZ(Math.PI / 2), [std('#2d3238'), mat, mat]);
    const bx = f.x + f.nx * 0.85 + f.tx * (f.w / 2 - 0.2), bz = f.z + f.nz * 0.85 + f.tz * (f.w / 2 - 0.2);
    disc.position.set(bx, f.y + 4.4, bz); disc.rotation.y = f.yaw + Math.PI / 2; g.add(disc);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.9), poleM); arm.position.set(f.x + f.nx * 0.45 + f.tx * (f.w / 2 - 0.2), f.y + 5.1, f.z + f.nz * 0.45 + f.tz * (f.w / 2 - 0.2)); arm.rotation.y = f.yaw; g.add(arm);
    g.userData.glow = [mat];
  }
  scene.add(g); return g;
}
let chainT = 0;
function updateChainSigns(px, pz) {
  chainT -= G.dt; if (chainT > 0) return; chainT = 0.7;
  for (const f of fronts) {
    if (!f.st.chain) continue;
    const d = Math.max(Math.abs(f.x - px), Math.abs(f.z - pz)), have = chainSigns.get(f);
    if (d < 260 && !have) chainSigns.set(f, makeChainSign(f));
    else if (d > 360 && have) { scene.remove(have); chainSigns.delete(f); }
  }
  const k = 0.2 + (G.night || 0) * 1.2; for (const g of chainSigns.values()) for (const m of g.userData.glow) m.emissiveIntensity = k;
}
export function initStorefronts() { placeFronts(); }
let tick = 0;
export function updateStorefronts(pl) {
  if (Math.abs(pl.x - cx) > 110 || Math.abs(pl.z - cz) > 110) rebuild(pl.x, pl.z);
  updateSignBoards(pl.x, pl.z);
  updateChainSigns(pl.x, pl.z);
  const night = G.night || 0;
  glassM.emissiveIntensity = 0.05 + night * 0.7;
  neonM.color.setScalar(0.35 + night * 1.6);   // neon tubes: dull by day, bright at night
  for (const s of signs) s.material.emissiveIntensity = 0.15 + night * 0.9;
  // diners near you nod and eat (only the heads move)
  if ((tick++ & 1) === 0) {
    let moved = 0;
    for (const d of diners) {
      if (Math.abs(d.x - pl.x) > 70 || Math.abs(d.z - pl.z) > 70) continue;
      const k = Math.max(0, Math.sin(G.t * 2.2 + d.ph)) * 0.06;
      put(head, d.i, d.x + d.lx * k, d.y - k * 0.5, d.z + d.lz * k, 0); moved++;
    }
    if (moved) head.instanceMatrix.needsUpdate = true;
  }
}
export const storefrontCount = () => fronts.length;
export const _fronts = fronts;   // for testing
