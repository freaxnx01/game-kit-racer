// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWallImpact } from '../js/ContactFx.js';

test( 'isWallImpact_mostlyVerticalNormal_isFalse', () => {

	assert.equal( isWallImpact( 1 ), false );
	assert.equal( isWallImpact( - 1 ), false );
	assert.equal( isWallImpact( 0.9 ), false );

} );

test( 'isWallImpact_mostlyHorizontalNormal_isTrue', () => {

	assert.equal( isWallImpact( 0 ), true );
	assert.equal( isWallImpact( 0.5 ), true );
	assert.equal( isWallImpact( - 0.5 ), true );

} );
