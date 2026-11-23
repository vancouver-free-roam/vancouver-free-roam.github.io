// BC wildlife you can discover: bears that act like bears (forage, sniff, flip logs, stand up, bluff-charge, flee from a horn,
// raid bins, mothers with cubs that climb trees, salmon fishing in the fall), plus ~35 more researched BC species in the right
// places, seasons and times of day. Every animal is an instanced "rig" (body, head and 4 two-part legs) with a real walk cycle.
// E next to an animal = watch / make noise / (please don't) feed it; P = photograph it; the 📖 Nature tab is the field guide.
import * as THREE from 'three';
import { G, scene, camera, R, pick, clamp, wrapAngle, tapped, toXZ } from './core.js';
import { heightAt, isWater, waterLevel, maskAt, isSnow, isNorthShoreTown, isRichmond, townDensity, wildForest, treesNear, snowLine } from './terrain.js';
import { walkY, buildingAt, nearBuildings, nearestRoad } from './city.js';
import { animals } from './animals.js';
import { say } from './people.js';
import { ui } from './ui.js';
import { sfx, beep, noise } from './sound.js';
import { discover } from './missions.js';
import { onIsland } from './island.js';
import { OWN } from './shops.js';
import { register, spot, photo, softSpot } from './journal.js';
import { tintShader, bake, SP, SPs, CN, BX, cylD } from './tint.js';
import { photoPlant, floraPrompt } from './flora.js';

const M = window.MAP;
// ---------- areas index (parks, woods, ponds…) ----------
const AG = 250, areaGrid = new Map();
for (const a of M.areas) {
  if (a.line || !['water', 'park', 'wood', 'grass', 'beach', 'rock', 'golf', 'cemetery', 'flower'].includes(a.k)) continue;
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let i = 0; i < a.p.length; i += 2) { x0 = Math.min(x0, a.p[i]); x1 = Math.max(x1, a.p[i]); z0 = Math.min(z0, a.p[i + 1]); z1 = Math.max(z1, a.p[i + 1]); }
  const r = { a, x0, z0, x1, z1 };
  for (let i = Math.floor(x0 / AG); i <= Math.floor(x1 / AG); i++) for (let j = Math.floor(z0 / AG); j <= Math.floor(z1 / AG); j++) { const k = i * 100003 + j; if (!areaGrid.has(k)) areaGrid.set(k, []); areaGrid.get(k).push(r); }
}
function pip(x, z, p) { let c = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if (((p[i + 1] > z) !== (p[j + 1] > z)) && x < (p[j] - p[i]) * (z - p[i + 1]) / (p[j + 1] - p[i + 1]) + p[i]) c = !c; return c; }
export function areaAt(x, z, kind) { const l = areaGrid.get(Math.floor(x / AG) * 100003 + Math.floor(z / AG)); if (l) for (const r of l) if (r.a.k === kind && x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1 && pip(x, z, r.a.p)) return r.a; return null; }
const nearWater = (x, z, r) => { for (let b = 0; b < 6.28; b += 0.785) if (isWater(x + Math.cos(b) * r, z + Math.sin(b) * r)) return true; return false; };

// ---------- rigs: instanced animated skeletons ----------
const FUR = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, envMapIntensity: 0.3 });
FUR.onBeforeCompile = tintShader; FUR.customProgramCacheKey = () => 'faunaTint';
const _M = Array.from({ length: 16 }, () => new THREE.Matrix4()), _T = new THREE.Matrix4(), _Rm = new THREE.Matrix4(), _eu = new THREE.Euler(0, 0, 0, 'YXZ'), _one = new THREE.Color(1, 1, 1);
class Rig {
  constructor(geos, slots, cap) {
    this.slots = slots; this.meshes = {}; const uses = {};
    for (const s of slots) uses[s.g] = (uses[s.g] || 0) + 1;
    for (const g in uses) { const m = new THREE.InstancedMesh(geos[g], FUR, cap * uses[g]); m.count = 0; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.setColorAt(0, _one); m.visible = false; scene.add(m); this.meshes[g] = { m, n: 0, cap: cap * uses[g] }; }
  }
  begin() { for (const k in this.meshes) this.meshes[k].n = 0; }
  draw(root, pose, col) {
    const sl = this.slots;
    for (let i = 0; i < sl.length; i++) {
      const s = sl[i], P = s.p < 0 ? root : _M[s.p], r = pose[s.n];
      _T.makeTranslation(s.at[0], s.at[1], s.at[2]); _M[i].multiplyMatrices(P, _T);
      if (r) { _eu.set(r[0] || 0, r[1] || 0, r[2] || 0, 'YXZ'); _Rm.makeRotationFromEuler(_eu); _M[i].multiply(_Rm); }
      const e = this.meshes[s.g]; if (e.n < e.cap) { e.m.setMatrixAt(e.n, _M[i]); e.m.setColorAt(e.n, col); e.n++; }
    }
  }
  end() { for (const k in this.meshes) { const e = this.meshes[k]; e.m.count = e.n; e.m.visible = e.n > 0; if (e.n) { e.m.instanceMatrix.needsUpdate = true; e.m.instanceColor.needsUpdate = true; } } }
}

// ---------- model builders ----------
// Four-legged animal. Forward = -z. Hip pivot at height H; body runs from the hip (rump) to the chest at -L.
function quad(o) {
  const { L, H, g } = o, lr = o.leg ?? g * 0.28, hd = o.head ?? g * 0.55, [nl, na] = o.neck ?? [g * 0.6, 0.4], [sl, sr, sd = 0] = o.snout ?? [hd, hd * 0.5, 0];
  const dark = o.dark ?? '#15120f', belly = o.belly ?? 'F1.18', legc = o.legc ?? 'F0.85', earc = o.earc ?? 'F0.9', ch = o.chest ?? 1;
  const body = [
    [SP, 'F', 0, 0, -L * 0.5, g * 0.9, g * 0.95, L * 0.5 + g * 0.5],
    [SP, 'F', 0, g * 0.04, 0, g * 0.92, g * 0.96, g * 0.9],
    [SP, 'F', 0, 0, -L, g * 0.95 * ch, g * ch, g * 0.9],
    [SP, belly, 0, -g * 0.36, -L * 0.5, g * 0.72, g * 0.62, L * 0.45 + g * 0.3],
  ];
  if (o.tail) { const [tl, tr, dr, tc = 'F'] = o.tail; body.push([SP, tc, 0, g * 0.35 - Math.sin(dr) * tl * 0.5, g * 0.8 + Math.cos(dr) * tl * 0.5, tr, tr, tl * 0.55, dr]); if (o.tailTip) body.push([SP, o.tailTip, 0, g * 0.35 - Math.sin(dr) * tl * 0.95, g * 0.8 + Math.cos(dr) * tl * 0.95, tr * 1.05, tr * 1.05, tl * 0.14, dr]); }
  if (o.hump) body.push([SP, 'F', 0, g * 0.62, -L * 0.92, g * 0.6, g * 0.5, g * 0.7]);
  if (o.xbody) body.push(...o.xbody(o));
  const ny = Math.sin(na) * nl, nz = -Math.cos(na) * nl;
  const head = [
    [SP, 'F', 0, ny * 0.5, nz * 0.5, g * 0.46 * (o.neckW ?? 1), g * 0.52 * (o.neckW ?? 1), nl * 0.6 + g * 0.15, na],
    [SP, 'F', 0, ny, nz, hd * 0.8, hd * 0.82, hd],
    [SP, o.muzzle ?? 'F', 0, ny - hd * 0.18 - sd, nz - hd * 0.7 - sl * 0.4, sr, sr * 0.85, sl * 0.6, -0.12],
    [SPs, o.nose ?? dark, 0, ny - hd * 0.12 - sd, nz - hd * 0.72 - sl * 0.93, sr * 0.5, sr * 0.4, sr * 0.35],
    [SPs, '#0b0b0b', -hd * 0.5, ny + hd * 0.22, nz - hd * 0.6, hd * 0.11, hd * 0.11, hd * 0.09],
    [SPs, '#0b0b0b', hd * 0.5, ny + hd * 0.22, nz - hd * 0.6, hd * 0.11, hd * 0.11, hd * 0.09],
  ];
  const [et, e] = o.ears ?? ['point', hd * 0.4];
  for (const s of [-1, 1]) {
    if (et === 'round') head.push([SP, earc, s * hd * 0.6, ny + hd * 0.72, nz + hd * 0.1, e, e, e * 0.5]);
    else if (et === 'point' || et === 'tuft') { head.push([CN, earc, s * hd * 0.5, ny + hd * 0.78 + e * 0.4, nz + hd * 0.1, e * 0.5, e, e * 0.25, 0, 0, -s * 0.25]); if (et === 'tuft') head.push([cylD(e * 0.06, e * 0.03, e * 0.6, 4), '#111', s * (hd * 0.5 + e * 0.15), ny + hd * 0.78 + e * 1.4, nz + hd * 0.1, 1, 1, 1, 0, 0, -s * 0.2]); }
    else if (et === 'long') head.push([SP, earc, s * (hd * 0.65 + e * 0.45), ny + hd * 0.65, nz + hd * 0.2, e * 0.55, e * 0.22, e * 0.3, 0, 0, -s * 0.5]);
    else if (et === 'hare') head.push([SP, earc, s * hd * 0.32, ny + hd * 0.7 + e * 0.55, nz + hd * 0.25, e * 0.2, e * 0.62, e * 0.1, 0.25, 0, -s * 0.15]);
  }
  if (o.xhead) head.push(...o.xhead(ny, nz, hd, o));
  const Lf = H - g * 0.3, uf = Lf * 0.5, lf = Lf - uf, Lh = H - g * 0.2, uh = Lh * 0.5, lh = Lh - uh, pr = lr * (o.paw ?? 1.2);
  const foot = (len) => o.hoof ? [[cylD(lr * 0.8, lr * 0.62, len - lr * 1.3), legc], [cylD(lr * 0.65, lr * 0.85, lr * 1.3), dark, 0, -len + lr * 1.3]]
    : [[cylD(lr, lr * 0.8, len - pr * 0.5), legc], [SP, legc, 0, -len + pr * 0.55, -pr * 0.35, pr, pr * 0.55, pr * 1.3], o.claws && [CN, o.claws, 0, -len + pr * 0.25, -pr * 1.55, pr * 0.8, pr * 0.6, pr * 0.15, -1.45]];
  const fu = [[cylD(lr * 1.35, lr * 1.0, uf), 'F'], [SP, 'F', 0, -uf * 0.15, 0, lr * 1.7, uf * 0.55, lr * 1.8]];
  const hu = [[cylD(lr * 1.4, lr * 1.0, uh), 'F'], [SP, 'F', 0, -uh * 0.25, 0.02, lr * 2.0, uh * 0.65, lr * 2.4]];
  const geos = { body: bake(body), head: bake(head), fu: bake(fu), fl: bake(foot(lf).concat(o.xfoot ? o.xfoot(lf, lr) : [])), hu: bake(hu), hl: bake(foot(lh).concat(o.xfoot ? o.xfoot(lh, lr) : [])) };
  const slots = [{ n: 'body', g: 'body', p: -1, at: [0, H, L * 0.5] }, { n: 'head', g: 'head', p: 0, at: [0, g * 0.35, -L - g * 0.55] },
    { n: 'fuL', g: 'fu', p: 0, at: [-g * 0.5, -g * 0.3, -L] }, { n: 'fuR', g: 'fu', p: 0, at: [g * 0.5, -g * 0.3, -L] }, { n: 'flL', g: 'fl', p: 2, at: [0, -uf, 0] }, { n: 'flR', g: 'fl', p: 3, at: [0, -uf, 0] },
    { n: 'huL', g: 'hu', p: 0, at: [-g * 0.5, -g * 0.2, 0] }, { n: 'huR', g: 'hu', p: 0, at: [g * 0.5, -g * 0.2, 0] }, { n: 'hlL', g: 'hl', p: 6, at: [0, -uh, 0] }, { n: 'hlR', g: 'hl', p: 7, at: [0, -uh, 0] }];
  return { geos, slots, type: 'quad' };
}
// a bird: body + head + two wings. Forward = -z, origin at the feet.
function bird(o) {
  const l = o.len, r = l * 0.22, lg = o.legs ?? l * 0.18, sp = o.span ?? l * 1.6;
  const body = [[SP, 'F', 0, lg + r, 0, r, r * 0.95, l * 0.42], [SP, o.belly ?? 'F1.2', 0, lg + r * 0.7, -l * 0.05, r * 0.85, r * 0.7, l * 0.36],
    [BX, o.tailc ?? 'F0.8', 0, lg + r * 1.05, l * 0.5, r * 1.3, r * 0.1, l * 0.38, -0.2], o.legs !== 0 && [cylD(r * 0.08, r * 0.06, lg, 4), o.legc ?? '#3a3028', -r * 0.35, lg, 0], o.legs !== 0 && [cylD(r * 0.08, r * 0.06, lg, 4), o.legc ?? '#3a3028', r * 0.35, lg, 0]];
  if (o.xbody) body.push(...o.xbody(l, r, lg));
  const head = [[SP, o.headc ?? 'F', 0, r * 0.3, -r * 0.3, r * 0.68, r * 0.68, r * 0.72], [CN, o.beak ?? '#2a2a2a', 0, r * 0.22 - (o.beakDrop ?? 0), -r * 0.95 - (o.bl ?? r * 0.5) / 2, r * 0.18, o.bl ?? r * 0.5, r * 0.14, -Math.PI / 2],
    [SPs, '#080808', -r * 0.42, r * 0.45, -r * 0.55, r * 0.11, r * 0.11, r * 0.11], [SPs, '#080808', r * 0.42, r * 0.45, -r * 0.55, r * 0.11, r * 0.11, r * 0.11]];
  if (o.xhead) head.push(...o.xhead(r));
  const wing = s => [[SP, o.wingc ?? 'F0.85', s * sp * 0.25, 0, l * 0.1, sp * 0.26, r * 0.12, l * 0.26], [SP, o.tipc ?? o.wingc ?? 'F0.8', s * sp * 0.43, 0, l * 0.16, sp * 0.1, r * 0.1, l * 0.18]];
  const geos = { body: bake(body), head: bake(head), wl: bake(wing(-1)), wr: bake(wing(1)) };
  const slots = [{ n: 'body', g: 'body', p: -1, at: [0, 0, 0] }, { n: 'head', g: 'head', p: 0, at: [0, lg + r * 1.35, -l * 0.36] }, { n: 'wl', g: 'wl', p: 0, at: [-r * 0.7, lg + r * 1.3, -l * 0.1] }, { n: 'wr', g: 'wr', p: 0, at: [r * 0.7, lg + r * 1.3, -l * 0.1] }];
  return { geos, slots, type: 'bird' };
}
const one = parts => ({ geos: { body: bake(parts) }, slots: [{ n: 'body', g: 'body', p: -1, at: [0, 0, 0] }], type: 'one' });

// ---------- extra parts ----------
function antlers(kind, s = 1) {
  return (ny, nz, hd) => {
    const c = '#d8c7a4', out = [], y0 = ny + hd * 0.75, z0 = nz + hd * 0.05;
    for (const sd of [-1, 1]) {
      if (kind === 'moose') { out.push([cylD(0.03, 0.03, 0.2, 5), c, sd * 0.12, y0 + 0.02, z0, 1, 1, 1, 0, 0, sd * 1.3]); out.push([SP, c, sd * 0.42 * s, y0 + 0.12, z0 + 0.02, 0.3 * s, 0.05, 0.2 * s, 0.1, 0, -sd * 0.35]); for (let k = 0; k < 4; k++) out.push([CN, c, sd * (0.32 + k * 0.08) * s, y0 + 0.2, z0 - 0.08 + k * 0.05, 0.025, 0.14, 0.025, 0, 0, -sd * 0.3]); continue; }
      const len = kind === 'elk' ? 0.9 * s : 0.42 * s, beam = [];
      for (let k = 0; k < 5; k++) { const t = k / 4; beam.push([sd * (0.06 + t * len * 0.38), y0 + t * len * 0.9, z0 + t * len * 0.45 - t * t * len * 0.35]); }
      for (let k = 0; k < 4; k++) { const [x1, y1, z1] = beam[k], [x2, y2, z2] = beam[k + 1], dx = x2 - x1, dy = y2 - y1, dz = z2 - z1, Ln = Math.hypot(dx, dy, dz); out.push([cylD(0.022 * s + 0.01, 0.026 * s + 0.01, Ln, 5).rotateX(Math.PI), c, x1, y1, z1, 1, 1, 1, Math.atan2(dz, dy) * 0 + Math.atan2(Math.hypot(dz, 0), dy) * Math.sign(dz) * 0 + Math.atan2(dz, dy), 0, -Math.atan2(dx, dy)]); }
      for (let k = 1; k < 5; k++) { const [x, y, z] = beam[k]; out.push([CN, c, x, y + len * 0.1, z - len * 0.08, 0.02 * s + 0.01, len * 0.28, 0.02 * s + 0.01, -0.5, 0, -sd * 0.15]); }
    }
    return out;
  };
}
const goatHorns = (ny, nz, hd) => [-1, 1].map(s => [CN, '#141414', s * hd * 0.32, ny + hd * 0.95, nz + hd * 0.2, hd * 0.12, hd * 0.75, hd * 0.12, 0.45, 0, s * 0.08]);
const ramHorns = (ny, nz, hd) => [-1, 1].map(s => [new THREE.TorusGeometry(hd * 0.55, hd * 0.17, 6, 12, Math.PI * 1.5), '#a8957a', s * hd * 0.72, ny + hd * 0.35, nz + hd * 0.25, 1, 1, 1, 0, Math.PI / 2, Math.PI * 0.2]);
const QUILLS = o => { const out = []; for (let i = 0; i < 26; i++) { const a = (i / 26) * Math.PI * 1.3 - 0.65, zz = -o.L * (0.1 + (i % 7) / 7 * 0.9); out.push([CN, i % 3 ? '#d9cfb8' : '#3a3028', Math.sin(a) * o.g * 0.8, o.g * 0.75 + Math.cos(a) * o.g * 0.3, zz + 0.05, 0.02, o.g * 0.9, 0.02, 0.5, 0, -Math.sin(a) * 0.8]); } return out; };

