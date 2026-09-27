// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleGhost } from '../js/race/Ghost.js';

const Q0 = [ 0, 0, 0, 1 ];
const Q90 = [ 0, Math.SQRT1_2, 0, Math.SQRT1_2 ];
const sample = ( t, x, q = Q0 ) => [ t, x, 0, 0, ...q ];
const near = ( a, b, eps = 1e-9 ) => assert.ok( Math.abs( a - b ) < eps, `${ a } vs ${ b }` );

test( 'sampleGhost_noGhost_returnsNull', () => {

	assert.equal( sampleGhost( null, 1 ), null );

} );

test( 'sampleGhost_betweenSamples_blendsPositionAndRotation', () => {

	const ghost = { time: 1, samples: [ sample( 0, 0, Q0 ), sample( 1, 10, Q90 ) ] };
	const pose = sampleGhost( ghost, 0.5 );
	near( pose.p[ 0 ], 5 );
	near( Math.hypot( ...pose.q ), 1 );
	near( pose.q[ 1 ], Math.sin( Math.PI / 8 ), 1e-3 );

} );

test( 'sampleGhost_exactlyOnSample_returnsThatSample', () => {

	const ghost = { time: 2, samples: [ sample( 0, 0 ), sample( 1, 4 ), sample( 2, 9 ) ] };
	near( sampleGhost( ghost, 1 ).p[ 0 ], 4 );

} );

test( 'sampleGhost_beforeFirstSample_holdsFirst', () => {

	const ghost = { time: 1, samples: [ sample( 0.2, 3 ), sample( 1, 4 ) ] };
	near( sampleGhost( ghost, 0 ).p[ 0 ], 3 );

} );

test( 'sampleGhost_afterLapTime_returnsNull', () => {

	const ghost = { time: 1, samples: [ sample( 0, 0 ), sample( 1, 4 ) ] };
	assert.equal( sampleGhost( ghost, 1.01 ), null );

} );

test( 'sampleGhost_oppositeQuaternionSigns_takesShortArc', () => {

	const ghost = { time: 1, samples: [ sample( 0, 0, Q0 ), sample( 1, 0, [ 0, 0, 0, - 1 ] ) ] };
	const pose = sampleGhost( ghost, 0.5 );
	near( Math.abs( pose.q[ 3 ] ), 1 );

} );
