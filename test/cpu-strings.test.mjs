// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, t } from '../js/ui/strings.js';

const CPU_KEYS = [ 'cpu.button', 'cpu.title', 'cpu.opponents', 'cpu.difficulty', 'cpu.easy', 'cpu.medium', 'cpu.hard', 'cpu.quit', 'cpu.freeDrive', 'cpu.noLoop' ];

test( 'STRINGS_cpuKeys_existInBothLanguages', () => {

	for ( const key of CPU_KEYS ) {

		assert.ok( STRINGS.en[ key ], `en ${ key }` );
		assert.ok( STRINGS.de[ key ], `de ${ key }` );

	}

	assert.equal( t( 'cpu.button', 'de' ), 'Gegen CPU' );

} );
