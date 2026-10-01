// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESET_TRACKS, trackHref } from '../js/Tracks.js';
import { decodeCells as decode, isDirt } from '../js/TrackCodec.js';
import { trackOrder } from '../js/race/TrackPath.js';

test( 'presets list the default track, the four Aerodrome Apex tracks and Bad Säckingen', () => {

	assert.deepEqual( PRESET_TRACKS.map( ( t ) => t.id ), [ 'default', 'aero', 'northants', 'styria', 'claypit', 'bad-saeckingen' ] );
	assert.equal( PRESET_TRACKS[ 0 ].map, null );

} );

test( 'trackHref_presets_addOsmOnlyWhenPresent', () => {

	assert.equal( trackHref( { map: null } ), 'index.html' );
	assert.equal( trackHref( { map: 'abc' } ), 'index.html?map=abc' );
	assert.equal( trackHref( { map: 'abc', osm: '1,2,3,4,10,0,0' } ), 'index.html?map=abc&osm=1,2,3,4,10,0,0' );
	const bs = PRESET_TRACKS.find( ( t ) => t.id === 'bad-saeckingen' );
	assert.match( trackHref( bs ), /^index\.html\?map=[\w-]+&osm=47\.5435,7\.94,47\.5565,7\.956,10,-?\d+,-?\d+$/ );

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

const ORIENT_DEG = { 0: 0, 10: 180, 16: 90, 22: 270 };
const forwardOf = ( orient ) => {

	const a = ORIENT_DEG[ orient ] * Math.PI / 180;
	return [ Math.round( Math.sin( a ) ) + 0, Math.round( Math.cos( a ) ) + 0 ];

};

test( 'claypit_isDirtWithARampATabletopAndWhoopsFacingTheDrivingDirection', () => {

	const cells = decode( PRESET_TRACKS.find( ( t ) => t.id === 'claypit' ).map );
	const order = trackOrder( cells );
	assert.ok( order, 'claypit is one closed loop' );

	for ( const c of cells ) assert.equal( isDirt( c ), c[ 2 ] !== 'track-finish', `${ c[ 0 ] },${ c[ 1 ] } ${ c[ 2 ] }` );

	for ( const type of [ 'track-ramp', 'track-tabletop', 'track-whoops' ] ) {

		const i = order.findIndex( ( o ) => o.cell[ 2 ] === type );
		assert.ok( i >= 0, `${ type } missing` );
		assert.deepEqual( forwardOf( order[ i ].cell[ 3 ] ), order[ i ].to, `${ type } faces backwards` );
		for ( const k of [ 1, 2 ] ) assert.equal( order[ ( i + k ) % order.length ].cell[ 2 ], 'track-straight', `${ type } lands on a ${ order[ ( i + k ) % order.length ].cell[ 2 ] }` );

	}

} );
