// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
	overpassQuery, fetchOverpass, OVERPASS_MIRRORS, buildGraph, makeProjection,
	perimeterLoop, simplifyPolyline, rasterizeLoop, loopToTrackCells, trackStats,
} from '../js/OsmTrack.js';

const fixture = JSON.parse( fs.readFileSync( new URL( './fixtures/sisseln.json', import.meta.url ) ) );

const memoryStorage = () => {

	const m = new Map();
	return { getItem: ( k ) => m.get( k ) ?? null, setItem: ( k, v ) => m.set( k, v ), size: () => m.size };

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
