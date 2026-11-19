// Tricks & stunts: one scoring system for everything that leaves the ground. Spins (A/D in the air) and flips
// (W/S in the air) on bikes, scooters, skateboards, motorbikes, snowboards and skis; airtime + distance for car
// jumps off the ramps scattered around the city. Land it clean = cash + a trick name. Land it sideways = bail.
// Plus the ramps themselves.
import * as THREE from 'three';
import { G, scene, std, addMesh, toXZ, R, pick, wrapAngle, canvasTex, hash2 } from './core.js';
import { heightAt, isWater, maskAt } from './terrain.js';
import { addDeck, buildingAt, nearestRoad } from './city.js';
import { ui } from './ui.js';
import { sfx } from './sound.js';

export const trickStats = { best: 0, total: 0, combo: 0 };
let discoverFn = null; export function setDiscover(fn) { discoverFn = fn; }
// call when leaving the ground
export function takeoff(o, x, z) { o.air = { t: 0, spin: 0, flip: 0, x, z, lastYaw: o.yaw ?? 0 }; }
// call every frame in the air: steer = -1..1 (spin), pitch = -1..1 (flip)
export function airControl(o, dt, steer, pitch, spinRate = 7, flipRate = 6.5) {
  const a = o.air; if (!a) return; a.t += dt;
  const k = Math.min(1, Math.max(0, (a.t - 0.12) / 0.25));   // spins/flips build up only once you're properly airborne (a bump while turning isn't a trick)
  let dy = steer * spinRate * k * dt;
  // landing assist (like skate/BMX games): let go of the keys and the rider straightens up on its own, to the nearest
  // clean half-spin and whole flip, so a sloppy-but-honest landing rides away instead of bailing
  if (!steer && a.t > 0.25) { const target = Math.round(a.spin / Math.PI) * Math.PI, off = target - a.spin; dy += Math.sign(off) * Math.min(Math.abs(off), 3.2 * dt); }
  o.yaw += dy; a.spin += dy;
  a.flip += pitch * flipRate * k * dt;
  if (!pitch && a.t > 0.25) { const target = Math.round(a.flip / (Math.PI * 2)) * Math.PI * 2, off = target - a.flip; a.flip += Math.sign(off) * Math.min(Math.abs(off), 3.6 * dt); }
}
// call when touching down again: returns 'ok' / 'bail' / null (nothing special)
export function land(o, x, z, kind, pl) {
  const a = o.air; o.air = null; if (!a) return null;
  const spins = Math.round(Math.abs(a.spin) / (Math.PI * 2) * 2) / 2, flips = Math.round(Math.abs(a.flip) / (Math.PI * 2));
  const flipOff = Math.abs(wrapAngle(a.flip)), spinOff = Math.abs(wrapAngle(a.spin * 2) / 2);   // half spins (180s) land "fakie" fine
  const dist = Math.hypot(x - a.x, z - a.z);
  if (a.t < 0.45) return null;   // a tiny hop over a bump or curb never throws you off
  // only a genuinely bad landing bails: more than ~60° sideways, or landing on your back/face (> ~65° off a flip)
  if (flipOff > 1.15 || spinOff > 1.05) { ui.toast('💥 BAIL!', pick(['Ate it. Hard.', 'That looked expensive.', 'The crowd goes "ooooh".', 'Your mom would not approve.']), 2000); sfx.bump?.(); trickStats.combo = 0; return 'bail'; }
  const names = [];
  if (spins >= 0.5) names.push(spins === 0.5 ? '180' : (spins * 360) + '');
  if (flips) names.push((flips > 1 ? flips + 'x ' : '') + (a.flip < 0 ? 'Backflip' : 'Frontflip'));
  const big = kind === 'car' ? a.t > 0.6 || dist > 15 : a.t > 1.1;
  if (!names.length && !big) return null;
  const pts = Math.round(spins * 40 + flips * 120 + a.t * 30 + dist * 2);
  if (!names.length) names.push(kind === 'car' ? 'Stunt jump' : 'Big air');
  trickStats.combo++; const mult = Math.min(4, trickStats.combo);
  const cash = Math.round(pts / 10) * mult;
  pl.money += cash; trickStats.total += pts * mult; trickStats.best = Math.max(trickStats.best, pts * mult); pl.stats.tricks = (pl.stats.tricks || 0) + 1;
  ui.toast(`🤘 ${names.join(' + ')}!`, `${a.t.toFixed(1)} s air · ${Math.round(dist)} m${mult > 1 ? ` · combo x${mult}` : ''} · +$${cash}`, 2600); sfx.coin?.();
  if (kind === 'car' && (a.t > 1.2 || dist > 25)) discoverFn?.('stuntjump');
  if (flips >= 1 && kind !== 'car') discoverFn?.('flip');
  return 'ok';
}
export function resetCombo() { trickStats.combo = 0; }

