// Shared helpers for the animal and plant models (fauna.js, flora.js, terrain.js forest).
// bake(): merges coloured primitive shapes into ONE geometry with smooth normals, per-vertex colour (with a little random
// jitter so fur, bark and leaves aren't flat) and an `aTint` attribute. Parts coloured 'F' (or 'F0.8' = 80% brightness) are
// white and take the instance colour (fur colour / leaf colour per animal or plant); other parts keep their own colour
// (eyes, noses, hooves, bark, flowers).
import * as THREE from 'three';

export function tintShader(sh) {
  sh.vertexShader = 'attribute float aTint;\n' + sh.vertexShader.replace('#include <color_vertex>', `
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
  vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
  vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor.xyz *= mix( vec3( 1.0 ), instanceColor.xyz, aTint );
#endif`);
}
// gentle wind sway for plants: the higher a vertex (object space y), the more it moves; phase from the instance position
export const WIND_T = { value: 0 };
export function swayShader(sh, amount = 0.07) {
  sh.uniforms.uWindT = WIND_T;
  sh.vertexShader = 'uniform float uWindT;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
  { vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
    float k = max(0.0, transformed.y) * ${amount.toFixed(3)};
    float w = sin(uWindT * 1.7 + ip.x * 0.31 + ip.z * 0.23) + 0.5 * sin(uWindT * 3.1 + ip.z * 0.5);
    transformed.x += w * k; transformed.z += w * k * 0.6; }
#endif`);
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const h3 = (x, y, z) => { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); };
// parts: [geometry, colour, x, y, z, sx, sy, sz, rx, ry, rz, tint?]   (falsy entries are skipped)
export function bake(parts, jit = 0.12) {
  const P = [], N = [], C = [], T = [], I = []; let off = 0;
  for (const p of parts) {
    if (!p) continue;
    let [geo, col, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0, tint] = p;
    let shade = 1;
    if (typeof col === 'string' && col[0] === 'F') { shade = col.length > 1 ? +col.slice(1) : 1; col = '#ffffff'; tint = tint ?? 1; } else tint = tint ?? 0;
    const g = geo.clone(); _q.setFromEuler(_e.set(rx, ry, rz)); _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)); g.applyMatrix4(_m);
    if (!g.attributes.normal) g.computeVertexNormals();
    const pa = g.attributes.position, na = g.attributes.normal; _c.set(col).multiplyScalar(shade);
    for (let i = 0; i < pa.count; i++) {
      const X = pa.getX(i), Y = pa.getY(i), Z = pa.getZ(i); P.push(X, Y, Z); N.push(na.getX(i), na.getY(i), na.getZ(i));
      const j = 1 + (h3(X * 9, Y * 9, Z * 9) - 0.5) * jit; C.push(_c.r * j, _c.g * j, _c.b * j); T.push(tint);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) I.push(g.index.getX(i) + off); else for (let i = 0; i < pa.count; i++) I.push(i + off);
    off += pa.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.setAttribute('aTint', new THREE.Float32BufferAttribute(T, 1)); g.setIndex(I);
  g.computeBoundingSphere(); return g;
}
// common shapes (unit sized)
export const SP = new THREE.SphereGeometry(1, 14, 10), SPs = new THREE.SphereGeometry(1, 8, 6), CN = new THREE.ConeGeometry(1, 1, 8), BX = new THREE.BoxGeometry(1, 1, 1);
export const cylD = (rt, rb, h, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s).translate(0, -h / 2, 0);   // hangs down from y = 0
export const cylU = (rb, rt, h, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s).translate(0, h / 2, 0);    // stands up from y = 0
