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
