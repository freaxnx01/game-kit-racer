// CpuPanel.js — vs CPU UI: settings (CPU trucks, difficulty, laps), countdown, live positions, results.
// Mirrors Lobby.js: renders CpuRace views and calls back into the race; the panel is rebuilt only when
// its structure changes, so selects keep their content; timers and positions update in place.

import { t } from './strings.js';
import { MAX_LAPS } from '../net/Protocol.js';
import { MAX_CPUS, YOU } from '../race/CpuRace.js';

const DIFFICULTIES = [ 'easy', 'medium', 'hard' ];

const STYLE = `
	#cpu-button { bottom: 12px; left: 236px; cursor: pointer; }
	#cpu-panel {
		position: absolute; bottom: 56px; left: 12px; width: 300px; max-height: calc(100vh - 140px); overflow-y: auto;
		padding: 14px 16px; background: rgba(255,255,255,0.95); border-radius: 14px; border: 1px solid rgba(0,0,0,0.06);
		box-shadow: 0 10px 30px rgba(0,0,0,0.25); font: 400 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		color: #1f2430; z-index: 21; box-sizing: border-box;
	}
	#cpu-panel[hidden], #cpu-positions[hidden], #cpu-countdown[hidden] { display: none; }
	#cpu-panel h2 { font-size: 15px; margin: 0 0 10px; }
	#cpu-panel label { display: block; margin: 10px 0 4px; color: #4a5260; }
	#cpu-panel select {
		width: 100%; box-sizing: border-box; font: inherit; padding: 6px 8px; border: 1px solid rgba(0,0,0,0.15); border-radius: 8px; background: #fff;
	}
	#cpu-panel button { font: inherit; padding: 7px 12px; margin: 8px 6px 0 0; border: none; border-radius: 999px; background: #eef0f3; color: #1f2430; cursor: pointer; }
	#cpu-panel button.primary { background: #1f2430; color: #fff; font-weight: 600; }
	#cpu-panel button:disabled { opacity: 0.4; cursor: default; }
	#cpu-panel .message { color: #b45309; margin-top: 10px; }
	#cpu-panel table { width: 100%; border-collapse: collapse; margin-top: 6px; }
	#cpu-panel td, #cpu-panel th { text-align: left; padding: 4px 2px; font-variant-numeric: tabular-nums; }
	#cpu-positions {
		position: absolute; top: 150px; left: 12px; min-width: 140px; padding: 8px 12px; border-radius: 10px;
		background: rgba(0,0,0,0.5); color: #fff; font: 600 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; z-index: 10;
	}
	#cpu-positions .you { color: #f2c94c; }
	#cpu-positions button { margin-top: 6px; font: inherit; font-size: 11px; background: rgba(255,255,255,0.2); color: #fff; border: none; border-radius: 999px; padding: 3px 10px; cursor: pointer; }
	#cpu-countdown {
		position: absolute; top: 35%; left: 50%; transform: translate(-50%, -50%); color: #fff; pointer-events: none; z-index: 22;
		font: 800 120px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; text-shadow: 0 4px 20px rgba(0,0,0,0.5);
	}
`;

function el( tag, props = {}, ...children ) {

	const node = document.createElement( tag );
	for ( const [ k, v ] of Object.entries( props ) ) {

		if ( k === 'text' ) node.textContent = v;
		else if ( k === 'on' ) for ( const [ ev, fn ] of Object.entries( v ) ) node.addEventListener( ev, fn );
		else if ( v !== false && v !== null && v !== undefined ) node[ k ] = v;

	}

	for ( const c of children ) if ( c ) node.appendChild( c );
	return node;

}

function formatTime( seconds ) {

	if ( seconds === null || seconds === undefined ) return '—';
	const m = Math.floor( seconds / 60 );
	return `${ m }:${ ( seconds - m * 60 ).toFixed( 2 ).padStart( 5, '0' ) }`;

}

export class CpuPanel {

	constructor() {

		this.race = null;
		this.isBusy = () => false;
		this.open = false;
		this.view = { available: true, settings: { cpus: 3, difficulty: 'medium', laps: 3 }, phase: null, positions: [], results: null, countdown: null, laps: 3 };
		this.structure = '';

		const style = document.createElement( 'style' );
		style.textContent = STYLE;
		document.head.appendChild( style );

		this.button = el( 'a', { id: 'cpu-button', className: 'corner-link', role: 'button', on: { click: ( e ) => { e.stopPropagation(); this.toggle(); } } } );
		this.panel = el( 'div', { id: 'cpu-panel', hidden: true } );
		this.positionsList = el( 'div' );
		this.quitButton = el( 'button', { on: { click: () => this.race?.quit() } } );
		this.positionsEl = el( 'div', { id: 'cpu-positions', hidden: true }, this.positionsList, this.quitButton );
		this.countdownEl = el( 'div', { id: 'cpu-countdown', hidden: true } );
		document.body.append( this.button, this.panel, this.positionsEl, this.countdownEl );

		this.cpusSelect = el( 'select' );
		this.difficultySelect = el( 'select' );
		this.lapsSelect = el( 'select' );

		window.addEventListener( 'gg-langchange', () => this.render( this.view, true ) );
		this.render( this.view, true );

	}

