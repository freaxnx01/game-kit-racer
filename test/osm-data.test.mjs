// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildGraph, makeProjection, perimeterLoop, simplifyPolyline, rasterizeLoop, loopCenter } from '../js/OsmTrack.js';
import {
	encodeOsmParam, parseOsmParam, worldFromMeters, cellOfWorld, viewArea, osmFeatures,
	clipStreets, buildingsOffTrack, budgetBuildings, buildingTriangles, StreetIndex,
} from '../js/OsmData.js';

const CELL = 9.99 * 0.75; // CELL_RAW * GRID_SCALE in Track.js
const fixture = JSON.parse( fs.readFileSync( new URL( './fixtures/sisseln.json', import.meta.url ) ) );

// A real 10 m/cell loop around the fixture centre, placed like osm-track.html places it.
function sisselnTrack() {

	const project = makeProjection( fixture.bbox );
	const graph = buildGraph( fixture, project );
	const { ids } = perimeterLoop( graph, { x0: - 200, y0: - 200, x1: 200, y1: 200 } );
	const pts = ids.map( ( id ) => graph.nodes.get( id ) );
	const { cells } = rasterizeLoop( simplifyPolyline( [ ...pts, pts[ 0 ] ], 10 ).slice( 0, - 1 ), 10, 'auto' );
	const { offX, offZ } = loopCenter( cells );
	const param = { bbox: fixture.bbox, mpc: 10, offX, offZ };
	const track = cells.map( ( [ gx, gz ] ) => [ gx - offX, gz - offZ ] );
	return { param, track, area: viewArea( track, 8 ), features: osmFeatures( fixture, param, CELL ) };

}

test( 'parseOsmParam_encodedParam_roundTrips', () => {

	const p = { bbox: [ 47.548, 7.98, 47.556, 7.995 ], mpc: 10, offX: - 3, offZ: 12 };
	assert.deepEqual( parseOsmParam( encodeOsmParam( p ) ), p );

} );

test( 'parseOsmParam_malformedOrOversized_returnsNull', () => {

	for ( const bad of [
		null, '', 'abc', '1,2,3', '47.5,7.9,47.6,8.0,10,0', // missing / wrong arity
		'47.5,7.9,47.6,8.0,10,0,x', // not a number
		'47.6,7.9,47.5,8.0,10,0,0', // south > north
		'47.0,7.9,47.6,8.0,10,0,0', // 0.6° tall
		'47.5,7.9,47.6,8.0,0,0,0', // mpc 0
		'47.5,7.9,47.6,8.0,10,1.5,0', // fractional offset
		'47.5,7.9,47.6,8.0,10,999,0', // offset out of codec range
	] ) assert.equal( parseOsmParam( bad ), null, String( bad ) );

} );

test( 'worldFromMeters_anyPoint_landsInItsRasterCell', () => {

	const param = { bbox: fixture.bbox, mpc: 10, offX: 4, offZ: - 7 };
	for ( const [ x, y ] of [ [ 0, 0 ], [ 123.4, - 56.7 ], [ - 14.99, 5.01 ], [ 305, 199 ] ] ) {

		const [ wx, wz ] = worldFromMeters( x, y, param, CELL );
		assert.deepEqual( cellOfWorld( wx, wz, CELL ), [ Math.round( x / 10 ) - 4, Math.round( - y / 10 ) + 7 ] );

	}

} );

test( 'osmFeatures_fixture_splitsStreetsAndClosedBuildings', () => {

	const { features } = sisselnTrack();
	assert.ok( features.streets.length > 50 );
	assert.ok( features.buildings.length > 300 );
	assert.ok( features.buildings.every( ( b ) => b.ring.length >= 3 && b.levels >= 0 ) );
	assert.ok( features.streets.some( ( s ) => s.name === 'Hauptstrasse' ) );

} );