// ---------- species ----------
const MT = 'Mountains & forest', CITYG = 'City & parks', SEA = 'Sea & shore', BIRDS = 'Birds';
const season = () => G.season || 'summer', night = () => (G.night || 0) > 0.5, dusk = () => (G.hour > 17 && G.hour < 21) || (G.hour > 5 && G.hour < 8.5);
const north = c => c.z < -30000, sky = c => c.z < -45000;   // Sea-to-Sky country (north of Lions Bay / Squamish)
const BEARCOL = () => { const r = Math.random(); return r < 0.72 ? '#17130f' : r < 0.9 ? '#5b3a22' : r < 0.97 ? '#8a5a32' : '#a07a50'; };
const S = {
  bear: { name: 'Black bear', emoji: '🐻', group: MT, rare: 1, kind: 'bear', fact: 'BC has about 140,000 black bears, a quarter of all in Canada. Despite the name they can be black, brown, cinnamon or even white. Straight "Roman" nose, tall ears, no shoulder hump.', where: 'North Shore forests and the Sea-to-Sky (not in winter: they sleep)',
    build: () => quad({ L: 0.72, H: 0.74, g: 0.38, leg: 0.11, head: 0.2, neck: [0.28, 0.2], snout: [0.24, 0.095, 0.0], ears: ['round', 0.078], tail: [0.1, 0.06, 0.9], paw: 1.35, claws: '#2a2420', muzzle: '#8d6c4a', chest: 1.05 }),
    cap: 10, ai: 'bear', speed: [1.3, 11], size: [0.9, 1.1], spot: 70, col: BEARCOL, hab: c => (c.forest || c.wild) && c.h > 20 && c.h < 1500 && !c.snow, when: () => season() === 'winter' ? 0.04 : season() === 'fall' ? 1.6 : 1, w: 0.1, n: [1, 1], max: 2 },
  grizzly: { name: 'Grizzly bear', emoji: '🐻', group: MT, rare: 2, kind: 'bear', fact: 'Look for the shoulder hump (pure digging muscle), the dished face, short round ears and claws as long as your fingers. If one attacks, play dead. BC is home to about 15,000.', where: 'high backcountry up the Sea-to-Sky',
    build: () => quad({ L: 0.8, H: 0.78, g: 0.42, leg: 0.13, head: 0.23, neck: [0.24, 0.0], snout: [0.17, 0.105, 0.06], ears: ['round', 0.062], tail: [0.08, 0.06, 0.9], paw: 1.4, claws: '#cbbf9f', hump: true, chest: 1.08, xhead: (ny, nz, hd) => [[SP, 'F', 0, ny + hd * 0.42, nz - hd * 0.25, hd * 0.6, hd * 0.45, hd * 0.6]], xbody: o => [[SP, 'F1.35', 0, o.g * 0.5, -o.L * 0.7, o.g * 0.75, o.g * 0.45, o.L * 0.55]] }),
    cap: 6, ai: 'bear', speed: [1.4, 13], size: [1.15, 1.35], spot: 80, col: () => pick(['#6b4a2c', '#5a3d24', '#7d5a38', '#4a3220']), hab: c => (c.forest || c.wild) && c.h > 400 && c.h < 2000 && (sky(c) || (north(c) && c.h > 900)) && !c.snow, when: () => season() === 'winter' ? 0.02 : 1, w: 0.06, n: [1, 1], max: 1 },
  deer: { name: 'Black-tailed deer', emoji: '🦌', group: MT, fact: 'The coast\'s own deer: a black tail, huge mule-like ears that swivel like satellite dishes. Fawns have white spots for their first summer. Bucks grow new antlers every year.', where: 'forest edges, North Shore yards, the Sea-to-Sky',
    build: () => quad({ L: 0.62, H: 0.84, g: 0.22, leg: 0.042, head: 0.1, neck: [0.44, 0.95], snout: [0.15, 0.055], ears: ['long', 0.15], tail: [0.17, 0.05, 0.6, '#1a1714'], hoof: true, belly: 'F1.4', muzzle: '#d6c8b0', xbody: o => [[SP, '#e8e2d4', 0, o.g * 0.1, o.g * 0.75, o.g * 0.5, o.g * 0.55, o.g * 0.3]] }),
    cap: 12, ai: 'grazer', speed: [1.2, 12], size: [0.85, 1.05], spot: 60, flee: 34, gait: 'bound', col: () => season() === 'winter' ? '#6a5a4a' : '#8d6a47', hab: c => (c.forest || c.wild || (c.town && c.z < -3000)) && c.h < 1350 && !c.snow, when: () => dusk() ? 1.6 : 1, w: 1, n: [1, 3], max: 6 },
  buck: { name: 'Black-tailed deer (buck)', jid: 'deer', emoji: '🦌', group: MT, build: () => quad({ L: 0.66, H: 0.88, g: 0.24, leg: 0.045, head: 0.11, neck: [0.44, 0.9], snout: [0.16, 0.06], ears: ['long', 0.15], tail: [0.17, 0.05, 0.6, '#1a1714'], hoof: true, belly: 'F1.4', muzzle: '#d6c8b0', xhead: antlers('deer', 1) }),
    cap: 3, ai: 'grazer', speed: [1.2, 12], size: [0.95, 1.05], spot: 60, flee: 34, gait: 'bound', col: () => '#86664a', hab: c => (c.forest || c.wild) && c.h < 1350 && !c.snow, when: () => ['fall', 'winter'].includes(season()) ? 1 : 0.3, w: 0.25, n: [1, 1], max: 1 },
  elk: { name: 'Roosevelt elk', emoji: '🦌', group: MT, rare: 1, fact: 'The biggest elk in North America, brought back to the Sea-to-Sky in the 2000s. In the fall the bulls "bugle": an eerie squealing whistle that carries for kilometres.', where: 'river valleys around Squamish and Whistler',
    build: () => quad({ L: 0.95, H: 1.12, g: 0.38, leg: 0.07, head: 0.15, neck: [0.6, 0.78], neckW: 1.3, snout: [0.27, 0.08], ears: ['long', 0.17], tail: [0.08, 0.06, 0.8], hoof: true, belly: 'F0.7', legc: '#3d2c1e', xbody: o => [[SP, '#d9c49a', 0, o.g * 0.15, o.g * 0.55, o.g * 0.75, o.g * 0.8, o.g * 0.55]], xhead: (ny, nz, hd) => [[SP, '#3e2b1c', 0, ny * 0.45, nz * 0.45, 0.24, 0.3, 0.42, 0.78]] }),
    cap: 10, ai: 'grazer', speed: [1.3, 13], size: [0.95, 1.05], spot: 90, flee: 45, gait: 'gallop', col: () => '#9a7448', hab: c => (c.forest || c.wild) && c.h < 900 && c.z < -40000 && !c.snow, w: 0.5, n: [3, 7], max: 8 },
  bullelk: { name: 'Roosevelt elk (bull)', jid: 'elk', emoji: '🦌', group: MT, build: () => quad({ L: 1.0, H: 1.18, g: 0.42, leg: 0.075, head: 0.16, neck: [0.6, 0.72], neckW: 1.4, snout: [0.28, 0.085], ears: ['long', 0.17], tail: [0.08, 0.06, 0.8], hoof: true, belly: 'F0.7', legc: '#3d2c1e', xbody: o => [[SP, '#d9c49a', 0, o.g * 0.15, o.g * 0.55, o.g * 0.75, o.g * 0.8, o.g * 0.55]], xhead: (ny, nz, hd, o) => [[SP, '#3a281a', 0, ny * 0.45, nz * 0.45, 0.27, 0.34, 0.44, 0.72], ...antlers('elk', 1.1)(ny, nz, hd)] }),
    cap: 2, ai: 'grazer', speed: [1.3, 13], size: [1, 1.08], spot: 100, flee: 30, gait: 'gallop', col: () => '#a07a4c', hab: c => (c.forest || c.wild) && c.h < 900 && c.z < -40000 && !c.snow, w: 0.2, n: [1, 1], max: 1, bull: true },
  moose: { name: 'Moose', emoji: '🫎', group: MT, rare: 2, fact: 'The biggest deer on Earth: up to 2 m at the shoulder and 600 kg. They wade into lakes to eat water plants. Moose hurt more people than bears do: give them lots of room.', where: 'wetlands and lakes north of Squamish (rare)',
    build: () => quad({ L: 1.0, H: 1.42, g: 0.45, leg: 0.075, head: 0.17, neck: [0.42, 0.42], snout: [0.42, 0.13, 0.13], ears: ['long', 0.18], tail: [0.06, 0.05, 0.9], hoof: true, hump: true, legc: '#9b8b74', belly: 'F0.8', xhead: (ny, nz, hd) => [[SP, 'F', 0, ny - hd * 1.3, nz - hd * 0.2, 0.06, 0.2, 0.06], ...antlers('moose', 1)(ny, nz, hd)] }),
    cap: 2, ai: 'grazer', speed: [1.2, 12], size: [0.95, 1.05], spot: 100, flee: 0, charge: 18, gait: 'trot', col: () => '#3d2e22', hab: c => (c.forest || c.wild) && c.h < 1100 && c.z < -60000 && !c.snow, w: 0.06, n: [1, 1], max: 1 },
  goat: { name: 'Mountain goat', emoji: '🐐', group: MT, rare: 1, fact: 'Not a true goat (closer to antelopes). Rubber-soled split hooves grip cliffs that would scare a rock climber. Their white wool keeps them warm at -40°C.', where: 'steep cliffs high in the mountains',
    build: () => quad({ L: 0.48, H: 0.62, g: 0.32, leg: 0.085, head: 0.12, neck: [0.24, 0.55], snout: [0.16, 0.065], ears: ['point', 0.09], tail: [0.06, 0.05, 0.9], hoof: true, belly: 'F0.97', legc: 'F0.95', dark: '#222', xhead: (ny, nz, hd) => [...goatHorns(ny, nz, hd), [SP, 'F', 0, ny - hd * 0.95, nz - hd * 0.55, hd * 0.25, hd * 0.6, hd * 0.25]], xbody: o => [[SP, 'F', 0, o.g * 0.55, -o.L * 0.85, o.g * 0.65, o.g * 0.5, o.g * 0.65]] }),
    cap: 8, ai: 'grazer', speed: [0.9, 5], size: [0.9, 1.05], spot: 70, flee: 22, col: () => '#f1efe6', hab: c => c.h > 1150 && c.slope > 6, w: 2, n: [1, 3], max: 4 },
  bighorn: { name: 'Bighorn sheep', emoji: '🐏', group: MT, rare: 2, fact: 'Rams smash their curled horns together at 30 km/h to settle who\'s boss; the crack echoes off the cliffs. BC\'s bighorns mostly live in the dry Interior, so this one is a real wanderer.', where: 'high rocky slopes around Whistler (very rare)',
    build: () => quad({ L: 0.55, H: 0.68, g: 0.3, leg: 0.06, head: 0.12, neck: [0.3, 0.6], snout: [0.16, 0.07], muzzle: '#e6dccb', ears: ['point', 0.07], tail: [0.07, 0.05, 0.9, '#3a2b1f'], hoof: true, belly: '#e8dfcd', xhead: ramHorns, xbody: o => [[SP, '#efe7d8', 0, 0, o.g * 0.6, o.g * 0.7, o.g * 0.75, o.g * 0.5]] }),
    cap: 4, ai: 'grazer', speed: [1, 9], size: [0.95, 1.05], spot: 70, flee: 30, col: () => '#8a6d4f', hab: c => c.h > 1300 && c.slope > 4 && c.z < -75000 && !c.snow, w: 0.15, n: [2, 3], max: 3 },
  cougar: { name: 'Cougar', emoji: '🐆', group: MT, rare: 2, fact: 'BC has the most cougars in Canada, but they are shy ghosts: most hikers never see one. If you do, make yourself big, keep eye contact, back away slowly. Never run.', where: 'deep forest, more often at dawn, dusk and night',
    build: () => quad({ L: 0.82, H: 0.55, g: 0.2, leg: 0.065, head: 0.12, neck: [0.22, 0.2], snout: [0.08, 0.07], ears: ['round', 0.045], tail: [0.9, 0.05, 1.05], tailTip: '#2a2018', muzzle: '#efe6d6', belly: 'F1.35', paw: 1.4 }),
    cap: 2, ai: 'cougar', speed: [1.4, 14], size: [0.95, 1.05], spot: 55, flee: 25, gait: 'bound', col: () => '#b08a5e', hab: c => c.forest && c.h < 1400, when: () => night() || dusk() ? 3 : 0.4, w: 0.035, n: [1, 1], max: 1 },
  bobcat: { name: 'Bobcat', emoji: '🐈', group: MT, rare: 1, fact: 'Twice the size of a house cat, with a "bobbed" stubby tail and spotted coat. They live closer to towns than you\'d think and hunt rabbits and voles at dusk.', where: 'low forest edges and fields',
    build: () => quad({ L: 0.38, H: 0.38, g: 0.14, leg: 0.045, head: 0.095, neck: [0.12, 0.3], snout: [0.05, 0.05], muzzle: '#eee5d5', ears: ['tuft', 0.05], tail: [0.12, 0.035, 0.3, 'F'], tailTip: '#1a1612', belly: 'F1.4', xbody: o => { const s = []; for (let i = 0; i < 14; i++) s.push([SPs, '#3a2c1e', (Math.random() - 0.5) * o.g * 1.7, o.g * (0.2 + Math.random() * 0.5), -Math.random() * o.L * 1.1, 0.02, 0.015, 0.03]); return s; } }),
    cap: 2, ai: 'grazer', speed: [1.1, 11], size: [0.95, 1.05], spot: 35, flee: 30, gait: 'bound', col: () => '#a3845f', hab: c => (c.forest || c.wild) && c.h < 700, when: () => dusk() ? 2.5 : 0.6, w: 0.06, n: [1, 1], max: 1 },
  lynx: { name: 'Canada lynx', emoji: '🐈', group: MT, rare: 2, fact: 'Giant furry paws work like snowshoes; long black ear tufts; a frosty grey coat. Lynx numbers rise and fall with the snowshoe hares they hunt, in a 10-year cycle.', where: 'subalpine forest, especially in snow (rare)',
    build: () => quad({ L: 0.42, H: 0.5, g: 0.15, leg: 0.055, head: 0.1, neck: [0.13, 0.3], snout: [0.05, 0.05], ears: ['tuft', 0.075], tail: [0.1, 0.04, 0.5], tailTip: '#111', paw: 1.9, belly: 'F1.2', xhead: (ny, nz, hd) => [-1, 1].map(s => [CN, 'F1.15', s * hd * 0.75, ny - hd * 0.35, nz - hd * 0.2, hd * 0.25, hd * 0.6, hd * 0.2, 0, 0, s * 2.4]) }),
    cap: 2, ai: 'grazer', speed: [1.1, 11], size: [0.95, 1.05], spot: 40, flee: 30, gait: 'bound', col: () => '#a9a39a', hab: c => (c.forest || c.wild) && c.h > 800 && c.h < 1800, when: () => isSnowNow() ? 2 : 0.5, w: 0.03, n: [1, 1], max: 1 },
  wolf: { name: 'Grey wolf', emoji: '🐺', group: MT, rare: 2, fact: 'Wolves live in family packs and can travel 50 km a day. Coastal BC wolves even swim between islands and eat salmon and seals. Their howl carries 10 km.', where: 'remote valleys up the Sea-to-Sky and on Vancouver Island (rare)',
    build: () => quad({ L: 0.66, H: 0.66, g: 0.19, leg: 0.05, head: 0.12, neck: [0.28, 0.45], snout: [0.2, 0.06], ears: ['point', 0.085], tail: [0.48, 0.07, 1.0], muzzle: 'F1.3', belly: 'F1.35', chest: 1.1 }),
    cap: 6, ai: 'wolf', speed: [1.6, 13], size: [0.95, 1.08], spot: 70, flee: 45, gait: 'trot', col: () => pick(['#8d8a84', '#77746e', '#2a2826', '#9c9384']), hab: c => (c.forest || c.wild) && c.h < 1600 && (c.z < -30000 || c.island), when: () => night() ? 2 : 1, w: 0.025, n: [3, 6], max: 6 },
  coyote: { name: 'Coyote', jid: 'coyote', emoji: '🐺', group: CITYG, build: () => quad({ L: 0.5, H: 0.48, g: 0.14, leg: 0.038, head: 0.095, neck: [0.2, 0.45], snout: [0.15, 0.045], ears: ['point', 0.08], tail: [0.35, 0.055, 1.1], tailTip: '#222', muzzle: 'F1.3', belly: 'F1.4' }),
    cap: 3, ai: 'grazer', speed: [1.5, 12], size: [0.95, 1.05], spot: 40, flee: 30, gait: 'trot', col: () => '#9b8366', hab: c => (c.wild || c.forest || c.park) && c.h < 900, when: () => dusk() ? 2 : 0.5, w: 0.08, n: [1, 2], max: 2 },
  marmot: { name: 'Hoary marmot', emoji: '🦫', group: MT, rare: 1, fact: 'Whistler is named after them! They sit up on boulders and give a loud, piercing whistle when they spot danger. They sleep 8 months of the year.', where: 'alpine boulder fields in summer and fall',
    build: () => quad({ L: 0.22, H: 0.17, g: 0.14, leg: 0.045, head: 0.085, neck: [0.08, 0.3], snout: [0.06, 0.045], ears: ['round', 0.03], tail: [0.2, 0.05, 0.5, '#5a4632'], legc: '#2b2420', muzzle: '#ece8e0', xhead: (ny, nz, hd) => [[SP, '#1c1814', 0, ny + hd * 0.35, nz - hd * 0.1, hd * 0.7, hd * 0.4, hd * 0.75]] }),
    cap: 6, ai: 'sentinel', speed: [0.8, 5], size: [0.95, 1.1], spot: 40, flee: 18, gait: 'bound', call: 'whistle', col: () => '#b8b3a8', hab: c => c.h > 1300 && !c.forest && !c.snow, when: () => ['summer', 'fall'].includes(season()) ? 1 : 0, w: 1.5, n: [1, 3], max: 4 },
  vimarmot: { name: 'Vancouver Island marmot', emoji: '🦫', group: MT, rare: 3, fact: 'One of the rarest mammals on Earth: chocolate-brown with a white nose, found only in the mountains of Vancouver Island. Fewer than 30 were left in 2003; breeding saved them.', where: 'alpine meadows on Vancouver Island (legendary)',
    build: () => quad({ L: 0.22, H: 0.17, g: 0.14, leg: 0.045, head: 0.085, neck: [0.08, 0.3], snout: [0.06, 0.045], ears: ['round', 0.03], tail: [0.2, 0.05, 0.5], muzzle: '#f4f1ea' }),
    cap: 2, ai: 'sentinel', speed: [0.8, 5], size: [1, 1.1], spot: 40, flee: 18, gait: 'bound', call: 'whistle', col: () => '#3b2a1e', hab: c => c.island && c.h > 900 && !c.snow, when: () => ['summer', 'fall'].includes(season()) ? 1 : 0, w: 1, n: [1, 2], max: 2 },
  pika: { name: 'American pika', emoji: '🐹', group: MT, rare: 1, fact: 'A tiny round relative of rabbits. All summer it cuts grass and flowers and stacks "haypiles" under the rocks to eat through the winter. Listen for its "EEP!"', where: 'rocky talus slopes up high',
    build: () => quad({ L: 0.05, H: 0.06, g: 0.065, leg: 0.018, head: 0.055, neck: [0.02, 0.2], snout: [0.025, 0.035], ears: ['round', 0.03] }),
    cap: 6, ai: 'sentinel', speed: [0.6, 3], size: [0.95, 1.1], spot: 18, flee: 9, gait: 'bound', call: 'eep', col: () => '#8a7860', hab: c => c.h > 1250 && c.slope > 3 && !c.forest && !c.snow, when: () => season() === 'winter' ? 0.2 : 1, w: 1, n: [1, 2], max: 4, small: true },
  hare: { name: 'Snowshoe hare', emoji: '🐇', group: MT, fact: 'Brown in summer, pure white in winter: it moults twice a year. Huge furry hind feet let it float over deep snow.', where: 'forests and subalpine (white in winter)',
    build: () => quad({ L: 0.16, H: 0.19, g: 0.1, leg: 0.028, head: 0.065, neck: [0.05, 0.6], snout: [0.05, 0.04], ears: ['hare', 0.12], earc: 'F', tail: [0.04, 0.04, -0.3, '#f4f4f0'], paw: 1.6, belly: 'F1.25' }),
    cap: 6, ai: 'grazer', speed: [0.8, 10], size: [0.95, 1.1], spot: 25, flee: 14, gait: 'bound', zig: true, col: () => isSnowNow() ? '#f1f1ee' : '#7a5f45', hab: c => (c.forest || c.wild) && c.h > 200, when: () => dusk() ? 2 : 1, w: 0.35, n: [1, 1], max: 2, small: true },
  rabbit: { name: 'Feral rabbit', emoji: '🐰', group: CITYG, fact: 'Jericho Beach and Richmond are famous for "wild" rabbits: abandoned pet bunnies that multiplied. That\'s why they come in black, white, spotted and brown.', where: 'Jericho Beach, UBC and Richmond lawns',
    build: () => quad({ L: 0.15, H: 0.16, g: 0.1, leg: 0.026, head: 0.065, neck: [0.05, 0.6], snout: [0.05, 0.04], ears: ['hare', 0.1], tail: [0.035, 0.035, -0.3, '#f4f4f0'], belly: 'F1.1' }),
    cap: 10, ai: 'grazer', speed: [0.6, 8], size: [0.9, 1.1], spot: 25, flee: 7, gait: 'bound', zig: true, col: () => pick(['#1a1816', '#f2efe8', '#7a6048', '#9a8a78', '#4a3a2e']), hab: c => !c.water && (c.park || c.grass) && (c.jericho || (isRichmond(c.x, c.z) && c.h < 6)), w: 3, n: [2, 4], max: 8, small: true },
  porcupine: { name: 'Porcupine', emoji: '🦔', group: MT, rare: 1, fact: 'Covered in about 30,000 barbed quills. It can\'t shoot them, but if you touch one they stick. It waddles slowly because it has nothing to fear (except fishers).', where: 'forests, often up in trees at night',
    build: () => quad({ L: 0.24, H: 0.2, g: 0.19, leg: 0.05, head: 0.08, neck: [0.08, 0.1], snout: [0.05, 0.05], ears: ['round', 0.02], tail: [0.15, 0.06, 0.6], legc: '#2a241e', xbody: QUILLS }),
    cap: 3, ai: 'porcupine', speed: [0.35, 0.6], size: [0.95, 1.1], spot: 25, col: () => '#3e3328', hab: c => c.forest && c.h < 1500, w: 0.12, n: [1, 1], max: 1, small: true },
  marten: { name: 'Pacific marten', emoji: '🦦', group: MT, rare: 1, fact: 'A sleek tree-climbing weasel with an orange bib. It bounds across branches chasing squirrels and loves old-growth forest.', where: 'old forest higher up',
    build: () => quad({ L: 0.3, H: 0.15, g: 0.075, leg: 0.024, head: 0.055, neck: [0.08, 0.3], snout: [0.045, 0.032], ears: ['round', 0.03], tail: [0.24, 0.045, 0.5], xbody: o => [[SP, '#e8a050', 0, -o.g * 0.2, -o.L, o.g * 0.65, o.g * 0.6, o.g * 0.6]] }),
    cap: 2, ai: 'grazer', speed: [1.2, 8], size: [0.95, 1.05], spot: 25, flee: 16, gait: 'bound', col: () => '#5a3c22', hab: c => c.forest && c.h > 500, w: 0.1, n: [1, 1], max: 1, small: true },
  dsquirrel: { name: 'Douglas squirrel', emoji: '🐿️', group: MT, fact: 'The native squirrel of the coast forest: small, reddish-brown with an orange belly, and LOUD. It scolds you from a branch and cuts down cones to stash for winter.', where: 'any conifer forest',
    build: () => quad({ L: 0.08, H: 0.07, g: 0.05, leg: 0.015, head: 0.035, neck: [0.02, 0.4], snout: [0.022, 0.02], ears: ['round', 0.012], tail: [0.15, 0.035, -1.1], belly: '#e09a4a' }),
    cap: 6, ai: 'grazer', speed: [0.8, 6], size: [0.95, 1.1], spot: 18, flee: 8, gait: 'bound', zig: true, col: () => '#6a4428', hab: c => c.forest, w: 0.6, n: [1, 1], max: 3, small: true, chatter: true },
  skunk: { name: 'Striped skunk', emoji: '🦨', group: CITYG, rare: 1, fact: 'It warns you first: stamps its feet, raises its tail, then turns around. The spray can hit you from 3 m away and the smell lasts for days.', where: 'city parks and yards at night',
    build: () => quad({ L: 0.22, H: 0.14, g: 0.12, leg: 0.03, head: 0.07, neck: [0.06, 0.2], snout: [0.06, 0.035], ears: ['round', 0.02], tail: [0.3, 0.1, -0.7, 'F'], belly: 'F', xbody: o => [-1, 1].map(s => [SP, '#f2f2ee', s * o.g * 0.35, o.g * 0.82, -o.L * 0.5, o.g * 0.18, o.g * 0.16, o.L * 0.62 + o.g * 0.3]), xhead: (ny, nz, hd) => [[SP, '#f2f2ee', 0, ny + hd * 0.5, nz - hd * 0.3, hd * 0.12, hd * 0.12, hd * 0.6]] }),
    cap: 3, ai: 'skunk', speed: [0.7, 3], size: [0.95, 1.05], spot: 20, col: () => '#121212', hab: c => (c.park || c.town || c.forest) && c.h < 400, when: () => night() ? 1 : 0, w: 0.3, n: [1, 1], max: 1, small: true },
  otter: { name: 'River otter', emoji: '🦦', group: SEA, rare: 1, fact: 'River otters hunt in the sea too (unlike sea otters, they live on land). They slide down muddy banks on their bellies just for fun.', where: 'rocky shores, marinas, lakes and rivers',
    build: () => quad({ L: 0.42, H: 0.15, g: 0.1, leg: 0.03, head: 0.075, neck: [0.1, 0.15], snout: [0.04, 0.05], ears: ['round', 0.015], tail: [0.4, 0.06, 0.25], muzzle: 'F1.3', belly: 'F1.2' }),
    cap: 4, ai: 'otter', speed: [1, 6], size: [0.95, 1.05], spot: 30, flee: 12, gait: 'bound', col: () => '#3a2a1e', hab: c => c.shore && c.h < 8, w: 0.25, n: [1, 3], max: 3, small: true },
  beaver: { name: 'North American beaver', emoji: '🦫', group: CITYG, fact: 'Canada\'s national animal. Beavers moved into Lost Lagoon by themselves in 2016. They slap their flat tail on the water as an alarm, then dive.', where: 'Lost Lagoon, Beaver Lake and other ponds, at dusk',
    build: () => quad({ L: 0.3, H: 0.16, g: 0.2, leg: 0.045, head: 0.1, neck: [0.08, 0.15], snout: [0.07, 0.07], ears: ['round', 0.02], legc: '#2a1e14', xbody: o => [[SP, '#2a2420', 0, o.g * 0.05, o.g * 1.25, o.g * 0.55, o.g * 0.12, o.g * 0.9]], xhead: (ny, nz, hd) => [[BX, '#e08a30', 0, ny - hd * 0.55, nz - hd * 1.25, hd * 0.3, hd * 0.2, hd * 0.06]] }),
    cap: 3, ai: 'swim', speed: [0.7, 2], size: [0.95, 1.05], spot: 35, flee: 14, col: () => '#5b4029', hab: c => c.water && c.fresh, when: () => dusk() || night() ? 2 : 0.3, w: 1.2, n: [1, 1], max: 2 },
  sealion: { name: 'Steller sea lion', emoji: '🦭', group: SEA, rare: 1, fact: 'Bulls weigh up to a tonne, five times more than the females. Unlike seals they have ear flaps, walk on their flippers and BARK. They follow the herring into Burrard Inlet every spring.', where: 'rocky shores out of town, open water',
    build: () => quad({ L: 0.75, H: 0.42, g: 0.42, leg: 0.1, head: 0.16, neck: [0.42, 0.6], neckW: 1.5, snout: [0.12, 0.08], ears: ['round', 0.015], tail: [0.15, 0.05, 1.2], paw: 2.8, legc: 'F0.7' }),
    cap: 8, ai: 'haul', speed: [0.6, 3], size: [0.85, 1.15], spot: 70, flee: 15, col: () => pick(['#8a6a48', '#6e5238', '#9c7a52']), hab: c => c.shore && c.rocky && c.seaNear, w: 0.6, n: [3, 6], max: 6 },
  // ---- birds ----
  jay: { name: "Steller's jay", emoji: '🐦', group: BIRDS, fact: "BC's official bird: deep blue body, black crested head. A noisy mimic: it can copy a hawk's scream. Loves your campsite peanuts.", where: 'conifer forests and North Shore yards',
    build: () => bird({ len: 0.3, headc: '#121a26', belly: '#2b4f8c', wingc: '#24508f', tailc: '#1f4a8a', beak: '#111', xhead: r => [[CN, '#121a26', 0, r * 1.05, r * 0.1, r * 0.35, r * 0.9, r * 0.25, 0.6]] }),
    cap: 6, ai: 'groundbird', speed: [1, 8], size: [0.95, 1.05], spot: 25, flee: 6, col: () => '#2d5aa0', call: 'jay', hab: c => c.forest || (c.town && c.z < -3000), w: 0.5, n: [1, 2], max: 3, small: true },
  grouse: { name: 'Sooty grouse', emoji: '🐦', group: BIRDS, fact: 'Males "hoot" deep booming calls from the treetops in spring. On the ground they freeze, then explode into flight at your feet and give you a heart attack.', where: 'mountain forests',
    build: () => bird({ len: 0.48, belly: 'F0.8', legs: 0.06, beak: '#2a2a2a', xhead: r => [-1, 1].map(s => [SPs, '#e8862a', s * r * 0.35, r * 0.65, -r * 0.4, r * 0.18, r * 0.08, r * 0.2]) }),
    cap: 4, ai: 'groundbird', flush: true, speed: [0.6, 9], size: [0.95, 1.05], spot: 20, flee: 4, col: () => '#4d4a48', call: 'hoot', hab: c => c.forest && c.h > 300, w: 0.3, n: [1, 1], max: 2, small: true },
  ptarmigan: { name: 'White-tailed ptarmigan', emoji: '🐦', group: BIRDS, rare: 1, fact: 'Canada\'s smallest grouse is pure white in winter and speckled like the rocks in summer. Feathered feet = built-in snowshoes.', where: 'above the treeline',
    build: () => bird({ len: 0.32, belly: '#f4f4f0', legs: 0.05, wingc: '#f4f4f0', beak: '#111' }),
    cap: 4, ai: 'groundbird', flush: true, speed: [0.5, 8], size: [0.95, 1.05], spot: 18, flee: 4, col: () => isSnowNow() ? '#f4f4f2' : '#8a7a62', hab: c => c.h > 1450 && !c.forest, w: 0.6, n: [1, 3], max: 3, small: true },
  raven: { name: 'Common raven', emoji: '🐦‍⬛', group: BIRDS, fact: 'Much bigger than a crow, with a wedge-shaped tail and a deep "gronk". In many Northwest Coast stories Raven is the trickster who released the sun.', where: 'mountains and forests (look up)',
    build: () => bird({ len: 0.62, belly: 'F', bl: 0.09, beak: '#111', span: 1.15 }), cap: 4, ai: 'soar', speed: [9, 12], size: [0.95, 1.05], spot: 60, col: () => '#0e0e10', call: 'raven', hab: c => (c.forest || c.wild) && c.h > 100, w: 0.2, n: [1, 2], max: 2 },
  owl: { name: 'Barred owl', emoji: '🦉', group: BIRDS, rare: 1, fact: 'Its call sounds like "Who cooks for you? Who cooks for you-all?" Barred owls arrived in BC only in the 1940s and now live right in Stanley Park.', where: 'big trees in forests and parks at night',
    build: () => bird({ len: 0.48, belly: '#d8cbb4', headc: 'F', beak: '#e0c040', bl: 0.035, legs: 0.04, xhead: r => [[SP, '#d9ccb5', 0, r * 0.3, -r * 0.62, r * 0.55, r * 0.55, r * 0.15], [SPs, '#1a1410', -r * 0.22, r * 0.38, -r * 0.75, r * 0.13, r * 0.13, r * 0.05], [SPs, '#1a1410', r * 0.22, r * 0.38, -r * 0.75, r * 0.13, r * 0.13, r * 0.05]] }),
    cap: 2, ai: 'perch', speed: [0, 8], size: [1, 1.1], spot: 30, col: () => '#8a7458', call: 'owl', hab: c => c.forest || c.wood, when: () => night() ? 1 : 0.05, w: 0.25, n: [1, 1], max: 1 },
  hummer: { name: "Anna's hummingbird", emoji: '🐦', group: BIRDS, fact: 'It stays in Vancouver all winter (it even goes into torpor on cold nights). The male\'s head flashes magenta. Its wings beat about 50 times a second.', where: 'gardens and parks with flowers',
    build: () => bird({ len: 0.1, belly: '#b8c2a8', headc: '#c0306a', bl: 0.022, beak: '#111', legs: 0.005, span: 0.13, wingc: '#55605a' }), cap: 4, ai: 'hummer', speed: [3, 9], size: [0.95, 1.05], spot: 12, col: () => '#3f8a52', hab: c => (c.park || c.town || c.garden) && c.h < 400, when: () => night() ? 0 : season() === 'winter' ? 0.3 : 1, w: 0.4, n: [1, 1], max: 2, small: true },
  mallard: { name: 'Mallard', emoji: '🦆', group: BIRDS, fact: 'The drakes have shiny green heads; the hens are speckled brown (and they do the quacking). Dabbling ducks: they tip bottom-up to feed.', where: 'ponds and lagoons',
    build: () => bird({ len: 0.55, headc: '#1c6b3a', belly: '#c9c4bc', tailc: '#2a2a2a', beak: '#e8c030', legs: 0, xhead: r => [[cylD(r * 0.42, r * 0.42, r * 0.08), '#f4f4f0', 0, -r * 0.18, -r * 0.1]] }), cap: 10, ai: 'duck', speed: [0.5, 3], size: [0.95, 1.05], spot: 30, flee: 6, col: () => '#8a8478', hab: c => c.water && c.fresh, w: 3, n: [2, 6], max: 10, small: true },
  woodduck: { name: 'Wood duck', emoji: '🦆', group: BIRDS, rare: 1, fact: 'Maybe the most beautiful duck in the world: rainbow-painted drakes nest in tree holes, and the ducklings jump out from up to 15 m on their first day.', where: 'quiet ponds like Lost Lagoon and Beaver Lake',
    build: () => bird({ len: 0.46, headc: '#1d4a3a', belly: '#c8a070', tailc: '#222', beak: '#d0342a', legs: 0, xhead: r => [[CN, '#1d4a3a', 0, r * 0.7, r * 0.45, r * 0.3, r * 0.7, r * 0.25, 1.4], [BX, '#f4f4f0', 0, r * 0.05, -r * 0.05, r * 1.4, r * 0.08, r * 0.6]] }), cap: 4, ai: 'duck', speed: [0.5, 3], size: [0.95, 1.05], spot: 25, flee: 6, col: () => '#5a3a46', hab: c => c.water && c.fresh && c.city, w: 0.5, n: [1, 2], max: 2, small: true },
  // ---- sea and shore ----
  seaotter: { name: 'Sea otter', emoji: '🦦', group: SEA, rare: 2, fact: 'Hunted to zero in BC by 1929; reintroduced in 1969 and now back on the west coast. They float on their backs, crack urchins on a rock on their chest, and hold paws while napping.', where: 'kelp beds on the outer coast (rare)',
    build: () => one([[SP, 'F', 0, 0, 0, 0.16, 0.12, 0.5], [SP, '#d9d2c4', 0, 0.06, -0.48, 0.14, 0.13, 0.13], [SPs, '#111', 0, 0.12, -0.6, 0.03, 0.03, 0.03], [SP, 'F', 0, 0.02, 0.55, 0.06, 0.04, 0.22], [SP, '#7a6a5a', 0, 0.13, -0.12, 0.06, 0.05, 0.06]]),
    cap: 6, ai: 'float', speed: [0.4, 2], size: [0.95, 1.1], spot: 40, flee: 20, col: () => '#4a3626', hab: c => c.water && c.sea && (c.x < -60000 || c.island), w: 0.3, n: [2, 5], max: 5 },
  salmon: { name: 'Salmon run', emoji: '🐟', group: SEA, rare: 1, fact: 'Salmon swim back to the very creek they hatched in, turn red, spawn and die. Their bodies feed bears, eagles and even the trees: up to 70% of the nitrogen in some streamside trees comes from salmon.', where: 'North Shore and Squamish rivers in the fall',
    build: () => one([[SP, 'F', 0, 0, 0, 0.1, 0.13, 0.38], [SP, '#5a6a4a', 0, 0.06, -0.33, 0.08, 0.08, 0.1], [BX, 'F0.8', 0, 0, 0.42, 0.02, 0.18, 0.14], [BX, 'F0.8', 0, 0.12, 0.05, 0.02, 0.08, 0.1]]),
    cap: 24, ai: 'fish', speed: [0.6, 2], size: [0.85, 1.15], spot: 30, col: () => pick(['#b8342a', '#9c2a22', '#c84a30']), hab: () => false, w: 0 },
  crab: { name: 'Red rock crab', emoji: '🦀', group: SEA, fact: 'Brick-red with black-tipped claws strong enough to crack snail shells. It scuttles sideways into the seaweed if you get close.', where: 'tide pools and rocky beaches',
    build: () => one([[SP, 'F', 0, 0.05, 0, 0.12, 0.05, 0.09], ...[-1, 1].flatMap(s => [[SP, 'F', s * 0.15, 0.06, -0.08, 0.06, 0.035, 0.035], [SPs, '#111', s * 0.2, 0.06, -0.1, 0.025, 0.02, 0.02], ...[0, 1, 2].map(k => [cylD(0.01, 0.008, 0.12, 4), 'F0.8', s * 0.11, 0.05, -0.02 + k * 0.05, 1, 1, 1, 0, 0, s * 2.2])])]),
    cap: 12, ai: 'crab', speed: [0.4, 2.5], size: [0.8, 1.3], spot: 8, col: () => pick(['#a8321e', '#8a2a1a']), hab: () => false, w: 0 },
  star: { name: 'Ochre sea star', emoji: '⭐', group: SEA, fact: 'Purple or orange, it pries mussels open with its tube feet and pushes its stomach inside the shell to eat. A "keystone species": without it, mussels take over the whole shore.', where: 'tide pools and rocky beaches',
    build: () => one([[SP, 'F', 0, 0.03, 0, 0.05, 0.03, 0.05], ...[0, 1, 2, 3, 4].map(k => [SP, 'F', Math.sin(k * 1.2566) * 0.09, 0.025, Math.cos(k * 1.2566) * 0.09, 0.035, 0.022, 0.1, 0, k * 1.2566, 0])]),
    cap: 16, ai: 'still', speed: [0, 0], size: [0.8, 1.4], spot: 6, col: () => pick(['#6a2a7a', '#7a3088', '#d8682a', '#c45a24']), hab: () => false, w: 0 },
  anemone: { name: 'Giant green anemone', emoji: '🌺', group: SEA, fact: 'It glows green because of algae living inside it. Touch the tentacles and they feel sticky: tiny stingers that are harmless to people.', where: 'tide pools',
    build: () => one([[cylD(0.07, 0.08, 0.06), 'F0.7', 0, 0.06, 0], ...Array.from({ length: 12 }, (_, k) => [CN, 'F', Math.sin(k * 0.52) * 0.05, 0.08, Math.cos(k * 0.52) * 0.05, 0.015, 0.06, 0.015, Math.cos(k * 0.52) * 0.6, 0, -Math.sin(k * 0.52) * 0.6])]),
    cap: 12, ai: 'still', speed: [0, 0], size: [0.8, 1.4], spot: 6, col: () => '#4ac07a', hab: () => false, w: 0 },
  gull: { name: 'Glaucous-winged gull', jid: 'gull', emoji: '🕊️', group: BIRDS, build: () => bird({ len: 0.6, belly: 'F', wingc: '#b8c0c8', tipc: '#9aa4ae', beak: '#e8c030', legc: '#d89a9a' }), cap: 3, ai: 'thief', speed: [9, 13], size: [1, 1], spot: 30, col: () => '#f2f3f5', hab: () => false, w: 0 },
  crow: { name: 'Northwestern crow', jid: 'crow', emoji: '🐦‍⬛', group: BIRDS, build: () => bird({ len: 0.42, belly: 'F', beak: '#111', span: 0.9 }), cap: 110, ai: 'commute', speed: [11, 13], size: [0.9, 1.1], spot: 80, col: () => '#121214', hab: () => false, w: 0 },
};
// rare colour variant: the white Kermode "spirit bear"
register('spiritbear', { name: 'Kermode "spirit bear"', emoji: '🐻‍❄️', group: MT, rare: 3, fact: 'A black bear with white fur, from a rare recessive gene. They live mostly on the Great Bear Rainforest islands (Gitga\'at and Kitasoo/Xai\'xais territory). BC\'s official mammal.', where: 'very, very rarely in any bear country' });
register('bearcubs', { name: 'Black bear cubs', emoji: '🧸', group: MT, rare: 2, fact: 'Born in the winter den, the size of a squirrel. They stay with mom for 17 months, and climb trees like little firefighters when she warns them.', where: 'with their mother in spring and summer' });
for (const [id, s] of Object.entries(S)) if (!s.jid) register(id, { name: s.name, emoji: s.emoji, group: s.group, rare: s.rare || 0, fact: s.fact, where: s.where });
let snowNowCache = 0, snowNowT = -1;
function isSnowNow() { if (G.t - snowNowT > 2) { snowNowT = G.t; const P = window.__game?.player; snowNowCache = G.season === 'winter' || (P && isSnow(P.x, P.z)) ? 1 : 0; } return !!snowNowCache; }
const rigs = {};
const rigOf = id => rigs[id] || (rigs[id] = (() => { const b = S[id].build(); const r = new Rig(b.geos, b.slots, S[id].cap); r.type = b.type; return r; })());

