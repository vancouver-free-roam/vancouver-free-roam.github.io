// People who notice you: they wave and say hi (based on who you are, what you wear, the weather and the time),
// step out of your way, react when you bump them or stand too close, and you can chat with anyone (press E).
import { G, tapped, pick, R } from './core.js';
import { peds, say } from './people.js';
import { pois } from './city.js';
import { SPOTS } from './landmarks.js';
import { ui } from './ui.js';
import { sfx } from './sound.js';
import { setWaypoint, activeMission } from './missions.js';
import { OWN } from './shops.js';
import { benches, crossings } from './streetprops.js';
import { makeCrosser } from './people.js';
import { transitStops, busStoppedNear } from './transit.js';
import { nearestRoad, surfaceY, isDriveType } from './city.js';
import { makePersona, moodLine, line, about, gossip, trivia, offerFavour, startFavour, updateFavour, cancelFavour, favour, adultOK } from './voices.js';

const NAMES = ['Skyler', 'Priya', 'Jordan', 'Raj', 'Taylor', 'Logan', 'Chloe', 'Hiro', 'Amir', 'Sofia', 'Liam', 'Ava', 'Kenji', 'Noor', 'Marcus', 'Ingrid', 'Dev', 'Harpreet', 'Jasmine', 'Wei', 'Mateo', 'Fatima', 'Brody', 'Sunny', 'Gord', 'Linda', 'Tyler', 'Mackenzie'];
const JOBS = [
  ['yoga instructor', ['Namaste! Have you tried hot yoga? It\'s like regular yoga but sweatier.', 'I just did a sunrise class on the seawall. I\'m SO centred right now.']],
  ['tech bro', ['I\'m building an app that\'s like Uber, but for dog walkers… for cats.', 'My startup just raised money. We don\'t have a product. That\'s the vibe.']],
  ['film extra', ['I\'m "Pedestrian #4" in a show shooting around the corner. Big break!', 'Vancouver pretends to be New York in every movie. I\'ve played a New Yorker 40 times.']],
  ['barista', ['I made 600 oat-milk lattes today. I dream in foam.', 'Do NOT ask me for a "small". It\'s a "tall". Don\'t ask why.']],
  ['realtor', ['Want a business card? Here are six.', 'Great time to buy! A parking spot just sold for the price of a house in Ontario.']],
  ['dog walker', ['I\'m walking eleven dogs. Somewhere. They were here a second ago.', 'This doodle has more Instagram followers than me.']],
  ['UBC student', ['I\'m so tired. I have three midterms and one brain cell.', 'The 99 B-Line was so full I rode on someone\'s backpack.']],
  ['retired fisherman', ['Back in my day, the salmon jumped right into your boat.', 'See that seagull? Stole my sandwich in 1987. Never forgot.']],
  ['tourist from Ohio', ['Is it always this pretty? And always this wet?', 'Where do I see a moose? Someone said Stanley Park. Was that a joke?']],
  ['cyclist in full Lycra', ['I just rode up Cypress. Twice. Before breakfast.', 'Bike lanes are a human right. Also my whole personality.']],
  ['Whistler ski bum', ['Bro, it dumped 40 cm up top! …Last week. I\'m still talking about it.', 'I live in a van, but it\'s a really nice van.']],
  ['nurse', ['Twelve-hour shift done. If I sit down I\'ll fall asleep standing up.', 'Wear a helmet on those Lyme scooters. Please. I\'m begging you.']],
  ['street musician', ['Any requests? I know "Wonderwall" and… "Wonderwall".', 'Tips welcome! I take cash, cards, and compliments.']],
];
const BUMP = ['Whoa! Watch it!', 'Hey! Sorry! …Wait, you bumped ME.', 'Ow! My latte!', 'Running late, eh?', 'Rude! …Sorry for saying rude.', { t: 'Watch it, dumbass!', a: 1 }, { t: 'Jesus, buddy! Where\'s the fire?', a: 1 }, { t: 'Holy shit, my phone!', a: 1 }];
const CLOSE = ['Um… personal space?', 'Can I… help you?', 'Why are you standing so close?', 'Are you a mime? Is this a bit?', { t: 'Dude. Back the hell up.', a: 1 }, { t: 'Buy me dinner first, jeez.', a: 1 }];

