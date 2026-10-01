// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeCells, decodeCells, isDirt } from '../js/TrackCodec.js';
import { encodeTrackCells } from '../js/OsmTrack.js';
import { PRESET_TRACKS } from '../js/Tracks.js';

// The decoder every preset was written for: 2-bit type, no dirt.
function oldDecode( str ) {

	const OLD = [ 'track-straight', 'track-corner', 'track-bump', 'track-finish' ];
	const bytes = Buffer.from( str.replace( /-/g, '+' ).replace( /_/g, '/' ), 'base64' );
	const cells = [];
	for ( let i = 0; i + 2 < bytes.length; i += 3 ) cells.push( [ bytes[ i ] - 128, bytes[ i + 1 ] - 128, OLD[ ( bytes[ i + 2 ] >> 2 ) & 3 ], [ 0, 16, 10, 22 ][ bytes[ i + 2 ] & 3 ] ] );
	return cells;

}

for ( const t of PRESET_TRACKS.filter( ( t ) => t.map && t.id !== 'claypit' ) ) {

	test( `decodeCells_preset_${ t.id }_matchesTheOldTwoBitDecoder`, () => {

		assert.deepEqual( decodeCells( t.map ), oldDecode( t.map ) );
		assert.equal( encodeCells( decodeCells( t.map ) ), t.map );

	} );

}

test( 'encodeCells_newTypesAndDirt_roundTrip', () => {

	const cells = [
		[ 0, 0, 'track-finish', 0 ],
		[ 0, 1, 'track-ramp', 10 ],
		[ 0, 2, 'track-tabletop', 16, { dirt: true } ],
		[ - 5, 3, 'track-whoops', 22, { dirt: true } ],
		[ 7, - 9, 'track-corner', 16, { dirt: true } ],
	];
	assert.deepEqual( decodeCells( encodeCells( cells ) ), cells );

} );

test( 'decodeCells_unknownTypeIndex_fallsBackToStraight', () => {

	const bytes = Buffer.from( [ 128, 128, ( 31 << 2 ) | 1 ] );
	const str = bytes.toString( 'base64' ).replace( /\+/g, '-' ).replace( /\//g, '_' ).replace( /=+$/, '' );
	assert.deepEqual( decodeCells( str ), [ [ 0, 0, 'track-straight', 16 ] ] );

} );

test( 'isDirt_fifthField_isTheOnlySource', () => {

	assert.equal( isDirt( [ 0, 0, 'track-straight', 0 ] ), false );
	assert.equal( isDirt( [ 0, 0, 'track-straight', 0, { dirt: true } ] ), true );

} );

test( 'encodeTrackCells_osm_matchesTheSharedEncoder', () => {

	const cells = [ [ 0, 0, 'track-finish', 0 ], [ 0, 1, 'track-straight', 0 ], [ 1, 1, 'track-corner', 22 ] ];
	assert.equal( encodeTrackCells( cells ), encodeCells( cells ) );

} );