// ---------- ramps: wooden kickers around the city (parks, parking lots, a few by the beaches) ----------
export const ramps = [];
const rampMat = (() => { const t = canvasTex(256, 256, (c, w, h) => { c.fillStyle = '#c9a26a'; c.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 20) { c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(0, y, w, 2); } c.fillStyle = '#f6c343'; for (let x = -h; x < w; x += 48) { c.beginPath(); c.moveTo(x, h); c.lineTo(x + 24, h); c.lineTo(x + 24 + 30, h - 30); c.lineTo(x + 30, h - 30); c.fill(); } }); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.8 }); })();
function rampGeo(L, W, H) {
  const g = new THREE.BufferGeometry(), v = [-W / 2, 0, 0, W / 2, 0, 0, W / 2, H, -L, -W / 2, H, -L, -W / 2, 0, -L, W / 2, 0, -L];
  const idx = [0, 1, 2, 0, 2, 3, 3, 2, 5, 3, 5, 4, 0, 3, 4, 1, 5, 2];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1], 2)); g.setIndex(idx); g.computeVertexNormals(); return g;
}
function placeRamp(x, z, yaw, L = 11, W = 5, H = 2.6) {
  const y = heightAt(x, z), fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const m = new THREE.Mesh(rampGeo(L, W, H), rampMat); m.position.set(x, y, z); m.rotation.y = yaw; m.castShadow = true; m.receiveShadow = true; scene.add(m);
  addDeck(x, z, y, x + fx * L, z + fz * L, y + H, W / 2);
  ramps.push({ x, z, yaw, L, m });
}
export function initRamps() {
  // parks with room for a run-up, all over Vancouver + the North Shore + Richmond; plus some fixed fun spots
  const cands = [];
  for (const a of window.MAP.areas) {
    if (!['park', 'grass', 'pitch'].includes(a.k) || a.line) continue;
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let i = 0; i < a.p.length; i += 2) { x0 = Math.min(x0, a.p[i]); x1 = Math.max(x1, a.p[i]); z0 = Math.min(z0, a.p[i + 1]); z1 = Math.max(z1, a.p[i + 1]); }
    const w = x1 - x0, h = z1 - z0; if (w < 70 || h < 70 || w * h > 600000) continue;
    cands.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, yaw: w > h ? Math.PI / 2 : 0, k: hash2(x0, z0) });
  }
  cands.sort((a, b) => a.k - b.k);
  for (const c of cands) { if (ramps.length >= 40) break; if (ramps.some(r => Math.hypot(r.x - c.x, r.z - c.z) < 900) || buildingAt(c.x, c.z) || isWater(c.x, c.z)) continue; placeRamp(c.x, c.z, c.yaw); }
  // a famous few
  for (const [la, lo, yaw] of [[49.2735, -123.1525, 0.3], [49.3012, -123.1365, 1.2], [49.2690, -123.0690, 0]]) { const [x, z] = toXZ(la, lo); if (!buildingAt(x, z) && !isWater(x, z)) placeRamp(x, z, yaw, 13, 6, 3.2); }
}
export const rampMarkers = () => ramps.map(r => ({ x: r.x, z: r.z, icon: '🛹' }));
