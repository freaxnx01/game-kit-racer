// CpuDriver.js — one CPU truck: drives along a TrackPath at a speed set by its difficulty, slowing
// down for corners, and reports where it is as a { p, q, v } state for Opponents. Pure.

import { samplePath } from './TrackPath.js';

// Speeds in world units per second. The player's fastest laps average about 13 units/s
// (RaceState.js MAX_AVG_SPEED = 40 is "about three times" that). Tune here after play-testing.
export const DIFFICULTY = {
	easy: { speed: 8, corner: 0.6 },
	medium: { speed: 10, corner: 0.7 },
	hard: { speed: 12.5, corner: 0.75 },
};

export const ACCELERATION = 6;   // units/s² when speeding up
export const BRAKING = 14;       // units/s² when slowing for a corner
export const LOOK_AHEAD = 4;     // units: start braking when a corner is this close
const SPHERE_Y = 0.5;            // sphere centre height, as the player's (Physics.js createSphereBody)
const HEADING_SPAN = 1;          // units: heading is taken from the line this far behind to this far ahead

export class CpuDriver {

	// path: buildPath() result; start: distance along the path (≤ 0 = behind the finish line);
	// lateral: lane offset to the right of the line; difficulty: a DIFFICULTY entry; pace: speed multiplier.
	constructor( { path, start, lateral, difficulty, pace = 1 } ) {

		this.path = path;
		this.distance = start;
		this.lateral = lateral;
		this.topSpeed = difficulty.speed * pace;
		this.cornerSpeed = difficulty.speed * difficulty.corner * pace;
		this.speed = 0;

	}

	// Advances the truck by dt seconds.
	update( dt ) {

		const target = this.targetSpeed();
		const rate = target > this.speed ? ACCELERATION : BRAKING;
		const step = rate * dt;
		this.speed = Math.abs( target - this.speed ) <= step ? target : this.speed + Math.sign( target - this.speed ) * step;
		this.distance += this.speed * dt;

	}

	targetSpeed() {

		const here = samplePath( this.path, this.distance, 0 ).corner;
		const ahead = samplePath( this.path, this.distance + LOOK_AHEAD, 0 ).corner;
		return here || ahead ? this.cornerSpeed : this.topSpeed;

	}

	// Completed laps: the first crossing of the finish line after the start is not a lap.
	lapsDone() {

		return Math.max( 0, Math.floor( this.distance / this.path.length ) );

	}

	// Fraction (0..1) of the current lap driven.
	progress() {

		if ( this.distance < 0 ) return 0;
		return ( this.distance % this.path.length ) / this.path.length;

	}

	// Pose for Opponents.push: position, yaw-only quaternion, velocity. The lane offset follows the smoothed
	// heading's right vector, not the current segment's normal, so a truck off the centre line does not jump
	// sideways at every 15° arc vertex.
	state() {

		const centre = samplePath( this.path, this.distance, 0 );
		const behind = samplePath( this.path, this.distance - HEADING_SPAN, 0 );
		const ahead = samplePath( this.path, this.distance + HEADING_SPAN, 0 );
		const heading = Math.atan2( ahead.x - behind.x, ahead.z - behind.z ); // smooth through the 15° arc steps
		const fx = Math.sin( heading ), fz = Math.cos( heading );
		return {
			p: [ centre.x + fz * this.lateral, SPHERE_Y, centre.z - fx * this.lateral ],
			q: [ 0, Math.sin( heading / 2 ), 0, Math.cos( heading / 2 ) ],
			v: [ fx * this.speed, 0, fz * this.speed ],
		};

	}

}
