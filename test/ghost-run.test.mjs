// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GhostRun, SAMPLE_INTERVAL, MAX_LAP_SECONDS } from '../js/race/Ghost.js';

const Q0 = [ 0, 0, 0, 1 ];
const sample = ( t, x, q = Q0 ) => [ t, x, 0, 0, ...q ];
const near = ( a, b, eps = 1e-9 ) => assert.ok( Math.abs( a - b ) < eps, `${ a } vs ${ b }` );

// Drives a GhostRun like main.js does: one call per frame with the LapTimer's lap, lap time and last lap.
function drive( run, frames ) {

	for ( const [ lap, lapTime, lastLap, x ] of frames ) run.update( lap, lapTime, lastLap, [ x, 0, 0 ], Q0 );

}

function lapFrames( lap, seconds, lastLap, fps = 60 ) {

	const frames = [];
	for ( let i = 0; i * ( 1 / fps ) < seconds; i ++ ) frames.push( [ lap, i / fps, lastLap, i ] );
	return frames;

}

test( 'GhostRun_firstCompletedLap_becomesBestAndIsReported', () => {

	const run = new GhostRun( null );
	const reported = [];
	run.onNewBest = ( ghost ) => reported.push( ghost );
	drive( run, lapFrames( 1, 2, null ) );
	drive( run, [ [ 2, 0, 2, 999 ] ] );
	assert.equal( reported.length, 1 );
	assert.equal( run.best, reported[ 0 ] );
	near( run.best.time, 2 );
	const last = run.best.samples[ run.best.samples.length - 1 ];
	assert.deepEqual( last.slice( 0, 2 ), [ 2, 999 ] );

} );

test( 'GhostRun_recording_keepsAboutTwentySamplesPerSecond', () => {

	const run = new GhostRun( null );
	drive( run, lapFrames( 1, 2, null ) );
	drive( run, [ [ 2, 0, 2, 0 ] ] );
	const n = run.best.samples.length;
	assert.ok( n >= 2 / SAMPLE_INTERVAL - 2 && n <= 2 / SAMPLE_INTERVAL + 2, `${ n } samples` );

} );

test( 'GhostRun_slowerLap_keepsPreviousBest', () => {

	const best = { time: 1.5, samples: [ sample( 0, 0 ), sample( 1.5, 1 ) ] };
	const run = new GhostRun( best );
	let reported = 0;
	run.onNewBest = () => reported ++;
	drive( run, lapFrames( 1, 2, null ) );
	drive( run, [ [ 2, 0, 2, 0 ] ] );
	assert.equal( run.best, best );
	assert.equal( reported, 0 );

} );

test( 'GhostRun_fasterLap_replacesBest', () => {

	const run = new GhostRun( { time: 5, samples: [ sample( 0, 0 ), sample( 5, 1 ) ] } );
	drive( run, lapFrames( 1, 2, null ) );
	drive( run, [ [ 2, 0, 2, 0 ] ] );
	near( run.best.time, 2 );

} );

test( 'GhostRun_lapLongerThanLimit_isNotKept', () => {

	const run = new GhostRun( null );
	drive( run, [ [ 1, 0, null, 0 ], [ 1, MAX_LAP_SECONDS + 1, null, 1 ], [ 2, 0, MAX_LAP_SECONDS + 1, 2 ] ] );
	assert.equal( run.best, null );

} );

test( 'GhostRun_discardMidLap_dropsThatLap', () => {

	const run = new GhostRun( null );
	drive( run, lapFrames( 1, 1, null ) );
	run.discard();
	drive( run, [ [ 1, 0.5, null, 0 ], [ 2, 0, 1.2, 0 ] ] );
	assert.equal( run.best, null );

} );

test( 'GhostRun_lapCounterJumpsBack_startsOver', () => {

	const run = new GhostRun( null );
	drive( run, lapFrames( 3, 1, 9 ) );
	drive( run, [ [ 1, 0, null, 0 ], [ 2, 0, 1, 0 ] ] );
	near( run.best.time, 1 );
	assert.equal( run.best.samples.length, 2 );

} );

test( 'GhostRun_poseAt_followsBest', () => {

	const run = new GhostRun( { time: 1, samples: [ sample( 0, 0 ), sample( 1, 10 ) ] } );
	near( run.poseAt( 0.25 ).p[ 0 ], 2.5 );
	assert.equal( run.poseAt( 2 ), null );

} );
