// People: player body, pedestrians walking real sidewalks, zombies, speech bubbles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, scene, camera, clamp, R, pick, wrapAngle, std, addMesh } from './core.js';
import { heightAt, isWater, waterLevel } from './terrain.js';
import { edges, nodeEdges, NX, NZ, roadGrid, surfaceY as groundY, walkY as surfaceY, collideBuildings, isWalkType, nearestRoad, buildingAt } from './city.js';
import { signalState } from './streetprops.js';
import { blockedAt } from './colliders.js';
import { tintShader, bake, SP, SPs } from './tint.js';

const M = window.MAP;
export const SKIN = ['#f1c9a5', '#e0ac7e', '#c68c5e', '#8d5a3b', '#5c3a24', '#f5d6bd', '#d8a47f'];
export const HAIR = ['#1b1b1b', '#3b2416', '#6b4423', '#a8763e', '#d9b36c', '#8a8a8a', '#b5442c', '#2a2a40'];
export const SHIRT = ['#2b6cb0', '#c53030', '#2f855a', '#d69e2e', '#1a202c', '#e2e8f0', '#805ad5', '#dd6b20', '#319795', '#718096', '#b83280', '#4a5568', '#9b2c2c', '#ecc94b'];
export const PANTS = ['#1a202c', '#2d3748', '#2c5282', '#4a5568', '#744210', '#1c4532', '#000000', '#5a4a3a', '#2a4365'];

// ---------- the part layout shared by everyone ----------
// body parts: tapered limbs with knees/elbows, a shaped torso with shoulders, a head with nose + ears. `follow` = moves with that limb.
const _mg = (...gs) => mergeGeometries(gs.map(g => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; }));
// Realism pass 3 (2026-11-22): shaped (lathe) torso and hips, thighs + separate shins (shorts show bare legs), sleeves + separate
// forearms (short sleeves), hands with a thumb, a face with cheekbones, brow ridge, nose tip, chin, lips, eye whites + irises and
// brows in the hair colour; hair styles (short, fringe, afro, ponytail, bob, long, bun), beards, puffer vests, hoodie hoods and
// sneaker soles. `alias` = which look colour to use when the look doesn't set this part's own colour (old looks keep working).
const V2 = (x, y) => new THREE.Vector2(x, y);
const lathe = (pts, seg = 20, sz = 0.6) => new THREE.LatheGeometry(pts.map(([x, y]) => V2(x, y)), seg).scale(1, 1, sz);
const thighGeo = () => _mg(
  new THREE.SphereGeometry(0.097, 12, 8).scale(1, 0.8, 1).translate(0, -0.03, 0),
  new THREE.CylinderGeometry(0.097, 0.067, 0.45, 12).translate(0, -0.25, 0));                 // thigh (to just above the knee)
const shinGeo = () => _mg(
  new THREE.SphereGeometry(0.064, 10, 8).translate(0, -0.48, 0.006),                           // knee
  new THREE.CylinderGeometry(0.062, 0.056, 0.17, 12).translate(0, -0.57, 0.016),              // calf
  new THREE.CylinderGeometry(0.056, 0.042, 0.24, 12).translate(0, -0.76, 0.012),              // shin → ankle
  new THREE.CylinderGeometry(0.043, 0.047, 0.05, 10).translate(0, -0.87, 0.012));
const sleeveGeo = () => _mg(
  new THREE.SphereGeometry(0.058, 10, 8).scale(0.95, 0.8, 1).translate(0, -0.035, 0),
  new THREE.CylinderGeometry(0.057, 0.05, 0.29, 10).translate(0, -0.17, 0));                  // upper arm / sleeve
const foreGeo = () => _mg(
  new THREE.SphereGeometry(0.048, 10, 8).translate(0, -0.31, 0),                               // elbow
  new THREE.CylinderGeometry(0.047, 0.034, 0.27, 10).translate(0, -0.45, 0));                 // forearm → wrist
const handGeo = () => _mg(
  new THREE.SphereGeometry(0.04, 10, 8).scale(0.62, 1.15, 1.05).translate(0, -0.635, 0),       // palm
  new THREE.SphereGeometry(0.032, 8, 6).scale(0.55, 1.2, 0.95).translate(0, -0.69, 0.004),     // fingers (curled together)
  new THREE.CylinderGeometry(0.011, 0.012, 0.05, 6).rotateX(-0.6).translate(0, -0.635, -0.03)); // thumb
const torsoGeo = () => _mg(
  lathe([[0.155, -0.28], [0.16, -0.16], [0.172, -0.04], [0.192, 0.08], [0.205, 0.17], [0.198, 0.23], [0.15, 0.275], [0.07, 0.295], [0.0, 0.3]], 22, 0.6),   // waist → chest → shoulders
  new THREE.SphereGeometry(0.07, 10, 8).scale(1.0, 0.85, 0.95).translate(-0.198, 0.205, 0), new THREE.SphereGeometry(0.07, 10, 8).scale(1.0, 0.85, 0.95).translate(0.198, 0.205, 0));
const hipsGeo = () => lathe([[0.0, -0.12], [0.12, -0.11], [0.17, -0.05], [0.182, 0.02], [0.165, 0.08], [0.155, 0.1], [0.0, 0.1]], 20, 0.64);
const headGeo = () => _mg(
  new THREE.SphereGeometry(0.117, 22, 16).scale(0.9, 1.1, 1.0),                                 // skull
  new THREE.SphereGeometry(0.078, 14, 10).scale(1.0, 0.75, 0.95).translate(0, -0.07, -0.032),   // jaw
  new THREE.SphereGeometry(0.03, 8, 6).scale(1.1, 0.9, 1).translate(0, -0.108, -0.072),          // chin
  new THREE.SphereGeometry(0.034, 8, 6).translate(-0.052, -0.022, -0.083), new THREE.SphereGeometry(0.034, 8, 6).translate(0.052, -0.022, -0.083),   // cheekbones
  new THREE.SphereGeometry(0.09, 12, 6).scale(1, 0.2, 0.35).translate(0, 0.04, -0.092),          // brow ridge
  new THREE.ConeGeometry(0.019, 0.055, 8).rotateX(-Math.PI / 2 - 0.35).translate(0, -0.006, -0.123),   // nose bridge
  new THREE.SphereGeometry(0.016, 8, 6).scale(1.15, 0.9, 1).translate(0, -0.03, -0.132),         // nose tip
  new THREE.SphereGeometry(0.028, 8, 6).scale(0.45, 1, 0.8).translate(-0.108, 0, 0.005), new THREE.SphereGeometry(0.028, 8, 6).scale(0.45, 1, 0.8).translate(0.108, 0, 0.005));   // ears
