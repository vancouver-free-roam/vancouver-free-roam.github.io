// Tiny synthesized sound effects (no files needed).
let ac = null, eng = null;
export const sound = { muted: false };
export function initAudio() {
  if (ac) return;
  try {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    const o1 = ac.createOscillator(), o2 = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
    o1.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.frequency.value = 500; g.gain.value = 0;
    o1.connect(f); o2.connect(f); f.connect(g); g.connect(ac.destination); o1.start(); o2.start();
    eng = { o1, o2, f, g };
  } catch (e) { ac = null; }
}
export function engine(on, speed, kind = 'car') {
  if (!eng) return;
  const t = ac.currentTime;
  const base = { car: 45, motorbike: 70, heli: 22, plane: 55, jetski: 60, bus: 35 }[kind] ?? 45;
  const f = base + speed * (kind === 'heli' ? 0.4 : 3);
  eng.o1.frequency.setTargetAtTime(f, t, 0.08); eng.o2.frequency.setTargetAtTime(f * (kind === 'heli' ? 4 : 0.5), t, 0.08);
  eng.f.frequency.setTargetAtTime(kind === 'heli' ? 300 : 500, t, 0.1);
  eng.g.gain.setTargetAtTime(on && !sound.muted ? (kind === 'heli' ? 0.06 : 0.03 + Math.min(speed, 40) * 0.0012) : 0, t, 0.12);
}
export function beep(freqs, dur = 0.2, type = 'square', vol = 0.06, gap = 0) {
  if (!ac || sound.muted) return;
  freqs.forEach((fr, i) => {
    const o = ac.createOscillator(), g = ac.createGain(), t0 = ac.currentTime + i * gap;
    o.type = type; o.frequency.value = fr; g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ac.destination); o.start(t0); o.stop(t0 + dur + 0.05);
  });
}
export function noise(dur = 0.3, vol = 0.1, freq = 800) {
  if (!ac || sound.muted) return;
  const b = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = b; f.type = 'lowpass'; f.frequency.value = freq; g.gain.value = vol; s.connect(f); f.connect(g); g.connect(ac.destination); s.start();
}
// a soft water 'shhhh': fades in and out (no click), band-passed high like real spray
export function swish(dur = 0.45, vol = 0.06, freq = 3000, attack = 0.04) {
  if (!ac || sound.muted) return;
  const b = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain(), t = ac.currentTime;
  src.buffer = b; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.7;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(freq * 0.55, t + dur);   // the spray settles
  src.connect(f); f.connect(g); g.connect(ac.destination); src.start(t); src.stop(t + dur + 0.05);
}
// looping rain hiss
let rainNode = null;
export function rainVolume(v) {
  if (!ac) return;
  if (!rainNode) {
    const b = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = b; s.loop = true; f.type = 'bandpass'; f.frequency.value = 2500; f.Q.value = 0.4; g.gain.value = 0;
    s.connect(f); f.connect(g); g.connect(ac.destination); s.start(); rainNode = g;
  }
  rainNode.gain.setTargetAtTime(sound.muted ? 0 : v * 0.09, ac.currentTime, 0.5);
}
export const sfx = {
  thunder: (delay = 0) => setTimeout(() => { noise(3.2, 0.45, 140); noise(1.2, 0.25, 600); }, delay * 1000),
  splashBig: (speed = 12) => swish(0.35 + Math.min(0.35, speed * 0.012), 0.025 + Math.min(0.05, speed * 0.0022), 2600 + Math.min(1600, speed * 50)),   // driving through a puddle
  shutter: () => beep([1800, 1200], 0.05, 'square', 0.05, 0.06),
  horn: (k = 1) => beep([415, 523], 0.45, 'square', 0.05 * k),
  bikeBell: () => beep([2100, 2100], 0.12, 'sine', 0.06, 0.15),
  chime: () => beep([523, 659, 784, 1047], 0.25, 'triangle', 0.08, 0.1),
  coin: () => beep([988, 1319], 0.12, 'square', 0.05, 0.08),
  bump: () => noise(0.18, 0.18, 300),
  splash: () => noise(0.6, 0.18, 1200),
  swing: () => noise(0.12, 0.08, 2500),
  thwack: () => { noise(0.1, 0.2, 600); beep([120], 0.1, 'sine', 0.15); },
  steamWhistle: () => beep([392, 494, 587, 784, 587], 0.5, 'sine', 0.07, 0.35),
  gun: () => { noise(1.2, 0.35, 200); },
  fail: () => beep([300, 220], 0.3, 'sawtooth', 0.05, 0.25),
};
