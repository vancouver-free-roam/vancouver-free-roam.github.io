// trees.js: realistic trees.
//  - ONE texture atlas painted at load: needle sprays, leaf clusters, palm fronds, bare winter twigs, bark, leafy/needle "mass"
//  - geometry for every species in two levels of detail:
//      near = trunk + branches with textured, alpha-cut foliage cards (crossed, drooping fir branches; leaf clusters
//             around a broadleaf crown), used for the trees within ~200 m (the "near ring", see NearRing)
//      far  = cheap shapes (jagged cone tiers / lumpy crowns) that still wear the needle / leaf texture
//  - the shared foliage material: wind sway, leaf flutter, bark parts keep their own colour, soft crown lighting,
//    distance haze, bare deciduous trees in winter (leaf cards hidden, twig cards shown)
// Every vertex has an `aT` tag: 0 evergreen foliage, 1 bark, 3 deciduous leaves, 4 deciduous leafy core, 5 bare twigs.
import * as THREE from 'three';
import { renderer, sun } from './core.js';
sun.shadow.camera.layers.enable(1);   // shadow-only stand-ins live on layer 1 (see NearRing)

const CELL = 256, AW = 4, AH = 2;
const CELLS = { needle: [0, 0], leaf: [1, 0], frond: [2, 0], twig: [3, 0], bark: [0, 1], mass: [1, 1], nmass: [2, 1], cbark: [3, 1] };
const PAD = 3 / CELL;
function cuv(name, u, v) { const [c, r] = CELLS[name]; u = PAD + Math.min(1, Math.max(0, u)) * (1 - 2 * PAD); v = PAD + Math.min(1, Math.max(0, v)) * (1 - 2 * PAD); return [(c + u) / AW, (AH - 1 - r + v) / AH]; }

