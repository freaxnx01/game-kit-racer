# Best-Lap Ghost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a completed lap, a see-through truck replays the fastest lap driven on this track, in sync with the lap timer, and it survives a reload. Closes #3.

**Architecture:** A pure module `js/race/Ghost.js` records the player's pose at 20 Hz against `lapTimer.currentLapTime`, keeps the fastest complete lap (`GhostRun`), stores it in `localStorage` under `racing.ghost.<?map= value>` and samples it by lap time. `js/race/GhostCar.js` draws a transparent clone of the player's truck — no physics body. `main.js` wires both after the `LapTimer` and calls `updateGhost()` once per frame after `lapTimer.update(…)`. `LapTimer.js`, `Vehicle.js` and physics stay unchanged.

**Tech Stack:** Plain ES modules, three.js via the existing import map, `localStorage`, Node's built-in `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-24-best-lap-ghost-design.md`

## Order with other work

- **Independent of #1 (multiplayer).** Nothing here imports #1's files (`js/race/Interpolate.js`, `js/race/Opponents.js`) or uses its `LapTimer` hooks. If #1 is already merged, the ghost hides itself during multiplayer races via `lapTimer.persist === false` (a field #1 adds); before #1 that field is `undefined` and the check is inert. If both land, `js/race/` is shared — no file names collide.
- **`js/main.js` is also edited by #1 (Task 9) and the OSM surroundings plan (Task 4/5).** All of them insert after `const lapTimer = new LapTimer( customCells, mapParam );` and after `lapTimer.update( dt, vehicle.spherePos, hasInput );`. Anchor on those lines, keep whatever the other work already inserted there, and add this plan's lines after it.

## Global Constraints

- Static files only — no bundler, no `package.json`, no new dependencies (browser-game stack).
- `js/race/Ghost.js` must not import `three` or `crashcat` (it is unit-tested in Node).
- The ghost has **no collider** and casts no shadow; it never touches the crashcat world.
- Do not modify `js/LapTimer.js` or `js/Vehicle.js`.
- Limits: sample every 50 ms (`SAMPLE_INTERVAL = 0.05`); laps over 300 s are not kept (`MAX_LAP_SECONDS = 300`); stored numbers rounded to 3 decimals; storage format version `1`.
- Storage key `racing.ghost.` + (`?map=` value or `default`) — the same track identity as `racing.bestLap.` in `js/LapTimer.js:5,48`.
- Code style = upstream mrdoob style: tabs, spaces inside parentheses/brackets, blank line after a block-opening `{` and before its `}`, `const`/`let`, no commented-out code. Test names `functionName_state_expectedBehavior`. Run all unit tests with `node --test test/*.test.mjs`.
- Commits: Conventional Commits with the two trailer lines shown in each commit step.
- Serve locally with `python3 -m http.server 8000` from the repo root.

## Review Focus

1. **Stored data is garbage or from a future format** — the game must start with no ghost and no error. → Task 2 `decodeGhost_garbage_returnsNull`, `loadGhost_missingOrThrowingStorage_returnsNull`.
2. **A lap that did not start at the line becomes the ghost** (e.g. the recorder picks up mid-lap after a multiplayer race) — must be dropped. → Task 3 `GhostRun_discardMidLap_dropsThatLap`, `GhostRun_lapCounterJumpsBack_startsOver`.
3. **Ghost runs out of sync with the timer** — it must be sampled by `currentLapTime`, not wall clock, and vanish once its lap time has passed. → Task 1 `sampleGhost_afterLapTime_returnsNull`, Task 5 manual play-test.
4. **You can bump into the ghost or it darkens the track with a shadow** — `GhostCar` must not create a body and must disable `castShadow`. → Task 4 code, Task 5 manual play-test.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `js/race/Ghost.js` | create | Sampling, encode/decode, load/save, `GhostRun` recorder |
| `js/race/GhostCar.js` | create | Transparent truck clone, `setPose( pose \| null )` |
| `js/main.js` | modify | Create ghost after `LapTimer`, `updateGhost()` per frame |
| `test/ghost-sample.test.mjs`, `test/ghost-store.test.mjs`, `test/ghost-run.test.mjs` | create | Node unit tests |
| `CHANGELOG.md` | modify | Player-facing entry |

