// MultiplayerRace.js — runs a multiplayer race for the host or a guest: session, race rules, network
// messages and the local game. It talks to the game only through the `game` adapter (see main.js),
// and to the UI only through onChange( view ), so it can run headless with fakes.
//
// game = {
//   trackCells, cellSize, pageUrl, mapParam, osmParam,   // osmParam: raw &osm= string or null
//   lapTimer: { onLap, resetForRace(), startRace(), resetForSolo(), progress() },
//   opponents: { trucks: Map, add( id, name, index ), remove( id ), clear(), push( id, state, now ), update( dt, now ) },
//   placeOnSlot( slot ), setHold( hold ), localState() → { p, q, v },
// }

import { Session } from '../net/Session.js';
import { buildInviteLink, OFFER_TTL_MS } from '../net/Signal.js';
import { RaceState, PHASE, guestStartDelay } from './RaceState.js';

const STATE_INTERVAL_MS = 50;
const PING_INTERVAL_MS = 2000;
const CONNECT_HINT_MS = 20000;
const GO_SHOWN_MS = 1000;
const GUEST_IDS = [ 'g1', 'g2', 'g3' ];
const BOUNDS_MARGIN_CELLS = 3;

function worldBounds( cells, cellSize ) {

	const xs = cells.map( ( c ) => c[ 0 ] ), zs = cells.map( ( c ) => c[ 1 ] );
	const m = BOUNDS_MARGIN_CELLS;
	return {
		minX: ( Math.min( ...xs ) - m ) * cellSize, maxX: ( Math.max( ...xs ) + 1 + m ) * cellSize,
		minZ: ( Math.min( ...zs ) - m ) * cellSize, maxZ: ( Math.max( ...zs ) + 1 + m ) * cellSize,
	};

}

export class MultiplayerRace {

	constructor( game, { onChange, now = () => performance.now(), SessionImpl = Session } ) {

		this.game = game;
		this.onChange = onChange;
		this.now = now;
		this.SessionImpl = SessionImpl;
		this.teardown( null );
		game.lapTimer.onLap = ( lap, time ) => this.localLap( lap, time );

	}

	// ── Host ────────────────────────────────────────────────

	host( name, laps ) {

		this.teardown( 'host' );
		this.you = 'h';
		this.race = new RaceState( { cellCount: this.game.trackCells.length, cellSize: this.game.cellSize, laps } );
		this.race.addPlayer( 'h', name );
		this.laps = laps;
		this.session = this.newSession();
		this.changed();

	}

	setLaps( laps ) {

		if ( this.role !== 'host' ) return;
		this.race.setLaps( laps );
		this.laps = this.race.laps;
		this.changed();

	}

	// A fresh invite for the next free guest slot: { peerId, code, link, expiresAt }, or null when full.
	async invite() {

		const taken = new Set( [ ...this.race.players.map( ( p ) => p.id ), ...this.invites.map( ( i ) => i.peerId ) ] );
		const peerId = GUEST_IDS.find( ( id ) => ! taken.has( id ) );
		if ( ! peerId || this.race.phase !== PHASE.LOBBY ) return null;

		const code = await this.session.createOffer( peerId );
		const invite = { peerId, code, link: this.inviteLink( code ), expiresAt: this.now() + OFFER_TTL_MS, answered: null };
		this.invites.push( invite );
		this.changed();
		return invite;

	}

	async regenerate( peerId ) {

		this.invites = this.invites.filter( ( i ) => i.peerId !== peerId );
		this.session.close( peerId, false );
		return this.invite();

	}

	// Paste of a guest's answer. Resolves true, or false with view.message set.
	async accept( peerId, answerCode ) {

		try {

			await this.session.acceptAnswer( peerId, answerCode );
			const invite = this.invites.find( ( i ) => i.peerId === peerId );
			if ( invite ) invite.answered = this.now();
			this.say( 'mp.connecting' );
			return true;

		} catch {

			this.say( 'mp.codeInvalid' );
			return false;

		}

	}