// ---------- the atlas ----------
function paintAtlas() {
  const cv = document.createElement('canvas'); cv.width = CELL * AW; cv.height = CELL * AH; const g = cv.getContext('2d');
  let seed = 12345; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const S = CELL;
  const leafShape = (x, y, len, wid, a, col) => {   // a pointed leaf with a vein
    g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = col; g.beginPath(); g.moveTo(-len / 2, 0); g.quadraticCurveTo(0, -wid, len / 2, 0); g.quadraticCurveTo(0, wid, -len / 2, 0); g.fill();
    g.strokeStyle = 'rgba(40,50,20,0.35)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(-len / 2, 0); g.lineTo(len / 2, 0); g.stroke(); g.restore();
  };
  const grey = (l, r = 0.86, b = 0.66) => `rgb(${Math.round(l * r)},${Math.round(l)},${Math.round(l * b)})`;
  // needle spray (branch from the trunk at u=0 to the tip at u=1, spreading across v)
  { const ox = 0, oy = 0; g.save(); g.translate(ox, oy);
    const twig = (x0, y0, ang, len, w, depth) => {
      const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
      g.strokeStyle = '#5b4a36'; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      const n = Math.floor(len / 2.2);
      for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t, nl = (6 + rnd() * 5) * (1 - t * 0.35);
        for (const s of [-1, 1]) { const a2 = ang + s * (0.95 + rnd() * 0.35); const l = 120 + rnd() * 120 * (0.5 + t * 0.6); g.strokeStyle = grey(l); g.lineWidth = 1.3; g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a2) * nl, py + Math.sin(a2) * nl); g.stroke(); } }
      if (depth > 0) for (let i = 1; i < 6; i++) { const t = i / 6.5, px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t; for (const s of [-1, 1]) if (rnd() < 0.9) twig(px, py, ang + s * (0.55 + rnd() * 0.3), len * (0.42 - t * 0.22) * (0.8 + rnd() * 0.4), w * 0.55, depth - 1); }
    };
    for (let k = 0; k < 2; k++) twig(6, S / 2 + (rnd() - 0.5) * 10, (rnd() - 0.5) * 0.12, S - 22, 3, 2);
    g.restore(); }
  // leaf cluster
  { const ox = S, cx = ox + S / 2, cy = S / 2;
    g.strokeStyle = '#4a3a2a'; g.lineWidth = 2.5; for (let i = 0; i < 6; i++) { const a = rnd() * 6.28; g.beginPath(); g.moveTo(cx, cy + 20); g.lineTo(cx + Math.cos(a) * 80, cy + Math.sin(a) * 80); g.stroke(); }
    for (let i = 0; i < 230; i++) { const a = rnd() * 6.28, r = Math.sqrt(rnd()) * 104, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.92; const l = 140 + rnd() * 115 - r * 0.25; leafShape(x, y, 15 + rnd() * 12, 5 + rnd() * 3, rnd() * 6.28, grey(l, 0.84, 0.6)); } }
  // palm frond (midrib along u, leaflets drooping)
  { const ox = 2 * S; g.strokeStyle = '#8a8058'; g.lineWidth = 3; g.beginPath(); g.moveTo(ox + 6, S / 2); g.lineTo(ox + S - 8, S / 2); g.stroke();
    for (let i = 0; i < 60; i++) { const t = i / 60, x = ox + 10 + t * (S - 24), L = 70 * Math.sin(Math.PI * (0.15 + t * 0.85)) + 8; for (const s of [-1, 1]) { g.strokeStyle = grey(150 + rnd() * 90, 0.82, 0.55); g.lineWidth = 2.6; g.beginPath(); g.moveTo(x, S / 2); g.lineTo(x + L * 0.45, S / 2 + s * L); g.stroke(); } } }
  // bare twigs (winter crowns): a little fractal tree from the bottom middle
  { const ox = 3 * S; const br = (x, y, a, len, w, d) => { const x1 = x + Math.cos(a) * len, y1 = y + Math.sin(a) * len; g.strokeStyle = `rgb(${90 + d * 8},${80 + d * 7},${70 + d * 6})`; g.lineWidth = w; g.beginPath(); g.moveTo(x, y); g.lineTo(x1, y1); g.stroke(); if (d > 0) { br(x1, y1, a - 0.35 - rnd() * 0.3, len * 0.72, w * 0.68, d - 1); br(x1, y1, a + 0.35 + rnd() * 0.3, len * 0.72, w * 0.68, d - 1); if (rnd() < 0.5) br(x1, y1, a + (rnd() - 0.5) * 0.3, len * 0.6, w * 0.6, d - 1); } };
    br(ox + S / 2, S - 4, -Math.PI / 2, 58, 6, 6); }
  // bark: vertical furrows and plates (Douglas fir / maple greys)
  const bark = (ox, oy, base) => {
    g.fillStyle = base; g.fillRect(ox, oy, S, S);
    for (let i = 0; i < 2600; i++) { const x = ox + rnd() * S, y = oy + rnd() * S, l = rnd() < 0.5 ? 0 : 255; g.fillStyle = `rgba(${l},${l},${l},${0.05 + rnd() * 0.07})`; g.fillRect(x, y, 1 + rnd() * 3, 2 + rnd() * 10); }
    for (let i = 0; i < 34; i++) { let x = ox + rnd() * S; g.strokeStyle = `rgba(20,14,10,${0.35 + rnd() * 0.4})`; g.lineWidth = 1.5 + rnd() * 3.5; g.beginPath(); g.moveTo(x, oy); for (let y = 0; y <= S; y += 16) { x += (rnd() - 0.5) * 6; g.lineTo(Math.min(ox + S, Math.max(ox, x)), oy + y); } g.stroke(); }
    for (let i = 0; i < 60; i++) { const x = ox + rnd() * S, y = oy + rnd() * S; g.strokeStyle = 'rgba(15,10,8,0.4)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 6 + rnd() * 10, y + (rnd() - 0.5) * 3); g.stroke(); }
  };
  bark(0, S, '#6b5a4a'); bark(3 * S, S, '#7a4d36');   // grey-brown (fir, maple) and red-brown (cedar)
  // leafy mass (opaque, for crowns at a distance and inside a crown): leaves on leaves, darker in the gaps
  { const ox = S, oy = S; g.fillStyle = grey(95, 0.84, 0.6); g.fillRect(ox, oy, S, S);
    for (let i = 0; i < 1400; i++) { const x = ox + rnd() * S, y = oy + rnd() * S; leafShape(x, y, 12 + rnd() * 10, 4 + rnd() * 3, rnd() * 6.28, grey(110 + rnd() * 140, 0.84, 0.6)); }
    // a ragged, see-through edge band at the bottom of the cell (crowns get leafy silhouettes)
    g.save(); g.globalCompositeOperation = 'destination-out'; for (let i = 0; i < 260; i++) { const x = ox + rnd() * S, y = oy + S - Math.pow(rnd(), 2) * 50; g.beginPath(); g.arc(x, y, 3 + rnd() * 7, 0, 6.28); g.fill(); } g.restore(); }
  // needle mass: conifer tiers seen from afar (opaque, with a fringe of drooping needle tips along the bottom)
  { const ox = 2 * S, oy = S; g.fillStyle = grey(80); g.fillRect(ox, oy, S, S - 40);
    for (let i = 0; i < 5000; i++) { const x = ox + rnd() * S, y = oy + rnd() * (S - 30), a = Math.PI / 2 + (rnd() - 0.5) * 1.6, l = 5 + rnd() * 9; g.strokeStyle = grey(90 + rnd() * 160); g.lineWidth = 1.4; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
    for (let x = ox; x < ox + S; x += 3) { const l = 10 + rnd() * 30; g.strokeStyle = grey(100 + rnd() * 120); g.lineWidth = 2; g.beginPath(); g.moveTo(x, oy + S - 44); g.lineTo(x + (rnd() - 0.5) * 6, oy + S - 44 + l); g.stroke(); } }
  // un-premultiply fix: transparent texels take their cell's average colour (no dark / white fringes in the mipmaps)
  const img = g.getImageData(0, 0, cv.width, cv.height), d = img.data, W = cv.width, H = cv.height;
  for (let cr = 0; cr < AW * AH; cr++) {
    const cx0 = (cr % AW) * S, cy0 = Math.floor(cr / AW) * S; let r = 0, gg = 0, b = 0, n = 0;
    for (let y = cy0; y < cy0 + S; y++) for (let x = cx0; x < cx0 + S; x++) { const i = (y * W + x) * 4; if (d[i + 3] > 200) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; } }
    if (!n) continue; r /= n; gg /= n; b /= n;
    for (let y = cy0; y < cy0 + S; y++) for (let x = cx0; x < cx0 + S; x++) { const i = (y * W + x) * 4; if (d[i + 3] < 8) { d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 0; } }
  }
  // flip rows so canvas top = v 1
  const out = new Uint8Array(W * H * 4); for (let y = 0; y < H; y++) out.set(d.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  const t = new THREE.DataTexture(out, W, H, THREE.RGBAFormat); t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); t.needsUpdate = true; return t;
}
export const ATLAS = paintAtlas();

