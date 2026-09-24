// Regenerates test/fixtures/sisseln.json: roads + buildings around Sisseln's centre from Overpass,
// trimmed to the tags the tests use. Run: node tools/osm-fixture.mjs
import fs from 'node:fs';
import { overpassQuery, fetchOverpass } from '../js/OsmTrack.js';

export const FIXTURE_BBOX = [ 47.5480, 7.9800, 47.5560, 7.9950 ];
const KEEP_TAGS = [ 'highway', 'name', 'building', 'building:levels' ];

const { osm } = await fetchOverpass( overpassQuery( FIXTURE_BBOX, undefined, { buildings: true } ), { storage: null } );

const elements = osm.elements.map( ( el ) => el.type === 'node'
	? { type: 'node', id: el.id, lat: +el.lat.toFixed( 7 ), lon: +el.lon.toFixed( 7 ) }
	: { type: 'way', id: el.id, nodes: el.nodes, tags: Object.fromEntries( KEEP_TAGS.filter( ( k ) => el.tags?.[ k ] ).map( ( k ) => [ k, el.tags[ k ] ] ) ) } );

fs.mkdirSync( new URL( '../test/fixtures/', import.meta.url ), { recursive: true } );
fs.writeFileSync( new URL( '../test/fixtures/sisseln.json', import.meta.url ), JSON.stringify( { bbox: FIXTURE_BBOX, elements } ) );
console.log( `${ elements.length } elements written` );
