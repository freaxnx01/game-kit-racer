# Changelog

All notable changes to this project are documented here, following
[Keep a Changelog](https://keepachangelog.com) and
[Semantic Versioning](https://semver.org).

## [Unreleased]

### Added

- New track pieces: **ramp**, **tabletop** and **whoops** — with real jumps. Hit
  the ramp at speed and the truck flies; the whoops shake it about.
- Any piece can now be **dirt**: less grip, more sliding, lower top speed, brown
  dust and dirt tracks behind you.
- The editor has two new tools: **Element** (4) turns a straight into a ramp,
  tabletop or whoops — Shift+click flips its direction — and **Dirt** (5)
  paints dirt onto the road.

### Changed

- **The Claypit** is now a real dirt rallycross track with a ramp, a tabletop
  and whoops.

### Fixed

- Multiplayer: every player has the same truck colour on every screen — yellow,
  green, purple, red by starting position. Your own truck takes your colour for
  the session and turns yellow again when you leave.
- Multiplayer: the other players' trucks now show up on the track as soon as
  they have joined, so you can drive around together in the lobby — not only
  once the race has started.
- Multiplayer: your ghost no longer drives along while you are in a multiplayer
  session, so it can't be mistaken for another player.

## [0.2.0] - 2026-09-29

### Added

- Ghost: after your first full lap, a see-through truck replays your fastest
  lap on that track, in step with the lap timer — race it to beat your best.
  It is saved per track, so it is waiting for you next time.
- Mini map in the top-right corner on every track, showing where you are.
- Tracks built from OpenStreetMap now show the real buildings and side streets
  around the road, and the name of the street you are driving on.
- New "Auto" option in the OpenStreetMap track builder: smoother corners without
  losing parts of the route. It is the new default.
- Multiplayer: race up to three friends over the internet — send an invite link,
  paste back their answer code, and race a countdown start over 1–10 laps with
  trucks you can bump into. Works without any server; strict company networks
  may block it (a phone hotspot helps). Available in German and English.
- Race against the computer: **vs CPU** puts up to three CPU trucks on the grid —
  pick easy, medium or hard and 1–10 laps. Works on every track that is one
  closed circuit. Available in German and English.
- New track "Bad Säckingen Altstadt" in the Tracks menu: start on the covered
  wooden bridge over the Rhine, cross to Stein AG, come back over the
  Fridolinsbrücke and race through the old-town lanes — with the real houses
  and street names around you.
- The OpenStreetMap track builder now also uses pedestrian zones, so old-town
  lanes can be part of a track.
- Racing against the CPU: the CPU trucks now show up as coloured dots (green,
  purple, red) on the minimap, so you can always see who's on your tail — even
  when they're off screen.
- Accelerate with the space bar, too — it works just like `W` or `↑`.
- While a track loads you now see what is happening and how far along it is, in
  percent. **Cancel** takes you back to the track you came from; while the real
  houses of an OpenStreetMap track are still loading, it skips them and you drive
  on without. Available in German and English.
- Fullscreen toggle (⛶) in the game navigation

### Changed

- Donuts: when you spin the truck on the spot, the camera now holds still instead
  of swinging back and forth. It picks up following you again as soon as you drive off.

### Fixed

- Sound on phones: the engine, skid and crash sounds now start with your first
  steering touch (on an iPhone even with the silent switch on) and come back
  after a phone call, a locked screen or switching apps. Opening the Tracks menu
  first no longer leaves the game silent.
- vs CPU: the CPU trucks no longer stutter through corners, and bumping into one
  nudges your truck instead of flinging it away.
- vs CPU: you hear a crash when you and a CPU truck hit each other.
- vs CPU: restart or quit a running race at any time — with the buttons under the
  positions, from the **vs CPU** button, or with `Esc`.

### Changed

- Tracks load much faster, most of all the big ones: "Bad Säckingen Altstadt"
  used to keep you waiting for a long time, the Aerodrome circuits several times
  longer than the starter circuit. The starter circuit loads as before.

## [0.1.0] - 2026-09-24

### Added

- Fork of [mrdoob/Starter-Kit-Racing](https://github.com/mrdoob/Starter-Kit-Racing), published as game-kit-racer.
- In-game **Tracks** picker with four circuits converted from
  [Aerodrome Apex](https://github.freaxnx01.ch/game-aerodrome-apex/).
- `osm-track.html`: build a track from OpenStreetMap streets.
- Favicon and in-game version badge sourced from `version.js`.
