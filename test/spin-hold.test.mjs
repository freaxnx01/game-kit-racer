// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpinHold } from '../js/SpinHold.js';

const DT = 1 / 60;
const FULL_LOCK = 4; // rad/s — Vehicle.js: 4 · steeringGrip at full grip

// Feeds `seconds` of frames turning at `yawRate`, reporting the heading like main.js does:
// atan2 of the forward vector, i.e. always wrapped to (-π, π].
function drive( hold, seconds, yawRate, start = 0 ) {

	let heading = start;
	const frames = Math.round( seconds / DT );
	for ( let i = 0; i < frames; i ++ ) {

		heading += yawRate * DT;
		hold.update( DT, Math.atan2( Math.sin( heading ), Math.cos( heading ) ) );

	}

	return heading;

}

test( 'update_straightDriving_holdStaysZero', () => {

	const hold = new SpinHold();
	drive( hold, 5, 0 );
	assert.equal( hold.hold, 0 );

} );

test( 'update_fullLockHairpin180_holdStaysZero', () => {

	const hold = new SpinHold();
	const heading = drive( hold, Math.PI / FULL_LOCK, FULL_LOCK );
	drive( hold, 1, 0, heading );
	assert.equal( hold.hold, 0 );

} );

test( 'update_sustainedSpin_holdReachesOne', () => {

	const hold = new SpinHold();
	drive( hold, 2, FULL_LOCK );
	assert.equal( hold.hold, 1 );

} );

test( 'update_sustainedSpin_holdFadesInRatherThanJumping', () => {

	const hold = new SpinHold();
	drive( hold, 1.1, FULL_LOCK ); // just past 225° at 4 rad/s (≈ 0.98 s)
	assert.ok( hold.hold > 0 && hold.hold < 0.5, `hold ${ hold.hold }` );

} );

test( 'update_spinEnds_holdReturnsToZero', () => {

	const hold = new SpinHold();
	const heading = drive( hold, 2, FULL_LOCK );
	drive( hold, 1, 0, heading );
	assert.equal( hold.hold, 0 );

} );

test( 'update_spinDirectionReverses_restartsTheCount', () => {

	const hold = new SpinHold();
	const heading = drive( hold, 0.9, FULL_LOCK ); // ≈ 206° left
	drive( hold, 0.9, - FULL_LOCK, heading ); // ≈ 206° right
	assert.equal( hold.hold, 0 );

} );

test( 'update_spinClockwiseAcrossPlusMinusPi_countsContinuously', () => {

	const hold = new SpinHold();
	drive( hold, 2, - FULL_LOCK, 3 ); // starts just below +π and wraps several times
	assert.equal( hold.hold, 1 );

} );

test( 'update_zeroDt_isIgnored', () => {

	const hold = new SpinHold();
	drive( hold, 2, FULL_LOCK );
	hold.update( 0, 1 );
	assert.equal( hold.hold, 1 );

} );
