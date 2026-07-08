// Runs in MAIN world at document_start on NYT crossword pages (both live
// www.nytimes.com/crosswords/* and saved file:// copies) — makes the Mini
// playable for anyone by stubbing the entitlement check, and on saved pages
// also feeds back the puzzle data the offline bundle can't fetch.
//
// The game re-fetches three things from nytimes.com:
//   1. the puzzle itself (XHR /svc/crosswords/v6/puzzle/mini.json)
//   2. saved game state  (XHR /svc/games/state/...)
//   3. the user's entitlements (fetch to samizdat-graphql, UserQuery) —
//      without XWD it shows the "Subscribe to play the Mini." gate.
//
// (3) is stubbed everywhere — that's the paywall bypass. (1) and (2) work
// natively on the live same-origin site, so they're only intercepted on
// file:// pages, where CORS from the file: origin kills them. The saved
// puzzle JSON comes from mini-saved-bridge.js via the 'tijeux-mini-data'
// CustomEvent; XHRs are answered by rewriting their URL to a data: URL.
(function () {
  'use strict';

  if (location.protocol === 'file:') {
    let puzzleJson = null;
    const waiters = [];
    document.addEventListener('tijeux-mini-data', (e) => {
      puzzleJson = String(e.detail);
      waiters.splice(0).forEach((fn) => fn());
    });

    const dataUrl = (s) => 'data:application/json,' + encodeURIComponent(s);

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      const u = String(url);
      if (u.includes('/svc/crosswords/v6/puzzle/mini')) {
        // Real open now so setRequestHeader() keeps working; send() re-opens
        // against the data: URL once the puzzle JSON is here.
        this._tijeuxPuzzle = true;
      } else if (u.includes('/svc/games/state/')) {
        arguments[1] = dataUrl('{"states":[]}');
      }
      return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
      if (!this._tijeuxPuzzle) return origSend.apply(this, arguments);
      const xhr = this;
      let done = false;
      const go = (json) => {
        if (done) return;
        done = true;
        if (json) {
          console.log('[tijeux] mini-saved: serving puzzle JSON');
          origOpen.call(xhr, 'GET', dataUrl(json));
        }
        // ponytail: no JSON after 10s (offline + never cached) → let the
        // original request run and fail like before the patch.
        origSend.call(xhr);
      };
      if (puzzleJson) return go(puzzleJson);
      waiters.push(() => go(puzzleJson));
      setTimeout(() => go(null), 10000);
    };
  }

  const USER = JSON.stringify({
    data: {
      user: {
        profile: { email: 'tijeux@local' },
        userInfo: { regiId: '0', subscriptions: ['XWD'] },
        protectedIds: { advertisingId: '', experimentationId: '' },
        subscriptionDetails: [
          { subscriptionName: 'Games', startDate: '2020-01-01', status: 'ACTIVE', entitlements: ['XWD'] },
        ],
      },
    },
  });

  const origFetch = window.fetch;
  window.fetch = function (input) {
    const u = String((input && input.url) || input);
    if (u.includes('samizdat-graphql.nytimes.com')) {
      return Promise.resolve(
        new Response(USER, { status: 200, headers: { 'content-type': 'application/json' } })
      );
    }
    return origFetch.apply(this, arguments);
  };
})();
