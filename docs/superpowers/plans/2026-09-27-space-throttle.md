# Space-Bar Throttle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the player accelerate with the space bar, like `W` / `↑`, without Space ever activating a focused UI button. Closes #16.

**Architecture:** Everything lives in `js/Controls.js`. The keyboard-to-axis mapping moves into a pure exported `keyboardAxes( keys )` that also treats `Space` as forward; a pure exported `swallowsSpace( code, target )` decides when the `keydown`/`keyup` listeners call `preventDefault()` (Space outside text fields). Pure functions get Node tests; the browser behaviour (focused button, text field) gets a Playwright check against a new harness page.

**Tech Stack:** Plain ES modules, Node's built-in `node:test`, Python Playwright (script not committed) for the harness check.

**Spec:** `docs/superpowers/specs/2026-09-27-space-throttle-design.md`

## Global Constraints

- Static files only — no bundler, no `package.json`, no new dependencies.
- Code style = upstream mrdoob style: tabs, spaces inside parentheses/brackets, blank line after a block-opening `{` and before its `}`, `const`/`let`, no commented-out code. Test names `functionName_state_expectedBehavior`.
- Run all unit tests with `node --test test/*.test.mjs` (159 pass on `main`; 168 after this plan).
- No new UI strings (the game has no controls help). If you add any, they go into `js/ui/strings.js` in **both** `en` and `de`.
- Line numbers below refer to `main` at bce6ce0; locate by the quoted code if they drifted.
- Commit per task, Conventional Commits, ending with the commit trailer lines your session requires.
- Run Playwright in the **foreground** (never backgrounded); commit and push before running it.

## Review Focus

1. **Click "Start race" with the mouse, then hold Space to drive** — the focused button must not fire again (no restart/quit). → Task 2 Playwright check (`clicks === 0`).
2. **Typing a name with a space in the multiplayer lobby** — the space appears in the field. → Task 2 Playwright check + `swallowsSpace_editableTargets_false`.
3. **Space + `S` together** — cancels out like `W` + `S`, no reverse, no double. → Task 1 `keyboardAxes_spaceAndS_cancelsOut`.
4. **Space + `W` together** — still full throttle, not 2×. → Task 1 `keyboardAxes_spaceAndW_staysFullThrottle`.
5. **Holding Space during the CPU/multiplayer countdown** — the truck stays on its slot; already guaranteed by `holdInput` zeroing (`js/main.js:399-400`) because Space flows through the same `z` axis. → manual check in Task 2 Step 8.

---

### Task 1: Space throttles (`keyboardAxes`)

**Files:**
- Modify: `js/Controls.js:1` (insert function above the class), `js/Controls.js:111-117` (`update()` keyboard block)
- Create: `test/controls.test.mjs`

**Interfaces:**
- Produces: `export function keyboardAxes( keys ) → { x: -1|0|1, z: -1|0|1 }` where `keys` maps `KeyboardEvent.code` → boolean (the existing `this.keys`).
- `Controls.update()` return shape unchanged: `{ x, z, touchActive }`.

- [ ] **Step 1: Write the failing tests**

Create `test/controls.test.mjs`:

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyboardAxes } from '../js/Controls.js';

test( 'keyboardAxes_spaceHeld_accelerates', () => {

	assert.deepEqual( keyboardAxes( { Space: true } ), { x: 0, z: 1 } );

} );

test( 'keyboardAxes_spaceAndW_staysFullThrottle', () => {

	assert.deepEqual( keyboardAxes( { Space: true, KeyW: true } ), { x: 0, z: 1 } );

} );

test( 'keyboardAxes_spaceAndS_cancelsOut', () => {

	assert.deepEqual( keyboardAxes( { Space: true, KeyS: true } ), { x: 0, z: 0 } );

} );

test( 'keyboardAxes_steeringKeys_unchanged', () => {

	assert.deepEqual( keyboardAxes( { KeyA: true } ), { x: - 1, z: 0 } );
	assert.deepEqual( keyboardAxes( { ArrowRight: true, ArrowDown: true } ), { x: 1, z: - 1 } );
	assert.deepEqual( keyboardAxes( { ArrowUp: true, ArrowLeft: true } ), { x: - 1, z: 1 } );

} );

