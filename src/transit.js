// Public transport you can actually ride: SkyTrain (Expo, Millennium, Canada lines on the real OpenStreetMap track),
// the SeaBus, city buses on the real streets, BC Fairies ferries, the little False Creek ferries, Victoria's pickle
// boats, a fast foot-ferry to Nanaimo, taxis, and the phone's Travel-tab shuttles / seaplanes / helicopters.
// Every station joins ONE network: at any booth you can pick any stop you can reach, and the trip planner changes
// lines for you (e.g. Expo → Canada Line at Waterfront). Watch the whole ride (C = camera) Space once = fast-forward, again = skip.
import * as THREE from 'three';
import { G, scene, std, addMesh, toXZ, canvasTex, tapped, farCull, pick, camera } from './core.js';
import { heightAt, isWater, waterLevel, groundY, prebuildChunksNear } from './terrain.js';
import { surfaceY, walkY, buildingAt, nodeEdges, NX, NZ, nearestRoad, isDriveType, railY } from './city.js';
import { busModel, vehicles, makeVehicle, removeVehicle } from './vehicles.js';
import { state, activeMission } from './missions.js';
import { OWN, PROPS } from './shops.js';
import { waterPath, ferryModel } from './island.js';
import { ui } from './ui.js';
import { sfx } from './sound.js';

const M = window.MAP;
export const FARE = 3.15;
const FARES = { compass: [3.15, '💳 Compass card'], ferry: [19.95, '⛴️ BC Fairies foot passenger'], fast: [14.99, '🚤 Hullabaloo fast ferry'], mini: [4.5, '🌈 Rainbow Ferry'], pickle: [8, '🥒 Pickle Boat pass'] };
const fareOf = P => P.fare || 'compass';

// ---------- small helpers ----------
// a booth spot: out of buildings / water, on open ground
function openSpot(x, z, R = 160) { for (let r = 0; r < R; r += 4) for (let a = 0; a < 6.28; a += 0.4) { const X = x + Math.cos(a) * r, Z = z + Math.sin(a) * r; if (!isWater(X, Z) && groundY(X, Z) > -0.2 && !buildingAt(X, Z) && !buildingAt(X + 3, Z) && !buildingAt(X - 3, Z) && !buildingAt(X, Z + 3) && !buildingAt(X, Z - 3)) return [X, Z]; } return [x, z]; }
// the closest dry land (for ferry docks far out in the strait the search radius is big)
function landSpot(x, z, R = 3000) { for (let r = 0; r < R; r += r < 200 ? 6 : 30) for (let a = 0; a < 6.28; a += Math.max(0.05, Math.min(0.5, 8 / Math.max(r, 1)))) { const X = x + Math.cos(a) * r, Z = z + Math.sin(a) * r; if (!isWater(X, Z) && heightAt(X, Z) > 0.6 && !buildingAt(X, Z) && !buildingAt(X + 2, Z) && !buildingAt(X - 2, Z) && !buildingAt(X, Z + 2) && !buildingAt(X, Z - 2)) return [X, Z]; } return [x, z]; }
function findWater(x, z, clear = 15, R = 600) { for (let r = 0; r < R; r += 6) for (let a = 0; a < 6.28; a += 0.3) { const X = x + Math.cos(a) * r, Z = z + Math.sin(a) * r; if (isWater(X, Z) && isWater(X + clear, Z) && isWater(X - clear, Z) && isWater(X, Z + clear) && isWater(X, Z - clear)) return [X, Z]; } return [x, z]; }
// where you stand: the drawn street / ground / dock, never on top of a viaduct overhead
export const standY = (x, z) => walkY(x, z, Math.max(groundY(x, z), 0) + 1);
const lensOf = pts => { const l = [0]; for (let i = 1; i < pts.length; i++) l.push(l[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z, (pts[i].y || 0) - (pts[i - 1].y || 0))); return l; };
class Heap { constructor() { this.a = []; } get size() { return this.a.length; }
  push(f, v) { const a = this.a; a.push([f, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; } }

// ---------- SkyTrain: real station positions (OpenStreetMap) ----------
const STATION_LL = {
  'Waterfront': [49.28554, -123.11354], 'Burrard': [49.28564, -123.11982], 'Granville': [49.28323, -123.11604], 'Stadium–Chinatown': [49.27940, -123.10931],
  'Main Street–Science World': [49.27315, -123.10044], 'Commercial–Broadway': [49.26295, -123.06849], 'Nanaimo': [49.24846, -123.05602], '29th Avenue': [49.24421, -123.04592],
  'Joyce–Collingwood': [49.23838, -123.03175], 'Patterson': [49.22982, -123.01273], 'Metrotown': [49.22583, -123.00389], 'Royal Oak': [49.22007, -122.98842],
  'Edmonds': [49.21213, -122.95923], '22nd Street': [49.20005, -122.94904], 'New Westminster': [49.20137, -122.91274], 'Columbia': [49.20482, -122.90613],
  'Scott Road': [49.20440, -122.87420], 'Sapperton': [49.22450, -122.88930], 'Braid': [49.23320, -122.88290], 'Lougheed Town Centre': [49.24846, -122.89685],
  'Production Way–University': [49.25342, -122.91815], 'Lake City Way': [49.25462, -122.93901], 'Sperling–Burnaby Lake': [49.25918, -122.96394], 'Holdom': [49.26474, -122.98211],
  'Brentwood Town Centre': [49.26640, -123.00167], 'Gilmore': [49.26500, -123.01342], 'Rupert': [49.26071, -123.03310], 'Renfrew': [49.25895, -123.04525],
  'VCC–Clark': [49.26583, -123.07914], 'Burquitlam': [49.26140, -122.88990],
  'Vancouver City Centre': [49.28199, -123.11892], 'Yaletown–Roundhouse': [49.27454, -123.12190], 'Olympic Village': [49.26656, -123.11570], 'Broadway–City Hall': [49.26284, -123.11451],
  'King Edward': [49.24917, -123.11586], 'Oakridge–41st Avenue': [49.23316, -123.11662], 'Langara–49th Avenue': [49.22627, -123.11609], 'Marine Drive': [49.20968, -123.11698],
  'Bridgeport': [49.19561, -123.12594], 'Templeton': [49.19667, -123.14647], 'Sea Island Centre': [49.19302, -123.15801], 'YVR–Airport': [49.19427, -123.17834],
  'Capstan': [49.18953, -123.13148], 'Aberdeen': [49.18398, -123.13632], 'Lansdowne': [49.17457, -123.13647], 'Richmond–Brighouse': [49.16811, -123.13627],
};
const LINES = [
  { id: 'expo', group: 'expo', name: 'Expo Line', color: '#1f4e9c', stations: ['Waterfront', 'Burrard', 'Granville', 'Stadium–Chinatown', 'Main Street–Science World', 'Commercial–Broadway', 'Nanaimo', '29th Avenue', 'Joyce–Collingwood', 'Patterson', 'Metrotown', 'Royal Oak', 'Edmonds', '22nd Street', 'New Westminster', 'Columbia', 'Scott Road'] },
  // (the real branch continues Braid → Lougheed → Production Way, but our track data stops after Sapperton; those stations are on the Millennium Line)
  { id: 'expo2', group: 'expo', name: 'Expo Line', branch: 'Sapperton branch', color: '#1f4e9c', stations: ['Columbia', 'Sapperton'] },
  { id: 'mill', group: 'mill', name: 'Millennium Line', color: '#f2c230', stations: ['VCC–Clark', 'Commercial–Broadway', 'Renfrew', 'Rupert', 'Gilmore', 'Brentwood Town Centre', 'Holdom', 'Sperling–Burnaby Lake', 'Lake City Way', 'Production Way–University', 'Lougheed Town Centre', 'Burquitlam'] },
  { id: 'canada', group: 'canada', name: 'Canada Line', color: '#2a9fd6', stations: ['Waterfront', 'Vancouver City Centre', 'Yaletown–Roundhouse', 'Olympic Village', 'Broadway–City Hall', 'King Edward', 'Oakridge–41st Avenue', 'Langara–49th Avenue', 'Marine Drive', 'Bridgeport', 'Templeton', 'Sea Island Centre', 'YVR–Airport'] },
  { id: 'canada2', group: 'canada', name: 'Canada Line', branch: 'Richmond branch', color: '#2a9fd6', stations: ['Bridgeport', 'Capstan', 'Aberdeen', 'Lansdowne', 'Richmond–Brighouse'] },
];
export const dropped = [];   // stations beyond the downloaded track (reported by the checker)

// ---------- rail graph from the real track ----------
const nodes = new Map();
const key = (x, z) => Math.round(x) + ',' + Math.round(z);
function node(x, z, tu) {
  const k = key(x, z); let n = nodes.get(k);
  if (!n) { n = { x, z, tu, nb: [], k }; nodes.set(k, n); }
  else if (!tu) n.tu = false;
  return n;
}
function buildGraph() {
  for (const r of M.rails) {
    if (r.t !== 1) continue;
    if (/Broadway Extension/.test(M.names[r.n] || '')) continue;   // the Broadway subway isn't open yet
    let prev = null;
    for (let i = 0; i < r.p.length; i += 2) {
      const n = node(r.p[i], r.p[i + 1], !!r.tu);
      if (prev && prev !== n) { const d = Math.hypot(n.x - prev.x, n.z - prev.z); prev.nb.push([n, d]); n.nb.push([prev, d]); }
      prev = n;
    }
  }
  let cid = 0;
  for (const n of nodes.values()) {
    if (n.c !== undefined) continue;
    const st = [n]; n.c = cid;
    while (st.length) { const a = st.pop(); for (const [b] of a.nb) if (b.c === undefined) { b.c = cid; st.push(b); } }
    cid++;
  }
  for (const n of nodes.values()) {
    n.y = n.tu ? heightAt(n.x, n.z) - 14 : railY(n.x, n.z, heightAt(n.x, n.z) + 0.4) + 0.2;
    if (n.tu) continue;
    // track deep below the drawn ground is in a cut / tunnel the map doesn't tag (Sapperton, the Canada Line portal near 63rd):
    // treat it as a tunnel; track just a little below the drawn ground sits on top of it
    const g = groundY(n.x, n.z);
    if (n.y < g - 3) { n.tu = true; n.y = Math.min(n.y, g - 14); } else if (n.y < g + 0.3) n.y = g + 0.3;
  }
  // one lone "open" node between tunnel nodes (a tiny gap in the tags) would flash the train up: close it
  for (const n of nodes.values()) if (!n.tu && n.nb.length === 2 && n.nb.every(([b]) => b.tu)) { n.tu = true; n.y = groundY(n.x, n.z) - 14; }
}
function nearest(x, z, comp) { let b = null, bd = 1e9; for (const n of nodes.values()) { if (comp !== undefined && n.c !== comp) continue; const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; b = n; } } return [b, bd]; }
// one Dijkstra from a to the nearest of several target nodes
function trackPath(a, targets) {
  const dist = new Map([[a, 0]]), prev = new Map(), h = new Heap(), left = new Set(targets); h.push(0, a); let best = null, bd = 1e18, pops = 0;
  while (h.size && left.size && pops++ < 400000) {
    const [d, u] = h.pop(); if (d > dist.get(u)) continue;
    if (left.has(u)) { left.delete(u); if (d < bd) { bd = d; best = u; } }
    if (d > bd + 400) break;
    for (const [v, w] of u.nb) { const nd = d + w; if (nd < (dist.get(v) ?? 1e18)) { dist.set(v, nd); prev.set(v, u); h.push(nd, v); } }
  }
  if (!best) return null;
  const path = [best]; let c = best; while (c !== a) { c = prev.get(c); path.push(c); } return path.reverse();
}
// a line becomes one long path with station positions along it
function buildLine(L) {
  let st = L.stations.map(name => { const [x, z] = toXZ(...STATION_LL[name]); return { name, x, z }; });
  const votes = new Map(); for (const s of st) { const [n, d] = nearest(s.x, s.z); if (n && d < 300) votes.set(n.c, (votes.get(n.c) || 0) + 1); }
  const comp = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  st = st.filter(s => { const [, d] = nearest(s.x, s.z, comp); if (d > 220) { dropped.push(L.id + ': ' + s.name + ` (track ${Math.round(d)} m away)`); return false; } return true; });
  const cands = s => { const out = []; for (const n of nodes.values()) if (n.c === comp && Math.hypot(n.x - s.x, n.z - s.z) < 90) out.push(n); if (!out.length) { const [n] = nearest(s.x, s.z, comp); out.push(n); } return out; };
  const pts = [];
  for (let i = 0; i < st.length; i++) {
    const s = st[i];
    if (i === 0) { s.node = cands(s).sort((a, b) => Math.hypot(a.x - s.x, a.z - s.z) - Math.hypot(b.x - s.x, b.z - s.z))[0]; pts.push({ x: s.node.x, z: s.node.z, y: s.node.y, tu: s.node.tu }); s.pi = 0; continue; }
    const seg = trackPath(st[i - 1].node, cands(s));
    if (seg) { s.node = seg[seg.length - 1]; for (const n of seg.slice(1)) pts.push({ x: n.x, z: n.z, y: n.y, tu: n.tu }); }
    else { s.node = null; dropped.push(L.id + ': no track from ' + st[i - 1].name + ' to ' + s.name); const p0 = pts[pts.length - 1]; for (let k = 1; k <= 20; k++) { const t = k / 20, x = p0.x + (s.x - p0.x) * t, z = p0.z + (s.z - p0.z) * t; pts.push({ x, z, y: heightAt(x, z) + 7.2, tu: false }); } }
    s.pi = pts.length - 1;
  }
  // a point every 10 m (some tunnel portals are 300 m between map points)
  const raw = pts.splice(0), remap = new Map();
  raw.forEach((b, i) => {
    if (i) { const a = raw[i - 1], L = Math.hypot(b.x - a.x, b.z - a.z), k = Math.ceil(L / 10); for (let j = 1; j < k; j++) { const t = j / k; pts.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: a.y + (b.y - a.y) * t, tu: a.tu && b.tu, mix: a.tu !== b.tu }); } }
    remap.set(i, pts.length); pts.push(b);
  });
  for (const s of st) s.pi = remap.get(s.pi);
  // tunnel portals: the track ramps down into the tunnel (6 % grade) instead of dropping 14 m in one step;
  // anything still below the drawn ground is inside the portal / cut (hidden, like the tunnel)
  for (const order of [1, -1]) for (let k = 1; k < pts.length; k++) {
    const i = order > 0 ? k : pts.length - 1 - k, j = i - order, a = pts[i], b = pts[j];
    if (a.tu || a.mix) a.y = Math.max(a.y, b.y - 0.06 * Math.hypot(a.x - b.x, a.z - b.z));
  }
  for (const p of pts) if (!p.tu && p.y < groundY(p.x, p.z) - 0.6) p.tu = true;
  const lens = lensOf(pts);
  for (const s of st) { s.u = lens[s.pi]; s.under = pts[s.pi].tu; s.deckY = pts[s.pi].y; }
  return { ...L, kind: 'train', both: true, st, pts, lens, total: lens[lens.length - 1] };
}
const _q = new THREE.Vector3();
function pathAt(P, u, out = {}) {
  u = Math.max(0, Math.min(P.total, u));
  let lo = 0, hi = P.lens.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P.lens[m] < u) lo = m; else hi = m; }
  const a = P.pts[lo], b = P.pts[hi] || a, t = (u - P.lens[lo]) / ((P.lens[hi] - P.lens[lo]) || 1);
  out.x = a.x + (b.x - a.x) * t; out.y = (a.y || 0) + ((b.y || 0) - (a.y || 0)) * t; out.z = a.z + (b.z - a.z) * t; out.tu = !!(a.tu && b.tu);
  if (Math.hypot(b.x - a.x, b.z - a.z) > 0.01) out.yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z)); else out.yaw = out.yaw ?? 0;
  return out;
}

