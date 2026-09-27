// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioUnlock, UNLOCK_EVENTS } from '../js/AudioUnlock.js';

// Stand-in for an AudioContext: `resumeMode` decides what resume() does — 'run' (the browser
// allows it), 'stay' (resolves, but stays suspended: no user activation), 'reject', or 'hang'.
class FakeContext extends EventTarget {

	constructor( resumeMode = 'run' ) {

		super();
		this.state = 'suspended';
		this.resumeMode = resumeMode;
		this.resumeCalls = 0;

	}

	setState( state ) {

		this.state = state;
		this.dispatchEvent( new Event( 'statechange' ) );

	}

	resume() {

		this.resumeCalls ++;
		if ( this.resumeMode === 'hang' ) return new Promise( () => {} );
		if ( this.resumeMode === 'reject' ) return Promise.reject( new Error( 'NotAllowedError' ) );
		if ( this.resumeMode === 'run' ) this.setState( 'running' );
		return Promise.resolve();

	}

	suspend() {

		this.setState( 'suspended' );
		return Promise.resolve();

	}

}

const flush = () => new Promise( ( resolve ) => setImmediate( resolve ) );

function setup( resumeMode ) {

	const context = new FakeContext( resumeMode );
	const target = new EventTarget();
	const page = { hidden: false, unlockCalls: 0 };
	const unlock = new AudioUnlock( context, {
		target,
		onUnlock: () => page.unlockCalls ++,
		isHidden: () => page.hidden,
	} );
	unlock.arm();
	return { context, target, page, unlock };

}

async function gesture( target, type = 'pointerup' ) {

	target.dispatchEvent( new Event( type ) );
	await flush();

}

test( 'UNLOCK_EVENTS_list_areTheActivationEventsWithoutTouchstart', () => {

	assert.deepEqual( UNLOCK_EVENTS, [ 'pointerdown', 'pointerup', 'touchend', 'keydown', 'click' ] );

} );

for ( const type of UNLOCK_EVENTS ) {

	test( `gesture_${ type }_unlocksAndCallsOnUnlock`, async () => {

		const { context, target, page, unlock } = setup( 'run' );
		await gesture( target, type );
		assert.equal( context.state, 'running' );
		assert.equal( unlock.unlocked, true );
		assert.equal( page.unlockCalls, 1 );

	} );

}

test( 'gesture_touchstart_isIgnored', async () => {

	const { context, target, unlock } = setup( 'run' );
	await gesture( target, 'touchstart' );
	assert.equal( context.resumeCalls, 0 );
	assert.equal( unlock.unlocked, false );

} );

test( 'gesture_contextStaysSuspended_staysArmedAndRetriesOnNextGesture', async () => {

	const { context, target, page, unlock } = setup( 'stay' );
	await gesture( target );
	assert.equal( unlock.unlocked, false );
	assert.equal( page.unlockCalls, 0 );

	context.resumeMode = 'run';
	await gesture( target, 'keydown' );
	assert.equal( context.resumeCalls, 2 );
	assert.equal( unlock.unlocked, true );
	assert.equal( page.unlockCalls, 1 );

} );

test( 'gesture_resumeRejects_staysLockedAndArmed', async () => {

	const { context, target, unlock } = setup( 'reject' );
	await gesture( target );
	assert.equal( unlock.unlocked, false );

	context.resumeMode = 'run';
	await gesture( target );
	assert.equal( unlock.unlocked, true );

} );

test( 'gesture_resumeHangsThenContextRuns_unlocksOnStateChange', async () => {

	const { context, target, page, unlock } = setup( 'hang' );
	await gesture( target );
	assert.equal( unlock.unlocked, false );

	context.setState( 'running' );
	assert.equal( unlock.unlocked, true );
	assert.equal( page.unlockCalls, 1 );

} );

test( 'gesture_afterUnlock_listenersRemovedAndOnUnlockCalledOnce', async () => {

	const { context, target, page } = setup( 'run' );
	await gesture( target );
	await gesture( target );
	await gesture( target, 'click' );
	assert.equal( context.resumeCalls, 1 );
	assert.equal( page.unlockCalls, 1 );

} );

test( 'stateChange_interruptedWhileVisible_rearmsAndNextGestureResumes', async () => {

	const { context, target, page, unlock } = setup( 'run' );
	await gesture( target );

	context.setState( 'interrupted' );
	await gesture( target, 'touchend' );
	assert.equal( context.resumeCalls, 2 );
	assert.equal( context.state, 'running' );
	assert.equal( unlock.unlocked, true );
	assert.equal( page.unlockCalls, 1 );

} );

test( 'stateChange_suspendedWhileHidden_doesNotArm', async () => {

	const { context, target, page } = setup( 'run' );
	await gesture( target );

	page.hidden = true;
	context.setState( 'suspended' );
	await gesture( target );
	assert.equal( context.resumeCalls, 1 );

} );

test( 'stateChange_beforeFirstUnlock_doesNotCallOnUnlock', async () => {

	const { context, page, unlock } = setup( 'stay' );
	context.setState( 'interrupted' );
	await flush();
	assert.equal( unlock.unlocked, false );
	assert.equal( page.unlockCalls, 0 );

} );

test( 'suspendForHidden_running_suspendsTheContext', async () => {

	const { context, target, page, unlock } = setup( 'run' );
	await gesture( target );

	page.hidden = true;
	unlock.suspendForHidden();
	assert.equal( context.state, 'suspended' );

} );

test( 'resumeForVisible_afterHidden_resumesWithoutAGesture', async () => {

	const { context, target, page, unlock } = setup( 'run' );
	await gesture( target );
	page.hidden = true;
	unlock.suspendForHidden();

	page.hidden = false;
	await unlock.resumeForVisible();
	assert.equal( context.state, 'running' );
	assert.equal( page.unlockCalls, 1 );

} );

test( 'resumeForVisible_resumeRefused_armsForTheNextGesture', async () => {

	const { context, target, page, unlock } = setup( 'run' );
	await gesture( target );
	page.hidden = true;
	unlock.suspendForHidden();

	page.hidden = false;
	context.resumeMode = 'stay';
	await unlock.resumeForVisible();
	assert.equal( context.state, 'suspended' );

	context.resumeMode = 'run';
	await gesture( target );
	assert.equal( context.state, 'running' );

} );

test( 'resumeForVisible_neverUnlocked_doesNothing', async () => {

	const { context, unlock } = setup( 'run' );
	await unlock.resumeForVisible();
	assert.equal( context.resumeCalls, 0 );
	assert.equal( context.state, 'suspended' );

} );
