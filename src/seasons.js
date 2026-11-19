// Seasons: spring cherry blossoms, summer fireworks, fall colours + pumpkins, winter snow + Christmas at Robson Square.
import * as THREE from 'three';
import { G, scene, std, addMesh, toXZ, R, pick, canvasTex } from './core.js';
import { heightAt, isWater, SNOW_U, snowLine, recolorTrees, cherryTrees } from './terrain.js';
import { surfaceY, buildingAt } from './city.js';
import { sfx, beep } from './sound.js';
import { ui } from './ui.js';

export const SEASONS = {
  spring: { name: 'Spring', icon: '🌸', rise: 6.3, len: 13.3, peak: 50, snow: 950, city: 0 },
  summer: { name: 'Summer', icon: '☀️', rise: 5.2, len: 16.0, peak: 62, snow: 1750, city: 0 },
  fall:   { name: 'Fall', icon: '🍂', rise: 7.1, len: 10.9, peak: 36, snow: 1350, city: 0 },
  winter: { name: 'Winter', icon: '❄️', rise: 8.0, len: 8.4, peak: 18, snow: 380, city: 1 },
};
const ORDER = ['spring', 'summer', 'fall', 'winter'];
export const S = { auto: true, days: 0, lastHour: 0 };
export const seasonProps = { winter: [], fall: [], summer: [], spring: [] };
export const EVENT_SPOTS = {};

// start in the same season as the real world
function realSeason() { const m = new Date().getMonth(); return m <= 1 || m === 11 ? 'winter' : m <= 4 ? 'spring' : m <= 7 ? 'summer' : 'fall'; }

export function setSeason(s, { quiet = false, manual = false } = {}) {
  if (!SEASONS[s]) return;
  if (manual) S.auto = false;
  const P = SEASONS[s];
  // the calendar date drives the real sun/moon/star positions (core.js): today's date in the real season, otherwise mid-season
  const today = Math.floor((Date.now() - Date.UTC(new Date().getFullYear(), 0, 1)) / 864e5) + 1;
  G.doy = s === realSeason() ? today : { spring: 110, summer: 201, fall: 293, winter: 20 }[s];
  G.season = s; G.sunRise = P.rise; G.dayLen = P.len; G.sunPeak = P.peak; G.snowLine = P.snow;
  SNOW_U.city.value = P.city;
  recolorTrees();
  for (const [k, list] of Object.entries(seasonProps)) for (const o of list) o.visible = k === s;
  if (!quiet) ui.toast(P.icon + ' ' + P.name + ' in Vancouver', {
    spring: 'Cherry blossoms everywhere. Everyone is taking the same photo.',
    summer: 'Long sunny days, beaches packed, fireworks over English Bay at night!',
    fall: 'Orange leaves, rain, pumpkin spice everything. Fright Nights at Playland!',
    winter: 'Snow! The city panics. The mountains rejoice. Skate at Robson Square.',
  }[s], 4000);
}
export const nextSeason = () => ORDER[(ORDER.indexOf(G.season) + 1) % 4];

