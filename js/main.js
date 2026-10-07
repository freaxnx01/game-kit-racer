import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';
import { LightProbeGridHelper } from 'three/addons/helpers/LightProbeGridHelper.js';
import { createWorldSettings, createWorld, addBroadphaseLayer, addObjectLayer, enableCollision, registerAll, updateWorld, rigidBody, box, MotionType } from 'crashcat';
import { Vehicle, MAX_SPEED } from './Vehicle.js';
import { Camera } from './Camera.js';
import { SpinHold } from './SpinHold.js';
import { Controls } from './Controls.js';
import { buildTrack, decodeCells, encodeCells, computeSpawnPosition, computeTrackBounds, addProfileModels, TRACK_CELLS, CELL_RAW, GRID_SCALE } from './Track.js';
import { makeTerrain } from './Terrain.js';
import { pieceModelNames } from './Pieces.js';
import { buildWallColliders, createSphereBody } from './Physics.js';
import { SmokeTrails } from './Particles.js';
import { smokeEmits, dustEmits } from './SurfaceFx.js';
import { isWallImpact } from './ContactFx.js';
import { DriftMarks } from './DriftMarks.js';
import { GameAudio } from './Audio.js';
import { LapTimer } from './LapTimer.js';
import { ColorMapGLTFLoader } from './Loader.js';
import { Hud } from './OsmHud.js';
import { parseOsmParam, viewArea } from './OsmData.js';
import { loadSurroundings, VIEW_MARGIN_CELLS } from './OsmScene.js';
import { GhostRun, ghostStorageKey, loadGhost, saveGhost } from './race/Ghost.js';
import { GhostCar } from './race/GhostCar.js';
import { gridSlots } from './race/RaceState.js';
import { Opponents, SLOT_TRUCKS } from './race/Opponents.js';
import { MultiplayerRace } from './race/MultiplayerRace.js';
import { Lobby } from './ui/Lobby.js';
import { parseInviteHash } from './net/Signal.js';
import { CpuRace } from './race/CpuRace.js';
import { CpuPanel } from './ui/CpuPanel.js';
import { OpponentContacts } from './race/OpponentContacts.js';
import { loadOverlay } from './ui/LoadOverlay.js';
import { t } from './ui/strings.js';
import { probeGridSize } from './ProbeGrid.js';


const renderer = new THREE.WebGLRenderer( { antialias: true, outputBufferType: THREE.HalfFloatType } );
renderer.setSize( window.innerWidth, window.innerHeight );
renderer.setPixelRatio( window.devicePixelRatio );
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const bloomPass = new UnrealBloomPass( new THREE.Vector2( window.innerWidth, window.innerHeight ) );
bloomPass.strength = 0.02;
bloomPass.radius = 0.02;
bloomPass.threshold = 0.5;

renderer.setEffects( [ bloomPass ] );

document.body.appendChild( renderer.domElement );

const scene = new THREE.Scene();
scene.background = new THREE.Color( 0xadb2ba );
scene.fog = new THREE.Fog( 0xadb2ba, 30, 55 );

const dirLight = new THREE.DirectionalLight( 0xffffff, 3 );
dirLight.position.set( 11.4, 15, -5.3 );
dirLight.castShadow = true;
dirLight.shadow.mapSize.setScalar( 4096 );
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 60;
dirLight.shadow.radius = 4;
scene.add( dirLight );

const hemiLight = new THREE.HemisphereLight( 0xc8d8e8, 0x7a8a5a, 2 );
hemiLight.position.copy( dirLight.position )
scene.add( hemiLight );


window.addEventListener( 'resize', () => {

	renderer.setSize( window.innerWidth, window.innerHeight );

} );

const overlay = loadOverlay();
const progress = overlay.progress;
const uiLang = () => window.GG_LANG ?? 'en';

// Lets the loading label paint before synchronous work; the timeout keeps a background tab from stalling.
function nextPaint() {

	return new Promise( ( resolve ) => {

		requestAnimationFrame( resolve );
		setTimeout( resolve, 50 );

	} );

}

const loader = new ColorMapGLTFLoader();

const modelNames = [
	'vehicle-truck-yellow', 'vehicle-truck-green', 'vehicle-truck-purple', 'vehicle-truck-red',
	...pieceModelNames(),
	'decoration-empty', 'decoration-forest', 'decoration-tents',
];

