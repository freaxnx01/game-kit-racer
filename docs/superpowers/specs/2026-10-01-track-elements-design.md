# Track elements — ramps, tabletops, whoops and dirt

Date: 2026-10-01 · Status: approved in brainstorming, awaiting spec review

## Problem

The user wants more track pieces, real jumps, and a dirt track.

Today (checked in code):

- There are four pieces: `track-straight`, `track-corner`, `track-bump`, `track-finish` (Kenney GLBs).
  Their names are listed separately in `js/Track.js:340` (codec), `js/OsmTrack.js:684` (codec copy),
  `js/race/TrackPath.js:10` (open sides), `js/main.js:95` and `editor.html:313` (model loading).
- `track-bump` is only visual: `js/Physics.js:74` skips it and the floor is one flat box
  (`js/main.js`), so trucks drive through the hump. There are no real jumps.
- "The Claypit" (`js/Tracks.js:12`, "Dirt rallycross — three jumps, loose grip") is just a map of
  those four pieces: no dirt surface, no different grip, bumps without physics.
- The codec packs a cell into 3 bytes; the third is `( type << 2 ) | orient` with a 2-bit type, so
  bits 4–7 are always 0 in every existing map.
- The truck is a rolling sphere (`js/Physics.js createSphereBody`, friction 5.0,
  `gravityFactor 1.5`) driven by setting its angular velocity (`js/Vehicle.js`). Grip comes from the
  sphere–ground friction; crashcat combines friction per contact from both bodies' `friction`.
- crashcat 0.0.3 provides `triangleMesh` and `convexHull` shapes besides `box`/`sphere`.
- CPU trucks are kinematic and ride at a fixed `SPHERE_Y` (`js/race/CpuDriver.js:17`).

## Goal

1. A piece system that new pieces plug into in one place.
2. Three new straight-connected pieces with real physics: **ramp** (kicker), **tabletop**,
   **whoops**.
3. **Dirt** as a per-cell surface: any piece can be dirt; dirt has less grip, a lower top speed, and
   its own look and effects.
4. The Claypit becomes a real dirt track with real jumps.

Success: on the Claypit the truck visibly leaves the ground over the ramp and tabletop, the whoops
shake it, it slides more on dirt than on asphalt, and every existing `?map=` link loads exactly as
before.

## Out of scope

Chicanes/S-bends, 2×2 wide corners, crossings (they change the driving line and the editor's
neighbour logic — a separate round). Damage, roll-over reset, airtime scoring/HUD. A real physical
`track-bump` (it stays visual; whoops are its physical counterpart).

## Design

### 1. Piece registry — `js/Pieces.js` (new, pure, no three.js)

The single list of pieces. Each entry says how the piece is drawn and how it connects:

```js
PIECES = {
  'track-straight': { index: 0, model: 'track-straight', open: STRAIGHT },
  'track-corner':   { index: 1, model: 'track-corner',   open: CORNER },
  'track-bump':     { index: 2, model: 'track-bump',     open: STRAIGHT },
  'track-finish':   { index: 3, model: 'track-finish',   open: STRAIGHT },
  'track-ramp':     { index: 4, profile: ramp,     open: STRAIGHT },
  'track-tabletop': { index: 5, profile: tabletop, open: STRAIGHT },
  'track-whoops':   { index: 6, profile: whoops,   open: STRAIGHT },
}
```

- A **profile** is a pure function `h(t)`: `t` 0→1 along the driving direction of the piece at
  orientation 0 (+z), result = height above the normal floor in raw cell units.
  - **ramp**: rises linearly to ~1.2 and ends in a lip — `h` drops to 0 right at the end (a cliff,
    not a down-slope), so the truck lands on the next piece.
  - **tabletop**: up-slope, flat plateau, gentle down-slope as the landing zone.
  - **whoops**: three sine humps of ~0.35.
  Exact numbers are tuned in play-testing; tests pin the shape (start 0, peak/lip where stated,
  end 0), not the tuning values.
- Ramp and tabletop are directional. The existing four orientations already cover both directions;
  no new field.
- `TYPE_NAMES`, the codec tables in `Track.js` and `OsmTrack.js`, `TrackPath.js`'s open sides and
  the model lists in `main.js`/`editor.html` all derive from `PIECES` — no more duplicated lists.

### 2. Codec

Third byte of a cell:

```
bit 7   = dirt
bit 2–6 = type index (0–31; 0–3 as today, 4 ramp, 5 tabletop, 6 whoops)
bit 0–1 = orientation
```

