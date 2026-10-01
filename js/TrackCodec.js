// TrackCodec.js — ?map= strings ↔ track cells. Three bytes per cell: gx+128, gz+128, and
// dirt (bit 7) | type index (bits 2–6, see Pieces.js) | orientation (bits 0–1). Maps written before
// the new pieces only used bits 0–3, so they decode unchanged. Pure (no three.js).

import { PIECES, TYPE_BY_INDEX } from './Pieces.js';

const ORIENT_TO_GODOT = [ 0, 16, 10, 22 ];
const GODOT_TO_ORIENT = { 0: 0, 16: 1, 10: 2, 22: 3 };
const DIRT_BIT = 0x80;

export const TYPE_NAMES = TYPE_BY_INDEX;

export function isDirt( cell ) {

	return cell[ 4 ]?.dirt === true;

}

export function encodeCells( cells ) {

	const bytes = new Uint8Array( cells.length * 3 );

	for ( let i = 0; i < cells.length; i ++ ) {

		const [ gx, gz, name, godotOrient ] = cells[ i ];
		const ti = PIECES[ name ]?.index ?? 0;
		const oi = GODOT_TO_ORIENT[ godotOrient ] ?? 0;

		bytes[ i * 3 ] = gx + 128;
		bytes[ i * 3 + 1 ] = gz + 128;
		bytes[ i * 3 + 2 ] = ( isDirt( cells[ i ] ) ? DIRT_BIT : 0 ) | ( ti << 2 ) | oi;

	}

	return bytesToBase64url( bytes );

}

export function decodeCells( str ) {

	const bytes = base64urlToBytes( str );
	const cells = [];

	for ( let i = 0; i + 2 < bytes.length; i += 3 ) {

		const packed = bytes[ i + 2 ];
		const type = TYPE_BY_INDEX[ ( packed >> 2 ) & 0x1f ] ?? 'track-straight';
		const cell = [ bytes[ i ] - 128, bytes[ i + 1 ] - 128, type, ORIENT_TO_GODOT[ packed & 0x03 ] ];
		if ( packed & DIRT_BIT ) cell.push( { dirt: true } );
		cells.push( cell );

	}

	return cells;

}

function bytesToBase64url( bytes ) {

	let binary = '';
	for ( let i = 0; i < bytes.length; i ++ ) binary += String.fromCharCode( bytes[ i ] );

	return btoa( binary ).replace( /\+/g, '-' ).replace( /\//g, '_' ).replace( /=+$/, '' );

}

function base64urlToBytes( str ) {

	const base64 = str.replace( /-/g, '+' ).replace( /_/g, '/' );
	const binary = atob( base64 );
	const bytes = new Uint8Array( binary.length );
	for ( let i = 0; i < binary.length; i ++ ) bytes[ i ] = binary.charCodeAt( i );

	return bytes;

}
