import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTerrain, localT } from '../js/Terrain.js';
import { profileOf } from '../js/Pieces.js';

const CELL = 9.99 * 0.75, S = 0.75;
const close = ( a, b, eps = 1e-9 ) => assert.ok( Math.abs( a - b ) < eps, `${ a } ≉ ${ b }` );
const centre = ( g ) => ( g + 0.5 ) * CELL;

test( 'localT_eachOrientation_runsAlongThePieceForward', () => {

	// orientation 0 → forward +z; 16 (90°) → +x; 10 (180°) → -z; 22 (270°) → -x
	const cases = [ [ 0, [ 0, 1 ] ], [ 16, [ 1, 0 ] ], [ 10, [ 0, - 1 ] ], [ 22, [ - 1, 0 ] ] ];
	for ( const [ orient, [ fx, fz ] ] of cases ) {

		const cell = [ 2, - 3, 'track-ramp', orient ];
		close( localT( cell, centre( 2 ), centre( - 3 ), CELL ), 0.5 );
		close( localT( cell, centre( 2 ) + fx * CELL * 0.25, centre( - 3 ) + fz * CELL * 0.25, CELL ), 0.75 );

	}

} );

test( 'heightAt_rampCell_isTheScaledProfile', () => {

	const terrain = makeTerrain( [ [ 0, 0, 'track-ramp', 0 ] ], CELL, S );
	const h = profileOf( 'track-ramp' );
	close( terrain.heightAt( centre( 0 ), centre( 0 ) ), h( 0.5 ) * S );
	close( terrain.heightAt( centre( 0 ), centre( 0 ) + CELL * 0.25 ), h( 0.75 ) * S );

} );

test( 'heightAt_flatPiecesAndOffTrack_areZero', () => {

	const terrain = makeTerrain( [ [ 0, 0, 'track-straight', 0 ], [ 0, 1, 'track-corner', 0 ] ], CELL, S );
	assert.equal( terrain.heightAt( centre( 0 ), centre( 0 ) ), 0 );
	assert.equal( terrain.heightAt( centre( 0 ), centre( 1 ) ), 0 );
	assert.equal( terrain.heightAt( 1000, - 1000 ), 0 );

} );

test( 'surfaceAt_dirtFlag_andCellBorders', () => {

	const terrain = makeTerrain( [ [ 0, 0, 'track-straight', 0, { dirt: true } ], [ 1, 0, 'track-straight', 16 ] ], CELL, S );
	assert.equal( terrain.surfaceAt( centre( 0 ), centre( 0 ) ), 'dirt' );
	assert.equal( terrain.surfaceAt( centre( 1 ), centre( 0 ) ), 'asphalt' );
	assert.equal( terrain.surfaceAt( CELL, centre( 0 ) ), 'asphalt' );         // exactly on the border → cell 1
	assert.equal( terrain.surfaceAt( CELL - 1e-6, centre( 0 ) ), 'dirt' );
	assert.equal( terrain.surfaceAt( - 500, 500 ), 'asphalt' );

} );

test( 'normalAt_upSlopeOfARamp_tiltsBackAgainstTheDrivingDirection', () => {

	const terrain = makeTerrain( [ [ 0, 0, 'track-ramp', 0 ] ], CELL, S );
	const [ nx, ny, nz ] = terrain.normalAt( centre( 0 ), centre( 0 ) );
	close( Math.hypot( nx, ny, nz ), 1, 1e-6 );
	assert.ok( nz < 0 && ny > 0.9 );
	close( nx, 0, 1e-6 );
	assert.deepEqual( makeTerrain( [], CELL, S ).normalAt( 0, 0 ), [ 0, 1, 0 ] );

} );
