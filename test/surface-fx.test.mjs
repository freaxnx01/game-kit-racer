// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRIP, SPEED_FACTOR, smokeEmits, dustEmits, skidShape } from '../js/SurfaceFx.js';

test( 'GRIP_dirt_isLooserThanAsphaltAndAsphaltIsUnchanged', () => {

	assert.equal( GRIP.asphalt, 5.0 );
	assert.ok( GRIP.dirt < GRIP.asphalt );
	assert.ok( SPEED_FACTOR.dirt < SPEED_FACTOR.asphalt );

} );

test( 'smokeEmits_onlyOnAsphaltWhenDrifting', () => {

	assert.equal( smokeEmits( 'asphalt', 0.8 ), true );
	assert.equal( smokeEmits( 'asphalt', 0.5 ), false );
	assert.equal( smokeEmits( 'dirt', 2 ), false );

} );

test( 'dustEmits_onDirtFromMediumSpeedOrWhenDrifting', () => {

	assert.equal( dustEmits( 'dirt', 0, 0.6 ), true );
	assert.equal( dustEmits( 'dirt', 0, 0.2 ), false );
	assert.equal( dustEmits( 'dirt', 0.8, 0.1 ), true );
	assert.equal( dustEmits( 'asphalt', 2, 1 ), false );

} );

test( 'skidShape_dirt_isQuieterAndLower', () => {

	assert.deepEqual( skidShape( 'asphalt' ), { volume: 1, pitch: 1, tone: 1 } );
	const d = skidShape( 'dirt' );
	assert.ok( d.volume < 1 && d.pitch < 1 && d.tone < 1 );

} );