// ---------- geometry builder ----------
class GB {
  constructor() { this.p = []; this.n = []; this.u = []; this.t = []; }
  v(x, y, z, nx, ny, nz, u, w, t) { this.p.push(x, y, z); const l = Math.hypot(nx, ny, nz) || 1; this.n.push(nx / l, ny / l, nz / l); this.u.push(u, w); this.t.push(t); }
  tri(a, b, c) { for (const q of [a, b, c]) this.v(...q); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  geo() { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2)); g.setAttribute('aT', new THREE.Float32BufferAttribute(this.t, 1)); g.computeBoundingSphere(); g.computeBoundingBox(); return g; }
}
const rng = s => () => (s = (s * 16807) % 2147483647) / 2147483647;
// a tapered tube from a to b (bark), radius r0 -> r1, n sides
function tube(B, a, b, r0, r1, n, cell = 'bark', vRep = 1) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d) || 1, dz = d.map(x => x / L);
  let ux = [0, 0, 0]; const ref = Math.abs(dz[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  ux = [dz[1] * ref[2] - dz[2] * ref[1], dz[2] * ref[0] - dz[0] * ref[2], dz[0] * ref[1] - dz[1] * ref[0]]; const ul = Math.hypot(...ux); ux = ux.map(x => x / ul);
  const uy = [dz[1] * ux[2] - dz[2] * ux[1], dz[2] * ux[0] - dz[0] * ux[2], dz[0] * ux[1] - dz[1] * ux[0]];
  const ring = (c, r, k) => { const a2 = k / n * Math.PI * 2, cx = Math.cos(a2), sy = Math.sin(a2); const nn = [ux[0] * cx + uy[0] * sy, ux[1] * cx + uy[1] * sy, ux[2] * cx + uy[2] * sy]; return [c[0] + nn[0] * r, c[1] + nn[1] * r, c[2] + nn[2] * r, ...nn]; };
  for (let k = 0; k < n; k++) {
    const p00 = ring(a, r0, k), p01 = ring(a, r0, k + 1), p10 = ring(b, r1, k), p11 = ring(b, r1, k + 1);
    const U = q => cuv(cell, q, 0), u0 = k / n, u1 = (k + 1) / n;
    const V = (p, u, v) => [p[0], p[1], p[2], p[3], p[4], p[5], ...cuv(cell, u, v), 1];
    B.quad(V(p00, u0, 0), V(p01, u1, 0), V(p11, u1, vRep), V(p10, u0, vRep));
  }
}
// a foliage card: centre c, axis along (u direction) and across (v direction) vectors (already full half-lengths), normal fn
function card(B, c, ax, ac, cell, t, nfn, u0 = 0, u1 = 1) {
  const P = (su, sv) => [c[0] + ax[0] * su + ac[0] * sv, c[1] + ax[1] * su + ac[1] * sv, c[2] + ax[2] * su + ac[2] * sv];
  const V = (su, sv, u, v) => { const p = P(su, sv), n = nfn(p); return [p[0], p[1], p[2], n[0], n[1], n[2], ...cuv(cell, u, v), t]; };
  B.quad(V(-1, -1, u0, 0), V(1, -1, u1, 0), V(1, 1, u1, 1), V(-1, 1, u0, 1));
}

// ---------- conifers ----------
// tiers: [[y0, height, radius]] in unit space (x/z -1..1 scaled by the tree's s, y 0..1 scaled by its height)
const tiersOf = (n, start, top, rBase, rTop, overlap = 1.5) => { const out = [], step = (top - start) / n; for (let i = 0; i < n; i++) { const t = i / (n - 1 || 1); out.push([start + i * step, step * overlap, rBase + (rTop - rBase) * t]); } return out; };
const ASPECT = 1 / 5.5;   // a conifer is ~5.5x taller than it is wide: vertical card tilts are squashed by this in unit space
function coniferNear(tiers, trunkTop, o = {}) {
  const B = new GB(), r = rng(o.seed || 5), nb = o.branches || 7, cell = o.cbark ? 'cbark' : 'bark';
  tube(B, [0, 0, 0], [0, 0.97, 0], o.butt || 0.07, 0.008, 6, cell, 3);
  const radial = p => { const l = Math.hypot(p[0], p[2]); return l < 0.02 ? [0, 1, 0] : [p[0] / l, 0.45, p[2] / l]; };
  tiers.forEach(([y0, hh, rad], ti) => {
    // inner needle mass so the crown isn't see-through
    const cr = rad * 0.5, n = 6, top = y0 + hh, bot = y0 + hh * 0.15;
    for (let k = 0; k < n; k++) { const a0 = k / n * 6.283, a1 = (k + 1) / n * 6.283; const P = (a, v) => { const rr = cr * (1 - v); return [Math.cos(a) * rr, bot + (top - bot) * v, Math.sin(a) * rr]; };
      const V = (a, v, u) => { const p = P(a, v); return [p[0], p[1], p[2], ...radial(p), ...cuv('nmass', u, 0.25 + v * 0.75), 0]; };
      B.tri(V(a0, 0, k / n), V(a1, 0, (k + 1) / n), V(a0, 1, (k + 0.5) / n)); }
    // drooping branches: two crossed cards each
    const off = r() * 6.28;
    for (let k = 0; k < nb; k++) {
      const a = off + k / nb * 6.283 + (r() - 0.5) * 0.5, L = rad * (0.85 + r() * 0.3), dx = Math.cos(a), dz = Math.sin(a);
      const yb = y0 + hh * (0.8 + r() * 0.15), yt = y0 + hh * (0.18 + r() * 0.1) - (o.droop || 0.15) * hh;
      const c = [dx * L * 0.52, (yb + yt) / 2, dz * L * 0.52], ax = [dx * L * 0.5, (yt - yb) / 2, dz * L * 0.5];
      const W = L * 0.42;
      for (const tilt of [0.55, -0.55]) {
        const ac = [-dz * W * Math.cos(tilt), W * Math.sin(tilt) * ASPECT * 1.6, dx * W * Math.cos(tilt)];
        card(B, c, ax, ac, 'needle', 0, radial);
      }
    }
  });
  // the leader at the top
  const ty = tiers[tiers.length - 1][0] + tiers[tiers.length - 1][1];
  for (const a of [0, 1.57]) card(B, [0, ty + 0.02, 0], [0, 0.05, 0], [Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06], 'needle', 0, p => [p[0], 0.8, p[2]]);
  return B.geo();
}
function coniferFar(tiers, trunkTop, o = {}) {
  const B = new GB(), r = rng(o.seed || 5), n = 7;
  tube(B, [0, 0, 0], [0, trunkTop, 0], o.butt || 0.07, 0.03, 5, o.cbark ? 'cbark' : 'bark', 2);
  for (const [y0, hh, rad] of tiers) {
    const rot = r() * 6.28, top = y0 + hh, jit = []; for (let k = 0; k < n; k++) jit.push(0.82 + 0.3 * Math.abs(Math.sin(k * 3 + r() * 6)));
    for (let k = 0; k < n; k++) {
      const a0 = rot + k / n * 6.283, a1 = rot + (k + 1) / n * 6.283, j0 = jit[k], j1 = jit[(k + 1) % n];
      const b0 = [Math.cos(a0) * rad * j0, y0 - (o.droop || 0.15) * hh * j0, Math.sin(a0) * rad * j0], b1 = [Math.cos(a1) * rad * j1, y0 - (o.droop || 0.15) * hh * j1, Math.sin(a1) * rad * j1];
      const nr = p => { const l = Math.hypot(p[0], p[2]) || 1; return [p[0] / l, 0.3, p[2] / l]; };
      const ap = [0, top, 0];
      B.tri([...b0, ...nr(b0), ...cuv('nmass', k / n, 0), 0], [...b1, ...nr(b1), ...cuv('nmass', (k + 1) / n, 0), 0], [...ap, ...nr([Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)]), ...cuv('nmass', (k + 0.5) / n, 1), 0]);
    }
  }
  return B.geo();
}