const shoeGeo = () => _mg(new THREE.SphereGeometry(0.056, 10, 6).scale(0.95, 0.62, 2.15).translate(0, -0.875, -0.05), new THREE.CylinderGeometry(0.045, 0.05, 0.06, 10).translate(0, -0.86, 0.02));
const soleGeo = () => new THREE.BoxGeometry(0.106, 0.026, 0.255).translate(0, -0.912, -0.045);
const pair = (geo, dx, y, z) => _mg(geo.clone().translate(-dx, y, z), geo.clone().translate(dx, y, z));
const bumpy = (g, amt, seed = 3) => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + amt * Math.sin(x * 91 + seed) * Math.sin(y * 77 - seed) * Math.sin(z * 83 + 1); p.setXYZ(i, x * k, y * k, z * k); } g.computeVertexNormals(); return g; };
// a hair shell around the head that leaves the face open (phi range = everything except the front)
const hairShell = (r, th0, thL, open = 1.05) => new THREE.SphereGeometry(r, 20, 12, Math.PI * 1.5 + open, Math.PI * 2 - open * 2, th0, thL);
const PARTS = {
  legL:  { geo: thighGeo(), pivot: [-0.095, 0.92, 0], col: 'pants' },
  legR:  { geo: thighGeo(), pivot: [0.095, 0.92, 0], col: 'pants' },
  shinL: { geo: shinGeo(), pivot: [-0.095, 0.92, 0], col: 'shin', alias: 'pants', follow: 'legL', knee: 'L' },
  shinR: { geo: shinGeo(), pivot: [0.095, 0.92, 0], col: 'shin', alias: 'pants', follow: 'legR', knee: 'R' },
  shoeL: { geo: shoeGeo(), pivot: [-0.095, 0.92, 0], col: 'shoes', def: '#2a2a2a', follow: 'legL', knee: 'L' },
  shoeR: { geo: shoeGeo(), pivot: [0.095, 0.92, 0], col: 'shoes', def: '#2a2a2a', follow: 'legR', knee: 'R' },
  soleL: { geo: soleGeo(), pivot: [-0.095, 0.92, 0], col: 'sole', def: '#efeee8', follow: 'legL', knee: 'L' },
  soleR: { geo: soleGeo(), pivot: [0.095, 0.92, 0], col: 'sole', def: '#efeee8', follow: 'legR', knee: 'R' },
  hips:  { geo: hipsGeo(), pivot: [0, 0.97, 0], col: 'hipc', alias: 'pants' },
  torso: { geo: torsoGeo(), pivot: [0, 1.31, 0], col: 'shirt' },
  neck:  { geo: new THREE.CylinderGeometry(0.046, 0.054, 0.13, 12), pivot: [0, 1.62, 0.008], col: 'skin' },
  armL:  { geo: sleeveGeo(), pivot: [-0.255, 1.53, 0], col: 'shirt' },
  armR:  { geo: sleeveGeo(), pivot: [0.255, 1.53, 0], col: 'shirt' },
  foreL: { geo: foreGeo(), pivot: [-0.255, 1.53, 0], col: 'fore', alias: 'shirt', follow: 'armL' },
  foreR: { geo: foreGeo(), pivot: [0.255, 1.53, 0], col: 'fore', alias: 'shirt', follow: 'armR' },
  handL: { geo: handGeo(), pivot: [-0.255, 1.53, 0], col: 'skin', follow: 'armL' },
  handR: { geo: handGeo(), pivot: [0.255, 1.53, 0], col: 'skin', follow: 'armR' },
  head:  { geo: headGeo(), pivot: [0, 1.8, 0], col: 'skin' },
  eyew:  { geo: pair(new THREE.SphereGeometry(0.0148, 10, 6).scale(1.1, 0.62, 0.5), 0.039, 0.016, -0.1035), pivot: [0, 1.8, 0], col: 'eyew', def: '#efebe4', follow: 'head' },
  eyes:  { geo: pair(new THREE.SphereGeometry(0.0078, 8, 6).scale(1, 1, 0.5), 0.039, 0.016, -0.1105), pivot: [0, 1.8, 0], col: 'eyes', def: '#3a2616', follow: 'head' },
  brows: { geo: _mg(new THREE.BoxGeometry(0.044, 0.0095, 0.012).rotateZ(0.12).translate(-0.041, 0.047, -0.11), new THREE.BoxGeometry(0.044, 0.0095, 0.012).rotateZ(-0.12).translate(0.041, 0.047, -0.11)), pivot: [0, 1.8, 0], col: 'brows', alias: 'hair', follow: 'head' },
  lips:  { geo: _mg(new THREE.SphereGeometry(0.024, 10, 6).scale(1, 0.24, 0.38).translate(0, -0.062, -0.106), new THREE.SphereGeometry(0.022, 10, 6).scale(1, 0.3, 0.4).translate(0, -0.072, -0.103)), pivot: [0, 1.8, 0], col: 'lips', alias: 'skin', follow: 'head' },
  hair:  { geo: _mg(new THREE.SphereGeometry(0.126, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.3), hairShell(0.126, Math.PI * 0.3, Math.PI * 0.24, 0.75)).scale(0.97, 1.1, 1.06), pivot: [0, 1.815, 0.012], col: 'hair', follow: 'head' },   // crown + back and sides (the face stays open)
  fringe: { geo: bumpy(new THREE.SphereGeometry(0.1, 14, 8).scale(1.12, 0.42, 0.62).rotateZ(0.14), 0.06).translate(0.012, 0.088, -0.066), pivot: [0, 1.8, 0], col: 'fringe', opt: true, follow: 'head' },
  afro:  { geo: bumpy(new THREE.SphereGeometry(0.165, 16, 12).scale(1, 0.92, 1), 0.07, 7).translate(0, 0.06, 0.03), pivot: [0, 1.8, 0], col: 'afro', opt: true, follow: 'head' },
  pony:  { geo: _mg(new THREE.TorusGeometry(0.022, 0.009, 5, 10).rotateX(0.5).translate(0, 0.04, 0.122), new THREE.CylinderGeometry(0.034, 0.012, 0.26, 10).rotateX(0.32).translate(0, -0.08, 0.16)), pivot: [0, 1.8, 0], col: 'pony', opt: true, follow: 'head' },
  bob:   { geo: hairShell(0.137, Math.PI * 0.3, Math.PI * 0.42, 0.95).scale(1, 1.08, 1.03), pivot: [0, 1.8, 0.01], col: 'bob', opt: true, follow: 'head' },
  beard: { geo: _mg(hairShell(0.086, Math.PI * 0.52, Math.PI * 0.38, -0.25).scale(1.02, 1, 1).translate(0, -0.05, -0.02), new THREE.BoxGeometry(0.05, 0.012, 0.014).translate(0, -0.05, -0.115)), pivot: [0, 1.8, 0], col: 'beard', opt: true, follow: 'head' },
  hat:   { geo: _mg(new THREE.SphereGeometry(0.142, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1, 0.85, 1.05), new THREE.TorusGeometry(0.135, 0.018, 6, 18).rotateX(Math.PI / 2).translate(0, 0.005, 0)), pivot: [0, 1.86, 0.01], col: 'hat', opt: true, follow: 'head' },
  bag:   { geo: _mg(new THREE.BoxGeometry(0.28, 0.36, 0.13), new THREE.BoxGeometry(0.2, 0.14, 0.04).translate(0, -0.06, 0.085), pair(new THREE.BoxGeometry(0.035, 0.5, 0.02), 0.09, 0.05, -0.12)), pivot: [0, 1.3, 0.17], col: 'bag', opt: true },   // backpack with a front pocket and straps
  long:  { geo: new THREE.CylinderGeometry(0.12, 0.14, 0.4, 14, 1, true, -Math.PI * 0.35, Math.PI * 0.7).rotateY(Math.PI).translate(0, -0.2, 0).scale(1, 1, 0.7), pivot: [0, 1.86, 0.06], col: 'long', opt: true },          // long hair down the back
  bun:   { geo: bumpy(new THREE.SphereGeometry(0.062, 10, 8), 0.08), pivot: [0, 1.9, 0.12], col: 'bun', opt: true, follow: 'head' },
  skirt: { geo: lathe([[0.295, -0.48], [0.258, -0.3], [0.222, -0.12], [0.196, 0.0], [0.168, 0.075]], 20, 0.74), pivot: [0, 1.04, 0], col: 'skirt', opt: true },   // skirt or dress
  coat:  { geo: _mg(lathe([[0.262, -0.64], [0.24, -0.4], [0.225, -0.1], [0.228, 0.12], [0.2, 0.22]], 18, 0.64), new THREE.TorusGeometry(0.085, 0.03, 6, 14).rotateX(Math.PI / 2).translate(0, 0.24, 0)), pivot: [0, 1.4, 0], col: 'coat', opt: true },           // long coat / raincoat with a collar
  vest:  { geo: _mg(lathe([[0.17, -0.27], [0.178, -0.12], [0.2, 0.05], [0.215, 0.17], [0.19, 0.25], [0.11, 0.29]], 20, 0.66), ...[-0.2, -0.1, 0.0, 0.1, 0.2].map(y => new THREE.TorusGeometry(0.19 + y * 0.06, 0.012, 4, 20).rotateX(Math.PI / 2).scale(1, 1, 0.68).translate(0, y, 0))), pivot: [0, 1.31, 0], col: 'vest', opt: true },   // quilted puffer vest
  hood:  { geo: bumpy(new THREE.TorusGeometry(0.1, 0.045, 8, 14, Math.PI * 1.25).rotateX(Math.PI / 2).rotateY(Math.PI * 0.375), 0.05).scale(1.2, 1, 1.25).translate(0, 0, 0.04), pivot: [0, 1.6, 0.02], col: 'hood', opt: true },   // a hoodie's hood bunched at the neck
  scarf: { geo: _mg(new THREE.TorusGeometry(0.098, 0.04, 8, 16).rotateX(Math.PI / 2), new THREE.BoxGeometry(0.07, 0.24, 0.025).translate(0.05, -0.13, -0.075)), pivot: [0, 1.6, 0], col: 'scarf', opt: true },
  glasses: { geo: _mg(new THREE.TorusGeometry(0.029, 0.0055, 5, 14).translate(-0.042, 0, 0), new THREE.TorusGeometry(0.029, 0.0055, 5, 14).translate(0.042, 0, 0), new THREE.BoxGeometry(0.026, 0.006, 0.006), pair(new THREE.BoxGeometry(0.005, 0.005, 0.11), 0.071, 0.004, 0.055)), pivot: [0, 1.818, -0.122], col: 'glasses', opt: true, follow: 'head' },
  cup:   { geo: _mg(new THREE.CylinderGeometry(0.045, 0.036, 0.13, 12).translate(0, -0.66, -0.06), new THREE.CylinderGeometry(0.048, 0.048, 0.02, 12).translate(0, -0.59, -0.06), new THREE.CylinderGeometry(0.047, 0.042, 0.045, 12).translate(0, -0.665, -0.06)), pivot: [0.255, 1.53, 0], col: 'cup', opt: true, follow: 'armR' },   // a takeaway coffee
  sbag:  { geo: _mg(new THREE.BoxGeometry(0.3, 0.34, 0.11).translate(0, -0.9, 0), new THREE.TorusGeometry(0.07, 0.008, 4, 10, Math.PI).translate(0, -0.72, 0)), pivot: [-0.255, 1.53, 0], col: 'sbag', opt: true, follow: 'armL' },   // a shopping bag
};
const PART_NAMES = Object.keys(PARTS);
const KNEE = 0.47;   // knee joint, metres below the hip joint
// materials by part: skin with a soft warm "light through skin" term, cloth with a fine weave, hair with strands, glossy eyes
const SKINP = new Set(['head', 'neck', 'handL', 'handR', 'lips']), HAIRP = new Set(['hair', 'fringe', 'afro', 'pony', 'bob', 'beard', 'bun', 'long', 'brows']), GLOSS = new Set(['eyew', 'eyes', 'glasses', 'cup']);
function partMat(pn, color = '#ffffff') {
  const kind = SKINP.has(pn) || pn === 'foreL' || pn === 'foreR' || pn === 'shinL' || pn === 'shinR' ? 'skin' : HAIRP.has(pn) ? 'hair' : GLOSS.has(pn) ? 'gloss' : pn.startsWith('shoe') || pn.startsWith('sole') ? 'shoe' : 'cloth';
  const m = new THREE.MeshStandardMaterial({ color, roughness: kind === 'gloss' ? 0.25 : kind === 'skin' ? 0.58 : kind === 'hair' ? 0.55 : kind === 'shoe' ? 0.5 : 0.85, envMapIntensity: kind === 'gloss' ? 0.8 : 0.35 });
  // forearms and shins are skin OR cloth depending on the outfit, so they get a mild version of both
  m.onBeforeCompile = sh => {
    sh.vertexShader = 'varying vec3 vLp;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vLp = position;');
    const noise = 'float pH(vec3 p){ p = fract(p * 0.3183 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }\nfloat pN(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(mix(pH(i), pH(i + vec3(1,0,0)), f.x), mix(pH(i + vec3(0,1,0)), pH(i + vec3(1,1,0)), f.x), f.y), mix(mix(pH(i + vec3(0,0,1)), pH(i + vec3(1,0,1)), f.x), mix(pH(i + vec3(0,1,1)), pH(i + vec3(1,1,1)), f.x), f.y), f.z); }\n';
    const body = {
      skin: 'diffuseColor.rgb *= 0.95 + 0.07 * pN(vLp * 160.0);',
      cloth: 'diffuseColor.rgb *= 0.9 + 0.1 * pN(vLp * vec3(260.0, 90.0, 260.0)) + 0.06 * (pN(vLp * 14.0) - 0.5);',
      hair: 'diffuseColor.rgb *= 0.78 + 0.34 * pN(vLp * vec3(300.0, 25.0, 300.0));',
      shoe: 'diffuseColor.rgb *= 0.92 + 0.08 * pN(vLp * 120.0);', gloss: '',
    }[kind];
    sh.fragmentShader = 'varying vec3 vLp;\n' + noise + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + body);
    // skin: warm light that seems to come through (no grey-black shadow side on faces)
    // (scaled by the light the skin actually gets, so faces don't glow at night)
    if (kind === 'skin') sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n { vec3 got = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse; reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.5, 0.22, 0.14) * dot(got, vec3(0.33)); }');
  };
  m.customProgramCacheKey = () => 'person-' + kind;
  return m;
}

