// Thermal Core: find the core of an invisible thermal by listening to the vario.
// Top view, one glider, one thermal. No dependencies, no build step: open index.html.
// Units are real ones (metres, seconds, m/s); the simulation simply runs TIME times faster than real life.
'use strict';

// ---------- Settings ----------
const MAP_M = 1704;   // width of map.jpg on the ground, in metres (the image is square)
const TIME = 8;       // 1 second of play = 8 seconds of flight
const WING = {        // [full brakes, hands up, full speed bar]
  speed: [10, 11, 18],       // airspeed, m/s
  sink: [1.0, 1.1, 2.2],     // sink rate in still air, m/s
  radius: [15, 40, 90],      // tightest turn radius, m
};
const THERMAL = { radius: [180, 260], peak: [3, 6] };   // random range: radius (m) and lift at the core (m/s)
const TRAIL_S = 10;   // seconds of trail kept behind the glider

// ---------- Helpers ----------
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => lerp(a, b, Math.random());
// Value of a wing setting for a speed command: -1 = full brakes, 0 = hands up, 1 = full speed bar
const wing = (values, cmd) => cmd < 0 ? lerp(values[1], values[0], -cmd) : lerp(values[1], values[2], cmd);

// ---------- State ----------
const canvas = $('view'), ctx = canvas.getContext('2d');
const map = new Image(); map.src = 'map.jpg';
const glider = { x: MAP_M / 2, y: MAP_M / 2, heading: -Math.PI / 2, turn: 0, speed: 0, vz: 0 };   // turn and speed: smoothed commands, -1..1
let thermal, wind = { x: 0, y: 0 };
let view = { left: 0, top: 0, scale: 1, x0: 0, y0: 0, x1: MAP_M, y1: MAP_M };   // see resize()
let visible = false, hintUntil = 0, trail = [], now = 0;

// ---------- Thermal ----------
// Classic bell-shaped model: strong lift at the core, fading to zero at the radius, with a ring of sink around it.
//   lift(d) = peak × (1 − u) × e^(−u)   with u = (d / radius)²
function liftAt(x, y) {
  const u = ((x - thermal.x) ** 2 + (y - thermal.y) ** 2) / thermal.radius ** 2;
  return thermal.peak * (1 - u) * Math.exp(-u);
}
function newThermal() {
  thermal = { x: rand(view.x0, view.x1), y: rand(view.y0, view.y1), radius: rand(...THERMAL.radius), peak: rand(...THERMAL.peak) };
}
// The wind carries the thermal along. Its direction is picked once and never changes; only its strength does.
const windAngle = rand(0, Math.PI * 2);
function setWind() {
  const speed = +$('wind').value, a = windAngle;
  wind = { x: Math.cos(a) * speed, y: Math.sin(a) * speed };
  $('windArrow').hidden = !speed;
  $('windArrow').style.transform = `rotate(${a}rad)`;
}

// ---------- Controls ----------
// Keyboard: arrow keys. Touch: two pads, each reporting x and y in -1..1 (0 when released).
const keys = {};
addEventListener('keydown', e => { keys[e.key] = true; });
addEventListener('keyup', e => { keys[e.key] = false; });

function makePad(el) {
  const pad = { el, x: 0, y: 0, axes: 'xy' }, knob = el.firstElementChild, RANGE = 47;   // px of travel for a full command
  const move = e => {
    const box = el.getBoundingClientRect();
    pad.x = pad.axes.includes('x') ? clamp((e.clientX - box.left - box.width / 2) / RANGE, -1, 1) : 0;
    pad.y = pad.axes.includes('y') ? clamp((box.top + box.height / 2 - e.clientY) / RANGE, -1, 1) : 0;   // up = positive
    knob.style.transform = `translate(${pad.x * RANGE}px, ${-pad.y * RANGE}px)`;
  };
  const release = () => { pad.x = pad.y = 0; knob.style.transform = ''; };
  el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); move(e); });
  el.addEventListener('pointermove', e => { if (el.hasPointerCapture(e.pointerId)) move(e); });
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  return pad;
}
const padL = makePad($('padL')), padR = makePad($('padR'));

