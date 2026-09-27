// Light-probe grid size for main.js. The bake renders a cube map of the whole scene per probe, so a
// grid that grows with the track area made large tracks load for minutes (#15): cap it at the
// default track's 8 × 8. No three.js import, so Node tests can load it.

const PROBE_SPACING = 4; // one probe per 4 units of half-extent
const MIN_PROBES = 4; // per horizontal axis
const PROBE_LAYERS = 2;

export const MAX_GROUND_PROBES = 64;

export function probeGridSize( halfWidth, halfDepth ) {

	const x = Math.max( MIN_PROBES, Math.round( halfWidth / PROBE_SPACING ) );
	const z = Math.max( MIN_PROBES, Math.round( halfDepth / PROBE_SPACING ) );
	if ( x * z <= MAX_GROUND_PROBES ) return { x, y: PROBE_LAYERS, z };
	return shrinkToBudget( x, z );

}

// Both axes shrink by the same factor (keeps the aspect ratio); the longer one is trimmed so a
// thin track whose short axis sits at the minimum still fits the budget.
function shrinkToBudget( x, z ) {

	const factor = Math.sqrt( x * z / MAX_GROUND_PROBES );
	const sx = Math.max( MIN_PROBES, Math.floor( x / factor ) );
	const sz = Math.max( MIN_PROBES, Math.floor( z / factor ) );
	if ( sx >= sz ) return { x: Math.min( sx, Math.floor( MAX_GROUND_PROBES / sz ) ), y: PROBE_LAYERS, z: sz };
	return { x: sx, y: PROBE_LAYERS, z: Math.min( sz, Math.floor( MAX_GROUND_PROBES / sx ) ) };

}
