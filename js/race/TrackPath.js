// TrackPath.js — the driving line of a tile track: walks the pieces from the finish line in its driving
// direction and turns them into a closed polyline CPU drivers follow. Pure (no three.js, no DOM).
// Cells are [ gx, gz, type, godotOrient ] as in Track.js; world x/z of a cell centre = ( g + 0.5 ) * cellSize.

const ORIENT_DEG = { 0: 0, 10: 180, 16: 90, 22: 270 }; // same table as Track.js
const ARC_STEPS = 6; // corner arcs are drawn with 6 segments of 15°

// Open sides of a piece at orientation 0, as grid steps [ dx, dz ]. Straight, bump and finish run along z;
// a corner joins -x and +z (checked against the default track in Track.js).
const OPEN_SIDES = {
	'track-straight': [ [ 0, 1 ], [ 0, - 1 ] ],
	'track-bump': [ [ 0, 1 ], [ 0, - 1 ] ],
	'track-finish': [ [ 0, 1 ], [ 0, - 1 ] ],
	'track-corner': [ [ - 1, 0 ], [ 0, 1 ] ],
};

// Rotates a grid step like three.js rotation.y does: +z turns towards +x for positive angles.
function rotateStep( [ dx, dz ], deg ) {

	const a = deg * Math.PI / 180;
	return [ Math.round( dx * Math.cos( a ) + dz * Math.sin( a ) ) + 0, Math.round( - dx * Math.sin( a ) + dz * Math.cos( a ) ) + 0 ]; // + 0 turns -0 into 0

}

// The two grid steps through which a piece connects to its neighbours.
export function openSides( type, orient ) {

	const sides = OPEN_SIDES[ type ];
	if ( ! sides ) return null;
	return sides.map( ( s ) => rotateStep( s, ORIENT_DEG[ orient ] ?? 0 ) );

}

// Cells in driving order, starting at the finish cell and leaving it forwards. Each entry is
// { cell, from: [dx,dz] step we entered with, to: [dx,dz] step we leave with }. null unless the
// pieces form one closed loop that uses every cell exactly once.
export function trackOrder( cells ) {

	const finish = cells.find( ( c ) => c[ 2 ] === 'track-finish' );
	if ( ! finish ) return null;

	const byKey = new Map( cells.map( ( c ) => [ c[ 0 ] + ',' + c[ 1 ], c ] ) );
	const forward = rotateStep( [ 0, 1 ], ORIENT_DEG[ finish[ 3 ] ] ?? 0 );
	const order = [];
	let cell = finish, from = forward;

	for ( let i = 0; i < cells.length; i ++ ) {

		const to = exitStep( cell, from );
		if ( ! to ) return null;
		order.push( { cell, from, to } );
		cell = byKey.get( ( cell[ 0 ] + to[ 0 ] ) + ',' + ( cell[ 1 ] + to[ 1 ] ) );
		if ( ! cell ) return null;
		from = to;
		if ( cell === finish ) break;

	}

	if ( cell !== finish || order.length !== byKey.size ) return null;
	if ( from[ 0 ] !== forward[ 0 ] || from[ 1 ] !== forward[ 1 ] ) return null;
	return order;

}

// Entering a cell moving by step `from`, we come in through side -from; we leave through the other open side.
function exitStep( cell, from ) {

	const sides = openSides( cell[ 2 ], cell[ 3 ] );
	if ( ! sides ) return null;
	const back = sides.findIndex( ( [ dx, dz ] ) => dx === - from[ 0 ] && dz === - from[ 1 ] );
	return back === - 1 ? null : sides[ 1 - back ];

}

