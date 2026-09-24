[//]: # (Stack overlay — loaded together with .ai/base-instructions.md for buildless browser-game projects)

# Browser Game Stack Overlay

Applies on top of `.ai/base-instructions.md` for **`game-*`** repos: vanilla
HTML/CSS/JS browser games shipped as static GitHub Pages, served at
`https://github.freaxnx01.ch/game-<name>/`, with **no build step to ship**.

Use this stack for repos like `game-space-invaders`, `game-kick-fury`, and
`game-tank-toys` — the deliverable is the static site itself, not a compiled
artifact.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | Vanilla JavaScript — ES modules (`<script type="module">`) or a classic script; no framework |
| Markup | Semantic HTML5 |
| Styling | Modern CSS — custom properties, Grid/Flexbox; no CSS framework required |
| Rendering | `<canvas>` (2D or WebGL) + `requestAnimationFrame`; DOM/SVG for non-canvas games |
| Audio | Web Audio API / `<audio>` |
| Multiplayer | Manual WebRTC (`RTCPeerConnection` + data channel) — **no signaling server, PeerJS, or Firebase** |
| Persistence | `localStorage` |
| Hosting | GitHub Pages, static, served from repo-root `index.html` |
| Build | **None required.** A few games use a source→`index.html` bundler ("dc-tool" format) — see Project Structure; there is **no CLI** for it, re-bundling is a manual merge |
| Versioning | Git tag `vX.Y.Z` (authoritative) + `version.js` display mirror |
| Changelog | `git-cliff` + `cliff.toml` (base tooling) |
| Lint / format | Optional `npx prettier` / `npx eslint`; nothing committed |

---

## Project Structure

Layout varies by game complexity — do not force one shape onto all three.

```text
# Minimal (most games)
index.html              ← the whole game (inline <style> + <script>)
README.md  LICENSE

# Richer / P2P game
index.html              ← markup + boot
game.js  (or *-game.js) ← game logic (classic script or ES module)
version.js              ← VERSION mirror (see Versioning)
style.css               ← if split out
assets/                 ← sprites, audio
vendor/                 ← third-party libs vendored (no npm)
CHANGELOG.md  cliff.toml  README.md  LICENSE

# Bundled game (dc-tool)
src/*.dc.html           ← EDIT THIS
index.html  support.js  ← GENERATED — see re-bundling process below
```

A bundled game is identified by a `data-dc-script` / `type="text/x-dc"` marker
in `index.html`. `support.js` is the generic dc runtime — it loads React/Babel
from `unpkg.com` at page-load time and hydrates the `<x-dc>` markup live in the
browser; it is not a build step and essentially never changes when editing
game logic. `index.html` is what GitHub Pages actually serves.

**There is no `dc-tool` CLI.** Despite the name, re-bundling is not a command
to run — it's a manual merge, confirmed working in practice (`game-stack-duel`,
2026-08-04): copy the full current `src/*.dc.html` content into `index.html`,
then re-apply `index.html`'s fixed set of source-file-only additions (these
vary slightly per repo, but typically: a `<link rel="icon">` favicon tag, a
`<script src="./version.js">` include, a `#game-nav` footer block, and a
version-badge self-healing script — diff the previous `index.html` against the
source once to find a given repo's exact set). Verify the merge with
`diff src/*.dc.html index.html` — the only differences should be exactly
those known additions; anything else means the merge missed something.

Editing `index.html` directly with *ad hoc* changes (not derived from the
source) is still forbidden (see the Agent Guardrails below). But skipping the
re-bundle entirely after a source edit is the more common and more damaging
failure: the source commit looks complete, but the published site doesn't
change at all, because GitHub Pages serves the stale `index.html`. Always
re-bundle as part of the same change, not a follow-up.

---

## JavaScript Conventions

- Prefer **ES modules** (`<script type="module">`) once a game spans more than
  one file; a genuinely single-file game may use one inline `<script>`.
- `const`/`let` only — no `var`.
- Don't leak game internals onto `window`. The one deliberate exception is the
  `version.js` global for non-module (classic-script) games.
- Separate **state**, **render**, and **input** — a render function reads
  state, it never mutates it; input handlers write to state, they never draw.
- Small, pure update functions. Base Clean Code rules apply (small functions,
  guard clauses, no flag arguments) — see base, not restated here.
