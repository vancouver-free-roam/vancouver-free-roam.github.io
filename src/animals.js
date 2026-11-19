// Wildlife: orcas, seals, geese, raccoons, crows, gulls, eagles, coyotes, bears.
import * as THREE from 'three';
import { G, scene, std, addMesh, toXZ, R, pick, clamp } from './core.js';
import { heightAt, isWater } from './terrain.js';
import { surfaceY, collideBuildings } from './city.js';
import { say } from './people.js';

export const animals = [];
const black = std('#111', { roughness: 0.4 }), whiteM = std('#f2f2f2', { roughness: 0.4 });
const at = (lat, lon) => toXZ(lat, lon);

function orcaModel() {
  const g = new THREE.Group();
  addMesh(new THREE.CapsuleGeometry(0.9, 4.5, 6, 14).rotateX(Math.PI / 2), black, 0, 0, 0, g);
  addMesh(new THREE.SphereGeometry(0.75, 12, 8).scale(0.7, 0.45, 1.6), whiteM, 0, -0.45, -1.2, g);
  addMesh(new THREE.SphereGeometry(0.3, 8, 6).scale(1.1, 0.6, 1.4), whiteM, 0.55, 0.35, -2.2, g); addMesh(new THREE.SphereGeometry(0.3, 8, 6).scale(1.1, 0.6, 1.4), whiteM, -0.55, 0.35, -2.2, g);
  addMesh(new THREE.ConeGeometry(0.35, 2.2, 4).scale(0.3, 1, 1), black, 0, 1.6, 0, g);
  const tail = new THREE.Group(); tail.position.z = 3.2; g.add(tail);
  addMesh(new THREE.BoxGeometry(2.4, 0.12, 0.8), black, 0, 0, 0.3, tail);
  g.userData.tail = tail; return g;
}
function simpleBird(color, wing = 0.6) {
  const g = new THREE.Group(); addMesh(new THREE.SphereGeometry(0.15, 8, 6).scale(1, 0.9, 2), std(color), 0, 0, 0, g, false);
  const wl = new THREE.Group(), wr = new THREE.Group(); g.add(wl, wr);
  addMesh(new THREE.BoxGeometry(wing, 0.02, 0.22).translate(-wing / 2, 0, 0), std(color), 0, 0, 0, wl, false); addMesh(new THREE.BoxGeometry(wing, 0.02, 0.22).translate(wing / 2, 0, 0), std(color), 0, 0, 0, wr, false);
  g.userData.wl = wl; g.userData.wr = wr; return g;
}
function quadruped(color, size, opts = {}) {
  const g = new THREE.Group(), m = std(color);
  addMesh(new THREE.BoxGeometry(0.5, 0.45, 1.0).scale(size, size, size), m, 0, 0.55 * size, 0, g);
  addMesh(new THREE.BoxGeometry(0.36, 0.34, 0.4).scale(size, size, size), m, 0, 0.75 * size, -0.62 * size, g);
  if (opts.mask) addMesh(new THREE.BoxGeometry(0.37, 0.1, 0.2).scale(size, size, size), std('#111'), 0, 0.8 * size, -0.75 * size, g);
  if (opts.ears) for (const s of [-1, 1]) addMesh(new THREE.ConeGeometry(0.06, 0.16, 4).scale(size, size, size), m, s * 0.12 * size, 0.98 * size, -0.62 * size, g);
  const legs = [];
  for (const [x, z] of [[-0.18, -0.38], [0.18, -0.38], [-0.18, 0.38], [0.18, 0.38]]) { const piv = new THREE.Group(); piv.position.set(x * size, 0.38 * size, z * size); g.add(piv); addMesh(new THREE.BoxGeometry(0.12, 0.4, 0.12).translate(0, -0.2, 0).scale(size, size, size), m, 0, 0, 0, piv); legs.push(piv); }
  if (opts.tail) { const t = addMesh(new THREE.CylinderGeometry(0.06, 0.1, 0.5, 6).scale(size, size, size), opts.tailStripes ? std('#555') : m, 0, 0.62 * size, 0.6 * size, g); t.rotation.x = 1.0; }
  g.userData.legs = legs; return g;
}
function goose() {
  const g = new THREE.Group();
  addMesh(new THREE.SphereGeometry(0.28, 10, 8).scale(1, 0.8, 1.5), std('#6b5a48'), 0, 0.4, 0, g);
  addMesh(new THREE.CylinderGeometry(0.06, 0.07, 0.55, 6), std('#111'), 0, 0.75, -0.32, g).rotation.x = -0.3;
  addMesh(new THREE.SphereGeometry(0.09, 8, 6).scale(1, 1, 1.4), std('#111'), 0, 1.0, -0.42, g);
  addMesh(new THREE.BoxGeometry(0.12, 0.05, 0.03), whiteM, 0, 0.98, -0.46, g);
  for (const s of [-1, 1]) addMesh(new THREE.BoxGeometry(0.03, 0.25, 0.03), std('#222'), s * 0.1, 0.12, 0, g);
  return g;
}

