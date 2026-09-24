// OsmTrack.js — turn OpenStreetMap roads into Starter-Kit-Racing track cells.
//
// Pipeline:
//   Overpass JSON → road graph (nodes + edges, metres)
//   waypoints → shortest paths along real streets → closed loop polyline
//   polyline → Douglas-Peucker simplify → 4-connected grid raster
//   raster → straight / corner / finish pieces with Godot orientation codes
//
// World mapping: +X = east, +Z = south (gz = -north). One grid cell = `metersPerCell` metres.
// Grid coordinates must stay within -128..127 because of the 1-byte cell codec in Track.js.

export const DEFAULT_HIGHWAYS = 'primary|secondary|tertiary|unclassified|residential|living_street|service|track';

// bbox = [south, west, north, east]. With { buildings: true } the query also returns building footprints.
export function overpassQuery( bbox, highways = DEFAULT_HIGHWAYS, { buildings = false } = {} ) {

	const [ s, w, n, e ] = bbox;
	const area = `(${ s },${ w },${ n },${ e })`;
	const houses = buildings ? `way["building"]${ area };` : '';
	return `[out:json][timeout:60];(way["highway"~"^(${ highways })$"]${ area };${ houses });out body;>;out skel qt;`;

}

// Tried in order. overpass.osm.ch only holds Switzerland but is rarely overloaded;
// the others are worldwide public mirrors.
export const OVERPASS_MIRRORS = [
	'https://overpass.osm.ch/api/interpreter',
	'https://overpass-api.de/api/interpreter',
	'https://overpass.kumi.systems/api/interpreter',
	'https://overpass.private.coffee/api/interpreter',
];

const CACHE_PREFIX = 'osm-track.cache.';

// Overpass answers HTTP 200 with a truncated result and a remark like "runtime error: Query timed out".
const PARTIAL_REMARK = /error|timed out|timeout/i;

function defaultStorage() {

	try { return globalThis.localStorage ?? null; } catch { return null; }

}

// Keeps a single cached answer: every other CACHE_PREFIX key is removed first, so the cache never
// crowds out other saves on a shared origin. Uses only standard Storage methods.
function storeOnly( storage, key, value ) {

	if ( ! storage ) return;

	const stale = [];

	for ( let i = 0; i < storage.length; i ++ ) {

		const k = storage.key( i );
		if ( k !== null && k !== key && k.startsWith( CACHE_PREFIX ) ) stale.push( k );

	}

	for ( const k of stale ) storage.removeItem( k );
	storage.setItem( key, value );

}

// Same query → same data: the latest answer is cached in storage (localStorage by default, null =
// no cache) so a flaky Overpass only has to answer once. onTry( host ) is called before each mirror.
// Resolves { osm, source }; rejects with every mirror's error when all fail.
export async function fetchOverpass( query, { storage = defaultStorage(), fetchImpl = globalThis.fetch, timeoutMs = 45000, onTry = () => {} } = {} ) {

	const key = CACHE_PREFIX + query;

	try {

		const cached = storage?.getItem( key );
		if ( cached ) return { osm: JSON.parse( cached ), source: 'cache' };

	} catch {}

	const errors = [];

	for ( const url of OVERPASS_MIRRORS ) {

		const host = new URL( url ).host;
		onTry( host );

		try {

			const controller = new AbortController();
			const timer = setTimeout( () => controller.abort(), timeoutMs );
			const res = await fetchImpl( url, { method: 'POST', body: 'data=' + encodeURIComponent( query ), signal: controller.signal } );
			clearTimeout( timer );
			if ( ! res.ok ) throw new Error( `HTTP ${ res.status }` );
			const osm = await res.json();
			if ( ! Array.isArray( osm.elements ) ) throw new Error( 'unexpected response' );
			if ( PARTIAL_REMARK.test( osm.remark ?? '' ) ) throw new Error( osm.remark );
			if ( osm.elements.length === 0 ) throw new Error( 'no data for this area' );

			try { storeOnly( storage, key, JSON.stringify( osm ) ); } catch {}

			return { osm, source: host };

		} catch ( e ) {

			errors.push( `${ host }: ${ e.name === 'AbortError' ? 'timeout' : e.message }` );

		}

	}

	throw new Error( errors.join( ' · ' ) );

}

