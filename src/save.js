// Save game + settings, stored in the browser (localStorage). Survives closing the game.
import { G, renderer, sun } from './core.js';

const KEY = 'vfr-save-v1', SKEY = 'vfr-settings-v1';
export function loadSave() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }
export function writeSave(data) { try { localStorage.setItem(KEY, JSON.stringify({ ...data, savedAt: Date.now() })); return true; } catch (e) { return false; } }
export function clearSave() { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } }

const DEFAULTS = { quality: 'high', sens: 1, invertY: false, fps: false, adult: true };   // adult = grown-up humour + some swearing in what people say
export function loadSettings() { let s = {}; try { s = JSON.parse(localStorage.getItem(SKEY) || '{}'); } catch (e) { /* ignore */ } G.settings = { ...DEFAULTS, ...s }; applySettings(); return G.settings; }
export function saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(G.settings)); } catch (e) { /* ignore */ } applySettings(); }

// graphics quality: lower = faster on older computers
export const QUALITY = {
  low:    { name: 'Low (fastest)', ratio: 0.85, shadows: false, shadowSize: 1024, peds: 40, traffic: 14, treeNear: 90 },
  medium: { name: 'Medium', ratio: 1, shadows: true, shadowSize: 1024, peds: 65, traffic: 22, treeNear: 220 },
  high:   { name: 'High (prettiest)', ratio: Math.min(devicePixelRatio, 1.5), shadows: true, shadowSize: 2048, shadowRange: 120, peds: 85, traffic: 28, treeNear: 420 },
};
let appliedSize = 2048;
function applySettings() {
  const q = QUALITY[G.settings.quality] || QUALITY.high;
  renderer.setPixelRatio(q.ratio); renderer.setSize(innerWidth, innerHeight);
  sun.castShadow = q.shadows;
  if (q.shadowSize !== appliedSize) { appliedSize = q.shadowSize; sun.shadow.mapSize.set(q.shadowSize, q.shadowSize); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  { const sr = q.shadowRange || 120, c = sun.shadow.camera; if (c.right !== sr) { Object.assign(c, { left: -sr, right: sr, top: sr, bottom: -sr }); c.updateProjectionMatrix(); } }   // shadows reach further on High
  G.pedTarget = q.peds; G.trafficTarget = q.traffic; G.treeNear = q.treeNear;   // how many nearby trees get the detailed version (terrain.js treeRing)
  document.getElementById('fps')?.classList.toggle('hidden', !G.settings.fps);
}
