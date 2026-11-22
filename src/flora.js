// BC plants around you: forest understory (Oregon grape, salmonberry, thimbleberry, red huckleberry, devil's club, skunk
// cabbage, trilliums, moss, fall mushrooms), clearings (fireweed, foxglove), alpine meadows (heather, lupines, paintbrush,
// glacier lilies), city gardens (rhododendrons, hydrangeas, roses, tulips, lavender, ornamental grasses), Victoria's Garry oak
// meadows (oaks + blue camas), arbutus on the coastal bluffs, and rare finds (ghost pipe, fairy slipper orchid, phantom orchid,
// chocolate lily, a 1,000-year-old cedar, a fairy ring). Everything is instanced, rebuilt around you every 30 m, and sways.
// Walk close to add a plant to the 📖 field guide; P photographs it; E eats ripe berries.
import * as THREE from 'three';
import { G, scene, camera, hash2, vnoise, tapped } from './core.js';
import { heightAt, isWater, waterLevel, maskAt, isSnow, groundY, wildForest, townDensity, isNorthShoreTown, isRichmond, FOLIAGE, snowLine } from './terrain.js';
import { walkY, buildingAt, nearBuildings, nearestRoad, pavedY } from './city.js';
import { shrubGeo } from './trees.js';
import { onIsland } from './island.js';
import { setColliders } from './colliders.js';
import { ui } from './ui.js';
import { discover } from './missions.js';
import { register, spot, softSpot, photo } from './journal.js';
import { tintShader, swayShader, WIND_T, bake, SP, SPs, CN, BX, cylU } from './tint.js';

const M = window.MAP;
const MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide, envMapIntensity: 0.3 });
MAT.onBeforeCompile = sh => { tintShader(sh); swayShader(sh, 0.06); }; MAT.customProgramCacheKey = () => 'floraTintSway';
const TMAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, envMapIntensity: 0.3 });   // trees: no sway on the trunk scale
TMAT.onBeforeCompile = sh => { tintShader(sh); swayShader(sh, 0.004); }; TMAT.customProgramCacheKey = () => 'floraTree';