	start() {

		if ( this.role !== 'host' ) return;
		const now = this.now();
		const startAt = this.race.start( now );
		if ( startAt === null ) return this.say( 'mp.needTwo' );

		for ( const id of this.session.openPeers() ) {

			this.session.send( id, { type: 'setup', map: this.game.mapParam, osm: this.game.osmParam, laps: this.race.laps, startIn: Math.round( startAt - now ) } );

		}

		this.beginCountdown( this.race.find( 'h' ).slot, startAt );

	}

	rematch() {

		if ( this.role !== 'host' || this.race.phase !== PHASE.RESULTS ) return;
		this.race.rematch();
		this.results = null;
		this.toLobby();
		this.session.broadcast( { type: 'rematch' } );
		this.broadcastRoster();

	}

	// ── Guest ───────────────────────────────────────────────

	// Offer code (from the invite link or pasted) → answer code for the host. null + message on failure.
	async join( offerCode, name ) {

		this.teardown( 'guest' );
		this.name = name;
		this.session = this.newSession();

		try {

			this.answerCode = await this.session.answerOffer( offerCode );
			this.answeredAt = this.now();
			this.changed();
			return this.answerCode;

		} catch {

			this.teardown( null );
			this.say( 'mp.codeInvalid' );
			return null;

		}

	}

	// ── Both ────────────────────────────────────────────────

	leave() {

		if ( this.session ) this.session.broadcast( { type: 'leave', id: this.you ?? 'h' } );
		this.teardown( null );
		this.changed();

	}

	// Once per frame, before the physics step.
	update( dt ) {

		if ( ! this.role ) return;
		const now = this.now();

		this.game.opponents.update( dt, now );
		this.tickCountdown( now );
		this.tickState( now );
		this.tickHints( now );

		if ( this.role === 'host' ) this.tickHost( now );
		if ( this.role === 'guest' && now - this.lastPing >= PING_INTERVAL_MS ) {

			this.lastPing = now;
			this.session.send( 'h', { type: 'ping', t: now } );

		}

		if ( now - this.lastRender >= 250 ) this.changed();

	}

	// Plain data for the UI.
	view() {

		const now = this.now();
		return {
			role: this.role,
			you: this.you,
			phase: this.phase,
			laps: this.laps,
			players: this.players(),
			invites: this.invites.map( ( i ) => ( { ...i, secondsLeft: Math.max( 0, Math.ceil( ( i.expiresAt - now ) / 1000 ) ) } ) ),
			answerCode: this.answerCode,
			countdown: this.countdownLabel( now ),
			positions: this.positions(),
			finished: this.finished,
			results: this.results,
			message: this.message,
		};

	}

	// ── Internals ───────────────────────────────────────────

	teardown( role ) {

		this.session?.closeAll();
		this.game.opponents.clear();
		this.game.setHold( false );
		this.game.lapTimer.resetForSolo();
		this.role = role;
		this.session = null;
		this.race = null;
		this.you = null;
		this.name = null;
		this.laps = 3;
		this.phase = PHASE.LOBBY;
		this.roster = [];
		this.invites = [];
		this.answerCode = null;
		this.answeredAt = null;
		this.goAt = null;
		this.remote = new Map();   // id → { lap, progress } from state messages
		this.lapsDone = 0;
		this.finished = false;
		this.results = null;
		this.message = null;
		this.rtt = 0;
		this.lastPing = - Infinity;
		this.lastState = - Infinity;
		this.lastRender = - Infinity;

	}

	newSession() {

		return new this.SessionImpl( {
			bounds: worldBounds( this.game.trackCells, this.game.cellSize ),
			onMessage: ( from, msg ) => this.receive( from, msg ),
			onOpen: ( id ) => this.opened( id ),
			onClose: ( id ) => this.closed( id ),
		} );

	}

