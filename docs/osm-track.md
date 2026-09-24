# OSM track import — handoff notes

Extension for mrdoob/Starter-Kit-Racing: build a race track from OpenStreetMap streets.
Two new files, no changes to upstream code.

## Files

- `osm-track.html` — UI page (same visual style as `editor.html`). Loads streets via Overpass,
  lets the user select a loop, previews the tiles, opens the game / editor with `?map=`.
- `js/OsmTrack.js` — pure ES module, no dependencies (deliberately does NOT import `three` or
  `Track.js`, so the page works even when the CDN is blocked). Exports:
  `overpassQuery`, `makeProjection`, `buildGraph`, `nearestNode`, `shortestPath`, `routeLoop`,
  `perimeterLoop`, `simplifyPolyline`, `line4`, `lineL`, `rasterizeLoop`, `cleanLoop`,
  `loopCenter`, `loopToTrackCells`, `trackStats`, `encodeTrackCells`.

## Constraints of the upstream track format (drive every design decision)

- Grid of tiles: `track-straight`, `track-corner`, `track-bump`, `track-finish`; four Godot
  orientation codes `0 / 16 / 10 / 22` = 0° / 90° / 180° / 270°. World: +X east, +Z south.
  Cell size = `9.99 * 0.75` world units (`js/Track.js`).
- Every tile has exactly two exits → no junctions, no diagonals.
- `js/LapTimer.js` counts a lap only after **every** cell has been visited → the track must be a
  single closed loop with no side branches and no cell driven twice.
- Codec (`encodeCells`/`decodeCells` in `Track.js`): 3 bytes per cell, `gx+128`, `gz+128`,
  `type<<2 | orient`; grid coordinates limited to −128..127. `encodeTrackCells` in
  `OsmTrack.js` is a byte-identical copy — keep them in sync if upstream changes.
- Exit-bitmask → piece table (N=8 S=4 E=2 W=1, N = gz−1): 12→straight/0, 3→straight/16,
  5→corner/0, 6→corner/16, 10→corner/10, 9→corner/22. Same table as `editor.html`.
- Spawn heading = vehicle forward (+Z) rotated by the finish tile's orientation:
  0 south, 10 north, 16 east, 22 west. `loopToTrackCells` puts the finish on the first
  straight cell, oriented in driving order, and rotates the array so the finish is index 0.
- `index.html` and `editor.html` both read `?map=` from `location.search`.

## Pipeline

Overpass JSON → equirectangular projection (metres, y = north) → graph (`adj` is a flat
`[id, dist, id, dist, …]` array) → loop of node ids → Douglas–Peucker simplify (tolerance =
slider × cell size) → 4-connected raster (`stairs` = Bresenham, `L` = one corner per segment)
→ `cleanLoop` (consecutive duplicates, A→B→A spikes) → duplicate-cell check → piece
assignment → centre on grid → encode.

Loop sources:
- **Frame** (default): clip graph to rect, prune degree<2 nodes iteratively (2-core), take the
  largest component, start at leftmost node, walk the outer face taking the left-most turn
  (interior on the right → clockwise).
- **Points**: Dijkstra between consecutive waypoints and back to the first.

## Gotchas already hit

- `npx serve` (clean URLs) 301-redirects `*.html?map=…` and drops the query. `serve.json`
  (`cleanUrls: false`) turns that off; then `/` is a directory listing, so all links use
  `index.html?map=…` / `editor.html?map=…`. (`serve -n` is `--no-clipboard`, not a fix.)
- `overpass-api.de` returns 504 under load. Page tries `overpass.osm.ch` (Swiss-only) first,
  then three worldwide mirrors, 45 s timeout each, and caches responses in `localStorage`
  keyed by the query string.
- Module scripts don't run from `file://`; page shows a hint if the module hasn't started
  within 1.5 s.

## Testing so far

- Node: synthetic OSM graph (two blocks + diagonal + spurs), invariants checked: consecutive
  cells 4-adjacent, no duplicates, `encodeCells` ↔ `decodeCells` round-trip against upstream
  `Track.js`, codec parity `encodeTrackCells === encodeCells`.
- Playwright: page served over http, Overpass mocked (incl. 504 failover + cache hit), frame
  drag and point clicks, Play opens `./?map=…`.
- Not yet tested: the generated track actually running in the game with live three.js/crashcat
  (sandbox had no CDN access). User confirmed streets load for Sisseln
  (bbox 47.5430,7.9700,47.5620,8.0050 → 473 ways, 2504 nodes) and a 38-cell loop generates.
- No test files are committed; recreate as `test/osm-track.test.mjs` if wanted.

## Open ideas (candidate issues)

1. Diagonal/curved streets → staircases. Options: larger cells, `L` mode, or new tile types
   (a 45° piece would need custom geometry + colliders in `Track.js` / `Physics.js`).
2. Buildings from OSM `building` footprints → `THREE.ExtrudeGeometry` in the deco group.
3. Elevation (swisstopo / SRTM) — the tile system is flat; would need per-cell height and
   sloped pieces.
4. Named streets: show `way.tags.name` on hover in the page.
5. ~~Editor link that survives clean-URL servers~~ — solved by `serve.json`.
6. Frame mode picks the largest component; expose a "pick the block under the cursor" option.
