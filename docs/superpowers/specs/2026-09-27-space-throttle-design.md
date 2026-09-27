# Space bar accelerates — throttle on the space bar

Date: 2026-09-27 · Status: approved (quick mode) · Issue: #16

## Goal

The player can accelerate with the **space bar**, in addition to `W` / `↑`. Holding Space drives
forward exactly like holding `W`; releasing it stops accelerating. Pressing Space must never
trigger a UI button that happens to have keyboard focus.

**Success:** `node --test test/*.test.mjs` passes (159 → 168), and a Playwright check against a new
harness page shows: Space held → `controls.update().z === 1`; released → `0`; a focused
`<button>` does not fire on Space; typing a space into a text field still inserts a space.

## Current state

- Keyboard input lives in `js/Controls.js`. The constructor records every `KeyboardEvent.code`
  in `this.keys` (`js/Controls.js:17-18`); `update()` maps `KeyA/ArrowLeft`, `KeyD/ArrowRight`,
  `KeyW/ArrowUp`, `KeyS/ArrowDown` to the `x` / `z` axes (`js/Controls.js:113-117`).
- **Space is unbound in the game.** No other `keydown`/`keyup` listener exists in `js/` or
  `index.html`; there is no handbrake, drift or menu-confirm key — `update()` returns only
  `{ x, z, touchActive }` (`js/Controls.js:159`), and drift is computed from speed, not input
  (`js/Vehicle.js:228`). The track editor uses Space for panning (`editor.html:1203-1240`), but
  that is a separate page that never loads `Controls.js`.
- **Conflict: focused buttons.** After a mouse click, a `<button>` keeps focus, and the browser
  activates a focused button on Space (the same problem `i18n.js:39-44` works around with
  `blur()`). Affected in the game page: CPU panel "Start race" / "Rematch" / "Free driving" /
  "Quit race" (`js/ui/CpuPanel.js:90,198,216-217`), the multiplayer lobby buttons
  (`js/ui/Lobby.js`), and `#gg-lang-toggle` for any copy of `i18n.js` older than the blur fix.
  Without handling, "click Start race, then hold Space to go" would restart or quit the race.
- **Text fields.** The lobby has a name `<input>` and code `<textarea>`s
  (`js/ui/Lobby.js:116-117`) and the CPU panel has `<select>`s; Space must keep working there.
- There is no on-screen control help in `index.html` and no controls section in `README.md`, so
  there is no help text to extend.

## Design

All changes in `js/Controls.js`, two small pure functions plus their wiring:

1. **`keyboardAxes( keys ) → { x, z }`** (exported, pure). The existing keyboard block of
   `update()` moves into it unchanged, with `keys[ 'Space' ]` added to the forward condition:
   `if ( keys[ 'KeyW' ] || keys[ 'ArrowUp' ] || keys[ 'Space' ] ) z += 1;`. Space + `W` is still
   `1` (one condition, not additive); Space + `S` is `0`, like `W` + `S` today. `update()` calls it
   and then applies gamepad and touch overrides exactly as now.
2. **`swallowsSpace( code, target ) → boolean`** (exported, pure). `true` when
   `code === 'Space'` and `target` is not editable. Editable = `INPUT`, `TEXTAREA`, `SELECT`
   (by `tagName`) or `target.isContentEditable`. `target` may be `null`/`window` — then `true`.
3. The `keydown` and `keyup` listeners call `e.preventDefault()` when
   `swallowsSpace( e.code, e.target )` holds, then record the key as before. Preventing both
   events stops button activation (Chromium/Firefox fire the button's click on Space keyup) and
   any page scroll.

Space pressed inside a text field is still recorded as held (like `W` typed into the name field
today) — only its default action is left alone there.

The countdown / `holdInput` zeroing in `js/main.js:399-400` applies to Space automatically, as
does everything downstream (`Vehicle.update`, multiplayer state send, ghost recording).

No new UI, no new strings (nothing to translate), no change to gamepad or touch input.

## Testing

- **Node** (`test/controls.test.mjs`, new): `keyboardAxes` — Space alone → `z = 1`; Space + W →
  `z = 1`; Space + S → `z = 0`; no keys → `{ x: 0, z: 0 }`; A/D/arrows steering unchanged (5 tests).
  `swallowsSpace` — Space on a `BUTTON` → true; Space on `INPUT`/`TEXTAREA`/`SELECT`/
  contentEditable → false; Space on `null` → true; `KeyW` on a button → false (4 tests).
  `Controls.js` has no imports and only touches `window` in the constructor, so the pure
  exports import cleanly into Node.
- **Playwright** (`test/harness/controls.html`, new; Python Playwright, not committed as a
  script): a harness page creates `new Controls()` plus a `<button>` with a click counter and an
  `<input>`. Focus the button (click it once, reset the counter), hold Space → `update().z === 1`
  and counter stays `0`; release → `z === 0`. Focus the input, press Space → its value is `' '`.
- **Manual**: `index.html` in a browser — drive with Space; click "vs CPU" → "Start race", then
  hold Space: the truck drives after GO and the race does not restart.

## Changelog

`CHANGELOG.md` → `## [Unreleased]` → `### Added`, player-facing, in the file's existing language
(English):

> - Accelerate with the space bar, too — it works just like `W` or `↑`.

## Out of scope

- A gamepad face-button throttle, a handbrake, remappable keys.
- An on-screen controls hint (the game has none; adding one is a new UI surface and belongs in
  its own issue with the UI workflow).
- Ignoring *all* driving keys while typing in a text field (pre-existing behaviour for `W`/`S`).