	inviteLink( code ) {

		const url = new URL( this.game.pageUrl );
		url.search = '';
		url.searchParams.set( 'map', this.game.mapParam );
		if ( this.game.osmParam ) url.searchParams.set( 'osm', this.game.osmParam );
		return buildInviteLink( url.href.replace( /%2C/g, ',' ), code );

	}

	opened( id ) {

		if ( this.role === 'guest' ) this.session.send( 'h', { type: 'hello', name: this.name } );
		if ( this.role === 'host' ) this.invites = this.invites.filter( ( i ) => i.peerId !== id );
		this.message = null;
		this.changed();

	}

	closed( id ) {

		if ( this.role === 'guest' && id === 'h' ) {

			this.teardown( null );
			return this.say( 'mp.hostLeft' );

		}

		if ( this.role !== 'host' ) return;
		const player = this.race.find( id );
		this.race.removePlayer( id );
		this.game.opponents.remove( id );
		this.session.broadcast( { type: 'leave', id } );
		this.broadcastRoster();
		if ( player ) this.say( 'mp.playerLeft', { name: player.name } );

	}

	receive( from, msg ) {

		if ( this.role === 'host' ) return this.receiveAsHost( from, msg );
		if ( from === 'h' ) this.receiveAsGuest( msg );

	}

	receiveAsHost( from, msg ) {

		const now = this.now();

		switch ( msg.type ) {

			case 'hello': {

				const slot = this.race.addPlayer( from, msg.name );
				if ( slot === null ) return this.session.close( from, false );
				this.game.opponents.add( from, msg.name, slot );
				return this.broadcastRoster();

			}

			case 'state':
				if ( msg.id !== from ) return;
				this.remote.set( from, { lap: msg.lap, progress: msg.progress } );
				this.game.opponents.push( from, msg, now );
				return this.session.broadcast( msg, from );

			case 'lap':
				if ( this.race.recordLap( from, msg.lap, msg.time ) && msg.lap === this.race.laps ) this.race.recordFinish( from, now );
				return;

			case 'ping':
				return this.session.send( from, { type: 'pong', t: msg.t } );

			case 'leave':
				return this.session.close( from, true );

		}

	}

	receiveAsGuest( msg ) {

		const now = this.now();

		switch ( msg.type ) {

			case 'roster':
				this.you = msg.you;
				this.roster = msg.players;
				this.syncOpponents();
				return this.changed();

			case 'setup': {

				const me = this.roster.find( ( p ) => p.id === this.you );
				if ( ! me || msg.map !== this.game.mapParam ) return;
				this.laps = msg.laps;
				return this.beginCountdown( me.slot, now + guestStartDelay( msg.startIn, this.rtt ) );

			}

			case 'state':
				if ( msg.id === this.you ) return;
				this.remote.set( msg.id, { lap: msg.lap, progress: msg.progress } );
				return this.game.opponents.push( msg.id, msg, now );

			case 'pong':
				this.rtt = now - msg.t;
				return;

			case 'results':
				this.phase = PHASE.RESULTS;
				this.results = msg.rows;
				return this.changed();

			case 'rematch':
				this.results = null;
				return this.toLobby();

			case 'leave':
				this.game.opponents.remove( msg.id );
				this.remote.delete( msg.id );
				return;

		}

	}

	syncOpponents() {

		const others = this.roster.filter( ( p ) => p.id !== this.you );
		const trucks = this.game.opponents.trucks;
		for ( const id of [ ...trucks.keys() ] ) if ( ! others.some( ( p ) => p.id === id ) ) this.game.opponents.remove( id );
		for ( const p of others ) if ( ! trucks.has( p.id ) ) this.game.opponents.add( p.id, p.name, p.slot );

	}

	broadcastRoster() {

		const players = this.race.roster();
		for ( const id of this.session.openPeers() ) this.session.send( id, { type: 'roster', you: id, players } );
		this.changed();

	}

	beginCountdown( slot, goAt ) {

		this.phase = PHASE.COUNTDOWN;
		this.goAt = goAt;
		this.lapsDone = 0;
		this.finished = false;
		this.remote.clear();
		this.game.lapTimer.resetForRace();
		this.game.placeOnSlot( slot );
		this.game.setHold( true );
		this.changed();

	}

