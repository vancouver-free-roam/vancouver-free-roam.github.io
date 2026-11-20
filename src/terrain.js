// Terrain: real elevation (DEM), coastline land/water mask, ground texture, mountains, water, forests.
import * as THREE from 'three';
import { G, scene, renderer, clamp, smooth, vnoise, hash2, toXZ, canvasTex, depthBias } from './core.js';
import { SPECIES_GEO, makeFoliageMat, NearRing, FOL, fernGeo, shrubGeo, logGeo, stumpGeo } from './trees.js';

// ---------- elevation data ----------
const decode = D => { const s = atob(D.b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); D.arr = new Int16Array(u.buffer); return D; };
const D = decode(window.DEM), D2 = decode(window.DEM2), D3 = window.DEM3 ? decode(window.DEM3) : null, D4 = window.DEM4 ? decode(window.DEM4) : null;   // D4: Victoria, 20 m   // D3: far world, 300 m   // D: Vancouver + North Shore (20 m), D2: Sea-to-Sky to Whistler (50 m)
function sampleDem(D, x, z) {
  const fx = (x - D.x0) / D.step, fz = (z - D.z0) / D.step;
  const i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= D.w - 1 || j >= D.h - 1) return null;
  const tx = fx - i, tz = fz - j, k = j * D.w + i, A = D.arr;
  return ((A[k] * (1 - tx) + A[k + 1] * tx) * (1 - tz) + (A[k + D.w] * (1 - tx) + A[k + D.w + 1] * tx) * tz) * D.scale;
}
function demH(x, z) { return sampleDem(D, x, z) ?? (D4 && sampleDem(D4, x, z)) ?? sampleDem(D2, x, z) ?? (D3 && sampleDem(D3, x, z)) ?? -20; }
export const DEM_RECT = { x0: D.x0, z0: D.z0, x1: D.x0 + (D.w - 1) * D.step, z1: D.z0 + (D.h - 1) * D.step };
export const DEM2_RECT = { x0: D2.x0, z0: D2.z0, x1: D2.x0 + (D2.w - 1) * D2.step, z1: D2.z0 + (D2.h - 1) * D2.step };
export const DEM3_RECT = D3 ? { x0: D3.x0, z0: D3.z0, x1: D3.x0 + (D3.w - 1) * D3.step, z1: D3.z0 + (D3.h - 1) * D3.step } : { x0: 0, z0: 0, x1: 0, z1: 0 };
export const DEM4_RECT = D4 ? { x0: D4.x0, z0: D4.z0, x1: D4.x0 + (D4.w - 1) * D4.step, z1: D4.z0 + (D4.h - 1) * D4.step } : { x0: 0, z0: 0, x1: 0, z1: 0 };
const inRect = (r, x, z, m = 0) => x > r.x0 + m && x < r.x1 - m && z > r.z0 + m && z < r.z1 - m;

// ---------- lakes (Alta Lake, Green Lake, Alice Lake, Capilano reservoir…) ----------
export const lakes = (window.MAP.lakes || []).map(l => {
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let i = 0; i < l.p.length; i += 2) { x0 = Math.min(x0, l.p[i]); x1 = Math.max(x1, l.p[i]); z0 = Math.min(z0, l.p[i + 1]); z1 = Math.max(z1, l.p[i + 1]); }
  return { ...l, x0, z0, x1, z1, name: l.n >= 0 ? window.MAP.names[l.n] : '' };
});
function pip(x, z, p) { let ins = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) { const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1]; if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) ins = !ins; } return ins; }
const lakeGrid = new Map(), LG = 1000;
for (const l of lakes) for (let i = Math.floor(l.x0 / LG); i <= Math.floor(l.x1 / LG); i++) for (let j = Math.floor(l.z0 / LG); j <= Math.floor(l.z1 / LG); j++) { const k = i + ',' + j; if (!lakeGrid.has(k)) lakeGrid.set(k, []); lakeGrid.get(k).push(l); }
export function lakeAt(x, z) { const a = lakeGrid.get(Math.floor(x / LG) + ',' + Math.floor(z / LG)); if (a) for (const l of a) if (x > l.x0 && x < l.x1 && z > l.z0 && z < l.z1 && pip(x, z, l.p)) return l; return null; }
// height of the water surface here (sea = 0, or the lake's level)
export function waterLevel(x, z) { const l = lakeAt(x, z); return l ? l.y : 0; }

// ---------- land / water mask from OpenStreetMap coastline ----------
export const CITY = { x0: -3300, z0: -3900, x1: 6560, z1: 3120, res: 2.5 };
CITY.w = Math.round((CITY.x1 - CITY.x0) / CITY.res); CITY.h = Math.round((CITY.z1 - CITY.z0) / CITY.res);
let mask = null;
function buildMask() {
  const M = window.MAP, { w, h, res } = CITY;
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#000'; g.lineWidth = 2.2; g.lineJoin = 'round';
  for (const p of M.coast) { g.beginPath(); for (let i = 0; i < p.length; i += 2) { const X = (p[i] - CITY.x0) / res, Z = (p[i + 1] - CITY.z0) / res; i ? g.lineTo(X, Z) : g.moveTo(X, Z); } g.stroke(); }
  const px = g.getImageData(0, 0, w, h).data;
  mask = new Uint8Array(w * h).fill(1);
  const wall = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) wall[i] = px[i * 4] < 140 ? 1 : 0;
  const stack = new Int32Array(w * h); let sp = 0;
  const seeds = [[49.2865, -123.1600], [49.3000, -123.0900]];   // open water: English Bay, Burrard Inlet
  for (const [lat, lon] of seeds) {
    const [x, z] = toXZ(lat, lon); const i = Math.round((x - CITY.x0) / res), j = Math.round((z - CITY.z0) / res);
    if (i < 0 || j < 0 || i >= w || j >= h) continue;
    const k = j * w + i; if (wall[k] || !mask[k]) continue;
    mask[k] = 0; stack[sp++] = k;
    while (sp) {
      const q = stack[--sp], qi = q % w;
      if (qi > 0 && mask[q - 1] && !wall[q - 1]) { mask[q - 1] = 0; stack[sp++] = q - 1; }
      if (qi < w - 1 && mask[q + 1] && !wall[q + 1]) { mask[q + 1] = 0; stack[sp++] = q + 1; }
      if (q >= w && mask[q - w] && !wall[q - w]) { mask[q - w] = 0; stack[sp++] = q - w; }
      if (q < w * (h - 1) && mask[q + w] && !wall[q + w]) { mask[q + w] = 0; stack[sp++] = q + w; }
    }
  }
  // lakes and ponds (Lost Lagoon, Beaver Lake...)
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#000';
  for (const a of M.areas) if (a.k === 'water' && !a.line) { g.beginPath(); for (let i = 0; i < a.p.length; i += 2) { const X = (a.p[i] - CITY.x0) / res, Z = (a.p[i + 1] - CITY.z0) / res; i ? g.lineTo(X, Z) : g.moveTo(X, Z); } g.closePath(); g.fill(); }
  const lp = g.getImageData(0, 0, w, h).data;
  for (let i = 0; i < w * h; i++) if (lp[i * 4] < 128) mask[i] = 0;
}
// 1 = land, 0 = water, -1 = outside the mapped city area
export function maskAt(x, z) {
  const i = Math.floor((x - CITY.x0) / CITY.res), j = Math.floor((z - CITY.z0) / CITY.res);
  if (i < 0 || j < 0 || i >= CITY.w || j >= CITY.h) return -1;
  return mask[j * CITY.w + i];
}
// The Lions are near-vertical granite domes; the 20 m survey data rounds them into gentle humps.
// Sculpt each summit back into a steep dome that reaches its real height (West 1654 m, East 1606 m).
const LIONS = [[49.4576, -123.1863, 1654, 150], [49.4561, -123.1810, 1606, 135]].map(([la, lo, top, R]) => { const [x, z] = toXZ(la, lo); return { x, z, top, R, base: null }; });
function lionDome(x, z, h) {
  for (const L of LIONS) {
    const dx = x - L.x, dz = z - L.z; if (dx * dx + dz * dz > L.R * L.R) continue;
    if (L.base === null) { let s = 0; for (let a = 0; a < 6.28; a += 0.4) s += demH(L.x + Math.cos(a) * L.R, L.z + Math.sin(a) * L.R); L.base = s / 16; }
    const t = Math.sqrt(dx * dx + dz * dz) / L.R, dome = L.top - (L.top - L.base) * Math.pow(t, 4.5);
    h = Math.max(h, dome);
  }
  return h;
}
export function heightAt(x, z) {
  let h = lionDome(x, z, demH(x, z));
  const m = maskAt(x, z);
  if (m === 1) h = Math.max(h, 1.2);
  else if (m === 0) h = Math.min(h, -4);
  else if (h < 0.8) h = Math.min(h - 2, -4);
  return h;
}
export const isWater = (x, z) => heightAt(x, z) < waterLevel(x, z) - 0.5;
// the height of the DRAWN ground triangles (not the smooth DEM): streets, sidewalks and paths drape over this, so they never
// float above the ground or sink into it between two grid points. City: 10 m grid (meshHeightAt); elsewhere the 20/50 m tiles.
let cityGridH = null; const CG = 10;
function triAt(x, z, ox, oz, s, f) {
  const gx = (x - ox) / s, gz = (z - oz) / s, i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
  const a = f(i, j), b = f(i + 1, j), c = f(i, j + 1);
  if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
  const d = f(i + 1, j + 1); return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);   // same diagonal split as gridMesh
}
export function groundY(x, z) {
  if (x > CITY.x0 && x < CITY.x1 - CG && z > CITY.z0 && z < CITY.z1 - CG) {
    const nx = Math.round((CITY.x1 - CITY.x0) / CG) + 1, nz = Math.round((CITY.z1 - CITY.z0) / CG) + 1;
    if (!cityGridH) cityGridH = new Float32Array(nx * nz).fill(NaN);
    return triAt(x, z, CITY.x0, CITY.z0, CG, (i, j) => { const k = j * nx + i; let h = cityGridH[k]; if (h !== h) h = cityGridH[k] = meshHeightAt(CITY.x0 + i * CG, CITY.z0 + j * CG); return h; });
  }
  if (!inRect(UNION, x, z, 0) || inDetail(x, z, 0)) return heightAt(x, z);
  const s = inRect(DEM_RECT, UNION.x0 + Math.floor((x - UNION.x0) / CK) * CK + CK / 2, UNION.z0 + Math.floor((z - UNION.z0) / CK) * CK + CK / 2) ? 20 : 50;
  return triAt(x, z, UNION.x0, UNION.z0, s, (i, j) => heightAt(UNION.x0 + i * s, UNION.z0 + j * s));
}
// smoother version for drawing the city ground (avoids stair-step coastlines)
function meshHeightAt(x, z) {
  let f = 0, n = 0;
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const m = maskAt(x + a * 2.5, z + b * 2.5); if (m >= 0) { f += m; n++; } }
  if (!n) return heightAt(x, z);
  f /= n;
  const dem = demH(x, z);
  if (f >= 1) return Math.max(dem, 1.2);
  if (f <= 0) return Math.min(dem, -4);
  // shoreline: never sit right at the water level (the two surfaces would flicker against each other)
  return f >= 0.5 ? 0.35 + (f - 0.5) * 2 * (Math.max(dem, 1.2) - 0.35) : -0.6 - (0.5 - f) * 2 * 3.4;
}
// snow on the local mountains above ~950 m
export const snowLine = () => Math.min(G.snowLine ?? 930, G.snowLineOverride ?? 1e9);
export const isSnow = (x, z, h = heightAt(x, z)) => h > snowLine() + (vnoise(x * 0.004, z * 0.004) - 0.5) * 160;
// shared uniforms: snow line on the mountains, snow cover in the city (winter)
export const SNOW_U = { line: { value: 930 }, city: { value: 0 } };
// aerial perspective: far ridges fade into a cool blue-grey (greyer under cloud, dark at night) — set in updateWater
export const HAZE = { value: new THREE.Color(0.42, 0.52, 0.64) };
export function addSnowShader(mat, mode) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uSnowLine = SNOW_U.line; sh.uniforms.uCitySnow = SNOW_U.city; sh.uniforms.uHaze = HAZE; sh.uniforms.uWT = WATER_T;
    sh.vertexShader = 'varying vec3 vSW;\nvarying vec3 vSN;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vSW = (modelMatrix * vec4(transformed, 1.0)).xyz; vSN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = `varying vec3 vSW; varying vec3 vSN; uniform float uSnowLine; uniform float uCitySnow; uniform vec3 uHaze; uniform float uWT;
float sHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(sHash(i), sHash(i + vec2(1.0, 0.0)), u.x), mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), u.x), u.y); }
` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      // ground texture: mottled grass/soil at several scales, and bare rock streaks on steep slopes
      float dn = sNoise(vSW.xz * 0.31) * 0.45 + sNoise(vSW.xz * 1.9) * 0.3 + sNoise(vSW.xz * 0.045) * 0.25;
      ${mode === 'mountain' ? `diffuseColor.rgb *= 0.72 + 0.56 * dn;
      float steep = 1.0 - smoothstep(0.52, 0.82, vSN.y);
      vec3 rock = vec3(0.25, 0.24, 0.23) * (0.7 + 0.6 * sNoise(vec2(vSW.x * 0.04 + vSW.z * 0.04, vSW.y * 0.45)));
      diffuseColor.rgb = mix(diffuseColor.rgb, rock, steep * 0.85);` : 'diffuseColor.rgb *= 0.9 + 0.2 * dn;'}
      // up close: grass blades, clover, dry patches; paving/soil gets fine grit (fades with distance so it never shimmers)
      { float fw = fwidth(vSW.x) + fwidth(vSW.z), nearG = 1.0 - smoothstep(0.04, 0.35, fw), midG = 1.0 - smoothstep(0.3, 3.0, fw);
        float gr = smoothstep(0.015, 0.07, diffuseColor.g - max(diffuseColor.r, diffuseColor.b));
        float bl = sNoise(vSW.xz * vec2(11.0, 27.0)) * 0.5 + sNoise(vSW.xz * vec2(33.0, 12.0)) * 0.5;
        float pt = sNoise(vSW.xz * 0.55) * 0.6 + sNoise(vSW.xz * 2.3) * 0.4;
        vec3 grass = diffuseColor.rgb * (0.7 + 0.55 * bl);
        grass = mix(grass, grass * vec3(1.18, 1.06, 0.66), smoothstep(0.58, 0.85, pt) * 0.55);   // dry, straw-coloured patches
        grass = mix(grass, grass * vec3(0.8, 0.95, 0.78), smoothstep(0.62, 0.3, pt) * 0.35);      // lush, darker clover
        diffuseColor.rgb = mix(diffuseColor.rgb, grass, gr * nearG);
        diffuseColor.rgb *= 1.0 + gr * (pt - 0.5) * 0.22 * midG * (1.0 - nearG);
        // tufts and clumps you can still see a few metres to tens of metres away (the blades above fade out early), sunny yellow-green and shady blue-green patches
        { float tuft = sNoise(vSW.xz * 4.1) * 0.6 + sNoise(vSW.xz * 9.3) * 0.4, clump = sNoise(vSW.xz * 1.1 + 3.0), midT = 1.0 - smoothstep(0.15, 1.2, fw);
          diffuseColor.rgb *= 1.0 + gr * ((tuft - 0.5) * 0.34 * midT * (1.0 - nearG * 0.5) + (clump - 0.5) * 0.28 * midG);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.14, 1.1, 0.78), gr * smoothstep(0.6, 0.9, clump) * 0.5);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.85, 0.95, 1.05), gr * smoothstep(0.4, 0.1, clump) * 0.4); }
        float grit = sNoise(vSW.xz * 17.0) * 0.6 + sNoise(vSW.xz * 5.0) * 0.4;
        diffuseColor.rgb *= 1.0 + (1.0 - gr) * (grit - 0.5) * 0.18 * nearG;
        // beaches: wind ripples in the dry sand, a dark wet band at the waterline and foam washing up and back
        float sandy = smoothstep(0.06, 0.14, diffuseColor.r - diffuseColor.b) * smoothstep(0.38, 0.5, diffuseColor.r) * (1.0 - gr);
        if (sandy > 0.01 && vSW.y < 6.0) {
          float rip = sin(vSW.x * 3.1 + vSW.z * 1.7 + sNoise(vSW.xz * 0.8) * 4.0) * 0.5 + 0.5;
          diffuseColor.rgb *= 1.0 - sandy * (0.05 * rip * nearG + 0.06 * (sNoise(vSW.xz * 0.25) - 0.5));
          float wash = 0.62 + 0.18 * sin(uWT * 0.55 + sNoise(vSW.xz * 0.05) * 6.0);   // the swash line moves up and down the beach
          float wet = 1.0 - smoothstep(wash, wash + 0.5, vSW.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.62, 0.6, 0.58), wet * sandy);
          float foam = smoothstep(0.1, 0.0, abs(vSW.y - wash + 0.02)) * (0.55 + 0.45 * sNoise(vSW.xz * vec2(2.5, 2.5) + uWT * 0.3));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.96), foam * sandy * 0.85);
        } }
      float sn =sNoise(vSW.xz * 0.004) * 0.6 + sNoise(vSW.xz * 0.05) * 0.4;
      float snowA = ${mode === 'mountain' ? 'smoothstep(uSnowLine - 60.0, uSnowLine + 60.0, vSW.y + (sn - 0.5) * 200.0) * smoothstep(0.45, 0.72, vSN.y)' : '0.0'};
      snowA = max(snowA, uCitySnow * smoothstep(0.7, 0.92, vSN.y) * smoothstep(0.2, 0.5, sn) * step(0.5, vSW.y));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.92, 0.96), snowA);
      ${mode === 'mountain' ? `// forest floor up close: needle litter, moss carpets and dark soil instead of lawn (below the alpine meadows)
      { float fw2 = fwidth(vSW.x) + fwidth(vSW.z), nearF = 1.0 - smoothstep(0.05, 0.5, fw2);
        float isGreen = smoothstep(0.01, 0.05, diffuseColor.g - max(diffuseColor.r, diffuseColor.b)) * (1.0 - smoothstep(1150.0, 1400.0, vSW.y)) * (1.0 - snowA) * (1.0 - smoothstep(0.16, 0.26, diffuseColor.g));   // only the dark wild-forest ground, not bright town lawns
        float mo = sNoise(vSW.xz * 0.7), ne = sNoise(vSW.xz * 7.0) * 0.5 + sNoise(vSW.xz * 23.0) * 0.5;
        vec3 floorC = mix(vec3(0.15, 0.105, 0.06), vec3(0.09, 0.15, 0.045), smoothstep(0.35, 0.7, mo)) * (0.7 + 0.6 * ne);
        diffuseColor.rgb = mix(diffuseColor.rgb, floorC, isGreen * nearF * 0.85); }` : ''}
      diffuseColor.rgb = mix(diffuseColor.rgb, uHaze, smoothstep(500.0, 24000.0, distance(cameraPosition, vSW)) * 0.62);   // aerial perspective`);
  };
  return mat;
}


