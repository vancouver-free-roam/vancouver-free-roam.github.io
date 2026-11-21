// Core: renderer, scene, sky + sun + time of day, input, shared helpers.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

export const G = {
  t: 0, dt: 0, hour: 15.5, night: 0, paused: true,
  keys: {}, pressed: new Set(), mouse: { dx: 0, dy: 0, click: false, locked: false, wheel: 0 },
  camYaw: 0, camPitch: 0.25, camDist: 5,
};

// ---------- math helpers ----------
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const wrapAngle = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
export function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const rand = mulberry32(604);
export const R = (a, b) => a + (b - a) * Math.random();
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export function hash2(i, j) { let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
export function vnoise(x, y) { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j; const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
export function inPoly(x, z, p) { let ins = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) { const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1]; if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) ins = !ins; } return ins; }

// Same projection as tools/geo.mjs
export const LAT0 = 49.283, LON0 = -123.12;
const KX = 111320 * Math.cos(LAT0 * Math.PI / 180), KZ = 110574;
export const toXZ = (lat, lon) => [(lon - LON0) * KX, -(lat - LAT0) * KZ];

// ---------- renderer / scene ----------
export const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('c'), antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.6;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// ---------- anti-flicker for decals ----------
// The log depth buffer (needed to see from your feet to Mt Baker) makes WebGL IGNORE polygonOffset, so every decal that
// relied on it (car shadow blobs, court lines, ski runs, posters, murals, graffiti…) z-fought with the surface under it
// and flashed. depthBias() pulls a material's depth a tiny RELATIVE amount toward the camera inside the log-depth shader
// (works at any distance). biasDecals() finds every material that asked for polygonOffset and converts it.
export function depthBias(mat, k = 0.0004) {
  if (!mat || mat.userData.depthBias) return; mat.userData.depthBias = k;
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (sh, r) {
    if (prev) prev.call(this, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <logdepthbuf_vertex>', `#include <logdepthbuf_vertex>
#if defined( USE_LOGDEPTHBUF ) && defined( USE_LOGDEPTHBUF_EXT )
  vFragDepth *= ${(1 - k).toFixed(6)};
#endif`);
  };
  mat.customProgramCacheKey = function () { return (prevKey ? prevKey.call(this) : '') + '|db' + k; };
  mat.needsUpdate = true;
}
const _seenMats = new WeakSet();
export function biasDecals(root) {
  root.traverse(o => { const ms = o.material; if (!ms) return; for (const m of Array.isArray(ms) ? ms : [ms]) {
    if (!m || _seenMats.has(m)) continue; _seenMats.add(m);
    if (m.polygonOffset && !m.userData.depthBias) depthBias(m, 0.00025 * Math.max(1, Math.abs(m.polygonOffsetFactor || 1)));
  } });
}

export const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xb5c7d3, 0.0000062);
export const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.2, 420000);   // far enough to see Mt Baker, the Olympics and Vancouver Island
renderer.domElement.style.filter = 'saturate(1.16) contrast(1.05)';   // a gentle colour grade: richer greens, blues and sunsets
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------- sky, sun, moon ----------
const sky = new Sky(); sky.scale.setScalar(80000); scene.add(sky);
// three's Sky brightens its colour with its own gamma curve (pow 1/2.4) and the renderer then applies sRGB again: the
// double brightening drained the blue (a pale, whitish sky). Undo it with uSkyPow and set brightness with uSkyGain,
// so clear days are deep blue overhead and paler at the horizon, like the reference photos (VANCOUVER_LOOK.md §1)
// At golden hour / blue hour (uGold) the sky is tinted like the photos: orange toward the sun, pink along the horizon,
// purple-blue higher up (the raw model goes olive-teal at low sun)
export const SKY_LOOK = { pow: { value: 1.9 }, gain: { value: 1 }, gold: { value: 0 }, dusk: { value: 0 }, night: { value: 0 } };   // pow = colour saturation of the sky
sky.material.uniforms.uSkyPow = SKY_LOOK.pow; sky.material.uniforms.uSkyGain = SKY_LOOK.gain; sky.material.uniforms.uGold = SKY_LOOK.gold; sky.material.uniforms.uDusk = SKY_LOOK.dusk; sky.material.uniforms.uNightSky = SKY_LOOK.night;
sky.material.fragmentShader = 'uniform float uSkyPow; uniform float uSkyGain; uniform float uGold; uniform float uDusk; uniform float uNightSky;\n' + sky.material.fragmentShader.replace(/gl_FragColor = vec4\( retColor, 1\.0 \);/, `float skyLum = dot( retColor, vec3( 0.2126, 0.7152, 0.0722 ) );
      vec3 col = max( vec3( 0.0 ), vec3( skyLum ) + ( retColor - vec3( skyLum ) ) * uSkyPow ) * uSkyGain;   // more colour, same brightness (uSkyPow = saturation)
      { float hgt = clamp( direction.y, 0.0, 1.0 ), horizon = 1.0 - smoothstep( 0.0, 0.42, hgt );
        vec2 dh = normalize( direction.xz + 1e-5 ), sh = normalize( vSunDirection.xz + 1e-5 ); float al = max( 0.0, dot( dh, sh ) );
        // golden hour: the raw model goes dark and olive away from a low sun; real sunset skies keep glowing:
        // a pink band low down (orange toward the sun), purple-blue higher up
        vec3 warm = mix( vec3( 0.95, 0.4, 0.55 ), vec3( 1.15, 0.5, 0.18 ), al * al );
        vec3 high = vec3( 0.22, 0.26, 0.62 );
        col += mix( high, warm, horizon ) * uGold * 0.4;
        col = mix( col, col * vec3( 1.06, 0.92, 1.0 ), uGold * 0.5 );
        // blue hour (sun just below the horizon): deep saturated blue with a last pink band low down
        float dl = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) ); col = mix( col, vec3( dl ) * vec3( 0.5, 0.74, 1.65 ), uDusk * 0.7 * ( 1.0 - horizon * horizon * 0.6 ) );   // the raw model turns violet at dusk: steer it to deep blue
        col = mix( col, vec3( dl ) * vec3( 0.42, 0.6, 1.5 ), uNightSky * 0.85 );   // and brownish at night: dark navy instead
        col += mix( vec3( 0.03, 0.08, 0.38 ), vec3( 0.4, 0.22, 0.34 ), horizon * horizon * 0.8 ) * uDusk * 0.35; }
      gl_FragColor = vec4( col, 1.0 );`);
