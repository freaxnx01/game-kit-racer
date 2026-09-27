# Audio unlock — sound that reliably starts (and comes back) on every device

Date: 2026-09-27 · Status: approved (quick mode) · Issue: #12

## Goal

Issue #12 says "Sound aus dem geforkten Original fehlt" (the sound from the forked original is
missing). The sound code itself is still in the fork, byte for byte. `js/Audio.js`,
`js/EngineWorklet.js`, `js/ImpactSound.js` and `audio/skid.ogg` are identical to upstream
`mrdoob/Starter-Kit-Racing@40942fb` (`git diff 40942fb HEAD -- js/Audio.js js/EngineWorklet.js
js/ImpactSound.js` is empty). `js/main.js:248-249,385,419` still creates, feeds and triggers
`GameAudio`, and all four assets are served on `github.freaxnx01.ch/game-kit-racer/` (HTTP 200,
same byte sizes as upstream).

So nothing was removed. What fails is **starting** the audio. The browser only lets a page play
sound after a user gesture, and the unlock in `js/Audio.js:176-193` can miss that gesture or throw
it away:

1. **It unlocks on `touchstart`, and it unlocks only once, without checking the result.**
   `unlock()` sets `this.unlocked = true`, calls `ctx.resume()` without awaiting it, and removes
   all three listeners (`js/Audio.js:178-187`). Per the HTML spec, `touchstart` is **not** an
   activation-triggering event (only `keydown`, `mousedown`, `pointerdown` for a mouse, `pointerup`
   for touch/pen, and `touchend` are). In WebKit (iOS Safari, and every iOS browser) a `resume()`
   without activation stays suspended. On a phone the first touch is nearly always a steering drag
   on the full-screen `.steer-zone` (`js/Controls.js:31`, `touch-action: none`), so no `click`
   follows. The one attempt fails, the listeners are gone, and the game stays silent for the rest
   of the session.
2. **iOS silent switch.** WebKit routes Web Audio through the "ambient" audio session by default,
   so the ring/silent switch mutes it completely. Every sound here is Web Audio: a `THREE.AudioListener`
   context, an AudioWorklet engine and `PositionalAudio` buffers.
3. **A `click` that stops propagating never reaches the window listener.** The fork's Tracks
   button calls `e.stopPropagation()` (`index.html:104`). The listeners are bubble-phase on
   `window` (`js/Audio.js:191-193`), so a player who opens the Tracks menu first doesn't unlock
   anything with that click. It is harmless on desktop, where the next arrow key unlocks, but it's
   the same fragile pattern.
4. **An interrupted context never comes back.** On iOS a phone call, Siri or a locked screen puts
   the context into `interrupted`/`suspended`. The `visibilitychange` handler
   (`js/Audio.js:197-209`) resumes once, and nothing re-arms if that resume fails.

**Not reproduced.** In headless Chromium with `--autoplay-policy=document-user-activation-required`,
a drag, a tap and a key press each unlock the audio: Chromium keeps the early `resume()` pending
and honours it at the following `touchend`. So desktop and Android Chrome most likely work. The
failure mode above is WebKit/iOS behaviour, derived from the spec and WebKit's documented
policy. It could not be run here (no WebKit build installed; installing one is out of scope).
`index.html` itself does not boot in headless Chromium: the light-probe bake did not finish
within 7 minutes, which matches the note in `2026-09-26-multiplayer-review-fixes-design.md`.

**Success:** on an iPhone (silent switch on or off), the engine is audible within a second of the
first steering drag. Sound returns after a tab switch, a lock screen or a phone call. Desktop is
unchanged: the first key press or click starts the sound, including a click on the Tracks button.
`node --test test/*.test.mjs` passes (159 → 159 + the new unlock tests). The Playwright check on
`test/harness/audio.html` passes.

## Design

### 1. `js/AudioUnlock.js` — a small, three.js-free unlock controller

Pure ES module with no three.js import, so it's unit-testable in Node with a fake context and
Node's built-in `EventTarget`.

