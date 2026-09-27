// SpinHold.js — detects a sustained spin (donut) from the truck's heading and fades a 0..1
// "hold" value in and out, so the camera can stay still while the truck turns on the spot.
// Pure: no three.js, importable from Node.

export const SPIN_MIN_YAW_RATE = 2.5; // rad/s — slower turning is ordinary cornering
export const SPIN_ENGAGE_ANGLE = 1.25 * Math.PI; // 225° — more than any corner or hairpin
export const HOLD_RATE = 2; // hold units per second (≈ 0.5 s fade)

function wrapAngle( angle ) {

	let a = angle;
	while ( a > Math.PI ) a -= Math.PI * 2;
	while ( a < - Math.PI ) a += Math.PI * 2;
	return a;

}

export class SpinHold {

	constructor() {

		this.hold = 0;
		this.spun = 0;
		this.heading = null;

	}

	update( dt, heading ) {

		if ( ! ( dt > 0 ) ) return;

		const turned = this.heading === null ? 0 : wrapAngle( heading - this.heading );
		this.heading = heading;
		this.accumulate( turned, dt );
		this.approach( Math.abs( this.spun ) >= SPIN_ENGAGE_ANGLE ? 1 : 0, dt );

	}

	accumulate( turned, dt ) {

		if ( Math.abs( turned ) / dt < SPIN_MIN_YAW_RATE ) {

			this.spun = 0;
			return;

		}

		const sameWay = this.spun === 0 || Math.sign( turned ) === Math.sign( this.spun );
		this.spun = sameWay ? this.spun + turned : turned;

	}

	approach( target, dt ) {

		const step = HOLD_RATE * dt;
		this.hold = target > this.hold ? Math.min( target, this.hold + step ) : Math.max( target, this.hold - step );

	}

}
