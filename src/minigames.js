// Games within the game: arcade cabinets, a claw machine, pier fishing, busking, pub darts + trivia, park checkers,
// a hot-dog-cart rush, and hidden easter-egg games (a ringing payphone riddle hunt, a troll under the Burrard Bridge,
// a secret basement arcade). Each canvas game runs in a full-screen overlay while the world is frozen.
import * as THREE from 'three';
import { G, scene, std, addMesh, toXZ, key, tapped, pick, lockMouse, canvasTex } from './core.js';
import { isWater, waterLevel, groundY } from './terrain.js';
import { walkY, surfaceY, buildingAt, pois } from './city.js';
import { SPOTS } from './landmarks.js';
import { makeHuman } from './people.js';
import { activeMission, discover, state as mstate } from './missions.js';
import { ui } from './ui.js';
import { sfx, beep, noise } from './sound.js';

let pl = null;
const W = 480, H = 360;
// saved progress: best scores, plays, plush toys, fish caught, riddle hunt step
export const MG = { best: {}, plays: {}, plush: [], fish: {}, hunt: 0, huntT: 0 };
export const mgSave = () => JSON.parse(JSON.stringify(MG));
export function mgLoad(s) { MG.best = {}; MG.plays = {}; MG.plush = []; MG.fish = {}; MG.hunt = 0; MG.huntT = 0; if (s) Object.assign(MG, JSON.parse(JSON.stringify(s))); }
const pay = (n, why) => { if (n > 0) { pl.money += n; sfx.coin(); } return n; };
const money = n => '$' + Math.round(n);

