# Track Load Progress and Cancel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While a track loads, show which step runs and the overall percent, and let the player cancel — back to the previous track before the car is drivable, or skip the OpenStreetMap surroundings while they download. Closes #14.

**Architecture:** A pure `LoadProgress` model (stage weights → monotonic percent, label key, cancel target) in `js/LoadProgress.js`, rendered by a DOM singleton `js/ui/LoadOverlay.js` into a `#load-overlay` div that exists in `index.html` from first paint. A tiny inline module in `index.html` starts it before the CDN-heavy `main.js` graph resolves; `main.js` imports the same singleton and advances it. `fetchOverpass` / `loadSurroundings` gain an `AbortSignal` and step callbacks.

**Tech Stack:** Plain ES modules (three.js + crashcat via import map, untouched), Node's built-in `node:test`, Python Playwright (not committed) for browser checks.

**Spec:** `docs/superpowers/specs/2026-09-27-track-load-progress-design.md`

## Global Constraints

- Static files only — no bundler, no `package.json`, no new dependencies.
- Code style = upstream mrdoob style: tabs, spaces inside parentheses/brackets, blank line after a block-opening `{` and before its `}`, `const`/`let`, no commented-out code. Test names `functionName_state_expectedBehavior`.
- Run all unit tests with `node --test test/*.test.mjs` (159 pass on `main` at bce6ce0; this plan adds 19 → 178).
- New UI strings go into `js/ui/strings.js` in **both** `en` and `de` (the parity test in `test/strings.test.mjs` enforces it). German: real umlauts, `ss` instead of `ß` is fine, capitalised `Du`/`Dein` if used.
- `js/LoadProgress.js` and `js/ui/LoadOverlay.js` must not import `three`, `crashcat` or anything from a CDN — the overlay has to run before those resolve.
- Stage weights exactly: `engine 10, models 40, track 10, lighting 20, surroundings 20`.
- `fetchOverpass`'s existing callers (`osm-track.html:271`, `tools/osm-fixture.mjs:9`, `tools/osm-presets.mjs:88`) stay unchanged and keep working.
- Load-time optimisation is out of scope (issue #15). Do not change what is loaded or in which order beyond the progress hooks.
- Line numbers refer to `main` at bce6ce0; locate by the quoted code if they drifted.
- Commit per task, Conventional Commits, message ending with exactly these two trailer lines:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01WVkTufc2PiJjhhrWptUPLA`
- Run Playwright in the **foreground** (never backgrounded); commit and push before running it.

## Review Focus

1. **Cached OSM answer** — `fetchOverpass` returns from `localStorage` without calling `onTry`; the label must read "Loading surroundings…", never a raw `{host}` placeholder. → Task 1 `labelKey_surroundingsWithoutHost_isGenericSurroundingsLabel`.
2. **Invalid `?map=`** — `main.js` falls back to the default track (`js/main.js:145-149`) while the inline module configured a `surroundings` stage; loading must still reach 100 % and hide. → Task 5 `finish()` is called on every non-OSM path; Task 5 Playwright check B.
3. **Cancel pressed after the Overpass answer arrived but before meshes are added** — nothing must be added to the scene. → Task 4 abort re-check in `loadSurroundings`; Task 2 `fetchOverpass_alreadyAborted_rejectsWithoutNetwork`.
4. **Space/Enter after clicking Cancel** (Space is throttle, issue #16) — must not re-press the button. → Task 3 Playwright check asserts focus left the button.
5. **Opening the default track directly** — nowhere to cancel to, so no button. → Task 1 `cancelTarget_defaultTrackWithoutReferrer_isNull`.

---

### Task 1: `LoadProgress` model, `labelKey`, `cancelTarget`

**Files:**
- Create: `js/LoadProgress.js`
- Test: `test/load-progress.test.mjs`

**Interfaces:**
- Produces:
  - `STAGE_WEIGHTS` — `{ engine: 10, models: 40, track: 10, lighting: 20, surroundings: 20 }`
  - `new LoadProgress( stages: string[] )`; commands `begin( stage, detail = {} )`, `step( done, total, detail = {} )`, `finish()`; getters `stage` (`'pending' | <stage> | 'done'`), `detail` (object, `step` adds `done`/`total`), `percent` (integer 0..100, never decreases); property `onChange` (function, called after every command).
  - `labelKey( stage, detail ) → string` (a `js/ui/strings.js` key)
  - `cancelTarget( currentHref, referrer ) → string | null`

- [ ] **Step 1: Write the failing tests**

Create `test/load-progress.test.mjs`:

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoadProgress, STAGE_WEIGHTS, labelKey, cancelTarget } from '../js/LoadProgress.js';

const PLAIN = [ 'engine', 'models', 'track', 'lighting' ];
const OSM = [ ...PLAIN, 'surroundings' ];

test( 'STAGE_WEIGHTS_allStages_sumTo100', () => {

	assert.equal( Object.values( STAGE_WEIGHTS ).reduce( ( a, b ) => a + b, 0 ), 100 );

} );

test( 'percent_freshProgress_isZeroAndPending', () => {

	const p = new LoadProgress( OSM );
	assert.equal( p.percent, 0 );
	assert.equal( p.stage, 'pending' );

} );

test( 'percent_trackWithoutSurroundings_isRenormalised', () => {

	const p = new LoadProgress( PLAIN );
	p.begin( 'engine' );
	p.begin( 'models' );
	assert.equal( p.percent, 12 ); // 10 of 80
	p.step( 11, 11 );
	assert.equal( p.percent, 62 ); // 50 of 80

} );

test( 'step_partialModels_countsFractionAndKeepsDetail', () => {

	const p = new LoadProgress( OSM );
	p.begin( 'engine' );
	p.begin( 'models' );
	p.step( 7, 11 );
	assert.equal( p.percent, 35 ); // 10 + 40 × 7/11 = 35.45
	assert.deepEqual( p.detail, { done: 7, total: 11 } );

} );

test( 'percent_smallerStepAfterLargerOne_neverDecreases', () => {

	const p = new LoadProgress( OSM );
	p.begin( 'models' );
	p.step( 8, 11 );
	const before = p.percent;
	p.step( 3, 11 );
	assert.equal( p.percent, before );

} );

test( 'finish_anyStage_isDoneAt100', () => {

	const p = new LoadProgress( OSM );
	p.begin( 'lighting' );
	p.finish();
	assert.equal( p.stage, 'done' );
	assert.equal( p.percent, 100 );

} );

test( 'begin_invalidStages_throw', () => {

	const p = new LoadProgress( PLAIN );
	assert.throws( () => p.begin( 'teleport' ), /unknown load stage/ );
	assert.throws( () => p.begin( 'surroundings' ), /not configured/ );
	p.begin( 'track' );
	assert.throws( () => p.begin( 'models' ), /backwards/ );
	assert.throws( () => new LoadProgress( [ 'engine', 'bogus' ] ), /unknown load stage/ );

} );

test( 'step_zeroTotal_throws', () => {

	const p = new LoadProgress( PLAIN );
	p.begin( 'models' );
	assert.throws( () => p.step( 0, 0 ), /total/ );

} );

test( 'onChange_everyCommand_isCalled', () => {

	const p = new LoadProgress( PLAIN );
	const seen = [];
	p.onChange = () => seen.push( p.stage );
	p.begin( 'models' );
	p.step( 1, 11 );
	p.finish();
	assert.deepEqual( seen, [ 'models', 'models', 'done' ] );

} );

test( 'labelKey_stages_mapToStringKeys', () => {

	assert.equal( labelKey( 'pending', {} ), 'load.engine' );
	assert.equal( labelKey( 'models', { done: 1, total: 11 } ), 'load.models' );
	assert.equal( labelKey( 'surroundings', { phase: 'fetch', host: 'overpass.osm.ch', index: 1, count: 4 } ), 'load.fetch' );
	assert.equal( labelKey( 'surroundings', { phase: 'build' } ), 'load.build' );

} );

test( 'labelKey_surroundingsWithoutHost_isGenericSurroundingsLabel', () => {

	assert.equal( labelKey( 'surroundings', {} ), 'load.surroundings' );

} );

test( 'cancelTarget_cameFromAnotherTrack_returnsThere', () => {

	const from = 'https://h.test/game/index.html?map=AAA';
	assert.equal( cancelTarget( 'https://h.test/game/index.html?map=BBB', from ), from );
	assert.equal( cancelTarget( 'https://h.test/game/index.html?map=BBB', 'https://h.test/game/' ), 'https://h.test/game/' );

} );

test( 'cancelTarget_cameFromElsewhere_fallsBackToDefaultTrack', () => {

	const current = 'https://h.test/game/index.html?map=BBB';
	const fallback = 'https://h.test/game/index.html';
	assert.equal( cancelTarget( current, '' ), fallback );
	assert.equal( cancelTarget( current, 'https://h.test/game/osm-track.html' ), fallback );
	assert.equal( cancelTarget( current, 'https://other.test/game/index.html?map=AAA' ), fallback );
	assert.equal( cancelTarget( current, current ), fallback );

} );

test( 'cancelTarget_defaultTrackWithoutReferrer_isNull', () => {

	assert.equal( cancelTarget( 'https://h.test/game/', '' ), null );
	assert.equal( cancelTarget( 'https://h.test/game/index.html', 'https://h.test/game/osm-track.html' ), null );

} );
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/load-progress.test.mjs`
Expected: FAIL — `Cannot find module '…/js/LoadProgress.js'`.

- [ ] **Step 3: Implement**

Create `js/LoadProgress.js`:

```js
// LoadProgress.js — what the track loader is doing and how far it is. Pure: no DOM, no three.js,
// so the loading overlay can run before the CDN modules resolve. Rendered by ui/LoadOverlay.js.

export const STAGE_WEIGHTS = { engine: 10, models: 40, track: 10, lighting: 20, surroundings: 20 };

export class LoadProgress {

	constructor( stages ) {

		for ( const stage of stages ) assertKnownStage( stage );
		this.stages = stages;
		this.totalWeight = stages.reduce( ( sum, stage ) => sum + STAGE_WEIGHTS[ stage ], 0 );
		this.index = - 1;
		this.fraction = 0;
		this.currentDetail = {};
		this.best = 0;
		this.onChange = () => {};

	}

	begin( stage, detail = {} ) {

		assertKnownStage( stage );
		const index = this.stages.indexOf( stage );
		if ( index === - 1 ) throw new Error( `load stage not configured: ${ stage }` );
		if ( index < this.index ) throw new Error( `load stage goes backwards: ${ stage }` );
		this.index = index;
		this.fraction = 0;
		this.currentDetail = { ...detail };
		this.changed();

	}

	step( done, total, detail = {} ) {

		if ( ! ( total > 0 ) ) throw new Error( `load step total must be positive: ${ total }` );
		this.fraction = Math.min( 1, Math.max( 0, done / total ) );
		this.currentDetail = { ...detail, done, total };
		this.changed();

	}

	finish() {

		this.index = this.stages.length;
		this.currentDetail = {};
		this.best = 100;
		this.onChange();

	}

	get stage() {

		if ( this.index < 0 ) return 'pending';
		if ( this.index >= this.stages.length ) return 'done';
		return this.stages[ this.index ];

	}

	get detail() {

		return this.currentDetail;

	}

	get percent() {

		return this.best;

	}

	changed() {

		const finished = this.stages.slice( 0, this.index ).reduce( ( sum, stage ) => sum + STAGE_WEIGHTS[ stage ], 0 );
		const current = STAGE_WEIGHTS[ this.stages[ this.index ] ] * this.fraction;
		this.best = Math.max( this.best, Math.floor( ( finished + current ) / this.totalWeight * 100 ) );
		this.onChange();

	}

}

function assertKnownStage( stage ) {

	if ( ! ( stage in STAGE_WEIGHTS ) ) throw new Error( `unknown load stage: ${ stage }` );

}

export function labelKey( stage, detail ) {

	if ( stage === 'pending' ) return 'load.engine';
	if ( stage !== 'surroundings' ) return 'load.' + stage;
	if ( detail.phase === 'build' ) return 'load.build';
	return detail.host ? 'load.fetch' : 'load.surroundings';

}

// Where Cancel goes while the car is not drivable yet: back to the game page the player came from,
// else the default track, or null when that is the page already loading.
export function cancelTarget( currentHref, referrer ) {

	const current = new URL( currentHref );
	if ( referrer !== currentHref && isGamePage( referrer, current ) ) return referrer;
	if ( current.searchParams.has( 'map' ) ) return new URL( 'index.html', current ).href;
	return null;

}

function isGamePage( href, current ) {

	if ( ! href ) return false;
	let url;
	try { url = new URL( href ); } catch { return false; }
	const dir = current.pathname.replace( /[^/]*$/, '' );
	return url.origin === current.origin && ( url.pathname === dir || url.pathname === dir + 'index.html' );

}
```

Note `cancelTarget( 'https://h.test/game/index.html', 'https://h.test/game/osm-track.html' )`: the referrer is not a game page and the current page has no `map` → `null` (loading the default track; nothing to go back to).

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/load-progress.test.mjs` → all 14 pass. Then `node --test test/*.test.mjs` → 173 pass.

- [ ] **Step 5: Commit**

```bash
git add js/LoadProgress.js test/load-progress.test.mjs
git commit -m "feat(loading): add load progress model with cancel target"
```

---

### Task 2: `fetchOverpass` — abort signal and mirror index

**Files:**
- Modify: `js/OsmTrack.js:64-111` (`fetchOverpass`)
- Test: `test/osm-track.test.mjs` (append)

**Interfaces:**
- Produces: `fetchOverpass( query, { storage, fetchImpl, timeoutMs = 45000, onTry = () => {}, signal = null } )`. `onTry( host, index, count )` with `index` 1-based, `count = OVERPASS_MIRRORS.length`. When `signal` aborts (before or during a mirror request), rejects with an error whose `name === 'AbortError'`, tries no further mirror and caches nothing. A per-mirror timeout still records `host: timeout` and moves on.

- [ ] **Step 1: Write the failing tests**

Append to `test/osm-track.test.mjs` (`memoryStorage`, `okResponse` and `OVERPASS_MIRRORS` already exist in that file):

```js
// A fetch that never answers until its signal aborts — like an overloaded Overpass mirror.
const hangingFetch = ( url, { signal } ) => new Promise( ( resolve, reject ) => {

	signal.addEventListener( 'abort', () => reject( new DOMException( 'aborted', 'AbortError' ) ) );

} );

test( 'fetchOverpass_onTry_receivesIndexAndCount', async () => {

	const tried = [];
	const fetchImpl = async ( url ) => url === OVERPASS_MIRRORS[ 0 ] ? { ok: false, status: 504 } : okResponse( { elements: [ 1 ] } );
	await fetchOverpass( 'Q', { storage: memoryStorage(), fetchImpl, onTry: ( ...args ) => tried.push( args ) } );
	const count = OVERPASS_MIRRORS.length;
	assert.deepEqual( tried, [ [ new URL( OVERPASS_MIRRORS[ 0 ] ).host, 1, count ], [ new URL( OVERPASS_MIRRORS[ 1 ] ).host, 2, count ] ] );

} );

test( 'fetchOverpass_abortedDuringRequest_stopsWithoutTryingNextMirror', async () => {

	const storage = memoryStorage();
	const cancel = new AbortController();
	const tried = [];
	const onTry = ( host ) => {

		tried.push( host );
		setTimeout( () => cancel.abort(), 0 );

	};
	await assert.rejects( fetchOverpass( 'Q', { storage, fetchImpl: hangingFetch, signal: cancel.signal, onTry } ), { name: 'AbortError' } );
	assert.equal( tried.length, 1 );
	assert.equal( storage.size(), 0 );

} );

test( 'fetchOverpass_alreadyAborted_rejectsWithoutNetwork', async () => {

	const cancel = new AbortController();
	cancel.abort();
	const fetchImpl = () => assert.fail( 'network used after cancel' );
	await assert.rejects( fetchOverpass( 'Q', { storage: memoryStorage(), fetchImpl, signal: cancel.signal } ), { name: 'AbortError' } );

} );

test( 'fetchOverpass_mirrorTimesOut_triesNextMirror', async () => {

	const fetchImpl = ( url, init ) => url === OVERPASS_MIRRORS[ 0 ] ? hangingFetch( url, init ) : okResponse( { elements: [ 1 ] } );
	const { source } = await fetchOverpass( 'Q', { storage: memoryStorage(), fetchImpl, timeoutMs: 5 } );
	assert.equal( source, new URL( OVERPASS_MIRRORS[ 1 ] ).host );

} );
```

If `okResponse` in the file is synchronous, the `?:` expression above still works (`await` of a non-promise). Check `okResponse`'s definition at the top of the file before running.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/osm-track.test.mjs`
Expected: `fetchOverpass_onTry_receivesIndexAndCount` FAILS (only host passed); `…abortedDuringRequest…` FAILS (tries all four mirrors, rejects with a plain `Error`); `…alreadyAborted…` FAILS (`network used after cancel`). `…mirrorTimesOut…` may already pass — it guards the refactor.

- [ ] **Step 3: Implement**

In `js/OsmTrack.js` replace the whole `fetchOverpass` function (lines 64-111, from its three-line leading comment to its closing `}`) with:

```js
// Same query → same data: the latest answer is cached in storage (localStorage by default, null =
// no cache) so a flaky Overpass only has to answer once. onTry( host, index, count ) is called before
// each mirror (index 1-based). Resolves { osm, source }; rejects with every mirror's error when all
// fail, or with an AbortError as soon as `signal` aborts (no further mirror is tried).
export async function fetchOverpass( query, { storage = defaultStorage(), fetchImpl = globalThis.fetch, timeoutMs = 45000, onTry = () => {}, signal = null } = {} ) {

	const key = CACHE_PREFIX + query;

	try {

		const cached = storage?.getItem( key );
		if ( cached ) return { osm: JSON.parse( cached ), source: 'cache' };

	} catch {}

	const errors = [];

	for ( const [ i, url ] of OVERPASS_MIRRORS.entries() ) {

		throwIfAborted( signal );
		const host = new URL( url ).host;
		onTry( host, i + 1, OVERPASS_MIRRORS.length );

		try {

			const osm = await fetchMirror( url, query, { fetchImpl, timeoutMs, signal } );
			try { storeOnly( storage, key, JSON.stringify( osm ) ); } catch {}
			return { osm, source: host };

		} catch ( e ) {

			throwIfAborted( signal );
			errors.push( `${ host }: ${ e.name === 'AbortError' ? 'timeout' : e.message }` );

		}

	}

	throw new Error( errors.join( ' · ' ) );

}

// One mirror request, aborted by its own timeout or by the caller's signal.
async function fetchMirror( url, query, { fetchImpl, timeoutMs, signal } ) {

	const controller = new AbortController();
	const abort = () => controller.abort();
	const timer = setTimeout( abort, timeoutMs );
	signal?.addEventListener( 'abort', abort );
	if ( signal?.aborted ) abort();

	try {

		const res = await fetchImpl( url, { method: 'POST', body: 'data=' + encodeURIComponent( query ), signal: controller.signal } );
		if ( ! res.ok ) throw new Error( `HTTP ${ res.status }` );
		const osm = await res.json();
		if ( ! Array.isArray( osm.elements ) ) throw new Error( 'unexpected response' );
		if ( PARTIAL_REMARK.test( osm.remark ?? '' ) ) throw new Error( osm.remark );
		if ( osm.elements.length === 0 ) throw new Error( 'no data for this area' );
		return osm;

	} finally {

		clearTimeout( timer );
		signal?.removeEventListener( 'abort', abort );

	}

}

function throwIfAborted( signal ) {

	if ( signal?.aborted ) throw new DOMException( 'Loading cancelled', 'AbortError' );

}
```

The timeout now also covers `res.json()` (previously the timer was cleared right after the headers arrived) — intended.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/osm-track.test.mjs` → all pass (including the three pre-existing `fetchOverpass_*` tests). Then `node --test test/*.test.mjs` → 177 pass. Also `node --check tools/osm-presets.mjs && node --check tools/osm-fixture.mjs`.

- [ ] **Step 5: Commit**

```bash
git add js/OsmTrack.js test/osm-track.test.mjs
git commit -m "feat(osm): let fetchOverpass be cancelled and report mirror index"
```

---

### Task 3: Strings and the `LoadOverlay` DOM component

**Files:**
- Modify: `js/ui/strings.js` (add `load.*` keys to `en` and `de`)
- Create: `js/ui/LoadOverlay.js`
- Create: `test/harness/load.html`
- Test: `test/strings.test.mjs` (append one test)

**Interfaces:**
- Consumes: `LoadProgress`, `labelKey` (Task 1); `t( key, lang, vars )` from `js/ui/strings.js:123`.
- Produces: `loadOverlay() → LoadOverlay` (singleton bound to `#load-overlay`); instance methods `start( progress, onCancel | null )`, `setCancel( fn | null )`, `compact()`, `fail()`, `hide()`; getter `progress`. Root element gets class `modal` or `compact`, attribute `hidden` when hidden, and `data-percent` with the current percent. Button id `load-cancel`; label id `load-label`; percent id `load-percent`.

- [ ] **Step 1: Write the failing test**

Append to `test/strings.test.mjs`:

```js
test( 'STRINGS_loadingTexts_existInBothLanguages', () => {

	const keys = [ 'load.engine', 'load.models', 'load.track', 'load.lighting', 'load.surroundings', 'load.fetch', 'load.build',
		'load.cancel', 'load.back', 'load.failed', 'load.seconds', 'load.skipped', 'load.surroundingsFailed' ];
	for ( const key of keys ) for ( const lang of [ 'en', 'de' ] ) assert.ok( STRINGS[ lang ][ key ], `${ lang } ${ key }` );
	assert.equal( t( 'load.models', 'de', { done: 7, total: 11 } ), 'Modelle werden geladen (7/11)…' );

} );
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/strings.test.mjs` → the new test FAILS (`en load.engine`).

- [ ] **Step 3: Add the strings**

In `js/ui/strings.js`, append to the `en` object (after `'mp.openHostTrack'`):

```js
		'load.engine': 'Loading game engine…',
		'load.models': 'Loading models ({done}/{total})…',
		'load.track': 'Building the track…',
		'load.lighting': 'Calculating lighting…',
		'load.surroundings': 'Loading surroundings…',
		'load.fetch': 'Loading surroundings from {host} (server {index}/{count})…',
		'load.build': 'Building houses and streets…',
		'load.cancel': 'Cancel',
		'load.back': 'Back',
		'load.failed': 'Loading failed',
		'load.seconds': '{seconds} s',
		'load.skipped': 'Surroundings skipped',
		'load.surroundingsFailed': 'Surroundings unavailable',
```

and to the `de` object (after its `'mp.openHostTrack'`):

```js
		'load.engine': 'Spiel-Engine wird geladen…',
		'load.models': 'Modelle werden geladen ({done}/{total})…',
		'load.track': 'Strecke wird gebaut…',
		'load.lighting': 'Beleuchtung wird berechnet…',
		'load.surroundings': 'Umgebung wird geladen…',
		'load.fetch': 'Umgebung wird von {host} geladen (Server {index}/{count})…',
		'load.build': 'Häuser und Strassen werden gebaut…',
		'load.cancel': 'Abbrechen',
		'load.back': 'Zurück',
		'load.failed': 'Laden fehlgeschlagen',
		'load.seconds': '{seconds} s',
		'load.skipped': 'Umgebung übersprungen',
		'load.surroundingsFailed': 'Umgebung nicht verfügbar',
```

Run: `node --test test/*.test.mjs` → 178 pass (parity and placeholder tests included).

- [ ] **Step 4: Create the overlay component**

Create `js/ui/LoadOverlay.js`:

```js
// LoadOverlay.js — the loading panel over index.html: step, percent, elapsed seconds, Cancel.
// Renders a LoadProgress (../LoadProgress.js). No three.js: it must run before the CDN modules load.

import { labelKey } from '../LoadProgress.js';
import { t } from './strings.js';

const STYLE = `
	#load-overlay { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; background: rgba(10,12,14,0.55); }
	#load-overlay[hidden] { display: none; }
	#load-overlay.compact { inset: 12px 0 auto 0; background: none; pointer-events: none; }
	#load-overlay .load-box { pointer-events: auto; min-width: 260px; max-width: calc(100vw - 32px); padding: 14px 18px; border-radius: 14px;
		background: rgba(255,255,255,0.94); color: #1f2430; box-shadow: 0 10px 30px rgba(0,0,0,0.25);
		font: 400 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
	#load-overlay.compact .load-box { padding: 8px 14px; min-width: 220px; }
	#load-overlay .load-bar { height: 6px; margin: 10px 0 6px; border-radius: 3px; background: rgba(0,0,0,0.1); overflow: hidden; }
	#load-overlay .load-fill { height: 100%; width: 0; background: #1f2430; transition: width 0.2s; }
	#load-overlay .load-meta { display: flex; justify-content: space-between; align-items: center; gap: 12px; opacity: 0.75; }
	#load-overlay button { font: inherit; padding: 4px 12px; border-radius: 999px; border: 1px solid rgba(0,0,0,0.15); background: #fff; cursor: pointer; }
`;

let instance = null;

export function loadOverlay() {

	instance ??= new LoadOverlay( document.getElementById( 'load-overlay' ) );
	return instance;

}

class LoadOverlay {

	constructor( root ) {

		if ( ! root ) throw new Error( 'LoadOverlay needs a #load-overlay element' );
		this.root = root;
		this.cancelHandler = null;
		this.failed = false;
		this.currentProgress = null;
		this.buildDom();
		window.addEventListener( 'gg-langchange', () => this.render() );

	}

	buildDom() {

		const style = document.createElement( 'style' );
		style.textContent = STYLE;
		document.head.appendChild( style );
		this.root.setAttribute( 'role', 'status' );
		this.root.innerHTML = '<div class="load-box"><div id="load-label"></div><div class="load-bar"><div class="load-fill"></div></div>'
			+ '<div class="load-meta"><span><span id="load-percent"></span> · <span id="load-elapsed"></span></span><button id="load-cancel" type="button"></button></div></div>';
		this.label = this.root.querySelector( '#load-label' );
		this.fill = this.root.querySelector( '.load-fill' );
		this.percentEl = this.root.querySelector( '#load-percent' );
		this.elapsedEl = this.root.querySelector( '#load-elapsed' );
		this.button = this.root.querySelector( '#load-cancel' );
		this.button.addEventListener( 'click', () => this.cancel() );

	}

	get progress() {

		return this.currentProgress;

	}

	start( progress, onCancel ) {

		this.currentProgress = progress;
		this.cancelHandler = onCancel;
		progress.onChange = () => this.render();
		this.root.className = 'modal';
		this.root.hidden = false;
		this.ticker = setInterval( () => this.render(), 1000 );
		this.render();

	}

	setCancel( onCancel ) {

		this.cancelHandler = onCancel;
		this.render();

	}

	compact() {

		this.root.className = 'compact';

	}

	fail() {

		this.failed = true;
		this.root.className = 'modal';
		this.root.hidden = false;
		this.render();

	}

	hide() {

		clearInterval( this.ticker );
		this.root.hidden = true;

	}

	cancel() {

		this.button.blur();
		this.cancelHandler?.();

	}

	render() {

		const progress = this.currentProgress;
		if ( ! progress ) return;
		const lang = window.GG_LANG ?? 'en';
		this.label.textContent = this.failed ? t( 'load.failed', lang ) : t( labelKey( progress.stage, progress.detail ), lang, progress.detail );
		this.fill.style.width = progress.percent + '%';
		this.percentEl.textContent = progress.percent + ' %';
		this.elapsedEl.textContent = t( 'load.seconds', lang, { seconds: Math.floor( performance.now() / 1000 ) } );
		this.root.dataset.percent = String( progress.percent );
		this.button.textContent = t( this.failed ? 'load.back' : 'load.cancel', lang );
		this.button.hidden = ! this.cancelHandler;

	}

}
```

- [ ] **Step 5: Create the harness page**

Create `test/harness/load.html`:

```html
<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;background:#3a7;height:100vh}</style></head><body><div id="load-overlay"></div>
<script src="../../i18n.js"></script>
<script type="module">
import { loadOverlay } from '../../js/ui/LoadOverlay.js';
import { LoadProgress } from '../../js/LoadProgress.js';
const progress = new LoadProgress( [ 'engine', 'models', 'track', 'lighting', 'surroundings' ] );
const cancelled = [];
const overlay = loadOverlay();
overlay.start( progress, () => cancelled.push( progress.stage ) );
window.harness = { overlay, progress, cancelled };
window.__done = true;
</script></body></html>
```

- [ ] **Step 6: Commit and push, then verify in a browser (foreground)**

```bash
node --test test/*.test.mjs
git add js/ui/strings.js js/ui/LoadOverlay.js test/harness/load.html test/strings.test.mjs
git commit -m "feat(loading): add bilingual loading overlay"
git push
```

Save as `$SCRATCH/load_harness.py` (not committed) and run `python3 $SCRATCH/load_harness.py` from the repo root:

```python
import subprocess, time
from playwright.sync_api import sync_playwright

srv = subprocess.Popen(['python3', '-m', 'http.server', '8765'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto('http://localhost:8765/test/harness/load.html')
        page.wait_for_function('window.__done')
        page.evaluate("ggSetLang('en')")
        overlay = page.locator('#load-overlay')
        assert 'Loading game engine' in overlay.inner_text()

        page.evaluate("harness.progress.begin('engine'); harness.progress.begin('models'); harness.progress.step(7, 11)")
        text = overlay.inner_text()
        assert 'Loading models (7/11)' in text and '35 %' in text, text

        page.evaluate("ggSetLang('de')")
        assert 'Modelle werden geladen (7/11)' in overlay.inner_text()
        assert page.locator('#load-cancel').inner_text() == 'Abbrechen'
        page.evaluate("ggSetLang('en')")

        page.evaluate("""harness.overlay.compact(); harness.progress.begin('track'); harness.progress.begin('lighting');
            harness.progress.begin('surroundings'); harness.progress.step(0, 2, { phase: 'fetch', host: 'overpass.osm.ch', index: 1, count: 4 })""")
        text = overlay.inner_text()
        assert 'overpass.osm.ch (server 1/4)' in text and '80 %' in text, text
        assert page.evaluate("getComputedStyle(document.getElementById('load-overlay')).pointerEvents") == 'none'

        page.locator('#load-cancel').click()
        assert page.evaluate('harness.cancelled') == ['surroundings']
        assert page.evaluate('document.activeElement && document.activeElement.id') != 'load-cancel'

        page.evaluate("harness.overlay.setCancel(null)")
        assert not page.locator('#load-cancel').is_visible()

        page.evaluate("harness.overlay.fail()")
        assert 'Loading failed' in overlay.inner_text()

        page.evaluate("harness.progress.finish(); harness.overlay.hide()")
        assert not overlay.is_visible()
        assert errors == [], errors
        print('harness OK')
        browser.close()
finally:
    srv.terminate()
```

Expected: `harness OK`.

---

### Task 4: `loadSurroundings` — signal and step callback

**Files:**
- Modify: `js/OsmScene.js:19-36` (`loadSurroundings`)

**Interfaces:**
- Consumes: `fetchOverpass( query, { signal, onTry( host, index, count ) } )` (Task 2).
- Produces: `loadSurroundings( scene, param, trackCells, area, cellSize, { signal = null, onStep = () => {} } = {} ) → Promise<{ streets, buildings, index }>`. Calls `onStep( 'fetch', { host, index, count } )` per mirror tried and `onStep( 'build', {} )` before building. Rejects with `name === 'AbortError'` when `signal` is aborted at any point before meshes are added; in that case nothing is added to `scene`.

`js/OsmScene.js` imports `three` from the CDN, so it has no Node test; this task is verified through Task 5's Playwright check A.

- [ ] **Step 1: Implement**

Replace lines 19-36 of `js/OsmScene.js` (the comment above `loadSurroundings` and the function) with:

```js
// Fetch OSM for the link's bbox and add the surroundings to the scene.
// Resolves { streets, buildings, index } for the HUD (world coordinates); rejects when Overpass fails
// or `signal` is aborted — then nothing is added. onStep( 'fetch', { host, index, count } ) per
// mirror tried, onStep( 'build', {} ) before the meshes are built.
export async function loadSurroundings( scene, param, trackCells, area, cellSize, { signal = null, onStep = () => {} } = {} ) {

	const onTry = ( host, index, count ) => onStep( 'fetch', { host, index, count } );
	const { osm } = await fetchOverpass( overpassQuery( param.bbox, undefined, { buildings: true } ), { signal, onTry } );
	throwIfCancelled( signal );
	onStep( 'build', {} );
	await nextPaint();
	throwIfCancelled( signal );

	const { streets, buildings } = osmFeatures( osm, param, cellSize );

	const sideStreets = clipStreets( streets, trackCells, area, cellSize );
	const houses = budgetBuildings( buildingsOffTrack( buildings, trackCells, area, cellSize ), trackCells, cellSize, MAX_BUILDING_TRIANGLES );

	const streetMesh = streetRibbons( sideStreets, cellSize * 0.5 );
	const houseMesh = extrudedBuildings( houses, cellSize / param.mpc );
	if ( streetMesh ) scene.add( streetMesh );
	if ( houseMesh ) scene.add( houseMesh );

	return { streets: sideStreets, buildings: houses, index: new StreetIndex( streets, cellSize ) };

}

function throwIfCancelled( signal ) {

	if ( signal?.aborted ) throw new DOMException( 'Loading cancelled', 'AbortError' );

}

// Lets the "building" label paint before the synchronous mesh work; the timeout keeps a
// background tab (no animation frames) from stalling.
function nextPaint() {

	return new Promise( ( resolve ) => {

		requestAnimationFrame( resolve );
		setTimeout( resolve, 50 );

	} );

}
```

- [ ] **Step 2: Check syntax and the unchanged callers**

Run: `node --check js/OsmScene.js && grep -n "loadSurroundings" js/*.js`
Expected: no syntax error; the only caller is `js/main.js` (updated in Task 5).

- [ ] **Step 3: Commit**

```bash
git add js/OsmScene.js
git commit -m "feat(osm): make loading surroundings cancellable with step callbacks"
```

---

### Task 5: Wire the overlay into `index.html` and `main.js`

**Files:**
- Modify: `index.html` (style block ~line 55, body after `#tracks-menu` module ~line 111, before `js/main.js` ~line 132)
- Modify: `js/main.js:1-28` (imports), `:80-127` (`loadModels`), `:129-187` (`init` start), `:277-302` (surroundings block), `:431-436` (end of `init` and the `init()` call)

**Interfaces:**
- Consumes: `LoadProgress`, `cancelTarget` (Task 1); `loadOverlay()` (Task 3); `loadSurroundings( …, { signal, onStep } )` (Task 4); `t` from `js/ui/strings.js`.

- [ ] **Step 1: `index.html` — backdrop at first paint and the starter module**

In the `<style>` block, after the `#github-link svg` rule, add:

```css
		#load-overlay { position: fixed; inset: 0; z-index: 40; background: rgba(10,12,14,0.55); }
		#load-overlay[hidden] { display: none; }
```

Directly after `<div id="tracks-menu" hidden></div>` add:

```html
	<div id="load-overlay"></div>
```

After the closing `</script>` of the Tracks-menu module (the one importing `./js/Tracks.js`) and **before** `<script src="./version.js">`, add:

```html
	<script type="module">
		// Loading panel (#14): starts before js/main.js, whose CDN imports can take a while.
		import { loadOverlay } from './js/ui/LoadOverlay.js';
		import { LoadProgress, cancelTarget } from './js/LoadProgress.js';

		const params = new URLSearchParams( location.search );
		const stages = [ 'engine', 'models', 'track', 'lighting' ];
		if ( params.get( 'map' ) && params.get( 'osm' ) ) stages.push( 'surroundings' );
		const target = cancelTarget( location.href, document.referrer );
		const progress = new LoadProgress( stages );
		loadOverlay().start( progress, target ? () => location.replace( target ) : null );
		progress.begin( 'engine' );
	</script>
```

Deferred module scripts run in document order, so this runs before `js/main.js` and `loadOverlay().progress` is set by the time `main.js` runs.

- [ ] **Step 2: `main.js` — imports and helpers**

After `import { CpuPanel } from './ui/CpuPanel.js';` add:

```js
import { loadOverlay } from './ui/LoadOverlay.js';
import { t } from './ui/strings.js';
```

After the `window.addEventListener( 'resize', … );` block (line ~68) add:

```js
const overlay = loadOverlay();
const progress = overlay.progress;
const uiLang = () => window.GG_LANG ?? 'en';

// Lets the loading label paint before synchronous work; the timeout keeps a background tab from stalling.
function nextPaint() {

	return new Promise( ( resolve ) => {

		requestAnimationFrame( resolve );
		setTimeout( resolve, 50 );

	} );

}
```

- [ ] **Step 3: `main.js` — count loaded models**

Change `async function loadModels() {` to `async function loadModels( onModelLoaded ) {`, add `let loaded = 0;` as its first line, and replace the `resolve();` inside the `loader.load` callback (line ~118) with:

```js
				loaded ++;
				onModelLoaded( loaded, modelNames.length );
				resolve();
```

- [ ] **Step 4: `main.js` — stages in `init`**

In `init()` replace

```js
	registerAll();
	await loadModels();
```

with

```js
	registerAll();
	progress.begin( 'models' );
	await loadModels( ( done, total ) => progress.step( done, total ) );
```

Replace `	buildTrack( scene, models, customCells, { grassArea: osmArea } );` with

```js
	progress.begin( 'track' );
	await nextPaint();
	buildTrack( scene, models, customCells, { grassArea: osmArea } );
	progress.begin( 'lighting' );
	await nextPaint();
```

- [ ] **Step 5: `main.js` — surroundings with cancel**

Replace the whole block from `	if ( osmParam ) {` through the end of its `else if ( osmRaw !== null ) { … }` branch (lines ~280-302) with:

```js
	if ( osmParam ) {

		loadSurroundingsWithProgress( hud, osmParam, customCells, osmArea, cellSize );

	} else if ( osmRaw !== null ) {

		console.warn( 'OSM surroundings unavailable:', customCells ? 'malformed or too large &osm= value' : 'no valid ?map= track to place them around' );
		hud.note( t( 'load.surroundingsFailed', uiLang() ) );

	}

	if ( ! osmParam ) finishLoading();
```

Add these two functions at module level, between `loadModels` and `init`:

```js
// OpenStreetMap surroundings load while the player already drives: the panel shrinks, and Cancel
// aborts the download instead of leaving the track.
function loadSurroundingsWithProgress( hud, osmParam, cells, area, cellSize ) {

	const cancel = new AbortController();
	overlay.compact();
	overlay.setCancel( () => cancel.abort() );
	progress.begin( 'surroundings' );
	loadSurroundings( scene, osmParam, cells, area, cellSize, {
		signal: cancel.signal,
		onStep: ( phase, detail ) => progress.step( phase === 'build' ? 1 : 0, 2, { ...detail, phase } ),
	} )
		.then( ( layers ) => {

			hud.setOsm( layers );
			hud.note( '' );

		} )
		.catch( ( e ) => {

			const skipped = e.name === 'AbortError';
			if ( ! skipped ) console.warn( 'OSM surroundings unavailable:', e.message );
			hud.note( t( skipped ? 'load.skipped' : 'load.surroundingsFailed', uiLang() ) );

		} )
		.finally( finishLoading );

}

function finishLoading() {

	progress.finish();
	overlay.hide();

}
```

Note: `hud.note( 'Loading surroundings…' )` is gone on purpose — the panel shows that now.

- [ ] **Step 6: `main.js` — failures**

Replace the last line `init();` with:

```js
init().catch( ( e ) => {

	console.error( 'Loading the track failed:', e );
	overlay.fail();

} );
```

- [ ] **Step 7: Syntax check, unit tests, commit, push**

```bash
node --check js/main.js && node --test test/*.test.mjs
git add index.html js/main.js
git commit -m "feat(loading): show track loading progress with cancel"
git push
```

Expected: 178 pass.

- [ ] **Step 8: Verify in a browser (foreground, needs CDN access to jsdelivr and esm.sh)**

Save as `$SCRATCH/load_game.py` (not committed) and run `python3 $SCRATCH/load_game.py` from the repo root with a generous timeout (headless WebGL is slow):

```python
import subprocess, time
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8765/'
srv = subprocess.Popen(['python3', '-m', 'http.server', '8765'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader'])

        # A — OSM track: progress rises, Cancel skips the surroundings, only one mirror asked.
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        overpass = []
        page.route('**/api/interpreter', lambda route: overpass.append(route.request.url))  # never answered
        page.goto(BASE + 'index.html', wait_until='domcontentloaded')
        page.evaluate("ggSetLang('en')")
        page.wait_for_selector('#load-overlay', state='hidden', timeout=180000)  # default track done
        page.click('#tracks-button')
        page.click('#tracks-menu a:has-text("Bad Säckingen Altstadt")')
        page.wait_for_url('**osm=**')
        seen = []
        deadline = time.time() + 180
        while time.time() < deadline:
            try:
                state = page.evaluate("(() => { const o = document.getElementById('load-overlay'); return o && [ o.dataset.percent, o.className ]; })()")
            except Exception:
                state = None  # page still navigating
            if state and state[0] is not None: seen.append(int(state[0]))
            if state and state[1] == 'compact' and overpass: break
            time.sleep(0.2)
        assert seen == sorted(seen), seen
        assert 'overpass.osm.ch (server 1/4)' in page.inner_text('#load-overlay')
        page.click('#load-cancel')
        page.wait_for_selector('#load-overlay', state='hidden', timeout=10000)
        assert page.inner_text('#minimap-note') == 'Surroundings skipped'
        time.sleep(2)
        assert len(overpass) == 1, overpass
        assert errors == [], errors
        page.close()

        # B — Cancel before the car is drivable goes back to the previous track.
        page = browser.new_page()
        page.goto(BASE + 'index.html', wait_until='domcontentloaded')
        page.evaluate("ggSetLang('en')")
        page.wait_for_selector('#load-overlay', state='hidden', timeout=180000)
        page.route('**/models/*.glb', lambda route: None)  # routing disables the cache; models never arrive
        page.click('#tracks-button')
        page.click('#tracks-menu a:has-text("The Aerodrome")')
        page.wait_for_url('**map=**')
        page.wait_for_selector('#load-cancel:visible', timeout=60000)
        assert page.inner_text('#load-cancel') == 'Cancel'
        page.click('#load-cancel')
        page.wait_for_url(lambda url: 'map=' not in url, timeout=10000)
        page.close()

        # C — invalid ?map= with &osm= still finishes and hides the panel.
        page = browser.new_page()
        page.goto(BASE + 'index.html?map=not-a-track&osm=1,2,3,4,10,0,0', wait_until='domcontentloaded')
        page.wait_for_selector('#load-overlay', state='hidden', timeout=180000)
        assert page.evaluate("document.getElementById('load-overlay').dataset.percent") == '100'
        page.close()

        print('game OK')
        browser.close()
finally:
    srv.terminate()
```

Expected: `game OK`. If the CDN is unreachable in the environment, say so in the PR under **Testing** and run check A–C manually in a desktop browser instead (DevTools → Network → block `*/api/interpreter` for A, `*.glb` for B).

---

### Task 6: Changelog

**Files:**
- Modify: `CHANGELOG.md` (`## [Unreleased]` → `### Added`, append as last bullet)

- [ ] **Step 1: Add the player-facing entry**

Append to the `### Added` list under `## [Unreleased]`:

```markdown
- While a track loads you now see what is happening and how far along it is, in
  percent. **Cancel** takes you back to the track you came from; while the real
  houses of an OpenStreetMap track are still loading, it skips them and you drive
  on without. Available in German and English.
```

- [ ] **Step 2: Commit and push**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): note track loading progress and cancel"
git push
```