Old maps have bits 4–7 = 0, so they decode exactly as before. A cell gets an optional fifth field:
`[ gx, gz, type, orient, { dirt: true } ]`; code that reads only the first four fields keeps
working. An unknown type index decodes to `track-straight` (fail safe for hand-edited links).

### 3. Rendering

- `placePiece()` branches: GLB piece as today, or `buildProfileMesh( profile )` for profile pieces.
- The profile mesh is a road strip the width of `track-straight`'s road, following `h(t)`, with
  closed sides, plus the same kerbs/edges as `track-straight` so it joins its neighbours seamlessly.
  Colours come from the kit's `colormap.png`.
- **Dirt** colours a cell's road surface brown: GLB pieces via a cloned material on the road mesh,
  profile pieces directly.

### 4. Physics

- **Profile pieces**: `Physics.js` builds a static `triangleMesh` collider per profile piece from
  the same profile (~24 steps along, 2 across), so look and physics cannot diverge. Side walls are
  the `track-straight` walls, raised by the profile's maximum height so the truck cannot jump over
  them.
- **Air**: gravity (`gravityFactor 1.5`) already makes the flight; the drive has no effect without
  ground contact. `Vehicle.js` today only aligns the model to the ground normal when upright; in the
  air it aligns it to the flight path, nose slightly down (visual only). On touch-down: a landing
  sound through the existing `ImpactSound` and a burst of dust.
- **Dirt**: `surfaceAt( x, z )` (pure: world position → cell → `'dirt'` | `'asphalt'`; off-track =
  `'asphalt'`). Each physics step the vehicle sets the sphere's `friction` from the surface
  (asphalt 5.0 as today, dirt ~1.5) and uses a lower top speed on dirt. No separate dirt floor
  colliders: abutting/overlapping boxes cause contact seams and hops at cell borders; switching the
  sphere's friction has no seams and works on dirt ramps too.
- **Effects on dirt**: `Particles.js` emits brown dust instead of grey smoke, also without drifting
  from medium speed up; `DriftMarks.js` draws lighter, wider marks; the skid sound plays quieter and
  lower through its existing tone/pitch variation (no new sample).

### 5. Editor (`editor.html`)

Two new tools next to `road` / `erase` / `pan`:

- **Element**: click a straight cell to cycle straight → ramp → tabletop → whoops → straight;
  shift-click flips its direction (like clicking the finish today). No effect on corners or the
  finish. Auto-tiling treats every new piece as a straight, so it is unchanged.
- **Dirt**: click or drag over cells to toggle their dirt bit — any piece, corners and finish
  included.
- The preview draws profile pieces and dirt with the game's code.

### 6. CPU trucks, ghost, multiplayer

- `heightAt( x, z )` (pure, next to `surfaceAt`): the profile height under a point. `CpuDriver`
  uses it instead of the fixed `SPHERE_Y`, so CPU trucks follow the profile — they drive over the
  ramp and drop along it after the lip; they do not really jump. Deliberately simple.
- On dirt CPU trucks drive slower by the same factor as the player's top speed.
- Ghost and multiplayer already carry full positions including y; the plan verifies this.

### 7. Tracks

- **The Claypit** is rebuilt: all dirt, its three "jumps" become a ramp, a tabletop and whoops.
  Its menu description stays.
- All other presets stay byte-identical.

### 8. Changelog

One player-facing entry under `[Unreleased]`, e.g. „New track pieces: ramp, tabletop and whoops —
with real jumps. Any piece can now be dirt: less grip, more sliding, dust. The Claypit is a real
dirt track now."

## Testing

TDD with `node --test test/*.test.mjs` on the pure modules:

- `pieces.test.mjs`: profile shape (start/lip/end values), every type has a unique index, every
  piece has either a model or a profile.
- Codec: every existing preset decodes to the same cells as before; new types and the dirt bit
  round-trip; `Track.js` and `OsmTrack.js` codecs agree; unknown index → straight.
- `track-path.test.mjs`: new pieces connect like straights; a loop containing them is closed.
- `surfaceAt` / `heightAt`: cell borders, all four orientations, the dirt flag, off-track.
- `cpu-driver.test.mjs`: the CPU's y follows `heightAt`; slower on dirt.

Manual/Playwright play-test in the foreground (stack rule): the Claypit loads with an empty
console; the truck's `y` rises above the profile height after the ramp lip (airtime); the sphere's
friction is lower on a dirt cell; every other preset still loads.

## Implementation order

1. Registry + codec
2. Profile mesh + collider
3. Ramp playable
4. Tabletop + whoops
5. Dirt (physics, look, effects)
6. Editor tools
7. CPU trucks
8. The Claypit + changelog
