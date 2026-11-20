// Hiking trails, the real ones: every named trail (Grouse Grind, BCMC, Baden-Powell, Lynn Loop, Pacific Spirit trails…)
//  - a wooden trailhead sign where it starts: name, length, elevation gain and difficulty (from OSM sac_scale, or the
//    steepness when the map doesn't say)
//  - orange trail markers on posts along it, so you can follow it through the forest
//  - hikers with backpacks walking it on dry days
//  - the Grouse Grind is a timed challenge: E at the bottom starts the clock, the top stops it
import * as THREE from 'three';
import { G, scene, std, canvasTex, tapped, pick, R } from './core.js';
import { groundY, heightAt, isSnow } from './terrain.js';
import { edges, nodeEdges, NX, NZ, roadName } from './city.js';
import { Crowd, newLook } from './people.js';
import { activeMission, discover } from './missions.js';
import { ui } from './ui.js';
import { sfx } from './sound.js';

const M = window.MAP;
export const trails = [];   // {name, edges: [edge], len, gain, diff, head: {x, z, node}, top: {x, z, node}}
const DIFF = [['Easy', '#2f9e44'], ['Easy', '#2f9e44'], ['Intermediate', '#1c6dd0'], ['Difficult', '#111111'], ['Very difficult', '#c92a2a'], ['Expert only', '#c92a2a'], ['Expert only', '#c92a2a']];
let pl = null;

export function initTrails(player) {
  pl = player;
  const by = new Map();
  for (const e of edges) { const r = M.roads[e.r]; if (r.t < 7 || r.t === 8 || r.b) continue; const n = roadName(r); if (!n || /sidewalk|seawall|crosswalk/i.test(n)) continue; if (!by.has(n)) by.set(n, []); by.get(n).push(e); }
  for (const [name, es] of by) {
    let len = 0, sc = 0; const deg = new Map();
    for (const e of es) { len += e.len; sc = Math.max(sc, M.roads[e.r].sc || 0); deg.set(e.a, (deg.get(e.a) || 0) + 1); deg.set(e.b, (deg.get(e.b) || 0) + 1); }
    if (len < 400) continue;   // little park paths aren't "trails"
    // ends of the trail = nodes used once; the trailhead is the lowest end that touches a street (or just the lowest end)
    const ends = [...deg].filter(([, d]) => d === 1).map(([n]) => n); if (!ends.length) ends.push(es[0].a);
    const hOf = n => heightAt(NX(n), NZ(n)), onStreet = n => nodeEdges[n].some(q => M.roads[q.r].t <= 6);
    ends.sort((a, b) => hOf(a) - hOf(b));
    const head = ends.find(onStreet) ?? ends[0], top = [...deg.keys()].reduce((a, b) => hOf(b) > hOf(a) ? b : a, head);
    const gain = Math.max(0, hOf(top) - hOf(head));
    const steep = gain / len > 0.3 ? 4 : gain / len > 0.15 ? 3 : gain / len > 0.06 ? 2 : 1, diff = Math.max(sc, steep);   // whichever is harder: the map's rating or the real steepness
    trails.push({ name, edges: es, len, gain, diff, head: { x: NX(head), z: NZ(head), node: head }, top: { x: NX(top), z: NZ(top), node: top } });
  }
  hikersCrowd = new Crowd(MAXH);
  markerIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.16, 0.02).rotateZ(Math.PI / 4).translate(0, 1.35, 0), new THREE.MeshStandardMaterial({ color: '#ff7a1a', emissive: '#ff7a1a', emissiveIntensity: 0.25 }), 600);
  postIM = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.05, 0.06, 1.5, 6).translate(0, 0.75, 0), std('#5a4330'), 600);
  for (const m of [markerIM, postIM]) { m.count = 0; m.frustumCulled = false; m.castShadow = true; scene.add(m); }
}

