# CPU Trucks on the Minimap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** During a vs-CPU race, show every CPU truck as a dot in its truck colour on the minimap, under the player's arrow. Closes #18.

**Architecture:** A new pure query `CpuRace.markers()` returns `{ x, z, colour }` per CPU driver from the pose the truck is drawn at. `Hud.update()` in `js/OsmHud.js` takes an optional `others` list and draws static layer → CPU dots → player arrow. `main.js` passes `cpuRace.markers()` — one changed line.

**Tech Stack:** Plain ES modules (no build), canvas 2D, Node's built-in `node:test`, Playwright (not committed) for the headless harness check.

**Spec:** `docs/superpowers/specs/2026-09-27-cpu-minimap-markers-design.md`

## Global Constraints

- Static files only — no bundler, no `package.json`, no committed `node_modules` (browser-game stack).
- `js/race/CpuRace.js` stays pure: no `three`, no `crashcat`, no DOM.
- Marker colours, in truck-index order (same order as `TRUCKS` in `js/race/Opponents.js:8`: green, purple, red): `'#3fbf5f'`, `'#a066d6'`, `'#e04848'`. Dot radius 4 px, outline 1.5 px `rgba(10,12,14,0.9)`. Player arrow unchanged (`#ff6e3a`, white outline) and drawn last.
- `Hud.update( x, z, forwardX, forwardZ, others = [] )` — the default keeps every existing caller working unchanged.
- Minimap size, position and phone-width layout unchanged.
- Touch `js/race/CpuRace.js` and `js/main.js` only as described (one appended method, one changed line): issue #13 (CPU race fixes) edits the same files in parallel.
- Code style = upstream mrdoob style: tabs, spaces inside parentheses/brackets, blank line after a block-opening `{` and before its `}`, `const`/`let`, no commented-out code. Test names `functionName_state_expectedBehavior`. Run all unit tests with `node --test test/*.test.mjs`.
- CHANGELOG: hand-written player-facing entry under `[Unreleased]`, German, `Du`/`Dir` capitalised, real umlauts. Never run `git cliff -o CHANGELOG.md`.
- Commits: Conventional Commits with the two trailer lines shown in each commit step.

## Review Focus

1. **A CPU truck on the same spot as you** (grid neighbours, bumping) — your arrow must stay visible on top. → Task 2 harness check `cpus`: a marker placed exactly under the player, pixel there is orange.
2. **Quit race mid-race** — dots disappear with the trucks. → Task 1 `markers_afterQuit_isEmpty`.
3. **Rematch / Start again** — only the new race's dots, never doubled. → Task 1 `markers_afterRematch_oneDotPerCpu`.
4. **Solo driving and multiplayer races** — minimap unchanged, no stray dots. → Task 1 `markers_noRace_isEmpty` + Task 2 `generic` check still passes.
5. **Race with a single CPU** — one green dot, matching the green truck. → Task 1 `markers_oneCpu_singleGreenDot`.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `js/race/CpuRace.js` | modify | `markers()` query |
| `test/cpu-race.test.mjs` | modify | `markers()` tests |
| `js/OsmHud.js` | modify | `MARKER_COLOURS`, `update(…, others)`, `clearToStatic()`, `drawMarker()` |
| `test/harness/hud.html` | modify | `?cpus` mode |
| `js/main.js` | modify | pass `cpuRace.markers()` to `hud.update` |
| `CHANGELOG.md` | modify | Player-facing entry |

---

### Task 1: `CpuRace.markers()`

**Files:**
- Modify: `js/race/CpuRace.js` (add a method right after `view()`, ~line 257)
- Test: `test/cpu-race.test.mjs`

**Interfaces:**
- Consumes: `this.drivers` (`Map` cpu id → `CpuDriver`, insertion order = CPU index 0…n−1, `CpuRace.js:197`), `CpuDriver.state() → { p: [ x, y, z ], q, v }`.
- Produces: `CpuRace.prototype.markers() → Array<{ x: number, z: number, colour: number }>` — one entry per CPU in CPU-index order, `colour` = that index (0–2), `[]` when no race exists.

- [ ] **Step 1: Write the failing tests**

In `test/cpu-race.test.mjs`, change the `RaceState` import line to also import `PHASE`:

```js
import { COUNTDOWN_MS, RESULTS_GRACE_MS, PHASE, gridSlots } from '../js/race/RaceState.js';
```

