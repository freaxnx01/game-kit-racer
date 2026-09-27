// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, t } from '../js/ui/strings.js';

const CPU_KEYS = [ 'cpu.button', 'cpu.title', 'cpu.opponents', 'cpu.difficulty', 'cpu.easy', 'cpu.medium', 'cpu.hard', 'cpu.quit', 'cpu.freeDrive', 'cpu.noLoop', 'cpu.restart', 'cpu.running' ];

test( 'STRINGS_cpuKeys_existInBothLanguages', () => {

	for ( const key of CPU_KEYS ) {

		assert.ok( STRINGS.en[ key ], `en ${ key }` );
		assert.ok( STRINGS.de[ key ], `de ${ key }` );

	}

	assert.equal( t( 'cpu.button', 'de' ), 'Gegen CPU' );

} );

test( 'STRINGS_raceControls_readNaturallyInGerman', () => {

	assert.equal( t( 'cpu.restart', 'de' ), 'Neu starten' );
	assert.equal( t( 'cpu.running', 'de' ), 'Rennen läuft' );
	assert.equal( t( 'cpu.restart', 'en' ), 'Restart race' );

} );