// ---------- overlay ----------
let ov, cv, cx, elT, elS, elH, run = null;
function buildOverlay() {
  const st = document.createElement('style');
  st.textContent = `#mgov{position:fixed;inset:0;z-index:60;background:radial-gradient(#1a1030ee,#05030aee);display:flex;align-items:center;justify-content:center;font-family:Segoe UI,Arial,sans-serif}
#mgov.hidden{display:none}#mgbox{background:#111;border:4px solid #444;border-radius:18px;padding:12px 14px 10px;box-shadow:0 0 40px #b04aff66,inset 0 0 20px #000;color:#eee;max-width:96vw}
#mghead{display:flex;justify-content:space-between;align-items:baseline;gap:20px;margin-bottom:6px;font-size:18px}#mghead b{color:#ffd45c;letter-spacing:1px}
#mgc{display:block;width:min(88vw,calc((100vh - 150px)*1.333));height:auto;image-rendering:pixelated;border-radius:8px;background:#000}
#mghelp{font-size:13px;opacity:.8;margin-top:6px;text-align:center}#mghelp kbd{background:#333;border:1px solid #666;border-radius:4px;padding:0 5px}`;
  document.head.appendChild(st);
  ov = document.createElement('div'); ov.id = 'mgov'; ov.className = 'hidden';
  ov.innerHTML = '<div id="mgbox"><div id="mghead"><b id="mgt"></b><span id="mgs"></span></div><canvas id="mgc" width="480" height="360"></canvas><div id="mghelp"></div></div>';
  document.body.appendChild(ov);
  cv = ov.querySelector('#mgc'); cx = cv.getContext('2d'); elT = ov.querySelector('#mgt'); elS = ov.querySelector('#mgs'); elH = ov.querySelector('#mghelp');
}
export const minigameOpen = () => !!run;
export function openGame(id, opts = {}) {
  const def = GAMES[id]; if (!def || run) return false;
  if (opts.cost && pl.money < opts.cost) { sfx.fail(); ui.toast('🪙 No loonies left', `You need ${money(opts.cost)} to play.`, 2200); return false; }
  if (opts.cost) pl.money -= opts.cost;
  run = { id, def, opts, S: fresh(def, opts), done: false };
  MG.plays[id] = (MG.plays[id] || 0) + 1;
  elT.textContent = (opts.title || def.title).toUpperCase(); elH.innerHTML = def.help + ' · <kbd>Esc</kbd> leave';
  ov.classList.remove('hidden'); document.exitPointerLock?.(); ui.prompt('');
  if (def.arcade) discover('arcade');
  return true;
}
function fresh(def, opts) { const S = { score: 0, t: 0, over: false, msg: '', fx: [], opts }; def.init(S); return S; }
export function closeGame() { if (!run) return; if (!run.done && run.def.quit) run.def.quit(run.S); run = null; ov.classList.add('hidden'); G.keys = {}; lockMouse(); }
export function updateMinigame(dt) {
  if (!run) return;
  const { def, S } = run;
  if (tapped('Escape')) { if (!S.over && def.leaveEnds) { S.over = true; finish(); } closeGame(); return; }
  if (!S.over) { S.t += dt; def.step(S, dt); if (S.over) finish(); }
  else if (tapped('Space') || tapped('Enter')) {   // play again
    if (def.once) { closeGame(); return; }
    const c = run.opts.cost || 0; if (c && pl.money < c) { ui.toast('🪙 Out of money', '', 1500); closeGame(); return; }
    pl.money -= c; run.S = fresh(def, run.opts); run.done = false; MG.plays[run.id]++;
  }
  if (!run) return;
  cx.save(); def.draw(run.S, cx); cx.restore();
  for (const f of run.S.fx) { f.t -= dt; cx.globalAlpha = Math.max(0, Math.min(1, f.t * 2)); cx.fillStyle = f.c || '#fff'; cx.font = 'bold 16px Segoe UI, sans-serif'; cx.textAlign = 'center'; cx.fillText(f.s, f.x, f.y - (1 - f.t) * 20); cx.globalAlpha = 1; }
  run.S.fx = run.S.fx.filter(f => f.t > 0);
  if (run.S.over) {
    cx.fillStyle = '#000b'; cx.fillRect(40, 110, 400, 140); cx.strokeStyle = '#ffd45c'; cx.lineWidth = 3; cx.strokeRect(40, 110, 400, 140);
    cx.fillStyle = '#ffd45c'; cx.textAlign = 'center'; cx.font = 'bold 26px Segoe UI, sans-serif'; cx.fillText(run.S.title || 'GAME OVER', 240, 148);
    cx.fillStyle = '#fff'; cx.font = '16px Segoe UI, sans-serif'; wrapText(cx, run.S.msg || `Score ${run.S.score}`, 240, 178, 380, 20);
    cx.fillStyle = '#9ae6b4'; cx.font = '14px Segoe UI, sans-serif'; cx.fillText(def.once ? 'Space / Esc = back to the city' : `Space = play again${run.opts.cost ? ' (' + money(run.opts.cost) + ')' : ''} · Esc = leave`, 240, 238);
  }
  elS.textContent = (def.hud ? def.hud(run.S) : 'Score ' + run.S.score) + (MG.best[run.id] ? ' · Best ' + MG.best[run.id] : '') + ' · 💵 ' + money(pl.money);
}
function finish() {
  run.done = true; const { def, S, id } = run;
  const val = def.best ? def.best(S) : S.score;
  const rec = val > (MG.best[id] || 0) && val > 0; if (rec) MG.best[id] = val;
  const got = def.end ? def.end(S) : 0;
  if (rec && !S.msg.includes('record')) S.msg += ' · New personal best!';
  if (got > 0) S.msg += ` (+${money(got)})`;
}
function wrapText(c, s, x, y, w, lh) { const words = s.split(' '); let line = ''; for (const wd of words) { const t = line ? line + ' ' + wd : wd; if (c.measureText(t).width > w && line) { c.fillText(line, x, y); line = wd; y += lh; } else line = t; } c.fillText(line, x, y); }
const fx = (S, s, x, y, c) => S.fx.push({ s, x, y, c, t: 1 });
const L = () => key('ArrowLeft') || key('KeyA'), Rt = () => key('ArrowRight') || key('KeyD'), Up = () => key('ArrowUp') || key('KeyW'), Dn = () => key('ArrowDown') || key('KeyS');
const tL = () => tapped('ArrowLeft') || tapped('KeyA'), tR = () => tapped('ArrowRight') || tapped('KeyD'), tU = () => tapped('ArrowUp') || tapped('KeyW'), tD = () => tapped('ArrowDown') || tapped('KeyS');
const sky = (c, a, b) => { const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, a); g.addColorStop(1, b); c.fillStyle = g; c.fillRect(0, 0, W, H); };
const emo = (c, e, x, y, s = 24) => { c.font = s + 'px Segoe UI Emoji, Apple Color Emoji, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(e, x, y); c.textBaseline = 'alphabetic'; };
const txt = (c, s, x, y, col = '#fff', size = 14, al = 'left') => { c.fillStyle = col; c.font = `bold ${size}px Segoe UI, sans-serif`; c.textAlign = al; c.fillText(s, x, y); };
const cashFor = (score, per, cap) => Math.min(cap, Math.floor(score / per));
function gull(c, x, y, t, s = 1, col = '#f4f4f4') {
  const f = Math.sin(t * 10 + x) * 5 * s;
  c.strokeStyle = col; c.lineWidth = 3 * s; c.beginPath(); c.moveTo(x - 14 * s, y - f); c.quadraticCurveTo(x - 6 * s, y - 6 * s, x, y); c.quadraticCurveTo(x + 6 * s, y - 6 * s, x + 14 * s, y - f); c.stroke();
  c.fillStyle = col; c.beginPath(); c.ellipse(x, y + 1, 5 * s, 3 * s, 0, 0, 6.3); c.fill(); c.fillStyle = '#f6ad1a'; c.fillRect(x + 4 * s, y, 3 * s, 1.5 * s);
}

// ================= 1. Seagull Invaders =================
const invaders = {
  title: '🕊️ Seagull Invaders', arcade: true, help: '<kbd>A</kbd>/<kbd>D</kbd> move · <kbd>Space</kbd> squirt ketchup · protect your fries!',
  init(S) { S.px = W / 2; S.shots = []; S.bombs = []; S.lives = 3; S.wave = 0; S.ufo = null; S.hurt = 0; this.wave(S); },
  wave(S) { S.wave++; S.gulls = []; for (let r = 0; r < 4; r++) for (let c = 0; c < 9; c++) S.gulls.push({ x: 60 + c * 42, y: 50 + r * 30, r, a: true }); S.dir = 1; S.spd = 22 + S.wave * 9; if (S.wave === 2) discover('gullinvaders'); },
  step(S, dt) {
    if (L()) S.px -= 240 * dt; if (Rt()) S.px += 240 * dt; S.px = Math.max(20, Math.min(W - 20, S.px)); S.hurt -= dt;
    if (tapped('Space') && S.shots.length < 2) { S.shots.push({ x: S.px, y: H - 44 }); beep([880], 0.05, 'square', 0.03); }
    for (const s of S.shots) s.y -= 380 * dt; S.shots = S.shots.filter(s => s.y > 0);
    const alive = S.gulls.filter(g => g.a); let edge = false; const sp = S.spd * (1 + (36 - alive.length) / 18);
    for (const g of alive) { g.x += S.dir * sp * dt; if (g.x < 18 || g.x > W - 18) edge = true; }
    if (edge) { S.dir *= -1; for (const g of alive) { g.y += 12; g.x += S.dir * 4; } }
    if (alive.length && Math.random() < dt * (0.7 + S.wave * 0.3)) { const g = pick(alive); S.bombs.push({ x: g.x, y: g.y + 6 }); }
    for (const b of S.bombs) b.y += (140 + S.wave * 12) * dt;
    S.bombs = S.bombs.filter(b => { if (b.y > H - 50 && b.y < H - 22 && Math.abs(b.x - S.px) < 18) { if (S.hurt <= 0) { S.lives--; S.hurt = 1; noise(0.3, 0.1, 500); fx(S, pick(['SPLAT!', 'Ew!', 'Right on the fries!']), S.px, H - 60, '#fff'); } return false; } return b.y < H; });
    for (const s of S.shots) for (const g of alive) if (g.a && Math.abs(s.x - g.x) < 16 && Math.abs(s.y - g.y) < 11) { g.a = false; s.y = -99; const p = 10 * (4 - g.r) + 10; S.score += p; beep([300], 0.06, 'sawtooth', 0.03); fx(S, 'SQUAWK +' + p, g.x, g.y, '#ffd45c'); }
    if (!S.ufo && Math.random() < dt * 0.06) S.ufo = { x: -30, gold: Math.random() < 0.25 };
    if (S.ufo) { S.ufo.x += 110 * dt; for (const s of S.shots) if (Math.abs(s.x - S.ufo.x) < 20 && s.y < 34) { const p = S.ufo.gold ? 500 : 150; S.score += p; fx(S, (S.ufo.gold ? 'GOLDEN EAGLE! +' : 'EAGLE +') + p, S.ufo.x, 40, '#ffd45c'); sfx.chime(); S.ufo = null; s.y = -99; break; } if (S.ufo && S.ufo.x > W + 30) S.ufo = null; }
    if (!alive.length) { S.score += 100; fx(S, 'WAVE CLEAR +100', W / 2, H / 2, '#9ae6b4'); this.wave(S); }
    if (S.lives <= 0 || alive.some(g => g.y > H - 60)) { S.over = true; S.title = 'THE GULLS GOT YOUR FRIES'; S.msg = `Wave ${S.wave}, score ${S.score}.`; }
  },
  draw(S, c) {
    sky(c, '#1a2a6c', '#fdbb2d'); c.fillStyle = '#2c5d7c'; c.fillRect(0, H - 20, W, 20);
    c.fillStyle = '#ffffff22'; for (let i = 0; i < 5; i++) c.fillRect(((S.t * 20 + i * 110) % (W + 60)) - 60, 70 + i * 40, 60, 4);
    for (const g of S.gulls) if (g.a) gull(c, g.x, g.y, S.t, 1.1, g.r === 0 ? '#ddd' : '#fafafa');
    if (S.ufo) emo(c, '🦅', S.ufo.x, 24, 26), S.ufo.gold && (c.fillStyle = '#ffd45c66', c.beginPath(), c.arc(S.ufo.x, 24, 18, 0, 6.3), c.fill());
    c.fillStyle = '#fff'; for (const b of S.bombs) { c.beginPath(); c.arc(b.x, b.y, 4, 0, 6.3); c.fill(); }
    c.fillStyle = '#e53e3e'; for (const s of S.shots) c.fillRect(s.x - 2, s.y - 8, 4, 10);
    if (S.hurt > 0 && Math.floor(S.t * 12) % 2) return;
    c.fillStyle = '#f6e05e'; for (let i = -3; i <= 3; i++) c.fillRect(S.px + i * 4 - 1, H - 46 - (i % 2 ? 4 : 0), 3, 14);
    c.fillStyle = '#e53e3e'; c.beginPath(); c.moveTo(S.px - 16, H - 36); c.lineTo(S.px + 16, H - 36); c.lineTo(S.px + 12, H - 22); c.lineTo(S.px - 12, H - 22); c.fill();
  },
  hud: S => `Score ${S.score} · Wave ${S.wave} · 🍟×${S.lives}`,
  end: S => pay(cashFor(S.score, 150, 20)),
};

// ================= 2. Cross Granville (hop across the street and the creek) =================
const CG = 40;
const frogger = {
  title: '🚦 Cross Granville', arcade: true, help: '<kbd>W A S D</kbd> / arrows hop · cross the traffic, ride the Aquabus ferries, reach a dock',
  init(S) { S.lives = 3; S.lvl = 1; S.homes = [false, false, false, false, false]; this.lanes(S); this.reset(S); S.goose = null; },
  lanes(S) {
    const k = 1 + (S.lvl - 1) * 0.25;
    S.lanes = [
      null,
      { y: 1, water: true, v: 50 * k, len: 3, gap: 170, col: '#2b6cb0' }, { y: 2, water: true, v: -70 * k, len: 2, gap: 150, col: '#38a169' }, { y: 3, water: true, v: 40 * k, len: 4, gap: 200, col: '#2b6cb0' },
      null,
      { y: 5, v: -110 * k, len: 1, gap: 160, emo: ['🚗', '🚕', '🚙'] }, { y: 6, v: 70 * k, len: 2, gap: 230, emo: ['🚌'] }, { y: 7, v: -160 * k, len: 1, gap: 200, emo: ['🛴', '🏍️'] },
    ];
    for (const l of S.lanes) if (l) { l.items = []; for (let x = 0; x < W + 200; x += l.gap + Math.random() * 60) l.items.push({ x, e: l.emo ? pick(l.emo) : null }); }
  },
  reset(S) { S.fx_ = 6 * CG - CG / 2 + 20; S.fr = 8; S.maxRow = 8; S.timer = 30; S.dead = 0; },
  die(S, why) { if (S.dead > 0) return; S.dead = 1; S.lives--; noise(0.3, 0.12, 400); fx(S, why, S.fx_, S.fr * CG, '#fff'); },
  step(S, dt) {
    for (const l of S.lanes) if (l) for (const it of l.items) { it.x += l.v * dt; const span = l.items.length * 0 + W + 220; if (l.v > 0 && it.x > W + 60) it.x -= span; if (l.v < 0 && it.x < -l.len * CG - 60) it.x += span; }
    if (S.goose) { S.goose.x += S.goose.v * dt; if (S.goose.x > W + 30 || S.goose.x < -30) S.goose = null; } else if (Math.random() < dt * 0.05) S.goose = Math.random() < 0.5 ? { x: -20, v: 45 } : { x: W + 20, v: -45 };
    if (S.dead > 0) { S.dead -= dt; if (S.dead <= 0) { if (S.lives <= 0) { S.over = true; S.title = 'SPLAT'; S.msg = `Level ${S.lvl}, score ${S.score}. Look both ways!`; } else this.reset(S); } return; }
    S.timer -= dt; if (S.timer <= 0) this.die(S, 'Too slow!');
    if (tU()) S.fr--; else if (tD() && S.fr < 8) S.fr++; else if (tL()) S.fx_ -= CG; else if (tR()) S.fx_ += CG;
    if (tU() || tD() || tL() || tR()) beep([520], 0.04, 'square', 0.02);
    S.fx_ = Math.max(20, Math.min(W - 20, S.fx_));
    if (S.fr < S.maxRow) { S.maxRow = S.fr; S.score += 10; }
    const l = S.lanes[S.fr];
    if (S.fr === 0) {
      const hx = [48, 144, 240, 336, 432], i = hx.findIndex(h => Math.abs(h - S.fx_) < 22);
      if (i < 0 || S.homes[i]) { this.die(S, 'Bonk! Seawall.'); return; }
      S.homes[i] = true; S.score += 100 + Math.ceil(S.timer) * 5; sfx.coin(); fx(S, 'DOCKED!', hx[i], 30, '#9ae6b4');
      if (S.homes.every(Boolean)) { S.lvl++; S.score += 500; S.homes = S.homes.map(() => false); this.lanes(S); fx(S, 'LEVEL ' + S.lvl + '!', W / 2, H / 2, '#ffd45c'); sfx.chime(); if (S.lvl === 2) discover('crossgranville'); }
      this.reset(S); return;
    }
    if (l) {
      const on = l.items.find(it => S.fx_ > it.x - 6 && S.fx_ < it.x + l.len * CG + 6);
      if (l.water) { if (!on) this.die(S, 'Sploosh! False Creek.'); else { S.fx_ += l.v * dt; if (S.fx_ < 4 || S.fx_ > W - 4) this.die(S, 'Swept away!'); } }
      else { const hit = l.items.find(it => S.fx_ > it.x - 4 && S.fx_ < it.x + l.len * CG + 4 - 10); if (hit) this.die(S, pick(['HONK!', 'Flattened!', 'They didn\'t even signal.'])); }
    }
    if (S.fr === 4 && S.goose && Math.abs(S.goose.x - S.fx_) < 22) { S.fr = 5; S.maxRow = 5; beep([330, 300], 0.15, 'sawtooth', 0.05, 0.12); fx(S, 'HONK! The goose wins.', S.fx_, 4 * CG, '#fff'); S.goose.v *= -1; }
  },
  draw(S, c) {
    c.fillStyle = '#2f855a'; c.fillRect(0, 0, W, CG);
    [48, 144, 240, 336, 432].forEach((x, i) => { c.fillStyle = '#5a3e1b'; c.fillRect(x - 22, 4, 44, 34); if (S.homes[i]) emo(c, '🙋', x, 22, 24); });
    c.fillStyle = '#2c6e8f'; c.fillRect(0, CG, W, CG * 3); c.fillStyle = '#ffffff18'; for (let i = 0; i < 12; i++) c.fillRect((i * 53 + S.t * 15) % W, CG + 10 + (i % 3) * CG, 24, 3);
    c.fillStyle = '#a0aec0'; c.fillRect(0, CG * 4, W, CG); c.fillRect(0, CG * 8, W, CG);
    c.fillStyle = '#2d3748'; c.fillRect(0, CG * 5, W, CG * 3); c.fillStyle = '#f6e05e'; for (let x = 0; x < W; x += 40) { c.fillRect(x, CG * 6 - 1, 20, 2); c.fillRect(x, CG * 7 - 1, 20, 2); }
    txt(c, 'GRANVILLE ISLAND', W / 2, 26, '#fff8', 12, 'center'); txt(c, 'GRANVILLE ST', W - 8, CG * 8 + 26, '#2d374888', 12, 'right');
    for (const l of S.lanes) if (l) for (const it of l.items) {
      if (l.water) { c.fillStyle = l.col; c.fillRect(it.x, l.y * CG + 8, l.len * CG, CG - 16); c.fillStyle = '#fff'; c.fillRect(it.x + 6, l.y * CG + 12, l.len * CG - 12, 6); txt(c, 'AQUABUS', it.x + l.len * CG / 2, l.y * CG + 30, '#fff', 9, 'center'); }
      else { c.save(); if (l.v > 0) { c.translate(it.x + l.len * CG / 2, l.y * CG + CG / 2); c.scale(-1, 1); emo(c, it.e, 0, 0, l.len > 1 ? 40 : 30); } else emo(c, it.e, it.x + l.len * CG / 2, l.y * CG + CG / 2, l.len > 1 ? 40 : 30); c.restore(); }
    }
    if (S.goose) emo(c, '🪿', S.goose.x, CG * 4 + 20, 26);
    if (!(S.dead > 0 && Math.floor(S.t * 10) % 2)) emo(c, S.dead > 0 ? '💥' : '🚶', S.fx_, S.fr * CG + CG / 2, 28);
    c.fillStyle = S.timer < 8 ? '#e53e3e' : '#9ae6b4'; c.fillRect(0, H - 4, W * Math.max(0, S.timer) / 30, 4);
  },
  hud: S => `Score ${S.score} · Level ${S.lvl} · Lives ${S.lives}`,
  end: S => pay(cashFor(S.score, 150, 20)),
};

// ================= 3. SkyTrain Snake =================
const SG = 20, SC = 24, SR = 18;
const snake = {
  title: '🚆 SkyTrain Snake', arcade: true, help: 'Arrows / <kbd>W A S D</kbd> steer · pick up passengers 🧍 to add cars · don\'t hit the walls or yourself',
  init(S) { S.b = [[8, 9], [7, 9], [6, 9]]; S.d = [1, 0]; S.nd = [1, 0]; S.acc = 0; S.rate = 7; this.food(S); S.card = null; S.coon = null; },
  food(S) { do { S.f = [Math.floor(Math.random() * SC), Math.floor(Math.random() * SR)]; } while (S.b.some(p => p[0] === S.f[0] && p[1] === S.f[1])); },
  step(S, dt) {
    if (tU() && S.d[1] !== 1) S.nd = [0, -1]; else if (tD() && S.d[1] !== -1) S.nd = [0, 1]; else if (tL() && S.d[0] !== 1) S.nd = [-1, 0]; else if (tR() && S.d[0] !== -1) S.nd = [1, 0];
    if (!S.card && Math.random() < dt * 0.04) S.card = { p: [Math.floor(Math.random() * SC), Math.floor(Math.random() * SR)], t: 6 };
    if (S.card && (S.card.t -= dt) < 0) S.card = null;
    if (!S.coon && S.b.length > 8 && Math.random() < dt * 0.03) S.coon = { p: [Math.random() < 0.5 ? 0 : SC - 1, Math.floor(Math.random() * SR)], t: 0 };
    if (S.coon && (S.coon.t += dt) > 0.4) { S.coon.t = 0; S.coon.p[0] += pick([-1, 0, 1]); S.coon.p[1] += pick([-1, 0, 1]); if (S.coon.p[0] < 0 || S.coon.p[0] >= SC || S.coon.p[1] < 0 || S.coon.p[1] >= SR) S.coon = null; }
    S.acc += dt * S.rate; if (S.acc < 1) return; S.acc = 0; S.d = S.nd;
    const h = [S.b[0][0] + S.d[0], S.b[0][1] + S.d[1]];
    if (h[0] < 0 || h[1] < 0 || h[0] >= SC || h[1] >= SR || S.b.some(p => p[0] === h[0] && p[1] === h[1])) { S.over = true; S.title = 'SERVICE DISRUPTION'; S.msg = `Your train was ${S.b.length} cars long. TransLynx apologizes for the inconvenience.`; noise(0.5, 0.15, 300); return; }
    S.b.unshift(h);
    if (h[0] === S.f[0] && h[1] === S.f[1]) { S.score += 10; S.rate += 0.18; this.food(S); beep([660, 990], 0.07, 'square', 0.03, 0.05); if (S.b.length >= 20) discover('snake'); }
    else S.b.pop();
    if (S.card && h[0] === S.card.p[0] && h[1] === S.card.p[1]) { S.score += 50; fx(S, 'GOLDEN COMPASS CARD +50', h[0] * SG, h[1] * SG, '#ffd45c'); sfx.chime(); S.card = null; }
    if (S.coon && Math.abs(h[0] - S.coon.p[0]) <= 0 && Math.abs(h[1] - S.coon.p[1]) <= 0) { if (S.b.length > 4) S.b.splice(-2); fx(S, 'A raccoon stole 2 cars!', h[0] * SG, h[1] * SG, '#fff'); S.coon = null; }
  },
  draw(S, c) {
    c.fillStyle = '#0d1b2a'; c.fillRect(0, 0, W, H); c.strokeStyle = '#1b2d44'; c.lineWidth = 1;
    for (let x = 0; x <= W; x += SG) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); } for (let y = 0; y <= H; y += SG) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    emo(c, '🧍', S.f[0] * SG + 10, S.f[1] * SG + 11, 18);
    if (S.card) { c.fillStyle = '#ffd45c'; c.fillRect(S.card.p[0] * SG + 3, S.card.p[1] * SG + 5, 14, 10); }
    if (S.coon) emo(c, '🦝', S.coon.p[0] * SG + 10, S.coon.p[1] * SG + 11, 18);
    S.b.forEach((p, i) => { c.fillStyle = i === 0 ? '#e2e8f0' : i % 2 ? '#f7fafc' : '#edf2f7'; c.fillRect(p[0] * SG + 1, p[1] * SG + 2, SG - 2, SG - 4); c.fillStyle = '#2b6cb0'; c.fillRect(p[0] * SG + 1, p[1] * SG + 11, SG - 2, 3); c.fillStyle = '#1a202c'; c.fillRect(p[0] * SG + 4, p[1] * SG + 4, SG - 8, 5); if (i === 0) { c.fillStyle = '#f6e05e'; c.fillRect(p[0] * SG + 8 + S.d[0] * 7, p[1] * SG + 8 + S.d[1] * 7, 4, 4); } });
  },
  hud: S => `Score ${S.score} · ${S.b.length} cars`,
  best: S => S.b.length,
  end: S => pay(cashFor(S.score, 40, 20)),
};

