# Track loading — show progress and allow cancelling

Date: 2026-09-27 · Status: approved (enrich --quick) · Issue #14

## Problem

Picking a track from the Tracks menu reloads `index.html?map=…[&osm=…]`
(`js/Tracks.js:19-24`). Until the first frame renders the player sees a grey/black page with no
hint what is happening or how long it takes, and there is no way out except the browser's back
button. What happens during that time, in order:

1. **Engine** — the browser resolves the import map: three.js from jsdelivr and crashcat from
   esm.sh (`index.html:59-67`). `js/main.js` does not run until every import is fetched.
2. **Models** — 11 GLB files load in parallel (`js/main.js:72-127`).
3. **Track** — `buildTrack` (`js/main.js:174`), wall colliders and physics world
   (`js/main.js:193-219`).
4. **Lighting** — `probes.bake( … )` (`js/main.js:186`), synchronous, blocks the main thread.
5. **Surroundings** (OSM tracks only, e.g. "Bad Säckingen Altstadt") — `loadSurroundings`
   (`js/main.js:280-296`) fetches Overpass through up to four mirrors with a 45 s timeout each
   (`js/OsmTrack.js:26-31`, `:67-111`) and then builds buildings/streets
   (`js/OsmScene.js:21-36`). The car is already drivable; the only feedback is an English
   minimap note "Loading surroundings…" (`js/main.js:282`). Worst case is ~3 minutes before
   "Surroundings unavailable" appears, and it cannot be stopped.

If a model fails to load, `init()` rejects unhandled (`js/main.js:436`) and the page stays blank.

## Goal and success criterion

While a track loads, the player sees **what is being done** and **how far it is (in %)**, and can
**cancel**. **Success:** picking "Bad Säckingen Altstadt" shows the steps ticking through with a
rising percentage; pressing *Cancel* while the surroundings load stops the download and leaves
the player driving the track without houses; pressing *Cancel* before the track is drivable
returns to the track the player came from.

## Scope

In scope:

1. A loading panel visible from the first paint of `index.html` until loading ends: step label,
   overall percent, a progress bar, elapsed seconds, and a *Cancel* button. German and English
   (`window.GG_LANG`, `gg-langchange`).
2. Step labels, with sub-progress where it is real:
   - Engine — "Loading game engine…" (no sub-progress; percent stays at the stage start)
   - Models — "Loading models (7/11)…"
   - Track — "Building the track…"
   - Lighting — "Calculating lighting…"
   - Surroundings — "Loading surroundings from overpass.osm.ch (server 1/4)…", then
     "Building houses and streets…"
3. Overall percent from fixed stage weights (Engine 10, Models 40, Track 10, Lighting 20,
   Surroundings 20), renormalised over the stages this track actually has (no Surroundings on a
   non-OSM track). Within a stage the percent moves by sub-steps done/total. Never goes backward;
   100 % right before the panel hides.
4. Cancel semantics:
   - **Before the car is drivable** (Engine … Lighting): navigate back to the page the player came
     from if `document.referrer` is this game's `index.html` with a different URL, otherwise to
     `index.html` (the default track). If neither differs from the current URL (loading the
     default track directly), the button is hidden. Navigation uses `location.replace`, so the
     cancelled load does not stay in the browser history.
   - **While surroundings load**: abort the Overpass request (no further mirrors are tried), skip
     the building step, hide the panel, and set the minimap note to "Surroundings skipped".
5. The panel is modal (dimmed backdrop) until the car is drivable, then shrinks to a compact,
   non-blocking panel for the Surroundings stage so driving continues.
6. A load failure (a model or the engine import rejects) shows "Loading failed" in the panel,
   keeps the button (labelled "Back"), instead of a silent blank page.
7. `fetchOverpass` accepts an optional `signal` (AbortSignal); `onTry` additionally receives the
   mirror index and count. Existing callers (`osm-track.html:271`, `tools/osm-fixture.mjs:9`,
   `tools/osm-presets.mjs:88`) keep working unchanged.