// ---------- ground colours: green yards where houses are spread out, paving where buildings are dense ----------
function densityGrid(R, cell = 8) {
  const W = Math.ceil((R.x1 - R.x0) / cell) + 1, H = Math.ceil((R.z1 - R.z0) / cell) + 1, a = new Float32Array(W * H);
  for (const b of window.MAP.blds) {
    const p = b.p; if (p[0] < R.x0 - 50 || p[0] > R.x1 + 50 || p[1] < R.z0 - 50 || p[1] > R.z1 + 50) continue;
    let ar = 0, cx = 0, cz = 0; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) { ar += (p[j] - p[i]) * (p[j + 1] + p[i + 1]); cx += p[i]; cz += p[i + 1]; }
    cx /= p.length / 2; cz /= p.length / 2; const i = Math.round((cx - R.x0) / cell), j = Math.round((cz - R.z0) / cell);
    if (i >= 0 && j >= 0 && i < W && j < H) a[j * W + i] += Math.abs(ar / 2) * (b.t === 1 ? 0.7 : 1.15);
  }
  const blur = (src, r) => { const out = new Float32Array(W * H), tmp = new Float32Array(W * H);
    for (let j = 0; j < H; j++) { let acc = 0; for (let i = -r; i < W + r; i++) { if (i + r < W && i + r >= 0) acc += src[j * W + i + r]; if (i - r - 1 >= 0 && i - r - 1 < W) acc -= src[j * W + i - r - 1]; if (i >= 0 && i < W) tmp[j * W + i] = acc; } }
    for (let i = 0; i < W; i++) { let acc = 0; for (let j = -r; j < H + r; j++) { if (j + r < H && j + r >= 0) acc += tmp[(j + r) * W + i]; if (j - r - 1 >= 0 && j - r - 1 < H) acc -= tmp[(j - r - 1) * W + i]; if (j >= 0 && j < H) out[j * W + i] = acc; } }
    return out; };
  const r = 4, d = blur(blur(a, r), 2), norm = 1 / (cell * cell * (2 * r + 1) ** 2 * 25);
  for (let k = 0; k < d.length; k++) d[k] *= norm;
  return (x, z) => { const i = Math.round((x - R.x0) / cell), j = Math.round((z - R.z0) / cell); return i < 0 || j < 0 || i >= W || j >= H ? 0 : d[j * W + i]; };
}
// colour of plain land (no park/beach/etc. polygon): lawns and gardens blending into pavement
function landColor(x, z, n, dens, out) {
  const paved = smooth(0.24, 0.48, dens + (vnoise(x * 0.01, z * 0.01) - 0.5) * 0.12);
  const lush = vnoise(x * 0.006 + 40, z * 0.006), dry = vnoise(x * 0.03, z * 0.03);
  let r = 92 + lush * 22 + dry * 18, g = 128 + lush * 18 + dry * 8, b = 70 + dry * 10;   // lawns: lush green to straw
  const yard = vnoise(x / 16 + 7, z / 16 - 3);                                            // each yard a little different (smooth: square patches looked like a checkerboard)
  r += (yard - 0.5) * 18; g += (yard - 0.5) * 14;
  const c = 136 + n * 28; r += (c - r) * paved; g += (c + 2 - g) * paved; b += (c - 6 - b) * paved;
  out[0] = r * (0.92 + n * 0.16); out[1] = g * (0.92 + n * 0.16); out[2] = b * (0.92 + n * 0.16); return out;
}
function treeShade(g, R, s) {   // darker, cooler ground under the street trees
  const T = window.MAP.trees; g.fillStyle = 'rgba(30,55,25,0.32)';
  for (let i = 0; i < T.length; i += 2) { const x = T[i], z = T[i + 1]; if (x < R.x0 || x > R.x1 || z < R.z0 || z > R.z1) continue; g.beginPath(); g.arc((x - R.x0) * s, (z - R.z0) * s, (2.6 + hash2(x, z) * 1.8) * s, 0, 7); g.fill(); }
}
// ---------- ground texture for the city ----------
const AREA_COL = { park: '#6c9850', grass: '#7a9c58', wood: '#3a3a24', pitch: '#4f9a45', playground: '#c4a479', golf: '#7fb062', beach: '#e2d2a3', cemetery: '#6d8f55', industrial: '#8d8a83', rail: '#7d776c', pier: '#9b968c', aero: '#8a8a8a', rock: '#8c8a84' };
export let groundCanvas = null;
function paintGround() {
  const TW = 4096, TH = Math.round(4096 * (CITY.z1 - CITY.z0) / (CITY.x1 - CITY.x0));
  const c = document.createElement('canvas'); c.width = TW; c.height = TH; const g = c.getContext('2d');
  const img = g.createImageData(TW, TH), d = img.data, sx = (CITY.x1 - CITY.x0) / TW, dens = densityGrid(CITY), lc = [0, 0, 0];
  for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
    const x = CITY.x0 + i * sx, z = CITY.z0 + j * sx, m = maskAt(x, z), k = (j * TW + i) * 4;
    const n = hash2(i, j) * 0.5 + vnoise(x * 0.02, z * 0.02) * 0.5;
    if (m === 0) { d[k] = 70 + n * 20; d[k + 1] = 80 + n * 20; d[k + 2] = 65 + n * 15; }
    else { landColor(x, z, n, dens(x, z), lc); d[k] = lc[0]; d[k + 1] = lc[1]; d[k + 2] = lc[2]; }
    d[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const s = TW / (CITY.x1 - CITY.x0), P = (x, z) => [(x - CITY.x0) * s, (z - CITY.z0) * s];
  const order = ['industrial', 'rail', 'aero', 'grass', 'cemetery', 'golf', 'park', 'wood', 'beach', 'rock', 'pitch', 'playground', 'pier'];
  for (const k of order) for (const a of window.MAP.areas) {
    if (a.k !== k) continue;
    g.beginPath(); for (let i = 0; i < a.p.length; i += 2) { const [X, Z] = P(a.p[i], a.p[i + 1]); i ? g.lineTo(X, Z) : g.moveTo(X, Z); }
    if (a.line) { g.lineWidth = 6 * s; g.strokeStyle = AREA_COL.pier; g.stroke(); continue; }
    g.closePath(); g.fillStyle = AREA_COL[k]; g.fill();
    if (k === 'pitch') { g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1; g.stroke(); }
  }
  treeShade(g, CITY, s);
  // grass texture speckle on green areas
  g.globalAlpha = 0.08;
  for (let i = 0; i < 200000; i++) { g.fillStyle = Math.random() < 0.5 ? '#000' : '#fff'; g.fillRect(Math.random() * TW, Math.random() * TH, 2, 2); }
  g.globalAlpha = 1;
  groundCanvas = c;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

// ---------- meshes ----------
function gridMesh(x0, z0, x1, z1, step, heightFn, colorFn, uvRect, mat) {
  const nx = Math.round((x1 - x0) / step) + 1, nz = Math.round((z1 - z0) / step) + 1;
  const pos = new Float32Array(nx * nz * 3), uv = uvRect ? new Float32Array(nx * nz * 2) : null;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = x0 + i * step, z = z0 + j * step;
    pos[k * 3] = x; pos[k * 3 + 1] = heightFn(x, z); pos[k * 3 + 2] = z;
    if (uv) { uv[k * 2] = (x - uvRect.x0) / (uvRect.x1 - uvRect.x0); uv[k * 2 + 1] = 1 - (z - uvRect.z0) / (uvRect.z1 - uvRect.z0); }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6); let p = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (uv) geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  if (colorFn) {
    const nor = geo.attributes.normal, col = new Float32Array(nx * nz * 3), c = new THREE.Color();
    for (let k = 0; k < nx * nz; k++) { colorFn(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2], nor.getY(k), c); col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; scene.add(m); return m;
}

const SAND = new THREE.Color(0.42, 0.38, 0.3), FOREST = new THREE.Color(0.055, 0.1, 0.055), URBAN = new THREE.Color(0.25, 0.27, 0.22), ROCK = new THREE.Color(0.3, 0.29, 0.28), SNOW = new THREE.Color(0.92, 0.94, 0.98);
// North/West Vancouver urban slopes (rough), everything else is forest
const TOWNS = [[49.700, -123.150, 3500, 150], [50.115, -122.955, 2600, 760], [49.376, -123.272, 900, 90], [50.135, -122.960, 1500, 720],
  // far world towns (Fraser Valley suburbs, Vancouver Island, Sunshine Coast, Bellingham)
  [49.235, -123.10, 5200, 160], [49.235, -123.02, 5200, 140], [49.22, -122.93, 4500, 200], [49.13, -122.78, 21000, 160], [49.27, -122.83, 7000, 260], [49.05, -122.31, 9000, 160], [49.16, -122.05, 5000, 120], [48.45, -123.39, 11000, 140], [49.17, -123.96, 8000, 140], [48.78, -123.70, 4000, 90],
  [49.69, -124.98, 7000, 90], [50.02, -125.25, 5000, 90], [49.25, -124.80, 4000, 90], [49.32, -124.33, 5000, 90], [48.76, -122.47, 8000, 140], [49.40, -123.51, 2500, 150], [49.47, -123.76, 3000, 110], [48.65, -123.40, 4000, 80]].map(([lat, lon, r, hmax]) => { const [x, z] = toXZ(lat, lon); return { x, z, r, hmax }; });
const RICHMOND = (() => { const [x0, z1] = toXZ(49.105, -123.25), [x1, z0] = toXZ(49.237, -123.0); return { x0, z0, x1, z1 }; })();   // Richmond + YVR: city, no forest
export const isRichmond = (x, z) => x > RICHMOND.x0 && x < RICHMOND.x1 && z > RICHMOND.z0 && z < RICHMOND.z1;
export const isNorthShoreTown = (x, z, h) => (isRichmond(x, z) && h > 0.5) || (h < 330 && h > 1 && z > -9500 && z < -3000 && x > -11000 && x < 9500) || TOWNS.some(t => h < t.hmax && h > 1 && Math.abs(x - t.x) < t.r && Math.abs(z - t.z) < t.r && Math.hypot(x - t.x, z - t.z) < t.r);

// ---------- mapped towns outside the painted city (South Van, UBC, Burnaby, North Shore, Squamish, Whistler…):
// the terrain tiles colour themselves from the real map: yards, paving, parks, beaches
let townDens = null, townAreas = null;
const TA = 250, TOWN_KINDS = { park: 1, grass: 1, pitch: 1, playground: 1, golf: 1, beach: 1, cemetery: 1, wood: 1, industrial: 1 };
function townData() {
  if (townDens) return;
  const R = { x0: DEM_RECT.x0, z0: DEM_RECT.z0, x1: DEM_RECT.x1, z1: DEM_RECT.z1 };
  townDens = densityGrid(R, 16);
  townAreas = new Map();
  for (const a of window.MAP.areas) {
    if (a.line || !TOWN_KINDS[a.k]) continue;
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let i = 0; i < a.p.length; i += 2) { x0 = Math.min(x0, a.p[i]); x1 = Math.max(x1, a.p[i]); z0 = Math.min(z0, a.p[i + 1]); z1 = Math.max(z1, a.p[i + 1]); }
    if ((x1 - x0) * (z1 - z0) > 4e7) continue;
    const r = { a, x0, z0, x1, z1, col: new THREE.Color(AREA_COL[a.k]) };
    for (let i = Math.floor(x0 / TA); i <= Math.floor(x1 / TA); i++) for (let j = Math.floor(z0 / TA); j <= Math.floor(z1 / TA); j++) { const k = i + ',' + j; if (!townAreas.has(k)) townAreas.set(k, []); townAreas.get(k).push(r); }
  }
}
export function townDensity(x, z) { townData(); return townDens(x, z); }
function townArea(x, z) { townData(); const list = townAreas.get(Math.floor(x / TA) + ',' + Math.floor(z / TA)); if (list) for (let i = list.length - 1; i >= 0; i--) { const r = list[i]; if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1 && pip(x, z, r.a.p)) return r; } return null; }
const _lc = [0, 0, 0];
function townColor(x, z, h, c) {   // returns true if this spot is mapped town ground
  if (h < 0.8) return false;
  const area = townArea(x, z);
  if (area) { c.copy(area.col).multiplyScalar(0.9 + 0.2 * vnoise(x * 0.02, z * 0.02)); return true; }
  const d = townDens(x, z); if (d < 0.012) return false;
  landColor(x, z, vnoise(x * 0.02, z * 0.02), d, _lc); c.setRGB(_lc[0] / 255, _lc[1] / 255, _lc[2] / 255, THREE.SRGBColorSpace); return true;
}
// farmland: the Fraser Valley, Delta/Ladner, Pitt Meadows and the Saanich Peninsula
const FARMS = [[49.00, 49.21, -122.75, -121.85, 45], [49.03, 49.12, -123.15, -122.95, 6], [49.19, 49.26, -122.72, -122.58, 12], [48.52, 48.66, -123.48, -123.35, 60]].map(([s, n, w, e, hmax]) => { const [x0, z1] = toXZ(s, w), [x1, z0] = toXZ(n, e); return { x0, z0, x1, z1, hmax }; });
const FIELDS = [[0.09, 0.17, 0.04], [0.13, 0.2, 0.05], [0.2, 0.2, 0.07], [0.27, 0.22, 0.09], [0.17, 0.12, 0.06], [0.11, 0.15, 0.05], [0.24, 0.24, 0.1]].map(a => new THREE.Color(...a));
const FOREST2 = new THREE.Color(0.075, 0.125, 0.045), YOUNG = new THREE.Color(0.12, 0.17, 0.06), MEADOW = new THREE.Color(0.17, 0.21, 0.085), DRYGRASS = new THREE.Color(0.24, 0.22, 0.12);
function mountainColor(x, h, z, ny, c) {
  const n = vnoise(x * 0.01, z * 0.01), m = vnoise(x * 0.0023 + 7, z * 0.0023);
  const farm = h > 0.5 && FARMS.find(f => x > f.x0 && x < f.x1 && z > f.z0 && z < f.z1 && h < f.hmax);
  if (h < 1.6) c.copy(SAND);
  else if (townColor(x, z, h, c)) return;
  else if (farm) { const fi = Math.floor(x / 320 + Math.sin(z * 0.002) * 0.6), fj = Math.floor(z / 240); c.copy(FIELDS[Math.floor(hash2(fi, fj) * FIELDS.length)]).multiplyScalar(0.85 + 0.3 * n); if (hash2(fj, fi) < 0.12) c.lerp(URBAN, 0.6); }   // a farmyard here and there
  else if (isNorthShoreTown(x, z, h)) c.copy(URBAN).lerp(FOREST2, 0.35 + 0.4 * n);
  else {
    c.copy(FOREST).lerp(FOREST2, smooth(0.35, 0.75, m));                                                       // conifer vs mixed forest
    if (h < 900) c.lerp(YOUNG, smooth(0.8, 0.92, vnoise(x * 0.004 + 3, z * 0.004)));                          // younger regrowth patches
    c.multiplyScalar(0.8 + 0.5 * n);
  }
  const tl = 1200 + n * 160;                                                                                     // tree line → alpine meadow → rock
  c.lerp(h > tl + 300 ? DRYGRASS : MEADOW, clamp(smooth(tl - 80, tl + 80, h) * (1 - smooth(tl + 280, tl + 480, h)), 0, 1) * 0.85);
  c.lerp(ROCK, clamp(smooth(tl + 220, tl + 480, h + n * 150) + smooth(0.7, 0.5, ny), 0, 1));
}