	toLobby() {

		this.phase = PHASE.LOBBY;
		this.goAt = null;
		this.game.setHold( false );
		this.game.lapTimer.resetForRace();
		this.changed();

	}

	tickCountdown( now ) {

		if ( this.phase !== PHASE.COUNTDOWN || now < this.goAt ) return;
		this.phase = PHASE.RACING;
		this.game.setHold( false );
		this.game.lapTimer.startRace();
		this.changed();

	}

	tickState( now ) {

		if ( this.phase !== PHASE.COUNTDOWN && this.phase !== PHASE.RACING ) return;
		if ( now - this.lastState < STATE_INTERVAL_MS ) return;
		this.lastState = now;

		const { p, q, v } = this.game.localState();
		const msg = { type: 'state', id: this.you, p, q, v, lap: this.lapsDone, progress: Math.min( 1, Math.max( 0, this.game.lapTimer.progress() ) ) };
		if ( this.role === 'host' ) this.session.broadcast( msg );
		else this.session.send( 'h', msg );

	}

	tickHost( now ) {

		const before = this.race.phase;
		const phase = this.race.tick( now );
		if ( phase !== PHASE.RESULTS || before === PHASE.RESULTS ) return;

		this.phase = PHASE.RESULTS;
		this.results = this.race.results( this.progressMap() );
		this.session.broadcast( { type: 'results', rows: this.results } );
		this.changed();

	}

	tickHints( now ) {

		const waiting = this.role === 'guest'
			? this.answeredAt !== null && ! this.you && now - this.answeredAt > CONNECT_HINT_MS
			: this.invites.some( ( i ) => i.answered !== null && now - i.answered > CONNECT_HINT_MS );
		if ( waiting && this.message?.key !== 'mp.strictNetwork' ) this.say( 'mp.strictNetwork' );

	}

	localLap( lap, time ) {

		if ( this.phase !== PHASE.RACING || this.finished ) return;
		this.lapsDone = lap;
		const last = lap === this.laps;
		if ( last ) this.finished = true;

		if ( this.role === 'host' ) {

			if ( this.race.recordLap( 'h', lap, time ) && last ) this.race.recordFinish( 'h', this.now() );

		} else {

			this.session.send( 'h', { type: 'lap', lap, time: Math.max( time, 0.001 ) } );

		}

		this.changed();

	}

	progressMap() {

		const map = new Map( [ ...this.remote ].map( ( [ id, r ] ) => [ id, r.progress ] ) );
		map.set( this.you, this.game.lapTimer.progress() );
		return map;

	}

	players() {

		if ( this.role === 'host' ) return this.race.roster();
		return this.roster;

	}

	// Live order for everyone: laps done, then progress through the current lap.
	positions() {

		if ( this.phase !== PHASE.RACING && this.phase !== PHASE.RESULTS ) return [];
		const score = ( id ) => id === this.you ? this.lapsDone + this.game.lapTimer.progress() : ( this.remote.get( id )?.lap ?? 0 ) + ( this.remote.get( id )?.progress ?? 0 );
		return this.players().slice().sort( ( a, b ) => score( b.id ) - score( a.id ) ).map( ( p ) => ( { id: p.id, name: p.name, you: p.id === this.you } ) );

	}

	countdownLabel( now ) {

		if ( this.goAt === null ) return null;
		if ( this.phase === PHASE.COUNTDOWN ) return String( Math.ceil( ( this.goAt - now ) / 1000 ) );
		if ( this.phase === PHASE.RACING && now - this.goAt < GO_SHOWN_MS ) return 'GO';
		return null;

	}

	say( key, vars = {} ) {

		this.message = key ? { key, vars } : null;
		this.changed();

	}

	changed() {

		this.lastRender = this.now();
		this.onChange?.( this.view() );

	}

}
