# vs CPU polish — smooth CPU trucks, softer bumps, bump sound, restart/quit mid-race

Date: 2026-09-27 · Status: approved (quick mode, see Assumptions in #13) · Issue: #13 · Feature: #4 (merged in bce6ce0)

## Problem

Play-testing the vs-CPU mode from #4 (spec `2026-09-24-cpu-opponents-design.md`) turned up four
complaints (issue #13):

1. CPU trucks stutter ("ruckeln").
2. Bumping into a CPU truck throws your truck around too hard.
3. There is no collision sound when trucks hit each other.
4. While a CPU race runs there is no obvious way to abort it or start over.

## Goal and success criterion

**Success:** `node --test test/*.test.mjs` passes with the new tests; the Playwright checks of
`test/harness/bump.html` (new) and `test/harness/cpu.html` (extended) pass with no page errors;
on the default track a 3-lap race against three medium CPUs shows no visible jumps in corners,
a side bump nudges instead of flings, every truck-on-truck hit is audible (given working audio,
see #12), and the race can be restarted or quit at any time from the positions box, the
"vs CPU" button, or `Esc`.

## Root causes (measured, `main` at bce6ce0)

### 1. Stutter — lane offset jumps at every polyline vertex

`CpuDriver.state()` (`js/race/CpuDriver.js:182-195`) takes the position from
`samplePath( path, distance, lateral )`. `samplePath` (`js/race/TrackPath.js:150-168`) shifts the
point sideways along the **current segment's** normal. The driving line runs through corners as
6 chords of 15° (`TrackPath.js:120-141`), so the normal turns by 15° in one step at every vertex
and a truck driving `lateral` units off the line jumps by `2 · |lateral| · sin 7.5°` there, plus a
jump at every straight↔arc transition. Grid lanes sit at `lateral = ±cellSize · 0.22 ≈ ±1.65`
(`RaceState.js:38`), so every CPU truck (none drives on the centre line) jumps:

| lateral | largest position step while advancing 0.05 along the line |
|---|---|
| 0 | 0.050 |
| ±1.65 | **0.480** (≈ 10× a normal step) |
| ±2.2 | **0.624** |

Six to seven jumps per corner, per truck, visible as stutter. The heading is already smoothed
(`HEADING_SPAN`, `CpuDriver.js:130,185-187`); the position is not.

**Fix.** `state()` offsets the centre-line point along the right vector of the **smoothed
heading** it already computes, instead of letting `samplePath` use the segment normal. Measured
with the fix: largest step 0.080 (±1.65) / 0.090 (±2.2), largest yaw step 1.06°. On straights
the two formulas are identical, so grid positions and `laneOf` (`CpuRace.js:38-45`) are unchanged.
`samplePath`'s own lateral behaviour stays as it is (it is also used for the grid lanes and has
its own tests).

### 2. Bumps too strong — infinite-mass kinematic trucks, velocity spikes, bounce

CPU trucks are kinematic spheres (`Opponents.js:60-65`), moved with `moveKinematic` to the next
pose each frame (`Opponents.js:103`). A kinematic body has infinite mass, so whatever velocity it
implies is transferred to your truck in full. Headless crashcat experiment (resting player,
kinematic truck at 10 u/s, 1/60 s steps):

| scenario | player's peak speed today |
|---|---|
| head-on | 9.82 |
| glancing, 0.6 off-centre | 7.06 |
| glancing, 0.9 off-centre | 4.38 |

Add the jumps from cause 1: 0.43–0.57 units in one frame is an implied 26–34 u/s **sideways**,
which is what hits you when you drive next to a CPU through a corner. The first pose after
`Opponents.add` also moves a body from `[ 0, -100, 0 ]` (`Opponents.js:11`) to the grid in a
single step (≈ 6000 u/s implied).

**Fix**, in three parts:

- Cause 1's fix removes the sideways spikes.
- `Opponents.update` teleports (`setPosition`, zero velocity) instead of `moveKinematic` when the
  implied speed exceeds `MAX_KINEMATIC_SPEED = 40` u/s — first placement, rematch, and
  multiplayer network hiccups. 40 = `MAX_AVG_SPEED` in `RaceState.js:10`, "about three times the
  fastest lap anyone drives"; the fastest legitimate CPU (hard, pace 1.03, outer lane in a corner)
  moves about 15 u/s.
- A new `OpponentContacts` helper sets `combinedRestitution = 0` on player↔opponent contacts (no
  bounce) and, after the physics step, limits how much horizontal speed a bump can add to your
  truck in one step to `MAX_BUMP_GAIN = 3` u/s and forbids upward gain. Measured with both:
  head-on 8.49, glancing 0.6 → 6.20, glancing 0.9 → 3.21. Friction stays untouched (setting it to
  0 made head-on bulldozing worse: the player slid ahead of the CPU for 18 units instead of 9).

This softens contacts with multiplayer trucks too — they use the same `Opponents` class.

### 3. No bump sound — impact volume comes from your own forward speed

The contact listener in `main.js:375-388` already calls `audio.playImpact` for **every** contact
of your truck, opponents included, but it passes `|your velocity · your forward|`. When a CPU
runs into you, or you are slow or hit side-on, that is ≈ 0 and `playImpact` maps it to volume
0.01 (`Audio.js:407-409`): inaudible.

**Fix.** For opponent contacts, `OpponentContacts` computes the **relative** horizontal speed
between the two bodies (a kinematic body's `motionProperties.linearVelocity` is the velocity
`moveKinematic` gave it — verified headless) and calls `onBump( speed )`, which main wires to
`audio.playImpact`. A per-opponent cooldown of 200 ms stops a scraping contact from machine-gunning
the sound. Wall contacts keep today's behaviour. The existing procedural impact synth
(`ImpactSound.js`) is reused — its soft/hard sets already scale with speed.

If audio does not play at all, that is #12 ("Sound aus dem geforkten Original fehlt"), not this
issue; this change builds on whatever `GameAudio` #12 leaves in place and only calls `playImpact`.

### 4. No abort / restart — Quit is small, the vs CPU button goes dead

There is a "Quit race" button, but only as an 11-px link under the live positions
(`CpuPanel.js:37,90-91`), and clicking "vs CPU" during a race does nothing:
`render()` forces `this.open = false` whenever the phase is countdown or racing
(`CpuPanel.js:149-150`). There is no restart except Rematch on the results screen.

**Fix.**

- The positions box gets two readable buttons: **Neu starten / Restart** (`#cpu-restart`,
  calls `race.rematch()` — same settings, fresh grid and countdown) and **Rennen beenden / Quit
  race** (`#cpu-quit`, `race.quit()`).
- "vs CPU" during a race opens the panel with a "Rennen läuft / Race in progress" section and the
  same two buttons plus Close. The panel still closes by itself when a race starts (only on the
  transition into countdown, not on every render).
- `Esc` quits a running CPU race (countdown or racing). Not bound elsewhere (`Controls.js` uses
  WASD/arrows only).
- Every race button blurs itself after a click, so a later `Space`/`Enter` — Space becomes
  throttle in #16 — cannot re-trigger it through native button activation (same lesson as the
  `btn.blur()` note in `i18n.js`).

`CpuRace` needs no change: `rematch()` → `start()` already tears a running race down first
(`CpuRace.js:74-77`, test `start_whileARaceIsRunning_replacesItWithoutLosingTheSoloHook`).

## Architecture

| File | Kind | Change |
|---|---|---|
| `js/race/CpuDriver.js` | pure, modify | `state()` offsets along the smoothed heading |
| `js/race/Bump.js` | pure, create | `MAX_KINEMATIC_SPEED`, `MAX_BUMP_GAIN`, `BUMP_SOUND_COOLDOWN_MS`, `isTeleport( from, to, dt )`, `softenBump( before, after, maxGain )`, `bumpSpeed( a, b )` |
| `js/race/OpponentContacts.js` | crashcat, create | Recognises opponent bodies, zeroes restitution, snapshots/softens the player's velocity around the physics step, reports bump speed with cooldown |
| `js/race/Opponents.js` | modify | `owns( body )`; teleport guard in `update` |
| `js/main.js` | modify | Named `cpuOpponents`; `OpponentContacts` wired into the contact listener and around `updateWorld` |
| `js/ui/CpuPanel.js` | modify | Restart/Quit buttons, race section in the panel, `Esc`, blur |
| `js/ui/strings.js` | modify | `cpu.restart`, `cpu.running` (en + de) |
| `test/cpu-driver.test.mjs`, `test/bump.test.mjs`, `test/cpu-strings.test.mjs` | tests | Node |
| `test/harness/bump.html` | create | Headless crashcat scenarios through the real `Opponents` + `OpponentContacts` |
| `test/harness/cpu.html` | unchanged | Existing page; its Playwright runner gains restart/Esc/vs-CPU-mid-race steps |
| `CHANGELOG.md` | modify | Player-facing entry |

## Error handling

- `OpponentContacts` ignores any contact that does not involve your truck **and** an opponent
  body; wall and ground contacts go down the existing path unchanged.
- `softenBump` only runs in a step that had an opponent contact, so normal driving is untouched.
- `Esc` does nothing outside a CPU race (free driving, results, multiplayer).

## Out of scope

- CPU trucks braking for, or steering around, a truck in their lane (bulldozing from behind stays
  possible at the CPU's speed — inherent to kinematic CPUs, see #4 spec "CPU driving").
- The speed profile (bang-bang braking at 14 u/s², `CpuDriver.js:126-164`) — not measured as a
  stutter source; tune later if play-testing says so.
- A separate truck-on-truck synth sound.
- Audio working at all (#12), CPU dots on the minimap (#18), Space as throttle (#16), camera (#17),
  track loading (#14, #15).

## Testing

- **Node:** `state_laneOffsetThroughCorners_movesWithoutJumps` (step ≤ 0.12 per 0.05 at
  lateral ±1.65 and ±2.2 — fails today at 0.48/0.62), `state_laneOffsetOnTheStraight_matchesSamplePath`;
  `Bump.js` unit tests; new string keys in both languages.
- **Headless:** `test/harness/bump.html` via Playwright — head-on peak ≤ 9.0, glancing 0.6 ≤ 6.5,
  never above y 0.55, a bump reported with speed ≈ 10 and only once per cooldown, a 3-unit pose
  jump teleports (player untouched). `test/harness/cpu.html` — Restart mid-race goes back to
  countdown with fresh trucks, `Esc` quits, "vs CPU" mid-race shows the race section, German labels.
- **Manual:** default track + The Aerodrome, 3 laps vs 3 medium CPUs: watch a CPU through corners,
  side-bump one, rear-end one, restart and quit mid-race.
