// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeGridSize, MAX_GROUND_PROBES } from '../js/ProbeGrid.js';
import { PRESET_TRACKS } from '../js/Tracks.js';
import { decodeCells } from '../js/TrackCodec.js';

const CELL = 9.99 * 0.75;

// Same bounds as computeTrackBounds in js/Track.js (which needs three.js, so not imported here)
function halfExtents( map ) {

	if ( ! map ) return { hw: 30, hd: 30 };

	const cells = decodeCells( map );
	const xs = cells.map( ( c ) => c[ 0 ] );
	const zs = cells.map( ( c ) => c[ 1 ] );

	return {
		hw: ( Math.max( ...xs ) - Math.min( ...xs ) + 1 ) / 2 * CELL + CELL,
		hd: ( Math.max( ...zs ) - Math.min( ...zs ) + 1 ) / 2 * CELL + CELL,
	};

}

test( 'probeGridSize_defaultTrack_isUnchanged', () => {

	assert.deepEqual( probeGridSize( 30, 30 ), { x: 8, y: 2, z: 8 } );

} );

test( 'probeGridSize_tinyTrack_keepsMinimumOfFour', () => {

	assert.deepEqual( probeGridSize( 2 * CELL, 2 * CELL ), { x: 4, y: 2, z: 4 } );
	assert.deepEqual( probeGridSize( 0, 0 ), { x: 4, y: 2, z: 4 } );

} );

test( 'probeGridSize_everyPreset_staysWithinBudget', () => {

	for ( const track of PRESET_TRACKS ) {

		const { hw, hd } = halfExtents( track.map );
		const { x, y, z } = probeGridSize( hw, hd );
		assert.ok( x * z <= MAX_GROUND_PROBES, `${ track.id }: ${ x }x${ z }` );
		assert.ok( x >= 4 && z >= 4, track.id );
		assert.equal( y, 2, track.id );

	}

} );

test( 'probeGridSize_badSaeckingen_shrinksToSevenByEight', () => {

	const track = PRESET_TRACKS.find( ( t ) => t.id === 'bad-saeckingen' );
	const { hw, hd } = halfExtents( track.map );
	assert.deepEqual( probeGridSize( hw, hd ), { x: 7, y: 2, z: 8 } );

} );

test( 'probeGridSize_aerodrome_keepsAspectRatio', () => {

	const track = PRESET_TRACKS.find( ( t ) => t.id === 'aero' );
	const { hw, hd } = halfExtents( track.map );
	assert.deepEqual( probeGridSize( hw, hd ), { x: 12, y: 2, z: 5 } );

} );

test( 'probeGridSize_elongatedTrack_keepsMinimumAndBudget', () => {

	assert.deepEqual( probeGridSize( 400, 16 ), { x: 16, y: 2, z: 4 } );
	assert.deepEqual( probeGridSize( 16, 400 ), { x: 4, y: 2, z: 16 } );

} );