// Equirectangular projection around the bbox centre. Good enough for a village.
export function makeProjection( bbox ) {

	const lat0 = ( bbox[ 0 ] + bbox[ 2 ] ) / 2;
	const lon0 = ( bbox[ 1 ] + bbox[ 3 ] ) / 2;
	const R = 6378137;
	const k = Math.cos( lat0 * Math.PI / 180 );
	const rad = Math.PI / 180;

	return ( lat, lon ) => ( {
		x: ( lon - lon0 ) * rad * R * k,
		y: ( lat - lat0 ) * rad * R,
	} );

}

export function buildGraph( osm, project ) {

	const nodes = new Map();

	for ( const el of osm.elements ) {

		if ( el.type !== 'node' ) continue;
		const p = project( el.lat, el.lon );
		nodes.set( el.id, { id: el.id, x: p.x, y: p.y, adj: [] } );

	}

	const ways = [];

	for ( const el of osm.elements ) {

		if ( el.type !== 'way' || ! el.nodes || ! el.tags?.highway ) continue; // roads only — buildings share the response

		const pts = [];

		for ( let i = 0; i < el.nodes.length; i ++ ) {

			const a = nodes.get( el.nodes[ i ] );
			if ( ! a ) continue;
			pts.push( a );

			if ( i > 0 ) {

				const b = nodes.get( el.nodes[ i - 1 ] );
				if ( ! b ) continue;
				const d = Math.hypot( a.x - b.x, a.y - b.y );
				a.adj.push( b.id, d );
				b.adj.push( a.id, d );

			}

		}

		ways.push( { id: el.id, name: el.tags?.name ?? '', highway: el.tags?.highway ?? '', pts } );

	}

	return { nodes, ways };

}

export function nearestNode( graph, x, y ) {

	let best = null, bestD = Infinity;

	for ( const n of graph.nodes.values() ) {

		if ( n.adj.length === 0 ) continue;
		const d = ( n.x - x ) ** 2 + ( n.y - y ) ** 2;
		if ( d < bestD ) { bestD = d; best = n; }

	}

	return best ? { node: best, dist: Math.sqrt( bestD ) } : null;

}

// Dijkstra with a small binary heap. Returns an array of node ids, or null if disconnected.
export function shortestPath( graph, fromId, toId ) {

	if ( fromId === toId ) return [ fromId ];

	const dist = new Map( [ [ fromId, 0 ] ] );
	const prev = new Map();
	const heap = [ [ 0, fromId ] ];

	const push = ( item ) => {

		heap.push( item );
		let i = heap.length - 1;
		while ( i > 0 ) {

			const p = ( i - 1 ) >> 1;
			if ( heap[ p ][ 0 ] <= heap[ i ][ 0 ] ) break;
			[ heap[ p ], heap[ i ] ] = [ heap[ i ], heap[ p ] ];
			i = p;

		}

	};

	const pop = () => {

		const top = heap[ 0 ];
		const last = heap.pop();
		if ( heap.length ) {

			heap[ 0 ] = last;
			let i = 0;
			for ( ;; ) {

				const l = 2 * i + 1, r = l + 1;
				let m = i;
				if ( l < heap.length && heap[ l ][ 0 ] < heap[ m ][ 0 ] ) m = l;
				if ( r < heap.length && heap[ r ][ 0 ] < heap[ m ][ 0 ] ) m = r;
				if ( m === i ) break;
				[ heap[ m ], heap[ i ] ] = [ heap[ i ], heap[ m ] ];
				i = m;

			}

		}

		return top;

	};

	while ( heap.length ) {

		const [ d, id ] = pop();
		if ( d > dist.get( id ) ) continue;
		if ( id === toId ) break;

		const adj = graph.nodes.get( id ).adj;

		for ( let i = 0; i < adj.length; i += 2 ) {

			const nid = adj[ i ];
			const nd = d + adj[ i + 1 ];

			if ( nd < ( dist.get( nid ) ?? Infinity ) ) {

				dist.set( nid, nd );
				prev.set( nid, id );
				push( [ nd, nid ] );

			}

		}

	}

	if ( ! dist.has( toId ) ) return null;

	const path = [ toId ];
	let cur = toId;

	while ( cur !== fromId ) {

		cur = prev.get( cur );
		path.push( cur );

	}

	return path.reverse();

}

