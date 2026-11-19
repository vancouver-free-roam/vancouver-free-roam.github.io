// Weather: "Raincouver". Sun, clouds, drizzle, rain, thunderstorms, fog, mountain snow, rainbows, puddles.
import * as THREE from 'three';
import { G, scene, camera, sunDir, canvasTex, clamp, R, pick, key, tapped, vnoise, hash2 } from './core.js';
import { heightAt, waterMat, isWater, snowLine } from './terrain.js';
import { nearestRoad, NX, NZ, surfaceY, setWetness } from './city.js';
import { peds, say } from './people.js';
import { sfx, rainVolume } from './sound.js';
import { ui } from './ui.js';

export const TYPES = {
  clear:   { name: 'Sunny', icon: '☀️', cloud: 0.03, rain: 0, fog: 0 },
  fair:    { name: 'Partly cloudy', icon: '⛅', cloud: 0.3, rain: 0, fog: 0 },   // blue sky + big white puffy cumulus
  cloudy:  { name: 'Cloudy', icon: '☁️', cloud: 0.62, rain: 0, fog: 0.1 },
  drizzle: { name: 'Drizzle', icon: '🌦️', cloud: 0.85, rain: 0.3, fog: 0.3 },
  rain:    { name: 'Rain', icon: '🌧️', cloud: 0.95, rain: 0.7, fog: 0.4 },
  storm:   { name: 'Thunderstorm', icon: '⛈️', cloud: 1, rain: 1, fog: 0.45, storm: true },
  fog:     { name: 'Fog', icon: '🌫️', cloud: 0.55, rain: 0, fog: 1 },
  snow:    { name: 'Snow', icon: '🌨️', cloud: 0.9, rain: 0.6, fog: 0.35, snow: true },
};
// how often each weather happens in Vancouver (spoiler: it rains a lot)
// (toned down for fun: it still rains, but sunny/cloudy is more common, and rain never comes twice in a row)
const ODDS_BY = {
  // (more beautiful: blue skies and puffy clouds most of the time; grey and wet are the exception)
  spring: [['clear', 38], ['fair', 30], ['cloudy', 10], ['drizzle', 8], ['rain', 6], ['storm', 3], ['fog', 5]],
  summer: [['clear', 55], ['fair', 30], ['cloudy', 5], ['drizzle', 3], ['rain', 2], ['storm', 3], ['fog', 2]],
  fall:   [['clear', 32], ['fair', 28], ['cloudy', 12], ['drizzle', 9], ['rain', 9], ['storm', 3], ['fog', 7]],
  winter: [['clear', 28], ['fair', 24], ['cloudy', 12], ['drizzle', 6], ['rain', 9], ['snow', 15], ['fog', 6]],
};
const WET = new Set(['drizzle', 'rain', 'storm', 'snow']);
export const W = { type: 'clear', cur: { cloud: 0.03, rain: 0, fog: 0 }, timer: 90, locked: false, rainbow: 0, flash: 0, nextBolt: 8, lastBolt: -99, snowing: false };

export function setWeather(type, { lock = false, quiet = false } = {}) {
  if (!TYPES[type]) return;
  const was = W.type; W.type = type; W.locked = lock; W.timer = R(90, 200);
  if (!quiet) ui.toast(TYPES[type].icon + ' ' + TYPES[type].name, weatherQuip(type), 2500);
  if ((was === 'rain' || was === 'storm' || was === 'drizzle') && (type === 'clear' || type === 'fair' || type === 'cloudy')) W.rainbowPending = true;
}
function weatherQuip(t) {
  return pick({
    clear: ['The mountains are out! Everyone call in sick.', 'Sun?! Quick, everyone to Kits Beach.'],
    fair: ['Big fluffy clouds over the mountains. Postcard weather.', 'Blue sky, puffy clouds: perfect patio day.'],
    cloudy: ['Classic Vancouver grey.', 'Not raining yet. Give it 10 minutes.'],
    drizzle: ['That light, sneaky Vancouver drizzle.', 'Locals don\'t even open umbrellas for this.'],
    rain: ['Welcome to Raincouver.', 'It\'s not rain, it\'s "liquid sunshine".'],
    storm: ['Thunderstorm! Rare, dramatic, terrifying.', 'The dogs of Kitsilano are NOT okay.'],
    fog: ['Fog rolling in off the water…', 'Can\'t see the Lions Gate. Can barely see your hand.'],
    snow: ['SNOW in Vancouver! The whole city shuts down.', 'Two centimetres of snow. Total chaos. Schools closed.'],
  }[t]);
}
export function rollWeather() {
  const ODDS = (ODDS_BY[G.season] || ODDS_BY.fall).filter(([t]) => !(WET.has(W.type) && WET.has(t)));   // after rain, always a dry spell
  let tot = 0; for (const [, w] of ODDS) tot += w; let r = Math.random() * tot; for (const [t, w] of ODDS) { r -= w; if (r <= 0) return t; } return 'cloudy';
}

