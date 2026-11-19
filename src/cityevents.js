// City life near you, part 2: little things HAPPENING around you, the weather and seasons you can see, and rare surprises.
//  Events (start at random 50–170 m from you; different ones by day/night, weather, season and date; max 3 at a time):
//    busker + crowd · film shoot (Hollywood North) · light-hearted parody march · farmers' market · food truck queue ·
//    off-leash dog playing fetch (sometimes with YOU) · cyclist with a flat tyre · parades on special days · delivery robots ·
//    wedding photo shoot · crow stealing someone's fries · raccoons in a knocked-over bin (night) · kids' lemonade stand
//  Environment: autumn leaves, spring cherry petals, summer fluff; steam from manholes on cold mornings/nights; lawn sprinklers
//    on summer mornings/evenings; rain ripples on puddles and pavement; wind gusts that steal hats and flip umbrellas.
//  Rare: a UFO over the North Shore mountains at night, a black bear raiding a green bin in a North Shore back yard,
//    escaped balloons drifting up, wacky waving inflatable tube men at car dealers (and on some days a giant inflatable goose).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, scene, camera, R, pick, hash2, canvasTex, toXZ, inPoly, tapped, clamp } from './core.js';
import { isWater, groundY, heightAt, isNorthShoreTown, cherryTrees } from './terrain.js';
import { roadGrid, NX, NZ, walkY, buildingAt, nearBuildings, nearestRoad, nodeEdges, pois, isWalkType } from './city.js';
import { Crowd, newLook, peds, say } from './people.js';
import { blockedAt } from './colliders.js';
import { puddleSpots, W as Wx } from './weather.js';
import { ui } from './ui.js';
import { sfx, beep, noise } from './sound.js';
import { cityLifePrompt, setRaccoonSpawner } from './citylife.js';

const M = window.MAP;
let discover = () => {}, crowd = null;
const VC = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
const GLOW = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff4d6', emissiveIntensity: 1.6, roughness: 0.4 });
const _m4 = new THREE.Matrix4(), _eu = new THREE.Euler(), _c = new THREE.Color(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d), C = (rt, rb, h, n = 10) => new THREE.CylinderGeometry(rt, rb, h, n), S = (r, n = 10) => new THREE.SphereGeometry(r, n, Math.max(6, n * 0.7 | 0));
// many coloured parts → one mesh (vertex colours): [geometry, colour, x, y, z, rx, ry, rz]
function bake(parts, mat = VC) {
  const gs = [];
  for (const [geo, c, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0] of parts) {
    const g = geo.index ? geo : geo; g.applyMatrix4(_m4.makeRotationFromEuler(_eu.set(rx, ry, rz)).setPosition(x, y, z));
    const n = g.attributes.position.count, a = new Float32Array(n * 3); _c.set(c); for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3)); if (!g.index) g.setIndex([...Array(n).keys()]); gs.push(g);
  }
  const m = new THREE.Mesh(mergeGeometries(gs), mat); m.castShadow = true; m.receiveShadow = true; return m;
}
const signCache = new Map();
function signTex(text, bg = '#ffffff', fg = '#111111', w = 512, h = 128, font = '900 64px "Arial Black", Impact, sans-serif') {
  const k = text + bg + fg + w + h; if (signCache.has(k)) return signCache.get(k);
  const t = canvasTex(w, h, (c) => { c.fillStyle = bg; c.fillRect(0, 0, w, h); c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle'; const lines = text.split('\n'); let fs = parseInt(font.match(/(\d+)px/)[1]); const f = s => font.replace(/\d+px/, s + 'px');
    c.font = f(fs); while (lines.some(l => c.measureText(l).width > w - 24) && fs > 12) { fs -= 2; c.font = f(fs); } lines.forEach((l, i) => c.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * fs * 1.1)); }, false);
  signCache.set(k, t); return t;
}
function sign(text, w, h, bg, fg, px = 512, py = 128) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: signTex(text, bg, fg, px, py), roughness: 0.7, side: THREE.DoubleSide })); return m; }

// ---------- events: helpers ----------
const events = [];
const W = (ev, lx, lz) => [ev.x + Math.cos(ev.yaw) * lx + Math.sin(ev.yaw) * lz, ev.z - Math.sin(ev.yaw) * lx + Math.cos(ev.yaw) * lz];
function addActor(ev, lx, lz, kind = 'idle', look = {}, faceX = null, faceZ = null, sc = 1) {
  const [x, z] = W(ev, lx, lz), a = { cols: { ...newLook(), ...look }, state: 'idle', kind, phase: R(0, 6), amp: 0, visible: true, x, z, y: walkY(x, z), yaw: 0, dirty: true, sc, lx, lz, yoff: 0 };
  if (faceX !== null) face(ev, a, faceX, faceZ); ev.actors.push(a); return a;
}
function face(ev, a, lx, lz) { const [x, z] = W(ev, lx, lz); a.yaw = Math.atan2(-(x - a.x), -(z - a.z)); }
function place(ev, a, lx, lz) { a.lx = lx; a.lz = lz; [a.x, a.z] = W(ev, lx, lz); a.y = walkY(a.x, a.z, a.y + 1) + a.yoff; }
function group(ev) { const g = new THREE.Group(); g.position.set(ev.x, walkY(ev.x, ev.z), ev.z); g.rotation.y = ev.yaw; scene.add(g); ev.g = g; return g; }
const near = (ev, pl, lx, lz, r) => { const [x, z] = W(ev, lx, lz); return Math.hypot(pl.x - x, pl.z - z) < r; };
const inTown = (x, z) => nearBuildings(x, z, 40).length > 2;
// a spot on a sidewalk: local +z of the event points at the street
function sidewalkSpot(px, pz, filter, min = 50, max = 170, extra = 1.5) {
  for (let k = 0; k < 10; k++) {
    const es = roadGrid.near(px + R(-max, max), pz + R(-max, max), 40, []); if (!es.length) continue;
    const e = pick(es), r = M.roads[e.r]; if (r.b || !filter(r, e)) continue;
    const t = R(0.2, 0.8), L = e.len || 1, ux = (NX(e.b) - NX(e.a)) / L, uz = (NZ(e.b) - NZ(e.a)) / L, cx = NX(e.a) + ux * L * t, cz = NZ(e.a) + uz * L * t, side = Math.random() < 0.5 ? 1 : -1;
    const off = r.w / 2 + extra, x = cx - uz * off * side, z = cz + ux * off * side, d = Math.hypot(x - px, z - pz);
    if (d < min || d > max || isWater(x, z) || buildingAt(x, z) || !inTown(x, z) || tooClose(x, z)) continue;
    return { x, z, yaw: Math.atan2(uz * side, -ux * side), e, r, ux, uz, t };
  }
  return null;
}
const PARKY = new Set(['park', 'grass', 'garden', 'recreation_ground', 'village_green']);
function parkSpot(px, pz, need = 8, min = 50, max = 170) {
  for (let k = 0; k < 14; k++) {
    const a = M.areas[Math.floor(Math.random() * M.areas.length)]; if (a.line || !PARKY.has(a.k) || Math.abs(a.p[0] - px) > max + 300 || Math.abs(a.p[1] - pz) > max + 300) continue;
    let cx = 0, cz = 0, n = Math.min(a.p.length / 2, 60); for (let i = 0; i < n; i++) { cx += a.p[i * 2]; cz += a.p[i * 2 + 1]; } cx /= n; cz /= n;
    const x = cx + R(-30, 30), z = cz + R(-30, 30), d = Math.hypot(x - px, z - pz); if (d < min || d > max || !inPoly(x, z, a.p) || isWater(x, z) || tooClose(x, z)) continue;
    let ok = true; for (const [dx, dz] of [[need, 0], [-need, 0], [0, need], [0, -need], [0, 0]]) if (buildingAt(x + dx, z + dz) || isWater(x + dx, z + dz) || nearestRoad(x + dx, z + dz, 3, r => r.t <= 6)) ok = false;
    if (ok && !blockedAt(x, z, need * 0.5)) return { x, z, yaw: R(0, 6.28), area: a };
  }
  return null;
}
const tooClose = (x, z) => events.some(e => Math.hypot(e.x - x, e.z - z) < 90);
const dry = () => G.wet < 0.35, day = () => G.night < 0.35, H = () => G.hour;
const isDay = d => Math.abs((G.doy ?? 200) - d) <= 1;
const special = () => isDay(182) ? 'canada' : isDay(214) ? 'pride' : (G.doy >= 38 && G.doy <= 48) ? 'lunar' : (G.doy >= 103 && G.doy <= 110) ? 'vaisakhi' : (G.doy >= 330 && G.doy <= 336) ? 'santa' : null;

// ---------- the events ----------
const CHANTS = ['What do we want? PATIOS! When do we want them? ALL YEAR!', '2, 4, 6, 8! NO MORE RAIN ON WEEKENDS!', 'Hey hey, ho ho, the seagulls have to go! …No wait, we love them!', 'MORE BENCHES! FEWER BENCHES WITH SPIKES!', 'The people, united, want a longer summer!', 'Sun! Sun! SUN! (please)'];
const SLOGANS = ['MORE PATIOS', 'LET THE MOUNTAINS OUT', 'NO RAIN ON WEEKENDS', 'PINEAPPLE PIZZA IS VALID', 'JUSTICE FOR RACCOONS', 'LONGER HAPPY HOURS', 'DOGS DESERVE BEACHES', 'CROSSWALK BUTTONS SHOULD WORK', 'SUMMER > 3 WEEKS', 'FREE HUGS (DRY ONES)', 'SAVE THE BLACKBERRIES', 'MORE SUN PLEASE'];
const MARKET = [['🍒 BC cherries', 6, 15], ['🍯 Wildflower honey', 9, 20], ['🥬 Kale (of course)', 4, 10], ['🧶 A hand-knit toque', 30, 0], ['🍵 Kombucha', 7, 15], ['🥧 Saskatoon berry pie', 12, 35], ['🍎 Okanagan apples', 5, 15]];
const TRUCKS = [['Yam Sammy', '#e65100'], ['Poutine Machine', '#1565c0'], ['Mom\'s Bao Bus', '#c62828'], ['Sushi-rito Express', '#2e7d32'], ['Taco Tsunami', '#6a1b9a'], ['Mac Daddy Mac & Cheese', '#f9a825'], ['Japa-Dogg', '#d32f2f']];
const FILMS = ['Untitled Cop Show 7', 'Snowpocalypse (in July)', 'The Rainy Detective', 'Hallmark: A Very Vancouver Christmas', 'Superhero Movie (set in New York)', 'Zombie Show, Season 11', 'Generic Sci-Fi Pilot'];

