// Runs on www.nytimes.com/crosswords/* — auto-dismisses the launch ("welcome")
// screen so the board shows immediately.
//
// NYT used to load the game from <script src="crossword.[hash].js"> and gate play
// behind a "Start" modal in a Redux reducer, which we rewrote. They now (a) inline
// the game bundle directly in the page HTML — nothing to intercept by src — and
// (b) replaced the Start modal with a separate `pz-moment` welcome screen. So the
// only reliable lever left is the DOM: click the Play button when it appears.
(function () {
  'use strict';

  // Launch-screen buttons come from two components: the old one uses
  // `pz-moment__button`, the new CSS-module one uses a hashed `_momentButton_<hash>`
  // (matched via the `momentButton` substring). The Play/Resume button is the new
  // kind. Filter by text so we never click Subscribe / Log in.
  function clickPlay() {
    // button elements only — pz-moment__button-group / -wrapper divs also match
    // these substrings and carry the same text, but swallow dispatched events.
    const buttons = document.querySelectorAll('button[class*="pz-moment__button"], button[class*="momentButton"]');
    for (const btn of buttons) {
      const text = btn.textContent.trim();
      // Only the entitled launch button (a real <button> reading Play/Resume).
      // Never Subscribe / Log in / "Let's play" — those are <a> anchors that
      // navigate away; the entitlement stub turns them into a Play button first.
      if (text === 'Play' || text === 'Resume') {
        // The component listens on pointer events, so a bare .click() is not
        // enough — dispatch the whole sequence a real tap produces.
        const r = btn.getBoundingClientRect();
        const opts = { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
        for (const [type, Ctor] of [
          ['pointerdown', PointerEvent], ['mousedown', MouseEvent],
          ['pointerup', PointerEvent], ['mouseup', MouseEvent], ['click', MouseEvent],
        ]) {
          btn.dispatchEvent(new Ctor(type, opts));
        }
        console.log('[tijeux] crossword: clicked launch button', text);
        return true;
      }
    }
    return false;
  }

  // Poll instead of a MutationObserver: React hydrates the static launch button
  // in place (no DOM mutation), so early clicks are no-ops until the handler
  // attaches. Retry until the board renders, then stop.
  const interval = setInterval(() => {
    clickPlay();
    if (document.querySelector('[class*="xwd__cell"]')) clearInterval(interval);
  }, 500);
  setTimeout(() => clearInterval(interval), 15000);
})();
