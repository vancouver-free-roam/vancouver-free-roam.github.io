// Garage: the fun layer on top of the real vehicle models (vehiclemodels.js).
//  - Spec card when you get in: what it's based on, real specs, star ratings (speed / acceleration / handling / snow),
//    a driving tip for that kind of vehicle and a real fact.
//  - Collection: every model you've driven is remembered (saved in stats.rode as 'm:<id>'); 10 / 25 = secrets.
//  - Ev-Oh car share: hop into a parked Ev-Oh, it bills your phone ($4 unlock, no karma lost).
//  - Surprises: hit 88 mph (141.6 km/h) in the DeLorian and… something happens. A 3-second drift = secret. The Lambo
//    gets cheers from people on the sidewalk.
import { G, pick } from './core.js';
import { ui } from './ui.js';
import { MODELS } from './vehiclemodels.js';
import { peds, say } from './people.js';
import { sfx } from './sound.js';
import { W } from './weather.js';

let player = null, discover = () => {}, driftT = 0, cheerT = 0, timeT = 0;
const stars = (x) => { const n = Math.max(1, Math.min(5, Math.round(x))); return '★'.repeat(n) + '☆'.repeat(5 - n); };
const DRIVE = { fwd: 'front-wheel drive', rwd: 'rear-wheel drive', awd: 'all-wheel drive' };
export function modelCount() { return player ? [...player.stats.rode].filter(r => r.startsWith('m:')).length : 0; }

function tipFor(M) {
  if (M.base === 'bike') return M.assist ? 'Motor helps up to 32 km/h · Shift = pedal hard' : 'Shift = sprint · hold Space and let go to hop';
  if (M.base === 'motorbike') return M.style === 'cruiser' ? 'Heavy and lazy to turn: brake early, lean late' : M.style === 'moped' ? 'Small wheels: easy does it over curbs' : 'Light and fast: S brakes, A/D lean · hold Space to wheelie-hop';
  if (M.base === 'bus' || (M.kg || 0) > 4000) return 'Heavy: it takes ages to stop. Brake early!';
  if (M.ev) return 'Electric: all its pull is there from zero · nearly silent';
  if (M.drive === 'rwd' && (M.drift || 1) >= 1.4) return 'Rear-wheel drive: floor it mid-corner and the tail steps out · Space = handbrake drift';
  if (M.drive === 'awd') return 'All-wheel drive: great grip in rain and snow';
  if ((M.soft || 1) > 1.25) return 'Tall and soft: it leans a lot in fast corners';
  return 'S = brake · Space = handbrake · Shift = floor it';
}
function specCard(v) {
  const M = v.model; if (!M || !player) return;
  const sp = [];
  if (M.hp) sp.push(M.hp + ' hp'); if (M.kg && M.base !== 'skate') sp.push(M.kg.toLocaleString() + ' kg');
  if (M.z100) sp.push('0–100 km/h in ' + M.z100 + ' s'); else if (M.z50) sp.push('0–50 km/h in ' + M.z50 + ' s');
  if (M.top) sp.push('top ' + M.top + ' km/h'); else if (M.max && !M.feel) sp.push('cruises ~' + Math.round(M.max * 3.6) + ' km/h');
  if (M.feel?.max) sp.push('top ~' + Math.round(M.feel.max * 3.6) + ' km/h');
  if (M.drive && M.base !== 'motorbike' && M.base !== 'snowmobile') sp.push(DRIVE[M.drive]);
  if (M.ev) sp.push('⚡ electric'); else if (M.hyb) sp.push('🔋 hybrid');
  let bars = '';
  if (M.Pk) {
    const acc = M.z100 ? 5.6 - Math.log2(M.z100 / 2.6) * 1.4 : 1.5, spd = 1 + (M.top - 90) / 58, hand = ((M.mu || 0.85) - 0.5) * 7 * Math.sqrt(M.resp || 1), snow = (v.d.snowGrip || 0.35) * 3.6;
    bars = `<br><small>Speed ${stars(spd)} · Acceleration ${stars(acc)} · Handling ${stars(hand)} · Snow ${stars(snow)}</small>`;
  }
  const title = (M.base === 'bike' ? '🚲 ' : M.base === 'motorbike' ? '🏍️ ' : v.d.kind === 'water' ? '🚤 ' : v.d.kind === 'plane' ? '🛩️ ' : v.d.kind === 'heli' ? '🚁 ' : '🚗 ') + M.name;
  const real = M.real ? `<small>Based on the ${M.real}</small><br>` : '';
  ui.toast(title, real + (sp.length ? sp.join(' · ') : '') + bars + '<br>' + tipFor(M) + (M.fact ? '<br><i>' + M.fact + '</i>' : ''), 6500);
}

