# CPU opponents — race 1–3 computer trucks

Date: 2026-09-24 · Status: approved (quick mode, see Assumptions in #4) · Issue: #4 · Depends on: #1

## Problem

Kit Racer only has a lap timer against yourself. Multiplayer (#1) needs friends online; issue #4
asks for something to race when you are alone: CPU opponents.

## Goal and success criterion

From the game, pick "vs CPU", choose 1–3 CPU trucks, a difficulty and a lap count, and race them
from a grid start with a countdown to a results list — on the default track, every preset, and any
editor/OSM track that is one closed circuit.

**Success:** on the default track and on The Aerodrome, a 3-lap race against three medium CPUs
finishes with a results table; CPU trucks follow the road through every corner, never leave the track,
shove your truck when you hit them, and an easy CPU is beatable by a casual player while a hard one
is not trivially beaten.

## Scope

In scope: vs-CPU mode (1–3 CPUs, easy/medium/hard, 1–10 laps), grid start, countdown, live positions,
results, rematch, quit back to free driving; de/en for all new UI text; automatic driving line for any
closed-loop track.

Out of scope: CPUs in multiplayer races, CPU trucks that get pushed around by the player (they are
kinematic, see CPU driving), rubber-banding, overtaking logic/lane changes, CPU on tracks without a finish
line or with branches, minimap dots (the OSM HUD work), best-lap records for CPU races.

## Dependency on #1

This feature is built on #1's modules and must be implemented **after #1 is merged**:
`js/race/RaceState.js` (`RaceState`, `PHASE`, `gridSlots`, `COUNTDOWN_MS`), `js/race/Opponents.js`
(kinematic truck + name label), `js/race/Interpolate.js` (`RENDER_DELAY_MS`), `js/net/Protocol.js`
(`MAX_LAPS`), `js/ui/strings.js` (`t`, `STRINGS`, `FUNNY_NAMES`), the `LapTimer` hooks (`onLap`,
`progress()`, `resetForRace()`, `startRace()`, `resetForSolo()`) and the `game` adapter + `holdInput`
in `main.js`. Nothing of these is duplicated here.

## Architecture

```
main.js ── game adapter (from #1) ──┬─ MultiplayerRace (#1) ── Opponents (remote trucks)
                                    └─ CpuRace ─┬─ RaceState (#1 rules, reused as-is)
                                                ├─ CpuDriver ×1–3 ── TrackPath (driving line)
                                                └─ Opponents (own instance: CPU trucks)
CpuPanel (DOM) ◀── view() / onChange ── CpuRace
```

| File | Kind | Responsibility |
|---|---|---|
| `js/race/TrackPath.js` | pure | Piece connectivity (`openSides`), cell order from the finish line (`trackOrder`), closed driving line through straights and quarter arcs (`buildPath`), point/heading at a distance with lane offset (`samplePath`) |
| `js/race/CpuDriver.js` | pure | One CPU: speed control (accelerate, brake before corners), distance → laps/progress, `{ p, q, v }` state for `Opponents`; `DIFFICULTY` table |
| `js/race/CpuRace.js` | pure | Race controller: settings, grid, countdown via `RaceState`, CPU lap bookkeeping, player laps via `lapTimer.onLap`, results, rematch, quit; `view()` for the UI |
| `js/ui/CpuPanel.js` | DOM | "vs CPU" button, settings panel, countdown overlay, live positions + Quit, results + Rematch/Free driving |
| `js/ui/strings.js` | modify | `cpu.*` keys in de and en |
| `js/main.js` | modify | Second `Opponents` for CPUs, `CpuRace` + `CpuPanel`, `cpuRace.update( dt )` before the physics step, mutual exclusion with multiplayer |

### Driving line

Pieces connect through two open sides. At orientation 0 a straight/bump/finish opens to ±z, a corner
to −x and +z (derived from the default circuit in `Track.js:10-27`); other orientations rotate these
with the `ORIENT_DEG` table exactly like `placePiece` (`Track.js:308-320`). Starting at the finish
cell and leaving it forwards (`computeSpawnPosition` angle, `Track.js:375-402`), each step enters
the next cell and leaves through its other open side. The walk must return to the finish cell,
moving forwards, after visiting every cell exactly once — otherwise CPU races are unavailable for
that track. The line runs through straight cell centres and along quarter arcs of radius half a cell
around the inner corner of corner cells (6 chords of 15°), starting and ending on the finish line.
Checked against the default track and all four presets (loop lengths 110, 732, 667, 526, 565 units).

### CPU driving

Kinematic: each CPU is a distance along the line plus a fixed lane offset; it accelerates at 6 u/s²
to its top speed, brakes at 14 u/s² to its corner speed when a corner is within 4 units, and is
drawn and collided through `Opponents` (`moveKinematic`). Heading comes from the line 1 unit behind
to 1 unit ahead, so the 15° chords do not show.

| Difficulty | Top speed (u/s) | Corner factor | Lap on The Aerodrome |
|---|---|---|---|
| easy | 8 | 0.6 | ≈ 106 s |
| medium | 10 | 0.7 | ≈ 82 s |
| hard | 12.5 | 0.75 | ≈ 64 s |

Per-CPU pace 1.03 / 1.00 / 0.97 for slots 0 / 1 / 2, so the field spreads out and the car sharing a
lane with another (slots 0 and 2) is always the faster one ahead — kinematic trucks pass through each
other, so they must never catch up. These numbers are a first cut; play-testing tunes the
`DIFFICULTY` table only.

### Race flow

1. **Settings.** "vs CPU" (next to Tracks / Multiplayer) opens a panel: CPU trucks 1–3 (default 3),
   difficulty (default medium), laps 1–10 (default 3), Start race. On a track without a closed loop
   the panel only shows "CPU trucks need one closed circuit with a finish line".
2. **Grid.** `gridSlots` from #1: CPUs on slots 0…n−1, you on slot n (behind them). Input held.
3. **Countdown.** `RaceState` 3 s countdown, big 3-2-1-GO overlay; CPUs wait on the grid.
4. **Racing.** Your laps come from `LapTimer` (every cell visited, as today) through `onLap`; CPU
   laps from their distance (first crossing of the line from the grid is not a lap). Live list
   `P1 … · Lap x/y`, you highlighted; Quit race button.
5. **Results.** When everyone finished, or 30 s after the winner (`RaceState` rules): place, name,
   time, best lap, DNF. Rematch (same settings) or Free driving.
6. **Quit / multiplayer.** Quitting removes the CPU trucks, restores the single-player lap timer
   and its stored best lap. Starting or joining a multiplayer session quits a CPU race; the CPU
   panel will not start while a multiplayer session exists.

## Error handling

- Track not a single loop (branches, gaps, stray cells, wrongly turned corner, no finish) →
  `buildPath` returns null, panel explains, nothing starts.
- Settings from the UI are clamped (`cleanSettings`): unknown difficulty → medium, CPUs 1–3,
  laps 1–10.
- A CPU lap `RaceState` rejects (would need > 40 u/s) stops that CPU's bookkeeping instead of looping.

## Testing

- **Node:** `TrackPath` (corner sides per orientation, default + every preset form a loop, reversed
  finish, broken tracks → null, path length and wrap-around); `CpuDriver` (acceleration, entering
  corners at corner speed, difficulty order, laps from behind the line, pose); `CpuRace` with a fake
  game (settings clamp, grid lanes, unavailable track, slots/hold/countdown, CPUs wait then go,
  push timing, CPU results with the player DNF, player laps via `onLap`, quit, rematch); strings
  present in both languages.
- **Headless:** `test/harness/cpu.html` — real `CpuPanel` + `CpuRace` with a fake game and a 20×
  clock, driven by Playwright (settings → grid → countdown → positions → results → rematch → quit,
  German toggle, broken-track message, no page errors). Prototyped while writing this spec.
- **Manual:** default track and The Aerodrome, 3 laps vs 3 medium CPUs; bump a CPU; Quit mid-race;
  easy vs hard feel.

## Constraints kept

Static files only; pure modules import neither `three` nor `crashcat`; free driving, presets,
editor, OSM tracks and multiplayer unchanged when vs CPU is not used; CPU race laps never touch
the single-player best-lap storage (`resetForRace` sets `persist = false`).
