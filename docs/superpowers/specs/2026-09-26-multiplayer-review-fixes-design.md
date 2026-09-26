# Multiplayer review fixes — the six should-fix findings from PR #5

Date: 2026-09-26 · Status: approved (quick mode) · Issue: #7 · Feature: #1 (merged in fa8f473)

## Goal

Fix the six should-fix findings from the review of PR #5
(https://github.com/freaxnx01/game-kit-racer/pull/5#pullrequestreview-5326244165). Each fix is
small and local; no protocol message changes, no new dependencies. Line numbers refer to `main`
at fa8f473.

**Success:** `node --test test/*.test.mjs` passes with the new tests (72 → 81), the Playwright
menu check passes at 390 px width, and none of the six symptoms can be reproduced.

## 1. Guest on another track waits forever

**Problem.** `js/race/MultiplayerRace.js:359` — `if ( ! me || msg.map !== this.game.mapParam ) return;`
A guest whose `?map=` differs from the host's (it pasted the offer code on another track instead
of opening the invite link) silently ignores `setup` and keeps showing "Waiting for the host…";
the host races a truck that never moves and ends with a DNF.

**Fix.** On a `setup` for another map the guest calls a new `otherTrack( setup )`: it sends
`leave` and returns to single player (the existing `leave()`, so the host sees "Bo left"), then
sets `view.hostTrack` to this page's URL with the host's `map`/`osm` and says `mp.otherTrack`.
The Lobby shows the message plus a link "Open the host's track" (`mp.openHostTrack`) and opens
the panel once when the link first appears. The URL building in `inviteLink()`
(`MultiplayerRace.js:264-272`) moves into `trackUrl( map, osm )`, which also clears the hash
(a guest's `pageUrl` still carries `#join=…`). The guest then needs a fresh invite from the host
— a WebRTC connection cannot survive the page change.

**Test.** `test/multiplayer-race.test.mjs` `guestSetup_otherTrack_leavesAndOffersTheHostTrack`;
`test/strings.test.mjs` `STRINGS_otherTrackTexts_existInBothLanguages`.

## 2. Truck spins on its grid slot during the countdown

**Problem.** `js/main.js:295-306` `placeOnSlot` zeroes the physics body and `linearSpeed`, but not
`vehicle.angularSpeed` / `vehicle.acceleration` (`js/Vehicle.js:31-32`). With input held at
zero, `Vehicle.update` still applies `container.rotateY( angularSpeed * dt )`
(`js/Vehicle.js:126-128`) while `angularSpeed` decays, so a truck that was steering when the
race started keeps turning on its slot; `acceleration` drives the body-tilt/drift visuals.

**Fix.** Also set `vehicle.angularSpeed = 0`, `vehicle.acceleration = 0` and
`vehicle.sphereVel.set( 0, 0, 0 )` — the same fields the fall-respawn reset clears
(`js/Vehicle.js:203-206`).

**Test.** Not unit-testable in Node (`main.js` needs WebGL, three.js and crashcat from the import
map; `index.html` does not boot in headless Chromium). Verified by `node --check js/main.js`, a
grep for the three assignments, and a manual check (steer hard, host starts the race → the truck
sits still on its slot during the countdown).

## 3. Multiplayer panel under the nav bar on phones; two menus open at once

**Problem.** `js/ui/Lobby.js:11-16` puts `#mp-panel` at `bottom: 56px` at every width, while
`index.html:45` moves `#game-nav` to `bottom: 60px` (and `#tracks-menu` to `bottom: 100px`) below
760 px — the nav bar covers the panel's Start/Leave buttons. The Multiplayer button calls
`e.stopPropagation()` (`Lobby.js:104`), so `index.html`'s document listener
(`index.html:104-105`) never closes the Tracks menu; the Tracks button stops propagation too, and
nothing closes the multiplayer panel — both menus end up open in the same spot.

**Fix.** Lobby CSS: `@media (max-width: 760px) { #mp-panel { bottom: 100px; max-height: calc(100vh - 184px); } }`
(same offset as `#tracks-menu`). The Multiplayer button no longer stops propagation, so the
existing document listener closes the Tracks menu. The Lobby listens for clicks on
`#tracks-button` (when present) and calls a new `close()`.

**Test.** DOM/CSS, not unit-testable in Node. New harness `test/harness/menus.html` (Tracks
button/menu + `#game-nav` with `index.html`'s rules, real `Lobby`) and a Playwright check at
390 × 800: Tracks → Multiplayer closes Tracks; the panel's bottom is above the nav bar's top;
Multiplayer → Tracks closes the panel. Verified to fail on `main` and pass with the fix.

## 4. Validator shows as binary in git

**Problem.** `js/net/Protocol.js:24` (`cleanName`), `js/ui/Lobby.js:356` (`name()`) and
`test/protocol.test.mjs:70` contain raw control bytes (NUL…US, DEL, BEL) inside regex/string
literals; git shows `Protocol.js` as `Bin` in diffs.

**Fix.** `cleanName` uses `/[\u0000-\u001f\u007f]/g`; `Lobby.name()` becomes
`return cleanName( this.nameInput.value ) ?? funnyName();` (one cleaning rule); the test uses
`'\u0007'`.

**Test.** `test/protocol.test.mjs` `sources_nameCleaningFiles_containNoRawControlCharacters`
(reads the three files, fails on `main`) and `cleanName_everyControlCharacter_isStripped`.

## 5. Legit player kicked when leaving the track area

**Problem.** The `state` validator rejects positions outside the track bounds
(`js/net/Protocol.js:45`, `inBounds` at :29-33); `Session` counts every rejected message as a
drop and kicks after 20 (`js/net/Session.js:10`, :183-189) with no decay. At 20 Hz a truck that
drives or falls off the map is kicked after ~1 s.

**Fix.** Protocol separates "malformed" from "well-formed but outside the track area": new
`readMessage( text, bounds )` → `{ kind: 'deliver', msg }` | `{ kind: 'ignore' }` |
`{ kind: 'drop' }`. `validate` / `parseMessage` keep their current contract (built on the same
helpers). `Session` counts only `drop`; `ignore` is silently discarded (the remote truck stays
at its last in-bounds position until it comes back).

**Test.** `test/protocol.test.mjs` `readMessage_outOfBoundsStateVsMalformed_areToldApart`; new
`test/session.test.mjs` drives `Session.wire` with a fake data channel (no WebRTC needed):
120 out-of-bounds states → no kick; 21 malformed → kicked with `'invalid'`.

## 6. Result order trusts guest-reported lap times

**Problem.** `js/race/RaceState.js:139` only checks `time ≥ minLap`, and `standings`
(:164) orders finishers by the reported total — a guest can report fast laps and win while
actually finishing last.

**Fix.** Finishers are ordered by the host-observed finish time (`recordFinish( id, now )`
stores `finishedAt`); the reported total only breaks exact ties. Displayed times stay the
reported lap sums. No lap is rejected for clock skew, so network latency can never turn a
legitimate lap into a DNF.

**Test.** `test/race-state.test.mjs`: `tick_everyoneFinished_showsResultsInTimeOrder` is replaced
by `…InHostObservedFinishOrder` (the old expectation *is* the bug), plus
`results_guestReportsFastLapsButFinishesLast_isPlacedLast` and
`results_sameFinishMoment_fallsBackToReportedTotal` (keeps
`raceToResults_thenRematch_returnsToLobbyWithoutError` green, where both finish in the same tick).

## Out of scope

Validating a guest's route/position against its lap claims (a malicious guest can still send its
final lap early); CHANGELOG entry (multiplayer is still under `[Unreleased] › Added`); any
protocol message change.
