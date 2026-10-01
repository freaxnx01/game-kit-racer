// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sliceAlongZ, liftByProfile, colliderGrid, evenCuts, dirtPatch } from '../js/ProfileGeometry.js';

const triangles = ( pos ) => pos.length / 9;
const area = ( pos ) => {

	let sum = 0;
	for ( let i = 0; i < pos.length; i += 9 ) {

		const ax = pos[ i + 3 ] - pos[ i ], az = pos[ i + 5 ] - pos[ i + 2 ];
		const bx = pos[ i + 6 ] - pos[ i ], bz = pos[ i + 8 ] - pos[ i + 2 ];
		sum += Math.abs( ax * bz - az * bx ) / 2;

	}

	return sum;

};

test( 'evenCuts_fourSteps_givesThreeInteriorPlanes', () => {

	assert.deepEqual( evenCuts( 5, 4 ), [ - 2.5, 0, 2.5 ] );

} );

test( 'sliceAlongZ_quadAcrossTheCell_keepsAreaAndCrossesNoPlane', () => {

	// A 10×10 quad on y = 0 as two triangles, uv = ( x, z ) / 10 + 0.5
	const P = [ - 5, 0, - 5, 5, 0, 5, 5, 0, - 5, - 5, 0, - 5, - 5, 0, 5, 5, 0, 5 ];
	const U = [ 0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1 ];
	const cuts = evenCuts( 5, 4 );
	const out = sliceAlongZ( P, U, cuts );
	assert.ok( Math.abs( area( out.positions ) - 100 ) < 1e-9 );
	assert.equal( out.uvs.length / 6, triangles( out.positions ) );
	for ( let i = 0; i < out.positions.length; i += 9 ) {

		const zs = [ out.positions[ i + 2 ], out.positions[ i + 5 ], out.positions[ i + 8 ] ];
		for ( const c of cuts ) assert.ok( ! ( Math.min( ...zs ) < c - 1e-9 && Math.max( ...zs ) > c + 1e-9 ), `triangle crosses z=${ c }` );

	}

	// uv is interpolated linearly with position
	for ( let v = 0; v < out.positions.length / 3; v ++ ) {

		assert.ok( Math.abs( out.uvs[ v * 2 ] - ( out.positions[ v * 3 ] / 10 + 0.5 ) ) < 1e-9 );
		assert.ok( Math.abs( out.uvs[ v * 2 + 1 ] - ( out.positions[ v * 3 + 2 ] / 10 + 0.5 ) ) < 1e-9 );

	}

} );

test( 'sliceAlongZ_triangleOnOneSide_isUnchanged', () => {

	const P = [ 0, 0, 3, 1, 0, 4, 1, 0, 3 ];
	const U = [ 0, 0, 1, 1, 1, 0 ];
	assert.deepEqual( sliceAlongZ( P, U, [ 0 ] ), { positions: P, uvs: U } );

} );

test( 'liftByProfile_addsTheProfileHeightAtEachVertexZ', () => {

	const lifted = liftByProfile( [ 1, 0.5, - 5, 2, 0.75, 0, 3, 0, 5 ], ( t ) => t * 2, 5 );
	assert.deepEqual( lifted, [ 1, 0.5, - 5, 2, 1.75, 0, 3, 2, 5 ] );

} );

test( 'colliderGrid_followsTheProfileAndFacesUp', () => {

	const { positions, indices } = colliderGrid( ( t ) => t, 4, 5, 2 );
	assert.equal( positions.length, 3 * 2 * 3 );
	assert.equal( indices.length, 2 * 2 * 3 );
	// vertex rows at z = -5, 0, 5 with heights 0, 0.5, 1
	assert.deepEqual( [ positions[ 1 ], positions[ 7 ], positions[ 13 ] ], [ 0, 0.5, 1 ] );
	for ( let i = 0; i < indices.length; i += 3 ) {

		const [ a, b, c ] = [ indices[ i ], indices[ i + 1 ], indices[ i + 2 ] ].map( ( k ) => positions.slice( k * 3, k * 3 + 3 ) );
		const ux = b[ 0 ] - a[ 0 ], uy = b[ 1 ] - a[ 1 ], uz = b[ 2 ] - a[ 2 ];
		const vx = c[ 0 ] - a[ 0 ], vy = c[ 1 ] - a[ 1 ], vz = c[ 2 ] - a[ 2 ];
		assert.ok( uz * vx - ux * vz > 0, 'triangle must face up' ); // y of u × v

	}

} );

test( 'dirtPatch_straight_coversTheRoadJustAboveIt', () => {

	const { positions, uvs } = dirtPatch( 'straight', null, 4 );
	assert.equal( uvs.length / 2, positions.length / 3 );
	const xs = [], ys = [];
	for ( let i = 0; i < positions.length; i += 3 ) { xs.push( positions[ i ] ); ys.push( positions[ i + 1 ] ); }
	assert.equal( Math.min( ...xs ), - 4.5 );
	assert.equal( Math.max( ...xs ), 4.5 );
	assert.ok( ys.every( ( y ) => Math.abs( y - 0.02 ) < 1e-9 ) );

} );

test( 'dirtPatch_withProfile_followsIt', () => {

	const { positions } = dirtPatch( 'straight', ( t ) => t, 4 );
	for ( let i = 0; i < positions.length; i += 3 ) assert.ok( Math.abs( positions[ i + 1 ] - ( 0.02 + positions[ i + 2 ] / 9.99 + 0.5 ) ) < 1e-6 );

} );

test( 'dirtPatch_corner_isAQuarterRingAroundTheArcCentre', () => {

	const { positions } = dirtPatch( 'corner', null, 8 );
	for ( let i = 0; i < positions.length; i += 3 ) {

		const r = Math.hypot( positions[ i ] + 4.995, positions[ i + 2 ] - 4.995 );
		assert.ok( r > 0.49 && r < 9.51, `r = ${ r }` );

	}

} );

test( 'dirtPatch_bothShapes_everyTriangleFacesUp', () => {

	for ( const shape of [ 'straight', 'corner' ] ) {

		const { positions } = dirtPatch( shape, null, 8 );
		for ( let i = 0; i < positions.length; i += 9 ) {

			const [ a, b, c ] = [
				[ positions[ i ], positions[ i + 1 ], positions[ i + 2 ] ],
				[ positions[ i + 3 ], positions[ i + 4 ], positions[ i + 5 ] ],
				[ positions[ i + 6 ], positions[ i + 7 ], positions[ i + 8 ] ],
			];
			const ux = b[ 0 ] - a[ 0 ], uz = b[ 2 ] - a[ 2 ];
			const vx = c[ 0 ] - a[ 0 ], vz = c[ 2 ] - a[ 2 ];
			assert.ok( uz * vx - ux * vz > 0, `${ shape } triangle ${ i / 9 } must face up (cross product y=${ uz * vx - ux * vz })` );

		}

	}

} );
