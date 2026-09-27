// Starts the audio context on the first real user gesture, and again after the browser
// interrupts it (iOS: phone call, lock screen). No three.js import, so Node can test it.

// Activation-triggering events per the HTML spec. `touchstart` is deliberately missing: it
// grants no activation, and the `touchend` of the same drag does.
export const UNLOCK_EVENTS = [ 'pointerdown', 'pointerup', 'touchend', 'keydown', 'click' ];

// Capture phase: a stopPropagation() in page UI (the Tracks button) must not hide the gesture.
const LISTENER_OPTIONS = { capture: true, passive: true };

export class AudioUnlock {

	constructor( context, { target = globalThis, onUnlock = () => {}, isHidden = () => globalThis.document?.hidden === true } = {} ) {

		this.context = context;
		this.target = target;
		this.onUnlock = onUnlock;
		this.isHidden = isHidden;
		this.armed = false;
		this.everUnlocked = false;
		this.handleGesture = () => this.tryResume();

		context.addEventListener( 'statechange', () => this.handleStateChange() );

	}

	get unlocked() {

		return this.everUnlocked;

	}

	arm() {

		if ( this.armed ) return;
		this.armed = true;
		for ( const type of UNLOCK_EVENTS ) this.target.addEventListener( type, this.handleGesture, LISTENER_OPTIONS );

	}

	disarm() {

		if ( ! this.armed ) return;
		this.armed = false;
		for ( const type of UNLOCK_EVENTS ) this.target.removeEventListener( type, this.handleGesture, LISTENER_OPTIONS );

	}

	async tryResume() {

		try {

			await this.context.resume();

		} catch ( e ) {

			// Expected without user activation; the listeners stay armed for the next gesture.
			console.debug( 'Audio not unlocked yet, waiting for the next gesture:', e.message );

		}

		if ( this.context.state === 'running' ) this.completeUnlock();

	}

	suspendForHidden() {

		if ( this.context.state === 'running' ) this.context.suspend();

	}

	async resumeForVisible() {

		if ( ! this.everUnlocked ) return;
		await this.tryResume();
		if ( this.context.state !== 'running' ) this.arm();

	}

	handleStateChange() {

		if ( this.context.state === 'running' ) {

			this.completeUnlock();
			return;

		}

		if ( ! this.everUnlocked || this.isHidden() ) return;
		this.arm();

	}

	completeUnlock() {

		this.disarm();
		if ( this.everUnlocked ) return;
		this.everUnlocked = true;
		this.onUnlock();

	}

}