function persona(p) {
  if (!p.persona) p.persona = makePersona(p.x, p.z);
  return p.persona;
}

// a greeting that fits the moment
function greetLine(pl) {
  const L = ['Hey!', 'Hi there!', 'Sorry! Oh wait, I didn\'t do anything. Sorry.', 'Hey neighbour!', 'How\'s it going?', '👋'];
  const add = (...a) => { L.push(...a, ...a); };   // context lines count double
  const h = G.hour;
  if (h < 11 && h > 5) add('Morning!', 'Good morning! Coffee first, talk later.');
  else if (G.night > 0.6) add('Out late, eh?', 'Evening!');
  if ((G.wet || 0) > 0.3) add('Lovely weather for ducks!', 'Rain again, eh?');
  else if ((G.cloud || 0) < 0.3 && G.night < 0.3) add('Beautiful day, eh?', 'The mountains are out!');
  if (G.season === 'winter' && (G.wet || 0) > 0.2) add('SNOW! The whole city is closed!');
  const o = OWN.outfit;
  if (o === 'denim') add('Canadian tuxedo! Respect.'); if (o === 'jersey') add('Go Canucks Go!', 'Nice jersey! This is our year!'); if (o === 'yoga') add('Love the yoga pants!'); if (o === 'shell') add('Ooh, fancy jacket.'); if (o === 'vest') add('Nice vest. Do you work in tech?');
  const c = pl.char?.id;
  if (c === 'dex') add('Wait… are you Dex Sterling?!', 'Loved you in "Guy #3 Who Gets Eaten"!');
  if (c === 'mei') add('OMG, Mei Chen! I watch your ghost videos!', 'Mei! Did you find any ghosts today?');
  if (c === 'brenda') add('Brenda! I saw your face on a bus bench!', 'Are you selling? Please say no.');
  if (c === 'kai') add('Hey, aren\'t you the bike courier? You almost hit me last week!');
  if (pl.karma <= -5) add('Uh oh. It\'s YOU.', 'I\'m keeping my eye on you…');
  if (pl.karma >= 5) add('Hey! You\'re that nice person from the news!');
  if (pl.umbrella && (G.wet || 0) > 0.2) add('Ooh, can I share your umbrella?');
  if (adultOK()) add(...[pick(['Morning! Too early for this shit.', 'Holy crap, it\'s not raining!', 'Nice outfit. Did you lose a bet?', 'Hey hot stuff. …Sorry, I was talking to my coffee.', 'Damn, it\'s cold. My nipples could cut glass.', 'Another day, another $9 latte. Kill me.'])]);
  const v = pl.vehicle;
  if (v) { L.length = 0; if (v.type === 'bike') L.push('Bike lane hero!', 'Nice bike!'); else if (v.type === 'scooter') L.push('A Lyme scooter? Living dangerously.', 'Helmet! Wear a helmet!'); else if (v.type === 'sports') L.push('Nice ride!', 'Whoa, is that yours?!'); else if (v.type === 'bus') L.push('Hey, wait for me! …Oh, you\'re not a real bus.'); else L.push('Nice wheels!', 'Hey!', '👋'); }
  return pick(L);
}

