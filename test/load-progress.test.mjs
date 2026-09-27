// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoadProgress, STAGE_WEIGHTS, labelKey, cancelTarget } from '../js/LoadProgress.js';

const PLAIN = [ 'engine', 'models', 'track', 'lighting' ];
const OSM = [ ...PLAIN, 'surroundings' ];

test( 'STAGE_WEIGHTS_allStages_sumTo100', () => {

	assert.equal( Object.values( STAGE_WEIGHTS ).reduce( ( a, b ) => a + b, 0 ), 100 );

} );

test( 'percent_freshProgress_isZeroAndPending', () => {

	const p = new LoadProgress( OSM );
	assert.equal( p.percent, 0 );
	assert.equal( p.stage, 'pending' );

} );

test( 'percent_trackWithoutSurroundings_isRenormalised', () => {

	const p = new LoadProgress( PLAIN );
	p.begin( 'engine' );
	p.begin( 'models' );
	assert.equal( p.percent, 12 ); // 10 of 80
	p.step( 11, 11 );
	assert.equal( p.percent, 62 ); // 50 of 80

} );

test( 'step_partialModels_countsFractionAndKeepsDetail', () => {

	const p = new LoadProgress( OSM );
	p.begin( 'engine' );
	p.begin( 'models' );
	p.step( 7, 11 );
	assert.equal( p.percent, 35 ); // 10 + 40 × 7/11 = 35.45
	assert.deepEqual( p.detail, { done: 7, total: 11 } );

} );

test( 'percent_smallerStepAfterLargerOne_neverDecreases', () => {

	const p = new LoadProgress( OSM );
	p.begin( 'models' );
	p.step( 8, 11 );
	const before = p.percent;
	p.step( 3, 11 );
	assert.equal( p.percent, before );

} );

test( 'finish_anyStage_isDoneAt100', () => {

	const p = new LoadProgress( OSM );
	p.begin( 'lighting' );
	p.finish();
	assert.equal( p.stage, 'done' );
	assert.equal( p.percent, 100 );

} );

test( 'begin_invalidStages_throw', () => {

	const p = new LoadProgress( PLAIN );
	assert.throws( () => p.begin( 'teleport' ), /unknown load stage/ );
	assert.throws( () => p.begin( 'surroundings' ), /not configured/ );
	p.begin( 'track' );
	assert.throws( () => p.begin( 'models' ), /backwards/ );
	assert.throws( () => new LoadProgress( [ 'engine', 'bogus' ] ), /unknown load stage/ );

} );

test( 'step_zeroTotal_throws', () => {

	const p = new LoadProgress( PLAIN );
	p.begin( 'models' );
	assert.throws( () => p.step( 0, 0 ), /total/ );

} );

test( 'onChange_everyCommand_isCalled', () => {

	const p = new LoadProgress( PLAIN );
	const seen = [];
	p.onChange = () => seen.push( p.stage );
	p.begin( 'models' );
	p.step( 1, 11 );
	p.finish();
	assert.deepEqual( seen, [ 'models', 'models', 'done' ] );

} );

test( 'labelKey_stages_mapToStringKeys', () => {

	assert.equal( labelKey( 'pending', {} ), 'load.engine' );
	assert.equal( labelKey( 'models', { done: 1, total: 11 } ), 'load.models' );
	assert.equal( labelKey( 'surroundings', { phase: 'fetch', host: 'overpass.osm.ch', index: 1, count: 4 } ), 'load.fetch' );
	assert.equal( labelKey( 'surroundings', { phase: 'build' } ), 'load.build' );

} );

test( 'labelKey_surroundingsWithoutHost_isGenericSurroundingsLabel', () => {

	assert.equal( labelKey( 'surroundings', {} ), 'load.surroundings' );

} );

test( 'cancelTarget_cameFromAnotherTrack_returnsThere', () => {

	const from = 'https://h.test/game/index.html?map=AAA';
	assert.equal( cancelTarget( 'https://h.test/game/index.html?map=BBB', from ), from );
	assert.equal( cancelTarget( 'https://h.test/game/index.html?map=BBB', 'https://h.test/game/' ), 'https://h.test/game/' );

} );

test( 'cancelTarget_cameFromElsewhere_fallsBackToDefaultTrack', () => {

	const current = 'https://h.test/game/index.html?map=BBB';
	const fallback = 'https://h.test/game/index.html';
	assert.equal( cancelTarget( current, '' ), fallback );
	assert.equal( cancelTarget( current, 'https://h.test/game/osm-track.html' ), fallback );
	assert.equal( cancelTarget( current, 'https://other.test/game/index.html?map=AAA' ), fallback );
	assert.equal( cancelTarget( current, current ), fallback );

} );

test( 'cancelTarget_defaultTrackWithoutReferrer_isNull', () => {

	assert.equal( cancelTarget( 'https://h.test/game/', '' ), null );
	assert.equal( cancelTarget( 'https://h.test/game/index.html', 'https://h.test/game/osm-track.html' ), null );

} );
