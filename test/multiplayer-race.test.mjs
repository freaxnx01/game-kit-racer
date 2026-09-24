// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MultiplayerRace } from '../js/race/MultiplayerRace.js';
import { SignalError } from '../js/net/Signal.js';

const CELL = 9.99 * 0.75;

// Stand-in for Session: records what was sent, lets the test play the other side.
class FakeSession {

	constructor( handlers ) {

		Object.assign( this, handlers );
		this.sent = [];
		this.open = new Set();
		FakeSession.last = this;

	}

	async createOffer( id ) { return 'KR1.offer-' + id; }
	async acceptAnswer( id, code ) { if ( ! code.startsWith( 'KR1.answer' ) ) throw new SignalError( 'invalid code' ); }
	async answerOffer( code ) { if ( ! code.startsWith( 'KR1.offer' ) ) throw new SignalError( 'invalid code' ); return 'KR1.answer'; }
	send( id, msg ) { this.sent.push( { to: id, msg } ); }
	broadcast( msg, except = null ) { for ( const id of this.open ) if ( id !== except ) this.send( id, msg ); }
	openPeers() { return [ ...this.open ]; }
	close( id, notify = true ) { if ( this.open.delete( id ) && notify ) this.onClose( id, 'closed' ); }
	closeAll() { this.open.clear(); }
	// test helpers
	connect( id ) { this.open.add( id ); this.onOpen( id ); }
	deliver( from, msg ) { this.onMessage( from, msg ); }

}

function setup() {

	let time = 1000;
	const views = [];
	const cells = Array.from( { length: 16 }, ( _, i ) => [ i, 0, i === 0 ? 'track-finish' : 'track-straight', 16 ] );
	const game = {
		trackCells: cells, cellSize: CELL, pageUrl: 'https://example.test/game/index.html', mapParam: 'fYYN', osmParam: null,
		lapTimer: { onLap: null, resetForRace() {}, startRace() { this.started = true; }, resetForSolo() { this.solo = ( this.solo ?? 0 ) + 1; }, progress: () => 0.5 },
		opponents: { trucks: new Map(), add( id, name ) { this.trucks.set( id, name ); }, remove( id ) { this.trucks.delete( id ); }, clear() { this.trucks.clear(); }, push() {}, update() {} },
		placeOnSlot( slot ) { this.slot = slot; }, setHold( hold ) { this.hold = hold; },
		localState: () => ( { p: [ 1, 0.5, 1 ], q: [ 0, 0, 0, 1 ], v: [ 0, 0, 0 ] } ),
	};
	const mp = new MultiplayerRace( game, { onChange: ( v ) => views.push( v ), now: () => time, SessionImpl: FakeSession } );
	return { mp, game, views, tick: ( ms ) => { time += ms; mp.update( ms / 1000 ); }, session: () => FakeSession.last };

}

async function hostWithGuest() {

	const t = setup();
	t.mp.host( 'Ana', 1 );
	await t.mp.invite();
	await t.mp.accept( 'g1', 'KR1.answer' );
	t.session().connect( 'g1' );
	t.session().deliver( 'g1', { type: 'hello', name: 'Bo' } );
	return t;

}

test( 'invite_linkCarriesMapAndOsm_andOffer', async () => {

	const t = setup();
	t.game.osmParam = '47.548,7.98,47.556,7.995,10,-1,-3';
	t.mp.host( 'Ana', 3 );
	const invite = await t.mp.invite();
	assert.equal( invite.link, 'https://example.test/game/index.html?map=fYYN&osm=47.548,7.98,47.556,7.995,10,-1,-3#join=KR1.offer-g1' );

} );

test( 'accept_wrongCode_showsCodeInvalid', async () => {

	const t = setup();
	t.mp.host( 'Ana', 3 );
	await t.mp.invite();
	assert.equal( await t.mp.accept( 'g1', 'KR1.offer-g1' ), false );
	assert.equal( t.mp.view().message.key, 'mp.codeInvalid' );

} );

test( 'join_garbageOffer_showsCodeInvalidAndStaysSolo', async () => {

	const t = setup();
	assert.equal( await t.mp.join( 'hello?', 'Bo' ), null );
	assert.equal( t.mp.view().role, null );
	assert.equal( t.mp.view().message.key, 'mp.codeInvalid' );

} );

