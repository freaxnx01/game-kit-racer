// Ghost.js — your best lap as a replayable path: recorded while you drive, stored per track in
// localStorage, sampled by lap time so the ghost runs in sync with the lap timer. Pure (no three.js).
// A sample is [ t, px, py, pz, qx, qy, qz, qw ]: lap time in seconds, the truck's position and rotation.

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
