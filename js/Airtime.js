// Airtime.js — when the truck is in the air, when it lands, and how its nose points while flying.
// Pure (no three.js).

export const REST_Y = 0.385;   // sphere centre on the flat floor: floor top -0.115 + radius 0.5
const AIR_GAP = 0.15;          // units above rest before we call it flying (whoops bounce less than this)
const MAX_AIR_PITCH = 0.5;     // radians

export function isAirborne( sphereY, groundHeight ) {

	return sphereY - ( REST_Y + groundHeight ) > AIR_GAP;

}

export function landingSpeed( wasAirborne, airborne, verticalSpeed ) {

	return wasAirborne && ! airborne ? Math.abs( verticalSpeed ) : 0;

}

export function airPitch( verticalSpeed, horizontalSpeed ) {

	const pitch = 0.5 * Math.atan2( verticalSpeed, Math.max( horizontalSpeed, 1e-6 ) );
	return Math.min( MAX_AIR_PITCH, Math.max( - MAX_AIR_PITCH, pitch ) );

}