const TYPES = {
  busker: {
    w: () => (H() > 9 && H() < 23 && dry() ? 3 : 0), spot: (px, pz) => sidewalkSpot(px, pz, r => r.t >= 2 && r.t <= 5, 50, 160, 2.2),
    build(ev) {
      const v = ev.v = pick(['guitar', 'guitar', 'juggler', 'drums', 'statue', 'breakdance', 'bagpipes']), g = group(ev);
      const silver = { skin: '#b8bcc2', hair: '#b8bcc2', shirt: '#9aa0a6', pants: '#9aa0a6', shoes: '#9aa0a6', hat: '#9aa0a6', bag: null, cup: null, sbag: null, glasses: null };
      const p = ev.p = addActor(ev, 0, -0.6, v === 'breakdance' ? 'dance' : v === 'drums' ? 'sit' : v === 'statue' ? 'wave' : 'stand', v === 'statue' ? silver : { cup: null, sbag: null, bag: null }, 0, 3);
      const parts = [[B(0.7, 0.12, 0.4), '#3a2416', 0.9, 0.06, -0.2], [B(0.62, 0.02, 0.32), '#8b1a1a', 0.9, 0.13, -0.2], [S(0.03, 6), '#d4af37', 0.85, 0.15, -0.2], [S(0.03, 6), '#d4af37', 0.95, 0.15, -0.15]];
      if (v === 'guitar') parts.push([C(0.18, 0.18, 0.08, 14), '#a0522d', 0.05, 1.08, -0.35, Math.PI / 2, 0, 0.5], [B(0.05, 0.6, 0.03), '#3a2416', 0.25, 1.35, -0.35, 0, 0, -1.05]);
      if (v === 'drums') { p.yoff = 0.0; parts.push([B(0.4, 0.42, 0.4), '#8a6a42', 0, 0.21, -0.75]); for (const [x, z, c] of [[-0.4, -0.1, '#ff6d00'], [0.4, -0.1, '#f4f4f4'], [0, 0.1, '#ff6d00']]) parts.push([C(0.17, 0.2, 0.42, 12), c, x, 0.21, z]); }
      if (v === 'statue') { p.yoff = 0.6; parts.push([B(0.7, 0.6, 0.7), '#7d8288', 0, 0.3, -0.6]); }
      if (v === 'bagpipes') parts.push([S(0.2, 8), '#2e5a3a', 0.15, 1.3, -0.45], [C(0.02, 0.02, 0.7), '#1a1a1a', 0.25, 1.6, -0.5, 0.3]);
      g.add(bake(parts)); place(ev, p, 0, -0.6);
      if (v === 'juggler') { ev.balls = new THREE.InstancedMesh(S(0.06, 8), new THREE.MeshStandardMaterial({ color: '#ff3d00' }), 3); ev.balls.frustumCulled = false; scene.add(ev.balls); }
      const n = 4 + Math.floor(Math.random() * 5); for (let i = 0; i < n; i++) { const a = -1.2 + 2.4 * i / Math.max(1, n - 1) + R(-0.1, 0.1), r = R(2.6, 3.6), lx = Math.sin(a) * r, lz = Math.cos(a) * r * 0.35 + 0.2, [wx, wz] = W(ev, lx, lz); if (!buildingAt(wx, wz)) addActor(ev, lx, lz, 'idle', {}, 0, -0.6); }
    },
    update(ev, dt, pl, d) {
      ev.t2 = (ev.t2 || 0) - dt; const p = ev.p;
      if (ev.v === 'statue') { p.kind = ev.t % 20 < 1.2 ? 'wave' : 'stand'; if (ev.t % 20 < dt * 1.5 && ev.actors[1]) say(ev.actors[1], pick(['AAH! It moved!', 'Was that a real person?!', 'I KNEW it!']), 2000); }
      if (ev.v === 'breakdance') p.phase += dt * 3; else if (ev.v !== 'statue') { p.phase += dt * 2; }
      if (ev.v === 'drums') { p.kind = 'swing'; p.swing = (ev.t * 3) % 1; }
      if (ev.balls) { for (let i = 0; i < 3; i++) { const u = (ev.t * 1.4 + i / 3) % 1, x = Math.cos(u * Math.PI) * 0.35; _v.set(p.x, p.y + 1.25 + Math.sin(u * Math.PI) * 0.9, p.z); _v.x += Math.cos(p.yaw) * x; _v.z -= Math.sin(p.yaw) * x; _m4.makeTranslation(_v.x, _v.y, _v.z); ev.balls.setMatrixAt(i, _m4); } ev.balls.instanceMatrix.needsUpdate = true; }
      for (const a of ev.actors) if (a !== p) { if (a.cheer > 0) { a.cheer -= dt; a.kind = a.cheer > 0 ? 'wave' : 'idle'; a.phase += dt * 3; } else if (Math.random() < dt * 0.05) a.cheer = 1.5; }
      if (ev.t2 < 0) { ev.t2 = R(7, 12); say(p, pick({ guitar: ['🎵 Wonderwall time!', '🎵 Thank you, Robson Street!', '🎵 This one\'s an original…', '🎵 Anyone got requests? Not Wonderwall.'], juggler: ['Three balls! Watch closely!', 'Usually I do chainsaws. Bylaw said no.'], drums: ['🥁 BA-DUM-TSSS', '🥁 Buckets: cheaper than drums!'], statue: ['…', '(the statue winks at you)'], breakdance: ['Make some NOISE!', 'Windmill! WINDMILL!'], bagpipes: ['🎶 (bagpipes intensify)', '🎶 This is "Amazing Grace". Probably.'] }[ev.v]), 3000); }
      if (d < 25 && !pl.vehicle) { ev.nt = (ev.nt || 0) - dt; if (ev.nt < 0) { ev.nt = ev.v === 'drums' ? 0.25 : 0.45; const vol = 0.012 * (1 - d / 25); if (ev.v === 'drums') noise(0.07, vol * 3, pick([180, 400, 900])); else if (ev.v === 'guitar' || ev.v === 'bagpipes') beep([pick([262, 294, 330, 392, 440, 523])], 0.4, ev.v === 'bagpipes' ? 'sawtooth' : 'triangle', vol); } }
    },
    use: (ev, pl) => near(ev, pl, 0, -0.6, 3.5) && [`🎩 Tip the ${ev.v === 'statue' ? 'living statue' : 'busker'} ($2)`, () => { if (pl.money < 2) { ui.toast('Broke!', 'You give a thumbs-up instead. They appreciate it. Sort of.'); return; } pl.money -= 2; pl.karma += 1; sfx.coin(); say(ev.p, pick(['Thank you, friend!', 'You\'re a legend!', 'Rent: 0.08% paid!', 'Bless you!']), 2500); for (const a of ev.actors) a.cheer = 1.5; }],
    end(ev) { if (ev.balls) scene.remove(ev.balls); },
  },
  film: {
    w: () => (dry() || G.night > 0.5 ? 2 : 0.5), spot: (px, pz) => sidewalkSpot(px, pz, r => r.t >= 3 && r.t <= 5, 60, 170, 2),
    build(ev) {
      const g = group(ev), title = ev.title = pick(FILMS);
      const parts = [];
      for (const s of [-1, 1]) parts.push([B(7, 2.6, 2.4), '#f2f2f0', s * 8, 1.6, 3.2], [B(1.2, 0.5, 0.02), '#2a2f36', s * 8 - 1.8, 2.1, 1.99], [C(0.4, 0.4, 0.3, 12), '#1a1a1a', s * 8 - 2.5, 0.4, 2.1, 0, 0, Math.PI / 2], [C(0.4, 0.4, 0.3, 12), '#1a1a1a', s * 8 + 2.3, 0.4, 2.1, 0, 0, Math.PI / 2]);
      for (const s of [-1, 1]) { const x = s * 3, z = 1.6; for (let k = 0; k < 3; k++) { const a = k * 2.09; parts.push([B(0.04, 1.6, 0.04), '#202020', x + Math.cos(a) * 0.35, 0.75, z + Math.sin(a) * 0.35, Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3]); } parts.push([C(0.03, 0.03, 2.4), '#303030', x, 1.9, z], [B(1.3, 1.3, 0.15), '#111', x, 3.1, z, 0, s * 0.7, 0]); }
      parts.push([B(3, 0.06, 0.12), '#555', 0, 0.03, 4.4], [B(3, 0.06, 0.12), '#555', 0, 0.03, 4.9], [B(0.8, 0.9, 0.8), '#2a2a2a', 0, 0.55, 4.65], [B(0.5, 0.4, 0.8), '#111', 0, 1.25, 4.6], [C(0.12, 0.15, 0.5, 10), '#111', 0, 1.25, 4.0, Math.PI / 2]);
      parts.push([B(0.6, 0.05, 0.5), '#2a2a2a', 2.6, 0.6, 5.5], [B(0.6, 0.6, 0.05), '#2a2a2a', 2.6, 0.9, 5.75], ...[-0.25, 0.25].flatMap(x => [[B(0.04, 0.6, 0.04), '#c0a060', 2.6 + x, 0.3, 5.3], [B(0.04, 0.6, 0.04), '#c0a060', 2.6 + x, 0.3, 5.7]]));
      parts.push([B(2, 0.06, 0.8), '#f4f4f4', -4, 0.85, 5], [B(0.06, 0.85, 0.06), '#888', -4.9, 0.42, 5], [B(0.06, 0.85, 0.06), '#888', -3.1, 0.42, 5], [C(0.14, 0.14, 0.4), '#9e9e9e', -4.5, 1.08, 5], [C(0.14, 0.14, 0.4), '#9e9e9e', -4.1, 1.08, 5], [B(0.4, 0.15, 0.3), '#ff8f00', -3.5, 0.95, 5]);
      g.add(bake(parts));
      const lamps = bake([[B(1.1, 1.1, 0.05), '#ffffff', -3, 3.1, 1.52, 0, -0.7, 0], [B(1.1, 1.1, 0.05), '#ffffff', 3, 3.1, 1.52, 0, 0.7, 0]], GLOW); lamps.castShadow = false; g.add(lamps); ev.lamps = lamps;
      const sg = sign('FILMING IN PROGRESS\n"' + title + '"\nSorry for the inconvenience!', 2.2, 1.1, '#fff59d', '#111', 512, 256); sg.position.set(-6, 1.6, -0.5); g.add(sg);
      const post = bake([[B(0.06, 1.1, 0.06), '#666', -6, 0.55, -0.55]]); g.add(post);
      const look = { cup: null, sbag: null };
      ev.lead = [addActor(ev, -0.7, 0, 'idle', { coat: '#1a1a1a', ...look }, 0.7, 0), addActor(ev, 0.7, 0, 'idle', { ...look }, -0.7, 0)];
      ev.dir = addActor(ev, 2.6, 5.5, 'sit', { hat: '#1a1a1a', ...look }, 0, 0); ev.dir.yoff = 0.18; place(ev, ev.dir, 2.6, 5.5);
      addActor(ev, 0, 5.3, 'stand', { shirt: '#1a1a1a', ...look }, 0, 0); addActor(ev, 1.6, 1.4, 'stand', { shirt: '#1a1a1a', ...look }, 0, 0);
      for (let i = 0; i < 3; i++) addActor(ev, -4 + R(-1, 1), 6 + R(0, 1.5), 'idle', { shirt: pick(['#1a1a1a', '#37474f', '#5d4037']), cup: '#f4f1ea' }, R(-2, 2), 0);
      ev.ph = 'setup'; ev.pt = 5; ev.rainy = dry() && Math.random() < 0.5;
      if (ev.rainy) { const geo = new THREE.BufferGeometry(); ev.rp = new Float32Array(120 * 3); geo.setAttribute('position', new THREE.BufferAttribute(ev.rp, 3)); ev.rain = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#cfe3ff', size: 0.12, transparent: true, opacity: 0.8 })); ev.rain.frustumCulled = false; scene.add(ev.rain); g.add(bake([[C(0.05, 0.05, 6), '#777', -2.4, 3, -1.2], [C(0.05, 0.05, 5, 6), '#777', 0, 6, -1.2, 0, 0, Math.PI / 2], [C(0.05, 0.05, 6), '#777', 2.4, 3, -1.2]])); }
    },
    update(ev, dt, pl, d) {
      ev.pt -= dt;
      if (ev.pt < 0) {
        if (ev.ph === 'setup') { ev.ph = 'roll'; ev.pt = R(8, 12); say(ev.dir, pick(['Quiet on set! …ACTION!', 'Rolling! Aaaand… ACTION!', 'Scene 12, take 47. ACTION!']), 2500); }
        else { ev.ph = 'setup'; ev.pt = R(5, 8); say(ev.dir, pick(['CUT! Again, with feeling!', 'CUT! Can we make it look less like Vancouver?', 'Moving on! Reset!', 'CUT! Somebody get rid of that mountain.', 'CUT! Lovely. One more for safety.']), 2600); }
      }
      for (const [i, a] of ev.lead.entries()) { a.kind = ev.ph === 'roll' && Math.sin(ev.t * 2 + i * 3) > 0.3 ? 'wave' : 'idle'; a.phase += dt * 2; if (ev.ph === 'roll' && Math.random() < dt * 0.15) say(a, pick(['This city… it never sleeps.', 'We\'re not so different, you and I.', 'I\'m too old for this.', 'Wait… it\'s raining. In New York?']), 2200); }
      if (ev.ph === 'roll' && !pl.vehicle && near(ev, pl, 0, 1.5, 6.5)) {
        ev.ph = 'setup'; ev.pt = 6; say(ev.dir, 'CUUUT!! Who is THAT?! Get them out of my shot!', 3000); ui.toast('🎬 You walked into the shot!', 'Vancouver = "Hollywood North": so many movies and shows film here that locals walk into shots all the time.', 4500); discover('hollywoodnorth');
      }
      if (ev.rain) { const a = ev.rp; for (let i = 0; i < 120; i++) { let y = a[i * 3 + 1] - dt * 9; if (y < ev.g.position.y || !a[i * 3]) { const [x, z] = W(ev, R(-2.4, 2.4), R(-1.6, -0.8)); a[i * 3] = x; a[i * 3 + 2] = z; y = ev.g.position.y + R(2, 6); } a[i * 3 + 1] = y; } ev.rain.geometry.attributes.position.needsUpdate = true; ev.rain.visible = ev.ph === 'roll'; if (d < 20 && !ev.toldRain) { ev.toldRain = true; ui.toast('🌧️ A rain machine', 'The film crew is making fake rain. In Vancouver. On the one dry day.', 3500); } }
    },
    use: (ev, pl) => near(ev, pl, -4, 5, 2.4) && ['☕ Grab a free coffee from craft services', () => { pl.buffT = 90; pl.karma -= 1; sfx.coin(); ui.toast('☕ Craft services!', 'Free coffee, but you\'re not crew. A PA glares at you. (Run faster for 90 s, -1 karma)', 3500); }],
    end(ev) { if (ev.rain) scene.remove(ev.rain); },
  },
  march: {
    w: () => (day() && G.wet < 0.5 && H() > 10 && H() < 18 ? 1 : 0), spot: (px, pz) => sidewalkSpot(px, pz, (r, e) => r.t >= 2 && r.t <= 4 && e.len > 70, 50, 150, 1.6),
    build(ev) {
      const { e, r } = ev.sp, L = e.len; ev.L = L; ev.u = ev.sp.t * L; ev.dirn = Math.random() < 0.5 ? 1 : -1; ev.off = r.w / 2 + 1.6; ev.side = Math.sign(Math.cos(ev.yaw) * -1) || 1;
      const n = 10 + Math.floor(Math.random() * 5); ev.slog = [];
      for (let i = 0; i < n; i++) { const a = addActor(ev, 0, 0, 'walk', { cup: null, sbag: null }); a.row = Math.floor(i / 3); a.col = i % 3 - 1; a.hasSign = Math.random() < 0.7; a.sl = Math.floor(Math.random() * SLOGANS.length); }
      ev.signs = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ map: sloganTex(), side: THREE.DoubleSide, roughness: 0.8 })); ev.signs.frustumCulled = false; scene.add(ev.signs);
      const k = ev.actors.length, pos = new Float32Array(k * 12 * 3), uv = new Float32Array(k * 12 * 2), idx = [];
      for (let i = 0; i < k; i++) { const c = ev.actors[i].sl, v0 = 1 - (c + 1) / 12, v1 = 1 - c / 12; uv.set([0, v0, 1, v0, 1, v1, 0, v1], i * 24); uv.set([0.98, 0, 1, 0, 1, 0.01, 0.98, 0.01], i * 24 + 8); uv.set([0.98, 0, 1, 0, 1, 0.01, 0.98, 0.01], i * 24 + 16); for (let q = 0; q < 3; q++) { const b = i * 12 + q * 4; idx.push(b, b + 1, b + 2, b, b + 2, b + 3); } }
      ev.signs.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3)); ev.signs.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); ev.signs.geometry.setIndex(idx);
      ev.ct = 2;
    },
    update(ev, dt, pl, d) {
      const { e } = ev.sp, L = ev.L, ax = NX(e.a), az = NZ(e.a), ux = (NX(e.b) - ax) / L, uz = (NZ(e.b) - az) / L;
      ev.u += ev.dirn * dt * 1.05; if (ev.u > L - 5 || ev.u < 5) ev.dirn *= -1;
      const side = ev.sideSign ?? (ev.sideSign = Math.sign((ev.x - ax) * -uz + (ev.z - az) * ux) || 1), pos = ev.signs.geometry.attributes.position.array;
      ev.actors.forEach((a, i) => {
        const s = clamp(ev.u - ev.dirn * a.row * 1.3, 1, L - 1), off = ev.off + a.col * 0.8 + 0.4, x = ax + ux * s - uz * off * side, z = az + uz * s + ux * off * side;
        a.x = x; a.z = z; a.y = walkY(x, z, a.y + 1); a.yaw = Math.atan2(-ux * ev.dirn, -uz * ev.dirn); a.phase += dt * 4.2; a.amp = 0.5; a.kind = a.pump > 0 ? 'wave' : 'walk'; if (a.pump > 0) a.pump -= dt;
        const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw), rx = -fz, rz = fx, h = a.hasSign ? 1 : 0, cx = x + rx * 0.28, cz = z + rz * 0.28, y0 = a.y + 2.1, b = i * 36;
        const quad = (o, pts) => pts.forEach((p, k) => { pos[b + o + k * 3] = p[0]; pos[b + o + k * 3 + 1] = p[1]; pos[b + o + k * 3 + 2] = p[2]; });
        quad(0, [[cx - rx * 0.4 * h, y0 - 0.25, cz - rz * 0.4 * h], [cx + rx * 0.4 * h, y0 - 0.25, cz + rz * 0.4 * h], [cx + rx * 0.4 * h, y0 + 0.25, cz + rz * 0.4 * h], [cx - rx * 0.4 * h, y0 + 0.25, cz - rz * 0.4 * h]]);
        quad(12, [[cx - 0.02 * h, a.y + 1.2, cz], [cx + 0.02 * h, a.y + 1.2, cz], [cx + 0.02 * h, y0 - 0.25, cz], [cx - 0.02 * h, y0 - 0.25, cz]]);
        quad(24, [[cx, a.y + 1.2, cz - 0.02 * h], [cx, a.y + 1.2, cz + 0.02 * h], [cx, y0 - 0.25, cz + 0.02 * h], [cx, y0 - 0.25, cz - 0.02 * h]]);
      });
      ev.signs.geometry.attributes.position.needsUpdate = true; ev.signs.geometry.computeBoundingSphere();
      const c = ev.actors[0]; ev.x = c.x; ev.z = c.z;
      ev.ct -= dt; if (ev.ct < 0) { ev.ct = R(5, 8); say(pick(ev.actors), pick(CHANTS), 3200); for (const a of ev.actors) if (Math.random() < 0.6) a.pump = 1.2; }
    },
    use: (ev, pl) => Math.hypot(pl.x - ev.x, pl.z - ev.z) < 6 && !ev.joined && ['📣 Join the march', () => { ev.joined = true; pl.karma += 1; const s = pick(SLOGANS); ui.toast('📣 You joined the march!', `You chant "${s}!" with total strangers. Very Vancouver. (+1 karma)`, 3500); say(ev.actors[0], 'Welcome, friend! Grab a sign!', 2500); for (const a of ev.actors) a.pump = 2; }],
    end(ev) { scene.remove(ev.signs); ev.signs.geometry.dispose(); },
  },
  market: {
    w: () => (H() > 8.5 && H() < 15 && G.season !== 'winter' && G.wet < 0.5 ? 1.5 : 0), spot: (px, pz) => parkSpot(px, pz, 11),
    build(ev) {
      const g = group(ev), parts = [], COLS = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#fb8c00', '#8e24aa', '#f4f4f4'];
      ev.stalls = [];
      for (let i = 0; i < 6; i++) {
        const sx = (i % 3 - 1) * 5.2, sz = i < 3 ? -3.6 : 3.6, fz = i < 3 ? 1 : -1, cc = COLS[(i + Math.floor(ev.x)) % COLS.length];
        for (const [dx, dz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) parts.push([B(0.06, 2.4, 0.06), '#cfd8dc', sx + dx, 1.2, sz + dz]);
        parts.push([B(3.1, 0.08, 3.1), cc, sx, 2.42, sz], [B(3.1, 0.25, 0.02), cc, sx, 2.27, sz + fz * 1.55], [B(2.4, 0.06, 0.8), '#f4f1e4', sx, 0.85, sz + fz * 0.9], [B(2.3, 0.8, 0.75), '#eeeeee', sx, 0.43, sz + fz * 0.9]);
        for (let k = 0; k < 4; k++) parts.push([B(0.45, 0.14, 0.3), '#8d6e63', sx - 0.85 + k * 0.57, 0.95, sz + fz * 0.9], [B(0.4, 0.06, 0.26), pick(['#c62828', '#2e7d32', '#ef6c00', '#6a1b9a', '#fbc02d', '#795548']), sx - 0.85 + k * 0.57, 1.04, sz + fz * 0.9]);
        ev.stalls.push({ lx: sx, lz: sz + fz * 1.6, item: MARKET[(i + Math.floor(ev.z)) % MARKET.length] });
        addActor(ev, sx + R(-0.6, 0.6), sz - fz * 0.2, 'idle', { bag: null, sbag: null }, sx, sz + fz * 3);
      }
      g.add(bake(parts)); const sg = sign("FARMERS' MARKET", 3, 0.75, '#2e7d32', '#ffffff'); sg.position.set(-9, 1.7, 0); sg.rotation.y = Math.PI / 2; g.add(sg); g.add(bake([[B(0.06, 1.4, 0.06), '#5d4037', -9, 0.7, -1], [B(0.06, 1.4, 0.06), '#5d4037', -9, 0.7, 1]]));
      for (let i = 0; i < 9; i++) { const a = addActor(ev, R(-8, 8), R(-1.2, 1.2), 'walk', { sbag: Math.random() < 0.5 ? pick(['#c8a97a', '#ffffff', '#2e7d32']) : null }); a.tx = a.lx; a.tz = a.lz; a.wait = R(0, 4); a.shopper = true; }
    },
    update(ev, dt) {
      for (const a of ev.actors) if (a.shopper) {
        if (a.wait > 0) { a.wait -= dt; a.amp = 0; a.kind = 'idle'; if (a.wait <= 0) { a.tx = R(-8, 8); a.tz = R(-1.3, 1.3); } continue; }
        const dx = a.tx - a.lx, dz = a.tz - a.lz, L = Math.hypot(dx, dz); if (L < 0.2) { a.wait = R(2, 7); face(ev, a, a.lx, a.lz < 0 ? -3 : 3); if (Math.random() < 0.15) say(a, pick(['Ooh, is this organic?', '$9 for honey?! …I\'ll take two.', 'Do you have oat milk?', 'These cherries are amazing!']), 2200); continue; }
        const st = Math.min(L, dt * 1.1); place(ev, a, a.lx + dx / L * st, a.lz + dz / L * st); const [wx, wz] = W(ev, a.tx, a.tz); a.yaw = Math.atan2(-(wx - a.x), -(wz - a.z)); a.kind = 'walk'; a.phase += dt * 4.5; a.amp = 0.5;
      }
    },
    use(ev, pl) { for (const s of ev.stalls) if (near(ev, pl, s.lx, s.lz, 1.8)) return [`${s.item[0]} ($${s.item[1]})`, () => { if (pl.money < s.item[1]) { ui.toast('Not enough cash', 'Farmers\' markets: famously not cheap.'); return; } pl.money -= s.item[1]; pl.health = Math.min(100, pl.health + s.item[2]); sfx.coin(); ui.toast(s.item[0], pick(['Local! Organic! Small-batch! Very Vancouver.', 'The farmer tells you its life story. Worth it.', 'You also accidentally signed up for a CSA box.']) + (s.item[2] ? ` (+${s.item[2]} health)` : ''), 3000); }]; return false; },
  },
  foodtruck: {
    w: () => ((H() > 11 && H() < 14.5) || (H() > 17 && H() < 21.5) ? 2.2 : 0.3), spot: (px, pz) => sidewalkSpot(px, pz, r => r.t >= 2 && r.t <= 5 && r.w >= 9, 50, 160, 1.4),
    build(ev) {
      const [name, colr] = ev.truck = pick(TRUCKS), g = group(ev);
      g.add(bake([[B(6.5, 2.5, 2.3), colr, 0, 1.65, 2.6], [B(2, 1.5, 2.3), '#f4f4f4', 3.9, 1.3, 2.6], [B(1.4, 0.7, 2.32), '#2a3540', 4.3, 1.75, 2.6], [B(2.6, 1, 0.04), '#1e1e1e', -0.5, 1.9, 1.44], [B(2.8, 0.06, 0.7), '#f4f4f4', -0.5, 2.5, 1.1, 0.25], [B(2.6, 0.08, 0.35), '#bdbdbd', -0.5, 1.4, 1.3],
        ...[[-2.2, 1.45], [-2.2, 3.75], [3.6, 1.45], [3.6, 3.75]].map(([x, z]) => [C(0.45, 0.45, 0.3, 14), '#1a1a1a', x, 0.45, z, Math.PI / 2, 0, 0])]));
      for (const sd of [1, -1]) { const s = sign(name, 4.2, 0.9, '#ffffff', colr); s.position.set(-0.3, 2.65, 2.6 - sd * 1.17); s.rotation.y = sd > 0 ? Math.PI : 0; g.add(s); }
      ev.worker = addActor(ev, -0.5, 2.3, 'stand', { hat: '#ffffff', shirt: '#ffffff', cup: null }, -0.5, 0); ev.worker.yoff = 0.7; place(ev, ev.worker, -0.5, 2.3);
      const n = 4 + Math.floor(Math.random() * 4); for (let i = 0; i < n; i++) addActor(ev, -0.6 - i * 0.85, 0.4 + R(-0.1, 0.15), i === 0 ? 'stand' : Math.random() < 0.3 ? 'idle' : 'idle', {}, i === 0 ? -0.6 : 0, i === 0 ? 2 : 0.4);
      ev.actors.slice(1).forEach(a => { if (Math.random() < 0.4) a.phone = true; });
    },
    update(ev, dt) {
      ev.st = (ev.st || 6) - dt; if (ev.st < 0) { ev.st = R(6, 10); say(ev.worker, pick(['Order up! Number 47!', 'We\'re out of yam fries! JK, we have yam fries.', 'Next!', 'Cash or tap?']), 2500); const q = ev.actors.filter(a => a !== ev.worker); if (q.length > 2 && Math.random() < 0.5) say(pick(q), pick(['This line is SO worth it.', 'I\'ve been here 20 minutes…', 'Is it on Instagram yet?']), 2400); }
      for (const a of ev.actors) if (a.phone && a.kind === 'idle') { a.kind = 'walk'; a.amp = 0; }
    },
    use: (ev, pl) => near(ev, pl, -0.5, 1.0, 2.6) && [`🌮 Order from ${ev.truck[0]} ($9)`, () => { if (pl.money < 9) { ui.toast('Not enough cash', 'Food trucks don\'t take IOUs.'); return; } pl.money -= 9; pl.health = 100; sfx.coin(); say(ev.worker, 'Enjoy!', 2000); ui.toast('🌮 ' + ev.truck[0], pick(['Worth the line. Fully healed.', 'You eat it standing up in the drizzle, like a true local. Fully healed.', 'A seagull watched you eat the whole thing. Fully healed.']), 3000); if (Math.random() < 0.25) setTimeout(() => ui.toast('🐦 A crow is watching your food…', 'Crows here are smart. They remember faces. Eat fast.', 3000), 2500); }],
  },
  dogpark: {
    w: () => (day() && dry() ? 2 : 0), spot: (px, pz) => parkSpot(px, pz, 12),
    build(ev) {
      ev.owner = addActor(ev, 0, 0, 'idle', { cup: Math.random() < 0.5 ? '#f4f1ea' : null }, 0, 5); ev.name = pick(['BISCUIT', 'NOODLE', 'MOOSE', 'PICKLE', 'WAFFLES', 'BEAR', 'TOFU']);
      const col = pick(['#c8913a', '#1a1a1a', '#e8d9b0', '#7a5230', '#f2f2f2']);
      ev.dog = new THREE.Group(); ev.dog.add(bake([[B(0.3, 0.28, 0.7), col, 0, 0.45, 0], [B(0.22, 0.22, 0.3), col, 0, 0.68, -0.42], [B(0.12, 0.1, 0.14), '#2a2a2a', 0, 0.63, -0.6], [B(0.06, 0.1, 0.06), col, -0.08, 0.82, -0.38], [B(0.06, 0.1, 0.06), col, 0.08, 0.82, -0.38], [B(0.05, 0.05, 0.3), col, 0, 0.6, 0.45, -0.7], ...[[-0.1, -0.25], [0.1, -0.25], [-0.1, 0.25], [0.1, 0.25]].map(([x, z]) => [B(0.08, 0.32, 0.08), col, x, 0.16, z])])); scene.add(ev.dog);
      ev.ball = new THREE.Mesh(S(0.08, 10), new THREE.MeshStandardMaterial({ color: '#c6ff00', roughness: 0.6 })); scene.add(ev.ball);
      ev.d = { x: ev.x + 1, z: ev.z, yaw: 0 }; ev.b = { x: ev.x, y: 0, z: ev.z, vx: 0, vy: 0, vz: 0, held: 'owner' }; ev.st = 'wait'; ev.stT = 2; ev.who = 'owner';
    },
    update(ev, dt, pl, d) {
      const D = ev.d, b = ev.b, o = ev.owner, me = ev.who === 'you' ? pl : o;
      const run = (tx, tz, sp) => { const dx = tx - D.x, dz = tz - D.z, L = Math.hypot(dx, dz); if (L > 0.05) { const st = Math.min(L, sp * dt); D.x += dx / L * st; D.z += dz / L * st; D.yaw = Math.atan2(-dx, -dz); } return L; };
      if (ev.st === 'wait') { run(me.x + 0.8, me.z + 0.6, 3); ev.stT -= dt; b.held = 'dog'; if (ev.stT < 0 && ev.who === 'owner') { o.kind = 'swing'; o.swing = 0; ev.st = 'throw'; ev.stT = 0.6; } }
      else if (ev.st === 'throw') { o.swing = Math.min(1, o.swing + dt * 1.7); ev.stT -= dt; if (ev.stT < 0) { o.kind = 'idle'; throwBall(ev, o.x, o.z, R(0, 6.28), R(10, 20)); } }
      else if (ev.st === 'chase') { const L = run(b.x, b.z, 7.5); if (L < 0.5 && b.y < walkY(b.x, b.z) + 0.4) { b.held = 'dog'; ev.st = 'return'; if (d < 30 && !pl.vehicle && !ev.toYou && Math.random() < 0.4) { ev.who = 'you'; ev.toYou = true; } } }
      else if (ev.st === 'return') { const L = run(me.x, me.z, 6); if (L < 1.4) { ev.st = ev.who === 'you' ? 'yours' : 'wait'; ev.stT = R(1.5, 3); b.held = ev.who === 'you' ? 'ground' : 'dog'; if (ev.who === 'you') { b.x = pl.x + 0.6; b.z = pl.z + 0.4; b.y = walkY(b.x, b.z); say(o, `${ev.name}! Sorry! He thinks everyone is his best friend!`, 3000); ui.toast('🐕 The dog dropped the ball at your feet', 'Press E to throw it!', 2500); } } }
      else if (ev.st === 'yours') { run(pl.x + 0.9, pl.z + 0.5, 4); ev.stT -= dt; if (Math.hypot(pl.x - D.x, pl.z - D.z) > 25 || ev.stT < -25) { ev.who = 'owner'; ev.st = 'return'; b.held = 'dog'; say(o, `${ev.name}! COME! …${ev.name}!!`, 2500); } }
      if (b.held === 'dog') { b.x = D.x - Math.sin(D.yaw) * 0.62; b.z = D.z - Math.cos(D.yaw) * 0.62; b.y = walkY(D.x, D.z) + 0.6; }
      else if (b.held === 'air') { b.vy -= 12 * dt; b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt; const gy = walkY(b.x, b.z, b.y + 1) + 0.08; if (b.y < gy) { b.y = gy; if (Math.abs(b.vy) > 1.5) { b.vy *= -0.45; b.vx *= 0.6; b.vz *= 0.6; } else { b.vy = 0; b.vx *= 0.9; b.vz *= 0.9; } } }
      const moving = ev.st === 'chase' || ev.st === 'return'; ev.ph = (ev.ph || 0) + dt * (moving ? 16 : 3);
      ev.dog.position.set(D.x, walkY(D.x, D.z) + (moving ? Math.abs(Math.sin(ev.ph)) * 0.08 : 0), D.z); ev.dog.rotation.y = D.yaw; ev.ball.position.set(b.x, b.y, b.z);
      ev.dogEnt = ev.dogEnt || { x: 0, y: 0, z: 0 }; ev.dogEnt.x = D.x; ev.dogEnt.z = D.z; ev.dogEnt.y = ev.dog.position.y - 1.2;
      if (moving && Math.random() < dt * 0.25) say(ev.dogEnt, pick(['🐕 WOOF!', '🐕 BALL BALL BALL', '🐕 Arf!']), 1200);
      o.yaw = Math.atan2(-(D.x - o.x), -(D.z - o.z));
    },
    use: (ev, pl) => ev.st === 'yours' && Math.hypot(pl.x - ev.b.x, pl.z - ev.b.z) < 2.5 && ['🎾 Throw the ball for the dog', () => { throwBall(ev, pl.x, pl.z, pl.yaw, 18); pl.karma += 1; ev.throws = (ev.throws || 0) + 1; if (ev.throws >= 2) ev.who = 'owner'; ui.toast('🎾 Good throw!', 'Best friend acquired. (+1 karma)', 1800); }],
    talkers: ev => ev.dogEnt ? [ev.dogEnt] : [],
    end(ev) { scene.remove(ev.dog); scene.remove(ev.ball); },
  },
  flattire: {
    w: () => (day() ? 1.5 : 0.2), spot: (px, pz) => sidewalkSpot(px, pz, r => r.t >= 3 && r.t <= 5, 40, 150, 1.6),
    build(ev) {
      ev.bike = new THREE.Group(); ev.bike.add(bake([[new THREE.TorusGeometry(0.34, 0.035, 6, 18), '#1a1a1a', -0.5, 0.36, 0], [new THREE.TorusGeometry(0.34, 0.035, 6, 18), '#1a1a1a', 0.5, 0.36, 0], [B(1.0, 0.05, 0.05), '#00897b', 0, 0.62, 0], [B(0.05, 0.5, 0.05), '#00897b', 0.15, 0.5, 0, 0, 0, -0.3], [B(0.05, 0.5, 0.05), '#00897b', -0.42, 0.62, 0, 0, 0, 0.3], [B(0.04, 0.04, 0.5), '#333', -0.5, 0.95, 0], [B(0.25, 0.05, 0.12), '#222', 0.2, 0.9, 0]])); scene.add(ev.bike);
      ev.rider = addActor(ev, 0, 0, 'sit', { hat: pick(['#e53935', '#fdd835', '#1e88e5', '#f4f4f4']), shirt: pick(['#fdd835', '#e53935', '#00897b']), pants: '#1a1a1a', cup: null, sbag: null }, 0.9, 0); ev.st = 'fix'; ev.say = 3;
      const [bx, bz] = W(ev, 0.9, 0.2); ev.bike.position.set(bx, walkY(bx, bz) + 0.05, bz); ev.bike.rotation.set(Math.PI / 2, ev.yaw, 0, 'YXZ');
    },
    update(ev, dt) {
      const a = ev.rider;
      if (ev.st === 'fix') { ev.say -= dt; if (ev.say < 0) { ev.say = R(7, 11); say(a, pick(['Anybody got a pump?', 'Of course. OF COURSE it\'s a flat.', 'Glass on the bike lane AGAIN.', 'I\'m gonna be so late for my standup.']), 2600); } return; }
      ev.ride += dt; a.kind = 'ride'; a.phase += dt * 6; const sp = Math.min(5, ev.ride * 2); ev.rx += ev.ux * sp * dt; ev.rz += ev.uz * sp * dt;
      a.x = ev.rx; a.z = ev.rz; a.y = walkY(a.x, a.z, a.y + 1) + 0.25; a.yaw = Math.atan2(-ev.ux, -ev.uz); ev.bike.position.set(a.x, a.y - 0.25, a.z); ev.bike.rotation.set(0, a.yaw + Math.PI / 2, 0, 'YXZ');
      if (ev.ride > 14) ev.life = 0;
    },
    use: (ev, pl) => ev.st === 'fix' && near(ev, pl, 0.4, 0, 3) && ['🔧 Help fix the flat tyre', () => {
      ev.st = 'ride'; ev.ride = 0; pl.karma += 2; pl.money += 5; sfx.chime(); say(ev.rider, pick(['You\'re a lifesaver! Here, take $5!', 'Legend! Ride safe, friend!']), 2600); ui.toast('🔧 Flat fixed!', 'You patched the tube and pumped it up. (+2 karma, +$5)', 2500);
      const { ux, uz } = ev.sp; ev.ux = ux; ev.uz = uz; ev.rx = ev.rider.x; ev.rz = ev.rider.z;
    }],
    end(ev) { scene.remove(ev.bike); },
  },
  parade: {
    w: () => (special() && day() && !daily.has('parade' + G.doy) ? 8 : day() && dry() && !daily.has('parade' + G.doy) ? 0.25 : 0), spot: (px, pz) => sidewalkSpot(px, pz, (r, e) => r.t >= 2 && r.t <= 4 && e.len > 110, 40, 160, 0),
    build(ev) {
      daily.add('parade' + G.doy); const th = ev.theme = special() || pick(['vancouver', 'pride', 'canada']);
      const T = { canada: ['Canada Day Parade', ['#d52b1e', '#ffffff']], pride: ['Pride Parade', ['#e40303', '#ff8c00', '#ffed00', '#008026', '#004dff', '#750787']], lunar: ['Lunar New Year Parade', ['#c62828', '#ffd600']], vaisakhi: ['Vaisakhi Parade', ['#ff9800', '#1565c0', '#ffffff']], santa: ['Santa Claus Parade', ['#c62828', '#2e7d32', '#ffffff']], vancouver: ['Rain City Day Parade', ['#29b6f6', '#66bb6a', '#ffca28', '#ec407a']] }[th];
      ev.cols = T[1]; ev.nameP = T[0]; const { e, r } = ev.sp; ev.L = e.len; ev.u = 2; ev.r = r;
      const parts = [[B(2.4, 1.4, 6), '#f4f4f4', 0, 1.1, 0], [B(2.6, 0.5, 6.4), ev.cols[0], 0, 0.5, 0], [B(2.2, 1.6, 1.8), ev.cols[1 % ev.cols.length], 0, 1.4, -3.6]];
      for (let i = 0; i < 16; i++) parts.push([S(0.35, 8), ev.cols[i % ev.cols.length], (i % 2 ? 1 : -1) * 1.1, 2.2 + (i % 3) * 0.4, -2.6 + i * 0.36]);
      if (th === 'lunar') parts.push([B(1.2, 1.0, 1.4), '#d32f2f', 0, 2.4, 1.8], [B(1.3, 0.3, 0.3), '#ffd600', 0, 2.95, 1.2], [S(0.18, 8), '#ffffff', -0.35, 2.75, 1.1], [S(0.18, 8), '#ffffff', 0.35, 2.75, 1.1]);
      if (th === 'santa') parts.push([S(0.45, 10), '#c62828', 0, 2.3, 1], [S(0.32, 10), '#f1c9a5', 0, 3.05, 1], [new THREE.ConeGeometry(0.3, 0.6, 10), '#c62828', 0, 3.5, 1], [S(0.3, 8), '#ffffff', 0, 2.85, 0.8]);
      if (th === 'canada') parts.push([B(0.04, 2.4, 0.04), '#888', 0, 3, 2.6], [B(1.6, 0.9, 0.03), '#d52b1e', 0.8, 3.7, 2.6]);
      ev.float = bake(parts); scene.add(ev.float); ev.banner = sign(ev.nameP + '!', 4, 0.8, ev.cols[0] === '#ffffff' ? '#d52b1e' : ev.cols[0], '#ffffff'); scene.add(ev.banner);
      for (let i = 0; i < 14; i++) { const a = addActor(ev, 0, 0, i < 9 ? 'dance' : 'walk', { shirt: ev.cols[i % ev.cols.length], cup: null, sbag: null }); a.row = 1 + Math.floor(i / 3); a.col = i % 3 - 1; a.par = true; }
      ev.spect = [];
      for (let i = 0; i < 14; i++) { const s = clamp(ev.L * (0.2 + 0.6 * i / 14), 2, ev.L - 2), sd = i % 2 ? 1 : -1, ux = (NX(e.b) - NX(e.a)) / ev.L, uz = (NZ(e.b) - NZ(e.a)) / ev.L, off = r.w / 2 + 1.2 + R(0, 0.8), x = NX(e.a) + ux * s - uz * off * sd, z = NZ(e.a) + uz * s + ux * off * sd; if (buildingAt(x, z)) continue; const a = { cols: newLook(), state: 'idle', kind: 'idle', phase: R(0, 6), amp: 0, visible: true, x, z, y: walkY(x, z), yaw: Math.atan2(uz * sd, -ux * sd), dirty: true, spect: true }; ev.actors.push(a); }
      ui.toast('🎉 ' + ev.nameP + '!', 'There\'s a parade going down the street nearby. Follow the music!', 4000);
    },
    update(ev, dt, pl, d) {
      const { e } = ev.sp, ax = NX(e.a), az = NZ(e.a), ux = (NX(e.b) - ax) / ev.L, uz = (NZ(e.b) - az) / ev.L; ev.u += dt * 1.2; if (ev.u > ev.L + 25) { ev.life = 0; return; }
      const fs = Math.min(ev.u, ev.L), fx = ax + ux * fs, fz = az + uz * fs, yaw = Math.atan2(-ux, -uz); ev.float.position.set(fx, walkY(fx, fz), fz); ev.float.rotation.y = yaw; ev.x = fx; ev.z = fz;
      const bs = clamp(ev.u - 2.2, 0, ev.L), bx = ax + ux * bs, bz = az + uz * bs; ev.banner.position.set(bx, walkY(bx, bz) + 2.2, bz); ev.banner.rotation.y = yaw;
      for (const a of ev.actors) {
        if (a.spect) { a.kind = Math.abs(a.x - fx) + Math.abs(a.z - fz) < 30 ? 'wave' : 'idle'; a.phase += dt * 3; if (a.kind === 'wave' && Math.random() < dt * 0.03) say(a, pick(['WOOOO!', 'Happy ' + ev.nameP.replace(' Parade', '') + '!', 'Best day ever!', '🎉🎉🎉']), 1800); continue; }
        const s = clamp(ev.u - 4 - a.row * 1.6, 0, ev.L), x = ax + ux * s + -uz * a.col * 1.2, z = az + uz * s + ux * a.col * 1.2; a.x = x; a.z = z; a.y = walkY(x, z, a.y + 1); a.yaw = yaw; a.phase += dt * 4; a.amp = 0.5;
      }
      if (d < 60) { ev.bt = (ev.bt || 0) - dt; if (ev.bt < 0) { ev.bt = 0.42; noise(0.07, 0.025 * (1 - d / 60), 220); } }
    },
    end(ev) { scene.remove(ev.float); scene.remove(ev.banner); },
  },
  robots: {
    w: () => (H() > 8 && H() < 22 ? 1.3 : 0), spot: (px, pz) => sidewalkSpot(px, pz, r => r.t >= 2 && r.t <= 5, 30, 120, 1.2),
    build(ev) {
      ev.bots = [];
      for (let i = 0; i < 2; i++) {
        const g = new THREE.Group(); g.add(bake([[B(0.55, 0.42, 0.72), '#f4f4f4', 0, 0.38, 0], [B(0.57, 0.08, 0.74), '#ff6f00', 0, 0.6, 0], [B(0.4, 0.12, 0.02), '#102030', 0, 0.45, -0.37], ...[-0.27, 0, 0.27].flatMap(z => [[C(0.09, 0.09, 0.06, 10), '#222', -0.3, 0.1, z, 0, 0, Math.PI / 2], [C(0.09, 0.09, 0.06, 10), '#222', 0.3, 0.1, z, 0, 0, Math.PI / 2]]), [B(0.015, 1.2, 0.015), '#777', 0.22, 1.2, 0.3], [B(0.25, 0.16, 0.01), '#ff6f00', 0.34, 1.72, 0.3]]));
        const eyes = bake([[S(0.035, 6), '#00e5ff', -0.08, 0.46, -0.38], [S(0.035, 6), '#00e5ff', 0.08, 0.46, -0.38]], new THREE.MeshStandardMaterial({ color: '#00e5ff', emissive: '#00e5ff', emissiveIntensity: 1.2 })); g.add(eyes); scene.add(g);
        const { e } = ev.sp; ev.bots.push({ g, e, s: ev.sp.t * e.len + i * 3, dir: i ? -1 : 1, side: i ? 1 : -1, tip: 0, x: 0, y: 0, z: 0 });
      }
    },
    update(ev, dt, pl) {
      for (const b of ev.bots) {
        if (b.tip > 0) { b.tip -= dt; b.g.rotation.z = Math.min(1.5, b.g.rotation.z + dt * 6); if (b.tip <= 0) { b.g.rotation.z = 0; say(b, 'REBOOTING… DELIVERY RESUMED.', 1800); } continue; }
        const r = M.roads[b.e.r]; b.s += b.dir * dt * 1.3;
        if (b.s > b.e.len || b.s < 0) { const node = b.s > b.e.len ? b.e.b : b.e.a, opts = nodeEdges[node].filter(q => q !== b.e && isWalkType(M.roads[q.r].t) && !M.roads[q.r].b); if (!opts.length) { b.dir *= -1; b.s = clamp(b.s, 0, b.e.len); } else { b.e = pick(opts); b.dir = b.e.a === node ? 1 : -1; b.s = b.dir > 0 ? 0 : b.e.len; } }
        const L = b.e.len || 1, ux = (NX(b.e.b) - NX(b.e.a)) / L, uz = (NZ(b.e.b) - NZ(b.e.a)) / L, rr = M.roads[b.e.r], off = (rr.t <= 6 ? rr.w / 2 + 1.2 : 0.4) * b.side;
        b.x = NX(b.e.a) + ux * b.s - uz * off; b.z = NZ(b.e.a) + uz * b.s + ux * off; b.y = walkY(b.x, b.z, b.y + 1);
        b.g.position.set(b.x, b.y, b.z); b.g.rotation.y = Math.atan2(-ux * b.dir, -uz * b.dir);
        const d = Math.hypot(pl.x - b.x, pl.z - b.z);
        if (d < 0.85 && Math.hypot(pl.dvx || 0, pl.dvz || 0) > 2.5 && !pl.vehicle) { b.tip = 5; say(b, pick(['HELP. I HAVE FALLEN.', 'PLEASE RATE 5 STARS.', 'YOUR SOUP IS SAFE. PROBABLY.']), 2500); sfx.bump(); }
        if (d < 3 && Math.random() < dt * 0.2) say(b, pick(['BEEP BOOP. EXCUSE ME.', 'ON MY WAY! 3 MIN AWAY.', 'HELLO HUMAN.', '🤖 *happy beeps*']), 1800);
        if (rr && Math.random() < dt * 0.02) { const p = peds.find(q => Math.hypot(q.x - b.x, q.z - b.z) < 6); if (p) say(p, pick(['Aww, look at the little guy!', 'Is it carrying my sushi?', 'They\'re taking over, I swear.']), 2000); }
      }
      ev.x = ev.bots[0].x; ev.z = ev.bots[0].z;
    },
    use(ev, pl) { for (const b of ev.bots) if (Math.hypot(pl.x - b.x, pl.z - b.z) < 1.8) return ['🤖 Pat the delivery robot', () => { say(b, pick(['BEEP BOOP. AFFECTION RECEIVED.', 'ERROR: TOO CUTE.', 'THANK YOU. 1 STAR. JUST KIDDING. 5 STARS.']), 2200); beep([880, 1320], 0.08, 'square', 0.03, 0.1); }]; return false; },
    talkers: ev => ev.bots,
    end(ev) { for (const b of ev.bots) scene.remove(b.g); },
  },
  wedding: {
    w: () => (day() && dry() && G.season !== 'winter' && H() > 10 && H() < 19 ? 1.2 : 0), spot: (px, pz) => parkSpot(px, pz, 8),
    build(ev) {
      const g = group(ev), parts = [[B(0.1, 2.4, 0.1), '#f4f4f4', -1, 1.2, 0], [B(0.1, 2.4, 0.1), '#f4f4f4', 1, 1.2, 0]], tor = new THREE.TorusGeometry(1, 0.06, 6, 16, Math.PI);
      parts.push([tor, '#f4f4f4', 0, 2.4, 0]); for (let i = 0; i < 14; i++) { const a = i / 13 * Math.PI; parts.push([S(0.13, 7), pick(['#f8bbd0', '#ffffff', '#f48fb1', '#fff59d']), Math.cos(a) * 1, 2.4 + Math.sin(a) * 1, 0]); }
      g.add(bake(parts));
      ev.bride = addActor(ev, -0.35, 0.3, 'idle', { shirt: '#fbfbf8', skirt: '#fbfbf8', pants: '#f1c9a5', hat: null, coat: null, bag: null, cup: null, sbag: null, scarf: null }, 0, 6);
      ev.groom = addActor(ev, 0.35, 0.3, 'idle', { shirt: '#1a1a1a', pants: '#1a1a1a', coat: null, hat: null, bag: null, cup: null, sbag: null, skirt: null }, 0, 6);
      ev.photo = addActor(ev, 0, 6.5, 'stand', { shirt: '#37474f', bag: '#1a1a1a', cup: null }, 0, 0);
      for (let i = 0; i < 5; i++) addActor(ev, R(-4, -2) * (i % 2 ? -1 : 1), R(1.5, 3.5), 'idle', { coat: null }, 0, 0.3);
      ev.flash = new THREE.Mesh(S(0.12, 8), new THREE.MeshBasicMaterial({ color: '#ffffff' })); const [fx, fz] = W(ev, 0, 6.2); ev.flash.position.set(fx, walkY(fx, fz) + 1.6, fz); ev.flash.visible = false; scene.add(ev.flash); ev.sh = 3;
    },
    update(ev, dt, pl) {
      ev.sh -= dt; ev.flash.visible = ev.sh > -0.12 && ev.sh < 0;
      if (ev.sh < -0.12) { ev.sh = R(5, 8); say(ev.photo, pick(['Say CHEESE!', 'Beautiful! Now look at each other!', 'One more! Pretend the mountains are out!', 'Gorgeous! Now one with the… geese? Okay.']), 2200); const k = Math.random() < 0.5 ? 'wave' : 'idle'; ev.bride.kind = ev.groom.kind = k; }
      ev.bride.phase += dt * 3; ev.groom.phase += dt * 3;
      // you walked into the photo?
      const [ax, az] = W(ev, 0, 6.5), [bx, bz] = W(ev, 0, 0.3), dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, t = clamp(((pl.x - ax) * dx + (pl.z - az) * dz) / L2, 0, 1), dd = Math.hypot(pl.x - ax - dx * t, pl.z - az - dz * t);
      if (dd < 1.0 && t > 0.1 && t < 0.9 && !pl.vehicle && G.t - (ev.blk || -99) > 8) { ev.blk = G.t; ev.inShot = (ev.inShot || 0) + 1; say(ev.photo, ev.inShot === 1 ? 'Excuse me! You\'re in the shot!' : '…you know what, stay. You\'re in the album now.', 2800); if (ev.inShot === 2) ui.toast('📸 Photobomb!', 'You are now in a stranger\'s wedding album. Forever.', 3500); }
    },
    use: (ev, pl) => near(ev, pl, 0, 0.3, 3.5) && !ev.congrats && ['💐 Congratulate the couple', () => { ev.congrats = true; pl.karma += 1; say(ev.bride, 'Thank you!! Want some cake?', 2500); say(ev.groom, 'We met on the SeaBus!', 2500); sfx.chime(); }],
    end(ev) { scene.remove(ev.flash); },
  },
  crowfries: {
    w: () => (day() && G.wet < 0.5 ? 1.4 : 0), spot: (px, pz) => sidewalkSpot(px, pz, r => r.t >= 3 && r.t <= 5, 25, 90, 2.2),
    build(ev) {
      const g = group(ev); g.add(bake([[B(1.6, 0.06, 0.45), '#8d6e63', 0, 0.45, 0], [B(1.6, 0.4, 0.06), '#8d6e63', 0, 0.75, -0.22], [B(0.06, 0.45, 0.4), '#37474f', -0.7, 0.22, 0], [B(0.06, 0.45, 0.4), '#37474f', 0.7, 0.22, 0]]));
      ev.p = addActor(ev, 0, 0.05, 'sit', { cup: null, sbag: null }, 0, 3); ev.p.yoff = 0.05; place(ev, ev.p, 0, 0.05);
      ev.fries = bake([[B(0.12, 0.12, 0.08), '#d32f2f', 0, 0, 0], ...Array.from({ length: 6 }, (_, i) => [B(0.015, 0.1, 0.015), '#fdd835', -0.04 + i * 0.016, 0.08, 0])]); const [fx, fz] = W(ev, 0.18, 0.35); ev.fries.position.set(fx, ev.p.y + 0.62, fz); scene.add(ev.fries);
      ev.crow = new THREE.Group(); ev.crow.add(bake([[S(0.13, 8).scale(0.8, 0.8, 1.6), '#121214', 0, 0.16, 0], [S(0.07, 7), '#121214', 0, 0.26, -0.18], [new THREE.ConeGeometry(0.025, 0.08, 6).rotateX(-Math.PI / 2), '#2a2a2a', 0, 0.25, -0.27], [B(0.02, 0.1, 0.02), '#2a2a2a', -0.04, 0.05, 0], [B(0.02, 0.1, 0.02), '#2a2a2a', 0.04, 0.05, 0]]));
      ev.wings = [-1, 1].map(s => { const w = bake([[B(0.3, 0.02, 0.15), '#17171a', s * 0.15, 0, 0]]); w.position.set(s * 0.05, 0.2, 0); ev.crow.add(w); return w; }); scene.add(ev.crow);
      ev.cp = { x: 3.5, y: 4, z: 2.5 }; ev.life = 45;
    },
    update(ev, dt, pl, d) {
      const t = ev.t, c = ev.cp, flap = (on) => ev.wings.forEach((w, i) => w.rotation.z = on ? Math.sin(t * 30) * 0.8 * (i ? 1 : -1) : (i ? -0.05 : 0.05));
      if (t < 4) { flap(false); } else if (t < 6) { c.y = 4 - (t - 4) * 2; c.x = 3.5 - (t - 4) * 0.5; flap(true); }
      else if (t < 14) { c.y = 0; const k = (t - 6) / 8; c.x = 2.5 - k * 2.2 + Math.sin(t * 2) * 0.2; c.z = 2.5 - k * 2.1; flap(false); if (Math.floor(t * 3) % 4 === 0) c.y = 0.05; }
      else if (t < 15) { c.x = 0.3; c.z = 0.4; c.y = 0.6; flap(true); if (!ev.stole) { ev.stole = true; say(ev.p, pick(['HEY!! MY FRIES!!', 'NOOO! Not the fries!', 'You little — GIVE THAT BACK!']), 3000); for (const p of peds) if (Math.hypot(p.x - ev.x, p.z - ev.z) < 20 && Math.random() < 0.5) { say(p, pick(['Hahaha!', 'Crows remember faces, you know.', 'Classic Vancouver crow.', 'That crow eats better than me.']), 2400); break; } if (d < 40) discover('crowfries'); } }
      else { const k = t - 15; c.x = 0.3 + k * 4; c.y = 0.6 + k * 2.5; c.z = 0.4 + k * 1.5; flap(true); }
      const [x, z] = W(ev, c.x, c.z), base = c.y > 0.1 ? ev.p.y - ev.p.yoff : walkY(x, z); ev.crow.position.set(x, base + c.y, z);
      const [px2, pz2] = W(ev, 0, 0); ev.crow.rotation.y = t < 15 ? Math.atan2(-(px2 - x), -(pz2 - z)) : ev.yaw + Math.PI * 0.6;
      if (ev.stole) { ev.fries.scale.setScalar(Math.max(0.6, 1 - (t - 15))); }
      if (t > 15 && t < 15.1) ev.p.kind = 'wave';
    },
    end(ev) { scene.remove(ev.crow); scene.remove(ev.fries); },
  },
  raccoons: {
    w: () => (G.night > 0.55 ? 3 : 0), spot: (px, pz) => sidewalkSpot(px, pz, r => r.t === 6 && !(r.n >= 0), 25, 120, 0.8),
    build(ev) {
      const g = group(ev); g.add(bake([[B(0.6, 0.68, 0.92), '#2f855a', 0, 0.3, 0, 0, 0, Math.PI / 2], [B(0.66, 0.06, 0.74), '#276749', 0.5, 0.3, 0.2, 0, 0, 1.2], ...Array.from({ length: 8 }, (_, i) => [B(R(0.1, 0.3), 0.04, R(0.1, 0.25)), pick(['#f4f4f4', '#d7ccc8', '#8d6e63', '#ffcc80', '#c62828']), R(-1.2, -0.5), 0.02, R(-0.8, 0.8), 0, R(0, 3), 0])]));
      ev.coons = []; for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) { const m = bake([[S(0.2, 8).scale(1, 0.8, 1.4), '#6b6f73', 0, 0.22, 0], [S(0.13, 8), '#7a7e82', 0, 0.3, -0.3], [B(0.24, 0.06, 0.02), '#1a1a1a', 0, 0.32, -0.41], [S(0.04, 6), '#2a2a2a', -0.07, 0.42, -0.28], [S(0.04, 6), '#2a2a2a', 0.07, 0.42, -0.28], [C(0.06, 0.04, 0.4, 8), '#3a3a3a', 0, 0.26, 0.38, 1.1], ...[[-0.1, -0.15], [0.1, -0.15], [-0.1, 0.15], [0.1, 0.15]].map(([x, z]) => [B(0.06, 0.14, 0.06), '#2a2a2a', x, 0.07, z])]); scene.add(m); ev.coons.push({ m, lx: R(-1.5, 0.5), lz: R(-0.9, 0.9), yaw: R(0, 6), ph: R(0, 6), run: 0, x: 0, z: 0, y: 0 }); }
      ev.coons[0].lx = 0; ev.coons[0].lz = 0; ev.coons[0].inBin = true;
    },
    update(ev, dt, pl, d) {
      if (d < 9 && !ev.scat && !pl.vehicle) { ev.scat = true; ev.life = Math.min(ev.life, 6); say(ev.coons[0], pick(['🦝 *HISSS*', '🦝 *chitter chitter*', '🦝 (this is OUR lane)']), 2000); discover('raccoons'); }
      for (const c of ev.coons) {
        c.ph += dt * (c.run ? 14 : 3);
        if (ev.scat) { if (!c.run) { c.run = 1; c.yaw = Math.atan2(c.x - pl.x, c.z - pl.z); } c.x += Math.sin(c.yaw) * 5 * dt; c.z += Math.cos(c.yaw) * 5 * dt; c.y = walkY(c.x, c.z, c.y + 1); c.m.position.set(c.x, c.y + Math.abs(Math.sin(c.ph)) * 0.05, c.z); c.m.rotation.y = c.yaw + Math.PI; continue; }
        [c.x, c.z] = W(ev, c.lx + Math.sin(c.ph * 0.3) * 0.2, c.lz); c.y = walkY(c.x, c.z); c.m.position.set(c.x, c.y + (c.inBin ? 0.15 : 0), c.z); c.m.rotation.set(Math.sin(c.ph) * 0.15, c.yaw + Math.sin(c.ph * 0.5) * 0.4, 0);
      }
    },
    talkers: ev => ev.coons,
    end(ev) { for (const c of ev.coons) scene.remove(c.m); },
  },
  lemonade: {
    w: () => ((G.season === 'summer' || G.season === 'spring') && day() && dry() && H() > 10 && H() < 18 ? 2 : 0), spot: (px, pz) => sidewalkSpot(px, pz, r => r.t === 5, 40, 150, 2.0),
    build(ev) {
      const g = group(ev); g.add(bake([[B(1.4, 0.06, 0.6), '#f4f1e4', 0, 0.75, 0], [B(1.3, 0.72, 0.02), '#ffffff', 0, 0.38, 0.29], [B(0.06, 0.75, 0.06), '#8d6e63', -0.6, 0.37, -0.2], [B(0.06, 0.75, 0.06), '#8d6e63', 0.6, 0.37, -0.2], [C(0.09, 0.08, 0.26, 10), '#fff176', -0.3, 0.92, 0], ...[0, 0.12, 0.24, 0.36].map(x => [C(0.035, 0.03, 0.09, 8), '#ffeb3b', x, 0.83, 0.05]), [B(0.5, 0.05, 0.5), '#1976d2', 0.2, 0.42, -1.3], [B(0.5, 0.5, 0.05), '#1976d2', 0.2, 0.65, -1.53]]));
      const s = sign('LEMONADE 50¢\n🍋 ICE COLD 🍋', 1.25, 0.6, '#fff59d', '#e65100', 512, 256); s.position.set(0, 0.42, 0.305); g.add(s);
      ev.kids = [addActor(ev, -0.35, -0.5, 'idle', { cup: null, sbag: null, bag: null }, 0, 3, 0.66), addActor(ev, 0.35, -0.5, 'wave', { cup: null, sbag: null, bag: null }, 0, 3, 0.62)];
      const par = addActor(ev, 0.2, -1.35, 'sit', { cup: '#f4f1ea' }, 0, 2); par.yoff = 0.05; place(ev, par, 0.2, -1.35);
    },
    update(ev, dt, pl, d) { for (const k of ev.kids) k.phase += dt * 3; ev.st = (ev.st || 2) - dt; if (ev.st < 0 && d < 30) { ev.st = R(6, 9); say(pick(ev.kids), pick(['LEMONADE! FIFTY CENTS!', 'Fresh lemonade! We used REAL lemons!', 'It\'s for charity! (Our charity.)', 'Mister! MISTER! Lemonade?']), 2500); } },
    use: (ev, pl) => near(ev, pl, 0, 0.6, 2.6) && ['🍋 Buy lemonade ($1)', () => { if (pl.money < 1) { ui.toast('Broke!', 'The kids give you one for free out of pity.'); } else pl.money -= 1; pl.health = Math.min(100, pl.health + 20); pl.karma += 1; sfx.coin(); say(ev.kids[0], pick(['THANK YOU!! You\'re our first customer!', 'Mom! MOM! We made a DOLLAR!', 'Keep the change? It\'s… it\'s exact. Okay!']), 2800); ui.toast('🍋 Lemonade!', 'Mostly sugar. Perfect. (+20 health, +1 karma)', 2500); }],
  },
};
let sloganT = null;
function sloganTex() { return sloganT || (sloganT = canvasTex(256, 1536, (c) => { SLOGANS.forEach((s, i) => { c.fillStyle = ['#ffffff', '#fff59d', '#b3e5fc', '#f8bbd0', '#c8e6c9'][i % 5]; c.fillRect(0, i * 128, 256, 128); c.strokeStyle = '#111'; c.lineWidth = 6; c.strokeRect(3, i * 128 + 3, 250, 122); c.fillStyle = ['#c62828', '#1565c0', '#2e7d32', '#111', '#6a1b9a'][i % 5]; c.textAlign = 'center'; c.textBaseline = 'middle'; let fs = 40; c.font = `900 ${fs}px Impact, Arial`; const ws = s.split(' '), l1 = ws.slice(0, Math.ceil(ws.length / 2)).join(' '), l2 = ws.slice(Math.ceil(ws.length / 2)).join(' '); while ((c.measureText(l1).width > 236 || c.measureText(l2).width > 236) && fs > 14) { fs -= 2; c.font = `900 ${fs}px Impact, Arial`; } c.fillText(l1, 128, i * 128 + 44); c.fillText(l2, 128, i * 128 + 88); }); }, false)); }
const daily = new Set();
function throwBall(ev, x, z, yaw, dist) { const b = ev.b, fx = -Math.sin(yaw), fz = -Math.cos(yaw); b.x = x + fx * 0.5; b.z = z + fz * 0.5; b.y = walkY(x, z) + 1.6; const sp = dist / 1.6; b.vx = fx * sp; b.vz = fz * sp; b.vy = 6; b.held = 'air'; ev.st = 'chase'; sfx.swing?.(); }

