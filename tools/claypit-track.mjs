// Regenerates The Claypit (js/Tracks.js) from its original layout: every cell dirt except the finish, and
// three jumps on the long straights — a ramp, a tabletop and whoops, each facing the driving direction.
// Run: node tools/claypit-track.mjs  → prints the new map string for js/Tracks.js.

import { decodeCells, encodeCells } from '../js/TrackCodec.js';
import { trackOrder } from '../js/race/TrackPath.js';

// The original Claypit map (before the jumps existed), from js/Tracks.js at commit 6952c8a.
const ORIGINAL = process.argv[ 2 ];
if ( ! ORIGINAL ) throw new Error( 'usage: node tools/claypit-track.mjs <original claypit map string>' );

// Positions in driving order (0 = finish). The first long straight runs 1–19, the second 38–58.
const JUMPS = { 6: 'track-ramp', 13: 'track-tabletop', 46: 'track-whoops' };
const GODOT_OF_STEP = { '0,1': 0, '1,0': 16, '0,-1': 10, '-1,0': 22 };

const cells = decodeCells( ORIGINAL );
const order = trackOrder( cells );
if ( ! order ) throw new Error( 'the original Claypit is not a closed loop' );

for ( const [ index, type ] of Object.entries( JUMPS ) ) {

	const { cell, to } = order[ index ];
	if ( cell[ 2 ] !== 'track-straight' ) throw new Error( `position ${ index } is a ${ cell[ 2 ] }, not a straight` );
	cell[ 2 ] = type;
	cell[ 3 ] = GODOT_OF_STEP[ to.join( ',' ) ];

}

for ( const cell of cells ) if ( cell[ 2 ] !== 'track-finish' ) cell[ 4 ] = { dirt: true };

console.log( encodeCells( cells ) );
