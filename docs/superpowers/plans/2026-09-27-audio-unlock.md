# Audio Unlock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the game's existing sound (engine, skid and impacts, all still present from upstream) actually start on every device: on the first real gesture, including a steering drag on a phone, through iOS's silent switch, and again after an interruption. Closes #12.

**Architecture:** A new three.js-free module `js/AudioUnlock.js` owns "resume the AudioContext on a real user gesture, retry until it is really running, re-arm after an interruption". It is unit-tested in Node against a fake context. `js/Audio.js` swaps its inline one-shot `unlock` closure and `visibilitychange` block for it, and opts into the iOS `playback` audio session. A harness page `test/harness/audio.html` boots the real `GameAudio` without the WebGL scene, so a Playwright check under Chromium's real autoplay policy can verify it. `index.html` itself does not boot headless.

**Tech Stack:** Plain ES modules (three.js 0.185.1 from the CDN import map, untouched), Web Audio API, Node's built-in `node:test`, Python Playwright (not committed) for the harness check.

**Spec:** `docs/superpowers/specs/2026-09-27-audio-unlock-design.md`

## Global Constraints

- Static files only: no bundler, no `package.json`, no new dependencies.
- Code style = upstream mrdoob style: tabs, spaces inside parentheses/brackets, a blank line after a block-opening `{` and before its `}`, `const`/`let`, no commented-out code. Test names `functionName_state_expectedBehavior`.
- Run all unit tests with `node --test test/*.test.mjs`. On `main` 159 pass; after this plan 177 pass (18 new). Note that `node --test test/` (the directory form) does not work here; use the glob.
- No new user-visible strings, so no `js/ui/strings.js` changes.
- Only `js/AudioUnlock.js` (new), `js/Audio.js`, `test/audio-unlock.test.mjs` (new), `test/harness/audio.html` (new) and `CHANGELOG.md` change. `main.js`, `Controls.js` and `index.html` stay as they are.
- Line numbers refer to `main` at bce6ce0. If they have drifted, locate the code by the quoted text.
- Commit per task, Conventional Commits, and end every message with the attribution trailer lines your session's instructions give you.
- Run Playwright in the **foreground** (never backgrounded), and commit and push before running it. Chromium must run with the real autoplay policy: `args=["--autoplay-policy=document-user-activation-required"]` and `ignore_default_args=["--autoplay-policy=no-user-gesture-required"]`. Without the second flag Playwright's default lets audio start without a gesture and every check passes vacuously.
- Playwright's `page.evaluate()` carries a user gesture, so untrusted events must be fired by the page itself (`?synthetic`), never through `evaluate`.

## Review Focus

1. **Phone, first touch is a steering drag** (touchstart → move → touchend, no click): the sound must start. Covered by Task 1 `gesture_touchend_unlocksAndCallsOnUnlock` and `gesture_touchstart_isIgnored`, and Task 2 Playwright check 3.
2. **First interaction is the Tracks button** (`index.html:104`, `stopPropagation()`): the sound must start. Covered by Task 2 Playwright check 2, which fails on `main`.
3. **iOS interruption** (phone call, lock screen → `interrupted`/`suspended` while visible): the next touch brings the sound back. Covered by Task 1 `stateChange_interruptedWhileVisible_rearmsAndNextGestureResumes` and Task 2 Playwright check 4, which fails on `main`.
4. **Resume refused, rejected or never settling** (WebKit without activation): `unlocked` stays false and the next gesture retries. Covered by Task 1 `…StaysSuspended…`, `…Rejects…` and `…Hangs…`.
5. **Tab switch** (hidden → visible): the audio pauses while hidden and comes back without a new gesture, and hidden-state changes must not re-arm. Covered by Task 1 `resumeForVisible_*` and `stateChange_suspendedWhileHidden_doesNotArm`.

---

### Task 1: `AudioUnlock`, a gesture/interrupt-aware unlock controller

**Files:**
- Create: `js/AudioUnlock.js`
- Test: `test/audio-unlock.test.mjs`

