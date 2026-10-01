// Prints The Claypit's map string with its jumps and dirt (see tools/claypit.mjs) for a plain layout.
// tools/aerodrome-tracks.mjs already does this when it regenerates js/Tracks.js; this is for a one-off.
// Run: node tools/claypit-track.mjs <plain claypit map string>

import { decodeCells, encodeCells } from '../js/TrackCodec.js';
import { claypitWithJumps } from './claypit.mjs';

const plain = process.argv[ 2 ];
if ( ! plain ) throw new Error( 'usage: node tools/claypit-track.mjs <plain claypit map string>' );

console.log( encodeCells( claypitWithJumps( decodeCells( plain ) ) ) );