function addAnimal(kind, mesh, x, z, extra = {}) { scene.add(mesh); const a = { kind, mesh, x, z, y: 0, yaw: Math.random() * 6, t: Math.random() * 10, home: { x, z }, ...extra }; animals.push(a); return a; }

export function initAnimals() {
  // orca pods swimming loops in English Bay and Burrard Inlet
  for (const [lat, lon, rad, n] of [[49.290, -123.170, 600, 4], [49.300, -123.075, 500, 3], [49.282, -123.200, 900, 3]]) {
    const [cx, cz] = at(lat, lon);
    for (let i = 0; i < n; i++) addAnimal('orca', orcaModel(), cx, cz, { center: { x: cx, z: cz }, rad, ang: i * 0.25, off: R(-12, 12), speed: R(0.018, 0.026), breach: R(5, 20) });
  }
  // harbour seals near Stanley Park
  for (let i = 0; i < 6; i++) { const [x, z] = at(49.3045 + R(-0.003, 0.003), -123.1570 + R(-0.004, 0.004)); if (!isWater(x, z)) continue; const g = new THREE.Group(); addMesh(new THREE.SphereGeometry(0.35, 10, 8).scale(1, 1, 1.3), std('#6a6f6f'), 0, 0, 0, g); addAnimal('seal', g, x, z); }
  // geese gangs in parks (Stanley Park, Vanier, English Bay)
  for (const [lat, lon] of [[49.2955, -123.1385], [49.2985, -123.1335], [49.2770, -123.1440], [49.2900, -123.1500], [49.2955, -123.1290]]) {
    const [x, z] = at(lat, lon); for (let i = 0; i < 6; i++) addAnimal('goose', goose(), x + R(-8, 8), z + R(-8, 8), { flock: { x, z } });
  }
  // raccoons (Chinatown alleys, Stanley Park, West End)
  for (const [lat, lon] of [[49.2797, -123.1010], [49.2960, -123.1360], [49.2865, -123.1330], [49.2740, -123.1180], [49.2635, -123.0960]]) {
    const [x, z] = at(lat, lon); for (let i = 0; i < 2; i++) addAnimal('raccoon', quadruped('#6e6a64', 0.8, { mask: true, ears: true, tail: true, tailStripes: true }), x + R(-6, 6), z + R(-6, 6));
  }
  // coyotes in Stanley Park
  for (let i = 0; i < 3; i++) { const [x, z] = at(49.302 + R(-0.004, 0.004), -123.140 + R(-0.006, 0.006)); addAnimal('coyote', quadruped('#a08060', 1.2, { ears: true, tail: true }), x, z); }
  // black bears on the North Shore + the Grouse grizzlies
  for (const [lat, lon] of [[49.3720, -123.0870], [49.3650, -122.9550], [49.3900, -123.2000], [49.3500, -123.1000], [49.3600, -123.0400]]) { const [x, z] = at(lat, lon); addAnimal('bear', quadruped('#1b1715', 2.4, { ears: true }), x, z); }
  for (const [lat, lon] of [[50.0950, -122.9700], [50.1300, -122.9300], [50.0800, -122.9300], [49.7200, -123.1100]]) { const [x, z] = at(lat, lon); addAnimal('bear', quadruped('#1b1715', 2.4, { ears: true }), x, z); }
  for (let i = 0; i < 8; i++) { const [x, z] = at(49.774 + R(-0.01, 0.01), -123.150 + R(-0.01, 0.01)); addAnimal('eagle', simpleBird('#3a2a1a', 1.1), x, z, { alt: R(40, 120), rad: R(40, 160) }); }
  for (let i = 0; i < 2; i++) { const [x, z] = at(49.3792 + i * 0.0003, -123.0835); addAnimal('bear', quadruped('#6b4a2e', 2.8, { ears: true }), x, z, { name: i ? 'Grinder' : 'Coola' }); }
  // birds: gulls along the waterfront, crows, eagles over Stanley Park
  for (let i = 0; i < 26; i++) { const [x, z] = at(49.288 + R(-0.006, 0.01), -123.115 + R(-0.03, 0.03)); addAnimal('gull', simpleBird('#e9ecef', 0.55), x, z, { alt: R(15, 45), rad: R(15, 50) }); }
  for (let i = 0; i < 40; i++) { const [x, z] = at(49.280 + R(-0.012, 0.012), -123.110 + R(-0.03, 0.03)); addAnimal('crow', simpleBird('#111', 0.4), x, z, { alt: 0, rad: R(5, 20) }); }
  for (let i = 0; i < 4; i++) { const [x, z] = at(49.300 + R(-0.004, 0.004), -123.145 + R(-0.01, 0.01)); addAnimal('eagle', simpleBird('#3a2a1a', 1.1), x, z, { alt: R(70, 140), rad: R(60, 150) }); }
}

