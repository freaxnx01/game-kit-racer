// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../js/net/Session.js';

const BOUNDS = { minX: - 50, maxX: 50, minZ: - 50, maxZ: 50 };
const STATE = { type: 'state', id: 'g1', p: [ 1, 0.5, - 3 ], q: [ 0, 0, 0, 1 ], v: [ 3, 0, - 1 ], lap: 1, progress: 0.4 };

// A Session with one open peer 'g1' on a fake data channel; no RTCPeerConnection involved.
function wiredPeer() {

	const delivered = [], closed = [];
	const session = new Session( { bounds: BOUNDS, onMessage: ( id, msg ) => delivered.push( msg ), onOpen() {}, onClose: ( id, reason ) => closed.push( reason ) } );
	const peer = { pc: { close() {} }, channel: null, drops: 0, createdAt: 0, closed: false, opened: true, graceTimer: null };
	session.peers.set( 'g1', peer );
	const channel = Object.assign( new EventTarget(), { readyState: 'open', close() {} } );
	session.wire( 'g1', peer, channel );
	const receive = ( text ) => channel.dispatchEvent( Object.assign( new Event( 'message' ), { data: text } ) );
	return { delivered, closed, receive };

}

test( 'wire_outOfBoundsStates_areIgnoredWithoutKickingThePeer', () => {

	const w = wiredPeer();
	for ( let i = 0; i < 60; i ++ ) w.receive( JSON.stringify( { ...STATE, p: [ 999, 0.5, 0 ] } ) );
	for ( let i = 0; i < 60; i ++ ) w.receive( JSON.stringify( { ...STATE, p: [ 0, - 80, 0 ] } ) );
	assert.deepEqual( w.closed, [] );
	assert.equal( w.delivered.length, 0 );
	w.receive( JSON.stringify( STATE ) );
	assert.deepEqual( w.delivered, [ STATE ] );

} );

test( 'wire_malformedMessages_kickThePeerAfterTwentyDrops', () => {

	const w = wiredPeer();
	for ( let i = 0; i < 20; i ++ ) w.receive( '{not json' );
	assert.deepEqual( w.closed, [] );
	w.receive( JSON.stringify( { ...STATE, v: [ NaN, 0, 0 ] } ) );
	assert.deepEqual( w.closed, [ 'invalid' ] );

} );
