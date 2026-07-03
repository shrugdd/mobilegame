# Wobbly Wheels

A mobile-first, physics-based ragdoll bike game in the spirit of Happy Wheels,
built with HTML5 canvas and [planck.js](https://github.com/piqnt/planck.js)
(a JavaScript port of Box2D — the same physics engine family the original
Flash game used). No build step, no external requests at runtime: everything
is plain JS served as static files.

## Play it

Any static file server works:

```sh
npx serve .
# or
python3 -m http.server 8000
```

Then open the URL on your phone (same Wi-Fi) or desktop. On mobile, add it to
your home screen for fullscreen play. Landscape is recommended.

## Controls

| Action | Touch | Keyboard |
|---|---|---|
| Accelerate | right ▲ | ↑ / W |
| Brake / reverse | right ▼ | ↓ / S |
| Lean back / forward | left buttons | ← → / A D |
| Eject | EJECT | Z |
| Restart | ↻ (top right) | R |

## Gameplay

Ride a bicycle from the start pad to the checkered finish flag. Level 1,
**Sunny Hills Run**, is an original opening level in the classic
obstacle-course style:

1. Rolling grass hills
2. A spike pit (jump it off the lip, or climb out the far ramp if you fall in)
3. A launch ramp over a spiked chasm — hit it at full speed
4. A swinging log
5. The finish straight

Spikes and hard head impacts kill the rider (with a modest amount of blood).
Joints holding the rider to the bike snap under enough force, so a bad
landing can throw you off. A thrown rider who slides across the finish line
still wins; one who comes to rest anywhere else is knocked out.

## Project layout

```
index.html         page shell, HUD, touch controls, overlays
style.css          layout + control styling (safe-area aware)
js/input.js        multi-touch pointer + keyboard input
js/level.js        terrain/obstacle construction (planck bodies + render data)
js/player.js       bicycle + ragdoll rider, drive/lean/eject, breakable joints
js/main.js         world setup, fixed-timestep loop, camera, canvas renderer
vendor/planck.min.js  physics engine (vendored, MIT — see PLANCK-LICENSE.txt)
```

### Design notes

- Physics coordinates are meters with **y pointing down** (gravity +10), so
  the renderer needs no axis flip.
- Fixed 60 Hz physics step with an accumulator; frame updates are capped at
  4 steps to avoid death-spirals on slow devices.
- Drive works by steering rear-wheel angular velocity directly. Traction is
  still limited by tire friction, but there is no motor reaction torque, which
  keeps the bike from wheelie-flipping on hills. Wheelies are still available
  via the lean controls.
- The rider is 7 bodies (head, torso, two-segment arm and leg) with joint
  limits, attached to the bike at seat/hands/pedal by revolute joints that
  break past a per-joint reaction-force threshold.
- Launch ramps use a quadratic ease-in profile so the lip keeps its slope
  (a cosine-eased hill launches you flat).
- Rendering is fully procedural — no image assets. Canvas is
  devicePixelRatio-aware (capped at 2× for performance).

## Roadmap

- [ ] Custom character/vehicle models (segway, wheelchair-style, etc.)
- [ ] More levels + a level select screen
- [ ] Sound effects (WebAudio)
- [ ] Dismemberment / more elaborate gore
- [ ] Grabbing, pushing objects, and interactive triggers (harpoons, mines)
- [ ] Ghost replays / best-time persistence (localStorage)