export function updateAnimals(dt, pl) {
  for (const a of animals) {
    const dp = Math.hypot(a.x - pl.x, a.z - pl.z);
    a.mesh.visible = dp < (a.kind === 'orca' || a.kind === 'eagle' ? 2500 : 400);
    if (!a.mesh.visible && a.kind !== 'orca') continue;
    a.t += dt;
    switch (a.kind) {
      case 'orca': {
        a.ang += a.speed * dt; const r = a.rad + a.off;
        let nx = a.center.x + Math.cos(a.ang) * r, nz = a.center.z + Math.sin(a.ang) * r;
        if (!isWater(nx, nz)) { a.speed = -a.speed; break; }
        a.yaw = Math.atan2(-(nx - a.x), -(nz - a.z)); a.x = nx; a.z = nz;
        a.breach -= dt; let y = -0.5 + Math.sin(a.t * 0.8) * 0.6, pitch = Math.cos(a.t * 0.8) * 0.15;
        if (a.breach < 0) { const k = -a.breach / 2.2; if (k > 1) a.breach = R(8, 25); else { y = Math.sin(k * Math.PI) * 6 - 0.5; pitch = (0.5 - k) * 1.6; } }
        a.mesh.position.set(a.x, y, a.z); a.mesh.rotation.set(pitch, a.yaw, 0, 'YXZ'); a.mesh.userData.tail.rotation.x = Math.sin(a.t * 3) * 0.4;
        a.y = y; break;
      }
      case 'seal': a.mesh.position.set(a.x + Math.sin(a.t * 0.3) * 3, -0.2 + Math.sin(a.t * 1.5) * 0.15, a.z); break;
      case 'goose': case 'raccoon': case 'coyote': case 'bear': {
        const angry = a.kind === 'goose' && dp < 10 && !pl.vehicle;
        const scared = (a.kind === 'raccoon' || a.kind === 'coyote') && dp < 8 && !a.chased;
        let tx = a.tx ?? a.x, tz = a.tz ?? a.z, sp = a.kind === 'bear' ? 1.2 : 0.8;
        if (angry) { tx = pl.x; tz = pl.z; sp = 3.2; if (!a.honk || a.honk < a.t) { a.honk = a.t + 3; say(a, pick(['HONK!', 'HISSSS!', 'HONK HONK!'])); } if (dp < 1) pl.hurt(4 * dt, 'goose'); }
        else if (scared || a.fleeing > 0) { a.fleeing = (a.fleeing || 2) - dt; tx = a.x + (a.x - pl.x); tz = a.z + (a.z - pl.z); sp = a.kind === 'raccoon' ? 5.5 : 7; }
        else if (!a.tx || Math.hypot(tx - a.x, tz - a.z) < 1 || Math.random() < dt * 0.05) { const h = a.flock || a.home; a.tx = h.x + R(-15, 15); a.tz = h.z + R(-15, 15); sp = 0; }
        if (a.task) ({ tx, tz, sp } = a.task(a, dt) || { tx, tz, sp });
        const ang = Math.atan2(tx - a.x, tz - a.z), d = Math.hypot(tx - a.x, tz - a.z);
        if (d > 0.5 && sp > 0) {
          const nx = a.x + Math.sin(ang) * sp * dt, nz = a.z + Math.cos(ang) * sp * dt;
          if (!isWater(nx, nz)) { a.x = nx; a.z = nz; } a.yaw = Math.atan2(-Math.sin(ang), -Math.cos(ang));
          collideBuildings(a, 0.4);
        }
        a.y = surfaceY(a.x, a.z, a.y + 1);
        a.mesh.position.set(a.x, a.y, a.z); a.mesh.rotation.y = a.yaw;
        if (a.mesh.userData.legs) a.mesh.userData.legs.forEach((l, i) => l.rotation.x = Math.sin(a.t * 10 * (sp > 0 ? 1 : 0) + i * Math.PI) * 0.5);
        break;
      }
      case 'gull': case 'eagle': {
        const ang = a.t * (a.kind === 'eagle' ? 0.15 : 0.5);
        a.x = a.home.x + Math.cos(ang) * a.rad; a.z = a.home.z + Math.sin(ang) * a.rad; a.y = heightAt(a.x, a.z) * 0 + Math.max(0, heightAt(a.x, a.z)) + a.alt + Math.sin(a.t) * 3;
        a.mesh.position.set(a.x, a.y, a.z); a.mesh.rotation.set(0, -ang, (a.kind === 'eagle' ? 0.3 : 0.4));
        const f = Math.sin(a.t * (a.kind === 'eagle' ? 2 : 9)) * 0.5; a.mesh.userData.wl.rotation.z = f; a.mesh.userData.wr.rotation.z = -f; break;
      }
      case 'crow': {
        // at dusk the crows commute east to Burnaby (true story!)
        const dusk = G.hour > 17.5 && G.hour < 20;
        if (dusk) { a.x += 9 * dt; a.y = 40 + Math.sin(a.t) * 5; if (a.x > a.home.x + 1500) a.x = a.home.x - 300; }
        else { if (dp < 4) a.y = Math.min(a.y + dt * 8, 6); else a.y = Math.max(a.y - dt * 4, 0); const ang = a.t * 0.4; a.x = a.home.x + Math.cos(ang) * a.rad * (a.y > 0.5 ? 1 : 0.2); a.z = a.home.z + Math.sin(ang) * a.rad * 0.3; }
        const g = surfaceY(a.x, a.z); a.mesh.position.set(a.x, g + a.y + 0.2, a.z); a.mesh.rotation.y = dusk ? -Math.PI / 2 : a.t;
        const f = a.y > 0.5 ? Math.sin(a.t * 12) * 0.6 : 0; a.mesh.userData.wl.rotation.z = f; a.mesh.userData.wr.rotation.z = -f; break;
      }
    }
  }
}
export const nearestAnimal = (kind, x, z, rad) => animals.filter(a => a.kind === kind).map(a => [a, Math.hypot(a.x - x, a.z - z)]).filter(a => a[1] < rad).sort((a, b) => a[1] - b[1])[0]?.[0];