// ================= 4. Gastown Breakout =================
const breakout = {
  title: '🧱 Gastown Brick Breaker', arcade: true, help: '<kbd>A</kbd>/<kbd>D</kbd> move · <kbd>Space</kbd> launch · catch the 🕰️ steam clock for a wide paddle',
  init(S) { S.pw = 70; S.px = W / 2; S.lives = 3; S.lvl = 0; S.drops = []; S.wide = 0; this.wall(S); },
  wall(S) { S.lvl++; S.bricks = []; const cols = ['#9c5a3c', '#8b4a35', '#a8674a', '#7a3f2e', '#b07a55', '#6f4a3a']; for (let r = 0; r < 6; r++) for (let i = 0; i < 10; i++) S.bricks.push({ x: 20 + i * 44, y: 40 + r * 18, c: cols[(r + i) % 6], hp: r === 0 && S.lvl > 1 ? 2 : 1 }); this.serve(S); },
  serve(S) { S.stuck = true; S.bx = S.px; S.by = H - 40; S.vx = 0; S.vy = 0; },
  step(S, dt) {
    if (L()) S.px -= 300 * dt; if (Rt()) S.px += 300 * dt; const pw = S.wide > 0 ? 120 : S.pw; S.wide -= dt; S.px = Math.max(pw / 2, Math.min(W - pw / 2, S.px));
    if (S.stuck) { S.bx = S.px; S.by = H - 32; if (tapped('Space')) { S.stuck = false; S.vx = (Math.random() - 0.5) * 200; S.vy = -260 - S.lvl * 20; } }
    else for (let k = 0; k < 2; k++) {
      S.bx += S.vx * dt / 2; S.by += S.vy * dt / 2;
      if (S.bx < 5) { S.bx = 5; S.vx = Math.abs(S.vx); } if (S.bx > W - 5) { S.bx = W - 5; S.vx = -Math.abs(S.vx); } if (S.by < 5) { S.by = 5; S.vy = Math.abs(S.vy); }
      if (S.vy > 0 && S.by > H - 30 && S.by < H - 20 && Math.abs(S.bx - S.px) < pw / 2 + 5) { const o = (S.bx - S.px) / (pw / 2), sp = Math.min(420, Math.hypot(S.vx, S.vy) * 1.02); S.vx = o * sp * 0.75; S.vy = -Math.sqrt(sp * sp - S.vx * S.vx); beep([440], 0.04, 'square', 0.03); }
      for (const b of S.bricks) if (b.hp > 0 && S.bx > b.x - 5 && S.bx < b.x + 45 && S.by > b.y - 5 && S.by < b.y + 21) {
        b.hp--; const ox = Math.min(S.bx - b.x + 5, b.x + 45 - S.bx), oy = Math.min(S.by - b.y + 5, b.y + 21 - S.by); if (ox < oy) S.vx *= -1; else S.vy *= -1;
        if (b.hp <= 0) { S.score += 10; if (Math.random() < 0.08) S.drops.push({ x: b.x + 22, y: b.y, k: Math.random() < 0.8 ? '🕰️' : '🦝' }); }
        beep([200 + b.y * 3], 0.05, 'triangle', 0.04); break;
      }
    }
    for (const d of S.drops) { d.y += 110 * dt; if (d.y > H - 32 && d.y < H - 14 && Math.abs(d.x - S.px) < pw / 2 + 10) { d.y = H + 99; if (d.k === '🕰️') { S.wide = 10; fx(S, 'STEAM POWER! Wide paddle', d.x, H - 60, '#9ae6b4'); sfx.chime(); } else { S.score += 100; fx(S, 'Caught a raccoon?! +100', d.x, H - 60, '#ffd45c'); } } }
    S.drops = S.drops.filter(d => d.y < H + 20);
    if (S.by > H + 10) { S.lives--; noise(0.3, 0.1, 300); if (S.lives <= 0) { S.over = true; S.title = 'OUT OF BALLS'; S.msg = `Wall ${S.lvl}, score ${S.score}.`; } else this.serve(S); }
    if (!S.bricks.some(b => b.hp > 0)) { S.score += 250; discover('breakout'); fx(S, 'WALL DEMOLISHED +250', W / 2, H / 2, '#ffd45c'); sfx.chime(); this.wall(S); }
  },
  draw(S, c) {
    sky(c, '#1c1c2b', '#3b2a22'); c.fillStyle = '#ffffff10'; for (let i = 0; i < 8; i++) { c.beginPath(); c.arc(60 * i + 20, 300 + Math.sin(S.t + i) * 4, 22, 0, 6.3); c.fill(); }
    for (const b of S.bricks) if (b.hp > 0) { c.fillStyle = b.c; c.fillRect(b.x, b.y, 42, 16); c.fillStyle = '#0003'; c.fillRect(b.x, b.y + 13, 42, 3); if (b.hp > 1) { c.strokeStyle = '#ddd'; c.strokeRect(b.x + 1, b.y + 1, 40, 14); } }
    for (const d of S.drops) emo(c, d.k, d.x, d.y, 22);
    const pw = S.wide > 0 ? 120 : S.pw; c.fillStyle = S.wide > 0 ? '#9ae6b4' : '#cbd5e0'; c.fillRect(S.px - pw / 2, H - 28, pw, 8);
    c.fillStyle = '#fff'; c.beginPath(); c.arc(S.bx, S.by, 5, 0, 6.3); c.fill();
    if (S.stuck) txt(c, 'Press SPACE to launch', W / 2, H / 2 + 40, '#fff', 16, 'center');
  },
  hud: S => `Score ${S.score} · Wall ${S.lvl} · Balls ${S.lives}`,
  end: S => pay(cashFor(S.score, 60, 20)),
};

// ================= 5. Claw machine =================
const PLUSH = [['🐳', 'Orca plush', 30], ['🦫', 'Beaver plush', 30], ['🫎', 'Moose plush', 25], ['🐻', 'Black bear plush', 25], ['🦝', 'Raccoon plush', 20], ['🦭', 'Seal plush', 20], ['🦅', 'Bald eagle plush', 15], ['🐟', 'Salmon plush', 25], ['🦍', 'SASQUATCH plush (rare!)', 4], ['👑', 'GOLDEN SASQUATCH (legendary)', 1]];
const claw = {
  title: '🧸 Claw Machine', help: '<kbd>A</kbd>/<kbd>D</kbd> move the claw · <kbd>Space</kbd> drop · one try per $2',
  init(S) { S.x = 240; S.y = 46; S.ph = 'aim'; S.time = 12; S.got = null; S.toys = []; for (let i = 0; i < 13; i++) { let r = Math.random() * PLUSH.reduce((a, p) => a + p[2], 0), k = 0; while ((r -= PLUSH[k][2]) > 0) k++; S.toys.push({ x: 120 + Math.random() * 320, y: 270 + Math.random() * 40, k, r: (Math.random() - 0.5) * 0.8 }); } },
  step(S, dt) {
    if (S.ph === 'aim') { S.time -= dt; if (L()) S.x -= 120 * dt; if (Rt()) S.x += 120 * dt; S.x = Math.max(110, Math.min(450, S.x)); if (tapped('Space') || S.time <= 0) { S.ph = 'down'; beep([300, 200], 0.15, 'sine', 0.04, 0.1); } }
    else if (S.ph === 'down') { S.y += 140 * dt; const hit = S.toys.find(t => Math.abs(t.x - S.x) < 26 && S.y > t.y - 24); if (S.y > 300 || hit) { S.ph = 'up'; if (hit) { const d = Math.abs(hit.x - S.x), chance = 0.78 - d / 34 - (hit.k >= 8 ? 0.15 : 0); S.grip = hit; S.slip = Math.random() > chance ? 0.4 + Math.random() * 0.4 : 2; } } }
    else if (S.ph === 'up') { S.y -= 110 * dt; if (S.grip) { S.grip.x = S.x; S.grip.y = S.y + 26; if (S.slip < 1 && S.y < 300 - S.slip * 250) { S.grip.y = 290; S.grip = null; fx(S, pick(['NOOOO', 'So close!', 'Weak claw!!']), S.x, S.y, '#fff'); noise(0.2, 0.08, 400); } } if (S.y <= 46) { S.y = 46; S.ph = 'home'; } }
    else if (S.ph === 'home') { S.x -= 140 * dt; if (S.grip) S.grip.x = S.x; if (S.x <= 60) { S.x = 60; S.over = true; if (S.grip) { const p = PLUSH[S.grip.k]; S.got = p; S.title = 'YOU WON!'; S.msg = `${p[0]} ${p[1]}! It goes in your collection (${MG.plush.length + 1} toys).`; } else { S.title = 'NOTHING…'; S.msg = 'The claw machine wins again. It always does.'; } } }
  },
  draw(S, c) {
    c.fillStyle = '#2a0f3d'; c.fillRect(0, 0, W, H); c.fillStyle = '#ffffff12'; c.fillRect(100, 20, 360, 320);
    for (let i = 0; i < 14; i++) { c.fillStyle = `hsl(${(i * 26 + S.t * 120) % 360},90%,60%)`; c.beginPath(); c.arc(10 + i * 34, 10, 4, 0, 6.3); c.fill(); }
    c.fillStyle = '#111'; c.fillRect(20, 260, 70, 80); txt(c, 'PRIZE', 55, 300, '#ffd45c', 12, 'center');
    for (const t of S.toys) { c.save(); c.translate(t.x, t.y); c.rotate(t === S.grip ? 0 : t.r); emo(c, PLUSH[t.k][0], 0, 0, 40); c.restore(); }
    c.strokeStyle = '#ccc'; c.lineWidth = 2; c.beginPath(); c.moveTo(S.x, 20); c.lineTo(S.x, S.y); c.stroke();
    c.fillStyle = '#ddd'; c.fillRect(S.x - 12, S.y - 6, 24, 8); const o = S.ph === 'up' || S.ph === 'home' ? 6 : 14;
    c.beginPath(); c.moveTo(S.x - 10, S.y); c.lineTo(S.x - o - 4, S.y + 22); c.moveTo(S.x + 10, S.y); c.lineTo(S.x + o + 4, S.y + 22); c.stroke();
    if (S.ph === 'aim') txt(c, Math.ceil(S.time) + ' s', 440, 44, '#ffd45c', 18, 'right');
  },
  hud: S => `Toys collected: ${MG.plush.length}`,
  best: () => 0,
  end(S) { if (!S.got) return 0; MG.plush.push(S.got[1]); sfx.chime(); discover('clawprize'); if (S.got[0] === '👑') { discover('goldsquatch'); return pay(100); } return 0; },
};

// ================= 6. Fishing =================
const CATCH = [['🐟', 'Pink salmon', 8, 0.5, 22], ['🐟', 'Coho salmon', 15, 0.7, 14], ['🐠', 'Chinook salmon (a big one!)', 30, 1.0, 7], ['🐡', 'Rockfish', 6, 0.4, 16], ['🦀', 'Dungeness crab', 12, 0.5, 12], ['🐟', 'Flounder', 5, 0.3, 12], ['🥾', 'An old rubber boot', 0, 0.2, 6], ['🛒', 'A shopping cart?!', 1, 0.6, 3], ['🍾', 'A message in a bottle', 20, 0.2, 3], ['🦑', 'A squid', 9, 0.6, 5], ['🐉', 'CADDY JR., a baby sea serpent!', 0, 1.2, 0.6], ['✨', 'The GOLDEN SALMON', 200, 1.3, 0.6]];
const fishing = {
  title: '🎣 Pier Fishing', leaveEnds: true, help: 'Wait for a bite, then <kbd>Space</kbd> to hook · hold <kbd>Space</kbd> to reel, keep the line in the green · catches sell right away',
  init(S) { S.ph = 'wait'; S.w = 2 + Math.random() * 5; S.n = 0; S.earn = 0; S.miss = 0; },
  pickFish() { const tot = CATCH.reduce((a, p) => a + p[4], 0); let r = Math.random() * tot, k = 0; while ((r -= CATCH[k][4]) > 0) k++; return k; },
  step(S, dt) {
    if (S.ph === 'wait') { S.w -= dt; if (tapped('Space')) { S.w += 2; fx(S, 'Too early! You spooked them.', 240, 150); } if (S.w <= 0) { S.ph = 'bite'; S.bt = 0.75; beep([1200], 0.05, 'square', 0.04); } }
    else if (S.ph === 'bite') { S.bt -= dt; if (tapped('Space')) { S.ph = 'fight'; S.k = this.pickFish(); S.ten = 0.4; S.prog = 0.15; S.low = 0; S.surge = 0; } else if (S.bt <= 0) { S.ph = 'wait'; S.w = 2 + Math.random() * 4; fx(S, pick(['It got away…', 'Missed the bite!', 'The bait is gone.']), 240, 150); } }
    else if (S.ph === 'fight') {
      const str = CATCH[S.k][3]; S.surge -= dt; if (S.surge <= 0) { S.surge = 0.6 + Math.random() * 1.2; S.kick = (Math.random() - 0.3) * str * 0.9; }
      S.ten += (key('Space') ? 0.55 : -0.5) * dt + S.kick * dt; S.kick *= 0.96;
      S.ten = Math.max(0, S.ten);
      if (S.ten > 0.33 && S.ten < 0.8) S.prog += dt * 0.32 / (0.6 + str * 0.6); else if (S.ten < 0.2) { S.prog -= dt * 0.08; S.low += dt; }
      if (S.ten >= 1) { S.ph = 'show'; S.st = 2.2; S.res = '💥 SNAP! The line broke.'; noise(0.15, 0.12, 2000); }
      else if (S.prog <= 0 || S.low > 3) { S.ph = 'show'; S.st = 2.2; S.res = 'It wriggled off the hook.'; }
      else if (S.prog >= 1) {
        const f = CATCH[S.k]; S.ph = 'show'; S.st = 3; S.n++; S.got = f; MG.fish[f[1]] = (MG.fish[f[1]] || 0) + 1;
        let v = f[2]; if (f[1].includes('bottle')) { v = 5 + Math.floor(Math.random() * 40); }
        S.res = `${f[0]} ${f[1]}!` + (v ? ` Sold for ${money(v)}.` : f[1].includes('CADDY') ? ' It blinks at you and you let it go. Nobody will believe you.' : ' Into the bin it goes.');
        S.earn += pay(v); S.score += v + 5; sfx.chime();
        if (f[1].includes('salmon')) discover('fishing'); if (f[1].includes('CADDY')) discover('caddyjr');
      }
    } else if (S.ph === 'show') { S.st -= dt; if (S.st <= 0 || (S.st < 1.6 && tapped('Space'))) { S.ph = 'wait'; S.w = 2 + Math.random() * 5; S.got = null; } }
  },
  draw(S, c) {
    const night = G.night > 0.5; sky(c, night ? '#0b1a33' : '#7fb3d5', night ? '#1b2b44' : '#c9e3f2');
    c.fillStyle = night ? '#203045' : '#5d7f95'; c.beginPath(); c.moveTo(0, 150); for (let x = 0; x <= W; x += 40) c.lineTo(x, 120 + Math.sin(x * 0.03) * 18 + (x % 80 ? 8 : 0)); c.lineTo(W, 150); c.fill();
    c.fillStyle = night ? '#16324a' : '#2a6f97'; c.fillRect(0, 150, W, H - 150);
    c.fillStyle = '#ffffff22'; for (let i = 0; i < 10; i++) c.fillRect((i * 61 + S.t * 12) % W, 165 + (i % 4) * 40, 30, 2);
    c.fillStyle = '#6b4f2f'; c.fillRect(0, 175, 120, 14); for (let i = 0; i < 4; i++) c.fillRect(10 + i * 32, 189, 6, 171);
    emo(c, '🧍', 60, 152, 40);
    const bx = 330, by = 180 + Math.sin(S.t * 2) * 2 + (S.ph === 'bite' ? 8 + Math.sin(S.t * 40) * 4 : 0) + (S.ph === 'fight' ? 10 + S.ten * 10 : 0);
    c.strokeStyle = '#ddd'; c.lineWidth = 1; c.beginPath(); c.moveTo(70, 130); c.quadraticCurveTo(140, 70, 190, 60); c.stroke();
    c.beginPath(); c.moveTo(190, 60); c.quadraticCurveTo(260, S.ph === 'fight' ? 120 : 150, bx, by); c.stroke();
    c.fillStyle = '#e53e3e'; c.beginPath(); c.arc(bx, by, 5, 0, 6.3); c.fill(); c.fillStyle = '#fff'; c.fillRect(bx - 5, by - 1, 10, 2);
    if (S.ph === 'bite') txt(c, '!!', bx, by - 16, '#ffd45c', 26, 'center');
    if (S.ph === 'wait') txt(c, 'Waiting for a bite…', W / 2, 340, '#fff', 14, 'center');
    if (S.ph === 'fight') {
      c.fillStyle = '#0008'; c.fillRect(40, 300, 400, 22); c.fillStyle = '#2f855a'; c.fillRect(40 + 400 * 0.33, 300, 400 * 0.47, 22); c.fillStyle = '#c53030'; c.fillRect(40 + 400 * 0.95, 300, 20, 22);
      c.fillStyle = '#fff'; c.fillRect(40 + Math.min(1, S.ten) * 400 - 2, 296, 4, 30); txt(c, 'LINE TENSION', 40, 292, '#fff', 11);
      c.fillStyle = '#0008'; c.fillRect(40, 334, 400, 8); c.fillStyle = '#ffd45c'; c.fillRect(40, 334, 400 * Math.max(0, S.prog), 8);
      c.save(); c.globalAlpha = 0.5; emo(c, '🐟', bx + Math.sin(S.t * 5) * 20, by + 40, 30); c.restore();
    }
    if (S.ph === 'show') { c.fillStyle = '#000a'; c.fillRect(30, 40, 420, 70); if (S.got) emo(c, S.got[0], 70, 75, 40); c.fillStyle = '#fff'; c.font = 'bold 15px Segoe UI'; c.textAlign = 'left'; wrapText(c, S.res, S.got ? 100 : 50, 68, 330, 19); c.textAlign = 'left'; }
  },
  hud: S => `Caught ${S.n} · Earned ${money(S.earn)}`,
  best: S => S.n,
  end: () => 0,
};