// Route waypoint → waypoint → … → back to first waypoint. Returns { ids, missing } where
// missing lists waypoint indices whose leg could not be routed.
export function routeLoop( graph, waypointIds ) {

	const ids = [];
	const missing = [];
	const n = waypointIds.length;

	for ( let i = 0; i < n; i ++ ) {

		const leg = shortestPath( graph, waypointIds[ i ], waypointIds[ ( i + 1 ) % n ] );

		if ( ! leg ) { missing.push( i ); continue; }

		for ( let j = ( ids.length ? 1 : 0 ); j < leg.length; j ++ ) ids.push( leg[ j ] );

	}

	if ( ids.length > 1 && ids[ 0 ] === ids[ ids.length - 1 ] ) ids.pop();

	return { ids, missing };

}

// Douglas-Peucker on an open polyline of {x,y}.
export function simplifyPolyline( pts, tol ) {

	if ( tol <= 0 || pts.length < 3 ) return pts.slice();

	const keep = new Uint8Array( pts.length );
	keep[ 0 ] = keep[ pts.length - 1 ] = 1;
	const stack = [ [ 0, pts.length - 1 ] ];
	const tol2 = tol * tol;

	while ( stack.length ) {

		const [ a, b ] = stack.pop();
		const ax = pts[ a ].x, ay = pts[ a ].y;
		const dx = pts[ b ].x - ax, dy = pts[ b ].y - ay;
		const len2 = dx * dx + dy * dy;
		let maxD = 0, maxI = - 1;

		for ( let i = a + 1; i < b; i ++ ) {

			const px = pts[ i ].x - ax, py = pts[ i ].y - ay;
			let d;

			if ( len2 === 0 ) d = px * px + py * py;
			else {

				const t = Math.max( 0, Math.min( 1, ( px * dx + py * dy ) / len2 ) );
				const ex = px - t * dx, ey = py - t * dy;
				d = ex * ex + ey * ey;

			}

			if ( d > maxD ) { maxD = d; maxI = i; }

		}

		if ( maxD > tol2 ) {

			keep[ maxI ] = 1;
			stack.push( [ a, maxI ], [ maxI, b ] );

		}

	}

	return pts.filter( ( _, i ) => keep[ i ] );

}

// 4-connected Bresenham between two integer grid cells (inclusive of both ends).
export function line4( x0, z0, x1, z1 ) {

	const out = [];
	const dx = Math.abs( x1 - x0 ), dz = Math.abs( z1 - z0 );
	const sx = x0 < x1 ? 1 : - 1, sz = z0 < z1 ? 1 : - 1;
	let err = dx - dz;
	let x = x0, z = z0;

	for ( ;; ) {

		out.push( [ x, z ] );
		if ( x === x1 && z === z1 ) break;

		const e2 = 2 * err;

		if ( z === z1 || ( x !== x1 && e2 > - dz ) ) { err -= dz; x += sx; }
		else { err += dx; z += sz; }

	}

	return out;

}

