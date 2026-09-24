// OsmHud.js — north-up minimap for every track, plus street names and OSM layers for OpenStreetMap
// tracks. No three.js: everything arrives as plain world coordinates (+X east, +Z south = down).

const MAP_W = 190, MAP_H = 130, PAD = 10;

const STYLE = `
	#minimap {
		position: absolute;
		top: 60px;
		right: 12px;
		width: ${ MAP_W }px;
		height: ${ MAP_H }px;
		background: rgba(10,12,14,0.55);
		border-radius: 12px;
		pointer-events: none;
		z-index: 10;
	}
	#minimap-note {
		position: absolute;
		top: ${ 60 + MAP_H + 6 }px;
		right: 12px;
		width: ${ MAP_W }px;
		color: #fff;
		font: 500 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		text-align: center;
		opacity: 0.75;
		pointer-events: none;
		z-index: 10;
	}
	#street-name {
		position: absolute;
		left: 50%;
		bottom: 56px;
		transform: translateX(-50%);
		padding: 6px 14px;
		border-radius: 999px;
		background: rgba(10,12,14,0.6);
		color: #fff;
		font: 600 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		white-space: nowrap;
		opacity: 0;
		transition: opacity 0.4s;
		pointer-events: none;
		z-index: 10;
	}
	#street-name.show { opacity: 1; }
	@media (max-width: 480px) {
		#minimap { width: 130px; height: 89px; }
		#minimap-note { top: 155px; width: 130px; }
	}
	@media (max-width: 760px) {
		#street-name { bottom: 102px; }
	}
`;

export class Hud {

	// cells: Track.js cells [[gx, gz, type], …] in any order; cellSize: world units per cell.
	constructor( cells, cellSize ) {

		this.cells = cells;
		this.cellSize = cellSize;
		this.index = null;
		this.streetName = null;
		this.layers = { streets: [], buildings: [] };

		const style = document.createElement( 'style' );
		style.textContent = STYLE;
		document.head.appendChild( style );

		this.canvas = document.createElement( 'canvas' );
		this.canvas.id = 'minimap';
		this.ctx = this.canvas.getContext( '2d' );
		document.body.appendChild( this.canvas );

		this.noteEl = document.createElement( 'div' );
		this.noteEl.id = 'minimap-note';
		document.body.appendChild( this.noteEl );

		this.streetEl = document.createElement( 'div' );
		this.streetEl.id = 'street-name';
		document.body.appendChild( this.streetEl );

		this.fitView();
		this.drawStatic();

	}

	// OSM layers in world coordinates: streets [{ pts }], buildings [{ ring }], index = StreetIndex.
	setOsm( { streets, buildings, index } ) {

		this.layers = { streets, buildings };
		this.index = index;
		this.drawStatic();

	}

	note( text ) {

		this.noteEl.textContent = text;

	}

	// World position of the car and its forward direction (unit vector on the ground plane).
	update( x, z, forwardX, forwardZ ) {

		this.drawCar( x, z, forwardX, forwardZ );
		if ( this.index ) this.showStreet( this.index.nameAt( x, z ) );

	}

	fitView() {

		let minX = Infinity, maxX = - Infinity, minZ = Infinity, maxZ = - Infinity;

		for ( const [ gx, gz ] of this.cells ) {

			minX = Math.min( minX, gx ); maxX = Math.max( maxX, gx + 1 );
			minZ = Math.min( minZ, gz ); maxZ = Math.max( maxZ, gz + 1 );

		}

		const s = this.cellSize;
		const w = ( maxX - minX + 2 ) * s, h = ( maxZ - minZ + 2 ) * s;
		this.scale = Math.min( ( MAP_W - 2 * PAD ) / w, ( MAP_H - 2 * PAD ) / h );
		this.originX = MAP_W / 2 - ( minX + maxX ) / 2 * s * this.scale;
		this.originZ = MAP_H / 2 - ( minZ + maxZ ) / 2 * s * this.scale;

	}

	toMap( x, z ) {

		return [ this.originX + x * this.scale, this.originZ + z * this.scale ];

	}

	// Streets, buildings and track tiles never change during a race: draw them once.
	drawStatic() {

		const dpr = window.devicePixelRatio || 1;
		const layer = document.createElement( 'canvas' );
		layer.width = MAP_W * dpr;
		layer.height = MAP_H * dpr;
		const ctx = layer.getContext( '2d' );
		ctx.scale( dpr, dpr );

		ctx.fillStyle = 'rgba(255,255,255,0.16)';
		for ( const { ring } of this.layers.buildings ) {

			ctx.beginPath();
			ring.forEach( ( [ x, z ], i ) => ctx[ i ? 'lineTo' : 'moveTo' ]( ...this.toMap( x, z ) ) );
			ctx.fill();

		}

		ctx.strokeStyle = 'rgba(255,255,255,0.35)';
		ctx.lineWidth = 1;
		for ( const { pts } of this.layers.streets ) {

			ctx.beginPath();
			pts.forEach( ( [ x, z ], i ) => ctx[ i ? 'lineTo' : 'moveTo' ]( ...this.toMap( x, z ) ) );
			ctx.stroke();

		}

		const size = Math.max( 1.5, this.cellSize * this.scale );
		for ( const [ gx, gz, type ] of this.cells ) {

			const [ mx, mz ] = this.toMap( gx * this.cellSize, gz * this.cellSize );
			ctx.fillStyle = type === 'track-finish' ? '#ffffff' : '#f2c94c';
			ctx.fillRect( mx, mz, size, size );

		}

		this.staticLayer = layer;
		this.canvas.width = MAP_W * dpr;
		this.canvas.height = MAP_H * dpr;
		this.dpr = dpr;

	}

	drawCar( x, z, fx, fz ) {

		const ctx = this.ctx;
		ctx.setTransform( 1, 0, 0, 1, 0, 0 );
		ctx.clearRect( 0, 0, this.canvas.width, this.canvas.height );
		ctx.drawImage( this.staticLayer, 0, 0 );
		ctx.scale( this.dpr, this.dpr );

		const [ mx, mz ] = this.toMap( x, z );
		const len = Math.hypot( fx, fz ) || 1;
		const ux = fx / len, uz = fz / len;

		ctx.fillStyle = '#ff6e3a';
		ctx.strokeStyle = '#fff';
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.moveTo( mx + ux * 7, mz + uz * 7 );
		ctx.lineTo( mx - ux * 4 - uz * 4.5, mz - uz * 4 + ux * 4.5 );
		ctx.lineTo( mx - ux * 4 + uz * 4.5, mz - uz * 4 - ux * 4.5 );
		ctx.closePath();
		ctx.fill();
		ctx.stroke();

	}

	showStreet( name ) {

		if ( name === this.streetName ) return;
		this.streetName = name;
		if ( name ) this.streetEl.textContent = name;
		this.streetEl.classList.toggle( 'show', !! name );

	}

}