// ---------- broadleaf trees ----------
// crown: blobs [x, y, z, r] in a crown space that spans x/z -1..1, y 0..1; placed at y cy with height ch and radius cw
const BLOBS = [[0, 0.62, 0, 0.5], [0.45, 0.42, 0.12, 0.42], [-0.42, 0.45, -0.15, 0.42], [0.05, 0.4, -0.45, 0.38], [-0.08, 0.38, 0.45, 0.38], [0.3, 0.75, -0.25, 0.32], [-0.28, 0.72, 0.28, 0.33]];
function broadleaf(spec, near) {
  const { cy, ch, cw, trunkR = 0.06, seed = 7, limbs = 5 } = spec;
  const B = new GB(), r = rng(seed), C = [0, cy + ch * 0.45, 0];
  const toW = (x, y, z) => [x * cw, cy + y * ch, z * cw];
  const soft = p => { const d = [p[0] - C[0], (p[1] - C[1]) * 2.2, p[2] - C[2]]; return d; };
  // trunk + limbs into the crown + smaller boughs
  const fork = cy + ch * 0.12;
  tube(B, [0, 0, 0], [0, fork, 0], trunkR, trunkR * 0.75, near ? 6 : 4, 'bark', 2);
  const nl = near ? limbs : 3;
  for (let i = 0; i < nl; i++) {
    const a = i / nl * 6.283 + r() * 0.6, out = cw * (0.35 + r() * 0.25), up = cy + ch * (0.45 + r() * 0.3);
    const tip = [Math.cos(a) * out, up, Math.sin(a) * out];
    tube(B, [0, fork, 0], tip, trunkR * 0.55, trunkR * 0.18, near ? 4 : 3, 'bark');
    if (near) { const mid = [tip[0] * 0.55, fork + (up - fork) * 0.55, tip[2] * 0.55]; for (const s of [-1, 1]) { const b2 = a + s * (0.6 + r() * 0.4); tube(B, mid, [mid[0] + Math.cos(b2) * cw * 0.3, mid[1] + ch * 0.2, mid[2] + Math.sin(b2) * cw * 0.3], trunkR * 0.25, trunkR * 0.08, 3, 'bark'); } }
  }
  if (near) tube(B, [0, fork, 0], [0, cy + ch * 0.85, 0], trunkR * 0.6, trunkR * 0.15, 4, 'bark');
  // bare twig cards (only drawn in winter)
  const nt = near ? 10 : 6;
  for (let i = 0; i < nt; i++) { const a = i / nt * 6.283 + r(), rr = 0.35 + r() * 0.3, c = toW(Math.cos(a) * rr, 0.55 + r() * 0.3, Math.sin(a) * rr);
    card(B, c, [Math.cos(a + 1.57) * cw * 0.35, 0, Math.sin(a + 1.57) * cw * 0.35], [0, ch * 0.3, 0], 'twig', 5, p => [p[0], 0.5, p[2]], 0, 1); }   // u across, v up: the twig grows upward
  // crown
  for (const [bi, [bx, by, bz, br]] of BLOBS.entries()) {
    if (!near || bi < 3) { const ico = new THREE.IcosahedronGeometry(br * (near ? 0.62 : 1), 0).toNonIndexed(), p = ico.attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      const ou = r() * 0.5, ov = r() * 0.5, tri = [];
      for (let k = 0; k < 3; k++) { const s = 0.85 + ((Math.sin(p.getX(i + k) * 31 + p.getY(i + k) * 17 + p.getZ(i + k) * 23 + seed) + 1) * 0.15);
        const w = toW(bx + p.getX(i + k) * s, by + p.getY(i + k) * s * 0.9, bz + p.getZ(i + k) * s), n = soft(w); const uvq = [[0, 0], [1, 0], [0.5, 1]][k]; tri.push([...w, ...n, ...cuv('mass', ou + uvq[0] * 0.5, ov + uvq[1] * 0.5), 4]); }
      B.tri(...tri);
    } }
    if (!near) continue;
    // leaf-cluster cards on the blob's surface, facing out (with random spin)
    const nc = Math.round(br * br * 34) + 3;
    for (let k = 0; k < nc; k++) {
      let dx = r() * 2 - 1, dy = r() * 2 - 1, dz = r() * 2 - 1; const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      const ox = bx + dx * br * 0.78, oy = by + dy * br * 0.7, oz = bz + dz * br * 0.78; const c = toW(ox, oy, oz);
      // two perpendicular in-plane vectors (card faces along d), in world-ish units, then squash y by the crown's aspect
      const ref = Math.abs(dy) < 0.8 ? [0, 1, 0] : [1, 0, 0];
      let a1 = [dy * ref[2] - dz * ref[1], dz * ref[0] - dx * ref[2], dx * ref[1] - dy * ref[0]]; const al = Math.hypot(...a1); a1 = a1.map(x => x / al);
      const a2 = [dy * a1[2] - dz * a1[1], dz * a1[0] - dx * a1[2], dx * a1[1] - dy * a1[0]];
      const sp = r() * 6.28, cs = Math.cos(sp), sn = Math.sin(sp), sz = br * (0.55 + r() * 0.25);
      const U = [(a1[0] * cs + a2[0] * sn) * sz * cw, (a1[1] * cs + a2[1] * sn) * sz * ch, (a1[2] * cs + a2[2] * sn) * sz * cw];
      const V = [(-a1[0] * sn + a2[0] * cs) * sz * cw, (-a1[1] * sn + a2[1] * cs) * sz * ch, (-a1[2] * sn + a2[2] * cs) * sz * cw];
      card(B, c, U, V, 'leaf', 3, soft);
    }
  }
  return B.geo();
}

