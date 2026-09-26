// Protocol.js — multiplayer messages and the validator every inbound message must pass. Pure.
//
// Messages are JSON objects with a `type`. Session drops malformed ones (and disconnects a peer after
// too many) but only ignores a `state` outside the track area. Unknown extra fields are ignored.

export const MAX_MESSAGE_CHARS = 2048;
export const MAX_SETUP_CHARS = 16384;   // setup carries the ?map= string, up to ~1500 cells
export const MAX_NAME = 16;
export const MAX_PLAYERS = 4;
export const MAX_LAPS = 10;
const MAX_SPEED = 100;                  // world units per second, far above anything the truck reaches
const MAX_TIME = 36000;                 // seconds

const isInt = ( v, min, max ) => Number.isInteger( v ) && v >= min && v <= max;
const isNum = ( v, min, max ) => typeof v === 'number' && Number.isFinite( v ) && v >= min && v <= max;
const isStr = ( v, min, max ) => typeof v === 'string' && v.length >= min && v.length <= max;
const isId = ( v ) => typeof v === 'string' && /^[a-z0-9]{1,8}$/.test( v );
const isVec = ( v, n, limit ) => Array.isArray( v ) && v.length === n && v.every( ( x ) => isNum( x, - limit, limit ) );

// Trimmed, control characters removed, 1–16 characters — or null.
export function cleanName( name ) {

	if ( typeof name !== 'string' ) return null;
	const clean = name.replace( /[\x00-\x1f\u007f]/g, '' ).trim();
	return clean.length >= 1 && clean.length <= MAX_NAME ? clean : null;

}

function inBounds( p, bounds ) {

	return p[ 0 ] >= bounds.minX && p[ 0 ] <= bounds.maxX && p[ 2 ] >= bounds.minZ && p[ 2 ] <= bounds.maxZ && Math.abs( p[ 1 ] ) <= 50;

}

const VALIDATORS = {

	hello: ( m ) => cleanName( m.name ) === m.name,
	roster: ( m ) => isId( m.you ) && Array.isArray( m.players ) && m.players.length <= MAX_PLAYERS &&
		m.players.every( ( p ) => isId( p.id ) && cleanName( p.name ) === p.name && isInt( p.slot, 0, MAX_PLAYERS - 1 ) && typeof p.connected === 'boolean' ),
	setup: ( m ) => isStr( m.map, 4, MAX_SETUP_CHARS - 200 ) && /^[A-Za-z0-9_-]+$/.test( m.map ) &&
		( m.osm === null || ( isStr( m.osm, 13, 120 ) && /^[-0-9.,]+$/.test( m.osm ) ) ) &&
		isInt( m.laps, 1, MAX_LAPS ) && isInt( m.startIn, 0, 10000 ),
	ping: ( m ) => isNum( m.t, 0, Number.MAX_SAFE_INTEGER ),
	pong: ( m ) => isNum( m.t, 0, Number.MAX_SAFE_INTEGER ),
	state: ( m ) => isId( m.id ) && isVec( m.p, 3, 1e6 ) && isVec( m.q, 4, 1.01 ) &&
		isVec( m.v, 3, MAX_SPEED ) && isInt( m.lap, 0, MAX_LAPS + 1 ) && isNum( m.progress, 0, 1 ),
	lap: ( m ) => isInt( m.lap, 1, MAX_LAPS ) && isNum( m.time, 0.001, MAX_TIME ),
	finish: ( m ) => isNum( m.total, 0.001, MAX_TIME ) && isNum( m.best, 0.001, MAX_TIME ),
	results: ( m ) => Array.isArray( m.rows ) && m.rows.length <= MAX_PLAYERS && m.rows.every( ( r ) => isId( r.id ) &&
		cleanName( r.name ) === r.name && isInt( r.place, 1, MAX_PLAYERS ) &&
		( r.total === null || isNum( r.total, 0.001, MAX_TIME ) ) && ( r.best === null || isNum( r.best, 0.001, MAX_TIME ) ) ),
	rematch: () => true,
	leave: ( m ) => isId( m.id ),

};

// Is this object a well-formed message? Positions are not checked against the track area here.
function wellFormed( msg ) {

	if ( msg === null || typeof msg !== 'object' || Array.isArray( msg ) ) return false;
	const check = Object.hasOwn( VALIDATORS, msg.type ) ? VALIDATORS[ msg.type ] : null;
	if ( ! check ) return false;

	try {

		return check( msg ) === true;

	} catch {

		return false;

	}

}

// A well-formed `state` whose truck is outside the track area (it drove or fell off the map).
function outOfBounds( msg, bounds ) {

	return msg.type === 'state' && ! inBounds( msg.p, bounds );

}

// Is this object a well-formed message? bounds = { minX, maxX, minZ, maxZ } in world units (for `state`).
export function validate( msg, bounds ) {

	return wellFormed( msg ) && ! outOfBounds( msg, bounds );

}

// Raw text → parsed JSON within the size limits, or null.
function decode( text ) {

	if ( typeof text !== 'string' || text.length > MAX_SETUP_CHARS ) return null;

	let msg;

	try {

		msg = JSON.parse( text );

	} catch {

		return null;

	}

	if ( text.length > MAX_MESSAGE_CHARS && msg?.type !== 'setup' ) return null;
	return msg;

}

// Raw data-channel text → { kind: 'deliver', msg }, { kind: 'ignore' } for a well-formed `state`
// outside the track area (not the sender's fault), or { kind: 'drop' } for anything malformed.
export function readMessage( text, bounds ) {

	const msg = decode( text );
	if ( ! wellFormed( msg ) ) return { kind: 'drop' };
	if ( outOfBounds( msg, bounds ) ) return { kind: 'ignore' };
	return { kind: 'deliver', msg };

}

// Raw data-channel text → validated message, or null.
export function parseMessage( text, bounds ) {

	const read = readMessage( text, bounds );
	return read.kind === 'deliver' ? read.msg : null;

}
