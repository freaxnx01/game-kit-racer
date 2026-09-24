# TODO

## Parked: make OSM tracks recognizable (design in progress, 2026-09-24)

Play-test of a Sisseln loop: track is valid but "I don't recognize Sisseln" — only the road
shape comes from OSM; surroundings are procedural forest, chase cam is rotated 45° and close.

Agreed so far (brainstorming, architectural path — resume at design section 1 approval):

- Levers wanted: real surroundings, north-up minimap, street-name HUD, smoother geometry defaults.
- Data path: game fetches OSM itself. Link gains `&osm=<s>,<w>,<n>,<e>,<mpc>,<offX>,<offZ>`.
- Layers: buildings (extruded, kit pastel style) + side streets (flat ribbons). No water/landuse.
- Draft section 1 (not yet approved):
  - `fetchOverpass(query)` (mirrors, failover, localStorage cache) moves from `osm-track.html`
    into `OsmTrack.js`, shared by page and game; query also fetches `building` ways.
  - New `js/OsmScene.js` (three.js: merged building + street meshes), `js/OsmHud.js` (minimap + street name).
  - `main.js` / `Track.js`: additive, no-ops without `&osm=`; `buildTrack(…, { osm: true })` skips
    procedural forest/tents. Track plays immediately; surroundings pop in; Overpass down → plain track + note.
- Open idea for smoother geometry: per segment use "L", fall back to stairs where L would collide
  (L mode's shortcuts can drop large parts of a loop).

## Discoveries (not acted on)

- Game camera is fixed from the south-east (`Camera.js` offset +X,+Z): north is up-left on screen.