- No framework, no jQuery.

---

## Game Loop

- **Fixed-timestep simulation, variable-rate render:** an accumulator
  advances the simulation in fixed `deltaTime` steps inside a
  `requestAnimationFrame` callback, so gameplay is independent of frame rate.
- Pause/resume the loop on `document.visibilitychange` — never keep simulating
  a backgrounded tab.
- Sample input into a plain state object (keys/pointer down-state); never
  mutate simulation state directly from an event handler.
- When P2P lockstep is used (see below), the simulation step must be
  **deterministic** — same inputs in the same order produce the same state on
  both peers.

---

## P2P Multiplayer (house pattern)

Manual WebRTC, no infrastructure:

- One peer creates an SDP **offer**, the other creates the **answer**; the two
  are exchanged by the players themselves (copy-paste, or a short displayed
  code) — **no signaling server, no PeerJS, no Firebase**.
- One `RTCDataChannel` carries all game messages.
- **Validate every inbound data-channel message** before applying it — never
  `eval` it, never trust the peer for authority-critical state. Use a
  host-authoritative model or deterministic lockstep, not "peer says so."
- Handle `connectionstatechange` to detect disconnects gracefully and offer a
  rematch/reconnect flow rather than hanging.
- Reference implementations: `game-tank-toys`, `game-kick-fury`.

---

## Versioning (stack binding)

Base SemVer/Conventional-Commits/`git-cliff` rules live in
`base-instructions.md`. For this stack:

- The **git tag `vX.Y.Z` on `main` is the single source of truth.**
  `version.js` is a **display mirror**, never a competing source — it is
  bumped by hand at release time to match the tag, and is rendered as a small
  `vX.Y.Z` badge somewhere in the UI (menu, footer, or about screen).

```js
// version.js — ES-module game
export const VERSION = "1.0.0"; // must equal the latest git tag vX.Y.Z

// version.js — classic-script game (no modules); load BEFORE the game script
window.GAME_VERSION = "1.0.0";  // must equal the latest git tag vX.Y.Z
```

Release flow:

```bash
# 1. bump version.js to the new X.Y.Z
# 2. CHANGELOG: rename [Unreleased] to [X.Y.Z] - YYYY-MM-DD by hand (see Changelog)
# 3. commit
git commit -am "chore(release): v1.2.0"
# 4. tag on main (authoritative)
git tag v1.2.0
git push --follow-tags
```

Do **not** add a second version source (no simultaneous `<meta name="version">`
tag, JSON file, and a second const). The tag is truth; `version.js` mirrors it.

---

## Changelog