// ---------- props: logs bears flip, tipped green bins, a wildlife tree for cubs, the Lost Lagoon beaver lodge ----------
const propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }); propMat.onBeforeCompile = tintShader; propMat.customProgramCacheKey = () => 'faunaProp';
const PROPS = {
  log: bake([[new THREE.CylinderGeometry(0.22, 0.25, 1.8, 9).rotateZ(Math.PI / 2), '#5a4a32'], [new THREE.CylinderGeometry(0.2, 0.2, 0.02, 9).rotateZ(Math.PI / 2), '#b89a6a', 0.91], [SPs, '#3f6a2a', 0, 0.18, 0, 0.6, 0.08, 0.18]]),
  bin: bake([[BX, '#2f855a', 0, 0.3, 0, 0.6, 0.92, 0.68, 0, 0, Math.PI / 2], [BX, '#f4f4f4', 0.7, 0.02, 0.3, 0.25, 0.04, 0.2], [BX, '#c62828', 0.85, 0.02, -0.2, 0.2, 0.04, 0.25], [BX, '#ffcc80', 0.45, 0.02, -0.5, 0.3, 0.04, 0.15], [SPs, '#7a5a3a', 1.0, 0.04, 0.1, 0.1, 0.05, 0.08]]),
  snag: bake([[new THREE.CylinderGeometry(0.28, 0.42, 11, 8).translate(0, 5.5, 0), '#4e4338'], [new THREE.CylinderGeometry(0.03, 0.06, 1.6, 4).rotateZ(1.2).translate(0.7, 7, 0), '#4e4338'], [new THREE.CylinderGeometry(0.03, 0.06, 1.3, 4).rotateZ(-1.3).translate(-0.6, 8.5, 0.1), '#4e4338'], [SPs, '#5a7a3a', 0, 2, 0.3, 0.35, 1.4, 0.2]]),
  lodge: bake([[SP, '#5a4a36', 0, 0, 0, 2.6, 1.3, 2.2], ...Array.from({ length: 18 }, (_, k) => [new THREE.CylinderGeometry(0.05, 0.05, 2.8, 4), '#7a6448', Math.cos(k) * 1.6, 0.6 + (k % 3) * 0.2, Math.sin(k * 1.7) * 1.3, 1, 1, 1, 1.2 + (k % 4) * 0.2, k, 0.3])]),
};
function addProp(kind, x, y, z, yaw = 0) { const m = new THREE.Mesh(PROPS[kind], propMat); m.position.set(x, y, z); m.rotation.y = yaw; m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; }