function startEvent(pl, forced) {
  const cand = forced ? [forced] : Object.keys(TYPES).filter(k => !events.some(e => e.type === k) && TYPES[k].w() > 0);
  let tot = 0; for (const k of cand) tot += forced ? 1 : TYPES[k].w(); let r = Math.random() * tot, type = cand[0];
  for (const k of cand) { r -= forced ? 1 : TYPES[k].w(); if (r <= 0) { type = k; break; } }
  if (!type) return null; const T = TYPES[type], sp = T.spot(pl.x, pl.z); if (!sp) return null;
  const ev = { type, x: sp.x, z: sp.z, yaw: sp.yaw, sp, actors: [], t: 0, life: R(240, 420), g: null };
  try { T.build(ev); } catch (err) { console.warn('event build failed', type, err); endEvent(ev); return null; }
  events.push(ev); return ev;
}
function endEvent(ev) { TYPES[ev.type].end?.(ev); if (ev.g) { scene.remove(ev.g); ev.g.traverse(o => o.geometry?.dispose?.()); } const i = events.indexOf(ev); if (i >= 0) events.splice(i, 1); }

// ---------- environment: leaves / petals, manhole steam, sprinklers, rain ripples, gusts ----------
const LEAVES = 380; let leafIM = null; const leaves = [];
const wind = { x: 1.2, z: 0.4, gust: 0, gT: 90 };
const FALLC = ['#c0392b', '#e67e22', '#f1c40f', '#d35400', '#a04000', '#b7950b', '#8e5a2b'], PETAL = ['#ffc0d9', '#ffb7c5', '#fdd7e4', '#ffffff', '#ffd1dc'];
function initLeaves() { leafIM = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.11, 0.075), new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.8 }), LEAVES); leafIM.count = 0; leafIM.frustumCulled = false; leafIM.setColorAt(0, _c.set('#fff')); scene.add(leafIM); }
let cherryNear = 0, cherryT = 0, nearCh = [];
function updateLeaves(dt, pl) {
  const s = G.season; cherryT -= dt; if (cherryT < 0) { cherryT = 2; nearCh = s === 'spring' ? cherryTrees.filter(t => Math.abs(t.x - pl.x) < 70 && Math.abs(t.z - pl.z) < 70) : []; cherryNear = nearCh.length; }
  const urban = !pl.flying && heightAt(pl.x, pl.z) < 700;
  let want = !urban ? 0 : s === 'fall' ? 260 : s === 'spring' ? (cherryNear ? Math.min(360, 80 + cherryNear * 25) : 30) : s === 'summer' ? 25 : 0;
  if (G.wet > 0.5) want *= 0.4; want = Math.min(LEAVES, want * (1 + wind.gust * 0.6));
  while (leaves.length < want) leaves.push({ dead: true });
  if (leaves.length > want + 20) leaves.length = Math.floor(want);
  let n = 0;
  for (const l of leaves) {
    if (l.dead) {
      let x, z; if (s === 'spring' && nearCh.length && Math.random() < 0.8) { const t = pick(nearCh); x = t.x + R(-4, 4); z = t.z + R(-4, 4); } else { x = pl.x + R(-40, 40); z = pl.z + R(-40, 40); }
      const gy = groundY(x, z); l.x = x; l.z = z; l.gy = Math.max(gy, walkY(x, z)); l.y = l.gy + R(2, s === 'spring' ? 7 : 13); l.vy = -R(0.5, 1.1) * (s === 'summer' ? 0.35 : 1); l.rx = R(0, 6); l.ry = R(0, 6); l.sp = R(2, 6); l.lie = R(3, 8); l.dead = false;
      l.col = s === 'fall' ? pick(FALLC) : s === 'spring' ? pick(PETAL) : '#f4f4f0'; l.sc = s === 'spring' ? 0.7 : s === 'summer' ? 0.45 : R(0.9, 1.5); l.cDirty = true;
    }
    if (l.y > l.gy + 0.02) { const fl = Math.sin(G.t * l.sp + l.rx) * 0.6; l.x += (wind.x * (1 + wind.gust * 4) + fl) * dt * 0.8; l.z += (wind.z * (1 + wind.gust * 4) + Math.cos(G.t * l.sp * 0.7 + l.ry)) * dt * 0.8; l.y += (l.vy + wind.gust * 0.8) * dt; l.rx += dt * l.sp; l.ry += dt * l.sp * 0.6; if (l.y < l.gy + 0.02) { l.y = l.gy + 0.02; l.rx = Math.PI / 2; } }
    else { l.lie -= dt; if (wind.gust > 0.5) { l.y += 0.5; } if (l.lie < 0) l.dead = true; }
    if (Math.abs(l.x - pl.x) > 60 || Math.abs(l.z - pl.z) > 60) l.dead = true;
    _q.setFromEuler(_eu.set(l.rx, l.ry, 0)); _m4.compose(_v.set(l.x, l.y, l.z), _q, _s.setScalar(l.sc)); leafIM.setMatrixAt(n, _m4); if (l.cDirty || true) leafIM.setColorAt(n, _c.set(l.col)); n++;
  }
  leafIM.count = n; leafIM.instanceMatrix.needsUpdate = true; if (leafIM.instanceColor) leafIM.instanceColor.needsUpdate = true;
}
// steam vents + sprinklers + ripples: Points / instanced rings
const soft = canvasTex(64, 64, (c) => { const g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 64, 64); }, false);
const STEAMN = 14 * 12; let steamPts = null, coverIM = null, vents = [], ventT = 0;
const sprN = 6 * 70; let sprPts = null, sprinklers = [], sprT = 0;
const RIP = 160; let ripIM = null; const rips = [];
function initFx() {
  const mk = (n, size, opa, blend) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); const p = new THREE.Points(g, new THREE.PointsMaterial({ size, map: soft, transparent: true, opacity: opa, depthWrite: false, vertexColors: true, blending: blend })); p.frustumCulled = false; scene.add(p); return p; };
  steamPts = mk(STEAMN, 2.4, 0.5, THREE.AdditiveBlending); sprPts = mk(sprN, 0.22, 0.85, THREE.NormalBlending);
  coverIM = new THREE.InstancedMesh(C(0.38, 0.38, 0.03, 16), new THREE.MeshStandardMaterial({ color: '#3a3a3a', metalness: 0.6, roughness: 0.5 }), 14); coverIM.count = 0; coverIM.frustumCulled = false; coverIM.receiveShadow = true; scene.add(coverIM);
  ripIM = new THREE.InstancedMesh(new THREE.RingGeometry(0.82, 1, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }), RIP); ripIM.count = 0; ripIM.frustumCulled = false; ripIM.setColorAt(0, _c.set('#fff')); scene.add(ripIM);
  for (let i = 0; i < RIP; i++) rips.push({ t: 99 });
}
function updateSteam(dt, pl) {
  const steamy = (G.season === 'winter' || G.season === 'fall' || G.hour < 9.5 || G.night > 0.5 || G.wet > 0.3) && !pl.flying;
  ventT -= dt;
  if (ventT < 0) {
    ventT = 3; vents = [];
    if (steamy) for (const e of roadGrid.near(pl.x, pl.z, 150, [])) { const r = M.roads[e.r]; if (r.t > 4 || r.b || vents.length >= 12) continue; const h = hash2(e.a * 3.3, e.b * 1.7); if (h > 0.22) continue; const L = e.len || 1, t = 0.3 + hash2(e.b, e.a) * 0.4, x = NX(e.a) + (NX(e.b) - NX(e.a)) * t, z = NZ(e.a) + (NZ(e.b) - NZ(e.a)) * t; if (Math.hypot(x - pl.x, z - pl.z) > 150 || !inTown(x, z)) continue; vents.push({ x, z, y: walkY(x, z), puffs: Array.from({ length: 14 }, (_, k) => ({ a: k / 14 * 3 })) }); }
    vents.forEach((v, i) => { _m4.makeTranslation(v.x, v.y + 0.01, v.z); coverIM.setMatrixAt(i, _m4); }); coverIM.count = vents.length; coverIM.instanceMatrix.needsUpdate = true;
  }
  const pos = steamPts.geometry.attributes.position.array, colA = steamPts.geometry.attributes.color.array; let n = 0;
  const k = 0.16 * (G.night > 0.5 ? 0.7 : 1) * (G.season === 'winter' ? 1.4 : 1);
  for (const v of vents) for (const p of v.puffs) { p.a += dt; if (p.a > 3) { p.a -= 3; p.ox = R(-0.2, 0.2); p.oz = R(-0.2, 0.2); } const u = p.a / 3; pos[n * 3] = v.x + (p.ox || 0) + wind.x * u * 1.5; pos[n * 3 + 1] = v.y + 0.2 + u * 3.2; pos[n * 3 + 2] = v.z + (p.oz || 0) + wind.z * u * 1.5; const f = k * Math.sin(u * Math.PI); colA[n * 3] = colA[n * 3 + 1] = colA[n * 3 + 2] = f; n++; }
  steamPts.geometry.setDrawRange(0, n); steamPts.geometry.attributes.position.needsUpdate = true; steamPts.geometry.attributes.color.needsUpdate = true; steamPts.visible = n > 0;
}
function updateSprinklers(dt, pl) {
  const on = G.season === 'summer' && G.wet < 0.15 && ((G.hour > 6 && G.hour < 10) || (G.hour > 18 && G.hour < 21.5)) && !pl.flying;
  sprT -= dt;
  if (sprT < 0) {
    sprT = 4; sprinklers = sprinklers.filter(s => on && Math.hypot(s.x - pl.x, s.z - pl.z) < 140);
    if (on && sprinklers.length < 6) for (const b of nearBuildings(pl.x, pl.z, 110)) {
      if (!b.house || sprinklers.length >= 6 || hash2(b.x, b.z * 2) > 0.3 || sprinklers.some(s => s.b === b)) continue;
      const nr = nearestRoad(b.x, b.z, 40, r => r.t >= 4 && r.t <= 5); if (!nr) continue;
      const ex = NX(nr.e.a) + (NX(nr.e.b) - NX(nr.e.a)) * nr.t, ez = NZ(nr.e.a) + (NZ(nr.e.b) - NZ(nr.e.a)) * nr.t, L = Math.hypot(b.x - ex, b.z - ez) || 1, off = nr.road.w / 2 + 4.5;
      const x = ex + (b.x - ex) / L * off, z = ez + (b.z - ez) / L * off; if (buildingAt(x, z) || L < off + 2 || isWater(x, z)) continue;
      sprinklers.push({ b, x, z, y: walkY(x, z), a0: Math.atan2(b.x - ex, b.z - ez), drops: Array.from({ length: 70 }, () => ({ t: 99 })), ph: R(0, 6) });
    }
  }
  const pos = sprPts.geometry.attributes.position.array, colA = sprPts.geometry.attributes.color.array; let n = 0;
  for (const s of sprinklers) {
    s.ph += dt; const ang = s.a0 + Math.sin(s.ph * 0.7) * 1.1;   // sweeps back and forth over the lawn (tick-tick-tick)
    for (const d of s.drops) {
      if (d.t > d.life || d.t === 99) { const a = ang + R(-0.06, 0.06), sp = R(5.5, 7.5); d.x = s.x; d.y = s.y + 0.3; d.z = s.z; d.vx = Math.sin(a) * sp * 0.82; d.vz = Math.cos(a) * sp * 0.82; d.vy = sp * 0.57; d.t = R(-0.6, 0); d.life = 1.1; }
      d.t += dt; if (d.t > 0) { d.vy -= 9.8 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; }
      pos[n * 3] = d.x; pos[n * 3 + 1] = d.t > 0 ? d.y : -999; pos[n * 3 + 2] = d.z; colA[n * 3] = 0.85; colA[n * 3 + 1] = 0.93; colA[n * 3 + 2] = 1; n++;
    }
    if (!s.wet && !pl.vehicle && Math.hypot(pl.x - s.x - Math.sin(ang) * 3, pl.z - s.z - Math.cos(ang) * 3) < 2.5) { s.wet = true; ui.toast('💦 Sprinkler!', pick(['Refreshing! Somebody\'s lawn is greener than their water bill.', 'You got sprinklered. Summer in Vancouver!']), 2200); }
  }
  sprPts.geometry.setDrawRange(0, n); sprPts.geometry.attributes.position.needsUpdate = true; sprPts.geometry.attributes.color.needsUpdate = true; sprPts.visible = n > 0;
}
let ripAcc = 0;
function updateRipples(dt, pl) {
  const rate = G.wet > 0.25 && !pl.flying && !Wx.snowing ? G.wet * 140 : 0; ripAcc += rate * dt;
  while (ripAcc > 1) {
    ripAcc -= 1; const r = rips.find(q => q.t > 0.7); if (!r) break;
    let x, z, y; const ps = puddleSpots.filter(p => p.y > -50 && Math.abs(p.x - pl.x) < 50 && Math.abs(p.z - pl.z) < 50);
    if (ps.length && Math.random() < 0.6) { const p = pick(ps), a = R(0, 6.28), rr = Math.sqrt(Math.random()) * p.r * 0.9; x = p.x + Math.cos(a) * rr; z = p.z + Math.sin(a) * rr; y = p.y + 0.015; }
    else { x = pl.x + R(-18, 18); z = pl.z + R(-18, 18); if (isWater(x, z)) continue; y = walkY(x, z) + 0.02; }
    r.x = x; r.y = y; r.z = z; r.t = 0; r.s = R(0.12, 0.3);
  }
  let n = 0;
  for (const r of rips) { if (r.t > 0.7) continue; r.t += dt; const u = r.t / 0.7; _m4.compose(_v.set(r.x, r.y, r.z), _q.identity(), _s.set(r.s * (0.2 + u * 1.6), 1, r.s * (0.2 + u * 1.6))); ripIM.setMatrixAt(n, _m4); ripIM.setColorAt(n, _c.setScalar(Math.max(0, 1 - u) * 0.55)); n++; }
  ripIM.count = n; ripIM.instanceMatrix.needsUpdate = true; if (ripIM.instanceColor) ripIM.instanceColor.needsUpdate = true;
}
// wind gusts: hats fly off heads, umbrellas flip (yours too)
const flying = [];
function updateGusts(dt, pl) {
  const storm = G.weatherName && /storm|Storm/.test(G.weatherName); wind.x = Math.sin(G.t * 0.013) * 1.4 + 0.6; wind.z = Math.cos(G.t * 0.017) * 0.9;
  wind.gT -= dt; if (wind.gT < 0) { wind.gT = storm ? R(20, 45) : R(70, 170); wind.gust = 1; gust(pl); }
  wind.gust = Math.max(0, wind.gust - dt / 4);
  for (let i = flying.length - 1; i >= 0; i--) {
    const f = flying[i]; f.t += dt; if (f.y > f.gy + 0.05) { f.vy -= 5 * dt; f.x += (f.vx + wind.x * wind.gust * 3) * dt; f.z += (f.vz + wind.z * wind.gust * 3) * dt; f.y += f.vy * dt; f.m.rotation.x += f.sx * dt; f.m.rotation.z += f.sz * dt; f.gy = walkY(f.x, f.z, f.y + 1); } else { f.y = f.gy + 0.05; }
    f.m.position.set(f.x, f.y, f.z); if (f.t > 20) { scene.remove(f.m); flying.splice(i, 1); }
  }
}
function gust(pl) {
  if (pl.flying || heightAt(pl.x, pl.z) > 700) return;
  sfx.splash?.(); let n = 0;
  for (const p of peds) {
    if (n >= 3 || Math.hypot(p.x - pl.x, p.z - pl.z) > 40 || !p.visible) continue;
    const umb = G.umbrellas && p.umb && Math.random() < 0.35, hat = p.cols.hat && Math.random() < 0.6; if (!umb && !hat) continue;
    const m = umb ? new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.35, 8), new THREE.MeshStandardMaterial({ color: pick(['#c53030', '#2b6cb0', '#1a202c', '#d69e2e', '#2f855a']), side: THREE.DoubleSide })) : new THREE.Mesh(new THREE.SphereGeometry(0.145, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: p.cols.hat }));
    if (umb) { p.umb = 0; m.rotation.x = Math.PI; } else p.cols.hat = null; p.dirty = true; m.castShadow = true; scene.add(m);
    flying.push({ m, x: p.x, y: p.y + (umb ? 2.1 : 1.9), z: p.z, vx: wind.x * 2 + R(-1, 1), vz: wind.z * 2 + R(-1, 1), vy: R(2, 4), sx: R(-6, 6), sz: R(-6, 6), gy: p.y, t: 0 });
    say(p, umb ? pick(['MY UMBRELLA!', 'Inside out AGAIN?!', 'That\'s my third one this week!']) : pick(['MY HAT!', 'Noooo, my toque!', 'Come BACK!']), 2400); n++;
  }
  if (pl.umbrella && !pl.vehicle && Math.random() < 0.5) { pl.umbrella = false; ui.toast('🌬️ WHOOSH!', 'A gust flipped your umbrella inside out. Locals use hoods for a reason. (Press U to fix it.)', 3200); }
  else if (n) ui.toast('🌬️ Gust of wind!', 'Hats and umbrellas are flying!', 1800);
}