// Three touch layouts. Each one says which axes its pads use and how to read them as [turn, speed].
const MODES = {
  sticks: { L: 'y', R: 'x', read: () => [padR.x, padL.y] },      // left thumb: speed, right thumb: turn
  joystick: { L: '', R: 'xy', read: () => [padR.x, padR.y] },    // everything under one thumb
  // Like a real paraglider: each hand flies its half of the wing (-1 pulled … 1 pushed).
  // The wing turns towards the slower half; pushing both speeds up; braking is as strong as the most pulled side.
  brakes: { L: 'y', R: 'y', read: () => {
    const l = padL.y, r = padR.y;
    return [l - r, (Math.max(0, l) + Math.max(0, r)) / 2 - Math.max(0, -l, -r)];
  } },
};
let mode;
function setMode(name) {
  mode = MODES[name] || MODES.sticks;
  for (const [pad, axes] of [[padL, mode.L], [padR, mode.R]]) { pad.axes = axes; pad.el.dataset.axes = axes; pad.el.hidden = !axes; }
}
// Returns [turn, speed], each in -1..1: turn > 0 = right, speed > 0 = speed bar, speed < 0 = brakes
function readControls() {
  const [turn, speed] = mode.read();
  return [
    clamp(turn + (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0), -1, 1),
    clamp(speed + (keys.ArrowUp ? 1 : 0) - (keys.ArrowDown ? 1 : 0), -1, 1),
  ];
}

// ---------- Vario ----------
// One sound: a beep that gets higher and faster as the climb gets stronger, and silence when sinking.
let audio = null, muted = false, nextBeep = 0;
function startAudio() {   // browsers only allow sound after a first tap or key press
  if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
  if (audio.state === 'suspended') audio.resume();
}
addEventListener('pointerdown', startAudio);
addEventListener('keydown', startAudio);

function vario(dt) {
  nextBeep -= dt;
  if (nextBeep > 0 || !audio || muted || glider.vz <= 0) return;
  const strength = clamp(glider.vz / 5, 0, 1);       // 0 = barely climbing, 1 = 5 m/s or more
  const period = lerp(0.5, 0.12, strength);          // seconds between two beeps
  const t = audio.currentTime, osc = audio.createOscillator(), gain = audio.createGain();
  osc.frequency.value = lerp(500, 1400, strength);   // Hz
  gain.gain.setValueAtTime(0, t);                    // short fades in and out avoid clicks
  gain.gain.linearRampToValueAtTime(0.3, t + 0.01);
  gain.gain.setValueAtTime(0.3, t + period / 2 - 0.01);
  gain.gain.linearRampToValueAtTime(0, t + period / 2);
  osc.connect(gain).connect(audio.destination);
  osc.start(t); osc.stop(t + period / 2);
  nextBeep = period;
}

// ---------- Simulation ----------
function step(dt) {
  const g = glider, [turn, speed] = readControls();
  g.turn += (turn - g.turn) * Math.min(1, dt * 6);       // commands follow the input smoothly
  g.speed += (speed - g.speed) * Math.min(1, dt * 3);

  const v = wing(WING.speed, g.speed);                   // airspeed, m/s
  const yaw = g.turn * v / wing(WING.radius, g.speed);   // turn rate, rad/s
  const load = Math.hypot(1, v * yaw / 9.81);            // load factor: a banked wing carries more and sinks faster
  const t = dt * TIME;

  g.heading += yaw * t;
  g.x += Math.cos(g.heading) * v * t;
  g.y += Math.sin(g.heading) * v * t;
  // Edges of the playground: the glider bounces back
  if (g.x < view.x0 || g.x > view.x1) { g.x = clamp(g.x, view.x0, view.x1); g.heading = Math.PI - g.heading; }
  if (g.y < view.y0 || g.y > view.y1) { g.y = clamp(g.y, view.y0, view.y1); g.heading = -g.heading; }
  // The thermal drifts in a straight line. Once it has fully left the playground, it comes back from the opposite side, on the same course.
  const r = thermal.radius, wrap = (v, a, b) => a + (((v - a) % (b - a)) + (b - a)) % (b - a);
  thermal.x = wrap(thermal.x + wind.x * t, view.x0 - r, view.x1 + r);
  thermal.y = wrap(thermal.y + wind.y * t, view.y0 - r, view.y1 + r);

  // The only number that matters: vertical speed = lift of the air − sink of the wing
  const vz = liftAt(g.x, g.y) - wing(WING.sink, g.speed) * load ** 1.5;
  g.vz += (vz - g.vz) * Math.min(1, dt * 8);             // light smoothing, like a real vario

  trail.push({ x: g.x, y: g.y, vz: g.vz, at: now });
  while (trail[0].at < now - TRAIL_S) trail.shift();
}

