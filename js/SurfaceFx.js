// SurfaceFx.js — how each surface drives and looks: sphere grip, top-speed factor, which particles the wheels
// throw and how the skid sounds. Tuning values; change them here after play-testing. Pure.

export const GRIP = { asphalt: 5.0, dirt: 1.5 };
export const SPEED_FACTOR = { asphalt: 1, dirt: 0.8 };

const SMOKE_DRIFT = 0.7;       // today's smoke threshold (Particles.js)
const DUST_SPEED = 0.4;        // fraction of MAX_SPEED from which dirt throws dust without drifting
const DIRT_SKID = { volume: 0.6, pitch: 0.7, tone: 0.4 };
const ASPHALT_SKID = { volume: 1, pitch: 1, tone: 1 };

export function smokeEmits( surface, driftIntensity ) {

	return surface === 'asphalt' && driftIntensity > SMOKE_DRIFT;

}

export function dustEmits( surface, driftIntensity, speed01 ) {

	return surface === 'dirt' && ( driftIntensity > SMOKE_DRIFT || speed01 > DUST_SPEED );

}

export function skidShape( surface ) {

	return surface === 'dirt' ? { ...DIRT_SKID } : { ...ASPHALT_SKID };

}
