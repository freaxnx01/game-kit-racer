// RaceState.js — the host's authoritative race: roster, grid slots, countdown, laps, finishing order.
// Pure (no DOM, no three.js); time is always passed in as `now` in milliseconds.

import { MAX_PLAYERS } from '../net/Protocol.js';

export const PHASE = { LOBBY: 'lobby', COUNTDOWN: 'countdown', RACING: 'racing', RESULTS: 'results' };
export const COUNTDOWN_MS = 3000;
export const RESULTS_GRACE_MS = 30000;
export const MAX_AVG_SPEED = 40; // world units/s — about three times the fastest lap anyone drives

const ORIENT_DEG = { 0: 0, 10: 180, 16: 90, 22: 270 }; // same table as Track.js

// Fastest believable lap for a track of cellCount cells.
export function minLapSeconds( cellCount, cellSize ) {

	return cellCount * cellSize / MAX_AVG_SPEED;

}

// A guest hears "GO in startIn ms" about half a round trip late.
export function guestStartDelay( startIn, rttMs ) {

	return Math.max( 0, startIn - rttMs / 2 );

}

// Four grid positions around the finish cell [gx, gz, 'track-finish', orient], facing the driving
// direction: slots 0/1 on the finish tile, 2/3 one tile behind (or at the back of the finish tile when
// the tile behind is not track). isTrackCell( gx, gz ) says whether a cell holds a track piece.
export function gridSlots( finishCell, cellSize, isTrackCell ) {

	const [ gx, gz, , orient ] = finishCell;
	const angle = ( ORIENT_DEG[ orient ] ?? 0 ) * Math.PI / 180;
	const fx = Math.sin( angle ), fz = Math.cos( angle );
	const rx = fz, rz = - fx;
	const cx = ( gx + 0.5 ) * cellSize, cz = ( gz + 0.5 ) * cellSize;
	const side = cellSize * 0.22;
	const back = isTrackCell( gx - Math.round( fx ), gz - Math.round( fz ) ) ? cellSize : cellSize * 0.35;

	return [ [ - 1, 0 ], [ 1, 0 ], [ - 1, back ], [ 1, back ] ].map( ( [ s, b ] ) => ( {
		position: [ cx + rx * side * s - fx * b, 0.5, cz + rz * side * s - fz * b ],
		angle,
	} ) );

}

export class RaceState {

	constructor( { cellCount, cellSize, laps = 3 } ) {

		this.minLap = minLapSeconds( cellCount, cellSize );
		this.laps = laps;
		this.phase = PHASE.LOBBY;
		this.players = [];        // { id, name, slot, connected, left, laps, lapTimes, total, best }
		this.startAt = null;
		this.firstFinishAt = null;

	}

	// Adds a player in the lobby and returns their slot, or null when full, started, or the id is taken.
	addPlayer( id, name ) {

		if ( this.phase !== PHASE.LOBBY || this.players.length >= MAX_PLAYERS ) return null;
		if ( this.players.some( ( p ) => p.id === id ) ) return null;
		this.players.push( { id, name, slot: this.players.length, connected: true, left: false, ...freshRace() } );
		return this.players.length - 1;

	}

	// In the lobby the player is removed and slots close up; during a race they stay listed as left.
	removePlayer( id ) {

		if ( this.phase === PHASE.LOBBY ) {

			this.players = this.players.filter( ( p ) => p.id !== id );
			this.players.forEach( ( p, i ) => { p.slot = i; } );
			return;

		}

		const p = this.find( id );
		if ( p ) { p.left = true; p.connected = false; }

	}

	setConnected( id, connected ) {

		const p = this.find( id );
		if ( p ) p.connected = connected;

	}

	setLaps( laps ) {

		if ( this.phase === PHASE.LOBBY ) this.laps = laps;

	}

	roster() {

		return this.players.filter( ( p ) => ! p.left ).map( ( { id, name, slot, connected } ) => ( { id, name, slot, connected } ) );

	}

	// Lobby → countdown. Needs at least two connected players. Returns startAt, or null.
	start( now ) {

		if ( this.phase !== PHASE.LOBBY ) return null;
		if ( this.players.filter( ( p ) => p.connected ).length < 2 ) return null;
		this.phase = PHASE.COUNTDOWN;
		this.startAt = now + COUNTDOWN_MS;
		return this.startAt;

	}

	// Advances countdown → racing → results. Returns the current phase.
	tick( now ) {

		if ( this.phase === PHASE.COUNTDOWN && now >= this.startAt ) this.phase = PHASE.RACING;

		if ( this.phase === PHASE.RACING ) {

			const active = this.players.filter( ( p ) => ! p.left );
			const allDone = active.length > 0 && active.every( ( p ) => p.total !== null );
			const graceOver = this.firstFinishAt !== null && now - this.firstFinishAt >= RESULTS_GRACE_MS;
			if ( allDone || graceOver || active.length < 2 && this.firstFinishAt !== null ) this.phase = PHASE.RESULTS;

		}

		return this.phase;

	}

	// A lap report from a player. Rejected when not racing, out of order, or implausibly fast.
	recordLap( id, lap, time ) {

		const p = this.find( id );
		if ( ! p || p.left || this.phase !== PHASE.RACING ) return false;
		if ( lap !== p.laps + 1 || lap > this.laps || time < this.minLap ) return false;
		p.laps = lap;
		p.lapTimes.push( time );
		return true;

	}

	// Finish is accepted only after all laps were accepted; total and best come from the accepted laps.
	recordFinish( id, now ) {

		const p = this.find( id );
		if ( ! p || p.total !== null || p.laps !== this.laps ) return false;
		p.total = p.lapTimes.reduce( ( a, b ) => a + b, 0 );
		p.best = Math.min( ...p.lapTimes );
		if ( this.firstFinishAt === null ) this.firstFinishAt = now;
		return true;

	}

	// Live order: finished players by total time, then everyone else by laps and progress (0..1).
	standings( progressById ) {

		const key = ( p ) => p.laps + ( progressById.get( p.id ) ?? 0 );
		return this.players.filter( ( p ) => ! p.left ).slice().sort( ( a, b ) => {

			if ( a.total !== null || b.total !== null ) return ( a.total ?? Infinity ) - ( b.total ?? Infinity );
			return key( b ) - key( a );

		} ).map( ( p ) => p.id );

	}

	// Result rows in finishing order; players who did not finish get total/best null.
	results( progressById = new Map() ) {

		const order = this.standings( progressById );
		const left = this.players.filter( ( p ) => p.left ).map( ( p ) => p.id );
		return [ ...order, ...left ].map( ( id, i ) => {

			const p = this.find( id );
			return { id, name: p.name, place: i + 1, total: p.total, best: p.best };

		} );

	}

	// Same players (minus those who left), fresh race, back in the lobby.
	rematch() {

		this.players = this.players.filter( ( p ) => ! p.left );
		this.players.forEach( ( p, i ) => Object.assign( p, { slot: i }, freshRace() ) );
		this.phase = PHASE.LOBBY;
		this.startAt = null;
		this.firstFinishAt = null;

	}

	find( id ) {

		return this.players.find( ( p ) => p.id === id );

	}

}

function freshRace() {

	return { laps: 0, lapTimes: [], total: null, best: null };

}
