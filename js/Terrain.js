// Terrain.js — what lies under a world position on a tile track: the surface ('dirt' | 'asphalt') and the
// height of the road above the flat floor (profile pieces: ramp, tabletop, whoops). Used by the vehicle
// (grip, slope, airtime), the CPU trucks and effects. Pure (no three.js).

import { profileOf } from './Pieces.js';
import { isDirt } from './TrackCodec.js';

const ORIENT_DEG = { 0: 0, 10: 180, 16: 90, 22: 270 }; // same table as Track.js
const NORMAL_STEP = 0.05; // world units for the finite-difference slope

// t (0 → 1) of a world point along the cell's driving direction. Local +z turns like three.js
// rotation.y: forward = ( sin θ, cos θ ).
export function localT( cell, x, z, cellSize ) {

	const a = ( ORIENT_DEG[ cell[ 3 ] ] ?? 0 ) * Math.PI / 180;
	const dx = x - ( cell[ 0 ] + 0.5 ) * cellSize;
	const dz = z - ( cell[ 1 ] + 0.5 ) * cellSize;
	return ( dx * Math.sin( a ) + dz * Math.cos( a ) ) / cellSize + 0.5;

}

export function makeTerrain( cells, cellSize, gridScale ) {

	const byKey = new Map( cells.map( ( c ) => [ c[ 0 ] + ',' + c[ 1 ], c ] ) );
	const cellAt = ( x, z ) => byKey.get( Math.floor( x / cellSize ) + ',' + Math.floor( z / cellSize ) );

	function surfaceAt( x, z ) {

		const cell = cellAt( x, z );
		return cell && isDirt( cell ) ? 'dirt' : 'asphalt';

	}

	function heightAt( x, z ) {

		const cell = cellAt( x, z );
		const h = cell && profileOf( cell[ 2 ] );
		if ( ! h ) return 0;
		const t = Math.min( 1, Math.max( 0, localT( cell, x, z, cellSize ) ) );
		return h( t ) * gridScale;

	}

	function normalAt( x, z ) {

		const sx = ( heightAt( x + NORMAL_STEP, z ) - heightAt( x - NORMAL_STEP, z ) ) / ( 2 * NORMAL_STEP );
		const sz = ( heightAt( x, z + NORMAL_STEP ) - heightAt( x, z - NORMAL_STEP ) ) / ( 2 * NORMAL_STEP );
		const len = Math.hypot( sx, 1, sz );
		return [ - sx / len + 0, 1 / len, - sz / len + 0 ]; // + 0 turns -0 into 0

	}

	return { surfaceAt, heightAt, normalAt };

}
