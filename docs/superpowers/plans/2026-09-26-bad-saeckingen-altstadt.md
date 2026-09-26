# Bad Säckingen Altstadt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a preset track "Bad Säckingen Altstadt" to the in-game Tracks menu: through the old-town lanes, over the covered wooden bridge (Holzbrücke) to Stein AG and back over the Fridolinsbrücke, with the real surroundings.

**Architecture:** `pedestrian` joins the default OSM road types; `area=yes` squares are no longer treated as roads and unnamed bridges use `bridge:name`. A new pure `bakeLoop()` in `js/OsmTrack.js` turns waypoints into track cells (osm-track.html's point mode without the page). A new generator `tools/osm-presets.mjs` bakes preset definitions from a committed roads-only fixture into a generated `js/OsmPresets.js`; `js/Tracks.js` appends them and the Tracks menu links them with `&osm=` so the existing surroundings, minimap and street names load.

**Tech Stack:** Plain ES modules, no bundler, no `package.json`; Node's built-in `node:test` (Node 24); Overpass API via the existing `fetchOverpass` mirrors.

**Spec:** `docs/superpowers/specs/2026-09-26-bad-saeckingen-altstadt-design.md`

## Global Constraints

- Static files only — no bundler, no `package.json`, no committed `node_modules` (browser-game stack).
- `js/OsmTrack.js`, `js/OsmData.js`, `js/OsmPresets.js`, `js/Tracks.js` must not import `three`.
- Code style = upstream mrdoob style: tabs, spaces inside parentheses/brackets `f( a, [ 1 ] )`, a blank line after every `{` that opens a multi-line function/block body and before its `}`, `const`/`let` only, no commented-out code.
- Test names: `functionName_stateUnderTest_expectedBehavior`. Run the full suite with `node --test test/*.test.mjs` (a bare `node --test test/` does **not** work on Node 24).
- `DEFAULT_HIGHWAYS` gains exactly `pedestrian` — **not** `footway`, `path`, `cycleway` or `steps`.
- Preset definition (verbatim): id `bad-saeckingen`, name `Bad Säckingen Altstadt`, desc `Old-town lanes and the covered wooden bridge over the Rhine`, bbox `[ 47.5435, 7.9400, 47.5565, 7.9560 ]`, highways `primary|secondary|tertiary|unclassified|residential|living_street|service|track|pedestrian|path`, waypoints `[ 47.55152, 7.95004 ], [ 47.55134, 7.95276 ], [ 47.54606, 7.94972 ], [ 47.5515, 7.94551 ], [ 47.55332, 7.94844 ]`, 10 metres per cell, mode `auto`.
- Holzbrücke = OSM way **85692214** (`highway=pedestrian`, `bridge=covered`, `bridge:name=Holzbrücke Bad Säckingen`, no `name`).
- `js/OsmPresets.js` and `js/Tracks.js` are generated — change their generators, then regenerate; never hand-edit them.
- Best-lap and drift-mark storage stay keyed by `?map=` only (unchanged code in `main.js`).
- Commits: Conventional Commits; end each message with the trailer lines your session requires.
- Serve locally with `python3 -m http.server 3000` (or `npx serve -l 3000 .`; `serve.json` disables clean URLs).

## Review Focus

1. **OSM data changed since the fixture was taken** — regenerating must fail loudly (not bake a broken loop) when the route no longer works. → Task 4 test `bakePreset_routeThatDrivesAStreetTwice_throws` plus the throw on shortcuts; Task 3 test `bakeLoop_waypointOnDisconnectedRoad_throws`.
2. **Old shared links and the existing presets** — Default and Aerodrome presets keep their exact `?map=` values and links without `&osm=`. → Task 5 test `trackHref_presets_addOsmOnlyWhenPresent`, and regenerating `js/Tracks.js` must leave the four Aerodrome map strings byte-identical.
3. **Pedestrian squares mapped as polygons** (`area=yes`) — never become ring roads in `osm-track.html` or ribbons in the surroundings. → Task 1 test `buildGraph_pedestrianSquareMappedAsArea_isNotARoad`, Task 2 test `osmFeatures_areaSquareAndUnnamedBridge_skipsSquareAndNamesBridge`.
4. **Street pill on the bridge** — shows "Holzbrücke Bad Säckingen", not nothing. → Task 1 test `buildGraph_unnamedBridge_usesBridgeName`, Task 2 test.
5. **The lap starts on the bridge and stays inside the codec** — finish cell on the Holzbrücke, all cells within −128..127. → Task 4 tests `…finishLineIsOnTheHolzbruecke`, `…osmParamParsesAndCellsFitTheCodec`.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `js/OsmTrack.js` | modify | `DEFAULT_HIGHWAYS` + `pedestrian`; `wayName()`; `buildGraph` skips `area=yes`; new `bakeLoop()` |
| `js/OsmData.js` | modify | `osmFeatures` skips `area=yes` streets, names via `wayName()` |
| `tools/osm-presets.mjs` | create | Preset definitions, `bakePreset()`, `--fetch` fixture refresh, writes `js/OsmPresets.js` |
| `test/fixtures/bad-saeckingen.json` | create (generated) | Roads-only Overpass snapshot for the preset (~245 kB) |
| `js/OsmPresets.js` | create (generated) | `OSM_PRESETS = [ { id, name, desc, map, osm } ]` |
| `tools/aerodrome-tracks.mjs` | modify | Output template imports and appends `OSM_PRESETS`, exports `trackHref()` |
| `js/Tracks.js` | regenerate | Output of `tools/aerodrome-tracks.mjs` |
| `index.html` | modify | Tracks menu uses `trackHref( t )` |
| `test/osm-track.test.mjs` | modify | Tests for Tasks 1 and 3 |
| `test/osm-data.test.mjs` | modify | Test for Task 2 |
| `test/osm-presets.test.mjs` | create | Fixture-based preset tests |
| `test/tracks.test.mjs` | modify | New preset id, `trackHref` |
| `CHANGELOG.md` | modify | Player-facing entry under `[Unreleased]` |

---

### Task 1: Pedestrian lanes, squares and bridge names in the road graph

**Files:**
- Modify: `js/OsmTrack.js:12` (`DEFAULT_HIGHWAYS`), `js/OsmTrack.js:129-171` (`buildGraph`)
- Test: `test/osm-track.test.mjs`

**Interfaces:**
- Consumes: nothing new.
- Produces: `export function wayName( tags ) → string` (`tags.name`, else `tags['bridge:name']`, else `''`); `buildGraph( osm, project )` unchanged signature, now skips ways with `tags.area === 'yes'` and sets `way.name = wayName( tags )`; `DEFAULT_HIGHWAYS` = `'primary|secondary|tertiary|unclassified|residential|living_street|service|track|pedestrian'`.

- [ ] **Step 1: Write the failing tests**

In `test/osm-track.test.mjs`, add `DEFAULT_HIGHWAYS` to the import from `'../js/OsmTrack.js'`, then add below the imports and `fixture` line:

```js
// Four nodes on a ~76 m × 111 m block; ways = [ [ id, nodeIds, tags ], … ]
const MINI_BBOX = [ 46.999, 7.999, 47.002, 8.002 ];
const miniOsm = ( ways ) => ( {
	elements: [
		{ type: 'node', id: 1, lat: 47.0, lon: 8.0 },
		{ type: 'node', id: 2, lat: 47.0, lon: 8.001 },
		{ type: 'node', id: 3, lat: 47.001, lon: 8.001 },
		{ type: 'node', id: 4, lat: 47.001, lon: 8.0 },
		...ways.map( ( [ id, nodes, tags ] ) => ( { type: 'way', id, nodes, tags } ) ),
	],
} );
```

and these tests at the end of the file:

```js
test( 'DEFAULT_HIGHWAYS_oldTownLanes_includesPedestrianButNotFootpaths', () => {

	const types = DEFAULT_HIGHWAYS.split( '|' );
	assert.ok( types.includes( 'pedestrian' ) );
	assert.ok( ! types.includes( 'footway' ) && ! types.includes( 'path' ) );

} );

test( 'buildGraph_pedestrianSquareMappedAsArea_isNotARoad', () => {

	const osm = miniOsm( [
		[ 10, [ 1, 2 ], { highway: 'pedestrian', name: 'Gasse' } ],
		[ 11, [ 1, 2, 3, 4, 1 ], { highway: 'pedestrian', area: 'yes', name: 'Münsterplatz' } ],
	] );
	const graph = buildGraph( osm, makeProjection( MINI_BBOX ) );
	assert.deepEqual( graph.ways.map( ( w ) => w.id ), [ 10 ] );
	assert.equal( graph.nodes.get( 3 ).adj.length, 0 );

} );

test( 'buildGraph_unnamedBridge_usesBridgeName', () => {

	const osm = miniOsm( [
		[ 10, [ 1, 2 ], { highway: 'pedestrian', bridge: 'covered', 'bridge:name': 'Holzbrücke Bad Säckingen' } ],
		[ 11, [ 2, 3 ], { highway: 'residential', name: 'Rheinbrückstrasse', 'bridge:name': 'Other' } ],
		[ 12, [ 3, 4 ], { highway: 'residential' } ],
	] );
	const graph = buildGraph( osm, makeProjection( MINI_BBOX ) );
	assert.deepEqual( graph.ways.map( ( w ) => w.name ), [ 'Holzbrücke Bad Säckingen', 'Rheinbrückstrasse', '' ] );

} );
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/osm-track.test.mjs`
Expected: the three new tests FAIL (`pedestrian` missing; way 11 present; first name `''`). All older tests still pass.

- [ ] **Step 3: Implement**

In `js/OsmTrack.js` change line 12 to:

```js
export const DEFAULT_HIGHWAYS = 'primary|secondary|tertiary|unclassified|residential|living_street|service|track|pedestrian';
```

Add directly above `export function buildGraph`:

```js
// Display name of a road: its name, else the bridge's name (the Holzbrücke only has bridge:name).
export function wayName( tags ) {

	return tags?.name ?? tags?.[ 'bridge:name' ] ?? '';

}
```

In `buildGraph`, replace the skip line and the `ways.push` line with:

```js
		if ( el.type !== 'way' || ! el.nodes || ! el.tags?.highway || el.tags.area === 'yes' ) continue; // roads only — buildings and squares share the response
```

```js
		ways.push( { id: el.id, name: wayName( el.tags ), highway: el.tags.highway, pts } );
```

- [ ] **Step 4: Run the full suite**

Run: `node --test test/*.test.mjs`
Expected: all PASS (the Sisseln fixture has no `area` tags, so `buildGraph_responseWithBuildings_usesRoadsOnly` still passes).

- [ ] **Step 5: Commit**

```bash
git add js/OsmTrack.js test/osm-track.test.mjs
git commit -m "feat(osm): include pedestrian lanes, skip squares, name bridges"
```

---

### Task 2: Same rules for the in-game surroundings

**Files:**
- Modify: `js/OsmData.js:7` (import), `js/OsmData.js:106-108` (`osmFeatures` street branch)
- Test: `test/osm-data.test.mjs`

**Interfaces:**
- Consumes: `wayName( tags )` from Task 1 (`js/OsmTrack.js`).
- Produces: `osmFeatures( osm, param, cellSize )` unchanged signature; streets skip `area=yes`; `street.name = wayName( tags )`.

- [ ] **Step 1: Write the failing test**

In `test/osm-data.test.mjs` add below the `fixture` line:

```js
// Four nodes on a ~76 m × 111 m block; ways = [ [ id, nodeIds, tags ], … ]
const MINI_BBOX = [ 46.999, 7.999, 47.002, 8.002 ];
const miniOsm = ( ways ) => ( {
	elements: [
		{ type: 'node', id: 1, lat: 47.0, lon: 8.0 },
		{ type: 'node', id: 2, lat: 47.0, lon: 8.001 },
		{ type: 'node', id: 3, lat: 47.001, lon: 8.001 },
		{ type: 'node', id: 4, lat: 47.001, lon: 8.0 },
		...ways.map( ( [ id, nodes, tags ] ) => ( { type: 'way', id, nodes, tags } ) ),
	],
} );
```

and at the end of the file:

```js
test( 'osmFeatures_areaSquareAndUnnamedBridge_skipsSquareAndNamesBridge', () => {

	const osm = miniOsm( [
		[ 10, [ 1, 2 ], { highway: 'pedestrian', bridge: 'covered', 'bridge:name': 'Holzbrücke Bad Säckingen' } ],
		[ 11, [ 1, 2, 3, 4, 1 ], { highway: 'pedestrian', area: 'yes', name: 'Münsterplatz' } ],
	] );
	const { streets, buildings } = osmFeatures( osm, { bbox: MINI_BBOX, mpc: 10, offX: 0, offZ: 0 }, CELL );
	assert.deepEqual( streets.map( ( s ) => [ s.id, s.name ] ), [ [ 10, 'Holzbrücke Bad Säckingen' ] ] );
	assert.equal( buildings.length, 0 );

} );
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/osm-data.test.mjs`
Expected: FAIL — streets are `[ [ 10, '' ], [ 11, 'Münsterplatz' ] ]`.

- [ ] **Step 3: Implement**

`js/OsmData.js` line 7:

```js
import { makeProjection, wayName } from './OsmTrack.js';
```

In `osmFeatures`, the street branch becomes:

```js
		if ( tags.highway && tags.area !== 'yes' && pts.length >= 2 ) {

			streets.push( { id: el.id, name: wayName( tags ), pts } );

		} else if ( tags.building && isClosedRing( el.nodes ) && pts.length === el.nodes.length ) {
```

(the `else if` line is unchanged; a highway area is not a building, so it is skipped entirely).

- [ ] **Step 4: Run the full suite**

Run: `node --test test/*.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add js/OsmData.js test/osm-data.test.mjs
git commit -m "feat(osm): no ribbons for squares, bridge names in the street pill"
```

---

### Task 3: `bakeLoop()` — waypoints to track cells without the page

**Files:**
- Modify: `js/OsmTrack.js` (new export directly above the `// ── Codec` comment)
- Test: `test/osm-track.test.mjs`

**Interfaces:**
- Consumes: `makeProjection`, `buildGraph`, `nearestNode`, `routeLoop`, `simplifyPolyline`, `rasterizeLoop`, `loopCenter`, `loopToTrackCells` (all existing in `js/OsmTrack.js`).
- Produces: `export function bakeLoop( osm, { bbox, waypoints, mpc, mode = 'auto', tol = mpc } ) → { ids: number[], cells: [gx, gz, type, orient][], center: { offX, offZ, width, height }, shortcuts: number, duplicates: Set<string> }`. `waypoints` = `[ [ lat, lon ], … ]` in driving order. Throws `'A loop needs at least three waypoints'` and `'Waypoint N is not connected by road to the next one'`. Extra properties on the options object are ignored (Task 4 passes whole preset definitions).

- [ ] **Step 1: Write the failing tests**

Add `bakeLoop` to the import from `'../js/OsmTrack.js'` in `test/osm-track.test.mjs` (`miniOsm` / `MINI_BBOX` exist from Task 1), then append:

```js
test( 'bakeLoop_fourCornersOfABlock_returnsClosedTrackAroundIt', () => {

	const osm = miniOsm( [ [ 10, [ 1, 2, 3, 4, 1 ], { highway: 'residential', name: 'Ring' } ] ] );
	const corners = [ [ 47.0, 8.0 ], [ 47.0, 8.001 ], [ 47.001, 8.001 ], [ 47.001, 8.0 ] ];
	const r = bakeLoop( osm, { bbox: MINI_BBOX, waypoints: corners, mpc: 10, mode: 'L' } );
	assert.deepEqual( r.ids, [ 1, 2, 3, 4 ] );
	assert.equal( r.shortcuts, 0 );
	assert.equal( r.duplicates.size, 0 );
	assert.equal( r.cells[ 0 ][ 2 ], 'track-finish' );
	assert.equal( r.cells.length, 2 * ( r.center.width + r.center.height ) - 4 ); // the block's outline, nothing else

} );

test( 'bakeLoop_waypointOnDisconnectedRoad_throws', () => {

	const osm = miniOsm( [ [ 10, [ 1, 2 ], { highway: 'residential' } ], [ 11, [ 3, 4 ], { highway: 'residential' } ] ] );
	const waypoints = [ [ 47.0, 8.0 ], [ 47.0, 8.001 ], [ 47.001, 8.001 ] ];
	assert.throws( () => bakeLoop( osm, { bbox: MINI_BBOX, waypoints, mpc: 10 } ), /not connected by road/ );

} );

test( 'bakeLoop_fewerThanThreeWaypoints_throws', () => {

	const osm = miniOsm( [ [ 10, [ 1, 2, 3, 4, 1 ], { highway: 'residential' } ] ] );
	assert.throws( () => bakeLoop( osm, { bbox: MINI_BBOX, waypoints: [ [ 47.0, 8.0 ], [ 47.001, 8.001 ] ], mpc: 10 } ), /at least three/ );

} );
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/osm-track.test.mjs`
Expected: FAIL — `bakeLoop` is not exported (SyntaxError on import, so the whole file fails).

- [ ] **Step 3: Implement**

In `js/OsmTrack.js`, directly above `// ── Codec (mirrors Track.js exactly, …`:

```js
// Waypoint loop → track cells: osm-track.html's point mode without the page. waypoints = [[lat, lon], …]
// in driving order; the lap starts at the first one. Returns { ids, cells, center, shortcuts, duplicates }
// (ids = the routed OSM node loop, cells = Track.js cells, center = loopCenter of the raster).
export function bakeLoop( osm, { bbox, waypoints, mpc, mode = 'auto', tol = mpc } ) {

	if ( waypoints.length < 3 ) throw new Error( 'A loop needs at least three waypoints' );

	const project = makeProjection( bbox );
	const graph = buildGraph( osm, project );

	const snapped = waypoints.map( ( [ lat, lon ] ) => {

		const p = project( lat, lon );
		const hit = nearestNode( graph, p.x, p.y );
		if ( ! hit ) throw new Error( 'No roads in this area' );
		return hit.node.id;

	} );

	const { ids, missing } = routeLoop( graph, snapped );
	if ( missing.length ) throw new Error( `Waypoint ${ missing.map( ( i ) => i + 1 ).join( ', ' ) } is not connected by road to the next one` );

	const pts = ids.map( ( id ) => graph.nodes.get( id ) );
	const simplified = simplifyPolyline( [ ...pts, pts[ 0 ] ], tol ).slice( 0, - 1 );
	const { cells: loop, duplicates, shortcuts } = rasterizeLoop( simplified, mpc, mode );

	return { ids, cells: loopToTrackCells( loop ), center: loopCenter( loop ), shortcuts, duplicates };

}
```

`tol = mpc` matches `osm-track.html`'s default tolerance slider (value 1 × metres per cell, `osm-track.html:166,302`). Do not refactor `osm-track.html` to use it — the page needs the intermediate values for drawing.

- [ ] **Step 4: Run the full suite**

Run: `node --test test/*.test.mjs`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add js/OsmTrack.js test/osm-track.test.mjs
git commit -m "feat(osm): bake a waypoint loop into track cells without the page"
```

---

### Task 4: Preset generator, fixture and the Bad Säckingen track

**Files:**
- Create: `tools/osm-presets.mjs`
- Create (generated): `test/fixtures/bad-saeckingen.json`, `js/OsmPresets.js`
- Test: `test/osm-presets.test.mjs` (create)

**Interfaces:**
- Consumes: `overpassQuery`, `fetchOverpass`, `bakeLoop`, `encodeTrackCells`, `makeProjection` (`js/OsmTrack.js`); `encodeOsmParam`, `parseOsmParam` (`js/OsmData.js`).
- Produces: `tools/osm-presets.mjs` exports `PRESET_DEFS` (array of `{ id, name, desc, fixture, bbox, highways, waypoints, mpc, mode }`), `readFixture( def ) → osm JSON`, `bakePreset( def, osm ) → { id, name, desc, map, osm, ids, cells }` (throws `'… drives a street twice …'` or `'… touches itself …'`), `presetsModule( presets ) → string`. `js/OsmPresets.js` exports `OSM_PRESETS = [ { id, name, desc, map, osm } ]`. Task 5 imports `OSM_PRESETS`.

- [ ] **Step 1: Write the failing test**

Create `test/osm-presets.test.mjs`:

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESET_DEFS, bakePreset, readFixture } from '../tools/osm-presets.mjs';
import { OSM_PRESETS } from '../js/OsmPresets.js';
import { makeProjection } from '../js/OsmTrack.js';
import { parseOsmParam } from '../js/OsmData.js';

const HOLZBRUECKE = 85692214; // OSM way: highway=pedestrian, bridge=covered, bridge:name=Holzbrücke Bad Säckingen

const def = PRESET_DEFS.find( ( d ) => d.id === 'bad-saeckingen' );
const fixture = readFixture( def );
const ways = fixture.elements.filter( ( el ) => el.type === 'way' );
const baked = bakePreset( def, fixture );

// True when two consecutive loop nodes are also consecutive on the way, i.e. the loop drives along it.
function drivesAlong( ids, way ) {

	const edges = new Set( ids.map( ( id, i ) => id + '>' + ids[ ( i + 1 ) % ids.length ] ) );
	return way.nodes.slice( 1 ).some( ( id, i ) => edges.has( way.nodes[ i ] + '>' + id ) || edges.has( id + '>' + way.nodes[ i ] ) );

}

function distanceToSegment( p, a, b ) {

	const dx = b.x - a.x, dy = b.y - a.y;
	const len2 = dx * dx + dy * dy;
	const t = len2 ? Math.max( 0, Math.min( 1, ( ( p.x - a.x ) * dx + ( p.y - a.y ) * dy ) / len2 ) ) : 0;
	return Math.hypot( p.x - a.x - t * dx, p.y - a.y - t * dy );

}

test( 'bakePreset_badSaeckingenFixture_matchesCommittedPreset', () => {

	const committed = OSM_PRESETS.find( ( p ) => p.id === def.id );
	assert.ok( committed, 'js/OsmPresets.js has no bad-saeckingen entry — run node tools/osm-presets.mjs' );
	assert.deepEqual( { ...committed }, { id: baked.id, name: baked.name, desc: baked.desc, map: baked.map, osm: baked.osm } );

} );

test( 'bakePreset_badSaeckingen_crossesHolzbrueckeAndReturnsOverFridolinsbruecke', () => {

	const holz = ways.find( ( w ) => w.id === HOLZBRUECKE );
	assert.equal( holz.tags[ 'bridge:name' ], 'Holzbrücke Bad Säckingen' );
	assert.ok( drivesAlong( baked.ids, holz ), 'the loop does not cross the Holzbrücke' );
	assert.ok( ways.some( ( w ) => w.tags.name === 'Fridolinsbrücke' && drivesAlong( baked.ids, w ) ), 'the loop does not come back over the Fridolinsbrücke' );

} );

test( 'bakePreset_badSaeckingen_runsThroughOldTownLanes', () => {

	const lanes = new Set( ways
		.filter( ( w ) => w.tags.highway === 'pedestrian' && w.tags.name && w.tags.area !== 'yes' && drivesAlong( baked.ids, w ) )
		.map( ( w ) => w.tags.name ) );
	assert.ok( lanes.size >= 3, `only ${ [ ...lanes ].join( ', ' ) }` );

} );

test( 'bakePreset_badSaeckingen_finishLineIsOnTheHolzbruecke', () => {

	const project = makeProjection( def.bbox );
	const nodes = new Map( fixture.elements.filter( ( el ) => el.type === 'node' ).map( ( n ) => [ n.id, project( n.lat, n.lon ) ] ) );
	const { offX, offZ } = parseOsmParam( baked.osm );
	const [ gx, gz, type ] = baked.cells[ 0 ];
	assert.equal( type, 'track-finish' );

	// Inverse of rasterizeLoop's Math.round( x / mpc ) and loopToTrackCells' centring
	const finish = { x: ( gx + offX ) * def.mpc, y: - ( gz + offZ ) * def.mpc };
	const bridge = ways.find( ( w ) => w.id === HOLZBRUECKE ).nodes.map( ( id ) => nodes.get( id ) );
	const d = Math.min( ...bridge.slice( 1 ).map( ( b, i ) => distanceToSegment( finish, bridge[ i ], b ) ) );
	assert.ok( d <= def.mpc, `finish line is ${ d.toFixed( 1 ) } m from the bridge` );

} );

test( 'bakePreset_badSaeckingen_osmParamParsesAndCellsFitTheCodec', () => {

	const param = parseOsmParam( baked.osm );
	assert.ok( param, 'osm param rejected by parseOsmParam' );
	assert.deepEqual( param.bbox, def.bbox );
	assert.equal( param.mpc, 10 );
	assert.ok( baked.cells.every( ( [ gx, gz ] ) => gx >= - 128 && gx <= 127 && gz >= - 128 && gz <= 127 ) );

} );

test( 'bakePreset_routeThatDrivesAStreetTwice_throws', () => {

	// Out over the Holzbrücke and straight back over it
	const outAndBack = { ...def, waypoints: [ def.waypoints[ 0 ], def.waypoints[ 1 ], def.waypoints[ 0 ] ] };
	assert.throws( () => bakePreset( outAndBack, fixture ), /drives a street twice/ );

} );
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/osm-presets.test.mjs`
Expected: FAIL — `Cannot find module '…/tools/osm-presets.mjs'`.

- [ ] **Step 3: Create the generator**

Create `tools/osm-presets.mjs`:

```js
// Bakes the OpenStreetMap preset tracks into js/OsmPresets.js.
//
// Usage: node tools/osm-presets.mjs           bake from the committed fixtures in test/fixtures/
//        node tools/osm-presets.mjs --fetch   refresh those fixtures from Overpass first
//
// A preset is a waypoint loop over real streets — the same pipeline as osm-track.html's point
// mode (bakeLoop in OsmTrack.js). The fixture keeps only the preset's roads, so baking is
// deterministic and test/osm-presets.test.mjs checks the committed tiles still match it.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { overpassQuery, fetchOverpass, bakeLoop, encodeTrackCells } from '../js/OsmTrack.js';
import { encodeOsmParam } from '../js/OsmData.js';

export const PRESET_DEFS = [
	{
		id: 'bad-saeckingen',
		name: 'Bad Säckingen Altstadt',
		desc: 'Old-town lanes and the covered wooden bridge over the Rhine',
		fixture: 'bad-saeckingen.json',
		bbox: [ 47.5435, 7.9400, 47.5565, 7.9560 ],
		// + pedestrian: old-town lanes and the Holzbrücke; + path: the bridge's two stubs on the Swiss side
		highways: 'primary|secondary|tertiary|unclassified|residential|living_street|service|track|pedestrian|path',
		waypoints: [
			[ 47.55152, 7.95004 ], // Holzbrücke, German end — start/finish
			[ 47.55134, 7.95276 ], // Holzbrücke, Swiss end (Stein AG)
			[ 47.54606, 7.94972 ], // Fridolinsbrücke
			[ 47.5515, 7.94551 ], // Hauensteinstraße
			[ 47.55332, 7.94844 ], // Steinbrückstraße
		],
		mpc: 10,
		mode: 'auto',
	},
];

const KEEP_TAGS = [ 'highway', 'name', 'bridge:name', 'area' ];

const fixtureUrl = ( def ) => new URL( '../test/fixtures/' + def.fixture, import.meta.url );

export function readFixture( def ) {

	return JSON.parse( fs.readFileSync( fixtureUrl( def ) ) );

}

// Preset definition + OSM → { id, name, desc, map, osm, ids, cells }. A preset must follow its
// streets completely, so a route that repeats a street or a loop that touches itself is an error.
export function bakePreset( def, osm ) {

	const r = bakeLoop( osm, def );

	if ( new Set( r.ids ).size !== r.ids.length ) throw new Error( `${ def.name }: the route drives a street twice — move a waypoint` );

	if ( r.shortcuts || r.duplicates.size ) {

		throw new Error( `${ def.name }: the loop touches itself (${ r.shortcuts } shortcuts, ${ r.duplicates.size } cells twice) — move a waypoint` );

	}

	return {
		id: def.id,
		name: def.name,
		desc: def.desc,
		map: encodeTrackCells( r.cells ),
		osm: encodeOsmParam( { bbox: def.bbox, mpc: def.mpc, offX: r.center.offX, offZ: r.center.offZ } ),
		ids: r.ids,
		cells: r.cells,
	};

}

export function presetsModule( presets ) {

	const rows = presets.map( ( p ) => `\t{ id: '${ p.id }', name: '${ p.name }', desc: '${ p.desc.replace( /'/g, "\\'" ) }', map: '${ p.map }', osm: '${ p.osm }' },` );

	return `// OpenStreetMap preset tracks for the in-game picker, with their &osm= surroundings.
// Generated by tools/osm-presets.mjs from test/fixtures/ — do not edit by hand.

export const OSM_PRESETS = [
${ rows.join( '\n' ) }
];
`;

}

