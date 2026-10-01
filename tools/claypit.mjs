// The Claypit's jumps and dirt, applied to its plain Aerodrome Apex layout: every cell dirt except the
// finish, and three jumps on the long straights — a ramp, a tabletop and whoops, each facing the driving
// direction. Used by tools/aerodrome-tracks.mjs (so regenerating js/Tracks.js keeps them) and
// tools/claypit-track.mjs.

import { trackOrder } from '../js/race/TrackPath.js';

// Positions in driving order (0 = finish). The first long straight runs 1–19, the second 38–58.
const JUMPS = { 6: 'track-ramp', 13: 'track-tabletop', 46: 'track-whoops' };
const GODOT_OF_STEP = { '0,1': 0, '1,0': 16, '0,-1': 10, '-1,0': 22 };

// Returns new cells; the input is left untouched.
export function claypitWithJumps( plainCells ) {

	const cells = plainCells.map( ( c ) => c.slice( 0, 4 ) );
	const order = trackOrder( cells );
	if ( ! order ) throw new Error( 'the Claypit layout is not a closed loop' );

	for ( const [ index, type ] of Object.entries( JUMPS ) ) {

		const { cell, to } = order[ index ];
		if ( cell[ 2 ] !== 'track-straight' ) throw new Error( `Claypit position ${ index } is a ${ cell[ 2 ] }, not a straight` );
		cell[ 2 ] = type;
		cell[ 3 ] = GODOT_OF_STEP[ to.join( ',' ) ];

	}

	for ( const cell of cells ) if ( cell[ 2 ] !== 'track-finish' ) cell.push( { dirt: true } );
	return cells;

}