let greetCD = 0, closeT = 0, closePed = null, favShown = false;
export function updateSocial(dt, pl) {
  if (!pl.char || pl.transit || pl.dead) return;
  updateHangouts(dt, pl);
  greetCD -= dt;
  const onFoot = !pl.vehicle;
  let nearest = null, nd = 3;
  for (const p of peds) {
    if (!p.visible || p.state === 'down' || p.state === 'flee' || p.kind === 'dance') continue;
    const dx = p.x - pl.x, dz = p.z - pl.z, d = Math.hypot(dx, dz);
    if (d < nd && onFoot) { nd = d; nearest = p; }
    // step out of your way
    if (onFoot && d < 1.5 && p.state === 'walk') p.dodge = Math.min(1.6, (p.dodge || 0) + dt * 3);
    // bumped while you run
    if (p.bumpT > 0) p.bumpT -= dt;
    if (onFoot && pl.running && d < 0.8 && !(p.bumpT > 0)) { p.bumpT = 4; p.state = 'idle'; p.timer = 1.4; say(p, line(BUMP), 2200); }
    // greetings: people walking towards you notice you
    if (!p.greeted && greetCD <= 0 && d > 1.2 && d < (onFoot ? 7 : 12) && p.state === 'walk' && (onFoot || pl.vehicle.speedAbs < 9) && !pl.flying) {
      const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
      if ((-dx * fx - dz * fz) / d < 0.2) continue;
      p.greeted = true;
      if (Math.random() < 0.6) { greetCD = R(2.5, 4.5); p.state = 'greet'; p.kind = 'wave'; p.timer = 2.2; const ps = persona(p); say(p, Math.random() < 0.3 ? moodLine(ps) : Math.random() < 0.2 ? line(ps.T.intro) : greetLine(pl), 2800); }
    }
  }
  // standing way too close for too long
  if (nearest && nd < 1.1 && Math.hypot(pl.vx || 0, pl.vz || 0) < 0.5) { if (closePed !== nearest) { closePed = nearest; closeT = 0; } closeT += dt; if (closeT > 3 && !nearest.saidClose) { nearest.saidClose = true; nearest.state = 'talk'; nearest.timer = 2.5; say(nearest, line(CLOSE), 2500); } }
  else closeT = 0;
  // favours (little jobs people asked you for)
  if (activeMission() && favour) cancelFavour();
  const ft = activeMission() ? '' : updateFavour(dt, pl, OWN, tapped('KeyP'), setWaypoint);
  if (ft || favShown) { if (!activeMission()) ui.objective(ft || ''); favShown = !!ft; }
  // press E to chat (only when nothing else wants the E key, and not during a mission)
  if (onFoot && nearest && !G.dialogOpen && !activeMission() && document.getElementById('prompt')?.classList.contains('hidden')) {
    ui.prompt(`<kbd>E</kbd> 💬 Chat with ${persona(nearest).name} <small>(${persona(nearest).job})</small>`);
    if (tapped('KeyE')) chatWith(nearest, pl);
  }
}

