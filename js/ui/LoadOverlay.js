// LoadOverlay.js — the loading panel over index.html: step, percent, elapsed seconds, Cancel.
// Renders a LoadProgress (../LoadProgress.js). No three.js: it must run before the CDN modules load.

import { labelKey } from '../LoadProgress.js';
import { t } from './strings.js';

const STYLE = `
	#load-overlay { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; background: rgba(10,12,14,0.55); }
	#load-overlay[hidden] { display: none; }
	#load-overlay.compact { inset: 12px 0 auto 0; background: none; pointer-events: none; }
	#load-overlay .load-box { pointer-events: auto; min-width: 260px; max-width: calc(100vw - 32px); padding: 14px 18px; border-radius: 14px;
		background: rgba(255,255,255,0.94); color: #1f2430; box-shadow: 0 10px 30px rgba(0,0,0,0.25);
		font: 400 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
	#load-overlay.compact .load-box { padding: 8px 14px; min-width: 220px; }
	#load-overlay .load-bar { height: 6px; margin: 10px 0 6px; border-radius: 3px; background: rgba(0,0,0,0.1); overflow: hidden; }
	#load-overlay .load-fill { height: 100%; width: 0; background: #1f2430; transition: width 0.2s; }
	#load-overlay .load-meta { display: flex; justify-content: space-between; align-items: center; gap: 12px; opacity: 0.75; }
	#load-overlay button { font: inherit; padding: 4px 12px; border-radius: 999px; border: 1px solid rgba(0,0,0,0.15); background: #fff; cursor: pointer; }
`;

let instance = null;

export function loadOverlay() {

	instance ??= new LoadOverlay( document.getElementById( 'load-overlay' ) );
	return instance;

}

class LoadOverlay {

	constructor( root ) {

		if ( ! root ) throw new Error( 'LoadOverlay needs a #load-overlay element' );
		this.root = root;
		this.cancelHandler = null;
		this.failed = false;
		this.currentProgress = null;
		this.buildDom();
		window.addEventListener( 'gg-langchange', () => this.render() );

	}

	buildDom() {

		const style = document.createElement( 'style' );
		style.textContent = STYLE;
		document.head.appendChild( style );
		this.root.setAttribute( 'role', 'status' );
		this.root.innerHTML = '<div class="load-box"><div id="load-label"></div><div class="load-bar"><div class="load-fill"></div></div>'
			+ '<div class="load-meta"><span><span id="load-percent"></span> · <span id="load-elapsed"></span></span><button id="load-cancel" type="button"></button></div></div>';
		this.label = this.root.querySelector( '#load-label' );
		this.fill = this.root.querySelector( '.load-fill' );
		this.percentEl = this.root.querySelector( '#load-percent' );
		this.elapsedEl = this.root.querySelector( '#load-elapsed' );
		this.button = this.root.querySelector( '#load-cancel' );
		this.button.addEventListener( 'click', () => this.cancel() );

	}

	get progress() {

		return this.currentProgress;

	}

	start( progress, onCancel ) {

		this.currentProgress = progress;
		this.cancelHandler = onCancel;
		progress.onChange = () => this.render();
		this.root.className = 'modal';
		this.root.hidden = false;
		this.ticker = setInterval( () => this.render(), 1000 );
		this.render();

	}

	setCancel( onCancel ) {

		this.cancelHandler = onCancel;
		this.render();

	}

	compact() {

		this.root.className = 'compact';

	}

	fail() {

		this.failed = true;
		this.root.className = 'modal';
		this.root.hidden = false;
		this.render();

	}

	hide() {

		clearInterval( this.ticker );
		this.root.hidden = true;

	}

	cancel() {

		this.button.blur();
		this.cancelHandler?.();

	}

	render() {

		const progress = this.currentProgress;
		if ( ! progress ) return;
		const lang = window.GG_LANG ?? 'en';
		this.label.textContent = this.failed ? t( 'load.failed', lang ) : t( labelKey( progress.stage, progress.detail ), lang, progress.detail );
		this.fill.style.width = progress.percent + '%';
		this.percentEl.textContent = progress.percent + ' %';
		this.elapsedEl.textContent = t( 'load.seconds', lang, { seconds: Math.floor( performance.now() / 1000 ) } );
		this.root.dataset.percent = String( progress.percent );
		this.button.textContent = t( this.failed ? 'load.back' : 'load.cancel', lang );
		this.button.hidden = ! this.cancelHandler;

	}

}
