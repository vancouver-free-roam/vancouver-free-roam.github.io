// The wildlife journal (field guide) in your phone: every animal and plant you discover gets an entry with a real fact,
// a "spotted" count and a photo tick. fauna.js / flora.js / sealife.js call spot() and photo(); main.js shows journalHtml()
// in the phone's 📖 Nature tab and saves journalSave() with the game.
import { G } from './core.js';
import { ui } from './ui.js';
import { sfx } from './sound.js';
import { discover } from './missions.js';

export const ENTRIES = new Map();   // id -> { id, name, emoji, kind: 'fauna'|'flora', group, fact, where, rare: 0 common / 1 uncommon / 2 rare / 3 legendary }
export const J = { seen: {}, photos: {} };   // id -> count, id -> true
const PAY = [5, 15, 50, 150];
let toastT = 0;

export function register(id, e) { if (!ENTRIES.has(id)) ENTRIES.set(id, { id, rare: 0, kind: 'fauna', group: 'Other', ...e }); }

// a sighting: the first one of a species shows its fact; later ones just count
export function spot(id, quiet = false) {
  const e = ENTRIES.get(id); if (!e) return false;
  const first = !J.seen[id];
  J.seen[id] = (J.seen[id] || 0) + 1;
  if (first) {
    if (!quiet || e.rare >= 2) { ui.toast(`📖 New in your field guide: ${e.emoji} ${e.name}`, e.fact + (e.rare >= 2 ? ' (Rare sighting!)' : ''), e.rare >= 2 ? 6500 : 5000); if (e.rare >= 2) sfx.chime(); }
    milestones();
  }
  return first;
}
export function photo(id) {
  const e = ENTRIES.get(id); if (!e) return;
  sfx.shutter(); spot(id, true);
  if (J.photos[id]) { ui.toast(`📸 ${e.emoji} ${e.name}`, 'Nice shot. You already sold one of these, so this one is for your fridge.', 1800); return; }
  J.photos[id] = true; const pay = PAY[e.rare || 0];
  try { const P = window.__game?.player; if (P) P.money += pay; } catch (er) { }
  ui.toast(`📸 ${e.emoji} ${e.name} (+$${pay})`, pick2(['A nature magazine bought your photo.', 'Your photo went viral on r/vancouver.', 'The BC Parks newsletter wants to print it.', 'Your aunt made it her phone background.']), 3200);
  if (Object.keys(J.photos).length >= 10) discover('naturephotog');
}
const pick2 = a => a[Math.floor(Math.random() * a.length)];
function milestones() {
  const n = Object.keys(J.seen).filter(k => ENTRIES.has(k)).length;
  if (n >= 10) discover('naturalist'); if (n >= 30) discover('fieldguide');
  const flora = Object.keys(J.seen).filter(k => ENTRIES.get(k)?.kind === 'flora').length; if (flora >= 15) discover('botanist');
}
// toasts for small "spotted" things (common plants) are rate-limited so walking through a meadow doesn't spam you
export function softSpot(id) { if (J.seen[id]) { J.seen[id]++; return; } if (G.t - toastT < 12) return; toastT = G.t; spot(id); }
export const seen = id => !!J.seen[id];
export function journalSave() { return { seen: J.seen, photos: J.photos }; }
export function journalLoad(s) { J.seen = { ...(s?.seen || {}) }; J.photos = { ...(s?.photos || {}) }; }

// the phone tab
export function journalHtml(filter = 'fauna') {
  const list = [...ENTRIES.values()].filter(e => e.kind === filter);
  const found = list.filter(e => J.seen[e.id]).length, all = [...ENTRIES.values()], tot = all.filter(e => J.seen[e.id]).length;
  const groups = [...new Set(list.map(e => e.group))];
  const stars = r => ['', '⭐', '⭐⭐', '🌟🌟🌟'][r || 0];
  let h = `<p><button data-jr="fauna" style="${filter === 'fauna' ? 'outline:3px solid #fff' : ''}">🦌 Animals</button> <button data-jr="flora" style="${filter === 'flora' ? 'outline:3px solid #fff' : ''}">🌿 Plants</button></p>
    <p><b>${found}/${list.length}</b> ${filter === 'fauna' ? 'animals' : 'plants'} found · ${tot} in total · 📸 ${Object.keys(J.photos).length} photos sold</p>
    <p style="opacity:.75">Walk close to wildlife and plants to add them. Press <kbd>P</kbd> to photograph one (the first photo of each species sells to a magazine). <kbd>E</kbd> next to an animal: watch it (or make noise to send a bear away). Please don't feed the wildlife.</p>`;
  for (const g of groups) {
    h += `<h4>${g}</h4>`;
    for (const e of list.filter(e => e.group === g)) {
      if (J.seen[e.id]) h += `<div class="egg">${e.emoji} <b>${e.name}</b> ${stars(e.rare)} · seen ${J.seen[e.id]}× ${J.photos[e.id] ? '· 📸' : ''}<br><small>${e.fact}</small></div>`;
      else h += `<div class="egg">❓ <b>???</b> ${stars(e.rare)}<br><small>Hint: ${e.where || 'keep exploring'}</small></div>`;
    }
  }
  return h;
}