test( 'osmFeatures_degenerateBuildingWays_areSkipped', () => {

	const osm = { elements: [
		{ type: 'node', id: 1, lat: 47.55, lon: 7.99 },
		{ type: 'node', id: 2, lat: 47.5501, lon: 7.99 },
		{ type: 'node', id: 3, lat: 47.5501, lon: 7.9901 },
		{ type: 'way', id: 7, nodes: [ 1, 2, 1 ], tags: { building: 'yes' } }, // two corners
		{ type: 'way', id: 8, nodes: [ 1, 2, 2, 1 ], tags: { building: 'yes' } }, // repeated corner
		{ type: 'way', id: 9, nodes: [ 1, 2, 3 ], tags: { building: 'yes' } }, // not closed
		{ type: 'way', id: 10, nodes: [ 1, 2, 99, 1 ], tags: { building: 'yes' } }, // node missing from response
		{ type: 'way', id: 11, nodes: [ 1, 2, 3, 1 ], tags: { building: 'yes' } }, // fine
	] };
	const param = { bbox: fixture.bbox, mpc: 10, offX: 0, offZ: 0 };
	assert.deepEqual( osmFeatures( osm, param, CELL ).buildings.map( ( b ) => b.id ), [ 11 ] );

} );

test( 'clipStreets_realTrack_noRibbonOnATrackCell', () => {

	const { track, area, features } = sisselnTrack();
	const blocked = new Set( track.map( ( c ) => c.join( ',' ) ) );
	const clipped = clipStreets( features.streets, track, area, CELL );
	assert.ok( clipped.length > 0 );

	for ( const s of clipped ) {

		for ( let i = 0; i < s.pts.length - 1; i ++ ) {

			const mid = [ ( s.pts[ i ][ 0 ] + s.pts[ i + 1 ][ 0 ] ) / 2, ( s.pts[ i ][ 1 ] + s.pts[ i + 1 ][ 1 ] ) / 2 ];
			assert.ok( ! blocked.has( cellOfWorld( mid[ 0 ], mid[ 1 ], CELL ).join( ',' ) ) );

		}

	}

} );

test( 'buildingsOffTrack_realTrack_dropsOnlyBuildingsTouchingTiles', () => {

	const { track, area, features } = sisselnTrack();
	const kept = buildingsOffTrack( features.buildings, track, area, CELL );
	assert.ok( kept.length > 0 && kept.length < features.buildings.length );

	const blocked = new Set( track.map( ( c ) => c.join( ',' ) ) );
	for ( const b of kept ) for ( const [ x, z ] of b.ring ) assert.ok( ! blocked.has( cellOfWorld( x, z, CELL ).join( ',' ) ) );

} );

test( 'budgetBuildings_tightBudget_keepsNearestUnderLimit', () => {

	const track = [ [ 0, 0 ] ];
	const square = ( cx ) => ( { id: cx, levels: 0, ring: [ [ cx, 0 ], [ cx + 1, 0 ], [ cx + 1, 1 ], [ cx, 1 ] ] } );
	const buildings = [ square( 100 ), square( 10 ), square( 50 ) ];
	const kept = budgetBuildings( buildings, track, CELL, 2 * buildingTriangles( buildings[ 0 ] ) );
	assert.deepEqual( kept.map( ( b ) => b.id ), [ 10, 50 ] );

} );

test( 'StreetIndex_pointOnHauptstrasse_returnsItsName', () => {

	const { features } = sisselnTrack();
	const index = new StreetIndex( features.streets, CELL );
	const haupt = features.streets.find( ( s ) => s.name === 'Hauptstrasse' );
	const [ a, b ] = haupt.pts;
	assert.equal( index.nameAt( ( a[ 0 ] + b[ 0 ] ) / 2, ( a[ 1 ] + b[ 1 ] ) / 2 ), 'Hauptstrasse' );

} );

test( 'StreetIndex_farFromAnyStreet_returnsNull', () => {

	const index = new StreetIndex( [ { name: 'Only Road', pts: [ [ 0, 0 ], [ 10, 0 ] ] } ], CELL );
	assert.equal( index.nameAt( 5, 3 * CELL ), null );
	assert.equal( new StreetIndex( [], CELL ).nameAt( 0, 0 ), null );

} );