	bind( race, { isBusy = () => false } = {} ) {

		this.race = race;
		this.isBusy = isBusy;
		this.render( race.view(), true );

	}

	toggle() {

		this.open = ! this.open;
		this.render( this.view, true );

	}

	get lang() {

		return window.GG_LANG ?? 'en';

	}

	render( view, force = false ) {

		this.view = view;
		const racing = view.phase === 'countdown' || view.phase === 'racing';
		if ( racing ) this.open = false;
		if ( view.phase === 'results' ) this.open = true;

		const key = JSON.stringify( [ this.open, this.lang, view.available, view.settings, view.phase, view.results, this.isBusy() ] );

		if ( force || key !== this.structure ) {

			this.structure = key;
			this.button.textContent = t( 'cpu.button', this.lang );
			this.panel.hidden = ! this.open;
			this.panel.replaceChildren( ...( this.open ? this.panelContent( view ) : [] ) );

		}

		this.updateLive( view );

	}

	panelContent( view ) {

		const L = this.lang;
		const parts = [ el( 'h2', { text: t( 'cpu.title', L ) } ) ];

		if ( view.phase === 'results' ) parts.push( ...this.resultsPart( view ) );
		else if ( ! view.available ) parts.push( el( 'div', { className: 'message', text: t( 'cpu.noLoop', L ) } ) );
		else parts.push( ...this.settingsPart( view ) );

		if ( view.phase !== 'results' ) parts.push( el( 'button', { text: t( 'mp.close', L ), on: { click: () => this.toggle() } } ) );
		return parts;

	}

	settingsPart( view ) {

		const L = this.lang;
		this.cpusSelect.replaceChildren( ...Array.from( { length: MAX_CPUS }, ( _, i ) => i + 1 )
			.map( ( n ) => el( 'option', { value: n, text: String( n ), selected: n === view.settings.cpus } ) ) );
		this.difficultySelect.replaceChildren( ...DIFFICULTIES
			.map( ( d ) => el( 'option', { value: d, text: t( 'cpu.' + d, L ), selected: d === view.settings.difficulty } ) ) );
		this.lapsSelect.replaceChildren( ...Array.from( { length: MAX_LAPS }, ( _, i ) => i + 1 )
			.map( ( n ) => el( 'option', { value: n, text: String( n ), selected: n === view.settings.laps } ) ) );

		const settings = () => ( { cpus: Number( this.cpusSelect.value ), difficulty: this.difficultySelect.value, laps: Number( this.lapsSelect.value ) } );

		return [
			el( 'label', { text: t( 'cpu.opponents', L ) } ), this.cpusSelect,
			el( 'label', { text: t( 'cpu.difficulty', L ) } ), this.difficultySelect,
			el( 'label', { text: t( 'mp.laps', L ) } ), this.lapsSelect,
			el( 'button', { className: 'primary', text: t( 'mp.start', L ), disabled: this.isBusy(), on: { click: () => this.race.start( settings() ) } } ),
		];

	}

	resultsPart( view ) {

		const L = this.lang;
		const table = el( 'table', {},
			el( 'tr', {}, el( 'th', { text: '#' } ), el( 'th', { text: '' } ), el( 'th', { text: t( 'mp.time', L ) } ), el( 'th', { text: t( 'mp.best', L ) } ) ),
			...( view.results ?? [] ).map( ( r ) => el( 'tr', {},
				el( 'td', { text: String( r.place ) } ),
				el( 'td', { text: r.id === YOU ? t( 'mp.you', L ) : r.name } ),
				el( 'td', { text: r.total === null ? t( 'mp.dnf', L ) : formatTime( r.total ) } ),
				el( 'td', { text: formatTime( r.best ) } ) ) ) );

		return [
			el( 'h2', { text: t( 'mp.results', L ) } ), table,
			el( 'button', { className: 'primary', text: t( 'mp.rematch', L ), on: { click: () => this.race.rematch() } } ),
			el( 'button', { text: t( 'cpu.freeDrive', L ), on: { click: () => this.race.quit() } } ),
		];

	}

	updateLive( view ) {

		const L = this.lang;

		this.countdownEl.hidden = ! view.countdown;
		if ( view.countdown ) this.countdownEl.textContent = view.countdown === 'go' ? t( 'mp.go', L ) : view.countdown;

		const racing = view.phase === 'countdown' || view.phase === 'racing';
		this.positionsEl.hidden = ! racing;
		if ( ! racing ) return;

		const rows = view.positions.map( ( p, i ) => el( 'div', { className: p.you ? 'you' : '',
			text: `P${ i + 1 } ${ p.you ? t( 'mp.you', L ) : p.name } · ${ t( 'mp.lapOf', L, { lap: p.lap, laps: view.laps } ) }` } ) );
		this.positionsList.replaceChildren( ...rows );
		this.quitButton.textContent = t( 'cpu.quit', L );

	}

}