// Axis-aligned "L": run the longer axis first, then the shorter one. One corner instead of a staircase.
export function lineL( x0, z0, x1, z1 ) {

	const dx = Math.abs( x1 - x0 ), dz = Math.abs( z1 - z0 );
	const mid = dx >= dz ? [ x1, z0 ] : [ x0, z1 ];
	const first = line4( x0, z0, mid[ 0 ], mid[ 1 ] );
	const second = line4( mid[ 0 ], mid[ 1 ], x1, z1 );
	return first.concat( second.slice( 1 ) );

}

// Closed polyline (metres, y = north) → closed list of 4-connected, self-consistent grid cells.
// mode: 'stairs' (Bresenham, follows the street closely), 'L' (one corner per segment, drives better)
// or 'auto' (L per segment, stairs where L would run into the loop; whole-loop stairs if that still cuts more).
// Returns { cells: [[gx,gz],…], duplicates: Set<'gx,gz'>, shortcuts } — shortcuts counts places where
// the loop hit a cell twice and was cut short (a tile can't be driven twice); duplicates should be empty.
export function rasterizeLoop( pts, metersPerCell, mode = 'stairs' ) {

	const grid = pts.map( ( p ) => [ Math.round( p.x / metersPerCell ), Math.round( - p.y / metersPerCell ) ] );

	if ( mode === 'auto' ) {

		const auto = resolveLoop( traceGrid( grid, autoSegment ) );
		const stairs = resolveLoop( traceGrid( grid, () => line4 ) );
		return auto.shortcuts > stairs.shortcuts ? stairs : auto;

	}

	const draw = mode === 'L' ? lineL : line4;
	return resolveLoop( traceGrid( grid, () => draw ) );

}

// Picks the segment drawer for 'auto': one corner unless that path hits a cell already in the loop.
function autoSegment( a, b, used ) {

	const seg = lineL( a[ 0 ], a[ 1 ], b[ 0 ], b[ 1 ] );
	return seg.slice( 1, - 1 ).some( ( [ x, z ] ) => used.has( x + ',' + z ) ) ? line4 : lineL;

}

// Walk the closed grid polyline; pick( a, b, usedCells ) returns the line function for each segment.
function traceGrid( grid, pick ) {

	const cells = [];
	const used = new Set();

	for ( let i = 0; i < grid.length; i ++ ) {

		const a = grid[ i ], b = grid[ ( i + 1 ) % grid.length ];
		const seg = pick( a, b, used )( a[ 0 ], a[ 1 ], b[ 0 ], b[ 1 ] );

		for ( let j = 0; j < seg.length - 1; j ++ ) {

			cells.push( seg[ j ] );
			used.add( seg[ j ][ 0 ] + ',' + seg[ j ][ 1 ] );

		}

	}

	return cells;

}

// cleanLoop, then cut the loop wherever it touches itself (keeping the longer side) until no cell repeats.
function resolveLoop( raw ) {

	let cells = cleanLoop( raw );
	let shortcuts = 0;

	for ( ;; ) {

		const firstAt = new Map();
		let cut = null;

		for ( let i = 0; i < cells.length && ! cut; i ++ ) {

			const k = cells[ i ][ 0 ] + ',' + cells[ i ][ 1 ];
			if ( firstAt.has( k ) ) cut = [ firstAt.get( k ), i ];
			else firstAt.set( k, i );

		}

		if ( ! cut ) break;

		const [ i, j ] = cut;
		cells = j - i <= cells.length / 2
			? cells.slice( 0, i + 1 ).concat( cells.slice( j + 1 ) ) // drop the detour i+1..j
			: cells.slice( i, j ); // keep only the detour
		cells = cleanLoop( cells );
		shortcuts ++;

	}

	const seen = new Set(), duplicates = new Set();

	for ( const [ gx, gz ] of cells ) {

		const k = gx + ',' + gz;
		if ( seen.has( k ) ) duplicates.add( k );
		seen.add( k );

	}

	return { cells, duplicates, shortcuts };

}

