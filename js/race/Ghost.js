// Ghost.js — your best lap as a replayable path: recorded while you drive, stored per track in
// localStorage, sampled by lap time so the ghost runs in sync with the lap timer. Pure (no three.js).
// A sample is [ t, px, py, pz, qx, qy, qz, qw ]: lap time in seconds, the truck's position and rotation.

export const SAMPLE_INTERVAL = 0.05; // seconds between recorded samples (20 Hz)
export const MAX_LAP_SECONDS = 300;  // longer laps are not kept as a ghost
const STORAGE_PREFIX = 'racing.ghost.';
const FORMAT = 1;
const STRIDE = 8;

export function ghostStorageKey( trackId ) {

	return STORAGE_PREFIX + ( trackId || 'default' );

}

// Pose at lap time t: blend between the samples around t, hold the first before it starts,
// null once the ghost has finished its lap (or when there is no ghost).
export function sampleGhost( ghost, t ) {

	if ( ! ghost || t > ghost.time ) return null;

	const s = ghost.samples;
	if ( t <= s[ 0 ][ 0 ] ) return pose( s[ 0 ] );
	if ( t >= s[ s.length - 1 ][ 0 ] ) return pose( s[ s.length - 1 ] );

	let lo = 0, hi = s.length - 1;
	while ( hi - lo > 1 ) {

		const mid = ( lo + hi ) >> 1;
		if ( s[ mid ][ 0 ] <= t ) lo = mid; else hi = mid;

	}

	const a = s[ lo ], b = s[ hi ];
	const k = ( t - a[ 0 ] ) / ( b[ 0 ] - a[ 0 ] || 1 );
	return {
		p: [ 1, 2, 3 ].map( ( i ) => a[ i ] + ( b[ i ] - a[ i ] ) * k ),
		q: nlerp( a.slice( 4, 8 ), b.slice( 4, 8 ), k ),
	};

}

function pose( sample ) {

	return { p: sample.slice( 1, 4 ), q: sample.slice( 4, 8 ) };

}

// Normalised lerp along the shorter arc — samples are only 50 ms apart.
function nlerp( a, b, k ) {

	const sign = a[ 0 ] * b[ 0 ] + a[ 1 ] * b[ 1 ] + a[ 2 ] * b[ 2 ] + a[ 3 ] * b[ 3 ] < 0 ? - 1 : 1;
	const q = a.map( ( x, i ) => x + ( sign * b[ i ] - x ) * k );
	const len = Math.hypot( ...q ) || 1;
	return q.map( ( x ) => x / len );

}

const round = ( x ) => Math.round( x * 1000 ) / 1000;

export function encodeGhost( ghost ) {

	return JSON.stringify( { v: FORMAT, time: round( ghost.time ), s: ghost.samples.flat().map( round ) } );

}

// Stored text → ghost, or null for anything that is not a well-formed ghost.
export function decodeGhost( text ) {

	let data;
	try {

		data = JSON.parse( text );

	} catch {

		return null;

	}

	if ( ! isValidData( data ) ) return null;

	const samples = [];
	for ( let i = 0; i < data.s.length; i += STRIDE ) samples.push( data.s.slice( i, i + STRIDE ) );
	return { time: data.time, samples };

}

function isValidData( data ) {

	if ( ! data || data.v !== FORMAT || ! Array.isArray( data.s ) ) return false;
	if ( ! Number.isFinite( data.time ) || data.time <= 0 || data.time > MAX_LAP_SECONDS ) return false;
	if ( data.s.length < STRIDE * 2 || data.s.length % STRIDE !== 0 ) return false;
	if ( ! data.s.every( Number.isFinite ) ) return false;

	for ( let i = STRIDE; i < data.s.length; i += STRIDE ) {

		if ( data.s[ i ] < data.s[ i - STRIDE ] ) return false;

	}

	return true;

}

// storage defaults to the browser's localStorage; tests pass a stand-in.
export function loadGhost( key, storage ) {

	try {

		return decodeGhost( ( storage || globalThis.localStorage ).getItem( key ) );

	} catch {

		return null;

	}

}

export function saveGhost( key, ghost, storage ) {

	try {

		( storage || globalThis.localStorage ).setItem( key, encodeGhost( ghost ) );

	} catch {}

}

// Records the lap being driven and keeps the fastest complete lap as `best`.
// Feed it every frame while the lap timer runs; onNewBest( ghost ) fires when best changes.
export class GhostRun {

	constructor( best ) {

		this.best = best;
		this.onNewBest = null;
		this.lap = null;
		this.samples = null;

	}

	// lap, lapTime, lastLap: LapTimer's lap, currentLapTime and lastLap; p, q: the truck's pose.
	update( lap, lapTime, lastLap, p, q ) {

		if ( this.lap !== null && lap === this.lap + 1 ) this.finishLap( lastLap, p, q );
		if ( lap !== this.lap ) this.startLap( lap );
		this.record( lapTime, p, q );

	}

	// Forget the lap in progress (e.g. while a multiplayer race runs); the next update starts over.
	discard() {

		this.lap = null;
		this.samples = null;

	}

	poseAt( lapTime ) {

		return sampleGhost( this.best, lapTime );

	}

	startLap( lap ) {

		this.lap = lap;
		this.samples = [];

	}

	record( lapTime, p, q ) {

		if ( ! this.samples ) return;

		const partialLap = this.samples.length === 0 && lapTime > SAMPLE_INTERVAL;
		if ( partialLap || lapTime > MAX_LAP_SECONDS ) {

			this.samples = null;
			return;

		}

		const last = this.samples[ this.samples.length - 1 ];
		if ( last && lapTime - last[ 0 ] < SAMPLE_INTERVAL - 1e-6 ) return; // tolerance: frame times are floats
		this.samples.push( [ lapTime, ...p, ...q ] );

	}

	finishLap( lapTime, p, q ) {

		if ( ! this.samples || ! Number.isFinite( lapTime ) ) return;
		if ( this.best && lapTime >= this.best.time ) return;

		this.samples.push( [ lapTime, ...p, ...q ] );
		this.best = { time: lapTime, samples: this.samples };
		this.onNewBest?.( this.best );

	}

}
