// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSignal, decodeSignal, SignalError, isOfferExpired, OFFER_TTL_MS, buildInviteLink, parseInviteHash } from '../js/net/Signal.js';

const SDP = 'v=0\r\no=- 4611731400430051336 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\n'.repeat( 8 );

test( 'encodeSignal_offer_roundTripsThroughDecode', async () => {

	const code = await encodeSignal( { type: 'offer', sdp: SDP } );
	assert.match( code, /^KR1\.[A-Za-z0-9_-]+$/ );
	assert.deepEqual( await decodeSignal( code ), { type: 'offer', sdp: SDP } );

} );

test( 'encodeSignal_longSdp_isCompressed', async () => {

	const code = await encodeSignal( { type: 'answer', sdp: SDP } );
	assert.ok( code.length < SDP.length / 2, `${ code.length } chars for ${ SDP.length } of SDP` );

} );

test( 'decodeSignal_codeWithLineBreaksAndSpaces_isAccepted', async () => {

	const code = await encodeSignal( { type: 'answer', sdp: SDP } );
	const pasted = '  ' + code.slice( 0, 20 ) + '\n' + code.slice( 20, 40 ) + ' \r\n' + code.slice( 40 ) + '\n';
	assert.equal( ( await decodeSignal( pasted ) ).type, 'answer' );

} );

test( 'decodeSignal_garbage_throwsSignalError', async () => {

	const validBody = ( await encodeSignal( { type: 'offer', sdp: SDP } ) ).slice( 4 );
	for ( const bad of [ '', null, 'hello', 'TS1.' + validBody, 'KR1.', 'KR1.!!!!', 'KR1.' + validBody.slice( 0, 30 ), 'KR1.' + 'A'.repeat( 30000 ) ] ) {

		await assert.rejects( decodeSignal( bad ), SignalError, String( bad ).slice( 0, 20 ) );

	}

} );

test( 'decodeSignal_validDeflateButWrongShape_throwsSignalError', async () => {

	const wrong = await encodeSignal( { type: 'rollback', sdp: SDP } );
	await assert.rejects( decodeSignal( wrong ), SignalError );

} );

test( 'isOfferExpired_afterTenMinutes_isTrue', () => {

	assert.equal( isOfferExpired( 0, OFFER_TTL_MS ), false );
	assert.equal( isOfferExpired( 0, OFFER_TTL_MS + 1 ), true );

} );

test( 'buildInviteLink_pageWithMapAndOsm_keepsQueryAndSetsHash', () => {

	const link = buildInviteLink( 'https://github.freaxnx01.ch/game-kit-racer/index.html?map=abc&osm=1,2,3,4,10,0,0#old', 'KR1.xyz' );
	assert.equal( link, 'https://github.freaxnx01.ch/game-kit-racer/index.html?map=abc&osm=1,2,3,4,10,0,0#join=KR1.xyz' );
	assert.equal( parseInviteHash( new URL( link ).hash ), 'KR1.xyz' );

} );

test( 'parseInviteHash_otherHashes_returnNull', () => {

	for ( const hash of [ '', '#', '#join=', '#join=TS1.abc', '#foo=KR1.abc', '#join=KR1.abc<script>', null ] ) {

		assert.equal( parseInviteHash( hash ), null, String( hash ) );

	}

} );
