# vs CPU Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CPU trucks drive without stutter, bumping into them nudges instead of flings, truck-on-truck hits are audible, and a running CPU race can be restarted or quit at any time. Closes #13.

**Architecture:** The stutter is a position jump in `CpuDriver.state()` (lane offset along the per-segment normal), fixed there. Bump physics get two pure rules in a new `js/race/Bump.js` (teleport detection, velocity-gain cap, relative speed) used by `Opponents` (teleport guard) and a new `js/race/OpponentContacts.js` that sits in `main.js`'s crashcat contact listener and around `updateWorld`. The race controls are DOM-only changes in `CpuPanel`; `CpuRace` is unchanged.

**Tech Stack:** Plain ES modules, three.js 0.185.1 and crashcat 0.0.3 via the existing import map, Node's built-in `node:test`, Playwright (not committed) for the headless harness checks.

**Spec:** `docs/superpowers/specs/2026-09-27-cpu-race-polish-design.md`

## Global Constraints

- Static files only — no bundler, no `package.json`, no committed `node_modules` (browser-game stack). No new dependencies.
- Pure modules (`js/race/CpuDriver.js`, `js/race/Bump.js`) must not import `three` or `crashcat` and must not touch the DOM.
- Numbers: `MAX_KINEMATIC_SPEED = 40` u/s, `MAX_BUMP_GAIN = 3` u/s per physics step, `BUMP_SOUND_COOLDOWN_MS = 200`. Play-testing may tune these three constants only.
- Do not change `samplePath`'s lateral behaviour in `js/race/TrackPath.js` — grid lanes and its tests depend on it.
- Do not change `js/Audio.js` or `js/ImpactSound.js` — #12 owns audio; this plan only calls `audio.playImpact( speed )`.
- Code style = upstream mrdoob style: tabs, spaces inside parentheses/brackets, blank line after a block-opening `{` and before its `}`, `const`/`let`, no commented-out code. Test names `functionName_state_expectedBehavior`. Run all unit tests with `node --test test/*.test.mjs` (159 today).
- German UI text: standard German, real umlauts, address pronoun capitalised.
- Headless Chromium cannot boot the full game here (`index.html` never shows `#cpu-button`, checked 2026-09-27) — `main.js` wiring is verified by the Node suite, the harness pages and the manual play-test.
- Commits: Conventional Commits, ending with the two trailer lines shown in each commit step.

## Review Focus

