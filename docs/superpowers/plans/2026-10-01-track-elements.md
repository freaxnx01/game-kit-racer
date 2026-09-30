# Track elements (ramps, tabletops, whoops, dirt) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three physical track pieces (ramp, tabletop, whoops) and a per-cell dirt surface, wire them through codec, rendering, physics, effects, editor and CPU trucks, and rebuild The Claypit as a real dirt track.

**Architecture:** A pure piece registry (`js/Pieces.js`) owns every piece and its height profile `h(t)`. Pure modules derive everything else from it: the codec (`js/TrackCodec.js`), the profile geometry (`js/ProfileGeometry.js`: deformed road mesh, collider grid, dirt patch) and the per-position terrain queries (`js/Terrain.js`: `surfaceAt`, `heightAt`, `normalAt`). three.js/crashcat code in `Track.js`, `Physics.js`, `Vehicle.js`, `main.js` and `editor.html` only turns those arrays and answers into meshes, bodies and behaviour.

**Tech Stack:** Vanilla ES modules, three.js r185 (CDN import map), crashcat 0.0.3 (`triangleMesh.create({ positions, indices })`), `node --test` for pure modules, Playwright (Python) for in-browser checks.

**Spec:** `docs/superpowers/specs/2026-10-01-track-elements-design.md`

## Global Constraints

