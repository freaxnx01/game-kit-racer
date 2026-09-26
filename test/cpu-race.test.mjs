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
