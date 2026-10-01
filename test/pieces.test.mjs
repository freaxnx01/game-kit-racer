import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PIECES, TYPE_BY_INDEX, pieceModelNames, profileOf, profileMax, ELEMENT_CYCLE, isStraightLike } from '../js/Pieces.js';

const close = ( a, b, eps = 1e-9 ) => assert.ok( Math.abs( a - b ) < eps, `${ a } ≉ ${ b }` );

test( 'PIECES_indices_areUniqueAndKeepTheOldFour', () => {

	const indices = Object.values( PIECES ).map( ( p ) => p.index );
	assert.equal( new Set( indices ).size, indices.length );
	assert.deepEqual( TYPE_BY_INDEX.slice( 0, 7 ), [ 'track-straight', 'track-corner', 'track-bump', 'track-finish', 'track-ramp', 'track-tabletop', 'track-whoops' ] );
	for ( const p of Object.values( PIECES ) ) assert.ok( p.index >= 0 && p.index < 32 );

} );

test( 'PIECES_everyPiece_hasExactlyAModelOrAProfile', () => {

	for ( const [ type, p ] of Object.entries( PIECES ) ) assert.ok( !! p.model !== !! p.profile, type );
	assert.deepEqual( pieceModelNames(), [ 'track-straight', 'track-corner', 'track-bump', 'track-finish' ] );

} );

test( 'profileOf_ramp_risesToTheLipThenDropsToTheFloor', () => {

	const h = profileOf( 'track-ramp' );
	close( h( 0 ), 0 );
	assert.ok( h( 0.375 ) > 0 && h( 0.375 ) < h( 0.75 ) );
	assert.ok( h( 0.75 ) > 1 );
	close( h( 0.8 ), 0 );
	close( h( 1 ), 0 );

} );

test( 'profileOf_tabletop_hasAFlatPlateauAndEndsOnTheFloor', () => {

	const h = profileOf( 'track-tabletop' );
	close( h( 0 ), 0 );
	close( h( 0.4 ), h( 0.55 ) );
	assert.ok( h( 0.4 ) > 0.5 );
	close( h( 1 ), 0 );
	assert.ok( h( 0.9 ) < h( 0.7 ) ); // gentle landing slope

} );

test( 'profileOf_whoops_hasThreeHumpsAndStartsAndEndsFlat', () => {

	const h = profileOf( 'track-whoops' );
	close( h( 0 ), 0 );
	close( h( 1 ), 0 );
	let peaks = 0;
	for ( let i = 1; i < 199; i ++ ) if ( h( i / 200 ) > h( ( i - 1 ) / 200 ) && h( i / 200 ) >= h( ( i + 1 ) / 200 ) ) peaks ++;
	assert.equal( peaks, 3 );

} );

test( 'profileOf_glbPiece_isNull', () => {

	assert.equal( profileOf( 'track-straight' ), null );
	assert.equal( profileOf( 'nonsense' ), null );
	assert.equal( profileMax( 'track-corner' ), 0 );
	assert.ok( profileMax( 'track-ramp' ) > 1 );

} );

test( 'isStraightLike_newPieces_connectLikeStraights', () => {

	for ( const t of [ 'track-straight', 'track-bump', 'track-finish', 'track-ramp', 'track-tabletop', 'track-whoops' ] ) assert.equal( isStraightLike( t ), true, t );
	assert.equal( isStraightLike( 'track-corner' ), false );
	assert.deepEqual( ELEMENT_CYCLE, [ 'track-straight', 'track-ramp', 'track-tabletop', 'track-whoops' ] );

} );
