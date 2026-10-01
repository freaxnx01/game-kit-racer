// Pieces.js — every track piece: how it is drawn (a Kenney GLB model, or a height profile applied to the
// straight piece) and through which sides it connects. The single list the codec, renderer, physics,
// driving line and editor derive from. Pure (no three.js).

// Open sides at orientation 0, as grid steps [ dx, dz ]. Straight-like pieces run along z;
// a corner joins -x and +z (checked against the default track in Track.js).
const STRAIGHT = [ [ 0, 1 ], [ 0, - 1 ] ];
const CORNER = [ [ - 1, 0 ], [ 0, 1 ] ];

// Heights in raw cell units (×GRID_SCALE in the world). t runs 0 → 1 along the piece's driving
// direction (+z at orientation 0). Tune the numbers after play-testing; tests pin only the shapes.
const RAMP_HEIGHT = 1.2;
const RAMP_LIP = 0.75;       // t of the lip
const RAMP_DROP_END = 0.8;   // t where the drop reaches the floor
const TABLE_HEIGHT = 0.9;
const WHOOP_HEIGHT = 0.35;
const WHOOP_COUNT = 3;

function ramp( t ) {

	if ( t <= RAMP_LIP ) return RAMP_HEIGHT * Math.max( 0, t ) / RAMP_LIP;
	if ( t < RAMP_DROP_END ) return RAMP_HEIGHT * ( RAMP_DROP_END - t ) / ( RAMP_DROP_END - RAMP_LIP );
	return 0;

}

// Up-slope 0–0.3, plateau 0.3–0.6, gentle landing slope 0.6–1.
function tabletop( t ) {

	if ( t <= 0 || t >= 1 ) return 0;
	if ( t < 0.3 ) return TABLE_HEIGHT * t / 0.3;
	if ( t <= 0.6 ) return TABLE_HEIGHT;
	return TABLE_HEIGHT * ( 1 - t ) / 0.4;

}

function whoops( t ) {

	if ( t <= 0 || t >= 1 ) return 0;
	return WHOOP_HEIGHT * Math.sin( Math.PI * WHOOP_COUNT * t ) ** 2;

}

export const PIECES = {
	'track-straight': { index: 0, model: 'track-straight', open: STRAIGHT },
	'track-corner': { index: 1, model: 'track-corner', open: CORNER },
	'track-bump': { index: 2, model: 'track-bump', open: STRAIGHT },
	'track-finish': { index: 3, model: 'track-finish', open: STRAIGHT },
	'track-ramp': { index: 4, profile: ramp, open: STRAIGHT },
	'track-tabletop': { index: 5, profile: tabletop, open: STRAIGHT },
	'track-whoops': { index: 6, profile: whoops, open: STRAIGHT },
};

export const TYPE_BY_INDEX = [];
for ( const [ type, piece ] of Object.entries( PIECES ) ) TYPE_BY_INDEX[ piece.index ] = type;

// Click order of the editor's Element tool on a straight cell.
export const ELEMENT_CYCLE = [ 'track-straight', 'track-ramp', 'track-tabletop', 'track-whoops' ];

export function pieceModelNames() {

	return Object.values( PIECES ).filter( ( p ) => p.model ).map( ( p ) => p.model );

}

export function profileOf( type ) {

	return PIECES[ type ]?.profile ?? null;

}

export function profileMax( type ) {

	const h = profileOf( type );
	if ( ! h ) return 0;
	let max = 0;
	for ( let i = 0; i <= 200; i ++ ) max = Math.max( max, h( i / 200 ) );
	return max;

}

export function isStraightLike( type ) {

	return PIECES[ type ]?.open === STRAIGHT;

}
