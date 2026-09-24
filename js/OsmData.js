// OsmData.js — place OpenStreetMap data on the Track.js grid. Pure functions, no three.js.
//
// World: +X east, +Z south, one grid cell = cellSize world units (CELL_RAW * GRID_SCALE in Track.js).
// A link from osm-track.html carries &osm=<s>,<w>,<n>,<e>,<metresPerCell>,<offX>,<offZ>, the same
// numbers OsmTrack.js used to build the ?map= tiles, so OSM metres land exactly on those tiles.

import { makeProjection } from './OsmTrack.js';

const MAX_SPAN_DEG = 0.1;
const MAX_OFFSET = 256;

export function encodeOsmParam( { bbox, mpc, offX, offZ } ) {

	return [ ...bbox.map( ( v ) => + v.toFixed( 6 ) ), mpc, offX, offZ ].join( ',' );

}

// Returns { bbox, mpc, offX, offZ }, or null for anything malformed or implausibly large.
export function parseOsmParam( str ) {

	if ( typeof str !== 'string' ) return null;

	const v = str.split( ',' ).map( Number );
	if ( v.length !== 7 || v.some( ( n ) => ! Number.isFinite( n ) ) ) return null;

	const [ s, w, n, e, mpc, offX, offZ ] = v;
	if ( s < - 90 || n > 90 || w < - 180 || e > 180 ) return null;
	if ( ! ( s < n && w < e ) || n - s > MAX_SPAN_DEG || e - w > MAX_SPAN_DEG ) return null;
	if ( ! ( mpc >= 1 && mpc <= 100 ) ) return null;
	if ( ! Number.isInteger( offX ) || ! Number.isInteger( offZ ) ) return null;
	if ( Math.abs( offX ) > MAX_OFFSET || Math.abs( offZ ) > MAX_OFFSET ) return null;

	return { bbox: [ s, w, n, e ], mpc, offX, offZ };

}

// Metres (x east, y north, from makeProjection) → [x, z] world units. Mirrors rasterizeLoop's
// Math.round( x / mpc ) and loopToTrackCells' centring, plus half a cell to reach the cell centre.
export function worldFromMeters( x, y, param, cellSize ) {

	return [
		( x / param.mpc - param.offX + 0.5 ) * cellSize,
		( - y / param.mpc - param.offZ + 0.5 ) * cellSize,
	];

}

export function cellOfWorld( wx, wz, cellSize ) {

	return [ Math.floor( wx / cellSize ), Math.floor( wz / cellSize ) ];

}

// Grid rectangle around the track cells, widened by margin cells: { minX, maxX, minZ, maxZ }.
export function viewArea( cells, margin ) {

	let minX = Infinity, maxX = - Infinity, minZ = Infinity, maxZ = - Infinity;

	for ( const [ gx, gz ] of cells ) {

		minX = Math.min( minX, gx ); maxX = Math.max( maxX, gx );
		minZ = Math.min( minZ, gz ); maxZ = Math.max( maxZ, gz );

	}

	return { minX: minX - margin, maxX: maxX + margin, minZ: minZ - margin, maxZ: maxZ + margin };

}

function inArea( gx, gz, area ) {

	return gx >= area.minX && gx <= area.maxX && gz >= area.minZ && gz <= area.maxZ;

}

function cellKeys( cells ) {

	return new Set( cells.map( ( c ) => c[ 0 ] + ',' + c[ 1 ] ) );

}

// Overpass JSON → { streets: [{ id, name, pts }], buildings: [{ id, levels, ring }] }, points as [x, z] world units.
// levels is 0 when OSM has no building:levels tag.
export function osmFeatures( osm, param, cellSize ) {

	const project = makeProjection( param.bbox );
	const nodes = new Map();

	for ( const el of osm.elements ) {

		if ( el.type !== 'node' ) continue;
		const p = project( el.lat, el.lon );
		nodes.set( el.id, worldFromMeters( p.x, p.y, param, cellSize ) );

	}

	const streets = [], buildings = [];

	for ( const el of osm.elements ) {

		if ( el.type !== 'way' || ! el.nodes ) continue;

		const tags = el.tags ?? {};
		const pts = el.nodes.map( ( id ) => nodes.get( id ) ).filter( Boolean );

		if ( tags.highway && pts.length >= 2 ) {

			streets.push( { id: el.id, name: tags.name ?? '', pts } );

		} else if ( tags.building && isClosedRing( el.nodes ) && pts.length === el.nodes.length ) {

			buildings.push( { id: el.id, levels: Number.parseFloat( tags[ 'building:levels' ] ) || 0, ring: pts.slice( 0, - 1 ) } );

		}

	}

	return { streets, buildings };

}

// A closed way with at least three distinct corners (anything less extrudes to nothing).
function isClosedRing( ids ) {

	return ids.length >= 4 && ids[ 0 ] === ids[ ids.length - 1 ] && new Set( ids ).size >= 3;

}

