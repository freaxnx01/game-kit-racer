# Peer-to-peer multiplayer — race friends over WebRTC

Date: 2026-09-24 · Status: approved design, awaiting spec review · Issue: #1

## Problem

Kit Racer is single-player. Friends want to race each other on the same track, the way
Tschau Sepp (`freaxnx01/game-tschau-sepp`) plays online: no backend, codes exchanged by the
players, WebRTC between browsers.

## Goal and success criterion

2–4 players on different machines join one race, see and bump each other's trucks, race a
countdown start over N laps, and get a results list.

**Success:** two people on different networks exchange an invite link and an answer code,
race 3 laps with contact, and both see the same finishing order; a rematch works.

## Scope

In scope: host/guest session over manual WebRTC signaling (codes + invite links), 2–4 players
(star via host), solid remote trucks, countdown + N-lap race, results + rematch, disconnect
handling, de/en for all multiplayer UI.

Out of scope: TURN or any signaling server, spectators, joining a race in progress, more than
4 players, translating the rest of the game (stays in the parked i18n TODO), ghost (#3) and CPU
(#4) opponents — though `Opponents.js` is built so they can reuse it.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Other trucks | Solid: remote trucks are kinematic colliders you bump into |
| Players | 2–4, star topology through the host (Tschau Sepp model) |
| Race format | Host picks lap count (default 3); countdown; first to finish wins; results; rematch |
| Language | de + en via the stack's `i18n.js`, multiplayer UI only |
| Sync model | Each player simulates their own truck; host is authoritative for race state only |
| Signaling | `KR1.` codes (deflate SDP) plus `#join=` invite links |

Rejected: deterministic lockstep (crashcat float physics is not deterministic across browsers);
host-simulated physics (guest input lag, biggest rework of `main.js`/`Vehicle.js`).

## Architecture

```
Host browser                                   Guest browser (×1–3)
┌──────────────────────────┐   RTCDataChannel   ┌──────────────────────────┐
│ Session (host)           │◀──────────────────▶│ Session (guest)          │
│  ├ RaceState (authority) │   JSON messages,   │  ├ mirrors race state    │
│  ├ relays guest `state`  │   validated by     │  └ sends own `state`,    │
│  └ Opponents (kinematic) │   Protocol.js      │    `lap`, `finish`       │
│ local Vehicle + physics  │                    │ local Vehicle + physics  │
└──────────────────────────┘                    └──────────────────────────┘
      signaling: KR1.<offer> via invite link / copy-paste, KR1.<answer> back by copy-paste
```

### Modules

| File | Kind | Responsibility |
|---|---|---|
| `js/net/Signal.js` | pure | `KR1.` code encode/decode (deflate-raw SDP + created-at time, 10-minute expiry), invite link build/parse (`#join=`) |
| `js/net/Protocol.js` | pure | Message constructors and `validate( msg )` for every inbound message |
| `js/net/Session.js` | browser | `RTCPeerConnection` (Google STUN), one data channel per guest, host relay, ping/pong RTT, `connectionstatechange` |
| `js/race/RaceState.js` | pure | Host state machine `lobby → countdown → racing → results`, slots, lap plausibility, finishing order, timeouts, leaves |
| `js/race/Opponents.js` | three + crashcat | Remote truck model (tinted, name label) + kinematic sphere body driven by `rigidBody.moveKinematic`, 100 ms interpolation buffer |
| `js/ui/Lobby.js` | DOM | Create/join, name, lap count, codes/links with expiry countdown, roster, countdown overlay, live positions, results |
| `js/ui/strings.js` | pure | de/en strings for the multiplayer UI |
| `i18n.js` | classic script | Copied verbatim from the browser-game stack (shared `gg-lang` key, language toggle) |

Integration: a **Multiplayer** button next to **Tracks** in `index.html`; `main.js` gets a small
race hook — place the local truck on its grid slot, hold input until GO, emit `state` (~20 Hz)
and `lap`/`finish` from `LapTimer`, update `Opponents` each frame.

### Messages (JSON, max 2 KB each)

| Type | Direction | Payload |
|---|---|---|
| `hello` | guest → host | `name` |
| `roster` | host → all | players `[ { id, name, slot, connected } ]` |
| `setup` | host → all | `map`, `osm` (or null), `laps`, `slots`, `startIn` (ms) |
| `ping` / `pong` | both | `t` |
| `state` | guest → host → others; host → all | `id`, `p` [x,y,z], `q` [x,y,z,w], `v` [x,y,z], `lap`, `progress` |
| `lap` | guest → host | `lap`, `time` |
| `finish` | guest → host | `total`, `best` |
| `results` | host → all | `[ { id, name, total, best, place } ]` |
| `rematch` | host → all | — (followed by `setup`) |
| `leave` | any | `id` |

## Race flow

1. **Lobby.** Host: Multiplayer → Create race, name (funny default), laps 1–10 (default 3);
   track = the currently loaded one (default, preset, or OSM with `&osm=`). Per guest the host
   gets a `KR1.` code and an invite link `index.html?map=…[&osm=…]#join=KR1.…`, valid 10 minutes
   with a countdown and regenerate button. Opening the link loads the track and pre-fills the
   offer; the guest enters a name and copies the answer code back; the host pastes it; the
   roster shows everyone as connected.
2. **Grid.** Slots in join order: slot 1 finish tile left of centre, slot 2 right of centre,
   slots 3–4 the tile behind, left/right; all facing the driving direction.
3. **Countdown.** Host presses Start; `setup` carries `startIn` relative to the message; each
   guest subtracts half its measured RTT so GO lands within about a frame everywhere. Input is
   ignored until GO.
4. **Racing.** Existing `LapTimer` rules (every cell visited). Each lap sends `lap`; the last
   lap sends `finish`. Host rejects laps averaging faster than 80 m/s over the track length.
   Live position list P1–P4 by laps, then progress.
5. **Results.** Order, total time, best lap — when everyone finished, or 30 s after the winner.
   Host: Rematch (same track, new countdown) or Back to lobby.
6. **Disconnects.** A leaving guest's truck and collider disappear, marked "left", race goes
   on. Host leaves → guests see "Host left" and return to single player. `connectionstatechange`
   `failed`, or `disconnected` for more than 5 s, counts as leaving.

## Error handling

- Bad or expired code → "Code invalid or expired — ask for a new one"; never throws.
- Inbound messages failing `validate` (wrong type, out-of-range numbers, NaN, oversized strings)
  are dropped and counted; after 20 drops the peer is disconnected.
- Names rendered with `textContent` only, 1–16 characters.
- Remote positions accepted only within the track bounds + 3 cells.
- No `eval` / `new Function`; messages over 2 KB dropped.
- Not connected after 20 s → hint: "Strict networks (e.g. company Wi-Fi) can block direct
  connections — try a phone hotspot."

## Testing

- **Node:** `Signal` (round-trip, expiry, invite link build/parse, garbage input); `Protocol`
  (every type accepted, every malformed variant rejected); `RaceState` (slots, countdown with RTT
  offset, lap plausibility, finishing order, 30 s timeout, leave and host-left); `strings`
  (every key in both de and en).
- **Headless:** two Playwright pages in one browser connect over a real local WebRTC connection
  via code exchange (renderer stubbed); asserts lobby, roster, `setup` arrival and a relayed
  `state`.
- **Manual:** two devices on different networks — 3-lap race with bumping, then rematch.

## Constraints kept

Static files only (no bundler, no `package.json`); no signaling server, PeerJS or Firebase;
single-player, presets, OSM tracks and the editor unchanged when Multiplayer is not used;
best laps from multiplayer races are not written to the single-player best-lap storage.

## Refinements during planning (2026-09-24)

Validated against a throwaway prototype (unit tests, a real three-page WebRTC session, a crashcat
push test and a two-page end-to-end lobby/race run):

- `setup` carries the whole `?map=` string, so it may be up to 16 384 characters; all other
  messages stay at 2 048.
- Lap plausibility is expressed in world units: laps averaging faster than 40 units/s are
  rejected (about three times the fastest lap driven on the default track).
- The host recomputes total and best time from the laps it accepted; a guest's `finish` totals
  are not trusted.
- Two extra pure modules: `js/race/Interpolate.js` (state buffer) and
  `js/race/MultiplayerRace.js` (the controller between session, race rules, game adapter and UI),
  so the controller is testable in Node with a fake session.
- Offer expiry is enforced by the host (its own clock), never by comparing clocks across machines.
