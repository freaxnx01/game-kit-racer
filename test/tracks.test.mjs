// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESET_TRACKS } from '../js/Tracks.js';

const TYPE_NAMES = [ 'track-straight', 'track-corner', 'track-bump', 'track-finish' ];
const ORIENT_TO_GODOT = [ 0, 16, 10, 22 ];

// Same byte layout as decodeCells in js/Track.js (which needs three.js, so not imported here)
function decode( str ) {

	const bytes = Buffer.from( str.replace( /-/g, '+' ).replace( /_/g, '/' ), 'base64' );
	const cells = [];
	for ( let i = 0; i + 2 < bytes.length; i += 3 ) {

		cells.push( [ bytes[ i ] - 128, bytes[ i + 1 ] - 128, TYPE_NAMES[ bytes[ i + 2 ] >> 2 ], ORIENT_TO_GODOT[ bytes[ i + 2 ] & 3 ] ] );

	}

	return cells;

}

test( 'presets list the default track plus the four Aerodrome Apex tracks', () => {

	assert.deepEqual( PRESET_TRACKS.map( ( t ) => t.id ), [ 'default', 'aero', 'northants', 'styria', 'claypit' ] );
	assert.equal( PRESET_TRACKS[ 0 ].map, null );

} );

for ( const t of PRESET_TRACKS.filter( ( t ) => t.map ) ) {

	test( `${ t.name } decodes to a single closed loop`, () => {

		const cells = decode( t.map );
		assert.ok( cells.length >= 40, `only ${ cells.length } cells` );
		assert.equal( cells[ 0 ][ 2 ], 'track-finish' );
		assert.equal( cells.filter( ( c ) => c[ 2 ] === 'track-finish' ).length, 1 );
		assert.equal( new Set( cells.map( ( c ) => c[ 0 ] + ',' + c[ 1 ] ) ).size, cells.length, 'cell driven twice' );

		// Every cell has exactly two track neighbours → no branches, one loop
		const has = new Set( cells.map( ( c ) => c[ 0 ] + ',' + c[ 1 ] ) );
		for ( const [ x, z ] of cells ) {

			const n = [ [ 1, 0 ], [ - 1, 0 ], [ 0, 1 ], [ 0, - 1 ] ].filter( ( [ dx, dz ] ) => has.has( ( x + dx ) + ',' + ( z + dz ) ) ).length;
			assert.ok( n >= 2, `cell ${ x },${ z } has ${ n } neighbours` );

		}

	} );

}