1. **Grid positions unchanged** — the lane fix must not move trucks on straights. → Task 1 `state_laneOffsetOnTheStraight_matchesSamplePath`.
2. **Normal driving untouched** — `softenBump` only runs in a step with an opponent contact; walls/ground keep the old sound path. → Task 3 harness scenario `noContact` and the `involvesOpponent` guard in Task 4.
3. **Restart mid-race keeps the solo lap-timer hook** — covered by the existing `start_whileARaceIsRunning_replacesItWithoutLosingTheSoloHook`; Task 5 only calls `race.rematch()`.
4. **Space/Enter after clicking a race button** must not re-trigger it (Space becomes throttle in #16). → Task 5 `act()` blurs.

## File Map

| File | Status | Responsibility |
|---|---|---|
| `js/race/CpuDriver.js` | modify | `state()` offsets along the smoothed heading |
| `js/race/Bump.js` | create | `MAX_KINEMATIC_SPEED`, `MAX_BUMP_GAIN`, `BUMP_SOUND_COOLDOWN_MS`, `isTeleport`, `softenBump`, `bumpSpeed` |
| `js/race/Opponents.js` | modify | `owns( body )`, teleport guard `moveBody` |
| `js/race/OpponentContacts.js` | create | Player↔opponent contacts: restitution 0, softened velocity, bump callback with cooldown |
| `js/main.js` | modify | `cpuOpponents` const, `OpponentContacts` wiring |
| `js/ui/strings.js` | modify | `cpu.restart`, `cpu.running` (en + de) |
| `js/ui/CpuPanel.js` | modify | Restart/Quit in the positions box, race section in the panel, `Esc`, blur |
| `test/cpu-driver.test.mjs`, `test/bump.test.mjs`, `test/cpu-strings.test.mjs` | modify/create | Node tests |
| `test/harness/bump.html` | create | Headless crashcat scenarios through real `Opponents` + `OpponentContacts` |
| `CHANGELOG.md` | modify | Player-facing entry |

---

### Task 1: CPU trucks without position jumps

**Files:**
- Modify: `js/race/CpuDriver.js:181-195`
- Modify: `test/cpu-driver.test.mjs`

**Interfaces:**
- Consumes: `samplePath( path, s, lateral )` from `js/race/TrackPath.js` (unchanged).
- Produces: `CpuDriver#state() → { p, q, v }` — same shape; `p` now continuous for any `lateral`.

- [ ] **Step 1: Write the failing test**

In `test/cpu-driver.test.mjs`, change the TrackPath import to:

```js
import { buildPath, samplePath } from '../js/race/TrackPath.js';
```

Append:

```js
test( 'state_laneOffsetThroughCorners_movesWithoutJumps', () => {

	for ( const lateral of [ 1.65, - 1.65, 2.2, - 2.2 ] ) {

		const d = new CpuDriver( { path: buildPath( DEFAULT_TRACK, CELL ), start: 0, lateral, difficulty: DIFFICULTY.medium } );
		let prev = d.state().p, largest = 0;
		for ( let s = 0.05; s < d.path.length; s += 0.05 ) {

			d.distance = s;
			const p = d.state().p;
			largest = Math.max( largest, Math.hypot( p[ 0 ] - prev[ 0 ], p[ 2 ] - prev[ 2 ] ) );
			prev = p;

		}

		// A 0.05 step along the line moves an outer-lane truck at most ~0.09; the old per-segment offset jumped 0.48–0.62.
		assert.ok( largest <= 0.12, `lateral ${ lateral }: jumped ${ largest.toFixed( 3 ) }` );

	}

} );

test( 'state_laneOffsetOnTheStraight_matchesSamplePath', () => {

	const path = buildPath( DEFAULT_TRACK, CELL );
	const d = new CpuDriver( { path, start: 0, lateral: 1.65, difficulty: DIFFICULTY.medium } );
	for ( const s of [ - 3, 2 ] ) {

		d.distance = s;
		const { p } = d.state();
		const expected = samplePath( path, s, 1.65 );
		assert.ok( Math.abs( p[ 0 ] - expected.x ) < 1e-9 && Math.abs( p[ 2 ] - expected.z ) < 1e-9, `at ${ s }` );

	}

} );
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/cpu-driver.test.mjs`
Expected: `state_laneOffsetThroughCorners_movesWithoutJumps` FAILS with `lateral 1.65: jumped 0.480`; the straight test passes.

- [ ] **Step 3: Implement**

Replace `state()` in `js/race/CpuDriver.js` with:

```js
	// Pose for Opponents.push: position, yaw-only quaternion, velocity. The lane offset follows the smoothed
	// heading's right vector, not the current segment's normal, so a truck off the centre line does not jump
	// sideways at every 15° arc vertex.
	state() {

		const centre = samplePath( this.path, this.distance, 0 );
		const behind = samplePath( this.path, this.distance - HEADING_SPAN, 0 );
		const ahead = samplePath( this.path, this.distance + HEADING_SPAN, 0 );
		const heading = Math.atan2( ahead.x - behind.x, ahead.z - behind.z ); // smooth through the 15° arc steps
		const fx = Math.sin( heading ), fz = Math.cos( heading );
		return {
			p: [ centre.x + fz * this.lateral, SPHERE_Y, centre.z - fx * this.lateral ],
			q: [ 0, Math.sin( heading / 2 ), 0, Math.cos( heading / 2 ) ],
			v: [ fx * this.speed, 0, fz * this.speed ],
		};

	}
```

(Right of forward `( fx, fz )` is `( fz, −fx )`, the same frame as `samplePath` and `gridSlots`.)

- [ ] **Step 4: Run the full suite**

Run: `node --test test/*.test.mjs`
Expected: all pass (161).

- [ ] **Step 5: Commit**

```bash
git add js/race/CpuDriver.js test/cpu-driver.test.mjs
git commit -m "fix(cpu): stop CPU trucks jumping sideways in corners

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WVkTufc2PiJjhhrWptUPLA"
```

---

### Task 2: Pure bump rules

**Files:**
- Create: `js/race/Bump.js`
- Create: `test/bump.test.mjs`

**Interfaces:**
- Produces: `MAX_KINEMATIC_SPEED = 40`, `MAX_BUMP_GAIN = 3`, `BUMP_SOUND_COOLDOWN_MS = 200`; `isTeleport( from, to, dt ) → boolean`; `softenBump( before, after, maxGain = MAX_BUMP_GAIN ) → [ x, y, z ]`; `bumpSpeed( a, b ) → number`. Vectors are `[ x, y, z ]` arrays (crashcat's layout).

- [ ] **Step 1: Write the failing test**

Create `test/bump.test.mjs`:

```js
// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTeleport, softenBump, bumpSpeed, MAX_BUMP_GAIN, MAX_KINEMATIC_SPEED } from '../js/race/Bump.js';

const DT = 1 / 60;

test( 'isTeleport_drivingSpeed_isNotATeleport', () => {

	assert.equal( isTeleport( [ 0, 0.5, 0 ], [ 15 * DT, 0.5, 0 ], DT ), false );

} );

test( 'isTeleport_fromTheHiddenParkingSpot_isATeleport', () => {

	assert.equal( isTeleport( [ 0, - 100, 0 ], [ 0, 0.5, 0 ], DT ), true );

} );

test( 'isTeleport_justAboveTheLimit_isATeleport', () => {

	assert.equal( isTeleport( [ 0, 0, 0 ], [ ( MAX_KINEMATIC_SPEED + 1 ) * DT, 0, 0 ], DT ), true );

} );

test( 'softenBump_smallChange_isKept', () => {

	assert.deepEqual( softenBump( [ 1, 0, 0 ], [ 2, 0, 1 ] ), [ 2, 0, 1 ] );

} );

test( 'softenBump_bigSidewaysKick_isCappedAtMaxGain', () => {

	const v = softenBump( [ 0, 0, 0 ], [ 0, 0, 29 ] );
	assert.equal( v[ 0 ], 0 );
	assert.equal( v[ 1 ], 0 );
	assert.ok( Math.abs( v[ 2 ] - MAX_BUMP_GAIN ) < 1e-9, `z ${ v[ 2 ] }` );

} );

test( 'softenBump_hardStop_isAlsoCapped', () => {

	assert.deepEqual( softenBump( [ 10, 0, 0 ], [ 4, 0, 0 ] ), [ 7, 0, 0 ] );

} );

test( 'softenBump_upwardKick_doesNotLiftTheTruck', () => {

	assert.equal( softenBump( [ 0, - 0.2, 0 ], [ 0, 4, 0 ] )[ 1 ], 0 );
	assert.equal( softenBump( [ 0, - 1, 0 ], [ 0, - 0.5, 0 ] )[ 1 ], - 0.5 );

} );

test( 'bumpSpeed_restingPlayerHitAtTen_isTenIgnoringHeight', () => {

	assert.equal( bumpSpeed( [ 0, - 3, 0 ], [ 10, 0, 0 ] ), 10 );
	assert.equal( bumpSpeed( [ 3, 0, 4 ], [ 0, 0, 0 ] ), 5 );

} );
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/bump.test.mjs`
Expected: FAIL — `Cannot find module '../js/race/Bump.js'`.

- [ ] **Step 3: Implement**

Create `js/race/Bump.js`:

```js
// Bump.js — how hard a truck-on-truck bump may hit. Opponent trucks are kinematic (infinite mass), so the
// physics engine alone hands your truck their full speed. Pure.

export const MAX_KINEMATIC_SPEED = 40;     // u/s — faster than this between two poses is a jump, not driving (= RaceState MAX_AVG_SPEED)
export const MAX_BUMP_GAIN = 3;            // u/s — most horizontal speed one physics step of bumping may add or take away
export const BUMP_SOUND_COOLDOWN_MS = 200; // per opponent, so a scraping contact does not machine-gun the sound

// True when getting from `from` to `to` within dt seconds would take more than MAX_KINEMATIC_SPEED.
export function isTeleport( from, to, dt ) {

	const distance = Math.hypot( to[ 0 ] - from[ 0 ], to[ 1 ] - from[ 1 ], to[ 2 ] - from[ 2 ] );
	return distance > MAX_KINEMATIC_SPEED * dt;

}

// Your velocity after a physics step that had an opponent contact, softened: the horizontal change is capped
// at maxGain, and the bump cannot lift you (vertical speed never rises above max( before, 0 )).
export function softenBump( before, after, maxGain = MAX_BUMP_GAIN ) {

	const dx = after[ 0 ] - before[ 0 ], dz = after[ 2 ] - before[ 2 ];
	const gain = Math.hypot( dx, dz );
	const k = gain > maxGain ? maxGain / gain : 1;
	return [ before[ 0 ] + dx * k, Math.min( after[ 1 ], Math.max( before[ 1 ], 0 ) ), before[ 2 ] + dz * k ];

}

// Horizontal relative speed of two bodies — how hard they hit each other.
export function bumpSpeed( a, b ) {

	return Math.hypot( a[ 0 ] - b[ 0 ], a[ 2 ] - b[ 2 ] );

}
```

- [ ] **Step 4: Run the full suite**

Run: `node --test test/*.test.mjs`
Expected: all pass (169).

- [ ] **Step 5: Commit**

```bash
git add js/race/Bump.js test/bump.test.mjs
git commit -m "feat(cpu): add pure rules for softer truck bumps

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WVkTufc2PiJjhhrWptUPLA"
```

---

### Task 3: Opponents teleport guard + OpponentContacts, checked headless

**Files:**
- Modify: `js/race/Opponents.js`
- Create: `js/race/OpponentContacts.js`
- Create: `test/harness/bump.html`

**Interfaces:**
- Consumes: `isTeleport`, `softenBump`, `bumpSpeed`, `BUMP_SOUND_COOLDOWN_MS` (Task 2); crashcat `rigidBody.setPosition( world, body, p, activate )`, `rigidBody.setLinearVelocity( world, body, v )`, `rigidBody.moveKinematic`; bodies expose `position` and `motionProperties.linearVelocity` (verified headless: a kinematic body's `linearVelocity` is the velocity `moveKinematic` gave it).
- Produces: `Opponents#owns( body ) → boolean`; `class OpponentContacts( world, playerBody, opponentsList, { onBump( speed ), now } )` with `involvesOpponent( bodyA, bodyB ) → boolean`, `contactAdded( bodyA, bodyB, settings )`, `contactPersisted( settings )`, `beginStep()`, `endStep()`.

- [ ] **Step 1: Write the failing harness**

Create `test/harness/bump.html`:

```html
<!DOCTYPE html><html><head>
<script type="importmap">{ "imports": {
	"three": "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js",
	"crashcat": "https://esm.sh/crashcat@0.0.3"
} }</script></head><body>
<script type="module">
// Headless physics check for OpponentContacts + Opponents: an opponent truck driving into a resting player
// truck nudges it (capped, no lift), is reported once as a bump with its relative speed, and a pose jump
// teleports the truck without flinging anything. Wired exactly like main.js.
import * as THREE from 'three';
import { createWorldSettings, createWorld, addBroadphaseLayer, addObjectLayer, enableCollision, registerAll, updateWorld, rigidBody, box, MotionType } from 'crashcat';
import { createSphereBody } from '../../js/Physics.js';
import { Opponents } from '../../js/race/Opponents.js';
import { OpponentContacts } from '../../js/race/OpponentContacts.js';

registerAll();
const DT = 1 / 60;

function setup() {

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
	const opponents = new Opponents( new THREE.Scene(), world, {} );
	opponents.add( 'c', 'C', 0 );
	const bumps = [];
	let clock = 0;
	const contacts = new OpponentContacts( world, player, [ opponents ], { onBump: ( speed ) => bumps.push( + speed.toFixed( 2 ) ), now: () => clock } );
	const listener = {
		onContactAdded( a, b, manifold, s ) {

			if ( contacts.involvesOpponent( a, b ) ) contacts.contactAdded( a, b, s );

		},
		onContactPersisted( a, b, manifold, s ) {

			if ( contacts.involvesOpponent( a, b ) ) contacts.contactPersisted( s );

		},
	};
	const step = ( pose ) => {

		clock += DT * 1000;
		opponents.push( 'c', pose, clock );
		opponents.update( DT, clock + 100 );
		contacts.beginStep();
		updateWorld( world, listener, DT );
		contacts.endStep();

	};
	return { player, body: opponents.trucks.get( 'c' ).body, bumps, step };

}

// Opponent drives along +x from x = -3 at `speed`, `offset` off the player's centre line.
function drive( offset, speed = 10 ) {

	const { player, bumps, step } = setup();
	let peakV = 0, peakY = 0;
	for ( let i = 0; i < 120; i ++ ) {

		step( { p: [ - 3 + speed * ( i + 1 ) * DT, 0.5, offset ], q: [ 0, 0, 0, 1 ], v: [ speed, 0, 0 ] } );
		const v = player.motionProperties.linearVelocity;
		peakV = Math.max( peakV, Math.hypot( v[ 0 ], v[ 2 ] ) );
		peakY = Math.max( peakY, player.position[ 1 ] );

	}

	return { peakV: + peakV.toFixed( 2 ), peakY: + peakY.toFixed( 2 ), bumps };

}

function teleport() {

	const { player, body, step } = setup();
	const pose = ( x ) => ( { p: [ x, 0.5, 5 ], q: [ 0, 0, 0, 1 ], v: [ 0, 0, 0 ] } );
	step( pose( - 3 ) );
	const firstVy = body.motionProperties.linearVelocity[ 1 ];
	for ( let i = 0; i < 5; i ++ ) step( pose( - 3 ) );
	step( pose( 20 ) );
	return {
		firstVy: + firstVy.toFixed( 2 ),
		bodyX: + body.position[ 0 ].toFixed( 2 ),
		bodyV: + Math.hypot( ...body.motionProperties.linearVelocity ).toFixed( 2 ),
		playerMoved: + Math.hypot( player.position[ 0 ], player.position[ 2 ] ).toFixed( 3 ),
	};

}

function noContact() {

	const { player, step } = setup();
	for ( let i = 0; i < 30; i ++ ) step( { p: [ - 20, 0.5, 20 ], q: [ 0, 0, 0, 1 ], v: [ 0, 0, 0 ] } );
	return { playerY: + player.position[ 1 ].toFixed( 2 ) };

}

window.result = { headOn: drive( 0 ), glancing: drive( 0.6 ), teleport: teleport(), noContact: noContact() };
</script></body></html>
```

Then save the runner from the appendix as `bump_check.py` (not committed), serve the repo root and run it:

```bash
python3 -m http.server 8765 &   # from the repo root
PORT=8765 python3 bump_check.py
```

Expected: FAIL — `wait_for_function('window.result')` times out: `js/race/OpponentContacts.js` is a 404, so the module never runs.

- [ ] **Step 2: Add `owns` and the teleport guard to `js/race/Opponents.js`**

Add the import below the Interpolate import:

```js
import { isTeleport } from './Bump.js';
```

Add after `clear()`:

```js
	// True when body is one of these trucks' physics bodies (for the contact listener).
	owns( body ) {

		for ( const truck of this.trucks.values() ) if ( truck.body === body ) return true;
		return false;

	}
```

In `update()`, replace `if ( dt > 0 ) rigidBody.moveKinematic( truck.body, pose.p, pose.q, dt );` with:

```js
			if ( dt > 0 ) this.moveBody( truck.body, pose, dt );
```

and add after `update()`:

```js
	// Follows the pose, or jumps straight there with no velocity when following would take a teleport's speed
	// (first placement from HIDDEN, a rematch, a network hiccup) — so nothing touching it gets flung.
	moveBody( body, pose, dt ) {

		if ( isTeleport( body.position, pose.p, dt ) ) {

			rigidBody.setPosition( this.world, body, pose.p, false );
			rigidBody.setLinearVelocity( this.world, body, [ 0, 0, 0 ] );
			return;

		}

		rigidBody.moveKinematic( body, pose.p, pose.q, dt );

	}
```

- [ ] **Step 3: Create `js/race/OpponentContacts.js`**

```js
// OpponentContacts.js — your truck against opponent trucks (CPU or multiplayer): no bounce, a capped push per
// physics step, and a bump callback with the relative speed for the impact sound. main.js calls the contact
// hooks from its crashcat contact listener and beginStep()/endStep() around updateWorld.

import { rigidBody } from 'crashcat';
import { softenBump, bumpSpeed, BUMP_SOUND_COOLDOWN_MS } from './Bump.js';

export class OpponentContacts {

	// opponentsList: Opponents instances whose trucks count (each has owns( body )).
	constructor( world, player, opponentsList, { onBump = () => {}, now = () => performance.now() } = {} ) {

		this.world = world;
		this.player = player;
		this.opponentsList = opponentsList;
		this.onBump = onBump;
		this.now = now;
		this.before = [ 0, 0, 0 ];
		this.touched = false;
		this.lastBump = new WeakMap(); // opponent body → time (ms) of its last bump sound

	}

	involvesOpponent( bodyA, bodyB ) {

		return this.opponentOf( bodyA, bodyB ) !== null;

	}

	// onContactAdded: a new player↔opponent contact.
	contactAdded( bodyA, bodyB, settings ) {

		this.contactPersisted( settings );
		this.reportBump( this.opponentOf( bodyA, bodyB ) );

	}

	// onContactPersisted: the contact goes on (settings are rebuilt every step, so set them again).
	contactPersisted( settings ) {

		settings.combinedRestitution = 0;
		this.touched = true;

	}

	beginStep() {

		this.before = [ ...this.player.motionProperties.linearVelocity ];
		this.touched = false;

	}

	endStep() {

		if ( ! this.touched ) return;
		const softened = softenBump( this.before, this.player.motionProperties.linearVelocity );
		rigidBody.setLinearVelocity( this.world, this.player, softened );

	}

	// ── Internals ───────────────────────────────────────────

	opponentOf( bodyA, bodyB ) {

		const other = bodyA === this.player ? bodyB : bodyB === this.player ? bodyA : null;
		if ( other === null ) return null;
		return this.opponentsList.some( ( opponents ) => opponents.owns( other ) ) ? other : null;

	}

	reportBump( opponent ) {

		const now = this.now();
		if ( now - ( this.lastBump.get( opponent ) ?? - Infinity ) < BUMP_SOUND_COOLDOWN_MS ) return;
		this.lastBump.set( opponent, now );
		this.onBump( bumpSpeed( this.player.motionProperties.linearVelocity, opponent.motionProperties.linearVelocity ) );

	}

}
```

- [ ] **Step 4: Run the harness to verify it passes**

Run: `PORT=8765 python3 bump_check.py`
Expected output (measured 2026-09-27 with the same settings: head-on 8.49, glancing 6.20; today's code gives 9.82 / 7.06):

```
headOn {'peakV': ~8.5, 'peakY': 0.5, 'bumps': [10.0]}
glancing {'peakV': ~6.2, 'peakY': 0.5, 'bumps': [~10]}
teleport {'firstVy': 0.0, 'bodyX': 20.0, 'bodyV': 0.0, 'playerMoved': 0.0}
noContact {'playerY': 0.5}
errors []
PASS
```

If a threshold fails, check the order in `step()` first (push → update → beginStep → updateWorld → endStep, as in `main.js`), then report the numbers — do not loosen the assertions.

- [ ] **Step 5: Run the full suite**

Run: `node --test test/*.test.mjs`
Expected: all pass (169) — the pure modules are unaffected.

- [ ] **Step 6: Commit**

```bash
git add js/race/Opponents.js js/race/OpponentContacts.js test/harness/bump.html
git commit -m "fix(cpu): soften bumps with opponent trucks and report them for sound

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WVkTufc2PiJjhhrWptUPLA"
```

---

### Task 4: Wire OpponentContacts into the game

**Files:**
- Modify: `js/main.js:26-27` (imports), `:351-354` (CPU block), `:375-388` (contact listener), `:402-404` (step)

**Interfaces:**
- Consumes: `OpponentContacts` (Task 3), `game.opponents` (multiplayer), `audio.playImpact( velocity )` (`js/Audio.js:393`, unchanged).

- [ ] **Step 1: Import**

After `import { CpuPanel } from './ui/CpuPanel.js';` add:

```js
import { OpponentContacts } from './race/OpponentContacts.js';
```

- [ ] **Step 2: Name the CPU Opponents**

Replace

```js
	const cpuRace = new CpuRace( { ...game, opponents: new Opponents( scene, world, models ) },
```

with

```js
	const cpuOpponents = new Opponents( scene, world, models );
	const cpuRace = new CpuRace( { ...game, opponents: cpuOpponents },
```

- [ ] **Step 3: Contact listener**

Replace the whole `const contactListener = { … };` block with:

```js
	// Bumps with opponent trucks (#13): no bounce, capped push, sound from the relative speed.
	const opponentContacts = new OpponentContacts( world, sphereBody, [ game.opponents, cpuOpponents ],
		{ onBump: ( speed ) => audio.playImpact( speed ) } );

	const contactListener = {
		onContactAdded( bodyA, bodyB, manifold, settings ) {

			if ( bodyA !== sphereBody && bodyB !== sphereBody ) return;

			if ( opponentContacts.involvesOpponent( bodyA, bodyB ) ) {

				opponentContacts.contactAdded( bodyA, bodyB, settings );
				return;

			}

			_forward.set( 0, 0, 1 ).applyQuaternion( vehicle.container.quaternion );
			_forward.y = 0;
			_forward.normalize();

			const impactVelocity = Math.abs( vehicle.modelVelocity.dot( _forward ) );
			audio.playImpact( impactVelocity );

		},
		onContactPersisted( bodyA, bodyB, manifold, settings ) {

			if ( opponentContacts.involvesOpponent( bodyA, bodyB ) ) opponentContacts.contactPersisted( settings );

		},
	};
```

- [ ] **Step 4: Around the physics step**

In `animate()`, replace `updateWorld( world, contactListener, dt );` with:

```js
		opponentContacts.beginStep();
		updateWorld( world, contactListener, dt );
		opponentContacts.endStep();
```

- [ ] **Step 5: Verify**

Run: `node --test test/*.test.mjs` — all pass. Run `PORT=8765 python3 bump_check.py` and `PORT=8765 python3 cpu_check.py` (appendix) — PASS, `errors []`. Serve the repo root, open `http://localhost:8765/` in a browser: the page loads with an empty console, free driving and wall crashes sound as before.

- [ ] **Step 6: Commit**

```bash
git add js/main.js
git commit -m "feat(cpu): play a crash sound when trucks bump into each other

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WVkTufc2PiJjhhrWptUPLA"
```

---

### Task 5: Restart / quit a running CPU race

**Files:**
- Modify: `js/ui/strings.js` (en block after `'cpu.quit'`, de block after `'cpu.quit'`)
- Modify: `js/ui/CpuPanel.js`
- Modify: `test/cpu-strings.test.mjs`

**Interfaces:**
- Consumes: `CpuRace#rematch()`, `#quit()`, `#view()` (unchanged).
- Produces: DOM ids `#cpu-restart`, `#cpu-quit` in `#cpu-positions`; `Escape` quits during countdown/racing.

- [ ] **Step 1: Write the failing test**

In `test/cpu-strings.test.mjs`, add `'cpu.restart', 'cpu.running'` to `CPU_KEYS` and append:

```js
test( 'STRINGS_raceControls_readNaturallyInGerman', () => {

	assert.equal( t( 'cpu.restart', 'de' ), 'Neu starten' );
	assert.equal( t( 'cpu.running', 'de' ), 'Rennen läuft' );
	assert.equal( t( 'cpu.restart', 'en' ), 'Restart race' );

} );
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/cpu-strings.test.mjs`
Expected: FAIL — `en cpu.restart`.

- [ ] **Step 3: Strings**

In `js/ui/strings.js`, en block, after `'cpu.quit': 'Quit race',` add:

```js
		'cpu.restart': 'Restart race',
		'cpu.running': 'Race in progress',
```

de block, after `'cpu.quit': 'Rennen beenden',` add:

```js
		'cpu.restart': 'Neu starten',
		'cpu.running': 'Rennen läuft',
```

Run: `node --test test/cpu-strings.test.mjs` — PASS.

- [ ] **Step 4: CpuPanel**

In `js/ui/CpuPanel.js`:

1. Below `const DIFFICULTIES = …` add:

```js
const isRacing = ( phase ) => phase === 'countdown' || phase === 'racing';
```

2. In `STYLE`, replace the `#cpu-positions button { … }` rule with:

```css
	#cpu-positions button { margin: 8px 6px 0 0; font: inherit; font-size: 12px; background: rgba(255,255,255,0.22); color: #fff; border: none; border-radius: 999px; padding: 5px 12px; cursor: pointer; }
	#cpu-positions button:hover { background: rgba(255,255,255,0.35); }
```

3. In the constructor, replace

```js
		this.quitButton = el( 'button', { on: { click: () => this.race?.quit() } } );
		this.positionsEl = el( 'div', { id: 'cpu-positions', hidden: true }, this.positionsList, this.quitButton );
```

with

```js
		this.restartButton = el( 'button', { id: 'cpu-restart', on: { click: ( e ) => this.act( e, () => this.race?.rematch() ) } } );
		this.quitButton = el( 'button', { id: 'cpu-quit', on: { click: ( e ) => this.act( e, () => this.race?.quit() ) } } );
		this.positionsEl = el( 'div', { id: 'cpu-positions', hidden: true }, this.positionsList, this.restartButton, this.quitButton );
```

and after `this.structure = '';` add `this.wasRacing = false;`, and after the `gg-langchange` listener add:

```js
		window.addEventListener( 'keydown', ( e ) => this.onKey( e ) );
```

4. Add after `close()`:

```js
	// Runs a race button's action and drops focus, so a later Space/Enter (Space is throttle, #16) cannot
	// re-trigger it through native button activation.
	act( event, action ) {

		event.currentTarget.blur();
		action();

	}

	onKey( event ) {

		if ( event.code !== 'Escape' || ! isRacing( this.view.phase ) ) return;
		this.race?.quit();

	}
```

5. In `render()`, replace

```js
		const racing = view.phase === 'countdown' || view.phase === 'racing';
		if ( racing ) this.open = false;
```

with

```js
		const racing = isRacing( view.phase );
		if ( racing && ! this.wasRacing ) this.open = false; // a race that just started closes the panel; "vs CPU" reopens it
		this.wasRacing = racing;
```

6. In `panelContent()`, replace

```js
		if ( view.phase === 'results' ) parts.push( ...this.resultsPart( view ) );
		else if ( ! view.available ) …
```

so that the chain reads:

```js
		if ( view.phase === 'results' ) parts.push( ...this.resultsPart( view ) );
		else if ( isRacing( view.phase ) ) parts.push( ...this.runningPart() );
		else if ( ! view.available ) parts.push( el( 'div', { className: 'message', text: t( 'cpu.noLoop', L ) } ) );
		else parts.push( ...this.settingsPart( view ) );
```

7. Add after `settingsPart()`:

```js
	// "vs CPU" clicked during a race: restart or quit it from here too.
	runningPart() {

		const L = this.lang;
		const leave = ( action ) => ( e ) => {

			this.open = false;
			this.act( e, action );
			this.render( this.race.view() );

		};

		return [
			el( 'div', { text: t( 'cpu.running', L ) } ),
			el( 'button', { className: 'primary', text: t( 'cpu.restart', L ), on: { click: leave( () => this.race.rematch() ) } } ),
			el( 'button', { text: t( 'cpu.quit', L ), on: { click: leave( () => this.race.quit() ) } } ),
		];

	}
```

8. In `updateLive()`, replace `this.quitButton.textContent = t( 'cpu.quit', L );` with:

```js
		this.restartButton.textContent = t( 'cpu.restart', L );
		this.quitButton.textContent = t( 'cpu.quit', L );
```

- [ ] **Step 5: Verify headless**

Run: `node --test test/*.test.mjs` — all pass (170). Serve the repo root and run `PORT=8765 python3 cpu_check.py` (appendix, updated for the new ids and steps).
Expected: `restart rematches 1 phase countdown trucks 2` (or `racing` — the countdown is 0.15 s at 20×), `vs CPU mid-race panel` shows `Race in progress` with both buttons, `after esc None trucks 0 hold False`, `de restart Neu starten`, `errors []`, `PASS`.

- [ ] **Step 6: Commit**

```bash
git add js/ui/strings.js js/ui/CpuPanel.js test/cpu-strings.test.mjs
git commit -m "feat(cpu): restart or quit a running CPU race any time

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WVkTufc2PiJjhhrWptUPLA"
```

---

### Task 6: Changelog and play-test

**Files:**
- Modify: `CHANGELOG.md` (`[Unreleased]`)

- [ ] **Step 1: Changelog entry**

Under `## [Unreleased]`, add these bullets to the `### Fixed` section after `### Added` — create the section if no other change has yet (sibling issues #12, #14–#18 may add one too). Written in English like every existing entry in the file:

```markdown
### Fixed

- vs CPU: the CPU trucks no longer stutter through corners, and bumping into one
  nudges your truck instead of flinging it away.
- vs CPU: you hear a crash when you and a CPU truck hit each other.
- vs CPU: restart or quit a running race at any time — with the buttons under the
  positions, from the **vs CPU** button, or with `Esc`.
```

- [ ] **Step 2: Manual play-test (headless Chromium cannot render the game here)**

Serve the repo root, default track, then The Aerodrome: vs CPU → 3 CPU trucks, medium, 3 laps → Start. Check:
- Follow a CPU truck through every corner: it glides, no sideways twitch.
- Drive alongside a CPU through a corner and lean into it: it pushes you aside, it does not fling you across the track. Rear-end one: you stop against it, no bounce. Park in front of one: it shoves you along (expected, see spec Out of scope).
- Each hit makes a crash sound (needs working audio — if nothing plays at all, including wall crashes, that is #12).
- Mid-race: **Neu starten/Restart** under the positions → countdown again, same settings. Click **vs CPU** → "Race in progress" with both buttons. Press `Esc` → free driving, lap timer shows the stored best lap. Click a race button, then press Space: nothing happens.
- Free driving: wall crashes sound and feel as before.

If bumps still feel too strong or too soft, change only `MAX_BUMP_GAIN` in `js/race/Bump.js` and note the value in the PR.

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): note vs CPU polish

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WVkTufc2PiJjhhrWptUPLA"
```

---

## Appendix: headless check runners (not committed)

### `bump` — save as `bump_check.py`, serve the repo root, run `PORT=<port> python3 bump_check.py`

```python
# Headless check for test/harness/bump.html. Serve the repo root first: python3 -m http.server 8765
import os
from playwright.sync_api import sync_playwright

BASE = f"http://localhost:{os.environ.get('PORT', '8765')}/test/harness/bump.html"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE)
    page.wait_for_function('window.result', timeout=60000)
    r = page.evaluate('window.result')
    for k, v in r.items():
        print(k, v)
    print('errors', errors)
    assert not errors
    assert r['headOn']['peakV'] <= 9.0, r['headOn']
    assert r['glancing']['peakV'] <= 6.5, r['glancing']
    assert r['headOn']['peakY'] <= 0.55 and r['glancing']['peakY'] <= 0.55
    assert len(r['headOn']['bumps']) == 1 and 9.5 <= r['headOn']['bumps'][0] <= 10.5, r['headOn']['bumps']
    assert r['teleport']['firstVy'] == 0 and r['teleport']['bodyX'] == 20 and r['teleport']['bodyV'] == 0
    assert r['teleport']['playerMoved'] < 0.01
    assert abs(r['noContact']['playerY'] - 0.5) < 0.05
    browser.close()
print('PASS')
```

### `cpu` — save as `cpu_check.py` (replaces the #4 runner), serve the repo root, run `PORT=<port> python3 cpu_check.py`

```python
# Headless check for test/harness/cpu.html. Serve the repo root first: python3 -m http.server 8765
import os
from playwright.sync_api import sync_playwright

BASE = f"http://localhost:{os.environ.get('PORT', '8765')}/test/harness/cpu.html"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(BASE)
    page.wait_for_function('window.ready')
    # The harness clock runs 20x: 10 laps keep the race going for several real seconds.
    page.click('#cpu-button')
    page.select_option('#cpu-panel select >> nth=0', '2')
    page.select_option('#cpu-panel select >> nth=2', '10')
    page.click('#cpu-panel button.primary')
    page.wait_for_function("window.hold === false", timeout=10000)
    assert page.inner_text('#cpu-restart') == 'Restart race'
    page.evaluate("window.rematches = 0; const r = race.rematch.bind(race); race.rematch = () => { window.rematches++; return r(); }")
    page.click('#cpu-restart')
    print('restart rematches', page.evaluate('window.rematches'), 'phase', page.evaluate('race.view().phase'), 'trucks', page.evaluate('game.opponents.trucks.size'))
    assert page.evaluate('window.rematches') == 1
    assert page.evaluate('race.view().phase') in ('countdown', 'racing')
    assert page.evaluate('game.opponents.trucks.size') == 2
    assert page.evaluate('document.activeElement.id') != 'cpu-restart'
    page.wait_for_function("window.hold === false", timeout=10000)
    page.click('#cpu-button')
    panel = page.inner_text('#cpu-panel')
    print('vs CPU mid-race panel', panel.replace('\n', ' | '))
    assert 'Race in progress' in panel and 'Restart race' in panel and 'Quit race' in panel
    page.click('#cpu-button')  # close it again
    page.keyboard.press('Escape')
    print('after esc', page.evaluate('race.view().phase'), 'trucks', page.evaluate('game.opponents.trucks.size'), 'hold', page.evaluate('window.hold'))
    assert page.evaluate('race.view().phase') is None
    page.keyboard.press('Escape')  # outside a race: nothing happens
    page.click('#cpu-button')
    page.click('#cpu-panel button.primary')
    page.wait_for_function("window.hold === false", timeout=10000)
    page.click('#cpu-quit')
    assert page.evaluate('race.view().phase') is None
    page.evaluate("window.GG_LANG = 'de'; window.dispatchEvent(new CustomEvent('gg-langchange'))")
    page.click('#cpu-button')
    page.click('#cpu-panel button.primary')
    page.wait_for_selector('#cpu-restart')
    print('de restart', page.inner_text('#cpu-restart'))
    assert page.inner_text('#cpu-restart') == 'Neu starten'
    print('errors', errors)
    assert not errors
    browser.close()
print('PASS')
```