const models = {};

async function loadModels( onModelLoaded ) {

	let loaded = 0;

	const promises = modelNames.map( ( name ) =>
		new Promise( ( resolve, reject ) => {

			loader.load( `models/${ name }.glb`, ( gltf ) => {

				const meshes = [];
				gltf.scene.traverse( ( child ) => {

					if ( child.isMesh ) {

						child.material.side = THREE.FrontSide;
						meshes.push( child );

					}

				} );

				// Godot imports vehicle models at root_scale=0.5
				if ( name.startsWith( 'vehicle-' ) ) {

					gltf.scene.scale.setScalar( 0.5 );

				}

				if ( meshes.length === 1 ) {

					const mesh = meshes[ 0 ];
					mesh.removeFromParent();
					models[ name ] = mesh;

				} else {

					models[ name ] = gltf.scene;

				}

				loaded ++;
				onModelLoaded( loaded, modelNames.length );
				resolve();

			}, undefined, reject );

		} )
	);

	await Promise.all( promises );

}

// OpenStreetMap surroundings load while the player already drives: the panel shrinks, and Cancel
// aborts the download instead of leaving the track.
function loadSurroundingsWithProgress( hud, osmParam, cells, area, cellSize ) {

	const cancel = new AbortController();
	overlay.compact();
	overlay.setCancel( () => cancel.abort() );
	progress.begin( 'surroundings' );
	loadSurroundings( scene, osmParam, cells, area, cellSize, {
		signal: cancel.signal,
		onStep: ( phase, detail ) => progress.step( phase === 'build' ? 1 : 0, 2, { ...detail, phase } ),
	} )
		.then( ( layers ) => {

			hud.setOsm( layers );
			hud.note( '' );

		} )
		.catch( ( e ) => {

			const skipped = e.name === 'AbortError';
			if ( ! skipped ) console.warn( 'OSM surroundings unavailable:', e.message );
			hud.note( t( skipped ? 'load.skipped' : 'load.surroundingsFailed', uiLang() ) );

		} )
		.finally( finishLoading );

}

function finishLoading() {

	progress.finish();
	overlay.hide();

}

const LANDING_FX_SPEED = 2; // u/s: landings softer than this (whoops wobble) make no sound or dust