const envSky = new Sky(); envSky.scale.setScalar(1000);
const envScene = new THREE.Scene(); envScene.add(envSky);
envScene.add(new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x34444c, side: THREE.BackSide })));
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
export const sunDir = new THREE.Vector3();
export const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6b7560, 1.0); scene.add(hemi);
export const sun = new THREE.DirectionalLight(0xfff0d8, 3);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: 1, far: 2000 });
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.5;
scene.add(sun, sun.target);

// ---------- real astronomy for Vancouver (49.28 N, 123.12 W) ----------
// The game date is G.doy (day of year, 2026; set by the season) and G.hour (local clock time, with daylight saving).
const D2R = Math.PI / 180, LAT = 49.283 * D2R, LON = -123.12, OBL = 23.439 * D2R;
const astro = { lst: 0, d: 0, eq2scene: new THREE.Matrix4() };
function astroUpdate() {
  const doy = G.doy ?? 200, dst = doy >= 68 && doy < 306 ? 7 : 8;   // PDT (UTC-7) from early March to early November, else PST (UTC-8)
  const ut = G.hour + dst;                                             // hours UT (may spill into the next day, which is fine)
  astro.d = (Date.UTC(2026, 0, 1) - Date.UTC(2000, 0, 1, 12)) / 864e5 + (doy - 1) + ut / 24;   // days since J2000.0
  astro.lst = ((280.46061837 + 360.98564736629 * astro.d + LON) % 360) * D2R;
  // equatorial (x: RA 0h, z: celestial north pole) -> scene (x: east, y: up, z: south)
  const cL = Math.cos(astro.lst), sL = Math.sin(astro.lst), cP = Math.cos(LAT), sP = Math.sin(LAT);
  // hour-angle frame: xh = cL x + sL y, yh = -sL x + cL y, zh = z;  scene = (yh, cP xh + sP zh, sP xh - cP zh)
  astro.eq2scene.set(-sL, cL, 0, 0, cP * cL, cP * sL, sP, 0, sP * cL, sP * sL, -cP, 0, 0, 0, 0, 1);
}
function eqVec(ra, dec, out) { return out.set(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)).applyMatrix4(astro.eq2scene).normalize(); }
function eclToEq(lam, bet) { const x = Math.cos(bet) * Math.cos(lam), y = Math.cos(bet) * Math.sin(lam) * Math.cos(OBL) - Math.sin(bet) * Math.sin(OBL), z = Math.cos(bet) * Math.sin(lam) * Math.sin(OBL) + Math.sin(bet) * Math.cos(OBL); return [Math.atan2(y, x), Math.asin(z)]; }
function sunEcl(d) { const L = 280.460 + 0.9856474 * d, g = (357.528 + 0.9856003 * d) * D2R; return (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * D2R; }
function moonEcl(d) { const L = 218.316 + 13.176396 * d, Mm = (134.963 + 13.064993 * d) * D2R, F = (93.272 + 13.229350 * d) * D2R, Ms = (357.529 + 0.98560028 * d) * D2R, De = (297.85 + 12.190749 * d) * D2R;
  return [(L + 6.289 * Math.sin(Mm) + 1.274 * Math.sin(2 * De - Mm) + 0.658 * Math.sin(2 * De) - 0.186 * Math.sin(Ms)) * D2R, 5.128 * Math.sin(F) * D2R]; }
export const moonDir = new THREE.Vector3(); export const moonInfo = { phase: 0, lit: 0, waxing: true };
// sunrise / sunset / noon height for the current date (the World tab and seasons use these)
let riseDoy = -1;
function computeDayTimes() {
  riseDoy = G.doy ?? 200; const save = G.hour, v = new THREE.Vector3(); let rise = null, set = null, peak = -90;
  for (let h = 0; h < 24; h += 0.05) { G.hour = h; astroUpdate(); const [ra, dec] = eclToEq(sunEcl(astro.d), 0); eqVec(ra, dec, v); const el = Math.asin(v.y) / D2R; if (el > peak) peak = el; if (el > -0.83 && rise === null) rise = h; if (rise !== null && el < -0.83 && set === null && h > rise) set = h; }
  G.hour = save; G.sunRise = rise ?? 6; G.dayLen = (set ?? 18) - G.sunRise; G.sunPeak = peak;
}
// the night sky: real bright stars (RA hours, Dec degrees, magnitude, colour) + a field of faint ones
const BRIGHT = [[6.75,-16.72,-1.46],[14.26,19.18,-0.05,'#ffd2a1'],[18.62,38.78,0.03],[5.28,46.0,0.08,'#fff4d6'],[5.24,-8.2,0.13,'#cfe0ff'],[7.66,5.22,0.34],[5.92,7.41,0.5,'#ffb27a'],[19.85,8.87,0.77],[4.6,16.51,0.85,'#ffc28a'],[16.49,-26.43,1.06,'#ff9a7a'],[13.42,-11.16,1.04,'#d6e4ff'],[7.76,28.03,1.14,'#ffe0b0'],[22.96,-29.62,1.16],[20.69,45.28,1.25],[10.14,11.97,1.35],[7.58,31.89,1.58],[5.42,6.35,1.64],[5.44,28.6,1.65],[5.6,-1.2,1.69],[5.68,-1.94,1.74],[5.53,-0.3,2.23],[5.8,-9.67,2.07],[12.9,55.96,1.77],[11.06,61.75,1.79,'#ffe2b0'],[11.03,56.38,2.37],[11.9,53.69,2.44],[12.26,57.03,3.31],[13.4,54.93,2.23],[13.79,49.31,1.86],[2.53,89.26,1.98],[14.85,74.16,2.08,'#ffd0a0'],[0.68,56.54,2.24,'#ffd8a8'],[0.15,59.15,2.28],[0.95,60.72,2.15],[1.43,60.24,2.68],[1.91,63.67,3.35],[3.41,49.86,1.79],[3.14,40.96,2.1],[2.12,23.46,2.0],[0.14,29.09,2.06],[23.08,15.2,2.49],[23.06,28.08,2.42],[0.22,15.18,2.83],[11.82,14.57,2.14],[10.33,19.84,2.08],[19.51,27.96,3.05],[20.37,40.26,2.23],[17.94,51.49,2.23],[17.58,12.56,2.07],[15.58,26.71,2.23],[18.92,-26.3,2.05],[18.4,-34.38,1.85],[6.98,-28.97,1.5],[7.14,-26.39,1.83],[6.38,-17.96,1.98],[6.63,16.4,1.93],[6.0,44.95,1.9],[0.73,-17.99,2.04],[3.79,24.1,2.87],[3.75,24.37,3.7],[3.82,23.95,3.6],[3.77,24.05,4.1]];
const STAR_R = 340000, starGroups = [];
{ const mk = (size) => { const g = new THREE.BufferGeometry(), m = new THREE.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false }); const p = new THREE.Points(g, m); p.matrixAutoUpdate = false; p.frustumCulled = false; p.renderOrder = -1; scene.add(p); starGroups.push(p); return { pos: [], col: [], p }; };
  const sets = [mk(3.6), mk(2.6), mk(1.7)], c = new THREE.Color();
  const put = (ra, dec, mag, col) => { const s = sets[mag < 1 ? 0 : mag < 2.6 ? 1 : 2], v = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]; s.pos.push(v[0] * STAR_R, v[1] * STAR_R, v[2] * STAR_R); c.set(col || '#ffffff'); const k = Math.min(1, 1.25 - mag * 0.12); s.col.push(c.r * k, c.g * k, c.b * k); };
  for (const [h, d, mag, col] of BRIGHT) put(h * 15 * D2R, d * D2R, mag, col);
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 2600; i++) { const z = rnd() * 2 - 1, ra = rnd() * Math.PI * 2; put(ra, Math.asin(z), 3.2 + rnd() * 2.4, rnd() < 0.15 ? '#ffe4c4' : rnd() < 0.15 ? '#d6e4ff' : null); }
  for (const s of sets) { s.p.geometry.setAttribute('position', new THREE.Float32BufferAttribute(s.pos, 3)); s.p.geometry.setAttribute('color', new THREE.Float32BufferAttribute(s.col, 3)); }
}
// the moon: a disc whose lit part matches the real phase
const moonCanvas = document.createElement('canvas'); moonCanvas.width = moonCanvas.height = 128;
const moonTex = new THREE.CanvasTexture(moonCanvas); moonTex.colorSpace = THREE.SRGBColorSpace;
const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, transparent: true, depthWrite: false, fog: false })); moon.scale.setScalar(10500); moon.renderOrder = -1; scene.add(moon);
let drawnPhase = -1;
function drawMoon(lit, waxing) {
  const c = moonCanvas.getContext('2d'), R = 60, cx = 64, cy = 64; c.clearRect(0, 0, 128, 128);
  c.fillStyle = 'rgba(40,46,60,0.35)'; c.beginPath(); c.arc(cx, cy, R, 0, 6.29); c.fill();   // the dark side, faintly
  c.save(); c.beginPath(); c.arc(cx, cy, R, 0, 6.29); c.clip(); c.fillStyle = '#f2efe6';
  // lit region: half-disc on the sunward side + an ellipse (terminator) that grows/shrinks with the phase
  const side = waxing ? 1 : -1, k = 1 - 2 * lit;   // k: +1 new … -1 full
  c.beginPath(); c.arc(cx, cy, R, -Math.PI / 2, Math.PI / 2, side < 0); c.ellipse(cx, cy, Math.abs(k) * R, R, 0, Math.PI / 2, -Math.PI / 2, (k > 0) === (side > 0)); c.fill();
  c.fillStyle = 'rgba(150,145,135,0.35)'; for (const [x, y, r] of [[48, 50, 12], [76, 44, 9], [70, 80, 14], [44, 82, 7]]) { c.beginPath(); c.arc(x, y, r, 0, 6.29); c.fill(); }   // maria
  c.restore(); moonTex.needsUpdate = true;
}