// ---------- trailhead signs (near you; textures cached) ----------
const signs = new Map(), texCache = new Map(), postGeo = new THREE.BoxGeometry(0.12, 2.4, 0.12), boardGeo = new THREE.BoxGeometry(1.6, 1.0, 0.08), roofGeo = new THREE.BoxGeometry(1.9, 0.1, 0.5);
function signTex(t) {
  if (texCache.has(t.name)) return texCache.get(t.name);
  const [label, col] = DIFF[t.diff] || DIFF[2];
  const tex = canvasTex(320, 200, (c, w, h) => {
    c.fillStyle = '#5c3d23'; c.fillRect(0, 0, w, h); c.fillStyle = '#e9dcc0'; c.fillRect(10, 10, w - 20, h - 20);
    c.fillStyle = '#2a2016'; c.textAlign = 'center'; c.font = 'bold 30px Georgia, serif'; c.fillText(t.name, w / 2, 52, w - 30);
    c.font = '22px Segoe UI, Arial'; c.fillText(`${(t.len / 1000).toFixed(1)} km  ·  ↑ ${Math.round(t.gain)} m`, w / 2, 98);
    c.fillStyle = col; c.fillRect(40, 122, w - 80, 44); c.fillStyle = '#fff'; c.font = 'bold 24px Segoe UI, Arial'; c.fillText(label.toUpperCase(), w / 2, 153);
  }, false);
  texCache.set(t.name, tex); return tex;
}
let signAt = null;
function updateSigns(px, pz) {
  if (signAt && Math.hypot(px - signAt[0], pz - signAt[1]) < 120) return; signAt = [px, pz];
  for (const [t, g] of signs) if (Math.hypot(t.head.x - px, t.head.z - pz) > 800) { scene.remove(g); signs.delete(t); }
  for (const t of trails) {
    if (signs.has(t) || Math.hypot(t.head.x - px, t.head.z - pz) > 650) continue;
    const e = nodeEdges[t.head.node].find(q => t.edges.includes(q)) || t.edges[0], o = e.a === t.head.node ? e.b : e.a, dx = NX(o) - t.head.x, dz = NZ(o) - t.head.z, L = Math.hypot(dx, dz) || 1;
    const sx = t.head.x + dx / L * 3 - dz / L * 2.2, sz = t.head.z + dz / L * 3 + dx / L * 2.2, y = groundY(sx, sz), g = new THREE.Group(); g.position.set(sx, y, sz); g.rotation.y = Math.atan2(-dz, dx);
    const wood = std('#5c3d23'); for (const s of [-0.72, 0.72]) { const p = new THREE.Mesh(postGeo, wood); p.position.set(s, 1.2, 0); g.add(p); }
    const b = new THREE.Mesh(boardGeo, [wood, wood, wood, wood, new THREE.MeshStandardMaterial({ map: signTex(t), roughness: 0.9 }), new THREE.MeshStandardMaterial({ map: signTex(t), roughness: 0.9 })]); b.position.y = 1.75; g.add(b);
    const rf = new THREE.Mesh(roofGeo, std('#3a2a1c')); rf.position.y = 2.32; g.add(rf);
    g.traverse(o => { if (o.isMesh) o.castShadow = true; }); scene.add(g); signs.set(t, g);
  }
}

// ---------- orange markers along the trails near you ----------
let markerIM = null, postIM = null, markAt = null;
const _o = new THREE.Object3D();
function updateMarkers(px, pz) {
  if (markAt && Math.hypot(px - markAt[0], pz - markAt[1]) < 90) return; markAt = [px, pz];
  let n = 0;
  for (const t of trails) for (const e of t.edges) {
    if (n >= 600) break;
    const ax = NX(e.a), az = NZ(e.a), bx = NX(e.b), bz = NZ(e.b); if (Math.hypot((ax + bx) / 2 - px, (az + bz) / 2 - pz) > 320) continue;
    const L = e.len; for (let s = (e.id % 7) * 11; s < L && n < 600; s += 80) {
      const f = s / L, ux = (bx - ax) / L, uz = (bz - az) / L, x = ax + (bx - ax) * f - uz * 1.4, z = az + (bz - az) * f + ux * 1.4, y = groundY(x, z);
      _o.position.set(x, y, z); _o.rotation.set(0, Math.atan2(ux, uz), 0); _o.scale.set(1, 1, 1); _o.updateMatrix(); markerIM.setMatrixAt(n, _o.matrix); postIM.setMatrixAt(n, _o.matrix); n++;
    }
  }
  markerIM.count = postIM.count = n; markerIM.instanceMatrix.needsUpdate = postIM.instanceMatrix.needsUpdate = true;
}