```js
export const UNLOCK_EVENTS = [ 'pointerdown', 'pointerup', 'touchend', 'keydown', 'click' ];

export class AudioUnlock {
	constructor( context, { target = globalThis, onUnlock = () => {} } = {} )
	get unlocked()          // true once the context has actually reached 'running'
	arm()                   // (re)attach the gesture listeners, capture phase; idempotent
	disarm()                // remove them
	async tryResume()       // resume(); if state === 'running' → disarm + onUnlock (first time only) ; never throws
	suspendForHidden()      // tab hidden: suspend a running context
	resumeForVisible()      // tab visible: if it was unlocked, tryResume(); still not running → arm()
}
```

Rules:

- Listeners are registered with `{ capture: true, passive: true }` on `window`, so a
  `stopPropagation()` in page UI can't hide a gesture, and steering is never slowed down.
- `touchstart` is deliberately **not** in the list. It is not an activation event, and `touchend`
  from the same drag is.
- A gesture only counts as the unlock when `context.state === 'running'` after `await resume()`.
  If it isn't running, the listeners stay armed and the next gesture tries again. `unlocked`
  never lies.
- `onUnlock` fires once. Later re-unlocks (after an interruption) only resume the context. The
  looping skid source keeps playing through a suspend, so nothing needs to be restarted.
- The controller listens to the context's `statechange`. When the state leaves `running` while the
  page is visible (an iOS interruption), it re-arms, so the next touch brings the sound back.
  (`document.hidden` is read through an injectable `isHidden` option, `() => document.hidden`
  by default, so Node tests can set it.)

### 2. `js/Audio.js` — use it

- Replace the inline `unlock` closure and the `visibilitychange` block (`js/Audio.js:176-209`)
  with an `AudioUnlock` whose `onUnlock` sets `this.unlocked = true` and calls
  `this.startSounds()`. `visibilitychange` calls `suspendForHidden()` / `resumeForVisible()`.
- Before creating the listener, opt the page into the iOS "playback" audio session when the API
  exists: `if ( navigator.audioSession ) navigator.audioSession.type = 'playback';`. This is Safari
  16.4+; other browsers don't have `navigator.audioSession` and skip it. After this the silent
  switch no longer mutes the game, like a native game or a video.
- `playImpact`'s `if ( ! this.unlocked ) return;` and the skid loader's
  `if ( this.unlocked ) this.startSounds();` keep their meaning, because `unlocked` is now
  set only once the context is really running.

No other file changes. `main.js` keeps calling `audio.init( cam.camera, vehicleGroup )`.

### 3. Verification

- **Node unit tests** `test/audio-unlock.test.mjs` use a fake context (`state`, `resume()`,
  `suspend()` and `EventTarget` for `statechange`) plus a plain `EventTarget` as the window.
  They cover: a resume that does not reach running keeps it armed; running disarms and calls
  `onUnlock` once; `touchstart` is ignored; `statechange` to `interrupted` while visible re-arms;
  hidden → visible resumes; `unlocked` stays false after a failed resume.
- **Browser harness** `test/harness/audio.html` boots the real `GameAudio` with a stub camera
  and target (three.js from the CDN import map, no WebGL scene, so it runs headless in seconds). A
  Playwright check under `--autoplay-policy=document-user-activation-required` asserts:
  - an **untrusted** `touchstart` dispatched from script leaves `unlocked === false` while the
    context is suspended. On `main` this fails: `unlocked` becomes `true` with a suspended
    context, which is the bug's signature.
  - a real click on an element that calls `stopPropagation()` unlocks. On `main` this fails.
  - a real touch drag (CDP touchStart/Move/End) unlocks.
  - after `ctx.suspend()` a real tap brings the context back to `running`.
- **Manual (human, real iPhone):** silent switch on, open the live site, drag to steer → engine
  audible; lock and unlock the phone → still audible after the next touch.

## Out of scope

- Engine or impact sounds for CPU or multiplayer opponents, and a collision sound for truck-on-truck
  hits. The CPU-race collision sound is #13.
- A mute/volume control, or any new visible UI (so no new de/en strings).
- Load-time work (#14/#15), controls (#16), camera (#17), minimap (#18).
