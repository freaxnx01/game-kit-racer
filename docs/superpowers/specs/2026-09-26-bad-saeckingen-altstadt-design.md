# Bad Säckingen Altstadt — a preset track through the old town and over the Holzbrücke

Date: 2026-09-26 · Status: approved (enrich --quick) · Issue #6

## Problem

Issue #6 asks for a track through the old town of Bad Säckingen: through the narrow lanes
and over the historic covered wooden bridge (Holzbrücke) across the Rhine. Today that loop
cannot be built:

- `osm-track.html` loads only `DEFAULT_HIGHWAYS` (`js/OsmTrack.js:12`), which has no
  `pedestrian`. The Holzbrücke is `highway=pedestrian` (way 85692214,
  `bridge=covered`, `bridge:name=Holzbrücke Bad Säckingen`, `motor_vehicle=no`), and the
  old-town lanes (Rheinbrückstraße, Steinbrückstraße, Münsterplatz, Schützenstraße,
  Fischergasse, Metzgergasse …) are `highway=pedestrian` too.
- On the Swiss side (Stein AG) the bridge ends in two short `highway=path` stubs before
  reaching `Rheinbrückstrasse` (residential). Without `path` the bridge is a dead end.
- The Holzbrücke leads to Switzerland, so a closed loop has to come back over another
  bridge — the road bridge `Fridolinsbrücke` (`highway=primary`) 600 m downstream.

Overpass research on 2026-09-26 (overpass.osm.ch, bbox 47.542,7.938,47.558,7.960) found a
clean loop with waypoints
`Holzbrücke west end → Holzbrücke east end → Fridolinsbrücke → Hauensteinstraße → Steinbrückstraße`:
Rheinbrückstraße → Holzbrücke → paths → Rheinbrückstrasse (Stein) → Schaffhauserstrasse →
Fridolinsbrücke → Fricktalstraße → a short footpath → Neßlerstraße → Hauensteinstraße →
Schützenstraße → Steinbrückstraße → Münsterplatz → Rheinbrückstraße. 2.59 km of street,
no node visited twice; at 10 m per cell in `auto` mode it rasterises to 320 cells,
74 × 87 grid, 0 shortcuts, 0 duplicates — well inside the codec's −128..127.

## Goal and success criterion

A new entry **"Bad Säckingen Altstadt"** in the in-game Tracks menu starts a lap on the
Holzbrücke, runs through the old-town lanes, crosses to Stein AG and back over the
Fridolinsbrücke, with the real buildings, side streets, minimap and street names around it
(the existing `&osm=` surroundings). **Success:** the user picks it from the Tracks menu and
recognizes the old town and the bridge.

## Scope

In scope:

1. `pedestrian` becomes part of `DEFAULT_HIGHWAYS` (old-town lanes are pedestrian zones
   in most European towns), so `osm-track.html` and the in-game surroundings/street names
   include them.
2. OSM ways tagged `area=yes` (pedestrian squares drawn as polygons) are ignored as
   roads — in the route graph (`buildGraph`) and in the surroundings (`osmFeatures`).
3. A way without `name` falls back to `bridge:name`, so the street pill shows
   "Holzbrücke Bad Säckingen" on the bridge.
4. A reusable pure function `bakeLoop()` in `js/OsmTrack.js` — the waypoint branch of
   `osm-track.html`'s `regenerate()` without the DOM.
5. A generator `tools/osm-presets.mjs` holding hand-written preset definitions
   (bbox, highways, waypoints, metres per cell, mode). `--fetch` refreshes a committed
   roads-only fixture `test/fixtures/bad-saeckingen.json` from Overpass; without it the
   tool bakes from the fixture and writes `js/OsmPresets.js` (generated,
   `OSM_PRESETS = [ { id, name, desc, map, osm } ]`).
6. `js/Tracks.js` appends `OSM_PRESETS` and exports `trackHref( preset )`, which adds
   `&osm=` when the preset has one; the Tracks menu in `index.html` uses it.
   `tools/aerodrome-tracks.mjs`' output template is updated to match so regenerating the
   Aerodrome circuits keeps both.

Out of scope (deferred, see Consequences): water / the Rhine under the bridge, a bridge
or roof model for the covered bridge, elevation, adding `path`/`footway` to the defaults,
i18n of preset names (the Tracks menu is English-only today), editing presets in the UI.