// ---------- rare surprises ----------
// a UFO over the North Shore mountains at night
const UFO_SPOTS = [[49.380, -123.081], [49.368, -122.948], [49.396, -123.204], [49.350, -123.110]].map(([a, b]) => toXZ(a, b));
let ufo = null, ufoNight = -1, ufoT = 20;
function makeUfo() {
  const g = new THREE.Group(); g.add(bake([[S(14, 20).scale(1, 0.22, 1), '#9aa3ad', 0, 0, 0], [S(5.5, 14).scale(1, 0.7, 1), '#7fd4ff', 0, 2.4, 0], [C(6, 9, 2, 20), '#5c636b', 0, -2.2, 0]], new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.8, roughness: 0.25 })));
  const lights = bake(Array.from({ length: 12 }, (_, i) => [S(0.9, 8), '#ffffff', Math.cos(i / 12 * 6.28) * 12.5, -0.3, Math.sin(i / 12 * 6.28) * 12.5]), new THREE.MeshStandardMaterial({ color: '#b7ffb0', emissive: '#7dff6a', emissiveIntensity: 3 })); g.add(lights);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(5, 40, 400, 24, 1, true).translate(0, -200, 0), new THREE.MeshBasicMaterial({ color: '#9dff8a', transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })); g.add(beam);
  scene.add(g); return { g, lights, beam, t: 0 };
}
function updateUfo(dt, pl) {
  ufoT -= dt;
  if (!ufo && ufoT < 0) { ufoT = 20; const night = Math.floor((G.doy || 0) + (G.hour > 12 ? 0.5 : 0)); if (G.night > 0.75 && G.wet < 0.4 && ufoNight !== night && pl.z > -12000 && pl.z < 6000 && Math.random() < (window.__forceUfo ? 1 : 0.035)) { ufoNight = night; window.__forceUfo = false; let best = UFO_SPOTS[0], bd = 1e9; for (const s of UFO_SPOTS) { const d = Math.hypot(s[0] - pl.x, s[1] - pl.z); if (d > 1500 && d < bd) { bd = d; best = s; } } ufo = makeUfo(); ufo.x = best[0]; ufo.z = best[1]; ufo.y = heightAt(best[0], best[1]) + 320; } }
  if (!ufo) return;
  const u = ufo; u.t += dt; const fade = Math.min(1, u.t / 3);
  let y = u.y + Math.sin(u.t * 0.8) * 6, x = u.x + Math.sin(u.t * 0.3) * 30, z = u.z;
  if (u.t > 34) { const k = u.t - 34; y += k * k * 60; x += k * k * 25; }
  u.g.position.set(x, y, z); u.g.rotation.y += dt * 0.6; u.g.scale.setScalar(fade); u.beam.visible = u.t > 8 && u.t < 24; u.beam.scale.set(1, u.t < 10 ? (u.t - 8) / 2 : 1, 1);
  u.lights.material.emissiveIntensity = 2 + Math.sin(u.t * 9) * 1.5;
  const d = Math.hypot(x - pl.x, z - pl.z);
  if (!u.seen && d < 9000 && u.t > 6) { _v.set(x, y, z).project(camera); if (_v.z < 1 && Math.abs(_v.x) < 1 && Math.abs(_v.y) < 1) { u.seen = true; discover('ufo'); ui.toast('👽 What is THAT?!', 'Strange lights over the North Shore mountains… Nobody is going to believe you.', 4500); for (const p of peds) if (Math.hypot(p.x - pl.x, p.z - pl.z) < 30 && Math.random() < 0.5) say(p, pick(['Is that a… drone?', 'Grouse is doing a light show?', 'I KNEW IT. I KNEW IT!']), 2500); } }
  if (u.t > 40) { scene.remove(u.g); ufo = null; }
}
// a black bear raiding a green bin in a North Shore back yard
let bear = null, bearT = 30;
function updateBear(dt, pl) {
  bearT -= dt;
  if (!bear && bearT < 0) {
    bearT = 45; const h = heightAt(pl.x, pl.z);
    if (!pl.flying && pl.z < -3000 && isNorthShoreTown(pl.x, pl.z, h) && Math.random() < (G.night > 0.3 || G.hour < 8 || G.hour > 18 ? 0.4 : 0.15)) {
      for (const b of nearBuildings(pl.x, pl.z, 150)) {
        if (!b.house) continue; const dd = Math.hypot(b.x - pl.x, b.z - pl.z); if (dd < 40 || dd > 150) continue;
        const nr = nearestRoad(b.x, b.z, 40, r => r.t >= 4 && r.t <= 6); if (!nr) continue;
        const ex = NX(nr.e.a) + (NX(nr.e.b) - NX(nr.e.a)) * nr.t, ez = NZ(nr.e.a) + (NZ(nr.e.b) - NZ(nr.e.a)) * nr.t, L = Math.hypot(b.x - ex, b.z - ez) || 1, ux = (b.x - ex) / L, uz = (b.z - ez) / L;
        let x = b.x, z = b.z, k = 0; while (buildingAt(x, z) && k++ < 30) { x += ux; z += uz; } x += ux * 3; z += uz * 3;
        if (buildingAt(x, z) || isWater(x, z) || nearestRoad(x, z, 4)) continue;
        const g = new THREE.Group(), body = bake([[S(0.55, 12).scale(1, 0.85, 1.5), '#141210', 0, 0.75, 0], [S(0.33, 10), '#1a1715', 0, 0.95, -0.85], [B(0.18, 0.16, 0.25), '#6b5136', 0, 0.88, -1.15], [S(0.09, 6), '#141210', -0.2, 1.22, -0.8], [S(0.09, 6), '#141210', 0.2, 1.22, -0.8], ...[[-0.3, -0.45], [0.3, -0.45], [-0.3, 0.45], [0.3, 0.45]].map(([lx, lz]) => [C(0.13, 0.12, 0.55, 8), '#141210', lx, 0.28, lz])]);
        g.add(body); g.position.set(x, walkY(x, z), z); g.rotation.y = Math.atan2(-ux, -uz) + R(-0.5, 0.5); scene.add(g); const bin = bake([[B(0.6, 0.92, 0.68), '#2f855a', 0, 0.3, 0, 0, 0, Math.PI / 2], [B(0.25, 0.04, 0.2), '#f4f4f4', 0.6, 0.02, 0.3], [B(0.2, 0.04, 0.25), '#c62828', 0.8, 0.02, -0.2], [B(0.3, 0.04, 0.15), '#ffcc80', 0.4, 0.02, -0.5]]); { const fx = -Math.sin(g.rotation.y), fz = -Math.cos(g.rotation.y); bin.position.set(x + fx * 1.6, g.position.y, z + fz * 1.6); bin.rotation.y = g.rotation.y; scene.add(bin); }
        bear = { g, bin, body, x, z, y: g.position.y, st: 'eat', t: 0, yaw: g.rotation.y }; break;
      }
    }
  }
  if (!bear) return;
  const B_ = bear, d = Math.hypot(pl.x - B_.x, pl.z - B_.z); B_.t += dt;
  if (!B_.told && d < 55) { B_.told = true; discover('backyardbear'); ui.toast('🐻 A black bear in a back yard!', 'It knocked over a green bin. Real North Shore tip: keep bins locked away until pickup day, give bears space, and never feed them.', 6000); }
  if (B_.st === 'eat') { B_.body.rotation.x = Math.sin(B_.t * 2) * 0.08; if (d < 22) { B_.st = 'stand'; B_.t = 0; say(B_, '*HUFF*', 1800); } }
  else if (B_.st === 'stand') { B_.body.rotation.x = Math.min(1.1, B_.t * 1.5); B_.body.position.y = Math.min(0.5, B_.t * 0.6); if (B_.t > 2) { B_.st = 'run'; B_.t = 0; B_.yaw = Math.atan2(-(B_.x - pl.x), -(B_.z - pl.z)); B_.body.rotation.x = 0; B_.body.position.y = 0; } }
  else { const sx = -Math.sin(B_.yaw), sz = -Math.cos(B_.yaw); B_.x += sx * 7 * dt; B_.z += sz * 7 * dt; B_.y = walkY(B_.x, B_.z, B_.y + 1); B_.g.position.set(B_.x, B_.y + Math.abs(Math.sin(B_.t * 9)) * 0.1, B_.z); B_.g.rotation.y = B_.yaw; if (B_.t > 7) { scene.remove(B_.g); scene.remove(B_.bin); bear = null; return; } }
  if (d > 400) { scene.remove(B_.g); scene.remove(B_.bin); bear = null; }
}
// escaped balloons
const balloons = []; let balloonT = 60;
function updateBalloons(dt, pl) {
  balloonT -= dt;
  if (balloonT < 0) { balloonT = R(80, 200); if (day() && !pl.flying && balloons.length < 2) { const p = peds.find(q => q.visible && Math.hypot(q.x - pl.x, q.z - pl.z) < 45 && Math.hypot(q.x - pl.x, q.z - pl.z) > 8); if (p) { const col = pick(['#e53935', '#fdd835', '#1e88e5', '#8e24aa', '#43a047', '#ff7043']), g = new THREE.Group(); g.add(bake([[S(0.32, 12).scale(1, 1.2, 1), col, 0, 0.38, 0], [new THREE.ConeGeometry(0.05, 0.08, 6), col, 0, 0.0, 0, Math.PI]], new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.1 }))); g.add(bake([[C(0.004, 0.004, 1.2, 3), '#eeeeee', 0, -0.6, 0]])); scene.add(g); balloons.push({ g, x: p.x, y: p.y + 2, z: p.z, t: 0, ph: R(0, 6) }); say(p, pick(['MY BALLOON!', 'Noooo! Come back!', 'Mom! MOM! The balloon!']), 2500); } } }
  for (let i = balloons.length - 1; i >= 0; i--) { const b = balloons[i]; b.t += dt; b.y += dt * 1.6; b.x += (wind.x * 1.2 + Math.sin(b.t + b.ph) * 0.3) * dt; b.z += (wind.z * 1.2) * dt; b.g.position.set(b.x, b.y, b.z); b.g.rotation.z = Math.sin(b.t * 1.3 + b.ph) * 0.15; if (b.t > 120) { scene.remove(b.g); balloons.splice(i, 1); } }
}
// wacky waving inflatable tube men at car dealers (and on some days a giant inflatable goose)
const dealers = pois.filter(p => p.k === 'shop' && p.s === 'car'); let tubes = [], tubeT = 0, goose = null;
function makeTube(x, z, col) {
  const parts = [[C(0.32, 0.36, 5, 10).translate(0, 2.5, 0), col, 0, 0, 0], [C(0.1, 0.12, 1.6, 8).translate(0, 0.8, 0), col, -0.3, 4.2, 0, 0, 0, 1.4], [C(0.1, 0.12, 1.6, 8).translate(0, 0.8, 0), col, 0.3, 4.2, 0, 0, 0, -1.4], [S(0.07, 6), '#111', -0.12, 4.75, -0.3], [S(0.07, 6), '#111', 0.12, 4.75, -0.3], [B(0.22, 0.05, 0.02), '#111', 0, 4.5, -0.33], [C(0.45, 0.5, 0.5, 12), '#37474f', 0, 0.25, 0]];
  const geo = bake(parts).geometry, base = geo.attributes.position.array.slice(), m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 })); m.position.set(x, walkY(x, z), z); scene.add(m);
  return { m, base, ph: R(0, 6), x, z };
}
function updateTubes(dt, pl) {
  tubeT -= dt;
  if (tubeT < 0) {
    tubeT = 3; const near = dealers.filter(p => Math.hypot(p.x - pl.x, p.z - pl.z) < 260).slice(0, 3), want = new Set(near);
    tubes = tubes.filter(t => { if (want.has(t.p)) return true; scene.remove(t.m); t.m.geometry.dispose(); return false; });
    for (const p of near) if (!tubes.some(t => t.p === p)) for (let k = 0; k < 2; k++) { const nr = nearestRoad(p.x, p.z, 50, r => r.t <= 5); if (!nr) break; const ex = NX(nr.e.a) + (NX(nr.e.b) - NX(nr.e.a)) * nr.t, ez = NZ(nr.e.a) + (NZ(nr.e.b) - NZ(nr.e.a)) * nr.t, L = Math.hypot(p.x - ex, p.z - ez) || 1, off = nr.road.w / 2 + 2.5 + k * 0.3, ux = (NX(nr.e.b) - NX(nr.e.a)) / (nr.e.len || 1), uz = (NZ(nr.e.b) - NZ(nr.e.a)) / (nr.e.len || 1); const x = ex + (p.x - ex) / L * off + ux * (k ? 6 : -6), z = ez + (p.z - ez) / L * off + uz * (k ? 6 : -6); if (buildingAt(x, z) || isWater(x, z)) continue; const t = makeTube(x, z, pick(['#ff1744', '#ffea00', '#00e676', '#2979ff', '#ff9100', '#d500f9'])); t.p = p; tubes.push(t); }
    const gd = dealers.length && G.doy % 3 === 0 ? dealers[G.doy % dealers.length] : null;
    if (goose && (!gd || Math.hypot(gd.x - pl.x, gd.z - pl.z) > 600)) { scene.remove(goose.g); goose = null; }
    if (!goose && gd && Math.hypot(gd.x - pl.x, gd.z - pl.z) < 500) {
      let x = gd.x + 8, z = gd.z + 8; for (let k = 0; k < 12 && (buildingAt(x, z) || nearestRoad(x, z, 6)); k++) { x = gd.x + R(-20, 20); z = gd.z + R(-20, 20); }
      if (!buildingAt(x, z)) { const g = new THREE.Group(); g.add(bake([[S(3, 14).scale(1, 0.8, 1.5), '#6d5a45', 0, 3, 0], [C(0.7, 0.9, 5, 10), '#111111', 0, 6.5, -2.8, -0.25], [S(1.1, 12), '#111111', 0, 9.2, -3.5], [S(0.6, 8).scale(1.2, 0.7, 1), '#f4f4f4', 0, 8.7, -3.6], [new THREE.ConeGeometry(0.45, 1.4, 8).rotateX(-Math.PI / 2), '#2a2a2a', 0, 9.1, -4.8], [S(0.25, 6), '#ffffff', -0.55, 9.5, -4.3], [S(0.25, 6), '#ffffff', 0.55, 9.5, -4.3], [S(0.12, 6), '#111', -0.6, 9.55, -4.5], [S(0.12, 6), '#111', 0.6, 9.55, -4.5], [S(2, 10).scale(0.3, 0.9, 1.4), '#4e3f31', -2.8, 3.4, 0.4], [S(2, 10).scale(0.3, 0.9, 1.4), '#4e3f31', 2.8, 3.4, 0.4], [C(0.3, 0.4, 1.5, 8), '#e65100', -1, 0.75, 0], [C(0.3, 0.4, 1.5, 8), '#e65100', 1, 0.75, 0]])); g.position.set(x, walkY(x, z), z); g.rotation.y = R(0, 6); scene.add(g); goose = { g, t: 0, p: gd }; }
    }
  }
  for (const t of tubes) {
    t.ph += dt; const pos = t.m.geometry.attributes.position.array, b = t.base, coll = Math.max(0, Math.sin(t.ph * 0.45) - 0.85) * 6;   // every so often it collapses and springs back up
    for (let i = 0; i < pos.length; i += 3) { const y = b[i + 1], k = y / 5, sy = 1 - coll * 0.5 * k; pos[i] = b[i] + Math.sin(t.ph * 4 + y * 0.9) * 0.35 * k * k + Math.sin(t.ph * 7 + y) * 0.1 * k + coll * k * 1.2; pos[i + 1] = y * sy; pos[i + 2] = b[i + 2] + Math.cos(t.ph * 3.3 + y * 0.7) * 0.25 * k * k; }
    t.m.geometry.attributes.position.needsUpdate = true; if (Math.floor(t.ph * 2) % 6 === 0) t.m.geometry.computeVertexNormals();
  }
  if (goose) { goose.t += dt; goose.g.children[0].rotation.z = Math.sin(goose.t * 0.9) * 0.06; goose.g.children[0].rotation.x = Math.sin(goose.t * 0.7) * 0.04; if (!goose.told && Math.hypot(goose.g.position.x - pl.x, goose.g.position.z - pl.z) < 80) { goose.told = true; ui.toast('🪿 A GIANT INFLATABLE GOOSE', 'The car dealer\'s "Honk-tober Sales Event". It is 10 metres tall and it is judging you.', 4500); } }
}