// ---------- live animals ----------
const live = [];
const GAITS = { walk: { huL: 0, fuL: 0.25, huR: 0.5, fuR: 0.75 }, trot: { fuL: 0, huR: 0, fuR: 0.5, huL: 0.5 }, gallop: { fuL: 0, fuR: 0.1, huL: 0.55, huR: 0.65 }, bound: { fuL: 0, fuR: 0.06, huL: 0.5, huR: 0.53 } };
const _c = new THREE.Color();
function make(id, x, z, extra = {}) {
  const s = S[id], sc = R(s.size[0], s.size[1]);
  const a = { S: s, id, kind: s.kind || s.jid || id, jid: s.jid || id, x, z, y: walkY(x, z), yaw: R(0, 6.28), ph: Math.random(), amp: 0, spd: 0, st: 'idle', t: 0, dur: R(2, 6), sc, col: new THREE.Color(s.col()), hd: 0, stand: 0, lie: 0, look: 0, pitch: 0, roll: 0, fly: 0, flap: 0, alt: 0, pose: {}, tx: null, tz: null, ext: true, ...extra };
  if (s.ai === 'duck' || s.ai === 'swim' || s.ai === 'float') a.y = waterLevel(x, z);
  live.push(a); animals.push(a); return a;
}
function kill(a) { const i = live.indexOf(a); if (i >= 0) live.splice(i, 1); const j = animals.indexOf(a); if (j >= 0) animals.splice(j, 1); if (a.prop) { scene.remove(a.prop); a.prop = null; } if (a.bin) { scene.remove(a.bin); a.bin = null; } if (a.snag) scene.remove(a.snag); }
const setSt = (a, st, dur = R(2, 6)) => { a.st = st; a.t = 0; a.dur = dur; };
function landOk(x, z) { return !isWater(x, z) && !buildingAt(x, z); }
function go(a, tx, tz, spd, dt, okFn = landOk) {
  const dx = tx - a.x, dz = tz - a.z, L = Math.hypot(dx, dz);
  const want = L < 0.3 ? 0 : spd; a.spd += (want - a.spd) * Math.min(1, dt * (want > a.spd ? 2.5 : 4));
  if (L > 0.3) { const w = Math.atan2(-dx, -dz); a.yaw += clamp(wrapAngle(w - a.yaw), -2.6 * dt, 2.6 * dt); }
  const nx = a.x - Math.sin(a.yaw) * a.spd * dt, nz = a.z - Math.cos(a.yaw) * a.spd * dt;
  if (okFn(nx, nz)) { a.x = nx; a.z = nz; } else { a.yaw += 2 * dt; a.tx = null; }
  return L;
}
function wander(a, r) { a.tx = a.x + R(-r, r); a.tz = a.z + R(-r, r); }
const away = (a, pl, r = 40) => { const dx = a.x - pl.x, dz = a.z - pl.z, L = Math.hypot(dx, dz) || 1; a.tx = a.x + dx / L * r + R(-6, 6); a.tz = a.z + dz / L * r + R(-6, 6); };
let warned = {}, noiseT = -99;
function toastOnce(key, title, text, ms = 6000, gap = 60) { if (G.t - (warned[key] || -1e9) < gap) return; warned[key] = G.t; ui.toast(title, text, ms); }
const SND = {
  whistle: () => beep([2900, 2750], 0.35, 'sine', 0.05, 0.05), eep: () => beep([3300], 0.08, 'sine', 0.04), hoot: () => beep([110, 105, 100], 0.3, 'sine', 0.08, 0.35), jay: () => beep([1400, 1250, 1400], 0.09, 'sawtooth', 0.025, 0.05),
  owl: () => beep([380, 420, 380, 340, 400, 420, 320], 0.18, 'sine', 0.05, 0.12), raven: () => beep([260, 230], 0.2, 'sawtooth', 0.035, 0.1), huff: () => { noise(0.25, 0.14, 280); }, pop: () => beep([95, 80], 0.05, 'square', 0.08, 0.06),
  bugle: () => beep([600, 900, 1500, 2200, 2400, 1800], 0.35, 'sine', 0.05, 0.02), howl: () => beep([420, 520, 620, 600, 560, 460], 0.6, 'sine', 0.05, 0.05), bark: () => { beep([180, 150], 0.12, 'sawtooth', 0.06, 0.1); }, slap: () => noise(0.3, 0.2, 900), chatter: () => beep([2400, 2600, 2400, 2600, 2400], 0.04, 'square', 0.02, 0.02), clash: () => { noise(0.12, 0.25, 700); beep([140], 0.1, 'sine', 0.12); },
};
const sound = (k, a, pl, r = 120) => { if (!a || Math.hypot(a.x - pl.x, a.z - pl.z) < r) SND[k]?.(); };

