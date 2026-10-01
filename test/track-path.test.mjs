// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESET_TRACKS } from '../js/Tracks.js';
import { openSides, trackOrder, buildPath, samplePath } from '../js/race/TrackPath.js';
import { decodeCells as decode } from '../js/TrackCodec.js';

const CELL = 9.99 * 0.75;

// TRACK_CELLS from js/Track.js (the default circuit), copied because Track.js imports three.js.
const DEFAULT_TRACK = [
	[ - 3, - 3, 'track-corner', 16 ], [ - 2, - 3, 'track-straight', 22 ], [ - 1, - 3, 'track-straight', 22 ], [ 0, - 3, 'track-corner', 0 ],
	[ - 3, - 2, 'track-straight', 0 ], [ 0, - 2, 'track-straight', 0 ], [ - 3, - 1, 'track-corner', 10 ], [ - 2, - 1, 'track-corner', 0 ],
	[ 0, - 1, 'track-straight', 0 ], [ - 2, 0, 'track-straight', 10 ], [ 0, 0, 'track-finish', 0 ], [ - 2, 1, 'track-straight', 10 ],
	[ 0, 1, 'track-straight', 0 ], [ - 2, 2, 'track-corner', 10 ], [ - 1, 2, 'track-straight', 16 ], [ 0, 2, 'track-corner', 22 ],
];

test( 'openSides_cornerAtEachOrientation_matchesTheDefaultTrack', () => {

	assert.deepEqual( openSides( 'track-corner', 0 ), [ [ - 1, 0 ], [ 0, 1 ] ] );
	assert.deepEqual( openSides( 'track-corner', 16 ), [ [ 0, 1 ], [ 1, 0 ] ] );
	assert.deepEqual( openSides( 'track-corner', 10 ), [ [ 1, 0 ], [ 0, - 1 ] ] );
	assert.deepEqual( openSides( 'track-corner', 22 ), [ [ 0, - 1 ], [ - 1, 0 ] ] );
	assert.deepEqual( openSides( 'track-straight', 22 ), [ [ - 1, 0 ], [ 1, 0 ] ] );
	assert.equal( openSides( 'decoration-forest', 0 ), null );

} );

test( 'trackOrder_defaultTrack_startsAtFinishAndFollowsItsDirection', () => {

	const order = trackOrder( DEFAULT_TRACK );
	assert.equal( order.length, DEFAULT_TRACK.length );
	assert.deepEqual( order.slice( 0, 4 ).map( ( o ) => o.cell.slice( 0, 2 ) ), [ [ 0, 0 ], [ 0, 1 ], [ 0, 2 ], [ - 1, 2 ] ] );

} );

for ( const t of PRESET_TRACKS.filter( ( t ) => t.map ) ) {

	test( `trackOrder_${ t.id }_visitsEveryCellOnce`, () => {

		const cells = decode( t.map );
		const order = trackOrder( cells );
		assert.ok( order, 'no loop found' );
		assert.equal( new Set( order.map( ( o ) => o.cell ) ).size, cells.length );

	} );

}

test( 'trackOrder_touchingParallelLanes_followsPiecesNotGridNeighbours', () => {

	// The Aerodrome has cells with three or four track neighbours (lanes side by side); the walk must
	// still use piece connectivity and find the single loop.
	const aero = decode( PRESET_TRACKS.find( ( t ) => t.id === 'aero' ).map );
	const has = new Set( aero.map( ( c ) => c[ 0 ] + ',' + c[ 1 ] ) );
	const crowded = aero.filter( ( [ x, z ] ) => [ [ 1, 0 ], [ - 1, 0 ], [ 0, 1 ], [ 0, - 1 ] ].filter( ( [ dx, dz ] ) => has.has( ( x + dx ) + ',' + ( z + dz ) ) ).length > 2 );
	assert.ok( crowded.length > 0, 'fixture no longer has touching lanes' );
	assert.equal( trackOrder( aero ).length, aero.length );

} );

test( 'trackOrder_reversedFinish_drivesTheLoopTheOtherWay', () => {

	const reversed = DEFAULT_TRACK.map( ( c ) => c[ 2 ] === 'track-finish' ? [ 0, 0, 'track-finish', 10 ] : c );
	assert.deepEqual( trackOrder( reversed )[ 1 ].cell.slice( 0, 2 ), [ 0, - 1 ] );

} );

test( 'trackOrder_brokenOrOpenTrack_returnsNull', () => {

	assert.equal( trackOrder( DEFAULT_TRACK.filter( ( c ) => c[ 0 ] !== - 1 || c[ 1 ] !== 2 ) ), null, 'gap' );
	assert.equal( trackOrder( DEFAULT_TRACK.filter( ( c ) => c[ 2 ] !== 'track-finish' ) ), null, 'no finish' );
	assert.equal( trackOrder( [ ...DEFAULT_TRACK, [ 5, 5, 'track-straight', 0 ] ] ), null, 'stray cell' );
	assert.equal( trackOrder( DEFAULT_TRACK.map( ( c ) => c[ 0 ] === 0 && c[ 1 ] === 2 ? [ 0, 2, 'track-corner', 16 ] : c ) ), null, 'corner turned wrong' );
	assert.equal( trackOrder( [] ), null, 'empty' );

} );

test( 'buildPath_defaultTrack_isAClosedLoopStartingOnTheFinishLine', () => {

	const path = buildPath( DEFAULT_TRACK, CELL );
	assert.deepEqual( path.points[ 0 ], [ 0.5 * CELL, 0.5 * CELL ] );
	assert.deepEqual( path.points.at( - 1 ), path.points[ 0 ] );
	assert.equal( path.corner.length, path.points.length - 1 );
	// 10 straight-ish cells at one cell each plus 6 quarter arcs of radius half a cell
	assert.ok( Math.abs( path.length - ( 10 * CELL + 6 * Math.PI / 4 * CELL ) ) < 0.2, `length ${ path.length }` );
	assert.equal( buildPath( DEFAULT_TRACK.slice( 1 ), CELL ), null );

} );

test( 'samplePath_wrapsAndOffsetsToTheRight', () => {

	const path = buildPath( DEFAULT_TRACK, CELL );
	const start = samplePath( path, 0, 1 );
	assert.ok( Math.abs( start.x - ( 0.5 * CELL + 1 ) ) < 1e-9 && Math.abs( start.z - 0.5 * CELL ) < 1e-9 );
	assert.equal( start.heading, 0 );
	assert.equal( start.corner, false );
	const wrapped = samplePath( path, path.length + 2 );
	const plain = samplePath( path, 2 );
	assert.ok( Math.abs( wrapped.x - plain.x ) < 1e-9 && Math.abs( wrapped.z - plain.z ) < 1e-9 );
	const behind = samplePath( path, - 3 );
	assert.ok( Math.abs( behind.z - ( 0.5 * CELL - 3 ) ) < 1e-9, 'negative distances wrap to the end of the lap' );
	assert.equal( samplePath( path, 2 * CELL + 1 ).corner, true, 'third cell is a corner' );

} );