async function init() {

	registerAll();
	progress.begin( 'models' );
	await loadModels( ( done, total ) => progress.step( done, total ) );
	addProfileModels( models );

	const mapParam = new URLSearchParams( window.location.search ).get( 'map' );
	let customCells = null;
	let spawn = null;

	if ( mapParam ) {

		try {

			customCells = decodeCells( mapParam );
			spawn = computeSpawnPosition( customCells );

		} catch ( e ) {

			console.warn( 'Invalid map parameter, using default track' );

		}

	}

	// &osm= (from osm-track.html) adds the real surroundings around a generated track
	const osmRaw = new URLSearchParams( window.location.search ).get( 'osm' );
	const osmParam = customCells ? parseOsmParam( osmRaw ) : null;
	const osmArea = osmParam ? viewArea( customCells, VIEW_MARGIN_CELLS ) : null;

	// Compute track bounds and size physics/shadows to fit
	const bounds = computeTrackBounds( customCells );
	const hw = bounds.halfWidth;
	const hd = bounds.halfDepth;
	const groundSize = Math.max( hw, hd ) * 2 + 20;

	const shadowExtent = Math.max( hw, hd ) + 10;
	dirLight.shadow.camera.left = - shadowExtent;
	dirLight.shadow.camera.right = shadowExtent;
	dirLight.shadow.camera.top = shadowExtent;
	dirLight.shadow.camera.bottom = - shadowExtent;
	dirLight.shadow.camera.updateProjectionMatrix();

	scene.fog.near = groundSize * 0.4;
	scene.fog.far = groundSize * 0.8;

	progress.begin( 'track' );
	await nextPaint();
	buildTrack( scene, models, customCells, { grassArea: osmArea } );
	progress.begin( 'lighting' );
	await nextPaint();

	// Probes

	const probeHeight = 6;
	const grid = probeGridSize( hw, hd );
	const probeCount = grid.x * grid.y * grid.z;
	const probes = new LightProbeGrid( hw * 2, probeHeight, hd * 2, grid.x, grid.y, grid.z );
	probes.position.set( bounds.centerX, probeHeight / 2, bounds.centerZ );
	console.info( `Baking lighting: ${ probeCount } probes (${ grid.x }x${ grid.y }x${ grid.z })…` );
	const bakeStart = performance.now();
	probes.bake( renderer, scene, { cubemapSize: 32, near: 0.1, far: groundSize } );
	console.info( `Lighting baked: ${ probeCount } probes in ${ Math.round( performance.now() - bakeStart ) } ms` );
	scene.add( probes );

	// scene.add( new LightProbeGridHelper( probes, 0.5 ) );

	//

	const worldSettings = createWorldSettings();
	worldSettings.gravity = [ 0, - 9.81, 0 ];

	const BPL_MOVING = addBroadphaseLayer( worldSettings );
	const BPL_STATIC = addBroadphaseLayer( worldSettings );
	const OL_MOVING = addObjectLayer( worldSettings, BPL_MOVING );
	const OL_STATIC = addObjectLayer( worldSettings, BPL_STATIC );

	enableCollision( worldSettings, OL_MOVING, OL_STATIC );
	enableCollision( worldSettings, OL_MOVING, OL_MOVING );

	const world = createWorld( worldSettings );
	world._OL_MOVING = OL_MOVING;
	world._OL_STATIC = OL_STATIC;

	buildWallColliders( world, null, customCells );

	const roadHalf = groundSize / 2;
	rigidBody.create( world, {
		shape: box.create( { halfExtents: [ roadHalf, 0.01, roadHalf ] } ),
		motionType: MotionType.STATIC,
		objectLayer: OL_STATIC,
		position: [ bounds.centerX, - 0.125, bounds.centerZ ],
		friction: 5.0,
		restitution: 0.0,
	} );

	const sphereBody = createSphereBody( world, spawn ? spawn.position : null );

	const vehicle = new Vehicle();
	vehicle.rigidBody = sphereBody;
	vehicle.physicsWorld = world;

	const terrain = makeTerrain( customCells || TRACK_CELLS, CELL_RAW * GRID_SCALE, GRID_SCALE );
	vehicle.terrain = terrain;

	if ( spawn ) {

		const [ sx, sy, sz ] = spawn.position;
		vehicle.spherePos.set( sx, sy, sz );
		vehicle.prevModelPos.set( sx, 0, sz );
		vehicle.container.rotation.y = spawn.angle;

	}

	const vehicleGroup = vehicle.init( models[ 'vehicle-truck-yellow' ] );
	scene.add( vehicleGroup );

	// Playwright checks (&debug only): the running vehicle and physics, never used by the game itself.
	if ( new URLSearchParams( window.location.search ).has( 'debug' ) ) window.__racerDebug = { vehicle, sphereBody, world, terrain };

	dirLight.target = vehicleGroup;

	const cam = new Camera();
	scene.add( cam.debug );

	const controls = new Controls();

	const particles = new SmokeTrails( scene );
	const dust = new SmokeTrails( scene, { color: 0x9a7a55 } );
	const driftMarks = new DriftMarks( scene, mapParam );

	const audio = new GameAudio();
	audio.init( cam.camera, vehicleGroup );

	const lapTimer = new LapTimer( customCells, mapParam );

	// Ghost (#3): replays the fastest lap on this track — same track key as the best lap time.
	const ghostKey = ghostStorageKey( mapParam );
	const ghostRun = new GhostRun( loadGhost( ghostKey ) );
	ghostRun.onNewBest = ( ghost ) => saveGhost( ghostKey, ghost );
	const ghostCar = new GhostCar( scene, models[ 'vehicle-truck-yellow' ] );

	function updateGhost() {

		// No ghost in a multiplayer session (#1), lobby included — it would pass for another player's truck.
		// persist === false while a multiplayer race runs: race laps are not recorded.
		const soloLap = lapTimer.enabled && lapTimer.running && lapTimer.persist !== false && ! multiplayer.role;
		if ( ! soloLap ) {

			ghostRun.discard();
			ghostCar.setPose( null );
			return;

		}

		const c = vehicle.container;
		ghostRun.update( lapTimer.lap, lapTimer.currentLapTime, lapTimer.lastLap, c.position.toArray(), c.quaternion.toArray() );
		ghostCar.setPose( ghostRun.poseAt( lapTimer.currentLapTime ) );

	}

	const cellSize = CELL_RAW * GRID_SCALE;
	const hud = new Hud( customCells || TRACK_CELLS, cellSize );

	if ( osmParam ) {

		loadSurroundingsWithProgress( hud, osmParam, customCells, osmArea, cellSize );

	} else if ( osmRaw !== null ) {

		console.warn( 'OSM surroundings unavailable:', customCells ? 'malformed or too large &osm= value' : 'no valid ?map= track to place them around' );
		hud.note( t( 'load.surroundingsFailed', uiLang() ) );

	}

	if ( ! osmParam ) finishLoading();

	const _forward = new THREE.Vector3();
	const _camLead = new THREE.Vector3();
	const spinHold = new SpinHold();
	const _up = new THREE.Vector3( 0, 1, 0 );

	// Multiplayer (#1): other players' trucks, the lobby and the race controller.
	const raceCells = customCells || TRACK_CELLS;
	const finishCell = raceCells.find( ( c ) => c[ 2 ] === 'track-finish' );
	const trackKeys = new Set( raceCells.map( ( c ) => c[ 0 ] + ',' + c[ 1 ] ) );
	const slots = finishCell ? gridSlots( finishCell, cellSize, ( gx, gz ) => trackKeys.has( gx + ',' + gz ) ) : [];
	let holdInput = false;

	const game = {
		trackCells: raceCells,
		cellSize,
		pageUrl: window.location.href,
		mapParam: mapParam || encodeCells( TRACK_CELLS ),
		osmParam: osmRaw && /^[-0-9.,]{13,120}$/.test( osmRaw ) ? osmRaw : null,
		lapTimer,
		opponents: new Opponents( scene, world, models, SLOT_TRUCKS ),
		terrain,
		placeOnSlot( slot ) {

			const { position, angle } = slots[ slot ];
			rigidBody.setPosition( world, sphereBody, position, true );
			rigidBody.setLinearVelocity( world, sphereBody, [ 0, 0, 0 ] );
			rigidBody.setAngularVelocity( world, sphereBody, [ 0, 0, 0 ] );
			vehicle.spherePos.set( position[ 0 ], position[ 1 ], position[ 2 ] );
			vehicle.prevModelPos.set( position[ 0 ], 0, position[ 2 ] );
			vehicle.linearSpeed = 0;
			vehicle.angularSpeed = 0;
			vehicle.acceleration = 0;
			vehicle.sphereVel.set( 0, 0, 0 );
			vehicle.container.quaternion.setFromAxisAngle( _up, angle );

		},
		setHold( hold ) {

			holdInput = hold;

		},
		paintOwnTruck( slot ) {

			vehicle.paint( models[ SLOT_TRUCKS[ slot ] ] );

		},
		unpaintOwnTruck() {

			vehicle.paint( models[ 'vehicle-truck-yellow' ] );

		},
		localState() {

			const s = vehicle.spherePos, q = vehicle.container.quaternion, v = vehicle.sphereVel;
			return { p: [ s.x, s.y, s.z ], q: [ q.x, q.y, q.z, q.w ], v: [ v.x, v.y, v.z ] };

		},
	};

	// CPU opponents (#4): same adapter as multiplayer, its own set of opponent trucks.
	const cpuPanel = new CpuPanel();
	const cpuOpponents = new Opponents( scene, world, models );
	const cpuRace = new CpuRace( { ...game, opponents: cpuOpponents },
		{ onChange: ( view ) => cpuPanel.render( view ), isBusy: () => !! multiplayer.view().role } );

	const lobby = new Lobby( { canRace: !! finishCell } );
	const multiplayer = new MultiplayerRace( game, { onChange: ( view ) => {

		if ( view.role ) cpuRace.quit(); // creating or joining a multiplayer session ends a CPU race
		lobby.render( view );
		cpuPanel.render( cpuRace.view() );

	} } );
	// A failed join still tears down the CPU race and resets to a solo lap timer before the async
	// answer comes back, so quit it up front rather than relying on the onChange success path above.
	const hostSession = multiplayer.host.bind( multiplayer );
	const joinSession = multiplayer.join.bind( multiplayer );
	multiplayer.host = ( ...args ) => { cpuRace.quit(); return hostSession( ...args ); };
	multiplayer.join = ( ...args ) => { cpuRace.quit(); return joinSession( ...args ); };
	cpuPanel.bind( cpuRace, { isBusy: () => !! multiplayer.view().role } );
	lobby.bind( multiplayer );

	// Playwright checks (&debug only): the running CPU race, never used by the game itself.
	if ( window.__racerDebug ) window.__racerDebug.cpuRace = cpuRace;
	const invite = parseInviteHash( window.location.hash );
	if ( invite ) lobby.openJoin( invite );

	// Bumps with opponent trucks (#13): no bounce, capped push, sound from the relative speed.
	const opponentContacts = new OpponentContacts( world, sphereBody, [ game.opponents, cpuOpponents ],
		{ onBump: ( speed ) => audio.playImpact( speed ) } );

	const contactListener = {
		onContactAdded( bodyA, bodyB, manifold, settings ) {

			if ( bodyA !== sphereBody && bodyB !== sphereBody ) return;

			if ( opponentContacts.involvesOpponent( bodyA, bodyB ) ) {

				opponentContacts.contactAdded( bodyA, bodyB, settings );
				return;

			}

			// Profile pieces (ramp/tabletop/whoops) are separate static bodies, so driving onto/off
			// them starts new contacts with a mostly-vertical normal — not a wall hit. Landings are
			// handled by Airtime.
			if ( ! isWallImpact( manifold.worldSpaceNormal[ 1 ] ) ) return;

			_forward.set( 0, 0, 1 ).applyQuaternion( vehicle.container.quaternion );
			_forward.y = 0;
			_forward.normalize();

			const impactVelocity = Math.abs( vehicle.modelVelocity.dot( _forward ) );
			audio.playImpact( impactVelocity );

		},
		onContactPersisted( bodyA, bodyB, manifold, settings ) {

			if ( opponentContacts.involvesOpponent( bodyA, bodyB ) ) opponentContacts.contactPersisted( settings );

		},
	};

	const timer = new THREE.Timer();

	function animate() {

		requestAnimationFrame( animate );

		timer.update();
		const dt = Math.min( timer.getDelta(), 1 / 30 );

		const input = controls.update();
		if ( holdInput ) Object.assign( input, { x: 0, z: 0, touchActive: false } );

		multiplayer.update( dt );
		cpuRace.update( dt );
		opponentContacts.beginStep();
		updateWorld( world, contactListener, dt );
		opponentContacts.endStep();

		vehicle.update( dt, input );

		if ( vehicle.landing > LANDING_FX_SPEED ) audio.playImpact( vehicle.landing );

		dirLight.position.set(
			vehicle.spherePos.x + 11.4,
			15,
			vehicle.spherePos.z - 5.3
		);

		const mv = vehicle.modelVelocity;
		_camLead.set( 0, 0, 1 ).applyQuaternion( vehicle.container.quaternion ).multiplyScalar( Math.sqrt( mv.x * mv.x + mv.z * mv.z ) );
		_forward.set( 0, 0, 1 ).applyQuaternion( vehicle.container.quaternion );
		spinHold.update( dt, Math.atan2( _forward.x, _forward.z ) );
		cam.update( dt, vehicle.spherePos, _camLead, spinHold.hold );
		const speed01 = Math.abs( vehicle.linearSpeed ) / MAX_SPEED;
		particles.update( dt, vehicle, smokeEmits( vehicle.surface, vehicle.driftIntensity ) && ! vehicle.airborne );
		dust.update( dt, vehicle, ( dustEmits( vehicle.surface, vehicle.driftIntensity, speed01 ) && ! vehicle.airborne ) || vehicle.landing > LANDING_FX_SPEED );
		driftMarks.update( dt, vehicle, vehicle.surface );
		audio.update( dt, vehicle.linearSpeed / MAX_SPEED, input.z, vehicle.driftIntensity, vehicle.surface );

		const hasInput = input.touchActive || Math.abs( input.x ) > 0.05 || Math.abs( input.z ) > 0.05;
		lapTimer.update( dt, vehicle.spherePos, hasInput );
		updateGhost();

		_forward.set( 0, 0, 1 ).applyQuaternion( vehicle.container.quaternion );
		hud.update( vehicle.spherePos.x, vehicle.spherePos.z, _forward.x, _forward.z, cpuRace.markers() );

		renderer.render( scene, cam.camera );

	}

	animate();

}

init().catch( ( e ) => {

	console.error( 'Loading the track failed:', e );
	overlay.fail();

} );