- Buildless: no `package.json`, no bundler, no new dependencies; pure modules must not import `three` or `crashcat` (tests run them under plain Node).
- Every existing `?map=` string must decode to exactly the same cells as before (bits 4–7 of the type byte are 0 in all of them).
- Type byte layout: `bit 7 = dirt`, `bits 2–6 = type index`, `bits 0–1 = orientation`. Indices: 0 straight, 1 corner, 2 bump, 3 finish, 4 ramp, 5 tabletop, 6 whoops. Unknown index → `track-straight`.
- A dirt cell is `[ gx, gz, type, orient, { dirt: true } ]`; asphalt cells keep four fields.
- World units: `CELL_RAW = 9.99`, `GRID_SCALE = 0.75`, cell size `7.4925`. A piece's local origin sits at world y `-0.125` (track group y `-0.5` + `0.5 * 0.75`). Raw heights are multiplied by `GRID_SCALE` to get world heights.
- Grip: sphere `friction` 5.0 on asphalt (today's value), 1.5 on dirt; dirt top-speed factor 0.8 (tuning values, one constant each).
- Test names: `functionName_stateUnderTest_expectedBehavior`. Run the whole suite: `node --test test/*.test.mjs`.
- Style: tabs, spaces inside parens (`foo( a, b )`), blank line after `{` of function bodies, as the surrounding code.
- Playwright runs in the foreground, never `run_in_background`; commit before starting a browser check.
- Changelog entry is hand-written player prose under `[Unreleased]`; never run `git cliff -o`.
- Commits end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01WVkTufc2PiJjhhrWptUPLA
  ```

## Deviations from the spec (decided while planning)

- **Ramp profile**: the lip is at `t = 0.75` and the drop is over `t 0.75 → 0.8`; `t 0.8 → 1` is flat floor. A drop exactly at the cell edge would leave an open vertical face where the next piece starts; this keeps the mesh closed and the cliff still reads as a kicker.
- **Profile mesh**: instead of building a new road strip, the `track-straight` GLB geometry is sliced along z and its vertices lifted by the profile. Kerbs, markings and walls come along for free and match the kit exactly.
- **Finish cell never gets dirt** (editor Dirt tool skips it; The Claypit's finish stays asphalt): a dirt overlay would hide the finish line. Everything else can be dirt.
- **Debug hook**: `main.js` exposes `window.__racerDebug` only when the URL has `&debug`, for Playwright checks.

## Review Focus

1. **Old maps with the new decoder** — every preset in `Tracks.js` must decode byte-for-byte to the same cells; pinned in Task 2 (`decodeCells_everyPreset_matchesTheOldTwoBitDecoder`).
2. **Ramp facing against the driving direction** — a ramp placed backwards is a wall. The Claypit test asserts each ramp/tabletop faces the driving direction (Task 10); the editor keeps an element's direction when neighbours re-resolve (Task 8).
3. **A ramp right before a corner** — the truck lands in a wall. The Claypit test asserts the two cells after each ramp/tabletop are straights (Task 10).
4. **Positions exactly on a cell border or off the track** — `heightAt`/`surfaceAt` must not throw and return 0 / `'asphalt'` off-track; pinned in Task 3.
5. **Hand-edited links with an unknown type index** — decode to `track-straight`, not `undefined` (which would crash `placePiece`/`openSides`); pinned in Task 2.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `js/Pieces.js` | create | Piece registry, profiles, lookups. Pure. |
| `js/TrackCodec.js` | create | `encodeCells`/`decodeCells` (moved from `Track.js`), dirt bit. Pure. |
| `js/Terrain.js` | create | `makeTerrain( cells, cellSize )` → `surfaceAt`, `heightAt`, `normalAt`. Pure. |
| `js/ProfileGeometry.js` | create | Slice/deform triangle arrays, collider grid, dirt patch. Pure. |
| `js/Airtime.js` | create | Airborne test, landing impact, air pitch. Pure. |
| `js/SurfaceFx.js` | create | Per-surface effect rules: grip, speed, dust/smoke emission, skid shaping. Pure. |
| `js/Track.js` | modify | Re-export codec; render profile pieces and dirt overlays. |
| `js/Physics.js` | modify | Profile colliders, raised walls. |
| `js/Vehicle.js` | modify | Surface grip/speed, slope/air alignment, airborne state. |
| `js/Particles.js`, `js/DriftMarks.js`, `js/Audio.js` | modify | Dust, dirt marks, skid shaping. |
| `js/main.js` | modify | Model list from `PIECES`, terrain wiring, landing, debug hook. |
| `js/OsmTrack.js` | modify | Use `TrackCodec.encodeCells` instead of its copy. |
| `js/race/TrackPath.js` | modify | Open sides from `PIECES`. |
| `js/race/CpuDriver.js`, `js/race/CpuRace.js` | modify | Follow terrain height, slower on dirt. |
| `editor.html` | modify | Element + Dirt tools, profile/dirt preview, keep 5th field. |
| `tools/claypit-track.mjs` | create | Regenerates The Claypit map string. |
| `js/Tracks.js` | modify | New Claypit map. |
| `CHANGELOG.md` | modify | Player-facing entry. |

---

### Task 1: Piece registry and profiles

**Files:**
- Create: `js/Pieces.js`
- Test: `test/pieces.test.mjs`

**Interfaces:**
- Produces:
  - `PIECES: { [type: string]: { index: number, model?: string, profile?: (t:number)=>number, open: [[dx,dz],[dx,dz]] } }`
  - `TYPE_BY_INDEX: string[]` (index → type; holes are `undefined`)
  - `pieceModelNames(): string[]` — GLB names needed for track pieces (`['track-straight','track-corner','track-bump','track-finish']`)
  - `profileOf( type ): ((t)=>number) | null`
  - `profileMax( type ): number` — max raw height of a profile (0 for GLB pieces), sampled at 200 steps
  - `ELEMENT_CYCLE: string[]` = `[ 'track-straight', 'track-ramp', 'track-tabletop', 'track-whoops' ]`
  - `isStraightLike( type ): boolean` — open sides are the straight's

- [ ] **Step 1: Write the failing test**

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PIECES, TYPE_BY_INDEX, pieceModelNames, profileOf, profileMax, ELEMENT_CYCLE, isStraightLike } from '../js/Pieces.js';

const close = ( a, b, eps = 1e-9 ) => assert.ok( Math.abs( a - b ) < eps, `${ a } ≉ ${ b }` );

test( 'PIECES_indices_areUniqueAndKeepTheOldFour', () => {

	const indices = Object.values( PIECES ).map( ( p ) => p.index );
	assert.equal( new Set( indices ).size, indices.length );
	assert.deepEqual( TYPE_BY_INDEX.slice( 0, 7 ), [ 'track-straight', 'track-corner', 'track-bump', 'track-finish', 'track-ramp', 'track-tabletop', 'track-whoops' ] );
	for ( const p of Object.values( PIECES ) ) assert.ok( p.index >= 0 && p.index < 32 );

} );

test( 'PIECES_everyPiece_hasExactlyAModelOrAProfile', () => {

	for ( const [ type, p ] of Object.entries( PIECES ) ) assert.ok( !! p.model !== !! p.profile, type );
	assert.deepEqual( pieceModelNames(), [ 'track-straight', 'track-corner', 'track-bump', 'track-finish' ] );

} );

test( 'profileOf_ramp_risesToTheLipThenDropsToTheFloor', () => {

	const h = profileOf( 'track-ramp' );
	close( h( 0 ), 0 );
	assert.ok( h( 0.375 ) > 0 && h( 0.375 ) < h( 0.75 ) );
	assert.ok( h( 0.75 ) > 1 );
	close( h( 0.8 ), 0 );
	close( h( 1 ), 0 );

} );

test( 'profileOf_tabletop_hasAFlatPlateauAndEndsOnTheFloor', () => {

	const h = profileOf( 'track-tabletop' );
	close( h( 0 ), 0 );
	close( h( 0.4 ), h( 0.55 ) );
	assert.ok( h( 0.4 ) > 0.5 );
	close( h( 1 ), 0 );
	assert.ok( h( 0.9 ) < h( 0.7 ) ); // gentle landing slope

} );

test( 'profileOf_whoops_hasThreeHumpsAndStartsAndEndsFlat', () => {

	const h = profileOf( 'track-whoops' );
	close( h( 0 ), 0 );
	close( h( 1 ), 0 );
	let peaks = 0;
	for ( let i = 1; i < 199; i ++ ) if ( h( i / 200 ) > h( ( i - 1 ) / 200 ) && h( i / 200 ) >= h( ( i + 1 ) / 200 ) ) peaks ++;
	assert.equal( peaks, 3 );

} );

test( 'profileOf_glbPiece_isNull', () => {

	assert.equal( profileOf( 'track-straight' ), null );
	assert.equal( profileOf( 'nonsense' ), null );
	assert.equal( profileMax( 'track-corner' ), 0 );
	assert.ok( profileMax( 'track-ramp' ) > 1 );

} );

test( 'isStraightLike_newPieces_connectLikeStraights', () => {

	for ( const t of [ 'track-straight', 'track-bump', 'track-finish', 'track-ramp', 'track-tabletop', 'track-whoops' ] ) assert.equal( isStraightLike( t ), true, t );
	assert.equal( isStraightLike( 'track-corner' ), false );
	assert.deepEqual( ELEMENT_CYCLE, [ 'track-straight', 'track-ramp', 'track-tabletop', 'track-whoops' ] );

} );
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/pieces.test.mjs`
Expected: FAIL — `Cannot find module '…/js/Pieces.js'`.

- [ ] **Step 3: Implement `js/Pieces.js`**

```js
// Pieces.js — every track piece: how it is drawn (a Kenney GLB model, or a height profile applied to the
// straight piece) and through which sides it connects. The single list the codec, renderer, physics,
// driving line and editor derive from. Pure (no three.js).

// Open sides at orientation 0, as grid steps [ dx, dz ]. Straight-like pieces run along z;
// a corner joins -x and +z (checked against the default track in Track.js).
const STRAIGHT = [ [ 0, 1 ], [ 0, - 1 ] ];
const CORNER = [ [ - 1, 0 ], [ 0, 1 ] ];

// Heights in raw cell units (×GRID_SCALE in the world). t runs 0 → 1 along the piece's driving
// direction (+z at orientation 0). Tune the numbers after play-testing; tests pin only the shapes.
const RAMP_HEIGHT = 1.2;
const RAMP_LIP = 0.75;       // t of the lip
const RAMP_DROP_END = 0.8;   // t where the drop reaches the floor
const TABLE_HEIGHT = 0.9;
const WHOOP_HEIGHT = 0.35;
const WHOOP_COUNT = 3;

function ramp( t ) {

	if ( t <= RAMP_LIP ) return RAMP_HEIGHT * Math.max( 0, t ) / RAMP_LIP;
	if ( t < RAMP_DROP_END ) return RAMP_HEIGHT * ( RAMP_DROP_END - t ) / ( RAMP_DROP_END - RAMP_LIP );
	return 0;

}

// Up-slope 0–0.3, plateau 0.3–0.6, gentle landing slope 0.6–1.
function tabletop( t ) {

	if ( t <= 0 || t >= 1 ) return 0;
	if ( t < 0.3 ) return TABLE_HEIGHT * t / 0.3;
	if ( t <= 0.6 ) return TABLE_HEIGHT;
	return TABLE_HEIGHT * ( 1 - t ) / 0.4;

}

function whoops( t ) {

	if ( t <= 0 || t >= 1 ) return 0;
	return WHOOP_HEIGHT * Math.sin( Math.PI * WHOOP_COUNT * t ) ** 2;

}

export const PIECES = {
	'track-straight': { index: 0, model: 'track-straight', open: STRAIGHT },
	'track-corner': { index: 1, model: 'track-corner', open: CORNER },
	'track-bump': { index: 2, model: 'track-bump', open: STRAIGHT },
	'track-finish': { index: 3, model: 'track-finish', open: STRAIGHT },
	'track-ramp': { index: 4, profile: ramp, open: STRAIGHT },
	'track-tabletop': { index: 5, profile: tabletop, open: STRAIGHT },
	'track-whoops': { index: 6, profile: whoops, open: STRAIGHT },
};

export const TYPE_BY_INDEX = [];
for ( const [ type, piece ] of Object.entries( PIECES ) ) TYPE_BY_INDEX[ piece.index ] = type;

// Click order of the editor's Element tool on a straight cell.
export const ELEMENT_CYCLE = [ 'track-straight', 'track-ramp', 'track-tabletop', 'track-whoops' ];

export function pieceModelNames() {

	return Object.values( PIECES ).filter( ( p ) => p.model ).map( ( p ) => p.model );

}

export function profileOf( type ) {

	return PIECES[ type ]?.profile ?? null;

}

export function profileMax( type ) {

	const h = profileOf( type );
	if ( ! h ) return 0;
	let max = 0;
	for ( let i = 0; i <= 200; i ++ ) max = Math.max( max, h( i / 200 ) );
	return max;

}

export function isStraightLike( type ) {

	return PIECES[ type ]?.open === STRAIGHT;

}
```

Note: `whoops` uses `sin²`, which has exactly three maxima on (0,1) for `WHOOP_COUNT = 3` and is 0 with zero slope at both ends.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/pieces.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add js/Pieces.js test/pieces.test.mjs
git commit -m "feat(track): add piece registry with ramp, tabletop and whoops profiles"
```

---

### Task 2: Codec with new types and the dirt bit

**Files:**
- Create: `js/TrackCodec.js`
- Modify: `js/Track.js:338-379` (remove codec body, re-export), `js/Track.js:442-461` (move base64 helpers), `js/OsmTrack.js:683-705` (use shared encoder), `js/race/TrackPath.js:8-15` (open sides from `PIECES`)
- Test: `test/track-codec.test.mjs`; modify `test/tracks.test.mjs`, `test/track-path.test.mjs`, `test/probe-grid.test.mjs` to import `decodeCells` instead of their local 2-bit copies

**Interfaces:**
- Consumes: `PIECES`, `TYPE_BY_INDEX` (Task 1)
- Produces: `encodeCells( cells ): string`, `decodeCells( str ): cells`, `isDirt( cell ): boolean`, `TYPE_NAMES` (= `TYPE_BY_INDEX`, kept for existing importers). `Track.js` re-exports `encodeCells`, `decodeCells`, `TYPE_NAMES` so `main.js`/`editor.html` imports keep working.

- [ ] **Step 1: Write the failing test** — `test/track-codec.test.mjs`

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCells, decodeCells, isDirt } from '../js/TrackCodec.js';
import { encodeTrackCells } from '../js/OsmTrack.js';
import { PRESET_TRACKS } from '../js/Tracks.js';

// The decoder every preset was written for: 2-bit type, no dirt.
function oldDecode( str ) {

	const OLD = [ 'track-straight', 'track-corner', 'track-bump', 'track-finish' ];
	const bytes = Buffer.from( str.replace( /-/g, '+' ).replace( /_/g, '/' ), 'base64' );
	const cells = [];
	for ( let i = 0; i + 2 < bytes.length; i += 3 ) cells.push( [ bytes[ i ] - 128, bytes[ i + 1 ] - 128, OLD[ ( bytes[ i + 2 ] >> 2 ) & 3 ], [ 0, 16, 10, 22 ][ bytes[ i + 2 ] & 3 ] ] );
	return cells;

}

for ( const t of PRESET_TRACKS.filter( ( t ) => t.map && t.id !== 'claypit' ) ) {

	test( `decodeCells_preset_${ t.id }_matchesTheOldTwoBitDecoder`, () => {

		assert.deepEqual( decodeCells( t.map ), oldDecode( t.map ) );
		assert.equal( encodeCells( decodeCells( t.map ) ), t.map );

	} );

}

test( 'encodeCells_newTypesAndDirt_roundTrip', () => {

	const cells = [
		[ 0, 0, 'track-finish', 0 ],
		[ 0, 1, 'track-ramp', 10 ],
		[ 0, 2, 'track-tabletop', 16, { dirt: true } ],
		[ - 5, 3, 'track-whoops', 22, { dirt: true } ],
		[ 7, - 9, 'track-corner', 16, { dirt: true } ],
	];
	assert.deepEqual( decodeCells( encodeCells( cells ) ), cells );

} );

test( 'decodeCells_unknownTypeIndex_fallsBackToStraight', () => {

	const bytes = Buffer.from( [ 128, 128, ( 31 << 2 ) | 1 ] );
	const str = bytes.toString( 'base64' ).replace( /\+/g, '-' ).replace( /\//g, '_' ).replace( /=+$/, '' );
	assert.deepEqual( decodeCells( str ), [ [ 0, 0, 'track-straight', 16 ] ] );

} );

test( 'isDirt_fifthField_isTheOnlySource', () => {

	assert.equal( isDirt( [ 0, 0, 'track-straight', 0 ] ), false );
	assert.equal( isDirt( [ 0, 0, 'track-straight', 0, { dirt: true } ] ), true );

} );

test( 'encodeTrackCells_osm_matchesTheSharedEncoder', () => {

	const cells = [ [ 0, 0, 'track-finish', 0 ], [ 0, 1, 'track-straight', 0 ], [ 1, 1, 'track-corner', 22 ] ];
	assert.equal( encodeTrackCells( cells ), encodeCells( cells ) );

} );
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/track-codec.test.mjs`
Expected: FAIL — `Cannot find module '…/js/TrackCodec.js'`.

- [ ] **Step 3: Implement `js/TrackCodec.js`**

```js
// TrackCodec.js — ?map= strings ↔ track cells. Three bytes per cell: gx+128, gz+128, and
// dirt (bit 7) | type index (bits 2–6, see Pieces.js) | orientation (bits 0–1). Maps written before
// the new pieces only used bits 0–3, so they decode unchanged. Pure (no three.js).

import { PIECES, TYPE_BY_INDEX } from './Pieces.js';

const ORIENT_TO_GODOT = [ 0, 16, 10, 22 ];
const GODOT_TO_ORIENT = { 0: 0, 16: 1, 10: 2, 22: 3 };
const DIRT_BIT = 0x80;

export const TYPE_NAMES = TYPE_BY_INDEX;

export function isDirt( cell ) {

	return cell[ 4 ]?.dirt === true;

}

export function encodeCells( cells ) {

	const bytes = new Uint8Array( cells.length * 3 );

	for ( let i = 0; i < cells.length; i ++ ) {

		const [ gx, gz, name, godotOrient ] = cells[ i ];
		const ti = PIECES[ name ]?.index ?? 0;
		const oi = GODOT_TO_ORIENT[ godotOrient ] ?? 0;

		bytes[ i * 3 ] = gx + 128;
		bytes[ i * 3 + 1 ] = gz + 128;
		bytes[ i * 3 + 2 ] = ( isDirt( cells[ i ] ) ? DIRT_BIT : 0 ) | ( ti << 2 ) | oi;

	}

	return bytesToBase64url( bytes );

}

export function decodeCells( str ) {

	const bytes = base64urlToBytes( str );
	const cells = [];

	for ( let i = 0; i + 2 < bytes.length; i += 3 ) {

		const packed = bytes[ i + 2 ];
		const type = TYPE_BY_INDEX[ ( packed >> 2 ) & 0x1f ] ?? 'track-straight';
		const cell = [ bytes[ i ] - 128, bytes[ i + 1 ] - 128, type, ORIENT_TO_GODOT[ packed & 0x03 ] ];
		if ( packed & DIRT_BIT ) cell.push( { dirt: true } );
		cells.push( cell );

	}

	return cells;

}

function bytesToBase64url( bytes ) {

	let binary = '';
	for ( let i = 0; i < bytes.length; i ++ ) binary += String.fromCharCode( bytes[ i ] );

	return btoa( binary ).replace( /\+/g, '-' ).replace( /\//g, '_' ).replace( /=+$/, '' );

}

function base64urlToBytes( str ) {

	const base64 = str.replace( /-/g, '+' ).replace( /_/g, '/' );
	const binary = atob( base64 );
	const bytes = new Uint8Array( binary.length );
	for ( let i = 0; i < binary.length; i ++ ) bytes[ i ] = binary.charCodeAt( i );

	return bytes;

}
```

- [ ] **Step 4: Wire the existing modules to it**

`js/Track.js`: delete the `// ─── Track Codec` block (`TYPE_NAMES`, `TYPE_INDEX`, `ORIENT_TO_GODOT`, `GODOT_TO_ORIENT`, `encodeCells`, `decodeCells`) and the two base64 helpers at the end of the file, and add at the top:

```js
export { encodeCells, decodeCells, TYPE_NAMES } from './TrackCodec.js';
```

`js/OsmTrack.js`: replace the `// ── Codec (mirrors Track.js exactly…)` block's `TYPE_INDEX`/`GODOT_TO_ORIENT` and the body of `encodeTrackCells` with a delegation, keeping the exported name:

```js
import { encodeCells } from './TrackCodec.js';   // at the top with the other imports

// ── Codec: the shared TrackCodec (pure, no three.js) ──
export function encodeTrackCells( cells ) {

	return encodeCells( cells );

}
```

Check that nothing else in `OsmTrack.js` used the removed constants: `grep -n "TYPE_INDEX\|GODOT_TO_ORIENT" js/OsmTrack.js` must print nothing.

`js/race/TrackPath.js`: replace the `OPEN_SIDES` table with the registry:

```js
import { PIECES } from '../Pieces.js';
```

and in `openSides`:

```js
	const sides = PIECES[ type ]?.open;
```

(delete the `OPEN_SIDES` constant and its comment; keep the comment line about orientation 0 on `openSides`).

In `test/tracks.test.mjs`, `test/track-path.test.mjs`, `test/probe-grid.test.mjs`: delete the local `TYPE_NAMES`/`ORIENT_TO_GODOT`/`decode` helpers and the "(which needs three.js, so not imported here)" comment, import `{ decodeCells as decode } from '../js/TrackCodec.js'`. For `probe-grid.test.mjs` keep its local bounds helper if it has one (only the decoder moves).

- [ ] **Step 5: Run the whole suite**

Run: `node --test test/*.test.mjs`
Expected: all PASS, including the new `track-codec` tests.

- [ ] **Step 6: Browser smoke check** (codec is used by `main.js` and `editor.html`)

```bash
git add -A && git commit -m "feat(track): extend the map codec with new pieces and a dirt bit"
python3 -m http.server 8000 >/dev/null 2>&1 &
```

Then in the foreground (timeout 180000):

```python
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(); errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    for url in ["http://localhost:8000/index.html", "http://localhost:8000/editor.html"]:
        pg.goto(url); pg.wait_for_timeout(8000)
    print("errors:", errors); b.close()
```

Expected: `errors: []`. Stop the server afterwards (`kill %1`).

- [ ] **Step 7: Commit** (amend not needed if Step 6 was clean; otherwise fix and commit `fix(track): …`).

---

### Task 3: Terrain queries

**Files:**
- Create: `js/Terrain.js`
- Test: `test/terrain.test.mjs`

**Interfaces:**
- Consumes: `profileOf` (Task 1), `isDirt` (Task 2)
- Produces: `makeTerrain( cells, cellSize, gridScale )` → `{ surfaceAt( x, z ): 'dirt'|'asphalt', heightAt( x, z ): number /* world units above the floor */, normalAt( x, z ): [nx, ny, nz] /* unit */ }`; `localT( cell, x, z, cellSize ): number` (exported for tests and Physics).

- [ ] **Step 1: Write the failing test**

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTerrain, localT } from '../js/Terrain.js';
import { profileOf } from '../js/Pieces.js';

