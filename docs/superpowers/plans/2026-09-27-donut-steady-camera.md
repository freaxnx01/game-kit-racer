# Donut Steady Camera Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While the player spins donuts, the camera holds still instead of swinging back and forth; all other driving is unchanged. Closes #17.

**Architecture:** A new pure module `js/SpinHold.js` turns the truck's heading per frame into a 0..1 `hold` value (1 after ≥ 225° of continuous hard turning, faded at 2/s). `Camera.update` gets an optional `hold` argument that scales down the lead and the follow smoothing; `hold = 0` is bit-identical to today. `main.js` wires the two together.

**Tech Stack:** Plain ES modules (three.js via import map), Node's built-in `node:test`, Python Playwright (not committed) for the harness check.

**Spec:** `docs/superpowers/specs/2026-09-27-donut-steady-camera-design.md`

## Global Constraints

- Static files only — no bundler, no `package.json`, no new dependencies, nothing new on `window` in the game.
- Code style = upstream mrdoob style: tabs, spaces inside parentheses/brackets, blank line after a block-opening `{` and before its `}`, `const`/`let`, no commented-out code. Test names `functionName_state_expectedBehavior`.
- Constants exactly: `SPIN_MIN_YAW_RATE = 2.5` (rad/s), `SPIN_ENGAGE_ANGLE = 1.25 * Math.PI`, `HOLD_RATE = 2` (per second).
- Run all unit tests with `node --test test/*.test.mjs` — the count after this plan is main's count **+ 8** (159 → 167 at bce6ce0; other issues may have added tests since).
- Line numbers refer to `main` at bce6ce0; locate by the quoted code if they drifted.
- Commit per task, Conventional Commits, message ending with exactly these two trailer lines:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01WVkTufc2PiJjhhrWptUPLA`
- Run Playwright in the **foreground** (never backgrounded) with a generous timeout; commit and push before running it. Serve on an unusual port (e.g. 18917) — other agents on the same host may already occupy 8000/8765 with a different root, which makes the page silently never set `window.result`.
- `CHANGELOG.md` entry is hand-written, player-facing, in the same language as the existing `[Unreleased]` entries (English). Never run `git cliff -o CHANGELOG.md`.

## Review Focus

1. **Normal cornering at full lock** (hairpins, 90° corners) must not trigger the hold — the camera keeps its lead there. → Task 1 `update_fullLockHairpin180_holdStaysZero`.
2. **Heading wrap at ±π** — `atan2` jumps from +π to −π; a spin across it must keep counting. → Task 1 `update_spinClockwiseAcrossPlusMinusPi_countsContinuously`.
3. **Wiggling left/right** (slalom, correcting a slide) must not add up to a spin. → Task 1 `update_spinDirectionReverses_restartsTheCount`.
4. **Leaving the donut** — the camera must ease back to following, not snap. → Task 1 `update_spinEnds_holdReturnsToZero` + `update_sustainedSpin_holdFadesInRatherThanJumping`.
5. **Everything but donuts unchanged** — straight driving produces the exact same camera path as before. → Task 2 harness `straightIdentical`.

---

### Task 1: Spin detection (`SpinHold`)

**Files:**
- Create: `js/SpinHold.js`
- Test: `test/spin-hold.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `class SpinHold { constructor(); update( dt: number, heading: number ): void; hold: number /* 0..1, read-only for callers */ }` and exported constants `SPIN_MIN_YAW_RATE`, `SPIN_ENGAGE_ANGLE`, `HOLD_RATE`. `heading` is the truck's yaw in radians, as `Math.atan2( forward.x, forward.z )` (any range; differences are wrapped internally).

- [ ] **Step 1: Write the failing test**

Create `test/spin-hold.test.mjs`:

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpinHold } from '../js/SpinHold.js';

const DT = 1 / 60;
const FULL_LOCK = 4; // rad/s — Vehicle.js: 4 · steeringGrip at full grip

// Feeds `seconds` of frames turning at `yawRate`, reporting the heading like main.js does:
// atan2 of the forward vector, i.e. always wrapped to (-π, π].
function drive( hold, seconds, yawRate, start = 0 ) {

	let heading = start;
	const frames = Math.round( seconds / DT );
	for ( let i = 0; i < frames; i ++ ) {

		heading += yawRate * DT;
		hold.update( DT, Math.atan2( Math.sin( heading ), Math.cos( heading ) ) );

	}

	return heading;

}

test( 'update_straightDriving_holdStaysZero', () => {

	const hold = new SpinHold();
	drive( hold, 5, 0 );
	assert.equal( hold.hold, 0 );

} );

