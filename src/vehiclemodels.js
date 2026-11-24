// Real-world vehicle catalogue. Every model is a parody name (house rule: no real brands) on top of REAL data from the
// manufacturer spec sheets / road tests: weight, wheelbase, 0–100 km/h (or 0–50) time, top speed, drivetrain, power.
// vehicles.js turns each entry into a driving model:
//   - calibrate(): finds the engine power (W per kg at the wheels) that reproduces the real 0–100 time in the game's own
//     physics (traction limit by drivetrain, aero drag, rolling resistance), then sets the drag so the real top speed is
//     exactly where the power runs out. So a Westfalia really takes ~18 s to 100 and a Corvette ~2.5 s (ARC: the game runs
//     everything 20% quicker than real life, like most driving games do, while keeping the real ranking).
//   - handling: wb (real wheelbase, m) for the turning circle, mu (tyre grip in g) for the cornering limit (more = corners
//     faster before it understeers), resp (how quickly the wheel turns), soft (body roll/dive), brk (braking, m/s²),
//     drive (fwd/rwd/awd: launch traction, snow, power-oversteer drifts), snow (grip multiplier on snow).
//   - sound: gears, pitch (engine size), ev (electric whine), hyb (hybrid: silent at low speed).
//   - spawning: tw (traffic weight), pw (curbside parked weight), when(ctx) extra rules, cols (paint), body (shape tweaks
//     on top of the base body in vehicles.js SPECS), x (extras: spoiler, rack, kayak, spare, stripes, share, westy…).
// Two-wheelers, boats and aircraft use the same idea with fewer fields (style = which model shape to build).

const WHITE = ['#f2f2f0', '#e9eaec'], BLACK = ['#16181b', '#1f2226'], GREY = ['#b9bcc0', '#a7abb0', '#6b7076', '#5a5f66', '#3d4248'];
const EVERYDAY = [...WHITE, ...WHITE, ...BLACK, ...BLACK, ...GREY, ...GREY, '#1f3a5f', '#2b4c7e', '#8f1d21', '#a32a26', '#3b4a3f', '#6b5b45'];