Append at the end of the file:

```js
test( 'markers_noRace_isEmpty', () => {

	const race = new CpuRace( fakeGame(), { now: () => 0 } );
	assert.deepEqual( race.markers(), [] );

} );

test( 'markers_duringCountdown_oneDotPerCpuOnItsGridPose', () => {

	const { race } = setup();
	assert.equal( race.view().phase, PHASE.COUNTDOWN );
	const markers = race.markers();
	assert.equal( markers.length, 3 );
	[ ...race.drivers.values() ].forEach( ( driver, i ) => {

		const { p } = driver.state();
		assert.deepEqual( markers[ i ], { x: p[ 0 ], z: p[ 2 ], colour: i } );

	} );

} );

test( 'markers_whileRacing_followTheDrivers', () => {

	const { race, step, runUntil } = setup();
	const grid = race.markers();
	runUntil( () => race.view().phase === PHASE.RACING );
	for ( let n = 0; n < 150; n ++ ) step( 20 );
	const markers = race.markers();
	[ ...race.drivers.values() ].forEach( ( driver, i ) => {

		const { p } = driver.state();
		assert.deepEqual( markers[ i ], { x: p[ 0 ], z: p[ 2 ], colour: i } );
		assert.ok( Math.hypot( markers[ i ].x - grid[ i ].x, markers[ i ].z - grid[ i ].z ) > 1, `cpu ${ i } moved away from the grid` );

	} );

} );

test( 'markers_afterQuit_isEmpty', () => {

	const { race, step } = setup();
	step( COUNTDOWN_MS + 500 );
	race.quit();
	assert.deepEqual( race.markers(), [] );

} );

test( 'markers_afterRematch_oneDotPerCpu', () => {

	const { race } = setup( { cpus: 2, difficulty: 'easy', laps: 1 } );
	race.rematch();
	assert.deepEqual( race.markers().map( ( m ) => m.colour ), [ 0, 1 ] );

} );

test( 'markers_oneCpu_singleGreenDot', () => {

	const { race } = setup( { cpus: 1, difficulty: 'easy', laps: 1 } );
	assert.deepEqual( race.markers().map( ( m ) => m.colour ), [ 0 ] );

} );
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/cpu-race.test.mjs`
Expected: the six `markers_*` tests FAIL with `TypeError: race.markers is not a function`; all earlier tests still pass.

- [ ] **Step 3: Implement `markers()`**

In `js/race/CpuRace.js`, directly after the closing `}` of `view()` (before the `// ── Internals ──` comment), add:

```js
	// Minimap dots: where each CPU truck is drawn, and its truck colour index (0–2, as given to opponents.add).
	markers() {

		return [ ...this.drivers.values() ].map( ( driver, colour ) => {

			const { p } = driver.state();
			return { x: p[ 0 ], z: p[ 2 ], colour };

		} );

	}
```