// pose -> angles for each part. state: {phase, amp, kind}
function poseAngles(a, out) {
  const s = Math.sin(a.phase), amp = a.amp;
  out.legL = s * amp; out.legR = -s * amp; out.armL = -s * amp * 0.8; out.armR = s * amp * 0.8;
  out.armLz = 0; out.armRz = 0; out.lean = 0; out.bob = Math.abs(Math.cos(a.phase)) * amp * 0.06;
  // knees bend as each leg swings forward (and a little when it takes the weight)
  out.kneeL = Math.max(0, Math.sin(a.phase + 1.2)) * amp * 1.3 + 0.05; out.kneeR = Math.max(0, -Math.sin(a.phase + 1.2)) * amp * 1.3 + 0.05;
  if (a.kind === 'zombie') { out.armL = -1.45 + s * 0.1; out.armR = -1.5 - s * 0.1; out.lean = 0.18; out.legL *= 0.6; out.legR *= 0.6; }
  if (a.kind === 'sit') { out.legL = out.legR = -1.5; out.kneeL = out.kneeR = 1.45; out.armL = out.armR = -0.3; out.bob = -0.45; }
  if (a.kind === 'dance') { out.armL = -2.6 + Math.sin(a.phase * 2) * 0.5; out.armR = -2.6 - Math.sin(a.phase * 2) * 0.5; out.bob = Math.abs(Math.sin(a.phase * 2)) * 0.12; out.legL = Math.sin(a.phase * 2) * 0.3; out.legR = -out.legL; }
  if (a.phone && a.kind === 'walk') { out.armR = -1.25; out.armRz = -0.25; }
  if (a.kind === 'wave') { out.armR = -2.8 + Math.sin(a.phase * 3) * 0.3; out.armRz = 0.3; }
  if (a.kind === 'swing') {   // a.swing = progress 0..1: wind up behind, slap forward, follow through
    const sm = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); }, u = a.swing;
    out.armR = 2.0 - 2.9 * sm(0.1, 0.55, u) + 0.3 * sm(0.55, 1, u); out.armL = 1.0 - 1.7 * sm(0.1, 0.55, u); out.lean = 0.2 * sm(0.3, 0.6, u); }
  if (a.kind === 'ride') { out.legL = -1.1 + Math.sin(a.phase) * 0.5; out.legR = -1.1 - Math.sin(a.phase) * 0.5; out.kneeL = 1.2 + Math.sin(a.phase) * 0.5; out.kneeR = 1.2 - Math.sin(a.phase) * 0.5; out.armL = out.armR = -1.1; out.lean = 0.25; out.bob = -0.25; }
  if (a.kind === 'stand') { out.legL = out.legR = 0; out.kneeL = out.kneeR = 0.05; out.armL = out.armR = -0.6; out.lean = 0.1; out.bob = -0.05; }
  if (a.kind === 'sitcar') { out.legL = out.legR = -1.4; out.kneeL = out.kneeR = 1.4; out.armL = out.armR = -1.2; out.bob = -0.4; }
  if (a.kind === 'ski' || a.kind === 'board') { out.kneeL = out.kneeR = 0.5; }
  if (a.kind === 'swim' || a.kind === 'zombie') { out.kneeL *= 0.4; out.kneeR *= 0.4; }
  if (a.kind === 'swim') { out.lean = 1.35; out.armL = -2.8 + Math.sin(a.phase) * 1.2; out.armR = -2.8 - Math.sin(a.phase) * 1.2; out.legL = s * 0.4; out.legR = -s * 0.4; }
  if (a.kind === 'ski') { out.legL = -0.25; out.legR = -0.25; out.armL = -0.7; out.armR = -0.7; out.lean = 0.25; out.bob = -0.12; }
  if (a.kind === 'board') { out.legL = -0.3; out.legR = 0.3; out.armL = -0.2; out.armR = -0.2; out.armLz = -1.1; out.armRz = 1.1; out.bob = -0.15; }
  return out;
}

