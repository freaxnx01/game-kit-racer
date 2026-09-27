# CPU trucks on the minimap

Date: 2026-09-27 · Status: approved (quick mode, see Assumptions in #18) · Issue: #18 · Builds on: #2 (minimap), #4 (CPU opponents) · Related: #13 (CPU race fixes, same code)

## Problem

In a race against the computer (#4) the minimap (#2, `js/OsmHud.js`) only shows your own truck. As
soon as a CPU truck is out of sight you cannot tell whether it is right behind you or half a lap
ahead. Issue #18: "gegen CPU: Gegner in der Minimap anzeigen".

## Goal and success criterion

While a vs-CPU race exists (countdown, racing, results), every CPU truck appears on the minimap as a
dot in its truck colour, moving with the truck; your orange arrow stays on top. Outside a CPU race the
minimap looks exactly as today.

**Success:** on the default track, a race against three CPUs shows three dots — green, purple, red —
on the grid during the countdown, following the track while racing, and none after Quit race / Free
driving. Headless: the harness pixel under each marker has the marker colour; `node --test` covers
the marker data.

## Scope

In scope: CPU truck markers on the minimap for vs-CPU races, on every track that has a minimap
(all of them).

Out of scope: remote players in multiplayer races, the ghost truck (#3), position numbers or names on
the minimap, a zoomed/rotating minimap, anything in #13 (CPU jitter, collisions, abort/new game).

## Architecture

```
main.js animate() ── cpuRace.update( dt ) ── … ── hud.update( x, z, fx, fz, cpuRace.markers() )
CpuRace.markers()  (pure)  → [ { x, z, colour } ]  from each CpuDriver.state().p
Hud.update( …, others = [] ) → static layer → CPU dots → player arrow
```

| File | Kind | Change |
|---|---|---|
| `js/race/CpuRace.js` | pure | New query `markers()`: one `{ x, z, colour }` per CPU driver (colour = the truck index 0–2 passed to `opponents.add`), `[]` when no race exists |
| `js/OsmHud.js` | DOM | `export const MARKER_COLOURS` (green, purple, red — the `TRUCKS` order in `js/race/Opponents.js:8`); `update()` takes an optional `others` list; drawing split into clear → dots → arrow |
| `js/main.js` | modify | One line: pass `cpuRace.markers()` to `hud.update` |
| `test/cpu-race.test.mjs` | test | `markers()` cases |
| `test/harness/hud.html` | test | `?cpus` mode drawing three markers, exposing their map positions |
| `CHANGELOG.md` | docs | German-voiced player entry under `[Unreleased]` |

### Marker data

`CpuRace` already owns the CPU drivers (`this.drivers`, insertion order = CPU index, `CpuRace.js:197`,
`:268-277`), and `CpuDriver.state().p` is the pose the truck is drawn at (`CpuRace.js:321-328`: CPU
poses are sampled so the trucks are shown where they are). `markers()` maps each driver to
`{ x: p[0], z: p[2], colour: index }`. It is a query — no side effects — and pure like the rest of
`CpuRace`, so `node:test` covers it. After `teardown()` (`CpuRace.js:354-365`) the driver map is empty,
so quitting, rematch and a multiplayer session starting all clear the dots without extra code.

### Drawing

`Hud.update( x, z, forwardX, forwardZ, others = [] )`. The per-frame draw becomes three steps:
restore the static layer, draw each marker as a filled circle (radius 4 px, 1.5 px dark outline
`rgba(10,12,14,0.9)`) in `MARKER_COLOURS[ colour % 3 ]`, then draw the player arrow exactly as today —
last, so it stays on top. The default `[]` keeps every existing caller (solo driving, multiplayer, the
harness `generic` check) unchanged. Map size, position and the phone-width layout do not change.

## Error handling

- No race / race quit → `markers()` returns `[]`, nothing extra drawn.
- A marker outside the fitted view (cannot happen on a closed loop, but lateral lane offsets reach
  slightly beyond cell edges) is simply clipped by the canvas.
- Colour index ≥ 3 wraps with `% MARKER_COLOURS.length`, mirroring `Opponents.add`.

## Testing

- **Node** (`test/cpu-race.test.mjs`, fake game already there): `markers_noRace_isEmpty`,
  `markers_duringCountdown_oneDotPerCpuOnItsGridPose`, `markers_whileRacing_followTheDrivers`,
  `markers_afterQuit_isEmpty`.
- **Headless** (`test/harness/hud.html?cpus` + Playwright): the pixel at each marker's map position is
  its colour; the pixel at the player position is the arrow's orange (arrow on top); no page errors;
  the existing `generic` check still passes.
- **Manual:** default track, vs CPU with 3 medium CPUs — three coloured dots on the grid, moving with
  the trucks, gone after Quit race.

## Constraints kept

Static files only; `CpuRace` stays free of `three`, `crashcat` and the DOM; solo, multiplayer, ghost,
OSM layers and street names unchanged; minimal footprint in `CpuRace.js` and `main.js` (one appended
method, one changed line) so it merges cleanly with #13's CPU fixes.
