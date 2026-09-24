# P2P Multiplayer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 2–4 players race each other over manual WebRTC (codes + invite links, no server): solid remote trucks, countdown start, N laps, results, rematch; de/en multiplayer UI. Closes #1.

**Architecture:** Pure modules (`Signal`, `Protocol`, `RaceState`, `Interpolate`, `strings`) carry the rules and are unit-tested in Node. `Session` wraps `RTCPeerConnection` (star through the host). `MultiplayerRace` orchestrates session + race rules and talks to the game only through a small adapter object and to the UI only through `onChange( view )`; `Lobby` renders those views. `Opponents` turns other players into kinematic crashcat bodies you bump into. `main.js` builds the adapter and calls `multiplayer.update( dt )` before each physics step.

**Tech Stack:** Plain ES modules, three.js 0.185.1 and crashcat 0.0.3 via the existing import map, WebRTC (`RTCPeerConnection`, one ordered `RTCDataChannel`), `CompressionStream('deflate-raw')`, Node's built-in `node:test`, Playwright (not committed) for headless checks.

**Spec:** `docs/superpowers/specs/2026-09-24-p2p-multiplayer-design.md`

## Global Constraints

- Static files only — no bundler, no `package.json`, no committed `node_modules`; no signaling server, PeerJS or Firebase (browser-game stack).
- Pure modules (`js/net/Signal.js`, `js/net/Protocol.js`, `js/race/RaceState.js`, `js/race/Interpolate.js`, `js/ui/strings.js`, `js/race/MultiplayerRace.js`) must not import `three` or `crashcat`; `js/net/Session.js` uses only browser WebRTC APIs.
- Every inbound data-channel message goes through `Protocol.parseMessage` — never `eval`/`new Function`; player names only via `textContent`; names 1–16 characters.
- Limits: 2–4 players; laps 1–10 (default 3); messages ≤ 2048 chars except `setup` ≤ 16384; offer codes valid 10 minutes; state ~20 Hz; interpolation delay 100 ms; drop a peer after 20 invalid messages; `disconnected` > 5 s counts as leaving; hint after 20 s without connection; results 30 s after the winner; laps averaging over 40 world units/s rejected.
- Multiplayer laps never touch the single-player best-lap storage.
- `i18n.js` is copied **verbatim** from the browser-game stack (it uses `var`; that is the stack's own file — do not "fix" it).
- Code style = upstream mrdoob style: tabs, spaces inside parentheses/brackets, blank line after a block-opening `{` and before its `}`, `const`/`let`, no commented-out code. Test names `functionName_state_expectedBehavior`. Run all unit tests with `node --test test/*.test.mjs`.
- German UI text: standard German, address pronoun capitalised (`Du`, `Dein`), real umlauts.
- Commits: Conventional Commits with the two trailer lines shown in each commit step.
- Serve locally with `npx serve -l 3000 .` (repo `serve.json` disables clean URLs).

## Review Focus

1. **Host closes the tab mid-race** — guests return to single player with "The host left", other trucks disappear, no stuck countdown. → Task 8 test `hostLeaves_guestReturnsToSoloWithMessage`.
2. **Wrong code pasted** (an offer where an answer belongs, garbage, a Tschau Sepp `TS1.` code) — clear "Code invalid or expired" message, nothing thrown. → Task 8 tests `accept_wrongCode_showsCodeInvalid`, `join_garbageOffer_showsCodeInvalidAndStaysSolo`; Task 1 `decodeSignal_garbage_throwsSignalError`.
3. **Connection never opens** (strict NAT, company Wi-Fi) — hint after 20 s instead of silence. → Task 8 test `noConnectionAfterTwentySeconds_showsStrictNetworkHint`.
4. **Rematch / Back to lobby from the results screen** — back in the lobby without a render crash (the results view must tolerate `results: null`). → Task 8 test `raceToResults_thenRematch_returnsToLobbyWithoutError` + Appendix check `e2e`.
5. **Hostile or buggy peer** (NaN positions, teleports outside the track, oversized strings, spam) — dropped, then disconnected. → Task 2 `validate_malformedVariants_areRejected`, Task 6 Appendix check `p2p` (21 garbage messages → `close g2 invalid`).

## File Map

| File | Status | Responsibility |
|---|---|---|
| `js/net/Signal.js` | create | `KR1.` codes (deflate SDP), expiry, invite link build/parse |
| `js/net/Protocol.js` | create | Message validation, size limits, name cleaning |
| `js/race/RaceState.js` | create | Host race rules: slots, countdown, lap plausibility, order, results, rematch; `gridSlots` |
| `js/race/Interpolate.js` | create | State buffer + sampling for remote trucks |
| `js/ui/strings.js`, `i18n.js` | create | de/en strings; shared language toggle (verbatim from stack) |
| `js/net/Session.js` | create | WebRTC host/guest peers, relay helpers, drop counting, disconnects |
| `js/race/Opponents.js` | create | Remote truck model + name label + kinematic body |
| `js/race/MultiplayerRace.js` | create | Orchestrates everything through the game adapter; emits views |
| `js/ui/Lobby.js` | create | Multiplayer button, panel, countdown overlay, positions, results |
| `js/LapTimer.js` | modify | `onLap`, `persist`, `progress()`, `resetForRace()`, `startRace()`, `resetForSolo()` |
| `js/main.js`, `index.html` | modify | Game adapter, input hold, update hook; load `i18n.js` |
| `test/*.test.mjs` | create | Node tests per pure module + `MultiplayerRace` with a fake session |
| `test/harness/p2p.html`, `opponents.html`, `mp.html` | create | Pages for headless checks (also usable manually) |
| `CHANGELOG.md` | modify | Player-facing entry |

---

### Task 1: Signal codes and invite links

**Files:**
- Create: `js/net/Signal.js`
- Create: `test/signal.test.mjs`

**Interfaces:**
- Produces: `CODE_PREFIX = 'KR1.'`, `OFFER_TTL_MS`, `class SignalError`, `encodeSignal( { type, sdp } ) → Promise<string>`, `decodeSignal( code ) → Promise<{ type, sdp }>` (throws `SignalError`), `isOfferExpired( createdAt, now )`, `buildInviteLink( pageUrl, code )`, `parseInviteHash( hash ) → code | null`.

- [ ] **Step 1: Write the failing test**

Create `test/signal.test.mjs`:

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSignal, decodeSignal, SignalError, isOfferExpired, OFFER_TTL_MS, buildInviteLink, parseInviteHash } from '../js/net/Signal.js';

const SDP = 'v=0\r\no=- 4611731400430051336 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\n'.repeat( 8 );

test( 'encodeSignal_offer_roundTripsThroughDecode', async () => {

	const code = await encodeSignal( { type: 'offer', sdp: SDP } );
	assert.match( code, /^KR1\.[A-Za-z0-9_-]+$/ );
	assert.deepEqual( await decodeSignal( code ), { type: 'offer', sdp: SDP } );

} );

test( 'encodeSignal_longSdp_isCompressed', async () => {

	const code = await encodeSignal( { type: 'answer', sdp: SDP } );
	assert.ok( code.length < SDP.length / 2, `${ code.length } chars for ${ SDP.length } of SDP` );

} );

test( 'decodeSignal_codeWithLineBreaksAndSpaces_isAccepted', async () => {

	const code = await encodeSignal( { type: 'answer', sdp: SDP } );
	const pasted = '  ' + code.slice( 0, 20 ) + '\n' + code.slice( 20, 40 ) + ' \r\n' + code.slice( 40 ) + '\n';
	assert.equal( ( await decodeSignal( pasted ) ).type, 'answer' );

} );

test( 'decodeSignal_garbage_throwsSignalError', async () => {

	const validBody = ( await encodeSignal( { type: 'offer', sdp: SDP } ) ).slice( 4 );
	for ( const bad of [ '', null, 'hello', 'TS1.' + validBody, 'KR1.', 'KR1.!!!!', 'KR1.' + validBody.slice( 0, 30 ), 'KR1.' + 'A'.repeat( 30000 ) ] ) {

		await assert.rejects( decodeSignal( bad ), SignalError, String( bad ).slice( 0, 20 ) );

	}

} );

test( 'decodeSignal_validDeflateButWrongShape_throwsSignalError', async () => {

	const wrong = await encodeSignal( { type: 'rollback', sdp: SDP } );
	await assert.rejects( decodeSignal( wrong ), SignalError );

} );

test( 'isOfferExpired_afterTenMinutes_isTrue', () => {

	assert.equal( isOfferExpired( 0, OFFER_TTL_MS ), false );
	assert.equal( isOfferExpired( 0, OFFER_TTL_MS + 1 ), true );

} );

test( 'buildInviteLink_pageWithMapAndOsm_keepsQueryAndSetsHash', () => {

	const link = buildInviteLink( 'https://github.freaxnx01.ch/game-kit-racer/index.html?map=abc&osm=1,2,3,4,10,0,0#old', 'KR1.xyz' );
	assert.equal( link, 'https://github.freaxnx01.ch/game-kit-racer/index.html?map=abc&osm=1,2,3,4,10,0,0#join=KR1.xyz' );
	assert.equal( parseInviteHash( new URL( link ).hash ), 'KR1.xyz' );

} );

