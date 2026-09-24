// Run: node --test test/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, parseMessage, cleanName, MAX_MESSAGE_CHARS } from '../js/net/Protocol.js';

const BOUNDS = { minX: - 50, maxX: 50, minZ: - 50, maxZ: 50 };

const VALID = {
	hello: { type: 'hello', name: 'Speedy' },
	roster: { type: 'roster', you: 'g1', players: [ { id: 'h', name: 'Ana', slot: 0, connected: true }, { id: 'g1', name: 'Bo', slot: 1, connected: false } ] },
	setup: { type: 'setup', map: 'fYYNfoYBf4YB', osm: '47.548,7.98,47.556,7.995,10,-1,-3', laps: 3, startIn: 3000 },
	ping: { type: 'ping', t: 1234.5 },
	pong: { type: 'pong', t: 1234.5 },
	state: { type: 'state', id: 'g2', p: [ 1, 0.5, - 3 ], q: [ 0, 0.7071, 0, 0.7071 ], v: [ 3, 0, - 1 ], lap: 2, progress: 0.4 },
	lap: { type: 'lap', lap: 1, time: 31.2 },
	finish: { type: 'finish', total: 95.4, best: 30.9 },
	results: { type: 'results', rows: [ { id: 'h', name: 'Ana', place: 1, total: 95.4, best: 30.9 }, { id: 'g1', name: 'Bo', place: 2, total: null, best: null } ] },
	rematch: { type: 'rematch' },
	leave: { type: 'leave', id: 'g3' },
};

test( 'validate_everyMessageType_acceptsWellFormed', () => {

	for ( const [ type, msg ] of Object.entries( VALID ) ) assert.equal( validate( msg, BOUNDS ), true, type );
	assert.equal( validate( { ...VALID.setup, osm: null }, BOUNDS ), true, 'setup without osm' );

} );

test( 'validate_malformedVariants_areRejected', () => {

	const bad = [
		null, 42, 'hello', [], {}, { type: 'nope' }, { type: 'constructor' }, { type: '__proto__' },
		{ ...VALID.hello, name: '' }, { ...VALID.hello, name: 'x'.repeat( 17 ) }, { ...VALID.hello, name: ' padded ' }, { ...VALID.hello, name: 7 },
		{ ...VALID.roster, you: 'G1!' }, { ...VALID.roster, players: new Array( 5 ).fill( VALID.roster.players[ 0 ] ) },
		{ ...VALID.roster, players: [ { ...VALID.roster.players[ 0 ], slot: 4 } ] },
		{ ...VALID.setup, map: 'abc<script>' }, { ...VALID.setup, laps: 0 }, { ...VALID.setup, laps: 11 }, { ...VALID.setup, startIn: - 1 },
		{ ...VALID.setup, osm: 'javascript:alert(1)' },
		{ ...VALID.ping, t: 'now' }, { ...VALID.pong, t: NaN },
		{ ...VALID.state, p: [ 1, 0.5 ] }, { ...VALID.state, p: [ 999, 0.5, 0 ] }, { ...VALID.state, p: [ 0, 99, 0 ] },
		{ ...VALID.state, q: [ 0, 2, 0, 0 ] }, { ...VALID.state, v: [ 500, 0, 0 ] }, { ...VALID.state, v: [ NaN, 0, 0 ] },
		{ ...VALID.state, progress: 1.5 }, { ...VALID.state, lap: 1.5 }, { ...VALID.state, id: '' },
		{ ...VALID.lap, lap: 0 }, { ...VALID.lap, time: 0 }, { ...VALID.lap, time: Infinity },
		{ ...VALID.finish, best: - 1 },
		{ ...VALID.results, rows: [ { ...VALID.results.rows[ 0 ], place: 0 } ] }, { ...VALID.results, rows: 'x' },
		{ ...VALID.leave, id: 'no spaces' },
	];
	bad.forEach( ( msg, i ) => assert.equal( validate( msg, BOUNDS ), false, `#${ i } ${ JSON.stringify( msg )?.slice( 0, 60 ) }` ) );

} );

test( 'parseMessage_invalidJsonOrOversized_returnsNull', () => {

	assert.equal( parseMessage( '{not json', BOUNDS ), null );
	assert.equal( parseMessage( 42, BOUNDS ), null );
	assert.equal( parseMessage( JSON.stringify( { type: 'hello', name: 'Bo', pad: 'x'.repeat( MAX_MESSAGE_CHARS ) } ), BOUNDS ), null );
	assert.deepEqual( parseMessage( JSON.stringify( VALID.lap ), BOUNDS ), VALID.lap );

} );

test( 'parseMessage_largeSetup_isAllowedUpToItsOwnLimit', () => {

	const big = { ...VALID.setup, map: 'A'.repeat( 6000 ) };
	assert.deepEqual( parseMessage( JSON.stringify( big ), BOUNDS ), big );
	assert.equal( parseMessage( JSON.stringify( { ...big, map: 'A'.repeat( 17000 ) } ), BOUNDS ), null );

} );

test( 'cleanName_controlCharactersAndSpaces_areStripped', () => {

	assert.equal( cleanName( '  Bo\n ' ), 'Bo' );
	assert.equal( cleanName( '   ' ), null );
	assert.equal( cleanName( 'Zoë Müller' ), 'Zoë Müller' );

} );