test( 'update_fullLockHairpin180_holdStaysZero', () => {

	const hold = new SpinHold();
	const heading = drive( hold, Math.PI / FULL_LOCK, FULL_LOCK );
	drive( hold, 1, 0, heading );
	assert.equal( hold.hold, 0 );

} );

test( 'update_sustainedSpin_holdReachesOne', () => {

	const hold = new SpinHold();
	drive( hold, 2, FULL_LOCK );
	assert.equal( hold.hold, 1 );

} );

test( 'update_sustainedSpin_holdFadesInRatherThanJumping', () => {

	const hold = new SpinHold();
	drive( hold, 1.1, FULL_LOCK ); // just past 225° at 4 rad/s (≈ 0.98 s)
	assert.ok( hold.hold > 0 && hold.hold < 0.5, `hold ${ hold.hold }` );

} );

test( 'update_spinEnds_holdReturnsToZero', () => {

	const hold = new SpinHold();
	const heading = drive( hold, 2, FULL_LOCK );
	drive( hold, 1, 0, heading );
	assert.equal( hold.hold, 0 );

} );

test( 'update_spinDirectionReverses_restartsTheCount', () => {

	const hold = new SpinHold();
	const heading = drive( hold, 0.9, FULL_LOCK ); // ≈ 206° left
	drive( hold, 0.9, - FULL_LOCK, heading ); // ≈ 206° right
	assert.equal( hold.hold, 0 );

} );

test( 'update_spinClockwiseAcrossPlusMinusPi_countsContinuously', () => {

	const hold = new SpinHold();
	drive( hold, 2, - FULL_LOCK, 3 ); // starts just below +π and wraps several times
	assert.equal( hold.hold, 1 );

} );

test( 'update_zeroDt_isIgnored', () => {

	const hold = new SpinHold();
	drive( hold, 2, FULL_LOCK );
	hold.update( 0, 1 );
	assert.equal( hold.hold, 1 );

} );
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/spin-hold.test.mjs`
Expected: FAIL — `Cannot find module '.../js/SpinHold.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `js/SpinHold.js`:

```js
// SpinHold.js — detects a sustained spin (donut) from the truck's heading and fades a 0..1
// "hold" value in and out, so the camera can stay still while the truck turns on the spot.
// Pure: no three.js, importable from Node.

export const SPIN_MIN_YAW_RATE = 2.5; // rad/s — slower turning is ordinary cornering
export const SPIN_ENGAGE_ANGLE = 1.25 * Math.PI; // 225° — more than any corner or hairpin
export const HOLD_RATE = 2; // hold units per second (≈ 0.5 s fade)

function wrapAngle( angle ) {

	let a = angle;
	while ( a > Math.PI ) a -= Math.PI * 2;
	while ( a < - Math.PI ) a += Math.PI * 2;
	return a;

}

export class SpinHold {

	constructor() {

		this.hold = 0;
		this.spun = 0;
		this.heading = null;

	}

	update( dt, heading ) {

		if ( ! ( dt > 0 ) ) return;

		const turned = this.heading === null ? 0 : wrapAngle( heading - this.heading );
		this.heading = heading;
		this.accumulate( turned, dt );
		this.approach( Math.abs( this.spun ) >= SPIN_ENGAGE_ANGLE ? 1 : 0, dt );

	}

	accumulate( turned, dt ) {

		if ( Math.abs( turned ) / dt < SPIN_MIN_YAW_RATE ) {

			this.spun = 0;
			return;

		}

		const sameWay = this.spun === 0 || Math.sign( turned ) === Math.sign( this.spun );
		this.spun = sameWay ? this.spun + turned : turned;

	}

	approach( target, dt ) {

		const step = HOLD_RATE * dt;
		this.hold = target > this.hold ? Math.min( target, this.hold + step ) : Math.max( target, this.hold - step );

	}

}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/spin-hold.test.mjs` → Expected: 8 pass, 0 fail.
Run: `node --test test/*.test.mjs` → Expected: all pass (main's count + 8).

- [ ] **Step 5: Commit**

```bash
git add js/SpinHold.js test/spin-hold.test.mjs
git commit -m "feat(camera): detect sustained spins for a steady donut camera

Refs #17"
```

(append the two trailer lines from Global Constraints)

---

### Task 2: Camera holds still while `hold` is 1

**Files:**
- Modify: `js/Camera.js:58-81` (`update` signature, lead, smoothing)
- Create: `test/harness/camera.html`

**Interfaces:**
- Consumes: Task 1 `SpinHold` (`update( dt, heading )`, `hold`).
- Produces: `Camera.update( dt, target: Vector3, velocity: Vector3, hold = 0 )`. Omitting `hold` keeps today's behaviour exactly.

- [ ] **Step 1: Write the failing harness**

Create `test/harness/camera.html` (same import-map style as `test/harness/scene.html`):

```html
<!DOCTYPE html><html><head><script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/"}}</script></head><body>
<script type="module">
// Camera harness (#17): feeds the real Camera a simulated donut and a straight run, with and
// without SpinHold, and reports how far the camera moves. No renderer — pure simulation.
import * as THREE from 'three';
import { Camera } from '../../js/Camera.js';
import { SpinHold } from '../../js/SpinHold.js';

const DT = 1 / 60;

// Donut: truck circles radius 1 around the origin at 4 rad/s (full lock), facing along the circle.
function donutFrame( t, car, lead ) {

	const heading = 4 * t;
	car.set( - Math.cos( heading ), 0.5, Math.sin( heading ) );
	lead.set( Math.sin( heading ), 0, Math.cos( heading ) ).multiplyScalar( 4 ); // speed = r · ω
	return heading;

}

// Straight: truck drives along +X at 4 units/s.
function straightFrame( t, car, lead ) {

	car.set( 4 * t, 0.5, 0 );
	lead.set( 1, 0, 0 ).multiplyScalar( 4 );
	return Math.PI / 2;

}

function run( frame, useHold, seconds, measureFrom ) {

	const cam = new Camera();
	const spinHold = new SpinHold();
	const car = new THREE.Vector3(), lead = new THREE.Vector3();
	const min = new THREE.Vector3( Infinity, Infinity, Infinity ), max = new THREE.Vector3( - Infinity, - Infinity, - Infinity );
	const path = [];
	for ( let i = 0; i < Math.round( seconds / DT ); i ++ ) {

		const t = i * DT;
		const heading = frame( t, car, lead );
		spinHold.update( DT, Math.atan2( Math.sin( heading ), Math.cos( heading ) ) );
		cam.update( DT, car, lead, useHold ? spinHold.hold : 0 );
		path.push( cam.camera.position.x, cam.camera.position.z );
		if ( t >= measureFrom ) { min.min( cam.camera.position ); max.max( cam.camera.position ); }

	}

	return { swing: Math.max( max.x - min.x, max.z - min.z ), path, hold: spinHold.hold };

}

const donutWithout = run( donutFrame, false, 5, 2 );
const donutWith = run( donutFrame, true, 5, 2 );
const straightWithout = run( straightFrame, false, 3, 0 );
const straightWith = run( straightFrame, true, 3, 0 );
window.result = {
	swingWithout: donutWithout.swing,
	swingWith: donutWith.swing,
	donutHold: donutWith.hold,
	straightHold: straightWith.hold,
	straightIdentical: straightWith.path.every( ( v, i ) => v === straightWithout.path[ i ] ),
};
</script></body></html>
```

Save this Playwright check **outside the repo** (not committed), e.g. `/tmp/check_camera.py`:

```python
import subprocess, sys, time
from playwright.sync_api import sync_playwright

root = sys.argv[1] if len(sys.argv) > 1 else "."
server = subprocess.Popen([sys.executable, "-m", "http.server", "18917", "-d", root],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto("http://localhost:18917/test/harness/camera.html")
        page.wait_for_function("window.result !== undefined", timeout=60000)
        r = page.evaluate("window.result")
        print(r, errors)
        assert not errors, errors
        assert r["swingWithout"] > 1, r
        assert r["swingWith"] < 0.05, r
        assert r["donutHold"] == 1, r
        assert r["straightHold"] == 0, r
        assert r["straightIdentical"] is True, r
        print("camera harness OK")
        browser.close()
finally:
    server.terminate()
```

- [ ] **Step 2: Run the harness to verify it fails**

Run (foreground, from the repo root): `python3 /tmp/check_camera.py .`
Expected: FAIL on `swingWith < 0.05` — `Camera.update` ignores the fourth argument, so `swingWith` equals `swingWithout` (≈ 4.57).

- [ ] **Step 3: Implement the hold in `Camera.update`**

In `js/Camera.js`, replace the start of `update` (line 58 onward):

```js
	update( dt, target, velocity ) {

		const radius = this.deadzoneRadius;
```

with:

```js
	// hold (0..1, from SpinHold): 1 = keep the camera still — no lead, no easing toward the truck.
	// The deadzone hard-clamp below still applies, so the truck never leaves the circle.
	update( dt, target, velocity, hold = 0 ) {

		const follow = 1 - hold;
		const radius = this.deadzoneRadius;
```

Then change the two lead lines (65-66) to:

```js
		let leadX = velocity.dot( this.camRightXZ ) * this.leadFactor * follow;
		let leadY = velocity.dot( this.camForwardXZ ) * this.leadFactor * follow;
```

and the smoothing line (80) to:

```js
		const alpha = this.initialized ? 1 - Math.exp( - dt * this.cameraSmoothing * follow ) : 1;
```

Leave the hard-clamp block (84-97) and everything else untouched.

- [ ] **Step 4: Run the harness to verify it passes**

Run: `python3 /tmp/check_camera.py .`
Expected: `camera harness OK`, with `swingWithout ≈ 4.57`, `swingWith = 0`, `straightIdentical: True`.
Run: `node --test test/*.test.mjs` → all pass.

- [ ] **Step 5: Commit**

```bash
git add js/Camera.js test/harness/camera.html
git commit -m "feat(camera): hold the camera still while spinning

Refs #17"
```

(append the two trailer lines from Global Constraints)

---

### Task 3: Wire it into the game + changelog

**Files:**
- Modify: `js/main.js` (import block near line 7; `const _camLead` near line 305; camera call at lines 414-416)
- Modify: `CHANGELOG.md` (`## [Unreleased]`)

**Interfaces:**
- Consumes: Task 1 `SpinHold`; Task 2 `Camera.update( dt, target, velocity, hold )`.
- Produces: nothing new for other modules.

- [ ] **Step 1: Import and instantiate**

In `js/main.js`, next to `import { Camera } from './Camera.js';` add:

```js
import { SpinHold } from './SpinHold.js';
```

After `const _camLead = new THREE.Vector3();` add:

```js
	const spinHold = new SpinHold();
```

- [ ] **Step 2: Feed the heading and pass the hold to the camera**

Replace

```js
		cam.update( dt, vehicle.spherePos, _camLead );
```

with

```js
		_forward.set( 0, 0, 1 ).applyQuaternion( vehicle.container.quaternion );
		spinHold.update( dt, Math.atan2( _forward.x, _forward.z ) );
		cam.update( dt, vehicle.spherePos, _camLead, spinHold.hold );
```

(`_forward` is already declared at line ~304 and is recomputed again before `hud.update`, so reusing it here is safe.) Leave the `_camLead` computation above unchanged.

- [ ] **Step 3: Static checks**

Run: `node --check js/main.js && node --check js/Camera.js && node --check js/SpinHold.js && grep -n "spinHold" js/main.js`
Expected: no syntax errors; three `spinHold` lines (declaration, `update`, `.hold`).
Run: `node --test test/*.test.mjs` → all pass.

- [ ] **Step 4: Changelog**

In `CHANGELOG.md` under `## [Unreleased]`, add a `### Changed` section after the `### Added` list (if another PR already created `### Changed`, append to it):

```markdown
### Changed

- Donuts: when you spin the truck on the spot, the camera now holds still instead
  of swinging back and forth. It picks up following you again as soon as you drive off.
```

- [ ] **Step 5: Commit and push (before the in-game check)**

```bash
git add js/main.js CHANGELOG.md
git commit -m "feat(camera): keep the camera steady during donuts

Closes #17"
git push -u origin HEAD
```

(append the two trailer lines from Global Constraints)

- [ ] **Step 6: In-game Playwright smoke check (foreground)**

Save outside the repo as `/tmp/check_donut_game.py` and run `python3 /tmp/check_donut_game.py .` from the repo root:

```python
import subprocess, sys, time
from playwright.sync_api import sync_playwright

root = sys.argv[1] if len(sys.argv) > 1 else "."
server = subprocess.Popen([sys.executable, "-m", "http.server", "18917", "-d", root],
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        page.goto("http://localhost:18917/index.html", wait_until="networkidle", timeout=120000)
        page.wait_for_timeout(3000)
        page.keyboard.down("ArrowUp")
        page.keyboard.down("ArrowLeft")
        page.wait_for_timeout(6000)
        page.keyboard.up("ArrowLeft")
        page.wait_for_timeout(2000)
        page.keyboard.up("ArrowUp")
        print(errors)
        assert not errors, errors
        print("in-game donut smoke OK")
        browser.close()
finally:
    server.terminate()
```

Expected: `in-game donut smoke OK` (no page errors while spinning and driving off). This only proves the wiring runs; the camera numbers are proven by Task 2's harness.

- [ ] **Step 7: Manual playtest (for the reviewer)**

Open the game (`python3 -m http.server 18917`, then `http://localhost:18917/`). Hold ↑ + ← for several seconds: after about one full turn the view settles and stays still while the truck spins. Release ←: the camera eases back to following within about half a second. Drive a normal lap: corners and hairpins feel exactly as before. Console stays empty.