// ================= 7. Busking (rhythm) =================
const LANE_KEYS = [['ArrowLeft', 'KeyD'], ['ArrowDown', 'KeyF'], ['ArrowUp', 'KeyJ'], ['ArrowRight', 'KeyK']], LANE_COL = ['#e53e3e', '#3182ce', '#38a169', '#d69e2e'], PENTA = [262, 294, 330, 392, 440, 523, 587];
const busk = {
  title: '🎸 Busking', help: 'Hit <kbd>D F J K</kbd> (or the arrow keys) as the notes reach the line · keep the combo going and the crowd grows',
  init(S) {
    S.notes = []; const bpm = 96 + Math.floor(Math.random() * 30), b = 60 / bpm; let t = 2;
    while (t < 36) { const lane = Math.floor(Math.random() * 4); S.notes.push({ t, lane, hit: false, miss: false }); if (Math.random() < 0.15 && t > 8) S.notes.push({ t, lane: (lane + 2) % 4, hit: false, miss: false }); t += b * pick([1, 1, 0.5, 1, 2, 0.5]); }
    S.combo = 0; S.maxc = 0; S.hits = 0; S.crowd = 2; S.tips = 0; S.dog = 0; S.gull = 0; S.flash = [0, 0, 0, 0]; S.inst = S.opts.inst || 'guitar';
  },
  step(S, dt) {
    for (let l = 0; l < 4; l++) { S.flash[l] -= dt; if (LANE_KEYS[l].some(k => tapped(k))) {
      S.flash[l] = 0.12; const n = S.notes.find(n => n.lane === l && !n.hit && !n.miss && Math.abs(n.t - S.t) < 0.17);
      if (n) { n.hit = true; const pf = Math.abs(n.t - S.t) < 0.08; S.combo++; S.hits++; S.maxc = Math.max(S.maxc, S.combo); S.score += (pf ? 100 : 50) * (1 + Math.floor(S.combo / 10)); beep([PENTA[(l * 2 + S.combo) % 7] * (S.inst === 'drums' ? 0.5 : 1)], 0.18, S.inst === 'fiddle' ? 'sawtooth' : 'triangle', 0.05); fx(S, pf ? 'PERFECT' : 'GOOD', 120 + l * 80, 270, LANE_COL[l]); }
      else { S.combo = 0; beep([110], 0.1, 'square', 0.03); }
    } }
    for (const n of S.notes) if (!n.hit && !n.miss && S.t - n.t > 0.17) { n.miss = true; S.combo = 0; }
    S.crowd += ((2 + Math.min(14, S.combo / 2)) - S.crowd) * dt * 0.6;
    if (Math.random() < dt * S.crowd * 0.045) { const v = pick([1, 1, 2, 2, 5]); S.tips += v; fx(S, '+' + money(v), 40 + Math.random() * 60, 120, '#ffd45c'); }
    if (S.combo === 20 && !S.dog) { S.dog = 3; fx(S, 'A dog is howling along! AWOOO', 240, 60, '#fff'); beep([440, 520, 600], 0.5, 'sine', 0.04, 0.3); }
    S.dog = Math.max(0, S.dog - dt * 0.0001);
    if (!S.gull && S.tips > 6 && Math.random() < dt * 0.04) { S.gull = 2; const v = Math.min(S.tips, 3); S.tips -= v; fx(S, `A seagull stole ${money(v)} from your case!`, 240, 90, '#fff'); }
    if (S.gull) S.gull = Math.max(0, S.gull - dt);
    if (S.t > S.notes[S.notes.length - 1].t + 1.5) {
      S.over = true; const acc = S.hits / S.notes.length, gr = acc > 0.92 ? 'S' : acc > 0.85 ? 'A' : acc > 0.7 ? 'B' : acc > 0.5 ? 'C' : 'D';
      S.title = 'SET OVER · GRADE ' + gr; S.acc = acc; S.msg = `${Math.round(acc * 100)}% of notes, best combo ${S.maxc}. ${gr === 'S' || gr === 'A' ? 'People are filming you. You\'re going viral.' : gr === 'D' ? 'A kid gives you a granola bar out of pity.' : 'A solid set. Somebody asks if you take e-transfer.'}`;
      if (acc > 0.85) discover('busker');
    }
  },
  draw(S, c) {
    sky(c, '#2d1b4e', '#14101f'); c.fillStyle = '#3a2f2f'; c.fillRect(0, 300, W, 60);
    for (let i = 0; i < Math.round(S.crowd); i++) emo(c, ['🧍', '🧍‍♀️', '🕺', '💃', '🧑‍🦱', '👩‍🦰'][i % 6], 30 + (i * 37) % 70 + (i > 6 ? 360 : 0) + (i > 6 ? -30 : 0), 200 + (i % 3) * 30, 28);
    emo(c, '💼', 60, 330, 26); if (S.dog) emo(c, '🐕', 420, 325, 30); if (S.gull) gull(c, 60 + (2 - S.gull) * 200, 300 - (2 - S.gull) * 120, S.t, 1.4);
    for (let l = 0; l < 4; l++) { const x = 120 + l * 80; c.fillStyle = '#ffffff10'; c.fillRect(x - 28, 0, 56, 300); c.strokeStyle = LANE_COL[l]; c.lineWidth = S.flash[l] > 0 ? 5 : 2; c.beginPath(); c.arc(x, 280, 22, 0, 6.3); c.stroke(); txt(c, ['D', 'F', 'J', 'K'][l], x, 285, '#fff8', 14, 'center'); }
    for (const n of S.notes) { if (n.hit) continue; const y = 280 - (n.t - S.t) * 170; if (y < -20 || y > 330) continue; c.fillStyle = n.miss ? '#555' : LANE_COL[n.lane]; c.beginPath(); c.arc(120 + n.lane * 80, y, 16, 0, 6.3); c.fill(); c.fillStyle = '#fff6'; c.beginPath(); c.arc(116 + n.lane * 80, y - 4, 5, 0, 6.3); c.fill(); }
    if (S.combo > 4) txt(c, S.combo + ' COMBO', W / 2, 30, '#ffd45c', 20, 'center');
  },
  hud: S => `Score ${S.score} · Tips ${money(S.tips)} · Combo ${S.combo}`,
  end: S => pay(S.tips + cashFor(S.score, 500, 25)),
};

// ================= 8. Pub darts =================
const SECT = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5], BR = 140;
function dartScore(dx, dy) {
  const r = Math.hypot(dx, dy); if (r < 7) return [50, 'BULLSEYE!']; if (r < 15) return [25, 'Outer bull']; if (r > BR) return [0, 'Missed the board!'];
  let a = Math.atan2(dx, -dy) / (Math.PI * 2) * 20 + 0.5; a = ((Math.floor(a) % 20) + 20) % 20; const s = SECT[a];
  if (r > 82 && r < 92) return [s * 3, 'Triple ' + s]; if (r > BR - 10) return [s * 2, 'Double ' + s]; return [s, String(s)];
}
const darts = {
  title: '🎯 Pub Darts', help: '<kbd>W A S D</kbd> nudge your aim (your hand wobbles!) · <kbd>Space</kbd> throw · 9 darts, beat the pub regular',
  init(S) { S.left = 9; S.ax = 0; S.ay = 0; S.stuck = []; S.rival = 120 + Math.floor(Math.random() * 160); S.name = pick(['Big Gord', 'Shirley from Burnaby', 'Darts Dave', 'Captain Ernie', 'Old Man Fitzgerald']); },
  step(S, dt) {
    if (S.wait > 0) { S.wait -= dt; if (S.wait <= 0 && S.left <= 0) { S.over = true; const win = S.score > S.rival; S.win = win; S.title = win ? 'YOU WIN!' : S.score === S.rival ? 'A DRAW' : 'YOU LOSE'; S.msg = `You ${S.score} – ${S.name} ${S.rival}. ${win ? S.name + ' buys you a pint and grumbles.' : S.name + ' does a little victory dance.'}`; } return; }
    const sp = 90; if (L()) S.ax -= sp * dt; if (Rt()) S.ax += sp * dt; if (Up()) S.ay -= sp * dt; if (Dn()) S.ay += sp * dt;
    S.ax = Math.max(-170, Math.min(170, S.ax)); S.ay = Math.max(-170, Math.min(170, S.ay));
    const wob = 14 + (9 - S.left) * 1.5; S.wx = S.ax + Math.sin(S.t * 2.3) * wob + Math.sin(S.t * 5.1) * wob * 0.4; S.wy = S.ay + Math.cos(S.t * 1.9) * wob + Math.sin(S.t * 4.3) * wob * 0.4;
    if (tapped('Space')) { const [v, s] = dartScore(S.wx, S.wy); S.score += v; S.left--; S.stuck.push([S.wx, S.wy]); noise(0.06, 0.15, 3000); fx(S, s + (v ? ' +' + v : ''), 240 + S.wx, 180 + S.wy - 10, v >= 50 ? '#ffd45c' : '#fff'); if (v === 50) { discover('bullseye'); sfx.chime(); } if (S.left <= 0) S.wait = 1; else if (S.left % 3 === 0) S.wait = 0.6; }
  },
  draw(S, c) {
    c.fillStyle = '#2b1a10'; c.fillRect(0, 0, W, H); c.fillStyle = '#3a2416'; for (let x = 0; x < W; x += 40) c.fillRect(x, 0, 3, H);
    c.save(); c.translate(240, 180); c.fillStyle = '#111'; c.beginPath(); c.arc(0, 0, BR + 22, 0, 6.3); c.fill();
    for (let i = 0; i < 20; i++) { const a0 = (i - 0.5) / 20 * Math.PI * 2 - Math.PI / 2, a1 = a0 + Math.PI * 2 / 20;
      for (const [r0, r1, ca, cb] of [[15, 82, '#f5e6c8', '#1a1a1a'], [82, 92, '#c53030', '#2f855a'], [92, BR - 10, '#f5e6c8', '#1a1a1a'], [BR - 10, BR, '#c53030', '#2f855a']]) { c.fillStyle = i % 2 ? cb : ca; c.beginPath(); c.arc(0, 0, r1, a0, a1); c.arc(0, 0, r0, a1, a0, true); c.fill(); }
      const am = (i / 20) * Math.PI * 2 - Math.PI / 2; txt(c, String(SECT[i]), Math.cos(am) * (BR + 12), Math.sin(am) * (BR + 12) + 5, '#fff', 12, 'center'); }
    c.fillStyle = '#2f855a'; c.beginPath(); c.arc(0, 0, 15, 0, 6.3); c.fill(); c.fillStyle = '#c53030'; c.beginPath(); c.arc(0, 0, 7, 0, 6.3); c.fill();
    for (const [x, y] of S.stuck) { c.fillStyle = '#ffd45c'; c.fillRect(x - 1, y - 1, 3, 3); c.strokeStyle = '#ddd'; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 8, y + 10); c.stroke(); }
    if (S.wx !== undefined && !S.over) { c.strokeStyle = '#ffd45c'; c.lineWidth = 2; c.beginPath(); c.arc(S.wx, S.wy, 9, 0, 6.3); c.moveTo(S.wx - 14, S.wy); c.lineTo(S.wx + 14, S.wy); c.moveTo(S.wx, S.wy - 14); c.lineTo(S.wx, S.wy + 14); c.stroke(); }
    c.restore(); txt(c, `${S.name}: ${S.rival}`, 10, 20, '#ffd45c', 14); txt(c, 'Darts left: ' + S.left, 10, 40, '#fff', 13);
  },
  hud: S => `You ${S.score} · Darts left ${S.left}`,
  end: S => S.win ? pay(20) : 0,
};