// ---------- models ----------
const carTex = canvasTex(512, 128, (c, w, h) => {
  c.fillStyle = '#f4f5f6'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#1f4e9c'; c.fillRect(0, h * 0.72, w, h * 0.12);
  c.fillStyle = '#1b2630'; for (let i = 0; i < 8; i++) c.fillRect(20 + i * 62, h * 0.22, 46, h * 0.36);
  c.fillStyle = '#6b7280'; c.fillRect(w * 0.48, h * 0.18, 26, h * 0.62);
}, false);
const carMat = new THREE.MeshStandardMaterial({ map: carTex, roughness: 0.4, metalness: 0.2 }), capMat = std('#e8eaec', { metalness: 0.3, roughness: 0.4 }), noseMat = std('#1b2630', { metalness: 0.8, roughness: 0.1 });
const carGeo = new THREE.BoxGeometry(2.6, 3.0, 17), stripeGeo = new THREE.BoxGeometry(2.62, 0.25, 17.02), noseGeo = new THREE.BoxGeometry(2.4, 1.4, 0.2), stripeMats = {};
function makeTrain(cars, color) {
  const parts = [];
  for (let i = 0; i < cars; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(carGeo, [carMat, carMat, capMat, capMat, capMat, capMat]); body.position.y = 1.9; body.castShadow = true; g.add(body);
    addMesh(stripeGeo, stripeMats[color] || (stripeMats[color] = std(color)), 0, 0.75, 0, g);
    if (i === 0 || i === cars - 1) addMesh(noseGeo, noseMat, 0, 2.3, i === 0 ? -8.55 : 8.55, g, false);
    scene.add(g); parts.push(g);
  }
  return parts;
}
const _ta = {}, _tb = {};
function placeTrain(P, cars, u, dir) {
  let hidden = true;
  cars.forEach((g, i) => {
    // each car sits on its two bogies (8 m either side): smooth heading and height through every curve
    const c = u - dir * i * 17.5, p = pathAt(P, c), a = pathAt(P, c - 8, _ta), b = pathAt(P, c + 8, _tb), yaw = Math.hypot(b.x - a.x, b.z - a.z) > 1 ? Math.atan2(-(b.x - a.x), -(b.z - a.z)) : p.yaw;
    g.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); g.rotation.set(0, yaw + (dir < 0 ? Math.PI : 0), 0);
    g.visible = !p.tu; if (!p.tu) hidden = false;
  });
  return hidden;
}
function seabusModel() {
  const g = new THREE.Group();
  addMesh(new THREE.BoxGeometry(14, 3, 34), std('#f2f2f2'), 0, 1.5, 0, g);
  addMesh(new THREE.BoxGeometry(12, 3.4, 26), std('#f6c400'), 0, 4.6, 0, g);
  addMesh(new THREE.BoxGeometry(12.05, 1.4, 26.05), std('#1c2b33', { metalness: 0.8, roughness: 0.1 }), 0, 5, 0, g);
  addMesh(new THREE.BoxGeometry(6, 1.4, 5), std('#f2f2f2'), 0, 7, 0, g);
  scene.add(g); return g;
}
const RAINBOW = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa'];
function miniModel() {   // a little False Creek "rainbow" ferry
  const g = new THREE.Group(); addMesh(new THREE.BoxGeometry(3, 1.2, 8), std('#f4f4f0'), 0, 0.1, 0, g);
  addMesh(new THREE.ConeGeometry(1.5, 2, 4), std('#f4f4f0'), 0, 0.1, -4.8, g).rotation.set(-Math.PI / 2, Math.PI / 4, 0);
  RAINBOW.forEach((c, i) => addMesh(new THREE.BoxGeometry(2.8, 0.25, 4.6), std(c), 0, 1.0 + i * 0.25, 0.6, g));
  addMesh(new THREE.BoxGeometry(2.9, 0.15, 4.9), std('#f4f4f0'), 0, 2.6, 0.6, g);
  scene.add(g); return g;
}
function pickleModel() {   // Victoria's green "pickle boats"
  const g = new THREE.Group(); addMesh(new THREE.BoxGeometry(2.6, 0.9, 6), std('#2f8f4e'), 0, 0.3, 0, g); addMesh(new THREE.BoxGeometry(2.4, 1.3, 3.2), std('#f4f4ef'), 0, 1.35, 0.4, g); addMesh(new THREE.BoxGeometry(2.6, 0.2, 3.6), std('#2f8f4e'), 0, 2.1, 0.4, g); addMesh(new THREE.ConeGeometry(1.3, 1.6, 4), std('#2f8f4e'), 0, 0.3, -3.6, g).rotation.set(-Math.PI / 2, Math.PI / 4, 0);
  scene.add(g); return g;
}
function catModel() {   // fast passenger catamaran
  const g = new THREE.Group(), white = std('#f3f4f1'), red = std('#c8302a'), dark = std('#20262e', { roughness: 0.2, metalness: 0.5 });
  for (const s of [-1, 1]) addMesh(new THREE.BoxGeometry(2.6, 2.2, 34), white, s * 4.2, 0.6, 0, g);
  addMesh(new THREE.BoxGeometry(11, 2.6, 26), white, 0, 3.0, 1, g); addMesh(new THREE.BoxGeometry(11.05, 1.1, 26.05), dark, 0, 3.4, 1, g);
  addMesh(new THREE.BoxGeometry(11.1, 0.4, 26.1), red, 0, 1.75, 1, g); addMesh(new THREE.BoxGeometry(7, 1.6, 7), white, 0, 5.1, -4, g); addMesh(new THREE.BoxGeometry(7.05, 0.7, 7.05), dark, 0, 5.3, -4, g);
  scene.add(g); return g;
}

// ---------- stations & booths ----------
function stationSign(name, color, icon = '🚆') {
  const tex = canvasTex(512, 128, (c, w, h) => { c.fillStyle = '#0d2a4a'; c.fillRect(0, 0, w, h); c.fillStyle = color; c.fillRect(0, 0, 18, h); c.fillStyle = '#fff'; c.font = 'bold 44px Segoe UI, Arial'; c.textBaseline = 'middle'; c.fillText(icon + ' ' + name, 34, h / 2, w - 44); }, false);
  return new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, emissive: '#222', emissiveMap: tex }));
}
const stops = [];   // every place you can board: {name, x, z, P, s, kind, ax, az (where you get off)}
function addStop(name, x, z, P, s, kind) {
  const [ax, az] = openSpot(x + 3, z + 3, 60);
  const st = { name, x, z, P, s, kind, ax, az }; stops.push(st); return st;
}
const kioskGlass = std('#9fb4bd', { metalness: 0.6, roughness: 0.1, transparent: true, opacity: 0.6 }), kioskRoof = std('#2d3748'), platM = std('#b8b2a7'), roofM = std('#e2e8f0', { metalness: 0.4 }), postM = std('#888');
const builtKiosk = new Map();   // one kiosk per station name (Waterfront serves two lines)
function buildStations(P) {
  for (const s of P.st) {
    let k = builtKiosk.get(s.name);
    if (!k) {
      const [kx, kz] = openSpot(s.x, s.z), gy = standY(kx, kz);
      const kiosk = new THREE.Group(); kiosk.position.set(kx, gy, kz); scene.add(kiosk); farCull(kiosk, 1200);
      addMesh(new THREE.BoxGeometry(4, 3, 4), kioskGlass, 0, 1.5, 0, kiosk);
      addMesh(new THREE.BoxGeometry(4.6, 0.3, 4.6), kioskRoof, 0, 3.15, 0, kiosk);
      const sg = stationSign(s.name, P.color); sg.position.set(0, 4.4, 0); kiosk.add(sg);
      const sg2 = sg.clone(); sg2.rotation.y = Math.PI / 2; kiosk.add(sg2);
      k = { x: kx, z: kz }; builtKiosk.set(s.name, k);
      addStop(s.name, kx, kz, P, s, 'train');
    }
    if (!s.under && s.node) {   // elevated / at-grade platform + roof
      const p = pathAt(P, s.u), g = new THREE.Group(); g.position.set(p.x, p.y, p.z); g.rotation.y = p.yaw; scene.add(g); farCull(g, 2500);
      for (const side of [-1, 1]) addMesh(new THREE.BoxGeometry(3, 0.6, 80), platM, side * 3.2, 0.7, 0, g);
      addMesh(new THREE.BoxGeometry(10, 0.3, 80), roofM, 0, 6, 0, g);
      for (const z of [-35, 0, 35]) addMesh(new THREE.CylinderGeometry(0.25, 0.25, 6), postM, 4.7, 3, z, g);
      const sp = stationSign(s.name, P.color); sp.position.set(4.6, 3.5, 0); sp.rotation.y = Math.PI / 2; g.add(sp);
    }
  }
}

