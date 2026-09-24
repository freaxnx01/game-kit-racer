// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
	overpassQuery, fetchOverpass, OVERPASS_MIRRORS, buildGraph, makeProjection,
	perimeterLoop, simplifyPolyline, rasterizeLoop, loopToTrackCells, trackStats,
} from '../js/OsmTrack.js';

const fixture = JSON.parse( fs.readFileSync( new URL( './fixtures/sisseln.json', import.meta.url ) ) );

// In-memory stand-in for the Web Storage API (length, key, getItem, setItem, removeItem).
const memoryStorage = () => {

	const m = new Map();
	return {
		get length() {

			return m.size;

		},
		key: ( i ) => [ ...m.keys() ][ i ] ?? null,
		getItem: ( k ) => m.get( k ) ?? null,
		setItem: ( k, v ) => m.set( k, String( v ) ),
		removeItem: ( k ) => m.delete( k ),
		size: () => m.size,
	};

};

const okResponse = ( body ) => ( { ok: true, status: 200, json: async () => body } );

test( 'overpassQuery_withBuildings_addsBuildingWays', () => {

	assert.match( overpassQuery( [ 1, 2, 3, 4 ], 'residential', { buildings: true } ), /way\["building"\]\(1,2,3,4\);/ );
	assert.doesNotMatch( overpassQuery( [ 1, 2, 3, 4 ], 'residential' ), /building/ );

} );

test( 'buildGraph_responseWithBuildings_usesRoadsOnly', () => {

	const graph = buildGraph( fixture, makeProjection( fixture.bbox ) );
	const roadWays = fixture.elements.filter( ( el ) => el.type === 'way' && el.tags.highway ).length;
	assert.equal( graph.ways.length, roadWays );
	assert.ok( graph.ways.every( ( w ) => w.highway ) );

} );

test( 'fetchOverpass_cachedQuery_skipsNetwork', async () => {

	const storage = memoryStorage();
	storage.setItem( 'osm-track.cache.Q', JSON.stringify( { elements: [ 1 ] } ) );
	const fetchImpl = () => assert.fail( 'network used despite cache' );
	const { osm, source } = await fetchOverpass( 'Q', { storage, fetchImpl } );
	assert.deepEqual( osm, { elements: [ 1 ] } );
	assert.equal( source, 'cache' );

} );

test( 'fetchOverpass_firstMirrorDown_usesNextAndCaches', async () => {

	const storage = memoryStorage();
	const tried = [];
	const fetchImpl = async ( url ) => url === OVERPASS_MIRRORS[ 0 ] ? { ok: false, status: 504 } : okResponse( { elements: [ 1 ] } );
	const { source } = await fetchOverpass( 'Q', { storage, fetchImpl, onTry: ( h ) => tried.push( h ) } );
	assert.equal( source, new URL( OVERPASS_MIRRORS[ 1 ] ).host );
	assert.equal( tried.length, 2 );
	assert.equal( storage.size(), 1 );

} );

test( 'fetchOverpass_newAnswer_evictsOtherCachedQueriesOnly', async () => {

	const storage = memoryStorage();
	storage.setItem( 'osm-track.cache.OLD1', JSON.stringify( { elements: [ 1 ] } ) );
	storage.setItem( 'racing.bestLap.x', '42.1' );
	storage.setItem( 'osm-track.cache.OLD2', JSON.stringify( { elements: [ 2 ] } ) );
	storage.setItem( 'gg-lang', 'de' );
	const fetchImpl = async () => okResponse( { elements: [ 3 ] } );
	await fetchOverpass( 'Q', { storage, fetchImpl } );
	assert.equal( storage.getItem( 'osm-track.cache.OLD1' ), null );
	assert.equal( storage.getItem( 'osm-track.cache.OLD2' ), null );
	assert.equal( storage.getItem( 'osm-track.cache.Q' ), JSON.stringify( { elements: [ 3 ] } ) );
	assert.equal( storage.getItem( 'racing.bestLap.x' ), '42.1' );
	assert.equal( storage.getItem( 'gg-lang' ), 'de' );
	assert.equal( storage.length, 3 );

} );