// ================= 9. Park checkers =================
const BX = 80, BY = 20, CS = 40;
const checkers = {
  title: '♟️ Park Checkers', once: true, help: 'Arrows / <kbd>W A S D</kbd> move the cursor · <kbd>Space</kbd> pick a piece, then <kbd>Space</kbd> on the square to move · jumps are compulsory',
  init(S) { S.b = []; for (let y = 0; y < 8; y++) { S.b.push([]); for (let x = 0; x < 8; x++) S.b[y].push((x + y) % 2 && y < 3 ? 'b' : (x + y) % 2 && y > 4 ? 'r' : null); } S.cx = 1; S.cy = 5; S.sel = null; S.turn = 'r'; S.ai = 0; S.chain = null; S.name = S.opts.champ || 'Gord'; },
  moves(b, side, only) {
    const out = []; let jump = false;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const p = b[y][x]; if (!p || p.toLowerCase() !== side) continue; if (only && (only[0] !== x || only[1] !== y)) continue;
      const dirs = p === p.toUpperCase() ? [-1, 1] : side === 'r' ? [-1] : [1];
      for (const dy of dirs) for (const dx of [-1, 1]) { const nx = x + dx, ny = y + dy, jx = x + dx * 2, jy = y + dy * 2;
        if (jx >= 0 && jx < 8 && jy >= 0 && jy < 8 && b[ny][nx] && b[ny][nx].toLowerCase() !== side && !b[jy][jx]) { out.push({ x, y, tx: jx, ty: jy, cap: [nx, ny] }); jump = true; }
        else if (nx >= 0 && nx < 8 && ny >= 0 && ny < 8 && !b[ny][nx]) out.push({ x, y, tx: nx, ty: ny }); } }
    return jump ? out.filter(m => m.cap) : only ? [] : out;
  },
  apply(S, m) { const b = S.b, p = b[m.y][m.x]; b[m.y][m.x] = null; b[m.ty][m.tx] = p; let king = false; if (m.cap) b[m.cap[1]][m.cap[0]] = null; if ((p === 'r' && m.ty === 0) || (p === 'b' && m.ty === 7)) { b[m.ty][m.tx] = p.toUpperCase(); king = true; } noise(0.05, 0.1, 1500); return king; },
  after(S, m, king) { if (m.cap && !king && this.moves(S.b, S.turn, [m.tx, m.ty]).length) { S.chain = [m.tx, m.ty]; return; } S.chain = null; S.turn = S.turn === 'r' ? 'b' : 'r'; S.ai = 0.7; this.check(S); },
  check(S) { const mine = this.moves(S.b, S.turn); if (!mine.length) { S.over = true; S.win = S.turn === 'b'; S.title = S.win ? 'YOU BEAT THE CHAMP!' : 'CHECKMATE… er, YOU LOSE'; S.msg = S.win ? `${S.name} shakes your hand: "Haven't lost since Expo 86." A small crowd claps.` : `${S.name} sets the board up again: "Come back when you've practised, kid."`; } },
  step(S, dt) {
    if (S.turn === 'b') { S.ai -= dt; if (S.ai > 0) return; const ms = this.moves(S.b, 'b', S.chain);
      const threat = (b, x, y) => { for (const dx of [-1, 1]) for (const dy of [-1, 1]) { const ax = x + dx, ay = y + dy, lx = x - dx, ly = y - dy; if (ax < 0 || ax > 7 || ay < 0 || ay > 7 || lx < 0 || lx > 7 || ly < 0 || ly > 7) continue; const a = b[ay][ax]; if (a && a.toLowerCase() === 'r' && !b[ly][lx] && (a === 'R' || dy === 1)) return true; } return false; };
      let best = null, bs = -1e9; for (const m of ms) { const b2 = S.b.map(r => r.slice()); const p = b2[m.y][m.x]; b2[m.y][m.x] = null; b2[m.ty][m.tx] = p; if (m.cap) b2[m.cap[1]][m.cap[0]] = null; let s = (m.cap ? 10 : 0) + (m.ty === 7 && p === 'b' ? 6 : 0) + (threat(b2, m.tx, m.ty) ? -8 : 0) + m.ty * 0.3 + Math.random() * 1.5; if (s > bs) { bs = s; best = m; } }
      if (!best) { this.check(S); return; } const k = this.apply(S, best); this.after(S, best, k); S.ai = 0.45; return; }
    if (tU()) S.cy = Math.max(0, S.cy - 1); if (tD()) S.cy = Math.min(7, S.cy + 1); if (tL()) S.cx = Math.max(0, S.cx - 1); if (tR()) S.cx = Math.min(7, S.cx + 1);
    if (tapped('Space')) { const p = S.b[S.cy][S.cx];
      if (p && p.toLowerCase() === 'r' && !S.chain) { S.sel = [S.cx, S.cy]; beep([700], 0.04, 'sine', 0.03); }
      else if (S.sel) { const m = this.moves(S.b, 'r', S.chain).find(m => m.x === S.sel[0] && m.y === S.sel[1] && m.tx === S.cx && m.ty === S.cy);
        if (m) { const k = this.apply(S, m); S.sel = [m.tx, m.ty]; this.after(S, m, k); if (!S.chain) S.sel = null; }
        else { fx(S, this.moves(S.b, 'r').some(m => m.cap) ? 'You must jump!' : 'Can\'t move there', BX + S.cx * CS + 20, BY + S.cy * CS, '#fff'); beep([150], 0.1, 'square', 0.03); } } }
  },
  draw(S, c) {
    c.fillStyle = '#2f5d3a'; c.fillRect(0, 0, W, H); c.fillStyle = '#7a7a72'; c.fillRect(BX - 12, BY - 12, CS * 8 + 24, CS * 8 + 24);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { c.fillStyle = (x + y) % 2 ? '#3b3b3b' : '#e8dcc0'; c.fillRect(BX + x * CS, BY + y * CS, CS, CS); const p = S.b[y][x];
      if (p) { c.fillStyle = p.toLowerCase() === 'r' ? '#c53030' : '#111'; c.beginPath(); c.arc(BX + x * CS + 20, BY + y * CS + 20, 15, 0, 6.3); c.fill(); c.strokeStyle = '#fff4'; c.lineWidth = 2; c.beginPath(); c.arc(BX + x * CS + 20, BY + y * CS + 20, 10, 0, 6.3); c.stroke(); if (p === p.toUpperCase()) emo(c, '👑', BX + x * CS + 20, BY + y * CS + 21, 16); } }
    if (S.sel) { c.strokeStyle = '#ffd45c'; c.lineWidth = 3; c.strokeRect(BX + S.sel[0] * CS + 2, BY + S.sel[1] * CS + 2, CS - 4, CS - 4); }
    c.strokeStyle = '#4fd1c5'; c.lineWidth = 3; c.strokeRect(BX + S.cx * CS, BY + S.cy * CS, CS, CS);
    txt(c, S.turn === 'r' ? 'Your move (red)' : S.name + ' is thinking…', 6, 352, '#fff', 12); emo(c, '👴', 450, 40, 36); txt(c, S.name, 450, 76, '#fff', 11, 'center');
  },
  hud: S => S.turn === 'r' ? 'Your turn' : 'Their turn',
  best: S => S.win ? 1 : 0,
  end(S) { if (!S.win) return 0; discover('checkers'); return pay(30); },
};

// ================= 10. Hot-dog cart rush =================
const TOP = [['Ketchup', '#d62828'], ['Mustard', '#f4c300'], ['Wasabi mayo', '#9bc53d'], ['Nori', '#1d3b2a'], ['Grilled onions', '#c9a26b'], ['Teriyaki', '#5a2d0c']];
const hotdog = {
  title: '🌭 Nori-Dog Lunch Rush', help: '<kbd>1</kbd>–<kbd>6</kbd> add toppings · <kbd>Space</kbd> serve the first customer · <kbd>X</kbd> bin it · <kbd>Q</kbd> shoo seagulls · 60 seconds',
  init(S) { S.q = []; S.cur = []; S.spawn = 0.5; S.served = 0; S.earn = 0; S.gull = 0; S.gullT = 12 + Math.random() * 10; },
  order() { const n = 1 + Math.floor(Math.random() * 3), s = new Set(); while (s.size < n) s.add(Math.floor(Math.random() * 6)); return [...s]; },
  step(S, dt) {
    S.spawn -= dt; if (S.spawn <= 0 && S.q.length < 4) { S.spawn = 3 + Math.random() * 3; const vip = Math.random() < 0.05; S.q.push({ o: this.order(), p: 16, face: vip ? '🏒' : pick(['🧑', '👩', '👨‍🦰', '🧔', '👵', '🧑‍💼', '👷', '🧑‍🎓', '🐶']), vip }); }
    for (const c of S.q) c.p -= dt; const gone = S.q.filter(c => c.p <= 0); if (gone.length) { S.q = S.q.filter(c => c.p > 0); fx(S, 'Customer left hungry 😤', 240, 80, '#fff'); }
    for (let i = 0; i < 6; i++) if (tapped('Digit' + (i + 1)) || tapped('Numpad' + (i + 1))) { if (!S.cur.includes(i) && S.cur.length < 5) { S.cur.push(i); beep([300 + i * 60], 0.05, 'sine', 0.03); } }
    if (tapped('KeyX') || tapped('Backspace')) { S.cur = []; noise(0.1, 0.05, 800); }
    if (tapped('Space') && S.q.length) { const c = S.q.shift(), ok = c.o.length === S.cur.length && c.o.every(t => S.cur.includes(t));
      if (ok) { const tip = Math.ceil(c.p / 4) + (c.vip ? 40 : 0), v = 6 + tip; S.earn += v; S.served++; S.score += v; sfx.coin(); fx(S, (c.vip ? 'A hockey player! Huge tip! ' : 'Yum! ') + '+' + money(v), 240, 110, '#ffd45c'); if (S.served === 10) discover('hotdog'); }
      else { fx(S, pick(['"That\'s not what I ordered!"', '"Wasabi?! I said MUSTARD."', '"I\'m posting a review."']), 240, 110, '#fff'); noise(0.2, 0.06, 300); }
      S.cur = []; }
    S.gullT -= dt; if (S.gullT <= 0 && !S.gull) { S.gull = 2.2; S.gullT = 14 + Math.random() * 12; }
    if (S.gull) { if (tapped('KeyQ')) { S.gull = 0; fx(S, 'SHOO!', 240, 200, '#9ae6b4'); } else if ((S.gull -= dt) <= 0) { S.gull = 0; if (S.cur.length) { S.cur = []; fx(S, 'A seagull stole your hot dog!', 240, 200, '#fff'); } } }
    if (S.t >= 60) { S.over = true; S.title = 'SHIFT OVER'; S.msg = `${S.served} hot dogs served, ${money(S.earn)} earned. ${S.served >= 10 ? 'The owner offers you a full-time job. You politely decline.' : 'Not bad for a first shift.'}`; }
  },
  draw(S, c) {
    sky(c, '#87b6d8', '#dfe9f2'); c.fillStyle = '#8a8f99'; c.fillRect(0, 190, W, 170);
    S.q.forEach((cu, i) => { const x = 70 + i * 110; emo(c, cu.face, x, 120, 50); c.fillStyle = '#fff'; c.fillRect(x - 48, 10, 96, 52); cu.o.forEach((t, j) => { c.fillStyle = TOP[t][1]; c.fillRect(x - 42, 15 + j * 15, 12, 12); txt(c, (t + 1) + ' ' + TOP[t][0], x - 26, 25 + j * 15, '#222', 10); }); c.fillStyle = cu.p > 6 ? '#38a169' : '#e53e3e'; c.fillRect(x - 40, 152, 80 * cu.p / 16, 5); });
    c.fillStyle = '#c53030'; c.fillRect(60, 200, 360, 80); c.fillStyle = '#fff'; c.fillRect(60, 200, 360, 14); txt(c, 'NORI-DOG · JAPANESE-STYLE HOT DOGS', 240, 211, '#c53030', 11, 'center');
    c.fillStyle = '#e9c46a'; c.beginPath(); c.ellipse(240, 248, 90, 18, 0, 0, 6.3); c.fill(); c.fillStyle = '#9c3b22'; c.beginPath(); c.ellipse(240, 242, 82, 9, 0, 0, 6.3); c.fill();
    S.cur.forEach((t, j) => { c.strokeStyle = '#000a'; c.lineWidth = 7; c.beginPath(); for (let x = -70; x <= 70; x += 6) c.lineTo(240 + x, 234 - j * 4 + Math.sin(x * 0.3 + j) * 3); c.stroke(); c.strokeStyle = TOP[t][1]; c.lineWidth = 5; c.stroke(); });
    txt(c, S.cur.length ? 'On your dog: ' + S.cur.map(t => TOP[t][0]).join(' + ') : 'Plain dog. Add toppings with 1–6', 240, 292, '#fff', 12, 'center');
    TOP.forEach((t, i) => { c.fillStyle = t[1]; c.fillRect(20 + i * 75, 300, 66, 44); txt(c, String(i + 1), 53 + i * 75, 322, '#fff', 18, 'center'); txt(c, t[0], 53 + i * 75, 338, '#fff', 9, 'center'); });
    if (S.gull) { gull(c, 240 + Math.sin(S.t * 3) * 120, 190 - S.gull * 30, S.t, 2.2); txt(c, 'SEAGULL! Press Q!', 240, 180, '#c53030', 16, 'center'); }
    txt(c, Math.max(0, Math.ceil(60 - S.t)) + ' s', W - 10, 185, '#222', 16, 'right');
  },
  hud: S => `Served ${S.served} · ${money(S.earn)}`,
  best: S => S.served,
  end: S => pay(S.earn),
};