// ---------- boats: SeaBus, BC Fairies, Hullabaloo fast ferry, False Creek rainbow ferries, Victoria pickle boats ----------
// stops: [name, lat, lon] (lat/lon = the dock on land); C = water-grid size for the route finder
const BOATS = [
  { id: 'seabus', group: 'seabus', name: 'SeaBus', kind: 'seabus', color: '#f6c400', C: 30, stops: [['Waterfront', 49.2868, -123.1104], ['Lonsdale Quay', 49.3094, -123.0838]] },
  { id: 'bcf1', group: 'bcf1', name: 'BC Fairies: Tsawwassen ⇄ Swartz Bay', kind: 'ferry', fare: 'ferry', color: '#1e4a8a', C: 200, water: [[49.0060, -123.1335], [48.6895, -123.4095]], stops: [['Tsawwassen ferry terminal', 49.0080, -123.1290], ['Swartz Bay ferry terminal', 48.6890, -123.4100]] },
  { id: 'bcf2', group: 'bcf2', name: 'BC Fairies: Horseshoe Bay ⇄ Departure Bay', kind: 'ferry', fare: 'ferry', color: '#1e4a8a', C: 200, water: [[49.3740, -123.2725], [49.1955, -123.9420]], stops: [['Horseshoe Bay', 49.37568, -123.27181], ['Departure Bay (Nanaimo)', 49.1935, -123.9530]] },
  { id: 'hullo', group: 'hullo', name: 'Hullabaloo fast ferry', kind: 'fast', fare: 'fast', color: '#c8302a', C: 100, water: [[49.2912, -123.1180], [49.1655, -123.9285]], stops: [['Downtown fast-ferry dock', 49.29031, -123.11635], ['Nanaimo Harbour', 49.1650, -123.9330]] },
  { id: 'fc', group: 'fc', name: 'False Creek Rainbow Ferry', kind: 'mini', fare: 'mini', color: '#8e24aa', C: 10, creek: true, stops: [['Maritime Museum', 49.27720, -123.14690], ['Hornby St dock', 49.27730, -123.12960], ['Granville Island', 49.27320, -123.13470], ['David Lam Park', 49.27180, -123.12380], ['Yaletown dock', 49.27360, -123.11930], ['Stamps Landing', 49.27070, -123.11800], ['Spyglass Place', 49.26990, -123.11470], ['Village dock', 49.27010, -123.10790], ['Science World dock', 49.27310, -123.10380]] },
  { id: 'pickle', group: 'pickle', name: 'Victoria Pickle Boats', kind: 'pickle', fare: 'pickle', color: '#2f8f4e', C: 10, stops: [['Empress Dock', 48.42230, -123.36890], ['Coast Hotel', 48.42291, -123.37992], ["Fisherman's Wharf", 48.42276, -123.38257], ['Songhees Landing', 48.42608, -123.38076], ['Delta Ocean Pointe', 48.42683, -123.37408], ['Swift Street Landing', 48.42930, -123.37173], ['Dockside Green', 48.43285, -123.37772], ['Point Ellice House', 48.43544, -123.37797]] },
];
// a coarse open-water route is redone on a fine grid wherever it would cut across land (narrow bays, headlands)
function refine(path, C) {
  if (C < 50) return path;
  const dryAt = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let d = 0; d <= L; d += 15) { const x = a[0] + (b[0] - a[0]) * d / L, z = a[1] + (b[1] - a[1]) * d / L; if (!isWater(x, z)) return true; } return false; };
  const pts = [path[0]];   // first cut long straight pieces into ≤ 3 km bits
  for (let i = 1; i < path.length; i++) { const a = path[i - 1], b = path[i], k = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3000); for (let j = 1; j <= k; j++) pts.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]); }
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = out[out.length - 1], b = pts[i];
    if (!dryAt(a, b)) { out.push(b); continue; }
    const f = waterPath(a, b, 25, 1500);
    for (const q of f.slice(1)) out.push(q);
  }
  return out;
}
function buildBoatLine(B) {
  const ok = p => isWater(p[0], p[1]) && isWater(p[0] + 4, p[1]) && isWater(p[0] - 4, p[1]) && isWater(p[0], p[1] + 4) && isWater(p[0], p[1] - 4);
  let ref = null;
  if (B.creek) { const q = toXZ(49.2725, -123.1190); ref = q; for (let r = 0; r < 300 && !ok(ref); r += 10) for (let a = 0; a < 6.28 && !ok(ref); a += 0.4) ref = [q[0] + Math.cos(a) * r, q[1] + Math.sin(a) * r]; }
  // the water point for each stop: given, or the nearest roomy water (for the creek: really connected to the creek)
  const wpt = (s, i) => {
    if (B.water) return toXZ(...B.water[i]);
    const [x, z] = toXZ(s[1], s[2]);
    if (!ref) return findWater(x, z, B.C < 50 ? 6 : 15);
    for (let r = 0; r < 400; r += 8) for (let a = 0; a < 6.28; a += 0.35) { const p = [x + Math.cos(a) * r, z + Math.sin(a) * r]; if (!ok(p)) continue; const w = waterPath(ref, p, 10, 400); if (w.length > 2 || Math.hypot(p[0] - ref[0], p[1] - ref[1]) < 15) return p; r += 24; break; }
    return ref;
  };
  const W = B.stops.map(wpt), pts = [], st = [];
  for (let i = 0; i < W.length; i++) {
    if (i === 0) pts.push({ x: W[0][0], z: W[0][1], y: 0 });
    else { const leg = refine(waterPath(W[i - 1], W[i], B.C, B.C < 50 ? 500 : 8000), B.C); for (const q of leg.slice(1)) pts.push({ x: q[0], z: q[1], y: 0 }); }
    // densify long straight pieces so the boat turns smoothly into the dock
    st.push({ name: B.stops[i][0], pi: pts.length - 1 });
  }
  const dense = []; const idx = new Map();
  for (let i = 0; i < pts.length; i++) {
    if (i) { const a = pts[i - 1], b = pts[i], L = Math.hypot(b.x - a.x, b.z - a.z), k = Math.ceil(L / 60); for (let j = 1; j < k; j++) dense.push({ x: a.x + (b.x - a.x) * j / k, z: a.z + (b.z - a.z) * j / k, y: 0 }); }
    idx.set(i, dense.length); dense.push(pts[i]);
  }
  const lens = lensOf(dense);
  st.forEach((s, i) => { s.u = lens[idx.get(s.pi)]; const [x, z] = toXZ(B.stops[i][1], B.stops[i][2]); [s.x, s.z] = landSpot(x, z); s.under = false; });
  const P = { ...B, both: true, st, pts: dense, lens, total: lens[lens.length - 1] };
  for (const s of st) {
    addStop(s.name, s.x, s.z, P, s, 'boat');
    const sg = stationSign(s.name, B.color, B.kind === 'mini' ? '🌈' : B.kind === 'pickle' ? '🥒' : '⛴️'); sg.position.set(s.x, standY(s.x, s.z) + 3.6, s.z); scene.add(sg); farCull(sg, 900);
    addMesh(new THREE.CylinderGeometry(0.12, 0.12, 3, 6), postM, s.x, standY(s.x, s.z) + 1.5, s.z);
  }
  return P;
}
let seabus = null;