test( 'parseInviteHash_otherHashes_returnNull', () => {

	for ( const hash of [ '', '#', '#join=', '#join=TS1.abc', '#foo=KR1.abc', '#join=KR1.abc<script>', null ] ) {

		assert.equal( parseInviteHash( hash ), null, String( hash ) );

	}

} );
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/*.test.mjs`
Expected: FAIL — `Cannot find module …/js/net/Signal.js`

- [ ] **Step 3: Implement `js/net/Signal.js`**

Create `js/net/Signal.js`:

```js
// Signal.js — manual WebRTC signaling codes and invite links (no server). Pure; runs in browsers and Node.
//
// A code is 'KR1.' + base64url( deflate-raw( JSON { t: type, s: sdp } ) ) — the same idea as
// Tschau Sepp's TS1 codes. An invite link is the game URL (with ?map= and &osm=) plus '#join=<code>'.

export const CODE_PREFIX = 'KR1.';
export const OFFER_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_LENGTH = 20000;

export class SignalError extends Error {}

function toBase64url( bytes ) {

	let binary = '';
	for ( let i = 0; i < bytes.length; i ++ ) binary += String.fromCharCode( bytes[ i ] );
	return btoa( binary ).replace( /\+/g, '-' ).replace( /\//g, '_' ).replace( /=+$/, '' );

}

function fromBase64url( str ) {

	const binary = atob( str.replace( /-/g, '+' ).replace( /_/g, '/' ) );
	const bytes = new Uint8Array( binary.length );
	for ( let i = 0; i < binary.length; i ++ ) bytes[ i ] = binary.charCodeAt( i );
	return bytes;

}

async function pipe( bytes, stream ) {

	return new Uint8Array( await new Response( new Blob( [ bytes ] ).stream().pipeThrough( stream ) ).arrayBuffer() );

}

// { type: 'offer' | 'answer', sdp } → 'KR1.…'
export async function encodeSignal( { type, sdp } ) {

	const raw = new TextEncoder().encode( JSON.stringify( { t: type, s: sdp } ) );
	return CODE_PREFIX + toBase64url( await pipe( raw, new CompressionStream( 'deflate-raw' ) ) );

}

// 'KR1.…' (whitespace tolerated) → { type, sdp }; throws SignalError for anything else.
export async function decodeSignal( code ) {

	const clean = String( code ?? '' ).replace( /\s+/g, '' );
	if ( ! clean.startsWith( CODE_PREFIX ) || clean.length > MAX_CODE_LENGTH ) throw new SignalError( 'invalid code' );

	let parsed;

	try {

		const bytes = await pipe( fromBase64url( clean.slice( CODE_PREFIX.length ) ), new DecompressionStream( 'deflate-raw' ) );
		parsed = JSON.parse( new TextDecoder().decode( bytes ) );

	} catch {

		throw new SignalError( 'invalid code' );

	}

	if ( ( parsed?.t !== 'offer' && parsed?.t !== 'answer' ) || typeof parsed.s !== 'string' ) throw new SignalError( 'invalid code' );
	return { type: parsed.t, sdp: parsed.s };

}

export function isOfferExpired( createdAt, now ) {

	return now - createdAt > OFFER_TTL_MS;

}

// Current page URL (keeps ?map= and &osm=, drops any old hash) + '#join=<code>'.
export function buildInviteLink( pageUrl, code ) {

	const url = new URL( pageUrl );
	url.hash = 'join=' + code;
	return url.href;

}

// location.hash → the offer code, or null when the page was not opened from an invite.
export function parseInviteHash( hash ) {

	const match = /^#?join=(KR1\.[A-Za-z0-9_-]+)$/.exec( String( hash ?? '' ) );
	return match ? match[ 1 ] : null;

}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/*.test.mjs`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add js/net/Signal.js test/signal.test.mjs
git commit -F - <<'MSG'
feat(multiplayer): signaling codes and invite links

KR1. codes carry a deflate-compressed SDP; invite links add #join=<code> to the
track URL.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

---

### Task 2: Message protocol and validation

**Files:**
- Create: `js/net/Protocol.js`
- Create: `test/protocol.test.mjs`

**Interfaces:**
- Produces: `MAX_MESSAGE_CHARS = 2048`, `MAX_SETUP_CHARS = 16384`, `MAX_NAME = 16`, `MAX_PLAYERS = 4`, `MAX_LAPS = 10`, `cleanName( name ) → string | null`, `validate( msg, bounds ) → boolean`, `parseMessage( text, bounds ) → msg | null`; `bounds = { minX, maxX, minZ, maxZ }` (world units).

- [ ] **Step 1: Write the failing test**

Create `test/protocol.test.mjs`:

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, parseMessage, cleanName, MAX_MESSAGE_CHARS } from '../js/net/Protocol.js';

const BOUNDS = { minX: - 50, maxX: 50, minZ: - 50, maxZ: 50 };

const VALID = {
	hello: { type: 'hello', name: 'Speedy' },
	roster: { type: 'roster', you: 'g1', players: [ { id: 'h', name: 'Ana', slot: 0, connected: true }, { id: 'g1', name: 'Bo', slot: 1, connected: false } ] },
	setup: { type: 'setup', map: 'fYYNfoYBf4YB', osm: '47.548,7.98,47.556,7.995,10,-1,-3', laps: 3, startIn: 3000 },
	ping: { type: 'ping', t: 1234.5 },
	pong: { type: 'pong', t: 1234.5 },
	state: { type: 'state', id: 'g2', p: [ 1, 0.5, - 3 ], q: [ 0, 0.7071, 0, 0.7071 ], v: [ 3, 0, - 1 ], lap: 2, progress: 0.4 },
	lap: { type: 'lap', lap: 1, time: 31.2 },
	finish: { type: 'finish', total: 95.4, best: 30.9 },
	results: { type: 'results', rows: [ { id: 'h', name: 'Ana', place: 1, total: 95.4, best: 30.9 }, { id: 'g1', name: 'Bo', place: 2, total: null, best: null } ] },
	rematch: { type: 'rematch' },
	leave: { type: 'leave', id: 'g3' },
};

test( 'validate_everyMessageType_acceptsWellFormed', () => {

	for ( const [ type, msg ] of Object.entries( VALID ) ) assert.equal( validate( msg, BOUNDS ), true, type );
	assert.equal( validate( { ...VALID.setup, osm: null }, BOUNDS ), true, 'setup without osm' );

} );

test( 'validate_malformedVariants_areRejected', () => {

	const bad = [
		null, 42, 'hello', [], {}, { type: 'nope' }, { type: 'constructor' }, { type: '__proto__' },
		{ ...VALID.hello, name: '' }, { ...VALID.hello, name: 'x'.repeat( 17 ) }, { ...VALID.hello, name: ' padded ' }, { ...VALID.hello, name: 7 },
		{ ...VALID.roster, you: 'G1!' }, { ...VALID.roster, players: new Array( 5 ).fill( VALID.roster.players[ 0 ] ) },
		{ ...VALID.roster, players: [ { ...VALID.roster.players[ 0 ], slot: 4 } ] },
		{ ...VALID.setup, map: 'abc<script>' }, { ...VALID.setup, laps: 0 }, { ...VALID.setup, laps: 11 }, { ...VALID.setup, startIn: - 1 },
		{ ...VALID.setup, osm: 'javascript:alert(1)' },
		{ ...VALID.ping, t: 'now' }, { ...VALID.pong, t: NaN },
		{ ...VALID.state, p: [ 1, 0.5 ] }, { ...VALID.state, p: [ 999, 0.5, 0 ] }, { ...VALID.state, p: [ 0, 99, 0 ] },
		{ ...VALID.state, q: [ 0, 2, 0, 0 ] }, { ...VALID.state, v: [ 500, 0, 0 ] }, { ...VALID.state, v: [ NaN, 0, 0 ] },
		{ ...VALID.state, progress: 1.5 }, { ...VALID.state, lap: 1.5 }, { ...VALID.state, id: '' },
		{ ...VALID.lap, lap: 0 }, { ...VALID.lap, time: 0 }, { ...VALID.lap, time: Infinity },
		{ ...VALID.finish, best: - 1 },
		{ ...VALID.results, rows: [ { ...VALID.results.rows[ 0 ], place: 0 } ] }, { ...VALID.results, rows: 'x' },
		{ ...VALID.leave, id: 'no spaces' },
	];
	bad.forEach( ( msg, i ) => assert.equal( validate( msg, BOUNDS ), false, `#${ i } ${ JSON.stringify( msg )?.slice( 0, 60 ) }` ) );

} );

test( 'parseMessage_invalidJsonOrOversized_returnsNull', () => {

	assert.equal( parseMessage( '{not json', BOUNDS ), null );
	assert.equal( parseMessage( 42, BOUNDS ), null );
	assert.equal( parseMessage( JSON.stringify( { type: 'hello', name: 'Bo', pad: 'x'.repeat( MAX_MESSAGE_CHARS ) } ), BOUNDS ), null );
	assert.deepEqual( parseMessage( JSON.stringify( VALID.lap ), BOUNDS ), VALID.lap );

} );

test( 'parseMessage_largeSetup_isAllowedUpToItsOwnLimit', () => {

	const big = { ...VALID.setup, map: 'A'.repeat( 6000 ) };
	assert.deepEqual( parseMessage( JSON.stringify( big ), BOUNDS ), big );
	assert.equal( parseMessage( JSON.stringify( { ...big, map: 'A'.repeat( 17000 ) } ), BOUNDS ), null );

} );

test( 'cleanName_controlCharactersAndSpaces_areStripped', () => {

	assert.equal( cleanName( '  Bo\u0007\n ' ), 'Bo' );
	assert.equal( cleanName( '   ' ), null );
	assert.equal( cleanName( 'Zoë Müller' ), 'Zoë Müller' );

} );
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/*.test.mjs`
Expected: FAIL — `Cannot find module …/js/net/Protocol.js`

- [ ] **Step 3: Implement `js/net/Protocol.js`**

Create `js/net/Protocol.js`:

```js
// Protocol.js — multiplayer messages and the validator every inbound message must pass. Pure.
//
// Messages are JSON objects with a `type`. Anything that fails validation is dropped by the caller
// (Session counts drops and disconnects a peer after too many). Unknown extra fields are ignored.

export const MAX_MESSAGE_CHARS = 2048;
export const MAX_SETUP_CHARS = 16384;   // setup carries the ?map= string, up to ~1500 cells
export const MAX_NAME = 16;
export const MAX_PLAYERS = 4;
export const MAX_LAPS = 10;
const MAX_SPEED = 100;                  // world units per second, far above anything the truck reaches
const MAX_TIME = 36000;                 // seconds

const isInt = ( v, min, max ) => Number.isInteger( v ) && v >= min && v <= max;
const isNum = ( v, min, max ) => typeof v === 'number' && Number.isFinite( v ) && v >= min && v <= max;
const isStr = ( v, min, max ) => typeof v === 'string' && v.length >= min && v.length <= max;
const isId = ( v ) => typeof v === 'string' && /^[a-z0-9]{1,8}$/.test( v );
const isVec = ( v, n, limit ) => Array.isArray( v ) && v.length === n && v.every( ( x ) => isNum( x, - limit, limit ) );

// Trimmed, control characters removed, 1–16 characters — or null.
export function cleanName( name ) {

	if ( typeof name !== 'string' ) return null;
	const clean = name.replace( /[\u0000-\u001f\u007f]/g, '' ).trim();
	return clean.length >= 1 && clean.length <= MAX_NAME ? clean : null;

}

function inBounds( p, bounds ) {

	return p[ 0 ] >= bounds.minX && p[ 0 ] <= bounds.maxX && p[ 2 ] >= bounds.minZ && p[ 2 ] <= bounds.maxZ && Math.abs( p[ 1 ] ) <= 50;

}

const VALIDATORS = {

	hello: ( m ) => cleanName( m.name ) === m.name,
	roster: ( m ) => isId( m.you ) && Array.isArray( m.players ) && m.players.length <= MAX_PLAYERS &&
		m.players.every( ( p ) => isId( p.id ) && cleanName( p.name ) === p.name && isInt( p.slot, 0, MAX_PLAYERS - 1 ) && typeof p.connected === 'boolean' ),
	setup: ( m ) => isStr( m.map, 4, MAX_SETUP_CHARS - 200 ) && /^[A-Za-z0-9_-]+$/.test( m.map ) &&
		( m.osm === null || ( isStr( m.osm, 13, 120 ) && /^[-0-9.,]+$/.test( m.osm ) ) ) &&
		isInt( m.laps, 1, MAX_LAPS ) && isInt( m.startIn, 0, 10000 ),
	ping: ( m ) => isNum( m.t, 0, Number.MAX_SAFE_INTEGER ),
	pong: ( m ) => isNum( m.t, 0, Number.MAX_SAFE_INTEGER ),
	state: ( m, bounds ) => isId( m.id ) && isVec( m.p, 3, 1e6 ) && inBounds( m.p, bounds ) && isVec( m.q, 4, 1.01 ) &&
		isVec( m.v, 3, MAX_SPEED ) && isInt( m.lap, 0, MAX_LAPS + 1 ) && isNum( m.progress, 0, 1 ),
	lap: ( m ) => isInt( m.lap, 1, MAX_LAPS ) && isNum( m.time, 0.001, MAX_TIME ),
	finish: ( m ) => isNum( m.total, 0.001, MAX_TIME ) && isNum( m.best, 0.001, MAX_TIME ),
	results: ( m ) => Array.isArray( m.rows ) && m.rows.length <= MAX_PLAYERS && m.rows.every( ( r ) => isId( r.id ) &&
		cleanName( r.name ) === r.name && isInt( r.place, 1, MAX_PLAYERS ) &&
		( r.total === null || isNum( r.total, 0.001, MAX_TIME ) ) && ( r.best === null || isNum( r.best, 0.001, MAX_TIME ) ) ),
	rematch: () => true,
	leave: ( m ) => isId( m.id ),

};

// Is this object a well-formed message? bounds = { minX, maxX, minZ, maxZ } in world units (for `state`).
export function validate( msg, bounds ) {

	if ( msg === null || typeof msg !== 'object' || Array.isArray( msg ) ) return false;
	const check = Object.hasOwn( VALIDATORS, msg.type ) ? VALIDATORS[ msg.type ] : null;
	if ( ! check ) return false;

	try {

		return check( msg, bounds ) === true;

	} catch {

		return false;

	}

}

// Raw data-channel text → validated message, or null.
export function parseMessage( text, bounds ) {

	if ( typeof text !== 'string' || text.length > MAX_SETUP_CHARS ) return null;

	let msg;

	try {

		msg = JSON.parse( text );

	} catch {

		return null;

	}

	if ( text.length > MAX_MESSAGE_CHARS && msg?.type !== 'setup' ) return null;
	return validate( msg, bounds ) ? msg : null;

}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/*.test.mjs`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add js/net/Protocol.js test/protocol.test.mjs
git commit -F - <<'MSG'
feat(multiplayer): validate every network message

Typed messages with range and size checks; anything malformed is dropped.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

---

### Task 3: Race rules (host authority) and grid slots

**Files:**
- Create: `js/race/RaceState.js`
- Create: `test/race-state.test.mjs`

**Interfaces:**
- Consumes: `MAX_PLAYERS` (Task 2).
- Produces: `PHASE`, `COUNTDOWN_MS = 3000`, `RESULTS_GRACE_MS = 30000`, `MAX_AVG_SPEED = 40`, `minLapSeconds( cellCount, cellSize )`, `guestStartDelay( startIn, rttMs )`, `gridSlots( finishCell, cellSize, isTrackCell ) → [ { position: [x,y,z], angle } ×4 ]`, `class RaceState { constructor( { cellCount, cellSize, laps } ); addPlayer( id, name ) → slot | null; removePlayer( id ); setConnected( id, bool ); setLaps( n ); roster(); start( now ) → startAt | null; tick( now ) → phase; recordLap( id, lap, time ) → bool; recordFinish( id, now ) → bool; standings( progressById ); results( progressById ); rematch(); find( id ); phase; laps; players }`.

- [ ] **Step 1: Write the failing test**

Create `test/race-state.test.mjs`:

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RaceState, PHASE, COUNTDOWN_MS, RESULTS_GRACE_MS, minLapSeconds, guestStartDelay, gridSlots } from '../js/race/RaceState.js';

const CELL = 9.99 * 0.75;
const CELLS = 16;
const FAST = minLapSeconds( CELLS, CELL ); // fastest accepted lap

function race( players = [ 'h', 'g1' ], laps = 2 ) {

	const r = new RaceState( { cellCount: CELLS, cellSize: CELL, laps } );
	players.forEach( ( id ) => r.addPlayer( id, id.toUpperCase() ) );
	return r;

}

function driveLaps( r, id, laps, lapTime = FAST + 5 ) {

	for ( let lap = 1; lap <= laps; lap ++ ) assert.equal( r.recordLap( id, lap, lapTime ), true, `${ id } lap ${ lap }` );

}

test( 'addPlayer_joinOrder_assignsSlotsAndCapsAtFour', () => {

	const r = race( [] );
	assert.deepEqual( [ 'h', 'g1', 'g2', 'g3' ].map( ( id ) => r.addPlayer( id, id ) ), [ 0, 1, 2, 3 ] );
	assert.equal( r.addPlayer( 'g4', 'late' ), null );
	assert.equal( race().addPlayer( 'h', 'dup' ), null );

} );

test( 'removePlayer_inLobby_closesUpSlots', () => {

	const r = race( [ 'h', 'g1', 'g2' ] );
	r.removePlayer( 'g1' );
	assert.deepEqual( r.roster().map( ( p ) => [ p.id, p.slot ] ), [ [ 'h', 0 ], [ 'g2', 1 ] ] );

} );

test( 'start_needsTwoConnectedPlayers_thenCountsDownToRacing', () => {

	const solo = race( [ 'h' ] );
	assert.equal( solo.start( 0 ), null );

	const r = race();
	r.setConnected( 'g1', false );
	assert.equal( r.start( 0 ), null );
	r.setConnected( 'g1', true );
	assert.equal( r.start( 1000 ), 1000 + COUNTDOWN_MS );
	assert.equal( r.tick( 1000 + COUNTDOWN_MS - 1 ), PHASE.COUNTDOWN );
	assert.equal( r.tick( 1000 + COUNTDOWN_MS ), PHASE.RACING );
	assert.equal( r.addPlayer( 'g2', 'late' ), null, 'no joining mid-race' );

} );

test( 'guestStartDelay_subtractsHalfTheRoundTrip', () => {

	assert.equal( guestStartDelay( 3000, 120 ), 2940 );
	assert.equal( guestStartDelay( 50, 400 ), 0 );

} );

test( 'recordLap_outOfOrderTooFastOrNotRacing_isRejected', () => {

	const r = race();
	assert.equal( r.recordLap( 'h', 1, FAST + 1 ), false, 'lobby' );
	r.start( 0 ); r.tick( COUNTDOWN_MS );
	assert.equal( r.recordLap( 'h', 2, FAST + 1 ), false, 'skipped lap 1' );
	assert.equal( r.recordLap( 'h', 1, FAST - 0.1 ), false, 'too fast' );
	assert.equal( r.recordLap( 'nobody', 1, FAST + 1 ), false, 'unknown player' );
	assert.equal( r.recordLap( 'h', 1, FAST + 1 ), true );
	assert.equal( r.recordLap( 'h', 1, FAST + 1 ), false, 'duplicate' );

} );

test( 'recordFinish_beforeAllLaps_isRejected_afterwardsUsesAcceptedTimes', () => {

	const r = race();
	r.start( 0 ); r.tick( COUNTDOWN_MS );
	driveLaps( r, 'h', 1 );
	assert.equal( r.recordFinish( 'h', 10000 ), false );
	assert.equal( r.recordLap( 'h', 2, FAST + 2 ), true );
	assert.equal( r.recordFinish( 'h', 10000 ), true );
	assert.deepEqual( r.results()[ 0 ], { id: 'h', name: 'H', place: 1, total: 2 * FAST + 7, best: FAST + 2 } );

} );

test( 'tick_everyoneFinished_showsResultsInTimeOrder', () => {

	const r = race( [ 'h', 'g1', 'g2' ] );
	r.start( 0 ); r.tick( COUNTDOWN_MS );
	driveLaps( r, 'g2', 2, FAST + 1 ); r.recordFinish( 'g2', 5000 );
	driveLaps( r, 'h', 2, FAST + 3 ); r.recordFinish( 'h', 6000 );
	assert.equal( r.tick( 6000 ), PHASE.RACING );
	driveLaps( r, 'g1', 2, FAST + 2 ); r.recordFinish( 'g1', 7000 );
	assert.equal( r.tick( 7000 ), PHASE.RESULTS );
	assert.deepEqual( r.results().map( ( row ) => [ row.id, row.place ] ), [ [ 'g2', 1 ], [ 'g1', 2 ], [ 'h', 3 ] ] );

} );

test( 'tick_thirtySecondsAfterWinner_endsRaceWithUnfinishedLast', () => {

	const r = race( [ 'h', 'g1', 'g2' ] );
	r.start( 0 ); r.tick( COUNTDOWN_MS );
	driveLaps( r, 'h', 2 ); r.recordFinish( 'h', 10000 );
	driveLaps( r, 'g1', 1 );
	assert.equal( r.tick( 10000 + RESULTS_GRACE_MS - 1 ), PHASE.RACING );
	assert.equal( r.tick( 10000 + RESULTS_GRACE_MS ), PHASE.RESULTS );
	const rows = r.results( new Map( [ [ 'g2', 0.5 ], [ 'g1', 0.1 ] ] ) );
	assert.deepEqual( rows.map( ( row ) => [ row.id, row.total === null ] ), [ [ 'h', false ], [ 'g1', true ], [ 'g2', true ] ] );

} );

test( 'removePlayer_midRace_marksLeftAndListsThemLast', () => {

	const r = race( [ 'h', 'g1', 'g2' ] );
	r.start( 0 ); r.tick( COUNTDOWN_MS );
	driveLaps( r, 'g1', 1 );
	r.removePlayer( 'g1' );
	assert.equal( r.recordLap( 'g1', 2, FAST + 1 ), false );
	assert.deepEqual( r.roster().map( ( p ) => p.id ), [ 'h', 'g2' ] );
	assert.equal( r.results().at( - 1 ).id, 'g1' );

} );

test( 'tick_onlyOnePlayerLeftAfterAFinish_endsRace', () => {

	const r = race( [ 'h', 'g1' ] );
	r.start( 0 ); r.tick( COUNTDOWN_MS );
	driveLaps( r, 'h', 2 ); r.recordFinish( 'h', 9000 );
	r.removePlayer( 'g1' );
	assert.equal( r.tick( 9001 ), PHASE.RESULTS );

} );

test( 'rematch_afterResults_resetsTimesKeepsPlayers', () => {

	const r = race( [ 'h', 'g1', 'g2' ] );
	r.start( 0 ); r.tick( COUNTDOWN_MS );
	r.removePlayer( 'g1' );
	driveLaps( r, 'h', 2 ); r.recordFinish( 'h', 9000 );
	r.rematch();
	assert.equal( r.phase, PHASE.LOBBY );
	assert.deepEqual( r.roster().map( ( p ) => [ p.id, p.slot ] ), [ [ 'h', 0 ], [ 'g2', 1 ] ] );
	assert.equal( r.results()[ 0 ].total, null );

} );

test( 'gridSlots_finishFacingSouth_placesTwoRowsBehindTheLine', () => {

	const finish = [ 0, 0, 'track-finish', 0 ]; // orient 0 → driving towards +z
	const slots = gridSlots( finish, 10, ( gx, gz ) => gx === 0 && gz === - 1 );
	assert.deepEqual( slots.map( ( s ) => s.position.map( ( v ) => + v.toFixed( 2 ) ) ), [
		[ 2.8, 0.5, 5 ], [ 7.2, 0.5, 5 ], [ 2.8, 0.5, - 5 ], [ 7.2, 0.5, - 5 ],
	] );
	assert.ok( slots.every( ( s ) => s.angle === 0 ) );

} );

test( 'gridSlots_noTrackBehind_keepsSecondRowOnTheFinishTile', () => {

	const slots = gridSlots( [ 3, 3, 'track-finish', 16 ], 10, () => false ); // facing +x
	for ( const { position: [ x, , z ] } of slots ) {

		assert.ok( x >= 30 && x <= 40 && z >= 30 && z <= 40, `${ x },${ z } off the finish tile` );

	}

} );
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/*.test.mjs`
Expected: FAIL — `Cannot find module …/js/race/RaceState.js`

- [ ] **Step 3: Implement `js/race/RaceState.js`**

Create `js/race/RaceState.js`:

```js
// RaceState.js — the host's authoritative race: roster, grid slots, countdown, laps, finishing order.
// Pure (no DOM, no three.js); time is always passed in as `now` in milliseconds.

import { MAX_PLAYERS } from '../net/Protocol.js';

export const PHASE = { LOBBY: 'lobby', COUNTDOWN: 'countdown', RACING: 'racing', RESULTS: 'results' };
export const COUNTDOWN_MS = 3000;
export const RESULTS_GRACE_MS = 30000;
export const MAX_AVG_SPEED = 40; // world units/s — about three times the fastest lap anyone drives

const ORIENT_DEG = { 0: 0, 10: 180, 16: 90, 22: 270 }; // same table as Track.js

// Fastest believable lap for a track of cellCount cells.
export function minLapSeconds( cellCount, cellSize ) {

	return cellCount * cellSize / MAX_AVG_SPEED;

}

// A guest hears "GO in startIn ms" about half a round trip late.
export function guestStartDelay( startIn, rttMs ) {

	return Math.max( 0, startIn - rttMs / 2 );

}

// Four grid positions around the finish cell [gx, gz, 'track-finish', orient], facing the driving
// direction: slots 0/1 on the finish tile, 2/3 one tile behind (or at the back of the finish tile when
// the tile behind is not track). isTrackCell( gx, gz ) says whether a cell holds a track piece.
export function gridSlots( finishCell, cellSize, isTrackCell ) {

	const [ gx, gz, , orient ] = finishCell;
	const angle = ( ORIENT_DEG[ orient ] ?? 0 ) * Math.PI / 180;
	const fx = Math.sin( angle ), fz = Math.cos( angle );
	const rx = fz, rz = - fx;
	const cx = ( gx + 0.5 ) * cellSize, cz = ( gz + 0.5 ) * cellSize;
	const side = cellSize * 0.22;
	const back = isTrackCell( gx - Math.round( fx ), gz - Math.round( fz ) ) ? cellSize : cellSize * 0.35;

	return [ [ - 1, 0 ], [ 1, 0 ], [ - 1, back ], [ 1, back ] ].map( ( [ s, b ] ) => ( {
		position: [ cx + rx * side * s - fx * b, 0.5, cz + rz * side * s - fz * b ],
		angle,
	} ) );

}

export class RaceState {

	constructor( { cellCount, cellSize, laps = 3 } ) {

		this.minLap = minLapSeconds( cellCount, cellSize );
		this.laps = laps;
		this.phase = PHASE.LOBBY;
		this.players = [];        // { id, name, slot, connected, left, laps, lapTimes, total, best }
		this.startAt = null;
		this.firstFinishAt = null;

	}

	// Adds a player in the lobby and returns their slot, or null when full, started, or the id is taken.
	addPlayer( id, name ) {

		if ( this.phase !== PHASE.LOBBY || this.players.length >= MAX_PLAYERS ) return null;
		if ( this.players.some( ( p ) => p.id === id ) ) return null;
		this.players.push( { id, name, slot: this.players.length, connected: true, left: false, ...freshRace() } );
		return this.players.length - 1;

	}

	// In the lobby the player is removed and slots close up; during a race they stay listed as left.
	removePlayer( id ) {

		if ( this.phase === PHASE.LOBBY ) {

			this.players = this.players.filter( ( p ) => p.id !== id );
			this.players.forEach( ( p, i ) => { p.slot = i; } );
			return;

		}

		const p = this.find( id );
		if ( p ) { p.left = true; p.connected = false; }

	}

	setConnected( id, connected ) {

		const p = this.find( id );
		if ( p ) p.connected = connected;

	}

	setLaps( laps ) {

		if ( this.phase === PHASE.LOBBY ) this.laps = laps;

	}

	roster() {

		return this.players.filter( ( p ) => ! p.left ).map( ( { id, name, slot, connected } ) => ( { id, name, slot, connected } ) );

	}

	// Lobby → countdown. Needs at least two connected players. Returns startAt, or null.
	start( now ) {

		if ( this.phase !== PHASE.LOBBY ) return null;
		if ( this.players.filter( ( p ) => p.connected ).length < 2 ) return null;
		this.phase = PHASE.COUNTDOWN;
		this.startAt = now + COUNTDOWN_MS;
		return this.startAt;

	}

	// Advances countdown → racing → results. Returns the current phase.
	tick( now ) {

		if ( this.phase === PHASE.COUNTDOWN && now >= this.startAt ) this.phase = PHASE.RACING;

		if ( this.phase === PHASE.RACING ) {

			const active = this.players.filter( ( p ) => ! p.left );
			const allDone = active.length > 0 && active.every( ( p ) => p.total !== null );
			const graceOver = this.firstFinishAt !== null && now - this.firstFinishAt >= RESULTS_GRACE_MS;
			if ( allDone || graceOver || active.length < 2 && this.firstFinishAt !== null ) this.phase = PHASE.RESULTS;

		}

		return this.phase;

	}

	// A lap report from a player. Rejected when not racing, out of order, or implausibly fast.
	recordLap( id, lap, time ) {

		const p = this.find( id );
		if ( ! p || p.left || this.phase !== PHASE.RACING ) return false;
		if ( lap !== p.laps + 1 || lap > this.laps || time < this.minLap ) return false;
		p.laps = lap;
		p.lapTimes.push( time );
		return true;

	}

	// Finish is accepted only after all laps were accepted; total and best come from the accepted laps.
	recordFinish( id, now ) {

		const p = this.find( id );
		if ( ! p || p.total !== null || p.laps !== this.laps ) return false;
		p.total = p.lapTimes.reduce( ( a, b ) => a + b, 0 );
		p.best = Math.min( ...p.lapTimes );
		if ( this.firstFinishAt === null ) this.firstFinishAt = now;
		return true;

	}

	// Live order: finished players by total time, then everyone else by laps and progress (0..1).
	standings( progressById ) {

		const key = ( p ) => p.laps + ( progressById.get( p.id ) ?? 0 );
		return this.players.filter( ( p ) => ! p.left ).slice().sort( ( a, b ) => {

			if ( a.total !== null || b.total !== null ) return ( a.total ?? Infinity ) - ( b.total ?? Infinity );
			return key( b ) - key( a );

		} ).map( ( p ) => p.id );

	}

	// Result rows in finishing order; players who did not finish get total/best null.
	results( progressById = new Map() ) {

		const order = this.standings( progressById );
		const left = this.players.filter( ( p ) => p.left ).map( ( p ) => p.id );
		return [ ...order, ...left ].map( ( id, i ) => {

			const p = this.find( id );
			return { id, name: p.name, place: i + 1, total: p.total, best: p.best };

		} );

	}

	// Same players (minus those who left), fresh race, back in the lobby.
	rematch() {

		this.players = this.players.filter( ( p ) => ! p.left );
		this.players.forEach( ( p, i ) => Object.assign( p, { slot: i }, freshRace() ) );
		this.phase = PHASE.LOBBY;
		this.startAt = null;
		this.firstFinishAt = null;

	}

	find( id ) {

		return this.players.find( ( p ) => p.id === id );

	}

}

function freshRace() {

	return { laps: 0, lapTimes: [], total: null, best: null };

}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/*.test.mjs`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add js/race/RaceState.js test/race-state.test.mjs
git commit -F - <<'MSG'
feat(multiplayer): race rules for the host

Slots, countdown, plausible laps, finishing order, 30 s grace, leaves, rematch,
and a four-car grid at the finish line.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

---

### Task 4: Interpolation buffer for remote trucks

**Files:**
- Create: `js/race/Interpolate.js`
- Create: `test/interpolate.test.mjs`

**Interfaces:**
- Produces: `RENDER_DELAY_MS = 100`, `MAX_EXTRAPOLATE_MS = 200`, `pushState( buffer, { t, p, q, v } )`, `sampleBuffer( buffer, t ) → { p, q } | null`.

- [ ] **Step 1: Write the failing test**

Create `test/interpolate.test.mjs`:

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushState, sampleBuffer, MAX_EXTRAPOLATE_MS } from '../js/race/Interpolate.js';

const Q0 = [ 0, 0, 0, 1 ];
const Q90 = [ 0, Math.SQRT1_2, 0, Math.SQRT1_2 ];
const state = ( t, x, q = Q0, vx = 0 ) => ( { t, p: [ x, 0.5, 0 ], q, v: [ vx, 0, 0 ] } );
const near = ( a, b, eps = 1e-9 ) => assert.ok( Math.abs( a - b ) < eps, `${ a } vs ${ b }` );

test( 'sampleBuffer_empty_returnsNull', () => {

	assert.equal( sampleBuffer( [], 0 ), null );

} );

test( 'sampleBuffer_betweenStates_blendsPositionAndRotation', () => {

	const buf = [];
	pushState( buf, state( 100, 10, Q90 ) );
	pushState( buf, state( 0, 0, Q0 ) ); // arrives out of order
	const s = sampleBuffer( buf, 50 );
	near( s.p[ 0 ], 5 );
	near( Math.hypot( ...s.q ), 1 );
	near( s.q[ 1 ], Math.sin( Math.PI / 8 ), 1e-3 );

} );

test( 'sampleBuffer_pastNewest_coastsButOnlyBriefly', () => {

	const buf = [];
	pushState( buf, state( 0, 0, Q0, 10 ) );
	near( sampleBuffer( buf, 100 ).p[ 0 ], 1 );
	near( sampleBuffer( buf, 5000 ).p[ 0 ], 10 * MAX_EXTRAPOLATE_MS / 1000 );

} );

test( 'sampleBuffer_beforeOldest_holdsOldest', () => {

	const buf = [];
	pushState( buf, state( 100, 3 ) );
	pushState( buf, state( 200, 4 ) );
	near( sampleBuffer( buf, 0 ).p[ 0 ], 3 );

} );

test( 'pushState_manyStates_keepsOnlyTheNewest', () => {

	const buf = [];
	for ( let i = 0; i < 50; i ++ ) pushState( buf, state( i, i ) );
	assert.equal( buf.length, 20 );
	assert.equal( buf[ 0 ].t, 30 );

} );
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/*.test.mjs`
Expected: FAIL — `Cannot find module …/js/race/Interpolate.js`

- [ ] **Step 3: Implement `js/race/Interpolate.js`**

Create `js/race/Interpolate.js`:

```js
// Interpolate.js — where to draw a remote truck: a short buffer of timestamped states, sampled a little
// in the past so there is (almost) always a newer state to blend towards. Pure.

export const RENDER_DELAY_MS = 100;
export const MAX_EXTRAPOLATE_MS = 200;
const BUFFER_SIZE = 20;

// Keeps the newest BUFFER_SIZE states, ordered by arrival time. state = { t, p: [x,y,z], q: [x,y,z,w], v: [x,y,z] }.
export function pushState( buffer, state ) {

	buffer.push( state );
	buffer.sort( ( a, b ) => a.t - b.t );
	if ( buffer.length > BUFFER_SIZE ) buffer.splice( 0, buffer.length - BUFFER_SIZE );

}

// Pose at time t: blend between the two states around t; past the newest state, coast along its
// velocity for at most MAX_EXTRAPOLATE_MS; before the oldest, hold the oldest. null when empty.
export function sampleBuffer( buffer, t ) {

	if ( buffer.length === 0 ) return null;

	const first = buffer[ 0 ], last = buffer[ buffer.length - 1 ];
	if ( t <= first.t ) return { p: first.p.slice(), q: first.q.slice() };

	if ( t >= last.t ) {

		const dt = Math.min( t - last.t, MAX_EXTRAPOLATE_MS ) / 1000;
		return { p: last.p.map( ( x, i ) => x + last.v[ i ] * dt ), q: last.q.slice() };

	}

	let i = buffer.length - 2;
	while ( buffer[ i ].t > t ) i --;
	const a = buffer[ i ], b = buffer[ i + 1 ];
	const k = ( t - a.t ) / ( b.t - a.t || 1 );
	return { p: a.p.map( ( x, j ) => x + ( b.p[ j ] - x ) * k ), q: nlerp( a.q, b.q, k ) };

}

// Normalised lerp along the shorter arc — plenty for 50 ms apart.
function nlerp( a, b, k ) {

	const sign = a[ 0 ] * b[ 0 ] + a[ 1 ] * b[ 1 ] + a[ 2 ] * b[ 2 ] + a[ 3 ] * b[ 3 ] < 0 ? - 1 : 1;
	const q = a.map( ( x, i ) => x + ( sign * b[ i ] - x ) * k );
	const len = Math.hypot( ...q ) || 1;
	return q.map( ( x ) => x / len );

}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/*.test.mjs`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add js/race/Interpolate.js test/interpolate.test.mjs
git commit -F - <<'MSG'
feat(multiplayer): smooth remote truck motion

Buffered states sampled 100 ms in the past, brief coasting past the newest.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

---

### Task 5: de/en strings and the shared language toggle

**Files:**
- Create: `js/ui/strings.js`
- Create: `test/strings.test.mjs`
- Create: `i18n.js`

**Interfaces:**
- Consumes: `cleanName` (Task 2) in the test.
- Produces: `STRINGS = { en, de }` (keys `mp.*`), `FUNNY_NAMES`, `t( key, lang, vars ) → string`, `funnyName( random )`; `window.GG_LANG`, `window.ggSetLang( lang )`, event `gg-langchange` from `i18n.js`.

- [ ] **Step 1: Write the failing test**

Create `test/strings.test.mjs`:

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, t, funnyName, FUNNY_NAMES } from '../js/ui/strings.js';
import { cleanName } from '../js/net/Protocol.js';

test( 'STRINGS_everyKey_existsInBothLanguages', () => {

	assert.deepEqual( Object.keys( STRINGS.de ).sort(), Object.keys( STRINGS.en ).sort() );
	for ( const lang of [ 'en', 'de' ] ) for ( const [ k, v ] of Object.entries( STRINGS[ lang ] ) ) assert.ok( v.trim(), `${ lang } ${ k } empty` );

} );

test( 'STRINGS_placeholders_matchAcrossLanguages', () => {

	const holes = ( s ) => ( s.match( /\{\w+\}/g ) ?? [] ).sort().join();
	for ( const k of Object.keys( STRINGS.en ) ) assert.equal( holes( STRINGS.de[ k ] ), holes( STRINGS.en[ k ] ), k );

} );

test( 't_placeholdersAndFallbacks_work', () => {

	assert.equal( t( 'mp.lapOf', 'de', { lap: 2, laps: 3 } ), 'Runde 2/3' );
	assert.equal( t( 'mp.lapOf', 'fr', { lap: 2, laps: 3 } ), 'Lap 2/3' );
	assert.equal( t( 'mp.nope', 'en' ), 'mp.nope' );
	assert.equal( t( 'mp.playerLeft', 'en' ), '{name} left' );

} );

test( 'funnyName_everyDefault_isAValidPlayerName', () => {

	for ( const name of FUNNY_NAMES ) assert.equal( cleanName( name ), name );
	assert.equal( funnyName( () => 0 ), FUNNY_NAMES[ 0 ] );

} );
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/*.test.mjs`
Expected: FAIL — `Cannot find module …/js/ui/strings.js`

- [ ] **Step 3: Implement `js/ui/strings.js`**

Create `js/ui/strings.js`:

```js
// strings.js — de/en text for the multiplayer UI. Pure. The language itself comes from i18n.js
// (window.GG_LANG, shared across all games on github.freaxnx01.ch).

export const STRINGS = {

	en: {
		'mp.button': 'Multiplayer',
		'mp.name': 'Your name',
		'mp.create': 'Create race',
		'mp.join': 'Join race',
		'mp.laps': 'Laps',
		'mp.invite': 'Invite a player',
		'mp.copyLink': 'Copy invite link',
		'mp.copyCode': 'Copy code',
		'mp.copied': 'Copied',
		'mp.expiresIn': 'Expires in {time}',
		'mp.expired': 'Expired — create a new invite',
		'mp.pasteAnswer': 'Paste the answer code',
		'mp.connect': 'Connect',
		'mp.pasteOffer': 'Paste the invite code',
		'mp.createAnswer': 'Create answer',
		'mp.sendAnswer': 'Send this answer code to the host:',
		'mp.waitingHost': 'Waiting for the host to start…',
		'mp.start': 'Start race',
		'mp.needTwo': 'At least two players needed',
		'mp.you': 'you',
		'mp.connected': 'connected',
		'mp.waiting': 'waiting',
		'mp.left': 'left',
		'mp.go': 'GO!',
		'mp.lapOf': 'Lap {lap}/{laps}',
		'mp.finished': 'Finished',
		'mp.results': 'Results',
		'mp.time': 'Time',
		'mp.best': 'Best lap',
		'mp.dnf': 'DNF',
		'mp.rematch': 'Rematch',
		'mp.backToLobby': 'Back to lobby',
		'mp.leave': 'Leave',
		'mp.leaveConfirm': 'Leave the race?',
		'mp.codeInvalid': 'Code invalid or expired — ask for a new one',
		'mp.hostLeft': 'The host left — back to single player',
		'mp.playerLeft': '{name} left',
		'mp.strictNetwork': 'Strict networks (e.g. company Wi-Fi) can block direct connections — try a phone hotspot.',
		'mp.connecting': 'Connecting…',
		'mp.close': 'Close',
		'mp.noFinish': 'This track has no finish line — pick another one to race.',
	},

	de: {
		'mp.button': 'Mehrspieler',
		'mp.name': 'Dein Name',
		'mp.create': 'Rennen erstellen',
		'mp.join': 'Rennen beitreten',
		'mp.laps': 'Runden',
		'mp.invite': 'Spieler einladen',
		'mp.copyLink': 'Einladungslink kopieren',
		'mp.copyCode': 'Code kopieren',
		'mp.copied': 'Kopiert',
		'mp.expiresIn': 'Läuft ab in {time}',
		'mp.expired': 'Abgelaufen — erstelle eine neue Einladung',
		'mp.pasteAnswer': 'Antwortcode einfügen',
		'mp.connect': 'Verbinden',
		'mp.pasteOffer': 'Einladungscode einfügen',
		'mp.createAnswer': 'Antwort erstellen',
		'mp.sendAnswer': 'Schick diesen Antwortcode dem Gastgeber:',
		'mp.waitingHost': 'Warten, bis der Gastgeber startet…',
		'mp.start': 'Rennen starten',
		'mp.needTwo': 'Mindestens zwei Spieler nötig',
		'mp.you': 'Du',
		'mp.connected': 'verbunden',
		'mp.waiting': 'wartet',
		'mp.left': 'weg',
		'mp.go': 'LOS!',
		'mp.lapOf': 'Runde {lap}/{laps}',
		'mp.finished': 'Im Ziel',
		'mp.results': 'Ergebnisse',
		'mp.time': 'Zeit',
		'mp.best': 'Beste Runde',
		'mp.dnf': 'Nicht im Ziel',
		'mp.rematch': 'Revanche',
		'mp.backToLobby': 'Zurück zur Lobby',
		'mp.leave': 'Verlassen',
		'mp.leaveConfirm': 'Rennen verlassen?',
		'mp.codeInvalid': 'Code ungültig oder abgelaufen — bitte um einen neuen',
		'mp.hostLeft': 'Der Gastgeber ist weg — zurück zum Einzelspieler',
		'mp.playerLeft': '{name} ist weg',
		'mp.strictNetwork': 'Strenge Netzwerke (z. B. Firmen-WLAN) können direkte Verbindungen blockieren — versuch es mit einem Handy-Hotspot.',
		'mp.connecting': 'Verbinde…',
		'mp.close': 'Schliessen',
		'mp.noFinish': 'Diese Strecke hat keine Ziellinie — wähl eine andere zum Rennen.',
	},

};

export const FUNNY_NAMES = [ 'Turbo Toast', 'Drift Dachs', 'Kurven Koala', 'Nitro Nudel', 'Speedy Spätzli', 'Bremsklotz Bob', 'Vollgas Vreni', 'Rallye Rösti' ];

// Text for key in lang (falls back to English, then to the key), with {placeholders} filled from vars.
export function t( key, lang, vars = {} ) {

	const text = STRINGS[ lang ]?.[ key ] ?? STRINGS.en[ key ] ?? key;
	return text.replace( /\{(\w+)\}/g, ( m, name ) => ( name in vars ? String( vars[ name ] ) : m ) );

}

export function funnyName( random = Math.random ) {

	return FUNNY_NAMES[ Math.floor( random() * FUNNY_NAMES.length ) ];

}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/*.test.mjs`
Expected: all pass.

- [ ] **Step 5: Add `i18n.js` (verbatim) and load it**

Copy the JavaScript block under "### `i18n.js` (copy verbatim into the game repo)" from `.ai/stacks/browser-game.md` into a new root file `i18n.js` — byte for byte. Then in `index.html` add, directly after `<script src="./version.js"></script>`:

```html
	<script src="./i18n.js"></script>
```

Check: open `http://localhost:3000/index.html` — the nav bar at the bottom now ends with `· EN` (or `· DE`); clicking it toggles.

- [ ] **Step 6: Commit**

```bash
git add js/ui/strings.js test/strings.test.mjs i18n.js index.html
git commit -F - <<'MSG'
feat(multiplayer): German and English texts

Multiplayer strings in de/en plus the shared gg-lang toggle from the
browser-game stack.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

---

### Task 6: WebRTC session (star through the host)

**Files:**
- Create: `js/net/Session.js`
- Create: `test/harness/p2p.html`

**Interfaces:**
- Consumes: Task 1 `encodeSignal`, `decodeSignal`, `isOfferExpired`, `SignalError`; Task 2 `parseMessage`.
- Produces: `ICE_SERVERS`, `class Session { constructor( { bounds, onMessage( peerId, msg ), onOpen( peerId ), onClose( peerId, reason ), iceServers, now } ); createOffer( peerId ) → code; acceptAnswer( peerId, code ); answerOffer( code ) → code (host becomes peer 'h'); send( peerId, msg ); broadcast( msg, exceptId ); openPeers() → ids; close( peerId, notify, reason ); closeAll(); bounds }`. `onOpen` fires exactly once per peer; `onClose` only for peers that had opened; `reason` ∈ `closed | failed | invalid`.

- [ ] **Step 1: Implement `js/net/Session.js`**

Create `js/net/Session.js`:

```js
// Session.js — WebRTC peers for a star-shaped race: the host holds one connection per guest, a guest
// holds one connection to the host. Signaling is manual (Signal.js codes); every inbound message
// passes Protocol.parseMessage before anyone sees it.

import { encodeSignal, decodeSignal, isOfferExpired, SignalError } from './Signal.js';
import { parseMessage } from './Protocol.js';

export const ICE_SERVERS = [ { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' } ];
const ICE_GATHER_MS = 3500;
const MAX_DROPS = 20;
const DISCONNECT_GRACE_MS = 5000;

// Resolves once ICE gathering is complete, or after ICE_GATHER_MS with whatever was gathered.
function iceGathered( pc ) {

	return new Promise( ( resolve ) => {

		if ( pc.iceGatheringState === 'complete' ) return resolve();
		const timer = setTimeout( resolve, ICE_GATHER_MS );
		pc.addEventListener( 'icegatheringstatechange', () => {

			if ( pc.iceGatheringState !== 'complete' ) return;
			clearTimeout( timer );
			resolve();

		} );

	} );

}

export class Session {

	// bounds: world rectangle for Protocol's `state` check (can be replaced later via session.bounds).
	// onMessage( peerId, msg ), onOpen( peerId ), onClose( peerId, reason ) — reason: 'closed' | 'failed' | 'invalid'.
	constructor( { bounds, onMessage, onOpen, onClose, iceServers = ICE_SERVERS, now = () => Date.now() } ) {

		this.bounds = bounds;
		this.onMessage = onMessage;
		this.onOpen = onOpen;
		this.onClose = onClose;
		this.iceServers = iceServers;
		this.now = now;
		this.peers = new Map(); // id → { pc, channel, drops, createdAt, closed, graceTimer }

	}

	// Host: a fresh offer code for the guest who will be known as peerId (replaces an older one).
	async createOffer( peerId ) {

		this.close( peerId, false );
		const pc = new RTCPeerConnection( { iceServers: this.iceServers } );
		const peer = this.track( peerId, pc );
		this.wire( peerId, peer, pc.createDataChannel( 'race', { ordered: true } ) );
		await pc.setLocalDescription( await pc.createOffer() );
		await iceGathered( pc );
		return encodeSignal( pc.localDescription );

	}

	// Host: apply the guest's answer. Throws SignalError('expired' | 'invalid code').
	async acceptAnswer( peerId, code ) {

		const peer = this.peers.get( peerId );
		if ( ! peer || peer.closed ) throw new SignalError( 'invalid code' );
		if ( isOfferExpired( peer.createdAt, this.now() ) ) throw new SignalError( 'expired' );
		const desc = await decodeSignal( code );
		if ( desc.type !== 'answer' ) throw new SignalError( 'invalid code' );
		await peer.pc.setRemoteDescription( desc );

	}

	// Guest: answer the host's offer code; the host becomes peer 'h'. Returns the answer code.
	async answerOffer( code ) {

		const desc = await decodeSignal( code );
		if ( desc.type !== 'offer' ) throw new SignalError( 'invalid code' );
		this.close( 'h', false );
		const pc = new RTCPeerConnection( { iceServers: this.iceServers } );
		const peer = this.track( 'h', pc );
		pc.addEventListener( 'datachannel', ( e ) => this.wire( 'h', peer, e.channel ) );
		await pc.setRemoteDescription( desc );
		await pc.setLocalDescription( await pc.createAnswer() );
		await iceGathered( pc );
		return encodeSignal( pc.localDescription );

	}

	send( peerId, msg ) {

		const channel = this.peers.get( peerId )?.channel;
		if ( channel?.readyState !== 'open' ) return;

		try {

			channel.send( JSON.stringify( msg ) );

		} catch {} // a closing channel throws; the close handler reports it

	}

	broadcast( msg, exceptId = null ) {

		for ( const id of this.peers.keys() ) if ( id !== exceptId ) this.send( id, msg );

	}

	openPeers() {

		return [ ...this.peers ].filter( ( [ , p ] ) => p.channel?.readyState === 'open' ).map( ( [ id ] ) => id );

	}

	// Close one peer; notify = false for silent replacement (e.g. a regenerated invite).
	close( peerId, notify = true, reason = 'closed' ) {

		const peer = this.peers.get( peerId );
		if ( ! peer ) return;
		this.peers.delete( peerId );
		peer.closed = true;
		clearTimeout( peer.graceTimer );
		try { peer.channel?.close(); } catch {}
		try { peer.pc.close(); } catch {}
		if ( notify && peer.opened ) this.onClose( peerId, reason );

	}

	closeAll() {

		for ( const id of [ ...this.peers.keys() ] ) this.close( id, false );

	}

	track( peerId, pc ) {

		const peer = { pc, channel: null, drops: 0, createdAt: this.now(), closed: false, opened: false, graceTimer: null };
		this.peers.set( peerId, peer );

		pc.addEventListener( 'connectionstatechange', () => {

			if ( peer.closed ) return;
			if ( pc.connectionState === 'failed' ) this.close( peerId, true, 'failed' );

			if ( pc.connectionState === 'disconnected' ) {

				clearTimeout( peer.graceTimer );
				peer.graceTimer = setTimeout( () => {

					if ( pc.connectionState === 'disconnected' ) this.close( peerId, true, 'failed' );

				}, DISCONNECT_GRACE_MS );

			}

		} );

		return peer;

	}

	wire( peerId, peer, channel ) {

		peer.channel = channel;

		// A received channel can already be open; either way onOpen fires exactly once per peer.
		const opened = () => {

			if ( peer.opened || peer.closed ) return;
			peer.opened = true;
			this.onOpen( peerId );

		};

		channel.addEventListener( 'open', opened );
		if ( channel.readyState === 'open' ) queueMicrotask( opened );

		channel.addEventListener( 'close', () => {

			if ( ! peer.closed ) this.close( peerId, true, 'closed' );

		} );

		channel.addEventListener( 'message', ( e ) => {

			const msg = parseMessage( e.data, this.bounds );

			if ( msg ) return this.onMessage( peerId, msg );
			if ( ++ peer.drops > MAX_DROPS ) this.close( peerId, true, 'invalid' );

		} );

	}

}
```

- [ ] **Step 2: Create the harness page**

Create `test/harness/p2p.html`:

```html
<!DOCTYPE html><html><body><pre id="log"></pre>
<script type="module">
// Headless check for Session.js: open as ?role=host or ?role=guest; the test driver copies codes between pages.
import { Session } from '../../js/net/Session.js';

const role = new URLSearchParams( location.search ).get( 'role' );
const log = ( line ) => { document.getElementById( 'log' ).textContent += line + '\n'; window.events.push( line ); };
window.events = [];
window.session = new Session( {
	bounds: { minX: - 100, maxX: 100, minZ: - 100, maxZ: 100 },
	onMessage: ( id, msg ) => log( `message ${ id } ${ msg.type }` ),
	onOpen: ( id ) => log( `open ${ id }` ),
	onClose: ( id, reason ) => log( `close ${ id } ${ reason }` ),
} );
window.role = role;
window.ready = true;
</script></body></html>
```

- [ ] **Step 3: Headless check (Appendix `p2p`)**

Expected:
- host events `["open g1","open g2","message g1 hello","close g2 invalid"]`, answer for an unknown peer → `invalid code`
- g1 `["open h","message h ping"]` (exactly one `open h`), g2 ends with `close h closed`
- `no page errors`; run it three times — it must be stable.

- [ ] **Step 4: Unit suite still green**

Run: `node --test test/*.test.mjs` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add js/net/Session.js test/harness/p2p.html
git commit -F - <<'MSG'
feat(multiplayer): WebRTC session between host and guests

One data channel per guest, validated messages, drop-counting, disconnect
grace; checked headless with a real three-page WebRTC star.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

---

### Task 7: Opponent trucks you can bump into

**Files:**
- Create: `js/race/Opponents.js`
- Create: `test/harness/opponents.html`

**Interfaces:**
- Consumes: Task 4 `pushState`, `sampleBuffer`, `RENDER_DELAY_MS`; crashcat `rigidBody.create`, `rigidBody.moveKinematic( body, position, quaternion, dt )`, `rigidBody.remove( world, body )`, `sphere`, `MotionType.KINEMATIC`; `world._OL_MOVING` as set in `main.js`; `createSphereBody` from `js/Physics.js` (harness only).
- Produces: `class Opponents { constructor( scene, world, models ); trucks: Map; add( id, name, index ); remove( id ); clear(); push( id, state, now ); update( dt, now ) }`.

- [ ] **Step 1: Implement `js/race/Opponents.js`**

Create `js/race/Opponents.js`:

```js
// Opponents.js — other players' trucks: a model plus a kinematic sphere body that follows their
// broadcast states, so your truck bumps into them. Reusable for ghost (#3) and CPU (#4) opponents.

import * as THREE from 'three';
import { rigidBody, sphere, MotionType } from 'crashcat';
import { pushState, sampleBuffer, RENDER_DELAY_MS } from './Interpolate.js';

const TRUCKS = [ 'vehicle-truck-green', 'vehicle-truck-purple', 'vehicle-truck-red' ];
const SPHERE_RADIUS = 0.5;  // same as the player's body (Physics.js createSphereBody)
const MODEL_OFFSET_Y = 0.5; // Vehicle.js puts the model half a unit below the sphere centre
const HIDDEN = [ 0, - 100, 0 ];

function nameSprite( name ) {

	const canvas = document.createElement( 'canvas' );
	canvas.width = 256;
	canvas.height = 64;
	const ctx = canvas.getContext( '2d' );
	ctx.font = '600 30px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillStyle = 'rgba(10,12,14,0.6)';
	const w = Math.min( 250, ctx.measureText( name ).width + 28 );
	ctx.beginPath();
	ctx.roundRect( 128 - w / 2, 10, w, 44, 22 );
	ctx.fill();
	ctx.fillStyle = '#fff';
	ctx.fillText( name, 128, 33 );

	const sprite = new THREE.Sprite( new THREE.SpriteMaterial( { map: new THREE.CanvasTexture( canvas ), depthTest: false } ) );
	sprite.scale.set( 2, 0.5, 1 );
	sprite.position.y = 1.6;
	return sprite;

}

export class Opponents {

	// models: the loaded GLB scenes by name (main.js `models`); world: the crashcat world.
	constructor( scene, world, models ) {

		this.scene = scene;
		this.world = world;
		this.models = models;
		this.trucks = new Map(); // id → { group, body, buffer }

	}

	// index picks the truck colour (0–2); re-adding an id replaces it.
	add( id, name, index ) {

		this.remove( id );
		const group = new THREE.Group();
		const src = this.models[ TRUCKS[ index % TRUCKS.length ] ];
		if ( src ) group.add( src.clone() );
		group.add( nameSprite( name ) );
		group.visible = false;
		this.scene.add( group );

		const body = rigidBody.create( this.world, {
			shape: sphere.create( { radius: SPHERE_RADIUS } ),
			motionType: MotionType.KINEMATIC,
			objectLayer: this.world._OL_MOVING,
			position: HIDDEN,
		} );

		this.trucks.set( id, { group, body, buffer: [] } );

	}

	remove( id ) {

		const truck = this.trucks.get( id );
		if ( ! truck ) return;
		this.scene.remove( truck.group );
		rigidBody.remove( this.world, truck.body );
		this.trucks.delete( id );

	}

	clear() {

		for ( const id of [ ...this.trucks.keys() ] ) this.remove( id );

	}

	// A validated `state` message received at local time now (ms).
	push( id, state, now ) {

		const truck = this.trucks.get( id );
		if ( truck ) pushState( truck.buffer, { t: now, p: state.p, q: state.q, v: state.v } );

	}

	// Call once per frame before the physics step: moves each body towards its interpolated pose.
	update( dt, now ) {

		for ( const truck of this.trucks.values() ) {

			const pose = sampleBuffer( truck.buffer, now - RENDER_DELAY_MS );
			if ( ! pose ) continue;

			if ( dt > 0 ) rigidBody.moveKinematic( truck.body, pose.p, pose.q, dt );
			truck.group.visible = true;
			truck.group.position.set( pose.p[ 0 ], pose.p[ 1 ] - MODEL_OFFSET_Y, pose.p[ 2 ] );
			truck.group.quaternion.set( pose.q[ 0 ], pose.q[ 1 ], pose.q[ 2 ], pose.q[ 3 ] );

		}

	}

}
```

- [ ] **Step 2: Create the harness page**

Create `test/harness/opponents.html`:

```html
<!DOCTYPE html><html><head>
<script type="importmap">{ "imports": {
	"three": "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js",
	"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/",
	"crashcat": "https://esm.sh/crashcat@0.0.3"
} }</script></head><body>
<script type="module">
// Headless physics check for Opponents.js: a remote truck driving into a resting player truck pushes it.
import * as THREE from 'three';
import { createWorldSettings, createWorld, addBroadphaseLayer, addObjectLayer, enableCollision, registerAll, updateWorld, rigidBody, box, MotionType } from 'crashcat';
import { createSphereBody } from '../../js/Physics.js';
import { Opponents } from '../../js/race/Opponents.js';

registerAll();
const settings = createWorldSettings();
settings.gravity = [ 0, - 9.81, 0 ];
const bplMoving = addBroadphaseLayer( settings ), bplStatic = addBroadphaseLayer( settings );
const olMoving = addObjectLayer( settings, bplMoving ), olStatic = addObjectLayer( settings, bplStatic );
enableCollision( settings, olMoving, olStatic );
enableCollision( settings, olMoving, olMoving );
const world = createWorld( settings );
world._OL_MOVING = olMoving;
world._OL_STATIC = olStatic;
rigidBody.create( world, { shape: box.create( { halfExtents: [ 50, 0.01, 50 ] } ), motionType: MotionType.STATIC, objectLayer: olStatic, position: [ 0, - 0.125, 0 ], friction: 5, restitution: 0 } );

const player = createSphereBody( world, [ 0, 0.5, 0 ] );
const scene = new THREE.Scene();
const opponents = new Opponents( scene, world, {} );
opponents.add( 'g1', 'Bo', 0 );

// Remote truck drives along +x from x = -3 at 6 units/s, straight through the player's spot.
const dt = 1 / 60;
let now = 0;
for ( let i = 0; i < 90; i ++ ) {

	now += dt * 1000;
	const x = - 3 + 6 * now / 1000;
	opponents.push( 'g1', { p: [ x, 0.5, 0.05 ], q: [ 0, 0, 0, 1 ], v: [ 6, 0, 0 ] }, now );
	opponents.update( dt, now );
	updateWorld( world, undefined, dt );

}

const truck = opponents.trucks.get( 'g1' );
window.result = {
	playerX: + player.position[ 0 ].toFixed( 2 ),
	opponentX: + truck.body.position[ 0 ].toFixed( 2 ),
	modelVisible: truck.group.visible,
	children: scene.children.length,
};
opponents.remove( 'g1' );
window.result.afterRemove = scene.children.length;
</script></body></html>
```

- [ ] **Step 3: Headless check (Appendix `opponents`)**

Expected:
- `playerX` > 3 (the resting player truck was shoved along +x), `opponentX` ≈ 5.4, `modelVisible: true`, `children: 1`, `afterRemove: 0`
- only a favicon 404 in the console.

- [ ] **Step 4: Unit suite still green**

Run: `node --test test/*.test.mjs` — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add js/race/Opponents.js test/harness/opponents.html
git commit -F - <<'MSG'
feat(multiplayer): solid opponent trucks

Remote players are kinematic spheres moved with moveKinematic, so they shove
your truck; tinted truck models with name labels.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

---

### Task 8: Race controller and lobby UI

**Files:**
- Create: `js/race/MultiplayerRace.js`, `js/ui/Lobby.js`, `test/multiplayer-race.test.mjs`, `test/harness/mp.html`

**Interfaces:**
- Consumes: Tasks 1–6 (`Session`, `buildInviteLink`, `OFFER_TTL_MS`, `parseInviteHash`, `RaceState`, `PHASE`, `guestStartDelay`, `MAX_LAPS`, `t`, `funnyName`).
- Produces:
  - `class MultiplayerRace { constructor( game, { onChange, now, SessionImpl } ); host( name, laps ); setLaps( n ); invite() → { peerId, code, link, expiresAt } | null; regenerate( peerId ); accept( peerId, code ) → bool; start(); rematch(); join( offerCode, name ) → answerCode | null; leave(); update( dt ); view() }`
  - The **game adapter** it expects: `{ trackCells, cellSize, pageUrl, mapParam, osmParam, lapTimer: { onLap, resetForRace(), startRace(), resetForSolo(), progress() }, opponents: { trucks: Map, add, remove, clear, push, update }, placeOnSlot( slot ), setHold( hold ), localState() → { p, q, v } }`
  - `view()` = `{ role: null|'host'|'guest', you, phase, laps, players, invites: [ { peerId, code, link, expiresAt, answered, secondsLeft } ], answerCode, countdown: null|'3'|'2'|'1'|'GO', positions: [ { id, name, you } ], finished, results, message: { key, vars } | null }`
  - `class Lobby { constructor( { canRace } ); bind( mp ); openJoin( offerCode ); render( view, force ) }` — DOM ids `#mp-button`, `#mp-panel`, `#mp-positions`, `#mp-countdown`.

- [ ] **Step 1: Write the failing test**

Create `test/multiplayer-race.test.mjs`:

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MultiplayerRace } from '../js/race/MultiplayerRace.js';
import { SignalError } from '../js/net/Signal.js';

const CELL = 9.99 * 0.75;

// Stand-in for Session: records what was sent, lets the test play the other side.
class FakeSession {

	constructor( handlers ) {

		Object.assign( this, handlers );
		this.sent = [];
		this.open = new Set();
		FakeSession.last = this;

	}

	async createOffer( id ) { return 'KR1.offer-' + id; }
	async acceptAnswer( id, code ) { if ( ! code.startsWith( 'KR1.answer' ) ) throw new SignalError( 'invalid code' ); }
	async answerOffer( code ) { if ( ! code.startsWith( 'KR1.offer' ) ) throw new SignalError( 'invalid code' ); return 'KR1.answer'; }
	send( id, msg ) { this.sent.push( { to: id, msg } ); }
	broadcast( msg, except = null ) { for ( const id of this.open ) if ( id !== except ) this.send( id, msg ); }
	openPeers() { return [ ...this.open ]; }
	close( id, notify = true ) { if ( this.open.delete( id ) && notify ) this.onClose( id, 'closed' ); }
	closeAll() { this.open.clear(); }
	// test helpers
	connect( id ) { this.open.add( id ); this.onOpen( id ); }
	deliver( from, msg ) { this.onMessage( from, msg ); }

}

function setup() {

	let time = 1000;
	const views = [];
	const cells = Array.from( { length: 16 }, ( _, i ) => [ i, 0, i === 0 ? 'track-finish' : 'track-straight', 16 ] );
	const game = {
		trackCells: cells, cellSize: CELL, pageUrl: 'https://example.test/game/index.html', mapParam: 'fYYN', osmParam: null,
		lapTimer: { onLap: null, resetForRace() {}, startRace() { this.started = true; }, resetForSolo() { this.solo = ( this.solo ?? 0 ) + 1; }, progress: () => 0.5 },
		opponents: { trucks: new Map(), add( id, name ) { this.trucks.set( id, name ); }, remove( id ) { this.trucks.delete( id ); }, clear() { this.trucks.clear(); }, push() {}, update() {} },
		placeOnSlot( slot ) { this.slot = slot; }, setHold( hold ) { this.hold = hold; },
		localState: () => ( { p: [ 1, 0.5, 1 ], q: [ 0, 0, 0, 1 ], v: [ 0, 0, 0 ] } ),
	};
	const mp = new MultiplayerRace( game, { onChange: ( v ) => views.push( v ), now: () => time, SessionImpl: FakeSession } );
	return { mp, game, views, tick: ( ms ) => { time += ms; mp.update( ms / 1000 ); }, session: () => FakeSession.last };

}

async function hostWithGuest() {

	const t = setup();
	t.mp.host( 'Ana', 1 );
	await t.mp.invite();
	await t.mp.accept( 'g1', 'KR1.answer' );
	t.session().connect( 'g1' );
	t.session().deliver( 'g1', { type: 'hello', name: 'Bo' } );
	return t;

}

test( 'invite_linkCarriesMapAndOsm_andOffer', async () => {

	const t = setup();
	t.game.osmParam = '47.548,7.98,47.556,7.995,10,-1,-3';
	t.mp.host( 'Ana', 3 );
	const invite = await t.mp.invite();
	assert.equal( invite.link, 'https://example.test/game/index.html?map=fYYN&osm=47.548,7.98,47.556,7.995,10,-1,-3#join=KR1.offer-g1' );

} );

test( 'accept_wrongCode_showsCodeInvalid', async () => {

	const t = setup();
	t.mp.host( 'Ana', 3 );
	await t.mp.invite();
	assert.equal( await t.mp.accept( 'g1', 'KR1.offer-g1' ), false );
	assert.equal( t.mp.view().message.key, 'mp.codeInvalid' );

} );

test( 'join_garbageOffer_showsCodeInvalidAndStaysSolo', async () => {

	const t = setup();
	assert.equal( await t.mp.join( 'hello?', 'Bo' ), null );
	assert.equal( t.mp.view().role, null );
	assert.equal( t.mp.view().message.key, 'mp.codeInvalid' );

} );

test( 'hello_fromGuest_addsTruckAndSendsRosterWithTheirId', async () => {

	const t = await hostWithGuest();
	assert.equal( t.game.opponents.trucks.get( 'g1' ), 'Bo' );
	const roster = t.session().sent.findLast( ( s ) => s.msg.type === 'roster' );
	assert.equal( roster.msg.you, 'g1' );
	assert.deepEqual( roster.msg.players.map( ( p ) => p.name ), [ 'Ana', 'Bo' ] );

} );

test( 'start_countsDownHoldsInputThenReleasesAtGo', async () => {

	const t = await hostWithGuest();
	t.mp.start();
	const setupMsg = t.session().sent.find( ( s ) => s.msg.type === 'setup' ).msg;
	assert.deepEqual( [ setupMsg.laps, setupMsg.startIn, setupMsg.map ], [ 1, 3000, 'fYYN' ] );
	assert.equal( t.game.hold, true );
	assert.equal( t.game.slot, 0 );
	t.tick( 2999 );
	assert.equal( t.mp.view().phase, 'countdown' );
	t.tick( 1 );
	assert.equal( t.mp.view().phase, 'racing' );
	assert.equal( t.game.hold, false );
	assert.equal( t.game.lapTimer.started, true );

} );

test( 'raceToResults_thenRematch_returnsToLobbyWithoutError', async () => {

	const t = await hostWithGuest();
	t.mp.start();
	t.tick( 3000 );
	t.session().deliver( 'g1', { type: 'lap', lap: 1, time: 20 } );
	t.game.lapTimer.onLap( 1, 25 );
	t.tick( 16 );
	assert.equal( t.mp.view().phase, 'results' );
	assert.deepEqual( t.mp.view().results.map( ( r ) => r.name ), [ 'Bo', 'Ana' ] );
	assert.ok( t.session().sent.some( ( s ) => s.msg.type === 'results' ) );

	t.mp.rematch();
	assert.equal( t.mp.view().phase, 'lobby' );
	assert.equal( t.mp.view().results, null );
	assert.ok( t.session().sent.some( ( s ) => s.msg.type === 'rematch' ) );

} );

test( 'guestLeavesMidRace_hostRemovesTruckAndSaysSo', async () => {

	const t = await hostWithGuest();
	t.mp.start();
	t.tick( 3000 );
	t.session().close( 'g1' );
	assert.equal( t.game.opponents.trucks.has( 'g1' ), false );
	assert.deepEqual( t.mp.view().message, { key: 'mp.playerLeft', vars: { name: 'Bo' } } );

} );

test( 'hostLeaves_guestReturnsToSoloWithMessage', async () => {

	const t = setup();
	await t.mp.join( 'KR1.offer-g1', 'Bo' );
	t.session().connect( 'h' );
	t.session().deliver( 'h', { type: 'roster', you: 'g1', players: [ { id: 'h', name: 'Ana', slot: 0, connected: true }, { id: 'g1', name: 'Bo', slot: 1, connected: true } ] } );
	assert.equal( t.game.opponents.trucks.get( 'h' ), 'Ana' );
	t.session().close( 'h' );
	assert.equal( t.mp.view().role, null );
	assert.equal( t.mp.view().message.key, 'mp.hostLeft' );
	assert.equal( t.game.opponents.trucks.size, 0 );

} );

test( 'guestSetup_startsCountdownOnItsSlotMinusHalfRtt', async () => {

	const t = setup();
	await t.mp.join( 'KR1.offer-g1', 'Bo' );
	t.session().connect( 'h' );
	t.session().deliver( 'h', { type: 'roster', you: 'g1', players: [ { id: 'h', name: 'Ana', slot: 0, connected: true }, { id: 'g1', name: 'Bo', slot: 1, connected: true } ] } );
	t.tick( 2000 ); // sends a ping
	const ping = t.session().sent.findLast( ( s ) => s.msg.type === 'ping' ).msg;
	t.tick( 200 );
	t.session().deliver( 'h', { type: 'pong', t: ping.t } );
	t.session().deliver( 'h', { type: 'setup', map: 'fYYN', osm: null, laps: 2, startIn: 3000 } );
	assert.equal( t.game.slot, 1 );
	t.tick( 2899 );
	assert.equal( t.mp.view().phase, 'countdown' );
	t.tick( 1 );
	assert.equal( t.mp.view().phase, 'racing' );

} );

test( 'noConnectionAfterTwentySeconds_showsStrictNetworkHint', async () => {

	const t = setup();
	t.mp.host( 'Ana', 3 );
	await t.mp.invite();
	await t.mp.accept( 'g1', 'KR1.answer' );
	t.tick( 20001 );
	assert.equal( t.mp.view().message.key, 'mp.strictNetwork' );

} );
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/*.test.mjs`
Expected: FAIL — `Cannot find module …/js/race/MultiplayerRace.js`

- [ ] **Step 3: Implement `js/race/MultiplayerRace.js`**

```js
// MultiplayerRace.js — runs a multiplayer race for the host or a guest: session, race rules, network
// messages and the local game. It talks to the game only through the `game` adapter (see main.js),
// and to the UI only through onChange( view ), so it can run headless with fakes.
//
// game = {
//   trackCells, cellSize, pageUrl, mapParam, osmParam,   // osmParam: raw &osm= string or null
//   lapTimer: { onLap, resetForRace(), startRace(), resetForSolo(), progress() },
//   opponents: { trucks: Map, add( id, name, index ), remove( id ), clear(), push( id, state, now ), update( dt, now ) },
//   placeOnSlot( slot ), setHold( hold ), localState() → { p, q, v },
// }

import { Session } from '../net/Session.js';
import { buildInviteLink, OFFER_TTL_MS } from '../net/Signal.js';
import { RaceState, PHASE, guestStartDelay } from './RaceState.js';

const STATE_INTERVAL_MS = 50;
const PING_INTERVAL_MS = 2000;
const CONNECT_HINT_MS = 20000;
const GO_SHOWN_MS = 1000;
const GUEST_IDS = [ 'g1', 'g2', 'g3' ];
const BOUNDS_MARGIN_CELLS = 3;

function worldBounds( cells, cellSize ) {

	const xs = cells.map( ( c ) => c[ 0 ] ), zs = cells.map( ( c ) => c[ 1 ] );
	const m = BOUNDS_MARGIN_CELLS;
	return {
		minX: ( Math.min( ...xs ) - m ) * cellSize, maxX: ( Math.max( ...xs ) + 1 + m ) * cellSize,
		minZ: ( Math.min( ...zs ) - m ) * cellSize, maxZ: ( Math.max( ...zs ) + 1 + m ) * cellSize,
	};

}

export class MultiplayerRace {

	constructor( game, { onChange, now = () => performance.now(), SessionImpl = Session } ) {

		this.game = game;
		this.onChange = onChange;
		this.now = now;
		this.SessionImpl = SessionImpl;
		this.teardown( null );
		game.lapTimer.onLap = ( lap, time ) => this.localLap( lap, time );

	}

	// ── Host ────────────────────────────────────────────────

	host( name, laps ) {

		this.teardown( 'host' );
		this.you = 'h';
		this.race = new RaceState( { cellCount: this.game.trackCells.length, cellSize: this.game.cellSize, laps } );
		this.race.addPlayer( 'h', name );
		this.laps = laps;
		this.session = this.newSession();
		this.changed();

	}

	setLaps( laps ) {

		if ( this.role !== 'host' ) return;
		this.race.setLaps( laps );
		this.laps = this.race.laps;
		this.changed();

	}

	// A fresh invite for the next free guest slot: { peerId, code, link, expiresAt }, or null when full.
	async invite() {

		const taken = new Set( [ ...this.race.players.map( ( p ) => p.id ), ...this.invites.map( ( i ) => i.peerId ) ] );
		const peerId = GUEST_IDS.find( ( id ) => ! taken.has( id ) );
		if ( ! peerId || this.race.phase !== PHASE.LOBBY ) return null;

		const code = await this.session.createOffer( peerId );
		const invite = { peerId, code, link: this.inviteLink( code ), expiresAt: this.now() + OFFER_TTL_MS, answered: null };
		this.invites.push( invite );
		this.changed();
		return invite;

	}

	async regenerate( peerId ) {

		this.invites = this.invites.filter( ( i ) => i.peerId !== peerId );
		this.session.close( peerId, false );
		return this.invite();

	}

	// Paste of a guest's answer. Resolves true, or false with view.message set.
	async accept( peerId, answerCode ) {

		try {

			await this.session.acceptAnswer( peerId, answerCode );
			const invite = this.invites.find( ( i ) => i.peerId === peerId );
			if ( invite ) invite.answered = this.now();
			this.say( 'mp.connecting' );
			return true;

		} catch {

			this.say( 'mp.codeInvalid' );
			return false;

		}

	}

	start() {

		if ( this.role !== 'host' ) return;
		const now = this.now();
		const startAt = this.race.start( now );
		if ( startAt === null ) return this.say( 'mp.needTwo' );

		for ( const id of this.session.openPeers() ) {

			this.session.send( id, { type: 'setup', map: this.game.mapParam, osm: this.game.osmParam, laps: this.race.laps, startIn: Math.round( startAt - now ) } );

		}

		this.beginCountdown( this.race.find( 'h' ).slot, startAt );

	}

	rematch() {

		if ( this.role !== 'host' || this.race.phase !== PHASE.RESULTS ) return;
		this.race.rematch();
		this.results = null;
		this.toLobby();
		this.session.broadcast( { type: 'rematch' } );
		this.broadcastRoster();

	}

	// ── Guest ───────────────────────────────────────────────

	// Offer code (from the invite link or pasted) → answer code for the host. null + message on failure.
	async join( offerCode, name ) {

		this.teardown( 'guest' );
		this.name = name;
		this.session = this.newSession();

		try {

			this.answerCode = await this.session.answerOffer( offerCode );
			this.answeredAt = this.now();
			this.changed();
			return this.answerCode;

		} catch {

			this.teardown( null );
			this.say( 'mp.codeInvalid' );
			return null;

		}

	}

	// ── Both ────────────────────────────────────────────────

	leave() {

		if ( this.session ) this.session.broadcast( { type: 'leave', id: this.you ?? 'h' } );
		this.teardown( null );
		this.changed();

	}

	// Once per frame, before the physics step.
	update( dt ) {

		if ( ! this.role ) return;
		const now = this.now();

		this.game.opponents.update( dt, now );
		this.tickCountdown( now );
		this.tickState( now );
		this.tickHints( now );

		if ( this.role === 'host' ) this.tickHost( now );
		if ( this.role === 'guest' && now - this.lastPing >= PING_INTERVAL_MS ) {

			this.lastPing = now;
			this.session.send( 'h', { type: 'ping', t: now } );

		}

		if ( now - this.lastRender >= 250 ) this.changed();

	}

	// Plain data for the UI.
	view() {

		const now = this.now();
		return {
			role: this.role,
			you: this.you,
			phase: this.phase,
			laps: this.laps,
			players: this.players(),
			invites: this.invites.map( ( i ) => ( { ...i, secondsLeft: Math.max( 0, Math.ceil( ( i.expiresAt - now ) / 1000 ) ) } ) ),
			answerCode: this.answerCode,
			countdown: this.countdownLabel( now ),
			positions: this.positions(),
			finished: this.finished,
			results: this.results,
			message: this.message,
		};

	}

	// ── Internals ───────────────────────────────────────────

	teardown( role ) {

		this.session?.closeAll();
		this.game.opponents.clear();
		this.game.setHold( false );
		this.game.lapTimer.resetForSolo();
		this.role = role;
		this.session = null;
		this.race = null;
		this.you = null;
		this.name = null;
		this.laps = 3;
		this.phase = PHASE.LOBBY;
		this.roster = [];
		this.invites = [];
		this.answerCode = null;
		this.answeredAt = null;
		this.goAt = null;
		this.remote = new Map();   // id → { lap, progress } from state messages
		this.lapsDone = 0;
		this.finished = false;
		this.results = null;
		this.message = null;
		this.rtt = 0;
		this.lastPing = - Infinity;
		this.lastState = - Infinity;
		this.lastRender = - Infinity;

	}

	newSession() {

		return new this.SessionImpl( {
			bounds: worldBounds( this.game.trackCells, this.game.cellSize ),
			onMessage: ( from, msg ) => this.receive( from, msg ),
			onOpen: ( id ) => this.opened( id ),
			onClose: ( id ) => this.closed( id ),
		} );

	}

	inviteLink( code ) {

		const url = new URL( this.game.pageUrl );
		url.search = '';
		url.searchParams.set( 'map', this.game.mapParam );
		if ( this.game.osmParam ) url.searchParams.set( 'osm', this.game.osmParam );
		return buildInviteLink( url.href.replace( /%2C/g, ',' ), code );

	}

	opened( id ) {

		if ( this.role === 'guest' ) this.session.send( 'h', { type: 'hello', name: this.name } );
		if ( this.role === 'host' ) this.invites = this.invites.filter( ( i ) => i.peerId !== id );
		this.message = null;
		this.changed();

	}

	closed( id ) {

		if ( this.role === 'guest' && id === 'h' ) {

			this.teardown( null );
			return this.say( 'mp.hostLeft' );

		}

		if ( this.role !== 'host' ) return;
		const player = this.race.find( id );
		this.race.removePlayer( id );
		this.game.opponents.remove( id );
		this.session.broadcast( { type: 'leave', id } );
		this.broadcastRoster();
		if ( player ) this.say( 'mp.playerLeft', { name: player.name } );

	}

	receive( from, msg ) {

		if ( this.role === 'host' ) return this.receiveAsHost( from, msg );
		if ( from === 'h' ) this.receiveAsGuest( msg );

	}

	receiveAsHost( from, msg ) {

		const now = this.now();

		switch ( msg.type ) {

			case 'hello': {

				const slot = this.race.addPlayer( from, msg.name );
				if ( slot === null ) return this.session.close( from, false );
				this.game.opponents.add( from, msg.name, slot );
				return this.broadcastRoster();

			}

			case 'state':
				if ( msg.id !== from ) return;
				this.remote.set( from, { lap: msg.lap, progress: msg.progress } );
				this.game.opponents.push( from, msg, now );
				return this.session.broadcast( msg, from );

			case 'lap':
				if ( this.race.recordLap( from, msg.lap, msg.time ) && msg.lap === this.race.laps ) this.race.recordFinish( from, now );
				return;

			case 'ping':
				return this.session.send( from, { type: 'pong', t: msg.t } );

			case 'leave':
				return this.session.close( from, true );

		}

	}

	receiveAsGuest( msg ) {

		const now = this.now();

		switch ( msg.type ) {

			case 'roster':
				this.you = msg.you;
				this.roster = msg.players;
				this.syncOpponents();
				return this.changed();

			case 'setup': {

				const me = this.roster.find( ( p ) => p.id === this.you );
				if ( ! me || msg.map !== this.game.mapParam ) return;
				this.laps = msg.laps;
				return this.beginCountdown( me.slot, now + guestStartDelay( msg.startIn, this.rtt ) );

			}

			case 'state':
				if ( msg.id === this.you ) return;
				this.remote.set( msg.id, { lap: msg.lap, progress: msg.progress } );
				return this.game.opponents.push( msg.id, msg, now );

			case 'pong':
				this.rtt = now - msg.t;
				return;

			case 'results':
				this.phase = PHASE.RESULTS;
				this.results = msg.rows;
				return this.changed();

			case 'rematch':
				this.results = null;
				return this.toLobby();

			case 'leave':
				this.game.opponents.remove( msg.id );
				this.remote.delete( msg.id );
				return;

		}

	}

	syncOpponents() {

		const others = this.roster.filter( ( p ) => p.id !== this.you );
		const trucks = this.game.opponents.trucks;
		for ( const id of [ ...trucks.keys() ] ) if ( ! others.some( ( p ) => p.id === id ) ) this.game.opponents.remove( id );
		for ( const p of others ) if ( ! trucks.has( p.id ) ) this.game.opponents.add( p.id, p.name, p.slot );

	}

	broadcastRoster() {

		const players = this.race.roster();
		for ( const id of this.session.openPeers() ) this.session.send( id, { type: 'roster', you: id, players } );
		this.changed();

	}

	beginCountdown( slot, goAt ) {

		this.phase = PHASE.COUNTDOWN;
		this.goAt = goAt;
		this.lapsDone = 0;
		this.finished = false;
		this.remote.clear();
		this.game.lapTimer.resetForRace();
		this.game.placeOnSlot( slot );
		this.game.setHold( true );
		this.changed();

	}

	toLobby() {

		this.phase = PHASE.LOBBY;
		this.goAt = null;
		this.game.setHold( false );
		this.game.lapTimer.resetForRace();
		this.changed();

	}

	tickCountdown( now ) {

		if ( this.phase !== PHASE.COUNTDOWN || now < this.goAt ) return;
		this.phase = PHASE.RACING;
		this.game.setHold( false );
		this.game.lapTimer.startRace();
		this.changed();

	}

	tickState( now ) {

		if ( this.phase !== PHASE.COUNTDOWN && this.phase !== PHASE.RACING ) return;
		if ( now - this.lastState < STATE_INTERVAL_MS ) return;
		this.lastState = now;

		const { p, q, v } = this.game.localState();
		const msg = { type: 'state', id: this.you, p, q, v, lap: this.lapsDone, progress: Math.min( 1, Math.max( 0, this.game.lapTimer.progress() ) ) };
		if ( this.role === 'host' ) this.session.broadcast( msg );
		else this.session.send( 'h', msg );

	}

	tickHost( now ) {

		const before = this.race.phase;
		const phase = this.race.tick( now );
		if ( phase !== PHASE.RESULTS || before === PHASE.RESULTS ) return;

		this.phase = PHASE.RESULTS;
		this.results = this.race.results( this.progressMap() );
		this.session.broadcast( { type: 'results', rows: this.results } );
		this.changed();

	}

	tickHints( now ) {

		const waiting = this.role === 'guest'
			? this.answeredAt !== null && ! this.you && now - this.answeredAt > CONNECT_HINT_MS
			: this.invites.some( ( i ) => i.answered !== null && now - i.answered > CONNECT_HINT_MS );
		if ( waiting && this.message?.key !== 'mp.strictNetwork' ) this.say( 'mp.strictNetwork' );

	}

	localLap( lap, time ) {

		if ( this.phase !== PHASE.RACING || this.finished ) return;
		this.lapsDone = lap;
		const last = lap === this.laps;
		if ( last ) this.finished = true;

		if ( this.role === 'host' ) {

			if ( this.race.recordLap( 'h', lap, time ) && last ) this.race.recordFinish( 'h', this.now() );

		} else {

			this.session.send( 'h', { type: 'lap', lap, time: Math.max( time, 0.001 ) } );

		}

		this.changed();

	}

	progressMap() {

		const map = new Map( [ ...this.remote ].map( ( [ id, r ] ) => [ id, r.progress ] ) );
		map.set( this.you, this.game.lapTimer.progress() );
		return map;

	}

	players() {

		if ( this.role === 'host' ) return this.race.roster();
		return this.roster;

	}

	// Live order for everyone: laps done, then progress through the current lap.
	positions() {

		if ( this.phase !== PHASE.RACING && this.phase !== PHASE.RESULTS ) return [];
		const score = ( id ) => id === this.you ? this.lapsDone + this.game.lapTimer.progress() : ( this.remote.get( id )?.lap ?? 0 ) + ( this.remote.get( id )?.progress ?? 0 );
		return this.players().slice().sort( ( a, b ) => score( b.id ) - score( a.id ) ).map( ( p ) => ( { id: p.id, name: p.name, you: p.id === this.you } ) );

	}

	countdownLabel( now ) {

		if ( this.goAt === null ) return null;
		if ( this.phase === PHASE.COUNTDOWN ) return String( Math.ceil( ( this.goAt - now ) / 1000 ) );
		if ( this.phase === PHASE.RACING && now - this.goAt < GO_SHOWN_MS ) return 'GO';
		return null;

	}

	say( key, vars = {} ) {

		this.message = key ? { key, vars } : null;
		this.changed();

	}

	changed() {

		this.lastRender = this.now();
		this.onChange?.( this.view() );

	}

}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/*.test.mjs` — Expected: all pass (10 new).

- [ ] **Step 5: Implement `js/ui/Lobby.js`**

```js
// Lobby.js — multiplayer UI: menu, host lobby with invites, guest join, countdown, live positions,
// results. It renders MultiplayerRace views and calls back into the race; all player-provided text
// goes through textContent. The panel is rebuilt only when its structure changes, so inputs keep
// their content and focus; timers and positions update in place.

import { t, funnyName } from './strings.js';
import { MAX_LAPS } from '../net/Protocol.js';

const STYLE = `
	#mp-button { bottom: 12px; left: 100px; cursor: pointer; }
	#mp-panel {
		position: absolute; bottom: 56px; left: 12px; width: 330px; max-height: calc(100vh - 140px); overflow-y: auto;
		padding: 14px 16px; background: rgba(255,255,255,0.95); border-radius: 14px; border: 1px solid rgba(0,0,0,0.06);
		box-shadow: 0 10px 30px rgba(0,0,0,0.25); font: 400 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		color: #1f2430; z-index: 21; box-sizing: border-box;
	}
	#mp-panel[hidden], #mp-positions[hidden], #mp-countdown[hidden] { display: none; }
	#mp-panel h2 { font-size: 15px; margin: 0 0 10px; }
	#mp-panel label { display: block; margin: 10px 0 4px; color: #4a5260; }
	#mp-panel input, #mp-panel textarea, #mp-panel select {
		width: 100%; box-sizing: border-box; font: inherit; padding: 6px 8px; border: 1px solid rgba(0,0,0,0.15); border-radius: 8px; background: #fff;
	}
	#mp-panel textarea { height: 54px; resize: none; font-family: ui-monospace, monospace; font-size: 11px; word-break: break-all; }
	#mp-panel button { font: inherit; padding: 7px 12px; margin: 8px 6px 0 0; border: none; border-radius: 999px; background: #eef0f3; color: #1f2430; cursor: pointer; }
	#mp-panel button.primary { background: #1f2430; color: #fff; font-weight: 600; }
	#mp-panel button:disabled { opacity: 0.4; cursor: default; }
	#mp-panel .invite { margin-top: 10px; padding: 10px; background: #f5f6f8; border-radius: 10px; }
	#mp-panel .muted { color: #6b7280; font-size: 12px; margin-top: 6px; }
	#mp-panel .message { color: #b45309; margin-top: 10px; }
	#mp-panel ul { list-style: none; padding: 0; margin: 6px 0 0; }
	#mp-panel li { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid rgba(0,0,0,0.06); }
	#mp-panel table { width: 100%; border-collapse: collapse; margin-top: 6px; }
	#mp-panel td, #mp-panel th { text-align: left; padding: 4px 2px; font-variant-numeric: tabular-nums; }
	#mp-positions {
		position: absolute; top: 150px; left: 12px; min-width: 140px; padding: 8px 12px; border-radius: 10px;
		background: rgba(0,0,0,0.5); color: #fff; font: 600 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; z-index: 10;
	}
	#mp-positions .you { color: #f2c94c; }
	#mp-positions button { margin-top: 6px; font: inherit; font-size: 11px; background: rgba(255,255,255,0.2); color: #fff; border: none; border-radius: 999px; padding: 3px 10px; cursor: pointer; }
	#mp-countdown {
		position: absolute; top: 35%; left: 50%; transform: translate(-50%, -50%); color: #fff; pointer-events: none; z-index: 22;
		font: 800 120px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; text-shadow: 0 4px 20px rgba(0,0,0,0.5);
	}
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

async function copy( text, button, lang ) {

	try {

		await navigator.clipboard.writeText( text );

	} catch {

		prompt( '', text );

	}

	const label = button.textContent;
	button.textContent = t( 'mp.copied', lang );
	setTimeout( () => { button.textContent = label; }, 1200 );

}

export class Lobby {

	// canRace: false when the track has no finish line (a race needs laps).
	constructor( { canRace = true } = {} ) {

		this.canRace = canRace;
		this.mp = null;
		this.open = false;
		this.joining = false;
		this.view = { role: null };
		this.structure = '';

		const style = document.createElement( 'style' );
		style.textContent = STYLE;
		document.head.appendChild( style );

		this.button = el( 'a', { id: 'mp-button', className: 'corner-link', role: 'button', on: { click: ( e ) => { e.stopPropagation(); this.toggle(); } } } );
		this.panel = el( 'div', { id: 'mp-panel', hidden: true } );
		this.positionsList = el( 'div' );
		this.leaveButton = el( 'button', { on: { click: () => { if ( confirm( t( 'mp.leaveConfirm', this.lang ) ) ) this.mp.leave(); } } } );
		this.positionsEl = el( 'div', { id: 'mp-positions', hidden: true }, this.positionsList, this.leaveButton );
		this.countdownEl = el( 'div', { id: 'mp-countdown', hidden: true } );
		document.body.append( this.button, this.panel, this.positionsEl, this.countdownEl );

		this.nameInput = el( 'input', { maxLength: 16, value: funnyName() } );
		this.offerInput = el( 'textarea', { spellcheck: false } );
		this.answerInputs = new Map();

		window.addEventListener( 'gg-langchange', () => this.render( this.view, true ) );
		this.render( this.view, true );

	}

	bind( mp ) {

		this.mp = mp;

	}

	// Opened from an invite link: straight to "join" with the offer filled in.
	openJoin( offerCode ) {

		this.open = true;
		this.joining = true;
		this.offerInput.value = offerCode;
		this.render( this.view, true );

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
		const racing = view.phase === 'countdown' || view.phase === 'racing';
		if ( racing ) this.open = false;
		if ( view.phase === 'results' ) this.open = true;

		const key = JSON.stringify( [ this.open, this.joining, this.lang, view.role, view.phase, view.you, view.laps, view.players,
			view.invites?.map( ( i ) => [ i.peerId, i.secondsLeft === 0 ] ), view.answerCode, view.results, view.message, view.finished ] );

		if ( force || key !== this.structure ) {

			this.structure = key;
			this.button.textContent = t( 'mp.button', this.lang );
			this.panel.hidden = ! this.open;
			this.panel.replaceChildren( ...( this.open ? this.panelContent( view ) : [] ) );

		}

		this.updateLive( view );

	}

	panelContent( view ) {

		const L = this.lang;
		const parts = [ el( 'h2', { text: t( 'mp.button', L ) } ) ];

		if ( ! view.role ) parts.push( ...this.menu() );
		else if ( view.phase === 'results' ) parts.push( ...this.resultsPart( view ) );
		else if ( view.role === 'host' ) parts.push( ...this.hostLobby( view ) );
		else parts.push( ...this.guestLobby( view ) );

		if ( view.message ) parts.push( el( 'div', { className: 'message', text: t( view.message.key, L, view.message.vars ) } ) );
		if ( view.role ) parts.push( el( 'button', { text: t( 'mp.leave', L ), on: { click: () => this.mp.leave() } } ) );
		return parts;

	}

	menu() {

		const L = this.lang;
		const parts = [ el( 'label', { text: t( 'mp.name', L ) } ), this.nameInput ];

		if ( ! this.canRace ) return [ ...parts, el( 'div', { className: 'message', text: t( 'mp.noFinish', L ) } ) ];

		if ( ! this.joining ) {

			parts.push(
				el( 'button', { className: 'primary', text: t( 'mp.create', L ), on: { click: () => this.mp.host( this.name(), 3 ) } } ),
				el( 'button', { text: t( 'mp.join', L ), on: { click: () => { this.joining = true; this.render( this.view, true ); } } } ),
			);
			return parts;

		}

		const answer = el( 'button', { className: 'primary', text: t( 'mp.createAnswer', L ) } );
		answer.addEventListener( 'click', async () => {

			answer.disabled = true;
			answer.textContent = t( 'mp.connecting', L );
			await this.mp.join( this.offerInput.value, this.name() );
			this.joining = false;

		} );

		parts.push( el( 'label', { text: t( 'mp.pasteOffer', L ) } ), this.offerInput, answer );
		return parts;

	}

	hostLobby( view ) {

		const L = this.lang;
		const laps = el( 'select', { on: { change: ( e ) => this.mp.setLaps( Number( e.target.value ) ) } } );
		for ( let n = 1; n <= MAX_LAPS; n ++ ) laps.appendChild( el( 'option', { value: n, text: String( n ), selected: n === view.laps } ) );

		const parts = [ el( 'label', { text: t( 'mp.laps', L ) } ), laps, this.rosterList( view ) ];

		for ( const invite of view.invites ) parts.push( this.invitePart( invite ) );

		const inviteBtn = el( 'button', { text: t( 'mp.invite', L ), disabled: view.players.length + view.invites.length >= 4 } );
		inviteBtn.addEventListener( 'click', async () => {

			inviteBtn.disabled = true;
			await this.mp.invite();

		} );

		const connected = view.players.filter( ( p ) => p.connected ).length;
		parts.push( inviteBtn, el( 'button', { className: 'primary', text: t( 'mp.start', L ), disabled: connected < 2, on: { click: () => this.mp.start() } } ) );
		return parts;

	}

	invitePart( invite ) {

		const L = this.lang;
		if ( ! this.answerInputs.has( invite.peerId ) ) this.answerInputs.set( invite.peerId, el( 'textarea', { spellcheck: false, placeholder: t( 'mp.pasteAnswer', L ) } ) );
		const answer = this.answerInputs.get( invite.peerId );

		if ( invite.secondsLeft === 0 ) {

			return el( 'div', { className: 'invite' },
				el( 'div', { className: 'message', text: t( 'mp.expired', L ) } ),
				el( 'button', { text: t( 'mp.invite', L ), on: { click: () => this.mp.regenerate( invite.peerId ) } } ) );

		}

		const linkBtn = el( 'button', { className: 'primary', text: t( 'mp.copyLink', L ) } );
		linkBtn.addEventListener( 'click', () => copy( invite.link, linkBtn, L ) );
		const codeBtn = el( 'button', { text: t( 'mp.copyCode', L ) } );
		codeBtn.addEventListener( 'click', () => copy( invite.code, codeBtn, L ) );

		return el( 'div', { className: 'invite' },
			linkBtn, codeBtn,
			el( 'div', { className: 'muted expiry', text: '' } ),
			answer,
			el( 'button', { text: t( 'mp.connect', L ), on: { click: () => this.mp.accept( invite.peerId, answer.value ) } } ) );

	}

	guestLobby( view ) {

		const L = this.lang;

		if ( ! view.you ) {

			const codeBtn = el( 'button', { className: 'primary', text: t( 'mp.copyCode', L ) } );
			codeBtn.addEventListener( 'click', () => copy( view.answerCode, codeBtn, L ) );
			return [
				el( 'label', { text: t( 'mp.sendAnswer', L ) } ),
				el( 'textarea', { readOnly: true, value: view.answerCode ?? '', className: 'answer-code' } ),
				codeBtn,
			];

		}

		return [ this.rosterList( view ), el( 'div', { className: 'muted', text: t( 'mp.waitingHost', L ) } ) ];

	}

	rosterList( view ) {

		const L = this.lang;
		return el( 'ul', { className: 'roster' }, ...view.players.map( ( p ) => el( 'li', {},
			el( 'span', { text: p.name } ),
			el( 'span', { className: 'muted', text: p.id === view.you ? t( 'mp.you', L ) : t( p.connected ? 'mp.connected' : 'mp.waiting', L ) } ) ) ) );

	}

	resultsPart( view ) {

		const L = this.lang;
		const table = el( 'table', {},
			el( 'tr', {}, el( 'th', { text: '#' } ), el( 'th', { text: '' } ), el( 'th', { text: t( 'mp.time', L ) } ), el( 'th', { text: t( 'mp.best', L ) } ) ),
			...( view.results ?? [] ).map( ( r ) => el( 'tr', {},
				el( 'td', { text: String( r.place ) } ),
				el( 'td', { text: r.name } ),
				el( 'td', { text: r.total === null ? t( 'mp.dnf', L ) : formatTime( r.total ) } ),
				el( 'td', { text: formatTime( r.best ) } ) ) ) );

		const parts = [ el( 'h2', { text: t( 'mp.results', L ) } ), table ];
		if ( view.role === 'host' ) {

			parts.push(
				el( 'button', { className: 'primary', text: t( 'mp.rematch', L ), on: { click: () => { this.mp.rematch(); this.mp.start(); } } } ),
				el( 'button', { text: t( 'mp.backToLobby', L ), on: { click: () => this.mp.rematch() } } ) );

		} else {

			parts.push( el( 'div', { className: 'muted', text: t( 'mp.waitingHost', L ) } ) );

		}

		return parts;

	}

	updateLive( view ) {

		const L = this.lang;

		for ( const [ i, node ] of [ ...this.panel.querySelectorAll( '.invite .expiry' ) ].entries() ) {

			const s = view.invites[ i ]?.secondsLeft ?? 0;
			node.textContent = t( 'mp.expiresIn', L, { time: `${ Math.floor( s / 60 ) }:${ String( s % 60 ).padStart( 2, '0' ) }` } );

		}

		this.countdownEl.hidden = ! view.countdown;
		if ( view.countdown ) this.countdownEl.textContent = view.countdown === 'GO' ? t( 'mp.go', L ) : view.countdown;

		const racing = view.phase === 'countdown' || view.phase === 'racing';
		this.positionsEl.hidden = ! racing;
		if ( ! racing ) return;

		const rows = view.positions.map( ( p, i ) => el( 'div', { className: p.you ? 'you' : '', text: `P${ i + 1 } ${ p.name }` } ) );
		if ( view.finished ) rows.push( el( 'div', { text: t( 'mp.finished', L ) } ) );
		this.positionsList.replaceChildren( ...rows );
		this.leaveButton.textContent = t( 'mp.leave', L );

	}

	name() {

		const name = this.nameInput.value.replace( /[\u0000-\u001f\u007f]/g, '' ).trim().slice( 0, 16 );
		return name || funnyName();

	}

}
```

- [ ] **Step 6: Create the end-to-end harness page**

Create `test/harness/mp.html` (fake game, real Lobby, real controller, real WebRTC):

```html
<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
	body { margin: 0; height: 100vh; background: #3a7; }
	.corner-link { position: absolute; background: #fff; padding: 9px 18px; border-radius: 999px; font: 13px sans-serif; }
</style></head><body>
<script type="module">
// Headless end-to-end check of the multiplayer flow with a fake game (no three.js, no physics):
// real Lobby UI, real MultiplayerRace, real WebRTC Session between two browser pages.
import { Lobby } from '../../js/ui/Lobby.js';
import { MultiplayerRace } from '../../js/race/MultiplayerRace.js';
import { parseInviteHash } from '../../js/net/Signal.js';

const ring = [];
for ( let i = 0; i < 4; i ++ ) ring.push( [ i, 0 ], [ 4, i ], [ 4 - i, 4 ], [ 0, 4 - i ] );
const trackCells = ring.map( ( [ gx, gz ], i ) => [ gx, gz, i === 0 ? 'track-finish' : 'track-straight', 16 ] );

const lapTimer = {
	onLap: null, running: false, progressValue: 0.25,
	resetForRace() { this.running = false; }, startRace() { this.running = true; }, resetForSolo() { this.running = false; },
	progress() { return this.progressValue; },
};
const opponents = {
	trucks: new Map(),
	add( id, name ) { this.trucks.set( id, { name, states: 0 } ); }, remove( id ) { this.trucks.delete( id ); }, clear() { this.trucks.clear(); },
	push( id ) { const t = this.trucks.get( id ); if ( t ) t.states ++; }, update() {},
};
const game = {
	trackCells, cellSize: 9.99 * 0.75, pageUrl: location.href, mapParam: 'fYYNfoYBf4YB', osmParam: null, lapTimer, opponents,
	placeOnSlot( slot ) { window.slot = slot; }, setHold( hold ) { window.hold = hold; },
	localState() { return { p: [ 10, 0.5, 5 ], q: [ 0, 0, 0, 1 ], v: [ 1, 0, 0 ] }; },
};

const lobby = new Lobby();
const mp = new MultiplayerRace( game, { onChange: ( view ) => lobby.render( view ) } );
lobby.bind( mp );
const offer = parseInviteHash( location.hash );
if ( offer ) lobby.openJoin( offer );
setInterval( () => mp.update( 1 / 60 ), 16 );
Object.assign( window, { mp, lobby, game } );
window.ready = true;
</script></body></html>
```

- [ ] **Step 7: Headless check (Appendix `e2e`)**

Expected, in order: invite link with `?map=…#join=KR1.…` and `Expires in 10:00`; guest offer prefilled `true`; both rosters list two players (`you` / `connected`); countdown `"3"` with `hold=true` on both and guest `slot=1`; racing with `hold=false` and state counts > 20 both ways; positions P1/P2; results `1 <guest> 0:20.50 … | 2 <host> 0:22.25 …`; back to lobby; German `verbunden` / `Mehrspieler`; `<guest name> left` on the host; `no page errors`. Run it three times — it must be stable.

- [ ] **Step 8: Commit**

```bash
git add js/race/MultiplayerRace.js js/ui/Lobby.js test/multiplayer-race.test.mjs test/harness/mp.html
git commit -F - <<'MSG'
feat(multiplayer): lobby and race controller

Create/join with invite links and answer codes, roster, countdown, live
positions, results, rematch; checked end-to-end headless with two pages.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

---

### Task 9: Wire it into the game

**Files:**
- Modify: `js/LapTimer.js`, `js/main.js`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: everything above.
- Produces: in the running game, a **Multiplayer** button next to **Tracks**; `LapTimer` gains `onLap`, `persist`, `progress()`, `resetForRace()`, `startRace()`, `resetForSolo()`.

- [ ] **Step 1: LapTimer race hooks**

Apply to `js/LapTimer.js`:

```diff
--- a/js/LapTimer.js	2026-09-23 21:17:52.252000000 +0200
+++ b/js/LapTimer.js	2026-09-24 17:03:06.190779137 +0200
@@ -58,6 +58,11 @@
 
 		this.prevForwardProj = null;
 
+		// Multiplayer: onLap( lapNumber, lapTime ) after every completed lap; persist = false keeps race
+		// laps out of the single-player best-lap storage.
+		this.onLap = null;
+		this.persist = true;
+
 		this.cellSize = CELL_RAW * GRID_SCALE;
 		this.requiredCells = new Set();
 		this.visitedCells = new Set();
@@ -170,12 +175,13 @@
 	completeLap() {
 
 		const isBest = this.bestLap === null || this.currentLapTime < this.bestLap;
+		const lapTime = this.currentLapTime;
 
 		this.lastLap = this.currentLapTime;
 		if ( isBest ) {
 
 			this.bestLap = this.currentLapTime;
-			saveBest( this.storageKey, this.bestLap );
+			if ( this.persist ) saveBest( this.storageKey, this.bestLap );
 
 		}
 		this.lap += 1;
@@ -191,6 +197,54 @@
 			{ duration: 1200, easing: 'ease-out' }
 		);
 
+		this.onLap?.( this.lap - 1, lapTime );
+
+	}
+
+	// Fraction (0..1) of this lap's cells visited so far — for live race positions.
+	progress() {
+
+		return this.requiredCells.size ? this.visitedCells.size / this.requiredCells.size : 0;
+
+	}
+
+	// Clean slate for a multiplayer race: lap 1, no times, nothing stored. The clock starts with startRace().
+	resetForRace() {
+
+		this.persist = false;
+		this.reset( null );
+
+	}
+
+	startRace() {
+
+		this.running = true;
+
+	}
+
+	// Back to single player: stored best lap again.
+	resetForSolo() {
+
+		this.persist = true;
+		this.reset( loadBest( this.storageKey ) );
+
+	}
+
+	reset( bestLap ) {
+
+		this.lap = 1;
+		this.bestLap = bestLap;
+		this.lastLap = null;
+		this.currentLapTime = 0;
+		this.running = false;
+		this.prevForwardProj = null;
+		this.visitedCells.clear();
+		if ( ! this.enabled ) return;
+		this.lapEl.textContent = this.lap;
+		this.currentEl.textContent = formatTime( 0 );
+		this.lastEl.textContent = formatTime( null );
+		this.bestEl.textContent = formatTime( this.bestLap );
+
 	}
 
 }
```

- [ ] **Step 2: Game adapter in `main.js`**

In `js/main.js`:

1. Extend the Track import so it includes `encodeCells`, `TRACK_CELLS`, `CELL_RAW`, `GRID_SCALE` (keep whatever else it already imports — the OSM surroundings work may already have added some of them):
   ```js
   import { buildTrack, decodeCells, encodeCells, computeSpawnPosition, computeTrackBounds, TRACK_CELLS, CELL_RAW, GRID_SCALE } from './Track.js';
   ```
2. After `import { ColorMapGLTFLoader } from './Loader.js';` add
   ```js
   import { gridSlots } from './race/RaceState.js';
   import { Opponents } from './race/Opponents.js';
   import { MultiplayerRace } from './race/MultiplayerRace.js';
   import { Lobby } from './ui/Lobby.js';
   import { parseInviteHash } from './net/Signal.js';
   ```
3. Directly after `const _camLead = new THREE.Vector3();` add the block below. **If `const cellSize = CELL_RAW * GRID_SCALE;` already exists further up (added by the OSM surroundings plan), delete the `cellSize` line from this block instead of declaring it twice.**
   ```js
   	const _up = new THREE.Vector3( 0, 1, 0 );

   	// Multiplayer (#1): other players' trucks, the lobby and the race controller.
   	const cellSize = CELL_RAW * GRID_SCALE;
   	const raceCells = customCells || TRACK_CELLS;
   	const finishCell = raceCells.find( ( c ) => c[ 2 ] === 'track-finish' );
   	const trackKeys = new Set( raceCells.map( ( c ) => c[ 0 ] + ',' + c[ 1 ] ) );
   	const slots = finishCell ? gridSlots( finishCell, cellSize, ( gx, gz ) => trackKeys.has( gx + ',' + gz ) ) : [];
   	const osmRaw = new URLSearchParams( window.location.search ).get( 'osm' );
   	let holdInput = false;

   	const game = {
   		trackCells: raceCells,
   		cellSize,
   		pageUrl: window.location.href,
   		mapParam: mapParam || encodeCells( TRACK_CELLS ),
   		osmParam: osmRaw && /^[-0-9.,]{13,120}$/.test( osmRaw ) ? osmRaw : null,
   		lapTimer,
   		opponents: new Opponents( scene, world, models ),
   		placeOnSlot( slot ) {

   			const { position, angle } = slots[ slot ];
   			rigidBody.setPosition( world, sphereBody, position, true );
   			rigidBody.setLinearVelocity( world, sphereBody, [ 0, 0, 0 ] );
   			rigidBody.setAngularVelocity( world, sphereBody, [ 0, 0, 0 ] );
   			vehicle.spherePos.set( position[ 0 ], position[ 1 ], position[ 2 ] );
   			vehicle.prevModelPos.set( position[ 0 ], 0, position[ 2 ] );
   			vehicle.linearSpeed = 0;
   			vehicle.container.quaternion.setFromAxisAngle( _up, angle );

   		},
   		setHold( hold ) {

   			holdInput = hold;

   		},
   		localState() {

   			const s = vehicle.spherePos, q = vehicle.container.quaternion, v = vehicle.sphereVel;
   			return { p: [ s.x, s.y, s.z ], q: [ q.x, q.y, q.z, q.w ], v: [ v.x, v.y, v.z ] };

   		},
   	};

   	const lobby = new Lobby( { canRace: !! finishCell } );
   	const multiplayer = new MultiplayerRace( game, { onChange: ( view ) => lobby.render( view ) } );
   	lobby.bind( multiplayer );
   	const invite = parseInviteHash( window.location.hash );
   	if ( invite ) lobby.openJoin( invite );
   ```
4. In `animate()`, replace
   ```js
   		const input = controls.update();

   		updateWorld( world, contactListener, dt );
   ```
   with
   ```js
   		const input = controls.update();
   		if ( holdInput ) Object.assign( input, { x: 0, z: 0, touchActive: false } );

   		multiplayer.update( dt );
   		updateWorld( world, contactListener, dt );
   ```

- [ ] **Step 3: Verify**

Run: `node --test test/*.test.mjs && node --input-type=module --check < js/main.js && node --input-type=module --check < js/LapTimer.js`
Expected: all pass, no syntax errors. Then re-run the Appendix checks `p2p`, `opponents`, `e2e` once more.

- [ ] **Step 4: Changelog**

Under `## [Unreleased]` in `CHANGELOG.md` add (merge with an existing `### Added` if there is one):

```markdown
### Added

- Multiplayer: race up to three friends over the internet — send an invite link,
  paste back their answer code, and race a countdown start over 1–10 laps with
  trucks you can bump into. Works without any server; strict company networks
  may block it (a phone hotspot helps). Available in German and English.
```

- [ ] **Step 5: Commit**

```bash
git add js/LapTimer.js js/main.js CHANGELOG.md
git commit -F - <<'MSG'
feat(multiplayer): race friends in the game

Multiplayer button next to Tracks, grid start, input hold during the
countdown, live opponent trucks. Race laps stay out of single-player best laps.

Closes #1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg
MSG
```

- [ ] **Step 6: Manual play-test (the only in-game verification — headless Chromium cannot render the game here)**

Two devices on different networks: host opens the game, Multiplayer → Create race, laps 3, Invite a player, sends the link; guest opens it, Create answer, sends the code back; host pastes, Connect, Start race. Check: both trucks on the grid, countdown in sync, you can shove each other, positions update, results identical on both, Rematch works, closing the host tab sends the guest back to single player.

---

## Appendix: headless check runners (not committed)

Need Playwright in a scratch directory (`npm i playwright@1.58` there) and a Chromium binary (`CHROME=/path/to/chrome`; on this machine `/home/freax/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`). Serve the repo on port 3000 first. WebRTC between local pages needs the launch flag already included (`--disable-features=WebRtcHideLocalIpsWithMdns`).

### `p2p` — save as `p2p.cjs`, run `CHROME=… node p2p.cjs`

```js
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const errs = [];
  const open = async (role) => { const p = await b.newPage(); p.on('pageerror', e => errs.push(role + ' ' + e.message)); await p.goto(`http://localhost:3000/test/harness/p2p.html?role=${role}`); await p.waitForFunction(() => window.ready); return p; };
  const host = await open('host'), g1 = await open('guest'), g2 = await open('guest');
  for (const [guest, id] of [[g1, 'g1'], [g2, 'g2']]) {
    const offer = await host.evaluate((id) => window.session.createOffer(id), id);
    const answer = await guest.evaluate((c) => window.session.answerOffer(c), offer);
    await host.evaluate(([id, a]) => window.session.acceptAnswer(id, a), [id, answer]);
  }
  await host.waitForFunction(() => window.session.openPeers().length === 2, null, { timeout: 15000 });
  await g1.evaluate(() => window.session.send('h', { type: 'hello', name: 'Bo' }));
  await host.evaluate(() => window.session.broadcast({ type: 'ping', t: 1 }));
  await g2.evaluate(() => { for (let i = 0; i < 21; i++) window.session.peers.get('h').channel.send('garbage'); });
  await host.waitForTimeout(1500);
  const bad = await host.evaluate(() => window.session.acceptAnswer('g9', 'KR1.x').then(() => 'accepted', (e) => e.message));
  console.log('host:', JSON.stringify(await host.evaluate(() => window.events)), '| unknown peer answer:', bad);
  console.log('g1:', JSON.stringify(await g1.evaluate(() => window.events)));
  console.log('g2:', JSON.stringify(await g2.evaluate(() => window.events)));
  console.log(errs.length ? errs.join('\n') : 'no page errors');
  await b.close();
})();
```

### `opponents` — save as `opp.cjs`, run `CHROME=… node opp.cjs`

```js
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME });
  const p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://localhost:3000/test/harness/opponents.html');
  await p.waitForFunction(() => window.result, null, { timeout: 60000 }).catch(() => {});
  console.log(JSON.stringify(await p.evaluate(() => window.result)), errs.join(' | ') || 'no errors');
  await b.close();
})();
```

### `e2e` — save as `e2e.cjs`, run `CHROME=… node e2e.cjs`

```js
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:3000';
const step = (s) => console.log('·', s);
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME, args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const errs = [];
  const page = async (url, tag) => { const p = await b.newPage({ viewport: { width: 1000, height: 800 } }); p.on('pageerror', e => errs.push(tag + ' ' + e.stack.split('\n').slice(0,4).join(' <- '))); p.on('dialog', d => d.accept()); await p.goto(url); await p.waitForFunction(() => window.ready); return p; };
  const host = await page(BASE + '/test/harness/mp.html', 'host');
  await host.click('#mp-button');
  await host.click('text=Create race');
  await host.selectOption('#mp-panel select', '1');
  await host.click('text=Invite a player');
  await host.waitForSelector('.invite .expiry');
  const link = await host.evaluate(() => window.mp.invites[0].link);
  step('invite link ' + link.replace(/KR1\.[\w-]+/, 'KR1.…') + ' | expiry: ' + await host.textContent('.invite .expiry'));
  const guest = await page(link, 'guest');
  step('guest prefilled offer: ' + ((await guest.inputValue('#mp-panel textarea')).startsWith('KR1.')));
  await guest.click('text=Create answer');
  await guest.waitForFunction(() => document.querySelector('.answer-code')?.value.startsWith('KR1.'), null, { timeout: 15000 });
  const answer = await guest.inputValue('.answer-code');
  await host.fill('.invite textarea', answer);
  await host.click('text=Connect');
  await host.waitForFunction(() => window.mp.view().players.filter(p => p.connected).length === 2, null, { timeout: 15000 });
  await guest.waitForFunction(() => document.querySelectorAll('.roster li').length === 2);
  step('host roster: ' + (await host.$$eval('.roster li', ls => ls.map(l => l.textContent).join(' / '))));
  step('guest roster: ' + (await guest.$$eval('.roster li', ls => ls.map(l => l.textContent).join(' / '))));
  await host.click('text=Start race');
  await guest.waitForFunction(() => window.mp.phase === 'countdown');
  step('countdown: host "' + await host.textContent('#mp-countdown') + '" hold=' + await host.evaluate(() => window.hold) + ' | guest slot=' + await guest.evaluate(() => window.slot) + ' hold=' + await guest.evaluate(() => window.hold));
  await host.waitForFunction(() => window.mp.phase === 'racing', null, { timeout: 6000 });
  await guest.waitForFunction(() => window.mp.phase === 'racing', null, { timeout: 6000 });
  await host.waitForTimeout(400);
  step('racing: hold host=' + await host.evaluate(() => window.hold) + ' guest=' + await guest.evaluate(() => window.hold) + ' | host sees guest states=' + await host.evaluate(() => window.game.opponents.trucks.get('g1')?.states) + ' guest sees host states=' + await guest.evaluate(() => window.game.opponents.trucks.get('h')?.states));
  step('positions (guest): ' + (await guest.textContent('#mp-positions')).replace('Leave', ''));
  await guest.evaluate(() => window.game.lapTimer.onLap(1, 20.5));
  await host.waitForTimeout(300);
  await host.evaluate(() => window.game.lapTimer.onLap(1, 22.25));
  await host.waitForFunction(() => window.mp.phase === 'results', null, { timeout: 5000 });
  await guest.waitForFunction(() => window.mp.phase === 'results', null, { timeout: 5000 });
  step('results (guest): ' + (await guest.$$eval('#mp-panel tr', rs => rs.slice(1).map(r => r.textContent).join(' | '))));
  await host.click('text=Back to lobby');
  await guest.waitForFunction(() => window.mp.phase === 'lobby');
  step('after back-to-lobby guest panel: ' + (await guest.textContent('#mp-panel .muted')));
  // German
  await guest.evaluate(() => window.ggSetLang ? window.ggSetLang('de') : (window.GG_LANG = 'de', window.dispatchEvent(new CustomEvent('gg-langchange', { detail: { lang: 'de' } }))));
  await guest.waitForTimeout(200);
  step('guest in German: ' + (await guest.textContent('#mp-panel .muted')) + ' / button: ' + await guest.textContent('#mp-button'));
  await guest.click('#mp-panel >> text=Verlassen');
  await host.waitForFunction(() => window.mp.view().players.length === 1, null, { timeout: 8000 });
  step('host after guest left: ' + (await host.textContent('#mp-panel .message')));
  console.log(errs.length ? 'ERRORS\n' + errs.join('\n') : 'no page errors');
  await b.close();
})().catch(e => { console.log('FAILED', e.message.split('\n')[0]); process.exit(1); });
```

