// Round "solid things" you can bump into: tree trunks, poles, hydrants, benches, pillars, patio tables…
// Each source registers a list under a tag (replacing its old list); collideStatic pushes a circle out of them.
// Breakable things carry `brk` (the speed in m/s that breaks them) and `refs` (the instanced pieces that draw them):
// a vehicle hitting them that fast knocks them over instead of stopping (see breakables.js).
import * as THREE from 'three';
const CELL = 16, grids = new Map();
const _m = new THREE.Matrix4(), _v = new THREE.Vector3();
// read positions back out of an instanced mesh (for props drawn with instancing)
// opts: { brk: break speed, kind: 'tip' | 'fly' | 'hydrant', parts: [other instanced meshes drawn at the same index] }
export function fromInstances(mesh, r, h, out = [], opts = null) {
  mesh.userData.ver = (mesh.userData.ver || 0) + 1;
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, _m); _v.setFromMatrixPosition(_m); if (_m.elements[0] === 0 && _m.elements[5] === 0) continue;   // hidden
    const c = { x: _v.x, z: _v.z, r, top: _v.y + h };
    if (opts) { c.brk = opts.brk; c.kind = opts.kind || 'tip'; c.refs = [[mesh, i, mesh.userData.ver], ...(opts.parts || []).map(p => [p, i, mesh.userData.ver])]; c.base = _v.y; }
    out.push(c);
  }
  return out;
}
const key = (i, j) => i * 100003 + j;
// list: array of {x, z, r, top}  (top = height of the thing; you pass over it if you're higher)
export function setColliders(tag, list) {
  const g = new Map();
  for (const c of list) { const k = key(Math.floor(c.x / CELL), Math.floor(c.z / CELL)); let a = g.get(k); if (!a) g.set(k, a = []); a.push(c); }
  grids.set(tag, g);
}
let onBreak = null;
export function setBreakHandler(fn) { onBreak = fn; }
// speed + dir (unit vector of travel) are only passed by vehicles: fast enough = breakable things get knocked over
export function collideStatic(obj, r, y = -1e9, speed = 0, dir = null) {
  let hit = false; const ci = Math.floor(obj.x / CELL), cj = Math.floor(obj.z / CELL);
  for (const g of grids.values()) for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
    const a = g.get(key(i, j)); if (!a) continue;
    for (const c of a) {
      if (c.gone || y > c.top) continue;
      const dx = obj.x - c.x, dz = obj.z - c.z, min = r + c.r, d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      if (c.brk && speed >= c.brk && onBreak) { onBreak(c, dir, speed); obj.broke = (obj.broke || 0) + 1; continue; }
      const d = Math.sqrt(d2) || 0.001; obj.x = c.x + dx / d * min; obj.z = c.z + dz / d * min; hit = true;
    }
  }
  return hit;
}
// the top of whatever solid thing you're standing over (bench, rock, parked car, statue base…), if you came down
// onto it from above (its top is at or below your feet + a little step). -Infinity if nothing.
export function topAt(x, z, r, y) {
  let best = -Infinity; const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
  for (const g of grids.values()) for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
    const a = g.get(key(i, j)); if (!a) continue;
    for (const c of a) {
      if (c.gone || c.top > y + 0.45 || c.top <= best || c.noStand) continue;
      const dx = x - c.x, dz = z - c.z, m = c.r + r * 0.6; if (dx * dx + dz * dz < m * m) best = c.top;
    }
  }
  return best;
}
// is something solid within r of (x, z)? (for placing props so they don't overlap, and for people stepping around things)
export function blockedAt(x, z, r, skipTag = null) {
  const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
  for (const [tag, g] of grids) { if (tag === skipTag) continue; for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
    const a = g.get(key(i, j)); if (!a) continue;
    for (const c of a) { if (c.gone) continue; const dx = x - c.x, dz = z - c.z, m = r + c.r; if (dx * dx + dz * dz < m * m) return c; }
  } }
  return null;
}
export const _colliderGrids = grids;   // for tests
