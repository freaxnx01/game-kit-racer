// CpuRace.js — a single-player race against 1–3 CPU trucks. Reuses the multiplayer race rules
// (RaceState: countdown, laps, finishing order, results) and grid; CPU trucks are CpuDrivers shown
// through Opponents. Pure: talks to the game only through the `game` adapter (see main.js):
//   { trackCells, cellSize, lapTimer: { onLap, resetForRace(), startRace(), resetForSolo(), progress() },
//     opponents: { add, push, update, clear }, placeOnSlot( slot ), setHold( hold ) }

import { RaceState, PHASE, gridSlots } from './RaceState.js';
import { RENDER_DELAY_MS } from './Interpolate.js';
import { MAX_LAPS } from '../net/Protocol.js';
import { FUNNY_NAMES } from '../ui/strings.js';
import { buildPath } from './TrackPath.js';
import { CpuDriver, DIFFICULTY } from './CpuDriver.js';

export const MAX_CPUS = 3;
export const YOU = 'you';
export const DEFAULT_SETTINGS = { cpus: 3, difficulty: 'medium', laps: 3 };
// CPUs differ a little so the field spreads out. Slots 0 and 2 share the left lane, so the car in front
// (slot 0) is the faster one — kinematic trucks pass through each other, so they must never catch up.
const PACE = [ 1.03, 1, 0.97 ];
const GO_SHOWN_MS = 1000;
const RENDER_EVERY_MS = 250;

const clampInt = ( v, min, max, fallback ) => Number.isInteger( v ) ? Math.min( max, Math.max( min, v ) ) : fallback;

// Settings from the UI, made safe: cpus 1–3, a known difficulty, laps 1–MAX_LAPS.
export function cleanSettings( { cpus, difficulty, laps } = {} ) {

	return {
		cpus: clampInt( cpus, 1, MAX_CPUS, DEFAULT_SETTINGS.cpus ),
		difficulty: Object.hasOwn( DIFFICULTY, difficulty ) ? difficulty : DEFAULT_SETTINGS.difficulty,
		laps: clampInt( laps, 1, MAX_LAPS, DEFAULT_SETTINGS.laps ),
	};

}

// Where a grid slot sits relative to the driving line: distance along it (≤ 0, behind the finish line)
// and lateral offset to the right — the same frame gridSlots and samplePath use.
export function laneOf( slot, finishCell, cellSize ) {

	const cx = ( finishCell[ 0 ] + 0.5 ) * cellSize, cz = ( finishCell[ 1 ] + 0.5 ) * cellSize;
	const fx = Math.sin( slot.angle ), fz = Math.cos( slot.angle );
	const dx = slot.position[ 0 ] - cx, dz = slot.position[ 2 ] - cz;
	return { start: dx * fx + dz * fz, lateral: dx * fz - dz * fx };

}

export class CpuRace {

	constructor( game, { onChange = null, now = () => performance.now(), isBusy = () => false } = {} ) {

		this.game = game;
		this.onChange = onChange;
		this.now = now;
		this.isBusy = isBusy;
		this.path = buildPath( game.trackCells, game.cellSize );
		this.finishCell = game.trackCells.find( ( c ) => c[ 2 ] === 'track-finish' ) ?? null;
		this.settings = { ...DEFAULT_SETTINGS };
		this.race = null;
		this.drivers = new Map();   // cpu id → CpuDriver
		this.lapStart = new Map();  // cpu id → time (ms) its current lap started
		this.previousOnLap = null;
		this.lastRender = 0;

	}

	// false when the track is not one closed loop with a finish line (CPUs need a driving line).
	get available() {

		return this.path !== null;

	}

	// Sets up the grid and starts the countdown. Returns false when CPU races are not available.
	start( settings ) {

		if ( ! this.available || this.isBusy() ) return false;
		this.teardown();
		this.settings = cleanSettings( settings );
		const { cpus, laps, difficulty } = this.settings;
		const now = this.now();

		this.race = new RaceState( { cellCount: this.game.trackCells.length, cellSize: this.game.cellSize, laps } );
		this.race.addPlayer( YOU, YOU );
		const slots = this.gridSlots();
		for ( let i = 0; i < cpus; i ++ ) this.addCpu( i, slots[ i ], DIFFICULTY[ difficulty ] );

		this.game.placeOnSlot( cpus );
		this.game.setHold( true );
		this.game.lapTimer.resetForRace();
		this.previousOnLap = this.game.lapTimer.onLap;
		this.game.lapTimer.onLap = ( lap, time ) => this.playerLap( lap, time );
		this.race.start( now );
		this.pushStates( 0, now );
		this.changed( now );
		return true;

	}

	rematch() {

		return this.start( this.settings );

	}

	// Back to free driving: CPU trucks gone, lap timer back to single player.
	quit() {

		if ( ! this.race ) return;
		this.teardown();
		this.changed( this.now() );

	}