// ---------- city buses on the real streets ----------
const BUSES = [
  { id: 'b99', name: '99 B-Line', color: '#e8710a', stops: [['Commercial–Broadway', 49.2626, -123.0690], ['Main & Broadway', 49.2629, -123.1000], ['Cambie & Broadway', 49.2632, -123.1150], ['Granville & Broadway', 49.2635, -123.1385], ['Arbutus & Broadway', 49.2640, -123.1530], ['Alma & Broadway', 49.2637, -123.1860], ['UBC Exchange', 49.2675, -123.2475]] },
  { id: 'b5', name: '5 Robson', color: '#1f4e8c', stops: [['Robson & Burrard', 49.2848, -123.1222], ['Robson & Bute', 49.2868, -123.1270], ['Robson & Denman', 49.2908, -123.1350], ['Davie & Denman', 49.2869, -123.1410]] },
  { id: 'b250', name: '250 Horseshoe Bay', color: '#2f855a', stops: [['Georgia & Granville', 49.2830, -123.1180], ['Park Royal', 49.3260, -123.1360], ['Dundarave', 49.3330, -123.1800], ['Horseshoe Bay', 49.3760, -123.2720]] },
  { id: 'b232', name: '232 Grouse Mountain', color: '#9b2c2c', stops: [['Lonsdale Quay', 49.3100, -123.0832], ['Lonsdale & 15th', 49.3225, -123.0725], ['Grouse Mountain base', 49.3712, -123.0985]] },
  { id: 'r4', name: 'R4 41st Ave', color: '#3fa34d', stops: [['Joyce–Collingwood', 49.2386, -123.0322], ['Victoria & 41st', 49.2334, -123.0656], ['Main & 41st', 49.2331, -123.1010], ['Oakridge–41st Avenue', 49.2332, -123.1172], ['Granville & 41st', 49.2340, -123.1400], ['Dunbar & 41st', 49.2343, -123.1853], ['UBC Exchange', 49.2675, -123.2475]] },
  { id: 'r5', name: 'R5 Hastings St', color: '#3fa34d', stops: [['Hastings & Burrard', 49.2873, -123.1166], ['Main & Hastings', 49.2812, -123.0996], ['Commercial & Hastings', 49.2812, -123.0697], ['Nanaimo & Hastings', 49.2812, -123.0560], ['Kootenay Loop', 49.2809, -123.0245], ['SFU Exchange', 49.2785, -122.9142]] },
  { id: 'r2', name: 'R2 Marine Dr', color: '#3fa34d', stops: [['Park Royal', 49.3260, -123.1360], ['Capilano & Marine', 49.3226, -123.1135], ['Lonsdale Quay', 49.3100, -123.0832], ['Phibbs Exchange', 49.3044, -123.0255]] },
];
// buses like big streets: small streets cost more, service roads a lot more
const roadCost = r => r.t <= 4 ? 1 : r.t === 5 ? 1.8 : 4;
function busNode(x, z) { const nr = nearestRoad(x, z, 250, r => r.t >= 1 && r.t <= 4) || nearestRoad(x, z, 500, r => r.t <= 5); return nr ? (nr.t < 0.5 ? nr.e.a : nr.e.b) : -1; }
function roadPath(s, g, strict) {   // A* over the street graph -> list of [node, edge]
  const gx = NX(g), gz = NZ(g), dist = new Map([[s, 0]]), prev = new Map(), h = new Heap(); h.push(0, s); let n = 0;
  while (h.size && n++ < 600000) {
    const [f, u] = h.pop(); if (u === g) break;
    const du = dist.get(u); if (f > du + Math.hypot(NX(u) - gx, NZ(u) - gz) + 1e-6) continue;
    for (const e of nodeEdges[u]) {
      const r = M.roads[e.r]; if (!isDriveType(r.t)) continue;
      if (strict && r.o && e.b === u) continue;   // one-way street, wrong direction
      const v = e.a === u ? e.b : e.a, nd = du + e.len * roadCost(r);
      if (nd < (dist.get(v) ?? 1e18)) { dist.set(v, nd); prev.set(v, [u, e]); h.push(nd + Math.hypot(NX(v) - gx, NZ(v) - gz), v); }
    }
  }
  if (!prev.has(g)) return null;
  const out = []; let c = g; while (c !== s) { const [p, e] = prev.get(c); out.push([c, e]); c = p; } return out.reverse();
}
// points every 10 m in the right-hand lane, at the height of the drawn street (bridges included)
function laneAdder(pts) { let py = null; return (x, z) => { const y = py === null ? walkY(x, z, heightAt(x, z) + 3) : walkY(x, z, py + 2.5); py = y; pts.push({ x, z, y: y + 0.05, tu: false }); }; }
function followLeg(add, from, leg) {
  let a = from;
  for (const [b, e] of leg) {
    const r = M.roads[e.r], side = r.o ? 0 : r.w / 4, ax = NX(a), az = NZ(a), dx = NX(b) - ax, dz = NZ(b) - az, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
    const k = Math.max(1, Math.ceil(L / 10));
    for (let j = 1; j <= k; j++) add(ax + dx * j / k - uz * side, az + dz * j / k + ux * side);
    a = b;
  }
}
const failedLegs = [];
function buildBusLine(B, rev) {
  const st = (rev ? B.stops.slice().reverse() : B.stops).map(([name, lat, lon]) => { const [x, z] = toXZ(lat, lon); return { name, x, z, n: busNode(x, z) }; });
  const pts = [], add = laneAdder(pts);
  for (let i = 0; i < st.length; i++) {
    const s = st[i];
    if (i === 0) { add(NX(s.n), NZ(s.n)); s.pi = 0; continue; }
    const leg = roadPath(st[i - 1].n, s.n, true) || roadPath(st[i - 1].n, s.n, false);
    if (leg) followLeg(add, st[i - 1].n, leg);
    else { failedLegs.push(B.id + (rev ? 'r' : '') + ': ' + st[i - 1].name + ' → ' + s.name); const p0 = pts[pts.length - 1]; for (let k = 1; k <= 30; k++) add(p0.x + (NX(s.n) - p0.x) * k / 30, p0.z + (NZ(s.n) - p0.z) * k / 30); }
    s.pi = pts.length - 1;
  }
  const lens = lensOf(pts);
  for (const s of st) { s.u = lens[s.pi]; s.under = false; }
  return { id: B.id + (rev ? 'r' : ''), route: B.id, group: B.id, name: B.name, color: B.color, kind: 'bus', both: false, st, pts, lens, total: lens[lens.length - 1] };
}
const shelterM = { post: std('#4a5568', { metalness: 0.7 }), glass: std('#9fb4bd', { metalness: 0.5, roughness: 0.1, transparent: true, opacity: 0.45 }), bench: std('#6b4f3a') };
function busShelter(P) {
  for (const s of P.st) {
    // put the shelter on the sidewalk to the right of the bus
    const p = pathAt(P, s.u), rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    const [kx, kz] = openSpot(p.x + rx * 6, p.z + rz * 6), gy = standY(kx, kz);
    const g = new THREE.Group(); g.position.set(kx, gy, kz); g.rotation.y = p.yaw; scene.add(g); farCull(g, 900);
    for (const x of [-1.6, 1.6]) addMesh(new THREE.BoxGeometry(0.12, 2.6, 0.12), shelterM.post, 0.6, 1.3, x, g);
    addMesh(new THREE.BoxGeometry(1.6, 0.12, 3.8), std(P.color), 0, 2.65, 0, g);
    addMesh(new THREE.BoxGeometry(0.06, 2.0, 3.4), shelterM.glass, 0.7, 1.3, 0, g);
    addMesh(new THREE.BoxGeometry(0.5, 0.45, 2.6), shelterM.bench, 0.3, 0.45, 0, g);
    const sg = stationSign(s.name, P.color, '🚌'); sg.scale.setScalar(0.6); sg.position.set(-0.2, 3.4, 0); sg.rotation.y = Math.PI / 2; g.add(sg);
    s.x = kx; s.z = kz;
    addStop(s.name, kx, kz, P, s, 'bus');
  }
}
const busRunners = [];
function initBuses() {
  for (const B of BUSES) {
    const fw = buildBusLine(B, false), bw = buildBusLine(B, true);
    lines.push(fw, bw); busShelter(fw); busShelter(bw);
    for (const P of [fw, bw]) busRunners.push({ P, g: busModel(P.color), u: 0, next: 1, dwell: P === bw ? 30 : 5 });
  }
}
function updateBuses(dt, pl) {
  for (const b of busRunners) {
    const P = b.P;
    if (b.dwell > 0) b.dwell -= dt;
    else {
      b.u += 13 * dt;
      const s = P.st[b.next];
      if (s && b.u >= s.u) { b.u = s.u; b.dwell = 8; b.next++; }
      if (b.u >= P.total) { b.u = 0; b.next = 1; b.dwell = 10; }
    }
    const p = pathAt(P, b.u), near = Math.hypot(p.x - pl.x, p.z - pl.z) < 1500;
    b.g.visible = near && !(ride && Math.hypot(p.x - pl.x, p.z - pl.z) < 20);
    if (near) { b.g.position.set(p.x, p.y, p.z); b.g.rotation.y = p.yaw; }
  }
}

// ---------- the network: stations of every line, joined into hubs where you can change ----------
export const lines = [];
const allSt = [];   // every station of every line
// short walks between stops with different names (counted as the same place for changing lines)
const WALK = [['Downtown fast-ferry dock', 'Waterfront'], ['Science World dock', 'Main Street–Science World'], ['Yaletown dock', 'Yaletown–Roundhouse'], ['Hastings & Burrard', 'Burrard'], ['Georgia & Granville', 'Granville'], ['Robson & Burrard', 'Burrard']];
let adj = [];
function buildNetwork() {
  allSt.length = 0;
  lines.forEach(P => P.st.forEach((s, i) => { s.P = P; s.i = i; s.id = allSt.length; allSt.push(s); if (s.x === undefined) { const p = pathAt(P, s.u); s.x = p.x; s.z = p.z; } }));
  // hubs: same name (and not silly far apart) or within a short walk
  const par = allSt.map((_, i) => i), find = i => par[i] === i ? i : (par[i] = find(par[i]));
  for (let a = 0; a < allSt.length; a++) for (let b = a + 1; b < allSt.length; b++) {
    const A = allSt[a], B = allSt[b], d = Math.hypot(A.x - B.x, A.z - B.z);
    if ((A.name === B.name && d < 900) || d < 220 || WALK.some(([p, q]) => (A.name === p && B.name === q) || (A.name === q && B.name === p))) par[find(a)] = find(b);
  }
  const hubName = new Map();
  allSt.forEach((s, i) => { const r = find(i); s.hub = r; if (!hubName.has(r) || s.P.kind === 'train') hubName.set(r, s.name); });
  allSt.forEach(s => s.hubName = hubName.get(s.hub));
  adj = allSt.map(() => []);
  const SPD = { train: 30, bus: 14, seabus: 12, ferry: 10, fast: 18, mini: 5, pickle: 5 };
  for (const s of allSt) {
    const P = s.P, sp = SPD[P.kind] || 12;
    const nx = P.st[s.i + 1]; if (nx) adj[s.id].push([nx.id, Math.abs(nx.u - s.u) / sp + 25]);
    const pv = P.st[s.i - 1]; if (pv && P.both) adj[s.id].push([pv.id, Math.abs(pv.u - s.u) / sp + 25]);
    for (const o of allSt) if (o.hub === s.hub && o.P !== P) adj[s.id].push([o.id, o.P.group === P.group ? 40 : 200]);
  }
}
// cheapest way from one hub to all others: returns {cost, prev}
function search(fromHub) {
  const cost = new Float64Array(allSt.length).fill(1e18), prev = new Int32Array(allSt.length).fill(-1), h = new Heap();
  for (const s of allSt) if (s.hub === fromHub) { cost[s.id] = 0; h.push(0, s.id); }
  while (h.size) { const [c, u] = h.pop(); if (c > cost[u]) continue; for (const [v, w] of adj[u]) if (c + w < cost[v]) { cost[v] = c + w; prev[v] = u; h.push(c + w, v); } }
  return { cost, prev };
}
// the trip from a hub to a hub, as legs (one per vehicle): [{P, from, to, dir}]
export function planTrip(fromHub, toHub, S = search(fromHub)) {
  let best = -1; for (const s of allSt) if (s.hub === toHub && S.cost[s.id] < 1e17 && (best < 0 || S.cost[s.id] < S.cost[best])) best = s.id;
  if (best < 0 || fromHub === toHub) return null;
  const ids = []; for (let c = best; c >= 0; c = S.prev[c]) ids.push(c); ids.reverse();
  const legs = [];
  for (let i = 1; i < ids.length; i++) {
    const a = allSt[ids[i - 1]], b = allSt[ids[i]];
    if (a.P !== b.P) continue;   // a change at a hub
    const L = legs[legs.length - 1];
    if (L && L.P === a.P && L.to === a) L.to = b; else legs.push({ P: a.P, from: a, to: b });
  }
  for (const L of legs) L.dir = Math.sign(L.to.u - L.from.u) || 1;
  return legs.length ? legs : null;
}
const tripFare = legs => { const cls = new Set(legs.map(L => fareOf(L.P))); let t = 0; for (const c of cls) t += FARES[c][0]; return { total: t, cls: [...cls] }; };

// ---------- background traffic ----------
const runners = [];
export function initTransit() {
  buildGraph();
  for (const L of LINES) { const P = buildLine(L); lines.push(P); buildStations(P); const n = P.total > 12000 ? 4 : P.total > 5000 ? 3 : 2; for (let k = 0; k < n; k++) runners.push({ P, cars: makeTrain(P.group === 'canada' ? 2 : 4, P.color), seg: Math.min(Math.floor(k * (P.st.length - 1) / n), P.st.length - 2), dir: k % 2 ? -1 : 1, t: 0, dwell: k * 6 }); }
  for (const B of BOATS) { const P = buildBoatLine(B); lines.push(P); if (P.id === 'seabus') seabus = { P, boats: [seabusModel(), seabusModel()] }; }
  initBuses();
  buildNetwork();
  if (dropped.length || failedLegs.length) console.warn('transit:', dropped, failedLegs);
}
function runnerPos(r) { const a = r.P.st[r.seg], b = r.P.st[r.seg + r.dir] || a; return a.u + (b.u - a.u) * r.t; }
export function updateTransit(dt, pl) {
  for (const r of runners) {
    if (!r.P.st[r.seg + r.dir]) r.dir = -r.dir;
    if (r.dwell > 0) r.dwell -= dt;
    else {
      const a = r.P.st[r.seg], b = r.P.st[r.seg + r.dir];
      r.t += dt * 22 / Math.max(50, Math.abs(b.u - a.u));
      if (r.t >= 1) { r.t = 0; r.seg += r.dir; r.dwell = 12; if (!r.P.st[r.seg + r.dir]) r.dir = -r.dir; }
    }
    const lead = pathAt(r.P, runnerPos(r)), near = Math.hypot(lead.x - pl.x, lead.z - pl.z) < 2500;
    if (near) placeTrain(r.P, r.cars, runnerPos(r), r.dir); else r.cars.forEach(c => c.visible = false);
  }
  if (seabus) seabus.boats.forEach((b, i) => {
    const cyc = 200, t = ((G.t + i * cyc / 2) % cyc) / cyc;   // 0..1: dwell, cross, dwell, cross back
    const f = t < 0.1 ? 0 : t < 0.5 ? (t - 0.1) / 0.4 : t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
    const p = pathAt(seabus.P, f * seabus.P.total);
    b.position.set(p.x, -0.3 + Math.sin(G.t * 0.8 + i) * 0.1, p.z); b.rotation.y = p.yaw + (t >= 0.5 ? Math.PI : 0);
    b.visible = !(ride && ride.P === seabus.P && Math.hypot(p.x - pl.x, p.z - pl.z) < 40);
  });
  updateBuses(dt, pl);
  updateRide(dt, pl);
}