export const MODELS = {
  // ---------------- everyday cars ----------------
  civic: { base: 'car', name: 'Hondo Civix', real: 'Honda Civic', hp: 158, kg: 1330, z100: 8.2, top: 200, wb: 2.735, drive: 'fwd', mu: 0.9, resp: 1.05, soft: 1, brk: 9.0, gears: 6, pitch: 1.05,
    tw: 10, pw: 10, cols: [...EVERYDAY, '#2a5db0', '#c53030'], body: { L: 4.67 }, fact: 'Canada\'s best-selling car for over 20 years in a row.' },
  corolla: { base: 'car', name: 'Toyoda Koala', real: 'Toyota Corolla', hp: 169, kg: 1380, z100: 8.5, top: 180, wb: 2.70, drive: 'fwd', mu: 0.88, resp: 1, soft: 1, brk: 8.8, gears: 6, pitch: 1.05,
    tw: 9, pw: 9, cols: EVERYDAY, body: { L: 4.63 }, fact: 'The best-selling car in history: more than 50 million built.' },
  elantra: { base: 'car', name: 'Hyundy Elantro', real: 'Hyundai Elantra', hp: 147, kg: 1300, z100: 8.9, top: 195, wb: 2.72, drive: 'fwd', mu: 0.87, resp: 1, soft: 1, brk: 8.8, gears: 6, pitch: 1.05,
    tw: 6, pw: 6, cols: EVERYDAY, body: { L: 4.68, nose: 0.72, ws: 0.9, roofL: 1.3, rw: 0.75 } },
  mazda3: { base: 'car', name: 'Mazdah Tree', real: 'Mazda3 hatchback', hp: 186, kg: 1400, z100: 7.6, top: 210, wb: 2.725, drive: 'fwd', mu: 0.93, resp: 1.15, soft: 0.9, brk: 9.2, gears: 6, pitch: 1.0,
    tw: 5, pw: 5, cols: [...EVERYDAY, '#9b111e', '#9b111e', '#6e7a86'], body: { L: 4.46, tail: 1.0, hood: 1.15, ws: 0.8, roofL: 1.45, rw: 0.62 }, fact: 'Mazda\'s "Soul Red" paint takes three separate colour layers.' },
  prius: { base: 'car', name: 'Toyoda Pious', real: 'Toyota Prius (hybrid)', hp: 194, kg: 1420, z100: 7.2, top: 180, wb: 2.75, drive: 'fwd', mu: 0.86, resp: 1, soft: 1, brk: 8.6, gears: 1, hyb: true,
    tw: 5, pw: 4, cols: [...WHITE, ...GREY, '#1f3a5f', '#16181b'], body: { L: 4.6, nose: 0.66, hood: 1.0, ws: 1.05, roofL: 1.15, rw: 0.95, roofH: 1.42 }, fact: 'Hybrids run on the electric motor alone at low speed: listen for the silence.' },
  evoh: { base: 'car', name: 'Ev-Oh car share', real: 'Toyota Prius (car-share fleet)', hp: 194, kg: 1420, z100: 7.4, top: 180, wb: 2.75, drive: 'fwd', mu: 0.86, resp: 1, soft: 1, brk: 8.6, gears: 1, hyb: true,
    tw: 3, pw: 4, cols: ['#f4f6f8'], body: { L: 4.6, nose: 0.66, hood: 1.0, ws: 1.05, roofL: 1.15, rw: 0.95, roofH: 1.42 }, x: ['share', 'rack'], share: true,
    fact: 'Vancouver has one of the biggest free-floating car-share fleets in North America.' },
  model3: { base: 'car', name: 'Teslo Model Tree', real: 'Tesla Model 3 Long Range', hp: 425, kg: 1830, z100: 4.4, top: 201, wb: 2.875, drive: 'awd', mu: 0.95, resp: 1.1, soft: 0.8, brk: 9.4, ev: true,
    tw: 5, pw: 5, cols: [...WHITE, ...BLACK, '#a7abb0', '#1f3a7a', '#9b111e'], body: { L: 4.72, W: 1.85, nose: 0.66, hood: 1.15, ws: 1.05, roofL: 1.2, rw: 0.95, roofH: 1.44 }, x: ['nogrille'],
    fact: 'All of an electric motor\'s pull is there from zero: no waiting for revs.' },
  camrytaxi: { base: 'taxi', name: 'Yellah Cab (Camree Hybrid)', real: 'Toyota Camry Hybrid taxi', hp: 208, kg: 1600, z100: 7.8, top: 180, wb: 2.825, drive: 'fwd', mu: 0.86, resp: 0.95, soft: 1.1, brk: 8.6, gears: 1, hyb: true,
    tw: 4, pw: 0, cols: ['#f2c230'], fact: 'Most Vancouver cabs are hybrids: they idle in traffic all day.' },
  blacktaxi: { base: 'taxi', name: 'Black Hat Cabs', real: 'Toyota Camry Hybrid taxi', hp: 208, kg: 1600, z100: 7.8, top: 180, wb: 2.825, drive: 'fwd', mu: 0.86, resp: 0.95, soft: 1.1, brk: 8.6, gears: 1, hyb: true,
    tw: 2, pw: 0, cols: ['#15161a'] },
  // ---------------- hot hatches & sports ----------------
  gti: { base: 'car', name: 'Volksvagon Gulf GTEye', real: 'Volkswagen Golf GTI', hp: 241, kg: 1430, z100: 6.3, top: 250, wb: 2.63, drive: 'fwd', mu: 1.0, resp: 1.25, soft: 0.75, brk: 9.8, gears: 7, pitch: 1.1,
    tw: 2, pw: 2, cols: ['#c53030', '#f2f2f0', '#16181b', '#3d4248', '#2b4c7e'], body: { L: 4.29, W: 1.79, tail: 1.02, hood: 1.05, ws: 0.75, roofL: 1.55, rw: 0.55, roofH: 1.44 }, x: ['spoilerS'],
    fact: 'The original "hot hatch" (1976): a family car with a sports car engine.' },
  wrx: { base: 'car', name: 'Subaroo WRX', real: 'Subaru WRX', hp: 271, kg: 1580, z100: 5.5, top: 240, wb: 2.67, drive: 'awd', mu: 1.02, resp: 1.2, soft: 0.8, brk: 9.8, gears: 6, pitch: 0.95, snow: 1.35, drift: 1.3,
    tw: 1.5, pw: 1.5, cols: ['#1f4fa0', '#1f4fa0', '#f2f2f0', '#3d4248', '#16181b'], body: { L: 4.67 }, x: ['spoiler', 'scoop'], fact: 'Built for rally racing: four-wheel drive on gravel, mud and snow.' },
  gr86: { base: 'sports', name: 'Toyoda GR-Hate-Six', real: 'Toyota GR86', hp: 228, kg: 1290, z100: 6.1, top: 226, wb: 2.575, drive: 'rwd', mu: 1.0, resp: 1.35, soft: 0.7, brk: 9.8, gears: 6, pitch: 1.1, drift: 1.6,
    tw: 1, pw: 1, cols: ['#c53030', '#f2f2f0', '#16181b', '#3d6fb4'], body: { L: 4.27, W: 1.78, hood: 1.35, ws: 0.85, roofL: 0.8, rw: 0.9, roofH: 1.31 }, x: ['spoilerS'], fact: 'A light rear-wheel-drive coupe: the favourite starter car for drifting.' },
  miata: { base: 'sports', name: 'Mazdah MX-5 Miyata', real: 'Mazda MX-5 Miata', hp: 181, kg: 1060, z100: 5.7, top: 220, wb: 2.31, drive: 'rwd', mu: 1.0, resp: 1.5, soft: 0.8, brk: 9.8, gears: 6, pitch: 1.15, drift: 1.4,
    tw: 1, pw: 1.5, cols: ['#9b111e', '#f2f2f0', '#16181b', '#2b4c7e', '#d9d2c0'], body: { L: 3.92, W: 1.73, belt: 0.82, nose: 0.6, tail: 0.8, hood: 1.35, ws: 0.65, roofL: 0.55, rw: 0.45, roofH: 1.23 },
    when: c => c.summer ? 3 : c.winter ? 0.2 : 1, fact: 'The best-selling two-seat sports car ever. The answer is always Miata.' },
  mustang: { base: 'sports', name: 'Forde Mustank GT', real: 'Ford Mustang GT (V8)', hp: 480, kg: 1750, z100: 4.5, top: 250, wb: 2.72, drive: 'rwd', mu: 0.98, resp: 1.05, soft: 0.85, brk: 9.6, gears: 6, pitch: 0.7, vol: 1.4, drift: 1.5,
    tw: 1.5, pw: 1.5, cols: ['#16181b', '#c53030', '#1f3a7a', '#f2f2f0', '#f6c400', '#3d4248'], body: { L: 4.81, W: 1.92, belt: 0.95, nose: 0.78, tail: 0.95, hood: 1.7, ws: 0.85, roofL: 0.85, rw: 1.0, roofH: 1.38 }, x: ['stripes', 'spoilerS'],
    fact: 'A V8 "muscle car": loads of power, rear-wheel drive. The tail likes to step out.' },
  p911: { base: 'sports', name: 'Porscha 912', real: 'Porsche 911 Carrera', hp: 379, kg: 1505, z100: 4.2, top: 293, wb: 2.45, drive: 'rwd', mu: 1.1, resp: 1.3, soft: 0.6, brk: 10.4, gears: 8, pitch: 1.2,
    tw: 0.8, pw: 1, cols: ['#f2f2f0', '#b9bcc0', '#16181b', '#e6b400', '#2f7a5f', '#c53030'], body: { L: 4.52, W: 1.85, nose: 0.62, tail: 0.82, hood: 1.25, ws: 0.9, roofL: 0.7, rw: 1.35, roofH: 1.3 }, x: ['spoilerS'],
    when: c => c.rich ? 3 : 1, fact: 'Its engine hangs out behind the back wheels, a design kept since 1964.' },
  corvette: { base: 'sports', name: 'Chevrolay Corvet', real: 'Chevrolet Corvette Stingray (C8)', hp: 495, share: 0.88, kg: 1530, z100: 3.0, top: 312, wb: 2.72, drive: 'rwd', mu: 1.12, resp: 1.2, soft: 0.6, brk: 10.4, gears: 8, pitch: 0.72, vol: 1.4,
    tw: 0.4, pw: 0.5, cols: ['#c53030', '#f6c400', '#16181b', '#f2f2f0', '#1f6fd0'], body: { L: 4.63, W: 1.93, belt: 0.82, nose: 0.55, tail: 0.86, hood: 1.1, ws: 1.0, roofL: 0.8, rw: 1.4, roofH: 1.23 }, x: ['spoilerS'],
    when: c => c.rich ? 2 : 1, fact: 'The first Corvette with the engine behind the driver (2020).' },
  lambo: { base: 'sports', name: 'Lambo-ghini Hurry-can', real: 'Lamborghini Huracán EVO', hp: 631, kg: 1422, z100: 2.9, top: 325, wb: 2.62, drive: 'awd', mu: 1.18, resp: 1.3, soft: 0.5, brk: 11, gears: 7, pitch: 0.95, vol: 1.6, rare: true,
    tw: 0.12, pw: 0.1, cols: ['#8fd400', '#f6a800', '#e85d04', '#16181b', '#f2f2f0', '#7b2cbf'], body: { L: 4.52, W: 1.93, belt: 0.8, nose: 0.5, tail: 0.85, hood: 1.15, ws: 1.05, roofL: 0.7, rw: 1.25, roofH: 1.16 }, x: ['spoilerS'],
    when: c => (c.rich ? 6 : 1) * (c.night ? 2 : 1), fact: 'Coal Harbour is famous for supercars: summer nights, they come out to cruise.' },
  delorian: { base: 'sports', name: 'DeLorian DMC-12', real: 'DeLorean DMC-12 (1981)', hp: 130, kg: 1230, z100: 10.5, top: 175, wb: 2.41, drive: 'rwd', mu: 0.85, resp: 1.0, soft: 0.9, brk: 8.2, gears: 5, pitch: 0.95, rare: true,
    tw: 0.06, pw: 0.04, cols: ['#b8bcc0'], metal: true, body: { L: 4.27, W: 1.86, belt: 0.85, nose: 0.62, tail: 0.9, hood: 1.25, ws: 0.8, roofL: 0.8, rw: 0.9, roofH: 1.14 }, x: ['louvers'],
    fact: 'Brushed stainless-steel body panels, never painted. Only about 9,000 were built.' },
  // ---------------- SUVs, crossovers, wagons, minivans ----------------
  rav4: { base: 'suv', name: 'Toyoda RAF-4', real: 'Toyota RAV4', hp: 203, kg: 1600, z100: 8.4, top: 180, wb: 2.69, drive: 'awd', mu: 0.84, resp: 0.95, soft: 1.25, brk: 8.6, gears: 8, pitch: 1.0, snow: 1.4,
    tw: 9, pw: 9, cols: EVERYDAY, body: { L: 4.6, W: 1.86, belt: 1.1, roofH: 1.7, ws: 0.7, roofL: 2.0, rw: 0.35 }, x: ['rack'], fact: 'Canada\'s best-selling SUV.' },
  crv: { base: 'suv', name: 'Hondo CR-Vee', real: 'Honda CR-V', hp: 190, kg: 1600, z100: 8.5, top: 190, wb: 2.70, drive: 'awd', mu: 0.84, resp: 0.95, soft: 1.25, brk: 8.6, gears: 1, pitch: 1.05, snow: 1.35,
    tw: 7, pw: 7, cols: EVERYDAY, body: { L: 4.7, W: 1.87, belt: 1.08, roofH: 1.68, ws: 0.75, roofL: 1.95, rw: 0.4 } },
  outback: { base: 'suv', name: 'Subaroo Outbak', real: 'Subaru Outback', hp: 182, kg: 1700, z100: 8.7, top: 200, wb: 2.745, drive: 'awd', mu: 0.86, resp: 1, soft: 1.15, brk: 8.8, gears: 1, pitch: 0.92, snow: 1.55,
    tw: 6, pw: 6, cols: [...EVERYDAY, '#3f5a46', '#3f5a46', '#5d6b7a'], body: { L: 4.87, W: 1.86, belt: 1.0, nose: 0.85, tail: 1.0, hood: 1.1, ws: 0.75, roofL: 2.25, rw: 0.35, roofH: 1.67, wr: 0.36 }, x: ['rack', 'kayak?'],
    when: c => c.mountain ? 4 : c.north ? 2 : 1, fact: 'BC\'s unofficial car. Kayak on the roof, dog in the back, going to Squamish.' },
  modely: { base: 'suv', name: 'Teslo Model Why', real: 'Tesla Model Y Long Range', hp: 384, kg: 1980, z100: 5.0, top: 217, wb: 2.89, drive: 'awd', mu: 0.92, resp: 1.05, soft: 0.95, brk: 9.2, ev: true, snow: 1.3,
    tw: 5, pw: 5, cols: [...WHITE, ...BLACK, '#a7abb0', '#1f3a7a', '#9b111e'], body: { L: 4.75, W: 1.92, belt: 1.05, nose: 0.75, hood: 1.1, ws: 1.0, roofL: 1.5, rw: 0.85, roofH: 1.62 }, x: ['nogrille'],
    when: c => c.rich ? 2 : 1, fact: 'BC has the highest share of new electric cars in North America.' },
  ioniq5: { base: 'suv', name: 'Hyundy Ionic Five', real: 'Hyundai Ioniq 5 AWD', hp: 320, kg: 2100, z100: 5.2, top: 185, wb: 3.0, drive: 'awd', mu: 0.9, resp: 1, soft: 1, brk: 9.0, ev: true, snow: 1.3,
    tw: 2, pw: 2, cols: ['#c9cdc6', '#e9eaec', '#16181b', '#7e8f7a', '#3d4248'], body: { L: 4.64, W: 1.89, belt: 1.05, nose: 0.82, tail: 1.05, hood: 1.0, ws: 0.85, roofL: 2.0, rw: 0.35, roofH: 1.6, wr: 0.38 }, x: ['nogrille'] },
  wrangler: { base: 'suv', name: 'Jeap Wrangle-R', real: 'Jeep Wrangler 4-door', hp: 285, kg: 1950, z100: 7.0, top: 180, wb: 3.01, drive: 'awd', mu: 0.74, resp: 0.85, soft: 1.5, brk: 8.0, gears: 8, pitch: 0.85, snow: 1.6,
    tw: 2, pw: 2.5, cols: ['#c53030', '#16181b', '#f2f2f0', '#3a5a40', '#e8a33c', '#2b6cb0', '#7c8a6a'], body: { L: 4.88, W: 1.89, belt: 1.15, nose: 1.05, tail: 1.2, hood: 1.15, ws: 0.3, roofL: 2.6, rw: 0.1, roofH: 1.85, cw: 0.95, wr: 0.43 }, x: ['spare'],
    when: c => c.mountain ? 3 : 1, fact: 'Removable doors and roof, and huge ground clearance. Feels like a boat in fast corners.' },
  rangerover: { base: 'suv', name: 'Strange Rover', real: 'Range Rover', hp: 395, kg: 2500, z100: 5.9, top: 225, wb: 3.0, drive: 'awd', mu: 0.88, resp: 0.85, soft: 1.15, brk: 9.0, gears: 8, pitch: 0.85, snow: 1.45,
    tw: 1.2, pw: 1.5, cols: ['#16181b', '#16181b', '#f2f2f0', '#3d4248', '#1a2b2a', '#8a8f96'], body: { L: 5.0, W: 2.0, belt: 1.2, nose: 1.05, tail: 1.15, hood: 1.25, ws: 0.6, roofL: 2.55, rw: 0.2, roofH: 1.87, cw: 0.93, wr: 0.42 },
    when: c => c.rich ? 6 : 1, fact: 'The unofficial car of West Vancouver.' },
  odyssey: { base: 'suv', name: 'Hondo Odd-yssey', real: 'Honda Odyssey minivan', hp: 280, kg: 2000, z100: 7.0, top: 180, wb: 3.0, drive: 'fwd', mu: 0.82, resp: 0.85, soft: 1.3, brk: 8.4, gears: 10, pitch: 0.95,
    tw: 3, pw: 4, cols: EVERYDAY, body: { L: 5.2, W: 1.99, belt: 1.05, nose: 0.85, tail: 1.05, hood: 0.85, ws: 1.05, roofL: 2.7, rw: 0.25, roofH: 1.75, wr: 0.36 },
    fact: 'Sliding doors, 8 seats, 14 cup holders and a vacuum cleaner built in.' },
  // ---------------- pickups ----------------
  f150: { base: 'pickup', name: 'Forde F-151', real: 'Ford F-150 (3.5 EcoBoost)', hp: 400, kg: 2250, z100: 6.0, top: 170, wb: 3.68, drive: 'awd', mu: 0.8, resp: 0.85, soft: 1.3, brk: 8.4, gears: 10, pitch: 0.8, snow: 1.4,
    tw: 5, pw: 5, cols: [...EVERYDAY, '#1f3a5f', '#8f1d21'], body: { L: 5.9, W: 2.03, belt: 1.25, nose: 1.15, tail: 1.2, hood: 1.4, ws: 0.6, roofL: 1.6, rw: 0.1, roofH: 1.96, wr: 0.44 }, x: ['bigGrille'],
    when: c => c.mountain ? 3 : 1, fact: 'Canada\'s best-selling vehicle of any kind, every year since the 1960s.' },
  ram: { base: 'pickup', name: 'Ramm 1500', real: 'Ram 1500 (5.7 HEMI V8)', hp: 395, kg: 2400, z100: 6.3, top: 170, wb: 3.67, drive: 'awd', mu: 0.8, resp: 0.82, soft: 1.3, brk: 8.2, gears: 8, pitch: 0.68, vol: 1.3, snow: 1.4,
    tw: 3, pw: 3, cols: [...EVERYDAY, '#5a2a2a'], body: { L: 5.92, W: 2.08, belt: 1.27, nose: 1.2, tail: 1.2, hood: 1.45, ws: 0.6, roofL: 1.6, rw: 0.1, roofH: 1.97, wr: 0.44 }, x: ['bigGrille'],
    when: c => c.mountain ? 2.5 : 1 },
  tacoma: { base: 'pickup', name: 'Toyoda Tacomuh', real: 'Toyota Tacoma', hp: 278, kg: 2050, z100: 7.8, top: 175, wb: 3.24, drive: 'awd', mu: 0.78, resp: 0.92, soft: 1.3, brk: 8.2, gears: 8, pitch: 0.9, snow: 1.45,
    tw: 3, pw: 3, cols: [...EVERYDAY, '#7c8a6a', '#c46a28'], body: { L: 5.4, W: 1.9, belt: 1.15, nose: 1.02, hood: 1.2, ws: 0.65, roofL: 1.45, roofH: 1.8, wr: 0.41 }, x: ['rack'],
    when: c => c.mountain ? 4 : c.north ? 2 : 1, fact: 'The mountain-bike-rack truck of the Sea-to-Sky.' },
  // ---------------- vans & trucks ----------------
  foodtruck: { base: 'van', name: 'Food truck', real: 'Ford step van (food truck)', hp: 350, kg: 6000, z100: 20, top: 120, wb: 4.0, drive: 'rwd', mu: 0.72, resp: 0.7, soft: 1.5, brk: 7.0, gears: 6, pitch: 0.7,
    tw: 1, pw: 1, cols: ['#e8e2d0'], x: ['foodtruck'] },
  sprinter: { base: 'van', name: 'Mercedez Sprintr', real: 'Mercedes-Benz Sprinter cargo van', hp: 188, kg: 2500, z100: 13, top: 160, wb: 4.33, drive: 'rwd', mu: 0.78, resp: 0.8, soft: 1.4, brk: 7.8, gears: 9, pitch: 0.9,
    tw: 3, pw: 2, cols: ['#f2f2f0', '#f2f2f0', '#f2f2f0', '#3d4248', '#1f3a5f'], body: { L: 5.93, W: 2.02, nose: 1.05, tail: 2.55, hood: 0.95, roofH: 2.6, roofL: 4.4, wr: 0.38 } },
  canadapest: { base: 'van', name: 'Canada Pest van', real: 'Ford Transit (postal fleet)', hp: 310, kg: 2600, z100: 11, top: 150, wb: 3.75, drive: 'rwd', mu: 0.78, resp: 0.8, soft: 1.4, brk: 7.8, gears: 10, pitch: 0.9,
    tw: 1.2, pw: 0.8, cols: ['#f2f2f0'], x: ['courier'], body: { L: 5.53, W: 2.06, nose: 1.0, tail: 2.5, hood: 0.95, roofH: 2.55, roofL: 4.1, wr: 0.38 }, fact: 'Canada\'s mail carriers deliver to about 17 million addresses.' },
  westy: { base: 'van', name: 'Volksvagon Westfailure', real: 'VW Westfalia T3 camper (1985)', hp: 95, kg: 1600, z100: 18, top: 130, wb: 2.46, drive: 'rwd', mu: 0.72, resp: 0.85, soft: 1.7, brk: 6.5, gears: 4, pitch: 1.2, rare: true,
    tw: 0.5, pw: 0.8, cols: ['#c97a2b', '#8fa58a', '#c44536', '#3d6f9e', '#d8c38a'], body: { L: 4.57, W: 1.85, belt: 1.05, nose: 0.95, tail: 1.95, hood: 0.05, ws: 0.6, roofL: 4.0, roofH: 1.95, wr: 0.35, wb: 0.75 }, x: ['westy'],
    when: c => (c.summer ? 3 : 1) * (c.mountain ? 2 : 1), fact: 'Surfers drive these to Tofino. Breakdowns are part of the trip.' },
  icecream: { base: 'van', name: 'Mr. Drippy ice cream truck', real: 'Chevrolet step van (ice cream truck)', hp: 300, kg: 4500, z100: 19, top: 115, wb: 3.8, drive: 'rwd', mu: 0.72, resp: 0.7, soft: 1.5, brk: 7.0, gears: 6, pitch: 0.75, rare: true,
    tw: 0.6, pw: 0.2, cols: ['#fbfbf7'], x: ['icecream'], body: { L: 5.6 }, when: c => c.summer && c.day ? 4 : 0, fact: 'It plays its jingle when it\'s near. Run!' },
  // ---------------- big & working vehicles ----------------
  nova: { base: 'bus', name: 'TransLynx bus', real: 'Nova Bus LFS (12 m)', hp: 280, kg: 12500, z50: 11, top: 100, wb: 6.2, drive: 'rwd', mu: 0.55, resp: 0.55, soft: 1.3, brk: 5.0, gears: 6, pitch: 0.6, tw: 1, pw: 0 },
  tug: { base: 'tug', name: 'Baggage tug', real: 'TLD baggage tractor', hp: 70, kg: 3800, zt: [7, 25], top: 30, wb: 1.9, drive: 'rwd', mu: 0.8, resp: 1, soft: 0.8, brk: 6, gears: 3, pitch: 0.9 },
  sled: { base: 'snowmobile', name: 'Skee-Doo Summit', real: 'Ski-Doo Summit 850', hp: 165, kg: 230, z100: 5.5, top: 130, wb: 1.6, drive: 'rwd', mu: 0.75, resp: 1.2, soft: 0.6, brk: 6.5, gears: 1, pitch: 1.45, snow: 1.2 },
  // ---------------- motorbikes ----------------
  ninja: { base: 'motorbike', style: 'sport', name: 'Kawasucky Ninja 400', real: 'Kawasaki Ninja 400', hp: 45, kg: 168, z100: 5.0, top: 190, wb: 1.37, drive: 'rwd', mu: 1.0, resp: 1.3, brk: 9.0, gears: 6, pitch: 1.8,
    tw: 1, pw: 1, cols: ['#3fae2a', '#16181b', '#c53030', '#f2f2f0'], fact: 'The classic first sport bike: light, revvy, forgiving.' },
  r1: { base: 'motorbike', style: 'sport', name: 'Yamahaha R-Won', real: 'Yamaha YZF-R1', hp: 197, kg: 201, z100: 3.0, top: 299, wb: 1.405, drive: 'rwd', mu: 1.08, resp: 1.35, brk: 10, gears: 6, pitch: 2.0, vol: 1.3,
    tw: 0.4, pw: 0.4, cols: ['#1f4fa0', '#16181b', '#f2f2f0'], fact: 'A superbike: it out-accelerates almost every car on Earth.' },
  fatboy: { base: 'motorbike', style: 'cruiser', name: 'Hardly-Davidsun Fat Boi', real: 'Harley-Davidson Fat Boy 114', hp: 94, kg: 317, z100: 4.6, top: 180, wb: 1.665, drive: 'rwd', mu: 0.85, resp: 0.85, brk: 8.0, gears: 6, pitch: 0.55, vol: 1.5,
    tw: 0.6, pw: 0.8, cols: ['#16181b', '#7a1f1f', '#3d4248', '#c9c9c9'], fact: 'A big V-twin cruiser: low, heavy and LOUD. Leans less in corners.' },
  gs: { base: 'motorbike', style: 'adv', name: 'BMV R 1250 GeeEss', real: 'BMW R 1250 GS Adventure', hp: 134, kg: 268, z100: 3.6, top: 215, wb: 1.5, drive: 'rwd', mu: 0.95, resp: 1.05, brk: 9.2, gears: 6, pitch: 1.0, snow: 1.3,
    tw: 0.5, pw: 0.6, cols: ['#f2f2f0', '#2b4c7e', '#3d4248', '#c46a28'], when: c => c.mountain ? 3 : 1, fact: 'The round-the-world motorbike: comfy, tall, happy on gravel.' },
  vespa: { base: 'motorbike', style: 'moped', name: 'Vesper Primavera', real: 'Vespa Primavera 150', hp: 13, kg: 130, z50: 4.6, top: 95, wb: 1.34, drive: 'rwd', mu: 0.85, resp: 1.25, brk: 7.5, gears: 1, pitch: 1.7, vol: 0.6,
    tw: 0.7, pw: 1.2, cols: ['#a8d5c2', '#f2e3b3', '#c53030', '#f2f2f0', '#7ab8e0'], fact: 'A pressed-steel Italian scooter. Perfect for Commercial Drive espresso runs.' },
  grom: { base: 'motorbike', style: 'mini', name: 'Hondo Grommet', real: 'Honda Grom 125', hp: 10, kg: 102, z50: 4.4, top: 92, wb: 1.2, drive: 'rwd', mu: 0.92, resp: 1.45, brk: 8.0, gears: 5, pitch: 2.0, vol: 0.7,
    tw: 0.4, pw: 0.6, cols: ['#c53030', '#f6c400', '#16181b', '#f2f2f0'], fact: 'A tiny 125 cc bike that makes adults giggle like kids.' },
  // ---------------- bicycles & small stuff (human-powered: max = cruising m/s, acc = push) ----------------
  mobee: { base: 'bike', style: 'share', name: 'Mobee share bike', real: 'Mobi share bike (3-speed, 23 kg)', max: 7.5, acc: 4.5, kg: 23, cols: ['#2b6cb0'], fact: 'Share bikes are heavy (23 kg) and upright: slow but unbreakable.' },
  roadbike: { base: 'bike', style: 'road', name: 'Treck Domain road bike', real: 'Trek Domane road bike (8 kg)', max: 11.5, acc: 7, kg: 8.5, turn: 0.75, cols: ['#c53030', '#16181b', '#f2f2f0', '#2b6cb0', '#d69e2e'], fact: 'Skinny tyres + drop bars: the fastest thing you can pedal.' },
  mtb: { base: 'bike', style: 'mtb', name: 'Rocky Mountainz Altitude', real: 'Rocky Mountain Altitude MTB (BC-made)', max: 9.5, acc: 6.5, kg: 14, turn: 1.0, hop: 7.5, snow: 0.7, cols: ['#2f855a', '#c46a28', '#16181b', '#3182ce', '#805ad5'], fact: 'North Shore mountain biking was invented on these trails in the 1980s.' },
  cargo: { base: 'bike', style: 'cargo', name: 'Urban Arrow-ish cargo e-bike', real: 'Urban Arrow cargo e-bike (BC limit 32 km/h)', max: 8.9, acc: 5.5, kg: 50, turn: 0.7, assist: true, cols: ['#16181b', '#2f855a', '#e2e8f0'], fact: 'Families haul two kids AND the groceries. E-bikes in BC are limited to 32 km/h.' },
  ebike: { base: 'bike', style: 'ebike', name: 'MEC-Nope e-bike', real: 'Commuter e-bike (500 W, 32 km/h assist)', max: 8.9, acc: 8, kg: 24, assist: true, cols: ['#2b6cb0', '#16181b', '#c53030'], fact: 'The motor helps up to 32 km/h (the BC legal limit); faster than that is your legs.' },
  lyme: { base: 'scooter', name: 'Lyme e-scooter', real: 'Lime Gen-4 share scooter (25 km/h)', max: 9.5, acc: 5.5, kg: 24, cols: ['#7cc242'] },
  skate: { base: 'skate', name: 'Skateboard', real: 'Street skateboard', max: 9, acc: 5 },
  longboard: { base: 'skate', name: 'Longboard', real: 'Downhill longboard (big soft wheels)', max: 10.5, acc: 4.5, turn: 0.9, hop: 5.2 },
  // ---------------- boats (boats.js FEEL overrides) ----------------
  bowrider: { base: 'speedboat', name: 'Bayliner-ish bowrider', real: 'Bayliner VR5 (200 hp)', feel: { max: 19, acc: 8, turn: 0.85 }, cols: ['#c53030', '#2b6cb0', '#16181b', '#f2f2f0'], fact: 'The family runabout: tubes, wakeboards and a picnic.' },
  rib: { base: 'speedboat', name: 'Zodiak Pro RIB', real: 'Zodiac Pro 650 RIB (inflatable)', feel: { max: 23, acc: 11, turn: 1.15, grip: 2.2, hops: 1.3 }, scale: [1.05, 0.85, 1.05], cols: ['#e85d04', '#3d4248', '#16181b'], fact: 'Rescue crews use RIBs: the air tubes make them almost unsinkable.' },
  cigarette: { base: 'speedboat', name: 'Cigarrette offshore racer', real: 'Cigarette Racing 41\' (offshore)', feel: { max: 38, acc: 13, turn: 0.75, grip: 1.4, hops: 1.8 }, scale: [1.05, 0.95, 1.5], cols: ['#f6c400', '#c53030', '#16181b'], rare: true, fact: 'Offshore race boats hit 130 km/h and jump the waves.' },
  spark: { base: 'jetski', name: 'Sea-Dew Spork', real: 'Sea-Doo Spark (90 hp)', feel: { max: 22, acc: 11, turn: 1.9 }, cols: ['#38b2ac', '#f6e05e', '#e53e3e'], fact: 'Light and flickable: the tight turns are the fun part.' },
  rxp: { base: 'jetski', name: 'Sea-Dew RXP-X 300', real: 'Sea-Doo RXP-X 300', feel: { max: 30, acc: 14, turn: 1.6, hops: 2 }, cols: ['#16181b', '#e53e3e', '#f6c400'], fact: 'A 300 hp water rocket: over 100 km/h on flat water.' },
  seakayak: { base: 'kayak', name: 'Sea kayak', real: 'Touring sea kayak (5 m)', feel: { max: 4.8, turn: 1.15 } },
  sup: { base: 'kayak', name: 'Rec kayak', real: 'Sit-on-top rec kayak', feel: { max: 3.9, turn: 1.5 } },
  // ---------------- aircraft (real cruise / rotation speeds) ----------------
  beaver: { base: 'seaplane', name: 'de Havoc-land Beaver', real: 'de Havilland Canada DHC-2 Beaver', max: 69, acc: 8, vr: 27, fact: 'Harbour Air flies the world\'s biggest floatplane fleet out of Coal Harbour, many of them Beavers from the 1950s.' },
  otter: { base: 'seaplane', name: 'de Havoc-land Otter', real: 'de Havilland Canada DHC-3 Otter', max: 74, acc: 7.5, vr: 29, fact: 'The Beaver\'s big sister: 10 passengers on floats.' },
  c172: { base: 'cessna', name: 'Cessnuh 172', real: 'Cessna 172 Skyhawk', max: 63, acc: 9, vr: 28, fact: 'The most-built aircraft in history (45,000+).' },
  jetranger: { base: 'heli', name: 'Bell-ish JetRanger', real: 'Bell 206 JetRanger', max: 62, acc: 12, turn: 1.2, fact: 'The classic news-chopper shape from the 1960s.' },
  astar: { base: 'heli', name: 'AirBus-ish A-Star', real: 'Airbus H125 (AStar)', max: 72, acc: 15, turn: 1.35, fact: 'The heli-skiing workhorse of the Coast Mountains: great in thin mountain air.' },
};
// what makeVehicle('car') etc. gives when no model is named (old saves, shops, missions)
export const DEFAULT_MODEL = { car: 'civic', taxi: 'camrytaxi', sports: 'mustang', suv: 'rav4', pickup: 'f150', van: 'foodtruck', bus: 'nova', tug: 'tug', snowmobile: 'sled', motorbike: 'ninja', bike: 'mobee', scooter: 'lyme', skate: 'skate', heli: 'astar', seaplane: 'beaver', cessna: 'c172' };
for (const [id, m] of Object.entries(MODELS)) m.id = id;