// ---------- shapes (unit-ish sizes in metres) ----------
const leaf = (x, y, z, l, w, ry, tilt, col = 'F') => [SPs, col, x + Math.sin(ry) * l * 0.5 * Math.cos(tilt), y + Math.sin(tilt) * l * 0.5, z + Math.cos(ry) * l * 0.5 * Math.cos(tilt), w, 0.012, l * 0.5, -tilt, ry, 0];
const ring = (n, f) => Array.from({ length: n }, (_, i) => f(i, i / n * Math.PI * 2));
const stem = (h, r = 0.012, col = '#3d5a2a', x = 0, z = 0, lean = 0) => [cylU(r, r * 0.7, h, 4), col, x, 0, z, 1, 1, 1, lean, 0, 0];
const blossom = (x, y, z, r, col) => [SPs, col, x, y, z, r, r * 0.6, r];
const spike = (x, y, z, h, r, col, n = 7) => Array.from({ length: n }, (_, i) => [SPs, col, x, y + i * h / n, z, r * (1 - i / n * 0.6), r * 0.8, r * (1 - i / n * 0.6)]);
const GEO = {
  oregongrape: bake([...ring(7, (i, a) => leaf(0, 0.05, 0, 0.45, 0.07, a, 0.5 + (i % 2) * 0.3)), ...ring(5, (i, a) => leaf(0, 0.25, 0, 0.3, 0.06, a + 0.3, 0.8))]),
  oregongrapeFl: bake([...ring(5, (i, a) => [SPs, 'F', Math.sin(a) * 0.12, 0.42, Math.cos(a) * 0.12, 0.04, 0.05, 0.04])]),
  salmonberry: bake([...ring(5, (i, a) => stem(1.3 + (i % 2) * 0.4, 0.014, '#7a5a3a', Math.sin(a) * 0.15, Math.cos(a) * 0.15, (i % 3 - 1) * 0.2)), ...ring(12, (i, a) => leaf(Math.sin(a) * 0.25, 0.5 + (i % 4) * 0.3, Math.cos(a) * 0.25, 0.18, 0.07, a, 0.2))]),
  salmonberryFl: bake(ring(8, (i, a) => [SPs, 'F', Math.sin(a) * 0.3, 0.7 + (i % 4) * 0.25, Math.cos(a) * 0.3, 0.035, 0.03, 0.035])),
  thimbleberry: bake([...ring(4, (i, a) => stem(1.0 + (i % 2) * 0.3, 0.012, '#6a5a3a', Math.sin(a) * 0.1, Math.cos(a) * 0.1)), ...ring(7, (i, a) => leaf(Math.sin(a) * 0.2, 0.75 + (i % 3) * 0.2, Math.cos(a) * 0.2, 0.32, 0.17, a, 0.1))]),
  thimbleberryFl: bake(ring(5, (i, a) => [SPs, 'F', Math.sin(a) * 0.32, 1.05 + (i % 2) * 0.1, Math.cos(a) * 0.32, 0.04, 0.025, 0.04])),
  huckleberry: bake([...ring(6, (i, a) => stem(1.2, 0.008, '#5a8a3a', Math.sin(a) * 0.05, Math.cos(a) * 0.05, 0.35)), ...ring(16, (i, a) => leaf(Math.sin(a * 3) * 0.3, 0.4 + (i % 5) * 0.18, Math.cos(a * 3) * 0.3, 0.06, 0.03, a, 0.1))]),
  huckleberryFl: bake(ring(10, (i, a) => [SPs, 'F', Math.sin(a * 3) * 0.32, 0.45 + (i % 5) * 0.17, Math.cos(a * 3) * 0.32, 0.022, 0.022, 0.022])),
  devilsclub: bake([stem(1.6, 0.025, '#8a7a4a'), stem(1.2, 0.02, '#8a7a4a', 0.2, 0.1, 0.2), ...ring(5, (i, a) => leaf(Math.sin(a) * 0.1, 1.5 + (i % 2) * 0.1, Math.cos(a) * 0.1, 0.55, 0.3, a, 0.15))]),
  devilsclubFl: bake([[CN, 'F', 0, 1.85, 0, 0.08, 0.25, 0.08]]),
  skunkcabbage: bake(ring(6, (i, a) => leaf(0, 0.0, 0, 0.9, 0.22, a, 1.0 - (i % 2) * 0.2))),
  skunkcabbageFl: bake([[SP, 'F', 0, 0.25, 0, 0.07, 0.2, 0.06], [SP, '#5a6a2a', 0, 0.2, 0, 0.03, 0.12, 0.03]]),
  trillium: bake([stem(0.3, 0.008), ...ring(3, (i, a) => leaf(0, 0.28, 0, 0.16, 0.08, a, -0.1))]),
  trilliumFl: bake(ring(3, (i, a) => leaf(0, 0.33, 0, 0.06, 0.035, a + 1.05, 0.25, 'F'))),
  foxglove: bake([...ring(6, (i, a) => leaf(0, 0.03, 0, 0.3, 0.1, a, 0.25)), stem(1.4, 0.015)]),
  foxgloveFl: bake(spike(0, 0.7, 0, 0.7, 0.05, 'F', 10)),
  fireweed: bake([...ring(5, (i, a) => stem(1.2 + (i % 3) * 0.2, 0.01, '#8a3a4a', Math.sin(a) * 0.15, Math.cos(a) * 0.15)), ...ring(12, (i, a) => leaf(Math.sin(a) * 0.17, 0.3 + (i % 4) * 0.2, Math.cos(a) * 0.17, 0.14, 0.025, a, 0.4))]),
  fireweedFl: bake(ring(5, (i, a) => spike(Math.sin(a) * 0.15, 1.0 + (i % 3) * 0.2, Math.cos(a) * 0.15, 0.35, 0.035, 'F', 6)).flat()),
  moss: bake([[SP, 'F', 0, 0, 0, 0.5, 0.12, 0.4], [SP, 'F0.85', 0.3, 0, 0.15, 0.3, 0.1, 0.25], [SP, 'F1.1', -0.25, 0, -0.1, 0.3, 0.09, 0.3]], 0.3),
  chanterelle: bake(ring(3, (i, a) => [[cylU(0.012, 0.028, 0.07, 6), 'F', Math.sin(a) * 0.08, 0, Math.cos(a) * 0.08], [new THREE.ConeGeometry(0.05, 0.04, 8).rotateX(Math.PI), 'F', Math.sin(a) * 0.08, 0.08, Math.cos(a) * 0.08]]).flat()),
  amanita: bake([[cylU(0.018, 0.02, 0.12, 6), '#f2eee2'], [SP, 'F', 0, 0.12, 0, 0.08, 0.04, 0.08], ...ring(7, (i, a) => [SPs, '#f6f2e6', Math.sin(a) * 0.05, 0.155, Math.cos(a) * 0.05, 0.01, 0.006, 0.01])]),
  heather: bake([[SP, 'F', 0, 0.04, 0, 0.35, 0.1, 0.3], [SP, 'F0.9', 0.2, 0.03, 0.1, 0.2, 0.08, 0.2]], 0.25),
  heatherFl: bake(ring(14, (i, a) => [SPs, 'F', Math.sin(a * 2) * 0.25 * (0.4 + (i % 3) * 0.3), 0.12, Math.cos(a * 2) * 0.22 * (0.4 + (i % 3) * 0.3), 0.025, 0.03, 0.025])),
  lupine: bake([...ring(7, (i, a) => leaf(0, 0.15, 0, 0.12, 0.025, a, 0.3)), stem(0.45, 0.01)]),
  lupineFl: bake(spike(0, 0.3, 0, 0.28, 0.035, 'F', 8)),
  paintbrush: bake([stem(0.3, 0.008), stem(0.28, 0.008, '#3d5a2a', 0.05, 0.02, 0.2)]),
  paintbrushFl: bake([[CN, 'F', 0, 0.33, 0, 0.035, 0.08, 0.035], [CN, 'F', 0.06, 0.31, 0.02, 0.03, 0.07, 0.03]]),
  glacierlily: bake([leaf(0, 0.02, 0, 0.14, 0.04, 0, 0.3), leaf(0, 0.02, 0, 0.14, 0.04, 3.1, 0.3), stem(0.2, 0.006)]),
  glacierlilyFl: bake(ring(6, (i, a) => leaf(0, 0.2, 0, 0.05, 0.015, a, -0.6, 'F'))),
  rhodo: bake([[SP, 'F', 0, 0.9, 0, 1.0, 0.75, 0.9], [SP, 'F0.85', 0.5, 0.7, 0.3, 0.6, 0.5, 0.55], [SP, 'F0.9', -0.45, 0.75, -0.2, 0.6, 0.55, 0.6]], 0.3),
  rhodoFl: bake(Array.from({ length: 14 }, (_, i) => { const a = i * 2.4, r = 0.7 + (i % 3) * 0.15; return [SPs, 'F', Math.sin(a) * r, 0.9 + Math.cos(i * 1.3) * 0.55, Math.cos(a) * r * 0.9, 0.16, 0.13, 0.16]; })),
  hydrangea: bake([[SP, 'F', 0, 0.55, 0, 0.75, 0.55, 0.7]], 0.3),
  hydrangeaFl: bake(Array.from({ length: 10 }, (_, i) => { const a = i * 2.4, r = 0.5 + (i % 2) * 0.15; return [SPs, 'F', Math.sin(a) * r, 0.65 + Math.cos(i * 1.7) * 0.35, Math.cos(a) * r, 0.17, 0.15, 0.17]; })),
  rose: bake([[SP, 'F', 0, 0.5, 0, 0.5, 0.5, 0.45], ...ring(5, (i, a) => stem(0.9, 0.01, '#4a5a2a', Math.sin(a) * 0.2, Math.cos(a) * 0.2, 0.3))], 0.3),
  roseFl: bake(Array.from({ length: 9 }, (_, i) => { const a = i * 2.4; return [SPs, 'F', Math.sin(a) * 0.45, 0.6 + Math.cos(i * 1.9) * 0.3, Math.cos(a) * 0.42, 0.07, 0.06, 0.07]; })),
  tulip: bake([leaf(0, 0.02, 0, 0.18, 0.05, 0, 1.0), leaf(0, 0.02, 0, 0.16, 0.05, 2.6, 0.9), stem(0.35, 0.006)]),
  tulipFl: bake([[SP, 'F', 0, 0.38, 0, 0.035, 0.055, 0.035]]),
  lavender: bake([...ring(14, (i, a) => stem(0.5, 0.004, '#7a8a6a', Math.sin(a) * 0.05, Math.cos(a) * 0.05, 0.35)), [SP, '#7f8f78', 0, 0.12, 0, 0.3, 0.15, 0.3]]),
  lavenderFl: bake(ring(14, (i, a) => [SPs, 'F', Math.sin(a) * 0.2, 0.52, Math.cos(a) * 0.2, 0.02, 0.06, 0.02])),
  grass: bake(ring(16, (i, a) => [CN, 'F', Math.sin(a) * 0.08, 0.45, Math.cos(a) * 0.08, 0.02, 0.9 + (i % 3) * 0.2, 0.01, Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3])),
  camas: bake([leaf(0, 0.02, 0, 0.2, 0.02, 0, 0.6), leaf(0, 0.02, 0, 0.2, 0.02, 3, 0.6), stem(0.4, 0.005)]),
  camasFl: bake(spike(0, 0.3, 0, 0.15, 0.03, 'F', 5)),
  ghostpipe: bake(ring(5, (i, a) => [[cylU(0.008, 0.008, 0.16, 5), '#f4f2ee', Math.sin(a) * 0.04, 0, Math.cos(a) * 0.04], [SP, '#f8f6f2', Math.sin(a) * 0.05, 0.17, Math.cos(a) * 0.05, 0.016, 0.025, 0.016]]).flat()),
  fairyslipper: bake([leaf(0, 0.01, 0, 0.08, 0.04, 0, 0.1), stem(0.14, 0.004, '#8a4a6a'), [SP, '#d95a9a', 0, 0.14, -0.02, 0.025, 0.02, 0.035], [SP, '#f2e6c8', 0, 0.12, -0.03, 0.015, 0.01, 0.02], ...ring(4, (i, a) => leaf(0, 0.16, 0, 0.04, 0.008, a, 0.6, '#c84a8a'))]),
  phantom: bake([[cylU(0.01, 0.01, 0.3, 5), '#f6f4ee'], ...spike(0, 0.18, 0, 0.14, 0.025, '#fbfaf6', 6), [SPs, '#e8c840', 0, 0.22, -0.02, 0.008, 0.008, 0.008]]),
  chocolily: bake([stem(0.4, 0.005), ...ring(3, (i, a) => leaf(0, 0.15, 0, 0.1, 0.02, a, 0.2)), ...ring(4, (i, a) => leaf(0, 0.38, 0, 0.04, 0.02, a, -0.9, '#4a2a2a'))]),
  // trees
  arbutus: bake([[cylU(0.32, 0.22, 3.5, 7), '#9c4428', 0, 0, 0, 1, 1, 1, 0.25, 0, 0.1], [cylU(0.22, 0.12, 4, 6), '#b25a34', 0.4, 3.2, -0.8, 1, 1, 1, 0.5, 0, -0.4], [cylU(0.2, 0.1, 3.5, 6), '#a84e30', -0.6, 3.0, -0.6, 1, 1, 1, 0.3, 0, 0.6], [SP, '#a6b25a', 0.1, 1.5, -0.2, 0.3, 0.5, 0.3],
    [SP, 'F', 1.6, 6.5, -2.5, 2.2, 1.4, 2.0], [SP, 'F0.9', -2.0, 6.0, -1.5, 2.0, 1.3, 1.9], [SP, 'F1.05', 0.0, 7.5, -1.8, 2.0, 1.4, 2.2], [SP, 'F0.85', -0.5, 5.6, -3.0, 1.6, 1.0, 1.6]], 0.2),
  oakTrunk: bake([[cylU(0.55, 0.35, 4, 7), '#4a4440'], [cylU(0.3, 0.12, 5, 6), '#4a4440', 0.4, 3.6, 0, 1, 1, 1, 0, 0, -0.9], [cylU(0.28, 0.1, 5, 6), '#4a4440', -0.3, 3.5, 0.3, 1, 1, 1, 0.5, 0, 0.8], [cylU(0.25, 0.1, 4.5, 6), '#47413c', 0, 3.8, -0.3, 1, 1, 1, -0.7, 0, 0.1], [SP, '#6a8a4a', 0.2, 2, 0.4, 0.2, 0.8, 0.15]], 0.2),
  oakCrown: bake([[SP, 'F', 3.0, 7.2, 0, 2.6, 1.6, 2.4], [SP, 'F0.9', -2.8, 7.0, 1.0, 2.5, 1.5, 2.3], [SP, 'F1.05', 0, 8.2, -2.2, 2.4, 1.5, 2.4], [SP, 'F0.85', 0.3, 8.5, 1.5, 2.2, 1.3, 2.0]], 0.25),
  bigcedar: bake([[cylU(2.4, 1.1, 14, 10), '#7a5a48'], ...ring(6, (i, a) => [CN, '#6a4a3a', Math.sin(a) * 2.1, 1.4, Math.cos(a) * 2.1, 0.8, 3, 0.8, Math.cos(a) * 0.35, 0, -Math.sin(a) * 0.35]), [cylU(1.1, 0.4, 40, 9), '#7a5a48', 0, 13.5, 0], [SP, '#4a6a2a', 0, 3, 1.9, 0.6, 1.6, 0.3],
    ...Array.from({ length: 9 }, (_, i) => [new THREE.ConeGeometry(1, 1, 9, 1, true), 'F', 0, 20 + i * 4.2, 0, 7 - i * 0.55, 7, 7 - i * 0.55]), [CN, '#8a7a6a', 0, 59, 0, 0.3, 4, 0.3]], 0.2),
};
// species: geo, flower/berry geo, when the flower shows, colours, habitat ('forest' | 'wet' | 'clear' | 'alpine' | 'garden' | 'meadowVI'), density weight
const SPRING = s => s === 'spring', SUMMER = s => s === 'summer', LATE = s => s === 'summer' || s === 'fall';
const P = {
  oregongrape: { name: 'Oregon grape', emoji: '🍇', fact: 'Not a grape at all: a spiky holly-like shrub with yellow spring flowers and sour blue berries. Its inner bark is bright yellow and was used for dye.', hab: 'forest', w: 0.08, leaf: [0.35, 0.55, 0.2], fl: ['oregongrapeFl', s => s === 'spring' ? '#f2c820' : LATE(s) ? '#3a4a8a' : null], berry: LATE },
  salmonberry: { name: 'Salmonberry', emoji: '🫐', fact: 'Its berries are salmon-orange or ruby red and ripen when the first salmon run. The magenta spring flowers feed the first hummingbirds of the year.', hab: 'wet', w: 0.12, leaf: [0.27, 0.5, 0.26], fl: ['salmonberryFl', s => s === 'spring' ? '#d6337a' : s === 'summer' ? '#f08a2a' : null], berry: SUMMER },
  thimbleberry: { name: 'Thimbleberry', emoji: '🍓', fact: 'Huge soft maple-shaped leaves (the "hiker\'s toilet paper") and red berries shaped like a little thimble.', hab: 'clear', w: 0.1, leaf: [0.26, 0.5, 0.3], fl: ['thimbleberryFl', s => s === 'spring' ? '#fafaf2' : s === 'summer' ? '#d42a2a' : null], berry: SUMMER },
  huckleberry: { name: 'Red huckleberry', emoji: '🔴', fact: 'Bright green twiggy bushes that love growing out of old rotting stumps. The tart red berries are a favourite of bears (and hikers).', hab: 'forest', w: 0.07, leaf: [0.28, 0.6, 0.32], fl: ['huckleberryFl', s => LATE(s) ? '#e0302a' : null], berry: LATE },
  devilsclub: { name: "Devil's club", emoji: '🌿', fact: 'Leaves as big as umbrellas and stems covered in sharp spines. Don\'t grab it! It\'s an important medicine plant for many Coast Salish and other First Nations.', hab: 'wet', w: 0.05, leaf: [0.25, 0.55, 0.28], fl: ['devilsclubFl', s => LATE(s) ? '#d8281e' : null] },
  skunkcabbage: { name: 'Skunk cabbage', emoji: '🌼', fact: 'A glowing yellow hood in the spring swamps that smells like a skunk (to attract beetles). Bears eat it right after waking up.', hab: 'wet', w: 0.08, leaf: [0.24, 0.55, 0.3], fl: ['skunkcabbageFl', s => s === 'spring' ? '#f2d21e' : null] },
  trillium: { name: 'Western trillium', emoji: '🤍', fact: 'Three leaves, three petals. White flowers in early spring that turn pink-purple as they age. Picking one can kill the plant for years.', hab: 'forest', w: 0.05, leaf: [0.28, 0.5, 0.25], fl: ['trilliumFl', s => s === 'spring' ? '#fbfaf4' : null], only: SPRING },
  foxglove: { name: 'Foxglove', emoji: '🪻', fact: 'Tall spikes of purple bells along logging roads and clearings. Pretty but poisonous: it\'s the source of the heart drug digitalis. Not native (it came from Europe).', hab: 'clear', w: 0.08, leaf: [0.26, 0.4, 0.3], fl: ['foxgloveFl', s => s === 'summer' || s === 'spring' ? '#a84aa8' : null] },
  fireweed: { name: 'Fireweed', emoji: '🌺', fact: 'The first flower to come back after a forest fire or logging, with tall magenta spikes. Its leaves turn bright red in the fall. It\'s the Yukon\'s floral emblem.', hab: 'clear', w: 0.12, leaf: [0.3, 0.45, 0.28], fl: ['fireweedFl', s => s === 'summer' ? '#d0408a' : null], fall: '#b8282a' },
  moss: { name: 'Step moss & Oregon beaked moss', emoji: '🟩', fact: 'The coast rainforest grows moss on everything: logs, rocks, branches. A big bigleaf maple can carry a tonne of moss and ferns.', hab: 'forest', w: 0.18, leaf: [0.22, 0.55, 0.28], all: true },
  chanterelle: { name: 'Pacific golden chanterelle', emoji: '🍄', fact: 'BC\'s most famous wild mushroom: golden, funnel-shaped, smells like apricots. Fall rain brings them up under Douglas firs. (Never eat a wild mushroom you can\'t ID 100%.)', hab: 'forest', w: 0.05, leaf: [0.11, 0.85, 0.5], only: s => s === 'fall' },
  amanita: { name: 'Fly agaric', emoji: '🍄', fact: 'The classic fairy-tale mushroom: red cap, white spots. Very poisonous. It grows in partnership with birch and conifer roots.', hab: 'forest', w: 0.025, leaf: [0.0, 0.85, 0.42], only: s => s === 'fall' },
  heather: { name: 'Pink mountain heather', emoji: '🌸', fact: 'Low mats of needle-leaved heather cover the alpine meadows of Whistler and Seymour, with tiny pink bells in summer.', hab: 'alpine', w: 0.3, leaf: [0.3, 0.45, 0.22], fl: ['heatherFl', s => s === 'summer' ? '#e070a8' : null] },
  lupine: { name: 'Subalpine lupine', emoji: '💜', fact: 'Purple-blue flower spikes that turn the August meadows on Whistler and Black Tusk into a sea of blue.', hab: 'alpine', w: 0.25, leaf: [0.3, 0.4, 0.3], fl: ['lupineFl', s => s === 'summer' ? '#5a58c8' : null], only: s => s !== 'winter' },
  paintbrush: { name: 'Indian paintbrush', emoji: '🖌️', fact: 'The bright red "flowers" are actually leafy bracts. It steals some of its food from the roots of the plants around it.', hab: 'alpine', w: 0.15, leaf: [0.3, 0.4, 0.3], fl: ['paintbrushFl', s => s === 'summer' ? '#e02a2a' : null], only: s => s === 'summer' },
  glacierlily: { name: 'Yellow glacier lily', emoji: '🌼', fact: 'It blooms right at the edge of melting snow, pushing up through the last snowbanks. Grizzlies dig up the bulbs.', hab: 'alpine', w: 0.12, leaf: [0.28, 0.45, 0.32], fl: ['glacierlilyFl', s => s === 'spring' || s === 'summer' ? '#f8d81e' : null], only: s => s === 'spring' || s === 'summer' },
  rhodo: { name: 'Rhododendron', emoji: '🌺', fact: 'Vancouver is rhododendron heaven: mild wet winters, acidic soil. Every May, gardens explode in pink, red and purple.', hab: 'garden', w: 0.25, leaf: [0.3, 0.45, 0.16], fl: ['rhodoFl', s => s === 'spring' ? ['#e84a8a', '#d81b60', '#b85ac8', '#f06292', '#ffffff'] : null] },
  hydrangea: { name: 'Hydrangea', emoji: '💐', fact: 'The mophead colour depends on the soil: acidic Vancouver soil turns them blue; add lime and they go pink.', hab: 'garden', w: 0.2, leaf: [0.28, 0.5, 0.22], fl: ['hydrangeaFl', s => s === 'summer' ? ['#5c8de0', '#7aa7f0', '#a88ae0', '#e07ab8'] : s === 'fall' ? ['#9a7a8a', '#7a8a6a'] : null] },
  rose: { name: 'Garden rose', emoji: '🌹', fact: 'Stanley Park\'s Rose Garden has over 3,500 roses. Nootka rose is the wild native one, with pink flowers and red hips.', hab: 'garden', w: 0.15, leaf: [0.3, 0.45, 0.2], fl: ['roseFl', s => s === 'summer' ? ['#d81b3a', '#f06292', '#ffe0b2', '#ffffff', '#f2c820'] : s === 'fall' ? '#c8281e' : null] },
  tulip: { name: 'Tulips', emoji: '🌷', fact: 'Every April the Skagit Valley tulip fields just south of the border pull a million visitors. City beds are planted by the thousand.', hab: 'bed', w: 1, leaf: [0.3, 0.5, 0.3], fl: ['tulipFl', s => s === 'spring' ? ['#e0302a', '#f2c820', '#f06292', '#ffffff', '#a84aa8', '#f08a2a'] : null], only: SPRING },
  lavender: { name: 'Lavender', emoji: '💜', fact: 'Bees love it. So does the whole Fraser Valley: there are lavender farms in Langley and Abbotsford.', hab: 'bed', w: 0.6, leaf: [0.3, 0.15, 0.45], fl: ['lavenderFl', s => s === 'summer' ? '#8a6ad0' : null] },
  grass: { name: 'Ornamental grass', emoji: '🌾', fact: 'Feather reed grass and blue fescue fill Vancouver\'s newer gardens and boulevards: drought-tough, and they look good even in winter.', hab: 'bed', w: 0.5, leaf: [0.2, 0.35, 0.45], all: true, fallCol: '#c8b07a' },
  camas: { name: 'Blue camas', emoji: '💙', fact: 'Every spring the Garry oak meadows of Victoria turn blue with camas. For thousands of years Lekwungen people tended these meadows and harvested the bulbs.', hab: 'meadowVI', w: 1, leaf: [0.28, 0.45, 0.3], fl: ['camasFl', s => s === 'spring' ? '#4a5ad8' : null], only: s => s !== 'winter' },
};
const RARE = {
  ghostpipe: { name: 'Ghost pipe', emoji: '👻', rare: 2, fact: 'A ghostly white plant with no green at all: it can\'t make its own food, so it taps into fungi that are connected to tree roots.', where: 'dark old forest floor in summer and fall', hab: 'forest', p: 0.00025, when: LATE },
  fairyslipper: { name: 'Fairy slipper orchid', emoji: '🩰', rare: 2, fact: 'A tiny pink orchid (Calypso bulbosa) on mossy forest floors in spring. One flower, one leaf, and it hates being disturbed.', where: 'mossy forest floor in spring', hab: 'forest', p: 0.0003, when: SPRING },
  phantom: { name: 'Phantom orchid', emoji: '🤍', rare: 3, fact: 'One of the rarest plants in Canada: an all-white orchid that lives entirely off fungi. Only a handful of sites are known in BC.', where: 'deep old forest (legendary)', hab: 'forest', p: 0.00004, when: LATE },
  chocolily: { name: 'Chocolate lily', emoji: '🍫', rare: 2, fact: 'Nodding brown-purple bells speckled with yellow, in the Garry oak meadows. It smells faintly of… not chocolate.', where: 'Garry oak meadows on Vancouver Island in spring', hab: 'meadowVI', p: 0.001, when: SPRING },
};
const TREES = {
  arbutus: { name: 'Arbutus (Pacific madrone)', emoji: '🌳', fact: 'Canada\'s only native broadleaf evergreen. Its red bark peels off in curls to show smooth green-gold new bark. It only grows near the sea, on sunny rocky bluffs.', where: 'sunny rocky shores: West Van, Howe Sound, the islands' },
  garryoak: { name: 'Garry oak', emoji: '🌳', fact: 'BC\'s only native oak, twisted and gnarly. Garry oak meadows are among the most endangered ecosystems in Canada: less than 5% are left.', where: 'Victoria and the southeast of Vancouver Island' },
  bigcedar: { name: 'Ancient western red cedar', emoji: '🌲', rare: 2, fact: 'Some coast cedars are over 1,000 years old and 4 m across. Cedar is the "tree of life" for Northwest Coast peoples: canoes, houses, clothing, rope and baskets.', where: 'deep in old forest, very rarely' },
};
register('sitkaspruce', { kind: 'flora', group: 'Trees', name: 'Sitka spruce', emoji: '🌲', fact: 'The biggest spruce in the world, with stiff, sharp blue-green needles. It loves wet coastal flats and river mouths.', where: 'wet low forest near the coast' });
register('vinemaple', { kind: 'flora', group: 'Trees', name: 'Vine maple', emoji: '🍁', fact: 'A small, sprawling maple of the forest understory. In the fall it lights the dark woods up bright red.', where: 'forest understory' });
register('bigleafmaple', { kind: 'flora', group: 'Trees', name: 'Bigleaf maple', emoji: '🍁', fact: 'Leaves up to 60 cm across, branches carpeted in moss and licorice ferns. They turn gold in the fall.', where: 'low forest and stream banks' });
register('redalder', { kind: 'flora', group: 'Trees', name: 'Red alder', emoji: '🌳', fact: 'Pale grey-white bark (cut it and it turns red-orange). It fixes nitrogen and heals logged land, growing up to 2 m a year.', where: 'low forest, river banks, clearings' });
register('douglasfir', { kind: 'flora', group: 'Trees', name: 'Douglas fir', emoji: '🌲', fact: 'The giant of the coast: up to 90 m tall, with thick, deeply furrowed bark that survives forest fires. Its cones have little "mouse tails" sticking out.', where: 'everywhere in the coast forest' });
register('redcedar', { kind: 'flora', group: 'Trees', name: 'Western red cedar', emoji: '🌲', fact: 'BC\'s official tree. Drooping branches, stringy red-brown bark and a sweet smell. It rots very slowly, so a fallen cedar can feed a forest for centuries.', where: 'wet forest' });
register('hemlock', { kind: 'flora', group: 'Trees', name: 'Western hemlock', emoji: '🌲', fact: 'Look for the drooping, nodding top. It grows happily in deep shade, so it slowly takes over old forests.', where: 'shady forest' });
for (const [id, p] of Object.entries(P)) register(id, { kind: 'flora', group: p.hab === 'garden' || p.hab === 'bed' ? 'Gardens' : p.hab === 'alpine' ? 'Alpine meadows' : p.hab === 'meadowVI' ? 'Garry oak meadows' : 'Forest & clearings', name: p.name, emoji: p.emoji, fact: p.fact, where: { forest: 'the forest floor', wet: 'wet spots in the forest', clear: 'clearings and forest edges', alpine: 'alpine meadows above the trees', garden: 'city gardens', bed: 'city flower beds and gardens', meadowVI: 'Victoria\'s Garry oak meadows' }[p.hab] });
for (const [id, p] of Object.entries(RARE)) register(id, { kind: 'flora', group: 'Rare finds', name: p.name, emoji: p.emoji, rare: p.rare, fact: p.fact, where: p.where });
for (const [id, p] of Object.entries(TREES)) register(id, { kind: 'flora', group: 'Trees', name: p.name, emoji: p.emoji, rare: p.rare || 0, fact: p.fact, where: p.where });
register('fairyring', { kind: 'flora', group: 'Rare finds', name: 'Fairy ring', emoji: '🧚', rare: 2, fact: 'A perfect circle of mushrooms. The fungus grows outward underground for decades, and pops up mushrooms at its edge. Folklore says fairies dance there.', where: 'forest and park lawns in the fall' });