// ---------- behaviour ----------
function threat(a, pl, d, base) {
  if (!base) return false;
  if (pl.vehicle) { const v = pl.vehicle.speedAbs || 0; return d < base * 1.2 + (v > 8 ? 25 : 0) && !pl.flying; }
  return d < (pl.running ? base * 1.4 : base);
}
function aiGrazer(a, dt, pl, d) {
  const S = a.S;
  if (a.st !== 'flee' && threat(a, pl, d, S.flee)) { setSt(a, 'flee', R(6, 10)); away(a, pl, 60); if (S.id === 'deer' || S.id === 'buck') say(a, '*stomp* *snort*', 1400); }
  if (S.charge && a.st !== 'charge' && a.st !== 'flee' && d < S.charge && !pl.vehicle) { setSt(a, 'charge', 5); toastOnce('moose', '🫎 The moose is charging!', 'Ears back, hackles up: RUN and get something big (a tree, a car) between you. Unlike with bears, running from a moose is right: they rarely chase far.', 6000); }
  if (S.bull && season() === 'fall' && a.st !== 'flee' && Math.random() < dt / 25) { a.hd = -0.6; say(a, '🎺 *BUGLE*', 2500); sound('bugle', a, pl, 400); if (d < 250) { toastOnce('bugle', '🦌 An elk is bugling!', 'Every September and October, bull elk squeal-whistle to challenge rivals and gather their herd. The sound carries for kilometres.', 6000, 300); discover('elkbugle'); } }
  switch (a.st) {
    case 'flee': { if (!a.tx || (S.zig && Math.random() < dt * 1.5)) away(a, pl, 40); go(a, a.tx, a.tz, S.speed[1] * a.sc, dt); a.hd = -0.2; if (a.t > a.dur && d > S.flee * 1.3) setSt(a, 'idle', R(2, 5)); break; }
    case 'charge': { go(a, pl.x, pl.z, S.speed[1] * 0.75, dt); a.hd = 0.3; if (d < 2.5) { pl.hurt?.(18, 'moose'); setSt(a, 'leave', 8); away(a, pl, 40); say(a, '*SNORT*', 1500); } if (a.t > a.dur) { setSt(a, 'leave', 8); away(a, pl, 40); } break; }
    case 'leave': go(a, a.tx ?? a.x, a.tz ?? a.z, S.speed[0] * 1.6, dt); a.hd = 0; if (a.t > a.dur) setSt(a, 'idle'); break;
    case 'graze': a.spd *= 0.9; a.hd = Math.min(1, a.hd + dt * 2); if (d < (S.flee || 20) * 2 && Math.random() < dt) a.hd = 0; if (a.t > a.dur) setSt(a, Math.random() < 0.5 ? 'walk' : 'idle'); break;
    case 'walk': { if (a.tx === null) wander(a, 18); const L = go(a, a.tx, a.tz, S.speed[0] * a.sc, dt); a.hd = Math.max(0, a.hd - dt * 2); if (L < 0.6 || a.t > 12) setSt(a, Math.random() < 0.6 ? 'graze' : 'idle'); break; }
    case 'rush': { if (a.tx === null) wander(a, 30); const L = go(a, a.tx, a.tz, S.speed[1] * 0.6 * a.sc, dt); if (L < 0.6 || a.t > 4) setSt(a, 'idle', R(1, 3)); break; }
    case 'clash': { const o = a.rival; if (!o || o.st !== 'clash') { setSt(a, 'idle'); break; } const back = a.t < 2; const tx = back ? a.x + (a.x - o.x) : o.x, tz = back ? a.z + (a.z - o.z) : o.z; go(a, tx, tz, back ? 1.2 : 6, dt); a.yaw = Math.atan2(-(o.x - a.x), -(o.z - a.z)); if (!back && Math.hypot(o.x - a.x, o.z - a.z) < 1.2) { if (a.id < o.id || a === o) {} a.t = 0; sound('clash', a, pl, 200); if (d < 120) { toastOnce('rams', '🐏 CRACK! Two bighorn rams just butted heads!', 'Rams run at each other at 30 km/h. Their double-layered skulls act like crash helmets.', 5000, 120); discover('rams'); } a.clashes = (a.clashes || 0) + 1; if (a.clashes > 3) { setSt(a, 'idle'); a.rival = null; } } break; }
    default: { a.spd *= 0.9; a.hd = Math.max(0, a.hd - dt); a.look = Math.sin(a.t * 0.7) * 0.6; if (d < (S.flee || 20) * 2.2) a.look = clamp(wrapAngle(Math.atan2(-(pl.x - a.x), -(pl.z - a.z)) - a.yaw), -1, 1); if (a.t > a.dur) { setSt(a, Math.random() < 0.5 ? 'graze' : S.small && Math.random() < 0.3 ? 'rush' : 'walk'); a.tx = null; } }
  }
  if (S.id === 'bighorn' && season() === 'fall' && a.st === 'idle' && !a.rival) { const o = live.find(b => b !== a && b.id === 'bighorn' && b.st === 'idle' && Math.hypot(b.x - a.x, b.z - a.z) < 15); if (o && Math.random() < dt * 0.2) { a.rival = o; o.rival = a; setSt(a, 'clash', 20); setSt(o, 'clash', 20); } }
  if (S.chatter && d < 25 && Math.random() < dt * 0.15) { say(a, '*chrrrr!* (get out of my forest)', 1600); sound('chatter', a, pl, 30); }
}
function aiSentinel(a, dt, pl, d) {   // marmots & pikas: sit up, whistle, then dive into their burrow (vanish), pop back out later
  const S = a.S;
  if (a.st === 'hidden') { a.vis = false; if (a.t > a.dur && d > S.flee * 1.6) { a.vis = true; setSt(a, 'idle'); } return; }
  if (a.st !== 'alarm' && threat(a, pl, d, S.flee * 1.8)) { setSt(a, 'alarm', R(1.2, 2.2)); say(a, S.call === 'whistle' ? '📯 WHEEEEEET!' : 'EEP!', 1500); sound(S.call, a, pl); if (S.call === 'whistle' && d < 60) { toastOnce('marmot', '🦫 A marmot whistled at you!', 'That ear-splitting whistle is an alarm call. Whistler Mountain was named after these guys!', 5000, 300); discover('whistler'); } }
  if (a.st === 'alarm') { a.stand = Math.min(1, a.stand + dt * 4); a.look = clamp(wrapAngle(Math.atan2(-(pl.x - a.x), -(pl.z - a.z)) - a.yaw), -1.2, 1.2); if (a.t > a.dur) { if (d < S.flee * 1.5) { setSt(a, 'hidden', R(12, 25)); a.stand = 0; } else setSt(a, 'idle'); } return; }
  a.stand = Math.max(0, a.stand - dt * 3);
  aiGrazer(a, dt, pl, d);
  if (a.st === 'idle' && Math.random() < dt * 0.15) a.stand = 1;
}
function aiCougar(a, dt, pl, d) {   // a cougar may quietly follow a lone walker; look at it (and E = make yourself big) and it melts away
  const S = a.S, onFoot = !pl.vehicle;
  const ang = Math.atan2(a.x - camera.position.x, a.z - camera.position.z), cy = Math.atan2(-camera.getWorldDirection(_v1).x, -camera.getWorldDirection(_v1).z);
  const watched = Math.abs(wrapAngle(Math.atan2(a.x - pl.x, a.z - pl.z) - Math.atan2(camera.getWorldDirection(_v1).x, camera.getWorldDirection(_v1).z))) < 0.5;
  if (a.noise > 0 || (watched && d < 45 && a.st === 'stalk' && a.t > 3)) { a.noise = 0; setSt(a, 'flee', 10); away(a, pl, 80); }
  if (a.st === 'flee') { go(a, a.tx, a.tz, S.speed[1], dt); if (a.t > a.dur) a.gone = true; return; }
  if (onFoot && d < 70 && (night() || dusk()) && a.st !== 'stalk') setSt(a, 'stalk', 40);
  if (a.st === 'stalk') { const want = 32; const L = d - want; if (L > 2) go(a, pl.x, pl.z, Math.min(S.speed[0] * 2.5, L), dt); else { a.spd *= 0.85; a.yaw += clamp(wrapAngle(Math.atan2(-(pl.x - a.x), -(pl.z - a.z)) - a.yaw), -dt, dt); } a.crouch = 1; a.hd = 0.25; if (!onFoot || a.t > a.dur) setSt(a, 'flee', 10); return; }
  a.crouch = 0; aiGrazer(a, dt, pl, d);
}
const _v1 = new THREE.Vector3();
function aiWolf(a, dt, pl, d) {
  if (night() && a.lead && Math.random() < dt / 30) { say(a, '🐺 AWOOOOOOO', 3000); sound('howl', a, pl, 600); if (d < 300) { toastOnce('wolves', '🐺 Wolves are howling!', 'A pack calls to each other across the valley. Wolves almost never bother people: enjoy it from a distance.', 6000, 300); } }
  if (d < 120) discover('wolfpack');
  if (!a.lead && a.leader && live.includes(a.leader) && a.leader.st !== 'flee' && a.st !== 'flee') { const L = a.leader; const tx = L.x + Math.sin(L.yaw) * (3 + a.slot * 2.5) + Math.cos(L.yaw) * (a.slot % 2 ? 2 : -2), tz = L.z + Math.cos(L.yaw) * (3 + a.slot * 2.5); const dd = Math.hypot(tx - a.x, tz - a.z); if (dd > 1) go(a, tx, tz, Math.min(a.S.speed[1], dd * 1.3), dt); else a.spd *= 0.8; if (threat(a, pl, d, a.S.flee)) { setSt(a, 'flee', 8); away(a, pl, 60); } return; }
  aiGrazer(a, dt, pl, d);
}
function aiPorcupine(a, dt, pl, d) {
  if (d < 4 && !pl.vehicle) { a.spd *= 0.8; a.yaw += clamp(wrapAngle(Math.atan2(pl.x - a.x, pl.z - a.z) - a.yaw), -2 * dt, 2 * dt); a.puff = 1; if (a.t > 1 && Math.random() < dt) say(a, '*rattles quills*', 1200); if (d < 1.2 && G.t - (a.ouch || 0) > 3) { a.ouch = G.t; pl.hurt?.(6, 'porcupine'); ui.toast('🦔 OUCH! Quills!', 'You touched a porcupine. A few barbed quills are now stuck in you. (Next time, just admire it.)', 3500); } return; }
  a.puff = Math.max(0, (a.puff || 0) - dt); aiGrazer(a, dt, pl, d);
}
let stinkT = 0;
function aiSkunk(a, dt, pl, d) {
  if (d < 6 && !pl.vehicle && a.st !== 'flee') { if (a.st !== 'warn') { setSt(a, 'warn', 2.5); say(a, '*stamp stamp*', 1500); } a.spd *= 0.8; a.yaw += clamp(wrapAngle(Math.atan2(pl.x - a.x, pl.z - a.z) - a.yaw), -3 * dt, 3 * dt); a.tailUp = 1;
    if (a.t > a.dur && d < 3.5) { setSt(a, 'flee', 8); away(a, pl); stinkT = 60; ui.toast('🦨 You got SKUNKED!', 'It warned you (foot stamps, tail up). Now you smell like burnt rubber and garlic. People will notice. Real tip: tomato juice doesn\'t work; baking soda + peroxide does.', 6000); discover('skunked'); } return; }
  if (a.st === 'warn' && d >= 6) setSt(a, 'idle');
  a.tailUp = Math.max(0, (a.tailUp || 0) - dt); aiGrazer(a, dt, pl, d);
}
function aiSwim(a, dt, pl, d, otter = false) {   // beavers (and otters in the water)
  const S = a.S, ok = (x, z) => isWater(x, z);
  if (a.st === 'dive') { a.vis = a.t > a.dur; if (a.vis) setSt(a, 'idle'); return; }
  if (threat(a, pl, d, S.flee) && a.st !== 'dive') { if (S.id === 'beaver') { say(a, '💦 *SLAP!*', 1500); sound('slap', a, pl, 80); toastOnce('beaver', '🦫 SLAP! A beaver!', 'That loud tail slap on the water is a warning to every beaver nearby. Then it dives (it can hold its breath for 15 minutes).', 5000, 180); discover('beaverslap'); } setSt(a, 'dive', R(8, 16)); a.vis = false; const dx = a.x - pl.x, dz = a.z - pl.z, L = Math.hypot(dx, dz) || 1; for (let k = 0; k < 10; k++) { const nx = a.x + dx / L * 20, nz = a.z + dz / L * 20; if (ok(nx, nz)) { a.x = nx; a.z = nz; break; } } return; }
  if (a.tx === null || a.t > 15) { a.tx = a.x + R(-25, 25); a.tz = a.z + R(-25, 25); a.t = 0; if (!ok(a.tx, a.tz)) a.tx = null; }
  if (a.tx !== null) go(a, a.tx, a.tz, S.speed[0], dt, ok);
  a.y = waterLevel(a.x, a.z) - 0.12; a.swim = 1;
}
function aiOtter(a, dt, pl, d) {
  const inW = isWater(a.x, a.z);
  if (inW) { a.y = waterLevel(a.x, a.z) - 0.1; a.swim = 1; if (threat(a, pl, d, a.S.flee)) { a.vis = false; setSt(a, 'dive', 6); } if (a.st === 'dive') { a.vis = a.t > a.dur; if (a.vis) setSt(a, 'idle'); return; } if (a.tx === null || a.t > 8) { a.tx = a.x + R(-20, 20); a.tz = a.z + R(-20, 20); a.t = 0; } go(a, a.tx, a.tz, 1.5, dt, () => true); if (!isWater(a.x, a.z) && Math.random() < dt * 0.3) a.tx = null; return; }
  a.swim = 0;
  if (threat(a, pl, d, a.S.flee)) { // gallop to the water and slide in
    let best = null; for (let b = 0; b < 6.28; b += 0.4) { const x = a.x + Math.cos(b) * 15, z = a.z + Math.sin(b) * 15; if (isWater(x, z)) { best = [x, z]; break; } }
    if (best) { setSt(a, 'flee', 5); a.tx = best[0]; a.tz = best[1]; }
  }
  if (a.st === 'flee') { go(a, a.tx, a.tz, a.S.speed[1], dt, () => true); return; }
  if (a.tx === null || a.t > 10) { a.tx = a.x + R(-12, 12); a.tz = a.z + R(-12, 12); a.t = 0; }
  go(a, a.tx, a.tz, a.S.speed[0], dt, (x, z) => true);
}
function aiHaul(a, dt, pl, d) {   // sea lions hauled out on the rocks: lounge, bark, and flop into the sea if you come close
  if (isWater(a.x, a.z)) { a.swim = 1; a.lie = 0; a.y = waterLevel(a.x, a.z) - 0.25; if (a.tx === null || a.t > 12) { a.tx = a.x + R(-30, 30); a.tz = a.z + R(-30, 30); a.t = 0; } go(a, a.tx, a.tz, 1.5, dt, (x, z) => isWater(x, z)); return; }
  a.swim = 0;
  if (Math.random() < dt / 6 && d < 150) { say(a, pick(['ORRR! ORRR!', '*BARK*', 'OOOORP']), 1500); sound('bark', a, pl, 90); if (d < 80) discover('sealions'); }
  if (threat(a, pl, d, a.S.flee) || a.st === 'flee') { if (a.st !== 'flee') { setSt(a, 'flee', 10); let best = null; for (let b = 0; b < 6.28; b += 0.3) { const x = a.x + Math.cos(b) * 12, z = a.z + Math.sin(b) * 12; if (isWater(x, z)) { best = [x, z]; break; } } a.tx = best ? best[0] : a.x; a.tz = best ? best[1] : a.z; } a.lie = Math.max(0, a.lie - dt * 2); go(a, a.tx, a.tz, a.S.speed[1], dt, () => true); return; }
  a.lie = Math.min(1, a.lie + dt * 0.5); a.hd = -0.4 + Math.sin(a.t * 0.5 + a.ph * 6) * 0.25; a.look = Math.sin(a.t * 0.3) * 0.6;
}
function aiFloat(a, dt, pl, d) {   // sea otters floating on their backs
  a.y = waterLevel(a.x, a.z) - 0.02; a.back = 1;
  if (threat(a, pl, d, a.S.flee)) { a.vis = false; if (a.t > 3) { a.t = 0; a.x += R(-15, 15); a.z += R(-15, 15); } } else a.vis = true;
  a.x += Math.sin(G.t * 0.2 + a.ph * 6) * 0.08 * dt; a.roll = Math.sin(G.t * 1.2 + a.ph * 9) * 0.15;
  if (d < 80) discover('seaotter');
}
function aiGroundBird(a, dt, pl, d) {
  const S = a.S;
  if (a.fly) { a.alt += a.vy * dt; a.vy = Math.max(1, a.vy - dt * 2); a.x -= Math.sin(a.yaw) * 8 * dt; a.z -= Math.cos(a.yaw) * 8 * dt; a.flap = Math.sin(G.t * 28 + a.ph * 9) * 0.9; if (a.alt > 30) a.gone = true; return; }
  if (threat(a, pl, d, S.flee)) { a.fly = 1; a.vy = S.flush ? 7 : 4; a.yaw = Math.atan2(-(a.x - pl.x), -(a.z - pl.z)) + Math.PI; if (S.flush) { say(a, '💥 *WHIRRRR!*', 1200); noise(0.4, 0.12, 2500); if (d < 10) toastOnce('grouse', '🐦 WHOA!', 'A grouse exploded into the air right at your feet. They freeze until the last second. Classic.', 3500, 120); } return; }
  a.flap = -1; a.pk = Math.max(0, Math.sin(a.t * 5 + a.ph * 7)) * 0.9;
  if (Math.random() < dt * 0.8) { a.yaw += R(-1.2, 1.2); a.hop = 0.25; }
  if (a.hop > 0) { a.hop -= dt; a.x -= Math.sin(a.yaw) * dt * 1.2; a.z -= Math.cos(a.yaw) * dt * 1.2; }
  if (S.call && Math.random() < dt / 9 && d < 60) { sound(S.call, a, pl, 60); if (S.call === 'jay') say(a, 'SHACK-SHACK-SHACK!', 1400); if (S.call === 'hoot') say(a, 'hoo… hoo… hoo…', 1600); }
}
function aiSoar(a, dt, pl) { a.fly = 1; a.ang = (a.ang ?? R(0, 6.28)) + dt * 0.12; a.cx = a.cx ?? a.x; a.cz = a.cz ?? a.z; a.x = a.cx + Math.cos(a.ang) * 60; a.z = a.cz + Math.sin(a.ang) * 60; a.yaw = -a.ang; a.alt = 45 + Math.sin(a.ang * 2) * 8; a.roll = 0.35; a.flap = Math.sin(G.t * 5 + a.ph) * 0.3; if (Math.random() < dt / 14) { sound('raven', a, pl, 150); say(a, 'GRONK.', 1300); } }
function aiPerch(a, dt, pl, d) {   // an owl on a branch: swivels its head, hoots, and glides away if you get close
  if (!a.perch) { const t = treesNear(a.x, a.z, 25).filter(t => t.h > 8)[0]; if (!t) { a.gone = true; return; } a.perch = t; a.x = t.x + 0.6; a.z = t.z; a.alt = t.h * R(0.35, 0.5); a.y = t.y; a.yaw = R(0, 6.28); }
  if (a.fly) { a.alt += dt * 1.5; a.x -= Math.sin(a.yaw) * 7 * dt; a.z -= Math.cos(a.yaw) * 7 * dt; a.flap = Math.sin(G.t * 9) * 0.8; if (a.t > 8) a.gone = true; return; }
  a.flap = -1; a.look = Math.sin(a.t * 0.4) * 1.6; if (d < 30) a.look = clamp(wrapAngle(Math.atan2(-(pl.x - a.x), -(pl.z - a.z)) - a.yaw), -2.4, 2.4);
  if (Math.random() < dt / 12) { sound('owl', a, pl, 90); say(a, 'Who cooks for you? Who cooks for you-all?', 2500); }
  if (d < 6) { a.fly = 1; a.t = 0; a.yaw += Math.PI; }
}
function aiHummer(a, dt, pl, d) {
  a.fly = 1; a.flap = Math.sin(G.t * 90) * 1.0;
  if (a.tx === null || a.t > a.dur) { setSt(a, 'hover', R(1.5, 4)); a.st = 'hover'; const toMe = d < 15 && Math.random() < 0.35; a.tx = toMe ? pl.x + R(-1.5, 1.5) : a.x + R(-8, 8); a.tz = toMe ? pl.z + R(-1.5, 1.5) : a.z + R(-8, 8); a.ta = toMe ? 1.7 : R(0.6, 2.2); if (toMe && d < 6) say(a, '*bzzzzzt*', 1000); }
  const dx = a.tx - a.x, dz = a.tz - a.z, L = Math.hypot(dx, dz); if (L > 0.2) { a.x += dx * Math.min(1, dt * 4); a.z += dz * Math.min(1, dt * 4); a.yaw = Math.atan2(-dx, -dz); }
  a.alt += (a.ta - a.alt) * Math.min(1, dt * 4); a.pitch = -0.6;
}
function aiDuck(a, dt, pl, d) {
  a.y = waterLevel(a.x, a.z) - 0.05; const ok = (x, z) => isWater(x, z);
  if (threat(a, pl, d, a.S.flee) && !pl.vehicle) { away(a, pl, 15); a.dab = 0; }
  if (a.tx === null || a.t > a.dur) { a.t = 0; a.dur = R(4, 10); if (Math.random() < 0.4) { a.dab = R(2, 4); a.tx = a.x; a.tz = a.z; } else { a.tx = a.x + R(-10, 10); a.tz = a.z + R(-10, 10); if (!ok(a.tx, a.tz)) a.tx = null; } }
  if (a.tx !== null) go(a, a.tx, a.tz, a.S.speed[0] + (d < a.S.flee ? 1.5 : 0), dt, ok);
  a.dab = Math.max(0, (a.dab || 0) - dt); a.pitch = a.dab > 0 ? 1.4 : 0; a.flap = -1;
  if (a.dab > 0 && d < 30 && Math.random() < dt * 0.1) say(a, a.S.id === 'mallard' ? 'quack.' : '*squeak*', 900);
}
function aiCrab(a, dt, pl, d) { if (d < 3 && !pl.vehicle) { if (a.st !== 'scuttle') { setSt(a, 'scuttle', 1.5); a.side = Math.random() < 0.5 ? 1 : -1; } } if (a.st === 'scuttle') { a.x += Math.cos(a.yaw) * a.side * 1.6 * dt; a.z -= Math.sin(a.yaw) * a.side * 1.6 * dt; a.y -= dt * 0.04; if (a.t > a.dur) setSt(a, 'idle', 30); } }
function aiFish(a, dt, pl, d) {   // salmon fighting upstream; now and then one leaps
  a.y = waterLevel(a.x, a.z) - 0.35; a.yaw = a.up + Math.sin(G.t * 3 + a.ph * 9) * 0.25;
  a.x -= Math.sin(a.up) * 0.25 * dt; a.z -= Math.cos(a.up) * 0.25 * dt;
  if (Math.hypot(a.x - a.hx, a.z - a.hz) > 12 || !isWater(a.x, a.z)) { a.x = a.hx + R(-3, 3); a.z = a.hz + R(-3, 3); }
  if (a.jump > 0) { a.jump -= dt; const u = 1 - a.jump / 0.9; a.y += Math.sin(u * Math.PI) * 1.3; a.pitch = (0.5 - u) * 1.8; } else { a.pitch = 0; if (Math.random() < dt / 7) a.jump = 0.9; }
}