// ---------- longitudinal physics shared by the game and the calibration ----------
export const ARC = 1.2;   // the game's cars are 20% quicker than real life (driving-game feel), the ranking stays real
// share of the car's weight on the driven wheels while launching (weight shifts back when you accelerate: good for RWD,
// bad for FWD); motorbikes put nearly everything on the back tyre. Launch grip is 1.25× the cornering grip (arcade tyres).
const G = 9.81, SHARE = { fwd: 0.62, rwd: 0.8, awd: 1.0 }, LAUNCH = 1.25;
// a = drive − drag − rolling. Drive = engine push, capped by what the driven tyres can grip (traction).
export function longAccel(m, s, thr, boost = 1, grip = 1) {
  let a = 0;
  if (thr > 0 && s < m.topS * (boost > 1 ? 1.04 : 1)) a = Math.min(m.mu * LAUNCH * G * m.share * grip, m.Pk * boost * thr / Math.max(s, 1.2));
  return a - m.kA * s * s - m.crr;
}
function timeTo(m, v) { let s = 0, t = 0; const dt = 0.01; while (s < v && t < 60) { s += longAccel(m, s, 1) * dt; t += dt; } return t; }
// find the power that matches the real 0–100 (or 0–50) time, then the drag that puts the top speed where the real one is
export function calibrate(m) {
  if (m.Pk || !(m.z100 || m.z50 || m.zt)) return m;
  m.topS = m.top / 3.6; m.crr = m.kg < 400 ? 0.09 : 0.11; m.share = m.share ?? (m.base === 'motorbike' ? 0.95 : SHARE[m.drive || 'fwd']);
  const goal = (m.zt ? m.zt[0] : m.z100 || m.z50) / ARC, vT = (m.zt ? m.zt[1] : m.z100 ? 100 : 50) / 3.6, cdaReal = 0.5 * 1.225 * (m.kg < 400 ? 0.55 : m.kg > 5000 ? 6 : 0.72) / m.kg;
  m.kA = cdaReal;
  for (let pass = 0; pass < 3; pass++) {
    let lo = 1, hi = 650; for (let i = 0; i < 26; i++) { m.Pk = (lo + hi) / 2; if (timeTo(m, vT) > goal) lo = m.Pk; else hi = m.Pk; }
    m.kA = Math.max(cdaReal * 0.2, (m.Pk / (m.topS * 1.03) - m.crr) / (m.topS * m.topS * 1.06));   // runs out of push right at the real top speed
  }
  m.simZ = timeTo(m, vT); return m;
}
