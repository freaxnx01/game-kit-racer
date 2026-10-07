// Opponents.js — other players' trucks: a model plus a kinematic sphere body that follows their
// broadcast states, so your truck bumps into them. Reusable for ghost (#3) and CPU (#4) opponents.

import * as THREE from 'three';
import { rigidBody, sphere, MotionType } from 'crashcat';
import { pushState, sampleBuffer, RENDER_DELAY_MS } from './Interpolate.js';
import { isTeleport } from './Bump.js';

// CPU races: you drive yellow, the CPUs the other three. Multiplayer: one colour per grid slot on every
// screen, your own truck included (main.js paints it), so a player looks the same to everyone.
export const CPU_TRUCKS = [ 'vehicle-truck-green', 'vehicle-truck-purple', 'vehicle-truck-red' ];
export const SLOT_TRUCKS = [ 'vehicle-truck-yellow', ...CPU_TRUCKS ];
const SPHERE_RADIUS = 0.5;  // same as the player's body (Physics.js createSphereBody)
const MODEL_OFFSET_Y = 0.5; // Vehicle.js puts the model half a unit below the sphere centre
const HIDDEN = [ 0, - 100, 0 ];

function nameSprite( name ) {

	const canvas = document.createElement( 'canvas' );
	canvas.width = 256;
	canvas.height = 64;
	const ctx = canvas.getContext( '2d' );
	ctx.font = '600 30px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillStyle = 'rgba(10,12,14,0.6)';
	const w = Math.min( 250, ctx.measureText( name ).width + 28 );
	ctx.beginPath();
	ctx.roundRect( 128 - w / 2, 10, w, 44, 22 );
	ctx.fill();
	ctx.fillStyle = '#fff';
	ctx.fillText( name, 128, 33 );

	const sprite = new THREE.Sprite( new THREE.SpriteMaterial( { map: new THREE.CanvasTexture( canvas ), depthTest: false } ) );
	sprite.scale.set( 2, 0.5, 1 );
	sprite.position.y = 1.6;
	return sprite;

}

export class Opponents {

	// models: the loaded GLB scenes by name (main.js `models`); world: the crashcat world;
	// trucks: model names that add()'s index picks from.
	constructor( scene, world, models, trucks = CPU_TRUCKS ) {

		this.scene = scene;
		this.world = world;
		this.models = models;
		this.truckNames = trucks;
		this.trucks = new Map(); // id → { group, body, buffer }

	}

	// index picks the truck colour from `trucks`; re-adding an id replaces it.
	add( id, name, index ) {

		this.remove( id );
		const group = new THREE.Group();
		const src = this.models[ this.truckNames[ index % this.truckNames.length ] ];
		if ( src ) group.add( src.clone() );
		group.add( nameSprite( name ) );
		group.visible = false;
		this.scene.add( group );

		const body = rigidBody.create( this.world, {
			shape: sphere.create( { radius: SPHERE_RADIUS } ),
			motionType: MotionType.KINEMATIC,
			objectLayer: this.world._OL_MOVING,
			position: HIDDEN,
		} );

		this.trucks.set( id, { group, body, buffer: [] } );

	}

	remove( id ) {

		const truck = this.trucks.get( id );
		if ( ! truck ) return;
		this.scene.remove( truck.group );
		rigidBody.remove( this.world, truck.body );
		this.trucks.delete( id );

	}

	clear() {

		for ( const id of [ ...this.trucks.keys() ] ) this.remove( id );

	}

	// True when body is one of these trucks' physics bodies (for the contact listener).
	owns( body ) {

		for ( const truck of this.trucks.values() ) if ( truck.body === body ) return true;
		return false;

	}

	// A validated `state` message received at local time now (ms).
	push( id, state, now ) {

		const truck = this.trucks.get( id );
		if ( truck ) pushState( truck.buffer, { t: now, p: state.p, q: state.q, v: state.v } );

	}

	// Call once per frame before the physics step: moves each body towards its interpolated pose.
	update( dt, now ) {

		for ( const truck of this.trucks.values() ) {

			const pose = sampleBuffer( truck.buffer, now - RENDER_DELAY_MS );
			if ( ! pose ) continue;

			if ( dt > 0 ) this.moveBody( truck.body, pose, dt );
			truck.group.visible = true;
			truck.group.position.set( pose.p[ 0 ], pose.p[ 1 ] - MODEL_OFFSET_Y, pose.p[ 2 ] );
			truck.group.quaternion.set( pose.q[ 0 ], pose.q[ 1 ], pose.q[ 2 ], pose.q[ 3 ] );

		}

	}

	// Follows the pose, or jumps straight there with no velocity when following would take a teleport's speed
	// (first placement from HIDDEN, a rematch, a network hiccup) — so nothing touching it gets flung.
	moveBody( body, pose, dt ) {

		if ( isTeleport( body.position, pose.p, dt ) ) {

			rigidBody.setPosition( this.world, body, pose.p, false );
			rigidBody.setLinearVelocity( this.world, body, [ 0, 0, 0 ] );
			return;

		}

		rigidBody.moveKinematic( body, pose.p, pose.q, dt );

	}

}
