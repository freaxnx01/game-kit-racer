# Changelog

All notable changes to this project are documented here, following
[Keep a Changelog](https://keepachangelog.com) and
[Semantic Versioning](https://semver.org).

## [Unreleased]

### Added

- Mini map in the top-right corner on every track, showing where you are.
- Tracks built from OpenStreetMap now show the real buildings and side streets
  around the road, and the name of the street you are driving on.
- New "Auto" option in the OpenStreetMap track builder: smoother corners without
  losing parts of the route. It is the new default.
- Multiplayer: race up to three friends over the internet — send an invite link,
  paste back their answer code, and race a countdown start over 1–10 laps with
  trucks you can bump into. Works without any server; strict company networks
  may block it (a phone hotspot helps). Available in German and English.

## [0.1.0] - 2026-09-24

### Added

- Fork of [mrdoob/Starter-Kit-Racing](https://github.com/mrdoob/Starter-Kit-Racing), published as game-kit-racer.
- In-game **Tracks** picker with four circuits converted from
  [Aerodrome Apex](https://github.freaxnx01.ch/game-aerodrome-apex/).
- `osm-track.html`: build a track from OpenStreetMap streets.
- Favicon and in-game version badge sourced from `version.js`.
