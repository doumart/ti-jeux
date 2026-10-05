// Runs on NYT and LinkedIn — declines the cookie consent banner, which covers
// the game in a fresh profile (the cloud browser). uBlock Origin Lite's cookie
// lists hide the other sites' banners, but not these two first-party ones.
// Clicks the reject button: the most private answer, and it remembers it.
(function () {
  'use strict';

  const REJECT = /^reject( all)?$/i;

  // Clicks before NYT's page has hydrated do nothing, so keep clicking while the
  // button is visible; the banner then hides and the clicks stop.
  function reject() {
    for (const btn of document.querySelectorAll('button')) {
      if (!REJECT.test(btn.textContent.trim()) || !btn.offsetParent) continue;
      btn.click();
      console.log('[tijeux] cookie banner declined:', btn.textContent.trim());
      return;
    }
  }

  // Poll, like ad-skip.js: the banner is inserted after load, and a subtree
  // MutationObserver ran this (offsetParent forces a layout) on every DOM change.
  setInterval(reject, 500);
  reject();
})();