// ---------- bears ----------
function bearWarn(a, pl) {
  if (a.S.id === 'grizzly') toastOnce('grizzly', '🐻 GRIZZLY BEAR!', 'Shoulder hump, dish face, long claws. Talk calmly, back away slowly, never run, don\'t climb a tree. If a grizzly attacks: play dead, face down, hands behind your neck. Press E to let it know you\'re there.', 8000, 120);
  else if (a.cubs?.length) toastOnce('mombear', '🐻 A mother bear with cubs!', 'The most dangerous bear there is. Back away NOW and give her lots of room. Never get between a mother and her cubs. Press E to talk and let her know you\'re a person.', 8000, 120);
  else toastOnce('bear', a.white ? '🐻‍❄️ A WHITE bear?!' : '🐻 A black bear!', 'Stay calm. Talk in a low voice, back away slowly, never run. If it charges, stand your ground: it\'s almost always a bluff. Press E to make noise ("HEY BEAR!").', 8000, 120);
}
function aiBear(a, dt, pl, d) {
  const S = a.S, onFoot = !pl.vehicle && !pl.transit, grizz = S.id === 'grizzly', mom = !!a.cubs?.length, home = a.home;
  if (a.cub) return aiCub(a, dt, pl, d);
  if (d < 45 && onFoot && !a.fence) bearWarn(a, pl);
  if (a.noise > 0) { a.noise = 0; if (!a.fence && !['fish'].includes(a.st)) { setSt(a, 'flee', R(8, 12)); away(a, pl, 80); say(a, '*huff* (fine, I\'m leaving)', 1800); for (const c of a.cubs || []) { c.st = 'follow'; c.climbY = 0; } } }
  const calm = ['forage', 'sniff', 'flip', 'berries', 'dig', 'rest', 'bin', 'idle'].includes(a.st);
  const aware = (mom ? 50 : grizz ? 40 : 32);
  if (calm && onFoot && !a.fence && d < aware && a.st !== 'bin') { setSt(a, 'alert', R(3, 5)); say(a, '*sniff sniff*', 1500); }
  if (onFoot && pl.running && d < 26 && ['alert', 'bluff', 'leave', 'huff'].includes(a.st) && !a.fence) { setSt(a, 'chase', 6); toastOnce('run', '🐻 DON\'T RUN!', 'Running makes a bear chase you like prey (they run 50 km/h). Stop, face it, talk calmly and back away slowly.', 5000, 30); }
  const amble = S.speed[0] * a.sc;
  switch (a.st) {
    case 'idle': case 'forage': {
      a.stand = Math.max(0, a.stand - dt * 2); a.hd = 0.35 + Math.sin(a.t * 1.3) * 0.15; a.look = Math.sin(a.t * 0.6) * 0.3; a.lie = Math.max(0, a.lie - dt);
      if (a.tx === null || Math.hypot(a.tx - a.x, a.tz - a.z) < 1) { if (home) { a.tx = home.x + R(-home.r, home.r); a.tz = home.z + R(-home.r, home.r); } else wander(a, 22); }
      go(a, a.tx, a.tz, amble, dt);
      if (a.t > a.dur) { const r = Math.random(), fall = season() === 'fall' || season() === 'summer'; setSt(a, r < 0.3 ? 'sniff' : r < 0.45 && !a.fence ? 'flip' : r < (fall ? 0.75 : 0.55) ? 'berries' : r < 0.85 && grizz ? 'dig' : r < 0.93 ? 'forage' : 'rest', R(3, 8)); }
      break;
    }
    case 'sniff': a.spd *= 0.85; a.hd = 0.85 + Math.sin(a.t * 7) * 0.08; a.look = Math.sin(a.t * 1.7) * 0.4; if (a.t > a.dur) setSt(a, Math.random() < 0.3 ? 'standlook' : 'forage', R(3, 6)); break;
    case 'standlook': a.spd = 0; a.stand = Math.min(1, a.stand + dt * 1.6); a.hd = -0.3 + Math.sin(a.t * 5) * 0.06; if (a.t > a.dur) setSt(a, 'forage', R(4, 8)); break;
    case 'flip': {   // roll a log over to lick up the ants and grubs underneath
      a.spd *= 0.8;
      if (!a.prop) { const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw), lx = a.x + fx * 1.6 * a.sc, lz = a.z + fz * 1.6 * a.sc; a.prop = addProp('log', lx, walkY(lx, lz) + 0.22, lz, a.yaw + Math.PI / 2); a.prop.scale.setScalar(a.sc); a.prop.userData.rot = 0; }
      const u = a.t; a.hd = u < 1.2 ? 0.5 : 0.95 + Math.sin(a.t * 9) * 0.05;
      a.paw = u < 1.2 ? Math.sin(u / 1.2 * Math.PI) : 0;
      if (u > 0.6 && a.prop.userData.rot < Math.PI) { a.prop.userData.rot = Math.min(Math.PI, a.prop.userData.rot + dt * 3); a.prop.rotation.x = a.prop.userData.rot; }
      if (u > a.dur) { scene.remove(a.prop); a.prop = null; a.paw = 0; setSt(a, 'forage', R(4, 8)); if (d < 60) toastOnce('flip', '🐻 It flipped a log!', 'Bears roll over logs and rocks to lick up ants and beetle grubs. In the fall they eat up to 20,000 calories a day to fatten up for winter.', 5000, 300); }
      break;
    }
    case 'berries': a.spd *= 0.85; a.hd = 0.45 + Math.sin(a.t * 10) * 0.07; a.look = Math.sin(a.t * 0.9) * 0.5; if (a.t > a.dur) { setSt(a, 'forage', R(3, 6)); if (d < 60) toastOnce('berries', '🐻 Berry time', 'Huckleberries, salmonberries, salal berries: a bear can eat 200,000 berries a day in late summer. Its poop is basically jam.', 5000, 300); } break;
    case 'dig': a.spd = 0; a.hd = 0.8; a.paw = Math.abs(Math.sin(a.t * 8)); if (a.t > a.dur) { a.paw = 0; setSt(a, 'forage', R(3, 6)); if (d < 70) toastOnce('dig', '🐻 It\'s digging', 'That shoulder hump is solid muscle for digging up roots, bulbs and ground squirrels. Grizzlies can move a boulder that weighs as much as a car.', 5000, 300); } break;
    case 'rest': a.spd = 0; a.lie = Math.min(1, a.lie + dt); a.hd = -0.2; if (a.t > a.dur * 2) { setSt(a, 'forage'); } break;
    case 'alert': {
      a.spd *= 0.8; a.lie = 0; const want = Math.atan2(-(pl.x - a.x), -(pl.z - a.z)); a.yaw += clamp(wrapAngle(want - a.yaw), -1.5 * dt, 1.5 * dt);
      a.stand = a.t > 0.8 && a.t < 3 ? Math.min(1, a.stand + dt * 1.8) : Math.max(0, a.stand - dt * 1.8); a.hd = -0.25;
      if (a.t > a.dur) { if (onFoot && d < (mom ? 22 : 14) && Math.random() < 0.75) { setSt(a, 'bluff', 4); sound('huff', a, pl); } else if (d < aware) { setSt(a, 'leave', R(8, 12)); away(a, pl, 50); } else setSt(a, 'forage'); }
      break;
    }
    case 'bluff': {   // a bluff charge: thunders straight at you, stops short, huffs and pops its jaw
      a.stand = 0; go(a, pl.x, pl.z, 11 * a.sc, dt, () => true); a.hd = 0.1;
      if (d < 4.5 + a.sc || a.t > 3) { setSt(a, 'huff', 2.2); a.spd = 0; say(a, '*HUFF!* *jaw pop* *SLAP*', 2000); sound('huff', a, pl); sound('pop', a, pl); toastOnce('bluff', '🐻 BLUFF CHARGE!', 'It stopped short. That was a warning, not an attack: it wants space. Stay standing, talk calmly, back away slowly. (Most black bear charges are bluffs.)', 7000, 60); }
      break;
    }
    case 'huff': a.spd = 0; a.paw = Math.max(0, Math.sin(a.t * 6)); a.hd = 0.3; if (a.t > a.dur) { a.paw = 0; setSt(a, 'leave', R(8, 12)); away(a, pl, 50); } break;
    case 'chase': {
      a.stand = 0; go(a, pl.x, pl.z, 12.5 * a.sc, dt, () => true);
      if (d < 1.8 + a.sc * 0.5) { pl.hurt?.(grizz ? 30 : 18, 'bear'); pl.vx = (pl.x - a.x) * 4; pl.vz = (pl.z - a.z) * 4; say(a, '*ROAR*', 1500); ui.toast('🐻 SWAT!', 'You ran, so it chased you. Next time: stand still, talk, back away. It\'s leaving now (you\'re not worth the trouble).', 5000); setSt(a, 'leave', 10); away(a, pl, 60); }
      if (a.t > a.dur || !onFoot) { setSt(a, 'leave', 10); away(a, pl, 60); }
      break;
    }
    case 'leave': case 'flee': { a.stand = Math.max(0, a.stand - dt * 3); a.hd = 0.1; go(a, a.tx ?? a.x, a.tz ?? a.z, a.st === 'flee' ? S.speed[1] * 0.8 : amble * 2.2, dt); if (a.t > a.dur) { if (a.st === 'flee' && d > 120 && !a.resident) a.gone = true; setSt(a, 'forage', R(4, 8)); } break; }
    case 'bin': {   // raiding a green bin at night
      a.spd = 0; a.hd = 0.9 + Math.sin(a.t * 8) * 0.06; a.look = Math.sin(a.t * 0.5) * 0.3;
      if (d < 60) { toastOnce('binbear', '🐻 A bear in the garbage!', 'Garbage is the #1 reason bears get into trouble in BC: "a fed bear is a dead bear". Keep bins locked inside until pickup morning. Press E to scare it off.', 7000, 120); discover('backyardbear'); }
      if (d < 18 && onFoot) { setSt(a, 'binstand', 1.6); say(a, '*HUFF*', 1500); sound('huff', a, pl); }
      break;
    }
    case 'binstand': a.stand = Math.min(1, a.stand + dt * 2); if (a.t > a.dur) { setSt(a, 'flee', 10); away(a, pl, 80); } break;
    case 'fish': {   // standing in the river in the fall, pinning salmon
      a.spd = 0; a.lie = 0; a.hd = 0.7 + Math.sin(a.t * 2) * 0.1; a.y = waterLevel(a.x, a.z) - 0.35;
      if (a.t > a.dur) { a.lunge = 0.6; a.t = 0; a.dur = R(4, 8); if (Math.random() < 0.45) { a.fishT = 5; say(a, '🐟 *CHOMP*', 1800); if (d < 90) { toastOnce('fishbear', '🐻🐟 It caught a salmon!', 'Bears drag salmon into the forest and often eat just the brain and eggs. The leftovers feed eagles, ravens… and the trees themselves.', 6000, 200); discover('bearfishing'); } } }
      a.lunge = Math.max(0, (a.lunge || 0) - dt); a.paw = a.lunge > 0 ? 1 : 0; a.hd += a.lunge > 0 ? 0.3 : 0; a.fishT = Math.max(0, (a.fishT || 0) - dt);
      if (onFoot && d < 14 && !a.fence) { setSt(a, 'alert', 3); }
      break;
    }
  }
  if (a.fence && home && Math.hypot(a.x - home.x, a.z - home.z) > home.r + 3) { a.tx = home.x; a.tz = home.z; }
}
function aiCub(a, dt, pl, d) {
  const m = a.mom; if (!m || !live.includes(m)) { a.gone = true; return; }
  const danger = ['alert', 'bluff', 'huff', 'chase'].includes(m.st) && d < 60;
  if (danger && a.st !== 'climb' && a.st !== 'up') {   // mom huffed: up the nearest tree!
    let t = treesNear(a.x, a.z, 30).filter(t => t.h > 8).sort((p, q) => Math.hypot(p.x - a.x, p.z - a.z) - Math.hypot(q.x - a.x, q.z - a.z))[0];
    if (!t) { const sx = m.x + R(-6, 6), sz = m.z + R(-6, 6); const y = walkY(sx, sz); m.snag = m.snag || addProp('snag', sx, y - 0.3, sz); t = { x: m.snag.position.x, z: m.snag.position.z, y, h: 10 }; }
    a.tree = t; setSt(a, 'climb', 60); say(a, '*squeal!*', 1200);
  }
  if (a.st === 'climb' || a.st === 'up') {
    const t = a.tree, dx = a.x - t.x, dz = a.z - t.z, L = Math.hypot(dx, dz) || 1;
    if (a.st === 'climb' && L > 0.7) { go(a, t.x + dx / L * 0.5, t.z + dz / L * 0.5, 4.5, dt, () => true); a.climbY = 0; }
    else { a.st = 'up'; a.spd = 0; a.yaw = Math.atan2(dx, dz); a.climbY = Math.min(a.top || (a.top = R(3, 6)), (a.climbY || 0) + dt * 1.5); a.ph += dt * 1.2 * (a.climbY < a.top ? 1 : 0); a.amp = a.climbY < a.top ? 0.8 : 0.1; if (d < 70) { toastOnce('cubs', '🧸 The cubs climbed a tree!', 'When mom senses danger she sends the cubs up a tree with a "woof". They\'ll wait up there until she calls them down.', 6000, 120); discover('bearcubs'); spot('bearcubs'); } }
    if (a.t > 25 && !danger && d > 50) { a.st = 'down'; }
    return;
  }
  if (a.st === 'down') { a.climbY = Math.max(0, a.climbY - dt * 2); if (a.climbY <= 0) setSt(a, 'follow'); return; }
  // follow mom, tumble and play
  const tx = m.x + Math.sin(m.yaw) * (2 + a.slot * 1.2) + (a.slot ? 1 : -1), tz = m.z + Math.cos(m.yaw) * (2 + a.slot * 1.2);
  const dd = Math.hypot(tx - a.x, tz - a.z); if (dd > 0.8) go(a, tx, tz, Math.min(6, dd * 1.4), dt); else { a.spd *= 0.8; a.hd = 0.5; if (Math.random() < dt * 0.2) a.yaw += R(-2, 2); }
  if (Math.random() < dt / 12 && d < 40) say(a, pick(['*mew*', '*bawl*', '*tumbles over*']), 1200);
}