---

### Task 1: Sample a ghost by lap time

**Files:**
- Create: `js/race/Ghost.js`
- Create: `test/ghost-sample.test.mjs`

**Interfaces:**
- Produces: `sampleGhost( ghost, t ) → { p: [x,y,z], q: [x,y,z,w] } | null`, where `ghost = { time, samples }` and a sample is `[ t, px, py, pz, qx, qy, qz, qw ]` sorted by `t`.

- [ ] **Step 1: Write the failing test**

Create `test/ghost-sample.test.mjs`:

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleGhost } from '../js/race/Ghost.js';

const Q0 = [ 0, 0, 0, 1 ];
const Q90 = [ 0, Math.SQRT1_2, 0, Math.SQRT1_2 ];
const sample = ( t, x, q = Q0 ) => [ t, x, 0, 0, ...q ];
const near = ( a, b, eps = 1e-9 ) => assert.ok( Math.abs( a - b ) < eps, `${ a } vs ${ b }` );

test( 'sampleGhost_noGhost_returnsNull', () => {

	assert.equal( sampleGhost( null, 1 ), null );

} );

test( 'sampleGhost_betweenSamples_blendsPositionAndRotation', () => {

	const ghost = { time: 1, samples: [ sample( 0, 0, Q0 ), sample( 1, 10, Q90 ) ] };
	const pose = sampleGhost( ghost, 0.5 );
	near( pose.p[ 0 ], 5 );
	near( Math.hypot( ...pose.q ), 1 );
	near( pose.q[ 1 ], Math.sin( Math.PI / 8 ), 1e-3 );

} );

test( 'sampleGhost_exactlyOnSample_returnsThatSample', () => {

	const ghost = { time: 2, samples: [ sample( 0, 0 ), sample( 1, 4 ), sample( 2, 9 ) ] };
	near( sampleGhost( ghost, 1 ).p[ 0 ], 4 );

} );

test( 'sampleGhost_beforeFirstSample_holdsFirst', () => {

	const ghost = { time: 1, samples: [ sample( 0.2, 3 ), sample( 1, 4 ) ] };
	near( sampleGhost( ghost, 0 ).p[ 0 ], 3 );

} );

test( 'sampleGhost_afterLapTime_returnsNull', () => {

	const ghost = { time: 1, samples: [ sample( 0, 0 ), sample( 1, 4 ) ] };
	assert.equal( sampleGhost( ghost, 1.01 ), null );

} );