// Closed driving line through the cell centres of straights and along quarter arcs in corners, starting
// on the finish line (finish cell centre). Returns { points: [ [x,z] … ], corner: [ bool per segment ],
// dist: [ cumulative distance per point ], length } or null when trackOrder fails.
export function buildPath( cells, cellSize ) {

	const order = trackOrder( cells );
	if ( ! order ) return null;

	const points = [], corner = [];
	const [ first ] = order;
	points.push( centre( first.cell, cellSize ) );

	for ( let i = 0; i < order.length; i ++ ) {

		const { cell, from, to } = order[ i ];
		const isCorner = from[ 0 ] !== to[ 0 ] || from[ 1 ] !== to[ 1 ];
		const [ cx, cz ] = centre( cell, cellSize );
		const half = cellSize / 2;

		if ( i > 0 && isCorner ) {

			for ( const p of arcPoints( cx, cz, half, from, to ) ) { points.push( p ); corner.push( true ); }

		} else if ( i > 0 ) {

			points.push( [ cx, cz ] ); corner.push( false );

		}

		// Exit edge midpoint of this cell (the finish cell is only left, never re-entered here).
		points.push( [ cx + to[ 0 ] * half, cz + to[ 1 ] * half ] ); corner.push( i > 0 && isCorner );

	}

	points.push( points[ 0 ].slice() ); corner.push( false ); // back to the finish line

	const dist = [ 0 ];
	for ( let i = 1; i < points.length; i ++ ) dist.push( dist[ i - 1 ] + Math.hypot( points[ i ][ 0 ] - points[ i - 1 ][ 0 ], points[ i ][ 1 ] - points[ i - 1 ][ 1 ] ) );
	return { points, corner, dist, length: dist[ dist.length - 1 ] };

}

function centre( cell, cellSize ) {

	return [ ( cell[ 0 ] + 0.5 ) * cellSize, ( cell[ 1 ] + 0.5 ) * cellSize ];

}

// Quarter circle from the entry edge midpoint to the exit edge midpoint, around the cell corner between
// the entry side and the exit side. Returns the inner points plus none of the ends (the entry edge point
// is already on the path; the exit edge point is pushed by the caller).
function arcPoints( cx, cz, half, from, to ) {

	const ox = cx - from[ 0 ] * half + to[ 0 ] * half; // arc centre: entry side + exit side corner
	const oz = cz - from[ 1 ] * half + to[ 1 ] * half;
	const a0 = Math.atan2( ( cz - from[ 1 ] * half ) - oz, ( cx - from[ 0 ] * half ) - ox );
	const a1 = Math.atan2( ( cz + to[ 1 ] * half ) - oz, ( cx + to[ 0 ] * half ) - ox );
	let da = a1 - a0;
	if ( da > Math.PI ) da -= Math.PI * 2;
	if ( da < - Math.PI ) da += Math.PI * 2;

	const pts = [];
	for ( let k = 1; k < ARC_STEPS; k ++ ) {

		const a = a0 + da * k / ARC_STEPS;
		pts.push( [ ox + Math.cos( a ) * half, oz + Math.sin( a ) * half ] );

	}

	return pts;

}

// Point on the closed path at distance s (any real number, wraps), shifted `lateral` units to the right
// of the driving direction. heading is the yaw angle with forward = ( sin heading, cos heading ), the same
// convention as Track.js spawn angles. corner says whether s lies on a corner arc.
export function samplePath( path, s, lateral = 0 ) {

	const d = ( ( s % path.length ) + path.length ) % path.length;
	let i = 1;
	while ( i < path.dist.length - 1 && path.dist[ i ] < d ) i ++;
	const a = path.points[ i - 1 ], b = path.points[ i ];
	const segLen = path.dist[ i ] - path.dist[ i - 1 ] || 1;
	const k = ( d - path.dist[ i - 1 ] ) / segLen;
	const fx = ( b[ 0 ] - a[ 0 ] ) / segLen, fz = ( b[ 1 ] - a[ 1 ] ) / segLen;
	const rx = fz, rz = - fx; // right of forward, same as gridSlots in RaceState.js

	return {
		x: a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * k + rx * lateral,
		z: a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * k + rz * lateral,
		heading: Math.atan2( fx, fz ),
		corner: path.corner[ i - 1 ],
	};

}