// Street polylines cut into runs that stay inside the area and off track cells, so ribbons never
// cover tiles. Segments are checked in quarter-cell steps.
export function clipStreets( streets, trackCells, area, cellSize ) {

	const blocked = cellKeys( trackCells );
	const free = ( x, z ) => {

		const [ gx, gz ] = cellOfWorld( x, z, cellSize );
		return inArea( gx, gz, area ) && ! blocked.has( gx + ',' + gz );

	};

	const out = [];

	for ( const street of streets ) {

		let run = [];
		const flush = () => {

			if ( run.length >= 2 ) out.push( { id: street.id, name: street.name, pts: run } );
			run = [];

		};

		for ( let i = 0; i < street.pts.length - 1; i ++ ) {

			const [ ax, az ] = street.pts[ i ], [ bx, bz ] = street.pts[ i + 1 ];
			const steps = Math.max( 1, Math.ceil( Math.hypot( bx - ax, bz - az ) / ( cellSize / 4 ) ) );

			for ( let k = 0; k < steps; k ++ ) {

				const p0 = [ ax + ( bx - ax ) * k / steps, az + ( bz - az ) * k / steps ];
				const p1 = [ ax + ( bx - ax ) * ( k + 1 ) / steps, az + ( bz - az ) * ( k + 1 ) / steps ];

				if ( ! free( ( p0[ 0 ] + p1[ 0 ] ) / 2, ( p0[ 1 ] + p1[ 1 ] ) / 2 ) ) { flush(); continue; }
				if ( run.length === 0 ) run.push( p0 );
				run.push( p1 );

			}

		}

		flush();

	}

	return out;

}

// Buildings whose footprint bounding box lies inside the area and touches no track cell.
// (Bounding box, not polygon: a few buildings next to the road are dropped too — tiles sit up to
// half a cell off the real street anyway.)
export function buildingsOffTrack( buildings, trackCells, area, cellSize ) {

	const blocked = cellKeys( trackCells );

	return buildings.filter( ( b ) => {

		const xs = b.ring.map( ( p ) => p[ 0 ] ), zs = b.ring.map( ( p ) => p[ 1 ] );
		const [ gx0, gz0 ] = cellOfWorld( Math.min( ...xs ), Math.min( ...zs ), cellSize );
		const [ gx1, gz1 ] = cellOfWorld( Math.max( ...xs ), Math.max( ...zs ), cellSize );

		if ( ! inArea( gx0, gz0, area ) || ! inArea( gx1, gz1, area ) ) return false;

		for ( let gx = gx0; gx <= gx1; gx ++ ) {

			for ( let gz = gz0; gz <= gz1; gz ++ ) if ( blocked.has( gx + ',' + gz ) ) return false;

		}

		return true;

	} );

}

// Triangles of an extruded footprint with n corners: 2n walls + 2(n-2) caps.
export function buildingTriangles( building ) {

	return 4 * building.ring.length - 4;

}

// Keep the buildings nearest to the track until maxTriangles is reached.
export function budgetBuildings( buildings, trackCells, cellSize, maxTriangles ) {

	const centres = trackCells.map( ( [ gx, gz ] ) => [ ( gx + 0.5 ) * cellSize, ( gz + 0.5 ) * cellSize ] );
	const distance = ( b ) => {

		const cx = b.ring.reduce( ( s, p ) => s + p[ 0 ], 0 ) / b.ring.length;
		const cz = b.ring.reduce( ( s, p ) => s + p[ 1 ], 0 ) / b.ring.length;
		let d = Infinity;
		for ( const [ x, z ] of centres ) d = Math.min( d, ( x - cx ) ** 2 + ( z - cz ) ** 2 );
		return d;

	};

	const kept = [];
	let total = 0;

	for ( const [ , b ] of buildings.map( ( b ) => [ distance( b ), b ] ).sort( ( p, q ) => p[ 0 ] - q[ 0 ] ) ) {

		const t = buildingTriangles( b );
		if ( total + t > maxTriangles ) break;
		total += t;
		kept.push( b );

	}

	return kept;

}

function distanceToSegmentSq( px, pz, [ ax, az ], [ bx, bz ] ) {

	const dx = bx - ax, dz = bz - az;
	const len2 = dx * dx + dz * dz;
	const t = len2 === 0 ? 0 : Math.max( 0, Math.min( 1, ( ( px - ax ) * dx + ( pz - az ) * dz ) / len2 ) );
	return ( px - ax - t * dx ) ** 2 + ( pz - az - t * dz ) ** 2;

}

// Name of the nearest named street within one cell of a world position, via a grid of segment buckets.
export class StreetIndex {

	constructor( streets, cellSize ) {

		this.cellSize = cellSize;
		this.buckets = new Map();

		for ( const street of streets ) {

			if ( ! street.name ) continue;

			for ( let i = 0; i < street.pts.length - 1; i ++ ) {

				const a = street.pts[ i ], b = street.pts[ i + 1 ];
				const [ gx0, gz0 ] = cellOfWorld( Math.min( a[ 0 ], b[ 0 ] ), Math.min( a[ 1 ], b[ 1 ] ), cellSize );
				const [ gx1, gz1 ] = cellOfWorld( Math.max( a[ 0 ], b[ 0 ] ), Math.max( a[ 1 ], b[ 1 ] ), cellSize );

				for ( let gx = gx0; gx <= gx1; gx ++ ) {

					for ( let gz = gz0; gz <= gz1; gz ++ ) {

						const key = gx + ',' + gz;
						if ( ! this.buckets.has( key ) ) this.buckets.set( key, [] );
						this.buckets.get( key ).push( { name: street.name, a, b } );

					}

				}

			}

		}

	}

	// Returns the street name, or null when no named street is within one cell.
	nameAt( x, z ) {

		const [ gx, gz ] = cellOfWorld( x, z, this.cellSize );
		let best = null, bestD = this.cellSize ** 2;

		for ( let dx = - 1; dx <= 1; dx ++ ) {

			for ( let dz = - 1; dz <= 1; dz ++ ) {

				for ( const seg of this.buckets.get( ( gx + dx ) + ',' + ( gz + dz ) ) ?? [] ) {

					const d = distanceToSegmentSq( x, z, seg.a, seg.b );
					if ( d <= bestD ) { bestD = d; best = seg.name; }

				}

			}

		}

		return best;

	}

}