export function initGarage(pl, disc) {
  player = pl; discover = disc || discover;
  const enter = pl.enterVehicle;
  pl.enterVehicle = function (v) {
    const moving = !!(v.ai && !v.ai.parked && !v.ai.cyc);
    enter.call(this, v);
    const M = v.model; if (!M) return;
    const key = 'm:' + M.id, fresh = !this.stats.rode.has(key);
    this.stats.rode.add(key);
    if (M.share && !moving && !v.owned) {   // car share: pay per trip, no karma lost
      this.money = Math.max(0, this.money - 4); sfx.coin?.(); discover('carshare');
      setTimeout(() => ui.toast('📱 Ev-Oh car share unlocked', 'Billed $4 to your phone. Park it anywhere in the Home Zone when you\'re done. (No karma lost: you actually paid!)', 3500), 50);
    }
    // the card the first time you drive a model (and for anything big or special every time)
    if (fresh || M.rare || M.base === 'sports') setTimeout(() => specCard(v), fresh ? 2700 : 100);
    const n = modelCount();
    if (fresh && n === 10) discover('garage10');
    if (fresh && n === 25) discover('garage25');
    if (M.id === 'lambo') discover('supercar');
  };
}

export function updateGarage(dt) {
  const v = player?.vehicle; if (!v || !v.model) { driftT = 0; return; }
  const M = v.model;
  // 88 miles per hour!
  if (M.id === 'delorian' && v.speedAbs * 3.6 >= 141.6 && G.t > timeT) {
    timeT = G.t + 60; W.flash = 1; sfx.thunder?.();
    const back = 1 + Math.floor(Math.random() * 3);
    G.hour = (G.hour - back + 24) % 24;
    ui.toast('⚡ 88 MILES PER HOUR!', `Great Scott! A flash of light, two trails of fire… and it's suddenly ${back} hour${back > 1 ? 's' : ''} earlier. Where we're going, we don't need roads. (We do. Stay on the roads.)`, 6000);
    setTimeout(() => discover('outatime'), 5000);   // let the 88 mph message show first
  }
  // sustained drift (vehicles.js roadEngine sets v.drift / v.slip)
  if ((v.drift || 0) > 0.5 && (v.slip || 0) > 0.25 && v.speedAbs > 8) { driftT += dt; if (driftT > 3) { discover('drift'); if (driftT - dt <= 3) ui.toast('🌀 Sideways!', 'A three-second drift. The tyres are crying. The crowd is not.', 2200); } }
  else driftT = Math.max(0, driftT - dt * 2);
  // supercar spotting: people on the sidewalk pull out their phones
  if ((M.id === 'lambo' || M.id === 'corvette' || M.id === 'p911' || M.id === 'delorian') && G.t > cheerT && v.speedAbs < 14) {
    cheerT = G.t + 6;
    for (const p of peds) if (Math.hypot(p.x - v.x, p.z - v.z) < 20 && Math.random() < 0.35) { say(p, pick(M.id === 'delorian' ? ['Is that… a DeLorean?!', 'Doc?!', '⚡ 1.21 gigawatts!'] : ['📸 Nice car!', 'Is that a real one?!', 'Rev it!', 'Leased. Definitely leased.', '😍']), 2400); break; }
  }
}