// ---------- spawning ----------
function habitat(x, z) {
  const h = heightAt(x, z), water = isWater(x, z), m = maskAt(x, z);
  const c = { x, z, h, water, city: m !== -1, island: onIsland(x, z) };
  if (water) { c.fresh = waterLevel(x, z) > 0 || !!areaAt(x, z, 'water'); c.sea = !c.fresh; return c; }
  c.snow = isSnow(x, z, h) || h > snowLine() - 220; c.town = isNorthShoreTown(x, z, h) || townDensity(x, z) > 0.01 || isRichmond(x, z);
  c.forest = wildForest(x, z, h); c.wild = m === -1 && !c.town && h > 3;
  c.park = c.city && !!(areaAt(x, z, 'park') || areaAt(x, z, 'wood')); c.grass = !!areaAt(x, z, 'grass') || c.park; c.wood = c.city && !!areaAt(x, z, 'wood');
  c.garden = c.city && !!areaAt(x, z, 'flower');
  c.slope = Math.abs(heightAt(x + 8, z) - heightAt(x - 8, z)) + Math.abs(heightAt(x, z + 8) - heightAt(x, z - 8));
  c.shore = nearWater(x, z, 12); c.seaNear = c.shore && waterLevel(x + 12, z) === 0 && waterLevel(x - 12, z) === 0;
  c.rocky = !!areaAt(x, z, 'rock') || (m === -1 && h < 8);
  c.jericho = x > -7300 && x < -4600 && z > 200 && z < 2400;
  if (buildingAt(x, z)) c.blocked = true;
  return c;
}
const count = id => { let n = 0; for (const a of live) if (a.id === id) n++; return n; };
function spawnGroup(id, x, z) {
  const s = S[id], n = Math.floor(R(s.n[0], s.n[1] + 1)), out = [];
  for (let i = 0; i < n && count(id) < s.max; i++) { const px = x + R(-5, 5) * (i ? 1 : 0), pz = z + R(-5, 5) * (i ? 1 : 0); if (s.ai !== 'duck' && s.ai !== 'swim' && s.ai !== 'float' && !landOk(px, pz) && s.ai !== 'haul') continue; out.push(make(id, px, pz)); }
  if (out.length && s.ai === 'wolf') out.forEach((a, i) => { a.lead = i === 0; a.leader = out[0]; a.slot = i; });
  if (id === 'bear' && out[0]) {
    const b = out[0];
    if (Math.random() < 1 / 90) { b.white = true; b.col.set('#efe9dc'); b.jid = 'spiritbear'; }
    if (['spring', 'summer'].includes(season()) && Math.random() < 0.35) { b.cubs = []; const nc = Math.random() < 0.6 ? 2 : Math.random() < 0.5 ? 1 : 3; for (let k = 0; k < nc; k++) { const cb = make('bear', b.x + R(-2, 2), b.z + R(-2, 2), { cub: true, mom: b, slot: k, jid: 'bearcubs' }); cb.sc = R(0.36, 0.44); cb.col.copy(b.col); if (Math.random() < 0.2) cb.col.set('#4a3020'); b.cubs.push(cb); } }
  }
  return out;
}
function trySpawn(pl) {
  const small = Math.random() < 0.45, a = Math.random() * 6.28, r = small ? R(18, 70) : R(70, 210), x = pl.x + Math.cos(a) * r, z = pl.z + Math.sin(a) * r;
  const c = habitat(x, z); if (c.blocked) return;
  let tot = 0; const cand = [];
  for (const [id, s] of Object.entries(S)) { if (!s.w || !!s.small !== small && !(s.ai === 'duck' || s.ai === 'swim')) continue; if (count(id) >= s.max) continue; let w = 0; try { w = s.hab(c) ? s.w * (s.when ? s.when(c) : 1) : 0; } catch (e) { w = 0; } if (w > 0) { cand.push([id, w]); tot += w; } }
  if (!cand.length) return;
  // most of the time nothing turns up at this spot: animals are a surprise, not a zoo
  if (Math.random() > Math.min(0.85, tot * (small ? 0.5 : 0.35))) return;
  let k = Math.random() * tot; for (const [id, w] of cand) { k -= w; if (k <= 0) { spawnGroup(id, x, z); return; } }
}
// tide pools on rocky/sandy sea shores: sea stars, anemones, crabs
function spawnTidePool(pl) {
  for (let k = 0; k < 8; k++) {
    const a = Math.random() * 6.28, r = R(15, 60), x = pl.x + Math.cos(a) * r, z = pl.z + Math.sin(a) * r, h = heightAt(x, z);
    if (isWater(x, z) || h > 2.2 || buildingAt(x, z)) continue;
    let wx = null; for (let b = 0; b < 6.28; b += 0.5) if (isWater(x + Math.cos(b) * 5, z + Math.sin(b) * 5) && waterLevel(x + Math.cos(b) * 5, z + Math.sin(b) * 5) === 0) { wx = b; break; }
    if (wx === null || nearestRoad(x, z, 6)) continue;
    for (let i = 0; i < 9; i++) { const px = x + R(-3, 3), pz = z + R(-3, 3); if (isWater(px, pz)) continue; const id = i < 4 ? 'star' : i < 7 ? 'anemone' : 'crab'; if (count(id) >= S[id].cap) continue; const t = make(id, px, pz, { pool: true }); t.yaw = R(0, 6.28); t.y = walkY(px, pz) - 0.02; }
    return;
  }
}
// real salmon rivers (the bears and the fish turn up in the fall)
// (small rivers aren't in the map's water data, so these are the river mouths / reaches that are: checked in the preview)
const CREEKS = [[49.3228, -123.1390, 'Capilano River'], [49.3255, -123.0255, 'Lynn Creek'], [49.3040, -123.0285, 'Seymour River'], [49.8000, -123.1550, 'Cheakamus River (Brackendale)']].map(([la, lo, n]) => { const [x, z] = toXZ(la, lo); return { x, z, n, w: null }; });
function creekWater(c) {
  if (c.w !== null) return c.w;
  c.w = false; for (let r = 0; r <= 300 && !c.w; r += 15) for (let b = 0; b < 6.28; b += 0.3) { const x = c.x + Math.cos(b) * r, z = c.z + Math.sin(b) * r; if (isWater(x, z)) { c.w = { x, z }; break; } }
  return c.w;
}
function updateCreeks(pl) {
  if (season() !== 'fall') return;
  for (const c of CREEKS) {
    if (Math.hypot(c.x - pl.x, c.z - pl.z) > 700 || c.active) continue;
    const w = creekWater(c); if (!w) continue;
    c.active = true;
    let up = 0; for (let b = 0; b < 6.28; b += 0.2) if (isWater(w.x + Math.cos(b) * 20, w.z + Math.sin(b) * 20) && heightAt(w.x + Math.cos(b) * 60, w.z + Math.sin(b) * 60) > heightAt(w.x, w.z)) { up = Math.atan2(-Math.cos(b), -Math.sin(b)); break; }
    for (let i = 0; i < 12; i++) { const f = make('salmon', w.x + R(-3, 3), w.z + R(-3, 3), { creek: c, hx: w.x, hz: w.z, up, pitch: 0, jump: 0 }); f.y = waterLevel(f.x, f.z) - 0.35; }
    let bx = w.x, bz = w.z; for (let b = 0; b < 6.28; b += 0.3) { const x = w.x + Math.cos(b) * 4, z = w.z + Math.sin(b) * 4; if (!isWater(x, z)) { bx = w.x + Math.cos(b) * 1.5; bz = w.z + Math.sin(b) * 1.5; break; } }
    const bear = make(c.z < -45000 && Math.random() < 0.4 ? 'grizzly' : 'bear', bx, bz, { creek: c }); setSt(bear, 'fish', R(3, 6)); bear.yaw = R(0, 6.28);
    toastOnce('salmonrun', '🐟 The salmon are running!', `Thousands of salmon are fighting their way up the ${c.n} to spawn. Watch the water… and watch for bears.`, 6000, 600);
    discover('salmonrun');
  }
  for (const c of CREEKS) if (c.active && Math.hypot(c.x - pl.x, c.z - pl.z) > 900) { c.active = false; for (const a of [...live]) if (a.creek === c) kill(a); }
}
// a bear raiding a green bin in a North Shore yard (night, not winter)
let binT = 25;
function updateBinBear(dt, pl) {
  binT -= dt; if (binT > 0) return; binT = 40;
  if (season() === 'winter' || live.some(a => a.st === 'bin' || a.st === 'binstand') || pl.flying) return;
  const h = heightAt(pl.x, pl.z);
  if (!(pl.z < -3000 && isNorthShoreTown(pl.x, pl.z, h)) || Math.random() > ((G.night || 0) > 0.3 || G.hour < 7 || G.hour > 19 ? 0.45 : 0.1)) return;
  for (const b of nearBuildings(pl.x, pl.z, 150)) {
    if (!b.house) continue; const dd = Math.hypot(b.x - pl.x, b.z - pl.z); if (dd < 40 || dd > 150) continue;
    const nr = nearestRoad(b.x, b.z, 40); if (!nr) continue;
    let x = b.x, z = b.z; const L = Math.hypot(b.x - pl.x, b.z - pl.z) || 1, ux = (b.x - pl.x) / L, uz = (b.z - pl.z) / L; let k = 0; while (buildingAt(x, z) && k++ < 30) { x += ux; z += uz; } x += ux * 3; z += uz * 3;
    if (buildingAt(x, z) || isWater(x, z) || nearestRoad(x, z, 4)) continue;
    const a = make('bear', x, z); a.yaw = R(0, 6.28); setSt(a, 'bin', 999);
    const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw); a.bin = addProp('bin', x + fx * 1.7, walkY(x + fx * 1.7, z + fz * 1.7), z + fz * 1.7, a.yaw); return;
  }
}
// the crow commute: every evening thousands of crows stream east over the city to roost at Still Creek in Burnaby
function updateCommute(dt, pl) {
  const on = G.hour > 17.6 && G.hour < 20.3 && (G.night || 0) < 0.85 && pl.x > -12000 && pl.x < 16000 && pl.z > -4000 && pl.z < 9000;
  const crows = live.filter(a => a.id === 'crow');
  if (on && crows.length < 90 && Math.random() < dt * 14) { const c = make('crow', pl.x - R(150, 260), pl.z + R(-160, 160)); c.alt = R(25, 70); c.fly = 1; c.yaw = -Math.PI / 2 + R(-0.15, 0.15); c.y = heightAt(c.x, c.z) < 0 ? 0 : heightAt(c.x, c.z); }
  for (const c of crows) { if (c.x > pl.x + 280 || !on && Math.random() < dt * 0.5) c.gone = true; }
  if (on && crows.length > 30 && G.t - (warned.commute || -1e9) > 400) { warned.commute = G.t; ui.toast('🐦‍⬛ The crow commute!', 'Every evening up to 6,000 crows fly east over the city to sleep together in Burnaby. Look up!', 5000); spot('crow'); discover('crows'); }
}
// a gull steals your food when you buy something near the water
let spentWas = null, thiefCD = 0;
function updateThief(dt, pl) {
  if (spentWas === null) spentWas = OWN.spent; thiefCD -= dt;
  if (OWN.spent > spentWas) { spentWas = OWN.spent; if (thiefCD < 0 && !pl.vehicle && nearWater(pl.x, pl.z, 120) && Math.random() < 0.45) { thiefCD = 120; const g = make('gull', pl.x + R(-30, 30), pl.z + R(-30, 30)); g.fly = 1; g.alt = 18; g.st = 'swoop'; } }
  spentWas = OWN.spent;
}
function aiThief(a, dt, pl) {
  a.fly = 1; a.flap = Math.sin(G.t * 14) * 0.7; a.y = walkY(pl.x, pl.z);
  if (a.st === 'swoop') { const dx = pl.x - a.x, dz = pl.z - a.z, L = Math.hypot(dx, dz); a.yaw = Math.atan2(-dx, -dz); a.x += dx / (L || 1) * Math.min(L, 14 * dt); a.z += dz / (L || 1) * Math.min(L, 14 * dt); a.alt = Math.max(1.7, a.alt - dt * 9); if (L < 1) { a.st = 'away'; a.t = 0; say(a, '🍟 *SNATCH*', 1600); ui.toast('🕊️ A seagull stole your food!', 'Straight out of your hand. Vancouver gulls are pros: Granville Island even uses hawks to keep them away.', 4500); discover('gullheist'); spot('gull'); pl.buffT = 0; } }
  else { a.x -= Math.sin(a.yaw) * 10 * dt; a.z -= Math.cos(a.yaw) * 10 * dt; a.alt += dt * 4; if (a.t > 8) a.gone = true; }
}
function aiCommute(a, dt) { a.x += 12 * dt; a.z += Math.sin(G.t * 0.3 + a.ph * 7) * 0.8 * dt; a.flap = Math.sin(G.t * 12 + a.ph * 20) * 0.7; a.yaw = -Math.PI / 2; }

// ---------- residents: the North Shore bears and Grouse refuge grizzlies (also used by the Wildlife Photographer job) ----------
let inited = false, lodge = null;
function initFauna() {
  inited = true;
  for (const [lat, lon] of [[49.3720, -123.0870], [49.3650, -122.9550], [49.3900, -123.2000], [49.3500, -123.1000], [49.3600, -123.0400], [50.0950, -122.9700], [50.1300, -122.9300], [50.0800, -122.9300], [49.7200, -123.1100]]) {
    const [x, z] = toXZ(lat, lon); const a = make('bear', x, z, { resident: true, home: { x, z, r: 30 } }); setSt(a, 'forage');
  }
  for (const [i, nm] of [[0, 'Coola'], [1, 'Grinder']]) { const [x, z] = toXZ(49.3792 + i * 0.0003, -123.0835); const a = make('grizzly', x, z, { resident: true, name: nm, fence: true, home: { x, z, r: 14 }, jid: 'grizzlies' }); a.sc = 1.25; a.col.set(i ? '#5a3d24' : '#6e4c2c'); setSt(a, 'forage'); }
  // the Lost Lagoon beaver lodge
  const ll = M.areas.find(a => a.k === 'water' && !a.line && a.n !== undefined && M.names[a.n] === 'Lost Lagoon');
  if (ll) for (let i = 0; i < ll.p.length; i += 2) { const x = ll.p[i], z = ll.p[i + 1], cx = x + (ll.p[(i + 6) % ll.p.length] - x) * 0, dx = (ll.p[(i + 20) % ll.p.length] - x), dz = (ll.p[(i + 21) % ll.p.length] - z); const px = x + dx * 0.15 + 4, pz = z + dz * 0.15; if (isWater(px, pz)) { lodge = addProp('lodge', px, waterLevel(px, pz) - 0.4, pz, i); lodge.userData.home = [px, pz]; break; } }
}