// ---------- windmill palm ----------
function palm() {
  const B = new GB(), r = rng(31);
  tube(B, [0, 0, 0], [0.03, 0.86, 0], 0.055, 0.045, 6, 'bark', 8);
  for (let i = 0; i < 11; i++) {
    const a = i / 11 * 6.283 + r() * 0.3, up = i < 4 ? 0.5 : 0.05 - r() * 0.25, L = 0.75;
    const dx = Math.cos(a), dz = Math.sin(a), c = [0.03 + dx * L * 0.5, 0.88 + up * 0.08, dz * L * 0.5];
    card(B, c, [dx * L * 0.5, (up - 0.3) * 0.08, dz * L * 0.5], [-dz * 0.22, 0.02, dx * 0.22], 'frond', 0, p => [p[0], 0.7, p[2]]);
  }
  for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283; card(B, [0.03 + Math.cos(a) * 0.08, 0.8, Math.sin(a) * 0.08], [Math.cos(a) * 0.08, -0.06, Math.sin(a) * 0.08], [-Math.sin(a) * 0.12, 0, Math.cos(a) * 0.12], 'frond', 0, p => [p[0], 0.3, p[2]]); }   // dead fronds hanging under the head
  return B.geo();
}

// ---------- world-space "detail" textures for surfaces without UVs (hedges, rocks…) ----------
// tileable canvas texture (mean ~ mid grey), projected from 3 sides in world space and multiplied in (x2), fading out far away
function tileTex(draw, N = 256) {
  const c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'); let seed = 777; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  draw(g, N, rnd, (fn) => { for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) { g.save(); g.translate(ox, oy); fn(); g.restore(); } });
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); return t;
}
export const DETAIL = {
  leaves: tileTex((g, N, rnd, wrap) => { g.fillStyle = '#5a5a5a'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 900; i++) { const x = rnd() * N, y = rnd() * N, a = rnd() * 6.28, l = 9 + rnd() * 9, w = 3 + rnd() * 3, v = Math.round(70 + rnd() * 150); wrap(() => { g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = `rgb(${v},${v},${v})`; g.beginPath(); g.moveTo(-l / 2, 0); g.quadraticCurveTo(0, -w, l / 2, 0); g.quadraticCurveTo(0, w, -l / 2, 0); g.fill(); g.restore(); }); } }),
  rock: tileTex((g, N, rnd, wrap) => { g.fillStyle = '#808080'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 3000; i++) { const x = rnd() * N, y = rnd() * N, v = Math.round(100 + rnd() * 60); g.fillStyle = `rgba(${v},${v},${v},0.5)`; g.fillRect(x, y, 1 + rnd() * 4, 1 + rnd() * 4); }
    for (let i = 0; i < 26; i++) { let x = rnd() * N, y = rnd() * N; const pts = [[x, y]]; for (let k = 0; k < 8; k++) { x += (rnd() - 0.5) * 30; y += (rnd() - 0.3) * 24; pts.push([x, y]); } wrap(() => { g.strokeStyle = 'rgba(30,30,30,0.55)'; g.lineWidth = 1 + rnd() * 1.5; g.beginPath(); g.moveTo(...pts[0]); for (const p of pts) g.lineTo(...p); g.stroke(); }); }
    for (let i = 0; i < 70; i++) { const x = rnd() * N, y = rnd() * N, r = 3 + rnd() * 9, li = rnd() < 0.5; wrap(() => { g.fillStyle = li ? 'rgba(190,200,150,0.55)' : 'rgba(70,90,50,0.45)'; g.beginPath(); g.arc(x, y, r, 0, 6.28); g.fill(); }); } }),   // cracks + lichen / moss spots
};
export function detailMat(mat, tex, scale, amount, key) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev && prev.call(mat, sh, r);
    sh.uniforms.uDet = { value: tex };
    sh.vertexShader = 'varying vec3 vDW; varying vec3 vDN;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      #ifdef USE_INSTANCING
        vDW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz; vDN = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);
      #else
        vDW = (modelMatrix * vec4(transformed, 1.0)).xyz; vDN = normalize(mat3(modelMatrix) * objectNormal);
      #endif`);
    sh.fragmentShader = 'varying vec3 vDW; varying vec3 vDN; uniform sampler2D uDet;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      { vec3 w = abs(normalize(vDN)); w = pow(w, vec3(4.0)); w /= (w.x + w.y + w.z);
        vec3 p = vDW * ${scale.toFixed(4)};
        vec3 d = texture2D(uDet, p.zy).rgb * w.x + texture2D(uDet, p.xz).rgb * w.y + texture2D(uDet, p.xy).rgb * w.z;
        float fade = 1.0 - smoothstep(60.0, 260.0, distance(cameraPosition, vDW));
        diffuseColor.rgb *= mix(vec3(1.0), d * 2.0, ${amount.toFixed(3)} * fade); }`);
  };
  mat.customProgramCacheKey = () => 'detail-' + key;
  return mat;
}

// ---------- forest floor and garden plants (all use the foliage material) ----------
// sword fern: a rosette of arching fronds (each frond = 2 cards, rising then bending over), y 0..~0.9
export function fernGeo() {
  const B = new GB(), r = rng(41);
  for (let i = 0; i < 11; i++) {
    const a = i / 11 * 6.283 + r() * 0.4, dx = Math.cos(a), dz = Math.sin(a), L = 0.42 + r() * 0.16, rise = 0.45 + r() * 0.2, w = 0.08;
    const p0 = [0, 0.02, 0], p1 = [dx * L * 0.55, rise, dz * L * 0.55], p2 = [dx * L * 1.25, rise * 0.55, dz * L * 1.25];
    const nf = () => [dx * 0.4, 1, dz * 0.4];
    for (const [a0, a1, u0, u1] of [[p0, p1, 0, 0.5], [p1, p2, 0.5, 1]]) {
      const c = [(a0[0] + a1[0]) / 2, (a0[1] + a1[1]) / 2, (a0[2] + a1[2]) / 2], ax = [(a1[0] - a0[0]) / 2, (a1[1] - a0[1]) / 2, (a1[2] - a0[2]) / 2];
      card(B, c, ax, [-dz * w, 0, dx * w], 'frond', 0, nf, u0, u1);
    }
  }
  return B.geo();
}
// a leafy shrub (salal, laurel, rhododendron…): a shady core + leaf-cluster cards, x/z -1..1, y 0..~1.5
export function shrubGeo(seed = 51) {
  const B = new GB(), r = rng(seed), C = [0, 0.6, 0];
  const soft = p => [p[0] - C[0], (p[1] - C[1]) * 1.4 + 0.3, p[2] - C[2]];
  const blobs = [[0, 0.75, 0, 0.75], [0.5, 0.55, 0.2, 0.55], [-0.45, 0.6, -0.25, 0.55], [0.1, 0.55, -0.5, 0.5], [-0.15, 0.55, 0.5, 0.5]];
  blobs.forEach(([bx, by, bz, br], bi) => {
    if (bi < 2) { const ico = new THREE.IcosahedronGeometry(br * 0.7, 0).toNonIndexed(), p = ico.attributes.position;
      for (let i = 0; i < p.count; i += 3) { const ou = r() * 0.5, ov = r() * 0.5, tri = []; for (let k = 0; k < 3; k++) { const w = [bx + p.getX(i + k), Math.max(0, by + p.getY(i + k) * 0.85), bz + p.getZ(i + k)]; const uvq = [[0, 0], [1, 0], [0.5, 1]][k]; tri.push([...w, ...soft(w), ...cuv('mass', ou + uvq[0] * 0.5, ov + uvq[1] * 0.5), 0]); } B.tri(...tri); } }
    const nc = Math.round(br * br * 22) + 2;
    for (let k = 0; k < nc; k++) {
      let dx = r() * 2 - 1, dy = r() * 1.6 - 0.4, dz = r() * 2 - 1; const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
      const c = [bx + dx * br * 0.8, Math.max(0.15, by + dy * br * 0.7), bz + dz * br * 0.8], sz = br * (0.6 + r() * 0.25), sp = r() * 6.28;
      const ref = Math.abs(dy) < 0.8 ? [0, 1, 0] : [1, 0, 0];
      let a1 = [dy * ref[2] - dz * ref[1], dz * ref[0] - dx * ref[2], dx * ref[1] - dy * ref[0]]; const al = Math.hypot(...a1); a1 = a1.map(x => x / al);
      const a2 = [dy * a1[2] - dz * a1[1], dz * a1[0] - dx * a1[2], dx * a1[1] - dy * a1[0]], cs = Math.cos(sp), sn = Math.sin(sp);
      card(B, c, a1.map((x, q) => (x * cs + a2[q] * sn) * sz), a1.map((x, q) => (-x * sn + a2[q] * cs) * sz), 'leaf', 0, soft);
    }
  });
  return B.geo();
}
// a fallen log along x (-0.5..0.5, radius 1) with bark, and the cut ends
export function logGeo() {
  const B = new GB(); tube(B, [-0.5, 0, 0], [0.5, 0, 0], 1, 0.92, 9, 'cbark', 1);
  for (const [x, s] of [[-0.5, -1], [0.5, 1]]) for (let k = 0; k < 9; k++) { const a0 = k / 9 * 6.283, a1 = (k + 1) / 9 * 6.283, rr = x < 0 ? 1 : 0.92;
    const V = a => [x, Math.sin(a) * rr, Math.cos(a) * rr, s, 0, 0, ...cuv('bark', 0.5 + Math.cos(a) * 0.1, 0.5 + Math.sin(a) * 0.1), 1]; B.tri([x, 0, 0, s, 0, 0, ...cuv('bark', 0.5, 0.5), 1], V(a0), V(a1)); }
  return B.geo();
}
// an old-growth stump (radius ~1, height 1) with springboard notches
export function stumpGeo() {
  const B = new GB(); tube(B, [0, 0, 0], [0, 1, 0], 1.25, 0.85, 10, 'cbark', 1);
  for (let k = 0; k < 10; k++) { const a0 = k / 10 * 6.283, a1 = (k + 1) / 10 * 6.283, V = a => [Math.cos(a) * 0.85, 1, Math.sin(a) * 0.85, 0, 1, 0, ...cuv('bark', 0.5 + Math.cos(a) * 0.15, 0.5 + Math.sin(a) * 0.15), 1]; B.tri([0, 1.04, 0, 0, 1, 0, ...cuv('bark', 0.5, 0.5), 1], V(a1), V(a0)); }
  for (const a of [0.4, 2.6]) tube(B, [Math.cos(a) * 0.95, 0.55, Math.sin(a) * 0.95], [Math.cos(a) * 1.25, 0.55, Math.sin(a) * 1.25], 0.12, 0.12, 4, 'bark');
  return B.geo();
}

// ---------- species (unit space: x/z scaled by the tree's s, y by its height) ----------
const CF = {
  douglas: [tiersOf(6, 0.34, 0.9, 0.5, 0.16, 1.7), 0.5, { droop: 0.18, seed: 3 }],
  cedar: [tiersOf(6, 0.14, 0.88, 0.62, 0.2, 1.8), 0.25, { droop: 0.32, butt: 0.11, seed: 9, cbark: true }],
  hemlock: [tiersOf(7, 0.2, 0.92, 0.42, 0.1, 1.6), 0.3, { droop: 0.25, seed: 13 }],
  subalpine: [tiersOf(6, 0.06, 0.95, 0.22, 0.06, 1.5), 0.15, { droop: 0.08, seed: 21, branches: 6 }],
};
export const SPECIES_GEO = {};
for (const k of Object.keys(CF)) SPECIES_GEO[k] = { near: coniferNear(...CF[k]), far: coniferFar(...CF[k]), crown: { y: CF[k][0][0][0], sy: 0.95 - CF[k][0][0][0], sx: 0.5 } };
const BL = {
  leafy: { cy: 0.38, ch: 0.62, cw: 1, trunkR: 0.08, seed: 7 },          // street / park maple, oak, linden
  columnar: { cy: 0.2, ch: 0.8, cw: 0.5, trunkR: 0.06, seed: 11, limbs: 4 },   // hornbeam, poplar
  broadmaple: { cy: 0.36, ch: 0.55, cw: 1.45, trunkR: 0.1, seed: 17, limbs: 6 },   // big maples / chestnuts
  alder: { cy: 0.45, ch: 0.5, cw: 0.8, trunkR: 0.07, seed: 23 },        // red alder / bigleaf maple in the wild
};
for (const k of Object.keys(BL)) SPECIES_GEO[k] = { near: broadleaf(BL[k], true), far: broadleaf(BL[k], false), crown: { y: BL[k].cy, sy: BL[k].ch, sx: BL[k].cw } };
{ const p = palm(); SPECIES_GEO.palm = { near: p, far: p, crown: { y: 0.8, sy: 0.2, sx: 0.8 } }; }
// "tiny": trees more than ~1 km away are a few pixels tall: two needle cones / one leafy ball on a stick (~20 tris)
function tinyConifer(tiers) {
  const B = new GB(), y0 = tiers[0][0], r0 = tiers[0][2], n = 6;
  for (const [ya, yb, rr] of [[y0 - 0.05, (y0 + 1) / 2 + 0.1, r0], [(y0 + 1) / 2 - 0.05, 1, r0 * 0.6]]) for (let k = 0; k < n; k++) {
    const a0 = k / n * 6.283, a1 = (k + 1) / n * 6.283, V = (a, y, r2, u, v) => [Math.cos(a) * r2, y, Math.sin(a) * r2, Math.cos(a), 0.4, Math.sin(a), ...cuv('nmass', u, v), 0];
    B.tri(V(a0, ya, rr, k / n, 0.2), V(a1, ya, rr, (k + 1) / n, 0.2), V((a0 + a1) / 2, yb, 0, (k + 0.5) / n, 1));
  }
  return B.geo();
}
function tinyBroad(s) {
  const B = new GB(); tube(B, [0, 0, 0], [0, s.cy + s.ch * 0.3, 0], s.trunkR || 0.06, 0.03, 3, 'bark');
  const ico = new THREE.IcosahedronGeometry(1, 0).toNonIndexed(), p = ico.attributes.position;
  for (let i = 0; i < p.count; i += 3) { const tri = []; for (let k = 0; k < 3; k++) { const x = p.getX(i + k), y = p.getY(i + k), z = p.getZ(i + k); tri.push([x * s.cw * 0.9, s.cy + (y * 0.5 + 0.5) * s.ch, z * s.cw * 0.9, x, y, z, ...cuv('mass', [0.2, 0.8, 0.5][k], [0.3, 0.3, 0.9][k]), 4]); } B.tri(...tri); }
  return B.geo();
}
for (const k of Object.keys(CF)) SPECIES_GEO[k].tiny = tinyConifer(CF[k][0]);
for (const k of Object.keys(BL)) SPECIES_GEO[k].tiny = tinyBroad(BL[k]);
SPECIES_GEO.palm.tiny = SPECIES_GEO.palm.far;

// ---------- the foliage material ----------
export const FOL = { bare: { value: 0 }, time: null, haze: null };
export function makeFoliageMat(HAZE, TIME, AER) {
  FOL.time = TIME; FOL.haze = HAZE;
  // Lambert (not PBR): leaves are matte anyway, and in dense woods it saves ~5 ms a frame (measured in Stanley Park)
  const m = new THREE.MeshLambertMaterial({ map: ATLAS, alphaTest: 0.42, side: THREE.DoubleSide });
  m.onBeforeCompile = sh => {
    sh.uniforms.uHaze = HAZE; sh.uniforms.uTime = TIME; sh.uniforms.uBare = FOL.bare; sh.uniforms.uSunC = { value: sun.color }; sh.uniforms.uSunI = { get value() { return sun.intensity; } };
    sh.vertexShader = 'attribute float aT; varying float vT; varying vec3 vLw; varying float vLn; uniform float uTime;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vT = aT;
        #ifdef USE_INSTANCING
          vec3 iP = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 iP = vec3(0.0);
        #endif
        { float ph = iP.x * 0.071 + iP.z * 0.053, h2 = transformed.y * transformed.y;
          float sw = sin(uTime * 1.1 + ph) * 0.6 + sin(uTime * 2.3 + ph * 1.7) * 0.25;
          transformed.x += sw * 0.022 * h2; transformed.z += cos(uTime * 0.9 + ph) * 0.012 * h2;
          if (aT > 2.5 && aT < 3.5 || aT < 0.5) { float fl = sin(uTime * 7.0 + position.x * 40.0 + position.z * 31.0 + ph); transformed += normal * fl * 0.006; } }`)
      .replace('#include <project_vertex>', '#include <project_vertex>\n#ifdef USE_INSTANCING\n mat4 lM = modelMatrix * instanceMatrix;\n#else\n mat4 lM = modelMatrix;\n#endif\n vLw = (lM * vec4(transformed, 1.0)).xyz; vLn = normalize(mat3(lM) * objectNormal).y;');
    sh.fragmentShader = 'varying float vT; varying vec3 vLw; varying float vLn; uniform vec3 uHaze; uniform float uBare; uniform vec3 uSunC; uniform float uSunI;\n' + (AER ? AER.glsl : '') + sh.fragmentShader
      // sunlight glowing through the leaves: crowns on the shady side stay green instead of going black
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n reflectedLight.indirectDiffuse += diffuseColor.rgb * uSunC * uSunI * (vT > 0.5 && vT < 1.5 ? 0.025 : 0.085);')
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\n normal *= faceDirection;\n#endif\n')   // foliage keeps its soft crown normals on both sides
      .replace('#include <alphatest_fragment>', `
        { float dist = distance(cameraPosition, vLw);
          // winter: deciduous leaves gone, bare twigs shown; the rest of the year twigs hide inside the leaves
          if ((vT > 2.5 && vT < 4.5 && uBare > 0.5) || (vT > 4.5 && uBare < 0.5)) discard;
          // mipmapped alpha thins out with distance: lift it so far crowns stay full
          diffuseColor.a = mix(diffuseColor.a, sqrt(diffuseColor.a), smoothstep(25.0, 260.0, dist));
          if (vT > 0.5 && vT < 1.5) {   // bark keeps its own colour (a little of the tree's tint)
            vec4 bk = texture2D(map, vMapUv);
            diffuseColor.rgb = bk.rgb * 0.9;
            diffuseColor.a = 1.0;
          } else {
            #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
            // deciduous leaves take the tree's season colour, with only the light/shade of the yellowish leaf texture
            // (multiplying by the texture's own tint turned pink blossom salmon-brown and dulled the fall reds)
            if (vT > 2.5 && vT < 4.5) { vec4 lt = texture2D(map, vMapUv); diffuseColor.rgb = vColor * dot(lt.rgb, vec3(0.299, 0.587, 0.114)) * 1.08; }
            #endif
            diffuseColor.rgb *= 1.45;
            if (vT > 3.5 && vT < 4.5) diffuseColor.rgb *= 0.7;   // the inside of a crown is shady
            diffuseColor.rgb *= 0.62 + 0.38 * smoothstep(-0.7, 0.8, vLn);   // undersides darker
          }
          if (AER_OFF) diffuseColor.rgb = mix(diffuseColor.rgb, uHaze, smoothstep(800.0, 30000.0, dist) * 0.5); }
        #include <alphatest_fragment>`.replace('AER_OFF', AER ? 'false' : 'true'));
    if (AER) AER.apply(sh, 'vLw');   // blue distance haze after lighting, same as the ground
  };
  m.customProgramCacheKey = () => 'foliage-v4';
  return m;
}

