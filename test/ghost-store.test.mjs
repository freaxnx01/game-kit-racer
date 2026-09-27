// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeGhost, decodeGhost, loadGhost, saveGhost, ghostStorageKey } from '../js/race/Ghost.js';

const Q0 = [ 0, 0, 0, 1 ];
const Q90 = [ 0, Math.SQRT1_2, 0, Math.SQRT1_2 ];
const sample = ( t, x, q = Q0 ) => [ t, x, 0, 0, ...q ];
const near = ( a, b, eps = 1e-9 ) => assert.ok( Math.abs( a - b ) < eps, `${ a } vs ${ b }` );

function fakeStorage() {

	const map = new Map();
	return {
		getItem: ( k ) => map.has( k ) ? map.get( k ) : null,
		setItem: ( k, v ) => map.set( k, String( v ) ),
	};

}

test( 'ghostStorageKey_noTrackId_usesDefault', () => {

	assert.equal( ghostStorageKey( null ), 'racing.ghost.default' );
	assert.equal( ghostStorageKey( 'abc' ), 'racing.ghost.abc' );

} );

test( 'encodeGhost_thenDecode_roundTripsRounded', () => {

	const ghost = { time: 1.23456, samples: [ sample( 0, 1.00049 ), sample( 1.23456, 2, Q90 ) ] };
	const back = decodeGhost( encodeGhost( ghost ) );
	near( back.time, 1.235 );
	assert.equal( back.samples.length, 2 );
	near( back.samples[ 0 ][ 1 ], 1 );
	near( back.samples[ 1 ][ 5 ], 0.707 );

} );

test( 'decodeGhost_garbage_returnsNull', () => {

	for ( const text of [ null, '', 'not json', '{}', '[]', '{"v":2,"time":1,"s":[]}',
		'{"v":1,"time":1,"s":[0,0,0,0,0,0,0,1]}',
		'{"v":1,"time":1,"s":[0,0,0,0,0,0,0,1,1,0,0,0,0,0,0]}',
		'{"v":1,"time":-1,"s":[0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,1]}',
		'{"v":1,"time":1,"s":[1,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1]}',
		'{"v":1,"time":1,"s":[0,"x",0,0,0,0,0,1,1,0,0,0,0,0,0,1]}',
		'{"v":1,"time":9999,"s":[0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,1]}' ] ) {

		assert.equal( decodeGhost( text ), null, String( text ) );

	}

} );

test( 'saveGhost_thenLoadGhost_returnsTheGhost', () => {

	const storage = fakeStorage();
	saveGhost( 'racing.ghost.x', { time: 1, samples: [ sample( 0, 0 ), sample( 1, 5 ) ] }, storage );
	const back = loadGhost( 'racing.ghost.x', storage );
	near( back.time, 1 );
	near( back.samples[ 1 ][ 1 ], 5 );

} );

test( 'loadGhost_missingOrThrowingStorage_returnsNull', () => {

	assert.equal( loadGhost( 'racing.ghost.none', fakeStorage() ), null );
	const broken = { getItem() { throw new Error( 'denied' ); }, setItem() { throw new Error( 'full' ); } };
	assert.equal( loadGhost( 'k', broken ), null );
	assert.doesNotThrow( () => saveGhost( 'k', { time: 1, samples: [ sample( 0, 0 ), sample( 1, 1 ) ] }, broken ) );

} );