// ---------- taxis: hail one (E) or call one from the phone, pick a destination, get driven there ----------
const TAXI_SPOTS = [
  ['🕰️ Gastown Steam Clock', 49.2844, -123.1089], ['🛶 Granville Island', 49.2712, -123.1340], ['🌲 Stanley Park (Lost Lagoon)', 49.2935, -123.1405],
  ['🏖️ Kits Beach', 49.2742, -123.1545], ['🏮 Chinatown', 49.2795, -123.1005], ['🔬 Science World', 49.2734, -123.1036],
  ['🛳️ Canada Place', 49.2878, -123.1112], ['🏟️ BC Place', 49.2768, -123.1119], ['☕ Commercial Drive', 49.2690, -123.0695],
  ['🐟 Lonsdale Quay', 49.3100, -123.0832], ['🚠 Grouse Mountain base', 49.3712, -123.0985], ['🍩 Deep Cove', 49.3285, -122.9485],
  ['✈️ YVR Airport', 49.1952, -123.1770], ['⛴️ Horseshoe Bay', 49.3765, -123.2715], ['🛍️ Metrotown', 49.2270, -123.0010], ['🎓 UBC', 49.2660, -123.2500],
];
export const TAXI_RATE = { base: 3.25, perKm: 1.95 };
const taxiFare = m => TAXI_RATE.base + TAXI_RATE.perKm * m / 1000;
function driveNode(x, z) { const nr = nearestRoad(x, z, 300, r => r.t <= 5) || nearestRoad(x, z, 1500, r => r.t <= 5); return nr ? (nr.t < 0.5 ? nr.e.a : nr.e.b) : -1; }
// a one-off road route (taxi / shuttle) from one spot to another
function roadRoute(fx, fz, tx, tz, name, kind) {
  const a = driveNode(fx, fz), b = driveNode(tx, tz); if (a < 0 || b < 0) return null;
  const leg = a === b ? [] : (roadPath(a, b, true) || roadPath(a, b, false)); if (!leg) return null;
  const pts = [], add = laneAdder(pts);
  add(NX(a), NZ(a)); followLeg(add, a, leg);
  if (pts.length < 2) add(NX(a) + 2, NZ(a) + 2);
  const lens = lensOf(pts), total = lens[lens.length - 1];
  return { id: kind, group: kind, name: kind === 'taxi' ? 'Taxi' : 'Shuttle', kind, color: kind === 'taxi' ? '#f2c230' : '#2b6cb0', both: false, pts, lens, total, st: [{ name: 'Pickup', u: 0, x: fx, z: fz }, { name, u: total, x: tx, z: tz }], dest: { x: tx, z: tz } };
}
function nearTaxi(pl) { let best = null, bd = 7; for (const v of vehicles) if (v.type === 'taxi' && !v.driver && !v.script) { const d = Math.hypot(v.x - pl.x, v.z - pl.z); if (d < bd) { bd = d; best = v; } } return best; }
// phone: a taxi pulls up next to you
export function callTaxi(pl) {
  if (ride || pl.vehicle) return;
  const nr = nearestRoad(pl.x, pl.z, 300, r => r.t <= 5);
  if (!nr) { ui.toast('🚕 No taxis out here', 'Dispatch laughed and hung up. Try somewhere with roads.', 3000); return; }
  const e = nr.e, x = NX(e.a) + (NX(e.b) - NX(e.a)) * nr.t, z = NZ(e.a) + (NZ(e.b) - NZ(e.a)) * nr.t;
  const v = makeVehicle('taxi', x, z, Math.atan2(-(NX(e.b) - NX(e.a)), -(NZ(e.b) - NZ(e.a))), { keep: true });
  ui.toast('🚕 Your taxi is here!', 'It pulled up right on time. A Vancouver miracle.', 2500);
  openTaxi(pl, v, true);
}
async function openTaxi(pl, v, called) {
  const am = activeMission();
  const dests = [];
  const wp = state.waypoint;
  if (wp) dests.push({ name: wp.label ? '📍 ' + wp.label : '📍 Your map waypoint', x: wp.x, z: wp.z });
  for (const h of PROPS) if (OWN.props.includes(h.id) && h.dx !== undefined) dests.push({ name: '🏠 ' + h.name, x: h.dx, z: h.dz + 2.5 });
  for (const [n, la, lo] of TAXI_SPOTS) { const [x, z] = toXZ(la, lo); if (Math.hypot(x - pl.x, z - pl.z) > 250) dests.push({ name: n, x, z }); }
  const est = d => '$' + taxiFare(Math.hypot(d.x - pl.x, d.z - pl.z) * 1.35).toFixed(0);
  const i = await ui.dialog('🚕 Taxi', pick(['Driver: "Where to, boss?"', 'Driver: "Hop in! Mind the coffee cups."', 'Driver: "Where we going? And please don\'t say the North Shore at rush hour."']) + (am ? '<br><small>Tip: set a waypoint on the phone map to go anywhere.</small>' : '<br><small>Set a waypoint on the phone map to go anywhere you like.</small>'), [...dests.map(d => `${d.name} (about ${est(d)})`), 'Never mind']);
  const d = dests[i]; if (!d) { if (called) removeVehicle(v); return; }
  const P = roadRoute(v.x, v.z, d.x, d.z, d.name.replace(/^\S+ /, ''), 'taxi');
  if (!P) { ui.toast('🚕 "I don\'t know how to get there."', 'The driver shrugs. Try a different place.', 3000); if (called) removeVehicle(v); return; }
  const fare = taxiFare(P.total);
  const pay = await ui.dialog('🚕 The meter', `The trip is ${(P.total / 1000).toFixed(1)} km. The meter says about <b>$${fare.toFixed(2)}</b>.`, [`💳 Pay $${fare.toFixed(2)}`, '🙈 "Oops, I forgot my wallet" (free, -1 karma)', 'Never mind']);
  if (pay === 2) { if (called) removeVehicle(v); return; }
  let paid = 0;
  if (pay === 0 && pl.money >= fare) { pl.money -= fare; paid = fare; sfx.coin(); }
  else { pl.karma -= 1; ui.toast(pay === 0 ? '💳 Card declined…' : '🙈 Free ride!', 'The driver sighs and drives anyway. (-1 karma)', 2500); }
  startTaxi(pl, v, P, paid);
}
function startTaxi(pl, v, P, paid) {
  v.ai = null; v.script = true; v.keep = true; v.speed = 0;   // take the taxi over: it now follows our route
  startRide(pl, [{ P, from: P.st[0], to: P.st[1], dir: 1 }], { veh: v, paid, chat: 6 });
  ui.toast('🚕 Off we go!', `Destination: ${P.st[1].name} · Space: speed up · Space again: skip · F = "let me out here!" · C = camera`, 3000);
}
const TAXI_CHAT = ['"You see the hockey game last night? Don\'t talk to me about it."', '"I used to be a dentist back home. Long story."', '"This traffic! It\'s the bridge. It\'s ALWAYS the bridge."', '"You mind if I put on some smooth jazz?"', '"My cousin owns a sushi place. Best in the city. I\'ll give you the card."', '"Rain again. You know what they say: no rain, no Vancouver."', '"You want the scenic route? Just kidding. Meter\'s running."', '"I drove a famous actor once. Very polite. Terrible tipper."'];

// ---------- phone Travel tab: a shuttle on the real roads, a seaplane, a helicopter, or the ferry ----------
// flight path: climbs off the start, stays well above the ground, glides down to the end
function flightRoute(fx, fz, tx, tz, name, kind) {
  const L = Math.hypot(tx - fx, tz - fz), n = Math.max(2, Math.ceil(L / 150)), raw = [];
  const water = kind === 'plane', cruise = water ? 420 : 260;
  for (let i = 0; i <= n; i++) { const t = i / n, x = fx + (tx - fx) * t, z = fz + (tz - fz) * t; raw.push({ x, z, h: Math.max(heightAt(x, z), 0) }); }
  const y0 = water ? 0 : standY(fx, fz), y1 = water ? 0 : standY(tx, tz), climb = water ? 0.14 : 0.35;
  const pts = raw.map((p, i) => { let m = 0; for (let j = Math.max(0, i - 12); j <= Math.min(n, i + 12); j++) m = Math.max(m, raw[j].h); return { x: p.x, z: p.z, y: Math.max(cruise, m + 160) }; });
  for (let k = 0; k < 3; k++) for (let i = 1; i < n; i++) pts[i].y = Math.max(pts[i].y * 0.5 + (pts[i - 1].y + pts[i + 1].y) * 0.25, raw[i].h + 90);
  for (let i = 0; i <= n; i++) { const d0 = i / n * L, d1 = L - d0, run = water ? 500 : 30; pts[i].y = Math.min(pts[i].y, y0 + Math.max(0, d0 - run) * climb, y1 + Math.max(0, d1 - run) * climb); if (!water) pts[i].y = Math.max(pts[i].y, raw[i].h + Math.min(d0, d1, 40)); }
  pts[0].y = y0; pts[n].y = y1;
  const lens = lensOf(pts), total = lens[lens.length - 1];
  return { id: kind, group: kind, name: kind === 'plane' ? 'Harbour Err seaplane' : 'Helicopter', kind, color: '#1f4e8c', both: false, pts, lens, total, st: [{ name: 'Departure', u: 0, x: fx, z: fz }, { name, u: total, x: tx, z: tz }], dest: { x: tx, z: tz } };
}
const findLine = id => lines.find(P => P.id === id);
// returns true when a watchable ride started (main.js falls back to a plain teleport otherwise)
export function travelTo(t, pl) {
  if (ride) return true;
  const [label, la, lo] = t, [tx, tz] = toXZ(la, lo), name = label.replace(/^\S+ /, '');
  let legs = null, opts = { travel: true };
  if (/Ferry to Victoria/.test(label) || /Ferry to Nanaimo/.test(label)) {
    const P = findLine(/Victoria/.test(label) ? 'bcf1' : 'bcf2'), from = P.st[0], to = P.st[1];
    const stop = stops.find(s => s.s === from); pl.teleport(stop.x, stop.z); prebuildChunksNear(stop.x, stop.z);
    legs = [{ P, from, to, dir: 1 }];
    ui.toast('🚌 Shuttle to the ferry', `The shuttle dropped you at ${from.name}. You boarded the ${P.name.split(': ')[0]}.`, 3500);
  } else if (/seaplane|Tofino/.test(label)) {
    const [sx, sz] = findWater(...toXZ(49.2905, -123.1180), 20), dest = /Tofino/.test(label) ? toXZ(49.1530, -125.9060) : toXZ(48.4235, -123.3700), [ex, ez] = findWater(dest[0], dest[1], 20, 3000);
    pl.teleport(...landSpot(sx, sz)); const P = flightRoute(sx, sz, ex, ez, /Tofino/.test(label) ? 'Tofino harbour' : 'Victoria Inner Harbour', 'plane'); P.land = landSpot(ex, ez); P.land2 = /Tofino/.test(label) ? [tx, tz] : null;
    legs = [{ P, from: P.st[0], to: P.st[1], dir: 1 }];
  } else {
    const P = roadRoute(pl.x, pl.z, tx, tz, name, 'shuttle');
    const end = P && P.pts[P.pts.length - 1];
    if (P && Math.hypot(end.x - tx, end.z - tz) < 400 && Math.hypot(P.pts[0].x - pl.x, P.pts[0].z - pl.z) < 1500 && P.total > 300) legs = [{ P, from: P.st[0], to: P.st[1], dir: 1 }];
    else { const H = flightRoute(pl.x, pl.z, ...openSpot(tx, tz), name, 'heli'); legs = [{ P: H, from: H.st[0], to: H.st[1], dir: 1 }]; }
  }
  if (!legs) return false;
  startRide(pl, legs, opts);
  const P = legs[0].P;
  if (P.kind === 'shuttle') ui.toast('🚐 Shuttle to ' + name, 'Sit back and watch the road. Space: speed up · Space again: skip · C = camera', 3500);
  else if (P.kind === 'heli') ui.toast('🚁 Helicopter to ' + name, 'No road goes there from here, so a heli-taxi picked you up. Space: speed up · Space again: skip', 3500);
  else if (P.kind === 'plane') ui.toast('🛩️ Harbour Err seaplane', 'Seatbelts on. The pilot says the wobble is "totally normal". Space: speed up · Space again: skip', 3500);
  return true;
}