const CELL = 9.99 * 0.75, S = 0.75;
const close = ( a, b, eps = 1e-9 ) => assert.ok( Math.abs( a - b ) < eps, `${ a } ≉ ${ b }` );
const centre = ( g ) => ( g + 0.5 ) * CELL;

test( 'localT_eachOrientation_runsAlongThePieceForward', () => {

	// orientation 0 → forward +z; 16 (90°) → +x; 10 (180°) → -z; 22 (270°) → -x
	const cases = [ [ 0, [ 0, 1 ] ], [ 16, [ 1, 0 ] ], [ 10, [ 0, - 1 ] ], [ 22, [ - 1, 0 ] ] ];
	for ( const [ orient, [ fx, fz ] ] of cases ) {

		const cell = [ 2, - 3, 'track-ramp', orient ];
		close( localT( cell, centre( 2 ), centre( - 3 ), CELL ), 0.5 );
		close( localT( cell, centre( 2 ) + fx * CELL * 0.25, centre( - 3 ) + fz * CELL * 0.25, CELL ), 0.75 );

	}

} );

test( 'heightAt_rampCell_isTheScaledProfile', () => {

	const terrain = makeTerrain( [ [ 0, 0, 'track-ramp', 0 ] ], CELL, S );
	const h = profileOf( 'track-ramp' );
	close( terrain.heightAt( centre( 0 ), centre( 0 ) ), h( 0.5 ) * S );
	close( terrain.heightAt( centre( 0 ), centre( 0 ) + CELL * 0.25 ), h( 0.75 ) * S );

} );

test( 'heightAt_flatPiecesAndOffTrack_areZero', () => {

	const terrain = makeTerrain( [ [ 0, 0, 'track-straight', 0 ], [ 0, 1, 'track-corner', 0 ] ], CELL, S );
	assert.equal( terrain.heightAt( centre( 0 ), centre( 0 ) ), 0 );
	assert.equal( terrain.heightAt( centre( 0 ), centre( 1 ) ), 0 );
	assert.equal( terrain.heightAt( 1000, - 1000 ), 0 );

} );

test( 'surfaceAt_dirtFlag_andCellBorders', () => {

	const terrain = makeTerrain( [ [ 0, 0, 'track-straight', 0, { dirt: true } ], [ 1, 0, 'track-straight', 16 ] ], CELL, S );
	assert.equal( terrain.surfaceAt( centre( 0 ), centre( 0 ) ), 'dirt' );
	assert.equal( terrain.surfaceAt( centre( 1 ), centre( 0 ) ), 'asphalt' );
	assert.equal( terrain.surfaceAt( CELL, centre( 0 ) ), 'asphalt' );         // exactly on the border → cell 1
	assert.equal( terrain.surfaceAt( CELL - 1e-6, centre( 0 ) ), 'dirt' );
	assert.equal( terrain.surfaceAt( - 500, 500 ), 'asphalt' );

} );

test( 'normalAt_upSlopeOfARamp_tiltsBackAgainstTheDrivingDirection', () => {

	const terrain = makeTerrain( [ [ 0, 0, 'track-ramp', 0 ] ], CELL, S );
	const [ nx, ny, nz ] = terrain.normalAt( centre( 0 ), centre( 0 ) );
	close( Math.hypot( nx, ny, nz ), 1, 1e-6 );
	assert.ok( nz < 0 && ny > 0.9 );
	close( nx, 0, 1e-6 );
	assert.deepEqual( makeTerrain( [], CELL, S ).normalAt( 0, 0 ), [ 0, 1, 0 ] );

} );
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/terrain.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `js/Terrain.js`**

```js
// Terrain.js — what lies under a world position on a tile track: the surface ('dirt' | 'asphalt') and the
// height of the road above the flat floor (profile pieces: ramp, tabletop, whoops). Used by the vehicle
// (grip, slope, airtime), the CPU trucks and effects. Pure (no three.js).

import { profileOf } from './Pieces.js';
import { isDirt } from './TrackCodec.js';

const ORIENT_DEG = { 0: 0, 10: 180, 16: 90, 22: 270 }; // same table as Track.js
const NORMAL_STEP = 0.05; // world units for the finite-difference slope

// t (0 → 1) of a world point along the cell's driving direction. Local +z turns like three.js
// rotation.y: forward = ( sin θ, cos θ ).
export function localT( cell, x, z, cellSize ) {

	const a = ( ORIENT_DEG[ cell[ 3 ] ] ?? 0 ) * Math.PI / 180;
	const dx = x - ( cell[ 0 ] + 0.5 ) * cellSize;
	const dz = z - ( cell[ 1 ] + 0.5 ) * cellSize;
	return ( dx * Math.sin( a ) + dz * Math.cos( a ) ) / cellSize + 0.5;

}

export function makeTerrain( cells, cellSize, gridScale ) {

	const byKey = new Map( cells.map( ( c ) => [ c[ 0 ] + ',' + c[ 1 ], c ] ) );
	const cellAt = ( x, z ) => byKey.get( Math.floor( x / cellSize ) + ',' + Math.floor( z / cellSize ) );

	function surfaceAt( x, z ) {

		const cell = cellAt( x, z );
		return cell && isDirt( cell ) ? 'dirt' : 'asphalt';

	}

	function heightAt( x, z ) {

		const cell = cellAt( x, z );
		const h = cell && profileOf( cell[ 2 ] );
		if ( ! h ) return 0;
		const t = Math.min( 1, Math.max( 0, localT( cell, x, z, cellSize ) ) );
		return h( t ) * gridScale;

	}

	function normalAt( x, z ) {

		const sx = ( heightAt( x + NORMAL_STEP, z ) - heightAt( x - NORMAL_STEP, z ) ) / ( 2 * NORMAL_STEP );
		const sz = ( heightAt( x, z + NORMAL_STEP ) - heightAt( x, z - NORMAL_STEP ) ) / ( 2 * NORMAL_STEP );
		const len = Math.hypot( sx, 1, sz );
		return [ - sx / len + 0, 1 / len, - sz / len + 0 ]; // + 0 turns -0 into 0

	}

	return { surfaceAt, heightAt, normalAt };

}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/terrain.test.mjs` → PASS. Then `node --test test/*.test.mjs` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add js/Terrain.js test/terrain.test.mjs
git commit -m "feat(track): add terrain queries for surface, height and slope"
```

---

### Task 4: Profile geometry (pure arrays)

**Files:**
- Create: `js/ProfileGeometry.js`
- Test: `test/profile-geometry.test.mjs`

**Interfaces:**
- Consumes: nothing (profiles are passed in)
- Produces:
  - `sliceAlongZ( positions: Float32Array|number[], uvs: number[], cuts: number[] ): { positions: number[], uvs: number[] }` — non-indexed triangle soup (9 floats / 6 floats per triangle) split so no triangle crosses any `z = cut` plane.
  - `liftByProfile( positions: number[], profile, halfLength: number ): number[]` — adds `profile( z / ( 2·halfLength ) + 0.5 )` to every vertex's y (t clamped to 0..1).
  - `colliderGrid( profile, halfWidth, halfLength, steps ): { positions: number[], indices: number[] }` — local raw units, y = profile height, `( steps + 1 ) × 2` vertices, `steps × 2` triangles, CCW seen from above (+y).
  - `evenCuts( halfLength, steps ): number[]` — `steps - 1` interior z values.

- [ ] **Step 1: Write the failing test**

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sliceAlongZ, liftByProfile, colliderGrid, evenCuts } from '../js/ProfileGeometry.js';

const triangles = ( pos ) => pos.length / 9;
const area = ( pos ) => {

	let sum = 0;
	for ( let i = 0; i < pos.length; i += 9 ) {

		const ax = pos[ i + 3 ] - pos[ i ], az = pos[ i + 5 ] - pos[ i + 2 ];
		const bx = pos[ i + 6 ] - pos[ i ], bz = pos[ i + 8 ] - pos[ i + 2 ];
		sum += Math.abs( ax * bz - az * bx ) / 2;

	}

	return sum;

};

test( 'evenCuts_fourSteps_givesThreeInteriorPlanes', () => {

	assert.deepEqual( evenCuts( 5, 4 ), [ - 2.5, 0, 2.5 ] );

} );

test( 'sliceAlongZ_quadAcrossTheCell_keepsAreaAndCrossesNoPlane', () => {

	// A 10×10 quad on y = 0 as two triangles, uv = ( x, z ) / 10 + 0.5
	const P = [ - 5, 0, - 5, 5, 0, 5, 5, 0, - 5, - 5, 0, - 5, - 5, 0, 5, 5, 0, 5 ];
	const U = [ 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1 ];
	const cuts = evenCuts( 5, 4 );
	const out = sliceAlongZ( P, U, cuts );
	assert.ok( Math.abs( area( out.positions ) - 100 ) < 1e-9 );
	assert.equal( out.uvs.length / 6, triangles( out.positions ) );
	for ( let i = 0; i < out.positions.length; i += 9 ) {

		const zs = [ out.positions[ i + 2 ], out.positions[ i + 5 ], out.positions[ i + 8 ] ];
		for ( const c of cuts ) assert.ok( ! ( Math.min( ...zs ) < c - 1e-9 && Math.max( ...zs ) > c + 1e-9 ), `triangle crosses z=${ c }` );

	}

	// uv is interpolated linearly with position
	for ( let v = 0; v < out.positions.length / 3; v ++ ) {

		assert.ok( Math.abs( out.uvs[ v * 2 ] - ( out.positions[ v * 3 ] / 10 + 0.5 ) ) < 1e-9 );
		assert.ok( Math.abs( out.uvs[ v * 2 + 1 ] - ( out.positions[ v * 3 + 2 ] / 10 + 0.5 ) ) < 1e-9 );

	}

} );

test( 'sliceAlongZ_triangleOnOneSide_isUnchanged', () => {

	const P = [ 0, 0, 3, 1, 0, 4, 1, 0, 3 ];
	const U = [ 0, 0, 1, 1, 1, 0 ];
	assert.deepEqual( sliceAlongZ( P, U, [ 0 ] ), { positions: P, uvs: U } );

} );

test( 'liftByProfile_addsTheProfileHeightAtEachVertexZ', () => {

	const lifted = liftByProfile( [ 1, 0.5, - 5, 2, 0.75, 0, 3, 0, 5 ], ( t ) => t * 2, 5 );
	assert.deepEqual( lifted, [ 1, 0.5, - 5, 2, 1.75, 0, 3, 2, 5 ] );

} );

test( 'colliderGrid_followsTheProfileAndFacesUp', () => {

	const { positions, indices } = colliderGrid( ( t ) => t, 4, 5, 2 );
	assert.equal( positions.length, 3 * 2 * 3 );
	assert.equal( indices.length, 2 * 2 * 3 );
	// vertex rows at z = -5, 0, 5 with heights 0, 0.5, 1
	assert.deepEqual( [ positions[ 1 ], positions[ 7 ], positions[ 13 ] ], [ 0, 0.5, 1 ] );
	for ( let i = 0; i < indices.length; i += 3 ) {

		const [ a, b, c ] = [ indices[ i ], indices[ i + 1 ], indices[ i + 2 ] ].map( ( k ) => positions.slice( k * 3, k * 3 + 3 ) );
		const ux = b[ 0 ] - a[ 0 ], uy = b[ 1 ] - a[ 1 ], uz = b[ 2 ] - a[ 2 ];
		const vx = c[ 0 ] - a[ 0 ], vy = c[ 1 ] - a[ 1 ], vz = c[ 2 ] - a[ 2 ];
		assert.ok( uz * vx - ux * vz > 0, 'triangle must face up' ); // y of u × v

	}

} );
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/profile-geometry.test.mjs` → FAIL, module not found.