// ================= 11. Troll Toll (hidden: Simon says under the Burrard Bridge) =================
const SIMON = [['#38a169', 'ArrowUp', 'KeyW', 330], ['#e53e3e', 'ArrowRight', 'KeyD', 392], ['#d69e2e', 'ArrowDown', 'KeyS', 494], ['#3182ce', 'ArrowLeft', 'KeyA', 262]];
const troll = {
  title: '🧌 The Troll Toll', once: true, help: 'Watch the troll\'s lanterns, then repeat them with the arrow keys (or <kbd>W A S D</kbd>)',
  init(S) { S.seq = [Math.floor(Math.random() * 4)]; S.ph = 'show'; S.i = 0; S.tt = 0.8; S.lit = -1; S.say = 'Pay the troll toll… with your MEMORY.'; },
  step(S, dt) {
    S.tt -= dt;
    if (S.ph === 'show') { if (S.tt <= 0) { if (S.lit >= 0) { S.lit = -1; S.tt = 0.18; S.i++; if (S.i >= S.seq.length) { S.ph = 'input'; S.i = 0; } } else { S.lit = S.seq[S.i]; S.tt = Math.max(0.25, 0.55 - S.seq.length * 0.02); beep([SIMON[S.lit][3]], 0.3, 'sine', 0.06); } } return; }
    if (S.tt <= 0) S.lit = -1;
    for (let k = 0; k < 4; k++) if (tapped(SIMON[k][1]) || tapped(SIMON[k][2])) {
      S.lit = k; S.tt = 0.2;
      if (S.seq[S.i] !== k) { noise(0.5, 0.15, 200); S.over = true; S.score = S.seq.length - 1; S.title = 'WRONG!'; S.msg = S.score >= 8 ? 'The troll is impressed anyway and lets you pass.' : pick(['"HA! Come back when your brain is bigger."', '"The toll is unpaid. Begone!" (He throws a pebble at you.)', '"Wrong lantern. Trolls never forget. YOU did."']); return; }
      beep([SIMON[k][3]], 0.25, 'sine', 0.06); S.i++;
      if (S.i >= S.seq.length) { S.score = S.seq.length; if (S.score === 8) { discover('troll'); S.say = '"EIGHT?! Fine. You may pass… and take this." (+$40)'; pay(40); } else S.say = pick(['"Hmph. Lucky."', '"Again!"', '"My cousin under the Fremont Bridge is easier."', '"Not bad for a human."']); S.seq.push(Math.floor(Math.random() * 4)); S.ph = 'show'; S.i = 0; S.tt = 1; S.lit = -1; }
    }
  },
  draw(S, c) {
    c.fillStyle = '#0d1117'; c.fillRect(0, 0, W, H); c.fillStyle = '#2d3340'; c.fillRect(0, 0, W, 50); for (let x = 0; x < W; x += 60) c.fillRect(x + 20, 50, 16, 120);
    emo(c, '🧌', 240, 200, 120);
    const pos = [[240, 80], [400, 200], [240, 320], [80, 200]];
    SIMON.forEach((s, k) => { c.fillStyle = s[0]; c.globalAlpha = S.lit === k ? 1 : 0.25; c.beginPath(); c.arc(pos[k][0], pos[k][1], 30, 0, 6.3); c.fill(); if (S.lit === k) { c.globalAlpha = 0.3; c.beginPath(); c.arc(pos[k][0], pos[k][1], 50, 0, 6.3); c.fill(); } c.globalAlpha = 1; });
    txt(c, S.say, W / 2, 24, '#ffd45c', 13, 'center'); txt(c, S.ph === 'show' ? 'Watch…' : 'Your turn!', W / 2, 352, '#fff', 14, 'center');
  },
  hud: S => `Round ${S.seq.length}`,
  end: S => pay(S.score >= 3 ? S.score * 2 : 0),
};

// ================= 12. Raccoon Run (hidden: the basement arcade) =================
const raccoon = {
  title: '🦝 RACCOON RUN', arcade: true, help: '<kbd>Space</kbd> / <kbd>W</kbd> jump (double jump in the air) · grab pizza crusts 🍕, dodge the bins and the cat',
  init(S) { S.y = 0; S.vy = 0; S.jumps = 0; S.sp = 220; S.d = 0; S.obs = []; S.next = 1; S.pz = 0; },
  step(S, dt) {
    S.sp += dt * 6; S.d += S.sp * dt; S.score = Math.floor(S.d / 10) + S.pz * 25; if (S.score >= 1000) discover('trashking');
    if ((tapped('Space') || tU()) && S.jumps < 2) { S.vy = 470; S.jumps++; beep([500 + S.jumps * 200], 0.06, 'square', 0.03); }
    S.vy -= 1300 * dt; S.y += S.vy * dt; if (S.y <= 0) { S.y = 0; S.vy = 0; S.jumps = 0; }
    S.next -= dt; if (S.next <= 0) { S.next = 0.9 + Math.random() * 1.1 - Math.min(0.35, S.d / 40000); const k = pick(['bin', 'bin', 'cat', 'pizza', 'pizza', 'cone']); S.obs.push({ x: W + 30, k, y: k === 'pizza' ? 30 + Math.random() * 90 : 0 }); }
    for (const o of S.obs) { o.x -= (S.sp + (o.k === 'cat' ? 60 : 0)) * dt; if (Math.abs(o.x - 80) < 22 && !o.got) { if (o.k === 'pizza') { if (Math.abs(S.y - o.y) < 30) { o.got = true; S.pz++; beep([1200], 0.05, 'square', 0.03); } } else if (S.y < 30) { S.over = true; S.title = 'BUSTED'; S.msg = `${Math.floor(S.d / 10)} m of back alley, ${S.pz} pizza crusts. ${pick(['A cat stares at you, unimpressed.', 'The bin lid clangs. Every dog on the block barks.', 'You retreat under a porch to plan tomorrow\'s heist.'])}`; noise(0.4, 0.15, 500); } } }
    S.obs = S.obs.filter(o => o.x > -40 && !o.got);
  },
  draw(S, c) {
    sky(c, '#0a0f2a', '#1f1640'); c.fillStyle = '#fff'; for (let i = 0; i < 30; i++) c.fillRect((i * 97) % W, (i * 41) % 140, 2, 2);
    c.fillStyle = '#ffe9a0'; c.beginPath(); c.arc(400, 50, 20, 0, 6.3); c.fill();
    c.fillStyle = '#1c1530'; for (let i = 0; i < 6; i++) { const x = ((i * 120 - S.d * 0.3) % 720 + 720) % 720 - 120; c.fillRect(x, 120, 100, 200); c.fillStyle = '#ffd45c55'; c.fillRect(x + 20, 150, 14, 14); c.fillRect(x + 60, 190, 14, 14); c.fillStyle = '#1c1530'; }
    c.fillStyle = '#6b4f2f'; for (let x = -((S.d * 0.8) % 30); x < W; x += 30) c.fillRect(x, 250, 26, 54);
    c.fillStyle = '#333'; c.fillRect(0, 304, W, 56);
    for (const o of S.obs) emo(c, { bin: '🗑️', cat: '🐈', pizza: '🍕', cone: '🚧' }[o.k], o.x, 290 - o.y, o.k === 'pizza' ? 24 : 32);
    c.save(); c.translate(80, 288 - S.y); c.scale(-1, 1); emo(c, '🦝', 0, 0, 36); c.restore();
  },
  hud: S => `Score ${S.score} · 🍕 ${S.pz}`,
  end: S => pay(cashFor(S.score, 100, 25)),
};

const GAMES = { invaders, frogger, snake, breakout, claw, fishing, busk, darts, checkers, hotdog, troll, raccoon };
const ARCADE_NAMES = { invaders: 'SEAGULL INVADERS', frogger: 'CROSS GRANVILLE', snake: 'SKYTRAIN SNAKE', breakout: 'BRICK BREAKER', claw: 'CLAW MACHINE', raccoon: 'RACCOON RUN' };

// ---------- pub trivia (dialog game) ----------
const QUIZ = [
  ['In what year did Vancouver become a city?', ['1886', '1871', '1908'], 0, 'Incorporated April 1886. It burned down two months later. Rough start.'],
  ['The Lions Gate Bridge opened in…', ['1938', '1956', '1925'], 0, 'Built by the Guinness family to sell their British Properties lots.'],
  ['Gastown is named after…', ['"Gassy" Jack Deighton, a chatty saloon keeper', 'The first gas streetlights', 'A natural gas leak'], 0, 'He was called "Gassy" because he never stopped talking.'],
  ['Which is bigger?', ['Stanley Park', 'New York\'s Central Park', 'They\'re the same'], 0, 'Stanley Park is about 405 hectares; Central Park about 341.'],
  ['Vancouver hosted the Winter Olympics in…', ['2010', '2006', '1988'], 0, 'Calgary had 1988. Vancouver had 2010 and a hockey gold in overtime.'],
  ['The SeaBus crosses…', ['Burrard Inlet', 'False Creek', 'The Fraser River'], 0, 'Downtown to Lonsdale Quay in about 12 minutes.'],
  ['The Grouse Grind climbs roughly how high?', ['About 850 m', 'About 300 m', 'About 1,500 m'], 0, 'Nicknamed "Mother Nature\'s Stairmaster".'],
  ['The Gastown Steam Clock was built in…', ['1977', '1877', '1927'], 0, 'It looks Victorian but it\'s younger than Star Wars.'],
  ['The Canucks played their first NHL season in…', ['1970', '1950', '1985'], 0, 'Still waiting on that first Stanley Cup.'],
  ['Which environmental group was founded in Vancouver in 1971?', ['Greenpeace', 'The Sierra Club', 'WWF'], 0, 'It started with a boat sailing to protest nuclear tests.'],
  ['The 1986 World\'s Fair in Vancouver was called…', ['Expo 86', 'Vanfest', 'World Expo Pacific'], 0, 'Its theme was transportation and communication. Hence the SkyTrain!'],
  ['The Stawamus Chief near Squamish is…', ['A giant granite monolith', 'A totem pole', 'A ferry'], 0, 'One of the biggest granite monoliths in the world. Climbers love it.'],
  ['The Peak 2 Peak Gondola links…', ['Whistler and Blackcomb', 'Grouse and Seymour', 'Cypress and Hollyburn'], 0, 'Its middle span is about 3 km with no towers.'],
  ['The Nine O\'Clock Gun has fired every night since…', ['1898', '1958', '1986'], 0, 'It once told ships in the harbour the right time.'],
  ['Which sushi roll is said to have been invented in Vancouver?', ['The California roll', 'The dragon roll', 'The rainbow roll'], 0, 'Chef Hidekazu Tojo says he created it here in the 1970s.'],
];
async function trivia(pubName) {
  const qs = [...QUIZ].sort(() => Math.random() - 0.5).slice(0, 5); let right = 0;
  const host = pick(['Quizmaster Trev', 'Quiz Queen Deb', 'MC Sandeep', 'Trivia Tamsin']);
  await ui.dialog(`❓ Trivia night${pubName ? ' at ' + pubName : ''}`, `${host}: "Five questions about Vancouver. $5 for every right answer. No phones! …Put the phone DOWN, Kevin."`, ['Let\'s go']);
  for (let i = 0; i < qs.length; i++) {
    const [q, a, ok, fact] = qs[i], order = [0, 1, 2].sort(() => Math.random() - 0.5);
    const pickI = await ui.dialog(`Question ${i + 1} of 5`, q, order.map(j => a[j]));
    if (order[pickI] === ok) { right++; pay(5); await ui.dialog('✅ Correct! (+$5)', fact, ['Next']); }
    else await ui.dialog('❌ Nope', `It's "${a[ok]}". ${fact}`, ['Next']);
  }
  MG.best.trivia = Math.max(MG.best.trivia || 0, right);
  if (right === 5) discover('trivia');
  ui.toast(`🍺 Trivia: ${right}/5`, right === 5 ? 'Perfect score! The other teams demand a recount.' : right >= 3 ? 'Respectable. Your team name ("Quiz Khalifa") gets a laugh.' : 'Your team came last. You still get a free basket of fries.', 4000);
}

// ---------- the riddle hunt that starts at a ringing payphone ----------
const RIDDLES = [
  ['steamclock', 'I whistle every quarter hour but I am no kettle. Find me where a talkative saloon keeper once poured drinks.', 'Gastown'],
  ['gate', 'Walk under a red gateway with a green-tiled roof that guards a historic neighbourhood.', 'Chinatown'],
  ['science', 'A giant silver golf ball sits at the end of False Creek. Go and tee off.', 'the east end of False Creek'],
  ['inukshuk', 'A friendly figure of stacked stone waves over English Bay. Say hello.', 'English Bay beach'],
  ['laughter', 'Fourteen bronze men cannot stop laughing in a little park by the beach. Join them.', 'Morton Park, by English Bay'],
  ['dude', 'The last clue is a sign. Literally. Find the park where a dude chills.', 'Mount Pleasant, near Main St'],
];
const huntText = () => { const r = RIDDLES[MG.hunt - 1]; if (!r) return null; return `<b>☎️ The Payphone Riddles (${MG.hunt}/${RIDDLES.length})</b><br>${r[1]}${MG.huntT > 150 ? `<br><small>Hint: try ${r[2]}.</small>` : ''}`; };
function updateHunt(dt) {
  if (MG.hunt < 1 || MG.hunt > RIDDLES.length) return;
  MG.huntT += dt; const s = SPOTS[RIDDLES[MG.hunt - 1][0]];
  if (s && Math.hypot(pl.x - s.x, pl.z - s.z) < 30) {
    MG.hunt++; MG.huntT = 0; sfx.chime();
    if (MG.hunt > RIDDLES.length) { pay(250); discover('payphone'); ui.toast('☎️ RING RING… "Well done, detective."', 'A taped envelope under the sign holds $250 and a note: "The city has more secrets. Keep looking."', 6000); MG.hunt = 99; }
    else ui.toast('☎️ A nearby payphone rings…', `"Clue ${MG.hunt}: ${RIDDLES[MG.hunt - 1][1]}"`, 6500);
  }
}