// ---------- rain (falling streaks around the camera) ----------
const RN = 4500, BOX = 70, H = 40;
const rainPos = new Float32Array(RN * 6), rainSeed = new Float32Array(RN * 3);
for (let i = 0; i < RN; i++) { rainSeed[i * 3] = Math.random() * BOX * 2 - BOX; rainSeed[i * 3 + 1] = Math.random() * H; rainSeed[i * 3 + 2] = Math.random() * BOX * 2 - BOX; }
const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rainMat = new THREE.LineBasicMaterial({ color: 0xd2dae2, transparent: true, opacity: 0.45, depthWrite: false, fog: false });
const rain = new THREE.LineSegments(rainGeo, rainMat); rain.frustumCulled = false; rain.visible = false;
// snow (soft points) for the mountains
const SN = 2500, snowPos = new Float32Array(SN * 3), snowSeed = new Float32Array(SN * 3);
for (let i = 0; i < SN; i++) { snowSeed[i * 3] = Math.random() * BOX * 2 - BOX; snowSeed[i * 3 + 1] = Math.random() * H; snowSeed[i * 3 + 2] = Math.random() * BOX * 2 - BOX; }
const snowGeo = new THREE.BufferGeometry(); snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPos, 3));
const flake = canvasTex(32, 32, (c, w, h) => { const g = c.createRadialGradient(16, 16, 1, 16, 16, 15); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, w, h); }, false);
const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ size: 0.35, map: flake, transparent: true, depthWrite: false, opacity: 0.9 })); snow.frustumCulled = false; snow.visible = false;

// ---------- cloud layer ----------
const cloudTex = canvasTex(512, 512, (c, w, h) => {
  const img = c.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // tileable fbm
    let v = 0, a = 0.5, f = 4;
    for (let o = 0; o < 5; o++) { const P = f; const nx = x / w * P, ny = y / h * P; const i = Math.floor(nx), j = Math.floor(ny), fx = nx - i, fy = ny - j, u = fx * fx * (3 - 2 * fx), vv = fy * fy * (3 - 2 * fy); const hh = (a2, b2) => hash2(((a2 % P) + P) % P + o * 97, ((b2 % P) + P) % P); v += a * (hh(i, j) + (hh(i + 1, j) - hh(i, j)) * u + (hh(i, j + 1) - hh(i, j)) * vv + (hh(i, j) - hh(i + 1, j) - hh(i, j + 1) + hh(i + 1, j + 1)) * u * vv); a *= 0.5; f *= 2; }
    const k = (y * w + x) * 4, al = clamp((v - 0.35) * 2.2, 0, 1);
    img.data[k] = img.data[k + 1] = img.data[k + 2] = 235; img.data[k + 3] = al * 255;
  }
  c.putImageData(img, 0, 0);
});
cloudTex.repeat.set(5, 5);
const cloudMat = new THREE.MeshBasicMaterial({ map: cloudTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0, color: 0xdfe5ea });
const clouds = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2), cloudMat);
const cloudsLow = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2), cloudMat.clone());
cloudsLow.material.map = cloudTex.clone(); cloudsLow.material.map.repeat.set(9, 9); cloudsLow.material.map.needsUpdate = true;

// ---------- rainbow ----------
const rainbow = new THREE.Group();
['#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#5856d6', '#af52de'].forEach((c, i) => {
  rainbow.add(new THREE.Mesh(new THREE.TorusGeometry(2600 - i * 60, 30, 6, 96, Math.PI), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, depthWrite: false, fog: false })));
});

