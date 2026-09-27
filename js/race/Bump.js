// Bump.js — how hard a truck-on-truck bump may hit. Opponent trucks are kinematic (infinite mass), so the
// physics engine alone hands your truck their full speed. Pure.

export const MAX_KINEMATIC_SPEED = 40;     // u/s — faster than this between two poses is a jump, not driving (= RaceState MAX_AVG_SPEED)
export const MAX_BUMP_GAIN = 3;            // u/s — most horizontal speed one physics step of bumping may add or take away
export const BUMP_SOUND_COOLDOWN_MS = 200; // per opponent, so a scraping contact does not machine-gun the sound

// True when getting from `from` to `to` within dt seconds would take more than MAX_KINEMATIC_SPEED.
export function isTeleport( from, to, dt ) {

	const distance = Math.hypot( to[ 0 ] - from[ 0 ], to[ 1 ] - from[ 1 ], to[ 2 ] - from[ 2 ] );
	return distance > MAX_KINEMATIC_SPEED * dt;

}

// Your velocity after a physics step that had an opponent contact, softened: the horizontal change is capped
// at maxGain, and the bump cannot lift you (vertical speed never rises above max( before, 0 )).
export function softenBump( before, after, maxGain = MAX_BUMP_GAIN ) {

	const dx = after[ 0 ] - before[ 0 ], dz = after[ 2 ] - before[ 2 ];
	const gain = Math.hypot( dx, dz );
	const k = gain > maxGain ? maxGain / gain : 1;
	return [ before[ 0 ] + dx * k, Math.min( after[ 1 ], Math.max( before[ 1 ], 0 ) ), before[ 2 ] + dz * k ];

}

// Horizontal relative speed of two bodies — how hard they hit each other.
export function bumpSpeed( a, b ) {

	return Math.hypot( a[ 0 ] - b[ 0 ], a[ 2 ] - b[ 2 ] );

}