// ---------- single detailed human (player / story characters) ----------
export function makeHuman(look) {
  const grp = new THREE.Group(), body = new THREE.Group(); grp.add(body);
  // one material per look colour (outfit changes recolour mats.shirt / mats.pants…); forearms/shins share the sleeve/trouser material
  // unless the look gives them their own colour (short sleeves, shorts)
  const mats = {};
  const colOf = P => look[P.col] || (P.alias && look[P.alias]) || P.def || '#888888';
  const matFor = (pn, P) => { const key = look[P.col] ? P.col : P.alias && look[P.alias] ? P.alias : P.col; return mats[key] || (mats[key] = partMat(pn, colOf(P))); };
  const parts = {};
  for (const n of PART_NAMES) {
    const P = PARTS[n]; if (P.follow || (P.opt && !look[P.col]) || (n === 'hat' && look.hat)) continue;
    const piv = new THREE.Group(); piv.position.set(...P.pivot); body.add(piv);
    addMesh(P.geo, matFor(n, P), 0, 0, 0, piv); parts[n] = piv;
  }
  for (const n of PART_NAMES) {
    const P = PARTS[n]; if (!P.follow || (P.opt && !look[P.col]) || n === 'hat') continue;
    const F = PARTS[P.follow];
    if (P.knee) {   // lower leg hangs from a knee joint
      const kn = 'knee' + P.knee; if (!parts[kn]) { parts[kn] = new THREE.Group(); parts[kn].position.set(0, -KNEE, 0); parts[P.follow].add(parts[kn]); }
      addMesh(P.geo, matFor(n, P), 0, KNEE, 0, parts[kn]);
    } else addMesh(P.geo, matFor(n, P), P.pivot[0] - F.pivot[0], P.pivot[1] - F.pivot[1], P.pivot[2] - F.pivot[2], parts[P.follow]);
  }
  mats.skin ||= partMat('head', look.skin); mats.hair ||= partMat('hair', look.hair); mats.shirt ||= partMat('torso', look.shirt); mats.pants ||= partMat('legL', look.pants); mats.shoes ||= partMat('shoeL', look.shoes || '#2a2a2a');
  if (look.hat) addMesh(new THREE.CylinderGeometry(0.15, 0.15, 0.1, 14), std(look.hat), 0, 0.12, 0, parts.head);
  if (look.backpack) addMesh(new THREE.BoxGeometry(0.34, 0.42, 0.16), std(look.backpack), 0, 0, 0.2, parts.torso);
  // the hockey stick, shown while attacking
  const stick = new THREE.Group(); parts.armR.add(stick); stick.position.set(0, -0.62, 0);
  // the shaft runs from the hand forward and down; the blade sits flat at the far end
  addMesh(new THREE.BoxGeometry(0.04, 1.3, 0.04), std('#c8a26b'), 0, -0.33, -0.44, stick).rotation.x = 0.927;
  addMesh(new THREE.BoxGeometry(0.06, 0.08, 0.32), std('#111'), 0, -0.74, -1.05, stick);
  stick.visible = false; parts.stick = stick;
  scene.add(grp);
  const st = { phase: 0, amp: 0, kind: 'walk', swing: 0 }, ang = {};
  return {
    grp, parts, st, mats,
    pose(dt) {
      poseAngles(st, ang);
      // pose angles are "negative = forward" (people face -z): flip them for the limbs
      parts.legL.rotation.x = -ang.legL; parts.legR.rotation.x = -ang.legR;
      if (parts.kneeL) { parts.kneeL.rotation.x = -ang.kneeL; parts.kneeR.rotation.x = -ang.kneeR; }
      parts.armL.rotation.x = -ang.armL; parts.armR.rotation.x = -ang.armR; parts.armL.rotation.z = ang.armLz; parts.armR.rotation.z = ang.armRz;
      body.rotation.x = -ang.lean; body.position.y = ang.bob;
    },
  };
}

// ---------- instanced crowd (cheap to draw lots of people) ----------
export class Crowd {
  constructor(cap, umbrellas = false) {
    this.cap = cap; this.meshes = {};
    if (umbrellas) { const g = new THREE.ConeGeometry(0.75, 0.35, 8).translate(0, 0.2, 0); this.umb = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ roughness: 0.6, side: THREE.DoubleSide }), cap); this.umb.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.umb.frustumCulled = false; this.umb.count = 0; this.umb.castShadow = true; this.umb.setColorAt(0, new THREE.Color()); scene.add(this.umb); this.uCols = ['#c53030', '#2b6cb0', '#1a202c', '#d69e2e', '#2f855a', '#805ad5', '#e2e8f0', '#dd6b20']; this.mU = new THREE.Matrix4().makeTranslation(0.18, 2.0, 0); }
    for (const n of PART_NAMES) {
      const m = new THREE.InstancedMesh(PARTS[n].geo, partMat(n), cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.count = 0;
      m.setColorAt(0, new THREE.Color()); scene.add(m); this.meshes[n] = m;
    }
    this.mBase = new THREE.Matrix4(); this.mPart = new THREE.Matrix4(); this.mOut = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(0, 0, 0, 'YXZ'); this.v = new THREE.Vector3(); this.one = new THREE.Vector3(1, 1, 1); this.ang = {}; this.c = new THREE.Color();
  }
  draw(list) {
    let n = 0; const used = this.used || (this.used = {}); for (const k in used) used[k] = 0;
    for (const a of list) {
      if (n >= this.cap) break; if (!a.visible) continue;
      poseAngles(a, this.ang);
      const lying = a.state === 'down' || a.state === 'dead';
      this.e.set(lying ? -Math.PI / 2 : -this.ang.lean, a.yaw, 0, 'YXZ'); this.q.setFromEuler(this.e);
      this.v.set(a.x, a.y + (lying ? 0.15 : this.ang.bob * (a.sc || 1)), a.z); this.sc = this.sc || new THREE.Vector3(); if (a.bw === undefined) { const h = Math.abs(Math.sin((a.x || 1) * 12.9898 + (a.z || 1) * 78.233)) % 1; a.bw = 0.86 + h * 0.34; a.bh = 0.92 + ((h * 7.13) % 1) * 0.17; } const S = a.sc || 1; this.sc.set(S * a.bw, S * a.bh, S * (0.92 + a.bw * 0.08)); this.mBase.compose(this.v, this.q, this.sc);
      for (const pn of PART_NAMES) {
        const P = PARTS[pn];
        const ln = P.follow || pn;
        const rx = -(ln === 'legL' ? this.ang.legL : ln === 'legR' ? this.ang.legR : ln === 'armL' ? this.ang.armL : ln === 'armR' ? this.ang.armR : 0);   // negative = forward (people face -z)
        const rz = ln === 'armL' ? this.ang.armLz : ln === 'armR' ? this.ang.armRz : 0;
        this.mPart.makeRotationFromEuler(this.e.set(rx, 0, rz, 'XYZ')); this.mPart.setPosition(P.pivot[0], P.pivot[1], P.pivot[2]);
        this.mOut.multiplyMatrices(this.mBase, this.mPart);
        if (P.knee) {   // shin, shoe and sole bend back at the knee (0.47 m below the hip joint)
          const k = P.knee === 'L' ? this.ang.kneeL : this.ang.kneeR;
          if (k) { this.mKnee = this.mKnee || new THREE.Matrix4(); this.mKnee.makeRotationX(-k); const e = this.mKnee.elements; e[13] = -KNEE - (e[5] * -KNEE); e[14] = -(e[6] * -KNEE); this.mOut.multiply(this.mKnee); }
        }
        if (P.opt) { if (!a.cols[P.col]) this.mOut.makeScale(0, 0, 0); else used[pn] = 1; }
        this.meshes[pn].setMatrixAt(n, this.mOut);
        const cc = a.cols[P.col] || (P.alias && a.cols[P.alias]) || P.def;
        if (a.dirty && cc) this.meshes[pn].setColorAt(n, this.c.set(cc));
      }
      if (this.umb) { const open = G.umbrellas && a.umb && !lying; this.mOut.multiplyMatrices(this.mBase, this.mU); if (!open) this.mOut.makeScale(0, 0, 0); this.umb.setMatrixAt(n, this.mOut); if (a.dirty) this.umb.setColorAt(n, this.c.set(this.uCols[a.umb % this.uCols.length])); }
      a.slot = n; n++;
    }
    if (this.umb) { this.umb.count = n; this.umb.visible = n > 0 && !!G.umbrellas; this.umb.instanceMatrix.needsUpdate = true; if (this.umb.instanceColor) this.umb.instanceColor.needsUpdate = true; }
    for (const pn of PART_NAMES) {
      const m = this.meshes[pn]; m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.visible = n > 0 && (!PARTS[pn].opt || !!used[pn]);   // an empty crowd, or nobody wearing it right now = no draw call
    }
    // colours must be rewritten when slots change, so mark all dirty each frame (cheap enough)
    for (const a of list) a.dirty = true;
  }
}

