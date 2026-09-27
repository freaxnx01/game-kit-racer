// LoadProgress.js — what the track loader is doing and how far it is. Pure: no DOM, no three.js,
// so the loading overlay can run before the CDN modules resolve. Rendered by ui/LoadOverlay.js.

export const STAGE_WEIGHTS = { engine: 10, models: 40, track: 10, lighting: 20, surroundings: 20 };

export class LoadProgress {

	constructor( stages ) {

		for ( const stage of stages ) assertKnownStage( stage );
		this.stages = stages;
		this.totalWeight = stages.reduce( ( sum, stage ) => sum + STAGE_WEIGHTS[ stage ], 0 );
		this.index = - 1;
		this.fraction = 0;
		this.currentDetail = {};
		this.best = 0;
		this.onChange = () => {};

	}

	begin( stage, detail = {} ) {

		assertKnownStage( stage );
		const index = this.stages.indexOf( stage );
		if ( index === - 1 ) throw new Error( `load stage not configured: ${ stage }` );
		if ( index < this.index ) throw new Error( `load stage goes backwards: ${ stage }` );
		this.index = index;
		this.fraction = 0;
		this.currentDetail = { ...detail };
		this.changed();

	}

	step( done, total, detail = {} ) {

		if ( ! ( total > 0 ) ) throw new Error( `load step total must be positive: ${ total }` );
		this.fraction = Math.min( 1, Math.max( 0, done / total ) );
		this.currentDetail = { ...detail, done, total };
		this.changed();

	}

	finish() {

		this.index = this.stages.length;
		this.currentDetail = {};
		this.best = 100;
		this.onChange();

	}

	get stage() {

		if ( this.index < 0 ) return 'pending';
		if ( this.index >= this.stages.length ) return 'done';
		return this.stages[ this.index ];

	}

	get detail() {

		return this.currentDetail;

	}

	get percent() {

		return this.best;

	}

	changed() {

		const finished = this.stages.slice( 0, this.index ).reduce( ( sum, stage ) => sum + STAGE_WEIGHTS[ stage ], 0 );
		const current = STAGE_WEIGHTS[ this.stages[ this.index ] ] * this.fraction;
		this.best = Math.max( this.best, Math.floor( ( finished + current ) / this.totalWeight * 100 ) );
		this.onChange();

	}

}

function assertKnownStage( stage ) {

	if ( ! ( stage in STAGE_WEIGHTS ) ) throw new Error( `unknown load stage: ${ stage }` );

}

export function labelKey( stage, detail ) {

	if ( stage === 'pending' ) return 'load.engine';
	if ( stage !== 'surroundings' ) return 'load.' + stage;
	if ( detail.phase === 'build' ) return 'load.build';
	return detail.host ? 'load.fetch' : 'load.surroundings';

}

// Where Cancel goes while the car is not drivable yet: back to the game page the player came from,
// else the default track, or null when that is the page already loading.
export function cancelTarget( currentHref, referrer ) {

	const current = new URL( currentHref );
	if ( referrer !== currentHref && isGamePage( referrer, current ) ) return referrer;
	if ( current.searchParams.has( 'map' ) ) return new URL( 'index.html', current ).href;
	return null;

}

function isGamePage( href, current ) {

	if ( ! href ) return false;

	let url;
	try {

		url = new URL( href );

	} catch {

		return false;

	}

	const dir = current.pathname.replace( /[^/]*$/, '' );
	return url.origin === current.origin && ( url.pathname === dir || url.pathname === dir + 'index.html' );

}
