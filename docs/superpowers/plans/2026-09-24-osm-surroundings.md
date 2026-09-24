# OSM Surroundings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make tracks generated from OpenStreetMap recognizable — real buildings and side streets around the track, a north-up minimap (every track, closes #2), the current street name, and a smoother default raster mode.

**Architecture:** `osm-track.html` adds `&osm=<s>,<w>,<n>,<e>,<mpc>,<offX>,<offZ>` to its links. The game (`main.js`) builds the track from `?map=` as today, and — only when `&osm=` parses — fetches the same Overpass data (shared `fetchOverpass` + `localStorage` cache in `OsmTrack.js`), places it on the grid with pure helpers in a new `OsmData.js`, and adds two merged meshes from a new `OsmScene.js`. A new three.js-free `OsmHud.js` draws the minimap for every track and the street name for OSM tracks.

**Tech Stack:** Plain ES modules, three.js 0.185.1 via the existing import map (`three`, `three/addons/`), Node's built-in `node:test` for unit tests, Playwright (not committed) for headless checks.

**Spec:** `docs/superpowers/specs/2026-09-24-osm-surroundings-design.md`

## Global Constraints

- Static files only — no bundler, no `package.json`, no committed `node_modules` (browser-game stack).
- `js/OsmTrack.js`, `js/OsmData.js`, `js/OsmHud.js` must not import `three`; only `js/OsmScene.js`, `js/Track.js`, `js/main.js` may.
- Code style = upstream mrdoob style: tabs, spaces inside parentheses/brackets `f( a, [ 1 ] )`, a blank line after every `{` that opens a multi-line block and before its `}`, `const`/`let` only, no commented-out code.
- Test names: `functionName_stateUnderTest_expectedBehavior`. Run the full suite with `node --test test/*.test.mjs` (a bare `node --test test/` does **not** work on Node 24 here).
- `&osm=` rejected when malformed or when the bbox spans more than **0.1°** in either axis; offsets must be integers within ±256; metres per cell within 1..100.
- Building budget: **20 000** triangles; heights `building:levels × 3 m`, default **2** levels; side streets **0.5 cell** wide.
- Surroundings only within the track bounds widened by **8 cells** (the chase camera sees ~7 cells; fog hides the rest).
- Best-lap and drift-mark storage stay keyed by the `?map=` value only; `&osm=` must not change them.
- Default track, presets (Tracks menu) and the editor must behave exactly as before, except that they now show the generic minimap.
- Commits: Conventional Commits, ending with the two trailer lines shown in each commit step.
- Serve locally with `npx serve -l 3000 .` (the repo's `serve.json` disables clean URLs) or `python3 -m http.server 3000`.

## Review Focus

1. **Links without `&osm=`** (Default track, Tracks-menu presets, old shared links) — generic minimap, no street pill, no Overpass request, no console errors. → Task 4 headless check `generic`.
2. **Overpass down or slow while playing an OSM link** — track stays playable, minimap keeps working, note "Surroundings unavailable". → Task 5 headless check `fail`.
3. **Phone-width screens** — minimap must not cover the lap timer; street pill must not cover the nav bar. → Task 4 headless check `hud` at 1000/420/360 px.
4. **Car standing still / heading vector (0, 0)** — minimap draws without NaN or exceptions. → Task 4 headless check `generic` calls `update( 0, 0, 0, 0 )`.
5. **Degenerate OSM building ways** (two corners, repeated corner, not closed, node missing from the response) — skipped, never extruded. → Task 3 test `osmFeatures_degenerateBuildingWays_areSkipped`.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `js/OsmTrack.js` | modify | Overpass query (+ buildings), shared `fetchOverpass`, roads-only graph, `auto` raster mode |
| `js/OsmData.js` | create | Pure: `&osm=` encode/parse, metres→world, feature extraction, clipping, building filter/budget, `StreetIndex` |
| `js/OsmHud.js` | create | Minimap (all tracks) + street-name pill + note line; DOM/canvas only |
| `js/OsmScene.js` | create | three.js: street ribbons, extruded buildings, `loadSurroundings()` |
| `js/Track.js` | modify | `buildTrack( …, { grassArea } )` — plain grass instead of forest/tents inside the OSM area |
| `js/main.js` | modify | Wire HUD for every track; parse `&osm=`, grass area, load surroundings |
| `osm-track.html` | modify | Use shared `fetchOverpass` (query incl. buildings), `Auto` default, `&osm=` in Play/Copy links |
| `tools/osm-fixture.mjs` | create | Regenerates the test fixture from Overpass |
| `test/fixtures/sisseln.json` | create | Trimmed Overpass response (roads + buildings, ~455 KB) |
| `test/osm-track.test.mjs` | create | Tests for `OsmTrack.js` changes |
| `test/osm-data.test.mjs` | create | Tests for `OsmData.js` |
| `test/harness/hud.html`, `test/harness/scene.html` | create | Static pages for headless (and manual) checks of HUD and meshes |
| `CHANGELOG.md`, `TODO.md` | modify | Player-facing entry; close the in-progress note |

---

### Task 1: Shared Overpass fetch, buildings in the query, roads-only graph, fixture

**Files:**
- Modify: `js/OsmTrack.js` (the `overpassQuery` block at the top; `buildGraph`)
- Create: `tools/osm-fixture.mjs`, `test/fixtures/sisseln.json`, `test/osm-track.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `overpassQuery( bbox, highways = DEFAULT_HIGHWAYS, { buildings = false } = {} ) → string`
  - `OVERPASS_MIRRORS: string[]`
  - `fetchOverpass( query, { storage, fetchImpl, timeoutMs, onTry } = {} ) → Promise<{ osm, source }>` — `source` is `'cache'` or the mirror host; `storage: null` disables caching; rejects with `"host: error · host: error …"`.
  - `buildGraph( osm, project )` now ignores ways without a `highway` tag.
  - `test/fixtures/sisseln.json` = `{ bbox: [ 47.5480, 7.9800, 47.5560, 7.9950 ], elements: [ … ] }`.

- [ ] **Step 1: Replace the query block and add the shared fetch**

In `js/OsmTrack.js`, replace this block (currently lines 14–20):

```js
// bbox = [south, west, north, east]
export function overpassQuery( bbox, highways = DEFAULT_HIGHWAYS ) {

	const [ s, w, n, e ] = bbox;
	return `[out:json][timeout:60];way["highway"~"^(${ highways })$"](${ s },${ w },${ n },${ e });out body;>;out skel qt;`;

}
```

with:

```js
// bbox = [south, west, north, east]. With { buildings: true } the query also returns building footprints.
export function overpassQuery( bbox, highways = DEFAULT_HIGHWAYS, { buildings = false } = {} ) {

	const [ s, w, n, e ] = bbox;
	const area = `(${ s },${ w },${ n },${ e })`;
	const houses = buildings ? `way["building"]${ area };` : '';
	return `[out:json][timeout:60];(way["highway"~"^(${ highways })$"]${ area };${ houses });out body;>;out skel qt;`;

}

// Tried in order. overpass.osm.ch only holds Switzerland but is rarely overloaded;
// the others are worldwide public mirrors.
export const OVERPASS_MIRRORS = [
	'https://overpass.osm.ch/api/interpreter',
	'https://overpass-api.de/api/interpreter',
	'https://overpass.kumi.systems/api/interpreter',
	'https://overpass.private.coffee/api/interpreter',
];

const CACHE_PREFIX = 'osm-track.cache.';

function defaultStorage() {

	try { return globalThis.localStorage ?? null; } catch { return null; }

}

// Same query → same data: answers are cached in storage (localStorage by default, null = no cache)
// so a flaky Overpass only has to answer once. onTry( host ) is called before each mirror.
// Resolves { osm, source }; rejects with every mirror's error when all fail.
export async function fetchOverpass( query, { storage = defaultStorage(), fetchImpl = globalThis.fetch, timeoutMs = 45000, onTry = () => {} } = {} ) {

	const key = CACHE_PREFIX + query;

	try {

		const cached = storage?.getItem( key );
		if ( cached ) return { osm: JSON.parse( cached ), source: 'cache' };

	} catch {}

	const errors = [];

	for ( const url of OVERPASS_MIRRORS ) {

		const host = new URL( url ).host;
		onTry( host );

		try {

			const controller = new AbortController();
			const timer = setTimeout( () => controller.abort(), timeoutMs );
			const res = await fetchImpl( url, { method: 'POST', body: 'data=' + encodeURIComponent( query ), signal: controller.signal } );
			clearTimeout( timer );
			if ( ! res.ok ) throw new Error( `HTTP ${ res.status }` );
			const osm = await res.json();
			if ( ! Array.isArray( osm.elements ) ) throw new Error( 'unexpected response' );
			if ( osm.elements.length === 0 ) throw new Error( 'no data for this area' );

			try { storage?.setItem( key, JSON.stringify( osm ) ); } catch {}

			return { osm, source: host };

		} catch ( e ) {

			errors.push( `${ host }: ${ e.name === 'AbortError' ? 'timeout' : e.message }` );

		}

	}

	throw new Error( errors.join( ' · ' ) );

}
```

- [ ] **Step 2: Make `buildGraph` roads-only**

In `buildGraph`, replace the line

```js
		if ( el.type !== 'way' || ! el.nodes ) continue;

		const pts = [];
```

with

```js
		if ( el.type !== 'way' || ! el.nodes || ! el.tags?.highway ) continue; // roads only — buildings share the response

		const pts = [];
```

- [ ] **Step 3: Create the fixture generator and generate the fixture**

Create `tools/osm-fixture.mjs`:

```js
// Regenerates test/fixtures/sisseln.json: roads + buildings around Sisseln's centre from Overpass,
// trimmed to the tags the tests use. Run: node tools/osm-fixture.mjs
import fs from 'node:fs';
import { overpassQuery, fetchOverpass } from '../js/OsmTrack.js';

export const FIXTURE_BBOX = [ 47.5480, 7.9800, 47.5560, 7.9950 ];
const KEEP_TAGS = [ 'highway', 'name', 'building', 'building:levels' ];

const { osm } = await fetchOverpass( overpassQuery( FIXTURE_BBOX, undefined, { buildings: true } ), { storage: null } );

const elements = osm.elements.map( ( el ) => el.type === 'node'
	? { type: 'node', id: el.id, lat: +el.lat.toFixed( 7 ), lon: +el.lon.toFixed( 7 ) }
	: { type: 'way', id: el.id, nodes: el.nodes, tags: Object.fromEntries( KEEP_TAGS.filter( ( k ) => el.tags?.[ k ] ).map( ( k ) => [ k, el.tags[ k ] ] ) ) } );

fs.mkdirSync( new URL( '../test/fixtures/', import.meta.url ), { recursive: true } );
fs.writeFileSync( new URL( '../test/fixtures/sisseln.json', import.meta.url ), JSON.stringify( { bbox: FIXTURE_BBOX, elements } ) );
console.log( `${ elements.length } elements written` );
```

Run: `node tools/osm-fixture.mjs`
Expected: `NNNN elements written` (≈5700) and `test/fixtures/sisseln.json` of roughly 450 KB. If Overpass is down, retry later — the fixture is committed once and not regenerated by tests.

- [ ] **Step 4: Write the tests**

Create `test/osm-track.test.mjs`:

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
	overpassQuery, fetchOverpass, OVERPASS_MIRRORS, buildGraph, makeProjection,
	perimeterLoop, simplifyPolyline, rasterizeLoop, loopToTrackCells, trackStats,
} from '../js/OsmTrack.js';

const fixture = JSON.parse( fs.readFileSync( new URL( './fixtures/sisseln.json', import.meta.url ) ) );

const memoryStorage = () => {

	const m = new Map();
	return { getItem: ( k ) => m.get( k ) ?? null, setItem: ( k, v ) => m.set( k, v ), size: () => m.size };

};

const okResponse = ( body ) => ( { ok: true, status: 200, json: async () => body } );

test( 'overpassQuery_withBuildings_addsBuildingWays', () => {

	assert.match( overpassQuery( [ 1, 2, 3, 4 ], 'residential', { buildings: true } ), /way\["building"\]\(1,2,3,4\);/ );
	assert.doesNotMatch( overpassQuery( [ 1, 2, 3, 4 ], 'residential' ), /building/ );

} );

test( 'buildGraph_responseWithBuildings_usesRoadsOnly', () => {

	const graph = buildGraph( fixture, makeProjection( fixture.bbox ) );
	const roadWays = fixture.elements.filter( ( el ) => el.type === 'way' && el.tags.highway ).length;
	assert.equal( graph.ways.length, roadWays );
	assert.ok( graph.ways.every( ( w ) => w.highway ) );

} );

test( 'fetchOverpass_cachedQuery_skipsNetwork', async () => {

	const storage = memoryStorage();
	storage.setItem( 'osm-track.cache.Q', JSON.stringify( { elements: [ 1 ] } ) );
	const fetchImpl = () => assert.fail( 'network used despite cache' );
	const { osm, source } = await fetchOverpass( 'Q', { storage, fetchImpl } );
	assert.deepEqual( osm, { elements: [ 1 ] } );
	assert.equal( source, 'cache' );

} );

test( 'fetchOverpass_firstMirrorDown_usesNextAndCaches', async () => {

	const storage = memoryStorage();
	const tried = [];
	const fetchImpl = async ( url ) => url === OVERPASS_MIRRORS[ 0 ] ? { ok: false, status: 504 } : okResponse( { elements: [ 1 ] } );
	const { source } = await fetchOverpass( 'Q', { storage, fetchImpl, onTry: ( h ) => tried.push( h ) } );
	assert.equal( source, new URL( OVERPASS_MIRRORS[ 1 ] ).host );
	assert.equal( tried.length, 2 );
	assert.equal( storage.size(), 1 );

} );

test( 'fetchOverpass_allMirrorsFail_rejectsWithEveryError', async () => {

	const fetchImpl = async () => ( { ok: false, status: 504 } );
	await assert.rejects( fetchOverpass( 'Q', { storage: null, fetchImpl } ), ( e ) => e.message.split( ' · ' ).length === OVERPASS_MIRRORS.length );

} );

test( 'fetchOverpass_emptyResult_isAnErrorNotCached', async () => {

	const storage = memoryStorage();
	const fetchImpl = async () => okResponse( { elements: [] } );
	await assert.rejects( fetchOverpass( 'Q', { storage, fetchImpl } ), /no data for this area/ );
	assert.equal( storage.size(), 0 );

} );
```

- [ ] **Step 5: Run the tests**

Run: `node --test test/*.test.mjs`
Expected: all pass (6 new + 5 existing preset tests). To see them fail first, temporarily revert Step 2 — `buildGraph_responseWithBuildings_usesRoadsOnly` must fail — then restore it.

- [ ] **Step 6: Commit**

```bash
git add js/OsmTrack.js tools/osm-fixture.mjs test/fixtures/sisseln.json test/osm-track.test.mjs
git commit -F - <<'MSG'
feat(osm): share Overpass fetch and include buildings in the query

fetchOverpass (mirrors, failover, cache) moves into OsmTrack.js so the game can
use it; buildGraph ignores non-road ways. Adds a trimmed Sisseln fixture.
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

---

### Task 2: `auto` raster mode

**Files:**
- Modify: `js/OsmTrack.js` (`rasterizeLoop` and the shortcut loop after it)
- Test: `test/osm-track.test.mjs` (append)

**Interfaces:**
- Consumes: `line4`, `lineL`, `cleanLoop` (existing, same file).
- Produces: `rasterizeLoop( pts, metresPerCell, mode )` accepts `mode = 'auto'`; return shape unchanged `{ cells, duplicates, shortcuts }`.

- [ ] **Step 1: Append the failing tests**

Append to `test/osm-track.test.mjs`:

```js
// Frames (half-size in metres) around the fixture centre that enclose real street blocks
const FRAMES = [ 120, 160, 200, 260 ];
const MPCS = [ 8, 10, 15 ];

function loopPoints( graph, half, mpc ) {

	const { ids, error } = perimeterLoop( graph, { x0: - half, y0: - half, x1: half, y1: half } );
	assert.equal( error, null );
	const pts = ids.map( ( id ) => graph.nodes.get( id ) );
	return simplifyPolyline( [ ...pts, pts[ 0 ] ], mpc ).slice( 0, - 1 );

}

const corners = ( cells ) => trackStats( loopToTrackCells( cells ), 1 ).corner;

test( 'rasterizeLoop_auto_neverWorseThanStairs', () => {

	const graph = buildGraph( fixture, makeProjection( fixture.bbox ) );

	for ( const half of FRAMES ) for ( const mpc of MPCS ) {

		const pts = loopPoints( graph, half, mpc );
		const auto = rasterizeLoop( pts, mpc, 'auto' );
		const stairs = rasterizeLoop( pts, mpc, 'stairs' );
		const label = `frame ±${ half } m, ${ mpc } m/cell`;

		assert.equal( auto.duplicates.size, 0, label );
		assert.ok( auto.shortcuts <= stairs.shortcuts, `${ label }: auto cut more than stairs` );
		assert.ok( corners( auto.cells ) <= corners( stairs.cells ), `${ label }: auto has more corners` );

	}

} );

test( 'rasterizeLoop_auto_cutsCornersSomewhere', () => {

	const graph = buildGraph( fixture, makeProjection( fixture.bbox ) );
	const pts = loopPoints( graph, 200, 10 );
	assert.ok( corners( rasterizeLoop( pts, 10, 'auto' ).cells ) < corners( rasterizeLoop( pts, 10, 'stairs' ).cells ) );

} );
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test test/*.test.mjs`
Expected: `rasterizeLoop_auto_cutsCornersSomewhere` FAILS (today an unknown mode falls back to stairs, so the corner counts are equal).

- [ ] **Step 3: Replace `rasterizeLoop`**

In `js/OsmTrack.js`, replace everything from the comment `// Closed polyline (metres, y = north) → closed list of 4-connected, self-consistent grid cells.` up to (not including) `// Remove consecutive duplicates and "spikes"` with:

```js
// Closed polyline (metres, y = north) → closed list of 4-connected, self-consistent grid cells.
// mode: 'stairs' (Bresenham, follows the street closely), 'L' (one corner per segment, drives better)
// or 'auto' (L per segment, stairs where L would run into the loop; whole-loop stairs if that still cuts more).
// Returns { cells: [[gx,gz],…], duplicates: Set<'gx,gz'>, shortcuts } — shortcuts counts places where
// the loop hit a cell twice and was cut short (a tile can't be driven twice); duplicates should be empty.
export function rasterizeLoop( pts, metersPerCell, mode = 'stairs' ) {

	const grid = pts.map( ( p ) => [ Math.round( p.x / metersPerCell ), Math.round( - p.y / metersPerCell ) ] );

	if ( mode === 'auto' ) {

		const auto = resolveLoop( traceGrid( grid, autoSegment ) );
		const stairs = resolveLoop( traceGrid( grid, () => line4 ) );
		return auto.shortcuts > stairs.shortcuts ? stairs : auto;

	}

	const draw = mode === 'L' ? lineL : line4;
	return resolveLoop( traceGrid( grid, () => draw ) );

}

// Picks the segment drawer for 'auto': one corner unless that path hits a cell already in the loop.
function autoSegment( a, b, used ) {

	const seg = lineL( a[ 0 ], a[ 1 ], b[ 0 ], b[ 1 ] );
	return seg.slice( 1, - 1 ).some( ( [ x, z ] ) => used.has( x + ',' + z ) ) ? line4 : lineL;

}

// Walk the closed grid polyline; pick( a, b, usedCells ) returns the line function for each segment.
function traceGrid( grid, pick ) {

	const cells = [];
	const used = new Set();

	for ( let i = 0; i < grid.length; i ++ ) {

		const a = grid[ i ], b = grid[ ( i + 1 ) % grid.length ];
		const seg = pick( a, b, used )( a[ 0 ], a[ 1 ], b[ 0 ], b[ 1 ] );

		for ( let j = 0; j < seg.length - 1; j ++ ) {

			cells.push( seg[ j ] );
			used.add( seg[ j ][ 0 ] + ',' + seg[ j ][ 1 ] );

		}

	}

	return cells;

}

// cleanLoop, then cut the loop wherever it touches itself (keeping the longer side) until no cell repeats.
function resolveLoop( raw ) {

	let cells = cleanLoop( raw );
	let shortcuts = 0;

	for ( ;; ) {

		const firstAt = new Map();
		let cut = null;

		for ( let i = 0; i < cells.length && ! cut; i ++ ) {

			const k = cells[ i ][ 0 ] + ',' + cells[ i ][ 1 ];
			if ( firstAt.has( k ) ) cut = [ firstAt.get( k ), i ];
			else firstAt.set( k, i );

		}

		if ( ! cut ) break;

		const [ i, j ] = cut;
		cells = j - i <= cells.length / 2
			? cells.slice( 0, i + 1 ).concat( cells.slice( j + 1 ) ) // drop the detour i+1..j
			: cells.slice( i, j ); // keep only the detour
		cells = cleanLoop( cells );
		shortcuts ++;

	}

	const seen = new Set(), duplicates = new Set();

	for ( const [ gx, gz ] of cells ) {

		const k = gx + ',' + gz;
		if ( seen.has( k ) ) duplicates.add( k );
		seen.add( k );

	}

	return { cells, duplicates, shortcuts };

}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/*.test.mjs`
Expected: all pass.

- [ ] **Step 5: Check the presets did not change**

Run: `node tools/aerodrome-tracks.mjs && git diff --stat js/Tracks.js`
Expected: no diff for `js/Tracks.js` (they use `'L'`, whose output must be identical).

- [ ] **Step 6: Commit**

```bash
git add js/OsmTrack.js test/osm-track.test.mjs
git commit -F - <<'MSG'
feat(osm): add auto raster mode

One corner per segment, staircase where that would run into the loop, and the
whole-loop staircase when auto would still have to cut more.
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

---

### Task 3: `OsmData.js` — placing OSM data on the grid

**Files:**
- Create: `js/OsmData.js`, `test/osm-data.test.mjs`

**Interfaces:**
- Consumes: `makeProjection`, and in tests `buildGraph`, `perimeterLoop`, `simplifyPolyline`, `rasterizeLoop( …, 'auto' )`, `loopCenter` from `js/OsmTrack.js`.
- Produces (all pure, world points are `[ x, z ]` arrays):
  - `encodeOsmParam( { bbox, mpc, offX, offZ } ) → string`
  - `parseOsmParam( string|null ) → { bbox, mpc, offX, offZ } | null`
  - `worldFromMeters( x, y, param, cellSize ) → [ x, z ]`
  - `cellOfWorld( wx, wz, cellSize ) → [ gx, gz ]`
  - `viewArea( cells, margin ) → { minX, maxX, minZ, maxZ }` (grid cells)
  - `osmFeatures( osm, param, cellSize ) → { streets: [{ id, name, pts }], buildings: [{ id, levels, ring }] }`
  - `clipStreets( streets, trackCells, area, cellSize ) → streets`
  - `buildingsOffTrack( buildings, trackCells, area, cellSize ) → buildings`
  - `buildingTriangles( building ) → number`
  - `budgetBuildings( buildings, trackCells, cellSize, maxTriangles ) → buildings`
  - `class StreetIndex { constructor( streets, cellSize ); nameAt( x, z ) → string | null }`
  - `trackCells` everywhere = Track.js cells (`[ gx, gz, … ]`); only indices 0 and 1 are read.

- [ ] **Step 1: Write the failing tests**

Create `test/osm-data.test.mjs`:

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildGraph, makeProjection, perimeterLoop, simplifyPolyline, rasterizeLoop, loopCenter } from '../js/OsmTrack.js';
import {
	encodeOsmParam, parseOsmParam, worldFromMeters, cellOfWorld, viewArea, osmFeatures,
	clipStreets, buildingsOffTrack, budgetBuildings, buildingTriangles, StreetIndex,
} from '../js/OsmData.js';

const CELL = 9.99 * 0.75; // CELL_RAW * GRID_SCALE in Track.js
const fixture = JSON.parse( fs.readFileSync( new URL( './fixtures/sisseln.json', import.meta.url ) ) );

// A real 10 m/cell loop around the fixture centre, placed like osm-track.html places it.
function sisselnTrack() {

	const project = makeProjection( fixture.bbox );
	const graph = buildGraph( fixture, project );
	const { ids } = perimeterLoop( graph, { x0: - 200, y0: - 200, x1: 200, y1: 200 } );
	const pts = ids.map( ( id ) => graph.nodes.get( id ) );
	const { cells } = rasterizeLoop( simplifyPolyline( [ ...pts, pts[ 0 ] ], 10 ).slice( 0, - 1 ), 10, 'auto' );
	const { offX, offZ } = loopCenter( cells );
	const param = { bbox: fixture.bbox, mpc: 10, offX, offZ };
	const track = cells.map( ( [ gx, gz ] ) => [ gx - offX, gz - offZ ] );
	return { param, track, area: viewArea( track, 8 ), features: osmFeatures( fixture, param, CELL ) };

}

test( 'parseOsmParam_encodedParam_roundTrips', () => {

	const p = { bbox: [ 47.548, 7.98, 47.556, 7.995 ], mpc: 10, offX: - 3, offZ: 12 };
	assert.deepEqual( parseOsmParam( encodeOsmParam( p ) ), p );

} );

test( 'parseOsmParam_malformedOrOversized_returnsNull', () => {

	for ( const bad of [
		null, '', 'abc', '1,2,3', '47.5,7.9,47.6,8.0,10,0', // missing / wrong arity
		'47.5,7.9,47.6,8.0,10,0,x', // not a number
		'47.6,7.9,47.5,8.0,10,0,0', // south > north
		'47.0,7.9,47.6,8.0,10,0,0', // 0.6° tall
		'47.5,7.9,47.6,8.0,0,0,0', // mpc 0
		'47.5,7.9,47.6,8.0,10,1.5,0', // fractional offset
		'47.5,7.9,47.6,8.0,10,999,0', // offset out of codec range
	] ) assert.equal( parseOsmParam( bad ), null, String( bad ) );

} );

test( 'worldFromMeters_anyPoint_landsInItsRasterCell', () => {

	const param = { bbox: fixture.bbox, mpc: 10, offX: 4, offZ: - 7 };
	for ( const [ x, y ] of [ [ 0, 0 ], [ 123.4, - 56.7 ], [ - 14.99, 5.01 ], [ 305, 199 ] ] ) {

		const [ wx, wz ] = worldFromMeters( x, y, param, CELL );
		assert.deepEqual( cellOfWorld( wx, wz, CELL ), [ Math.round( x / 10 ) - 4, Math.round( - y / 10 ) + 7 ] );

	}

} );

test( 'osmFeatures_fixture_splitsStreetsAndClosedBuildings', () => {

	const { features } = sisselnTrack();
	assert.ok( features.streets.length > 50 );
	assert.ok( features.buildings.length > 300 );
	assert.ok( features.buildings.every( ( b ) => b.ring.length >= 3 && b.levels >= 0 ) );
	assert.ok( features.streets.some( ( s ) => s.name === 'Hauptstrasse' ) );

} );

test( 'osmFeatures_degenerateBuildingWays_areSkipped', () => {

	const osm = { elements: [
		{ type: 'node', id: 1, lat: 47.55, lon: 7.99 },
		{ type: 'node', id: 2, lat: 47.5501, lon: 7.99 },
		{ type: 'node', id: 3, lat: 47.5501, lon: 7.9901 },
		{ type: 'way', id: 7, nodes: [ 1, 2, 1 ], tags: { building: 'yes' } }, // two corners
		{ type: 'way', id: 8, nodes: [ 1, 2, 2, 1 ], tags: { building: 'yes' } }, // repeated corner
		{ type: 'way', id: 9, nodes: [ 1, 2, 3 ], tags: { building: 'yes' } }, // not closed
		{ type: 'way', id: 10, nodes: [ 1, 2, 99, 1 ], tags: { building: 'yes' } }, // node missing from response
		{ type: 'way', id: 11, nodes: [ 1, 2, 3, 1 ], tags: { building: 'yes' } }, // fine
	] };
	const param = { bbox: fixture.bbox, mpc: 10, offX: 0, offZ: 0 };
	assert.deepEqual( osmFeatures( osm, param, CELL ).buildings.map( ( b ) => b.id ), [ 11 ] );

} );

test( 'clipStreets_realTrack_noRibbonOnATrackCell', () => {

	const { track, area, features } = sisselnTrack();
	const blocked = new Set( track.map( ( c ) => c.join( ',' ) ) );
	const clipped = clipStreets( features.streets, track, area, CELL );
	assert.ok( clipped.length > 0 );

	for ( const s of clipped ) {

		for ( let i = 0; i < s.pts.length - 1; i ++ ) {

			const mid = [ ( s.pts[ i ][ 0 ] + s.pts[ i + 1 ][ 0 ] ) / 2, ( s.pts[ i ][ 1 ] + s.pts[ i + 1 ][ 1 ] ) / 2 ];
			assert.ok( ! blocked.has( cellOfWorld( mid[ 0 ], mid[ 1 ], CELL ).join( ',' ) ) );

		}

	}

} );

test( 'buildingsOffTrack_realTrack_dropsOnlyBuildingsTouchingTiles', () => {

	const { track, area, features } = sisselnTrack();
	const kept = buildingsOffTrack( features.buildings, track, area, CELL );
	assert.ok( kept.length > 0 && kept.length < features.buildings.length );

	const blocked = new Set( track.map( ( c ) => c.join( ',' ) ) );
	for ( const b of kept ) for ( const [ x, z ] of b.ring ) assert.ok( ! blocked.has( cellOfWorld( x, z, CELL ).join( ',' ) ) );

} );

test( 'budgetBuildings_tightBudget_keepsNearestUnderLimit', () => {

	const track = [ [ 0, 0 ] ];
	const square = ( cx ) => ( { id: cx, levels: 0, ring: [ [ cx, 0 ], [ cx + 1, 0 ], [ cx + 1, 1 ], [ cx, 1 ] ] } );
	const buildings = [ square( 100 ), square( 10 ), square( 50 ) ];
	const kept = budgetBuildings( buildings, track, CELL, 2 * buildingTriangles( buildings[ 0 ] ) );
	assert.deepEqual( kept.map( ( b ) => b.id ), [ 10, 50 ] );

} );

test( 'StreetIndex_pointOnHauptstrasse_returnsItsName', () => {

	const { features } = sisselnTrack();
	const index = new StreetIndex( features.streets, CELL );
	const haupt = features.streets.find( ( s ) => s.name === 'Hauptstrasse' );
	const [ a, b ] = haupt.pts;
	assert.equal( index.nameAt( ( a[ 0 ] + b[ 0 ] ) / 2, ( a[ 1 ] + b[ 1 ] ) / 2 ), 'Hauptstrasse' );

} );

test( 'StreetIndex_farFromAnyStreet_returnsNull', () => {

	const index = new StreetIndex( [ { name: 'Only Road', pts: [ [ 0, 0 ], [ 10, 0 ] ] } ], CELL );
	assert.equal( index.nameAt( 5, 3 * CELL ), null );
	assert.equal( new StreetIndex( [], CELL ).nameAt( 0, 0 ), null );

} );
```

- [ ] **Step 2: Run to see them fail**

Run: `node --test test/*.test.mjs`
Expected: FAIL — `Cannot find module …/js/OsmData.js`.

- [ ] **Step 3: Implement**

Create `js/OsmData.js`:

```js
// OsmData.js — place OpenStreetMap data on the Track.js grid. Pure functions, no three.js.
//
// World: +X east, +Z south, one grid cell = cellSize world units (CELL_RAW * GRID_SCALE in Track.js).
// A link from osm-track.html carries &osm=<s>,<w>,<n>,<e>,<metresPerCell>,<offX>,<offZ>, the same
// numbers OsmTrack.js used to build the ?map= tiles, so OSM metres land exactly on those tiles.

import { makeProjection } from './OsmTrack.js';

const MAX_SPAN_DEG = 0.1;
const MAX_OFFSET = 256;

export function encodeOsmParam( { bbox, mpc, offX, offZ } ) {

	return [ ...bbox.map( ( v ) => + v.toFixed( 6 ) ), mpc, offX, offZ ].join( ',' );

}

// Returns { bbox, mpc, offX, offZ }, or null for anything malformed or implausibly large.
export function parseOsmParam( str ) {

	if ( typeof str !== 'string' ) return null;

	const v = str.split( ',' ).map( Number );
	if ( v.length !== 7 || v.some( ( n ) => ! Number.isFinite( n ) ) ) return null;

	const [ s, w, n, e, mpc, offX, offZ ] = v;
	if ( s < - 90 || n > 90 || w < - 180 || e > 180 ) return null;
	if ( ! ( s < n && w < e ) || n - s > MAX_SPAN_DEG || e - w > MAX_SPAN_DEG ) return null;
	if ( ! ( mpc >= 1 && mpc <= 100 ) ) return null;
	if ( ! Number.isInteger( offX ) || ! Number.isInteger( offZ ) ) return null;
	if ( Math.abs( offX ) > MAX_OFFSET || Math.abs( offZ ) > MAX_OFFSET ) return null;

	return { bbox: [ s, w, n, e ], mpc, offX, offZ };

}

// Metres (x east, y north, from makeProjection) → [x, z] world units. Mirrors rasterizeLoop's
// Math.round( x / mpc ) and loopToTrackCells' centring, plus half a cell to reach the cell centre.
export function worldFromMeters( x, y, param, cellSize ) {

	return [
		( x / param.mpc - param.offX + 0.5 ) * cellSize,
		( - y / param.mpc - param.offZ + 0.5 ) * cellSize,
	];

}

export function cellOfWorld( wx, wz, cellSize ) {

	return [ Math.floor( wx / cellSize ), Math.floor( wz / cellSize ) ];

}

// Grid rectangle around the track cells, widened by margin cells: { minX, maxX, minZ, maxZ }.
export function viewArea( cells, margin ) {

	let minX = Infinity, maxX = - Infinity, minZ = Infinity, maxZ = - Infinity;

	for ( const [ gx, gz ] of cells ) {

		minX = Math.min( minX, gx ); maxX = Math.max( maxX, gx );
		minZ = Math.min( minZ, gz ); maxZ = Math.max( maxZ, gz );

	}

	return { minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin };

}

function inArea( gx, gz, area ) {

	return gx >= area.minX && gx <= area.maxX && gz >= area.minZ && gz <= area.maxZ;

}

function cellKeys( cells ) {

	return new Set( cells.map( ( c ) => c[ 0 ] + ',' + c[ 1 ] ) );

}

// Overpass JSON → { streets: [{ id, name, pts }], buildings: [{ id, levels, ring }] }, points as [x, z] world units.
// levels is 0 when OSM has no building:levels tag.
export function osmFeatures( osm, param, cellSize ) {

	const project = makeProjection( param.bbox );
	const nodes = new Map();

	for ( const el of osm.elements ) {

		if ( el.type !== 'node' ) continue;
		const p = project( el.lat, el.lon );
		nodes.set( el.id, worldFromMeters( p.x, p.y, param, cellSize ) );

	}

	const streets = [], buildings = [];

	for ( const el of osm.elements ) {

		if ( el.type !== 'way' || ! el.nodes ) continue;

		const tags = el.tags ?? {};
		const pts = el.nodes.map( ( id ) => nodes.get( id ) ).filter( Boolean );

		if ( tags.highway && pts.length >= 2 ) {

			streets.push( { id: el.id, name: tags.name ?? '', pts } );

		} else if ( tags.building && isClosedRing( el.nodes ) && pts.length === el.nodes.length ) {

			buildings.push( { id: el.id, levels: Number.parseFloat( tags[ 'building:levels' ] ) || 0, ring: pts.slice( 0, - 1 ) } );

		}

	}

	return { streets, buildings };

}

// A closed way with at least three distinct corners (anything less extrudes to nothing).
function isClosedRing( ids ) {

	return ids.length >= 4 && ids[ 0 ] === ids[ ids.length - 1 ] && new Set( ids ).size >= 3;

}

// Street polylines cut into runs that stay inside the area and off track cells, so ribbons never
// cover tiles. Segments are checked in quarter-cell steps.
export function clipStreets( streets, trackCells, area, cellSize ) {

	const blocked = cellKeys( trackCells );
	const free = ( x, z ) => {

		const [ gx, gz ] = cellOfWorld( x, z, cellSize );
		return inArea( gx, gz, area ) && ! blocked.has( gx + ',' + gz );

	};

	const out = [];

	for ( const street of streets ) {

		let run = [];
		const flush = () => {

			if ( run.length >= 2 ) out.push( { id: street.id, name: street.name, pts: run } );
			run = [];

		};

		for ( let i = 0; i < street.pts.length - 1; i ++ ) {

			const [ ax, az ] = street.pts[ i ], [ bx, bz ] = street.pts[ i + 1 ];
			const steps = Math.max( 1, Math.ceil( Math.hypot( bx - ax, bz - az ) / ( cellSize / 4 ) ) );

			for ( let k = 0; k < steps; k ++ ) {

				const p0 = [ ax + ( bx - ax ) * k / steps, az + ( bz - az ) * k / steps ];
				const p1 = [ ax + ( bx - ax ) * ( k + 1 ) / steps, az + ( bz - az ) * ( k + 1 ) / steps ];

				if ( ! free( ( p0[ 0 ] + p1[ 0 ] ) / 2, ( p0[ 1 ] + p1[ 1 ] ) / 2 ) ) { flush(); continue; }
				if ( run.length === 0 ) run.push( p0 );
				run.push( p1 );

			}

		}

		flush();

	}

	return out;

}

// Buildings whose footprint bounding box lies inside the area and touches no track cell.
// (Bounding box, not polygon: a few buildings next to the road are dropped too — tiles sit up to
// half a cell off the real street anyway.)
export function buildingsOffTrack( buildings, trackCells, area, cellSize ) {

	const blocked = cellKeys( trackCells );

	return buildings.filter( ( b ) => {

		const xs = b.ring.map( ( p ) => p[ 0 ] ), zs = b.ring.map( ( p ) => p[ 1 ] );
		const [ gx0, gz0 ] = cellOfWorld( Math.min( ...xs ), Math.min( ...zs ), cellSize );
		const [ gx1, gz1 ] = cellOfWorld( Math.max( ...xs ), Math.max( ...zs ), cellSize );

		if ( ! inArea( gx0, gz0, area ) || ! inArea( gx1, gz1, area ) ) return false;

		for ( let gx = gx0; gx <= gx1; gx ++ ) {

			for ( let gz = gz0; gz <= gz1; gz ++ ) if ( blocked.has( gx + ',' + gz ) ) return false;

		}

		return true;

	} );

}

// Triangles of an extruded footprint with n corners: 2n walls + 2(n-2) caps.
export function buildingTriangles( building ) {

	return 4 * building.ring.length - 4;

}

// Keep the buildings nearest to the track until maxTriangles is reached.
export function budgetBuildings( buildings, trackCells, cellSize, maxTriangles ) {

	const centres = trackCells.map( ( [ gx, gz ] ) => [ ( gx + 0.5 ) * cellSize, ( gz + 0.5 ) * cellSize ] );
	const distance = ( b ) => {

		const cx = b.ring.reduce( ( s, p ) => s + p[ 0 ], 0 ) / b.ring.length;
		const cz = b.ring.reduce( ( s, p ) => s + p[ 1 ], 0 ) / b.ring.length;
		let d = Infinity;
		for ( const [ x, z ] of centres ) d = Math.min( d, ( x - cx ) ** 2 + ( z - cz ) ** 2 );
		return d;

	};

	const kept = [];
	let total = 0;

	for ( const [ , b ] of buildings.map( ( b ) => [ distance( b ), b ] ).sort( ( p, q ) => p[ 0 ] - q[ 0 ] ) ) {

		const t = buildingTriangles( b );
		if ( total + t > maxTriangles ) break;
		total += t;
		kept.push( b );

	}

	return kept;

}

function distanceToSegmentSq( px, pz, [ ax, az ], [ bx, bz ] ) {

	const dx = bx - ax, dz = bz - az;
	const len2 = dx * dx + dz * dz;
	const t = len2 === 0 ? 0 : Math.max( 0, Math.min( 1, ( ( px - ax ) * dx + ( pz - az ) * dz ) / len2 ) );
	return ( px - ax - t * dx ) ** 2 + ( pz - az - t * dz ) ** 2;

}

// Name of the nearest named street within one cell of a world position, via a grid of segment buckets.
export class StreetIndex {

	constructor( streets, cellSize ) {

		this.cellSize = cellSize;
		this.buckets = new Map();

		for ( const street of streets ) {

			if ( ! street.name ) continue;

			for ( let i = 0; i < street.pts.length - 1; i ++ ) {

				const a = street.pts[ i ], b = street.pts[ i + 1 ];
				const [ gx0, gz0 ] = cellOfWorld( Math.min( a[ 0 ], b[ 0 ] ), Math.min( a[ 1 ], b[ 1 ] ), cellSize );
				const [ gx1, gz1 ] = cellOfWorld( Math.max( a[ 0 ], b[ 0 ] ), Math.max( a[ 1 ], b[ 1 ] ), cellSize );

				for ( let gx = gx0; gx <= gx1; gx ++ ) {

					for ( let gz = gz0; gz <= gz1; gz ++ ) {

						const key = gx + ',' + gz;
						if ( ! this.buckets.has( key ) ) this.buckets.set( key, [] );
						this.buckets.get( key ).push( { name: street.name, a, b } );

					}

				}

			}

		}

	}

	// Returns the street name, or null when no named street is within one cell.
	nameAt( x, z ) {

		const [ gx, gz ] = cellOfWorld( x, z, this.cellSize );
		let best = null, bestD = this.cellSize ** 2;

		for ( let dx = - 1; dx <= 1; dx ++ ) {

			for ( let dz = - 1; dz <= 1; dz ++ ) {

				for ( const seg of this.buckets.get( ( gx + dx ) + ',' + ( gz + dz ) ) ?? [] ) {

					const d = distanceToSegmentSq( x, z, seg.a, seg.b );
					if ( d <= bestD ) { bestD = d; best = seg.name; }

				}

			}

		}

		return best;

	}

}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/*.test.mjs`
Expected: all pass (10 new).

- [ ] **Step 5: Commit**

```bash
git add js/OsmData.js test/osm-data.test.mjs
git commit -F - <<'MSG'
feat(osm): place OpenStreetMap streets and buildings on the track grid

Pure helpers: &osm= link parameter, metres-to-world transform, clipping streets
off track tiles, dropping buildings on the track, triangle budget, street lookup.
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

---

### Task 4: Minimap and street-name HUD (every track — closes #2)

**Files:**
- Create: `js/OsmHud.js`, `test/harness/hud.html`
- Modify: `js/main.js` (imports, HUD creation, per-frame update — **not** the OSM loading, that is Task 5)

**Interfaces:**
- Consumes: `Track.js` exports `TRACK_CELLS`, `CELL_RAW`, `GRID_SCALE`; in the harness, Task 3's `osmFeatures`, `clipStreets`, `buildingsOffTrack`, `viewArea`, `StreetIndex`.
- Produces: `class Hud { constructor( cells, cellSize ); setOsm( { streets, buildings, index } ); note( text ); update( x, z, forwardX, forwardZ ) }` — DOM ids `#minimap`, `#minimap-note`, `#street-name`.

- [ ] **Step 1: Create the HUD module**

Create `js/OsmHud.js`:

```js
// OsmHud.js — north-up minimap for every track, plus street names and OSM layers for OpenStreetMap
// tracks. No three.js: everything arrives as plain world coordinates (+X east, +Z south = down).

const MAP_W = 190, MAP_H = 130, PAD = 10;

const STYLE = `
	#minimap {
		position: absolute;
		top: 60px;
		right: 12px;
		width: ${ MAP_W }px;
		height: ${ MAP_H }px;
		background: rgba(10,12,14,0.55);
		border-radius: 12px;
		pointer-events: none;
		z-index: 10;
	}
	#minimap-note {
		position: absolute;
		top: ${ 60 + MAP_H + 6 }px;
		right: 12px;
		width: ${ MAP_W }px;
		color: #fff;
		font: 500 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		text-align: center;
		opacity: 0.75;
		pointer-events: none;
		z-index: 10;
	}
	#street-name {
		position: absolute;
		left: 50%;
		bottom: 56px;
		transform: translateX(-50%);
		padding: 6px 14px;
		border-radius: 999px;
		background: rgba(10,12,14,0.6);
		color: #fff;
		font: 600 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		white-space: nowrap;
		opacity: 0;
		transition: opacity 0.4s;
		pointer-events: none;
		z-index: 10;
	}
	#street-name.show { opacity: 1; }
	@media (max-width: 480px) {
		#minimap { width: 130px; height: 89px; }
		#minimap-note { top: 155px; width: 130px; }
	}
	@media (max-width: 760px) {
		#street-name { bottom: 102px; }
	}
`;

export class Hud {

	// cells: Track.js cells [[gx, gz, type], …] in any order; cellSize: world units per cell.
	constructor( cells, cellSize ) {

		this.cells = cells;
		this.cellSize = cellSize;
		this.index = null;
		this.streetName = null;
		this.layers = { streets: [], buildings: [] };

		const style = document.createElement( 'style' );
		style.textContent = STYLE;
		document.head.appendChild( style );

		this.canvas = document.createElement( 'canvas' );
		this.canvas.id = 'minimap';
		this.ctx = this.canvas.getContext( '2d' );
		document.body.appendChild( this.canvas );

		this.noteEl = document.createElement( 'div' );
		this.noteEl.id = 'minimap-note';
		document.body.appendChild( this.noteEl );

		this.streetEl = document.createElement( 'div' );
		this.streetEl.id = 'street-name';
		document.body.appendChild( this.streetEl );

		this.fitView();
		this.drawStatic();

	}

	// OSM layers in world coordinates: streets [{ pts }], buildings [{ ring }], index = StreetIndex.
	setOsm( { streets, buildings, index } ) {

		this.layers = { streets, buildings };
		this.index = index;
		this.drawStatic();

	}

	note( text ) {

		this.noteEl.textContent = text;

	}

	// World position of the car and its forward direction (unit vector on the ground plane).
	update( x, z, forwardX, forwardZ ) {

		this.drawCar( x, z, forwardX, forwardZ );
		if ( this.index ) this.showStreet( this.index.nameAt( x, z ) );

	}

	fitView() {

		let minX = Infinity, maxX = - Infinity, minZ = Infinity, maxZ = - Infinity;

		for ( const [ gx, gz ] of this.cells ) {

			minX = Math.min( minX, gx ); maxX = Math.max( maxX, gx + 1 );
			minZ = Math.min( minZ, gz ); maxZ = Math.max( maxZ, gz + 1 );

		}

		const s = this.cellSize;
		const w = ( maxX - minX + 2 ) * s, h = ( maxZ - minZ + 2 ) * s;
		this.scale = Math.min( ( MAP_W - 2 * PAD ) / w, ( MAP_H - 2 * PAD ) / h );
		this.originX = MAP_W / 2 - ( minX + maxX ) / 2 * s * this.scale;
		this.originZ = MAP_H / 2 - ( minZ + maxZ ) / 2 * s * this.scale;

	}

	toMap( x, z ) {

		return [ this.originX + x * this.scale, this.originZ + z * this.scale ];

	}

	// Streets, buildings and track tiles never change during a race: draw them once.
	drawStatic() {

		const dpr = window.devicePixelRatio || 1;
		const layer = document.createElement( 'canvas' );
		layer.width = MAP_W * dpr;
		layer.height = MAP_H * dpr;
		const ctx = layer.getContext( '2d' );
		ctx.scale( dpr, dpr );

		ctx.fillStyle = 'rgba(255,255,255,0.16)';
		for ( const { ring } of this.layers.buildings ) {

			ctx.beginPath();
			ring.forEach( ( [ x, z ], i ) => ctx[ i ? 'lineTo' : 'moveTo' ]( ...this.toMap( x, z ) ) );
			ctx.fill();

		}

		ctx.strokeStyle = 'rgba(255,255,255,0.35)';
		ctx.lineWidth = 1;
		for ( const { pts } of this.layers.streets ) {

			ctx.beginPath();
			pts.forEach( ( [ x, z ], i ) => ctx[ i ? 'lineTo' : 'moveTo' ]( ...this.toMap( x, z ) ) );
			ctx.stroke();

		}

		const size = Math.max( 1.5, this.cellSize * this.scale );
		for ( const [ gx, gz, type ] of this.cells ) {

			const [ mx, mz ] = this.toMap( gx * this.cellSize, gz * this.cellSize );
			ctx.fillStyle = type === 'track-finish' ? '#ffffff' : '#f2c94c';
			ctx.fillRect( mx, mz, size, size );

		}

		this.staticLayer = layer;
		this.canvas.width = MAP_W * dpr;
		this.canvas.height = MAP_H * dpr;
		this.dpr = dpr;

	}

	drawCar( x, z, fx, fz ) {

		const ctx = this.ctx;
		ctx.setTransform( 1, 0, 0, 1, 0, 0 );
		ctx.clearRect( 0, 0, this.canvas.width, this.canvas.height );
		ctx.drawImage( this.staticLayer, 0, 0 );
		ctx.scale( this.dpr, this.dpr );

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

	showStreet( name ) {

		if ( name === this.streetName ) return;
		this.streetName = name;
		if ( name ) this.streetEl.textContent = name;
		this.streetEl.classList.toggle( 'show', !! name );

	}

}
```

- [ ] **Step 2: Create the harness page**

Create `test/harness/hud.html` (a stand-in `#lap-timer` of the real size is included so overlap can be checked):

```html
<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;background:#3a7;height:100vh}#lap-timer{position:absolute;top:12px;left:12px;min-width:140px;padding:10px 14px;height:90px;background:#0008}</style></head><body><div id="lap-timer"></div>
<script type="module">
import { buildGraph, makeProjection, perimeterLoop, simplifyPolyline, rasterizeLoop, loopCenter, loopToTrackCells } from '../../js/OsmTrack.js';
import { osmFeatures, clipStreets, buildingsOffTrack, viewArea, StreetIndex } from '../../js/OsmData.js';
import { Hud } from '../../js/OsmHud.js';
const CELL = 9.99 * 0.75;
const fixture = await ( await fetch( '../fixtures/sisseln.json' ) ).json();
const graph = buildGraph( fixture, makeProjection( fixture.bbox ) );
const { ids } = perimeterLoop( graph, { x0: -200, y0: -200, x1: 200, y1: 200 } );
const pts = ids.map( ( id ) => graph.nodes.get( id ) );
const { cells } = rasterizeLoop( simplifyPolyline( [ ...pts, pts[ 0 ] ], 10 ).slice( 0, -1 ), 10, 'auto' );
const { offX, offZ } = loopCenter( cells );
const track = loopToTrackCells( cells );
const param = { bbox: fixture.bbox, mpc: 10, offX, offZ };
const f = osmFeatures( fixture, param, CELL );
const area = viewArea( track, 8 );
const hud = new Hud( track, CELL );
const generic = new URLSearchParams( location.search ).has( 'generic' );
if ( generic ) {
	hud.update( 0, 0, 0, 0 ); // no OSM layers, zero heading vector
	window.__done = true;
	await new Promise( () => {} ); // stop here
}
hud.setOsm( { streets: clipStreets( f.streets, track, area, CELL ), buildings: buildingsOffTrack( f.buildings, track, area, CELL ), index: new StreetIndex( f.streets, CELL ) } );
const h = f.streets.find( ( s ) => s.name === 'Hauptstrasse' ).pts;
hud.update( ( h[0][0] + h[1][0] ) / 2, ( h[0][1] + h[1][1] ) / 2, 1, 0 );
window.harness = { hud };
window.__done = true;
</script></body></html>
```

- [ ] **Step 3: Wire the HUD into the game for every track**

In `js/main.js`:

1. Change the Track import to
   ```js
   import { buildTrack, decodeCells, computeSpawnPosition, computeTrackBounds, TRACK_CELLS, CELL_RAW, GRID_SCALE } from './Track.js';
   ```
2. After `import { ColorMapGLTFLoader } from './Loader.js';` add
   ```js
   import { Hud } from './OsmHud.js';
   ```
3. After `const lapTimer = new LapTimer( customCells, mapParam );` add
   ```js

   	const cellSize = CELL_RAW * GRID_SCALE;
   	const hud = new Hud( customCells || TRACK_CELLS, cellSize );
   ```
4. In `animate()`, after `lapTimer.update( dt, vehicle.spherePos, hasInput );` add
   ```js

   		_forward.set( 0, 0, 1 ).applyQuaternion( vehicle.container.quaternion );
   		hud.update( vehicle.spherePos.x, vehicle.spherePos.z, _forward.x, _forward.z );
   ```

- [ ] **Step 4: Headless check (runner from the Appendix, `CHECK=hud` and `CHECK=generic`)**

Serve the repo (`npx serve -l 3000 .`), then run the Appendix runner with `CHECK=hud` and with `CHECK=generic`.
Expected:
- `hud` at widths 1000, 420, 360: `overlapsTimer: false`, `street: "Hauptstrasse"`, `shown: "1"`.
- `generic`: street pill opacity `0`, empty text, `no page errors`.

- [ ] **Step 5: Run the unit suite**

Run: `node --test test/*.test.mjs` — Expected: all pass.

- [ ] **Step 6: Manual check in a real browser**

Open `http://localhost:3000/index.html` and one preset from **Tracks**. Expected: minimap top-right under the GitHub button, yellow tiles with a white finish cell, orange arrow moving with the truck and pointing where it drives.

- [ ] **Step 7: Commit**

```bash
git add js/OsmHud.js js/main.js test/harness/hud.html
git commit -F - <<'MSG'
feat(hud): show a north-up mini map during the race

Every track gets a minimap with the car; OpenStreetMap tracks can add streets,
buildings and the current street name (next commit).

Closes #2
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

---

### Task 5: Surroundings in the game (`OsmScene.js`, grass area, `&osm=` in `main.js`)

**Files:**
- Create: `js/OsmScene.js`, `test/harness/scene.html`
- Modify: `js/Track.js` (`buildTrack`), `js/main.js`

**Interfaces:**
- Consumes: Task 1 `overpassQuery`, `fetchOverpass`; Task 3 `parseOsmParam`, `viewArea`, `osmFeatures`, `clipStreets`, `buildingsOffTrack`, `budgetBuildings`, `StreetIndex`; Task 4 `Hud` (`setOsm`, `note`).
- Produces:
  - `loadSurroundings( scene, param, trackCells, area, cellSize ) → Promise<{ streets, buildings, index }>` (adds meshes named `osm-streets`, `osm-buildings`; rejects when Overpass fails, adding nothing).
  - `streetRibbons( streets, width ) → THREE.Mesh | null`, `extrudedBuildings( buildings, worldPerMetre ) → THREE.Mesh | null`, `VIEW_MARGIN_CELLS = 8`.
  - `buildTrack( scene, models, customCells, { grassArea = null } = {} )`.

- [ ] **Step 1: Create the scene module**

Create `js/OsmScene.js`:

```js
// OsmScene.js — OpenStreetMap surroundings for a generated track: extruded buildings and flat
// side-street ribbons, each merged into a single mesh. Placement and filtering live in OsmData.js.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { overpassQuery, fetchOverpass } from './OsmTrack.js';
import { osmFeatures, clipStreets, buildingsOffTrack, budgetBuildings, StreetIndex } from './OsmData.js';

const GROUND_Y = - 0.125;          // top of the grass tiles (track group y -0.5, tile y 0.5 × scale 0.75)
const STREET_Y = GROUND_Y + 0.012; // just above grass, below the track tiles' asphalt
const METRES_PER_LEVEL = 3;
const DEFAULT_LEVELS = 2;
const MAX_BUILDING_TRIANGLES = 20000;
const VIEW_MARGIN_CELLS = 8;       // the chase camera sees ~7 cells; nothing further out is built

const WALL_TONES = [ 0xf1e3c8, 0xe8c9b0, 0xd9dde4, 0xf3d9a4, 0xcfe0d1 ].map( ( c ) => new THREE.Color( c ) );
const ROOF_LIGHTEN = 0.35;

// Fetch OSM for the link's bbox and add the surroundings to the scene.
// Resolves { streets, buildings, index } for the HUD (world coordinates); rejects when Overpass fails.
export async function loadSurroundings( scene, param, trackCells, area, cellSize ) {

	const { osm } = await fetchOverpass( overpassQuery( param.bbox, undefined, { buildings: true } ) );
	const { streets, buildings } = osmFeatures( osm, param, cellSize );

	const sideStreets = clipStreets( streets, trackCells, area, cellSize );
	const houses = budgetBuildings( buildingsOffTrack( buildings, trackCells, area, cellSize ), trackCells, cellSize, MAX_BUILDING_TRIANGLES );

	const streetMesh = streetRibbons( sideStreets, cellSize * 0.5 );
	const houseMesh = extrudedBuildings( houses, cellSize / param.mpc );
	if ( streetMesh ) scene.add( streetMesh );
	if ( houseMesh ) scene.add( houseMesh );

	return { streets: sideStreets, buildings: houses, index: new StreetIndex( streets, cellSize ) };

}

export { VIEW_MARGIN_CELLS };

// Flat quads along each polyline, width in world units.
export function streetRibbons( streets, width ) {

	const positions = [];
	const half = width / 2;

	for ( const { pts } of streets ) {

		for ( let i = 0; i < pts.length - 1; i ++ ) {

			const [ ax, az ] = pts[ i ], [ bx, bz ] = pts[ i + 1 ];
			const len = Math.hypot( bx - ax, bz - az );
			if ( len === 0 ) continue;
			const nx = - ( bz - az ) / len * half, nz = ( bx - ax ) / len * half;

			positions.push(
				ax + nx, STREET_Y, az + nz, bx - nx, STREET_Y, bz - nz, bx + nx, STREET_Y, bz + nz,
				ax + nx, STREET_Y, az + nz, ax - nx, STREET_Y, az - nz, bx - nx, STREET_Y, bz - nz,
			);

		}

	}

	if ( positions.length === 0 ) return null;

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geometry.computeVertexNormals();

	const mesh = new THREE.Mesh( geometry, new THREE.MeshLambertMaterial( {
		color: 0x5b6069, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: - 1, polygonOffsetUnits: - 1,
	} ) );
	mesh.receiveShadow = true;
	mesh.name = 'osm-streets';
	return mesh;

}

// Footprints extruded upward; walls in a pastel tone picked by way id, flat roofs a lighter shade.
export function extrudedBuildings( buildings, worldPerMetre ) {

	const geometries = buildings.map( ( b ) => {

		const height = ( b.levels || DEFAULT_LEVELS ) * METRES_PER_LEVEL * worldPerMetre;
		// Shape lives in XY; after rotateX(-90°) shape y becomes world -z and extrusion depth becomes +y.
		const shape = new THREE.Shape( b.ring.map( ( [ x, z ] ) => new THREE.Vector2( x, - z ) ) );
		const geometry = new THREE.ExtrudeGeometry( shape, { depth: height, bevelEnabled: false } );
		geometry.rotateX( - Math.PI / 2 );
		geometry.translate( 0, GROUND_Y, 0 );
		paint( geometry, WALL_TONES[ Math.abs( b.id ) % WALL_TONES.length ] );
		geometry.clearGroups();
		return geometry;

	} );

	if ( geometries.length === 0 ) return null;

	const mesh = new THREE.Mesh( mergeGeometries( geometries ), new THREE.MeshLambertMaterial( { vertexColors: true } ) );
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	mesh.name = 'osm-buildings';
	return mesh;

}

// ExtrudeGeometry group 0 = caps (roof + floor), group 1 = walls: colour vertices per group.
function paint( geometry, wall ) {

	const roof = wall.clone().lerp( new THREE.Color( 0xffffff ), ROOF_LIGHTEN );
	const colors = new Float32Array( geometry.attributes.position.count * 3 );

	for ( const { start, count, materialIndex } of geometry.groups ) {

		const c = materialIndex === 0 ? roof : wall;
		for ( let i = start; i < start + count; i ++ ) c.toArray( colors, i * 3 );

	}

	geometry.setAttribute( 'color', new THREE.BufferAttribute( colors, 3 ) );

}
```

- [ ] **Step 2: Grass area in `Track.js`**

Apply this change to `js/Track.js`:

```diff
--- a/js/Track.js	2026-09-23 21:17:52.328000000 +0200
+++ b/js/Track.js	2026-09-24 15:27:18.804171826 +0200
@@ -115,7 +115,9 @@
 	[ 'vehicle-truck-red',    -1.36, -0.15, -23.80, 155.9 ],
 ];
 
-export function buildTrack( scene, models, customCells ) {
+// options.grassArea { minX, maxX, minZ, maxZ } (grid cells): plain grass there instead of forest and
+// tents, and the ground extends to cover it — room for OpenStreetMap buildings and streets.
+export function buildTrack( scene, models, customCells, { grassArea = null } = {} ) {
 
 	const trackGroup = new THREE.Group();
 	trackGroup.position.y = -0.5;
@@ -177,6 +179,15 @@
 		}
 
 		const pad = 3;
+		const inGrass = ( gx, gz ) => grassArea !== null &&
+			gx >= grassArea.minX && gx <= grassArea.maxX && gz >= grassArea.minZ && gz <= grassArea.maxZ;
+
+		if ( grassArea ) {
+
+			minX = Math.min( minX, grassArea.minX ); maxX = Math.max( maxX, grassArea.maxX );
+			minZ = Math.min( minZ, grassArea.minZ ); maxZ = Math.max( maxZ, grassArea.maxZ );
+
+		}
 
 		// Simple hash for deterministic pseudo-random placement
 		function hash( gx, gz ) {
@@ -200,7 +211,11 @@
 				const x = ( gx + 0.5 ) * CELL_RAW;
 				const z = ( gz + 0.5 ) * CELL_RAW;
 
-				if ( dist <= 1 ) {
+				if ( inGrass( gx, gz ) ) {
+
+					emptyPositions.push( x, z, 0 );
+
+				} else if ( dist <= 1 ) {
 
 					// ~15% chance of tents in the empty ring
 					if ( hash( gx, gz ) % 7 === 0 ) {
```

- [ ] **Step 3: Load surroundings in `main.js`**

In `js/main.js` (Task 4's HUD lines are already there):

1. After `import { Hud } from './OsmHud.js';` add
   ```js
   import { parseOsmParam, viewArea } from './OsmData.js';
   import { loadSurroundings, VIEW_MARGIN_CELLS } from './OsmScene.js';
   ```
2. Directly above the comment `// Compute track bounds and size physics/shadows to fit` add
   ```js
   	// &osm= (from osm-track.html) adds the real surroundings around a generated track
   	const osmParam = customCells ? parseOsmParam( new URLSearchParams( window.location.search ).get( 'osm' ) ) : null;
   	const osmArea = osmParam ? viewArea( customCells, VIEW_MARGIN_CELLS ) : null;

   ```
3. Replace `buildTrack( scene, models, customCells );` with
   ```js
   	buildTrack( scene, models, customCells, { grassArea: osmArea } );
   ```
4. Directly after `const hud = new Hud( customCells || TRACK_CELLS, cellSize );` add
   ```js

   	if ( osmParam ) {

   		hud.note( 'Loading surroundings…' );
   		loadSurroundings( scene, osmParam, customCells, osmArea, cellSize )
   			.then( ( layers ) => {

   				hud.setOsm( layers );
   				hud.note( '' );

   			} )
   			.catch( ( e ) => {

   				console.warn( 'OSM surroundings unavailable:', e.message );
   				hud.note( 'Surroundings unavailable' );

   			} );

   	}
   ```

- [ ] **Step 4: Create the scene harness**

Create `test/harness/scene.html`:

```html
<!DOCTYPE html><html><head><script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/"}}</script></head><body>
<script type="module">
import * as THREE from 'three';
import { buildGraph, makeProjection, perimeterLoop, simplifyPolyline, rasterizeLoop, loopCenter, loopToTrackCells } from '../../js/OsmTrack.js';
import { osmFeatures, clipStreets, buildingsOffTrack, budgetBuildings, viewArea } from '../../js/OsmData.js';
import { streetRibbons, extrudedBuildings, loadSurroundings } from '../../js/OsmScene.js';
const CELL = 9.99 * 0.75;
if ( new URLSearchParams( location.search ).has( 'fail' ) ) {
	localStorage.clear();
	const scene = new THREE.Scene();
	window.result = await loadSurroundings( scene, { bbox: [ 47.548, 7.98, 47.556, 7.995 ], mpc: 10, offX: 0, offZ: 0 }, [ [ 0, 0 ] ], { minX: -8, maxX: 8, minZ: -8, maxZ: 8 }, CELL )
		.then( () => ( { rejected: false } ), ( e ) => ( { rejected: true, children: scene.children.length, message: e.message.slice( 0, 60 ) } ) );
	await new Promise( () => {} ); // stop here
}
const fixture = await ( await fetch( '../fixtures/sisseln.json' ) ).json();
const graph = buildGraph( fixture, makeProjection( fixture.bbox ) );
const { ids } = perimeterLoop( graph, { x0: -200, y0: -200, x1: 200, y1: 200 } );
const pts = ids.map( ( id ) => graph.nodes.get( id ) );
const { cells } = rasterizeLoop( simplifyPolyline( [ ...pts, pts[ 0 ] ], 10 ).slice( 0, -1 ), 10, 'auto' );
const { offX, offZ } = loopCenter( cells );
const track = loopToTrackCells( cells );
const f = osmFeatures( fixture, { bbox: fixture.bbox, mpc: 10, offX, offZ }, CELL );
const area = viewArea( track, 8 );
const houses = budgetBuildings( buildingsOffTrack( f.buildings, track, area, CELL ), track, CELL, 20000 );
const b = extrudedBuildings( houses, CELL / 10 ), s = streetRibbons( clipStreets( f.streets, track, area, CELL ), CELL * 0.5 );
const box = new THREE.Box3().setFromObject( b );
window.result = { houses: houses.length, triangles: b.geometry.attributes.position.count / 3, hasColor: !! b.geometry.attributes.color, minY: +box.min.y.toFixed(3), maxY: +box.max.y.toFixed(2), streetTris: s.geometry.attributes.position.count / 3 };
</script></body></html>
```

- [ ] **Step 5: Headless check (Appendix runner, `CHECK=scene` and `CHECK=fail`)**

Expected:
- `scene`: `houses` > 50, `triangles` ≤ 20000, `hasColor: true`, `minY: -0.125`, `streetTris` > 0.
- `fail` (Overpass routed to HTTP 504): `rejected: true`, `children: 0`, message lists every mirror.

- [ ] **Step 6: Unit suite + syntax**

Run: `node --test test/*.test.mjs && node --input-type=module --check < js/main.js && node --input-type=module --check < js/OsmScene.js`
Expected: all pass, no syntax errors.

- [ ] **Step 7: Commit**

```bash
git add js/OsmScene.js js/Track.js js/main.js test/harness/scene.html
git commit -F - <<'MSG'
feat(osm): show real buildings and side streets around OpenStreetMap tracks

With &osm= the game fetches the same Overpass data as osm-track.html and adds
merged building and street meshes; forest makes way for grass there. If Overpass
is unavailable the track plays normally with a short note.
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

---

### Task 6: `osm-track.html` — shared fetch, Auto default, `&osm=` links

**Files:**
- Modify: `osm-track.html`

**Interfaces:**
- Consumes: Task 1 `fetchOverpass`, `overpassQuery( …, { buildings: true } )`; Task 2 `'auto'`; Task 3 `encodeOsmParam`.
- Produces: Play and Copy link open `index.html?map=<tiles>&osm=<s>,<w>,<n>,<e>,<mpc>,<offX>,<offZ>`; the editor link stays `editor.html?map=<tiles>`.

- [ ] **Step 1: Apply the page change**

```diff
--- a/osm-track.html	2026-09-24 13:20:23.256000000 +0200
+++ b/osm-track.html	2026-09-24 15:27:56.297872474 +0200
@@ -168,7 +168,8 @@
 		<div class="row" style="margin-top: 12px;">
 			<label>Diagonal streets</label>
 			<div class="seg">
-				<button id="mode-stairs" class="active" title="Bresenham staircase — follows the street closely">Stairs</button>
+				<button id="mode-auto" class="active" title="One corner per segment, staircase where that would cut the route">Auto</button>
+				<button id="mode-stairs" title="Bresenham staircase — follows the street closely">Stairs</button>
 				<button id="mode-L" title="One corner per segment — smoother to drive">One corner</button>
 			</div>
 		</div>
@@ -213,17 +214,9 @@
 		import {
 			DEFAULT_HIGHWAYS, overpassQuery, makeProjection, buildGraph, nearestNode,
 			routeLoop, perimeterLoop, simplifyPolyline, rasterizeLoop, loopCenter, loopToTrackCells, trackStats, encodeTrackCells,
+			fetchOverpass,
 		} from './js/OsmTrack.js';
-
-		// Tried in order. overpass.osm.ch only holds Switzerland but is rarely overloaded;
-		// the others are worldwide public mirrors.
-		const OVERPASS = [
-			'https://overpass.osm.ch/api/interpreter',
-			'https://overpass-api.de/api/interpreter',
-			'https://overpass.kumi.systems/api/interpreter',
-			'https://overpass.private.coffee/api/interpreter',
-		];
-		const CACHE_PREFIX = 'osm-track.cache.';
+		import { encodeOsmParam } from './js/OsmData.js';
 
 		const canvas = document.getElementById( 'map' );
 		const ctx = canvas.getContext( '2d' );
@@ -240,7 +233,7 @@
 		let center = null;        // { offX, offZ } from loopCenter
 		let duplicates = new Set();
 		let encoded = null;
-		let mode = 'stairs';
+		let mode = 'auto';
 		let selectMode = 'frame';   // 'frame' | 'points'
 		let frame = null;           // { x0, y0, x1, y1 } in metres
 		let frameDrag = null;
@@ -273,8 +266,10 @@
 
 			try {
 
-				const query = overpassQuery( bbox, $( 'highways' ).value.trim() || DEFAULT_HIGHWAYS );
-				const { osm, source } = await fetchOsm( query );
+				// Buildings are fetched too so the game finds the same query in the cache.
+				const query = overpassQuery( bbox, $( 'highways' ).value.trim() || DEFAULT_HIGHWAYS, { buildings: true } );
+				const { osm, source: from } = await fetchOverpass( query, { onTry: ( host ) => { $( 'stats' ).textContent = `Loading streets from ${ host }…`; } } );
+				const source = from === 'cache' ? 'cached — clear site data to refetch' : from;
 				graph = buildGraph( osm, makeProjection( bbox ) );
 				waypoints = [];
 				frame = null;
@@ -294,51 +289,6 @@
 
 		}
 
-		// Same query → same data; keep it in localStorage so a flaky Overpass only has to answer once.
-		async function fetchOsm( query ) {
-
-			const key = CACHE_PREFIX + query;
-
-			try {
-
-				const cached = localStorage.getItem( key );
-				if ( cached ) return { osm: JSON.parse( cached ), source: 'cached — clear site data to refetch' };
-
-			} catch {}
-
-			const errors = [];
-
-			for ( const url of OVERPASS ) {
-
-				$( 'stats' ).textContent = `Loading streets from ${ new URL( url ).host }…`;
-
-				try {
-
-					const controller = new AbortController();
-					const timer = setTimeout( () => controller.abort(), 45000 );
-					const res = await fetch( url, { method: 'POST', body: 'data=' + encodeURIComponent( query ), signal: controller.signal } );
-					clearTimeout( timer );
-					if ( ! res.ok ) throw new Error( `HTTP ${ res.status }` );
-					const osm = await res.json();
-					if ( ! Array.isArray( osm.elements ) ) throw new Error( 'unexpected response' );
-					if ( osm.elements.length === 0 ) throw new Error( 'no data for this area' );
-
-					try { localStorage.setItem( key, JSON.stringify( osm ) ); } catch {}
-
-					return { osm, source: new URL( url ).host };
-
-				} catch ( e ) {
-
-					errors.push( `${ new URL( url ).host }: ${ e.name === 'AbortError' ? 'timeout' : e.message }` );
-
-				}
-
-			}
-
-			throw new Error( errors.join( ' · ' ) );
-
-		}
-
 		// ── Generation ──────────────────────────────────────────
 		function regenerate() {
 
@@ -634,11 +584,14 @@
 			regenerate();
 
 		}
-		$( 'btn-play' ).addEventListener( 'click', () => window.open( 'index.html?map=' + encoded, '_blank' ) );
+		// &osm= lets the game fetch the same streets and buildings and place them on the tiles.
+		const trackLink = ( page ) => page + '?map=' + encoded + '&osm=' + encodeOsmParam( { bbox, mpc: Number( $( 'mpc' ).value ), offX: center.offX, offZ: center.offZ } );
+
+		$( 'btn-play' ).addEventListener( 'click', () => window.open( trackLink( 'index.html' ), '_blank' ) );
 		$( 'btn-editor' ).addEventListener( 'click', () => window.open( 'editor.html?map=' + encoded, '_blank' ) );
 		$( 'btn-copy' ).addEventListener( 'click', async () => {
 
-			const url = new URL( 'index.html?map=' + encoded, location.href ).href;
+			const url = new URL( trackLink( 'index.html' ), location.href ).href;
 			try { await navigator.clipboard.writeText( url ); showToast( 'Link copied' ); }
 			catch { prompt( 'Copy this link', url ); }
 
@@ -646,12 +599,14 @@
 
 		$( 'mpc' ).addEventListener( 'input', () => { $( 'mpc-out' ).textContent = $( 'mpc' ).value + ' m'; regenerate(); } );
 		$( 'tol' ).addEventListener( 'input', () => { $( 'tol-out' ).textContent = Number( $( 'tol' ).value ).toFixed( 2 ) + ' cells'; regenerate(); } );
+		$( 'mode-auto' ).addEventListener( 'click', () => setMode( 'auto' ) );
 		$( 'mode-stairs' ).addEventListener( 'click', () => setMode( 'stairs' ) );
 		$( 'mode-L' ).addEventListener( 'click', () => setMode( 'L' ) );
 
 		function setMode( m ) {
 
 			mode = m;
+			$( 'mode-auto' ).classList.toggle( 'active', m === 'auto' );
 			$( 'mode-stairs' ).classList.toggle( 'active', m === 'stairs' );
 			$( 'mode-L' ).classList.toggle( 'active', m === 'L' );
 			regenerate();
```

- [ ] **Step 2: Headless check (Appendix runner, `CHECK=page`)**

Expected: stats line with `cells`, `auto active: true`, and an opened URL `index.html?map=…&osm=47.548,7.98,47.556,7.995,10,<int>,<int>`; `no page errors`.

- [ ] **Step 3: Commit**

```bash
git add osm-track.html
git commit -F - <<'MSG'
feat(osm): link generated tracks to their surroundings

Play and Copy link carry &osm=, Auto is the default raster mode, and the page
uses the shared Overpass fetch so the game finds the data in the cache.
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

---

### Task 7: Changelog, TODO, play-test hand-off

**Files:**
- Modify: `CHANGELOG.md`, `TODO.md`

- [ ] **Step 1: Changelog (player-facing, hand-written)**

Under `## [Unreleased]` in `CHANGELOG.md` add:

```markdown
### Added

- Mini map in the top-right corner on every track, showing where you are.
- Tracks built from OpenStreetMap now show the real buildings and side streets
  around the road, and the name of the street you are driving on.
- New "Auto" option in the OpenStreetMap track builder: smoother corners without
  losing parts of the route. It is the new default.
```

- [ ] **Step 2: TODO**

In `TODO.md`, replace the `## In progress: OSM surroundings` section with:

```markdown
## Done: OSM surroundings (2026-09-24)

Spec `docs/superpowers/specs/2026-09-24-osm-surroundings-design.md`, plan
`docs/superpowers/plans/2026-09-24-osm-surroundings.md`. Awaiting the user's Sisseln play-test.
```

- [ ] **Step 3: Full verification**

Run: `node --test test/*.test.mjs` and all five Appendix checks (`hud`, `generic`, `scene`, `fail`, `page`). Expected: everything as stated in Tasks 4–6.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md TODO.md
git commit -F - <<'MSG'
docs: changelog and TODO for OSM surroundings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

- [ ] **Step 5: Hand-off to the user for the play-test**

Ask the user to open `osm-track.html`, load Sisseln, drag a frame, press **Play track**, and check: buildings and side streets where they expect them, minimap matches the village, street names change at the right junctions. Headless Chromium cannot render the game on this machine, so this step is the only in-game verification.

---

## Appendix: headless check runner (not committed)

Needs Playwright in a scratch directory (`npm i playwright@1.58` there) and a Chromium binary; on this machine: `/home/freax/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`. Serve the repo on port 3000 first. Save as `checks.cjs` in the scratch directory and run `REPO=<repo path> CHECK=<name> node checks.cjs`.

```js
const { chromium } = require( 'playwright' );
const fs = require( 'fs' );
const BASE = 'http://localhost:3000';
const CHROME = process.env.CHROME || '/home/freax/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';

const checks = {

	async hud( b, errs ) {

		for ( const [ w, h ] of [ [ 1000, 600 ], [ 420, 760 ], [ 360, 700 ] ] ) {

			const p = await b.newPage( { viewport: { width: w, height: h } } );
			p.on( 'pageerror', ( e ) => errs.push( e.message ) );
			await p.goto( BASE + '/test/harness/hud.html' );
			await p.waitForFunction( () => window.__done, null, { timeout: 20000 } );
			await p.waitForTimeout( 600 );
			console.log( 'hud', w, JSON.stringify( await p.evaluate( () => {

				const box = ( s ) => document.querySelector( s ).getBoundingClientRect();
				const m = box( '#minimap' ), t = box( '#lap-timer' );
				const pill = document.getElementById( 'street-name' );
				return { overlapsTimer: m.left < t.right && t.left < m.right && m.top < t.bottom && t.top < m.bottom, street: pill.textContent, shown: getComputedStyle( pill ).opacity };

			} ) ) );
			await p.close();

		}

	},

	async generic( b, errs ) {

		const p = await b.newPage( { viewport: { width: 420, height: 760 } } );
		p.on( 'pageerror', ( e ) => errs.push( e.message ) );
		await p.goto( BASE + '/test/harness/hud.html?generic' );
		await p.waitForFunction( () => window.__done, null, { timeout: 20000 } );
		console.log( 'generic pill opacity', await p.$eval( '#street-name', ( e ) => getComputedStyle( e ).opacity ), 'text', JSON.stringify( await p.textContent( '#street-name' ) ) );

	},

	async scene( b, errs ) {

		const p = await b.newPage();
		p.on( 'pageerror', ( e ) => errs.push( e.message ) );
		await p.goto( BASE + '/test/harness/scene.html' );
		await p.waitForFunction( () => window.result, null, { timeout: 30000 } );
		console.log( 'scene', JSON.stringify( await p.evaluate( () => window.result ) ) );

	},

	async fail( b, errs ) {

		const p = await b.newPage();
		p.on( 'pageerror', ( e ) => errs.push( e.message ) );
		await p.route( /overpass/, ( r ) => r.fulfill( { status: 504, body: 'busy' } ) );
		await p.goto( BASE + '/test/harness/scene.html?fail' );
		await p.waitForFunction( () => window.result, null, { timeout: 30000 } );
		console.log( 'fail', JSON.stringify( await p.evaluate( () => window.result ) ) );

	},

	async page( b, errs ) {

		const q = await b.newPage( { viewport: { width: 1300, height: 900 } } );
		q.on( 'pageerror', ( e ) => errs.push( e.message ) );
		const fixture = fs.readFileSync( process.env.REPO + '/test/fixtures/sisseln.json', 'utf8' );
		await q.route( /overpass/, ( r ) => r.fulfill( { contentType: 'application/json', body: fixture } ) );
		await q.addInitScript( () => { window.open = ( u ) => { window.__opened = u; }; } );
		await q.goto( BASE + '/osm-track.html' );
		await q.fill( '#bbox', '47.5480, 7.9800, 47.5560, 7.9950' );
		await q.click( '#btn-load' );
		await q.waitForFunction( () => /streets/.test( document.getElementById( 'stats' ).textContent ), null, { timeout: 20000 } );
		const bb = await ( await q.$( '#map' ) ).boundingBox();
		const cx = bb.x + bb.width / 2 + 160, cy = bb.y + bb.height / 2;
		await q.mouse.move( cx - 120, cy - 120 ); await q.mouse.down();
		await q.mouse.move( cx + 120, cy + 120, { steps: 8 } ); await q.mouse.up();
		await q.waitForTimeout( 300 );
		console.log( 'page stats', ( await q.textContent( '#stats' ) ).replace( /\s+/g, ' ' ).slice( 0, 120 ), '| auto active', await q.$eval( '#mode-auto', ( e ) => e.classList.contains( 'active' ) ) );
		await q.click( '#btn-play' );
		console.log( 'page opened', ( await q.evaluate( () => window.__opened ) || '' ).replace( /map=[^&]+/, 'map=…' ) );

	},

};

( async () => {

	const b = await chromium.launch( { executablePath: CHROME } );
	const errs = [];
	await checks[ process.env.CHECK ]( b, errs );
	console.log( errs.length ? errs.join( '\n' ) : 'no page errors' );
	await b.close();

} )();
```
