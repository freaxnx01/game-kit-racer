# CPU Opponents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Race 1–3 CPU trucks (easy/medium/hard, 1–10 laps) from a grid start with countdown, live positions and results, on any track that is one closed circuit. Closes #4.

**Architecture:** Pure modules carry everything testable: `TrackPath` derives the driving line from the tile pieces (walking connectivity from the finish line), `CpuDriver` moves one truck along it, `CpuRace` runs the race with #1's `RaceState` rules and talks to the game only through #1's `game` adapter. CPU trucks are shown and collided through a second instance of #1's `Opponents` (kinematic bodies). `CpuPanel` is the DOM UI. `main.js` wires it next to the multiplayer block.

**Tech Stack:** Plain ES modules, three.js 0.185.1 and crashcat 0.0.3 via the existing import map (only through #1's `Opponents`), Node's built-in `node:test`, Playwright (not committed) for the headless panel check.

**Spec:** `docs/superpowers/specs/2026-09-24-cpu-opponents-design.md`

## Global Constraints

- **Depends on #1 (P2P multiplayer) being merged first.** Reuse, never copy: `js/race/RaceState.js` (`RaceState`, `PHASE`, `gridSlots`, `COUNTDOWN_MS`, `RESULTS_GRACE_MS`), `js/race/Opponents.js`, `js/race/Interpolate.js` (`RENDER_DELAY_MS`), `js/net/Protocol.js` (`MAX_LAPS`), `js/ui/strings.js` (`t`, `STRINGS`, `FUNNY_NAMES`), `LapTimer` hooks (`onLap`, `progress()`, `resetForRace()`, `startRace()`, `resetForSolo()`), and the `game` adapter / `holdInput` in `js/main.js`.
- Static files only — no bundler, no `package.json`, no committed `node_modules` (browser-game stack).
- Pure modules (`js/race/TrackPath.js`, `js/race/CpuDriver.js`, `js/race/CpuRace.js`) must not import `three` or `crashcat` and must not touch the DOM.
- Limits: 1–3 CPUs (default 3); difficulty `easy` / `medium` / `hard` (default `medium`); laps 1–10 (default 3); CPU speeds easy 8 / medium 10 / hard 12.5 units/s with corner factors 0.6 / 0.7 / 0.75; acceleration 6 u/s², braking 14 u/s², corner look-ahead 4 units; pace 1.03 / 1.00 / 0.97 for slots 0 / 1 / 2.
- CPUs take grid slots 0…n−1, the player slot n. CPU race laps never touch the single-player best-lap storage.
- A track that is not one closed loop with a finish line: vs CPU is unavailable (message), nothing starts.
- Code style = upstream mrdoob style: tabs, spaces inside parentheses/brackets, blank line after a block-opening `{` and before its `}`, `const`/`let`, no commented-out code. Test names `functionName_state_expectedBehavior`. Run all unit tests with `node --test test/*.test.mjs`.
- German UI text: standard German, address pronoun capitalised (`Du`, `Dein`), real umlauts.
- Commits: Conventional Commits with the two trailer lines shown in each commit step.

## Review Focus

1. **Editor/preset tracks with lanes touching side by side** (The Aerodrome has cells with 3–4 track neighbours) — the CPU must follow the pieces, not grid adjacency. → Task 1 `trackOrder_touchingParallelLanes_followsPiecesNotGridNeighbours`.
2. **Finish tile placed the other way round in the editor** — CPUs drive the loop in the finish tile's direction, same as the player's lap rule. → Task 1 `trackOrder_reversedFinish_drivesTheLoopTheOtherWay`.
3. **Quit during the countdown** — input is released immediately and no GO follows. → Task 3 `quit_duringCountdown_releasesHeldInput`.
4. **Start pressed again mid-race (or Rematch)** — old CPU trucks disappear and quitting afterwards still restores the single-player lap timer hook. → Task 3 `start_whileARaceIsRunning_replacesItWithoutLosingTheSoloHook`.
5. **Player finishes first** — the race keeps running until the CPUs finish (or 30 s grace), player listed P1. → Task 3 `playerLap_viaLapTimerHook_isRecordedAndLastLapFinishes`.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `js/race/TrackPath.js` | create | Piece connectivity, cell order from the finish line, driving line polyline, sampling |
| `js/race/CpuDriver.js` | create | One CPU truck: speed control, laps/progress, `{ p, q, v }` state; `DIFFICULTY` |
| `js/race/CpuRace.js` | create | vs-CPU race controller over the `game` adapter; `view()` for the UI |
| `js/ui/strings.js` | modify | `cpu.*` keys (en + de) |
| `js/ui/CpuPanel.js` | create | vs CPU button, settings, countdown, positions, results |
| `js/main.js` | modify | Second `Opponents`, `CpuRace` + `CpuPanel`, update hook, exclusion with multiplayer |
| `test/track-path.test.mjs`, `test/cpu-driver.test.mjs`, `test/cpu-race.test.mjs`, `test/cpu-strings.test.mjs` | create | Node tests |
| `test/harness/cpu.html` | create | Headless page: real panel + race, fake game |
| `CHANGELOG.md` | modify | Player-facing entry |

---

### Task 1: Driving line from the track tiles

**Files:**
- Create: `js/race/TrackPath.js`
- Create: `test/track-path.test.mjs`

**Interfaces:**
- Consumes: `PRESET_TRACKS` from `js/Tracks.js` (test only). Cells are `[ gx, gz, type, godotOrient ]` as in `js/Track.js`.
- Produces: `openSides( type, orient ) → [ [dx,dz], [dx,dz] ] | null`; `trackOrder( cells ) → [ { cell, from, to } ] | null`; `buildPath( cells, cellSize ) → { points: [ [x,z] ], corner: [ bool per segment ], dist: [ number per point ], length } | null`; `samplePath( path, s, lateral = 0 ) → { x, z, heading, corner }` (heading: forward = `( sin heading, cos heading )`; `lateral` > 0 = right of the line, same frame as `gridSlots`).

- [ ] **Step 0: Check that #1 is merged**

Run: `test -f js/race/RaceState.js && test -f js/race/Opponents.js && test -f js/race/Interpolate.js && test -f js/ui/strings.js && grep -q resetForRace js/LapTimer.js && grep -q 'const game = {' js/main.js && echo ready`
Expected: `ready`. If not, **stop** — this plan builds on #1 (P2P multiplayer) and must not re-implement its modules.

- [ ] **Step 1: Write the failing test**

Create `test/track-path.test.mjs`:

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESET_TRACKS } from '../js/Tracks.js';
import { openSides, trackOrder, buildPath, samplePath } from '../js/race/TrackPath.js';

const CELL = 9.99 * 0.75;
const TYPE_NAMES = [ 'track-straight', 'track-corner', 'track-bump', 'track-finish' ];
const ORIENT_TO_GODOT = [ 0, 16, 10, 22 ];

// Same byte layout as decodeCells in js/Track.js (which needs three.js, so not imported here)
function decode( str ) {

	const bytes = Buffer.from( str.replace( /-/g, '+' ).replace( /_/g, '/' ), 'base64' );
	const cells = [];
	for ( let i = 0; i + 2 < bytes.length; i += 3 ) cells.push( [ bytes[ i ] - 128, bytes[ i + 1 ] - 128, TYPE_NAMES[ bytes[ i + 2 ] >> 2 ], ORIENT_TO_GODOT[ bytes[ i + 2 ] & 3 ] ] );
	return cells;

}

// TRACK_CELLS from js/Track.js (the default circuit), copied because Track.js imports three.js.
const DEFAULT_TRACK = [
	[ - 3, - 3, 'track-corner', 16 ], [ - 2, - 3, 'track-straight', 22 ], [ - 1, - 3, 'track-straight', 22 ], [ 0, - 3, 'track-corner', 0 ],
	[ - 3, - 2, 'track-straight', 0 ], [ 0, - 2, 'track-straight', 0 ], [ - 3, - 1, 'track-corner', 10 ], [ - 2, - 1, 'track-corner', 0 ],
	[ 0, - 1, 'track-straight', 0 ], [ - 2, 0, 'track-straight', 10 ], [ 0, 0, 'track-finish', 0 ], [ - 2, 1, 'track-straight', 10 ],
	[ 0, 1, 'track-straight', 0 ], [ - 2, 2, 'track-corner', 10 ], [ - 1, 2, 'track-straight', 16 ], [ 0, 2, 'track-corner', 22 ],
];

test( 'openSides_cornerAtEachOrientation_matchesTheDefaultTrack', () => {

	assert.deepEqual( openSides( 'track-corner', 0 ), [ [ - 1, 0 ], [ 0, 1 ] ] );
	assert.deepEqual( openSides( 'track-corner', 16 ), [ [ 0, 1 ], [ 1, 0 ] ] );
	assert.deepEqual( openSides( 'track-corner', 10 ), [ [ 1, 0 ], [ 0, - 1 ] ] );
	assert.deepEqual( openSides( 'track-corner', 22 ), [ [ 0, - 1 ], [ - 1, 0 ] ] );
	assert.deepEqual( openSides( 'track-straight', 22 ), [ [ - 1, 0 ], [ 1, 0 ] ] );
	assert.equal( openSides( 'decoration-forest', 0 ), null );

} );

test( 'trackOrder_defaultTrack_startsAtFinishAndFollowsItsDirection', () => {

	const order = trackOrder( DEFAULT_TRACK );
	assert.equal( order.length, DEFAULT_TRACK.length );
	assert.deepEqual( order.slice( 0, 4 ).map( ( o ) => o.cell.slice( 0, 2 ) ), [ [ 0, 0 ], [ 0, 1 ], [ 0, 2 ], [ - 1, 2 ] ] );

} );