test( 'fetchOverpass_remarkReportsTimeout_triesNextMirrorAndCachesOnlyThat', async () => {

	const storage = memoryStorage();
	const partial = { elements: [ 1 ], remark: 'runtime error: Query timed out in "query" at line 1 after 61 seconds.' };
	const fetchImpl = async ( url ) => okResponse( url === OVERPASS_MIRRORS[ 0 ] ? partial : { elements: [ 1, 2 ] } );
	const { osm, source } = await fetchOverpass( 'Q', { storage, fetchImpl } );
	assert.equal( source, new URL( OVERPASS_MIRRORS[ 1 ] ).host );
	assert.deepEqual( osm, { elements: [ 1, 2 ] } );
	assert.equal( storage.getItem( 'osm-track.cache.Q' ), JSON.stringify( { elements: [ 1, 2 ] } ) );

} );

test( 'fetchOverpass_everyAnswerPartial_rejectsAndCachesNothing', async () => {

	const storage = memoryStorage();
	const fetchImpl = async () => okResponse( { elements: [ 1 ], remark: 'runtime error: out of memory' } );
	await assert.rejects( fetchOverpass( 'Q', { storage, fetchImpl } ), /runtime error/ );
	assert.equal( storage.length, 0 );

} );

test( 'fetchOverpass_allMirrorsFail_rejectsWithEveryError', async () => {

	const fetchImpl = async () => ( { ok: false, status: 504 } );
	await assert.rejects( fetchOverpass( 'Q', { storage: null, fetchImpl } ), ( e ) => e.message.split( ' · ' ).length === OVERPASS_MIRRORS.length );

} );

test( 'fetchOverpass_emptyResult_isAnErrorNotCached', async () => {

	const storage = memoryStorage();
	const fetchImpl = async () => okResponse( { elements: [] } );
	await assert.rejects( fetchOverpass( 'Q', { storage, fetchImpl } ), /no data for this area/ );
	assert.equal( storage.size(), 0 );

} );

// Frames (half-size in metres) around the fixture centre that enclose real street blocks
const FRAMES = [ 120, 160, 200, 260 ];
const MPCS = [ 8, 10, 15 ];

function loopPoints( graph, half, mpc ) {

	const { ids, error } = perimeterLoop( graph, { x0: - half, y0: - half, x1: half, y1: half } );
	assert.equal( error, null );
	const pts = ids.map( ( id ) => graph.nodes.get( id ) );
	return simplifyPolyline( [ ...pts, pts[ 0 ] ], mpc ).slice( 0, - 1 );

}

const corners = ( cells ) => trackStats( loopToTrackCells( cells ), 1 ).corner;

test( 'rasterizeLoop_auto_neverWorseThanStairs', () => {

	const graph = buildGraph( fixture, makeProjection( fixture.bbox ) );

	for ( const half of FRAMES ) for ( const mpc of MPCS ) {

		const pts = loopPoints( graph, half, mpc );
		const auto = rasterizeLoop( pts, mpc, 'auto' );
		const stairs = rasterizeLoop( pts, mpc, 'stairs' );
		const label = `frame ±${ half } m, ${ mpc } m/cell`;

		assert.equal( auto.duplicates.size, 0, label );
		assert.ok( auto.shortcuts <= stairs.shortcuts, `${ label }: auto cut more than stairs` );
		assert.ok( corners( auto.cells ) <= corners( stairs.cells ), `${ label }: auto has more corners` );

	}

} );

test( 'rasterizeLoop_auto_cutsCornersSomewhere', () => {

	const graph = buildGraph( fixture, makeProjection( fixture.bbox ) );
	const pts = loopPoints( graph, 200, 10 );
	assert.ok( corners( rasterizeLoop( pts, 10, 'auto' ).cells ) < corners( rasterizeLoop( pts, 10, 'stairs' ).cells ) );

} );