`CHANGELOG.md` follows Keep a Changelog with an `[Unreleased]` section, as base
defines. **The entries are written by hand, and they are the deliverable** — a
game's changelog is read by the person playing it, so an entry says what changed
*in the game* („Die Turmhöhe ist jetzt wählbar…"), not what changed in the repo.
Each PR appends its entry under `[Unreleased]` in that voice.

**Never regenerate the file with `git cliff -o CHANGELOG.md`.** It rewrites the
whole file from commit subjects and deletes the player-facing prose of every
earlier release — confirmed the hard way while cutting `game-wipfelkratzer`
v0.6.0 (2026-09-17). Cutting a release is therefore an edit, not a command:
rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD` and open a fresh empty
`[Unreleased]` above it.

`cliff.toml` stays in the repo and `git-cliff` stays useful for *reading* the
Conventional Commits since the last tag (`git cliff --unreleased` to stdout) —
as a source to write from, never as a generator that overwrites the file.
`orhun/git-cliff-action` in CI is likewise fine for GitHub **Release notes**,
which are separate from `CHANGELOG.md`; the release body can also just be the
hand-written section for that version.

---

## Tooling & Testing

This stack is **buildless** — there is no build/test toolchain to ship, so a
disciplined **manual in-browser playtest is the test gate**. This is a
deliberate, documented deviation from base's TDD-first mandate, made because
there is no compiler/bundler/test-runner in the deliverable to justify one.

Manual verification checklist before every push/release:

- [ ] Page loads with an empty console (no errors/warnings)
- [ ] Canvas/DOM renders the initial frame correctly
- [ ] Core loop responds to input (movement, actions, pause)
- [ ] `localStorage` state persists across a reload
- [ ] P2P: both peers connect, exchange state, and the game survives a
      disconnect/reconnect

**For anything interactive that JS drives at runtime — a toggle, a button
that changes on-screen state, anything added via `addEventListener` or DOM
injection — verify it with an actual browser executing real JS, not just a
`curl`/text fetch of the HTML.** A static fetch confirms the markup and
script tags are present; it cannot confirm a click handler actually fires,
or that a framework elsewhere on the page didn't silently strip it. Playwright
(`pip install playwright && playwright install chromium`, or already
available in this environment) is the right tool:

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto("https://github.freaxnx01.ch/game-<name>/", wait_until="networkidle")
    page.locator("#some-button").click()
    assert page.locator("text=Expected result").count() > 0
    browser.close()
```

This is how the `#game-nav` i18n-toggle bug above was actually found — a
`curl` check of `index.html`/`i18n.js` showed everything present and
correct, but the button was invisible and non-functional in a real browser
the whole time.

**Run the verification in the foreground. Never `run_in_background`.** A
headless CI agent has no one to deliver a completion notification to, so a
backgrounded Playwright run never reports back. What follows is the agent
spending its remaining turns idling on `sleep 1`, `echo idle`, `:` — waiting
for a signal that cannot arrive — until the run ends. It then reports
**success while having pushed nothing**: no branch, no PR, the work committed
only on a runner that is about to be destroyed. That is worse than a plain
failure, because it is indistinguishable from a real success in the run report
and in `/ai-stats`.

A `game-wipfelkratzer` dispatch died exactly this way: 59 of 80 turns, 17
minutes, $2.76, `success`, nothing to show for it. If a check is slow, give the
foreground call a generous `timeout` and let it block — blocking is the point.

Commit and push the branch **before** starting verification, not after. Then a
run that dies mid-check still leaves the work recoverable instead of taking it
down with the runner.

### Animated cameras: wait for **arrival**, not stillness

The loop clamps each frame (`dt = Math.min(clock.getDelta(), 0.05)`) and a
headless renderer draws under 1 fps — a 0.9 s camera tween then takes ~25 s.
Measure earlier and the camera sits mid-flight, clamped to `maxDistance`,
reading like a defect; waiting for it to stop is no better, since
`enableDamping` decays asymptotically. Poll the end state: animation
queue empty **and** camera at its target (`tweenCount() === 0` plus
`camera.position.distanceTo(eye) < 0.2`, `timeout=120000`). Export both on
the debug hook. Re-run a red camera check against `main` first — identical
numbers mean the renderer, not the change.

---

## Localization (i18n)

Base's `de`/`en` rule applies to games with meaningful UI text (menus, HUD
copy, quiz questions).

**Carve-out:** pure-arcade games with negligible on-screen text (a score and a
"GAME OVER") may defer i18n. Text-heavy games (quizzes, dialog-driven games)
must comply.

### `i18n.js` (copy verbatim into the game repo)

Every `game-*` repo is served under the same `github.freaxnx01.ch` origin
(different path per repo), so `localStorage` is shared across all of them —
one `gg-lang` key means picking a language once carries into every other
game. `i18n.js` loads like `version.js` (classic script, before the game's
own script) and owns detection, persistence, and the toggle button; it knows
nothing about any individual game's strings.