// Remove consecutive duplicates and "spikes" (A→B→A) from a closed cell loop.
export function cleanLoop( cells ) {

	let out = cells.slice();
	let changed = true;

	while ( changed && out.length > 2 ) {

		changed = false;
		const next = [];

		for ( let i = 0; i < out.length; i ++ ) {

			const prev = out[ ( i - 1 + out.length ) % out.length ];
			const cur = out[ i ];
			const nxt = out[ ( i + 1 ) % out.length ];

			if ( cur[ 0 ] === nxt[ 0 ] && cur[ 1 ] === nxt[ 1 ] ) { changed = true; continue; } // duplicate
			if ( prev[ 0 ] === nxt[ 0 ] && prev[ 1 ] === nxt[ 1 ] ) { changed = true; i ++; continue; } // spike: drop cur and nxt

			next.push( cur );

		}

		out = next;

	}

	return out;

}

// Godot orientation codes used by Track.js (ORIENT_DEG): 0 → 0°, 16 → 90°, 10 → 180°, 22 → 270°.
// Exit bitmask: N=8 S=4 E=2 W=1 (N = gz-1, S = gz+1, E = gx+1, W = gx-1) — same table as editor.html.
const PIECE_BY_EXITS = {
	12: [ 'track-straight', 0 ],  // N+S
	3:  [ 'track-straight', 16 ], // E+W
	5:  [ 'track-corner', 0 ],    // S+W
	6:  [ 'track-corner', 16 ],   // S+E
	10: [ 'track-corner', 10 ],   // N+E
	9:  [ 'track-corner', 22 ],   // N+W
};

// Spawn heading: vehicle forward is +Z rotated by ORIENT_DEG → 0: south, 10: north, 16: east, 22: west.
const FINISH_ORIENT_BY_DIR = { '0,1': 0, '0,-1': 10, '1,0': 16, '-1,0': 22 };

function exitBit( from, to ) {

	const dx = to[ 0 ] - from[ 0 ], dz = to[ 1 ] - from[ 1 ];
	if ( dx === 1 && dz === 0 ) return 2;
	if ( dx === - 1 && dz === 0 ) return 1;
	if ( dx === 0 && dz === 1 ) return 4;
	if ( dx === 0 && dz === - 1 ) return 8;
	throw new Error( `Cells ${ from } and ${ to } are not 4-adjacent` );

}

// Grid offset that centres a loop on the codec's -128..127 range: { offX, offZ, width, height }.
export function loopCenter( loop ) {

	let minX = Infinity, maxX = - Infinity, minZ = Infinity, maxZ = - Infinity;

	for ( const [ gx, gz ] of loop ) {

		minX = Math.min( minX, gx ); maxX = Math.max( maxX, gx );
		minZ = Math.min( minZ, gz ); maxZ = Math.max( maxZ, gz );

	}

	return {
		offX: Math.round( ( minX + maxX ) / 2 ),
		offZ: Math.round( ( minZ + maxZ ) / 2 ),
		width: maxX - minX + 1,
		height: maxZ - minZ + 1,
	};

}

