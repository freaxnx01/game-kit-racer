# Track load time — cap the light-probe bake

Date: 2026-09-27 · Status: approved (enrich --quick) · Issue #15

## Problem

Issue #15 asks: "Tracks: Kann Ladezeit verkürzt werden?" — can loading a track be made faster?

Measured on 2026-09-27 with Playwright (headless Chromium, SwiftShader software WebGL,
`python3 -m http.server`, `js/main.js` instrumented with `performance.now()` marks via a
route override — nothing committed):

| Phase (default track) | Time since navigation |
|---|---|
| ES modules from CDN (three.js, crashcat) parsed, `init()` starts | ~0.7 s |
| all 11 GLB models loaded (`loadModels`, `js/main.js:80-127`, parallel, ~480 KB) | ~0.75–0.85 s |
| `buildTrack` done (`js/main.js:174`) | ~0.9 s (5–30 ms) |
| **light-probe bake** (`probes.bake`, `js/main.js:179-186`) | see below |
| game loop to first frame | +0.3–0.6 s after the bake |

With the bake forced down to 1–4 probes, every track — Bad Säckingen included — reaches its
first frame in **1.6–1.9 s**. Everything except the bake is fast.

The bake is the bottleneck, and it grows with the square of the track's size:

- **Probe count ∝ track area.** `js/main.js:179-184` creates
  `round(hw/4) × 2 × round(hd/4)` probes (min 4 per axis), where `hw`/`hd` are the track's
  half-extents in world units (`computeTrackBounds`, `js/Track.js:419-440`).
- **Cost per probe ∝ scene size.** `LightProbeGrid.bake` (three r185,
  `examples/jsm/lighting/LightProbeGrid.js:221-305`) renders a full cube map (6 scene
  renders) per probe with `far: groundSize` (`js/main.js:186`) — the whole track, every
  cloned track piece (`js/Track.js:130-135`, one draw call each) and the instanced
  forest/grass ring (`js/Track.js:244-272`).

Probe counts today:

| Track | Cells | Probes | Cube-face renders |
|---|---|---|---|
| Default | 16 | 8×2×8 = 128 | 768 |
| The Aerodrome | 102 | 28×2×12 = 672 | 4 032 |
| Northants GP | 92 | 22×2×15 = 660 | 3 960 |
| Styria Ring | 72 | 24×2×15 = 720 | 4 320 |
| The Claypit | 78 | 27×2×15 = 810 | 4 860 |
| Bad Säckingen Altstadt | 320 | 71×2×83 = **11 786** | **70 716** |

Measured per-probe bake cost (SwiftShader, 4×1×4 grid): default ≈ 2.0 s/probe (16 probes
32.7 s, 32 probes 69.1 s — linear), Aerodrome ≈ 3.1 s/probe (16 probes 50.3 s),
Bad Säckingen > 7.5 s/probe (16 probes did not finish in 120 s). Absolute numbers are
software-rendering numbers and far slower than a real GPU; the ratios are what carry over.
Bad Säckingen does ~92× the probes of the default track, each several times as expensive.

The bake is synchronous on the main thread, so the page is frozen (no frame, no input)
until it ends.

The OpenStreetMap surroundings (`loadSurroundings`, `js/main.js:280-295`) do **not** add
to this wait: they load asynchronously after the first frame, from a `localStorage` cache
after the first visit (`fetchOverpass`, `js/OsmTrack.js:67-76`).

## Goal and success criterion

Loading a large track takes a fraction of today's time, without the lighting looking
noticeably different. **Success:** the light-probe grid never exceeds the default track's
128 probes; the default track is byte-for-byte unchanged (still 8×2×8); every preset track
bakes ≤ 128 probes (Bad Säckingen: 11 786 → 112, ~105× fewer; the Aerodrome circuits
~5–7× fewer); console lines report the probe count and bake time; the in-browser
playtest shows the same look.

## Scope

In scope:

1. A new three-free module `js/ProbeGrid.js` exporting `probeGridSize( halfWidth, halfDepth )`
   → `{ x, y, z }`. Same sizing as today (`round( halfExtent / 4 )` probes per horizontal
   axis, at least 4, 2 layers) until the horizontal grid would exceed
   `MAX_GROUND_PROBES = 64` (the default track's 8×8); above that, both axes shrink by the
   same factor so the grid keeps its aspect ratio and stays ≤ 64, never below 4 per axis.
2. `js/main.js` uses it for the `LightProbeGrid` constructor instead of the inline
   `Math.max( 4, Math.round( … / 4 ) )` arithmetic.
3. `js/main.js` logs the bake per the repo's logging rule (before + after): a
   `console.info` with the probe count and grid before `probes.bake`, and one with the
   probe count and the measured bake time in ms after it returns.
4. Unit tests `test/probe-grid.test.mjs` (`node --test`), and a Playwright before/after
   measurement.
5. A player-facing entry in `CHANGELOG.md` `[Unreleased]`.

Out of scope:

- A loading indicator or a cancel button — that is issue #14.
- Instancing track pieces (`placePiece` clones one mesh per cell, `js/Track.js:323-335`) to
  cut draw calls per cube face; lowering `cubemapSize` (32) or the bake's `far` plane.
  Each would cut the per-probe cost further; none is needed to meet the goal, each changes
  more code or the look. Candidate follow-ups if the capped bake is still too slow on
  real hardware.
- Pre-baking probe data into committed files per preset — it would not help `?map=` tracks
  from the editor or the OSM builder, and needs a readback/serialisation path three's
  `LightProbeGrid` does not offer.
- Moving the bake off the first frame (progressive bake across frames) — total work stays
  the same; it is a UX change that belongs with #14.

## Design

### `js/ProbeGrid.js`

```js
const PROBE_SPACING = 4;       // one probe per 4 units of half-extent, as before
const MIN_PROBES = 4;          // per horizontal axis, as before
const PROBE_LAYERS = 2;        // vertical probe layers, as before
export const MAX_GROUND_PROBES = 64; // the default track's 8 × 8 — larger tracks get a coarser grid

export function probeGridSize( halfWidth, halfDepth ) {
	const x = Math.max( MIN_PROBES, Math.round( halfWidth / PROBE_SPACING ) );
	const z = Math.max( MIN_PROBES, Math.round( halfDepth / PROBE_SPACING ) );
	if ( x * z <= MAX_GROUND_PROBES ) return { x, y: PROBE_LAYERS, z };
	return shrinkToBudget( x, z );
}
```

`shrinkToBudget` divides both axes by `sqrt( x·z / 64 )`, floors, clamps each to ≥ 4, and
then trims the longer axis to `floor( 64 / shorter )` so a very elongated track still fits
the budget. No three.js import, so Node can test it (same pattern as `js/Tracks.js`,
`js/race/TrackPath.js`).

Resulting grids: Default 8×2×8 (unchanged), Aerodrome 12×2×5, Northants 9×2×6,
Styria 10×2×6, Claypit 10×2×5, Bad Säckingen 7×2×8.

### `js/main.js`

```js
const grid = probeGridSize( hw, hd );
const probes = new LightProbeGrid( hw * 2, probeHeight, hd * 2, grid.x, grid.y, grid.z );
probes.position.set( … );
console.info( `Baking lighting: ${ grid.x * grid.y * grid.z } probes (${ grid.x }x${ grid.y }x${ grid.z })…` );
const bakeStart = performance.now();
probes.bake( renderer, scene, { cubemapSize: 32, near: 0.1, far: groundSize } );
console.info( `Lighting baked: ${ grid.x * grid.y * grid.z } probes in ${ Math.round( performance.now() - bakeStart ) } ms` );
```

### Why lighting should not visibly change

The probes only carry low-frequency indirect light (9 SH coefficients each); direct light
and shadows come from `dirLight` (`js/main.js:50-57`). The ground is flat and uniformly lit,
so the irradiance field varies slowly, and the OSM buildings are added after the bake
(`js/main.js:283`), so they were never in the probes anyway.

Probe spacing (grid width / (probes − 1)), today → capped:

| Track | Today | Capped |
|---|---|---|
| Default | 8.6 world units | 8.6 (unchanged) |
| Aerodrome circuits | ~8.3 | 20–30 (≈ 2.7–4 cells) |
| Bad Säckingen | ~8.1 | ~95 (≈ 12.7 cells) |

Bad Säckingen's grid becomes coarse. Its surroundings are mostly the flat grass area that
`buildTrack` lays out for OSM tracks (`js/Track.js:182-208`), so there is little indirect
variation for a finer grid to capture. If the playtest shows a visible difference,
`MAX_GROUND_PROBES` is the one knob: 256 gives Bad Säckingen 14×2×17 (~25× fewer probes than
today instead of 105×) and leaves the default track unchanged.

## Testing

- `node --test test/*.test.mjs`: `test/probe-grid.test.mjs` — default track size unchanged
  (8×2×8); small track keeps the 4-per-axis minimum; every preset stays ≤ 64 ground
  probes; a very elongated track stays ≥ 4 on its short axis and ≤ 64; Bad Säckingen's
  size → 7×2×8.
- Playwright (manual gate for this buildless stack): per preset, the page logs
  `Baking lighting: N probes` with N ≤ 128, reaches its first frame, console has no errors;
  before/after bake time recorded for the default track and The Aerodrome.
- Visual playtest: default track and one Aerodrome circuit look the same as before.