for ( const t of PRESET_TRACKS.filter( ( t ) => t.map ) ) {

	test( `trackOrder_${ t.id }_visitsEveryCellOnce`, () => {

		const cells = decode( t.map );
		const order = trackOrder( cells );
		assert.ok( order, 'no loop found' );
		assert.equal( new Set( order.map( ( o ) => o.cell ) ).size, cells.length );

	} );

}

test( 'trackOrder_touchingParallelLanes_followsPiecesNotGridNeighbours', () => {

	// The Aerodrome has cells with three or four track neighbours (lanes side by side); the walk must
	// still use piece connectivity and find the single loop.
	const aero = decode( PRESET_TRACKS.find( ( t ) => t.id === 'aero' ).map );
	const has = new Set( aero.map( ( c ) => c[ 0 ] + ',' + c[ 1 ] ) );
	const crowded = aero.filter( ( [ x, z ] ) => [ [ 1, 0 ], [ - 1, 0 ], [ 0, 1 ], [ 0, - 1 ] ].filter( ( [ dx, dz ] ) => has.has( ( x + dx ) + ',' + ( z + dz ) ) ).length > 2 );
	assert.ok( crowded.length > 0, 'fixture no longer has touching lanes' );
	assert.equal( trackOrder( aero ).length, aero.length );

} );

test( 'trackOrder_reversedFinish_drivesTheLoopTheOtherWay', () => {

	const reversed = DEFAULT_TRACK.map( ( c ) => c[ 2 ] === 'track-finish' ? [ 0, 0, 'track-finish', 10 ] : c );
	assert.deepEqual( trackOrder( reversed )[ 1 ].cell.slice( 0, 2 ), [ 0, - 1 ] );

} );

test( 'trackOrder_brokenOrOpenTrack_returnsNull', () => {

	assert.equal( trackOrder( DEFAULT_TRACK.filter( ( c ) => c[ 0 ] !== - 1 || c[ 1 ] !== 2 ) ), null, 'gap' );
	assert.equal( trackOrder( DEFAULT_TRACK.filter( ( c ) => c[ 2 ] !== 'track-finish' ) ), null, 'no finish' );
	assert.equal( trackOrder( [ ...DEFAULT_TRACK, [ 5, 5, 'track-straight', 0 ] ] ), null, 'stray cell' );
	assert.equal( trackOrder( DEFAULT_TRACK.map( ( c ) => c[ 0 ] === 0 && c[ 1 ] === 2 ? [ 0, 2, 'track-corner', 16 ] : c ) ), null, 'corner turned wrong' );
	assert.equal( trackOrder( [] ), null, 'empty' );

} );

test( 'buildPath_defaultTrack_isAClosedLoopStartingOnTheFinishLine', () => {

	const path = buildPath( DEFAULT_TRACK, CELL );
	assert.deepEqual( path.points[ 0 ], [ 0.5 * CELL, 0.5 * CELL ] );
	assert.deepEqual( path.points.at( - 1 ), path.points[ 0 ] );
	assert.equal( path.corner.length, path.points.length - 1 );
	// 10 straight-ish cells at one cell each plus 6 quarter arcs of radius half a cell
	assert.ok( Math.abs( path.length - ( 10 * CELL + 6 * Math.PI / 4 * CELL ) ) < 0.2, `length ${ path.length }` );
	assert.equal( buildPath( DEFAULT_TRACK.slice( 1 ), CELL ), null );

} );

