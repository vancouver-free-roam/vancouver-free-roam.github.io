// Vancouver Free Roam: loading, character select, phone, and the main game loop.
import * as THREE from 'three';
import { G, renderer, scene, camera, updateSky, endFrameInput, tapped, key, clamp, lockMouse, toXZ, pick, updateFarCull, hemi, biasDecals } from './core.js';
let decalT = 0;   // anti-flicker sweep for decal materials (see core.js depthBias)
import { initTerrain, heightAt, cullTreeChunks, updateWater, CITY, isWater, updateChunks, prebuildChunksNear } from './terrain.js';
import { initCity, updateSigns, updateCityNight, surfaceY, roadName, nearestRoad, updateBuildingTiles } from './city.js';
import { initPeople, updatePeds, updateZombies, updateBubbles, setPlayerRef, ZONE } from './people.js';
import { updateVehicles, placeFixedVehicles, vehicles } from './vehicles.js';
import { buildLandmarks, updateLandmarks, SPOTS } from './landmarks.js';
import { initAnimals, updateAnimals, animals } from './animals.js';
import { player, initPlayer, updatePlayer, updateCamera } from './player.js';
import { CHARACTERS, MISSIONS, SIDE, SECRETS, initMissions, updateMissions, missionMarkers, startMission, state, cancelMission, activeMission } from './missions.js';
import { ui, buildMaps, drawMinimap, drawBigMap, updateHud, mapViewFor } from './ui.js';
import { initAudio, engine, sound } from './sound.js';
import { initLifts, updateLifts } from './lifts.js';
import { buildAirport, updateAirport } from './airport.js';
import { initTransit, updateTransit, transitStops, rideName, callTaxi, travelTo, rideCamera } from './transit.js';
import { initWeather, updateWeather, setWeather, TYPES as WTYPES, W as WEATHER } from './weather.js';
import { initSeasons, updateSeasons, setSeason, SEASONS, S as SEASON_STATE } from './seasons.js';
import { loadSave, writeSave, clearSave, loadSettings, saveSettings, QUALITY } from './save.js';
import { refreshMarkers } from './missions.js';
import { updateNightLights } from './streetlights.js';
import { updateStreetProps } from './streetprops.js';
import { updateWildlife } from './wildlife.js';
import { journalHtml, journalSave, journalLoad } from './journal.js';
import { updateSocial } from './social.js';
import { initStorefronts, updateStorefronts } from './storefronts.js';
import { initDetails, updateDetails, artCamera } from './details.js';
import { initQEPark, updateQEPark, qeCamera } from './qepark.js';
import { initSkyline, updateSkyline } from './skyline.js';
import { updateTreeSeason } from './treeseason.js';
import { initBeaches, updateBeaches } from './beaches.js';
import { initDistricts, updateDistricts } from './districts.js';
import { initSnowFun, updateSnowFun, snowMarkers } from './snowfun.js';
import { initSlopes, updateSlopes, slopeMarkers } from './slopes.js';
import { initPistes, updatePistes } from './pistes.js';
import { initTrails, updateTrails } from './trails.js';
import { updateWaterfront } from './waterfront.js';
import { initSkiers, updateSkiers } from './skiers.js';
import { initStreetLife, updateStreetLife } from './streetlife.js';
import { initBeachLife, updateBeachLife } from './beachlife.js';
import { initActivities, updateActivities } from './activities.js';
import { golfMarkers } from './golf.js';
import { initMinigames, updateMinigames, minigameMarkers, minigameOpen, updateMinigame, mgSave, mgLoad } from './minigames.js';
import { updateHouseDetail } from './housedetail.js';
import { updateSeaLife } from './sealife.js';
import { updateScenery } from './scenery.js';
import { initShips, updateShips } from './ships.js';
import { initBoats, updateBoats, charterMarkers, charterName } from './boats.js';
import { initAirTraffic, updateAirTraffic } from './airtraffic.js';
import { initRichmond, updateRichmond } from './richmond.js';
import { initDtes, updateDtes, dtesMarkers } from './dtes.js';
import { updateBreakables } from './breakables.js';
import { initCityLife, updateCityLife } from './citylife.js';
import { initGarage, updateGarage } from './garage.js';
import { initCityEvents, updateCityEvents, lifeTalkers } from './cityevents.js';
import { initAdverts, updateAdverts } from './adverts.js';
import { initPaint, updatePaint } from './paint.js';
import { renderWorld, updateCumulus } from './post.js';
import { initRamps, rampMarkers, setDiscover } from './moves.js';
import { discover as discoverSecret } from './missions.js';
import { initGuns, updateGuns, gunCamera, gunMarkers, gunsLoad } from './guns.js';
import { copTalkers } from './police.js';
import { initIsland, updateIsland, onIsland } from './island.js';
import { isInside, enterHome, exitHome, updateInterior, renderInterior, homeName } from './interiors.js';
import { initShops, shopMarkers, shopSave, shopLoad, OWN, OUTFITS, RIDES, PROPS, rentPerDay, callRide, goHome, wear, startGig, cancelGig, gigActive, gigText } from './shops.js';

const $ = id => document.getElementById(id);
const frame = () => new Promise(r => setTimeout(r, 20));
window.__phases = []; let __pt = performance.now();
async function progress(msg, f) { const now = performance.now(); window.__phases.push([msg.slice(0, 40), Math.round(now - __pt)]); __pt = now; $('loadmsg').textContent = msg; $('loadbar').style.width = Math.round(f * 100) + '%'; await frame(); }

