// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPath, samplePath } from '../js/race/TrackPath.js';
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