// ---------- sitting on benches, waiting for the bus ----------
let hangT = 0;
function sitOn(p, b) {
  const slot = b.taken++, side = slot ? 0.42 : -0.42, tx = Math.cos(b.yaw), tz = -Math.sin(b.yaw), fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
  p.x = b.x + tx * side - fx * 0.09; p.z = b.z + tz * side - fz * 0.09; p.y = b.y; p.yaw = b.yaw + Math.PI;   // back against the backrest
  p.state = 'sit'; p.kind = 'sit'; p.timer = R(12, 40); p.bench = b;
  if (Math.random() < 0.25) say(p, pick(['Ahh, my feet.', 'Best seat in the city.', 'Just people-watching.', '*scrolls phone*', 'Five more minutes…']), 2500);
}
function waitAt(p, s) {
  const a = R(0, 6.28), r = R(0.8, 2.6); p.x = s.x + Math.cos(a) * r; p.z = s.z + Math.sin(a) * r; p.y = surfaceY(p.x, p.z, p.y + 1);
  const nr = nearestRoad(s.x, s.z, 30, rd => isDriveType(rd.t));
  if (nr) { const e = nr.e, M2 = window.MAP, qx = M2.nodes[e.a * 2] + (M2.nodes[e.b * 2] - M2.nodes[e.a * 2]) * nr.t, qz = M2.nodes[e.a * 2 + 1] + (M2.nodes[e.b * 2 + 1] - M2.nodes[e.a * 2 + 1]) * nr.t; p.yaw = Math.atan2(-(qx - p.x), -(qz - p.z)); }
  p.state = 'wait'; p.kind = 'walk'; p.timer = R(30, 90); p.stop = s;
}
function updateHangouts(dt, pl) {
  // people waiting at a stop get on when a bus stops there
  for (let i = peds.length - 1; i >= 0; i--) { const p = peds[i]; if (p.state === 'wait' && p.stop && busStoppedNear(p.stop.x, p.stop.z, 18)) peds.splice(i, 1); }
  hangT -= dt; if (hangT > 0) return; hangT = 0.5;
  // a steady trickle of people using the crosswalks near you
  if (peds.filter(p => p.cross).length < 10) {
    const near = crossings.filter(c => { const d = Math.hypot(c.ax - pl.x, c.az - pl.z); return d > 20 && d < 150; });
    if (near.length) makeCrosser(pick(near), Math.random() < 0.5);
  }
  const stops = transitStops().filter(s => s.kind === 'bus' && Math.abs(s.x - pl.x) < 260 && Math.abs(s.z - pl.z) < 260);
  for (const p of peds) {
    if (p.state !== 'walk' || p.jog || p.dog || p.sc || p.kind === 'dance' || !p.visible || p.keep) continue;
    for (const b of benches) { if (b.taken >= 2 || Math.abs(b.x - p.x) > 4 || Math.abs(b.z - p.z) > 4) continue; if (Math.random() < 0.3) sitOn(p, b); break; }
    if (p.state !== 'walk') continue;
    for (const s of stops) { if (Math.hypot(s.x - p.x, s.z - p.z) < 12 && stops.length && peds.filter(q => q.stop === s).length < 5 && Math.random() < 0.3) { waitAt(p, s); break; } }
  }
}