// ---------- pedestrians ----------
const LINES = [
  'Sorry!', 'Oh, sorry, eh.', 'Have you tried the new oat-milk place?', 'Is it going to rain? It\'s always going to rain.', 'My rent is more than my salary.',
  'Go Canucks Go!', 'I just moved here from Toronto, it\'s SO chill.', 'Have you seen my Lulus? I mean my yoga pants.', 'The SkyTrain is down again.', 'I only ride a $9,000 e-bike.',
  'Is that the guy from that Netflix show?', 'I hiked the Grouse Grind in 34 minutes, by the way.', 'Sushi for lunch AGAIN.', 'Watch out for the geese in Stanley Park.', 'A raccoon stole my burrito!',
  'Did you see the orcas this morning?', 'Ugh, another film crew blocking the street.', 'I\'m not lost, I\'m exploring.', 'Bike lane! BIKE LANE!', 'The mountains are out today!',
  'I\'d invite you over, but my condo is 380 square feet.', 'I\'m a realtor. Do you want a business card?', 'This latte cost $8.75 and I regret nothing.', 'Patagonia jacket? Check. Umbrella? Never.',
  'Have you been to Whistler? You should go to Whistler.', 'My dog has more Instagram followers than me.', 'Polar Bear Swim on New Year\'s Day, let\'s go!', 'Excuse me, do you know where Gastown is? Oh wait, I\'m in it.',
];
const OUCH = ['Ow! Sorry!', 'Hey! Rude! ...Sorry.', 'Watch it, buddy!', 'I\'m calling my lawyer! He\'s also my realtor.', 'My kombucha!', 'Not cool, eh!'];
const ZLINES = ['Braaains…', 'Braaains… and a pumpkin spice latte…', 'Uuughh… Fright Nights…', 'Graaah… parking was $40…', 'Mmmrrr… gluten-free brains…', 'Uuurgh… season pass…'];

export const peds = [], zombies = [];
let pedCrowd, zombieCrowd;
const walkEdges = () => edges;
export function newLook(kind) {
  if (kind === 'zombie') return { skin: pick(['#9bb37a', '#8aa36d', '#a6b98a', '#7f9466']), hair: pick(['#2a2a2a', '#4a3a2a', '#555']), shirt: pick(['#5a4a3a', '#6b5d4f', '#4a5048', '#7a3a3a', '#d06a2a']), pants: pick(['#2a2a2a', '#3a3a30', '#2a3040']) };
  const s = G.season, skin = pick(SKIN), r = Math.random;
  const coat = ['#1a202c', '#2d3748', '#4a5568', '#744210', '#2c5282', '#1c4532', '#9b2c2c', '#553c9a'], bright = ['#f6e05e', '#68d391', '#63b3ed', '#fc8181', '#f6ad55', '#fbb6ce', '#ffffff', '#81e6d9'];
  const bald = r() < 0.08;
  const look = { skin, hair: bald ? skin : pick(HAIR), shirt: s === 'winter' ? pick(coat) : s === 'summer' && r() < 0.5 ? pick(bright) : pick(SHIRT), pants: pick(PANTS) };
  // face: lips a little darker/redder than the skin, eye colour, eyebrows in the hair colour (grey-haired people keep darker brows)
  look.lips = '#' + new THREE.Color(skin).lerp(new THREE.Color('#9a4a4a'), 0.32).getHexString();
  look.eyes = pick(['#3a2616', '#3a2616', '#3a2616', '#2a1a10', '#4a6a8a', '#5a7a4a', '#6a5030']);
  if (bald || look.hair === '#8a8a8a') look.brows = pick(['#3a3530', '#5a5550']);
  // summer: shorts (bare shins) and short sleeves (bare forearms)
  if (s === 'summer' ? r() < 0.4 : s === 'spring' ? r() < 0.1 : false) { look.shin = skin; look.pants = pick(['#2c5282', '#c8b28a', '#1a202c', '#5a6a3a', '#9a8a7a', '#2a4365']); }
  if (s === 'summer' ? r() < 0.75 : s === 'spring' || s === 'fall' ? r() < 0.25 : false) look.fore = skin;
  const hatP = s === 'winter' ? 0.45 : s === 'summer' ? 0.22 : 0.14; if (r() < hatP) look.hat = pick(s === 'winter' ? ['#c53030', '#2b6cb0', '#1a202c', '#d69e2e', '#2f855a', '#e2e8f0'] : ['#1a202c', '#e2e8f0', '#2b6cb0', '#c53030', '#d69e2e']);
  if (r() < 0.3) look.bag = pick(['#1a202c', '#2d3748', '#c53030', '#2b6cb0', '#d69e2e', '#2f855a', '#718096']);
  // hair styles: long, bun, ponytail, bob, afro, fringe, or short; beards; skirts and dresses, long coats in the cold, scarves, glasses
  const hs = r(), hasHair = !bald && !look.hat;
  if (hasHair) { if (hs < 0.22) look.long = look.hair; else if (hs < 0.3) look.bun = look.hair; else if (hs < 0.4) look.pony = look.hair; else if (hs < 0.5) look.bob = look.hair; else if (hs < 0.57 && ['#5c3a24', '#8d5a3b'].includes(skin)) look.afro = look.hair; else if (hs < 0.75) look.fringe = look.hair; }
  if (!look.long && !look.bun && !look.pony && !look.bob && r() < 0.32) look.beard = r() < 0.2 ? '#8a8a8a' : look.hair === skin ? pick(HAIR) : look.hair;
  // Vancouver layers: puffer vests and hoodies
  if (s !== 'summer' && r() < 0.14) look.vest = pick(['#1a202c', '#2c5282', '#9b2c2c', '#2f855a', '#d69e2e', '#4a5568', '#e2e8f0']);
  else if (r() < 0.16) { look.hood = look.shirt; }
  look.sole = r() < 0.7 ? '#efeee8' : '#2a2a2a';
  if (r() < (s === 'summer' ? 0.22 : s === 'spring' ? 0.16 : 0.08)) { look.skirt = pick(['#2b6cb0', '#c53030', '#1a202c', '#805ad5', '#d69e2e', '#2f855a', '#b83280', '#e2e8f0', '#744210']); look.pants = skin; look.hipc = look.skirt; }
  if (r() < (s === 'winter' ? 0.5 : s === 'fall' ? 0.35 : s === 'spring' ? 0.12 : 0.02)) look.coat = pick(['#1a202c', '#2d3748', '#5a4a3a', '#2c5282', '#9c7b54', '#c8b28a', '#7a1f2b', '#3c5a3c', '#f6e05e']);   // incl. the classic yellow raincoat
  if (r() < (s === 'winter' ? 0.35 : s === 'fall' ? 0.15 : 0.02)) look.scarf = pick(['#c53030', '#d69e2e', '#2b6cb0', '#e2e8f0', '#2f855a', '#805ad5']);
  if (r() < 0.22) look.glasses = pick(['#111111', '#111111', '#5a3a22', '#c0c0c0']);
  if (kind !== 'zombie') { if (r() < 0.18) look.cup = pick(['#f4f1ea', '#f4f1ea', '#3a2a1f', '#c53030']); if (r() < 0.14) look.sbag = pick(['#c8a97a', '#ffffff', '#c53030', '#1a1a1a', '#2b6cb0']); }
  look.shoes = pick(s === 'winter' || s === 'fall' ? ['#1a1a1a', '#3b2a1a', '#5a3d22', '#2a2a2a', '#f0f0f0'] : ['#f2f2f2', '#f2f2f2', '#1a1a1a', '#2a2a2a', '#7a7a7a', '#c53030', '#2b6cb0', '#5a3d22']);
  return look;
}