Do not otherwise edit `CpuRace.js` (#13 works in the same file).

- [ ] **Step 4: Run all tests to verify they pass**

Run: `node --test test/*.test.mjs`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add js/race/CpuRace.js test/cpu-race.test.mjs
git commit -F - <<'MSG'
feat(cpu): expose CPU truck positions for the minimap

Refs #18

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WVkTufc2PiJjhhrWptUPLA
MSG
```

---

### Task 2: Draw the dots on the minimap

**Files:**
- Modify: `js/OsmHud.js:4` (new export), `:104-110` (`update`), `:182-205` (`drawCar` split)
- Test: `test/harness/hud.html` (new `?cpus` mode), Playwright check from the Appendix

**Interfaces:**
- Consumes: marker objects `{ x, z, colour }` (Task 1 shape; world coordinates, colour = truck index).
- Produces: `export const MARKER_COLOURS = [ '#3fbf5f', '#a066d6', '#e04848' ]`; `Hud.update( x, z, forwardX, forwardZ, others = [] )`; `Hud.clearToStatic()` (command); `Hud.drawMarker( { x, z, colour } )` (command). `Hud.toMap`, `Hud.canvas`, `Hud.dpr` unchanged (the harness reads them).

- [ ] **Step 1: Write the failing harness check**

Edit `test/harness/hud.html`. Replace the line

```js
const generic = new URLSearchParams( location.search ).has( 'generic' );
```

with

```js
const params = new URLSearchParams( location.search );
const generic = params.has( 'generic' );
if ( params.has( 'cpus' ) ) {
	const centre = ( [ gx, gz ] ) => [ ( gx + 0.5 ) * CELL, ( gz + 0.5 ) * CELL ];
	const quarter = ( k ) => track[ Math.floor( track.length * k / 4 ) ]; // spread round the loop so dots never overlap
	const player = centre( quarter( 3 ) );
	const markers = [ 0, 1, 2 ].map( ( colour ) => { const [ x, z ] = centre( quarter( colour ) ); return { x, z, colour }; } );
	const under = { x: player[ 0 ], z: player[ 1 ], colour: 2 }; // a CPU exactly under the player: the arrow must win
	hud.update( player[ 0 ], player[ 1 ], 1, 0, [ ...markers, under ] );
	window.harness = { hud, markers, player };
	window.__done = true;
	await new Promise( () => {} ); // stop here
}
```

Save the Appendix script as `hud_cpus_check.py` (scratch, not committed).

- [ ] **Step 2: Run the check to verify it fails**

Serve the repo root: `python3 -m http.server 8765` (separate shell). Run: `PORT=8765 python3 hud_cpus_check.py` in the **foreground** (never `run_in_background`).
Expected: FAIL — the marker pixels are track/background colours, not the marker colours (`AssertionError: marker 0 …`).

- [ ] **Step 3: Implement the drawing**

In `js/OsmHud.js`, after `const MAP_W = 190, MAP_H = 130, PAD = 10;` add:

```js
// CPU truck dots, by truck index — same order as TRUCKS in race/Opponents.js (green, purple, red).
export const MARKER_COLOURS = [ '#3fbf5f', '#a066d6', '#e04848' ];
```

Replace `update()` with:

```js
	// World position of the car and its forward direction (unit vector on the ground plane);
	// others: CPU trucks as { x, z, colour } (colour = truck index), drawn under the car.
	update( x, z, forwardX, forwardZ, others = [] ) {

		this.clearToStatic();
		for ( const marker of others ) this.drawMarker( marker );
		this.drawCar( x, z, forwardX, forwardZ );
		if ( this.index ) this.showStreet( this.index.nameAt( x, z ) );

	}
```

Replace the first five lines of `drawCar` (from `const ctx = this.ctx;` through `ctx.scale( this.dpr, this.dpr );`) so the method becomes three methods:

```js
	clearToStatic() {

		const ctx = this.ctx;
		ctx.setTransform( 1, 0, 0, 1, 0, 0 );
		ctx.clearRect( 0, 0, this.canvas.width, this.canvas.height );
		ctx.drawImage( this.staticLayer, 0, 0 );
		ctx.scale( this.dpr, this.dpr );

	}

	drawMarker( { x, z, colour } ) {

		const ctx = this.ctx;
		const [ mx, mz ] = this.toMap( x, z );
		ctx.fillStyle = MARKER_COLOURS[ colour % MARKER_COLOURS.length ];
		ctx.strokeStyle = 'rgba(10,12,14,0.9)';
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.arc( mx, mz, 4, 0, Math.PI * 2 );
		ctx.fill();
		ctx.stroke();

	}

	drawCar( x, z, fx, fz ) {

		const ctx = this.ctx;
		const [ mx, mz ] = this.toMap( x, z );
		const len = Math.hypot( fx, fz ) || 1;
		const ux = fx / len, uz = fz / len;

		ctx.fillStyle = '#ff6e3a';
		ctx.strokeStyle = '#fff';
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.moveTo( mx + ux * 7, mz + uz * 7 );
		ctx.lineTo( mx - ux * 4 - uz * 4.5, mz - uz * 4 + ux * 4.5 );
		ctx.lineTo( mx - ux * 4 + uz * 4.5, mz - uz * 4 - ux * 4.5 );
		ctx.closePath();
		ctx.fill();
		ctx.stroke();

	}
```

- [ ] **Step 4: Run the checks to verify they pass**

Run: `PORT=8765 python3 hud_cpus_check.py`
Expected: `ok cpus`, `ok generic`, `errors []`.
Run: `node --test test/*.test.mjs` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add js/OsmHud.js test/harness/hud.html
git commit -F - <<'MSG'
feat(hud): draw CPU truck dots on the minimap

Dots in the truck colours, under the player's arrow.

Refs #18

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WVkTufc2PiJjhhrWptUPLA
MSG
```

---

### Task 3: Wire it into the game + changelog

**Files:**
- Modify: `js/main.js` (the `hud.update(` line in `animate()`, ~line 426)
- Modify: `CHANGELOG.md` (`## [Unreleased]` → `### Added`)

**Interfaces:**
- Consumes: `cpuRace.markers()` (Task 1), `hud.update( x, z, fx, fz, others )` (Task 2). `cpuRace.update( dt )` already runs earlier in the same frame, so the markers are current.
- Produces: nothing new.

- [ ] **Step 1: Pass the markers**

In `js/main.js`, replace

```js
		hud.update( vehicle.spherePos.x, vehicle.spherePos.z, _forward.x, _forward.z );
```

with

```js
		hud.update( vehicle.spherePos.x, vehicle.spherePos.z, _forward.x, _forward.z, cpuRace.markers() );
```

Change nothing else in `main.js` (#13 edits the CPU wiring around it).

- [ ] **Step 2: Changelog entry**

In `CHANGELOG.md`, under `## [Unreleased]` → `### Added`, append as the last bullet:

```markdown
- Rennen gegen den Computer: Die CPU-Trucks erscheinen jetzt als farbige Punkte
  (grün, lila, rot) auf der Minimap — so siehst Du jederzeit, wer Dir im Nacken
  sitzt, auch wenn er gerade nicht im Bild ist.
```

- [ ] **Step 3: Verify**

Run: `node --test test/*.test.mjs && node --input-type=module --check < js/main.js`
Expected: all pass, no syntax errors. Re-run `PORT=8765 python3 hud_cpus_check.py` — `ok cpus`, `ok generic`, `errors []`.

- [ ] **Step 4: Commit and push the branch before the manual check**

```bash
git add js/main.js CHANGELOG.md
git commit -F - <<'MSG'
feat(cpu): show CPU trucks on the minimap

Closes #18

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WVkTufc2PiJjhhrWptUPLA
MSG
git push -u origin HEAD
```

- [ ] **Step 5: Manual play-test (headless Chromium cannot render the full game here)**

Default track: vs CPU → 3 CPU trucks, medium, 3 laps → Start. Check: during the countdown three dots (green, purple, red) sit on the grid in front of your orange arrow; while racing they move with the trucks of the same colour; your arrow stays visible when you bump a CPU; Quit race removes the dots; Rematch shows three dots again, not six; Free driving and Multiplayer show no dots. Repeat with 1 CPU: one green dot.

---

## Appendix: headless check runner (not committed)

### `cpus` + `generic` — save as `hud_cpus_check.py`, serve the repo root, run `PORT=<port> python3 hud_cpus_check.py`

```python
# Headless check for test/harness/hud.html. Serve the repo root first: python3 -m http.server 8765
import os
from playwright.sync_api import sync_playwright

BASE = f"http://localhost:{os.environ.get('PORT', '8765')}/test/harness/hud.html"
COLOURS = [(63, 191, 95), (160, 102, 214), (224, 72, 72)]  # MARKER_COLOURS
ORANGE = (255, 110, 58)                                      # player arrow

PIXELS = """() => {
  const { hud, markers, player } = window.harness;
  const ctx = hud.canvas.getContext('2d'), d = hud.dpr;
  const px = (x, z) => { const [mx, mz] = hud.toMap(x, z);
    return [...ctx.getImageData(Math.round(mx * d), Math.round(mz * d), 1, 1).data.slice(0, 3)]; };
  return { markers: markers.map((m) => px(m.x, m.z)), player: px(player[0], player[1]) };
}"""

def close(a, b, tol=12):
    return all(abs(x - y) <= tol for x, y in zip(a, b))

with sync_playwright() as p:
    browser = p.chromium.launch()
    errors = []
    page = browser.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE + '?cpus')
    page.wait_for_function('window.__done', timeout=30000)
    got = page.evaluate(PIXELS)
    for i, (rgb, want) in enumerate(zip(got['markers'], COLOURS)):
        assert close(rgb, want), f'marker {i}: {rgb} != {want}'
    assert close(got['player'], ORANGE), f"player: {got['player']} != {ORANGE} (arrow must be on top)"
    print('ok cpus')

    g = browser.new_page()
    g.on('pageerror', lambda e: errors.append(str(e)))
    g.goto(BASE + '?generic')
    g.wait_for_function('window.__done', timeout=30000)
    print('ok generic')

    print('errors', errors)
    assert not errors
    browser.close()
```
