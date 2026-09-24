# Best-lap ghost — race against your fastest lap

Date: 2026-09-24 · Status: approved (quick mode) · Issue: #3

## Problem

Best-lap **times** are stored per track (`js/LapTimer.js:5`, `:48`, `:178` — `localStorage` key
`racing.bestLap.<?map= value>`), but the lap itself is not. There is nothing to race against in
single player except a number.

## Goal and success criterion

After a completed lap, a see-through truck replays the fastest lap driven on this track, in sync
with the lap timer, so the player can see where they gain or lose time.

**Success:** drive a lap, start the next one — a transparent yellow truck leaves the line with you
and drives your best lap; beat it and the next lap's ghost is the new, faster lap; reload the page
and the ghost is still there.

## Scope

In scope: recording the lap path, keeping the fastest one per track in `localStorage`, replaying it
as a transparent truck without a collider, hiding it when it is not meaningful.

Out of scope: a toggle to switch the ghost off, a live time delta (+/−) to the ghost, ghosts of
other players or downloadable ghosts, ghosts during multiplayer races (#1), CPU opponents (#4).

## Design

### Modules

| File | Kind | Responsibility |
|---|---|---|
| `js/race/Ghost.js` | pure | Sample format, `sampleGhost( ghost, t )`, `encodeGhost` / `decodeGhost` (validated), `loadGhost` / `saveGhost` (storage injectable), `ghostStorageKey( trackId )`, `GhostRun` (records the current lap, keeps the fastest complete lap) |
| `js/race/GhostCar.js` | three | Clone of the player's truck with cloned transparent materials (opacity 0.35, no depth write, no shadows); `setPose( pose \| null )` |
| `js/main.js` | modify | Create both after the `LapTimer`, call `updateGhost()` after `lapTimer.update(…)` each frame |

`Ghost.js` imports neither `three` nor `crashcat`, so it is unit-tested in Node.

### Recording

- A sample is `[ t, px, py, pz, qx, qy, qz, qw ]`: lap time (`lapTimer.currentLapTime`) and the
  player's `vehicle.container` position and quaternion — the same transform that places the
  visible truck (`js/Vehicle.js:212-216`, rotation incl. tilt over bumps `:148-155`).
- One sample every 50 ms (20 Hz); the lap-completion frame adds a final sample at the exact lap
  time (`lapTimer.lastLap`).
- A lap completes when `lapTimer.lap` goes up by one (`js/LapTimer.js:181`). No change to
  `LapTimer.js` is needed.
- A recording is kept only if it started at the line (first sample at lap time ≤ 50 ms) and
  stayed under 300 s.
- The finished lap replaces the ghost when there is none yet or it is faster than the ghost's
  time. The ghost carries its own time, independent of the stored best-lap time.

### Storage

- Key `racing.ghost.<?map= value or 'default'>` — the same track identity as the best lap time.
- JSON `{ v: 1, time, s: [flat samples] }`, numbers rounded to 3 decimals (~30–60 KB for a
  one-minute lap).
- Anything malformed (bad JSON, wrong version, NaN, unsorted times, < 2 samples, time ≤ 0 or
  > 300 s) loads as "no ghost". Storage errors (private mode, quota) are swallowed like
  `saveBest` does (`js/LapTimer.js:24-32`).

### Playback

- Every frame while the lap timer runs: `pose = sampleGhost( best, currentLapTime )` — binary
  search, position lerp, quaternion nlerp along the short arc.
- Hidden when: the timer has not started, the ghost has already finished its lap in the current
  lap (`t > ghost.time`), there is no ghost, the track has no finish line
  (`lapTimer.enabled === false`), or a multiplayer race is running (`lapTimer.persist === false`,
  a field #1 adds — `undefined` before #1 merges, so the check is inert until then).
- During a multiplayer race the recording is discarded every frame, so race laps never become the
  ghost (same rule as #1's "multiplayer laps never touch the single-player best-lap storage").

### Why not reuse #1's `Opponents` / `Interpolate`

`Opponents` (#1 plan Task 7) gives every truck a kinematic crashcat body — a ghost you bump into
defeats the point. `Interpolate.pushState` caps its buffer at 20 states and `sampleBuffer` coasts
past the newest state (#1 plan Task 4); a ghost needs thousands of samples, indexed by lap time,
and must stop at the end of its lap. A dedicated ~150-line pure module is simpler than bending
either, and it keeps #3 independent of #1's merge order.

## Error handling

- Corrupt or foreign stored data → no ghost, never throws.
- `localStorage` unavailable or full → ghost works for the session, just isn't saved.
- Falling off the world teleports the truck (`js/Vehicle.js:192-209`); the lap continues, so the
  ghost may show the same jump if that lap becomes the best.

## Testing

- **Node (`node --test test/*.test.mjs`):** `test/ghost.test.mjs` — sampling (empty, blend,
  exact sample, before first, after lap end, short arc), storage (key, round trip with rounding,
  every malformed variant, fake storage load/save, throwing storage), `GhostRun` (first lap becomes
  best and is reported, ~20 Hz sampling, slower lap kept out, faster lap replaces, over-long lap
  dropped, discard mid-lap, lap counter jumping back).
- **Syntax:** `node --input-type=module --check` on `js/main.js` and `js/race/GhostCar.js`.
- **Manual play-test** (the stack's test gate for rendering): the success criterion above, plus a
  track without a finish line (no ghost, no errors).

## Constraints kept

Static files only; no new dependencies; `LapTimer.js`, `Vehicle.js` and physics unchanged;
mrdoob code style; English-only (no new UI text).