test( 'keyboardAxes_noKeys_isZero', () => {

	assert.deepEqual( keyboardAxes( {} ), { x: 0, z: 0 } );
	assert.deepEqual( keyboardAxes( { Space: false, KeyW: false } ), { x: 0, z: 0 } );

} );
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/controls.test.mjs`
Expected: FAIL — `SyntaxError: The requested module '../js/Controls.js' does not provide an export named 'keyboardAxes'`.

- [ ] **Step 3: Implement `keyboardAxes`**

In `js/Controls.js`, insert above `export class Controls {` (line 1):

```js
// Keyboard axes from the held-key map ( KeyboardEvent.code → bool ). Space throttles like W (#16).
export function keyboardAxes( keys ) {

	let x = 0, z = 0;

	if ( keys[ 'KeyA' ] || keys[ 'ArrowLeft' ] ) x -= 1;
	if ( keys[ 'KeyD' ] || keys[ 'ArrowRight' ] ) x += 1;
	if ( keys[ 'KeyW' ] || keys[ 'ArrowUp' ] || keys[ 'Space' ] ) z += 1;
	if ( keys[ 'KeyS' ] || keys[ 'ArrowDown' ] ) z -= 1;

	return { x, z };

}

```

In `update()`, replace this block (lines 111-117):

```js
		let x = 0, z = 0;

		// Keyboard

		if ( this.keys[ 'KeyA' ] || this.keys[ 'ArrowLeft' ] ) x -= 1;
		if ( this.keys[ 'KeyD' ] || this.keys[ 'ArrowRight' ] ) x += 1;
		if ( this.keys[ 'KeyW' ] || this.keys[ 'ArrowUp' ] ) z += 1;
		if ( this.keys[ 'KeyS' ] || this.keys[ 'ArrowDown' ] ) z -= 1;
```

with:

```js
		let { x, z } = keyboardAxes( this.keys );
```

The gamepad and touch blocks below it stay exactly as they are (they reassign `x`/`z`, which is why it stays `let`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/controls.test.mjs && node --check js/Controls.js`
Expected: 5 pass, no syntax error.

- [ ] **Step 5: Run the full suite**

Run: `node --test test/*.test.mjs`
Expected: 164 pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
git add js/Controls.js test/controls.test.mjs
git commit -m "feat(controls): accelerate with the space bar (#16)"
```

---

### Task 2: Space never activates a focused button (`swallowsSpace`), changelog

**Files:**
- Modify: `js/Controls.js` (new function after `keyboardAxes`; constructor listeners at `js/Controls.js:17-18` of the original file)
- Modify: `test/controls.test.mjs` (import line, new tests)
- Create: `test/harness/controls.html`
- Modify: `CHANGELOG.md` (`## [Unreleased]` → `### Added`)

**Interfaces:**
- Consumes: `keyboardAxes` from Task 1 (unchanged).
- Produces: `export function swallowsSpace( code, target ) → boolean` — `code` is `KeyboardEvent.code`, `target` is `KeyboardEvent.target` (an `Element`, `window`, or `null`).

- [ ] **Step 1: Write the failing unit tests**

In `test/controls.test.mjs` replace the import line

```js
import { keyboardAxes } from '../js/Controls.js';
```

with

```js
import { keyboardAxes, swallowsSpace } from '../js/Controls.js';
```

and append:

```js
test( 'swallowsSpace_focusedButton_true', () => {

	assert.equal( swallowsSpace( 'Space', { tagName: 'BUTTON' } ), true );
	assert.equal( swallowsSpace( 'Space', { tagName: 'BODY', isContentEditable: false } ), true );

} );

test( 'swallowsSpace_editableTargets_false', () => {

	for ( const tagName of [ 'INPUT', 'TEXTAREA', 'SELECT' ] ) assert.equal( swallowsSpace( 'Space', { tagName } ), false, tagName );
	assert.equal( swallowsSpace( 'Space', { tagName: 'DIV', isContentEditable: true } ), false );

} );

test( 'swallowsSpace_noTarget_true', () => {

	assert.equal( swallowsSpace( 'Space', null ), true );
	assert.equal( swallowsSpace( 'Space', {} ), true );

} );

test( 'swallowsSpace_otherKey_false', () => {

	assert.equal( swallowsSpace( 'KeyW', { tagName: 'BUTTON' } ), false );
	assert.equal( swallowsSpace( 'Enter', { tagName: 'BUTTON' } ), false );

} );
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/controls.test.mjs`
Expected: FAIL — `does not provide an export named 'swallowsSpace'`.

- [ ] **Step 3: Create the Playwright harness page**

Create `test/harness/controls.html`:

```html
<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
</head><body>
<button id="btn" type="button">Start race</button>
<input id="name">
<script type="module">
// Headless check for #16: Space throttles, never clicks a focused button, and still types in text fields.
import { Controls } from '../../js/Controls.js';

window.clicks = 0;
document.getElementById( 'btn' ).addEventListener( 'click', () => window.clicks ++ );
window.controls = new Controls();
window.ready = true;
</script>
</body></html>
```

Write this check script to your scratch directory (not committed), e.g. `$SCRATCH/check_controls.py`:

```python
import socket, subprocess, time
from playwright.sync_api import sync_playwright

with socket.socket() as s:                      # free port — other agents may hold fixed ones
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
server = subprocess.Popen(['python3', '-m', 'http.server', str(port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(f'http://localhost:{port}/test/harness/controls.html')
        page.wait_for_function('window.ready === true')

        page.click('#btn')                      # mouse click leaves the button focused
        page.evaluate('window.clicks = 0')
        page.keyboard.down('Space')
        assert page.evaluate('controls.update().z') == 1, 'Space does not throttle'
        page.keyboard.up('Space')
        assert page.evaluate('window.clicks') == 0, 'focused button fired on Space'
        assert page.evaluate('controls.update().z') == 0, 'throttle stuck after release'

        page.click('#name')
        page.keyboard.type('Bo Bo')
        assert page.input_value('#name') == 'Bo Bo', 'Space no longer types in text fields'

        assert not errors, errors
        print('controls harness OK')
        browser.close()
finally:
    server.terminate()
```

- [ ] **Step 4: Run the harness check to verify it fails**

Run from the repo root, in the foreground: `python3 $SCRATCH/check_controls.py`
Expected: `AssertionError: focused button fired on Space` (Task 1 already makes Space throttle; nothing blocks the button yet).

- [ ] **Step 5: Implement `swallowsSpace` and wire it**

In `js/Controls.js`, insert directly after `keyboardAxes`:

```js
const EDITABLE_TAGS = [ 'INPUT', 'TEXTAREA', 'SELECT' ];

// Space is the throttle, so its browser default (activating a focused button, scrolling) is
// blocked — except in text fields and dropdowns, where Space keeps working normally.
export function swallowsSpace( code, target ) {

	if ( code !== 'Space' ) return false;
	if ( ! target ) return true;
	return ! EDITABLE_TAGS.includes( target.tagName ) && ! target.isContentEditable;

}

```

In the constructor, replace

```js
		window.addEventListener( 'keydown', ( e ) => this.keys[ e.code ] = true );
		window.addEventListener( 'keyup', ( e ) => this.keys[ e.code ] = false );
```

with

```js
		window.addEventListener( 'keydown', ( e ) => {

			if ( swallowsSpace( e.code, e.target ) ) e.preventDefault();
			this.keys[ e.code ] = true;

		} );

		window.addEventListener( 'keyup', ( e ) => {

			if ( swallowsSpace( e.code, e.target ) ) e.preventDefault();
			this.keys[ e.code ] = false;

		} );
```

Both events are prevented on purpose: browsers fire a focused button's click on Space **keyup**.

- [ ] **Step 6: Run unit tests and the full suite**

Run: `node --test test/controls.test.mjs && node --test test/*.test.mjs`
Expected: 9 pass in `controls.test.mjs`; full suite 168 pass, 0 fail.

- [ ] **Step 7: Changelog**

In `CHANGELOG.md`, append to the end of the `### Added` list under `## [Unreleased]` (the file is written in English — keep that language):

```markdown
- Accelerate with the space bar, too — it works just like `W` or `↑`.
```

- [ ] **Step 8: Commit and push, then verify in the browser**

```bash
git add js/Controls.js test/controls.test.mjs test/harness/controls.html CHANGELOG.md
git commit -m "feat(controls): keep Space from clicking focused buttons (#16)"
git push
```

Then, in the foreground:

Run: `python3 $SCRATCH/check_controls.py`
Expected: `controls harness OK`.

Manual (or Playwright against `index.html` served the same way, which needs network for the three.js/crashcat CDNs): the page loads with no console errors; holding Space drives the truck forward; click **vs CPU** → **Start race**, hold Space during the countdown — the truck stays on its slot and the race does not restart; after GO, Space drives.

- [ ] **Step 9: If the harness check failed**

Do not weaken the assertions. Check `e.target` in the listener (a `KeyboardEvent` dispatched at a focused `<button>` has that button as `target`), and that both listeners call `preventDefault()`. After 3 failed attempts, stop and report.