**Interfaces:**
- Consumes: nothing (no three.js, no DOM beyond `globalThis`).
- Produces (used by Task 2):
  - `export const UNLOCK_EVENTS = [ 'pointerdown', 'pointerup', 'touchend', 'keydown', 'click' ]`
  - `export class AudioUnlock`
    - `constructor( context, { target = globalThis, onUnlock = () => {}, isHidden = () => globalThis.document?.hidden === true } = {} )`: `context` is an `AudioContext` (or anything with `state`, `resume()`, `suspend()` and `addEventListener( 'statechange' )`)
    - `get unlocked()` → `boolean`, true once the context has actually been `running`
    - `arm()` / `disarm()`: add or remove the gesture listeners (capture phase, passive). Both are idempotent.
    - `async tryResume()`: never throws
    - `suspendForHidden()`
    - `async resumeForVisible()`

- [ ] **Step 1: Write the failing test `test/audio-unlock.test.mjs`**

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioUnlock, UNLOCK_EVENTS } from '../js/AudioUnlock.js';

// Stand-in for an AudioContext: `resumeMode` decides what resume() does — 'run' (the browser
// allows it), 'stay' (resolves, but stays suspended: no user activation), 'reject', or 'hang'.
class FakeContext extends EventTarget {

	constructor( resumeMode = 'run' ) {

		super();
		this.state = 'suspended';
		this.resumeMode = resumeMode;
		this.resumeCalls = 0;

	}

	setState( state ) {

		this.state = state;
		this.dispatchEvent( new Event( 'statechange' ) );

	}

	resume() {

		this.resumeCalls ++;
		if ( this.resumeMode === 'hang' ) return new Promise( () => {} );
		if ( this.resumeMode === 'reject' ) return Promise.reject( new Error( 'NotAllowedError' ) );
		if ( this.resumeMode === 'run' ) this.setState( 'running' );
		return Promise.resolve();

	}

	suspend() {

		this.setState( 'suspended' );
		return Promise.resolve();

	}

}

const flush = () => new Promise( ( resolve ) => setImmediate( resolve ) );

function setup( resumeMode ) {

	const context = new FakeContext( resumeMode );
	const target = new EventTarget();
	const page = { hidden: false, unlockCalls: 0 };
	const unlock = new AudioUnlock( context, {
		target,
		onUnlock: () => page.unlockCalls ++,
		isHidden: () => page.hidden,
	} );
	unlock.arm();
	return { context, target, page, unlock };

}

async function gesture( target, type = 'pointerup' ) {

	target.dispatchEvent( new Event( type ) );
	await flush();

}

test( 'UNLOCK_EVENTS_list_areTheActivationEventsWithoutTouchstart', () => {

	assert.deepEqual( UNLOCK_EVENTS, [ 'pointerdown', 'pointerup', 'touchend', 'keydown', 'click' ] );

} );

for ( const type of UNLOCK_EVENTS ) {

	test( `gesture_${ type }_unlocksAndCallsOnUnlock`, async () => {

		const { context, target, page, unlock } = setup( 'run' );
		await gesture( target, type );
		assert.equal( context.state, 'running' );
		assert.equal( unlock.unlocked, true );
		assert.equal( page.unlockCalls, 1 );

	} );

}

test( 'gesture_touchstart_isIgnored', async () => {

	const { context, target, unlock } = setup( 'run' );
	await gesture( target, 'touchstart' );
	assert.equal( context.resumeCalls, 0 );
	assert.equal( unlock.unlocked, false );

} );

test( 'gesture_contextStaysSuspended_staysArmedAndRetriesOnNextGesture', async () => {

	const { context, target, page, unlock } = setup( 'stay' );
	await gesture( target );
	assert.equal( unlock.unlocked, false );
	assert.equal( page.unlockCalls, 0 );

	context.resumeMode = 'run';
	await gesture( target, 'keydown' );
	assert.equal( context.resumeCalls, 2 );
	assert.equal( unlock.unlocked, true );
	assert.equal( page.unlockCalls, 1 );

} );

test( 'gesture_resumeRejects_staysLockedAndArmed', async () => {

	const { context, target, unlock } = setup( 'reject' );
	await gesture( target );
	assert.equal( unlock.unlocked, false );

	context.resumeMode = 'run';
	await gesture( target );
	assert.equal( unlock.unlocked, true );

} );

test( 'gesture_resumeHangsThenContextRuns_unlocksOnStateChange', async () => {

	const { context, target, page, unlock } = setup( 'hang' );
	await gesture( target );
	assert.equal( unlock.unlocked, false );

	context.setState( 'running' );
	assert.equal( unlock.unlocked, true );
	assert.equal( page.unlockCalls, 1 );

} );