export const SKI_RUNS = [];
export let waterMat = null;
export function initTerrain(progress) {
  progress('Reading the coastline…', 0.08);
  buildMask();
  progress('Painting parks and beaches…', 0.14);
  const tex = paintGround();
  // city: 10 m grid with the painted ground texture
  gridMesh(CITY.x0, CITY.z0, CITY.x1, CITY.z1, 10, meshHeightAt, null, CITY, addSnowShader(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, envMapIntensity: 0.35 }), 'city'));
  // mountains + Sea-to-Sky: tiles that get more detailed when you're close
  initChunks();
  buildDetailPatches();
  buildFar();
  for (const l of lakes) {
    const sh = new THREE.Shape(); for (let i = 0; i < l.p.length; i += 2) i ? sh.lineTo(l.p[i], -l.p[i + 1]) : sh.moveTo(l.p[i], -l.p[i + 1]);
    const m = new THREE.Mesh(new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2), null); m.position.y = l.y; m.receiveShadow = true; l.mesh = m;
  }

  // sea
  const nTex = makeWaterNormals();
  waterMat = new THREE.MeshStandardMaterial({ color: 0x13495a, roughness: 0.12, metalness: 0.05, normalMap: nTex, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 0.62 });
  nTex.repeat.set(4900, 4900);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(800000, 800000).rotateX(-Math.PI / 2), waterMat);
  sea.position.x = -120000; sea.receiveShadow = true; scene.add(sea);
  const lakeMat = waterMat.clone(); lakeMat.color.set(0x1d5560); lakeMat.side = THREE.DoubleSide;
  waterShader(waterMat); waterShader(lakeMat);
  depthBias(waterMat, -0.0004); depthBias(lakeMat, -0.0004);   // water sits a hair BEHIND ground at the same height: the shoreline no longer flickers
  for (const l of lakes) { l.mesh.material = lakeMat; scene.add(l.mesh); }
}
// three wave sizes in world space (swell, chop, ripples) drifting different ways, fading with distance (no far-off sparkle),
// a touch greener in the shallows-looking near water and darker toward the horizon
export const WATER_T = { value: 0 };
function waterShader(mat) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uWT = WATER_T;
    sh.vertexShader = 'varying vec3 vWw;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n vWw = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = 'varying vec3 vWw; uniform float uWT;\n' + sh.fragmentShader.replace('#include <normal_fragment_maps>', `
        { float wd = distance(cameraPosition, vWw), fine = 1.0 - smoothstep(25.0, 160.0, wd), mid = 1.0 - smoothstep(250.0, 2500.0, wd);
          vec2 n1 = texture2D(normalMap, vWw.xz / 140.0 + vec2(uWT * 0.006, uWT * 0.004)).xy * 2.0 - 1.0;
          vec2 n2 = texture2D(normalMap, vWw.xz / 37.0 * mat2(0.8, -0.6, 0.6, 0.8) + vec2(-uWT * 0.014, uWT * 0.009)).xy * 2.0 - 1.0;
          vec2 n3 = texture2D(normalMap, vWw.xz / 11.0 * mat2(0.34, 0.94, -0.94, 0.34) + vec2(uWT * 0.035, -uWT * 0.022)).xy * 2.0 - 1.0;
          vec2 sl = (n1 * 0.8 + n2 * 0.45 * mid + n3 * 0.22 * fine) * normalScale.x;
          vec3 wn = normalize(vec3(sl.x, 1.0, sl.y));   // the water is flat: build the normal straight in world space
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        { float wd2 = distance(cameraPosition, vWw); diffuseColor.rgb = mix(diffuseColor.rgb * vec3(0.92, 1.12, 1.04), diffuseColor.rgb * 0.85, smoothstep(30.0, 900.0, wd2)); }`);
  };
  mat.customProgramCacheKey = () => 'water3';
}

// ---------- terrain tiles with two levels of detail ----------
const UNION = { x0: Math.min(DEM_RECT.x0, DEM2_RECT.x0), z0: Math.min(DEM_RECT.z0, DEM2_RECT.z0), x1: Math.max(DEM_RECT.x1, DEM2_RECT.x1), z1: Math.max(DEM_RECT.z1, DEM2_RECT.z1) };
export const WORLD = UNION;
const CK = 3000, chunks = [], CHUNK_SHOW = 16000;   // nearby terrain tiles (beyond: the far mesh)
const terrainMat = addSnowShader(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, envMapIntensity: 0.4 }), 'mountain');
// iconic peaks drawn at full detail from everywhere (the far terrain is only a 200 m grid, which shaves sharp
// summits off): The Lions. The patch replaces the normal terrain inside its rectangle.
const DETAIL = [[49.4440, 49.4720, -123.2080, -123.1620, 15, 0.4], [49.4535, 49.4605, -123.1905, -123.1770, 6, 0.9]].map(([s, n, w, e, step, lift]) => { const [x0, z1] = toXZ(s, w), [x1, z0] = toXZ(n, e); return { x0, z0, x1, z1, step, lift }; });
const inDetail = (x, z, m) => DETAIL.some(d => x > d.x0 + m && x < d.x1 - m && z > d.z0 + m && z < d.z1 - m);
function buildDetailPatches() {
  DETAIL.forEach((d, i) => {
    const inner = DETAIL.slice(i + 1);   // a finer patch inside this one: sink this one there
    gridMesh(d.x0, d.z0, d.x1, d.z1, d.step, (x, z) => heightAt(x, z) + d.lift - (inner.some(q => x > q.x0 + 12 && x < q.x1 - 12 && z > q.z0 + 12 && z < q.z1 - 12) ? 30 : 0), mountainColor, null, terrainMat);
  });
}
function chunkHeight(cx0, cz0, x, z) {
  // vertices outside the tile become a skirt that hangs down (hides gaps between tiles)
  const X = clamp(x, cx0, cx0 + CK), Z = clamp(z, cz0, cz0 + CK);
  let h = heightAt(X, Z);
  if (inRect(CITY, X, Z, 60)) h -= 40;           // the detailed city ground covers this
  if (inDetail(X, Z, 210)) h -= 60;              // a full-detail patch covers this
  return (X !== x || Z !== z) ? h - 60 : h;
}
function buildChunkMesh(c, step) {
  const m = gridMesh(c.x0 - step, c.z0 - step, c.x0 + CK + step, c.z0 + CK + step, step, (x, z) => chunkHeight(c.x0, c.z0, x, z), mountainColor, null, terrainMat);
  scene.remove(m); return m;
}
function initChunks() {
  for (let x0 = UNION.x0; x0 < UNION.x1; x0 += CK) for (let z0 = UNION.z0; z0 < UNION.z1; z0 += CK) {
    const c = { x0, z0, cx: x0 + CK / 2, cz: z0 + CK / 2, fine: null };
    if (inRect(CITY, x0, z0, -1) && inRect(CITY, x0 + CK, z0 + CK, -1)) continue;
    // skip open ocean tiles
    let land = false; for (let i = 0; i <= 4 && !land; i++) for (let j = 0; j <= 4; j++) if (heightAt(x0 + i * CK / 4, z0 + j * CK / 4) > -3) { land = true; break; }
    if (!land) continue;
    c.step = inRect(DEM_RECT, c.cx, c.cz) ? 20 : 50;
    c.coarse = buildChunkMesh(c, 200); scene.add(c.coarse);
    chunks.push(c);
  }
}
let chunkBudget = 0;
export function updateChunks(px, pz) {
  chunkBudget = 1;
  for (const c of chunks) {
    const d = Math.max(Math.abs(c.cx - px), Math.abs(c.cz - pz));
    if (d < 4600) {
      if (!c.fine && chunkBudget > 0) { chunkBudget--; c.fine = buildChunkMesh(c, c.step); scene.add(c.fine); }
      if (c.fine) { c.fine.visible = true; c.coarse.visible = false; }
    } else {
      c.coarse.visible = d < CHUNK_SHOW;   // further out, the one big far-landscape mesh shows this ground
      if (c.fine) { if (d > 9000) { scene.remove(c.fine); c.fine.geometry.dispose(); c.fine = null; } else c.fine.visible = false; }
    }
  }
  updateForestCells(px, pz);
  updateVictoria(px, pz);
  updateFarTiles(px, pz);
  for (const l of lakes) if (l.mesh) { const dx = Math.max(l.x0 - px, 0, px - l.x1), dz = Math.max(l.z0 - pz, 0, pz - l.z1); l.mesh.visible = dx + dz < 14000; }
}

// ---------- the far world: Vancouver Island, Gulf Islands, Fraser Valley, Mt Baker, the Olympics ----------
// One big 800 m mesh you can see from everywhere, plus 100 m tiles that appear around you when you go out there.
// The big mesh has a hole cut around you (shader discard) so the detailed tiles show through.
export const FAR_HOLE = { value: new THREE.Vector3(0, 0, 0) };   // x, z = centre, y = radius (0 = no hole)
const farMat = addSnowShader(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, envMapIntensity: 0.3 }), 'mountain');
{ const prev = farMat.onBeforeCompile; farMat.onBeforeCompile = sh => { prev(sh); sh.uniforms.uHole = FAR_HOLE; sh.uniforms.uUnion = { value: new THREE.Vector4(UNION.x0, UNION.z0, UNION.x0 + Math.ceil((UNION.x1 - UNION.x0) / CK) * CK, UNION.z0 + Math.ceil((UNION.z1 - UNION.z0) / CK) * CK) }; sh.uniforms.uCity = { value: new THREE.Vector4(CITY.x0, CITY.z0, CITY.x1, CITY.z1) };
  sh.fragmentShader = 'uniform vec3 uHole; uniform vec4 uUnion; uniform vec4 uCity;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  if (uHole.y > 0.0 && distance(vSW.xz, uHole.xz) < uHole.y) discard;
  // nearby, the detailed terrain tiles (and the city ground) are drawn instead of this far mesh
  if (vSW.x > uCity.x && vSW.x < uCity.z && vSW.z > uCity.y && vSW.z < uCity.w) discard;
  // exactly where a nearby terrain tile is shown (same 3 km grid + same distance rule as updateChunks), so the two never overlap
  if (vSW.x > uUnion.x && vSW.x < uUnion.z && vSW.z > uUnion.y && vSW.z < uUnion.w) { vec2 cc = uUnion.xy + (floor((vSW.xz - uUnion.xy) / ${CK}.0) + 0.5) * ${CK}.0; vec2 dd = abs(cc - uHole.xz); if (max(dd.x, dd.y) < ${CHUNK_SHOW}.0) discard; }`); }; }
