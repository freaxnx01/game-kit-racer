// OpponentContacts.js — your truck against opponent trucks (CPU or multiplayer): no bounce, a capped push per
// physics step, and a bump callback with the relative speed for the impact sound. main.js calls the contact
// hooks from its crashcat contact listener and beginStep()/endStep() around updateWorld.

import { rigidBody } from 'crashcat';
import { softenBump, bumpSpeed, BUMP_SOUND_COOLDOWN_MS } from './Bump.js';

export class OpponentContacts {

	// opponentsList: Opponents instances whose trucks count (each has owns( body )).
	constructor( world, player, opponentsList, { onBump = () => {}, now = () => performance.now() } = {} ) {

		this.world = world;
		this.player = player;
		this.opponentsList = opponentsList;
		this.onBump = onBump;
		this.now = now;
		this.before = [ 0, 0, 0 ];
		this.touched = false;
		this.lastBump = new WeakMap(); // opponent body → time (ms) of its last bump sound

	}

	involvesOpponent( bodyA, bodyB ) {

		return this.opponentOf( bodyA, bodyB ) !== null;

	}

	// onContactAdded: a new player↔opponent contact.
	contactAdded( bodyA, bodyB, settings ) {

		this.contactPersisted( settings );
		this.reportBump( this.opponentOf( bodyA, bodyB ) );

	}

	// onContactPersisted: the contact goes on (settings are rebuilt every step, so set them again).
	contactPersisted( settings ) {

		settings.combinedRestitution = 0;
		this.touched = true;

	}

	beginStep() {

		this.before = [ ...this.player.motionProperties.linearVelocity ];
		this.touched = false;

	}

	endStep() {

		if ( ! this.touched ) return;
		const softened = softenBump( this.before, this.player.motionProperties.linearVelocity );
		rigidBody.setLinearVelocity( this.world, this.player, softened );

	}

	// ── Internals ───────────────────────────────────────────

	opponentOf( bodyA, bodyB ) {

		const other = bodyA === this.player ? bodyB : bodyB === this.player ? bodyA : null;
		if ( other === null ) return null;
		return this.opponentsList.some( ( opponents ) => opponents.owns( other ) ) ? other : null;

	}

	reportBump( opponent ) {

		const now = this.now();
		if ( now - ( this.lastBump.get( opponent ) ?? - Infinity ) < BUMP_SOUND_COOLDOWN_MS ) return;
		this.lastBump.set( opponent, now );
		this.onBump( bumpSpeed( this.player.motionProperties.linearVelocity, opponent.motionProperties.linearVelocity ) );

	}

}
