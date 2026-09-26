// Signal.js — manual WebRTC signaling codes and invite links (no server). Pure; runs in browsers and Node.
//
// A code is 'KR1.' + base64url( deflate-raw( JSON { t: type, s: sdp } ) ) — the same idea as
// Tschau Sepp's TS1 codes. An invite link is the game URL (with ?map= and &osm=) plus '#join=<code>'.

export const CODE_PREFIX = 'KR1.';
export const OFFER_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_LENGTH = 20000;

export class SignalError extends Error {}

function toBase64url( bytes ) {

	let binary = '';
	for ( let i = 0; i < bytes.length; i ++ ) binary += String.fromCharCode( bytes[ i ] );
	return btoa( binary ).replace( /\+/g, '-' ).replace( /\//g, '_' ).replace( /=+$/, '' );

}

function fromBase64url( str ) {

	const binary = atob( str.replace( /-/g, '+' ).replace( /_/g, '/' ) );
	const bytes = new Uint8Array( binary.length );
	for ( let i = 0; i < binary.length; i ++ ) bytes[ i ] = binary.charCodeAt( i );
	return bytes;

}

async function pipe( bytes, stream ) {

	return new Uint8Array( await new Response( new Blob( [ bytes ] ).stream().pipeThrough( stream ) ).arrayBuffer() );

}

// { type: 'offer' | 'answer', sdp } → 'KR1.…'
export async function encodeSignal( { type, sdp } ) {

	const raw = new TextEncoder().encode( JSON.stringify( { t: type, s: sdp } ) );
	return CODE_PREFIX + toBase64url( await pipe( raw, new CompressionStream( 'deflate-raw' ) ) );

}

// 'KR1.…' (whitespace tolerated) → { type, sdp }; throws SignalError for anything else.
export async function decodeSignal( code ) {

	const clean = String( code ?? '' ).replace( /\s+/g, '' );
	if ( ! clean.startsWith( CODE_PREFIX ) || clean.length > MAX_CODE_LENGTH ) throw new SignalError( 'invalid code' );

	let parsed;

	try {

		const bytes = await pipe( fromBase64url( clean.slice( CODE_PREFIX.length ) ), new DecompressionStream( 'deflate-raw' ) );
		parsed = JSON.parse( new TextDecoder().decode( bytes ) );

	} catch {

		throw new SignalError( 'invalid code' );

	}

	if ( ( parsed?.t !== 'offer' && parsed?.t !== 'answer' ) || typeof parsed.s !== 'string' ) throw new SignalError( 'invalid code' );
	return { type: parsed.t, sdp: parsed.s };

}

export function isOfferExpired( createdAt, now ) {

	return now - createdAt > OFFER_TTL_MS;

}

// Current page URL (keeps ?map= and &osm=, drops any old hash) + '#join=<code>'.
export function buildInviteLink( pageUrl, code ) {

	const url = new URL( pageUrl );
	url.hash = 'join=' + code;
	return url.href;

}

// location.hash → the offer code, or null when the page was not opened from an invite.
export function parseInviteHash( hash ) {

	const match = /^#?join=(KR1\.[A-Za-z0-9_-]+)$/.exec( String( hash ?? '' ) );
	return match ? match[ 1 ] : null;

}
