# Donuts: steady camera instead of swinging back and forth

Date: 2026-09-27 · Status: approved (quick mode) · Issue: #17

## Goal

When the player spins donuts (full throttle + full lock, the truck circling on the spot), the
camera currently swings back and forth. It should hold still instead, and behave exactly as
today in all other driving.

**Success:** `node --test test/*.test.mjs` passes including the new `SpinHold` tests; the
Playwright camera harness shows the camera swing during a simulated donut drops from > 1 unit to
< 0.05 units while straight-line driving produces an identical camera path; a manual donut in the
game no longer swings the view.

## Root cause

The camera never rotates — it sits at a fixed isometric offset (`js/Camera.js:14`) and only
translates. What moves it is the **lead**: the camera aims ahead of the truck by
`lead = velocity · leadFactor (3.0)`, clamped to the 5-unit deadzone (`js/Camera.js:65-74`), and
eases toward that point at rate 2/s (`js/Camera.js:80-81`).

`main.js` builds that "velocity" from the truck's **heading** times its planar speed
(`js/main.js:414-416`). In a donut the heading turns at up to 4 rad/s
(`js/Vehicle.js:123-128`: `4 · steeringGrip`), so the lead vector — up to 5 units long — spins
around the truck at the same rate. The camera, chasing it with a 2/s low-pass, is dragged around
a circle of roughly 2 units radius: on screen that is the "hin und her".

## Approach

Detect a sustained spin and, while it lasts, let the camera **hold**: fade the lead and the
follow smoothing to zero. The existing deadzone hard-clamp (`js/Camera.js:84-97`) stays active,
so the truck can never leave the 5-unit circle — the camera only moves if the truck actually
drifts away from the spot.

**Spin detection (`js/SpinHold.js`, new, pure — no three.js, Node-testable):**

- Input per frame: `dt` and the truck's heading angle (`atan2( forward.x, forward.z )`).
  The yaw rate is derived from the heading change (wrapped to ±π), so it works for keyboard,
  gamepad **and** touch — `vehicle.angularSpeed` is only driven on the keyboard/gamepad path
  (`js/Vehicle.js:104-117`).
- A frame counts as a hard turn when `|yaw rate| ≥ 2.5 rad/s` (`SPIN_MIN_YAW_RATE`).
- Consecutive hard-turn frames in the same direction accumulate the turned angle (`spun`);
  any slower frame, or a direction change, restarts the count.
- Once `|spun| ≥ 1.25π` (225°, `SPIN_ENGAGE_ANGLE`) the target hold is 1, otherwise 0.
  225° is beyond any track corner or hairpin (≤ 180°), so ordinary cornering never triggers it;
  at 4 rad/s a donut is recognised after ≈ 1 s.
- `hold` moves linearly toward the target at `HOLD_RATE = 2` per second (≈ 0.5 s fade in and
  out), so neither engaging nor releasing jumps the view.

**Camera (`js/Camera.js`):** `update( dt, target, velocity, hold = 0 )`. With `follow = 1 - hold`,
the lead is multiplied by `follow` and the smoothing rate becomes `cameraSmoothing · follow`.
`hold = 0` is bit-for-bit today's behaviour.

**Wiring (`js/main.js`):** one `SpinHold` instance; each frame, before `cam.update`, compute the
heading from `vehicle.container.quaternion`, call `spinHold.update( dt, heading )` and pass
`spinHold.hold` to the camera.

Rejected:

- **Lead from the real velocity direction instead of heading** — in a donut the velocity also
  turns at the yaw rate, so the lead still spins; and it changes the feel of every normal corner.
- **Heavier camera smoothing everywhere** — damps the swing but makes the camera laggy in all
  normal driving.
- **Fully frozen camera (no deadzone clamp)** — the truck could slide off screen during a long
  drifting spin.

## Testing

- `test/spin-hold.test.mjs` (Node): straight driving and a 180° full-lock hairpin keep
  `hold = 0`; a sustained 4 rad/s spin reaches `hold = 1`; releasing returns to 0; reversing
  direction restarts the count; heading wrap-around at ±π counts continuously; `dt = 0` is
  ignored.
- `test/harness/camera.html` + Playwright: the real `Camera` fed a synthetic donut (radius 1,
  4 rad/s) with and without `SpinHold`, and a straight run — asserts swing and identity numbers
  above. Pure simulation, no renderer, so no "wait for arrival" timing issues.
- Manual playtest in the real game: hold ↑ + ← for several seconds — the view settles after
  about a second and stays still; normal laps feel unchanged; console stays empty.

## Out of scope

- No change to vehicle physics, drift marks, audio, multiplayer or CPU trucks (the camera only
  follows the local truck).
- No debug hook on `window`.