// ---------- hikers ----------
const MAXH = 16; let hikersCrowd = null; const hikers = [];
function spawnHiker(px, pz) {
  const near = trails.filter(t => t.edges.some((e, i) => i % 3 === 0 && Math.hypot(NX(e.a) - px, NZ(e.a) - pz) < 420)); if (!near.length) return null;
  const t = near[Math.floor(Math.random() * near.length)], e = t.edges[Math.floor(Math.random() * t.edges.length)];
  if (Math.hypot(NX(e.a) - px, NZ(e.a) - pz) > 450 || isSnow(NX(e.a), NZ(e.a))) return null;
  const look = newLook(); look.coat = null; look.bag = pick(['#c53030', '#2b6cb0', '#2f855a', '#d69e2e', '#1a202c']); look.shirt = pick(['#2f855a', '#c53030', '#2b6cb0', '#d69e2e', '#4a5568', '#805ad5']); look.pants = pick(['#2d3748', '#4a5568', '#5a4a3a']); look.hat = Math.random() < 0.5 ? pick(['#2d3748', '#c53030', '#d69e2e']) : null; look.cup = null; look.sbag = null;
  return { t, e, dir: Math.random() < 0.5 ? 1 : -1, u: Math.random() * e.len, x: 0, z: 0, y: 0, yaw: 0, cols: look, state: 'walk', kind: 'walk', phase: Math.random() * 6, amp: 0.55, visible: true, dirty: true, sp: R(0.9, 1.4) };
}
function stepHiker(h, dt) {
  h.u += h.sp * dt * h.dir;
  if (h.u > h.e.len || h.u < 0) {   // next piece of the same trail (or turn around at its end)
    const node = h.u > h.e.len ? h.e.b : h.e.a, nxt = nodeEdges[node].filter(q => q !== h.e && h.t.edges.includes(q));
    if (!nxt.length) { h.dir *= -1; h.u = Math.max(0, Math.min(h.e.len, h.u)); }
    else { const q = nxt[Math.floor(Math.random() * nxt.length)]; h.dir = q.a === node ? 1 : -1; h.u = h.dir > 0 ? 0 : q.len; h.e = q; }
  }
  const e = h.e, f = h.u / e.len, ax = NX(e.a), az = NZ(e.a), bx = NX(e.b), bz = NZ(e.b), ux = (bx - ax) / e.len, uz = (bz - az) / e.len;
  h.x = ax + (bx - ax) * f + uz * 0.5 * h.dir; h.z = az + (bz - az) * f - ux * 0.5 * h.dir; h.y = groundY(h.x, h.z) + 0.1;
  h.yaw = Math.atan2(-ux * h.dir, -uz * h.dir); h.phase += dt * h.sp * 4.2;
}

// ---------- the Grouse Grind ----------
let grind = null, run = null;
export function trailsPrompt(player) {
  if (player.vehicle || player.transit || G.dialogOpen || run) return '';
  if (!grind) grind = trails.find(t => /grouse grind/i.test(t.name)) || 0;
  if (grind && Math.hypot(player.x - grind.head.x, player.z - grind.head.z) < 18) {
    if (tapped('KeyE')) { if (activeMission()) ui.toast('Busy!', 'Finish your mission first.', 1500); else if (isSnow(grind.head.x, grind.head.z)) ui.toast('⛔ Trail closed for winter', 'The Grind is closed in the snow season (just like the real one).', 3000); else { run = { t0: G.t, x: player.x, z: player.z }; ui.toast('⏱️ Grouse Grind: GO!', `${(grind.len / 1000).toFixed(1)} km and ${Math.round(grind.gain)} m straight up. Follow the orange markers. Sprint with Shift.`, 4000); } }
    return '<kbd>E</kbd> ⏱️ Start the Grouse Grind timer';
  }
  return '';
}
function updateGrind() {
  if (!run) return;
  if (player().vehicle || Math.hypot(player().x - run.x, player().z - run.z) > 80) { run = null; ui.objective?.(null); ui.toast('⏱️ Grind cancelled', 'No shortcuts (or gondolas) allowed!', 2500); return; }
  run.x = player().x; run.z = player().z;
  const t = G.t - run.t0, mm = Math.floor(t / 60), ss = Math.floor(t % 60).toString().padStart(2, '0');
  const togo = Math.max(0, heightAt(grind.top.x, grind.top.z) - player().y);
  G.sideObj = `⏱️ Grouse Grind <b>${mm}:${ss}</b> · ${Math.round(togo)} m to climb`;   // (missions.js shows it; a direct ui.objective was wiped every frame)
  if (Math.hypot(player().x - grind.top.x, player().z - grind.top.z) < 30) {
    run = null; ui.objective?.(null); sfx.coin?.();
    const best = player().stats.grind; player().stats.grind = best ? Math.min(best, t) : t; player().money += 50; discover('grind');
    ui.toast(`🏔️ Grind done: ${mm}:${ss}!`, (best && t < best ? 'New personal best! ' : '') + pick(['Locals do it in under an hour. You did it in sneakers.', 'Your legs have filed a complaint.', 'The chalet sells beer up here. Just saying.']) + ' (+$50)', 5000);
  }
}
const player = () => pl;

let hT = 0;
export function updateTrails(dt, p) {
  if (!markerIM) return;
  updateSigns(p.x, p.z); updateMarkers(p.x, p.z); updateGrind();
  const day = (G.hour ?? 12) > 6.5 && (G.hour ?? 12) < 20 && (G.wet || 0) < 0.35;
  for (let i = hikers.length - 1; i >= 0; i--) if (!day || Math.hypot(hikers[i].x - p.x, hikers[i].z - p.z) > 520) hikers.splice(i, 1);
  hT -= dt; if (hT < 0 && day && hikers.length < MAXH) { hT = 0.5; const h = spawnHiker(p.x, p.z); if (h) hikers.push(h); }
  for (const h of hikers) stepHiker(h, dt);
  hikersCrowd.draw(hikers);
}
export const _trails = trails;