export let farMesh = null;
function buildFar() {
  if (!D3) return;
  const R = DEM3_RECT, step = 800;
  farMesh = gridMesh(R.x0 + 300, R.z0 + 300, R.x1 - 300, R.z1 - 300, step, (x, z) => heightAt(x, z) - (inRect(DEM4_RECT, x, z, 300) ? 25 : 0), mountainColor, null, farMat);
  farMesh.receiveShadow = false; farMesh.frustumCulled = false;
}
const FCK = 6000, farTiles = new Map();
function farTileHeight(x0, z0, x, z) {
  const X = clamp(x, x0, x0 + FCK), Z = clamp(z, z0, z0 + FCK);
  let h = heightAt(X, Z); if (inRect(UNION, X, Z, 150) || (vicGround && inRect(DEM4_RECT, X, Z, 120))) h -= 60;
  return (X !== x || Z !== z) ? h - 40 : h;
}
function updateFarTiles(px, pz) {
  if (!D3) return;
  const i0 = Math.floor(px / FCK), j0 = Math.floor(pz / FCK); let budget = 1, ready = true;
  for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
    const k = i + ',' + j; if (farTiles.has(k)) continue;
    if (budget-- <= 0) { ready = false; continue; }
    const x0 = i * FCK, z0 = j * FCK;
    if ((inRect(UNION, x0, z0, -1) && inRect(UNION, x0 + FCK, z0 + FCK, -1)) || !inRect(DEM3_RECT, x0 + FCK / 2, z0 + FCK / 2)) { farTiles.set(k, null); continue; }
    let land = false; for (let a = 0; a <= 6 && !land; a++) for (let b = 0; b <= 6; b++) if (heightAt(x0 + a * FCK / 6, z0 + b * FCK / 6) > -3) { land = true; break; }
    farTiles.set(k, land ? gridMesh(x0 - 100, z0 - 100, x0 + FCK + 100, z0 + FCK + 100, 100, (x, z) => farTileHeight(x0, z0, x, z), mountainColor, null, terrainMat) : null);
  }
  for (const [k, m] of farTiles) { const [i, j] = k.split(',').map(Number); if (Math.abs(i - i0) > 2 || Math.abs(j - j0) > 2) { if (m) { scene.remove(m); m.geometry.dispose(); } farTiles.delete(k); } }
  FAR_HOLE.value.set(px, ready ? 5800 : 0, pz);
}

// ---------- Victoria: a detailed 20 m ground with a painted texture (built when you get close) ----------
let vicGround = null;
function paintRegion(R, TW) {
  const TH = Math.round(TW * (R.z1 - R.z0) / (R.x1 - R.x0)), c = document.createElement('canvas'); c.width = TW; c.height = TH; const g = c.getContext('2d');
  const img = g.createImageData(TW, TH), d = img.data, sx = (R.x1 - R.x0) / TW, dens = densityGrid(R), lc = [0, 0, 0];
  for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
    const x = R.x0 + i * sx, z = R.z0 + j * sx, h = demH(x, z), k = (j * TW + i) * 4, n = hash2(i, j) * 0.5 + vnoise(x * 0.02, z * 0.02) * 0.5;
    if (h < 0.8) { d[k] = 70 + n * 20; d[k + 1] = 80 + n * 20; d[k + 2] = 65 + n * 15; }
    else { landColor(x, z, n, dens(x, z), lc); d[k] = lc[0]; d[k + 1] = lc[1]; d[k + 2] = lc[2]; }
    d[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const s = TW / (R.x1 - R.x0), P = (x, z) => [(x - R.x0) * s, (z - R.z0) * s];
  for (const k of ['grass', 'cemetery', 'golf', 'park', 'garden', 'wood', 'beach', 'rock', 'pitch', 'playground', 'pier']) for (const a of window.MAP.areas) {
    if (a.k !== k || a.p[0] < R.x0 - 2000 || a.p[0] > R.x1 + 2000 || a.p[1] < R.z0 - 2000 || a.p[1] > R.z1 + 2000) continue;
    g.beginPath(); for (let i = 0; i < a.p.length; i += 2) { const [X, Z] = P(a.p[i], a.p[i + 1]); i ? g.lineTo(X, Z) : g.moveTo(X, Z); }
    if (a.line) { g.lineWidth = 6 * s; g.strokeStyle = AREA_COL.pier; g.stroke(); continue; }
    g.closePath(); g.fillStyle = AREA_COL[k] || AREA_COL.park; g.fill();
  }
  treeShade(g, R, s);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t;
}
function updateVictoria(px, pz) {
  if (!D4 || vicGround) return;
  const R = DEM4_RECT, cx = (R.x0 + R.x1) / 2, cz = (R.z0 + R.z1) / 2;
  if (Math.hypot(px - cx, pz - cz) > 16000) return;
  const tex = paintRegion(R, 2048);
  vicGround = gridMesh(R.x0, R.z0, R.x1, R.z1, 20, (x, z) => { const e = 30; const edge = Math.min(x - R.x0, R.x1 - x, z - R.z0, R.z1 - z); return heightAt(x, z) - (edge < e ? 40 * (1 - edge / e) : 0); }, null, R, addSnowShader(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, envMapIntensity: 0.35 }), 'city'));
  for (const m of farTiles.values()) if (m) { scene.remove(m); m.geometry.dispose(); } farTiles.clear();   // rebuild them sunk under the new ground
}
export function prebuildChunksNear(px, pz) {
  updateVictoria(px, pz); for (const c of chunks) if (Math.max(Math.abs(c.cx - px), Math.abs(c.cz - pz)) < 4600 && !c.fine) { c.fine = buildChunkMesh(c, c.step); scene.add(c.fine); } }