// ---------- meshes ----------
const meshes = {};
// garden shrubs use the tree system's textured leaf-card shrub (real leaves, not a smooth blob): [geometry, scale]
const LEAFGEO = { rhodo: [shrubGeo(61), 1.35], hydrangea: [shrubGeo(71), 0.95], rose: [shrubGeo(81), 0.75] };
function im(key, cap, mat = MAT) { if (meshes[key]) return meshes[key]; const lg = LEAFGEO[key], m = new THREE.InstancedMesh(lg ? lg[0] : GEO[key], lg ? FOLIAGE : mat, cap); m.count = 0; m.frustumCulled = false; m.castShadow = cap < 200; m.receiveShadow = true; m.setColorAt(0, new THREE.Color()); m.visible = false; scene.add(m); return meshes[key] = m; }
const CAP = { leaf: 700, fl: 700, tree: 60 };

// ---------- habitat on a coarse 10 m grid ----------
const houseNear = (x, z) => { for (const b of nearBuildings(x, z, 10)) if (b.house) return true; return false; };
function habitatAt(x, z) {
  if (isWater(x, z)) return null;
  const h = heightAt(x, z); if (isSnow(x, z, h) || h > snowLine() - 250) return null;   // the drawn snow starts a little below the snow line
  if (buildingAt(x, z)) return null;
  const nr = nearestRoad(x, z, 12); if (nr && nr.d < nr.road.w / 2 + 0.8) return null;
  const island = onIsland(x, z), m = maskAt(x, z), forest = wildForest(x, z, h);
  const wet = vnoise(x * 0.012 + 3, z * 0.012 - 7);
  const c = { h, forest, island, wet: forest && h < 600 && (wet > 0.62 || (waterLevel(x, z) > 0 && h < 400)) };
  if (forest) return { ...c, k: c.wet ? 'wet' : 'forest' };
  if (h > 1250) return { ...c, k: 'alpine' };
  const town = m !== -1 || townDensity(x, z) > 0.01 || isNorthShoreTown(x, z, h) || isRichmond(x, z);
  if (island && h < 220 && (areaKind(x, z, 'park') || areaKind(x, z, 'grass') || !town)) return { ...c, k: 'meadowVI' };
  if (town) { if (houseNear(x, z)) return { ...c, k: 'garden' }; if (areaKind(x, z, 'flower')) return { ...c, k: 'bed' }; if (areaKind(x, z, 'park') && hash2(Math.floor(x / 30), Math.floor(z / 30)) < 0.12) return { ...c, k: 'bed' }; return { ...c, k: 'town' }; }
  if (h > 3 && h < 1100) return { ...c, k: 'clear' };
  return { ...c, k: 'none' };
}
let areaIdx = null;
function areaKind(x, z, k) {
  if (!areaIdx) { areaIdx = new Map(); for (const a of M.areas) { if (a.line || !['park', 'grass', 'flower'].includes(a.k)) continue; let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (let i = 0; i < a.p.length; i += 2) { x0 = Math.min(x0, a.p[i]); x1 = Math.max(x1, a.p[i]); z0 = Math.min(z0, a.p[i + 1]); z1 = Math.max(z1, a.p[i + 1]); } const r = { a, x0, z0, x1, z1 }; for (let i = Math.floor(x0 / 250); i <= Math.floor(x1 / 250); i++) for (let j = Math.floor(z0 / 250); j <= Math.floor(z1 / 250); j++) { const kk = i * 100003 + j; if (!areaIdx.has(kk)) areaIdx.set(kk, []); areaIdx.get(kk).push(r); } } }
  const l = areaIdx.get(Math.floor(x / 250) * 100003 + Math.floor(z / 250)); if (!l) return false;
  for (const r of l) if (r.a.k === k && x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) { const p = r.a.p; let c = false; for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) if (((p[i + 1] > z) !== (p[j + 1] > z)) && x < (p[j] - p[i]) * (z - p[i + 1]) / (p[j + 1] - p[i + 1]) + p[i]) c = !c; if (c) return true; }
  return false;
}

