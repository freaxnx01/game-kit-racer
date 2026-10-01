import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REST_Y, isAirborne, landingSpeed, airPitch } from '../js/Airtime.js';

test( 'isAirborne_onTheFloorOrARamp_isFalse', () => {

	assert.equal( isAirborne( REST_Y, 0 ), false );
	assert.equal( isAirborne( REST_Y + 0.9, 0.9 ), false );
	assert.equal( isAirborne( REST_Y + 0.1, 0 ), false );

} );

test( 'isAirborne_wellAboveTheGround_isTrue', () => {

	assert.equal( isAirborne( REST_Y + 0.5, 0 ), true );
	assert.equal( isAirborne( REST_Y + 1.2, 0.9 ), true );

} );

test( 'landingSpeed_onlyOnTheLandingFrame', () => {

	assert.equal( landingSpeed( true, false, - 4 ), 4 );
	assert.equal( landingSpeed( true, true, - 4 ), 0 );
	assert.equal( landingSpeed( false, false, - 4 ), 0 );

} );

test( 'airPitch_risingNoseUpFallingNoseDownClamped', () => {

	assert.ok( airPitch( 2, 10 ) > 0 );
	assert.ok( airPitch( - 2, 10 ) < 0 );
	assert.equal( airPitch( 0, 10 ), 0 );
	assert.equal( airPitch( - 100, 0.1 ), - 0.5 );

} );