## Architecture and data flow

```
tools/osm-presets.mjs --fetch ──Overpass──▶ test/fixtures/bad-saeckingen.json (roads only, committed)
tools/osm-presets.mjs ──bakeLoop()──▶ js/OsmPresets.js  (map + osm, generated, committed)
js/Tracks.js  PRESET_TRACKS = [ default, aerodrome…, ...OSM_PRESETS ],  trackHref()
index.html Tracks menu ──▶ index.html?map=<tiles>&osm=<s>,<w>,<n>,<e>,10,<offX>,<offZ>
main.js (unchanged) ──▶ track tiles + live Overpass surroundings, minimap, street names
```

### `bakeLoop( osm, { bbox, waypoints, mpc, mode, tol } )` (OsmTrack.js)

Projects with `makeProjection( bbox )`, `buildGraph`, snaps each `[ lat, lon ]` waypoint
with `nearestNode`, `routeLoop`, `simplifyPolyline( …, tol ?? mpc )`,
`rasterizeLoop( …, mpc, mode )`, `loopCenter`, `loopToTrackCells`. Returns
`{ ids, cells, center, shortcuts, duplicates }`. Throws when a leg cannot be routed
(`missing` non-empty) or fewer than three waypoints are given. It does not throw on
shortcuts/duplicates — the tool decides.

### `tools/osm-presets.mjs`

- Exports `PRESET_DEFS` and `bakePreset( def, osm )` → `{ id, name, desc, map, osm, ids, cells }`;
  the CLI part runs only when the file is executed directly, so tests can import it.
- `bakePreset` throws when the loop has shortcuts or duplicates — a preset must follow
  the real streets completely.
- Bad Säckingen definition: id `bad-saeckingen`, name `Bad Säckingen Altstadt`,
  desc `Old-town lanes and the covered wooden bridge over the Rhine`,
  bbox `[ 47.5435, 7.9400, 47.5565, 7.9560 ]`,
  highways `primary|secondary|tertiary|unclassified|residential|living_street|service|track|pedestrian|path`,
  waypoints `[ 47.55152, 7.95004 ], [ 47.55134, 7.95276 ], [ 47.54606, 7.94972 ], [ 47.5515, 7.94551 ], [ 47.55332, 7.94844 ]`,
  mpc 10, mode `auto`.
- Fixture tags kept: `highway`, `name`, `bridge:name`, `area` (≈ 245 kB, cf. `sisseln.json` 455 kB).
- `&osm=` value from `encodeOsmParam( { bbox, mpc, offX, offZ } )` (`js/OsmData.js:12`) — the same
  numbers `osm-track.html:588` puts in its links.

### Driving direction and start

Loop order = waypoint order, so the lap starts at the Holzbrücke's west (German) end
heading east; `loopToTrackCells` puts the finish on the first straight cell, i.e. on the
bridge.

## Error handling

- Overpass unavailable during `--fetch`: the tool exits non-zero with every mirror's error
  (`fetchOverpass` already reports them); nothing is overwritten.
- OSM changed so the route breaks: `bakePreset` throws naming the preset; adjust waypoints.
- In game, the surroundings fetch failing keeps today's behaviour ("Surroundings unavailable",
  track still playable).

## Testing

`node --test test/*.test.mjs`:

- `test/osm-track.test.mjs`: `DEFAULT_HIGHWAYS` contains `pedestrian`; `buildGraph` skips
  `area=yes` ways and falls back to `bridge:name`; `bakeLoop` on a synthetic square and its
  error on an unroutable waypoint.
- `test/osm-data.test.mjs`: `osmFeatures` skips `area=yes` streets and uses `bridge:name`.
- New `test/osm-presets.test.mjs` (fixture-based): baking from the fixture reproduces the
  committed `OSM_PRESETS` entry exactly; the route crosses the Holzbrücke (way 85692214) and
  a way named `Fridolinsbrücke`; the `osm` value parses with `parseOsmParam`.
- `test/tracks.test.mjs`: id list gains `bad-saeckingen` (the existing loop-shape tests then
  cover the new map automatically); `trackHref` adds `&osm=` only when present.
- Manual playtest: pick the preset from the Tracks menu, lap starts on the bridge, street
  pill shows the old-town names, surroundings load.