// ---------- seasonal props ----------
// find open ground (no buildings / water within 'clear' metres) near a real-world spot
function openAt(lat, lon, clear = 8) {
  const [x0, z0] = toXZ(lat, lon);
  const free = (x, z) => { if (isWater(x, z)) return false; for (let a = 0; a < 6.28; a += 0.8) if (buildingAt(x + Math.cos(a) * clear, z + Math.sin(a) * clear)) return false; return !buildingAt(x, z); };
  for (let r = 0; r < 200; r += 3) for (let a = 0; a < 6.28; a += 0.25) { const x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r; if (free(x, z)) return { x, z, y: surfaceY(x, z, 1e9) }; }
  return { x: x0, z: z0, y: surfaceY(x0, z0, 1e9) };
}
const at = (lat, lon) => { const [x, z] = toXZ(lat, lon); return { x, z, y: surfaceY(x, z, 1e9) }; };
let lights = null, fireworks = [];
function buildProps() {
  // WINTER: Christmas tree + ice rink at Robson Square / Vancouver Art Gallery
  { const p = openAt(49.2834, -123.1208, 7); EVENT_SPOTS.xmastree = { ...p, name: 'Robson Square Christmas tree' };
    const g = new THREE.Group(); g.position.set(p.x, p.y, p.z); scene.add(g); seasonProps.winter.push(g);
    addMesh(new THREE.CylinderGeometry(0.6, 0.8, 3), std('#5a4030'), 0, 1.5, 0, g);
    for (let i = 0; i < 4; i++) addMesh(new THREE.ConeGeometry(6 - i * 1.3, 6, 12), std('#1f4d2c', { flatShading: true }), 0, 4 + i * 3.6, 0, g);
    addMesh(new THREE.OctahedronGeometry(1.1), new THREE.MeshStandardMaterial({ color: '#ffd700', emissive: '#ffb000', emissiveIntensity: 1.5 }), 0, 19.5, 0, g);
    const n = 160; lights = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 6, 4), new THREE.MeshBasicMaterial(), n); const o = new THREE.Object3D(), c = new THREE.Color();
    for (let i = 0; i < n; i++) { const t = i / n, a = t * 40, y = 3 + t * 15.5, r = (1 - t) * 5.6 + 0.4; o.position.set(Math.cos(a) * r, y, Math.sin(a) * r); o.updateMatrix(); lights.setMatrixAt(i, o.matrix); lights.setColorAt(i, c.set(['#ff3b30', '#ffd60a', '#30d158', '#0a84ff', '#ffffff'][i % 5])); }
    g.add(lights);
    const rink = openAt(49.2820, -123.1215, 17); EVENT_SPOTS.rink = { ...rink, name: 'Robson Square ice rink' };
    const ice = addMesh(new THREE.CylinderGeometry(16, 16, 0.25, 40), std('#dff3ff', { roughness: 0.05, metalness: 0.2 }), rink.x, rink.y + 0.15, rink.z); seasonProps.winter.push(ice);
    const wall = addMesh(new THREE.TorusGeometry(16.2, 0.35, 6, 48).rotateX(Math.PI / 2), std('#ffffff'), rink.x, rink.y + 0.5, rink.z); seasonProps.winter.push(wall);
  }
  // FALL: pumpkins on porches + a giant pumpkin at Granville Island
  { const M = window.MAP, houses = M.blds.filter(b => b.t === 1).filter((_, i) => i % 37 === 0).slice(0, 220);
    const pm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 10, 8).scale(1, 0.8, 1), std('#e8701a', { roughness: 0.7 }), houses.length), o = new THREE.Object3D();
    houses.forEach((b, i) => { const x = b.p[0] + 1.2, z = b.p[1] + 1.2; o.position.set(x, heightAt(x, z) + 0.3, z); o.updateMatrix(); pm.setMatrixAt(i, o.matrix); });
    pm.castShadow = true; pm.computeBoundingSphere(); scene.add(pm); seasonProps.fall.push(pm);
    const p = openAt(49.2716, -123.1346, 4); EVENT_SPOTS.pumpkin = { ...p, name: 'Giant pumpkin' };
    const g = new THREE.Group(); g.position.set(p.x, p.y, p.z); scene.add(g); seasonProps.fall.push(g);
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; addMesh(new THREE.SphereGeometry(2.2, 14, 10).scale(0.7, 1, 1), std('#e8701a', { roughness: 0.6 }), Math.cos(a) * 1.1, 2, Math.sin(a) * 1.1, g).rotation.y = -a; }
    addMesh(new THREE.CylinderGeometry(0.3, 0.4, 1.2), std('#4a6b2a'), 0, 4.4, 0, g);
    const face = new THREE.MeshBasicMaterial({ color: '#ffcc33' });
    for (const s of [-1, 1]) addMesh(new THREE.ConeGeometry(0.4, 0.5, 3).rotateX(Math.PI / 2), face, s * 0.8, 2.6, -2.5, g, false);
    addMesh(new THREE.BoxGeometry(1.8, 0.3, 0.2), face, 0, 1.6, -2.6, g, false);
  }
  // SUMMER: Celebration of Light fireworks over English Bay
  { const [x, z] = toXZ(49.2840, -123.1530); EVENT_SPOTS.fireworks = { x, z, y: 0, name: 'Celebration of Light' };
    for (let k = 0; k < 6; k++) {
      const N = 140, pos = new Float32Array(N * 3), geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 4, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, color: '#fff' }));
      pts.frustumCulled = false; pts.visible = false; scene.add(pts);
      fireworks.push({ pts, pos, vel: new Float32Array(N * 3), t: -R(0, 3), N });
    }
  }
}
function launch(f) {
  const c = EVENT_SPOTS.fireworks, x = c.x + R(-250, 250), z = c.z + R(-150, 150), y = R(180, 320);
  for (let i = 0; i < f.N; i++) { f.pos[i * 3] = x; f.pos[i * 3 + 1] = y; f.pos[i * 3 + 2] = z; const a = Math.random() * 6.28, b = Math.acos(R(-1, 1)), s = R(30, 45); f.vel[i * 3] = Math.sin(b) * Math.cos(a) * s; f.vel[i * 3 + 1] = Math.cos(b) * s; f.vel[i * 3 + 2] = Math.sin(b) * Math.sin(a) * s; }
  f.pts.material.color.set(pick(['#ff3b30', '#ffd60a', '#30d158', '#0a84ff', '#ff2d55', '#bf5af2', '#ffffff'])); f.pts.visible = true; f.t = 0; f.boom = false;
}