async function fetchFixture( def ) {

	const { osm, source } = await fetchOverpass( overpassQuery( def.bbox, def.highways ), { storage: null } );

	const elements = osm.elements.map( ( el ) => el.type === 'node'
		? { type: 'node', id: el.id, lat: + el.lat.toFixed( 7 ), lon: + el.lon.toFixed( 7 ) }
		: { type: 'way', id: el.id, nodes: el.nodes, tags: Object.fromEntries( KEEP_TAGS.filter( ( k ) => el.tags?.[ k ] ).map( ( k ) => [ k, el.tags[ k ] ] ) ) } );

	fs.writeFileSync( fixtureUrl( def ), JSON.stringify( { bbox: def.bbox, elements } ) );
	console.log( `${ def.fixture }: ${ elements.length } elements from ${ source }` );

}

if ( process.argv[ 1 ] === fileURLToPath( import.meta.url ) ) {

	if ( process.argv.includes( '--fetch' ) ) for ( const def of PRESET_DEFS ) await fetchFixture( def );

	const presets = PRESET_DEFS.map( ( def ) => bakePreset( def, readFixture( def ) ) );
	fs.writeFileSync( new URL( '../js/OsmPresets.js', import.meta.url ), presetsModule( presets ) );
	for ( const p of presets ) console.log( `${ p.name }: ${ p.cells.length } cells` );

}
```

- [ ] **Step 4: Fetch the fixture and generate `js/OsmPresets.js`**

Run: `node tools/osm-presets.mjs --fetch`
Expected (verified 2026-09-26 against overpass.osm.ch, which also answers for this border area):

```
bad-saeckingen.json: ~3046 elements from overpass.osm.ch
Bad Säckingen Altstadt: ~320 cells
```

and `js/OsmPresets.js` with one entry whose `osm` is `'47.5435,7.94,47.5565,7.956,10,<offX>,<offZ>'` (was `…,10,8,3`). If every mirror fails, retry later — do not hand-write the fixture. If OSM changed and the tool throws (`drives a street twice` / `touches itself` / `not connected by road`), move the named waypoint onto a through street of the same route and re-run; record the change in the PR.

- [ ] **Step 5: Run the full suite**

Run: `node --test test/*.test.mjs`
Expected: all PASS, including the six new preset tests.

- [ ] **Step 6: Commit**

```bash
git add tools/osm-presets.mjs test/osm-presets.test.mjs test/fixtures/bad-saeckingen.json js/OsmPresets.js
git commit -m "feat(tracks): bake the Bad Säckingen old-town loop from OpenStreetMap"
```

---

### Task 5: Show the preset in the Tracks menu with its surroundings

**Files:**
- Modify: `tools/aerodrome-tracks.mjs:64-72` (output template)
- Regenerate: `js/Tracks.js`
- Modify: `index.html:79-89` (Tracks menu module)
- Test: `test/tracks.test.mjs`

**Interfaces:**
- Consumes: `OSM_PRESETS` from Task 4 (`js/OsmPresets.js`).
- Produces: `js/Tracks.js` exports `PRESET_TRACKS` (Default, 4 Aerodrome circuits, then `...OSM_PRESETS`) and `trackHref( track ) → string` (`'index.html'` without map; `'index.html?map=<map>'`; plus `'&osm=<osm>'` when `track.osm` is set).

- [ ] **Step 1: Write the failing tests**

In `test/tracks.test.mjs`, change the import to `import { PRESET_TRACKS, trackHref } from '../js/Tracks.js';` and replace the first test with:

```js
test( 'presets list the default track, the four Aerodrome Apex tracks and Bad Säckingen', () => {

	assert.deepEqual( PRESET_TRACKS.map( ( t ) => t.id ), [ 'default', 'aero', 'northants', 'styria', 'claypit', 'bad-saeckingen' ] );
	assert.equal( PRESET_TRACKS[ 0 ].map, null );

} );

test( 'trackHref_presets_addOsmOnlyWhenPresent', () => {

	assert.equal( trackHref( { map: null } ), 'index.html' );
	assert.equal( trackHref( { map: 'abc' } ), 'index.html?map=abc' );
	assert.equal( trackHref( { map: 'abc', osm: '1,2,3,4,10,0,0' } ), 'index.html?map=abc&osm=1,2,3,4,10,0,0' );
	const bs = PRESET_TRACKS.find( ( t ) => t.id === 'bad-saeckingen' );
	assert.match( trackHref( bs ), /^index\.html\?map=[\w-]+&osm=47\.5435,7\.94,47\.5565,7\.956,10,-?\d+,-?\d+$/ );

} );
```

The existing per-preset loop test (`… decodes to a single closed loop`) then covers the new map automatically.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/tracks.test.mjs`
Expected: FAIL — `trackHref` is not exported (SyntaxError on import).

- [ ] **Step 3: Update the generator template**

In `tools/aerodrome-tracks.mjs`, replace the `const out = \`…\`;` template with:

```js
const out = `// Track presets for the in-game picker (index.html). A preset is a ?map= string (see encodeCells in Track.js).
// The Aerodrome Apex circuits come from https://github.com/freaxnx01/game-aerodrome-apex —
// generated by tools/aerodrome-tracks.mjs, do not edit by hand. OSM_PRESETS: tools/osm-presets.mjs.

import { OSM_PRESETS } from './OsmPresets.js';

export const PRESET_TRACKS = [
	{ id: 'default', name: 'Default', desc: 'The original starter kit circuit', map: null },
${ presets.map( ( p ) => `\t{ id: '${ p.id }', name: '${ p.name }', desc: '${ p.desc.replace( /'/g, "\\'" ) }', map: '${ p.map }' },` ).join( '\n' ) }
	...OSM_PRESETS,
];

// Tracks-menu link. OpenStreetMap presets bring their real surroundings along (&osm=).
export function trackHref( track ) {

	if ( ! track.map ) return 'index.html';
	return 'index.html?map=' + track.map + ( track.osm ? '&osm=' + track.osm : '' );

}
`;
```

(the `presets.map( … )` line is unchanged — keep its `"\\'"` exactly as it is).

- [ ] **Step 4: Regenerate `js/Tracks.js`**

Run: `node tools/aerodrome-tracks.mjs`
Expected: `The Aerodrome: 102 cells`, `Northants GP: 92 cells`, `Styria Ring: 72 cells`, `The Claypit: 78 cells`. Then `git diff js/Tracks.js` must show **only** the header comment, the import, `...OSM_PRESETS,` and `trackHref` — the four `map:` strings unchanged (verified 2026-09-26). If the Aerodrome page is unreachable, apply exactly those four additions to `js/Tracks.js` by hand so it equals what the template would produce.

- [ ] **Step 5: Use it in the Tracks menu**

In `index.html`, in the `<script type="module">` that builds `#tracks-menu`:

```js
		import { PRESET_TRACKS, trackHref } from './js/Tracks.js';
```

```js
			a.href = trackHref( t );
```

(replacing `a.href = t.map ? 'index.html?map=' + t.map : 'index.html';`; the `t.map === current` check stays).

- [ ] **Step 6: Run the full suite**

Run: `node --test test/*.test.mjs`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add tools/aerodrome-tracks.mjs js/Tracks.js index.html test/tracks.test.mjs
git commit -m "feat(tracks): Bad Säckingen Altstadt in the Tracks menu with its surroundings"
```

---

### Task 6: Changelog and playtest

**Files:**
- Modify: `CHANGELOG.md` (`## [Unreleased]` → `### Added`)

**Interfaces:**
- Consumes: everything above. Produces: nothing for other tasks.

- [ ] **Step 1: Changelog entry**

Append under `## [Unreleased]` → `### Added` (player-facing voice, like the entries already there):

```markdown
- New track "Bad Säckingen Altstadt" in the Tracks menu: start on the covered
  wooden bridge over the Rhine, cross to Stein AG, come back over the
  Fridolinsbrücke and race through the old-town lanes — with the real houses
  and street names around you.
- The OpenStreetMap track builder now also uses pedestrian zones, so old-town
  lanes can be part of a track.
```

- [ ] **Step 2: Headless playtest (foreground, never `run_in_background`)**

Commit and push the branch first. Then serve (`python3 -m http.server 3000`) and with Playwright (foreground, `timeout=120000`):

1. Open `http://localhost:3000/index.html`, click `#tracks-button`, assert a link with text `Bad Säckingen Altstadt` exists and its `href` contains `&osm=47.5435,7.94,47.5565,7.956,10,`.
2. Open that href. Assert no console errors, and that `#street-name` eventually shows a non-empty name or the note "Surroundings unavailable" appears (Overpass may be down — the track must stay playable either way).
3. Open `http://localhost:3000/osm-track.html`, assert the `#highways` input value contains `pedestrian`.

- [ ] **Step 3: Full suite and commit**

Run: `node --test test/*.test.mjs` → all PASS.

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): Bad Säckingen old-town track"
```

- [ ] **Step 4: Manual check for the human reviewer (list it in the PR)**

Pick "Bad Säckingen Altstadt" from the Tracks menu: the lap starts on the Holzbrücke heading east; the street pill reads "Holzbrücke Bad Säckingen" there and old-town names (Rheinbrückstraße, Münsterplatz, Steinbrückstraße) later; buildings stand along the lanes. The Rhine itself is not drawn (deferred, see spec).