test( 'sampleGhost_oppositeQuaternionSigns_takesShortArc', () => {

	const ghost = { time: 1, samples: [ sample( 0, 0, Q0 ), sample( 1, 0, [ 0, 0, 0, - 1 ] ) ] };
	const pose = sampleGhost( ghost, 0.5 );
	near( Math.abs( pose.q[ 3 ] ), 1 );

} );
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/*.test.mjs`
Expected: FAIL — `Cannot find module …/js/race/Ghost.js`

- [ ] **Step 3: Implement sampling**

Create `js/race/Ghost.js`:

```js
// Ghost.js — your best lap as a replayable path: recorded while you drive, stored per track in
// localStorage, sampled by lap time so the ghost runs in sync with the lap timer. Pure (no three.js).
// A sample is [ t, px, py, pz, qx, qy, qz, qw ]: lap time in seconds, the truck's position and rotation.

// Pose at lap time t: blend between the samples around t, hold the first before it starts,
// null once the ghost has finished its lap (or when there is no ghost).
export function sampleGhost( ghost, t ) {

	if ( ! ghost || t > ghost.time ) return null;

	const s = ghost.samples;
	if ( t <= s[ 0 ][ 0 ] ) return pose( s[ 0 ] );
	if ( t >= s[ s.length - 1 ][ 0 ] ) return pose( s[ s.length - 1 ] );

	let lo = 0, hi = s.length - 1;
	while ( hi - lo > 1 ) {

		const mid = ( lo + hi ) >> 1;
		if ( s[ mid ][ 0 ] <= t ) lo = mid; else hi = mid;

	}

	const a = s[ lo ], b = s[ hi ];
	const k = ( t - a[ 0 ] ) / ( b[ 0 ] - a[ 0 ] || 1 );
	return {
		p: [ 1, 2, 3 ].map( ( i ) => a[ i ] + ( b[ i ] - a[ i ] ) * k ),
		q: nlerp( a.slice( 4, 8 ), b.slice( 4, 8 ), k ),
	};

}

function pose( sample ) {

	return { p: sample.slice( 1, 4 ), q: sample.slice( 4, 8 ) };

}

// Normalised lerp along the shorter arc — samples are only 50 ms apart.
function nlerp( a, b, k ) {

	const sign = a[ 0 ] * b[ 0 ] + a[ 1 ] * b[ 1 ] + a[ 2 ] * b[ 2 ] + a[ 3 ] * b[ 3 ] < 0 ? - 1 : 1;
	const q = a.map( ( x, i ) => x + ( sign * b[ i ] - x ) * k );
	const len = Math.hypot( ...q ) || 1;
	return q.map( ( x ) => x / len );

}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/*.test.mjs`
Expected: all pass (6 new).

- [ ] **Step 5: Commit**

```bash
git add js/race/Ghost.js test/ghost-sample.test.mjs
git commit -F - <<'MSG'
feat(ghost): sample a recorded lap by lap time

Blends position and rotation between 20 Hz samples and ends with the lap,
so the ghost can run in step with the lap timer.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

---

### Task 2: Store the ghost per track

**Files:**
- Modify: `js/race/Ghost.js`
- Create: `test/ghost-store.test.mjs`

**Interfaces:**
- Consumes: Task 1 sample format.
- Produces: `MAX_LAP_SECONDS = 300`, `ghostStorageKey( trackId ) → string`, `encodeGhost( ghost ) → string`, `decodeGhost( text ) → ghost | null`, `loadGhost( key, storage? ) → ghost | null`, `saveGhost( key, ghost, storage? )` (storage defaults to `globalThis.localStorage`; never throws).

- [ ] **Step 1: Write the failing test**

Create `test/ghost-store.test.mjs`:

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeGhost, decodeGhost, loadGhost, saveGhost, ghostStorageKey } from '../js/race/Ghost.js';

const Q0 = [ 0, 0, 0, 1 ];
const Q90 = [ 0, Math.SQRT1_2, 0, Math.SQRT1_2 ];
const sample = ( t, x, q = Q0 ) => [ t, x, 0, 0, ...q ];
const near = ( a, b, eps = 1e-9 ) => assert.ok( Math.abs( a - b ) < eps, `${ a } vs ${ b }` );

function fakeStorage() {

	const map = new Map();
	return {
		getItem: ( k ) => map.has( k ) ? map.get( k ) : null,
		setItem: ( k, v ) => map.set( k, String( v ) ),
	};

}

test( 'ghostStorageKey_noTrackId_usesDefault', () => {

	assert.equal( ghostStorageKey( null ), 'racing.ghost.default' );
	assert.equal( ghostStorageKey( 'abc' ), 'racing.ghost.abc' );

} );

test( 'encodeGhost_thenDecode_roundTripsRounded', () => {

	const ghost = { time: 1.23456, samples: [ sample( 0, 1.00049 ), sample( 1.23456, 2, Q90 ) ] };
	const back = decodeGhost( encodeGhost( ghost ) );
	near( back.time, 1.235 );
	assert.equal( back.samples.length, 2 );
	near( back.samples[ 0 ][ 1 ], 1 );
	near( back.samples[ 1 ][ 5 ], 0.707 );

} );

test( 'decodeGhost_garbage_returnsNull', () => {

	for ( const text of [ null, '', 'not json', '{}', '[]', '{"v":2,"time":1,"s":[]}',
		'{"v":1,"time":1,"s":[0,0,0,0,0,0,0,1]}',
		'{"v":1,"time":1,"s":[0,0,0,0,0,0,0,1,1,0,0,0,0,0,0]}',
		'{"v":1,"time":-1,"s":[0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,1]}',
		'{"v":1,"time":1,"s":[1,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1]}',
		'{"v":1,"time":1,"s":[0,"x",0,0,0,0,0,1,1,0,0,0,0,0,0,1]}',
		'{"v":1,"time":9999,"s":[0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,1]}' ] ) {

		assert.equal( decodeGhost( text ), null, String( text ) );

	}

} );

test( 'saveGhost_thenLoadGhost_returnsTheGhost', () => {

	const storage = fakeStorage();
	saveGhost( 'racing.ghost.x', { time: 1, samples: [ sample( 0, 0 ), sample( 1, 5 ) ] }, storage );
	const back = loadGhost( 'racing.ghost.x', storage );
	near( back.time, 1 );
	near( back.samples[ 1 ][ 1 ], 5 );

} );

test( 'loadGhost_missingOrThrowingStorage_returnsNull', () => {

	assert.equal( loadGhost( 'racing.ghost.none', fakeStorage() ), null );
	const broken = { getItem() { throw new Error( 'denied' ); }, setItem() { throw new Error( 'full' ); } };
	assert.equal( loadGhost( 'k', broken ), null );
	assert.doesNotThrow( () => saveGhost( 'k', { time: 1, samples: [ sample( 0, 0 ), sample( 1, 1 ) ] }, broken ) );

} );
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/*.test.mjs`
Expected: FAIL — `SyntaxError: The requested module '../js/race/Ghost.js' does not provide an export named 'encodeGhost'` (or `ghostStorageKey`).

- [ ] **Step 3: Implement storage**

In `js/race/Ghost.js`, directly after the three header comment lines (before `// Pose at lap time t: …`), insert:

```js
export const MAX_LAP_SECONDS = 300;  // longer laps are not kept as a ghost
const STORAGE_PREFIX = 'racing.ghost.';
const FORMAT = 1;
const STRIDE = 8;

export function ghostStorageKey( trackId ) {

	return STORAGE_PREFIX + ( trackId || 'default' );

}
```

Then append to the end of the file:

```js
const round = ( x ) => Math.round( x * 1000 ) / 1000;

export function encodeGhost( ghost ) {

	return JSON.stringify( { v: FORMAT, time: round( ghost.time ), s: ghost.samples.flat().map( round ) } );

}

// Stored text → ghost, or null for anything that is not a well-formed ghost.
export function decodeGhost( text ) {

	let data;
	try {

		data = JSON.parse( text );

	} catch {

		return null;

	}

	if ( ! isValidData( data ) ) return null;

	const samples = [];
	for ( let i = 0; i < data.s.length; i += STRIDE ) samples.push( data.s.slice( i, i + STRIDE ) );
	return { time: data.time, samples };

}

function isValidData( data ) {

	if ( ! data || data.v !== FORMAT || ! Array.isArray( data.s ) ) return false;
	if ( ! Number.isFinite( data.time ) || data.time <= 0 || data.time > MAX_LAP_SECONDS ) return false;
	if ( data.s.length < STRIDE * 2 || data.s.length % STRIDE !== 0 ) return false;
	if ( ! data.s.every( Number.isFinite ) ) return false;

	for ( let i = STRIDE; i < data.s.length; i += STRIDE ) {

		if ( data.s[ i ] < data.s[ i - STRIDE ] ) return false;

	}

	return true;

}

// storage defaults to the browser's localStorage; tests pass a stand-in.
export function loadGhost( key, storage ) {

	try {

		return decodeGhost( ( storage || globalThis.localStorage ).getItem( key ) );

	} catch {

		return null;

	}

}

export function saveGhost( key, ghost, storage ) {

	try {

		( storage || globalThis.localStorage ).setItem( key, encodeGhost( ghost ) );

	} catch {}

}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/*.test.mjs`
Expected: all pass (5 new).

- [ ] **Step 5: Commit**

```bash
git add js/race/Ghost.js test/ghost-store.test.mjs
git commit -F - <<'MSG'
feat(ghost): keep the ghost per track in localStorage

Same track key as the best lap time; anything malformed loads as no ghost.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

---

### Task 3: Record laps and keep the fastest

**Files:**
- Modify: `js/race/Ghost.js`
- Create: `test/ghost-run.test.mjs`

**Interfaces:**
- Consumes: Task 1 `sampleGhost`; Task 2 `MAX_LAP_SECONDS`.
- Produces: `SAMPLE_INTERVAL = 0.05`; `class GhostRun { constructor( best ); best; onNewBest; update( lap, lapTime, lastLap, p, q ); discard(); poseAt( lapTime ) }`. `update` is fed `LapTimer`'s `lap`, `currentLapTime`, `lastLap` and the truck's `container` position/quaternion arrays; a lap ends when `lap` goes up by exactly one (`js/LapTimer.js:181`); `onNewBest( ghost )` fires when the finished lap is the first or faster than `best.time`.

- [ ] **Step 1: Write the failing test**

Create `test/ghost-run.test.mjs`:

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GhostRun, SAMPLE_INTERVAL, MAX_LAP_SECONDS } from '../js/race/Ghost.js';

const Q0 = [ 0, 0, 0, 1 ];
const sample = ( t, x, q = Q0 ) => [ t, x, 0, 0, ...q ];
const near = ( a, b, eps = 1e-9 ) => assert.ok( Math.abs( a - b ) < eps, `${ a } vs ${ b }` );

// Drives a GhostRun like main.js does: one call per frame with the LapTimer's lap, lap time and last lap.
function drive( run, frames ) {

	for ( const [ lap, lapTime, lastLap, x ] of frames ) run.update( lap, lapTime, lastLap, [ x, 0, 0 ], Q0 );

}

function lapFrames( lap, seconds, lastLap, fps = 60 ) {

	const frames = [];
	for ( let i = 0; i * ( 1 / fps ) < seconds; i ++ ) frames.push( [ lap, i / fps, lastLap, i ] );
	return frames;

}

test( 'GhostRun_firstCompletedLap_becomesBestAndIsReported', () => {

	const run = new GhostRun( null );
	const reported = [];
	run.onNewBest = ( ghost ) => reported.push( ghost );
	drive( run, lapFrames( 1, 2, null ) );
	drive( run, [ [ 2, 0, 2, 999 ] ] );
	assert.equal( reported.length, 1 );
	assert.equal( run.best, reported[ 0 ] );
	near( run.best.time, 2 );
	const last = run.best.samples[ run.best.samples.length - 1 ];
	assert.deepEqual( last.slice( 0, 2 ), [ 2, 999 ] );

} );

test( 'GhostRun_recording_keepsAboutTwentySamplesPerSecond', () => {

	const run = new GhostRun( null );
	drive( run, lapFrames( 1, 2, null ) );
	drive( run, [ [ 2, 0, 2, 0 ] ] );
	const n = run.best.samples.length;
	assert.ok( n >= 2 / SAMPLE_INTERVAL - 2 && n <= 2 / SAMPLE_INTERVAL + 2, `${ n } samples` );

} );

test( 'GhostRun_slowerLap_keepsPreviousBest', () => {

	const best = { time: 1.5, samples: [ sample( 0, 0 ), sample( 1.5, 1 ) ] };
	const run = new GhostRun( best );
	let reported = 0;
	run.onNewBest = () => reported ++;
	drive( run, lapFrames( 1, 2, null ) );
	drive( run, [ [ 2, 0, 2, 0 ] ] );
	assert.equal( run.best, best );
	assert.equal( reported, 0 );

} );

test( 'GhostRun_fasterLap_replacesBest', () => {

	const run = new GhostRun( { time: 5, samples: [ sample( 0, 0 ), sample( 5, 1 ) ] } );
	drive( run, lapFrames( 1, 2, null ) );
	drive( run, [ [ 2, 0, 2, 0 ] ] );
	near( run.best.time, 2 );

} );

test( 'GhostRun_lapLongerThanLimit_isNotKept', () => {

	const run = new GhostRun( null );
	drive( run, [ [ 1, 0, null, 0 ], [ 1, MAX_LAP_SECONDS + 1, null, 1 ], [ 2, 0, MAX_LAP_SECONDS + 1, 2 ] ] );
	assert.equal( run.best, null );

} );

test( 'GhostRun_discardMidLap_dropsThatLap', () => {

	const run = new GhostRun( null );
	drive( run, lapFrames( 1, 1, null ) );
	run.discard();
	drive( run, [ [ 1, 0.5, null, 0 ], [ 2, 0, 1.2, 0 ] ] );
	assert.equal( run.best, null );

} );

test( 'GhostRun_lapCounterJumpsBack_startsOver', () => {

	const run = new GhostRun( null );
	drive( run, lapFrames( 3, 1, 9 ) );
	drive( run, [ [ 1, 0, null, 0 ], [ 2, 0, 1, 0 ] ] );
	near( run.best.time, 1 );
	assert.equal( run.best.samples.length, 2 );

} );

test( 'GhostRun_poseAt_followsBest', () => {

	const run = new GhostRun( { time: 1, samples: [ sample( 0, 0 ), sample( 1, 10 ) ] } );
	near( run.poseAt( 0.25 ).p[ 0 ], 2.5 );
	assert.equal( run.poseAt( 2 ), null );

} );
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/*.test.mjs`
Expected: FAIL — `does not provide an export named 'GhostRun'`.

- [ ] **Step 3: Implement the recorder**

In `js/race/Ghost.js`, insert as the first constant (directly above `export const MAX_LAP_SECONDS`):

```js
export const SAMPLE_INTERVAL = 0.05; // seconds between recorded samples (20 Hz)
```

Then append to the end of the file:

```js
// Records the lap being driven and keeps the fastest complete lap as `best`.
// Feed it every frame while the lap timer runs; onNewBest( ghost ) fires when best changes.
export class GhostRun {

	constructor( best ) {

		this.best = best;
		this.onNewBest = null;
		this.lap = null;
		this.samples = null;

	}

	// lap, lapTime, lastLap: LapTimer's lap, currentLapTime and lastLap; p, q: the truck's pose.
	update( lap, lapTime, lastLap, p, q ) {

		if ( this.lap !== null && lap === this.lap + 1 ) this.finishLap( lastLap, p, q );
		if ( lap !== this.lap ) this.startLap( lap );
		this.record( lapTime, p, q );

	}

	// Forget the lap in progress (e.g. while a multiplayer race runs); the next update starts over.
	discard() {

		this.lap = null;
		this.samples = null;

	}

	poseAt( lapTime ) {

		return sampleGhost( this.best, lapTime );

	}

	startLap( lap ) {

		this.lap = lap;
		this.samples = [];

	}

	record( lapTime, p, q ) {

		if ( ! this.samples ) return;

		const partialLap = this.samples.length === 0 && lapTime > SAMPLE_INTERVAL;
		if ( partialLap || lapTime > MAX_LAP_SECONDS ) {

			this.samples = null;
			return;

		}

		const last = this.samples[ this.samples.length - 1 ];
		if ( last && lapTime - last[ 0 ] < SAMPLE_INTERVAL - 1e-6 ) return; // tolerance: frame times are floats
		this.samples.push( [ lapTime, ...p, ...q ] );

	}

	finishLap( lapTime, p, q ) {

		if ( ! this.samples || ! Number.isFinite( lapTime ) ) return;
		if ( this.best && lapTime >= this.best.time ) return;

		this.samples.push( [ lapTime, ...p, ...q ] );
		this.best = { time: lapTime, samples: this.samples };
		this.onNewBest?.( this.best );

	}

}
```

The `- 1e-6` tolerance matters: frame times are float sums, so `3 / 60 - 0` can come out a hair under `0.05` and every third sample would be skipped (the ~20 Hz test catches it).

- [ ] **Step 4: Run the tests**

Run: `node --test test/*.test.mjs`
Expected: all pass (8 new, 19 ghost tests total plus the existing track tests).

- [ ] **Step 5: Commit**

```bash
git add js/race/Ghost.js test/ghost-run.test.mjs
git commit -F - <<'MSG'
feat(ghost): record laps and keep the fastest

Only laps that start at the line and finish under five minutes count;
a discarded or reset lap never becomes the ghost.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

---

### Task 4: The see-through truck

**Files:**
- Create: `js/race/GhostCar.js`

**Interfaces:**
- Consumes: a loaded truck model from `main.js` `models`; the pose shape from Task 1.
- Produces: `class GhostCar { constructor( scene, model ); group; setPose( pose | null ) }`.

No Node test: the class needs three.js, which only resolves through the browser import map. It is verified by the syntax check here and the play-test in Task 5.

- [ ] **Step 1: Implement `js/race/GhostCar.js`**

Create `js/race/GhostCar.js`:

```js
// GhostCar.js — the see-through truck that replays your best lap. Visual only: no physics body,
// so you drive straight through it, and it casts no shadow.

import * as THREE from 'three';

const OPACITY = 0.35;

export class GhostCar {

	// model: the same loaded truck model the player's Vehicle uses.
	constructor( scene, model ) {

		this.group = new THREE.Group();
		this.group.add( model.clone() );
		this.group.traverse( ( child ) => {

			if ( ! child.isMesh ) return;
			child.material = child.material.clone();
			child.material.transparent = true;
			child.material.opacity = OPACITY;
			child.material.depthWrite = false;
			child.castShadow = false;
			child.receiveShadow = false;

		} );
		this.group.visible = false;
		scene.add( this.group );

	}

	// pose: { p: [x,y,z], q: [x,y,z,w] } in the player's container space (as recorded), or null to hide.
	setPose( pose ) {

		this.group.visible = pose !== null;
		if ( ! pose ) return;
		this.group.position.set( pose.p[ 0 ], pose.p[ 1 ], pose.p[ 2 ] );
		this.group.quaternion.set( pose.q[ 0 ], pose.q[ 1 ], pose.q[ 2 ], pose.q[ 3 ] );

	}

}
```

Materials are cloned per mesh so the player's truck, which shares the loaded model's materials, stays opaque.

- [ ] **Step 2: Syntax check**

Run: `node --input-type=module --check < js/race/GhostCar.js`
Expected: no output, exit 0.

- [ ] **Step 3: Commit**

```bash
git add js/race/GhostCar.js
git commit -F - <<'MSG'
feat(ghost): draw the ghost as a see-through truck

No physics body, so you drive straight through it, and no shadow.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

---

### Task 5: Wire the ghost into the game

**Files:**
- Modify: `js/main.js`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Tasks 1–4; `lapTimer.enabled`, `.running`, `.lap`, `.currentLapTime`, `.lastLap` (`js/LapTimer.js:49-53,66`); `lapTimer.persist` when #1 is merged; `vehicle.container` (`js/Vehicle.js:43,212-216`); `models[ 'vehicle-truck-yellow' ]` (`js/main.js:61,218`).

- [ ] **Step 1: Imports**

In `js/main.js`, after `import { ColorMapGLTFLoader } from './Loader.js';` (and after any imports other work has already added there), add:

```js
import { GhostRun, ghostStorageKey, loadGhost, saveGhost } from './race/Ghost.js';
import { GhostCar } from './race/GhostCar.js';
```

- [ ] **Step 2: Create the ghost**

Directly after `const lapTimer = new LapTimer( customCells, mapParam );` — below anything other work (OSM HUD, multiplayer) has already inserted right there — add:

```js

	// Ghost (#3): replays the fastest lap on this track — same track key as the best lap time.
	const ghostKey = ghostStorageKey( mapParam );
	const ghostRun = new GhostRun( loadGhost( ghostKey ) );
	ghostRun.onNewBest = ( ghost ) => saveGhost( ghostKey, ghost );
	const ghostCar = new GhostCar( scene, models[ 'vehicle-truck-yellow' ] );

	function updateGhost() {

		// persist === false only while a multiplayer race (#1) runs: no ghost there, and race laps are not recorded.
		const soloLap = lapTimer.enabled && lapTimer.running && lapTimer.persist !== false;
		if ( ! soloLap ) {

			ghostRun.discard();
			ghostCar.setPose( null );
			return;

		}

		const c = vehicle.container;
		ghostRun.update( lapTimer.lap, lapTimer.currentLapTime, lapTimer.lastLap, c.position.toArray(), c.quaternion.toArray() );
		ghostCar.setPose( ghostRun.poseAt( lapTimer.currentLapTime ) );

	}
```

`vehicle`, `scene`, `models` and `mapParam` are all in scope at that point in `init()`.

- [ ] **Step 3: Call it every frame**

In `animate()`, directly after `lapTimer.update( dt, vehicle.spherePos, hasInput );`, add:

```js
		updateGhost();
```

It must run **after** `lapTimer.update`, so it sees the lap counter step on the frame the line is crossed.

- [ ] **Step 4: Changelog**

Under `## [Unreleased]` in `CHANGELOG.md` add (merge with an existing `### Added` if there is one):

```markdown
### Added

- Ghost: after your first full lap, a see-through truck replays your fastest
  lap on that track, in step with the lap timer — race it to beat your best.
  It is saved per track, so it is waiting for you next time.
```

- [ ] **Step 5: Verify**

Run: `node --test test/*.test.mjs && node --input-type=module --check < js/main.js && node --input-type=module --check < js/race/GhostCar.js`
Expected: all tests pass, no syntax errors.

- [ ] **Step 6: Commit**

```bash
git add js/main.js CHANGELOG.md
git commit -F - <<'MSG'
feat(ghost): race against your best-lap ghost

The fastest lap on each track replays as a see-through truck from the next
lap on and is kept across reloads. Hidden in multiplayer races.

Closes #3

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

- [ ] **Step 7: Manual play-test (the stack's test gate for anything rendered)**

Serve with `python3 -m http.server 8000`, open `http://localhost:8000/index.html` with DevTools open. Check:

1. Console is empty on load; no ghost before you drive.
2. Drive one full lap — as you cross the line, a transparent yellow truck appears and drives the lap you just did, in step with the timer; it disappears when its lap time has passed if you are slower.
3. Drive through it — no bump, no shadow under it.
4. Drive a faster lap — the next lap's ghost follows the faster line; drive a slower one — the ghost does not change.
5. Reload — the ghost is back from the first lap on; `localStorage` has `racing.ghost.default`.
6. Pick a preset from **Tracks** — no ghost until you complete a lap there (separate key).
7. In DevTools set `localStorage['racing.ghost.default'] = 'garbage'` and reload — no ghost, no error.
8. If #1 is merged: in a multiplayer race no ghost appears; after the race, the stored ghost is unchanged.