// ---------- world props ----------
const KIOSKS = [
  { name: 'Playland Arcade', at: [49.2818, -123.0372], games: ['invaders', 'frogger', 'snake', 'breakout', 'claw'] },
  { name: 'Granville Strip arcade', at: [49.2797, -123.1228], games: ['invaders', 'frogger', 'claw'] },
  { name: 'The Drive arcade', at: [49.2733, -123.0695], games: ['snake', 'breakout'] },
  { name: 'Lonsdale Quay arcade', at: [49.3104, -123.0826], games: ['frogger', 'invaders', 'claw'] },
  { name: 'Metrotown arcade', at: [49.2265, -123.0035], games: ['breakout', 'snake', 'claw'] },
  { name: 'Richmond arcade', at: [49.1690, -123.1385], games: ['invaders', 'claw'] },
];
const BUSK = [{ name: 'Granville Island', at: [49.2716, -123.1347], inst: 'fiddle' }, { name: 'Robson Square', at: [49.2822, -123.1212], inst: 'drums' }, { name: 'the Steam Clock', at: [49.2844, -123.1088], inst: 'guitar' }, { name: 'Lonsdale Quay', at: [49.3096, -123.0838], inst: 'guitar' }];
const TABLES = [{ name: 'Grandview Park', at: [49.2745, -123.0697], champ: 'Gord' }, { name: 'Kits Beach park', at: [49.2752, -123.1530], champ: 'Captain Ernie' }, { name: 'Queen Elizabeth Park', at: [49.2425, -123.1150], champ: 'Mrs. Okafor' }, { name: 'Victory Square', at: [49.2825, -123.1105], champ: 'Professor Dot' }];
const CARTS = [{ at: [49.2809, -123.1243] }, { at: [49.2858, -123.1123] }, { at: [49.2730, -123.1530] }];
const PAYPHONE = [49.2832, -123.1050], HATCH = [49.2802, -123.1062], TROLL_SEARCH = [49.2752, -123.1398];
const spots = []; const pierTips = []; const pubBoards = new Map();
const blocked = (x, z, pad) => isWater(x, z) || !!buildingAt(x, z) || !!buildingAt(x + pad, z) || !!buildingAt(x - pad, z) || !!buildingAt(x, z + pad) || !!buildingAt(x, z - pad);
function openSpot(x, z, pad = 3) { for (let r = 0; r < 150; r += 3) for (let a = 0; a < 6.28; a += 0.4) { const X = x + Math.cos(a) * r, Z = z + Math.sin(a) * r; if (!blocked(X, Z, pad)) return [X, Z]; } return [x, z]; }
const groundAt = (x, z) => walkY(x, z, groundY(x, z) + 0.5);   // street level, never on top of a bridge deck overhead
function place(at, pad) { const [x, z] = openSpot(...toXZ(...at), pad), g = new THREE.Group(); g.position.set(x, groundAt(x, z), z); scene.add(g); return g; }
const glowM = c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
const box = (w, h, d, m, x, y, z, g) => addMesh(new THREE.BoxGeometry(w, h, d), m, x, y, z, g);