// ---------- building the plants around you (time-sliced so moving never hitches) ----------
const R = 80, CELL = 10, FINE = 1.8;
export const placed = [];   // { id, x, y, z, berry?, rare? } — what you can spot, photograph or eat
let build = null, cx = 1e9, cz = 1e9, lastSeason = null;
const _o = new THREE.Object3D(), _c = new THREE.Color();
function startBuild(px, pz) {
  const cells = [];
  for (let gx = Math.floor((px - R) / CELL); gx <= Math.floor((px + R) / CELL); gx++) for (let gz = Math.floor((pz - R) / CELL); gz <= Math.floor((pz + R) / CELL); gz++) { const x = (gx + 0.5) * CELL, z = (gz + 0.5) * CELL; if ((x - px) ** 2 + (z - pz) ** 2 < (R + CELL) ** 2) cells.push([gx, gz]); }
  build = { cells, i: 0, out: {}, pl: [], trees: [], px, pz };
}
function push(b, key, x, y, z, s, yaw, col) { (b.out[key] ||= []).push([x, y, z, s, yaw, col]); }
function stepBuild(ms) {
  const b = build, t0 = performance.now(), se = G.season || 'summer';
  while (b.i < b.cells.length && performance.now() - t0 < ms) {
    const [gx, gz] = b.cells[b.i++], cx0 = gx * CELL, cz0 = gz * CELL, hb = habitatAt(cx0 + CELL / 2, cz0 + CELL / 2);
    if (!hb || hb.k === 'none' || hb.k === 'town') continue;
    // trees first (one chance per cell)
    const th = hash2(gx * 7 + 1, gz * 13 + 5);
    if (hb.k === 'meadowVI' && th < 0.12) b.trees.push(['garryoak', cx0 + hash2(gx, gz) * CELL, cz0 + hash2(gz, gx) * CELL, 0.8 + th * 3]);
    else if ((hb.k === 'clear' || hb.k === 'meadowVI' || hb.k === 'forest') && hb.h < 120 && th < 0.08 && nearSea(cx0, cz0)) b.trees.push(['arbutus', cx0 + 5, cz0 + 5, 0.8 + th * 4]);
    else if (hb.k === 'forest' && hb.h < 700 && hash2(Math.floor(gx / 50), Math.floor(gz / 50) + 999) < 0.12 && gx % 50 === 25 && gz % 50 === 25) b.trees.push(['bigcedar', cx0 + 5, cz0 + 5, 1]);
    // ground plants on a fine grid inside the cell
    const list = Object.entries(P).filter(([, p]) => p.hab === hb.k || (hb.k === 'wet' && p.hab === 'forest') || (hb.k === 'forest' && p.hab === 'wet' && false));
    const fair = hash2(gx + 77, gz - 31) < 0.04 && se === 'fall' && hb.k === 'forest';
    if (fair) { for (let k = 0; k < 14; k++) { const a = k / 14 * 6.283, x = cx0 + 5 + Math.cos(a) * 2.2, z = cz0 + 5 + Math.sin(a) * 2.2, y = groundY(x, z); push(b, 'amanita', x, y, z, 0.9 + hash2(k, gx) * 0.4, a, _c.setHSL(0.03, 0.9, 0.5).getHex()); } b.pl.push({ id: 'fairyring', x: cx0 + 5, y: groundY(cx0 + 5, cz0 + 5), z: cz0 + 5, rare: true }); }
    for (let fx = 0; fx < CELL; fx += FINE) for (let fz = 0; fz < CELL; fz += FINE) {
      const x = cx0 + fx + hash2(gx * 31 + fx * 7, gz) * FINE, z = cz0 + fz + hash2(gz * 17 + fz * 5, gx) * FINE, r = hash2(Math.floor(x * 3), Math.floor(z * 3));
      // rare plants
      for (const [id, p] of Object.entries(RARE)) if ((p.hab === hb.k || (p.hab === 'forest' && hb.k === 'wet')) && p.when(se) && hash2(Math.floor(x * 5) + 3, Math.floor(z * 5) - 9) < p.p) { const y = groundY(x, z); push(b, id, x, y, z, 1.2, r * 6.28, 0xffffff); b.pl.push({ id, x, y, z, rare: true }); }
      let acc = 0; const pick = r * (hb.k === 'bed' ? 1.4 : hb.k === 'garden' ? 2.4 : 2.2);
      for (const [id, p] of list) {
        acc += p.w; if (pick > acc) continue;
        if (p.only && !p.only(se)) break;
        if ((hb.k === 'garden' || hb.k === 'bed' || hb.k === 'meadowVI') && (buildingAt(x, z) || pavedY(x, z) !== null)) break;   // never on sidewalks, paths or inside houses
        const y = groundY(x, z), s = 0.7 + hash2(Math.floor(z * 9), Math.floor(x * 9)) * 0.7, yaw = r * 40;
        let lc = _c.setHSL(p.leaf[0] + (r - 0.5) * 0.04, p.leaf[1], p.leaf[2] * (0.8 + hash2(Math.floor(x * 11), 1) * 0.4));
        if (se === 'fall' && p.fall) lc = _c.set(p.fall); if (se === 'winter' && p.fallCol) lc = _c.set(p.fallCol); if (se === 'fall' && p.fallCol) lc.lerp(new THREE.Color(p.fallCol), 0.5);
        if (se === 'winter' && !p.all && hb.k !== 'garden' && id !== 'oregongrape') lc.lerp(new THREE.Color('#6a5a40'), 0.6);
        push(b, id, x, y, z, s, yaw, lc.getHex());
        if (p.fl) { const fc = p.fl[1](se); if (fc) { const c = Array.isArray(fc) ? fc[Math.floor(hash2(Math.floor(x), Math.floor(z)) * fc.length)] : fc; push(b, p.fl[0], x, y, z, s, yaw, new THREE.Color(c).getHex()); } }
        b.pl.push({ id, x, y, z, berry: p.berry && p.berry(se) });
        break;
      }
    }
  }
  return b.i >= b.cells.length;
}
const nearSea = (x, z) => { for (let a = 0; a < 6.28; a += 0.8) { const wx = x + Math.cos(a) * 60, wz = z + Math.sin(a) * 60; if (isWater(wx, wz) && waterLevel(wx, wz) === 0) return true; } return false; };
function commit() {
  const b = build; build = null;
  for (const k in meshes) { meshes[k].count = 0; meshes[k].visible = false; }
  for (const [key, list] of Object.entries(b.out)) {
    const m = im(key, key.endsWith('Fl') ? CAP.fl : key in RARE || key === 'amanita' ? 60 : CAP.leaf); let n = 0;
    const k2 = LEAFGEO[key]?.[1] || 1; for (const [x, y, z, s, yaw, col] of list) { if (n >= m.instanceMatrix.count) break; _o.position.set(x, y - 0.02, z); _o.rotation.set(0, yaw, 0); _o.scale.setScalar(s * k2); _o.updateMatrix(); m.setMatrixAt(n, _o.matrix); m.setColorAt(n, _c.setHex(col)); n++; }
    m.count = n; m.visible = n > 0; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
  }
  // trees: arbutus, Garry oak (+ crown when in leaf), ancient cedar
  const se = G.season || 'summer', tr = { arbutus: [], oakTrunk: [], oakCrown: [], bigcedar: [] }, colls = [];
  for (const [id, x, z, s] of b.trees) {
    if (buildingAt(x, z) || isWater(x, z)) continue; const y = groundY(x, z) - 0.2, yaw = hash2(Math.floor(x), Math.floor(z)) * 6.28;
    if (id === 'garryoak') { tr.oakTrunk.push([x, y, z, s, yaw, 0xffffff]); if (se !== 'winter') tr.oakCrown.push([x, y, z, s, yaw, se === 'fall' ? 0x8a6a3a : se === 'spring' ? 0x7aa04a : 0x4a6a2a]); colls.push({ x, z, r: 0.5 * s, top: y + 4 * s }); }
    else if (id === 'arbutus') { tr.arbutus.push([x, y, z, s, yaw, 0x2f5a24]); colls.push({ x, z, r: 0.35 * s, top: y + 3 * s }); }
    else { tr.bigcedar.push([x, y, z, 1, yaw, se === 'winter' ? 0x3a5a3a : 0x2a4a1e]); colls.push({ x, z, r: 2.4, top: y + 14 }); }
    b.pl.push({ id: id, x, y, z, rare: id === 'bigcedar', tree: true });
  }
  for (const [key, list] of Object.entries(tr)) { const m = im(key, CAP.tree, TMAT); m.castShadow = true; let n = 0; for (const [x, y, z, s, yaw, col] of list) { if (n >= CAP.tree) break; _o.position.set(x, y, z); _o.rotation.set(0, yaw, 0); _o.scale.setScalar(s); _o.updateMatrix(); m.setMatrixAt(n, _o.matrix); m.setColorAt(n, _c.setHex(col)); n++; } m.count = n; m.visible = n > 0; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
  setColliders('flora', colls);
  placed.length = 0; placed.push(...b.pl);
}

// ---------- per frame ----------
let spotT = 0, toastedTree = {};
export function updateFlora(dt, pl) {
  WIND_T.value += dt;
  if (!pl.char) return;
  const se = G.season;
  if (!build && (Math.hypot(pl.x - cx, pl.z - cz) > 30 || se !== lastSeason) && !pl.flying) { cx = pl.x; cz = pl.z; lastSeason = se; startBuild(pl.x, pl.z); }
  if (build && stepBuild(2.5)) commit();
  // spotting: walk within a few metres
  spotT -= dt; if (spotT > 0 || pl.vehicle && pl.vehicle.speedAbs > 6) return; spotT = 0.5;
  for (const p of placed) {
    const d = Math.hypot(p.x - pl.x, p.z - pl.z);
    if (p.rare && d < (p.id === 'bigcedar' ? 30 : p.id === 'fairyring' ? 8 : 4)) { if (spot(p.id)) { const sec = { ghostpipe: 'ghostpipe', fairyslipper: 'fairyslipper', phantom: 'phantomorchid', chocolily: 'chocolily', bigcedar: 'ancientcedar', fairyring: 'fairyring' }[p.id]; if (sec) discover(sec); } }
    else if (p.tree && d < 12) softSpot(p.id);
    else if (d < 2.5) softSpot(p.id);
  }
  // the forest's own trees count too when you're among them
  const h = heightAt(pl.x, pl.z);
  if (wildForest(pl.x, pl.z, h) && Math.random() < 0.3) { const pool = ['douglasfir', 'redcedar', 'hemlock']; if (h < 380) pool.push('redalder', 'bigleafmaple', 'vinemaple'); if (h < 120) pool.push('sitkaspruce'); softSpot(pool[Math.floor(Math.random() * pool.length)]); }
}
// E: eat ripe berries (called from fauna.js faunaPrompt when no animal is close)
export function floraPrompt(pl) {
  if (pl.vehicle) return '';
  let best = null, bd = 2.2; for (const p of placed) { if (!p.berry) continue; const d = Math.hypot(p.x - pl.x, p.z - pl.z); if (d < bd) { bd = d; best = p; } }
  if (!best) return '';
  const nm = P[best.id].name.toLowerCase();
  if (tapped('KeyE')) { pl.health = Math.min(100, (pl.health || 0) + 8); best.berry = false; spot(best.id, true); ui.toast(`🫐 A handful of ${nm}`, { salmonberry: 'Watery and mild, a bit like a raspberry that went to the beach.', thimbleberry: 'Soft, sweet and falls apart in your fingers. The best trail snack in BC.', huckleberry: 'Tart and bright. Leave some for the bears.', oregongrape: 'SOUR! Your face folds in half. (They make good jelly with lots of sugar.)' }[best.id] + ' (+8 health)', 3200); }
  return `<kbd>E</kbd> 🫐 Eat some ${nm}`;
}
// P: photograph the nearest notable plant in view (called by fauna.js when no animal is in the shot)
const _v = new THREE.Vector3();
export function photoPlant(pl) {
  let best = null, bd = 1e9;
  for (const p of placed) { const d = Math.hypot(p.x - pl.x, p.z - pl.z); if (d > (p.tree ? 40 : 8)) continue; _v.set(p.x, p.y + (p.tree ? 5 : 0.3), p.z).project(camera); if (_v.z > 1 || Math.abs(_v.x) > 0.6 || Math.abs(_v.y) > 0.7) continue; const sc = d + (p.rare ? -5 : 0); if (sc < bd) { bd = sc; best = p; } }
  if (best) photo(best.id);
}
export const _flora = { placed, meshes, habitatAt, get build() { return build; }, rebuild() { cx = 1e9; } };
