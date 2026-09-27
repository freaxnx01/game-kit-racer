// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyboardAxes } from '../js/Controls.js';

test( 'keyboardAxes_spaceHeld_accelerates', () => {

	assert.deepEqual( keyboardAxes( { Space: true } ), { x: 0, z: 1 } );

} );

test( 'keyboardAxes_spaceAndW_staysFullThrottle', () => {

	assert.deepEqual( keyboardAxes( { Space: true, KeyW: true } ), { x: 0, z: 1 } );

} );

test( 'keyboardAxes_spaceAndS_cancelsOut', () => {

	assert.deepEqual( keyboardAxes( { Space: true, KeyS: true } ), { x: 0, z: 0 } );

} );

test( 'keyboardAxes_steeringKeys_unchanged', () => {

	assert.deepEqual( keyboardAxes( { KeyA: true } ), { x: - 1, z: 0 } );
	assert.deepEqual( keyboardAxes( { ArrowRight: true, ArrowDown: true } ), { x: 1, z: - 1 } );
	assert.deepEqual( keyboardAxes( { ArrowUp: true, ArrowLeft: true } ), { x: - 1, z: 1 } );

} );

test( 'keyboardAxes_noKeys_isZero', () => {

	assert.deepEqual( keyboardAxes( {} ), { x: 0, z: 0 } );
	assert.deepEqual( keyboardAxes( { Space: false, KeyW: false } ), { x: 0, z: 0 } );

} );
