// Picture polish: a soft glow (bloom) on bright things (lit windows, street lamps, neon, the sun on the water), stronger
// at night; and puffy fair-weather cumulus clouds drifting over the city. Bloom only on "high" graphics quality.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { G, renderer, scene, camera, sun, R, SKY_LOOK } from './core.js';
import { heightAt } from './terrain.js';

let composer = null, bloom = null;
function setup() {
  // 4× MSAA in the composer's render target: without it, High quality (the only one with bloom) lost the canvas's own
  // antialiasing and every building edge, pole and wire had staircase "jaggies" (a big part of the cheap-game look)
  const rt = new THREE.WebGLRenderTarget(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples: 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  // (GTAO ambient occlusion was tried: it looked nice but cost ~40% of the frame rate, because it re-draws the whole city)
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.25, 0.45, 0.82); composer.addPass(bloom);
  composer.addPass(new OutputPass());
  addEventListener('resize', () => composer.setSize(innerWidth, innerHeight));
}
export function renderWorld() {
  if ((G.settings?.quality || 'high') !== 'high') { renderer.render(scene, camera); return; }
  if (!composer) setup();
  composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight);
  const n = G.night || 0; bloom.strength = 0.12 + 0.54 * n * (1 - 0.75 * SKY_LOOK.gold.value); bloom.threshold = 1.4 - 0.72 * n; bloom.radius = 0.4 + 0.2 * n;
  // (by day only really bright things glow: the sun, sun glints. A lower threshold made the whole bright sky bloom into a white haze over everything)
  composer.render();
}

// ---------- cumulus clouds ----------
const tex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  for (let i = 0; i < 26; i++) {   // a cauliflower of soft blobs, flatter at the bottom
    const x = 128 + R(-80, 80), y = 120 + R(-40, 30) - Math.abs(x - 128) * 0.15, r = R(28, 62);
    const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.6, 'rgba(250,250,252,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  const sh = g.createLinearGradient(0, 100, 0, 200); sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(90,100,120,0.35)');   // shaded bellies
  g.globalCompositeOperation = 'source-atop'; g.fillStyle = sh; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const clouds = [];
for (let i = 0; i < 80; i++) {   // big postcard cumulus towers
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: true, opacity: 0 }));
  const s = R(900, 2600); m.scale.set(s, s * R(0.5, 0.75), 1); m.userData = { ox: R(-20000, 20000), oz: R(-20000, 20000), y: R(1300, 2400), drift: R(0.6, 1.2) };
  scene.add(m); clouds.push(m);
}
// low cloud clinging to the mountainsides (the classic wet North Shore look): wisps parked in the valleys and on the slopes
// between ~350 and 1100 m around you, thickest on cloudy / wet days and on misty mornings; they drift and slowly breathe
const wisps = []; let wispAt = null;
for (let i = 0; i < 44; i++) { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: true, opacity: 0 })); m.userData = { ph: Math.random() * 6, s: R(180, 520) }; m.visible = false; scene.add(m); wisps.push(m); }
function placeWisps(px, pz) {
  wispAt = [px, pz]; let k = 0;
  for (let t = 0; t < 900 && k < wisps.length; t++) {
    const a = Math.random() * 6.28, d = R(1200, 9000), x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d, h = heightAt(x, z);
    if (h < 350 || h > 1100) continue;
    const w = wisps[k++]; w.userData.x = x; w.userData.z = z; w.userData.y = h + R(20, 90);
  }
  for (; k < wisps.length; k++) wisps[k].userData.y = -1e5;
}
function updateWisps(dt) {
  const px = camera.position.x, pz = camera.position.z;
  if (!wispAt || Math.hypot(px - wispAt[0], pz - wispAt[1]) > 3500) placeWisps(px, pz);
  const hr = G.hour ?? 12, morning = hr > 5 && hr < 10.5 ? 1 - Math.abs(hr - 7.5) / 3 : 0;
  const amt = Math.min(1, Math.max(0, (G.cloud || 0) - 0.35) * 1.4 + (G.wet || 0) * 0.8 + morning * 0.55), night = G.night || 0;
  for (const m of wisps) {
    const u = m.userData; if (u.y < -1e4 || amt < 0.03) { m.visible = false; continue; }
    u.ph += dt * 0.05; u.x += dt * 2.2;
    m.visible = true; m.position.set(u.x, u.y + Math.sin(u.ph) * 8, u.z); m.scale.set(u.s * (1 + 0.1 * Math.sin(u.ph * 1.3)), u.s * 0.28, 1);
    m.material.opacity = amt * 0.75; m.material.color.setRGB(0.86, 0.88, 0.9).multiplyScalar(1 - night * 0.8);
  }
}
const col = new THREE.Color();
const _white = new THREE.Color(1, 1, 1), _pink = new THREE.Color(1.0, 0.6, 0.55), _dusk = new THREE.Color(0.42, 0.42, 0.64);
export function updateCumulus(dt) {
  updateWisps(dt);
  // most at "partly cloudy"; on a clear day only a faint few (80 puffs at 1/3 opacity veiled the whole clear sky milky white,
  // where Dav's sunny photos show a deep blue sky with the odd cloud)
  const cover = G.cloud || 0, amount = (cover < 0.32 ? 0.12 + 0.88 * Math.max(0, (cover - 0.08) / 0.24) : Math.max(0, 1 - (cover - 0.32) * 2.2)) * (1 - (G.wet || 0)), night = G.night || 0;
  col.copy(sun.color).lerp(_white, 0.38);   // bright white at noon…
  col.lerp(_pink, SKY_LOOK.gold.value * 0.85).lerp(_dusk, SKY_LOOK.dusk.value * 0.8);   // …glowing pink-orange at sunset, dusky purple-pink in the blue hour (like the photos)
  col.multiplyScalar(1 - night * 0.8 + SKY_LOOK.dusk.value * 0.35);
  for (const m of clouds) {
    const u = m.userData; u.ox += dt * 6 * u.drift; if (u.ox > 22000) u.ox -= 44000;   // a westerly breeze
    m.position.set(camera.position.x + u.ox, u.y, camera.position.z + u.oz);
    m.material.opacity = amount * 0.9; m.material.color.copy(col); m.visible = amount > 0.02 && (amount > 0.3 || clouds.indexOf(m) % 4 === 0);   // clear days: only every 4th puff
  }
}
