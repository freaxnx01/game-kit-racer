// GhostCar.js — the see-through truck that replays your best lap. Visual only: no physics body,
// so you drive straight through it, and it casts no shadow.

import * as THREE from 'three';

const OPACITY = 0.35;

export class GhostCar {

	// model: the same loaded truck model the player's Vehicle uses.
	constructor( scene, model ) {

		this.group = new THREE.Group();
		this.group.add( model.clone() );
		this.group.traverse( ( child ) => {

			if ( ! child.isMesh ) return;
			child.material = child.material.clone();
			child.material.transparent = true;
			child.material.opacity = OPACITY;
			child.material.depthWrite = false;
			child.castShadow = false;
			child.receiveShadow = false;

		} );
		this.group.visible = false;
		scene.add( this.group );

	}

	// pose: { p: [x,y,z], q: [x,y,z,w] } in the player's container space (as recorded), or null to hide.
	setPose( pose ) {

		this.group.visible = pose !== null;
		if ( ! pose ) return;
		this.group.position.set( pose.p[ 0 ], pose.p[ 1 ], pose.p[ 2 ] );
		this.group.quaternion.set( pose.q[ 0 ], pose.q[ 1 ], pose.q[ 2 ], pose.q[ 3 ] );

	}

}
