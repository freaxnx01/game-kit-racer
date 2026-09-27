# Track Load Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut track load time by capping the light-probe bake — which dominates loading and grows with the square of the track size — at the default track's 128 probes. Closes #15.

**Architecture:** A new three-free module `js/ProbeGrid.js` computes the `LightProbeGrid` resolution (same sizing as today, but the horizontal grid is capped at 64 = the default track's 8×8, shrunk evenly on both axes). `js/main.js` uses it instead of its inline arithmetic and logs the bake before and after (probe count, ms). Nothing else in the load path changes.

**Tech Stack:** Plain ES modules (three.js r185 + crashcat via import map, untouched), Node's built-in `node:test`, Python Playwright (not committed) for the in-browser check.

**Spec:** `docs/superpowers/specs/2026-09-27-track-load-time-design.md`

## Global Constraints

- Static files only — no bundler, no `package.json`, no new dependencies.
- Code style = upstream mrdoob style: tabs, spaces inside parentheses/brackets, blank line after a block-opening `{` and before its `}`, `const`/`let`, no commented-out code. Test names `functionName_state_expectedBehavior`.
- Run all unit tests with `node --test test/*.test.mjs` (159 pass on `main` at 7be506c; +6 after this plan). Use the glob — `node --test test/` also picks up `test/harness/` and fails.
- `MAX_GROUND_PROBES = 64`; `PROBE_SPACING = 4`; `MIN_PROBES = 4`; `PROBE_LAYERS = 2`. The default track must stay exactly 8×2×8.
- `js/ProbeGrid.js` must not import `three` (Node imports it directly).
- Line numbers below refer to `main` at 7be506c; locate by the quoted code if they drifted.
- Commit per task, Conventional Commits, message ending with exactly these two trailer lines:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01WVkTufc2PiJjhhrWptUPLA`
- Run Playwright in the **foreground** (never backgrounded) with a generous `timeout`; commit and push before running it.
- Headless Chromium here renders with SwiftShader (software): a bake costs ~2–7 s **per probe**. Never wait for a full bake of more than ~130 probes.

## Review Focus

1. **Default track unchanged** — the original starter-kit circuit (no `?map=`) must keep 8×2×8 and look identical. → Task 1 `probeGridSize_defaultTrack_isUnchanged`.
2. **Very long, thin track** (an OSM street along a river) — the short axis must keep ≥ 4 probes and the grid must still fit the budget. → Task 1 `probeGridSize_elongatedTrack_keepsMinimumAndBudget` (both orientations).
3. **Tiny custom track** from the editor (2×2 cells) — keeps the 4-per-axis minimum, no zero or NaN sizes. → Task 1 `probeGridSize_tinyTrack_keepsMinimumOfFour`.
4. **Every shipped preset** stays ≤ 128 probes, incl. Bad Säckingen (320 cells, 74×87 grid). → Task 1 `probeGridSize_everyPreset_staysWithinBudget` + Task 2 Playwright probe-count check.
5. **Invalid `?map=`** falls back to the default track (`js/main.js:140-149`) and must bake 128 probes, not crash. → Task 2 Playwright check with `?map=!!!!`.

---

### Task 1: `probeGridSize` — capped light-probe grid sizing

**Files:**
- Create: `js/ProbeGrid.js`
- Test: `test/probe-grid.test.mjs`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `probeGridSize( halfWidth: number, halfDepth: number ) → { x: number, y: number, z: number }` and `MAX_GROUND_PROBES = 64`, both exported from `js/ProbeGrid.js`. `halfWidth`/`halfDepth` are `computeTrackBounds( cells ).halfWidth/.halfDepth` (`js/Track.js:419-440`, world units).

- [ ] **Step 1: Write the failing test**

Create `test/probe-grid.test.mjs`:

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeGridSize, MAX_GROUND_PROBES } from '../js/ProbeGrid.js';
import { PRESET_TRACKS } from '../js/Tracks.js';

const CELL = 9.99 * 0.75;

// Same byte layout and bounds as decodeCells / computeTrackBounds in js/Track.js (which needs three.js, so not imported here)
function halfExtents( map ) {

	if ( ! map ) return { hw: 30, hd: 30 };

	const bytes = Buffer.from( map.replace( /-/g, '+' ).replace( /_/g, '/' ), 'base64' );
	const xs = [], zs = [];
	for ( let i = 0; i + 2 < bytes.length; i += 3 ) {

		xs.push( bytes[ i ] - 128 );
		zs.push( bytes[ i + 1 ] - 128 );

	}

	return {
		hw: ( Math.max( ...xs ) - Math.min( ...xs ) + 1 ) / 2 * CELL + CELL,
		hd: ( Math.max( ...zs ) - Math.min( ...zs ) + 1 ) / 2 * CELL + CELL,
	};

}

test( 'probeGridSize_defaultTrack_isUnchanged', () => {

	assert.deepEqual( probeGridSize( 30, 30 ), { x: 8, y: 2, z: 8 } );

} );

test( 'probeGridSize_tinyTrack_keepsMinimumOfFour', () => {

	assert.deepEqual( probeGridSize( 2 * CELL, 2 * CELL ), { x: 4, y: 2, z: 4 } );
	assert.deepEqual( probeGridSize( 0, 0 ), { x: 4, y: 2, z: 4 } );

} );

test( 'probeGridSize_everyPreset_staysWithinBudget', () => {

	for ( const track of PRESET_TRACKS ) {

		const { hw, hd } = halfExtents( track.map );
		const { x, y, z } = probeGridSize( hw, hd );
		assert.ok( x * z <= MAX_GROUND_PROBES, `${ track.id }: ${ x }x${ z }` );
		assert.ok( x >= 4 && z >= 4, track.id );
		assert.equal( y, 2, track.id );

	}

} );

test( 'probeGridSize_badSaeckingen_shrinksToSevenByEight', () => {

	const track = PRESET_TRACKS.find( ( t ) => t.id === 'bad-saeckingen' );
	const { hw, hd } = halfExtents( track.map );
	assert.deepEqual( probeGridSize( hw, hd ), { x: 7, y: 2, z: 8 } );

} );

test( 'probeGridSize_aerodrome_keepsAspectRatio', () => {

	const track = PRESET_TRACKS.find( ( t ) => t.id === 'aero' );
	const { hw, hd } = halfExtents( track.map );
	assert.deepEqual( probeGridSize( hw, hd ), { x: 12, y: 2, z: 5 } );

} );

test( 'probeGridSize_elongatedTrack_keepsMinimumAndBudget', () => {

	assert.deepEqual( probeGridSize( 400, 16 ), { x: 16, y: 2, z: 4 } );
	assert.deepEqual( probeGridSize( 16, 400 ), { x: 4, y: 2, z: 16 } );

} );
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/probe-grid.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `js/ProbeGrid.js`.

- [ ] **Step 3: Write minimal implementation**

Create `js/ProbeGrid.js`:

```js
// Light-probe grid size for main.js. The bake renders a cube map of the whole scene per probe, so a
// grid that grows with the track area made large tracks load for minutes (#15): cap it at the
// default track's 8 × 8. No three.js import, so Node tests can load it.

const PROBE_SPACING = 4; // one probe per 4 units of half-extent
const MIN_PROBES = 4; // per horizontal axis
const PROBE_LAYERS = 2;

export const MAX_GROUND_PROBES = 64;

export function probeGridSize( halfWidth, halfDepth ) {

	const x = Math.max( MIN_PROBES, Math.round( halfWidth / PROBE_SPACING ) );
	const z = Math.max( MIN_PROBES, Math.round( halfDepth / PROBE_SPACING ) );
	if ( x * z <= MAX_GROUND_PROBES ) return { x, y: PROBE_LAYERS, z };
	return shrinkToBudget( x, z );

}

// Both axes shrink by the same factor (keeps the aspect ratio); the longer one is trimmed so a
// thin track whose short axis sits at the minimum still fits the budget.
function shrinkToBudget( x, z ) {

	const factor = Math.sqrt( x * z / MAX_GROUND_PROBES );
	const sx = Math.max( MIN_PROBES, Math.floor( x / factor ) );
	const sz = Math.max( MIN_PROBES, Math.floor( z / factor ) );
	if ( sx >= sz ) return { x: Math.min( sx, Math.floor( MAX_GROUND_PROBES / sz ) ), y: PROBE_LAYERS, z: sz };
	return { x: sx, y: PROBE_LAYERS, z: Math.min( sz, Math.floor( MAX_GROUND_PROBES / sx ) ) };

}
```

- [ ] **Step 4: Run the tests and make sure they pass**

Run: `node --test test/probe-grid.test.mjs` → Expected: 6 pass.
Run: `node --test test/*.test.mjs` → Expected: all pass (165 on 7be506c; more if `main` gained tests), 0 fail.

- [ ] **Step 5: Commit**

```bash
git add js/ProbeGrid.js test/probe-grid.test.mjs
git commit -m "feat(track): cap the light-probe grid at the default track's size

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WVkTufc2PiJjhhrWptUPLA"
```

---

### Task 2: Use the capped grid in `main.js`, log the bake, changelog, in-browser check

**Files:**
- Modify: `js/main.js:1-27` (imports), `js/main.js:176-187` (probe grid + bake)
- Modify: `CHANGELOG.md` (`## [Unreleased]`)

**Interfaces:**
- Consumes: `probeGridSize( halfWidth, halfDepth ) → { x, y, z }` from `js/ProbeGrid.js` (Task 1).
- Produces: console lines `Baking lighting: <N> probes (<x>x<y>x<z>)…` before and `Lighting baked: <N> probes in <ms> ms` after the bake — the Playwright check below and any later load-time work (#14) key on them.

- [ ] **Step 1: Wire it in**

In `js/main.js`, add after the `import { CpuPanel } from './ui/CpuPanel.js';` line (line 27):

```js
import { probeGridSize } from './ProbeGrid.js';
```

Replace this block (lines 178-186):

```js
	const probeHeight = 6;
	const probes = new LightProbeGrid(
		hw * 2, probeHeight, hd * 2,
		Math.max( 4, Math.round( hw / 4 ) ),
		2,
		Math.max( 4, Math.round( hd / 4 ) ),
	);
	probes.position.set( bounds.centerX, probeHeight / 2, bounds.centerZ );
	probes.bake( renderer, scene, { cubemapSize: 32, near: 0.1, far: groundSize } );
```

with:

```js
	const probeHeight = 6;
	const grid = probeGridSize( hw, hd );
	const probeCount = grid.x * grid.y * grid.z;
	const probes = new LightProbeGrid( hw * 2, probeHeight, hd * 2, grid.x, grid.y, grid.z );
	probes.position.set( bounds.centerX, probeHeight / 2, bounds.centerZ );
	console.info( `Baking lighting: ${ probeCount } probes (${ grid.x }x${ grid.y }x${ grid.z })…` );
	const bakeStart = performance.now();
	probes.bake( renderer, scene, { cubemapSize: 32, near: 0.1, far: groundSize } );
	console.info( `Lighting baked: ${ probeCount } probes in ${ Math.round( performance.now() - bakeStart ) } ms` );
```

- [ ] **Step 2: Syntax and unit check**

Run: `node --check js/main.js && node --test test/*.test.mjs`
Expected: no syntax error; all tests pass.

- [ ] **Step 3: Changelog entry**

In `CHANGELOG.md` under `## [Unreleased]`, add (create the `### Changed` heading after `### Added` if it does not exist yet; append to it if it does):

```markdown
### Changed

- Tracks load much faster, most of all the big ones: "Bad Säckingen Altstadt"
  used to keep you waiting for a long time, the Aerodrome circuits several times
  longer than the starter circuit. The starter circuit loads as before.
```

- [ ] **Step 4: Commit and push before verifying**

```bash
git add js/main.js CHANGELOG.md
git commit -m "perf(track): bake at most 128 light probes and log the bake time

Closes #15

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WVkTufc2PiJjhhrWptUPLA"
git push -u origin HEAD
```

- [ ] **Step 5: Playwright — probe counts on every track (fast)**

Serve the repo in the background on a free port (`python3 -m http.server 18915 --bind 127.0.0.1`), then run this script **in the foreground** (`timeout` 600000). It reads only the *before* line, so it does not wait for the bakes. Save it outside the repo (scratch dir), never commit it.

```python
import re, sys
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:18915/index.html"
src = open("js/Tracks.js").read() + open("js/OsmPresets.js").read()
urls = {"invalid-map": BASE + "?map=!!!!"}
for m in re.finditer(r"id: '([a-z-]+)'.*?map: (null|'[^']*')(?:, osm: '([^']*)')?", src):
    tid, mp, osm = m.groups()
    urls[tid] = BASE if mp == "null" else BASE + "?map=" + mp.strip("'") + ("&osm=" + osm if osm else "")

expected = {"default": "8x2x8", "invalid-map": "8x2x8", "aero": "12x2x5", "bad-saeckingen": "7x2x8"}
failures = []
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    for tid, url in urls.items():
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        with page.expect_console_message(lambda m: m.text.startswith("Baking lighting:"), timeout=60000) as msg:
            page.goto(url)
        text = msg.value.text
        n, grid = re.match(r"Baking lighting: (\d+) probes \((\S+)\)", text).groups()
        ok = int(n) <= 128 and not errors and (tid not in expected or grid == expected[tid])
        print(tid, n, grid, "OK" if ok else "FAIL", errors)
        if not ok: failures.append(tid)
        page.close()
    browser.close()
sys.exit(1 if failures else 0)
```

Expected: every line `OK`; `default` and `invalid-map` `128 8x2x8`, `aero 120 12x2x5`, `bad-saeckingen 112 7x2x8`, the other presets 100–120. Exit code 0.

- [ ] **Step 6: Playwright — measured bake time (slow, one track)**

Same server. Load The Aerodrome and wait for the *after* line (SwiftShader: expect roughly 120 probes × ~3 s ≈ 6 min; `timeout` 900000, foreground):

```python
import re
from playwright.sync_api import sync_playwright

src = open("js/Tracks.js").read()
aero = re.search(r"id: 'aero'.*?map: '([^']*)'", src).group(1)
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page()
    with page.expect_console_message(lambda m: m.text.startswith("Lighting baked:"), timeout=880000) as msg:
        page.goto("http://127.0.0.1:18915/index.html?map=" + aero)
    print(msg.value.text)
    page.wait_for_timeout(3000)
    assert page.locator("canvas").count() > 0
    browser.close()
```

Record the printed `Lighting baked: 120 probes in … ms` in the PR description next to the spec's "before" (672 probes at ≈ 3.1 s/probe in SwiftShader ≈ 35 min for the same track). On a machine with a GPU, also record the default track's and Bad Säckingen's `Lighting baked` lines from a normal browser (DevTools console).

- [ ] **Step 7: Visual playtest**

In a real browser: the starter circuit and The Aerodrome look the same as on `main` (compare screenshots from the same camera spot after the start); Bad Säckingen shows no obviously dark or blotchy patches along the track. If Bad Säckingen does, raise `MAX_GROUND_PROBES` in `js/ProbeGrid.js` to 256, update the two expected grids in `test/probe-grid.test.mjs` (Bad Säckingen → `{ x: 14, y: 2, z: 17 }`, Aerodrome → `{ x: 24, y: 2, z: 10 }`, elongated `400, 16` → `{ x: 64, y: 2, z: 4 }` and `16, 400` → `{ x: 4, y: 2, z: 64 }`) and note it in the PR.

- [ ] **Step 8: Open the PR**

Title: `perf(track): bake at most 128 light probes (#15)`. Body: summary, the probe table from Step 5, the bake time from Step 6, the playtest result from Step 7, `Closes #15`.