function placeOnEdge(p, e, dir, t) {
  p.e = e; p.dir = dir; p.t = t;
  const r = M.roads[e.r];
  p.side = (r.t <= 6 ? r.w / 2 + 0.7 + (p.lane ?? (p.lane = Math.random())) * 1.5 : 0.25 + (p.lane ?? (p.lane = Math.random())) * 0.7) * (Math.random() < 0.5 ? 1 : -1);   // everyone has their own "lane" across the sidewalk
  if (r.t <= 6) p.side = Math.abs(p.side);   // keep right
}
function pedPos(p) {
  const a = p.dir > 0 ? p.e.a : p.e.b, b = p.dir > 0 ? p.e.b : p.e.a;
  const ax = NX(a), az = NZ(a), dx = NX(b) - ax, dz = NZ(b) - az, L = p.e.len || 1;
  const ux = dx / L, uz = dz / L;
  // dodge = stepping aside (for you, other people, hydrants…): outward if there's sidewalk left, otherwise toward the curb
  const rr = M.roads[p.e.r], maxS = rr.t <= 6 ? rr.w / 2 + 2.4 : rr.w / 2 + 1.2, sg = p.side >= 0 ? 1 : -1, base = Math.abs(p.side), dg = p.dodge || 0;
  const side = sg * (base + dg <= maxS ? base + dg : Math.max(rr.t <= 6 ? rr.w / 2 + 0.3 : 0, base - dg));
  p.x = ax + ux * p.t - uz * side; p.z = az + uz * p.t + ux * side;
  p.yaw = Math.atan2(-ux, -uz);
}
let player = null;
export function setPlayerRef(pl) { player = pl; }

function spawnPed(px, pz) {
  const cands = roadGrid.near(px, pz, 170, []);
  for (let tries = 0; tries < 12; tries++) {
    const e = cands[Math.floor(Math.random() * cands.length)]; if (!e) return null;
    const r = M.roads[e.r]; if (!isWalkType(r.t) || r.b && Math.random() < 0.7) continue;
    const t = Math.random() * e.len, mx = NX(e.a) + (NX(e.b) - NX(e.a)) * t / e.len, mz = NZ(e.a) + (NZ(e.b) - NZ(e.a)) * t / e.len;
    const d = Math.hypot(mx - px, mz - pz); if (d < 45 || d > 170) continue;
    const p = { cols: newLook(), state: 'walk', kind: 'walk', phase: Math.random() * 6, amp: 0.55, speed: R(1.1, 1.7), timer: 0, visible: true, y: 0, yaw: 0, dirty: true, umb: Math.random() < 0.65 ? 1 + Math.floor(Math.random() * 8) : 0 };
    const roll = Math.random();
    if (roll < 0.05) { p.kind = 'dance'; p.state = 'idle'; p.timer = 1e9; }
    else if (roll < 0.11) { p.jog = true; p.speed = R(2.8, 3.6); p.cols.shirt = pick(['#e53e3e', '#38b2ac', '#ed64a6', '#ecc94b', '#1a202c']); p.cols.pants = '#1a202c'; p.cols.bag = null; p.umb = 0; }
    else if (roll < 0.25) p.phone = true;
    else if (roll < 0.36) p.dog = { x: 0, z: 0, yaw: 0, ph: Math.random() * 6, col: pick(['#8b5a2b', '#1a1a1a', '#d9b36c', '#f2f2f2', '#6b4a2e', '#a0a0a0']), sc: R(0.7, 1.25), init: false };
    else if (roll < 0.43) p.family = true;
    placeOnEdge(p, e, Math.random() < 0.5 ? 1 : -1, t); pedPos(p); p.y = surfaceY(p.x, p.z, 1e9);
    return p;
  }
  return null;
}

function advanceOnGraph(p, dist) {
  p.t += dist;
  let guard = 0;
  while (p.t > p.e.len && guard++ < 5) {
    p.t -= p.e.len;
    const node = p.dir > 0 ? p.e.b : p.e.a;
    const opts = nodeEdges[node].filter(e => e !== p.e && isWalkType(M.roads[e.r].t));
    const ne = opts.length ? opts[Math.floor(Math.random() * opts.length)] : p.e;
    const dir = ne.a === node ? 1 : -1;
    const side = p.side; placeOnEdge(p, ne, dir, p.t);
    if (M.roads[ne.r].t > 6) p.side = (side > 0 ? 1 : -1) * (0.25 + (p.lane || 0) * 0.7);
  }
}

export function say(ent, text, ms = 2600, cls = '') { ent.say = text; ent.sayUntil = performance.now() + ms; ent.sayCls = cls; }