// arcade cabinet screens: one animated "attract mode" texture per game, refreshed only when you're near
const screens = {};
function screenTex(id) {
  if (screens[id]) return screens[id].tex;
  const c = document.createElement('canvas'); c.width = 128; c.height = 96; const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  screens[id] = { c, x: c.getContext('2d'), tex }; drawScreen(id, 0); return tex;
}
function drawScreen(id, t) {
  const { x: c, tex } = screens[id]; c.fillStyle = '#000'; c.fillRect(0, 0, 128, 96);
  if (id === 'invaders') { for (let i = 0; i < 12; i++) { c.fillStyle = '#fff'; const x = 16 + (i % 6) * 18 + Math.sin(t) * 8, y = 18 + Math.floor(i / 6) * 14; c.fillRect(x - 5, y - (Math.floor(t * 4) % 2 ? 2 : 0), 10, 2); c.fillRect(x - 2, y, 4, 3); } c.fillStyle = '#e53e3e'; c.fillRect(60 + Math.sin(t * 1.3) * 40, 80, 10, 6); }
  else if (id === 'frogger') { c.fillStyle = '#2d3748'; c.fillRect(0, 40, 128, 40); c.fillStyle = '#2c6e8f'; c.fillRect(0, 8, 128, 30); for (let i = 0; i < 3; i++) { c.fillStyle = '#f6e05e'; c.fillRect((t * 40 + i * 50) % 140 - 10, 46, 14, 8); c.fillStyle = '#e53e3e'; c.fillRect(128 - (t * 60 + i * 45) % 140, 62, 14, 8); c.fillStyle = '#fff'; c.fillRect((t * 25 + i * 60) % 150 - 20, 18, 26, 8); } c.fillStyle = '#9ae6b4'; c.fillRect(60, 84, 8, 8); }
  else if (id === 'snake') { c.fillStyle = '#edf2f7'; for (let i = 0; i < 9; i++) { const k = (t * 6 - i) / 6; c.fillRect(64 + Math.cos(k) * 40 - 3, 48 + Math.sin(k * 1.5) * 30 - 3, 7, 7); } c.fillStyle = '#ffd45c'; c.fillRect(100, 20, 6, 6); }
  else if (id === 'breakout') { for (let r = 0; r < 4; r++) for (let i = 0; i < 8; i++) if ((i * 7 + r * 3 + Math.floor(t)) % 5) { c.fillStyle = ['#9c5a3c', '#a8674a', '#7a3f2e', '#b07a55'][r]; c.fillRect(4 + i * 15, 8 + r * 8, 13, 6); } c.fillStyle = '#fff'; c.fillRect(64 + Math.sin(t * 2) * 50, 60 + Math.cos(t * 3) * 14, 4, 4); c.fillRect(50 + Math.sin(t * 2) * 40, 88, 28, 3); }
  else if (id === 'claw') { c.fillStyle = '#2a0f3d'; c.fillRect(0, 0, 128, 96); for (let i = 0; i < 8; i++) { c.fillStyle = `hsl(${i * 45},80%,60%)`; c.beginPath(); c.arc(10 + i * 15, 82, 7, 0, 6.3); c.fill(); } c.strokeStyle = '#ccc'; const x = 64 + Math.sin(t) * 40; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 30 + Math.sin(t * 2) * 10); c.stroke(); }
  else if (id === 'raccoon') { c.fillStyle = '#1f1640'; c.fillRect(0, 0, 128, 96); c.fillStyle = '#888'; c.fillRect(30, 70 - Math.abs(Math.sin(t * 3)) * 20, 12, 8); c.fillStyle = '#2f855a'; c.fillRect(128 - (t * 50) % 140, 70, 8, 10); }
  c.fillStyle = '#ffd45c'; c.font = 'bold 10px monospace'; c.textAlign = 'center'; c.fillText(Math.floor(t * 2) % 2 ? 'INSERT COIN' : ARCADE_NAMES[id], 64, 94);
  tex.needsUpdate = true;
}
function cabinet(id, g, x, color) {
  const m = std(color, { roughness: 0.5 }), dark = std('#111');
  box(0.85, 1.25, 0.75, m, x, 0.62, 0, g); box(0.85, 0.7, 0.45, m, x, 1.6, -0.15, g); box(0.85, 0.28, 0.6, std('#222', { emissive: color, emissiveIntensity: 0.6 }), x, 2.05, -0.05, g);
  const panel = box(0.8, 0.08, 0.32, dark, x, 1.28, 0.42, g); panel.rotation.x = 0.25;
  box(0.06, 0.12, 0.06, std('#e53e3e', { emissive: '#e53e3e', emissiveIntensity: 0.5 }), x - 0.2, 1.36, 0.44, g); box(0.07, 0.04, 0.07, std('#f6e05e', { emissive: '#f6e05e', emissiveIntensity: 0.5 }), x + 0.15, 1.34, 0.42, g);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.52), new THREE.MeshBasicMaterial({ map: screenTex(id), toneMapped: false })); scr.position.set(x, 1.62, 0.09); scr.rotation.x = -0.18; g.add(scr);
}
function clawMachine(g, x) {
  const fr = std('#d53f8c', { roughness: 0.4 });
  box(1.2, 0.9, 1.1, fr, x, 0.45, 0, g); box(1.2, 0.2, 1.1, std('#222', { emissive: '#ff6ad5', emissiveIntensity: 0.8 }), x, 2.25, 0, g);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.25, 1.05), new THREE.MeshStandardMaterial({ color: '#cfefff', transparent: true, opacity: 0.18, roughness: 0.05 })); glass.position.set(x, 1.52, 0); g.add(glass);
  const cols = ['#3182ce', '#e53e3e', '#f6e05e', '#38a169', '#805ad5', '#ed8936', '#fff'];
  for (let i = 0; i < 14; i++) addMesh(new THREE.SphereGeometry(0.13, 8, 6), std(pick(cols)), x - 0.4 + Math.random() * 0.8, 1.0 + Math.random() * 0.2, -0.35 + Math.random() * 0.7, g);
  box(0.04, 0.4, 0.04, std('#ccc', { metalness: 0.8 }), x, 1.92, 0, g); box(0.2, 0.08, 0.2, std('#ccc', { metalness: 0.8 }), x, 1.7, 0, g);
}
function buildKiosk(k) {
  const n = k.games.length, w = n * 1.35 + 0.8, g = place(k.at, Math.max(3, w / 2 + 1));
  g.rotation.y = Math.random() * 6.28;
  const pal = ['#2b6cb0', '#c53030', '#2f855a', '#6b46c1', '#dd6b20'];
  k.games.forEach((id, i) => { const x = (i - (n - 1) / 2) * 1.35; if (id === 'claw') clawMachine(g, x); else cabinet(id, g, x, pal[i % pal.length]); spots.push({ kind: 'cab', id, g, lx: x, lz: 0.95, label: `🕹️ Play ${id === 'claw' ? 'the claw machine ($2)' : ARCADE_NAMES[id] + ' ($1)'}`, at: k.name, icon: '🕹️', mark: i === 0 }); });
  box(w, 0.12, 2.4, std('#1a202c'), 0, 2.9, 0.4, g); for (const sx of [-1, 1]) box(0.12, 2.9, 0.12, std('#333'), sx * (w / 2 - 0.1), 1.45, 1.5, g);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w, 5), 0.7), new THREE.MeshBasicMaterial({ map: canvasTex(512, 72, (c, W2, H2) => { c.fillStyle = '#12002a'; c.fillRect(0, 0, W2, H2); c.font = 'bold 44px Segoe UI'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.shadowColor = '#ff4fd8'; c.shadowBlur = 16; c.fillStyle = '#ff9df0'; c.fillText('🕹️ ARCADE', W2 / 2, H2 / 2 + 2); }, false), toneMapped: false }));
  sign.position.set(0, 3.35, 1.61); g.add(sign);
  g.updateMatrixWorld(true);
}
function buildBusk(b) {
  const g = place(b.at, 2.5); g.rotation.y = Math.random() * 6.28;
  box(0.9, 0.12, 0.4, std('#3b2416'), 0, 0.06, 0, g); box(0.86, 0.04, 0.36, std('#7b1e2e'), 0, 0.12, 0, g);
  for (let i = 0; i < 6; i++) addMesh(new THREE.CylinderGeometry(0.02, 0.02, 0.01, 8), std('#d4af37', { metalness: 0.9, roughness: 0.3 }), -0.3 + Math.random() * 0.6, 0.15, -0.12 + Math.random() * 0.24, g, false);
  box(0.03, 1.5, 0.03, std('#222'), 0.7, 0.75, -0.2, g); addMesh(new THREE.SphereGeometry(0.05, 8, 6), std('#888', { metalness: 0.8 }), 0.7, 1.52, -0.2, g);
  const sg = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.35), new THREE.MeshStandardMaterial({ map: canvasTex(128, 72, (c) => { c.fillStyle = '#c9a26b'; c.fillRect(0, 0, 128, 72); c.fillStyle = '#222'; c.font = 'bold 16px Segoe UI'; c.textAlign = 'center'; c.fillText('YOUR SPOT', 64, 28); c.fillText('TODAY! 🎵', 64, 52); }, false) }));
  sg.position.set(-0.6, 0.3, 0); sg.rotation.y = 0.3; sg.rotation.x = -0.4; g.add(sg); g.updateMatrixWorld(true);
  spots.push({ kind: 'busk', g, lx: 0, lz: 0.9, label: `🎸 Busk at ${b.name} (${b.inst})`, b, icon: '🎸', mark: true });
}
function buildTable(t) {
  const g = place(t.at, 2.5);
  const conc = std('#9a968c'); addMesh(new THREE.CylinderGeometry(0.15, 0.25, 0.72, 10), conc, 0, 0.36, 0, g);
  const top = box(0.9, 0.08, 0.9, conc, 0, 0.76, 0, g);
  const bd = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), new THREE.MeshStandardMaterial({ map: canvasTex(64, 64, c => { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { c.fillStyle = (x + y) % 2 ? '#222' : '#e8dcc0'; c.fillRect(x * 8, y * 8, 8, 8); } }, false) }));
  bd.rotation.x = -Math.PI / 2; bd.position.set(0, 0.805, 0); g.add(bd);
  for (let i = 0; i < 6; i++) addMesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 10), std(i < 3 ? '#c53030' : '#111'), -0.2 + i * 0.08, 0.82, i < 3 ? 0.22 : -0.22, g, false);
  for (const s of [-1, 1]) addMesh(new THREE.CylinderGeometry(0.2, 0.22, 0.45, 10), conc, 0, 0.22, s * 0.85, g);
  const h = makeHuman({ skin: pick(['#e0ac7e', '#c68c5e', '#f5d6bd', '#8d5524']), hair: '#d8d8d8', shirt: pick(['#6b4f2f', '#2c5282', '#4a5568']), pants: '#2d3748', hat: pick(['#2d3748', null]) });
  scene.remove(h.grp); g.add(h.grp); h.grp.position.set(0, 0.45, -0.85); h.st.kind = 'sit'; h.pose(0);
  g.updateMatrixWorld(true);
  spots.push({ kind: 'table', g, lx: 0, lz: 0.9, label: `♟️ Challenge ${t.champ}, the park checkers champ`, t, icon: '♟️', mark: true });
}
function buildCart(cdef) {
  const g = place(cdef.at, 2.5); g.rotation.y = Math.random() * 6.28;
  box(1.8, 0.9, 0.9, std('#c53030', { roughness: 0.5 }), 0, 0.85, 0, g); box(1.85, 0.06, 0.95, std('#ddd', { metalness: 0.7, roughness: 0.3 }), 0, 1.33, 0, g);
  for (const sx of [-0.6, 0.6]) addMesh(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 14), std('#222'), sx, 0.3, 0.48, g).rotation.x = Math.PI / 2;
  box(0.05, 1.5, 0.05, std('#888'), 0, 2.05, 0, g);
  const um = addMesh(new THREE.ConeGeometry(1.3, 0.5, 8, 1, true), std('#f6e05e', { side: THREE.DoubleSide }), 0, 2.7, 0, g);
  const sg = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.35), new THREE.MeshStandardMaterial({ map: canvasTex(256, 56, c => { c.fillStyle = '#fff'; c.fillRect(0, 0, 256, 56); c.fillStyle = '#c53030'; c.font = 'bold 30px Segoe UI'; c.textAlign = 'center'; c.fillText('🌭 NORI-DOG', 128, 40); }, false) }));
  sg.position.set(0, 1.1, 0.46); g.add(sg); g.updateMatrixWorld(true);
  spots.push({ kind: 'cart', g, lx: 0, lz: 1.1, label: '🌭 Work the Nori-Dog cart for a lunch rush', icon: '🌭', mark: true });
}
let phoneGlow = null, trollEyes = null;
function buildPayphone() {
  const g = place(PAYPHONE, 1.2);
  box(0.12, 1.4, 0.12, std('#555'), 0, 0.7, 0, g); box(0.5, 0.75, 0.25, std('#2f6b4f', { emissive: '#39ff9a', emissiveIntensity: 0.25 }), 0, 1.45, 0.1, g);
  box(0.12, 0.3, 0.08, std('#111'), -0.12, 1.5, 0.26, g); box(0.18, 0.22, 0.02, std('#ccc', { metalness: 0.7 }), 0.1, 1.5, 0.23, g);
  phoneGlow = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 10), glowM('#39ff9a')); phoneGlow.position.set(0, 1.45, 0.1); g.add(phoneGlow);
  g.updateMatrixWorld(true); spots.push({ kind: 'payphone', g, lx: 0, lz: 0.7, label: '☎️ The payphone is ringing… answer it', hidden: true });
}
function buildHatch() {
  const g = place(HATCH, 1.5);
  box(1.2, 0.08, 1.2, std('#3a3a3a', { metalness: 0.6, roughness: 0.5 }), 0, 0.04, 0, g);
  for (let i = 0; i < 4; i++) box(0.9, 0.02, 0.06, new THREE.MeshBasicMaterial({ color: '#39ff9a' }), 0, 0.085, -0.4 + i * 0.27, g);
  const coon = new THREE.Group(); coon.position.set(0.35, 0.09, 0.3); g.add(coon);
  addMesh(new THREE.SphereGeometry(0.2, 10, 8), std('#6b6b6b'), 0, 0.2, 0, coon).scale.set(1, 0.9, 1.3); addMesh(new THREE.SphereGeometry(0.13, 10, 8), std('#7a7a7a'), 0, 0.38, 0.2, coon);
  box(0.24, 0.05, 0.02, std('#111'), 0, 0.4, 0.32, coon); for (let i = 0; i < 4; i++) addMesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8), std(i % 2 ? '#222' : '#aaa'), 0, 0.15, -0.3 - i * 0.09, coon).rotation.x = Math.PI / 2;
  g.updateMatrixWorld(true); spots.push({ kind: 'hatch', g, lx: 0, lz: 0, label: '🕳️ A hatch with green light leaking out… climb down', hidden: true });
}
function buildTroll() {
  // look under the bridge for dry ground with a deck high overhead
  const [sx, sz] = toXZ(...TROLL_SEARCH); let best = null, bs = -1;
  for (let dx = -300; dx <= 300; dx += 6) for (let dz = -300; dz <= 300; dz += 6) { const x = sx + dx, z = sz + dz; if (blocked(x, z, 1.5)) continue; const gap = surfaceY(x, z, 1e9) - groundY(x, z); if (gap < 7 || gap > 30) continue; const s = Math.min(gap, 12) - Math.hypot(dx, dz) * 0.01; if (s > bs) { bs = s; best = [x, z]; } }
  const [x, z] = best || openSpot(sx, sz, 1.5); const g = new THREE.Group(); g.position.set(x, groundAt(x, z), z); scene.add(g);
  const skin = std('#5b7a4a', { roughness: 0.9 });
  const b = addMesh(new THREE.SphereGeometry(0.9, 12, 10), skin, 0, 0.9, 0, g); b.scale.set(1.1, 1, 0.9);
  addMesh(new THREE.SphereGeometry(0.5, 12, 10), skin, 0, 1.9, 0.25, g); addMesh(new THREE.ConeGeometry(0.12, 0.35, 8), skin, 0, 1.85, 0.75, g).rotation.x = Math.PI / 2;
  for (const s of [-1, 1]) { addMesh(new THREE.SphereGeometry(0.2, 8, 6), skin, s * 0.5, 2.2, 0.1, g).scale.set(0.5, 1.4, 0.5); addMesh(new THREE.SphereGeometry(0.25, 8, 6), skin, s * 0.85, 0.6, 0.45, g); }
  trollEyes = []; for (const s of [-1, 1]) { const e = addMesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffe066' }), s * 0.18, 2.0, 0.68, g, false); trollEyes.push(e); }
  box(0.25, 0.35, 0.25, std('#333', { emissive: '#ffb347', emissiveIntensity: 1 }), 1.1, 0.18, 0.4, g);
  const gl = new THREE.Mesh(new THREE.SphereGeometry(0.8, 12, 8), glowM('#ffb347')); gl.position.set(1.1, 0.3, 0.4); g.add(gl);
  g.rotation.y = Math.random() * 6.28; g.updateMatrixWorld(true);
  spots.push({ kind: 'troll', g, lx: 0, lz: 1.6, label: '🧌 "WHO DISTURBS THE TROLL?" (talk to the troll)', hidden: true });
}
// fishing: from the far end of any real pier or dock that sticks out over the sea
function findPierTips() {
  const ow = (x, z) => isWater(x, z) && waterLevel(x, z) === 0;
  for (const ar of window.MAP.areas) {
    if (ar.k !== 'pier' || !ar.line) continue; const p = ar.p, n = p.length;
    for (const [i, j] of [[0, 2], [n - 2, n - 4]]) { if (j < 0 || j >= n) continue; const x = p[i], z = p[i + 1]; if (!ow(x, z)) continue; const dx = x - p[j], dz = z - p[j + 1], L = Math.hypot(dx, dz) || 1; const tx = x - dx / L * 1.5, tz = z - dz / L * 1.5; if (pierTips.some(t => Math.hypot(t.x - tx, t.z - tz) < 30)) continue; pierTips.push({ x: tx, z: tz }); }
  }
}
// pubs: a chalkboard on the sidewalk outside nearby pubs and bars (built lazily near you)
const PUBK = new Set(['pub', 'bar']);
const pubList = pois.filter(p => PUBK.has(p.k));
let boardGeo = null, boardMat = null, pubT = 0;
function updatePubBoards() {
  pubT -= G.dt || 0.016; if (pubT > 0) return; pubT = 1.5;
  if (!boardMat) { boardGeo = new THREE.BoxGeometry(0.6, 0.9, 0.05); boardMat = [std('#3b2416'), std('#3b2416'), std('#3b2416'), std('#3b2416'), new THREE.MeshStandardMaterial({ map: canvasTex(96, 144, c => { c.fillStyle = '#1f2a24'; c.fillRect(0, 0, 96, 144); c.fillStyle = '#fff'; c.font = 'bold 15px Segoe UI'; c.textAlign = 'center'; c.fillText('TONIGHT', 48, 26); c.font = '28px Segoe UI Emoji'; c.fillText('🎯', 48, 62); c.font = 'bold 13px Segoe UI'; c.fillText('DARTS', 48, 82); c.font = '24px Segoe UI Emoji'; c.fillText('❓', 48, 112); c.font = 'bold 13px Segoe UI'; c.fillText('TRIVIA', 48, 132); }, false) }), std('#3b2416')]; }
  for (const [p, b] of pubBoards) if (Math.hypot(p.x - pl.x, p.z - pl.z) > 260) { scene.remove(b.m); pubBoards.delete(p); const i = spots.indexOf(b.s); if (i >= 0) spots.splice(i, 1); }
  for (const p of pubList) {
    if (pubBoards.size > 24) break; if (pubBoards.has(p) || Math.hypot(p.x - pl.x, p.z - pl.z) > 200) continue;
    const [x, z] = openSpot(p.x, p.z, 0.8); if (Math.hypot(x - p.x, z - p.z) > 25) { pubBoards.set(p, { m: new THREE.Object3D(), s: null }); continue; }
    const m = new THREE.Mesh(boardGeo, boardMat); m.position.set(x, walkY(x, z) + 0.45, z); m.rotation.y = Math.atan2(x - p.x, z - p.z); m.rotation.x = -0.12; scene.add(m);
    const s = { kind: 'pub', x: x + Math.sin(m.rotation.y) * 0.9, z: z + Math.cos(m.rotation.y) * 0.9, y: m.position.y - 0.45, label: `🎯 Darts / ❓ trivia night${p.name ? ' at ' + p.name : ''}`, p }; spots.push(s); pubBoards.set(p, { m, s });
  }
}

// ---------- init / update / prompt ----------
export function initMinigames(player) {
  pl = player; buildOverlay();
  const safe = (f, ...a) => { try { f(...a); } catch (e) { console.warn('minigames:', e); } };
  for (const k of KIOSKS) safe(buildKiosk, k);
  for (const b of BUSK) safe(buildBusk, b);
  for (const t of TABLES) safe(buildTable, t);
  for (const c of CARTS) safe(buildCart, c);
  safe(buildPayphone); safe(buildHatch); safe(buildTroll); safe(findPierTips);
  for (const s of spots) { const v = new THREE.Vector3(s.lx, 0, s.lz).applyMatrix4(s.g.matrixWorld); s.x = v.x; s.z = v.z; s.y = s.g.position.y; }
}
let scrT = 0, ringT = 0;
export function updateMinigames(dt, player) {
  if (!pl) return;
  updateHunt(dt); updatePubBoards();
  scrT -= dt; if (scrT < 0) { scrT = 0.25; const near = new Set(); for (const s of spots) if (s.kind === 'cab' && screens[s.id] && Math.hypot(s.x - pl.x, s.z - pl.z) < 40) near.add(s.id); for (const id of near) drawScreen(id, G.t); }
  if (phoneGlow) { const d = Math.hypot(phoneGlow.parent.position.x - pl.x, phoneGlow.parent.position.z - pl.z); phoneGlow.material.opacity = 0.2 + 0.2 * Math.abs(Math.sin(G.t * 3)); ringT -= dt; if (d < 30 && MG.hunt === 0 && ringT < 0) { ringT = 2.5; beep([1400, 1100, 1400, 1100], 0.08, 'square', 0.025, 0.09); } }
  if (trollEyes) for (const e of trollEyes) e.visible = Math.sin(G.t * 0.7) > -0.95;
  if (MG.hunt >= 1 && MG.hunt <= RIDDLES.length && !activeMission()) { const o = document.getElementById('objective'); if (o && o.classList.contains('hidden')) ui.objective(huntText()); }
}
export function minigameMarkers() {
  const out = []; for (const s of spots) if (s.mark && !s.hidden) out.push({ x: s.x, z: s.z, icon: s.icon });
  let n = 0; for (const t of [...pierTips].sort((a, b) => Math.hypot(a.x - pl.x, a.z - pl.z) - Math.hypot(b.x - pl.x, b.z - pl.z))) { if (n++ >= 6 || Math.hypot(t.x - pl.x, t.z - pl.z) > 2000) break; out.push({ x: t.x, z: t.z, icon: '🎣' }); }
  return out;
}
const busy = () => { if (activeMission()) { ui.toast('Busy!', 'Finish your mission first.', 1500); return true; } return false; };
export function minigamePrompt(player) {
  if (!pl || run || player.vehicle || player.transit || G.dialogOpen || activeMission()) return '';   // missions come first: no games (or prompts in the way) mid-mission
  let best = null, bd = 2.2;
  for (const s of spots) { const d = Math.hypot(s.x - player.x, s.z - player.z); if (s.y !== undefined && Math.abs(player.y - s.y) > 3) continue; if (d < (s.kind === 'troll' ? 3 : s.kind === 'hatch' ? 1.6 : bd) && d < (best ? best.d : 99)) { best = s; best.d = d; } }
  if (!best) {
    if (player.y > 0.8) for (const t of pierTips) if (Math.hypot(t.x - player.x, t.z - player.z) < 4) { if (tapped('KeyE') && !busy()) openGame('fishing'); return '<kbd>E</kbd> 🎣 Cast a line off the end of the pier'; }
    return '';
  }
  const s = best; if (!tapped('KeyE')) return `<kbd>E</kbd> ${s.label}`;
  if (busy()) return `<kbd>E</kbd> ${s.label}`;
  if (s.kind === 'cab') openGame(s.id, { cost: s.id === 'claw' ? 2 : 1 });
  else if (s.kind === 'busk') openGame('busk', { inst: s.b.inst, title: '🎸 Busking at ' + s.b.name });
  else if (s.kind === 'table') openGame('checkers', { champ: s.t.champ });
  else if (s.kind === 'cart') openGame('hotdog');
  else if (s.kind === 'pub') ui.dialog(`🍺 ${s.p.name || 'The pub'}`, pick(['The chalkboard says: DARTS LEAGUE (all welcome) · TRIVIA NIGHT (free, cash prizes).', 'Somebody\'s dog is asleep under the dartboard. The quizmaster is tuning a microphone.']), ['🎯 Play darts ($2)', '❓ Trivia night', 'Not now']).then(i => { if (i === 0) openGame('darts', { cost: 2 }); else if (i === 1) trivia(s.p.name); });
  else if (s.kind === 'payphone') {
    if (MG.hunt === 0 || MG.hunt === 99) { const again = MG.hunt === 99; ui.dialog('☎️ …click… "Hello?"', again ? 'Heavy breathing. Then: "You already found my treasure, detective. Go outside. Touch grass. Find more secrets." *click*' : 'A crackly voice: "Finally, someone picked up. I hid a treasure in this city. Six clues. Solve them and it\'s yours." *click*', ['Hang up']).then(() => { if (!again) { MG.hunt = 1; MG.huntT = 0; ui.toast('☎️ Clue 1', RIDDLES[0][1], 6500); } }); }
    else ui.dialog('☎️ Dial tone', `A recorded voice repeats clue ${MG.hunt}: "${RIDDLES[MG.hunt - 1][1]}"`, ['OK']);
  }
  else if (s.kind === 'hatch') { discover('basement'); ui.dialog('🕳️ The hatch creaks open…', 'You climb down a rusty ladder into a forgotten basement. Dust, a lava lamp, a sleeping raccoon… and one glowing arcade cabinet nobody has played since 1994. The coin slot is taped over: free play!', ['Play RACCOON RUN', 'Climb back up']).then(i => { if (i === 0) openGame('raccoon'); }); }
  else if (s.kind === 'troll') openGame('troll');
  return `<kbd>E</kbd> ${s.label}`;
}
export const _mg = { GAMES, spots, pierTips, MG, openGame, closeGame, get run() { return run; }, trivia, RIDDLES };
