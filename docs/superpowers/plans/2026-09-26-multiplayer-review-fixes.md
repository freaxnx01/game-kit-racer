# Multiplayer Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the six should-fix findings from the PR #5 review of the multiplayer feature (#1). Closes #7.

**Architecture:** Six small, local fixes in the existing modules — no new protocol messages, no new dependencies. Pure modules (`Protocol`, `RaceState`, `MultiplayerRace`, `strings`) and `Session.wire` get Node tests; the two DOM/physics-only fixes (`main.js` `placeOnSlot`, `Lobby` CSS/menus) get a grep/`node --check` check and a Playwright check against a new harness page.

**Tech Stack:** Plain ES modules (three.js + crashcat via import map, untouched here), Node's built-in `node:test`, Python Playwright (not committed) for the harness check.

**Spec:** `docs/superpowers/specs/2026-09-26-multiplayer-review-fixes-design.md`

## Global Constraints

- Static files only — no bundler, no `package.json`, no new dependencies, no protocol message changes.
- Code style = upstream mrdoob style: tabs, spaces inside parentheses/brackets, blank line after a block-opening `{` and before its `}`, `const`/`let`, no commented-out code. Test names `functionName_state_expectedBehavior`.
- Run all unit tests with `node --test test/*.test.mjs` (72 pass on `main`; 81 after this plan).
- New UI strings go into `js/ui/strings.js` in **both** `en` and `de` (a test checks key parity). German: standard German, capitalised `Du`/`Dein` if used, real umlauts.
- Player-provided text only via `textContent` (the `el()` helper's `text` prop).
- Line numbers below refer to `main` at fa8f473; locate by the quoted code if they drifted.
- Commit per task, Conventional Commits, message ending with exactly these two trailer lines:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg`
- Run Playwright in the **foreground** (never backgrounded); commit and push before running it.

## Review Focus

1. **Guest on another track** — setup for a different map: guest leaves, sees the message and a link to the host's track; host sees "left" instead of a frozen truck. → Task 4 `guestSetup_otherTrack_leavesAndOffersTheHostTrack`.
2. **Truck leaves the map for seconds** (drives off, falls) — never kicked; genuinely malformed spam still kicked after 20. → Task 2 `session.test.mjs`.
3. **Cheating lap times** — a guest reporting minimum lap times but finishing last in host time is placed last. → Task 3 `results_guestReportsFastLapsButFinishesLast_isPlacedLast`.
4. **Two finishers in the same host tick** — order stays deterministic (reported total breaks the tie). → Task 3 `results_sameFinishMoment_fallsBackToReportedTotal`.
5. **Phone width (≤ 760 px)** — panel above the nav bar; Tracks and Multiplayer never open together. → Task 5 Playwright check.

---

### Task 1: No raw control characters in the name-cleaning code (item 4)

**Files:**
- Modify: `js/net/Protocol.js:24` (`cleanName` regex)
- Modify: `js/ui/Lobby.js:7` (import), `js/ui/Lobby.js:354-359` (`name()`)
- Test: `test/protocol.test.mjs` (line 4 import, line 70 raw BEL, new tests)

**Interfaces:**
- Consumes: `cleanName( name ) → string | null` (unchanged signature, `js/net/Protocol.js:21`).
- Produces: `Lobby.name()` now delegates to `cleanName`.

Lines `Protocol.js:24`, `Lobby.js:356` and `protocol.test.mjs:70` contain raw bytes (NUL, US, DEL, BEL). String-matching edit tools may not match them — use the script in Step 3.

- [ ] **Step 1: Write the failing tests**

In `test/protocol.test.mjs` replace line 4 with (Task 2 adds `readMessage` to this import):

```js
import { readFileSync } from 'node:fs';
import { validate, parseMessage, cleanName, MAX_MESSAGE_CHARS } from '../js/net/Protocol.js';
```

Append at the end of the file:

```js
test( 'cleanName_everyControlCharacter_isStripped', () => {

	assert.equal( cleanName( '\u0000B\u001fo\u007f' ), 'Bo' );

} );

test( 'sources_nameCleaningFiles_containNoRawControlCharacters', () => {

	for ( const file of [ 'js/net/Protocol.js', 'js/ui/Lobby.js', 'test/protocol.test.mjs' ] ) {

		const text = readFileSync( new URL( '../' + file, import.meta.url ), 'utf8' );
		assert.equal( /[\u0000-\u0008\u000b-\u001f\u007f]/.test( text ), false, file );

	}

} );
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/protocol.test.mjs`
Expected: `sources_nameCleaningFiles_containNoRawControlCharacters` FAILS with message `js/net/Protocol.js`; the others pass.

- [ ] **Step 3: Replace the raw bytes**

```bash
python3 - <<'EOF'
import re
def fix(path, pattern, repl):
    s = open(path, encoding='utf-8').read()
    s2, n = re.subn(pattern, repl, s, count=1)
    assert n == 1, path
    open(path, 'w', encoding='utf-8').write(s2)
fix('js/net/Protocol.js', r"name\.replace\( /\[[^\]]*\]/g, '' \)", r"name.replace( /[\\u0000-\\u001f\\u007f]/g, '' )")
fix('js/ui/Lobby.js', r"const name = this\.nameInput\.value\.replace\( /\[[^\]]*\]/g, '' \)\.trim\(\)\.slice\( 0, 16 \);\n\t\treturn name \|\| funnyName\(\);", "return cleanName( this.nameInput.value ) ?? funnyName();")
fix('js/ui/Lobby.js', r"import \{ MAX_LAPS \} from '\.\./net/Protocol\.js';", "import { MAX_LAPS, cleanName } from '../net/Protocol.js';")
fix('test/protocol.test.mjs', "Bo\x07", r"Bo\\u0007")
EOF
```

Result — `js/net/Protocol.js:24`:

```js
	const clean = name.replace( /[\u0000-\u001f\u007f]/g, '' ).trim();
```

`js/ui/Lobby.js` `name()`:

```js
	name() {

		return cleanName( this.nameInput.value ) ?? funnyName();

	}
```

`test/protocol.test.mjs:70`: `assert.equal( cleanName( '  Bo\u0007\n ' ), 'Bo' );`

- [ ] **Step 4: Run the full suite**

Run: `node --test test/*.test.mjs && git diff --stat`
Expected: 74 pass, 0 fail; `git diff --stat` lists `js/net/Protocol.js` with `+`/`-` counts, not `Bin`.

- [ ] **Step 5: Commit**

```bash
git add js/net/Protocol.js js/ui/Lobby.js test/protocol.test.mjs
git commit -m "fix(multiplayer): write name-cleaning regex without raw control bytes

Protocol.js showed as binary in git. Lobby now reuses cleanName().

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg"
```

---

### Task 2: Out-of-bounds states are ignored, not counted as drops (item 5)

**Files:**
- Modify: `js/net/Protocol.js:45-46` (`state` validator), `js/net/Protocol.js:57-96` (`validate`, `parseMessage` → helpers + `readMessage`)
- Modify: `js/net/Session.js:6` (import), `js/net/Session.js:183-189` (message listener)
- Test: `test/protocol.test.mjs`, Create: `test/session.test.mjs`

**Interfaces:**
- Produces: `readMessage( text, bounds ) → { kind: 'deliver', msg } | { kind: 'ignore' } | { kind: 'drop' }` exported from `js/net/Protocol.js`. `validate( msg, bounds )` and `parseMessage( text, bounds )` keep their contracts.
- Consumes: `Session.wire( peerId, peer, channel )` (`js/net/Session.js:161`), `MAX_DROPS = 20`.

- [ ] **Step 1: Write the failing tests**

In `test/protocol.test.mjs` change the Protocol import to:

```js
import { validate, parseMessage, readMessage, cleanName, MAX_MESSAGE_CHARS } from '../js/net/Protocol.js';
```

Append:

```js
test( 'readMessage_outOfBoundsStateVsMalformed_areToldApart', () => {

	assert.deepEqual( readMessage( JSON.stringify( VALID.state ), BOUNDS ), { kind: 'deliver', msg: VALID.state } );
	assert.deepEqual( readMessage( JSON.stringify( { ...VALID.state, p: [ 999, 0.5, 0 ] } ), BOUNDS ), { kind: 'ignore' } );
	assert.deepEqual( readMessage( JSON.stringify( { ...VALID.state, p: [ 0, 99, 0 ] } ), BOUNDS ), { kind: 'ignore' } );
	assert.deepEqual( readMessage( JSON.stringify( { ...VALID.state, v: [ 500, 0, 0 ] } ), BOUNDS ), { kind: 'drop' } );
	assert.deepEqual( readMessage( JSON.stringify( { type: 'hello', name: '' } ), BOUNDS ), { kind: 'drop' } );
	assert.deepEqual( readMessage( '{not json', BOUNDS ), { kind: 'drop' } );

} );
```

Create `test/session.test.mjs`:

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../js/net/Session.js';

const BOUNDS = { minX: - 50, maxX: 50, minZ: - 50, maxZ: 50 };
const STATE = { type: 'state', id: 'g1', p: [ 1, 0.5, - 3 ], q: [ 0, 0, 0, 1 ], v: [ 3, 0, - 1 ], lap: 1, progress: 0.4 };

// A Session with one open peer 'g1' on a fake data channel; no RTCPeerConnection involved.
function wiredPeer() {

	const delivered = [], closed = [];
	const session = new Session( { bounds: BOUNDS, onMessage: ( id, msg ) => delivered.push( msg ), onOpen() {}, onClose: ( id, reason ) => closed.push( reason ) } );
	const peer = { pc: { close() {} }, channel: null, drops: 0, createdAt: 0, closed: false, opened: true, graceTimer: null };
	session.peers.set( 'g1', peer );
	const channel = Object.assign( new EventTarget(), { readyState: 'open', close() {} } );
	session.wire( 'g1', peer, channel );
	const receive = ( text ) => channel.dispatchEvent( Object.assign( new Event( 'message' ), { data: text } ) );
	return { delivered, closed, receive };

}

test( 'wire_outOfBoundsStates_areIgnoredWithoutKickingThePeer', () => {

	const w = wiredPeer();
	for ( let i = 0; i < 60; i ++ ) w.receive( JSON.stringify( { ...STATE, p: [ 999, 0.5, 0 ] } ) );
	for ( let i = 0; i < 60; i ++ ) w.receive( JSON.stringify( { ...STATE, p: [ 0, - 80, 0 ] } ) );
	assert.deepEqual( w.closed, [] );
	assert.equal( w.delivered.length, 0 );
	w.receive( JSON.stringify( STATE ) );
	assert.deepEqual( w.delivered, [ STATE ] );

} );

test( 'wire_malformedMessages_kickThePeerAfterTwentyDrops', () => {

	const w = wiredPeer();
	for ( let i = 0; i < 20; i ++ ) w.receive( '{not json' );
	assert.deepEqual( w.closed, [] );
	w.receive( JSON.stringify( { ...STATE, v: [ NaN, 0, 0 ] } ) );
	assert.deepEqual( w.closed, [ 'invalid' ] );

} );
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/protocol.test.mjs test/session.test.mjs`
Expected: `protocol.test.mjs` fails to load (`readMessage` is not exported); `wire_outOfBoundsStates_areIgnoredWithoutKickingThePeer` FAILS (`closed` is `[ 'invalid' ]`); `wire_malformedMessages_kickThePeerAfterTwentyDrops` passes (regression guard).

- [ ] **Step 3: Implement in `js/net/Protocol.js`**

Replace the `state` validator (lines 45-46) with a shape-only check:

```js
	state: ( m ) => isId( m.id ) && isVec( m.p, 3, 1e6 ) && isVec( m.q, 4, 1.01 ) &&
		isVec( m.v, 3, MAX_SPEED ) && isInt( m.lap, 0, MAX_LAPS + 1 ) && isNum( m.progress, 0, 1 ),
```

Replace everything from `// Is this object a well-formed message?` (line 57) to the end of the file with:

```js
// Is this object a well-formed message? Positions are not checked against the track area here.
function wellFormed( msg ) {

	if ( msg === null || typeof msg !== 'object' || Array.isArray( msg ) ) return false;
	const check = Object.hasOwn( VALIDATORS, msg.type ) ? VALIDATORS[ msg.type ] : null;
	if ( ! check ) return false;

	try {

		return check( msg ) === true;

	} catch {

		return false;

	}

}

// A well-formed `state` whose truck is outside the track area (it drove or fell off the map).
function outOfBounds( msg, bounds ) {

	return msg.type === 'state' && ! inBounds( msg.p, bounds );

}

// Is this object a well-formed message? bounds = { minX, maxX, minZ, maxZ } in world units (for `state`).
export function validate( msg, bounds ) {

	return wellFormed( msg ) && ! outOfBounds( msg, bounds );

}

// Raw text → parsed JSON within the size limits, or null.
function decode( text ) {

	if ( typeof text !== 'string' || text.length > MAX_SETUP_CHARS ) return null;

	let msg;

	try {

		msg = JSON.parse( text );

	} catch {

		return null;

	}

	if ( text.length > MAX_MESSAGE_CHARS && msg?.type !== 'setup' ) return null;
	return msg;

}

// Raw data-channel text → { kind: 'deliver', msg }, { kind: 'ignore' } for a well-formed `state`
// outside the track area (not the sender's fault), or { kind: 'drop' } for anything malformed.
export function readMessage( text, bounds ) {

	const msg = decode( text );
	if ( ! wellFormed( msg ) ) return { kind: 'drop' };
	if ( outOfBounds( msg, bounds ) ) return { kind: 'ignore' };
	return { kind: 'deliver', msg };

}

// Raw data-channel text → validated message, or null.
export function parseMessage( text, bounds ) {

	const read = readMessage( text, bounds );
	return read.kind === 'deliver' ? read.msg : null;

}
```

Replace header comment lines 3-4 with:

```js
// Messages are JSON objects with a `type`. Session drops malformed ones (and disconnects a peer after
// too many) but only ignores a `state` outside the track area. Unknown extra fields are ignored.
```

- [ ] **Step 4: Implement in `js/net/Session.js`**

Line 6: `import { readMessage } from './Protocol.js';`. Replace the message listener body (lines 185-188):

```js
		channel.addEventListener( 'message', ( e ) => {

			const { kind, msg } = readMessage( e.data, this.bounds );

			if ( kind === 'deliver' ) return this.onMessage( peerId, msg );
			if ( kind === 'drop' && ++ peer.drops > MAX_DROPS ) this.close( peerId, true, 'invalid' );

		} );
```

Update the header comment line 3 (`every inbound message passes Protocol.parseMessage`) to say `Protocol.readMessage`.

- [ ] **Step 5: Run the full suite**

Run: `node --test test/*.test.mjs`
Expected: 77 pass, 0 fail (the existing `validate_malformedVariants_areRejected` still rejects out-of-bounds states via `validate`).

- [ ] **Step 6: Commit**

```bash
git add js/net/Protocol.js js/net/Session.js test/protocol.test.mjs test/session.test.mjs
git commit -m "fix(multiplayer): don't kick players whose truck leaves the track area

Out-of-bounds state messages were counted as malformed drops, so a
truck off the map was kicked after about a second at 20 Hz.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg"
```

---

### Task 3: Results ordered by host-observed finish time (item 6)

**Files:**
- Modify: `js/race/RaceState.js:147-156` (`recordFinish`), `js/race/RaceState.js:158-169` (`standings`), `js/race/RaceState.js:204-208` (`freshRace`)
- Test: `test/race-state.test.mjs:89-100` (replaced test) + two new tests

**Interfaces:**
- Consumes: `recordFinish( id, now )` — `now` in ms on the host clock, already passed by `MultiplayerRace.js:331` and `:487`.
- Produces: player records gain `finishedAt: number | null`; `results()` rows unchanged (`{ id, name, place, total, best }`).

The existing test `tick_everyoneFinished_showsResultsInTimeOrder` asserts the buggy rule (order by reported total although `h` finished at 6000 and `g1` at 7000). It is **replaced** — this is a spec change, not a test tweak to go green.

- [ ] **Step 1: Write the failing tests**

In `test/race-state.test.mjs` replace the whole test `tick_everyoneFinished_showsResultsInTimeOrder` (lines 89-100) with:

```js
test( 'tick_everyoneFinished_showsResultsInHostObservedFinishOrder', () => {

	const r = race( [ 'h', 'g1', 'g2' ] );
	r.start( 0 ); r.tick( COUNTDOWN_MS );
	driveLaps( r, 'g2', 2, FAST + 1 ); r.recordFinish( 'g2', 5000 );
	driveLaps( r, 'h', 2, FAST + 3 ); r.recordFinish( 'h', 6000 );
	assert.equal( r.tick( 6000 ), PHASE.RACING );
	driveLaps( r, 'g1', 2, FAST + 2 ); r.recordFinish( 'g1', 7000 );
	assert.equal( r.tick( 7000 ), PHASE.RESULTS );
	assert.deepEqual( r.results().map( ( row ) => [ row.id, row.place ] ), [ [ 'g2', 1 ], [ 'h', 2 ], [ 'g1', 3 ] ] );

} );

test( 'results_guestReportsFastLapsButFinishesLast_isPlacedLast', () => {

	const r = race( [ 'h', 'g1' ] );
	r.start( 0 ); r.tick( COUNTDOWN_MS );
	driveLaps( r, 'h', 2, FAST + 20 ); r.recordFinish( 'h', 60000 );
	driveLaps( r, 'g1', 2, FAST ); r.recordFinish( 'g1', 75000 );
	assert.deepEqual( r.results().map( ( row ) => [ row.id, row.place, row.total ] ), [ [ 'h', 1, 2 * FAST + 40 ], [ 'g1', 2, 2 * FAST ] ] );

} );

test( 'results_sameFinishMoment_fallsBackToReportedTotal', () => {

	const r = race( [ 'h', 'g1' ] );
	r.start( 0 ); r.tick( COUNTDOWN_MS );
	driveLaps( r, 'h', 2, FAST + 3 ); r.recordFinish( 'h', 50000 );
	driveLaps( r, 'g1', 2, FAST + 1 ); r.recordFinish( 'g1', 50000 );
	assert.deepEqual( r.results().map( ( row ) => row.id ), [ 'g1', 'h' ] );

} );
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/race-state.test.mjs`
Expected: `tick_everyoneFinished_showsResultsInHostObservedFinishOrder` and `results_guestReportsFastLapsButFinishesLast_isPlacedLast` FAIL; `results_sameFinishMoment_fallsBackToReportedTotal` passes.

- [ ] **Step 3: Implement in `js/race/RaceState.js`**

In `recordFinish`, after `p.best = Math.min( ...p.lapTimes );` add:

```js
		p.finishedAt = now;
```

Replace `standings` (comment + method, lines 158-169):

```js
	// Live order: finished players by when the host saw them finish (reported totals only break ties —
	// a guest's lap times are not trusted), then everyone else by laps and progress (0..1).
	standings( progressById ) {

		const key = ( p ) => p.laps + ( progressById.get( p.id ) ?? 0 );
		return this.players.filter( ( p ) => ! p.left ).slice().sort( ( a, b ) => {

			if ( a.total !== null && b.total !== null ) return a.finishedAt - b.finishedAt || a.total - b.total;
			if ( a.total !== null || b.total !== null ) return a.total === null ? 1 : - 1;
			return key( b ) - key( a );

		} ).map( ( p ) => p.id );

	}
```

`freshRace()`:

```js
	return { laps: 0, lapTimes: [], total: null, best: null, finishedAt: null };
```

Update the `players` field comment in the constructor (line 54) to include `finishedAt`.

- [ ] **Step 4: Run the full suite**

Run: `node --test test/*.test.mjs`
Expected: 79 pass, 0 fail (including `raceToResults_thenRematch_returnsToLobbyWithoutError`, whose two players finish in the same tick — the tie-break keeps `[ 'Bo', 'Ana' ]`).

- [ ] **Step 5: Commit**

```bash
git add js/race/RaceState.js test/race-state.test.mjs
git commit -m "fix(multiplayer): order results by when the host saw players finish

Guest-reported lap times decided the finishing order, so a guest could
report fast laps and win while finishing last.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg"
```

---

### Task 4: Guest on another track is told and offered the host's track (item 1)

**Files:**
- Modify: `js/race/MultiplayerRace.js:201-219` (`view`), `:223-251` (`teardown`), `:264-272` (`inviteLink` → + `trackUrl`), `:356-363` (`setup` case), new method `otherTrack` before `syncOpponents` (:392)
- Modify: `js/ui/strings.js:47` (en) and `:91` (de) — two new keys each
- Modify: `js/ui/Lobby.js` — CSS for `a.host-track`, `render()` (:150-171), `panelContent()` (:183)
- Test: `test/multiplayer-race.test.mjs`, `test/strings.test.mjs`

**Interfaces:**
- Consumes: `leave()` (`MultiplayerRace.js:169`), `say( key, vars )`, `buildInviteLink( pageUrl, code )` (`js/net/Signal.js:74`).
- Produces: `view().hostTrack: string | null`; `trackUrl( map, osm ) → string` (search and hash cleared, `%2C` → `,`); `otherTrack( setup )`; string keys `mp.otherTrack`, `mp.openHostTrack`.

- [ ] **Step 1: Write the failing tests**

In `test/multiplayer-race.test.mjs`, before `noConnectionAfterTwentySeconds_showsStrictNetworkHint`, add:

```js
test( 'guestSetup_otherTrack_leavesAndOffersTheHostTrack', async () => {

	const t = setup();
	t.game.pageUrl = 'https://example.test/game/index.html?map=fYYN#join=KR1.offer-g1';
	await t.mp.join( 'KR1.offer-g1', 'Bo' );
	t.session().connect( 'h' );
	t.session().deliver( 'h', { type: 'roster', you: 'g1', players: [ { id: 'h', name: 'Ana', slot: 0, connected: true }, { id: 'g1', name: 'Bo', slot: 1, connected: true } ] } );
	t.session().deliver( 'h', { type: 'setup', map: 'OtherTrack', osm: '47.548,7.98,47.556,7.995,10,-1,-3', laps: 2, startIn: 3000 } );

	const view = t.mp.view();
	assert.equal( view.role, null );
	assert.equal( view.phase, 'lobby' );
	assert.equal( view.message.key, 'mp.otherTrack' );
	assert.equal( view.hostTrack, 'https://example.test/game/index.html?map=OtherTrack&osm=47.548,7.98,47.556,7.995,10,-1,-3' );
	assert.ok( t.session().sent.some( ( s ) => s.to === 'h' && s.msg.type === 'leave' ) );
	assert.equal( t.game.hold, false );

} );
```

In `test/strings.test.mjs`, before `t_placeholdersAndFallbacks_work`, add:

```js
test( 'STRINGS_otherTrackTexts_existInBothLanguages', () => {

	for ( const key of [ 'mp.otherTrack', 'mp.openHostTrack' ] ) for ( const lang of [ 'en', 'de' ] ) assert.ok( STRINGS[ lang ][ key ], `${ lang } ${ key }` );

} );
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/multiplayer-race.test.mjs test/strings.test.mjs`
Expected: both new tests FAIL (guest still has `role: 'guest'`; keys missing).

- [ ] **Step 3: Implement in `js/race/MultiplayerRace.js`**

`setup` case (lines 358-359) becomes:

```js
				const me = this.roster.find( ( p ) => p.id === this.you );
				if ( ! me ) return;
				if ( msg.map !== this.game.mapParam ) return this.otherTrack( msg );
```

Add before `syncOpponents()`:

```js
	// The host started on a track this page is not showing: leave (the host sees "left" instead of
	// racing a truck that never moves) and offer a link to the host's track.
	otherTrack( setup ) {

		const link = this.trackUrl( setup.map, setup.osm );
		this.leave();
		this.hostTrack = link;
		this.say( 'mp.otherTrack' );

	}
```

Replace `inviteLink` (lines 264-272) with:

```js
	inviteLink( code ) {

		return buildInviteLink( this.trackUrl( this.game.mapParam, this.game.osmParam ), code );

	}

	// This page's URL showing the given track (and OSM surroundings, when set).
	trackUrl( map, osm ) {

		const url = new URL( this.game.pageUrl );
		url.search = '';
		url.hash = '';
		url.searchParams.set( 'map', map );
		if ( osm ) url.searchParams.set( 'osm', osm );
		return url.href.replace( /%2C/g, ',' );

	}
```

In `view()` add after `message: this.message,`:

```js
			hostTrack: this.hostTrack,
```

In `teardown()` add after `this.message = null;`:

```js
		this.hostTrack = null;   // link to the host's track after a setup for another track
```

- [ ] **Step 4: Add the strings in `js/ui/strings.js`**

After `'mp.noFinish'` in `en`:

```js
		'mp.otherTrack': 'The host is racing on another track. Open it, then ask the host for a new invite.',
		'mp.openHostTrack': 'Open the host’s track',
```

After `'mp.noFinish'` in `de`:

```js
		'mp.otherTrack': 'Der Gastgeber fährt auf einer anderen Strecke. Öffne sie und bitte ihn dann um eine neue Einladung.',
		'mp.openHostTrack': 'Strecke des Gastgebers öffnen',
```

- [ ] **Step 5: Render the link in `js/ui/Lobby.js`**

In `STYLE`, after the `#mp-panel .message` rule:

```css
	#mp-panel a.host-track { display: inline-block; margin-top: 8px; color: #1f2430; font-weight: 600; }
```

In `render( view, force )` replace the first four lines of the body and the `key` with:

```js
		const newHostTrack = view.hostTrack && view.hostTrack !== this.view.hostTrack;
		this.view = view;
		const racing = view.phase === 'countdown' || view.phase === 'racing';
		if ( racing ) this.open = false;
		if ( view.phase === 'results' || newHostTrack ) this.open = true;

		const key = JSON.stringify( [ this.open, this.joining, this.lang, view.role, view.phase, view.you, view.laps, view.players,
			view.invites?.map( ( i ) => [ i.peerId, i.secondsLeft === 0 ] ), view.answerCode, view.results, view.message, view.hostTrack, view.finished ] );
```

In `panelContent( view )`, after the `view.message` line:

```js
		if ( view.hostTrack ) parts.push( el( 'a', { className: 'host-track', href: view.hostTrack, text: t( 'mp.openHostTrack', L ) } ) );
```

- [ ] **Step 6: Run the full suite**

Run: `node --test test/*.test.mjs && node --check js/ui/Lobby.js`
Expected: 81 pass, 0 fail; `node --check` silent (exit 0).

- [ ] **Step 7: Commit**

```bash
git add js/race/MultiplayerRace.js js/ui/strings.js js/ui/Lobby.js test/multiplayer-race.test.mjs test/strings.test.mjs
git commit -m "fix(multiplayer): tell a guest on another track and link the host's track

A guest whose ?map= differed from the host's ignored setup and waited
forever while the host raced it as DNF.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg"
```

---

### Task 5: Truck still on its slot; panel and Tracks menu on phones (items 2 and 3)

Neither fix is unit-testable in Node: `main.js` needs WebGL/three.js/crashcat (and `index.html` does not boot in headless Chromium), and item 3 is DOM/CSS. Item 2 is checked by grep + `node --check` + a manual check; item 3 by a Playwright check against a new harness page (verified during planning to fail on `main` and pass with this change).

**Files:**
- Modify: `js/main.js:303` (`placeOnSlot`)
- Modify: `js/ui/Lobby.js:11-17` (CSS), `:104` (button), `:137-142` (+ `close()`)
- Create: `test/harness/menus.html`

**Interfaces:**
- Consumes: `vehicle.angularSpeed`, `vehicle.acceleration`, `vehicle.sphereVel` (`js/Vehicle.js:31-35`); `#tracks-button` / `#tracks-menu` / `#game-nav` from `index.html:28-45, 68-69, 104-105, 109`.
- Produces: `Lobby.close()`.

- [ ] **Step 1: Create the harness page `test/harness/menus.html`**

```html
<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
	/* The parts of index.html the multiplayer panel shares the screen with: corner links, Tracks menu, #game-nav. */
	body { margin: 0; height: 100vh; background: #3a7; }
	.corner-link { position: absolute; background: #fff; padding: 9px 18px; border-radius: 999px; font: 13px sans-serif; z-index: 20; }
	#tracks-button { bottom: 12px; left: 12px; cursor: pointer; }
	#tracks-menu { position: absolute; bottom: 56px; left: 12px; min-width: 250px; height: 120px; background: #fff; z-index: 20; }
	#tracks-menu[hidden] { display: none; }
	@media (max-width: 760px) { #game-nav { bottom: 60px !important; } #tracks-menu { bottom: 100px; } }
</style></head><body>
<a id="tracks-button" class="corner-link" role="button">Tracks</a>
<div id="tracks-menu" hidden></div>
<nav id="game-nav" style="position:fixed;left:50%;transform:translateX(-50%);bottom:14px;z-index:30;padding:6px 11px;background:#222;color:#fff">nav</nav>
<script type="module">
// Headless check of how the multiplayer panel and the Tracks menu share the screen (#7 item 3).
// The Tracks menu script mirrors index.html's.
import { Lobby } from '../../js/ui/Lobby.js';

const menu = document.getElementById( 'tracks-menu' );
const button = document.getElementById( 'tracks-button' );
const setOpen = ( open ) => { menu.hidden = ! open; };
button.addEventListener( 'click', ( e ) => { e.stopPropagation(); setOpen( menu.hidden ); } );
document.addEventListener( 'click', ( e ) => { if ( ! menu.contains( e.target ) ) setOpen( false ); } );

const lobby = new Lobby();
lobby.bind( { host() {}, join() {} } );
window.lobby = lobby;
window.ready = true;
</script>
</body></html>
```

- [ ] **Step 2: Write the Playwright check (not committed) and run it to verify it fails**

Write `/tmp/menus_check.py`:

```python
# Checks #7 item 3 on test/harness/menus.html at phone width. Usage: python3 /tmp/menus_check.py <base-url>
import sys
from playwright.sync_api import sync_playwright

base = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3000"
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 390, "height": 800})
    page.goto(base + "/test/harness/menus.html")
    page.wait_for_function("window.ready === true")
    page.click("#tracks-button")
    page.click("#mp-button")
    assert page.eval_on_selector("#tracks-menu", "e => e.hidden"), "Tracks menu still open after opening Multiplayer"
    assert not page.eval_on_selector("#mp-panel", "e => e.hidden"), "Multiplayer panel did not open"
    panel_bottom = page.eval_on_selector("#mp-panel", "e => e.getBoundingClientRect().bottom")
    nav_top = page.eval_on_selector("#game-nav", "e => e.getBoundingClientRect().top")
    assert panel_bottom <= nav_top, f"panel bottom {panel_bottom} overlaps nav top {nav_top}"
    page.click("#tracks-button")
    assert page.eval_on_selector("#mp-panel", "e => e.hidden"), "Multiplayer panel still open after opening Tracks"
    assert not page.eval_on_selector("#tracks-menu", "e => e.hidden"), "Tracks menu did not open"
    browser.close()
print("menus ok")
```

Run in the **foreground** (install Playwright first only if `python3 -c "import playwright"` fails: `pip install playwright && python3 -m playwright install chromium`):

```bash
python3 -m http.server 3000 >/dev/null 2>&1 & SERVER=$!; sleep 1; timeout 120 python3 /tmp/menus_check.py http://localhost:3000; STATUS=$?; kill $SERVER; exit $STATUS
```

Expected: FAIL with `AssertionError: Tracks menu still open after opening Multiplayer`.

- [ ] **Step 3: Implement in `js/ui/Lobby.js`**

In `STYLE`, right after the `#mp-panel { … }` block (before the `[hidden]` rule):

```css
	@media (max-width: 760px) { #mp-panel { bottom: 100px; max-height: calc(100vh - 184px); } }
```

Replace line 104 (`this.button = el( 'a', { … e.stopPropagation(); this.toggle(); … } );`) with:

```js
		// The click reaches document, so index.html closes its Tracks menu; opening Tracks closes this panel.
		this.button = el( 'a', { id: 'mp-button', className: 'corner-link', role: 'button', on: { click: () => this.toggle() } } );
		document.getElementById( 'tracks-button' )?.addEventListener( 'click', () => this.close() );
```

After `toggle()` add:

```js
	close() {

		if ( ! this.open ) return;
		this.open = false;
		this.render( this.view, true );

	}
```

- [ ] **Step 4: Implement in `js/main.js` `placeOnSlot`**

After `vehicle.linearSpeed = 0;` (line 303) add:

```js
			vehicle.angularSpeed = 0;
			vehicle.acceleration = 0;
			vehicle.sphereVel.set( 0, 0, 0 );
```

- [ ] **Step 5: Verify**

```bash
node --check js/main.js && node --check js/ui/Lobby.js
grep -c -E 'vehicle\.(angularSpeed|acceleration) = 0|vehicle\.sphereVel\.set\( 0, 0, 0 \)' js/main.js
node --test test/*.test.mjs
```

Expected: `node --check` silent; grep prints `3`; 81 pass, 0 fail.

- [ ] **Step 6: Commit and push, then run the Playwright check**

```bash
git add js/main.js js/ui/Lobby.js test/harness/menus.html
git commit -m "fix(multiplayer): keep the truck still on its slot; fix menus on phones

placeOnSlot now also clears angular speed and acceleration. The panel
sits above the nav bar below 760 px, and it and the Tracks menu close
each other.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0116aGhK91Zo6Rs62M9rncQg"
git push
```

Then run the Step 2 command again in the foreground. Expected: `menus ok`. If Playwright cannot be installed in the environment, say so in the PR body and list the manual check below as not yet done.

- [ ] **Step 7: Manual check (for the PR reviewer; list in the PR body)**

1. Phone width (≤ 760 px, e.g. DevTools device mode): open Multiplayer → the panel's buttons are above the nav bar; open Tracks → the panel closes; open Multiplayer → Tracks closes.
2. Two browsers, host + guest: guest steers hard left while the host presses Start → the guest's and host's trucks sit still on their slots for the whole countdown.