// ---------- lightning bolt ----------
const boltGeo = new THREE.BufferGeometry(); boltGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(60 * 3), 3));
const bolt = new THREE.Line(boltGeo, new THREE.LineBasicMaterial({ color: 0xeef3ff, transparent: true, opacity: 1, fog: false })); bolt.visible = false; bolt.frustumCulled = false;
function strike(pl) {
  const a = Math.random() * Math.PI * 2, d = R(700, 2500), x = pl.x + Math.cos(a) * d, z = pl.z + Math.sin(a) * d, g = Math.max(heightAt(x, z), 0);
  const p = boltGeo.attributes.position.array; let cx = x, cz = z;
  for (let i = 0; i < 60; i++) { const t = i / 59, y = 1300 - t * (1300 - g); cx += R(-18, 18); cz += R(-18, 18); p[i * 3] = t === 1 ? x : cx; p[i * 3 + 1] = y; p[i * 3 + 2] = t === 1 ? z : cz; }
  boltGeo.attributes.position.needsUpdate = true; bolt.visible = true; W.flash = 1; W.lastBolt = G.t;
  sfx.thunder(d / 340);
  for (const ped of peds) if (Math.random() < 0.3 && Math.hypot(ped.x - pl.x, ped.z - pl.z) < 60) say(ped, pick(['AAAH!', 'Was that thunder?!', 'My Lulus are soaked!', 'This never happens here!']));
}

// ---------- puddles ----------
const PN = 70;
const puddleMat = new THREE.MeshStandardMaterial({ color: 0x1c262c, roughness: 0.03, metalness: 0.4, transparent: true, opacity: 0, envMapIntensity: 1.4 });
const puddles = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), puddleMat, PN); puddles.frustumCulled = false; puddles.receiveShadow = true;
export const puddleSpots = [];
let puddleCenter = null;
function placePuddles(pl) {
  puddleSpots.length = 0; const o = new THREE.Object3D();
  for (let k = 0; k < PN; k++) {
    let spot = null;
    for (let t = 0; t < 6 && !spot; t++) {
      const nr = nearestRoad(pl.x + R(-160, 160), pl.z + R(-160, 160), 40, r => r.t <= 6);
      if (!nr) continue;
      const e = nr.e, x = NX(e.a) + (NX(e.b) - NX(e.a)) * nr.t, z = NZ(e.a) + (NZ(e.b) - NZ(e.a)) * nr.t;
      const off = (Math.random() < 0.6 ? 1 : -1) * (nr.road.w / 2 - 1.5) * Math.random();
      const ang = Math.atan2(NX(e.b) - NX(e.a), NZ(e.b) - NZ(e.a)), X = x + Math.cos(ang) * off, Z = z - Math.sin(ang) * off;
      if (!isWater(X, Z)) spot = { x: X, z: Z, y: surfaceY(X, Z, 1e9) + 0.3, r: R(1.2, 3.2), sx: R(0.6, 1) };
    }
    if (!spot) spot = { x: 0, z: 0, y: -100, r: 0.01, sx: 1 };
    puddleSpots.push(spot);
    o.position.set(spot.x, spot.y, spot.z); o.scale.set(spot.r, 1, spot.r * spot.sx); o.rotation.y = Math.random() * 3; o.updateMatrix(); puddles.setMatrixAt(k, o.matrix);
  }
  puddles.instanceMatrix.needsUpdate = true; puddleCenter = { x: pl.x, z: pl.z };
}
// splash spray
const SPN = 80, sprayPos = new Float32Array(SPN * 3), sprayVel = new Float32Array(SPN * 3);
const sprayGeo = new THREE.BufferGeometry(); sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPos, 3));
const spray = new THREE.Points(sprayGeo, new THREE.PointsMaterial({ color: 0xdfe8f0, size: 0.35, transparent: true, opacity: 0.8, depthWrite: false })); spray.frustumCulled = false; spray.visible = false;
let sprayT = 0;
function splash(x, y, z, speed) {
  for (let i = 0; i < SPN; i++) { sprayPos[i * 3] = x; sprayPos[i * 3 + 1] = y + 0.3; sprayPos[i * 3 + 2] = z; const a = Math.random() * 6.28, s = R(2, 4 + speed * 0.25); sprayVel[i * 3] = Math.cos(a) * s; sprayVel[i * 3 + 1] = R(3, 7); sprayVel[i * 3 + 2] = Math.sin(a) * s; }
  sprayT = 1.2; spray.visible = true; sfx.splashBig(speed);
}
export const splashStats = { soaked: 0 };