// ---------- forests that grow in around you (whole region outside the city) ----------
let roadFilter = () => true;
export function setForestFilter(fn) { roadFilter = fn; }
let pisteFilter = () => true;   // ski runs are cleared of trees (pistes.js)
export function setPisteFilter(fn) { pisteFilter = fn; for (const m of forestCells.values()) dropCell(m); forestCells.clear(); }
const forestCells = new Map(), FC = 1000;
const forestMat = new THREE.MeshStandardMaterial({ roughness: 0.92, envMapIntensity: 0.25 });
// realistic trees (trees.js): one textured foliage material for every tree, and the "near ring" that swaps the trees
// within ~190 m of you to the detailed version (branches, needle sprays, leaf clusters, bark)
export const FOLIAGE = makeFoliageMat(HAZE, WATER_T);
export const treeRing = new NearRing(scene, FOLIAGE, 160);
function dropCell(m) { if (!m) return; scene.remove(m); m.traverse(o => { if (o.isInstancedMesh) { treeRing.remove(o); o.dispose(); } }); }
// a West Coast conifer (Douglas fir / cedar / hemlock): three stacked cone layers on a trunk (y 0..1, x/z -1..1)
function firGeo() {
  const parts = [[0.12, 0.30, 0, 0.42, 0.45], [0.22, 1.0, 0.3, 0.5, 0.75], [0.16, 0.78, 0.52, 0.36, 0.58], [0.1, 0.5, 0.72, 0.28, 0.4]];   // [rTop, rBottom, y0, height, ...]
  const pos = [];
  const add = (g, y) => { g = g.toNonIndexed(); g.translate(0, y, 0); pos.push(...g.attributes.position.array); };
  add(new THREE.CylinderGeometry(0.06, 0.09, 0.32, 5), 0.16);   // trunk
  for (const [rt, rb, y0, hh] of parts.slice(1)) add(new THREE.CylinderGeometry(rt * 0.2, rb, hh, 7), y0 + hh / 2);
  add(new THREE.ConeGeometry(0.18, 0.2, 6), 0.95);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // soft shading: normals point out from the trunk and a little up (a fir reads as one soft cone of needles, not flat panels)
  const nor = []; for (let i = 0; i < pos.length; i += 3) { const x = pos[i], z = pos[i + 2], l = Math.hypot(x, z) || 1; const nx = x / l, nz = z / l, ny = 0.55; const m = Math.hypot(nx, ny, nz); nor.push(nx / m, ny / m, nz / m); }
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); return g;
}
// BC coastal species (unit height, radius ~1): every tier is an open, drooping cone (no caps → cheap), soft needle normals.
// Douglas fir: tall, bare lower trunk, ragged layered crown. Western red cedar: fuller, drooping, buttressed. Hemlock: narrow
// with a nodding top. Subalpine fir: a thin spire (near the tree line).
function conifer(tiers, trunkTop, opts = {}) {
  const pos = [], push = g => { g = g.toNonIndexed(); pos.push(...g.attributes.position.array); };
  push(new THREE.CylinderGeometry(0.035, opts.butt || 0.07, trunkTop, 6, 1, true).translate(0, trunkTop / 2, 0));
  let seed = opts.seed || 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const [y0, hh, r] of tiers) {
    const g = new THREE.ConeGeometry(r, hh, 7, 1, true); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const yy = p.getY(i); if (yy < 0) { const a = Math.atan2(p.getZ(i), p.getX(i)), k = 0.82 + 0.3 * Math.abs(Math.sin(a * 3 + rnd() * 6)); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); p.setY(i, yy - (opts.droop || 0.15) * hh * k); } }
    g.translate(0, y0 + hh / 2, 0); g.rotateY(rnd() * 6.28); push(g);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nor = []; for (let i = 0; i < pos.length; i += 3) { const x = pos[i], z = pos[i + 2], l = Math.hypot(x, z); const r = l < 0.08 ? [0, 1, 0] : [x / l, 0.3, z / l]; const m = Math.hypot(...r); nor.push(r[0] / m, r[1] / m, r[2] / m); }
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); return g;
}
const tiersOf = (n, start, top, rBase, rTop, overlap = 1.5) => { const out = [], step = (top - start) / n; for (let i = 0; i < n; i++) { const t = i / (n - 1 || 1); out.push([start + i * step, step * overlap, rBase + (rTop - rBase) * t]); } return out; };
const FOREST_GEOS = {
  douglas: conifer(tiersOf(6, 0.34, 0.9, 0.5, 0.16, 1.7), 0.5, { droop: 0.18, seed: 3 }),
  cedar: conifer(tiersOf(6, 0.14, 0.88, 0.62, 0.2, 1.8), 0.25, { droop: 0.32, butt: 0.11, seed: 9 }),
  hemlock: conifer(tiersOf(7, 0.2, 0.92, 0.42, 0.1, 1.6), 0.3, { droop: 0.25, seed: 13 }),
  subalpine: conifer(tiersOf(6, 0.06, 0.95, 0.22, 0.06, 1.5), 0.15, { droop: 0.08, seed: 21 }),
};
const forestGeo = FOREST_GEOS.douglas;
const broadGeo = (() => { const pos = []; const add = (g, x, y, z, s) => { g = g.toNonIndexed(); g.scale(s, s * 0.85, s); g.translate(x, y, z); pos.push(...g.attributes.position.array); };
  add(new THREE.CylinderGeometry(0.05, 0.08, 0.5, 5), 0, 0.25, 0, 1); add(new THREE.IcosahedronGeometry(0.42, 0), 0, 0.7, 0, 1); add(new THREE.IcosahedronGeometry(0.3, 0), 0.32, 0.55, 0.1, 1); add(new THREE.IcosahedronGeometry(0.3, 0), -0.3, 0.6, -0.12, 1);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); return g; })();
