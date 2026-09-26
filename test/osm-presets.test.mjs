// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESET_DEFS, bakePreset, readFixture } from '../tools/osm-presets.mjs';
import { OSM_PRESETS } from '../js/OsmPresets.js';
import { makeProjection } from '../js/OsmTrack.js';
import { parseOsmParam } from '../js/OsmData.js';

const HOLZBRUECKE = 85692214; // OSM way: highway=pedestrian, bridge=covered, bridge:name=Holzbrücke Bad Säckingen

const def = PRESET_DEFS.find( ( d ) => d.id === 'bad-saeckingen' );
const fixture = readFixture( def );
const ways = fixture.elements.filter( ( el ) => el.type === 'way' );
const baked = bakePreset( def, fixture );

// True when two consecutive loop nodes are also consecutive on the way, i.e. the loop drives along it.
function drivesAlong( ids, way ) {

	const edges = new Set( ids.map( ( id, i ) => id + '>' + ids[ ( i + 1 ) % ids.length ] ) );
	return way.nodes.slice( 1 ).some( ( id, i ) => edges.has( way.nodes[ i ] + '>' + id ) || edges.has( id + '>' + way.nodes[ i ] ) );

}

function distanceToSegment( p, a, b ) {

	const dx = b.x - a.x, dy = b.y - a.y;
	const len2 = dx * dx + dy * dy;
	const t = len2 ? Math.max( 0, Math.min( 1, ( ( p.x - a.x ) * dx + ( p.y - a.y ) * dy ) / len2 ) ) : 0;
	return Math.hypot( p.x - a.x - t * dx, p.y - a.y - t * dy );

}

test( 'bakePreset_badSaeckingenFixture_matchesCommittedPreset', () => {

	const committed = OSM_PRESETS.find( ( p ) => p.id === def.id );
	assert.ok( committed, 'js/OsmPresets.js has no bad-saeckingen entry — run node tools/osm-presets.mjs' );
	assert.deepEqual( { ...committed }, { id: baked.id, name: baked.name, desc: baked.desc, map: baked.map, osm: baked.osm } );

} );

test( 'bakePreset_badSaeckingen_crossesHolzbrueckeAndReturnsOverFridolinsbruecke', () => {

	const holz = ways.find( ( w ) => w.id === HOLZBRUECKE );
	assert.equal( holz.tags[ 'bridge:name' ], 'Holzbrücke Bad Säckingen' );
	assert.ok( drivesAlong( baked.ids, holz ), 'the loop does not cross the Holzbrücke' );
	assert.ok( ways.some( ( w ) => w.tags.name === 'Fridolinsbrücke' && drivesAlong( baked.ids, w ) ), 'the loop does not come back over the Fridolinsbrücke' );

} );

test( 'bakePreset_badSaeckingen_runsThroughOldTownLanes', () => {

	const lanes = new Set( ways
		.filter( ( w ) => w.tags.highway === 'pedestrian' && w.tags.name && w.tags.area !== 'yes' && drivesAlong( baked.ids, w ) )
		.map( ( w ) => w.tags.name ) );
	assert.ok( lanes.size >= 3, `only ${ [ ...lanes ].join( ', ' ) }` );

} );

test( 'bakePreset_badSaeckingen_finishLineIsOnTheHolzbruecke', () => {

	const project = makeProjection( def.bbox );
	const nodes = new Map( fixture.elements.filter( ( el ) => el.type === 'node' ).map( ( n ) => [ n.id, project( n.lat, n.lon ) ] ) );
	const { offX, offZ } = parseOsmParam( baked.osm );
	const [ gx, gz, type ] = baked.cells[ 0 ];
	assert.equal( type, 'track-finish' );

	// Inverse of rasterizeLoop's Math.round( x / mpc ) and loopToTrackCells' centring
	const finish = { x: ( gx + offX ) * def.mpc, y: - ( gz + offZ ) * def.mpc };
	const bridge = ways.find( ( w ) => w.id === HOLZBRUECKE ).nodes.map( ( id ) => nodes.get( id ) );
	const d = Math.min( ...bridge.slice( 1 ).map( ( b, i ) => distanceToSegment( finish, bridge[ i ], b ) ) );
	assert.ok( d <= def.mpc, `finish line is ${ d.toFixed( 1 ) } m from the bridge` );

} );

test( 'bakePreset_badSaeckingen_osmParamParsesAndCellsFitTheCodec', () => {

	const param = parseOsmParam( baked.osm );
	assert.ok( param, 'osm param rejected by parseOsmParam' );
	assert.deepEqual( param.bbox, def.bbox );
	assert.equal( param.mpc, 10 );
	assert.ok( baked.cells.every( ( [ gx, gz ] ) => gx >= - 128 && gx <= 127 && gz >= - 128 && gz <= 127 ) );

} );

test( 'bakePreset_routeThatDrivesAStreetTwice_throws', () => {

	// Out over the Holzbrücke and straight back over it
	const outAndBack = { ...def, waypoints: [ def.waypoints[ 0 ], def.waypoints[ 1 ], def.waypoints[ 0 ] ] };
	assert.throws( () => bakePreset( outAndBack, fixture ), /drives a street twice/ );

} );