// ---------- per frame ----------
const _root = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
let spawnT = 0, poolT = 0, spotT = 0;
export function updateFauna(dt, pl) {
  if (!inited) initFauna();
  if (pl.transit && !pl.vehicle) { /* riding: animals keep going */ }
  spawnT -= dt; poolT -= dt;
  const nonResident = live.filter(a => !a.resident && !a.cub && a.S.w).length;
  if (spawnT < 0 && !pl.flying) { spawnT = 0.7; if (nonResident < 22) trySpawn(pl); }
  if (poolT < 0) { poolT = 4; if (live.filter(a => a.pool).length < 18 && !pl.vehicle) spawnTidePool(pl); }
  if (lodge && Math.hypot(lodge.position.x - pl.x, lodge.position.z - pl.z) < 300 && count('beaver') < 1 && (dusk() || night() || Math.random() < 0.002)) { const [x, z] = lodge.userData.home; make('beaver', x + 3, z + 3); }
  updateCreeks(pl); updateBinBear(dt, pl); updateCommute(dt, pl); updateThief(dt, pl);
  if (tapped('KeyG') && pl.vehicle) { noiseT = G.t; for (const a of live) if (a.kind === 'bear' && Math.hypot(a.x - pl.x, a.z - pl.z) < 80 && !a.fence) { a.noise = 1; if (Math.hypot(a.x - pl.x, a.z - pl.z) < 60) toastOnce('horn', '🐻 HONK! The bear runs off', 'Loud noise is exactly right: bears avoid people when they know we\'re there. (Never chase or "herd" a bear with a car though.)', 5000, 60); } else if (Math.hypot(a.x - pl.x, a.z - pl.z) < 50 && ['grazer', 'groundbird', 'sentinel'].includes(a.S.ai)) { setSt(a, 'flee', 8); away(a, pl); } }
  if (stinkT > 0) { stinkT -= dt; if (Math.random() < dt * 0.5) for (const p of (window.__peds || [])) { if (Math.hypot(p.x - pl.x, p.z - pl.z) < 8) { say(p, pick(['Ew, what is that SMELL?', 'Did someone hit a skunk?', '🤢', 'Dude. Shower.']), 2000); break; } } }
  // simulate
  for (const a of live) {
    const d = Math.hypot(a.x - pl.x, a.z - pl.z);
    if (a.resident && d > 450) continue;   // residents wait at home while you're far away
    if (!a.resident && !a.creek && (d > (a.S.small ? 140 : 340) && a.id !== 'crow')) { a.gone = true; continue; }
    a.t += dt;
    switch (a.S.ai) {
      case 'bear': aiBear(a, dt, pl, d); break; case 'grazer': aiGrazer(a, dt, pl, d); break; case 'sentinel': aiSentinel(a, dt, pl, d); break;
      case 'cougar': aiCougar(a, dt, pl, d); break; case 'wolf': aiWolf(a, dt, pl, d); break; case 'porcupine': aiPorcupine(a, dt, pl, d); break; case 'skunk': aiSkunk(a, dt, pl, d); break;
      case 'swim': aiSwim(a, dt, pl, d); break; case 'otter': aiOtter(a, dt, pl, d); break; case 'haul': aiHaul(a, dt, pl, d); break; case 'float': aiFloat(a, dt, pl, d); break;
      case 'groundbird': aiGroundBird(a, dt, pl, d); break; case 'soar': aiSoar(a, dt, pl); break; case 'perch': aiPerch(a, dt, pl, d); break; case 'hummer': aiHummer(a, dt, pl, d); break;
      case 'duck': aiDuck(a, dt, pl, d); break; case 'crab': aiCrab(a, dt, pl, d); break; case 'fish': aiFish(a, dt, pl, d); break; case 'thief': aiThief(a, dt, pl); break; case 'commute': aiCommute(a, dt); break;
    }
    // ground height
    const ai = a.S.ai;
    if (a.cub && a.climbY > 0) a.y = (a.tree?.y ?? walkY(a.x, a.z)) + a.climbY;
    else if (!['duck', 'swim', 'float', 'fish', 'haul', 'otter', 'crab', 'still'].includes(ai) && !(ai === 'bear' && a.st === 'fish')) { const gy = walkY(a.x, a.z, a.y + 1.5); a.y += (gy - a.y) * Math.min(1, dt * 10); if (Math.abs(gy - a.y) > 3) a.y = gy; }
    else if (ai === 'haul' || ai === 'otter') { if (!isWater(a.x, a.z)) a.y = walkY(a.x, a.z); }
    // gait
    const S = a.S, run = a.spd > S.speed[0] * 1.6;
    a.gait = run ? (S.gait || (ai === 'bear' ? 'gallop' : 'trot')) : 'walk';
    if (!(a.cub && a.st === 'up')) { a.amp += ((a.spd > 0.05 ? 1 : 0) - a.amp) * Math.min(1, dt * 5); a.ph += dt * a.spd / Math.max(0.15, (a.S.build ? 1 : 1) * (run ? 2.4 : 1.25) * stride(a)); }
  }
  for (let i = live.length - 1; i >= 0; i--) if (live[i].gone) kill(live[i]);
  // spotting (every 0.4 s)
  spotT -= dt;
  if (spotT < 0) { spotT = 0.4; for (const a of live) { if (a.spotted || a.vis === false) continue; const d = Math.hypot(a.x - pl.x, a.z - pl.z); if (d < a.S.spot * (a.S.small ? 1 : 1) && (a.id !== 'crow' || d < 90)) { a.spotted = true; spot(a.jid); if (a.white) discover('spiritbear'); if (a.kind === 'bear' && a.name === 'Coola') { } if (a.id === 'cougar') discover('cougar'); if (a.id === 'moose') discover('moose'); if (a.id === 'lynx') discover('lynx'); } }
    for (const o of animals) { if (o.ext) continue; const d = Math.hypot(o.x - pl.x, o.z - pl.z); const id = { goose: 'goose', raccoon: 'raccoon', coyote: 'coyote', crow: 'crow', gull: 'gull', eagle: 'baldeagle', seal: 'harbourseal', orca: 'orca' }[o.kind]; if (id && d < (o.kind === 'orca' || o.kind === 'eagle' ? 120 : 30)) softSpot(id); }
  }
  // photos
  if (tapped('KeyP')) takePhoto(pl);
  draw();
}
const stride = a => { const s = a.S; return (s._stride ??= ({ bear: 0.8, grizzly: 0.9, moose: 1.4, elk: 1.25, bullelk: 1.3, deer: 0.95, buck: 1, goat: 0.7, bighorn: 0.75, cougar: 0.7, wolf: 0.8, coyote: 0.6, sealion: 0.6 }[a.id] ?? 0.35)) * a.sc; };
function takePhoto(pl) {
  let best = null, bs = 1e9;
  for (const a of live) {
    if (a.vis === false) continue; const d = Math.hypot(a.x - pl.x, a.z - pl.z); if (d > 70) continue;
    _p.set(a.x, a.y + 0.6 + (a.alt || 0), a.z).project(camera); if (_p.z > 1 || Math.abs(_p.x) > 0.75 || Math.abs(_p.y) > 0.75) continue;
    const sc = d + Math.hypot(_p.x, _p.y) * 25; if (sc < bs) { bs = sc; best = a; }
  }
  if (best) { photo(best.jid); if (best.white) discover('spiritbear'); return; }
  photoPlant?.(pl);
}

// ---------- drawing ----------
function draw() {
  for (const k in rigs) rigs[k].begin();
  for (const a of live) {
    if (a.vis === false) continue;
    const rig = rigOf(a.id), P = a.pose, S = a.S, type = rig.type;
    let rx = a.pitch || 0, rz = a.roll || 0, y = a.y;
    if (type === 'quad') {
      const G2 = GAITS[a.gait || 'walk'], amp = a.amp * (a.gait === 'walk' ? 0.42 : 0.7), ph = a.ph * 6.283;
      const st = a.stand || 0, lie = a.lie || 0, crouch = a.crouch || 0;
      P.body = [st * 1.15 + (a.gait === 'gallop' || a.gait === 'bound' ? Math.sin(ph * 1) * 0.1 * a.amp : 0), 0, Math.sin(ph) * 0.035 * a.amp];
      P.head = [-(a.hd || 0) * 1.0 - st * 0.95 + (a.lunge > 0 ? -0.4 : 0), a.look || 0, 0];
      for (const n of ['fuL', 'fuR', 'huL', 'huR']) {
        const o = G2[n] * 6.283, s = Math.sin(ph + o), c = Math.cos(ph + o), front = n[0] === 'f', L = n[2] === 'L';
        let up = amp * s, lo = front ? -amp * 1.5 * Math.max(0, c) : amp * 1.1 * Math.max(0, c);
        if (front) { up += -st * 0.75 + st * 0.3; lo += -st * 0.6; if (a.paw && L) { up += a.paw * 1.1; lo -= a.paw * 0.6; } }
        else up += -st * 1.15;
        if (lie) { up = up * (1 - lie) + (front ? 1.3 : -1.0) * lie; lo = lo * (1 - lie) + (front ? -2.5 : 2.2) * lie; }
        if (crouch) { up += front ? 0.35 * crouch : -0.4 * crouch; lo += front ? -0.6 * crouch : 0.7 * crouch; }
        if (a.swim) { up = Math.sin(ph * 2 + o) * 0.6; lo = 0; }
        P[n] = [up, 0, front && L ? -st * 0.25 : front ? st * 0.25 : 0]; P['fl' + n.slice(2)] = undefined; P[(front ? 'fl' : 'hl') + (L ? 'L' : 'R')] = [lo, 0, 0];
      }
      // tail up for an angry skunk / puffed porcupine are part of the body pose
      const H = rig.slots[0].at[1];
      y -= lie * H * 0.62 * a.sc + crouch * H * 0.25 * a.sc + (a.swim ? H * 0.8 * a.sc : 0);
      if (st > 0 && !(a.cub && a.climbY > 0)) y += st * 0.05;
      if (a.cub && a.climbY > 0) { rx = 1.35; P.body[0] = 0; P.head[0] = -1.1; for (const n of ['fuL', 'fuR']) P[n][0] = 1.5 + Math.sin(a.ph * 6.283 + (n === 'fuL' ? 0 : 3)) * 0.4 * a.amp; for (const n of ['huL', 'huR']) P[n][0] = 0.6 + Math.sin(a.ph * 6.283 + (n === 'huL' ? 3 : 0)) * 0.4 * a.amp; }
      else if (!a.swim) { const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw), Lb = (rig.slots[0].at[2] * 2 + 0.3) * a.sc; const hf = heightAt(a.x + fx * Lb * 0.5, a.z + fz * Lb * 0.5), hb = heightAt(a.x - fx * Lb * 0.5, a.z - fz * Lb * 0.5); rx = clamp(Math.atan2(hf - hb, Lb), -0.5, 0.5); }
      if (a.puff) P.body[2] += Math.sin(G.t * 30) * 0.03 * a.puff;
      y += Math.abs(Math.sin(ph * 2)) * 0.015 * a.amp * a.sc;
    } else if (type === 'bird') {
      const f = a.fly ? a.flap : -1;
      if (a.fly) { P.wl = [0, 0, f]; P.wr = [0, 0, -f]; } else { P.wl = [0, 1.35, -0.25]; P.wr = [0, -1.35, 0.25]; }
      P.head = [-(a.pk || 0), a.look || 0, 0];
      y += (a.alt || 0);
      if (S.ai === 'perch') { rx = a.fly ? 0 : -1.0; }
      else if (a.fly && S.ai !== 'hummer') rx = -0.1;
    } else if (S.ai === 'float') { rz = Math.PI + (a.roll || 0); y += 0.12; }
    _e.set(rx, a.yaw, rz); _q.setFromEuler(_e); _root.compose(_p.set(a.x, y, a.z), _q, _s.setScalar(a.sc));
    rig.draw(_root, P, a.col);
  }
  for (const k in rigs) rigs[k].end();
}

// ---------- E: watch, make noise, (please don't) feed ----------
const FINE = ['A BC Conservation Officer appeared out of nowhere. Fine: $', 'Feeding wildlife is against the BC Wildlife Act (it teaches animals to approach people, and that ends badly for them). Fine: $', 'A park ranger saw that. "A fed animal is a dead animal." Fine: $'];
const WATCH = {
  bear: 'You stand still and watch. Its nose works constantly: a bear smells about 7 times better than a bloodhound.', deer: 'Its huge ears swivel toward you independently, like two satellite dishes.', elk: 'The herd keeps one eye on you while they graze. A cow elk is in charge of the group, not the bull.',
  goat: 'It stands on a ledge narrower than your shoe, totally relaxed.', marmot: 'It sunbathes on a boulder like it\'s at the beach. Marmots spend most of the summer just eating and napping.', jay: 'It cocks its head and hops closer. It has definitely seen a sandwich before.',
  mallard: 'It tips bottom-up to nibble water plants. Classic dabbling.', beaver: 'It glides across the water with just its nose and eyes showing, towing a branch.', porcupine: 'It chews on bark, unbothered. A porcupine can live 20+ years.',
  crab: 'It waves a claw at you. Tiny, but furious.', star: 'You look closely: hundreds of little tube feet wave underneath.', anemone: 'Its green tentacles sway in the pool, waiting for a passing snack.',
};
let promptA = null;
export function faunaPrompt(pl) {
  if (pl.vehicle || G.dialogOpen || pl.transit) return '';
  let best = null, bd = 1e9;
  for (const a of live) { if (a.vis === false || a.cub || a.id === 'crow' || a.id === 'gull' || a.id === 'salmon') continue; const d = Math.hypot(a.x - pl.x, a.z - pl.z), r = a.kind === 'bear' ? (a.fence ? 10 : 32) : a.id === 'cougar' || a.id === 'wolf' ? 45 : a.id === 'moose' ? 25 : a.S.small ? 5 : 9; if (d < r && d < bd) { bd = d; best = a; } }
  for (const o of animals) { if (o.ext || !['goose', 'raccoon'].includes(o.kind)) continue; const d = Math.hypot(o.x - pl.x, o.z - pl.z); if (d < 5 && d < bd) { bd = d; best = o; } }
  promptA = best; if (!best) return floraPrompt(pl);
  const kind = best.kind, nm = best.S ? best.S.name : kind === 'goose' ? 'Canada goose' : 'raccoon';
  if (kind === 'bear') { if (tapped('KeyE')) { if (best.fence) { ui.toast('🐻 ' + best.name, 'Coola and Grinder live safely inside the refuge fence. They don\'t care how loud you are. Grinder yawns.', 3500); return ''; } best.noise = 1; for (const c of best.cubs || []) c.noise = 1; say(pl, 'HEY BEAR! Easy, bear…', 1800); if (!best.heyed) { best.heyed = true; pl.karma = (pl.karma || 0) + 1; discover('heybear'); ui.toast('🗣️ "HEY BEAR!"', 'Perfect: a calm, loud voice tells the bear you\'re a person, not prey. It decides you\'re not worth the trouble. (+1 karma)', 5000); } } return '<kbd>E</kbd> 🗣️ Make noise: "HEY BEAR!" (calm and loud)'; }
  if (best.id === 'cougar' || best.id === 'wolf') { if (tapped('KeyE')) { best.noise = 1; if (best.S.ai === 'wolf' || best.id === 'wolf') { setSt(best, 'flee', 10); away(best, pl, 80); } ui.toast('🙌 You made yourself BIG', 'Arms up, jacket open, loud voice, eye contact, back away slowly. It slinks off into the trees. Textbook.', 4500); discover('cougar'); } return `<kbd>E</kbd> 🙌 Make yourself big (${nm.toLowerCase()})`; }
  if (tapped('KeyE')) {
    const id = best.S ? best.id : kind, jid = best.jid || kind, txt = (best.S?.fact) || '';
    ui.dialog(`${best.S?.emoji || (kind === 'goose' ? '🪿' : '🦝')} ${nm}`, (WATCH[best.S?.jid || id] || WATCH[id] || 'You stand quietly and watch for a while. It goes on with its day like you\'re part of the scenery.') + (txt ? '<br><br><small>' + txt + '</small>' : ''), ['🔭 Keep watching', '🍞 Feed it a snack', '👋 Leave it be']).then(i => {
      if (i === 0) { spot(jid, true); ui.toast('🔭 Quiet observer', pick(['Patience pays: you saw something most people walk right past.', 'You stayed still long enough that it forgot you were there.', 'Ten quiet minutes. Best part of the day.']), 2500); }
      else if (i === 1) { const fine = pick([115, 230, 345]); pl.money = Math.max(0, pl.money - fine); ui.toast('🚔 Fined $' + fine, pick(FINE) + fine + '.', 6000); discover('wildfine');
        if (kind === 'goose') { best.chased = false; say(best, 'HONK HONK HONK!!!', 2000); } else if (best.S) { best.fedT = G.t; setSt(best, 'idle'); say(best, '*munch* (more?)', 1800); } }
    });
  }
  return `<kbd>E</kbd> 🔭 Watch the ${nm.toLowerCase()}`;
}
export const _fauna = { live, S, make, spawnGroup, setSt, rigs, CREEKS, updateCreeks, habitat, get lodge() { return lodge; } };   // for tests
