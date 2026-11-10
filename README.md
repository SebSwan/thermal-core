# Thermal Core

A tiny paragliding trainer. An invisible thermal is dropped at random on an aerial photo; fly around and find its core by
listening to the vario.

No dependencies and no build step: open `index.html` in a browser, or serve the folder with any static server
(`python3 -m http.server`).

## How to play

The vario beeps when you climb, higher and faster as the climb gets stronger, and stays silent when you sink. The number
at the top left is your vertical speed. Circle where it is strongest.

- **New thermal**: drop another thermal somewhere else.
- **Show thermal**: reveal it, to see how the sound relates to where you are.
- **Hint**: flash it for a moment.
- **Wind**: the thermal drifts downwind in a straight line, so you have to keep re-centring. When it leaves the screen it
  comes back from the opposite side.

Keyboard: `←` `→` turn, `↑` speed bar, `↓` brakes.

On a touch screen, three layouts:

- **Two sticks**: left thumb for speed, right thumb to turn.
- **Joystick**: everything under one thumb.
- **Two brakes**: like the real thing, one control per hand, each flying its half of the wing. Pull one side to turn
  that way, pull both to slow down, push both to speed up.

## How it works

Everything is in `game.js`, about 200 lines, in this order: settings, thermal, controls, vario, simulation, drawing.

- **Thermal**: `lift(d) = peak × (1 − u) × e^(−u)` with `u = (d / radius)²`. Strong lift at the core, zero at the
  radius, a ring of sink around it.
- **Wing**: three points (full brakes, hands up, full speed bar), each with an airspeed, a sink rate and a turn radius.
  Turning tight raises the load on the wing, which makes it sink faster.
- **Vertical speed**: lift of the air minus sink of the wing. It drives both the display and the vario.

The numbers at the top of `game.js` are the ones to play with.

## Licence

Code: MIT, see `LICENSE`.

`map.jpg`: aerial photo of Talloires, Lake Annecy, © IGN (Géoplateforme, BD ORTHO), Etalab Open Licence 2.0.