8. The two existing English-only minimap notes ("Loading surroundings…", "Surroundings
   unavailable", `js/main.js:282,293,300`) become de/en strings; "Loading surroundings…" is no
   longer shown there (the panel shows it).

Out of scope:

- Making loading faster (caching, parallelising, lighter models) — issue #15.
- Progress/cancel inside `osm-track.html` (the track builder page) and `editor.html`.
- Byte-accurate download progress (Overpass sends no reliable `Content-Length`; GLBs are tiny).
- Cancelling the Engine stage's CDN downloads themselves — cancelling navigates away, which ends
  them.

## Architecture

```
index.html
  #load-overlay (static markup, visible at first paint)
  <script type="module"> import { loadOverlay } from './js/ui/LoadOverlay.js'   ← runs before the CDN graph resolves
  <script type="module" src="js/main.js">  also imports loadOverlay (same module instance)

js/LoadProgress.js   pure, no DOM   — stage weights, percent, current step; cancelTarget()
js/ui/LoadOverlay.js DOM            — renders a LoadProgress into #load-overlay, cancel button, modes
js/ui/strings.js     + 'load.*' keys (en, de)
js/OsmTrack.js       fetchOverpass( query, { signal, onTry( host, index, count ) } )
js/OsmScene.js       loadSurroundings( …, { signal, onStep } )
js/main.js           drives the overlay through the stages
```

### `js/LoadProgress.js` (pure)

```js
export const STAGE_WEIGHTS = { engine: 10, models: 40, track: 10, lighting: 20, surroundings: 20 };

export class LoadProgress {
	constructor( stages )                 // e.g. [ 'engine', 'models', 'track', 'lighting' ]
	begin( stage, detail = {} )           // enter a stage; detail feeds the label ({ host, index, count })
	step( done, total, detail = {} )      // sub-progress inside the current stage
	finish()                              // everything done → percent 100
	get stage()                           // current stage id, or 'done'
	get detail()                          // last detail object
	get percent()                         // integer 0..100, monotonic
	onChange                              // callback property, called after every change
}

// strings.js key for the current label: 'load.<stage>', or for surroundings
// 'load.surroundings' (no mirror yet / cache), 'load.fetch' (mirror known), 'load.build'.
export function labelKey( stage, detail ) → string

// Where Cancel goes before the car is drivable, or null when there is nowhere else to go.
export function cancelTarget( currentHref, referrer ) → string | null
```

`percent` = (sum of weights of finished stages + weight(current) × done/total) ÷ sum of weights of
the configured stages, rounded down, clamped so it never decreases. Unknown stage ids throw
(fail fast).

`cancelTarget`: same origin and same directory as `currentHref`, path ending in `/` or
`/index.html`, and not equal to `currentHref` → `referrer`; else `new URL( 'index.html',
currentHref ).href` if that differs from `currentHref`; else `null`.

### `js/ui/LoadOverlay.js` (DOM)

A singleton bound to `#load-overlay` (`loadOverlay()` returns the same instance to the inline
module and to `main.js`). `index.html` holds only the empty `<div id="load-overlay">` and the
backdrop CSS so the dimmed backdrop is there at first paint; `LoadOverlay` builds the box (label,
bar, percent, elapsed seconds, button) and injects the rest of its CSS, like `OsmHud` does
(`js/OsmHud.js:6-54`). Methods: `start( progress, onCancel )` (show modal, render on every
`progress` change), `setCancel( fn | null )` (null hides the button), `compact()`, `fail()`,
`hide()`, and the `progress` getter. Labels via `t( labelKey( stage, detail ), lang, detail )`.
The Cancel button calls `blur()` after a click so a later Space/Enter press does not re-trigger it
(see the i18n `btn.blur()` note in `CLAUDE.md`). Re-renders on `gg-langchange` and once a second
for the elapsed time (seconds since navigation start, `performance.now()`).

The inline module in `index.html` creates a `LoadProgress` with the stage list for this URL
(`surroundings` only when both `map` and `osm` are present), begins `engine`, and installs the
"navigate to `cancelTarget(…)`" cancel handler. `main.js` imports the same `loadOverlay()` and
continues with `loadOverlay().progress`: `begin('models')` → `step(n, 11)` per GLB → `begin('track')` → `begin('lighting')`
(followed by a short wait — `requestAnimationFrame` raced with a 50 ms timeout, so a
background tab does not stall loading — so the label paints before the synchronous bake) →
car drivable → either `finish()` + `hide()` or `compact()` + `begin('surroundings')` with
a new cancel handler that aborts an `AbortController`.

### OSM changes

`fetchOverpass`: when `signal` is aborted (before or during a mirror request), stop the loop and
throw an error with `name === 'AbortError'`; the per-mirror timeout still produces a "timeout" entry
for that mirror and moves on. `onTry( host, index, count )` — `index` 1-based.

`loadSurroundings( scene, param, trackCells, area, cellSize, { signal, onStep } = {} )`: passes
`signal` and an `onTry` that calls `onStep( 'fetch', { host, index, count } )`, then
`onStep( 'build' )` before building meshes. If aborted after the fetch but before adding meshes,
nothing is added to the scene.

`main.js`: on `AbortError` → note `load.skipped`; on other errors → note `load.surroundingsFailed`.

## Error handling

- `init()` gets a `.catch` that logs the error and calls `loadOverlay().fail()`.
- A stage id not in `STAGE_WEIGHTS`, or `step()` with `total <= 0`, throws.
- `fetchOverpass` abort is not cached and not reported as a mirror failure.

## Testing

- Node (`node --test test/*.test.mjs`, 159 passing on `main` today):
  `test/load-progress.test.mjs` for `LoadProgress` and `cancelTarget`; new cases in
  `test/osm-track.test.mjs` for `signal` and the extended `onTry`; `test/strings.test.mjs`
  parity covers the new keys automatically.
- Playwright (foreground, not committed): a harness page `test/harness/load.html` drives
  `LoadOverlay` through all stages (modal → compact, labels in de and en, percent monotonic,
  cancel handler fires, button hidden when `cancelTarget` is null, `fail()` text). A second check
  opens `index.html?map=…&osm=…` (Bad Säckingen preset) with Overpass requests routed to a
  never-answering handler, waits for the compact Surroundings panel, clicks Cancel, and asserts
  the panel hides, the minimap note says "Surroundings skipped", and no second mirror was requested.
  This second check needs CDN access (jsdelivr, esm.sh); if blocked, record that in the PR.