// ---------- per frame + E prompt ----------
let spawnT = 6;
export function initCityEvents(disc) { if (disc) discover = disc; crowd = new Crowd(110); initLeaves(); initFx(); setRaccoonSpawner((x, z) => { if (events.some(e => e.type === 'raccoons')) return; const ev = { type: 'raccoons', x: x + 1.5, z, yaw: R(0, 6.28), sp: {}, actors: [], t: 0, life: 12 }; TYPES.raccoons.build(ev); events.push(ev); }); }
export function updateCityEvents(dt, pl) {
  if (!pl.char) return;
  spawnT -= dt;
  const town = !pl.flying && inTown(pl.x, pl.z);
  if (spawnT < 0) { spawnT = R(18, 32); if (town && events.length < 3 && !pl.transit) startEvent(pl); }
  if (window.__forceEvent) { const f = window.__forceEvent; window.__forceEvent = null; for (const e of [...events]) if (e.type === f) endEvent(e); window.__lastEvent = startEvent(pl, f); }
  for (const ev of [...events]) {
    ev.t += dt; const d = Math.hypot(ev.x - pl.x, ev.z - pl.z);
    if (d > 320 || (ev.t > ev.life && d > 60) || ev.life <= 0 || ev.t > ev.life + 240) { endEvent(ev); continue; }
    if (d < 260) TYPES[ev.type].update?.(ev, dt, pl, d);
  }
  const list = []; for (const ev of events) for (const a of ev.actors) { a.visible = Math.hypot(a.x - pl.x, a.z - pl.z) < 200; list.push(a); }
  crowd.draw(list);
  updateLeaves(dt, pl); updateSteam(dt, pl); updateSprinklers(dt, pl); updateRipples(dt, pl); updateGusts(dt, pl);
  updateUfo(dt, pl); updateBear(dt, pl); updateBalloons(dt, pl); updateTubes(dt, pl);
}
// everyone in events who can show a speech bubble (main.js passes these to updateBubbles)
export function lifeTalkers() {
  const out = []; for (const ev of events) { for (const a of ev.actors) if (a.say) out.push(a); const t = TYPES[ev.type].talkers?.(ev); if (t) for (const a of t) if (a.say) out.push(a); }
  if (bear?.say) out.push(bear); return out;
}
// E prompt: events first, then the clutter (bins, cones, scooters, balls…)
export function lifePrompt(pl) {
  if (pl.vehicle || pl.transit || G.dialogOpen) return '';
  for (const ev of events) { const u = TYPES[ev.type].use?.(ev, pl); if (u) { if (tapped('KeyE')) u[1](); return `<kbd>E</kbd> ${u[0]}`; } }
  return cityLifePrompt(pl);
}
export const _events = { events, TYPES, startEvent, endEvent, wind, get ufo() { return ufo; }, get bear() { return bear; }, tubes, leaves, get vents() { return vents; }, get sprinklers() { return sprinklers; } };