// someone who walks up to a crosswalk at a traffic light, waits at the curb and crosses when the cars have red
export function makeCrosser(c, fromA) {
  let sx = fromA ? c.ax : c.bx, sz = fromA ? c.az : c.bz, ex = fromA ? c.bx : c.ax, ez = fromA ? c.bz : c.az;
  // narrow sidewalk? pull the curb ends in a little
  const mx = (sx + ex) / 2, mz = (sz + ez) / 2;
  for (let k = 0; k < 3 && (buildingAt(sx, sz) || buildingAt(ex, ez)); k++) { sx = mx + (sx - mx) * 0.85; sz = mz + (sz - mz) * 0.85; ex = mx + (ex - mx) * 0.85; ez = mz + (ez - mz) * 0.85; }
  if (buildingAt(sx, sz) || buildingAt(ex, ez) || isWater(sx, sz) || isWater(ex, ez)) return null;
  const p = { cols: newLook(), state: 'xwait', kind: 'walk', phase: Math.random() * 6, amp: 0, speed: R(1.2, 1.6), timer: 0, visible: true, x: sx + R(-0.6, 0.6), z: sz + R(-0.6, 0.6), y: surfaceY(sx, sz, 1e9), yaw: Math.atan2(-(ex - sx), -(ez - sz)), dirty: true, umb: Math.random() < 0.5 ? 1 + Math.floor(Math.random() * 8) : 0, cross: { node: c.node, ns: c.ns, ex, ez } };
  if (Math.random() < 0.2) p.phone = true;
  peds.push(p); return p;
}
function updateCrosser(p, dt) {
  const c = p.cross;
  if (p.state === 'xwait') { p.amp = 0; p.phase += dt * 4; if (signalState(c.node, c.ns) === 'r' && Math.random() < dt * 1.5) p.state = 'xcross'; }
  else {
    const dx = c.ex - p.x, dz = c.ez - p.z, L = Math.hypot(dx, dz);
    if (L < 0.4) {   // made it across: carry on along the sidewalk
      const nr = nearestRoad(p.x, p.z, 30, r => isWalkType(r.t));
      if (nr) { placeOnEdge(p, nr.e, Math.random() < 0.5 ? 1 : -1, nr.t * nr.e.len); p.state = 'walk'; p.cross = null; } else p.x = 1e6;
      return;
    }
    const st = Math.min(L, p.speed * 1.15 * dt); p.x += dx / L * st; p.z += dz / L * st; p.yaw = Math.atan2(-dx, -dz);
    p.phase += dt * p.speed * 4.2; p.amp = 0.55;
  }
  p.y = surfaceY(p.x, p.z, p.y + 0.5);
}
const _occ = new Map();   // who stands in which 1.2 m cell this frame
export function updatePeds(dt, px, pz, py) {
  const target = G.pedTarget ?? 85; _occ.clear();
  for (const p of peds) if (p.state !== 'walk' && p.x < 1e5) _occ.set(Math.floor(p.x / 1.2) * 7919 + Math.floor(p.z / 1.2), p);   // standing / sitting people are obstacles too
  for (let i = peds.length - 1; i >= 0; i--) { const p = peds[i]; if (Math.hypot(p.x - px, p.z - pz) > 230 && !p.keep) peds.splice(i, 1); }
  for (let k = 0; k < 4 && peds.length < target; k++) {
    const p = spawnPed(px, pz); if (!p) continue; peds.push(p);
    if (p.family) { const kid = { ...p, cols: newLook(), sc: R(0.6, 0.72), family: false, dog: null, phone: false, side: p.side + (p.side >= 0 ? 0.55 : -0.55), t: Math.max(0, p.t - 0.5), umb: 0, persona: null, greeted: false }; kid.cols.hat = Math.random() < 0.4 ? pick(['#f6e05e', '#fc8181', '#63b3ed']) : null; peds.push(kid); }
  }
  for (const p of peds) {
    const dP = Math.hypot(p.x - px, p.z - pz);
    p.visible = dP < 200;
    if (p.state === 'xwait' || p.state === 'xcross') { updateCrosser(p, dt); continue; }
    if (p.state === 'down') { p.timer -= dt; p.amp = 0; if (p.timer < 0) { p.state = 'walk'; say(p, pick(OUCH)); } continue; }
    if (p.state === 'flee') {
      p.timer -= dt; const ang = Math.atan2(p.x - px, p.z - pz);
      p.x += Math.sin(ang) * 5.5 * dt; p.z += Math.cos(ang) * 5.5 * dt; p.yaw = Math.atan2(-Math.sin(ang), -Math.cos(ang));
      collideBuildings(p, 0.35); p.y = surfaceY(p.x, p.z, p.y);
      p.phase += dt * 11; p.amp = 0.9;
      if (p.timer < 0) { const nr = nearestRoad(p.x, p.z, 40, r => isWalkType(r.t)); if (nr) { p.state = 'walk'; placeOnEdge(p, nr.e, 1, nr.t * nr.e.len); } else p.timer = 1; }
      continue;
    }
    if (p.state === 'idle' || p.state === 'talk' || p.state === 'greet' || p.state === 'sit' || p.state === 'wait') {
      p.timer -= dt; p.phase += dt * 4; p.amp = 0;
      if (p.state === 'talk' || p.state === 'greet') p.yaw = Math.atan2(-(px - p.x), -(pz - p.z));
      if (p.timer < 0) { if (p.bench) { p.bench.taken = Math.max(0, p.bench.taken - 1); p.bench = null; } p.stop = null; p.state = 'walk'; p.kind = 'walk'; }
      continue;
    }
    if (!p.e) {   // e.g. a street-crosser who got interrupted: find the nearest sidewalk again
      const nr = nearestRoad(p.x, p.z, 40, r => isWalkType(r.t)); p.cross = null;
      if (nr) placeOnEdge(p, nr.e, Math.random() < 0.5 ? 1 : -1, nr.t * nr.e.len); else { p.x = 1e6; continue; }
    }
    if (p.dodge) p.dodge = Math.max(0, p.dodge - dt * 0.6);
    advanceOnGraph(p, p.speed * dt); pedPos(p);
    // step around hydrants, benches, trees, poles… and around other people (instead of walking through them)
    if (dP < 90) {
      let blocked = blockedAt(p.x, p.z, 0.32);
      if (!blocked) { const k = Math.floor(p.x / 1.2) * 7919 + Math.floor(p.z / 1.2); const o = _occ.get(k); if (o && o !== p && Math.hypot(o.x - p.x, o.z - p.z) < 0.65) blocked = true; else _occ.set(k, p); }
      if (blocked) { p.dodge = Math.min(1.6, (p.dodge || 0) + dt * 3.5); pedPos(p); }
    }
    p.y = surfaceY(p.x, p.z, p.y + 0.5);
    if (isWater(p.x, p.z) && p.y < waterLevel(p.x, p.z)) { p.keep = false; p.x = 1e6; }
    p.phase += dt * p.speed * (p.jog ? 2.6 : 4.2); p.amp = p.jog ? 0.95 : 0.55;
    if (Math.random() < dt * 0.01) { p.state = 'idle'; p.timer = R(2, 6); }
  }
  pedCrowd.draw(peds);
  drawDogs(dt, px, pz);
}
export function scarePeds(x, z, rad, hitSpeed = 0, hitRad = 1.4) {
  let hits = 0;
  for (const p of peds) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (hitSpeed > 4 && d < hitRad && p.state !== 'down') { p.state = 'down'; p.timer = 4; hits++; say(p, 'AAAH!'); continue; }
    if (d < rad && p.state === 'walk') { p.state = 'flee'; p.timer = R(2, 4); if (Math.random() < 0.4) say(p, pick(['Whoa!', 'Sorry!', 'Watch out!', 'Eek!', 'Slow down!'])); }
  }
  return hits;
}
export function nearestPed(x, z, rad) { let b = null, bd = rad; for (const p of peds) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd && p.state !== 'down') { bd = d; b = p; } } return b; }
export function talkTo(p) { p.state = 'talk'; p.timer = 3.5; say(p, pick(LINES), 3500); }
export function hitPedsInFront(x, z, yaw, reach = 2.2) {
  let hit = 0; const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  for (const list of [peds, zombies]) for (const p of list) {
    const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz); if (d > reach || p.state === 'down' || p.state === 'dead') continue;
    if ((dx * fx + dz * fz) / (d || 1) < 0.3) continue;
    if (list === zombies) { p.state = 'dead'; p.timer = 3; zstats.kills++; say(p, 'Urrk…', 1200, 'zombie'); hit += 10; }
    else { p.state = 'down'; p.timer = 3.5; say(p, pick(OUCH)); hit += 1; }
  }
  return hit;
}

// ---------- zombies (Fright Nights outbreak at Playland / Hastings Park) ----------
export const ZONE = { x: 5880, z: 80, r: 320 };
export const zstats = { kills: 0 };
export function spawnZombie(x, z) {
  const zb = { cols: newLook('zombie'), state: 'wander', kind: 'zombie', phase: Math.random() * 6, amp: 0.4, speed: R(0.8, 1.4), x, z, y: heightAt(x, z), yaw: Math.random() * 6, timer: R(1, 4), visible: true, dirty: true, hp: 1 };
  zombies.push(zb); return zb;
}
export function updateZombies(dt, pl) {
  const px = pl.x, pz = pl.z;
  const inZone = Math.hypot(px - ZONE.x, pz - ZONE.z) < ZONE.r + 400;
  if (inZone) while (zombies.filter(z => z.state !== 'dead').length < (G.night > 0.5 ? 45 : 28)) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * ZONE.r, x = ZONE.x + Math.cos(a) * r, z = ZONE.z + Math.sin(a) * r;
    if (!isWater(x, z)) spawnZombie(x, z);
  }
  for (let i = zombies.length - 1; i >= 0; i--) {
    const zb = zombies[i];
    const d = Math.hypot(zb.x - px, zb.z - pz);
    zb.visible = d < 220;
    if (zb.state === 'dead') { zb.timer -= dt; zb.amp = 0; if (zb.timer < 0) zombies.splice(i, 1); continue; }
    if (!inZone && !zb.keep) { zombies.splice(i, 1); continue; }
    let tx, tz, sp;
    if (d < 32 && !pl.flying) { tx = px; tz = pz; sp = (G.night > 0.5 ? 3.4 : 2.3); if (Math.random() < dt * 0.15) say(zb, pick(ZLINES), 2200, 'zombie'); }
    else {
      zb.timer -= dt; if (zb.timer < 0) { zb.timer = R(2, 6); zb.wx = zb.x + R(-20, 20); zb.wz = zb.z + R(-20, 20); }
      if (Math.hypot(zb.x - ZONE.x, zb.z - ZONE.z) > ZONE.r && !zb.keep) { zb.wx = ZONE.x; zb.wz = ZONE.z; }
      tx = zb.wx ?? zb.x; tz = zb.wz ?? zb.z; sp = zb.speed;
    }
    const ang = Math.atan2(tx - zb.x, tz - zb.z), dd = Math.hypot(tx - zb.x, tz - zb.z);
    if (dd > 1.0) { zb.x += Math.sin(ang) * sp * dt; zb.z += Math.cos(ang) * sp * dt; zb.yaw = Math.atan2(-Math.sin(ang), -Math.cos(ang)); zb.phase += dt * sp * 3.4; }
    collideBuildings(zb, 0.35); zb.y = surfaceY(zb.x, zb.z, zb.y + 0.5);
    if (d < 1.2 && !pl.vehicle) pl.hurt(9 * dt, 'zombie');
    if (pl.vehicle && pl.vehicle.speedAbs > 5 && d < 2.2) { zb.state = 'dead'; zb.timer = 3; zstats.kills++; say(zb, 'Splat!', 1000, 'zombie'); }
  }
  zombieCrowd.draw(zombies);
}

