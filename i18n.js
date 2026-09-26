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