// ---------- a little conversation ----------
function fmtDist(d) { return d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d / 10) * 10 + ' m'; }
async function chatWith(p, pl) {
  const ps = persona(p), T = ps.T;
  p.state = 'talk'; p.timer = 1e9; p.kind = 'walk';
  const fame = { dex: '📸 Offer a selfie with a "famous actor"', mei: '📸 Film them for your channel', brenda: '🏠 Pitch them a condo' }[pl.char?.id];
  const opts = ['👋 "How\'s it going?"', '🏙️ "What\'s it like around here?"', '🤫 "Heard any gossip?"', '❓ "Quiz me on local stuff"', '🤝 "Need a hand with anything?"', '🗺️ Ask for directions', '🍜 Ask where to eat', '💸 Ask for spare change', '😊 Compliment them', '😈 Roast them'];
  if (fame) opts.push(fame);
  opts.push('👋 Bye');
  const head = `💬 ${ps.name}, ${ps.job}${ps.zone ? ' · ' + ps.zone : ''}`;
  let text = ps.met++ ? line(['Oh hey, you again!', 'Back for more, eh?', 'We meet again!']) + ' ' + line(T.how) : moodLine(ps) + ' ' + line(T.intro);
  for (let turn = 0; turn < 8; turn++) {
    const i = await ui.dialog(head, text, opts);
    const o = opts[i] || '👋 Bye';
    if (o === '👋 Bye') { say(p, line(['Later!', 'Take care!', 'Bye! Stay dry!', 'See ya!', { t: 'Peace out, weirdo.', a: 1 }]), 2000); break; }
    if (o.startsWith('👋')) text = line(T.how) + ' ' + line(['Anyway, how about you?', '', 'You know how it is.']);
    else if (o.startsWith('🏙️')) text = about(ps.Z);
    else if (o.startsWith('🤫')) text = gossip(ps.Z);
    else if (o.startsWith('❓')) {
      const [q, ans, right, fact] = trivia(ps.Z);
      const k = await ui.dialog(head, '❓ ' + q, ans);
      if (k === right) { pl.money += 5; pl.karma += 1; sfx.coin(); text = line(['Correct! You know your stuff!', 'Yes! Local legend!', { t: 'Holy shit, you actually knew that.', a: 1 }]) + ' ' + fact + ' (+$5)'; }
      else text = line(['Nope!', 'Close, but no.', { t: 'Wrong, smartass.', a: 1 }]) + ' ' + fact;
    } else if (o.startsWith('🤝')) {
      if (favour) text = `You're already helping ${favour.by}. One good deed at a time!`;
      else { const f = offerFavour(ps, pl); if (!f) text = 'Nah, I\'m good. Thanks though!'; else { const k = await ui.dialog(head, f.text, ['Sure, I\'ll do it!', 'Sorry, can\'t right now']); if (k === 0) { startFavour(f, pl); text = line(['You\'re a lifesaver!', 'Amazing. You\'re the best.', 'Thank you! I owe you one.']); say(p, 'Thank you!!', 2000); break; } text = 'No worries!'; } }
    } else if (o.startsWith('🗺️')) {
      const list = Object.values(SPOTS).filter(s => s.name && Math.hypot(s.x - pl.x, s.z - pl.z) > 150 && Math.hypot(s.x - pl.x, s.z - pl.z) < 4000);
      const s2 = list.length ? pick(list) : null;
      if (s2) { setWaypoint(s2.x, s2.z, s2.name); text = `${s2.name}? Easy! About ${fmtDist(Math.hypot(s2.x - pl.x, s2.z - pl.z))} that way. I put it on your phone map. Don't ask how.`; }
      else text = 'Directions? Out here? Just… follow the road and hope.';
    } else if (o.startsWith('🍜')) {
      const eats = pois.filter(q => ['restaurant', 'cafe', 'fast_food', 'ice_cream'].includes(q.k) && q.name && Math.abs(q.x - pl.x) < 900 && Math.abs(q.z - pl.z) < 900).map(q => [Math.hypot(q.x - pl.x, q.z - pl.z), q]).sort((a, b) => a[0] - b[0]).slice(0, 8);
      if (eats.length) { const [d, q] = pick(eats); setWaypoint(q.x, q.z, q.name); const what = q.s ? String(q.s).split(';')[0].replace(/_/g, ' ') : q.k === 'cafe' ? 'coffee' : 'food'; text = `You HAVE to try ${q.name}. Best ${what} around here, ${fmtDist(d)} away. Marked it on your map!`; }
      else text = 'Food? Around here? There\'s a vending machine somewhere. Maybe.';
    } else if (o.startsWith('💸')) {
      if (Math.random() < (pl.karma >= 0 ? 0.4 : 0.15) && ps.mood !== 'grumpy') { const m = Math.round(R(1, 6)); pl.money += m; sfx.coin(); text = line([`Here's $${m}. Buy yourself a latte. A small one.`, `Fine, $${m}. Don't spend it all on parking.`]); }
      else text = line(['I just paid rent. I AM spare change.', 'I only have a transit card and regrets.', 'Sorry, saving for a down payment. On a parking spot.', { t: 'Spare change? In this economy? Get fucked. …Politely.', a: 1 }]);
    } else if (o.startsWith('😊')) { pl.karma += 1; text = line(T.comp) + ' ' + line(['Made my day!', '', 'You\'re sweet.']); }
    else if (o.startsWith('😈')) { pl.karma -= 1; say(p, line(T.roast), 3500); ui.toast(`💬 ${ps.name}`, line(T.roast), 3500); p.state = 'flee'; p.timer = 2; return; }
    else if (o.startsWith('📸')) { sfx.shutter?.(); pl.karma += 1; text = pl.char?.id === 'brenda' ? 'A condo? Is it bigger than a closet? …No? I\'ll think about it.' : line(['OMG! Posting this right now!', 'My mom is going to FREAK.', 'Wait, let me fix my hair. Okay go!']); }
  }
  p.state = 'talk'; p.timer = 2.5;
}