test( 'hello_fromGuest_addsTruckAndSendsRosterWithTheirId', async () => {

	const t = await hostWithGuest();
	assert.equal( t.game.opponents.trucks.get( 'g1' ), 'Bo' );
	const roster = t.session().sent.findLast( ( s ) => s.msg.type === 'roster' );
	assert.equal( roster.msg.you, 'g1' );
	assert.deepEqual( roster.msg.players.map( ( p ) => p.name ), [ 'Ana', 'Bo' ] );

} );

test( 'start_countsDownHoldsInputThenReleasesAtGo', async () => {

	const t = await hostWithGuest();
	t.mp.start();
	const setupMsg = t.session().sent.find( ( s ) => s.msg.type === 'setup' ).msg;
	assert.deepEqual( [ setupMsg.laps, setupMsg.startIn, setupMsg.map ], [ 1, 3000, 'fYYN' ] );
	assert.equal( t.game.hold, true );
	assert.equal( t.game.slot, 0 );
	t.tick( 2999 );
	assert.equal( t.mp.view().phase, 'countdown' );
	t.tick( 1 );
	assert.equal( t.mp.view().phase, 'racing' );
	assert.equal( t.game.hold, false );
	assert.equal( t.game.lapTimer.started, true );

} );

test( 'raceToResults_thenRematch_returnsToLobbyWithoutError', async () => {

	const t = await hostWithGuest();
	t.mp.start();
	t.tick( 3000 );
	t.session().deliver( 'g1', { type: 'lap', lap: 1, time: 20 } );
	t.game.lapTimer.onLap( 1, 25 );
	t.tick( 16 );
	assert.equal( t.mp.view().phase, 'results' );
	assert.deepEqual( t.mp.view().results.map( ( r ) => r.name ), [ 'Bo', 'Ana' ] );
	assert.ok( t.session().sent.some( ( s ) => s.msg.type === 'results' ) );

	t.mp.rematch();
	assert.equal( t.mp.view().phase, 'lobby' );
	assert.equal( t.mp.view().results, null );
	assert.ok( t.session().sent.some( ( s ) => s.msg.type === 'rematch' ) );

} );

test( 'guestLeavesMidRace_hostRemovesTruckAndSaysSo', async () => {

	const t = await hostWithGuest();
	t.mp.start();
	t.tick( 3000 );
	t.session().close( 'g1' );
	assert.equal( t.game.opponents.trucks.has( 'g1' ), false );
	assert.deepEqual( t.mp.view().message, { key: 'mp.playerLeft', vars: { name: 'Bo' } } );

} );

test( 'hostLeaves_guestReturnsToSoloWithMessage', async () => {

	const t = setup();
	await t.mp.join( 'KR1.offer-g1', 'Bo' );
	t.session().connect( 'h' );
	t.session().deliver( 'h', { type: 'roster', you: 'g1', players: [ { id: 'h', name: 'Ana', slot: 0, connected: true }, { id: 'g1', name: 'Bo', slot: 1, connected: true } ] } );
	assert.equal( t.game.opponents.trucks.get( 'h' ), 'Ana' );
	t.session().close( 'h' );
	assert.equal( t.mp.view().role, null );
	assert.equal( t.mp.view().message.key, 'mp.hostLeft' );
	assert.equal( t.game.opponents.trucks.size, 0 );

} );

test( 'guestSetup_startsCountdownOnItsSlotMinusHalfRtt', async () => {

	const t = setup();
	await t.mp.join( 'KR1.offer-g1', 'Bo' );
	t.session().connect( 'h' );
	t.session().deliver( 'h', { type: 'roster', you: 'g1', players: [ { id: 'h', name: 'Ana', slot: 0, connected: true }, { id: 'g1', name: 'Bo', slot: 1, connected: true } ] } );
	t.tick( 2000 ); // sends a ping
	const ping = t.session().sent.findLast( ( s ) => s.msg.type === 'ping' ).msg;
	t.tick( 200 );
	t.session().deliver( 'h', { type: 'pong', t: ping.t } );
	t.session().deliver( 'h', { type: 'setup', map: 'fYYN', osm: null, laps: 2, startIn: 3000 } );
	assert.equal( t.game.slot, 1 );
	t.tick( 2899 );
	assert.equal( t.mp.view().phase, 'countdown' );
	t.tick( 1 );
	assert.equal( t.mp.view().phase, 'racing' );

} );

test( 'noConnectionAfterTwentySeconds_showsStrictNetworkHint', async () => {

	const t = setup();
	t.mp.host( 'Ana', 3 );
	await t.mp.invite();
	await t.mp.accept( 'g1', 'KR1.answer' );
	t.tick( 20001 );
	assert.equal( t.mp.view().message.key, 'mp.strictNetwork' );

} );