- [ ] **Step 3: Implement `js/ProfileGeometry.js`**

```js
// ProfileGeometry.js — turns a height profile into geometry: slices the straight piece's triangles into
// bands along z and lifts them by the profile (the visible ramp, tabletop, whoops), and builds the matching
// collider grid. All in the piece's local raw units (cell ±5). Pure (no three.js): arrays in, arrays out.

const EPS = 1e-9;

export function evenCuts( halfLength, steps ) {

	const cuts = [];
	for ( let i = 1; i < steps; i ++ ) cuts.push( - halfLength + ( 2 * halfLength * i ) / steps );
	return cuts;

}

// Splits every triangle at each z = cut plane it crosses. positions: 9 floats per triangle, uvs: 6.
export function sliceAlongZ( positions, uvs, cuts ) {

	let tris = [];
	for ( let i = 0; i < positions.length / 9; i ++ ) tris.push( triangleAt( positions, uvs, i ) );
	for ( const cut of cuts ) tris = tris.flatMap( ( tri ) => splitTriangle( tri, cut ) );

	const out = { positions: [], uvs: [] };
	for ( const tri of tris ) for ( const v of tri ) {

		out.positions.push( v.p[ 0 ], v.p[ 1 ], v.p[ 2 ] );
		out.uvs.push( v.uv[ 0 ], v.uv[ 1 ] );

	}

	return out;

}

function triangleAt( positions, uvs, i ) {

	const tri = [];
	for ( let k = 0; k < 3; k ++ ) {

		const p = i * 9 + k * 3, u = i * 6 + k * 2;
		tri.push( { p: [ positions[ p ], positions[ p + 1 ], positions[ p + 2 ] ], uv: [ uvs[ u ], uvs[ u + 1 ] ] } );

	}

	return tri;

}

// Clips one triangle against z = cut; returns the pieces on each side (1 if it does not cross).
// Keeps the vertex winding, so faces keep pointing the same way.
function splitTriangle( tri, cut ) {

	const side = tri.map( ( v ) => ( v.p[ 2 ] < cut - EPS ? - 1 : v.p[ 2 ] > cut + EPS ? 1 : 0 ) );
	if ( ! side.includes( - 1 ) || ! side.includes( 1 ) ) return [ tri ];

	return [ clipPolygon( tri, side, - 1, cut ), clipPolygon( tri, side, 1, cut ) ].flatMap( fan );

}

// Sutherland–Hodgman for one plane: the polygon part on side `keep`, with the cut points inserted.
function clipPolygon( tri, side, keep, cut ) {

	const poly = [];
	for ( let i = 0; i < 3; i ++ ) {

		const a = tri[ i ], b = tri[ ( i + 1 ) % 3 ];
		const sa = side[ i ], sb = side[ ( i + 1 ) % 3 ];
		if ( sa === keep || sa === 0 ) poly.push( a );
		if ( sa * sb === - 1 ) poly.push( lerpVertex( a, b, ( cut - a.p[ 2 ] ) / ( b.p[ 2 ] - a.p[ 2 ] ) ) );

	}

	return poly;

}

function fan( poly ) {

	const tris = [];
	for ( let i = 1; i + 1 < poly.length; i ++ ) tris.push( [ poly[ 0 ], poly[ i ], poly[ i + 1 ] ] );
	return tris;

}

function lerpVertex( a, b, k ) {

	return {
		p: a.p.map( ( x, i ) => x + ( b.p[ i ] - x ) * k ),
		uv: a.uv.map( ( x, i ) => x + ( b.uv[ i ] - x ) * k ),
	};

}

export function liftByProfile( positions, profile, halfLength ) {

	const out = positions.slice();
	for ( let i = 0; i < out.length; i += 3 ) {

		const t = Math.min( 1, Math.max( 0, out[ i + 2 ] / ( 2 * halfLength ) + 0.5 ) );
		out[ i + 1 ] += profile( t );

	}

	return out;

}

// Two vertices per row (x = ±halfWidth), steps + 1 rows from z = -halfLength to +halfLength.
export function colliderGrid( profile, halfWidth, halfLength, steps ) {

	const positions = [], indices = [];
	for ( let i = 0; i <= steps; i ++ ) {

		const t = i / steps, z = - halfLength + 2 * halfLength * t, y = profile( t );
		positions.push( - halfWidth, y, z, halfWidth, y, z );

	}

	for ( let i = 0; i < steps; i ++ ) {

		const l0 = 2 * i, r0 = l0 + 1, l1 = l0 + 2, r1 = l0 + 3;
		indices.push( l0, l1, r0, r0, l1, r1 );

	}

	return { positions, indices };

}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/profile-geometry.test.mjs` → PASS; `node --test test/*.test.mjs` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add js/ProfileGeometry.js test/profile-geometry.test.mjs
git commit -m "feat(track): add pure profile geometry for sliced road and collider grid"
```

---

### Task 5: Profile pieces in the game — rendering and physics

**Files:**
- Modify: `js/Track.js` (`placePiece`, new `profileModels`), `js/Physics.js` (colliders, raised walls), `js/main.js:93-97` (model list), `js/main.js` (debug hook), `editor.html:313` (model list)

**Interfaces:**
- Consumes: `PIECES`, `profileOf`, `profileMax`, `pieceModelNames` (Task 1); `sliceAlongZ`, `liftByProfile`, `colliderGrid`, `evenCuts` (Task 4)
- Produces: `addProfileModels( models )` in `Track.js` — adds a `THREE.Mesh` for every profile type to `models` (so `placePiece`, editor and preview need no branch); `buildWallColliders` handles profile pieces; `window.__racerDebug = { vehicle, sphereBody, world, terrain }` when `&debug` is in the URL (terrain added in Task 6).

- [ ] **Step 1: Build profile models in `js/Track.js`**

Add near the top of `js/Track.js`:

```js
import { PIECES, profileOf } from './Pieces.js';
import { sliceAlongZ, liftByProfile, evenCuts } from './ProfileGeometry.js';

const PROFILE_STEPS = 40; // bands along a profile piece; 40 keeps the ramp lip (5% of the cell) sharp
```

and a new exported function:

```js
// Profile pieces (ramp, tabletop, whoops) are the straight piece sliced into bands along z and lifted by
// their height profile — same kerbs, markings and walls, just not flat. Added to `models` like a GLB.
export function addProfileModels( models ) {

	const straight = models[ 'track-straight' ];
	if ( ! straight?.isMesh ) throw new Error( 'track-straight must load as a single mesh' );

	const flat = straight.geometry.toNonIndexed();
	const sliced = sliceAlongZ( flat.attributes.position.array, flat.attributes.uv.array, evenCuts( CELL_RAW / 2, PROFILE_STEPS ) );

	for ( const [ type, piece ] of Object.entries( PIECES ) ) {

		if ( ! piece.profile ) continue;
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( liftByProfile( sliced.positions, profileOf( type ), CELL_RAW / 2 ), 3 ) );
		geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( sliced.uvs, 2 ) );
		geometry.computeVertexNormals();
		models[ type ] = new THREE.Mesh( geometry, straight.material );

	}

}
```

Note: the straight GLB spans z ±5 while `CELL_RAW / 2 = 4.995`; `liftByProfile` clamps t, so the 0.005 overhang stays at the end heights (0 for all three profiles).

- [ ] **Step 2: Load them in `main.js` and `editor.html`**

`js/main.js`: import `pieceModelNames` from `./Pieces.js` and `addProfileModels` from `./Track.js`; build the list from the registry:

```js
const modelNames = [
	'vehicle-truck-yellow', 'vehicle-truck-green', 'vehicle-truck-purple', 'vehicle-truck-red',
	...pieceModelNames(),
	'decoration-empty', 'decoration-forest', 'decoration-tents',
];
```

and right after `await loadModels( … )` in `init()`:

```js
	addProfileModels( models );
```

`editor.html`: `import { pieceModelNames } from './js/Pieces.js';` and `addProfileModels` from `./js/Track.js`; `const modelNames = pieceModelNames();`. The editor stores `gltf.scene` (a Group) rather than the mesh, so hand `addProfileModels` the straight's mesh and copy the results back. After `await loadModels()`:

```js
	const profileModels = { 'track-straight': models[ 'track-straight' ].getObjectByProperty( 'isMesh', true ) };
	addProfileModels( profileModels );
	for ( const [ type, mesh ] of Object.entries( profileModels ) ) if ( type !== 'track-straight' ) models[ type ] = mesh;
```

- [ ] **Step 3: Colliders in `js/Physics.js`**

Add imports:

```js
import { rigidBody, box, sphere, triangleMesh, MotionType, MotionQuality } from 'crashcat';
import { profileOf, profileMax, isStraightLike } from './Pieces.js';
import { colliderGrid } from './ProfileGeometry.js';
```

Add a constant and helper above `buildWallColliders`:

```js
const COLLIDER_STEPS = 24;
const ROAD_HALF_WIDTH = 4.75; // raw; the wall line (WALL_X)