// ---------- riding ----------
let ride = null, camPref = 0;
export const isOnTransit = () => !!ride;
const icon = P => ({ taxi: '🚕', bus: '🚌', shuttle: '🚐', seabus: '⛴️', ferry: '⛴️', fast: '🚤', mini: '🌈', pickle: '🥒', plane: '🛩️', heli: '🚁' })[P.kind] || '🚆';
const lineLabel = P => P.kind === 'bus' ? 'Bus ' + P.name : P.name + (P.branch ? ' (' + P.branch + ')' : '');
export const rideName = () => ride ? (ride.P.kind === 'taxi' ? '🚕 In a taxi' : icon(ride.P) + ' On the ' + (ride.P.kind === 'bus' ? ride.P.name + ' bus' : ride.P.name)) + ' → ' + ride.dest.name : '';
const tunnelEl = () => document.getElementById('tunnel');
// the ride vehicle for a leg
function makeModel(P, opts) {
  if (P.kind === 'train') return { cars: makeTrain(P.group === 'canada' ? 2 : 4, P.color), len: 70, eye: 2.4 };
  if (P.kind === 'bus' || P.kind === 'shuttle') return { g: busModel(P.color), len: 12, eye: 2.6, seat: 1.2 };
  if (P.kind === 'seabus') return { g: seabusModel(), yoff: -0.3, len: 34, eye: 5.5, seat: 3.4 };
  if (P.kind === 'ferry') return { g: ferryModel(), len: 150, eye: 14, seat: 11 };
  if (P.kind === 'fast') return { g: catModel(), len: 34, eye: 4.5, seat: 3 };
  if (P.kind === 'mini') return { g: miniModel(), len: 8, eye: 2, seat: 1 };
  if (P.kind === 'pickle') return { g: pickleModel(), len: 6, eye: 2, seat: 1 };
  if (P.kind === 'taxi') return { v: opts.veh, len: 4.6, eye: 1.3 };
  const p0 = P.pts[0], v = makeVehicle(P.kind === 'plane' ? 'seaplane' : 'heli', p0.x, p0.z, 0, { keep: true, y: p0.y });
  v.script = true; v.ai = null; v.rotorSpin = 1;
  return { v, len: 10, eye: 2.4, fly: true };
}
function dropModel(m) { if (!m) return; if (m.cars) m.cars.forEach(c => scene.remove(c)); if (m.g) scene.remove(m.g); if (m.v) removeVehicle(m.v); }
// real-life pace (m/s): top speed, acceleration, how long the doors stay open at a stop
const BASE = { train: 22, bus: 12, shuttle: 20, taxi: 13, seabus: 5.5, ferry: 10.5, fast: 15, mini: 3.5, pickle: 3, plane: 55, heli: 50 };
const ACC = { train: 1.0, bus: 1.3, shuttle: 1.5, taxi: 2.0, seabus: 0.35, ferry: 0.2, fast: 0.5, mini: 0.4, pickle: 0.4, plane: 3, heli: 3 };
const DWELL = { train: 18, bus: 7, mini: 10, pickle: 10 };
const ROADISH = new Set(['bus', 'shuttle', 'taxi']);
// Space once = fast-forward (this many times faster), Space again = skip to the destination
const FF = k => ['ferry', 'fast', 'shuttle', 'plane', 'heli'].includes(k) ? 8 : 6;
let hintEl = null;
function rideHint(text) {
  if (!hintEl) { hintEl = document.createElement('div'); hintEl.style.cssText = 'position:fixed;top:62px;left:50%;transform:translateX(-50%);background:rgba(10,20,30,.62);color:#fff;padding:5px 14px;border-radius:999px;font:600 14px Segoe UI,Arial,sans-serif;z-index:9;pointer-events:none;white-space:nowrap'; document.body.appendChild(hintEl); }
  hintEl.style.display = text ? '' : 'none'; if (text && hintEl.innerHTML !== text) hintEl.innerHTML = text;
}
function startRide(pl, legs, opts = {}) {
  ride = { legs, li: -1, dest: legs[legs.length - 1].to, passed: new Set(), seen: new Set(), orbit: 0, camT: 0, ev: 20 + Math.random() * 25, mul: _t.mul, ff: false, v: 0, sm: null, ...opts };
  pl.transit = true; pl.model.grp.visible = false; ride.camDist = G.camDist;
  pl.stats.rideTransit = pl.stats.rideTransit || new Set(); pl.stats.rideBus = pl.stats.rideBus || new Set();
  nextLeg(pl);
}
function nextLeg(pl) {
  const prevP = ride.P;
  if (ride.m && !(ride.m.v && ride.m.v === ride.veh && ride.li < ride.legs.length - 1)) dropModel(ride.m);
  ride.li++; const L = ride.legs[ride.li];
  Object.assign(ride, { P: L.P, from: L.from, to: L.to, dir: L.dir, u: L.from.u, dwell: L.P.kind === 'train' ? 5 : ride.li ? 4 : 1.5, m: makeModel(L.P, ride), v: 0, sm: null });
  ride.speed = BASE[L.P.kind] || 15;
  ride.passed = new Set([L.from.name]);
  const P = L.P;
  if (P.kind !== 'taxi' && P.kind !== 'shuttle' && P.kind !== 'plane' && P.kind !== 'heli') pl.stats.rideTransit.add(P.group === 'expo' ? 'expo' : P.group === 'canada' ? 'canada' : P.id);
  if (P.kind === 'bus') pl.stats.rideBus.add(P.route);
  const nextSt = P.st[P.st.indexOf(L.from) + L.dir];
  if (prevP) ui.toast(`🔁 Change at ${L.from.hubName}`, `Now the ${icon(P)} ${lineLabel(P)} → ${L.to.name}${nextSt && nextSt !== L.to ? ' · next: ' + nextSt.name : ''}`, 3200);
  else if (P.kind === 'train') ui.toast(`🚆 ${lineLabel(P)} → ${L.to.name}`, `🎶 Ding-ding-DING! Doors closing… next: ${nextSt?.name ?? L.to.name} · Space: speed up · Space again: skip · C: camera`, 3800);
  else if (P.kind === 'bus') ui.toast(`🚌 ${P.name}`, `The driver nods. You say "thank you" like a true Vancouverite. Next stop: ${nextSt?.name ?? L.to.name} · Space: speed up · C: camera`, 3800);
  else if (P.kind === 'seabus') ui.toast('⛴️ All aboard the SeaBus!', 'Next stop: ' + L.to.name + ' · Space: speed up · Space again: skip', 3200);
  else if (P.kind === 'ferry') ui.toast('⛴️ ' + P.name, '"Welcome aboard the BC Fairies. The Coastal Café is now open." · Space: speed up · Space again: skip', 4000);
  else if (P.kind === 'fast') ui.toast('🚤 Hullabaloo fast ferry', '70 minutes to Nanaimo, downtown to downtown. The seats recline. Barely. · Space: speed up', 3800);
  else if (P.kind === 'mini') ui.toast('🌈 Rainbow Ferry', `"Next stop ${nextSt?.name ?? L.to.name}!" The skipper also does the jokes. · Space: speed up`, 3500);
  else if (P.kind === 'pickle') ui.toast('🥒 Pickle Boat', 'Twelve seats, one skipper, zero dignity. Next stop: ' + (nextSt?.name ?? L.to.name), 3500);
}
function finishRide(pl, napped) {
  const P = ride.P, d = ride.dest;
  let x, z;
  if (P.kind === 'taxi' || P.kind === 'shuttle') { const p = pathAt(P, P.total); [x, z] = openSpot(p.x, p.z, 80); }
  else if (P.kind === 'heli') [x, z] = openSpot(P.dest.x, P.dest.z, 200);
  else if (P.kind === 'plane') [x, z] = P.land2 ? openSpot(...P.land2, 200) : P.land;
  else { const stop = stops.find(s => s.s === d) || stops.find(s => s.s.hub === d.hub && s.P === P) || stops.find(s => s.s.hub === d.hub); [x, z] = stop ? [stop.ax, stop.az] : openSpot(d.x, d.z); }
  pl.x = x; pl.z = z; pl.y = standY(x, z); pl.vy = 0;
  if (napped || ride.travel) prebuildChunksNear(x, z);
  dropModel(ride.m); rideHint('');
  G.camDist = ride.camDist; pl.transit = false; pl.model.grp.visible = true; tunnelEl()?.classList.add('hidden');
  ui.toast('✅ Arrived: ' + d.name, P.kind === 'seabus' ? 'Mind the gap between the boat and the dock.' : P.kind === 'taxi' ? 'The driver says: "Please rate me 5 stars!" You do. You always do.' : P.kind === 'bus' ? 'You yell "THANK YOU!" from the back door. The driver waves. Peak Vancouver.' : P.kind === 'ferry' ? 'Foot passengers disembark first. You walk past 400 idling cars feeling smug.' : P.kind === 'plane' ? 'The pilot ties up at the float dock. Your ears pop. Welcome!' : P.kind === 'heli' ? 'The heli lands, you duck under the rotor like in the movies.' : P.kind === 'shuttle' ? 'The shuttle hisses to a stop. Everyone claps for the driver.' : P.kind === 'train' ? 'Thank you for riding SkyTrain. Please take all your belongings, including your dignity.' : 'The skipper ties up and waves you off. "Mind your step!"', 3000);
  const fin = ride; ride = null;
  if (['train', 'bus', 'seabus', 'taxi'].includes(P.kind)) pl.onTransitArrive?.(P, d);   // (missions.js turns these into secrets)
  else { pl.stats.lastStop = d.name; pl.stats.lastLine = P.id; }
  return fin;
}
// sights out the window, and things that happen on board
const VIEWS = [
  [49.2734, -123.1036, 260, ['train', 'bus', 'mini'], '🔭 Out the window: Science World', 'The giant geodesic "golf ball", built for Expo 86. Its 766 lights twinkle at night.'],
  [49.2768, -123.1119, 260, ['train', 'bus'], '🏟️ BC Place', 'The white crown-shaped roof is held up by cables. It changes colour at night.'],
  [49.2040, -123.1175, 450, ['train'], '🌊 Crossing the Fraser River', 'The Canada Line shares this bridge with a bike and walking path. Look for log booms below!'],
  [49.2030, -122.8890, 600, ['train'], '🌉 The SkyBridge', 'When it opened in 1990 it was the longest cable-stayed bridge in the world built just for trains.'],
  [49.2258, -123.0039, 320, ['train', 'bus'], '🛍️ Metrotown', 'BC\'s biggest shopping mall. You can smell the food court from the platform.'],
  [49.2440, -122.9450, 900, ['train'], '🦆 Burnaby Lake', 'Herons, beavers and a regional park, right beside the tracks.'],
  [49.1960, -123.1500, 500, ['train'], '✈️ Planes!', 'A jet roars low over the train on final approach to YVR. Everyone films it.'],
  [49.3150, -123.1385, 700, ['bus', 'seabus'], '🌉 Lions Gate Bridge', 'Opened in 1938 and paid for by the Guinness family (yes, the beer people) to sell houses in West Van.'],
  [49.2985, -123.0975, 600, ['seabus'], '🏙️ Look back!', 'The downtown skyline with the mountains behind. Best $3.15 view in the city.'],
  [48.8640, -123.3170, 3000, ['ferry'], '🐋 Active Pass', 'The captain slows right down: "Orcas off the starboard side!" Half the ferry runs to one window.'],
  [49.3600, -123.3600, 3500, ['ferry'], '🏝️ Bowen Island', 'The ferry swings past Bowen Island. Someone points out Snug Cove. Everyone nods knowingly.'],
  [49.2860, -123.4800, 6000, ['fast'], '🌊 The Strait of Georgia', 'Open water as far as you can see. A seagull keeps pace with the boat for a weirdly long time.'],
  [49.2715, -123.1340, 220, ['mini'], '🛶 Granville Island', 'The market, the cement plant with the giant painted silos, and a busker playing "Wonderwall".'],
  [48.4228, -123.3826, 200, ['pickle'], "🐟 Fisherman's Wharf", 'Floating homes painted every colour, and a seal begging for fish and chips.'],
  [49.3712, -123.0985, 600, ['bus'], '🚠 Grouse Mountain', 'The Skyride gondola climbs right above you. The Grouse Grind hikers look… tired.'],
];
const EVENTS = {
  train: [['🎸 A busker gets on', 'He plays a surprisingly good "Hallelujah" between stations.', { label: '🎸 Tip the busker $2', cost: 2, karma: 1, msg: 'He nods and plays a little encore just for you. (+1 karma)' }], ['🦝 A raccoon gets on', 'It rides one stop, stares at everyone, and gets off like it pays rent here.'], ['🚲 Bike traffic jam', 'Three cyclists try to fit in one doorway. Nobody wins.'], ['🪑 You got the front seat!', 'SkyTrain has no driver: the very front window is the best seat in town. Press C for the front-seat view.'], ['📢 "Please do not hold the doors."', 'Someone holds the doors anyway. The whole train sighs.']],
  bus: [['🏄 A guy with a full-size surfboard', 'He gets on the bus anyway. He says sorry 14 times.'], ['🔔 Someone rings the bell twice', 'Rookie.'], ['🐕 A dog in a raincoat', 'It stares at you the whole ride. You feel judged.'], ['🎸 A busker on the bus', 'He only knows one song. He plays it three times.', { label: '🎸 Tip him $2', cost: 2, karma: 1, msg: 'He plays it a fourth time. For you. (+1 karma)' }]],
  seabus: [['☕ Coffee on the water', 'The SeaBus has no café, but a guy is selling coffee out of a thermos.', { label: '☕ Buy a thermos coffee ($3)', cost: 3, buff: true, msg: 'It is… actually good. You feel fast. (run boost)' }], ['🦭 A harbour seal', 'It pops up next to the SeaBus and gives you a long, judgmental look.']],
  ferry: [['🍳 The Sunshine Breakfast', 'The Coastal Café is serving the famous Sunshine Breakfast.', { label: '🍳 Buy a Sunshine Breakfast ($13.95)', cost: 13.95, heal: true, msg: 'Eggs, bacon, hash browns, toast. Fully healed. This is the real reason people take the ferry.' }], ['📢 "Would the owner of a silver minivan…"', '"…please return to the car deck. Your alarm is going off." It is always a silver minivan.'], ['🧒 A kid runs the whole deck', 'Around and around. For 90 minutes. Respect.']],
  fast: [['🌊 Bumpy crossing', 'The fast ferry bounces over a swell. Someone\'s latte is now on the ceiling.'], ['🐬 Dolphins!', 'Pacific white-sided dolphins race the bow for a minute. Everyone cheers.']],
  mini: [['🦆 Ducks', 'A family of ducks refuses to move. The skipper waits. Ducks have right of way.'], ['🎶 Skipper singalong', 'The skipper sings a sea shanty. Off key. Nobody minds.']],
  pickle: [['🦭 Seal escort', 'A harbour seal follows the boat, hoping for fish.'], ['🩰 Pickle boat pirouette', 'The skipper spins the boat in a full circle "just because". Everyone screams.']],
  taxi: [], shuttle: [['📻 Radio wars', 'The driver and a passenger argue about the radio station. Smooth jazz wins.'], ['🦅 Bald eagle!', 'One sits in a tree right by the road. The whole shuttle goes "ooooh".']], plane: [['🌊 Gulf Islands below', 'Islands, boats, and a ferry crawling across the strait like a toy.'], ['🎧 The pilot\'s playlist', 'He has one song. It\'s "Danger Zone".']], heli: [['🏔️ Mountain views', 'Glaciers, lakes and forest as far as you can see. You forget to breathe.']],
};
function liveSights(pl) {
  for (const V of VIEWS) { if (!V[3].includes(ride.P.kind) || ride.seen.has(V[4])) continue; const [x, z] = toXZ(V[0], V[1]); if (Math.hypot(pl.x - x, pl.z - z) < V[2]) { ride.seen.add(V[4]); ui.toast(V[4], V[5], 4500); return; } }
}
const _p = {}, _p2 = {}, _q2 = {}, _cam = new THREE.Vector3(), _look = new THREE.Vector3();
function updateRide(dt, pl) {
  if (!ride) { tunnelEl()?.classList.add('hidden'); if (hintEl && hintEl.style.display !== 'none') rideHint(''); return; }
  const P = ride.P, p0 = pathAt(P, ride.u, _p);
  // F in a taxi or shuttle: the driver pulls over and you get out early (taxi: you only pay for the distance driven)
  if ((P.kind === 'taxi' || P.kind === 'shuttle') && tapped('KeyF')) {
    const [x, z] = openSpot(p0.x, p0.z, 80), used = Math.min(ride.paid || 0, taxiFare(Math.max(0, ride.u - ride.from.u))), back = (ride.paid || 0) - used;
    pl.x = x; pl.z = z; pl.y = standY(x, z); pl.vy = 0;
    if (back > 0.5) { pl.money += back; sfx.coin(); }
    dropModel(ride.m); rideHint(''); G.camDist = ride.camDist; pl.transit = false; pl.model.grp.visible = true; ride = null; tunnelEl()?.classList.add('hidden');
    ui.toast('🚕 "Let me out here!"', back > 0.5 ? `The driver pulls over and refunds the rest of the meter: +$${back.toFixed(2)}. "Have a good one, boss!"` : 'The driver pulls over. "Suit yourself, boss!"', 3000);
    return;
  }
  if (tapped('KeyC')) { camPref = (camPref + 1) % 4; ui.toast(['🎥 Chase camera', '🪟 Window seat', '🪑 Front seat', '🖱️ Free look (mouse)'][camPref], 'Press C to switch the ride camera', 1500); }
  if (ride.offer && tapped('KeyE')) {
    const o = ride.offer; ride.offer = null;
    if (pl.money >= o.cost) { pl.money -= o.cost; sfx.coin(); if (o.karma) pl.karma += o.karma; if (o.heal) pl.health = 100; if (o.buff) pl.buffT = 90; ui.toast('✅ ' + o.label.replace(/^\S+ /, ''), o.msg, 3500); }
    else ui.toast('💸 Not enough cash', 'Maybe next time.', 2000);
  }
  // Space once = fast-forward, Space again = skip straight to the destination
  if (tapped('Space')) {
    if (!ride.ff) { ride.ff = true; ui.toast('⏩ Fast-forward', `×${FF(P.kind)} speed. Press Space again to skip straight to ${ride.dest.name}.`, 2200); }
    else {
      ui.toast('⏭️ Skipped ahead…', P.kind === 'taxi' ? 'You dozed off in the back seat. The driver nudges you awake: "We\'re here!"' : ride.legs.length - ride.li > 1 ? 'Zzz… you sleepwalked through the transfer and woke up just in time for your stop!' : 'Zzz… and woke up just in time for your stop!', 2200);
      while (ride.li < ride.legs.length - 1) nextLeg(pl);
      ride.u = ride.to.u; rideHint(''); finishRide(pl, true); return;
    }
  }
  rideHint(ride.ff ? `⏩ Fast-forward ×${FF(P.kind)} · <b>Space</b> again: skip` : '<b>Space</b>: speed up · <b>Space</b> again: skip · <b>C</b>: camera');
  // real-pace motion: accelerate, slow for corners (road vehicles), brake for the next stop, wait at stops
  const dtE = dt * (ride.ff ? FF(P.kind) : 1) * ride.mul, stopsHere = DWELL[P.kind] !== undefined;
  if (ride.dwell > 0) ride.dwell -= dtE;
  else {
    let stopS = ride.to;
    if (stopsHere) for (const s of P.st) if (!ride.passed.has(s.name) && s !== ride.to && (ride.dir > 0 ? s.u > ride.u - 0.01 && s.u < ride.to.u : s.u < ride.u + 0.01 && s.u > ride.to.u)) { if (!stopS || (s.u - ride.u) * ride.dir < (stopS.u - ride.u) * ride.dir) stopS = s; }
    const d = Math.max(0, (stopS.u - ride.u) * ride.dir), acc = (ACC[P.kind] || 1);
    let target = ride.speed;
    if (ROADISH.has(P.kind)) {   // corners: about 2.5 m/s² sideways at most
      const a = pathAt(P, ride.u, _p2).yaw, b = pathAt(P, ride.u + ride.dir * 25, _q2).yaw, turn = Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
      target = Math.min(target, Math.max(4.5, Math.sqrt(62 / Math.max(turn, 0.01))));
    }
    target = Math.min(target, Math.sqrt(2 * acc * 1.1 * d) + 0.4);
    ride.v = ride.v < target ? Math.min(target, ride.v + acc * dtE) : Math.max(target, ride.v - acc * 2.5 * dtE);
    const step = ride.v * dtE;
    if (step >= d) {
      ride.u = stopS.u; ride.v = 0;
      if (stopS !== ride.to) {   // doors open at a station along the way
        ride.passed.add(stopS.name); ride.dwell = DWELL[P.kind];
        const nx = P.st[stopS.i + ride.dir]; ui.toast('🔔 ' + stopS.name, nx ? (Math.random() < 0.5 ? `Next stop: ${nx.name}` : pickLine(P)) : pickLine(P), 2400);
      }
    } else ride.u += ride.dir * step;
    // boats / taxis just pass any stations on the way
    if (!stopsHere) for (const s of P.st) if (!ride.passed.has(s.name) && s !== ride.to && (ride.dir > 0 ? ride.u >= s.u && s.u > ride.from.u : ride.u <= s.u && s.u < ride.from.u)) { ride.passed.add(s.name); ui.toast('🔔 ' + s.name, pickLine(P), 1600); }
  }
  const done = ride.dwell <= 0 && ride.u === ride.to.u;
  const p = pathAt(P, ride.u, _p), m = ride.m, back = ride.dir < 0 ? Math.PI : 0;
  // a smoothed pose: heading from a chord over ±5 m (no jolts at path corners), height eased (no jitter)
  const pa = pathAt(P, ride.u - 5, _p2), pb = pathAt(P, ride.u + 5, _q2), chord = Math.hypot(pb.x - pa.x, pb.z - pa.z) > 0.5 ? Math.atan2(-(pb.x - pa.x), -(pb.z - pa.z)) : p.yaw;
  if (!ride.sm) ride.sm = { y: p.y, yaw: chord + back };
  const k = 1 - Math.exp(-dtE * 7), dy = chord + back - ride.sm.yaw;
  ride.sm.yaw += Math.atan2(Math.sin(dy), Math.cos(dy)) * k; ride.sm.y += (p.y - ride.sm.y) * (m.fly ? 1 : k);
  const yaw = ride.sm.yaw, Y = ride.sm.y;
  if (m.cars) placeTrain(P, m.cars, ride.u, ride.dir);
  else if (m.g) { m.g.position.set(p.x, Y + (m.yoff || 0) + (['seabus', 'ferry', 'fast', 'mini', 'pickle'].includes(P.kind) ? Math.sin(G.t * 0.9) * 0.08 : 0), p.z); m.g.rotation.y = yaw; m.g.visible = true; }
  else if (m.v) {
    const v = m.v, pitch = m.fly ? Math.atan2(pb.y - pa.y, Math.hypot(pb.x - pa.x, pb.z - pa.z) || 1) : 0;
    v.x = p.x; v.z = p.z; v.y = Y; v.yaw = yaw; v.pitch = pitch; v.roll = 0; v.speed = 0; v.g.position.set(p.x, Y, p.z); v.g.rotation.set(pitch, yaw, 0, 'YXZ');
    if (v.prop) v.prop.rotation.z += dt * 40; if (v.rotor) v.rotor.rotation.y += dt * 30;
  }
  pl.x = p.x; pl.z = p.z; pl.y = p.tu ? standY(p.x, p.z) + 2 : Y + (m.seat ?? 1.5); pl.vy = 0; ride.pose = { x: p.x, y: Y, z: p.z, yaw, tu: p.tu };
  const t = tunnelEl();
  if (t) { t.classList.toggle('hidden', !p.tu); if (p.tu) { const next = P.st.find(s => ride.dir > 0 ? s.u > ride.u : s.u < ride.u); t.innerHTML = `🚇 Underground on the ${P.name}<small>Next stop: ${next?.name ?? ride.to.name} · Space: ${ride.ff ? 'skip to ' + ride.dest.name : 'speed up'}</small>`; } }
  if (ride.veh && P.kind === 'taxi') { ride.chat -= dt; if (ride.chat < 0) { ride.chat = 13; ui.toast('🚕 Driver', pick(TAXI_CHAT), 3500); } }
  // surprises: sights out the window + one thing that happens on board
  liveSights(pl);
  ride.ev -= dt * ride.mul; if (ride.ev < 0 && !ride.evDone) { ride.evDone = true; const E = EVENTS[P.kind] || []; if (E.length && Math.random() < 0.85) { const e = pick(E); ui.toast(e[0], e[1] + (e[2] ? ` · press E: ${e[2].label}` : ''), 5000); ride.offer = e[2] || null; } }
  if (done) { if (ride.li < ride.legs.length - 1) nextLeg(pl); else finishRide(pl, false); }
}
// the ride camera (called from main.js after the normal camera): chase / window / front seat / free look
export function rideCamera(cam, dt) {
  if (!ride || !ride.pose || camPref === 3) return;
  const q = ride.pose, m = ride.m || {}, fx = -Math.sin(q.yaw), fz = -Math.cos(q.yaw), rx = -fz, rz = fx;
  if (G.mouse.dx) ride.orbit -= G.mouse.dx * 0.0025;
  const snap = ride.camT++ < 2;
  if (camPref === 0) {
    const d = { train: 30, bus: 16, shuttle: 16, taxi: 10, seabus: 48, ferry: 170, fast: 55, mini: 14, pickle: 12, plane: 26, heli: 24 }[ride.P.kind] || 25;
    const a = ride.orbit, cx = fx * Math.cos(a) - rx * Math.sin(a), cz = fz * Math.cos(a) - rz * Math.sin(a);
    const lead = ride.P.kind === 'train' ? 0 : 0, hy = q.tu ? standY(q.x, q.z) + 3 : q.y;
    _cam.set(q.x + fx * lead - cx * d, hy + d * 0.38 + 3, q.z + fz * lead - cz * d);
    const gy = Math.max(groundY(_cam.x, _cam.z), 0) + 2; if (_cam.y < gy) _cam.y = gy;
    _look.set(q.x + fx * 8, hy + 2, q.z + fz * 8);
  } else if (camPref === 1) {   // window seat: look out the right-hand side, a bit forward
    const side = ride.P.kind === 'ferry' ? 13 : ride.P.kind === 'seabus' ? 7.5 : 1.4, a = ride.orbit * 0.5;
    _cam.set(q.x + rx * side, q.y + (m.eye || 2.4), q.z + rz * side);
    _look.set(_cam.x + (rx * Math.cos(a) + fx * (0.5 + Math.sin(a))) * 20, _cam.y - 1.5, _cam.z + (rz * Math.cos(a) + fz * (0.5 + Math.sin(a))) * 20);
  } else {   // front seat
    const f = (m.len || 10) / 2 + 0.3;
    _cam.set(q.x + fx * f, q.y + (m.eye || 2.4), q.z + fz * f);
    _look.set(_cam.x + fx * 30 + rx * Math.sin(ride.orbit) * 30, _cam.y - 2, _cam.z + fz * 30 + rz * Math.sin(ride.orbit) * 30);
  }
  // window / front seat ride with the (already smoothed) vehicle; the chase camera follows softly
  if (snap || camPref) cam.position.copy(_cam); else cam.position.lerp(_cam, 1 - Math.exp(-dt * 3.5));
  cam.lookAt(_look);
}
function pickLine(P) { const a = P?.kind === 'bus' ? ['Someone is having a loud phone call on speaker.', 'A guy with a bike rack question holds up the whole bus.', '"Please move to the back of the bus!"', 'The bus hits a pothole. Your coffee survives. Barely.'] : P?.kind === 'train' ? ['"Please hold on, the train is about to move."', 'Someone is eating a very smelly burrito.', 'Everyone is staring at their phones.', '"Doors closing."', 'You make accidental eye contact. Awkward.', '🎶 Ding-ding-DING!'] : ['The skipper waves at another boat.', 'A gull lands on the railing and eyes your snack.', 'Spray in your face. Refreshing!']; return a[Math.floor(Math.random() * a.length)]; }