const FOREST_MAX = 2600;
export const forestHoles = [];   // {x, z, r2}: cleared ground (snowfun.js tube parks)
// species colours (HSL): Douglas fir deep green, cedar a touch yellower, hemlock dark, subalpine fir blue-green
const SPECIES = { douglas: [0.31, 0.4, 0.07], cedar: [0.25, 0.45, 0.085], hemlock: [0.33, 0.38, 0.062], subalpine: [0.4, 0.28, 0.075] };
function buildForestCell(ci, cj) {
  let seed = (ci * 73856093) ^ (cj * 19349663); const rnd = () => { seed = (seed * 1664525 + 1013904223) | 0; return ((seed >>> 0) % 100000) / 100000; };
  const L = { douglas: [], cedar: [], hemlock: [], subalpine: [], broad: [] }; let total = 0;
  for (let n = 0; n < 6500 && total < FOREST_MAX; n++) {
    const x = ci * FC + rnd() * FC, z = cj * FC + rnd() * FC;
    if (maskAt(x, z) !== -1) continue;
    if (forestHoles.some(o => (x - o.x) ** 2 + (z - o.z) ** 2 < o.r2)) continue;   // tube parks etc.
    const h = heightAt(x, z), snow = isSnow(x, z, h);
    if (h < 2 || h > 1800 || (snow && h > 1500 && rnd() < 0.9) || h < waterLevel(x, z) + 0.5) continue;
    if (isRichmond(x, z)) continue;
    if (isNorthShoreTown(x, z, h) && rnd() < 0.55) continue;
    if (townDensity(x, z) > 0.01) continue;   // mapped streets and houses: no wild forest (street + park trees come from the map)
    if (vnoise(x * 0.003, z * 0.003) < 0.2) continue;   // natural clearings, avalanche paths, old burns
    const slope = Math.abs(heightAt(x + 6, z) - heightAt(x - 6, z)) + Math.abs(heightAt(x, z + 6) - heightAt(x, z - 6));
    if (slope > 14 && rnd() < 0.85) continue;            // cliffs and bare rock
    if (h > 1400 && rnd() < (h - 1400) / 300) continue;  // thinning towards the tree line
    if (!roadFilter(x, z) || !pisteFilter(x, z)) continue;
    const wet = vnoise(x * 0.01 + 9, z * 0.01 - 4), r = rnd(); let kind, H;
    if (h > 1150) { kind = r < 0.7 ? 'subalpine' : 'hemlock'; H = 7 + rnd() * 12 * (1 - clamp((h - 1150) / 600, 0, 0.7)); }
    else if (h < 380 && vnoise(x * 0.008 + 50, z * 0.008) > 0.64) { kind = 'broad'; H = 11 + rnd() * 9; }   // alder / bigleaf maple patches down low
    else { kind = r < 0.42 ? 'douglas' : r < 0.42 + 0.35 * (0.5 + wet) ? 'cedar' : 'hemlock'; const tall = h < 600 ? 1 : 1 - (h - 600) / 1100; H = (24 + rnd() * 30) * Math.max(0.45, tall); }
    const rad = kind === 'broad' ? H * 0.4 : H * ({ douglas: 0.17, cedar: 0.2, hemlock: 0.15, subalpine: 0.12 }[kind]);
    L[kind].push({ x, y: h - 0.4, z, s: rad, h: H }); total++;
  }
  if (!total) return null;
  const grp = new THREE.Group(), o = new THREE.Object3D(), col = new THREE.Color();
  for (const kind of Object.keys(L)) {
    const items = L[kind]; if (!items.length) continue;
    const key = kind === 'broad' ? 'alder' : kind, m = new THREE.InstancedMesh(SPECIES_GEO[key].far, FOLIAGE, items.length), pos = new Float32Array(items.length * 2);
    m.userData.pos = pos; treeRing.add(m, key, (ci + 0.5) * FC, (cj + 0.5) * FC, FC / 2);
    items.forEach((t, i) => { pos[2 * i] = t.x; pos[2 * i + 1] = t.z;
      o.position.set(t.x, t.y, t.z); o.rotation.set((rnd() - 0.5) * 0.06, rnd() * 6.28, (rnd() - 0.5) * 0.06); o.scale.set(t.s, t.h, t.s); o.updateMatrix(); m.setMatrixAt(i, o.matrix);
      if (kind === 'broad') { const se = G.season; if (se === 'fall') col.setHSL(0.06 + rnd() * 0.08, 0.65, 0.3 + rnd() * 0.08); else if (se === 'winter') col.setHSL(0.07, 0.12, 0.24); else col.setHSL(0.24 + rnd() * 0.05, 0.45, 0.18 + rnd() * 0.06); }
      else { const [hh, ss, ll] = SPECIES[kind]; col.setHSL(hh + (rnd() - 0.5) * 0.03, ss + (rnd() - 0.5) * 0.08, ll * (0.8 + rnd() * 0.45)); if (G.season === 'winter' || t.y > snowLine()) col.lerp(SNOWC, 0.35); }
      m.setColorAt(i, col);
    });
    m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere(); m.userData.full = items.length; grp.add(m);
  }
  scene.add(grp); return grp;
}
// ---------- the forest floor right around you: sword ferns, salal, mossy fallen logs, old-growth stumps ----------
const UG = { r: 105, x: 1e9, z: 1e9, meshes: null };
function ugMeshes() {
  const mk = (geo, mat, n, sh = true) => { const m = new THREE.InstancedMesh(geo, mat, n); m.count = 0; m.castShadow = sh; m.receiveShadow = true; m.frustumCulled = false; scene.add(m); return m; };
  // textured with the tree atlas (trees.js): arching fern fronds, leafy salal, bark-covered logs and cedar stumps
  return {
    fern: mk(fernGeo(), FOLIAGE, 4000, false),
    salal: mk(shrubGeo(), FOLIAGE, 1600),
    log: mk(logGeo(), FOLIAGE, 160),
    stump: mk(stumpGeo(), FOLIAGE, 120),
  };
}
// mapped woodland inside the city (Stanley Park, Pacific Spirit, Central Park…): a 250 m grid of 'wood' polygons
let woodGrid = null;
function inWood(x, z) {
  if (!woodGrid) { woodGrid = new Map(); for (const a of window.MAP.areas) { if (a.k !== 'wood' || a.line) continue; let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let i = 0; i < a.p.length; i += 2) { x0 = Math.min(x0, a.p[i]); x1 = Math.max(x1, a.p[i]); z0 = Math.min(z0, a.p[i + 1]); z1 = Math.max(z1, a.p[i + 1]); } for (let i = Math.floor(x0 / 250); i <= Math.floor(x1 / 250); i++) for (let j = Math.floor(z0 / 250); j <= Math.floor(z1 / 250); j++) { const k = i * 100003 + j; if (!woodGrid.has(k)) woodGrid.set(k, []); woodGrid.get(k).push(a.p); } } }
  const l = woodGrid.get(Math.floor(x / 250) * 100003 + Math.floor(z / 250)); if (!l) return false;
  for (const p of l) { let c = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if (((p[i + 1] > z) !== (p[j + 1] > z)) && x < (p[j] - p[i]) * (z - p[i + 1]) / (p[j + 1] - p[i + 1]) + p[i]) c = !c; if (c) return true; }
  return false;
}
const wildForest = (x, z, h) => pisteFilter(x, z) && ((inWood(x, z) && h > 1 && !isSnow(x, z, h) && roadFilter(x, z)) || maskAt(x, z) === -1 && h > 3 && h < 1250 && townDensity(x, z) <= 0.01 && !isRichmond(x, z) && !isNorthShoreTown(x, z, h) && !isSnow(x, z, h) && vnoise(x * 0.003, z * 0.003) >= 0.2 && roadFilter(x, z));
function updateUndergrowth(px, pz) {
  if (Math.hypot(px - UG.x, pz - UG.z) < 35) return;
  UG.x = px; UG.z = pz; if (!UG.meshes) UG.meshes = ugMeshes();
  const M = UG.meshes, n = { fern: 0, salal: 0, log: 0, stump: 0 }, o = new THREE.Object3D(), col = new THREE.Color();
  if (wildForest(px, pz, heightAt(px, pz)) || wildForest(px + 60, pz, heightAt(px + 60, pz)) || wildForest(px - 60, pz + 40, heightAt(px - 60, pz + 40))) {
    const S = 2.3, R = UG.r;
    for (let gx = Math.floor((px - R) / S); gx <= Math.ceil((px + R) / S); gx++) for (let gz = Math.floor((pz - R) / S); gz <= Math.ceil((pz + R) / S); gz++) {
      const r1 = hash2(gx, gz), x = (gx + hash2(gz, gx) ) * S, z = (gz + hash2(gx * 3, gz * 7)) * S; if ((x - px) ** 2 + (z - pz) ** 2 > R * R) continue;
      const h = groundY(x, z); if (!wildForest(x, z, h)) continue;
      const sl = Math.abs(heightAt(x + 3, z) - heightAt(x - 3, z)) + Math.abs(heightAt(x, z + 3) - heightAt(x, z - 3)); if (sl > 7) continue;
      const yaw = hash2(gz * 5, gx) * 6.28;
      if (r1 < 0.36 && n.fern < 4000) { const s = 0.7 + hash2(gx + 1, gz) * 0.8; o.position.set(x, h - 0.05, z); o.rotation.set(0, yaw, 0); o.scale.set(s, s, s); o.updateMatrix(); M.fern.setMatrixAt(n.fern, o.matrix); M.fern.setColorAt(n.fern, col.setHSL(0.27 + hash2(gx, gz + 2) * 0.05, 0.5, 0.2 + hash2(gz, gx + 2) * 0.1)); n.fern++; }
      else if (r1 < 0.5 && n.salal < 1600) { const s = 0.8 + hash2(gx + 3, gz) * 1.0; o.position.set(x, h - 0.1, z); o.rotation.set(0, yaw, 0); o.scale.set(s * 1.1, s * 0.75, s * 1.1); o.updateMatrix(); M.salal.setColorAt(n.salal, col.setHSL(0.24 + hash2(gx, gz + 7) * 0.06, 0.45, 0.16 + hash2(gz + 7, gx) * 0.06)); M.salal.setMatrixAt(n.salal++, o.matrix); }
      else if (r1 > 0.993 && n.log < 160) { const L = 6 + hash2(gx, gz + 9) * 12, rr = 0.35 + hash2(gz + 9, gx) * 0.45; o.position.set(x, h + rr * 0.6, z); o.rotation.set(0, yaw, (hash2(gx + 5, gz) - 0.5) * 0.12); o.scale.set(L, rr, rr); o.updateMatrix(); M.log.setMatrixAt(n.log++, o.matrix); }
      else if (r1 > 0.986 && r1 <= 0.993 && n.stump < 120) { const s = 0.9 + hash2(gx, gz + 4) * 0.8, hh = 1.6 + hash2(gz + 4, gx) * 2.4; o.position.set(x, h - 0.2, z); o.rotation.set(0, yaw, 0); o.scale.set(s, hh, s); o.updateMatrix(); M.stump.setMatrixAt(n.stump++, o.matrix); }
    }
  }
  for (const k of Object.keys(n)) { M[k].count = n[k]; M[k].instanceMatrix.needsUpdate = true; if (M[k].instanceColor) M[k].instanceColor.needsUpdate = true; }
}
function updateForestCells(px, pz) {
  updateUndergrowth(px, pz);
  { const tgt = wildForest(px, pz, heightAt(px, pz)) ? 1 : 0; G.gloom = (G.gloom || 0) + (tgt - (G.gloom || 0)) * Math.min(1, (G.dt || 0.016) * 1.2); }
  let budget = 2;
  const ci0 = Math.floor(px / FC), cj0 = Math.floor(pz / FC), R = 3;
  for (let i = ci0 - R; i <= ci0 + R; i++) for (let j = cj0 - R; j <= cj0 + R; j++) {
    const k = i + ',' + j; if (forestCells.has(k) || budget <= 0) continue;
    budget--; forestCells.set(k, buildForestCell(i, j));
  }
  for (const [k, m] of forestCells) {
    const [i, j] = k.split(',').map(Number), d = Math.max(Math.abs(i - ci0), Math.abs(j - cj0));
    if (d > R + 2) { dropCell(m); forestCells.delete(k); continue; }
    // full density close by, thinner further out (the trees are in random order, so the first N are an even sample)
    if (m) { const f = d <= 1 ? 1 : d === 2 ? 0.32 : 0.13; for (const c of m.children) { c.count = Math.max(1, Math.floor(c.userData.full * f)); c.castShadow = d <= 1; const g = SPECIES_GEO[c.userData.ringKey][d <= 1 ? 'far' : 'tiny']; if (c.geometry !== g) c.geometry = g; } m.visible = d <= R; }
  }
  { const cap = G.treeNear ?? 420; if (cap !== treeRing.cap) { treeRing.cap = cap; treeRing.dirty = true; } }
  treeRing.update(px, pz);
}

function makeWaterNormals() {
  const N = 256;
  return canvasTex(N, N, (ctx) => {
    const img = ctx.createImageData(N, N), H = new Float32Array(N * N);
    const pn = (x, y, p) => { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); const h = (a, b) => hash2(((a % p) + p) % p, ((b % p) + p) % p + 977); const A = h(i, j), B = h(i + 1, j), C = h(i, j + 1), E = h(i + 1, j + 1); return A + (B - A) * u + (C - A) * v + (A - B - C + E) * u * v; };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) H[y * N + x] = pn(x / N * 8, y / N * 8, 8) + 0.5 * pn(x / N * 16, y / N * 16, 16) + 0.25 * pn(x / N * 32, y / N * 32, 32);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = H[y * N + (x + 1) % N] - H[y * N + (x - 1 + N) % N], dy = H[((y + 1) % N) * N + x] - H[((y - 1 + N) % N) * N + x];
      const nx = -dx * 5, ny = -dy * 5, l = Math.hypot(nx, ny, 1), i4 = (y * N + x) * 4;
      img.data[i4] = (nx / l * 0.5 + 0.5) * 255; img.data[i4 + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i4 + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  });
}
export function updateWater(dt) { WATER_T.value += dt;
  { const n = G.night || 0, c = G.cloud || 0; HAZE.value.setRGB(0.46 - 0.04 * c, 0.6 - 0.12 * c, 0.82 - 0.26 * c).multiplyScalar(1 - 0.88 * n); /* clear-day mountains fade into soft sky blue */ } if (waterMat) { waterMat.normalMap.offset.x += dt * 0.004; waterMat.normalMap.offset.y += dt * 0.0025; } }