test( 'gesture_afterUnlock_listenersRemovedAndOnUnlockCalledOnce', async () => {

	const { context, target, page } = setup( 'run' );
	await gesture( target );
	await gesture( target );
	await gesture( target, 'click' );
	assert.equal( context.resumeCalls, 1 );
	assert.equal( page.unlockCalls, 1 );

} );

test( 'stateChange_interruptedWhileVisible_rearmsAndNextGestureResumes', async () => {

	const { context, target, page, unlock } = setup( 'run' );
	await gesture( target );

	context.setState( 'interrupted' );
	await gesture( target, 'touchend' );
	assert.equal( context.resumeCalls, 2 );
	assert.equal( context.state, 'running' );
	assert.equal( unlock.unlocked, true );
	assert.equal( page.unlockCalls, 1 );

} );

test( 'stateChange_suspendedWhileHidden_doesNotArm', async () => {

	const { context, target, page } = setup( 'run' );
	await gesture( target );

	page.hidden = true;
	context.setState( 'suspended' );
	await gesture( target );
	assert.equal( context.resumeCalls, 1 );

} );

test( 'stateChange_beforeFirstUnlock_doesNotCallOnUnlock', async () => {

	const { context, page, unlock } = setup( 'stay' );
	context.setState( 'interrupted' );
	await flush();
	assert.equal( unlock.unlocked, false );
	assert.equal( page.unlockCalls, 0 );

} );

test( 'suspendForHidden_running_suspendsTheContext', async () => {

	const { context, target, page, unlock } = setup( 'run' );
	await gesture( target );

	page.hidden = true;
	unlock.suspendForHidden();
	assert.equal( context.state, 'suspended' );

} );

test( 'resumeForVisible_afterHidden_resumesWithoutAGesture', async () => {

	const { context, target, page, unlock } = setup( 'run' );
	await gesture( target );
	page.hidden = true;
	unlock.suspendForHidden();

	page.hidden = false;
	await unlock.resumeForVisible();
	assert.equal( context.state, 'running' );
	assert.equal( page.unlockCalls, 1 );

} );

test( 'resumeForVisible_resumeRefused_armsForTheNextGesture', async () => {

	const { context, target, page, unlock } = setup( 'run' );
	await gesture( target );
	page.hidden = true;
	unlock.suspendForHidden();

	page.hidden = false;
	context.resumeMode = 'stay';
	await unlock.resumeForVisible();
	assert.equal( context.state, 'suspended' );

	context.resumeMode = 'run';
	await gesture( target );
	assert.equal( context.state, 'running' );

} );

test( 'resumeForVisible_neverUnlocked_doesNothing', async () => {

	const { context, unlock } = setup( 'run' );
	await unlock.resumeForVisible();
	assert.equal( context.resumeCalls, 0 );
	assert.equal( context.state, 'suspended' );

} );
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/audio-unlock.test.mjs`
Expected: FAIL. `Cannot find module '…/js/AudioUnlock.js'`.

- [ ] **Step 3: Write `js/AudioUnlock.js`**

```js
// Starts the audio context on the first real user gesture, and again after the browser
// interrupts it (iOS: phone call, lock screen). No three.js import, so Node can test it.

// Activation-triggering events per the HTML spec. `touchstart` is deliberately missing: it
// grants no activation, and the `touchend` of the same drag does.
export const UNLOCK_EVENTS = [ 'pointerdown', 'pointerup', 'touchend', 'keydown', 'click' ];

// Capture phase: a stopPropagation() in page UI (the Tracks button) must not hide the gesture.
const LISTENER_OPTIONS = { capture: true, passive: true };

export class AudioUnlock {

	constructor( context, { target = globalThis, onUnlock = () => {}, isHidden = () => globalThis.document?.hidden === true } = {} ) {

		this.context = context;
		this.target = target;
		this.onUnlock = onUnlock;
		this.isHidden = isHidden;
		this.armed = false;
		this.everUnlocked = false;
		this.handleGesture = () => this.tryResume();

		context.addEventListener( 'statechange', () => this.handleStateChange() );

	}

	get unlocked() {

		return this.everUnlocked;

	}