```javascript
(function () {
  "use strict";

  var SUPPORTED = ["en", "de"];
  var STORAGE_KEY = "gg-lang";

  function detect() {
    var stored = null;
    try { stored = localStorage.getItem(STORAGE_KEY); } catch (e) {}
    if (stored && SUPPORTED.indexOf(stored) !== -1) return stored;
    var nav = (navigator.language || "en").toLowerCase();
    return nav.indexOf("de") === 0 ? "de" : "en";
  }

  window.GG_LANG = detect();

  window.ggSetLang = function (lang) {
    if (SUPPORTED.indexOf(lang) === -1) return;
    window.GG_LANG = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
    window.dispatchEvent(new CustomEvent("gg-langchange", { detail: { lang: lang } }));
  };

  // Delegated on `document`, not on the button itself: some games' #game-nav
  // is managed by a UI framework (e.g. a dc-tool-bundled game whose runtime
  // mounts a React root over it) that periodically recreates its DOM
  // subtree from the framework's own tracked template — silently dropping
  // any listener attached directly to a child node (and stripping raw
  // `onclick="..."` attributes, since a framework like React expects a
  // function-valued prop, not a string). A listener on `document` is
  // outside that subtree, so it survives regardless of how often the
  // button node underneath it gets replaced; it just re-checks
  // `event.target` on every click. See the "Framework-managed #game-nav"
  // note below.
  document.addEventListener("click", function (e) {
    var btn = e.target.closest && e.target.closest("#gg-lang-toggle");
    if (!btn) return;
    window.ggSetLang(window.GG_LANG === "en" ? "de" : "en");
    // Games with keyboard-driven controls (e.g. Enter/Space to confirm) can
    // otherwise re-trigger this button via the browser's native
    // button-activation-on-keypress behavior if it retains focus after the
    // mouse click — confirmed with game-nibbles, where a post-toggle Enter
    // press (a real gameplay key) silently flipped the language back.
    if (typeof btn.blur === "function") btn.blur();
  });

  function injectToggle() {
    // A pre-existing button (e.g. static markup inside a framework-managed
    // #game-nav — see below) is left alone; the delegated listener above
    // already covers clicks on it.
    if (document.getElementById("gg-lang-toggle")) return;

    var nav = document.getElementById("game-nav");
    if (!nav) return;

    var sep = document.createElement("span");
    sep.setAttribute("aria-hidden", "true");
    sep.style.color = "#5a6072";
    sep.textContent = "·";

    var btn = document.createElement("button");
    btn.id = "gg-lang-toggle";
    btn.type = "button";
    btn.title = "Switch language";
    btn.style.cssText =
      "background:none;border:none;padding:0;margin:0;font:inherit;color:#8fd8e8;cursor:pointer";
    btn.textContent = window.GG_LANG.toUpperCase();

    window.addEventListener("gg-langchange", function (e) {
      var b = document.getElementById("gg-lang-toggle");
      if (b) b.textContent = e.detail.lang.toUpperCase();
    });

    nav.appendChild(sep);
    nav.appendChild(btn);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectToggle);
  } else {
    injectToggle();
  }
})();
```

Load it in `index.html`, right where `version.js` loads:

```html
<script src="./version.js"></script>
<script src="./i18n.js"></script>
```

For a plain-HTML game, `injectToggle()` appends the button into the existing
`#game-nav` footer itself — no new UI surface to design per game.

**Adding keyboard controls to a game that already has `i18n.js`? Re-copy the
file.** Copies taken before the `btn.blur()` fix leave the toggle focused after
a click, so a gameplay key that isn't `preventDefault()`'d — `Enter`, `Space` —
re-triggers it via the browser's native button-activation-on-keypress and
silently flips the language back. Harmless while a game is mouse-only, which is
why an older copy can sit unnoticed for months; it becomes a live bug the moment
keys are wired up. The symptom looks like a broken language toggle, not a
keyboard problem, and it took a Playwright session to pin down the first time.

### Framework-managed `#game-nav` (dc-tool / DCLogic games)

Some bundled games (identified by a `data-dc-script` / `type="text/x-dc"`
marker) mount a full UI framework (React, via the dc-tool runtime) over the
**entire page**, `#game-nav` included, even when `#game-nav` itself is
static, hand-written markup rather than part of the game's own
`class Component` template. That framework periodically recreates
`#game-nav`'s DOM subtree from its own tracked copy — confirmed with
Playwright against a real pilot (`game-iron-valhalla`): a button injected by
`injectToggle()` flickered in and out during the first ~0.5s of settling
re-renders, then vanished for good and never came back. The same is true for
a raw `onclick="..."` attribute added to static markup by hand — React
silently strips it (it expects a function-valued `onClick` prop, not a
string) rather than erroring loudly, so the failure mode is "button visible,
does nothing," not a crash.

For these games, don't rely on `injectToggle()` to create the button. Add it
as static markup directly in `#game-nav`'s existing HTML, with a **static**
"EN/DE" label (not a dynamically-updated current-language indicator — a
JS-driven text update would hit the exact same problem) and no inline
`onclick`:

```html
  <span style="color:#5a6072" aria-hidden="true">·</span>
  <button id="gg-lang-toggle" type="button" title="Switch language" style="background:none;border:none;padding:0;margin:0;font:inherit;color:#8fd8e8;cursor:pointer">EN/DE</button>
```

`i18n.js`'s `document`-level delegated click listener (above) picks up clicks
on it regardless of how often the framework recreates the node underneath —
`injectToggle()` sees the button already exists and does nothing further.
`i18n.js` itself doesn't need any per-game changes for this case.

### Per-game strings

Each game owns its own strings — `i18n.js` never sees them:

```javascript
const STRINGS = {
  en: { newGame: "NEW GAME" /* ... */ },
  de: { newGame: "NEUES SPIEL" /* ... */ },
};

function t(key) {
  return (STRINGS[window.GG_LANG] && STRINGS[window.GG_LANG][key])
    || STRINGS.en[key]
    || key;
}
```

Replace every literal English UI string in a render path with `t("key")`.
Whatever a game's normal re-render mechanism is, trigger it from a
`gg-langchange` listener so switching languages updates on-screen text
immediately, without a reload:

```javascript
window.addEventListener("gg-langchange", () => /* re-render */);
```

---

## Games Hub Integration

Each game gets a card in `freaxnx01.github.io/games/index.html` — that repo,
not this one. Screenshots are generated by that repo's
`scripts/capture_screenshots.py`. New releases get the `NEW` tag on the card
per that repo's convention. Do not duplicate hub markup or screenshot tooling
inside a game repo.

---

## Security

- Client-side JS is fully public — never embed API keys, tokens, or secrets in
  it, even "obfuscated."
- Validate WebRTC data-channel and `postMessage` input at the boundary before
  it reaches game logic (see P2P Multiplayer).
- External resources (web fonts, CDN scripts, GitHub Pages badges/buttons) are
  loaded over HTTPS only.
- Never `eval` or `new Function` on remote or peer-supplied content.

---

## Essential Commands

```bash
# Serve locally (buildless)
python3 -m http.server 8000        # then open http://localhost:8000/
# or just open index.html in a browser

# Optional lint/format (nothing committed)
npx prettier --write .
npx eslint .

# Release (see Versioning) — the CHANGELOG is cut by hand, never generated
git tag v1.2.0
git cliff --unreleased          # read-only: commits since the last tag

# Regenerate hub screenshot (run in the freaxnx01.github.io repo)
python3 scripts/capture_screenshots.py
```

---

## Project Scaffold Checklist (browser-game)

- [ ] `index.html` served at repo root
- [ ] `version.js` with the version constant/global, matching the latest tag
- [ ] Version badge wired into the UI (menu/footer/about)
- [ ] `CHANGELOG.md` with `[Unreleased]` section
- [ ] `cliff.toml` for `git-cliff`
- [ ] `.gitignore` includes `.worktrees/`
- [ ] `README.md`
- [ ] `LICENSE`
- [ ] Hub card added in `freaxnx01.github.io/games/index.html`
- [ ] `CLAUDE.md` / `SKILL.md` / `.github/copilot-instructions.md` synced from
      base + this overlay
- [ ] Branch protection on `main`

---

## Agent Guardrails (stack-specific)

In addition to the base guardrails:

- Do not add a framework, bundler, `package.json`, or committed
  `node_modules` without asking.
- Do not introduce a signaling server or a P2P library (PeerJS, Firebase).
- Keep the game shippable as static files — no server-side runtime.
- Keep `version.js` equal to the latest git tag; never let it drift.
- Never make ad hoc edits directly to a bundled game's generated
  `index.html`/`support.js` — edit the source and re-bundle (see "Bundled game
  (dc-tool)" above for the manual-merge process; there is no CLI). Skipping the
  re-bundle after a source change is just as wrong as hand-editing — it ships
  nothing.
- Don't embed secrets in client JS.

### Never generate (this stack)

- Framework imports (React, Vue, Angular, Svelte, jQuery)
- A bundler, `package.json`, or `node_modules` committed into a game repo
- Secrets or API keys in client JS
- A second, competing version source alongside `version.js`/the git tag
- PeerJS/Firebase/signaling-server-based P2P
- `eval` / `new Function` on peer or remote input
- Commented-out code blocks
- A hand-edited generated bundle (`index.html`/`support.js` in a dc-tool repo)
