// Lobby.js — multiplayer UI: menu, host lobby with invites, guest join, countdown, live positions,
// results. It renders MultiplayerRace views and calls back into the race; all player-provided text
// goes through textContent. The panel is rebuilt only when its structure changes, so inputs keep
// their content and focus; timers and positions update in place.

import { t, funnyName } from './strings.js';
import { MAX_LAPS } from '../net/Protocol.js';

const STYLE = `
	#mp-button { bottom: 12px; left: 100px; cursor: pointer; }
	#mp-panel {
		position: absolute; bottom: 56px; left: 12px; width: 330px; max-height: calc(100vh - 140px); overflow-y: auto;
		padding: 14px 16px; background: rgba(255,255,255,0.95); border-radius: 14px; border: 1px solid rgba(0,0,0,0.06);
		box-shadow: 0 10px 30px rgba(0,0,0,0.25); font: 400 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		color: #1f2430; z-index: 21; box-sizing: border-box;
	}
	#mp-panel[hidden], #mp-positions[hidden], #mp-countdown[hidden] { display: none; }
	#mp-panel h2 { font-size: 15px; margin: 0 0 10px; }
	#mp-panel label { display: block; margin: 10px 0 4px; color: #4a5260; }
	#mp-panel input, #mp-panel textarea, #mp-panel select {
		width: 100%; box-sizing: border-box; font: inherit; padding: 6px 8px; border: 1px solid rgba(0,0,0,0.15); border-radius: 8px; background: #fff;
	}
	#mp-panel textarea { height: 54px; resize: none; font-family: ui-monospace, monospace; font-size: 11px; word-break: break-all; }
	#mp-panel button { font: inherit; padding: 7px 12px; margin: 8px 6px 0 0; border: none; border-radius: 999px; background: #eef0f3; color: #1f2430; cursor: pointer; }
	#mp-panel button.primary { background: #1f2430; color: #fff; font-weight: 600; }
	#mp-panel button:disabled { opacity: 0.4; cursor: default; }
	#mp-panel .invite { margin-top: 10px; padding: 10px; background: #f5f6f8; border-radius: 10px; }
	#mp-panel .muted { color: #6b7280; font-size: 12px; margin-top: 6px; }
	#mp-panel .message { color: #b45309; margin-top: 10px; }
	#mp-panel ul { list-style: none; padding: 0; margin: 6px 0 0; }
	#mp-panel li { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid rgba(0,0,0,0.06); }
	#mp-panel table { width: 100%; border-collapse: collapse; margin-top: 6px; }
	#mp-panel td, #mp-panel th { text-align: left; padding: 4px 2px; font-variant-numeric: tabular-nums; }
	#mp-positions {
		position: absolute; top: 150px; left: 12px; min-width: 140px; padding: 8px 12px; border-radius: 10px;
		background: rgba(0,0,0,0.5); color: #fff; font: 600 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; z-index: 10;
	}
	#mp-positions .you { color: #f2c94c; }
	#mp-positions button { margin-top: 6px; font: inherit; font-size: 11px; background: rgba(255,255,255,0.2); color: #fff; border: none; border-radius: 999px; padding: 3px 10px; cursor: pointer; }
	#mp-countdown {
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

async function copy( text, button, lang ) {

	try {

		await navigator.clipboard.writeText( text );

	} catch {

		prompt( '', text );

	}

	const label = button.textContent;
	button.textContent = t( 'mp.copied', lang );
	setTimeout( () => { button.textContent = label; }, 1200 );

}

export class Lobby {

	// canRace: false when the track has no finish line (a race needs laps).
	constructor( { canRace = true } = {} ) {

		this.canRace = canRace;
		this.mp = null;
		this.open = false;
		this.joining = false;
		this.view = { role: null };
		this.structure = '';

		const style = document.createElement( 'style' );
		style.textContent = STYLE;
		document.head.appendChild( style );

		this.button = el( 'a', { id: 'mp-button', className: 'corner-link', role: 'button', on: { click: ( e ) => { e.stopPropagation(); this.toggle(); } } } );
		this.panel = el( 'div', { id: 'mp-panel', hidden: true } );
		this.positionsList = el( 'div' );
		this.leaveButton = el( 'button', { on: { click: () => { if ( confirm( t( 'mp.leaveConfirm', this.lang ) ) ) this.mp.leave(); } } } );
		this.positionsEl = el( 'div', { id: 'mp-positions', hidden: true }, this.positionsList, this.leaveButton );
		this.countdownEl = el( 'div', { id: 'mp-countdown', hidden: true } );
		document.body.append( this.button, this.panel, this.positionsEl, this.countdownEl );

		this.nameInput = el( 'input', { maxLength: 16, value: funnyName() } );
		this.offerInput = el( 'textarea', { spellcheck: false } );
		this.answerInputs = new Map();

		window.addEventListener( 'gg-langchange', () => this.render( this.view, true ) );
		this.render( this.view, true );

	}

	bind( mp ) {

		this.mp = mp;

	}

	// Opened from an invite link: straight to "join" with the offer filled in.
	openJoin( offerCode ) {

		this.open = true;
		this.joining = true;
		this.offerInput.value = offerCode;
		this.render( this.view, true );

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

		const key = JSON.stringify( [ this.open, this.joining, this.lang, view.role, view.phase, view.you, view.laps, view.players,
			view.invites?.map( ( i ) => [ i.peerId, i.secondsLeft === 0 ] ), view.answerCode, view.results, view.message, view.finished ] );

		if ( force || key !== this.structure ) {

			this.structure = key;
			this.button.textContent = t( 'mp.button', this.lang );
			this.panel.hidden = ! this.open;
			this.panel.replaceChildren( ...( this.open ? this.panelContent( view ) : [] ) );

		}

		this.updateLive( view );

	}

	panelContent( view ) {

		const L = this.lang;
		const parts = [ el( 'h2', { text: t( 'mp.button', L ) } ) ];

		if ( ! view.role ) parts.push( ...this.menu() );
		else if ( view.phase === 'results' ) parts.push( ...this.resultsPart( view ) );
		else if ( view.role === 'host' ) parts.push( ...this.hostLobby( view ) );
		else parts.push( ...this.guestLobby( view ) );

		if ( view.message ) parts.push( el( 'div', { className: 'message', text: t( view.message.key, L, view.message.vars ) } ) );
		if ( view.role ) parts.push( el( 'button', { text: t( 'mp.leave', L ), on: { click: () => this.mp.leave() } } ) );
		return parts;

	}

	menu() {

		const L = this.lang;
		const parts = [ el( 'label', { text: t( 'mp.name', L ) } ), this.nameInput ];

		if ( ! this.canRace ) return [ ...parts, el( 'div', { className: 'message', text: t( 'mp.noFinish', L ) } ) ];

		if ( ! this.joining ) {

			parts.push(
				el( 'button', { className: 'primary', text: t( 'mp.create', L ), on: { click: () => this.mp.host( this.name(), 3 ) } } ),
				el( 'button', { text: t( 'mp.join', L ), on: { click: () => { this.joining = true; this.render( this.view, true ); } } } ),
			);
			return parts;

		}

		const answer = el( 'button', { className: 'primary', text: t( 'mp.createAnswer', L ) } );
		answer.addEventListener( 'click', async () => {

			answer.disabled = true;
			answer.textContent = t( 'mp.connecting', L );
			await this.mp.join( this.offerInput.value, this.name() );
			this.joining = false;

		} );

		parts.push( el( 'label', { text: t( 'mp.pasteOffer', L ) } ), this.offerInput, answer );
		return parts;

	}

	hostLobby( view ) {

		const L = this.lang;
		const laps = el( 'select', { on: { change: ( e ) => this.mp.setLaps( Number( e.target.value ) ) } } );
		for ( let n = 1; n <= MAX_LAPS; n ++ ) laps.appendChild( el( 'option', { value: n, text: String( n ), selected: n === view.laps } ) );

		const parts = [ el( 'label', { text: t( 'mp.laps', L ) } ), laps, this.rosterList( view ) ];

		for ( const invite of view.invites ) parts.push( this.invitePart( invite ) );

		const inviteBtn = el( 'button', { text: t( 'mp.invite', L ), disabled: view.players.length + view.invites.length >= 4 } );
		inviteBtn.addEventListener( 'click', async () => {

			inviteBtn.disabled = true;
			await this.mp.invite();

		} );

		const connected = view.players.filter( ( p ) => p.connected ).length;
		parts.push( inviteBtn, el( 'button', { className: 'primary', text: t( 'mp.start', L ), disabled: connected < 2, on: { click: () => this.mp.start() } } ) );
		return parts;

	}

	invitePart( invite ) {

		const L = this.lang;
		if ( ! this.answerInputs.has( invite.peerId ) ) this.answerInputs.set( invite.peerId, el( 'textarea', { spellcheck: false, placeholder: t( 'mp.pasteAnswer', L ) } ) );
		const answer = this.answerInputs.get( invite.peerId );

		if ( invite.secondsLeft === 0 ) {

			return el( 'div', { className: 'invite' },
				el( 'div', { className: 'message', text: t( 'mp.expired', L ) } ),
				el( 'button', { text: t( 'mp.invite', L ), on: { click: () => this.mp.regenerate( invite.peerId ) } } ) );

		}

		const linkBtn = el( 'button', { className: 'primary', text: t( 'mp.copyLink', L ) } );
		linkBtn.addEventListener( 'click', () => copy( invite.link, linkBtn, L ) );
		const codeBtn = el( 'button', { text: t( 'mp.copyCode', L ) } );
		codeBtn.addEventListener( 'click', () => copy( invite.code, codeBtn, L ) );

		return el( 'div', { className: 'invite' },
			linkBtn, codeBtn,
			el( 'div', { className: 'muted expiry', text: '' } ),
			answer,
			el( 'button', { text: t( 'mp.connect', L ), on: { click: () => this.mp.accept( invite.peerId, answer.value ) } } ) );

	}

	guestLobby( view ) {

		const L = this.lang;

		if ( ! view.you ) {

			const codeBtn = el( 'button', { className: 'primary', text: t( 'mp.copyCode', L ) } );
			codeBtn.addEventListener( 'click', () => copy( view.answerCode, codeBtn, L ) );
			return [
				el( 'label', { text: t( 'mp.sendAnswer', L ) } ),
				el( 'textarea', { readOnly: true, value: view.answerCode ?? '', className: 'answer-code' } ),
				codeBtn,
			];

		}

		return [ this.rosterList( view ), el( 'div', { className: 'muted', text: t( 'mp.waitingHost', L ) } ) ];

	}

	rosterList( view ) {

		const L = this.lang;
		return el( 'ul', { className: 'roster' }, ...view.players.map( ( p ) => el( 'li', {},
			el( 'span', { text: p.name } ),
			el( 'span', { className: 'muted', text: p.id === view.you ? t( 'mp.you', L ) : t( p.connected ? 'mp.connected' : 'mp.waiting', L ) } ) ) ) );

	}

	resultsPart( view ) {

		const L = this.lang;
		const table = el( 'table', {},
			el( 'tr', {}, el( 'th', { text: '#' } ), el( 'th', { text: '' } ), el( 'th', { text: t( 'mp.time', L ) } ), el( 'th', { text: t( 'mp.best', L ) } ) ),
			...( view.results ?? [] ).map( ( r ) => el( 'tr', {},
				el( 'td', { text: String( r.place ) } ),
				el( 'td', { text: r.name } ),
				el( 'td', { text: r.total === null ? t( 'mp.dnf', L ) : formatTime( r.total ) } ),
				el( 'td', { text: formatTime( r.best ) } ) ) ) );

		const parts = [ el( 'h2', { text: t( 'mp.results', L ) } ), table ];
		if ( view.role === 'host' ) {

			parts.push(
				el( 'button', { className: 'primary', text: t( 'mp.rematch', L ), on: { click: () => { this.mp.rematch(); this.mp.start(); } } } ),
				el( 'button', { text: t( 'mp.backToLobby', L ), on: { click: () => this.mp.rematch() } } ) );

		} else {

			parts.push( el( 'div', { className: 'muted', text: t( 'mp.waitingHost', L ) } ) );

		}

		return parts;

	}

	updateLive( view ) {

		const L = this.lang;

		for ( const [ i, node ] of [ ...this.panel.querySelectorAll( '.invite .expiry' ) ].entries() ) {

			const s = view.invites[ i ]?.secondsLeft ?? 0;
			node.textContent = t( 'mp.expiresIn', L, { time: `${ Math.floor( s / 60 ) }:${ String( s % 60 ).padStart( 2, '0' ) }` } );

		}

		this.countdownEl.hidden = ! view.countdown;
		if ( view.countdown ) this.countdownEl.textContent = view.countdown === 'GO' ? t( 'mp.go', L ) : view.countdown;

		const racing = view.phase === 'countdown' || view.phase === 'racing';
		this.positionsEl.hidden = ! racing;
		if ( ! racing ) return;

		const rows = view.positions.map( ( p, i ) => el( 'div', { className: p.you ? 'you' : '', text: `P${ i + 1 } ${ p.name }` } ) );
		if ( view.finished ) rows.push( el( 'div', { text: t( 'mp.finished', L ) } ) );
		this.positionsList.replaceChildren( ...rows );
		this.leaveButton.textContent = t( 'mp.leave', L );

	}

	name() {

		const name = this.nameInput.value.replace( /[ -]/g, '' ).trim().slice( 0, 16 );
		return name || funnyName();

	}

}