export function initWeather() {
  scene.add(rain, snow, clouds, cloudsLow, rainbow, bolt, puddles, spray);
  setWeather(rollWeather(), { quiet: true });
  Object.assign(W.cur, TYPES[W.type]);
}

const tmp = new THREE.Vector3();
export function updateWeather(dt, pl) {
  // change weather over time (unless a mission locked it)
  if (!W.locked) { W.timer -= dt; if (W.timer < 0) setWeather(rollWeather()); }
  if (tapped('KeyY')) { const keys = Object.keys(TYPES); setWeather(keys[(keys.indexOf(W.type) + 1) % keys.length]); }
  const T = TYPES[W.type], k = Math.min(1, dt * 0.12);
  for (const p of ['cloud', 'rain', 'fog']) W.cur[p] += (T[p] - W.cur[p]) * (p === 'rain' && T.rain < W.cur.rain ? Math.min(1, dt * 0.5) : k);   // rain stops quickly
  if (W.cur.rain < 0.02 && !T.rain) W.cur.rain = 0;
  // mountains: rain turns to snow up high
  const camY = camera.position.y, ground = Math.max(0, heightAt(camera.position.x, camera.position.z));
  W.snowing = W.cur.rain > 0.05 && (ground > snowLine() - 150 || !!T.snow);
  G.cloud = W.cur.cloud; G.wet = W.snowing ? 0 : W.cur.rain; G.fogW = W.cur.fog;
  G.weatherIcon = W.snowing ? '🌨️' : T.icon; G.weatherName = W.snowing ? 'Snow' : T.name;

  // rain streaks
  const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
  const rainOn = G.wet > 0.03, n = Math.floor(RN * clamp(G.wet, 0, 1));
  rain.visible = rainOn;
  if (rainOn) {
    const fall = 26 * dt, wx = 3, len = 1.5;
    for (let i = 0; i < n; i++) {
      let y = rainSeed[i * 3 + 1] - fall; if (y < 0) y += H; rainSeed[i * 3 + 1] = y;
      const x = ((rainSeed[i * 3] + cx) % (BOX * 2) + BOX * 2) % (BOX * 2) - BOX, z = ((rainSeed[i * 3 + 2] + cz) % (BOX * 2) + BOX * 2) % (BOX * 2) - BOX;
      const X = cx + x, Y = cy - H / 2 + y, Z = cz + z, j = i * 6;
      rainPos[j] = X; rainPos[j + 1] = Y; rainPos[j + 2] = Z; rainPos[j + 3] = X + wx * 0.04; rainPos[j + 4] = Y + len; rainPos[j + 5] = Z;
    }
    rainGeo.setDrawRange(0, n * 2); rainGeo.attributes.position.needsUpdate = true;
    rainMat.opacity = (0.28 + 0.4 * G.wet) * (1 - 0.6 * clamp((camera.position.y - ground - 60) / 300, 0, 1));   // thinner streaks when you fly high
  }
  // snow flakes
  snow.visible = W.snowing;
  if (W.snowing) {
    const m = Math.floor(SN * clamp(W.cur.rain * 1.3, 0, 1));
    for (let i = 0; i < m; i++) {
      let y = snowSeed[i * 3 + 1] - 1.6 * dt; if (y < 0) y += H; snowSeed[i * 3 + 1] = y;
      const sway = Math.sin(G.t * 0.8 + i) * 0.6;
      snowPos[i * 3] = cx + (((snowSeed[i * 3] + cx) % (BOX * 2) + BOX * 2) % (BOX * 2) - BOX) + sway; snowPos[i * 3 + 1] = cy - H / 2 + y; snowPos[i * 3 + 2] = cz + (((snowSeed[i * 3 + 2] + cz) % (BOX * 2) + BOX * 2) % (BOX * 2) - BOX);
    }
    snowGeo.setDrawRange(0, m); snowGeo.attributes.position.needsUpdate = true;
  }
  // clouds drift with the wind
  clouds.position.set(cx, 1500, cz); cloudsLow.position.set(cx, Math.max(650, ground + 450), cz);
  cloudTex.offset.set((G.t * 0.0004 + cx / 8000) % 1, (G.t * 0.0002 + cz / 8000) % 1);
  cloudsLow.material.map.offset.set((G.t * 0.0007 + cx / 4444) % 1, (cz / 4444) % 1);
  // flying up to / above a cloud layer: it turns see-through so you can still see the ground
  const thin = y => 1 - 0.8 * clamp((camera.position.y - (y - 260)) / 300, 0, 1);
  cloudMat.opacity = clamp((W.cur.cloud - 0.15) * 1.1, 0, 0.95) * thin(1500); cloudsLow.material.opacity = clamp((W.cur.cloud - 0.6) * 2, 0, 0.85) * thin(cloudsLow.position.y);
  const shade = 1 - G.cloud * 0.45 - G.night * 0.7; cloudMat.color.setScalar(shade); cloudsLow.material.color.setScalar(shade * 0.92);
  // stormy water
  if (waterMat) { const s = 0.35 + G.wet * 0.5; waterMat.normalScale.set(s, s); waterMat.roughness = 0.07 + G.cloud * 0.12; }
  setWetness(G.wet);

  // thunderstorms
  W.flash = Math.max(0, W.flash - dt * 4); G.flash = W.flash; bolt.visible = W.flash > 0.3;
  if (T.storm && W.cur.rain > 0.7) { W.nextBolt -= dt; if (W.nextBolt < 0) { W.nextBolt = R(5, 14); strike(pl); } }

  // rainbow after the rain (daytime, sun behind you)
  if (W.rainbowPending && G.wet < 0.1 && G.night < 0.3) { W.rainbowPending = false; W.rainbow = 1; ui.toast('🌈 A rainbow!', 'Look away from the sun', 3000); }
  W.rainbow = Math.max(0, W.rainbow - dt / (W.cur.rain > 0.1 ? 3 : 100));
  rainbow.visible = W.rainbow > 0.01;
  if (rainbow.visible) {
    tmp.set(-sunDir.x, 0, -sunDir.z).normalize();
    rainbow.position.set(cx + tmp.x * 4500, -200, cz + tmp.z * 4500); rainbow.lookAt(cx, -200, cz);
    rainbow.children.forEach(m => m.material.opacity = 0.22 * Math.min(1, W.rainbow * 3));
  }

  // puddles near you while it's wet
  puddleMat.opacity = clamp(G.wet * 1.3, 0, 0.9); puddles.visible = G.wet > 0.05;
  if (puddles.visible && (!puddleCenter || Math.hypot(pl.x - puddleCenter.x, pl.z - puddleCenter.z) > 120)) placePuddles(pl);
  const v = pl.vehicle;
  if (puddles.visible && v && v.d.kind === 'road' && v.speedAbs > 7) for (const s of puddleSpots) {
    if (s.hit && G.t - s.hit < 3) continue;
    if (Math.hypot(v.x - s.x, v.z - s.z) < s.r + 1) {
      s.hit = G.t; splash(s.x, s.y, s.z, v.speedAbs);
      for (const ped of peds) if (Math.hypot(ped.x - s.x, ped.z - s.z) < 7 && ped.state !== 'down') { splashStats.soaked++; ped.state = 'idle'; ped.timer = 2; say(ped, pick(['HEY! I just got these jeans!', 'Seriously?!', 'You splashed me!', 'My oat latte!!', 'Rude, eh!'])); pl.karma -= 0.5; }
    }
  }
  if (sprayT > 0) { sprayT -= dt; for (let i = 0; i < SPN; i++) { sprayVel[i * 3 + 1] -= 18 * dt; sprayPos[i * 3] += sprayVel[i * 3] * dt; sprayPos[i * 3 + 1] += sprayVel[i * 3 + 1] * dt; sprayPos[i * 3 + 2] += sprayVel[i * 3 + 2] * dt; } sprayGeo.attributes.position.needsUpdate = true; spray.visible = sprayT > 0; }

  // people pop umbrellas and complain
  G.umbrellas = G.wet > 0.2;
  if (G.wet > 0.4 && Math.random() < dt * 0.15) { const p = pick(peds); if (p && Math.hypot(p.x - pl.x, p.z - pl.z) < 40) say(p, pick(['Ugh. Raincouver.', 'Is it ever going to stop?', 'I left my umbrella at home. AGAIN.', 'Good day for a London Fog latte.', 'My dog refuses to walk in this.', 'At least it\'s not snow!'])); }
  rainVolume(pl.transit ? G.wet * 0.4 : G.wet);
}
export const isRaining = () => G.wet > 0.25;
