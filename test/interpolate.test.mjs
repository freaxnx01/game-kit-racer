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
