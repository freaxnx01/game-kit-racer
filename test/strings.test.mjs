// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, t, funnyName, FUNNY_NAMES } from '../js/ui/strings.js';
import { cleanName } from '../js/net/Protocol.js';

test( 'STRINGS_everyKey_existsInBothLanguages', () => {

	assert.deepEqual( Object.keys( STRINGS.de ).sort(), Object.keys( STRINGS.en ).sort() );
	for ( const lang of [ 'en', 'de' ] ) for ( const [ k, v ] of Object.entries( STRINGS[ lang ] ) ) assert.ok( v.trim(), `${ lang } ${ k } empty` );

} );

test( 'STRINGS_placeholders_matchAcrossLanguages', () => {

	const holes = ( s ) => ( s.match( /\{\w+\}/g ) ?? [] ).sort().join();
	for ( const k of Object.keys( STRINGS.en ) ) assert.equal( holes( STRINGS.de[ k ] ), holes( STRINGS.en[ k ] ), k );

} );

test( 't_placeholdersAndFallbacks_work', () => {

	assert.equal( t( 'mp.lapOf', 'de', { lap: 2, laps: 3 } ), 'Runde 2/3' );
	assert.equal( t( 'mp.lapOf', 'fr', { lap: 2, laps: 3 } ), 'Lap 2/3' );
	assert.equal( t( 'mp.nope', 'en' ), 'mp.nope' );
	assert.equal( t( 'mp.playerLeft', 'en' ), '{name} left' );

} );

test( 'funnyName_everyDefault_isAValidPlayerName', () => {

	for ( const name of FUNNY_NAMES ) assert.equal( cleanName( name ), name );
	assert.equal( funnyName( () => 0 ), FUNNY_NAMES[ 0 ] );

} );
