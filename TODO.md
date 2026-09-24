# TODO

## Done: OSM surroundings (2026-09-24)

Spec `docs/superpowers/specs/2026-09-24-osm-surroundings-design.md`, plan
`docs/superpowers/plans/2026-09-24-osm-surroundings.md`. Awaiting the user's Sisseln play-test.

## Discoveries (not acted on)

- Game camera is fixed from the south-east (`Camera.js` offset +X,+Z): north is up-left on screen.
- browser-game stack requires de/en i18n for text-heavy UI: `osm-track.html` qualifies; the
  Tracks menu and the planned HUD are borderline (arcade carve-out). Parked 2026-09-24.
- Pages on this fork did not rebuild on push once (2026-09-24); triggered manually via
  `gh api -X POST repos/freaxnx01/game-kit-racer/pages/builds`.
