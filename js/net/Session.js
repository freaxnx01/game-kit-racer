// Session.js — WebRTC peers for a star-shaped race: the host holds one connection per guest, a guest
// holds one connection to the host. Signaling is manual (Signal.js codes); every inbound message
// passes Protocol.parseMessage before anyone sees it.

import { encodeSignal, decodeSignal, isOfferExpired, SignalError } from './Signal.js';
import { parseMessage } from './Protocol.js';

export const ICE_SERVERS = [ { urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' } ];
const ICE_GATHER_MS = 3500;
const MAX_DROPS = 20;
const DISCONNECT_GRACE_MS = 5000;

// Resolves once ICE gathering is complete, or after ICE_GATHER_MS with whatever was gathered.
function iceGathered( pc ) {

	return new Promise( ( resolve ) => {

		if ( pc.iceGatheringState === 'complete' ) return resolve();
		const timer = setTimeout( resolve, ICE_GATHER_MS );
		pc.addEventListener( 'icegatheringstatechange', () => {

			if ( pc.iceGatheringState !== 'complete' ) return;
			clearTimeout( timer );
			resolve();

		} );

	} );

}

export class Session {

	// bounds: world rectangle for Protocol's `state` check (can be replaced later via session.bounds).
	// onMessage( peerId, msg ), onOpen( peerId ), onClose( peerId, reason ) — reason: 'closed' | 'failed' | 'invalid'.
	constructor( { bounds, onMessage, onOpen, onClose, iceServers = ICE_SERVERS, now = () => Date.now() } ) {

		this.bounds = bounds;
		this.onMessage = onMessage;
		this.onOpen = onOpen;
		this.onClose = onClose;
		this.iceServers = iceServers;
		this.now = now;
		this.peers = new Map(); // id → { pc, channel, drops, createdAt, closed, graceTimer }

	}

	// Host: a fresh offer code for the guest who will be known as peerId (replaces an older one).
	async createOffer( peerId ) {

		this.close( peerId, false );
		const pc = new RTCPeerConnection( { iceServers: this.iceServers } );
		const peer = this.track( peerId, pc );
		this.wire( peerId, peer, pc.createDataChannel( 'race', { ordered: true } ) );
		await pc.setLocalDescription( await pc.createOffer() );
		await iceGathered( pc );
		return encodeSignal( pc.localDescription );

	}

	// Host: apply the guest's answer. Throws SignalError('expired' | 'invalid code').
	async acceptAnswer( peerId, code ) {

		const peer = this.peers.get( peerId );
		if ( ! peer || peer.closed ) throw new SignalError( 'invalid code' );
		if ( isOfferExpired( peer.createdAt, this.now() ) ) throw new SignalError( 'expired' );
		const desc = await decodeSignal( code );
		if ( desc.type !== 'answer' ) throw new SignalError( 'invalid code' );
		await peer.pc.setRemoteDescription( desc );

	}

	// Guest: answer the host's offer code; the host becomes peer 'h'. Returns the answer code.
	async answerOffer( code ) {

		const desc = await decodeSignal( code );
		if ( desc.type !== 'offer' ) throw new SignalError( 'invalid code' );
		this.close( 'h', false );
		const pc = new RTCPeerConnection( { iceServers: this.iceServers } );
		const peer = this.track( 'h', pc );
		pc.addEventListener( 'datachannel', ( e ) => this.wire( 'h', peer, e.channel ) );
		await pc.setRemoteDescription( desc );
		await pc.setLocalDescription( await pc.createAnswer() );
		await iceGathered( pc );
		return encodeSignal( pc.localDescription );

	}

	send( peerId, msg ) {

		const channel = this.peers.get( peerId )?.channel;
		if ( channel?.readyState !== 'open' ) return;

		try {

			channel.send( JSON.stringify( msg ) );

		} catch {} // a closing channel throws; the close handler reports it

	}

	broadcast( msg, exceptId = null ) {

		for ( const id of this.peers.keys() ) if ( id !== exceptId ) this.send( id, msg );

	}

	openPeers() {

		return [ ...this.peers ].filter( ( [ , p ] ) => p.channel?.readyState === 'open' ).map( ( [ id ] ) => id );

	}

	// Close one peer; notify = false for silent replacement (e.g. a regenerated invite).
	close( peerId, notify = true, reason = 'closed' ) {

		const peer = this.peers.get( peerId );
		if ( ! peer ) return;
		this.peers.delete( peerId );
		peer.closed = true;
		clearTimeout( peer.graceTimer );
		try { peer.channel?.close(); } catch {}
		try { peer.pc.close(); } catch {}
		if ( notify && peer.opened ) this.onClose( peerId, reason );

	}

	closeAll() {

		for ( const id of [ ...this.peers.keys() ] ) this.close( id, false );

	}

	track( peerId, pc ) {

		const peer = { pc, channel: null, drops: 0, createdAt: this.now(), closed: false, opened: false, graceTimer: null };
		this.peers.set( peerId, peer );

		pc.addEventListener( 'connectionstatechange', () => {

			if ( peer.closed ) return;
			if ( pc.connectionState === 'failed' ) this.close( peerId, true, 'failed' );

			if ( pc.connectionState === 'disconnected' ) {

				clearTimeout( peer.graceTimer );
				peer.graceTimer = setTimeout( () => {

					if ( pc.connectionState === 'disconnected' ) this.close( peerId, true, 'failed' );

				}, DISCONNECT_GRACE_MS );

			}

		} );

		return peer;

	}

	wire( peerId, peer, channel ) {

		peer.channel = channel;

		// A received channel can already be open; either way onOpen fires exactly once per peer.
		const opened = () => {

			if ( peer.opened || peer.closed ) return;
			peer.opened = true;
			this.onOpen( peerId );

		};

		channel.addEventListener( 'open', opened );
		if ( channel.readyState === 'open' ) queueMicrotask( opened );

		channel.addEventListener( 'close', () => {

			if ( ! peer.closed ) this.close( peerId, true, 'closed' );

		} );

		channel.addEventListener( 'message', ( e ) => {

			const msg = parseMessage( e.data, this.bounds );

			if ( msg ) return this.onMessage( peerId, msg );
			if ( ++ peer.drops > MAX_DROPS ) this.close( peerId, true, 'invalid' );

		} );

	}

}
