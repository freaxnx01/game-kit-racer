// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyboardAxes, swallowsSpace } from '../js/Controls.js';

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

test( 'swallowsSpace_focusedButton_true', () => {

	assert.equal( swallowsSpace( 'Space', { tagName: 'BUTTON' } ), true );
	assert.equal( swallowsSpace( 'Space', { tagName: 'BODY', isContentEditable: false } ), true );

} );

test( 'swallowsSpace_editableTargets_false', () => {

	for ( const tagName of [ 'INPUT', 'TEXTAREA', 'SELECT' ] ) assert.equal( swallowsSpace( 'Space', { tagName } ), false, tagName );
	assert.equal( swallowsSpace( 'Space', { tagName: 'DIV', isContentEditable: true } ), false );

} );

test( 'swallowsSpace_noTarget_true', () => {

	assert.equal( swallowsSpace( 'Space', null ), true );
	assert.equal( swallowsSpace( 'Space', {} ), true );

} );

test( 'swallowsSpace_otherKey_false', () => {

	assert.equal( swallowsSpace( 'KeyW', { tagName: 'BUTTON' } ), false );
	assert.equal( swallowsSpace( 'Enter', { tagName: 'BUTTON' } ), false );

} );