// ---------- speech bubbles ----------
const bubbleEls = [];
const _v = new THREE.Vector3();
export function updateBubbles(extra = []) {
  const now = performance.now(), root = document.getElementById('bubbles');
  const talkers = [...peds, ...zombies, ...extra].filter(p => p.say && p.sayUntil > now && p.visible !== false);
  while (bubbleEls.length < talkers.length) { const d = document.createElement('div'); d.className = 'bubble'; root.appendChild(d); bubbleEls.push(d); }
  bubbleEls.forEach((el, i) => {
    const p = talkers[i]; if (!p) { el.style.display = 'none'; return; }
    _v.set(p.x, p.y + 2.25, p.z).project(camera);
    if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1 || Math.hypot(p.x - camera.position.x, p.z - camera.position.z) > 60) { el.style.display = 'none'; return; }
    el.style.display = 'block'; el.textContent = p.say; el.className = 'bubble ' + (p.sayCls || '');
    el.style.left = ((_v.x + 1) / 2 * innerWidth) + 'px'; el.style.top = ((1 - _v.y) / 2 * innerHeight) + 'px';
  });
}

// ---------- dogs (walked by people) ----------
const DOGS = 60; let dogBody, dogHead, dogTail;
const _dm = new THREE.Matrix4(), _dq = new THREE.Quaternion(), _dv = new THREE.Vector3(), _ds = new THREE.Vector3(), _dc = new THREE.Color();
export const dogs = [];
function drawDogs(dt, px, pz) {
  let n = 0; dogs.length = 0;
  for (const p of peds) {
    const d = p.dog; if (!d || !p.visible || n >= DOGS) continue;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), tx = p.x - fx * 0.4 + fz * 0.7, tz = p.z - fz * 0.4 - fx * 0.7;   // trots just ahead of the owner, on the leash side
    if (!d.init) { d.x = tx; d.z = tz; d.init = true; }
    const dx = tx - d.x, dz = tz - d.z, dist = Math.hypot(dx, dz), moving = dist > 0.15;
    if (moving) { const k = Math.min(1, dt * 4); d.x += dx * k; d.z += dz * k; d.yaw = Math.atan2(-dx, -dz); }
    d.ph += dt * (moving ? 14 : 2); const y = surfaceY(d.x, d.z, p.y + 1) + Math.abs(Math.sin(d.ph)) * (moving ? 0.05 : 0), s = d.sc;
    _dq.setFromAxisAngle(_dv.set(0, 1, 0), d.yaw); _ds.setScalar(s);
    _dm.compose(_dv.set(d.x, y, d.z), _dq, _ds); dogBody.setMatrixAt(n, _dm);
    // trotting legs: diagonal pairs swing together (front-left with back-right) — drawn as front pair and back pair swinging opposite
    const sw = moving ? Math.sin(d.ph) * 0.55 : 0, fx2 = -Math.sin(d.yaw), fz2 = -Math.cos(d.yaw);
    for (const [m, off, sg] of [[dogLegsF, -0.17, 1], [dogLegsB, 0.17, -1]]) { _de.set(sw * sg, d.yaw, 0, 'YXZ'); _dq2.setFromEuler(_de); _dm.compose(_dv.set(d.x - fx2 * off * s, y + 0.3 * s, d.z - fz2 * off * s), _dq2, _ds); m.setMatrixAt(n, _dm); }
    _de.set(moving ? Math.sin(d.ph * 2) * 0.05 : Math.sin(d.ph * 0.7) * 0.15 - 0.1, d.yaw + (moving ? 0 : Math.sin(d.ph * 0.3) * 0.5), 0, 'YXZ'); _dq2.setFromEuler(_de);
    _dm.compose(_dv.set(d.x - Math.sin(d.yaw) * 0.32 * s, y, d.z - Math.cos(d.yaw) * 0.32 * s), _dq2, _ds); dogHead.setMatrixAt(n, _dm);
    _dq.setFromAxisAngle(_dv.set(0, 1, 0), d.yaw + Math.sin(d.ph * (moving ? 1.5 : 6)) * 0.5); _dm.compose(_dv.set(d.x + Math.sin(d.yaw) * 0.3 * s, y, d.z + Math.cos(d.yaw) * 0.3 * s), _dq, _ds); dogTail.setMatrixAt(n, _dm);
    for (const m of [dogBody, dogHead, dogTail, dogLegsF, dogLegsB]) m.setColorAt(n, _dc.set(d.col));
    dogs.push({ x: d.x, y, z: d.z, owner: p }); n++;
    // dogs notice you
    const dp = Math.hypot(d.x - px, d.z - pz);
    if (dp < 5 && !d.barked && player && !player.vehicle) { d.barked = true; if (Math.random() < 0.6) say(p, pick(['🐕 Woof! …He\'s friendly!', '🐕 Arf arf! Sorry, she loves people.', '🐶 Can he say hi? He\'s a good boy.', '🐕 *sniff sniff* He likes you!'])); }
  }
  for (const m of [dogBody, dogHead, dogTail, dogLegsF, dogLegsB]) { m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
}
let dogLegsF, dogLegsB; const _dq2 = new THREE.Quaternion(), _de = new THREE.Euler();
function makeDogMeshes() {
  // rounded fur body, a head with snout, black nose, eyes and floppy ears, a red collar, a tapered tail; fur parts ('F') take the dog's colour
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }); mat.onBeforeCompile = tintShader; mat.customProgramCacheKey = () => 'dogTint';
  const mk = geo => { const m = new THREE.InstancedMesh(geo, mat, DOGS); m.count = 0; m.frustumCulled = false; m.castShadow = true; m.setColorAt(0, new THREE.Color()); scene.add(m); return m; };
  dogBody = mk(bake([[SP, 'F', 0, 0.33, 0, 0.11, 0.11, 0.2], [SP, 'F', 0, 0.345, -0.15, 0.115, 0.125, 0.12], [SP, 'F', 0, 0.34, 0.15, 0.105, 0.11, 0.11], [SP, 'F1.2', 0, 0.28, -0.03, 0.085, 0.07, 0.17]]));
  dogHead = mk(bake([[SP, 'F', 0, 0.42, 0.06, 0.065, 0.085, 0.075, 0.5], [SP, 'F', 0, 0.475, -0.04, 0.072, 0.068, 0.08], [SP, 'F1.1', 0, 0.445, -0.125, 0.04, 0.034, 0.062], [SPs, '#111111', 0, 0.452, -0.185, 0.019, 0.016, 0.014],
    [SPs, '#0e0c0a', -0.035, 0.49, -0.1, 0.011, 0.011, 0.008], [SPs, '#0e0c0a', 0.035, 0.49, -0.1, 0.011, 0.011, 0.008], [SP, 'F0.75', -0.065, 0.47, -0.02, 0.018, 0.058, 0.036, 0, 0, 0.35], [SP, 'F0.75', 0.065, 0.47, -0.02, 0.018, 0.058, 0.036, 0, 0, -0.35],
    [new THREE.TorusGeometry(0.06, 0.012, 6, 14).rotateX(Math.PI / 2 - 0.5), '#c53030', 0, 0.405, 0.07], [SPs, '#f2c230', 0, 0.37, 0.025, 0.012, 0.012, 0.006]]));
  dogTail = mk(bake([[new THREE.CylinderGeometry(0.012, 0.026, 0.22, 8).rotateX(-0.7).translate(0, 0.43, 0.07), 'F']]));
  const legs = z => bake([-0.06, 0.06].flatMap(x => [[SP, 'F', x, -0.03, z, 0.04, 0.06, 0.045], [new THREE.CylinderGeometry(0.026, 0.02, 0.26, 8).translate(x, -0.15, z), 'F'], [SP, 'F0.9', x, -0.285, z - 0.015, 0.025, 0.016, 0.034]]));
  dogLegsF = mk(legs(0)); dogLegsB = mk(legs(0));
}
export function initPeople() { makeDogMeshes(); pedCrowd = new Crowd(110, true); zombieCrowd = new Crowd(60); }