// Static triangle mesh of a profile piece's road, in world space (cell centre, orientation, grid scale,
// floor at y = -0.125 like the rendered piece).
function addProfileCollider( world, cell, S ) {

	const [ gx, gz, type, orient ] = cell;
	const { positions, indices } = colliderGrid( profileOf( type ), ROAD_HALF_WIDTH, CELL_RAW / 2, COLLIDER_STEPS );
	const rad = ( ORIENT_DEG[ orient ] ?? 0 ) * Math.PI / 180;
	const cr = Math.cos( rad ), sr = Math.sin( rad );
	const cx = ( gx + 0.5 ) * CELL_RAW * S, cz = ( gz + 0.5 ) * CELL_RAW * S;
	const worldPositions = [];

	for ( let i = 0; i < positions.length; i += 3 ) {

		const lx = positions[ i ], ly = positions[ i + 1 ], lz = positions[ i + 2 ];
		worldPositions.push( cx + ( lx * cr + lz * sr ) * S, - 0.125 + ly * S, cz + ( - lx * sr + lz * cr ) * S );

	}

	rigidBody.create( world, {
		shape: triangleMesh.create( { positions: worldPositions, indices } ),
		motionType: MotionType.STATIC,
		objectLayer: world._OL_STATIC,
		position: [ 0, 0, 0 ],
		friction: 5.0,
		restitution: 0.0,
	} );

}
```

In the loop of `buildWallColliders`, replace `if ( key === 'track-straight' || key === 'track-finish' ) {` with `if ( key !== 'track-corner' && isStraightLike( key ) ) {`, and inside that branch raise the walls by the profile's height:

```js
			const lift = profileMax( key ) * S;
			if ( lift > 0 ) addProfileCollider( world, cell, S );
```

(declare `cell` by changing the loop head to `for ( const cell of cells ) { const [ gx, gz, key, orient ] = cell;`), and use

```js
				const halfExtents = [ hThick, hHeight + lift / 2, hLen ];
				const position = [ wx, wallY + lift / 2, wz ];
```

in place of the existing two lines. The `if ( key === 'track-bump' ) continue;` stays (bump keeps no walls, as today).

Verify the default ground friction pairing is unchanged: the new collider uses friction 5.0 like the ground box in `main.js`.

- [ ] **Step 4: Debug hook in `js/main.js`**

After `const sphereBody = createSphereBody( … )` and the vehicle setup:

```js
	// Playwright checks (&debug only): the running vehicle and physics, never used by the game itself.
	if ( new URLSearchParams( window.location.search ).has( 'debug' ) ) window.__racerDebug = { vehicle, sphereBody, world };
```

- [ ] **Step 5: Run the suite, commit, then check in a browser**

Run: `node --test test/*.test.mjs` → all PASS.

```bash
git add js/Track.js js/Physics.js js/main.js editor.html
git commit -m "feat(track): render and collide ramp, tabletop and whoops pieces"
```

Build a test map in the foreground with Node and print it:

```bash
node --input-type=module -e '
import { encodeCells } from "./js/TrackCodec.js";
const cells = [ [0,0,"track-finish",0] ];
for ( let z = 1; z <= 7; z ++ ) cells.push( [ 0, z, z === 3 ? "track-ramp" : z === 5 ? "track-tabletop" : "track-straight", 0 ] );
console.log( encodeCells( cells ) );'
```

Start `python3 -m http.server 8000` in the background (the server only), then run in the foreground (timeout 240000) with `MAP` set to the printed string:

```python
import os
from playwright.sync_api import sync_playwright
MAP = os.environ["MAP"]
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(); errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.goto(f"http://localhost:8000/index.html?map={MAP}&debug")
    pg.wait_for_function("window.__racerDebug !== undefined", timeout=120000)
    pg.keyboard.down("ArrowUp")
    max_y = 0
    for _ in range(80):
        pg.wait_for_timeout(250)
        y = pg.evaluate("window.__racerDebug.vehicle.spherePos.y")
        max_y = max(max_y, y)
    print("errors:", errors, "max sphere y:", round(max_y, 2))
    b.close()
```

Expected: `errors: []`, `max sphere y` above `1.2` (flat driving is ~0.39; the ramp lip alone lifts the centre to ~1.29). The truck drives up the open track (a straight line; it will hit the far end, that is fine). If the headless renderer is too slow for the truck to reach the ramp in 20 s, raise the loop count rather than the timeout per step.

---

### Task 6: Vehicle on slopes and in the air, landing

**Files:**
- Create: `js/Airtime.js`
- Modify: `js/Vehicle.js` (alignment, airborne state), `js/main.js` (terrain, landing sound)
- Test: `test/airtime.test.mjs`

**Interfaces:**
- Consumes: `makeTerrain` (Task 3)
- Produces:
  - `REST_Y = 0.385` (sphere centre on flat floor: floor top -0.115 + radius 0.5)
  - `isAirborne( sphereY, groundHeight ): boolean` — more than `AIR_GAP = 0.15` above rest
  - `landingSpeed( wasAirborne, airborne, verticalSpeed ): number` — `|vy|` on the frame the truck lands, else 0
  - `airPitch( verticalSpeed, horizontalSpeed ): number` — radians, nose up positive, `0.5 · atan2( vy, h )` clamped to ±0.5
  - `Vehicle.terrain` (set by `main.js`), `Vehicle.airborne: boolean`, `Vehicle.landing: number` (speed of this frame's landing, 0 otherwise)

- [ ] **Step 1: Write the failing test**

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REST_Y, isAirborne, landingSpeed, airPitch } from '../js/Airtime.js';

test( 'isAirborne_onTheFloorOrARamp_isFalse', () => {

	assert.equal( isAirborne( REST_Y, 0 ), false );
	assert.equal( isAirborne( REST_Y + 0.9, 0.9 ), false );
	assert.equal( isAirborne( REST_Y + 0.1, 0 ), false );

} );

test( 'isAirborne_wellAboveTheGround_isTrue', () => {

	assert.equal( isAirborne( REST_Y + 0.5, 0 ), true );
	assert.equal( isAirborne( REST_Y + 1.2, 0.9 ), true );

} );

test( 'landingSpeed_onlyOnTheLandingFrame', () => {

	assert.equal( landingSpeed( true, false, - 4 ), 4 );
	assert.equal( landingSpeed( true, true, - 4 ), 0 );
	assert.equal( landingSpeed( false, false, - 4 ), 0 );

} );

test( 'airPitch_risingNoseUpFallingNoseDownClamped', () => {

	assert.ok( airPitch( 2, 10 ) > 0 );
	assert.ok( airPitch( - 2, 10 ) < 0 );
	assert.equal( airPitch( 0, 10 ), 0 );
	assert.equal( airPitch( - 100, 0.1 ), - 0.5 );

} );
```

- [ ] **Step 2: Run to verify it fails** — `node --test test/airtime.test.mjs` → FAIL, module not found.

- [ ] **Step 3: Implement `js/Airtime.js`**

```js
// Airtime.js — when the truck is in the air, when it lands, and how its nose points while flying.
// Pure (no three.js).

export const REST_Y = 0.385;   // sphere centre on the flat floor: floor top -0.115 + radius 0.5
const AIR_GAP = 0.15;          // units above rest before we call it flying (whoops bounce less than this)
const MAX_AIR_PITCH = 0.5;     // radians

export function isAirborne( sphereY, groundHeight ) {

	return sphereY - ( REST_Y + groundHeight ) > AIR_GAP;

}

export function landingSpeed( wasAirborne, airborne, verticalSpeed ) {

	return wasAirborne && ! airborne ? Math.abs( verticalSpeed ) : 0;

}

export function airPitch( verticalSpeed, horizontalSpeed ) {

	const pitch = 0.5 * Math.atan2( verticalSpeed, Math.max( horizontalSpeed, 1e-6 ) );
	return Math.min( MAX_AIR_PITCH, Math.max( - MAX_AIR_PITCH, pitch ) );

}
```

- [ ] **Step 4: Use it in `js/Vehicle.js`**

Import at the top: `import { isAirborne, landingSpeed, airPitch } from './Airtime.js';`, add a scratch vector `const _targetUp = new THREE.Vector3();`, and in the constructor:

```js
		this.terrain = null;     // makeTerrain() result, set by main.js; null = flat everywhere
		this.airborne = false;
		this.landing = 0;        // vertical speed of a landing this frame, 0 otherwise
```

Replace the block

```js
		_tmpVec.set( 0, 1, 0 ).applyQuaternion( this.container.quaternion );

		if ( _tmpVec.y > 0.5 ) {

			const targetQuat = this.alignWithY( this.container.quaternion, _up );
			this.container.quaternion.slerp( targetQuat, 0.2 );

		}
```

with

```js
		_tmpVec.set( 0, 1, 0 ).applyQuaternion( this.container.quaternion );

		if ( _tmpVec.y > 0.5 ) {

			const targetQuat = this.alignWithY( this.container.quaternion, this.targetUp() );
			this.container.quaternion.slerp( targetQuat, 0.2 );

		}
```

After `this.sphereVel.set( … )` inside `if ( this.rigidBody )`, update the air state:

```js
			this.updateAirState();
```

Add the methods:

```js
	// Up vector the truck leans towards: the road's slope on the ground, the flight path in the air.
	targetUp() {

		if ( ! this.terrain ) return _up;

		if ( ! this.airborne ) {

			const [ nx, ny, nz ] = this.terrain.normalAt( this.spherePos.x, this.spherePos.z );
			return _targetUp.set( nx, ny, nz );

		}

		const horizontal = Math.hypot( this.sphereVel.x, this.sphereVel.z );
		const pitch = airPitch( this.sphereVel.y, horizontal );
		_forward.set( 0, 0, 1 ).applyQuaternion( this.container.quaternion );
		_forward.y = 0;
		_forward.normalize();
		return _targetUp.copy( _up ).multiplyScalar( Math.cos( pitch ) ).addScaledVector( _forward, - Math.sin( pitch ) );

	}

	updateAirState() {

		const ground = this.terrain ? this.terrain.heightAt( this.spherePos.x, this.spherePos.z ) : 0;
		const airborne = isAirborne( this.spherePos.y, ground );
		this.landing = landingSpeed( this.airborne, airborne, this.sphereVel.y );
		this.airborne = airborne;

	}
```

Check the sign of the nose-up tilt in the browser (Step 6): rising off the lip, the nose must point up. If it points down, flip the sign of the `addScaledVector` factor — and fix the comment accordingly.

- [ ] **Step 5: Wire terrain and landing in `js/main.js`**

```js
import { makeTerrain } from './Terrain.js';
```

After `vehicle.physicsWorld = world;`:

```js
	const terrain = makeTerrain( customCells || TRACK_CELLS, CELL_RAW * GRID_SCALE, GRID_SCALE );
	vehicle.terrain = terrain;
```

Add `terrain` to the debug hook object. In `animate()`, after `vehicle.update( dt, input );`:

```js
		if ( vehicle.landing > 2 ) audio.playImpact( vehicle.landing );
```

(`playImpact` already scales with the speed it is given; 2 u/s filters whoops wobble.)

- [ ] **Step 6: Suite, commit, browser check**

Run `node --test test/*.test.mjs` → all PASS. Commit:

```bash
git add js/Airtime.js js/Vehicle.js js/main.js test/airtime.test.mjs
git commit -m "feat(vehicle): lean with the slope, pitch with the flight and sound the landing"
```

Re-run the Task 5 Playwright script, additionally sampling `window.__racerDebug.vehicle.airborne` each step and the container's up vector while airborne and rising:

```python
    up_y_while_rising = []
    # inside the loop:
    s = pg.evaluate("""(() => { const v = window.__racerDebug.vehicle;
        const e = v.container.matrixWorld.elements; // column 1 = up, column 2 = forward
        return { air: v.airborne, vy: v.sphereVel.y, noseY: e[9] }; })()""")
    if s["air"] and s["vy"] > 0.5: up_y_while_rising.append(s["noseY"])
    # after the loop:
    print("airborne samples:", len(up_y_while_rising), "nose up:", all(n > 0 for n in up_y_while_rising))
```

Expected: at least one airborne sample and `nose up: True`, `errors: []`.

---

### Task 7: Dirt — grip, speed, look and effects

**Files:**
- Create: `js/SurfaceFx.js`
- Modify: `js/ProfileGeometry.js` (+`dirtPatch`), `js/Track.js` (dirt overlays), `js/Vehicle.js` (grip, speed), `js/Particles.js`, `js/DriftMarks.js`, `js/Audio.js`, `js/main.js`
- Test: `test/surface-fx.test.mjs`, extend `test/profile-geometry.test.mjs`

**Interfaces:**
- Consumes: `makeTerrain` (Task 3), `profileOf` (Task 1), `isDirt` (Task 2)
- Produces:
  - `SurfaceFx.js`: `GRIP = { asphalt: 5.0, dirt: 1.5 }`, `SPEED_FACTOR = { asphalt: 1, dirt: 0.8 }`, `smokeEmits( surface, driftIntensity ): boolean`, `dustEmits( surface, driftIntensity, speed01 ): boolean`, `skidShape( surface ): { volume, pitch, tone }` (multipliers)
  - `ProfileGeometry.js`: `dirtPatch( shape: 'straight'|'corner', profile|null, steps ): { positions: number[], uvs: number[] }` — triangle soup in raw local units at `y = 0.02 + profile(t)`, uv = world-ish `( x, z ) / 4`
  - `Vehicle.surface: 'dirt'|'asphalt'`
  - `SmokeTrails( scene, { color } )` and `update( dt, vehicle, emit )`; `DriftMarks.update( dt, vehicle, surface )`; `GameAudio.update( dt, speed, throttle, driftIntensity, surface )`

- [ ] **Step 1: Failing tests**

`test/surface-fx.test.mjs`:

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRIP, SPEED_FACTOR, smokeEmits, dustEmits, skidShape } from '../js/SurfaceFx.js';

test( 'GRIP_dirt_isLooserThanAsphaltAndAsphaltIsUnchanged', () => {

	assert.equal( GRIP.asphalt, 5.0 );
	assert.ok( GRIP.dirt < GRIP.asphalt );
	assert.ok( SPEED_FACTOR.dirt < SPEED_FACTOR.asphalt );

} );

test( 'smokeEmits_onlyOnAsphaltWhenDrifting', () => {

	assert.equal( smokeEmits( 'asphalt', 0.8 ), true );
	assert.equal( smokeEmits( 'asphalt', 0.5 ), false );
	assert.equal( smokeEmits( 'dirt', 2 ), false );

} );

test( 'dustEmits_onDirtFromMediumSpeedOrWhenDrifting', () => {

	assert.equal( dustEmits( 'dirt', 0, 0.6 ), true );
	assert.equal( dustEmits( 'dirt', 0, 0.2 ), false );
	assert.equal( dustEmits( 'dirt', 0.8, 0.1 ), true );
	assert.equal( dustEmits( 'asphalt', 2, 1 ), false );

} );

test( 'skidShape_dirt_isQuieterAndLower', () => {

	assert.deepEqual( skidShape( 'asphalt' ), { volume: 1, pitch: 1, tone: 1 } );
	const d = skidShape( 'dirt' );
	assert.ok( d.volume < 1 && d.pitch < 1 && d.tone < 1 );

} );
```

Append to `test/profile-geometry.test.mjs`:

```js
import { dirtPatch } from '../js/ProfileGeometry.js';

test( 'dirtPatch_straight_coversTheRoadJustAboveIt', () => {

	const { positions, uvs } = dirtPatch( 'straight', null, 4 );
	assert.equal( uvs.length / 2, positions.length / 3 );
	const xs = [], ys = [];
	for ( let i = 0; i < positions.length; i += 3 ) { xs.push( positions[ i ] ); ys.push( positions[ i + 1 ] ); }
	assert.equal( Math.min( ...xs ), - 4.5 );
	assert.equal( Math.max( ...xs ), 4.5 );
	assert.ok( ys.every( ( y ) => Math.abs( y - 0.02 ) < 1e-9 ) );

} );

test( 'dirtPatch_withProfile_followsIt', () => {

	const { positions } = dirtPatch( 'straight', ( t ) => t, 4 );
	for ( let i = 0; i < positions.length; i += 3 ) assert.ok( Math.abs( positions[ i + 1 ] - ( 0.02 + positions[ i + 2 ] / 9.99 + 0.5 ) ) < 1e-6 );

} );

test( 'dirtPatch_corner_isAQuarterRingAroundTheArcCentre', () => {

	const { positions } = dirtPatch( 'corner', null, 8 );
	for ( let i = 0; i < positions.length; i += 3 ) {

		const r = Math.hypot( positions[ i ] + 4.995, positions[ i + 2 ] - 4.995 );
		assert.ok( r > 0.49 && r < 9.51, `r = ${ r }` );

	}

} );
```

Run: `node --test test/surface-fx.test.mjs test/profile-geometry.test.mjs` → FAIL (module / export missing).

- [ ] **Step 2: Implement `js/SurfaceFx.js`**

```js
// SurfaceFx.js — how each surface drives and looks: sphere grip, top-speed factor, which particles the wheels
// throw and how the skid sounds. Tuning values; change them here after play-testing. Pure.

export const GRIP = { asphalt: 5.0, dirt: 1.5 };
export const SPEED_FACTOR = { asphalt: 1, dirt: 0.8 };

const SMOKE_DRIFT = 0.7;       // today's smoke threshold (Particles.js)
const DUST_SPEED = 0.4;        // fraction of MAX_SPEED from which dirt throws dust without drifting
const DIRT_SKID = { volume: 0.6, pitch: 0.7, tone: 0.4 };
const ASPHALT_SKID = { volume: 1, pitch: 1, tone: 1 };

export function smokeEmits( surface, driftIntensity ) {

	return surface === 'asphalt' && driftIntensity > SMOKE_DRIFT;

}

export function dustEmits( surface, driftIntensity, speed01 ) {

	return surface === 'dirt' && ( driftIntensity > SMOKE_DRIFT || speed01 > DUST_SPEED );

}

export function skidShape( surface ) {

	return surface === 'dirt' ? { ...DIRT_SKID } : { ...ASPHALT_SKID };

}
```

- [ ] **Step 3: Implement `dirtPatch` in `js/ProfileGeometry.js`**

```js
const PATCH_Y = 0.02;          // raw units above the road, under the drift marks
const ROAD_HALF = 4.5;         // raw half-width of the asphalt on a straight (kerbs start outside)
const CELL_HALF = 4.995;
const RING_INNER = 0.5, RING_OUTER = 9.5; // corner asphalt around the arc centre ( -CELL_HALF, +CELL_HALF )

// Brown overlay for a dirt cell, as a triangle soup in the piece's local raw units. 'straight' covers
// every straight-like piece (lifted by its profile, if any); 'corner' is the quarter ring of a corner.
export function dirtPatch( shape, profile, steps ) {

	const quad = shape === 'corner' ? cornerQuad : straightQuad;
	const out = { positions: [], uvs: [] };

	for ( let i = 0; i < steps; i ++ ) {

		const a = quad( i / steps, 0, profile ), b = quad( i / steps, 1, profile );
		const c = quad( ( i + 1 ) / steps, 0, profile ), d = quad( ( i + 1 ) / steps, 1, profile );
		for ( const v of [ a, c, b, b, c, d ] ) {

			out.positions.push( v[ 0 ], v[ 1 ], v[ 2 ] );
			out.uvs.push( v[ 0 ] / 4, v[ 2 ] / 4 );

		}

	}

	return out;

}

function straightQuad( t, side, profile ) {

	return [ side ? ROAD_HALF : - ROAD_HALF, PATCH_Y + ( profile ? profile( t ) : 0 ), - CELL_HALF + 2 * CELL_HALF * t ];

}

// Quarter ring around the arc centre ( -CELL_HALF, +CELL_HALF ): from the +z edge (angle 0) to the
// -x edge (angle -90°), like Physics.js's arc walls.
function cornerQuad( t, side, profile ) {

	const angle = - t * Math.PI / 2, r = side ? RING_OUTER : RING_INNER;
	return [ - CELL_HALF + r * Math.cos( angle ), PATCH_Y, CELL_HALF + r * Math.sin( angle ) ];

}
```

(The `profile` argument is ignored for corners; they have none.) Run the two test files → PASS.

Check the triangle winding in the browser (Step 8): the patch must be visible from above. If a patch is invisible from above, it is back-facing — swap `b` and `c` in the `[ a, c, b, b, c, d ]` order (the dirt material is `FrontSide`).

- [ ] **Step 4: Dirt overlays in `js/Track.js`**

Extend the imports from Task 5 (`Pieces.js` gains `isStraightLike`, `ProfileGeometry.js` gains `dirtPatch`) and add `import { isDirt } from './TrackCodec.js';`, then:

```js
let dirtMaterial = null;

// Brown, speckled, generated once on a canvas — no new asset.
function getDirtMaterial() {

	if ( dirtMaterial ) return dirtMaterial;
	const canvas = document.createElement( 'canvas' );
	canvas.width = canvas.height = 64;
	const ctx = canvas.getContext( '2d' );
	ctx.fillStyle = '#8a6a45';
	ctx.fillRect( 0, 0, 64, 64 );
	for ( let i = 0; i < 400; i ++ ) {

		const shade = 90 + Math.floor( Math.random() * 70 );
		ctx.fillStyle = `rgb(${ shade + 40 },${ shade + 15 },${ shade - 20 })`;
		ctx.fillRect( Math.random() * 64, Math.random() * 64, 2, 2 );

	}

	const map = new THREE.CanvasTexture( canvas );
	map.wrapS = map.wrapT = THREE.RepeatWrapping;
	map.colorSpace = THREE.SRGBColorSpace;
	dirtMaterial = new THREE.MeshStandardMaterial( { map, roughness: 1, polygonOffset: true, polygonOffsetFactor: - 1, polygonOffsetUnits: - 1 } );
	return dirtMaterial;

}

// Dirt look for one cell: an overlay on the road, placed like the piece. Finish cells never get one.
export function dirtOverlay( cell ) {

	const [ gx, gz, type, orient ] = cell;
	if ( ! isDirt( cell ) || type === 'track-finish' ) return null;

	const shape = type === 'track-corner' ? 'corner' : 'straight';
	if ( shape === 'straight' && ! isStraightLike( type ) ) return null;
	const { positions, uvs } = dirtPatch( shape, profileOf( type ), 40 );
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( uvs, 2 ) );
	geometry.computeVertexNormals();

	const mesh = new THREE.Mesh( geometry, getDirtMaterial() );
	mesh.position.set( ( gx + 0.5 ) * CELL_RAW, 0.5, ( gz + 0.5 ) * CELL_RAW );
	mesh.rotation.y = THREE.MathUtils.degToRad( ORIENT_DEG[ orient ] ?? 0 );
	mesh.receiveShadow = true;
	return mesh;

}
```

In `buildTrack`, in the piece loop, iterate `for ( const cell of cells )` and after adding the piece:

```js
		const dirt = dirtOverlay( cell );
		if ( dirt ) trackPieceGroup.add( dirt );
```

(`track-bump` is straight-like and gets the straight patch, which is right: the bump cell is a straight road with a hump.)

- [ ] **Step 5: Grip and speed in `js/Vehicle.js`**

Import `{ GRIP, SPEED_FACTOR }` from `./SurfaceFx.js`. Constructor: `this.surface = 'asphalt';`. At the start of `update()`, before the input handling:

```js
		this.surface = this.terrain ? this.terrain.surfaceAt( this.spherePos.x, this.spherePos.z ) : 'asphalt';
		if ( this.rigidBody ) this.rigidBody.friction = GRIP[ this.surface ];
		const topSpeed = MAX_SPEED * SPEED_FACTOR[ this.surface ];
```

and replace the two uses of `MAX_SPEED` inside `update()` (touch auto-gas lerp and keyboard `targetSpeed * MAX_SPEED`) with `topSpeed`. (crashcat combines the two bodies' `friction` for every new contact, so assigning it takes effect on the next step.)

- [ ] **Step 6: Dust, marks and skid**

`js/Particles.js`: constructor `constructor( scene, { color = 0x5E5F6B } = {} )`, use `color` in the material; `update( dt, vehicle, emit )` — delete the `const shouldEmit = vehicle.driftIntensity > 0.7;` line and rename `shouldEmit` → `emit` in the method.

`js/DriftMarks.js`: `DriftTrail` constructor takes `( scene, material, width )`, stores `this.width = width`, and `_writeSegment` uses `this.width` instead of `WIDTH` (rename the constant to `ASPHALT_WIDTH = 0.08`, add `DIRT_WIDTH = 0.14`). In `DriftMarks`:

```js
		const dirtMaterial = material.clone();
		dirtMaterial.color.set( 0x3a2a18 );
		this.trails = [
			new DriftTrail( scene, material, ASPHALT_WIDTH ),
			new DriftTrail( scene, material, ASPHALT_WIDTH ),
			new DriftTrail( scene, dirtMaterial, DIRT_WIDTH ),
			new DriftTrail( scene, dirtMaterial, DIRT_WIDTH ),
		];
```

and `update( dt, vehicle, surface )`:

```js
	update( dt, vehicle, surface = 'asphalt' ) {

		const drifting = vehicle.driftIntensity > 0.5 && Math.abs( vehicle.linearSpeed ) > 0.15;
		const groundY = vehicle.container.position.y + Y_OFFSET;
		const intensity = vehicle.driftIntensity;
		const onDirt = surface === 'dirt';

		this.trackPair( 0, vehicle, groundY, intensity, drifting && ! onDirt );
		this.trackPair( 2, vehicle, groundY, intensity, drifting && onDirt );

	}

	trackPair( first, vehicle, groundY, intensity, emit ) {

		if ( ! emit && ! this.trails[ first ].active && ! this.trails[ first + 1 ].active ) return;
		this.trails[ first ].track( vehicle.wheelBL, groundY, intensity, emit );
		this.trails[ first + 1 ].track( vehicle.wheelBR, groundY, intensity, emit );

	}
```

Saved marks: `_load` already loops over `this.trails` and reads `data.t[ i ]`, so older saves (2 entries) load into the asphalt pair and the dirt pair starts empty; `_save` writes all four. `STORAGE_VERSION` stays 1.

`js/Audio.js`: import `{ skidShape }` from `./SurfaceFx.js`; `update( dt, speed, throttle, driftIntensity, surface = 'asphalt' )`; inside the skid block:

```js
			const shape = skidShape( surface );
```

then multiply: `this.skidSound.gain.gain.setTargetAtTime( skidVol * shape.volume, now, 0.05 );`, `const skidPitch = THREE.MathUtils.clamp( Math.abs( speed ), 1, 3 ) * shape.pitch;`, and `this.skidTone.frequency.setTargetAtTime( ( 2500 + intensity01 * 7500 ) * shape.tone, now, 0.1 );`.

- [ ] **Step 7: Wire in `js/main.js`**

```js
import { smokeEmits, dustEmits } from './SurfaceFx.js';
…
	const particles = new SmokeTrails( scene );
	const dust = new SmokeTrails( scene, { color: 0x9a7a55 } );
…
		const speed01 = Math.abs( vehicle.linearSpeed ) / MAX_SPEED;
		particles.update( dt, vehicle, smokeEmits( vehicle.surface, vehicle.driftIntensity ) );
		dust.update( dt, vehicle, ( dustEmits( vehicle.surface, vehicle.driftIntensity, speed01 ) && ! vehicle.airborne ) || vehicle.landing > 2 );
		driftMarks.update( dt, vehicle, vehicle.surface );
		audio.update( dt, vehicle.linearSpeed / MAX_SPEED, input.z, vehicle.driftIntensity, vehicle.surface );
```

(replacing the three existing `particles.update`, `driftMarks.update`, `audio.update` lines). The `vehicle.landing > 2` term is the landing dust burst from the spec.

- [ ] **Step 8: Suite, commit, browser check**

`node --test test/*.test.mjs` → all PASS.

```bash
git add js/SurfaceFx.js js/ProfileGeometry.js js/Track.js js/Vehicle.js js/Particles.js js/DriftMarks.js js/Audio.js js/main.js test/surface-fx.test.mjs test/profile-geometry.test.mjs
git commit -m "feat(track): add dirt surface with loose grip, dust and dirt marks"
```

Browser check (foreground): build a map like Task 5 but with cells z = 2..5 dirt (`[ 0, z, 'track-straight', 0, { dirt: true } ]`); drive forward with `&debug`; sample `vehicle.surface` and `sphereBody.friction` each step; take a screenshot `pg.screenshot( path=… )` into the scratchpad once the truck is on dirt and look at it.
Expected: samples include `('dirt', 1.5)` and `('asphalt', 5)`, the screenshot shows the brown overlay on the road (not missing, not z-fighting), `errors: []`.

---

### Task 8: Editor — Element and Dirt tools

**Files:**
- Modify: `editor.html` (toolbar buttons, `tool` values, `placeMesh`, `resolveCell`, `save`/`getCellsArray`/`loadSaved`, keyboard shortcuts)

**Interfaces:**
- Consumes: `ELEMENT_CYCLE`, `isStraightLike` (Task 1); `dirtOverlay` (Task 7); `encodeCells`/`decodeCells` with the 5th field (Task 2)
- Produces: editor cell state `{ type, orient, isFinish, element: string|null, dirt: boolean, mesh, dirtMesh }`

- [ ] **Step 1: Toolbar and tool switching**

Add two buttons after `btn-erase` (same markup pattern; icons: a ramp and a droplet-ish blob):

```html
		<button id="btn-element" title="Element: ramp / tabletop / whoops (4) — Shift+click flips direction" aria-label="Element">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20h20"/><path d="M4 20 16 10v10"/></svg>
		</button>
		<button id="btn-dirt" title="Dirt (5)" aria-label="Dirt">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="15" r="2"/><circle cx="15" cy="9" r="2"/><circle cx="17" cy="17" r="1.5"/><circle cx="9" cy="7" r="1"/></svg>
		</button>
```

`let tool = 'road'; // 'road', 'erase', 'pan', 'element', 'dirt'`. In `selectTool` toggle `active` on the two new buttons; register their click listeners; keyboard `'4'` → `element`, `'5'` → `dirt`.

- [ ] **Step 2: Cell state and rendering**

In `placeRoad`/`placeFinish`/`loadSaved` cell literals add `element: null, dirt: false, dirtMesh: null`. In `loadSaved` destructure the fifth field:

```js
			for ( const [ gx, gz, type, orient, extra ] of arr ) {

				const isFinish = ( type === 'track-finish' );
				const element = ELEMENT_CYCLE.includes( type ) && type !== 'track-straight' ? type : null;
				const cell = { type, orient, isFinish, element, dirt: extra?.dirt === true, mesh: null, dirtMesh: null };
```

`save()` and `getCellsArray()` both push through one helper (replace both loops' push line):

```js
	function toCellArray( gx, gz, cell ) {

		return cell.dirt ? [ gx, gz, cell.type, cell.orient, { dirt: true } ] : [ gx, gz, cell.type, cell.orient ];

	}
```

At the end of `placeMesh`, redraw the overlay:

```js
		if ( cell.dirtMesh ) trackGroup.remove( cell.dirtMesh );
		cell.dirtMesh = dirtOverlay( toCellArray( gx, gz, cell ) );
		if ( cell.dirtMesh ) trackGroup.add( cell.dirtMesh );
```

and in `eraseRoad`/`clearAll` remove `cell.dirtMesh` next to `cell.mesh`.

- [ ] **Step 3: Keep elements through auto-tiling**

In `resolveCell`, replace

```js
		const type = ( cell.isFinish && baseType === 'track-straight' ) ? 'track-finish' : baseType;
```

with

```js
		let type = baseType;
		if ( baseType === 'track-straight' && cell.isFinish ) type = 'track-finish';
		if ( baseType === 'track-straight' && cell.element ) type = cell.element;

		// A directional element keeps its direction while it stays on the same axis.
		if ( cell.element && type === cell.element && ( ORIENT_FLIP[ cell.orient ] === orient ) ) orient = cell.orient;
```

(`ORIENT_FLIP` maps 0↔10 and 16↔22 — the same axis, opposite direction.) If a neighbour turns the cell into a corner, `baseType` is `track-corner` and the element is dropped from `type` but kept in `cell.element`, so it comes back if the cell becomes straight again — acceptable and simple. `getCellExits` needs no change: it treats every non-corner as straight.

- [ ] **Step 4: The two tools**

In `handleDraw`, route the new tools (they act on existing cells; drag applies Dirt to each new cell, Element only on click):

```js
		if ( isErasing ) {

			eraseRoad( cell.gx, cell.gz );

		} else if ( isDrawing && tool === 'dirt' ) {

			toggleDirt( cell.gx, cell.gz );

		} else if ( isDrawing && tool === 'element' ) {

			cycleElement( cell.gx, cell.gz, shiftDown );

		} else if ( isDrawing ) {

			placeRoad( cell.gx, cell.gz );

		}
```

Track Shift: `let shiftDown = false;` set from `e.shiftKey` in the `pointerdown` handler before `handleDraw` is called. For Element, set `isDrawing = false` right after the call in `pointerdown`, so dragging does not cycle every cell passed over.

```js
	function toggleDirt( gx, gz ) {

		const cell = grid.get( cellKey( gx, gz ) );
		if ( ! cell || cell.isFinish ) return; // the finish line stays visible
		cell.dirt = ! cell.dirt;
		placeMesh( gx, gz, cell );
		save();

	}

	function cycleElement( gx, gz, flip ) {

		const cell = grid.get( cellKey( gx, gz ) );
		if ( ! cell || cell.isFinish || ! isStraightLike( cell.type ) || cell.type === 'track-bump' ) return;

		if ( flip ) {

			cell.orient = ORIENT_FLIP[ cell.orient ] ?? cell.orient;

		} else {

			const next = ELEMENT_CYCLE[ ( ELEMENT_CYCLE.indexOf( cell.type ) + 1 ) % ELEMENT_CYCLE.length ];
			cell.type = next;
			cell.element = next === 'track-straight' ? null : next;

		}

		placeMesh( gx, gz, cell );
		save();

	}
```

(`ELEMENT_CYCLE.indexOf` of a plain straight is 0, so the first click makes a ramp.) Imports at the top of the editor module: `ELEMENT_CYCLE, isStraightLike` from `./js/Pieces.js`, `dirtOverlay` from `./js/Track.js`.

- [ ] **Step 5: Commit and verify in a browser**

```bash
git add editor.html
git commit -m "feat(editor): add Element and Dirt tools for ramps, tabletops, whoops and dirt"
```

Foreground Playwright (timeout 180000): open `editor.html?map=<the Task 5 map>` and wait 8 s. Take a screenshot into the scratchpad and find the on-screen pixel centres of the finish cell (0,0) and of the straights (0,1) and (0,2) by looking at it (the editor is a top-down view). Press `4` and click (0,1); Shift+click (0,1); press `5` and click (0,2); click (0,0). After each step read `localStorage['racing-editor-cells']` with `pg.evaluate`, decode it in Node with `decodeCells`, and assert:
- after one Element click the clicked straight is `track-ramp`; after Shift+click its orientation flipped;
- after pressing `5` and clicking another straight, that cell has `{ dirt: true }`;
- clicking the finish with Dirt changes nothing;
- `errors: []`.

If clicking by pixel is unreliable, fall back to the manual check: open the editor yourself via `python3 -m http.server` and report what you did and saw — do not claim the editor works without one of the two.

---

### Task 9: CPU trucks follow the terrain

**Files:**
- Modify: `js/race/CpuDriver.js`, `js/race/CpuRace.js:174`, `js/main.js` (`game.terrain`)
- Test: `test/cpu-driver.test.mjs` (extend)

**Interfaces:**
- Consumes: `makeTerrain` (Task 3), `SPEED_FACTOR` (Task 7)
- Produces: `new CpuDriver( { path, start, lateral, difficulty, pace, terrain } )` — `terrain` optional (`null` = flat asphalt, today's behaviour); `game.terrain` in the adapter

- [ ] **Step 1: Failing tests** — append to `test/cpu-driver.test.mjs` (it already has `DEFAULT_TRACK`, `buildPath` and a cell size constant; reuse them — read the top of the file and use its names):

```js
test( 'state_onARamp_followsTheTerrainHeight', () => {

	const terrain = { surfaceAt: () => 'asphalt', heightAt: () => 0.7, normalAt: () => [ 0, 1, 0 ] };
	const driver = new CpuDriver( { path: buildPath( DEFAULT_TRACK, CELL ), start: 0, lateral: 0, difficulty: DIFFICULTY.medium, terrain } );
	assert.equal( driver.state().p[ 1 ], 0.5 + 0.7 );

} );

test( 'state_withoutTerrain_staysAtTheOldHeight', () => {

	const driver = new CpuDriver( { path: buildPath( DEFAULT_TRACK, CELL ), start: 0, lateral: 0, difficulty: DIFFICULTY.medium } );
	assert.equal( driver.state().p[ 1 ], 0.5 );

} );

test( 'targetSpeed_onDirt_isSlowerBySpeedFactor', () => {

	const dirt = { surfaceAt: () => 'dirt', heightAt: () => 0, normalAt: () => [ 0, 1, 0 ] };
	const path = buildPath( DEFAULT_TRACK, CELL );
	const onAsphalt = new CpuDriver( { path, start: 0, lateral: 0, difficulty: DIFFICULTY.medium } );
	const onDirt = new CpuDriver( { path, start: 0, lateral: 0, difficulty: DIFFICULTY.medium, terrain: dirt } );
	assert.equal( onDirt.targetSpeed(), onAsphalt.targetSpeed() * 0.8 );

} );
```

(`CELL`, `DEFAULT_TRACK`, `buildPath`, `CpuDriver` and `DIFFICULTY` already exist at the top of that file.)

Run: `node --test test/cpu-driver.test.mjs` → FAIL (height 0.5, speed not reduced).

- [ ] **Step 2: Implement**

`js/race/CpuDriver.js`:

```js
import { SPEED_FACTOR } from '../SurfaceFx.js';
```

constructor signature `{ path, start, lateral, difficulty, pace = 1, terrain = null }` and `this.terrain = terrain;`. In `targetSpeed()`:

```js
		const base = here || ahead ? this.cornerSpeed : this.topSpeed;
		if ( ! this.terrain ) return base;
		const { x, z } = samplePath( this.path, this.distance, this.lateral );
		return base * SPEED_FACTOR[ this.terrain.surfaceAt( x, z ) ];
```

In `state()`, compute the position first and add the height:

```js
		const x = centre.x + fz * this.lateral, z = centre.z - fx * this.lateral;
		const y = SPHERE_Y + ( this.terrain ? this.terrain.heightAt( x, z ) : 0 );
		return {
			p: [ x, y, z ],
```

Update the header comment: "…at a speed set by its difficulty and the surface, riding over ramps at the terrain's height (it does not really jump)…".

`js/race/CpuRace.js:174`: pass `terrain: this.game.terrain ?? null` into `new CpuDriver( … )`.

`js/main.js`: add `terrain,` to the `game` adapter object (the `terrain` from Task 6 is created before `game`; if not, move its creation above).

- [ ] **Step 3: Suite and commit**

`node --test test/*.test.mjs` → all PASS (including the untouched `cpu-race` tests, whose fake `game` has no `terrain`).

```bash
git add js/race/CpuDriver.js js/race/CpuRace.js js/main.js test/cpu-driver.test.mjs
git commit -m "feat(cpu): let CPU trucks ride over ramps and slow down on dirt"
```

- [ ] **Step 4: Ghost and multiplayer check (no code expected)**

Confirm by reading: `main.js` `updateGhost` records `c.position.toArray()` (includes y) and `localState()` sends `s.y`; `Opponents.js:114` applies `pose.p[ 1 ]`. Note the result in the task report; change nothing if confirmed.

---

### Task 10: The Claypit as a real dirt track, and the changelog

**Files:**
- Create: `tools/claypit-track.mjs`
- Modify: `js/Tracks.js:12` (claypit `map`), `test/tracks.test.mjs`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `decodeCells`, `encodeCells` (Task 2), `trackOrder`, `openSides` (TrackPath), `PIECES` (Task 1)

- [ ] **Step 1: Failing test** — append to `test/tracks.test.mjs`:

```js
import { trackOrder } from '../js/race/TrackPath.js';
import { isDirt } from '../js/TrackCodec.js'; // decode (decodeCells) is already imported since Task 2

const ORIENT_DEG = { 0: 0, 10: 180, 16: 90, 22: 270 };
const forwardOf = ( orient ) => {

	const a = ORIENT_DEG[ orient ] * Math.PI / 180;
	return [ Math.round( Math.sin( a ) ) + 0, Math.round( Math.cos( a ) ) + 0 ];

};

test( 'claypit_isDirtWithARampATabletopAndWhoopsFacingTheDrivingDirection', () => {

	const cells = decode( PRESET_TRACKS.find( ( t ) => t.id === 'claypit' ).map );
	const order = trackOrder( cells );
	assert.ok( order, 'claypit is one closed loop' );

	for ( const c of cells ) assert.equal( isDirt( c ), c[ 2 ] !== 'track-finish', `${ c[ 0 ] },${ c[ 1 ] } ${ c[ 2 ] }` );

	for ( const type of [ 'track-ramp', 'track-tabletop', 'track-whoops' ] ) {

		const i = order.findIndex( ( o ) => o.cell[ 2 ] === type );
		assert.ok( i >= 0, `${ type } missing` );
		assert.deepEqual( forwardOf( order[ i ].cell[ 3 ] ), order[ i ].to, `${ type } faces backwards` );
		for ( const k of [ 1, 2 ] ) assert.equal( order[ ( i + k ) % order.length ].cell[ 2 ], 'track-straight', `${ type } lands on a ${ order[ ( i + k ) % order.length ].cell[ 2 ] }` );

	}

} );
```

Also in the existing `… decodes to a single closed loop` test, the assertion `cells[ 0 ][ 2 ] === 'track-finish'` must still hold — keep the finish as the first cell when re-encoding.

Run: `node --test test/tracks.test.mjs` → FAIL (`track-ramp missing`).

- [ ] **Step 2: Write `tools/claypit-track.mjs`**

```js
// Regenerates The Claypit (js/Tracks.js) from its original layout: every cell dirt except the finish, and
// three jumps on the long straights — a ramp, a tabletop and whoops, each facing the driving direction.
// Run: node tools/claypit-track.mjs  → prints the new map string for js/Tracks.js.

import { decodeCells, encodeCells } from '../js/TrackCodec.js';
import { trackOrder } from '../js/race/TrackPath.js';

// The original Claypit map (before the jumps existed), from js/Tracks.js at commit 6952c8a.
const ORIGINAL = process.argv[ 2 ];
if ( ! ORIGINAL ) throw new Error( 'usage: node tools/claypit-track.mjs <original claypit map string>' );

// Positions in driving order (0 = finish). The first long straight runs 1–19, the second 38–58.
const JUMPS = { 6: 'track-ramp', 13: 'track-tabletop', 46: 'track-whoops' };
const GODOT_OF_STEP = { '0,1': 0, '1,0': 16, '0,-1': 10, '-1,0': 22 };

const cells = decodeCells( ORIGINAL );
const order = trackOrder( cells );
if ( ! order ) throw new Error( 'the original Claypit is not a closed loop' );

for ( const [ index, type ] of Object.entries( JUMPS ) ) {

	const { cell, to } = order[ index ];
	if ( cell[ 2 ] !== 'track-straight' ) throw new Error( `position ${ index } is a ${ cell[ 2 ] }, not a straight` );
	cell[ 2 ] = type;
	cell[ 3 ] = GODOT_OF_STEP[ to.join( ',' ) ];

}

for ( const cell of cells ) if ( cell[ 2 ] !== 'track-finish' ) cell[ 4 ] = { dirt: true };

console.log( encodeCells( cells ) );
```

- [ ] **Step 3: Generate and paste**

```bash
ORIG=$(git show 6952c8a:js/Tracks.js | grep "id: 'claypit'" | sed -E "s/.*map: '([^']+)'.*/\1/")
node tools/claypit-track.mjs "$ORIG"
```

Replace the claypit entry's `map:` value in `js/Tracks.js` with the printed string (desc and name unchanged). Add the tool to the header comment of `js/Tracks.js`: "The Claypit: tools/claypit-track.mjs."

- [ ] **Step 4: Run the suite**

`node --test test/*.test.mjs` → all PASS. If the landing check fails for an index, move that jump one or two positions earlier in `JUMPS` (both neighbours must be straights) and regenerate.

- [ ] **Step 5: Changelog** — under `## [Unreleased]` in `CHANGELOG.md`, in the file's existing section style (read the latest release section first and match its language and headings):

```markdown
### Added

- New track pieces: **ramp**, **tabletop** and **whoops** — with real jumps. Hit the ramp at speed and the truck flies; the whoops shake it about.
- Any piece can now be **dirt**: less grip, more sliding, lower top speed, brown dust and dirt tracks behind you.
- The editor has two new tools: **Element** (4) turns a straight into a ramp, tabletop or whoops — Shift+click flips its direction — and **Dirt** (5) paints dirt onto the road.

### Changed

- **The Claypit** is now a real dirt rallycross track with a ramp, a tabletop and whoops.
```

(If `[Unreleased]` already has `### Added`/`### Changed`, add the bullets there instead of new headings.)

- [ ] **Step 6: Commit, then the release gate in a browser**

```bash
git add tools/claypit-track.mjs js/Tracks.js test/tracks.test.mjs CHANGELOG.md
git commit -m "feat(tracks): make The Claypit a real dirt track with three jumps"
```

Foreground Playwright (timeout 300000), per the stack's manual checklist:
1. Every preset (`index.html` and each `trackHref`) loads with `errors: []`.
2. The Claypit with `&debug`: hold ArrowUp; within the samples the truck is `airborne` at least once and `vehicle.surface === 'dirt'` with `sphereBody.friction === 1.5`.
3. Start a CPU race on The Claypit (open the CPU panel, start with defaults — read `js/ui/CpuPanel.js` for the button selectors); after 20 s no errors, and CPU truck positions (from the minimap markers or `cpuRace` via the debug hook — add `cpuRace` to `window.__racerDebug` if needed) change over time.
4. Screenshot the ramp and the dirt from the chase camera into the scratchpad and look at both images.

Report the numbers and attach what you saw; the tuning (heights, grip, speed factor) is for the user's own play-test afterwards.

---

## Self-review notes

- Spec coverage: registry (T1), codec (T2), rendering (T5, T7), physics incl. raised walls (T5), air + landing sound + dust burst (T6, T7), dirt grip/speed/effects (T7), editor (T8), CPU (T9), ghost/multiplayer check (T9 Step 4), Claypit + other presets byte-identical (T2 test, T10), changelog (T10), Playwright gate (T5–T10).
- Out of scope held: no chicanes/wide corners/crossings, no damage/reset/airtime HUD, `track-bump` stays visual.