// ---------- near ring: the trees around you get the detailed geometry ----------
// sources are InstancedMeshes (city chunks, forest cells) drawn with far geometry; their instances within R metres are
// hidden (zero matrix) and drawn by one near-geometry InstancedMesh per species instead.
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
export class NearRing {
  constructor(scene, mat, R = 190) { this.scene = scene; this.mat = mat; this.R = R; this.sources = new Set(); this.near = new Map(); this.taken = new Map(); this.broken = new Set(); this.x = 1e9; this.z = 1e9; this.dirty = true; this.cap = 420; }
  add(mesh, key, cx, cz, half) { mesh.userData.ring = this; mesh.userData.ringKey = key; mesh.userData.rc = [cx, cz, half]; this.sources.add(mesh); this.dirty = true; }
  remove(mesh) { this.sources.delete(mesh); this.taken.delete(mesh); this.dirty = true; }
  orig(mesh, i, out) { const t = this.taken.get(mesh); const s = t && t.get(i); if (s) return out.copy(s); return mesh.getMatrixAt(i, out); }
  setBroken(mesh, i, on) { const k = mesh.id + ':' + i; if (on) this.broken.add(k); else this.broken.delete(k); this.dirty = true; }
  nearMesh(key, n) {
    let m = this.near.get(key);
    if (!m || m.userData.cap < n) {
      if (m) { this.scene.remove(m, m.userData.shadow); m.dispose(); }
      const cap = Math.max(256, Math.ceil(n * 1.4)); m = new THREE.InstancedMesh(SPECIES_GEO[key].near, this.mat, cap); m.userData.cap = cap;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; m.count = 0; this.scene.add(m); this.near.set(key, m);
      // shadows come from a cheap stand-in (the far shape, same matrices). It used to live on layer 1 "only the shadow camera
      // sees", but three.js tests the MAIN camera's layers in the shadow pass, so the nearest trees cast NO shadow at all
      // (2026-11-22). Now it's on layer 0 with a material that writes neither colour nor depth: invisible on screen, while the
      // shadow pass still draws it (its depth material copies the leaf atlas + alphaTest, so the shade is dappled).
      if (!this.shadowMat) this.shadowMat = new THREE.MeshBasicMaterial({ map: this.mat.map, alphaTest: this.mat.alphaTest || 0.42, side: THREE.DoubleSide, colorWrite: false, depthWrite: false, depthTest: true });
      const sh = new THREE.InstancedMesh(SPECIES_GEO[key].far, this.shadowMat, cap); sh.instanceMatrix = m.instanceMatrix; sh.castShadow = true; sh.receiveShadow = false; sh.frustumCulled = false; sh.count = 0; sh.renderOrder = -1; m.userData.shadow = sh; this.scene.add(sh);
    }
    return m;
  }
  update(px, pz) {
    if (!this.dirty && Math.hypot(px - this.x, pz - this.z) < 22) return;
    this.dirty = false; this.x = px; this.z = pz; const R = this.R, R2 = R * R, m4 = new THREE.Matrix4(), col = new THREE.Color();
    const want = new Map();   // key -> [[mesh, i]]
    const newTaken = new Map(), wantSet = new Set(), cand = [];
    for (const src of this.sources) {
      const [cx, cz, half] = src.userData.rc; if (Math.abs(cx - px) > R + half || Math.abs(cz - pz) > R + half) continue;
      if (!src.visible || (src.parent && !src.parent.visible)) continue;
      const items = src.userData.pos; if (!items) continue; const n = Math.min(src.count, items.length / 2);
      for (let i = 0; i < n; i++) { const dx = items[2 * i] - px, dz = items[2 * i + 1] - pz, d2 = dx * dx + dz * dz; if (d2 > R2) continue; if (this.broken.has(src.id + ':' + i)) continue; cand.push([d2, src, i]); }
    }
    // dense woods: only the closest `cap` trees get the detailed version (the rest of the ring stays far geometry)
    if (cand.length > this.cap) { cand.sort((a, b) => a[0] - b[0]); cand.length = this.cap; }
    for (const [, src, i] of cand) {
      const key = src.userData.ringKey; if (!want.has(key)) want.set(key, []); want.get(key).push([src, i]); wantSet.add(src.id + ':' + i);
      if (!newTaken.has(src)) newTaken.set(src, new Map());
    }
    // give back instances that left the ring
    for (const [src, map] of this.taken) { const keep = newTaken.get(src); let ch = false;
      for (const [i, mtx] of map) { if (keep && wantSet.has(src.id + ':' + i)) { keep.set(i, mtx); continue; } if (this.broken.has(src.id + ':' + i)) continue; src.setMatrixAt(i, mtx); ch = true; }
      if (ch) src.instanceMatrix.needsUpdate = true; }
    // take the new ones
    for (const [key, list] of want) {
      const nm = this.nearMesh(key, list.length); let j = 0;
      for (const [src, i] of list) {
        const map = newTaken.get(src); let mtx = map.get(i);
        if (!mtx) { mtx = new THREE.Matrix4(); src.getMatrixAt(i, mtx); map.set(i, mtx); src.setMatrixAt(i, ZERO); src.instanceMatrix.needsUpdate = true; }
        nm.setMatrixAt(j, mtx); if (src.instanceColor) { src.getColorAt(i, col); nm.setColorAt(j, col); } j++;
      }
      nm.count = j; nm.userData.shadow.count = j; nm.instanceMatrix.needsUpdate = true; nm.instanceColor.needsUpdate = true;
    }
    for (const [key, nm] of this.near) if (!want.has(key)) nm.count = nm.userData.shadow.count = 0;
    this.taken = newTaken;
  }
}