export function initSeasons() { buildProps(); setSeason(realSeason(), { quiet: true }); S.lastHour = G.hour; }

let lastOverride = null;
export function updateSeasons(dt, pl) {
  // a new day every time the clock passes midnight; seasons change every 2 days when on Auto
  if (S.lastHour > 20 && G.hour < 4) { S.days++; G.doy = (G.doy ?? 200) % 365 + 1; if (S.auto && S.days % 2 === 0) setSeason(nextSeason()); }
  S.lastHour = G.hour;
  // ski missions turn on the snow cannons if it's not snowy enough
  SNOW_U.line.value = snowLine();
  if (G.snowLineOverride !== lastOverride) { if (G.snowLineOverride && G.snowLineOverride < (G.snowLine ?? 930)) ui.toast('❄️ Snow cannons on!', 'The ski hill is making snow just for you.', 2500); lastOverride = G.snowLineOverride; }
  // twinkling Christmas lights
  if (lights && G.season === 'winter') { lights.material.color.setScalar(0.6 + 0.4 * Math.sin(G.t * 3)); }
  // fireworks: summer nights, close enough to see them
  const show = G.season === 'summer' && G.night > 0.6 && Math.hypot(pl.x - EVENT_SPOTS.fireworks.x, pl.z - EVENT_SPOTS.fireworks.z) < 6000;
  for (const f of fireworks) {
    if (!show) { f.pts.visible = false; continue; }
    f.t += dt;
    if (f.t > 3.2) launch(f);
    if (f.t < 0 || !f.pts.visible) continue;
    for (let i = 0; i < f.N; i++) { f.vel[i * 3 + 1] -= 9 * dt; for (let k = 0; k < 3; k++) { f.vel[i * 3 + k] *= 1 - dt * 0.9; f.pos[i * 3 + k] += f.vel[i * 3 + k] * dt; } }
    f.pts.geometry.attributes.position.needsUpdate = true;
    f.pts.material.opacity = Math.max(0, 1 - f.t / 3); f.pts.material.size = 4 + f.t * 2;
    if (!f.boom && Math.hypot(pl.x - EVENT_SPOTS.fireworks.x, pl.z - EVENT_SPOTS.fireworks.z) < 2500) { f.boom = true; setTimeout(() => sfx.bump(), 1500); }
  }
  G.fireworksOn = show;
}
export const nearCherry = (x, z) => cherryTrees.some(t => Math.abs(t.x - x) < 6 && Math.abs(t.z - z) < 6);