let lastEnvHour = -99, lastEnvCloud = -1;
const _su = new THREE.Vector3(), _sv = new THREE.Vector3(), _sf = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
export function updateSky(focus) {
  if ((G.doy ?? 200) !== riseDoy) computeDayTimes();
  astroUpdate();
  // the sun, from its real position on the ecliptic
  const [sra, sdec] = eclToEq(sunEcl(astro.d), 0); eqVec(sra, sdec, sunDir);
  const elev = Math.asin(sunDir.y) / D2R;
  G.night = clamp(1 - smooth(-6, 6, elev), 0, 1);
  // the moon: real position + phase
  const [mlam, mbet] = moonEcl(astro.d), [mra, mdec] = eclToEq(mlam, mbet); eqVec(mra, mdec, moonDir);
  const elong = (((mlam - sunEcl(astro.d)) / D2R) % 360 + 360) % 360; moonInfo.lit = (1 - Math.cos(elong * D2R)) / 2; moonInfo.waxing = elong < 180; moonInfo.phase = elong / 360;
  if (Math.abs(moonInfo.phase - drawnPhase) > 0.01) { drawnPhase = moonInfo.phase; drawMoon(moonInfo.lit, moonInfo.waxing); }
  moon.position.copy(camera.position).addScaledVector(moonDir, 330000);
  moon.visible = moonDir.y > -0.05; moon.material.opacity = clamp(0.35 + G.night, 0, 1) * (1 - 0.85 * (G.cloud || 0));
  // stars turn around the North Star with the sidereal time; they fade in after dusk and hide behind clouds
  const starA = clamp((G.night - 0.35) / 0.5, 0, 1) * (1 - 0.95 * (G.cloud || 0));
  for (const s of starGroups) { s.matrix.copy(astro.eq2scene).setPosition(camera.position); s.matrixWorldNeedsUpdate = true; s.material.opacity = starA; s.visible = starA > 0.01; }
  // weather (set by weather.js): cloud 0..1, wet 0..1 (rain), fogW 0..1, flash 0..1 (lightning)
  const cloud = G.cloud || 0, wet = G.wet || 0, fogW = G.fogW || 0, flash = G.flash || 0;
  // golden hour: 0 at midday, 1 when the sun is low (sunrise/sunset glow), fading out after dusk
  const gold = smooth(22, 2, elev) * smooth(-7, -1, elev), grey = cloud * cloud;   // only heavy overcast really greys things out
  for (const s of [sky, envSky]) {
    const u = s.material.uniforms;   // clear = deep blue, low sun = fiery oranges and pinks
    u.sunPosition.value.copy(sunDir); u.turbidity.value = 2.4 + gold * 4.5 + cloud * 9; u.rayleigh.value = Math.max(0.3, 2.8 + gold * 1.4 + G.night - grey * 1.6); u.mieCoefficient.value = 0.003 + gold * 0.006 + cloud * 0.02; u.mieDirectionalG.value = 0.82 - cloud * 0.2;
  }
  sky.position.copy(camera.position);   // the sky travels with you (the map is 100 km long!)
  SKY_LOOK.gold.value = smooth(14, 1, elev) * smooth(-2, 0.5, elev) * (1 - cloud);   // golden hour (sun 14° … 0°)
  SKY_LOOK.dusk.value = smooth(1, -3, elev) * smooth(-11, -5, elev) * (1 - cloud);    // blue hour (sun 0° … -10°)
  SKY_LOOK.gain.value = 0.88 + 0.12 * (SKY_LOOK.gold.value + SKY_LOOK.dusk.value);
  SKY_LOOK.night.value = smooth(-7, -13, elev);   // full night (sun 13° below)
  SKY_LOOK.pow.value = (1.9 - 1.1 * Math.min(1, cloud * 1.3)) * (1 - SKY_LOOK.night.value) + SKY_LOOK.night.value;   // vivid on clear days, plain grey under overcast, plain at night
  const day = 1 - G.night;
  sun.intensity = 4.3 * smooth(-2, 10, elev) * (1 - 0.7 * grey - 0.12 * cloud);   // (with the lower exposure below: deeper sky, same bright ground)
  sun.color.setHSL(0.075 + 0.04 * smooth(2, 30, elev), (0.95 - 0.55 * smooth(5, 35, elev)) * (1 - cloud * 0.6), 0.55 + 0.38 * smooth(0, 25, elev));   // warm gold-orange low, soft white high
  hemi.intensity = (0.29 + 0.98 * day) * (1 - 0.22 * grey) + flash * 4;
  hemi.color.setHSL(0.6 - 0.05 * gold, 0.68 * (1 - cloud * 0.55), 0.45 + 0.35 * day);
  hemi.groundColor.setHSL(0.18 - 0.08 * gold, 0.32, 0.32 * (0.4 + 0.6 * day));
  renderer.toneMappingExposure = (0.6 + 0.35 * G.night) * (1 - 0.2 * grey) + flash * 0.8;
  // distance fog matches the horizon: soft blue by day, peach-orange at sunrise/sunset, grey only under heavy cloud
  scene.fog.color.setHSL(0.57 - 0.5 * gold * (1 - cloud), (0.42 + 0.25 * gold) * (1 - cloud * 0.75), (0.08 + 0.66 * day) * (1 - 0.25 * grey) + flash * 0.3);
  scene.fog.density = 0.0000062 * (1 + fogW * 115 + wet * 16);   // rain: misty far away, but you can still see the ground   // clear days: Mt Baker (100 km) shows through the haze
  // at night the moon is the light source (bright when full, faint when a thin crescent)
  const moonUp = moonDir.y > 0.05 && elev < -2;
  if (moonUp) { sun.intensity = 0.55 * moonInfo.lit * smooth(0, 0.2, moonDir.y) * (1 - 0.85 * cloud); sun.color.setHSL(0.6, 0.35, 0.75); hemi.intensity += 0.12 * moonInfo.lit * (1 - cloud); }
  const lightDir = elev > -2 ? sunDir : moonUp ? moonDir : new THREE.Vector3(0.3, 0.8, 0.4).normalize();
  // move the shadow area in whole shadow-pixel steps, so shadow edges don't shimmer while you move or fly
  { const tex = (sun.shadow.camera.right - sun.shadow.camera.left) / sun.shadow.mapSize.x, u = _su.crossVectors(lightDir, _up).normalize(), v = _sv.crossVectors(u, lightDir).normalize();
    _sf.set(focus.x, focus.y, focus.z); const a = _sf.dot(u), b = _sf.dot(v); _sf.addScaledVector(u, Math.round(a / tex) * tex - a).addScaledVector(v, Math.round(b / tex) * tex - b);
    sun.target.position.copy(_sf); sun.position.copy(_sf).addScaledVector(lightDir, 800); }
  if (Math.abs(G.hour - lastEnvHour) > 0.25 || Math.abs(cloud - lastEnvCloud) > 0.08) {
    lastEnvHour = G.hour; lastEnvCloud = cloud; if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(envScene); scene.environment = envRT.texture;
  }
}

