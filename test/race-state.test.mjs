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
