// Runs on NYT games pages — dismisses the pre-game ad interstitial.
//
// After you press Play, NYT can show a full-screen ad "intercept" with a
// bottom-right skip button ("Continue to <Game>", class Skip-module_skipButton_<hash>).
// When the ad never fills (ad blocker, failed fill) the overlay never
// auto-dismisses and the board never renders — and the skip button sits below
// the fold on a short window, so it looks like the game is just broken.
// Click it as soon as it shows up and is enabled.
(function () {
  'use strict';

  function clickSkip() {
    for (const btn of document.querySelectorAll('button[class*="skipButton"]')) {
      if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;
      btn.click(); // plain click works here, unlike the pz-moment launch button
      console.log('[tijeux] ad interstitial skipped:', btn.textContent.trim());
      return;
    }
  }

  // The button is inserted into the DOM, so childList is enough — the countdown
  // ticking is characterData and doesn't wake us. Never disconnected: the
  // interstitial can appear at any point (page load, or between games). Target
  // is `document` so this works whether we run at document_start or later.
  new MutationObserver(clickSkip).observe(document, { childList: true, subtree: true });
  clickSkip();
})();
