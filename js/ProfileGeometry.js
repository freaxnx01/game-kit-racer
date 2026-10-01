// ProfileGeometry.js — turns a height profile into geometry: slices the straight piece's triangles into
// bands along z and lifts them by the profile (the visible ramp, tabletop, whoops), and builds the matching
// collider grid. All in the piece's local raw units (cell ±5). Pure (no three.js): arrays in, arrays out.

const EPS = 1e-9;

export function evenCuts( halfLength, steps ) {

	const cuts = [];
	for ( let i = 1; i < steps; i ++ ) cuts.push( - halfLength + ( 2 * halfLength * i ) / steps );
	return cuts;

}

// Splits every triangle at each z = cut plane it crosses. positions: 9 floats per triangle, uvs: 6.
export function sliceAlongZ( positions, uvs, cuts ) {

	let tris = [];
	for ( let i = 0; i < positions.length / 9; i ++ ) tris.push( triangleAt( positions, uvs, i ) );
	for ( const cut of cuts ) tris = tris.flatMap( ( tri ) => splitTriangle( tri, cut ) );

	const out = { positions: [], uvs: [] };
	for ( const tri of tris ) for ( const v of tri ) {

		out.positions.push( v.p[ 0 ], v.p[ 1 ], v.p[ 2 ] );
		out.uvs.push( v.uv[ 0 ], v.uv[ 1 ] );

	}

	return out;

}

function triangleAt( positions, uvs, i ) {

	const tri = [];
	for ( let k = 0; k < 3; k ++ ) {

		const p = i * 9 + k * 3, u = i * 6 + k * 2;
		tri.push( { p: [ positions[ p ], positions[ p + 1 ], positions[ p + 2 ] ], uv: [ uvs[ u ], uvs[ u + 1 ] ] } );

	}

	return tri;

}

// Clips one triangle against z = cut; returns the pieces on each side (1 if it does not cross).
// Keeps the vertex winding, so faces keep pointing the same way.
function splitTriangle( tri, cut ) {

	const side = tri.map( ( v ) => ( v.p[ 2 ] < cut - EPS ? - 1 : v.p[ 2 ] > cut + EPS ? 1 : 0 ) );
	if ( ! side.includes( - 1 ) || ! side.includes( 1 ) ) return [ tri ];

	return [ clipPolygon( tri, side, - 1, cut ), clipPolygon( tri, side, 1, cut ) ].flatMap( fan );

}

// Sutherland–Hodgman for one plane: the polygon part on side `keep`, with the cut points inserted.
function clipPolygon( tri, side, keep, cut ) {

	const poly = [];
	for ( let i = 0; i < 3; i ++ ) {

		const a = tri[ i ], b = tri[ ( i + 1 ) % 3 ];
		const sa = side[ i ], sb = side[ ( i + 1 ) % 3 ];
		if ( sa === keep || sa === 0 ) poly.push( a );
		if ( sa * sb === - 1 ) poly.push( lerpVertex( a, b, ( cut - a.p[ 2 ] ) / ( b.p[ 2 ] - a.p[ 2 ] ) ) );

	}

	return poly;

}

function fan( poly ) {

	const tris = [];
	for ( let i = 1; i + 1 < poly.length; i ++ ) tris.push( [ poly[ 0 ], poly[ i ], poly[ i + 1 ] ] );
	return tris;

}

function lerpVertex( a, b, k ) {

	return {
		p: a.p.map( ( x, i ) => x + ( b.p[ i ] - x ) * k ),
		uv: a.uv.map( ( x, i ) => x + ( b.uv[ i ] - x ) * k ),
	};

}

export function liftByProfile( positions, profile, halfLength ) {

	const out = positions.slice();
	for ( let i = 0; i < out.length; i += 3 ) {

		const t = Math.min( 1, Math.max( 0, out[ i + 2 ] / ( 2 * halfLength ) + 0.5 ) );
		out[ i + 1 ] += profile( t );

	}

	return out;

}

// Two vertices per row (x = ±halfWidth), steps + 1 rows from z = -halfLength to +halfLength.
export function colliderGrid( profile, halfWidth, halfLength, steps ) {

	const positions = [], indices = [];
	for ( let i = 0; i <= steps; i ++ ) {

		const t = i / steps, z = - halfLength + 2 * halfLength * t, y = profile( t );
		positions.push( - halfWidth, y, z, halfWidth, y, z );

	}

	for ( let i = 0; i < steps; i ++ ) {

		const l0 = 2 * i, r0 = l0 + 1, l1 = l0 + 2, r1 = l0 + 3;
		indices.push( l0, l1, r0, r0, l1, r1 );

	}

	return { positions, indices };

}

const PATCH_Y = 0.02;          // raw units above the road, under the drift marks
const ROAD_HALF = 4.5;         // raw half-width of the asphalt on a straight (kerbs start outside)
const CELL_HALF = 4.995;
const RING_INNER = 0.5, RING_OUTER = 9.5; // corner asphalt around the arc centre ( -CELL_HALF, +CELL_HALF )

// Brown overlay for a dirt cell, as a triangle soup in the piece's local raw units. 'straight' covers
// every straight-like piece (lifted by its profile, if any); 'corner' is the quarter ring of a corner.
export function dirtPatch( shape, profile, steps ) {

	const quad = shape === 'corner' ? cornerQuad : straightQuad;
	const out = { positions: [], uvs: [] };

	for ( let i = 0; i < steps; i ++ ) {

		const a = quad( i / steps, 0, profile ), b = quad( i / steps, 1, profile );
		const c = quad( ( i + 1 ) / steps, 0, profile ), d = quad( ( i + 1 ) / steps, 1, profile );
		for ( const v of [ a, c, b, b, c, d ] ) {

			out.positions.push( v[ 0 ], v[ 1 ], v[ 2 ] );
			out.uvs.push( v[ 0 ] / 4, v[ 2 ] / 4 );

		}

	}

	return out;

}

function straightQuad( t, side, profile ) {

	return [ side ? ROAD_HALF : - ROAD_HALF, PATCH_Y + ( profile ? profile( t ) : 0 ), - CELL_HALF + 2 * CELL_HALF * t ];

}

// Quarter ring around the arc centre ( -CELL_HALF, +CELL_HALF ): from the +z edge (angle 0) to the
// -x edge (angle -90°), like Physics.js's arc walls.
function cornerQuad( t, side, profile ) {

	const angle = - t * Math.PI / 2, r = side ? RING_OUTER : RING_INNER;
	return [ - CELL_HALF + r * Math.cos( angle ), PATCH_Y, CELL_HALF + r * Math.sin( angle ) ];

}