	arm() {

		if ( this.armed ) return;
		this.armed = true;
		for ( const type of UNLOCK_EVENTS ) this.target.addEventListener( type, this.handleGesture, LISTENER_OPTIONS );

	}

	disarm() {

		if ( ! this.armed ) return;
		this.armed = false;
		for ( const type of UNLOCK_EVENTS ) this.target.removeEventListener( type, this.handleGesture, LISTENER_OPTIONS );

	}

	async tryResume() {

		try {

			await this.context.resume();

		} catch ( e ) {

			// Expected without user activation; the listeners stay armed for the next gesture.
			console.debug( 'Audio not unlocked yet, waiting for the next gesture:', e.message );

		}

		if ( this.context.state === 'running' ) this.completeUnlock();

	}

	suspendForHidden() {

		if ( this.context.state === 'running' ) this.context.suspend();

	}

	async resumeForVisible() {

		if ( ! this.everUnlocked ) return;
		await this.tryResume();
		if ( this.context.state !== 'running' ) this.arm();

	}

	handleStateChange() {

		if ( this.context.state === 'running' ) {

			this.completeUnlock();
			return;

		}

		if ( ! this.everUnlocked || this.isHidden() ) return;
		this.arm();

	}

	completeUnlock() {

		this.disarm();
		if ( this.everUnlocked ) return;
		this.everUnlocked = true;
		this.onUnlock();

	}

}
```

- [ ] **Step 4: Run the new tests, then the full suite**

Run: `node --test test/audio-unlock.test.mjs`
Expected: PASS, 18 tests. (One `console.debug` line from the reject test is expected.)

Run: `node --test test/*.test.mjs`
Expected: `ℹ tests 177`, `ℹ pass 177`, `ℹ fail 0`.

- [ ] **Step 5: Commit**

```bash
git add js/AudioUnlock.js test/audio-unlock.test.mjs
git commit -m "feat(audio): add AudioUnlock that retries until the context runs (#12)"
```

---

### Task 2: Use `AudioUnlock` in `GameAudio`, opt into iOS playback, and verify in a browser

**Files:**
- Create: `test/harness/audio.html`
- Modify: `js/Audio.js:2` (import), `js/Audio.js:107` (constructor field), `js/Audio.js:118` (top of `init`), `js/Audio.js:176-209` (the `unlock` closure and the `visibilitychange` block)
- Modify: `CHANGELOG.md` (`[Unreleased]`)

**Interfaces:**
- Consumes: `AudioUnlock` from Task 1 (`new AudioUnlock( ctx, { onUnlock } )`, `arm()`, `suspendForHidden()`, `resumeForVisible()`).
- Produces: `GameAudio#unlock` (the `AudioUnlock` instance) and `GameAudio#unlocked`, which now means "the context has really been running". `playImpact` (`js/Audio.js:395`) and the skid loader (`js/Audio.js:172`) keep using `this.unlocked` unchanged. The harness exposes `window.__audio`, `window.__ready` and (with `?synthetic`) `window.__afterSynthetic`.

- [ ] **Step 1: Create the harness page `test/harness/audio.html`**

```html
<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- GameAudio loads 'audio/skid.ogg' relative to the page, so resolve everything from the repo root. -->
<base href="../../">
<script type="importmap">{ "imports": {
	"three": "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js"
} }</script>
<style>
	body { margin: 0; height: 100vh; background: #3a7; }
	#stopper { position: absolute; left: 12px; bottom: 12px; padding: 9px 18px; background: #fff; border-radius: 999px; font: 13px sans-serif; }
</style></head><body>
<!-- Headless check for #12: the real GameAudio on a stub camera and target (no WebGL scene, so it
	boots in seconds). #stopper stands in for index.html's Tracks button, which stops its click from
	propagating. The Playwright script reads window.__audio. -->
<a id="stopper" role="button">Tracks</a>
<script>
	document.getElementById( 'stopper' ).addEventListener( 'click', ( e ) => e.stopPropagation() );
</script>
<script type="module">
import * as THREE from 'three';
import { GameAudio } from './js/Audio.js';

const camera = new THREE.PerspectiveCamera();
const target = new THREE.Object3D();
const audio = new GameAudio();
audio.init( camera, target );

// ?synthetic: fire script-made (untrusted) gestures before anything else. They carry no user
// activation, so they must not count as unlocking the audio.
if ( new URLSearchParams( location.search ).has( 'synthetic' ) ) {

	window.dispatchEvent( new Event( 'touchstart' ) );
	window.dispatchEvent( new Event( 'click' ) );
	// Read in-page, before Playwright touches the page: its evaluate() calls carry a user gesture.
	setTimeout( () => {

		window.__afterSynthetic = { state: audio.listener.context.state, unlocked: audio.unlocked };

	}, 200 );

}

window.__audio = audio;
window.__ready = true;
</script></body></html>
```

- [ ] **Step 2: Write the Playwright check to `/tmp/audio_check.py` (not committed)**

```python
# Checks #12 on test/harness/audio.html. Usage: python3 /tmp/audio_check.py <base-url>
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip("/")
STATE = "({ state: window.__audio.listener.context.state, unlocked: window.__audio.unlocked })"
failures = []


def check(name, condition, detail):
    print(("PASS " if condition else "FAIL ") + name + "  " + str(detail))
    if not condition:
        failures.append(name)


def open_page(browser, query=""):
    context = browser.new_context(has_touch=True, is_mobile=True, viewport={"width": 390, "height": 800})
    page = context.new_page()
    page.on("pageerror", lambda e: failures.append("pageerror: " + str(e)))
    page.goto(BASE + "/test/harness/audio.html" + query)
    page.wait_for_function("window.__ready === true", timeout=60000)
    page.wait_for_timeout(300)
    return context, page


def drag(context, page):
    cdp = context.new_cdp_session(page)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": 200, "y": 400}]})
    for i in range(1, 6):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": 200 + i * 20, "y": 400}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


with sync_playwright() as p:
    # Playwright disables the autoplay policy by default; put the real one back.
    browser = p.chromium.launch(
        args=["--autoplay-policy=document-user-activation-required"],
        ignore_default_args=["--autoplay-policy=no-user-gesture-required"],
    )

    # 1. Script-dispatched (untrusted) touchstart/click: no activation, so the audio must not claim to be unlocked.
    # The harness fires them itself (?synthetic) and records the result in-page: Playwright's own
    # evaluate() calls carry a user gesture and would unlock the context.
    context, page = open_page(browser, "?synthetic")
    page.wait_for_function("window.__afterSynthetic !== undefined", timeout=10000)
    s = page.evaluate("window.__afterSynthetic")
    check("policy active (still suspended after untrusted gestures)", s["state"] == "suspended", s)
    check("untrusted gestures do not mark the audio unlocked", s["unlocked"] is False, s)
    context.close()

    # 2. A real click on a stopPropagation() element (the Tracks button) unlocks, and the skid loop starts.
    context, page = open_page(browser)
    page.wait_for_function("window.__audio.skidSound.buffer !== null", timeout=30000)
    page.click("#stopper")
    page.wait_for_timeout(800)
    s = page.evaluate(STATE)
    check("click on a stopPropagation() button unlocks", s["unlocked"] and s["state"] == "running", s)
    check("skid loop playing after unlock", page.evaluate("window.__audio.skidSound.isPlaying"), "")
    context.close()

    # 3. A real steering drag (touchstart → move → touchend, no click) unlocks.
    context, page = open_page(browser)
    drag(context, page)
    page.wait_for_timeout(800)
    s = page.evaluate(STATE)
    check("touch drag unlocks", s["unlocked"] and s["state"] == "running", s)

    # 4. Interrupted after unlocking (iOS phone call / lock screen): the next tap brings it back.
    page.evaluate("window.__audio.listener.context.suspend()")
    page.wait_for_timeout(300)
    page.touchscreen.tap(100, 100)
    page.wait_for_timeout(800)
    s = page.evaluate(STATE)
    check("tap after an interruption resumes", s["state"] == "running", s)
    context.close()

    browser.close()

print("ALL PASS" if not failures else "FAILED: " + ", ".join(failures))
sys.exit(1 if failures else 0)
```

- [ ] **Step 3: Run the check against the unchanged `Audio.js` to verify it fails**

```bash
python3 -m http.server 8000 --bind 127.0.0.1 &   # from the repo root; any free port works
python3 /tmp/audio_check.py http://127.0.0.1:8000
```

Expected (verified while planning, on `main` at bce6ce0): exit 1 with
`FAIL untrusted gestures do not mark the audio unlocked  {'state': 'suspended', 'unlocked': True}`,
`FAIL click on a stopPropagation() button unlocks`, `FAIL skid loop playing after unlock` and
`FAIL tap after an interruption resumes`. The touch drag and policy checks pass.

- [ ] **Step 4: Import `AudioUnlock` in `js/Audio.js`** (after line 2, `import { createImpactBuffer } from './ImpactSound.js';`)

```js
import { AudioUnlock } from './AudioUnlock.js';
```

- [ ] **Step 5: Add the field in the constructor.** Directly above `this.unlocked = false;` (line 107):

```js
		this.unlock = null;
```

- [ ] **Step 6: Opt into the iOS playback session.** These are the first lines of `init( camera, target ) {`, before `this.listener = new THREE.AudioListener();`:

```js
		// iOS routes Web Audio through the "ambient" session, which the silent
		// switch mutes; "playback" (Safari 16.4+) plays like a video does.
		if ( navigator.audioSession ) navigator.audioSession.type = 'playback';

```

- [ ] **Step 7: Replace the unlock closure and the visibility handler.** Replace this whole block (lines 176-209), from `const unlock = () => {` through the closing `} );` of the `visibilitychange` listener:

```js
		const unlock = () => {

			if ( this.unlocked ) return;
			this.unlocked = true;

			if ( ctx.state === 'suspended' ) ctx.resume();

			this.startSounds();

			window.removeEventListener( 'keydown', unlock );
			window.removeEventListener( 'click', unlock );
			window.removeEventListener( 'touchstart', unlock );

		};

		window.addEventListener( 'keydown', unlock );
		window.addEventListener( 'click', unlock );
		window.addEventListener( 'touchstart', unlock );

		// Pause all audio when the tab is hidden; resume once it's visible
		// again (only if the user has already interacted to unlock playback).
		document.addEventListener( 'visibilitychange', () => {

			if ( document.hidden ) {

				if ( ctx.state === 'running' ) ctx.suspend();

			} else if ( this.unlocked && ctx.state === 'suspended' ) {

				ctx.resume();

			}

		} );
```

with:

```js
		// Starts the context on the first real gesture and again after an
		// interruption; `unlocked` flips only once the context is running.
		this.unlock = new AudioUnlock( ctx, { onUnlock: () => {

			this.unlocked = true;
			this.startSounds();

		} } );
		this.unlock.arm();

		// Pause all audio when the tab is hidden; resume once it's visible
		// again (only if the user has already interacted to unlock playback).
		document.addEventListener( 'visibilitychange', () => {

			if ( document.hidden ) this.unlock.suspendForHidden();
			else this.unlock.resumeForVisible();

		} );
```

- [ ] **Step 8: Add the CHANGELOG entry.** In `CHANGELOG.md`, under `## [Unreleased]`, after the `### Added` list, add:

```markdown
### Fixed

- Sound on phones: the engine, skid and crash sounds now start with your first
  steering touch (on an iPhone even with the silent switch on) and come back
  after a phone call, a locked screen or switching apps. Opening the Tracks menu
  first no longer leaves the game silent.
```

- [ ] **Step 9: Syntax check and the full unit suite**

Run: `node --check js/Audio.js && node --check js/AudioUnlock.js && node --test test/*.test.mjs`
Expected: no syntax output, then `ℹ pass 177`, `ℹ fail 0`.

- [ ] **Step 10: Commit and push**

```bash
git add js/Audio.js test/harness/audio.html CHANGELOG.md
git commit -m "fix(audio): start sound on the first real gesture and after interruptions (#12)"
git push
```

- [ ] **Step 11: Run the Playwright check again (foreground) to verify it passes**

Run: `python3 /tmp/audio_check.py http://127.0.0.1:8000`
Expected (verified while planning with exactly this code): six `PASS` lines and `ALL PASS`, exit 0.

- [ ] **Step 12: Manual check for the human reviewer (put this in the PR body, can't be automated here)**

On a real iPhone (Safari): silent switch **on**, open the deployed page, drag to steer and check the engine is audible within about a second. Lock the phone, unlock it, touch once: the sound is back. On desktop, click **Tracks** first, then close the menu: the sound is already running.