// Closed cell loop → Track.js cells [[gx, gz, type, orient], …], centred on the grid,
// finish line on the first straight cell, driving direction = loop order.
export function loopToTrackCells( loop ) {

	if ( loop.length < 4 ) throw new Error( 'Loop is too short — need at least 4 cells' );

	const { offX, offZ, width, height } = loopCenter( loop );

	if ( width > 256 || height > 256 ) {

		throw new Error( `Track spans ${ width }×${ height } cells; the map format allows 256×256. Increase metres per cell.` );

	}

	const n = loop.length;
	const cells = [];
	let finishSet = false;

	for ( let i = 0; i < n; i ++ ) {

		const prev = loop[ ( i - 1 + n ) % n ], cur = loop[ i ], nxt = loop[ ( i + 1 ) % n ];
		const exits = exitBit( cur, prev ) | exitBit( cur, nxt );
		let [ type, orient ] = PIECE_BY_EXITS[ exits ];

		if ( ! finishSet && type === 'track-straight' ) {

			type = 'track-finish';
			orient = FINISH_ORIENT_BY_DIR[ ( nxt[ 0 ] - cur[ 0 ] ) + ',' + ( nxt[ 1 ] - cur[ 1 ] ) ];
			finishSet = true;

		}

		cells.push( [ cur[ 0 ] - offX, cur[ 1 ] - offZ, type, orient ] );

	}

	// Put the finish cell first so computeSpawnPosition finds it immediately
	const fi = cells.findIndex( ( c ) => c[ 2 ] === 'track-finish' );
	if ( fi > 0 ) cells.unshift( ...cells.splice( fi ) );

	return cells;

}

export function trackStats( cells, metersPerCell ) {

	let straight = 0, corner = 0;
	for ( const c of cells ) ( c[ 2 ] === 'track-corner' ? corner ++ : straight ++ );
	return { cells: cells.length, straight, corner, lengthMeters: cells.length * metersPerCell };

}

// ── Codec (mirrors Track.js exactly, so this module has no three.js dependency) ──
const TYPE_INDEX = { 'track-straight': 0, 'track-corner': 1, 'track-bump': 2, 'track-finish': 3 };
const GODOT_TO_ORIENT = { 0: 0, 16: 1, 10: 2, 22: 3 };