// ---------- input ----------
const canvas = renderer.domElement;
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (!G.keys[e.code]) G.pressed.add(e.code);
  G.keys[e.code] = true;
  if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { G.keys[e.code] = false; });
addEventListener('blur', () => { G.keys = {}; });
export function lockMouse() { try { const p = canvas.requestPointerLock?.(); p?.catch?.(() => {}); } catch (e) { /* not allowed right now */ } }
canvas.addEventListener('click', () => { if (!G.paused && !G.mouse.locked) lockMouse(); });
document.addEventListener('pointerlockchange', () => { G.mouse.locked = document.pointerLockElement === canvas; });
addEventListener('mousemove', e => { if (G.mouse.locked) { G.mouse.dx += e.movementX; G.mouse.dy += e.movementY; } });
addEventListener('mousedown', e => { if (G.mouse.locked && e.button === 0) G.mouse.click = true; });
addEventListener('wheel', e => { G.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
export const key = c => !!G.keys[c];
export const tapped = c => G.pressed.has(c);
export function endFrameInput() { G.pressed.clear(); G.mouse.dx = G.mouse.dy = 0; G.mouse.click = false; G.mouse.wheel = 0; }

// ---------- hide things that are very far away (saves a lot of drawing) ----------
const farList = []; let farT = 0;
export function farCull(obj, range) { obj.geometry?.computeBoundingSphere?.(); const c = obj.geometry?.boundingSphere?.center || obj.position; farList.push({ obj, x: c.x, z: c.z, r: range + (obj.geometry?.boundingSphere?.radius || 0) }); }
export function updateFarCull(px, pz) { farT -= G.dt || 0.016; if (farT > 0) return; farT = 0.4; for (const f of farList) f.obj.visible = Math.hypot(f.x - px, f.z - pz) < f.r; }

// ---------- small reusable things ----------
export const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...o });
export function addMesh(geo, mat, x = 0, y = 0, z = 0, parent = scene, shadow = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); return m;
}
export function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