test( 'samplePath_wrapsAndOffsetsToTheRight', () => {

	const path = buildPath( DEFAULT_TRACK, CELL );
	const start = samplePath( path, 0, 1 );
	assert.ok( Math.abs( start.x - ( 0.5 * CELL + 1 ) ) < 1e-9 && Math.abs( start.z - 0.5 * CELL ) < 1e-9 );
	assert.equal( start.heading, 0 );
	assert.equal( start.corner, false );
	const wrapped = samplePath( path, path.length + 2 );
	const plain = samplePath( path, 2 );
	assert.ok( Math.abs( wrapped.x - plain.x ) < 1e-9 && Math.abs( wrapped.z - plain.z ) < 1e-9 );
	const behind = samplePath( path, - 3 );
	assert.ok( Math.abs( behind.z - ( 0.5 * CELL - 3 ) ) < 1e-9, 'negative distances wrap to the end of the lap' );
	assert.equal( samplePath( path, 2 * CELL + 1 ).corner, true, 'third cell is a corner' );

} );
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/*.test.mjs`
Expected: FAIL — `Cannot find module …/js/race/TrackPath.js`

- [ ] **Step 3: Implement `js/race/TrackPath.js`**

Create `js/race/TrackPath.js`:

```js
// TrackPath.js — the driving line of a tile track: walks the pieces from the finish line in its driving
// direction and turns them into a closed polyline CPU drivers follow. Pure (no three.js, no DOM).
// Cells are [ gx, gz, type, godotOrient ] as in Track.js; world x/z of a cell centre = ( g + 0.5 ) * cellSize.

const ORIENT_DEG = { 0: 0, 10: 180, 16: 90, 22: 270 }; // same table as Track.js
const ARC_STEPS = 6; // corner arcs are drawn with 6 segments of 15°

// Open sides of a piece at orientation 0, as grid steps [ dx, dz ]. Straight, bump and finish run along z;
// a corner joins -x and +z (checked against the default track in Track.js).
const OPEN_SIDES = {
	'track-straight': [ [ 0, 1 ], [ 0, - 1 ] ],
	'track-bump': [ [ 0, 1 ], [ 0, - 1 ] ],
	'track-finish': [ [ 0, 1 ], [ 0, - 1 ] ],
	'track-corner': [ [ - 1, 0 ], [ 0, 1 ] ],
};

// Rotates a grid step like three.js rotation.y does: +z turns towards +x for positive angles.
function rotateStep( [ dx, dz ], deg ) {

	const a = deg * Math.PI / 180;
	return [ Math.round( dx * Math.cos( a ) + dz * Math.sin( a ) ) + 0, Math.round( - dx * Math.sin( a ) + dz * Math.cos( a ) ) + 0 ]; // + 0 turns -0 into 0

}

// The two grid steps through which a piece connects to its neighbours.
export function openSides( type, orient ) {

	const sides = OPEN_SIDES[ type ];
	if ( ! sides ) return null;
	return sides.map( ( s ) => rotateStep( s, ORIENT_DEG[ orient ] ?? 0 ) );

}

// Cells in driving order, starting at the finish cell and leaving it forwards. Each entry is
// { cell, from: [dx,dz] step we entered with, to: [dx,dz] step we leave with }. null unless the
// pieces form one closed loop that uses every cell exactly once.
export function trackOrder( cells ) {

	const finish = cells.find( ( c ) => c[ 2 ] === 'track-finish' );
	if ( ! finish ) return null;

	const byKey = new Map( cells.map( ( c ) => [ c[ 0 ] + ',' + c[ 1 ], c ] ) );
	const forward = rotateStep( [ 0, 1 ], ORIENT_DEG[ finish[ 3 ] ] ?? 0 );
	const order = [];
	let cell = finish, from = forward;

	for ( let i = 0; i < cells.length; i ++ ) {

		const to = exitStep( cell, from );
		if ( ! to ) return null;
		order.push( { cell, from, to } );
		cell = byKey.get( ( cell[ 0 ] + to[ 0 ] ) + ',' + ( cell[ 1 ] + to[ 1 ] ) );
		if ( ! cell ) return null;
		from = to;
		if ( cell === finish ) break;

	}

	if ( cell !== finish || order.length !== byKey.size ) return null;
	if ( from[ 0 ] !== forward[ 0 ] || from[ 1 ] !== forward[ 1 ] ) return null;
	return order;

}

// Entering a cell moving by step `from`, we come in through side -from; we leave through the other open side.
function exitStep( cell, from ) {

	const sides = openSides( cell[ 2 ], cell[ 3 ] );
	if ( ! sides ) return null;
	const back = sides.findIndex( ( [ dx, dz ] ) => dx === - from[ 0 ] && dz === - from[ 1 ] );
	return back === - 1 ? null : sides[ 1 - back ];

}

// Closed driving line through the cell centres of straights and along quarter arcs in corners, starting
// on the finish line (finish cell centre). Returns { points: [ [x,z] … ], corner: [ bool per segment ],
// dist: [ cumulative distance per point ], length } or null when trackOrder fails.
export function buildPath( cells, cellSize ) {

	const order = trackOrder( cells );
	if ( ! order ) return null;

	const points = [], corner = [];
	const [ first ] = order;
	points.push( centre( first.cell, cellSize ) );

	for ( let i = 0; i < order.length; i ++ ) {

		const { cell, from, to } = order[ i ];
		const isCorner = from[ 0 ] !== to[ 0 ] || from[ 1 ] !== to[ 1 ];
		const [ cx, cz ] = centre( cell, cellSize );
		const half = cellSize / 2;

		if ( i > 0 && isCorner ) {

			for ( const p of arcPoints( cx, cz, half, from, to ) ) { points.push( p ); corner.push( true ); }

		} else if ( i > 0 ) {

			points.push( [ cx, cz ] ); corner.push( false );

		}

		// Exit edge midpoint of this cell (the finish cell is only left, never re-entered here).
		points.push( [ cx + to[ 0 ] * half, cz + to[ 1 ] * half ] ); corner.push( i > 0 && isCorner );

	}

	points.push( points[ 0 ].slice() ); corner.push( false ); // back to the finish line

	const dist = [ 0 ];
	for ( let i = 1; i < points.length; i ++ ) dist.push( dist[ i - 1 ] + Math.hypot( points[ i ][ 0 ] - points[ i - 1 ][ 0 ], points[ i ][ 1 ] - points[ i - 1 ][ 1 ] ) );
	return { points, corner, dist, length: dist[ dist.length - 1 ] };

}

function centre( cell, cellSize ) {

	return [ ( cell[ 0 ] + 0.5 ) * cellSize, ( cell[ 1 ] + 0.5 ) * cellSize ];

}

// Quarter circle from the entry edge midpoint to the exit edge midpoint, around the cell corner between
// the entry side and the exit side. Returns the inner points plus none of the ends (the entry edge point
// is already on the path; the exit edge point is pushed by the caller).
function arcPoints( cx, cz, half, from, to ) {

	const ox = cx - from[ 0 ] * half + to[ 0 ] * half; // arc centre: entry side + exit side corner
	const oz = cz - from[ 1 ] * half + to[ 1 ] * half;
	const a0 = Math.atan2( ( cz - from[ 1 ] * half ) - oz, ( cx - from[ 0 ] * half ) - ox );
	const a1 = Math.atan2( ( cz + to[ 1 ] * half ) - oz, ( cx + to[ 0 ] * half ) - ox );
	let da = a1 - a0;
	if ( da > Math.PI ) da -= Math.PI * 2;
	if ( da < - Math.PI ) da += Math.PI * 2;

	const pts = [];
	for ( let k = 1; k < ARC_STEPS; k ++ ) {

		const a = a0 + da * k / ARC_STEPS;
		pts.push( [ ox + Math.cos( a ) * half, oz + Math.sin( a ) * half ] );

	}

	return pts;

}

// Point on the closed path at distance s (any real number, wraps), shifted `lateral` units to the right
// of the driving direction. heading is the yaw angle with forward = ( sin heading, cos heading ), the same
// convention as Track.js spawn angles. corner says whether s lies on a corner arc.
export function samplePath( path, s, lateral = 0 ) {

	const d = ( ( s % path.length ) + path.length ) % path.length;
	let i = 1;
	while ( i < path.dist.length - 1 && path.dist[ i ] < d ) i ++;
	const a = path.points[ i - 1 ], b = path.points[ i ];
	const segLen = path.dist[ i ] - path.dist[ i - 1 ] || 1;
	const k = ( d - path.dist[ i - 1 ] ) / segLen;
	const fx = ( b[ 0 ] - a[ 0 ] ) / segLen, fz = ( b[ 1 ] - a[ 1 ] ) / segLen;
	const rx = fz, rz = - fx; // right of forward, same as gridSlots in RaceState.js

	return {
		x: a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * k + rx * lateral,
		z: a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * k + rz * lateral,
		heading: Math.atan2( fx, fz ),
		corner: path.corner[ i - 1 ],
	};

}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/*.test.mjs`
Expected: all pass (default track and all four presets form one loop).

- [ ] **Step 5: Commit**

```bash
git add js/race/TrackPath.js test/track-path.test.mjs
git commit -F - <<'MSG'
feat(cpu): driving line from the track tiles

Walks the pieces from the finish line and builds a closed line through
straights and corner arcs; null when the track is not one loop.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

---

### Task 2: CPU driver

**Files:**
- Create: `js/race/CpuDriver.js`
- Create: `test/cpu-driver.test.mjs`

**Interfaces:**
- Consumes: Task 1 `buildPath`, `samplePath`.
- Produces: `DIFFICULTY = { easy: { speed, corner }, medium, hard }`, `ACCELERATION`, `BRAKING`, `LOOK_AHEAD`; `class CpuDriver { constructor( { path, start, lateral, difficulty, pace = 1 } ); update( dt ); lapsDone() → int; progress() → 0..1; state() → { p: [x,y,z], q: [x,y,z,w], v: [x,y,z] }; distance; speed; path }`.

- [ ] **Step 1: Write the failing test**

Create `test/cpu-driver.test.mjs`:

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPath } from '../js/race/TrackPath.js';
import { CpuDriver, DIFFICULTY } from '../js/race/CpuDriver.js';

const CELL = 9.99 * 0.75;

// TRACK_CELLS from js/Track.js (the default circuit), copied because Track.js imports three.js.
const DEFAULT_TRACK = [
	[ - 3, - 3, 'track-corner', 16 ], [ - 2, - 3, 'track-straight', 22 ], [ - 1, - 3, 'track-straight', 22 ], [ 0, - 3, 'track-corner', 0 ],
	[ - 3, - 2, 'track-straight', 0 ], [ 0, - 2, 'track-straight', 0 ], [ - 3, - 1, 'track-corner', 10 ], [ - 2, - 1, 'track-corner', 0 ],
	[ 0, - 1, 'track-straight', 0 ], [ - 2, 0, 'track-straight', 10 ], [ 0, 0, 'track-finish', 0 ], [ - 2, 1, 'track-straight', 10 ],
	[ 0, 1, 'track-straight', 0 ], [ - 2, 2, 'track-corner', 10 ], [ - 1, 2, 'track-straight', 16 ], [ 0, 2, 'track-corner', 22 ],
];

function driver( difficulty = DIFFICULTY.medium, start = 0 ) {

	return new CpuDriver( { path: buildPath( DEFAULT_TRACK, CELL ), start, lateral: 0, difficulty } );

}

test( 'update_fromStandstill_acceleratesAndEntersTheFirstCornerAtCornerSpeed', () => {

	const d = driver();
	d.update( 0.5 );
	assert.equal( d.speed, 3 );
	const firstCorner = 1.5 * CELL; // finish centre → (0,1) straight → corner (0,2)
	while ( d.distance < firstCorner ) d.update( 1 / 60 );
	assert.ok( d.speed <= DIFFICULTY.medium.speed * DIFFICULTY.medium.corner + 1e-9, `entered the corner at ${ d.speed }` );

} );

test( 'update_harderDifficulty_finishesALapSooner', () => {

	const lapTime = ( difficulty ) => {

		const d = driver( difficulty );
		let t = 0;
		while ( d.lapsDone() < 1 ) { d.update( 1 / 60 ); t += 1 / 60; }
		return t;

	};

	const easy = lapTime( DIFFICULTY.easy ), medium = lapTime( DIFFICULTY.medium ), hard = lapTime( DIFFICULTY.hard );
	assert.ok( easy > medium && medium > hard, `${ easy } ${ medium } ${ hard }` );
	assert.ok( hard > 110 / 40, 'still slower than RaceState accepts' );

} );

test( 'lapsDone_startingBehindTheLine_countsOnlyFullLapsFromTheLine', () => {

	const d = driver( DIFFICULTY.medium, - CELL );
	assert.equal( d.lapsDone(), 0 );
	assert.equal( d.progress(), 0 );
	d.distance = d.path.length - 0.1;
	assert.equal( d.lapsDone(), 0 );
	d.distance = d.path.length * 2 + 1;
	assert.equal( d.lapsDone(), 2 );
	assert.ok( Math.abs( d.progress() - 1 / d.path.length ) < 1e-9 );

} );

test( 'state_onTheStraight_facesForwardWithYawOnlyQuaternion', () => {

	const d = driver();
	d.distance = 2;
	d.speed = 5;
	const { p, q, v } = d.state();
	assert.ok( Math.abs( p[ 0 ] - 0.5 * CELL ) < 1e-9 && p[ 1 ] === 0.5 && Math.abs( p[ 2 ] - ( 0.5 * CELL + 2 ) ) < 1e-9 );
	assert.deepEqual( q, [ 0, 0, 0, 1 ] );
	assert.deepEqual( v, [ 0, 0, 5 ] );

} );

test( 'state_throughACorner_turnsSmoothly', () => {

	const d = driver();
	const yaw = ( s ) => { d.distance = s; const q = d.state().q; return 2 * Math.atan2( q[ 1 ], q[ 3 ] ); };
	let prev = yaw( 1.5 * CELL - 1 );
	for ( let s = 1.5 * CELL - 1; s < 2.5 * CELL + 1; s += 0.25 ) {

		const a = yaw( s );
		let diff = a - prev;
		while ( diff > Math.PI ) diff -= 2 * Math.PI;
		while ( diff < - Math.PI ) diff += 2 * Math.PI;
		assert.ok( Math.abs( diff ) < 0.1, `jump of ${ diff } rad at ${ s }` );
		prev = a;

	}

} );
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/*.test.mjs`
Expected: FAIL — `Cannot find module …/js/race/CpuDriver.js`

- [ ] **Step 3: Implement `js/race/CpuDriver.js`**

Create `js/race/CpuDriver.js`:

```js
// CpuDriver.js — one CPU truck: drives along a TrackPath at a speed set by its difficulty, slowing
// down for corners, and reports where it is as a { p, q, v } state for Opponents. Pure.

import { samplePath } from './TrackPath.js';

// Speeds in world units per second. The player's fastest laps average about 13 units/s
// (RaceState.js MAX_AVG_SPEED = 40 is "about three times" that). Tune here after play-testing.
export const DIFFICULTY = {
	easy: { speed: 8, corner: 0.6 },
	medium: { speed: 10, corner: 0.7 },
	hard: { speed: 12.5, corner: 0.75 },
};

export const ACCELERATION = 6;   // units/s² when speeding up
export const BRAKING = 14;       // units/s² when slowing for a corner
export const LOOK_AHEAD = 4;     // units: start braking when a corner is this close
const SPHERE_Y = 0.5;            // sphere centre height, as the player's (Physics.js createSphereBody)
const HEADING_SPAN = 1;          // units: heading is taken from the line this far behind to this far ahead

export class CpuDriver {

	// path: buildPath() result; start: distance along the path (≤ 0 = behind the finish line);
	// lateral: lane offset to the right of the line; difficulty: a DIFFICULTY entry; pace: speed multiplier.
	constructor( { path, start, lateral, difficulty, pace = 1 } ) {

		this.path = path;
		this.distance = start;
		this.lateral = lateral;
		this.topSpeed = difficulty.speed * pace;
		this.cornerSpeed = difficulty.speed * difficulty.corner * pace;
		this.speed = 0;

	}

	// Advances the truck by dt seconds.
	update( dt ) {

		const target = this.targetSpeed();
		const rate = target > this.speed ? ACCELERATION : BRAKING;
		const step = rate * dt;
		this.speed = Math.abs( target - this.speed ) <= step ? target : this.speed + Math.sign( target - this.speed ) * step;
		this.distance += this.speed * dt;

	}

	targetSpeed() {

		const here = samplePath( this.path, this.distance, 0 ).corner;
		const ahead = samplePath( this.path, this.distance + LOOK_AHEAD, 0 ).corner;
		return here || ahead ? this.cornerSpeed : this.topSpeed;

	}

	// Completed laps: the first crossing of the finish line after the start is not a lap.
	lapsDone() {

		return Math.max( 0, Math.floor( this.distance / this.path.length ) );

	}

	// Fraction (0..1) of the current lap driven.
	progress() {

		if ( this.distance < 0 ) return 0;
		return ( this.distance % this.path.length ) / this.path.length;

	}

	// Pose for Opponents.push: position, yaw-only quaternion, velocity.
	state() {

		const { x, z } = samplePath( this.path, this.distance, this.lateral );
		const behind = samplePath( this.path, this.distance - HEADING_SPAN, 0 );
		const ahead = samplePath( this.path, this.distance + HEADING_SPAN, 0 );
		const heading = Math.atan2( ahead.x - behind.x, ahead.z - behind.z ); // smooth through the 15° arc steps
		const fx = Math.sin( heading ), fz = Math.cos( heading );
		return {
			p: [ x, SPHERE_Y, z ],
			q: [ 0, Math.sin( heading / 2 ), 0, Math.cos( heading / 2 ) ],
			v: [ fx * this.speed, 0, fz * this.speed ],
		};

	}

}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/*.test.mjs`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add js/race/CpuDriver.js test/cpu-driver.test.mjs
git commit -F - <<'MSG'
feat(cpu): CPU truck that drives the line

Accelerates to its difficulty speed, brakes for corners, counts laps
from the finish line and reports a pose for Opponents.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

---

### Task 3: vs-CPU race controller

**Files:**
- Create: `js/race/CpuRace.js`
- Create: `test/cpu-race.test.mjs`

**Interfaces:**
- Consumes: Task 1 `buildPath`; Task 2 `CpuDriver`, `DIFFICULTY`; #1 `RaceState`, `PHASE`, `gridSlots`, `COUNTDOWN_MS`, `RESULTS_GRACE_MS` (`js/race/RaceState.js`), `RENDER_DELAY_MS` (`js/race/Interpolate.js`), `MAX_LAPS` (`js/net/Protocol.js`), `FUNNY_NAMES` (`js/ui/strings.js`).
- The **game adapter** it expects (a subset of #1's `game` in `main.js`, with its own `opponents`): `{ trackCells, cellSize, lapTimer: { onLap, resetForRace(), startRace(), resetForSolo(), progress() }, opponents: { add( id, name, index ), push( id, state, now ), update( dt, now ), clear() }, placeOnSlot( slot ), setHold( hold ) }`.
- Produces: `MAX_CPUS = 3`, `YOU = 'you'`, `DEFAULT_SETTINGS`, `cleanSettings( settings )`, `laneOf( slot, finishCell, cellSize ) → { start, lateral }`, `class CpuRace { constructor( game, { onChange, now } ); available; start( settings ) → bool; rematch(); quit(); update( dt ); view() → { available, settings, phase, laps, countdown: '3'|'2'|'1'|'go'|null, positions: [ { id, name, you, lap, finished } ], results: [ { id, name, place, total, best } ] | null }; drivers: Map; race: RaceState | null }`.

- [ ] **Step 1: Write the failing test**

Create `test/cpu-race.test.mjs`:

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CpuRace, YOU, cleanSettings, laneOf } from '../js/race/CpuRace.js';
import { COUNTDOWN_MS, RESULTS_GRACE_MS, gridSlots } from '../js/race/RaceState.js';
import { RENDER_DELAY_MS } from '../js/race/Interpolate.js';

const CELL = 9.99 * 0.75;

// TRACK_CELLS from js/Track.js (the default circuit), copied because Track.js imports three.js.
const DEFAULT_TRACK = [
	[ - 3, - 3, 'track-corner', 16 ], [ - 2, - 3, 'track-straight', 22 ], [ - 1, - 3, 'track-straight', 22 ], [ 0, - 3, 'track-corner', 0 ],
	[ - 3, - 2, 'track-straight', 0 ], [ 0, - 2, 'track-straight', 0 ], [ - 3, - 1, 'track-corner', 10 ], [ - 2, - 1, 'track-corner', 0 ],
	[ 0, - 1, 'track-straight', 0 ], [ - 2, 0, 'track-straight', 10 ], [ 0, 0, 'track-finish', 0 ], [ - 2, 1, 'track-straight', 10 ],
	[ 0, 1, 'track-straight', 0 ], [ - 2, 2, 'track-corner', 10 ], [ - 1, 2, 'track-straight', 16 ], [ 0, 2, 'track-corner', 22 ],
];

// The game adapter CpuRace expects (see main.js), recording what the race does to it.
function fakeGame( trackCells = DEFAULT_TRACK ) {

	return {
		trackCells,
		cellSize: CELL,
		hold: false,
		slot: null,
		lapTimer: {
			onLap: 'solo-hook', progressValue: 0, started: false, soloResets: 0, raceResets: 0,
			resetForRace() { this.raceResets ++; this.started = false; }, startRace() { this.started = true; },
			resetForSolo() { this.soloResets ++; this.started = false; }, progress() { return this.progressValue; },
		},
		opponents: {
			trucks: new Map(), pushes: [], updates: [],
			add( id, name, index ) { this.trucks.set( id, { name, index } ); },
			push( id, state, now ) { this.pushes.push( { id, state, now } ); },
			update( dt, now ) { this.updates.push( now ); },
			clear() { this.trucks.clear(); },
		},
		placeOnSlot( slot ) { this.slot = slot; },
		setHold( hold ) { this.hold = hold; },
	};

}

function setup( settings = { cpus: 3, difficulty: 'medium', laps: 2 } ) {

	const clock = { t: 1000 };
	const views = [];
	const game = fakeGame();
	const race = new CpuRace( game, { onChange: ( v ) => views.push( v ), now: () => clock.t } );
	race.start( settings );
	const step = ( ms ) => { clock.t += ms; race.update( ms / 1000 ); };
	const runUntil = ( done, limitMs = 300000 ) => { for ( let n = 0; ! done() && n < limitMs; n += 20 ) step( 20 ); };
	const cpusFinished = () => [ ...race.drivers.keys() ].every( ( id ) => race.race.find( id ).total !== null );
	return { clock, views, game, race, step, runUntil, cpusFinished };

}

test( 'cleanSettings_outOfRangeOrUnknown_clampsOrFallsBack', () => {

	assert.deepEqual( cleanSettings( { cpus: 9, difficulty: 'insane', laps: 0 } ), { cpus: 3, difficulty: 'medium', laps: 1 } );
	assert.deepEqual( cleanSettings( { cpus: 1, difficulty: 'hard', laps: 12 } ), { cpus: 1, difficulty: 'hard', laps: 10 } );
	assert.deepEqual( cleanSettings(), { cpus: 3, difficulty: 'medium', laps: 3 } );
	assert.deepEqual( cleanSettings( { cpus: '2', difficulty: 'toString', laps: 2.5 } ), { cpus: 3, difficulty: 'medium', laps: 3 } );

} );

test( 'laneOf_gridSlots_giveDistanceBehindTheLineAndLateralOffset', () => {

	const finish = [ 0, 0, 'track-finish', 0 ];
	const slots = gridSlots( finish, 10, ( gx, gz ) => gx === 0 && gz === - 1 );
	const lanes = slots.map( ( s ) => laneOf( s, finish, 10 ) );
	assert.deepEqual( lanes.map( ( l ) => [ + l.start.toFixed( 2 ) + 0, + l.lateral.toFixed( 2 ) + 0 ] ), [ [ 0, - 2.2 ], [ 0, 2.2 ], [ - 10, - 2.2 ], [ - 10, 2.2 ] ] );

} );

test( 'available_trackWithoutALoop_isFalseAndStartRefuses', () => {

	const game = fakeGame( DEFAULT_TRACK.slice( 1 ) );
	const race = new CpuRace( game, { now: () => 0 } );
	assert.equal( race.available, false );
	assert.equal( race.start( {} ), false );
	assert.equal( game.hold, false );
	assert.equal( game.lapTimer.raceResets, 0 );
	assert.equal( race.view().available, false );

} );

test( 'start_threeCpus_fillsTheFrontSlotsPutsYouLastAndHoldsInput', () => {

	const { game, race, views } = setup();
	assert.equal( game.slot, 3 );
	assert.equal( game.hold, true );
	assert.equal( game.lapTimer.raceResets, 1 );
	assert.deepEqual( [ ...game.opponents.trucks.entries() ].map( ( [ id, t ] ) => [ id, t.index ] ), [ [ 'cpu1', 0 ], [ 'cpu2', 1 ], [ 'cpu3', 2 ] ] );
	assert.equal( views.at( - 1 ).phase, 'countdown' );
	assert.equal( views.at( - 1 ).countdown, '3' );
	assert.equal( race.view().positions.length, 4 );

} );

test( 'start_oneCpu_putsYouOnTheSecondFrontSlot', () => {

	const { game } = setup( { cpus: 1, difficulty: 'easy', laps: 1 } );
	assert.equal( game.slot, 1 );
	assert.equal( game.opponents.trucks.size, 1 );

} );

test( 'update_duringCountdown_cpusWaitOnTheGrid', () => {

	const { race, step } = setup();
	const before = [ ...race.drivers.values() ].map( ( d ) => d.distance );
	step( COUNTDOWN_MS - 100 );
	assert.deepEqual( [ ...race.drivers.values() ].map( ( d ) => d.distance ), before );

} );

test( 'update_atGo_releasesHoldStartsTimerAndCpusDriveOff', () => {

	const { game, race, step } = setup();
	step( COUNTDOWN_MS );
	assert.equal( game.hold, false );
	assert.equal( game.lapTimer.started, true );
	assert.equal( race.view().countdown, 'go' );
	step( 500 );
	assert.ok( [ ...race.drivers.values() ].every( ( d ) => d.speed > 0 ) );

} );

test( 'update_eachFrame_pushesCpuStatesAtNowAndSamplesThemWithoutDelay', () => {

	const { game, clock, step } = setup();
	step( 20 );
	const last = game.opponents.pushes.slice( - 3 );
	assert.deepEqual( last.map( ( p ) => [ p.id, p.now ] ), [ [ 'cpu1', clock.t ], [ 'cpu2', clock.t ], [ 'cpu3', clock.t ] ] );
	assert.equal( game.opponents.updates.at( - 1 ), clock.t + RENDER_DELAY_MS );

} );

test( 'race_cpusFinishYouDoNot_resultsAfterGraceWithYouLast', () => {

	const { race, runUntil, step, cpusFinished } = setup();
	runUntil( cpusFinished );
	assert.equal( race.view().phase, 'racing' );
	step( RESULTS_GRACE_MS );
	const results = race.view().results;
	assert.equal( results.length, 4 );
	assert.equal( results.at( - 1 ).id, YOU );
	assert.equal( results.at( - 1 ).total, null );
	assert.ok( results.slice( 0, 3 ).every( ( r ) => r.total > 0 && r.best > 0 ) );

} );

test( 'playerLap_viaLapTimerHook_isRecordedAndLastLapFinishes', () => {

	const { game, race, step } = setup( { cpus: 1, difficulty: 'easy', laps: 2 } );
	step( COUNTDOWN_MS );
	game.lapTimer.onLap( 1, 30 );
	game.lapTimer.onLap( 2, 29 );
	const you = race.race.find( YOU );
	assert.deepEqual( [ you.laps, you.total, you.best ], [ 2, 59, 29 ] );
	assert.equal( race.view().positions[ 0 ].id, YOU );
	assert.equal( race.view().phase, 'racing', 'CPU still out there' );

} );

test( 'quit_midRace_restoresSoloLapTimerAndRemovesCpus', () => {

	const { game, race, step, views } = setup();
	step( COUNTDOWN_MS + 1000 );
	race.quit();
	assert.equal( game.lapTimer.onLap, 'solo-hook' );
	assert.equal( game.lapTimer.soloResets, 1 );
	assert.equal( game.opponents.trucks.size, 0 );
	assert.equal( game.hold, false );
	assert.equal( views.at( - 1 ).phase, null );
	race.quit();
	assert.equal( game.lapTimer.soloResets, 1, 'second quit is a no-op' );

} );

test( 'quit_duringCountdown_releasesHeldInput', () => {

	const { game, race, step } = setup();
	step( 1000 );
	race.quit();
	assert.equal( game.hold, false );
	step( COUNTDOWN_MS );
	assert.equal( game.lapTimer.started, false, 'no GO after quitting' );

} );

test( 'start_whileARaceIsRunning_replacesItWithoutLosingTheSoloHook', () => {

	const { game, race, step } = setup();
	step( COUNTDOWN_MS + 500 );
	race.start( { cpus: 1, difficulty: 'hard', laps: 1 } );
	assert.equal( game.opponents.trucks.size, 1 );
	assert.equal( race.view().phase, 'countdown' );
	race.quit();
	assert.equal( game.lapTimer.onLap, 'solo-hook' );

} );

test( 'rematch_afterResults_restartsWithTheSameSettings', () => {

	const { game, race, runUntil, step, cpusFinished } = setup( { cpus: 2, difficulty: 'hard', laps: 1 } );
	runUntil( cpusFinished );
	step( RESULTS_GRACE_MS );
	assert.equal( race.view().phase, 'results' );
	race.rematch();
	assert.equal( race.view().phase, 'countdown' );
	assert.deepEqual( race.view().settings, { cpus: 2, difficulty: 'hard', laps: 1 } );
	assert.notEqual( game.lapTimer.onLap, 'solo-hook', 'race hook installed again' );
	race.quit();
	assert.equal( game.lapTimer.onLap, 'solo-hook' );

} );
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/*.test.mjs`
Expected: FAIL — `Cannot find module …/js/race/CpuRace.js`

- [ ] **Step 3: Implement `js/race/CpuRace.js`**

Create `js/race/CpuRace.js`:

```js
// CpuRace.js — a single-player race against 1–3 CPU trucks. Reuses the multiplayer race rules
// (RaceState: countdown, laps, finishing order, results) and grid; CPU trucks are CpuDrivers shown
// through Opponents. Pure: talks to the game only through the `game` adapter (see main.js):
//   { trackCells, cellSize, lapTimer: { onLap, resetForRace(), startRace(), resetForSolo(), progress() },
//     opponents: { add, push, update, clear }, placeOnSlot( slot ), setHold( hold ) }

import { RaceState, PHASE, gridSlots } from './RaceState.js';
import { RENDER_DELAY_MS } from './Interpolate.js';
import { MAX_LAPS } from '../net/Protocol.js';
import { FUNNY_NAMES } from '../ui/strings.js';
import { buildPath } from './TrackPath.js';
import { CpuDriver, DIFFICULTY } from './CpuDriver.js';

export const MAX_CPUS = 3;
export const YOU = 'you';
export const DEFAULT_SETTINGS = { cpus: 3, difficulty: 'medium', laps: 3 };
// CPUs differ a little so the field spreads out. Slots 0 and 2 share the left lane, so the car in front
// (slot 0) is the faster one — kinematic trucks pass through each other, so they must never catch up.
const PACE = [ 1.03, 1, 0.97 ];
const GO_SHOWN_MS = 1000;
const RENDER_EVERY_MS = 250;

const clampInt = ( v, min, max, fallback ) => Number.isInteger( v ) ? Math.min( max, Math.max( min, v ) ) : fallback;

// Settings from the UI, made safe: cpus 1–3, a known difficulty, laps 1–MAX_LAPS.
export function cleanSettings( { cpus, difficulty, laps } = {} ) {

	return {
		cpus: clampInt( cpus, 1, MAX_CPUS, DEFAULT_SETTINGS.cpus ),
		difficulty: Object.hasOwn( DIFFICULTY, difficulty ) ? difficulty : DEFAULT_SETTINGS.difficulty,
		laps: clampInt( laps, 1, MAX_LAPS, DEFAULT_SETTINGS.laps ),
	};

}

// Where a grid slot sits relative to the driving line: distance along it (≤ 0, behind the finish line)
// and lateral offset to the right — the same frame gridSlots and samplePath use.
export function laneOf( slot, finishCell, cellSize ) {

	const cx = ( finishCell[ 0 ] + 0.5 ) * cellSize, cz = ( finishCell[ 1 ] + 0.5 ) * cellSize;
	const fx = Math.sin( slot.angle ), fz = Math.cos( slot.angle );
	const dx = slot.position[ 0 ] - cx, dz = slot.position[ 2 ] - cz;
	return { start: dx * fx + dz * fz, lateral: dx * fz - dz * fx };

}

export class CpuRace {

	constructor( game, { onChange = null, now = () => performance.now() } = {} ) {

		this.game = game;
		this.onChange = onChange;
		this.now = now;
		this.path = buildPath( game.trackCells, game.cellSize );
		this.finishCell = game.trackCells.find( ( c ) => c[ 2 ] === 'track-finish' ) ?? null;
		this.settings = { ...DEFAULT_SETTINGS };
		this.race = null;
		this.drivers = new Map();   // cpu id → CpuDriver
		this.lapStart = new Map();  // cpu id → time (ms) its current lap started
		this.previousOnLap = null;
		this.lastRender = 0;

	}

	// false when the track is not one closed loop with a finish line (CPUs need a driving line).
	get available() {

		return this.path !== null;

	}

	// Sets up the grid and starts the countdown. Returns false when CPU races are not available.
	start( settings ) {

		if ( ! this.available ) return false;
		this.teardown();
		this.settings = cleanSettings( settings );
		const { cpus, laps, difficulty } = this.settings;
		const now = this.now();

		this.race = new RaceState( { cellCount: this.game.trackCells.length, cellSize: this.game.cellSize, laps } );
		this.race.addPlayer( YOU, YOU );
		const slots = this.gridSlots();
		for ( let i = 0; i < cpus; i ++ ) this.addCpu( i, slots[ i ], DIFFICULTY[ difficulty ] );

		this.game.placeOnSlot( cpus );
		this.game.setHold( true );
		this.game.lapTimer.resetForRace();
		this.previousOnLap = this.game.lapTimer.onLap;
		this.game.lapTimer.onLap = ( lap, time ) => this.playerLap( lap, time );
		this.race.start( now );
		this.pushStates( 0, now );
		this.changed( now );
		return true;

	}

	rematch() {

		return this.start( this.settings );

	}

	// Back to free driving: CPU trucks gone, lap timer back to single player.
	quit() {

		if ( ! this.race ) return;
		this.teardown();
		this.changed( this.now() );

	}

	// Once per frame, before the physics step.
	update( dt ) {

		if ( ! this.race ) return;
		const now = this.now();
		const before = this.race.phase;
		const phase = this.race.tick( now );

		if ( before === PHASE.COUNTDOWN && phase === PHASE.RACING ) this.go( now );
		if ( phase !== PHASE.COUNTDOWN ) this.drive( dt, now );
		this.pushStates( dt, now );

		if ( phase !== before || now - this.lastRender >= RENDER_EVERY_MS ) this.changed( now );

	}

	// Plain data for the UI.
	view() {

		const now = this.now();
		const phase = this.race?.phase ?? null;
		return {
			available: this.available,
			settings: { ...this.settings },
			phase,
			laps: this.settings.laps,
			countdown: this.countdownLabel( now ),
			positions: this.race ? this.race.standings( this.progressMap() ).map( ( id ) => this.row( id ) ) : [],
			results: phase === PHASE.RESULTS ? this.race.results( this.progressMap() ) : null,
		};

	}

	// ── Internals ───────────────────────────────────────────

	gridSlots() {

		const keys = new Set( this.game.trackCells.map( ( c ) => c[ 0 ] + ',' + c[ 1 ] ) );
		return gridSlots( this.finishCell, this.game.cellSize, ( gx, gz ) => keys.has( gx + ',' + gz ) );

	}

	addCpu( index, slot, difficulty ) {

		const id = 'cpu' + ( index + 1 );
		const name = FUNNY_NAMES[ index ];
		const { start, lateral } = laneOf( slot, this.finishCell, this.game.cellSize );
		this.race.addPlayer( id, name );
		this.drivers.set( id, new CpuDriver( { path: this.path, start, lateral, difficulty, pace: PACE[ index ] } ) );
		this.game.opponents.add( id, name, index );

	}

	go( now ) {

		this.game.setHold( false );
		this.game.lapTimer.startRace();
		for ( const id of this.drivers.keys() ) this.lapStart.set( id, now );

	}

	drive( dt, now ) {

		for ( const [ id, driver ] of this.drivers ) {

			driver.update( dt );
			this.recordCpuLaps( id, driver, now );

		}

	}

	recordCpuLaps( id, driver, now ) {

		const player = this.race.find( id );
		while ( player.total === null && player.laps < Math.min( driver.lapsDone(), this.race.laps ) ) {

			const lap = player.laps + 1;
			if ( ! this.race.recordLap( id, lap, ( now - this.lapStart.get( id ) ) / 1000 ) ) return;
			this.lapStart.set( id, now );
			if ( lap === this.race.laps ) this.race.recordFinish( id, now );

		}

	}

	playerLap( lap, time ) {

		if ( ! this.race ) return;
		const now = this.now();
		if ( this.race.recordLap( YOU, lap, time ) && lap === this.race.laps ) this.race.recordFinish( YOU, now );
		this.changed( now );

	}

	// CPU poses are pushed at `now` and sampled RENDER_DELAY_MS later on the Opponents clock,
	// so the trucks are drawn where they are, not 100 ms behind like remote players.
	pushStates( dt, now ) {

		for ( const [ id, driver ] of this.drivers ) this.game.opponents.push( id, driver.state(), now );
		this.game.opponents.update( dt, now + RENDER_DELAY_MS );

	}

	progressMap() {

		const map = new Map( [ [ YOU, this.game.lapTimer.progress() ] ] );
		for ( const [ id, driver ] of this.drivers ) map.set( id, driver.progress() );
		return map;

	}

	row( id ) {

		const p = this.race.find( id );
		return { id, name: p.name, you: id === YOU, lap: Math.min( p.laps + 1, this.race.laps ), finished: p.total !== null };

	}

	countdownLabel( now ) {

		if ( ! this.race || this.race.startAt === null ) return null;
		const left = this.race.startAt - now;
		if ( left > 0 ) return String( Math.ceil( left / 1000 ) );
		return left > - GO_SHOWN_MS ? 'go' : null;

	}

	teardown() {

		if ( ! this.race ) return;
		this.game.opponents.clear();
		this.game.lapTimer.onLap = this.previousOnLap;
		this.game.lapTimer.resetForSolo();
		this.game.setHold( false );
		this.race = null;
		this.drivers.clear();
		this.lapStart.clear();

	}

	changed( now ) {

		this.lastRender = now;
		this.onChange?.( this.view() );

	}

}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/*.test.mjs`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add js/race/CpuRace.js test/cpu-race.test.mjs
git commit -F - <<'MSG'
feat(cpu): race controller for CPU opponents

Grid, countdown, laps and results via the multiplayer race rules; CPU
trucks through a second Opponents; quit restores single-player timing.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

---

### Task 4: vs-CPU strings

**Files:**
- Modify: `js/ui/strings.js` (created by #1)
- Create: `test/cpu-strings.test.mjs`

**Interfaces:**
- Consumes: #1 `STRINGS`, `t( key, lang, vars )`.
- Produces: keys `cpu.button`, `cpu.title`, `cpu.opponents`, `cpu.difficulty`, `cpu.easy`, `cpu.medium`, `cpu.hard`, `cpu.quit`, `cpu.freeDrive`, `cpu.noLoop` in `en` and `de`. The panel also reuses #1's `mp.laps`, `mp.start`, `mp.close`, `mp.go`, `mp.you`, `mp.lapOf`, `mp.finished`, `mp.results`, `mp.time`, `mp.best`, `mp.dnf`, `mp.rematch`.

- [ ] **Step 1: Write the failing test**

Create `test/cpu-strings.test.mjs`:

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, t } from '../js/ui/strings.js';

const CPU_KEYS = [ 'cpu.button', 'cpu.title', 'cpu.opponents', 'cpu.difficulty', 'cpu.easy', 'cpu.medium', 'cpu.hard', 'cpu.quit', 'cpu.freeDrive', 'cpu.noLoop' ];

test( 'STRINGS_cpuKeys_existInBothLanguages', () => {

	for ( const key of CPU_KEYS ) {

		assert.ok( STRINGS.en[ key ], `en ${ key }` );
		assert.ok( STRINGS.de[ key ], `de ${ key }` );

	}

	assert.equal( t( 'cpu.button', 'de' ), 'Gegen CPU' );

} );
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/*.test.mjs`
Expected: FAIL — `en cpu.button`

- [ ] **Step 3: Add the strings**

In `js/ui/strings.js`, directly after the English `'mp.noFinish': …,` line add:

```js
		'cpu.button': 'vs CPU',
		'cpu.title': 'Race the CPU',
		'cpu.opponents': 'CPU trucks',
		'cpu.difficulty': 'Difficulty',
		'cpu.easy': 'Easy',
		'cpu.medium': 'Medium',
		'cpu.hard': 'Hard',
		'cpu.quit': 'Quit race',
		'cpu.freeDrive': 'Free driving',
		'cpu.noLoop': 'CPU trucks need one closed circuit with a finish line — pick another track.',
```

and directly after the German `'mp.noFinish': …,` line add:

```js
		'cpu.button': 'Gegen CPU',
		'cpu.title': 'Gegen den Computer fahren',
		'cpu.opponents': 'CPU-Trucks',
		'cpu.difficulty': 'Schwierigkeit',
		'cpu.easy': 'Leicht',
		'cpu.medium': 'Mittel',
		'cpu.hard': 'Schwer',
		'cpu.quit': 'Rennen beenden',
		'cpu.freeDrive': 'Freies Fahren',
		'cpu.noLoop': 'CPU-Trucks brauchen einen geschlossenen Rundkurs mit Ziellinie — wähl eine andere Strecke.',
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/*.test.mjs`
Expected: all pass, including #1's `strings` test (every key in both languages).

- [ ] **Step 5: Commit**

```bash
git add js/ui/strings.js test/cpu-strings.test.mjs
git commit -F - <<'MSG'
feat(cpu): German and English texts for vs CPU

Button, settings, quit and the no-circuit hint.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

---

### Task 5: vs-CPU panel

**Files:**
- Create: `js/ui/CpuPanel.js`
- Create: `test/harness/cpu.html`

**Interfaces:**
- Consumes: Task 3 `MAX_CPUS`, `YOU`, a `CpuRace` (`start`, `rematch`, `quit`, `view`); Task 4 strings; #1 `t`, `MAX_LAPS`; the `.corner-link` style from `index.html`; `window.GG_LANG` / `gg-langchange` from #1's `i18n.js`.
- Produces: `class CpuPanel { constructor(); bind( race, { isBusy } ); render( view, force = false ); toggle() }`; DOM ids `#cpu-button`, `#cpu-panel`, `#cpu-positions`, `#cpu-countdown`.

UI (mirrors #1's Lobby; wireframe):

```text
 ┌ Race the CPU ─────────────┐          ┌───────────────────────┐
 │ CPU trucks   [ 3      v ] │          │ P1 Turbo Toast · Lap 2/3 │
 │ Difficulty   [ Medium v ] │   race → │ P2 you · Lap 2/3       │  ← #cpu-positions
 │ Laps         [ 3      v ] │          │ P3 Drift Dachs · Lap 1/3 │
 │ (Start race) ( Close )    │          │ (Quit race)            │
 └───────────────────────────┘          └───────────────────────┘
 [Tracks] [Multiplayer] [vs CPU]         3 · 2 · 1 · GO!  ← #cpu-countdown
 results: # | name | Time | Best lap, (Rematch) (Free driving)
```

- [ ] **Step 1: Implement `js/ui/CpuPanel.js`**

Create `js/ui/CpuPanel.js`:

```js
// CpuPanel.js — "vs CPU" UI: settings panel, countdown, live positions, results. Renders CpuRace
// views and calls back into the race. Same look as the multiplayer Lobby; strings from strings.js.

import { t } from './strings.js';
import { MAX_LAPS } from '../net/Protocol.js';
import { MAX_CPUS, YOU } from '../race/CpuRace.js';

const STYLE = `
	#cpu-button { bottom: 12px; left: 236px; cursor: pointer; }
	#cpu-panel {
		position: absolute; bottom: 56px; left: 12px; width: 300px; padding: 14px 16px; box-sizing: border-box;
		background: rgba(255,255,255,0.95); border-radius: 14px; border: 1px solid rgba(0,0,0,0.06);
		box-shadow: 0 10px 30px rgba(0,0,0,0.25); font: 400 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		color: #1f2430; z-index: 21;
	}
	#cpu-panel[hidden], #cpu-positions[hidden], #cpu-countdown[hidden] { display: none; }
	#cpu-panel h2 { font-size: 15px; margin: 0 0 10px; }
	#cpu-panel label { display: block; margin: 10px 0 4px; color: #4a5260; }
	#cpu-panel select { width: 100%; box-sizing: border-box; font: inherit; padding: 6px 8px; border: 1px solid rgba(0,0,0,0.15); border-radius: 8px; background: #fff; }
	#cpu-panel button { font: inherit; padding: 7px 12px; margin: 10px 6px 0 0; border: none; border-radius: 999px; background: #eef0f3; color: #1f2430; cursor: pointer; }
	#cpu-panel button.primary { background: #1f2430; color: #fff; font-weight: 600; }
	#cpu-panel .muted { color: #6b7280; font-size: 12px; margin-top: 6px; }
	#cpu-panel table { width: 100%; border-collapse: collapse; margin-top: 6px; }
	#cpu-panel td, #cpu-panel th { text-align: left; padding: 4px 2px; font-variant-numeric: tabular-nums; }
	#cpu-positions {
		position: absolute; top: 150px; left: 12px; min-width: 160px; padding: 8px 12px; border-radius: 10px;
		background: rgba(0,0,0,0.5); color: #fff; font: 600 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; z-index: 10;
	}
	#cpu-positions .you { color: #f2c94c; }
	#cpu-positions button { margin-top: 6px; font: inherit; font-size: 11px; background: rgba(255,255,255,0.2); color: #fff; border: none; border-radius: 999px; padding: 3px 10px; cursor: pointer; }
	#cpu-countdown {
		position: absolute; top: 35%; left: 50%; transform: translate(-50%, -50%); color: #fff; pointer-events: none; z-index: 22;
		font: 800 120px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; text-shadow: 0 4px 20px rgba(0,0,0,0.5);
	}
	@media (max-width: 760px) { #cpu-panel { bottom: 100px; } }
`;

function el( tag, props = {}, ...children ) {

	const node = document.createElement( tag );
	for ( const [ k, v ] of Object.entries( props ) ) {

		if ( k === 'text' ) node.textContent = v;
		else if ( k === 'on' ) for ( const [ ev, fn ] of Object.entries( v ) ) node.addEventListener( ev, fn );
		else if ( v !== false && v !== null && v !== undefined ) node[ k ] = v;

	}

	for ( const c of children ) if ( c ) node.appendChild( c );
	return node;

}

function formatTime( seconds ) {

	if ( seconds === null || seconds === undefined ) return '—';
	const m = Math.floor( seconds / 60 );
	return `${ m }:${ ( seconds - m * 60 ).toFixed( 2 ).padStart( 5, '0' ) }`;

}

function select( options, value ) {

	const node = el( 'select' );
	for ( const [ v, label ] of options ) node.appendChild( el( 'option', { value: v, text: label, selected: v === value } ) );
	return node;

}

export class CpuPanel {

	constructor() {

		this.race = null;
		this.isBusy = () => false;
		this.open = false;
		this.view = { available: false, phase: null, settings: { cpus: 3, difficulty: 'medium', laps: 3 }, positions: [], results: null, countdown: null };
		this.structure = '';

		const style = document.createElement( 'style' );
		style.textContent = STYLE;
		document.head.appendChild( style );

		this.button = el( 'a', { id: 'cpu-button', className: 'corner-link', role: 'button', on: { click: ( e ) => { e.stopPropagation(); this.toggle(); } } } );
		this.panel = el( 'div', { id: 'cpu-panel', hidden: true } );
		this.positionsList = el( 'div' );
		this.quitButton = el( 'button', { on: { click: () => this.race.quit() } } );
		this.positionsEl = el( 'div', { id: 'cpu-positions', hidden: true }, this.positionsList, this.quitButton );
		this.countdownEl = el( 'div', { id: 'cpu-countdown', hidden: true } );
		document.body.append( this.button, this.panel, this.positionsEl, this.countdownEl );

		window.addEventListener( 'gg-langchange', () => this.render( this.view, true ) );

	}

	// isBusy(): true while another mode (multiplayer) owns the race — the panel then refuses to start.
	bind( race, { isBusy = () => false } = {} ) {

		this.race = race;
		this.isBusy = isBusy;
		this.render( race.view(), true );

	}

	toggle() {

		this.open = ! this.open;
		this.render( this.view, true );

	}

	get lang() {

		return window.GG_LANG ?? 'en';

	}

	render( view, force = false ) {

		this.view = view;
		if ( view.phase === 'countdown' || view.phase === 'racing' ) this.open = false;
		if ( view.phase === 'results' ) this.open = true;

		const key = JSON.stringify( [ this.open, this.lang, view.phase, view.available, view.results ] );
		if ( force || key !== this.structure ) {

			this.structure = key;
			this.button.textContent = t( 'cpu.button', this.lang );
			this.panel.hidden = ! this.open;
			this.panel.replaceChildren( ...( this.open ? this.panelContent( view ) : [] ) );

		}

		this.updateLive( view );

	}

	panelContent( view ) {

		const L = this.lang;
		if ( view.phase === 'results' ) return this.resultsPart( view );
		const parts = [ el( 'h2', { text: t( 'cpu.title', L ) } ) ];
		if ( ! view.available ) return [ ...parts, el( 'div', { className: 'muted', text: t( 'cpu.noLoop', L ) } ), this.closeButton() ];

		const s = view.settings;
		const cpus = select( Array.from( { length: MAX_CPUS }, ( _, i ) => [ i + 1, String( i + 1 ) ] ), s.cpus );
		const difficulty = select( [ 'easy', 'medium', 'hard' ].map( ( d ) => [ d, t( 'cpu.' + d, L ) ] ), s.difficulty );
		const laps = select( Array.from( { length: MAX_LAPS }, ( _, i ) => [ i + 1, String( i + 1 ) ] ), s.laps );
		const start = () => {

			if ( this.isBusy() ) return;
			this.race.start( { cpus: Number( cpus.value ), difficulty: difficulty.value, laps: Number( laps.value ) } );

		};

		parts.push(
			el( 'label', { text: t( 'cpu.opponents', L ) } ), cpus,
			el( 'label', { text: t( 'cpu.difficulty', L ) } ), difficulty,
			el( 'label', { text: t( 'mp.laps', L ) } ), laps,
			el( 'button', { className: 'primary', text: t( 'mp.start', L ), on: { click: start } } ),
			this.closeButton() );
		return parts;

	}

	resultsPart( view ) {

		const L = this.lang;
		const head = el( 'tr', {}, el( 'th', { text: '#' } ), el( 'th', { text: '' } ), el( 'th', { text: t( 'mp.time', L ) } ), el( 'th', { text: t( 'mp.best', L ) } ) );
		const rows = view.results.map( ( r ) => el( 'tr', {},
			el( 'td', { text: String( r.place ) } ),
			el( 'td', { text: r.id === YOU ? t( 'mp.you', L ) : r.name } ),
			el( 'td', { text: r.total === null ? t( 'mp.dnf', L ) : formatTime( r.total ) } ),
			el( 'td', { text: formatTime( r.best ) } ) ) );

		return [
			el( 'h2', { text: t( 'mp.results', L ) } ),
			el( 'table', {}, head, ...rows ),
			el( 'button', { className: 'primary', text: t( 'mp.rematch', L ), on: { click: () => this.race.rematch() } } ),
			el( 'button', { text: t( 'cpu.freeDrive', L ), on: { click: () => { this.open = false; this.race.quit(); } } } ),
		];

	}

	closeButton() {

		return el( 'button', { text: t( 'mp.close', this.lang ), on: { click: () => this.toggle() } } );

	}

	updateLive( view ) {

		const L = this.lang;
		this.countdownEl.hidden = ! view.countdown;
		if ( view.countdown ) this.countdownEl.textContent = view.countdown === 'go' ? t( 'mp.go', L ) : view.countdown;

		const racing = view.phase === 'countdown' || view.phase === 'racing';
		this.positionsEl.hidden = ! racing;
		if ( ! racing ) return;

		const rows = view.positions.map( ( p, i ) => el( 'div', {
			className: p.you ? 'you' : '',
			text: `P${ i + 1 } ${ p.you ? t( 'mp.you', L ) : p.name } · ${ p.finished ? t( 'mp.finished', L ) : t( 'mp.lapOf', L, { lap: p.lap, laps: view.laps } ) }`,
		} ) );
		this.positionsList.replaceChildren( ...rows );
		this.quitButton.textContent = t( 'cpu.quit', L );

	}

}
```

- [ ] **Step 2: Create the harness page**

Create `test/harness/cpu.html`:

```html
<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
	body { margin: 0; height: 100vh; background: #3a7; }
	.corner-link { position: absolute; background: #fff; padding: 9px 18px; border-radius: 999px; font: 13px sans-serif; }
</style></head><body>
<script type="module">
// Headless check of the vs-CPU flow with a fake game (no three.js, no physics): real CpuPanel UI and
// real CpuRace on the default circuit; the clock runs 20× faster so a 1-lap race ends in seconds.
import { CpuPanel } from '../../js/ui/CpuPanel.js';
import { CpuRace } from '../../js/race/CpuRace.js';

const trackCells = [
	[ - 3, - 3, 'track-corner', 16 ], [ - 2, - 3, 'track-straight', 22 ], [ - 1, - 3, 'track-straight', 22 ], [ 0, - 3, 'track-corner', 0 ],
	[ - 3, - 2, 'track-straight', 0 ], [ 0, - 2, 'track-straight', 0 ], [ - 3, - 1, 'track-corner', 10 ], [ - 2, - 1, 'track-corner', 0 ],
	[ 0, - 1, 'track-straight', 0 ], [ - 2, 0, 'track-straight', 10 ], [ 0, 0, 'track-finish', 0 ], [ - 2, 1, 'track-straight', 10 ],
	[ 0, 1, 'track-straight', 0 ], [ - 2, 2, 'track-corner', 10 ], [ - 1, 2, 'track-straight', 16 ], [ 0, 2, 'track-corner', 22 ],
];
const broken = new URLSearchParams( location.search ).has( 'broken' );

const lapTimer = {
	onLap: null, running: false,
	resetForRace() { this.running = false; }, startRace() { this.running = true; }, resetForSolo() { this.running = false; },
	progress() { return 0; },
};
const opponents = {
	trucks: new Map(),
	add( id, name ) { this.trucks.set( id, { name, states: 0 } ); }, clear() { this.trucks.clear(); },
	push( id ) { const t = this.trucks.get( id ); if ( t ) t.states ++; }, update() {},
};
const game = {
	trackCells: broken ? trackCells.slice( 1 ) : trackCells, cellSize: 9.99 * 0.75, lapTimer, opponents,
	placeOnSlot( slot ) { window.slot = slot; }, setHold( hold ) { window.hold = hold; },
};

const SPEEDUP = 20;
const t0 = performance.now();
const now = () => t0 + ( performance.now() - t0 ) * SPEEDUP;
const panel = new CpuPanel();
const race = new CpuRace( game, { onChange: ( view ) => panel.render( view ), now } );
panel.bind( race );
setInterval( () => race.update( SPEEDUP / 60 ), 16 );
Object.assign( window, { race, panel, game } );
window.ready = true;
</script></body></html>
```

- [ ] **Step 3: Headless check (Appendix `cpu`)**

Serve the repo root (e.g. `python3 -m http.server 8765`) and run the Appendix script with `PORT=8765`.
Expected output:
- `slot 2 hold True trucks cpu1,cpu2` and `countdown 3 panel hidden True`
- `positions P1 … · Lap 1/1 | P2 … | P3 you · Lap 1/1 | Quit race`
- `results` with two CPU rows with times, then `3	you	DNF	—`
- `rematch phase countdown {"cpus":2,"difficulty":"hard","laps":1}`
- `after quit None trucks 0 hold False`, `de button Gegen CPU`
- `broken Race the CPU | CPU trucks need one closed circuit with a finish line — pick another track. | Close`
- `errors []`

- [ ] **Step 4: Unit suite still green**

Run: `node --test test/*.test.mjs` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add js/ui/CpuPanel.js test/harness/cpu.html
git commit -F - <<'MSG'
feat(cpu): vs CPU panel, countdown, positions and results

Checked headless with a fake game and a sped-up clock.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

---

### Task 6: Wire it into the game

**Files:**
- Modify: `js/main.js` (the multiplayer block added by #1; the OSM surroundings plan also edits this file — anchor on the quoted lines, not on line numbers)
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: everything above; #1's `game`, `Opponents`, `Lobby`, `MultiplayerRace`, `scene`, `world`, `models`, `finishCell` in `main.js`.
- Produces: in the running game, a **vs CPU** button next to **Tracks** / **Multiplayer**.

- [ ] **Step 1: Imports**

In `js/main.js`, after `import { parseInviteHash } from './net/Signal.js';` add

```js
import { CpuRace } from './race/CpuRace.js';
import { CpuPanel } from './ui/CpuPanel.js';
```

- [ ] **Step 2: Create the CPU race next to multiplayer**

Replace

```js
	const lobby = new Lobby( { canRace: !! finishCell } );
	const multiplayer = new MultiplayerRace( game, { onChange: ( view ) => lobby.render( view ) } );
```

with

```js
	// CPU opponents (#4): same adapter as multiplayer, its own set of opponent trucks.
	const cpuPanel = new CpuPanel();
	const cpuRace = new CpuRace( { ...game, opponents: new Opponents( scene, world, models ) }, { onChange: ( view ) => cpuPanel.render( view ) } );

	const lobby = new Lobby( { canRace: !! finishCell } );
	const multiplayer = new MultiplayerRace( game, { onChange: ( view ) => {

		if ( view.role ) cpuRace.quit(); // creating or joining a multiplayer session ends a CPU race
		lobby.render( view );

	} } );
	cpuPanel.bind( cpuRace, { isBusy: () => !! multiplayer.view().role } );
```

- [ ] **Step 3: Update hook**

In `animate()`, replace

```js
		multiplayer.update( dt );
```

with

```js
		multiplayer.update( dt );
		cpuRace.update( dt );
```

- [ ] **Step 4: Verify**

Run: `node --test test/*.test.mjs && node --input-type=module --check < js/main.js`
Expected: all pass, no syntax errors. Re-run the Appendix check `cpu`.

- [ ] **Step 5: Changelog**

Under `## [Unreleased]` in `CHANGELOG.md` add (merge with an existing `### Added` if there is one):

```markdown
### Added

- Race against the computer: **vs CPU** puts up to three CPU trucks on the grid —
  pick easy, medium or hard and 1–10 laps. Works on every track that is one
  closed circuit. Available in German and English.
```

- [ ] **Step 6: Commit**

```bash
git add js/main.js CHANGELOG.md
git commit -F - <<'MSG'
feat(cpu): race CPU opponents in the game

vs CPU button next to Tracks and Multiplayer; CPU trucks share the grid,
countdown and results with multiplayer races.

Closes #4

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

- [ ] **Step 7: Manual play-test (headless Chromium cannot render the game here)**

Default track, then The Aerodrome: vs CPU → 3 CPU trucks, medium, 3 laps → Start. Check: CPUs line up in front of you, wait for GO, follow the road through every corner without cutting walls, you can bump into them (they shove you, you do not move them), positions update, results appear, Rematch and Free driving work, Quit race mid-race removes the trucks and the lap timer shows the stored best lap again, Multiplayer → Create race while a CPU race runs ends the CPU race. Try easy vs hard: easy should be beatable by a casual lap, hard clearly faster. If the speeds feel wrong, change only the `DIFFICULTY` table in `js/race/CpuDriver.js` and note the new values in the PR.

---

## Appendix: headless check runner (not committed)

### `cpu` — save as `cpu_check.py`, serve the repo root, run `PORT=<port> python3 cpu_check.py`

```python
# Headless check for test/harness/cpu.html. Serve the repo root first: python3 -m http.server 8765
from playwright.sync_api import sync_playwright

import os
BASE = f"http://localhost:{os.environ.get('PORT', '8765')}/test/harness/cpu.html"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE)
    page.wait_for_function('window.ready')
    assert page.inner_text('#cpu-button') == 'vs CPU'
    page.click('#cpu-button')
    page.select_option('#cpu-panel select >> nth=0', '2')
    page.select_option('#cpu-panel select >> nth=1', 'hard')
    page.select_option('#cpu-panel select >> nth=2', '1')
    page.click('#cpu-panel button.primary')
    print('slot', page.evaluate('window.slot'), 'hold', page.evaluate('window.hold'), 'trucks', page.evaluate('[...game.opponents.trucks.keys()].join()'))
    print('countdown', page.inner_text('#cpu-countdown'), 'panel hidden', page.is_hidden('#cpu-panel'))
    page.wait_for_function("window.hold === false", timeout=10000)
    print('positions', page.inner_text('#cpu-positions').replace('\n', ' | '))
    page.wait_for_selector('#cpu-panel table', timeout=60000)
    print('results', page.inner_text('#cpu-panel table').replace('\n', ' | '))
    page.click('#cpu-panel button.primary')
    print('rematch phase', page.evaluate('race.view().phase'), page.evaluate('JSON.stringify(race.view().settings)'))
    page.click('#cpu-positions button')
    print('after quit', page.evaluate('race.view().phase'), 'trucks', page.evaluate('game.opponents.trucks.size'), 'hold', page.evaluate('window.hold'))
    page.evaluate("window.ggSetLang = null; window.GG_LANG = 'de'; window.dispatchEvent(new CustomEvent('gg-langchange'))")
    print('de button', page.inner_text('#cpu-button'))
    b = browser.new_page()
    b.goto(BASE + '?broken')
    b.wait_for_function('window.ready')
    b.click('#cpu-button')
    print('broken', b.inner_text('#cpu-panel').replace('\n', ' | '))
    print('errors', errors)
    browser.close()
```