	// Once per frame, before the physics step.
	update( dt ) {

		if ( ! this.race ) return;
		const now = this.now();
		const before = this.race.phase;
		const phase = this.race.tick( now );

		if ( before === PHASE.COUNTDOWN && phase === PHASE.RACING ) this.go( now );
		if ( phase !== PHASE.COUNTDOWN ) this.drive( dt, now );
		this.pushStates( dt, now );

		if ( phase !== before || now - this.lastRender >= RENDER_EVERY_MS ) this.changed( now );

	}

	// Plain data for the UI.
	view() {

		const now = this.now();
		const phase = this.race?.phase ?? null;
		return {
			available: this.available,
			settings: { ...this.settings },
			phase,
			laps: this.settings.laps,
			countdown: this.countdownLabel( now ),
			positions: this.race ? this.race.standings( this.progressMap() ).map( ( id ) => this.row( id ) ) : [],
			results: phase === PHASE.RESULTS ? this.race.results( this.progressMap() ) : null,
		};

	}

	// Minimap dots: where each CPU truck is drawn, and its truck colour index (0–2, as given to opponents.add).
	markers() {

		return [ ...this.drivers.values() ].map( ( driver, colour ) => {

			const { p } = driver.state();
			return { x: p[ 0 ], z: p[ 2 ], colour };

		} );

	}

	// ── Internals ───────────────────────────────────────────

	gridSlots() {

		const keys = new Set( this.game.trackCells.map( ( c ) => c[ 0 ] + ',' + c[ 1 ] ) );
		return gridSlots( this.finishCell, this.game.cellSize, ( gx, gz ) => keys.has( gx + ',' + gz ) );

	}

	addCpu( index, slot, difficulty ) {

		const id = 'cpu' + ( index + 1 );
		const name = FUNNY_NAMES[ index ];
		const { start, lateral } = laneOf( slot, this.finishCell, this.game.cellSize );
		this.race.addPlayer( id, name );
		this.drivers.set( id, new CpuDriver( { path: this.path, start, lateral, difficulty, pace: PACE[ index ], terrain: this.game.terrain ?? null } ) );
		this.game.opponents.add( id, name, index );

	}

	go( now ) {

		this.game.setHold( false );
		this.game.lapTimer.startRace();
		for ( const id of this.drivers.keys() ) this.lapStart.set( id, now );

	}

	drive( dt, now ) {

		for ( const [ id, driver ] of this.drivers ) {

			driver.update( dt );
			this.recordCpuLaps( id, driver, now );

		}

	}

	recordCpuLaps( id, driver, now ) {

		const player = this.race.find( id );
		while ( player.total === null && player.laps < Math.min( driver.lapsDone(), this.race.laps ) ) {

			const lap = player.laps + 1;
			if ( ! this.race.recordLap( id, lap, ( now - this.lapStart.get( id ) ) / 1000, now ) ) return;
			this.lapStart.set( id, now );
			if ( lap === this.race.laps ) this.race.recordFinish( id, now );

		}

	}

	playerLap( lap, time ) {

		if ( ! this.race ) return;
		const now = this.now();
		if ( this.race.recordLap( YOU, lap, time, now ) && lap === this.race.laps ) this.race.recordFinish( YOU, now );
		this.changed( now );

	}

	// CPU poses are pushed at `now` and sampled RENDER_DELAY_MS later on the Opponents clock,
	// so the trucks are drawn where they are, not 100 ms behind like remote players.
	pushStates( dt, now ) {

		for ( const [ id, driver ] of this.drivers ) this.game.opponents.push( id, driver.state(), now );
		this.game.opponents.update( dt, now + RENDER_DELAY_MS );

	}

	progressMap() {

		const map = new Map( [ [ YOU, this.game.lapTimer.progress() ] ] );
		for ( const [ id, driver ] of this.drivers ) map.set( id, driver.progress() );
		return map;

	}

	row( id ) {

		const p = this.race.find( id );
		return { id, name: p.name, you: id === YOU, lap: Math.min( p.laps + 1, this.race.laps ), finished: p.total !== null };

	}

	countdownLabel( now ) {

		if ( ! this.race || this.race.startAt === null ) return null;
		const left = this.race.startAt - now;
		if ( left > 0 ) return String( Math.ceil( left / 1000 ) );
		return left > - GO_SHOWN_MS ? 'go' : null;

	}

	teardown() {

		if ( ! this.race ) return;
		this.game.opponents.clear();
		this.game.lapTimer.onLap = this.previousOnLap;
		this.game.lapTimer.resetForSolo();
		this.game.setHold( false );
		this.race = null;
		this.drivers.clear();
		this.lapStart.clear();

	}

	changed( now ) {

		this.lastRender = now;
		this.onChange?.( this.view() );

	}

}
