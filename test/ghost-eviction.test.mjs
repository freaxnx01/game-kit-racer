// Run: node --test test/*.test.mjs
// Ghost storage must not grow without bound (review finding on #9): at most MAX_STORED_GHOSTS
// tracks are kept, evicted least-recently-saved first, tracked by racing.ghost.index.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveGhost, loadGhost, ghostStorageKey, MAX_STORED_GHOSTS } from '../js/race/Ghost.js';

const INDEX_KEY = 'racing.ghost.index';
const ghost = ( t = 1 ) => ( { time: t, samples: [ [ 0, 0, 0, 0, 0, 0, 0, 1 ], [ t, 1, 0, 0, 0, 0, 0, 1 ] ] } );

// storage stand-in with length/key/removeItem so eviction can enumerate and drop entries,
// and an optional quota simulation on setItem.
function fakeStorage( { failUntilFreed = 0 } = {} ) {

	const map = new Map();
	let failuresLeft = failUntilFreed;
	return {
		getItem: ( k ) => map.has( k ) ? map.get( k ) : null,
		setItem: ( k, v ) => {

			if ( failuresLeft > 0 ) {

				failuresLeft --;
				throw new Error( 'quota exceeded' );

			}

			map.set( k, String( v ) );

		},
		removeItem: ( k ) => map.delete( k ),
		get length() {

			return map.size;

		},
		key: ( i ) => Array.from( map.keys() )[ i ] ?? null,
	};

}

function index( storage ) {

	return JSON.parse( storage.getItem( INDEX_KEY ) );

}

test( 'saveGhost_sixthTrack_evictsLeastRecentlySavedAndKeepsFive', () => {

	const storage = fakeStorage();
	for ( let i = 1; i <= 6; i ++ ) saveGhost( ghostStorageKey( 't' + i ), ghost( i ), storage );

	const idx = index( storage );
	assert.equal( idx.length, MAX_STORED_GHOSTS );
	assert.deepEqual( idx, [ 't6', 't5', 't4', 't3', 't2' ].map( ghostStorageKey ) );
	assert.equal( loadGhost( ghostStorageKey( 't1' ), storage ), null );
	assert.notEqual( loadGhost( ghostStorageKey( 't6' ), storage ), null );

} );

test( 'saveGhost_existingTrack_movesToFrontWithoutDuplicating', () => {

	const storage = fakeStorage();
	saveGhost( ghostStorageKey( 't1' ), ghost( 1 ), storage );
	saveGhost( ghostStorageKey( 't2' ), ghost( 2 ), storage );
	saveGhost( ghostStorageKey( 't1' ), ghost( 3 ), storage );

	const idx = index( storage );
	assert.deepEqual( idx, [ 't1', 't2' ].map( ghostStorageKey ) );
	assert.equal( loadGhost( ghostStorageKey( 't1' ), storage ).time, 3 );

} );

test( 'saveGhost_quotaError_evictsOldestOtherGhostThenRetries', () => {

	const storage = fakeStorage( { failUntilFreed: 1 } );
	saveGhost( ghostStorageKey( 't1' ), ghost( 1 ), storage );
	saveGhost( ghostStorageKey( 't2' ), ghost( 2 ), storage );

	// t1 is oldest; a quota error on the third save should evict it and retry successfully.
	saveGhost( ghostStorageKey( 't3' ), ghost( 3 ), storage );

	assert.equal( loadGhost( ghostStorageKey( 't1' ), storage ), null );
	assert.notEqual( loadGhost( ghostStorageKey( 't3' ), storage ), null );
	assert.deepEqual( index( storage ), [ 't3', 't2' ].map( ghostStorageKey ) );

} );

test( 'saveGhost_quotaErrorWithNothingElseToEvict_givesUpSilently', () => {

	const storage = fakeStorage( { failUntilFreed: Infinity } );
	assert.doesNotThrow( () => saveGhost( ghostStorageKey( 'only' ), ghost(), storage ) );
	assert.equal( loadGhost( ghostStorageKey( 'only' ), storage ), null );

} );

test( 'saveGhost_corruptIndex_isTolerated', () => {

	const storage = fakeStorage();
	storage.setItem( INDEX_KEY, 'not json' );

	assert.doesNotThrow( () => saveGhost( ghostStorageKey( 't1' ), ghost(), storage ) );
	assert.deepEqual( index( storage ), [ ghostStorageKey( 't1' ) ] );

} );

test( 'saveGhost_unrelatedKeys_surviveEveryOperation', () => {

	const storage = fakeStorage();
	storage.setItem( 'racing.bestLap.t1', '12.3' );
	storage.setItem( 'osm-track.cache.q', '{}' );
	storage.setItem( 'gg-lang', 'de' );

	for ( let i = 1; i <= 6; i ++ ) saveGhost( ghostStorageKey( 't' + i ), ghost( i ), storage );

	assert.equal( storage.getItem( 'racing.bestLap.t1' ), '12.3' );
	assert.equal( storage.getItem( 'osm-track.cache.q' ), '{}' );
	assert.equal( storage.getItem( 'gg-lang' ), 'de' );

} );
