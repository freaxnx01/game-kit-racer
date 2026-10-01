// ContactFx.js — which sphere↔static contacts should trigger the wall-impact sound.
// Pure (no three.js, no crashcat).

const VERTICAL_NORMAL_THRESHOLD = 0.7;

// Floor/ramp/tabletop/whoops contacts have a mostly-vertical normal (driving onto, off of, or
// across a profile piece starts new contacts there); those are not wall hits. Landings are
// handled separately by Airtime.
export function isWallImpact( normalY ) {

	return Math.abs( normalY ) <= VERTICAL_NORMAL_THRESHOLD;

}