export function encodeTrackCells( cells ) {

	const bytes = new Uint8Array( cells.length * 3 );

	for ( let i = 0; i < cells.length; i ++ ) {

		const [ gx, gz, name, godotOrient ] = cells[ i ];
		bytes[ i * 3 ] = gx + 128;
		bytes[ i * 3 + 1 ] = gz + 128;
		bytes[ i * 3 + 2 ] = ( ( TYPE_INDEX[ name ] ?? 0 ) << 2 ) | ( GODOT_TO_ORIENT[ godotOrient ] ?? 0 );

	}

	let binary = '';
	for ( let i = 0; i < bytes.length; i ++ ) binary += String.fromCharCode( bytes[ i ] );
	return btoa( binary ).replace( /\+/g, '-' ).replace( /\//g, '_' ).replace( /=+$/, '' );

}

// ── Frame selection: drive around the outside of everything inside a rectangle ──
//
// rect = { x0, y0, x1, y1 } in metres (any corner order). Streets are clipped to the
// rectangle, dead ends are pruned until only cycles remain, then the outer face of the
// remaining planar street graph is walked clockwise (interior kept on the right).
// Returns { ids, error } — ids is a closed loop of node ids (first != last).
export function perimeterLoop( graph, rect ) {

	const minX = Math.min( rect.x0, rect.x1 ), maxX = Math.max( rect.x0, rect.x1 );
	const minY = Math.min( rect.y0, rect.y1 ), maxY = Math.max( rect.y0, rect.y1 );

	// Clipped adjacency: id -> Set of neighbour ids inside the rect
	const adj = new Map();

	for ( const n of graph.nodes.values() ) {

		if ( n.x < minX || n.x > maxX || n.y < minY || n.y > maxY ) continue;
		adj.set( n.id, new Set() );

	}

	for ( const [ id, set ] of adj ) {

		const a = graph.nodes.get( id ).adj;
		for ( let i = 0; i < a.length; i += 2 ) if ( adj.has( a[ i ] ) && a[ i ] !== id ) set.add( a[ i ] );

	}

	// Prune dead ends (2-core)
	let queue = [ ...adj ].filter( ( [ , s ] ) => s.size < 2 ).map( ( [ id ] ) => id );

	while ( queue.length ) {

		const id = queue.pop();
		const set = adj.get( id );
		if ( ! set ) continue;
		for ( const nid of set ) {

			const ns = adj.get( nid );
			ns.delete( id );
			if ( ns.size < 2 ) queue.push( nid );

		}

		adj.delete( id );

	}

	if ( adj.size === 0 ) return { ids: [], error: 'No closed loop of streets inside the frame — draw a larger one' };

	// Largest connected component
	const seen = new Set();
	let best = [];

	for ( const start of adj.keys() ) {

		if ( seen.has( start ) ) continue;
		const comp = [];
		const stack = [ start ];
		seen.add( start );

		while ( stack.length ) {

			const id = stack.pop();
			comp.push( id );
			for ( const nid of adj.get( id ) ) if ( ! seen.has( nid ) ) { seen.add( nid ); stack.push( nid ); }

		}

		if ( comp.length > best.length ) best = comp;

	}

	const P = ( id ) => graph.nodes.get( id );

	// Start at the leftmost node (lowest y as tie-break) — guaranteed to be on the outer face
	let start = best[ 0 ];
	for ( const id of best ) {

		const a = P( id ), b = P( start );
		if ( a.x < b.x || ( a.x === b.x && a.y < b.y ) ) start = id;

	}

	// First edge: most counter-clockwise neighbour (all neighbours are to the right of the leftmost node)
	let first = null, firstAngle = - Infinity;
	for ( const nid of adj.get( start ) ) {

		const s = P( start ), n = P( nid );
		const ang = Math.atan2( n.y - s.y, n.x - s.x );
		if ( ang > firstAngle ) { firstAngle = ang; first = nid; }

	}

	// Walk: at every node take the left-most turn (largest CCW angle) that isn't a U-turn
	const ids = [ start ];
	let prev = start, cur = first;
	const maxSteps = best.length * 4 + 10;

	while ( ! ( cur === start && prev !== start ) || ids.length === 1 ) {

		if ( ids.length > maxSteps ) return { ids: [], error: 'Could not close the loop — try a different frame' };

		ids.push( cur );
		const p = P( prev ), c = P( cur );
		const dx = c.x - p.x, dy = c.y - p.y;
		let next = null, nextTurn = - Infinity, back = null;

		for ( const nid of adj.get( cur ) ) {

			if ( nid === prev ) { back = nid; continue; }
			const n = P( nid );
			const ex = n.x - c.x, ey = n.y - c.y;
			const turn = Math.atan2( dx * ey - dy * ex, dx * ex + dy * ey );
			if ( turn > nextTurn ) { nextTurn = turn; next = nid; }

		}

		prev = cur;
		cur = next ?? back;
		if ( cur === start ) break;

	}

	// The outer face runs along bridges and through cut vertices twice (e.g. two blocks joined
	// by one street). Tiles can't repeat, so keep only the longest simple cycle of the walk.
	return { ids: longestSimpleCycle( ids, P ), error: null };

}

// Split a closed walk of node ids into simple cycles; return the one with the longest perimeter.
export function longestSimpleCycle( ids, P ) {

	const stack = [];
	const pos = new Map();
	let best = [], bestLen = - 1;

	const take = ( cycle ) => {

		if ( cycle.length < 3 ) return;
		let len = 0;
		for ( let i = 0; i < cycle.length; i ++ ) {

			const a = P( cycle[ i ] ), b = P( cycle[ ( i + 1 ) % cycle.length ] );
			len += Math.hypot( b.x - a.x, b.y - a.y );

		}

		if ( len > bestLen ) { bestLen = len; best = cycle; }

	};

	for ( const id of [ ...ids, ids[ 0 ] ] ) {

		if ( pos.has( id ) ) {

			const cycle = stack.splice( pos.get( id ) + 1 );
			for ( const c of cycle ) pos.delete( c );
			take( [ id, ...cycle ] );

		} else {

			pos.set( id, stack.length );
			stack.push( id );

		}

	}

	return best;

}