// ---------- chunked instanced trees (so far-away chunks can be skipped) ----------
export const treeChunks = [];
const CH = 600;
export function makeTreeChunks(list, geos, mats) {
  // list items: {x,y,z,s,h,k} k = 0 conifer, 1 deciduous, 2 small mountain conifer
  const byChunk = new Map();
  for (const t of list) { const key = Math.floor(t.x / CH) + ',' + Math.floor(t.z / CH); if (!byChunk.has(key)) byChunk.set(key, []); byChunk.get(key).push(t); }
  const o = new THREE.Object3D(), col = new THREE.Color();
  for (const [key, items] of byChunk) {
    const grp = new THREE.Group(); const [ci, cj] = key.split(',').map(Number);
    grp.userData.cx = (ci + 0.5) * CH; grp.userData.cz = (cj + 0.5) * CH;
    for (let k = 0; k < geos.length; k++) {
      const sub = items.filter(t => t.k === k); if (!sub.length) continue;
      for (const part of geos[k]) {
        const m = new THREE.InstancedMesh(part.geo, mats[part.mat], sub.length);
        if (part === geos[k][geos[k].length - 1]) { m.userData.crown = true; m.userData.k = k; m.userData.items = sub; m.userData.part = part; }
        if (part.key) { const pos = new Float32Array(sub.length * 2); sub.forEach((t, i) => { pos[2 * i] = t.x; pos[2 * i + 1] = t.z; }); m.userData.pos = pos; treeRing.add(m, part.key, grp.userData.cx, grp.userData.cz, CH / 2); }
        sub.forEach((t, i) => {
          o.position.set(t.x, t.y + (part.y || 0) * t.h, t.z); o.rotation.set(0, t.r || 0, 0);
          o.scale.set(t.s * part.sx, t.h * part.sy, t.s * part.sx); o.updateMatrix(); m.setMatrixAt(i, o.matrix); (t.refs || (t.refs = [])).push([m, i, 0]);
          col.setHSL(part.hue + (hash2(t.x, t.z) - 0.5) * 0.04, part.sat, part.light * (0.8 + 0.4 * hash2(t.z, t.x)));
          m.setColorAt(i, col);
        });
        m.castShadow = part.shadow !== false; m.receiveShadow = true; m.computeBoundingSphere(); grp.add(m);
      }
    }
    scene.add(grp); treeChunks.push(grp);
  }
  recolorTrees();
}
// ---------- seasonal tree colours ----------
export const cherryTrees = [];
const FALL = [[0.07, 0.85, 0.45], [0.02, 0.75, 0.38], [0.12, 0.85, 0.5], [0.09, 0.6, 0.3], [0.0, 0.7, 0.32]];
export function treeColor(k, t, part, out) {
  const s = G.season || 'summer', h1 = hash2(t.x, t.z), h2 = hash2(t.z, t.x);
  if (k === 0 || k === 2 || k === 6 || k === 7 || k === 8) {   // evergreens (and palms)
    out.setHSL(part.hue + (h1 - 0.5) * 0.04, part.sat, part.light * (0.8 + 0.4 * h2));
    if (s === 'winter') out.lerp(SNOWC, 0.35 + 0.2 * h1);
    return out;
  }
  const blossom = k === 3 || (s === 'spring' && h1 < 0.25);
  if (s === 'spring') return blossom ? out.setHSL(0.94 + h2 * 0.03, 0.78, 0.66 + h1 * 0.08) : out.setHSL(0.25 + h1 * 0.04, 0.55, 0.38 + 0.1 * h2);
  if (s === 'summer') return out.setHSL(0.27 + (h1 - 0.5) * 0.05, 0.45, 0.25 + 0.1 * h2);
  if (s === 'fall') { const f = FALL[Math.floor(h1 * FALL.length) % FALL.length]; return out.setHSL(f[0] + (h2 - 0.5) * 0.02, f[1], f[2] * (0.85 + 0.3 * h2)); }
  return out.setHSL(0.07, 0.12, 0.3 + 0.12 * h2);   // winter: bare branches
}
const SNOWC = new THREE.Color(0.92, 0.94, 0.97);
export function recolorTrees() {
  // wild forest cells were coloured for the old season (snowy, fall colours…): drop them, they regrow around you in a moment
  for (const m of forestCells.values()) dropCell(m);
  forestCells.clear(); FOL.bare.value = G.season === 'winter' ? 1 : 0; treeRing.dirty = true;
  const c = new THREE.Color(); cherryTrees.length = 0;
  for (const grp of treeChunks) for (const m of grp.children) {
    if (!m.userData.crown) continue;
    const { k, items, part } = m.userData;
    items.forEach((t, i) => { treeColor(k, t, part, c); m.setColorAt(i, c); if ((k === 3 || (G.season === 'spring' && k === 1 && hash2(t.x, t.z) < 0.25))) cherryTrees.push(t); });
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
}
export function cullTreeChunks(px, pz) {
  for (const c of treeChunks) { const d = Math.hypot(c.userData.cx - px, c.userData.cz - pz); c.visible = d < (c.userData.far || 4200);
    // level of detail: the far shape out to ~1.1 km, then a tiny one (a couple of cones / one leafy ball)
    const tiny = d > 1100; if (c.visible && c.userData.tiny !== tiny) { c.userData.tiny = tiny; for (const m of c.children) { const k = m.userData.ringKey; if (k) m.geometry = tiny ? SPECIES_GEO[k].tiny : SPECIES_GEO[k].far; } } }
}
// a leafy crown made of a few low-poly blobs (spans x/z -1..1, y 0..1), so trees look like trees, not one big oval
function clumpGeo() {
  // 7 lumpy blobs; normals point away from the crown's centre (blended with each blob's own), so the canopy is lit like one soft,
  // rounded mass of leaves instead of flat facets
  const blobs = [[0, 0.62, 0, 0.5], [0.45, 0.42, 0.12, 0.42], [-0.42, 0.45, -0.15, 0.42], [0.05, 0.4, -0.45, 0.38], [-0.08, 0.38, 0.45, 0.38], [0.3, 0.75, -0.25, 0.32], [-0.28, 0.72, 0.28, 0.33]];
  const pos = [], nor = [], C = new THREE.Vector3(0, 0.45, 0), v = new THREE.Vector3(), n = new THREE.Vector3();
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const [x, y, z, r] of blobs) {
    let g = new THREE.IcosahedronGeometry(r, 0);
    const pa = g.attributes.position; const jit = new Map();
    for (let i = 0; i < pa.count; i++) { const k = pa.getX(i).toFixed(3) + pa.getY(i).toFixed(3) + pa.getZ(i).toFixed(3); if (!jit.has(k)) jit.set(k, 0.82 + rnd() * 0.36); const s = jit.get(k); pa.setXYZ(i, pa.getX(i) * s, pa.getY(i) * s, pa.getZ(i) * s); }
    if (g.index) g = g.toNonIndexed();
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i) + x, p.getY(i) + y, p.getZ(i) + z); pos.push(v.x, v.y, v.z);
      n.set(p.getX(i), p.getY(i), p.getZ(i)).normalize().multiplyScalar(0.45).add(v.clone().sub(C).normalize().multiplyScalar(0.55)).normalize(); nor.push(n.x, n.y, n.z);
    }
  }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return geo;
}
// every city tree kind is ONE textured mesh (trees.js): far geometry in the chunks, detailed near geometry around you
// 0 Douglas fir, 1 leafy street/park tree, 2 subalpine fir, 3 cherry, 4 columnar (hornbeam / poplar), 5 broad maple / chestnut,
// 6 windmill palm (yes, Vancouver has palm trees: English Bay, Davie Street), 7 western red cedar, 8 hemlock
const sp = (key, hue, sat, light) => [{ geo: SPECIES_GEO[key].far, key, mat: 2, sx: 1, sy: 1, y: 0, hue, sat, light, crown: SPECIES_GEO[key].crown }];
export const TREE_GEOS = [sp('douglas', 0.31, 0.4, 0.075), sp('leafy', 0.26, 0.45, 0.3), sp('subalpine', 0.33, 0.4, 0.12), sp('leafy', 0.93, 0.55, 0.72),
  sp('columnar', 0.27, 0.45, 0.28), sp('broadmaple', 0.25, 0.5, 0.27), sp('palm', 0.28, 0.5, 0.22), sp('cedar', 0.25, 0.45, 0.09), sp('hemlock', 0.33, 0.38, 0.065)];
export const TREE_MATS = [new THREE.MeshStandardMaterial({ roughness: 1, envMapIntensity: 0.3 }), new THREE.MeshStandardMaterial({ roughness: 0.9, envMapIntensity: 0.25 })];   // (low sky reflection: needles and leaves aren't shiny)
// foliage: dappled clusters of leaves (light/dark speckle in world space, fading with distance) and darker undersides/insides
TREE_MATS[1].onBeforeCompile = sh => {
  sh.vertexShader = 'varying vec3 vLw; varying float vLn;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n#ifdef USE_INSTANCING\n mat4 lM = modelMatrix * instanceMatrix;\n#else\n mat4 lM = modelMatrix;\n#endif\n vLw = (lM * vec4(transformed, 1.0)).xyz; vLn = normalize(mat3(lM) * objectNormal).y;');
  sh.uniforms.uHaze = HAZE;
  sh.fragmentShader = 'varying vec3 vLw; varying float vLn; uniform vec3 uHaze;\nfloat lHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }\n'
    + 'float lNoise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(mix(lHash(i), lHash(i + vec3(1,0,0)), f.x), mix(lHash(i + vec3(0,1,0)), lHash(i + vec3(1,1,0)), f.x), f.y), mix(mix(lHash(i + vec3(0,0,1)), lHash(i + vec3(1,0,1)), f.x), mix(lHash(i + vec3(0,1,1)), lHash(i + vec3(1,1,1)), f.x), f.y), f.z); }\n'
    + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
    { float fw = fwidth(vLw.x) + fwidth(vLw.y), nr = 1.0 - smoothstep(0.03, 0.25, fw);
      // soft leaf clusters (smooth noise, no blocky cubes): small sunlit clumps + bigger light/shade patches, a little hue shift
      float l1 = lNoise(vLw * 3.4), l2 = lNoise(vLw * 0.85 + 7.0);
      diffuseColor.rgb *= mix(1.0, 0.72 + 0.5 * l1, nr) * (0.86 + 0.28 * l2);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.12, 1.06, 0.78), (l2 - 0.5) * 0.6);
      diffuseColor.rgb *= 0.6 + 0.4 * smoothstep(-0.7, 0.7, vLn);
      diffuseColor.rgb = mix(diffuseColor.rgb, uHaze, smoothstep(800.0, 30000.0, distance(cameraPosition, vLw)) * 0.5); }`);   // blue distance haze
};
forestMat.onBeforeCompile = TREE_MATS[1].onBeforeCompile;
TREE_MATS[2] = FOLIAGE;

function buildMountainForest() {
  const list = [];
  for (let n = 0; n < 160000 && list.length < 60000; n++) {
    const x = DEM_RECT.x0 + Math.random() * (DEM_RECT.x1 - DEM_RECT.x0), z = DEM_RECT.z0 + Math.random() * (DEM_RECT.z1 - DEM_RECT.z0);
    if (maskAt(x, z) !== -1) continue;
    const h = heightAt(x, z); if (h < 3 || h > 1300 || isSnow(x, z, h) && Math.random() < 0.85) continue;
    const town = isNorthShoreTown(x, z, h); if (town && Math.random() < 0.6) continue;
    const s = 3 + Math.random() * 3;
    list.push({ x, y: h - 0.5, z, s, h: s * 4.2, k: 2 });
  }
  makeTreeChunks(list, TREE_GEOS, TREE_MATS);
  for (const c of treeChunks) c.userData.far = 9000;
}