// sea and city animals made by other modules (sealife.js, animals.js, wildlife.js, scenery.js) also go in the guide
const SEA = 'Sea & shore', CITYG = 'City & parks', BIRDS = 'Birds';
register('orca', { name: 'Orca (killer whale)', emoji: '🐋', group: SEA, rare: 2, fact: 'Actually the biggest dolphin. BC\'s Southern Residents eat almost only Chinook salmon; each pod has its own dialect of calls.', where: 'deep water in English Bay, Burrard Inlet and the Strait' });
register('humpback', { name: 'Humpback whale', emoji: '🐳', group: SEA, rare: 2, fact: 'Hunted out of the Salish Sea by 1908, they came back in the 2000s. Each tail fluke pattern is unique, like a fingerprint.', where: 'open sea, watch for the spout' });
register('dolphin', { name: 'Pacific white-sided dolphin', emoji: '🐬', group: SEA, rare: 1, fact: 'Fast, acrobatic and fond of bow-riding. They travel in groups of dozens, sometimes hundreds.', where: 'drive a fast boat in open water' });
register('harbourseal', { name: 'Harbour seal', emoji: '🦭', group: SEA, fact: 'Seals have no outside ear flaps and wriggle on land like caterpillars. They often pop up to stare at boaters.', where: 'any calm water and rocky shores' });
register('heron', { name: 'Great blue heron', emoji: '🦩', group: BIRDS, fact: 'Stanley Park has one of the biggest urban heron colonies in North America, right by the tennis courts.', where: 'shallow water at the shore' });
register('baldeagle', { name: 'Bald eagle', emoji: '🦅', group: BIRDS, fact: 'Wings up to 2.3 m across. Thousands gather at Brackendale near Squamish every winter for the salmon.', where: 'over the water and the rivers' });
register('caddy', { name: 'Cadborosaurus ("Caddy")', emoji: '🐉', group: SEA, rare: 3, fact: 'BC\'s legendary sea serpent, "seen" since the 1930s. Scientists are still waiting for a photo.', where: 'far out at sea… if it exists' });
register('goose', { name: 'Canada goose', emoji: '🪿', group: BIRDS, fact: 'Vancouver\'s geese mostly stopped migrating: the parks are too nice. They hiss and charge to defend their goslings.', where: 'Stanley Park, Vanier Park, English Bay lawns' });
register('raccoon', { name: 'Raccoon', emoji: '🦝', group: CITYG, fact: 'Raccoons wash their food… sort of. They dunk it to feel it better with their super-sensitive paws.', where: 'city parks and back lanes, mostly at night' });
register('coyote', { name: 'Coyote', emoji: '🐺', group: CITYG, fact: 'About 3,000 coyotes live in Metro Vancouver. Never feed them: a fed coyote loses its fear of people.', where: 'Stanley Park, Pacific Spirit, quiet streets at night' });
register('crow', { name: 'Northwestern crow', emoji: '🐦‍⬛', group: BIRDS, fact: 'Crows remember faces for years. Every evening up to 6,000 fly to roost at Still Creek in Burnaby.', where: 'everywhere in the city (look up at dusk)' });
register('gull', { name: 'Glaucous-winged gull', emoji: '🕊️', group: BIRDS, fact: 'The classic Vancouver seagull. Smart, loud, and will absolutely steal your fries.', where: 'the waterfront' });
register('pigeon', { name: 'Rock pigeon', emoji: '🐦', group: BIRDS, fact: 'Brought from Europe centuries ago. They can find their way home from hundreds of km away.', where: 'sidewalks and plazas' });
register('greysquirrel', { name: 'Eastern grey squirrel', emoji: '🐿️', group: CITYG, fact: 'Not from here! Eight were brought to Stanley Park from Ontario in 1909. Many are black, not grey.', where: 'city parks' });
register('grizzlies', { name: 'Coola & Grinder', emoji: '🐻', group: 'Mountains & forest', rare: 2, fact: 'Two orphaned grizzly brothers who live at the Grouse Mountain refuge. Each weighs over 400 kg.', where: 'the refuge at the top of Grouse' });