// ---------- loading ----------
const TIPS = ['Tip: press Tab for your phone: missions, map, travel, world settings and help.', 'Tip: press F to get into ANY vehicle: bikes, cars, jet skis, helicopters, planes…', 'Tip: gold beams are your story missions, teal beams are side jobs.', 'Tip: on snow, press K for skis or B for a snowboard.', 'Tip: SkyTrain stations (🚆) take you all the way to the airport.', 'Tip: press U for an umbrella. You live in Vancouver now.', 'Tip: hold Shift on a bike, board or scooter to push harder. Hold Space and let go to jump.', 'Tip: in planes and helicopters, Space goes up, X goes down and Shift gives extra power.', 'Tip: your game saves automatically. Pick "Continue" next time.', 'Tip: broke? Open your phone\'s Wallet tab and do a food delivery gig.', 'Tip: buy property at Re/Maxed-Out Realty in Yaletown and collect rent every game day.'];
async function load() {
  $('tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
  loadSettings();
  const steps = [];
  const p = (m, f) => steps.push([m, f]);
  await progress('Reading the real elevation of Vancouver…', 0.03);
  initTerrain(p);
  await progress('Building 38,000 real buildings and 32,000 streets… (this takes a moment)', 0.3);
  initCity((m, f) => { steps.push([m, f]); });
  await progress('Building landmarks…', 0.82);
  buildLandmarks(); initSkyline(); initBeaches(); initDistricts(); initLifts(); initPeople(); initAnimals(); placeFixedVehicles(); buildAirport(); initTransit(); initShops(); initStorefronts(); initDetails(); initQEPark(); initSnowFun(player); initPistes(); initTrails(player); initSlopes(player); initSkiers(); initStreetLife(); initBeachLife(); initActivities(player); initMinigames(player); initIsland(); initShips(); initBoats(); initAirTraffic(); initRichmond(); initDtes(); initRamps(); setDiscover(discoverSecret); initSeasons(); initWeather(); initCityLife(player, discoverSecret); initGarage(player, discoverSecret); initPaint(player, discoverSecret); initCityEvents(discoverSecret); initAdverts(); initGuns(player);
  await progress('Drawing the maps…', 0.9);
  buildMaps();
  await progress('Ready!', 1);
  $('loading').classList.add('hidden');
  showSelect();
}

// ---------- character select ----------
function showSelect() {
  const box = $('chars'); box.innerHTML = '';
  const save = loadSave(), sc = save && CHARACTERS.find(c => c.id === save.char);
  if (sc) {
    const el = document.createElement('div'); el.className = 'char savecard';
    const ago = Math.max(1, Math.round((Date.now() - (save.savedAt || Date.now())) / 60000));
    el.innerHTML = `<div class="face">▶️ ${sc.face}</div><h3>Continue as ${sc.name.split(' ')[0]}</h3><div class="tag">Saved game · ${ago < 60 ? ago + ' min' : Math.round(ago / 60) + ' h'} ago</div><p>💵 $${Math.round(save.money)} · ✅ ${save.done.length} missions done · 🔎 ${save.found.length} secrets found</p><div class="start">Picking a different character below starts a new game.</div>`;
    el.onclick = () => start(sc, save); box.appendChild(el);
  }
  for (const c of CHARACTERS) {
    const el = document.createElement('div'); el.className = 'char';
    el.innerHTML = `<div class="face">${c.face}</div><h3>${c.name}</h3><div class="tag">${c.tag}</div><p>${c.blurb}</p><div class="start">📍 ${c.where} · 6 story missions</div>`;
    el.onclick = () => start(c); box.appendChild(el);
  }
  $('select').classList.remove('hidden');
  G.preview = true;
}
function start(c, save = null) {
  $('select').classList.add('hidden'); $('hud').classList.remove('hidden');
  initAudio(); initPlayer(c); setPlayerRef(player); initMissions(c.id);
  if (save) {
    player.money = save.money; player.karma = save.karma;
    for (const id of save.done) state.done.add(id); for (const id of save.found) state.found.add(id);
    player.stats.rode = new Set(save.rode || []);
    if (save.season) setSeason(save.season, { quiet: true, manual: !save.seasonAuto }); SEASON_STATE.auto = save.seasonAuto !== false;
    if (typeof save.hour === 'number') G.hour = save.hour;
    player.teleport(save.x, save.z); refreshMarkers();
  } else clearSave();
  shopLoad(save?.shop); gunsLoad(); mgLoad(save?.mg); journalLoad(save?.jr);
  prebuildChunksNear(player.x, player.z);
  G.preview = false; G.paused = false;
  $('who').textContent = c.face + ' ' + c.name;
  if (save) ui.toast(`Welcome back, ${c.name.split(' ')[0]}!`, 'Picking up right where you left off. Press Tab for your phone.', 4000);
  else ui.toast(`Welcome to Vancouver, ${c.name.split(' ')[0]}!`, 'Gold beams ⭐ = your story missions · teal beams 💼 = side jobs · press Tab for your phone', 6000);
  lockMouse();
}

// ---------- phone ----------
let phoneTab = 'missions';
function openPhone(tab = phoneTab) {
  phoneTab = tab; G.paused = true; document.exitPointerLock?.();
  $('phone').classList.remove('hidden');
  document.querySelectorAll('#phone .tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const body = $('pbody'); body.innerHTML = '';
  if (tab === 'missions') {
    const am = activeMission();
    if (am) body.innerHTML += `<div class="mission"><h4>▶ ${am.m.title}</h4><div class="meta">In progress</div><button id="quitm">Give up mission</button></div>`;
    const list = [...MISSIONS.filter(m => m.who === player.char.id).map(m => ({ m, kind: '⭐ Story' })), ...SIDE.map(m => ({ m, kind: '💼 Side job' }))];
    for (const { m, kind } of list) {
      const done = state.done.has(m.id), p = typeof m.start === 'function' ? m.start() : m.start;
      const d = p ? Math.round(Math.hypot(p.x - player.x, p.z - player.z)) : 0;
      body.innerHTML += `<div class="mission ${done ? 'done' : ''}"><h4>${done ? '✅' : ''} ${m.title}</h4><div class="meta">${kind} · ${d > 1000 ? (d / 1000).toFixed(1) + ' km' : d + ' m'} away</div><div>${m.desc}</div>${done ? '' : `<button data-wp="${m.id}">Set waypoint</button>`}</div>`;
    }
    body.querySelectorAll('[data-wp]').forEach(b => b.onclick = () => { const m = [...MISSIONS, ...SIDE].find(x => x.id === b.dataset.wp); const p = typeof m.start === 'function' ? m.start() : m.start; state.waypoint = { x: p.x, z: p.z, label: m.title }; closePhone(); ui.toast('📍 Waypoint set', m.title); });
    const q = $('quitm'); if (q) q.onclick = () => { cancelMission(); closePhone(); };
  } else if (tab === 'map') {
    body.innerHTML = '<p><button id="mv0">📍 Around me</button> <button id="mv1">Vancouver</button> <button id="mv2">Sea-to-Sky & Whistler</button> <button id="mv3">BC Coast & Island</button></p><p>Click the map to set a waypoint. ⭐ = story, 💼 = side jobs.</p><canvas id="bigmap" width="1000" height="975"></canvas>';
    const draw = v => { mapView = v; drawBigMap($('bigmap'), player, missionMarkers(), (x, z) => { state.waypoint = { x, z }; closePhone(); ui.toast('📍 Waypoint set', ''); }, v); };
    $('mv0').onclick = () => draw('me'); $('mv1').onclick = () => draw('van'); $('mv2').onclick = () => draw('s2s'); $('mv3').onclick = () => draw('far'); draw(mapView === 'me' ? 'me' : mapViewFor(player) === mapView ? mapView : 'me');
  } else if (tab === 'world') {
    const sb = (k, v) => `<button data-season="${k}" style="${G.season === k && !SEASON_STATE.auto ? 'outline:3px solid #fff' : ''}">${v.icon} ${v.name}</button>`;
    const wb = (k, v) => `<button data-weather="${k}" style="${WEATHER.type === k && WEATHER.locked ? 'outline:3px solid #fff' : ''}">${v.icon} ${v.name}</button>`;
    body.innerHTML = `<h4>Season</h4><p>Now: <b>${SEASONS[G.season].icon} ${SEASONS[G.season].name}</b>${SEASON_STATE.auto ? ' (changes every 2 game days)' : ''}</p><p style="display:flex;gap:6px;flex-wrap:wrap">${Object.entries(SEASONS).map(([k, v]) => sb(k, v)).join('')}<button data-season="auto" style="${SEASON_STATE.auto ? 'outline:3px solid #fff' : ''}">🔄 Auto</button></p>
      <h4>Weather</h4><p>Now: <b>${G.weatherIcon || ''} ${G.weatherName || ''}</b>${WEATHER.locked ? '' : ' (Vancouver decides)'}</p><p style="display:flex;gap:6px;flex-wrap:wrap">${Object.entries(WTYPES).map(([k, v]) => wb(k, v)).join('')}<button data-weather="auto" style="${WEATHER.locked ? '' : 'outline:3px solid #fff'}">🔄 Auto</button></p>
      <h4>Time of day</h4><p style="display:flex;gap:6px;flex-wrap:wrap"><button data-time="8">🌅 Morning</button><button data-time="12.5">☀️ Noon</button><button data-time="sunset">🌇 Sunset</button><button data-time="22.5">🌙 Night</button></p>
      <p style="opacity:.75">Spring has cherry blossoms 🌸, summer nights have fireworks over English Bay 🎆, fall has pumpkins 🎃 and Fright Nights, winter brings snow ❄️, a Christmas tree and an ice rink at Robson Square.</p>`;
    body.querySelectorAll('[data-season]').forEach(b => b.onclick = () => { const k = b.dataset.season; if (k === 'auto') SEASON_STATE.auto = true; else setSeason(k, { manual: true }); openPhone('world'); });
    body.querySelectorAll('[data-weather]').forEach(b => b.onclick = () => { const k = b.dataset.weather; if (k === 'auto') WEATHER.locked = false; else setWeather(k, { lock: true }); openPhone('world'); });
    body.querySelectorAll('[data-time]').forEach(b => b.onclick = () => { const t = b.dataset.time; G.hour = t === 'sunset' ? (G.sunRise + G.dayLen - 0.6) : +t; openPhone('world'); });
  } else if (tab === 'settings') {
    const st = G.settings;
    body.innerHTML = `<h4>Graphics quality</h4><p style="display:flex;gap:6px;flex-wrap:wrap">${Object.entries(QUALITY).map(([k, q]) => `<button data-q="${k}" style="${st.quality === k ? 'outline:3px solid #fff' : ''}">${q.name}</button>`).join('')}</p>
      <p style="opacity:.75">If the game feels slow or choppy, try Medium or Low.</p>
      <h4>Mouse</h4><p>Sensitivity: <input id="sens" type="range" min="0.3" max="2.5" step="0.1" value="${st.sens}"> <b id="sensv">${st.sens.toFixed(1)}</b></p>
      <p><label><input id="inv" type="checkbox" ${st.invertY ? 'checked' : ''}> Invert up/down</label></p>
      <p><label><input id="adult" type="checkbox" ${st.adult !== false ? 'checked' : ''}> 🤬 Grown-up humour (people sometimes swear and make cheeky jokes)</label></p>
      <h4>Other</h4><p><label><input id="fpsck" type="checkbox" ${st.fps ? 'checked' : ''}> Show frames per second (FPS)</label></p>
      <p><label><input id="snd" type="checkbox" ${sound.muted ? '' : 'checked'}> Sound on</label></p>
      <h4>Saved game</h4><p>Your game saves by itself every 20 seconds.</p><p style="display:flex;gap:6px;flex-wrap:wrap"><button id="savenow">💾 Save now</button><button id="wipe" style="background:#e53e3e;color:#fff">🗑️ Delete save &amp; start over</button></p>`;
    body.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { st.quality = b.dataset.q; saveSettings(); openPhone('settings'); });
    $('sens').oninput = e => { st.sens = +e.target.value; $('sensv').textContent = st.sens.toFixed(1); saveSettings(); };
    $('inv').onchange = e => { st.invertY = e.target.checked; saveSettings(); };
    $('adult').onchange = e => { st.adult = e.target.checked; saveSettings(); };
    $('fpsck').onchange = e => { st.fps = e.target.checked; saveSettings(); };
    $('snd').onchange = e => { sound.muted = !e.target.checked; };
    $('savenow').onclick = () => { autosave(true); };
    $('wipe').onclick = async () => { const i = await ui.dialog('Delete your saved game?', 'This erases your money, missions and secrets, and starts over from the character select screen. It can\'t be undone.', ['Yes, delete it', 'Cancel']); if (i === 0) { clearSave(); location.reload(); } };
  } else if (tab === 'travel') {
    const am = activeMission();
    body.innerHTML = '<div class="mission"><h4>🆘 Stuck? Call North Shore Rescue</h4><div>Crashed a plane on a glacier? Lost in the woods? Out of gas in Tofino? A rescue helicopter picks you up anywhere and drops you at the nearest town. Free (they are volunteers: say thank you).</div><button id="rescue">Call for rescue</button></div>' + '<div class="mission"><h4>🚕 Call a taxi</h4><div>A taxi pulls up right next to you and drives you anywhere on the real streets (about $2 per km). Set a waypoint on the Map tab to go anywhere you like.</div><button id="calltaxi">Call a taxi</button></div>' + '<p>Hop on a shuttle to jump across the map. Each trip costs <b>$25</b> and takes an hour of game time.</p>' + (am ? '<p><b>Finish or give up your mission first.</b></p>' : '') +
      TRAVEL.map((t, i) => `<div class="mission"><h4>${t[0]}</h4><button data-tr="${i}" ${am ? 'disabled' : ''}>Go ($25)</button></div>`).join('');
    $('rescue').onclick = () => {
      exitHome(); if (player.vehicle) player.exitVehicle(true); if (player.transit) return;
      let best = TRAVEL[0], bd = 1e18; for (const t of TRAVEL) { const [x, z] = toXZ(t[1], t[2]), d = Math.hypot(x - player.x, z - player.z); if (d < bd) { bd = d; best = t; } }
      const [x, z] = toXZ(best[1], best[2]); player.teleport(x, z); prebuildChunksNear(x, z); player.health = Math.max(player.health, 60); closePhone();
      ui.toast('🚁 North Shore Rescue', pick(['The crew winched you up, wrapped you in a foil blanket and dropped you at ', 'A volunteer named Gord flew you out. He said "happens every weekend". You are now at ', 'Rescued! The pilot asked you to please carry a map next time. Dropped off at ']) + best[0].replace(/^\S+ /, '') + '.', 5000);
    };
    $('calltaxi').onclick = () => { exitHome(); if (player.vehicle) player.exitVehicle(true); closePhone(); callTaxi(player); };
    body.querySelectorAll('[data-tr]').forEach(b => b.onclick = () => {
      exitHome(); const t = TRAVEL[+b.dataset.tr]; const [x, z] = toXZ(t[1], t[2]);
      if (player.vehicle) player.exitVehicle(true);
      const broke = player.money < 25; player.money = Math.max(0, player.money - 25);
      G.hour = (G.hour + 1) % 24; closePhone();
      if (!broke && travelTo(t, player)) return;   // a watchable ride (transit.js): shuttle / ferry / seaplane / helicopter
      player.teleport(x, z); prebuildChunksNear(x, z);
      ui.toast((t[3] ? t[0].split(' ')[0] + ' ' : '🚌 ') + t[0].replace(/^\S+ /, ''), t[3] && !broke ? t[3] : broke ?'You were broke, so you hitchhiked with a guy named Moonbeam.' : pick(['The shuttle driver told you about his podcast. For an hour.', 'You fell asleep and drooled on a stranger\'s Arc\'teryx.', 'Traffic on the highway was… a vibe.']), 4000);
    });
  } else if (tab === 'wallet') {
    const $m = n => '$' + Math.round(n).toLocaleString('en-CA');
    const rideName = t => t === 'bike' ? 'Your e-bike' : (RIDES.find(r => r.type === t)?.name || t);
    const gigHtml = gigActive() ? `<p>${gigText()}</p><button id="gigx">Cancel order</button>` : '<p>Deliver food around the city for cash. Be fast for a big tip. Works on foot, by bike or by car.</p><button id="gigs">📱 Start a delivery</button>';
    const rideHtml = OWN.rides.length ? '<p style="display:flex;gap:6px;flex-wrap:wrap">' + OWN.rides.map(t => `<button data-ride="${t}">Bring my ${rideName(t).split(' (')[0].replace(/^Your /, '').toLowerCase()} here</button>`).join('') + '</p>' : '<p>None yet. Buy one at Kits Motors 🚗, or an e-bike at Mountain Equipment Co-Nope 🎒.</p>';
    const homeHtml = OWN.props.length ? PROPS.filter(p => OWN.props.includes(p.id)).map(p => `<div class="mission"><h4>${p.name}</h4><div class="meta">+${$m(p.rent)} per day</div><button data-home="${p.id}">Go home (free)</button></div>`).join('') : '<p>No property yet. Re/Maxed-Out Realty 🏠 in Yaletown sells everything from a closet to a mansion.</p>';
    const wearHtml = OUTFITS.filter(o => o.id === 'orig' || OWN.outfits.includes(o.id)).map(o => `<button data-wear="${o.id}" style="${OWN.outfit === o.id ? 'outline:3px solid #fff' : ''}">${o.name}</button>`).join('');
    body.innerHTML = `<h4>💵 ${$m(player.money)}</h4><p>Rent income: <b>${$m(rentPerDay())}/day</b> (paid at midnight) · Spent so far: ${$m(OWN.spent)} · Deliveries: ${OWN.gigs}</p>
      <h4>🛵 Delivery gig</h4>${gigHtml}
      <h4>🔑 Your rides</h4>${rideHtml}
      <h4>🏠 Your places</h4>${homeHtml}
      <h4>👕 Your outfits</h4><p style="display:flex;gap:6px;flex-wrap:wrap">${wearHtml}</p>
      <h4>🛍️ Where to shop</h4><p>Every real café ☕ and restaurant 🍜 sells food: walk up and press <kbd>E</kbd> (coffee makes you run faster, food heals you). Stores on the minimap: 👖 Lululemony (Kitsilano), 🎒 Mountain Equipment Co-Nope (Broadway), 🚗 Kits Motors (Burrard St), 🏠 Re/Maxed-Out Realty (Yaletown).</p>`;
    const gs = $('gigs'); if (gs) gs.onclick = () => { if (startGig()) closePhone(); };
    const gx = $('gigx'); if (gx) gx.onclick = () => { cancelGig(); openPhone('wallet'); };
    body.querySelectorAll('[data-ride]').forEach(b => b.onclick = () => { exitHome(); if (player.vehicle) player.exitVehicle(true); if (callRide(b.dataset.ride)) { closePhone(); ui.toast('🔑 Your ride is here', 'Press F to get in.', 2500); } });
    body.querySelectorAll('[data-home]').forEach(b => b.onclick = () => { if (activeMission()) { ui.toast('Finish your mission first'); return; } exitHome(); goHome(b.dataset.home); prebuildChunksNear(player.x, player.z); closePhone(); enterHome(b.dataset.home); });
    body.querySelectorAll('[data-wear]').forEach(b => b.onclick = () => { wear(b.dataset.wear); openPhone('wallet'); });
  } else if (tab === 'nature') {   // the wildlife & plant field guide (journal.js)
    const draw = f => { body.innerHTML = journalHtml(f); body.querySelectorAll('[data-jr]').forEach(b => b.onclick = () => draw(b.dataset.jr)); }; draw('fauna');
  } else if (tab === 'eggs') {
    body.innerHTML = `<p><b>${state.found.size}/${SECRETS.length}</b> secrets found. Explore to find the rest!</p>` + SECRETS.map(([id, n, d]) => state.found.has(id) ? `<div class="egg">✅ <b>${n}</b> — ${d}</div>` : `<div class="egg">❓ ???</div>`).join('');
  } else {
    body.innerHTML = `<div class="help">
      <p><b>On foot:</b> <kbd>W A S D</kbd> move · mouse to look · <kbd>Shift</kbd> run · <kbd>Space</kbd> jump · <kbd>Click</kbd> swing hockey stick · <kbd>E</kbd> talk / interact / ride lifts · <kbd>P</kbd> take a photo (photo missions) · <kbd>B</kbd> snowboard · <kbd>K</kbd> skis · <kbd>N</kbd> throw a snowball · <kbd>V</kbd> build a snowman (on snow)</p><p>🎾 <b>Parks &amp; sports:</b> every real court, field and park is in use. Stand on one and press <kbd>E</kbd>: a card explains the controls, <kbd>Space</kbd> starts, <kbd>Esc</kbd> quits, <kbd>E</kbd> plays again. <b>Tennis / pickleball</b>: you run to the ball by yourself, press <kbd>Space</kbd> (or click) when the ring under the ball turns green; hold <kbd>A</kbd>/<kbd>D</kbd> to aim, <kbd>W</kbd> smash, <kbd>S</kbd> drop shot; first to 4 points. <b>Basketball</b>: hold <kbd>Space</kbd>, let go in the green zone, 10 shots. <b>Soccer</b>: walk on and a local passes you the ball: walk into it to dribble, <kbd>Space</kbd> near it shoots at the goal you face; or <kbd>E</kbd> for a penalty shootout (<kbd>A</kbd>/<kbd>D</kbd>/<kbd>W</kbd>/<kbd>S</kbd> aim, hold and let go <kbd>Space</kbd>). <b>Golf courses</b>: driving challenge (the power bar goes up and down: let go at the top). <b>Pitch &amp; putt</b> (Stanley Park, Queen Elizabeth Park, Rupert, Central Park…) and putting greens: 3 holes; the dotted line shows your shot and the white tick on the bar is about the right power. <b>Lawn bowling greens</b>: get your bowls closest to the white jack (they curve: <kbd>Q</kbd> switches the curve). <b>Ping-pong tables</b> in parks, <b>skateparks</b> (borrow a board). Beaches fill up on sunny summer afternoons.</p><p>🕹️ <b>Games within the game:</b> arcades (🕹️ on the minimap: Playland, Granville St, Commercial Dr, Lonsdale Quay, Metrotown, Richmond) have Seagull Invaders, Cross Granville, SkyTrain Snake, Brick Breaker and a claw machine. 🎳 Bowling alleys on Granville St and Commercial Dr. Fish off the end of any pier (🎣), busk for tips (🎸), challenge a park champion at checkers or chess (♟️), work a lunch rush at a hot-dog cart (🌭), and play darts, pool or trivia at pubs and pool halls (look for the chalkboard outside). Every game shows its controls before it starts; <kbd>Esc</kbd> leaves. Some games are hidden around the city… listen for a ringing payphone, check old typewriters, rustling bins and unattended picnics.</p><p>🎿 <b>Ski hills:</b> skis and snowboards need gear. Rent, buy, or swipe it at the 🎿 rental huts at Grouse, Cypress, Seymour, Whistler and Blackcomb, or find lost gear lying in the snow. Huts also rent 🛷 snowmobiles (Space jumps, spin and flip in the air). Each resort has a terrain park with kickers and a rail below the hut.</p>
      <p><b>Snow fun:</b> the real tube parks (🛟 on the map) at Grouse (Sliding Zone), Cypress (Hollyburn, also toboggans), Mt Seymour and Whistler Blackcomb open when there's snow. Press <kbd>E</kbd> at the booth for a tube or toboggan ($15 day pass), slide down, then <kbd>E</kbd> at the dark conveyor belt to ride the magic carpet back up. Ski and snowboard anywhere snowy, and ride the real lifts.</p>
      <p><b>Lifts &amp; gondolas:</b> walk to a lift station and press <kbd>E</kbd> to ride (Peak 2 Peak, Sea to Sky Gondola, Grouse Skyride, every Whistler chair). <kbd>Space</kbd> = fast-forward, <kbd>Space</kbd> again = skip to the end, <kbd>F</kbd> jumps off (parachute included).</p>
      <p><b>SkyTrain &amp; SeaBus:</b> walk up to a station (🚆 on the minimap) and press <kbd>E</kbd>. Pick a stop and pay $3.15 with your Compass card. Expo, Millennium and Canada lines run on the real tracks with every real station (Burnaby, New West and Richmond too). Pick ANY stop: the machine plans the changes for you (SkyTrain, SeaBus, buses, ferries). On board: <kbd>C</kbd> = camera (chase / window seat / front seat / free look), rides run at real speed: <kbd>Space</kbd> = fast-forward, <kbd>Space</kbd> again = skip to your stop (taxis, buses, ferries, Travel trips and lifts too). Ferries: the SeaBus, BC Fairies (Horseshoe Bay, Tsawwassen), the fast ferry to Nanaimo, the False Creek rainbow ferries and Victoria's pickle boats.</p>
      <p><b>Money &amp; shops:</b> press <kbd>E</kbd> at any café or restaurant for coffee (run faster) or food (heals). Buy clothes at Lululemony 👖, an e-bike or a gold snowboard at Mountain Equipment Co-Nope 🎒, cars and a helicopter at Kits Motors 🚗, and property at Re/Maxed-Out Realty 🏠 (it pays rent every game day). Earn cash with delivery gigs in the phone's <b>Wallet</b> tab.</p>
      <p><b>Your home:</b> walk up to the green 🏠 front door of a place you own and press <kbd>E</kbd> (or use <b>Go home</b> in the Wallet tab). Inside: <kbd>W A S D</kbd> to walk, <kbd>E</kbd> to use things: sleep until morning (collects rent), TV, fridge, wardrobe, trophy shelf, car keys and the speaker for a house party. Walk out the door to leave.</p>
      <p><b>Taxis:</b> walk up to any yellow taxi and press <kbd>E</kbd> to hail it (or phone → <b>Travel</b> → <b>Call a taxi</b>). Pick a place, your home or your map waypoint, pay the meter (or "forget your wallet") and the driver takes you there on the real streets at normal city speed. <kbd>Space</kbd> = fast-forward, <kbd>Space</kbd> again = skip to arrival, and <kbd>F</kbd> during the ride says "let me out here!" (you get back the unused part of the fare). (Press <kbd>F</kbd> instead if you want to steal it and drive yourself.)</p>
      <p><b>People:</b> locals notice you and wave, and they comment on your outfit, the weather or your ride (fans even recognise Dex and Mei). Walk up to anyone and press <kbd>E</kbd> to chat: ask for directions or a food tip (it goes on your map), ask for spare change, compliment them… or roast them (-1 karma). Don't run into people. And don't stand <i>too</i> close.</p>
      <p><b>Buses:</b> find a bus shelter (🚌 on the minimap) and press <kbd>E</kbd>. Routes: 99 B-Line along Broadway to UBC, R4 along 41st Ave, R5 along Hastings to SFU, R2 along Marine Drive, 5 Robson, 250 to Horseshoe Bay and 232 up to Grouse Mountain. Buses drive at real speed: <kbd>Space</kbd> = fast-forward, <kbd>Space</kbd> again = skip to your stop.</p>
      <p><b>Seasons:</b> spring 🌸, summer ☀️, fall 🍂 and winter ❄️ change every 2 game days (or pick one in the phone's <b>World</b> tab, where you can also set the weather and time of day). Winter means snow in the city and short days; summer means long days and fireworks.</p>
      <p><b>Guns:</b> Cabbagela's Outdoors + the Shoot the Breeze Range (🎯 on the map, South Vancouver) sell rifles, shotguns, paintball and tranquilliser guns (rifles/shotguns need the PAL safety course), and the range rents a pistol. <kbd>O</kbd> draw/holster · <kbd>1</kbd>-<kbd>6</kbd> pick a gun · mouse aim · click shoot · right mouse aim down sights / scope · <kbd>R</kbd> reload. Shoot targets, clays, street junk, Playland zombies, or hunt legally (licence + tag + season). Guns never work on people. A few guns are hidden around town…</p>
      <p><b>Weather:</b> Vancouver weather changes by itself: mostly sun and puffy clouds, sometimes grey skies, drizzle, rain, fog and the odd thunderstorm (rain turns to snow up the mountains). Roads get slippery in the rain. <kbd>U</kbd> opens your umbrella · <kbd>Y</kbd> = weather machine (change the weather) · watch for rainbows after the rain!</p>
      <p>🎨 <b>Street art &amp; city life:</b> press <kbd>I</kbd> facing a wall to spray-paint your own piece (draw with the mouse, stencils, tags, colours), or on open ground for sidewalk chalk. Your pieces stay in the city next time you play. Run into cones, bins, boxes and balls to kick them; press <kbd>E</kbd> to rummage in bins and dumpsters, read a newspaper box or stand up a dumped scooter. Watch for buskers, film shoots, food trucks, markets, parades and more popping up around you.</p>
      <p><b>Moves &amp; tricks:</b> hold <kbd>Shift</kbd> to run (keep running to sprint) · hold <kbd>Space</kbd> then let go for a super jump · <kbd>Space</kbd> in the air = flip (or a parachute when you're high up) · hold <kbd>Shift</kbd> when you land hard to roll · walk into a wall and hold <kbd>W</kbd> + <kbd>Space</kbd> to climb onto roofs · <kbd>X</kbd> dance · <kbd>B</kbd> skateboard (off the snow) · jump onto benches, rocks, statues, parked cars and even car or bus roofs. On bikes, scooters, skateboards, motorbikes, snowmobiles, skis and snowboards: hold <kbd>Space</kbd> to load up, let go to jump (longer hold = more air; holding Space off a ramp gives extra pop); in the air <kbd>A</kbd>/<kbd>D</kbd> spin and <kbd>W</kbd>/<kbd>S</kbd> flip. Let go of the keys and you straighten up for the landing; you only crash if you land badly sideways or upside down. Land tricks for cash (combos multiply!). Hit the 🛹 ramps in parks with any vehicle for stunt jumps.</p>
      <p><b>Downtown Eastside:</b> people living on the street here are people: talk to them (<kbd>E</kbd>), help with spare change or a coffee, and you might make a friend. If someone collapses (🆘 on the map) it may be an overdose: get a free naloxone kit from the 💙 outreach van on Hastings or any pharmacy, and press <kbd>E</kbd> by them to give it. Watch your step for needles and glass (a sharps box from the van lets you pick them up safely).</p>
      <p>🐻 <b>Wildlife &amp; plants:</b> BC's real animals live in the right places and seasons: black bears (and the odd grizzly up the Sea-to-Sky) forage, flip logs, eat berries, stand up to sniff you and sometimes bluff-charge. Don't run! Stand still, talk calmly and back away, or press <kbd>E</kbd> to shout "HEY BEAR!" (a car horn <kbd>G</kbd> works too). Look for deer, elk, moose, mountain goats, marmots that whistle, cougars at dusk, wolves, skunks (keep your distance), beavers at Lost Lagoon, ducks, owls at night, hummingbirds, sea lions, and crabs and sea stars in tide pools. In the fall the salmon run up the rivers and the bears come fishing. Plants change with the seasons: wildflowers, alpine meadows, berries (<kbd>E</kbd> to eat ripe ones), mushrooms in the fall, and some very rare finds. Walk close to add them to your phone's 📖 <b>Nature</b> field guide; <kbd>P</kbd> photographs one (a magazine buys the first photo of each species). <kbd>E</kbd> next to an animal to watch it. Please don't feed the wildlife: it's a fine.</p>
      <p><b>Sea life:</b> watch the water for orcas, humpback whales (look for the spout!), seals and bald eagles. Drive a fast boat near dolphins and see what happens. Messages in bottles float by sometimes: press <kbd>E</kbd> to fish one out.</p>
      <p><b>Vancouver Island &amp; beyond:</b> you can see Mt Baker, the Olympic Mountains and Vancouver Island from the city. Fly, boat or take the BC Fairies ferry / seaplane (phone → <b>Travel</b>) to Victoria, Nanaimo or Tofino. The phone map has a <b>BC Coast &amp; Island</b> view.</p>
      <p><b>Far away?</b> The Sea-to-Sky Highway runs from Horseshoe Bay to Squamish and Whistler (about 120 km, the real distance!). Fly a seaplane, or use the phone's <b>Travel</b> tab.</p>
      <p><b>Vehicles:</b> <kbd>F</kbd> get in / out of anything nearby (including cars parked along the curb: -1 karma) · <kbd>W</kbd>/<kbd>S</kbd> gas / reverse · <kbd>A</kbd>/<kbd>D</kbd> steer · hold <kbd>Shift</kbd> = extra effort (pedal, push or kick harder on bikes, boards and scooters; more power in anything with an engine) · <kbd>Space</kbd> brake in cars (jump on bikes and boards) · <kbd>G</kbd> horn or bell · <kbd>L</kbd> headlights (they turn on by themselves at night). Hills are real: you speed up rolling downhill and slow down going up.</p>
      <p><b>Helicopter:</b> <kbd>Space</kbd> up · <kbd>X</kbd> down · <kbd>W</kbd>/<kbd>S</kbd> forward/back · <kbd>A</kbd>/<kbd>D</kbd> turn · <kbd>Q</kbd>/<kbd>E</kbd> slide · <kbd>Shift</kbd> faster. Heliports: waterfront by Gastown, and near BC Place.</p>
      <p><b>Planes &amp; seaplanes:</b> hold <kbd>W</kbd> for throttle until you pass take-off speed (shown when you get in), then <kbd>Space</kbd> to climb · <kbd>X</kbd> dive · <kbd>A</kbd>/<kbd>D</kbd> turn · <kbd>Shift</kbd> extra power · <kbd>S</kbd> brakes on the ground. To land, just ease down: the nose levels out by itself near the ground. Only a reckless crash wrecks the plane, and a mechanic fixes it in a few seconds. Seaplanes are in Coal Harbour, Cessnas and airliners at YVR.</p>
      <p><b>Camera:</b> <kbd>C</kbd> switches view: normal, far, first-person (see through your own eyes or from the driver's seat) and bird's-eye. Mouse to look around, mouse wheel to zoom.</p>
      <p><b>Art &amp; landmarks:</b> walk up to any statue, sculpture, mural or monument and its name and story pop up by themselves. Every 10 you find earns a reward.</p>
      <p><b>Other:</b> <kbd>H</kbd> this help · <kbd>Tab</kbd> phone · <kbd>M</kbd> sound on/off · <kbd>T</kbd> skip time forward 1 hour · mouse wheel to zoom the camera</p>
      <p><b>Boats:</b> kayaks 🛶 (Deep Cove, Granville Island, Kits, Alta Lake, Horseshoe Bay), sailboats ⛵ (Kits, English Bay, Jericho, Squamish), speedboats 🚤 and luxury yachts 🛥️ (Coal Harbour, Granville Island, Horseshoe Bay). Walk or swim up and press <kbd>F</kbd>, or borrow any boat moored at a marina with <kbd>F</kbd> (-1 karma). Sailboats need the wind (fastest across it), kayaks paddle, speedboats plane over the waves; hold <kbd>Shift</kbd> to paddle harder or open the throttle. Charters ⛴️ on the map: walk up to the host and press <kbd>E</kbd> for whale watching, a sunset yacht party, a fishing trip, a dragon boat race, a water taxi and more (<kbd>Space</kbd> = fast-forward, again = skip, <kbd>F</kbd> = jump overboard). Fall in the water? Just swim with <kbd>W A S D</kbd>.</p>
      <p>Bikes are at the real bike-share stations, scooters lie around everywhere, jet skis wait at Coal Harbour, Granville Island and English Bay. Any car on the road can be "borrowed" (the owner will be politely upset).</p>
      <p>Zombies roam Playland on East Hastings (Fright Nights!). The mountains are real height data: Grouse, Seymour, Cypress and the Lions are all there. Snow up top!</p></div>`;
  }
}
function closePhone() { $('phone').classList.add('hidden'); G.paused = false; lockMouse(); }
$('pclose').onclick = closePhone;
document.querySelectorAll('#phone .tabs button').forEach(b => b.onclick = () => openPhone(b.dataset.tab));

// ---------- place names ----------
const AREAS = [
  [49.2805, -123.1000, 260, 'Chinatown'], [49.2840, -123.1075, 280, 'Gastown'], [49.2745, -123.1210, 350, 'Yaletown'], [49.2850, -123.1350, 600, 'West End'],
  [49.2905, -123.1230, 380, 'Coal Harbour'], [49.2712, -123.1342, 250, 'Granville Island'], [49.2690, -123.1600, 900, 'Kitsilano'], [49.2640, -123.1300, 800, 'Fairview'],
  [49.2635, -123.0960, 800, 'Mount Pleasant'], [49.2770, -123.0850, 700, 'Strathcona'], [49.2810, -123.0580, 900, 'East Vancouver'], [49.2823, -123.0390, 400, 'Hastings Park / Playland'],
  [49.3020, -123.1420, 1500, 'Stanley Park'], [49.2790, -123.1160, 600, 'Downtown'], [49.3200, -123.0750, 2500, 'North Vancouver'], [49.3300, -123.1600, 3000, 'West Vancouver'],
  [49.3290, -122.9490, 1500, 'Deep Cove'], [49.3170, -123.0730, 900, 'Lower Lonsdale'], [49.3260, -123.0710, 1100, 'Central Lonsdale'], [49.3260, -123.1390, 900, 'Park Royal'], [49.3270, -123.1590, 1000, 'Ambleside'], [49.3320, -123.1800, 900, 'Dundarave'], [49.3520, -123.1550, 1800, 'British Properties'], [49.3420, -123.1150, 1100, 'Capilano'], [49.3410, -123.1000, 900, 'Edgemont Village'], [49.3400, -123.0400, 1800, 'Lynn Valley'], [49.3436, -123.0193, 700, 'Lynn Canyon'], [49.3160, -123.0300, 1500, 'Lynnmour'], [49.3346, -122.9481, 500, 'Quarry Rock'], [49.3765, -123.2715, 1200, 'Horseshoe Bay'], [49.4600, -123.2400, 3000, 'Lions Bay'], [49.5578, -123.2370, 2500, 'Porteau Cove'], [49.6195, -123.2034, 2500, 'Britannia Beach'], [49.6820, -123.1400, 1500, 'Stawamus Chief'], [49.7016, -123.1558, 3000, 'Squamish'], [49.7740, -123.1500, 3000, 'Brackendale'], [49.8600, -123.1500, 8000, 'Sea-to-Sky Highway'], [49.9637, -123.1255, 3000, 'Brandywine Falls'], [50.0700, -123.0400, 3500, 'Function Junction'], [50.0870, -122.9750, 2500, 'Whistler Creekside'], [50.1160, -122.9540, 1500, 'Whistler Village'], [50.0600, -122.9500, 3500, 'Whistler Mountain'], [50.0600, -122.8900, 3500, 'Blackcomb Mountain'], [50.1100, -122.9810, 1500, 'Alta Lake'], [50.1435, -122.9500, 1800, 'Green Lake'], [49.1950, -123.1790, 2500, 'YVR Airport'], [49.1950, -123.2000, 4000, 'Sea Island'], [49.1700, -123.1300, 4500, 'Richmond'], [49.2100, -123.1300, 1800, 'Marpole'], [49.2190, -123.2160, 1500, 'Iona Beach'], [49.3800, -123.0800, 2000, 'Grouse Mountain'], [49.3670, -122.9480, 2000, 'Mount Seymour'], [49.3960, -123.2040, 2500, 'Cypress Mountain'], [49.4575, -123.1875, 2500, 'The Lions'],
  [49.2826, -123.0945, 160, 'Oppenheimer Park'], [49.2812, -123.1000, 650, 'Downtown Eastside'], [49.2811, -123.0996, 70, 'Carnegie Centre'],
  // the rest of Vancouver + Burnaby / New West
  [49.2450, -123.1010, 900, 'Riley Park'], [49.2330, -123.0950, 900, 'Sunset'], [49.2360, -123.0750, 1000, 'Kensington-Cedar Cottage'], [49.2180, -123.0700, 1100, 'Victoria-Fraserview'], [49.2200, -123.0420, 1100, 'Killarney'],
  [49.2480, -123.0450, 1100, 'Renfrew-Collingwood'], [49.2780, -123.0400, 1000, 'Hastings-Sunrise'], [49.2330, -123.1160, 900, 'Oakridge'], [49.2470, -123.1200, 800, 'South Cambie'], [49.2440, -123.1420, 1000, 'Shaughnessy'],
  [49.2340, -123.1560, 1000, 'Kerrisdale'], [49.2500, -123.1850, 1100, 'Dunbar'], [49.2630, -123.1950, 1000, 'West Point Grey'], [49.2660, -123.2480, 1600, 'UBC'], [49.2560, -123.2200, 1600, 'Pacific Spirit Park'], [49.2440, -123.1060, 600, 'Queen Elizabeth Park'],
  [49.2160, -123.1290, 900, 'Marpole'], [49.2270, -123.0030, 1100, 'Metrotown'], [49.2670, -123.0010, 1000, 'Brentwood'], [49.2800, -122.9900, 1100, 'Burnaby Heights'], [49.2780, -122.9180, 1100, 'SFU · Burnaby Mountain'], [49.2120, -122.9600, 1100, 'Edmonds'],
  [49.2050, -122.9110, 1500, 'New Westminster'], [49.1250, -123.1830, 1200, 'Steveston'], [49.1268, -123.1945, 500, 'Garry Point Park'], [49.1700, -123.1370, 900, 'Richmond City Centre'], [49.1660, -123.1380, 500, 'Richmond Centre'], [49.1650, -123.1450, 1000, 'Brighouse'], [49.1810, -123.1560, 900, 'Terra Nova'], [49.1740, -123.1600, 900, 'Thompson'], [49.1460, -123.1730, 1000, 'Seafair'], [49.1470, -123.1490, 1000, 'Broadmoor'], [49.1480, -123.1220, 1000, 'Blundell'], [49.1700, -123.1100, 900, 'Garden City'], [49.1980, -123.1180, 900, 'Bridgeport'], [49.1950, -123.1380, 500, 'Richmond Night Market'], [49.1740, -123.1510, 500, 'Richmond Olympic Oval'], [49.1700, -123.0700, 1500, 'East Richmond'], [49.1730, -123.0400, 1200, 'Hamilton'], [49.1990, -123.0880, 1200, 'Mitchell Island'], [49.2410, -122.9650, 1000, 'Deer Lake'], [49.2530, -123.0230, 900, 'Central Park'], [49.2600, -122.9600, 1000, 'Burnaby Lake'],
  // the far world
  [48.4250, -123.3650, 3500, 'Victoria'], [48.4197, -123.3707, 350, 'BC Parliament Buildings'], [48.4230, -123.3700, 500, 'Inner Harbour'], [48.4305, -123.4473, 600, 'Fisgard Lighthouse'], [48.4650, -123.4000, 6000, 'Greater Victoria'], [48.6890, -123.4100, 1500, 'Swartz Bay'], [48.80, -123.50, 9000, 'Salt Spring Island'], [48.86, -123.32, 6000, 'Galiano / Mayne Island'],
  [49.1650, -123.9400, 5000, 'Nanaimo'], [49.1935, -123.9530, 1500, 'Departure Bay'], [48.78, -123.70, 6000, 'Duncan / Cowichan'], [49.32, -124.33, 7000, 'Parksville / Qualicum'], [49.24, -124.80, 6000, 'Port Alberni'], [49.69, -124.99, 9000, 'Comox Valley'], [50.02, -125.25, 7000, 'Campbell River'], [49.6500, -125.6000, 30000, 'Strathcona Park'], [49.1530, -125.9060, 4000, 'Tofino'], [49.1180, -125.8890, 1500, 'Chesterman Beach'], [48.9420, -125.5460, 5000, 'Ucluelet'], [49.0060, -123.1330, 1500, 'Tsawwassen'],
  [49.4700, -123.7600, 6000, 'Sechelt'], [49.4000, -123.5100, 4000, 'Gibsons'], [49.38, -123.39, 4000, 'Bowen Island'], [49.1100, -122.8000, 12000, 'Surrey'], [49.2400, -122.9800, 6000, 'Burnaby'], [49.2800, -122.8000, 6000, 'Coquitlam'], [49.1000, -122.6500, 8000, 'Langley'], [49.0500, -122.3100, 9000, 'Abbotsford'], [49.1600, -122.0500, 7000, 'Chilliwack'], [48.7600, -122.4800, 8000, 'Bellingham, USA'], [48.7768, -121.8144, 6000, 'Mount Baker'], [48.8463, -121.6930, 2500, 'Artist Point'], [47.8000, -123.7100, 30000, 'Olympic Mountains, USA'], [47.8013, -123.7108, 4000, 'Mount Olympus'],
].map(([lat, lon, r, n]) => { const [x, z] = [(lon + 123.12) * 111320 * Math.cos(49.283 * Math.PI / 180), -(lat - 49.283) * 110574]; return { x, z, r, n }; });
let placeT = 0, placeStr = '';
function placeName() {
  placeT -= G.dt; if (placeT > 0) return placeStr; placeT = 0.5;
  if (player.transit) return placeStr = rideName() || charterName();
  if (isWater(player.x, player.z)) return placeStr = player.flying ? '✈️ Over the water' : player.vehicle ? '🚤 On the water' : player.y > 0.9 ? '⚓ On the dock' : '🏊 Swimming';
  let best = null, bd = 1e9; for (const a of AREAS) { const d = Math.hypot(a.x - player.x, a.z - player.z) / a.r; if (d < bd) { bd = d; best = a; } }
  const nr = !player.flying && nearestRoad(player.x, player.z, 25, r => r.n !== undefined);
  const street = nr ? roadName(nr.road) : '';
  return placeStr = (street ? street + ' · ' : '') + (best && bd < 1.6 ? best.n : onIsland(player.x, player.z) ? 'Vancouver Island' : 'British Columbia');
}

// ---------- main loop ----------
const __prof = window.__prof = {}; let __pt0 = 0; function __mark(n) { if (!window.__profOn) return; const t = performance.now(); if (n) __prof[n] = (__prof[n] || 0) + t - __pt0; __pt0 = t; }
let last = performance.now(), fps = 60, previewAng = 0, mapView = 'me', autosaveT = 20, fpsT = 0;
function autosave(manual = false) {
  if (!player.char || player.dead) return;
  const ok = writeSave({ char: player.char.id, money: player.money, karma: player.karma, done: [...state.done], found: [...state.found], rode: [...player.stats.rode], x: player.x, z: player.z, season: G.season, seasonAuto: SEASON_STATE.auto, hour: G.hour, shop: shopSave(), mg: mgSave(), jr: journalSave() });
  if (manual) ui.toast(ok ? '💾 Game saved' : '⚠️ Could not save', ok ? '' : 'Your browser blocked saving (private window?)', 1800);
}
addEventListener('beforeunload', () => autosave());
const TRAVEL = [['🏙️ Downtown (Canada Place)', 49.2875, -123.1125], ['🚠 Grouse Mountain base', 49.3712, -123.0985], ['🍩 Deep Cove', 49.3285, -122.9485], ['🏂 Cypress Mountain', 49.3960, -123.2040], ['⛴️ Horseshoe Bay', 49.3765, -123.2715], ['🧗 Squamish (Stawamus Chief)', 49.6775, -123.1550], ['⛷️ Whistler Village', 50.1160, -122.9540], ['🏔️ Whistler Roundhouse (top of the gondola)', 50.0645, -122.9475], ['✈️ YVR Airport (South Terminal planes)', 49.1874, -123.1715], ['🛫 YVR Airport (main terminal)', 49.1952, -123.1770],
  ['⛴️ Ferry to Victoria (Swartz Bay)', 48.6870, -123.4060, 'The BC Fairies ferry through Active Pass. You saw a seal, ate a Sunshine Breakfast and lost your car keys.'],
  ['⛴️ Ferry to Nanaimo (Departure Bay)', 49.1925, -123.9590, 'The BC Fairies ferry from Horseshoe Bay. Someone’s dog barked at the ocean for 95 minutes.'],
  ['🛩️ Harbour Err seaplane to downtown Victoria', 48.4213, -123.3690, 'A wobbly 35 minutes in a floatplane. You land right in the Inner Harbour, by the Parliament Buildings.'],
  ['🏄 Tofino (Chesterman Beach)', 49.1183, -125.8885, 'Five hours of twisty highway. Tofino: surf, rain, and a very good taco truck.'],
  ['🌋 Mt Baker (Artist Point)', 48.8463, -121.6930, 'You crossed the border (the guard asked about your fruit) and drove up to the snowy volcano.']];
function loop(now, manual) {
  if (manual !== true) requestAnimationFrame(loop);
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = Math.max(last, now); G.dt = dt; fps = fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05;
  if (G.preview) {
    previewAng += dt * 0.03; G.hour = 15.5;
    camera.position.set(-600 + Math.cos(previewAng) * 2400, 650, -1200 + Math.sin(previewAng) * 2400); camera.lookAt(0, 80, -900);
    updateSky(camera.position.clone().setY(0)); updateWater(dt); updateLandmarks(dt); cullTreeChunks(camera.position.x, camera.position.z); updateChunks(camera.position.x, camera.position.z); updateBuildingTiles(-600, -1200, 8);
    renderer.render(scene, camera); endFrameInput(); return;
  }
  if (!player.model) { endFrameInput(); return; }
  if (minigameOpen()) { updateMinigame(dt); updateHud(player, placeName()); endFrameInput(); return; }   // a game within the game: the world waits
  if (tapped('Tab')) { if ($('phone').classList.contains('hidden')) openPhone(); else closePhone(); }
  if (tapped('KeyH') && $('phone').classList.contains('hidden')) openPhone('help');
  fpsT -= dt; if (fpsT < 0) { fpsT = 0.5; if (G.settings?.fps) $('fps').textContent = Math.round(fps) + ' FPS'; }
  if (tapped('KeyM')) { sound.muted = !sound.muted; ui.toast(sound.muted ? '🔇 Sound off' : '🔊 Sound on'); }
  if (tapped('KeyT')) { G.hour = (G.hour + 1) % 24; ui.toast('⏩ ' + Math.floor(G.hour) + ':00'); }
  if (tapped('Escape') && !$('phone').classList.contains('hidden')) closePhone();
  if (isInside()) {   // inside your own home: a separate little scene
    if (!G.paused && !G.dialogOpen) { G.t += dt; G.hour = (G.hour + dt / 60) % 24; autosaveT -= dt; if (autosaveT < 0) { autosaveT = 20; autosave(); } updateInterior(dt); }
    $('mapwrap').style.visibility = 'hidden';
    renderInterior(); updateHud(player, homeName()); endFrameInput(); return;
  }
  $('mapwrap').style.visibility = '';
  __mark(null);
  if (!G.paused && !G.dialogOpen) {
    G.t += dt; G.hour = (G.hour + dt / 60) % 24;   // 1 real minute = 1 game hour
    autosaveT -= dt; if (autosaveT < 0) { autosaveT = 20; autosave(); }
    updateLifts(dt, player, ui); updateAirport(dt); updateTransit(dt, player); updateWeather(dt, player); updateSeasons(dt, player);
  __mark('updateLifts(dt, player');
    updatePlayer(dt);
  __mark('updatePlayer(dt);');
    updateVehicles(dt, player);
  __mark('updateVehicles(dt, pla');
    updateNightLights(player);
  __mark('updateNightLights(play');
    updateStorefronts(player);
  __mark('updateStorefronts(play');
    updateDetails(player); updateQEPark(dt, player); updateSkyline(dt, player); updateTreeSeason(dt, player); updateBeaches(dt, player); updateDistricts(dt, player);
  __mark('updateDetails(player);');
    updateSnowFun(dt, player); updateSlopes(dt, player); updatePistes(dt, player); updateTrails(dt, player); updateWaterfront(dt, player); updateSkiers(dt, player); updateStreetLife(player.x, player.z); updateBeachLife(dt, player); updateActivities(dt, player); updateMinigames(dt, player); updateHouseDetail(player.x, player.z);
  __mark('updateSnowFun(dt, play');
    updateSeaLife(dt, player); updateIsland(dt, player); updateScenery(dt, player); updateShips(dt, player); updateBoats(dt, player); updateAirTraffic(dt, player); updateRichmond(dt, player); updateDtes(dt, player); updateBreakables(dt, player); updateCumulus(dt);
  __mark('updateSeaLife(dt, play');
    updateCityLife(dt, player); updateGarage(dt); updatePaint(dt, player); updateCityEvents(dt, player); updateAdverts(dt, player);   // city life: clutter, events, ads
  __mark('cityLife');
  __mark('updateSeaLife(dt, play');
    updateStreetProps(player);
  __mark('updateStreetProps(play');
    updatePeds(dt, player.x, player.z, player.y);
  __mark('updatePeds(dt, player.');
    player.inZombieZone = Math.hypot(player.x - ZONE.x, player.z - ZONE.z) < ZONE.r + 200;
  __mark('player.inZombieZone = ');
    updateZombies(dt, player);
  __mark('updateZombies(dt, play');
    updateAnimals(dt, player);
  __mark('updateAnimals(dt, play');
    updateWildlife(dt, player);
    updateGuns(dt, player);   // guns: aiming, shooting, range, hunting
  __mark('updateWildlife(dt, pla');
    updateLandmarks(dt);
  __mark('updateLandmarks(dt);');
    updateMissions(dt);
  __mark('updateMissions(dt);');
    updateSocial(dt, player);
  __mark('updateSocial(dt, playe');
  }
  updateCamera(dt); artCamera(camera, dt); rideCamera(camera, dt); qeCamera(camera, dt); gunCamera(camera, dt);
  __mark('updateCamera(dt);');
  updateSky(player); updateCityNight(); updateWater(dt); updateBuildingTiles(player.x, player.z);
  __mark('updateSky(player); upd');
  cullTreeChunks(player.x, player.z); updateChunks(player.x, player.z); updateFarCull(player.x, player.z);
  __mark('cullTreeChunks(player.');
  updateSigns(player.x, player.z, dt);
  __mark('updateSigns(player.x, ');
  updateBubbles(animals.filter(a => a.say).concat(lifeTalkers(), copTalkers()));
  __mark('updateBubbles(animals.');
  updateHud(player, placeName());
  __mark('updateHud(player, plac');
  drawMinimap(player, missionMarkers().concat(shopMarkers(), gunMarkers(), minigameMarkers(), golfMarkers(), charterMarkers(), snowMarkers(), ...slopeMarkers(), dtesMarkers(), rampMarkers().filter(r => Math.hypot(r.x - player.x, r.z - player.z) < 900), transitStops().map(s => ({ x: s.x, z: s.z, icon: s.kind === 'boat' ? '⛴️' : s.kind === 'bus' ? '🚌' : '🚆' })), vehicles.filter(v => v.keep && !v.driver && ['heli', 'seaplane', 'jetski', 'kayak', 'sailboat', 'speedboat', 'yacht'].includes(v.type)).map(v => ({ x: v.x, z: v.z, icon: { heli: '🚁', seaplane: '🛩️', kayak: '🛶', sailboat: '⛵', yacht: '🛥️' }[v.type] || '🚤' }))));
  __mark('drawMinimap(player, mi');
  window.__camHold?.();   // test hook: a still camera for screenshots
  G.camHigh = camera.position.y - heightAt(camera.position.x, camera.position.z);
  // under the forest canopy the sky light is blocked: the forest is darker and moodier inside (G.gloom eases in terrain.js)
  hemi.intensity *= 1 - 0.6 * (G.gloom || 0) * Math.max(0, 1 - G.camHigh / 45);
  decalT -= dt; if (decalT <= 0) { decalT = 1.5; biasDecals(scene); }
  renderWorld();
  __mark('renderer.render(scene,');
  endFrameInput();
}
requestAnimationFrame(loop);
// testing helper: advance the game n frames even if the tab is in the background
window.__game = { player, G, vehicles, SPOTS, tick(n = 1) { for (let i = 0; i < n; i++) { last -= 33; loop(performance.now(), true); } } };
load().catch(e => { console.error(e); $('loadmsg').textContent = 'Oops, something broke while loading: ' + e.message; });