// ---------- Drawing ----------
// The map covers the whole screen, cropped on its long side. view = the map point at the top left of the screen (left, top, in
// metres), the pixels per metre (scale) and the playground (x0, y0, x1, y1, in metres): the screen minus the toolbar and the pads.
function resize() {
  const dpr = devicePixelRatio || 1, W = innerWidth, H = innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const scale = Math.max(W, H) / MAP_M, left = (MAP_M - W / scale) / 2, top = (MAP_M - H / scale) / 2;
  const toolbar = document.querySelector('header').offsetHeight, pads = getComputedStyle($('padR')).display === 'none' ? 0 : 190;
  view = { left, top, scale, x0: left, y0: top + toolbar / scale, x1: left + W / scale, y1: top + (H - pads) / scale };
}
const sx = x => (x - view.left) * view.scale, sy = y => (y - view.top) * view.scale;   // metres → screen pixels

function draw() {
  const g = glider, k = view.scale;
  ctx.fillStyle = '#1e2730'; ctx.fillRect(0, 0, innerWidth, innerHeight);
  if (map.complete && map.naturalWidth) ctx.drawImage(map, sx(0), sy(0), MAP_M * k, MAP_M * k);

  if (visible || now < hintUntil) {   // lift area, edge where lift is zero, and the core
    const x = sx(thermal.x), y = sy(thermal.y), r = thermal.radius * k, fill = ctx.createRadialGradient(x, y, 0, x, y, r);
    fill.addColorStop(0, 'rgba(255, 200, 40, .75)'); fill.addColorStop(1, 'rgba(255, 200, 40, 0)');
    ctx.fillStyle = fill; ctx.strokeStyle = 'rgba(255, 200, 40, .9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#e33'; ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
  }

  ctx.lineWidth = 3; ctx.lineCap = 'round';   // trail: green where it climbed, red where it sank, fading with age
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1], b = trail[i];
    if (Math.hypot(b.x - a.x, b.y - a.y) > 100) continue;   // skip the jump of a bounce after a resize
    ctx.strokeStyle = `rgba(${b.vz > 0 ? '90, 230, 110' : '255, 110, 90'}, ${1 - (now - b.at) / TRAIL_S})`;
    ctx.beginPath(); ctx.moveTo(sx(a.x), sy(a.y)); ctx.lineTo(sx(b.x), sy(b.y)); ctx.stroke();
  }

  ctx.save(); ctx.translate(sx(g.x), sy(g.y)); ctx.rotate(g.heading + Math.PI / 2);   // glider, drawn nose up
  ctx.fillStyle = '#ff8a2a'; ctx.strokeStyle = '#3a1a00'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-18, 4); ctx.quadraticCurveTo(0, -16, 18, 4); ctx.quadraticCurveTo(0, -5, -18, 4); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 7, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.restore();

  const vz = $('vz');
  vz.textContent = `${g.vz >= 0 ? '+' : ''}${g.vz.toFixed(1)} m/s`;
  vz.className = g.vz > 0 ? 'up' : 'down';
}

// ---------- Buttons ----------
$('new').onclick = newThermal;
$('show').onclick = e => { visible = !visible; e.target.textContent = visible ? 'Hide thermal' : 'Show thermal'; };
$('hint').onclick = () => { hintUntil = now + 1.5; };   // the thermal flashes for a moment
$('wind').onchange = setWind;
$('sound').onclick = e => { muted = !muted; e.target.textContent = muted ? 'Sound off' : 'Sound on'; };
$('controls').onchange = e => { setMode(e.target.value); try { localStorage.setItem('controls', e.target.value); } catch (err) { /* private browsing */ } };
try { $('controls').value = localStorage.getItem('controls') || 'sticks'; } catch (err) { /* private browsing */ }

// ---------- Main loop ----------
let last = 0;
function frame(ms) {
  const dt = Math.min(0.05, (ms - last) / 1000);   // real seconds since the previous frame (capped: a hidden tab does not jump)
  last = ms; now += dt;
  step(dt); vario(dt); draw();
  requestAnimationFrame(frame);
}
addEventListener('resize', resize);
resize(); setMode($('controls').value); newThermal(); setWind();
requestAnimationFrame(frame);