// ---------- ticket machines ----------
export function transitPrompt(pl) {
  if (ride) return ride.offer ? `<kbd>E</kbd> ${ride.offer.label} · <kbd>C</kbd> camera · <kbd>Space</kbd> speed up / skip` : '';
  if (pl.vehicle || activeMission()?.m.usesE) return '';   // missions that use E for their own actions
  for (const s of stops) {
    if (Math.abs(s.x - pl.x) > 18 || Math.abs(s.z - pl.z) > 18 || Math.hypot(s.x - pl.x, s.z - pl.z) > 18) continue;
    if (tapped('KeyE')) openTicketMachine(s, pl);
    return `<kbd>E</kbd> ${s.kind === 'boat' ? icon(s.P) + ' Take the ' + s.P.name.split(':')[0] : s.kind === 'bus' ? '🚌 Catch a bus' : '🚆 Take the SkyTrain'} at ${s.name}`;
  }
  const tv = nearTaxi(pl);
  if (tv) { if (tapped('KeyE')) openTaxi(pl, tv, false); return '<kbd>E</kbd> 🚕 Hail this taxi'; }
  return '';
}
// what you can reach from a stop, grouped by line: [{key, title, here, dests:[{hub, name, legs}]}]
export function destinationsFrom(stop) {
  const S = search(stop.s.hub), groups = new Map(), seenHub = new Set([stop.s.hub]);
  const order = [...lines].sort((a, b) => (b.st.some(s => s.hub === stop.s.hub) ? 1 : 0) - (a.st.some(s => s.hub === stop.s.hub) ? 1 : 0));
  for (const P of order) {
    const gk = P.kind === 'bus' ? P.route : P.group;
    for (const s of P.st) {
      if (seenHub.has(s.hub) || S.cost[s.id] > 1e17) continue;
      const legs = planTrip(stop.s.hub, s.hub, S); if (!legs) continue;
      seenHub.add(s.hub);
      if (!groups.has(gk)) groups.set(gk, { key: gk, title: icon(P) + ' ' + (P.kind === 'bus' ? 'Bus ' + P.name : P.name), here: P.st.some(x => x.hub === stop.s.hub), dests: [] });
      groups.get(gk).dests.push({ hub: s.hub, name: s.hubName, legs });
    }
  }
  return [...groups.values()];
}
async function openTicketMachine(stop, pl) {
  const groups = destinationsFrom(stop);
  if (!groups.length) return;
  let g = groups.length === 1 ? groups[0] : null;
  for (;;) {
    if (!g) {
      const i = await ui.dialog(stop.kind === 'boat' ? `${icon(stop.P)} ${stop.name}` : stop.kind === 'bus' ? `🚌 Bus stop: ${stop.name}` : `🚆 ${stop.name} station`, 'Where to? Pick a line, then a stop. The machine works out any changes for you.', [...groups.map(g => (g.here ? '📍 ' : '') + g.title + ` (${g.dests.length})`), 'Never mind']);
      g = groups[i]; if (!g) return;
    }
    const lab = d => { const ch = d.legs.length - 1; return `${d.name}${ch ? ` · ${ch} change${ch > 1 ? 's' : ''}` : ''}`; };
    const j = await ui.dialog(g.title, `From <b>${stop.name}</b>. Where to?`, [...g.dests.map(lab), ...(groups.length > 1 ? ['⬅ Other lines'] : []), 'Never mind']);
    if (j < g.dests.length) { await buyTicket(stop, g.dests[j], pl); return; }
    if (groups.length > 1 && j === g.dests.length) { g = null; continue; }
    return;
  }
}
async function buyTicket(stop, d, pl) {
  const fare = tripFare(d.legs), route = d.legs.map(L => icon(L.P) + ' ' + lineLabel(L.P) + ' to ' + L.to.hubName).join(' → ');
  const sneak = stop.kind === 'bus' ? '🤫 Sneak in the back door (free, -1 karma)' : stop.kind === 'boat' ? '🤫 Stow away (free, -1 karma)' : '🤫 Hop the fare gate (free, -1 karma)';
  const pay = await ui.dialog('💳 Your trip', `${route}<br>Fare: <b>$${fare.total.toFixed(2)}</b> (${fare.cls.map(c => FARES[c][1]).join(' + ')})`, [`💳 Pay $${fare.total.toFixed(2)}`, sneak, 'Never mind']);
  if (pay === 2 || pay < 0) return;
  if (pay === 0 && pl.money >= fare.total) { pl.money -= fare.total; sfx.coin(); }
  else { pl.karma -= 1; ui.toast(pay === 0 ? '💳 Card declined…' : '🤫 Free ride!', stop.kind === 'bus' ? 'You slip in the back door. The driver sees you in the mirror and sighs. (-1 karma)' : stop.kind === 'boat' ? 'You hide behind a stack of life jackets. A deckhand sighs. (-1 karma)' : 'You hop the fare gate. A transit cop sighs. (-1 karma)', 2500); }
  startRide(pl, d.legs, {});
}

export const transitStops = () => stops;
// is a background bus stopped (doors open) near this spot? (people waiting there get on)
export const busStoppedNear = (x, z, r) => busRunners.some(b => b.dwell > 0 && b.g.visible && Math.hypot(b.g.position.x - x, b.g.position.z - z) < r);
// for tools/transitcheck.js
const _t = { mul: 1 };
export const _transit = { _t, lines, stops, allSt, dropped, failedLegs, planTrip, destinationsFrom, search, pathAt, roadRoute, flightRoute, travelTo, standY,
  start(pl, legs) { startRide(pl, legs, {}); }, get ride() { return ride; }, finish(pl) { if (ride) { while (ride.li < ride.legs.length - 1) nextLeg(pl); finishRide(pl, true); } } };
