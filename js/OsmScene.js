// OsmScene.js — OpenStreetMap surroundings for a generated track: extruded buildings and flat
// side-street ribbons, each merged into a single mesh. Placement and filtering live in OsmData.js.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { overpassQuery, fetchOverpass } from './OsmTrack.js';
import { osmFeatures, clipStreets, buildingsOffTrack, budgetBuildings, StreetIndex } from './OsmData.js';

const GROUND_Y = - 0.125;          // top of the grass tiles (track group y -0.5, tile y 0.5 × scale 0.75)
const STREET_Y = GROUND_Y + 0.012; // just above grass, below the track tiles' asphalt
const METRES_PER_LEVEL = 3;
const DEFAULT_LEVELS = 2;
const MAX_BUILDING_TRIANGLES = 20000;
const VIEW_MARGIN_CELLS = 8;       // the chase camera sees ~7 cells; nothing further out is built

const WALL_TONES = [ 0xf1e3c8, 0xe8c9b0, 0xd9dde4, 0xf3d9a4, 0xcfe0d1 ].map( ( c ) => new THREE.Color( c ) );
const ROOF_LIGHTEN = 0.35;

// Fetch OSM for the link's bbox and add the surroundings to the scene.
// Resolves { streets, buildings, index } for the HUD (world coordinates); rejects when Overpass fails.
export async function loadSurroundings( scene, param, trackCells, area, cellSize ) {

	const { osm } = await fetchOverpass( overpassQuery( param.bbox, undefined, { buildings: true } ) );
	const { streets, buildings } = osmFeatures( osm, param, cellSize );

	const sideStreets = clipStreets( streets, trackCells, area, cellSize );
	const houses = budgetBuildings( buildingsOffTrack( buildings, trackCells, area, cellSize ), trackCells, cellSize, MAX_BUILDING_TRIANGLES );

	const streetMesh = streetRibbons( sideStreets, cellSize * 0.5 );
	const houseMesh = extrudedBuildings( houses, cellSize / param.mpc );
	if ( streetMesh ) scene.add( streetMesh );
	if ( houseMesh ) scene.add( houseMesh );

	return { streets: sideStreets, buildings: houses, index: new StreetIndex( streets, cellSize ) };

}

export { VIEW_MARGIN_CELLS };

// Flat quads along each polyline, width in world units.
export function streetRibbons( streets, width ) {

	const positions = [];
	const half = width / 2;

	for ( const { pts } of streets ) {

		for ( let i = 0; i < pts.length - 1; i ++ ) {

			const [ ax, az ] = pts[ i ], [ bx, bz ] = pts[ i + 1 ];
			const len = Math.hypot( bx - ax, bz - az );
			if ( len === 0 ) continue;
			const nx = - ( bz - az ) / len * half, nz = ( bx - ax ) / len * half;

			positions.push(
				ax + nx, STREET_Y, az + nz, bx - nx, STREET_Y, bz - nz, bx + nx, STREET_Y, bz + nz,
				ax + nx, STREET_Y, az + nz, ax - nx, STREET_Y, az - nz, bx - nx, STREET_Y, bz - nz,
			);

		}

	}

	if ( positions.length === 0 ) return null;

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( positions, 3 ) );
	geometry.computeVertexNormals();

	const mesh = new THREE.Mesh( geometry, new THREE.MeshLambertMaterial( {
		color: 0x5b6069, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: - 1, polygonOffsetUnits: - 1,
	} ) );
	mesh.receiveShadow = true;
	mesh.name = 'osm-streets';
	return mesh;

}

// Footprints extruded upward; walls in a pastel tone picked by way id, flat roofs a lighter shade.
export function extrudedBuildings( buildings, worldPerMetre ) {

	const geometries = buildings.map( ( b ) => {

		const height = ( b.levels || DEFAULT_LEVELS ) * METRES_PER_LEVEL * worldPerMetre;
		// Shape lives in XY; after rotateX(-90°) shape y becomes world -z and extrusion depth becomes +y.
		const shape = new THREE.Shape( b.ring.map( ( [ x, z ] ) => new THREE.Vector2( x, - z ) ) );
		const geometry = new THREE.ExtrudeGeometry( shape, { depth: height, bevelEnabled: false } );
		geometry.rotateX( - Math.PI / 2 );
		geometry.translate( 0, GROUND_Y, 0 );
		paint( geometry, WALL_TONES[ Math.abs( b.id ) % WALL_TONES.length ] );
		geometry.clearGroups();
		return geometry;

	} );

	if ( geometries.length === 0 ) return null;

	const mesh = new THREE.Mesh( mergeGeometries( geometries ), new THREE.MeshLambertMaterial( { vertexColors: true } ) );
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	mesh.name = 'osm-buildings';
	return mesh;

}

// ExtrudeGeometry group 0 = caps (roof + floor), group 1 = walls: colour vertices per group.
function paint( geometry, wall ) {

	const roof = wall.clone().lerp( new THREE.Color( 0xffffff ), ROOF_LIGHTEN );
	const colors = new Float32Array( geometry.attributes.position.count * 3 );

	for ( const { start, count, materialIndex } of geometry.groups ) {

		const c = materialIndex === 0 ? roof : wall;
		for ( let i = start; i < start + count; i ++ ) c.toArray( colors, i * 3 );

	}

	geometry.setAttribute( 'color', new THREE.BufferAttribute( colors, 3 ) );

}
