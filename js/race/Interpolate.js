// Interpolate.js — where to draw a remote truck: a short buffer of timestamped states, sampled a little
// in the past so there is (almost) always a newer state to blend towards. Pure.

export const RENDER_DELAY_MS = 100;
export const MAX_EXTRAPOLATE_MS = 200;
const BUFFER_SIZE = 20;

// Keeps the newest BUFFER_SIZE states, ordered by arrival time. state = { t, p: [x,y,z], q: [x,y,z,w], v: [x,y,z] }.
export function pushState( buffer, state ) {

	buffer.push( state );
	buffer.sort( ( a, b ) => a.t - b.t );
	if ( buffer.length > BUFFER_SIZE ) buffer.splice( 0, buffer.length - BUFFER_SIZE );

}

// Pose at time t: blend between the two states around t; past the newest state, coast along its
// velocity for at most MAX_EXTRAPOLATE_MS; before the oldest, hold the oldest. null when empty.
export function sampleBuffer( buffer, t ) {

	if ( buffer.length === 0 ) return null;

	const first = buffer[ 0 ], last = buffer[ buffer.length - 1 ];
	if ( t <= first.t ) return { p: first.p.slice(), q: first.q.slice() };

	if ( t >= last.t ) {

		const dt = Math.min( t - last.t, MAX_EXTRAPOLATE_MS ) / 1000;
		return { p: last.p.map( ( x, i ) => x + last.v[ i ] * dt ), q: last.q.slice() };

	}

	let i = buffer.length - 2;
	while ( buffer[ i ].t > t ) i --;
	const a = buffer[ i ], b = buffer[ i + 1 ];
	const k = ( t - a.t ) / ( b.t - a.t || 1 );
	return { p: a.p.map( ( x, j ) => x + ( b.p[ j ] - x ) * k ), q: nlerp( a.q, b.q, k ) };

}

// Normalised lerp along the shorter arc — plenty for 50 ms apart.
function nlerp( a, b, k ) {

	const sign = a[ 0 ] * b[ 0 ] + a[ 1 ] * b[ 1 ] + a[ 2 ] * b[ 2 ] + a[ 3 ] * b[ 3 ] < 0 ? - 1 : 1;
	const q = a.map( ( x, i ) => x + ( sign * b[ i ] - x ) * k );
	const len = Math.hypot( ...q ) || 1;
	return q.map( ( x ) => x / len );

}
